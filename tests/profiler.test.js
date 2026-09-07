import test from 'node:test';
import assert from 'node:assert/strict';
import { Profiler, summarize } from '../src/profiler.js';

test('CPU nested spans retain inclusive and exclusive time without double counting', () => {
  let now = 0;
  const p = new Profiler({ enabled: true, clock: () => now });
  const parent = p.begin('parent');
  now = 2;
  const child = p.begin('child');
  now = 5;
  p.end(child);
  now = 10;
  p.end(parent);
  assert.equal(p.snapshot().metrics['cpu.parent'].total, 10);
  assert.equal(p.snapshot().metrics['self.parent'].total, 7);
  assert.equal(p.snapshot().metrics['cpu.child'].total, 3);
});

test('disabled profiler preserves return values, this binding, and exceptions', () => {
  const p = new Profiler();
  const object = {
    value: 5,
    method(x) {
      return this.value + x;
    },
  };
  p.wrap(object, 'method', 'wrapped');
  assert.equal(object.method(2), 7);
  assert.throws(
    () =>
      p.measure('throw', () => {
        throw Error('expected');
      }),
    /expected/,
  );
  assert.deepEqual(p.snapshot().metrics, {});
  p.start();
  assert.throws(
    () =>
      p.measure('throw', () => {
        throw Error('expected');
      }),
    /expected/,
  );
  assert.equal(p.stack.length, 0);
});

test('bounded samples retain full count/mean and reject stale asynchronous epochs', () => {
  const p = new Profiler({ enabled: true, capacity: 3 });
  for (const value of [1, 2, 3, 4, 5]) p.record('work', value);
  const s = p.snapshot().metrics.work;
  assert.equal(s.n, 5);
  assert.equal(s.retained, 3);
  assert.equal(s.mean, 3);
  assert.equal(s.p50, 4);
  assert.equal(s.p95, 5);
  const epoch = p.epoch;
  p.reset();
  p.record('old', 999, epoch);
  assert.deepEqual(p.snapshot().metrics, {});
  assert.equal(summarize([]).p50, null);
});

test('stop fixes capture boundary while draining GPU readback; restart wins over old stop', async () => {
  let now = 10,
    finish;
  const p = new Profiler({ enabled: true, clock: () => now });
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  p.pending.add(pending);
  now = 20;
  const stopping = p.stop();
  assert.equal(p.begin('lateCPU'), null);
  p.beginFrame();
  assert.equal(p.frameCount, 0);
  p.record('gpu.result', 1); // already submitted GPU work still counts
  now = 30;
  finish();
  const report = await stopping;
  assert.equal(report.durationMs, 10);
  assert.equal(report.metrics['gpu.result'].n, 1);
  assert.equal(p.enabled, false);
  now = 40;
  assert.equal((await p.stop()).durationMs, 10, 'repeated stop preserves boundary');
  p.start('old');
  const oldStop = p.stop();
  p.start('new');
  await oldStop;
  assert.equal(p.enabled, true);
  assert.equal(p.label, 'new');
});

test('unsupported GPU timestamps do not invent GPU timings', () => {
  const p = new Profiler({ enabled: true });
  p.gpuSupported = false;
  p.beginFrame();
  p.endFrame();
  assert.equal(p.snapshot().gpuFrames, 0);
  assert.equal(p.snapshot().metrics['gpu.passSum'], undefined);
});
