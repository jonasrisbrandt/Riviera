import { Batch, mergeGeometry } from './geometry-data.js';
import { FLOOR, BASE } from './palette.js';
import { groundY } from './terrain.js';
// Small, deterministic landmarks share the existing worker batches and GPU instances.
export function addHeroes(data, cell, cells, town) {
  const h = groundY(town, cell.id),
    levels = town.get(cell.id),
    record = town.terrain?.get(cell.id);
  if (
    (levels?.length || 0) > 1 ||
    (!levels && !record) ||
    record?.length === 3 ||
    data.sloped ||
    data.stairs
  )
    return;
  const beforeInstances = Object.values(data.instances).reduce((n, list) => n + list.length, 0);
  const land = new Batch(),
    meta = { id: cell.id, level: levels ? 0 : -1, edge: -1 };
  const [x, z] = cell.center,
    y = h + (levels ? BASE : 0),
    neighbors = cell.neighbors;
  const sea = (n) => n < 0 || (!town.has(n) && !town.terrain?.has(n));
  const seaCount = neighbors.filter(sea).length;
  const add = (kind, p, s, col, yaw = 0) =>
    data.instances[kind].push({ p, s, col, yaw, key: -2, base: 0 });
  const box = (p, s, col, yaw = 0) => add('box', p, s, col, yaw);
  function cone(cx, cy, cz, r0, r1, height, col, segments = 8) {
    for (let i = 0; i < segments; i++) {
      const a = (i * Math.PI * 2) / segments,
        b = ((i + 1) * Math.PI * 2) / segments;
      const aa = [cx + Math.sin(a) * r0, cy, cz + Math.cos(a) * r0],
        bb = [cx + Math.sin(b) * r0, cy, cz + Math.cos(b) * r0];
      const cc = [cx + Math.sin(a) * r1, cy + height, cz + Math.cos(a) * r1],
        dd = [cx + Math.sin(b) * r1, cy + height, cz + Math.cos(b) * r1];
      land.quad(bb, dd, cc, aa, col, meta);
      land.tri([cx, cy + height, cz], cc, dd, col, meta);
    }
  }
  // A beacon emerges on small ends of stone piers.
  if (levels && seaCount >= 2 && cell.id % 3 === 0) {
    box([x, y + 0.08, z], [0.58, 0.16, 0.58], '#ddd4b8');
    box([x, y + 0.23, z], [0.39, 0.18, 0.39], '#b97860');
    cone(x, y + 0.32, z, 0.235, 0.175, 1.18, '#efe6cc', 4);
    box([x, y + 1.52, z], [0.46, 0.09, 0.46], '#e2d8b8');
    box([x, y + 1.71, z], [0.27, 0.3, 0.27], '#668885');
    for (const dx of [-0.16, 0.16])
      for (const dz of [-0.16, 0.16])
        box([x + dx, y + 1.73, z + dz], [0.038, 0.34, 0.038], '#eae1c9');
    cone(x, y + 1.9, z, 0.31, 0.02, 0.24, '#9b7054', 4);
    box([x, y + 0.56, z + 0.172], [0.09, 0.23, 0.02], '#49695b');
    data.hero = 'lighthouse';
  } else if (
    cell.id % 7 === 1 &&
    (levels || (h <= 2 * FLOOR && seaCount > 0)) &&
    cell.id % 4 !== 0
  ) {
    // Eight warm canvas panels, a gently scalloped hem and a little café table.
    const cx = x + 0.13,
      cz = z - 0.12;
    add('cylinder', [cx, y + 0.715, cz], [0.025, 1.43, 0.025], '#877358');
    const radius = 0.59,
      segments = 16;
    for (let k = 0; k < segments; k++) {
      const a = (k * Math.PI * 2) / segments,
        b = ((k + 1) * Math.PI * 2) / segments;
      const aa = [cx + Math.sin(a) * radius, y + 1.15 - (k % 2) * 0.035, cz + Math.cos(a) * radius];
      const bb = [
        cx + Math.sin(b) * radius,
        y + 1.15 - ((k + 1) % 2) * 0.035,
        cz + Math.cos(b) * radius,
      ];
      const col = Math.floor(k / 2) % 2 ? '#c98f74' : '#f0e4c7';
      land.tri([cx, y + 1.43, cz], aa, bb, col, meta);
      land.tri(bb, aa, [cx, y + 1.43, cz], col, meta);
      land.quad(aa, [aa[0], aa[1] - 0.055, aa[2]], [bb[0], bb[1] - 0.055, bb[2]], bb, col, meta);
    }
    add('cylinder', [cx, y + 0.48, cz], [0.26, 0.055, 0.26], '#b49c72');
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI * 2) / 3,
        px = cx + Math.sin(a) * 0.41,
        pz = cz + Math.cos(a) * 0.41;
      box([px, y + 0.24, pz], [0.22, 0.045, 0.22], '#9a8059', a);
      add('cylinder', [px, y + 0.115, pz], [0.035, 0.23, 0.035], '#776a51');
      box(
        [px + Math.sin(a) * 0.09, y + 0.37, pz + Math.cos(a) * 0.09],
        [0.22, 0.23, 0.035],
        '#9a8059',
        a,
      );
    }
    data.hero = 'parasol';
  }
  if (!data.hero) return;
  data.heroInstances =
    Object.values(data.instances).reduce((n, list) => n + list.length, 0) - beforeInstances;
  const result = land.finish();
  result.attributes.buildKey.fill(-2);
  data.land = mergeGeometry([data.land, result]);
}
