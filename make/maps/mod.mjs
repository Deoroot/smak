// A mod's profile: one plain object that says what a GoldSrc game expects of a map, so that `checkPlan`,
// `checkBsp`, `reachOf` and the pictures are told it once (`mod:`) and not option by option.
//
//   {
//     name, title
//     folders       the game's folders, the mod's own first and `valve` last: where its files are looked for
//     wads          .wad files whose textures a map of the mod may wear (their paths)
//     dlls          the game's own library (`<mod>/dlls/hl.dll`): the classes it exports are the classes that
//                   exist (dll.mjs)
//     fgd           .fgd files to read the entity definitions from
//     learned       { maps: <folder of the mod's .bsp files>, cache: <file>, except: [names] }: definitions
//                   learned from the mod's own maps (`learnEntities`), read when first wanted
//     definitions   definitions that are already data (what `definitionsOf` or `learnEntities` gave), one or a list
//     classes       { name: { kind, size, keys: { key: { type } } } }: classes written by hand, which stand
//                   over the FGD's where the FGD is wrong
//     starts        the classes that are a place to start
//     walkers       the classes that walk (a monster, an NPC): names, with `*` for any letters
//     origin        { starts: "middle" | "feet", walkers: "feet" | "middle" }: where in its box a thing's
//                   origin is
//     hulls         { standing, large, crouching }, each { half, height }: the boxes the engine moves things with
//     bodies        { classname: "large" | "standing" | "crouching" | { half, height, feet } }: which box a
//                   class moves with, where neither its FGD `size(...)` nor the standing hull is right
//     doors         the brush classes that open: taken as open by the walk test
//     exits         the classes a player leaves the map by, besides `trigger_changelevel`: floor from which
//                   one is reached is no one-way place (the walk test's `exits`)
//     markers       classes a player goes to although their kind is wiring's (the walk test's `markers`):
//                   a point the mod's scripts put something at
//     wiring        classes nobody has to get to, names with `*` for any letters (the walk test's
//                   `wiring`): what is fired by name and works wherever it stands. An entity of one that
//                   stands high in a wall is not said to be "not reached"
//     modelOf       (keys) => "models/x.mdl" | null: the model the game gives an entity that names none in
//                   its own keys (a monster's, from its script); asked when a picture is drawn with `models`
//     off           classnames that are a way of switching an entity off (`disabled_*`): not looked up; in
//                   the walk test, no wall, and a way out so written is looked for and told apart
//     targets       the keys that name another entity: { keys: [...], others: [classes whose every other
//                   key is a name they fire] }
//     named         names the game itself fires, which no entity of the map has to
//     engineKeys    the keys the engine reads for every entity, whatever its class
//     files         [{ classes, key | keys, folders, unless, what }]: more keys that name a file of the game
//     rules         the mod's own rules, as data and small functions (rules.mjs)
//     scriptPack    for a mod whose maps and scripts name scripts by path: how its scripts are read and
//                   named ({ shipped, loose, ofEntity, aliases, started }: scripts.mjs), so that one's own
//                   scripts can be placed against the game's: which replace one, which are new and named,
//                   which are named by nothing (`scriptsPlaced`, `smak scripts`)
//     spawns        how the mod's maps bring monsters in: the classes of a spawn area and a template, their
//                   keys, a template's script and race, which races attack which (encounters.mjs, `spawnsOf`,
//                   `smak map-spawns`). None: the mod has no spawn areas the kit reads
//     recipes       { text, chance, oneOf, counter }: the classes kits/encounterkit.mjs wires with
//     character     { from, props, sounds, music, figures }: what counts as a prop, a sound and music, and
//                   the mod's own maps' figures, [lower quartile, median, upper quartile] each
//                   (character.mjs, `smak map-character`)
//     items         { name: family }: the families of held items, each as `addItem` of make/items.mjs takes one
//                   (which files, bodyparts and bones a kind of item is shown from, and the game's own
//                   thing each new one is laid on); `smak item --family <name>` reads them here
//     spec          what a map spec of the mod is built with where it says nothing (src/spec/map.mjs, `smak
//                   build --mod`): { wads, theme, textures, prop: { class, keys }, things, uses }: the game's
//                   .wad files and the theme's words as its textures, the class a prop is, and its models
//                   (`things`, { name: { model, r, wall, lift, deep, turn, on, high, solid } }: `solid` ones
//                   get a CLIP box of their footprint up to `high`; `prop.solid` for all) that rooms are furnished
//                   with by their `use` (`uses`, written as src/spec/dress.mjs's are, and `density`, { use:
//                   a number }, how thickly each is dressed); what breaks (`breakable`,
//                   { keys, materials: { glass: { ... } } }: the keys of a func_breakable of each material) and
//                   the brush pieces a use may name (`pieces`, over the kit's: `{ crate_large: { breakable:
//                   "wood" } }`); the game's light textures as texture lights (`lamps`, { texture: [r, g, b,
//                   brightness] }: every room's lamp is a fixture of `textures.fixture` when that is one of them)
//   }
//
// The kit ships one profile, `GOLDSRC`: Half-Life's own, with nothing of any mod in it. A mod's profile is
// data its user passes or loads from a file (`loadMod`); a field it leaves out is `GOLDSRC`'s. Nothing of one
// mod is built into the kit: `profiles/` holds one mod's profile as an example, beside the kit's own code.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { definitionsOf } from "./fgd.mjs";
import { learnEntities } from "./learn.mjs";
import { definitionsOfDll } from "./dll.mjs";
import { BODIES, DOORS, isCompiled } from "./space.mjs";
import { valueOf } from "../../core/maps/entities.mjs";

/**
 * Half-Life's own profile, and the one every other is filled up from. Where each part is from:
 *   starts      `info_player_start` (one player) and `info_player_deathmatch` (several): the two classes
 *               EntSelectSpawnPoint of the SDK's dlls/player.cpp looks for
 *   hulls       the engine's hulls 1, 2 and 3 (`HULLS` of bsp.mjs, from the engine's model.cpp)
 *   bodies      the monsters whose code gives them the large hull, UTIL_SetSize(pev, Vector(-32, -32, 0),
 *               Vector(32, 32, 64)) in the SDK's dlls/agrunt.cpp, bullsquid.cpp, bigmomma.cpp, gargantua.cpp
 *               and controller.cpp
 *   origin      a player's origin is the middle of its box (VEC_HULL_MIN is -16 -16 -36); a monster's is at
 *               its feet (VEC_HUMAN_HULL_MIN is -16 -16 0), both in the SDK's dlls/util.h
 *   doors       the brush classes of the SDK's dlls/doors.cpp
 *   targets     `target`, `killtarget` (SUB_UseTargets of dlls/subs.cpp) and `master` (UTIL_IsMasterTriggered);
 *               a `multi_manager` takes every key it does not know for a name to fire (dlls/triggers.cpp)
 *   named       the names the game's rules fire by themselves (dlls/multiplay_gamerules.cpp, player.cpp)
 *   engineKeys  the fields of an entity the engine fills from a map's keys whatever the class: the table
 *               gEntvarsDescription of the SDK's dlls/util.cpp
 *   play        how the game is played by cli/play.mjs, which has each field: no menu, `say`, cl_yawspeed 210
 *               (the SDK's cl_dll/input.cpp), the line a loaded map prints (the engine's "Custom resource
 *               propagation complete", engine/client/cl_parse.c), no command that puts the player at a place,
 *               and the SDK's two messages of text, TextMsg and SayText, read as the SDK writes them; the
 *               eyes 28 above the origin, a blow struck with `+attack`, and no way to find an enemy
 */
export const GOLDSRC = deepFrozen({
  name: "goldsrc",
  title: "Half-Life, and any GoldSrc game that has no profile of its own",
  folders: [],
  wads: [],
  dlls: [],
  fgd: [],
  learned: null,
  definitions: [],
  classes: {},
  starts: ["info_player_start", "info_player_deathmatch"],
  walkers: ["monster_*"],
  origin: { starts: "middle", walkers: "feet" },
  hulls: {
    standing: { half: BODIES.standing.half, height: BODIES.standing.height },
    large: { half: BODIES.large.half, height: BODIES.large.height },
    crouching: { half: BODIES.crouching.half, height: BODIES.crouching.height },
  },
  bodies: {
    monster_alien_grunt: "large",
    monster_bullchicken: "large",
    monster_bigmomma: "large",
    monster_gargantua: "large",
    monster_alien_controller: "large",
  },
  doors: ["func_door", "func_door_rotating", "momentary_door"],
  // a single-player map is left by its level changes: the walk test takes one as a way out, not a dead end
  exits: ["trigger_changelevel"],
  markers: [],
  wiring: [],
  off: [],
  targets: { keys: ["target", "killtarget", "master"], others: ["multi_manager"] },
  named: ["game_playerdie", "game_playerkill", "game_playerspawn", "game_playerjoin", "game_playerleave"],
  engineKeys: [
    "classname", "globalname", "origin", "oldorigin", "velocity", "basevelocity", "movedir", "angles",
    "avelocity", "punchangle", "v_angle", "fixangle", "idealpitch", "pitch_speed", "ideal_yaw", "yaw_speed",
    "modelindex", "model", "viewmodel", "weaponmodel", "absmin", "absmax", "mins", "maxs", "size", "ltime",
    "nextthink", "movetype", "solid", "skin", "body", "effects", "gravity", "friction", "light_level",
    "sequence", "animtime", "framerate", "controller", "blending", "scale", "rendermode", "renderamt",
    "rendercolor", "renderfx", "health", "frags", "weapons", "takedamage", "deadflag", "view_ofs", "button",
    "impulse", "spawnflags", "flags", "colormap", "team", "max_health", "teleport_time", "armortype",
    "armorvalue", "waterlevel", "watertype", "target", "targetname", "netname", "message", "dmg_take",
    "dmg_save", "dmg", "dmgtime", "noise", "noise1", "noise2", "noise3", "speed", "air_finished",
    "pain_finished", "radsuit_finished",
  ], // prettier-ignore
  files: [],
  rules: [],
  play: {
    ...{ enter: [], say: ["say {text}"], loads: 45000, yawspeed: 210, screen: [1024, 768] },
    ...{ loaded: "Custom resource propagation complete", goto: null },
    messages: { TextMsg: "textmsg", SayText: "saytext" },
    // the eyes 28 above the origin (VEC_VIEW of the SDK's dlls/util.h); a blow is +attack held a moment
    // (cl_dll/input.cpp); the game itself says nothing of where an enemy is, of a hit or of a death
    ...{ eye: 28, target: null, heal: null },
    fight: { attack: [{ button: "attack", ms: 150, wait: 450 }] },
  },
});

/** The fields of a profile that are lists or objects of their own, by which a wrong one is told. */
const LISTS = ["folders", "wads", "dlls", "fgd", "starts", "walkers", "doors", "exits", "markers", "wiring", "off", "named", "engineKeys", "files", "rules"]; // prettier-ignore
/** What each profile's definitions came to, so that an FGD is read and a hundred maps are learned once. */
const definitionsKept = new WeakMap();
/** The profiles made whole, by the object they were made from. */
const wholeKept = new WeakMap();

function deepFrozen(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const each of Object.values(value)) deepFrozen(each);
  }
  return value;
}

/** Whether a name is one of a list: each of the list is the whole name, or has `*` for any letters. */
export function isNamed(list, name) {
  if (typeof name !== "string") return false;
  for (const each of list ?? []) {
    if (each instanceof RegExp ? each.test(name) : each === name) return true;
    if (typeof each === "string" && each.includes("*")) {
      const pattern = each.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
      if (new RegExp(`^${pattern.join(".*")}$`).test(name)) return true;
    }
  }
  return false;
}

/**
 * A profile made whole: every field it leaves out is `GOLDSRC`'s. `mod` is a profile, or undefined (null is
 * returned: no profile). What is wrong with it is refused in a sentence.
 */
export function modOf(mod) {
  if (mod === undefined || mod === null) return null;
  if (typeof mod !== "object" || Array.isArray(mod))
    throw new Error(
      "mod: a profile, an object such as maps.GOLDSRC (a profile kept in a file is read with `await maps.loadMod(file)`)",
    );
  if (wholeKept.has(mod)) return wholeKept.get(mod);
  for (const field of LISTS)
    if (mod[field] !== undefined && !Array.isArray(mod[field]))
      throw new Error(`mod: ${field} is a list, not ${JSON.stringify(mod[field])}`);
  if (mod.modelOf !== undefined && typeof mod.modelOf !== "function")
    throw new Error(`mod: modelOf is a function of an entity's keys, not ${JSON.stringify(mod.modelOf)}`);
  const whole = { ...GOLDSRC, ...mod };
  whole.origin = { ...GOLDSRC.origin, ...mod.origin };
  whole.hulls = { ...GOLDSRC.hulls, ...mod.hulls };
  whole.targets = { ...GOLDSRC.targets, ...mod.targets };
  wholeKept.set(mod, whole);
  wholeKept.set(whole, whole);
  return whole;
}

/**
 * Several definitions as one: what FGDs gave, what the maps taught and what the game's program has, side
 * by side. A class that an FGD defines keeps the FGD's kind, size and model and is `defined`; what was
 * counted in the maps (`seen`, `point`, `solid`, `always`, `together`) is kept beside it; one the program
 * exports `exists`; a key has what each said of it. Of two FGDs' word on one thing, the later stands.
 */
export function joinDefinitions(...list) {
  const given = list.flat().filter(Boolean);
  const joined = { from: [], fgd: false, maps: 0, program: false, classes: {} };
  for (const each of given) {
    if (!each.classes || typeof each.classes !== "object")
      throw new Error("definitions: what definitionsOf (an FGD) or learnEntities (a mod's maps) gave");
    joined.from.push(...(each.from ?? []));
    joined.fgd ||= Boolean(each.fgd);
    joined.program ||= Boolean(each.program);
    joined.maps = Math.max(joined.maps, each.maps ?? 0);
    for (const [name, own] of Object.entries(each.classes)) {
      const known = joined.classes[name];
      if (!known) {
        joined.classes[name] = { ...own, keys: { ...own.keys } };
        continue;
      }
      const keys = { ...known.keys };
      for (const [key, value] of Object.entries(own.keys ?? {})) keys[key] = { ...keys[key], ...value };
      // the kind is the FGD's when one of the two is an FGD's
      const kind = own.defined || !known.defined ? (own.kind ?? known.kind) : known.kind;
      joined.classes[name] = { ...known, ...own, kind, defined: Boolean(known.defined || own.defined), keys };
    }
  }
  return joined;
}

/** A profile's hand-written classes as definitions: each `defined`, as an FGD's are. */
function ownClasses(mod) {
  const classes = {};
  for (const [name, own] of Object.entries(mod.classes ?? {})) {
    const keys = {};
    for (const [key, value] of Object.entries(own.keys ?? {}))
      keys[key] = { choices: null, flags: null, ...value, defined: true };
    classes[name] = { ...own, defined: true, keys };
  }
  return { from: [`the profile ${mod.name}`], fgd: true, maps: 0, classes };
}

/**
 * The entity definitions a check goes by: those of the profile (its program's classes, its FGDs, what its
 * maps teach, what it was given as data, its hand-written classes, in that order) and then `more`, which is definitions, an .fgd
 * file's path, or a list of either. Null when there are none at all. A profile's own are worked out once.
 */
export function definitionsFor(mod, more) {
  const whole = modOf(mod);
  let own = null;
  if (whole) {
    own = definitionsKept.get(whole);
    if (own === undefined) {
      const parts = [];
      if (whole.dlls.length) parts.push(definitionsOfDll(whole.dlls));
      if (whole.fgd.length) parts.push(definitionsOf(whole.fgd));
      if (whole.learned) {
        if (typeof whole.learned.maps !== "string" && !Array.isArray(whole.learned.maps))
          throw new Error("mod: learned is { maps: <the folder of the mod's .bsp files>, cache: <a file> }");
        parts.push(
          learnEntities(whole.learned.maps, { cache: whole.learned.cache, except: whole.learned.except }),
        );
      }
      parts.push(...[whole.definitions].flat().filter(Boolean));
      // a class written by hand for one key keeps what the FGD and the maps say of the rest of it
      if (Object.keys(whole.classes ?? {}).length) parts.push(ownClasses(whole));
      own = parts.length ? joinDefinitions(parts) : null;
      definitionsKept.set(whole, own);
    }
  }
  const extra = [more]
    .flat()
    .filter(Boolean)
    .map((each) => (typeof each === "string" ? definitionsOf(each) : each));
  if (!extra.length) return own;
  return joinDefinitions([own, ...extra]);
}

/** The classnames a map has: brush source or a compiled map. */
function classesIn(map) {
  const names = new Set();
  if (isCompiled(map)) for (const entity of map.entities) names.add(valueOf(entity, "classname"));
  else for (const entity of map?.entities ?? []) names.add(entity?.classname);
  names.delete(undefined);
  return [...names];
}

/**
 * A map's entities, each as `[its number, its keys in a plain object]`: of a compiled map (the world is 0)
 * or of brush source (the first entity is 1), numbered as the pictures and the lists number them.
 */
function keysIn(map) {
  if (isCompiled(map)) return map.entities.map((entity, number) => [number, Object.fromEntries(entity)]);
  return (map?.entities ?? []).map((entity, index) => [
    index + 1,
    Object.fromEntries(Object.entries(entity ?? {}).filter(([, value]) => typeof value === "string")),
  ]);
}

/**
 * The models a profile gives the entities of a map that name none: `{ number: "models/x.mdl" }`, by the
 * entity's number, as the `modelsBy` option of `figuresOf` takes it. An entity whose own `model` key is
 * set is left to that key.
 */
export function modelsOf(mod, map) {
  const whole = modOf(mod);
  const given = {};
  if (typeof whole?.modelOf !== "function") return given;
  for (const [number, keys] of keysIn(map)) {
    if (!keys.classname || keys.model) continue;
    const model = whole.modelOf(keys);
    if (typeof model === "string" && model) given[number] = model;
  }
  return given;
}

/** A class's `size(...)` as the box a thing moves with: half its width, its height, how far down its feet. */
function boxOfSize(size) {
  const half = Math.max(...[0, 1].flatMap((axis) => [Math.abs(size.mins[axis]), Math.abs(size.maxs[axis])]));
  const height = size.maxs[2] - size.mins[2];
  return half > 0 && height > 0 ? { half, height, feet: -size.mins[2] } : null;
}

/**
 * The box each class of a map moves with, as the profile has it: `{ classname: { half, height, feet } }`, for
 * the `bodies` option of `reachOf` and the pictures. A place to start and a class that walks get, in this
 * order: what the profile's `bodies` names for the class; the class's `size(...)` from the definitions; the
 * standing hull. Where its origin is in the box (`feet`) is the profile's `origin`, unless a size says.
 * A box of exactly a hull's width and height is walked as that hull (`bodyFor`).
 */
export function bodiesOf(mod, classnames, definitions = definitionsFor(mod)) {
  const whole = modOf(mod);
  const bodies = {};
  if (!whole) return bodies;
  for (const classname of classnames) {
    const start = isNamed(whole.starts, classname);
    if (!start && !isNamed(whole.walkers, classname)) continue;
    const middle = (start ? whole.origin.starts : whole.origin.walkers) === "middle";
    const feetOf = (box) => (middle ? box.height / 2 : 0);
    const asked = whole.bodies?.[classname];
    const sized = definitions?.classes[classname]?.size;
    if (typeof asked === "string") {
      const hull = whole.hulls[asked];
      if (!hull)
        throw new Error(`mod: bodies.${classname} is ${asked}, and the profile's hulls have no such box`);
      bodies[classname] = { ...hull, feet: feetOf(hull) };
    } else if (asked) bodies[classname] = { feet: feetOf(asked), ...asked };
    else if (sized && boxOfSize(sized)) bodies[classname] = boxOfSize(sized);
    else bodies[classname] = { ...whole.hulls.standing, feet: feetOf(whole.hulls.standing) };
  }
  return bodies;
}

/**
 * The options of a walk or a picture with a profile's part in them: `mod` taken out, and in its place what
 * it says of this map. What the caller gives by name stands over the profile's.
 *   starts    the profile's (for `reachOf`)
 *   bodies    the box of every class of the map that starts or walks (`bodiesOf`), under the caller's own
 *   open      the profile's `doors` that the kit does not take for doors by itself, unless `doors` is "closed"
 *   folders   the profile's, when it has any
 *   exits     the profile's, and the caller's with them (for `reachOf`); `markers`, `wiring` and `off` the
 *             same way
 *   modelsBy  when the caller asks for models: those the profile's `modelOf` gives the map's entities,
 *             by number (`modelsOf`); a model the caller names stands over them
 * Options with no `mod` come back as they are.
 */
export function withMod(options = {}, map) {
  if (!options?.mod) return options;
  const whole = modOf(options.mod);
  const { mod: _mod, ...own } = options;
  const settled = { starts: whole.starts, ...own };
  if (own.folders === undefined && whole.folders.length) settled.folders = whole.folders;
  settled.bodies = { ...bodiesOf(whole, classesIn(map)), ...own.bodies };
  const more = whole.doors.filter((classname) => !DOORS.test(classname));
  if (more.length && own.doors !== "closed")
    settled.open = [...more, ...(own.open === undefined ? [] : [own.open].flat())];
  for (const list of ["exits", "markers", "wiring", "off"])
    if (whole[list].length)
      settled[list] = [...whole[list], ...(own[list] === undefined ? [] : [own[list]].flat())];
  if (own.models && own.modelsBy === undefined && typeof whole.modelOf === "function")
    settled.modelsBy = modelsOf(whole, map);
  return settled;
}

/**
 * A profile read from a file: `await loadMod(file, given)`.
 *   a .json file   the profile itself, as data (no rule that is a function)
 *   a .mjs file    a module whose `default` is the profile, or a function that makes it and is called with
 *                  `given` (`{ folders, cache }`: the game's folders as the caller has them, and a file to
 *                  keep what is learned in). A function may be async
 * The profile comes back whole (`modOf`).
 */
export async function loadMod(file, given = {}) {
  if (typeof file !== "string") throw new Error("loadMod: the path of a profile's file (.mjs or .json)");
  if (/\.json$/i.test(file)) return modOf(JSON.parse(readFileSync(file, "utf8")));
  const loaded = await import(pathToFileURL(resolve(file)).href);
  const made = typeof loaded.default === "function" ? await loaded.default(given) : loaded.default;
  if (!made || typeof made !== "object")
    throw new Error(
      `loadMod: ${file} has no profile: its default export is to be the profile, or a function that makes it`,
    );
  return modOf(made);
}
