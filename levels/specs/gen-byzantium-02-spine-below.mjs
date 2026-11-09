// S1 of the Spine (design/DESIGN-byzantium-02.md sections 3.4 and 5): the first level under the slice, now a METRO (the person's word
// after playing it, 2026-11-08: "en lugar de alcantarillas, un subsuelo o un metro"; levels/assembly/metro.mjs), in the site's units
// (cells of 64; the origin the slice's south-west corner). Every number here is checked by levels/assembly/below-levels.mjs and
// metro.mjs (readLevels, planLevels, checkLevels, checkMetro); the sentences they give when one is wrong are the way to move a hall.
//
//   Wall Road (y 1728..1984), the line along y 1888 from west to east (second version, 2026-11-08: two LONG stations, 1088 each, a parked
//   train of two cars at one platform of each, and a fake ride between them: levels/assembly/ride.mjs):
//     entrance A (stair-west, 160 wide, an arch over its head) -> concourse conc-w -> two passages -> station st-w ==line== station st-e
//     -> two passages -> concourse conc-e -> entrance B (stair-east)
//   Back passages (service corridors, the metro look): conc-w to collapse, desc to st-w, spina to st-e, st-e to sluice; the old halls stay:
//   Market (x < 1216): collapse under the plaza (the collapsed end of the first line) and smug (the smugglers' market, in the old ticket
//   hall) under the pawn shop, desc (a signal room) under the Descent; Hippodrome: spina (the depot) under the oval, with three ways up;
//   Hollow: sluice (a substation) under the court, two ways up. The ride rooms are out in the map's volume (z -3200 and -2800).
const L = (id, p) => ({ id, ...p });
const lights = {
  amber: { color: [255, 170, 80], brightness: 150, every: 192 },
  blue: { color: [110, 150, 255], brightness: 150, every: 192 },
  station: { color: [210, 195, 175], brightness: 150, every: 192 }, // cream fluorescents over the platforms
  wall: { color: [180, 110, 90], brightness: 170, every: 192 }, // warm lamps on the platforms' back walls, 150 up
  concourse: { color: [210, 195, 175], brightness: 170, every: 128 },
  line: { color: [180, 110, 90], brightness: 150, every: 192 }, // warm lamps on the line's walls: pools of light, dark between
  old: { color: [235, 210, 170], brightness: 130, every: 160 }, // the disused halls: dusty cream
  service: { color: [205, 198, 188], brightness: 140, every: 192 }, // the service corridors and halls: cool cream, as a maintenance lamp
};
const Y = 1888; // the line's axis, the middle of a street stair's three cells (28..30: the lane of the Wall Road at its south side, row 27, stays free of the trench)
const station = { width: 192, depth: 40, crossings: [128], benches: { every: 160 } };
const columns = { every: 192, half: 24 };

const halls = [
  // the line, west to east: a concourse, a long station (1088: a parked train of two cars on its south platform), a stretch of line, a second long station (the train on its north platform), a concourse
  L("conc-w", { shape: "rect", center: [896, Y], size: [256, 544], height: 192, ceiling: "flat", look: "metro", light: "concourse", role: "concourse", columns: { every: 128, radius: 14 } }),
  L("st-w", { shape: "rect", center: [1664, Y], size: [1088, 544], height: 256, ceiling: "cove", cove: 32, look: "metro", light: "station", trench: { ...station, crossings: [408], train: { side: 0, cars: 2, from: 96 } }, columns }),
  L("st-e", { shape: "rect", center: [3008, Y], size: [1088, 544], height: 256, ceiling: "cove", cove: 32, look: "metro", light: "station", trench: { ...station, crossings: [-424], train: { side: 1, cars: 2, from: 192 } }, columns }),
  L("conc-e", { shape: "rect", center: [3776, Y], size: [256, 544], height: 192, ceiling: "flat", look: "metro", light: "concourse", role: "concourse", columns: { every: 128, radius: 14 } }),
  // the old halls: the plaza's collapse and the smugglers' market, dusty cream and concrete (the old ticket hall; a collapsed end of the first line)
  L("collapse", { shape: "rect", center: [768, 1024], size: [384, 256], height: 192, look: "metro-old", light: "old" }),
  L("smug", { shape: "rect", center: [832, 512], size: [512, 384], height: 224, look: "metro-old", light: "old", columns: { every: 128, radius: 16 } }),
  // the metro's service halls: the signal room under the Descent, the depot under the oval (it was the cistern: no basin, no water now), the substation under the court
  L("desc", { shape: "octagon", center: [1344, 1024], radius: 192, height: 224, look: "metro-service", light: "service" }),
  L("spina", { shape: "rect", center: [2432, 960], size: [768, 384], height: 256, look: "metro-service", light: "service", columns: { every: 128, radius: 16 } }),
  L("sluice", { shape: "rect", center: [3840, 960], size: [384, 256], height: 224, look: "metro-service", light: "service" }),
];

const passage = (id, y, x0, x1) => L(id, { points: [[x0, y], [x1, y]], width: 112, height: 144, look: "metro", light: "concourse" });
const line = (id, x0, x1) => L(id, { points: [[x0, Y], [x1, Y]], width: 192, height: 176, profile: "house", trench: { depth: 40, ledge: 44 }, look: "metro-line", light: "line" });
const svc = (id, points, extra = {}) => L(id, { points, width: 112, height: 144, look: "metro-service", light: "service", ...extra });
const tunnels = [
  // the line and the passages from the concourses onto the platforms (the south platform's middle is Y - 184, the north's Y + 184)
  line("line-w-e", 2208, 2464),
  passage("pass-w-s", Y - 184, 1024, 1120),
  passage("pass-w-n", Y + 184, 1024, 1120),
  passage("pass-e-s", Y - 184, 3552, 3648),
  passage("pass-e-n", Y + 184, 3552, 3648),
  // service corridors (the metro's own): the Market loop, the Descent to the first station, the depot to the second, the court's substation to the second
  svc("t-conc-collapse", [[864, 1616], [864, 1440], [832, 1312], [832, 1152]], { pipes: 1 }),
  svc("t-collapse-smug", [[704, 896], [704, 704]]),
  svc("t-collapse-desc", [[960, 1024], [1152, 1024]]),
  svc("t-smug-desc", [[1088, 512], [1190, 512], [1344, 666], [1344, 832]]),
  svc("t-desc-st", [[1344, 1216], [1344, 1312], [1408, 1440], [1408, 1616]], { height: 160, pipes: 2 }),
  svc("t-desc-spina", [[1536, 1024], [2048, 1024]], { pipes: 1 }),
  svc("t-spina-st", [[2688, 1152], [2688, 1616]], { pipes: 1 }),
  svc("t-spina-sluice", [[2816, 928], [3000, 928], [3080, 1008], [3380, 1008], [3460, 928], [3648, 928]]),
  svc("t-st-sluice", [[3264, 1616], [3264, 1500], [3480, 1220], [3800, 1220], [3800, 1088]], { pipes: 1 }),
];

export const below = {
  name: "the first level (S1): the metro",
  look: "metro-service",
  rules: { ways: [8, 12], stair: false, looks: 3, longest: 24, source: "design/DESIGN-byzantium-02.md sections 3.4 and 5 (the Spine): S1 under the slice, nine ways down, two of them the metro's entrance stairs a hunting guard follows; the person's word 2026-11-08 (a metro, not sewers)" },
  levels: [{ id: "S1", floor: -384, look: "metro-service", lights, halls, tunnels }],
  // the fake ride between the two stations (ride.mjs): a ride room each way out in the map's volume, east of the arenas
  rides: [{ id: "we", from: "st-w", to: "st-e", at: [2560, 2064, -3200], time: 16, reverse: { id: "ew", at: [2560, 2064, -2800] } }],
  links: [
    // the metro's entrances: 24 steps of 16 by 24, 576 long, 160 wide (three cells), open to the sky for 3 cells under an arch, then under the Wall Road's paving
    { id: "stair-west", kind: "stair", points: [[192, Y, 0], [768, Y, -384]], width: 160, height: 160, look: "metro-stair", metro: true, street: { open: 3, arch: true } },
    { id: "stair-east", kind: "stair", points: [[4480, Y, 0], [3904, Y, -384]], width: 160, height: 160, look: "metro-stair", metro: true, street: { open: 3, arch: true } },
  ],
  surface: [
    { id: "plaza-manhole", hall: "collapse", cell: [10, 17], wall: "north" },
    { id: "pawn-manhole", hall: "smug", cell: [11, 10], wall: "north" }, // (was [14, 10], then [9, 10]: the pawn shop's door is at x 864 and its stair hall's door, since the entrances moved off the stairs, at x 544; [11, 10] keeps 128 and 192 from them. [10, 10] would sit on the mouth of t-collapse-smug),
    { id: "oval-west-manhole", hall: "spina", cell: [32, 13], wall: "west" },
    { id: "oval-south-manhole", hall: "spina", cell: [37, 12], wall: "south" },
    { id: "oval-north-manhole", hall: "spina", cell: [35, 17], wall: "north" },
    { id: "court-manhole", hall: "sluice", cell: [61, 16], wall: "north" },
    { id: "east-road-manhole", hall: "sluice", cell: [57, 16], wall: "west" },
  ],
  places: [
    { id: "smugglers-market", kind: "den", hall: "smug" },
    { id: "collapse", kind: "den", hall: "collapse" },
    { id: "spina-cistern", kind: "office", hall: "spina" },
  ],
  roam: [{ hall: "conc-w" }, { hall: "desc" }, { hall: "sluice" }, { hall: "st-w" }, { hall: "st-e" }, { hall: "conc-e" }, { hall: "spina" }],
};
