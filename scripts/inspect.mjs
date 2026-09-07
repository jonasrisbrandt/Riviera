import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
});
await page.goto('http://localhost:5173');
await page.waitForTimeout(11000);
console.log(
  JSON.stringify(
    {
      errors,
      stats: await page.evaluate(() => window.riviera?.stats),
      fatal: await page.locator('#fatal').textContent(),
    },
    null,
    2,
  ),
);
await page.screenshot({ path: 'artifacts/first-look.png' });
await browser.close();
