// What a role-play city asked of the kit: switched lights counted as the map starts, rooms carved each in
// textures of its own, a map's wiring (its properties, switches, lifts, alarms, places that heal), a texture
// looked for by name in several maps, the views' rooms chosen where something is, a line of sight found in
// one walk, folders to map-character, and a second mod's profile (The Specialists') with figures to hold a
// map against. A made-up block of the kit's own.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as maps from "../check/maps/index.mjs";
import specialists, { ARENAS, CITIES } from "../profiles/specialists.mjs";
import { test, sure, near, tmp, runSmak, runRefused, SMAK_CLI, HERE } from "./helper.mjs";

const FIXTURES = join(HERE, "fixtures");
const folder = join(tmp, "map-roleplay");
mkdirSync(folder, { recursive: true });

// ── switched lights ─────────────────────────────────────────────────────────
const light = (keys) => Object.entries({ classname: "light", ...keys });
test("a switched light is on as the map starts unless made to start dark, as CLight::Spawn has it", () => {
  const bsp = {
    entities: [
      [["classname", "worldspawn"]],
      light({ style: "32", targetname: "flat1" }),
      light({ style: "33", targetname: "flat2", spawnflags: "1" }),
      // two lights of one style: dark only when both start dark
      light({ style: "34", targetname: "hall", spawnflags: "1" }),
      light({ style: "34", targetname: "hall" }),
      light({ style: "35", targetname: "cellar", spawnflags: "3" }),
      light({ style: "2" }),
      [["classname", "info_target"], ["style", "40"]],
    ],
  };
  const start = maps.stylesAtStart(bsp);
  sure(JSON.stringify(start.switched) === "[32,33,34,35]", `the switched styles: ${start.switched}`);
  sure(JSON.stringify(start.dark) === "[33,35]", `those that start dark: ${start.dark}`);
  sure(start.on(32) && !start.on(33) && start.on(34) && start.on(40), "on, off, one of two on, a style no light owns");
  const counted = maps.stylesCounted(bsp);
  sure(counted(0) && counted(2) && counted(32) && !counted(33), "as the map starts: the flickers and the switched on");
  sure(!maps.stylesCounted(bsp, "off")(32) && maps.stylesCounted(bsp, "off")(31), "off: every switched light off");
  sure(maps.stylesCounted(bsp, "on")(33), "on: every switched light on");
  let refused = "";
  try {
    maps.stylesCounted(bsp, "dim");
  } catch (error) {
    refused = error.message;
  }
  sure(/switched: start, off, on, not "dim"/.test(refused), refused);
});

const compilers = process.env[maps.COMPILERS_VARIABLE] ? maps.findCompilers() : { found: false };
const testCompiled = (name, run) => {
  if (compilers.found) test(name, run);
  else console.log(`skip  ${name}\n      skipped: no compilers (name the folder of VHLT in ${maps.COMPILERS_VARIABLE} to run it)`); // prettier-ignore
};
testCompiled("compiled: a flat whose lamp has a switch is lit as the map starts; one made to start dark is dark", () => {
  const wad = join(FIXTURES, "tworooms.wad");
  const WEARS = { floor: "smakfloor", ceiling: "smakwall", wall: "smakwall" };
  const map = {
    worldspawn: { wad: [wad] },
    brushes: maps.carve([{ min: [0, 0, 0], max: [256, 256, 128] }, { min: [288, 0, 0], max: [544, 256, 128] }], 16, WEARS), // prettier-ignore
    entities: [
      maps.playerStart([128, 128, 0], 0),
      maps.light([128, 128, 112], { brightness: 300, targetname: "flat1" }),
      maps.light([416, 128, 112], { brightness: 300, targetname: "flat2", spawnflags: 1 }),
    ],
  };
  const mapFile = join(folder, "flats.map");
  writeFileSync(mapFile, maps.writeMap(map));
  const result = maps.compileMap(mapFile, { wads: [wad], fast: true });
  sure(result.bsp, `compiled: ${result.errors}`);
  const bsp = maps.readBsp(readFileSync(result.bsp));
  const rooms = { flat1: { min: [0, 0, 0], max: [256, 256, 128] }, flat2: { min: [288, 0, 0], max: [544, 256, 128] } };
  const mean = (switched) => Object.fromEntries(maps.lightReport(bsp, { rooms, switched }).rooms.map((room) => [room.name, room.mean])); // prettier-ignore
  const start = mean("start");
  const off = mean("off");
  const on = mean("on");
  sure(start.flat1 > 24 && start.flat2 < 24, `as the map starts: flat1 ${start.flat1}, flat2 ${start.flat2}`);
  sure(off.flat1 < 24 && off.flat2 < 24, `all off: ${off.flat1}, ${off.flat2}`);
  sure(on.flat1 > 24 && on.flat2 > 24, `all on: ${on.flat1}, ${on.flat2}`);
  const said = maps.lightReport(bsp).facts.join(" ");
  sure(/2 switched light styles, counted as the map starts: 1 on, 1 made to start dark/.test(said), said);
  const command = runSmak("map-light", result.bsp, "--switched", "off");
  sure(/2 switched light styles, all counted off/.test(command), command);
  const wrong = runRefused(SMAK_CLI, "map-light", result.bsp, "--switched", "dim");
  sure(wrong.code === 1 && /--switched start or off or on, not dim/.test(wrong.err), wrong.err);
});

// ── carve, each room in its own textures ────────────────────────────────────
test("carve: a room's own textures are worn by the rock it is seen from, and a slab under two rooms is cut", () => {
  const STREET = { min: [0, 0, 0], max: [512, 256, 256], texture: { floor: "ASPHALT", ceiling: "sky", wall: "BRICK" } };
  // two shops side by side behind the street's north wall, each with a floor of its own
  const SHOP = { min: [0, 272, 0], max: [248, 528, 128], texture: { floor: "TILE", ceiling: "CEIL", wall: "WHITE" } };
  const BAR = { min: [264, 272, 0], max: [512, 528, 128], texture: { floor: "PLANKS", ceiling: "CEIL", wall: "PANEL" } };
  const DOOR = { min: [96, 256, 0], max: [160, 272, 112] }; // the carve's own textures
  const brushes = maps.carve([STREET, SHOP, BAR, DOOR], 16, "ROCK");
  /** The texture of the face whose middle is nearest a point and looks one way. */
  const faceAt = (point, normal) => {
    for (const brush of brushes) {
      const shape = maps.shapeOf(brush);
      for (const face of shape.faces ?? []) {
        if (face.normal.some((value, axis) => Math.abs(value - normal[axis]) > 1e-6)) continue;
        const inside = point.every((value, axis) => value >= shape.min[axis] - 0.5 && value <= shape.max[axis] + 0.5);
        if (inside && Math.abs(face.normal.reduce((sum, value, axis) => sum + value * point[axis], 0) - face.dist) < 0.5) return face.texture; // prettier-ignore
      }
    }
    return null;
  };
  const looks = { up: [0, 0, 1], down: [0, 0, -1], south: [0, -1, 0], north: [0, 1, 0] };
  const sure1 = (point, normal, want, what) => {
    const got = faceAt(point, normal);
    sure(got?.toUpperCase() === want, `${what}: ${got}, not ${want}`);
  };
  sure1([256, 128, 0], looks.up, "ASPHALT", "the street's floor");
  sure1([400, 256, 200], looks.south, "BRICK", "the street's north wall, above the bar");
  sure1([200, 272, 64], looks.north, "WHITE", "the shop's south wall, behind the brick");
  sure1([400, 272, 64], looks.north, "PANEL", "the bar's south wall");
  sure1([100, 400, 0], looks.up, "TILE", "the shop's floor");
  sure1([400, 400, 0], looks.up, "PLANKS", "the bar's floor, on the same slab: it was cut");
  sure1([256, 128, 256], looks.down, "SKY", "the street's sky");
  sure1([128, 264, 0], looks.up, "ROCK", "the doorway's floor: the carve's own");
  // with no room's own the rock is as it always was
  const plain = maps.carve([STREET, DOOR].map(({ min, max }) => ({ min, max })), 16, "ROCK");
  sure(plain.length === maps.carve([{ min: STREET.min, max: STREET.max }, DOOR], 16, "ROCK").length, "unchanged without textures of rooms"); // prettier-ignore
  const plan = maps.checkPlan({ worldspawn: {}, brushes, entities: [maps.playerStart([256, 128, 0], 90)] });
  sure(!plan.errors.length && !/OPEN to the void/.test(plan.warnings.join(" ")), `still sealed: ${plan.errors} ${plan.warnings}`); // prettier-ignore
});

// ── a texture looked for by name ────────────────────────────────────────────
test("embeddedTexture: a name the map lacks is null, so that it is looked for in several maps; a number is refused", () => {
  const bsp = maps.readBsp(readFileSync(join(FIXTURES, "tworooms.bsp")));
  sure(maps.embeddedTexture(bsp, "no_such_texture") === null, "a name it lacks");
  let refused = "";
  try {
    maps.embeddedTexture(bsp, 999);
  } catch (error) {
    refused = error.message;
  }
  sure(/no texture 999 in this map/.test(refused), refused);
});

// ── the wiring ──────────────────────────────────────────────────────────────
const box = (min, max) => [maps.box(min, max, "WALL")];
const P = maps.pointEntity;
const B = maps.brushEntity;
const BLOCK = {
  worldspawn: {},
  brushes: maps.carve([{ min: [0, 0, 0], max: [1024, 1024, 256] }], 16, "WALL"),
  entities: [
    maps.playerStart([64, 64, 0], 0),
    // properties: two flats of one family, a shop with two doors under one name, a door with none
    B("func_door", box([100, 300, 0], [164, 308, 112]), { targetname: "flat1" }),
    B("func_door", box([200, 300, 0], [264, 308, 112]), { targetname: "flat2" }),
    B("func_door", box([300, 300, 0], [364, 308, 112]), { targetname: "shop_door" }),
    B("func_door", box([400, 300, 0], [464, 308, 112]), { targetname: "shop_door" }),
    B("func_door", box([500, 300, 0], [564, 308, 112]), {}),
    // a light switch and a TV
    P("light", [132, 400, 200], { targetname: "flat1_light" }),
    B("func_button", box([110, 310, 40], [120, 314, 50]), { target: "flat1_light", spawnflags: 1 }),
    // a lift: a button, a multi_manager, the train and its two stops, a sound
    B("func_train", box([700, 700, 0], [800, 800, 8]), { targetname: "lift", target: "lift_down" }),
    P("path_corner", [750, 750, 4], { targetname: "lift_down", target: "lift_up", spawnflags: 1 }),
    P("path_corner", [750, 750, 180], { targetname: "lift_up", target: "lift_down", spawnflags: 1 }),
    P("ambient_generic", [750, 750, 100], { targetname: "lift_sound", message: "buzz.wav" }),
    P("multi_manager", [750, 650, 40], { targetname: "lift_seq", lift: 1, lift_sound: 0, "lift#1": 5 }),
    B("func_button", box([690, 700, 40], [694, 716, 56]), { target: "lift_seq" }),
    // an alarm of three speakers, a heal pad, an oven, a window that comes back, a teleport
    ...[[100, 900, 100], [500, 900, 100], [900, 900, 100]].map((at) => P("ambient_generic", at, { targetname: "alarm", message: "alarm.wav" })), // prettier-ignore
    B("func_button", box([900, 100, 40], [904, 116, 56]), { target: "alarm" }),
    B("trigger_hurt", box([600, 100, 0], [700, 200, 64]), { dmg: -20 }),
    B("trigger_hurt", box([600, 300, 0], [700, 400, 64]), { dmg: 10, targetname: "oven" }),
    B("func_breakable", box([800, 300, 40], [900, 304, 120]), { respawntime: 15 }),
    B("trigger_teleport", box([50, 600, 0], [100, 650, 64]), { target: "dest" }),
    P("info_teleport_destination", [900, 600, 36], { targetname: "dest" }),
    // a slip: a switch at nothing, and a train that runs off its corners and stops for good
    B("func_button", box([300, 100, 40], [304, 116, 56]), { target: "nothing_here" }),
    B("func_train", box([300, 700, 0], [340, 740, 8]), { target: "cart_a" }),
    P("path_corner", [320, 720, 4], { targetname: "cart_a", target: "cart_b" }),
    P("path_corner", [520, 720, 4], { targetname: "cart_b" }),
  ],
};
test("wiringOf: properties by name, switches followed through relays, lifts, an alarm, heal and hurt, the slips", () => {
  const wiring = maps.wiringOf(BLOCK);
  sure(wiring.properties.length === 3 && wiring.unnamedDoors.length === 1, `properties ${wiring.properties.map((p) => p.name)}, ${wiring.unnamedDoors.length} unnamed`); // prettier-ignore
  sure(wiring.properties.find((p) => p.name === "shop_door").doors.length === 2, "two doors of one name: one property");
  sure(wiring.families[0].family === "flat" && wiring.families[0].names.length === 2, JSON.stringify(wiring.families));
  const lightSwitch = wiring.switches.find((one) => one.target === "flat1_light");
  sure(lightSwitch.works.length === 1 && lightSwitch.works[0].kind === "light", JSON.stringify(lightSwitch));
  const liftButton = wiring.switches.find((one) => one.target === "lift_seq");
  const kinds = liftButton.works.map((work) => work.kind).sort().join(" ");
  sure(kinds === "lift sound", `through the multi_manager, "lift#1" one name: ${kinds}`);
  const lift = wiring.lifts.find((one) => one.name === "lift");
  sure(lift.corners === 2 && lift.stops === 2 && lift.loops && lift.by.length === 1, JSON.stringify(lift));
  sure(wiring.broadcasts.length === 1 && wiring.broadcasts[0].speakers === 3 && wiring.broadcasts[0].by.length === 1, JSON.stringify(wiring.broadcasts)); // prettier-ignore
  sure(wiring.zones.filter((zone) => zone.kind === "heal").length === 1, "a pad that heals");
  sure(wiring.zones.find((zone) => zone.kind === "hurt").switched, "an oven, switched on by its name");
  sure(wiring.teleports.length === 1 && wiring.comesBack[0].after === 15, "a teleport, a window back in 15 s");
  const warned = wiring.warnings.join(" ");
  sure(/1 switches and triggers fire a name nothing answers to: func_button \d+ at [-\d ]+: "nothing_here"/.test(warned), warned); // prettier-ignore
  sure(/1 trains run to the end of their corners and stop for good/.test(warned), warned);
  const said = wiring.facts.join(" | ");
  sure(/5 doors under 3 names .* 1 with no name/.test(said) && /said over the map: "alarm" from 3 speakers/.test(said), said); // prettier-ignore
  for (const [name, family] of [["resident7", "resident"], ["lux_apt_c", "lux_apt"], ["golgo.apt3.1", "golgo.apt3"], ["broth_gate", "broth_gate"], ["cell 2", "cell"]]) // prettier-ignore
    sure(maps.doorFamilyOf(name) === family, `${name}: ${maps.doorFamilyOf(name)}`);
});

test("smak map-wiring reads a .map and a .bsp, and lists each property and switch", () => {
  const mapFile = join(folder, "block.map");
  writeFileSync(mapFile, maps.writeMap(BLOCK));
  const listed = runSmak("map-wiring", mapFile, "--list");
  sure(/property shop_door\s+2 doors/.test(listed) && /switch .* -> light/.test(listed), listed);
  const json = JSON.parse(runSmak("map-wiring", mapFile, "--json"));
  sure(json.properties.length === 3 && json.lifts.length === 2, "the same as JSON");
  const compiled = runSmak("map-wiring", join(FIXTURES, "tworooms.bsp"));
  sure(/doors|no doors/.test(compiled), compiled);
});

// ── the views' rooms, a line of sight in one walk, folders ──────────────────
test("a compiled map's space finds where a line of sight stops in one walk, as `sees` finds it by halves", () => {
  const bsp = maps.readBsp(readFileSync(join(FIXTURES, "tworooms.bsp")));
  const space = maps.spaceOf(bsp);
  const start = maps.originOf(maps.byClass(bsp.entities, "info_player_start")[0]);
  for (const yaw of [0, 45, 90, 180, 270]) {
    const way = [Math.cos((yaw * Math.PI) / 180), Math.sin((yaw * Math.PI) / 180)];
    const at = (length) => [start[0] + way[0] * length, start[1] + way[1] * length, start[2]];
    const stop = space.firstStop(start, at(3000));
    // by halves, as map-measure did it
    let low = 0;
    let high = 3000;
    while (high - low > 1) {
      const middle = (low + high) / 2;
      if (space.sees(start, at(middle))) low = middle;
      else high = middle;
    }
    // `sees` asks no point in the last step of a line, so by halves a wall is found up to a step late
    sure(stop !== null, `yaw ${yaw}: the line stops`);
    near(stop, low, 6, `yaw ${yaw}: in one walk, against by halves`);
  }
  sure(space.firstStop(start, start) === null, "a line of no length meets nothing");
});

test("map-character takes a folder of maps, and its table keeps its columns apart", () => {
  const maps2 = join(folder, "two");
  mkdirSync(maps2, { recursive: true });
  writeFileSync(join(maps2, "a.bsp"), readFileSync(join(FIXTURES, "tworooms.bsp")));
  writeFileSync(join(maps2, "b.bsp"), readFileSync(join(FIXTURES, "tworooms.bsp")));
  const told = runSmak("map-character", maps2);
  const lines = told.split("\n").filter((line) => /^[ab]\s/.test(line));
  sure(lines.length === 2, told);
  sure(/levels heightSprea/.test(told.split("\n")[0]), told.split("\n")[0]);
  const empty = join(folder, "none");
  mkdirSync(empty, { recursive: true });
  const refused = runRefused(SMAK_CLI, "map-character", empty);
  sure(refused.code === 1 && /no \.bsp in/.test(refused.err), refused.err);
});

// ── The Specialists' profile ────────────────────────────────────────────────
test("The Specialists' profile: made from the game's folder, its starts, its props, two sets of figures, the door's delay", () => {
  let refused = "";
  try {
    specialists({});
  } catch (error) {
    refused = error.message;
  }
  sure(/made from the installed game/.test(refused), refused);
  // a game of the kit's own: a ts folder with an FGD whose Door gives delay as a whole number, as ts_fgd.fgd does
  const game = join(folder, "Half-Life");
  mkdirSync(join(game, "ts", "maps"), { recursive: true });
  mkdirSync(join(game, "valve"), { recursive: true });
  writeFileSync(
    join(game, "ts", "ts_fgd.fgd"),
    [
      '@BaseClass = Targetname [ targetname(target_source) : "Name" ]',
      '@BaseClass base(Targetname) = Door [ delay(integer) : "Delay before fire" speed(integer) : "Speed" : 100 ]',
      '@SolidClass base(Door) = func_door : "Basic door" []',
      '@PointClass = ts_model : "A model" [ model(studio) : "Model" ]',
    ].join("\n"),
  );
  const mod = specialists({ game });
  sure(mod.starts[0] === "info_player_deathmatch" && mod.character.props[0] === "ts_model", JSON.stringify(mod.starts));
  sure(mod.classes.func_door?.keys.delay.type === "float", JSON.stringify(mod.classes));
  sure(mod.character.figures === ARENAS.figures && specialists({ game, kind: "roleplay" }).character.figures === CITIES.figures, "two sets"); // prettier-ignore
  // the cities are on the grid and dressed: a bare block of rooms is plain beside them
  const block = { offGrid: 0, sloped: 0, levels: 2, heightSpread: 63, textures: 20, sounds: 11, shadow: 24, brightest: 187, lightMean: 82 }; // prettier-ignore
  const against = maps.characterAgainst(block, CITIES);
  sure(against.warning && /three role-play cities of The Specialists/.test(against.warning), against.warning);
  const door = { worldspawn: {}, brushes: [], entities: [B("func_door", box([0, 0, 0], [64, 8, 112]), { targetname: "d", delay: "0.5" })] }; // prettier-ignore
  const checked = maps.checkEntities(door, { mod });
  sure(!/whole number/.test([...checked.errors, ...checked.warnings].join(" ")), [...checked.errors, ...checked.warnings].join(" ")); // prettier-ignore
  // a profile file for the command line, which hands a profile only the --game folders: The Specialists' as "roleplay"
  const roleplay = join(folder, "specialists-roleplay.mjs");
  writeFileSync(roleplay, `import specialists from ${JSON.stringify(pathToFileURL(join(HERE, "../profiles/specialists.mjs")).href)};\nexport default (given = {}) => specialists({ ...given, kind: "roleplay" });\n`);
  const command = runSmak("map-character", join(FIXTURES, "tworooms.bsp"), "--mod", roleplay, "--game", join(game, "ts"), "--game", join(game, "valve")); // prettier-ignore
  sure(/role-play cities/.test(command), command);
});

test("checkPlan: more than 32 names of lights is refused before the compile (MAX_SWITCHED_LIGHTS)", () => {
  const brushes = maps.carve([{ min: [-64, -64, 0], max: [512, 64, 128] }], 16, "WALL");
  const lamps = (count, named) => Array.from({ length: count }, (_, i) => maps.light([i * 8, 0, 64], { targetname: named(i) }));
  const over = maps.checkPlan({ worldspawn: {}, brushes, entities: [maps.playerStart([0, 0, 0], 0), ...lamps(33, (i) => `flat${i}`)] }); // prettier-ignore
  sure(over.errors.some((error) => /^33 names of lights: .*32 switched names at the most/.test(error)), over.errors.join(" | "));
  // lights that share a name share a style: forty lamps under two names are two
  const shared = maps.checkPlan({ worldspawn: {}, brushes, entities: [maps.playerStart([0, 0, 0], 0), ...lamps(40, (i) => `hall${i % 2}`)] }); // prettier-ignore
  sure(!shared.errors.length && shared.facts.includes("2 of the 32 names a map may give its switched lights"), shared.facts.join(" | ")); // prettier-ignore
});
