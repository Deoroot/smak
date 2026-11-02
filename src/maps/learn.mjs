// Entity definitions learned from a mod's own maps, for when there is no FGD or the FGD is wrong. A map's
// entity text is the one place where what a mod's authors really wrote can be counted: every class with how
// often it appears and whether it is a point or made of brushes, every key of it with how often and what
// values, and the keys that are always given together.
//
// It is weaker than the game's code and says so in numbers: "never seen in any of the mod's 100 maps" is a
// reason to look, not a proof; and a mistake that one of the mod's maps makes is learned with the rest. Used
// in place of an FGD, or beside one (`joinDefinitions` of mod.mjs): where the FGD forgets a key that eighty
// maps give, the maps are believed.
//
// Only each map's header and its entity text are read: a hundred maps take a second or two, and the answer
// can be kept in a file (`cache`) that is read again as long as no map of the folder has changed.
import { openSync, readSync, closeSync, statSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { parseEntities } from "./entities.mjs";
import { BSP_VERSION, BSP2_VERSION, HEADER_SIZE } from "./lumps.mjs";

/** The form of what is kept in a cache file: one written in another form is learned again. */
const FORM = 2;
/** A key's different values are counted up to this many; past it only that there are more is kept. */
const VALUES_COUNTED = 64;
/** How many of a key's commonest values are kept as examples. */
const VALUES_KEPT = 6;
/** An example longer than this is cut. */
const LONGEST_EXAMPLE = 80;
/** How many maps a class is said to be in by name. */
const MAPS_NAMED = 3;
/** Keys that are given together fewer times than this are not said to belong together. */
const TOGETHER_LEAST = 3;
/** The text every entity lump holds, and where the header keeps the first two lumps. */
const ENTITY_MARK = '"classname"';
const FIRST_LUMP = 4;
const LUMP_SIZE = 8;
const BRUSH_MODEL = /^\*\d+$/;
const WHOLE = /^[-+]?\d+$/;
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/**
 * A map's entities from its file, with only the header and the entity text read: a list of entities, each a
 * list of `[key, value]` pairs (`parseEntities`); null when the file is no GoldSrc map (version 30 or Xash's BSP2). For asking a mod's
 * whole folder of maps a question of one's own in a second.
 */
export function entitiesOfFile(file) {
  const handle = openSync(file, "r");
  try {
    const header = Buffer.alloc(HEADER_SIZE);
    if (readSync(handle, header, 0, HEADER_SIZE, 0) < HEADER_SIZE) return null;
    const version = header.readInt32LE(0);
    if (version !== BSP_VERSION && version !== BSP2_VERSION) return null;
    // the entities are the first lump; in a Blue Shift map, the second
    for (const slot of [0, 1]) {
      const offset = header.readInt32LE(FIRST_LUMP + slot * LUMP_SIZE);
      const length = header.readInt32LE(FIRST_LUMP + slot * LUMP_SIZE + 4);
      if (offset < HEADER_SIZE || length <= 0) continue;
      const lump = Buffer.alloc(length);
      if (readSync(handle, lump, 0, length, offset) < length) continue;
      if (lump.includes(ENTITY_MARK, 0, "latin1")) return parseEntities(lump);
    }
    return null;
  } finally {
    closeSync(handle);
  }
}

/** A number that stands for one entity of a class, for telling which keys are given by the same entities. */
const markOf = (index) => Math.imul(index + 1, 2654435761) >>> 0;

/** What is counted of one class while the maps are read. */
const newClass = () => ({ seen: 0, maps: 0, point: 0, solid: 0, in: [], keys: new Map(), lastMap: -1 });
const newKey = () => ({ seen: 0, maps: 0, whole: 0, numbers: 0, values: new Map(), more: false, sum: 0, mix: 0, lastMap: -1 }); // prettier-ignore

/** One map's entities added to the count. */
function count(classes, entities, mapIndex, mapName) {
  for (const entity of entities) {
    let classname;
    let brush = false;
    for (const [key, value] of entity) {
      if (key === "classname") classname ??= value;
      else if (key === "model" && BRUSH_MODEL.test(value)) brush = true;
    }
    if (!classname) continue;
    let known = classes.get(classname);
    if (!known) classes.set(classname, (known = newClass()));
    const index = known.seen++;
    if (known.lastMap !== mapIndex) {
      known.lastMap = mapIndex;
      known.maps++;
      if (known.in.length < MAPS_NAMED) known.in.push(mapName);
    }
    if (brush || classname === "worldspawn") known.solid++;
    else known.point++;
    const given = new Set();
    for (const [key, value] of entity) {
      if (key === "classname") continue;
      let stats = known.keys.get(key);
      if (!stats) known.keys.set(key, (stats = newKey()));
      if (!given.has(key)) {
        given.add(key);
        stats.seen++;
        stats.sum = (stats.sum + markOf(index)) >>> 0;
        stats.mix ^= Math.imul(markOf(index), 40503) >>> 0;
        if (stats.lastMap !== mapIndex) {
          stats.lastMap = mapIndex;
          stats.maps++;
        }
      }
      const text = value.trim();
      if (WHOLE.test(text)) stats.whole++;
      if (NUMBER.test(text)) stats.numbers++;
      const example = value.length > LONGEST_EXAMPLE ? `${value.slice(0, LONGEST_EXAMPLE)}...` : value;
      if (stats.values.has(example)) stats.values.set(example, stats.values.get(example) + 1);
      else if (stats.values.size < VALUES_COUNTED) stats.values.set(example, 1);
      else stats.more = true;
    }
  }
}

/** What was counted, as plain data: the classes by name, each with its keys by name. */
function summed(classes) {
  const out = {};
  for (const name of [...classes.keys()].sort()) {
    const known = classes.get(name);
    const keys = {};
    const always = [];
    const groups = new Map();
    for (const key of [...known.keys.keys()].sort()) {
      const stats = known.keys.get(key);
      keys[key] = {
        seen: stats.seen,
        maps: stats.maps,
        whole: stats.whole,
        numbers: stats.numbers,
        distinct: stats.values.size,
        more: stats.more,
        values: [...stats.values].sort((a, b) => b[1] - a[1]).slice(0, VALUES_KEPT),
      };
      if (stats.seen === known.seen) always.push(key);
      else if (stats.seen >= TOGETHER_LEAST) {
        const same = `${stats.seen} ${stats.sum} ${stats.mix}`;
        groups.set(same, [...(groups.get(same) ?? []), key]);
      }
    }
    out[name] = {
      kind: known.solid && known.point ? "either" : known.solid ? "solid" : "point",
      defined: false,
      seen: known.seen,
      maps: known.maps,
      point: known.point,
      solid: known.solid,
      in: known.in,
      keys,
      always,
      together: [...groups.values()].filter((group) => group.length > 1),
    };
  }
  return out;
}

/** The maps of a folder, or the files given, each with what tells a changed file from the same one. */
function filesOf(source, except) {
  const left = new Set(except.map((name) => basename(name).toLowerCase()));
  // a folder that is not there (a mod's overlay with no maps of its own) has no maps to learn from
  const paths = Array.isArray(source)
    ? source
    : !existsSync(source)
      ? []
      : readdirSync(source)
        .filter((name) => /\.bsp$/i.test(name))
        .sort()
        .map((name) => join(source, name));
  return paths
    .filter((file) => !left.has(basename(file).toLowerCase()))
    .map((file) => {
      const stat = statSync(file);
      return { file, name: basename(file), size: stat.size, changed: Math.round(stat.mtimeMs) };
    });
}

/** A cache file's content when it is of these very files, else null. */
function cached(cache, files) {
  let kept;
  try {
    kept = JSON.parse(readFileSync(cache, "utf8"));
  } catch {
    return null;
  }
  if (kept?.form !== FORM || !Array.isArray(kept.files) || kept.files.length !== files.length) return null;
  const same = files.every((file, index) => {
    const other = kept.files[index];
    return other.name === file.name && other.size === file.size && other.changed === file.changed;
  });
  return same ? kept : null;
}

/**
 * What a mod's own maps say of its entities. `source`: the folder its .bsp files are in (`<mod>/maps`), or a
 * list of .bsp files.
 *
 *   cache    a file to keep the answer in. When it is there and is of the same maps (their names, sizes and
 *            dates), it is read and no map is; else the maps are read and it is written
 *   except   maps to leave out, by file name: to check one of the mod's own maps against the others
 *
 * It returns definitions, as `definitionsOf` gives for an FGD and with the same use:
 *
 *   { from: ["100 maps of <folder>"], fgd: false, maps: 100, files, skipped,
 *     classes: { name: {
 *       kind       "point", "solid", or "either" when the maps have it both ways
 *       seen       how many entities of the class the maps have; `maps`: in how many maps; `in`: three of them
 *       point, solid   how many of them are point entities, and how many are made of brushes
 *       keys       { key: { seen, maps, whole, numbers, distinct, more, values: [[value, times]] } }:
 *                  in how many entities and maps, how many of its values are whole numbers and numbers, how
 *                  many different values (counted up to 64: `more` says there are others) and the six commonest
 *       always     the keys every entity of the class gives
 *       together   [[key, key]]: keys that the very same entities give, and no others } } }
 *
 * `skipped` names the files that are not GoldSrc maps. Plain data: `JSON.stringify` keeps it whole.
 */
export function learnEntities(source, { cache, except = [] } = {}) {
  if (typeof source !== "string" && !Array.isArray(source))
    throw new Error("learnEntities: the folder of a mod's .bsp files, or a list of .bsp files");
  const files = filesOf(source, except);
  if (cache) {
    const kept = cached(cache, files);
    if (kept) return kept;
  }
  const classes = new Map();
  const skipped = [];
  const read = [];
  for (const file of files) {
    const entities = entitiesOfFile(file.file);
    if (!entities) {
      skipped.push(file.name);
      continue;
    }
    count(classes, entities, read.length, file.name.replace(/\.bsp$/i, ""));
    read.push(file);
  }
  const where = Array.isArray(source) ? "the maps given" : source.replace(/\\/g, "/");
  const learned = {
    form: FORM,
    from: [`${read.length} maps of ${where}`],
    fgd: false,
    maps: read.length,
    files: files.map(({ name, size, changed }) => ({ name, size, changed })),
    skipped,
    classes: summed(classes),
  };
  if (cache) writeFileSync(cache, JSON.stringify(learned));
  return learned;
}
