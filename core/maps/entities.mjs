// A compiled map's entities: the text the map keeps them as, read, changed and written back, and put into
// the map in place of what it had.
//
// The entity lump is plain text, one block an entity:
//
//   {
//   "classname" "light"
//   "origin" "96 96 100"
//   }
//
// with a zero byte after the last. An entity is a list of pairs, in the file's order, because a map can give
// a key more than once (several `target`s, a script's repeated settings) and the game reads them in turn:
//
//   an entity    [["classname", "light"], ["origin", "96 96 100"]]
//   entities     a list of them; the first is the worldspawn, the map itself
//
// An entity that was read and not changed is written back with the very text it was read from, whatever its
// spacing, so a map whose entities were read and written with nothing changed is the same file byte for
// byte. One that was changed, or made here, is written in the compilers' own form, the one above.
//
//   reading    parseEntities writeEntities entityLump
//   finding    byClass byKey byModel worldspawn
//   values     valueOf valuesOf numberOf vectorOf originOf anglesOf brushModelOf isBrushEntity asObject
//   changing   setKey removeKey moveEntity addEntity removeEntity      (each returns a new list)
//   the map    withEntities
import { readLumps, lumpBytes, pointLump, LUMP_NAMES } from "./lumps.mjs";

// ── the text ───────────────────────────────────────────────────────────────
const OPEN = "{";
const CLOSE = "}";
const QUOTE = '"';
const COMMENT = "//";
/** What ends a word that is not in quotes, besides a blank. */
const ENDS_A_BARE_WORD = [QUOTE, OPEN, CLOSE];
/** What ends the entity text inside its lump: a zero byte, as for any text in C. */
const TERMINATOR = "\0";
/** The engine reads every byte up to a space as blank between words. */
const isBlank = (letter) => letter <= " ";
/** A brush entity's `model` is `*` and the number of its model in the map. */
const BRUSH_MODEL = /^\*(\d+)$/;
/**
 * The longest value both engines read (their word buffer is 1024 bytes), and the longest key the compilers
 * take.
 */
export const LONGEST_VALUE = 1023;
export const LONGEST_KEY = 31;
/** Lumps begin on a multiple of four bytes. */
const LUMP_ALIGNMENT = 4;
/**
 * The letters that begin the block of extra lumps some tools put after a map's own, where Xash looks for it.
 */
const BSPX_ID = "BSPX";

/**
 * How each entity that was read stood in the file: `text`, from its `{` to its `}`; `pairs`, a copy of what
 * was read, by which a later change is told; `lead`, what stood before it when it was the first; `after`,
 * what stood between its `}` and the next entity; `newline`, the line ending it used. An entity made from
 * another keeps the other's `after` and `newline` and has no `text`.
 */
const asRead = new WeakMap();
const DEFAULT_STYLE = { lead: "", after: "\n", newline: "\n" };

// ── reading ────────────────────────────────────────────────────────────────
/** Where the next thing that is not blank or a comment begins, from `at`. */
function skipBlank(text, at) {
  for (;;) {
    while (at < text.length && isBlank(text[at])) at++;
    if (!text.startsWith(COMMENT, at)) return at;
    while (at < text.length && text[at] !== "\n") at++;
  }
}
/**
 * The word at `at`: `{ word, end }`. A word in quotes runs to the next quote, with whatever is between
 * (GoldSrc knows no way to put a quote inside one); a bare word runs to the next blank, quote or brace.
 */
function wordAt(text, at) {
  if (text[at] === QUOTE) {
    const close = text.indexOf(QUOTE, at + 1);
    const end = close < 0 ? text.length : close;
    return { word: text.slice(at + 1, end), end: Math.min(end + 1, text.length) };
  }
  let end = at;
  while (end < text.length && !isBlank(text[end]) && !ENDS_A_BARE_WORD.includes(text[end])) end++;
  return { word: text.slice(at, Math.max(end, at + 1)), end: Math.max(end, at + 1) };
}

/** The pairs of the entity whose `{` is at `open`, and where its `}` ends: `{ pairs, end }`. */
function entityAt(text, open) {
  const pairs = [];
  let key = null;
  let at = open + 1;
  for (;;) {
    at = skipBlank(text, at);
    if (at >= text.length) break;
    if (text[at] === CLOSE) {
      at++;
      break;
    }
    const { word, end } = wordAt(text, at);
    at = end;
    if (key === null) key = word;
    else {
      pairs.push([key, word]);
      key = null;
    }
  }
  // a key with nothing after it is kept, with an empty value
  if (key !== null) pairs.push([key, ""]);
  return { pairs, end: at };
}

/**
 * The entities of a map's entity text: a list, each a list of `[key, value]` pairs in the file's order, with
 * keys given twice kept twice. `source` is the text or the lump's bytes; what follows its first zero byte is
 * not read. `readBsp` calls this: a map's are in `bsp.entities`.
 */
export function parseEntities(source) {
  const whole = typeof source === "string" ? source : Buffer.from(source).toString("latin1");
  const stop = whole.indexOf(TERMINATOR);
  const text = stop < 0 ? whole : whole.slice(0, stop);
  const entities = [];
  let at = 0;
  let gapFrom = 0;
  let last = null;
  for (;;) {
    at = skipBlank(text, at);
    if (at >= text.length) break;
    if (text[at] !== OPEN) {
      // something that is not an entity: left in the text between entities, and so written back as it is
      at = wordAt(text, at).end;
      continue;
    }
    const gap = text.slice(gapFrom, at);
    const { pairs, end } = entityAt(text, at);
    const source = text.slice(at, end);
    const record = {
      text: source,
      pairs: pairs.map((pair) => [...pair]),
      lead: last ? "" : gap,
      after: "",
      newline: source.includes("\r\n") ? "\r\n" : "\n",
    };
    if (last) last.after = gap;
    asRead.set(pairs, record);
    entities.push(pairs);
    last = record;
    at = end;
    gapFrom = end;
  }
  if (last) last.after = text.slice(gapFrom);
  return entities;
}

/**
 * What ends a map's entity text in its lump: everything from the first zero byte on (as a rule, that byte
 * alone).
 */
function terminatorOf(lump) {
  const stop = lump.indexOf(0);
  return stop < 0 ? "" : lump.toString("latin1", stop);
}

// ── writing ────────────────────────────────────────────────────────────────
/** Whether an entity still holds exactly the pairs it was read with. */
function unchanged(entity, record) {
  if (record.text === undefined || entity.length !== record.pairs.length) return false;
  return entity.every(
    (pair, index) => pair[0] === record.pairs[index][0] && pair[1] === record.pairs[index][1],
  );
}
/** Refuses a key or a value that the text cannot hold. */
function refuseUnwritable(key, value) {
  for (const [what, text] of [
    ["key", key],
    ["value", value],
  ]) {
    if (typeof text !== "string")
      throw new Error(
        `an entity's ${what} must be text, not ${JSON.stringify(text)} (key ${JSON.stringify(key)})`,
      );
    if (text.includes(QUOTE))
      throw new Error(
        `the ${what} ${JSON.stringify(text)} has a quote in it, and the entity text has no way to write one`,
      );
    if (text.includes(TERMINATOR))
      throw new Error(`the ${what} of ${JSON.stringify(key)} has a zero byte in it`);
  }
  if (!key) throw new Error("an entity's key cannot be empty");
  if (value.length > LONGEST_VALUE)
    throw new Error(
      `the value of ${JSON.stringify(key)} is ${value.length} letters long: the engine reads ${LONGEST_VALUE} at the most`,
    );
}
/** An entity in the compilers' form: a line for each brace and each pair. */
function written(entity, newline) {
  const lines = entity.map(([key, value]) => {
    refuseUnwritable(key, value);
    return `${QUOTE}${key}${QUOTE} ${QUOTE}${value}${QUOTE}`;
  });
  return [OPEN, ...lines, CLOSE].join(newline);
}

/**
 * The entity text of a list of entities, with no zero byte after it. Entities that were read and not
 * changed come out as they stood in the file; the others in the compilers' form, with the file's line
 * endings.
 */
export function writeEntities(entities) {
  // a class that precaches its model, with none named, stops the map on load: no entity lump is written with one
  const empty = modelless(entities.filter(Array.isArray), valueOf);
  if (empty.length)
    throw new Error(`writeEntities: ${empty.map(({ entity }) => valueOf(entity, "classname")).join(", ")} precache a model and name none: the map would stop on load ("PF_precache_model_I: Bad string ''"). Give each its model (a sprite for env_sprite and env_glow)`);
  // how a new entity is set apart from the next: as the file's own are
  const model = entities.map((entity) => asRead.get(entity)).find(Boolean) ?? DEFAULT_STYLE;
  let text = "";
  entities.forEach((entity, index) => {
    if (!Array.isArray(entity))
      throw new Error(`entity ${index} is not a list of [key, value] pairs: ${JSON.stringify(entity)}`);
    const record = asRead.get(entity) ?? {
      after: model.after || DEFAULT_STYLE.after,
      newline: model.newline,
    };
    if (index === 0 && record.lead) text += record.lead;
    text += unchanged(entity, record) ? record.text : written(entity, record.newline);
    text += record.after;
  });
  return text;
}

/**
 * The bytes of an entity lump: the text of `entities`, then `terminator` (a zero byte unless another is
 * given). `withEntities` uses this with the terminator of the map being changed.
 */
export const entityLump = (entities, terminator = TERMINATOR) =>
  Buffer.from(writeEntities(entities) + terminator, "latin1");

// ── values ─────────────────────────────────────────────────────────────────
/** An entity's value for a key: the first, when the key is given more than once; undefined when it is not. */
export const valueOf = (entity, key) => entity.find((pair) => pair[0] === key)?.[1];
/** Every value an entity gives for a key, in order. */
export const valuesOf = (entity, key) => entity.filter((pair) => pair[0] === key).map((pair) => pair[1]);
/** An entity as an object, for reading: of a key given twice, the first value. */
export const asObject = (entity) => Object.fromEntries([...entity].reverse());
/** A value as a number, or `otherwise` when the key is missing or does not begin with a number. */
export function numberOf(entity, key, otherwise = undefined) {
  const number = parseFloat(valueOf(entity, key));
  return Number.isFinite(number) ? number : otherwise;
}
/**
 * A value of three numbers (`"96 96 40"`) as `[x, y, z]`, or null when the key is missing or is not three
 * numbers.
 */
export function vectorOf(entity, key) {
  const value = valueOf(entity, key);
  if (value === undefined) return null;
  const numbers = value.trim().split(/\s+/).map(Number);
  return numbers.length === 3 && numbers.every(Number.isFinite) ? numbers : null;
}
/**
 * Where a point entity is, `[x, y, z]`; for a brush entity, how far it is shifted from where it was compiled.
 * Null when it has no `origin`.
 */
export const originOf = (entity) => vectorOf(entity, "origin");
/** The yaw the editors' `angle` key stands for when it is not a turn but "up" or "down". */
const ANGLE_UP = -1;
const ANGLE_DOWN = -2;
const PITCH_UP = -90;
const PITCH_DOWN = 90;
/**
 * The way an entity faces, `[pitch, yaw, roll]` in degrees: its `angles`, or what its older `angle` key
 * stands for (a yaw, or -1 for up and -2 for down), or `[0, 0, 0]`.
 */
export function anglesOf(entity) {
  const angles = vectorOf(entity, "angles");
  if (angles) return angles;
  const angle = numberOf(entity, "angle");
  if (angle === undefined) return [0, 0, 0];
  if (angle === ANGLE_UP) return [PITCH_UP, 0, 0];
  if (angle === ANGLE_DOWN) return [PITCH_DOWN, 0, 0];
  return [0, angle, 0];
}
/**
 * The number of the map's model a brush entity is made of (`"model" "*3"`: 3), or null for a point entity.
 */
export function brushModelOf(entity) {
  const match = BRUSH_MODEL.exec(valueOf(entity, "model") ?? "");
  return match ? Number(match[1]) : null;
}
/** Whether an entity is made of brushes: the worldspawn, or one whose `model` is `*N`. */
export const isBrushEntity = (entity) =>
  valueOf(entity, "classname") === "worldspawn" || brushModelOf(entity) !== null;

// ── finding ────────────────────────────────────────────────────────────────
/** The entities of a class: `classname` is the whole name, or a RegExp. */
export const byClass = (entities, classname) =>
  entities.filter((entity) => {
    const name = valueOf(entity, "classname") ?? "";
    return classname instanceof RegExp ? classname.test(name) : name === classname;
  });
/** The entities that have a key, or that give it this value (in any of the times they give it). */
export const byKey = (entities, key, value = undefined) =>
  entities.filter((entity) =>
    entity.some((pair) => pair[0] === key && (value === undefined || pair[1] === String(value))),
  );
/**
 * The entities made of the map's model `number` (as a rule one; a map can show one model in several places).
 */
export const byModel = (entities, number) => entities.filter((entity) => brushModelOf(entity) === number);
/** The map's own entity, which holds its `wad`, `skyname`, `message` and the like. */
export const worldspawn = (entities) => byClass(entities, "worldspawn")[0];

// ── changing ───────────────────────────────────────────────────────────────
/** The place in the list of `which`: an entity of the list, or its number. Throws when it is neither. */
function placeOf(entities, which) {
  const index = typeof which === "number" ? which : entities.indexOf(which);
  if (!Number.isInteger(index) || index < 0 || index >= entities.length)
    throw new Error(
      typeof which === "number"
        ? `no entity ${which}: the map has ${entities.length}, numbered from 0`
        : "that entity is not in this list (a change gives a new list: take the entity from it)",
    );
  return index;
}
/**
 * A list in which the entity at `index` is replaced by `changed`, which stands in the file where it stood.
 */
function replaced(entities, index, changed) {
  const record = asRead.get(entities[index]);
  if (record) asRead.set(changed, { ...record, text: undefined });
  const list = [...entities];
  list[index] = changed;
  return list;
}
/** A number as an entity's value: whole when it is whole, else to four decimals. */
const numberText = (number) => String(Math.round(number * 1e4) / 1e4);
/** Three numbers as a value. */
function vectorText(vector, what) {
  if (!Array.isArray(vector) || vector.length !== 3 || !vector.every(Number.isFinite))
    throw new Error(`${what} must be three numbers [x, y, z], not ${JSON.stringify(vector)}`);
  return vector.map(numberText).join(" ");
}
/** What is said of an entity in a refusal. */
const described = (entity, index) => `entity ${index} (${valueOf(entity, "classname") ?? "no classname"})`;

/**
 * A new list in which entity `which` (an entity of the list, or its number) has `key` set to `value`: the
 * first pair of that key is changed where it stands, or the pair is added at the end. `value` may be a
 * number, or `[x, y, z]`.
 */
export function setKey(entities, which, key, value) {
  const index = placeOf(entities, which);
  let text = value;
  if (Array.isArray(value)) text = vectorText(value, `the value of ${key}`);
  else if (typeof value === "number") text = numberText(value);
  refuseUnwritable(key, text);
  const entity = entities[index];
  const at = entity.findIndex((pair) => pair[0] === key);
  const changed = entity.map((pair) => [...pair]);
  if (at < 0) changed.push([key, text]);
  else changed[at][1] = text;
  return replaced(entities, index, changed);
}

/** A new list in which entity `which` has no `key`: every pair of that key is taken out. */
export function removeKey(entities, which, key) {
  const index = placeOf(entities, which);
  if (key === "classname")
    throw new Error("an entity's classname cannot be removed: the game would not know what to make of it");
  return replaced(
    entities,
    index,
    entities[index].filter((pair) => pair[0] !== key).map((pair) => [...pair]),
  );
}

/**
 * A new list in which the point entity `which` is at `origin` (`[x, y, z]`). A brush entity is refused: its
 * place is in its brushes, which were compiled into the map.
 */
export function moveEntity(entities, which, origin) {
  const index = placeOf(entities, which);
  const entity = entities[index];
  if (isBrushEntity(entity))
    throw new Error(
      `${described(entity, index)} is made of brushes, and its place is theirs, compiled into the map: it cannot be moved to a point. setKey(entities, ${index}, "origin", [x, y, z]) shifts it by that much from where it was compiled, with the light it was compiled in`,
    );
  return setKey(entities, index, "origin", vectorText(origin, "an origin"));
}

/**
 * A new list with one more point entity at its end: `classname`, at `origin` (`[x, y, z]`, or null for an
 * entity that has no place), with more `keys` (an object, or a list of pairs).
 */
export function addEntity(entities, classname, origin, keys = {}) {
  if (typeof classname !== "string" || !classname) throw new Error("a new entity needs a classname");
  if (classname === "worldspawn") throw new Error("a map has one worldspawn, its first entity");
  const entity = [["classname", classname]];
  if (origin) entity.push(["origin", vectorText(origin, "an origin")]);
  for (const [key, value] of Array.isArray(keys) ? keys : Object.entries(keys)) {
    let text = value;
    if (Array.isArray(value)) text = vectorText(value, `the value of ${key}`);
    else if (typeof value === "number") text = numberText(value);
    refuseUnwritable(key, text);
    entity.push([key, text]);
  }
  const model = brushModelOf(entity);
  if (model !== null && !byModel(entities, model).length)
    throw new Error(
      `the new entity's model is *${model}, which no entity of this map has: brushes cannot be added to a compiled map`,
    );
  return [...entities, entity];
}

/**
 * A new list without the point entity `which`. A brush entity is refused, and so is the worldspawn: the
 * brushes compiled for it would stay in the map with nothing to show or move them.
 */
export function removeEntity(entities, which) {
  const index = placeOf(entities, which);
  const entity = entities[index];
  if (valueOf(entity, "classname") === "worldspawn")
    throw new Error("the worldspawn cannot be removed: it is the map itself");
  const model = brushModelOf(entity);
  if (model !== null && byModel(entities, model).length === 1)
    throw new Error(
      `${described(entity, index)} is made of brushes (the map's model *${model}), and they cannot be taken out of a compiled map: removing it would leave the model in the file with no entity, its faces, its collision and its light still there. To hide it, set "rendermode" to "2" and "renderamt" to "0"; it still blocks the way. That is hiding, not removing`,
    );
  return entities.filter((_, each) => each !== index);
}

// ── into the map ───────────────────────────────────────────────────────────
/** Whether any other lump shares bytes with the stretch from `from` to `to`. */
const sharedWithAnother = (lumps, from, to) =>
  LUMP_NAMES.some((name) => {
    const lump = lumps[name];
    return name !== "entities" && lump.length > 0 && lump.offset < to && lump.offset + lump.length > from;
  });

/**
 * A map with its entities replaced: new bytes, the map given left alone. Only the entity lump and the two
 * numbers of the header that say where it is are written; every other lump is byte for byte what it was,
 * where it was.
 *
 * Where the new text goes: when it is no longer than the old, in the old one's place (what is left over of
 * that place is zeroed); when it is longer and the old lump was the last thing in the file, in the same
 * place, the file growing; otherwise at the end of the file, on a multiple of four bytes, and the old
 * text's place zeroed. Both engines find every lump through the header alone and expect no order. A map
 * whose entities were not changed comes back identical. The map's checksum, by which a server tells whether
 * a player has the same map, leaves the entities out in both engines: it does not change.
 */
export function withEntities(bytes, entities) {
  const { lumps } = readLumps(bytes);
  const old = lumps.entities;
  const oldEnd = old.offset + old.length;
  const lump = entityLump(entities, terminatorOf(lumpBytes(bytes, old)));
  const shared = sharedWithAnother(lumps, old.offset, oldEnd);

  if (lump.length <= old.length && !shared) {
    const changed = Buffer.from(bytes);
    lump.copy(changed, old.offset);
    changed.fill(0, old.offset + lump.length, oldEnd);
    pointLump(changed, old, old.offset, lump.length);
    return changed;
  }
  if (oldEnd === bytes.length && !shared) {
    const changed = Buffer.concat([bytes.subarray(0, old.offset), lump]);
    pointLump(changed, old, old.offset, lump.length);
    return changed;
  }
  refuseOverExtraLumps(bytes, lumps);
  const pad = (LUMP_ALIGNMENT - (bytes.length % LUMP_ALIGNMENT)) % LUMP_ALIGNMENT;
  const changed = Buffer.concat([bytes, Buffer.alloc(pad), lump]);
  if (!shared) changed.fill(0, old.offset, oldEnd);
  pointLump(changed, old, bytes.length + pad, lump.length);
  return changed;
}

/**
 * Xash looks for a block of extra lumps (BSPX: other tools' light and normals) straight after the end of the
 * last lump. A lump put at the file's end, after that block, would move the place it looks: refused.
 */
function refuseOverExtraLumps(bytes, lumps) {
  let end = 0;
  for (const name of LUMP_NAMES) end = Math.max(end, lumps[name].offset + lumps[name].length);
  end += (LUMP_ALIGNMENT - (end % LUMP_ALIGNMENT)) % LUMP_ALIGNMENT;
  if (bytes.toString("latin1", end, end + BSPX_ID.length) === BSPX_ID)
    throw new Error(
      "this map has extra lumps after its own (BSPX), which Xash finds by where the last lump ends: entity text longer than the map's own cannot be put in without hiding them. Not done; keep the new text no longer than the old",
    );
}

/**
 * The classes whose Spawn precaches their `model` key as it stands (Half-Life's dlls: CSprite for env_sprite and
 * env_glow, CCyclerSprite, CGenericMonster, CFurniture): one without it precaches an empty name and the server
 * stops on load ("Host_Error: PF_precache_model_I: Bad string ''"). cycler checks and removes itself.
 */
export const PRECACHES_MODEL = ["env_sprite", "env_glow", "cycler_sprite", "monster_generic", "monster_furniture"];
/** The entities (a list, and how to read a key of one) whose class precaches a model they do not name. */
export function modelless(entities, keyOf) {
  return entities
    .map((entity, index) => ({ entity, index }))
    .filter(({ entity }) => PRECACHES_MODEL.includes(keyOf(entity, "classname")) && !keyOf(entity, "model"));
}
