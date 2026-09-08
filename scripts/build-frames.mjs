import { makeGrid, demoTown } from '../src/grid.js';
import { serialize } from '../src/state.js';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const reports = [];
await mkdir('artifacts', { recursive: true });
try {
  for (const delay of [0, 200]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.addInitScript(
      (json) => localStorage.setItem('riviera-town-v1', json),
      serialize(demoTown(makeGrid().cells)),
    );
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    // Test-only access after rendering: capture the actual WebGPU output before
    // the browser clears the canvas, without adding a shipping diagnostic API.
    await page.route('**/src/main.js*', async (route) => {
      const response = await route.fetch();
      let body = await response.text();
      assert.ok(body.includes('architecture.markSubmitted();'));
      body = body
        .replace(
          'window.riviera = {',
          'window.__test = { architecture, camera, env }; window.riviera = {',
        )
        .replace(
          'architecture.markSubmitted();',
          'architecture.markSubmitted(); window.__capture?.();',
        );
      await route.fulfill({ response, body });
    });
    await page.addInitScript((delay) => {
      const NativeWorker = Worker;
      window.Worker = class extends NativeWorker {
        set onmessage(listener) {
          super.onmessage = (event) => setTimeout(() => listener(event), delay);
        }
      };
    }, delay);
    await page.goto(process.env.RIVIERA_URL || 'http://localhost:5173/');
    await page.waitForFunction(() => window.riviera?.stats.fps > 0);
    await page.evaluate(() => {
      riviera.profiling.start('build-frame-regression');
      riviera.profiling.experiment({ water: false, birds: false, boats: false });
      // Per-frame checks below retain AO, shadows and the GPU build animation.
      const canvas = document.querySelector('canvas');
      const crop = document.createElement('canvas');
      crop.width = 530;
      crop.height = 180;
      const ctx = crop.getContext('2d', { willReadFrequently: true });
      window.__capture = () => {
        if (!window.__record) return;
        // Unchanged roofs, facades and windows above the front harbour edit.
        ctx.drawImage(canvas, 230, 180, 530, 180, 0, 0, 530, 180);
        const pixels = ctx.getImageData(0, 0, 530, 180).data;
        const { architecture: a, camera } = window.__test;
        let changed = 0;
        if (window.__baseline) {
          for (let i = 0; i < pixels.length; i += 4) {
            const difference = Math.max(
              Math.abs(pixels[i] - __baseline[i]),
              Math.abs(pixels[i + 1] - __baseline[i + 1]),
              Math.abs(pixels[i + 2] - __baseline[i + 2]),
            );
            if (difference > 20) changed++;
          }
        } else {
          window.__baseline = pixels;
          window.__camera = camera.matrixWorld.elements.slice();
        }
        const moved = camera.matrixWorld.elements.some((v, i) => v !== __camera[i]);
        window.__frames.push({
          changed,
          moved,
          pending: a.pending,
          revision: a.appliedRevision,
          key: a.activeKey.value,
          age: a.clock.value - a.started.value,
        });
        if (changed > 4 && !window.__failure) window.__failure = crop.toDataURL();
      };
    });
    await page.waitForTimeout(1000);
    const initial = await page.evaluate(() => riviera.snapshot);
    const id = 82; // Front harbour foundation in the deterministic demo.
    assert.deepEqual(new Map(JSON.parse(initial).cells).get(id), [0]);
    const cases = [
      { name: 'add-house', level: 0, button: 'left', animation: true },
      { name: 'add-floor', level: 1, button: 'left', animation: true },
      { name: 'remove-floor', level: 2, button: 'right' },
      { name: 'undo', control: 'undo' },
      { name: 'redo', control: 'redo' },
      { name: 'remove-house', level: 1, button: 'right' },
    ];
    for (const action of cases) {
      const point = await page.evaluate(({ id, level }) => riviera.projectCell(id, level), {
        id,
        level: action.level ?? 0,
      });
      await page.mouse.move(point.x, point.y);
      await page.waitForTimeout(100);
      await page.evaluate(() => {
        window.__baseline = null;
        window.__failure = null;
        window.__frames = [];
        window.__record = true;
      });
      await page.waitForTimeout(80);
      const before = await page.evaluate(() => riviera.stats.appliedRevision);
      if (action.control) await page.locator('#' + action.control).click();
      else await page.mouse.click(point.x, point.y, { button: action.button });
      await page.evaluate(() => riviera.ready());
      await page.waitForTimeout(750);
      const result = await page.evaluate(() => {
        window.__record = false;
        return { frames: __frames, failure: __failure };
      });
      const committed = result.frames.filter((f) => f.revision > before);
      assert.ok(committed.length >= 10, 'must sample the commit and subsequent rendered frames');
      assert.ok(
        result.frames.some((f) => f.revision === before),
        'must sample before the edit',
      );
      assert.ok(
        result.frames.every((f) => !f.moved),
        'editing cannot move the camera',
      );
      if (action.animation) {
        assert.equal(committed[0].key, id * 32 + action.level + 1);
        assert.ok(committed[0].age < 0.12, 'animation starts with committed geometry');
      } else {
        assert.ok(
          committed.every((f) => f.key === -1),
          'removal/undo/redo cannot restart a build bounce',
        );
      }
      if (delay && action.name === 'add-house') {
        const pending = result.frames.filter((f) => f.pending);
        assert.ok(pending.length > 0);
        assert.ok(
          pending.every((f) => f.key === -1),
          'no animation before the first worker commit',
        );
      }
      const report = {
        delay,
        action: action.name,
        frames: result.frames.length,
        maxChangedPixels: Math.max(...result.frames.map((f) => f.changed)),
        firstCommitAge: committed[0].age,
      };
      reports.push(report);
      if (result.failure)
        await writeFile(
          'artifacts/build-frame-failure.png',
          Buffer.from(result.failure.split(',')[1], 'base64'),
        );
      assert.ok(report.maxChangedPixels <= 4, JSON.stringify(report));
    }
    assert.equal(await page.evaluate(() => riviera.snapshot), initial);
    const gpu = await page.evaluate(() => riviera.verifyGPUInstances());
    assert.ok(gpu.maxError < 2e-6);
    assert.deepEqual(errors, []);
    await page.close();
  }
  await writeFile('artifacts/build-frames.json', JSON.stringify(reports, null, 2));
  console.log(JSON.stringify({ passed: reports.length, reports }, null, 2));
} finally {
  await browser.close();
}
