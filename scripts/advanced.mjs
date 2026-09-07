import { chromium } from '@playwright/test';
import { makeGrid } from '../src/grid.js';
import { serialize } from '../src/state.js';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
try {
  await page.goto('http://localhost:5173');
  await page.waitForFunction(() => window.riviera?.stats.fps > 0);
  const { cells } = makeGrid();
  const cell = cells.reduce((a, b) => (Math.hypot(...a.center) < Math.hypot(...b.center) ? a : b));
  const edge = cell.points
    .map((a, e) => {
      const b = cell.points[(e + 1) % 4];
      return { e, score: (b[1] - a[1]) * 18 - (b[0] - a[0]) * 25 };
    })
    .sort((a, b) => b.score - a.score)[0].e;
  const sparse = new Map([[cell.id, [0, 2, 2, 2]]]);
  async function importTown(town) {
    await page.locator('#settings').click();
    await page.locator('#file').setInputFiles({
      name: 'test.json',
      mimeType: 'application/json',
      buffer: Buffer.from(serialize(town)),
    });
    await page.waitForTimeout(600);
    await page.locator('#settings-panel .close').click();
    await page.waitForTimeout(300);
  }
  await importTown(sparse);
  let p = await page.evaluate(({ id, edge }) => window.riviera.projectFace(id, 2, edge), {
    id: cell.id,
    edge,
  });
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(800);
  let result = new Map(JSON.parse(await page.evaluate(() => window.riviera.snapshot)).cells);
  assert.deepEqual(
    result.get(cell.neighbors[edge]),
    [null, null, 0],
    'clicking a wall creates a neighboring elevated block',
  );
  const cantileverStats = await page.evaluate(() => window.riviera.stats);
  assert.equal(cantileverStats.arches, 0, 'a side extension must not grow dangling arch legs');
  assert.ok(cantileverStats.corbels > 0, 'a side extension is bracketed into its supporting wall');
  await page.mouse.move(1200, 600);
  await page.mouse.wheel(0, -700);
  await page.waitForTimeout(1100);
  await page.screenshot({ path: 'artifacts/arch-on.png' });
  await page.locator('#settings').click();
  await page.locator('#ao').uncheck();
  await page.locator('#settings-panel .close').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'artifacts/arch-no-ao.png' });
  await page.locator('#settings').click();
  await page.locator('#ao').check();
  await page.locator('#settings-panel .close').click();
  await importTown(sparse);
  await page.waitForTimeout(600);
  p = await page.evaluate(({ id, edge }) => window.riviera.projectFace(id, 1, edge), {
    id: cell.id,
    edge,
  });
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.waitForTimeout(600);
  result = new Map(JSON.parse(await page.evaluate(() => window.riviera.snapshot)).cells);
  assert.equal(result.get(cell.id)[1], null, 'removing a lower floor preserves upper floors');
  assert.equal(result.get(cell.id)[3], 2);
  const large = new Map();
  for (const c of cells)
    if (Math.hypot(...c.center) < 18) {
      const levels = [0];
      if (c.id % 7 !== 0) for (let y = 1; y < 3 + (c.id % 4); y++) levels.push(c.id % 12);
      large.set(c.id, levels);
    }
  await importTown(large);
  await page.waitForTimeout(4000);
  const largeStats = await page.evaluate(() => window.riviera.stats);
  await page.screenshot({ path: 'artifacts/large-town.png' });
  assert.equal(largeStats.cells, large.size);
  assert.ok(largeStats.draws <= largeStats.chunks * 6);
  assert.ok(largeStats.draws < 120, 'bounded chunk draw count');
  assert.deepEqual(errors, []);
  const report = {
    passed: [
      'side building at correct level',
      'sparse elevated blocks',
      'wall-supported corbels without dangling arches',
      'lower-floor removal preserves upper floors',
      'AO on/off visual capture',
      'large-town render',
    ],
    largeStats,
    errors,
  };
  await writeFile('artifacts/advanced-verification.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
