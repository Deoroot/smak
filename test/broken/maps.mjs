// Maps broken in one way each: a wall taken away (a leak), a light inside a wall, a texture no .wad has, no place
// to start, a brush with no volume; an entity of a class the mod has not, a target nothing answers to; a compiled
// map's texture of a size GoldSrc stops on, its world not first, a limit passed; a monster walled off from the
// start, one sunk in the floor, a team's spawn in a wall, a monster seen appearing, a prop in a wall, a dark room,
// a switch that fires nothing, waypoints with no start, a script nothing names and a line the game cuts.
// The maps are the kit's own: rooms carved here, and the two rooms of test/fixtures.
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSpr } from "../../src/sprite/spr.mjs";
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

// two rock pieces from a plaza turned 12 degrees (what carvePlan once made of the wall two turned rooms share):
// a quad with a face 0.07 wide, and a wedge a hundredth of a unit thick. Both are sound solids when worked out
// exactly, and sdHLCSG refuses both (csg12.out of that map).
const TURNED = {
  open: [
    "( 0 64 -16 ) ( 0 0 -16 ) ( 64 0 -16 ) T [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1",
    "( 64 0 0 ) ( 0 0 0 ) ( 0 64 0 ) T [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1",
    "( 2334 -2208 0 ) ( 2099 -2257 0 ) ( 2099 -2257 64 ) T [ 0.978945749 0.204120603 0 0 ] [ 0 0 -1 0 ] 0 1 1",
    "( 2185 64 0 ) ( 2185 0 0 ) ( 2185 0 64 ) T [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 1 1",
    "( 2182 -2224 64 ) ( 2182 -2224 0 ) ( 2185 -2239 0 ) T [ -0.196116135 0.980580676 0 0 ] [ 0 0 -1 0 ] 0 1 1",
    "( 2182 0 64 ) ( 2182 0 0 ) ( 2182 64 0 ) T [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 1 1",
  ],
  sliver: [
    "( 0 64 -16 ) ( 0 0 -16 ) ( 64 0 -16 ) T [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1",
    "( 64 0 0 ) ( 0 0 0 ) ( 0 64 0 ) T [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1",
    "( 2495 64 0 ) ( 2495 0 0 ) ( 2495 0 64 ) T [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 1 1",
    "( 1595 -2348 64 ) ( 1595 -2348 0 ) ( 3098 -2029 0 ) T [ 0.978210098 0.207617446 0 0 ] [ 0 0 -1 0 ] 0 1 1",
    "( 2495 -2157 0 ) ( 2432 -2170 0 ) ( 2432 -2170 64 ) T [ 0.979366639 0.202091529 0 0 ] [ 0 0 -1 0 ] 0 1 1",
  ],
};
/** A map of a lone brush written as .map faces, with the lines in `change` swapped (index: new line). */
const loneBrush = (lines, change = {}) => {
  const faces = lines.map((line, i) => change[i] ?? line);
  const map = maps.readMap(['{', '"classname" "worldspawn"', '"mapversion" "220"', '{', ...faces, '}', '}', ''].join(String.fromCharCode(10))); // prettier-ignore
  return { ...map, worldspawn: { ...map.worldspawn, wad: "smak.wad" }, entities: [maps.playerStart([64, 64, 0], 0), maps.light([128, 128, 96])] };
};
const loose = (map) => plan(map, { leak: false });

broken("checkPlan", "a brush CSG calls illegal: an edge with no opposite face", {
  said: /^1 brushes whose faces do not close: sdHLCSG refuses it \("Illegal Brush: edge without opposite face".*world brush 0 at 2182 -2239\.69 -16: face 0 has its edge/,
  broken: () => loose(loneBrush(TURNED.open)),
  // the same brush with its 0.07 face cut back to a face two units wide
  whole: () => loose(loneBrush(TURNED.open, { 3: "( 2185 64 0 ) ( 2185 0 0 ) ( 2185 0 64 ) T [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 1 1".replace(/2185/g, "2183") })),
});

broken("checkPlan", "a wedge a hundredth of a unit thick: CSG's corner is far outside the world", {
  said: /^1 brushes whose faces do not close: sdHLCSG refuses it .*world brush 0 at 2491\.95 -2157\.63 -16: is left with 0 faces/,
  broken: () => loose(loneBrush(TURNED.sliver)),
  // the second long wall turned to a slope the first can be told from
  whole: () => loose(loneBrush(TURNED.sliver, { 4: "( 2495 -2160 0 ) ( 2432 -2160 0 ) ( 2432 -2160 64 ) T [ 0.979366639 0.202091529 0 0 ] [ 0 0 -1 0 ] 0 1 1" })),
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

broken("checkPlan", "a brush 6000 units from the origin, past GoldSrc's range and inside Xash's", {
  said: /^1 brushes reach further than 4096 from the origin, where the engine cannot place anything: world brush 6/,
  broken: () => plan(room({ brushes: (walls) => [...walls, maps.box([5900, 64, 0], [6000, 96, 32], "SMAKWALL")] })),
  whole: () => plan(room({ brushes: (walls) => [...walls, maps.box([5900, 64, 0], [6000, 96, 32], "SMAKWALL")] }), { engine: "xash" }),
});

// ── budgetOf (the budget line of build-site) ──

const budgetOf = (options) => {
  const report = maps.budgetOf({ bsp: tworoomsBytes, ...options });
  return [...report.failures.map((f) => `FAIL ${f}`), ...report.warnings.map((w) => `WARN ${w}`)];
};
broken("budgetOf", "a map with more world leaves than its budget", {
  said: /^FAIL [0-9]+ leaves, over 1 \(the PHS would be/,
  broken: () => budgetOf({ limits: { leaves: 1 } }),
  whole: () => budgetOf({}),
});
broken("budgetOf", "a map with more static edicts than its budget", {
  said: /^FAIL [0-9]+ static edicts, over 1$/,
  broken: () => budgetOf({ limits: { staticEdicts: 1 } }),
  whole: () => budgetOf({}),
});
broken("budgetOf", "a map with more faces than its budget", {
  said: /^FAIL [0-9]+ faces, over 3$/,
  broken: () => budgetOf({ limits: { faces: 3 } }),
  whole: () => budgetOf({}),
});
broken("budgetOf", "a brush 9000 units from the origin, past what a Xash client holds", {
  said: /^FAIL a map reaches 9000 from the origin \(a brush at 9000 96 32\), past the 8000 a Xash client holds$/,
  broken: () => budgetOf({ map: room({ brushes: (walls) => [...walls, maps.box([8900, 64, 0], [9000, 96, 32], "SMAKWALL")] }) }),
  whole: () => budgetOf({ map: room() }),
});
broken("budgetOf", "a brush 5000 units from the origin: past GoldSrc's range, a warning for Xash", {
  said: /^WARN a map reaches 5000 from the origin \(a brush at 5000 96 32\), past ±4096/,
  broken: () => budgetOf({ map: room({ brushes: (walls) => [...walls, maps.box([4900, 64, 0], [5000, 96, 32], "SMAKWALL")] }) }),
  whole: () => budgetOf({ map: room() }),
});

// ── checkPvs: the faces drawn from where players stand ──

const FIXTURE_FILES = join(HERE, "fixtures");
const pvs = (name, options) => {
  const report = maps.checkPvs(readFileSync(join(FIXTURE_FILES, name)), options);
  return report.errors;
};
broken("checkPvs", "a map compiled without vis: the engine draws every face from everywhere", {
  said: /^the map was compiled without vis \(hlvis was not run\): the engine draws all of its 43 faces from everywhere \(the budget is 25000 a spot\); compile it with hlvis$/,
  broken: () => pvs("tworooms-novis.bsp"),
  whole: () => pvs("tworooms.bsp"),
});

broken("checkPvs", "a map that draws more faces than the budget from its places to stand", {
  said: /^the p90 spot draws 43 faces, 760% over the budget of 5 \(median 43, max 43; worst at 256 128 0\)$/,
  others: true,
  broken: () => pvs("tworooms.bsp", { budget: { median: 5, p90: 5 } }),
  whole: () => pvs("tworooms.bsp"),
});

// ── checkBsp: a glow sprite whose border is not black draws a faint square ──

const glowFolder = (() => {
  const folder = mkdtempSync(join(tmpdir(), "smak-glow-"));
  mkdirSync(join(folder, "sprites"));
  // two 32 x 32 additive sprites of a white radial glow; the second also has 3 of 255 in every corner
  for (const [name, floor] of [["clean", 0], ["lifted", 3]]) {
    const pixels = new Uint8Array(32 * 32);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const r = Math.hypot(x + 0.5 - 16, y + 0.5 - 16) / 12;
        pixels[y * 32 + x] = r >= 1 ? (Math.hypot(x + 0.5 - 16, y + 0.5 - 16) > 16 ? floor : 0) : Math.round(255 * (1 - r) ** 2);
      }
    const palette = new Uint8Array(768);
    for (let i = 0; i < 256; i++) palette.set([i, i, i], i * 3);
    writeFileSync(join(folder, "sprites", `${name}.spr`), writeSpr({ palette, frames: [{ left: -16, up: 16, width: 32, height: 32, pixels }] }));
  }
  return folder;
})();
const glowSaid = (sprite) =>
  bspSaid(
    maps.withEntities(tworoomsBytes, [
      ...tworooms.entities,
      [["classname", "env_glow"], ["origin", "64 64 64"], ["model", `sprites/${sprite}.spr`], ["rendermode", "5"], ["renderamt", "200"]],
    ]),
    { folders: [glowFolder] },
  ).filter((line) => /sprites/.test(line));

broken("checkBsp", "a glow sprite whose corners are not black", {
  said: /^1 glow sprites draw a faint square around the glow, worse in the dark and under Xash's gamma, because their border is not black: sprites\/lifted\.spr \(1 entities\): \d+ of \d+ pixels outside its inscribed circle are not black, up to 3 of 255$/,
  broken: () => glowSaid("lifted"),
  whole: () => glowSaid("clean"),
});

// ── coplanarFaults: a brush entity's face on a face of the world, or of another entity, looking the same way ──

const fights = (entities) => maps.coplanarFaults(room({ entities })).fights;
broken("coplanarFaults", "a func_wall panel set into the east wall, its face flush with the wall's own", {
  said: /^brush 0 of entity 3 \(func_wall\) at 256 64 32: its face on x = 256 looking -x lies on world brush 3's, looking the same way, over 4096 square units$/,
  broken: () => fights([maps.brushEntity("func_wall", [maps.box([256, 64, 32], [264, 128, 96], "SMAKWALL")])]),
  // the same panel standing 1 unit out of the wall
  whole: () => fights([maps.brushEntity("func_wall", [maps.box([255, 64, 32], [264, 128, 96], "SMAKWALL")])]),
});

broken("coplanarFaults", "a func_illusionary whose top lies on a func_wall's top", {
  said: /^brush 0 of entity 4 \(func_illusionary "glass"\) at 80 72 16: its face on z = 32 looking \+z lies on brush 0 of entity 3 \(func_wall\)'s, looking the same way, over 384 square units$/,
  broken: () => fights([maps.brushEntity("func_wall", [maps.box([64, 64, 0], [96, 96, 32], "SMAKWALL")]), maps.brushEntity("func_illusionary", [maps.box([80, 72, 16], [112, 104, 32], "SMAKWALL")], { targetname: "glass" })]), // prettier-ignore
  whole: () => fights([maps.brushEntity("func_wall", [maps.box([64, 64, 0], [96, 96, 32], "SMAKWALL")]), maps.brushEntity("func_illusionary", [maps.box([80, 72, 16], [112, 104, 33], "SMAKWALL")], { targetname: "glass" })]), // prettier-ignore
});

broken("checkPlan", "a func_wall panel flush with the east wall: z-fighting", {
  said: /^1 faces of brush entities lie on a face of the world, or of another brush entity, looking the same way: sdHLCSG keeps both and the engine draws both on one plane, so they flicker \(z-fighting; a func_wall set flush into a wall or a floor\)\. Move the brush 1 unit or more off it, or make it world: brush 0 of entity 3 \(func_wall\) at 256 64 32/,
  broken: () => plan(room({ entities: [maps.brushEntity("func_wall", [maps.box([256, 64, 32], [264, 128, 96], "SMAKWALL")])] }), { leak: false }),
  whole: () => plan(room({ entities: [maps.brushEntity("func_wall", [maps.box([255, 64, 32], [264, 128, 96], "SMAKWALL")])] }), { leak: false }),
});

// ── skyGaps: the sky seen through a slit in a roof, from under it ──

// the kit's three roofed rooms (test/fixture-skygap.mjs): A's roof has a slit 2 wide over the spawn, B a window 64 wide
// onto a yard under the sky, C nothing of the sky in sight
const skygap = maps.readBsp(readFileSync(join(FIXTURES, "skygap.bsp")));
broken("skyGaps", "a slit 2 units wide in the roof over the eye", {
  said: /^sky seen from 244 128 64 looking yaw \d+ pitch [4-8]\d: a gap 2(\.\d)? units wide at 25[456] \d+ 1(29|3[0-2]) \(\d+ rays from 1 eyes reach the sky through it\); close it, or it is meant to be a window: ignore it$/,
  others: true, // a slit 256 long is told at more than one place along it
  broken: () => maps.skyGaps(skygap, { eyes: [[244, 128, 64]] }).warnings,
  // the eye in room B sees the sky, through its window of 64, which is no gap
  whole: () => maps.skyGaps(skygap, { eyes: [[416, 128, 64]] }).warnings,
});

// ── form: a map whose furniture is all bare boxes ──
const detailOf = (list) => ({ brushes: [], entities: [{ classname: "func_detail", brushes: list }] });
const spaced = (bevel) => [0, 1, 2, 3, 4].map((i) => maps.box([i * 40, 0, 0], [i * 40 + 30, 20, 16], "SMAKWALL", bevel ? { bevel } : undefined));

broken("judgeSourceForm", "five detail brushes, every one a bare box on the axes", {
  said: /^form: of the detail and entity brushes \(the source's\) are bare six-sided boxes on the axes: 100% \(Valve's: 0% to 81%, median 53%; 5 brushes\); no bare box for anything a player looks at: chamfer it/,
  others: true,
  broken: () => maps.judgeSourceForm(detailOf(spaced(0))),
  whole: () => maps.judgeSourceForm(detailOf(spaced(3))),
});

broken("judgeSourceForm", "a world of axis-aligned boxes alone: none of its face area off the axes", {
  said: /^form: of the world's face area off the axes: 0% \(Valve's: 7% to 60%, median 22%\); break the boxes: cut corners, angled panels, slopes, pillars \(a map spec's `frame`/,
  others: true,
  broken: () => maps.judgeSourceForm({ brushes: [[maps.box([0, 0, 0], [256, 256, 16], "SMAKFLOOR"), maps.box([0, 0, 16], [16, 256, 128], "SMAKWALL"), maps.box([240, 0, 16], [256, 256, 128], "SMAKWALL")]], entities: [] }),
  whole: () => maps.judgeSourceForm({ brushes: [[maps.box([0, 0, 0], [256, 256, 16], "SMAKFLOOR"), maps.wedge([0, 0, 16], [256, 256, 128], "+x", "SMAKWALL")]], entities: [] }),
});
