import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { makeGrid } from '../src/grid.js';
import { BuildEngine } from '../src/build-engine.js';
import { groundY, sculpt } from '../src/terrain.js';
import { History, serialize, deserialize } from '../src/state.js';

// Samma rena byggmotor som används av browserns worker. Labbet behöver ingen GPU.
const { cells } = makeGrid();
const a = cells.reduce((best, cell) =>
  Math.hypot(...cell.center) < Math.hypot(...best.center) ? cell : best,
);
const b = cells[a.neighbors.find((id) => id >= 0)];
let town = new Map([
  [a.id, [0, 1, 1]],
  [b.id, [0, 2, 2, 2]],
]);
town.terrain = new Map([
  [a.id, [1.5, 0]],
  [b.id, [0.5, 0]],
]);
const history = new History();
const engine = new BuildEngine(cells);
const first = engine.build(town);
const ack = new Map(first.chunks.map((chunk) => [chunk.key, chunk.version]));

console.log('1. Data: två grannhus med olika antal lokala våningar');
console.table(
  [a, b].map((c) => ({
    cell: c.id,
    marknivå: town.terrain.get(c.id)[0],
    markY: Number(groundY(town, c.id).toFixed(2)),
    husvåningar: town.get(c.id).length - 1,
    absolutTaknivå: town.terrain.get(c.id)[0] + town.get(c.id).length - 1,
  })),
);
const roofA = a.id * 32 + 3.5;
const roofB = b.id * 32 + 3.5;
assert.ok(engine.plans.has(roofA) && engine.plans.has(roofB), 'Båda taken måste ha en plan');
assert.equal(engine.plans.get(roofA), engine.plans.get(roofB));
console.log('Samma absoluta taknivå 3,5: husen delar takplan.');
assert.equal(engine.build(town, ack).chunks.length, 0);
console.log('2. Oförändrad värld + kvitterade områden: 0 områden överförs.');

history.push(town);
sculpt(town, a.id, 'raise');
const changed = engine.build(town, ack);
assert.equal(town.terrain.get(a.id)[0], 2);
assert.ok(engine.plans.has(a.id * 32 + 4) && engine.plans.has(roofB));
assert.notEqual(engine.plans.get(a.id * 32 + 4), engine.plans.get(roofB));
console.log('3. Höj första huset med ett halvsteg: takplanen delas.');
console.log({
  rebuiltCells: changed.stats.rebuiltCells,
  changedChunks: changed.stats.changedChunks,
});

// Jämför en inkrementell ombyggnad med att generera samma värld helt från början.
const fresh = new BuildEngine(cells);
fresh.build(town);
for (const [id, data] of engine.cache)
  for (const kind of ['wall', 'roof', 'stone', 'land'])
    assert.deepEqual(data[kind].attributes, fresh.cache.get(id)[kind].attributes);
console.log('4. Inkrementell och fullständig byggning ger identiska mesh-attribut.');

town = history.undo(town, cells.length);
assert.equal(town.terrain.get(a.id)[0], 1.5);
const output = new URL('../artifacts/tutorial-town.json', import.meta.url);
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
const json = serialize(town);
assert.equal(serialize(deserialize(json, cells.length)), json);
await writeFile(output, json);
console.log('5. Ångrat och sparat: artifacts/tutorial-town.json');
console.log('Importera filen via Inställningar → Öppna by för att se de två husen.');
