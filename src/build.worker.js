import { BuildEngine, transferableBuffers } from './build-engine.js';
import { profiler } from './profiler.js';
let engine;
self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    engine = new BuildEngine(data.cells);
    return;
  }
  try {
    if (data.profile) profiler.start('worker');
    else profiler.enabled = false;
    const started = performance.now();
    const result = profiler.measure('build.total', () =>
      engine.build(new Map(data.town), new Map(data.ack), new Map(data.terrain || [])),
    );
    const elapsed = performance.now() - started;
    const metrics = data.profile ? profiler.snapshot().metrics : null;
    self.postMessage({ id: data.id, result, elapsed, metrics }, transferableBuffers(result));
  } catch (error) {
    self.postMessage({ id: data.id, error: error.stack || error.message });
  }
};
