import * as T from 'three/webgpu';
import { Fn, storage, instanceIndex, mat4, vec4, cos, sin } from 'three/tsl';
import { profiler } from './profiler.js';
import { ITEM_SIZE } from './geometry-data.js';
import { intersectBVH } from './spatial.js';
import { trackRenderResources } from './render-resources.js';

const capacityFor = (n) => 2 ** Math.ceil(Math.log2(Math.max(n, 16)));
function sphere(bounds) {
  return new T.Box3(
    new T.Vector3(...bounds.slice(0, 3)),
    new T.Vector3(...bounds.slice(3, 6)),
  ).getBoundingSphere(new T.Sphere());
}
function upload(attribute, array) {
  attribute.array.set(array);
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, array.length);
  attribute.needsUpdate = true;
}

export class ArchitectureView {
  constructor(scene, cells, renderer, mat) {
    Object.assign(this, { scene, cells, renderer, mat });
    this.group = new T.Group();
    scene.add(this.group);
    this.resources = trackRenderResources(renderer);
    this.chunks = new Map();
    this.ack = new Map();
    this.pickMeshes = [];
    this.stats = {};
    this.roofHeights = new Map();
    this.roofCenters = new Map();
    this.gpuPending = new Set();
    this.revision = 0;
    this.appliedRevision = 0;
    this.waiters = [];
    this.pending = false;
    this.inflight = null;
    this.worker = new Worker(new URL('./build.worker.js', import.meta.url), { type: 'module' });
    this.worker.postMessage({ type: 'init', cells });
    this.worker.onmessage = (event) => this.receive(event.data);
    this.worker.onerror = (event) => this.fail(Error(event.message || 'Geometry worker failed'));
  }
  rebuild(town, animation = null) {
    const id = ++this.revision;
    this.latest = {
      id,
      animation,
      town: [...town].map(([id, l]) => [id, l.slice()]),
      profile: profiler.enabled,
      epoch: profiler.epoch,
      started: performance.now(),
    };
    this.pending = true;
    Object.assign(this.stats, {
      cells: town.size,
      blocks: [...town.values()].reduce((n, l) => n + l.filter((v) => v !== null).length, 0),
      floors: [...town.values()].reduce(
        (n, l) => n + l.slice(1).filter((v) => v !== null).length,
        0,
      ),
    });
    if (!this.inflight) this.send();
    return this.ready();
  }
  ready() {
    return this.pending
      ? new Promise((resolve, reject) => this.waiters.push({ resolve, reject }))
      : Promise.resolve();
  }
  send() {
    this.inflight = this.latest;
    this.worker.postMessage({ ...this.inflight, type: 'build', ack: [...this.ack] });
  }
  receive(message) {
    const request = this.inflight;
    this.inflight = null;
    if (!request || message.id !== request.id) return;
    if (message.error) {
      this.fail(Error(message.error));
      return;
    }
    if (message.id !== this.revision) {
      profiler.count('build.superseded');
      this.send();
      return;
    }
    // All unacknowledged chunks are sent, even if a previous response was superseded.
    profiler.measure('build.apply', () => this.apply(message.result));
    // Start only the animation belonging to the accepted geometry revision.
    this.commitAnimation?.(request.animation);
    for (const [name, metric] of Object.entries(message.metrics || {}))
      profiler.record('worker.' + name, metric.total, request.epoch);
    profiler.record('async.build.latency', performance.now() - request.started, request.epoch);
    profiler.record('worker.elapsed', message.elapsed, request.epoch);
    this.presentation = { started: request.started, epoch: request.epoch };
    this.appliedRevision = message.id;
    this.pending = false;
    this.onCommit?.();
    for (const waiter of this.waiters.splice(0)) waiter.resolve();
  }
  fail(error) {
    this.pending = false;
    this.inflight = null;
    for (const w of this.waiters.splice(0)) w.reject(error);
    this.onError?.(error);
  }
  release(entry) {
    if (!entry) return;
    this.gpuPending.delete(entry);
    if (entry.compute) {
      entry.compute.dispose();
      this.resources.attribute(entry.transforms);
    }
    this.group.remove(entry.mesh);
    this.resources.release(entry.mesh);
  }
  apply(result) {
    for (const update of result.chunks) {
      let chunk = this.chunks.get(update.key);
      if (update.empty) {
        if (chunk) for (const entry of Object.values(chunk)) this.release(entry);
        this.chunks.delete(update.key);
        this.ack.set(update.key, update.version);
        continue;
      }
      if (!chunk) {
        chunk = {};
        this.chunks.set(update.key, chunk);
      }
      for (const [kind, data] of Object.entries(update.meshes)) this.updateMesh(chunk, kind, data);
      for (const [kind, data] of Object.entries(update.instances))
        this.updateInstances(chunk, kind, data);
      this.ack.set(update.key, update.version);
    }
    this.roofHeights = new Map(result.roofHeights);
    this.roofCenters = new Map(result.roofCenters);
    this.pickMeshes = [...this.chunks.values()].flatMap((c) =>
      ['wall', 'roof', 'stone'].map((k) => c[k]?.mesh).filter((m) => m?.visible),
    );
    this.stats = { ...result.stats, draws: this.group.children.filter((m) => m.visible).length };
  }
  updateMesh(chunk, kind, data) {
    const count = data.attributes.position.length / 3;
    let entry = chunk[kind];
    if (!count) {
      if (entry) {
        entry.mesh.visible = false;
        entry.data = null;
      }
      return;
    }
    if (!entry || entry.capacity < count) {
      this.release(entry);
      const capacity = capacityFor(count),
        geometry = new T.BufferGeometry();
      for (const [key, size] of Object.entries(ITEM_SIZE))
        geometry.setAttribute(key, new T.BufferAttribute(new Float32Array(capacity * size), size));
      const mesh = new T.Mesh(geometry, this.mat[kind === 'wall' ? 'plaster' : kind]);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      entry = chunk[kind] = { mesh, capacity };
    }
    const { mesh } = entry;
    for (const [key, array] of Object.entries(data.attributes))
      upload(mesh.geometry.attributes[key], array);
    mesh.geometry.setDrawRange(0, count);
    mesh.geometry.boundingSphere = sphere(Array.from(data.bvh.boxes.subarray(0, 6)));
    mesh.geometry.boundingSphere.radius += 1; // conservative during the GPU build bounce
    mesh.visible = true;
    // Read-only face metadata is available without allocating one object per triangle.
    entry.data = {
      attributes: { position: mesh.geometry.attributes.position.array.subarray(0, count * 3) },
      faces: data.faces,
      bvh: data.bvh,
    };
    mesh.userData.pickData = entry.data;
  }
  updateInstances(chunk, kind, data) {
    let entry = chunk[kind];
    if (!data.count) {
      if (entry) entry.mesh.visible = false;
      return;
    }
    if (!entry || entry.capacity < data.count) {
      this.release(entry);
      const capacity = capacityFor(data.count);
      const geometry =
        kind === 'box'
          ? new T.BoxGeometry(1, 1, 1)
          : kind === 'sphere'
            ? new T.IcosahedronGeometry(1, 1)
            : new T.CylinderGeometry(1, 1, 1, 8);
      geometry.setAttribute(
        'buildKey',
        new T.InstancedBufferAttribute(new Float32Array(capacity), 1),
      );
      geometry.setAttribute('baseY', new T.InstancedBufferAttribute(new Float32Array(capacity), 1));
      const mesh = new T.InstancedMesh(geometry, this.mat.detail, 0);
      mesh.instanceMatrix = new T.StorageInstancedBufferAttribute(capacity, 16);
      // Keep colors as a direct instanced vertex attribute. Three r185 copies
      // instanceColor's version after geometry upload, leaving old colors on
      // newly reordered GPU matrices for the first frame of a chunk update.
      geometry.setAttribute(
        'color',
        new T.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
      );
      const transforms = new T.StorageBufferAttribute(capacity * 2, 4);
      const input = storage(transforms, 'vec4', capacity * 2).toReadOnly(),
        output = storage(mesh.instanceMatrix, 'mat4', capacity);
      // Real GPU compute, once per changed instance batch; no matrix readback for picking/bounds.
      const compute = Fn(() => {
        const p = input.element(instanceIndex.mul(2)),
          s = input.element(instanceIndex.mul(2).add(1)),
          c = cos(p.w),
          n = sin(p.w);
        output
          .element(instanceIndex)
          .assign(
            mat4(
              vec4(c.mul(s.x), 0, n.negate().mul(s.x), 0),
              vec4(0, s.y, 0, 0),
              vec4(n.mul(s.z), 0, c.mul(s.z), 0),
              vec4(p.xyz, 1),
            ),
          );
      })()
        .compute(capacity)
        .setName('instance-transforms');
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      entry = chunk[kind] = { mesh, capacity, transforms, compute };
    }
    const { mesh } = entry;
    entry.source = {
      count: data.count,
      transform: entry.transforms.array.subarray(0, data.transform.length),
    };
    upload(entry.transforms, data.transform);
    upload(mesh.geometry.attributes.color, data.color);
    upload(mesh.geometry.attributes.buildKey, data.buildKey);
    upload(mesh.geometry.attributes.baseY, data.baseY);
    mesh.count = data.count;
    entry.compute.count = data.count;
    mesh.boundingSphere = sphere(data.bounds);
    mesh.boundingSphere.radius += 1;
    mesh.visible = true;
    this.gpuPending.add(entry);
  }
  flushGPU() {
    if (!this.gpuPending.size) return;
    const nodes = [...this.gpuPending].map((e) => e.compute);
    this.gpuPending.clear();
    profiler.measure('build.gpuDispatch', () => this.renderer.compute(nodes));
  }
  markSubmitted() {
    if (this.presentation) {
      profiler.record(
        'async.build.firstFrameSubmitted',
        performance.now() - this.presentation.started,
        this.presentation.epoch,
      );
      this.presentation = null;
    }
  }
  raycast(ray) {
    let closest = null;
    for (const chunk of this.chunks.values())
      for (const kind of ['wall', 'roof', 'stone']) {
        const entry = chunk[kind];
        if (!entry?.mesh.visible || !entry.data) continue;
        const hit = intersectBVH(ray, entry.data, closest?.distance ?? Infinity);
        if (hit) closest = { ...hit, object: entry.mesh };
      }
    return closest;
  }
  async verifyGPUInstances() {
    this.flushGPU();
    let maxError = 0,
      count = 0;
    const matrix = new T.Matrix4(),
      position = new T.Vector3(),
      scale = new T.Vector3(),
      rotation = new T.Quaternion();
    for (const chunk of this.chunks.values())
      for (const kind of ['box', 'sphere', 'cylinder']) {
        const entry = chunk[kind];
        if (!entry?.mesh.visible) continue;
        const data = new Float32Array(
          await this.renderer.getArrayBufferAsync(entry.mesh.instanceMatrix),
        );
        for (let i = 0; i < entry.source.count; i++) {
          const values = entry.source.transform;
          position.fromArray(values, i * 8);
          scale.fromArray(values, i * 8 + 4);
          rotation.setFromAxisAngle(new T.Vector3(0, 1, 0), values[i * 8 + 3]);
          matrix.compose(position, rotation, scale);
          for (let k = 0; k < 16; k++)
            maxError = Math.max(maxError, Math.abs(data[i * 16 + k] - matrix.elements[k]));
          count++;
        }
      }
    return { maxError, count };
  }
  dispose() {
    this.worker.terminate();
    for (const chunk of this.chunks.values())
      for (const entry of Object.values(chunk)) this.release(entry);
    this.chunks.clear();
    this.scene.remove(this.group);
    for (const m of Object.values(this.mat)) m.dispose();
  }
}
