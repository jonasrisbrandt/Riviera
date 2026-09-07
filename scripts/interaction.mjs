import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  acceptDownloads: true,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
try {
  await page.goto(process.env.RIVIERA_URL || 'http://localhost:5173');
  await page.waitForFunction(() => window.riviera?.stats.fps > 0);
  await page.waitForTimeout(2000);
  const initial = await page.evaluate(() => window.riviera.snapshot);
  assert.equal((await page.evaluate(() => window.riviera.stats)).backend, 'WebGPU');
  await page.screenshot({ path: 'artifacts/harbour.png' });
  await page.locator('#settings').click();
  await page.locator('#new').click();
  assert.equal((await page.evaluate(() => window.riviera.stats)).cells, 0);
  const cell = await page.evaluate(() =>
    window.riviera.cells.reduce((a, b) =>
      Math.hypot(...a.center) < Math.hypot(...b.center) ? a : b,
    ),
  );
  async function clickCell(level = 0, button = 'left') {
    const p = await page.evaluate(({ id, level }) => window.riviera.projectCell(id, level), {
      id: cell.id,
      level,
    });
    await page.mouse.click(p.x, p.y, { button });
    await page.waitForTimeout(350);
    console.log(level, p, await page.evaluate(() => window.riviera.snapshot));
    await page.screenshot({ path: 'artifacts/build-step-' + level + '.png' });
  }
  await clickCell();
  assert.equal((await page.evaluate(() => window.riviera.stats)).blocks, 1, 'water creates stone');
  await clickCell();
  assert.equal((await page.evaluate(() => window.riviera.stats)).blocks, 2, 'stone creates house');
  await clickCell(1);
  assert.equal(
    (await page.evaluate(() => window.riviera.stats)).blocks,
    3,
    'roof creates another floor',
  );
  await page.getByRole('button', { name: 'Havsblå', exact: true }).click();
  await clickCell(2);
  assert.equal(
    JSON.parse(await page.evaluate(() => window.riviera.snapshot)).cells[0][1][3],
    7,
    'selected color is applied',
  );
  await page.screenshot({ path: 'artifacts/tower.png' });
  await clickCell(3, 'right');
  assert.equal(
    (await page.evaluate(() => window.riviera.stats)).blocks,
    3,
    'right click removes top',
  );
  await page.locator('#undo').click();
  assert.equal((await page.evaluate(() => window.riviera.stats)).blocks, 4, 'undo restores top');
  await page.locator('#redo').click();
  assert.equal((await page.evaluate(() => window.riviera.stats)).blocks, 3, 'redo removes top');
  await page.locator('#erase').click();
  await clickCell(2);
  assert.equal((await page.evaluate(() => window.riviera.stats)).blocks, 2, 'eraser removes');
  const preDrag = await page.evaluate(() => window.riviera.snapshot);
  await page.mouse.move(700, 500);
  await page.mouse.down();
  await page.mouse.move(850, 520, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.riviera.snapshot), preDrag, 'orbit does not build');
  await page.reload();
  await page.waitForFunction(() => window.riviera?.stats.fps > 0);
  assert.equal(
    await page.evaluate(() => window.riviera.snapshot),
    preDrag,
    'autosave survives reload',
  );
  await page.locator('#settings').click();
  await page.locator('#ao').uncheck();
  assert.equal((await page.evaluate(() => window.riviera.stats)).ao, 0);
  await page.locator('#ao').check();
  await page.locator('#shadows').uncheck();
  assert.equal((await page.evaluate(() => window.riviera.stats)).shadows, false);
  await page.locator('#shadows').check();
  await page.locator('#file').setInputFiles({
    name: 'harbour.json',
    mimeType: 'application/json',
    buffer: Buffer.from(initial),
  });
  await page.waitForTimeout(700);
  assert.equal(
    await page.evaluate(() => window.riviera.snapshot),
    initial,
    'import restores complete original',
  );
  const dl = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await dl;
  await download.saveAs('artifacts/exported-town.json');
  await page.locator('#settings-panel .close').click();
  const pngPromise = page.waitForEvent('download');
  await page.locator('#photo').click();
  const png = await pngPromise;
  await png.saveAs('artifacts/postcard.png');
  await page.screenshot({ path: 'artifacts/verified-harbour.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'artifacts/mobile.png' });
  assert.deepEqual(errors, []);
  const report = {
    passed: [
      'WebGPU backend',
      'water to foundation',
      'foundation to house',
      'stack floors',
      'palette color',
      'right-click removal',
      'undo',
      'redo',
      'eraser',
      'orbit without edit',
      'autosave reload',
      'AO toggle',
      'shadow toggle',
      'JSON import',
      'JSON export',
      'PNG postcard',
      'mobile render',
    ],
    stats: await page.evaluate(() => window.riviera.stats),
    errors,
  };
  await writeFile('artifacts/verification.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
