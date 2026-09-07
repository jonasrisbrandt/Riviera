import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGrid } from '../src/grid.js';
import { supportPlan } from '../src/supports.js';
import { planRoofs, roofPatch, ridgeCapQuads, ROOF_EAVE } from '../src/roofs.js';
const { cells } = makeGrid();
const center = cells.reduce((a, b) => (Math.hypot(...a.center) < Math.hypot(...b.center) ? a : b));
const vertexCells = new Map();
for (const c of cells)
  for (const v of c.vertices) {
    if (!vertexCells.has(v)) vertexCells.set(v, []);
    vertexCells.get(v).push(c.id);
  }
test('high cantilevers do not sprout dangling arches or columns', () => {
  const town = new Map([[center.id, [0, null, null, null, 2]]]);
  const p = supportPlan(center, 4, town, vertexCells);
  assert.equal(p.underside, true);
  assert.deepEqual(p.arches, []);
  assert.deepEqual(p.columns, []);
});
test('a real missing storey above a foundation still produces an arcade', () => {
  const town = new Map([[center.id, [0, null, 2]]]);
  const p = supportPlan(center, 2, town, vertexCells);
  assert.equal(p.arches.length, 4);
  assert.equal(p.columns.length, 4);
});
test('one supporting wall cannot produce arches with an unsupported outer foot', () => {
  const neighbor = cells[center.neighbors[0]],
    town = new Map([
      [neighbor.id, [0, 1, 1, 1]],
      [center.id, [null, null, null, 2]],
    ]);
  const p = supportPlan(center, 3, town, vertexCells);
  assert.equal(p.arches.length, 0);
  assert.equal(p.columns.length, 0);
  assert.deepEqual(p.corbels, [0]);
});
test('all arch endpoints have bearing surfaces, including non-four-valent corners', () => {
  const town = new Map();
  for (const c of cells)
    if (Math.hypot(...c.center) < 7) town.set(c.id, c.id % 3 ? [0, 2, 2] : [null, null, 2]);
  for (const c of cells) {
    const p = supportPlan(c, 2, town, vertexCells);
    for (const e of p.arches)
      for (const k of [e, (e + 1) % 4])
        assert.ok(vertexCells.get(c.vertices[k]).some((id) => town.get(id)?.[0] != null));
  }
});
test('joined roofs share their field, coordinates and height across cell seams', () => {
  const neighbor = cells[center.neighbors[0]],
    town = new Map([
      [center.id, [0, 2]],
      [neighbor.id, [0, 3]],
    ]);
  const plans = planRoofs(cells, town),
    a = plans.get(center.id * 32 + 1),
    b = plans.get(neighbor.id * 32 + 1);
  assert.equal(a, b);
  assert.equal(a.edges.length, 6);
  for (const v of center.vertices.filter((v) => neighbor.vertices.includes(v))) {
    const p = a.points.get(v);
    assert.deepEqual(a.sample(...p), b.sample(...p));
  }
  const patch = roofPatch(center, a);
  assert.ok(patch.triangles.length > 50);
  for (const tri of patch.triangles)
    for (const v of tri.vertices) {
      assert.ok(Number.isFinite(v.height));
      assert.ok(v.height >= ROOF_EAVE);
      assert.ok(v.normal[1] > 0);
    }
});
test('roofs across a height change stay separate and roofs below gaps remain present', () => {
  const neighbor = cells[center.neighbors[0]],
    town = new Map([
      [center.id, [0, 2, null, 2]],
      [neighbor.id, [0, 3, 3]],
    ]);
  const plans = planRoofs(cells, town);
  assert.ok(plans.has(center.id * 32 + 1));
  assert.ok(plans.has(center.id * 32 + 3));
  assert.ok(plans.has(neighbor.id * 32 + 2));
  assert.notEqual(plans.get(center.id * 32 + 1), plans.get(neighbor.id * 32 + 2));
});

test('ridge tiles stay embedded in rendered roof triangles instead of floating over them', () => {
  const town = new Map(
    cells.filter((c) => Math.hypot(...c.center) < 5).map((c) => [c.id, [0, c.id % 4]]),
  );
  const plans = planRoofs(cells, town);
  let count = 0,
    maxIdealGap = 0;
  for (const id of town.keys()) {
    const plan = plans.get(id * 32 + 1),
      patch = roofPatch(cells[id], plan);
    // Independent triangle-plane checks guard against accidentally using the
    // smooth field again when constructing the ridge skirts.
    for (const [a, b] of patch.ridges)
      for (const p of [a, b])
        maxIdealGap = Math.max(maxIdealGap, p.height - plan.surfaceHeight(p.x, p.z));
    for (const quad of ridgeCapQuads(patch, plan)) {
      count++;
      const offsets = quad.map(([x, y, z]) => {
        const h = plan.surfaceHeight(x, z);
        assert.notEqual(h, null, 'cap vertices must remain within the roof footprint');
        assert.ok(y - h <= 0.024001, 'crest remains close to the actual surface');
        assert.ok(y - h >= -0.009001);
        return y - h;
      });
      // The two outermost strips sink their entire outside edge into the roof.
      if (offsets.some((v) => v < 0)) {
        const skirt = quad.filter((_, i) => offsets[i] < 0);
        assert.equal(skirt.length, 2);
        for (const t of [0.25, 0.5, 0.75]) {
          const [a, b] = skirt,
            x = a[0] + (b[0] - a[0]) * t,
            y = a[1] + (b[1] - a[1]) * t,
            z = a[2] + (b[2] - a[2]) * t;
          assert.ok(
            y <= plan.surfaceHeight(x, z) + 0.001,
            'no daylight under the skirts between vertices',
          );
        }
      }
    }
  }
  assert.ok(count > 100);
  assert.ok(maxIdealGap < 0.00001, 'ridge lines must be actual edges of the rendered mesh');
});
