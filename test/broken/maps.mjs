// Maps broken in one way each: a wall taken away (a leak), a light inside a wall, a texture no .wad has, no place
// to start, a brush with no volume; an entity of a class the mod has not, a target nothing answers to; a compiled
// map's texture of a size GoldSrc stops on, its world not first, a limit passed; a monster walled off from the
// start, one sunk in the floor, a team's spawn in a wall, a monster seen appearing, a prop in a wall, a dark room,
// a switch that fires nothing, waypoints with no start, a script nothing names and a line the game cuts.
// The maps are the kit's own: rooms carved here, and the two rooms of test/fixtures.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../../src/maps/index.mjs";
import { scriptLint } from "../../profiles/mastersword.mjs";
import { HERE } from "../helper.mjs";
import { broken } from "./case.mjs";

const FIXTURES = join(HERE, "fixtures");
const FGD = join(FIXTURES, "smakgame.fgd");
const tworoomsBytes = readFileSync(join(FIXTURES, "tworooms.bsp"));
const tworooms = maps.readBsp(tworoomsBytes);

// ── a sealed room: six walls, a start and a light ──
const TEXTURES = { floor: "SMAKFLOOR", ceiling: "SMAKCEIL", wall: "SMAKWALL" };
const EAST_WALL = 3;
const room = ({ brushes = (walls) => walls, entities = [] } = {}) => ({
  worldspawn: { wad: "smak.wad" },
  brushes: brushes(maps.hollow([0, 0, 0], [256, 256, 128], 16, TEXTURES)),
  entities: [maps.playerStart([64, 64, 0], 0), maps.light([128, 128, 96]), ...entities],
});
/** What the plan check says at the levels that stop or warn. */
const plan = (map, options) => {
  const report = maps.checkPlan(map, options);
  return [...report.errors, ...report.warnings];
};

// ── checkPlan and leakHint ──

broken("checkPlan", "a room with its east wall taken away: a way out to the void", {
  said: /^the map looks OPEN to the void: from the light at 128 128 96 there is a way out that leaves the world near 26\d/,
  broken: () => plan(room({ brushes: (walls) => walls.filter((_, i) => i !== EAST_WALL) })),
  whole: () => plan(room()),
});

broken("checkPlan", "a light inside a wall", {
  said: /^1 entities are inside a world brush: entity 3 \(light\) at 264 100 50 is inside world brush 3$/,
  broken: () => plan(room({ entities: [maps.light([264, 100, 50])] })),
  whole: () => plan(room({ entities: [maps.light([200, 100, 50])] })),
});

broken("checkPlan", "a texture in none of the .wad files given", {
  said: /^1 textures are in none of the \.wad files given: NOWHERE \(6 faces\)/,
  broken: () => plan(room({ brushes: (walls) => [...walls, maps.box([64, 64, 0], [96, 96, 32], "NOWHERE")] }), { textures: Object.values(TEXTURES) }), // prettier-ignore
  whole: () => plan(room({ brushes: (walls) => [...walls, maps.box([64, 64, 0], [96, 96, 32], "SMAKWALL")] }), { textures: Object.values(TEXTURES) }), // prettier-ignore
});

broken("checkPlan", "no place to start", {
  said: /no info_player_start/,
  broken: () => plan({ ...room(), entities: [maps.light([128, 128, 96])] }, { leak: false }),
  whole: () => plan(room(), { leak: false }),
});

broken("checkPlan", "a brush with every face turned inwards: no volume", {
  said: /^1 brushes that are no sound convex solid: world brush 6: it has no volume/,
  broken: () => {
    const inwards = maps.box([64, 64, 0], [96, 96, 32], "SMAKWALL");
    for (const face of inwards.faces) face.points.reverse();
    return plan(room({ brushes: (walls) => [...walls, inwards] }));
  },
  whole: () => plan(room({ brushes: (walls) => [...walls, maps.box([64, 64, 0], [96, 96, 32], "SMAKWALL")] })),
});

/** What the leak hint finds, as a sentence; none when the flood stays in. */
const leakOf = (map) => {
  const { leak } = maps.leakHint(map);
  return leak ? [`a way out from the ${leak.entity.classname} near ${leak.at.map(Math.round).join(" ")}`] : [];
};
broken("leakHint", "a room with its east wall taken away", {
  said: /^a way out from the light near 2(4\d|5\d|6\d|7[0-2]) /,
  broken: () => leakOf(room({ brushes: (walls) => walls.filter((_, i) => i !== EAST_WALL) })),
  whole: () => leakOf(room()),
});

// ── checkEntities: a map's entities against a mod ──

// the house of the mods' cases: a hall and a study through a doorway
const house = (entities = []) => ({
  worldspawn: {},
  brushes: maps.carve([{ min: [0, 0, 0], max: [320, 256, 160] }, { min: [352, 0, 16], max: [608, 256, 144] }, { min: [320, 96, 16], max: [352, 160, 112] }], 16, { floor: "FLOOR", ceiling: "CEILING", wall: "WALL" }), // prettier-ignore
  entities: [maps.playerStart([96, 128, 0], 0), maps.light([160, 128, 140]), ...entities],
});
const entitiesSaid = (entities, level) => maps.checkEntities(house(entities), { definitions: FGD })[level];

broken("checkEntities", "an entity of a class the mod has not", {
  said: /^1 classes are in none of the definitions given \(smakbase\.fgd, smakgame\.fgd\): a class the game does not have is dropped without a word: smak_beast_tier1 \(entity 3\)$/,
  broken: () => entitiesSaid([maps.pointEntity("smak_beast_tier1", [480, 128, 16])], "errors"),
  whole: () => entitiesSaid([maps.pointEntity("smak_beast", [480, 128, 16])], "errors"),
});

broken("checkEntities", "a target that names no entity", {
  said: /^1 entities name something no entity of the map is called \(a targetname\): firing it does nothing: entity 3 \(smak_beast\) target nobody$/,
  broken: () => entitiesSaid([maps.pointEntity("smak_beast", [480, 128, 16], { target: "nobody" })], "warnings"),
  whole: () => entitiesSaid([maps.pointEntity("smak_beast", [480, 128, 16], { target: "bell" }), maps.pointEntity("multi_manager", [100, 40, 40], { targetname: "bell" })], "warnings"), // prettier-ignore
});

// ── checkBsp: a compiled map ──

const bspSaid = (bytes, options) => {
  const report = maps.checkBsp(bytes, options);
  return [...report.errors, ...report.warnings];
};

broken("checkBsp", "a texture 40 wide, not a multiple of 16", {
  // said twice, by the size check and by the reader of the texture's pixels: one fault, the same words
  said: /^the texture smakfloor is 40x32: /,
  broken: () => {
    const copy = Buffer.from(tworoomsBytes);
    const floor = tworooms.textures.find((texture) => texture.name === "smakfloor");
    copy.writeUInt32LE(40, floor.at + 16); // miptex_t: its name (16 bytes), then its width
    return bspSaid(copy);
  },
  whole: () => bspSaid(tworoomsBytes),
});

broken("checkBsp", "its first entity not the worldspawn", {
  said: /^the map's first entity is not the worldspawn: the engine takes the first to be the world$/,
  broken: () => {
    const [world, start, ...rest] = tworooms.entities;
    return bspSaid(maps.withEntities(tworoomsBytes, [start, world, ...rest]));
  },
  whole: () => bspSaid(maps.withEntities(tworoomsBytes, tworooms.entities)),
});

broken("checkBsp", "more faces than the engine holds (its limit lowered for the case)", {
  said: /^43 faces: goldsrc holds 40$/,
  broken: () => {
    const held = maps.MAP_LIMITS.goldsrc.faces;
    try {
      maps.MAP_LIMITS.goldsrc.faces = 40;
      return bspSaid(tworoomsBytes);
    } finally {
      maps.MAP_LIMITS.goldsrc.faces = held;
    }
  },
  whole: () => bspSaid(tworoomsBytes),
});

// ── reachOf: the walk test ──

// the walk test's house: a monster in the study, a step up from the hall, through a doorway (or none)
const MONSTER = "monster_zombie";
const walkHouse = ({ door = true, monsterAt = 16 } = {}) => {
  const rooms = [{ min: [0, 0, 0], max: [320, 256, 160] }, { min: [352, 0, 16], max: [608, 256, 144] }];
  if (door) rooms.push({ min: [320, 96, 16], max: [352, 160, 112] });
  return {
    worldspawn: {},
    brushes: maps.carve(rooms, 16, { floor: "FLOOR", ceiling: "CEILING", wall: "WALL" }),
    entities: [maps.playerStart([96, 128, 0], 0), maps.pointEntity(MONSTER, [480, 128, monsterAt]), maps.light([160, 128, 140])],
  };
};

broken("reachOf", "a monster in a room with no way into it", {
  said: /^1 of the 2 entities a player goes to are not reached on foot from the places to start: 2 monster_zombie at 480 128 16: no opening leads to it$/,
  broken: () => maps.reachOf(walkHouse({ door: false })).warnings,
  whole: () => maps.reachOf(walkHouse()).warnings,
});

broken("reachOf", "a monster sunk 20 units into the floor", {
  said: /^1 entities stand in something solid: .*monster_zombie.* at 480 128 -4 \(its feet are 20 under the floor at z 16/,
  // the monster sunk is also not reached: being in the floor is what keeps it from the walk
  others: true,
  broken: () => maps.reachOf(walkHouse({ monsterAt: -4 })).warnings,
  whole: () => maps.reachOf(walkHouse()).warnings,
});

// ── doorClearance: room before a door ──

// two rooms through a doorway in the wall at x 320 to 352, a door's leaf in it; a crate on the floor before it (or none)
const doorHouse = (crate) => ({
  worldspawn: {},
  brushes: [
    ...maps.carve([{ min: [0, 0, 0], max: [320, 256, 128] }, { min: [352, 0, 0], max: [672, 256, 128] }, { min: [320, 96, 0], max: [352, 160, 112] }], 16, { floor: "FLOOR", ceiling: "CEILING", wall: "WALL" }), // prettier-ignore
    ...(crate ? [maps.box(crate, [crate[0] + 40, crate[1] + 64, 40], "CRATE")] : []),
  ],
  entities: [maps.playerStart([96, 128, 0], 0), maps.light([160, 128, 112]), maps.brushEntity("func_door_rotating", [maps.box([332, 96, 0], [340, 160, 112], "DOOR")], { targetname: "study" })], // prettier-ignore
});
broken("doorClearance", "a crate on the floor just before the door, on its east side", {
  said: /^1 of 1 doors have no room for a standing player \(32 x 32 x 72\) before them on a side: \d+ func_door_rotating "study" at 336 128 0, its east side/,
  broken: () => maps.doorClearance(doorHouse([360, 96, 0])).warnings,
  whole: () => maps.doorClearance(doorHouse([560, 96, 0])).warnings,
});
broken("doorClearance", "a prop with no clip before the door, on its west side", {
  said: /^1 of 1 doors have no room .* its west \(7 models\/bench\.mdl there\) side/,
  broken: () => maps.doorClearance(doorHouse(null), { props: [{ number: 7, file: "models/bench.mdl", min: [270, 100, 0], max: [318, 156, 30] }] }).warnings, // prettier-ignore
  whole: () => maps.doorClearance(doorHouse(null), { props: [{ number: 7, file: "models/bench.mdl", min: [100, 10, 0], max: [148, 66, 30] }] }).warnings, // prettier-ignore
});

// ── teamsOf: a team plugin's split of a map ──

const spawn = (x, y) => maps.playerStart([x, y, 0], 0, "info_player_deathmatch");
const arena = (more = []) => ({
  worldspawn: {},
  brushes: maps.carve([{ min: [0, 0, 0], max: [1000, 512, 256] }, { min: [1400, 0, 0], max: [2400, 512, 256] }, { min: [900, 512, 0], max: [1500, 700, 128] }], 16, { floor: "FLOOR", ceiling: "CEILING", wall: "WALL" }), // prettier-ignore
  entities: [spawn(64, 128), spawn(64, 256), spawn(64, 384), spawn(2336, 128), spawn(2336, 256), spawn(2336, 384), ...more],
});
broken("teamsOf", "a spawn in the east wall", {
  said: /^1 of team 2 \(blue\)'s spawns put a player in something solid: entity 7/,
  broken: () => maps.teamsOf(arena([maps.pointEntity("info_player_deathmatch", [2410, 256, 36])]), { teams: { names: ["red", "blue"] }, walk: false }).faults, // prettier-ignore
  whole: () => maps.teamsOf(arena([maps.pointEntity("info_player_deathmatch", [2300, 256, 36])]), { teams: { names: ["red", "blue"] }, walk: false }).faults, // prettier-ignore
});

// ── spawnsOf: how a mod's monsters come ──

const SPAWNS = { areas: ["smak_den"], templates: ["smak_beast"], area: "den", waits: { key: "wakes", value: "1" }, script: (keys) => keys.kind ?? null, scriptKey: "kind", touches: ["trigger_once"] }; // prettier-ignore
const denMod = { name: "smakgame", spawns: SPAWNS };
/** A long hall with a wall across it at x 1180; a trigger near the start wakes a den at `x`, with a beast. */
const denHall = (x) => ({
  worldspawn: {},
  brushes: [...maps.carve([{ min: [0, 0, 0], max: [1600, 320, 160] }], 16, { floor: "FLOOR", ceiling: "CEILING", wall: "WALL" }), maps.box([1180, 0, 0], [1200, 320, 160], "WALL")], // prettier-ignore
  entities: [
    maps.playerStart([96, 160, 0], 0),
    maps.light([400, 160, 140]),
    maps.brushEntity("trigger_once", [maps.box([160, 64, 0], [224, 256, 128], "AAATRIGGER")], { target: "lair" }),
    maps.pointEntity("smak_den", [x, 160, 80], { targetname: "lair", wakes: 1 }),
    maps.pointEntity("smak_beast", [x, 160, 16], { den: "lair", kind: "beasts/boar" }),
  ],
});
broken("spawnsOf", "a beast that appears in sight of the trigger that wakes it", {
  said: /^1 monsters of 1 spawn areas can be seen appearing/,
  broken: () => maps.spawnsOf(denHall(800), { mod: denMod }).warnings,
  whole: () => maps.spawnsOf(denHall(1400), { mod: denMod }).warnings,
});

// ── propsOf: what has a model or a body against the world ──

const propRoom = (at) => ({
  worldspawn: {},
  brushes: [...maps.hollow([0, 0, 0], [512, 512, 256], 16, "W"), maps.box([200, 0, 0], [232, 512, 128], "W")],
  entities: [maps.playerStart([100, 100, 0]), maps.pointEntity("monster_stuck", at, {})],
});
const propWarnings = (map) => maps.propsOf(map, { models: false }).props.flatMap((prop) => prop.warnings.map((w) => `${prop.classname}: ${w}`)); // prettier-ignore
broken("propsOf", "a monster half in a wall", {
  said: /^monster_stuck: \d+% of its box is in solid: it is stuck in a wall or the floor$/,
  broken: () => propWarnings(propRoom([200, 300, 36])),
  whole: () => propWarnings(propRoom([300, 300, 36])),
});

// ── lightReport: the light on a map's floors ──

// the fixture's room behind the grate has no lamp
const ROOMS = { first: { min: [0, 0, 0], max: [320, 208, 128] }, behind: { min: [0, 240, 0], max: [128, 448, 128] } };
broken("lightReport", "a room with no lamp", {
  said: /^1 rooms are dark on the floor \(a mean under 24 of 255\): behind /,
  broken: () => maps.lightReport(tworooms, { rooms: ROOMS }).warnings,
  whole: () => maps.lightReport(tworooms, { rooms: { first: ROOMS.first } }).warnings,
});

// ── wiringOf: what a map's switches work ──

const button = (target) => maps.brushEntity("func_button", [maps.box([16, 96, 32], [24, 128, 64], "BUTTON")], { target }); // prettier-ignore
broken("wiringOf", "a button that fires a name nothing answers to", {
  said: /^1 switches and triggers fire a name nothing answers to: func_button 3 at .*"lamp"$/,
  broken: () => maps.wiringOf(house([button("lamp")])).warnings,
  whole: () => maps.wiringOf(house([button("lamp"), maps.pointEntity("light", [160, 64, 140], { targetname: "lamp" })])).warnings, // prettier-ignore
});

// ── waypointsOf: a bot's waypoints from the walk ──

broken("waypointsOf", "a map with no place to start", {
  said: /^no floor is walked \(no place to start, or none with room\): no waypoints$/,
  broken: () => maps.waypointsOf({ ...house(), entities: [maps.light([160, 128, 140])] }).warnings,
});

// ── scriptsPlaced and a mod's lint: scripts of one's own against the game's ──

const SHIPPED = new Map([["beasts/wolf", "setmodel wolf.mdl\n"]]);
const oursOf = (list) => new Map(Object.entries(list).map(([name, text]) => [name, { text, file: `ours/${name}.script` }])); // prettier-ignore
broken("scriptsPlaced", "a new script nothing names", {
  said: /^1 scripts are new \(the game ships none of that name\) and nothing names them: .*beasts\/lost \(ours\/beasts\/lost\.script\)/,
  broken: () => maps.scriptsPlaced({ ours: oursOf({ "beasts/wolf": "// ours\n", "beasts/lost": "// a wolf of ours\n" }), shipped: SHIPPED, rules: {} }).warnings, // prettier-ignore
  whole: () => maps.scriptsPlaced({ ours: oursOf({ "beasts/wolf": "use beasts/lost\n", "beasts/lost": "// a wolf of ours\n" }), shipped: SHIPPED, rules: {} }).warnings, // prettier-ignore
});

broken("scriptLint", "an item's desc longer than the 72 letters the game keeps", {
  said: /^line 2: its desc is 80 characters, and the game keeps 72 of it/,
  broken: () => scriptLint(`{\n\tdesc\t\t${"x".repeat(80)}\n}`),
  whole: () => scriptLint(`{\n\tdesc\t\t${"x".repeat(72)}\n}`),
});

// ── checkPvs: the faces drawn from where players stand ──

const FIXTURE_FILES = join(HERE, "fixtures");
const pvs = (name, options) => {
  const report = maps.checkPvs(readFileSync(join(FIXTURE_FILES, name)), options);
  return report.errors;
};
broken("checkPvs", "a map compiled without vis: the engine draws every face from everywhere", {
  said: /^the map was compiled without vis \(hlvis was not run\): the engine draws all of its 43 faces from everywhere \(the budget is 12000 a spot\); compile it with hlvis$/,
  broken: () => pvs("tworooms-novis.bsp"),
  whole: () => pvs("tworooms.bsp"),
});

broken("checkPvs", "a map that draws more faces than the budget from its places to stand", {
  said: /^the p90 spot draws 43 faces, 760% over the budget of 5 \(median 43, max 43; worst at 256 128 0\)$/,
  others: true,
  broken: () => pvs("tworooms.bsp", { budget: { median: 5, p90: 5 } }),
  whole: () => pvs("tworooms.bsp"),
});
