// Judging a map with no game running: the space a body fits in, the walk test (what is reached on foot, what
// stands in something solid, the openings), point entities drawn at their true size, a side section, the
// storeys side by side and a view through each opening; then their commands, and the MCP tools.
//
// The maps are the kit's own: a small house built here from the builders of source.mjs, and the two rooms of
// test/fixtures. Every "nothing is wrong" has a case beside it where the same tool reports a fault.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import * as maps from "../src/maps/index.mjs";
import { test, testAsync, sure, near, HERE, tmp, runSmak, runRefused, SMAK_CLI, knife } from "./helper.mjs";

const FIXTURES = join(HERE, "fixtures");
const tworoomsBytes = readFileSync(join(FIXTURES, "tworooms.bsp"));
const tworooms = maps.readBsp(tworoomsBytes);
const tworoomsSource = maps.readMap(readFileSync(join(FIXTURES, "tworooms.map"), "utf8"));
const folder = join(tmp, "maps-walk");
mkdirSync(folder, { recursive: true });
const inFolder = (name) => join(folder, name);

// ── the house: a hall, a study a step higher, a doorway between them ──
const WEARS = { floor: "FLOOR", ceiling: "CEILING", wall: "WALL" };
const HALL = { min: [0, 0, 0], max: [320, 256, 160] };
const STUDY_FLOOR = 16; // a step up from the hall: 18 is the most that is walked
const DOOR = { from: 96, to: 160, high: 96 }; // 64 wide, 96 high, through 32 of rock
const START_FLOOR = [96, 128, 0];
const IN_THE_STUDY = [480, 128];
const MONSTER = "monster_zombie"; // a class of Half-Life's: its origin is at its feet
const START = 1; // the entities, by their numbers
const THE_MONSTER = 2;
const GRATE = 4; // the fixture's func_wall, in the doorway of its second room
const IN_ROOM_C = [96, 352, 0]; // the fixture's room behind the grate
const IN_THE_WALL = [96, 224, 64];

/**
 * The house as brush source. `floor`: the study's floor; `door`: `{ from, to, high }` along y, or null for
 * none; `monsterAt`: the height of the monster's origin; `brushes` and `entities`: more of each.
 */
function house({
  floor = STUDY_FLOOR,
  door = DOOR,
  monsterAt = floor,
  brushes = [],
  entities = [],
  start = true,
} = {}) {
  const rooms = [HALL, { min: [352, 0, floor], max: [608, 256, 144] }];
  if (door) rooms.push({ min: [320, door.from, floor], max: [352, door.to, floor + door.high] });
  return {
    worldspawn: {},
    brushes: [...maps.carve(rooms, 16, WEARS), ...brushes],
    entities: [
      ...(start ? [maps.playerStart(START_FLOOR, 0)] : []),
      maps.pointEntity(MONSTER, [...IN_THE_STUDY, monsterAt]),
      maps.light([160, 128, 140]),
      ...entities,
    ],
  };
}
/** The monster's entry in what the walk test gives. */
const monsterOf = (reach) => reach.entities.find((entity) => entity.classname === MONSTER);
const doorBrush = (classname, keys) =>
  maps.brushEntity(
    classname,
    maps.box([328, DOOR.from, STUDY_FLOOR], [344, DOOR.to, STUDY_FLOOR + DOOR.high], "DOORWOOD"),
    keys,
  );

// ── reading a picture ──
const pixelAt = (picture, x, y) => [
  ...picture.rgba.subarray((y * picture.width + x) * 4, (y * picture.width + x) * 4 + 3),
];
const sameColour = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const isRed = ([red, green, blue]) => red > 1.5 * green && red > 1.5 * blue;
const isGreen = ([red, green, blue]) => green > red + 20 && green > blue + 20;
const isReddish = ([red, green, blue]) => red > green + 20 && red > blue + 20;
/** The pixel of a plan a point of the world is at. */
const planPixel = (facts, [x, y]) => [
  Math.round((x - facts.x0) * facts.scale),
  Math.round((facts.y0 - y) * facts.scale),
];
/** The pixel of a section a point `along` its line at height `z` is at. */
const sectionPixel = (facts, along, z) => [
  Math.round(facts.left + along * facts.scale),
  Math.round(facts.top + (facts.zTop - z) * facts.scale),
];
const refuses = (run, pattern) => {
  try {
    run();
  } catch (e) {
    return pattern.test(e.message);
  }
  return false;
};

// ── the space ──
test("the space of a map says at which heights a body fits, standing on a floor and under a ceiling", () => {
  const space = maps.spaceOf(house());
  const stretches = space.blocked(160, 128);
  sure(
    stretches.length === 2 && stretches[0][1] === 0 && stretches[1][0] === 160 - 72,
    `in the hall the feet are free from the floor (0) to 72 under the ceiling (88): ${JSON.stringify(stretches)}`,
  );
  sure(space.blocked(160, 128, maps.BODIES.crouching)[1][0] === 160 - 36, "a crouching body rises 36 higher");
  const standing = maps.restOf(space, [160, 128, 0]);
  sure(standing.fits && standing.floor === 0 && standing.hang === 0, "a body stands on the floor");
  const hanging = maps.restOf(space, [160, 128, 50]);
  sure(hanging.fits && hanging.hang === 50 && hanging.floor === 0, "one 50 over it hangs 50");
  const sunk = maps.restOf(space, [160, 128, -6]);
  sure(!sunk.fits && sunk.stretch[1] === 0, `one 6 under the floor does not fit: ${JSON.stringify(sunk)}`);
  sure(!maps.restOf(space, [8, 128, 0]).fits, "nor one 8 from a wall, whose box is 16 wide each way");
  sure(maps.restOf(space, [16, 128, 0]).fits, "one 16 from the wall touches it and fits");
  // the doorway is 64 wide: a large monster's box passes at its very middle and nowhere else
  sure(maps.restOf(space, [336, 128, STUDY_FLOOR], maps.BODIES.large).fits, "a large body in a 64 doorway");
  sure(!maps.restOf(space, [336, 120, STUDY_FLOOR], maps.BODIES.large).fits, "and 8 off its middle, not");
  sure(space.sees([160, 128, 64], [300, 128, 64]) && !space.sees([160, 128, 64], [480, 20, 64]), "sees");
  const cut = space.cut(160, 128);
  sure(
    cut.every((piece) => piece[2] === "solid") && cut.some((piece) => piece[1] === 0),
    `a cut through the hall: ${JSON.stringify(cut)}`,
  );
  sure(
    refuses(() => maps.spaceOf(house(), { doors: "ajar" }), /doors: "open" or "closed"/),
    "a wrong option",
  );
});

test("a body is told from an entity's class, or by name", () => {
  const start = maps.bodyFor("info_player_start");
  sure(start.feet === 36 && start.mins[2] === -36 && start.maxs[2] === 36, "a start's origin is its middle");
  const monster = maps.bodyFor(MONSTER);
  sure(monster.feet === 0 && monster.maxs.join() === "16,16,72", "a monster's is at its feet");
  sure(maps.bodyFor("light") === null && maps.bodyFor("ms_player_spec") === null, "a light has no body");
  sure(
    maps.bodyFor("ms_npc").body.name === "standing" && maps.bodyFor("msmonster_boar").feet === 0,
    "a mod's",
  );
  const large = maps.bodyFor("msmonster_boar", "big", { big: "large" });
  sure(large.maxs.join() === "32,32,64", "a large one by its targetname");
  sure(
    maps.bodyFor("item_x", undefined, { item_x: { half: 8, height: 16, feet: 8 } }).mins.join() ===
      "-8,-8,-8",
    "a box of its own",
  );
  sure(
    refuses(
      () => maps.bodyFor(MONSTER, undefined, { [MONSTER]: "huge" }),
      /"standing", "large", "crouching"/,
    ),
    "a wrong body",
  );
});

// ── the walk test ──
test("the walk test reaches a monster through a doorway and up a step, and says how far and how wide", () => {
  const reach = maps.reachOf(house(), { to: [THE_MONSTER] });
  sure(!reach.warnings.length, `nothing is wrong with it: ${reach.warnings.join(" | ")}`);
  const monster = monsterOf(reach);
  sure(monster.reached && monster.how === "walk" && monster.number === THE_MONSTER, JSON.stringify(monster));
  // 384 in a straight line from the start, less the arm's length a player stops at
  sure(monster.far > 300 && monster.far <= 384, `the walk to it is ${monster.far}`);
  sure(
    /all 2 entities a player goes to are reached on foot/.test(reach.facts.join()),
    reach.facts.join(" | "),
  );
  sure(/walked from 1 places to start: 1 info_player_start/.test(reach.facts.join()), "the starts are said");
  sure(reach.starts.length === 1 && reach.starts[0].floor === 0, "the start stands on the hall's floor");
  const [opening] = reach.openings;
  sure(
    reach.openings.length === 1 &&
      opening.width === 64 &&
      opening.height === 96 &&
      opening.across === "y" &&
      opening.at.join() === `336,128,${STUDY_FLOOR}` &&
      opening.fits.large,
    `the doorway: ${JSON.stringify(reach.openings)}`,
  );
  sure(opening.sides[0][0] < 336 && opening.sides[1][0] > 336, "its side nearer the start comes first");
  const [route] = reach.routes;
  sure(
    route.number === THE_MONSTER &&
      route.points[0].join() === START_FLOOR.join() &&
      route.points.at(-1)[2] === STUDY_FLOOR &&
      route.far === monster.far,
    `the way to it: ${JSON.stringify(route)}`,
  );
  sure(/the walk to 2 monster_zombie is \d+ units/.test(reach.facts.join()), "and its sentence");
  sure(reach.walked(160, 128) === 0 && reach.walked(480, 128) === STUDY_FLOOR, "walked: both floors");
  sure(reach.walked(336, 20) === null && reach.stands(336, 20) === null, "and not inside the wall");
  sure(reach.unreached.length === 0 && reach.stuck.length === 0 && reach.hanging.length === 0, "no fault");
});

test("the compilers' marks in a doorway: some let a body through, the hints are solid to it", () => {
  // as measured in the clip hulls of maps compiled with VHLT and SDHLT 1.3.1
  const plug = (texture) => maps.box([320, DOOR.from, STUDY_FLOOR], [352, DOOR.to, STUDY_FLOOR + DOOR.high], texture);
  for (const [texture, through] of [["NOCLIP", true], ["NULLNOCLIP", true], ["SKIP", true], ["SPLITFACE", true], ["SOLIDHINT", false], ["BEVELHINT", false]]) { // prettier-ignore
    const reach = maps.reachOf(house({ brushes: [plug(texture)] }), { to: [THE_MONSTER] });
    sure(monsterOf(reach).reached === through, `${texture} in the doorway: ${monsterOf(reach).reached ? "walked through" : "a wall"}`);
  }
});

test("the walk test says what it would take where a walk does not reach", () => {
  // a step of 24: more than is walked, and a jump clears it
  const high = maps.reachOf(house({ floor: 24 }));
  sure(!monsterOf(high).reached && monsterOf(high).how === "jump", `a step of 24: ${monsterOf(high).how}`);
  sure(/only by a jump.*the floor rises 24/.test(monsterOf(high).why), monsterOf(high).why);
  sure(
    /1 of the 2 entities a player goes to are not reached on foot.*2 monster_zombie at 480 128 24/.test(
      high.warnings.join(),
    ),
    high.warnings.join(" | "),
  );
  sure(high.unreached.join() === String(THE_MONSTER), "and it is listed");
  // with jumps as part of the walk it is reached, and still told apart from what is walked to
  const jumped = monsterOf(maps.reachOf(house({ floor: 24 }), { jump: true }));
  sure(jumped.reached && jumped.how === "jump", `with jumps it is reached: ${jumped.how}`);
  sure(
    monsterOf(maps.reachOf(house({ floor: 60 }))).how === "crouch-jump",
    "a rise of 60 wants the legs drawn up",
  );
  // a doorway 60 high: only crouching
  const low = monsterOf(maps.reachOf(house({ door: { ...DOOR, high: 60 } })));
  sure(low.how === "crouch" && /the way is 60 high, under the 72/.test(low.why), `${low.how}: ${low.why}`);
  // a doorway 24 wide: light and sound pass, a player does not
  const narrow = monsterOf(maps.reachOf(house({ door: { from: 116, to: 140, high: 96 } })));
  sure(
    narrow.how === "air" && /open air leads to it: the walked floor comes within \d+ of it/.test(narrow.why),
    `${narrow.how}: ${narrow.why}`,
  );
  // no doorway at all
  const walled = monsterOf(maps.reachOf(house({ door: null })));
  sure(walled.how === "none" && /no opening leads to it/.test(walled.why), `${walled.how}: ${walled.why}`);
  sure(
    refuses(() => maps.reachOf(house(), { cell: 0 }), /cell: the grid in units/),
    "a wrong grid is refused",
  );
});

test("doors are open to the walk test unless told, and other brush entities are walls unless told", () => {
  const withDoor = house({ entities: [doorBrush("func_door", { targetname: "gate" })] });
  const open = maps.reachOf(withDoor);
  sure(monsterOf(open).reached, "a door is taken as open");
  sure(/1 doors were taken as open: 4 func_door "gate"/.test(open.facts.join()), open.facts.join(" | "));
  sure(
    open.entities.some((entity) => entity.classname === "func_door" && entity.reached),
    "and is itself reached",
  );
  for (const options of [{ doors: "closed" }, { shut: ["gate"] }, { shut: [4] }]) {
    const closed = maps.reachOf(withDoor, options);
    sure(
      !monsterOf(closed).reached &&
        /no opening leads to it \(with the doors that are taken as closed\)/.test(monsterOf(closed).why) &&
        /1 doors were taken as closed/.test(closed.facts.join()),
      `${JSON.stringify(options)}: ${monsterOf(closed).why}`,
    );
  }
  const withWall = house({ entities: [doorBrush("func_wall")] });
  sure(!monsterOf(maps.reachOf(withWall)).reached, "a func_wall in the doorway closes it");
  sure(monsterOf(maps.reachOf(withWall, { open: ["func_wall"] })).reached, "unless it is named as open");
  const withTrigger = house({ entities: [doorBrush("trigger_once")] });
  const through = maps.reachOf(withTrigger);
  sure(
    monsterOf(through).reached &&
      through.entities.find((entity) => entity.classname === "trigger_once").reached,
    "a trigger stops nobody, and is walked into",
  );
});

test("the walk test measures an opening against a player and against a large monster", () => {
  const wide = maps.reachOf(house({ door: { from: 104, to: 152, high: 96 } }));
  sure(wide.openings[0].width === 48 && !wide.openings[0].fits.large, JSON.stringify(wide.openings[0]));
  sure(
    !wide.warnings.length &&
      /1 openings a player walks through are under 64 wide or 64 high/.test(wide.facts.join()),
    "48 wide: a fact, while no monster is said to be large",
  );
  const large = maps.reachOf(house({ door: { from: 104, to: 152, high: 96 } }), {
    bodies: { [MONSTER]: "large" },
  });
  sure(
    /a large monster's box does not pass them: 1 at 336 128 16: 48 wide, 96 high/.test(large.warnings.join()),
    large.warnings.join(" | "),
  );
  sure(!maps.reachOf(house(), { bodies: { [MONSTER]: "large" } }).warnings.length, "64 wide passes one");
  // 32 wide, on the grid: walked, and warned of
  const tight = maps.reachOf(house({ door: { from: 112, to: 144, high: 96 } }));
  sure(monsterOf(tight).reached && tight.openings[0].width === 32, "a doorway 32 wide is walked");
  sure(
    /1 openings are only just wide enough for a player/.test(tight.warnings.join()),
    tight.warnings.join(" | "),
  );
  // a room on its own has no opening
  sure(maps.reachOf(house({ door: null })).openings.length === 0, "a room with no doorway has none");
});

test("the walk test says which bodies stand in something solid and which hang", () => {
  const sunk = maps.reachOf(house({ monsterAt: STUDY_FLOOR - 8 }));
  sure(
    sunk.stuck.length === 1 && sunk.stuck[0].number === THE_MONSTER && sunk.stuck[0].lift === 8,
    `a monster 8 into the floor: ${JSON.stringify(sunk.stuck)}`,
  );
  sure(
    /1 entities stand in something solid.*its feet are 8 under the floor at z 16: it fits 8 higher/.test(
      sunk.warnings.join(),
    ),
    sunk.warnings.join(" | "),
  );
  // the hall is 160 high: a second monster 80 over its floor has room, and hangs
  const inHall = (z) => house({ entities: [maps.pointEntity(MONSTER, [200, 200, z])] });
  const high = maps.reachOf(inHall(80));
  sure(
    high.hanging.length === 1 && high.hanging[0].hang === 80 && !high.stuck.length,
    JSON.stringify(high.hanging),
  );
  sure(
    /1 entities hang more than 64 units over their floor.*80 over the floor at z 0/.test(
      high.warnings.join(),
    ),
    high.warnings.join(" | "),
  );
  sure(!maps.reachOf(inHall(40)).hanging.length, "40 over the floor is let be");
  sure(maps.reachOf(inHall(40), { hang: 30 }).hanging.length === 1, "unless told");
  sure(maps.reachOf(inHall(120)).stuck.length === 1, "and with its head in the ceiling it is stuck");
  // in a wall: stuck, and not reached
  const inWall = house({ entities: [maps.pointEntity(MONSTER, [336, 20, 40])] });
  const buried = maps.reachOf(inWall);
  sure(
    buried.stuck.some((each) => each.number === 4 && each.lift === null) &&
      /4 monster_zombie at 336 20 40: it is inside something solid/.test(buried.warnings.join()),
    buried.warnings.join(" | "),
  );
  // a start written at the floor's own height has its feet 36 under it
  const lowStart = house({ start: false, entities: [maps.pointEntity("info_player_start", START_FLOOR)] });
  sure(
    /its feet are 36 under the floor at z 0/.test(maps.reachOf(lowStart).warnings.join()),
    "a start in the floor",
  );
});

test("the walk test begins at the places to start, the mods' too, or where it is told", () => {
  const none = maps.reachOf(house({ start: false }));
  sure(
    /no place to start \(info_player_start, .*ms_player_begin, ms_player_spawn\): nothing was walked/.test(
      none.warnings.join(),
    ),
    none.warnings.join(" | "),
  );
  sure(none.area === 0 && !none.openings.length, "nothing is walked");
  const told = maps.reachOf(house({ start: false }), { from: [[96, 128, 0]] });
  sure(monsterOf(told).reached && told.starts[0].classname === "a point", "from a point");
  const mod = house({ start: false, entities: [maps.playerStart(START_FLOOR, 0, "ms_player_begin")] });
  const walked = maps.reachOf(mod);
  sure(monsterOf(walked).reached && /1 ms_player_begin/.test(walked.facts.join()), walked.facts.join(" | "));
  sure(monsterOf(maps.reachOf(house(), { from: [MONSTER] })).far === 0, "from an entity by its class");
  sure(
    /no entity of 99 to start the walk from/.test(maps.reachOf(house(), { from: [99] }).warnings.join()),
    "one that is not there",
  );
});

test("a ladder, a liquid and a teleport carry the walk on", () => {
  // a ledge 64 high in the hall, a thing on it: more than any jump, till a ladder stands against it
  const ledge = maps.box([200, 0, 0], [320, 96, 64], "LEDGE");
  const thing = maps.pointEntity("item_test", [260, 48, 70]);
  const ladder = maps.brushEntity("func_ladder", maps.box([192, 32, 0], [200, 64, 64], "AAATRIGGER"));
  const itemOf = (reach) => reach.entities.find((entity) => entity.classname === "item_test");
  const without = itemOf(maps.reachOf(house({ brushes: [ledge], entities: [thing] })));
  sure(!without.reached && without.how === "air", `a ledge of 64: ${without.how}`);
  sure(
    itemOf(maps.reachOf(house({ brushes: [ledge], entities: [thing, ladder] }))).reached,
    "a ladder is climbed",
  );
  // a pit 96 deep under the hall: no way out of it, till it holds water to 8 under its rim
  const pit = { min: [96, 32, -96], max: [192, 96, 0] };
  const rooms = [HALL, pit];
  const pitMap = (brushes) => ({
    brushes: [...maps.carve(rooms, 16, WEARS), ...brushes],
    entities: [maps.pointEntity("item_test", [260, 200, 8])],
  });
  const fromPit = { from: [[144, 64, -96]] };
  sure(!itemOf(maps.reachOf(pitMap([]), fromPit)).reached, "out of a dry pit there is no way");
  const water = maps.box([96, 32, -96], [192, 96, -8], "!WATER");
  sure(itemOf(maps.reachOf(pitMap([water]), fromPit)).reached, "water is swum up through");
  // a room with no door, and a teleport into it
  const vault = { min: [0, 300, 0], max: [128, 428, 128] };
  const vaultMap = (entities) => ({
    brushes: maps.carve([HALL, vault], 16, WEARS),
    entities: [
      maps.playerStart(START_FLOOR, 0),
      maps.pointEntity("item_test", [96, 396, 8]),
      maps.pointEntity("info_teleport_destination", [64, 364, 4], { targetname: "dest" }),
      ...entities,
    ],
  });
  sure(!itemOf(maps.reachOf(vaultMap([]))).reached, "a sealed room is not reached");
  const teleport = maps.brushEntity("trigger_teleport", maps.box([16, 16, 0], [48, 48, 64], "AAATRIGGER"), {
    target: "dest",
  });
  const through = maps.reachOf(vaultMap([teleport]));
  sure(
    itemOf(through).reached && /1 teleports were walked into/.test(through.facts.join()),
    through.facts.join(" | "),
  );
});

test("a compiled map is walked by its own clip hulls, and agrees with its source", () => {
  const compiled = maps.reachOf(tworooms);
  const source = maps.reachOf(tworoomsSource);
  sure(
    compiled.area === source.area && compiled.area > 0,
    `the floor walked: ${compiled.area} against ${source.area}`,
  );
  sure(
    compiled.openings.length === 1 &&
      JSON.stringify(compiled.openings) === JSON.stringify(source.openings) &&
      compiled.openings[0].width === 64 &&
      compiled.openings[0].height === 96,
    `the doorway of the first room: ${JSON.stringify(compiled.openings)}`,
  );
  // the one thing said of either: the room behind the grate, the size of a room, is not walked to
  const said = [compiled, source].map((walk) => walk.warnings.join(" | "));
  sure(said.every((line) => /^1 parts of the floor the size of a room .*: behind \d+ func_wall/.test(line)), said.join(" || "));
  // the second room is behind a grate (a func_wall): a monster put there is not reached, till the grate is opened
  const withMonster = (at) =>
    maps.readBsp(maps.withEntities(tworoomsBytes, maps.addEntity(tworooms.entities, MONSTER, at)));
  const behind = maps.reachOf(withMonster(IN_ROOM_C));
  sure(
    !monsterOf(behind).reached && monsterOf(behind).how === "none",
    `behind the grate: ${monsterOf(behind).how}`,
  );
  const opened = maps.reachOf(withMonster(IN_ROOM_C), { open: [GRATE] });
  sure(
    monsterOf(opened).reached && opened.area > compiled.area && opened.openings.length === 2,
    "with the grate open",
  );
  const buried = maps.reachOf(withMonster(IN_THE_WALL));
  sure(
    buried.stuck.length === 1 && /it is inside something solid/.test(monsterOf(buried).why),
    `in the wall between the rooms: ${buried.warnings.join(" | ")}`,
  );
  const space = maps.spaceOf(tworooms);
  sure(
    maps.restOf(space, [96, 96, 0]).fits && !maps.restOf(space, [96, 96, -8]).fits,
    "restOf, of a compiled map",
  );
  sure(
    refuses(() => space.blocked(96, 96, { half: 8, height: 16, hull: null }), /only its four hulls/),
    "a body of its own size cannot be asked of a compiled map",
  );
});

test("the plan check counts a mod's places to start without being asked, and says which it found", () => {
  const mod = house({
    start: false,
    entities: [
      maps.playerStart(START_FLOOR, 0, "ms_player_begin"),
      maps.playerStart([96, 64, 0], 0, "ms_player_spawn"),
      maps.playerStart([96, 192, 0], 0, "ms_player_spawn"),
    ],
  });
  const plan = maps.checkPlan(mod, { leak: false });
  sure(!plan.errors.length, `a Master Sword map has its starts: ${plan.errors.join(" | ")}`);
  sure(
    /places to start: 1 ms_player_begin, 2 ms_player_spawn/.test(plan.facts.join()),
    plan.facts.join(" | "),
  );
  const none = maps.checkPlan(house({ start: false }), { leak: false });
  sure(
    /no info_player_start or info_player_deathmatch or ms_player_begin or ms_player_spawn/.test(
      none.errors.join(),
    ),
    none.errors.join(" | "),
  );
  sure(
    maps.checkPlan(mod, { leak: false, starts: ["info_player_start"] }).errors.length === 1,
    "unless told which",
  );
  // an entity is numbered as the pictures number it: the first of the list is 1
  const buried = maps.checkPlan(house({ entities: [maps.light([336, 20, 40])] }), { leak: false });
  sure(/entity 4 \(light\) at 336 20 40 is inside/.test(buried.warnings.join()), buried.warnings.join(" | "));
});

// ── the storeys ──
const CELLAR = { min: [0, 0, -160], max: [320, 256, -32] };
/** The house with a cellar under its hall, joined to nothing, and a thing in it. */
const houseOverCellar = () => {
  const map = house();
  return {
    ...map,
    brushes: [
      ...maps.carve(
        [
          HALL,
          { min: [352, 0, STUDY_FLOOR], max: [608, 256, 144] },
          { min: [320, DOOR.from, STUDY_FLOOR], max: [352, DOOR.to, STUDY_FLOOR + DOOR.high] },
          CELLAR,
        ],
        16,
        WEARS,
      ),
    ],
    entities: [...map.entities, maps.pointEntity(MONSTER, [160, 128, -160])],
  };
};

test("the heights to cut a map at are found: one for a house, two with a cellar under it", () => {
  const one = maps.storeyCuts(house());
  sure(
    one.length === 1 && one[0].z === STUDY_FLOOR + 36 && one[0].floors.join() === `0,${STUDY_FLOOR}`,
    JSON.stringify(one),
  );
  const two = maps.storeyCuts(houseOverCellar());
  sure(
    two.length === 2 &&
      two[0].z === STUDY_FLOOR + 36 &&
      two[1].z === -160 + 36 &&
      two[1].floors.join() === "-160,-160",
    `the highest first: ${JSON.stringify(two)}`,
  );
  sure(maps.storeyCuts(tworooms).length === 1 && maps.storeyCuts(tworooms)[0].z === 36, "of a compiled map");
});

// ── entities at their true size ──
test("a view draws what stands as the box it moves with, at its true size", () => {
  // from the hall, looking through the doorway at the monster: its box is 32 wide and 72 high, 368 away
  const eye = { from: [96, 128, 64], yaw: 0 };
  const view = maps.drawSource(house(), eye);
  const mark = view.facts.marked.find((each) => each.number === THE_MONSTER);
  sure(mark.drawn === "box" && mark.size === "32 x 32 x 72", JSON.stringify(mark));
  sure(
    /1 as the box they move with, at its true size/.test(view.facts.notes.join()),
    view.facts.notes.join(" | "),
  );
  // the box runs from the study's floor (z 16) to 72 over it: on the picture, from row 282 up to row 219
  const column = 320;
  sure(
    isRed(pixelAt(view, column, 225)) && isRed(pixelAt(view, column, 275)),
    "its top and its foot are drawn",
  );
  sure(
    !isRed(pixelAt(view, column, 205)) && !isRed(pixelAt(view, column, 292)),
    "and nothing over or under it",
  );
  sure(
    !isRed(pixelAt(maps.drawSource(house(), { ...eye, entities: false }), column, 250)),
    "without entities, no box",
  );
  // sunk 12 into the floor, its foot is gone: the floor hides it
  const sunk = maps.drawSource(house({ monsterAt: STUDY_FLOOR - 12 }), eye);
  sure(isRed(pixelAt(sunk, column, 262)) && !isRed(pixelAt(sunk, column, 215)), "a sunk one stands lower");
  const large = maps.drawSource(house(), { ...eye, bodies: { [MONSTER]: "large" } });
  sure(large.facts.marked.find((each) => each.number === THE_MONSTER).size === "64 x 64 x 64", "a large one");
  // the light, which has no body, is still a small box
  sure(
    view.facts.marked.every((each) => each.classname !== "light" || each.drawn === "mark"),
    "a light is a mark",
  );
  const compiled = maps.readBsp(
    maps.withEntities(tworoomsBytes, maps.addEntity(tworooms.entities, MONSTER, [96, 160, 0])),
  );
  const inMap = maps.drawMap(compiled);
  sure(
    inMap.facts.marked.some((each) => each.classname === MONSTER && each.drawn === "box"),
    "in a compiled map too",
  );
});

test("with the game's folders, an entity that names a model is drawn as it", () => {
  const game = inFolder("game");
  mkdirSync(join(game, "models"), { recursive: true });
  writeFileSync(join(game, "models", "knife.mdl"), knife.mdl);
  const prop = maps.pointEntity("env_model", [200, 128, 40], {
    model: "models/knife.mdl",
    angles: [0, 90, 0],
  });
  const map = house({ entities: [prop] });
  const things = [
    {
      number: 4,
      classname: "env_model",
      origin: [200, 128, 40],
      yaw: 90,
      model: null,
      modelFile: "models/knife.mdl",
    },
  ];
  const { figures, notes } = maps.figuresOf(things, { models: true, folders: [game] });
  const figure = figures.get(4);
  sure(
    figure.triangles.length > 0 && figure.file.endsWith("knife.mdl") && !notes.length,
    "its triangles are read",
  );
  // the knife is long along its own x: turned to face +y, it is long along y in the world
  sure(
    figure.max[1] - figure.min[1] > figure.max[0] - figure.min[0],
    `turned the way it faces: ${figure.min} ${figure.max}`,
  );
  const eye = { from: [96, 128, 64], to: [200, 128, 44] };
  const view = maps.drawSource(map, { ...eye, models: true, folders: [game] });
  sure(
    view.facts.marked.find((each) => each.number === 4).drawn === "model",
    JSON.stringify(view.facts.marked),
  );
  sure(/1 as their model, with its textures/.test(view.facts.notes.join()), view.facts.notes.join(" | "));
  // by class, for an entity that names none
  const byClass = maps.figuresOf([{ ...things[0], modelFile: undefined }], {
    models: { env_model: "models/knife.mdl" },
    folders: [game],
  });
  sure(byClass.figures.get(4).triangles.length === figure.triangles.length, "a model named for a class");
  // not asked for, or not there: a small box, and a sentence
  sure(
    maps.drawSource(map, eye).facts.marked.find((each) => each.number === 4).drawn === "mark",
    "boxes only, unless asked",
  );
  const lost = maps.drawSource(map, { ...eye, models: true, folders: [folder] });
  sure(
    lost.facts.marked.find((each) => each.number === 4).drawn === "mark" &&
      /1 models were not drawn: models\/knife\.mdl is in none of the folders given/.test(
        lost.facts.notes.join(),
      ),
    lost.facts.notes.join(" | "),
  );
  sure(
    /no folders were given/.test(maps.drawSource(map, { ...eye, models: true }).facts.notes.join()),
    "no folders",
  );
});

// ── plans ──
test("a plan writes each floor's height, tints the walk test and lists its entities", () => {
  const bare = { labels: false, entities: false };
  const plain = maps.planOfSource(house(), bare);
  sure(plain.facts.heights.length === 0, "no heights unless asked");
  const heights = maps.planOfSource(house(), { ...bare, heights: true });
  sure(
    heights.facts.heights
      .map((each) => each.z)
      .sort()
      .join() === `0,${STUDY_FLOOR}`,
    `the hall's floor and the study's: ${JSON.stringify(heights.facts.heights)}`,
  );
  let changed = 0;
  for (let i = 0; i < plain.rgba.length; i++) if (plain.rgba[i] !== heights.rgba[i]) changed++;
  sure(changed > 100, "and they are written on the picture");

  const inHall = [160, 200];
  const inStudy = [480, 200];
  const good = maps.planOfSource(house(), { ...bare, reach: true });
  sure(
    isGreen(pixelAt(good, ...planPixel(good.facts, inHall))) &&
      isGreen(pixelAt(good, ...planPixel(good.facts, inStudy))),
    "walked floor is green: the hall and the study",
  );
  sure(/the walk test is tinted on it/.test(good.facts.notes.join()), "and a note says so");
  const walled = house({ door: null });
  const bad = maps.planOfSource(walled, { ...bare, reach: maps.reachOf(walled) });
  sure(
    isGreen(pixelAt(bad, ...planPixel(bad.facts, inHall))) &&
      isReddish(pixelAt(bad, ...planPixel(bad.facts, inStudy))),
    `a study with no doorway is red: ${pixelAt(bad, ...planPixel(bad.facts, inStudy))}`,
  );
  sure(
    !isGreen(pixelAt(plain, ...planPixel(plain.facts, inHall))),
    "and without the walk test nothing is tinted",
  );

  // the box a thing moves with is outlined at its true size: 16 to each side of the monster
  const marked = maps.planOfSource(house(), { labels: false });
  const monsterMark = marked.facts.marks.find((mark) => mark.number === THE_MONSTER);
  sure(monsterMark.size === "32 x 32 x 72", JSON.stringify(monsterMark));
  const corner = planPixel(marked.facts, [IN_THE_STUDY[0] + 16, IN_THE_STUDY[1]]);
  sure(sameColour(pixelAt(marked, ...corner), maps.MARK_COLOURS.monster), `its box's east side at ${corner}`);
  sure(
    !sameColour(pixelAt(maps.planOfSource(house(), bare), ...corner), maps.MARK_COLOURS.monster),
    "not without entities",
  );

  const legend = maps.planOfSource(house(), { legend: true });
  sure(
    legend.width === maps.planOfSource(house()).width + 300,
    "the list of entities is 300 wide, beside it",
  );
  // six things on one spot: some labels are the number alone or left out, and a note says so
  const crowd = house({
    entities: Array.from({ length: 6 }, () =>
      maps.pointEntity(MONSTER, [200, 60, 0], { targetname: "pack" }),
    ),
  });
  const crowded = maps.planOfSource(crowd);
  sure(
    /labels are the entity's number alone and \d+ were left out/.test(crowded.facts.notes.join()),
    crowded.facts.notes.join(" | "),
  );
  sure(
    !/number alone/.test(maps.planOfSource(house()).facts.notes.join()),
    "and no such note where there is room",
  );
  sure(
    crowded.facts.marks.filter((mark) => mark.name === "pack").length === 6,
    "the marks have them all, with their names",
  );
  sure(maps.planOfSource(crowd, { only: [START] }).facts.marks.length === 1, "only: the entities named");

  const compiled = maps.planOf(tworooms, { reach: true, heights: true, labels: false });
  sure(
    compiled.facts.heights.some((each) => each.z === 0) &&
      /the walk test is tinted/.test(compiled.facts.notes.join()),
    "of a compiled map",
  );
  sure(isGreen(pixelAt(compiled, ...planPixel(compiled.facts, [140, 140]))), "the first room is walked");
  sure(
    isReddish(pixelAt(compiled, ...planPixel(compiled.facts, [140, 400]))),
    "the room behind the grate is not",
  );
});

// ── the side section ──
test("a side section shows the floors with their heights, the doorway, and what stands on the line", () => {
  const section = maps.sectionOf(house(), { from: [0, 128], to: [608, 128] });
  const { facts } = section;
  sure(
    facts.length === 608 && facts.looking === 90,
    `${facts.length} long, seen looking north: ${facts.looking}`,
  );
  const floorAt = (z) => facts.floors.find((floor) => floor.z === z);
  near(floorAt(0).from, 0, 2, "the hall's floor begins");
  near(floorAt(0).to, 320, 2, "and ends at the doorway");
  near(floorAt(STUDY_FLOOR).from, 320, 2, "the study's floor begins there, 16 higher");
  near(floorAt(STUDY_FLOOR).to, 608, 2, "and runs to the end");
  const colour = (along, z) => pixelAt(section, ...sectionPixel(facts, along, z));
  const AIR = [14, 14, 18];
  sure(sameColour(colour(160, 80), AIR), `the hall is open space: ${colour(160, 80)}`);
  sure(sameColour(colour(160, -10), maps.PLAN_COLOURS.solid), "under its floor is solid");
  sure(sameColour(colour(336, 60), AIR), "the doorway is open");
  sure(sameColour(colour(336, 130), maps.PLAN_COLOURS.solid), "and over its lintel (z 112) is solid");
  sure(sameColour(colour(336, 8), maps.PLAN_COLOURS.solid), "and under its sill (z 16)");
  const monster = facts.marks.find((mark) => mark.number === THE_MONSTER);
  sure(
    monster.along === 480 && monster.z === STUDY_FLOOR,
    `the monster on the line: ${JSON.stringify(monster)}`,
  );
  // its box, 72 high from its feet: the outline's top edge is at its head
  const head = sectionPixel(facts, 480, STUDY_FLOOR + 72);
  sure(sameColour(pixelAt(section, ...head), maps.MARK_COLOURS.monster), `the top of its box at ${head}`);
  // a section through the wall beside the doorway has no doorway in it
  const beside = maps.sectionOf(house(), { from: [0, 40], to: [608, 40], z: facts.z });
  sure(
    sameColour(pixelAt(beside, ...sectionPixel(beside.facts, 336, 60)), maps.PLAN_COLOURS.solid),
    "beside the doorway, a wall",
  );
  sure(
    !beside.facts.marks.some((mark) => mark.number === THE_MONSTER),
    "and the monster is too far from that line",
  );
  sure(
    maps
      .sectionOf(house(), { from: [0, 40], to: [608, 40], near: 100 })
      .facts.marks.some((mark) => mark.number === THE_MONSTER),
    "unless near is wider",
  );
  // a door standing in the doorway is the outline of its box
  const withDoor = maps.sectionOf(house({ entities: [doorBrush("func_door")] }), {
    from: [0, 128],
    to: [608, 128],
  });
  sure(
    withDoor.facts.marks.some((mark) => mark.classname === "func_door" && mark.along === 336),
    "a door on the line",
  );
  const compiled = maps.sectionOf(tworooms, { from: [96, 0], to: [96, 448] });
  sure(
    compiled.facts.floors.some((floor) => floor.z === 0) &&
      compiled.facts.marks.some((mark) => mark.number === START),
    "of a compiled map",
  );
  sure(
    refuses(() => maps.sectionOf(house(), { from: [0, 128] }), /`from` and `to`, the two ends of the line/),
    "it wants two ends",
  );
  sure(
    refuses(() => maps.sectionOf(house(), { from: [0, 128], to: [0, 128] }), /are one point/),
    "that are two points",
  );
});

// ── the storeys, and the openings ──
test("the storeys are laid side by side, each with the entities of its own", () => {
  const picture = maps.storeysOf(houseOverCellar(), { width: 256, height: 256 });
  const { storeys } = picture.facts;
  sure(
    storeys.length === 2 && picture.width === 512 && picture.height === 256,
    `two plans in a row: ${picture.width}x${picture.height}`,
  );
  sure(
    storeys[0].z === STUDY_FLOOR + 36 && storeys[1].z === -160 + 36 && storeys[1].left === 256,
    JSON.stringify(storeys.map((each) => each.z)),
  );
  const numbersOf = (storey) => storey.marks.map((mark) => mark.number).join();
  sure(
    numbersOf(storeys[0]) === "1,2,3" && numbersOf(storeys[1]) === "4",
    `${numbersOf(storeys[0])} over ${numbersOf(storeys[1])}`,
  );
  const one = maps.storeysOf(house(), { width: 256, height: 256 });
  sure(one.facts.storeys.length === 1 && one.width === 256, "a house with no cellar is one plan");
  sure(
    maps.storeysOf(houseOverCellar(), { z: [52], width: 256, height: 256 }).facts.storeys.length === 1,
    "the cuts may be given",
  );
  sure(
    maps.storeysOf(tworooms, { width: 256, height: 256 }).facts.storeys[0].marks.length === 4,
    "of a compiled map",
  );
  sure(
    refuses(() => maps.storeysOf(house(), { z: ["high"] }), /z: heights to cut at/),
    "a wrong height",
  );
});

test("each opening is looked through, from the floor before it", () => {
  const picture = maps.openingViews(house(), { width: 160, height: 120 });
  const [view] = picture.facts.views;
  sure(picture.facts.views.length === 1 && picture.width === 160, "one doorway, one view");
  sure(
    view.opening === 1 &&
      view.wide === 64 &&
      view.high === 96 &&
      view.yaw === 0 &&
      view.from[0] < 336 &&
      view.from[2] === 64,
    `from the hall, at a player's eyes, looking east: ${JSON.stringify(view)}`,
  );
  // the monster stands behind the doorway: its box is in the picture
  let red = 0;
  for (let y = 0; y < picture.height; y++)
    for (let x = 0; x < picture.width; x++) if (isRed(pixelAt(picture, x, y))) red++;
  sure(red > 20, `the monster is seen through it: ${red} pixels`);
  sure(
    maps.openingViews(house(), { both: true, width: 160, height: 120 }).facts.views[1].yaw === 180,
    "both: back through it too",
  );
  sure(
    refuses(() => maps.openingViews(house({ door: null })), /found no opening on the walked floor/),
    "no opening, no view",
  );
  const compiled = maps.openingViews(tworooms, { width: 160, height: 120 });
  sure(compiled.facts.views.length === 1 && compiled.facts.views[0].wide === 64, "of a compiled map");
});

// ── the commands ──
const goodFile = inFolder("house.map");
const walledFile = inFolder("walled.map");
writeFileSync(goodFile, maps.writeMap(house()));
writeFileSync(walledFile, maps.writeMap(house({ door: null })));
const refused = (args, pattern) => {
  const run = runRefused(SMAK_CLI, ...args);
  sure(run.code === 1 && pattern.test(run.err + run.out), `${args.join(" ")}: ${run.err}${run.out}`);
};

test("map-reach prints the walk test, draws it, and ends with 1 on a fault", () => {
  const said = runSmak("map-reach", goodFile, "--goal", String(THE_MONSTER));
  sure(
    /the walk test, on a grid of 8/.test(said) &&
      /all 2 entities a player goes to are reached on foot/.test(said) &&
      /opening 1 {2}at 336 128 16 {2}64 wide, 96 high, across y/.test(said) &&
      /the walk to 2 monster_zombie is \d+ units/.test(said) &&
      !/WARN/.test(said),
    said,
  );
  const bad = runRefused(SMAK_CLI, "map-reach", walledFile, "-o", inFolder("walled.png"));
  sure(
    bad.code === 1 &&
      /WARN {2}1 of the 2 entities a player goes to are not reached.*no opening leads to it/.test(bad.out),
    bad.out,
  );
  const drawn = smak.unpng(readFileSync(inFolder("walled.png")));
  sure(
    drawn.width > 300 && /walled\.png {2}\d+x\d+ {2}the plan, with the walk test tinted on it/.test(bad.out),
    "its plan is written",
  );
  const json = JSON.parse(runSmak("map-reach", goodFile, "--json"));
  sure(json.openings[0].width === 64 && json.unreached.length === 0 && json.entities.length === 2, "--json");
  const compiled = runSmak("map-reach", join(FIXTURES, "tworooms.bsp"), "--open", String(GRATE));
  sure(/opening 2 /.test(compiled), `a compiled map, its grate open: ${compiled}`);
  const large = runSmak("map-reach", goodFile, "--body", `${MONSTER}=large`, "--start", "info_player_start");
  sure(!/WARN/.test(large), large);
  refused(["map-reach", goodFile, "--doors", "ajar"], /--doors: open or closed, not ajar/);
  refused(
    ["map-reach", goodFile, "--body", `${MONSTER}=huge`],
    /--body monster_zombie=huge: standing, large or crouching/,
  );
  refused(["map-reach", goodFile, "--cell", "0"], /--cell: the grid in units/);
});

test("map-section, map-storeys and map-openings draw, and say what they drew", () => {
  const out = ["-o", inFolder("out.png")];
  const section = runSmak("map-section", goodFile, ...out, "--from", "0,128", "--to", "608,128");
  sure(
    /a section 608 units long, heights -48 to \d+/.test(section) &&
      /floor at z 16 {2}from 32\d to 608 along the line/.test(section) &&
      / 2 {2}monster_zombie +480 along the line, z 16/.test(section),
    section,
  );
  refused(["map-section", goodFile, ...out], /--from x,y and --to x,y, the two ends of the line/);
  refused(
    ["map-section", goodFile, ...out, "--from", "0", "--to", "608,128"],
    /--from: two numbers x,y, not 0/,
  );
  const storeys = runSmak("map-storeys", goodFile, ...out, "--reach");
  sure(
    /1 storeys side by side/.test(storeys) && /cut at z 52: floors from 0 to 16.*; 3 entities/.test(storeys),
    storeys,
  );
  const cut = runSmak("map-storeys", join(FIXTURES, "tworooms.bsp"), ...out, "--z", "40,100");
  sure(/2 storeys side by side/.test(cut) && /cut at z 100; /.test(cut), cut);
  refused(["map-storeys", goodFile, ...out, "--z", "high"], /--z: heights to cut at, a,b,c, not high/);
  const openings = runSmak("map-openings", goodFile, ...out, "--both");
  sure(
    /2 views, each through an opening/.test(openings) &&
      /opening 1: 64 wide, 96 high; from 2\d\d 128 64 looking yaw 0/.test(openings),
    openings,
  );
  refused(["map-openings", walledFile, ...out], /found no opening on the walked floor/);
  const plan = runSmak("map-plan", goodFile, ...out, "--heights", "--legend", "--reach");
  sure(
    /the walk test is tinted on it/.test(plan) && smak.unpng(readFileSync(inFolder("out.png"))).width > 300,
    plan,
  );
  const view = runSmak(
    "map-view",
    goodFile,
    ...out,
    "--from",
    "96,128,64",
    "--yaw",
    "0",
    "--body",
    `${MONSTER}=large`,
  );
  sure(/marked: 2 monster_zombie at pixel \d+,\d+, its box 64 x 64 x 64/.test(view), view);
  sure(
    /map-reach <bsp\|map>/.test(runSmak("help")) && /map-section <bsp\|map>/.test(runSmak("help")),
    "the help names them",
  );
});

// ── the MCP server ──
function startServer() {
  mkdirSync(inFolder("mcp-work"), { recursive: true });
  const child = spawn(
    process.execPath,
    [join(HERE, "../mcp/server.mjs"), "--models", FIXTURES, "--work", inFolder("mcp-work"), "--no-run"],
    { stdio: ["pipe", "pipe", "ignore"] },
  );
  const waiting = new Map();
  let nextId = 1;
  createInterface({ input: child.stdout }).on("line", (line) => {
    const answer = JSON.parse(line);
    waiting.get(answer.id)?.(answer);
    waiting.delete(answer.id);
  });
  const request = (method, params) =>
    new Promise((answered) => {
      const id = nextId++;
      waiting.set(id, answered);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  return {
    request,
    tool: async (name, args = {}) => (await request("tools/call", { name, arguments: args })).result,
    close: () =>
      new Promise((closed) => {
        child.on("close", closed);
        child.stdin.end();
      }),
  };
}
const wordsOf = (result) =>
  result.content
    .filter((piece) => piece.type === "text")
    .map((piece) => piece.text)
    .join("\n");
const picturesOf = (result) =>
  result.content
    .filter((piece) => piece.type === "image")
    .map((piece) => smak.unpng(Buffer.from(piece.data, "base64")));

await testAsync(
  "the MCP server walks a map, and draws its section, storeys and openings",
  "mcp: walk",
  async () => {
    const server = startServer();
    await server.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "selftest", version: "0" },
    });
    const plain = wordsOf(await server.tool("check", { model: "tworooms.map" }));
    sure(
      /no error in the plan/.test(plain) &&
        /places to start: 1 info_player_start/.test(plain) &&
        !/walk test/.test(plain),
      plain,
    );
    const walked = wordsOf(await server.tool("check", { model: "tworooms.map", walk: true, goal: "1" }));
    sure(
      /the walk test, on a grid of 8:/.test(walked) &&
        /opening 1 at 208 96 0: 64 wide, 96 high/.test(walked) &&
        /the walk to 1 info_player_start is 0 units/.test(walked),
      walked,
    );
    const compiled = wordsOf(await server.tool("check", { model: "tworooms.bsp", walk: true }));
    sure(
      /fit for goldsrc/.test(compiled) &&
        /all 1 entities a player goes to are reached on foot/.test(compiled),
      compiled,
    );
    const section = await server.tool("render", {
      model: "tworooms.bsp",
      kind: "section",
      from: "96 0",
      to: "96 448",
      size: 400,
    });
    sure(
      /section: \d+x\d+\na section 448 units long from 96 0 \(left\) to 96 448 \(right\)/.test(
        wordsOf(section),
      ) &&
        /floor at z 0 from/.test(wordsOf(section)) &&
        picturesOf(section).length === 1,
      wordsOf(section),
    );
    const noEnds = await server.tool("render", { model: "tworooms.bsp", kind: "section" });
    sure(noEnds.isError && /from: a point of the plan, "x y"/.test(wordsOf(noEnds)), wordsOf(noEnds));
    const storeys = await server.tool("render", {
      model: "tworooms.map",
      kind: "storeys",
      reach: true,
      size: 400,
    });
    sure(
      /cut at z 36: floors from 0 to 0; 4 entities/.test(wordsOf(storeys)) &&
        picturesOf(storeys).length === 1,
      wordsOf(storeys),
    );
    const openings = await server.tool("render", { model: "tworooms.bsp", kind: "openings", size: 400 });
    sure(
      /opening 1: 64 wide, 96 high; from/.test(wordsOf(openings)) && picturesOf(openings).length === 1,
      wordsOf(openings),
    );
    const plan = await server.tool("render", {
      model: "tworooms.map",
      heights: true,
      reach: true,
      legend: true,
      size: 400,
    });
    sure(/the walk test is tinted on it/.test(wordsOf(plan)), wordsOf(plan));
    sure((await server.close()) === 0, "the server did not end cleanly");
  },
);

sure(existsSync(goodFile), "the house was written");
