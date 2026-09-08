import { terrainPoint } from '../src/terrain-builder.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Ray, Vector3 } from 'three';
import { makeGrid, demoTown, inside } from '../src/grid.js';
import { serialize, deserialize, History } from '../src/state.js';
import { sculpt, elevation, MAX_TERRAIN, cornerHeights, terrainPick } from '../src/terrain.js';
import { landscapeDemo } from '../src/landscape-demo.js';
import { BuildEngine } from '../src/build-engine.js';
import { FLOOR } from '../src/palette.js';
import { intersectBVH } from '../src/spatial.js';
const { cells } = makeGrid();
const center = cells.reduce((a, b) => (Math.hypot(...a.center) < Math.hypot(...b.center) ? a : b));
test('landscape saves and history preserve houses, material and elevation; v1 stays compatible', () => {
  const town = demoTown(cells),
    old = serialize(town);
  assert.equal(JSON.parse(old).version, 1);
  const history = new History();
  history.push(town);
  sculpt(town, center.id, 'raise', 2);
  const saved = serialize(town),
    restored = deserialize(saved, cells.length);
  assert.equal(JSON.parse(saved).version, 2);
  assert.equal(serialize(restored), saved);
  assert.equal(elevation(restored, center.id), 0.5);
  assert.equal(serialize(history.undo(town, cells.length)), old);
  const before = deserialize(old, cells.length);
  assert.equal(serialize(history.redo(before, cells.length)), saved);
  for (const terrain of [
    [[center.id, [0.25, 0]]],
    [[center.id, [0.5, 0, 4]]],
    [[center.id, [1, 0, 0.5]]],
    [[center.id, [0, 0]]],
    [[center.id, [13, 0]]],
    [[center.id, [1, 5]]],
    [
      [center.id, [1, 0]],
      [center.id, [2, 0]],
    ],
    [[99999, [1, 0]]],
  ]) {
    assert.throws(() =>
      deserialize(JSON.stringify({ version: 2, gridSeed: 81, cells: [], terrain }), cells.length),
    );
  }
});
test('sculpting preserves all building storeys and clamps water and the shared vertical range', () => {
  const town = new Map([[center.id, [0, 1, 2]]]),
    houses = JSON.stringify([...town]);
  for (let i = 0; i < 30; i++) sculpt(town, center.id, 'raise');
  assert.equal(elevation(town, center.id), MAX_TERRAIN);
  assert.equal(JSON.stringify([...town]), houses);
  sculpt(town, center.id, 'paint', 4);
  assert.deepEqual(town.terrain.get(center.id), [12, 4]);
  for (let i = 0; i < 30; i++) sculpt(town, center.id, 'lower');
  assert.equal(elevation(town, center.id), 0);
  assert.equal(JSON.stringify([...town]), houses);
  assert.equal(sculpt(town, center.id, 'lower'), false);
  town.set(center.id, Array(24).fill(1));
  sculpt(town, center.id, 'raise');
  sculpt(town, center.id, 'raise');
  assert.equal(sculpt(town, center.id, 'raise'), false);
});
test('incremental terrain/houses match fresh geometry through elevation, painting and removal', () => {
  const town = landscapeDemo(cells),
    engine = new BuildEngine(cells);
  let result = engine.build(town, new Map(), town.terrain);
  const ack = new Map(result.chunks.map((c) => [c.key, c.version]));
  const noChange = engine.build(town, ack, town.terrain);
  assert.equal(noChange.chunks.length, 0);
  const id = [...town.keys()].find((id) => town.terrain.has(id));
  for (const action of ['raise', 'raise', 'paint', 'lower', 'smooth', 'lower']) {
    sculpt(town, id, action, 2, cells);
    result = engine.build(town, ack, town.terrain);
    const fresh = new BuildEngine(cells);
    fresh.build(town, new Map(), town.terrain);
    assert.equal(engine.cache.size, fresh.cache.size);
    for (const [key, a] of engine.cache) {
      const b = fresh.cache.get(key);
      for (const kind of ['wall', 'roof', 'stone', 'land']) {
        assert.deepEqual(a[kind].attributes, b[kind].attributes, kind + ' cell ' + key);
        assert.deepEqual(a[kind].faces, b[kind].faces);
      }
      assert.deepEqual(a.instances, b.instances);
    }
    assert.ok(result.stats.rebuiltCells < engine.cache.size);
    for (const c of result.chunks) ack.set(c.key, c.version);
  }
});
test('roofs connect by absolute elevation while picks and animation keys remain local', () => {
  const neighbor = cells[center.neighbors[0]],
    town = new Map([
      [center.id, [0, 1, 1]],
      [neighbor.id, [0, 2, 2, 2]],
    ]);
  const terrain = new Map([[center.id, [1, 0]]]),
    engine = new BuildEngine(cells);
  engine.build(town, new Map(), terrain);
  assert.equal(engine.plans.get(center.id * 32 + 3), engine.plans.get(neighbor.id * 32 + 3));
  const roof = engine.cache.get(center.id).roof;
  assert.ok([...roof.faces].filter((_, i) => i % 3 === 1).every((y) => y === 2));
  const c = center.center,
    ray = new Ray(new Vector3(c[0], 30, c[1]), new Vector3(0, -1, 0));
  const hit = intersectBVH(ray, roof);
  assert.equal(hit.meta.id, center.id);
  assert.equal(hit.meta.level, 2);
  assert.ok(hit.distance < 30 - (3 * FLOOR + 0.4));
});
test('terrain-only cells are pickable and downward edits remove their meshes', () => {
  const town = new Map(),
    terrain = new Map([[center.id, [2, 1]]]),
    engine = new BuildEngine(cells);
  let result = engine.build(town, new Map(), terrain);
  const land = engine.cache.get(center.id).land,
    c = center.center;
  const hit = intersectBVH(new Ray(new Vector3(c[0], 30, c[1]), new Vector3(0, -1, 0)), land);
  assert.equal(hit.meta.level, -1);
  assert.ok(Math.abs(hit.distance - (30 - 2 * FLOOR)) < 1e-5);
  assert.ok([...land.attributes.position].every(Number.isFinite));
  const ack = new Map(result.chunks.map((c) => [c.key, c.version]));
  terrain.clear();
  result = engine.build(town, ack, terrain);
  assert.equal(engine.cache.size, 0);
  assert.ok(result.chunks.every((c) => c.empty));
});
test('every stair tread and both edges of its opening have solid pickable geometry', () => {
  const town = landscapeDemo(cells),
    engine = new BuildEngine(cells);
  engine.build(town);
  const entries = [...engine.cache.values()].filter((c) => c.stairs);
  assert.ok(entries.length > 5);
  for (const data of entries) {
    const h = elevation(town, data.id) * FLOOR,
      p = data.stone.attributes.position;
    let treads = 0;
    for (let i = 0; i < p.length; i += 9) {
      const verts = [0, 3, 6].map((j) => [p[i + j], p[i + j + 1], p[i + j + 2]]);
      if (verts.some((v) => Math.abs(v[1] - verts[0][1]) > 1e-5) || verts[0][1] >= h - 0.01)
        continue;
      if (data.stone.attributes.normal[i + 1] < 0.9) continue;
      const x = (verts[0][0] + verts[1][0] + verts[2][0]) / 3,
        z = (verts[0][2] + verts[1][2] + verts[2][2]) / 3;
      const ray = new Ray(new Vector3(x, h + 0.1, z), new Vector3(0, -1, 0));
      const hit = intersectBVH(ray, data.stone);
      assert.ok(hit, 'step must be visible and pickable');
      const grass = intersectBVH(ray, data.land);
      assert.ok(!grass || grass.distance >= hit.distance - 1e-4, 'no grass over the stairs');
      treads++;
    }
    assert.ok(treads >= 8, 'at least four supported steps');
  }
});

test('half-height roofs join only when their absolute tops coincide', () => {
  const n = cells[center.neighbors[0]],
    town = new Map([
      [center.id, [0, 1, 1]],
      [n.id, [0, 2, 2]],
    ]);
  town.terrain = new Map([
    [center.id, [0.5, 0]],
    [n.id, [0.5, 0]],
  ]);
  const engine = new BuildEngine(cells);
  engine.build(town);
  assert.equal(engine.plans.get(center.id * 32 + 2.5), engine.plans.get(n.id * 32 + 2.5));
  town.terrain.set(n.id, [1, 0]);
  engine.build(town);
  assert.notEqual(engine.plans.get(center.id * 32 + 2.5), engine.plans.get(n.id * 32 + 3));
  for (const data of engine.cache.values())
    for (const mesh of ['land', 'wall', 'roof', 'stone'])
      assert.ok([...data[mesh].attributes.position].every(Number.isFinite));
});

test('ramp corners meet the lower neighbour, persist, flatten and invalidate adjacent geometry', () => {
  const n = cells[center.neighbors[0]],
    town = new Map();
  town.terrain = new Map([
    [center.id, [1, 1]],
    [n.id, [0.5, 1]],
  ]);
  assert.ok(sculpt(town, center.id, 'slope', 0, cells));
  const heights = cornerHeights(center, town.terrain, town);
  assert.deepEqual(heights, [0.5 * FLOOR, 0.5 * FLOOR, FLOOR, FLOOR]);
  assert.equal(serialize(deserialize(serialize(town), cells.length)), serialize(town));
  const engine = new BuildEngine(cells);
  engine.build(town);
  const r = new Ray(
    new Vector3(...[center.center[0], 20, center.center[1]]),
    new Vector3(0, -1, 0),
  );
  const hit = intersectBVH(r, engine.cache.get(center.id).land);
  assert.ok(hit.distance > 20 - FLOOR && hit.distance < 20 - 0.5 * FLOOR);
  sculpt(town, n.id, 'raise');
  engine.build(town);
  const fresh = new BuildEngine(cells);
  fresh.build(town);
  for (const [id, c] of engine.cache)
    assert.deepEqual(c.land.attributes, fresh.cache.get(id).land.attributes);
  assert.ok(cornerHeights(center, town.terrain, town).every((v) => v === FLOOR));
});

test('raising a cliff face fills the lower hole, while other tools keep the hit surface', () => {
  const town = new Map();
  town.terrain = new Map([[center.id, [2, 0]]]);
  const meta = { id: center.id, level: -1, edge: 0 },
    n = center.neighbors[0];
  assert.equal(terrainPick(meta, cells, town, 'raise').id, n);
  for (const tool of ['lower', 'paint', 'slope', 'smooth'])
    assert.equal(terrainPick(meta, cells, town, tool).id, center.id);
  town.set(n, [0, 1]);
  assert.equal(terrainPick(meta, cells, town, 'raise').id, center.id);
});

test('dense coverage of stair cuts has no holes at treads, sides or upper landings', () => {
  const town = landscapeDemo(cells),
    engine = new BuildEngine(cells);
  engine.build(town);
  let samples = 0;
  for (const data of engine.cache.values())
    if (data.stairs) {
      const cell = cells[data.id],
        y = elevation(town, cell.id) * FLOOR;
      const p = cell.points.map((v) => {
        const q = terrainPoint(v, y);
        return [q[0], q[2]];
      });
      for (let x = Math.min(...p.map((v) => v[0])); x < Math.max(...p.map((v) => v[0])); x += 0.055)
        for (
          let z = Math.min(...p.map((v) => v[1]));
          z < Math.max(...p.map((v) => v[1]));
          z += 0.055
        ) {
          if (
            !inside([x, z], p) ||
            p.some((a, i) => {
              const b = p[(i + 1) % 4];
              return (
                Math.abs((b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0])) /
                  Math.hypot(b[0] - a[0], b[1] - a[1]) <
                0.035
              );
            })
          )
            continue;
          const ray = new Ray(new Vector3(x, y + 0.1, z), new Vector3(0, -1, 0));
          samples++;
          assert.ok(
            intersectBVH(ray, data.land) || intersectBVH(ray, data.stone),
            'open stair surface in cell ' + cell.id,
          );
        }
    }
  assert.ok(samples > 5000);
});
