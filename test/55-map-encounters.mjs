// A map's encounters and its character: how each spawn area's monsters come (fired by what, seen appearing
// or not, back soon, races at war, a reward far from its fight), the recipes that wire them, and a compiled
// map's figures held against a mod's. A made-up game of the kit's own: dens that hold beasts.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../check/maps/index.mjs";
import { test, sure, tmp, runSmak, runRefused, SMAK_CLI, HERE } from "./helper.mjs";

const folder = join(tmp, "map-encounters");
mkdirSync(folder, { recursive: true });
const WEARS = { floor: "FLOOR", ceiling: "CEILING", wall: "WALL" };
// one long hall, 1600 along x; a wall across it at x 1180-1200 hides its far end from the near one
const HALL = { min: [0, 0, 0], max: [1600, 320, 160] };
const WALL = maps.box([1180, 0, 0], [1200, 320, 160], "WALL");
const hall = (entities) => ({
  worldspawn: {},
  brushes: [...maps.carve([HALL], 16, WEARS), WALL],
  entities: [maps.playerStart([96, 160, 0], 0), maps.light([400, 160, 140]), ...entities],
});
// the game: a den holds beasts (`den` names it); `wakes 1` waits to be fired; `gone` fired when all are dead
const RACES = { "beasts/wolf": "pack", "beasts/boar": "herd", "beasts/bear": "herd", "beasts/chest": null };
const SPAWNS = {
  areas: ["smak_den"],
  templates: ["smak_beast", "smak_chest"],
  area: "den",
  waits: { key: "wakes", value: "1" },
  cleared: "gone",
  dies: ["ondeath"],
  lives: "lives",
  endless: ["0", ""],
  delay: ["soonest", "latest"],
  band: { key: "strength", separator: ";" },
  script: (keys) => keys.kind ?? null,
  scriptKey: "kind",
  race: (script) => RACES[script] ?? null,
  // the pack attacks everyone; the herd no one
  relation: (a, b) => (a === "pack" && b !== "pack" ? "hates" : a === b ? "ally" : "none"),
  reward: (script) => script === "beasts/chest",
  arrival: ["game_playerspawn"],
  touches: ["trigger_once", "trigger_multiple"],
  fires: (script) => (script === "beasts/bear" ? ["bear_called"] : []),
};
const mod = { name: "smakgame", spawns: SPAWNS, recipes: { text: "game_text", chance: null, oneOf: null, counter: "point" } };
const den = (name, at, keys = {}) => maps.pointEntity("smak_den", at, { targetname: name, wakes: 1, ...keys });
const beast = (name, kind, at, keys = {}) =>
  maps.pointEntity("smak_beast", at, { den: name, kind, lives: 1, soonest: 1, latest: 2, ...keys });
const trigger = (min, max, target) => maps.brushEntity("trigger_once", [maps.box(min, max, "AAATRIGGER")], { target });
const areaOf = (report, name) => report.areas.find((area) => area.name === name);

test("an area fired from a trigger: by what, through relays, and which of its monsters are seen appearing", () => {
  const map = hall([
    trigger([160, 64, 0], [224, 256, 128], "go"),
    maps.pointEntity("multi_manager", [192, 160, 120], { targetname: "go", near: 0, far: 1 }),
    den("near", [800, 160, 80]),
    beast("near", "beasts/boar", [800, 96, 16]),
    beast("near", "beasts/boar", [800, 224, 16]),
    den("far", [1400, 160, 80]),
    beast("far", "beasts/boar", [1400, 160, 16]),
  ]);
  const report = maps.spawnsOf(map, { mod });
  const near = areaOf(report, "near");
  sure(near.comes === "fired" && near.by.length === 1 && near.by[0].kind === "touch", JSON.stringify(near.by));
  sure(near.by[0].via.join() === "multi_manager go", `through the multi_manager: ${near.by[0].via}`);
  sure(near.seen.length === 2 && near.seen.every((each) => each.distance > 500 && each.distance < 700), JSON.stringify(near.seen));
  const far = areaOf(report, "far");
  sure(far.comes === "fired" && far.seen.length === 0, `the wall hides the far den: ${JSON.stringify(far.seen)}`);
  sure(report.warnings.some((each) => /2 monsters of 1 spawn areas can be seen appearing.*near 2 of 2/.test(each)), report.warnings.join(" | "));
  // a closer sight than the monsters: nothing is said
  sure(!maps.spawnsOf(map, { mod, sight: 400 }).warnings.some((each) => /seen appearing/.test(each)), "within 400 units, none");
  // the same in the map-check of a mod: its warnings among the check's
  const checked = maps.checkPlan(map, { mod: { ...mod, classes: {} } });
  sure(checked.warnings.some((each) => /seen appearing/.test(each)), checked.warnings.join(" | "));
});

test("areas there at the start or on arrival, monsters back soon, a script that fires an area, one fired by nothing", () => {
  const map = hall([
    maps.pointEntity("smak_den", [400, 160, 80], { targetname: "home" }), // no `wakes`: there at the start
    beast("home", "beasts/boar", [400, 160, 16], { lives: 3, soonest: 5, latest: 10 }),
    maps.pointEntity("trigger_relay", [500, 160, 120], { targetname: "game_playerspawn", target: "early", spawnflags: 1 }),
    den("early", [600, 160, 80]),
    beast("early", "beasts/boar", [600, 160, 16], { lives: 0, soonest: 300, latest: 600 }),
    den("cave", [900, 160, 80]),
    beast("cave", "beasts/bear", [900, 160, 16]), // its script fires bear_called
    den("bear_called", [1000, 160, 80]),
    beast("bear_called", "beasts/boar", [1000, 160, 16]),
    den("lost", [1100, 160, 80]),
    beast("lost", "beasts/boar", [1100, 160, 16]),
  ]);
  const report = maps.spawnsOf(map, { mod, seen: false });
  sure(areaOf(report, "home").comes === "start", areaOf(report, "home").comes);
  sure(areaOf(report, "early").comes === "arrival", areaOf(report, "early").comes);
  sure(areaOf(report, "home").quick.length === 1 && areaOf(report, "early").quick.length === 0, "3 lives 10 s apart are quick; endless 600 s apart are not");
  sure(report.warnings.some((each) => /1 monsters come back at their own spot under 60 s.*home 1 \(entity \d+, beasts\/boar, 3 lives, back after 5-10 s\)/.test(each)), report.warnings.join(" | ")); // prettier-ignore
  sure(areaOf(report, "bear_called").by.some((each) => each.kind === "script" && each.script === "beasts/bear"), JSON.stringify(areaOf(report, "bear_called").by)); // prettier-ignore
  sure(report.facts.some((each) => /2 areas wait to be fired and nothing found fires them \(a name put together by a script is not seen\): cave; lost/.test(each)), report.facts.join(" | ")); // prettier-ignore
  sure(report.facts.some((each) => /5 spawn areas hold 5 monsters: 1 there when the map starts, 1 when the first player arrives, 3 fired later/.test(each)), report.facts.join(" | ")); // prettier-ignore
});

test("races at war on one spawn: near, in a band they share; and a reward far from the death that brings it", () => {
  const map = hall([
    den("mixed", [600, 160, 80]),
    beast("mixed", "beasts/wolf", [600, 96, 16], { strength: "0;150" }),
    beast("mixed", "beasts/boar", [700, 96, 16], { strength: "0;150" }), // the wolf attacks it
    beast("mixed", "beasts/bear", [700, 224, 16], { strength: "500" }), // another band: never together
    beast("mixed", "beasts/boar", [600, 96, 16], { strength: "0;150", den: "herd" }),
    den("herd", [900, 160, 80]),
    beast("herd", "beasts/boar", [900, 96, 16]),
    beast("herd", "beasts/bear", [900, 224, 16]), // the herd leaves the herd alone
    den("far_apart", [300, 160, 80]),
    beast("far_apart", "beasts/wolf", [100, 160, 16]),
    beast("far_apart", "beasts/boar", [1500, 160, 16]), // over 1024 apart
    den("boss", [1300, 160, 80]),
    beast("boss", "beasts/bear", [1300, 160, 16], { ondeath: "loot" }),
    den("loot", [100, 160, 80]),
    maps.pointEntity("smak_chest", [100, 160, 16], { den: "loot", kind: "beasts/chest", lives: 1 }),
    den("loot_near", [1350, 160, 80]),
    maps.pointEntity("smak_chest", [1350, 160, 16], { den: "loot_near", kind: "beasts/chest", lives: 1 }),
    maps.pointEntity("trigger_relay", [1300, 200, 120], { targetname: "boss_down", target: "loot_near" }),
  ]);
  // the boss's death fires loot directly, and boss_down through a relay that a second dying key names
  map.entities.push(beast("boss", "beasts/bear", [1310, 160, 16], { ondeath: "boss_down" }));
  const report = maps.spawnsOf(map, { mod, seen: false });
  const mixed = areaOf(report, "mixed");
  sure(mixed.fights.length === 1 && mixed.fights[0].a.race === "pack" && mixed.fights[0].b.script === "beasts/boar", JSON.stringify(mixed.fights.map(({ a, b }) => [a.script, b.script]))); // prettier-ignore
  sure(!areaOf(report, "herd").fights.length && !areaOf(report, "far_apart").fights.length, "allies, and beasts far apart, do not fight");
  sure(report.warnings.some((each) => /1 spawn areas hold races that attack each other.*mixed: beasts\/wolf \(pack\) attacks beasts\/boar \(herd\)/.test(each)), report.warnings.join(" | ")); // prettier-ignore
  const loot = areaOf(report, "loot");
  sure(loot.rewards.length === 1 && loot.rewards[0].distance === 1200, JSON.stringify(loot.rewards));
  sure(areaOf(report, "loot_near").rewards[0]?.distance === 40, JSON.stringify(areaOf(report, "loot_near").rewards));
  sure(report.warnings.some((each) => /1 rewards appear far from the death that brings them.*loot: entity \d+ \(beasts\/chest\) 1200 units/.test(each)), report.warnings.join(" | ")); // prettier-ignore
  // a profile without spawns reads nothing, and says so
  const none = maps.spawnsOf(map, { mod: { name: "plain" } });
  sure(!none.areas.length && /says nothing of spawn areas/.test(none.facts[0]), none.facts.join());
});

test("a compiled map's character, held against a mod's figures; the command lines", () => {
  const bsp = maps.readBsp(readFileSync(join(HERE, "fixtures/tworooms.bsp")));
  const { figures, facts } = maps.characterOf(bsp);
  sure(figures.levels >= 1 && figures.textures >= 2 && figures.textures <= 3, JSON.stringify(figures));
  sure(figures.offGrid === 0 && figures.sloped === 0 && figures.lightMean > 0 && figures.lights === 2, JSON.stringify(figures));
  sure(facts.length === 4 && /walls off the grid/.test(facts[1]), facts.join(" | "));
  const reference = maps.learnCharacter([
    { name: "a", figures: { ...figures, offGrid: 30, sloped: 20, levels: 9, heightSpread: 300, textures: 40, sounds: 5, shadow: 30, brightest: 240, lightMean: 40 } }, // prettier-ignore
    { name: "b", figures: { ...figures, offGrid: 40, sloped: 25, levels: 11, heightSpread: 500, textures: 60, sounds: 9, shadow: 40, brightest: 250, lightMean: 50 } }, // prettier-ignore
  ], { from: "two maps" });
  sure(reference.figures.offGrid[0] === 30 && reference.maps.join() === "a,b", JSON.stringify(reference));
  const told = maps.characterAgainst(figures, reference);
  sure(told.plain.some((each) => /^walls off the grid: 0%, under two maps: 30% to 40%/.test(each)), told.plain.join(" | "));
  sure(told.plain.length >= 5 && /looks plain beside two maps/.test(told.warning), told.warning);
  sure(maps.characterAgainst(figures, reference, { most: 99 }).warning === null, "under `most`, no warning");
  sure(/a compiled map/.test((() => { try { maps.characterOf({ brushes: [] }); } catch (e) { return e.message; } })()), "brush source is refused"); // prettier-ignore

  // the commands: a profile in a file, map-spawns on brush source, map-character and its --learn
  const profile = join(folder, "smakgame.mjs");
  writeFileSync(profile, `import { readFileSync } from "node:fs";\nconst RACES = ${JSON.stringify(RACES)};\nexport default { name: "smakgame", spawns: { ...${JSON.stringify({ ...SPAWNS, script: undefined, race: undefined, relation: undefined, reward: undefined, fires: undefined })}, script: (keys) => keys.kind ?? null, race: (s) => RACES[s] ?? null, relation: (a, b) => (a === "pack" && b !== "pack" ? "hates" : "none"), reward: () => false } };\n`); // prettier-ignore
  const file = join(folder, "hall.map");
  writeFileSync(file, maps.writeMap(hall([trigger([160, 64, 0], [224, 256, 128], "near"), den("near", [800, 160, 80]), beast("near", "beasts/boar", [800, 160, 16])]))); // prettier-ignore
  const seen = runRefused(SMAK_CLI, "map-spawns", file, "--mod", profile, "-o", join(folder, "spawns.png"));
  sure(seen.code === 1 && /near\s+fired\s+1\s+beasts\/boar.*SEEN 1/.test(seen.out) && /spawns\.png/.test(seen.out), seen.out + seen.err);
  sure(/--mod <profile> whose `spawns`/.test(runRefused(SMAK_CLI, "map-spawns", file).err), "no profile, refused");
  const character = runSmak("map-character", join(HERE, "fixtures/tworooms.bsp"));
  sure(/the ground: 0% of the walls off the grid/.test(character) && /no figures to hold it against/.test(character), character);
  const learned = join(folder, "figures.json");
  runSmak("map-character", join(HERE, "fixtures/tworooms.bsp"), join(HERE, "fixtures/tworooms-wants-wad.bsp"), "--learn", "-o", learned);
  const against = runSmak("map-character", join(HERE, "fixtures/tworooms.bsp"), "--against", learned);
  sure(JSON.parse(readFileSync(learned, "utf8")).maps.length === 2 && !/^WARN/m.test(against), against);
});
