/** Decorative arches require an actual bearing surface under BOTH spring points. */
export function supportPlan(cell, level, town, vertexCells) {
  const occupied = (id, y) => town.get(id)?.[y] != null;
  if (level < 1 || !occupied(cell.id, level) || occupied(cell.id, level - 1))
    return { underside: false, arches: [], columns: [], corbels: [] };
  const bearingLevel = level - 2;
  const supported = cell.vertices.map(
    (vertex) =>
      bearingLevel >= 0 && vertexCells.get(vertex).some((id) => occupied(id, bearingLevel)),
  );
  const arches = [],
    columns = new Set(),
    corbels = [];
  for (let edge = 0; edge < 4; edge++) {
    const neighbor = cell.neighbors[edge],
      next = (edge + 1) % 4;
    if (supported[edge] && supported[next] && !occupied(neighbor, level - 1)) {
      arches.push(edge);
      columns.add(edge);
      columns.add(next);
    }
    // A bracket grows out of a real adjoining wall, never from open air.
    if (occupied(neighbor, level) && occupied(neighbor, level - 1)) corbels.push(edge);
  }
  return { underside: true, arches, columns: [...columns], corbels };
}
