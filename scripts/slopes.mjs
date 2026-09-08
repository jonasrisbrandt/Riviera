import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { makeGrid } from '../src/grid.js';
import { landscapeDemo } from '../src/landscape-demo.js';
import { sculpt } from '../src/terrain.js';
import { serialize } from '../src/state.js';
const { cells } = makeGrid(),
  town = landscapeDemo(cells);
for (const cell of cells)
  if (town.terrain.has(cell.id) && !town.has(cell.id)) sculpt(town, cell.id, 'slope', 0, cells);
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/slopes-town.json', serialize(town));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    (json) => localStorage.setItem('riviera-town-v1', json),
    serialize(town),
  );
  await page.goto(process.env.RIVIERA_URL || 'http://localhost:5173/');
  await page.waitForFunction(() => window.riviera?.stats.fps > 0);
  await page.evaluate(() => riviera.ready());
  await page.mouse.move(1420, 980);
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'artifacts/slopes-village.jpg', type: 'jpeg', quality: 92 });
  await page.mouse.move(740, 470);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(700);
  await page.mouse.move(1420, 980);
  await page.screenshot({ path: 'artifacts/slopes-close.jpg', type: 'jpeg', quality: 92 });
  await page.mouse.move(740, 470);
  await page.mouse.down();
  await page.mouse.move(1050, 510, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  await page.mouse.move(1420, 980);
  await page.screenshot({ path: 'artifacts/slopes-reverse.jpg', type: 'jpeg', quality: 92 });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      slopes: [...town.terrain.values()].filter((v) => v.length === 3).length,
      stats: await page.evaluate(() => riviera.stats),
      errors,
    }),
  );
} finally {
  await browser.close();
}
