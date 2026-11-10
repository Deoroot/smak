// The walk test as an agent rebuilding a map met it: a body asked for by its name; what carries a walk on
// (a teleport, a ladder in a shaft no place of the grid is in, the doors and the walls that give way); why
// each part of the floor that is not walked to is not; and a profile's own lists used without being given
// again.
//
// The maps are built here from nothing: a hall, a study beside it through a doorway, and what each case adds.
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../check/maps/index.mjs";
import { test, sure, HERE, tmp, runRefused, SMAK_CLI } from "./helper.mjs";

const tworooms = maps.readBsp(readFileSync(join(HERE, "fixtures", "tworooms.bsp")));
const WEARS = { floor: "FLOOR", ceiling: "CEILING", wall: "WALL" };
const HALL = { min: [0, 0, 0], max: [320, 256, 160] };
const STUDY_FLOOR = 16; // a step up from the hall
const DOOR = { from: 96, to: 160, high: 96 }; // the doorway, along y, through 32 of rock at x 320 to 352
const START_FLOOR = [96, 128, 0];
const MONSTER = "monster_zombie"; // Half-Life's: its origin is at its feet
const IN_THE_STUDY = [480, 128];
const IN_THE_DOORWAY = [
  [328, DOOR.from, STUDY_FLOOR],
  [344, DOOR.to, STUDY_FLOOR + DOOR.high],
];

/** The hall and the study. `floor`: the study's; `door`: the doorway, or null; and more brushes and entities. */
function house({ floor = STUDY_FLOOR, door = DOOR, rooms = [], brushes = [], entities = [] } = {}) {
  const all = [HALL, { min: [352, 0, floor], max: [608, 256, 144] }, ...rooms];
  if (door) all.push({ min: [320, door.from, floor], max: [352, door.to, floor + door.high] });
  return {
    worldspawn: {},
    brushes: [...maps.carve(all, 16, WEARS), ...brushes],
    entities: [
      maps.playerStart(START_FLOOR, 0),
      maps.pointEntity(MONSTER, [...IN_THE_STUDY, floor]),
      ...entities,
    ],
  };
}
const monsterOf = (reach) => reach.entities.find((entity) => entity.classname === MONSTER);
/** A brush entity filling the doorway. */
const inTheDoorway = (classname, keys) =>
  maps.brushEntity(classname, maps.box(...IN_THE_DOORWAY, "DOORWOOD"), keys);
const refuses = (run, pattern) => {
  try {
    run();
  } catch (e) {
    return pattern.test(e.message);
  }
  return false;
};
/** What a walk gives, without its functions, to be told the same as another. */
const plain = (reach) =>
  JSON.stringify(reach, (key, value) => (typeof value === "function" ? undefined : value));

// ── 7: a body by its name ──
test("a body is asked for by its name as well as by maps.BODIES, and anything else is refused in a sentence", () => {
  const space = maps.spaceOf(house());
  for (const name of Object.keys(maps.BODIES))
    sure(
      JSON.stringify(space.blocked(160, 128, name)) ===
        JSON.stringify(space.blocked(160, 128, maps.BODIES[name])),
      `blocked(x, y, "${name}") is blocked(x, y, maps.BODIES.${name})`,
    );
  sure(space.blocked(160, 128, "point")[1][0] === 160 - 2, "the point is a probe 2 high");
  sure(maps.restOf(space, [160, 128, 0], "crouching").fits, "restOf takes a name");
  sure(Array.isArray(space.climbs(160, 128, "large")), "and climbs");
  const compiled = maps.spaceOf(tworooms);
  sure(
    JSON.stringify(compiled.blocked(96, 96, "standing")) === JSON.stringify(compiled.blocked(96, 96)),
    "a compiled map's space too",
  );
  sure(maps.bodyOf({ half: 16, height: 36 }) === maps.BODIES.crouching, "a box of a hull's size is the hull");
  sure(
    refuses(() => space.blocked(160, 128, "pointy"), /blocked: one of maps\.BODIES, its name \("point", "standing", "large", "crouching"\) or a box \{ half, height \}, not "pointy"/), // prettier-ignore
    "a name that is no body is refused, and the sentence says what is wanted and what was given",
  );
  sure(
    refuses(() => maps.restOf(space, [0, 0, 0], 7), /restOf: one of maps\.BODIES.*not 7/),
    "so is a number",
  );
  sure(
    refuses(
      () => compiled.blocked(96, 96, { half: 10, height: 50 }),
      /a compiled map holds only its four hulls/,
    ),
    "a box of its own cannot be asked of a compiled map, as before",
  );
});

// ── 8: what carries a walk on ──
test("a teleport carries every way of the walk on, its landing is no place to go to, and one that leads nowhere is warned of", () => {
  // a sealed room, a teleport into it, and over its floor a ledge of 40: only a jump gets on it
  const vault = { min: [0, 300, 0], max: [256, 428, 128] };
  const ledge = maps.box([160, 316, 0], [256, 428, 40], "LEDGE");
  const map = (keys) => ({
    worldspawn: {},
    brushes: [...maps.carve([HALL, vault], 16, WEARS), ledge],
    entities: [
      maps.playerStart(START_FLOOR, 0),
      maps.pointEntity("item_test", [220, 380, 48]),
      maps.pointEntity("info_teleport_destination", [64, 364, 40], { targetname: "dest" }),
      maps.brushEntity("trigger_teleport", maps.box([16, 16, 0], [48, 48, 64], "AAATRIGGER"), keys),
    ],
  });
  const item = (reach) => reach.entities.find((entity) => entity.classname === "item_test");
  const through = maps.reachOf(map({ target: "dest" }));
  sure(/1 teleports were walked into/.test(through.facts.join()), through.facts.join(" | "));
  // before, a jump was tried from the places to start only, and the item was "none"
  sure(
    item(through).how === "jump" && /only by a jump/.test(item(through).why),
    `what only a jump reaches beyond a teleport is told so: ${item(through).how}: ${item(through).why}`,
  );
  sure(
    !through.entities.some((entity) => entity.classname === "info_teleport_destination"),
    "where a teleport puts a player is not counted among the places one goes to",
  );
  sure(
    maps
      .reachOf(map({ target: "dest" }), { markers: ["dest"] })
      .entities.some((entity) => entity.targetname === "dest"),
    "unless a marker names it",
  );
  const lost = maps.reachOf(map({ target: "nowhere" }));
  sure(
    /1 teleports a player walks into lead nowhere: 4 trigger_teleport: no entity with an origin is named "nowhere"/.test(lost.warnings.join()), // prettier-ignore
    lost.warnings.join(" | "),
  );
});

/**
 * A ledge 64 high (more than any jump) whose face is at x 207, a ladder against it 4 thick, and so a body
 * touches the ladder only with its middle between x 186 and 191: no place of a grid of 8 is there.
 */
const LEDGE_FACE = 207;
const offGridLadder = (more = []) =>
  house({
    brushes: [maps.box([LEDGE_FACE, 0, 0], [320, 96, 64], "LEDGE")],
    entities: [
      maps.pointEntity("item_test", [260, 48, 70]),
      maps.brushEntity("func_ladder", maps.box([LEDGE_FACE - 4, 32, 0], [LEDGE_FACE, 64, 64], "AAATRIGGER")),
      ...more,
    ],
  });
test("a ladder is climbed in a shaft that no place of the grid is in", () => {
  const item = (reach) => reach.entities.find((entity) => entity.classname === "item_test");
  const space = maps.spaceOf(offGridLadder());
  sure(
    space.climbs(184, 48).length === 0 && space.blocked(192, 48)[0][1] === 64,
    "the places of the grid miss it: at x 184 no ladder is touched, and x 192 is on the ledge",
  );
  sure(space.ladders.length === 1 && space.ladders[0].number === 4, `the space lists its ladders: ${JSON.stringify(space.ladders)}`); // prettier-ignore
  const reach = maps.reachOf(offGridLadder());
  sure(
    item(reach).reached && item(reach).how === "walk",
    `the ledge is climbed to: ${item(reach).how} ${item(reach).why}`,
  );
  sure(/1 ladders were climbed to floor that is walked to no other way: 4 func_ladder/.test(reach.facts.join()), reach.facts.join(" | ")); // prettier-ignore
  sure(reach.on(260, 48, 64).walked, "and its top is walked floor");
  const without = house({ brushes: [maps.box([LEDGE_FACE, 0, 0], [320, 96, 64], "LEDGE")], entities: [maps.pointEntity("item_test", [260, 48, 70])] }); // prettier-ignore
  sure(!item(maps.reachOf(without)).reached, "without the ladder the ledge is not got onto");
});

test("a lift is ridden between its top and its bottom, as a ladder is climbed", () => {
  // the ledge 64 high, past a jump; a func_plat before it built at its top, travelling 64 down to the floor
  const item = (reach) => reach.entities.find((entity) => entity.classname === "item_test");
  const ledge = maps.box([LEDGE_FACE, 0, 0], [320, 96, 64], "LEDGE");
  const lift = maps.brushEntity("func_plat", maps.box([LEDGE_FACE - 64, 16, 48], [LEDGE_FACE, 80, 64], "RUST"), { height: 64 }); // prettier-ignore
  const map = (more) => house({ brushes: [ledge], entities: [maps.pointEntity("item_test", [260, 48, 70]), ...more] });
  sure(!item(maps.reachOf(map([]), { jump: true })).reached, "without the lift the ledge is not got onto");
  const reach = maps.reachOf(map([lift]));
  sure(item(reach).reached, `with it, it is: ${item(reach).why}`);
  const way = maps.spaceOf(map([lift])).ladders[0];
  sure(way.min[2] === -1 && way.max[2] === 64, `its shaft is its travel: ${JSON.stringify(way)}`);
  sure(reach.facts.some((f) => /func_plat rides from z 64, where it is built, down to z 0/.test(f)) && !reach.warnings.some((w) => /func_plat/.test(w)), reach.warnings.join(" | "));
  // built on the floor with a height under 0 it rides up, to no floor: told, with what the height means
  const up = maps.brushEntity("func_plat", maps.box([LEDGE_FACE - 64, 16, -16], [LEDGE_FACE, 80, 0], "RUST"), { height: -40 });
  const wrong = maps.reachOf(map([up]));
  sure(wrong.warnings.some((w) => /func_plat rides from z 0, where it is built, up to z 40: at z 40 no floor lies within a step of it.*height under 0|one under 0 rides up/.test(w)), wrong.warnings.join(" | "));
  // with a name it is ridden when something names it, as scenery is moved: said, not judged
  const toggled = maps.reachOf(map([maps.brushEntity("func_plat", maps.box([LEDGE_FACE - 64, 16, -16], [LEDGE_FACE, 80, 0], "RUST"), { height: -40, targetname: "pillar" })])); // prettier-ignore
  sure(!toggled.warnings.some((w) => /func_plat/.test(w)) && toggled.facts.some((f) => /"pillar" rides from z 0, where it is built, up to z 40 when named/.test(f)), toggled.warnings.join(" | ")); // prettier-ignore
});

test("a pit whose only way out is such a ladder is no one-way place", () => {
  // a pit 96 deep in the hall's floor, its east wall at x 199: a ladder 4 thick against it is touched with
  // the body's middle between x 178 and 183, off the grid
  const pit = { min: [96, 32, -96], max: [199, 96, 0] };
  const ladder = maps.brushEntity("func_ladder", maps.box([195, 48, -96], [199, 80, 0], "AAATRIGGER"));
  const without = maps.reachOf(house({ rooms: [pit] }));
  sure(without.oneWay.length === 1, `with no ladder the pit is one-way: ${without.warnings.join(" | ")}`);
  const withLadder = maps.reachOf(house({ rooms: [pit], entities: [ladder] }));
  sure(
    withLadder.oneWay.length === 0 && /no one-way place/.test(withLadder.facts.join()),
    `the ladder is the way back: ${withLadder.warnings.join(" | ")}`,
  );
});

test("doors of every kind are open unless told; what breaks or is switched off is a wall unless told", () => {
  for (const classname of ["func_door", "func_door_rotating", "momentary_door"]) {
    const map = house({ entities: [inTheDoorway(classname, { targetname: "gate" })] });
    sure(monsterOf(maps.reachOf(map)).reached, `a ${classname} is open`);
    sure(!monsterOf(maps.reachOf(map, { doors: "closed" })).reached, `and with doors: "closed", shut`);
  }
  for (const classname of ["func_breakable", "func_wall_toggle", "func_pushable"]) {
    const map = house({ entities: [inTheDoorway(classname, { targetname: "seal" })] });
    sure(!monsterOf(maps.reachOf(map)).reached, `a ${classname} is a wall`);
    sure(monsterOf(maps.reachOf(map, { walls: "gone" })).reached, `and with walls: "gone", not there`);
    sure(!monsterOf(maps.reachOf(map, { walls: "gone", shut: ["seal"] })).reached, "unless shut names it");
    sure(
      monsterOf(maps.reachOf(map, { open: ["seal"] })).reached,
      "and open by name takes it away, as before",
    );
    const area = maps.spaceOf(map).areas.find((each) => each.classname === classname);
    sure(area.gives && area.solid && !area.open, `its box says it gives way: ${JSON.stringify(area)}`);
  }
  // the SDK's SF_WALL_START_OFF: a toggled wall that starts off is not there when the map begins
  const startsOff = house({
    entities: [inTheDoorway("func_wall_toggle", { targetname: "seal", spawnflags: "1" })],
  });
  sure(monsterOf(maps.reachOf(startsOff)).reached, "a func_wall_toggle with spawnflag 1 is not there");
  sure(!monsterOf(maps.reachOf(startsOff, { shut: ["seal"] })).reached, "unless shut names it");
  sure(
    !monsterOf(maps.reachOf(house({ entities: [inTheDoorway("func_wall")] }), { walls: "gone" })).reached,
    "a func_wall gives no way: it is a wall whatever walls says",
  );
  sure(refuses(() => maps.spaceOf(house(), { walls: "down" }), /walls: "standing" or "gone", not "down"/), "a wrong walls is refused"); // prettier-ignore
});

// ── 8: why a part of the floor is not walked to ──
test("the share of the floor walked, and each part not walked to with what it takes and where", () => {
  const whole = maps.reachOf(house());
  sure(
    whole.share === 1 && whole.parts.length === 0 && whole.standable === whole.area,
    `all of it: ${whole.share}`,
  );
  sure(/the walk reaches 100 in 100 of the floor a standing player fits on/.test(whole.facts.join()), whole.facts.join(" | ")); // prettier-ignore
  const cases = [
    ["jump", house({ floor: 32 }), /only by a jump \(up to 45 units; a step is 18\): at 312 128 32 the floor rises 32/],
    ["crouch-jump", house({ floor: 60 }), /only by a jump with the legs drawn up/],
    ["crouch", house({ door: { ...DOOR, high: 60 } }), /only crouching \(and jumping\): at 312 128 16 the way is 60 high/],
    ["air", house({ door: { from: 116, to: 140, high: 96 } }), /by no way on foot, though open air leads to it: the walked floor comes within \d+ of it/],
    ["none", house({ door: null }), /^no opening leads to it: the walked floor comes within \d+ of it/],
  ]; // prettier-ignore
  for (const [how, map, words] of cases) {
    const reach = maps.reachOf(map);
    const study = reach.parts[0];
    sure(
      reach.parts.length === 1 && study.how === how && words.test(study.why),
      `${how}: ${JSON.stringify(reach.parts)}`,
    );
    sure(study.area > 50000 && study.floors[0] === study.floors[1] && study.at[0] > 352, `the study is the part: ${JSON.stringify(study)}`); // prettier-ignore
    sure(
      study.nearest && study.nearest.away < 384 && study.nearest.at[0] <= 320,
      "the walked floor nearest it is in the hall",
    );
    sure(reach.share > 0.5 && reach.share < 0.6, `about half of the floor is walked: ${reach.share}`);
    sure(/1 parts of that floor are not walked to; the largest first: about \d+ square units about/.test(reach.facts.join()), reach.facts.join(" | ")); // prettier-ignore
  }
  sure(
    /reached only by a jump: a player is meant to jump there, and `jump: true` makes jumps part of the walk/.test(maps.reachOf(house({ floor: 32 })).facts.join()), // prettier-ignore
    "a map that is mostly jumped through is said to be",
  );
  sure(maps.reachOf(house({ floor: 32 }), { jump: true }).share === 1, "and with jumps it is walked whole");
  // a post 16 across in the hall: the top of it is a patch, counted and not told
  const post = maps.reachOf(house({ brushes: [maps.box([40, 40, 0], [56, 56, 64], "WALL")] }));
  sure(
    post.parts.length === 0 && post.patches.count === 1 && post.patches.area === 1600,
    JSON.stringify(post.patches),
  );
  const quick = maps.reachOf(house({ floor: 32 }), { parts: false });
  sure(
    quick.share === null && quick.parts.length === 0 && quick.standable === null,
    "parts: false looks at none of it",
  );
});

test("a part behind a brush entity names it, the fewest in the way first, and so does an entity behind it", () => {
  const breakable = house({ entities: [inTheDoorway("func_breakable", { targetname: "seal" })] });
  const reach = maps.reachOf(breakable);
  const [study] = reach.parts;
  sure(
    study.how === "wall" && study.behind.join() === "3" &&
      /^behind 3 func_breakable "seal" at 336 128 64 \(what breaks or is switched off is a wall unless told: `walls: "gone"`, or `open` by name\)/.test(study.why), // prettier-ignore
    JSON.stringify(study),
  );
  const monster = monsterOf(reach);
  sure(
    monster.how === "none" && monster.behind.join() === "3" && /^no opening leads to it: behind 3 func_breakable "seal"/.test(monster.why), // prettier-ignore
    `the monster in the study: ${monster.why}`,
  );
  const closed = maps.reachOf(house({ entities: [inTheDoorway("func_door", { targetname: "gate" })] }), {
    doors: "closed",
  });
  sure(
    closed.parts[0].how === "wall" && /behind 3 func_door "gate" at 336 128 64 \(a door taken as closed\)/.test(closed.parts[0].why), // prettier-ignore
    closed.parts[0].why,
  );
  sure(
    /no opening leads to it \(with the doors that are taken as closed\): behind 3 func_door "gate"/.test(
      monsterOf(closed).why,
    ),
    `the old words stay, and the door is named after them: ${monsterOf(closed).why}`,
  );
  const wall = maps.reachOf(house({ entities: [inTheDoorway("func_wall")] }));
  sure(
    wall.parts[0].how === "wall" && /behind 3 func_wall at 336 128 64 \(a brush entity is a wall where it stands: `open` takes away those it names\)/.test(wall.parts[0].why), // prettier-ignore
    wall.parts[0].why,
  );
  // a second doorway with a func_wall in it, beside the breakable's: the way named is through the one that
  // gives way, though the other is as near
  const second = { min: [320, 24, STUDY_FLOOR], max: [352, 80, STUDY_FLOOR + DOOR.high] };
  const both = maps.reachOf(
    house({
      rooms: [second],
      entities: [
        inTheDoorway("func_breakable", { targetname: "seal" }),
        maps.brushEntity(
          "func_wall",
          maps.box([328, 24, STUDY_FLOOR], [344, 80, STUDY_FLOOR + DOOR.high], "WALL"),
        ),
      ],
    }),
  );
  sure(both.parts[0].behind.join() === "3", `the wall that gives way is named first: ${both.parts[0].why}`);
});

// ── 12: a profile's own lists ──
test("with a mod, the profile's exits, markers, wiring and off are used, and a list given adds to them", () => {
  const vault = { min: [0, 300, 0], max: [128, 428, 128] };
  const map = {
    worldspawn: {},
    brushes: maps.carve([HALL, vault], 16, WEARS),
    entities: [
      maps.playerStart(START_FLOOR, 0),
      maps.pointEntity("info_target", [64, 364, 8], { targetname: "chest_here" }), // a marker, sealed in
      maps.pointEntity("smak_text", [64, 380, 8]), // wiring, sealed in
      maps.pointEntity("smak_note", [64, 396, 8]), // wiring the caller names, sealed in
      maps.brushEntity("smak_exit", maps.box([280, 100, 0], [304, 140, 96], "AAATRIGGER")), // the way out
      maps.brushEntity("disabled_smak_exit", maps.box([200, 100, 0], [232, 140, 96], "WALL")), // switched off
    ],
  };
  const profile = {
    name: "smaktest",
    exits: ["smak_exit"],
    markers: ["chest_here"],
    wiring: ["smak_te*", "smak_note"],
    off: ["disabled_*"],
  };
  const lists = { exits: profile.exits, markers: profile.markers, wiring: profile.wiring, off: profile.off };
  const byProfile = maps.reachOf(map, { mod: profile });
  sure(
    plain(byProfile) === plain(maps.reachOf(map, lists)),
    "the profile's lists, or the same lists given: one walk",
  );
  sure(
    plain(byProfile) === plain(maps.reachOf(map, { mod: profile, ...lists })),
    "and given again, the same",
  );
  const told = (reach) =>
    reach.entities
      .map((entity) => entity.classname)
      .sort()
      .join();
  sure(
    told(byProfile) === "disabled_smak_exit,info_player_start,info_target,smak_exit",
    `the marker counted, the wiring left out, the way out and the one switched off looked for: ${told(byProfile)}`,
  );
  sure(
    byProfile.unreached.length === 1 && /no one-way place/.test(byProfile.facts.join()),
    byProfile.warnings.join(" | "),
  );
  sure(
    maps.spaceOf(map, { mod: profile }).areas.find((area) => area.classname === "disabled_smak_exit").off,
    "spaceOf takes the profile's off too",
  );
  // a list given adds to the profile's: never takes from it
  const fewer = { ...profile, wiring: ["smak_text"] };
  sure(
    told(maps.reachOf(map, { mod: fewer })).includes("smak_note"),
    "with a profile that wires less, the note counts",
  );
  sure(
    !told(maps.reachOf(map, { mod: fewer, wiring: ["smak_note"] })).includes("smak_note"),
    "and named as wiring, it is left out",
  );
  sure(
    !told(maps.reachOf(map, { mod: fewer, wiring: [] })).includes("smak_text"),
    "an empty list takes nothing away",
  );
  // the command line, with the profile in a file
  const mapFile = join(tmp, "profile-lists.map");
  const profileFile = join(tmp, "profile-lists.json");
  writeFileSync(mapFile, maps.writeMap(map));
  writeFileSync(profileFile, JSON.stringify(profile));
  const run = runRefused(SMAK_CLI, "map-reach", mapFile, "--mod", profileFile, "--json");
  const printed = JSON.parse(run.out);
  sure(
    printed.entities
      .map((entity) => entity.classname)
      .sort()
      .join() === "disabled_smak_exit,info_player_start,info_target,smak_exit",
    `map-reach --mod uses the profile's lists: ${run.out.slice(0, 300)} ${run.err}`,
  );
  const walls = runRefused(SMAK_CLI, "map-reach", mapFile, "--walls", "down");
  sure(
    walls.code === 1 && /--walls: standing or gone, not down/.test(walls.err),
    `--walls refuses: ${walls.err}`,
  );
});
