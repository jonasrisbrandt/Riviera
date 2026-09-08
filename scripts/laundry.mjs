import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { makeGrid } from '../src/grid.js';
import { serialize } from '../src/state.js';
import { mkdir, writeFile } from 'node:fs/promises';
const { cells } = makeGrid(),
  nearest = (x) =>
    cells.reduce((a, b) =>
      Math.hypot(a.center[0] - x, a.center[1]) < Math.hypot(b.center[0] - x, b.center[1]) ? a : b,
    );
const a = nearest(-3),
  b = nearest(3),
  town = new Map([
    [a.id, [0, 1, 1]],
    [b.id, [0, 2, 2]],
  ]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  results = [];
await mkdir('artifacts', { recursive: true });
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.addInitScript((json) => {
      if (!localStorage.getItem('riviera-town-v1')) localStorage.setItem('riviera-town-v1', json);
    }, serialize(town));
    await page.goto(process.env.RIVIERA_URL || 'http://localhost:4173/Riviera/');
    await page.waitForFunction(() => window.riviera?.stats.fps > 0);
    const ready = () => page.evaluate(() => riviera.ready()),
      snap = () => page.evaluate(() => riviera.snapshot);
    async function house(id) {
      const p = await page.evaluate((id) => riviera.projectCell(id, 2), id);
      if (mobile) await page.touchscreen.tap(p.x, p.y);
      else await page.mouse.click(p.x, p.y);
      await ready();
    }
    const tool = page.locator('#laundry-tool');
    await tool.click();
    const bounds = await tool.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= (mobile ? 390 : 1280));
    const before = await snap();
    await house(a.id);
    assert.equal(await snap(), before);
    const point = await page.evaluate((id) => riviera.projectCell(id, 2), b.id);
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(100);
    await page.screenshot({
      path: 'artifacts/laundry-preview-' + mobile + '.jpg',
      type: 'jpeg',
      quality: 90,
    });
    await house(b.id);
    const placed = await snap();
    assert.equal(JSON.parse(placed).clotheslines.length, 1);
    assert.equal(await page.evaluate(() => riviera.stats.clotheslines), 1);
    await page.locator('#undo').click();
    await ready();
    assert.equal(await snap(), before);
    await page.locator('#redo').click();
    await ready();
    assert.equal(await snap(), placed);
    await page.reload();
    await page.waitForFunction(() => window.riviera?.stats.fps > 0);
    assert.equal(await snap(), placed);
    assert.equal(await page.evaluate(() => riviera.stats.clotheslines), 1);
    await tool.click();
    await house(a.id);
    if (!mobile) await page.keyboard.press('Escape');
    else await house(a.id);
    assert.equal(await snap(), placed);
    await house(a.id);
    await house(b.id);
    assert.equal(await page.evaluate(() => riviera.stats.clotheslines), 0);
    await page.locator('#undo').click();
    await ready();
    assert.equal(await page.evaluate(() => riviera.stats.clotheslines), 1);
    if (!mobile) {
      await page.locator('#landscape').click();
      await house(a.id);
      assert.equal(JSON.parse(await snap()).clotheslines.length, 1);
      await page.locator('#build').click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: 'artifacts/laundry-manual.jpg', type: 'jpeg', quality: 90 });
    }
    results.push(
      (mobile ? 'mobile' : 'desktop') +
        ': two houses, preview, placement, cancel, remove, undo/redo and reload',
    );
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ results, errors }, null, 2));
  await writeFile('artifacts/laundry-tests.json', JSON.stringify({ results, errors }, null, 2));
} finally {
  await browser.close();
}
