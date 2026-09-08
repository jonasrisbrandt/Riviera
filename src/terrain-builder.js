import { Color, ShapeUtils, Vector2, IcosahedronGeometry } from 'three';
import { Batch, mergeGeometry } from './geometry-data.js';
import { FLOOR } from './palette.js';
import { random, inside } from './grid.js';
const rockPrototype = new IcosahedronGeometry(1, 0).attributes.position.array;
const tint = (hex, n) => new Color(hex).multiplyScalar(n);
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
// All cells share this boundary function, including intermediate cliff rings.
// Adjacent cliffs and grass caps meet exactly; no independent corner jitter.
function point(p, y) {
  const band = FLOOR / 2,
    lo = Math.floor(y / band) * band,
    t = (y - lo) / band;
  const drift = (h) => [
    Math.sin(p[0] * 2.1 + p[1] * 1.7 + h * 2) * 0.14,
    Math.sin(p[1] * 2.3 - p[0] * 1.3 + h * 1.6) * 0.14,
  ];
  const a = drift(lo),
    b = drift(lo + band);
  return [p[0] + a[0] * (1 - t) + b[0] * t, y, p[1] + a[1] * (1 - t) + b[1] * t];
}
const edgePoint = (a, b, t, y) => lerp(point(a, y), point(b, y), t);
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
  const level = (n) => terrain.get(n)?.[0] || 0;
  const built = (n) => (town.get(n)?.length || 0) > 1;
  const cultivated = material === 0 && (built(cell.id) || cell.neighbors.some(built));
  const beach =
    h === 1 &&
    (material === 4 ||
      (material === 0 &&
        !cultivated &&
        cell.id % 4 === 1 &&
        cell.neighbors.filter((n) => level(n) === 0).length > 1));
  const green = (material === 1 || material === 0) && !beach;
  const topColor = beach
    ? '#dfcda4'
    : material === 2
      ? '#b8af99'
      : material === 3
        ? '#bca378'
        : material === 4
          ? '#e1ce9f'
          : h === 1
            ? '#a8b77b'
            : '#92a65e';
  const meta = { id: cell.id, level: -1, edge: -1 };
  const rng = random(cell.id * 419 + 31);
  const add = (kind, pos, size, col, yaw = 0) =>
    instances[kind].push({ p: pos, s: size, col, yaw, key: -2, base: 0 });
  const box = (pos, size, col, yaw = 0) => add('box', pos, size, col, yaw);
  let stairs = 0,
    stairEdge = -1;
  const stairFits = (e) => {
    const a = point(p[e], y),
      b = point(p[(e + 1) % 4], y),
      dx = b[0] - a[0],
      dz = b[2] - a[2],
      len = Math.hypot(dx, dz);
    const inward = [-dz / len, dx / len],
      depth =
        (center[0] - (a[0] + b[0]) / 2) * inward[0] + (center[1] - (a[2] + b[2]) / 2) * inward[1];
    if (depth < 0.45 || len < 1.2) return false;
    const run = Math.min(0.95, depth * 0.8),
      width = Math.min(0.72, len * 0.45);
    const polygon = p.map((v) => {
      const q = point(v, y);
      return [q[0], q[2]];
    });
    return [-1, 1].every((sign) =>
      inside(
        [
          (a[0] + b[0]) / 2 + (((sign * dx) / len) * width) / 2 + inward[0] * run,
          (a[2] + b[2]) / 2 + (((sign * dz) / len) * width) / 2 + inward[1] * run,
        ],
        polygon,
      ),
    );
  };
  if (cultivated && !town.has(cell.id)) {
    stairEdge = cell.neighbors.findIndex(
      (n, e) =>
        n >= 0 &&
        level(n) === h - 1 &&
        h > 1 &&
        stairFits(e) &&
        Math.hypot(p[e][0] - p[(e + 1) % 4][0], p[e][1] - p[(e + 1) % 4][1]) > 1.1,
    );
  }
  const contour = [];
  for (let e = 0; e < 4; e++) {
    const a = p[e],
      b = p[(e + 1) % 4],
      nh = level(cell.neighbors[e]),
      delta = h - nh;
    const dx = b[0] - a[0],
      dz = b[1] - a[1],
      len = Math.hypot(dx, dz);
    // Positive inward points towards the cell centre (CCW XZ perimeter).
    const inward = [-dz / len, dx / len];
    const at = (t, depth = 0, yy = y) => [
      edgePoint(a, b, t, y)[0] + inward[0] * depth,
      yy,
      edgePoint(a, b, t, y)[2] + inward[1] * depth,
    ];
    const width = Math.min(0.72, len * 0.45),
      t0 = 0.5 - width / len / 2,
      t1 = 0.5 + width / len / 2,
      run = Math.min(
        0.95,
        Math.max(
          0.25,
          ((center[0] - (a[0] + b[0]) * 0.5) * inward[0] +
            (center[1] - (a[1] + b[1]) * 0.5) * inward[1]) *
            0.8,
        ),
      );
    contour.push(point(a, y));
    if (e === stairEdge) {
      contour.push(at(t0), at(t0, run), at(t1, run), at(t1));
      stairs++;
      const yaw = Math.atan2(-dz, dx),
        low = nh * FLOOR;
      const steps = 8;
      for (let k = 0; k < steps; k++) {
        const top = low + ((k + 1) * FLOOR) / steps;
        box(
          at(0.5, ((k + 0.5) * run) / steps, (low + top) / 2),
          [width, top - low, run / steps + 0.008],
          '#ccc4a9',
          yaw,
        );
        box(
          at(0.5, ((k + 0.5) * run) / steps, top + 0.015),
          [width + 0.025, 0.03, run / steps + 0.025],
          '#e4dcc3',
          yaw,
        );
      }
      // Solid cheeks support both edges of the stair opening.
      for (const t of [t0 - 0.025, t1 + 0.025]) {
        const aa = at(t, 0, low),
          bb = at(t, run, low),
          cc = at(t, run, y),
          dd = at(t, 0, y);
        stone.quad(aa, dd, cc, bb, '#b6b69e', meta, run, FLOOR);
        stone.quad(bb, cc, dd, aa, '#b6b69e', meta, run, FLOOR);
      }
    }
    if (delta <= 0) continue;
    if (nh === 0 && !beach && material !== 4 && cell.id % 3 !== 1) {
      const r = random(cell.id * 313 + e);
      for (let k = 0; k < 2; k++) {
        const t = 0.25 + k * 0.5,
          scale = 0.24 + r() * 0.22;
        const pos = at(t, -0.16 - r() * 0.16, 0.06 + scale * 0.23);
        for (let i = 0; i < rockPrototype.length; i += 9) {
          const vertices = [];
          for (let j = 0; j < 9; j += 3)
            vertices.push([
              pos[0] + rockPrototype[i + j] * scale,
              pos[1] + rockPrototype[i + j + 1] * scale * 0.88,
              pos[2] + rockPrototype[i + j + 2] * scale * 1.1,
            ]);
          land.tri(...vertices, tint('#b8af9a', 0.94 + r() * 0.1), meta);
        }
      }
    }
    if (beach && nh === 0) {
      const ta = point(a, y * 0.3),
        tb = point(b, y * 0.3),
        fa = point(a, -0.06),
        fb = point(b, -0.06);
      for (const v of [fa, fb]) {
        v[0] -= inward[0] * 0.22;
        v[2] -= inward[1] * 0.22;
      }
      land.quad(fa, ta, tb, fb, '#e0cca3', meta);
      land.tri(point(a, -0.15), ta, fa, '#cdb992', meta);
      land.tri(point(b, -0.15), fb, tb, '#cdb992', meta);
    }
    const masonry = cultivated && material !== 2 && material !== 4;
    const wallBottom = masonry ? Math.max(nh * FLOOR, y - 2 * FLOOR) : y - (green ? 0.095 : 0);
    const segments = Math.max(2, Math.ceil(len / 0.65));
    for (let j = 0; j < segments; j++) {
      const ta = j / segments,
        tb = (j + 1) / segments;
      const pa = lerp(a, b, ta),
        pb = lerp(a, b, tb);
      const low = nh ? nh * FLOOR : -0.26;
      for (let bottom = low; bottom < wallBottom - 0.001;) {
        const upper = Math.min(wallBottom, Math.floor((bottom + 0.01) / 0.58 + 1) * 0.58);
        const aa = edgePoint(a, b, ta, bottom),
          bb = edgePoint(a, b, tb, bottom),
          cc = edgePoint(a, b, ta, upper),
          dd = edgePoint(a, b, tb, upper);
        const col = tint('#c1b59e', 0.95 + rng() * 0.08);
        land.tri(aa, cc, dd, col, { ...meta, edge: e });
        land.tri(aa, dd, bb, tint(col, 0.98 + rng() * 0.035), { ...meta, edge: e });
        bottom = upper;
      }
    }
    if (masonry) {
      const parts =
        e === stairEdge
          ? [
              [0, t0],
              [t1, 1],
            ]
          : [[0, 1]];
      for (const [ta, tb] of parts) {
        const aa = edgePoint(a, b, ta, wallBottom),
          bb = edgePoint(a, b, tb, wallBottom);
        const cc = edgePoint(a, b, ta, y - 0.055),
          dd = edgePoint(a, b, tb, y - 0.055);
        for (let low = wallBottom; low < y - 0.055 - 0.0001;) {
          const high = Math.min(y - 0.055, (Math.floor((low + 0.0001) / 0.58) + 1) * 0.58);
          stone.quad(
            edgePoint(a, b, ta, low),
            edgePoint(a, b, ta, high),
            edgePoint(a, b, tb, high),
            edgePoint(a, b, tb, low),
            '#c0bda5',
            { ...meta, edge: e },
            len * (tb - ta) * 0.63,
            (high - low) * 0.63,
          );
          low = high;
        }
        stone.quad(
          cc,
          edgePoint(a, b, ta, y),
          edgePoint(a, b, tb, y),
          dd,
          '#e0d8ba',
          meta,
          len * (tb - ta),
          0.055,
        );
      }
    } else if (green) {
      // A narrow grass lip follows the faceted cliff instead of a floating cap.
      land.quad(
        point(a, y - 0.095),
        point(a, y),
        point(b, y),
        point(b, y - 0.095),
        tint(topColor, 0.92),
        meta,
      );
    }
  }
  // Ear clipping keeps the top out of the automatic stairwell.
  const coords = contour.map((v) => new Vector2(v[0], v[2]));
  for (const tri of ShapeUtils.triangulateShape(coords, [])) {
    const verts = tri.map((i) => contour[i]);
    // Correct the XZ triangulation to upward-facing world triangles.
    const n =
      (verts[1][2] - verts[0][2]) * (verts[2][0] - verts[0][0]) -
      (verts[1][0] - verts[0][0]) * (verts[2][2] - verts[0][2]);
    if (n < 0) verts.reverse();
    land.tri(...verts, tint(topColor, 0.97 + rng() * 0.06), meta);
  }
  if (!town.has(cell.id)) {
    const cy = y;
    const shrub = (x, z, s = 0.16) =>
      add(
        'sphere',
        [x, cy + s * 0.55, z],
        [s, s * 0.7, s * 0.9],
        tint('#748e53', 0.92 + rng() * 0.2),
      );
    if (green && stairEdge < 0 && cell.id % 4 === 0) {
      const x = center[0] + 0.1,
        z = center[1] - 0.06;
      if (cell.id % 3 === 0) {
        add('cylinder', [x, cy + 0.5, z], [0.048, 0.9, 0.048], '#7e7052');
        add('sphere', [x, cy + 1.08, z], [0.23, 0.94, 0.24], '#3f6545');
        add('sphere', [x + 0.01, cy + 1.7, z], [0.13, 0.49, 0.14], '#4b7049');
      } else {
        add('cylinder', [x, cy + 0.45, z], [0.06, 0.88, 0.06], '#7b6d50');
        for (let k = 0; k < 6; k++) {
          const a = k * 2.4;
          add(
            'sphere',
            [x + Math.sin(a) * 0.22, cy + 0.92 + (k % 2) * 0.13, z + Math.cos(a) * 0.22],
            [0.34, 0.28, 0.32],
            tint('#7e965d', 0.9 + rng() * 0.18),
          );
        }
      }
    }
    if (green && cell.id % 2 === 0) {
      for (let k = 0; k < 3; k++) {
        const v = lerp(center, p[k], 0.64);
        if (stairEdge < 0) shrub(v[0], v[1], 0.11 + rng() * 0.1);
      }
    }
    if (material === 2 || cell.id % 9 === 0) {
      const v = lerp(center, p[0], 0.48);
      add('sphere', [v[0], cy + 0.13, v[1]], [0.23, 0.21, 0.2], '#b5ae95');
    }
  }
  const result = { land: land.finish(), stone: stone.finish(), instances, stairs };
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
  return data;
}
