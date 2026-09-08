import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGrid } from '../src/grid.js';
import { serialize, deserialize, History } from '../src/state.js';
import { manualLaundryPair, laundryPairs } from '../src/laundry-layout.js';
const { cells } = makeGrid();
const nearest = (x, z) =>
  cells.reduce((a, b) =>
    Math.hypot(a.center[0] - x, a.center[1] - z) < Math.hypot(b.center[0] - x, b.center[1] - z)
      ? a
      : b,
  );
const a = nearest(-3, 0),
  b = nearest(3, 0);
test('manual laundry crosses multiple cells, follows chosen storeys and rejects obstructions', () => {
  const town = new Map([
    [a.id, [0, 1, 1]],
    [b.id, [0, 2, 2]],
  ]);
  assert.ok(manualLaundryPair(cells, town, [a.id, 2], [b.id, 2]).pair);
  assert.ok(manualLaundryPair(cells, town, [a.id, 2], [a.id, 2]).error);
  assert.ok(manualLaundryPair(cells, town, [a.id, 3], [b.id, 2]).error);
  const middle = nearest(0, 0);
  town.set(middle.id, [0, 1, 1, 1]);
  assert.ok(manualLaundryPair(cells, town, [a.id, 2], [b.id, 2]).error);
  town.delete(middle.id);
  town.terrain = new Map([[middle.id, [4, 0]]]);
  assert.ok(manualLaundryPair(cells, town, [a.id, 2], [b.id, 2]).error);
});
test('manual laundry and disabled overrides survive save, undo and redo', () => {
  const town = new Map([
    [a.id, [0, 1, 1]],
    [b.id, [0, 2, 2]],
  ]);
  const history = new History();
  history.push(town);
  town.clotheslines = [[a.id, 2, b.id, 2]];
  const saved = serialize(town),
    restored = deserialize(saved, cells.length);
  assert.equal(serialize(restored), saved);
  assert.equal(laundryPairs(cells, restored).filter((p) => p.key.startsWith('manual:')).length, 1);
  const before = history.undo(town, cells.length);
  assert.ok(!before.clotheslines);
  assert.equal(serialize(history.redo(before, cells.length)), saved);
  town.clotheslines = [[a.id, 0, b.id, 0]];
  assert.equal(laundryPairs(cells, deserialize(serialize(town), cells.length)).length, 0);
  for (const line of [
    [a.id, 1, a.id, 1],
    [a.id, 0, b.id, 1],
    [a.id, 1.5, b.id, 1],
    [a.id, 25, b.id, 1],
    [-1, 1, b.id, 1],
  ])
    assert.throws(() =>
      deserialize(
        JSON.stringify({ version: 2, gridSeed: 81, cells: [], terrain: [], clotheslines: [line] }),
        cells.length,
      ),
    );
});
