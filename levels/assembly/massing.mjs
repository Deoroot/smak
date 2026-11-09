// levels/assembly/massing.mjs: the form of a building's shell seen from the street and from above, so a block is not a
// box (AGENTS.md rule 9; Valve's maps are 22 in 100 of their face area off the axes at the median, a site of boxes 2).
// Everything here is a convex brush of whole-number corners, drawn the crown's way (no clip hull: it stands over the
// players' heads and on roofs nobody walks), in the stone and gold of the parapets:
//   corniceBrushes(b, open, top, tex)   a corbelled cornice on each street front: a 45-degree underside cut out from the wall
//                                       under the roof's edge, a ledge, the parapet over it; not where a way up or a link of the
//                                       roofs meets the edge (those cells are not in `open`)
//   hipRoof(b, top, tex)                a hipped roof for a roof nobody walks, inside the parapets, 22 degrees
//   plinthBrushes(...)                  not here
import { solid, prism } from "../../src/maps/source.mjs";

const GRID = 64;
/** The textures: the pale stone of the bands (cornices), the plain tiles of a roof. */
export const MASS_LOOK = { cornice: "muro7", roof: "sintilesplain", tower: "sinbrickwall", talus: "sinbrickwall" };
/** The cornice's profile across the wall, [out, z]: `out` from the grid line (the wall is 8 each side of it), z from the roof's top. */
export const CORNICE = [[4, -36], [8, -36], [38, -6], [38, 0], [4, 0]];
/** A hipped roof stands inside the parapet (16 thick, on the line), and rises at this slope. */
export const HIP = { inset: 12, slope: Math.tan((22 * Math.PI) / 180), least: 3 };

const runsOf = (set) => {
  const list = [...set].sort((a, c) => a - c);
  const runs = [];
  for (const i of list) (runs.at(-1)?.at(-1) === i - 1 ? runs.at(-1).push(i) : runs.push([i]));
  return runs.map((r) => [r[0], r.at(-1) + 1]);
};

/** The brushes of a building's cornices, at each height of `tops` (the roof's edge, the storeys' string courses): `open` is per side the edge indices with the street outside (site.mjs). */
export function corniceBrushes(b, open, tops, texture) {
  const [x0, y0] = [b.at[0] * GRID, b.at[1] * GRID];
  const [w, h] = [b.size[0] * GRID, b.size[1] * GRID];
  const tex = { sides: texture.sides, top: texture.top, bottom: texture.bottom };
  const out = [];
  const make = (axis, from, to, line, sign) => {
    // the profile in (across, z): the line plus (or minus) `out`, once for the roof's edge and once for each storey's
    for (const top of [].concat(tops)) out.push(prism(axis, CORNICE.map(([o, dz]) => [line + sign * o, top + dz]), from, to, tex.sides));
  };
  for (const [a, c] of runsOf(open.south)) make("x", x0 + a * GRID, x0 + c * GRID, y0, -1);
  for (const [a, c] of runsOf(open.north)) make("x", x0 + a * GRID, x0 + c * GRID, y0 + h, 1);
  for (const [a, c] of runsOf(open.west)) make("y", y0 + a * GRID, y0 + c * GRID, x0, -1);
  for (const [a, c] of runsOf(open.east)) make("y", y0 + a * GRID, y0 + c * GRID, x0 + w, 1);
  return out;
}

/** A hipped roof over the building's whole footprint, or null when it is too small to rise. */
export function hipRoof(b, top, texture) {
  const [x0, y0] = [b.at[0] * GRID + HIP.inset, b.at[1] * GRID + HIP.inset];
  const [x1, y1] = [(b.at[0] + b.size[0]) * GRID - HIP.inset, (b.at[1] + b.size[1]) * GRID - HIP.inset];
  const run = Math.floor(Math.min(x1 - x0, y1 - y0) / 2);
  if (b.size[0] < HIP.least || b.size[1] < HIP.least || run < 64) return null;
  const rise = Math.round(run * HIP.slope);
  const z = top;
  const long = x1 - x0 >= y1 - y0;
  const [xm, ym] = [Math.floor((x0 + x1) / 2), Math.floor((y0 + y1) / 2)];
  // the ridge, a point when the roof is square
  const ridge = long ? [[x0 + run, ym, z + rise], [x1 - run, ym, z + rise]] : [[xm, y0 + run, z + rise], [xm, y1 - run, z + rise]];
  const base = [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];
  const dedup = ridge.filter((p, i) => i === 0 || p[0] !== ridge[0][0] || p[1] !== ridge[0][1]);
  const ok = long ? (x1 - x0) % 2 === 0 && (y1 - y0) % 2 === 0 : (x1 - x0) % 2 === 0 && (y1 - y0) % 2 === 0;
  if (!ok) return null;
  return solid([...base, ...dedup], texture.sides);
}

/** The radius of a corner tower, and the cells it wants clear of walls in each direction along the two streets it stands between. */
export const TOWER = { radius: 26, sides: 8, clear: 2 };

/**
 * An eight-sided tower at a building's corner (x, y: the corner's grid vertex), from `z0` to `z1`: a round corner as the old
 * cities' bastions are, every one of its faces off the axes. Turned 22.5 degrees so no face lies along a wall.
 */
export function cornerTower(x, y, z0, z1, texture) {
  const r = TOWER.radius;
  const points = Array.from({ length: TOWER.sides }, (_, i) => {
    const a = ((22.5 + (360 * i) / TOWER.sides) * Math.PI) / 180;
    return [x + Math.round(r * Math.cos(a)), y + Math.round(r * Math.sin(a))];
  });
  return prism("z", points, z0, z1, texture);
}

/** The talus (a battered foot of the wall) across the wall, [out, z] from the grid line and the ground: 32 proud of the wall's face at the foot, nothing at 96. */
export const TALUS = [[6, 0], [40, 0], [8, 96], [6, 96]];

/**
 * The battered foot of a building's street fronts: for each run of `edges` (per side, the edge indices whose street is
 * wide and level), a prism along the front with the TALUS profile. The caller leaves out the doors' cells and the narrow streets.
 */
export function talusBrushes(b, edges, z, texture) {
  const [x0, y0] = [b.at[0] * GRID, b.at[1] * GRID];
  const [w, h] = [b.size[0] * GRID, b.size[1] * GRID];
  const out = [];
  const make = (axis, from, to, line, sign) => out.push(prism(axis, TALUS.map(([o, dz]) => [line + sign * o, z + dz]), from, to, texture));
  for (const [a, c] of runsOf(edges.south)) make("x", x0 + a * GRID, x0 + c * GRID, y0, -1);
  for (const [a, c] of runsOf(edges.north)) make("x", x0 + a * GRID, x0 + c * GRID, y0 + h, 1);
  for (const [a, c] of runsOf(edges.west)) make("y", y0 + a * GRID, y0 + c * GRID, x0, -1);
  for (const [a, c] of runsOf(edges.east)) make("y", y0 + a * GRID, y0 + c * GRID, x0 + w, 1);
  return out;
}
