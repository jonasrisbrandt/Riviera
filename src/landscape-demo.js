import { sculpt } from './terrain.js';
import { random } from './grid.js';
export function landscapeDemo(cells) {
  const town = new Map(),
    terrain = new Map();
  town.terrain = terrain;
  for (const c of cells) {
    const [x, z] = c.center;
    const radius = Math.hypot(x / 1.12, (z + 1) / 0.94);
    const edge = 10.4 + Math.sin(x * 0.7 + z * 0.3) * 0.6 + Math.cos(z * 1.2) * 0.4;
    const bay = Math.hypot((x - 0.7) * 0.95, z - 5.9) < 4.3;
    if (radius > edge || bay) continue;
    const h = Math.max(
      1,
      Math.min(7, 1 + Math.floor((10.7 - radius) * 0.62 + Math.max(0, -z - 1) * 0.22)),
    );
    const coastHeight = Math.min(
      h,
      2 + Math.floor(Math.max(0, Math.hypot((x - 0.7) * 0.95, z - 5.9) - 4.3) * 1.3),
    );
    terrain.set(c.id, [coastHeight, h === 1 && z > 4 && x > 0 ? 4 : 0]);
  }
  // Loose groups follow the terraces, leaving substantial green land between them.
  for (const c of cells) {
    const t = terrain.get(c.id);
    if (!t) continue;
    const [x, z] = c.center,
      rng = random(c.id * 71 + 6);
    const lane = Math.abs(x + 1.3 + Math.sin(z * 0.48) * 1.3) < 0.8;
    const waterfront = z > 0.5 && z < 4.8;
    const ridge = z < -1 && Math.abs(x - 1.5) < 2.7;
    const hamlet = x < -4.8 && z < 0 && z > -5;
    if (!lane && (waterfront || ridge || hamlet) && rng() < 0.57) {
      const n = 1 + Math.floor(rng() * 3);
      town.set(c.id, [0, ...Array(n).fill([0, 1, 2, 3, 4, 5, 8][Math.floor(rng() * 7)])]);
    } else if (lane && z > 1) town.set(c.id, [0]);
  }
  const nearest = (x, z) =>
    cells.reduce((a, b) =>
      Math.hypot(a.center[0] - x, a.center[1] - z) < Math.hypot(b.center[0] - x, b.center[1] - z)
        ? a
        : b,
    );
  const tower = nearest(0.8, -4);
  if (terrain.has(tower.id)) town.set(tower.id, [0, 2, 2, 2]);
  // A low stone waterfront curls around the sheltered water.
  for (const c of cells) {
    const [x, z] = c.center;
    if ((z > 6.2 && z < 7.7 && x > -5 && x < 1) || (x < -3.5 && x > -5 && z > 4 && z < 7.4)) {
      terrain.delete(c.id);
      town.set(c.id, [0]);
    }
  }
  // Half terraces and a few continuous green ramps show the finer sculpting scale.
  for (const c of cells) {
    const t = terrain.get(c.id);
    if (!t || town.has(c.id)) continue;
    if (t[1] === 4) t[0] = 0.5;
    else if (
      c.id % 4 === 1 &&
      t[0] > 1 &&
      c.neighbors.some((n) => terrain.get(n)?.[0] === t[0] - 1)
    )
      terrain.set(c.id, [t[0] - 0.5, t[1]]);
  }
  for (const c of cells)
    if (c.id % 3 === 1 && !town.has(c.id)) sculpt(town, c.id, 'slope', 0, cells);
  return town;
}
