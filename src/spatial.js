import { Vector3 } from 'three';

// A small uniform index for static 2D cells and roof triangle bounds.
export class SpatialIndex {
  constructor(items, size = 2) {
    this.size = size;
    this.bins = new Map();
    for (const item of items)
      for (
        let x = Math.floor((item.x0 - 1e-7) / size);
        x <= Math.floor((item.x1 + 1e-7) / size);
        x++
      )
        for (
          let z = Math.floor((item.z0 - 1e-7) / size);
          z <= Math.floor((item.z1 + 1e-7) / size);
          z++
        ) {
          const key = x + ',' + z;
          if (!this.bins.has(key)) this.bins.set(key, []);
          this.bins.get(key).push(item);
        }
  }
  at(x, z) {
    return this.bins.get(Math.floor(x / this.size) + ',' + Math.floor(z / this.size)) || [];
  }
}

// Worker-built median BVH. Face ids stay in original order for cell/level/edge picking.
export function buildBVH(position) {
  const count = position.length / 9,
    order = Array.from({ length: count }, (_, i) => i),
    boxes = [],
    nodes = [];
  function build(start, end) {
    const id = nodes.length / 4,
      box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let n = start; n < end; n++)
      for (let v = 0; v < 3; v++)
        for (let a = 0; a < 3; a++) {
          const x = position[order[n] * 9 + v * 3 + a];
          box[a] = Math.min(box[a], x);
          box[a + 3] = Math.max(box[a + 3], x);
        }
    boxes.push(...box);
    nodes.push(-1, -1, start, end - start);
    if (end - start > 12) {
      let axis = 0;
      for (let a = 1; a < 3; a++) if (box[a + 3] - box[a] > box[axis + 3] - box[axis]) axis = a;
      const center = (i) =>
        position[i * 9 + axis] + position[i * 9 + 3 + axis] + position[i * 9 + 6 + axis];
      const sorted = order.slice(start, end).sort((a, b) => center(a) - center(b));
      for (let i = 0; i < sorted.length; i++) order[start + i] = sorted[i];
      const mid = (start + end) >> 1;
      nodes[id * 4] = build(start, mid);
      nodes[id * 4 + 1] = build(mid, end);
    }
    return id;
  }
  if (count) build(0, count);
  return {
    boxes: new Float32Array(boxes),
    nodes: new Int32Array(nodes),
    order: new Uint32Array(order),
  };
}
const a = new Vector3(),
  b = new Vector3(),
  c = new Vector3(),
  point = new Vector3();
function entry(ray, boxes, i, limit) {
  let lo = 0,
    hi = limit;
  for (let axis = 0; axis < 3; axis++) {
    const o = ray.origin.getComponent(axis),
      d = ray.direction.getComponent(axis),
      min = boxes[i + axis] - 1e-6,
      max = boxes[i + axis + 3] + 1e-6;
    if (Math.abs(d) < 1e-15) {
      if (o < min || o > max) return Infinity;
      continue;
    }
    const x = (min - o) / d,
      y = (max - o) / d;
    lo = Math.max(lo, Math.min(x, y));
    hi = Math.min(hi, Math.max(x, y));
    if (lo > hi) return Infinity;
  }
  return lo;
}
export function intersectBVH(ray, data, limit = Infinity) {
  const { bvh, attributes } = data;
  if (!bvh?.nodes.length) return null;
  const stack = [0],
    p = attributes.position;
  let result = null;
  while (stack.length) {
    const id = stack.pop();
    if (entry(ray, bvh.boxes, id * 6, limit) === Infinity) continue;
    const offset = id * 4,
      left = bvh.nodes[offset],
      right = bvh.nodes[offset + 1];
    if (left >= 0) {
      const dl = entry(ray, bvh.boxes, left * 6, limit),
        dr = entry(ray, bvh.boxes, right * 6, limit);
      if (dl < dr) {
        if (dr !== Infinity) stack.push(right);
        if (dl !== Infinity) stack.push(left);
      } else {
        if (dl !== Infinity) stack.push(left);
        if (dr !== Infinity) stack.push(right);
      }
    } else
      for (let i = bvh.nodes[offset + 2], end = i + bvh.nodes[offset + 3]; i < end; i++) {
        const face = bvh.order[i],
          v = face * 9;
        a.fromArray(p, v);
        b.fromArray(p, v + 3);
        c.fromArray(p, v + 6);
        if (ray.intersectTriangle(a, b, c, true, point)) {
          const distance = point.distanceTo(ray.origin);
          if (distance < limit) {
            limit = distance;
            result = {
              distance,
              faceIndex: face,
              meta: {
                id: data.faces[face * 3],
                level: data.faces[face * 3 + 1],
                edge: data.faces[face * 3 + 2],
              },
            };
          }
        }
      }
  }
  return result;
}

// Join cached per-cell BVHs under a small top-level tree; never rebuild unchanged triangles.
export function mergeBVHs(parts) {
  let triangleOffset = 0;
  const entries = [];
  for (const p of parts) {
    if (p.bvh.nodes.length) entries.push({ bvh: p.bvh, offset: triangleOffset });
    triangleOffset += p.attributes.position.length / 9;
  }
  if (!entries.length)
    return { boxes: new Float32Array(), nodes: new Int32Array(), order: new Uint32Array() };
  const count = entries.reduce((n, e) => n + e.bvh.nodes.length / 4, 0) + entries.length - 1;
  const boxes = new Float32Array(count * 6),
    nodes = new Int32Array(count * 4),
    order = new Uint32Array(triangleOffset);
  let cursor = 0;
  function join(list) {
    if (list.length === 1) {
      const { bvh, offset } = list[0],
        base = cursor;
      cursor += bvh.nodes.length / 4;
      boxes.set(bvh.boxes, base * 6);
      for (let i = 0; i < bvh.nodes.length; i += 4) {
        nodes[base * 4 + i] = bvh.nodes[i] < 0 ? -1 : bvh.nodes[i] + base;
        nodes[base * 4 + i + 1] = bvh.nodes[i + 1] < 0 ? -1 : bvh.nodes[i + 1] + base;
        nodes[base * 4 + i + 2] = bvh.nodes[i + 2] + offset;
        nodes[base * 4 + i + 3] = bvh.nodes[i + 3];
      }
      for (let i = 0; i < bvh.order.length; i++) order[offset + i] = bvh.order[i] + offset;
      return base;
    }
    const id = cursor++,
      bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const e of list)
      for (let a = 0; a < 3; a++) {
        bounds[a] = Math.min(bounds[a], e.bvh.boxes[a]);
        bounds[a + 3] = Math.max(bounds[a + 3], e.bvh.boxes[a + 3]);
      }
    boxes.set(bounds, id * 6);
    let axis = 0;
    for (let a = 1; a < 3; a++)
      if (bounds[a + 3] - bounds[a] > bounds[axis + 3] - bounds[axis]) axis = a;
    list.sort(
      (a, b) =>
        a.bvh.boxes[axis] + a.bvh.boxes[axis + 3] - (b.bvh.boxes[axis] + b.bvh.boxes[axis + 3]),
    );
    const mid = list.length >> 1;
    nodes[id * 4] = join(list.slice(0, mid));
    nodes[id * 4 + 1] = join(list.slice(mid));
    return id;
  }
  join(entries);
  return { boxes, nodes, order };
}
