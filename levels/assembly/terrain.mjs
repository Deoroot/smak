// levels/assembly/terrain.mjs: the ground of a site is not one height. A site (site.mjs) is cells of 64 with a ground
// at z 0; this module gives each cell its own ground (a district's `z`, an area's `z`, a building's `z`), and joins
// the heights: ramps, stairs with landings, retaining walls; a `water` area (a canal: the channel cut down, a water
// brush in it), bridges across it and culverts under a street into it. A site with none of these is built as it was.
//
// The description (all optional; cells are the site's, y up is north):
//   districts[].z, areas[].z, porticoes[].z, buildings[].z     the ground of those cells (default: the district's, else 0)
//   areas[]: { kind: "water", name, from, to, surface?, depth? }  surface: its top, z (default: 96 under the ground of its first cell);
//                                                              depth: how deep it is (default 96, the swimmable depth)
//   joins[]: { kind: "ramp",  name, from, to, up: "east", z: [z0, z1], rank? }   a sloped floor, rising to `up`; 1:8 is the city's
//            { kind: "stair", name, from, to, up, z: [z0, z1], landings?, rank? }  steps of 16, landings flat cells between flights
//            { kind: "wall",  name, from: [x, y], to: [x, y], parapet? }    a retaining wall along a grid line between two heights
//   bridges[]: { name, from, to, z, width?, parapets? }            a deck over a water area, its top at z, `width` units wide
//   culverts[]: { name, from, to, floor?, height? }                an opening in a canal's wall: a tunnel under the streets of its cells
//
//   readTerrain(site)                -> failures: the description's own sentences (types, ranges)
//   terrainOf(site, cells, districts)  -> { ground, joins, ..., failures, warnings, measures }
//   checkTerrain(plan)               -> { failures, warnings, measures }: terrainOf for a planned site
//   terrainBrushes(terrain, options) -> { brushes, floor }: the fill under the ground, the ramps and stairs, the water,
//                                       the bridges and the culverts, and the z of the floor the sky box stands on
import { box, wedge } from "../../src/maps/source.mjs";
import { rectanglesOf } from "./assemble.mjs";

const GRID = 64;
/** The step a player walks up (the engine's 18, less a margin) and the riser of a stair. */
export const STEP = 16;
/** Steeper than this a floor is a wall to the engine (its normal's z under 0.7: 45.6 degrees): tan 45 degrees. */
export const WALKABLE_SLOPE = 1;
/** The city's ramps (1:8, 7 degrees). */
export const CITY_SLOPE = 1 / 8;
/** A flight of more steps than this wants a landing. */
export const FLIGHT_MOST = 8;
/** The narrowest a stair or ramp is (a street's lowest rank), and a main street's. */
export const WIDTH = { least: 96, main: 128 };
/** A tread's least depth. */
export const TREAD = 16;
/** The water's swimmable depth, and the least a player swims in. */
export const SWIM_DEPTH = 96;
export const SWIM_LEAST = 64;
/** A bank this high over the water cannot be climbed from it (the engine's water jump). */
export const BANK_CLIMB = 40;
/** The air a swimmer wants under a deck or a culvert's ceiling over the water, and a standing player's height. */
export const AIR = 48;
export const STANDING = 72;
export const PARAPET_HEIGHT = 40;
export const PARAPET_THICK = 8;
/** The drop a retaining wall's top gets a parapet from. */
export const GUARD_DROP = 64;
export const WATER_DEFAULT = { texture: "!gwater3" };
const DIRS = { east: [1, 0], west: [-1, 0], north: [0, 1], south: [0, -1] };
const isInt = (v) => Number.isInteger(v);
const pair = (v) => Array.isArray(v) && v.length === 2 && v.every(isInt);
const rectOk = (a) => pair(a.from) && pair(a.to) && a.to[0] > a.from[0] && a.to[1] > a.from[1];
/** The labels a player walks on in public (site.mjs PUBLIC: this module cannot import it, site.mjs imports this one). */
const WALKED = new Set(["street", "portico", "square", "plaza", "alley", "landmark", "paving", "ramp", "stair"]);

/** The description's own sentences: types and ranges, before any cell is known. */
export function readTerrain(site) {
  const failures = [];
  const fail = (s) => failures.push(s);
  for (const d of site.districts ?? []) if (d.z !== undefined && !isInt(d.z)) fail(`district ${d.id}: z is ${JSON.stringify(d.z)}; it wants a whole number of units`);
  for (const a of site.areas ?? []) {
    if (a.z !== undefined && !isInt(a.z)) fail(`${a.name}: z is ${JSON.stringify(a.z)}; it wants a whole number of units`);
    if (a.kind === "water") {
      if (a.surface !== undefined && !isInt(a.surface)) fail(`${a.name}: surface is ${JSON.stringify(a.surface)}; it wants a whole number of units (z)`);
      if (a.depth !== undefined && !(isInt(a.depth) && a.depth > 0)) fail(`${a.name}: depth is ${JSON.stringify(a.depth)}; it wants a whole number of units over 0`);
    } else if (a.surface !== undefined || a.depth !== undefined) fail(`${a.name}: surface and depth are for a water area, and this is a ${a.kind}`);
  }
  for (const b of site.buildings ?? []) if (b.z !== undefined && !isInt(b.z)) fail(`building ${b.id}: z is ${JSON.stringify(b.z)}; it wants a whole number of units`);
  for (const [k, p] of (site.porticoes ?? []).entries()) if (p.z !== undefined && !isInt(p.z)) fail(`portico ${k + 1}: z is ${JSON.stringify(p.z)}; it wants a whole number of units`);
  const names = new Set();
  const named = (kind, o, k) => {
    o.name ??= `${kind} ${k + 1}`;
    if (names.has(o.name)) fail(`${o.name} is named twice (joins, bridges, culverts and areas are named)`);
    names.add(o.name);
  };
  for (const a of site.areas ?? []) names.add(a.name);
  for (const [k, j] of (site.joins ?? []).entries()) {
    named(j.kind ?? "join", j, k);
    if (!["ramp", "stair", "wall"].includes(j.kind)) {
      fail(`${j.name}: its kind is ${JSON.stringify(j.kind)}; a join is a ramp, a stair or a wall`);
      continue;
    }
    if (j.kind === "wall") {
      if (!pair(j.from) || !pair(j.to) || (j.from[0] !== j.to[0] && j.from[1] !== j.to[1]) || (j.from[0] === j.to[0] && j.from[1] === j.to[1])) fail(`${j.name}: a wall wants from [x, y] and to [x, y], grid vertices on one line`); // prettier-ignore
      continue;
    }
    if (!rectOk(j)) fail(`${j.name}: it wants from [x, y] and to [x, y] (cells), to past from`);
    if (!DIRS[j.up]) fail(`${j.name}: up is ${JSON.stringify(j.up)}; it wants east, west, north or south (the side its floor is higher on)`);
    if (!pair(j.z) || j.z[1] <= j.z[0]) fail(`${j.name}: z is ${JSON.stringify(j.z)}; it wants [z at the foot, z at the head], the head higher`);
    if (j.rank !== undefined && !["main", "street"].includes(j.rank)) fail(`${j.name}: rank is ${JSON.stringify(j.rank)}; it wants main or street`);
    if (j.kind === "stair" && j.landings !== undefined && !(isInt(j.landings) && j.landings >= 0)) fail(`${j.name}: landings is ${JSON.stringify(j.landings)}; it wants a whole number of flat cells, 0 or more`);
  }
  for (const [k, b] of (site.bridges ?? []).entries()) {
    named("bridge", b, k);
    if (!rectOk(b)) fail(`${b.name}: it wants from [x, y] and to [x, y] (cells), to past from`);
    if (!isInt(b.z)) fail(`${b.name}: z is ${JSON.stringify(b.z)}; it wants the deck's top, whole units`);
    if (b.width !== undefined && !(isInt(b.width) && b.width > 0)) fail(`${b.name}: width is ${JSON.stringify(b.width)}; it wants whole units`);
    if (b.axis !== undefined && !["x", "y"].includes(b.axis)) fail(`${b.name}: axis is ${JSON.stringify(b.axis)}; it wants x or y (the way it crosses)`);
  }
  for (const [k, c] of (site.culverts ?? []).entries()) {
    named("culvert", c, k);
    if (!rectOk(c)) fail(`${c.name}: it wants from [x, y] and to [x, y] (cells), to past from`);
    for (const f of ["floor", "height"]) if (c[f] !== undefined && !isInt(c[f])) fail(`${c.name}: ${f} is ${JSON.stringify(c[f])}; it wants whole units`);
  }
  return failures;
}

/** The cells of a rectangle [x0,y0]..[x1,y1) as [x, y]. */
const cellsIn = (r) => {
  const list = [];
  for (let y = r.from[1]; y < r.to[1]; y++) for (let x = r.from[0]; x < r.to[0]; x++) list.push([x, y]);
  return list;
};
/** The numbers of a list of ints as "a..b" runs. */
const runs = (list) => {
  const sorted = [...new Set(list)].sort((a, b) => a - b);
  const out = [];
  for (const v of sorted) {
    if (out.length && out.at(-1)[1] === v - 1) out.at(-1)[1] = v;
    else out.push([v, v]);
  }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}..${b}`)).join(", ");
};

/**
 * The ground of the site cell by cell, its joins, bridges, culverts and water measured: { ground [y][x], water (areas),
 * joins, bridges, culverts, lowest, highest, failures, warnings, measures }. `cells` are planSite's labels (the join
 * cells already labelled "ramp" and "stair", the water's "water"), `districts` its district ids.
 */
export function terrainOf(site, cells, districts) {
  const failures = [];
  const warnings = [];
  const fail = (s) => failures.push(s);
  const warn = (s) => warnings.push(s);
  const H = cells.length;
  const W = cells[0]?.length ?? 0;
  const inSite = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const districtZ = (id) => (site.districts ?? []).find((d) => d.id === id)?.z ?? 0;
  // the ground: a district's, then an area's or a portico's own
  const ground = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => districtZ(districts?.[y]?.[x])));
  const waters = [];
  for (const a of site.areas ?? []) {
    if (a.kind === "water") {
      const first = ground[a.from[1]]?.[a.from[0]] ?? 0;
      const surface = a.surface ?? first - 96;
      const depth = a.depth ?? SWIM_DEPTH;
      const w = { ...a, surface, depth, bed: surface - depth, rect: { from: a.from, to: a.to } };
      waters.push(w);
      for (const [x, y] of cellsIn(a)) if (inSite(x, y) && cells[y][x] === "water") ground[y][x] = w.bed;
    } else if (a.z !== undefined) for (const [x, y] of cellsIn(a)) if (inSite(x, y)) ground[y][x] = a.z;
  }
  for (const p of site.porticoes ?? []) if (p.z !== undefined) for (let y = p.rows[0]; y < p.rows[1]; y++) for (let x = p.cells[0]; x < p.cells[1]; x++) if (inSite(x, y)) ground[y][x] = p.z; // prettier-ignore
  // a building stands at one height
  for (const b of site.buildings ?? []) {
    const own = cellsIn({ from: b.at, to: [b.at[0] + b.size[0], b.at[1] + b.size[1]] }).filter(([x, y]) => inSite(x, y));
    const heights = [...new Set(own.map(([x, y]) => ground[y][x]))];
    if (b.z === undefined && heights.length > 1) fail(`building ${b.id} stands across the heights ${heights.join(" and ")}; give it a z, or move it to one district`);
    b.groundZ = b.z ?? ground[b.at[1]]?.[b.at[0]] ?? 0;
    for (const [x, y] of own) ground[y][x] = b.groundZ;
  }
  const named = new Map(waters.map((w) => [w.name, w]));
  const waterAt = (x, y) => waters.find((w) => x >= w.from[0] && x < w.to[0] && y >= w.from[1] && y < w.to[1]);
  const walked = (x, y) => inSite(x, y) && WALKED.has(cells[y][x]);

  // ── the ramps and stairs: each cell's low and high z along the way up ──
  const joinCell = new Map(); // "x,y" -> { join, low, high, steps }
  const joins = [];
  for (const j of site.joins ?? []) {
    if (j.kind === "wall") continue;
    const [dx, dy] = DIRS[j.up];
    const across = dx ? "y" : "x";
    const n = dx ? j.to[0] - j.from[0] : j.to[1] - j.from[1];
    const m = dx ? j.to[1] - j.from[1] : j.to[0] - j.from[0];
    const rise = j.z[1] - j.z[0];
    const width = m * GRID;
    const r = { ...j, n, m, rise, run: n * GRID, width, cellsAlong: [] };
    joins.push(r);
    // the width the rank asks, and the street it climbs from
    const least = j.rank === "main" ? WIDTH.main : WIDTH.least;
    if (width < least) fail(`${j.name}: ${width} wide; a ${j.kind} of ${j.rank === "main" ? "a main street" : "a street"} is ${least} wide at least`);
    const streetAt = (x, y) => (site.areas ?? []).find((a) => (a.kind === "street" || a.kind === "alley") && x >= a.from[0] && x < a.to[0] && y >= a.from[1] && y < a.to[1]); // prettier-ignore
    const mid = (k, beyond) => {
      const lane = j.from[across === "y" ? 1 : 0] + Math.floor(m / 2);
      return dx ? [beyond < 0 ? j.from[0] - 1 : j.to[0], lane] : [lane, beyond < 0 ? j.from[1] - 1 : j.to[1]];
    };
    const [fx, fy] = dx ? (dx > 0 ? mid(0, -1) : mid(0, 1)) : dy > 0 ? mid(0, -1) : mid(0, 1);
    const [hx, hy] = dx ? (dx > 0 ? mid(0, 1) : mid(0, -1)) : dy > 0 ? mid(0, 1) : mid(0, -1);
    for (const [px, py, what] of [[fx, fy, "foot"], [hx, hy, "head"]]) {
      const s = streetAt(px, py);
      if (!s) continue;
      const wide = (across === "y" ? s.to[1] - s.from[1] : s.to[0] - s.from[0]) * GRID;
      if (width > wide) fail(`${j.name}: ${width} wide at its ${what}, wider than the ${s.name} it meets (${wide}); a ${j.kind} is no wider than its street`);
    }
    // the z along it
    const along = [];
    if (j.kind === "ramp") {
      const slope = rise / r.run;
      r.slope = slope;
      r.degrees = (Math.atan(slope) * 180) / Math.PI;
      if (slope > WALKABLE_SLOPE) fail(`${j.name}: a ramp rising ${rise} over ${r.run} (${r.degrees.toFixed(0)} degrees) is steeper than a player walks; the engine slides off a floor over 45 degrees (1:1)`); // prettier-ignore
      else if (slope > CITY_SLOPE + 1e-9) warn(`${j.name}: a ramp rising ${rise} over ${r.run} is 1:${(r.run / rise).toFixed(1)} (${r.degrees.toFixed(1)} degrees), steeper than the city's 1:8; ${rise * 8} long is 1:8`); // prettier-ignore
      for (let i = 0; i < n; i++) along.push({ low: j.z[0] + (rise * i) / n, high: j.z[0] + (rise * (i + 1)) / n });
    } else {
      r.steps = rise / STEP;
      if (!isInt(r.steps)) {
        fail(`${j.name}: it rises ${rise}, which is not whole steps of ${STEP}`);
        r.steps = Math.round(r.steps);
      }
      const landings = j.landings ?? 0;
      r.landings = landings;
      const flat = new Set();
      for (let k = 1; k <= landings; k++) flat.add(Math.round((k * n) / (landings + 1)));
      const treads = n - [...flat].filter((i) => i > 0 && i < n).length;
      if (landings && (flat.size < landings || flat.has(0) || flat.has(n))) fail(`${j.name}: ${landings} landings do not fit in ${n} cells`);
      if (treads < 1) fail(`${j.name}: ${n} cells and ${landings} landings leave no cell for steps`);
      else {
        // the steps shared among the tread cells, the later cells taking the remainder
        const base = Math.floor(r.steps / treads);
        const extra = r.steps - base * treads;
        let z = j.z[0];
        let t = 0;
        r.tread = Infinity;
        for (let i = 0; i < n; i++) {
          if (flat.has(i)) {
            along.push({ low: z, high: z, steps: 0 });
            continue;
          }
          const s = base + (t >= treads - extra ? 1 : 0);
          t++;
          if (s > 0) r.tread = Math.min(r.tread, GRID / s);
          along.push({ low: z, high: z + s * STEP, steps: s });
          z += s * STEP;
        }
        if (r.tread < TREAD) fail(`${j.name}: ${r.steps} steps over ${treads} cells of 64 are ${r.tread.toFixed(0)} deep; a step is ${TREAD} deep at least (${Math.ceil((r.steps * TREAD) / GRID)} cells of steps, or fewer steps)`); // prettier-ignore
        if (landings === 0 && r.steps > FLIGHT_MOST) warn(`${j.name}: a flight of ${r.steps} steps (rise ${rise}) with no landing; a flight is ${FLIGHT_MOST} steps at most between landings`); // prettier-ignore
      }
    }
    // each cell, from the foot (along index 0) towards `up`
    for (let i = 0; i < n; i++) {
      const lanes = cellsIn(j).filter(([x, y]) => (dx > 0 ? x - j.from[0] : dx < 0 ? j.to[0] - 1 - x : dy > 0 ? y - j.from[1] : j.to[1] - 1 - y) === i);
      for (const [x, y] of lanes) {
        if (cells[y]?.[x] !== j.kind) continue;
        joinCell.set(`${x},${y}`, { join: r, index: i, dir: [dx, dy], ...(along[i] ?? { low: j.z[0], high: j.z[1] }) });
        ground[y][x] = along[i]?.low ?? j.z[0];
      }
      r.cellsAlong.push(lanes.length);
    }
  }
  /** The z of the floor at cell (x, y) on the side it is met from (step [dx, dy] from the neighbour): a join's low or high, else the ground; null where a join is met from its side. */
  const surfaceAt = (x, y, step) => {
    const c = joinCell.get(`${x},${y}`);
    if (!c) return ground[y][x];
    const [dx, dy] = c.dir;
    const dot = step[0] * dx + step[1] * dy; // met from the foot side, the walker stepping towards `up`: >0
    if (dot === 0) return null;
    return dot > 0 ? c.low : c.high;
  };
  // the ends: the cell beyond the foot and beyond the head
  for (const r of joins) {
    const [dx, dy] = DIRS[r.up];
    const lanes = dx ? Array.from({ length: r.m }, (_, k) => r.from[1] + k) : Array.from({ length: r.m }, (_, k) => r.from[0] + k);
    const ends = [
      { what: "foot", z: r.z[0], at: (l) => (dx ? [dx > 0 ? r.from[0] - 1 : r.to[0], l] : [l, dy > 0 ? r.from[1] - 1 : r.to[1]]), step: [-dx, -dy] },
      { what: "head", z: r.z[1], at: (l) => (dx ? [dx > 0 ? r.to[0] : r.from[0] - 1, l] : [l, dy > 0 ? r.to[1] : r.from[1] - 1]), step: [dx, dy] },
    ];
    for (const e of ends) {
      const bad = [];
      let water = false;
      for (const l of lanes) {
        const [x, y] = e.at(l);
        if (!inSite(x, y)) continue;
        const label = cells[y][x];
        if (label === "water") {
          water = true;
          continue;
        }
        const z = surfaceAt(x, y, e.step);
        if (z === null || !(WALKED.has(label) || label.startsWith("building "))) continue;
        if (Math.abs(z - e.z) > STEP) bad.push([z, x, y]);
      }
      if (bad.length) fail(`${r.name}: its ${e.what} is at z ${e.z}, and the ground it meets at ${bad[0][1]},${bad[0][2]} is at z ${bad[0][0]}; a ${r.kind} meets its ground within ${STEP}`);
      if (water && e.what === "head") fail(`${r.name}: its head ends in the water; a ${r.kind} climbs out of it, not into it`);
    }
  }

  // ── retaining walls, and the heights that meet with nothing ──
  const walled = new Set(); // "x,y|x,y" of the two cells either side
  const edgeKey = (a, b) => (a[0] + a[1] * 4096 < b[0] + b[1] * 4096 ? `${a}|${b}` : `${b}|${a}`);
  const walls = [];
  for (const w of site.joins ?? []) {
    if (w.kind !== "wall") continue;
    const vertical = w.from[0] === w.to[0];
    const [lo, hi] = vertical ? [Math.min(w.from[1], w.to[1]), Math.max(w.from[1], w.to[1])] : [Math.min(w.from[0], w.to[0]), Math.max(w.from[0], w.to[0])];
    const fixed = vertical ? w.from[0] : w.from[1];
    const edges = [];
    let flatRun = 0;
    for (let t = lo; t < hi; t++) {
      const a = vertical ? [fixed - 1, t] : [t, fixed - 1];
      const b = vertical ? [fixed, t] : [t, fixed];
      if (!inSite(...a) || !inSite(...b)) {
        fail(`${w.name}: it runs outside the site at ${vertical ? `${fixed},${t}` : `${t},${fixed}`}`);
        break;
      }
      walled.add(edgeKey(a, b));
      const [za, zb] = [ground[a[1]][a[0]], ground[b[1]][b[0]]];
      if (Math.abs(za - zb) <= STEP) flatRun++;
      edges.push({ a, b, za, zb });
    }
    if (flatRun === edges.length && edges.length) warn(`${w.name}: the ground is level along it (z ${edges[0].za}); a retaining wall stands where two heights meet`);
    else if (flatRun) warn(`${w.name}: the ground is level along ${flatRun} of its ${edges.length} cells (a wall stands where two heights meet)`);
    walls.push({ ...w, vertical, fixed, lo, hi, edges });
  }
  const open = [];
  const addOpen = (a, b) => {
    if (!walked(...a) || !walked(...b) || joinCell.has(`${a}`) || joinCell.has(`${b}`)) return;
    const [za, zb] = [ground[a[1]][a[0]], ground[b[1]][b[0]]];
    if (Math.abs(za - zb) > STEP && !walled.has(edgeKey(a, b))) open.push({ a, b, za, zb });
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (x + 1 < W) addOpen([x, y], [x + 1, y]);
      if (y + 1 < H) addOpen([x, y], [x, y + 1]);
    }
  // one sentence for each run along a line
  const lines = new Map();
  for (const e of open) {
    const vertical = e.a[1] === e.b[1];
    const key = `${vertical ? "x" : "y"}${vertical ? e.b[0] : e.b[1]}:${Math.min(e.za, e.zb)}:${Math.max(e.za, e.zb)}`;
    (lines.get(key) ?? lines.set(key, { vertical, line: vertical ? e.b[0] : e.b[1], lo: Math.min(e.za, e.zb), hi: Math.max(e.za, e.zb), along: [] }).get(key)).along.push(vertical ? e.a[1] : e.a[0]); // prettier-ignore
  }
  for (const l of lines.values()) fail(`the ground at z ${l.lo} and z ${l.hi} meets along ${l.vertical ? "x" : "y"} ${l.line}, ${l.vertical ? "y" : "x"} ${runs(l.along)}, with no ramp, stair or retaining wall: a step of ${l.hi - l.lo} that nothing joins; declare a wall there, or a ramp or a stair`); // prettier-ignore

  // ── the water: a way out, and its depth ──
  for (const w of waters) {
    if (w.depth < SWIM_LEAST) fail(`${w.name}: ${w.depth} deep; a player swims in ${SWIM_LEAST} at the least (the design's ${SWIM_DEPTH})`);
    else if (w.depth < SWIM_DEPTH) warn(`${w.name}: ${w.depth} deep, less than the swimmable ${SWIM_DEPTH}`);
    let exit = false;
    for (const [x, y] of cellsIn(w))
      for (const [dx, dy] of Object.values(DIRS)) {
        const [nx, ny] = [x + dx, y + dy];
        if (!walked(nx, ny) || waterAt(nx, ny)) continue;
        const c = joinCell.get(`${nx},${ny}`);
        // a join met at its foot (a stair or ramp going down into the water): its low z; met at its side or head, no way out
        const top = c ? (c.dir[0] === dx && c.dir[1] === dy ? c.low : null) : ground[ny][nx];
        if (top !== null && top <= w.surface + BANK_CLIMB && top >= w.surface - 3 * STEP) exit = true;
      }
    if (!exit) warn(`${w.name}: no bank, ramp or stair within ${BANK_CLIMB} of its surface (z ${w.surface}); a swimmer cannot climb out`);
  }

  // ── bridges ──
  const bridges = [];
  for (const b of site.bridges ?? []) {
    const dxn = b.to[0] - b.from[0];
    const dyn = b.to[1] - b.from[1];
    if (dxn === dyn && !b.axis) {
      fail(`${b.name}: its rectangle is square; say which way it crosses with axis "x" or "y"`);
      continue;
    }
    const axis = b.axis ?? (dxn > dyn ? "x" : "y");
    const len = axis === "x" ? dxn : dyn;
    const wideCells = axis === "x" ? dyn : dxn;
    const width = b.width ?? wideCells * GRID;
    const r = { ...b, axis, len, width, parapets: b.parapets ?? true, wet: 0 };
    bridges.push(r);
    if (width < WIDTH.least) fail(`${b.name}: ${width} wide; a bridge is ${WIDTH.least} wide at least (a street's lowest rank)`);
    if (width > wideCells * GRID) fail(`${b.name}: ${width} wide in a rectangle of ${wideCells * GRID}`);
    const lanes = axis === "x" ? Array.from({ length: dyn }, (_, k) => b.from[1] + k) : Array.from({ length: dxn }, (_, k) => b.from[0] + k);
    const step = axis === "x" ? [1, 0] : [0, 1];
    const seen = new Set();
    let short = null;
    let building = null;
    const beyond = [];
    for (const l of lanes) {
      const at = (i) => (axis === "x" ? [b.from[0] + i, l] : [l, b.from[1] + i]);
      for (let i = 0; i < len; i++) {
        const [x, y] = at(i);
        const w = inSite(x, y) ? waterAt(x, y) : null;
        if (w) {
          seen.add(w);
          r.wet++;
        }
        if (inSite(x, y) && cells[y][x].startsWith("building ")) building ??= [x, y];
      }
      for (const [i, sign] of [[-1, -1], [len, 1]]) {
        const [x, y] = at(i);
        if (!inSite(x, y)) {
          fail(`${b.name}: it reaches the edge of the site; a bridge lands on ground`);
          continue;
        }
        if (waterAt(x, y)) short ??= [x, y, sign];
        else beyond.push({ x, y, sign });
      }
    }
    r.over = [...seen];
    if (building) fail(`${b.name}: it crosses the cell ${building.join(",")}, a building`);
    if (!seen.size) fail(`${b.name}: it crosses no water; a bridge spans a water area`);
    if (short) fail(`${b.name}: it is shorter than the canal: the water goes on past its ${short[2] < 0 ? "start" : "end"} at ${short[0]},${short[1]}; a bridge reaches both banks`);
    for (const w of seen) {
      if (b.z - 16 < w.surface + AIR) fail(`${b.name}: its underside (z ${b.z - 16}) is within ${AIR} of the water of ${w.name} (z ${w.surface}); a swimmer wants air under a bridge`);
    }
    // the ground at its ends
    const out = beyond.find(({ x, y, sign }) => {
      const label = cells[y][x];
      if (!WALKED.has(label) && !label.startsWith("building ")) return true;
      const z = surfaceAt(x, y, [step[0] * sign, step[1] * sign]);
      return z !== null && Math.abs(z - b.z) > STEP;
    });
    if (out && !short) {
      const label = cells[out.y][out.x];
      if (!WALKED.has(label) && !label.startsWith("building ")) fail(`${b.name}: its ${out.sign < 0 ? "start" : "end"} lands on ${label} at ${out.x},${out.y}; a bridge lands on public ground`);
      else fail(`${b.name}: its deck is at z ${b.z}, and the ground at its ${out.sign < 0 ? "start" : "end"}, ${out.x},${out.y}, is at z ${surfaceAt(out.x, out.y, [step[0] * out.sign, step[1] * out.sign])}; a bridge lands within ${STEP} of its ground (a ramp or a stair at the end joins them)`); // prettier-ignore
    }
  }

  // ── culverts ──
  const culverts = [];
  for (const c of site.culverts ?? []) {
    const dxn = c.to[0] - c.from[0];
    const dyn = c.to[1] - c.from[1];
    const axis = dxn >= dyn ? "x" : "y";
    const len = axis === "x" ? dxn : dyn;
    const wideCells = axis === "x" ? dyn : dxn;
    // the end that meets the water
    const lanes = axis === "x" ? Array.from({ length: dyn }, (_, k) => c.from[1] + k) : Array.from({ length: dxn }, (_, k) => c.from[0] + k);
    const endAt = (sign, l) => (axis === "x" ? [sign < 0 ? c.from[0] - 1 : c.to[0], l] : [l, sign < 0 ? c.from[1] - 1 : c.to[1]]);
    let mouth = null;
    for (const sign of [-1, 1]) {
      const ws = lanes.map((l) => waterAt(...endAt(sign, l)));
      if (ws.every(Boolean)) mouth = { sign, water: ws[0] };
    }
    const own = cellsIn(c);
    const bad = own.find(([x, y]) => !inSite(x, y) || !["street", "plaza", "square", "alley", "paving"].includes(cells[y][x]));
    if (bad) {
      fail(`${c.name}: the cell ${bad.join(",")} is ${inSite(...bad) ? cells[bad[1]][bad[0]] : "outside the site"}; a culvert runs under a street, plaza or lane`);
      continue;
    }
    if (!mouth) {
      fail(`${c.name}: neither end of it opens onto water; a culvert's mouth is the canal's wall (the cells beside its short end must all be water)`);
      continue;
    }
    const g = ground[c.from[1]][c.from[0]];
    if (new Set(own.map(([x, y]) => ground[y][x])).size > 1) fail(`${c.name}: the street over it is at more than one height`);
    const w = mouth.water;
    const floor = c.floor ?? w.bed;
    const height = c.height ?? Math.max(w.surface + AIR - floor, STANDING + 8);
    const ceil = floor + height;
    const r = { ...c, axis, len, width: wideCells * GRID, mouth, floor, height, ceil, ground: g, water: w, wet: floor < w.surface };
    culverts.push(r);
    if (floor < w.bed) fail(`${c.name}: its floor (z ${floor}) is under the bed of ${w.name} (z ${w.bed})`);
    if (r.width < 64) fail(`${c.name}: ${r.width} wide; a culvert is 64 wide at the least`);
    else if (r.width < WIDTH.least) warn(`${c.name}: ${r.width} wide; a guard or a citizen wants ${WIDTH.least}`);
    if (height < STANDING) fail(`${c.name}: ${height} high; a player stands ${STANDING}`);
    if (ceil > g - 2 * STEP) fail(`${c.name}: its ceiling (z ${ceil}) leaves less than ${2 * STEP} under the street (z ${g}); lower it, or make it shorter (height ${height}, floor ${floor})`);
    if (r.wet && ceil < w.surface + AIR) warn(`${c.name}: its ceiling (z ${ceil}) is within ${AIR} of the water (z ${w.surface}); a swimmer has little air`);
  }
  for (const [i, a] of culverts.entries()) for (const b of culverts.slice(i + 1)) if (a.from[0] < b.to[0] && b.from[0] < a.to[0] && a.from[1] < b.to[1] && b.from[1] < a.to[1]) fail(`${a.name} and ${b.name} overlap`); // prettier-ignore

  const all = ground.flat();
  const lowest = Math.min(0, ...all, ...culverts.map((c) => c.floor));
  const highest = Math.max(0, ...all, ...bridges.map((b) => b.z + PARAPET_HEIGHT));
  const sloped = [...joinCell.values()].filter((c) => c.join.kind === "ramp").length;
  const measures = {
    heights: [...new Set(all)].sort((a, b) => a - b),
    lowest,
    highest,
    ramps: joins.filter((j) => j.kind === "ramp").map((j) => ({ name: j.name, rise: j.rise, run: j.run, slope: j.slope })),
    stairs: joins.filter((j) => j.kind === "stair").map((j) => ({ name: j.name, steps: j.steps, landings: j.landings, tread: j.tread })),
    walls: walls.length,
    water: waters.map((w) => ({ name: w.name, surface: w.surface, bed: w.bed })),
    bridges: bridges.map((b) => ({ name: b.name, z: b.z, width: b.width, over: b.over.map((w) => w.name) })),
    culverts: culverts.map((c) => ({ name: c.name, floor: c.floor, ceil: c.ceil })),
    slopedCells: sloped,
  };
  return { ground, waters, joins, joinCell, walls, bridges, culverts, lowest, highest, failures, warnings, measures, named, varied: measures.heights.length > 1 || waters.length > 0 };
}

/** terrainOf for a planned site (planSite's): the same sentences, for the broken cases and for a drawing. */
export function checkTerrain(plan) {
  const failures = readTerrain(plan.site);
  if (failures.length) return { failures, warnings: [], measures: null };
  // (the districts again from the description: a case changes it, a plan is read as it stands)
  const districts = plan.cells.map((row, y) => row.map((_, x) => (plan.site.districts ?? []).find((d) => x >= d.from[0] && x < d.to[0] && y >= d.from[1] && y < d.to[1])?.id ?? null));
  const t = terrainOf(plan.site, plan.cells, districts);
  return { failures: t.failures, warnings: t.warnings, measures: t.measures };
}

const WALL = "sinmarblewall";
const FLOOR = "sinpalacefloor";

/**
 * The solid the ground stands on, and the shapes on it, as brushes. The sky box's floor is at `floor` - 32 .. - 16 (0 on
 * a flat site: -32..-16 as ever); the fill under each cell from there to the underside of its paving (z - 16);
 * a ramp a box and a wedge, a stair a box a tread, the water a brush of its texture over the bed, a bridge's deck and
 * parapets, a culvert's floor and ceiling; a retaining wall's parapet.
 * `holes`: cells to leave without fill (the level below's ways down).
 */
export function terrainBrushes(t, { wall = WALL, floorTexture = FLOOR, water = WATER_DEFAULT.texture, holes = new Set(), buildings = [] } = {}) {
  const brushes = [];
  const F = Math.min(0, t.lowest);
  const base = F - 16;
  const H = t.ground.length;
  const W = t.ground[0]?.length ?? 0;
  const culvertAt = new Map();
  for (const c of t.culverts)
    for (let y = c.from[1]; y < c.to[1]; y++) for (let x = c.from[0]; x < c.to[0]; x++) culvertAt.set(`${x},${y}`, c);
  // the fill: columns of one signature joined into rectangles
  const groups = new Map();
  const add = (sig, x, y, make) => (groups.get(sig) ?? groups.set(sig, { make, cells: new Set() }).get(sig)).cells.add(`${x},${y}`);
  const waterBed = new Map();
  for (const w of t.waters) for (let y = w.from[1]; y < w.to[1]; y++) for (let x = w.from[0]; x < w.to[0]; x++) waterBed.set(`${x},${y}`, w);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const key = `${x},${y}`;
      if (holes.has(key) || t.joinCell.has(key)) continue;
      const z = t.ground[y][x];
      const c = culvertAt.get(key);
      const w = waterBed.get(key);
      if (c) {
        add(`c${c.floor}:${c.ceil}:${z}`, x, y, [
          (min, max) => (c.floor > base ? box([min[0], min[1], base], [max[0], max[1], c.floor], { top: floorTexture, sides: wall, bottom: wall }) : null),
          (min, max) => (z - 16 > c.ceil ? box([min[0], min[1], c.ceil], [max[0], max[1], z - 16], wall) : null),
        ]);
      } else if (w) {
        if (z > base) add(`b${z}`, x, y, [(min, max) => box([min[0], min[1], base], [max[0], max[1], z], { top: wall, sides: wall, bottom: wall })]);
      } else if (z - 16 > base) add(`g${z}`, x, y, [(min, max) => box([min[0], min[1], base], [max[0], max[1], z - 16], wall)]);
    }
  for (const g of groups.values())
    for (const [x, y, rw, rh] of rectanglesOf(g.cells)) for (const make of g.make) {
      const b = make([x * GRID, y * GRID], [(x + rw) * GRID, (y + rh) * GRID]);
      if (b) brushes.push(b);
    }
  // the water: one brush a rectangle of each area, from the bed to the surface; and in a culvert that floods
  for (const w of t.waters) brushes.push(box([w.from[0] * GRID, w.from[1] * GRID, w.bed], [w.to[0] * GRID, w.to[1] * GRID, w.surface], water));
  for (const c of t.culverts)
    if (c.wet) brushes.push(box([c.from[0] * GRID, c.from[1] * GRID, c.floor], [c.to[0] * GRID, c.to[1] * GRID, c.water.surface], water));
  // the ramps and the stairs
  for (const j of t.joins) {
    const [min, max] = [[j.from[0] * GRID, j.from[1] * GRID], [j.to[0] * GRID, j.to[1] * GRID]];
    const [dx, dy] = DIRS[j.up];
    const tex = { top: floorTexture, sides: wall, bottom: wall };
    if (j.kind === "ramp") {
      if (j.z[0] > base) brushes.push(box([min[0], min[1], base], [max[0], max[1], j.z[0]], tex));
      if (j.slope <= WALKABLE_SLOPE) brushes.push(wedge([min[0], min[1], j.z[0]], [max[0], max[1], j.z[1]], dx > 0 ? "+x" : dx < 0 ? "-x" : dy > 0 ? "+y" : "-y", tex));
      continue;
    }
    // cell by cell from the foot: the tread boxes, each from the base up to its top
    for (let i = 0; i < j.n; i++) {
      const cell = t.joinCell.get(`${dx > 0 ? j.from[0] + i : dx < 0 ? j.to[0] - 1 - i : j.from[0]},${dy > 0 ? j.from[1] + i : dy < 0 ? j.to[1] - 1 - i : j.from[1]}`);
      if (!cell) continue;
      const x0 = dx > 0 ? j.from[0] + i : dx < 0 ? j.to[0] - 1 - i : j.from[0];
      const y0 = dy > 0 ? j.from[1] + i : dy < 0 ? j.to[1] - 1 - i : j.from[1];
      const cmin = [x0 * GRID, y0 * GRID];
      const cmax = [(x0 + (dx ? 1 : j.m)) * GRID, (y0 + (dy ? 1 : j.m)) * GRID];
      const s = cell.steps ?? 0;
      if (s === 0) {
        if (cell.low > base) brushes.push(box([cmin[0], cmin[1], base], [cmax[0], cmax[1], cell.low], tex));
        continue;
      }
      for (let k = 1; k <= s; k++) {
        const a = (k - 1) / s;
        const b = k / s;
        const lo = [...cmin];
        const hi = [...cmax];
        // the tread k covers the cell from its foot side a..b of the way; each rises on the one before (it runs on to the head side)
        if (dx > 0) (lo[0] = cmin[0] + (cmax[0] - cmin[0]) * a), (hi[0] = cmax[0]);
        else if (dx < 0) (hi[0] = cmax[0] - (cmax[0] - cmin[0]) * a), (lo[0] = cmin[0]);
        else if (dy > 0) (lo[1] = cmin[1] + (cmax[1] - cmin[1]) * a), (hi[1] = cmax[1]);
        else (hi[1] = cmax[1] - (cmax[1] - cmin[1]) * a), (lo[1] = cmin[1]);
        void b;
        const top = cell.low + k * STEP;
        brushes.push(box([lo[0], lo[1], base], [hi[0], hi[1], top], tex));
      }
    }
  }
  // the retaining walls' parapets, on the higher side
  for (const w of t.walls) {
    if (w.parapet === false) continue;
    for (const e of w.edges) {
      const drop = Math.abs(e.za - e.zb);
      if (drop < STEP + 1 || (w.parapet === undefined && drop < GUARD_DROP)) continue;
      const [hi, z] = e.za > e.zb ? [e.a, e.za] : [e.b, e.zb];
      const sideLow = e.za > e.zb ? e.b : e.a;
      const [ox, oy] = [sideLow[0] - hi[0], sideLow[1] - hi[1]];
      const [x0, y0] = [hi[0] * GRID, hi[1] * GRID];
      const t0 = PARAPET_THICK;
      const lo = [ox > 0 ? x0 + GRID - t0 : x0, oy > 0 ? y0 + GRID - t0 : y0];
      const up = [ox ? lo[0] + t0 : x0 + GRID, oy ? lo[1] + t0 : y0 + GRID];
      brushes.push(box([lo[0], lo[1], z], [up[0], up[1], z + PARAPET_HEIGHT - 8], wall));
    }
  }
  // the bridges: the deck 16 thick under its top, centred on the rectangle, and a parapet along each side
  for (const b of t.bridges) {
    const [x0, y0, x1, y1] = [b.from[0] * GRID, b.from[1] * GRID, b.to[0] * GRID, b.to[1] * GRID];
    const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
    const half = b.width / 2;
    const [bx0, bx1] = b.axis === "x" ? [x0, x1] : [cx - half, cx + half];
    const [by0, by1] = b.axis === "y" ? [y0, y1] : [cy - half, cy + half];
    brushes.push(box([bx0, by0, b.z - 16], [bx1, by1, b.z], { top: floorTexture, sides: wall, bottom: wall }));
    if (b.parapets)
      if (b.axis === "x") brushes.push(box([bx0, by0, b.z], [bx1, by0 + PARAPET_THICK, b.z + PARAPET_HEIGHT], wall), box([bx0, by1 - PARAPET_THICK, b.z], [bx1, by1, b.z + PARAPET_HEIGHT], wall));
      else brushes.push(box([bx0, by0, b.z], [bx0 + PARAPET_THICK, by1, b.z + PARAPET_HEIGHT], wall), box([bx1 - PARAPET_THICK, by0, b.z], [bx1, by1, b.z + PARAPET_HEIGHT], wall));
  }
  void buildings;
  return { brushes, floor: F };
}
