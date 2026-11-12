// The walk test, playing more of the game: jumps across a gap and up a ledge, places a player gets into and
// not out of, and slopes too steep to stand on. The maps are built here from the builders of source.mjs: a
// hall cut in two by a trench, and a hall with a ramp up to a platform.
//
// Every "nothing is wrong" has a case beside it where the same tool reports a fault: a trench one unit too
// deep to jump out of, a gap one stride too wide, a ramp a little too steep.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import * as maps from "../check/maps/index.mjs";
import { test, sure, near, HERE, tmp, runSmak, runRefused, SMAK_CLI } from "./helper.mjs";

const FIXTURES = join(HERE, "fixtures");
const folder = join(tmp, "maps-play");
mkdirSync(folder, { recursive: true });
const inFolder = (name) => join(folder, name);
// the fixture's own textures, so that a map made here compiles against its .wad where the compilers are
const WEARS = { floor: "smakfloor", ceiling: "smakwall", wall: "smakwall" };
const MONSTER = "monster_zombie"; // a class of Half-Life's: its origin is at its feet
const monsterOf = (reach) => reach.entities.find((entity) => entity.classname === MONSTER);
const refuses = (run, pattern) => {
  try {
    run();
  } catch (e) {
    return pattern.test(e.message);
  }
  return false;
};
const pixelAt = (picture, [x, y]) => [
  ...picture.rgba.subarray((y * picture.width + x) * 4, (y * picture.width + x) * 4 + 3),
];
/** The pixel of a plan a point of the world is at. */
const planPixel = (facts, [x, y]) => [
  Math.round((x - facts.x0) * facts.scale),
  Math.round((facts.y0 - y) * facts.scale),
];
/**
 * Which of the walk test's colours a floor of a plan is tinted with: green for walked, blue for what only a
 * jump reaches, red for what is not walked, and amber (red with a good deal of green and little blue) for
 * a one-way place.
 */
const tintOf = ([red, green, blue]) => {
  if (green > red && green > blue) return "walked";
  if (blue > red && blue > green) return "jumped";
  return green - blue > 40 ? "trapped" : "unwalked";
};
const tintedAs = (pixel, name) => tintOf(pixel) === name;

// ── the hall with a trench: a near side with the place to start, a trench across it, a far side ──
const NEAR_END = 256; // the trench begins here along x
const HALL_WIDE = 256; // along y
const FAR_SIDE = 320; // how long the far side is
const START_FLOOR = [96, 48, 0];
/**
 * `gap`: how wide the trench is; `deep`: how far under the floor; `high`: the hall's ceiling; `crawl`: a way
 * out of the trench that only a crouching body fits: a tunnel 40 high under the near side ("near") or under
 * the far side ("far"), to a well with stairs up; `entities`: more of them.
 */
function trenchHall({ gap = 160, deep = 64, high = 192, crawl = null, entities = [] } = {}) {
  const farEnd = NEAR_END + gap;
  const rooms = [
    { min: [0, 0, 0], max: [NEAR_END, HALL_WIDE, high] },
    { min: [NEAR_END, 0, -deep], max: [farEnd, HALL_WIDE, high] },
    { min: [farEnd, 0, 0], max: [farEnd + FAR_SIDE, HALL_WIDE, high] },
  ];
  const brushes = [];
  if (crawl === "near") {
    rooms.push({ min: [128, 96, -deep], max: [NEAR_END, 160, -deep + 40] });
    rooms.push({ min: [32, 96, -deep], max: [128, 160, high] });
    brushes.push(...maps.stairs([32, 96, -deep], [96, 160, 0], "-x", WEARS.floor));
  }
  if (crawl === "far") {
    rooms.push({ min: [farEnd, 96, -deep], max: [farEnd + 128, 160, -deep + 40] });
    rooms.push({ min: [farEnd + 128, 96, -deep], max: [farEnd + 224, 160, high] });
    brushes.push(...maps.stairs([farEnd + 160, 96, -deep], [farEnd + 224, 160, 0], "+x", WEARS.floor));
  }
  return {
    worldspawn: { wad: "tworooms.wad" },
    brushes: [...maps.carve(rooms, 16, WEARS), ...brushes],
    entities: [
      maps.playerStart(START_FLOOR, 0),
      maps.pointEntity(MONSTER, [farEnd + 96, 128, 0]),
      maps.light([128, 128, high - 32]),
      ...entities,
    ],
  };
}
// a body stands with its middle up to 16 past an edge: over a trench 160 wide it jumps from the last place
// of the grid before one edge (264) to the first after the other (408)
const MIDDLE_GOES = 144;
const IN_THE_TRENCH = [NEAR_END + 80, 128];
const ON_THE_FAR_SIDE = [NEAR_END + 160 + 200, 64]; // clear of the monster's mark on a plan

test("the engine's numbers are worked out, not guessed: a jump's height, its reach, a slope's limit", () => {
  // PM_Jump throws a player up at sqrt(2 * 800 * 45); at the gravity of 800 that is as high as 45
  const launch = Math.sqrt(2 * 800 * maps.JUMP_HEIGHT);
  near((launch * launch) / (2 * maps.GRAVITY), maps.JUMP_HEIGHT, 1e-9, "a jump's height");
  // the legs drawn up lift the feet by half of what the body loses, 72 to 36
  sure(
    maps.CROUCH_JUMP_HEIGHT - maps.JUMP_HEIGHT ===
      (maps.BODIES.standing.height - maps.BODIES.crouching.height) / 2,
    "a jump with the legs drawn up",
  );
  // the time in the air of a level jump, at the most a player runs
  near(maps.JUMP_REACH, ((2 * launch) / maps.GRAVITY) * maps.RUN_SPEED, 0.5, "a running jump's reach");
  sure(maps.JUMP_REACH === 215 && maps.RUN_SPEED === 320 && maps.GRAVITY === 800, `${maps.JUMP_REACH}`);
  sure(maps.STEEP === 0.7, "the engine's own limit for the ground");
  sure(maps.EXIT_CLASSES.includes("trigger_changelevel"), "Half-Life's way out of a map");
});

test("a jump across a gap is part of the walk when asked for, and what only a jump reaches is told apart", () => {
  // on foot the far side is not reached: the walk says what it would take, and where
  const afoot = maps.reachOf(trenchHall());
  const told = monsterOf(afoot);
  sure(!told.reached && told.how === "jump", `on foot: ${told.how}`);
  sure(
    new RegExp(
      `only by a jump.*a jump of ${MIDDLE_GOES} across a gap, from 264 \\d+ 0 to 408 \\d+ 0 \\(level\\)`,
    ).test(told.why),
    told.why,
  );
  sure(afoot.leaps.length === 0 && afoot.jumped(...ON_THE_FAR_SIDE) === null, "no jump is part of this walk");
  // with jumps it is reached, and still told apart from what is walked to
  const jumping = maps.reachOf(trenchHall(), { jump: true });
  const reached = monsterOf(jumping);
  sure(reached.reached && reached.how === "jump" && !jumping.unreached.length, `with jumps: ${reached.how}`);
  sure(
    jumping.leaps.length === 1 && jumping.leaps[0].run === MIDDLE_GOES && jumping.leaps[0].rise === 0,
    `the jump: ${JSON.stringify(jumping.leaps)}`,
  );
  sure(
    jumping.jumped(...ON_THE_FAR_SIDE) === 0 &&
      jumping.walked(...ON_THE_FAR_SIDE) === 0 &&
      jumping.jumped(...START_FLOOR.slice(0, 2)) === null,
    "the far side is floor only a jump reaches; the near side is not",
  );
  const facts = jumping.facts.join(" | ");
  sure(/jumps are part of the walk: up a ledge of 45, and across a gap as far as 215/.test(facts), facts);
  sure(/about \d+ square units of floor are reached only by jumping/.test(facts), facts);
  sure(
    /1 jumps across a gap, .* lead to floor not walked to, .*: a jump of 144 across a gap/.test(facts),
    facts,
  );
  sure(/1 entities are reached only by jumping: 2 monster_zombie/.test(facts), facts);
  // (the place to start is an entity a player goes to, too)
  sure(/all 2 entities a player goes to are reached on foot or by a jump/.test(facts), facts);
  // a hall with no gap: jumps are asked for, and nothing is reached only by them
  const whole = maps.reachOf(trenchHall({ deep: 16 }), { jump: true });
  sure(
    monsterOf(whole).how === "walk" &&
      whole.leaps.length === 0 &&
      /no floor is reached only by jumping/.test(whole.facts.join()),
    whole.facts.join(" | "),
  );
});

test("a jump goes as far as a run carries it, and no farther: the gap, the speed, the gravity, the ceiling", () => {
  const overThe = (gap, options, hall = {}) =>
    monsterOf(maps.reachOf(trenchHall({ gap, ...hall }), { jump: true, ...options }));
  // on the grid of 8 the middle goes 16 less than the gap is wide: 224 is jumped (208), 232 is not (216
  // is over 215)
  sure(overThe(224).reached, "a gap of 224 is jumped");
  const wide = overThe(232);
  sure(!wide.reached && wide.how === "air", `a gap of 232 is not: ${wide.how}`);
  // a slower game jumps less far, a lighter one farther
  sure(!overThe(160, { speed: 150 }).reached, "at 150 units a second, 144 is too far");
  sure(overThe(232, { gravity: 600 }).reached, "at a gravity of 600 a gap of 232 is jumped");
  sure(overThe(232, { speed: 400 }).reached, "and at 400 units a second");
  // under a ceiling too low for a jump's top (72 for the body and 40 over it), nothing is jumped
  sure(!overThe(160, {}, { high: 112 }).reached, "a low ceiling cuts a jump short");
  sure(overThe(160, {}, { high: 120 }).reached, "with room for its top it is jumped");
  sure(
    refuses(() => maps.reachOf(trenchHall(), { speed: 0 }), /speed: units a second, over 0/) &&
      refuses(() => maps.reachOf(trenchHall(), { gravity: -1 }), /gravity: units a second each second/),
    "a speed or a gravity that is none is refused",
  );
});

test("a place a player gets into and not out of is a one-way place, and is told with where", () => {
  // the trench is 64 deep: a step is 18, a jump 45, a jump with the legs drawn up 63
  const trapped = maps.reachOf(trenchHall());
  sure(trapped.oneWay.length === 1, `one place: ${JSON.stringify(trapped.oneWay)}`);
  const [pit] = trapped.oneWay;
  sure(
    pit.floors.join() === "-64,-64" && pit.entry.drop === 64 && pit.area > 20000 && pit.area < 40000,
    JSON.stringify(pit),
  );
  sure(
    Math.abs(pit.at[0] - IN_THE_TRENCH[0]) <= 8 && Math.abs(pit.at[1] - IN_THE_TRENCH[1]) <= 8,
    `about its middle: ${pit.at}`,
  );
  const warned = trapped.warnings.join(" | ");
  sure(
    /1 places are one-way: a player gets into each .* about \d+ square units about \d+ \d+ -64 \(floor z -64\), entered by a drop of 64 at 272 \d+ -64/.test(
      warned,
    ),
    warned,
  );
  sure(
    trapped.trapped(...IN_THE_TRENCH) === -64 && trapped.trapped(...START_FLOOR.slice(0, 2)) === null,
    "trapped() is the trench's floor, and no other",
  );
  // one unit less deep and a jump with the legs drawn up gets out: nothing is wrong
  const shallow = maps.reachOf(trenchHall({ deep: 63 }));
  sure(
    shallow.oneWay.length === 0 &&
      !/one-way/.test(shallow.warnings.join()) &&
      /no one-way place: from all the floor walked there is a way back to a place to start/.test(
        shallow.facts.join(),
      ),
    `${shallow.warnings.join(" | ")} ${shallow.facts.join(" | ")}`,
  );
  // a way out of the map in the trench: Half-Life's own class, or one that is named
  const leave = (classname) =>
    maps.brushEntity(classname, maps.box([NEAR_END + 32, 32, -64], [NEAR_END + 96, 96, 0], "AAATRIGGER"), {
      targetname: "drain",
    });
  const withExit = maps.reachOf(trenchHall({ entities: [leave("trigger_changelevel")] }));
  sure(
    withExit.oneWay.length === 0 &&
      /or to a way out \(\d+ trigger_changelevel "drain"\)/.test(withExit.facts.join()),
    withExit.facts.join(" | "),
  );
  const unnamed = trenchHall({ entities: [leave("trigger_multiple")] });
  sure(maps.reachOf(unnamed).oneWay.length === 1, "a trigger that is no way out leaves it a one-way place");
  sure(maps.reachOf(unnamed, { exits: ["drain"] }).oneWay.length === 0, "till `exits` names it");
  // a way out that only a crouching body fits is a way out
  const crawled = maps.reachOf(trenchHall({ crawl: "near" }));
  sure(crawled.oneWay.length === 0, `a tunnel 40 high leads out: ${crawled.warnings.join(" | ")}`);
  // and one that leads to the far side, from where the way back is a jump over the trench
  const round = maps.reachOf(trenchHall({ crawl: "far" }));
  sure(round.oneWay.length === 0, `crawled out and jumped back: ${round.warnings.join(" | ")}`);
  // (wider than a jump carries, the far side is no way back: the trench is a one-way place again)
  sure(
    maps.reachOf(trenchHall({ crawl: "far", gap: 256 })).oneWay.length === 1,
    "over a gap of 256 it is not",
  );
  // a thing in the trench is named with it
  const held = maps.reachOf(
    trenchHall({ entities: [maps.pointEntity("item_test", [...IN_THE_TRENCH, -56])] }),
  );
  sure(
    /; in it: \d+ item_test/.test(held.warnings.join()) && held.oneWay[0].entities.length === 1,
    held.warnings.join(" | "),
  );
});

test("a room a teleport leads into and nothing leads out of is a one-way place too", () => {
  const vault = { min: [0, 300, 0], max: [128, 428, 128] };
  const hall = { min: [0, 0, 0], max: [256, 256, 160] };
  const vaultMap = (more = []) => ({
    brushes: maps.carve([hall, vault], 16, WEARS),
    entities: [
      maps.playerStart(START_FLOOR, 0),
      maps.pointEntity("info_teleport_destination", [64, 364, 4], { targetname: "dest" }),
      maps.brushEntity("trigger_teleport", maps.box([160, 160, 0], [192, 192, 64], "AAATRIGGER"), {
        target: "dest",
      }),
      ...more,
    ],
  });
  const oneWay = maps.reachOf(vaultMap());
  sure(
    oneWay.oneWay.length === 1 && /entered through a teleport at/.test(oneWay.warnings.join()),
    oneWay.warnings.join(" | "),
  );
  // a second teleport back to the hall: the way out is followed backwards through it
  const back = [
    maps.pointEntity("info_teleport_destination", [96, 96, 4], { targetname: "home" }),
    maps.brushEntity("trigger_teleport", maps.box([16, 380, 0], [48, 412, 64], "AAATRIGGER"), {
      target: "home",
    }),
  ];
  sure(maps.reachOf(vaultMap(back)).oneWay.length === 0, "with a teleport back, it is no one-way place");
});

// ── the hall with a ramp: a floor, a platform 96 over it, and a ramp between them ──
const PLATFORM_FROM = 320;
const ON_THE_PLATFORM = [416, 128, 96];
const ON_THE_FLOOR = [96, 128, 0];
/** `run`: how long the ramp is for its rise of 96. 192 is a walk; 64 is steeper than a player stands on. */
function rampHall({ run = 192, start = ON_THE_FLOOR } = {}) {
  return {
    worldspawn: { wad: "tworooms.wad" },
    brushes: [
      ...maps.carve([{ min: [0, 0, 0], max: [512, 256, 224] }], 16, WEARS),
      maps.box([PLATFORM_FROM, 0, 0], [512, 256, 96], WEARS.floor),
      maps.wedge([PLATFORM_FROM - run, 64, 0], [PLATFORM_FROM, 192, 96], "+x", WEARS.floor),
    ],
    entities: [
      maps.playerStart(start, 0),
      maps.pointEntity(MONSTER, start === ON_THE_FLOOR ? ON_THE_PLATFORM : ON_THE_FLOOR),
      maps.light([128, 128, 200]),
    ],
  };
}

test("a slope too steep to stand on is slid down and never walked up, as the engine has it", () => {
  // a ramp of 26 degrees is walked, and nothing is said of slopes
  const gentle = maps.reachOf(rampHall());
  sure(
    monsterOf(gentle).reached && gentle.steep === 0 && !/too steep/.test(gentle.facts.join()),
    `a ramp of 192 for 96: ${monsterOf(gentle).how}, ${gentle.steep}`,
  );
  // one of 56 degrees is not: each 8 units of it rise 12, a step, and it was walked before
  const steep = maps.reachOf(rampHall({ run: 64 }));
  sure(!monsterOf(steep).reached, `a ramp of 64 for 96 is not walked up: ${monsterOf(steep).how}`);
  sure(
    monsterOf(maps.reachOf(rampHall({ run: 64 }), { slopes: false })).reached,
    "with `slopes: false` it is",
  );
  // not by jumping either: a jump lands on it and slides back
  sure(!monsterOf(maps.reachOf(rampHall({ run: 64 }), { jump: 63 })).reached, "nor is it jumped up");
  // the limit is the engine's 0.7 for the normal's z: 96 up in 98 along is 0.714, in 92 along 0.692
  sure(monsterOf(maps.reachOf(rampHall({ run: 104 }))).reached, "a little under the limit, walked");
  sure(!monsterOf(maps.reachOf(rampHall({ run: 88 }))).reached, "a little over it, not");
  // from the platform it is slid down: the floor is reached, the slope is counted, and there is no way back
  const down = maps.reachOf(rampHall({ run: 64, start: ON_THE_PLATFORM }));
  sure(monsterOf(down).reached, "down the slope the floor is reached");
  sure(
    down.steep > 0 &&
      /about \d+ square units of the floor walked are too steep to stand on/.test(down.facts.join()),
    down.facts.join(" | "),
  );
  sure(
    down.oneWay.length === 1 && /entered down a slope too steep to climb/.test(down.warnings.join()),
    down.warnings.join(" | "),
  );
  // down the gentle ramp there is a way back, and no one-way place
  sure(
    maps.reachOf(rampHall({ start: ON_THE_PLATFORM })).oneWay.length === 0,
    "the gentle ramp is walked back up",
  );
  // the space says how a floor lies: 1 on the level, the slope's own on the ramp
  const space = maps.spaceOf(rampHall({ run: 64 }));
  const lies = (x, y) => space.blocked(x, y, maps.BODIES.point).at(0)[2];
  near(lies(96, 128), 1, 1e-9, "the level floor");
  near(lies(PLATFORM_FROM - 32, 128), 64 / Math.hypot(64, 96), 1e-6, "the ramp");
});

test("a plan tints floor only a jump reaches and the floor of a one-way place in colours of their own", () => {
  const map = trenchHall();
  const reach = maps.reachOf(map, { jump: true });
  const plan = maps.planOfSource(map, { reach, labels: false, z: 40 });
  sure(
    /blue where only a jump leads, amber where a player gets in and not out again/.test(
      plan.facts.notes.join(),
    ),
    plan.facts.notes.join(" | "),
  );
  const tintAt = (point) => pixelAt(plan, planPixel(plan.facts, point));
  sure(tintedAs(tintAt([96, 128]), "walked"), `the near side: ${tintAt([96, 128])}`);
  sure(tintedAs(tintAt(IN_THE_TRENCH), "trapped"), `the trench: ${tintAt(IN_THE_TRENCH)}`);
  sure(tintedAs(tintAt(ON_THE_FAR_SIDE), "jumped"), `the far side: ${tintAt(ON_THE_FAR_SIDE)}`);
  // on foot the far side is floor with room to stand and no way to it
  const afoot = maps.planOfSource(map, { reach: maps.reachOf(map), labels: false, z: 40 });
  sure(
    tintedAs(pixelAt(afoot, planPixel(afoot.facts, ON_THE_FAR_SIDE)), "unwalked"),
    "on foot, the far side is not walked",
  );
});

test("map-reach takes --jump, --speed, --gravity, --no-slopes and --exit, and says what it found", () => {
  const trench = inFolder("trench.map");
  writeFileSync(trench, maps.writeMap(trenchHall()));
  const afoot = runRefused(SMAK_CLI, "map-reach", trench);
  sure(afoot.code === 1, `an entity is not reached: exit ${afoot.code}`);
  sure(/WARN {2}1 places are one-way/.test(afoot.out) && /only by a jump/.test(afoot.out), afoot.out);
  const jumping = runSmak("map-reach", trench, "--jump", "-o", inFolder("trench.png"));
  sure(/1 jumps across a gap, .* lead to floor not walked to/.test(jumping), jumping);
  sure(/WARN {2}1 places are one-way/.test(jumping), "a one-way place alone does not end the command with 1");
  const picture = smak.unpng(readFileSync(inFolder("trench.png")));
  sure(picture.width > 100, "and its plan is drawn");
  const slow = runRefused(SMAK_CLI, "map-reach", trench, "--jump", "--speed", "150");
  sure(slow.code === 1 && /not reached on foot or by a jump/.test(slow.out), slow.out);
  const light = runSmak("map-reach", trench, "--jump", "--speed", "150", "--gravity", "400");
  sure(/all 2 entities a player goes to are reached on foot or by a jump/.test(light), light);
  // a way out, named
  const drained = inFolder("drained.map");
  const drain = maps.brushEntity(
    "func_button",
    maps.box([NEAR_END + 32, 32, -64], [NEAR_END + 96, 96, 0], "smakwall"),
    {
      targetname: "drain",
    },
  );
  writeFileSync(drained, maps.writeMap(trenchHall({ entities: [drain] })));
  sure(/1 places are one-way/.test(runSmak("map-reach", drained, "--jump")), "a button is no way out");
  sure(!/one-way: a player/.test(runSmak("map-reach", drained, "--jump", "--exit", "drain")), "--exit drain");
  // the steep ramp
  const ramp = inFolder("ramp.map");
  writeFileSync(ramp, maps.writeMap(rampHall({ run: 64 })));
  sure(runRefused(SMAK_CLI, "map-reach", ramp).code === 1, "the steep ramp is not walked up");
  sure(
    /all 2 entities a player goes to are reached on foot/.test(runSmak("map-reach", ramp, "--no-slopes")),
    "--no-slopes",
  );
  const wrong = runRefused(SMAK_CLI, "map-reach", ramp, "--speed", "none");
  sure(wrong.code === 1 && /--speed/.test(wrong.err), wrong.err);
});

// ── the compiled map: where the compilers are ──
const compilers = process.env[maps.COMPILERS_VARIABLE] ? maps.findCompilers() : { found: false };
const testCompiled = (name, run) => {
  if (compilers.found) test(name, run);
  else
    console.log(
      `skip  ${name}\n      skipped: no compilers (name the folder of VHLT in ${maps.COMPILERS_VARIABLE} to run it)`,
    );
};
/** A map of this file compiled: what `readBsp` gives of it. */
function compiled(name, map) {
  const file = inFolder(`${name}.map`);
  writeFileSync(file, maps.writeMap(map));
  const result = maps.compileMap(file, {
    wads: [join(FIXTURES, "tworooms.wad")],
    compilers,
    timeout: 120_000,
  });
  sure(!result.errors.length && result.leak === null, `${name}: ${result.errors.join("; ")}`);
  return maps.readBsp(readFileSync(result.bsp));
}

testCompiled(
  "compiled: the map's own clip hull says how a floor lies, and the slope and the trench are found alike",
  () => {
    // the steep ramp: not walked up, slid down, as in its source
    const ramp = compiled("ramp-steep", rampHall({ run: 64 }));
    sure(!monsterOf(maps.reachOf(ramp)).reached, "the steep ramp is not walked up");
    sure(monsterOf(maps.reachOf(ramp, { slopes: false })).reached, "with `slopes: false` it is");
    sure(monsterOf(maps.reachOf(compiled("ramp-gentle", rampHall()))).reached, "the gentle ramp is walked");
    const down = maps.reachOf(compiled("ramp-down", rampHall({ run: 64, start: ON_THE_PLATFORM })));
    sure(monsterOf(down).reached && down.steep > 0 && down.oneWay.length === 1, down.warnings.join(" | "));
    const space = maps.spaceOf(ramp);
    near(space.blocked(96, 128).at(0)[2], 1, 1e-6, "the level floor, by the hull");
    near(
      space.blocked(PLATFORM_FROM - 32, 128).at(0)[2],
      64 / Math.hypot(64, 96),
      1e-3,
      "the ramp, by the hull",
    );
    // the trench: a one-way place, jumped over
    const trench = compiled("trench", trenchHall());
    const afoot = maps.reachOf(trench);
    sure(
      afoot.oneWay.length === 1 && afoot.oneWay[0].floors.join() === "-64,-64",
      JSON.stringify(afoot.oneWay),
    );
    const jumping = maps.reachOf(trench, { jump: true });
    sure(
      monsterOf(jumping).how === "jump" && jumping.leaps.length === 1 && jumping.leaps[0].run === MIDDLE_GOES,
      JSON.stringify(jumping.leaps),
    );
  },
);
