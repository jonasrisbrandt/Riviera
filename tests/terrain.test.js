import test from 'node:test';
import assert from 'node:assert/strict';
import { Ray, Vector3 } from 'three';
import { makeGrid, demoTown } from '../src/grid.js';
import { serialize, deserialize, History } from '../src/state.js';
import { sculpt, elevation, MAX_TERRAIN } from '../src/terrain.js';
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
  assert.equal(elevation(restored, center.id), 1);
  assert.equal(serialize(history.undo(town, cells.length)), old);
  const before = deserialize(old, cells.length);
  assert.equal(serialize(history.redo(before, cells.length)), saved);
  for (const terrain of [
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
  for (let i = 0; i < 20; i++) sculpt(town, center.id, 'raise');
  assert.equal(elevation(town, center.id), MAX_TERRAIN);
  assert.equal(JSON.stringify([...town]), houses);
  sculpt(town, center.id, 'paint', 4);
  assert.deepEqual(town.terrain.get(center.id), [12, 4]);
  for (let i = 0; i < 20; i++) sculpt(town, center.id, 'lower');
  assert.equal(elevation(town, center.id), 0);
  assert.equal(JSON.stringify([...town]), houses);
  assert.equal(sculpt(town, center.id, 'lower'), false);
  town.set(center.id, Array(24).fill(1));
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
test('automatic stairs have supported steps and a real opening in the grass', () => {
  const town = landscapeDemo(cells),
    engine = new BuildEngine(cells);
  engine.build(town, new Map(), town.terrain);
  const entries = [...engine.cache.values()].filter((c) => c.stairs);
  assert.ok(entries.length > 5);
  for (const data of entries) {
    const height = elevation(town, data.id),
      low = (height - 1) * FLOOR;
    const steps = data.instances.box.filter((i) => i.key === -2 && i.s[0] > 0.5 && i.s[2] < 0.2);
    assert.equal(steps.length, 16);
    for (const step of steps) assert.ok(step.p[1] - step.s[1] / 2 >= low - 1e-7);
    const middle = steps[8].p,
      ray = new Ray(new Vector3(middle[0], height * FLOOR + 0.1, middle[2]), new Vector3(0, -1, 0));
    const top = intersectBVH(ray, data.land);
    assert.ok(!top || top.distance > 0.12, 'grass must not cover the stairwell');
  }
});
