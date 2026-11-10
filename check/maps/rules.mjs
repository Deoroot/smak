// A map's entities held against what the game reads: the mod's entity definitions (an FGD's, or learned
// from the mod's own maps), the names entities call one another by, the mod's own rules, and the files the
// entities name. An entity is text, and the game takes from it only what its code asks for: a class it does
// not have is dropped, a key it never reads does nothing, a name nothing answers to fires nothing, and none
// of it is said. `checkPlan` and `checkBsp` run this when they are given a `mod` or `definitions`.
//
// A RULE is one of a mod's quirks, as data: `{ rule: <its kind>, ..., why: <where the fact is from> }`.
//
//   limit    { key, most, of, to }            no more than `most` entities (of the classes `of`) may name one
//                                             other (of the classes `to`) by `key`
//   beside   { key, needs, classes, unless }  `key` does something only beside the key `needs`; a value of
//                                             `unless` is no use of it
//   bands    { key, among, classes, whole, separator, words }
//                                             the ranges `key` holds ("0;150", "150;500", "500": from;to,
//                                             or from, and up) among the entities that share the keys of
//                                             `among` must meet and not overlap. `whole`: the ranges are of
//                                             whole numbers, and 1;200 meets 201. `words`: parts of a value
//                                             that are no end of its range ("avg")
//   finite   { classes, when, counted, count }   an entity of `classes` that gives the key `when` counts
//                                             the entities that name it by the key `counted`: each of them
//                                             must give `count` as a number over 0
//   names    { classes, key, required, of: { classes, key }, among, what }
//                                             the value of `key` is the name of something that exists: the
//                                             `key` (targetname, unless told) of an entity of `of.classes`
//                                             in this map, or a name `among(name, entity)` knows (true, or
//                                             false, or a sentence on why not): a script, an item.
//                                             `required`: an entity without the key is told too
//
// Each takes `classes` (names, `*` for any letters), `level` ("warning" unless told; "error" for a limit) and
// `why`, which is put into its sentence. A rule may also be a function, `(entities, tools) => [{ level,
// text }]`, for what no kind covers: `entities` is `[{ number, classname, brush, pairs, get(key), named }]`.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isCompiled } from "../../make/maps/space.mjs";
import { brushModelOf } from "../../core/maps/entities.mjs";
import { listedWads } from "../../core/maps/wad.mjs";
import { GOLDSRC, modOf, definitionsFor, isNamed } from "../../make/maps/mod.mjs";
import { spawnsOf } from "./encounters.mjs";

/** How many of one kind of fault are listed before the rest are counted. */
const LISTED = 8;
/**
 * The classes VHLT's compilers read and take out or pass on (its zhlt.fgd): no game defines them, and none
 * has to.
 */
const COMPILER_CLASSES = [
  "func_detail", "func_group", "info_texlights", "info_compile_parameters", "light_surface", "light_shadow",
  "light_bounce", "info_sunlight", "info_angularfade", "info_hullshape", "info_translucent", "info_smoothvalue",
  "info_overview_point", "info_minlights", "info_portal", "info_leaf",
]; // prettier-ignore
/** Keys the compilers and the editors read on any entity, which no game's definitions need list. */
const COMPILER_KEYS = /^(zhlt_|_)|^(light_origin|model_center|angle|mapversion|wad|compiler)$/;
/**
 * Brush classes, as Half-Life's FGD writes them, that work as well with no brush: the game's code never asks
 * for their model. `trigger_counter`: the SDK's dlls/triggers.cpp, CTriggerCounter::Spawn, sets how many
 * times it is to be fired and its Use and nothing else (no InitTrigger, no SET_MODEL), and Master Sword's
 * triggers.cpp has the same lines; seen counting in that game as a point entity, 2026-10-13. One without a
 * brush is not said to have "no shape to be touched": it is never touched.
 */
const NEEDS_NO_BRUSH = new Set(["trigger_counter"]);
/** What a map learned from fewer maps than this says of a class's kind or keys is not held against a map. */
const LEARNED_LEAST = 8;
/** A class the maps have in no more maps than this, and no FGD defines, is told as rare. */
const RARE_MAPS = 1;
/** ... when at least this many maps were learned from. */
const RARE_OF = 10;
/** An FGD's type is taken as wrong when more than this share of the mod's own values do not fit it. */
const CONTRADICTED = 0.05;
/** How many choices a sentence lists. */
const CHOICES_LISTED = 12;
/** The six sides of a sky, as its files are named, and the two kinds of picture the engine takes. */
const SKY_SIDES = ["up", "dn", "lf", "rt", "ft", "bk"];
const SKY_KINDS = ["tga", "bmp"];
const SKY_FOLDER = "gfx/env";
const SOUND_FOLDER = "sound";
/** What comes of a file that is not there, by its kind. */
const MISSED = {
  models: "the engine stops on a model it is told to load and does not find",
  sprites: "the engine stops on a sprite it is told to load and does not find",
  sounds: "a sound that is not found is not played, and the console says so to nobody",
  "sky pictures": "the sky is drawn without them",
  ".wad files": "GoldSrc stops on a listed .wad it does not find",
};
/** A sound's name may begin with marks that say how it is played; `!` names a sentence, not a file. */
const SOUND_MARKS = /^[*#@><^)}$?]+/;
const WHOLE = /^[-+]?\d+$/;
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const BRUSH_MODEL = /^\*\d+$/;

// ── small tools ─────────────────────────────────────────────────────────────
/** The first few of a list, and how many more there are. */
const some = (list, listed = LISTED) =>
  `${list.slice(0, listed).join("; ")}${list.length > listed ? `; and ${list.length - listed} more` : ""}`;
/** A value of a plan as the map's text has it: a list with spaces between. */
const textOf = (value) => (Array.isArray(value) ? value.map(textOf).join(" ") : String(value));
/** The numbers a value holds, or null when a word of it is none. */
function numbersIn(value) {
  const words = value.trim().split(/\s+/);
  return words.every((word) => NUMBER.test(word)) ? words.map(Number) : null;
}

/** One entity as the checks read it. */
function entityOf(number, classname, pairs, brush) {
  return {
    number,
    classname,
    pairs,
    brush,
    named: `entity ${number} (${classname ?? "no classname"})`,
    /** The first value of a key; undefined when the entity does not give it. */
    get: (key) => pairs.find((pair) => pair[0] === key)?.[1],
  };
}

/**
 * A map's entities, the world first: `[{ number, classname, brush, pairs, get(key), named }]`. `map` is
 * brush source (`{ worldspawn, brushes, entities }`) or a compiled map (`readBsp`). An entity is numbered as
 * the checks and the pictures number it: the world is 0.
 */
export function entitiesOf(map) {
  if (isCompiled(map))
    return map.entities.map((pairs, number) =>
      entityOf(
        number,
        pairs.find((pair) => pair[0] === "classname")?.[1],
        pairs,
        number === 0 || brushModelOf(pairs) !== null,
      ),
    );
  const pairsOf = (keys) =>
    Object.entries(keys ?? {})
      .filter(([key, value]) => key !== "brushes" && value !== undefined)
      .map(([key, value]) => [key, key === "wad" && Array.isArray(value) ? value.join(";") : textOf(value)]);
  const world = entityOf(0, "worldspawn", [["classname", "worldspawn"], ...pairsOf(map?.worldspawn)], true);
  world.pairs = world.pairs.filter((pair, index) => index === 0 || pair[0] !== "classname");
  const others = (map?.entities ?? []).map((entity, index) =>
    entityOf(
      index + 1,
      typeof entity?.classname === "string" ? entity.classname : undefined,
      pairsOf(entity),
      Boolean(entity?.brushes?.length),
    ),
  );
  return [world, ...others];
}

/** Sentences gathered by what they are about, so that forty of one fault are one sentence. */
function gatherer() {
  const groups = new Map();
  const plain = { error: [], warning: [], fact: [] };
  return {
    /** One more of a fault: `headline` is what is said of them all, after their number. */
    add(level, headline, item) {
      const key = `${level}\n${headline}`;
      if (!groups.has(key)) groups.set(key, { level, headline, items: [] });
      groups.get(key).items.push(item);
    },
    /** A sentence that stands by itself. */
    say: (level, text) => (plain[level] ?? plain.warning).push(text),
    done() {
      const out = { errors: [], warnings: [], facts: [] };
      const into = { error: out.errors, warning: out.warnings, fact: out.facts };
      for (const { level, headline, items } of groups.values())
        (into[level] ?? out.warnings).push(`${items.length} ${headline}: ${some(items)}`);
      out.errors.push(...plain.error);
      out.warnings.push(...plain.warning);
      out.facts.push(...plain.fact);
      return out;
    },
  };
}

/** Items that are the same thing several times over, as one each: `reqhp on ms_npc (12 entities, the first is entity 40)`. */
function counted(list) {
  const byWhat = new Map();
  for (const { what, entity } of list) {
    if (!byWhat.has(what)) byWhat.set(what, { count: 0, first: entity });
    byWhat.get(what).count++;
  }
  return [...byWhat].map(([what, { count, first }]) =>
    count === 1
      ? `${what} (entity ${first.number})`
      : `${what} (${count} entities, the first is entity ${first.number})`,
  );
}

// ── classes, keys and values ────────────────────────────────────────────────
/** What is wrong with a value for a key of this type, in words; null when nothing is. */
function faultOfValue(key, value) {
  const text = value.trim();
  if (!text) return null;
  switch (key.type) {
    case "integer":
      return WHOLE.test(text) ? null : "is not a whole number";
    case "float":
      return NUMBER.test(text) ? null : "is not a number";
    case "choices": {
      if (!key.choices?.length) return null;
      const one = key.choices.some(
        (choice) =>
          choice === text || (NUMBER.test(text) && NUMBER.test(choice) && Number(choice) === Number(text)),
      );
      if (one) return null;
      const listed = key.choices.slice(0, CHOICES_LISTED).join(", ");
      return `is none of its choices (${listed}${key.choices.length > CHOICES_LISTED ? ", ..." : ""})`;
    }
    case "flags": {
      if (!WHOLE.test(text)) return "is not a whole number";
      if (!key.flags?.length) return null;
      const known = key.flags.reduce((all, bit) => all | bit, 0);
      const strange = [];
      for (let bit = 1; bit > 0 && bit <= Number(text); bit *= 2)
        if (Number(text) & bit && !(known & bit)) strange.push(bit);
      return strange.length ? `sets ${strange.join(" and ")}, which its class does not define` : null;
    }
    case "color255":
    case "color1": {
      const numbers = numbersIn(text);
      return numbers && (numbers.length === 3 || numbers.length === 4) ? null : "is not a colour (three numbers, or four)"; // prettier-ignore
    }
    case "origin":
    case "vector": {
      const numbers = numbersIn(text);
      return numbers?.length === 3 ? null : "is not three numbers";
    }
    case "angle": {
      const numbers = numbersIn(text);
      return numbers && (numbers.length === 3 || numbers.length === 1)
        ? null
        : "is not an angle (three numbers)";
    }
    default:
      return null;
  }
}

/** Whether the mod's own maps give a key values its FGD type refuses: the FGD is then the one that is wrong. */
function contradicted(key) {
  if (!key.seen) return false;
  if (key.type === "integer" && (key.seen - key.whole) / key.seen > CONTRADICTED) return true;
  if (key.type === "float" && (key.seen - key.numbers) / key.seen > CONTRADICTED) return true;
  return (key.values ?? []).some(([value]) => faultOfValue(key, value));
}

/** The classes, the kinds, the keys and the values, against the definitions. */
function checkDefined(entities, definitions, mod, gathered) {
  const { classes } = definitions;
  const where = definitions.from.join(", ");
  const lower = new Map(Object.keys(classes).map((name) => [name.toLowerCase(), name]));
  const undefinedClasses = [];
  const absent = [];
  const bare = new Set();
  const rare = [];
  const forgotten = new Set();
  const strangeKeys = [];
  const unseenKeys = [];
  const badValues = [];
  for (const entity of entities) {
    const { classname } = entity;
    if (!classname || COMPILER_CLASSES.includes(classname)) continue;
    const known = classes[classname];
    // the game's program has the last word on which classes there are
    if (definitions.program && !known?.exists) {
      const other = lower.get(classname.toLowerCase());
      absent.push({
        what: other && classes[other].exists ? `${classname} (the program has ${other})` : classname,
        entity,
      });
      continue;
    }
    if (known?.exists && !known.defined && !known.seen) bare.add(classname);
    if (!known) {
      const other = lower.get(classname.toLowerCase());
      if (other)
        gathered.add(
          "warning",
          "classes are written in other capitals than the definitions have them, and the game tells capitals from small letters",
          `${classname} is ${other} (${entity.named})`,
        );
      else undefinedClasses.push({ what: classname, entity });
      continue;
    }
    if (!known.defined && !known.exists && known.maps <= RARE_MAPS && definitions.maps >= RARE_OF)
      rare.push({ what: `${classname}, in ${(known.in ?? []).join(", ")}`, entity });
    else if (!known.defined && known.seen && definitions.fgd) forgotten.add(classname);

    // a point class made of brushes, a brush class with none
    const sure = known.defined || known.seen >= LEARNED_LEAST;
    const basis = known.defined
      ? "in the definitions"
      : `every one of the ${known.seen} times the mod's maps have it`;
    if (sure && known.kind === "point" && entity.brush)
      gathered.add(
        "warning",
        "entities of a point class are made of brushes",
        `${entity.named}: a point entity ${basis}`,
      );
    if (sure && known.kind === "solid" && !entity.brush && !NEEDS_NO_BRUSH.has(classname))
      gathered.add(
        "warning",
        "entities of a brush class have no brush, and so no shape to be touched, seen or stood on",
        `${entity.named}: made of brushes ${basis}`,
      );

    const keysLower = new Map(Object.keys(known.keys).map((name) => [name.toLowerCase(), name]));
    const firesOthers = isNamed(mod.targets.others, classname);
    for (const [key, value] of entity.pairs) {
      if (key === "classname") continue;
      const defined = known.keys[key];
      if (!defined) {
        if (firesOthers || mod.engineKeys.includes(key) || COMPILER_KEYS.test(key)) continue;
        // a key the profile says names another entity is one the game reads
        if (mod.targets.keys.includes(key)) continue;
        if (key === "model" && entity.brush) continue;
        // a key a rule of the profile reads, which the game does not (a bands rule's `open`: a note for the check)
        if (mod.rules?.some((rule) => rule?.open === key && (!rule.classes || isNamed(rule.classes, classname)))) continue; // prettier-ignore
        // a key that is itself a file's name (a profile's `files`)
        if (mod.files.some((rule) => rule.keys && isNamed([rule.keys].flat(), key) && (!rule.classes || isNamed(rule.classes, classname)))) continue; // prettier-ignore
        const other = keysLower.get(key.toLowerCase());
        if (other)
          gathered.add(
            "warning",
            "keys are written in other capitals than the definitions have them",
            `${key} is ${other} (${entity.named})`,
          );
        else if (known.defined) strangeKeys.push({ what: `${key} on ${classname}`, entity });
        else if (known.seen >= LEARNED_LEAST)
          unseenKeys.push({
            what: `${key} on ${classname} (which the maps have ${known.seen} times)`,
            entity,
          });
        continue;
      }
      if (defined.type) {
        const fault = faultOfValue(defined, value);
        if (fault && !contradicted(defined)) badValues.push(`${entity.named} ${key} "${value}" ${fault}`);
      } else if (
        defined.seen >= LEARNED_LEAST &&
        defined.numbers >= defined.seen &&
        value.trim() &&
        !numbersIn(value)
      )
        badValues.push(
          `${entity.named} ${key} "${value}" is not a number, and it is one every one of the ${defined.seen} times the mod's maps give it`,
        );
    }
  }
  if (absent.length)
    gathered.say(
      "error",
      `${counted(absent).length} classes are not in the game's own program (${definitions.from.filter((each) => each.startsWith("the game's program")).join(", ")}): the game cannot make such an entity, and drops it without a word: ${some(counted(absent))}`,
    );
  if (bare.size)
    gathered.say(
      "fact",
      `${bare.size} classes are in the game's program and in no FGD or map given, so their keys were not looked up: ${some([...bare].sort())}`,
    );
  if (undefinedClasses.length) {
    const items = counted(undefinedClasses);
    if (definitions.fgd)
      gathered.say(
        "error",
        `${items.length} classes are in none of the definitions given (${where}): a class the game does not have is dropped without a word: ${some(items)}`,
      );
    else
      gathered.say(
        "warning",
        `${items.length} classes were never seen in any of the mod's ${definitions.maps} maps: a class the game does not have is dropped without a word: ${some(items)}`,
      );
  }
  if (rare.length)
    gathered.say(
      "warning",
      `${counted(rare).length} classes are in no FGD given and in ${RARE_MAPS} of the mod's ${definitions.maps} maps only: a rare class, or that map's own mistake: ${some(counted(rare))}`,
    );
  if (forgotten.size)
    gathered.say(
      "fact",
      `${forgotten.size} classes are in no FGD given and in the mod's maps: ${some([...forgotten].sort())}`,
    );
  if (strangeKeys.length)
    gathered.say(
      "warning",
      `${counted(strangeKeys).length} keys their class does not define${definitions.maps ? `, nor has in any of the mod's ${definitions.maps} maps` : ""}: the game reads only the keys its code asks for, and the rest do nothing (a mod can read a key its FGD forgets: its own maps tell): ${some(counted(strangeKeys))}`,
    );
  if (unseenKeys.length)
    gathered.say(
      "warning",
      `${counted(unseenKeys).length} keys were never seen on their class in any of the mod's ${definitions.maps} maps: the game reads only the keys its code asks for: ${some(counted(unseenKeys))}`,
    );
  if (badValues.length)
    gathered.say("warning", `${badValues.length} values are not of their key's kind: ${some(badValues)}`);
}

// ── names ───────────────────────────────────────────────────────────────────
/** The keys of an entity that name another: `[[key, name]]`. */
function targetsOf(entity, known, mod) {
  const named = [];
  const firesOthers = isNamed(mod.targets.others, entity.classname);
  for (const [key, value] of entity.pairs) {
    if (key === "classname" || key === "targetname") continue;
    const defined = known?.keys[key];
    if (defined?.type === "target_destination" || mod.targets.keys.includes(key)) {
      if (value.trim()) named.push([key, value]);
    } else if (firesOthers && !defined && !mod.engineKeys.includes(key) && !COMPILER_KEYS.test(key))
      // a multi_manager's own keys are the names it fires; an editor writes a name given twice as name#1
      named.push([key, key.replace(/#\d+$/, "")]);
  }
  return named;
}

/** Every `target`, `killtarget` and `master` names an entity; the targetnames nothing names are listed. */
function checkNames(entities, live, definitions, mod, gathered, alsoNamed) {
  const names = new Map();
  for (const entity of entities) {
    const name = entity.get("targetname");
    if (name) names.set(name, [...(names.get(name) ?? []), entity]);
  }
  const lower = new Map([...names.keys()].map((name) => [name.toLowerCase(), name]));
  const called = new Set(alsoNamed);
  const lost = [];
  for (const entity of live) {
    for (const [key, name] of targetsOf(entity, definitions?.classes[entity.classname], mod)) {
      called.add(name);
      if (names.has(name) || isNamed(mod.named, name)) continue;
      const other = lower.get(name.toLowerCase());
      const shown = key === name ? `fires ${name}` : `${key} ${name}`;
      lost.push(`${entity.named} ${shown}${other ? ` (there is a ${other}: capitals count)` : ""}`);
    }
  }
  if (lost.length)
    gathered.say(
      "warning",
      `${lost.length} entities name something no entity of the map is called (a targetname): firing it does nothing: ${some(lost)}`,
    );
  const unnamed = [...names.keys()].filter((name) => !called.has(name)).sort();
  if (unnamed.length)
    gathered.say(
      "fact",
      `${unnamed.length} targetnames that nothing in the map names (the game's code or a script may): ${some(unnamed, 12)}`,
    );
  return names;
}

// ── a mod's rules ───────────────────────────────────────────────────────────
const whyOf = (rule) => (rule.why ? ` (${rule.why})` : "");
const ofClasses = (list, classes) =>
  classes ? list.filter((entity) => isNamed(classes, entity.classname)) : list;
/** A range as a rule of bands reads it: "150;500" is from 150 to 500, "500" from 500 up; null when it is neither. */
function rangeOf(value, separator, words = []) {
  const parts = value
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part && !words.includes(part));
  if (!parts.length) return null;
  if (parts.length > 2 || !parts.every((part) => NUMBER.test(part))) return null;
  return { from: Number(parts[0]), to: parts.length === 2 ? Number(parts[1]) : Infinity, text: value };
}

const KINDS = {
  limit(rule, { live, names, gathered }) {
    const byName = new Map();
    for (const entity of ofClasses(live, rule.of)) {
      const name = entity.get(rule.key);
      if (name) byName.set(name, [...(byName.get(name) ?? []), entity]);
    }
    for (const [name, list] of byName) {
      if (list.length <= rule.most) continue;
      const holders = ofClasses(names.get(name) ?? [], rule.to);
      if (rule.to && !holders.length) continue;
      const holder = holders[0] ? `the ${holders[0].classname} ${name}` : name;
      gathered.add(
        rule.level ?? "error",
        `entities are named by more others than they take${whyOf(rule)}`,
        `${holder} is named by the ${rule.key} of ${list.length} entities, and takes ${rule.most}`,
      );
    }
  },
  beside(rule, { live, gathered }) {
    const unless = rule.unless ?? [""];
    for (const entity of ofClasses(live, rule.classes)) {
      const value = entity.get(rule.key);
      if (value === undefined || unless.includes(value.trim()) || entity.get(rule.needs)) continue;
      gathered.add(
        rule.level ?? "warning",
        `entities give ${rule.key} with no ${rule.needs} beside it${whyOf(rule)}`,
        `${entity.named} ${rule.key} "${value}"`,
      );
    }
  },
  bands(rule, { live, gathered }) {
    const separator = rule.separator ?? ";";
    const groups = new Map();
    const headline = (key) => `entities give a ${key} that is no range (from${separator}to, or from)${whyOf(rule)}`;
    for (const entity of ofClasses(live, rule.classes)) {
      const place = (rule.among ?? ["origin"]).map((key) => entity.get(key));
      if (place.some((part) => part === undefined)) continue;
      const key = place.join(" | ");
      const value = entity.get(rule.key);
      if (value !== undefined && value.trim()) {
        const range = rangeOf(value, separator, rule.words);
        if (!range || range.to < range.from)
          gathered.add(rule.level ?? "warning", headline(rule.key), `${entity.named} ${rule.key} "${value}"`);
        else groups.set(key, [...(groups.get(key) ?? []), { ...range, entity }]);
      }
      // `open`: the ranges the map leaves empty at this place on purpose, a gap that is no fault
      const open = rule.open ? entity.get(rule.open) : undefined;
      for (const each of open?.split(/[\s,]+/).filter(Boolean) ?? []) {
        const range = rangeOf(each, separator, rule.words);
        if (!range || range.to < range.from)
          gathered.add(rule.level ?? "warning", headline(rule.open), `${entity.named} ${rule.open} "${open}"`);
        else groups.set(key, [...(groups.get(key) ?? []), { ...range, text: `${each} (left empty)`, entity, open: true }]);
      }
    }
    const reach = rule.whole ? 1 : 0;
    for (const [place, ranges] of groups) {
      if (ranges.length < 2) continue;
      ranges.sort((a, b) => a.from - b.from || a.to - b.to);
      const faults = [];
      for (let index = 1; index < ranges.length; index++) {
        const before = ranges[index - 1];
        const next = ranges[index];
        // the same range twice is one band given to two, or one gap said by two
        if (next.from === before.from && next.to === before.to && before.open === next.open) continue;
        if (next.from < before.to || (next.from === before.from && next.to === before.to))
          faults.push(`${before.text} and ${next.text} overlap (${before.entity.named}, ${next.entity.named})`);
        else if (next.from - before.to > reach)
          faults.push(`nothing has ${before.to} to ${next.from}, between ${before.text} and ${next.text} (${next.entity.named})`); // prettier-ignore
      }
      if (faults.length)
        gathered.add(
          rule.level ?? "warning",
          `places have ${rule.key} ranges that do not meet, or overlap${whyOf(rule)}`,
          `at ${place}: ${faults.join(", ")}`,
        );
    }
  },
  finite(rule, { live, gathered }) {
    for (const holder of ofClasses(live, rule.classes)) {
      const fires = holder.get(rule.when);
      const name = holder.get("targetname");
      if (!fires || !name) continue;
      const all = live.filter((entity) => entity.get(rule.counted) === name);
      const endless = all.filter((entity) => {
        const count = entity.get(rule.count);
        return count === undefined || !NUMBER.test(count.trim()) || Number(count) <= 0;
      });
      if (!endless.length) continue;
      const first = endless[0];
      const has = first.get(rule.count);
      gathered.add(
        rule.level ?? "warning",
        `entities wait for others that never run out${whyOf(rule)}`,
        `the ${holder.classname} ${name} (${rule.when} ${fires}): ${endless.length} of the ${all.length} that name it have no ${rule.count} over 0, the first ${first.named} with ${has === undefined ? `no ${rule.count}` : `${rule.count} "${has}"`}`,
      );
    }
  },
  names(rule, { entities, live, gathered, tools }) {
    const key = rule.key;
    const ofKey = rule.of?.key ?? "targetname";
    const known = rule.of
      ? new Set(
          ofClasses(entities, rule.of.classes)
            .map((entity) => entity.get(ofKey))
            .filter(Boolean),
        )
      : null;
    const what = rule.what ?? (rule.of ? `the ${ofKey} of an entity of this map` : "a name that exists");
    for (const entity of ofClasses(live, rule.classes)) {
      const value = entity.get(key);
      if (value === undefined || !value.trim()) {
        if (rule.required)
          gathered.add(rule.level ?? "warning", `entities have no ${key}${whyOf(rule)}`, entity.named);
        continue;
      }
      if (known?.has(value)) continue;
      let more = "";
      if (rule.among) {
        const answer = rule.among(value, entity, tools);
        if (answer === true || answer === undefined || answer === null) continue;
        if (typeof answer === "string") more = `: ${answer}`;
      } else if (!known) continue;
      gathered.add(
        rule.level ?? "warning",
        `entities give a ${key} that is not ${what}${whyOf(rule)}`,
        `${entity.named} ${key} "${value}"${more}`,
      );
    }
  },
};
/** The key by which each kind of rule has one entity name another: such a name is not one "nothing names". */
const NAMING_KEY = { limit: "key", finite: "counted" };

/** The profile's rules, each run; what a rule of an unknown kind or a broken function says is said. */
function checkRules(context, mod) {
  const { gathered } = context;
  for (const rule of mod.rules) {
    if (typeof rule === "function") {
      for (const said of rule(context.live, context.tools) ?? [])
        if (typeof said === "string") gathered.say("warning", said);
        else if (said?.text) gathered.say(said.level ?? "warning", said.text);
      continue;
    }
    const kind = KINDS[rule?.rule];
    if (!kind)
      throw new Error(
        `mod: a rule is a function or { rule: ${Object.keys(KINDS).join(" | ")} }, not ${JSON.stringify(rule?.rule)}`,
      );
    kind(rule, context);
  }
}

/** The names the rules have entities call one another by, so that such a name counts as named. */
function namedByRules(live, mod) {
  const called = [];
  for (const rule of mod.rules) {
    if (typeof rule === "function") continue;
    const key =
      rule.rule === "names" && (rule.of?.key ?? "targetname") === "targetname"
        ? rule.key
        : rule[NAMING_KEY[rule.rule]];
    if (key) for (const entity of live) if (entity.get(key)) called.push(entity.get(key));
  }
  return called;
}

// ── files ───────────────────────────────────────────────────────────────────
/**
 * Looks for the game's files as a Linux server would: by their very letters. `find(relative)` gives
 * `{ found, exact, as }`: `found` whatever the case, `exact` when some folder has it letter for letter, and
 * `as` how the first folder that has it writes it.
 */
export function fileFinder(folders) {
  const listings = new Map();
  const listing = (folder) => {
    if (!listings.has(folder)) {
      const byLower = new Map();
      try {
        for (const name of readdirSync(folder)) byLower.set(name.toLowerCase(), [...(byLower.get(name.toLowerCase()) ?? []), name]); // prettier-ignore
      } catch {
        // a folder that is not there holds nothing
      }
      listings.set(folder, byLower);
    }
    return listings.get(folder);
  };
  const inFolder = (folder, parts) => {
    let at = folder;
    let exact = true;
    const as = [];
    for (const part of parts) {
      const names = listing(at).get(part.toLowerCase());
      if (!names) return null;
      const name = names.includes(part) ? part : names[0];
      if (name !== part) exact = false;
      as.push(name);
      at = join(at, name);
    }
    return { exact, as: as.join("/") };
  };
  return {
    find(relative) {
      const parts = relative.replace(/\\/g, "/").split("/").filter(Boolean);
      let loose = null;
      for (const folder of folders) {
        const found = existsSync(folder) ? inFolder(folder, parts) : null;
        if (found?.exact) return { found: true, exact: true, as: found.as };
        loose ??= found;
      }
      return loose ? { found: true, exact: false, as: loose.as } : { found: false, exact: false, as: null };
    },
  };
}

/** The files a map's entities name: `[{ kind, name, paths, entity }]`, each to be found at one of `paths`. */
function filesNamed(live, mod, plan) {
  const wanted = [];
  const want = (kind, name, paths, entity) => wanted.push({ kind, name, paths, entity });
  for (const entity of live) {
    for (const [key, value] of entity.pairs) {
      const name = value.trim().replace(/\\/g, "/");
      if (/\.mdl$/i.test(name) && !BRUSH_MODEL.test(name)) want("models", name, [name], entity);
      else if (/\.spr$/i.test(name)) want("sprites", name, [name], entity);
      else if (/\.wav$/i.test(name) && !name.startsWith("!")) {
        const file = name.replace(SOUND_MARKS, "");
        want("sounds", file, [`${SOUND_FOLDER}/${file}`], entity);
      }
      if (entity.number === 0 && key === "skyname" && name)
        for (const side of SKY_SIDES)
          want("sky pictures", `${name}${side}`, SKY_KINDS.map((kind) => `${SKY_FOLDER}/${name}${side}.${kind}`), entity); // prettier-ignore
      // a compiled map's .wad files are looked for by `checkBsp` itself, with their textures
      if (entity.number === 0 && key === "wad" && plan)
        for (const wad of listedWads(value)) want(".wad files", wad, [wad], entity);
    }
    for (const rule of mod.files) {
      if (rule.classes && !isNamed(rule.classes, entity.classname)) continue;
      const unless = (rule.unless ?? []).map((name) => name.toLowerCase());
      const names = [];
      if (rule.key && entity.get(rule.key)) names.push(entity.get(rule.key));
      if (rule.keys) for (const [key] of entity.pairs) if (isNamed([rule.keys].flat(), key)) names.push(key);
      for (const name of names) {
        if (unless.includes(name.toLowerCase())) continue;
        const file = name.trim().replace(/\\/g, "/");
        const paths = (rule.folders ?? [""]).map((folder) => (folder ? `${folder}/${file}` : file));
        want(rule.what ?? "files", file, paths, entity);
      }
    }
  }
  return wanted;
}

/** Every file the entities and the worldspawn name is in the game's folders, in the very letters. */
function checkFiles(live, mod, folders, plan, gathered) {
  const wanted = filesNamed(live, mod, plan);
  if (!wanted.length) return;
  if (!folders?.length) {
    gathered.say(
      "fact",
      `no game folders were given: the ${wanted.length} files the entities name were not looked for`,
    );
    return;
  }
  const finder = fileFinder(folders);
  const seen = new Map();
  const counts = new Map();
  for (const { kind, name, paths, entity } of wanted) {
    const key = paths.join("|");
    if (seen.has(key)) continue;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    const tried = paths.map((path) => ({ path, ...finder.find(path) }));
    const best = tried.find((each) => each.exact) ?? tried.find((each) => each.found);
    seen.set(key, best);
    if (!best)
      gathered.add(
        "warning",
        `${kind} are in none of the game's folders given${MISSED[kind] ? ` (${MISSED[kind]})` : ""}`,
        `${name} (${entity.named})`,
      );
    else if (!best.exact)
      gathered.add(
        "warning",
        "files are found only in other capitals than the map writes: Windows finds them, and a server on Linux, which tells capitals from small letters, does not",
        `${best.path} is ${best.as} (${entity.named})`,
      );
  }
  gathered.say(
    "fact",
    `files the entities name, looked for in ${folders.length} folders: ${[...counts].map(([kind, count]) => `${count} ${kind}`).join(", ")}`,
  );
}

// ── the whole ───────────────────────────────────────────────────────────────
/**
 * A map's entities against a mod: `{ errors, warnings, facts }`, lists of sentences. `map` is brush source
 * (what `writeMap` takes) or a compiled map (what `readBsp` gave). `checkPlan` and `checkBsp` call this when
 * they are given `mod` or `definitions`, and put its sentences among their own.
 *
 *   mod           the mod's profile (mod.mjs); without one, `GOLDSRC`
 *   definitions   entity definitions beside the profile's own: what `definitionsOf` (an FGD) or
 *                 `learnEntities` (the mod's maps) gave, an .fgd file's path, or a list of these
 *   folders       the game's folders (the profile's, unless given): where the files are looked for
 *
 * With definitions:
 *   a class that is not defined          an error with an FGD, a warning when the definitions are only
 *                                        learned ("never seen in any of the mod's 100 maps"); a class no FGD
 *                                        has and one map only, a warning. With the game's own program
 *                                        (a profile's `dlls`), that alone decides: a class it does not
 *                                        export is an error, and one it exports is none
 *   a point class given brushes, a brush class given none; a key the class does not define (a mod reads
 *   keys its FGD forgets: a key the mod's maps give that class is not told); a value that is not of the
 *   key's type or not among its choices (not told when the mod's own maps do the same)     warnings
 * Always:
 *   a `target`, `killtarget`, `master` or any key of the type `target_destination` that names no entity     a warning
 *   the targetnames nothing names                                                                     a fact
 *   the profile's rules (see the head of this file)
 *   with folders: every model, sprite, sound, sky picture and (for source) .wad file named is in the
 *   folders; one found only in other capitals is told, as a server on Linux would not find it         warnings
 * An entity whose classname the profile's `off` names (`disabled_*`) is switched off on purpose: it is
 * counted in a fact and not looked up, though its targetname is still a name of the map.
 */
export function checkEntities(map, options = {}) {
  const mod = modOf(options.mod) ?? modOf(GOLDSRC);
  const definitions = definitionsFor(options.mod ? mod : null, options.definitions);
  const folders = options.folders ?? (mod.folders.length ? mod.folders : undefined);
  const entities = entitiesOf(map);
  const live = entities.filter((entity) => !isNamed(mod.off, entity.classname));
  const gathered = gatherer();
  if (definitions) {
    const count = Object.keys(definitions.classes).length;
    gathered.say("fact", `entity definitions: ${count} classes from ${definitions.from.join(", ")}`);
    checkDefined(live, definitions, mod, gathered);
  } else
    gathered.say("fact", "no entity definitions were given (an FGD, or learned from the mod's maps): classes and keys were not looked up"); // prettier-ignore
  const names = checkNames(entities, live, definitions, mod, gathered, namedByRules(live, mod));
  const tools = { names, mod, definitions, folders, finder: folders?.length ? fileFinder(folders) : null };
  checkRules({ entities, live, names, gathered, tools }, mod);
  checkFiles(live, mod, folders, !isCompiled(map), gathered);
  // how the monsters come (encounters.mjs): for a mod whose profile says how its spawn areas work
  if (mod.spawns && options.encounters !== false) {
    const encounters = spawnsOf(map, { mod });
    for (const text of encounters.warnings) gathered.say("warning", text);
    for (const text of encounters.facts) gathered.say("fact", text);
  }
  if (live.length < entities.length) {
    const off = new Map();
    for (const entity of entities)
      if (!live.includes(entity)) off.set(entity.classname, (off.get(entity.classname) ?? 0) + 1);
    gathered.say(
      "fact",
      `${entities.length - live.length} entities are switched off by their classname: ${some([...off].map(([classname, count]) => `${count} ${classname}`))}`,
    );
  }
  return gathered.done();
}
