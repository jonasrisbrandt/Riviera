import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { makeGrid } from '../src/grid.js';
import { serialize } from '../src/state.js';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
try {
  await page.goto('http://localhost:5173');
  await page.waitForFunction(() => window.riviera);
  const { cells } = makeGrid(),
    center = cells.reduce((a, b) => (Math.hypot(...a.center) < Math.hypot(...b.center) ? a : b));
  const anchor = cells[center.neighbors[2]];
  async function fixture(town, name, zoom = -1000) {
    await page.locator('#settings').click();
    await page
      .locator('#file')
      .setInputFiles({
        name: 'test.json',
        mimeType: 'application/json',
        buffer: Buffer.from(serialize(town)),
      });
    await page.waitForTimeout(650);
    await page.locator('#settings-panel .close').click();
    await page.mouse.move(1050, 620);
    await page.mouse.wheel(0, zoom);
    await page.mouse.move(1300, 100);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `artifacts/${name}.png` });
    assert.equal(
      await page.evaluate(() => window.riviera.snapshot),
      serialize(town),
      'rebuilding must preserve the saved blocks',
    );
    return page.evaluate(() => window.riviera.stats);
  }
  const hanging = new Map([
    [anchor.id, [0, 3, 3, 3, 3]],
    [center.id, [null, null, null, null, 2]],
  ]);
  const overhang = await fixture(hanging, 'supported-cantilever');
  assert.equal(overhang.arches, 0);
  assert.ok(overhang.corbels > 0);
  const arcade = await fixture(new Map([[center.id, [0, null, 2]]]), 'grounded-arcade');
  assert.equal(arcade.arches, 4);
  await page.locator('#settings').click();
  await page.locator('#ao').uncheck();
  await page.locator('#settings-panel .close').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'artifacts/roof-no-ao.png' });
  await page.locator('#settings').click();
  await page.locator('#shadows').uncheck();
  await page.locator('#settings-panel .close').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'artifacts/roof-no-shadow.png' });
  await page.locator('#settings').click();
  await page.locator('#ao').check();
  await page.locator('#shadows').check();
  await page.locator('#settings-panel .close').click();
  const row = [center];
  for (let k = 0; k < 6; k++) {
    const previous = row.at(-1);
    const next = previous.neighbors
      .filter((n) => n >= 0 && !row.some((c) => c.id === n))
      .map((n) => cells[n])
      .sort(
        (a, b) =>
          b.center[0] -
          previous.center[0] -
          0.25 * Math.abs(b.center[1]) -
          (a.center[0] - previous.center[0]) +
          0.25 * Math.abs(a.center[1]),
      )[0];
    if (!next) break;
    row.push(next);
  }
  const rowTown = new Map(row.map((c, i) => [c.id, [0, [0, 4, 3, 1][i % 4]]]));
  const roofs = await fixture(rowTown, 'continuous-tiled-roof', -850);
  await page.mouse.move(1000, 600);
  await page.mouse.down();
  await page.mouse.move(1150, 670, { steps: 18 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'artifacts/continuous-tiled-roof-rotated.png' });
  assert.deepEqual(errors, []);
  const report = { overhang, arcade, roofs, errors };
  await writeFile('artifacts/roof-support-verification.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
