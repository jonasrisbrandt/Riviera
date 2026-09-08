import { addHeroes } from './hero-builder.js';
import { buildTerrain, attachTerrain, emptyCell } from './terrain-builder.js';
import { FLOOR, BASE } from './palette.js';
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
    this.terrain = new Map();
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
  build(town, ack = new Map(), terrain = town.terrain || new Map()) {
    town.terrain = terrain;
    const dirty = new Set(),
      ids = new Set([
        ...town.keys(),
        ...this.town.keys(),
        ...terrain.keys(),
        ...this.terrain.keys(),
      ]);
    for (const id of ids) {
      const a = town.get(id),
        b = this.town.get(id);
      const ta = terrain.get(id),
        tb = this.terrain.get(id);
      const terrainSame = ta?.[0] === tb?.[0] && ta?.[1] === tb?.[1] && ta?.[2] === tb?.[2];
      if (terrainSame && a?.length === b?.length && (!a || a.every((v, i) => v === b[i]))) continue;
      dirty.add(id);
      for (const v of this.cells[id].vertices)
        for (const n of this.vertexCells.get(v)) dirty.add(n);
    }
    const groundLevel = (id) => terrain.get(id)?.[0] || 0;
    // Roof connectivity is evaluated at absolute storeys, including differences in ground height.
    const roofTowns = [0, 0.5].map(
      (fraction) =>
        new Map(
          [...town]
            .filter(([id]) => groundLevel(id) % 1 === fraction)
            .map(([id, levels]) => [
              id,
              [...Array(Math.floor(groundLevel(id))).fill(null), null, ...levels.slice(1)],
            ]),
        ),
    );
    const perspectives = new Map();
    const relativeTown = (offset) => {
      if (!terrain.size) return town;
      if (perspectives.has(offset)) return perspectives.get(offset);
      const view = new Map();
      for (const id of new Set([...town.keys(), ...terrain.keys()])) {
        const levels = [],
          ground = groundLevel(id),
          source = town.get(id) || [];
        // Wall connectivity uses whole local storeys. Half-offset houses remain separate.
        for (let relative = -24; relative < 25; relative++) {
          const world = relative + offset,
            local = world - ground;
          levels[relative] =
            world < ground ? 0 : Number.isInteger(local) ? (source[local] ?? null) : null;
        }
        while (levels.length && levels.at(-1) == null) levels.pop();
        view.set(id, levels);
      }
      view.exposedSpans = (id, bottom, upper) => {
        const ground = groundLevel(id);
        if (Number.isInteger(ground - offset)) return null;
        let spans = [[bottom, upper]];
        const hidden = terrain.has(id) ? [[-100, (ground - offset) * FLOOR]] : [];
        (town.get(id) || []).forEach((value, level) => {
          if (value == null) return;
          hidden.push([
            (ground - offset) * FLOOR + (level === 0 ? -0.32 : BASE + (level - 1) * FLOOR),
            (ground - offset) * FLOOR + BASE + level * FLOOR,
          ]);
        });
        for (const [low, high] of hidden)
          spans = spans.flatMap(([a, b]) =>
            high <= a || low >= b
              ? [[a, b]]
              : [
                  [a, Math.min(b, low)],
                  [Math.max(a, high), b],
                ].filter(([a, b]) => b - a > 1e-5),
          );
        return spans;
      };
      perspectives.set(offset, view);
      return view;
    };
    const oldPlans = this.plans,
      cache = new Map([...new Set(oldPlans.values())].map((p) => [p.signature, p]));
    const plans = profiler.measure('build.roofPlan', () => {
      if (!terrain.size) return planRoofs(this.cells, town, cache);
      return new Map(
        roofTowns.flatMap((view, i) => [...planRoofs(this.cells, view, cache, i * 0.5)]),
      );
    });
    // Component merges/splits and boundary exposure invalidate the entire affected roof.
    for (const [key, plan] of oldPlans)
      if (plans.get(key) !== plan) for (const id of plan.ids) dirty.add(id);
    for (const [key, plan] of plans)
      if (oldPlans.get(key) !== plan) for (const id of plan.ids) dirty.add(id);
    const changedChunks = new Set();
    let rebuiltCells = 0;
    for (const id of dirty) {
      if (!town.has(id) && !terrain.has(id) && !this.cache.has(id)) continue;
      changedChunks.add(chunkKey(this.cells[id]));
      if (town.has(id) || terrain.has(id)) {
        const offset = groundLevel(id),
          localPlans = new Map();
        for (let y = 0; y < (town.get(id)?.length || 0); y++)
          localPlans.set(id * 32 + y, plans.get(id * 32 + y + offset));
        const data = town.has(id)
          ? buildCell(
              this.cells[id],
              this.cells,
              relativeTown(offset),
              terrain.size ? localPlans : plans,
              this.vertexCells,
            )
          : emptyCell(id);
        if (offset && town.has(id)) {
          for (const kind of ['wall', 'roof', 'stone']) {
            const a = data[kind].attributes;
            for (let i = 1; i < a.position.length; i += 3) a.position[i] += offset * FLOOR;
            for (let i = 0; i < a.baseY.length; i++) a.baseY[i] += offset * FLOOR;
          }
          for (const list of Object.values(data.instances))
            for (const instance of list) {
              instance.p[1] += offset * FLOOR;
              instance.base += offset * FLOOR;
            }
        }
        attachTerrain(
          data,
          profiler.measure('build.terrain', () =>
            buildTerrain(this.cells[id], this.cells, town, terrain),
          ),
        );
        addHeroes(data, this.cells[id], this.cells, town);
        for (const kind of ['wall', 'roof', 'stone', 'land'])
          data[kind].bvh = profiler.measure('build.pickBVH', () =>
            buildBVH(data[kind].attributes.position),
          );
        this.cache.set(id, data);
        rebuiltCells++;
      } else this.cache.delete(id);
    }
    for (const key of changedChunks) this.versions.set(key, (this.versions.get(key) || 0) + 1);
    this.town = new Map([...town].map(([id, l]) => [id, l.slice()]));
    this.terrain = new Map([...terrain].map(([id, value]) => [id, value.slice()]));
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
      for (const kind of ['wall', 'roof', 'stone', 'land']) {
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
        roofCenters.push([key, plans.get(key + groundLevel(c.id)).sample(...c.center).height]);
      }
    const all = [...this.cache.values()];
    return {
      chunks,
      roofHeights,
      roofCenters,
      stats: {
        cells: town.size,
        terrainCells: terrain.size,
        heroInstances: all.reduce((n, c) => n + (c.heroInstances || 0), 0),
        lighthouses: all.filter((c) => c.hero === 'lighthouse').length,
        parasols: all.filter((c) => c.hero === 'parasol').length,
        stairs: all.reduce((n, c) => n + (c.stairs || 0), 0),
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
