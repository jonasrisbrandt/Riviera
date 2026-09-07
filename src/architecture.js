import * as T from 'three/webgpu';
import {
  color,
  mix,
  positionWorld,
  positionLocal,
  sin,
  cos,
  uv,
  smoothstep,
  fract,
  floor,
  float,
  uniform,
  attribute,
  vec3,
  exp,
  vec2,
  normalView,
  positionView,
  fwidth,
} from 'three/tsl';
import { random, top } from './grid.js';
import { planRoofs, roofPatch, ridgeCapQuads, ROOF_EAVE } from './roofs.js';
import { supportPlan } from './supports.js';
export const PALETTE = [
  '#d77c58',
  '#e4ac66',
  '#efd39a',
  '#d89b87',
  '#cb6755',
  '#e9c3a2',
  '#a9b7a0',
  '#8aadae',
  '#e3b460',
  '#dca9a4',
  '#f0e6cb',
  '#7e9995',
];
export const COLOR_NAMES = [
  'Terrakotta',
  'Aprikos',
  'Ockra',
  'Rosenputs',
  'Korall',
  'Sandsten',
  'Salvia',
  'Havsblå',
  'Solgul',
  'Gammelrosa',
  'Kalkvit',
  'Oliv',
];
export const FLOOR = 1.16,
  BASE = 0.4;
const boxGeo = new T.BoxGeometry(1, 1, 1),
  sphereGeo = new T.IcosahedronGeometry(1, 1),
  cylinderGeo = new T.CylinderGeometry(1, 1, 1, 8);
const temp = new T.Object3D();
const c3 = (c) => new T.Color(c);
class Batch {
  constructor(material) {
    this.material = material;
    this.p = [];
    this.c = [];
    this.u = [];
    this.n = [];
    this.keys = [];
    this.bases = [];
    this.faces = [];
  }
  tri(
    a,
    b,
    c,
    col,
    meta,
    uvs = [
      [0, 0],
      [0, 1],
      [1, 1],
    ],
    normals = null,
  ) {
    this.p.push(...a, ...b, ...c);
    const cc = col.isColor ? col : c3(col);
    for (let i = 0; i < 3; i++) {
      this.c.push(cc.r, cc.g, cc.b);
      this.keys.push(meta.id * 32 + meta.level);
      this.bases.push(meta.level === 0 ? 0 : BASE + (meta.level - 1) * FLOOR);
    }
    this.u.push(...uvs.flat());
    if (!normals) {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
        v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]],
        length = Math.hypot(...n) || 1;
      const unit = n.map((x) => x / length);
      normals = [unit, unit, unit];
    }
    this.n.push(...normals.flat());
    this.faces.push(meta);
  }
  quad(a, b, c, d, col, meta, w = 1, h = 1) {
    this.tri(a, b, c, col, meta, [
      [0, 0],
      [0, h],
      [w, h],
    ]);
    this.tri(a, c, d, col, meta, [
      [0, 0],
      [w, h],
      [w, 0],
    ]);
  }
  mesh() {
    if (!this.p.length) return null;
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.u, 2));
    g.setAttribute('buildKey', new T.Float32BufferAttribute(this.keys, 1));
    g.setAttribute('baseY', new T.Float32BufferAttribute(this.bases, 1));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
    g.computeBoundingSphere();
    const m = new T.Mesh(g, this.material);
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.faces = this.faces;
    return m;
  }
}
function materials() {
  const plaster = new T.MeshStandardNodeMaterial({ roughness: 0.96, vertexColors: true });
  const grain = sin(
    positionWorld.x
      .mul(91)
      .add(positionWorld.y.mul(139))
      .add(sin(positionWorld.z.mul(131))),
  )
    .mul(0.012)
    .add(0.988);
  plaster.colorNode = color('#ffffff').mul(grain);
  plaster.roughnessNode = float(0.96);
  const roof = new T.MeshStandardNodeMaterial({ roughness: 0.9, vertexColors: true });
  const tileUV = uv().div(vec2(0.24, 0.23)),
    rowIndex = floor(tileUV.y);
  const tileX = tileUV.x.add(fract(rowIndex.mul(0.5)).mul(0.7));
  const tx = fract(tileX),
    ty = fract(tileUV.y),
    aa = fwidth(tileUV).min(0.2);
  const vertical = smoothstep(float(0.94).sub(aa.x), float(0.985).add(aa.x), tx);
  const horizontal = smoothstep(float(0.89).sub(aa.y), float(0.97).add(aa.y), ty);
  const variation = fract(sin(floor(tileX).mul(127.1).add(rowIndex.mul(311.7))).mul(43758.5453));
  const tileShade = sin(tx.mul(Math.PI)).mul(0.035).add(variation.mul(0.09));
  roof.colorNode = mix(color('#eee0c4'), color('#ffffff'), tileShade.add(0.72)).mul(
    float(1).sub(horizontal.mul(0.23)).sub(vertical.mul(0.1)),
  );
  // Fine rolled tile relief stays on the GPU; rows use physical roof distances.
  const footprint = fwidth(tileUV);
  const reliefFade = float(1).sub(smoothstep(0.25, 0.75, footprint.x.max(footprint.y)));
  // Differentiate the smooth tile profile analytically: differentiating fract()
  // across a row boundary produces bright pinpricks on receding roof slopes.
  const du = cos(tx.mul(Math.PI * 2))
    .mul(0.003 * Math.PI * 2)
    .mul(reliefFade);
  const dv = sin(ty.mul(Math.PI * 2))
    .mul(-0.002 * Math.PI * 2)
    .mul(reliefFade);
  const dpdx = positionView.dFdx(),
    dpdy = positionView.dFdy();
  const r1 = dpdy.cross(normalView),
    r2 = normalView.cross(dpdx),
    det = dpdx.dot(r1);
  const gradient = r1
    .mul(du.mul(tileUV.x.dFdx()).add(dv.mul(tileUV.y.dFdx())))
    .add(r2.mul(du.mul(tileUV.x.dFdy()).add(dv.mul(tileUV.y.dFdy()))))
    .mul(det.sign());
  roof.normalNode = normalView.mul(det.abs()).sub(gradient).normalize();
  // colorNode replaces material diffuse color, vertexColors still multiply it.
  const stone = new T.MeshStandardNodeMaterial({ roughness: 1, vertexColors: true });
  const brickUV = uv().mul(5);
  const row = floor(brickUV.y);
  const mortar = smoothstep(0.94, 1, fract(brickUV.y)).max(
    smoothstep(0.94, 1, fract(brickUV.x.add(row.mul(0.5)))),
  );
  stone.colorNode = mix(color('#ffffff'), color('#8e978b'), mortar.mul(0.26));
  const detail = new T.MeshStandardNodeMaterial({ roughness: 0.85 });
  return { plaster, roof, stone, detail };
}
export class Architecture {
  constructor(scene, cells) {
    this.scene = scene;
    this.cells = cells;
    this.group = new T.Group();
    scene.add(this.group);
    this.mat = materials();
    this.pickMeshes = [];
    this.stats = {};
    this.vertexCells = new Map();
    for (const c of cells)
      for (const v of c.vertices) {
        if (!this.vertexCells.has(v)) this.vertexCells.set(v, []);
        this.vertexCells.get(v).push(c.id);
      }
    this.clock = uniform(0);
    this.started = uniform(-10);
    this.activeKey = uniform(-1);
    const age = this.clock.sub(this.started).clamp(0, 2);
    const bounce = sin(age.mul(18))
      .mul(exp(age.mul(-8)))
      .mul(0.15)
      .sub(exp(age.mul(-18)).mul(0.2));
    const amount = attribute('buildKey').equal(this.activeKey).select(bounce, float(0));
    for (const m of Object.values(this.mat))
      m.positionNode = positionLocal.add(
        vec3(0, positionLocal.y.sub(attribute('baseY')).mul(amount), 0),
      );
  }
  animate(id, level) {
    this.activeKey.value = id * 32 + level;
    this.started.value = performance.now() / 1000;
  }
  rebuild(town) {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.geometry.dispose();
      if (child.isInstancedMesh) child.dispose();
    }
    const wall = new Batch(this.mat.plaster),
      roof = new Batch(this.mat.roof),
      stone = new Batch(this.mat.stone);
    const instances = { box: [], sphere: [], cylinder: [] };
    this.pickMeshes = [];
    let currentKey = 0,
      currentBase = 0;
    const add = (kind, p, s, col, yaw = 0) =>
      instances[kind].push({ p, s, col, yaw, key: currentKey, base: currentBase });
    const box = (p, s, col, yaw = 0) => add('box', p, s, col, yaw);
    const at = (a, b, t, y, offset = 0) => {
      const dx = b[0] - a[0],
        dz = b[1] - a[1],
        len = Math.hypot(dx, dz);
      return [a[0] + dx * t + (dz / len) * offset, y, a[1] + dz * t - (dx / len) * offset];
    };
    const occupied = (id, y) => town.get(id)?.[y] != null;
    const roofs = planRoofs(this.cells, town);
    this.roofPlans = roofs;
    this.roofHeights = new Map();
    let archCount = 0,
      corbelCount = 0;
    for (const [id, levels] of town) {
      const cell = this.cells[id];
      if (!cell) continue;
      const p = cell.points,
        c = cell.center,
        highest = top(levels);
      for (let y = 0; y <= highest; y++) {
        if (levels[y] == null) continue;
        currentKey = id * 32 + y;
        currentBase = y === 0 ? 0 : BASE + (y - 1) * FLOOR;
        const isBase = y === 0,
          bottom = isBase ? -0.32 : BASE + (y - 1) * FLOOR,
          upper = isBase ? BASE : BASE + y * FLOOR;
        const batch = isBase ? stone : wall,
          col = isBase ? '#a5aa96' : PALETTE[levels[y]];
        const meta = { id, level: y, edge: -1 };
        if (isBase) {
          const rim = [];
          for (let e = 0; e < 4; e++) {
            const prev = p[(e + 3) % 4],
              v = p[e],
              next = p[(e + 1) % 4];
            const round =
              !occupied(cell.neighbors[e], 0) && !occupied(cell.neighbors[(e + 3) % 4], 0);
            if (round) {
              const la = Math.hypot(prev[0] - v[0], prev[1] - v[1]),
                lb = Math.hypot(next[0] - v[0], next[1] - v[1]);
              const a = [
                  v[0] + ((prev[0] - v[0]) * 0.17) / la,
                  v[1] + ((prev[1] - v[1]) * 0.17) / la,
                ],
                b = [v[0] + ((next[0] - v[0]) * 0.17) / lb, v[1] + ((next[1] - v[1]) * 0.17) / lb];
              for (let k = 0; k <= 5; k++) {
                const t = k / 5;
                rim.push({
                  p: [
                    (1 - t) ** 2 * a[0] + 2 * t * (1 - t) * v[0] + t * t * b[0],
                    (1 - t) ** 2 * a[1] + 2 * t * (1 - t) * v[1] + t * t * b[1],
                  ],
                  edge: e,
                  curve: k < 5,
                });
              }
            } else rim.push({ p: v, edge: e, curve: false });
          }
          for (let i = 0; i < rim.length; i++) {
            const item = rim[i],
              a = item.p,
              b = rim[(i + 1) % rim.length].p,
              e = item.edge;
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (!occupied(id, 1))
              stone.tri(
                [c[0], BASE, c[1]],
                [b[0], BASE, b[1]],
                [a[0], BASE, a[1]],
                '#d2cbb5',
                meta,
                [
                  [c[0], c[1]],
                  [b[0], b[1]],
                  [a[0], a[1]],
                ],
              );
            if (!item.curve && occupied(cell.neighbors[e], 0)) continue;
            stone.quad(
              [a[0], -0.32, a[1]],
              [a[0], BASE - 0.07, a[1]],
              [b[0], BASE - 0.07, b[1]],
              [b[0], -0.32, b[1]],
              '#a0a591',
              { id, level: 0, edge: e },
              len,
              0.65,
            );
            stone.quad(
              [a[0], BASE - 0.07, a[1]],
              [a[0], BASE, a[1]],
              [b[0], BASE, b[1]],
              [b[0], BASE - 0.07, b[1]],
              '#e1d7bf',
              { id, level: 0, edge: e },
              len,
              0.07,
            );
            if (!item.curve && id % 7 === 0) {
              box(at(a, b, 0.27, BASE + 0.1, -0.13), [0.08, 0.22, 0.08], '#596e65');
            }
            if (!item.curve && id % 17 === 0 && len > 0.9 && highest === 0) {
              const yaw = Math.atan2(a[1] - b[1], b[0] - a[0]);
              for (let step = 0; step < 4; step++)
                box(
                  at(a, b, 0.5, BASE - 0.09 - step * 0.1, 0.08 + step * 0.1),
                  [0.48, 0.11, 0.13],
                  '#c9c4ae',
                  yaw,
                );
            }
          }
          continue;
        }
        const pts = p;
        if (!occupied(id, y + 1)) {
          const plan = roofs.get(id * 32 + y),
            patch = roofPatch(cell, plan);
          this.roofHeights.set(id * 32 + y, patch.maxHeight);
          const roofColor = c3('#c08b5f').multiplyScalar(
            0.96 + random(Math.min(...plan.ids) * 31)() * 0.08,
          );
          for (const tri of patch.triangles)
            roof.tri(
              ...tri.vertices.map((v) => [v.x, upper + v.height, v.z]),
              roofColor,
              meta,
              tri.uvs,
              tri.vertices.map((v) => v.normal),
            );
          for (const { a, b, length, exposed } of patch.edges) {
            if (!exposed) continue;
            wall.quad(
              [a[0], upper - 0.055, a[1]],
              [a[0], upper + ROOF_EAVE, a[1]],
              [b[0], upper + ROOF_EAVE, b[1]],
              [b[0], upper - 0.055, b[1]],
              '#a77e55',
              meta,
              length,
              0.12,
            );
            const yaw = Math.atan2(a[1] - b[1], b[0] - a[0]);
            box(at(a, b, 0.5, upper - 0.08, -0.045), [length, 0.065, 0.09], '#ecd4b0', yaw);
          }
          for (const quad of ridgeCapQuads(patch, plan))
            roof.quad(
              ...quad.map(([x, h, z]) => [x, upper + h, z]),
              c3('#b88053'),
              meta,
              0.12,
              0.055,
            );
          if (id % 4 === 0) {
            const chimneyY = upper + plan.sample(c[0] + 0.25, c[1] - 0.16).height;
            box([c[0] + 0.25, chimneyY + 0.15, c[1] - 0.16], [0.18, 0.48, 0.21], '#c0855d');
            box([c[0] + 0.25, chimneyY + 0.4, c[1] - 0.16], [0.27, 0.075, 0.29], '#ad704b');
          }
        }
        for (let e = 0; e < 4; e++) {
          if (occupied(cell.neighbors[e], y)) continue;
          const a = pts[e],
            b = pts[(e + 1) % 4],
            len = Math.hypot(b[0] - a[0], b[1] - a[1]),
            yaw = Math.atan2(a[1] - b[1], b[0] - a[0]);
          const faceMeta = { id, level: y, edge: e };
          batch.quad(
            [a[0], bottom, a[1]],
            [a[0], upper, a[1]],
            [b[0], upper, b[1]],
            [b[0], bottom, b[1]],
            col,
            faceMeta,
            len,
            upper - bottom,
          );
          box(
            at(a, b, 0.5, bottom + 0.025, 0.023),
            [len, 0.05, 0.045],
            c3(col).multiplyScalar(0.85),
            yaw,
          );
          const windows = len > 1.5 ? 2 : 1;
          for (let w = 0; w < windows; w++) {
            const t = (w + 1) / (windows + 1),
              wy = bottom + 0.62,
              width = 0.24;
            const door = y === 1 && w === 0 && id % 3 === 0;
            if (door) {
              const pos = at(a, b, t, bottom + 0.35, 0.018);
              box(pos, [0.39, 0.71, 0.045], '#efd9b5', yaw);
              box(at(a, b, t, bottom + 0.32, 0.047), [0.29, 0.64, 0.045], '#34564c', yaw);
              box(at(a, b, t, bottom + 0.02, 0.13), [0.46, 0.08, 0.28], '#d6c4a5', yaw);
              continue;
            }
            box(at(a, b, t, wy, 0.024), [width + 0.09, 0.51, 0.05], '#f1daba', yaw);
            box(at(a, b, t, wy, 0.055), [width, 0.41, 0.028], '#304d46', yaw);
            box(at(a, b, t, wy, 0.076), [0.024, 0.4, 0.03], '#d7c8a7', yaw);
            box(at(a, b, t, wy + 0.025, 0.078), [width, 0.024, 0.03], '#d7c8a7', yaw);
            const shutters = id % 5 === 0 ? '#617d77' : '#426e5c';
            for (const sign of [-1, 1]) {
              const st = t + (sign * (width * 0.5 + 0.112)) / len;
              box(at(a, b, st, wy, 0.074), [0.145, 0.45, 0.055], shutters, yaw);
              for (let sl = 0; sl < 4; sl++)
                box(
                  at(a, b, st, wy - 0.15 + sl * 0.1, 0.106),
                  [0.119, 0.019, 0.016],
                  '#365d50',
                  yaw,
                );
            }
            box(at(a, b, t, wy - 0.275, 0.09), [0.49, 0.055, 0.16], '#f1daba', yaw);
            if (y > 1 && (id + e + y) % 6 === 0) {
              box(at(a, b, t, wy - 0.34, 0.22), [0.68, 0.085, 0.47], '#d5c5a7', yaw);
              box(at(a, b, t, wy - 0.09, 0.43), [0.65, 0.035, 0.035], '#475c51', yaw);
              for (let k = 0; k < 5; k++)
                box(
                  at(a, b, t + ((k - 2) * 0.14) / len, wy - 0.21, 0.43),
                  [0.022, 0.25, 0.022],
                  '#475c51',
                  yaw,
                );
              if (id % 2 === 0) {
                box(at(a, b, t, wy - 0.29, 0.35), [0.37, 0.1, 0.15], '#a95b3c', yaw);
                for (let k = 0; k < 3; k++)
                  add(
                    'sphere',
                    at(a, b, t + ((k - 1) * 0.1) / len, wy - 0.2, 0.36),
                    [0.1, 0.09, 0.1],
                    k % 2 ? '#cc7177' : '#668555',
                  );
              }
            }
          }
        }
        const supports = supportPlan(cell, y, town, this.vertexCells);
        if (supports.underside) {
          const low = BASE + (y - 2) * FLOOR,
            high = bottom;
          wall.quad(
            [p[0][0], bottom, p[0][1]],
            [p[1][0], bottom, p[1][1]],
            [p[2][0], bottom, p[2][1]],
            [p[3][0], bottom, p[3][1]],
            col,
            meta,
          );
          for (const e of supports.arches) {
            archCount++;
            const a = pts[e],
              b = pts[(e + 1) % 4];
            for (let s = 0; s < 16; s++) {
              const t0 = s / 16,
                t1 = (s + 1) / 16;
              const arc = (t) => low + 0.1 + Math.sin(Math.PI * t) * FLOOR * 0.78;
              wall.quad(
                at(a, b, t0, arc(t0)),
                at(a, b, t0, high),
                at(a, b, t1, high),
                at(a, b, t1, arc(t1)),
                col,
                { id, level: y, edge: e },
              );
              // Inner surface and intrados make the arch solid rather than
              // a paper-thin cutout when seen from the street underneath.
              wall.quad(
                at(a, b, t1, arc(t1), -0.1),
                at(a, b, t1, high, -0.1),
                at(a, b, t0, high, -0.1),
                at(a, b, t0, arc(t0), -0.1),
                col,
                meta,
              );
              wall.quad(
                at(a, b, t0, arc(t0)),
                at(a, b, t1, arc(t1)),
                at(a, b, t1, arc(t1), -0.1),
                at(a, b, t0, arc(t0), -0.1),
                col,
                meta,
              );
            }
          }
          for (const k of supports.columns) {
            const q = pts[k];
            box([q[0], (low + high) / 2, q[1]], [0.15, high - low, 0.15], col);
          }
          for (const e of supports.corbels) {
            const a = pts[e],
              b = pts[(e + 1) % 4],
              length = Math.hypot(b[0] - a[0], b[1] - a[1]);
            for (const t of [0.22, 0.78]) {
              const l = t - 0.055 / length,
                r = t + 0.055 / length;
              const left = [
                at(a, b, l, bottom - 0.27, -0.005),
                at(a, b, l, bottom, -0.005),
                at(a, b, l, bottom, -0.34),
              ];
              const right = [
                at(a, b, r, bottom - 0.27, -0.005),
                at(a, b, r, bottom, -0.005),
                at(a, b, r, bottom, -0.34),
              ];
              wall.tri(...left, col, meta);
              wall.tri(right[2], right[1], right[0], col, meta);
              wall.quad(left[0], left[2], right[2], right[0], col, meta);
              corbelCount++;
            }
          }
        }
      }
      currentKey = id * 32;
      currentBase = 0;
      if (highest === 0) {
        const enclosed = cell.neighbors.filter((n) => top(town.get(n)) > 0).length;
        if ((enclosed >= 2 || id % 13 === 0) && id % 3 !== 0) {
          box([c[0], BASE + 0.06, c[1]], [0.68, 0.12, 0.67], '#c2b9a0');
          box([c[0], BASE + 0.13, c[1]], [0.57, 0.05, 0.56], '#7f9872');
          add('cylinder', [c[0], BASE + 0.49, c[1]], [0.055, 0.7, 0.055], '#806c4f');
          if (id % 2 === 0) {
            add('sphere', [c[0], BASE + 1.2, c[1]], [0.25, 0.88, 0.25], '#426e50');
            add('sphere', [c[0], BASE + 1.76, c[1]], [0.14, 0.46, 0.15], '#4f7a52');
          } else {
            for (let k = 0; k < 4; k++)
              add(
                'sphere',
                [
                  c[0] + Math.sin(k * 3) * 0.19,
                  BASE + 0.91 + Math.cos(k * 4) * 0.11,
                  c[1] + Math.cos(k * 3) * 0.19,
                ],
                [0.39, 0.35, 0.37],
                k % 2 ? '#718f61' : '#87995f',
              );
          }
        } else if (id % 11 === 0) {
          box([c[0], BASE + 0.27, c[1]], [0.65, 0.08, 0.25], '#9a7755');
          for (const dx of [-0.23, 0.23])
            box([c[0] + dx, BASE + 0.13, c[1]], [0.055, 0.24, 0.21], '#506456');
        }
      }
    }
    for (const batch of [wall, roof, stone]) {
      const m = batch.mesh();
      if (m) {
        this.group.add(m);
        this.pickMeshes.push(m);
      }
    }
    for (const [k, items] of Object.entries(instances)) {
      if (!items.length) continue;
      const g = (k === 'box' ? boxGeo : k === 'sphere' ? sphereGeo : cylinderGeo).clone();
      g.setAttribute(
        'buildKey',
        new T.InstancedBufferAttribute(new Float32Array(items.map((v) => v.key)), 1),
      );
      g.setAttribute(
        'baseY',
        new T.InstancedBufferAttribute(new Float32Array(items.map((v) => v.base)), 1),
      );
      const mesh = new T.InstancedMesh(g, this.mat.detail, items.length);
      items.forEach((v, i) => {
        temp.position.set(...v.p);
        temp.scale.set(...v.s);
        temp.rotation.set(0, v.yaw, 0);
        temp.updateMatrix();
        mesh.setMatrixAt(i, temp.matrix);
        mesh.setColorAt(i, v.col.isColor ? v.col : c3(v.col));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
    this.stats = {
      cells: town.size,
      blocks: [...town.values()].reduce((n, l) => n + l.filter((x) => x !== null).length, 0),
      floors: [...town.values()].reduce(
        (n, l) => n + l.slice(1).filter((x) => x !== null).length,
        0,
      ),
      instances: Object.values(instances).reduce((n, a) => n + a.length, 0),
      draws: this.group.children.length,
      arches: archCount,
      corbels: corbelCount,
    };
  }
}
