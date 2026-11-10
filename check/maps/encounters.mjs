// A map's encounters: how each group of monsters comes into the map, and whether the player sees it come.
// For a mod whose maps put their monsters in SPAWN AREAS (an entity that holds monster templates and makes
// them, when the map starts or when it is fired), as the mod's profile describes them (`spawns`, below).
// No game is run: what fires what is read from the entities' keys, what is seen from the map's solids.
//
// For each spawn area:
//   how it comes      present when the map starts; when the first player arrives (a name the game fires
//                     then, `game_playerspawn`); or fired, and then by what, followed back through relays,
//                     counters and multi_managers to the first thing a player does: walks into a trigger,
//                     uses a button or a door, breaks a breakable; or a monster's death, an area cleared, a
//                     script (a name a script fires), or nothing found
//   seen              for an area fired by a trigger a player walks into: each template to which a clear line
//                     runs from an eye in that trigger (a grid over its floor, at the eyes' height), within
//                     `sight` units. Through the world and the brush entities that block the eye (walls,
//                     closed doors, breakables, illusionaries that are not see-through); not where the
//                     player looks, not the dark. An upper bound: "could be seen appearing"
//   quick             templates that come back (lives over 1, or endless) after under `quick` seconds, at
//                     their own spot: where whoever killed them is likely still standing
//   fights            templates of one area, of bands that can be there together and within `near` units of
//                     each other, whose races attack each other (the profile's `race` and `relation`)
//   rewards           templates that are a reward (the profile's `reward`), brought by a death: how far from
//                     the dying monster's own spot they appear
//
// The profile's `spawns` (Master Sword's in profiles/mastersword.mjs; Half-Life has no spawn areas):
//   areas        classes of a spawn area
//   templates    classes of a monster template
//   area         the template's key that names its area
//   waits        { key, value }: the area waits to be fired when its `key` is `value` (otherwise it fills
//                when the map starts)
//   cleared      the area's key it fires when every template has used up its lives
//   dies         the template's keys it fires as it dies
//   lives        the template's key of lives (`endless`: the value, or none, that is without end)
//   delay        [low, high]: the template's keys of seconds before it comes back
//   band         { key, separator }: the template's range of party strength, "from;to" or "from"
//   script       (keys) => the template's script name, or null
//   scriptKey    the key a recipe (kits/encounterkit.mjs) writes a template's script into
//   race         (script) => its race, or null
//   relation     (a, b) => "ally" | "hates" | "none": what a monster of race a does to one of race b
//   reward       (script, keys) => whether the template is a reward (a chest)
//   arrival      names the game fires when a player arrives (an area fired by one is there before anyone looks)
//   touches      classes of trigger a player walks into
//   uses         classes a player uses (fires its target when used)
//   breaks       classes that fire their target when broken
//   starts       classes that fire as the map starts
//   fires        (script) => the names a script fires by itself
import { spaceOf, isCompiled } from "../../make/maps/space.mjs";
import { contentsAt, CONTENTS } from "../../core/maps/bsp.mjs";
import { brushModelOf } from "../../core/maps/entities.mjs";
import { entitiesOf } from "./rules.mjs";
import { isNamed, modOf, GOLDSRC } from "../../make/maps/mod.mjs";
import { PLAYER_ORIGIN_HEIGHT } from "../../make/maps/source.mjs";

/** How far a monster appearing is taken to be seen, at the most (units). */
export const SIGHT = 3000;
/** A respawn sooner than this (seconds) is a pop-in where its killer stands. */
export const QUICK = 60;
/** Two monsters this near each other (units) meet. */
export const NEAR = 1024;
/** A reward this far (units) from the death that brings it is far from the fight that won it. */
export const FAR = 1024;
/** The eye points of a trigger: one every this many units across its floor, at most this many each way. */
const EYE_STEP = 64;
const EYES_EACH_WAY = 6;
/** The sight line is tried against a brush entity's own model every this many units. */
const SIGHT_STEP = 8;
/** How deep a trace is followed back through relays. */
const DEPTH = 12;
/** How many of a list a sentence names. */
const LISTED = 6;
/**
 * Brush entities that hide what is behind them: walls, doors (closed when an area is fired: the player is
 * on this side), breakables (not yet broken), illusionaries (seen, not solid). One drawn see-through
 * (`rendermode` other than 0 and `renderamt` under 200) hides nothing.
 */
const HIDES = /^(func_wall|func_wall_toggle|func_door|func_door_rotating|momentary_door|func_breakable|func_pushable|func_illusionary|func_rotating|func_train|func_tracktrain|func_plat)$/;
const SEE_THROUGH = 200;

const some = (list, listed = LISTED) =>
  `${list.slice(0, listed).join("; ")}${list.length > listed ? `; and ${list.length - listed} more` : ""}`;
const round = (point) => point.map((value) => Math.round(value)).join(" ");
const listOf = (value) => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);

/** A value of a key whatever its case: the game's maps write `Lives` as often as `lives`. */
function keyOf(entity, key) {
  const lower = key.toLowerCase();
  return entity.pairs.find((pair) => pair[0].toLowerCase() === lower)?.[1];
}
const numberOf = (value) => (value === undefined || !/^\s*[-+]?(\d+\.?\d*|\.\d+)\s*$/.test(value) ? null : Number(value));
const pointOf = (value) => {
  const parts = String(value ?? "").trim().split(/\s+/).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? parts : null;
};

/** A band "from;to" or "from" as [from, to]; null for none (every band). */
function bandOf(value, separator) {
  if (value === undefined || !String(value).trim()) return null;
  const parts = String(value).split(separator).map((part) => numberOf(part)).filter((part) => part !== null);
  if (!parts.length) return null;
  const [from, to = Infinity] = parts;
  return from === 0 && to === Infinity ? null : [from, to === 0 ? Infinity : to];
}
/** Whether two bands can be on the map together: they overlap (whole numbers: 1;150 and 150 do). */
const together = (a, b) => !a || !b || (a[0] < b[1] && b[0] < a[1]);

/** The profile's `spawns`, filled up and checked; null when the mod has none. */
function spawnsOfMod(mod) {
  const spawns = mod?.spawns;
  if (!spawns) return null;
  if (!listOf(spawns.areas).length || !spawns.area)
    throw new Error("spawns: the profile's `spawns` names the classes of a spawn area (`areas`) and the template's key that names its area (`area`)"); // prettier-ignore
  return {
    templates: ["*"],
    waits: null,
    cleared: null,
    dies: [],
    lives: null,
    endless: ["0", ""],
    delay: [],
    band: null,
    script: () => null,
    race: () => null,
    relation: () => "none",
    reward: () => false,
    arrival: mod.named?.filter((name) => /spawn|join/.test(name)) ?? [],
    touches: ["trigger_once", "trigger_multiple"],
    uses: ["func_button", "func_rot_button", "momentary_rot_button", "func_door", "func_door_rotating"],
    breaks: ["func_breakable", "func_pushable"],
    starts: ["trigger_auto"],
    fires: () => [],
    ...spawns,
  };
}

/**
 * Every spawn area of a map, how it comes, and its faults. `map` is brush source or a compiled map; `mod`
 * a profile with `spawns` (or a name `modOf` knows). Options: `sight`, `quick`, `near`, `far` (the
 * constants above), `seen: false` to skip the sight test (it walks lines through the map).
 *
 * Returns `{ areas, loose, warnings, facts }`. An area: `{ name, number, classname, comes, by, templates,
 * seen, quick, fights, rewards }`; `comes` is "start", "arrival" or "fired"; `by` the first things that fire
 * it `[{ kind, number, classname, targetname, via, box }]`, `kind` one of "touch", "use", "break", "start",
 * "death", "cleared", "script", "arrival", "nothing". A template: `{ number, classname, script, race, at,
 * lives, delay, band, reward }`.
 */
export function spawnsOf(map, options = {}) {
  const mod = modOf(options.mod) ?? GOLDSRC;
  const spawns = spawnsOfMod(mod);
  const result = { areas: [], loose: [], warnings: [], facts: [] };
  if (!spawns) {
    result.facts.push("the profile says nothing of spawn areas (`spawns`): no encounter is read");
    return result;
  }
  const sight = options.sight ?? SIGHT;
  const quick = options.quick ?? QUICK;
  const near = options.near ?? NEAR;
  const far = options.far ?? FAR;
  const entities = entitiesOf(map);
  const classOf = (entity) => entity.classname ?? "";
  const is = (entity, classes) => isNamed(listOf(classes), classOf(entity));
  const isArea = (entity) => is(entity, spawns.areas);
  const named = new Map();
  for (const entity of entities) {
    const name = keyOf(entity, "targetname");
    if (name) named.set(name, [...(named.get(name) ?? []), entity]);
  }

  // ── what fires each name: the profile's keys that name a target, a multi_manager's keys, an area's
  // `cleared`, a template's `dies`, a script's own ──
  const keys = [...new Set([...(mod.targets?.keys ?? ["target", "killtarget"]), ...listOf(spawns.dies), ...(spawns.cleared ? [spawns.cleared] : [])])]; // prettier-ignore
  const managers = mod.targets?.others ?? ["multi_manager"];
  const firers = new Map();
  const fires = (from, name, how) => {
    if (!name) return;
    for (const one of String(name).split(/[;,]/).map((part) => part.trim()).filter(Boolean))
      firers.set(one, [...(firers.get(one) ?? []), { from, how }]);
  };
  for (const entity of entities) {
    for (const key of keys) fires(entity, keyOf(entity, key), key);
    if (is(entity, managers))
      for (const [key] of entity.pairs) {
        const name = key.replace(/#\d+$/, "");
        if (named.has(name)) fires(entity, name, "multi_manager");
      }
  }
  const scriptOf = (entity) => spawns.script(Object.fromEntries(entity.pairs.map(([key, value]) => [key.toLowerCase(), value])));
  const byScript = new Map();
  for (const entity of entities) {
    const script = scriptOf(entity);
    if (!script || byScript.has(script)) continue;
    byScript.set(script, listOf(spawns.fires(script)));
  }
  const scriptFires = new Map();
  for (const [script, names] of byScript) for (const name of names) scriptFires.set(name, [...(scriptFires.get(name) ?? []), script]);

  // the space, for the boxes of brush entities and the sight test
  const space = options.seen === false ? null : spaceOf(map, { doors: "closed", mod });
  const boxOf = (entity) => space?.areas.find((area) => area.number === entity.number) ?? null;

  /** The first things that fire `name`, back through relays: `[{ kind, number, classname, targetname, via, box }]`. */
  const sourcesOf = (name, via = [], seen = new Set()) => {
    if (seen.has(name) || via.length > DEPTH) return [];
    seen.add(name);
    const found = [];
    const at = (kind, entity, more = {}) => ({ kind, number: entity?.number, classname: entity ? classOf(entity) : undefined, targetname: entity ? keyOf(entity, "targetname") : undefined, via, ...more }); // prettier-ignore
    if (listOf(spawns.arrival).includes(name)) found.push({ kind: "arrival", via, name });
    for (const { from, how } of firers.get(name) ?? []) {
      if (isArea(from) && how === spawns.cleared) found.push(at("cleared", from));
      else if (is(from, spawns.templates) && keyOf(from, spawns.area) && listOf(spawns.dies).includes(how))
        found.push(at("death", from, { script: scriptOf(from), area: keyOf(from, spawns.area) }));
      else if (is(from, spawns.touches) && from.brush) found.push(at("touch", from, { box: boxOf(from) }));
      else if (is(from, spawns.uses)) found.push(at("use", from, { box: boxOf(from) }));
      else if (is(from, spawns.breaks)) found.push(at("break", from, { box: boxOf(from) }));
      else if (is(from, spawns.starts)) found.push(at("start", from));
      else if (keyOf(from, "targetname")) {
        const up = sourcesOf(keyOf(from, "targetname"), [...via, `${classOf(from)} ${keyOf(from, "targetname")}`], seen);
        found.push(...(up.length ? up : [at("nothing", from)]));
      } else found.push(at("nothing", from));
    }
    for (const script of scriptFires.get(name) ?? []) found.push({ kind: "script", via, script });
    return found;
  };

  // ── the sight test ──
  const eye = PLAYER_ORIGIN_HEIGHT + (mod.play?.eye ?? 28);
  const sees = space ? sightTest(map, { space, entities }) : () => false;
  /** A player's eyes inside a trigger's box: a grid over the floor in it. */
  const eyesIn = (box) => {
    const eyes = [];
    const across = [0, 1].map((axis) => Math.min(EYES_EACH_WAY, Math.max(1, Math.round((box.max[axis] - box.min[axis]) / EYE_STEP))));
    for (let i = 0; i < across[0]; i++)
      for (let j = 0; j < across[1]; j++) {
        const x = box.min[0] + ((i + 0.5) * (box.max[0] - box.min[0])) / across[0];
        const y = box.min[1] + ((j + 0.5) * (box.max[1] - box.min[1])) / across[1];
        // the highest floor in the trigger's heights that a standing player fits on: the top of a stretch
        // where his feet cannot be, with room above it to the next
        const stretches = space.blocked(x, y, "standing");
        for (let k = stretches.length - 1; k >= 0; k--) {
          const top = stretches[k][1];
          if (stretches[k + 1] && stretches[k + 1][0] <= top + 1) continue;
          if (top > box.max[2] || top < box.min[2] - PLAYER_ORIGIN_HEIGHT) continue;
          eyes.push([x, y, top + eye]);
          break;
        }
      }
    return eyes;
  };

  // ── the areas ──
  for (const entity of entities.filter(isArea)) {
    const name = keyOf(entity, "targetname");
    const templates = (name ? entities.filter((other) => is(other, spawns.templates) && keyOf(other, spawns.area) === name) : []).map((template) => {
      const script = scriptOf(template);
      const lives = spawns.lives ? keyOf(template, spawns.lives) : undefined;
      const delay = listOf(spawns.delay).map((key) => numberOf(keyOf(template, key)));
      return {
        number: template.number,
        classname: classOf(template),
        script,
        race: script ? spawns.race(script) : null,
        at: pointOf(keyOf(template, "origin")),
        lives: lives === undefined || listOf(spawns.endless).includes(String(lives).trim()) ? Infinity : numberOf(lives),
        delay: delay.some((value) => value !== null) ? [delay[0] ?? delay[1], delay[1] ?? delay[0]] : null,
        band: spawns.band ? bandOf(keyOf(template, spawns.band.key), spawns.band.separator ?? ";") : null,
        reward: script ? Boolean(spawns.reward(script, Object.fromEntries(template.pairs))) : false,
      };
    });
    const waits = spawns.waits && String(keyOf(entity, spawns.waits.key) ?? "").trim() === String(spawns.waits.value);
    const by = waits && name ? sourcesOf(name) : [];
    const comes = !waits ? "start" : by.length && by.every((source) => source.kind === "arrival") ? "arrival" : "fired";
    const area = { name: name ?? `entity ${entity.number}`, number: entity.number, classname: classOf(entity), comes, by, templates, seen: [], quick: [], fights: [], rewards: [] }; // prettier-ignore

    // seen: from every trigger a player walks into that brings it
    if (space && comes === "fired")
      for (const source of by.filter((each) => each.kind === "touch" && each.box)) {
        const eyes = eyesIn(source.box);
        for (const template of templates) {
          if (!template.at || template.reward || area.seen.some((each) => each.number === template.number)) continue;
          const chest = [template.at[0], template.at[1], template.at[2] + PLAYER_ORIGIN_HEIGHT];
          let best = null;
          for (const from of eyes) {
            const distance = Math.hypot(chest[0] - from[0], chest[1] - from[1], chest[2] - from[2]);
            if (distance > sight || (best && distance >= best.distance)) continue;
            if (sees(from, chest)) best = { distance, eye: from };
          }
          if (best) area.seen.push({ number: template.number, script: template.script, distance: Math.round(best.distance), eye: best.eye.map(Math.round), trigger: source.number }); // prettier-ignore
        }
      }
    // quick: back again soon, at its own spot
    for (const template of templates)
      if (!template.reward && template.lives > 1 && template.delay && template.delay[1] < quick) area.quick.push(template);
    // fights: of bands that can be there together, near each other, one attacking the other
    for (let i = 0; i < templates.length; i++)
      for (let j = 0; j < templates.length; j++) {
        const a = templates[i];
        const b = templates[j];
        if (i === j || !a.race || !b.race || a.race === b.race || !a.at || !b.at || a.reward || b.reward) continue;
        if (!together(a.band, b.band)) continue;
        if (Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1], a.at[2] - b.at[2]) > near) continue;
        if (spawns.relation(a.race, b.race) === "hates") area.fights.push({ a, b });
      }
    // rewards: how far from the death that brings them
    for (const template of templates.filter((each) => each.reward && each.at))
      for (const source of by.filter((each) => each.kind === "death" || each.kind === "cleared")) {
        const dying =
          source.kind === "death"
            ? [entities[source.number]]
            : entities.filter((other) => is(other, spawns.templates) && keyOf(other, spawns.area) === source.targetname);
        const places = dying.map((other) => pointOf(keyOf(other, "origin"))).filter(Boolean);
        if (!places.length) continue;
        const distance = Math.round(Math.min(...places.map((at) => Math.hypot(at[0] - template.at[0], at[1] - template.at[1], at[2] - template.at[2]))));
        // one line a reward: the nearest of the deaths that bring it (a boss of each band is one boss)
        const known = area.rewards.find((each) => each.number === template.number);
        if (known && known.distance <= distance) continue;
        if (known) area.rewards.splice(area.rewards.indexOf(known), 1);
        area.rewards.push({ number: template.number, script: template.script, distance, from: source });
      }
    result.areas.push(area);
  }
  result.loose = entities
    .filter((entity) => is(entity, spawns.templates) && !keyOf(entity, spawns.area) && scriptOf(entity))
    .map((entity) => ({ number: entity.number, classname: classOf(entity), script: scriptOf(entity), at: pointOf(keyOf(entity, "origin")) })); // prettier-ignore

  // ── what is said ──
  const all = result.areas.flatMap((area) => area.templates.filter((template) => !template.reward));
  const count = (comes) => result.areas.filter((area) => area.comes === comes).reduce((sum, area) => sum + area.templates.filter((each) => !each.reward).length, 0); // prettier-ignore
  result.facts.push(
    `${result.areas.length} spawn areas hold ${all.length} monsters: ${count("start")} there when the map starts, ${count("arrival")} when the first player arrives, ${count("fired")} fired later`,
  );
  const kinds = {};
  for (const area of result.areas.filter((each) => each.comes === "fired"))
    for (const kind of new Set(area.by.map((source) => source.kind))) kinds[kind] = (kinds[kind] ?? 0) + 1;
  if (Object.keys(kinds).length)
    result.facts.push(`fired areas, by what fires them: ${Object.entries(kinds).map(([kind, n]) => `${kind} ${n}`).join(", ")}`);

  const seenAreas = result.areas.filter((area) => area.seen.length);
  if (seenAreas.length) {
    const seenCount = seenAreas.reduce((sum, area) => sum + area.seen.length, 0);
    result.warnings.push(
      `${seenCount} monsters of ${seenAreas.length} spawn areas can be seen appearing from the trigger that brings them (a clear line from a player's eyes in it, within ${sight} units; where the player looks and the dark not counted): ${some(
        seenAreas.map((area) => {
          const nearest = area.seen.reduce((best, each) => (each.distance < best.distance ? each : best));
          return `${area.name} ${area.seen.length} of ${area.templates.filter((each) => !each.reward).length}, the nearest ${nearest.distance} units from entity ${nearest.trigger} (entity ${nearest.number}, ${nearest.script ?? "no script"})`;
        }),
      )}. Fill the area before the player can look (when the map starts, on arrival, from a trigger further back), hide it behind a door or a bend, or bring it as a reply to something the player does`,
    );
  }
  const quickAreas = result.areas.filter((area) => area.quick.length);
  if (quickAreas.length)
    result.warnings.push(
      `${quickAreas.reduce((sum, area) => sum + area.quick.length, 0)} monsters come back at their own spot under ${quick} s after they die, where whoever killed them is likely still standing: ${some(
        quickAreas.map((area) => {
          const first = area.quick[0];
          return `${area.name} ${area.quick.length} (entity ${first.number}, ${first.script ?? first.classname}, ${first.lives === Infinity ? "lives without end" : `${first.lives} lives`}, back after ${first.delay.join("-")} s)`;
        }),
      )}. One life, or minutes between lives`,
    );
  const fightAreas = result.areas.filter((area) => area.fights.length);
  if (fightAreas.length)
    result.warnings.push(
      `${fightAreas.length} spawn areas hold races that attack each other, near and in the same band: ${some(
        fightAreas.map((area) => {
          const pairs = new Map();
          for (const { a, b } of area.fights) {
            const key = `${a.script ?? a.classname} (${a.race}) attacks ${b.script ?? b.classname} (${b.race})`;
            pairs.set(key, (pairs.get(key) ?? 0) + 1);
          }
          return `${area.name}: ${[...pairs.keys()].slice(0, 3).join(", ")}${pairs.size > 3 ? `, and ${pairs.size - 3} more` : ""}`;
        }),
      )}. Put races that are allies together, or the one that attacks on ground of its own`,
    );
  const farRewards = result.areas.flatMap((area) => area.rewards.filter((each) => each.distance > far).map((each) => ({ area, ...each })));
  if (farRewards.length)
    result.warnings.push(
      `${farRewards.length} rewards appear far from the death that brings them (over ${far} units): ${some(
        farRewards.map((each) => `${each.area.name}: entity ${each.number} (${each.script}) ${each.distance} units from ${each.from.kind === "death" ? `entity ${each.from.number} (${each.from.script ?? each.from.classname})` : `the area ${each.from.targetname}`}`),
      )}. At the boss's feet, or in a vault his death opens on the way out`,
    );
  const silent = result.areas.filter((area) => area.comes === "fired" && area.by.every((source) => source.kind === "nothing"));
  if (silent.length)
    result.facts.push(`${silent.length} areas wait to be fired and nothing found fires them (a name put together by a script is not seen): ${some(silent.map((area) => area.name))}`); // prettier-ignore
  return result;
}

/**
 * The sight test of `spawnsOf` (and of `teamsOf`): `(from, to) => boolean`, whether a clear line runs between two
 * points, through the world and the brush entities that block the eye (`HIDES`: walls, closed doors, breakables,
 * illusionaries; one drawn see-through hides nothing). `space` is the map's (`spaceOf`, doors closed as a rule);
 * `entities` its `entitiesOf`, when the caller has them.
 */
export function sightTest(map, { space, entities = entitiesOf(map), mod } = {}) {
  space ??= spaceOf(map, { doors: "closed", mod });
  const hiders = space.areas.filter((area) => {
    if (area.off || area.open) return false;
    if (!HIDES.test(area.classname)) return false;
    const entity = entities[area.number];
    const mode = numberOf(keyOf(entity, "rendermode")) ?? 0;
    const amount = numberOf(keyOf(entity, "renderamt")) ?? 255;
    return mode === 0 || amount >= SEE_THROUGH;
  });
  const compiled = isCompiled(map);
  /** Whether a brush entity's own shape is on the line (a compiled map's model; brush source's are in the space). */
  const hidden = (from, to) => {
    if (!compiled) return false;
    for (const area of hiders) {
      if (!crossesBox(from, to, area.min, area.max)) continue;
      const entity = map.entities[area.number];
      const model = brushModelOf(entity);
      if (model === null) continue;
      const origin = pointOf(entity.find((pair) => pair[0] === "origin")?.[1]) ?? [0, 0, 0];
      const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
      const steps = Math.max(1, Math.ceil(length / SIGHT_STEP));
      for (let step = 1; step < steps; step++) {
        const point = [0, 1, 2].map((axis) => from[axis] + ((to[axis] - from[axis]) * step) / steps - origin[axis]);
        if (contentsAt(map, point, { model }) === CONTENTS.SOLID) return true;
      }
    }
    return false;
  };
  return (from, to) => space.sees(from, to) && !hidden(from, to);
}

/** Whether the segment from `a` to `b` passes through the box. */
function crossesBox(a, b, min, max) {
  let enter = 0;
  let leave = 1;
  for (let axis = 0; axis < 3; axis++) {
    const d = b[axis] - a[axis];
    if (Math.abs(d) < 1e-9) {
      if (a[axis] < min[axis] || a[axis] > max[axis]) return false;
      continue;
    }
    let t0 = (min[axis] - a[axis]) / d;
    let t1 = (max[axis] - a[axis]) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    enter = Math.max(enter, t0);
    leave = Math.min(leave, t1);
    if (enter > leave) return false;
  }
  return true;
}

/** A table of the areas, one line each, for the command line. */
export function spawnsTable(report) {
  const lines = [];
  for (const area of report.areas) {
    const scripts = [...new Set(area.templates.map((each) => each.script ?? each.classname))];
    const races = [...new Set(area.templates.map((each) => each.race).filter(Boolean))];
    const by = area.by.length
      ? [...new Set(area.by.map((source) => `${source.kind}${source.number !== undefined ? ` ${source.number}` : ""}${source.via?.length ? ` via ${source.via.join(" > ")}` : ""}`))].slice(0, 3).join("; ") // prettier-ignore
      : "";
    lines.push(
      `${area.name.padEnd(24)} ${area.comes.padEnd(8)} ${String(area.templates.length).padStart(2)}  ${scripts.slice(0, 4).join(", ")}${scripts.length > 4 ? ", ..." : ""}` +
        `${races.length ? `  [${races.join(", ")}]` : ""}${by ? `  by ${by}` : ""}` +
        `${area.seen.length ? `  SEEN ${area.seen.length}` : ""}${area.quick.length ? `  QUICK ${area.quick.length}` : ""}${area.fights.length ? "  FIGHT" : ""}` +
        `${area.rewards.length ? `  reward ${area.rewards.map((each) => each.distance).join(",")} units away` : ""}`,
    );
  }
  return lines.join("\n");
}
