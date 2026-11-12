// A map in numbers and beside another, with no game running:
//   `measure`: the width, the headroom and the sight of every place of a map's floor, on a map built here
//   whose corridor and hall are known by construction; the floor that is walked and every place a player
//   fits; several maps as a table; `smak map-measure`, its --json and its refusals
//   `compareOf`: several maps from above at ONE scale in one picture; `smak map-compare`
//   `viewsOf`: places to start that stand together get one view between them, and a view that is nearly one
//   colour is left out for the next room, and said
//
// The maps are the kit's own: a corridor and a hall carved here with the builders of source.mjs, and the
// two rooms of test/fixtures with more entities put into them.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../check/maps/index.mjs";
import { test, sure, near, HERE, tmp, runSmak, runRefused, SMAK_CLI } from "./helper.mjs";

const FIXTURES = join(HERE, "fixtures");
const tworoomsBytes = readFileSync(join(FIXTURES, "tworooms.bsp"));
const tworooms = maps.readBsp(tworoomsBytes);
const folder = join(tmp, "maps-measure");
mkdirSync(folder, { recursive: true });
const inFolder = (name) => join(folder, name);

// ── the map measured: a corridor that runs into a hall ──
// The corridor is 128 wide and 96 high and runs 512 along +x; the hall is 512 by 512 and 256 high, and the
// corridor opens on the middle of its west wall. Every number below follows from these.
const WEARS = { floor: "FLOOR", ceiling: "CEILING", wall: "WALL" };
const CORRIDOR = { min: [0, 0, 0], max: [512, 128, 96] };
const HALL = { min: [512, -192, 0], max: [1024, 320, 256] };
const IN_THE_CORRIDOR = [64, 64, 0];
const IN_THE_HALL = [768, 64, 0];
const WALL = 16;
/** The corridor and the hall as brush source; `hall`: another hall; `start`: false for a map with none. */
const corridorAndHall = ({ hall = HALL, start = true } = {}) => ({
  worldspawn: {},
  brushes: maps.carve([CORRIDOR, hall], WALL, WEARS),
  entities: [...(start ? [maps.playerStart(IN_THE_CORRIDOR, 0)] : []), maps.light([768, 64, 200])],
});
/** Two halls one over the other with rock between, joined by nothing: the walk begins in the lower. */
const LOWER = { min: [0, 0, 0], max: [256, 256, 128] };
const UPPER = { min: [0, 0, 192], max: [512, 256, 320] };
const twoStoreys = () => ({
  worldspawn: {},
  brushes: maps.carve([LOWER, UPPER], WALL, WEARS),
  entities: [maps.playerStart([128, 128, 0], 0)],
});

const refuses = (run, pattern) => {
  try {
    run();
  } catch (e) {
    return pattern.test(e.message);
  }
  return false;
};
/** The place of a measure that stands at a point of the floor. */
const placeAt = (measured, at) =>
  measured.cells.find((cell) => cell.at.every((value, axis) => value === at[axis]));
const pixelAt = (picture, x, y) => [
  ...picture.rgba.subarray((y * picture.width + x) * 4, (y * picture.width + x) * 4 + 3),
];
const sameColour = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

// ── measure ─────────────────────────────────────────────────────────────────
test("measure: a corridor 128 wide and a hall 512 wide give those widths, their headroom and their sight", () => {
  const measured = maps.measure(corridorAndHall(), { places: true, name: "hall" });
  sure(
    measured.name === "hall" && measured.every === false && measured.grid === 32,
    "what was asked is kept",
  );
  // a place in the corridor: 128 from wall to wall, 96 under its ceiling, and a line to the hall's far wall
  const corridor = placeAt(measured, IN_THE_CORRIDOR);
  sure(corridor, "the place in the corridor is one of the places measured");
  near(corridor.width, 128, 1, "the corridor's width");
  sure(corridor.headroom === 96, `the corridor's headroom: ${corridor.headroom}`);
  near(corridor.sight, 1024 - 64, 1, "from the corridor one sees to the hall's far wall");
  // the middle of the hall: 512 across (the line along the corridor is longer), 256 under its ceiling
  const hall = placeAt(measured, IN_THE_HALL);
  near(hall.width, 512, 1, "the hall's width");
  sure(hall.headroom === 256, `the hall's headroom: ${hall.headroom}`);
  near(hall.sight, 768, 1, "from the hall's middle the longest line runs back down the corridor");
  // the floor: a player's middle comes no nearer a wall than 16, so 3 rows of the grid in the corridor
  // (16 columns of them, the one in the doorway too) and 15 by 15 places in the hall
  sure(measured.places === 16 * 3 + 15 * 15, `the places of the grid that are walked: ${measured.places}`);
  sure(measured.area === measured.places * 32 * 32, "each stands for a square of the grid");
  sure(
    measured.walk.places === measured.places && measured.walk.fitting >= measured.places,
    "the walk's count",
  );
  sure(
    measured.footprint.size.join() === "992,480" &&
      measured.floors.lowest === 0 &&
      measured.floors.highest === 0,
    `the box about the floor, and its one height: ${measured.footprint.size} ${measured.floors.lowest}`,
  );
  near(
    measured.footprint.share,
    (16 * 3 + 15 * 15) / (31 * 15),
    0.002,
    "the share of that box that is floor",
  );
  sure(measured.floors.stacked.most === 1 && measured.floors.levels[0].z === 0, "no floor over another");
  sure(measured.world.size.join() === "1056,544,288", `the world with its walls: ${measured.world.size}`);
  // the bands: the corridor is under 176 wide, the hall's middle 352 and over; and the hall is most of it
  const [narrow, , wide] = measured.width.bands;
  sure(narrow.name === "under 176" && wide.name === "352 and over" && wide.to === null, "the bands' names");
  sure(narrow.share >= 48 / measured.places - 0.001, `the corridor is narrow floor: ${narrow.share}`);
  // (in a hall the lines that cut a corner off are shorter than the hall is wide: its middling place is not 512)
  sure(wide.share > 0.4 && measured.width.median > 256, `the hall is wide floor: ${wide.share}`);
  near(measured.width.most, 512, 2, "and no place of it is wider than the hall");
  near(
    measured.width.bands.reduce((sum, band) => sum + band.share, 0),
    1,
    0.002,
    "the bands are all of it",
  );
  sure(measured.width.least >= 30, `no place walked is narrower than a body: ${measured.width.least}`);
  // the headroom of the narrow floor is the corridor's, that of the rest the hall's
  sure(
    measured.headroom.corridors.median === 96 && measured.headroom.rooms.median === 256,
    `headroom by width: ${measured.headroom.corridors.median} and ${measured.headroom.rooms.median}`,
  );
  sure(
    measured.headroom.most === 256 && measured.headroom.least === 96 && measured.headroom.open === 0,
    "headroom",
  );
  // the sight: nothing is seen farther than the corridor's end to the hall's far corner
  sure(measured.sight.longest <= Math.hypot(1024, 512) && measured.sight.longest >= 960, "the longest sight");
  sure(measured.sight.beyond.length === 700, "the length asked beyond, unless told");
  sure(measured.sight.beyond.share > 0 && measured.sight.beyond.share < 1, "some places see beyond 700");
  // the corridor is an opening of the walk's: a narrow place with a wall on both sides
  sure(
    measured.openings.count === measured.openings.widths.length &&
      (measured.openings.count === 0 || measured.openings.least === 128),
    `the openings are the walk test's: ${JSON.stringify(measured.openings)}`,
  );
  sure(
    measured.facts.some(
      (fact) => fact.includes(`median ${measured.width.median},`) && /under 176 wide/.test(fact),
    ) && measured.facts.some((fact) => /in corridors \(under 176 wide\) median 96/.test(fact)),
    measured.facts.join(" | "),
  );
});

test("measure: its own bands, sight and grid; a lower line stops at what a higher one passes over", () => {
  const map = corridorAndHall();
  const own = maps.measure(map, { bands: [100, 200, 600], sight: 2000, grid: 64 });
  sure(
    own.width.bands.length === 4 && own.width.bands[2].name === "200 to 600",
    "four bands of three widths",
  );
  // nothing is under 100 wide but the hall's corners; the corridor (128) is in the second band
  sure(own.width.bands[1].share > 0 && own.sight.beyond.share === 0, "no place sees 2000 units");
  sure(own.grid === 64 && own.places < maps.measure(map).places / 3, "a coarser grid has fewer places");
  // a bench 48 high across the corridor: a line 60 over the floor passes over it, one 40 over it does not
  const bench = maps.box([256, 0, 0], [272, 128, 48], "WALL");
  const benched = { ...map, brushes: [...map.brushes, bench] };
  const reach = maps.reachOf(map); // the walk of the map without it: the same places are measured
  const over = placeAt(maps.measure(benched, { reach, places: true }), IN_THE_CORRIDOR);
  const under = placeAt(maps.measure(benched, { reach, places: true, eye: 40 }), IN_THE_CORRIDOR);
  near(over.sight, 960, 1, "over the bench");
  near(under.sight, 256 - 64, 1, "stopped by the bench");
  // a wall taken as not there is none for a line either: `open` is the space's as it is the walk's
  const gate = maps.brushEntity("func_wall", maps.box([300, 0, 0], [316, 128, 96], "WALL"), {
    targetname: "gate",
  });
  const gated = { ...map, entities: [...map.entities, gate] };
  near(
    placeAt(maps.measure(gated, { reach, places: true }), IN_THE_CORRIDOR).sight,
    300 - 64,
    1,
    "the gate shut",
  );
  near(
    placeAt(maps.measure(gated, { reach, places: true, open: ["gate"] }), IN_THE_CORRIDOR).sight,
    960,
    1,
    "the gate taken as open",
  );
});

test("measure: every place a player fits, walked to or not, and the floors that lie one over another", () => {
  const map = twoStoreys();
  // the walk begins in the lower hall and never gets to the upper, which is twice its size
  const walked = maps.measure(map);
  sure(walked.floors.highest === 0 && walked.floors.stacked.most === 1, "the walk measures the lower hall");
  sure(walked.headroom.median === 128, `its headroom: ${walked.headroom.median}`);
  sure(
    walked.warnings.some((warning) =>
      /the walk test got to \d+ of the \d+ places a player fits on/.test(warning),
    ),
    `a walk that gets to under half the map is said: ${walked.warnings.join(" | ")}`,
  );
  const every = maps.measure(map, { every: true });
  sure(every.every === true && every.places > 2 * walked.places, `every place: ${every.places}`);
  sure(
    every.floors.lowest === 0 && every.floors.highest === 192 && every.floors.stacked.most === 2,
    `two floors, one over the other: ${JSON.stringify(every.floors)}`,
  );
  sure(
    every.floors.stacked.share > 0.3 && every.floors.stacked.share < 0.6,
    "where the lower hall is under the upper",
  );
  sure(every.floors.levels.map((level) => level.z).join() === "192,0", "the fuller height first");
  sure(
    every.walk.places === walked.places && !every.warnings.length,
    "the walk's count is kept, with no warning",
  );
  sure(/every place a player fits, walked to or not/.test(every.facts[0]), every.facts[0]);
  // a compiled map is measured as source is: the fixture's rooms are 192 wide and its doorways 64
  const compiled = maps.measure(tworooms, { every: true });
  sure(
    compiled.width.median > 64 && compiled.width.median <= 192,
    `the fixture's rooms: ${compiled.width.median}`,
  );
  sure(compiled.width.most < 240, `no place of it is much wider than a room: ${compiled.width.most}`);
  sure(
    compiled.headroom.most === 128 && compiled.world.size.join() === "352,480,160",
    "its height and its world",
  );
});

test("measure: what it refuses, each in a sentence", () => {
  const map = corridorAndHall();
  sure(
    refuses(() => maps.measure({}), /measure: a compiled map .* or brush source/),
    "what is no map",
  );
  sure(
    refuses(() => maps.measure(map, { grid: 0 }), /grid: the grid in units, 1 at the least, not 0/),
    "a grid of 0",
  );
  sure(refuses(() => maps.measure(map, { bands: [300, 200] }), /bands: the widths that part the floor.*\[300,200\]/), "bands that fall"); // prettier-ignore
  sure(
    refuses(() => maps.measure(map, { bands: [] }), /bands: /),
    "no bands",
  );
  sure(
    refuses(() => maps.measure(map, { sight: -1 }), /sight: a length in units, over 0, not -1/),
    "a sight under 0",
  );
  sure(refuses(() => maps.measure(map, { grid: 1 }), /grid: 1 units over a map 1056 by 544 is \d+ places/), "a grid too fine"); // prettier-ignore
  sure(
    refuses(() => maps.measure(map, { reach: {} }), /reach: what `reachOf` gave/),
    "a reach that is none",
  );
  sure(
    refuses(() => maps.measure(corridorAndHall({ start: false })), /got to no floor \(the map has no place to start.*`every: true`/), // prettier-ignore
    "a map with no place to start, measured by its walk",
  );
  sure(
    maps.measure(corridorAndHall({ start: false }), { every: true }).places > 200,
    "and measured whole all the same",
  );
  sure(
    refuses(() => maps.measureTable([]), /measureTable: a list of what `measure` gave/),
    "a table of nothing",
  );
});

test("several maps side by side: measureTable, and smak map-measure with its --json and its refusals", () => {
  const small = corridorAndHall({ hall: { min: [512, -64, 0], max: [768, 192, 160] } });
  const measured = [
    maps.measure(corridorAndHall(), { name: "large" }),
    maps.measure(small, { name: "small" }),
  ];
  const table = maps.measureTable(measured);
  const row = (words) => table.find((line) => line.startsWith(words))?.trim().split(/\s{2,}/); // prettier-ignore
  sure(/^\s+large\s+small$/.test(table[0]), `a map a column, under its name: ${table[0]}`);
  sure(
    row("width, median").slice(1).join() === measured.map((each) => each.width.median).join() &&
      measured[0].width.median > measured[1].width.median,
    `the maps' middling widths, the larger hall's the wider: ${row("width, median")}`,
  );
  sure(row("world").slice(1).join() === "1056 x 544 x 288,800 x 288 x 192", `their worlds: ${row("world")}`);
  sure(row("headroom in rooms").slice(1).join() === "256,160", `their headroom: ${row("headroom in rooms")}`);
  sure(row("headroom in corridors").slice(1).join() === "96,96", "the corridor is the same in both");
  sure(
    row("under 176 wide") && row("seeing beyond 700") && row("openings"),
    "the bands, the sight, the openings",
  );
  sure(new Set(table.map((line) => line.length)).size <= 2, "the columns stand under one another");

  // the command: one map in sentences, several as that table, either as JSON
  const largeFile = inFolder("large.map");
  const smallFile = inFolder("small.map");
  writeFileSync(largeFile, maps.writeMap(corridorAndHall()));
  writeFileSync(smallFile, maps.writeMap(small));
  const one = runSmak("map-measure", largeFile);
  sure(/273 places measured on a grid of 32: the floor the walk test got to/.test(one), one.slice(0, 200));
  sure(
    one.includes(
      `width (the narrowest of 8 lines through a place, 60 over its floor): median ${measured[0].width.median}`,
    ),
    "its widths",
  );
  const both = runSmak("map-measure", largeFile, smallFile, "--names", "large,small").split("\n");
  sure(
    both.join("\n") === table.join("\n") + "\n",
    `the table, as the library gives it:\n${both.join("\n")}`,
  );
  sure(
    /^\s+large\s+small$/.test(runSmak("map-measure", largeFile, smallFile).split("\n")[0]),
    "named after the files",
  );
  const every = runSmak(
    "map-measure",
    largeFile,
    "--every",
    "--grid",
    "64",
    "--bands",
    "100,300",
    "--sight",
    "400",
  );
  sure(
    /every place a player fits/.test(every) && /100 to 300 wide/.test(every) && /see beyond 400/.test(every),
    every,
  );
  const json = JSON.parse(runSmak("map-measure", largeFile, smallFile, "--json"));
  sure(
    Array.isArray(json) && json.length === 2 && json[0].file === largeFile && json[1].name === "small",
    "--json of several maps: a list, each with its file and its name",
  );
  sure(
    json[0].width.median === measured[0].width.median &&
      json[1].headroom.rooms.median === 160 &&
      json[0].sight.beyond.length === 700,
    "its numbers are the library's",
  );
  const single = JSON.parse(runSmak("map-measure", largeFile, "--json"));
  sure(
    single.places === 273 && single.width.bands.length === 3 && Array.isArray(single.facts),
    "--json of one map",
  );
  // a compiled map beside source
  const mixed = runSmak("map-measure", join(FIXTURES, "tworooms.bsp"), largeFile, "--every");
  sure(/^\s+tworooms\s+large$/.test(mixed.split("\n")[0]) && /every place\s+every place/.test(mixed), mixed);

  const refused = (args, says) => {
    const run = runRefused(SMAK_CLI, ...args);
    sure(run.code === 1, `smak ${args.join(" ")}: exit code ${run.code}`);
    sure(!/\n\s+at /.test(run.err), `smak ${args.join(" ")}: a stack trace: ${run.err.slice(0, 200)}`);
    sure(says.test(run.err), `smak ${args.join(" ")}: it said ${run.err.trim().slice(0, 240)}`);
  };
  refused(
    ["map-measure", largeFile, "--bands", "300,200"],
    /--bands: the widths that part the floor, rising.*not 300,200/,
  );
  refused(["map-measure", largeFile, "--grid", "0"], /--grid: a length in units, over 0, not 0/);
  refused(["map-measure", largeFile, "--sight"], /--sight needs a value after it/);
  refused(["map-measure", largeFile, inFolder("none.bsp")], /no such file: .*none\.bsp/);
  refused(
    ["map-measure", largeFile, smallFile, "--names", "one"],
    /--names is a name for each map.*\(2 of them\), not one/,
  );
  const noStart = inFolder("nostart.map");
  writeFileSync(noStart, maps.writeMap(corridorAndHall({ start: false })));
  refused(
    ["map-measure", largeFile, noStart],
    /map-measure: .*nostart\.map: measure: the walk test got to no floor/,
  );
  // the same refusals of the picture
  refused(["map-compare", largeFile, smallFile], /map-compare: -o out\.png/);
  refused(["map-compare", largeFile, smallFile, "-o", inFolder("x.png"), "--z", "1,2,3"], /--z: one height for every map, or one for each of the 2/); // prettier-ignore
  refused(["map-compare", largeFile, smallFile, "-o", inFolder("x.png"), "--z", "high"], /--z: .*not high/);
  refused(["map-compare", largeFile, smallFile, "-o", inFolder("x.png"), "--scale", "9"], /scale: at 9 pixels a unit large \(1056 units wide\) would be \d+ pixels/); // prettier-ignore
});

// ── several maps at one scale ───────────────────────────────────────────────
test("compareOf: two maps of known sizes in one picture at one scale, each named, with one bar", () => {
  // the corridor and its hall are 1056 by 544 with their walls; a hall alone, 288 by 288
  const large = corridorAndHall();
  const small = {
    worldspawn: {},
    brushes: maps.carve([{ min: [0, 0, 0], max: [256, 256, 128] }], WALL, WEARS),
    entities: [],
  };
  const picture = maps.compareOf(
    [
      { map: large, name: "large", z: 40 },
      { map: small, name: "small", z: 40 },
    ],
    { scale: 0.5 },
  );
  const [first, second] = picture.facts.maps;
  sure(
    picture.facts.scale === 0.5 && picture.facts.bar === 256,
    `the scale and its bar: ${picture.facts.bar}`,
  );
  sure(
    first.name === "large" && first.size.join() === "1056,544,288" && second.size.join() === "288,288,160",
    "sizes",
  );
  // the plans' sizes in pixels are the maps' in units, times the scale, with the same margin about each
  const margin = first.width - 1056 * 0.5;
  sure(margin > 0 && second.width - 288 * 0.5 === margin, `one margin: ${margin} and ${second.width - 144}`);
  sure(first.height - 544 * 0.5 === margin && second.height - 288 * 0.5 === margin, "and down as across");
  sure(
    (first.width - margin) / (second.width - margin) === 1056 / 288,
    "the pixels are in the maps' proportion",
  );
  sure(
    second.left >= first.left + first.width && first.top === second.top,
    "side by side, the first on the left",
  );
  sure(
    picture.width >= second.left + second.width && picture.height > first.top + first.height,
    "all of it fits",
  );
  // a point of each map is where the facts say: the hall's middle is floor, the rock north of the corridor solid
  const at = (map, [x, y]) => pixelAt(picture, Math.round(map.left + (x - map.x0) * 0.5), Math.round(map.top + (map.y0 - y) * 0.5)); // prettier-ignore
  sure(
    sameColour(at(first, [300, 250]), maps.PLAN_COLOURS.solid),
    "the rock beside the corridor is solid at the cut",
  );
  sure(!sameColour(at(first, [768, 64]), maps.PLAN_COLOURS.solid), "the hall is open");
  sure(!sameColour(at(second, [128, 128]), maps.PLAN_COLOURS.solid), "the small hall is open");
  sure(sameColour(at(second, [-8, 128]), maps.PLAN_COLOURS.solid), "and its wall is solid");
  // 128 units of the hall are as many pixels in both: the small hall's inside is 128 pixels across
  const across = (map, y, from, to) => {
    let open = 0;
    for (let x = from; x <= to; x++) if (!sameColour(at(map, [x, y]), maps.PLAN_COLOURS.solid)) open++;
    return open / 2; // two units a pixel, a sample a unit
  };
  near(across(second, 128, -16, 272), 128, 2, "the small hall, 256 units, in pixels");
  near(across(first, 200, 500, 1040), 256, 2, "the large hall, 512 units, in pixels");

  // without a scale: the largest at which both fit the picture asked for; in rows of one
  const fitted = maps.compareOf([large, small], { width: 800, height: 600 });
  sure(
    fitted.width <= 800 && fitted.height <= 600,
    `fitted into 800 x 600: ${fitted.width}x${fitted.height}`,
  );
  sure(fitted.facts.maps[0].name === "map 1", "a map with no name is named by its place in the list");
  sure(
    fitted.facts.scale > 0.2 &&
      fitted.facts.scale < 0.7 &&
      maps.compareOf([large, small]).facts.scale > fitted.facts.scale,
    `its scale, smaller than the one that fits 1920 x 1080: ${fitted.facts.scale}`,
  );
  const rows = maps.compareOf([large, small], { scale: 0.25, cols: 1 });
  sure(
    rows.facts.maps[1].left === 0 &&
      rows.facts.maps[1].top > rows.facts.maps[0].top + rows.facts.maps[0].height,
    "rows",
  );
  // a compiled map beside source, each cut at its own height or seen from above
  const mixed = maps.compareOf([{ map: tworooms, name: "fixture" }, { map: small, name: "small", z: 64 }], { scale: 1 }); // prettier-ignore
  sure(mixed.facts.maps[0].z === null && mixed.facts.maps[1].z === 64, "a cut for each");
  sure(mixed.facts.maps[0].width - 352 === mixed.facts.maps[1].width - 288, "352 and 288 units at one scale");
  sure(
    refuses(() => maps.compareOf([]), /compareOf: a list of maps/),
    "no maps",
  );
  sure(
    refuses(() => maps.compareOf([large, {}]), /compareOf: entry 2 is no map/),
    "what is no map",
  );
  sure(
    refuses(() => maps.compareOf([large], { scale: 0 }), /scale: pixels a unit, over 0, not 0/),
    "a scale of 0",
  );
  sure(
    refuses(
      () => maps.compareOf([large], { scale: 8 }),
      /scale: at 8 pixels a unit map 1 .* a smaller scale/,
    ),
    "too large",
  );

  // the command
  const largeFile = inFolder("large.map");
  const said = runSmak("map-compare", largeFile, join(FIXTURES, "tworooms.bsp"), "-o", inFolder("compare.png"), "--z", "40,-", "--scale", "0.5"); // prettier-ignore
  sure(existsSync(inFolder("compare.png")) && /2 maps at one scale, 0\.5 pixels a unit/.test(said), said);
  sure(/large: 1056 x 544 x 288 units, cut at z 40/.test(said) && /tworooms: 352 x 480 x 160 units, seen from above/.test(said), said); // prettier-ignore
});

// ── views: places to start that stand together, and a view of one colour ────
/** The fixture with more entities: `[classname, origin, keys]` each. */
const withMore = (more) => {
  let entities = tworooms.entities;
  for (const [classname, origin, keys] of more) entities = maps.addEntity(entities, classname, origin, keys);
  return maps.readBsp(maps.withEntities(tworoomsBytes, entities));
};
const FACING_NORTH = { angles: "0 90 0" };

test("viewsOf: places to start that stand together get one view, without one another's boxes in it", () => {
  // three more places to start about the fixture's own, the first of them a body's width before its eyes
  const crowded = withMore([
    ["info_player_start", [96, 128, 40], FACING_NORTH],
    ["info_player_start", [64, 96, 40], FACING_NORTH],
    ["info_player_start", [128, 128, 40], FACING_NORTH],
  ]);
  const views = maps.viewsOf(crowded);
  sure(
    views.facts.views.length === 5 && views.facts.views[0].name === "1 info_player_start +3 yaw 90",
    `one view from the four, then the room: ${views.facts.views.map((view) => view.name).join("; ")}`,
  );
  sure(
    views.facts.starts.length === 1 && views.facts.starts[0].numbers.join() === "1,5,6,7",
    "the group's entities",
  );
  sure(
    views.facts.notes.some((note) =>
      /places to start stand together .*4 about 96 96 40 \(entities 1, 5, 6, 7\)/.test(note),
    ),
    views.facts.notes.join(" | "),
  );
  sure(!views.facts.dropped.length, "no view is left out");
  // the view is the one the fixture's lone start gives: nothing of the other three is in it
  const alone = maps.viewsOf(tworooms);
  // (under the band its name is written on, which says `+3`)
  let differing = 0;
  for (let row = 24; row < 240; row++)
    for (let column = 0; column < 320; column++)
      if (!sameColour(pixelAt(views, column, row), pixelAt(alone, column, row))) differing++;
  sure(differing === 0, `${differing} pixels of the view differ from the lone start's`);
  sure(
    alone.facts.views[0].name === "1 info_player_start yaw 90" && !alone.facts.starts[0].numbers[1],
    "a start alone",
  );
  // drawn by itself, the same view is the back of the next start's box: the fault this mends
  const behind = maps.drawMap(crowded, { ...maps.viewFrom(crowded, 1), width: 320, height: 240 });
  const green = pixelAt(behind, 160, 120);
  sure(
    green[1] > green[0] + 60 && green[1] > green[2] + 60,
    `a place to start's box before the eye: ${green}`,
  );
  const clear = maps.drawMap(crowded, {
    ...maps.viewFrom(crowded, 1),
    width: 320,
    height: 240,
    unmarked: [5, 6, 7],
  });
  sure(sameColour(pixelAt(clear, 160, 120), pixelAt(alone, 160, 120)), "`unmarked` leaves the others out");
  // a start far from the others is a group of its own, with a view of its own
  const apart = withMore([["info_player_start", [272, 352, 40], { angles: "0 180 0" }]]);
  const two = maps.viewsOf(apart);
  sure(
    two.facts.starts.length === 2 && two.facts.views[1].name === "5 info_player_start yaw 180",
    two.facts.views.map((view) => view.name).join("; "),
  );
});

test("viewsOf: a view that is nearly one colour is left out, the next room shown in its place, and that is said", () => {
  // a second place to start in the corridor, far from the first, with a monster's box right before its eyes
  const blocked = withMore([
    ["info_player_start", [272, 352, 40], { angles: "0 270 0" }],
    ["monster_zombie", [272, 328, 4], {}],
  ]);
  const flat = maps.drawMap(blocked, { ...maps.viewFrom(blocked, 5), width: 320, height: 240 });
  const red = pixelAt(flat, 160, 120);
  sure(red[0] > red[1] + 60 && red[0] > red[2] + 60, `the view from it is the monster's box: ${red}`);
  const views = maps.viewsOf(blocked);
  const names = views.facts.views.map((view) => view.name);
  sure(views.facts.dropped.length === 1, `one view left out: ${JSON.stringify(views.facts.dropped)}`);
  const [dropped] = views.facts.dropped;
  sure(
    dropped.name === "5 info_player_start yaw -90" &&
      dropped.share >= 0.9 &&
      /^room /.test(dropped.replacedBy),
    JSON.stringify(dropped),
  );
  sure(
    dropped.colour[0] > dropped.colour[1] + 60 && dropped.from.join() === "272,352,68",
    "its colour and its place",
  );
  sure(
    !names.includes(dropped.name) && names[1] === dropped.replacedBy,
    `the room stands where it stood: ${names.join("; ")}`,
  );
  sure(names.length === 6 && new Set(names).size === 6, "as many views as without the fault, no room twice");
  sure(
    views.facts.notes.some((note) =>
      /1 views were nearly one colour and are left out.*5 info_player_start yaw -90 \(\d+ in 100 of it about the colour \d+ \d+ \d+\), replaced by room /.test(
        note,
      ),
    ),
    views.facts.notes.join(" | "),
  );
  // places of one's own are drawn as asked, whatever they show
  const asked = maps.viewsOf(blocked, { at: [5] });
  sure(asked.facts.views.length === 1 && !asked.facts.dropped.length, "a view asked for by name is kept");
  // with no room left to show in its place (all of them are shown already), the view stays and is said
  const all = maps.viewsOf(blocked, { count: 40 });
  sure(
    all.facts.views.some((view) => view.name === dropped.name) && !all.facts.dropped.length,
    all.facts.views.map((view) => view.name).join("; "),
  );
  sure(
    all.facts.notes.some((note) => /5 info_player_start yaw -90 .* is nearly one colour, and the map has no other room to show in its place/.test(note)), // prettier-ignore
    all.facts.notes.join(" | "),
  );
  // the command says what was left out
  const file = inFolder("blocked.bsp");
  writeFileSync(file, maps.withEntities(tworoomsBytes, blocked.entities));
  const said = runSmak("map-views", file, "-o", inFolder("views.png"));
  sure(/6 views/.test(said) && /nearly one colour and are left out/.test(said), said);
});

test("dressingOf: a map's dressing beside Valve's campaign, measured; a measure outside Valve's band warned, with the way to go", () => {
  const source = maps.readMap(readFileSync(join(FIXTURES, "tworooms.map"), "utf8"));
  const dressed = maps.dressingOf(tworooms, { source });
  const keys = dressed.rows.map((row) => row.key);
  sure(["scaleOne", "bandedWalls", "oneTextureWalls", "lampFaces", "nonAxial", "detail", "darkFloor", "contrast", "panels", "strips"].every((k) => keys.includes(k)), keys.join(" "));
  sure(dressed.facts.some((f) => /^dressing: faces at texture scale 1: 100% \(Valve's: 26% to 97%, median 79%\)/.test(f)), dressed.facts.join(" | "));
  // two plain rooms: every tall wall one texture, nothing off the axes: both outside Valve's 5th to 95th
  sure(dressed.warnings.some((w) => /tall walls of one texture only: 100%.*over the 95th in 100 of Valve's campaign maps; break tall walls with a second texture/.test(w)), dressed.warnings.join(" | "));
  sure(dressed.warnings.some((w) => /off the axes: 0%.*under the 5th in 100.*cut corners/.test(w)), dressed.warnings.join(" | "));
  // a brush's role, as Valve's sources are read: lamp, strip, panel, block
  const role = (max, texture = "WALL") => maps.brushRole({ min: [0, 0, 0], max, faces: Array.from({ length: 6 }, () => ({ texture })) }).role;
  sure(role([8, 64, 128]) === "panel" && role([8, 16, 200]) === "strip" && role([16, 32, 8], "~LIGHT3A") === "lit" && role([64, 64, 64]) === "block", "panel, strip, lit, block");
  const roles = maps.dressingOfSource({ brushes: [maps.box([0, 0, 0], [8, 64, 128], "WALL"), maps.box([0, 0, 0], [8, 16, 200], "TRIM"), maps.box([0, 0, 0], [32, 16, 8], "~LIGHT3A"), maps.box([0, 0, 0], [64, 64, 64], "WALL")], entities: [] });
  sure(roles.brushes === 4 && roles.panels === 0.25 && roles.strips === 0.25 && roles.litBrushes === 0.25, JSON.stringify(roles));
  // a map's own texture lights (info_texlights) are its lamps: a spec's glowing fixtures among them
  const isLamp = maps.lampsOf({ entities: [[["classname", "info_texlights"], ["origin", "0 0 0"], ["FIXTURE_GLASS", "255 220 180 600"]]] });
  sure(isLamp("fixture_glass") && isLamp("+0~GENERIC65") && !isLamp("concrete"), "texture lights");
  // a view's complexity: none on a flat picture, much on a chequer
  const picture = (fill) => ({ width: 16, height: 16, rgba: Uint8Array.from({ length: 16 * 16 * 4 }, (_, i) => (i % 4 === 3 ? 255 : fill(Math.floor(i / 4)))) });
  const flat = maps.pictureComplexity(picture(() => 128));
  const chequer = maps.pictureComplexity(picture((p) => (((p % 16) + Math.floor(p / 16)) % 2 ? 255 : 0)));
  sure(flat.edges === 0 && chequer.edges > 0.9 && chequer.compression > flat.compression, JSON.stringify({ flat, chequer }));
});

test("viewsOf with aim: views aimed at what the map has, a landmark among them, and none facing a wall", () => {
  const stands = maps.aimedStands(tworooms, { landmark: "info_player_start" });
  const at = stands.find((s) => s.name === "landmark info_player_start");
  sure(at && Math.hypot(at.to[0] - 96, at.to[1] - 96) < 1 && maps.contentsAt(tworooms, at.from) === maps.CONTENTS.EMPTY, JSON.stringify(stands));
  const views = maps.viewsOf(tworooms, { count: 6, aim: true, landmark: "info_player_start" });
  sure(views.facts.views.length === 6 && views.facts.views.some((v) => /^landmark info_player_start/.test(v.name)), views.facts.views.map((v) => v.name).join(" | "));
  // the rooms' level views, the most open first: one facing a wall within 256 only after every open one
  const openness = views.facts.views.filter((each) => /^room /.test(each.name)).map((v) => {
    const a = (v.yaw * Math.PI) / 180;
    let open = 0;
    for (let d = 8; d <= 256 && maps.contentsAt(tworooms, [v.from[0] + Math.cos(a) * d, v.from[1] + Math.sin(a) * d, v.from[2]]) !== maps.CONTENTS.SOLID; d += 8) open = d;
    return open;
  });
  const firstShut = openness.findIndex((o) => o < 248);
  sure(firstShut < 0 || openness.slice(firstShut).every((o) => o < 248), `open ahead, in order: ${openness.join(", ")}`);
  // a map spec's focus leaves an info_target named "landmark": aimed at first with no landmark asked
  const marked = maps.readBsp(maps.withEntities(tworoomsBytes, maps.addEntity(tworooms.entities, "info_target", [96, 96, 64], { targetname: "landmark" })));
  const first = maps.aimedStands(marked)[0];
  sure(first?.name === "landmark landmark" && Math.hypot(first.to[0] - 96, first.to[1] - 96) < 1, JSON.stringify(maps.aimedStands(marked)));
});

test("smak map-dressing: a compiled map's dressing beside Valve's, its source's brush roles", () => {
  const said = runSmak("map-dressing", join(FIXTURES, "tworooms.bsp"), "--source", join(FIXTURES, "tworooms.map"));
  sure(/^dressing: faces at texture scale 1: 100%/m.test(said) && /^WARNING dressing: tall walls of one texture only/m.test(said) && /panels \(thin, wide\): 70%/.test(said), said);
  const source = runSmak("map-dressing", join(FIXTURES, "tworooms.map"));
  sure(/^panels: 70%/m.test(source) && /of a compiled map: compile it/.test(source), source);
});
