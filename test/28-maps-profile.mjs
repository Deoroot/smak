// More of what a mod's profile says once: the ways out of a map (`exits`), and the model the game gives an
// entity that names none in its own keys (`modelOf`: a monster's comes from its script). And the picture
// commands taking `--mod`, as map-check and map-reach did.
//
// The game is the kit's own made-up one. The model is the card test/25-maps-seen.mjs writes into its game
// folder; the map with a pit is built here. Each "it is drawn" and "it is a way out" has the case beside it
// where the profile says nothing and the old answer stands.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import * as maps from "../check/maps/index.mjs";
import { test, sure, HERE, tmp, runSmak } from "./helper.mjs";

const FIXTURES = join(HERE, "fixtures");
const tworoomsBytes = readFileSync(join(FIXTURES, "tworooms.bsp"));
const folder = join(tmp, "maps-profile");
mkdirSync(folder, { recursive: true });
const inFolder = (name) => join(folder, name);
const game = join(tmp, "maps-seen", "game"); // where 25-maps-seen.mjs wrote models/card.mdl
const CARD = "models/card.mdl";
const refuses = (run, pattern) => {
  try {
    run();
  } catch (e) {
    return pattern.test(e.message) ? true : `it said: ${e.message}`;
  }
  return "it did not refuse";
};

// ── a hall with a pit in its floor, 96 deep: a player drops in and does not climb out ──
const WEARS = { floor: "FLOOR", ceiling: "CEILING", wall: "WALL" };
const START_FLOOR = [96, 128, 0];
const WAY_OUT = "smak_way_out";
const pitHall = (entities = []) => ({
  worldspawn: {},
  brushes: maps.carve(
    [
      { min: [0, 0, 0], max: [512, 256, 192] },
      { min: [256, 32, -96], max: [448, 224, 0] },
    ],
    16,
    WEARS,
  ),
  entities: [maps.playerStart(START_FLOOR, 0), maps.light([128, 128, 160]), ...entities],
});
const leave = (classname, keys = {}) =>
  maps.brushEntity(classname, maps.box([320, 96, -96], [384, 160, -32], "AAATRIGGER"), keys);

test("a profile names the classes a player leaves a map by: floor one is reached from is no one-way place", () => {
  const map = pitHall([leave(WAY_OUT)]);
  const alone = maps.reachOf(map);
  sure(
    alone.oneWay.length === 1,
    `with no profile the pit is a one-way place: ${alone.warnings.join(" | ")}`,
  );
  const mod = { name: "smakgame", exits: [WAY_OUT] };
  const told = maps.reachOf(map, { mod });
  sure(
    told.oneWay.length === 0 && new RegExp(`or to a way out \\(\\d+ ${WAY_OUT}\\)`).test(told.facts.join()),
    `${told.warnings.join(" | ")} ${told.facts.join(" | ")}`,
  );
  // Half-Life's own profile leaves by its level changes only: the same map, with no level change, is as it was
  sure(
    maps.GOLDSRC.exits.join() === "trigger_changelevel" && maps.reachOf(map, { mod: maps.GOLDSRC }).oneWay.length === 1,
    "goldsrc",
  );
  sure(maps.reachOf(pitHall([leave("trigger_changelevel", { map: "next" })]), { mod: maps.GOLDSRC }).oneWay.length === 0, "a level change is Half-Life's way out");
  // a class written as switched off is another class, and no way out
  const off = maps.reachOf(pitHall([leave(`disabled_${WAY_OUT}`)]), { mod });
  sure(off.oneWay.length === 1, "a way out that is switched off is none");
  // what the caller names is added to the profile's, not put in its place
  const both = pitHall([leave("func_button", { targetname: "drain" })]);
  sure(maps.reachOf(both, { mod }).oneWay.length === 1, "a button is no way out");
  sure(maps.reachOf(both, { mod, exits: ["drain"] }).oneWay.length === 0, "till the caller names it");
  sure(maps.reachOf(map, { mod, exits: ["drain"] }).oneWay.length === 0, "and the profile's still stands");
  sure(
    refuses(() => maps.modOf({ exits: WAY_OUT }), /exits is a list/),
    "exits that is no list is refused",
  );
});

// ── the model a profile gives an entity ──
const EYE = [96, 96, 16]; // looking along +y at what stands 64 away
const NORTH = 90;
const BEAST = "smak_beast";
/** The fixture with entities added: `[classname, origin, keys]` each. */
function withEntities(list) {
  let entities = maps.readBsp(tworoomsBytes).entities;
  for (const [classname, origin, keys] of list) entities = maps.addEntity(entities, classname, origin, keys);
  return maps.withEntities(tworoomsBytes, entities);
}
const beastAt = (keys = {}) => [BEAST, [96, 160, 0], { angles: "0 270 0", ...keys }];
// the made-up game's rule: a beast looks as its `kind` says
const modelOf = (keys) => (keys.classname === BEAST && keys.kind === "card" ? CARD : null);
const mod = { name: "smakgame", folders: [game], modelOf };
const view = (bytes, options = {}) =>
  maps.drawMap(maps.readBsp(bytes), { from: EYE, yaw: NORTH, labels: false, ...options });
const drawnAs = (picture, classname) =>
  picture.facts.marked.find((each) => each.classname === classname)?.drawn;

test("a profile says what an entity that names no model looks like, and the pictures draw it when asked", () => {
  sure(existsSync(join(game, CARD)), "the card of 25-maps-seen.mjs is there");
  const bytes = withEntities([beastAt({ kind: "card" }), [BEAST, [160, 96, 0], { kind: "unknown" }]]);
  const bsp = maps.readBsp(bytes);
  const beast = bsp.entities.findIndex((entity) => maps.valueOf(entity, "kind") === "card");
  // by the entity's number, and only for the one the profile knows
  const given = maps.modelsOf(mod, bsp);
  sure(JSON.stringify(given) === JSON.stringify({ [beast]: CARD }), JSON.stringify(given));
  const drawn = view(bytes, { mod, models: true });
  sure(
    drawnAs(drawn, BEAST) === "model",
    `the beast is drawn as its model: ${drawn.facts.notes.join(" | ")}`,
  );
  // not asked for, or with no profile: as before
  sure(drawnAs(view(bytes, { mod }), BEAST) !== "model", "models are drawn when asked for only");
  sure(
    drawnAs(view(bytes, { models: true, folders: [game] }), BEAST) !== "model",
    "and no profile, no model",
  );
  sure(Object.keys(maps.modelsOf(maps.GOLDSRC, bsp)).length === 0, "the kit's own profile gives none");
  // an entity's own `model` key is left to that key, and a model the caller names stands over the profile's
  const own = maps.readBsp(withEntities([beastAt({ kind: "card", model: "models/glow.mdl" })]));
  sure(
    Object.keys(maps.modelsOf(mod, own)).length === 0,
    "an entity that names its model is not asked about",
  );
  const { figures, notes } = maps.figuresOf(
    [{ number: 7, classname: BEAST, origin: [0, 0, 0], model: null, angles: [0, 0, 0], pose: {} }],
    { models: { [BEAST]: "models/glow.mdl" }, modelsBy: { 7: CARD }, folders: [game] },
  );
  sure(/glow\.mdl$/.test(figures.get(7).file), `the caller's: ${figures.get(7).file} ${notes.join()}`);
  // brush source numbers its entities from 1, and the profile's models go by the same numbers
  const source = pitHall([maps.pointEntity(BEAST, [96, 64, 0], { kind: "card" })]);
  sure(
    JSON.stringify(maps.modelsOf(mod, source)) === JSON.stringify({ 3: CARD }),
    "in a .map: the third entity",
  );
  sure(
    drawnAs(maps.drawSource(source, { from: [200, 64, 40], yaw: 180, mod, models: true, labels: false }), BEAST) === "model",
    "and the source's view draws it",
  ); // prettier-ignore
  sure(
    refuses(() => maps.modOf({ modelOf: CARD }), /modelOf is a function/),
    "a modelOf that is no function is refused",
  );
});

test("the picture commands take --mod: map-view, map-views, map-plan, map-section, map-storeys, map-openings", () => {
  const profile = inFolder("smakgame.mjs");
  writeFileSync(
    profile,
    `export default ({ folders = [] } = {}) => ({
  name: "smakgame",
  folders,
  exits: ["${WAY_OUT}"],
  modelOf: (keys) => (keys.classname === "${BEAST}" && keys.kind === "card" ? "${CARD}" : null),
});\n`,
  );
  const file = inFolder("beast.bsp");
  writeFileSync(file, withEntities([beastAt({ kind: "card" })]));
  const given = ["--mod", profile, "--game", game];
  const at = ["--from", EYE.join(","), "--yaw", String(NORTH)];
  const seen = runSmak("map-view", file, "-o", inFolder("view.png"), ...at, ...given, "--models");
  sure(/1 as their model, with its textures/.test(seen), seen);
  const boxed = runSmak("map-view", file, "-o", inFolder("view-no.png"), ...at, "--game", game, "--models");
  sure(!/as their model/.test(boxed), `with no --mod nothing names the beast's model: ${boxed}`);
  for (const [command, ...more] of [
    ["map-views"],
    ["map-plan"],
    ["map-storeys"],
    ["map-openings"],
    ["map-section", "--from", "32,96", "--to", "200,96"],
  ]) {
    const to = inFolder(`${command}.png`);
    runSmak(command, file, "-o", to, ...more, ...given, "--models");
    sure(smak.unpng(readFileSync(to)).width > 16, `${command} drew with --mod`);
  }
  // the walk test's ways out, from the same profile
  const pit = inFolder("pit.map");
  writeFileSync(pit, maps.writeMap(pitHall([leave(WAY_OUT)])));
  sure(/1 places are one-way/.test(runSmak("map-reach", pit)), "with no profile: a one-way place");
  sure(/no one-way place/.test(runSmak("map-reach", pit, "--mod", profile)), "with it: a way out");
});
