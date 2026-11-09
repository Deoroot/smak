// levels/assembly: a site, several buildings along streets (`smak-site/1`: levels/specs/mese-01.json, a stretch of the
// Mese; levels/specs/byzantium-01.json, the first playable New Byzantium). The public places (streets, plazas, alleys,
// porticoes, the square and its column), the districts and their walls with their checkpoints are given where they
// stand (README, "The site"); each building is laid out by layout.mjs from its program and checked by its style; the
// site's own rules (the style's `site` block: properties, portico depth, street width, the square, footprints,
// spawns) are measured by checkSite; and assembleSite joins the buildings and the streets into one map from one piece
// library, each district in its theme's textures (with `open`, the walk map: every leaf a world brush where it stands
// open, as assemble.mjs makes it).
//
//   readSite(json)                     -> { site, failures, warnings }
//   buildingOf(site, b)                -> the smak-building/1 of building b, from its program (PROGRAMS)
//   planSite(site)                     -> { site, cells, districts, layouts, failures, warnings }: cells [y][x] labelled
//   propertiesOf(layout, style, one)   -> Map room id -> the property (the room it is entered by) or null
//   checkSite(plan, style)             -> { failures, warnings, measures }
//   spawnsOf(plan), checkSpawns(plan, spawns, style)
//   assembleSite(plan, library, opts)  -> { map, report }
//   siteLight(bsp, plan, style)        -> { failures, warnings, measures }: rooms against public floor, compiled
//   switchesOf(plan, style, most)      -> { chosen, skipped }: the properties whose lamps get a switch (README,
//                                         "Switches and the jail")
//
// Cells of 64, y up is north; a building's `at` is its least corner on the site, its layout's own cells from there.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { box, brushEntity, pointEntity, playerStart, textureLights } from "../../src/maps/source.mjs";
import { layoutOf, sweptBy } from "./layout.mjs";
import { loadStyle, largestRectangle } from "./style.mjs";
import { assemble, apartEntities, APART_REACH, APART_REACH_SKY, edgeFrame, swapped, stretched, rectanglesOf, SUN, TEXLIGHT_SCALE, LIGHT_TABLE } from "./assemble.mjs";
import { pieceFor, placed } from "./library.mjs";
import { floorSamples, stylesCounted } from "../../src/maps/light.mjs";
import { readBelow, planBelow, assembleBelow } from "./below.mjs";
import { arenasOf } from "./arena.mjs";
import { ridesOf } from "./ride.mjs";
import { towerOf, towerBrushes, TOWER_MOST } from "./tower.mjs";
import { isShell, roofWalks, shellProgram, readShell, shellPlan, facadeOf, assembleShell, roofRails } from "./shell.mjs";
import { readTerrain, terrainOf, terrainBrushes, wallGround, WATER_DEFAULT } from "./terrain.mjs";
import { readRoofs, planRoofs, roofOpenings, roofBrushes, roofGround } from "./roofs.mjs";
import { readShapes, fillBounds, shapesOf as shapedAreas, shapeBrushes } from "./shapes.mjs";
import { judgeSourceForm } from "../../src/maps/dressing.mjs";
import { porticoInset } from "./porticoes.mjs";
import { corniceBrushes, hipRoof, cornerTower, talusBrushes, fitBands, TOWER, MASS_LOOK } from "./massing.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SITE_FORMAT = "smak-site/1";
const GRID = 64;
const STOREY = 192;
const SIDES = ["south", "north", "east", "west"];
const OPPOSITE = { south: "north", north: "south", east: "west", west: "east" };
/** The sky over the highest thing on the site. */
const SKY_OVER = 128;
/** The storeys of the blind fronts that close the site's ends, over its two-storey buildings, as the city went on. */
const BACKDROP = 3;
/** The lamps of the site's kinds (assemble.mjs's table for the rest): halls, landings and corridors with sconces by their doors. */
export const MESE_LIGHT = {
  ...LIGHT_TABLE,
  default: { perLamp: 16 },
  shop: { perLamp: 14 },
  backroom: { perLamp: 16 },
  stairhall: { perLamp: 10, sconces: true },
  landing: { perLamp: 10, sconces: true },
  corridor: { perLamp: 10, sconces: true },
  counter: { perLamp: 10, sconces: true },
  flat: { perLamp: 14 },
  cell: { perLamp: 10 },
  lobby: { perLamp: 12, sconces: true },
  bar: { perLamp: 14 },
};
/**
 * The lamps of a site's buildings brighter than a house's (assemble.mjs LAMP_SCALE 0.5): the RP cities' homes are lit
 * 114 of 255 at the median (levels/notes-rp-rooms.md), smak_mese01's rooms 66; and fewer of them (a ceiling lamp is 7
 * brushes, 65 faces: a site of 14 buildings had 264).
 */
const SITE_LAMP_SCALE = 0.8;
/**
 * The rooms that keep the hanging lamp (the public rooms a player walks into); the rest, and the stairs, a flush
 * panel: a site's 196 hanging lamps, out of the world, came to 21 864 faces of the BSP's vertex budget.
 */
const HANGING = new Set(["shop", "bar", "lobby", "clinic", "workshop", "living"]);
/**
 * Slots whose pieces stand apart from the world, one func_wall a building and one a portico (and the column's own):
 * they seal nothing, and in the world each splits it into leaves, as func_detail too (a ceiling lamp some 46:
 * smak_mese01 came to 6 164 of GoldSrc's 8 192 with them in the world, 929 without). zhlt_lightflags 2: they cast
 * their shadows.
 */
export const DETAIL_SLOTS = new Set(["lamp", "column", "architrave", "landmark", "crown", "front"]);
/** How far a detail entity of a Kowloon or tower building reaches (apartEntities): short, for the leaves its facade makes. */
const REACH_DENSE = { up: 160, area: 40000, long: 224 };
/** The lamps' own entity: no clipnodes (nobody touches a lamp; smak_mese01's clipnodes came to 26 735 of 32 767 with them). */
const LAMP_ENTITY = { zhlt_noclip: 1 };
/** The skyline's pieces on the roofs: seen, never walked or shot from the street, so they take no clip hull. */
const CROWN_ENTITY = { zhlt_noclip: 1, zhlt_lightflags: 2 };
/** A building's `dome`: the crown piece's kind, and the cells its roof must be across (the drum and a parapet's gap). */
const DOMES = { large: { kind: "dome-large", across: 6 }, small: { kind: "dome", across: 4 } };
/** Kinds whose floor is a home's (wood). */
export const HOME_KINDS = new Set(["flat", "living", "kitchen", "bedroom"]);
/** Kinds of a building's public ground room that open on the street by a shopfront (and its shop window). */
export const FRONT_KINDS = new Set(["shop", "bar", "clinic", "workshop"]);
/** Labels of the site's cells a player may stand on in public. */
export const PUBLIC = new Set(["street", "portico", "square", "plaza", "alley", "landmark", "paving", "ramp", "stair"]);
/** Labels an area of the site may have. */
const AREA_KINDS = ["street", "plaza", "square", "alley", "paving", "water"];

/**
 * The switched lamps' names a site gives at the most: GoldSrc's compilers hold 32 switched light styles (32..63, one
 * a name: hlcsg "Exceeded MAX_SWITCHED_LIGHTS"), and the city will want a few for itself (the alarm, a club, a lift's
 * lamp), so the rooms take 24 of them.
 */
export const SWITCHES_MOST = 24;
/** Where a switch stands on a doorway piece's 128: x 112 of its frame, the latch side (the leaf hangs at 32), clear of the casing (96..100) and of a wall meeting the doorway's end (120). */
const SWITCH_X = 112;
/** The jail's control: the switch piece with its face swapped (H9's red lamp over a red button, its +A frame lit), "access granted" (sounds 3). */
const JAIL_FACE = { "+0SW3S": "+0SW2S" };
/**
 * func_door_rotating's flags for a cell's door: one way (16) and toggle (32: it stays open until fired again), not
 * 256: a door with a name and no "use only" flag is opened by nothing but what fires it (the SDK's CBaseDoor: no
 * use from a player, its touch locked by the name).
 */
const CELL_DOOR_FLAGS = 16 + 32;

/**
 * A property's kind (the RP contract's) from the kind of the room it is entered by: a home (a flat, a tenement room, a
 * whole manor), a shop, the jail's, the hideout's, the regime's police rooms, a public door (a stair hall's, the lobby's),
 * else other. A checkpoint in a wall is `gate` (contract.mjs).
 */
export function propertyKindOf(roomKind, oneProperty = false) {
  if (oneProperty) return "home";
  if (FRONT_KINDS.has(roomKind)) return "shop";
  if (HOME_KINDS.has(roomKind)) return "home";
  if (roomKind === "cell") return "jail";
  if (roomKind === "den") return "hideout";
  if (["booking", "guard", "warroom", "office", "armory"].includes(roomKind)) return "police";
  if (["stairhall", "landing", "corridor", "counter", "lobby"].includes(roomKind)) return "public";
  return "other";
}
/**
 * The keys of a door leaf by its property's kind (smak_doors locks by the contract's kinds): used, never touched (256);
 * a home's stays as left, toggle (32) and wait -1, so that its owner can shut it behind him and nothing slams on a guard
 * behind; the others swing back after 4 s (the pieces' wait); a jail cell's (CELL_DOOR_FLAGS) and a checkpoint's keep
 * the one-way flag (16), nothing else has it; `dmg` 0 on all: no leaf crushes (and a blocked one reverses).
 */
const DOOR_KEYS = { home: { spawnflags: 256 + 32, wait: -1 }, shop: { spawnflags: 256 }, public: { spawnflags: 256 }, police: { spawnflags: 256 }, hideout: { spawnflags: 256 }, other: { spawnflags: 256 } }; // prettier-ignore

const isInt = (v) => Number.isInteger(v);
const pair = (v) => Array.isArray(v) && v.length === 2 && v.every(isInt);

/** Reads a site description, checking what the plan needs. Never throws. */
export function readSite(json) {
  const failures = [];
  const warnings = [];
  const site = typeof json === "string" ? JSON.parse(readFileSync(json, "utf8")) : structuredClone(json);
  const fail = (s) => failures.push(s);
  if (site.format !== SITE_FORMAT) fail(`the site's format is ${JSON.stringify(site.format)}; it wants "${SITE_FORMAT}"`);
  if (!pair(site.size) || site.size.some((v) => v < 1)) fail(`size is ${JSON.stringify(site.size)}; it wants [cellsX, cellsY]`);
  // the public places: \`areas\`, with the older \`street\` (rows across the whole site) and \`square\` read as two of them
  site.areas = [...(site.areas ?? [])];
  if (site.street !== undefined) {
    if (!pair(site.street?.rows) || site.street.rows[1] <= site.street.rows[0]) fail(`street.rows is ${JSON.stringify(site.street?.rows)}; it wants [first row, past the last] (y), the carriageway`); // prettier-ignore
    else if (pair(site.size)) site.areas.unshift({ kind: "street", from: [0, site.street.rows[0]], to: [site.size[0], site.street.rows[1]], name: "the street" }); // prettier-ignore
  }
  if (site.square !== undefined) {
    if (!pair(site.square.from) || !pair(site.square.to) || (site.square.landmark && !pair(site.square.landmark))) fail("square: it wants from [x, y], to [x, y] and landmark [x, y] (its least cell)"); // prettier-ignore
    else site.areas.push({ kind: "square", from: site.square.from, to: site.square.to, landmark: site.square.landmark, name: "the square" }); // prettier-ignore
  }
  for (const [k, a] of site.areas.entries()) {
    a.name ??= `${a.kind} ${k + 1}`;
    fillBounds(a, site.size); // a shaped area's cells, from its shape when not given (shapes.mjs)
    if (!AREA_KINDS.includes(a.kind)) fail(`${a.name}: its kind is ${JSON.stringify(a.kind)}; it wants one of ${AREA_KINDS.join(", ")}`);
    if (!pair(a.from) || !pair(a.to) || a.to[0] <= a.from[0] || a.to[1] <= a.from[1]) fail(`${a.name}: it wants from [x, y] and to [x, y], to past from`); // prettier-ignore
    if (a.landmark !== undefined && !pair(a.landmark)) fail(`${a.name}: its landmark wants [x, y], its least cell`);
  }
  if (site.doors !== undefined && !["teleport", "moving"].includes(site.doors)) fail(`doors is ${JSON.stringify(site.doors)}; it wants "teleport" (every door a shut wall with two spots, Cry of Fear's inter_door) or "moving" (the default: the pieces' swinging leaves)`); // prettier-ignore
  for (const f of readShapes(site)) fail(f);
  for (const [k, p] of (site.porticoes ?? []).entries()) {
    if (!pair(p.rows) || !pair(p.cells) || !isInt(p.columns)) fail(`portico ${k + 1}: it wants rows [y0, y1], cells [x0, x1] and columns (the y of its column line)`); // prettier-ignore
    else if (p.columns !== p.rows[0] && p.columns !== p.rows[1]) fail(`portico ${k + 1}: its column line ${p.columns} is neither of its rows' edges ${p.rows.join(" and ")}`); // prettier-ignore
  }
  for (const [k, w] of (site.walls ?? []).entries()) {
    w.name ??= `wall ${k + 1}`;
    if (!pair(w.from) || !pair(w.to) || (w.from[0] !== w.to[0] && w.from[1] !== w.to[1])) fail(`${w.name}: it wants from [x, y] and to [x, y], grid vertices on one line`); // prettier-ignore
    for (const g of w.gates ?? []) if (!pair(g)) fail(`${w.name}: a gate wants [x, y], the vertex at its middle`);
    for (const g of w.gaps ?? []) if (!pair(g)) fail(`${w.name}: a gap wants [x, y], the vertex at its middle`);
  }
  for (const d of site.districts ?? []) if (!pair(d.from) || !pair(d.to) || !d.id) fail(`district ${d.id ?? "?"}: it wants id, from [x, y] and to [x, y]`); // prettier-ignore
  const ids = new Set();
  for (const b of site.buildings ?? []) {
    if (ids.has(b.id)) fail(`building ${b.id} is named twice`);
    ids.add(b.id);
    if (!pair(b.at) || !pair(b.size)) fail(`building ${b.id}: it wants at [x, y] and size [w, h] in cells`);
    if (!SIDES.includes(b.front)) fail(`building ${b.id}: front is ${JSON.stringify(b.front)}; it wants south, north, east or west`); // prettier-ignore
    b.program ??= "shop-flats";
    if (b.program === "interior") b.program = "shop-flats"; // (shell.mjs: "interior" is the default, a building with rooms)
    for (const f of readShell(b, PROGRAMS)) fail(f);
    if (!PROGRAMS[b.program]) fail(`building ${b.id}: its program ${JSON.stringify(b.program)} is none of ${Object.keys(PROGRAMS).join(", ")}`); // prettier-ignore
    if (b.tower !== undefined && !(isInt(b.tower) && b.tower >= 0 && b.tower <= TOWER_MOST)) fail(`building ${b.id}: tower is ${JSON.stringify(b.tower)}; it wants a whole number of storeys, 0 to ${TOWER_MOST} (sealed storeys over its two, tower.mjs)`); // prettier-ignore
    if (b.flatArea !== undefined && !(Array.isArray(b.flatArea) && b.flatArea.length === 2 && b.flatArea.every(isInt) && b.flatArea[0] >= 8 && b.flatArea[1] >= b.flatArea[0])) fail(`building ${b.id}: flatArea is ${JSON.stringify(b.flatArea)}; it wants [least, most] cells of a flat, 8 or more`); // prettier-ignore
    if (b.flats !== undefined && !(isInt(b.flats) && b.flats >= 2 && b.flats <= 4)) fail(`building ${b.id}: flats is ${JSON.stringify(b.flats)}; it wants 2 to 4 (the flats over a shop)`); // prettier-ignore
    if (b.dome !== undefined && !DOMES[b.dome]) fail(`building ${b.id}: dome is ${JSON.stringify(b.dome)}; it wants ${Object.keys(DOMES).join(" or ")}`); // prettier-ignore
  }
  if (!site.buildings?.length) fail("the site has no buildings");
  // the ground's heights, joins, water, bridges and culverts (terrain.mjs)
  for (const f of readTerrain(site)) fail(f);
  // the routes over the roofs (roofs.mjs)
  for (const f of readRoofs(site)) fail(f);
  // the level below the streets (below.mjs)
  for (const f of readBelow(site)) fail(f);
  site.style ??= "mese";
  return { site, failures, warnings };
}

// ── the programs: what each kind of building holds ──

/** A shop (or a bar, a clinic, a workshop: \`venue\`) with its back room and a stair hall below, two flats above. */
function shopFlats(b, w, h, style) {
  const left = w * h - 8; // less the stairwell
  const venue = b.venue ?? "shop";
  const k = style.kinds[venue];
  const least = k ? k.minArea : 15;
  // two flats over it, three when two of the largest (28) and the landing (10) would not fill the storey
  // (or as many as the building says: `flats`, 2 to 4)
  const flats = b.flats ? Array.from({ length: b.flats }, (_, i) => `flat${i + 1}`) : left > 66 ? ["flat1", "flat2", "flat3"] : ["flat1", "flat2"];
  return {
    rooms: [
      { id: venue, storey: 0, kind: venue, area: [least, Math.min(k?.maxArea ?? 37, left - 10)], entrance: true },
      { id: "back", storey: 0, kind: "backroom", area: [6, Math.max(6, left - least - 4)] },
      { id: "hall", storey: 0, kind: "stairhall", area: [4, 10], entrance: true },
      { id: "landing", storey: 1, kind: "landing", area: [4, flats.length > 2 ? 16 : 10] },
      ...flats.map((id) => ({ id, storey: 1, kind: "flat", area: b.flatArea ?? [8, 28] })),
    ],
    doors: [[venue, "back"], ...flats.map((id) => ["landing", id])],
    // `backDoor: true` on the building: a way out of the shop through its back room into the stair hall (the shop's own
    // door, the back room, the hall, the street: a loop for a chase); the layout puts it where a wall allows
    ...(b.backDoor ? { extraDoors: [["back", "hall"]] } : {}),
    stairFrom: "hall",
    stairTo: "landing",
  };
}
/** A tenement of the Hollow: a stair hall and its rooms (bedsits) on both storeys; with \`den\`, a hidden room behind room 1. */
function tenement(b, w, h) {
  const n = b.rooms ?? 3;
  const rooms = [{ id: "hall", storey: 0, kind: "stairhall", area: [4, 14], entrance: true }, { id: "landing", storey: 1, kind: "landing", area: [4, 14] }]; // prettier-ignore
  const doors = [];
  // a room more upstairs than down, smaller: the rooms vary (and their rents) rather than stack alike
  let k = 0;
  for (let s = 0; s < 2; s++)
    for (let i = 1; i <= n + s; i++) {
      const id = `room${++k}`;
      rooms.push({ id, storey: s, kind: "flat", area: [8, 28] });
      doors.push([s ? "landing" : "hall", id]);
    }
  if (b.den) {
    rooms.push({ id: "den", storey: 0, kind: "den", area: [6, 12] });
    doors.push(["room1", "den"]);
  }
  return { rooms, doors, stairFrom: "hall", stairTo: "landing", secret: b.den ? ["room1", "den"] : null, noWindows: ["den"] };
}
/** The Nexus, the MSR's seat: a lobby, a corridor of cells with booking and a guard post below; offices, a war room and the armory above. */
function nexus(b, w, h) {
  const cells = b.cells ?? 3;
  const rooms = [
    { id: "lobby", storey: 0, kind: "lobby", area: [12, 30], entrance: true },
    { id: "corridor", storey: 0, kind: "corridor", area: [4, 23] },
    { id: "booking", storey: 0, kind: "booking", area: [10, 24] },
    { id: "guard", storey: 0, kind: "guard", area: [6, 15] },
    { id: "landing", storey: 1, kind: "landing", area: [4, 23] },
    { id: "office1", storey: 1, kind: "office", area: [8, 26] },
    { id: "office2", storey: 1, kind: "office", area: [8, 26] },
    { id: "warroom", storey: 1, kind: "warroom", area: [12, 40] },
    { id: "armory", storey: 1, kind: "armory", area: [8, 17] },
  ];
  const doors = [["lobby", "corridor"], ["corridor", "booking"], ["corridor", "guard"], ["landing", "office1"], ["landing", "office2"], ["landing", "warroom"], ["landing", "armory"]]; // prettier-ignore
  for (let i = 1; i <= cells; i++) {
    rooms.push({ id: `cell${i}`, storey: 0, kind: "cell", area: [6, 10] });
    doors.push(["corridor", `cell${i}`]);
  }
  return { rooms, doors, stairFrom: "corridor", stairTo: "landing", noWindows: ["cell", "armory", "guard"], grated: ["cell"], control: "guard" }; // prettier-ignore
}
/**
 * A police post on the street (the regime's gate-house; `cells`: 1 holding cell by default, 0 or 2): a counter hall (its street door, the stair) off which open the
 * guard room (the jail's control: its switch frees the holding cell) and the holding cell, and above a landing and a
 * vault (an armory, the thing a guard guards). The hall is circulation, so the guard room and the cell are properties of
 * their own: police and jail doors in the contract.
 */
function post(b = {}, w = 7, h = 5) {
  const n = b.cells ?? 1; // holding cells: 1 by default, 0 for a watch with none, 2 for a lockup (byzantium-02's Hollow)
  const holding = Array.from({ length: n }, (_, i) => ({ id: n > 1 ? `holding${i + 1}` : "holding", storey: 0, kind: "cell", area: [6, 12] }));
  // a bigger post than its core of rooms fills (counter 16, guard 12 and the cells 12 each below; landing 14 and vault 17
  // above) has a booking room below and an office above, as the Nexus has
  const left = w * h - 8;
  const below = 16 + 12 + 12 * n;
  const booking = Array.from({ length: left > below ? Math.ceil((left - below) / 24) : 0 }, (_, i) => ({ id: i ? `booking${i + 1}` : "booking", storey: 0, kind: "booking", area: [10, 24] }));
  const office = Array.from({ length: left > 31 ? Math.ceil((left - 31) / 26) : 0 }, (_, i) => ({ id: i ? `office${i + 1}` : "office", storey: 1, kind: "office", area: [8, 26] }));
  return {
    rooms: [
      { id: "counter", storey: 0, kind: "counter", area: [8, 16], entrance: true },
      { id: "guard", storey: 0, kind: "guard", area: [6, 12] },
      ...holding,
      ...booking,
      { id: "landing", storey: 1, kind: "landing", area: [4, 14] },
      { id: "vault", storey: 1, kind: "armory", area: [8, 17] },
      ...office,
    ],
    doors: [["counter", "guard"], ...holding.map((c) => ["counter", c.id]), ...booking.map((r) => ["counter", r.id]), ["landing", "vault"], ...office.map((r) => ["landing", r.id])],
    stairFrom: "counter",
    stairTo: "landing",
    noWindows: ["cell", "armory", "guard"],
    grated: ["cell"],
    control: "guard",
    ...(n === 0 ? { watch: true } : {}), // a watch has a guard room and no cell: nobody to free, so no jail switch
  };
}
/** A manor: one household (one property): a hall, the living room and the kitchen below, a landing and two bedrooms above. */
function manor() {
  return {
    rooms: [
      { id: "hall", storey: 0, kind: "stairhall", area: [4, 14], entrance: true },
      { id: "living", storey: 0, kind: "living", area: [16, 34] },
      { id: "kitchen", storey: 0, kind: "kitchen", area: [6, 18] },
      { id: "store", storey: 0, kind: "backroom", area: [6, 20] },
      { id: "landing", storey: 1, kind: "landing", area: [4, 14] },
      { id: "bed1", storey: 1, kind: "bedroom", area: [8, 22] },
      { id: "bed2", storey: 1, kind: "bedroom", area: [8, 22] },
      { id: "study", storey: 1, kind: "flat", area: [8, 22] },
    ],
    doors: [["hall", "living"], ["hall", "kitchen"], ["kitchen", "living"], ["kitchen", "store"], ["landing", "bed1"], ["landing", "bed2"], ["landing", "study"]], // prettier-ignore
    stairFrom: "hall",
    stairTo: "landing",
    oneProperty: "manor",
  };
}
export const PROGRAMS = { "shop-flats": shopFlats, "venue-flats": shopFlats, tenement, nexus, manor, post, shell: null };
PROGRAMS.shell = shellProgram(PROGRAMS); // a shell (shell.mjs) is laid out as the program whose facade it wears

/**
 * The building description of one of the site's buildings, from its program; its sides blind (the neighbours stand
 * against them; \`blind\` on the building says otherwise), its back open to the lane behind.
 */
export function buildingOf(site, b, style = loadStyle(site.style)) {
  const [w, h] = b.size;
  const program = PROGRAMS[b.program ?? "shop-flats"](b, w, h, style);
  return {
    format: "smak-building/1",
    name: `${site.name}-${b.id}`,
    style: site.style,
    front: b.front,
    blind: b.blind ?? SIDES.filter((s) => s !== b.front && s !== OPPOSITE[b.front]),
    // blind below, and every wall on the site's edge blind below (the sky wall stands against it: no door opens onto
    // it; a window upstairs, out of reach, still looks out)
    blindBelow: [...new Set([...(b.blindBelow ?? []), ...edgeWalls(site, b)])].filter((s) => s !== b.front),
    stairOffFront: true,
    windowStep: 3,
    seed: b.seedUsed ?? b.seed ?? 1,
    base: [b.at[0] * GRID, b.at[1] * GRID, b.groundZ ?? 0],
    footprint: { cells: [w, h] },
    storeys: 2,
    stair: { at: "auto" },
    rooms: program.rooms,
    doors: program.doors,
    ...(program.extraDoors ? { extraDoors: program.extraDoors } : {}),
    stairFrom: program.stairFrom,
    stairTo: program.stairTo,
    ...(program.noWindows ? { noWindows: program.noWindows } : {}),
  };
}
/** The walls of building b on the site's edge. */
const edgeWalls = (site, b) => [b.at[0] === 0 && "west", b.at[1] === 0 && "south", b.at[0] + b.size[0] === site.size?.[0] && "east", b.at[1] + b.size[1] === site.size?.[1] && "north"].filter(Boolean); // prettier-ignore
/** What a building's program says beyond its description: one property, a secret door, grated doors. */
export const programOf = (site, b, style) => PROGRAMS[b.program ?? "shop-flats"](b, b.size[0], b.size[1], style);

/**
 * The site's cells, each labelled, its districts, and every building laid out. `cache`: a folder where each layout is
 * kept by the sha1 of its description (layoutOf is deterministic: the same description gives the same layout).
 */
export function planSite(siteJson, { cache = null } = {}) {
  const read = readSite(siteJson);
  const { site } = read;
  const failures = [...read.failures];
  const warnings = [...read.warnings];
  if (failures.length) return { site, cells: [], districts: [], layouts: new Map(), failures, warnings };
  const style = loadStyle(site.style);
  const [W, H] = site.size;
  const cells = Array.from({ length: H }, () => new Array(W).fill("paving"));
  const claimed = Array.from({ length: H }, () => new Array(W).fill(false));
  const claim = (x0, y0, x1, y1, label, what) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) {
          failures.push(`${what} reaches the cell ${x},${y}, outside the site's ${W} x ${H}`);
          return;
        }
        if (claimed[y][x]) {
          failures.push(`${what} and ${cells[y][x]} both claim the cell ${x},${y}`);
          return;
        }
        claimed[y][x] = true;
        cells[y][x] = label;
      }
  };
  for (const a of site.areas) {
    claim(a.from[0], a.from[1], a.to[0], a.to[1], a.kind, a.name);
    if (a.landmark) for (let y = a.landmark[1]; y < a.landmark[1] + 3; y++) for (let x = a.landmark[0]; x < a.landmark[0] + 3; x++) if (cells[y]?.[x] === a.kind) cells[y][x] = "landmark"; // prettier-ignore
  }
  for (const [k, p] of (site.porticoes ?? []).entries()) claim(p.cells[0], p.rows[0], p.cells[1], p.rows[1], "portico", `portico ${k + 1}`); // prettier-ignore
  for (const b of site.buildings) claim(b.at[0], b.at[1], b.at[0] + b.size[0], b.at[1] + b.size[1], `building ${b.id}`, `building ${b.id}`); // prettier-ignore
  // the ramps and stairs claim their cells (terrain.mjs)
  for (const j of site.joins ?? []) if (j.kind === "ramp" || j.kind === "stair") claim(j.from[0], j.from[1], j.to[0], j.to[1], j.kind, j.name);
  // each cell's district (the first that holds it), for its theme
  const districts = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => (site.districts ?? []).find((d) => x >= d.from[0] && x < d.to[0] && y >= d.from[1] && y < d.to[1])?.id ?? null)); // prettier-ignore
  // the ground cell by cell, and what joins its heights (the buildings are laid out standing at theirs)
  // the shaped areas (diagonal streets, polygon and oval plazas: shapes.mjs): the cells their floor does not touch are solid
  const shapes = shapedAreas(site);
  failures.push(...shapes.failures);
  shapes.mark(cells);
  const terrain = terrainOf(site, cells, districts, shapes);
  failures.push(...terrain.failures);
  warnings.push(...terrain.warnings);
  // each building laid out at `seeds` seeds from its own (the site's `seeds`, 1 unless told), the one kept that fails
  // least, then repeats fewest room shapes the buildings before it have (the person's "copy-paste": rp-cities
  // repeat 5 to 20 % of rooms), then warns least; the choice is the site's, so the same site gives the same plan
  const layouts = new Map();
  const shells = new Map(); // a shell's facade (shell.mjs); its entry in `layouts` holds no room
  const seen = new Map();
  const shapesOf = (l) => l.rooms.filter((r) => style.kinds[r.kind]?.zone !== "circulation" && r.kind !== "cell" && l.storeyPlans[r.storey]).map((r) => `${r.kind}:${largestRectangle(l.storeyPlans[r.storey].cells, r.id).sides.join("x")}:${r.cells}`); // prettier-ignore
  for (const b of site.buildings) {
    b.district ??= districts[b.at[1]]?.[b.at[0]] ?? null;
    let best = null;
    for (let k = 0; k < (b.seeds ?? site.seeds ?? 1); k++) {
      const seed = (b.seed ?? 1) + k;
      const l = cachedLayout(buildingOf(site, { ...b, seed }, style), cache);
      const shapes = shapesOf(l);
      const onJoin = entrancesOnJoins(b, l, cells); // (an entrance on a stair or a ramp: the walking graph cannot leave it; the layout is chosen without)
      const score = [l.failures.length, onJoin.length, shapes.filter((s) => seen.has(s)).length, l.warnings.length];
      const better = best === null || score.some((v, i) => score.slice(0, i).every((w, j) => w === best.score[j]) && v < best.score[i]);
      if (better) best = { l, shapes, score, seed, onJoin };
    }
    b.seedUsed = best.seed;
    if (isShell(b)) best.shapes = []; // (no interior, no room shapes to repeat)
    for (const s of best.shapes) seen.set(s, (seen.get(s) ?? 0) + 1);
    for (const f of best.l.failures) failures.push(`building ${b.id}: ${f}`);
    for (const f of best.l.warnings) warnings.push(`building ${b.id}: ${f}`);
    for (const f of best.onJoin) warnings.push(`building ${b.id}: ${f}`);
    if (isShell(b)) {
      const { stub, facade } = shellPlan(best.l);
      layouts.set(b.id, stub), shells.set(b.id, facade);
    } else layouts.set(b.id, best.l);
  }
  // the level below the streets, its cells under the site's (below.mjs)
  const below = site.below ? planBelow(site, cells, layouts, terrain) : null;
  if (below) failures.push(...below.failures), warnings.push(...below.warnings);
  const plan = { site, cells, districts, layouts, shells, below, terrain, shapes, failures, warnings };
  if (site.roofs) plan.roofs = planRoofs(plan); // (its geometry is checkRoofs', roofs.mjs)
  return plan;
}

/**
 * The entrances of a building's layout whose outside cell is a stair's or a ramp's (sentences): a door opening onto steps has its sill
 * a step or more above the floor outside, and the walking graph's street spot there is not joined to the street (the stair hall's flats
 * of the pawn shop were left with no node, 2026-11). The seed search counts them as failures, so a seed without any is kept when one exists.
 */
export function entrancesOnJoins(b, layout, cells) {
  const out = [];
  for (const en of layout.entrances ?? [])
    for (const e of en.edges) {
      const c = outsideCell(b, e);
      const label = c && cells[c[1]]?.[c[0]];
      if (label === "stair" || label === "ramp") {
        out.push(`the entrance of ${en.room} opens onto a ${label} (cell ${c.join(",")}); an entrance opens onto level floor`);
        break;
      }
    }
  return out;
}

/** layoutOf through a folder of kept layouts, or straight when there is none. */
function cachedLayout(description, cache) {
  if (!cache) return layoutOf(description);
  const file = join(cache, `${createHash("sha1").update(JSON.stringify(description)).digest("hex")}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const l = layoutOf(description);
  mkdirSync(cache, { recursive: true });
  writeFileSync(file, JSON.stringify(l));
  return l;
}

/**
 * Each room's property: the room it is entered by from public floor or a stair hall or landing (zone circulation),
 * and the rooms behind it through doors that pass no circulation room (a shop's back room is the shop's). A
 * circulation room is its own when it has an entrance (the building's common door), else null. With \`one\`, the whole
 * building is one property of that name (a manor's household).
 */
export function propertiesOf(layout, style, one = null) {
  if (one) return new Map(layout.rooms.map((r) => [r.id, one]));
  const zone = (id) => style.kinds[layout.rooms.find((r) => r.id === id)?.kind]?.zone;
  const own = new Map(layout.rooms.map((r) => [r.id, null]));
  const entered = new Set((layout.entrances ?? []).map((en) => en.room));
  const roots = [];
  for (const r of layout.rooms) {
    if (zone(r.id) === "circulation") {
      if (entered.has(r.id)) own.set(r.id, r.id);
      continue;
    }
    // (an extra door, a second way to a hall, does not make its room a property of its own)
    const byHall = layout.doors.some((d) => !d.extra && d.rooms.includes(r.id) && d.rooms.some((o) => o !== r.id && zone(o) === "circulation"));
    if (entered.has(r.id) || byHall) roots.push(r.id);
  }
  // each root its own property first: a room entered from the street or a hall is never another's back room
  for (const root of roots) own.set(root, root);
  for (const root of roots) {
    const queue = [root];
    while (queue.length) {
      const id = queue.shift();
      for (const d of layout.doors) {
        if (!d.rooms.includes(id)) continue;
        const o = d.rooms.find((x) => x !== id);
        if (zone(o) === "circulation" || own.get(o)) continue;
        own.set(o, root);
        queue.push(o);
      }
    }
  }
  return own;
}

const isPair = (d, pairOf) => pairOf && d.rooms?.includes(pairOf[0]) && d.rooms?.includes(pairOf[1]);
/**
 * The properties whose lamps are switched, `most` names at the most (SWITCHES_MOST): every shop (a shop, a bar, a
 * clinic, a workshop) first, in the site's order, then the homes (flats, a tenement's rooms, a manor's household)
 * building by building in the site's order, a building's homes all or none (a landing where one flat has a switch
 * and the next has none reads as a fault); a building whose homes do not fit is passed over for the next.
 * `{ chosen: [{ building, property, kind, name, rooms }], skipped: [the same] }`; the name
 * `<site>_<building>_<property>_light`.
 */
export function switchesOf(plan, style = loadStyle(plan.site.style), most = SWITCHES_MOST) {
  const shops = [];
  const homes = []; // by building
  for (const b of plan.site.buildings) {
    const l = plan.layouts.get(b.id);
    if (!l?.rooms) continue;
    const program = programOf(plan.site, b, style);
    const props = propertiesOf(l, style, program.oneProperty);
    const kindOf = new Map(l.rooms.map((r) => [r.id, r.kind]));
    const own = [];
    for (const p of [...new Set(props.values())].filter(Boolean)) {
      const kind = program.oneProperty ? "home" : FRONT_KINDS.has(kindOf.get(p)) ? "shop" : HOME_KINDS.has(kindOf.get(p)) ? "home" : null;
      if (!kind) continue;
      const rooms = [...props].filter(([, q]) => q === p).map(([r]) => r);
      const one = { building: b.id, property: p, kind, name: `${plan.site.name}_${b.id}_${p}_light`, rooms };
      (kind === "shop" ? shops : own).push(one);
    }
    if (own.length) homes.push(own);
  }
  const chosen = [];
  const skipped = [];
  for (const p of shops) (chosen.length < most ? chosen : skipped).push(p);
  for (const group of homes) (chosen.length + group.length <= most ? chosen : skipped).push(...group);
  return { chosen, skipped };
}

/** The leaf's name of a doorway of building b: its property's, `<site>_<building>_<room>`; a secret door's `..._hideout`. */
export const doorNameOf = (site, b, props, program = {}, circulation = () => false) => (d) => {
  if (isPair(d, program.secret)) return `${site.name}_${b.id}_hideout`;
  // (a door between a hall that is entered and a room off it is the room's: a police post's guard room, not its counter hall)
  const rooms = (d.rooms ?? []).filter(Boolean).sort((p, q) => Number(circulation(p)) - Number(circulation(q)));
  const owner = rooms.map((r) => props.get(r)).find(Boolean) ?? null;
  // the flat that hides the den is the hideout's too (frontOf): its door opens to everybody, or a player who came up
  // from the sewer by the den's trapdoor and through the secret door would stand in a home he cannot leave
  return owner ? `${site.name}_${b.id}_${frontOf(props, program) === owner ? "hideout" : owner}` : null;
};
/** The property that holds the room a secret door opens into from the flat (the den's front flat), or null. */
const frontOf = (props, program = {}) => (program.secret ? (props.get(program.secret[0]) ?? null) : null);

const wallOf = (e, [w, h]) => (e.from[1] === e.to[1] ? (e.from[1] === 0 ? "south" : e.from[1] === h ? "north" : null) : e.from[0] === 0 ? "west" : e.from[0] === w ? "east" : null); // prettier-ignore
/** The site cell outside a building's outside edge. */
function outsideCell(b, e) {
  const [w, h] = b.size;
  const side = wallOf(e, b.size);
  const [x, y] = [Math.min(e.from[0], e.to[0]), Math.min(e.from[1], e.to[1])];
  const local = { south: [x, -1], north: [x, h], west: [-1, y], east: [w, y] }[side];
  return local ? [b.at[0] + local[0], b.at[1] + local[1]] : null;
}

/** Measures the site against its style's `site` rules. */
export function checkSite(plan, style = loadStyle(plan.site.style)) {
  const failures = [];
  const warnings = [];
  const R = style.site ?? {};
  const cite = (rule) => (rule.source ?? []).join(", ");
  const say = (rule, s) => (rule.level === "fail" ? failures : warnings).push(`${s} (${cite(rule)})`);
  const { site, cells } = plan;
  const measures = { properties: { shop: 0, home: 0, other: 0 }, porticoes: [], street: null, streets: [], square: null };
  const label = (x, y) => cells[y]?.[x] ?? null;

  if (R.porticoDepth)
    for (const [k, p] of (site.porticoes ?? []).entries()) {
      const deep = p.rows[1] - p.rows[0];
      measures.porticoes.push(deep);
      if (deep < R.porticoDepth.cells) say(R.porticoDepth, `portico ${k + 1}: ${deep} ${deep === 1 ? "cell" : "cells"} deep; a portico wants ${R.porticoDepth.cells} at least from its columns to the shop fronts`); // prettier-ignore
    }
  if (R.streetWidth)
    for (const a of site.areas.filter((a) => a.kind === "street")) {
      const wide = a.shape === "diagonal" ? a.width / GRID : Math.min(a.to[0] - a.from[0], a.to[1] - a.from[1]);
      measures.streets.push(wide);
      measures.street ??= wide;
      const [lo, hi] = R.streetWidth.cells;
      if (wide < lo || wide > hi) say(R.streetWidth, `${a.name}: its carriageway is ${wide} cells (${(wide * GRID * 0.0254).toFixed(1)} m) across; it wants ${lo} to ${hi}`); // prettier-ignore
    }
  if (R.square)
    for (const a of site.areas.filter((a) => a.landmark !== undefined || a.kind === "square")) {
      const { from, to, landmark } = a;
      const [sw, sh] = [to[0] - from[0], to[1] - from[1]];
      measures.square ??= [sw, sh];
      const q = R.square;
      const its = a.name === "the square" ? "the square" : a.name;
      if (sw < q.least[0] || sh < q.least[1]) say(q, `${its}: ${sw} x ${sh} cells; it wants ${q.least.join(" x ")} at least (12 m across both ways)`); // prettier-ignore
      if (sw * sh < q.leastCells) say(q, `${its}: ${sw * sh} cells (${Math.round(sw * sh * (GRID * 0.0254) ** 2)} m2); it wants ${q.leastCells} at least (150 m2)`); // prettier-ignore
      if (Math.max(sw, sh) / Math.min(sw, sh) > q.ratio) say(q, `${its}: ${sw} x ${sh} cells is longer than ${q.ratio} to 1`);
      if (!landmark) say(q, `${its} has no landmark; it wants the column in its middle`);
      else {
        const clear = Math.min(landmark[0] - from[0], landmark[1] - from[1], to[0] - landmark[0] - 3, to[1] - landmark[1] - 3); // prettier-ignore
        if (clear < q.clearRound) say(q, `${its}: its column stands ${clear} ${clear === 1 ? "cell" : "cells"} from the square's edge; it wants ${q.clearRound} clear round it`); // prettier-ignore
      }
    }

  // the properties, building by building
  const footprints = new Map();
  const shapes = [];
  for (const b of site.buildings) {
    const l = plan.layouts.get(b.id);
    if (!l?.storeyPlans?.length) continue;
    const program = programOf(site, b, style);
    const key = [...b.size].sort((p, q) => p - q).join("x");
    if (R.uniqueFootprints && footprints.has(key)) say(R.uniqueFootprints, `buildings ${footprints.get(key)} and ${b.id} share the footprint ${b.size.join(" x ")}; no two buildings are alike`); // prettier-ignore
    footprints.set(key, b.id);
    const props = propertiesOf(l, style, program.oneProperty);
    const zone = (id) => style.kinds[l.rooms.find((r) => r.id === id)?.kind]?.zone;
    if (program.oneProperty) measures.properties.home++;
    else
      for (const [room, owner] of props)
        if (owner === room && zone(room) !== "circulation") {
          const kind = l.rooms.find((r) => r.id === room).kind;
          measures.properties[kind === "shop" ? "shop" : HOME_KINDS.has(kind) ? "home" : "other"]++;
        }
    if (R.property) {
      for (const d of l.doors) {
        // a door off a common hall or landing (zone circulation) joins the hall to a property, not two properties
        if (d.rooms.some((r) => zone(r) === "circulation")) continue;
        const [p, q] = d.rooms.map((r) => props.get(r));
        if (p && q && p !== q) say(R.property, `building ${b.id}: door ${d.rooms.join("-")} joins two properties (${p} and ${q}); a property is not reached through another's door`); // prettier-ignore
      }
      for (const r of l.rooms) if (zone(r.id) !== "circulation" && !props.get(r.id)) say(R.property, `building ${b.id}: room ${r.id} is entered from no public floor or stair hall; it belongs to no property`); // prettier-ignore
      for (const en of l.entrances ?? []) {
        const c = outsideCell(b, en.edges[0]);
        if (!c || !PUBLIC.has(label(...c))) say(R.property, `building ${b.id}: the entrance of ${en.room} opens onto ${c ? label(...c) ?? "the site's edge" : "nothing"} at ${c?.join(",")}; an entrance opens onto public floor`); // prettier-ignore
      }
    }
    if (R.shopOnStreet)
      for (const r of l.rooms.filter((r) => r.kind === "shop")) {
        const en = (l.entrances ?? []).find((x) => x.room === r.id);
        const c = en && outsideCell(b, en.edges[0]);
        if (!c || !["portico", "street", "square", "plaza"].includes(label(...c))) say(R.shopOnStreet, `building ${b.id}: shop ${r.id}'s door opens onto ${c ? label(...c) : "no wall"}; a shop opens under the portico, on the street`); // prettier-ignore
      }
    // the stair halls and landings are left out: the one stair piece makes them alike in every building; and cells, alike
    // by design as the cities' cell blocks are
    for (const r of l.rooms.filter((r) => style.kinds[r.kind]?.zone !== "circulation" && r.kind !== "cell")) {
      const rect = largestRectangle(l.storeyPlans[r.storey].cells, r.id);
      shapes.push(`${r.kind}:${rect.sides.join("x")}:${r.cells}`);
    }
  }
  if (R.uniqueFootprints && shapes.length) {
    const shared = shapes.filter((s, i) => shapes.indexOf(s) !== shapes.lastIndexOf(s)).length / shapes.length;
    measures.roomsShared = +shared.toFixed(2);
    if (shared > R.uniqueFootprints.roomsShared) say(R.uniqueFootprints, `${Math.round(shared * 100)} % of the rooms share a shape with another; it wants ${Math.round(R.uniqueFootprints.roomsShared * 100)} % at most`); // prettier-ignore
  }
  const { shop, home } = measures.properties;
  if (R.homesShare && shop + home) {
    const share = home / (shop + home);
    measures.homesShare = +share.toFixed(2);
    if (share < R.homesShare.value) say(R.homesShare, `${home} homes of ${shop + home} properties (${Math.round(share * 100)} %); homes want ${Math.round(R.homesShare.value * 100)} % at least`); // prettier-ignore
  }
  measures.checkpoints = (site.walls ?? []).reduce((n, w) => n + (w.gates?.length ?? 0), 0);
  return { failures, warnings, measures };
}

/** The cells a doorway's leaf sweeps on the ground storey of every building, as site cells "x,y". */
export function sweptCells(plan) {
  const swept = new Set();
  for (const b of plan.site.buildings) {
    const l = plan.layouts.get(b.id);
    for (const w of [...(l?.doors ?? []), ...(l?.entrances ?? [])]) if ((w.storey ?? 0) === 0) for (const k of sweptBy(l.storeyPlans[0].cells, w)) { const [x, y] = k.split(",").map(Number); swept.add(`${x + b.at[0]},${y + b.at[1]}`); } // prettier-ignore
  }
  return swept;
}

/**
 * The spawns of a site: along each street's middle line every 4 cells, and in the corners of each plaza and square;
 * kept on public floor, out of every leaf's swing and 4 cells (256) from the ones kept before them; 32 at most (TS
 * reads the first 32).
 */
export function spawnsOf(plan) {
  const { site, cells } = plan;
  const swept = sweptCells(plan);
  const wanted = [];
  for (const a of site.areas) {
    const [w, h] = [a.to[0] - a.from[0], a.to[1] - a.from[1]];
    if (a.shape) wanted.push(...(plan.shapes?.spawnsFor(a) ?? []));
    else if (a.kind === "street") {
      if (w >= h) for (let x = a.from[0] + 2; x < a.to[0] - 1; x += 4) wanted.push({ at: [x + 0.5, (a.from[1] + a.to[1]) / 2], yaw: x < (a.from[0] + a.to[0]) / 2 ? 0 : 180 }); // prettier-ignore
      else for (let y = a.from[1] + 2; y < a.to[1] - 1; y += 4) wanted.push({ at: [(a.from[0] + a.to[0]) / 2, y + 0.5], yaw: y < (a.from[1] + a.to[1]) / 2 ? 90 : 270 }); // prettier-ignore
    } else if (a.kind === "square" || a.kind === "plaza")
      for (const [x, y] of [[a.from[0] + 1, a.from[1] + 1], [a.to[0] - 1, a.from[1] + 1], [a.from[0] + 1, a.to[1] - 1], [a.to[0] - 1, a.to[1] - 1]]) wanted.push({ at: [x, y], yaw: 90 }); // prettier-ignore
  }
  // (and the spawns the site names itself, `spawns: [{ at: [x, y] (cells), yaw }]`, where the areas' own do not come to enough)
  for (const s of site.spawns ?? []) wanted.push({ at: s.at, yaw: s.yaw ?? 90 });
  const kept = [];
  for (const s of wanted) {
    const c = [Math.floor(s.at[0]), Math.floor(s.at[1])];
    if (!PUBLIC.has(cells[c[1]]?.[c[0]]) || ["ramp", "stair"].includes(cells[c[1]][c[0]]) || swept.has(c.join(","))) continue;
    if (kept.some((k) => Math.hypot(k.at[0] - s.at[0], k.at[1] - s.at[1]) < 4)) continue;
    kept.push(s);
    if (kept.length === 32) break;
  }
  return kept;
}

/** Checks spawns against the style's rule: enough of them, apart, on public floor, out of every doorway's swing. */
export function checkSpawns(plan, spawns, style = loadStyle(plan.site.style)) {
  const failures = [];
  const R = style.site?.spawns;
  if (!R) return { failures };
  const cite = (R.source ?? []).join(", ");
  if (spawns.length < R.least) failures.push(`${spawns.length} spawns; a site wants ${R.least} at least (${cite})`);
  for (let i = 0; i < spawns.length; i++)
    for (let j = i + 1; j < spawns.length; j++) {
      const d = Math.hypot(spawns[i].at[0] - spawns[j].at[0], spawns[i].at[1] - spawns[j].at[1]) * GRID;
      if (d < R.apart) failures.push(`spawns ${i + 1} and ${j + 1} stand ${Math.round(d)} apart; spawns want ${R.apart} at least (${cite})`); // prettier-ignore
    }
  const swept = sweptCells(plan);
  for (const [i, s] of spawns.entries()) {
    const c = [Math.floor(s.at[0]), Math.floor(s.at[1])];
    const what = plan.cells[c[1]]?.[c[0]];
    if (!PUBLIC.has(what)) failures.push(`spawn ${i + 1} stands on ${what ?? "nothing"} at ${c.join(",")}; a spawn stands on public floor (${cite})`); // prettier-ignore
    if (swept.has(c.join(","))) failures.push(`spawn ${i + 1} stands at ${c.join(",")}, where a door's leaf swings (${cite})`);
  }
  return { failures };
}

/** A theme by its name: themes/<name>.json, its districts' texture swaps. */
export function loadTheme(name) {
  if (!name) return null;
  const file = join(HERE, "themes", `${name}.json`);
  if (!existsSync(file)) throw new Error(`theme ${name}: there is no levels/assembly/themes/${name}.json`);
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Every texture the door piece wears turned to the wall's (but the compiler's own): a secret door in its wall. */
function secretSwap(library, wall) {
  const door = pieceFor(library, "edge", "door");
  const table = {};
  if (!door) return table;
  const got = placed(door, {});
  for (const b of [...got.brushes, ...got.entities.flatMap((e) => e.brushes ?? [])])
    for (const f of b.faces) if (!/^(ORIGIN|CLIP|SKY|NULL)$/i.test(f.texture)) table[f.texture] = wall;
  return table;
}

/**
 * The site as one map: every building assembled where it stands, in its district's theme (assemble.mjs with site
 * false: the street's facade, a public room's shopfront and shop window, a home's wood floor, every leaf named for its
 * property, a secret door in its wall's texture, a cell's door a grate), then the streets: paving under every public
 * cell, the porticoes (a column every 2 cells on the column line, the architrave over it, the portico's ceiling over
 * its cells, a lamp under every third cell), the squares' columns, the walls between districts with their checkpoint
 * gates, wall lamps on the facades over public floor, the spawns, the sun, the texture lights and the sky round all.
 */
export function assembleSite(plan, library, options = {}) {
  const { site, cells } = plan;
  const style = options.style ?? loadStyle(site.style);
  const theme = loadTheme(site.theme);
  const swapOf = (district) => theme?.districts?.[district]?.swap ?? null;
  const districtAt = (x, y) => plan.districts?.[y]?.[x] ?? null;
  const [W, H] = site.size;
  const failures = [...plan.failures];
  const warnings = [...plan.warnings];
  const brushes = [];
  const entities = [];
  const counts = {};
  const count = (k, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
  const doorways = [];
  const shellDoorways = []; // a shell's locked doors (shell.mjs): for the hood over them; no name, no key, not the RP's
  const lamps = [];
  const world = (x, y, z = 0) => [x * GRID, y * GRID, z];
  // the ground of a cell (terrain.mjs): 0 on a flat site
  const T = plan.terrain;
  const gz = (x, y) => T?.ground[y]?.[x] ?? 0;
  const need = (slot, which) => {
    const p = pieceFor(library, slot, which);
    if (!p) failures.push(`the library has no ${slot} piece for ${JSON.stringify(which)}; the site needs one`);
    return p;
  };
  let detail = { lamp: [], solid: [], crown: [] };
  // a Kowloon or tower building's facade and roof clutter (func_detail brushes) cut the space round it into many leaves, so
  // that a func_wall of its crown or solid pieces as long as a plain building's overlaps more than hlvis's 48 leaves (its
  // bbox warning), and splitting it into pieces costs edicts (the Byzantium map stands near H9's 1200). Such a building's
  // crown and solid pieces are func_detail like its facade (no entity at all; the compiler folds them into the world); its
  // wall lamps, which keep their entity (no clip hull), are split at REACH_DENSE
  let dense = false;
  const apart = (asDetail = dense) => {
    if (detail.solid.length) {
      if (dense) entities.push(brushEntity("func_detail", detail.solid, { zhlt_detaillevel: 1 }));
      else entities.push(...apartEntities("func_wall", detail.solid, { zhlt_lightflags: 2 }));
    }
    if (detail.lamp.length) entities.push(...apartEntities("func_wall", detail.lamp, LAMP_ENTITY, dense ? REACH_DENSE : APART_REACH));
    if (detail.crown.length) {
      if (asDetail) entities.push(brushEntity("func_detail", detail.crown, { zhlt_detaillevel: 1 }));
      else entities.push(...apartEntities("func_wall", detail.crown, CROWN_ENTITY, APART_REACH_SKY));
    }
    detail = { lamp: [], solid: [], crown: [] };
  };
  const put = (piece, at, turn = 0, swap = null, stretch = null) => {
    let got = swapped(placed(piece, { at, turn }), swap);
    if (stretch) {
      const along = (b) => stretched(b, ...stretch, GRID);
      got = { ...got, brushes: got.brushes.map(along), entities: got.entities.map((e) => (e.brushes ? { ...e, brushes: e.brushes.map(along) } : e)) }; // prettier-ignore
    }
    if (DETAIL_SLOTS.has(piece.slot)) {
      detail[piece.slot === "lamp" ? "lamp" : piece.slot === "crown" ? "crown" : "solid"].push(...got.brushes, ...got.entities.filter((e) => e.classname === "func_detail").flatMap((e) => e.brushes ?? [])); // prettier-ignore
      entities.push(...got.entities.filter((e) => e.classname !== "func_detail"));
    } else {
      brushes.push(...got.brushes);
      entities.push(...got.entities);
    }
    count(piece.id);
    return got;
  };

  // the buildings
  let highest = 2 * STOREY;
  const wallLamp = need("lamp", "wall");
  // the switches (README, "Switches and the jail"): the properties whose lamps are switched, and the piece
  const switches = switchesOf(plan, style, options.switches ?? SWITCHES_MOST);
  const switchPiece = need("switch", "light");
  const switched = [];
  let jail = null;
  // a switch on the wall beside doorway d, on the side of `room`, at the latch side of the doorway's frame
  const switchAt = (d, room) => {
    const a = (d.place.turn * Math.PI) / 180;
    const [c, sn] = [Math.round(Math.cos(a)), Math.round(Math.sin(a))];
    return { at: [d.place.at[0] + SWITCH_X * c, d.place.at[1] + SWITCH_X * sn, d.place.at[2]], turn: (d.place.turn + (d.swing === room ? 0 : 180)) % 360 }; // prettier-ignore
  };
  const putSwitch = (d, room, target, swap, keys = {}) => {
    const { at, turn } = switchAt(d, room);
    const got = put(switchPiece, at, turn, swap);
    for (const e of got.entities) if (e.classname === "func_button") Object.assign(e, { target, ...keys });
    return at;
  };
  // wall lamps on a building's ground storey's plain outside walls over open public floor (not under a portico), every third
  const streetLamps = (b, l, swap) => {
    if (!wallLamp) return;
    const plain = l.storeyPlans[0].edges.filter((e) => e.kind === "exterior" && ["street", "plaza", "square", "alley", "paving"].includes(cells[outsideCell(b, e)?.[1]]?.[outsideCell(b, e)?.[0]])); // prettier-ignore
    plain.forEach((e, i) => {
      if (i % 3 !== 1) return;
      const ge = { from: [e.from[0] + b.at[0], e.from[1] + b.at[1]], to: [e.to[0] + b.at[0], e.to[1] + b.at[1]] };
      const c = outsideCell(b, e);
      const lesser = e.from[1] === e.to[1] ? c[1] < b.at[1] + e.from[1] : c[0] < b.at[0] + e.from[0];
      const f = edgeFrame(ge, lesser ? 0 : 1);
      put(wallLamp, world(...f.at, b.groundZ ?? 0), f.turn, swap);
      count("street-lamp");
    });
    apart();
  };
  for (const b of site.buildings) {
    const l = facadeOf(plan, b); // (a shell's facade: shell.mjs)
    if (!l?.storeyPlans?.length) continue;
    dense = !!(b.kowloon || towerOf(b));
    const program = programOf(site, b, style);
    const props = propertiesOf(l, style, program.oneProperty);
    const kindOf = new Map(l.shell ? Object.entries(l.roomKinds) : l.rooms.map((r) => [r.id, r.kind])); // (a shell's facade keeps its room kinds, not its rooms)
    const room = (sides) => sides.find((v) => typeof v === "string" && kindOf.has(v));
    const edgeKind = (e, s, sides) => {
      const front = wallOf(e, b.size) === b.front;
      if (e.kind === "entrance") return FRONT_KINDS.has(kindOf.get(room(sides))) ? "shopfront" : "entrance";
      if (e.kind === "window") return front && s === 0 && FRONT_KINDS.has(kindOf.get(room(sides))) ? "shop-window" : "window";
      if (e.kind === "exterior") return front ? "facade" : "exterior";
      return e.kind;
    };
    const floorKind = (s, c, id) => (HOME_KINDS.has(kindOf.get(id)) ? "home" : "floor");
    const swap = swapOf(b.district);
    const wallTexture = swap?.sinmarblewall ?? "sinmarblewall";
    if (isShell(b)) {
      // a shell: the facade and a solid mass behind it, no door entity, no property, no lamp inside (shell.mjs)
      const got = assembleShell(l, library, { edgeKind, floorKind, swap, lampScale: options.lampScale ?? SITE_LAMP_SCALE, mergeSlabs: options.mergeSlabs ?? true, mergeWalls: options.mergeWalls ?? true, straightPosts: options.straightPosts ?? false, groundGlass: options.groundGlass ?? site.groundGlass }); // prettier-ignore
      for (const f of got.report.failures) failures.push(`building ${b.id}: ${f}`);
      for (const f of got.report.warnings) warnings.push(`building ${b.id}: ${f}`);
      brushes.push(...got.brushes);
      entities.push(...got.entities);
      for (const [k, n] of Object.entries(got.report.counts.pieces ?? {})) count(k, n);
      count("shell");
      for (const d of got.report.doorways) shellDoorways.push({ building: b.id, ...d });
      highest = Math.max(highest, l.storeys * STOREY + (b.groundZ ?? 0));
      streetLamps(b, l, swap);
      continue;
    }
    const grated = new Set(program.grated ?? []);
    const isGrated = (d) => (d.rooms ?? []).some((r) => grated.has(kindOf.get(r)));
    const mine = switches.chosen.filter((p) => p.building === b.id);
    // a trapdoor's shaft down to the level below: no floor over it
    const holes = new Set((plan.below?.ways ?? []).filter((w) => w.kind === "trapdoor" && w.building === b.id && w.local).map((w) => `0:${w.local.join(",")}`)); // prettier-ignore
    const lampNameOf = new Map(mine.flatMap((p) => p.rooms.map((r) => [r, p.name])));
    const built = assemble(l, library, {
      site: false,
      edgeKind,
      floorKind,
      swap,
      doorSwap: (d) => (isPair(d, program.secret) ? secretSwap(library, wallTexture) : isGrated(d) ? { wood8dn: "{grate1", [swap?.wood8dn ?? "wood8dn"]: "{grate1" } : null), // prettier-ignore
      doorKeys: (d) => {
        if (isGrated(d)) return { rendermode: 4, renderamt: 255, dmg: 0, ...(program.control ? { spawnflags: CELL_DOOR_FLAGS } : {}) };
        const owner = (d.rooms ?? []).map((r) => props.get(r)).find(Boolean);
        const kind = isPair(d, program.secret) || (owner !== undefined && frontOf(props, program) === owner) ? "hideout" : propertyKindOf(kindOf.get(owner), program.oneProperty); // prettier-ignore
        return { dmg: 0, ...(DOOR_KEYS[kind] ?? {}) };
      },
      lampName: (room) => lampNameOf.get(room) ?? null,
      holes,
      doorName: doorNameOf(site, b, props, program, (r) => style.kinds[kindOf.get(r)]?.zone === "circulation"),
      // site.doors "teleport": every door a player passes becomes a shut wall with two spots; a jail cell's grated door stays a leaf (the control room's switch opens it)
      teleportDoors: (d) => site.doors === "teleport" && !isGrated(d),
      light: MESE_LIGHT,
      lampScale: options.lampScale ?? SITE_LAMP_SCALE,
      flushLamp: (kind) => !HANGING.has(kind),
      mergeSlabs: options.mergeSlabs ?? true,
      mergeWalls: options.mergeWalls ?? true,
      straightPosts: options.straightPosts ?? false,
      open: options.open,
      groundGlass: options.groundGlass ?? site.groundGlass,
      detail: new Set(["lamp"]),
      detailEntity: { classname: "func_wall", ...LAMP_ENTITY },
    });
    for (const f of built.report.failures) failures.push(`building ${b.id}: ${f}`);
    for (const f of built.report.warnings) warnings.push(`building ${b.id}: ${f}`);
    brushes.push(...built.map.brushes);
    entities.push(...built.map.entities);
    for (const [k, n] of Object.entries(built.report.counts.pieces)) count(k, n);
    for (const d of built.report.doorways) doorways.push({ building: b.id, ...d });
    for (const lamp of built.report.lamps ?? []) lamps.push({ building: b.id, ...lamp });
    // a switch for each switched property, inside its door from the hall, the landing or the street
    const lit = new Set((built.report.switched ?? []).map((g) => g.name));
    for (const p of mine) {
      // (its door from outside it: the street door first, then a hall's, an extra door to a hall last)
      const outOf = built.report.doorways.filter((q) => q.place && q.rooms.some((r) => p.rooms.includes(r)) && q.rooms.some((r) => !r || props.get(r) !== p.property)); // prettier-ignore
      const d = outOf.find((q) => q.rooms.some((r) => !r)) ?? outOf.find((q) => !q.extra) ?? outOf[0];
      if (!lit.has(p.name)) warnings.push(`building ${b.id}: ${p.property} has no lamp to switch; it has no switch`);
      else if (!d || !switchPiece) failures.push(`building ${b.id}: ${p.property} has no door from outside it to put its switch by`);
      else {
        const room = d.rooms.find((r) => p.rooms.includes(r));
        switched.push({ ...p, at: putSwitch(d, room, p.name, swap), door: d.targetname });
        count("light-switch");
      }
    }
    // the jail: its cells' doors opened only from the control room's switch, through one multi_manager
    if (program.control && switchPiece && !program.watch) {
      const cells = built.report.doorways.filter((q) => q.rooms.some((r) => grated.has(kindOf.get(r))));
      const d = built.report.doorways.find((q) => q.place && q.rooms.includes(program.control));
      if (!cells.length || !d) failures.push(`building ${b.id}: the jail wants cells and a door into ${program.control}`);
      else {
        const name = `${site.name}_${b.id}_jail`;
        const at = putSwitch(d, program.control, name, { ...(swap ?? {}), ...JAIL_FACE }, { sounds: 3 });
        entities.push(pointEntity("multi_manager", [at[0], at[1], at[2] + 72], { targetname: name, ...Object.fromEntries(cells.map((q) => [q.targetname, 0])) })); // prettier-ignore
        jail = { building: b.id, name, room: program.control, at, doors: cells.map((q) => q.targetname) };
        count("jail-control");
      }
    }
    // a tower's shell storeys (tower.mjs): solid, world brushes, over the roof of the second storey
    if (towerOf(b)) {
      brushes.push(...towerBrushes(b, l, swap));
      count("tower-storey", towerOf(b));
    }
    highest = Math.max(highest, (l.storeys + towerOf(b)) * STOREY + (b.groundZ ?? 0));
    streetLamps(b, l, swap);
  }

  // the skyline (README, "The skyline"): a crenellated parapet on each roof edge open to the sky (none where a roof
  // meets a neighbour's), a turret on each corner where two of them meet, and a dome on a roof that asks for one; on
  // the fronts over public floor (not under a portico's slab), a balcony under every other upper window and a hood
  // over each home's street door (a shop's has its sign there)
  const parapet = need("crown", "parapet");
  const merlon = need("crown", "merlon");
  const merlonBoth = need("crown", "merlon-both");
  const turret = need("crown", "corner");
  // battlements over grid edges along one line, the outside on `side` (edgeFrame's): the parapet's wall one brush a
  // straight run (split where the edges stop meeting or the district changes), a merlon on each edge (`both`: seen from
  // both sides, a wall with a street on each)
  const battlements = (edges, side, z, both = false) => {
    const runs = [];
    for (const e of edges) {
      const last = runs.at(-1)?.at(-1);
      const meets = last && (last.to[0] === e.from[0] && last.to[1] === e.from[1]) && last.district === e.district;
      if (meets) runs.at(-1).push(e);
      else runs.push([e]);
    }
    for (const run of runs) {
      const swap = swapOf(run[0].district);
      const f = edgeFrame(run[0], side);
      if (parapet) put(parapet, world(...f.at, z), f.turn, swap, run[0].from[1] === run[0].to[1] ? [run.length, 1] : [1, run.length]); // prettier-ignore
      const m = both ? merlonBoth : merlon;
      if (m) for (const e of run) {
        const g = edgeFrame(e, side);
        put(m, world(...g.at, z), g.turn, swap);
      }
    }
  };
  const inSite = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const roofCuts = roofOpenings(plan);
  const balcony = need("front", "balcony");
  const hood = need("front", "hood");
  const buildingAt = (x, y) => site.buildings.find((q) => x >= q.at[0] && y >= q.at[1] && x < q.at[0] + q.size[0] && y < q.at[1] + q.size[1]); // prettier-ignore
  const onStreet = (c) => !!c && PUBLIC.has(cells[c[1]]?.[c[0]]) && cells[c[1]][c[0]] !== "portico";
  for (const b of site.buildings) {
    const l = facadeOf(plan, b);
    if (!l?.storeyPlans?.length) continue;
    const swap = swapOf(b.district ?? districtAt(...b.at));
    dense = !!(b.kowloon || towerOf(b));
    const [[x0, y0], [w, h]] = [b.at, b.size];
    const top = (l.storeys + towerOf(b)) * STOREY + (b.groundZ ?? 0);
    // a roof edge takes battlements where the cell outside it is the site's and no building's (beyond the site's edge
    // nobody stands to see them)
    const district = b.district ?? districtAt(...b.at);
    const open = { south: new Set(), north: new Set(), west: new Set(), east: new Set() };
    const free = (x, y) => inSite(x, y) && !buildingAt(x, y);
    for (let i = 0; i < w; i++) {
      if (free(x0 + i, y0 - 1)) open.south.add(i);
      if (free(x0 + i, y0 + h)) open.north.add(i);
    }
    for (let j = 0; j < h; j++) {
      if (free(x0 - 1, y0 + j)) open.west.add(j);
      if (free(x0 + w, y0 + j)) open.east.add(j);
    }
    // where a way up or a link of the roofs meets the edge, the rail and its parapet are open (roofs.mjs)
    for (const side of SIDES) for (const i of roofCuts.get(b.id)?.[side] ?? []) open[side].delete(i);
    const along = (set, edge) => [...set].sort((a, c) => a - c).map((i) => ({ ...edge(i), district }));
    battlements(along(open.south, (i) => ({ from: [x0 + i, y0], to: [x0 + i + 1, y0] })), 1, top);
    battlements(along(open.north, (i) => ({ from: [x0 + i, y0 + h], to: [x0 + i + 1, y0 + h] })), 0, top);
    battlements(along(open.west, (j) => ({ from: [x0, y0 + j], to: [x0, y0 + j + 1] })), 1, top);
    battlements(along(open.east, (j) => ({ from: [x0 + w, y0 + j], to: [x0 + w, y0 + j + 1] })), 0, top);
    if (roofWalks(b)) brushes.push(...roofRails(b, open, top)); // a walked roof is fenced in the clip hulls (shell.mjs)
    // the shell's form (massing.mjs): a corbelled cornice on each street front, a hipped roof where nobody walks the roof
    {
      const look = (n) => swap?.[n] ?? n;
      const massing = []; // (func_detail without a clip hull, in the world: they are seen from the street and the roofs, never walked)
      massing.push(...corniceBrushes(b, open, [top], { sides: look(MASS_LOOK.cornice) }));
      // a round tower on each corner that two streets of two cells or more run past (walkable, level, and clear of every door)
      const level = (x, y) => PUBLIC.has(cells[y]?.[x]) && cells[y][x] !== "portico" && gz(x, y) === (b.groundZ ?? 0) && !plan.shapes?.owns(x, y);
      const mine = [...doorways, ...shellDoorways].filter((q) => q.building === b.id).map((q) => q.middle);
      // the foot of each street front battered, where the street is two cells wide and level and no door is near
      {
        const talus = { south: new Set(), north: new Set(), west: new Set(), east: new Set() };
        const doorAt = (px, py) => mine.some((m) => Math.hypot(m[0] - px, m[1] - py) < 80);
        const wide = (c, d) => level(c[0], c[1]) && level(c[0] + d[0], c[1] + d[1]);
        for (const i of open.south) if (wide([x0 + i, y0 - 1], [0, -1]) && !doorAt((x0 + i + 0.5) * GRID, y0 * GRID)) talus.south.add(i);
        for (const i of open.north) if (wide([x0 + i, y0 + h], [0, 1]) && !doorAt((x0 + i + 0.5) * GRID, (y0 + h) * GRID)) talus.north.add(i);
        for (const j of open.west) if (wide([x0 - 1, y0 + j], [-1, 0]) && !doorAt(x0 * GRID, (y0 + j + 0.5) * GRID)) talus.west.add(j);
        for (const j of open.east) if (wide([x0 + w, y0 + j], [1, 0]) && !doorAt((x0 + w) * GRID, (y0 + j + 0.5) * GRID)) talus.east.add(j);
        const feet = talusBrushes(b, talus, b.groundZ ?? 0, look(MASS_LOOK.talus));
        if (feet.length) entities.push(brushEntity("func_detail", feet, { zhlt_detaillevel: 1, zhlt_noclip: 1 })); // (a battered skirt to look at: it takes no clip hull, so the streets' nodes along the walls stay walkable)
        count("talus", feet.length);
      }
      for (const [cx, cy, sx, sy] of [[x0, y0, -1, -1], [x0 + w, y0, 1, -1], [x0 + w, y0 + h, 1, 1], [x0, y0 + h, -1, 1]]) {
        const cell = (i, j) => [sx < 0 ? cx - 1 - i : cx + i, sy < 0 ? cy - 1 - j : cy + j]; // the cell i out along x and j out along y from the corner
        let clear = true;
        for (let i = 0; i < TOWER.clear; i++) for (let j = 0; j < TOWER.clear; j++) if (!level(...cell(i, j))) clear = false;
        if (!clear || mine.some((m) => Math.hypot(m[0] - cx * GRID, m[1] - cy * GRID) < 150)) continue;
        massing.push(cornerTower(cx * GRID, cy * GRID, (b.groundZ ?? 0) - 16, top, look(MASS_LOOK.tower)));
        count("corner-tower");
      }
      if (!roofWalks(b) && !b.dome) {
        const hip = hipRoof(b, top, { sides: look(MASS_LOOK.roof) });
        if (hip) {
          massing.push(hip);
          highest = Math.max(highest, top + 96);
        }
      }
      if (massing.length) entities.push(brushEntity("func_detail", massing, { zhlt_detaillevel: 1, zhlt_noclip: 1 }));
      count("massing", massing.length);
    }
    if (turret)
      for (const [x, y, a, c] of [[0, 0, open.south.has(0), open.west.has(0)], [w, 0, open.south.has(w - 1), open.east.has(0)], [w, h, open.north.has(w - 1), open.east.has(h - 1)], [0, h, open.north.has(0), open.west.has(h - 1)]]) // prettier-ignore
        if (a && c) put(turret, world(x0 + x, y0 + y, top), 0, swap);
    if (b.dome && DOMES[b.dome]) {
      const d = DOMES[b.dome];
      if (Math.min(w, h) < d.across) warnings.push(`building ${b.id}: its roof is ${w} x ${h} cells; the ${b.dome} dome wants ${d.across} across, and is left off`); // prettier-ignore
      else {
        // near the front, a cell clear of the parapet, so it stands over it seen from the street (in a block's middle
        // the front's own parapet hides it from anyone close enough to see it)
        const piece = need("crown", d.kind);
        const back = (piece?.size?.[0] ?? 0) / 2 / GRID + 1;
        const at = { south: [x0 + w / 2, y0 + back], north: [x0 + w / 2, y0 + h - back], west: [x0 + back, y0 + h / 2], east: [x0 + w - back, y0 + h / 2] }[b.front]; // prettier-ignore
        if (piece) put(piece, world(...at, top), 0, swap);
        highest = Math.max(highest, top + (piece?.size?.[2] ?? 0));
      }
    }
    // a front piece's frame: its edges' span, the outside its -y
    const frameOut = (edges) => {
      const xs = edges.flatMap((e) => [e.from[0], e.to[0]]);
      const ys = edges.flatMap((e) => [e.from[1], e.to[1]]);
      const span = { from: [Math.min(...xs) + x0, Math.min(...ys) + y0], to: [Math.max(...xs) + x0, Math.max(...ys) + y0] };
      const c = outsideCell(b, edges[0]);
      const lesser = span.from[1] === span.to[1] ? c[1] < span.from[1] : c[0] < span.from[0];
      return edgeFrame(span, lesser ? 1 : 0, edges.length);
    };
    if (balcony)
      for (let s = 1; s < l.storeys; s++)
        l.storeyPlans[s].edges
          .filter((e) => e.kind === "window" && onStreet(outsideCell(b, e)))
          .forEach((e, i) => {
            if (i % 2) return;
            const f = frameOut([e]);
            put(balcony, world(...f.at, s * STOREY + (b.groundZ ?? 0)), f.turn, swap);
          });
    if (hood) {
      const kindOf = new Map(l.rooms.map((r) => [r.id, r.kind]));
      // in the entrance piece's own frame (the hood's outside its -y, as the door's)
      for (const d of [...doorways, ...shellDoorways].filter((q) => q.building === b.id && q.kind === "entrance" && !q.storey && q.place)) {
        const out = [0, 1].map((k) => Math.floor((d.middle[k] - d.into[k] * GRID / 2) / GRID));
        if (FRONT_KINDS.has(kindOf.get(d.rooms?.[0])) || !onStreet(out)) continue;
        put(hood, d.place.at, d.place.turn, swap);
      }
    }
    apart();
  }

  dense = false;
  // the streets: paving, porticoes, the columns; none over a way down to the level below
  const opened = new Set((plan.below?.ways ?? []).filter((w) => w.kind !== "trapdoor").flatMap((w) => w.opens));
  const joinLabel = (label) => label === "ramp" || label === "stair";
  const paving = need("floor", "paving");
  // the paving of each district joined into rectangles (one brush each, as the buildings' floors)
  if (paving) {
    const byDistrict = new Map();
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (PUBLIC.has(cells[y][x]) && !joinLabel(cells[y][x]) && !opened.has(`${x},${y}`) && !plan.shapes?.owns(x, y)) {
          const d = `${districtAt(x, y)}@${gz(x, y)}`;
          (byDistrict.get(d) ?? byDistrict.set(d, new Set()).get(d)).add(`${x},${y}`);
        }
    for (const [d, set] of byDistrict) for (const [x, y, rw, rh] of rectanglesOf(set)) put(paving, world(x, y, gz(x, y)), 0, swapOf(districtAt(x, y)), [rw, rh]); // prettier-ignore
  }
  // the routes over the roofs: ladders, stairs and crate climbs up the walls, planks and bridges across the gaps (roofs.mjs)
  let roofsReport = null;
  if (plan.roofs) {
    const got = roofBrushes(plan, library, { swapOf });
    failures.push(...got.report.failures);
    brushes.push(...got.brushes);
    entities.push(...got.entities);
    for (const [k, n] of Object.entries(got.report.counts)) count(`roof-${k}`, n);
    roofsReport = { counts: got.report.counts, keepClear: [...roofGround(plan)] }; // (keepClear: the cells the dressing leaves bare)
  }
  // the shaped areas' floors and walls, angled, whole-number brushes (shapes.mjs)
  if (plan.shapes?.list.length) {
    const cut = shapeBrushes(plan.shapes, { zOf: (a) => gz(...a.from), textures: (a) => ({ floor: swapOf(districtAt(...a.from))?.marb, wall: swapOf(districtAt(...a.from))?.sinmarblewall }) });
    brushes.push(...cut.brushes);
    count("shape-floor", cut.counts.floor);
    count("shape-wall", cut.counts.wall);
  }
  const column = need("column", "portico");
  const beam = need("architrave", "portico");
  const roof = need("portico", "portico");
  const lamp = need("lamp", "ceiling");
  for (const p of site.porticoes ?? []) {
    const swap = swapOf(districtAt(p.cells[0], p.rows[0]));
    const pz = gz(p.cells[0], p.rows[0]);
    for (let y = p.rows[0]; y < p.rows[1]; y++)
      for (let x = p.cells[0]; x < p.cells[1]; x++) {
        if (roof) put(roof, world(x, y, pz), 0, swap);
        // a lamp under every third cell, in the row by the shop fronts
        const inner = p.columns === p.rows[1] ? p.rows[0] : p.rows[1] - 1;
        if (lamp && y === inner && (x - p.cells[0]) % 3 === 1) put(lamp, world(x, y, pz), 0, swap);
      }
    // the column line, set back into the portico where a shaped area (an oval's solid corners) stands on its street side
    // (porticoes.mjs): a column on the line would stand half inside that mass, its shaft and capital off the beam they carry
    const inset = porticoInset(plan, p);
    const onLine = (x) => {
      const at = world(x, p.columns, pz);
      at[1] += inset;
      return at;
    };
    for (let x = p.cells[0]; x <= p.cells[1]; x += 2) if (column) put(column, onLine(x), 0, swap);
    if ((p.cells[1] - p.cells[0]) % 2 && column) put(column, onLine(p.cells[1]), 0, swap); // the last column at the end
    for (let x = p.cells[0]; x < p.cells[1]; x++) if (beam) put(beam, onLine(x), 0, swap);
    apart();
  }
  for (const a of site.areas.filter((a) => a.landmark)) {
    const piece = need("landmark", "column");
    if (piece) {
      put(piece, world(...a.landmark, gz(...a.landmark)), 0, swapOf(districtAt(...a.landmark)));
      apart();
      highest = Math.max(highest, (piece.size?.[2] ?? 504) + gz(...a.landmark));
    }
  }

  // the walls between districts, and their checkpoints: a wall piece on each edge, a gate (an entrance piece, its leaf
  // named, opened by use) over the 2 edges round each gate's vertex, its leaf swinging to the wall's greater side
  const wallPiece = need("edge", "exterior");
  const gatePiece = need("edge", "entrance");
  let gates = 0;
  for (const w of site.walls ?? []) {
    const along = w.from[1] === w.to[1] ? 0 : 1;
    const [lo, hi] = [Math.min(w.from[along], w.to[along]), Math.max(w.from[along], w.to[along])];
    const fixed = w.from[1 - along];
    const vertex = (t) => (along === 0 ? [t, fixed] : [fixed, t]);
    // a wall between two heights stands on the higher
    const wz = wallGround(T?.ground ?? null, w);
    const inGate = (t) => [...(w.gates ?? []), ...(w.gaps ?? [])].some((g) => g[along] - 1 <= t && t < g[along] + 1);
    for (let t = lo; t < hi; t++) {
      const swap = swapOf(districtAt(...(along === 0 ? [t, fixed] : [fixed, t])) ?? districtAt(...(along === 0 ? [t, fixed - 1] : [fixed - 1, t])));
      const f = edgeFrame({ from: vertex(t), to: vertex(t + 1) }, 1);
      if (inGate(t)) continue;
      if (wallPiece) put(wallPiece, world(...f.at, wz), f.turn, swap);
      count("wall");
    }
    // battlements over the wall and its gates
    const districtOf = (t) => districtAt(...(along === 0 ? [t, fixed] : [fixed, t])) ?? districtAt(...(along === 0 ? [t, fixed - 1] : [fixed - 1, t])); // prettier-ignore
    battlements(Array.from({ length: hi - lo }, (_, k) => ({ from: vertex(lo + k), to: vertex(lo + k + 1), district: districtOf(lo + k) })), 1, STOREY + wz, true); // prettier-ignore
    // a gap: a plain passage, the gate's frame with no leaf and no checkpoint (nothing to name, nothing to lock)
    for (const g of w.gaps ?? []) {
      const span = { from: along === 0 ? [g[0] - 1, g[1]] : [g[0], g[1] - 1] };
      span.to = along === 0 ? [span.from[0] + 2, span.from[1]] : [span.from[0], span.from[1] + 2];
      const f = edgeFrame(span, 1, 2);
      if (gatePiece) {
        const got = put(gatePiece, world(...f.at, wz), f.turn, swapOf(districtAt(...g)));
        for (const e of got.entities.filter((q) => /^func_door/.test(q.classname))) entities.splice(entities.indexOf(e), 1);
      }
      count("passage");
    }
    for (const g of w.gates ?? []) {
      gates++;
      const span = { from: along === 0 ? [g[0] - 1, g[1]] : [g[0], g[1] - 1] };
      span.to = along === 0 ? [span.from[0] + 2, span.from[1]] : [span.from[0], span.from[1] + 2];
      const f = edgeFrame(span, 1, 2);
      if (gatePiece) {
        const got = put(gatePiece, world(...f.at, wz), f.turn, swapOf(districtAt(...g)));
        const name = `${site.name}_checkpoint_${gates}`;
        for (const e of got.entities) if (/^func_door/.test(e.classname)) Object.assign(e, { targetname: name, dmg: 0 });
        doorways.push({ building: null, name: `checkpoint ${gates} (${w.name})`, targetname: name, kind: "gate", at: g });
      }
      count("checkpoint");
    }
  }

  // the site's ends: wherever public floor meets the site's edge, a blind front BACKDROP storeys high (the exterior
  // wall, the facade's cornice on its top storey) in that district's look, its outer face to the street, so a street
  // ends in the city and not in the sky. On the west and south edges side 0 of edgeFrame turns the outer face in.
  const facadePiece = need("edge", "facade");
  const ends = [];
  for (let x = 0; x < W; x++) ends.push([x, 0, { from: [x, 0], to: [x + 1, 0] }, 0], [x, H - 1, { from: [x, H], to: [x + 1, H] }, 1]); // prettier-ignore
  for (let y = 0; y < H; y++) ends.push([0, y, { from: [0, y], to: [0, y + 1] }, 0], [W - 1, y, { from: [W, y], to: [W, y + 1] }, 1]); // prettier-ignore
  const tops = new Map(); // the ends' tops by line, for their battlements
  for (const [x, y, edge, side] of ends) {
    if (!PUBLIC.has(cells[y]?.[x])) continue;
    const line = `${edge.from[0] === edge.to[0] ? "x" : "y"}${edge.from[0] === edge.to[0] ? edge.from[0] : edge.from[1]}`;
    const endZ = gz(x, y);
    (tops.get(`${line}@${endZ}`) ?? tops.set(`${line}@${endZ}`, { side, edges: [], z: endZ }).get(`${line}@${endZ}`)).edges.push({ ...edge, district: districtAt(x, y) });
    const f = edgeFrame(edge, side);
    for (let s = 0; s < BACKDROP; s++) {
      const piece = s === BACKDROP - 1 ? facadePiece : wallPiece;
      if (piece) put(piece, world(...f.at, s * STOREY + endZ), f.turn, swapOf(districtAt(x, y)));
    }
    count("backdrop");
  }
  for (const { side, edges, z } of tops.values()) battlements(edges.sort((a, b) => a.from[0] - b.from[0] || a.from[1] - b.from[1]), side, BACKDROP * STOREY + z); // prettier-ignore
  highest = Math.max(highest, BACKDROP * STOREY + (T?.highest ?? 0));
  // (the ends' crown stands beside the towers, whose facades cut the space there into leaves: as func_detail, or its bbox
  // overlaps more than hlvis's 48, and splitting it would cost edicts)
  apart(site.buildings.some((q) => q.kowloon || towerOf(q)));

  // the level below the streets (below.mjs): its walls and doors into the world, its lamps and columns apart
  let below = null;
  if (plan.below) {
    const look = (name) => swapOf(name);
    const got = assembleBelow(plan, library, {
      put,
      entities,
      swapOf: look,
      streetSwap: ([x, y]) => swapOf(districtAt(x, y)),
      // a secret door: each face in the wall's texture of the part it looks into (below.mjs, facing)
      doorSwap: (d, part = d.between.find((q) => q !== d.swing)) => (d.secret ? secretSwap(library, look(plan.below.parts.find((p) => p.id === part)?.look ?? plan.site.below.look ?? "sewer")?.po_sewerwall ?? "po_sewerwall") : null), // prettier-ignore
      name: site.name,
      open: options.open,
    });
    brushes.push(...(got.brushes ?? []));
    entities.push(...(got.entities ?? []));
    for (const f of got.report.failures) failures.push(f);
    for (const [k, n] of Object.entries(got.report.counts ?? {})) count(k, n);
    below = got.report;
    apart();
  }

  // the mission arenas, sealed rooms out beside the city (arena.mjs)
  const arena = arenasOf(site, site.name);
  brushes.push(...arena.brushes);
  entities.push(...arena.entities);
  failures.push(...arena.report.failures);
  if (arena.arenas.length) count("arena", arena.arenas.length);
  // the metro's fake rides: a ride room and the zones, buttons and managers of each direction (ride.mjs)
  const rides = ridesOf(plan, site.name);
  brushes.push(...rides.brushes);
  entities.push(...rides.entities);
  failures.push(...rides.report.failures);
  if (rides.rides.length) count("ride", rides.rides.length);

  // the spawns, the sun, the texture lights, the sky
  const spawns = spawnsOf(plan);
  for (const s of spawns) entities.push(playerStart(world(...s.at, gz(Math.floor(s.at[0]), Math.floor(s.at[1]))), s.yaw, "info_player_deathmatch"));
  // and one start for a game of one player (the console's `map` with maxplayers 1), whose rules look for no other
  if (spawns.length) entities.push(playerStart(world(...spawns[0].at, gz(Math.floor(spawns[0].at[0]), Math.floor(spawns[0].at[1]))), spawns[0].yaw));
  const top = highest + SKY_OVER;
  const [X, Y] = [W * GRID, H * GRID];
  // the site's own sun (an evening, `sun` in the site: the RP cities' streets are dim and their rooms brighter)
  const sun = { ...SUN, ...(site.sun ?? {}) };
  entities.push(pointEntity("light_environment", [32, 32, top - 32], { _light: [...sun.color, sun.brightness], _diffuse_light: sun.diffuse, angles: [0, sun.yaw, 0], pitch: sun.pitch })); // prettier-ignore
  const texlights = Object.fromEntries(Object.entries(library.texlights ?? {}).map(([n, [r, g, bb, i]]) => [n, [r, g, bb, Math.round(i * (options.texlightScale ?? TEXLIGHT_SCALE))]])); // prettier-ignore
  if (Object.keys(texlights).length) entities.push(textureLights([96, 32, top - 32], texlights));
  const sky = "SKY";
  // the sky's floor under the ground, but under a way down (the level below closes itself: below.mjs)
  // (and under a stair from the street where the ground varies: cut through the fill and the floor, the paving its roof: below-levels.mjs)
  const roofed = (below?.roofed ?? []).map((c) => c.join(","));
  const holes = new Set([...opened, ...roofed, ...(below?.floorHoles ?? []).map((h) => h.at.join(","))]);
  // (a site with a channel or a quay below z 0 has its floor under the lowest of them, and the ground filled up to its cells: terrain.mjs)
  const dug = T ? terrainBrushes(T, { holes: new Set([...opened, ...roofed, ...(below?.floorHoles ?? []).map((h) => h.at.join(","))]), water: site.water?.texture ?? WATER_DEFAULT.texture }) : { brushes: [], floor: 0 };
  brushes.push(...dug.brushes);
  // a lamp in each culvert every two cells (an unlit tunnel is black), under its ceiling
  for (const c of T?.culverts ?? [])
    for (let i = 0; i < c.len; i += 2) {
      const [cx, cy] = c.axis === "x" ? [c.from[0] + i + 0.5, (c.from[1] + c.to[1]) / 2] : [(c.from[0] + c.to[0]) / 2, c.from[1] + i + 0.5];
      entities.push(pointEntity("light", world(cx, cy, c.ceil - 16), { _light: [255, 210, 150, 120] }));
    }
  const F = dug.floor;
  if (!holes.size) brushes.push(box([-16, -16, F - 32], [X + 16, Y + 16, F - 16], sky));
  else {
    const ground = new Set();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!holes.has(`${x},${y}`)) ground.add(`${x},${y}`);
    for (const [x, y, rw, rh] of rectanglesOf(ground)) brushes.push(box([x * GRID, y * GRID, F - 32], [(x + rw) * GRID, (y + rh) * GRID, F - 16], sky));
    brushes.push(box([-16, -16, F - 32], [0, Y + 16, F - 16], sky), box([X, -16, F - 32], [X + 16, Y + 16, F - 16], sky), box([0, -16, F - 32], [X, 0, F - 16], sky), box([0, Y, F - 32], [X, Y + 16, F - 16], sky)); // prettier-ignore
  }
  brushes.push(
    box([-16, -16, top], [X + 16, Y + 16, top + 16], sky),
    box([-16, -16, F - 16], [0, Y + 16, top], sky),
    box([X, -16, F - 16], [X + 16, Y + 16, top], sky),
    box([0, -16, F - 16], [X, 0, top], sky),
    box([0, Y, F - 16], [X, Y + 16, top], sky),
  );
  apart();
  // the bands, trims and reveals fitted to their brushes, not left on the world's grid (massing.mjs: fitBands)
  count("band-fit", fitBands([...brushes, ...entities.flatMap((e) => e.brushes ?? [])]));
  const named = doorways.filter((d) => d.targetname).length;
  if (named !== doorways.length) failures.push(`${doorways.length - named} of ${doorways.length} doorways have no name; every door is a property's (style ${site.style}, property)`); // prettier-ignore
  // form: a site of axis-aligned boxes reads as made by a program (Valve's maps are 22% off the axes at the median); told, not refused
  warnings.push(...judgeSourceForm({ brushes, entities }));
  const worldspawn = { wad: options.wad ?? (library.wad ?? []).join(";"), skyname: options.sky ?? site.sky ?? "desert", message: `${site.name}` };
  return {
    map: { worldspawn, brushes, entities },
    report: { failures, warnings, counts, roofs: roofsReport, doorways, lamps, spawns, below, arenas: arena.arenas, switches: switched, unswitched: switches.skipped, jail, texlights, size: [X, Y, top], terrain: T?.measures ?? null, floor: F, brushes: brushes.length + entities.reduce((n, e) => n + (e.brushes?.length ?? 0), 0) }, // prettier-ignore
  };
}

/**
 * The light on the compiled site's floors, as the map starts: the median of the public floor (streets, porticoes,
 * squares, lanes) and of the rooms' floors (both storeys), by the lightmap samples under each (src/maps/light.mjs), and
 * the style's rule roomsBrighter held to them.
 */
export function siteLight(bsp, plan, style = loadStyle(plan.site.style)) {
  const failures = [];
  const warnings = [];
  const groups = { public: [], rooms: [] };
  const byBuilding = new Map(plan.site.buildings.map((b) => [b.id, b]));
  floorSamples(
    bsp,
    (point, brightness) => {
      const [x, y] = [Math.floor(point[0] / GRID), Math.floor(point[1] / GRID)];
      const ground = plan.terrain?.ground[y]?.[x] ?? 0; // (a storey is counted from the ground of its cell)
      const storey = Math.round((point[2] - ground) / STOREY);
      if (Math.abs(point[2] - ground - storey * STOREY) > 4 || storey < 0 || storey > 1) return;
      const what = plan.cells[y]?.[x];
      if (!what) return;
      if (storey === 0 && PUBLIC.has(what)) groups.public.push(brightness);
      else if (what.startsWith("building ")) {
        const b = byBuilding.get(what.slice(9));
        const room = plan.layouts.get(b.id)?.storeyPlans[storey]?.cells[y - b.at[1]]?.[x - b.at[0]];
        if (typeof room === "string" && room !== "stair" && room !== "void") groups.rooms.push(brightness);
      }
    },
    stylesCounted(bsp, "start"),
  );
  const median = (list) => (list.length ? [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] : null);
  const measures = { public: median(groups.public), rooms: median(groups.rooms), samples: { public: groups.public.length, rooms: groups.rooms.length } }; // prettier-ignore
  const R = style.site?.roomsBrighter;
  if (R && measures.public !== null && measures.rooms !== null && measures.rooms <= measures.public)
    (R.level === "fail" ? failures : warnings).push(`the rooms' floors are lit ${Math.round(measures.rooms)} of 255 at the median, the public floor ${Math.round(measures.public)}; rooms want to be brighter than the street (${(R.source ?? []).join(", ")})`); // prettier-ignore
  return { failures, warnings, measures };
}

/** The site of a spec file by its name in levels/specs. */
export const siteSpec = (name) => {
  const file = join(HERE, "../specs", `${name}.json`);
  if (!existsSync(file)) throw new Error(`there is no levels/specs/${name}.json`);
  return JSON.parse(readFileSync(file, "utf8"));
};
