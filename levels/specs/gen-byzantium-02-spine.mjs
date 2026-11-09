#!/usr/bin/env node
// Writes byzantium-02-spine.json: Phase 1 of byzantium-02 ("the Spine", design/DESIGN-byzantium-02.md section 5), the first
// playable slice of the new city. Run: node levels/specs/gen-byzantium-02-spine.mjs
//
// The site's cells are 64 units, its origin the slice's south-west corner. The design's frame is centred (X -2304..2304,
// Y -1344..640): world = site - (2304, 1344). The slice is 72 x 38 cells: 72 x 31 (4608 x 1984) of the plan up to the Wall
// Road's north edge, and over it the Wall (a band of shells 7 cells deep) with Gate 2's hall cut in it.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { below } from "./gen-byzantium-02-spine-below.mjs";
import { rp } from "./gen-byzantium-02-spine-rp.mjs";

const W = 72;
const H = 38;
const G = 64;

const areas = [];
const area = (kind, name, from, to, extra = {}) => areas.push({ kind, name, from, to, ...extra });
// the two roads of the plan
area("paving", "the Ring Road", [0, 0], [W, 3]);
area("paving", "the Wall Road", [0, 27], [W, 31]);
// Gate 2's hall, in the Wall (the foot of the Milion ramp of the plan; closed by the wall of the site's edge in this slice)
area("paving", "the hall of Gate 2", [34, 31], [42, 38]);
// the Descent, the Market's plaza. The Descent really descends: from the Wall Road (z 0) down a flight of 3 steps into a
// sunken stretch (z -48) that the Market's plaza and the West Arcade road come down into by stairs, and up a second flight to
// the Ring Road. (Every way down to the sewers stays on ground at z 0: the Wall Road, the plaza, the oval, the court.)
const DEEP = -48; // (the deepest the sewer's vaults under the Hippodrome allow: the world's floor stands 32 under the lowest ground)
area("street", "the Descent (top)", [19, 21], [24, 27]);
area("street", "the Descent", [19, 10], [24, 19], { z: DEEP });
area("street", "the Descent (foot)", [19, 3], [24, 8]);
area("plaza", "the market plaza", [0, 10], [14, 20]);
area("plaza", "the market plaza (east)", [14, 10], [17, 12]);
area("plaza", "the market plaza (north-east)", [14, 18], [19, 20]);
// the Hippodrome: the track (an oval round a spine, cut flat where its entrances are), its arcades and passages
const OVAL = { center: [38 * G, 15 * G], radii: [780, 259] };
// (opened up from the first pass by light and not by walls: the sun and the street light are brighter and the arcades have lamps of their
// own. The track cannot be two cells wider by buildings 5 deep: a shop of 5 puts its hall's entrance on the back wall; and a
// slimmer or shorter spine, 640 x 96, compiles with four illegal brushes, and under 96 is not convex)
area("plaza", "the Hippodrome", [27, 11], [49, 19], { shape: "oval", ...OVAL, spine: { length: 768, width: 128 } });
area("alley", "the West Arcade road", [26, 11], [27, 19]);
area("alley", "the East Arcade road", [49, 11], [52, 19]);
area("alley", "the north entrance", [36, 19], [40, 27]);
area("alley", "the south entrance", [36, 3], [40, 11]);
area("alley", "the post's passage (north)", [33, 21], [36, 27]);
area("alley", "the post's passage (south)", [34, 3], [36, 9]);
area("alley", "the betting hall's lane", [51, 3], [52, 9]);
// (the rest of the West Arcade road, [24, 11]..[26, 19], is the stair down to the Descent: see joins)
// the East Road, the Hollow's court and its alley
area("alley", "the East Road", [52, 3], [57, 27]);
area("plaza", "the Hollow court", [57, 9], [72, 20]);
area("alley", "the Hollow alley", [64, 20], [66, 27]);

const porticoes = [
  { rows: [19, 21], cells: [24, 36], columns: 19 },
  { rows: [19, 21], cells: [40, 52], columns: 19 },
  { rows: [9, 11], cells: [24, 36], columns: 11 },
  { rows: [9, 11], cells: [40, 52], columns: 11 },
];

const buildings = [];
const b = (id, at, size, front, extra = {}) => buildings.push({ id, at, size, front, seed: 1, ...extra });
// the Market (x 0..24): clinic and pawn on the south, the bar and the general store on the north, the post west of the plaza
// (30 homes in all: the flats over the shops are three each, four over the pawn shop, and the Hollow's towers as they were)
b("clinic", [0, 3], [8, 7], "north", { program: "venue-flats", venue: "clinic", backDoor: true, seeds: 8, flats: 3, flatArea: [9, 24] });
// (17 seeds: the stair hall of the first eight stood at the east end of the front, on the plaza stair; seeds 16 and 17 have it at the west end)
b("pawn", [8, 3], [11, 7], "north", { backDoor: true, seeds: 17, flats: 4, flatArea: [10, 22], roof: "walk" });
b("bar", [0, 20], [9, 7], "south", { program: "venue-flats", venue: "bar", backDoor: true, seeds: 8, flats: 3, flatArea: [11, 24] });
b("general", [9, 20], [10, 7], "south", { backDoor: true, seeds: 16, flats: 3, flatArea: [12, 26], roof: "walk" });
b("p12", [14, 12], [5, 6], "east", { program: "post", cells: 0, seeds: 12, z: DEEP });
// the Hippodrome (x 24..52): the post of Gate 2 and the casino on the north, the west watch and the betting hall on the south
b("p2", [24, 21], [8, 6], "south", { program: "post", cells: 0, seeds: 12, roof: "walk" });
b("casino", [40, 21], [12, 6], "south", { backDoor: true, seeds: 16, flats: 3, flatArea: [15, 26], roof: "walk" });
b("p5", [24, 3], [10, 6], "north", { program: "post", cells: 0, seeds: 20, roof: "walk" });
b("betting", [40, 3], [11, 6], "north", { backDoor: true, seeds: 16, flats: 3, flatArea: [14, 24], roof: "walk" });
// the Hollow, west half (x 52..72): two towers on the north, the black market and the lockup on the south
b("t1", [57, 20], [7, 7], "south", { program: "tenement", rooms: 2, tower: 2, kowloon: true, seeds: 20, roof: "walk" });
b("t2", [66, 20], [6, 7], "south", { program: "tenement", rooms: 1, tower: 1, kowloon: true, seeds: 20, roof: "walk" });
b("blackmkt", [57, 3], [9, 6], "north", { backDoor: true, seeds: 16, flats: 3, flatArea: [10, 20], roof: "walk" });
b("p8", [66, 3], [6, 6], "north", { program: "post", cells: 2, seeds: 14 });

// the Wall: blocks of the walled north that no player enters, shells (the facade only) whose roofs are the crest nobody reaches
let w = 0;
for (const [x0, widths] of [[0, [9, 8, 9, 8]], [42, [9, 9]]]) {
  let x = x0;
  for (const wd of widths) b(`wall${++w}`, [x, 31], [wd, 7], "south", { program: "shell", roof: "closed", seeds: 8 }), (x += wd);
}

// and the post of the Wall Road's east end (P11), in the Wall
b("p11", [60, 31], [12, 7], "south", { program: "post", cells: 0, seeds: 12 });

// the Descent's flights (3 steps of 16 each), the stairs into it from the plaza and the arcade, and the retaining walls where the
// sunken stretch meets the arcade's portico (terrain.mjs)
const joins = [
  { kind: "stair", name: "the Descent's first flight", from: [19, 19], to: [24, 21], up: "north", z: [DEEP, 0], landings: 0, rank: "main" },
  { kind: "stair", name: "the Descent's last flight", from: [19, 8], to: [24, 10], up: "south", z: [DEEP, 0], landings: 0, rank: "main" },
  { kind: "stair", name: "the plaza stair", from: [17, 10], to: [19, 12], up: "west", z: [DEEP, 0], landings: 0, rank: "main" },
  { kind: "stair", name: "the West Arcade stair", from: [24, 11], to: [26, 19], up: "east", z: [DEEP, 0], landings: 0, rank: "main" },
  { kind: "wall", name: "the Descent's west wall", from: [19, 18], to: [19, 21] },
  { kind: "wall", name: "the Descent's east wall", from: [24, 10], to: [24, 11] },
];

// The roofs (the flow design, "The rooftop layer"): ladders, crates and outside stairs up; planks, jumps and a bridge across; every roof
// has a way down by the same ways. South: up the ladder at p5, a plank over the Descent to the pawn shop, one over the passage and the
// south entrance to the betting hall, one over its lane and the East Road to the black market, up its stair. North: the general store
// to p2 by a plank over the Descent, p2 to the casino by a bridge over the passage and the north entrance (both streets under it).
// The Hollow's two towers by a jump down (192). No drop: every roof of the city is two storeys, 384, and a fall over 192 hurts.
const roofs = {
  ways: [
    { id: "L1", kind: "ladder", building: "p5", side: "south", at: 3 },
    { id: "C1", kind: "crates", building: "betting", side: "south", at: 2, run: 1 },
    { id: "S1", kind: "stair", building: "blackmkt", side: "south", at: 3, run: 1 },
    { id: "L2", kind: "ladder", building: "p2", side: "north", at: 3 },
    { id: "S2", kind: "stair", building: "casino", side: "north", at: 10, run: 1 },
    { id: "L3", kind: "ladder", building: "t1", side: "south", at: 4 },
    { id: "L4", kind: "ladder", building: "t2", side: "south", at: 2 },
  ],
  links: [
    { id: "P0", kind: "plank", from: "pawn", to: "p5", at: 5, width: 40 },
    { id: "P1", kind: "plank", from: "p5", to: "betting", at: 5, width: 40 },
    { id: "P2", kind: "plank", from: "betting", to: "blackmkt", at: 5, width: 40 },
    { id: "P3", kind: "plank", from: "general", to: "p2", at: 23, width: 36 },
    { id: "B1", kind: "bridge", from: "p2", to: "casino", at: 24, span: 2 },
    { id: "J2", kind: "jump", from: "t1", to: "t2", at: 24 },
  ],
};

const site = {
  format: "smak-site/1",
  name: "smak_rp_byz02s",
  style: "byzantium",
  theme: "techno-byzantium",
  note: "Byzantium-02, phase 1, the Spine: the first playable slice of the new city (design/DESIGN-byzantium-02.md section 5). The Market (plaza, bar, clinic, pawn, general store), the Hippodrome (an oval track round a spine, its arcades, the casino and the betting hall), the Hollow's west half (two towers, the court, the lockup), the Wall Road with Gate 2 and the Descent, the Ring Road, and under all of it the first sewer level S1. Cells of 64; y up is north; the origin is the slice's south-west corner (the plan's centred frame is this minus 2304, 1344).",
  size: [W, H],
  range: 8000,
  groundGlass: "sealed",
  // (every door a player passes is a shut wall with two spots and a use-teleport, as Cry of Fear's inter_door: no leaf to stall, to jam or to block; levels/assembly/assemble.mjs teleportDoors)
  doors: "teleport",
  seeds: 6,
  sky: "ts_gpc",
  // (an evening, a little brighter than the first pass: the streets read dark in the game)
  sun: { color: [255, 160, 100], brightness: 70, diffuse: [65, 58, 80, 50], yaw: 250, pitch: -20 },
  // (the Descent, in three stretches, gives fewer of the street's own spawns: two more, in the middle of the plaza and of the court)
  spawns: [{ at: [6.5, 15.5], yaw: 0 }, { at: [64.5, 14.5], yaw: 180 }],
  streetLight: { every: 5, z: 144, color: [255, 205, 140], spot: { cone: 30, cone2: 62, fade: 1 }, brightness: { market: 900, hippodrome: 950, hollow: 700 }, portico: { z: 104, brightness: { hippodrome: 140, market: 110 } } },
  // the whole map is moved to sit about the origin (the compiled map, its RP file and its paths): the site's frame is the
  // south-west corner, the world's is its middle (X -2304.., Y -1280..), inside +-4096
  recentre: [-2304, -1280],
  districts: [
    { id: "market", from: [0, 0], to: [24, H] },
    { id: "hippodrome", from: [24, 0], to: [52, H] },
    { id: "hollow", from: [52, 0], to: [W, H] },
  ],
  areas,
  joins,
  roofs,
  porticoes,
  walls: [{ name: "the Wall at Gate 2", from: [34, 31], to: [42, 31], gates: [[38, 31]] }],
  buildings,
  ...rp,
  below,
};

const out = join(dirname(fileURLToPath(import.meta.url)), "byzantium-02-spine.json");
writeFileSync(out, `${JSON.stringify(site, null, 2)}\n`);
console.log(`wrote ${out}: ${buildings.length} buildings, ${areas.length} areas`);
