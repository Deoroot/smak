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
// the Descent, the Market's plaza
area("street", "the Descent", [19, 3], [24, 27]);
area("plaza", "the market plaza", [0, 10], [14, 20]);
area("plaza", "the market plaza (east)", [14, 10], [19, 12]);
// the Hippodrome: the track (an oval round a spine, cut flat where its entrances are), its arcades and passages
const OVAL = { center: [38 * G, 15 * G], radii: [780, 259] };
area("plaza", "the Hippodrome", [27, 11], [49, 19], { shape: "oval", ...OVAL, spine: { length: 768, width: 128 } });
area("alley", "the West Arcade road", [24, 11], [27, 19]);
area("alley", "the East Arcade road", [49, 11], [52, 19]);
area("alley", "the north entrance", [36, 19], [40, 27]);
area("alley", "the south entrance", [36, 3], [40, 11]);
area("alley", "the post's passage (north)", [33, 21], [36, 27]);
area("alley", "the post's passage (south)", [34, 3], [36, 9]);
area("alley", "the betting hall's lane", [51, 3], [52, 9]);
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
b("clinic", [0, 3], [8, 7], "north", { program: "venue-flats", venue: "clinic", backDoor: true, seeds: 8 });
b("pawn", [8, 3], [11, 7], "north", { backDoor: true, seeds: 8 });
b("bar", [0, 20], [9, 7], "south", { program: "venue-flats", venue: "bar", backDoor: true, seeds: 8 });
b("general", [9, 20], [10, 7], "south", { backDoor: true, seeds: 8 });
b("p12", [14, 12], [5, 6], "east", { program: "post", cells: 0, seeds: 12 });
// the Hippodrome (x 24..52): the post of Gate 2 and the casino on the north, the west watch and the betting hall on the south
b("p2", [24, 21], [8, 6], "south", { program: "post", cells: 0, seeds: 12 });
b("casino", [40, 21], [12, 6], "south", { backDoor: true, seeds: 8 });
b("p5", [24, 3], [10, 6], "north", { program: "post", cells: 0, seeds: 12 });
b("betting", [40, 3], [11, 6], "north", { backDoor: true, seeds: 8 });
// the Hollow, west half (x 52..72): two towers on the north, the black market and the lockup on the south
b("t1", [57, 20], [7, 7], "south", { program: "tenement", rooms: 2, tower: 2, kowloon: true, seeds: 14 });
b("t2", [66, 20], [6, 7], "south", { program: "tenement", rooms: 1, tower: 1, kowloon: true, seeds: 14 });
b("blackmkt", [57, 3], [9, 6], "north", { backDoor: true, seeds: 14 });
b("p8", [66, 3], [6, 6], "north", { program: "post", cells: 2, seeds: 14 });

// the Wall: blocks of the walled north that no player enters, shells (the facade only) whose roofs are the crest nobody reaches
let w = 0;
for (const [x0, widths] of [[0, [9, 8, 9, 8]], [42, [9, 9]]]) {
  let x = x0;
  for (const wd of widths) b(`wall${++w}`, [x, 31], [wd, 7], "south", { program: "shell", roof: "walk", seeds: 8 }), (x += wd);
}

// and the post of the Wall Road's east end (P11), in the Wall
b("p11", [60, 31], [12, 7], "south", { program: "post", cells: 0, seeds: 12 });

const site = {
  format: "smak-site/1",
  name: "smak_rp_byz02s",
  style: "byzantium",
  theme: "techno-byzantium",
  note: "Byzantium-02, phase 1, the Spine: the first playable slice of the new city (design/DESIGN-byzantium-02.md section 5). The Market (plaza, bar, clinic, pawn, general store), the Hippodrome (an oval track round a spine, its arcades, the casino and the betting hall), the Hollow's west half (two towers, the court, the lockup), the Wall Road with Gate 2 and the Descent, the Ring Road, and under all of it the first sewer level S1. Cells of 64; y up is north; the origin is the slice's south-west corner (the plan's centred frame is this minus 2304, 1344).",
  size: [W, H],
  range: 8000,
  groundGlass: "sealed",
  seeds: 6,
  sky: "ts_gpc",
  sun: { color: [255, 150, 90], brightness: 45, diffuse: [110, 90, 120, 75], yaw: 250, pitch: -15 },
  districts: [
    { id: "market", from: [0, 0], to: [24, H] },
    { id: "hippodrome", from: [24, 0], to: [52, H] },
    { id: "hollow", from: [52, 0], to: [W, H] },
  ],
  areas,
  porticoes,
  walls: [{ name: "the Wall at Gate 2", from: [34, 31], to: [42, 31], gates: [[38, 31]] }],
  buildings,
  ...rp,
  below,
};

const out = join(dirname(fileURLToPath(import.meta.url)), "byzantium-02-spine.json");
writeFileSync(out, `${JSON.stringify(site, null, 2)}\n`);
console.log(`wrote ${out}: ${buildings.length} buildings, ${areas.length} areas`);
