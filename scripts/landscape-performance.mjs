import { chromium } from '@playwright/test';
import { makeGrid } from '../src/grid.js';
import { serialize } from '../src/state.js';
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [],
  captures = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
try {
  await page.goto(process.env.RIVIERA_URL || 'http://localhost:4173/Riviera/');
  await page.waitForFunction(() => window.riviera?.stats.fps > 0);
  const ready = () => page.evaluate(() => riviera.ready());
  const frame = () => page.evaluate(() => new Promise(requestAnimationFrame));
  for (const scenario of ['demo', 'large']) {
    if (scenario === 'large') {
      const town = new Map();
      town.terrain = new Map();
      for (const c of makeGrid().cells) {
        const r = Math.hypot(...c.center);
        if (r >= 18) continue;
        town.terrain.set(c.id, [Math.max(1, Math.floor(8 - r * 0.35)), c.id % 13 === 0 ? 2 : 0]);
        if (c.id % 5 === 0) town.set(c.id, [0, 1, 1, 1]);
      }
      await page
        .locator('#file')
        .setInputFiles({
          name: 'large-landscape.json',
          mimeType: 'application/json',
          buffer: Buffer.from(serialize(town)),
        });
      await ready();
    }
    await page.waitForTimeout(1200);
    await page.evaluate((label) => riviera.profiling.start(label), scenario + '-idle');
    await page.waitForTimeout(3000);
    captures.push(
      await page.evaluate(async () => {
        await riviera.profiling.stop();
        return riviera.profiling.snapshot();
      }),
    );
    await page.locator('#landscape').click();
    const point = await page.evaluate(() => {
      const state = JSON.parse(riviera.snapshot),
        heights = new Map(state.terrain);
      return state.cells
        .filter(([id]) => heights.has(id))
        .map(([id, l]) => riviera.projectCell(id, l.length - 1))
        .filter((p) => p.x > 150 && p.x < 1280 && p.y > 170 && p.y < 800)
        .sort((a, b) => b.y - a.y)[0];
    });
    await page.mouse.click(point.x, point.y);
    await ready();
    await frame();
    const memory = [];
    await page.evaluate((label) => riviera.profiling.start(label), scenario + '-sculpt');
    for (let i = 0; i < 30; i++) {
      await page.locator('#undo').click();
      await ready();
      await frame();
      await page.locator('#redo').click();
      await ready();
      await frame();
      if ([5, 15, 29].includes(i))
        memory.push(await page.evaluate(() => riviera.profiling.snapshot().environment.memory));
    }
    const result = await page.evaluate(async () => {
      await riviera.profiling.stop();
      return riviera.profiling.snapshot();
    });
    result.memoryCycles = memory;
    captures.push(result);
    assert.ok(memory[2].total <= memory[0].total * 1.01, 'landscape resources plateau');
    const gpu = await page.evaluate(() => riviera.verifyGPUInstances());
    assert.ok(gpu.maxError < 2e-6);
    console.log(
      JSON.stringify({
        scenario,
        town: result.town,
        metrics: Object.fromEntries(
          Object.entries(result.metrics).filter(([k]) =>
            [
              'cpu.frame',
              'worker.cpu.build.terrain',
              'async.build.latency',
              'cpu.build.apply',
              'gpu.passSum',
            ].includes(k),
          ),
        ),
        memoryMiB: memory.map((m) => m.total / 1048576),
        gpu,
      }),
    );
  }
  await page.evaluate(() => document.getElementById('new').click());
  await ready();
  await frame();
  assert.ok(
    (await page.evaluate(() => riviera.profiling.snapshot().environment.memory)).attributesSize <
      1048576,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    'artifacts/landscape-performance.json',
    JSON.stringify({ captures, errors }, null, 2),
  );
} finally {
  await browser.close();
}
