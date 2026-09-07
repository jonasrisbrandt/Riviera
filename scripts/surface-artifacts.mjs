import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { PNG } from '../node_modules/playwright-core/lib/utilsBundle.js';
import { makeGrid } from '../src/grid.js';
import { serialize } from '../src/state.js';
const name = process.env.CAPTURE_NAME || 'surface-fixed';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
try {
  await page.goto('http://localhost:5173');
  await page.waitForFunction(() => window.riviera?.stats.fps > 0);
  const original = await page.evaluate(() => window.riviera.snapshot);
  const profiles = [];
  async function capture(label) {
    await page.mouse.move(30, 180);
    await page.waitForTimeout(650);
    const bytes = await page.screenshot({ path: `artifacts/${name}-${label}.png` });
    const png = PNG.sync.read(bytes),
      rows = [];
    for (let y = 700; y < 890; y++) {
      let sum = 0;
      for (let x = 180; x < 550; x++) {
        const i = (y * png.width + x) * 4;
        sum += (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3;
      }
      rows.push(sum / 370);
    }
    let sum = 0,
      sum2 = 0,
      count = 0;
    for (let y = 650; y < 880; y++)
      for (let x = 150; x < 340; x++) {
        const i = (y * png.width + x) * 4,
          v = (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3;
        sum += v;
        sum2 += v * v;
        count++;
      }
    const waterContrast = Math.sqrt(sum2 / count - (sum / count) ** 2);
    if (label === 'sun-0')
      assert.ok(waterContrast < 1, 'parallel water bands return near the sun reflection');
    profiles.push({ label, waterContrast, rows });
  }
  await page.keyboard.press('h');
  await page.waitForTimeout(600);
  for (let angle = 0; angle < 4; angle++) {
    await page.mouse.move(1050, 580);
    await page.mouse.down();
    await page.mouse.move(800, 580 + (angle === 0 ? 30 : 0), { steps: 20 });
    await page.mouse.up();
    await capture(`sun-${angle}`);
    await page.locator('#settings').click();
    await page.locator('#ao').uncheck();
    await page.locator('#shadows').uncheck();
    await page.locator('#settings-panel .close').click();
    await capture(`sun-${angle}-unoccluded`);
    await page.locator('#settings').click();
    await page.locator('#ao').check();
    await page.locator('#shadows').check();
    await page.locator('#settings-panel .close').click();
  }
  for (const [label, dy] of [
    ['default', 0],
    ['low', -65],
    ['grazing', -60],
    ['high', 220],
  ]) {
    if (dy) {
      await page.mouse.move(1040, 580);
      await page.mouse.down();
      await page.mouse.move(1040, 580 + dy, { steps: 18 });
      await page.mouse.up();
    }
    await capture(label);
    if (label === 'low' || label === 'grazing') {
      await page.locator('#settings').click();
      await page.locator('#ao').uncheck();
      await page.locator('#settings-panel .close').click();
      await capture(`${label}-no-ao`);
      await page.locator('#settings').click();
      await page.locator('#shadows').uncheck();
      await page.locator('#settings-panel .close').click();
      await capture(`${label}-no-ao-shadow`);
      await page.locator('#settings').click();
      await page.locator('#ao').check();
      await page.locator('#shadows').check();
      await page.locator('#settings-panel .close').click();
    }
  }
  assert.equal(await page.evaluate(() => window.riviera.snapshot), original);
  const { cells } = makeGrid(),
    c = cells.reduce((a, b) => (Math.hypot(...a.center) < Math.hypot(...b.center) ? a : b));
  const fixture = serialize(
    new Map([
      [c.id, [0, 2]],
      [c.neighbors[2], [0, 0, 0]],
    ]),
  );
  await page.locator('#settings').click();
  await page
    .locator('#file')
    .setInputFiles({
      name: 'ridge-fixture.json',
      mimeType: 'application/json',
      buffer: Buffer.from(fixture),
    });
  await page.locator('#settings-panel .close').click();
  await page.mouse.move(1040, 650);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -800);
    await page.waitForTimeout(150);
  }
  await capture('roof-close');
  for (let i = 0; i < 2; i++) {
    await page.mouse.move(1040, 580);
    await page.mouse.down();
    await page.mouse.move(1210, 560, { steps: 18 });
    await page.mouse.up();
    await capture(`roof-close-${i}`);
  }
  assert.equal(await page.evaluate(() => window.riviera.snapshot), fixture);
  assert.deepEqual(errors, []);
  await writeFile(`artifacts/${name}.json`, JSON.stringify({ errors, profiles }, null, 2));
  console.log(JSON.stringify({ errors, captures: profiles.map((p) => p.label) }));
} finally {
  await browser.close();
}
