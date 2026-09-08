import { FLOOR } from './palette.js';
export const MAX_TERRAIN = 12;
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
  if (tool === 'paint') {
    if (!height || old[1] === material) return false;
  } else if (tool === 'smooth') {
    const neighbors = cells[id].neighbors.filter((n) => n >= 0);
    const average =
      neighbors.reduce((s, n) => s + (terrain.get(n)?.[0] || 0), 0) / neighbors.length;
    height += Math.sign(Math.round(average) - height);
  } else height += tool === 'lower' ? -1 : 1;
  const buildingTop = (town.get(id)?.length || 1) - 1;
  height = Math.max(0, Math.min(MAX_TERRAIN, 24 - buildingTop, height));
  if (height === old[0] && tool !== 'paint') return false;
  town.terrain = terrain;
  if (height) terrain.set(id, [height, tool === 'lower' || tool === 'smooth' ? old[1] : material]);
  else terrain.delete(id);
  return true;
}
