// slice: a part of a site, for a build of a couple of minutes: `--only market,hollow` of build-site.
//
// The ids name districts (`mese`), buildings (`m1`) or areas (by name, `the Descent`). The region is the cells of those
// districts and the rectangles of the other two. What is whole inside it stays: areas and porticoes are clipped to it,
// a building stays when its footprint is wholly inside, a wall is cut to the cells beside the region. The level below
// (`below`), the arenas and the `rp` section are dropped: they reach across the whole site. Every cell outside the
// region is filled solid from under the ground to the sky (`fillOutside`): the cut is a blind wall, so the slice
// compiles with no leak, and hlvis has nothing to cross.
import { box } from "../../src/maps/source.mjs";
/** The size of a site cell in units (site.mjs GRID). */
const GRID = 64;

/** The cells of the region as a grid [y][x] of booleans, and the notes on what was taken. */
export function regionOf(spec, ids) {
  const [W, H] = spec.size;
  const cells = Array.from({ length: H }, () => new Array(W).fill(false));
  const want = new Set(ids.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const used = new Set();
  const mark = (from, to, id) => {
    used.add(id);
    for (let y = Math.max(0, from[1]); y < Math.min(H, to[1]); y++) for (let x = Math.max(0, from[0]); x < Math.min(W, to[0]); x++) cells[y][x] = true;
  };
  for (const d of spec.districts ?? []) if (want.has(String(d.id).toLowerCase())) mark(d.from, d.to, String(d.id).toLowerCase());
  for (const b of spec.buildings ?? []) if (want.has(String(b.id).toLowerCase())) mark(b.at, [b.at[0] + b.size[0], b.at[1] + b.size[1]], String(b.id).toLowerCase());
  for (const a of spec.areas ?? []) if (want.has(String(a.name).toLowerCase())) mark(a.from, a.to, String(a.name).toLowerCase());
  const missing = [...want].filter((id) => !used.has(id));
  return { cells, missing };
}

const inside = (cells, x, y) => !!cells[y]?.[x];
/** The runs [a, b) of consecutive values along `from..to` for which `ok(i)` holds. */
function runs(from, to, ok) {
  const out = [];
  let start = null;
  for (let i = from; i < to; i++) {
    if (ok(i)) start ??= i;
    else if (start !== null) (out.push([start, i]), (start = null));
  }
  if (start !== null) out.push([start, to]);
  return out;
}

/** Rectangles [x0, y0, x1, y1] of the cells where `ok(x, y)` holds: runs along x, joined down the rows when equal. */
export function rectanglesWhere(W, H, ok) {
  const open = new Map();
  const done = [];
  for (let y = 0; y <= H; y++) {
    const row = y < H ? runs(0, W, (x) => ok(x, y)) : [];
    const keys = new Set(row.map((r) => r.join(",")));
    for (const [k, rect] of open) if (!keys.has(k)) (done.push(rect), open.delete(k));
    for (const [a, b] of row) if (!open.has(`${a},${b}`)) open.set(`${a},${b}`, [a, y, b, y + 1]);
    else open.get(`${a},${b}`)[3] = y + 1;
  }
  return done;
}

/**
 * The spec cut to the ids. `{ spec, cells, missing, notes }`: `spec` is a copy with the same size (cells keep their
 * places, so a slice lines up with the whole map), `cells` the region, `missing` ids that named nothing, `notes` what
 * was left out.
 */
export function sliceSpec(source, ids) {
  const spec = structuredClone(source);
  const [W, H] = spec.size;
  const { cells, missing } = regionOf(spec, ids);
  const notes = [];
  // areas: clipped to the region by rows of cells
  const areas = [];
  for (const a of spec.areas ?? []) {
    const rects = rectanglesWhere(W, H, (x, y) => x >= a.from[0] && x < a.to[0] && y >= a.from[1] && y < a.to[1] && inside(cells, x, y));
    rects.forEach((r, k) => {
      const piece = { ...a, from: [r[0], r[1]], to: [r[2], r[3]], name: rects.length > 1 ? `${a.name} (${k + 1})` : a.name };
      if (a.landmark && !(a.landmark[0] >= r[0] && a.landmark[0] + 3 <= r[2] && a.landmark[1] >= r[1] && a.landmark[1] + 3 <= r[3])) delete piece.landmark;
      areas.push(piece);
    });
  }
  spec.areas = areas;
  // porticoes: the x range where every row is in the region
  spec.porticoes = (spec.porticoes ?? []).flatMap((p) =>
    runs(p.cells[0], p.cells[1], (x) => { for (let y = p.rows[0]; y < p.rows[1]; y++) if (!inside(cells, x, y)) return false; return true; }) // prettier-ignore
      .map(([a, b]) => ({ ...p, cells: [a, b] })));
  // buildings: whole or not at all
  const kept = [];
  for (const b of spec.buildings ?? []) {
    let all = true;
    for (let y = b.at[1]; y < b.at[1] + b.size[1]; y++) for (let x = b.at[0]; x < b.at[0] + b.size[0]; x++) if (!inside(cells, x, y)) all = false;
    if (all) kept.push(b);
    else if (b.at.every(Number.isFinite)) {
      let some = false;
      for (let y = b.at[1]; y < b.at[1] + b.size[1]; y++) for (let x = b.at[0]; x < b.at[0] + b.size[0]; x++) if (inside(cells, x, y)) some = true;
      if (some) notes.push(`building ${b.id} is cut by the region and left out`);
    }
  }
  spec.buildings = kept;
  // walls: unit segments with a cell of the region beside them, joined again
  spec.walls = (spec.walls ?? []).flatMap((w) => {
    const horizontal = w.from[1] === w.to[1];
    const [a0, a1] = horizontal ? [w.from[0], w.to[0]] : [w.from[1], w.to[1]];
    const line = horizontal ? w.from[1] : w.from[0];
    const beside = (i) => (horizontal ? inside(cells, i, line) || inside(cells, i, line - 1) : inside(cells, line, i) || inside(cells, line - 1, i));
    return runs(a0, a1, beside).map(([a, b], k, all) => {
      const at = (i) => (horizontal ? [i, line] : [line, i]);
      const within = (g) => (horizontal ? g[0] >= a && g[0] < b : g[1] >= a && g[1] < b);
      return { ...w, name: all.length > 1 ? `${w.name} (${k + 1})` : w.name, from: at(a), to: at(b), ...(w.gates ? { gates: w.gates.filter(within) } : {}), ...(w.gaps ? { gaps: w.gaps.filter(within) } : {}) };
    });
  });
  for (const key of ["below", "arenas", "rp", "roofs"]) if (spec[key] !== undefined) (delete spec[key], notes.push(`${key} left out of a slice`));
  return { spec, cells, missing, notes };
}

/**
 * Solid brushes over every cell outside the region, from under the ground to `top`, wearing `texture`: the blind walls
 * of the cut. The site's sky box already closes the outside; this fills the cells inside it.
 */
export function fillOutside(cells, size, top, texture) {
  const [W, H] = size;
  return rectanglesWhere(W, H, (x, y) => !inside(cells, x, y)).map(([x0, y0, x1, y1]) => box([x0 * GRID, y0 * GRID, -16], [x1 * GRID, y1 * GRID, top], texture));
}
