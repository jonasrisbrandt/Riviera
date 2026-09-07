// Production benchmark: npm run build, npm run preview -- --port 4173, npm run profile
import { chromium } from '@playwright/test';
import { makeGrid } from '../src/grid.js';
import { serialize } from '../src/state.js';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

await mkdir('artifacts', { recursive: true });
const base = process.env.RIVIERA_URL || 'http://localhost:4173/Riviera/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [],
  captures = [];
const system = await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo');
let cpu = 'unavailable';
if (process.platform === 'win32')
  cpu = execFileSync(
    'powershell',
    ['-NoProfile', '-Command', '(Get-CimInstance Win32_Processor).Name'],
    { encoding: 'utf8' },
  ).trim();
const report = {
  url: base,
  browser: browser.version(),
  cpu,
  gpu: system.gpu.devices,
  featureStatus: system.gpu.featureStatus,
  captures,
  errors,
};
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
await page.addInitScript(() => {
  window.profileLongTasks = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries())
      window.profileLongTasks.push({ start: e.startTime, duration: e.duration });
  }).observe({ type: 'longtask', buffered: true });
});
async function saveCapture(label) {
  await page.evaluate(() => window.riviera.ready());
  await page.evaluate(() => window.riviera.profiling.stop());
  const data = await page.evaluate(() => ({
    ...window.riviera.profiling.snapshot(),
    longTasks: window.profileLongTasks,
  }));
  assert.equal(data.label, label);
  assert.equal(data.queryOverflow, 0);
  assert.equal(data.gpuErrors.length, 0);
  if (data.gpuSupported) assert.ok(data.gpuFrames > 0, 'hardware timestamp samples received');
  captures.push(data);
  await writeFile('artifacts/performance.json', JSON.stringify(report, null, 2));
  const metric = (key) => data.metrics[key]?.p50?.toFixed(3) ?? '—';
  console.log(
    JSON.stringify({
      label,
      frames: data.frames,
      gpuFrames: data.gpuFrames,
      cpu: metric('cpu.frame'),
      gpu: metric('gpu.passSum'),
      build: metric('cpu.build.total'),
      raycast: metric('cpu.input.raycast'),
      errors: errors.length,
    }),
  );
  return data;
}
async function capture(label, action = () => page.waitForTimeout(3000), options = {}) {
  await page.evaluate(
    ({ label, options }) => {
      window.profileLongTasks = [];
      window.riviera.profiling.start(label, options);
    },
    { label, options },
  );
  await action();
  return saveCapture(label);
}
async function variant(options) {
  await page.evaluate((options) => {
    window.riviera.profiling.start('warmup');
    window.riviera.profiling.experiment(options);
  }, options);
  await page.waitForTimeout(1800);
}
async function importTown(town, label) {
  await page.evaluate((label) => {
    window.profileLongTasks = [];
    window.riviera.profiling.start(label);
  }, label);
  await page.locator('#file').setInputFiles({
    name: label + '.json',
    mimeType: 'application/json',
    buffer: Buffer.from(serialize(town)),
  });
  await page.waitForFunction((size) => window.riviera.stats.cells === size, town.size);
  await page.waitForTimeout(1800);
  await saveCapture(label);
}
async function hover() {
  for (let i = 0; i < 150; i++) {
    await page.mouse.move(720 + Math.sin(i * 0.11) * 380, 490 + Math.cos(i * 0.073) * 230);
    await page.waitForTimeout(16);
  }
  await page.mouse.move(1435, 5);
}
async function orbit() {
  await page.mouse.move(950, 600);
  await page.mouse.down();
  for (let i = 0; i < 120; i++) {
    await page.mouse.move(950 + Math.sin(i * 0.07) * 190, 600 + Math.cos(i * 0.055) * 75);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.locator('#home').click();
  await page.waitForTimeout(400);
}
async function editAndUndo() {
  const before = await page.evaluate(() => window.riviera.snapshot);
  for (let i = 0; i < 10; i++) {
    const target = await page.evaluate(() => {
      const town = JSON.parse(window.riviera.snapshot).cells;
      return town
        .filter(([, l]) => l.length > 1)
        .map(([id, levels]) => ({ id, ...window.riviera.projectCell(id, levels.length - 1) }))
        .filter((p) => p.x > 100 && p.x < innerWidth - 100 && p.y > 100 && p.y < innerHeight - 160)
        .sort((a, b) => b.y - a.y)[0];
    });
    assert.ok(target, 'visible roof to edit');
    const count = await page.evaluate(() => window.riviera.stats.blocks);
    await page.mouse.click(target.x, target.y);
    await page.evaluate(() => window.riviera.ready());
    assert.equal(
      await page.evaluate(() => window.riviera.stats.blocks),
      count + 1,
      'real roof click adds one block',
    );
    await page.waitForTimeout(100);
    await page.locator('#undo').click();
    await page.evaluate(() => window.riviera.ready());
    assert.equal(
      await page.evaluate(() => window.riviera.snapshot),
      before,
      'undo restores identical town',
    );
    await page.waitForTimeout(100);
  }
}
try {
  await page.goto(base + (base.includes('?') ? '&' : '?') + 'profile');
  await page.waitForFunction(() => window.riviera?.stats.fps > 0);
  await page.waitForTimeout(1800);
  await saveCapture('startup');
  for (let repeat = 1; repeat <= 3; repeat++) await capture('demo-idle-' + repeat);
  await capture('demo-hover', hover);
  await capture('demo-orbit', orbit);
  await capture('demo-edits', editAndUndo);
  await page.waitForTimeout(1500);
  for (const [label, options] of [
    ['demo-noAO', { aoMode: 'off' }],
    ['demo-rawAO', { aoMode: 'raw' }],
    ['demo-DPR1.5', { pixelRatio: 1.5 }],
    ['demo-DPR2', { pixelRatio: 2 }],
    ['demo-noBuildings', { pixelRatio: 1, buildings: false }],
  ]) {
    await variant(options);
    await capture(label);
  }
  await variant({ pixelRatio: 1 });
  await capture('demo-movingSun', async () => {
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          let n = 0;
          function step() {
            const slider = document.getElementById('sun');
            slider.value = 62 + Math.sin(n * 0.03) * 12;
            slider.dispatchEvent(new Event('input'));
            if (++n < 240) requestAnimationFrame(step);
            else resolve();
          }
          step();
        }),
    );
    await page.evaluate(() => {
      const slider = document.getElementById('sun');
      slider.value = 62;
      slider.dispatchEvent(new Event('input'));
    });
  });
  const { cells } = makeGrid(),
    large = new Map();
  for (const c of cells)
    if (Math.hypot(...c.center) < 18) {
      const levels = [0];
      if (c.id % 7 !== 0) for (let y = 1; y < 3 + (c.id % 4); y++) levels.push(c.id % 12);
      large.set(c.id, levels);
    }
  await importTown(large, 'large-import');
  for (let repeat = 1; repeat <= 3; repeat++) await capture('large-idle-' + repeat);
  await capture('large-hover', hover);
  await capture('large-orbit', orbit);
  await capture('large-edits', editAndUndo);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'artifacts/profile-large.png' });
  await variant({ pixelRatio: 1.5 });
  await capture('large-DPR1.5');
  await variant({ pixelRatio: 1 });
  // Compare sampling rates; vsync cadence alone does not reveal profiler overhead.
  await capture('large-GPUevery1', undefined, { gpuEvery: 1 });
  await capture('large-CPUonly', undefined, { gpuEvery: 1000000 });
  const connected = new Map(
    cells.filter((c) => Math.hypot(...c.center) < 10).map((c) => [c.id, [0, 3, 3]]),
  );
  await importTown(connected, 'connected-import');
  await capture('connected-edits', editAndUndo);
  // Interactive panel and disabled-mode smoke test in this isolated context.
  await page.keyboard.press('F3');
  await page.getByRole('button', { name: 'Ny mätning', exact: true }).click();
  await page.waitForTimeout(800);
  assert.match(await page.locator('#profiler pre').textContent(), /GPU värld/);
  await page.screenshot({ path: 'artifacts/profile-panel.png' });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Spara JSON', exact: true }).click();
  await (await download).saveAs('artifacts/profile-panel-export.json');
  await page.getByRole('button', { name: 'Stoppa', exact: true }).click();
  await page.keyboard.press('F3');
  assert.ok(await page.locator('#profiler').isHidden());
  await page.goto(base);
  await page.waitForFunction(() => window.riviera?.stats.fps > 0);
  assert.equal(await page.evaluate(() => window.riviera.profiling.snapshot().enabled), false);
  assert.deepEqual(errors, []);
  report.passed = [
    'real GPU timestamps',
    'no GPU query errors/overflow',
    'actual build clicks and undo',
    'F3 panel',
    'JSON export',
    'disabled by default',
  ];
  await writeFile('artifacts/performance.json', JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
