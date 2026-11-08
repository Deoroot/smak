// levels/assembly, roofs: routes over a district's roofs, so that players can cross it above the street (the byzantium-02
// flow design, "The rooftop layer"). A building of the site with `roof: "walk"` (a shell, or a building with an interior,
// with or without a `tower`) is a roof a player may stand on: flat, fenced by CLIP rails (shell.mjs ROOF_RAIL). This module
// is what joins them to the ground and to each other. The site says, in `roofs`:
//
//   "roofs": {
//     "ways":  [ { "id": "L1", "kind": "ladder", "building": "b", "side": "south", "at": 3 },          // up (and down)
//                { "id": "S1", "kind": "stair",  "building": "c", "side": "north", "at": 4, "run": 1 }, // an outside stair
//                { "id": "C1", "kind": "crates", "building": "d", "side": "west",  "at": 1, "run": -1 },
//                { "id": "D1", "kind": "drop",   "building": "b", "side": "north", "at": 5 } ],           // down only
//     "links": [ { "id": "P1", "kind": "plank",  "from": "b", "to": "c", "at": 6, "width": 40 },
//                { "id": "J1", "kind": "jump",   "from": "c", "to": "d", "at": 5 },
//                { "id": "B1", "kind": "bridge", "from": "d", "to": "e", "at": 4, "span": 2 } ]
//   }
//
// `side` (south | north | west | east) is the wall of the building the way stands on, `at` the cell along that wall (0 is its
// least), `run` (1 or -1, the default 1) the way a stair or a crate climb runs from its top along the wall. A link goes from a
// roof to a roof that faces it across a gap of whole cells (nothing between), `at` the site's cell along the gap where it
// crosses (the same on both roofs), `span` how many cells wide the opening in the rail is (a plank 1, a jump 1 or 2, a bridge 2).
//
// What each is, and what holds it (the numbers are ROOF below; the sentences are checkRoofs'):
//   ladder    func_ladder on the wall (the library's ladder piece), from the street to the roof: any rise, both ways.
//   stair     an outside stair of risers 16 along the wall, a landing flush with the roof: both ways (guards in a chase may use it).
//   crates    a climb of crates of 32..48 high side by side along the wall, the roof one more step: both ways.
//   drop      the rail opened over a fall of at most 192 (a fall at 580 hurts; 192 is 554): down only.
//   plank     a plank 32..48 wide across the gap, 512 long at most, roofs within 16 in height; required from a gap of 160.
//   jump      the rails opened: a gap of 32..144 (a jump carries 200 running), the far roof at most 16 higher and at most 192
//             lower, a run-up of 128 on the roof it leaves.
//   bridge    a deck 128 wide (two cells) with a rail each side (clip and a visible rail), 512 long at most, roofs within 16.
// Where a link or way meets the rail of a roof, the rail (and its parapet) is open for the width of the link.
//
//   readRoofs(site)                 -> failures: the description's own fields, in words
//   planRoofs(plan)                 -> { roofs, ways, links, openings, ... }: the plan (geometry checked into `failures`)
//   checkRoofs(plan)                -> { failures, warnings, measures }: ways up, gaps, heights, reach, a way down for each roof
//   roofOpenings(plan)              -> Map building id -> { south, north, west, east: Set of cell indices } to be left open
//   roofBrushes(plan, library, o)   -> { brushes, entities, report }: ladders, stairs, crate climbs, planks, bridges
//   roofsContract(plan)             -> the RP contract's `roofs`: for players, never in the NPCs' walking graph
//   checkRoofsRp(contract)          -> { failures, warnings }: nothing of the roofs in the graph; no NPC uses a ladder, jump or plank
//   roofsPicture(plan)              -> PNG bytes: the roof level from above, heights tinted, the route drawn
import { box, brushEntity } from "../../src/maps/source.mjs";
import { png } from "../../src/image.mjs";
import { textMask } from "../../src/render.mjs";
import { pieceFor, placed } from "./library.mjs";
import { edgeFrame, swapped, apartEntities, APART_REACH_SKY } from "./assemble.mjs";
import { towerOf } from "./tower.mjs";

const GRID = 64;
const STOREY = 192;
const SIDES = ["south", "north", "west", "east"];
export const WAY_KINDS = ["ladder", "stair", "crates", "drop"];
export const LINK_KINDS = ["plank", "jump", "bridge"];
/** The ground a way may stand on (a cell of the street's, not a portico, a column, water, a ramp or a stair). */
const OPEN_GROUND = new Set(["street", "plaza", "square", "alley", "paving"]);

/** The rules, in units. */
export const ROOF = {
  /** How far a roof reaches past its footprint's edge line (the wall's half). */
  over: 8,
  /** A step up that is walked (the engine's 18, less a margin): a plank or a bridge joins roofs this close in height. */
  step: 16,
  /** The widest gap a jump crosses (a jump runs 200 and more; the hull's 16 each side is spent on the edges), and the gap from which a plank is required. */
  jumpMost: 144,
  plankFrom: 160,
  /** A jump up at all is a step; a fall this far is safe (at 800 gravity a fall of 192 is 554, hurt from 580). */
  fallMost: 192,
  /** The run a jump wants on the roof it leaves. */
  runUp: 128,
  plank: { least: 32, most: 48, usual: 40, longest: 512 },
  bridge: { span: 2, longest: 512, least: 64 },
  /** The risers and treads of an outside stair; a crate climb's step; the width of both (against the wall). */
  riser: 16,
  tread: 16,
  crate: { least: 32, most: 48, step: 40, deep: 48 },
  width: 56,
  /** The ladder's top over the roof (to step off by). */
  ladderOver: 16,
};

const isInt = (v) => Number.isInteger(v);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The description's own fields. */
export function readRoofs(site) {
  const out = [];
  const r = site.roofs;
  if (r === undefined) return out;
  if (typeof r !== "object" || r === null || Array.isArray(r)) return [`roofs wants { ways: [...], links: [...] }`];
  for (const k of Object.keys(r)) if (!["ways", "links"].includes(k)) out.push(`roofs has "${k}"; it wants ways and links`);
  const ids = new Set((site.buildings ?? []).map((b) => b.id));
  const named = new Set();
  const id = (o, what) => {
    if (typeof o?.id !== "string" || !o.id) return out.push(`a roofs ${what} has no id`), false;
    if (named.has(o.id)) out.push(`roofs: ${o.id} is named twice`);
    named.add(o.id);
    return true;
  };
  for (const w of r.ways ?? []) {
    if (!id(w, "way")) continue;
    if (!WAY_KINDS.includes(w.kind)) out.push(`way ${w.id}: its kind is ${JSON.stringify(w.kind)}; it wants ${WAY_KINDS.join(", ")}`);
    if (!ids.has(w.building)) out.push(`way ${w.id}: the building ${JSON.stringify(w.building)} is not in the site`);
    if (!SIDES.includes(w.side)) out.push(`way ${w.id}: side is ${JSON.stringify(w.side)}; it wants south, north, west or east`);
    if (!isInt(w.at) || w.at < 0) out.push(`way ${w.id}: at is ${JSON.stringify(w.at)}; it wants the cell along the wall, a whole number from 0`);
    if (w.run !== undefined && w.run !== 1 && w.run !== -1) out.push(`way ${w.id}: run is ${JSON.stringify(w.run)}; it wants 1 or -1`);
  }
  for (const l of r.links ?? []) {
    if (!id(l, "link")) continue;
    if (!LINK_KINDS.includes(l.kind)) out.push(`link ${l.id}: its kind is ${JSON.stringify(l.kind)}; it wants ${LINK_KINDS.join(", ")}`);
    for (const k of ["from", "to"]) if (!ids.has(l[k])) out.push(`link ${l.id}: ${k} is ${JSON.stringify(l[k])}, no building of the site`);
    if (l.from !== undefined && l.from === l.to) out.push(`link ${l.id}: it joins ${l.from} to itself`);
    if (!isInt(l.at)) out.push(`link ${l.id}: at is ${JSON.stringify(l.at)}; it wants the cell across the gap, a whole number of the site's cells`);
    if (l.span !== undefined && !(isInt(l.span) && l.span >= 1 && l.span <= 4)) out.push(`link ${l.id}: span is ${JSON.stringify(l.span)}; it wants 1 to 4 cells`);
    if (l.width !== undefined && !Number.isFinite(l.width)) out.push(`link ${l.id}: width is ${JSON.stringify(l.width)}; it wants units`);
  }
  return out;
}

// ── the roofs of the plan ──

/** The roof of each building of the plan: its cells, its top, the ground it stands on. */
function roofsOfPlan(plan) {
  const out = new Map();
  for (const b of plan.site.buildings) {
    const l = plan.layouts.get(b.id) ?? plan.shells?.get(b.id);
    const storeys = (l?.storeys ?? 2) + towerOf(b);
    out.set(b.id, {
      id: b.id,
      b,
      x0: b.at[0],
      y0: b.at[1],
      x1: b.at[0] + b.size[0],
      y1: b.at[1] + b.size[1],
      gz: b.groundZ ?? 0,
      top: storeys * STOREY + (b.groundZ ?? 0),
      walk: b.roof === "walk",
      shell: b.program === "shell",
    });
  }
  return out;
}

/** The line of a roof's side (units), the cell it begins at along it, its length in cells, the way out (+1 or -1) and which axis it runs along (0 x, 1 y). */
const sideOf = (R, side) => ({
  south: { line: R.y0 * GRID, from: R.x0, cells: R.x1 - R.x0, out: -1, axis: 0 },
  north: { line: R.y1 * GRID, from: R.x0, cells: R.x1 - R.x0, out: 1, axis: 0 },
  west: { line: R.x0 * GRID, from: R.y0, cells: R.y1 - R.y0, out: -1, axis: 1 },
  east: { line: R.x1 * GRID, from: R.y0, cells: R.y1 - R.y0, out: 1, axis: 1 },
})[side];

/** The cell outside a roof's side at index i. */
const outsideCell = (R, side, i) => ({ south: [R.x0 + i, R.y0 - 1], north: [R.x0 + i, R.y1], west: [R.x0 - 1, R.y0 + i], east: [R.x1, R.y0 + i] })[side];

/** A box in a way's own frame: u along the wall from the start of cell i, v out from the footprint's line, z. */
function frameBox(R, side, i, [u0, u1], [v0, v1], [z0, z1], texture) {
  const s = sideOf(R, side);
  const a = (s.from + i) * GRID;
  const along = [a + u0, a + u1];
  const out = s.out > 0 ? [s.line + v0, s.line + v1] : [s.line - v1, s.line - v0];
  const min = s.axis === 0 ? [along[0], out[0], z0] : [out[0], along[0], z0];
  const max = s.axis === 0 ? [along[1], out[1], z1] : [out[1], along[1], z1];
  return box(min, max, texture);
}

/** The cells (relative to i) a run of u covers. */
const cellsOf = (u0, u1) => {
  const out = [];
  for (let c = Math.floor(u0 / GRID); c < Math.ceil(u1 / GRID); c++) out.push(c);
  return out;
};

/** How many steps a stair of this rise has (risers of 16 at most), and the crate climb's (steps of 40 at most). */
export const stairSteps = (rise) => Math.max(1, Math.ceil(rise / ROOF.riser));
export const crateSteps = (rise) => Math.max(2, Math.ceil(rise / ROOF.crate.step));

/** The kinds of the wall's edge (side, cell i) on each of the building's real storeys: "exterior" plain, "window", "entrance". */
function wallKinds(plan, R, side, i) {
  const l = plan.shells?.get(R.id) ?? plan.layouts.get(R.id);
  const w = R.x1 - R.x0;
  const h = R.y1 - R.y0;
  return (l?.storeyPlans ?? []).map((sp) => {
    for (const e of sp.edges) {
      const horizontal = e.from[1] === e.to[1];
      const onSide = horizontal ? (e.from[1] === 0 ? "south" : e.from[1] === h ? "north" : null) : e.from[0] === 0 ? "west" : e.from[0] === w ? "east" : null;
      if (onSide === side && Math.min(e.from[horizontal ? 0 : 1], e.to[horizontal ? 0 : 1]) === i) return e.kind;
    }
    return null;
  });
}

/** Whether a street lamp stands on the wall at (side, i): site.mjs puts one on every third plain ground-floor edge that looks onto the street's floor (index 1, 4, 7 ...). */
function lampAt(plan, R, side, i) {
  const l = plan.shells?.get(R.id) ?? plan.layouts.get(R.id);
  const w = R.x1 - R.x0;
  const h = R.y1 - R.y0;
  const PLAIN = ["street", "plaza", "square", "alley", "paving"];
  const looksOut = (e) => {
    const horizontal = e.from[1] === e.to[1];
    const sd = horizontal ? (e.from[1] === 0 ? "south" : "north") : e.from[0] === 0 ? "west" : "east";
    const c = outsideCell(R, sd, Math.min(e.from[horizontal ? 0 : 1], e.to[horizontal ? 0 : 1]));
    return PLAIN.includes(plan.cells[c[1]]?.[c[0]]);
  };
  const edges = (l?.storeyPlans?.[0]?.edges ?? []).filter((e) => e.kind === "exterior" && looksOut(e));
  void w, void h;
  const at = edges.findIndex((e) => {
    const horizontal = e.from[1] === e.to[1];
    const sd = horizontal ? (e.from[1] === 0 ? "south" : "north") : e.from[0] === 0 ? "west" : "east";
    return sd === side && Math.min(e.from[horizontal ? 0 : 1], e.to[horizontal ? 0 : 1]) === i;
  });
  return at >= 0 && at % 3 === 1;
}

/** The ground at a cell (terrain's, else 0). */
const groundAt = (plan, x, y) => plan.terrain?.ground?.[y]?.[x] ?? 0;

/**
 * The plan of the site's roofs: each way and link with its numbers, the openings they leave in the rails, and the
 * failures of their geometry (checkRoofs says them). `plan` is planSite's, with its cells, layouts and terrain.
 */
export function planRoofs(plan) {
  const failures = [];
  const warnings = [];
  const spec = plan.site.roofs;
  const roofs = roofsOfPlan(plan);
  const [W, H] = plan.site.size;
  const out = { roofs, ways: [], links: [], openings: new Map(), failures, warnings, measures: {} };
  if (!spec) return out;
  const open = (id, side, i) => {
    if (!out.openings.has(id)) out.openings.set(id, { south: new Set(), north: new Set(), west: new Set(), east: new Set() });
    out.openings.get(id)[side].add(i);
  };
  const taken = new Map(); // "building side i" -> the way or link that opens it
  const claim = (name, id, side, i) => {
    const k = `${id} ${side} ${i}`;
    if (taken.has(k)) failures.push(`${name}: the ${side} wall of ${id} at ${i} is already given to ${taken.get(k)}; two ways cannot share a cell`);
    else taken.set(k, name);
  };
  const strips = new Set(); // ground cells a stair or a climb stands on
  for (const w of spec.ways ?? []) {
    const R = roofs.get(w.building);
    if (!R || !SIDES.includes(w.side) || !isInt(w.at) || !WAY_KINDS.includes(w.kind)) continue;
    const name = `way ${w.id}`;
    const s = sideOf(R, w.side);
    const run = w.run ?? 1;
    const way = { ...w, run, name, building: R.id, rise: null, steps: 0, foot: null, cells: [], ok: false };
    out.ways.push(way);
    const what = { ladder: "a ladder", stair: "an outside stair", crates: "a crate climb", drop: "a drop" }[w.kind];
    if (!R.walk) {
      failures.push(`${name}: ${what} on building ${R.id} lands nowhere; its roof is closed (give the building roof "walk")`);
      continue;
    }
    if (w.at >= s.cells) {
      failures.push(`${name}: at ${w.at} is past the ${w.side} wall of ${R.id}, which is ${plural(s.cells, "cell")} long`);
      continue;
    }
    const [ox, oy] = outsideCell(R, w.side, w.at);
    const label = ox >= 0 && oy >= 0 && ox < W && oy < H ? plan.cells[oy][ox] : null;
    if (!OPEN_GROUND.has(label)) {
      failures.push(`${name}: ${what} on the ${w.side} wall of ${R.id} comes down onto ${label ?? "the edge of the site"} at ${ox},${oy}; the cell outside wants open street, plaza, alley or paving`);
      continue;
    }
    if (w.kind !== "drop") {
      const kinds = wallKinds(plan, R, w.side, w.at);
      const bad = kinds.findIndex((k) => k !== null && k !== "exterior");
      if (bad >= 0) {
        failures.push(`${name}: ${what} stands over ${kinds[bad] === "entrance" ? "the entrance" : "a window"} of building ${R.id} (${w.side} wall, cell ${w.at}, storey ${bad}); give it a stretch of plain wall`);
        continue;
      }
      if (lampAt(plan, R, w.side, w.at)) {
        failures.push(`${name}: ${what} stands where a street lamp hangs on building ${R.id} (${w.side} wall, cell ${w.at}); give it the next cell`);
        continue;
      }
    }
    const gz = groundAt(plan, ox, oy);
    const rise = R.top - gz;
    Object.assign(way, { rise, foot: gz, ok: true });
    claim(name, R.id, w.side, w.at);
    open(R.id, w.side, w.at);
    if (rise <= 0) {
      failures.push(`${name}: the roof of ${R.id} is ${rise} over the ground outside; there is nothing to climb`);
      way.ok = false;
      continue;
    }
    if (w.kind === "drop") {
      if (rise > ROOF.fallMost) (failures.push(`${name}: a drop of ${rise} from the roof of ${R.id}; a fall over ${ROOF.fallMost} hurts (use a ladder, a stair or crates)`), (way.ok = false));
      continue;
    }
    if (w.kind === "ladder") continue;
    // a stair or a climb: a strip of cells along the wall, level, open, and its own
    const steps = w.kind === "stair" ? stairSteps(rise) : crateSteps(rise);
    way.steps = steps;
    let u0;
    let u1;
    if (w.kind === "stair") [u0, u1] = run > 0 ? [0, GRID + (steps - 1) * ROOF.tread] : [-(steps - 1) * ROOF.tread, GRID];
    else {
      const n = (steps - 1) * ROOF.crate.deep;
      [u0, u1] = run > 0 ? [0, Math.max(GRID, n)] : [Math.min(0, GRID - n), GRID];
      const step = rise / steps;
      if (step < ROOF.crate.least) {
        failures.push(`${name}: the roof of ${R.id} is ${rise} over the ground; crates of ${ROOF.crate.least} to ${ROOF.crate.most} cannot make a climb of that (it wants at least ${ROOF.crate.least * 2}); use a jump or a stair`);
        way.ok = false;
        continue;
      }
    }
    way.cells = cellsOf(u0, u1).map((c) => c + w.at);
    way.u = [u0, u1];
    // a step within a jump of a closed roof (which has no rail) at the height of that roof is a way onto it
    {
      const along0 = (s.from + w.at) * GRID;
      const tops = w.kind === "stair" ? [[0, GRID, R.top], ...Array.from({ length: steps - 1 }, (_, j) => (run > 0 ? [GRID + j * ROOF.tread, GRID + (j + 1) * ROOF.tread] : [-(j + 1) * ROOF.tread, -j * ROOF.tread]).concat(R.top - (j + 1) * (rise / steps)))] : Array.from({ length: steps - 1 }, (_, j) => (run > 0 ? [j * ROOF.crate.deep, (j + 1) * ROOF.crate.deep] : [GRID - (j + 1) * ROOF.crate.deep, GRID - j * ROOF.crate.deep]).concat(R.top - (j + 1) * (rise / steps))); // prettier-ignore
      const near = (lo, hi, a, b) => Math.max(0, lo - b, a - hi); // the distance between two ranges
      for (const Q of roofs.values()) {
        if (Q.walk || Q === R) continue;
        const [qa0, qa1, qo0, qo1] = s.axis === 0 ? [Q.x0 * GRID - ROOF.over, Q.x1 * GRID + ROOF.over, Q.y0 * GRID - ROOF.over, Q.y1 * GRID + ROOF.over] : [Q.y0 * GRID - ROOF.over, Q.y1 * GRID + ROOF.over, Q.x0 * GRID - ROOF.over, Q.x1 * GRID + ROOF.over];
        const [vlo, vhi] = s.out > 0 ? [s.line + ROOF.over, s.line + ROOF.over + ROOF.width] : [s.line - ROOF.over - ROOF.width, s.line - ROOF.over];
        for (const [a, b, z] of tops) {
          if (Q.top - z > 45) continue;
          const gap = Math.hypot(near(qa0, qa1, along0 + a, along0 + b), near(qo0, qo1, vlo, vhi));
          if (gap <= ROOF.jumpMost) {
            failures.push(`${name}: ${what} of ${R.id} has a step at ${z} only ${Math.round(gap)} from the closed roof of ${Q.id} (at ${Q.top}); a player jumps from it onto that roof (walk its roof so that its rail stops him, or put the way elsewhere)`);
            way.ok = false;
            break;
          }
        }
        if (!way.ok) break;
      }
      if (!way.ok) continue;
    }
    for (const c of way.cells) {
      const [cx, cy] = s.axis === 0 ? [R.x0 + c, w.side === "south" ? R.y0 - 1 : R.y1] : [w.side === "west" ? R.x0 - 1 : R.x1, R.y0 + c];
      const lab = cx >= 0 && cy >= 0 && cx < W && cy < H ? plan.cells[cy][cx] : null;
      if (!OPEN_GROUND.has(lab)) {
        failures.push(`${name}: ${what} along the ${w.side} wall of ${R.id} runs onto ${lab ?? "the edge of the site"} at ${cx},${cy}; its strip of ${plural(way.cells.length, "cell")} wants open street, plaza, alley or paving`);
        way.ok = false;
        break;
      }
      if (groundAt(plan, cx, cy) !== gz) {
        failures.push(`${name}: ${what} along the ${w.side} wall of ${R.id} stands on ground at ${groundAt(plan, cx, cy)} and ${gz}; it wants level ground`);
        way.ok = false;
        break;
      }
      if (strips.has(`${cx},${cy}`) && c !== w.at) failures.push(`${name}: its strip crosses the cell ${cx},${cy} another way stands on`);
      strips.add(`${cx},${cy}`);
    }
  }
  for (const l of spec.links ?? []) {
    const A = roofs.get(l.from);
    const B = roofs.get(l.to);
    if (!A || !B || !LINK_KINDS.includes(l.kind) || !isInt(l.at) || A === B) continue;
    const name = `link ${l.id}`;
    const span = l.span ?? (l.kind === "bridge" ? ROOF.bridge.span : 1);
    const link = { ...l, name, from: A.id, to: B.id, span, ok: false, gap: null, d: null, width: null };
    out.links.push(link);
    for (const R of [A, B])
      if (!R.walk) failures.push(`${name}: it lands on a closed roof; the roof of ${R.id} is not walked (give the building roof "walk")`);
    if (!A.walk || !B.walk) continue;
    // which walls face: A west of B, east of B, south, north
    let sa;
    let sb;
    let gapCells;
    let lane;
    let along;
    if (A.x1 <= B.x0 && Math.max(A.y0, B.y0) < Math.min(A.y1, B.y1)) [sa, sb, gapCells, lane, along] = ["east", "west", B.x0 - A.x1, [Math.max(A.y0, B.y0), Math.min(A.y1, B.y1)], 0];
    else if (B.x1 <= A.x0 && Math.max(A.y0, B.y0) < Math.min(A.y1, B.y1)) [sa, sb, gapCells, lane, along] = ["west", "east", A.x0 - B.x1, [Math.max(A.y0, B.y0), Math.min(A.y1, B.y1)], 0];
    else if (A.y1 <= B.y0 && Math.max(A.x0, B.x0) < Math.min(A.x1, B.x1)) [sa, sb, gapCells, lane, along] = ["north", "south", B.y0 - A.y1, [Math.max(A.x0, B.x0), Math.min(A.x1, B.x1)], 1];
    else if (B.y1 <= A.y0 && Math.max(A.x0, B.x0) < Math.min(A.x1, B.x1)) [sa, sb, gapCells, lane, along] = ["south", "north", A.y0 - B.y1, [Math.max(A.x0, B.x0), Math.min(A.x1, B.x1)], 1];
    else {
      failures.push(`${name}: the roofs of ${A.id} and ${B.id} do not face each other (no wall of one lies across from a wall of the other); a link joins neighbours`);
      continue;
    }
    if (gapCells === 0) {
      failures.push(`${name}: the buildings ${A.id} and ${B.id} touch; there is no gap to cross (their roofs meet: a step of ${Math.abs(B.top - A.top)} between them)`);
      continue;
    }
    const gap = gapCells * GRID - 2 * ROOF.over;
    const d = B.top - A.top; // the far roof over the near
    Object.assign(link, { gap, d, sa, sb, along, lane });
    // the opening must lie across both roofs
    if (l.at < lane[0] || l.at + span > lane[1]) {
      failures.push(`${name}: the cells ${l.at}${span > 1 ? ` to ${l.at + span - 1}` : ""} are not across both ${A.id} and ${B.id}; the roofs face each other along ${lane[0]} to ${lane[1] - 1}`);
      continue;
    }
    // nothing in the gap
    const gaps = [];
    for (let g = 0; g < gapCells; g++) for (let c = l.at; c < l.at + span; c++) gaps.push(along === 0 ? [(sa === "east" ? A.x1 : B.x1) + g, c] : [c, (sa === "north" ? A.y1 : B.y1) + g]);
    let blocked = null;
    for (const [x, y] of gaps) {
      const inB = [...roofs.values()].find((q) => x >= q.x0 && x < q.x1 && y >= q.y0 && y < q.y1);
      const lab = x >= 0 && y >= 0 && x < W && y < H ? plan.cells[y][x] : "edge";
      if (inB) (blocked = `the building ${inB.id} stands in the gap at ${x},${y}`);
      else if (lab === "landmark") blocked = `the column stands in the gap at ${x},${y}`;
      if (blocked) break;
    }
    if (blocked) {
      failures.push(`${name}: ${blocked}; a link crosses open air`);
      continue;
    }
    let bad = false;
    const fail = (s) => (failures.push(`${name}: ${s}`), (bad = true));
    const up = d > 0 ? `${B.id} is ${d} higher than ${A.id}` : d < 0 ? `${B.id} is ${-d} lower than ${A.id}` : "the roofs are level";
    if (l.kind === "plank") {
      const width = l.width ?? ROOF.plank.usual;
      link.width = width;
      if (width < ROOF.plank.least || width > ROOF.plank.most) fail(`a plank ${width} wide; a plank is ${ROOF.plank.least} to ${ROOF.plank.most} (narrower is no walk, wider is a bridge)`);
      if (gap > ROOF.plank.longest) fail(`a plank over ${gap} of air; no plank is over ${ROOF.plank.longest} long (use a bridge or a nearer roof)`);
      if (Math.abs(d) > ROOF.step) fail(`${up}: a plank is flat and a step is ${ROOF.step}; join roofs that differ by more with a ladder, a stair or a jump down`);
      if (span !== 1) fail(`a plank is one cell wide in the rail, not ${span}`);
    } else if (l.kind === "jump") {
      link.width = span * GRID;
      if (gap > ROOF.jumpMost) fail(`a gap of ${gap} is too wide for a jump (${ROOF.jumpMost} at most); every gap from ${ROOF.plankFrom} wants a plank or a bridge`);
      if (d > ROOF.step) fail(`${up}: a jump goes up ${ROOF.step} at most (a jump is 45 and the rail is 64); a ladder or stair joins it`);
      if (-d > ROOF.fallMost) fail(`${up}: a fall of ${-d} hurts (${ROOF.fallMost} at most); a ladder or a drop to a lower roof joins it`);
      const depth = along === 0 ? A.x1 - A.x0 : A.y1 - A.y0;
      if (depth * GRID < ROOF.runUp) fail(`the roof of ${A.id} is ${depth * GRID} deep, short of the run-up of ${ROOF.runUp} a jump wants`);
    } else {
      link.width = span * GRID;
      if (span < ROOF.bridge.span) fail(`a bridge is ${ROOF.bridge.span} cells wide (a deck of ${ROOF.bridge.span * GRID}) with a rail on each side, not ${span}`);
      if (gap < ROOF.bridge.least) fail(`a bridge over ${gap} of air; it wants a gap of ${ROOF.bridge.least} or more (a jump or a plank for less)`);
      if (gap > ROOF.bridge.longest) fail(`a bridge over ${gap} of air; no bridge is over ${ROOF.bridge.longest} long`);
      if (Math.abs(d) > ROOF.step) fail(`${up}: a bridge is flat; join roofs that differ by more than ${ROOF.step} with a ladder or a stair`);
    }
    for (let c = l.at; c < l.at + span; c++) {
      claim(name, A.id, sa, c - (sideOf(A, sa).from));
      claim(name, B.id, sb, c - (sideOf(B, sb).from));
    }
    if (bad) continue;
    link.ok = true;
    for (let c = l.at; c < l.at + span; c++) {
      open(A.id, sa, c - sideOf(A, sa).from);
      open(B.id, sb, c - sideOf(B, sb).from);
    }
  }
  return out;
}

/** Which roofs a player reaches from the street and which of them lead back to it: `{ up: Set, down: Set }` (the street is "ground"). */
function reachOfRoofs(roofPlan) {
  const edges = []; // [from, to]
  for (const w of roofPlan.ways) {
    if (!w.ok) continue;
    edges.push([w.building, "ground"]); // (every way is a way down, a drop only that)
    if (w.kind !== "drop") edges.push(["ground", w.building]);
  }
  for (const l of roofPlan.links) {
    if (!l.ok) continue;
    const d = roofPlan.roofs.get(l.to).top - roofPlan.roofs.get(l.from).top;
    // a plank and a bridge go both ways (they join roofs within a step); a jump goes up a step at most, down as far as a fall allows
    if (d <= ROOF.step) edges.push([l.from, l.to]);
    if (-d <= ROOF.step) edges.push([l.to, l.from]);
  }
  const reach = (start, flip) => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const n = queue.shift();
      for (const e of edges) {
        const [from, to] = flip ? [e[1], e[0]] : e;
        if (from === n && !seen.has(to)) (seen.add(to), queue.push(to));
      }
    }
    return seen;
  };
  return { up: reach("ground", false), down: reach("ground", true) };
}

/** The rules over the whole: the plan's failures, a roof nothing reaches, a roof reached and not left. */
export function checkRoofs(plan) {
  const roofPlan = plan.site.roofs ? (plan.roofs ?? planRoofs(plan)) : null;
  const failures = [];
  const warnings = [];
  if (!roofPlan) return { failures, warnings, measures: { walked: 0 } };
  failures.push(...roofPlan.failures);
  warnings.push(...roofPlan.warnings);
  const { up, down } = reachOfRoofs(roofPlan);
  const walked = [...roofPlan.roofs.values()].filter((r) => r.walk);
  for (const r of walked) {
    if (!up.has(r.id)) failures.push(`roof ${r.id}: it is walked and nothing reaches it; give it a ladder, a stair, crates or a link from a roof that has a way up (or set its roof to "closed")`);
    else if (!down.has(r.id)) failures.push(`roof ${r.id}: a player can get up onto it and no way takes him down; give it a drop, a ladder or a link back`);
  }
  const m = {
    walked: walked.length,
    ways: roofPlan.ways.length,
    links: roofPlan.links.length,
    reached: walked.filter((r) => up.has(r.id)).length,
    kinds: {},
  };
  for (const w of roofPlan.ways) m.kinds[w.kind] = (m.kinds[w.kind] ?? 0) + 1;
  for (const l of roofPlan.links) m.kinds[l.kind] = (m.kinds[l.kind] ?? 0) + 1;
  return { failures, warnings, measures: m };
}

/** The ground cells a way stands on ("x,y"): a stair's or a crate climb's strip, a ladder's and a drop's cell, with one more at each end; nobody idles or puts a prop on them. */
export function roofGround(plan) {
  const out = new Set();
  const roofPlan = plan.roofs ?? (plan.site.roofs ? planRoofs(plan) : null);
  for (const w of roofPlan?.ways ?? []) {
    if (!w.ok) continue;
    const R = roofPlan.roofs.get(w.building);
    const s = sideOf(R, w.side);
    const along = w.cells.length ? w.cells : [w.at];
    // (the strip, and a cell more at each end: where a player steps on and off)
    for (const c of [Math.min(...along) - 1, ...along, Math.max(...along) + 1]) out.add((s.axis === 0 ? [R.x0 + c, w.side === "south" ? R.y0 - 1 : R.y1] : [w.side === "west" ? R.x0 - 1 : R.x1, R.y0 + c]).join(","));
  }
  return out;
}

/** The cells left open in each building's rail and parapet: Map building id -> { south, north, west, east: Set of indices along the wall }. */
export const roofOpenings = (plan) => (plan.roofs ?? (plan.site.roofs ? planRoofs(plan) : null))?.openings ?? new Map();

// ── the brushes ──

/** A brush whose faces at its least and greatest z are moved to lo and hi (the ladder piece, stretched up its wall). */
function spanned(brush, lo, hi) {
  const flat = (f) => f.points.every((p) => Math.abs(p[2] - f.points[0][2]) < 1e-6);
  const at = brush.faces.filter(flat).map((f) => f.points[0][2]);
  const [min, max] = [Math.min(...at), Math.max(...at)];
  return {
    ...brush,
    faces: brush.faces.map((f) => {
      if (!flat(f)) return f;
      const to = Math.abs(f.points[0][2] - min) < 1e-6 ? lo : Math.abs(f.points[0][2] - max) < 1e-6 ? hi : null;
      return to === null ? f : { ...f, points: f.points.map((p) => p.map((v, i) => (i === 2 ? to : v))) };
    }),
  };
}

/** The textures a roof route wears, named as the Mese's palette has them (a district's swap turns them). */
export const LOOK = { step: "sinbrickwall", landing: "sinpalacefloor", crate: "xcrate10a", plank: "kit_wood3", plankEdge: "kit_wood4", deck: "sinwoodenfloor5", beam: "metal5", rail: "po_rustmetalblu" };
const CROWN_ENTITY = { zhlt_noclip: 1, zhlt_lightflags: 2 };

/**
 * The ways and links as brushes. `library` is the site's; `options.swapOf(district)` its texture swap. Ladders are the
 * library's ladder piece stretched from the street to the roof; stairs, crate climbs, planks and decks are boxes (world),
 * a bridge's rails clip (world) and a visible rail (a func_wall nobody collides with).
 */
export function roofBrushes(plan, library, { swapOf = () => null } = {}) {
  const roofPlan = plan.roofs ?? planRoofs(plan);
  const brushes = [];
  const entities = [];
  const failures = [];
  const counts = {};
  const count = (k, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
  const ladder = roofPlan.ways.some((w) => w.ok && w.kind === "ladder") ? pieceFor(library, "ladder", "rungs") : null;
  if (roofPlan.ways.some((w) => w.ok && w.kind === "ladder") && !ladder) failures.push("the library has no ladder piece (slot ladder, kind rungs); the roofs' ladders need one");
  const rungs = [];
  for (const w of roofPlan.ways) {
    if (!w.ok) continue;
    const R = roofPlan.roofs.get(w.building);
    const swap = swapOf(R.b.district);
    const t = (n) => swap?.[n] ?? n;
    const foot = w.foot;
    const top = R.top;
    const i = w.at;
    if (w.kind === "drop") {
      count("drop");
      continue;
    }
    if (w.kind === "ladder") {
      const e = { south: [[R.x0 + i, R.y0], [R.x0 + i + 1, R.y0], 0], north: [[R.x0 + i, R.y1], [R.x0 + i + 1, R.y1], 1], west: [[R.x0, R.y0 + i], [R.x0, R.y0 + i + 1], 0], east: [[R.x1, R.y0 + i], [R.x1, R.y0 + i + 1], 1] }[w.side]; // prettier-ignore
      const f = edgeFrame({ from: e[0], to: e[1] }, e[2]);
      const got = swapped(placed(ladder, { at: [f.at[0] * GRID, f.at[1] * GRID, foot], turn: f.turn }), swap);
      brushes.push(...got.brushes.map((b) => spanned(b, foot, top)));
      for (const ent of got.entities) {
        if (ent.classname === "func_ladder") entities.push({ ...ent, brushes: ent.brushes.map((b) => spanned(b, foot, top + ROOF.ladderOver)) });
        else rungs.push(...ent.brushes.map((b) => spanned(b, foot, top)));
      }
      count("ladder");
    } else if (w.kind === "stair") {
      const n = w.steps;
      const riser = (top - foot) / n;
      brushes.push(frameBox(R, w.side, i, [0, GRID], [ROOF.over, ROOF.over + ROOF.width], [foot, top], t(LOOK.landing)));
      for (let j = 1; j < n; j++) {
        const u = w.run > 0 ? [GRID + (j - 1) * ROOF.tread, GRID + j * ROOF.tread] : [-j * ROOF.tread, -(j - 1) * ROOF.tread];
        brushes.push(frameBox(R, w.side, i, u, [ROOF.over, ROOF.over + ROOF.width], [foot, Math.round(top - j * riser)], t(LOOK.step)));
      }
      count("stair-step", n);
    } else {
      const n = w.steps;
      const step = (top - foot) / n;
      for (let j = 1; j < n; j++) {
        const u = w.run > 0 ? [(j - 1) * ROOF.crate.deep, j * ROOF.crate.deep] : [GRID - j * ROOF.crate.deep, GRID - (j - 1) * ROOF.crate.deep];
        brushes.push(frameBox(R, w.side, i, u, [ROOF.over, ROOF.over + ROOF.width], [foot, Math.round(top - j * step)], t(LOOK.crate)));
      }
      count("crate", n - 1);
    }
  }
  if (rungs.length) entities.push(...apartEntities("func_wall", rungs, { rendermode: 4, renderamt: 255, zhlt_lightflags: 2 }, APART_REACH_SKY));
  for (const l of roofPlan.links) {
    if (!l.ok || l.kind === "jump") {
      if (l.ok) count("jump");
      continue;
    }
    const A = roofPlan.roofs.get(l.from);
    const B = roofPlan.roofs.get(l.to);
    const swap = swapOf(A.b.district);
    const t = (n) => swap?.[n] ?? n;
    const low = Math.min(A.top, B.top);
    // the span along the gap, edge to edge (a little into each roof so that nothing is left open), the lane across it
    const [a0, a1] = l.along === 0
      ? [l.sa === "east" ? A.x1 * GRID + ROOF.over : B.x1 * GRID + ROOF.over, l.sa === "east" ? B.x0 * GRID - ROOF.over : A.x0 * GRID - ROOF.over]
      : [l.sa === "north" ? A.y1 * GRID + ROOF.over : B.y1 * GRID + ROOF.over, l.sa === "north" ? B.y0 * GRID - ROOF.over : A.y0 * GRID - ROOF.over];
    const lane0 = l.at * GRID;
    const lane1 = (l.at + l.span) * GRID;
    const mk = (u0, u1, c0, c1, z0, z1, tex) => (l.along === 0 ? box([u0, c0, z0], [u1, c1, z1], tex) : box([c0, u0, z0], [c1, u1, z1], tex));
    if (l.kind === "plank") {
      const mid = (lane0 + lane1) / 2;
      brushes.push(mk(a0 - 2, a1 + 2, mid - l.width / 2, mid + l.width / 2, low - 8, low, { sides: t(LOOK.plankEdge), top: t(LOOK.plank), bottom: t(LOOK.plankEdge) }));
      count("plank");
    } else {
      brushes.push(mk(a0 - 2, a1 + 2, lane0, lane1, low - 16, low, { sides: t(LOOK.beam), top: t(LOOK.deck), bottom: t(LOOK.beam) }));
      // a rail each side: clip 64 high and a thin visible rail with posts
      const visible = [];
      for (const [c0, c1] of [[lane0, lane0 + 4], [lane1 - 4, lane1]]) {
        brushes.push(mk(a0, a1, c0, c1, low, low + 64, "CLIP"));
        visible.push(mk(a0, a1, c0, c1, low + 38, low + 44, t(LOOK.rail)));
        const posts = Math.max(1, Math.ceil((a1 - a0) / 64));
        for (let p = 0; p <= posts; p++) {
          const u = Math.min(a1 - 4, a0 + (p * (a1 - a0 - 4)) / posts);
          visible.push(mk(u, u + 4, c0, c1, low, low + 38, t(LOOK.rail)));
        }
      }
      entities.push(...apartEntities("func_wall", visible, CROWN_ENTITY, APART_REACH_SKY));
      count("bridge");
    }
  }
  return { brushes, entities, report: { failures, counts } };
}

// ── the RP layer ──

/** Who may use each kind, in a chase: a guard takes a stair, nobody of the NPCs a ladder, a jump, a plank, a bridge, crates or a drop. */
export const CHASE = { stair: "chase" };

/**
 * The roofs for the RP contract (`roofs`): where a player gets up and across. It is NOT in `paths` (the NPCs' graph holds
 * no node on a roof and no link to one): each way and link says `npc`, false, or "chase" for the stairs, which the guards
 * of a chase may take; the plugin keeps the rest to players.
 */
export function roofsContract(plan) {
  const roofPlan = plan.roofs ?? (plan.site.roofs ? planRoofs(plan) : null);
  if (!roofPlan) return null;
  const walked = [...roofPlan.roofs.values()].filter((r) => r.walk);
  return {
    roofs: walked.map((r) => ({ building: r.id, top: r.top, from: [r.x0 * GRID, r.y0 * GRID], to: [r.x1 * GRID, r.y1 * GRID] })),
    ways: roofPlan.ways.filter((w) => w.ok).map((w) => {
      const R = roofPlan.roofs.get(w.building);
      const s = sideOf(R, w.side);
      const mid = (s.from + w.at + 0.5) * GRID;
      const at = s.axis === 0 ? [mid, s.line + s.out * (ROOF.over + 32)] : [s.line + s.out * (ROOF.over + 32), mid];
      return { id: w.id, kind: w.kind, building: w.building, side: w.side, at: [...at, w.foot ?? 0], top: R.top, npc: CHASE[w.kind] ?? false };
    }),
    links: roofPlan.links.filter((l) => l.ok).map((l) => ({ id: l.id, kind: l.kind, from: l.from, to: l.to, gap: l.gap, rise: l.d, npc: false })),
  };
}

/** The rules of the roofs in the contract: none in the walking graph; no NPC use of a ladder, jump, plank, bridge, crates or drop. */
export function checkRoofsRp(contract) {
  const failures = [];
  const warnings = [];
  const r = contract.roofs;
  if (!r) return { failures, warnings };
  const onRoof = (b) => r.roofs.find((q) => q.building === b);
  for (const n of contract.paths?.nodes ?? []) {
    if (n.kind === "roof") failures.push(`the walking graph has a roof node (${n.id}); roofs are for players, not in the NPCs' graph`);
    else if (n.building && onRoof(n.building) && n.at?.[2] >= onRoof(n.building).top) failures.push(`the walking graph has a node (${n.id}) on the roof of ${n.building}; roofs are for players`);
  }
  for (const w of r.ways) if (w.npc && w.npc !== CHASE[w.kind]) failures.push(`roof way ${w.id}: a ${w.kind} is marked for NPCs (${JSON.stringify(w.npc)}); only a stair may be, and only in a chase`);
  for (const l of r.links) if (l.npc) failures.push(`roof link ${l.id}: a ${l.kind} is marked for NPCs; guards do not jump, cross planks or bridges of the roofs`);
  const ids = new Set([...r.ways, ...r.links].map((q) => q.id));
  for (const l of contract.paths?.links ?? []) if (l.how === "roof" || ids.has(l.way) || ids.has(l.via)) failures.push(`the walking graph has a link over a roof (${l.a} to ${l.b}); roofs are for players`);
  return { failures, warnings };
}

// ── the picture ──

const PALETTE = { ground: [226, 222, 212], street: [200, 198, 192], closed: [150, 146, 140], ink: [30, 30, 36] };
/** A tint for a roof of this height (low to high: pale to deep). */
const tintOf = (top, lo, hi) => {
  const t = hi === lo ? 0.5 : (top - lo) / (hi - lo);
  return [Math.round(240 - 150 * t), Math.round(214 - 40 * t), Math.round(120 + 60 * t)];
};

/** The roof level from above (north up): the street, the closed roofs grey, the walked roofs tinted by height with it written, the ways and links drawn. */
export function roofsPicture(plan, { cell = 28 } = {}) {
  const roofPlan = plan.roofs ?? planRoofs(plan);
  const [W, H] = plan.site.size;
  const pad = 24;
  const width = W * cell + pad * 2;
  const height = H * cell + pad * 2 + 34;
  const rgba = new Uint8Array(width * height * 4).fill(255);
  const dot = (x, y, c) => {
    x = Math.round(x), y = Math.round(y);
    if (x >= 0 && y >= 0 && x < width && y < height) rgba.set([c[0], c[1], c[2], 255], (y * width + x) * 4);
  };
  const rect = (x0, y0, x1, y1, c) => {
    for (let y = Math.round(Math.min(y0, y1)); y < Math.round(Math.max(y0, y1)); y++) for (let x = Math.round(Math.min(x0, x1)); x < Math.round(Math.max(x0, x1)); x++) dot(x, y, c);
  };
  const text = (s, x, y, k = 2, c = PALETTE.ink, centred = false) => {
    const m = textMask(s, k);
    const x0 = centred ? x - m.width / 2 : x;
    const y0 = centred ? y - m.height / 2 : y;
    for (let j = 0; j < m.height; j++) for (let i = 0; i < m.width; i++) if (m.at(i, j)) dot(x0 + i, y0 + j, c);
  };
  const px = (ux) => pad + (ux / GRID) * cell;
  const py = (uy) => pad + 20 + (H - uy / GRID) * cell;
  const line = (x0, y0, x1, y1, c, th = 2) => {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / (n || 1);
      const y = y0 + ((y1 - y0) * k) / (n || 1);
      rect(x - th / 2, y - th / 2, x + th / 2, y + th / 2, c);
    }
  };
  text(`${plan.site.name}: roofs, heights tinted, route drawn`, pad, 8, 2);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) rect(px(x * GRID), py((y + 1) * GRID), px((x + 1) * GRID), py(y * GRID), ["street", "plaza", "square", "alley", "paving"].includes(plan.cells[y][x]) ? PALETTE.street : PALETTE.ground);
  const walked = [...roofPlan.roofs.values()].filter((r) => r.walk);
  const lo = Math.min(...walked.map((r) => r.top), 0);
  const hi = Math.max(...walked.map((r) => r.top), 1);
  for (const R of roofPlan.roofs.values()) {
    const c = R.walk ? tintOf(R.top, lo, hi) : PALETTE.closed;
    rect(px(R.x0 * GRID), py(R.y1 * GRID), px(R.x1 * GRID), py(R.y0 * GRID), c);
    for (const [a, b, d, e] of [[R.x0, R.y1, R.x1, R.y1], [R.x0, R.y0, R.x1, R.y0], [R.x0, R.y0, R.x0, R.y1], [R.x1, R.y0, R.x1, R.y1]]) line(px(a * GRID), py(b * GRID), px(d * GRID), py(e * GRID), PALETTE.ink, 1);
    text(`${R.id} ${R.walk ? `+${R.top}` : "closed"}`, px(((R.x0 + R.x1) / 2) * GRID), py(((R.y0 + R.y1) / 2) * GRID), 2, PALETTE.ink, true);
  }
  const KIND = { ladder: [200, 30, 30], stair: [20, 120, 40], crates: [150, 90, 20], drop: [90, 30, 160], plank: [120, 70, 10], jump: [10, 90, 200], bridge: [10, 130, 130] };
  for (const w of roofPlan.ways) {
    if (!w.ok) continue;
    const R = roofPlan.roofs.get(w.building);
    const s = sideOf(R, w.side);
    const mid = (s.from + w.at + 0.5) * GRID;
    const [ux, uy] = s.axis === 0 ? [mid, s.line + s.out * 40] : [s.line + s.out * 40, mid];
    if (w.cells.length > 1) {
      const [u0, u1] = w.u;
      const [a, b] = s.axis === 0 ? [[(s.from + w.at) * GRID + u0, uy], [(s.from + w.at) * GRID + u1, uy]] : [[ux, (s.from + w.at) * GRID + u0], [ux, (s.from + w.at) * GRID + u1]];
      line(px(a[0]), py(a[1]), px(b[0]), py(b[1]), KIND[w.kind], 5);
    }
    rect(px(ux) - 6, py(uy) - 6, px(ux) + 6, py(uy) + 6, KIND[w.kind]);
    text(w.id, px(ux), py(uy) - 14, 2, KIND[w.kind], true);
  }
  for (const l of roofPlan.links) {
    if (!l.ok) continue;
    const A = roofPlan.roofs.get(l.from);
    const B = roofPlan.roofs.get(l.to);
    const mid = (l.at + l.span / 2) * GRID;
    const [a0, a1] = l.along === 0 ? [(l.sa === "east" ? A.x1 : B.x1) * GRID, (l.sa === "east" ? B.x0 : A.x0) * GRID] : [(l.sa === "north" ? A.y1 : B.y1) * GRID, (l.sa === "north" ? B.y0 : A.y0) * GRID];
    const p = l.along === 0 ? [[a0, mid], [a1, mid]] : [[mid, a0], [mid, a1]];
    line(px(p[0][0]), py(p[0][1]), px(p[1][0]), py(p[1][1]), KIND[l.kind], l.kind === "bridge" ? 8 : l.kind === "plank" ? 4 : 2);
    if (l.kind === "jump") for (let k = 0; k < 4; k++) rect(px(p[0][0] + ((p[1][0] - p[0][0]) * k) / 3) - 3, py(p[0][1] + ((p[1][1] - p[0][1]) * k) / 3) - 3, px(p[0][0] + ((p[1][0] - p[0][0]) * k) / 3) + 3, py(p[0][1] + ((p[1][1] - p[0][1]) * k) / 3) + 3, KIND.jump);
    text(`${l.id} ${l.gap}`, px((p[0][0] + p[1][0]) / 2), py((p[0][1] + p[1][1]) / 2) + 14, 2, KIND[l.kind], true);
  }
  const y = height - 22;
  let x = pad;
  for (const [k, c] of Object.entries(KIND)) {
    rect(x, y, x + 12, y + 12, c);
    text(k, x + 16, y + 1, 2);
    x += 16 + k.length * 12 + 14;
  }
  return png(width, height, rgba);
}
