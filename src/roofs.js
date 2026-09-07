import { profiler } from './profiler.js';
import { SpatialIndex } from './spatial.js';
export const ROOF_EAVE = 0.065;
export const ROOF_PITCH = 0.78;
const OVERHANG = 0.085;
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function closest(edge, x, z) {
  const dx = x - edge.a[0],
    dz = z - edge.a[1];
  const t = Math.max(0, Math.min(edge.length, dx * edge.tx + dz * edge.tz));
  const rx = dx - edge.tx * t,
    rz = dz - edge.tz * t,
    d = Math.hypot(rx, rz);
  return { d, gx: d > 1e-7 ? rx / d : edge.nx, gz: d > 1e-7 ? rz / d : edge.nz };
}

/** One distance field per connected roof, rather than one pyramid per building cell. */
export function planRoofs(cells, town, previous = new Map()) {
  const plans = new Map(),
    seen = new Set();
  for (const [id, levels] of town)
    for (let level = 1; level < levels.length; level++) {
      const key = id * 32 + level;
      if (levels[level] == null || levels[level + 1] != null || seen.has(key)) continue;
      const members = [],
        queue = [id];
      seen.add(key);
      for (let head = 0; head < queue.length; head++) {
        const c = cells[queue[head]];
        members.push(c);
        for (const n of c.neighbors)
          if (
            n >= 0 &&
            !seen.has(n * 32 + level) &&
            town.get(n)?.[level] != null &&
            town.get(n)?.[level + 1] == null
          ) {
            seen.add(n * 32 + level);
            queue.push(n);
          }
      }
      const signature =
        level +
        ':' +
        members
          .map((c) => c.id)
          .sort((a, b) => a - b)
          .join(',') +
        '/' +
        members
          .slice()
          .sort((a, b) => a.id - b.id)
          .flatMap((c) => c.neighbors.map((n) => (town.get(n)?.[level] != null ? 1 : 0)))
          .join('');
      const reused = previous.get(signature);
      if (reused) {
        for (const c of members) plans.set(c.id * 32 + level, reused);
        continue;
      }
      const ids = new Set(members.map((c) => c.id)),
        raw = [],
        vertices = new Map(),
        offsets = new Map();
      for (const c of members) {
        c.vertices.forEach((v, k) => vertices.set(v, c.points[k]));
        for (let e = 0; e < 4; e++)
          if (!ids.has(c.neighbors[e])) {
            const a = c.points[e],
              b = c.points[(e + 1) % 4],
              length = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const outward = [(b[1] - a[1]) / length, -(b[0] - a[0]) / length];
            const exposed = town.get(c.neighbors[e])?.[level] == null;
            raw.push({
              cell: c.id,
              edge: e,
              va: c.vertices[e],
              vb: c.vertices[(e + 1) % 4],
              exposed,
            });
            if (exposed)
              for (const v of [c.vertices[e], c.vertices[(e + 1) % 4]]) {
                if (!offsets.has(v)) offsets.set(v, []);
                offsets.get(v).push(outward);
              }
          }
      }
      const points = new Map();
      for (const [v, p] of vertices) {
        const normals = offsets.get(v) || [];
        let ox = 0,
          oz = 0;
        for (const n of normals) {
          ox += n[0];
          oz += n[1];
        }
        if (normals.length) {
          const length = Math.hypot(ox, oz);
          if (length > 1e-6) {
            ox /= length;
            oz /= length;
            const denom = Math.max(0.5, ox * normals[0][0] + oz * normals[0][1]);
            ox *= OVERHANG / denom;
            oz *= OVERHANG / denom;
          }
        }
        points.set(v, [p[0] + ox, p[1] + oz]);
      }
      const edges = raw.map((e) => {
        const a = points.get(e.va),
          b = points.get(e.vb),
          length = Math.hypot(b[0] - a[0], b[1] - a[1]),
          tx = (b[0] - a[0]) / length,
          tz = (b[1] - a[1]) / length;
        return { ...e, a, b, length, tx, tz, nx: -tz, nz: tx };
      });
      const cache = new Map();
      function sample(x, z) {
        const key = `${x.toFixed(7)}:${z.toFixed(7)}`;
        if (cache.has(key)) return cache.get(key);
        let distance = Infinity,
          nearest = 0;
        const hits = [];
        for (let e = 0; e < edges.length; e++) {
          const hit = closest(edges[e], x, z);
          hits.push(hit);
          if (hit.d < distance - 1e-8) {
            distance = hit.d;
            nearest = e;
          }
        }
        // A gentle flare above the eaves; blend normals across the narrow ridge
        // instead of leaving the sharp star-shaped facets of the old cell fans.
        const height = ROOF_EAVE + ROOF_PITCH * distance + 0.065 * (1 - Math.exp(-distance * 4));
        const slope = ROOF_PITCH + 0.26 * Math.exp(-distance * 4);
        let gx = 0,
          gz = 0,
          weight = 0;
        for (const h of hits) {
          const w = Math.max(0, 1 - (h.d - distance) / 0.09);
          gx += h.gx * w;
          gz += h.gz * w;
          weight += w;
        }
        const nx = (-slope * gx) / weight,
          nz = (-slope * gz) / weight,
          nl = Math.hypot(nx, 1, nz);
        const value = { x, z, height, normal: [nx / nl, 1 / nl, nz / nl], nearest, distance };
        cache.set(key, value);
        return value;
      }
      const bounds = members.map((c) => {
        const p = c.vertices.map((v) => points.get(v));
        return {
          cell: c,
          x0: Math.min(...p.map((v) => v[0])),
          x1: Math.max(...p.map((v) => v[0])),
          z0: Math.min(...p.map((v) => v[1])),
          z1: Math.max(...p.map((v) => v[1])),
        };
      });
      const boundsIndex = new SpatialIndex(bounds);
      const plan = {
        signature,
        level,
        ids,
        points,
        edges,
        sample,
        patches: new Map(),
        surfaceHeight(x, z) {
          for (const b of boundsIndex.at(x, z)) {
            if (x < b.x0 - 1e-7 || x > b.x1 + 1e-7 || z < b.z0 - 1e-7 || z > b.z1 + 1e-7) continue;
            const height = roofPatch(b.cell, plan).surfaceHeight(x, z);
            if (height !== null) return height;
          }
          return null;
        },
      };
      for (const c of members) plans.set(c.id * 32 + level, plan);
    }
  return plans;
}

/** Tessellation samples the SAME roof field on either side of every cell seam. */
export function roofPatch(cell, plan, steps = 10) {
  const cacheKey = cell.id * 128 + steps;
  if (plan.patches.has(cacheKey)) return plan.patches.get(cacheKey);
  const scope = profiler.begin('build.roofTessellation');
  const p = cell.vertices.map((v) => plan.points.get(v)),
    grid = [];
  for (let j = 0; j <= steps; j++) {
    const row = [];
    for (let i = 0; i <= steps; i++) {
      const point = lerp(lerp(p[0], p[1], i / steps), lerp(p[3], p[2], i / steps), j / steps);
      row.push(plan.sample(...point));
    }
    grid.push(row);
  }
  const triangles = [],
    ridges = [];
  function triangle(a, b, c) {
    if (Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) < 1e-10) return;
    const edge = plan.edges[plan.sample((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3).nearest];
    const uvs = [a, b, c].map((v) => [v.x * edge.tx + v.z * edge.tz, v.distance * 1.27]);
    triangles.push({ vertices: [a, b, c], uvs });
  }
  function emit(a, b, c) {
    // Trace changes of roof slope, giving continuous rounded ridge/hip caps.
    const crossings = [],
      boundary = [];
    for (const [v, w] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      boundary.push(v);
      if (v.nearest !== w.nearest) {
        const e1 = plan.edges[v.nearest],
          e2 = plan.edges[w.nearest];
        if (e1.nx * e2.nx + e1.nz * e2.nz > 0.55) continue;
        // Concave corners have a whole region equidistant to two segment
        // endpoints. It is one smooth slope, NOT a field of little ridges.
        const h1 = closest(e1, (v.x + w.x) / 2, (v.z + w.z) / 2),
          h2 = closest(e2, (v.x + w.x) / 2, (v.z + w.z) / 2);
        if (h1.gx * h2.gx + h1.gz * h2.gz > 0.55) continue;
        let lo = 0,
          hi = 1;
        for (let k = 0; k < 12; k++) {
          const t = (lo + hi) / 2,
            x = v.x + (w.x - v.x) * t,
            z = v.z + (w.z - v.z) * t;
          if (closest(e1, x, z).d < closest(e2, x, z).d) lo = t;
          else hi = t;
        }
        const t = (lo + hi) / 2;
        const crossing = plan.sample(v.x + (w.x - v.x) * t, v.z + (w.z - v.z) * t);
        crossings.push(crossing);
        boundary.push(crossing);
      }
    }
    if (
      crossings.length === 2 &&
      Math.hypot(crossings[0].x - crossings[1].x, crossings[0].z - crossings[1].z) > 0.008
    ) {
      ridges.push(crossings);
      // Make the ridge an actual mesh edge. Merely draping a cap across a
      // triangle that cuts off the ridge leaves a visibly scalloped hip line.
      const i = boundary.indexOf(crossings[0]),
        j = boundary.indexOf(crossings[1]);
      for (const polygon of [
        boundary.slice(i, j + 1),
        [...boundary.slice(j), ...boundary.slice(0, i + 1)],
      ])
        for (let k = 1; k < polygon.length - 1; k++)
          triangle(polygon[0], polygon[k], polygon[k + 1]);
    } else if (crossings.length === 3) {
      const middle = plan.sample(
        crossings.reduce((s, p) => s + p.x, 0) / 3,
        crossings.reduce((s, p) => s + p.z, 0) / 3,
      );
      for (let k = 0; k < boundary.length; k++)
        triangle(middle, boundary[k], boundary[(k + 1) % boundary.length]);
      for (const p of crossings)
        if (Math.hypot(p.x - middle.x, p.z - middle.z) > 0.008) ridges.push([p, middle]);
    } else if (crossings.length) {
      const middle = plan.sample((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3);
      for (let k = 0; k < boundary.length; k++)
        triangle(middle, boundary[k], boundary[(k + 1) % boundary.length]);
    } else triangle(a, b, c);
  }
  for (let j = 0; j < steps; j++)
    for (let i = 0; i < steps; i++) {
      emit(grid[j][i], grid[j + 1][i], grid[j + 1][i + 1]);
      emit(grid[j][i], grid[j + 1][i + 1], grid[j][i + 1]);
    }
  // Barycentric interpolation queries the rendered triangles, not the ideal
  // distance field. Their heights differ most along ridges and hip corners.
  const faces = triangles.map(({ vertices: [a, b, c] }) => {
    const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    return {
      a,
      b,
      c,
      det,
      x0: Math.min(a.x, b.x, c.x),
      x1: Math.max(a.x, b.x, c.x),
      z0: Math.min(a.z, b.z, c.z),
      z1: Math.max(a.z, b.z, c.z),
    };
  });
  const faceIndex = new SpatialIndex(faces, 0.25);
  const patch = {
    triangles,
    ridges,
    maxHeight: Math.max(...triangles.flatMap((t) => t.vertices.map((v) => v.height))),
    edges: plan.edges.filter((e) => e.cell === cell.id),
    surfaceHeight(x, z) {
      for (const { a, b, c, det, x0, x1, z0, z1 } of faceIndex.at(x, z)) {
        if (x < x0 - 1e-7 || x > x1 + 1e-7 || z < z0 - 1e-7 || z > z1 + 1e-7) continue;
        const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det;
        const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det;
        if (u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7)
          return u * a.height + v * b.height + (1 - u - v) * c.height;
      }
      return null;
    },
  };
  plan.patches.set(cacheKey, patch);
  profiler.end(scope);
  return patch;
}

/** Low rounded caps embedded into the actual mesh, including both skirts. */
export function ridgeCapQuads(patch, plan) {
  if (patch.caps) return patch.caps;
  const scope = profiler.begin('build.ridgeCaps');
  const quads = [];
  for (const [a, b] of patch.ridges) {
    const dx = b.x - a.x,
      dz = b.z - a.z,
      len = Math.hypot(dx, dz);
    const nx = -dz / len,
      nz = dx / len,
      steps = Math.max(1, Math.ceil(len / 0.055));
    let previous = null;
    for (let k = 0; k <= steps; k++) {
      const x = a.x + (dx * k) / steps,
        z = a.z + (dz * k) / steps;
      const width = Math.min(0.045, plan.sample(x, z).distance * 0.6);
      const row = [];
      for (let s = 0; s <= 4; s++) {
        const t = (s * Math.PI) / 4,
          px = x + nx * Math.cos(t) * width,
          pz = z + nz * Math.cos(t) * width;
        const h = plan.surfaceHeight(px, pz);
        row.push(h === null ? null : [px, h - 0.009 + Math.sin(t) * 0.033, pz]);
      }
      if (previous)
        for (let s = 0; s < 4; s++) {
          const q = [previous[s + 1], previous[s], row[s], row[s + 1]];
          if (q.every(Boolean)) quads.push(q);
        }
      previous = row;
    }
  }
  profiler.end(scope);
  patch.caps = quads;
  return quads;
}
