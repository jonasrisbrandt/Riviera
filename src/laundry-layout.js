import { BASE, FLOOR } from './palette.js';
import { groundY } from './terrain.js';
import { inside } from './grid.js';
export function automaticLaundryPairs(cells, town) {
  const pairs = [];
  for (const cell of cells) {
    if ((town.get(cell.id)?.length || 0) > 1) continue;
    for (let e = 0; e < 2; e++) {
      const a = cells[cell.neighbors[e]],
        b = cells[cell.neighbors[e + 2]];
      if (!a || !b) continue;
      const la = town.get(a.id),
        lb = town.get(b.id);
      if (la?.[1] == null || lb?.[1] == null) continue;
      const ya = groundY(town, a.id) + BASE + (la.length - 1) * FLOOR - 0.29;
      const yb = groundY(town, b.id) + BASE + (lb.length - 1) * FLOOR - 0.29;
      if (Math.abs(ya - yb) > 1.3 || Math.min(ya, yb) - 0.65 < groundY(town, cell.id)) continue;
      const midpoint = (edge) => {
        const p = cell.points[edge],
          q = cell.points[(edge + 1) % 4];
        return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      };
      const pa = midpoint(e),
        pb = midpoint(e + 2),
        length = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
      if (length < 1 || length > 3.5) continue;
      pairs.push({
        key: [cell.id, e, ya, yb].join(':'),
        id: cell.id,
        houses: [a.id, b.id],
        a: [pa[0], ya, pa[1]],
        b: [pb[0], yb, pb[1]],
      });
      break;
    }
  }
  return pairs;
}

export const laundryKey = (a, b) => [a, b].sort((a, b) => a - b).join(':');
function facingAnchor(cell, other, y) {
  const [x, z] = cell.center,
    dx = other.center[0] - x,
    dz = other.center[1] - z;
  let nearest = Infinity;
  for (let e = 0; e < 4; e++) {
    const a = cell.points[e],
      b = cell.points[(e + 1) % 4],
      ex = b[0] - a[0],
      ez = b[1] - a[1],
      cross = dx * ez - dz * ex;
    if (Math.abs(cross) < 1e-8) continue;
    const t = ((a[0] - x) * ez - (a[1] - z) * ex) / cross,
      u = ((a[0] - x) * dz - (a[1] - z) * dx) / cross;
    if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6) nearest = Math.min(nearest, t);
  }
  return [x + dx * (nearest - 0.006), y, z + dz * (nearest - 0.006)];
}
export function manualLaundryPair(cells, town, from, to) {
  const [aid, al] = from,
    [bid, bl] = to;
  if (aid === bid) return { error: 'Välj ett annat hus.' };
  if (
    !cells[aid] ||
    !cells[bid] ||
    al < 1 ||
    bl < 1 ||
    town.get(aid)?.[al] == null ||
    town.get(bid)?.[bl] == null
  )
    return { error: 'Välj en husvåning i båda ändarna.' };
  const a = facingAnchor(cells[aid], cells[bid], groundY(town, aid) + BASE + al * FLOOR - 0.29);
  const b = facingAnchor(cells[bid], cells[aid], groundY(town, bid) + BASE + bl * FLOOR - 0.29);
  const length = Math.hypot(a[0] - b[0], a[2] - b[2]);
  if (length < 0.45) return { error: 'Husen behöver ett mellanrum för tvätten.' };
  if (length > 8) return { error: 'Välj två hus närmare varandra.' };
  if (Math.abs(a[1] - b[1]) > 2.5) return { error: 'Välj våningar på mer liknande höjd.' };
  const obstacles = [...new Set([...town.keys(), ...(town.terrain?.keys() || [])])]
    .filter((id) => id !== aid && id !== bid)
    .map((id) => ({
      cell: cells[id],
      top:
        groundY(town, id) +
        (town.has(id)
          ? BASE +
            ((town.get(id)?.length || 1) - 1) * FLOOR +
            ((town.get(id)?.length || 1) > 1 ? 0.65 : 0)
          : 0),
    }));
  for (let k = 1, n = Math.ceil(length / 0.08); k < n; k++) {
    const t = k / n,
      x = a[0] + (b[0] - a[0]) * t,
      z = a[2] + (b[2] - a[2]) * t,
      y = a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * 0.17 - 0.44;
    if (obstacles.some((o) => o.top > y && inside([x, z], o.cell.points)))
      return {
        error: 'Ett hus eller marken är i vägen. Välj en högre våning eller ett annat hus.',
      };
  }
  return {
    pair: {
      key: 'manual:' + laundryKey(aid, bid) + ':' + [al, bl, ...a, ...b].join(':'),
      id: aid,
      houses: [aid, bid],
      a,
      b,
    },
  };
}
export function laundryPairs(cells, town) {
  const overrides = town.clotheslines || [],
    keys = new Set(overrides.map(([a, , b]) => laundryKey(a, b)));
  const pairs = automaticLaundryPairs(cells, town).filter(
    (p) => !keys.has(laundryKey(...p.houses)),
  );
  for (const [a, al, b, bl] of overrides)
    if (al && bl) {
      const result = manualLaundryPair(cells, town, [a, al], [b, bl]);
      if (result.pair) pairs.push(result.pair);
    }
  return pairs;
}
