import test from 'node:test';
import assert from 'node:assert/strict';
import { Ray, Vector3 } from 'three';
import { cornerHeights, sculpt } from '../src/terrain.js';
import { terrainPoint } from '../src/terrain-builder.js';
import { edgeSurface, surfaceSample } from '../src/terrain-surface.js';
import { BuildEngine } from '../src/build-engine.js';
import { intersectBVH } from '../src/spatial.js';
import { FLOOR } from '../src/palette.js';
function fixture() {
  const cells = [];
  for (let z = 0; z < 4; z++)
    for (let x = 0; x < 4; x++)
      cells.push({
        id: z * 4 + x,
        vertices: [z * 5 + x, z * 5 + x + 1, (z + 1) * 5 + x + 1, (z + 1) * 5 + x],
        points: [
          [x * 2, z * 2],
          [(x + 1) * 2, z * 2],
          [(x + 1) * 2, (z + 1) * 2],
          [x * 2, (z + 1) * 2],
        ],
        center: [x * 2 + 1, z * 2 + 1],
        neighbors: [
          z > 0 ? (z - 1) * 4 + x : -1,
          x < 3 ? z * 4 + x + 1 : -1,
          z < 3 ? (z + 1) * 4 + x : -1,
          x > 0 ? z * 4 + x - 1 : -1,
        ],
      });
  const town = new Map();
  town.terrain = new Map(
    cells.map((c) => [c.id, [Math.floor(c.id / 4) + 1, 1, ...(c.id >= 4 ? [0] : [])]]),
  );
  return { cells, town };
}
const tops = (cells, town, c) =>
  cornerHeights(c, town.terrain, town, cells).map((h, k) => terrainPoint(c.points[k], h));
const close = (a, b) => a.forEach((v, k) => assert.ok(Math.abs(v - b[k]) < 1e-8, `${a} != ${b}`));
test('slope strips share their complete boundary both along and across the hillside', () => {
  const { cells, town } = fixture();
  let longitudinal = 0,
    lateral = 0;
  for (const c of cells)
    for (const e of [1, 2]) {
      const neighbor = cells[c.neighbors[e]];
      if (!neighbor) continue;
      const a = tops(cells, town, c),
        b = tops(cells, town, neighbor),
        back = neighbor.neighbors.indexOf(c.id);
      for (let j = 0; j <= 32; j++)
        close(
          edgeSurface(a[e], a[(e + 1) % 4], j / 32),
          edgeSurface(b[(back + 1) % 4], b[back], j / 32),
        );
      e === 1 ? lateral++ : longitudinal++;
    }
  assert.ok(longitudinal >= 12 && lateral >= 12);
});
test('opposing slope directions blend sideways, while house foundations remain level', () => {
  const { cells, town } = fixture();
  town.terrain.set(5, [2, 1, 0]);
  town.terrain.set(6, [2, 1, 2]);
  town.terrain.set(10, [1, 1]);
  const a = tops(cells, town, cells[5]),
    b = tops(cells, town, cells[6]);
  for (let j = 0; j <= 32; j++)
    close(edgeSurface(a[1], a[2], j / 32), edgeSurface(b[0], b[3], j / 32));
  town.set(5, [0, 1]);
  assert.deepEqual(cornerHeights(cells[5], town.terrain, town, cells), Array(4).fill(2 * FLOOR));
});
test('curved hillside is pickable everywhere and surface samples root details in actual triangles', () => {
  const { cells, town } = fixture(),
    engine = new BuildEngine(cells);
  engine.build(town);
  for (const id of [5, 6, 9, 10]) {
    const top = tops(cells, town, cells[id]),
      land = engine.cache.get(id).land;
    for (let i = 1; i < 20; i++)
      for (let j = 1; j < 20; j++) {
        const p = surfaceSample(top, i / 20, j / 20);
        const hit = intersectBVH(new Ray(new Vector3(p[0], 20, p[2]), new Vector3(0, -1, 0)), land);
        assert.ok(hit);
        assert.ok(Math.abs(20 - hit.distance - p[1]) < 2e-5);
      }
    assert.ok(engine.cache.get(id).instances.sphere.length > 0);
  }
});
test('slope edits, neighbor elevations and foundations invalidate all affected shoulders', () => {
  const { cells, town } = fixture(),
    engine = new BuildEngine(cells);
  engine.build(town);
  const actions = [
    () => town.terrain.set(5, [2, 1]),
    () => sculpt(town, 6, 'lower'),
    () => town.set(9, [0, 1]),
    () => town.delete(9),
    () => sculpt(town, 5, 'slope', 1, cells),
  ];
  for (const edit of actions) {
    edit();
    engine.build(town);
    const fresh = new BuildEngine(cells);
    fresh.build(town);
    for (const [id, data] of engine.cache) {
      for (const kind of ['land', 'stone', 'wall', 'roof'])
        assert.deepEqual(
          data[kind].attributes,
          fresh.cache.get(id)[kind].attributes,
          `${kind} ${id}`,
        );
      assert.deepEqual(data.instances, fresh.cache.get(id).instances);
    }
  }
});
