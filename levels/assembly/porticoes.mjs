// levels/assembly/porticoes.mjs: a portico's columns held to its beams. The Mese's column (pieces/make-mese.mjs) stands
// on a grid vertex with its shaft, its capital's bell and its abacus centred on it, and the architrave is a beam
// centred on the column line; a column that stands off its capital, or a beam off its column, shows from under the
// portico (the person's "las columnas desalineadas"). This measures the assembled map, not the pieces: every column
// vertex of every portico of the site (a column every 2 cells from the first cell, one at the last cell when the run is
// odd), its shaft, capital and beam found by where they are in the map's brushes (the shaft z 20..148, the bell
// 152..166 and the abacus 166..176 over the ground, the beam z 176..192) and their centres held to the vertex.
import { shapeOf } from "../../src/maps/source.mjs";

const GRID = 64;
/** How far a centre may be from its column's axis, in units. */
export const PORTICO_TOLERANCE = 1;
// the column piece's heights over the ground, and the beam's (make-mese.mjs: SHAFT z 20..148, the abacus 166..176, the architrave 176..192)
const SHAFT = [20, 148];
const ABACUS = [166, 176];
const BEAM = [176, 192];

/** How far a column stands back from its line, in units: the column's half across (the abacus 40 square) and 4 clear. */
export const PORTICO_INSET = 24;

/**
 * How far the portico's column line is set back into the portico, along y (a signed number of units): 0, or
 * PORTICO_INSET (toward the portico) where a shaped area (shapes.mjs: an oval's corners are solid up to its bounds) owns
 * a cell on the street side of the line, along the portico. The column stands 20 each side of the line, so on a line that
 * borders such a mass half of its shaft and capital stood inside it, and from under the portico they looked off the beam.
 */
export function porticoInset(plan, p) {
  if (!plan.shapes?.owns) return 0;
  const first = p.columns === p.rows[0];
  const street = first ? p.columns - 1 : p.columns; // the row of cells on the street side of the line
  for (let x = p.cells[0]; x < p.cells[1]; x++) if (plan.shapes.owns(x, street)) return first ? PORTICO_INSET : -PORTICO_INSET;
  return 0;
}

/** Every brush of a map, the world's and those of its entities. */
const allBrushes = (map) => [...(map.brushes ?? []), ...(map.entities ?? []).flatMap((e) => e.brushes ?? [])];

/** The column vertices of a portico: [[x, y]] in cells. */
export function porticoColumns(p) {
  const out = [];
  for (let x = p.cells[0]; x <= p.cells[1]; x += 2) out.push([x, p.columns]);
  if ((p.cells[1] - p.cells[0]) % 2) out.push([p.cells[1], p.columns]);
  return out;
}

/**
 * Checks the porticoes of an assembled site: `map` is `assembleSite(...).map`, `plan` the site's plan. Returns
 * `{ failures, measures: { columns, worst } }`, a sentence a column that is off or missing (what is off, by how many units).
 */
export function checkPorticoes(map, plan, tolerance = PORTICO_TOLERANCE) {
  const failures = [];
  const shapes = allBrushes(map).map(shapeOf);
  const centre = (s, k) => (s.min[k] + s.max[k]) / 2;
  const within = (s, cx, cy, r) => centre(s, 0) >= cx - r && centre(s, 0) <= cx + r && centre(s, 1) >= cy - r && centre(s, 1) <= cy + r;
  const at = (s, z, [lo, hi]) => Math.abs(s.min[2] - (z + lo)) < 0.5 && Math.abs(s.max[2] - (z + hi)) < 0.5;
  let columns = 0;
  let worst = 0;
  for (const [k, p] of (plan.site.porticoes ?? []).entries()) {
    const z = plan.terrain?.ground[p.rows[0]]?.[p.cells[0]] ?? 0;
    for (const [x, y] of porticoColumns(p)) {
      columns++;
      const [cx, cy] = [x * GRID, y * GRID + porticoInset(plan, p)];
      const name = `portico ${k + 1}, the column at cell ${x},${y} (${cx},${cy})`;
      const shaft = shapes.find((s) => at(s, z, SHAFT) && within(s, cx, cy, 16) && s.max[0] - s.min[0] < 30);
      const cap = shapes.find((s) => at(s, z, ABACUS) && within(s, cx, cy, 16) && s.max[0] - s.min[0] < 48);
      // the beams that rest on this capital: one each side of the vertex (the first and the last column have one)
      const beams = shapes.filter((s) => at(s, z, BEAM) && s.max[1] - s.min[1] < 20 && s.min[0] <= cx + 0.5 && s.max[0] >= cx - 0.5 && Math.abs(centre(s, 1) - cy) < 24);
      if (!shaft) failures.push(`${name}: it has no shaft (a 12-sided prism z ${z + SHAFT[0]}..${z + SHAFT[1]}) over its vertex`);
      if (!cap) failures.push(`${name}: it has no capital (an abacus z ${z + ABACUS[0]}..${z + ABACUS[1]}) over its vertex`);
      if (!beams.length) failures.push(`${name}: no architrave rests on it (a beam z ${z + BEAM[0]}..${z + BEAM[1]})`);
      const off = (what, s, k2, to) => {
        const d = Math.abs(centre(s, k2) - to);
        worst = Math.max(worst, d);
        if (d > tolerance) failures.push(`${name}: its ${what} is ${d.toFixed(1)} off its axis along ${"xy"[k2]} (it wants ${tolerance} at most)`);
      };
      for (const [what, s] of [["shaft", shaft], ["capital", cap]]) if (s) for (const k2 of [0, 1]) off(what, s, k2, k2 ? cy : cx);
      for (const b of beams) off("architrave", b, 1, cy);
      // nothing else standing in the column's way (below its slab's ribs): a wall or a shaped area's mass through its shaft
      const mine = (s) => Math.abs(centre(s, 0) - cx) <= 21 && Math.abs(centre(s, 1) - cy) <= 21 && s.max[0] - s.min[0] <= 41 && s.max[1] - s.min[1] <= 41;
      const inside = shapes.filter((s) => !mine(s) && s.min[0] < cx + 18 && s.max[0] > cx - 18 && s.min[1] < cy + 18 && s.max[1] > cy - 18 && s.min[2] < z + 160 && s.max[2] > z + 20);
      if (inside.length) failures.push(`${name}: ${inside.length} other brush${inside.length > 1 ? "es stand" : " stands"} in its way, one from ${inside[0].min.map(Math.round)} to ${inside[0].max.map(Math.round)}; a column stands clear`);
    }
  }
  return { failures, measures: { columns, worst } };
}
