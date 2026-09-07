import { chromium } from '@playwright/test';
import { makeGrid } from '../src/grid.js';
import { serialize } from '../src/state.js';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [],
  memory = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const ready = () => page.evaluate(() => window.riviera.ready());
try {
  await page.goto(process.env.RIVIERA_URL || 'http://localhost:4173/Riviera/');
  await page.waitForFunction(() => window.riviera?.stats.fps > 0);
  const initial = await page.evaluate(() => window.riviera.snapshot);
  // A superseded import must not replace a newer empty town, even across chunk boundaries.
  const large = new Map();
  for (const c of makeGrid().cells)
    if (Math.hypot(...c.center) < 18) {
      const levels = [0];
      if (c.id % 7 !== 0) for (let y = 1; y < 3 + (c.id % 4); y++) levels.push(c.id % 12);
      large.set(c.id, levels);
    }
  async function load(town) {
    await page.locator('#file').setInputFiles({
      name: 'test.json',
      mimeType: 'application/json',
      buffer: Buffer.from(serialize(town)),
    });
  }
  await load(large);
  await page.waitForFunction(() => window.riviera.stats.cells === 496);
  await page.evaluate(() => document.getElementById('new').click());
  await ready();
  assert.equal(await page.evaluate(() => window.riviera.stats.cells), 0);
  assert.equal(await page.evaluate(() => window.riviera.stats.draws), 0);
  await page.evaluate(() => document.getElementById('undo').click());
  await ready();
  assert.equal(await page.evaluate(() => window.riviera.stats.cells), 496);
  const gpu = await page.evaluate(() => window.riviera.verifyGPUInstances());
  assert.equal(gpu.count, 52111);
  assert.ok(gpu.maxError < 2e-6);
  // Seed one real edit, then repeat the exact same pair 100 times.
  const target = await page.evaluate(
    () =>
      JSON.parse(window.riviera.snapshot)
        .cells.filter(([, l]) => l.length > 1)
        .map(([id, l]) => window.riviera.projectCell(id, l.length - 1))
        .filter((p) => p.x > 100 && p.x < 1340 && p.y > 100 && p.y < 840)
        .sort((a, b) => b.y - a.y)[0],
  );
  await page.mouse.click(target.x, target.y);
  await ready();
  const edited = await page.evaluate(() => window.riviera.snapshot);
  const sample = async (label) => {
    await page.waitForTimeout(50);
    const m = await page.evaluate(() => window.riviera.profiling.snapshot());
    memory.push({ label, resources: m.environment.memory });
    console.log(label, (m.environment.memory.total / 1048576).toFixed(1) + ' MiB');
  };
  await sample('before-cycles');
  for (let i = 0; i < 100; i++) {
    await page.evaluate(() => document.getElementById('undo').click());
    await ready();
    await page.evaluate(() => document.getElementById('redo').click());
    await ready();
    // Render/dispatch at least one frame before a possible next resize/disposal.
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    if ([9, 49, 99].includes(i)) await sample('after-' + (i + 1) + '-cycles');
  }
  assert.equal(await page.evaluate(() => window.riviera.snapshot), edited);
  const gpuAfterCycles = await page.evaluate(() => window.riviera.verifyGPUInstances());
  assert.ok(
    gpuAfterCycles.maxError < 2e-6,
    'reused GPU buffers retain correct matrices after 100 cycles',
  );
  assert.equal(gpuAfterCycles.count, await page.evaluate(() => window.riviera.stats.instances));
  const warm = memory[1].resources,
    last = memory.at(-1).resources;
  assert.equal(last.attributes, warm.attributes);
  assert.equal(last.uniformBuffers, warm.uniformBuffers);
  assert.ok(last.total <= warm.total * 1.01, 'resource allocation plateaus after warmup');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await sample('after-GC');
  await page.screenshot({ path: 'artifacts/optimized-large.png' });
  // Shrinking and removing entire chunks releases all material variants and compute buffers.
  await page.evaluate(() => document.getElementById('new').click());
  await ready();
  await sample('empty');
  assert.ok(memory.at(-1).resources.attributesSize < 1048576);
  await load(new Map(JSON.parse(initial).cells));
  await ready();
  await page.screenshot({ path: 'artifacts/optimized-demo.png' });
  assert.deepEqual(errors, []);
  await writeFile(
    'artifacts/optimized-check.json',
    JSON.stringify(
      {
        gpu,
        gpuAfterCycles,
        memory,
        errors,
        passed: [
          'superseded worker replies',
          'empty chunks',
          'undo import',
          'GPU matrix equivalence',
          '100 build/undo cycles',
          'resource plateau',
          'release all world buffers',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
