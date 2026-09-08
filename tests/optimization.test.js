import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  Ray,
  Vector3,
  BufferGeometry,
  BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
} from 'three';
import { BuildEngine } from '../src/build-engine.js';
import { makeGrid, demoTown } from '../src/grid.js';
import { intersectBVH, SpatialIndex } from '../src/spatial.js';
import { ITEM_SIZE } from '../src/geometry-data.js';

const { cells } = makeGrid();
const baseline = JSON.parse(readFileSync(new URL('./geometry-baseline.json', import.meta.url)));
function cellHashes(engine) {
  const result = {};
  for (const [id, cell] of engine.cache)
    for (const kind of ['wall', 'roof', 'stone']) {
      const data = cell[kind];
      if (!data.faces.length) continue;
      const hash = createHash('sha256');
      for (let f = 0; f < data.faces.length / 3; f++)
        for (const [key, size] of Object.entries(ITEM_SIZE)) {
          const array = data.attributes[key].subarray(f * 3 * size, (f + 1) * 3 * size);
          hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
        }
      result[kind + ':' + id] = hash.digest('hex');
    }
  return result;
}
test('worker geometry is byte-identical to pre-optimization walls, roofs, stone and support fixtures', () => {
  for (const fixture of Object.values(baseline)) {
    const engine = new BuildEngine(cells);
    const result = engine.build(new Map(fixture.town));
    assert.deepEqual(cellHashes(engine), fixture.hashes);
    for (const key of ['cells', 'blocks', 'floors', 'instances', 'arches', 'corbels'])
      assert.equal(
        result.stats[key] - (key === 'instances' ? result.stats.heroInstances : 0),
        fixture.stats[key],
      );
  }
});
test('incremental output matches a fresh build after edits, roof joins/splits and diagonal support changes', () => {
  const town = demoTown(cells),
    engine = new BuildEngine(cells);
  let r = engine.build(town),
    ack = new Map(r.chunks.map((c) => [c.key, c.version]));
  const noChange = engine.build(town, ack);
  assert.equal(noChange.chunks.length, 0);
  assert.equal(noChange.stats.rebuiltCells, 0);
  const id = [...town].find(([, l]) => l.length > 2)[0],
    original = town.get(id).slice();
  for (const levels of [[...original, 3], original, [0, null, 3], [0, 3], original]) {
    town.set(id, levels.slice());
    r = engine.build(town, ack);
    const fresh = new BuildEngine(cells);
    fresh.build(town);
    assert.deepEqual(cellHashes(engine), cellHashes(fresh));
    assert.ok(r.stats.rebuiltCells < town.size, 'a local edit leaves distant geometry intact');
    for (const c of r.chunks) ack.set(c.key, c.version);
  }
  town.delete(id);
  engine.build(town, ack);
  const fresh = new BuildEngine(cells);
  fresh.build(town);
  assert.deepEqual(cellHashes(engine), cellHashes(fresh));
});
test('unacknowledged chunk updates survive superseded worker results and deletions', () => {
  const engine = new BuildEngine(cells),
    town = demoTown(cells),
    first = engine.build(town),
    ack = new Map(first.chunks.map((c) => [c.key, c.version]));
  const id = town.keys().next().value;
  town.set(id, [0, 4, 4, 4]);
  const ignored = engine.build(town, ack);
  assert.ok(ignored.chunks.length);
  const retry = engine.build(town, ack);
  assert.deepEqual(
    retry.chunks.map((c) => [c.key, c.version]),
    ignored.chunks.map((c) => [c.key, c.version]),
  );
  const clear = engine.build(new Map(), ack);
  assert.ok(clear.chunks.every((c) => c.empty));
  const restored = engine.build(demoTown(cells), ack);
  assert.ok(restored.chunks.every((c) => !c.empty));
});
test('BVH returns the same closest triangle and metadata as brute-force Three raycasting', () => {
  const r = new BuildEngine(cells).build(demoTown(cells)),
    entries = [];
  for (const chunk of r.chunks)
    for (const data of Object.values(chunk.meshes))
      if (data.faces.length) {
        const geometry = new BufferGeometry().setAttribute(
          'position',
          new BufferAttribute(data.attributes.position, 3),
        );
        const mesh = new Mesh(geometry, new MeshBasicMaterial());
        mesh.updateMatrixWorld();
        entries.push({ data, mesh });
      }
  const raycaster = new Raycaster();
  for (let i = 0; i < 250; i++) {
    const origin = new Vector3(Math.sin(i * 1.71) * 25, 5 + (i % 30), Math.cos(i * 2.31) * 25),
      target = new Vector3(Math.sin(i * 0.31) * 12, i % 6, Math.cos(i * 0.47) * 12);
    const ray = new Ray(origin, target.sub(origin).normalize());
    raycaster.ray.copy(ray);
    const expected = raycaster.intersectObjects(
      entries.map((e) => e.mesh),
      false,
    )[0];
    let actual = null;
    for (const { data } of entries) {
      const h = intersectBVH(ray, data, actual?.distance ?? Infinity);
      if (h) actual = h;
    }
    assert.equal(!!actual, !!expected);
    if (expected) {
      assert.ok(Math.abs(actual.distance - expected.distance) < 1e-5);
      const data = entries.find((e) => e.mesh === expected.object).data;
      assert.equal(actual.meta.id, data.faces[expected.faceIndex * 3]);
      assert.equal(actual.meta.level, data.faces[expected.faceIndex * 3 + 1]);
    }
  }
});
test('spatial lookup includes shared bin boundaries and negative coordinates', () => {
  const item = { x0: -2, x1: 0, z0: 0, z1: 2 };
  const index = new SpatialIndex([item]);
  assert.ok(index.at(-2, 0).includes(item));
  assert.ok(index.at(0, 2).includes(item));
  assert.deepEqual(index.at(20, 20), []);
});
