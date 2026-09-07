import { planRoofs } from './roofs.js';
import { buildCell } from './cell-builder.js';
import { mergeGeometry, packInstances } from './geometry-data.js';
import { buildBVH, mergeBVHs } from './spatial.js';
import { profiler } from './profiler.js';

export const CHUNK_SIZE = 12;
export function chunkKey(cell) {
  return (
    Math.floor((cell.center[0] + 6) / CHUNK_SIZE) +
    ',' +
    Math.floor((cell.center[1] + 6) / CHUNK_SIZE)
  );
}
export class BuildEngine {
  constructor(cells) {
    this.cells = cells;
    this.town = new Map();
    this.plans = new Map();
    this.cache = new Map();
    this.versions = new Map();
    this.vertexCells = new Map();
    for (const c of cells)
      for (const v of c.vertices) {
        if (!this.vertexCells.has(v)) this.vertexCells.set(v, []);
        this.vertexCells.get(v).push(c.id);
      }
  }
  build(town, ack = new Map()) {
    const dirty = new Set(),
      ids = new Set([...town.keys(), ...this.town.keys()]);
    for (const id of ids) {
      const a = town.get(id),
        b = this.town.get(id);
      if (a?.length === b?.length && a?.every((v, i) => v === b[i])) continue;
      dirty.add(id);
      for (const v of this.cells[id].vertices)
        for (const n of this.vertexCells.get(v)) dirty.add(n);
    }
    const oldPlans = this.plans,
      cache = new Map([...new Set(oldPlans.values())].map((p) => [p.signature, p]));
    const plans = profiler.measure('build.roofPlan', () => planRoofs(this.cells, town, cache));
    // Component merges/splits and boundary exposure invalidate the entire affected roof.
    for (const [key, plan] of oldPlans)
      if (plans.get(key) !== plan) for (const id of plan.ids) dirty.add(id);
    for (const [key, plan] of plans)
      if (oldPlans.get(key) !== plan) for (const id of plan.ids) dirty.add(id);
    const changedChunks = new Set();
    let rebuiltCells = 0;
    for (const id of dirty) {
      if (!town.has(id) && !this.cache.has(id)) continue;
      changedChunks.add(chunkKey(this.cells[id]));
      if (town.has(id)) {
        const data = buildCell(this.cells[id], this.cells, town, plans, this.vertexCells);
        for (const kind of ['wall', 'roof', 'stone'])
          data[kind].bvh = profiler.measure('build.pickBVH', () =>
            buildBVH(data[kind].attributes.position),
          );
        this.cache.set(id, data);
        rebuiltCells++;
      } else this.cache.delete(id);
    }
    for (const key of changedChunks) this.versions.set(key, (this.versions.get(key) || 0) + 1);
    this.town = new Map([...town].map(([id, l]) => [id, l.slice()]));
    this.plans = plans;
    const groups = new Map();
    for (const [id, cell] of this.cache) {
      const key = chunkKey(this.cells[id]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(cell);
    }
    const chunks = [];
    for (const [key, version] of this.versions) {
      if (ack.get(key) === version) continue;
      const cells = groups.get(key) || [];
      if (!cells.length) {
        chunks.push({ key, version, empty: true });
        continue;
      }
      const meshes = {};
      for (const kind of ['wall', 'roof', 'stone']) {
        const data = profiler.measure('build.buffers.' + kind, () =>
          mergeGeometry(cells.map((c) => c[kind])),
        );
        data.bvh = profiler.measure('build.pickBVHJoin', () =>
          mergeBVHs(cells.map((c) => c[kind])),
        );
        meshes[kind] = data;
      }
      const instances = {};
      for (const kind of ['box', 'sphere', 'cylinder'])
        instances[kind] = profiler.measure('build.instances.' + kind, () =>
          packInstances(cells.flatMap((c) => c.instances[kind])),
        );
      chunks.push({ key, version, meshes, instances });
    }
    const roofHeights = [],
      roofCenters = [];
    for (const cell of this.cache.values())
      for (const [key, height] of cell.roofHeights) {
        roofHeights.push([key, height]);
        const c = this.cells[Math.floor(key / 32)];
        roofCenters.push([key, plans.get(key).sample(...c.center).height]);
      }
    const all = [...this.cache.values()];
    return {
      chunks,
      roofHeights,
      roofCenters,
      stats: {
        cells: town.size,
        blocks: [...town.values()].reduce((n, l) => n + l.filter((v) => v !== null).length, 0),
        floors: [...town.values()].reduce(
          (n, l) => n + l.slice(1).filter((v) => v !== null).length,
          0,
        ),
        instances: all.reduce(
          (n, c) => n + Object.values(c.instances).reduce((n, a) => n + a.length, 0),
          0,
        ),
        arches: all.reduce((n, c) => n + c.archCount, 0),
        corbels: all.reduce((n, c) => n + c.corbelCount, 0),
        chunks: groups.size,
        rebuiltCells,
        changedChunks: changedChunks.size,
        roofComponents: new Set(plans.values()).size,
      },
    };
  }
}

export function transferableBuffers(value, result = new Set()) {
  if (ArrayBuffer.isView(value)) result.add(value.buffer);
  else if (value && typeof value === 'object')
    for (const item of Object.values(value)) transferableBuffers(item, result);
  return [...result];
}
