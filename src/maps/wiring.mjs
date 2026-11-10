// What a map's entities are wired to do, as a role-play map is judged: its properties (doors by name), its
// switches and what each one works in the end, its lifts, the places that heal or hurt, the names that sound
// over the whole map, its teleports and what comes back after it is broken. A city that plays well is full of
// such wiring (three role-play cities of The Specialists, read on 2026-10-17: 98 to 110 doors, every one named; 38 to 53 switches
// at lights, TVs, radios, music, lifts and ovens; a city alarm of eleven speakers); a map that has none is
// a set of rooms, however it is dressed.
//
// The source of each rule is the SDK's own code: a name is fired by `target` and `killtarget`
// (SUB_UseTargets, dlls/subs.cpp), a multi_manager fires every key it does not know (dlls/triggers.cpp,
// CMultiManager::KeyValue, "name#1" for a name given twice), a trigger_relay, a multisource and a
// game_counter pass on what fires them; a func_train stops at a path_corner whose spawnflags have 1 ("wait
// for retrigger", dlls/plats.cpp and pathcorner.cpp) and runs on past one that has not.
//
//   wiringOf(map, { mod })   map: brush source or a compiled map (readBsp)
import { entitiesOf } from "./rules.mjs";
import { isCompiled } from "./space.mjs";
import { brushModelOf } from "./entities.mjs";
import { shapeOf } from "./source.mjs";
import { isNamed, modOf, GOLDSRC } from "./mod.mjs";

/** What a player works with his hands or his feet. */
const SWITCHES = ["func_button", "func_rot_button", "momentary_rot_button"];
const TOUCHES = ["trigger_multiple", "trigger_once"];
/** What passes on what fires it. */
const RELAYS = ["multi_manager", "trigger_relay", "multisource", "game_counter", "trigger_changetarget"];
/** What a name ends at, by class: the kind of thing it works. */
const WORKS = [
  [["light", "light_spot", "light_environment"], "light"],
  [["ambient_generic", "env_sound"], "sound"],
  [["func_train", "func_tracktrain", "func_plat", "func_platrot"], "lift"],
  [["func_door", "func_door_rotating", "momentary_door"], "door"],
  [["trigger_teleport"], "teleport"],
  [["func_breakable", "func_pushable"], "breakable"],
  [["env_laser", "env_beam"], "beam"],
  [["trigger_camera"], "camera"],
  [["env_sprite", "env_glow", "env_spark", "env_render", "env_shooter", "env_explosion", "env_bubbles", "env_fade", "env_shake"], "effect"], // prettier-ignore
  [["func_wall_toggle", "func_illusionary", "func_wall", "func_conveyor", "func_rotating"], "brush"],
  [["game_text", "env_message"], "text"],
  [["ts_groundweapon", "ts_powerup", "weapon_*", "item_*", "ammo_*"], "item"],
];
/** The keys a multi_manager has of its own: every other key is a name it fires. */
const MANAGER_OWN = ["classname", "targetname", "origin", "angles", "spawnflags", "wait", "delay", "master", "globalname"]; // prettier-ignore
/** A name heard from this many speakers or more is said over the map: an alarm, a broadcast. */
const BROADCAST_LEAST = 3;
/** How deep relays are followed. */
const DEPTH = 8;
/** How many of one list a sentence names before it counts the rest. */
const LISTED = 10;

const some = (list, most = LISTED) =>
  `${list.slice(0, most).join(", ")}${list.length > most ? `, and ${list.length - most} more` : ""}`;
const place = (point) => (point ? point.map((value) => Math.round(value)).join(" ") : "?");
const flagsOf = (entity) => Number.parseInt(entity.get("spawnflags") ?? "0", 10) || 0;

/**
 * A door's name without the number or the letter that tells it from its neighbours: "resident7" is of
 * "resident", "lux_apt_c" of "lux_apt", "golgo.apt3.1" of "golgo.apt3"; "broth_gate" is its own.
 */
export function doorFamilyOf(name) {
  const numbered = name.replace(/[\s._-]*\d+$/, "");
  const family = numbered !== name ? numbered : name.replace(/[\s._-][a-z]$/i, "");
  return family || name;
}

/**
 * The map's wiring: `{ properties, families, unnamedDoors, switches, works, lifts, zones, broadcasts,
 * teleports, comesBack, warnings, facts }`.
 *   properties  [{ name, doors: [numbers], at, opens: [what fires it: "switch 12", "touch 30"], family }]:
 *               each name that doors answer to; doors of one name open together and are one property
 *   families    [{ family, names }]: the properties whose names differ only by a last number or letter
 *               (resident1 to resident9), the largest first
 *   switches    [{ number, classname, at, kind: "switch" | "touch", target, works: [{ kind, number, classname,
 *               name }] }]: what each one works in the end, through relays
 *   works       { kind: count } over every switch: lights, sounds, lifts, doors ...
 *   lifts       [{ number, name, stops, corners, loops, by: [switches] }]
 *   zones       [{ number, kind: "heal" | "hurt", dmg, switched, at }]: trigger_hurt by its damage (under 0
 *               heals)
 *   broadcasts  [{ name, speakers, sound, by }]: a name that BROADCAST_LEAST speakers or more answer to
 *   teleports   [{ number, to, at }]
 *   comesBack   [{ number, classname, after }]: what is broken and comes back (`respawntime`)
 * `mod`: the profile, whose `doors` and `targets` are read.
 */
export function wiringOf(map, { mod } = {}) {
  const profile = modOf(mod) ?? GOLDSRC;
  const entities = entitiesOf(map);
  const doorClasses = profile.doors ?? GOLDSRC.doors;
  const targetKeys = (profile.targets?.keys ?? ["target", "killtarget"]).filter((key) => key !== "master");
  const managers = profile.targets?.others ?? ["multi_manager"];
  const is = (entity, classes) => isNamed(classes, entity.classname ?? "");

  // where each entity is: its origin, or the middle of its brushes
  const middleOf = (min, max) => min.map((value, axis) => (value + max[axis]) / 2);
  const placeOf = (entity) => {
    const origin = entity.get("origin");
    if (origin && !entity.brush) return origin.trim().split(/\s+/).map(Number);
    if (isCompiled(map)) {
      const model = brushModelOf(entity.pairs);
      const box = model !== null ? map.models[model] : null;
      if (box) return middleOf(box.mins, box.maxs).map((value, axis) => value + (box.origin?.[axis] ?? 0));
    } else {
      const brushes = map.entities?.[entity.number - 1]?.brushes ?? [];
      const shapes = brushes.map((brush) => shapeOf(brush)).filter((shape) => shape.min);
      if (shapes.length)
        return middleOf(
          [0, 1, 2].map((axis) => Math.min(...shapes.map((shape) => shape.min[axis]))),
          [0, 1, 2].map((axis) => Math.max(...shapes.map((shape) => shape.max[axis]))),
        );
    }
    return origin ? origin.trim().split(/\s+/).map(Number) : null;
  };

  const named = new Map();
  for (const entity of entities) {
    const name = entity.get("targetname");
    if (name) named.set(name, [...(named.get(name) ?? []), entity]);
  }
  /** The names an entity fires. */
  const firedBy = (entity) => {
    const names = [];
    for (const key of targetKeys) {
      const value = entity.get(key);
      if (value) names.push(...value.split(/[;,]/).map((part) => part.trim()).filter(Boolean));
    }
    if (is(entity, managers))
      for (const [key] of entity.pairs)
        if (!MANAGER_OWN.includes(key) && !/^_|^zhlt_/.test(key)) names.push(key.replace(/#\d+$/, ""));
    return [...new Set(names)];
  };
  const kindOf = (entity) => {
    if (entity.classname === "trigger_hurt") return Number(entity.get("dmg") ?? 0) < 0 ? "heal" : "hurt";
    for (const [classes, kind] of WORKS) if (is(entity, classes)) return kind;
    return entity.classname ?? "unknown";
  };
  /** What a name works in the end, through relays: `[{ kind, number, classname, name }]`, and the missing. */
  const worksOf = (name, seen = new Set(), depth = 0) => {
    if (seen.has(name) || depth > DEPTH) return { works: [], missing: [] };
    seen.add(name);
    const answering = named.get(name) ?? [];
    if (!answering.length) return { works: [], missing: [name] };
    const works = [];
    const missing = [];
    for (const entity of answering) {
      if (is(entity, RELAYS) || is(entity, managers)) {
        for (const next of firedBy(entity)) {
          const found = worksOf(next, seen, depth + 1);
          works.push(...found.works);
          missing.push(...found.missing);
        }
      } else works.push({ kind: kindOf(entity), number: entity.number, classname: entity.classname, name });
    }
    return { works, missing };
  };

  const warnings = [];
  const facts = [];

  // ── switches, and what each works ──
  const switches = [];
  const unanswered = [];
  for (const entity of entities) {
    const kind = is(entity, SWITCHES) ? "switch" : is(entity, TOUCHES) ? "touch" : null;
    if (!kind) continue;
    const names = firedBy(entity);
    if (!names.length) continue;
    const works = [];
    for (const name of names) {
      const found = worksOf(name);
      works.push(...found.works);
      for (const lost of found.missing) unanswered.push(`${entity.classname} ${entity.number} at ${place(placeOf(entity))}: "${lost}"`); // prettier-ignore
    }
    switches.push({ number: entity.number, classname: entity.classname, at: placeOf(entity), kind, target: names.join(";"), works }); // prettier-ignore
  }
  const works = {};
  for (const one of switches) for (const kind of new Set(one.works.map((work) => work.kind))) works[kind] = (works[kind] ?? 0) + 1; // prettier-ignore
  const firers = new Map();
  for (const one of switches)
    for (const work of one.works) firers.set(work.number, [...(firers.get(work.number) ?? []), `${one.kind} ${one.number}`]); // prettier-ignore

  // ── properties: the doors by name ──
  const doors = entities.filter((entity) => is(entity, doorClasses));
  const byName = new Map();
  const unnamedDoors = [];
  for (const door of doors) {
    const name = door.get("targetname");
    if (!name) unnamedDoors.push(door.number);
    else byName.set(name, [...(byName.get(name) ?? []), door]);
  }
  const properties = [...byName].map(([name, list]) => ({
    name,
    doors: list.map((door) => door.number),
    at: placeOf(list[0]),
    opens: [...new Set(list.flatMap((door) => firers.get(door.number) ?? []))],
    family: doorFamilyOf(name),
  }));
  const familyMap = new Map();
  for (const property of properties) familyMap.set(property.family, [...(familyMap.get(property.family) ?? []), property.name]); // prettier-ignore
  const families = [...familyMap].map(([family, names]) => ({ family, names })).sort((a, b) => b.names.length - a.names.length || a.family.localeCompare(b.family)); // prettier-ignore

  // ── lifts: trains, their corners and their stops ──
  const lifts = [];
  for (const train of entities.filter((entity) => is(entity, ["func_train", "func_tracktrain"]))) {
    const corners = [];
    let next = train.get("target");
    let loops = false;
    while (next) {
      const corner = (named.get(next) ?? []).find((entity) => is(entity, ["path_corner", "path_track"]));
      if (!corner) break;
      if (corners.includes(corner)) {
        loops = true;
        break;
      }
      corners.push(corner);
      next = corner.get("target");
    }
    const stops = corners.filter((corner) => flagsOf(corner) & 1).length;
    lifts.push({ number: train.number, name: train.get("targetname") ?? null, corners: corners.length, stops, loops, by: firers.get(train.number) ?? [] }); // prettier-ignore
  }

  // ── what heals and hurts, what is said over the map, the teleports, what comes back ──
  const zones = entities
    .filter((entity) => entity.classname === "trigger_hurt")
    .map((entity) => {
      const dmg = Number(entity.get("dmg") ?? 0);
      return { number: entity.number, kind: dmg < 0 ? "heal" : "hurt", dmg, switched: Boolean(entity.get("targetname")), at: placeOf(entity) }; // prettier-ignore
    });
  const broadcasts = [...named]
    .map(([name, list]) => ({ name, speakers: list.filter((entity) => entity.classname === "ambient_generic") }))
    .filter((each) => each.speakers.length >= BROADCAST_LEAST)
    .map(({ name, speakers }) => ({
      name,
      speakers: speakers.length,
      sound: speakers[0].get("message") ?? null,
      by: [...new Set(speakers.flatMap((speaker) => firers.get(speaker.number) ?? []))],
    }));
  const teleports = entities
    .filter((entity) => entity.classname === "trigger_teleport")
    .map((entity) => ({ number: entity.number, to: entity.get("target") ?? null, at: placeOf(entity) }));
  const comesBack = entities
    .filter((entity) => Number(entity.get("respawntime") ?? 0) > 0)
    .map((entity) => ({ number: entity.number, classname: entity.classname, after: Number(entity.get("respawntime")) })); // prettier-ignore

  // ── in words ──
  const count = (list, what) => `${list.length} ${what}`;
  facts.push(
    doors.length
      ? `${doors.length} doors under ${properties.length} ${properties.length === 1 ? "name" : "names"} (a name is a property: its doors open together)${unnamedDoors.length ? `, ${unnamedDoors.length} with no name` : ", every one named"}`
      : "no doors",
  );
  const kin = families.filter((family) => family.names.length > 1);
  if (kin.length) facts.push(`properties of one family, by name: ${some(kin.map((family) => `${family.family} x${family.names.length}`))}`); // prettier-ignore
  const byHand = switches.filter((one) => one.kind === "switch");
  const byFoot = switches.filter((one) => one.kind === "touch");
  facts.push(
    switches.length
      ? `${count(byHand, "switches")} and ${count(byFoot, "triggers walked into")}; what they work: ${Object.entries(works).sort((a, b) => b[1] - a[1]).map(([kind, n]) => `${kind} ${n}`).join(", ")}` // prettier-ignore
      : "no switches and no triggers that fire anything",
  );
  if (lifts.length)
    facts.push(
      `${lifts.length} trains: ${some(lifts.map((lift) => `${lift.name ?? `entity ${lift.number}`} (${lift.corners} corners, ${lift.stops} stops${lift.loops ? ", a loop" : ""}${lift.by.length ? `, by ${lift.by.join(" ")}` : ", fired by nothing"})`))}`,
    );
  const heals = zones.filter((zone) => zone.kind === "heal");
  const hurts = zones.filter((zone) => zone.kind === "hurt");
  if (zones.length)
    facts.push(
      `${count(heals, "places that heal")}, ${count(hurts, "that hurt")} (${hurts.filter((zone) => zone.switched).length} of them switched on by a name: an oven, a trap)`,
    );
  if (broadcasts.length)
    facts.push(`said over the map: ${some(broadcasts.map((each) => `"${each.name}" from ${each.speakers} speakers${each.by.length ? `, by ${each.by.join(" ")}` : ""}`))}`); // prettier-ignore
  if (teleports.length) facts.push(`${teleports.length} teleports`);
  if (comesBack.length) facts.push(`${comesBack.length} things come back after they are broken (respawntime ${some([...new Set(comesBack.map((each) => each.after))].sort((a, b) => a - b).map(String))} s)`); // prettier-ignore

  if (unanswered.length)
    warnings.push(`${unanswered.length} switches and triggers fire a name nothing answers to: ${some(unanswered)}`);
  const deadLifts = lifts.filter((lift) => !lift.by.length && lift.name);
  if (deadLifts.length)
    warnings.push(`${deadLifts.length} named trains no switch or trigger fires: ${some(deadLifts.map((lift) => `${lift.name} (entity ${lift.number})`))}`); // prettier-ignore
  const stuck = lifts.filter((lift) => lift.corners && !lift.stops && !lift.loops);
  if (stuck.length)
    warnings.push(`${stuck.length} trains run to the end of their corners and stop for good (no corner waits for a retrigger, none loops): ${some(stuck.map((lift) => lift.name ?? `entity ${lift.number}`))}`); // prettier-ignore

  return { properties, families, unnamedDoors, switches, works, lifts, zones, broadcasts, teleports, comesBack, warnings, facts }; // prettier-ignore
}
