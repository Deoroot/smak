// A map's entities held against a mod: entity definitions read from .fgd files and learned from a mod's own
// maps, the classes a game's own program has, a mod's profile and its rules, and the files the entities name.
//
// The game is the kit's own made-up one: test/fixtures/smakgame.fgd (starts, beasts that come out of dens,
// gates, things to pick up) and a profile written here. No game's definitions, maps or files are used. Every
// "nothing is wrong" has a case beside it where the same check reports the fault; the five faults of the
// first map drafted with the kit, which nothing caught, are cases of their own.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../check/maps/index.mjs";
import { test, testAsync, sure, HERE, tmp, runSmak, runRefused, SMAK_CLI } from "./helper.mjs";

const FIXTURES = join(HERE, "fixtures");
const FGD = join(FIXTURES, "smakgame.fgd");
const tworoomsBytes = readFileSync(join(FIXTURES, "tworooms.bsp"));
const tworooms = maps.readBsp(tworoomsBytes);
const folder = join(tmp, "maps-mods");
mkdirSync(folder, { recursive: true });
const inFolder = (name) => join(folder, name);

// ── what the cases share ──
const refuses = (run, pattern) => {
  try {
    run();
  } catch (e) {
    return pattern.test(e.message) ? true : `it said: ${e.message}`;
  }
  return "it did not refuse";
};
/** Every sentence of a report, to look a pattern up in. */
const all = (report) => [...report.errors, ...report.warnings, ...report.facts].join("\n");
const said = (list, pattern) => list.some((sentence) => pattern.test(sentence));

// a hall, a study a step higher, a doorway between them: the house of the walk tests
const WEARS = { floor: "FLOOR", ceiling: "CEILING", wall: "WALL" };
const HALL = { min: [0, 0, 0], max: [320, 256, 160] };
const STUDY = { min: [352, 0, 16], max: [608, 256, 144] };
const DOORWAY = { min: [320, 96, 16], max: [352, 160, 112] };
const START_FLOOR = [96, 128, 0];
const trigger = (classname, keys) => maps.brushEntity(classname, maps.box([200, 96, 0], [216, 160, 96], "AAATRIGGER"), keys); // prettier-ignore
/** The house with a start, a light and `entities`; `start` names the start's class. */
const house = (entities = [], { start = "info_player_start", worldspawn = {} } = {}) => ({
  worldspawn,
  brushes: maps.carve([HALL, STUDY, DOORWAY], 16, WEARS),
  entities: [maps.playerStart(START_FLOOR, 0, start), maps.light([160, 128, 140]), ...entities],
});
/** What the entity checks say of a map with these entities, against the kit's own FGD. */
const against = (entities, options = {}) =>
  maps.checkEntities(house(entities, options), { definitions: FGD, ...options });

/** A beast: its origin is at its feet. */
const beast = (at, keys = {}, classname = "smak_beast") => maps.pointEntity(classname, at, keys);
const den = (name, keys = {}) => maps.pointEntity("smak_den", [480, 128, 80], { targetname: name, ...keys });

// ── .fgd files ──

test("an FGD is read into plain data: classes, bases, sizes, models, keys with their types, choices and flags", () => {
  const read = maps.readFgd(readFileSync(FGD, "latin1"), { name: "smakgame.fgd" });
  sure(read.includes.join() === "SmakBase.fgd", `the include: ${read.includes.join()}`);
  const { light, smak_bigbeast: big, smak_den: aDen, env_thing: thing } = read.classes;
  sure(light.kind === "point" && read.classes.func_wall.kind === "solid", "a point class and a brush class");
  sure(light.description === "A light that shines every way", `text joined with +: ${light.description}`);
  sure(
    light.keys._light.type === "color255" && light.keys._light.default === "255 255 255 200",
    JSON.stringify(light.keys._light),
  );
  sure(
    light.keys.style.type === "choices" &&
      light.keys.style.choices.join() === "0,1,2" &&
      light.keys.style.default === "0",
    JSON.stringify(light.keys.style),
  );
  // the flags that are on to begin with add up to the default
  sure(
    light.keys.spawnflags.flags.join() === "1,2" && light.keys.spawnflags.default === "2",
    JSON.stringify(light.keys.spawnflags),
  );
  sure(big.bases.join() === "Beast" && big.size.mins.join() === "-32,-32,0" && big.size.maxs.join() === "32,32,64", JSON.stringify(big)); // prettier-ignore
  sure(
    aDen.sprite === "sprites/smak/den.spr" && thing.model === null,
    "an icon's sprite; studio() with no file",
  );
  sure(read.classes.smak_beast.model === "models/smak/beast.mdl", "a class's model");
  sure(JSON.stringify(read) === JSON.stringify(JSON.parse(JSON.stringify(read))), "plain data");

  // a file with its includes, found whatever the capitals; one that is not there is listed
  const loaded = maps.loadFgd(FGD);
  sure(
    loaded.files.length === 2 && !loaded.missing.length,
    `${loaded.files.join()} ${loaded.missing.join()}`,
  );
  sure(loaded.classes.Beast.kind === "base" && loaded.classes.Beast.keys.den, "the included file's classes");
  sure(!loaded.classes.Beast.keys.mood, "a key behind // is a comment");
  writeFileSync(inFolder("alone.fgd"), '@include "gone.fgd"\n@PointClass = lamp : "A lamp" []\n');
  const alone = maps.loadFgd(inFolder("alone.fgd"));
  sure(alone.missing.join() === "gone.fgd" && alone.classes.lamp.kind === "point", JSON.stringify(alone));

  // what cannot be read is refused, with the line
  sure(
    refuses(
      () =>
        maps.readFgd('@PointClass = lamp : "A lamp"\n[\n  bright(integer : "How bright"\n]\n', {
          name: "bad.fgd",
        }),
      /bad\.fgd: line \d+: "\)" was expected after the key bright/,
    ) === true,
    "an FGD with a bracket left open",
  );
  sure(refuses(() => maps.readFgd(Buffer.alloc(4)), /the text of an \.fgd file/) === true, "bytes for text");
});

test("definitions: a class has the keys, the size and the model of its bases, and its own stand over theirs", () => {
  const definitions = maps.definitionsOf(FGD);
  sure(definitions.fgd && definitions.from.join() === "smakbase.fgd,smakgame.fgd", definitions.from.join());
  sure(!definitions.classes.Beast && !definitions.classes.Start, "a base class is no class a map can use");
  const { smak_beast: one, smak_bigbeast: big, smak_arrive: arrive } = definitions.classes;
  sure(
    ["targetname", "target", "angles", "den", "strength", "lives", "script", "killtarget"].every(
      (key) => one.keys[key],
    ),
    Object.keys(one.keys).join(),
  );
  sure(
    one.keys.target.type === "target_destination" && one.keys.lives.default === "1",
    "a base's key, whole",
  );
  sure(
    one.size.maxs.join() === "16,16,72" && big.size.maxs.join() === "32,32,64",
    "a size of its own over its base's",
  );
  sure(
    arrive.size.mins.join() === "-16,-16,-36" && arrive.keys.angles && arrive.keys.message,
    "through two bases",
  );
  // of two files' word on one class, the later stands
  const later = maps.definitionsOf(
    FGD,
    maps.readFgd('@PointClass = light : "Another" [ glow(integer) : "Glow" ]'),
  );
  sure(later.classes.light.keys.glow && !later.classes.light.keys.style, "the later file's class");
  // flags are joined with the base's, as Hammer joins them: Half-Life's func_door_rotating names 2 to 128 and its
  // Door base 32 (toggle) and 256 (use only), which the kit's doors are given
  const doors = maps.definitionsOf(
    maps.readFgd(`@BaseClass = Door [ spawnflags(flags) = [ 1 : "Starts Open" : 0 32 : "Toggle" : 0 256 : "Use Only" : 0 ] ]
@SolidClass base(Door) = func_door_rotating : "A door" [ spawnflags(flags) = [ 2 : "Reverse Dir" : 0 64 : "X Axis" : 0 ] ]`),
  ).classes.func_door_rotating.keys.spawnflags;
  sure(doors.flags.join() === "1,2,32,64,256" && doors.labels["256"] === "Use Only", `${doors.flags} ${JSON.stringify(doors.labels)}`);
  sure(
    refuses(() => maps.definitionsOf({}), /an \.fgd file's path, or what readFgd or loadFgd gave/) === true,
    "no FGD",
  );
});

// ── a map against definitions ──

test("with definitions, a sound map says nothing; a class that is not defined is an error, in source and compiled", () => {
  const sound = [
    beast([480, 128, 16], { den: "lair", lives: 2, target: "bell" }),
    den("lair", { whenempty: "bell" }),
    maps.pointEntity("multi_manager", [100, 40, 40], { targetname: "bell", lair: 0.5, "lair#1": 2 }),
    trigger("trigger_once", { target: "bell", delay: 0.5, zhlt_invisible: 1 }),
    maps.pointEntity("info_texlights", [0, 0, 0], { FLOOR: "255 255 255 100" }),
  ];
  const clean = against(sound);
  sure(!clean.errors.length && !clean.warnings.length, `a sound map: ${all(clean)}`);
  sure(
    /entity definitions: \d+ classes from smakbase\.fgd, smakgame\.fgd/.test(clean.facts.join()),
    clean.facts.join(" | "),
  );
  // the plan's check carries the same sentences, and counts none of them against a sound map
  const plan = maps.checkPlan(house(sound), { definitions: FGD, leak: false });
  sure(!plan.errors.length && /entity definitions:/.test(plan.facts.join()), all(plan));
  sure(
    !/entity definitions/.test(all(maps.checkPlan(house(sound), { leak: false }))),
    "unasked, nothing is looked up",
  );

  const lost = against([
    ...sound,
    beast([480, 64, 16], {}, "smak_beast_tier1"),
    beast([480, 190, 16], {}, "smak_beast_tier1"),
  ]);
  sure(
    lost.errors.length === 1 &&
      /^1 classes are in none of the definitions given \(smakbase\.fgd, smakgame\.fgd\): a class the game does not have is dropped without a word: smak_beast_tier1 \(2 entities, the first is entity 8\)$/.test(
        lost.errors[0],
      ),
    lost.errors.join(" | "),
  );
  sure(maps.checkPlan(house([beast([480, 64, 16], {}, "smak_beast_tier1")]), { definitions: FGD, leak: false }).errors.length === 1, "an error of the plan"); // prettier-ignore

  // a compiled map: the kit's two rooms are sound, and an entity put into them is looked up the same
  const compiled = maps.checkBsp(tworoomsBytes, { definitions: FGD });
  sure(
    !compiled.errors.length && !compiled.warnings.length,
    `the two rooms: ${compiled.errors.concat(compiled.warnings).join(" | ")}`,
  );
  sure(/entity definitions: \d+ classes/.test(compiled.facts.join()), "and says what it went by");
  sure(
    !/entity definitions/.test(maps.checkBsp(tworoomsBytes).facts.join()),
    "unasked, nothing is looked up",
  );
  const changed = maps.withEntities(
    tworoomsBytes,
    maps.addEntity(tworooms.entities, "smak_wolf", [96, 96, 40]),
  );
  const found = maps.checkBsp(changed, { definitions: FGD });
  sure(
    /classes are in none of the definitions given.*smak_wolf \(entity 5\)/.test(found.errors.join()),
    found.errors.join(" | "),
  );
});

test("with definitions: a point class given brushes, a brush class given none, a key that is not defined, capitals", () => {
  const kinds = against([
    maps.brushEntity("smak_den", maps.box([400, 40, 16], [432, 72, 48], "AAATRIGGER"), {
      targetname: "lair",
    }),
    maps.pointEntity("trigger_once", [100, 100, 40]),
  ]);
  sure(said(kinds.warnings, /^1 entities of a point class are made of brushes: entity 3 \(smak_den\): a point entity in the definitions$/), kinds.warnings.join(" | ")); // prettier-ignore
  sure(said(kinds.warnings, /^1 entities of a brush class have no brush.*: entity 4 \(trigger_once\): made of brushes in the definitions$/), kinds.warnings.join(" | ")); // prettier-ignore
  // in a compiled map a brush entity is one whose model is *N
  const point = maps.setKey(tworooms.entities, 2, "model", "*1");
  sure(/entities of a point class are made of brushes: entity 2 \(light\)/.test(maps.checkEntities({ ...tworooms, entities: point }, { definitions: FGD }).warnings.join()), "a light with a brush model"); // prettier-ignore
  const noBrush = maps.removeKey(tworooms.entities, 4, "model");
  sure(/entities of a brush class have no brush.*entity 4 \(func_wall\)/.test(maps.checkEntities({ ...tworooms, entities: noBrush }, { definitions: FGD }).warnings.join()), "a func_wall with no model"); // prettier-ignore

  const keys = against([
    beast([480, 128, 16], { mood: "angry", health: 40 }),
    beast([480, 64, 16], { mood: "calm", Lives: 2 }),
    maps.pointEntity("Smak_Item", [100, 100, 40]),
  ]);
  // a key the engine reads for every entity (health) is no fault, whatever the class
  sure(
    said(
      keys.warnings,
      /^1 keys their class does not define: the game reads only the keys its code asks for.*: mood on smak_beast \(2 entities, the first is entity 3\)$/,
    ),
    keys.warnings.join(" | "),
  );
  sure(said(keys.warnings, /keys are written in other capitals than the definitions have them: Lives is lives \(entity 4 \(smak_beast\)\)/), keys.warnings.join(" | ")); // prettier-ignore
  sure(said(keys.warnings, /classes are written in other capitals.*: Smak_Item is smak_item \(entity 5 \(Smak_Item\)\)/), keys.warnings.join(" | ")); // prettier-ignore
  sure(!keys.errors.length && keys.warnings.length === 3, `and nothing else: ${all(keys)}`);
});

test("with definitions: a value that is not of its key's type, not among its choices, or a flag the class has not", () => {
  const sound = against([
    maps.light([100, 100, 100], { style: 2, spawnflags: 3 }),
    beast([480, 128, 16], { lives: 3, angles: [0, 90, 0] }),
    trigger("trigger_once", { delay: 1.5 }),
    beast([480, 64, 16], { lives: "" }),
  ]);
  sure(!sound.warnings.length && !sound.errors.length, `values of the right kind: ${all(sound)}`);
  const wrong = against([
    maps.light([100, 100, 100], { style: 7, spawnflags: 5, _light: "bright" }),
    beast([480, 128, 16], { lives: "many", angles: "north" }),
    trigger("trigger_once", { delay: "soon" }),
    beast([480, 64, 16], { lives: 1.5 }),
  ]);
  const values =
    wrong.warnings.find((sentence) => /^7 values are not of their key's kind/.test(sentence)) ?? "";
  for (const fault of [
    /entity 3 \(light\) _light "bright" is not a colour \(three numbers, or four\)/,
    /entity 3 \(light\) style "7" is none of its choices \(0, 1, 2\)/,
    /entity 3 \(light\) spawnflags "5" sets 4, which its class does not define/,
    /entity 4 \(smak_beast\) angles "north" is not an angle/,
    /entity 4 \(smak_beast\) lives "many" is not a whole number/,
    /entity 5 \(trigger_once\) delay "soon" is not a number/,
    /entity 6 \(smak_beast\) lives "1.5" is not a whole number/,
  ])
    sure(fault.test(values), `${fault}: ${wrong.warnings.join(" | ")}`);
});

test("names: a target that no entity is called is told, and a targetname nothing names is a fact and no warning", () => {
  const sound = against([
    den("lair", { whenempty: "bell" }),
    beast([480, 128, 16], { den: "lair", target: "bell", killtarget: "bell" }),
    maps.pointEntity("multi_manager", [100, 40, 40], { targetname: "bell", lair: 1 }),
  ]);
  sure(!sound.warnings.length, `every name answers: ${all(sound)}`);
  sure(!/targetnames that nothing/.test(sound.facts.join()), sound.facts.join(" | "));

  const lost = against([
    den("lair", { whenempty: "gong" }),
    beast([480, 128, 16], { target: "Bell", killtarget: "nobody", master: "lock" }),
    maps.pointEntity("multi_manager", [100, 40, 40], { targetname: "bell", lair: 1, cellar: 2, wait: 3 }),
    trigger("trigger_once", { target: "game_playerspawn" }),
    maps.pointEntity("smak_item", [100, 200, 40], { targetname: "spare" }),
  ]);
  const names =
    lost.warnings.find((sentence) => /name something no entity of the map is called/.test(sentence)) ?? "";
  sure(/^5 entities name something/.test(names), lost.warnings.join(" | "));
  for (const each of [
    /entity 3 \(smak_den\) whenempty gong/, // a key of the type target_destination
    /entity 4 \(smak_beast\) target Bell \(there is a bell: capitals count\)/,
    /entity 4 \(smak_beast\) killtarget nobody/,
    /entity 4 \(smak_beast\) master lock/, // a key every game reads as a name, whatever the FGD
    /entity 5 \(multi_manager\) fires cellar/, // a multi_manager's own keys are names; `wait` is its own
  ])
    sure(each.test(names), `${each}: ${names}`);
  // a name the game itself fires asks for no entity; a targetname nothing names is said, as a fact
  sure(!/game_playerspawn/.test(names) && !/fires wait/.test(names), names);
  sure(said(lost.facts, /^2 targetnames that nothing in the map names \(the game's code or a script may\): bell; spare$/), lost.facts.join(" | ")); // prettier-ignore
  sure(lost.warnings.length === 1 && !lost.errors.length, `one warning: ${lost.warnings.join(" | ")}`);
  // with no definitions at all, the names are still held against one another
  const bare = maps.checkEntities(house([beast([480, 128, 16], { target: "nobody" })]), {
    mod: maps.GOLDSRC,
  });
  sure(
    /target nobody/.test(bare.warnings.join()) && /no entity definitions were given/.test(bare.facts.join()),
    all(bare),
  );
});

// ── definitions learned from a mod's maps ──

/** A compiled map with the two rooms' own entities and `more`: `[classname, origin, keys]`. */
function mapWith(name, more) {
  let entities = tworooms.entities;
  for (const [classname, origin, keys] of more) entities = maps.addEntity(entities, classname, origin, keys);
  const file = join(inFolder("game/maps"), name);
  writeFileSync(file, maps.withEntities(tworoomsBytes, entities));
  return file;
}
mkdirSync(inFolder("game/maps"), { recursive: true });
const beasts = (count, keys) =>
  Array.from({ length: count }, (_, n) => ["smak_beast", [96 + n, 96, 40], keys]);
mapWith("first.bsp", [
  ...beasts(4, { den: "lair", lives: "1", script: "beasts/wolf" }),
  ["smak_den", [96, 96, 80], { targetname: "lair" }],
]);
mapWith("second.bsp", [
  ...beasts(3, { den: "pit", lives: "2", script: "beasts/boar", howl: "3", pitch: "90" }),
  ["smak_den", [96, 96, 80], { targetname: "pit" }],
  ["smak_owl", [96, 96, 90], {}],
]);
mapWith("third.bsp", [
  ...beasts(2, { den: "pit", lives: "0", script: "beasts/wolf", howl: "1", pitch: "100" }),
]);
writeFileSync(inFolder("game/maps/notes.bsp"), "not a map at all, only named like one");
const MAPS = inFolder("game/maps");

test("a mod's own maps teach its classes: how often, point or brush, each key with its values, the keys that go together", () => {
  const learned = maps.learnEntities(MAPS);
  sure(
    learned.maps === 3 && learned.skipped.join() === "notes.bsp",
    `${learned.maps} maps, skipped ${learned.skipped.join()}`,
  );
  sure(!learned.fgd && /^3 maps of .*game\/maps$/.test(learned.from[0]), learned.from.join());
  const { smak_beast: one, func_wall: wall, light, smak_owl: owl } = learned.classes;
  sure(
    one.seen === 9 && one.maps === 3 && one.point === 9 && one.solid === 0 && one.kind === "point",
    JSON.stringify(one),
  );
  sure(wall.kind === "solid" && wall.solid === 3 && light.seen === 6, "a brush class; two lights a map");
  sure(owl.seen === 1 && owl.maps === 1 && owl.in.join() === "second", JSON.stringify(owl));
  sure(one.always.join() === "den,lives,origin,script", `what every beast gives: ${one.always.join()}`);
  sure(
    JSON.stringify(one.together) === '[["howl","pitch"]]',
    `the keys that go together: ${JSON.stringify(one.together)}`,
  );
  const { lives, script, den: denKey } = one.keys;
  sure(
    lives.seen === 9 && lives.whole === 9 && lives.numbers === 9 && lives.distinct === 3,
    JSON.stringify(lives),
  );
  sure(JSON.stringify(lives.values[0]) === '["1",4]' && script.whole === 0, "the commonest value first");
  sure(
    JSON.stringify(script.values) === '[["beasts/wolf",6],["beasts/boar",3]]',
    JSON.stringify(script.values),
  );
  sure(denKey.maps === 3 && one.keys.howl.maps === 2, "in how many maps a key is given");
  sure(JSON.stringify(learned) === JSON.stringify(JSON.parse(JSON.stringify(learned))), "plain data");

  // a list of files; a map left out; what is neither a folder nor a list
  sure(maps.learnEntities([join(MAPS, "first.bsp")]).classes.smak_beast.seen === 4, "one map by its file");
  const without = maps.learnEntities(MAPS, { except: ["second.bsp"] });
  sure(
    without.maps === 2 && !without.classes.smak_owl && without.classes.smak_beast.seen === 6,
    "a map left out",
  );
  sure(
    refuses(() => maps.learnEntities(7), /the folder of a mod's \.bsp files, or a list/) === true,
    "a number",
  );
  // a mod's overlay of models and scripts given first (map-viewer --game) has no maps/ of its own
  sure(maps.learnEntities(join(MAPS, "no-such-folder")).maps === 0, "a folder that is not there: no maps, not a fault");
  sure(
    maps.entitiesOfFile(join(MAPS, "first.bsp")).length === tworooms.entities.length + 5,
    "one map's entities, fast",
  );
  sure(maps.entitiesOfFile(join(MAPS, "notes.bsp")) === null, "what is no map");
});

test("what was learned is kept in a file, and read again until a map of the folder changes", () => {
  const cache = inFolder("learned.json");
  const first = maps.learnEntities(MAPS, { cache });
  const kept = JSON.parse(readFileSync(cache, "utf8"));
  sure(kept.maps === 3 && kept.classes.smak_beast.seen === 9, "the file holds what was learned");
  // the file is what is read: a mark put into it comes back
  writeFileSync(cache, JSON.stringify({ ...kept, mark: "from the file" }));
  sure(maps.learnEntities(MAPS, { cache }).mark === "from the file", "read from the file, the maps not read");
  // a map changes: learned again, and the file written over
  mapWith("third.bsp", [...beasts(5, { den: "pit", lives: "0", script: "beasts/wolf" })]);
  const later = new Date(Date.now() + 5000);
  utimesSync(join(MAPS, "third.bsp"), later, later);
  const again = maps.learnEntities(MAPS, { cache });
  sure(
    again.mark === undefined && again.classes.smak_beast.seen === 12,
    `learned again: ${again.classes.smak_beast.seen}`,
  );
  sure(
    first.classes.smak_beast.seen === 9 &&
      JSON.parse(readFileSync(cache, "utf8")).classes.smak_beast.seen === 12,
    "and kept",
  );
  // a file that is no cache is learned over
  writeFileSync(cache, "{ not json");
  sure(maps.learnEntities(MAPS, { cache }).classes.smak_beast.seen === 12, "a broken file is no cache");
});

test("learned definitions stand in for an FGD, more weakly: never seen in any of the mod's maps is a warning", () => {
  const learned = maps.learnEntities(MAPS);
  const withLearned = (entities) => maps.checkEntities(house(entities), { definitions: learned });
  const sound = withLearned([
    beast([480, 128, 16], { den: "lair", lives: 2, script: "beasts/wolf" }),
    den("lair"),
  ]);
  sure(!sound.errors.length && !sound.warnings.length, `what the maps do: ${all(sound)}`);

  const strange = withLearned([
    beast([480, 128, 16], { den: "lair", lives: "many", mood: "angry" }),
    beast([480, 64, 16], {}, "smak_beast_tier1"),
    maps.pointEntity("smak_owl", [100, 100, 40], { hoot: 1 }),
    maps.brushEntity("smak_beast", maps.box([400, 40, 16], [432, 72, 48], "WALL"), { den: "lair" }),
    den("lair"),
  ]);
  sure(!strange.errors.length, `nothing learned is an error: ${strange.errors.join(" | ")}`);
  sure(said(strange.warnings, /^1 classes were never seen in any of the mod's 3 maps: a class the game does not have is dropped without a word: smak_beast_tier1 \(entity 4\)$/), strange.warnings.join(" | ")); // prettier-ignore
  sure(said(strange.warnings, /^1 keys were never seen on their class in any of the mod's 3 maps.*: mood on smak_beast \(which the maps have 12 times\) \(entity 3\)$/), strange.warnings.join(" | ")); // prettier-ignore
  sure(said(strange.warnings, /values are not of their key's kind: entity 3 \(smak_beast\) lives "many" is not a number, and it is one every one of the 12 times the mod's maps give it/), strange.warnings.join(" | ")); // prettier-ignore
  sure(said(strange.warnings, /entities of a point class are made of brushes: entity 6 \(smak_beast\): a point entity every one of the 12 times the mod's maps have it/), strange.warnings.join(" | ")); // prettier-ignore
  // a class the maps have once says too little for its keys to be held against a map
  sure(!/hoot/.test(strange.warnings.join()), "a key of a class seen once is not told");
});

test("an FGD and the maps side by side: what the FGD forgets and the maps give is no fault, nor a type the maps contradict", () => {
  const learned = maps.learnEntities(MAPS);
  const both = maps.joinDefinitions(maps.definitionsOf(FGD), learned);
  sure(both.fgd && both.maps === 3 && both.from.length === 3, JSON.stringify(both.from));
  const one = both.classes.smak_beast;
  sure(
    one.defined && one.kind === "point" && one.seen === 12 && one.size.maxs[2] === 72,
    "the FGD's class with the maps' count",
  );
  sure(
    one.keys.lives.type === "integer" && one.keys.lives.seen === 12 && !one.keys.howl.defined,
    "a key of both, and one of the maps alone",
  );

  const entities = [
    beast([480, 128, 16], { den: "lair", howl: 2, mood: "angry", strength: "0;150" }),
    maps.pointEntity("smak_owl", [100, 100, 40]),
    beast([480, 64, 16], {}, "smak_beast_tier1"),
    den("lair"),
  ];
  // the FGD alone: howl is a key it does not have, and the owl a class it does not have
  const alone = maps.checkEntities(house(entities), { definitions: FGD });
  sure(/howl on smak_beast/.test(alone.warnings.join()) && /smak_owl/.test(alone.errors.join()), all(alone));
  sure(/strength "0;150" is not a whole number/.test(alone.warnings.join()), "the FGD's type is held to");
  // with the maps: howl is given by the mod's own maps; the owl is in one of them
  const beside = maps.checkEntities(house(entities), { definitions: [FGD, learned] });
  sure(
    !/howl/.test(beside.warnings.join()) && /mood on smak_beast/.test(beside.warnings.join()),
    beside.warnings.join(" | "),
  );
  sure(
    said(beside.warnings, /keys their class does not define, nor has in any of the mod's 3 maps/),
    beside.warnings.join(" | "),
  );
  sure(
    /smak_beast_tier1/.test(beside.errors.join()) && !/smak_owl/.test(beside.errors.join()),
    beside.errors.join(" | "),
  );
  sure(
    said(beside.facts, /^1 classes are in no FGD given and in the mod's maps: smak_owl$/),
    beside.facts.join(" | "),
  );

  // maps that write the strength as from;to: the FGD's "whole number" is the one that is wrong
  mkdirSync(inFolder("bands/maps"), { recursive: true });
  let banded = tworooms.entities;
  for (let n = 0; n < 12; n++)
    banded = maps.addEntity(banded, "smak_beast", [96 + n, 96, 40], { strength: n % 3 ? "150;500" : "0" });
  writeFileSync(inFolder("bands/maps/banded.bsp"), maps.withEntities(tworoomsBytes, banded));
  const contradicted = maps.checkEntities(house(entities), {
    definitions: [FGD, maps.learnEntities(inFolder("bands/maps"))],
  });
  sure(
    !/strength/.test(contradicted.warnings.join()),
    `the maps do the same: ${contradicted.warnings.join(" | ")}`,
  );
});

// ── the game's own program ──

/** A Windows library (PE32) that exports these names and nothing else, built here byte by byte. */
function tinyDll(names) {
  const FILE_AT = 0x200;
  const ADDRESS = 0x1000;
  const table = 40;
  let at = table + names.length * 4;
  const offsets = names.map((name) => {
    const here = at;
    at += name.length + 1;
    return here;
  });
  const data = Buffer.alloc(at);
  data.writeUInt32LE(names.length, 24); // NumberOfNames
  data.writeUInt32LE(ADDRESS + table, 32); // AddressOfNames
  names.forEach((name, index) => {
    data.writeUInt32LE(ADDRESS + offsets[index], table + index * 4);
    data.write(name, offsets[index], "latin1");
  });
  const head = Buffer.alloc(FILE_AT);
  head.write("MZ", 0, "latin1");
  head.writeUInt32LE(0x40, 0x3c);
  head.writeUInt32LE(0x00004550, 0x40); // PE\0\0
  head.writeUInt16LE(0x14c, 0x44); // machine: i386
  head.writeUInt16LE(1, 0x46); // one section
  head.writeUInt16LE(224, 0x54); // the optional header's size
  const optional = 0x58;
  head.writeUInt16LE(0x10b, optional); // PE32
  head.writeUInt32LE(ADDRESS, optional + 96); // the export directory
  head.writeUInt32LE(data.length, optional + 100);
  const section = optional + 224;
  head.write(".rdata", section, "latin1");
  head.writeUInt32LE(data.length, section + 8);
  head.writeUInt32LE(ADDRESS, section + 12);
  head.writeUInt32LE(data.length, section + 16);
  head.writeUInt32LE(FILE_AT, section + 20);
  return Buffer.concat([head, data]);
}

test("the game's own program says which classes exist: a class it does not export is an error, one it does is none", () => {
  const classes = [
    "worldspawn",
    "info_player_start",
    "light",
    "smak_beast",
    "smak_den",
    "smak_lynx",
    "func_wall",
  ];
  const dll = tinyDll([...classes, "GiveFnptrsToDll", "GetEntityAPI2", "?Think@CBeast@@UAEXXZ"]);
  sure(maps.classesOfDll(dll).join() === [...classes].sort().join(), maps.classesOfDll(dll).join());
  sure(
    refuses(
      () => maps.classesOfDll(Buffer.from("\x7fELF and so on, a Linux library".padEnd(80))),
      /a Linux library \(ELF\), which is not read/,
    ) === true,
    "an .so",
  );
  sure(
    refuses(() => maps.classesOfDll(Buffer.alloc(200)), /it does not begin with MZ/) === true,
    "no library",
  );
  mkdirSync(inFolder("game/dlls"), { recursive: true });
  writeFileSync(inFolder("game/dlls/smak.dll"), dll);

  const program = maps.definitionsOfDll(inFolder("game/dlls/smak.dll"));
  sure(
    program.program &&
      program.classes.smak_lynx.exists &&
      program.from.join() === "the game's program smak.dll",
    JSON.stringify(program.from),
  );
  const entities = [
    beast([480, 128, 16], { den: "lair" }),
    beast([480, 64, 16], {}, "smak_lynx"), // in the program, and in no FGD
    beast([480, 190, 16], {}, "smak_bigbeast"), // in the FGD, and not in the program
    beast([400, 190, 16], {}, "Smak_Den"),
    den("lair"),
  ];
  const mod = { name: "smakgame", dlls: [inFolder("game/dlls/smak.dll")], fgd: [FGD] };
  const found = maps.checkEntities(house(entities), { mod });
  sure(
    found.errors.length === 1 &&
      /^2 classes are not in the game's own program \(the game's program smak\.dll\): the game cannot make such an entity, and drops it without a word: smak_bigbeast \(entity 5\); Smak_Den \(the program has smak_den\) \(entity 6\)$/.test(
        found.errors[0],
      ),
    found.errors.join(" | "),
  );
  sure(said(found.facts, /^1 classes are in the game's program and in no FGD or map given, so their keys were not looked up: smak_lynx$/), found.facts.join(" | ")); // prettier-ignore
  // the FGD alone has it the other way round, and is wrong both times
  const byFgd = maps.checkEntities(house(entities), { definitions: FGD });
  sure(
    /smak_lynx/.test(byFgd.errors.join()) && !/smak_bigbeast/.test(byFgd.errors.join()),
    byFgd.errors.join(" | "),
  );
});

// ── profiles ──

/** The made-up game's profile: what a mod's own is, written as its user would write it. */
const ITEMS = ["key", "apple"];
const SCRIPTS = ["beasts/wolf", "beasts/boar", "items/key", "items/apple"];
const BEASTS = ["smak_beast", "smak_bigbeast"];
const smakGame = (more = {}) => ({
  name: "smakgame",
  fgd: [FGD],
  starts: ["smak_start", "smak_arrive"],
  walkers: ["smak_*beast"],
  doors: [...maps.GOLDSRC.doors, "smak_shutter"],
  off: ["off_*"],
  // the FGD writes a beast's strength as a whole number, and the game reads from;to
  classes: {
    smak_beast: { keys: { strength: { type: "string" } } },
    smak_bigbeast: { keys: { strength: { type: "string" } } },
  },
  rules: [
    { rule: "limit", key: "den", most: 32, to: ["smak_den"], why: "a den holds 32 beasts" },
    {
      rule: "beside",
      classes: BEASTS,
      key: "strength",
      needs: "den",
      unless: ["", "0"],
      why: "strength is read only through a den",
    },
    {
      rule: "bands",
      classes: BEASTS,
      key: "strength",
      among: ["den", "origin"],
      whole: true,
      words: ["avg"],
      why: "one beast for each strength of party",
    },
    {
      rule: "finite",
      classes: ["smak_den"],
      when: "whenempty",
      counted: "den",
      count: "lives",
      why: "a beast with no lives never runs out",
    },
    {
      rule: "names",
      classes: ["smak_arrive"],
      key: "message",
      required: true,
      of: { classes: ["*smak_gate"] },
      what: "the targetname of a gate of this map",
      why: "a player arrives where the gate he came by is named",
    },
    {
      rule: "names",
      classes: ["smak_item"],
      key: "script",
      among: (name) =>
        ITEMS.includes(name) ||
        (SCRIPTS.includes(name) ? `an item is named without its folder: ${name.split("/").pop()}` : false),
      what: "an item's name",
      why: "a smak_item's script is an item's name",
    },
    {
      rule: "names",
      classes: BEASTS,
      key: "script",
      among: (name) => SCRIPTS.includes(name),
      what: "a script of the game",
    },
  ],
  ...more,
});

test("the kit's own profile is Half-Life's and no mod's; a mod's profile is filled up from it; a wrong one is refused", () => {
  const { GOLDSRC } = maps;
  sure(
    GOLDSRC.starts.join() === "info_player_start,info_player_deathmatch" &&
      GOLDSRC.walkers.join() === "monster_*",
    "Half-Life's starts",
  );
  sure(!/ms_|msmonster|mastersword|sc\.dll/i.test(JSON.stringify(GOLDSRC)), "nothing of one mod is in it");
  sure(
    !GOLDSRC.rules.length && !GOLDSRC.fgd.length && !GOLDSRC.folders.length,
    "nor a rule, a file or a folder",
  );
  sure(
    Object.isFrozen(GOLDSRC) && Object.isFrozen(GOLDSRC.starts) && Object.isFrozen(GOLDSRC.hulls.large),
    "and it cannot be changed",
  );
  sure(
    GOLDSRC.hulls.large.half === 32 &&
      GOLDSRC.hulls.standing.height === 72 &&
      GOLDSRC.origin.starts === "middle",
    "the engine's hulls",
  );

  const whole = maps.modOf(smakGame());
  sure(
    whole.starts.join() === "smak_start,smak_arrive" && whole.engineKeys === GOLDSRC.engineKeys,
    "its own, and the rest Half-Life's",
  );
  sure(
    whole.origin.walkers === "feet" &&
      whole.targets.keys.includes("killtarget") &&
      whole.hulls.large.half === 32,
    "the parts of a part too",
  );
  sure(maps.modOf(undefined) === null && maps.modOf(whole) === whole, "none is none; a whole one is itself");
  sure(
    refuses(() => maps.modOf("goldsrc"), /mod: a profile, an object such as maps\.GOLDSRC/) === true,
    "a name for a profile",
  );
  sure(
    refuses(() => maps.modOf({ starts: "smak_start" }), /mod: starts is a list/) === true,
    "a word for a list",
  );
  sure(refuses(() => maps.checkEntities(house(), { mod: { rules: [{ rule: "wish" }] } }), /a rule is a function or \{ rule: limit \| beside \| bands \| finite \| names \}, not "wish"/) === true, "a rule of no kind"); // prettier-ignore
  sure(
    maps.isNamed(["smak_*beast", "ms_npc"], "smak_bigbeast") &&
      !maps.isNamed(["smak_*beast"], "smak_beastly"),
    "names with * for any letters",
  );

  // its definitions: the FGD's, with the class it wrote by hand over the FGD's
  const definitions = maps.definitionsFor(smakGame());
  sure(
    definitions.classes.smak_beast.keys.strength.type === "string" &&
      definitions.classes.smak_beast.keys.lives.type === "integer",
    "one key mended, the rest kept",
  );
  sure(
    definitions.classes.smak_beast.size.maxs[2] === 72 && definitions.from.at(-1) === "the profile smakgame",
    definitions.from.join(),
  );
});

test("with a profile the plan check asks for the mod's starts; with none it counts what it counted before", () => {
  const mod = smakGame();
  const own = house([], { start: "smak_start" });
  const plan = maps.checkPlan(own, { mod, leak: false });
  sure(!plan.errors.length && /places to start: 1 smak_start/.test(plan.facts.join()), all(plan));
  // Half-Life's start is no start of this mod, and the mod's is none of Half-Life's
  const other = maps.checkPlan(house(), { mod, leak: false });
  sure(/^no smak_start or smak_arrive: the player would start at 0 0 0.*give the mod's profile \(the mod option\) or its own start classes/.test(other.errors.join()), other.errors.join(" | ")); // prettier-ignore
  sure(
    /^no info_player_start or info_player_deathmatch:/.test(
      maps.checkPlan(own, { mod: maps.GOLDSRC, leak: false }).errors.join(),
    ),
    "Half-Life's profile asks for Half-Life's",
  );
  sure(
    !maps.checkPlan(own, { mod, starts: [], leak: false }).errors.length,
    "what is given by name stands over the profile",
  );
  // no profile: the classes 0.9.0 counted, Master Sword's two among them
  const before = maps.checkPlan(house([], { start: "ms_player_begin" }), { leak: false });
  sure(!before.errors.length && /places to start: 1 ms_player_begin/.test(before.facts.join()), all(before));
  sure(
    /^no info_player_start or info_player_deathmatch or ms_player_begin or ms_player_spawn/.test(
      maps.checkPlan(own, { leak: false }).errors.join(),
    ),
    "and asks for those",
  );
  // the profile's .wad files give the textures' names
  const wad = join(FIXTURES, "tworooms.wad");
  const worn = maps.checkPlan(own, { mod: smakGame({ wads: [wad] }), leak: false });
  sure(/3 textures are in none of the \.wad files given/.test(worn.errors.join()), worn.errors.join(" | "));
});

test("a profile gives each class its box, from the FGD's size: the walk test and the pictures go by it", () => {
  const mod = smakGame();
  const bodies = maps.bodiesOf(mod, ["smak_start", "smak_beast", "smak_bigbeast", "light", "monster_zombie"]);
  sure(
    JSON.stringify(bodies.smak_start) === '{"half":16,"height":72,"feet":36}',
    JSON.stringify(bodies.smak_start),
  );
  sure(
    JSON.stringify(bodies.smak_beast) === '{"half":16,"height":72,"feet":0}',
    JSON.stringify(bodies.smak_beast),
  );
  sure(
    JSON.stringify(bodies.smak_bigbeast) === '{"half":32,"height":64,"feet":0}',
    JSON.stringify(bodies.smak_bigbeast),
  );
  sure(!bodies.light && !bodies.monster_zombie, "what neither starts nor walks in this mod has no box");
  // a box of a hull's size is walked as that hull
  const big = maps.bodyFor("smak_bigbeast", undefined, bodies);
  sure(big.body.name === "large" && big.body.hull === 2 && big.feet === 0, JSON.stringify(big));
  sure(
    maps.bodyFor("smak_start", undefined, bodies).body.name === "standing" &&
      maps.bodyFor("smak_start", undefined, bodies).feet === 36,
    "a start's origin is its middle",
  );
  // with no size, the profile's `bodies` and `origin` say
  const told = maps.bodiesOf(
    { walkers: ["crab_*"], bodies: { crab_king: "large" }, origin: { walkers: "middle" } },
    ["crab_king", "crab_small"],
  );
  sure(
    JSON.stringify(told) ===
      '{"crab_king":{"half":32,"height":64,"feet":32},"crab_small":{"half":16,"height":72,"feet":36}}',
    JSON.stringify(told),
  );
  sure(
    maps.bodiesOf(maps.GOLDSRC, ["monster_gargantua"]).monster_gargantua.half === 32,
    "Half-Life's large monsters",
  );

  // the walk: from the mod's start, to a beast that stands in the study
  const map = house([beast([480, 128, 16]), beast([480, 190, 100], {}, "smak_bigbeast")], {
    start: "smak_start",
  });
  const blind = maps.reachOf(map);
  sure(
    /no place to start \(info_player_start,/.test(blind.warnings.join()) && !blind.starts.length,
    "with no profile it is not a start",
  );
  const reach = maps.reachOf(map, { mod });
  sure(
    reach.starts.length === 1 && reach.starts[0].classname === "smak_start" && reach.starts[0].floor === 0,
    JSON.stringify(reach.starts),
  );
  const reached = reach.entities.find((entity) => entity.classname === "smak_beast");
  sure(reached?.reached && reached.how === "walk", JSON.stringify(reached));
  // the large beast's box is 64 high from its feet at 100: its head is in the study's ceiling at 144
  sure(
    reach.stuck.some((entity) => entity.classname === "smak_bigbeast"),
    `the large beast does not fit: ${reach.warnings.join(" | ")}`,
  );
  sure(
    !maps.reachOf(map, { mod, bodies: { smak_bigbeast: "crouching" } }).stuck.length,
    "what is given by name stands over the profile",
  );

  // the classes that open: a shutter in the doorway is open with the profile, a wall without
  const shutter = maps.brushEntity("smak_shutter", maps.box([328, 96, 16], [344, 160, 112], "WALL"), {
    targetname: "gate",
  });
  const shut = house([beast([480, 128, 16]), shutter], { start: "smak_start" });
  const through = maps.reachOf(shut, { mod });
  sure(
    through.entities.find((entity) => entity.classname === "smak_beast").reached,
    "the shutter is taken as open",
  );
  sure(
    /1 doors were taken as open: 4 smak_shutter "gate"/.test(through.facts.join()),
    through.facts.join(" | "),
  );
  sure(
    !maps.reachOf(shut, { mod, doors: "closed" }).entities.find((entity) => entity.classname === "smak_beast")
      .reached,
    "and as a wall with the doors closed",
  );
  sure(
    !maps
      .reachOf(shut, { mod: { ...mod, doors: [] } })
      .entities.find((entity) => entity.classname === "smak_beast").reached,
    "and for a mod in which it does not open",
  );

  // the pictures: a plan marks the beasts with their boxes
  const picture = maps.planOfSource(map, { mod, width: 320, height: 240 });
  const drawn = picture.facts.marks.find((mark) => mark.classname === "smak_bigbeast");
  sure(drawn?.size === "64 x 64 x 64", `a large beast's box on the plan: ${JSON.stringify(drawn)}`);
  const plain = maps
    .planOfSource(map, { width: 320, height: 240 })
    .facts.marks.find((mark) => mark.classname === "smak_bigbeast");
  sure(!plain?.size, `and none without the profile: ${JSON.stringify(plain)}`);
});

// ── rules ──

test("a profile's rules: a sound map of the mod says nothing", () => {
  const sound = house(
    [
      den("lair", { whenempty: "bell" }),
      ...[0, 1, 2].map((band) =>
        beast([480, 128, 16], {
          den: "lair",
          lives: 1,
          script: "beasts/wolf",
          strength: ["0;150", "150;500", "500"][band],
        }),
      ),
      beast([480, 190, 16], { den: "lair", lives: 2, script: "beasts/boar", strength: 0 }),
      beast([420, 190, 16], { script: "beasts/boar", strength: 0 }),
      maps.pointEntity("smak_arrive", [96, 64, 36], { message: "from_town" }),
      maps.brushEntity("off_smak_gate", maps.box([8, 96, 0], [16, 160, 96], "AAATRIGGER"), {
        targetname: "from_town",
        destmap: "town",
      }),
      maps.pointEntity("smak_item", [100, 200, 40], { targetname: "bell", script: "key" }),
    ],
    { start: "smak_start", worldspawn: { wad: ["smak.wad"] } },
  );
  const found = maps.checkPlan(sound, { mod: smakGame(), leak: false });
  sure(
    !found.errors.length && !found.warnings.length,
    `the mod's own way: ${found.errors.concat(found.warnings).join(" | ")}`,
  );
  sure(
    said(found.facts, /^1 entities are switched off by their classname: 1 off_smak_gate$/),
    found.facts.join(" | "),
  );
  // without the profile the switched-off gate is a class that does not exist
  sure(
    /off_smak_gate/.test(maps.checkEntities(sound, { definitions: FGD }).errors.join()),
    "the profile says it is switched off on purpose",
  );
});

test("the five faults of the first map drafted with the kit, which nothing caught, are each told", () => {
  const mod = smakGame();
  const told = (entities) => maps.checkPlan(house(entities, { start: "smak_start" }), { mod, leak: false });

  // 1. three classes that do not exist in the mod
  const classes = told(
    ["smak_beast_tier1", "smak_beast_tier2", "smak_beast_tier3"].map((classname, n) =>
      beast([420 + n * 40, 128, 16], {}, classname),
    ),
  );
  sure(/^3 classes are in none of the definitions given.*smak_beast_tier1 \(entity 3\); smak_beast_tier2 \(entity 4\); smak_beast_tier3 \(entity 5\)$/.test(classes.errors.join()), classes.errors.join(" | ")); // prettier-ignore

  // 2. a key where the game never reads it: a strength on a beast that names no den
  const beside = told([beast([480, 128, 16], { strength: "150;500", script: "beasts/wolf" })]);
  sure(said(beside.warnings, /^1 entities give strength with no den beside it \(strength is read only through a den\): entity 3 \(smak_beast\) strength "150;500"$/), beside.warnings.join(" | ")); // prettier-ignore

  // 3. a spawn point with no message
  const arrive = told([
    maps.pointEntity("smak_arrive", [96, 64, 36]),
    maps.pointEntity("smak_arrive", [96, 190, 36], { message: "from_nowhere" }),
  ]);
  sure(said(arrive.warnings, /^1 entities have no message \(a player arrives where the gate he came by is named\): entity 3 \(smak_arrive\)$/), arrive.warnings.join(" | ")); // prettier-ignore
  sure(said(arrive.warnings, /^1 entities give a message that is not the targetname of a gate of this map \(.*\): entity 4 \(smak_arrive\) message "from_nowhere"$/), arrive.warnings.join(" | ")); // prettier-ignore

  // 4. an item named by its script's path, where the game wants the item's name
  const item = told([
    maps.pointEntity("smak_item", [100, 200, 40], { script: "items/key" }),
    maps.pointEntity("smak_item", [100, 60, 40], { script: "crown" }),
  ]);
  sure(
    said(
      item.warnings,
      /^2 entities give a script that is not an item's name \(a smak_item's script is an item's name\): entity 3 \(smak_item\) script "items\/key": an item is named without its folder: key; entity 4 \(smak_item\) script "crown"$/,
    ),
    item.warnings.join(" | "),
  );

  // 5. 39 monsters in an area that holds 32
  const crowd = (count) => [
    den("lair"),
    ...Array.from({ length: count }, (_, n) =>
      beast([380 + (n % 13) * 16, 40 + Math.floor(n / 13) * 60, 16], { den: "lair", script: "beasts/wolf" }),
    ),
  ];
  const full = told(crowd(39));
  sure(said(full.errors, /^1 entities are named by more others than they take \(a den holds 32 beasts\): the smak_den lair is named by the den of 39 entities, and takes 32$/), full.errors.join(" | ")); // prettier-ignore
  sure(!told(crowd(32)).errors.length, `32 is what it holds: ${told(crowd(32)).errors.join(" | ")}`);
  // a name 39 entities share that is no den's is no den's limit
  sure(!told(crowd(39).slice(1)).errors.length, "the limit is the den's");
});

test("a profile's rules: ranges that must meet and not overlap, a count that must end, a name that must exist", () => {
  const mod = smakGame();
  const told = (entities) => maps.checkEntities(house(entities, { start: "smak_start" }), { mod });
  const banded = (ranges, at = [480, 128, 16]) => [
    den("lair"),
    ...ranges.map((strength) => beast(at, { den: "lair", lives: 1, strength })),
  ];

  for (const meeting of [
    ["0;150", "150;500", "500"],
    ["1;200", "201;400", "401"],
    ["500", "0;150", "150;500"],
    ["0;150;avg", "150"],
    ["0;150", "0;150"],
  ])
    sure(
      !told(banded(meeting)).warnings.length,
      `${meeting.join(" ")} meet: ${told(banded(meeting)).warnings.join(" | ")}`,
    );
  const gap = told(banded(["0;150", "200;500", "500"]));
  sure(said(gap.warnings, /^1 places have strength ranges that do not meet, or overlap \(one beast for each strength of party\): at lair \| 480 128 16: nothing has 150 to 200, between 0;150 and 200;500 \(entity 5 \(smak_beast\)\)$/), gap.warnings.join(" | ")); // prettier-ignore
  const overlap = told(banded(["0;300", "150;500"]));
  sure(said(overlap.warnings, /at lair \| 480 128 16: 0;300 and 150;500 overlap \(entity 4 \(smak_beast\), entity 5 \(smak_beast\)\)$/), overlap.warnings.join(" | ")); // prettier-ignore
  const noRange = told(banded(["strong", "500;100"]));
  sure(said(noRange.warnings, /^2 entities give a strength that is no range \(from;to, or from\).*strength "strong"; entity 5 \(smak_beast\) strength "500;100"$/), noRange.warnings.join(" | ")); // prettier-ignore
  // beasts at different places are different beasts: their ranges owe one another nothing
  sure(
    !told([...banded(["0;150"]), beast([480, 190, 16], { den: "lair", lives: 1, strength: "300" })]).warnings
      .length,
    "another place",
  );

  // a den that waits for its beasts to be gone, and a beast that never is
  const waits = (lives) => [
    den("lair", { whenempty: "bell" }),
    maps.pointEntity("smak_item", [100, 200, 40], { targetname: "bell" }),
    ...lives.map((each, n) =>
      beast([420 + n * 40, 128, 16], { den: "lair", ...(each === null ? {} : { lives: each }) }),
    ),
  ];
  sure(
    !told(waits([1, 2, 3])).warnings.length,
    `every beast has its lives: ${told(waits([1, 2, 3])).warnings.join(" | ")}`,
  );
  const endless = told(waits([1, null, 0]));
  sure(said(endless.warnings, /^1 entities wait for others that never run out \(a beast with no lives never runs out\): the smak_den lair \(whenempty bell\): 2 of the 3 that name it have no lives over 0, the first entity 6 \(smak_beast\) with no lives$/), endless.warnings.join(" | ")); // prettier-ignore
  // a den that waits for nothing asks nothing of its beasts
  sure(
    !told([den("lair"), beast([480, 128, 16], { den: "lair" })]).warnings.length,
    "no whenempty, no count",
  );

  // a name that must exist: a script of the game
  const script = told([
    beast([480, 128, 16], { script: "beasts/dragon" }),
    beast([480, 190, 16], { script: "beasts/wolf" }),
  ]);
  sure(said(script.warnings, /^1 entities give a script that is not a script of the game: entity 3 \(smak_beast\) script "beasts\/dragon"$/), script.warnings.join(" | ")); // prettier-ignore

  // a rule that is a function, for what no kind covers; its level is its own
  const own = (entities) =>
    entities
      .filter((entity) => entity.classname === "smak_item" && !entity.get("script"))
      .map((entity) => ({ level: "error", text: `${entity.named} is an item of nothing` }));
  const byFunction = maps.checkEntities(
    house([maps.pointEntity("smak_item", [100, 200, 40])], { start: "smak_start" }),
    { mod: smakGame({ rules: [own, () => ["a plain word is a warning"]] }) },
  );
  sure(
    byFunction.errors.join() === "entity 3 (smak_item) is an item of nothing" &&
      byFunction.warnings.join() === "a plain word is a warning",
    all(byFunction),
  );
});

// ── the files entities name ──

const GAME = inFolder("files/smakgame");
const VALVE = inFolder("files/valve");
for (const file of [
  [GAME, "models/smak/beast.mdl"],
  [GAME, "models/smak/Walker.mdl"],
  [GAME, "sprites/smak/glow.spr"],
  [GAME, "music/calm.mp3"],
  [GAME, "town.wad"],
  [VALVE, "sound/ambience/wind.wav"],
  [VALVE, "models/tree.mdl"],
  ...["up", "dn", "lf", "rt", "ft", "bk"].map((side) => [GAME, `gfx/env/dusk${side}.tga`]),
  ...["up", "dn", "lf", "rt", "ft"].map((side) => [VALVE, `gfx/env/noon${side}.bmp`]),
]) {
  mkdirSync(join(file[0], file[1], ".."), { recursive: true });
  writeFileSync(join(...file), "x");
}

test("the files entities name are looked for in the game's folders, in the very letters a server on Linux would", () => {
  const folders = [GAME, VALVE];
  const things = (keys, worldspawn = { skyname: "dusk", wad: ["C:/somewhere/town.wad"] }) =>
    maps.checkEntities(
      house(
        Object.entries(keys).map(([classname, own], n) =>
          maps.pointEntity(classname, [100 + n * 20, 100, 40], own),
        ),
        { worldspawn },
      ),
      { definitions: FGD, folders },
    );
  const sound = things({
    env_thing: { model: "models/smak/beast.mdl", glow: "sprites/smak/glow.spr" },
    ambient: { message: "*ambience/wind.wav" },
    smak_beast: { model: "models\\tree.mdl" },
  });
  sure(!sound.warnings.length && !sound.errors.length, `every file is there: ${all(sound)}`);
  sure(said(sound.facts, /^files the entities name, looked for in 2 folders: 6 sky pictures, 1 \.wad files, 2 models, 1 sprites, 1 sounds$/), sound.facts.join(" | ")); // prettier-ignore

  const lost = things(
    {
      env_thing: { model: "models/smak/wolf.mdl", glow: "sprites/smak/halo.spr" },
      ambient: { message: "ambience/rain.wav" },
      smak_item: { script: "!SENTENCE.wav" },
    },
    { skyname: "noon", wad: "\\maps\\town.wad;\\maps\\hills.wad" },
  );
  sure(said(lost.warnings, /^1 models are in none of the game's folders given \(.*\): models\/smak\/wolf\.mdl \(entity 3 \(env_thing\)\)$/), lost.warnings.join(" | ")); // prettier-ignore
  sure(
    said(lost.warnings, /^1 sprites are in none.*: sprites\/smak\/halo\.spr \(entity 3 \(env_thing\)\)$/),
    lost.warnings.join(" | "),
  );
  sure(
    said(lost.warnings, /^1 sounds are in none.*: ambience\/rain\.wav \(entity 4 \(ambient\)\)$/),
    lost.warnings.join(" | "),
  );
  sure(
    said(lost.warnings, /^1 sky pictures are in none.*: noonbk \(entity 0 \(worldspawn\)\)$/),
    lost.warnings.join(" | "),
  );
  sure(
    said(lost.warnings, /^1 \.wad files are in none.*: hills\.wad \(entity 0 \(worldspawn\)\)$/),
    lost.warnings.join(" | "),
  );
  sure(lost.warnings.length === 5, `and a sentence's name (!) is no file: ${lost.warnings.join(" | ")}`);

  // found, and in other capitals: Windows finds it, Linux does not
  const capitals = things({
    env_thing: { model: "models/smak/walker.mdl" },
    smak_beast: { model: "Models/Smak/beast.mdl" },
  });
  sure(
    said(
      capitals.warnings,
      /^2 files are found only in other capitals than the map writes: Windows finds them, and a server on Linux.*does not: models\/smak\/walker\.mdl is models\/smak\/Walker\.mdl \(entity 3 \(env_thing\)\); Models\/Smak\/beast\.mdl is models\/smak\/beast\.mdl \(entity 4 \(smak_beast\)\)$/,
    ),
    capitals.warnings.join(" | "),
  );
  const finder = maps.fileFinder(folders);
  sure(
    JSON.stringify(finder.find("sound/ambience/wind.wav")) ===
      '{"found":true,"exact":true,"as":"sound/ambience/wind.wav"}',
    "the second folder is looked in too",
  );
  sure(
    JSON.stringify(finder.find("MODELS/tree.mdl")) ===
      '{"found":true,"exact":false,"as":"models/tree.mdl"}' && !finder.find("models/elm.mdl").found,
    "found loosely; not found",
  );

  // no folders: said, and nothing looked for; a profile's folders are used unasked
  const none = maps.checkEntities(
    house([maps.pointEntity("env_thing", [100, 100, 40], { model: "models/smak/wolf.mdl" })]),
    { definitions: FGD },
  );
  sure(
    !none.warnings.length &&
      said(none.facts, /^no game folders were given: the 1 files the entities name were not looked for$/),
    all(none),
  );
  const byProfile = maps.checkEntities(
    house([maps.pointEntity("env_thing", [100, 100, 40], { model: "models/smak/wolf.mdl" })], {
      start: "smak_start",
    }),
    { mod: smakGame({ folders }) },
  );
  sure(/models\/smak\/wolf\.mdl/.test(byProfile.warnings.join()), "the profile's folders");

  // a mod's own files: music named by a key, or as a key
  const files = [
    {
      classes: ["smak_tune"],
      key: "song",
      keys: "*.mp3",
      folders: ["music", ""],
      unless: ["stop.mp3"],
      what: "music files",
    },
  ];
  const tune = (keys) =>
    maps.checkEntities(
      house([maps.pointEntity("smak_tune", [100, 100, 40], keys)], { start: "smak_start" }),
      { mod: { name: "tunes", starts: ["smak_start"], folders, files } },
    );
  sure(
    !tune({ song: "calm.mp3", "stop.mp3": 1 }).warnings.length,
    `the song is there: ${tune({ song: "calm.mp3" }).warnings.join(" | ")}`,
  );
  sure(
    /1 music files are in none.*: storm\.mp3 \(entity 3 \(smak_tune\)\)/.test(
      tune({ "storm.mp3": "2:00" }).warnings.join(),
    ),
    tune({ "storm.mp3": "2:00" }).warnings.join(" | "),
  );
});

// ── a profile in a file, the commands, the MCP tool ──

await testAsync(
  "a profile is loaded from a file: data, a module, or a module's function that is handed the game's folders",
  "mods: loadMod",
  async () => {
    const data = {
      name: "smakdata",
      starts: ["smak_start"],
      fgd: [FGD],
      rules: [{ rule: "limit", key: "den", most: 2, to: ["smak_den"], why: "a small den" }],
    };
    writeFileSync(inFolder("smakdata.json"), JSON.stringify(data));
    const fromData = await maps.loadMod(inFolder("smakdata.json"));
    sure(
      fromData.name === "smakdata" && fromData.walkers.join() === "monster_*" && fromData.rules[0].most === 2,
      JSON.stringify(fromData.rules),
    );
    writeFileSync(
      inFolder("smakobject.mjs"),
      `export default ${JSON.stringify({ ...data, name: "smakobject" })};\n`,
    );
    sure(
      (await maps.loadMod(inFolder("smakobject.mjs"))).name === "smakobject",
      "a module whose default is the profile",
    );
    writeFileSync(
      inFolder("smakmade.mjs"),
      `export default ({ folders = [], cache }) => ({ name: "smakmade", folders, starts: ["smak_start"], fgd: [${JSON.stringify(FGD)}], note: cache,
  rules: [{ rule: "names", classes: ["smak_item"], key: "script", among: (name) => name === "key", what: "an item's name" }] });\n`,
    );
    const made = await maps.loadMod(inFolder("smakmade.mjs"), { folders: [GAME], cache: "kept.json" });
    sure(
      made.name === "smakmade" &&
        made.folders.join() === GAME &&
        made.note === "kept.json" &&
        typeof made.rules[0].among === "function",
      JSON.stringify(made),
    );
    writeFileSync(inFolder("empty.mjs"), "export const nothing = 1;\n");
    let refusal = "";
    await maps.loadMod(inFolder("empty.mjs")).catch((e) => (refusal = e.message));
    sure(
      /has no profile: its default export is to be the profile, or a function that makes it/.test(refusal),
      refusal,
    );
  },
);

/** The house written as a .map, for the commands. */
const mapFile = (name, entities, options) => {
  writeFileSync(inFolder(name), maps.writeMap(house(entities, options)));
  return inFolder(name);
};

test("map-check takes --fgd, --learned and --mod, for a compiled map and for a .map; map-learn writes what the maps teach", () => {
  const plain = runSmak("map-check", join(FIXTURES, "tworooms.bsp"), "--fgd", FGD, "--verbose");
  sure(
    /entity definitions: \d+ classes from smakbase\.fgd, smakgame\.fgd/.test(plain) &&
      /fit for goldsrc\n$/.test(plain),
    plain,
  );
  sure(
    !/entity definitions/.test(runSmak("map-check", join(FIXTURES, "tworooms.bsp"))),
    "unasked, nothing is looked up",
  );

  // a .map: the plan's check, with the entities against the FGD; exit code 1 on an error
  const good = mapFile("good.map", [beast([480, 128, 16], { lives: 2 })]);
  const fine = runSmak("map-check", good, "--fgd", FGD, "--verbose");
  sure(
    /world brushes/.test(fine) &&
      /places to start: 1 info_player_start/.test(fine) &&
      /fit to compile, with \d+ warnings\n$/.test(fine),
    fine,
  );
  const bad = mapFile("bad.map", [
    beast([480, 128, 16], { lives: "many" }, "smak_beast"),
    beast([480, 190, 16], {}, "smak_beast_tier1"),
  ]);
  const refused = runRefused(SMAK_CLI, "map-check", bad, "--fgd", FGD);
  sure(
    refused.code === 1 &&
      /ERROR 1 classes are in none of the definitions given.*smak_beast_tier1 \(entity 4\)/.test(refused.out),
    refused.out + refused.err,
  );
  sure(
    /WARN  1 values are not of their key's kind: entity 3 \(smak_beast\) lives "many" is not a whole number/.test(
      refused.out,
    ) && /errors: not fit to compile\n$/.test(refused.out),
    refused.out,
  );

  // map-learn, and its file given back to map-check
  const learnedFile = inFolder("learned-by-command.json");
  const learned = runSmak("map-learn", MAPS, "-o", learnedFile);
  sure(
    /learned-by-command\.json {2}3 maps, \d+ classes, read in [\d.]+ s/.test(learned) &&
      /notes\.bsp is not a GoldSrc map: passed over/.test(learned),
    learned,
  );
  sure(
    /^ +12 {2}smak_beast +in +3 maps {2}a point$/m.test(learned) &&
      /func_wall +in +3 maps {2}of brushes/.test(learned),
    learned,
  );
  sure(
    JSON.parse(readFileSync(learnedFile, "utf8")).classes.smak_beast.seen === 12,
    "the file is what learnEntities gives",
  );
  const one = runSmak("map-learn", MAPS, "-o", learnedFile, "--class", "smak_beast");
  sure(
    /smak_beast: 12 in 3 maps \(first, second, third\.\.\.\), 12 as a point and 0 of brushes/.test(one) &&
      /every one gives: den, lives, origin, script/.test(one) &&
      /^ +12 {2}script +"beasts\/wolf" x9 {2}"beasts\/boar" x3/m.test(one),
    one,
  );
  const byMaps = runRefused(SMAK_CLI, "map-check", bad, "--learned", learnedFile, "--verbose");
  sure(
    byMaps.code === 0 &&
      /WARN  1 classes were never seen in any of the mod's 3 maps.*smak_beast_tier1/.test(byMaps.out),
    byMaps.out + byMaps.err,
  );

  // --mod: a profile's file, handed the --game folders; goldsrc for the kit's own
  const item = mapFile(
    "item.map",
    [
      maps.pointEntity("smak_item", [100, 200, 40], { script: "items/key" }),
      maps.pointEntity("env_thing", [100, 100, 40], { model: "models/smak/wolf.mdl" }),
    ],
    { start: "smak_start" },
  );
  const byMod = runSmak(
    "map-check",
    item,
    "--mod",
    inFolder("smakmade.mjs"),
    "--game",
    GAME,
    "--game",
    VALVE,
    "--verbose",
  );
  sure(
    /places to start: 1 smak_start/.test(byMod) &&
      /WARN  1 entities give a script that is not an item's name: entity 3 \(smak_item\) script "items\/key"/.test(
        byMod,
      ),
    byMod,
  );
  sure(/WARN  1 models are in none of the game's folders given.*models\/smak\/wolf\.mdl/.test(byMod), byMod);
  const crowded = mapFile(
    "crowded.map",
    [den("lair"), ...[0, 1, 2].map((n) => beast([420 + n * 40, 128, 16], { den: "lair" }))],
    { start: "smak_start" },
  );
  const byData = runRefused(SMAK_CLI, "map-check", crowded, "--mod", inFolder("smakdata.json"));
  sure(
    byData.code === 1 &&
      /ERROR 1 entities are named by more others than they take \(a small den\): the smak_den lair is named by the den of 3 entities, and takes 2/.test(
        byData.out,
      ),
    byData.out + byData.err,
  );
  const kit = runRefused(SMAK_CLI, "map-check", crowded, "--mod", "goldsrc");
  sure(
    kit.code === 1 && /ERROR no info_player_start or info_player_deathmatch:/.test(kit.out),
    kit.out + kit.err,
  );
  // the walk test goes by the profile too
  sure(
    /walked from 1 places to start: 1 smak_start/.test(
      runSmak("map-reach", crowded, "--mod", inFolder("smakdata.json")),
    ),
    "map-reach --mod",
  );

  // what is wrong with the command is said
  for (const [args, pattern] of [
    [["map-check", bad, "--mod", inFolder("no-such.mjs")], /no such file: .*no-such\.mjs/],
    [["map-check", bad, "--fgd"], /--fgd needs a value after it/],
    [["map-learn", MAPS], /map-learn: -o learned\.json/],
    [
      ["map-learn", good, "-o", inFolder("x.json")],
      /map-learn: the folder of a mod's \.bsp files \(<mod>\/maps\), not a file/,
    ],
    [
      ["map-learn", FIXTURES + "/../", "-o", inFolder("x.json"), "--class", "smak_beast"],
      /no smak_beast in any of the \d+ maps|no GoldSrc map/,
    ],
    [["map-check", bad, "--fgd", good], /map-check: good\.map: no class in it .*: not an \.fgd file/],
  ]) {
    const run = runRefused(SMAK_CLI, ...args);
    sure(run.code === 1 && pattern.test(run.err), `${args.slice(0, 3).join(" ")}: ${run.err || run.out}`);
  }
  sure(
    /map-check <bsp\|map>.*--mod/.test(runSmak("help")) &&
      /map-learn <folder of \.bsp> -o learned\.json/.test(runSmak("help")),
    "the help names them",
  );
});

await testAsync(
  "the MCP server checks a map's entities against an FGD, learned definitions and a profile that is data",
  "mcp: mods",
  async () => {
    const work = inFolder("mcp-work");
    mkdirSync(work, { recursive: true });
    copyFileSync(inFolder("bad.map"), join(work, "bad.map"));
    copyFileSync(inFolder("crowded.map"), join(work, "crowded.map"));
    copyFileSync(inFolder("learned-by-command.json"), join(work, "learned.json"));
    copyFileSync(inFolder("smakdata.json"), join(work, "smakdata.json"));
    copyFileSync(inFolder("smakmade.mjs"), join(work, "smakmade.mjs"));
    const child = spawn(
      process.execPath,
      [join(HERE, "../cli/mcp/server.mjs"), "--models", FIXTURES, "--work", work, "--no-run"],
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
    const tool = async (name, args) => (await request("tools/call", { name, arguments: args })).result;
    const wordsOf = (result) =>
      result.content
        .filter((piece) => piece.type === "text")
        .map((piece) => piece.text)
        .join("\n");
    await request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "selftest", version: "0" },
    });

    const compiled = wordsOf(await tool("check", { model: "tworooms.bsp", against: "smakgame.fgd" }));
    sure(
      /entity definitions: \d+ classes from smakbase\.fgd, smakgame\.fgd/.test(compiled) &&
        /fit for goldsrc/.test(compiled),
      compiled,
    );
    const source = wordsOf(await tool("check", { model: "bad.map", against: "smakgame.fgd" }));
    sure(
      /ERROR 1 classes are in none of the definitions given.*smak_beast_tier1/.test(source) &&
        /lives "many" is not a whole number/.test(source),
      source,
    );
    const learned = wordsOf(await tool("check", { model: "bad.map", against: "learned.json" }));
    sure(/WARN {2}1 classes were never seen in any of the mod's 3 maps/.test(learned), learned);
    const byData = wordsOf(
      await tool("check", { model: "crowded.map", against: "smakdata.json, smakgame.fgd" }),
    );
    sure(
      /places to start: 1 smak_start/.test(byData) &&
        /ERROR 1 entities are named by more others than they take \(a small den\)/.test(byData),
      byData,
    );
    sure(
      /ERROR no info_player_start or info_player_deathmatch:/.test(
        wordsOf(await tool("check", { model: "crowded.map", against: "goldsrc" })),
      ),
      "the kit's own profile",
    );
    // a profile that is a module is code, which this tool does not run
    const module = await tool("check", { model: "crowded.map", against: "smakmade.mjs" });
    sure(
      module.isError && /A profile that is a module \(\.mjs\) is code/.test(wordsOf(module)),
      wordsOf(module),
    );
    const outside = await tool("check", { model: "bad.map", against: "../../smakgame.fgd" });
    sure(
      outside.isError && /is outside the models and work folders/.test(wordsOf(outside)),
      wordsOf(outside),
    );
    const closed = await new Promise((done) => {
      child.on("close", done);
      child.stdin.end();
    });
    sure(closed === 0, "the server did not end cleanly");
  },
);
