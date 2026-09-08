import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
await mkdir('artifacts', { recursive: true });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const ready = () => page.evaluate(() => riviera.ready());
  const snapshot = () => page.evaluate(() => riviera.snapshot);
  const data = async () => JSON.parse(await snapshot());
  if (process.env.WORKER_DELAY)
    await page.addInitScript((delay) => {
      const NativeWorker = Worker;
      window.Worker = class extends NativeWorker {
        set onmessage(listener) {
          super.onmessage = (event) => setTimeout(() => listener(event), delay);
        }
      };
    }, Number(process.env.WORKER_DELAY));
  await page.goto(process.env.RIVIERA_URL || 'http://localhost:5173/');
  await page.waitForFunction(() => window.riviera?.stats.fps > 0);
  await page.waitForTimeout(3000);
  assert.ok((await data()).terrain.length > 100);
  await page.locator('#landscape').click();
  await page.screenshot({ path: 'artifacts/landscape-desktop.png' });
  results.push('landscape demo: real WebGPU terrain, buildings and automatic stairs');
  async function clear() {
    await page.evaluate(() => document.getElementById('new').click());
    await ready();
  }
  const id = await page.evaluate(
    () =>
      riviera.cells.reduce((a, b) => (Math.hypot(...a.center) < Math.hypot(...b.center) ? a : b))
        .id,
  );
  async function terrainClick(button = 'left') {
    const p = await page.evaluate((id) => riviera.projectTerrain(id), id);
    await page.mouse.click(p.x, p.y, { button });
    await ready();
    await page.waitForTimeout(30);
  }
  async function roofClick(level, button = 'left') {
    const p = await page.evaluate(({ id, level }) => riviera.projectCell(id, level), { id, level });
    await page.mouse.click(p.x, p.y, { button });
    await ready();
    await page.waitForTimeout(80);
  }
  await clear();
  await terrainClick();
  await terrainClick();
  assert.deepEqual(new Map((await data()).terrain).get(id), [1, 0]);
  await page.locator('#build').click();
  await terrainClick();
  assert.deepEqual(new Map((await data()).cells).get(id), [0, 0]);
  await page.locator('#landscape').click();
  await roofClick(1);
  assert.deepEqual(new Map((await data()).terrain).get(id), [1.5, 0]);
  assert.deepEqual(new Map((await data()).cells).get(id), [0, 0]);
  await roofClick(1, 'right');
  assert.deepEqual(new Map((await data()).terrain).get(id), [1, 0]);
  results.push('raise/lower beneath a house preserves its storeys');
  await page.locator('#paint').click();
  await page.getByRole('button', { name: 'Sand', exact: true }).click();
  await roofClick(1);
  assert.deepEqual(new Map((await data()).terrain).get(id), [1, 4]);
  const painted = await snapshot();
  await page.locator('#undo').click();
  await ready();
  assert.deepEqual(new Map((await data()).terrain).get(id), [1, 0]);
  await page.locator('#redo').click();
  await ready();
  assert.equal(await snapshot(), painted);
  await page.reload();
  await page.waitForFunction(() => window.riviera?.stats.fps > 0);
  assert.equal(await snapshot(), painted);
  results.push('material painting, undo/redo and autosave round-trip');
  await page.locator('#landscape').click();
  await page.locator('#lower').click();
  await roofClick(1);
  await roofClick(1);
  assert.ok(!(await data()).terrain);
  assert.deepEqual(new Map((await data()).cells).get(id), [0, 0]);
  results.push('land returns to water and the house is retained');
  await clear();
  await page.locator('#landscape').click();
  const strokePoints = await page.evaluate(() => {
    const nearest = (x) =>
      riviera.cells.reduce((a, b) =>
        Math.hypot(a.center[0] - x, a.center[1]) < Math.hypot(b.center[0] - x, b.center[1]) ? a : b,
      );
    return [-4, -2, 0, 2, 4].map((x) => riviera.projectTerrain(nearest(x).id));
  });
  const before = await snapshot(),
    history = await page.evaluate(() => riviera.stats.history);
  await page.mouse.move(strokePoints[0].x, strokePoints[0].y);
  await page.mouse.down();
  for (const p of strokePoints) {
    await page.mouse.move(p.x, p.y, { steps: 5 });
    await ready();
  }
  await page.mouse.up();
  await ready();
  await page.waitForTimeout(200);
  assert.ok((await data()).terrain.length >= 4);
  assert.equal(await page.evaluate(() => riviera.stats.history), history + 1);
  const after = await snapshot();
  await page.locator('#undo').click();
  await ready();
  assert.equal(await snapshot(), before);
  await page.locator('#redo').click();
  await ready();
  assert.equal(await snapshot(), after);
  results.push('drag sculpts multiple cells as one undoable operation');
  const exported = page.waitForEvent('download');
  await page.evaluate(() => document.getElementById('export').click());
  const download = await exported,
    stream = await download.createReadStream(),
    chunks = [];
  for await (const c of stream) chunks.push(c);
  const save = Buffer.concat(chunks);
  await clear();
  await page
    .locator('#file')
    .setInputFiles({ name: 'landscape.json', mimeType: 'application/json', buffer: save });
  await ready();
  assert.equal(await snapshot(), after);
  results.push('JSON export/import retains complete landscape');
  const gpu = await page.evaluate(() => riviera.verifyGPUInstances());
  assert.ok(gpu.maxError < 2e-6);
  assert.deepEqual(errors, []);
  await page.close();

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  await mobile.goto(process.env.RIVIERA_URL || 'http://localhost:5173/');
  await mobile.waitForFunction(() => window.riviera?.stats.fps > 0);
  await mobile.locator('#landscape').tap();
  await mobile.waitForTimeout(3000);
  await mobile.screenshot({ path: 'artifacts/landscape-mobile.png' });
  for (const selector of ['#landscape', '#raise', '#lower', '#paint', '#smooth', '#slope']) {
    const box = await mobile.locator(selector).boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844);
  }
  await mobile.evaluate(() => document.getElementById('new').click());
  await mobile.evaluate(() => riviera.ready());
  let p = await mobile.evaluate((id) => riviera.projectTerrain(id), id);
  await mobile.touchscreen.tap(p.x, p.y);
  await mobile.evaluate(() => riviera.ready());
  assert.equal(JSON.parse(await mobile.evaluate(() => riviera.snapshot)).terrain.length, 1);
  const beforePinch = await mobile.evaluate(() => riviera.snapshot);
  const cdp = await mobile.context().newCDPSession(mobile);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: 130, y: 350 },
      { x: 240, y: 400 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: 95, y: 320 },
      { x: 275, y: 440 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mobile.waitForTimeout(400);
  assert.equal(await mobile.evaluate(() => riviera.snapshot), beforePinch);
  results.push('mobile controls fit, tap sculpts and two fingers do not edit terrain');
  await mobile.close();
  await writeFile('artifacts/landscape-tests.json', JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ passed: results.length, results, errors }, null, 2));
} finally {
  await browser.close();
}
