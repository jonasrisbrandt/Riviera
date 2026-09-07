import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGrid, inside, demoTown } from '../src/grid.js';
import { serialize, deserialize, History } from '../src/state.js';
const grid = makeGrid();
test('organic quad mesh has consistent winding, shared edges and reciprocal neighbors', () => {
  assert.ok(grid.cells.length > 1000);
  let unusualValences = 0;
  const counts = new Map();
  for (const c of grid.cells) {
    assert.equal(c.points.length, 4);
    assert.ok(inside(c.center, c.points));
    let area = 0;
    for (let i = 0; i < 4; i++) {
      const a = c.points[i],
        b = c.points[(i + 1) % 4];
      area += a[0] * b[1] - a[1] * b[0];
      const n = c.neighbors[i];
      if (n >= 0) {
        const neighbor = grid.cells[n];
        assert.ok(neighbor.neighbors.includes(c.id));
        assert.ok(neighbor.vertices.includes(c.vertices[i]));
        assert.ok(neighbor.vertices.includes(c.vertices[(i + 1) % 4]));
      }
      counts.set(c.vertices[i], (counts.get(c.vertices[i]) || 0) + 1);
    }
    assert.ok(area > 0.1);
  }
  for (const n of counts.values()) if (n === 3 || n === 5) unusualValences++;
  assert.ok(unusualValences > 30, 'must contain genuinely irregular connectivity');
});
test('grid and initial harbour are deterministic across reloads', () => {
  assert.deepEqual(makeGrid(), grid);
  assert.equal(serialize(demoTown(grid.cells)), serialize(demoTown(makeGrid().cells)));
});
test('save files round-trip sparse elevated buildings', () => {
  const town = new Map([
    [4, [0, null, 3]],
    [9, [null, null, 7]],
  ]);
  assert.deepEqual(deserialize(serialize(town), grid.cells.length), town);
});
test('invalid, duplicate, oversized and out-of-range save data is rejected', () => {
  for (const cells of [
    [[1, [12]]],
    [[1, [-1]]],
    [[1, [null]]],
    [[1, Array(26).fill(0)]],
    [
      [1, [0]],
      [1, [1]],
    ],
    [[999999, [1]]],
  ])
    assert.throws(() =>
      deserialize(JSON.stringify({ version: 1, gridSeed: 81, cells }), grid.cells.length),
    );
  assert.throws(() => deserialize('{broken', grid.cells.length));
});
test('undo and redo preserve blocks and reset the redo branch after a new edit', () => {
  const h = new History();
  let town = new Map([[1, [0]]]);
  h.push(town);
  town.set(1, [0, 2]);
  town = h.undo(town, grid.cells.length);
  assert.deepEqual(town.get(1), [0]);
  town = h.redo(town, grid.cells.length);
  assert.deepEqual(town.get(1), [0, 2]);
  town = h.undo(town, grid.cells.length);
  h.push(town);
  town.set(2, [0]);
  assert.equal(h.future.length, 0);
});
