import Delaunator from 'delaunator';
export function random(seed = 1) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function makeGrid(radius = 37, seed = 81) {
  const rng = random(seed),
    points = [];
  for (let j = -15; j <= 15; j++)
    for (let i = -15; i <= 15; i++) {
      const x = (i + (j & 1) * 0.5) * 3.15 + (rng() - 0.5) * 1.05,
        z = j * 2.73 + (rng() - 0.5) * 1.05;
      if (Math.hypot(x, z) < radius) points.push([x, z]);
    }
  const d = Delaunator.from(points),
    tri = d.triangles,
    used = new Set(),
    polys = [];
  const order = Array.from({ length: tri.length / 3 }, (_, i) => i).sort(
    (a, b) => Math.sin(a * 78.1) - Math.sin(b * 78.1),
  );
  for (const t of order) {
    if (used.has(t)) continue;
    let best = null,
      score = Infinity;
    for (let e = 0; e < 3; e++) {
      const he = t * 3 + e,
        opp = d.halfedges[he],
        nt = Math.floor(opp / 3);
      if (opp < 0 || used.has(nt)) continue;
      const ids = [...new Set([...tri.slice(t * 3, t * 3 + 3), ...tri.slice(nt * 3, nt * 3 + 3)])];
      const center = ids.reduce(
        (p, k) => [p[0] + points[k][0] / 4, p[1] + points[k][1] / 4],
        [0, 0],
      );
      ids.sort(
        (a, b) =>
          Math.atan2(points[a][1] - center[1], points[a][0] - center[0]) -
          Math.atan2(points[b][1] - center[1], points[b][0] - center[0]),
      );
      const cross = ids.map((id, k) => {
        const a = points[id],
          b = points[ids[(k + 1) % 4]],
          c = points[ids[(k + 2) % 4]];
        return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      });
      if (cross.some((v) => v < 0.1)) continue;
      const lens = ids.map((id, k) =>
        Math.hypot(
          points[id][0] - points[ids[(k + 1) % 4]][0],
          points[id][1] - points[ids[(k + 1) % 4]][1],
        ),
      );
      const s = Math.max(...lens) / Math.min(...lens);
      if (s < score) {
        score = s;
        best = { nt, ids };
      }
    }
    used.add(t);
    if (best) {
      used.add(best.nt);
      polys.push(best.ids);
    } else {
      const ids = Array.from(tri.slice(t * 3, t * 3 + 3));
      const a = points[ids[0]],
        b = points[ids[1]],
        c = points[ids[2]];
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0) ids.reverse();
      polys.push(ids);
    }
  }
  const vertices = points.map((p) => p.slice()),
    midpoints = new Map(),
    quads = [];
  function midpoint(a, b) {
    const key = [a, b].sort((a, b) => a - b).join(':');
    if (!midpoints.has(key)) {
      midpoints.set(key, vertices.length);
      vertices.push([(points[a][0] + points[b][0]) / 2, (points[a][1] + points[b][1]) / 2]);
    }
    return midpoints.get(key);
  }
  for (const p of polys) {
    const center = vertices.length;
    vertices.push(
      p.reduce((c, k) => [c[0] + points[k][0] / p.length, c[1] + points[k][1] / p.length], [0, 0]),
    );
    for (let k = 0; k < p.length; k++)
      quads.push([
        p[k],
        midpoint(p[k], p[(k + 1) % p.length]),
        center,
        midpoint(p[(k + p.length - 1) % p.length], p[k]),
      ]);
  }
  const adjacent = vertices.map(() => new Set()),
    edgeCounts = new Map();
  for (const q of quads)
    for (let i = 0; i < 4; i++) {
      const a = q[i],
        b = q[(i + 1) % 4];
      adjacent[a].add(b);
      adjacent[b].add(a);
      const key = [a, b].sort((a, b) => a - b).join(':');
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    }
  const boundary = new Set();
  for (const [key, n] of edgeCounts) if (n === 1) key.split(':').forEach((v) => boundary.add(+v));
  for (let pass = 0; pass < 9; pass++) {
    const next = vertices.map((p, i) => {
      if (boundary.has(i)) return p;
      const list = [...adjacent[i]],
        avg = list.reduce(
          (c, k) => [c[0] + vertices[k][0] / list.length, c[1] + vertices[k][1] / list.length],
          [0, 0],
        );
      return [p[0] * 0.55 + avg[0] * 0.45, p[1] * 0.55 + avg[1] * 0.45];
    });
    vertices.splice(0, vertices.length, ...next);
  }
  const cells = quads.map((q, id) => ({
    id,
    vertices: q,
    points: q.map((k) => vertices[k]),
    center: q.reduce((c, k) => [c[0] + vertices[k][0] / 4, c[1] + vertices[k][1] / 4], [0, 0]),
    neighbors: [-1, -1, -1, -1],
  }));
  const edges = new Map();
  for (const cell of cells)
    for (let e = 0; e < 4; e++) {
      const key = [cell.vertices[e], cell.vertices[(e + 1) % 4]].sort((a, b) => a - b).join(':');
      if (edges.has(key)) {
        const [other, oe] = edges.get(key);
        cell.neighbors[e] = other;
        cells[other].neighbors[oe] = cell.id;
      } else edges.set(key, [cell.id, e]);
    }
  return { cells, vertices };
}
export function inside(point, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      hit = !hit;
  }
  return hit;
}
export const top = (levels) => (levels ? levels.findLastIndex((v) => v !== null) : -1);
export function demoTown(cells) {
  const town = new Map();
  for (const c of cells) {
    const [x, z] = c.center,
      r = Math.hypot(x * 0.92, z * 1.05);
    const lagoon = Math.hypot(x * 0.95, (z - 3) * 1.1) < 4.0;
    const land =
      (r < 8.4 && !lagoon) ||
      (Math.abs(x + 6) < 1.35 && z > 0 && z < 7.4) ||
      (z > 5.3 && z < 6.6 && x > -6 && x < -0.8);
    if (!land) continue;
    const levels = [0];
    const rng = random(c.id * 871 + 15);
    const edge = r > 7.3 || (z > 1.1 && Math.abs(x) < 5.1) || z > 4;
    const lane = Math.abs(x + 0.7 * Math.sin(z)) < 0.7;
    let height = edge || lane ? 0 : Math.floor(2 + rng() * 2 + (z < -3 ? 1 : 0));
    if (x > 3 && z < 0 && z > -3) height = 4;
    if (Math.hypot(x + 3, z + 3) < 1.0) height = 6;
    const color = Math.floor(rng() * 10);
    for (let y = 1; y <= height; y++) levels.push(color);
    town.set(c.id, levels);
  }
  // Two covered passages open the waterfront into the streets behind it.
  for (const c of cells) {
    if (c.center[1] > -1.6 && c.center[1] < -0.5 && Math.abs(Math.abs(c.center[0]) - 1.6) < 0.3) {
      const levels = town.get(c.id);
      if (levels?.length >= 3) levels[1] = null;
    }
  }
  return town;
}
