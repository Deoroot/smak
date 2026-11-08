// S1 of the Spine (design/DESIGN-byzantium-02.md sections 3.4 and 5): the first sewer level under the slice, in the site's
// units (cells of 64; the origin the slice's south-west corner). Nine halls and twelve tunnels in four loops, two stairs and
// seven ladders from the street. Every number here is checked by levels/assembly/below-levels.mjs (readLevels, planLevels,
// checkLevels); the sentences it gives when one is wrong are the way to move a hall.
//
//   Wall Road (y 1728..1984): weir -- junc -- milion -- junc2, the main channel under it; stair A (west) and stair B (east)
//   Market (x < 1216): collapse under the plaza, smug (the smugglers' market) under the pawn shop, desc under the Descent
//   Hippodrome: spina under the oval, with three ways up; Hollow: sluice under the court, two ways up
const L = (id, p) => ({ id, ...p });
const lights = {
  amber: { color: [255, 170, 80], brightness: 150, every: 192 },
  teal: { color: [90, 200, 190], brightness: 170, every: 160 },
  magenta: { color: [230, 70, 200], brightness: 150, every: 160 },
  blue: { color: [110, 150, 255], brightness: 150, every: 192 },
};

const halls = [
  L("weir", { shape: "octagon", center: [960, 1792], radius: 192, height: 224, look: "cistern", light: "teal" }),
  L("junc", { shape: "octagon", center: [1536, 1792], radius: 192, height: 192, look: "service", light: "amber" }),
  L("milion", { shape: "octagon", center: [2432, 1792], radius: 192, height: 224, look: "service", light: "amber" }),
  L("junc2", { shape: "octagon", center: [3200, 1792], radius: 192, height: 192, look: "service", light: "amber" }),
  L("collapse", { shape: "rect", center: [768, 1024], size: [384, 256], height: 192, look: "smugglers", light: "amber" }),
  L("smug", { shape: "rect", center: [832, 512], size: [512, 384], height: 224, look: "smugglers", light: "magenta", columns: { every: 128, radius: 16 } }),
  L("desc", { shape: "octagon", center: [1344, 1024], radius: 192, height: 224, look: "service", light: "amber" }),
  L("spina", { shape: "rect", center: [2432, 960], size: [768, 384], height: 256, look: "cistern", light: "blue", pool: { depth: 24, inset: 64 }, columns: { every: 128, radius: 16 } }),
  L("sluice", { shape: "rect", center: [3840, 960], size: [384, 256], height: 224, look: "service", light: "amber" }),
];

const tunnels = [
  // the Market loop: weir, collapse, smug, desc, junc, weir
  L("t-weir-collapse", { points: [[960, 1600], [960, 1440], [832, 1312], [832, 1152]], width: 112, height: 144, pipes: 1, light: "amber" }),
  L("t-collapse-smug", { points: [[704, 896], [704, 704]], width: 112, height: 144, look: "smugglers", light: "magenta" }),
  L("t-collapse-desc", { points: [[960, 1024], [1152, 1024]], width: 112, height: 144, look: "service" }),
  L("t-smug-desc", { points: [[1088, 512], [1190, 512], [1344, 666], [1344, 832]], width: 112, height: 144, look: "smugglers" }),
  L("t-desc-junc", { points: [[1344, 1216], [1344, 1312], [1536, 1504], [1536, 1600]], width: 112, height: 160, look: "service", pipes: 2 }),
  // the main channel under the Wall Road
  L("main-weir-junc", { points: [[1152, 1792], [1344, 1792]], width: 112, height: 160, water: { depth: 24, strip: 0.5 } }),
  L("main-junc-milion", { points: [[1728, 1792], [2240, 1792]], width: 112, height: 160, water: { depth: 24, strip: 0.5 } }),
  L("main-milion-junc2", { points: [[2624, 1792], [3008, 1792]], width: 112, height: 160, water: { depth: 24, strip: 0.5 } }),
  // the Hippodrome: the Descent's hall to the cistern, the cistern to the Wall Road's, and east to the Hollow
  L("t-desc-spina", { points: [[1536, 1024], [2048, 1024]], width: 112, height: 144, look: "service", pipes: 1 }),
  L("t-spina-milion", { points: [[2432, 1152], [2432, 1600]], width: 112, height: 144, look: "service", pipes: 1 }),
  L("t-spina-sluice", { points: [[2816, 928], [3000, 928], [3080, 1008], [3380, 1008], [3460, 928], [3648, 928]], width: 112, height: 144, water: { depth: 24, strip: 0.5 } }),
  L("t-junc2-sluice", { points: [[3200, 1600], [3200, 1500], [3480, 1220], [3800, 1220], [3800, 1088]], width: 112, height: 144, look: "smugglers", pipes: 1 }),
];

export const below = {
  name: "the first sewer (S1)",
  look: "sewer",
  rules: { ways: [8, 12], stair: false, looks: 3, longest: 24, source: "design/DESIGN-byzantium-02.md sections 3.4 and 5 (the Spine): S1 under the slice, nine ways down, two of them stairs a hunting guard follows" },
  levels: [{ id: "S1", floor: -384, look: "sewer", lights, halls, tunnels }],
  links: [
    // stairs from the street: 24 steps of 16 by 24, 576 long, open to the sky for 3 cells, then under the Wall Road's paving
    { id: "stair-west", kind: "stair", points: [[192, 1792, 0], [768, 1792, -384]], width: 96, height: 160, look: "stairs", street: { open: 3 } },
    { id: "stair-east", kind: "stair", points: [[3968, 1792, 0], [3392, 1792, -384]], width: 96, height: 160, look: "stairs", street: { open: 3 } },
  ],
  surface: [
    { id: "plaza-manhole", hall: "collapse", cell: [10, 17], wall: "north" },
    { id: "pawn-manhole", hall: "smug", cell: [14, 10], wall: "north" },
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
  roam: [{ hall: "weir" }, { hall: "desc" }, { hall: "sluice" }, { hall: "milion" }, { hall: "junc" }, { hall: "spina" }],
};
