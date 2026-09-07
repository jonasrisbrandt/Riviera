import { Color } from 'three';

const colorCache = new Map();
function linearColor(color) {
  if (color.isColor) return color;
  if (!colorCache.has(color)) colorCache.set(color, new Color(color));
  return colorCache.get(color);
}
class Floats {
  constructor(size = 256) {
    this.array = new Float32Array(size);
    this.length = 0;
  }
  reserve(n) {
    if (this.length + n <= this.array.length) return;
    const next = new Float32Array(Math.max(this.length + n, this.array.length * 2));
    next.set(this.array);
    this.array = next;
  }
  push(...values) {
    this.reserve(values.length);
    this.array.set(values, this.length);
    this.length += values.length;
  }
  finish() {
    return this.array.slice(0, this.length);
  }
}

// The worker writes float attributes directly; no flat()/array-to-float conversion per mesh.
export class Batch {
  constructor() {
    for (const key of ['position', 'color', 'uv', 'normal', 'buildKey', 'baseY'])
      this[key] = new Floats();
    this.faces = [];
  }
  tri(
    a,
    b,
    c,
    color,
    meta,
    uvs = [
      [0, 0],
      [0, 1],
      [1, 1],
    ],
    normals = null,
  ) {
    const col = linearColor(color);
    let nx = 0,
      ny = 0,
      nz = 0;
    if (!normals) {
      const ux = b[0] - a[0],
        uy = b[1] - a[1],
        uz = b[2] - a[2],
        vx = c[0] - a[0],
        vy = c[1] - a[1],
        vz = c[2] - a[2];
      nx = uy * vz - uz * vy;
      ny = uz * vx - ux * vz;
      nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
    }
    const key = meta.id * 32 + meta.level,
      base = meta.level === 0 ? 0 : 0.4 + (meta.level - 1) * 1.16;
    for (let i = 0; i < 3; i++) {
      const p = i === 0 ? a : i === 1 ? b : c;
      this.position.push(p[0], p[1], p[2]);
      this.color.push(col.r, col.g, col.b);
      this.uv.push(uvs[i][0], uvs[i][1]);
      if (normals) this.normal.push(normals[i][0], normals[i][1], normals[i][2]);
      else this.normal.push(nx, ny, nz);
      this.buildKey.push(key);
      this.baseY.push(base);
    }
    this.faces.push(meta.id, meta.level, meta.edge);
  }
  quad(a, b, c, d, color, meta, w = 1, h = 1) {
    this.tri(a, b, c, color, meta, [
      [0, 0],
      [0, h],
      [w, h],
    ]);
    this.tri(a, c, d, color, meta, [
      [0, 0],
      [w, h],
      [w, 0],
    ]);
  }
  finish() {
    const attributes = {};
    for (const key of ['position', 'color', 'uv', 'normal', 'buildKey', 'baseY'])
      attributes[key] = this[key].finish();
    return { attributes, faces: new Int32Array(this.faces) };
  }
}
export const ITEM_SIZE = { position: 3, color: 3, uv: 2, normal: 3, buildKey: 1, baseY: 1 };
export function mergeGeometry(parts) {
  const attributes = {};
  for (const key of Object.keys(ITEM_SIZE)) {
    const size = parts.reduce((n, p) => n + p.attributes[key].length, 0),
      array = new Float32Array(size);
    let offset = 0;
    for (const p of parts) {
      array.set(p.attributes[key], offset);
      offset += p.attributes[key].length;
    }
    attributes[key] = array;
  }
  const faces = new Int32Array(parts.reduce((n, p) => n + p.faces.length, 0));
  let offset = 0;
  for (const p of parts) {
    faces.set(p.faces, offset);
    offset += p.faces.length;
  }
  return { attributes, faces };
}
export function packInstances(items) {
  const transform = new Float32Array(items.length * 8),
    color = new Float32Array(items.length * 3),
    buildKey = new Float32Array(items.length),
    baseY = new Float32Array(items.length);
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  items.forEach((v, i) => {
    transform.set([...v.p, v.yaw, ...v.s, 0], i * 8);
    const c = linearColor(v.col);
    color.set([c.r, c.g, c.b], i * 3);
    buildKey[i] = v.key;
    baseY[i] = v.base;
    // Conservative world bounds, independent of GPU-computed instance matrices.
    const radius = Math.max(...v.s) * Math.sqrt(3);
    for (let j = 0; j < 3; j++) {
      bounds[j] = Math.min(bounds[j], v.p[j] - radius);
      bounds[j + 3] = Math.max(bounds[j + 3], v.p[j] + radius);
    }
  });
  return { transform, color, buildKey, baseY, bounds, count: items.length };
}
