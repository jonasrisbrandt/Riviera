import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
// Reuse Playwright's bundled PNG decoder for the pixel regression checks.
import { PNG } from '../node_modules/playwright-core/lib/utilsBundle.js';
const name = process.env.CAPTURE_NAME || 'overlays';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (e) => {
  errors.push(e.message);
  console.log(e.message);
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    errors.push(m.text());
    console.log(m.text());
  }
});
try {
  await page.goto('http://localhost:5173');
  await page.waitForFunction(
    () => window.riviera || !document.getElementById('fatal').classList.contains('hidden'),
  );
  if (!(await page.evaluate(() => !!window.riviera)))
    throw new Error(await page.locator('#fatal').textContent());
  await page.waitForTimeout(2200);
  await page.locator('#settings').click();
  await page.locator('#grid').check();
  await page.locator('#settings-panel .close').click();
  await page.mouse.move(1110, 730);
  await page.waitForTimeout(600);
  const screenshot = await page.screenshot({ path: `artifacts/${name}-grid-cursor-ao.png` });
  const pixels = PNG.sync.read(screenshot);
  function darkPixels(x0, y0, x1, y1) {
    let count = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * pixels.width + x) * 4;
        if ((pixels.data[i] + pixels.data[i + 1] + pixels.data[i + 2]) / 3 < 145) count++;
      }
    return count;
  }
  // Both regions are open sea in the deterministic demo. White grid strokes
  // and the translucent cursor must not introduce black AO speckles there.
  const gridDarkPixels = darkPixels(200, 110, 1200, 215);
  const cursorDarkPixels = darkPixels(1070, 684, 1135, 750);
  assert.equal(gridDarkPixels, 0, 'grid creates false AO on open water');
  assert.equal(cursorDarkPixels, 0, 'cursor creates false AO on open water');
  const original = await page.evaluate(() => window.riviera.snapshot);
  await page.locator('#settings').click();
  await page.locator('#ao').uncheck();
  await page.locator('#settings-panel .close').click();
  await page.mouse.move(1110, 730);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `artifacts/${name}-grid-cursor-no-ao.png` });
  await page.locator('#settings').click();
  await page.locator('#ao').check();
  await page.locator('#settings-panel .close').click();
  await page.locator('#erase').click();
  const target = await page.evaluate(() => {
    const all = window.riviera.cells;
    const [id, levels] = JSON.parse(window.riviera.snapshot)
      .cells.filter(([, l]) => l.length > 1)
      .sort((a, b) => {
        const ac = all[a[0]].center,
          bc = all[b[0]].center;
        return bc[0] * 0.58 + bc[1] * 0.8 - ac[0] * 0.58 - ac[1] * 0.8;
      })[0];
    return window.riviera.projectCell(id, levels.length - 1);
  });
  await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `artifacts/${name}-erase.png` });
  await page.mouse.move(950, 650);
  await page.mouse.down();
  await page.mouse.move(1150, 690, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `artifacts/${name}-rotated.png` });
  assert.equal(
    await page.evaluate(() => window.riviera.snapshot),
    original,
    'hover/orbit must not edit the town',
  );
  assert.deepEqual(errors, []);
  const report = {
    errors,
    gridDarkPixels,
    cursorDarkPixels,
    stats: await page.evaluate(() => window.riviera.stats),
  };
  await writeFile(`artifacts/${name}-verification.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
