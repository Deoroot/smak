// Stage 8, dressing: furniture and street props placed only by rules (PLAN.md Phase 3, "Furniture and props by
// rules only"; levels/rules/architecture.json `keepClear` and `placement`). Greybox: each prop is an abstract box
// (kind, size, height, needs a wall at its back, collision, the side it is used from and how deep) with a `model`
// key a later adapter maps to its kit's model or brush.
//
// Written rules (each a sentence the gate holds or the placer obeys):
//   - A room is dressed by its kind's set (FURNISH); circulation (corridors, stairwells, lift lobbies, gates,
//     upper halls, catwalks) is kept clear. Counts grow with floor area (`per` m2 a prop) scaled by the district's
//     density (DENSITY); worn districts add junk (WEAR_JUNK).
//   - A prop stands against a wall (its back on the wall's face, facing into the room), or off the walls only if
//     its class is one of placement.freestanding.kinds and the room's narrow side is at least minRoomSide.
//   - Never in a keep-clear volume (keepClearOf): every door's opening, its approach on both sides and its leaf's
//     swing; every opening's approach; every window's front from sill to head (a low prop may stand under it, a
//     tall one never across it); every stair flight, its landings and approaches with their headroom (from the
//     storey below too); every lift landing; the switch spot by each room's entrance door (latch side, stage 7
//     wires it); the light spot under each room's ceiling (stage 6's lamps when 06 is there); signs over street
//     doors; spawns.
//   - Never across an opening (its hole in the wall).
//   - The walk: between every pair of a room's doors a path at least the rulebook corridor width (public rooms:
//     dimensions.corridors.public, else domestic; to the 8 unit plan grid) stays clear when the empty room had
//     one, else the 32 x 72 unit hull's path; every prop's use side (a strip its use depth deep, free of props)
//     reached from the doors by the hull. Checked by a flood on the plan grid (8 units), the hull as a square.
//   - The share of a room's floor props cover at most placement.maxCoveredShare of its kind's clutter class.
//   - Streets: props outside every carriageway (and 0.3 m of kerb), outside porticoes' and sidewalks' walking
//     lanes (only on the kerb strip, KERB_STRIP wide, where a sidewalk keeps minWalkWidth beside it), on a way with
//     no carriageway only within EDGE_STRIP of its building lines leaving a public corridor's width in the middle;
//     never on a connector exit's approach, a gate, a door's approach or swing, a portal's mouth, a way's mouth
//     into a plaza, a spawn, a sign's reading space; lamps from 06 when present, else placeholder lamp posts at the
//     kerb (LAMP_SPACING by wealth) and round plazas; benches and bins on plazas and wide kerbs; stalls in a market
//     district's plazas; debris by wear. Street clutter (lamp posts aside) per 100 m2 of public floor held to STREET_CAP by district
//     density and wear (+ MARKET_CAP in a market plaza), covered share to the rulebook's outdoor class.
//   - Brush or model (the rulebook's placement.props): a prop is built of brushes (func_detail: no entity, counted in
//     the tile's brush budget, BRUSHES a kind) unless its shape is one brushes cannot give at the 8 unit grid
//     (porcelain and steel fixtures, plants, loose scatter, rubble: placement.props.modelKinds); only those are models
//     (an entity each). The tile's model props are capped (modelPropCap): its maxShare of placement.props.modelsPerCity
//     (the RP cities' most, 214 a whole city) and what the tile's entity share leaves after 07's entities and
//     placement.props.entityHeadroom; past the cap the models a room needs least go first (MODEL_DROP order:
//     scatter, rubble, planters), never a toilet's or a cell's fixtures.
//   - The dressing allowance (placement.dressing, the notes' first trade): a room of a kind in maxBrushesBy is
//     dressed as above and then trimmed to that many prop brushes (trimRoom): scatter first, then decor, then a
//     kind's second and later pieces, then the rest, the last placed first, put back while they fit; a prop kept
//     never moves. The kinds in placement.dressing.full (where role-play happens) keep their whole dressing.
//   - A dressed room holds what makes it one (placement.requiredProps.byKind: a bed in a bedroom, a counter at a
//     shop floor, a desk in an office...): never trimmed, and the gate fails a room without them.
import { keepClearOf } from "../lib/architecture-rules.mjs";
import { ESTIMATE, tileEstimateOf } from "../lib/city-checks.mjs";
import { G, rngOf } from "./common.mjs";
import { bandPoly, pointInPoly, polyBox } from "./geom.mjs";

const r4 = (v) => Math.round(v * 10000) / 10000 + 0;
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
const r2 = (v) => Math.round(v * 100) / 100 + 0;
/** Lengths on the plan grid (8 units). */
const snap = (v) => r4(Math.max(1, Math.round(v / G)) * G);
const EPS = 1e-6;

// ── the catalogue: what a prop kind is, as a box ──
// w: along the wall it backs on (or its long side), d: out from the wall, h: height, metres; wall: needs a wall at
// its back; use: { depth, sides } the strip it is used from (front, left, right, back: any one reached will do);
// cls: its class in placement.freestanding.kinds (only these may stand off the walls); build: brush (greybox
// func_detail) or model (an entity: counts against the engine's entity budget).
const RAW = {
  "bed-single": { w: 1.0, d: 2.1, h: 0.6, wall: true, use: [0.82, ["left", "right", "front"]], cls: "bed", build: "brush" },
  "bed-double": { w: 1.6, d: 2.1, h: 0.6, wall: true, use: [0.82, ["left", "right", "front"]], cls: "bed", build: "brush" },
  bunk: { w: 1.0, d: 2.1, h: 1.7, wall: true, use: [0.82, ["left", "right", "front"]], cls: "bed", build: "brush" },
  cot: { w: 0.8, d: 2.0, h: 0.45, wall: true, use: [0.82, ["left", "right", "front"]], cls: "bed", build: "brush" },
  "hospital-bed": { w: 1.0, d: 2.2, h: 0.7, wall: true, use: [0.82, ["left", "right", "front"]], cls: "bed", build: "brush" },
  wardrobe: { w: 1.2, d: 0.6, h: 2.1, wall: true, use: [0.82, ["front"]], build: "brush" },
  dresser: { w: 1.0, d: 0.5, h: 0.9, wall: true, use: [0.82, ["front"]], build: "brush" },
  desk: { w: 1.4, d: 0.7, h: 0.75, wall: true, use: [0.9, ["front"]], build: "brush" },
  bookshelf: { w: 1.0, d: 0.4, h: 2.0, wall: true, use: [0.82, ["front"]], build: "brush" },
  "filing-cabinet": { w: 0.6, d: 0.6, h: 1.3, wall: true, use: [0.82, ["front"]], build: "brush" },
  shelving: { w: 2.0, d: 0.6, h: 2.2, wall: true, use: [0.9, ["front"]], build: "brush" },
  "locker-row": { w: 1.8, d: 0.5, h: 1.9, wall: true, use: [1.0, ["front"]], build: "brush" },
  "weapon-rack": { w: 1.6, d: 0.5, h: 1.9, wall: true, use: [0.9, ["front"]], build: "brush" },
  counter: { w: 2.4, d: 0.7, h: 1.0, wall: true, use: [1.0, ["front", "back"]], cls: "counter", build: "brush" },
  "bar-counter": { w: 4.0, d: 0.7, h: 1.1, wall: true, use: [1.2, ["front"]], cls: "counter", build: "brush" },
  worktop: { w: 2.4, d: 0.6, h: 0.9, wall: true, use: [1.0, ["front"]], build: "brush" },
  stove: { w: 0.8, d: 0.6, h: 0.9, wall: true, use: [1.0, ["front"]], build: "brush" },
  fridge: { w: 0.8, d: 0.7, h: 1.8, wall: true, use: [1.0, ["front"]], build: "brush" },
  "dining-table": { w: 1.6, d: 0.9, h: 0.75, wall: false, use: [0.82, ["front", "back", "left", "right"]], cls: "table", build: "brush" },
  "display-table": { w: 1.6, d: 0.9, h: 0.9, wall: false, use: [0.82, ["front", "back", "left", "right"]], cls: "table", build: "brush" },
  "map-table": { w: 2.4, d: 1.4, h: 0.9, wall: false, use: [0.82, ["front", "back", "left", "right"]], cls: "table", build: "brush" },
  sofa: { w: 2.0, d: 0.9, h: 0.85, wall: true, use: [0.82, ["front"]], build: "brush" },
  armchair: { w: 0.9, d: 0.9, h: 0.9, wall: true, use: [0.82, ["front"]], build: "brush" },
  wc: { w: 0.45, d: 0.7, h: 0.8, wall: true, use: [0.82, ["front"]], build: "model" },
  basin: { w: 0.6, d: 0.45, h: 0.85, wall: true, use: [0.82, ["front"]], build: "model" },
  "steel-wc": { w: 0.45, d: 0.6, h: 0.45, wall: true, use: [0.82, ["front"]], build: "model" },
  bench: { w: 1.8, d: 0.5, h: 0.45, wall: true, use: [0.82, ["front"]], cls: "bench", build: "brush" },
  workbench: { w: 2.0, d: 0.8, h: 0.9, wall: true, use: [1.0, ["front"]], build: "brush" },
  "tool-rack": { w: 1.6, d: 0.3, h: 1.8, wall: true, use: [0.82, ["front"]], build: "brush" },
  machine: { w: 1.2, d: 1.0, h: 1.4, wall: true, use: [1.0, ["front"]], build: "brush" },
  cabinet: { w: 1.0, d: 0.5, h: 1.8, wall: true, use: [0.82, ["front"]], build: "brush" },
  "stall-counter": { w: 2.0, d: 0.8, h: 1.0, wall: true, use: [1.0, ["front"]], cls: "stall", build: "brush" },
  crate: { w: 1.0, d: 1.0, h: 1.0, wall: false, use: null, cls: "crate-stack", build: "brush" },
  "crate-stack": { w: 1.0, d: 1.0, h: 2.0, wall: false, use: null, cls: "crate-stack", build: "brush" },
  barrel: { w: 0.6, d: 0.6, h: 1.0, wall: false, use: null, build: "brush" },
  planter: { w: 0.6, d: 0.6, h: 1.0, wall: false, use: null, build: "model" },
  "trash-scatter": { w: 1.0, d: 0.8, h: 0.15, wall: false, use: null, collision: false, build: "model" },
  // the street's
  "lamp-post": { w: 0.4, d: 0.4, h: 4.0, wall: false, use: null, build: "brush", street: true },
  "street-bench": { w: 1.8, d: 0.6, h: 0.45, wall: false, use: [0.82, ["front"]], cls: "bench", build: "brush", street: true },
  bin: { w: 0.6, d: 0.6, h: 1.0, wall: false, use: null, build: "brush", street: true },
  "market-stall": { w: 2.4, d: 1.6, h: 2.4, wall: false, use: [1.2, ["front"]], cls: "stall", build: "brush", street: true },
  "planter-large": { w: 1.2, d: 1.2, h: 1.0, wall: false, use: null, build: "model", street: true },
  rubble: { w: 1.2, d: 1.0, h: 0.5, wall: false, use: null, build: "model", street: true },
};
/**
 * Brushes a brush prop takes once built (its greybox box, then its parts: a table's top and legs, a shelf's boards);
 * 1 when not listed, 0 for a model. Rough on purpose: counted in the tile's brush budget against the description's
 * estimate (city-checks.mjs) until the first compiled tile sets them.
 */
export const BRUSHES = {
  "bed-single": 2, "bed-double": 2, bunk: 4, cot: 2, "hospital-bed": 3, wardrobe: 2, dresser: 2, desk: 3, bookshelf: 4,
  shelving: 4, "locker-row": 3, "weapon-rack": 3, counter: 2, "bar-counter": 3, worktop: 2, stove: 2,
  "dining-table": 5, "display-table": 5, "map-table": 5, sofa: 3, armchair: 3, bench: 3, workbench: 5, "tool-rack": 2,
  machine: 3, cabinet: 2, "stall-counter": 3, "crate-stack": 2, barrel: 1, "lamp-post": 3, "street-bench": 3, bin: 1,
  "market-stall": 7,
}; // prettier-ignore
export const CATALOGUE = Object.fromEntries(
  Object.entries(RAW).map(([k, v]) => [
    k,
    { w: snap(v.w), d: snap(v.d), h: v.h, wall: v.wall, collision: v.collision ?? true, use: v.use ? { depth: snap(v.use[0]), sides: v.use[1] } : null, cls: v.cls ?? null, build: v.build, brushes: v.build === "brush" ? (BRUSHES[k] ?? 1) : 0, model: `prop/${k}`, street: !!v.street }, // prettier-ignore
  ]),
);
/** Past the tile's model cap, the models dropped first (the rest of placement.props.modelKinds are never dropped). */
export const MODEL_DROP = ["trash-scatter", "rubble", "planter-large", "planter"];
/**
 * The tile's cap on model props: its maxShare of placement.props.modelsPerCity, and no more than its entity share
 * leaves after `others` (07's entities that stay) and placement.props.entityHeadroom of the share.
 */
export function modelPropCap(desc, rules, tile, others) {
  const P = rules.placement?.props ?? {};
  const maxShare = desc.rules?.tiles?.maxShare ?? 0.25;
  const limit = Math.floor((desc.engine?.limits?.entities?.value ?? Infinity) * maxShare);
  const byCity = Math.floor((P.modelsPerCity ?? Infinity) * maxShare);
  const room = Math.floor(limit - others - (P.entityHeadroom ?? 0) * limit);
  return { cap: Math.max(0, Math.min(byCity, room)), byCity, room, limit, others, tile };
}
/**
 * The tile's brush budget with the prop brushes: the description's estimate for the tile (city-checks.mjs
 * tileEstimateOf) with each described room's dressing allowance (ESTIMATE.room.dressingBrushes, inside its 8 brushes)
 * replaced by the props placed: the allowance is taken out for as many described rooms as got a prop here (the rest
 * keep it), and every brush prop counts at BRUSHES. The room's box and door frame stay in the estimate; street props
 * are not in the description's street or plaza terms (paving and kerbs; their lamps count as lights), so they add.
 * `rooms` (this stage's room records) gives the rooms dressed; without it every allowance is kept.
 */
export function brushBudgetOf(desc, tile, props, rooms = []) {
  let t = null;
  try {
    t = tileEstimateOf(desc, tile);
  } catch {
    t = null;
  }
  const maxShare = desc.rules?.tiles?.maxShare ?? 0.25;
  const lim = desc.engine?.limits?.brushes?.value ?? 25000;
  const propBrushes = props.filter((p) => p.build === "brush").reduce((s, p) => s + (CATALOGUE[p.kind]?.brushes ?? 1), 0);
  const roomPropBrushes = props.filter((p) => p.build === "brush" && p.place === "room").reduce((s, p) => s + (CATALOGUE[p.kind]?.brushes ?? 1), 0); // prettier-ignore
  const dressed = rooms.filter((r) => r.props?.length).length;
  const per = t && t.rooms ? t.roomDressing / t.rooms : 0;
  const replacedRooms = t ? Math.min(t.rooms, dressed) : 0;
  const allowance = t ? { rooms: t.rooms, perRoom: per, brushes: t.roomDressing, replaced: Math.round(replacedRooms * per), kept: Math.round((t.rooms - replacedRooms) * per), roomsDressed: dressed } : null; // prettier-ignore
  const described = t ? t.brushes : null;
  const total = t ? described - allowance.replaced + propBrushes : null;
  return {
    described,
    allowance,
    props: propBrushes,
    roomProps: roomPropBrushes,
    streetProps: propBrushes - roomPropBrushes,
    total,
    limit: Math.floor(lim * maxShare),
    target: Math.floor(20000 * maxShare),
    note: `the description's estimate for the tile, less the dressing allowance of each described room that got props here (${desc.engine?.estimate?.room?.dressingBrushes ?? ESTIMATE.room.dressingBrushes} of a room's ${desc.engine?.estimate?.room?.brushes ?? ESTIMATE.room.brushes} brushes, 'a little dressing'; its box and door frame stay), plus every brush prop at BRUSHES: the furniture counted once; limit: the tile's maxShare of engine.limits.brushes; target: PLAN.md's brush economy (20,000 for the city, a tile at most its maxShare); every coefficient uncalibrated until the Core tile is compiled`, // prettier-ignore
  };
}

// ── what a room of each kind holds: [kind, n (at least), per (one more each this many m2, after density), max] ──
const F = (kind, n = 1, per = null, max = null, near = false) => ({ kind, n, per, max, near });
export const FURNISH = {
  bedroom: [F("bed-double"), F("wardrobe"), F("dresser"), F("desk", 0, 30, 1), F("armchair", 0, 35, 1)],
  bedsit: [F("bed-single"), F("wardrobe"), F("worktop"), F("stove"), F("dining-table")],
  living: [F("sofa"), F("armchair", 1, 30, 3), F("dining-table"), F("bookshelf", 1, 40, 2), F("dresser", 0, 50, 1)],
  kitchen: [F("worktop", 1, 15, 3), F("stove"), F("fridge"), F("dining-table", 0, 20, 1)],
  study: [F("desk"), F("bookshelf", 2, 15, 4), F("armchair")],
  toilet: [F("wc", 1, 12, 3), F("basin", 1, 15, 2)],
  cell: [F("cot"), F("steel-wc")],
  "holding-cell": [F("bench", 1, 10, 3), F("steel-wc")],
  "guard-post": [F("desk", 1, null, null, true), F("locker-row"), F("weapon-rack", 0, 20, 1)],
  interrogation: [F("dining-table"), F("bench", 0, 20, 1)],
  office: [F("desk", 1, 20, 3), F("filing-cabinet", 1, 15, 3), F("bookshelf", 1, 30, 2)],
  briefing: [F("desk", 1, null, null, true), F("bench", 2, 12, 8)],
  armory: [F("weapon-rack", 1, 6, 6), F("locker-row", 1, 20, 2)],
  lockers: [F("locker-row", 1, 6, 8), F("bench", 1, 25, 2)],
  evidence: [F("shelving", 1, 6, 6), F("crate", 1, 15, 2)],
  records: [F("shelving", 1, 6, 8), F("filing-cabinet", 1, 20, 3), F("desk")],
  lobby: [F("bench", 2, 40, 6), F("planter", 2, 60, 4)],
  "front-desk": [F("counter", 1, null, null, true), F("bench", 1, 30, 3), F("filing-cabinet"), F("planter")],
  booking: [F("counter", 1, null, null, true), F("bench"), F("filing-cabinet", 1, 20, 3), F("desk")],
  dormitory: [F("bunk", 2, 7, 12), F("locker-row", 1, 15, 4)],
  bunkroom: [F("bunk", 2, 7, 10), F("locker-row")],
  ward: [F("hospital-bed", 2, 9, 8), F("cabinet", 1, 30, 2), F("basin")],
  infirmary: [F("hospital-bed", 1, 10, 4), F("cabinet", 1, 20, 2), F("desk"), F("basin")],
  garage: [F("workbench"), F("shelving", 1, 25, 3), F("tool-rack"), F("crate", 1, 30, 3)],
  "shop-floor": [F("counter", 1, null, null, true), F("shelving", 1, 10, 8), F("display-table", 0, 30, 3)],
  backroom: [F("shelving", 1, 6, 6), F("crate", 1, 8, 4), F("desk")],
  storeroom: [F("shelving", 1, 5, 6), F("crate", 1, 6, 4), F("barrel", 0, 10, 3)],
  stall: [F("stall-counter", 1, null, null, true), F("crate", 1, 6, 3)],
  workshop: [F("workbench", 2, 15, 4), F("tool-rack", 1, 25, 3), F("machine", 1, 20, 3), F("shelving")],
  "factory-floor": [F("machine", 2, 30, 10), F("workbench", 1, 40, 6), F("crate-stack", 1, 40, 6), F("shelving", 1, 60, 4)],
  "loading-bay": [F("crate-stack", 1, 15, 6), F("barrel", 2, 25, 6)],
  barroom: [F("bar-counter"), F("dining-table", 1, 12, 8), F("bench", 1, 25, 4), F("shelving")],
  hall: [F("bench", 2, 15, 10), F("dining-table", 0, 30, 4), F("planter", 0, 50, 4)],
  "great-hall": [F("dining-table", 1, 20, 4), F("sofa"), F("armchair", 2, 30, 4), F("bookshelf", 1, 30, 3)],
  courtroom: [F("counter", 1, null, null, true), F("bench", 2, 10, 10)],
  "war-room": [F("map-table"), F("desk"), F("filing-cabinet", 1, 20, 3)],
  lookout: [F("bench")],
  gatehouse: [F("desk"), F("locker-row"), F("weapon-rack")],
  cellar: [F("barrel", 1, 5, 6), F("shelving"), F("crate", 1, 10, 3)],
  garden: [F("bench", 1, 25, 4), F("planter", 1, 15, 6)],
};
/** Room kinds kept clear: circulation. */
/** What stands beside what, along a wall: a stove and a fridge by the worktop, a basin by the WC, a bin by a bench. */
export const PARTNER = { stove: "worktop", fridge: "worktop", basin: "wc", "filing-cabinet": "desk", "steel-wc": "cot" };
const grow = (f, d) => [f[0] - d, f[1] - d, f[2] + d, f[3] + d];
export const CLEAR_KINDS = ["corridor", "stairwell", "lift-lobby", "gate", "upper-hall", "catwalk"];
export const DENSITY = { sparse: 0.8, medium: 1, dense: 1.2 };
/** Worn districts' junk a room (work, storage, living rooms): by the district's wear 0-3. */
export const WEAR_JUNK = { 0: [], 1: [], 2: ["crate"], 3: ["crate", "trash-scatter"] };
// streets
export const KERB = 0.3; // nothing this close to a carriageway
export const KERB_STRIP = 0.9; // the furniture strip by the kerb, on a sidewalk or a portico's pillar line (a shaft wide at least)
export const EDGE_STRIP = 0.9; // on a way with no carriageway: props only this close to its building lines
export const MOUTH = 3; // a way's mouth into a plaza, kept clear this far in
export const PORTAL_DEPTH = 3; // a portal's mouth, kept clear this far into the tile
export const LAMP_SPACING = { elite: 15, high: 18, mid: 20, low: 25, slum: 30 }; // metres along a way
/** Street props per 100 m2 of a district's public floor: by density, plus by wear, plus in a market plaza. */
export const STREET_CAP = { sparse: 0.25, medium: 0.4, dense: 0.5 };
export const WEAR_CAP = { 0: 0, 1: 0.1, 2: 0.2, 3: 0.35 };
export const MARKET_CAP = 0.8;
/** A street lamp's fitting (06 gives its centre): its post stands under it, up to its foot. */
export const LAMP_FITTING = [0.5, 0.5, 0.4];
/** How far a lamp post may move off 06's spot to a legal one (its fitting moves with it). */
export const LAMP_MOVE = 2;

// ── small geometry: 2D boxes [x0, y0, x1, y1], 3D boxes { min, max } ──
const ov1 = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
const boxOverlap2 = (a, b) => Math.min(ov1(a[0], a[2], b[0], b[2]), ov1(a[1], a[3], b[1], b[3]));
const box3Depth = (a, b) => Math.min(...[0, 1, 2].map((i) => ov1(a.min[i], a.max[i], b.min[i], b.max[i])));
const inRect = (p, r, e = 1e-9) => p[0] >= r[0] - e && p[0] <= r[2] + e && p[1] >= r[1] - e && p[1] <= r[3] + e;
const pointRectDist = (p, r) => Math.hypot(Math.max(r[0] - p[0], 0, p[0] - r[2]), Math.max(r[1] - p[1], 0, p[1] - r[3]));
const near = (a, b) => Math.abs(a - b) < 1e-3;
/** A prop's footprint [x0, y0, x1, y1] and its box from its foot centre, world size and z. */
export const footOf = (at, size) => [at[0] - size[0] / 2, at[1] - size[1] / 2, at[0] + size[0] / 2, at[1] + size[1] / 2];
const box3Of = (foot, z0, h) => ({ min: [foot[0], foot[1], z0], max: [foot[2], foot[3], z0 + h] });
/** The world size of a kind facing f (w along the wall, across the facing). */
const worldSize = (c, f) => (f[0] === 0 ? [c.w, c.d] : [c.d, c.w]);
/** The strip in front of (or beside, behind) a footprint, `depth` deep. */
function sideStrip(foot, facing, side, depth) {
  const [fx, fy] = facing;
  const dir = side === "front" ? [fx, fy] : side === "back" ? [-fx, -fy] : side === "left" ? [-fy, fx] : [fy, -fx];
  const [x0, y0, x1, y1] = foot;
  if (dir[0] === 1) return [x1, y0, x1 + depth, y1];
  if (dir[0] === -1) return [x0 - depth, y0, x0, y1];
  if (dir[1] === 1) return [x0, y1, x1, y1 + depth];
  return [x0, y0 - depth, x1, y0];
}
/** Samples of a footprint on a grid (corners and edges included). */
function samples(foot, step = G / 2) {
  const out = [];
  const nx = Math.max(1, Math.ceil((foot[2] - foot[0]) / step - 1e-9));
  const ny = Math.max(1, Math.ceil((foot[3] - foot[1]) / step - 1e-9));
  for (let i = 0; i <= nx; i++)
    for (let j = 0; j <= ny; j++) {
      const x = i === nx ? foot[2] - 1e-6 : i === 0 ? foot[0] + 1e-6 : foot[0] + i * step;
      const y = j === ny ? foot[3] - 1e-6 : j === 0 ? foot[1] + 1e-6 : foot[1] + j * step;
      out.push([x, y]);
    }
  return out;
}

// ── a room's floor ──

/** A room's floor as rects: its clear rects, and across the seam of an L the strip its partition leaves. */
export function roomFloor(room) {
  const rects = room.clear.map((r) => [r.x, r.y, r.x + r.w, r.y + r.d]);
  const P = room.rects;
  for (let i = 0; i < P.length; i++)
    for (let j = i + 1; j < P.length; j++) {
      const a = P[i];
      const b = P[j];
      const ca = rects[i];
      const cb = rects[j];
      if (!ca || !cb) continue;
      if (near(a.x + a.w, b.x) || near(b.x + b.w, a.x)) {
        const [l, r] = a.x < b.x ? [ca, cb] : [cb, ca];
        const y0 = Math.max(ca[1], cb[1]);
        const y1 = Math.min(ca[3], cb[3]);
        if (y1 - y0 > 0.01 && r[0] > l[2]) rects.push([l[2], y0, r[0], y1]);
      } else if (near(a.y + a.d, b.y) || near(b.y + b.d, a.y)) {
        const [l, r] = a.y < b.y ? [ca, cb] : [cb, ca];
        const x0 = Math.max(ca[0], cb[0]);
        const x1 = Math.min(ca[2], cb[2]);
        if (x1 - x0 > 0.01 && r[1] > l[3]) rects.push([x0, l[3], x1, r[1]]);
      }
    }
  return rects;
}
const inFloor = (p, floor) => floor.some((r) => inRect(p, r));
/** How far a footprint reaches outside the floor (0 inside). */
export function outsideBy(foot, floor) {
  let worst = 0;
  for (const p of samples(foot)) if (!inFloor(p, floor)) worst = Math.max(worst, Math.min(...floor.map((r) => pointRectDist(p, r))));
  return worst;
}
const floorBox = (floor) => [Math.min(...floor.map((r) => r[0])), Math.min(...floor.map((r) => r[1])), Math.max(...floor.map((r) => r[2])), Math.max(...floor.map((r) => r[3]))]; // prettier-ignore
const floorArea = (floor, room) => room.area_m2 ?? floor.reduce((s, r) => s + (r[2] - r[0]) * (r[3] - r[1]), 0);

/** The floor's edges that are walls: runs { a (start), u (along), n (into the room), len }. */
export function wallRuns(floor) {
  const s = G / 4;
  const runs = [];
  for (const r of floor) {
    const sides = [
      { a: [r[0], r[1]], u: [1, 0], n: [0, 1], len: r[2] - r[0] },
      { a: [r[0], r[3]], u: [1, 0], n: [0, -1], len: r[2] - r[0] },
      { a: [r[0], r[1]], u: [0, 1], n: [1, 0], len: r[3] - r[1] },
      { a: [r[2], r[1]], u: [0, 1], n: [-1, 0], len: r[3] - r[1] },
    ];
    for (const sd of sides) {
      let start = null;
      const k = Math.round(sd.len / s);
      for (let i = 0; i <= k; i++) {
        let edge = false;
        if (i < k) {
          const t = (i + 0.5) * s;
          const p = [sd.a[0] + sd.u[0] * t, sd.a[1] + sd.u[1] * t];
          const out = [p[0] - sd.n[0] * 1e-3, p[1] - sd.n[1] * 1e-3];
          const inn = [p[0] + sd.n[0] * 1e-3, p[1] + sd.n[1] * 1e-3];
          edge = !inFloor(out, floor) && inFloor(inn, floor);
        }
        if (edge && start === null) start = i * s;
        if (!edge && start !== null) {
          const t1 = i * s;
          runs.push({ a: [r4(sd.a[0] + sd.u[0] * start), r4(sd.a[1] + sd.u[1] * start)], u: sd.u, n: sd.n, len: r4(t1 - start) });
          start = null;
        }
      }
    }
  }
  return runs;
}

// ── the plan grid of a room or a layer: flooding a square hull ──

export class WalkGrid {
  constructor(box, isFloor) {
    this.x0 = box[0];
    this.y0 = box[1];
    this.nx = Math.max(1, Math.ceil((box[2] - box[0]) / G - 1e-6));
    this.ny = Math.max(1, Math.ceil((box[3] - box[1]) / G - 1e-6));
    this.floor = new Uint8Array(this.nx * this.ny);
    for (let j = 0; j < this.ny; j++)
      for (let i = 0; i < this.nx; i++) this.floor[j * this.nx + i] = isFloor([this.x0 + (i + 0.5) * G, this.y0 + (j + 0.5) * G], i, j) ? 1 : 0; // prettier-ignore
  }
  /** Blocked cells: off the floor, or under a footprint that collides (meeting the cell's square). */
  blocked(feet) {
    const b = new Uint8Array(this.nx * this.ny);
    for (let k = 0; k < b.length; k++) b[k] = this.floor[k] ? 0 : 1;
    for (const f of feet) {
      const i0 = Math.max(0, Math.floor((f[0] - this.x0) / G + 1e-6));
      const i1 = Math.min(this.nx - 1, Math.ceil((f[2] - this.x0) / G - 1e-6) - 1);
      const j0 = Math.max(0, Math.floor((f[1] - this.y0) / G + 1e-6));
      const j1 = Math.min(this.ny - 1, Math.ceil((f[3] - this.y0) / G - 1e-6) - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) b[j * this.nx + i] = 1;
    }
    return b;
  }
  /** Where an n x n cell square can stand (anchored at its least cell), and its 4-connected components. */
  flood(blocked, n) {
    const { nx, ny } = this;
    const S = new Int32Array((nx + 1) * (ny + 1));
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) S[(j + 1) * (nx + 1) + i + 1] = blocked[j * nx + i] + S[j * (nx + 1) + i + 1] + S[(j + 1) * (nx + 1) + i] - S[j * (nx + 1) + i]; // prettier-ignore
    const lab = new Int32Array(nx * ny).fill(-1);
    const ok = (i, j) => i >= 0 && j >= 0 && i + n <= nx && j + n <= ny && S[(j + n) * (nx + 1) + i + n] - S[j * (nx + 1) + i + n] - S[(j + n) * (nx + 1) + i] + S[j * (nx + 1) + i] === 0; // prettier-ignore
    const valid = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) valid[j * nx + i] = ok(i, j) ? 1 : 0;
    let c = 0;
    const q = new Int32Array(nx * ny);
    for (let k0 = 0; k0 < nx * ny; k0++) {
      if (!valid[k0] || lab[k0] >= 0) continue;
      let h = 0;
      let t = 0;
      q[t++] = k0;
      lab[k0] = c;
      while (h < t) {
        const k = q[h++];
        const i = k % nx;
        const j = (k - i) / nx;
        if (i > 0 && valid[k - 1] && lab[k - 1] < 0) (lab[k - 1] = c), (q[t++] = k - 1);
        if (i < nx - 1 && valid[k + 1] && lab[k + 1] < 0) (lab[k + 1] = c), (q[t++] = k + 1);
        if (j > 0 && valid[k - nx] && lab[k - nx] < 0) (lab[k - nx] = c), (q[t++] = k - nx);
        if (j < ny - 1 && valid[k + nx] && lab[k + nx] < 0) (lab[k + nx] = c), (q[t++] = k + nx);
      }
      c++;
    }
    return { n, lab, count: c };
  }
  /** The components of squares holding the point p (or, failing that, within `reach` metres of it). */
  labelsAt(fl, p, reach = 0) {
    const out = new Set();
    const { nx, ny } = this;
    const pi = Math.floor((p[0] - this.x0) / G);
    const pj = Math.floor((p[1] - this.y0) / G);
    const rr = Math.ceil(reach / G);
    for (let j = pj - fl.n + 1 - rr; j <= pj + rr; j++)
      for (let i = pi - fl.n + 1 - rr; i <= pi + rr; i++) {
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const l = fl.lab[j * nx + i];
        if (l >= 0) out.add(l);
      }
    return out;
  }
  /** The components of squares meeting a footprint (by more than touching). */
  labelsMeeting(fl, foot) {
    const out = new Set();
    const { nx, ny, x0, y0 } = this;
    const i0 = Math.floor((foot[0] - x0) / G + 1e-6) - fl.n + 1;
    const i1 = Math.ceil((foot[2] - x0) / G - 1e-6) - 1;
    const j0 = Math.floor((foot[1] - y0) / G + 1e-6) - fl.n + 1;
    const j1 = Math.ceil((foot[3] - y0) / G - 1e-6) - 1;
    for (let j = Math.max(0, j0); j <= Math.min(ny - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++) {
        const l = fl.lab[j * nx + i];
        if (l >= 0) out.add(l);
      }
    return out;
  }
}
const meets = (a, b) => [...a].some((x) => b.has(x));
/** Probe sizes in plan-grid cells: the hull exactly (32 units = 4 cells); a walk width to the grid within 2 cm. */
export const hullCells = (rules) => Math.ceil((rules.hull?.engines?.goldsrc?.width ?? 32) / 8 - 1e-6);
export const walkCells = (w) => Math.max(1, Math.ceil(w / G - 0.1));

// ── keep-clear volumes of a building's storey (lot frame, metres, z above the storey's floor) ──

/** The keep-clear items of a building's storey: doors, openings, windows, stairs, lift landings (keepClearOf inputs) and its reserved spots. */
export function storeyBoxes(b, s, rules, { liftOf = () => null, reserved = [] } = {}) {
  const boxes = [];
  const add = (item, owner) => {
    for (const bx of keepClearOf(item, rules)) boxes.push({ ...bx, hole: /'s opening$/.test(bx.what), item: owner ?? item.id });
  };
  for (const d of b.doors) {
    if (d.storey !== s) continue;
    const kind = d.kind === "opening" ? "opening" : "door";
    add({ kind, id: d.id, at: [d.at[0], d.at[1], 0], facing: d.facing, width: d.width, height: d.height, wall: d.wall, swing: d.swing === "none" ? "none" : "front" }); // prettier-ignore
    // a lift's landing before its door: the car is in the column behind it
    const conn = [d.from, d.to].find((x) => typeof x === "string" && x.startsWith("connector "));
    const lift = conn ? liftOf(conn.slice(10)) : null;
    if (lift) {
      const room = d.from === conn ? d.to : d.from;
      const into = b.rooms.find((r) => r.id === room && r.storey === s);
      const pIn = [d.at[0] + d.facing[0] * (d.wall / 2 + 0.3), d.at[1] + d.facing[1] * (d.wall / 2 + 0.3)];
      const f = into && inFloor(pIn, roomFloor(into)) ? d.facing : [-d.facing[0], -d.facing[1]];
      const [cw, cd, ch] = lift.car;
      const at = [d.at[0] - f[0] * (d.wall / 2 + cd / 2), d.at[1] - f[1] * (d.wall / 2 + cd / 2), 0];
      for (const bx of keepClearOf({ kind: "lift", id: `${lift.id} at ${d.id}`, at, facing: f, car: [cw, cd, ch] }, rules)) if (/landing/.test(bx.what)) boxes.push({ ...bx, hole: false, item: d.id }); // prettier-ignore
    }
  }
  b.windows.forEach((w, i) => {
    if (w.storey !== s) return;
    add({ kind: "window", id: `${w.room}.window${i + 1}`, at: [w.at[0], w.at[1], 0], facing: w.facing, width: w.width, sill: w.sill, head: w.head, wall: w.wall }); // prettier-ignore
  });
  // stairs of this storey, and the ones rising from the storey below (their head approach and headroom here)
  const sh = b.frame.storeyHeight_m;
  for (const st of b.stairs) {
    const dz = st.storey === s ? 0 : st.storey === s - 1 ? -sh : null;
    if (dz === null) continue;
    st.flights.forEach((f, i) => {
      const landings = i === 0 && st.halfLanding ? [{ at: [st.halfLanding.at[0], st.halfLanding.at[1], st.halfLanding.z], size: st.halfLanding.size }] : []; // prettier-ignore
      for (const bx of keepClearOf({ kind: "stair", id: `${st.id} flight ${i + 1}`, at: [f.at[0], f.at[1], f.z], facing: f.facing, width: f.width, run: f.run, rise: f.rise, landings }, rules)) { // prettier-ignore
        const moved = { ...bx, min: [bx.min[0], bx.min[1], bx.min[2] + dz], max: [bx.max[0], bx.max[1], bx.max[2] + dz], hole: false, item: st.id }; // prettier-ignore
        if (moved.max[2] > 0) boxes.push(moved);
      }
    });
  }
  for (const r of reserved) {
    if (r.kind === "box") boxes.push({ what: r.what, min: r.min, max: r.max, hole: false, item: r.id });
    else for (const bx of keepClearOf(r, rules)) boxes.push({ ...bx, hole: false, item: r.id });
  }
  return boxes;
}

// ── a room dressed ──

/** The doors of a room with the point just inside it before each. */
export function roomDoors(b, room, floor) {
  const out = [];
  for (const d of b.doors) {
    if (d.storey !== room.storey || (d.from !== room.id && d.to !== room.id)) continue;
    const off = d.wall / 2 + 0.45;
    const front = [d.at[0] + d.facing[0] * off, d.at[1] + d.facing[1] * off];
    const back = [d.at[0] - d.facing[0] * off, d.at[1] - d.facing[1] * off];
    const inFront = inFloor(front, floor);
    const p = inFront ? front : inFloor(back, floor) ? back : null;
    if (p) out.push({ door: d, p, into: inFront ? d.facing : [-d.facing[0], -d.facing[1]] });
  }
  return out;
}

/** The walk of a room with these props: per probe, the components each door's square stands in; each prop's use reached. */
function walkOf(grid, doors, props, probes) {
  const feet = props.filter((p) => p.collision).map((p) => p.foot);
  const blocked = grid.blocked(feet);
  const out = {};
  for (const [name, n] of Object.entries(probes)) {
    const fl = grid.flood(blocked, n);
    out[name] = { fl, at: doors.map((d) => grid.labelsAt(fl, d.p)) };
  }
  return out;
}
/** The pairs of doors joined in a walk state, for a probe. */
const joined = (w, name, i, j) => meets(w[name].at[i], w[name].at[j]);

/** A prop's use: the sides whose strip is inside the floor and free of the other props, and whether the hull reaches one from a door. */
function useOf(prop, props, floor, grid, walk, nDoors) {
  if (!prop.use) return { ok: true, free: [], reached: true };
  const free = [];
  for (const side of prop.use.sides) {
    const strip = sideStrip(prop.foot, prop.facing, side, prop.use.depth);
    if (outsideBy(strip, floor) > 1e-3) continue;
    if (props.some((q) => q !== prop && q.collision && boxOverlap2(q.foot, strip) > EPS)) continue;
    free.push({ side, strip });
  }
  if (!free.length) return { ok: false, free, reached: false, why: "covered" };
  if (!nDoors) return { ok: true, free, reached: true };
  const doorLabels = new Set(walk.hull.at.flatMap((s) => [...s]));
  const reached = free.some((f) => meets(grid.labelsMeeting(walk.hull.fl, f.strip), doorLabels));
  return { ok: reached, free, reached, why: reached ? null : "unreached" };
}

/** The props a room's kind asks for, in order, counted by area and density; worn districts add junk. */
export function wantedProps(room, area, district) {
  const set = FURNISH[room.kind];
  if (!set) return [];
  const dens = DENSITY[district?.density] ?? 1;
  const out = [];
  for (const e of set) {
    let n = e.n;
    if (e.per) n = Math.max(n, Math.floor((area * dens) / e.per));
    if (e.max !== null) n = Math.min(n, e.max);
    for (let i = 0; i < n; i++) out.push({ kind: e.kind, near: e.near });
  }
  const zoneJunk = !["public", "secure"].includes(room.zone) && !["toilet", "kitchen", "bedroom"].includes(room.kind);
  if (zoneJunk) for (const k of WEAR_JUNK[district?.wear ?? 0] ?? []) out.push({ kind: k, near: false });
  return out;
}

/**
 * Dresses one room: its props placed one at a time, each the best candidate passing every rule (inside the floor,
 * against a wall or freestanding by the rule, clear of every keep-clear box and of the other props and their use
 * sides, the clutter cap, the walk). Returns { props, unplaced: [{ kind, why }], walk: { probe, ... }, covered }.
 */
export function dressRoom(b, room, { rules, boxes, district, seed, roomRules }) {
  const floor = roomFloor(room);
  const area = floorArea(floor, room);
  const fbox = floorBox(floor);
  const near = boxes.filter((bx) => boxOverlap2([bx.min[0], bx.min[1], bx.max[0], bx.max[1]], [fbox[0] - 0.01, fbox[1] - 0.01, fbox[2] + 0.01, fbox[3] + 0.01]) > -0.01); // prettier-ignore
  const doors = roomDoors(b, room, floor);
  const grid = new WalkGrid(fbox, (p) => inFloor(p, floor));
  const probes = { walk: walkCells(roomRules.walk), hull: hullCells(rules) };
  const base = walkOf(grid, doors, [], probes);
  const need = []; // [i, j, probe] the pairs the empty room joins, at the widest probe that joins them
  for (let i = 0; i < doors.length; i++)
    for (let j = i + 1; j < doors.length; j++) {
      if (joined(base, "walk", i, j)) need.push([i, j, "walk"]);
      else if (joined(base, "hull", i, j)) need.push([i, j, "hull"]);
    }
  const cap = roomRules.cap;
  const runs = wallRuns(floor);
  const rnd = rngOf(`${seed}:${room.id}`);
  const props = [];
  const unplaced = [];
  let covered = 0;
  const counts = {};
  const narrow = Math.min(...room.clear.map((r) => Math.min(r.w, r.d)));
  const fs = rules.placement.freestanding;
  const main = room.clear.reduce((m, q) => (q.w * q.d > m.w * m.d ? q : m), room.clear[0]);
  const walkOk = (list) => {
    const w = walkOf(grid, doors, list, probes);
    for (const [i, j, pr] of need) if (!joined(w, pr, i, j)) return { ok: false, why: "walk" };
    for (const p of list) if (!useOf(p, list, floor, grid, w, doors.length).ok) return { ok: false, why: "use" };
    return { ok: true };
  };
  for (const want of wantedProps({ ...room, zone: roomRules.zone }, area, district)) {
    const c = CATALOGUE[want.kind];
    const fp = c.w * c.d;
    if (c.collision && (covered + fp) / area > cap + 1e-9) {
      unplaced.push({ kind: want.kind, why: `the room's clutter cap (${Math.round(cap * 100)} %)` });
      continue;
    }
    const cands = [];
    // against a wall: its back on the face, facing in
    for (const run of runs) {
      const f = run.n;
      const [sx, sy] = worldSize(c, f);
      const along = c.w;
      if (run.len + 1e-6 < along) continue;
      const steps = Math.floor((run.len - along) / G + 1e-6);
      for (let k = 0; k <= steps; k++) {
        const t = k === steps ? run.len - along : k * G; // the last one flush with the run's end
        const s0 = [run.a[0] + run.u[0] * t, run.a[1] + run.u[1] * t];
        const s1 = [s0[0] + run.u[0] * along + f[0] * c.d, s0[1] + run.u[1] * along + f[1] * c.d];
        const foot = [Math.min(s0[0], s1[0]), Math.min(s0[1], s1[1]), Math.max(s0[0], s1[0]), Math.max(s0[1], s1[1])].map(r4);
        void sx, void sy;
        const corner = k === 0 || k === steps ? 1 : 0;
        cands.push({ foot, facing: f, rule: "against-wall", corner });
      }
    }
    // off the walls: only the rulebook's freestanding kinds, in a room wide enough; in its main rect, long side along it
    if (c.cls && fs.kinds.includes(c.cls) && narrow + 1e-6 >= fs.minRoomSide) {
      const f = main.w >= main.d ? [0, 1] : [1, 0];
      const [sx, sy] = worldSize(c, f);
      const m = 1.0;
      for (let x = main.x + m; x + sx <= main.x + main.w - m + 1e-6; x += 2 * G)
        for (let y = main.y + m; y + sy <= main.y + main.d - m + 1e-6; y += 2 * G) cands.push({ foot: [x, y, x + sx, y + sy].map(r4), facing: f, rule: "freestanding", corner: 0 }); // prettier-ignore
    }
    if (!c.wall && !c.cls) {
      // a loose thing (a barrel, a planter): against a wall too, as above (already listed)
    }
    // score: far from the doors (near for a counter), in a corner; a seeded jitter breaks ties
    const centre = [main.x + main.w / 2, main.y + main.d / 2];
    for (const cd of cands) {
      const m = [(cd.foot[0] + cd.foot[2]) / 2, (cd.foot[1] + cd.foot[3]) / 2];
      const dDoor = doors.length ? Math.min(...doors.map((d) => Math.hypot(m[0] - d.p[0], m[1] - d.p[1]))) : 0;
      // spread: away from the props already placed, unless it goes beside its partner (a stove by the worktop)
      const others = props.map((q) => Math.hypot(m[0] - (q.foot[0] + q.foot[2]) / 2, m[1] - (q.foot[1] + q.foot[3]) / 2));
      const spread = others.length ? Math.min(Math.min(...others), 6) * 0.6 : 0;
      const partner = PARTNER[want.kind];
      const beside = partner && props.some((q) => q.kind === partner && boxOverlap2(grow(q.foot, 0.05), cd.foot) > -1e-6 && boxOverlap2(grow(q.foot, 0.05), cd.foot) < 0.06) ? 6 : 0; // prettier-ignore
      // a table (no wall at its back) stands free where it may, else by a wall; a bench or a counter by a wall first
      if (cd.rule === "freestanding") cd.score = (c.cls === "table" ? 20 : -10) - Math.hypot(m[0] - centre[0], m[1] - centre[1]) * 0.5 + spread + rnd.next() * 0.5;
      else cd.score = (want.near ? -dDoor : Math.min(dDoor, 8)) + cd.corner * 1.5 + (partner ? beside : spread) + rnd.next() * 1.0;
    }
    cands.sort((p, q) => q.score - p.score || p.foot[0] - q.foot[0] || p.foot[1] - q.foot[1]);
    let placed = null;
    let lastWhy = "no wall long enough";
    let floods = 0;
    for (const cd of cands) {
      const box = box3Of(cd.foot, 0, c.h);
      if (outsideBy(cd.foot, floor) > 1e-3) {
        lastWhy = "the floor";
        continue;
      }
      if (props.some((q) => boxOverlap2(q.foot, cd.foot) > EPS)) {
        lastWhy = "another prop";
        continue;
      }
      if (near.some((bx) => box3Depth(box, bx) > EPS)) {
        lastWhy = "keep-clear volumes";
        continue;
      }
      const prop = { kind: want.kind, foot: cd.foot, facing: cd.facing, h: c.h, collision: c.collision, use: c.use, rule: cd.rule };
      const list = [...props, prop];
      // its use side free, and it covers no other prop's last free use side (cheap, before the flood)
      if (c.use && !c.use.sides.some((sd) => { const st = sideStrip(cd.foot, cd.facing, sd, c.use.depth); return outsideBy(st, floor) <= 1e-3 && !props.some((q) => q.collision && boxOverlap2(q.foot, st) > EPS); })) { // prettier-ignore
        lastWhy = "its use side";
        continue;
      }
      if (props.some((q) => q.use && !q.use.sides.some((sd) => { const st = sideStrip(q.foot, q.facing, sd, q.use.depth); return outsideBy(st, floor) <= 1e-3 && !list.some((o) => o !== q && o.collision && boxOverlap2(o.foot, st) > EPS); }))) { // prettier-ignore
        lastWhy = "another prop's use side";
        continue;
      }
      if (floods++ > 40) break;
      const w = walkOk(list);
      if (!w.ok) {
        lastWhy = w.why === "walk" ? "the walk between the doors" : "a use side's reach";
        continue;
      }
      placed = prop;
      break;
    }
    if (!placed) {
      unplaced.push({ kind: want.kind, why: lastWhy });
      continue;
    }
    counts[want.kind] = (counts[want.kind] ?? 0) + 1;
    placed.n = counts[want.kind];
    props.push(placed);
    if (c.collision) covered += fp;
  }
  return { props, unplaced, doors, need, probes, covered: r3(covered / area), area: r2(area), cap };
}

/** The walk and the cap a room is held to: its corridor width by zone, its clutter class's share. */
export function roomRulesOf(room, rules) {
  const kind = rules.roomKinds[room.kind] ?? {};
  const zone = kind.zone ?? "staff";
  const corr = rules.dimensions.corridors;
  const walk = Math.max(rules.placement.minWalkWidth, zone === "public" ? corr.public.width.min : corr.domestic.width.min);
  return { zone, walk, cap: rules.placement.maxCoveredShare[kind.clutter ?? "work"] ?? 0.3, clutter: kind.clutter ?? "work" };
}

// ── the dressing allowance and the props a room must keep (placement.dressing, placement.requiredProps) ──

/**
 * A room kind's dressing rule: its allowance in brushes (placement.dressing.maxBrushesBy, null when the kind keeps
 * its full dressing), the props it must hold (placement.requiredProps.byKind: groups, one prop of any kind in each)
 * and the trimming order's first groups (placement.dressing.trimFirst). A rulebook without them trims nothing.
 */
export function dressingRuleOf(kind, rules) {
  const d = rules.placement?.dressing;
  const max = d?.maxBrushesBy?.[kind];
  return { max: Number.isInteger(max) ? max : null, required: rules.placement?.requiredProps?.byKind?.[kind] ?? [], scatter: d?.trimFirst?.scatter ?? [], decor: d?.trimFirst?.decor ?? [] }; // prettier-ignore
}
/**
 * Which of a room's props (in the order they were placed) hold its required groups: for each group the first placed
 * prop of one of its kinds not already holding another group. Returns { used: Set of indices, missing: [groups] }.
 */
export function requiredOf(props, groups) {
  const used = new Set();
  const missing = [];
  for (const g of groups) {
    const i = props.findIndex((p, k) => !used.has(k) && g.includes(p.kind));
    if (i < 0) missing.push(g);
    else used.add(i);
  }
  return { used, missing };
}
/** The trimming ranks: 0 scatter, 1 decor, 2 a kind's second and later pieces, 3 any other prop. */
export const TRIM_RANKS = ["scatter", "decor", "duplicate", "other"];
/**
 * A dressed room's props trimmed to its allowance. Never moves a prop: the kept ones are the very objects placed, in
 * their order. Takes out (brush props only: a model costs no brush) by rank (TRIM_RANKS), the last placed first in a
 * rank, never one holding a required group, until the room's brushes are within `max`; then puts back what it took
 * out, the last taken out (the most defining) first, while it still fits, so no room is trimmed past its allowance.
 * Returns { kept, trimmed (each with its rank's name), max, before, after } (brushes before and after).
 */
export function trimRoom(props, rule) {
  const br = (p) => CATALOGUE[p.kind]?.brushes ?? 0;
  const before = props.reduce((s, p) => s + br(p), 0);
  if (rule.max === null || before <= rule.max) return { kept: props, trimmed: [], max: rule.max, before, after: before };
  const { used } = requiredOf(props, rule.required);
  const first = new Map();
  props.forEach((p, i) => first.has(p.kind) || first.set(p.kind, i));
  const rankOf = (p, i) => (rule.scatter.includes(p.kind) ? 0 : rule.decor.includes(p.kind) ? 1 : first.get(p.kind) !== i ? 2 : 3);
  const cands = props.map((p, i) => ({ p, i, rank: rankOf(p, i), b: br(p) })).filter((c) => !used.has(c.i) && c.b > 0);
  cands.sort((a, b) => a.rank - b.rank || b.i - a.i);
  let now = before;
  const out = [];
  for (const c of cands) {
    if (now <= rule.max) break;
    out.push(c);
    now -= c.b;
  }
  for (let k = out.length - 1; k >= 0; k--)
    if (now + out[k].b <= rule.max) {
      now += out[k].b;
      out.splice(k, 1);
    }
  const gone = new Set(out.map((c) => c.i));
  return {
    kept: props.filter((_, i) => !gone.has(i)),
    trimmed: out.sort((a, b) => a.i - b.i).map((c) => ({ ...c.p, rank: TRIM_RANKS[c.rank] })),
    max: rule.max,
    before,
    after: now,
  };
}

// ── fittings from stages 6 and 7, when they are there ──

/** The palette's and the wiring's artifacts among the inputs (06-*.json, 07-*.json), when those stages ran. */
const inputOf = (inputs, n) => Object.entries(inputs).find(([f]) => f.startsWith(`0${n}-`))?.[1] ?? null;
/**
 * The fittings stages 6 and 7 placed: 06's lamps (room lamps by room, street and plaza lamps by layer; cells) and
 * 07's switches in rooms (cells). null where the stage is not there.
 */
export function fittingsOf(inputs) {
  const pal = inputOf(inputs, 6);
  const wir = inputOf(inputs, 7);
  const site = inputs["01-site.json"];
  const out = { lights: null, streetLamps: null, switches: null, palette: !!pal, wiring: !!wir };
  if (pal && Array.isArray(pal.lamps)) {
    out.lights = new Map();
    out.streetLamps = [];
    const layerOf = (id) => site.ways.find((w) => w.id === id)?.layer ?? site.plazas.find((p) => p.id === id)?.layer ?? null;
    for (const l of pal.lamps) {
      const [kind, ref] = String(l.space ?? "").split(/:(.*)/s);
      if (kind === "room") (out.lights.get(ref) ?? out.lights.set(ref, []).get(ref)).push(l);
      else if (kind === "way" || kind === "plaza") out.streetLamps.push({ ...l, layer: layerOf(ref), ref });
    }
  }
  if (wir && Array.isArray(wir.switches)) {
    out.switches = new Map();
    for (const s of wir.switches) {
      const [kind, ref] = String(s.space ?? "").split(/:(.*)/s);
      if (kind === "room" && Array.isArray(s.at)) (out.switches.get(ref) ?? out.switches.set(ref, []).get(ref)).push(s);
    }
  }
  return out;
}

/** The switch spot of a room: by its entrance door, on the latch side, on this room's wall face at the typical height. */
export function switchSpot(b, room, floor, doors, rules) {
  return switchSpots(b, room, floor, doors, rules)[0] ?? null;
}
/** SWITCH_STEP: a second (third...) switch of a room goes this much further along the wall from the door, metres. */
export const SWITCH_STEP = 0.3;
/**
 * Every switch spot of a room in order of preference: on the wall beside its entrance door (the first door into it
 * that has a leaf), latch side first then hinge side, the first a door's half width + 0.25 m from its middle, the
 * next SWITCH_STEP further each (where a room carries several switches); on this room's wall face, at the
 * rulebook's typical height, facing into the room; never on another door's hole. Stage 7 wires its switches on
 * these, stage 8 keeps the first clear.
 */
export function switchSpots(b, room, floor, doors, rules) {
  const ent = doors.find((d) => d.door.to === room.id && d.door.kind !== "opening") ?? doors.find((d) => d.door.kind !== "opening") ?? doors[0];
  if (!ent) return [];
  const d = ent.door;
  const u = [-d.facing[1], d.facing[0]];
  const latch = d.hinge === "low" ? 1 : d.hinge === "high" ? -1 : 1;
  const size = [0.12, 0.12];
  const h = rules.keepClear.switch.mountHeight.typical;
  const out = [];
  for (let k = 0; k < 4; k++)
    for (const sgn of [latch, -latch]) {
      const along = d.width / 2 + 0.25 + k * SWITCH_STEP;
      const face = [d.at[0] + u[0] * sgn * along + ent.into[0] * (d.wall / 2), d.at[1] + u[1] * sgn * along + ent.into[1] * (d.wall / 2)];
      const inside = [face[0] + ent.into[0] * 0.3, face[1] + ent.into[1] * 0.3];
      if (!inFloor(inside, floor)) continue;
      // not on another door's hole
      const clash = b.doors.some((o) => o !== d && o.storey === d.storey && Math.hypot(o.at[0] - face[0], o.at[1] - face[1]) < o.width / 2 + 0.3);
      if (clash) continue;
      out.push({ kind: "switch", id: `${room.id}.switch${out.length ? `-${out.length + 1}` : ""}`, room: room.id, door: d.id, at: [r4(face[0]), r4(face[1]), h], facing: ent.into, size, floor: 0, placeholder: true }); // prettier-ignore
    }
  return out;
}
/** The light spot of a room: under its ceiling in the middle of its main rect (stage 6 sets the lamp). */
export function lightSpot(room) {
  const main = room.clear.reduce((m, q) => (q.w * q.d > m.w * m.d ? q : m), room.clear[0]);
  return { kind: "light", id: `${room.id}.light`, room: room.id, at: [r4(main.x + main.w / 2), r4(main.y + main.d / 2), r3(room.height_m - 0.1)], size: [0.4, 0.4, 0.2], placeholder: true }; // prettier-ignore
}

/** Half the side of the use space kept round a switch 07 placed with no facing: its use depth, whichever way it faces. */
export const SWITCH_RADIUS = 1.0;
/**
 * A building's reserved spots by storey (keepClearOf items, or raw boxes): 06's room lamps where 06 ran, else a
 * light spot under the ceiling of every room not kept clear; a switch spot by every room's entrance (latch side,
 * for stage 7 to wire); and round each switch 07 placed in a room a column SWITCH_RADIUS round, floor to its top.
 */
export function spotsOf(b, fit, rules, cell) {
  const spots = new Map();
  const lights = [];
  const switches = [];
  const o = b.frame.origin_cells;
  const zOf = new Map(b.storeys.map((st) => [st.storey, st.z_m]));
  const local = (at) => [r4((at[0] - o[0]) * cell), r4((at[1] - o[1]) * cell)];
  for (const room of b.rooms) {
    if (room.kind === "stairwell") continue;
    const floor = roomFloor(room);
    const doors = roomDoors(b, room, floor);
    const list = spots.get(room.storey) ?? spots.set(room.storey, []).get(room.storey);
    if (fit.lights) {
      for (const l of fit.lights.get(room.id) ?? []) list.push({ kind: "light", id: l.id, at: [...local(l.at), r3(l.z * cell - zOf.get(room.storey))], size: [0.4, 0.4, 0.2] }); // prettier-ignore
    } else if (!CLEAR_KINDS.includes(room.kind)) {
      const l = lightSpot(room);
      list.push(l);
      lights.push({ building: b.id, storey: room.storey, ...l });
    }
    const sw = switchSpot(b, room, floor, doors, rules);
    if (sw) {
      list.push(sw);
      switches.push({ building: b.id, storey: room.storey, ...sw });
    }
    for (const s of fit.switches?.get(room.id) ?? []) {
      const [x, y] = local(s.at);
      // 07's switch on its wall with its facing: its own keep-clear (in front of it, floor to its top)
      if (Array.isArray(s.facing)) {
        list.push({ kind: "switch", id: s.name, room: room.id, at: [x, y, r3((s.at[2] ?? 0) * cell - zOf.get(room.storey))], facing: s.facing, size: [0.12, 0.12], floor: 0 }); // prettier-ignore
        continue;
      }
      const top = Math.max(rules.keepClear.switch.mountHeight.max, (s.at[2] ?? 0) * cell - zOf.get(room.storey) + 0.3);
      list.push({ kind: "box", what: `switch ${s.name}'s use space (07)`, min: [r4(x - SWITCH_RADIUS), r4(y - SWITCH_RADIUS), 0], max: [r4(x + SWITCH_RADIUS), r4(y + SWITCH_RADIUS), r3(top)], id: s.name }); // prettier-ignore
    }
  }
  return { spots, lights, switches };
}

// ── the whole tile ──

const sizeOf = (p) => [r4(p.foot[2] - p.foot[0]), r4(p.foot[3] - p.foot[1]), p.h];
const atOf = (p) => [r4((p.foot[0] + p.foot[2]) / 2), r4((p.foot[1] + p.foot[3]) / 2), 0];

/**
 * Dresses the tile: every room of every building in 05, then the streets of every layer. `inputs`: the stage's
 * artifacts by file name; `rules` the rulebook in metres; `desc` the description. Returns the artifact's body.
 */
export function dressingOf({ desc, rules, inputs, seed = 1 }) {
  const plans = inputs["05-plans.json"];
  const programs = inputs["03-programs.json"];
  const net = inputs["04-network.json"];
  const site = inputs["01-site.json"];
  const cell = site.grid.cell;
  const fit = fittingsOf(inputs);
  const districts = new Map((desc.districts ?? []).map((d) => [d.id, d]));
  const bDistrict = new Map((programs?.buildings ?? []).map((x) => [x.id, x.district]));
  const lifts = new Map(net.connectors.filter((c) => c.type === "lift").map((c) => [c.id, { id: c.id, car: c.dims.car_m ?? [2.4, 2.4, 3] }]));
  const liftOf = (group) => group.split("+").map((id) => lifts.get(id)).find(Boolean) ?? null;
  const props = [];
  const rooms = [];
  const reserved = { switches: [], lights: [], signs: [] };
  for (const b of plans.buildings) {
    const district = districts.get(bDistrict.get(b.id)) ?? null;
    const zBase = b.lot.zBase;
    const origin = b.frame.origin_cells;
    // the reserved spots first: the switches and lights the walk and the props keep clear of
    const { spots, lights, switches } = spotsOf(b, fit, rules, cell);
    for (const l of lights) reserved.lights.push(l);
    for (const sw of switches) reserved.switches.push(sw);
    for (const st of b.storeys) {
      const s = st.storey;
      const boxes = storeyBoxes(b, s, rules, { liftOf, reserved: spots.get(s) ?? [] });
      for (const room of b.rooms.filter((r) => r.storey === s)) {
        const rr = roomRulesOf(room, rules);
        const rec = { building: b.id, room: room.id, kind: room.kind, storey: s, district: district?.id ?? null, clutter: rr.clutter, cap: rr.cap, walk_m: rr.walk }; // prettier-ignore
        if (CLEAR_KINDS.includes(room.kind) || !FURNISH[room.kind]) {
          rooms.push({ ...rec, dressed: false, why: FURNISH[room.kind] ? null : `${room.kind}: circulation, kept clear`, props: [], covered: 0 });
          continue;
        }
        const r = dressRoom(b, room, { rules, boxes, district, seed, roomRules: { ...rr, kind: room.kind } });
        // the room's dressing allowance (placement.dressing): props taken out after placing, the rest where they stood
        const trim = trimRoom(r.props, dressingRuleOf(room.kind, rules));
        const trimmed = trim.trimmed.map((p) => ({ id: `${room.id}.${p.kind}-${p.n}`, kind: p.kind, brushes: CATALOGUE[p.kind].brushes, rank: p.rank })); // prettier-ignore
        if (trimmed.length) {
          const fp = trim.kept.filter((p) => CATALOGUE[p.kind].collision).reduce((sum, p) => sum + CATALOGUE[p.kind].w * CATALOGUE[p.kind].d, 0);
          r.covered = r3(fp / floorArea(roomFloor(room), room));
        }
        const ids = [];
        for (const p of trim.kept) {
          const id = `${room.id}.${p.kind}-${p.n}`;
          ids.push(id);
          const at = atOf(p);
          const c = CATALOGUE[p.kind];
          props.push({
            id, kind: p.kind, model: c.model, build: c.build, place: "room", layer: b.layer, building: b.id, room: room.id, storey: s, rule: p.rule,
            at_m: at, size_m: sizeOf(p), facing: p.facing, wall: c.wall, collision: c.collision, use: c.use,
            cells: [r3(origin[0] + at[0] / cell), r3(origin[1] + at[1] / cell)], z: r3(st.z_m / cell),
            rect: { x: r3(origin[0] + p.foot[0] / cell), y: r3(origin[1] + p.foot[1] / cell), w: r3((p.foot[2] - p.foot[0]) / cell), d: r3((p.foot[3] - p.foot[1]) / cell) },
          }); // prettier-ignore
        }
        rooms.push({ ...rec, dressed: true, area_m2: r.area, covered: r.covered, doors: r.doors.length, walkPairs: r.need.map(([i, j, pr]) => [r.doors[i].door.id, r.doors[j].door.id, pr]), props: ids, unplaced: r.unplaced, ...(trim.max !== null ? { allowance: { max: trim.max, placed: trim.before, kept: trim.after }, trimmed } : {}) }); // prettier-ignore
        void zBase;
      }
    }
  }
  const street = dressStreets({ desc, rules, inputs, seed, fit, reserved });
  props.push(...street.props);
  // the tile's model props within its cap: past it, the models a room needs least go first (MODEL_DROP order, the
  // last placed of a kind first); each taken out is noted as unplaced in its room
  const tile = site.tile?.id ?? plans.tile ?? null;
  const wir = inputOf(inputs, 7);
  const others = wir?.entities ? wir.entities.total - (wir.entities.props ?? 0) : 0;
  const capOf = modelPropCap(desc, rules, tile, others);
  const dropped = [];
  for (const kind of MODEL_DROP) {
    let over = props.filter((p) => p.build === "model").length - capOf.cap;
    for (let i = props.length - 1; i >= 0 && over > 0; i--) {
      if (props[i].kind !== kind) continue;
      const [p] = props.splice(i, 1);
      dropped.push(p.id);
      over--;
      const rr = rooms.find((r) => r.room === p.room && p.place === "room");
      if (rr) {
        rr.props = rr.props.filter((id) => id !== p.id);
        rr.unplaced.push({ kind: p.kind, why: `the tile's model-prop cap (${capOf.cap})` });
      }
      const sa = street.areas.find((a) => p.place === "street" && a.layer === p.layer && a.district === p.district);
      if (sa && p.kind !== "lamp-post") sa.props = Math.max(0, sa.props - 1);
    }
  }
  const models = { cap: capOf.cap, byCity: capOf.byCity, entityRoom: capOf.room, limit: capOf.limit, wiringEntities: others, placed: props.filter((p) => p.build === "model").length, dropped }; // prettier-ignore
  const brushes = brushBudgetOf(desc, tile, props, rooms);
  return { props, rooms, streets: street.areas, hungLamps: street.hungLamps, wallLamps: street.wallLamps, reserved, measures: { ...measuresOf(props, rooms, street), modelProps: models, brushBudget: brushes } }; // prettier-ignore
}

function measuresOf(props, rooms, street) {
  const byKind = {};
  for (const p of props) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
  const sorted = Object.fromEntries(Object.entries(byKind).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
  const dressed = rooms.filter((r) => r.dressed);
  const cov = dressed.map((r) => r.covered).sort((a, b) => a - b);
  return {
    props: props.length,
    inRooms: props.filter((p) => p.place === "room").length,
    inStreets: props.filter((p) => p.place === "street").length,
    models: props.filter((p) => p.build === "model").length,
    brushes: props.filter((p) => p.build === "brush").length,
    byKind: sorted,
    rooms: rooms.length,
    roomsDressed: dressed.length,
    roomsKeptClear: rooms.length - dressed.length,
    roomsEmpty: dressed.filter((r) => r.props.length === 0).length,
    unplaced: dressed.reduce((s, r) => s + r.unplaced.length, 0),
    trimmed: { rooms: dressed.filter((r) => r.trimmed?.length).length, props: dressed.reduce((s, r) => s + (r.trimmed?.length ?? 0), 0), brushes: dressed.reduce((s, r) => s + (r.trimmed ?? []).reduce((t, x) => t + x.brushes, 0), 0), note: "props taken out of rooms past their dressing allowance (placement.dressing), after placing: the rest stand where they were placed" }, // prettier-ignore
    coveredShare: cov.length ? { median: cov[Math.floor(cov.length / 2)], max: cov[cov.length - 1] } : null,
    streetAreas: street.areas.map((a) => ({ layer: a.layer, district: a.district, floor_m2: a.floor_m2, props: a.props, per100: a.per100, cap: a.cap })),
  };
}

// ── streets ──

/** A layer's public floor on the plan grid (world metres): ways and plazas less what stands on them. */
export function streetWorld({ desc, inputs, layer }) {
  const site = inputs["01-site.json"];
  const lotsArt = inputs["02-lots.json"];
  const net = inputs["04-network.json"];
  const cell = site.grid.cell;
  const L = site.layers.find((x) => x.id === layer);
  const tb = site.tile.box;
  const M = (p) => [p[0] * cell, p[1] * cell];
  const ways = site.ways.filter((w) => w.layer === layer && w.class !== "service" && w.access === "public");
  const plazas = site.plazas.filter((p) => p.layer === layer);
  const segs = [];
  for (const w of ways) for (const part of w.parts) for (let i = 1; i < part.length; i++) segs.push({ w, a: M(part[i - 1]), b: M(part[i]) });
  const pBoxes = plazas.map((p) => ({ p, box: [p.box[0] * cell, p.box[1] * cell, p.box[2] * cell, p.box[3] * cell] }));
  const solidsBoxes = [];
  const solidPolys = [];
  for (const lot of lotsArt.lots) if (lot.layer === layer) solidsBoxes.push({ what: lot.kind === "enterable" ? `building ${lot.building}` : `facade ${lot.id}`, box: [lot.rect.x * cell, lot.rect.y * cell, (lot.rect.x + lot.rect.w) * cell, (lot.rect.y + lot.rect.d) * cell] }); // prettier-ignore
  const atWalk = (z) => z[0] < L.floor + 0.56 && z[1] > L.floor + 1e-6;
  for (const c of net.connectors)
    for (const p of c.pieces) {
      const solid = (p.kind !== "car" && p.kind !== "flight" && p.kind !== "landing") || c.form === "straight";
      if (solid && atWalk(p.z)) solidPolys.push({ what: `${c.id}'s ${p.kind}`, poly: p.poly.map(M) });
    }
  for (const k of net.checkpoints) if (k.layer === layer) for (const r of k.rooms) if (r.kind !== "gate") solidsBoxes.push({ what: `${k.id}'s ${r.kind}`, box: [r.rect.x * cell, r.rect.y * cell, (r.rect.x + r.rect.w) * cell, (r.rect.y + r.rect.d) * cell] }); // prettier-ignore
  for (const p of net.posts) if (p.layer === layer) solidsBoxes.push({ what: p.id, box: [p.rect.x * cell, p.rect.y * cell, (p.rect.x + p.rect.w) * cell, (p.rect.y + p.rect.d) * cell] }); // prettier-ignore
  // a square's monuments (their plinths) and the columns its colonnade or a way's porticoes keep (stage 4's)
  for (const p of plazas) for (const mo of p.monuments ?? []) solidsBoxes.push({ what: `monument ${mo.id}`, monument: true, box: [(mo.at[0] - mo.base[0] / 2) * cell, (mo.at[1] - mo.base[1] / 2) * cell, (mo.at[0] + mo.base[0] / 2) * cell, (mo.at[1] + mo.base[1] / 2) * cell] }); // prettier-ignore
  for (const col of net.colonnades ?? []) if (col.layer === layer) for (const c of col.columns) solidsBoxes.push({ what: `${col.ref ?? col.plaza}'s column`, column: true, box: [(c.at[0] - col.column / 2) * cell, (c.at[1] - col.column / 2) * cell, (c.at[0] + col.column / 2) * cell, (c.at[1] + col.column / 2) * cell] }); // prettier-ignore
  const bounds = [Math.max(tb[0], L.bounds[0]) * cell, Math.max(tb[1], L.bounds[1]) * cell, Math.min(tb[2], L.bounds[2]) * cell, Math.min(tb[3], L.bounds[3]) * cell]; // prettier-ignore
  const segDist = (p, a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const ownerAt = (p) => {
    if (!inRect(p, bounds, -1e-9)) return null;
    for (const s of solidsBoxes) if (inRect(p, s.box, -1e-9)) return null;
    for (const s of solidPolys) if (pointInPoly([p[0], p[1]], s.poly)) return null;
    for (const pb of pBoxes) if (inRect(p, pb.box, -1e-9)) return { kind: "plaza", id: pb.p.id };
    let best = null;
    for (const s of segs) {
      const d = segDist(p, s.a, s.b);
      if (d < (s.w.width * cell) / 2 && (!best || d < best.d)) best = { d, id: s.w.id };
    }
    return best ? { kind: "way", id: best.id } : null;
  };
  // the grid: the tile box at the plan grid; owners as an index
  const owners = [];
  const ownerIx = new Map();
  const own = new Int16Array(Math.ceil(((tb[2] - tb[0]) * cell) / G - 1e-6) * Math.ceil(((tb[3] - tb[1]) * cell) / G - 1e-6)).fill(-1);
  const grid = new WalkGrid([tb[0] * cell, tb[1] * cell, tb[2] * cell, tb[3] * cell], (p, i, j) => {
    const o = ownerAt(p);
    if (!o) return false;
    if (!ownerIx.has(o.id)) ownerIx.set(o.id, owners.push(o) - 1);
    own[j * Math.ceil(((tb[2] - tb[0]) * cell) / G - 1e-6) + i] = ownerIx.get(o.id);
    return true;
  });
  return { L, cell, ways, plazas, segs, pBoxes, solidsBoxes, solidPolys, grid, own, owners, segDist, ownerAt, M };
}

/** The no-prop zones of a layer's streets (world metres; z null: full height): carriageways, lanes, approaches, gates, portals, mouths, spawns. */
export function streetZones({ desc, rules, inputs, layer, W, fit, signs }) {
  const site = inputs["01-site.json"];
  const net = inputs["04-network.json"];
  const plans = inputs["05-plans.json"];
  const cell = W.cell;
  const M = W.M;
  const zones = [];
  const zL = W.L.floor * cell;
  const walkMin = rules.placement.minWalkWidth;
  const pubW = rules.dimensions.corridors.public.width.min;
  for (const s of W.segs) {
    const w = s.w;
    const wm = w.width * cell;
    const cw = (w.carriageway ?? 0) * cell;
    const side = Math.max(w.sidewalk ?? 0, w.portico ?? 0) * cell;
    if (w.vehicle && cw > 0) {
      zones.push({ what: `${w.class} ${w.id}'s carriageway`, poly: bandPoly(s.a, s.b, cw + 2 * KERB), z: null, kind: "carriageway" });
      // the walking lanes beside it: all but the kerb strip, where the strip leaves minWalkWidth; under a colonnade
      // (stage 1's: its shaft's outer face on the kerb) the strip is the pillar line, at least a shaft wide
      const shaft = w.colonnade?.columns?.length ? w.colonnade.column * cell : 0;
      const strip = Math.min(Math.max(KERB_STRIP, shaft), Math.max(0, side - KERB - walkMin));
      const inner = cw / 2 + KERB + strip;
      if (wm / 2 > inner + 1e-6) for (const sg of [1, -1]) zones.push({ what: `${w.class} ${w.id}'s ${w.portico ? "portico" : "sidewalk"} walking lane`, poly: offsetBand(s.a, s.b, sg * inner, sg * (wm / 2 + 0.05)), z: null, kind: "lane" }); // prettier-ignore
    } else {
      // no carriageway: a public corridor's width down the middle, props only by the building lines
      const lane = Math.max(pubW, wm - 2 * EDGE_STRIP);
      zones.push({ what: `${w.class} ${w.id}'s walking lane`, poly: bandPoly(s.a, s.b, Math.min(lane, wm + 0.1)), z: null, kind: "lane" });
    }
  }
  // a square's portico: its walk from the shopfronts to the strip along the columns kept clear (the colonnade's
  // own furniture strip, KERB_STRIP wide inside the column line, as a portico of a way keeps its kerb strip)
  for (const pb of W.pBoxes) {
    const P = pb.p.portico;
    if (!P) continue;
    const [b0, b1, b2, b3] = pb.p.box.map((v) => v * cell);
    const [l0, l1, l2, l3] = P.line.map((v) => v * cell);
    const k = KERB_STRIP;
    const lanes = [[b0, b1, b2, l1 - k], [b0, l3 + k, b2, b3], [b0, l1 - k, l0 - k, l3 + k], [l2 + k, l1 - k, b2, l3 + k]];
    for (const [x0, y0, x1, y1] of lanes) if (x1 - x0 > 1e-6 && y1 - y0 > 1e-6) zones.push({ what: `${pb.p.id}'s portico walking lane`, poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z: null, kind: "lane" }); // prettier-ignore
  }
  // a way's mouth into a plaza: its width, MOUTH into the plaza
  for (const w of W.ways)
    for (const part of w.parts)
      for (const [end, prev] of [[part[0], part[1]], [part[part.length - 1], part[part.length - 2]]]) {
        const pl = W.pBoxes.find((pb) => inRect(M(end), pb.box, 0.05 * cell));
        if (!pl || !prev) continue;
        const e = M(end);
        const p = M(prev);
        const L = Math.hypot(e[0] - p[0], e[1] - p[1]) || 1;
        const u = [(e[0] - p[0]) / L, (e[1] - p[1]) / L];
        zones.push({ what: `${w.id}'s mouth into ${pl.p.id}`, poly: bandPoly(e, [e[0] + u[0] * MOUTH, e[1] + u[1] * MOUTH], w.width * cell), z: null, kind: "mouth" }); // prettier-ignore
      }
  // portals: the way's width, PORTAL_DEPTH into the tile from the seam
  const tb = site.tile.box.map((v) => v * cell);
  for (const w of W.ways)
    for (const cap of w.caps ?? []) {
      const at = M(cap.at);
      const n = cap.edge === "s" ? [0, 1] : cap.edge === "n" ? [0, -1] : cap.edge === "w" ? [1, 0] : [-1, 0];
      zones.push({ what: `portal ${cap.portal ?? cap.at.join(",")} of ${w.id}`, poly: bandPoly(at, [at[0] + n[0] * PORTAL_DEPTH, at[1] + n[1] * PORTAL_DEPTH], w.width * cell), z: null, kind: "portal" }); // prettier-ignore
      void tb;
    }
  // connector exits' approaches and the gates (a cell round, as stage 4 keeps them clear of spawns)
  for (const c of net.connectors) for (const e of c.exits) if (e.layer === layer) zones.push({ what: `${c.id}'s exit approach at ${e.stop}`, poly: e.approach.map(M), z: null, kind: "exit" }); // prettier-ignore
  for (const k of net.checkpoints) if (k.layer === layer) for (const r of k.rooms) if (r.kind === "gate") zones.push({ what: `${k.id}'s gate`, poly: (r.poly ?? rectPolyOf(r.rect)).map(M), z: null, kind: "gate" }); // prettier-ignore
  // street doors: their keep-clear boxes (approach both sides, swing) from 05, in world metres
  const boxes = [];
  for (const b of plans.buildings) {
    if (b.layer !== layer) continue;
    const o = b.frame.origin_cells;
    for (const d of b.doors) {
      if (d.storey !== 0 || !(d.street || d.from === "street" || d.from === "outside" || d.to === "street")) continue;
      const at = [o[0] * cell + d.at[0], o[1] * cell + d.at[1], zL];
      for (const bx of keepClearOf({ kind: d.kind === "opening" ? "opening" : "door", id: d.id, at, facing: d.facing, width: d.width, height: d.height, wall: d.wall, swing: d.swing === "none" ? "none" : "front" }, rules)) boxes.push({ ...bx, hole: /'s opening$/.test(bx.what) }); // prettier-ignore
    }
  }
  for (const sp of net.spawns) if (sp.layer === layer) for (const bx of keepClearOf({ kind: "spawn", id: sp.id, at: [sp.at[0] * cell, sp.at[1] * cell, sp.z * cell] }, rules)) boxes.push({ ...bx, hole: false }); // prettier-ignore
  for (const sg of signs) for (const bx of keepClearOf(sg, rules)) boxes.push({ ...bx, hole: false });
  const lamps = (fit.streetLamps ?? []).filter((l) => l.layer === layer);
  for (const l of lamps) for (const bx of keepClearOf({ kind: "light", id: l.id, at: [l.at[0] * cell, l.at[1] * cell, l.z * cell], size: LAMP_FITTING }, rules)) boxes.push({ ...bx, hole: false, lamp: l.id }); // prettier-ignore
  return { zones: zones.map((z) => ({ ...z, box: polyBox(z.poly) })), boxes, lamps };
}
const rectPolyOf = (r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.d], [r.x, r.y + r.d]];
/** A band beside a segment, between offsets o0 and o1 (left positive). */
function offsetBand(a, b, o0, o1) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
  const P = (p, o) => [p[0] + n[0] * o, p[1] + n[1] * o];
  const pts = [P(a, o0), P(b, o0), P(b, o1), P(a, o1)];
  // keep it counter-clockwise
  const area = pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % 4][1] - pts[(i + 1) % 4][0] * p[1], 0);
  return area < 0 ? pts.reverse() : pts;
}
/** How deep a footprint enters a convex polygon (0: apart or touching): the deepest sample's distance to its edges. */
export function polyDepth(foot, poly) {
  const pb = polyBox(poly);
  if (boxOverlap2(foot, pb) <= EPS) return 0;
  let worst = 0;
  const edges = poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);
  for (const p of samples(foot, 0.1)) {
    if (!pointInPoly(p, poly)) continue;
    let d = Infinity;
    for (const [a, b] of edges) {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy || 1e-12;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      d = Math.min(d, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
    }
    worst = Math.max(worst, d);
  }
  return worst;
}

/** The sign spots over the street doors of businesses and public buildings: their face, read from the street. */
export function streetSigns(inputs, layer, rules) {
  const plans = inputs["05-plans.json"];
  const cell = inputs["01-site.json"].grid.cell;
  const out = [];
  for (const b of plans.buildings) {
    if (b.layer !== layer) continue;
    const o = b.frame.origin_cells;
    const zL = b.lot.zBase * cell;
    for (const d of b.doors) {
      if (d.storey !== 0 || !d.street || !["shop", "public"].includes(d.kind)) continue;
      const out_ = [-d.facing[0], -d.facing[1]]; // the street side (a street door's leaf swings in)
      const at = [r3(o[0] * cell + d.at[0] + out_[0] * (d.wall / 2 + 0.05)), r3(o[1] * cell + d.at[1] + out_[1] * (d.wall / 2 + 0.05)), r3(zL + d.height + 0.5)]; // prettier-ignore
      out.push({ kind: "sign", id: `${d.id}.sign`, building: b.id, door: d.id, at, facing: out_, size: [Math.min(2.4, d.width + 0.6), 0.6], placeholder: true }); // prettier-ignore
    }
  }
  void rules;
  return out;
}

// ── street lamps' mounts (stage 6 asks before it places a lamp, stage 8 builds what it was told) ──

/** How far a lamp may go to reach a facade face for a wall bracket, metres. */
export const BRACKET_REACH = 2.5;
/** How far a lamp may slide (along its way, round its plaza) to a legal post when no bracket is found, metres. */
export const LAMP_SLIDE = 4;
/**
 * Where each street or plaza lamp is fixed, by the rules stage 8 holds a street prop to: a post where a lamp post
 * may stand within LAMP_MOVE (the kerb strip of a sidewalk that keeps minWalkWidth, a plaza off its mouths, never a
 * walking lane, a carriageway, a door's approach, an exit, a gate, a spawn, a sign's reading space); else a wall
 * bracket on the nearest wall within BRACKET_REACH (a building or facade face, or the carve's wall at a way's edge:
 * whatever solid bounds the public floor, a connector's piece aside) with no door opening, door approach or sign
 * under the fitting; else a post within LAMP_SLIDE on any public floor (a short way's lamp may stand where it meets the next); else, on a way with a
 * portico (a covered walk), hung from the portico's vault (deliberate: `mount: "hung"`); else nothing (`mount:
 * null`, the caller's gate stops). A lamp stage 6 put under a square's portico (`portico: true`) is hung from its
 * vault first. `lamps`: { id, layer, ref (way or plaza id), kind, at (cells), z (cells), portico? }.
 * Returns id -> { mount, at (cells), facing?, moved_m, why }.
 */
export function lampMounts({ desc, rules, inputs, lamps }) {
  const site = inputs["01-site.json"];
  const cell = site.grid.cell;
  const out = new Map();
  for (const L of site.layers) {
    const mine = lamps.filter((l) => l.layer === L.id);
    if (!mine.length) continue;
    const W = streetWorld({ desc, inputs, layer: L.id });
    const signs = streetSigns(inputs, L.id, rules);
    const Z = streetZones({ desc, rules, inputs, layer: L.id, W, fit: { streetLamps: [] }, signs });
    const zL = L.floor * cell;
    const placed = [];
    const c = CATALOGUE["lamp-post"];
    const postAt = (p, h, own) => {
      const foot = footOf(p, [c.w, c.d]).map(r4);
      if (streetPropFaults({ foot, z0: zL, h }, { W, Z, placed, rules }).length) return null;
      const o = W.ownerAt(p);
      if (own && o?.id !== own) return null;
      return foot;
    };
    const ring = (R) => {
      const n = Math.round(R / G);
      const s = [];
      for (let di = -n; di <= n; di++) for (let dj = -n; dj <= n; dj++) if (Math.hypot(di, dj) * G <= R + 1e-9) s.push([di, dj, Math.hypot(di, dj)]);
      return s.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
    };
    const near = ring(LAMP_MOVE);
    const wide = ring(LAMP_SLIDE).filter((s) => s[2] * G > LAMP_MOVE + 1e-9);
    const lots = W.solidsBoxes.filter((s) => /^(building|facade) /.test(s.what));
    const inBounds = (q) => q[0] > W.grid.x0 + 1e-6 && q[1] > W.grid.y0 + 1e-6 && q[0] < W.grid.x0 + W.grid.nx * G - 1e-6 && q[1] < W.grid.y0 + W.grid.ny * G - 1e-6; // prettier-ignore
    const way = (id) => site.ways.find((w) => w.id === id) ?? null;
    for (const l of mine) {
      if (l.portico) {
        // under a square's portico: hung from its vault (deliberate), the walk under it kept clear
        out.set(l.id, { mount: "hung", at: l.at, moved_m: 0, why: `hung from the vault of ${l.ref}'s portico` });
        continue;
      }
      const at0 = [l.at[0] * cell, l.at[1] * cell];
      const zF = l.z * cell;
      const h = r3(zF - zL - LAMP_FITTING[2] / 2);
      const tryRing = (spots, own) => {
        for (const [di, dj, dd] of spots) {
          const p = snapPt([at0[0] + di * G, at0[1] + dj * G]);
          const foot = postAt(p, h, own);
          if (foot) return { p, foot, moved: r2(dd * G) };
        }
        return null;
      };
      const post = (got, why) => {
        placed.push({ kind: "lamp-post", foot: got.foot, collision: true });
        out.set(l.id, { mount: "post", at: [r3(got.p[0] / cell), r3(got.p[1] / cell)], moved_m: got.moved, why });
      };
      let got = tryRing(near, null);
      if (got) {
        post(got, `a post within ${LAMP_MOVE} m`);
        continue;
      }
      // a wall bracket on the nearest wall: the first solid a ray from the lamp meets (16 directions, BRACKET_REACH)
      let best = null;
      if (W.ownerAt(at0))
        for (let k = 0; k < 16; k++) {
          const dir = [Math.cos((k * Math.PI) / 8), Math.sin((k * Math.PI) / 8)];
          let hit = null;
          for (let t = 0.1; t <= BRACKET_REACH + 1e-9; t += 0.1) {
            const q = [at0[0] + dir[0] * t, at0[1] + dir[1] * t];
            if (!inBounds(q)) break;
            if (!W.ownerAt(q)) {
              hit = { q, t };
              break;
            }
          }
          if (!hit || (best && hit.t >= best.d)) continue;
          if (W.solidPolys.some((sp) => pointInPoly(hit.q, sp.poly))) continue; // a connector's piece: no wall for a lamp
          const f = [at0[0] + dir[0] * (hit.t - 0.05), at0[1] + dir[1] * (hit.t - 0.05)];
          const box = lots.find((sb) => inRect(hit.q, sb.box, 1e-9));
          let n;
          let what;
          if (box) {
            const [x0, y0, x1, y1] = box.box;
            const d4 = [[f[0] - x0, [-1, 0]], [x1 - f[0], [1, 0]], [f[1] - y0, [0, -1]], [y1 - f[1], [0, 1]]].map(([d, nn]) => [Math.abs(d), nn]); // prettier-ignore
            n = d4.sort((p, q) => p[0] - q[0])[0][1];
            what = `${box.what}'s face`;
          } else if (W.solidsBoxes.some((sb) => inRect(hit.q, sb.box, 1e-9))) continue; // a checkpoint room or a post
          else {
            // the carve's wall at the edge of the public floor: square to the nearest way, facing its middle
            let sb = null;
            for (const sg of W.segs) {
              const d = W.segDist(f, sg.a, sg.b);
              if (!sb || d < sb.d) sb = { d, sg };
            }
            if (!sb) continue;
            const { a, b } = sb.sg;
            const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            const nn = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
            const side = (f[0] - a[0]) * nn[0] + (f[1] - a[1]) * nn[1];
            n = side > 0 ? [-nn[0], -nn[1]] : nn;
            what = `the wall at ${sb.sg.w.id}'s edge`;
          }
          const at = [f[0] + n[0] * (LAMP_FITTING[0] / 2), f[1] + n[1] * (LAMP_FITTING[0] / 2)];
          const fit = { min: [at[0] - LAMP_FITTING[0] / 2, at[1] - LAMP_FITTING[1] / 2, zF - LAMP_FITTING[2] / 2], max: [at[0] + LAMP_FITTING[0] / 2, at[1] + LAMP_FITTING[1] / 2, zF + LAMP_FITTING[2] / 2] }; // prettier-ignore
          if (Z.boxes.some((bx) => !/spawn/.test(bx.what) && box3Depth(fit, bx) > 1e-3)) continue;
          best = { d: hit.t, at, n: n.map(r4), what };
        }
      if (best) {
        out.set(l.id, { mount: "bracket", at: [r3(best.at[0] / cell), r3(best.at[1] / cell)], facing: best.n, moved_m: r2(best.d), why: `a wall bracket on ${best.what}` }); // prettier-ignore
        continue;
      }
      got = tryRing(wide, null);
      if (got) {
        post(got, `a post ${got.moved} m from its spot (${l.ref}'s floor or the floor it meets)`);
        continue;
      }
      const w = way(l.ref);
      if (w && (w.portico ?? 0) > 0) out.set(l.id, { mount: "hung", at: l.at, moved_m: 0, why: `hung from the vault of ${w.id}'s portico (no post, no facade face within ${BRACKET_REACH} m)` }); // prettier-ignore
      else out.set(l.id, { mount: null, at: l.at, moved_m: 0, why: `no post within ${LAMP_SLIDE} m and no facade face within ${BRACKET_REACH} m` }); // prettier-ignore
    }
  }
  return out;
}

/** The street props of the tile: lamps (placeholders without 06), benches, bins, stalls, planters, debris; each checked as the gate checks it. */
export function dressStreets({ desc, rules, inputs, seed, fit, reserved }) {
  const site = inputs["01-site.json"];
  const cell = site.grid.cell;
  const districts = new Map((desc.districts ?? []).map((d) => [d.id, d]));
  const props = [];
  const areas = [];
  const hungLamps = [];
  const wallLamps = [];
  for (const L of site.layers) {
    const W = streetWorld({ desc, inputs, layer: L.id });
    const signs = streetSigns(inputs, L.id, rules);
    for (const s of signs) reserved.signs.push({ layer: L.id, ...s });
    const Z = streetZones({ desc, rules, inputs, layer: L.id, W, fit, signs });
    const zL = L.floor * cell;
    const rnd = rngOf(`${seed}:streets:${L.id}`);
    // the floor per district (from its ways' and plazas' owners)
    const districtOfOwner = (o) => (o.kind === "plaza" ? site.nodes.find((n) => n.id === o.id)?.district : site.ways.find((w) => w.id === o.id)?.district) ?? null; // prettier-ignore
    const floorBy = new Map();
    for (let k = 0; k < W.own.length; k++) if (W.grid.floor[k] && W.own[k] >= 0) { const d = districtOfOwner(W.owners[W.own[k]]); floorBy.set(d, (floorBy.get(d) ?? 0) + G * G); } // prettier-ignore
    if (!floorBy.size) continue;
    const market = (pid) => {
      const d = districts.get(site.nodes.find((n) => n.id === pid)?.district);
      return !!d && /bazaar|market/i.test(`${d.id} ${d.name} ${d.theme}`);
    };
    const capOf = (dId) => streetCap(desc, site, W, dId);
    const count = new Map();
    const placed = [];
    const hung = [];
    const debris = new Map();
    const check = (foot, h, lamp) => streetPropFaults({ foot, z0: zL, h, lamp }, { W, Z, placed, rules });
    const tryPlace = (kind, at, facing, rule, extra = {}) => {
      const c = CATALOGUE[kind];
      const size = worldSize(c, facing);
      const foot = footOf(at, size).map(r4);
      const h = extra.h ?? c.h;
      const faults = check(foot, h, extra.lamp);
      if (faults.length) return null;
      if (c.use) {
        const ok = c.use.sides.some((sd) => {
          const st = sideStrip(foot, facing, sd, c.use.depth);
          return outsideFloor(st, W) === 0 && !placed.some((q) => q.collision && boxOverlap2(q.foot, st) > EPS) && !Z.zones.some((z) => (z.kind === "carriageway" || z.kind === "exit" || z.kind === "gate") && polyDepth(st, z.poly) > EPS); // prettier-ignore
        });
        if (!ok) return null;
      }
      // nobody's use side covered
      if (placed.some((q) => q.use && boxOverlap2(foot, sideStrip(q.foot, q.facing, "front", q.use.depth)) > EPS)) return null;
      const o = W.ownerAt([at[0], at[1]]);
      const dId = o ? districtOfOwner(o) : null;
      const cap = capOf(dId);
      const fl = floorBy.get(dId) ?? 0;
      const n = count.get(dId) ?? 0;
      const clutter = kind !== "lamp-post"; // a lamp's post is a fitting, not clutter
      if (clutter && ((n + 1) / Math.max(fl, 1)) * 100 > cap + 1e-9) return null;
      // within the cap, the wear part is the debris's own and the rest the furniture's: neither crowds out the other
      const deb = rule === "debris";
      const dn = debris.get(dId) ?? 0;
      const wearPart = WEAR_CAP[districts.get(dId)?.wear ?? 0] ?? 0;
      if (clutter && deb && ((dn + 1) / Math.max(fl, 1)) * 100 > wearPart + 1e-9) return null;
      if (clutter && !deb && ((n - dn + 1) / Math.max(fl, 1)) * 100 > cap - wearPart + 1e-9) return null;
      const p = { kind, foot, facing, h, collision: c.collision, use: c.use, rule, district: dId, on: o?.id ?? null, lamp: extra.lamp ?? null, moved: extra.moved ?? null }; // prettier-ignore
      placed.push(p);
      if (clutter) count.set(dId, n + 1);
      if (clutter && deb) debris.set(dId, dn + 1);
      return p;
    };
    // 1. lamps: a post under each of 06's street and plaza lamps (moved at most LAMP_MOVE to a legal spot, else
    //    its fitting hangs: no post); without 06, placeholder posts at the kerb strip and round the plazas
    for (const l of Z.lamps) {
      // 06 fixed it to a wall bracket or hung it under a portico's vault: no post (a bracket is no hanging lamp)
      if (l.mount === "bracket") {
        wallLamps.push({ layer: L.id, lamp: l.id, facing: l.facing ?? null });
        continue;
      }
      if (l.mount === "hung") {
        hung.push({ id: l.id, why: l.why ?? "hung (06)", deliberate: true });
        continue;
      }
      const at0 = [l.at[0] * cell, l.at[1] * cell];
      const h = r3(l.z * cell - zL - LAMP_FITTING[2] / 2);
      const spots = [];
      const R = Math.round(LAMP_MOVE / G);
      for (let di = -R; di <= R; di++) for (let dj = -R; dj <= R; dj++) if (Math.hypot(di, dj) * G <= LAMP_MOVE + 1e-9) spots.push([di, dj, Math.hypot(di, dj)]);
      spots.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
      let got = null;
      for (const [di, dj, dd] of spots) {
        got = tryPlace("lamp-post", snapPt([at0[0] + di * G, at0[1] + dj * G]), [0, 1], l.kind === "plaza" ? "plaza-lamp" : "kerb-lamp", { h, lamp: l.id, moved: r2(dd * G) }); // prettier-ignore
        if (got) break;
      }
      if (!got) hung.push({ id: l.id, why: `no legal spot for its post within ${LAMP_MOVE} m: its fitting would hang (06 should have given it a bracket)`, deliberate: false }); // prettier-ignore
    }
    if (!Z.lamps.length && !fit.streetLamps) {
      for (const w of W.ways) {
        const d = districts.get(w.district);
        const sp = LAMP_SPACING[d?.wealth] ?? 20;
        const cw = (w.carriageway ?? 0) * cell;
        const side = Math.max(w.sidewalk ?? 0, w.portico ?? 0) * cell;
        const strip = w.vehicle && cw > 0 ? Math.min(KERB_STRIP, Math.max(0, side - KERB - rules.placement.minWalkWidth)) : 0;
        const off = w.vehicle && cw > 0 ? cw / 2 + KERB + strip / 2 : (w.width * cell) / 2 - CATALOGUE["lamp-post"].d / 2 - 0.05;
        if (w.vehicle && cw > 0 && strip < CATALOGUE["lamp-post"].d) continue; // too narrow a sidewalk: a wall lamp (stage 6)
        alongWay(W, w, sp, (p, n, k) => {
          const sg = k % 2 ? 1 : -1;
          tryPlace("lamp-post", snapPt([p[0] + n[0] * sg * off, p[1] + n[1] * sg * off]), axisOf([-n[0] * sg, -n[1] * sg]), "kerb-lamp");
        });
      }
      for (const pb of W.pBoxes) {
        const [x0, y0, x1, y1] = pb.box;
        const sp = LAMP_SPACING[districts.get(site.nodes.find((n) => n.id === pb.p.id)?.district)?.wealth] ?? 20;
        for (let x = x0 + 1.2; x <= x1 - 1.2; x += sp) for (const y of [y0 + 1.2, y1 - 1.2]) tryPlace("lamp-post", snapPt([x, y]), [0, y < (y0 + y1) / 2 ? 1 : -1], "plaza-lamp"); // prettier-ignore
        for (let y = y0 + 1.2 + sp; y <= y1 - 1.2 - sp / 2; y += sp) for (const x of [x0 + 1.2, x1 - 1.2]) tryPlace("lamp-post", snapPt([x, y]), [x < (x0 + x1) / 2 ? 1 : -1, 0], "plaza-lamp"); // prettier-ignore
      }
    }
    // 2. stalls in a market's plazas: rows along its long side, aisles between
    for (const pb of W.pBoxes) {
      if (!market(pb.p.id)) continue;
      const [x0, y0, x1, y1] = pb.box;
      const c = CATALOGUE["market-stall"];
      const pitchX = c.w + 1.2;
      const pitchY = c.d + c.use.depth + 3.0;
      for (let y = y0 + 4; y + c.d <= y1 - 4; y += pitchY)
        for (let x = x0 + 4 + c.w / 2; x + c.w / 2 <= x1 - 4; x += pitchX) tryPlace("market-stall", snapPt([x, y + c.d / 2]), [0, -1], "stall-row");
    }
    // 3. benches (and a bin beside each) on the plazas' edges and on wide kerbs; planters where wealth is high
    for (const pb of W.pBoxes) {
      const [x0, y0, x1, y1] = pb.box;
      const d = districts.get(site.nodes.find((n) => n.id === pb.p.id)?.district);
      const edgeCands = [];
      for (let x = x0 + 3; x <= x1 - 3; x += 6) edgeCands.push([[x, y0 + 0.5], [0, 1]], [[x, y1 - 0.5], [0, -1]]);
      for (let y = y0 + 3; y <= y1 - 3; y += 6) edgeCands.push([[x0 + 0.5, y], [1, 0]], [[x1 - 0.5, y], [-1, 0]]);
      // and round what stands on the plaza (a building on its own plaza: the Nexus in its forum)
      for (const s of W.solidsBoxes) {
        const b = s.box;
        if (boxOverlap2(b, pb.box) <= 0) continue;
        for (let x = b[0] + 2; x <= b[2] - 2; x += 6) edgeCands.push([[x, b[1] - 0.5], [0, -1]], [[x, b[3] + 0.5], [0, 1]]);
        for (let y = b[1] + 2; y <= b[3] - 2; y += 6) edgeCands.push([[b[0] - 0.5, y], [-1, 0]], [[b[2] + 0.5, y], [1, 0]]);
      }
      for (const [p0, f] of rnd.shuffle(edgeCands)) {
        const bc = CATALOGUE["street-bench"];
        const at = snapPt([p0[0] + f[0] * (bc.d / 2 - 0.5 + 0.2), p0[1] + f[1] * (bc.d / 2 - 0.5 + 0.2)]);
        const kind = (d?.wear ?? 0) === 0 && rnd.chance(0.35) ? "planter-large" : "street-bench";
        const got = tryPlace(kind, kind === "planter-large" ? snapPt([p0[0] + f[0] * 0.5, p0[1] + f[1] * 0.5]) : at, f, "plaza-edge");
        if (got && kind === "street-bench") {
          const u = [-f[1], f[0]];
          const off = bc.w / 2 + 0.3 + CATALOGUE.bin.w / 2;
          tryPlace("bin", snapPt([got.foot[0] / 2 + got.foot[2] / 2 + u[0] * off, got.foot[1] / 2 + got.foot[3] / 2 + u[1] * off]), f, "beside-bench") ?? tryPlace("bin", snapPt([(got.foot[0] + got.foot[2]) / 2 - u[0] * off, (got.foot[1] + got.foot[3]) / 2 - u[1] * off]), f, "beside-bench"); // prettier-ignore
        }
      }
    }
    for (const w of W.ways) {
      const cw = (w.carriageway ?? 0) * cell;
      const side = Math.max(w.sidewalk ?? 0, w.portico ?? 0) * cell;
      if (!(w.vehicle && cw > 0)) continue;
      const strip = Math.min(KERB_STRIP, Math.max(0, side - KERB - rules.placement.minWalkWidth));
      if (strip < CATALOGUE["street-bench"].d) continue;
      const off = cw / 2 + KERB + CATALOGUE["street-bench"].d / 2;
      alongWay(W, w, 24, (p, n, k) => {
        const sg = k % 2 ? -1 : 1;
        const f = axisOf([n[0] * sg, n[1] * sg]); // facing away from the carriageway, onto the walk
        tryPlace("street-bench", snapPt([p[0] + n[0] * sg * off, p[1] + n[1] * sg * off]), f, "kerb-bench");
      }, 12);
    }
    // 4. debris by wear: along the building lines of ways with no carriageway, and the plazas' edges
    for (const w of W.ways) {
      const d = districts.get(w.district);
      const wear = d?.wear ?? 0;
      if (wear < 1) continue;
      const kinds = wear >= 3 ? ["crate", "barrel", "rubble", "trash-scatter", "crate-stack"] : wear === 2 ? ["crate", "barrel", "trash-scatter"] : ["crate", "barrel"]; // prettier-ignore
      const sp = wear >= 3 ? 7 : wear === 2 ? 10 : 16;
      const novehicle = !(w.vehicle && (w.carriageway ?? 0) > 0);
      alongWay(W, w, sp, (p, n, k) => {
        const kind = kinds[(k + Math.floor(rnd.next() * kinds.length)) % kinds.length];
        const c = CATALOGUE[kind];
        const sg = rnd.chance(0.5) ? 1 : -1;
        const off = novehicle ? (w.width * cell) / 2 - c.d / 2 - 0.1 : (w.width * cell) / 2 - c.d / 2 - 0.1;
        tryPlace(kind, snapPt([p[0] + n[0] * sg * off, p[1] + n[1] * sg * off]), axisOf([-n[0] * sg, -n[1] * sg]), "debris");
      }, sp / 2);
    }
    for (const pb of W.pBoxes) {
      const d = districts.get(site.nodes.find((n) => n.id === pb.p.id)?.district);
      const wear = d?.wear ?? 0;
      if (wear < 1) continue;
      const [x0, y0, x1, y1] = pb.box;
      const kinds = wear >= 3 ? ["crate", "barrel", "rubble", "trash-scatter"] : ["crate", "barrel", "trash-scatter"];
      const n = Math.round((((x1 - x0) * (y1 - y0)) / 100) * (WEAR_CAP[wear] ?? 0) * 0.8);
      for (let i = 0; i < n * 3 && i < 200; i++) {
        const side = rnd.int(4);
        const t = rnd.next();
        const kind = rnd.pick(kinds);
        const c = CATALOGUE[kind];
        const f = [[0, 1], [0, -1], [1, 0], [-1, 0]][side];
        const at = side === 0 ? [x0 + t * (x1 - x0), y0 + c.d / 2 + 0.1] : side === 1 ? [x0 + t * (x1 - x0), y1 - c.d / 2 - 0.1] : side === 2 ? [x0 + c.d / 2 + 0.1, y0 + t * (y1 - y0)] : [x1 - c.d / 2 - 0.1, y0 + t * (y1 - y0)]; // prettier-ignore
        tryPlace(kind, snapPt(at), f, "debris");
      }
    }
    // 5. the walk: every street door, exit and portal joined as before (a public corridor's width, else the hull);
    //    a prop that cuts it is taken out again, last placed first
    const ent = streetEntries({ inputs, layer: L.id, W });
    const probes = { walk: walkCells(rules.dimensions.corridors.public.width.min), hull: hullCells(rules) };
    const base = streetWalk(W, ent, [], probes);
    const need = pairsOf(base, ent.length);
    let state = streetWalk(W, ent, placed, probes);
    let broken = need.filter(([i, j, pr]) => !meets(state[pr].at[i], state[pr].at[j]));
    let guard = 0;
    while ((broken.length || unreachedUse(W, ent, placed, state).length) && placed.length && guard++ < 200) {
      // take out the prop nearest a broken pair's entries, or the unreached one
      const un = unreachedUse(W, ent, placed, state);
      let victim = un[0];
      if (!victim) {
        const [i, j] = broken[0];
        const mid = [(ent[i].p[0] + ent[j].p[0]) / 2, (ent[i].p[1] + ent[j].p[1]) / 2];
        victim = placed.filter((q) => q.collision).reduce((m, q) => (dist2(q.foot, mid) < dist2(m.foot, mid) ? q : m), placed.filter((q) => q.collision)[0]); // prettier-ignore
      }
      placed.splice(placed.indexOf(victim), 1);
      if (victim.kind !== "lamp-post") count.set(victim.district, (count.get(victim.district) ?? 1) - 1);
      if (victim.rule === "debris") debris.set(victim.district, (debris.get(victim.district) ?? 1) - 1);
      state = streetWalk(W, ent, placed, probes);
      broken = need.filter(([i, j, pr]) => !meets(state[pr].at[i], state[pr].at[j]));
    }
    const counts = {};
    for (const p of placed) {
      counts[p.kind] = (counts[p.kind] ?? 0) + 1;
      const at = [(p.foot[0] + p.foot[2]) / 2, (p.foot[1] + p.foot[3]) / 2];
      const c = CATALOGUE[p.kind];
      props.push({
        id: `${L.id}.${p.on ?? "street"}.${p.kind}-${counts[p.kind]}`, kind: p.kind, model: c.model, build: c.build, place: "street", layer: L.id, district: p.district, on: p.on, rule: p.rule,
        at: [r3(at[0] / cell), r3(at[1] / cell)], at_m: [r4(at[0]), r4(at[1]), r3(zL)], z: r3(L.floor), rect: { x: r3(p.foot[0] / cell), y: r3(p.foot[1] / cell), w: r3((p.foot[2] - p.foot[0]) / cell), d: r3((p.foot[3] - p.foot[1]) / cell) }, size_m: sizeOf(p), facing: p.facing, wall: c.wall, collision: c.collision, use: c.use, ...(p.kind === "lamp-post" ? (p.lamp ? { lamp: p.lamp, moved_m: p.moved } : { placeholder: true }) : {}),
      }); // prettier-ignore
    }
    for (const [dId, fl] of [...floorBy.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
      const n = placed.filter((p) => p.district === dId && p.kind !== "lamp-post").length;
      const covered = placed.filter((p) => p.district === dId && p.collision).reduce((s, p) => s + (p.foot[2] - p.foot[0]) * (p.foot[3] - p.foot[1]), 0); // prettier-ignore
      areas.push({ layer: L.id, district: dId, floor_m2: r2(fl), props: n, per100: r3((n / fl) * 100), cap: capOf(dId), covered: r3(covered / fl) }); // prettier-ignore
    }
    for (const h of hung) hungLamps.push({ layer: L.id, lamp: h.id, why: h.why, deliberate: h.deliberate });
  }
  return { props, areas, hungLamps, wallLamps };
}
const dist2 = (foot, p) => Math.hypot((foot[0] + foot[2]) / 2 - p[0], (foot[1] + foot[3]) / 2 - p[1]);
const snapPt = (p) => [r4(Math.round(p[0] / G) * G), r4(Math.round(p[1] / G) * G)];
const axisOf = (v) => (Math.abs(v[0]) >= Math.abs(v[1]) ? [Math.sign(v[0]) || 1, 0] : [0, Math.sign(v[1]) || 1]);
/** Stations along a way's centre line inside the floor's bounds, every `step` metres from `start`: fn(point, left normal, index). */
function alongWay(W, w, step, fn, start = step / 2) {
  let k = 0;
  for (const part of w.parts) {
    const pts = part.map(W.M);
    let carry = start;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-6) continue;
      const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      const n = [-u[1], u[0]];
      for (let t = carry; t <= L; t += step) fn([a[0] + u[0] * t, a[1] + u[1] * t], n, k++);
      carry = ((carry - L) % step + step) % step;
    }
  }
}
/** How far a footprint leaves the public floor (0 on it): a cell under it that is not floor. */
function outsideFloor(foot, W) {
  const g = W.grid;
  const i0 = Math.floor((foot[0] - g.x0) / G + 1e-6);
  const i1 = Math.ceil((foot[2] - g.x0) / G - 1e-6) - 1;
  const j0 = Math.floor((foot[1] - g.y0) / G + 1e-6);
  const j1 = Math.ceil((foot[3] - g.y0) / G - 1e-6) - 1;
  let bad = 0;
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      if (i < 0 || j < 0 || i >= g.nx || j >= g.ny || !g.floor[j * g.nx + i]) {
        const c = [g.x0 + (i + 0.5) * G, g.y0 + (j + 0.5) * G];
        const d = Math.max(foot[0] - c[0], c[0] - foot[2], foot[1] - c[1], c[1] - foot[3], 0);
        bad = Math.max(bad, G / 2 - d);
      }
    }
  return r3(bad);
}
/** Every rule a street prop must keep: { what, by } for each it breaks. */
export function streetPropFaults(p, { W, Z, placed = [], rules }) {
  const out = [];
  const off = outsideFloor(p.foot, W);
  if (off > 0) out.push({ what: "the public floor (it stands off it)", by: off });
  for (const z of Z.zones) {
    if (boxOverlap2(z.box, p.foot) <= EPS) continue;
    const d = polyDepth(p.foot, z.poly);
    if (d > 1e-3) out.push({ what: z.what, by: r3(d) });
  }
  const box = box3Of(p.foot, p.z0, p.h);
  for (const bx of Z.boxes) {
    if (p.lamp && bx.lamp === p.lamp) continue; // a post under its own fitting
    const d = box3Depth(box, bx);
    if (d > 1e-3) out.push({ what: bx.what, by: r3(d) });
  }
  for (const q of placed) {
    if (q === p.self) continue;
    const d = boxOverlap2(q.foot, p.foot);
    if (d > EPS) out.push({ what: `prop ${q.id ?? q.kind}`, by: r3(d), prop: true });
  }
  void rules;
  return out;
}
/** Where the street walk starts: street doors (outside them), connector exits, portals. */
export function streetEntries({ inputs, layer, W }) {
  const site = inputs["01-site.json"];
  const net = inputs["04-network.json"];
  const plans = inputs["05-plans.json"];
  const cell = W.cell;
  const out = [];
  for (const b of plans.buildings) {
    if (b.layer !== layer) continue;
    const o = b.frame.origin_cells;
    for (const d of b.doors) {
      if (d.storey !== 0 || !d.street) continue;
      const off = d.wall / 2 + 0.6;
      out.push({ what: `street door ${d.id}`, p: [o[0] * cell + d.at[0] - d.facing[0] * off, o[1] * cell + d.at[1] - d.facing[1] * off] });
    }
  }
  for (const c of net.connectors)
    for (const e of c.exits) {
      if (e.layer !== layer) continue;
      const pc = e.approach.reduce((s, q) => [s[0] + q[0] / e.approach.length, s[1] + q[1] / e.approach.length], [0, 0]);
      out.push({ what: `${c.id}'s exit at ${e.stop}`, p: [pc[0] * cell, pc[1] * cell] });
    }
  for (const w of site.ways)
    for (const cap of w.caps ?? []) {
      if (w.layer !== layer || w.class === "service" || w.access !== "public") continue;
      const n = cap.edge === "s" ? [0, 1] : cap.edge === "n" ? [0, -1] : cap.edge === "w" ? [1, 0] : [-1, 0];
      out.push({ what: `portal ${cap.portal ?? "?"} of ${w.id}`, p: [cap.at[0] * cell + n[0] * 1.0, cap.at[1] * cell + n[1] * 1.0] });
    }
  return out;
}
/** The street walk: per probe, the components each entry stands in (or comes within a metre of), and the hull's flood. */
export function streetWalk(W, ent, props, probes) {
  const blocked = W.grid.blocked(props.filter((p) => p.collision).map((p) => p.foot));
  const out = {};
  for (const [name, n] of Object.entries(probes)) {
    const fl = W.grid.flood(blocked, n);
    out[name] = { fl, at: ent.map((e) => W.grid.labelsAt(fl, e.p, 1.0)) };
  }
  return out;
}
function pairsOf(base, n) {
  const need = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (meets(base.walk.at[i], base.walk.at[j])) need.push([i, j, "walk"]);
      else if (meets(base.hull.at[i], base.hull.at[j])) need.push([i, j, "hull"]);
    }
  return need;
}
/** Street props whose use side the hull does not reach from any entry. */
function unreachedUse(W, ent, props, state) {
  const labels = new Set(state.hull.at.flatMap((s) => [...s]));
  const out = [];
  for (const p of props) {
    if (!p.use) continue;
    const ok = p.use.sides.some((sd) => meets(W.grid.labelsMeeting(state.hull.fl, sideStrip(p.foot, p.facing, sd, p.use.depth)), labels));
    if (!ok) out.push(p);
  }
  return out;
}
export const _internal = { sideStrip, boxOverlap2, box3Depth, box3Of, inFloor, pairsOf, unreachedUse, outsideFloor, walkOf, useOf, meets, worldSize };

// ── the gate ──

const m = (v) => `${r2(v)} m`;
const pct = (v) => `${Math.round(v * 1000) / 10} %`;
/** A room prop's footprint from the artifact. */
const footOfProp = (p) => footOf(p.at_m, p.size_m).map(r4);
const onEdge = (q, floor) => floor.some((r) => inRect(q, r) && (near(q[0], r[0]) || near(q[0], r[2]) || near(q[1], r[1]) || near(q[1], r[3])));

/**
 * Stage 8's gate on an artifact (its props, rooms and streets) with the stage's inputs: every sentence names the
 * prop and the thing it breaks with the distance. Holds: every prop of a kind with a rule; inside its room (or on
 * the public floor); against a wall or freestanding by the rule; in no keep-clear volume; across no opening; on
 * no other prop; every room's doors joined after dressing as the empty room joined them (the walk width, else the
 * hull; the props cutting it named); every use side free and reached by the hull; the clutter caps.
 */
export function checkDressing(artifact, { desc, rules, inputs }) {
  const failures = [];
  const notes = [];
  const plans = inputs["05-plans.json"];
  const net = inputs["04-network.json"];
  const site = inputs["01-site.json"];
  const cell = site.grid.cell;
  const fit = fittingsOf(inputs);
  const lifts = new Map(net.connectors.filter((c) => c.type === "lift").map((c) => [c.id, { id: c.id, car: c.dims.car_m ?? [2.4, 2.4, 3] }]));
  const liftOf = (group) => group.split("+").map((id) => lifts.get(id)).find(Boolean) ?? null;
  const fs = rules.placement.freestanding;
  const say = (p) => `prop ${p.id} (${p.kind})`;
  const byRoom = new Map();
  for (const p of artifact.props) {
    if (!CATALOGUE[p.kind]) {
      failures.push(`${say(p)}: no rule places a ${p.kind} (${rules.placement.unplaced})`);
      continue;
    }
    if (p.place === "room") (byRoom.get(p.room) ?? byRoom.set(p.room, []).get(p.room)).push(p);
  }
  for (const b of plans.buildings) {
    const { spots } = spotsOf(b, fit, rules, cell);
    for (const st of b.storeys) {
      const s = st.storey;
      const rooms = b.rooms.filter((r) => r.storey === s && byRoom.has(r.id));
      if (!rooms.length) continue;
      const boxes = storeyBoxes(b, s, rules, { liftOf, reserved: spots.get(s) ?? [] });
      for (const room of rooms) {
        const list = byRoom.get(room.id).map((p) => ({ ...p, foot: footOfProp(p), h: p.size_m[2] }));
        byRoom.delete(room.id);
        const floor = roomFloor(room);
        const rr = roomRulesOf(room, rules);
        const narrow = Math.min(...room.clear.map((r) => Math.min(r.w, r.d)));
        for (const [i, p] of list.entries()) {
          const c = CATALOGUE[p.kind];
          const out = outsideBy(p.foot, floor);
          if (out > 1e-3) failures.push(`${say(p)} stands ${m(out)} outside room ${room.id}'s floor, wanted inside it`);
          const box = box3Of(p.foot, 0, p.h);
          for (const bx of boxes) {
            const d = box3Depth(box, bx);
            if (d <= 1e-3) continue;
            if (bx.hole) failures.push(`${say(p)} crosses ${bx.what} by ${m(d)}, wanted clear of it (never across an opening)`);
            else failures.push(`${say(p)} enters ${bx.what} by ${m(d)}, wanted clear of it (keep-clear)`);
          }
          if (p.rule === "freestanding") {
            if (!c.cls || !fs.kinds.includes(c.cls)) failures.push(`${say(p)} stands off the walls, but a ${p.kind} is not of placement.freestanding.kinds`);
            else if (narrow + 1e-6 < fs.minRoomSide) failures.push(`${say(p)} stands off the walls in room ${room.id}, narrow side ${m(narrow)}, wanted ${m(fs.minRoomSide)} or more`); // prettier-ignore
          } else {
            // its back on a wall: the strip just behind it outside the floor
            const behind = sideStrip(p.foot, p.facing, "back", rules.placement.maxWallGap + 0.01);
            const inner = samples(behind, G / 2).filter((q) => inFloor(q, floor) && !onEdge(q, floor));
            if (inner.length) {
              // how far off: the floor behind it, measured straight back
              let gap = 0;
              for (let t = 0.05; t <= 6; t += 0.05) {
                const strip = sideStrip(p.foot, p.facing, "back", t);
                const far = sideStrip(strip, p.facing, "back", 0.01);
                if (samples(far, G / 2).every((q) => !inFloor(q, floor) || onEdge(q, floor))) { gap = t; break; } // prettier-ignore
                gap = t;
              }
              failures.push(`${say(p)} stands ${m(gap)} off the wall behind it, wanted its back on a wall (placement.maxWallGap ${rules.placement.maxWallGap} m)`); // prettier-ignore
            }
          }
          for (const q of list.slice(i + 1)) {
            const d = boxOverlap2(p.foot, q.foot);
            if (d > 1e-3) failures.push(`${say(p)} overlaps ${say(q)} by ${m(d)}, wanted apart`);
          }
        }
        // clutter
        const area = floorArea(floor, room);
        const cov = list.filter((p) => p.collision).reduce((sum, p) => sum + (p.foot[2] - p.foot[0]) * (p.foot[3] - p.foot[1]), 0) / area;
        if (cov > rr.cap + 1e-6) failures.push(`room ${room.id} (${room.kind}, ${rr.clutter}): props cover ${pct(cov)} of its floor, wanted ${pct(rr.cap)} or less (placement.maxCoveredShare)`); // prettier-ignore
        // the walk and the use sides
        const doors = roomDoors(b, room, floor);
        const grid = new WalkGrid(floorBox(floor), (q) => inFloor(q, floor));
        const probes = { walk: walkCells(rr.walk), hull: hullCells(rules) };
        const base = walkOf(grid, doors, [], probes);
        const now = walkOf(grid, doors, list, probes);
        const label = { walk: `a ${m(probes.walk * G)} walk (the rulebook's corridor width ${m(rr.walk)} on the plan grid)`, hull: `the ${rules.hull.engines.goldsrc.width} x ${rules.hull.engines.goldsrc.height} unit hull` }; // prettier-ignore
        for (let i = 0; i < doors.length; i++)
          for (let j = i + 1; j < doors.length; j++) {
            const pr = joined(base, "walk", i, j) ? "walk" : joined(base, "hull", i, j) ? "hull" : null;
            if (!pr || joined(now, pr, i, j)) continue;
            const culprits = list.filter((q) => q.collision && joined(walkOf(grid, doors, list.filter((o) => o !== q), { [pr]: probes[pr] }), pr, i, j)); // prettier-ignore
            failures.push(`room ${room.id}: doors ${doors[i].door.id} and ${doors[j].door.id} are no longer joined by ${label[pr]} after dressing (the empty room joins them); ${culprits.length ? `cut by ${culprits.map(say).join(", ")}` : "cut by its props together"}`); // prettier-ignore
          }
        for (const p of list) {
          if (!p.use) continue;
          const u = useOf(p, list, floor, grid, now, doors.length);
          if (u.ok) continue;
          if (u.why === "covered") {
            const sides = p.use.sides.map((sd) => {
              const strip = sideStrip(p.foot, p.facing, sd, p.use.depth);
              const by = list.filter((q) => q !== p && q.collision && boxOverlap2(q.foot, strip) > EPS).map((q) => `${say(q)} by ${m(boxOverlap2(q.foot, strip))}`);
              return `${sd} ${by.length ? `covered by ${by.join(", ")}` : `${m(outsideBy(strip, floor))} past the floor`}`;
            });
            failures.push(`${say(p)}: no use side (${m(p.use.depth)} deep) free: ${sides.join("; ")}`);
          } else failures.push(`${say(p)}: its use side (${u.free.map((f) => f.side).join(", ")}, ${m(p.use.depth)} deep) is not reached from room ${room.id}'s doors by ${label.hull}`); // prettier-ignore
        }
      }
    }
  }
  for (const [room, list] of byRoom) failures.push(`${say(list[0])}: its room ${room} is in no plan of 05`);
  // what makes each dressed room what it is (placement.requiredProps), and its dressing allowance (placement.dressing)
  const inRoom = new Map();
  for (const p of artifact.props) if (p.place === "room" && CATALOGUE[p.kind]) (inRoom.get(p.room) ?? inRoom.set(p.room, []).get(p.room)).push(p);
  let trimmedProps = 0;
  let trimmedBrushes = 0;
  for (const r of artifact.rooms ?? []) {
    if (!r.dressed) continue;
    const list = inRoom.get(r.room) ?? [];
    const rule = dressingRuleOf(r.kind, rules);
    const { used, missing } = requiredOf(list, rule.required);
    for (const g of missing) failures.push(`room ${r.room} (${r.kind}): holds no ${g.join(" or ")}, wanted one (placement.requiredProps: what makes a ${r.kind} one)`); // prettier-ignore
    if (rule.max !== null) {
      const total = list.reduce((s, p) => s + (p.build === "brush" ? (CATALOGUE[p.kind].brushes ?? 1) : 0), 0);
      const extra = list.filter((p, i) => p.build === "brush" && !used.has(i)).reduce((s, p) => s + CATALOGUE[p.kind].brushes, 0);
      if (total > rule.max && extra > 0) failures.push(`room ${r.room} (${r.kind}): its props take ${total} brushes, wanted ${rule.max} or less (placement.dressing.maxBrushesBy.${r.kind}); ${list.filter((p, i) => p.build === "brush" && !used.has(i)).map((p) => p.id).join(", ")} past what it must hold`); // prettier-ignore
      else if (total > rule.max) notes.push(`room ${r.room} (${r.kind}): its required props alone take ${total} brushes, past its allowance ${rule.max} (placement.requiredProps kept first)`); // prettier-ignore
    }
    trimmedProps += r.trimmed?.length ?? 0;
    trimmedBrushes += (r.trimmed ?? []).reduce((s, x) => s + (x.brushes ?? 0), 0);
  }
  if (trimmedProps) notes.push(`dressing allowance: ${trimmedProps} props (${trimmedBrushes} brushes) taken out of ${(artifact.rooms ?? []).filter((r) => r.trimmed?.length).length} rooms past placement.dressing.maxBrushesBy, after placing (the rest stand where they were placed); the kinds in placement.dressing.full keep their whole dressing`); // prettier-ignore
  // the streets
  const street = artifact.props.filter((p) => p.place === "street" && CATALOGUE[p.kind]);
  for (const L of site.layers) {
    const list = street.filter((p) => p.layer === L.id).map((p) => ({ ...p, foot: footOf(p.at_m ?? [p.at[0] * cell, p.at[1] * cell], p.size_m).map(r4), h: p.size_m[2] })); // prettier-ignore
    const areas = (artifact.streets ?? []).filter((a) => a.layer === L.id);
    if (!list.length && !areas.length) continue;
    const W = streetWorld({ desc, inputs, layer: L.id });
    const signs = streetSigns(inputs, L.id, rules);
    const Z = streetZones({ desc, rules, inputs, layer: L.id, W, fit, signs });
    for (const [i, p] of list.entries()) {
      for (const f of streetPropFaults({ foot: p.foot, z0: L.floor * cell, h: p.h, lamp: p.lamp ?? null }, { W, Z, placed: [], rules })) {
        if (/public floor/.test(f.what)) failures.push(`${say(p)} stands ${m(f.by)} off ${L.id}'s public floor (on a building, a piece or out of the tile), wanted on it`); // prettier-ignore
        else if (/'s opening$/.test(f.what)) failures.push(`${say(p)} crosses ${f.what} by ${m(f.by)}, wanted clear of it (never across an opening)`);
        else failures.push(`${say(p)} enters ${f.what} by ${m(f.by)}, wanted clear of it (keep-clear)`);
      }
      for (const q of list.slice(i + 1)) {
        const d = boxOverlap2(p.foot, q.foot);
        if (d > 1e-3) failures.push(`${say(p)} overlaps ${say(q)} by ${m(d)}, wanted apart`);
      }
    }
    const ent = streetEntries({ inputs, layer: L.id, W });
    const probes = { walk: walkCells(rules.dimensions.corridors.public.width.min), hull: hullCells(rules) };
    const base = streetWalk(W, ent, [], probes);
    const now = streetWalk(W, ent, list, probes);
    for (const [i, j, pr] of pairsOf(base, ent.length)) {
      if (meets(now[pr].at[i], now[pr].at[j])) continue;
      const near12 = list.filter((q) => q.collision).sort((a, b) => dist2(a.foot, ent[i].p) + dist2(a.foot, ent[j].p) - dist2(b.foot, ent[i].p) - dist2(b.foot, ent[j].p)).slice(0, 12); // prettier-ignore
      const culprits = near12.filter((q) => { const w = streetWalk(W, ent, list.filter((o) => o !== q), { [pr]: probes[pr] }); return meets(w[pr].at[i], w[pr].at[j]); }); // prettier-ignore
      failures.push(`${L.id}: ${ent[i].what} and ${ent[j].what} are no longer joined by ${pr === "walk" ? `a ${m(probes.walk * G)} walk (the public corridor width)` : "the 32 x 72 unit hull"} after dressing; ${culprits.length ? `cut by ${culprits.map(say).join(", ")}` : "cut by the street props together"}`); // prettier-ignore
    }
    for (const p of unreachedUse(W, ent, list, now)) failures.push(`${say(p)}: its use side (${p.use.sides.join(", ")}, ${m(p.use.depth)} deep) is not reached from ${L.id}'s doors, exits and portals by the hull`); // prettier-ignore
    // clutter by district: the props counted again against the caps
    for (const a of areas) {
      const n = list.filter((p) => p.district === a.district && p.kind !== "lamp-post").length;
      const per = (n / Math.max(a.floor_m2, 1)) * 100;
      const cap = streetCap(desc, site, W, a.district);
      if (per > cap + 1e-6) failures.push(`streets of ${a.district} on ${L.id}: ${n} props on ${r2(a.floor_m2)} m2, ${r2(per)} per 100 m2, wanted ${r2(cap)} or less (STREET_CAP by density and wear)`); // prettier-ignore
      const cov = list.filter((p) => p.district === a.district && p.collision).reduce((s, p) => s + (p.foot[2] - p.foot[0]) * (p.foot[3] - p.foot[1]), 0) / Math.max(a.floor_m2, 1); // prettier-ignore
      if (cov > rules.placement.maxCoveredShare.outdoor + 1e-6) failures.push(`streets of ${a.district} on ${L.id}: props cover ${pct(cov)} of the public floor, wanted ${pct(rules.placement.maxCoveredShare.outdoor)} or less (placement.maxCoveredShare.outdoor)`); // prettier-ignore
    }
  }
  const ms = artifact.measures;
  // brush or model, the model cap, the entities with the props, the brush budget with the prop brushes
  const modelKinds = new Set(rules.placement?.props?.modelKinds ?? []);
  for (const p of artifact.props) if (p.build === "model" && !modelKinds.has(p.kind)) failures.push(`${say(p)}: a model, but placement.props.modelKinds does not list ${p.kind}: build it of brushes (no entity)`); // prettier-ignore
  const wir = inputOf(inputs, 7);
  const nModels = artifact.props.filter((p) => p.build === "model").length;
  const capNow = modelPropCap(desc, rules, inputs["01-site.json"].tile?.id ?? null, wir?.entities ? wir.entities.total - (wir.entities.props ?? 0) : 0);
  if (nModels > capNow.cap) failures.push(`props: ${nModels} model props in the tile, at most ${capNow.cap} (its share of placement.props.modelsPerCity ${capNow.byCity}, its entity share leaves ${capNow.room})`); // prettier-ignore
  if (wir?.entities) {
    const total = wir.entities.total - (wir.entities.props ?? 0) + nModels;
    if (total > wir.entities.limit) failures.push(`entities: ${total} stay in the tile with the model props (07's ${wir.entities.total - (wir.entities.props ?? 0)} + ${nModels} props), at most ${wir.entities.limit}`); // prettier-ignore
    notes.push(`entities with the props: ${total} of ${wir.entities.limit} (07's ${wir.entities.total - (wir.entities.props ?? 0)}, model props ${nModels} of the ${capNow.cap} the tile may hold)`); // prettier-ignore
  }
  const bb = ms?.brushBudget;
  if (bb && bb.total !== null && bb.total > bb.limit) failures.push(`brushes: an estimated ${bb.total} in the tile with the prop brushes (described ${bb.described ?? "?"}${bb.allowance ? ` less ${bb.allowance.replaced} of dressing allowance for the ${Math.min(bb.allowance.rooms, bb.allowance.roomsDressed)} of its ${bb.allowance.rooms} described rooms dressed here (${bb.allowance.perRoom} a room${bb.allowance.kept ? `, ${bb.allowance.kept} kept for the rest` : ""})` : ""} + ${bb.props} prop brushes: ${bb.roomProps ?? "?"} in rooms, ${bb.streetProps ?? "?"} in the streets), at most ${bb.limit}`); // prettier-ignore
  if (bb) notes.push(`brushes: ${bb.total ?? "?"} estimated in the tile (described ${bb.described ?? "?"}${bb.allowance ? ` less ${bb.allowance.replaced} of dressing allowance for the ${Math.min(bb.allowance.rooms, bb.allowance.roomsDressed)} of its ${bb.allowance.rooms} described rooms dressed here (${bb.allowance.perRoom} a room${bb.allowance.kept ? `, ${bb.allowance.kept} kept for the rest` : ""})` : ""} + ${bb.props} prop brushes: ${bb.roomProps ?? "?"} in rooms, ${bb.streetProps ?? "?"} in the streets) against its limit ${bb.limit} and PLAN.md's target ${bb.target}${bb.total > bb.target ? ": past the target" : ""}`); // prettier-ignore
  if (ms) {
    notes.push(`props: ${ms.props} (${ms.inRooms} in rooms, ${ms.inStreets} in the streets); ${ms.models} models (entities, cap ${ms.modelProps?.cap ?? "?"}${ms.modelProps?.dropped?.length ? `, ${ms.modelProps.dropped.length} dropped past it` : ""}), ${ms.brushes} brush props (no entity); the RP cities' sources carry 70-214 prop entities a city (notes-rp-city.md)`); // prettier-ignore
    notes.push(`rooms: ${ms.roomsDressed} dressed of ${ms.rooms} (${ms.roomsKeptClear} kept clear: circulation), ${ms.roomsEmpty} dressed rooms left empty; ${ms.unplaced} props a room asked for found no place by the rules`); // prettier-ignore
  }
  // the deliberate ones said once a reason (a square's portico hangs a row of them)
  const hungBy = new Map();
  for (const h of artifact.hungLamps ?? []) {
    if (h.deliberate) (hungBy.get(`${h.layer}: ${h.why}`) ?? hungBy.set(`${h.layer}: ${h.why}`, []).get(`${h.layer}: ${h.why}`)).push(h.lamp); // prettier-ignore
    else failures.push(`lamp ${h.lamp} on ${h.layer}: ${h.why}`);
  }
  for (const [k, ids] of hungBy) notes.push(ids.length > 1 ? `${ids.length} lamps on ${k} (${ids[0]} to ${ids[ids.length - 1]})` : `lamp ${ids[0]} on ${k}`);
  if (artifact.wallLamps?.length) notes.push(`${artifact.wallLamps.length} street and plaza lamps on wall brackets (06's mounts), ${artifact.props.filter((p) => p.kind === "lamp-post").length} on posts`); // prettier-ignore
  if (!fit.lights) notes.push("no 06 palette lamps: a light spot under each room's ceiling and placeholder lamp posts in the streets are reserved for stage 6");
  if (!fit.switches) notes.push("no 07 wiring switches: a switch spot by each room's entrance (latch side) is reserved for stage 7");
  else notes.push(`07's switches in rooms kept clear in front of each on its wall (a column ${SWITCH_RADIUS} m round one that carries no facing); a wall switch spot by each room's entrance (latch side) is reserved too, and a sign spot over each business's and public building's street door`); // prettier-ignore
  return { failures, notes };
}

/** Street props per 100 m2 a district's public floor may hold on a layer: by its density and wear, more with a market plaza. */
export function streetCap(desc, site, W, dId) {
  const d = (desc.districts ?? []).find((x) => x.id === dId);
  const isMarket = !!d && /bazaar|market/i.test(`${d.id} ${d.name} ${d.theme}`) && W.pBoxes.some((pb) => site.nodes.find((n) => n.id === pb.p.id)?.district === dId);
  return r2((STREET_CAP[d?.density] ?? 0.4) + (WEAR_CAP[d?.wear ?? 0] ?? 0) + (isMarket ? MARKET_CAP : 0));
}
