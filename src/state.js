export const SAVE_KEY = 'riviera-town-v1';
export function serialize(town) {
  return JSON.stringify({ version: 1, gridSeed: 81, cells: [...town] });
}
export function deserialize(text, cellCount) {
  const data = JSON.parse(text);
  if (
    data.version !== 1 ||
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
