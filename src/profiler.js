// Opt-in instrumentation. CPU spans are inclusive with separate self time;
// GPU durations come from real timestamp queries, never JS submit durations.
export function summarize(values) {
  if (!values.length) return { n: 0, mean: null, p50: null, p95: null, max: null, total: 0 };
  const sorted = [...values].sort((a, b) => a - b),
    total = values.reduce((a, b) => a + b, 0);
  return {
    n: values.length,
    mean: total / values.length,
    p50: sorted[Math.floor((sorted.length - 1) * 0.5)],
    p95: sorted[Math.ceil((sorted.length - 1) * 0.95)],
    max: sorted.at(-1),
    total,
  };
}

export class Profiler {
  constructor({ enabled = false, clock = () => performance.now(), capacity = 6000 } = {}) {
    this.enabled = enabled;
    this.clock = clock;
    this.capacity = capacity;
    this.epoch = 0;
    this.stack = [];
    this.gpuStack = [];
    this.pending = new Set();
    this.slots = [];
    this.gpuEvery = 3;
    this.reset('startup');
  }
  reset(label = 'capture') {
    this.epoch++;
    this.label = label;
    this.started = this.clock();
    this.stoppedAt = null;
    this.stopping = false;
    this.series = new Map();
    this.counters = {};
    this.frameCount = 0;
    this.gpuFrames = 0;
    this.droppedGPUFrames = 0;
    this.queryOverflow = 0;
    this.gpuErrors = [];
    this.lastFrame = null;
    this.stack.length = 0;
  }
  start(label = 'capture', { gpuEvery = 3 } = {}) {
    this.reset(label);
    this.gpuEvery = Math.max(1, Math.floor(gpuEvery));
    this.enabled = true;
    this.installGPU?.();
  }
  record(name, value, epoch = this.epoch) {
    if (!this.enabled || epoch !== this.epoch || !Number.isFinite(value)) return;
    let s = this.series.get(name);
    if (!s) {
      s = { values: [], count: 0, total: 0, max: 0 };
      this.series.set(name, s);
    }
    s.values[s.count % this.capacity] = value;
    s.count++;
    s.total += value;
    s.max = Math.max(s.max, value);
  }
  count(name, value = 1) {
    if (this.enabled) this.counters[name] = (this.counters[name] || 0) + value;
  }
  begin(name) {
    if (!this.enabled || this.stopping) return null;
    const span = { name, start: this.clock(), children: 0, epoch: this.epoch };
    this.stack.push(span);
    return span;
  }
  end(span) {
    if (!span || span.epoch !== this.epoch) return;
    const elapsed = this.clock() - span.start;
    const top = this.stack.pop();
    if (top !== span) throw new Error(`Unbalanced profiler scope: ${span.name}`);
    if (this.stack.length) this.stack.at(-1).children += elapsed;
    this.record(`cpu.${span.name}`, elapsed);
    this.record(`self.${span.name}`, Math.max(0, elapsed - span.children));
  }
  measure(name, fn) {
    const span = this.begin(name);
    try {
      return fn();
    } finally {
      this.end(span);
    }
  }
  async measureAsync(name, fn) {
    const start = this.clock(),
      epoch = this.epoch;
    try {
      return await fn();
    } finally {
      this.record(`async.${name}`, this.clock() - start, epoch);
    }
  }
  wrap(object, key, name) {
    const original = object[key],
      profiler = this;
    object[key] = function (...args) {
      if (!profiler.enabled || profiler.stopping) return original.apply(this, args);
      return profiler.measure(name, () => original.apply(this, args));
    };
  }
  attachRenderer(renderer) {
    this.renderer = renderer;
    const device = renderer.backend.device,
      profiler = this;
    this.gpuSupported = device.features.has('timestamp-query');
    const info = device.adapterInfo;
    this.adapter = info
      ? {
          vendor: info.vendor,
          architecture: info.architecture,
          device: info.device,
          description: info.description,
          subgroupMinSize: info.subgroupMinSize,
          subgroupMaxSize: info.subgroupMaxSize,
        }
      : null;
    this.metadata = {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      timestampQuery: this.gpuSupported,
      threeRevision: '185',
      adapter: this.adapter,
    };
    // Three's inspector tells us what each native render pass contains.
    const inspector = renderer.inspector;
    const beginRender = inspector.beginRender.bind(inspector),
      finishRender = inspector.finishRender.bind(inspector);
    const spans = new Map();
    inspector.beginRender = (uid, scene, camera, target) => {
      beginRender(uid, scene, camera, target);
      if (!profiler.enabled || profiler.stopping) return;
      const label =
        camera.name === 'shadow-map'
          ? 'shadows'
          : scene.name || scene.material?.name || target?.texture?.name || 'unnamed-render';
      profiler.gpuStack.push(label);
      spans.set(uid, profiler.begin(`render.${label}`));
    };
    inspector.finishRender = (uid) => {
      if (spans.has(uid)) {
        profiler.end(spans.get(uid));
        spans.delete(uid);
        profiler.gpuStack.pop();
      }
      finishRender(uid);
    };
    const beginCompute = inspector.beginCompute.bind(inspector),
      finishCompute = inspector.finishCompute.bind(inspector);
    inspector.beginCompute = (uid, nodes) => {
      beginCompute(uid, nodes);
      if (!profiler.enabled || profiler.stopping) return;
      const label = Array.isArray(nodes) ? nodes[0]?.name : nodes?.name;
      profiler.gpuStack.push(label || 'compute');
      spans.set(uid, profiler.begin('render.' + (label || 'compute')));
    };
    inspector.finishCompute = (uid) => {
      if (spans.has(uid)) {
        profiler.end(spans.get(uid));
        spans.delete(uid);
        profiler.gpuStack.pop();
      }
      finishCompute(uid);
    };
    const createEncoder = device.createCommandEncoder.bind(device);
    this.submitReadback = device.queue.submit.bind(device.queue);
    this.installGPU = () => {
      if (this.gpuInstalled || !this.gpuSupported) return;
      this.gpuInstalled = true;
      for (let i = 0; i < 6; i++)
        this.slots.push({
          querySet: device.createQuerySet({ type: 'timestamp', count: 256 }),
          resolve: device.createBuffer({
            size: 2048,
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
          }),
          read: device.createBuffer({
            size: 2048,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          }),
          busy: false,
        });
      device.createCommandEncoder = (...args) => {
        const encoder = createEncoder(...args);
        if (!profiler.activeSlot) return encoder;
        for (const kind of ['Render', 'Compute']) {
          const method = `begin${kind}Pass`,
            original = encoder[method].bind(encoder);
          encoder[method] = (descriptor = {}) => {
            const slot = profiler.activeSlot;
            if (!slot || !profiler.enabled) return original(descriptor);
            if (slot.labels.length >= 128) {
              profiler.queryOverflow++;
              return original(descriptor);
            }
            const label = /mip/i.test(descriptor.label || '')
              ? 'mipmaps'
              : profiler.gpuStack.at(-1) || descriptor.label || kind.toLowerCase();
            const index = slot.labels.length * 2;
            slot.labels.push(label);
            return original({
              ...descriptor,
              timestampWrites: {
                querySet: slot.querySet,
                beginningOfPassWriteIndex: index,
                endOfPassWriteIndex: index + 1,
              },
            });
          };
        }
        return encoder;
      };
    };
    if (this.enabled) this.installGPU();
    // These are CPU API costs/byte counts, NOT GPU copy execution times.
    for (const method of ['writeBuffer', 'writeTexture', 'copyExternalImageToTexture', 'submit']) {
      const original = device.queue[method].bind(device.queue);
      device.queue[method] = (...args) => {
        if (!profiler.enabled || profiler.stopping) return original(...args);
        if (method === 'writeBuffer') {
          const data = args[2],
            element = data.BYTES_PER_ELEMENT || 1;
          profiler.count(
            'upload.bufferBytes',
            args[4] === undefined ? data.byteLength - (args[3] || 0) * element : args[4] * element,
          );
        }
        profiler.count(`api.${method}`);
        return profiler.measure(`api.${method}`, () => original(...args));
      };
    }
    for (const method of [
      'createRenderPipeline',
      'createComputePipeline',
      'createBuffer',
      'createTexture',
      'createShaderModule',
    ])
      this.wrap(device, method, `api.${method}`);
    for (const method of ['createRenderPipelineAsync', 'createComputePipelineAsync']) {
      const original = device[method].bind(device);
      device[method] = (...args) =>
        this.enabled ? this.measureAsync(method, () => original(...args)) : original(...args);
    }
    this.createEncoder = createEncoder;
    device.lost.then((info) => {
      this.gpuErrors.push(`Device lost: ${info.reason}`);
    });
  }
  beginFrame(forceGPU = false) {
    if (!this.enabled || this.stopping) return;
    const now = this.clock();
    if (this.lastFrame !== null) this.record('cadence.frameInterval', now - this.lastFrame);
    this.lastFrame = now;
    this.frameCount++;
    if (!this.gpuSupported || (!forceGPU && (this.frameCount - 1) % this.gpuEvery)) return;
    const slot = this.slots.find((s) => !s.busy);
    if (!slot) {
      this.droppedGPUFrames++;
      return;
    }
    slot.busy = true;
    slot.labels = [];
    slot.epoch = this.epoch;
    this.activeSlot = slot;
  }
  endFrame() {
    if (this.enabled && !this.stopping && this.renderer) {
      const info = this.renderer.info.render;
      for (const key of ['drawCalls', 'triangles', 'lines', 'frameCalls'])
        this.record('render.' + key, info[key]);
    }
    const slot = this.activeSlot;
    this.activeSlot = null;
    if (!slot) return;
    if (!slot.labels.length) {
      slot.busy = false;
      return;
    }
    const work = this.resolveSlot(slot);
    this.pending.add(work);
    work.finally(() => this.pending.delete(work));
  }
  async resolveSlot(slot) {
    const start = this.clock(),
      count = slot.labels.length * 2;
    try {
      const encoder = this.createEncoder({ label: 'Riviera timestamp readback' });
      encoder.resolveQuerySet(slot.querySet, 0, count, slot.resolve, 0);
      encoder.copyBufferToBuffer(slot.resolve, 0, slot.read, 0, count * 8);
      this.submitReadback([encoder.finish()]);
      this.record('profiler.readbackEncodeSubmit', this.clock() - start, slot.epoch);
      await slot.read.mapAsync(GPUMapMode.READ, 0, count * 8);
      const times = new BigUint64Array(slot.read.getMappedRange(0, count * 8)),
        totals = {};
      let first = times[0],
        last = times[1],
        sum = 0;
      for (let i = 0; i < slot.labels.length; i++) {
        const a = times[i * 2],
          b = times[i * 2 + 1];
        if (b < a) throw new Error('Invalid GPU timestamp order');
        const duration = Number(b - a) / 1e6;
        first = a < first ? a : first;
        last = b > last ? b : last;
        totals[slot.labels[i]] = (totals[slot.labels[i]] || 0) + duration;
        sum += duration;
      }
      for (const [name, value] of Object.entries(totals))
        this.record(`gpu.${name}`, value, slot.epoch);
      this.record('gpu.passSum', sum, slot.epoch);
      this.record('gpu.span', Number(last - first) / 1e6, slot.epoch);
      this.record('async.timestampReadback', this.clock() - start, slot.epoch);
      if (slot.epoch === this.epoch) this.gpuFrames++;
    } catch (error) {
      if (slot.epoch === this.epoch) this.gpuErrors.push(error.message);
    } finally {
      if (slot.read.mapState === 'mapped') slot.read.unmap();
      slot.busy = false;
    }
  }
  async stop() {
    if (!this.enabled || this.stopping) {
      await Promise.all([...this.pending]);
      return this.snapshot();
    }
    // Keep recording in-flight GPU results, but stop admitting new frames.
    const epoch = this.epoch;
    this.stopping = true;
    this.stoppedAt = this.clock();
    await Promise.all([...this.pending]);
    if (epoch !== this.epoch) return this.snapshot();
    this.enabled = false;
    this.stopping = false;
    return this.snapshot();
  }
  snapshot() {
    const metrics = {};
    for (const [name, s] of this.series)
      metrics[name] = {
        ...summarize(s.values),
        n: s.count,
        retained: s.values.length,
        mean: s.total / s.count,
        total: s.total,
        max: s.max,
      };
    return {
      schema: 1,
      enabled: this.enabled,
      label: this.label,
      recordedAt: new Date().toISOString(),
      durationMs: (this.stoppedAt ?? this.clock()) - this.started,
      frames: this.frameCount,
      gpuFrames: this.gpuFrames,
      gpuEvery: this.gpuEvery,
      droppedGPUFrames: this.droppedGPUFrames,
      queryOverflow: this.queryOverflow,
      gpuErrors: [...this.gpuErrors],
      gpuSupported: this.gpuSupported,
      metrics,
      counters: { ...this.counters },
      environment: {
        ...this.metadata,
        viewport: typeof innerWidth === 'number' ? [innerWidth, innerHeight] : null,
        pixelRatio: this.renderer?.getPixelRatio(),
        memory: this.renderer ? { ...this.renderer.info.memory } : null,
      },
      notes: [
        'CPU/self scopes are nested: do not sum inclusive rows.',
        'GPU passSum excludes queue gaps/copies; span includes gaps between first/last pass.',
        'Fused shader operations cannot be assigned independent timestamp durations.',
        'Timestamp readback is asynchronous and quantized by the browser.',
        'Percentiles use a bounded ring of recent samples; mean/count/total cover the full capture.',
      ],
    };
  }
}

export const profiler = new Profiler({
  enabled: typeof location !== 'undefined' && new URLSearchParams(location.search).has('profile'),
});
