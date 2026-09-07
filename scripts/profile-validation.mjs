// Independent controls: profiling-off resource growth, CPU measurement overhead.
import { chromium } from '@playwright/test';
import { makeGrid } from '../src/grid.js';
import { serialize } from '../src/state.js';
import { summarize } from '../src/profiler.js';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const base = process.env.RIVIERA_URL || 'http://localhost:4173/Riviera/';
const report = { errors: [], memory: [], overhead: [] };
async function open() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => report.errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text());
  });
  await page.goto(base);
  await page.waitForFunction(() => window.riviera?.stats.fps > 0);
  await page.waitForTimeout(1000);
  return page;
}
async function seedEdit(page) {
  const target = await page.evaluate(
    () =>
      JSON.parse(window.riviera.snapshot)
        .cells.filter(([, l]) => l.length > 1)
        .map(([id, l]) => window.riviera.projectCell(id, l.length - 1))
        .filter((p) => p.x > 100 && p.x < 1340 && p.y > 100 && p.y < 840)
        .sort((a, b) => b.y - a.y)[0],
  );
  const before = await page.evaluate(() => window.riviera.stats.blocks);
  await page.mouse.click(target.x, target.y);
  await page.evaluate(() => window.riviera.ready());
  assert.equal(await page.evaluate(() => window.riviera.stats.blocks), before + 1);
  await page.waitForTimeout(800);
}
try {
  const page = await open();
  const cdp = await page.context().newCDPSession(page);
  const large = new Map();
  for (const c of makeGrid().cells)
    if (Math.hypot(...c.center) < 18) {
      const levels = [0];
      if (c.id % 7 !== 0) for (let y = 1; y < 3 + (c.id % 4); y++) levels.push(c.id % 12);
      large.set(c.id, levels);
    }
  await page.locator('#file').setInputFiles({
    name: 'large.json',
    mimeType: 'application/json',
    buffer: Buffer.from(serialize(large)),
  });
  await page.waitForFunction(() => window.riviera.stats.cells === 496);
  await page.waitForTimeout(1200);
  const memory = async (label) => {
    const sample = await page.evaluate(() => window.riviera.profiling.snapshot());
    assert.equal(sample.enabled, false);
    assert.equal(sample.gpuFrames, 0);
    report.memory.push({
      label,
      town: sample.town,
      renderer: sample.environment.memory,
      jsHeap: await cdp.send('Runtime.getHeapUsage'),
    });
    console.log(label, (sample.environment.memory.total / 1048576).toFixed(1), 'MiB');
  };
  await memory('large-before');
  await seedEdit(page);
  const edited = await page.evaluate(() => window.riviera.snapshot);
  for (let i = 0; i < 10; i++) {
    await page.locator('#undo').click();
    await page.evaluate(() => window.riviera.ready());
    await page.waitForTimeout(100);
    await page.locator('#redo').click();
    await page.evaluate(() => window.riviera.ready());
    await page.waitForTimeout(100);
    if (i === 4 || i === 9) await memory('large-after-' + (i + 1) * 2 + '-rebuilds');
  }
  assert.equal(await page.evaluate(() => window.riviera.snapshot), edited);
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(1200);
  await memory('large-after-GC');
  await page.close();

  const small = await open();
  await seedEdit(small);
  // Alternate order to reduce warmup/drift bias. Timed outside profiler scopes.
  for (const enabled of [false, true, true, false, false, true]) {
    if (enabled) await small.evaluate(() => window.riviera.profiling.start('overhead'));
    else await small.evaluate(() => window.riviera.profiling.stop());
    const samples = [];
    for (let i = 0; i < 5; i++) {
      samples.push(
        await small.evaluate(async () => {
          const t = performance.now();
          document.getElementById('undo').click();
          await window.riviera.ready();
          document.getElementById('redo').click();
          await window.riviera.ready();
          return performance.now() - t;
        }),
      );
      await small.waitForTimeout(120);
    }
    report.overhead.push({ enabled, samples, stats: summarize(samples) });
    console.log('undo+redo', enabled, summarize(samples).p50.toFixed(1), 'ms');
  }
  await small.close();
  assert.deepEqual(report.errors, []);
  await writeFile('artifacts/performance-controls.json', JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
