export const SAVE_KEY = 'riviera-town-v1';
export function serialize(town) {
  return JSON.stringify(
    town.terrain?.size || town.clotheslines?.length
      ? {
          version: 2,
          gridSeed: 81,
          cells: [...town],
          terrain: [...(town.terrain || [])],
          ...(town.clotheslines?.length ? { clotheslines: town.clotheslines } : {}),
        }
      : { version: 1, gridSeed: 81, cells: [...town] },
  );
}
export function deserialize(text, cellCount) {
  const data = JSON.parse(text);
  if (
    ![1, 2].includes(data.version) ||
    data.gridSeed !== 81 ||
    !Array.isArray(data.cells) ||
    data.cells.length > cellCount
  )
    throw new Error('Ogiltigt byformat');
  const town = new Map();
  for (const entry of data.cells) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error('Ogiltig cell');
    const [id, levels] = entry;
    if (
      !Number.isInteger(id) ||
      id < 0 ||
      id >= cellCount ||
      town.has(id) ||
      !Array.isArray(levels) ||
      !levels.length ||
      levels.length > 25 ||
      !levels.some((x) => x !== null)
    )
      throw new Error('Ogiltig cell');
    if (levels.some((x) => x !== null && (!Number.isInteger(x) || x < 0 || x > 11)))
      throw new Error('Ogiltig färg');
    town.set(id, levels.slice());
  }
  if (data.version === 2) {
    if (!Array.isArray(data.terrain) || data.terrain.length > cellCount)
      throw Error('Ogiltigt landskap');
    town.terrain = new Map();
    for (const entry of data.terrain) {
      if (!Array.isArray(entry) || entry.length !== 2) throw Error('Ogiltig markcell');
      const [id, value] = entry;
      if (
        !Number.isInteger(id) ||
        id < 0 ||
        id >= cellCount ||
        town.terrain.has(id) ||
        !Array.isArray(value) ||
        ![2, 3].includes(value.length) ||
        !Number.isInteger(value[0] * 2) ||
        value[0] < 0.5 ||
        value[0] > 12 ||
        !Number.isInteger(value[1]) ||
        value[1] < 0 ||
        value[1] > 4 ||
        (value.length === 3 && (!Number.isInteger(value[2]) || value[2] < 0 || value[2] > 3)) ||
        value[0] + (town.get(id)?.length || 1) - 1 > 24
      )
        throw Error('Ogiltig markcell');
      town.terrain.set(id, value.slice());
    }
  }
  if (data.clotheslines !== undefined) {
    if (
      data.version !== 2 ||
      !Array.isArray(data.clotheslines) ||
      data.clotheslines.length > cellCount * 2
    )
      throw Error('Ogiltiga tvättlinor');
    const seen = new Set();
    town.clotheslines = [];
    for (const line of data.clotheslines) {
      if (!Array.isArray(line) || line.length !== 4 || !line.every(Number.isInteger))
        throw Error('Ogiltig tvättlina');
      const [a, al, b, bl] = line,
        key = [a, b].sort((a, b) => a - b).join(':');
      if (
        a < 0 ||
        b < 0 ||
        a >= cellCount ||
        b >= cellCount ||
        a === b ||
        al < 0 ||
        bl < 0 ||
        al > 24 ||
        bl > 24 ||
        !al !== !bl ||
        seen.has(key)
      )
        throw Error('Ogiltig tvättlina');
      seen.add(key);
      town.clotheslines.push(line.slice());
    }
  }
  return town;
}
export class History {
  constructor(limit = 80) {
    this.past = [];
    this.future = [];
    this.limit = limit;
  }
  push(town) {
    this.past.push(serialize(town));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  undo(town, count) {
    if (!this.past.length) return town;
    this.future.push(serialize(town));
    return deserialize(this.past.pop(), count);
  }
  redo(town, count) {
    if (!this.future.length) return town;
    this.past.push(serialize(town));
    return deserialize(this.future.pop(), count);
  }
}
