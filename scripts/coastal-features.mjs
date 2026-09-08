import { chromium } from '@playwright/test';
import { makeGrid } from '../src/grid.js';
import { serialize } from '../src/state.js';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { cells } = makeGrid(),
  center = cells.reduce((a, b) => (Math.hypot(...a.center) < Math.hypot(...b.center) ? a : b));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
await mkdir('artifacts', { recursive: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [],
  results = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
try {
  await page.goto(process.env.RIVIERA_URL || 'http://localhost:5173/');
  await page.waitForFunction(() => window.riviera?.stats.fps > 0);
  const ready = () => page.evaluate(() => riviera.ready()),
    data = async () => JSON.parse(await page.evaluate(() => riviera.snapshot));
  const demoStats = await page.evaluate(() => riviera.stats);
  assert.ok(demoStats.lighthouses > 0 && demoStats.parasols > 0 && demoStats.clotheslines > 0);
  results.push('demo has lighthouses, parasols and clotheslines');
  await page.locator('#landscape').click();
  async function load(town) {
    await page
      .locator('#file')
      .setInputFiles({
        name: 'coast.json',
        mimeType: 'application/json',
        buffer: Buffer.from(serialize(town)),
      });
    await ready();
    await page.waitForTimeout(100);
  }
  const neighbor = cells[center.neighbors[0]];
  const town = new Map();
  town.terrain = new Map([
    [center.id, [1, 1]],
    [neighbor.id, [0.5, 1]],
  ]);
  await load(town);
  await page.locator('#slope').click();
  let point = await page.evaluate((id) => riviera.projectTerrain(id), center.id);
  await page.mouse.click(point.x, point.y);
  await ready();
  assert.deepEqual(new Map((await data()).terrain).get(center.id), [1, 1, 0]);
  await page.screenshot({ path: 'artifacts/terrain-ramp.jpg', type: 'jpeg', quality: 90 });
  await page.locator('#undo').click();
  await ready();
  assert.deepEqual(new Map((await data()).terrain).get(center.id), [1, 1]);
  await page.locator('#redo').click();
  await ready();
  assert.deepEqual(new Map((await data()).terrain).get(center.id), [1, 1, 0]);
  await page.locator('#build').click();
  point = await page.evaluate((id) => riviera.projectTerrain(id), center.id);
  await page.mouse.click(point.x, point.y);
  await ready();
  assert.deepEqual(new Map((await data()).terrain).get(center.id), [1, 1]);
  assert.equal(new Map((await data()).cells).get(center.id).length, 2);
  results.push('ramp creation, undo/redo and flat house foundation');
  // Click the cliff itself, looking into the empty cell in front of it.
  const edge = center.points
    .map((a, e) => {
      const b = center.points[(e + 1) % 4];
      return { e, dot: (b[1] - a[1]) * 72 - (b[0] - a[0]) * 100 };
    })
    .sort((a, b) => b.dot - a.dot)[0].e;
  const hole = center.neighbors[edge];
  const cliff = new Map();
  cliff.terrain = new Map([[center.id, [2, 1]]]);
  await load(cliff);
  await page.locator('#landscape').click();
  await page.locator('#raise').click();
  point = await page.evaluate(({ id, edge }) => riviera.projectFace(id, -1, edge), {
    id: center.id,
    edge,
  });
  await page.mouse.click(point.x, point.y);
  await ready();
  assert.equal(new Map((await data()).terrain).get(hole)?.[0], 0.5, 'cliff clicks grow the hole');
  assert.equal(new Map((await data()).terrain).get(center.id)[0], 2, 'cliff itself is unchanged');
  results.push('clicking a cliff face fills the hole in front of it');
  await page.locator('#lower').click();
  await page.mouse.click(point.x, point.y);
  await ready();
  assert.equal(
    new Map((await data()).terrain).get(center.id)[0],
    1.5,
    'lower still lowers the hit cliff',
  );
  results.push('lower tool keeps the actual hit surface');
  await page.evaluate(() => document.getElementById('landscape-demo').click());
  await ready();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'artifacts/coastal-features.jpg', type: 'jpeg', quality: 90 });
  assert.deepEqual(errors, []);
  const report = { results, errors, stats: await page.evaluate(() => riviera.stats) };
  await writeFile('artifacts/coastal-features.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
