import { Color, ShapeUtils, Vector2, IcosahedronGeometry } from 'three';
import { Batch, mergeGeometry } from './geometry-data.js';
import { FLOOR } from './palette.js';
import { random, inside } from './grid.js';
import { cornerHeights, isBeach } from './terrain.js';
import {
  SURFACE_STEPS,
  edgeSurface,
  surfacePoint,
  surfaceSample,
  surfaceNormal,
} from './terrain-surface.js';
const rockPrototype = new IcosahedronGeometry(1, 0).attributes.position.array;
const tint = (hex, n) => new Color(hex).multiplyScalar(n);
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
// Shared corners retain the same position at every elevation.
export function terrainPoint(p, y) {
  const band = FLOOR / 2,
    lo = Math.floor(y / band) * band,
    t = (y - lo) / band;
  const drift = (h) => [
    Math.sin(p[0] * 2.1 + p[1] * 1.7 + h * 2) * 0.09,
    Math.sin(p[1] * 2.3 - p[0] * 1.3 + h * 1.6) * 0.09,
  ];
  const d = lerp(drift(lo), drift(lo + band), t);
  return [p[0] + d[0], y, p[1] + d[1]];
}
// Rounded, uneven toes meet the sea; endpoints are shared with the next edge.
export function shorePoint(cell, e, t, y = -0.025, beach = false) {
  const a = terrainPoint(cell.points[e], y),
    b = terrainPoint(cell.points[(e + 1) % 4], y);
  const dx = b[0] - a[0],
    dz = b[2] - a[2],
    length = Math.hypot(dx, dz);
  const v = lerp(a, b, t),
    bulge = Math.sin(Math.PI * t) * (beach ? 0.5 : 0.22 + 0.1 * Math.sin(cell.id + e * 3));
  v[0] += (dz / length) * bulge;
  v[2] -= (dx / length) * bulge;
  return v;
}
export function buildTerrain(cell, cells, town, terrain) {
  const land = new Batch(),
    stone = new Batch(),
    instances = { box: [], sphere: [], cylinder: [] };
  const record = terrain.get(cell.id),
    h = record?.[0] || 0,
    material = record?.[1] || 0;
  if (!h) return { land: land.finish(), stone: stone.finish(), instances, stairs: 0 };
  const y = h * FLOOR,
    p = cell.points,
    center = cell.center;
  const heights = cornerHeights(cell, terrain, town, cells),
    ramp = heights.some((v) => v !== y);
  const top = p.map((v, i) => terrainPoint(v, heights[i]));
  const level = (n) => terrain.get(n)?.[0] || 0;
  const built = (n) => (town.get(n)?.length || 0) > 1;
  const cultivated = material === 0 && (built(cell.id) || cell.neighbors.some(built));
  const beach = isBeach(cell, { get: (id) => town.get(id), terrain });
  const green = (material === 0 || material === 1) && !beach;
  const topColor = beach
    ? '#dfcda4'
    : material === 2
      ? '#b8af99'
      : material === 3
        ? '#bca378'
        : h <= 1
          ? '#a8b77b'
          : '#92a65e';
  const meta = { id: cell.id, level: -1, edge: -1 },
    rng = random(cell.id * 419 + 31);
  const add = (kind, pos, size, col, yaw = 0) =>
    instances[kind].push({ p: pos, s: size, col, yaw, key: -2, base: 0 });
  let stairEdge = -1,
    stair = null;
  // One coordinate frame serves the opening, its walls, every step and the landing.
  if (cultivated && !town.has(cell.id) && !ramp) {
    for (let e = 0; e < 4; e++) {
      const n = cell.neighbors[e],
        drop = h - level(n);
      if (n < 0 || level(n) <= 0 || drop < 0.5 || drop > 1 || terrain.get(n)?.length === 3)
        continue;
      if (
        cornerHeights(cells[n], terrain, town, cells).some(
          (v) => Math.abs(v - level(n) * FLOOR) > 1e-7,
        )
      )
        continue;
      const a = top[e],
        b = top[(e + 1) % 4],
        dx = b[0] - a[0],
        dz = b[2] - a[2],
        len = Math.hypot(dx, dz);
      const inward = [-dz / len, dx / len],
        depth =
          (center[0] - (a[0] + b[0]) / 2) * inward[0] + (center[1] - (a[2] + b[2]) / 2) * inward[1];
      const width = Math.min(0.72, len * 0.42),
        run = Math.min(drop * 1.05, depth * 0.75);
      if (len < 1.15 || run < 0.35) continue;
      const at = (t, d = 0, yy = y) => {
        const v = lerp(a, b, t);
        return [v[0] + inward[0] * d, yy, v[2] + inward[1] * d];
      };
      const t0 = 0.5 - width / len / 2,
        t1 = 0.5 + width / len / 2;
      if (
        ![t0, t1].every((t) => {
          const v = at(t, run + 0.035);
          return inside(
            [v[0], v[2]],
            top.map((v) => [v[0], v[2]]),
          );
        })
      )
        continue;
      stairEdge = e;
      stair = { at, t0, t1, width, run, low: level(n) * FLOOR, len };
      break;
    }
  }
  const contour = [];
  const face = (batch, a, b, c, d, col, m = meta) =>
    batch.quad(
      a,
      b,
      c,
      d,
      col,
      m,
      Math.hypot(c[0] - b[0], c[2] - b[2]),
      Math.abs(b[1] - a[1]) || 0.1,
    );
  for (let e = 0; e < 4; e++) {
    const next = (e + 1) % 4,
      n = cell.neighbors[e],
      nh = level(n);
    const a = top[e],
      b = top[next],
      edgeMeta = { ...meta, edge: e };
    const neighbor = n >= 0 ? cells[n] : null;
    const neighborHeights = neighbor ? cornerHeights(neighbor, terrain, town, cells) : null;
    const neighborY = (i) =>
      neighbor ? neighborHeights[neighbor.vertices.indexOf(cell.vertices[i])] : 0;
    const lowA = nh ? terrainPoint(p[e], neighborY(e)) : shorePoint(cell, e, 0, -0.26, beach);
    const lowB = nh ? terrainPoint(p[next], neighborY(next)) : shorePoint(cell, e, 1, -0.26, beach);
    const upperAt = (t) => edgeSurface(a, b, t),
      lowerAt = (t) => (nh ? edgeSurface(lowA, lowB, t) : shorePoint(cell, e, t, -0.26, beach));
    contour.push(a);
    if (e === stairEdge) {
      const { at, t0, t1, run, low, width } = stair;
      contour.push(at(t0), at(t0, run), at(t1, run), at(t1));
      const steps = Math.round((y - low) / 0.145);
      // Actual mesh steps participate in picking and close the entire cut, including the back.
      for (let k = 0; k < steps; k++) {
        const front = (k * run) / steps,
          back = ((k + 1) * run) / steps,
          bottom = low + (k * (y - low)) / steps,
          high = low + ((k + 1) * (y - low)) / steps;
        face(
          stone,
          at(t0, front, bottom),
          at(t0, front, high),
          at(t1, front, high),
          at(t1, front, bottom),
          '#c4bda5',
          meta,
        );
        face(
          stone,
          at(t0, front, high),
          at(t0, back, high),
          at(t1, back, high),
          at(t1, front, high),
          '#e0d8bf',
          meta,
        );
      }
      for (const t of [t0, t1]) {
        face(stone, at(t, 0, low), at(t, 0, y), at(t, run, y), at(t, run, low), '#bab79f');
        face(stone, at(t, run, low), at(t, run, y), at(t, 0, y), at(t, 0, low), '#bab79f');
      }
      face(stone, at(t0, run, low), at(t0, run, y), at(t1, run, y), at(t1, run, low), '#bab79f');
      // The neighbour's boundary can drift with height; this short landing bridges it exactly.
      const la = lowerAt(t0),
        lb = lowerAt(t1);
      face(stone, la, at(t0, 0, low), at(t1, 0, low), lb, '#dad2b9');
      face(stone, at(t0, 0, low), at(t0, run, low), at(t1, run, low), at(t1, 0, low), '#c3bca5');
    }
    const masonry = cultivated && !ramp && material !== 2 && !beach;
    const breaks = [0, 1];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]),
      segments = SURFACE_STEPS;
    for (let j = 1; j < segments; j++) breaks.push(j / segments);
    if (e === stairEdge) breaks.push(stair.t0, stair.t1);
    // Split where two crossing ramps exchange which side is exposed.
    const da = a[1] - lowA[1],
      db = b[1] - lowB[1];
    if (da * db < 0) {
      let lo = 0,
        hi = 1;
      for (let k = 0; k < 24; k++) {
        const t = (lo + hi) / 2;
        if ((upperAt(t)[1] - lowerAt(t)[1]) * da > 0) lo = t;
        else hi = t;
      }
      breaks.push((lo + hi) / 2);
    }
    breaks.sort((a, b) => a - b);
    for (let j = 0; j < breaks.length - 1; j++) {
      const ta = breaks[j],
        tb = breaks[j + 1];
      if (tb - ta < 1e-7) continue;
      const ua = upperAt(ta),
        ub = upperAt(tb),
        la = lowerAt(ta),
        lb = lowerAt(tb);
      if ((ua[1] + ub[1] - la[1] - lb[1]) / 2 < 0.0001) continue;
      // A stair cuts only above its landing, never through the cliff below it.
      const opening = e === stairEdge && ta >= stair.t0 - 1e-6 && tb <= stair.t1 + 1e-6;
      const capA = opening ? stair.low : ua[1],
        capB = opening ? stair.low : ub[1];
      const wallStart = masonry ? Math.max(Math.max(la[1], lb[1]), y - 2 * FLOOR) : Infinity;
      const levels = [0, 1];
      const rise = Math.max(capA - la[1], capB - lb[1]);
      // Every shared corner uses the same world-height knots, regardless of cliff height.
      for (const [low, cap] of [
        [la[1], capA],
        [lb[1], capB],
      ])
        for (
          let yy = (Math.floor(low / (FLOOR / 2)) + 1) * (FLOOR / 2);
          yy < cap - 1e-6;
          yy += FLOOR / 2
        )
          levels.push((yy - low) / (cap - low));
      if (masonry && rise > 0)
        levels.push(Math.max(0, Math.min(1, (wallStart - la[1]) / (capA - la[1] || 1))));
      if (green && !opening && !masonry)
        levels.push(Math.max(0, 1 - 0.065 / Math.max(rise, 0.065)));
      levels.sort((a, b) => a - b);
      const side = (t, f, low, up, cap) => {
        const endpoint = lerp(up, low, (up[1] - cap) / Math.max(1e-6, up[1] - low[1]));
        const v = lerp(low, endpoint, f);
        const driftAt = (yy) => lerp(terrainPoint(p[e], yy), terrainPoint(p[next], yy), t);
        const curved = driftAt(v[1]),
          straight = lerp(driftAt(low[1]), driftAt(cap), f);
        v[0] += curved[0] - straight[0];
        v[2] += curved[2] - straight[2];
        return v;
      };
      for (let k = 0; k < levels.length - 1; k++) {
        const f0 = levels[k],
          f1 = levels[k + 1];
        if (f1 - f0 < 1e-7) continue;
        const aa = side(ta, f0, la, ua, capA),
          bb = side(tb, f0, lb, ub, capB),
          cc = side(ta, f1, la, ua, capA),
          dd = side(tb, f1, lb, ub, capB);
        const isStone = masonry && (aa[1] + bb[1]) / 2 >= wallStart - 1e-5;
        const lip = green && !masonry && !opening && f0 >= 1 - 0.066 / Math.max(rise, 0.065);
        const col = lip
          ? tint(topColor, 0.91)
          : beach
            ? tint('#d8c59f', 0.95 + rng() * 0.07)
            : tint('#bcb19a', 0.94 + rng() * 0.12);
        face(isStone ? stone : land, aa, cc, dd, bb, isStone ? '#c7c1aa' : col, edgeMeta);
      }
    }
    if (!nh && !beach && cell.id % 3 !== 1) {
      const r = random(cell.id * 313 + e);
      for (let k = 0; k < 2; k++) {
        const t = 0.2 + k * 0.57,
          scale = 0.19 + r() * 0.18,
          pos = shorePoint(cell, e, t, 0, beach);
        pos[1] = scale * 0.1;
        for (let i = 0; i < rockPrototype.length; i += 9) {
          const verts = [];
          for (let j = 0; j < 9; j += 3)
            verts.push([
              pos[0] + rockPrototype[i + j] * scale,
              pos[1] + rockPrototype[i + j + 1] * scale * 0.85,
              pos[2] + rockPrototype[i + j + 2] * scale,
            ]);
          // Decorative rocks never steal the neighbouring hole's pick target.
          land.tri(...verts, tint('#b7af9b', 0.94 + r() * 0.09), edgeMeta);
        }
      }
    }
  }
  if (!town.has(cell.id) && stairEdge < 0 && (ramp || green)) {
    const n = SURFACE_STEPS;
    const base = new Color(topColor),
      soil = new Color('#bda77f');
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const coords = [
          [i / n, j / n],
          [(i + 1) / n, j / n],
          [(i + 1) / n, (j + 1) / n],
          [i / n, (j + 1) / n],
        ];
        for (const indices of [
          [0, 2, 1],
          [0, 3, 2],
        ]) {
          const uv = indices.map((k) => coords[k]);
          const verts = uv.map(([u, v]) => surfacePoint(top, u, v));
          const normals = uv.map(([u, v]) => surfaceNormal(top, u, v));
          const x = verts.reduce((a, p) => a + p[0], 0) / 3,
            z = verts.reduce((a, p) => a + p[2], 0) / 3;
          // World-space worn-earth bands continue over cell borders, with irregular edges.
          const field = Math.abs(Math.sin(x * 0.63 + Math.sin(z * 0.48) * 0.85));
          const patch = Math.max(
            0,
            Math.min(1, (0.26 - field + 0.035 * Math.sin(x * 13 + z * 9)) / 0.12),
          );
          const col = green
            ? base
                .clone()
                .lerp(soil, patch * 0.88)
                .multiplyScalar(0.98 + 0.045 * Math.sin(x * 7.3 + z * 4.1))
            : base;
          land.tri(...verts, col, meta, uv, normals);
        }
      }
  } else
    for (const tri of ShapeUtils.triangulateShape(
      contour.map((v) => new Vector2(v[0], v[2])),
      [],
    )) {
      const verts = tri.map((i) => contour[i]);
      if (
        (verts[1][2] - verts[0][2]) * (verts[2][0] - verts[0][0]) -
          (verts[1][0] - verts[0][0]) * (verts[2][2] - verts[0][2]) <
        0
      )
        verts.reverse();
      land.tri(...verts, tint(topColor, 0.985 + rng() * 0.025), meta);
    }
  if (!town.has(cell.id) && stairEdge < 0) {
    const root = surfaceSample(top, 0.5, 0.5),
      x = root[0],
      y = root[1],
      z = root[2];
    if (green && cell.id % 4 === 0) {
      const trunkHeight = cell.id % 3 !== 0 && cell.id % 5 === 0 ? 1.45 : 1;
      add('cylinder', [x, y + trunkHeight / 2, z], [0.05, trunkHeight, 0.05], '#78674d');
      if (cell.id % 3 === 0) {
        add('sphere', [x, y + 1.05, z], [0.22, 0.9, 0.23], '#3f6545');
        add('sphere', [x, y + 1.65, z], [0.13, 0.48, 0.14], '#4b7049');
      } else {
        const pine = cell.id % 5 === 0,
          flower = cell.id % 7 === 0;
        for (let k = 0; k < 7; k++) {
          const a = k * 2.4,
            radius = pine ? 0.36 : 0.22;
          add(
            'sphere',
            [
              x + Math.sin(a) * radius,
              y + (pine ? 1.4 : 0.95) + (k % 2) * 0.11,
              z + Math.cos(a) * radius,
            ],
            pine ? [0.4, 0.24, 0.39] : [0.32, 0.29, 0.32],
            tint(flower ? '#c99595' : pine ? '#52754b' : '#7e965d', 0.9 + rng() * 0.16),
          );
        }
      }
    }
    if (green && cell.id % 2 === 0)
      for (let k = 0; k < 3; k++) {
        const v = surfaceSample(top, [0.2, 0.8, 0.8][k], [0.2, 0.2, 0.8][k]),
          s = 0.11 + rng() * 0.1;
        add('sphere', [v[0], v[1] + s * 0.6, v[2]], [s, s * 0.75, s], '#7b9456');
      }
  }
  if (!town.has(cell.id) && stairEdge < 0 && green) {
    const scatter = random(cell.id * 823 + 47);
    // Small clusters leave the central walking space open. Roots follow the rendered mesh.
    for (let k = 0; k < (ramp ? 5 : 2); k++) {
      const u = 0.14 + scatter() * 0.72,
        v = 0.14 + scatter() * 0.72;
      const root = surfaceSample(top, u, v),
        size = 0.055 + scatter() * 0.09;
      if (k % 3 === 0) {
        for (let j = 0; j < 3; j++)
          add(
            'sphere',
            [
              root[0] + Math.sin(j * 2.4) * size,
              root[1] + size * 0.5,
              root[2] + Math.cos(j * 2.4) * size,
            ],
            [size, size * 0.72, size],
            tint('#718b4d', 0.95 + scatter() * 0.16),
          );
      } else {
        add(
          'sphere',
          [root[0], root[1] + size * 0.3, root[2]],
          [size, size * 0.65, size * 0.8],
          tint('#beb69f', 0.9 + scatter() * 0.15),
        );
      }
    }
  }
  const result = {
    land: land.finish(),
    stone: stone.finish(),
    instances,
    stairs: stairEdge >= 0 ? 1 : 0,
    sloped: ramp,
  };
  for (const kind of ['land', 'stone']) result[kind].attributes.buildKey.fill(-2);
  return result;
}
export function emptyCell(id) {
  return {
    id,
    wall: new Batch().finish(),
    roof: new Batch().finish(),
    stone: new Batch().finish(),
    instances: { box: [], sphere: [], cylinder: [] },
    roofHeights: new Map(),
    archCount: 0,
    corbelCount: 0,
  };
}
export function attachTerrain(data, ground) {
  data.land = ground.land;
  data.stone = mergeGeometry([data.stone, ground.stone]);
  for (const kind of Object.keys(data.instances))
    data.instances[kind].push(...ground.instances[kind]);
  data.stairs = ground.stairs;
  data.sloped = ground.sloped;
  return data;
}
