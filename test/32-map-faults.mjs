// Faults agents met in the map tools, each with the case that shows it mended: a walked floor at height 0
// asked as yes or no; an entity switched off by its classname (no wall, and a way out so written still
// looked for); markers and wiring named to the walk test, by hand and by a profile; a `trigger_counter`
// with no brush; and scripts of one's own placed against the scripts a game ships.
//
// The game is made up: its way out is an `exit_gate`, it switches entities off as `disabled_<class>`, its
// scripts are named by a `script` key and by `use <path>` lines. The house is the walk tests': a hall, a
// study a step higher, a doorway between them.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../check/maps/index.mjs";
import { test, sure, tmp, runSmak } from "./helper.mjs";

const folder = join(tmp, "map-faults");
mkdirSync(folder, { recursive: true });
const WEARS = { floor: "FLOOR", ceiling: "CEILING", wall: "WALL" };
const HALL = { min: [0, 0, 0], max: [320, 256, 160] };
const STUDY = { min: [352, 0, 16], max: [608, 256, 144] };
const DOORWAY = { min: [320, 96, 16], max: [352, 160, 112] };
const CELL = { min: [0, 288, 0], max: [128, 416, 128] }; // a room no opening leads to
const START_FLOOR = [96, 128, 0];
const IN_THE_STUDY = [480, 128, 16];
const house = (entities = []) => ({
  worldspawn: {},
  brushes: maps.carve([HALL, STUDY, DOORWAY, CELL], 16, WEARS),
  entities: [maps.playerStart(START_FLOOR, 0), maps.light([160, 128, 140]), ...entities],
});
/** a brush entity that fills the doorway, 16 thick, in a texture that is something (a trigger's own is nothing) */
const inTheDoorway = (classname, keys) =>
  maps.brushEntity(classname, maps.box([328, 96, 16], [344, 160, 112], "WALL"), keys);
const byName = (reach, name) => reach.entities.find((entity) => entity.targetname === name);
const said = (list, pattern) => list.some((sentence) => pattern.test(sentence));

test("the walk test: a place asked as yes or no, where the floor walked is at height 0", () => {
  const reach = maps.reachOf(house());
  // `walked` is a height, and the hall's floor is at 0: the answer is 0, which is no "no"
  sure(reach.walked(160, 128) === 0, `walked: ${reach.walked(160, 128)}`);
  const hall = reach.on(160, 128);
  sure(hall.walked === true && hall.stands === true && hall.floor === 0, `on the hall: ${JSON.stringify(hall)}`); // prettier-ignore
  sure(hall.jumped === false && hall.trapped === false, "neither jumped nor trapped");
  const study = reach.on(480, 128);
  sure(study.walked && study.floor === 16, `on the study: ${JSON.stringify(study)}`);
  // a room nothing leads to: a player would fit, and none walks there
  const cell = reach.on(64, 352);
  sure(cell.stands === true && cell.walked === false && cell.floor === 0, `the cell: ${JSON.stringify(cell)}`);
  const rock = reach.on(336, 20);
  sure(!rock.stands && !rock.walked && rock.floor === null, `inside the wall: ${JSON.stringify(rock)}`);
  // under a height: the study's floor is over 8
  sure(reach.on(480, 128, 8).walked === false && reach.on(480, 128, 20).walked === true, "under a height");
});

test("the walk test: an entity switched off by its classname is no wall, and a way out so written is looked for", () => {
  const map = house([
    maps.pointEntity("monster_zombie", IN_THE_STUDY),
    inTheDoorway("disabled_exit_gate", { targetname: "way_on" }),
    // one behind the rock, as a map keeps the name of the way its players came by
    maps.brushEntity("disabled_exit_gate", maps.box([-80, 96, 0], [-60, 160, 96], "AAATRIGGER"), { targetname: "way_back" }), // prettier-ignore
  ]);
  // told nothing, the kit takes a class it does not know for something solid: the doorway is shut
  const blind = maps.reachOf(map, { exits: ["exit_gate"] });
  sure(blind.unreached.length === 1 && !byName(blind, "way_on"), `told nothing: ${blind.warnings.join(" | ")}`);
  // told how the mod switches off: no wall, the study is walked, and the two are looked for
  const reach = maps.reachOf(map, { exits: ["exit_gate"], off: ["disabled_*"] });
  sure(reach.unreached.length === 0 && reach.on(480, 128).walked, `with off: ${reach.warnings.join(" | ")}`);
  const on = byName(reach, "way_on");
  const back = byName(reach, "way_back");
  sure(on?.off === true && on.reached && on.classname === "disabled_exit_gate", `the way on: ${JSON.stringify(on)}`); // prettier-ignore
  sure(back?.off === true && !back.reached, `the way back: ${JSON.stringify(back)}`);
  sure(!reach.unreached.includes(back.number), "an unreached one is no fault");
  sure(said(reach.facts, /^2 ways out are switched off .*"way_on" is reached; .*"way_back" is NOT reached/), reach.facts.join(" | ")); // prettier-ignore
  sure(said(reach.facts, /^all 2 entities a player goes to are reached/), "counted apart");
  // it is no way out: the fact of the one-way places names none
  sure(!said(reach.facts, /or to a way out/), "switched off, it lets nobody out");
  // a compiled map's space takes the same word (the fixture has none switched off: nothing changes)
  sure(maps.spaceOf(map, { off: ["disabled_*"] }).areas.filter((area) => area.off).length === 2, "spaceOf"); // prettier-ignore
  sure(maps.spaceOf(map).areas.every((area) => !area.off), "and says nothing unless told");
  // a profile says it once
  const mod = { name: "made-up", exits: ["exit_gate"], off: ["disabled_*"] };
  const byProfile = maps.reachOf(map, { mod });
  sure(byName(byProfile, "way_on")?.reached && byProfile.unreached.length === 0, "by the profile");
  sure(maps.classUnder(["disabled_*", "*_off"], "disabled_exit_gate") === "exit_gate", "classUnder");
  sure(maps.classUnder(["disabled_*", "*_off"], "gate_off") === "gate" && maps.classUnder(["disabled_*"], "exit_gate") === null, "classUnder, the other way and none"); // prettier-ignore
});

test("the walk test: markers are gone to, wiring is not, and a trigger that is only fired needs no reaching", () => {
  const HIGH = [160, 200, 150]; // under the hall's ceiling: no standing player comes within reach of it
  const map = house([
    maps.pointEntity("info_target", IN_THE_STUDY, { targetname: "chest_here" }),
    maps.pointEntity("info_target", [64, 352, 0], { targetname: "chest_walled" }),
    maps.pointEntity("made_text", HIGH, { targetname: "a_line" }),
    maps.brushEntity("trigger_counter", maps.box([40, 40, 140], [56, 56, 156], "AAATRIGGER"), { targetname: "count3" }), // prettier-ignore
    maps.brushEntity("trigger_once", maps.box([80, 40, 140], [96, 56, 156], "AAATRIGGER"), { targetname: "too_high" }), // prettier-ignore
  ]);
  const plain = maps.reachOf(map);
  // an info_target is wiring unless named; a class the kit does not know is gone to, and this one hangs high
  sure(!byName(plain, "chest_here") && !byName(plain, "chest_walled"), "info_target: not counted unless named");
  sure(byName(plain, "a_line") && !byName(plain, "a_line").reached, "an unknown class up high: not reached");
  // a counter is fired, never touched: made of a brush or not, nobody has to get to it
  sure(!byName(plain, "count3"), "a brush trigger_counter is not gone to");
  sure(byName(plain, "too_high") && !byName(plain, "too_high").reached, "a trigger that is walked into still is");
  const told = maps.reachOf(map, { markers: ["chest_here", "chest_walled"], wiring: ["made_*"] });
  sure(byName(told, "chest_here")?.reached === true, "a marker that is reached");
  sure(byName(told, "chest_walled")?.reached === false, "and one that is walled off");
  sure(!byName(told, "a_line"), "wiring is left out");
  sure(told.unreached.length === 2 && said(told.warnings, /^2 of the 4 entities a player goes to are not reached/), told.warnings.join(" | ")); // prettier-ignore
  // wiring stands over all else: by number, a trigger; by a profile, a class
  const quiet = maps.reachOf(map, { mod: { name: "made-up", wiring: ["made_text", "trigger_once"], markers: ["chest_here"] } }); // prettier-ignore
  sure(quiet.unreached.length === 0 && quiet.entities.length === 2, `by the profile: ${quiet.warnings.join(" | ")}`);
  sure(maps.modOf({ name: "x" }).wiring.length === 0 && maps.GOLDSRC.markers.length === 0, "the kit's own profile names none"); // prettier-ignore
});

test("the entity check: a trigger_counter with no brush is not told to have no shape", () => {
  const fgd = join(folder, "counters.fgd");
  writeFileSync(
    fgd,
    '@SolidClass = trigger_counter : "Counts" [ targetname(target_source) : "Name" target(target_destination) : "Target" count(integer) : "Count" : 2 ]\n@SolidClass = func_gate : "A gate" [ targetname(target_source) : "Name" ]\n@PointClass = info_player_start : "Start" []\n@PointClass = light : "Light" [ _light(color255) : "Light" ]\n',
  );
  const counter = maps.pointEntity("trigger_counter", [160, 128, 100], { targetname: "three", target: "three", count: 3 }); // prettier-ignore
  const gate = maps.pointEntity("func_gate", [160, 100, 100], { targetname: "gate" });
  const report = maps.checkEntities(house([counter, gate]), { definitions: fgd });
  const noShape = report.warnings.filter((line) => /have no brush/.test(line));
  sure(noShape.length === 1 && /func_gate/.test(noShape[0]) && !/trigger_counter/.test(noShape[0]), `${report.warnings.join(" | ")}`); // prettier-ignore
});

// ── scripts: what a made-up game ships, and ours ──
const SHIPPED = new Map([
  ["beasts/wolf", "// a wolf\nuse beasts/base\n"],
  ["beasts/base", "setmodel wolf.mdl\n"],
  ["world", "use rules\n"],
  ["rules", "// nothing\n"],
]);
const RULES = {
  ofEntity: (keys) => (keys.script ? [keys.script.toLowerCase()] : []),
  aliases: (name) => (name.startsWith("things/") ? [name.slice(7)] : []),
  started: (name, { maps: names }) => {
    const map = /^([^/]+)\/startup$/.exec(name)?.[1];
    return map && names.includes(map) ? `the game itself, when the map ${map} starts` : null;
  },
};
const oursOf = (list) => new Map(Object.entries(list).map(([name, text]) => [name, { text, file: `ours/${name}.script` }])); // prettier-ignore

test("scripts of one's own placed against the game's: replaces, new and named, named by nothing", () => {
  const ours = oursOf({
    "beasts/wolf": "use beasts/base\nuse beasts/howl // ours, in the game's place\n",
    "beasts/howl": "use effects/echo\n",
    "effects/echo": "// a sound\n",
    "yard/keeper": "give lamp\n",
    "things/lamp": "// an item, named without its folder\n",
    "yard/startup": "// run for the map yard\n",
    "cellar/startup": "// there is no map cellar\n",
    "world/server/maps": "use world/server/more\n",
    "world/server/more": "// named only by a script nothing names\n",
    "beasts/commented": "// nothing\n",
    rules: "// use beasts/commented : a comment names nothing\n",
  });
  const yard = { name: "yard", entities: [{ classname: "worldspawn" }, { classname: "beast", script: "Yard/Keeper", targetname: "keeper" }] }; // prettier-ignore
  const placed = maps.scriptsPlaced({ ours, shipped: SHIPPED, maps: [yard], rules: RULES });
  const state = Object.fromEntries(placed.scripts.map((script) => [script.name, script.state]));
  const by = Object.fromEntries(placed.scripts.map((script) => [script.name, script.by.join(" | ")]));
  sure(state["beasts/wolf"] === "replaces" && state.rules === "replaces", "what the game ships is replaced");
  sure(state["beasts/howl"] === "named" && /the script beasts\/wolf \(ours, in the game's place\)/.test(by["beasts/howl"]), by["beasts/howl"]); // prettier-ignore
  sure(state["effects/echo"] === "named" && /the script beasts\/howl \(ours, new\)/.test(by["effects/echo"]), "named by a new script that is named"); // prettier-ignore
  sure(state["yard/keeper"] === "named" && /the map yard \(entity 1 beast "keeper"\)/.test(by["yard/keeper"]), by["yard/keeper"]); // prettier-ignore
  sure(state["things/lamp"] === "named" && /yard\/keeper/.test(by["things/lamp"]), "an item by its bare name");
  sure(state["yard/startup"] === "named" && /when the map yard starts/.test(by["yard/startup"]), "run by the game");
  sure(state["cellar/startup"] === "unnamed", "and not for a map there is not");
  sure(state["world/server/maps"] === "unnamed" && state["world/server/more"] === "unnamed", "a path the game has not");
  sure(/world\/server\/maps, which nothing names either/.test(by["world/server/more"]), by["world/server/more"]);
  sure(state["beasts/commented"] === "unnamed", "a comment names nothing");
  sure(placed.warnings.length === 1 && /^4 scripts are new .* and nothing names them/.test(placed.warnings[0]), placed.warnings.join(" | ")); // prettier-ignore
  sure(/ours\/world\/server\/maps\.script/.test(placed.warnings[0]), "with its file");
  sure(/^11 scripts of ours against the 4 the game ships: 2 take a game script's place, 5 are new and named, 4 are new and named by nothing/.test(placed.facts[0]), placed.facts[0]); // prettier-ignore
  // nothing new: nothing to say
  const none = maps.scriptsPlaced({ ours: oursOf({ rules: "//\n" }), shipped: SHIPPED, rules: RULES });
  sure(!none.warnings.length && none.scripts[0].state === "replaces", "only replacements");
  // the map names a map_startup's map even when no map is given, if the names are
  const named = maps.scriptsPlaced({ ours: oursOf({ "cellar/startup": "" }), shipped: SHIPPED, rules: RULES, mapNames: ["cellar"] }); // prettier-ignore
  sure(named.scripts[0].state === "named", "mapNames");
});

test("smak scripts, and map-check with --scripts: a script that replaces nothing and is named by nothing is said", () => {
  // the made-up game as files: its pack unpacked, our folder, a profile that reads both, a map
  const shippedFolder = join(folder, "shipped");
  const oursFolder = join(folder, "ours");
  for (const [name, text] of SHIPPED) {
    mkdirSync(join(shippedFolder, name, ".."), { recursive: true });
    writeFileSync(join(shippedFolder, `${name}.script`), text);
  }
  for (const [name, text] of Object.entries({ "beasts/wolf": "use beasts/howl\n", "beasts/howl": "//\n", "yard/keeper": "//\n", "world/server/maps": "//\n" })) { // prettier-ignore
    mkdirSync(join(oursFolder, name, ".."), { recursive: true });
    writeFileSync(join(oursFolder, `${name}.script`), text);
  }
  const profile = join(folder, "profile.mjs");
  writeFileSync(
    profile,
    `import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const read = (folder, under = "", found = new Map()) => {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) read(path, under + name + "/", found);
    else if (name.endsWith(".script")) found.set((under + name).replace(/\\.script$/, ""), { text: readFileSync(path, "utf8"), file: path });
  }
  return found;
};
export default () => ({
  name: "made-up",
  scriptPack: {
    shipped: (folder) => new Map([...read(folder)].map(([name, script]) => [name, script.text])),
    loose: read,
    ofEntity: (keys) => (keys.script ? [keys.script] : []),
  },
});
`,
  );
  const mapFile = join(folder, "yard.map");
  writeFileSync(mapFile, maps.writeMap(house([maps.pointEntity("monster_zombie", IN_THE_STUDY, { script: "yard/keeper" })]))); // prettier-ignore
  const listed = runSmak("scripts", oursFolder, mapFile, "--mod", profile, "--shipped", shippedFolder);
  sure(/^replaces {2}beasts\/wolf$/m.test(listed), listed);
  sure(/^new {7}beasts\/howl: named by the script beasts\/wolf/m.test(listed), listed);
  sure(/^new {7}yard\/keeper: named by the map yard/m.test(listed), listed);
  sure(/^UNNAMED {3}world\/server\/maps$/m.test(listed) && /^WARN {2}1 scripts are new/m.test(listed), listed);
  // without the map its keeper is named by nothing too
  sure(/^WARN {2}2 scripts are new/m.test(runSmak("scripts", oursFolder, "--mod", profile, "--shipped", shippedFolder)), "without the map"); // prettier-ignore
  const json = JSON.parse(runSmak("scripts", oursFolder, mapFile, "--mod", profile, "--shipped", shippedFolder, "--json")); // prettier-ignore
  sure(json.scripts.length === 4 && json.warnings.length === 1, "as JSON");
  // map-check, given the folder of scripts, says it of this map's own only (world/server/maps is no map's:
  // another map may name it), and of every one with --all (test 45 has a map's own warned of)
  const checked = runSmak("map-check", mapFile, "--mod", profile, "--scripts", oursFolder, "--shipped", shippedFolder, "--verbose"); // prettier-ignore
  sure(!/^WARN {2}\d+ scripts are new/m.test(checked) && /1 more scripts are new and named by nothing, and are no part of yard/.test(checked), checked); // prettier-ignore
  const all = runSmak("map-check", mapFile, "--mod", profile, "--scripts", oursFolder, "--shipped", shippedFolder, "--all", "--verbose"); // prettier-ignore
  sure(/^WARN {2}1 scripts are new .*world\/server\/maps/m.test(all), all);
});
