import { FLOOR } from './palette.js';
export const MAX_TERRAIN = 12;
export const TERRAIN_STEP = 0.5;
export const MATERIALS = [
  { name: 'Auto', color: '#94a477' },
  { name: 'Gräs', color: '#8da55e' },
  { name: 'Klippa', color: '#b5aa94' },
  { name: 'Torr jord', color: '#bfa078' },
  { name: 'Sand', color: '#e0cca0' },
];
export const elevation = (town, id) => town.terrain?.get(id)?.[0] || 0;
export const groundY = (town, id) => elevation(town, id) * FLOOR;
export function sculpt(town, id, tool, material = 0, cells = null) {
  const terrain = town.terrain || new Map();
  const old = terrain.get(id) || [0, 0];
  let height = old[0];
  if (tool === 'slope') {
    if (!height || town.has(id)) return false;
    const candidates = cells[id].neighbors
      .map((n, edge) => ({ edge, h: terrain.get(n)?.[0] || 0 }))
      .filter((n) => n.h > 0 && n.h < height && height - n.h <= 1)
      .sort((a, b) => b.h - a.h || a.edge - b.edge);
    if (!candidates.length) return false;
    const current = candidates.findIndex((n) => n.edge === old[2]);
    const edge = candidates[(current + 1) % candidates.length].edge;
    if (current === candidates.length - 1) {
      terrain.set(id, old.slice(0, 2));
    } else terrain.set(id, [height, old[1], edge]);
    town.terrain = terrain;
    return true;
  }
  if (tool === 'paint') {
    if (!height || old[1] === material) return false;
  } else if (tool === 'smooth') {
    const neighbors = cells[id].neighbors.filter((n) => n >= 0);
    const average =
      neighbors.reduce((s, n) => s + (terrain.get(n)?.[0] || 0), 0) / neighbors.length;
    height += Math.sign(Math.round(average * 2) / 2 - height) * TERRAIN_STEP;
  } else height += tool === 'lower' ? -TERRAIN_STEP : TERRAIN_STEP;
  const buildingTop = (town.get(id)?.length || 1) - 1;
  height = Math.max(0, Math.min(MAX_TERRAIN, 24 - buildingTop, height));
  if (height === old[0] && tool !== 'paint') return false;
  town.terrain = terrain;
  if (height)
    terrain.set(id, [
      height,
      tool === 'lower' || tool === 'smooth' ? old[1] : material,
      ...(tool === 'paint' && old.length === 3 ? [old[2]] : []),
    ]);
  else terrain.delete(id);
  return true;
}

// A ramp's upper edge retains its stored height. Its lower edge meets the neighbour.
export function cornerHeights(cell, terrain, town) {
  const record = terrain.get(cell.id),
    h = record?.[0] || 0;
  const heights = [h, h, h, h];
  if (record?.length === 3 && !town?.has(cell.id)) {
    const e = record[2],
      low = terrain.get(cell.neighbors[e])?.[0] || 0;
    if (low > 0 && low < h && h - low <= 1) heights[e] = heights[(e + 1) % 4] = low;
  }
  return heights.map((v) => v * FLOOR);
}
// Choose the empty/lower cell in front of a cliff when filling a gap.
// Erasing, painting and shaping slopes always address the surface actually hit.
export function terrainPick(meta, cells, town, tool) {
  let { id, edge, level } = meta;
  if (tool === 'raise' && level === -1 && edge >= 0) {
    const n = cells[id].neighbors[edge];
    if (n >= 0 && elevation(town, n) < elevation(town, id) && !town.has(n)) id = n;
  }
  return { id, level: elevation(town, id) };
}

export function isBeach(cell, town) {
  const [h, material] = town.terrain?.get(cell.id) || [0, 0];
  if (material === 4) return true;
  const built = (n) => (town.get(n)?.length || 0) > 1;
  return (
    h > 0 &&
    h <= 1 &&
    material === 0 &&
    !built(cell.id) &&
    !cell.neighbors.some(built) &&
    cell.id % 4 === 1
  );
}
