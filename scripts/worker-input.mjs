import { chromium } from '@playwright/test';
import { makeGrid } from '../src/grid.js';
import { serialize } from '../src/state.js';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// Deliberately delay worker replies in this isolated test to exercise queued real clicks.
await page.addInitScript(() => {
  const NativeWorker = Worker;
  window.Worker = class extends NativeWorker {
    set onmessage(listener) {
      super.onmessage = (event) => setTimeout(() => listener(event), 200);
    }
  };
});
try {
  await page.goto(process.env.RIVIERA_URL || 'http://localhost:4173/Riviera/');
  await page.waitForFunction(() => window.riviera?.stats.fps > 0);
  const { cells } = makeGrid();
  const nearest = (x) =>
    cells.reduce((a, b) =>
      Math.hypot(a.center[0] - x, a.center[1]) < Math.hypot(b.center[0] - x, b.center[1]) ? a : b,
    );
  const ids = [nearest(-4).id, nearest(4).id],
    town = new Map(ids.map((id) => [id, [0]]));
  async function setup() {
    await page
      .locator('#file')
      .setInputFiles({
        name: 'queue.json',
        mimeType: 'application/json',
        buffer: Buffer.from(serialize(town)),
      });
    await page.evaluate(() => window.riviera.ready());
    await page.waitForTimeout(100);
    return page.evaluate((ids) => ids.map((id) => window.riviera.projectCell(id, 0)), ids);
  }
  let points = await setup();
  await page.mouse.click(points[0].x, points[0].y);
  assert.ok(await page.evaluate(() => window.riviera.stats.pending));
  await page.mouse.click(points[1].x, points[1].y);
  await page.waitForFunction(
    () => !window.riviera.stats.pending && window.riviera.stats.blocks === 4,
  );
  const built = new Map(JSON.parse(await page.evaluate(() => window.riviera.snapshot)).cells);
  for (const id of ids)
    assert.deepEqual(built.get(id), [0, 0], 'each queued click applies to its captured ray');
  points = await setup();
  await page.mouse.click(points[0].x, points[0].y);
  await page.mouse.click(points[1].x, points[1].y);
  await page.locator('#undo').click();
  await page.evaluate(() => window.riviera.ready());
  await page.waitForTimeout(500);
  assert.equal(
    await page.evaluate(() => window.riviera.snapshot),
    serialize(town),
    'undo cancels queued edits and superseded builds',
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: [
        'queued real clicks retain target and order',
        'undo cancels queued edits',
        'superseded worker replies cannot overwrite undo',
      ],
      errors,
    }),
  );
} finally {
  await browser.close();
}
