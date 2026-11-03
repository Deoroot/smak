// levels/assembly, part A: the assembler. A layout (smak-layout/1, from layout.mjs) and a piece library (library.mjs)
// joined into one map: what `writeMap` takes, with the site it stands on, its lamps and the sky.
//
//   assemble(layout, library, options) -> { map, entities, report }
//     map        { worldspawn, brushes, entities }: writeMap's input
//     entities   the map's entities (the same list as map.entities)
//     report     { failures, warnings, counts: { pieces: { id: n }, kinds: { edgeKind: n }, brushes, entities },
//                  placements: [{ piece, slot, kind, storey, at, turn, edge | cell | vertex }], lamps: [...],
//                  site: { min, max, ground, top }, start: { at, yaw }, light: LIGHT_TABLE }
//
// How it places, in this order (the later brush's face wins where two are flush: README, "A piece"):
//   1. the site: a ring of ground round the footprint (its top flush with the ground storey's floor), walls and a
//      ceiling of sky round all of it: the map is sealed by the yard, not by the building;
//   2. the floors: a `floor` piece under every cell of every storey, but none in the stairwell on the storey it
//      climbs to (the stair piece carries its own upper landing); 2 to 5 storey by storey from the lowest, so that a
//      storey's floor is written after the posts below it, whose tops are flush with it;
//   3. the top storey's `ceiling-roof` over every cell;
//   4. the edges, each by its kind, turned so that the piece's +y (its inside) looks into the building (exterior,
//      window) or away from the void (a rail). A doorway (a door, or the entrance) is ONE piece over its two edges
//      (128), turned so that its +y looks into the room its leaf swings into (the layout's `swing`); no other piece
//      on either edge. No piece on an edge with the stairwell on both sides: the stair piece owns those. Under an
//      interior wall of an upper storey with no floor on one side (the stairwell's void) a filler of the slab's 16
//      closes the slot between the wall below and the wall above;
//   5. a corner at every grid vertex where walls meet (by the mask N 8 E 4 S 2 W 1), brick on its faces that look
//      out of the building; a newel where only rails meet; none at a doorway's middle vertex (`at`), which the
//      doorway's piece spans;
//   6. the stair piece at the stairwell, turned for its foot (south 0, east 90, north 180, west 270), its foot and
//      top connectors checked to land on the layout's `bottom` and `top` cells;
//   7. the lamps by the light table (LIGHT_TABLE), the sun and the sky's light, the texture lights, the start.
// Every piece stands on its storey's floor: z = base + storey * storeyHeight. No height is computed another way.
//
// THE WALK MAP. `assemble(layout, library, { open: true })` is the same map with every doorway piece placed open
// (`placed(..., { open: true })`): its leaf a world brush where it stands swung open, no door entity. The walk tests
// run on that map, so that a passage is measured as the game will have it with the door open (a leaf REMOVED
// passes a doorway the open leaf blocks: house-01, 2026-11-02). `report.doorways` says where each doorway is and
// where its open leaf stands; `walkMapProblems` checks a walk map has every leaf as a world brush, and
// `doorwayClearance` traces a standing player (hull 1) through each doorway of the compiled walk map.
import { box, pointEntity, playerStart, textureLights, shapeOf } from "../../src/maps/source.mjs";
import { contentsAt, CONTENTS } from "../../src/maps/bsp.mjs";
import { pieceFor, placed, connectorsOf, footprintOf, doorwayOf } from "./library.mjs";
import { checkLayout, cellsAcross, edgeKey } from "./layout.mjs";

/**
 * The lamps of a room by its kind: one ceiling lamp for each `perLamp` cells of floor (at least one), and with
 * `sconces` a wall lamp beside each of the room's doorways (and the entrance). `default` for a kind not named.
 */
export const LIGHT_TABLE = {
  hall: { perLamp: 8, sconces: true },
  corridor: { perLamp: 6, sconces: true },
  kitchen: { perLamp: 10 },
  living: { perLamp: 12 },
  bedroom: { perLamp: 12 },
  bathroom: { perLamp: 8 },
  default: { perLamp: 12 },
};
/** Room kinds a door does not swing into when the other side is a room. */
export const PASSAGES = new Set(["hall", "corridor", "landing", "stair"]);
/** The yard round the building, in cells; the sky's height over the roof. */
export const YARD = 3;
export const SKY_OVER = 128;
/** The site's textures (halflife.wad). */
export const SITE = { ground: "OUT_GRND1", under: "OUT_DIRT1", sky: "SKY" };
/** The sun and the sky (VHLT's light_environment: `_diffuse_light` the sky's own light in the shade). */
export const SUN = { color: [255, 238, 205], brightness: 160, diffuse: [150, 175, 215, 50], yaw: 225, pitch: -55 };
/**
 * The texture lights as the compile is given them: the library's (pieces/hl's lights.rad) times this. With the
 * library's own (2200 a ceiling panel, and 220 the lamp's light entity) and 8 bounces every room's floor stood at
 * hlrad's clip (about 177 of 255 stored: white); at half of both, house-01's rooms come to 75 to 100, the yard 126.
 */
export const TEXLIGHT_SCALE = 0.5;
/** The lamp pieces' own light entities (220 a ceiling lamp, 60 a sconce) times this. */
export const LAMP_SCALE = 0.5;
/** The texture lights as the text of a lights.rad. */
export const radText = (texlights) =>
  ["// the pieces' texture lights as the assembler compiles them (assemble.mjs, TEXLIGHT_SCALE)", ...Object.entries(texlights).map(([name, v]) => `${name} ${v.join(" ")}`), ""].join("\n"); // prettier-ignore
/** The worldspawn's wad, as Hammer writes a Half-Life path; the engine reads the file's name from it. */
export const WAD_KEY = "\\half-life\\valve\\halflife.wad";

const WAYS = { north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0] };
const FOOT_TURN = { south: 0, east: 90, north: 180, west: 270 };
const isRoom = (v) => typeof v === "string" && v !== "stair" && v !== "void";
const horizontal = (e) => e.from[1] === e.to[1];
const count = (table, key, n = 1) => (table[key] = (table[key] ?? 0) + n);
/** Brush entities a player walks through (their brushes block nothing). */
const NOT_SOLID = new Set(["func_illusionary", "func_ladder", "func_water", "func_monsterclip"]);
/** An edge's key with its lesser vertex first, whichever way it was written. */
const keyOf = (e) => {
  const [a, b] = e.from[0] < e.to[0] || (e.from[0] === e.to[0] && e.from[1] < e.to[1]) ? [e.from, e.to] : [e.to, e.from];
  return edgeKey({ from: a, to: b });
};
const turnXY = ([x, y], t) => {
  const q = ((t % 360) + 360) % 360;
  return q === 0 ? [x, y] : q === 90 ? [-y, x] : q === 180 ? [-x, -y] : [y, -x];
};

/**
 * Where an edge piece goes so that its +y looks to one side of the edge: `side` 0 (south, or west) or 1 (north, or
 * east). The edge runs from its lesser vertex to its greater, one cell long (or `cells` long: a doorway's two
 * edges, from the first's lesser vertex). Returns `{ at: [i, j], turn }` in cells.
 */
export function edgeFrame(edge, side, cells = 1) {
  const [x0, y0] = [Math.min(edge.from[0], edge.to[0]), Math.min(edge.from[1], edge.to[1])];
  if (horizontal(edge)) return side === 1 ? { at: [x0, y0], turn: 0 } : { at: [x0 + cells, y0], turn: 180 };
  return side === 0 ? { at: [x0, y0], turn: 90 } : { at: [x0, y0 + cells], turn: 270 };
}

/** A layout's doorways: its doors and its entrance, each `{ what, name, rooms, storey, edges, at, swing, kind }`. */
export function doorwaysOf(layout) {
  const list = (layout.doors ?? []).map((d) => ({ ...d, kind: "door", what: `door ${d.rooms.join("-")}` }));
  const en = layout.entrance;
  if (en) list.push({ ...en, rooms: [en.room, null], storey: en.storey ?? 0, kind: "entrance", what: `entrance of ${en.room}` }); // prettier-ignore
  for (const d of list) d.name = `${d.what} (storey ${d.storey}, at ${(d.at ?? []).join(" ")})`;
  return list;
}

/**
 * Assembles a layout from a library's pieces. `options`:
 *   yard        cells of ground round the building (YARD)
 *   skyOver     the sky's height over the roof (SKY_OVER)
 *   light       the light table (LIGHT_TABLE)
 *   wad         the worldspawn's wad key (WAD_KEY)
 *   sky         the worldspawn's skyname ("desert")
 *   sun         as SUN
 *   lampScale   the lamp pieces' light entities times this (LAMP_SCALE)
 *   texlights   true (the default): an info_texlights with the library's texture lights times `texlightScale`
 *               (TEXLIGHT_SCALE), the same as `report.texlights` (write them with radText for hlrad's -lights),
 *               so that the .map alone lights as it should
 *   open        true: every doorway piece placed open, its leaf a world brush where it stands swung open (the walk
 *               map: README, "Every passage is measured as the game will have it")
 */
export function assemble(layout, library, options = {}) {
  const failures = [];
  const warnings = [];
  const yard = options.yard ?? YARD;
  const table = options.light ?? LIGHT_TABLE;
  const lampScale = options.lampScale ?? LAMP_SCALE;
  const sun = { ...SUN, ...(options.sun ?? {}) };
  const g = layout.grid ?? 64;
  const H = layout.storeyHeight ?? 192;
  const base = layout.base ?? [0, 0, 0];
  const [W, D] = layout.size;
  const plans = layout.storeyPlans ?? [];
  const well = layout.stairwell ?? null;
  const floorOf = (s) => base[2] + s * H;
  const world = (i, j, s) => [base[0] + i * g, base[1] + j * g, floorOf(s)];
  const cellOf = (s, i, j) => (i >= 0 && j >= 0 && i < W && j < D ? (plans[s]?.cells[j]?.[i] ?? null) : null);
  const wellSet = new Set((well?.cells ?? []).map(([i, j]) => `${i},${j}`));
  const inWell = (i, j) => wellSet.has(`${i},${j}`);
  const kindOf = new Map((layout.rooms ?? []).map((r) => [r.id, r.kind]));
  const sizeOf = new Map((layout.rooms ?? []).map((r) => [r.id, r.cells]));

  // ── the layout, as the assembler needs it ──
  if (layout.format !== "smak-layout/1") failures.push(`the layout's format is ${layout.format}; the assembler reads smak-layout/1`); // prettier-ignore
  for (const f of layout.failures ?? []) failures.push(`the layout failed: ${f}`);
  for (const f of checkLayout(layout).failures) if (!failures.includes(`the layout: ${f}`)) failures.push(`the layout: ${f}`); // prettier-ignore
  for (const p of plans)
    for (const e of p.edges) {
      const sides = cellsAcross(e).map(([i, j]) => cellOf(p.storey, i, j));
      const where = `${e.from.join(",")} to ${e.to.join(",")} on storey ${p.storey}`;
      if (Math.abs(e.from[0] - e.to[0]) + Math.abs(e.from[1] - e.to[1]) !== 1) failures.push(`the edge ${where} is not one cell long; an edge piece covers 1`); // prettier-ignore
      else if ((e.kind === "door") && !(isRoom(sides[0]) && isRoom(sides[1]) && sides[0] !== sides[1]))
        failures.push(`the door edge ${where} has ${sides.map(String).join(" and ")} on its sides; a door stands on the wall two rooms share, with a room on each of its 2 sides`); // prettier-ignore
      else if ((e.kind === "door") && !(e.rooms?.includes(sides[0]) && e.rooms?.includes(sides[1])))
        failures.push(`the door edge ${where} names ${(e.rooms ?? []).map(String).join(" and ")}, and has ${sides.map(String).join(" and ")} on its sides; it wants the 2 rooms it joins`); // prettier-ignore
      else if (["exterior", "window", "entrance"].includes(e.kind) && sides.filter((v) => v === null).length !== 1)
        failures.push(`the ${e.kind} edge ${where} has ${sides.map(String).join(" and ")} on its sides; it wants the outside on 1 of them`); // prettier-ignore
    }

  const brushes = [];
  const entities = [];
  const placements = [];
  const pieces = {};
  const kinds = {};
  const owners = []; // [{ label, brushes }]: what each placement put in the map, to name what blocks a passage
  const open = Boolean(options.open);
  const put = (piece, info, { at, turn = 0, outside } = {}) => {
    const got = placed(piece, { at, turn, outside, open: open && Boolean(piece.open) });
    const where = info.doorway ? ` at ${info.doorway.join(" ")}` : info.edge ? ` on ${edgeKey(info.edge)}` : info.vertex ? ` at ${info.vertex.join(" ")}` : info.cell ? ` in ${info.cell.join(" ")}` : ""; // prettier-ignore
    owners.push({ label: `${piece.id} (storey ${info.storey}${where})`, brushes: [...got.brushes, ...got.entities.flatMap((e) => (NOT_SOLID.has(e.classname) ? [] : e.brushes ?? []))] }); // prettier-ignore
    // a lamp's own light entity, dimmed by the table's scale (its keys are the piece's, the brightness its fourth)
    if (piece.slot === "lamp")
      for (const e of got.entities)
        if (e.classname === "light" && typeof e._light === "string") {
          const v = e._light.trim().split(/\s+/).map(Number);
          if (v.length === 4) e._light = [v[0], v[1], v[2], Math.round(v[3] * lampScale)].join(" ");
        }
    brushes.push(...got.brushes);
    entities.push(...got.entities);
    placements.push({ piece: piece.id, slot: piece.slot, ...info, at, turn, brushes: got.brushes.length + got.entities.reduce((n, e) => n + (e.brushes?.length ?? 0), 0) }); // prettier-ignore
    count(pieces, piece.id);
    return got;
  };
  const need = (slot, which) => {
    const p = pieceFor(library, slot, which);
    if (!p) failures.push(`the library has no ${slot} piece for ${JSON.stringify(which)}; the layout needs one`);
    return p;
  };

  // ── 1. the site ──
  const fx0 = base[0];
  const fy0 = base[1];
  const fx1 = base[0] + W * g;
  const fy1 = base[1] + D * g;
  const m = yard * g;
  const [sx0, sy0, sx1, sy1] = [fx0 - m, fy0 - m, fx1 + m, fy1 + m];
  const z0 = base[2];
  const top = floorOf(plans.length) + (options.skyOver ?? SKY_OVER);
  const ground = { top: SITE.ground, bottom: SITE.under, sides: SITE.under };
  brushes.push(
    box([sx0, sy0, z0 - 16], [sx1, fy0, z0], ground),
    box([sx0, fy1, z0 - 16], [sx1, sy1, z0], ground),
    box([sx0, fy0, z0 - 16], [fx0, fy1, z0], ground),
    box([fx1, fy0, z0 - 16], [sx1, fy1, z0], ground),
  );
  // a footprint cell outside the building is ground too, so the ground seals under everything
  for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) if (cellOf(0, i, j) === null) brushes.push(box(world(i, j, 0).map((v, k) => (k === 2 ? z0 - 16 : v)), [base[0] + (i + 1) * g, base[1] + (j + 1) * g, z0], ground)); // prettier-ignore
  brushes.push(
    box([sx0 - 16, sy0 - 16, z0 - 32], [sx1 + 16, sy1 + 16, z0 - 16], SITE.sky),
    box([sx0 - 16, sy0 - 16, top], [sx1 + 16, sy1 + 16, top + 16], SITE.sky),
    box([sx0 - 16, sy0 - 16, z0 - 16], [sx0, sy1 + 16, top], SITE.sky),
    box([sx1, sy0 - 16, z0 - 16], [sx1 + 16, sy1 + 16, top], SITE.sky),
    box([sx0, sy0 - 16, z0 - 16], [sx1, sy0, top], SITE.sky),
    box([sx0, sy1, z0 - 16], [sx1, sy1 + 16, top], SITE.sky),
  );
  count(kinds, "site", 10);

  // ── 2. to 5., storey by storey from the lowest: its floors, the roof over the top one, its edges, its corners.
  // A storey's floors are written after the storey under it: the corner posts below stand to its floor's top, and
  // the floor's face wins there (else each post's top shows as a square of wall in the floor)
  const floor = need("floor", "floor");
  const roof = need("ceiling", "roof");
  const hasFloor = (s, i, j) => cellOf(s, i, j) !== null && !(well && s === well.to && inWell(i, j));
  const last = plans.length - 1;
  const floorsOf = (p) => {
    if (floor)
      for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) if (hasFloor(p.storey, i, j)) put(floor, { kind: "floor", storey: p.storey, cell: [i, j] }, { at: world(i, j, p.storey) }); // prettier-ignore
    if (roof && p.storey === last)
      for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) if (cellOf(last, i, j) !== null) put(roof, { kind: "roof", storey: last, cell: [i, j] }, { at: world(i, j, last) }); // prettier-ignore
  };

  // the edges
  const standing = plans.map(() => new Map()); // edgeKey -> kind, of the edges given a piece
  const sideOf = (e, s) => {
    const sides = cellsAcross(e).map(([i, j]) => cellOf(s, i, j));
    if (["exterior", "window", "entrance"].includes(e.kind)) return sides[1] === null ? 0 : 1;
    if (e.kind === "rail") return sides[1] === "void" ? 0 : 1;
    if (e.kind === "door") {
      const passage = sides.map((r) => PASSAGES.has(kindOf.get(r)));
      if (passage[0] !== passage[1]) return passage[0] ? 1 : 0;
      const [a, b] = sides.map((r) => sizeOf.get(r) ?? 0);
      return a < b ? 0 : 1;
    }
    return 1;
  };
  // the doorways: each edge of one (by its key, on its storey) to the doorway, and where each was placed
  const doorways = doorwaysOf(layout);
  const doorwayAt = new Map(); // `${storey}:${key}` -> doorway
  for (const d of doorways) for (const e of d.edges ?? []) doorwayAt.set(`${d.storey}:${keyOf(e)}`, d);
  const middles = new Set(doorways.map((d) => `${d.storey}:${(d.at ?? []).join(",")}`));
  const doorwaysPlaced = [];
  const placeDoorway = (d, kind) => {
    const s = d.storey;
    const piece = need("edge", kind);
    if (!piece) return;
    const [e0, e1] = d.edges;
    const span = { from: [Math.min(e0.from[0], e0.to[0], e1.from[0], e1.to[0]), Math.min(e0.from[1], e0.to[1], e1.from[1], e1.to[1])] }; // prettier-ignore
    span.to = horizontal(e0) ? [span.from[0] + 2, span.from[1]] : [span.from[0], span.from[1] + 2];
    if ((piece.edges ?? 1) !== 2) failures.push(`${d.name}: the library's ${kind} piece ${piece.id} covers ${piece.edges ?? 1} edge; a doorway spans 2 (128)`); // prettier-ignore
    // its +y into the room its leaf swings into
    const sides = cellsAcross(e0).map(([i, j]) => cellOf(s, i, j));
    const side = sides.indexOf(d.swing);
    if (side < 0) {
      failures.push(`${d.name}: its leaf swings into ${d.swing}, which is on neither side of it (${sides.map(String).join(" and ")})`); // prettier-ignore
      return;
    }
    const f = edgeFrame(span, side, 2);
    const at = world(...f.at, s);
    put(piece, { kind, storey: s, edges: d.edges.map((e) => ({ from: e.from, to: e.to })), doorway: d.at, swing: d.swing, side }, { at, turn: f.turn }); // prettier-ignore
    // where it is: its middle, the way through it (into the swing room) and along it, its open leaf in the world
    const into = turnXY([0, 1], f.turn);
    const along = turnXY([1, 0], f.turn);
    const middle = [base[0] + d.at[0] * g, base[1] + d.at[1] * g];
    let leaf = null;
    if (piece.open) {
      const [lo, hi] = piece.open.box;
      const cs = [turnXY(lo, f.turn), turnXY(hi, f.turn)];
      leaf = [
        [Math.min(cs[0][0], cs[1][0]) + at[0], Math.min(cs[0][1], cs[1][1]) + at[1], lo[2] + at[2]],
        [Math.max(cs[0][0], cs[1][0]) + at[0], Math.max(cs[0][1], cs[1][1]) + at[1], hi[2] + at[2]],
      ];
    }
    doorwaysPlaced.push({ name: d.name, what: d.what, kind, storey: s, at: d.at, rooms: d.rooms, swing: d.swing, piece: piece.id, place: { at, turn: f.turn }, middle, floor: floorOf(s), into, along, leaf, open }); // prettier-ignore
  };
  const edgesOf = (p) => {
    const s = p.storey;
    for (const e of p.edges) {
      const across = cellsAcross(e);
      if (across.every(([i, j]) => inWell(i, j))) continue; // the stair piece's own
      const d = doorwayAt.get(`${s}:${keyOf(e)}`);
      if (d) {
        // one piece over both edges of the doorway, written with its first; nothing else on either
        if (keyOf(e) === keyOf(d.edges[0])) placeDoorway(d, e.kind);
      } else if (e.kind === "door" || e.kind === "entrance") {
        failures.push(`the ${e.kind} edge ${e.from.join(",")} to ${e.to.join(",")} on storey ${s} is in no doorway of the layout's; a doorway is 2 edges with its middle vertex (doors[], entrance)`); // prettier-ignore
        continue;
      } else {
        const piece = need("edge", e.kind);
        if (!piece) continue;
        const side = sideOf(e, s);
        const f = edgeFrame(e, side);
        put(piece, { kind: e.kind, storey: s, edge: { from: e.from, to: e.to }, side }, { at: world(...f.at, s), turn: f.turn }); // prettier-ignore
      }
      count(kinds, e.kind);
      standing[s].set(edgeKey(e), e.kind);
      // the slot under an upper storey's interior wall where one side has no floor (the slab's 16)
      if (s > 0 && ["interior", "door"].includes(e.kind) && across.some(([i, j]) => !hasFloor(s, i, j))) {
        const [a, b] = [world(...e.from, s), world(...e.to, s)];
        const lo = [Math.min(a[0], b[0]) - (horizontal(e) ? 0 : 8), Math.min(a[1], b[1]) - (horizontal(e) ? 8 : 0), floorOf(s) - 16]; // prettier-ignore
        const hi = [Math.max(a[0], b[0]) + (horizontal(e) ? 0 : 8), Math.max(a[1], b[1]) + (horizontal(e) ? 8 : 0), floorOf(s)]; // prettier-ignore
        brushes.push(box(lo, hi, library.palette.wall ?? "FIFTIES_WALL14A"));
        placements.push({ piece: "filler", slot: "edge", kind: "filler", storey: s, edge: { from: e.from, to: e.to }, at: lo, turn: 0, brushes: 1 }); // prettier-ignore
        count(pieces, "filler");
      }
    }
  };

  // the corners
  const cornersOf = (p) => {
    const s = p.storey;
    const kindAt = (a, b) => standing[s].get(edgeKey({ from: a, to: b }));
    const out = (i, j) => cellOf(s, i, j) === null;
    for (let y = 0; y <= D; y++)
      for (let x = 0; x <= W; x++) {
        const around = [
          [8, kindAt([x, y], [x, y + 1])],
          [4, kindAt([x, y], [x + 1, y])],
          [2, kindAt([x, y - 1], [x, y])],
          [1, kindAt([x - 1, y], [x, y])],
        ];
        if (middles.has(`${s}:${x},${y}`)) continue; // a doorway's middle: its piece spans it, no post
        const wall = around.reduce((n, [bit, k]) => n | (k && k !== "rail" ? bit : 0), 0);
        const rail = around.reduce((n, [bit, k]) => n | (k === "rail" ? bit : 0), 0);
        if (wall) {
          const piece = need("corner", wall);
          if (!piece) continue;
          const outside = [];
          if (out(x - 1, y - 1) && out(x - 1, y)) outside.push("west");
          if (out(x, y - 1) && out(x, y)) outside.push("east");
          if (out(x - 1, y - 1) && out(x, y - 1)) outside.push("south");
          if (out(x - 1, y) && out(x, y)) outside.push("north");
          put(piece, { kind: "corner", storey: s, vertex: [x, y], mask: wall }, { at: world(x, y, s), outside: outside.length ? outside : undefined }); // prettier-ignore
        } else if (rail) {
          const piece = need("corner", { mask: rail, kind: "rail" });
          if (piece) put(piece, { kind: "newel", storey: s, vertex: [x, y], mask: rail }, { at: world(x, y, s) });
        }
      }
  };
  for (const p of plans) {
    floorsOf(p);
    edgesOf(p);
    cornersOf(p);
  }

  // ── 6. the stair ──
  if (well) {
    const piece = need("stair", "u-turn");
    const turn = FOOT_TURN[well.foot];
    if (turn === undefined) failures.push(`the stairwell's foot is ${well.foot}; it is south, east, north or west`);
    else if (piece) {
      const xs = well.cells.map((c) => c[0]);
      const ys = well.cells.map((c) => c[1]);
      const [lo] = footprintOf(piece, { at: [0, 0, 0], turn });
      const corner = world(Math.min(...xs), Math.min(...ys), well.from);
      const at = [corner[0] - lo[0], corner[1] - lo[1], corner[2]];
      const box2 = footprintOf(piece, { at, turn });
      const span = [(Math.max(...xs) + 1 - Math.min(...xs)) * g, (Math.max(...ys) + 1 - Math.min(...ys)) * g];
      if (box2[1][0] - box2[0][0] !== span[0] || box2[1][1] - box2[0][1] !== span[1])
        failures.push(`the stair piece covers ${box2[1][0] - box2[0][0]} x ${box2[1][1] - box2[0][1]} turned ${turn}, the stairwell ${span.join(" x ")}; they want to be the same`); // prettier-ignore
      // its connectors on the layout's cells: the foot on `bottom` (storey from), the top on `top` (storey to)
      const cellIn = (c) => [Math.floor((c.at[0] - c.facing[0] * g / 2 - base[0]) / g), Math.floor((c.at[1] - c.facing[1] * g / 2 - base[1]) / g)]; // prettier-ignore
      for (const c of connectorsOf(piece, { at, turn })) {
        const want = c.type === "stair-foot" ? [well.bottom, floorOf(well.from)] : c.type === "stair-top" ? [well.top, floorOf(well.to)] : null; // prettier-ignore
        if (!want || !want[0]) continue;
        const got = cellIn(c);
        if (got[0] !== want[0][0] || got[1] !== want[0][1])
          failures.push(`the stair piece's ${c.type} lands on the cell ${got.join(",")}, the layout's ${c.type === "stair-foot" ? "bottom" : "top"} is ${want[0].join(",")}: the piece has one hand (flight 1 on the left going up), and the layout wants it in the other lane`); // prettier-ignore
        if (c.at[2] !== want[1]) failures.push(`the stair piece's ${c.type} is at z ${c.at[2]}, its storey's floor at ${want[1]}; they want to be the same`); // prettier-ignore
      }
      put(piece, { kind: "stair", storey: well.from, cells: well.cells, foot: well.foot }, { at, turn });
      count(kinds, "stair");
    }
  }

  // ── 7. the lamps ──
  const lamps = [];
  const ceilingLamp = need("lamp", "ceiling");
  const wallLamp = need("lamp", "wall");
  const sconced = new Set();
  for (const p of plans) {
    const s = p.storey;
    const roomsHere = (layout.rooms ?? []).filter((r) => r.storey === s);
    for (const room of roomsHere) {
      const rule = table[room.kind] ?? table.default;
      const cells = [];
      for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) if (cellOf(s, i, j) === room.id) cells.push([i, j]);
      // a ceiling over the cell: the roof, or the next storey's floor
      const roofed = cells.filter(([i, j]) => s === last || hasFloor(s + 1, i, j));
      if (!roofed.length) {
        warnings.push(`room ${room.id} (storey ${s}) has no cell with a ceiling over it: it has no ceiling lamp`);
        continue;
      }
      const n = Math.max(1, Math.round(cells.length / rule.perLamp));
      const xs = cells.map((c) => c[0]);
      const ys = cells.map((c) => c[1]);
      const lo = [Math.min(...xs), Math.min(...ys)];
      const hi = [Math.max(...xs) + 1, Math.max(...ys) + 1];
      const along = hi[0] - lo[0] >= hi[1] - lo[1] ? 0 : 1;
      const mean = [0, 1].map((k) => cells.reduce((sum, c) => sum + c[k] + 0.5, 0) / cells.length);
      // the lamps spread over the room: begun in strips along its longer way, then moved as k-means moves them
      // (each to the middle of the cells nearest it, put back on the room's roofed cell nearest that) so that an
      // L-shaped room has a lamp in each arm
      const d2 = (c, p) => (c[0] + 0.5 - p[0]) ** 2 + (c[1] + 0.5 - p[1]) ** 2;
      const nearest = (list, p) => list.reduce((best, c) => (d2(c, p) < d2(best, p) - 1e-9 ? c : best), list[0]);
      let chosen = [];
      for (let k = 0; k < n; k++) {
        const want = [...mean];
        want[along] = lo[along] + ((k + 0.5) * (hi[along] - lo[along])) / n;
        const free = roofed.filter((c) => !chosen.includes(c));
        if (free.length) chosen.push(nearest(free, want));
      }
      for (let round = 0; round < 12; round++) {
        const groups = chosen.map(() => []);
        for (const c of cells) {
          let best = 0;
          for (let k = 1; k < chosen.length; k++) if (d2(c, [chosen[k][0] + 0.5, chosen[k][1] + 0.5]) < d2(c, [chosen[best][0] + 0.5, chosen[best][1] + 0.5]) - 1e-9) best = k; // prettier-ignore
          groups[best].push(c);
        }
        const next = [];
        for (let k = 0; k < chosen.length; k++) {
          if (!groups[k].length) { next.push(chosen[k]); continue; } // prettier-ignore
          const middle = [0, 1].map((a) => groups[k].reduce((sum, c) => sum + c[a] + 0.5, 0) / groups[k].length);
          const free = roofed.filter((c) => !next.includes(c));
          next.push(nearest(free, middle));
        }
        const same = next.every((c, k) => c === chosen[k]);
        chosen = next;
        if (same) break;
      }
      if (ceilingLamp)
        for (const c of chosen) {
          put(ceilingLamp, { kind: "lamp-ceiling", storey: s, cell: c, room: room.id }, { at: world(c[0], c[1], s) });
          lamps.push({ room: room.id, storey: s, kind: "ceiling", cell: c });
        }
      // sconces beside the room's doorways: on the next wall of the same line, on the room's side
      if (rule.sconces && wallLamp) {
        // a doorway is 2 edges: the next wall is the edge past either end of the pair, clear of its casings
        for (const d of doorways.filter((d) => d.storey === s && d.rooms.includes(room.id) && d.edges?.length === 2)) {
          const e = d.edges[0];
          const sides = cellsAcross(e).map(([i, j]) => cellOf(s, i, j));
          const side = sides.indexOf(room.id);
          if (side < 0) continue;
          const step = horizontal(e) ? [1, 0] : [0, 1];
          const ends = d.edges.flatMap((x) => [x.from, x.to]);
          const k = horizontal(e) ? 0 : 1;
          const lo = ends.reduce((a, b) => (b[k] < a[k] ? b : a));
          const hi = ends.reduce((a, b) => (b[k] > a[k] ? b : a));
          for (const dir of [1, -1]) {
            const next = dir === 1 ? { from: hi, to: [hi[0] + step[0], hi[1] + step[1]] } : { from: [lo[0] - step[0], lo[1] - step[1]], to: lo }; // prettier-ignore
            const kind = standing[s].get(edgeKey(next));
            const nextSides = cellsAcross(next).map(([i, j]) => cellOf(s, i, j));
            if (!["interior", "exterior"].includes(kind) || nextSides[side] !== room.id || sconced.has(`${s}:${edgeKey(next)}:${side}`)) continue; // prettier-ignore
            const f = edgeFrame(next, side);
            put(wallLamp, { kind: "lamp-wall", storey: s, edge: next, room: room.id }, { at: world(...f.at, s), turn: f.turn }); // prettier-ignore
            sconced.add(`${s}:${edgeKey(next)}:${side}`);
            lamps.push({ room: room.id, storey: s, kind: "wall", edge: next });
            break;
          }
        }
      }
    }
  }
  // the stairwell, which is no room: a lamp at its foot under the upper landing, and one over its void on the
  // storey it climbs to (under that storey's ceiling), so that both flights are lit
  if (well && ceilingLamp) {
    const stairLamps = [];
    if (cellOf(well.to, ...well.bottom) === "stair") stairLamps.push([well.bottom, well.from]);
    const voids = well.cells.filter(([i, j]) => cellOf(well.to, i, j) === "void");
    const roofed = (i, j) => well.to === last || hasFloor(well.to + 1, i, j);
    if (voids.length) {
      const mid = [0, 1].map((k) => voids.reduce((sum, c) => sum + c[k], 0) / voids.length);
      const c = voids.filter(([i, j]) => roofed(i, j)).reduce((best, c) => (best && Math.hypot(best[0] - mid[0], best[1] - mid[1]) <= Math.hypot(c[0] - mid[0], c[1] - mid[1]) + 1e-9 ? best : c), null); // prettier-ignore
      if (c) stairLamps.push([c, well.to]);
    }
    for (const [c, s] of stairLamps) {
      put(ceilingLamp, { kind: "lamp-ceiling", storey: s, cell: c, room: "stair" }, { at: world(c[0], c[1], s) });
      lamps.push({ room: "stair", storey: s, kind: "ceiling", cell: c });
    }
  }

  // ── the start, the sun, the texture lights ──
  let start = null;
  const entrance = layout.entrance ?? null;
  if (entrance) {
    const e = entrance.edges?.[0] ?? { from: [0, 0], to: [1, 0] };
    const sides = cellsAcross(e).map(([i, j]) => cellOf(entrance.storey ?? 0, i, j));
    const out = sides[0] === null ? -1 : 1; // the outside lies to the lesser side (-1) or the greater (+1)
    const mid = [base[0] + (entrance.at?.[0] ?? 0) * g, base[1] + (entrance.at?.[1] ?? 0) * g]; // the doorway's middle
    const away = Math.min(m - 32, 2.5 * g);
    const at = horizontal(e) ? [mid[0], mid[1] + out * away, z0] : [mid[0] + out * away, mid[1], z0];
    const yaw = horizontal(e) ? (out > 0 ? 270 : 90) : out > 0 ? 180 : 0;
    entities.push(playerStart(at, yaw));
    start = { at, yaw };
  } else failures.push("the layout has no entrance: the player has no door to walk in by");
  const sunAt = [sx0 + 32, sy0 + 32, top - 32];
  entities.push(
    pointEntity("light_environment", sunAt, {
      _light: [...sun.color, sun.brightness],
      _diffuse_light: sun.diffuse,
      angles: [0, sun.yaw, 0],
      pitch: sun.pitch,
    }),
  );
  const scale = options.texlightScale ?? TEXLIGHT_SCALE;
  const texlights = Object.fromEntries(Object.entries(library.texlights ?? {}).map(([name, [r, gg, b, i]]) => [name, [r, gg, b, Math.round(i * scale)]])); // prettier-ignore
  if (options.texlights !== false && Object.keys(texlights).length) entities.push(textureLights([sx0 + 64, sy0 + 32, top - 32], texlights)); // prettier-ignore

  const worldspawn = {
    wad: options.wad ?? WAD_KEY,
    skyname: options.sky ?? "desert",
    message: `${layout.building ?? "building"} (seed ${layout.seed})`,
  };
  const map = { worldspawn, brushes, entities };
  const brushCount = brushes.length + entities.reduce((n, e) => n + (e.brushes?.length ?? 0), 0);
  const report = {
    failures,
    warnings,
    counts: { pieces, kinds, brushes: brushCount, worldBrushes: brushes.length, entities: entities.length + 1, lamps: lamps.length }, // prettier-ignore
    placements,
    lamps,
    site: { min: [sx0, sy0, z0 - 16], max: [sx1, sy1, top], footprint: [[fx0, fy0], [fx1, fy1]] },
    start,
    light: table,
    texlights,
    doorways: doorwaysPlaced,
    open,
  };
  return { map, entities, report, owners };
}

const DOOR_ENTITIES = new Set(["func_door", "func_door_rotating", "momentary_door"]);
const near = (a, b) => a.every((v, k) => Math.abs(v - b[k]) < 1e-3);
const overlaps = (a, b) => [0, 1, 2].every((k) => a.max[k] > b.min[k] + 0.01 && a.min[k] < b.max[k] - 0.01);
const xyz = (p) => p.map((v) => Math.round(v * 10) / 10).join(" ");

/**
 * What is wrong with a walk map (`assemble(layout, library, { open: true })`), in sentences: a door entity left in
 * it, or a doorway whose open leaf is not a world brush where it stands open. A map whose leaves were REMOVED
 * fails here: a walk on it passes a doorway the open leaf blocks.
 */
export function walkMapProblems(built) {
  const problems = [];
  const { map, report } = built;
  if (!report.open) problems.push("the walk map was assembled with its doors closed; it wants assemble(..., { open: true }), every leaf a world brush at its open position"); // prettier-ignore
  const doors = map.entities.filter((e) => DOOR_ENTITIES.has(e.classname));
  if (doors.length) problems.push(`the walk map has ${doors.length} door entities (${[...new Set(doors.map((e) => e.classname))].join(", ")}); it wants 0: each leaf a world brush at its open position`); // prettier-ignore
  const shapes = map.brushes.map((b) => shapeOf(b));
  for (const d of report.doorways) {
    if (!d.leaf) continue;
    if (!shapes.some((s) => near(s.min, d.leaf[0]) && near(s.max, d.leaf[1])))
      problems.push(`${d.name}: its leaf is not in the walk map as a world brush at its open position (${xyz(d.leaf[0])} to ${xyz(d.leaf[1])}): a walk with the leaf removed passes a doorway the open leaf blocks`); // prettier-ignore
  }
  return problems;
}

/** The standing player (GoldSrc's hull 1): 32 x 32 x 72, its middle 36 over its feet. */
const HALF = 16;
const TALL = 72;
/** How far each side of the wall's line the trace through a doorway runs, and the sideways offsets it must pass at. */
const NUDGES = [[0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25], [0.25, 0.25], [0.25, -0.25], [-0.25, 0.25], [-0.25, -0.25]];
export const DOORWAY_TRACE = { reach: 48, step: 2, offsets: [0, 12, -12], least: 48 };

/**
 * Each doorway of a compiled walk map (`bsp`, compiled from `built.map` with `{ open: true }`) traced by a standing
 * player (hull 1) with its feet 1 over the floor, straight through from `reach` before the wall's line to `reach`
 * past it, at its middle and at 12 to each side (left and right as one walks into the room its leaf swings into):
 * each must pass. Also its clear width as built (the widest run of sideways places a player passes straight
 * through, plus the player's 32), and its piece's doorwayOf with the leaf open, which must be `least` (48) wide.
 * Returns `{ doorways: [{ name, piece, clear, offsets: { [o]: passes }, blocked, doorwayOf }], failures }`.
 */
export function doorwayClearance(bsp, built, library, options = {}) {
  const { reach, step, offsets, least } = { ...DOORWAY_TRACE, ...options };
  const failures = [];
  const doorways = [];
  const leaves = built.report.doorways.filter((d) => d.leaf).map((d) => ({ d, box: { min: d.leaf[0], max: d.leaf[1] } }));
  const solids = (built.owners ?? []).map((o) => ({ label: o.label, boxes: o.brushes.map((b) => shapeOf(b)) }));
  const whatBlocks = (p, feet) => {
    // (grown by the trace's step: the hull is solid where the player's box only touches a brush)
    const body = { min: [p[0] - HALF - step, p[1] - HALF - step, feet], max: [p[0] + HALF + step, p[1] + HALF + step, feet + TALL] }; // prettier-ignore
    const leaf = leaves.find((l) => overlaps(l.box, body));
    if (leaf) return `the open leaf of ${leaf.d.name} (${xyz(leaf.box.min)} to ${xyz(leaf.box.max)})`;
    const hits = solids.filter((o) => o.boxes.some((b) => overlaps(b, body))).map((o) => o.label);
    return hits.length ? hits.slice(0, 3).join(", ") : "solid the compiled map has there (no piece's box)";
  };
  for (const d of built.report.doorways) {
    const feet = d.floor + 1;
    const z = feet + TALL / 2;
    const left = [-d.into[1], d.into[0]];
    const at = (side, s) => [d.middle[0] + left[0] * side + d.into[0] * s, d.middle[1] + left[1] * side + d.into[1] * s, z];
    // the first place a player standing `side` to the left of the middle stops, going through; null when it passes
    const stopOf = (side) => {
      for (let s = -reach; s <= reach + 1e-9; s += step) {
        const p = at(side, s);
        if (contentsAt(bsp, p, { hull: 1 }) !== CONTENTS.SOLID) continue;
        // a box that only touches a face is not stopped by it (the hull is solid ON its grown planes): nudged a
        // quarter unit away from what it touches, it is free
        if (NUDGES.some(([dx, dy]) => contentsAt(bsp, [p[0] + dx, p[1] + dy, p[2]], { hull: 1 }) !== CONTENTS.SOLID)) continue;
        return { p, s };
      }
      return null;
    };
    const passes = {};
    let blocked = null;
    for (const o of offsets) {
      const stop = stopOf(o);
      passes[o] = !stop;
      if (stop && !blocked) {
        const where = o === 0 ? "through its middle" : `${Math.abs(o)} ${o > 0 ? "left" : "right"} of its middle`;
        blocked = `${d.name}: a standing player does not pass ${where}: blocked by ${whatBlocks(stop.p, feet)}, at ${xyz([stop.p[0], stop.p[1], feet])} (${Math.abs(Math.round(stop.s))} ${stop.s < 0 ? "before" : "past"} the wall's line, walking into ${d.swing})`; // prettier-ignore
        failures.push(blocked);
      }
    }
    // the clear width as built: the run of sideways places round the middle that pass, plus the player's 32
    // (whole units out from the middle, then the last unit halved 8 times)
    const edgeOf = (way) => {
      let ok = 0;
      while (Math.abs(ok) < 64 && !stopOf(ok + way)) ok += way;
      let bad = ok + way;
      for (let k = 0; k < 8; k++) {
        const mid = (ok + bad) / 2;
        if (stopOf(mid)) bad = mid;
        else ok = mid;
      }
      return ok;
    };
    const [lo, hi] = passes[0] === false ? [0, 0] : [edgeOf(-1), edgeOf(1)];
    const clear = passes[0] === false ? 0 : Math.round((hi - lo + 2 * HALF) * 10) / 10;
    const piece = library.pieces.get(d.piece);
    let measured = null;
    if (piece?.open) {
      measured = doorwayOf(piece, { want: [least, TALL] });
      for (const f of measured.failures) failures.push(`${d.name}: ${f}`);
    } else failures.push(`${d.name}: its piece ${d.piece} has no "open" entry: its doorway cannot be measured with the leaf open`); // prettier-ignore
    doorways.push({ name: d.name, piece: d.piece, clear, span: [lo - HALF, hi + HALF], offsets: passes, blocked, doorwayOf: measured && { width: measured.width, height: measured.height } }); // prettier-ignore
  }
  return { doorways, failures };
}
