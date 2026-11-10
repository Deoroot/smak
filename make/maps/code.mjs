// Entity definitions read from a mod's own C++ source (the server library's: `dlls/` of the Half-Life SDK and
// the mods made from it). The source is where a class and its keys really are: `LINK_ENTITY_TO_CLASS(name,
// CClass)` makes the class a map names, and the class's `KeyValue` (with those of the classes it is made from)
// is every key the game reads of it. The engine sets the keys of the entity's own variables first, the ones
// `gEntvarsDescription` lists (`targetname`, `rendermode`, `angles`): those every class has.
//
// What it cannot read is said in `unread`: a key handed on to a helper (`s_Emitter.EmitterKeyValue(...)`)
// whose names live in another function, and a class whose C++ class it never finds.
//
//   definitionsOfCode(folder | [files]) -> { from, fgd: false, maps: 0, program: true, code: true,
//     classes: { name: { exists: true, defined: false, kind, cclass, keys: { key: { type, read, engine?, from } } } },
//     unread: [sentences] }
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename, relative } from "node:path";

/** The files of C++ source in a folder and the folders in it. */
function sourcesOf(folder) {
  const found = [];
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    const stat = statSync(path);
    if (stat.isDirectory()) found.push(...sourcesOf(path));
    else if (/\.(cpp|cxx|cc|c|h|hpp)$/i.test(name)) found.push(path);
  }
  return found.sort();
}

/** The text with its comments taken out and its strings kept, so that braces and words are the code's. */
function withoutComments(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const cut = text.slice(i, end < 0 ? text.length : end + 2);
      out += cut.replace(/[^\n]/g, " ");
      i = end < 0 ? text.length : end + 1;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else out += c;
  }
  return out;
}

/** Where the brace that closes the one at `open` is; -1 when the text ends first. */
function closing(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      i = j;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

/** An FGD key type from what the code does with the value. */
function typeOfUse(code) {
  if (/\batoi\s*\(|\bstrtol\s*\(|\(int\)\s*atof/.test(code)) return "integer";
  if (/\batof\s*\(|\bstrtod\s*\(|\bstrtof\s*\(/.test(code)) return "float";
  if (/StringToVector|ParseVec|sscanf\s*\([^;]*%f[^;]*%f[^;]*%f/.test(code)) return "vector";
  if (/PRECACHE_SOUND|EMIT_SOUND/.test(code)) return "sound";
  if (/PRECACHE_MODEL|SET_MODEL/.test(code)) return "studio";
  return "string";
}

/** The engine's own field types, as an FGD names them. */
const FIELD_TYPES = {
  FIELD_STRING: "string",
  FIELD_MODELNAME: "studio",
  FIELD_SOUNDNAME: "sound",
  FIELD_FLOAT: "float",
  FIELD_TIME: "float",
  FIELD_INTEGER: "integer",
  FIELD_VECTOR: "vector",
  FIELD_POSITION_VECTOR: "vector",
};

/** The keys each `KeyValue` body reads, in the order it asks: [{ key, type }], and what it hands on unread. */
function keysOfBody(body, name = "\\w+\\s*->\\s*szKeyName") {
  const keys = [];
  const compare = new RegExp(`(?:FStrEq|strcmp|stricmp|strcasecmp|_stricmp|Q_strcmp|Q_stricmp)\\s*\\(\\s*${name}\\s*,\\s*"([^"]+)"\\s*\\)`, "g");
  const asks = [...body.matchAll(compare)];
  asks.forEach((ask, index) => {
    const end = index + 1 < asks.length ? asks[index + 1].index : body.length;
    const use = body.slice(ask.index + ask[0].length, end);
    keys.push({ key: ask[1], type: typeOfUse(use) });
  });
  const handed = [...body.matchAll(/(\w+(?:\.|->)\w*KeyValue)\s*\(/g)]
    .map((m) => m[1])
    .filter((name) => !/^\w+::KeyValue$/.test(name) && !/^(?:BaseClass|CBase\w*)::/.test(name));
  return { keys, handed: [...new Set(handed)] };
}

/**
 * Entity definitions from a mod's C++ source: `folder` its server library's source (`dlls`), or a list of
 * files. Every class `LINK_ENTITY_TO_CLASS` makes, with the keys its `KeyValue` and those of its bases read,
 * each typed by what the code does with the value (`atoi`: integer, `atof`: float, sound, model, else text),
 * and the engine's own keys (`gEntvarsDescription`), marked `engine: true`, which every class has.
 */
export function definitionsOfCode(source) {
  const files = Array.isArray(source) ? source : sourcesOf(source);
  const where = Array.isArray(source) ? "the files given" : source.replace(/\\/g, "/");
  const linked = new Map(); // classname -> C++ class
  const parents = new Map(); // C++ class -> [C++ classes]
  const keysOf = new Map(); // C++ class -> [{ key, type, from }]
  const handedOf = new Map();
  const engine = [];
  const helpers = new Map(); // a function keys are handed on to -> [{ key, type, from }]
  for (const file of files) {
    const text = withoutComments(readFileSync(file, "latin1"));
    const at = Array.isArray(source) ? basename(file) : relative(source, file);
    for (const m of text.matchAll(/LINK_ENTITY_TO_CLASS\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)/g)) {
      // the macro's own definition is no class
      const line = text.slice(text.lastIndexOf("\n", m.index) + 1, m.index);
      if (!/#\s*define/.test(line)) linked.set(m[1], m[2]);
    }
    // a helper keys are handed on to: Thing::EmitterKeyValue(..., const char* key, const char* val) { ... }
    for (const m of text.matchAll(/(\w+)\s*::\s*(\w+KeyValue)\s*\(([^)]*)\)\s*\{/g)) {
      if (m[2] === "KeyValue") continue;
      const param = m[3].match(/char\s*\*\s*(\w+)/);
      if (!param) continue;
      const open = m.index + m[0].length - 1;
      const end = closing(text, open);
      if (end < 0) continue;
      const { keys } = keysOfBody(text.slice(open, end + 1), param[1]);
      helpers.set(m[2], keys.map((k) => ({ ...k, from: at })));
    }
    for (const m of text.matchAll(/\b(?:class|struct)\s+(\w+)\s*(?:final\s*)?:\s*([^{;]+)\{/g)) {
      const bases = m[2]
        .split(",")
        .map((b) => b.replace(/\b(public|protected|private|virtual)\b/g, "").trim())
        .filter((b) => /^\w+$/.test(b));
      if (bases.length) parents.set(m[1], bases);
    }
    // KeyValue written out of its class: CClass::KeyValue(KeyValueData* pkvd) { ... }
    const bodies = [];
    for (const m of text.matchAll(/(\w+)\s*::\s*KeyValue\s*\(\s*KeyValueData\s*\*\s*\w+\s*\)\s*\{/g))
      bodies.push({ cclass: m[1], open: m.index + m[0].length - 1 });
    // and written in its class: class CClass ... { ... void KeyValue(KeyValueData* pkvd) { ... } }
    for (const m of text.matchAll(/\b(?:class|struct)\s+(\w+)[^;{]*\{/g)) {
      const end = closing(text, m.index + m[0].length - 1);
      if (end < 0) continue;
      const inside = text.slice(m.index + m[0].length, end);
      for (const k of inside.matchAll(/\bKeyValue\s*\(\s*KeyValueData\s*\*\s*\w+\s*\)\s*(?:override\s*)?\{/g))
        bodies.push({ cclass: m[1], open: m.index + m[0].length + k.index + k[0].length - 1 });
    }
    for (const { cclass, open } of bodies) {
      const end = closing(text, open);
      if (end < 0) continue;
      const { keys, handed } = keysOfBody(text.slice(open, end + 1));
      const list = keysOf.get(cclass) ?? [];
      for (const k of keys) if (!list.some((x) => x.key === k.key)) list.push({ ...k, from: at });
      keysOf.set(cclass, list);
      if (handed.length) handedOf.set(cclass, [...new Set([...(handedOf.get(cclass) ?? []), ...handed])]);
    }
    const table = text.match(/gEntvarsDescription\s*\[\s*\]\s*=\s*\{/);
    if (table) {
      const end = closing(text, table.index + table[0].length - 1);
      for (const m of text.slice(table.index, end).matchAll(/DEFINE_ENTITY_(?:GLOBAL_)?FIELD\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)/g))
        if (FIELD_TYPES[m[2]]) engine.push({ key: m[1], type: FIELD_TYPES[m[2]], from: at });
    }
  }
  const chain = (cclass, seen = new Set()) => {
    if (seen.has(cclass)) return [];
    seen.add(cclass);
    return [cclass, ...(parents.get(cclass) ?? []).flatMap((p) => chain(p, seen))];
  };
  const classes = {};
  const unread = [];
  for (const [name, cclass] of [...linked].sort(([a], [b]) => a.localeCompare(b))) {
    const keys = {};
    for (const k of engine) keys[k.key] = { type: k.type, read: k.type, engine: true, from: k.from };
    const line = chain(cclass);
    // the class's own keys stand over its bases': walk from the furthest base to the class
    for (const c of [...line].reverse()) for (const k of keysOf.get(c) ?? []) keys[k.key] = { type: k.type, read: k.type, from: k.from, of: c };
    const handedAll = line.flatMap((c) => handedOf.get(c) ?? []);
    for (const h of handedAll) for (const k of helpers.get(h.split(/\.|->/).pop()) ?? []) keys[k.key] ??= { type: k.type, read: k.type, from: k.from, of: h };
    const handed = handedAll.filter((h) => !helpers.has(h.split(/\.|->/).pop()));
    if (handed.length) unread.push(`${name} (${cclass}) hands keys on to ${[...new Set(handed)].join(", ")}: their names were not read`);
    if (!parents.has(cclass) && !keysOf.has(cclass)) unread.push(`${name}: its C++ class ${cclass} was not found`);
    const solid = /^(func|trigger)_/.test(name) || line.some((c) => /^(CBaseDoor|CBaseTrigger|CFuncWall|CBaseButton|CBreakable|CPushable|CBasePlatTrain|CFuncTrain|CFuncTank)$/.test(c));
    classes[name] = { exists: true, defined: false, kind: solid ? "solid" : "point", cclass, keys };
  }
  return {
    from: [`the C++ source in ${where}`],
    fgd: false,
    maps: 0,
    program: true,
    code: true,
    classes,
    unread,
  };
}
