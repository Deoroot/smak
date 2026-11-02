// The corpus written down: anims/corpus/viewmodels.json (every view model's sequences, fps, events and
// bodyparts) and anims/corpus/melee-items.json (every melee item: its view model and submodel, its timings
// with the base scripts' defaults filled in, and which view sequences each of its attacks plays).
//
//   node anims/tools/corpus.mjs [--models <dir>] [--scripts <dir>]
//
// The item scripts are read as the game's script loader reads them (msr/src/game/shared/ms/script.cpp): an
// #include is read in place; the first `const` of a name wins (an item says its own before it includes its
// base) and `const_ovrd` changes it; a const's value naming an earlier const takes that one's value. An
// attack is what a `registerattack` registers, from the `reg.attack.*` locals set before it in its event;
// the engine calls `<callback>_start` when it begins (giattack.cpp:337), and the sequences are those that
// event plays, following its `callevent`s. Conditions (`if`) are not weighed: every branch's sequences are
// listed, which is what a random pick among them (swords_base_onehanded's $rand) needs.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { viewModelFiles, sequenceList, bodypartList, VIEWMODELS } from "../lib/corpus.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const modelsDir = arg("--models", VIEWMODELS);
const scriptsDir = arg("--scripts", join(repo, "scripts-src", "scripts"));
const outDir = join(repo, "anim", "corpus");
mkdirSync(outDir, { recursive: true });

// ── view models ────────────────────────────────────────────────────────────
const models = {};
for (const { name, file } of viewModelFiles(modelsDir)) {
  const buf = readFileSync(file);
  models[name] = { file: basename(file), bodyparts: bodypartList(buf), sequences: sequenceList(buf) };
}
writeFileSync(join(outDir, "viewmodels.json"), JSON.stringify({ dir: modelsDir.split(/[\\/]/).slice(-3).join("/"), models }, null, 1));
console.log(`viewmodels.json: ${Object.keys(models).length} models`);

// ── item scripts ───────────────────────────────────────────────────────────
const scriptPath = (name) => join(scriptsDir, `${name.replace(/\\/g, "/").replace(/\.script$/i, "")}.script`);

/** The words of a line, a "quoted string" one word. */
const words = (line) => line.match(/"[^"]*"|\S+/g) ?? [];
/** A line without its // comment. */
const uncommented = (line) => {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (!quoted && line[i] === "/" && line[i + 1] === "/") return line.slice(0, i);
  }
  return line;
};
/** A line's command, past any inline condition: "if ( SWING == 2 ) setvard X Y" is "setvard X Y". */
function commandOf(text) {
  let t = text;
  for (;;) {
    const m = /^(else\s+)?if\s*\(/i.exec(t) ?? /^else\s+/i.exec(t);
    if (!m) return t;
    if (!m[0].endsWith("(")) {
      t = t.slice(m[0].length);
      continue;
    }
    let depth = 1;
    let i = m[0].length;
    for (; i < t.length && depth; i++) depth += t[i] === "(" ? 1 : t[i] === ")" ? -1 : 0;
    t = t.slice(i).trim();
  }
}
// words that open a block's first line without naming an event
const COMMANDS = /^(const|const_ovrd|setvar|setvarg|setvard|local|precache|eventname|repeatdelay|removeconst)$/i;

/**
 * A script with its includes read in place: { lines: [{ text, file, line, event }], files, consts, vars }.
 * `event` is the name of the top-level block the line is in (null for the unnamed ones read at load).
 */
function loadScript(name) {
  const lines = [];
  const files = [];
  const consts = new Map();
  const vars = new Map();
  const value = (v) => (consts.has(v) ? consts.get(v) : v);
  const read = (file) => {
    const path = scriptPath(file);
    if (files.includes(file)) return;
    if (!existsSync(path)) {
      files.push(`${file} (missing)`);
      return;
    }
    files.push(file);
    let depth = 0;
    let event = null;
    let pending = false; // a block begun with a bare "{": its name may follow as "eventname"
    readFileSync(path, "latin1")
      .split(/\r?\n/)
      .forEach((raw, i) => {
        let text = uncommented(raw).trim();
        if (!text) return;
        const opens = (text.match(/{/g) ?? []).length;
        const closes = (text.match(/}/g) ?? []).length;
        if (depth === 0 && text.startsWith("{")) {
          // a top-level block: "{ name", or "{" with "eventname name" on a later line, or "{ const ..."
          const rest = text.slice(1).trim();
          const first = words(rest).filter((w) => !/^\[(server|client|shared)\]$/i.test(w))[0];
          event = first && !COMMANDS.test(first) && first !== "}" ? first : null;
          pending = !first;
          text = first && COMMANDS.test(first) ? rest : "";
        } else if (pending) {
          const w = words(text);
          pending = false;
          if (/^eventname$/i.test(w[0])) {
            event = w[1];
            text = "";
          }
        }
        depth = Math.max(0, depth + opens - closes);
        const w = words(commandOf(text)).filter((x) => x !== "{" && x !== "}");
        if (!w.length) {
          if (depth === 0) event = null;
          return;
        }
        if (/^#include$/i.test(w[0])) {
          const target = w.find((x, j) => j > 0 && !/^\[/.test(x));
          if (target) read(target);
          return;
        }
        const strip = (x) => (x?.startsWith('"') ? x.slice(1, -1) : x);
        if (/^const$/i.test(w[0]) && w[1] && !consts.has(w[1])) consts.set(w[1], value(strip(w[2] ?? "")));
        else if (/^const_ovrd$/i.test(w[0]) && w[1] && consts.has(w[1])) consts.set(w[1], value(strip(w[2] ?? "")));
        else if (/^setvar$/i.test(w[0]) && !event && w[1]) vars.set(w[1], value(strip(w[2] ?? "")));
        lines.push({ text, words: w, file, line: i + 1, event, depth });
        if (depth === 0) event = null;
      });
  };
  read(name);
  return { lines, files, consts, vars };
}

/** A name's value: a const, else a variable set at load, else the name itself. */
const resolverOf = (s) => (v) => (s.consts.has(v) ? s.consts.get(v) : s.vars.has(v) ? s.vars.get(v) : v);

/** Every handler of every event, in the order read: name -> [lines]. */
function eventsOf(s) {
  const map = new Map();
  for (const l of s.lines) {
    if (!l.event) continue;
    if (!map.has(l.event)) map.set(l.event, []);
    map.get(l.event).push(l);
  }
  return map;
}

/** The attacks: each `registerattack` with the `reg.attack.*` locals set before it in its event. */
function attacksOf(s, events) {
  const resolve = resolverOf(s);
  const out = [];
  for (const [event, lines] of events) {
    const reg = {};
    for (const l of lines) {
      const w = l.words;
      if (/^local$/i.test(w[0]) && /^reg\.attack\./i.test(w[1] ?? "")) reg[w[1].slice(11)] = w.slice(2).map(resolve).join(" ");
      else if (/^(multiply|add)$/i.test(w[0]) && /^reg\.attack\./i.test(w[1] ?? ""))
        reg[w[1].slice(11)] = `${reg[w[1].slice(11)]} ${w[0] === "add" ? "+" : "*"} ${resolve(w[2])}`;
      else if (/^registerattack$/i.test(w[0])) out.push({ event, file: l.file, line: l.line, ...reg });
    }
  }
  return out;
}

/**
 * The view sequences an event plays, following its callevents: [{ arg, values, via, file, line }]. An
 * argument set by `local` or `setvard` (VIEW_ANIM, SWING_ANIM) has every value it is given anywhere.
 */
function viewAnimsOf(s, events, start) {
  const resolve = resolverOf(s);
  // a local is the event's own; a setvard is the script's, set in any event
  const setIn = (lines, kinds) => {
    const map = new Map();
    for (const l of lines)
      if (kinds.test(l.words[0] ?? "") && l.words[1] && l.words[2]) {
        if (!map.has(l.words[1])) map.set(l.words[1], new Set());
        map.get(l.words[1]).add(l.words[2]);
      }
    return map;
  };
  const dynamic = setIn(s.lines, /^setvard$/i);
  // $rand(a,b) is any whole number from a to b, each end as it resolves
  const expand = (v) => {
    const m = /^\$randf?\(([^,]+),([^)]+)\)$/i.exec(v);
    if (!m) return [v];
    const [lo, hi] = [resolve(m[1].trim()), resolve(m[2].trim())].map(Number);
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo || hi - lo > 50) return [v];
    return Array.from({ length: hi - lo + 1 }, (_, i) => String(lo + i));
  };
  const valuesOf = (a, lines) => {
    if (s.consts.has(a)) return expand(s.consts.get(a));
    const local = setIn(lines, /^local$/i).get(a) ?? new Set();
    const all = [...local, ...(dynamic.get(a) ?? [])];
    if (!all.length) return expand(resolve(a));
    return [...new Set(all.flatMap((v) => expand(resolve(v))))];
  };
  const out = [];
  const seen = new Set();
  const walk = (event, via) => {
    if (seen.has(event) || !events.has(event)) return;
    seen.add(event);
    for (const l of events.get(event)) {
      const w = l.words;
      if (/^playviewanim$/i.test(w[0]) && w[1]) out.push({ arg: w[1], values: valuesOf(w[1], events.get(event)), via: [...via, event], file: l.file, line: l.line });
      else if (/^splayviewanim$/i.test(w[0]) && w[2]) out.push({ arg: w[2], values: valuesOf(w[2], events.get(event)), via: [...via, event], file: l.file, line: l.line });
      else if (/^callevent$/i.test(w[0])) {
        // callevent [delay] <event> [params]: a first word that is (or names) a number is a delay
        const delayed = w[2] && !Number.isNaN(Number(resolve(w[1])));
        walk(delayed ? w[2] : w[1], [...via, event]);
      }
    }
  };
  walk(start, []);
  return out;
}

/** A view-anim value as a sequence of the model: a number is its index, a word its name. */
function sequenceNamed(model, v) {
  if (!model) return null;
  const n = Number(v);
  const s = Number.isInteger(n) && String(v).trim() !== "" ? model.sequences[n] : model.sequences.find((q) => q.name.toLowerCase() === String(v).toLowerCase());
  return s ? { index: s.index, name: s.name, frames: s.frames, fps: s.fps } : null;
}

const itemFiles = readdirSync(join(scriptsDir, "items")).filter((f) => f.endsWith(".script"));
const items = [];
for (const f of itemFiles.sort()) {
  const name = `items/${f.replace(/\.script$/, "")}`;
  const s = loadScript(name);
  // a melee weapon: one built on base_melee, or one naming a melee range or hit delay (polearms_base is not
  // on base_melee); spells (magic_hand_*) name ranges too and are left out
  if (!s.files.includes("items/base_melee") && !(s.consts.has("MELEE_DMG_DELAY") || s.consts.has("MELEE_RANGE"))) continue;
  if (/^magic_hand_/.test(f) && !s.files.includes("items/base_melee")) continue;
  const c = (k) => (s.consts.has(k) ? s.consts.get(k) : s.vars.has(k) ? s.vars.get(k) : null);
  const num = (k) => (c(k) === null || Number.isNaN(Number(c(k))) ? c(k) : Number(c(k)));
  // polearms_base names its view model VMODEL_FILE and its submodel VMODEL_IDX
  const view = c("MODEL_VIEW") ?? c("VMODEL_FILE");
  const modelName = view ? basename(view).replace(/\.mdl$/i, "") : null;
  const model = models[modelName];
  const events = eventsOf(s);
  const idx = num("MODEL_VIEW_IDX") ?? num("VMODEL_IDX");
  const submodel = typeof idx === "number" ? idx : 0;
  const attacks = attacksOf(s, events).map((a) => {
    const anims = a.callback ? viewAnimsOf(s, events, `${a.callback}_start`) : [];
    const seqs = new Map();
    for (const p of anims)
      for (const v of p.values) {
        const q = sequenceNamed(model, v);
        if (q) seqs.set(q.index, q);
      }
    return {
      keys: a.keys ?? null,
      callback: a.callback ?? null,
      type: a.type ?? null,
      priority: a.priority ?? null,
      chargeamt: a.chargeamt ?? null,
      range: a.range ?? null,
      delayStrike: a["delay.strike"] ?? null,
      delayEnd: a["delay.end"] ?? null,
      registeredIn: `${a.file}:${a.line}`,
      sequences: [...seqs.values()],
      plays: anims.map((p) => ({
        arg: p.arg,
        values: p.values,
        via: p.via.join(" > "),
        at: `${p.file}:${p.line}`,
        unresolved: p.values.filter((v) => !sequenceNamed(model, v)),
      })),
    };
  });
  // the other timings and ranges an item names (polearms' swipes and backhands, kicks...)
  const timings = Object.fromEntries(
    [...s.consts].filter(([k]) => /(DMG_DELAY|ATK_DURATION|_RANGE|ANIM_ATTACK|VIEWANIM|VANIM_)/.test(k)),
  );
  items.push({
    script: `${name}.script`,
    includes: s.files,
    base: /(^|_)base(_|$)/.test(f.replace(/\.script$/, "")),
    displayName: (s.lines.find((l) => l.event === "weapon_spawn" && /^name$/i.test(l.words[0]))?.words.slice(1).join(" ")) ?? null,
    modelView: view,
    modelViewIdx: idx,
    submodel: model?.bodyparts[0]?.submodels[submodel]?.name ?? null,
    animPrefix: c("ANIM_PREFIX"),
    meleeRange: num("MELEE_RANGE"),
    meleeDmgRange: num("MELEE_DMG_RANGE"),
    meleeDmgDelay: num("MELEE_DMG_DELAY"),
    meleeAtkDuration: num("MELEE_ATK_DURATION"),
    meleeDmgType: c("MELEE_DMG_TYPE"),
    meleeStat: c("MELEE_STAT"),
    viewanimAtk: c("MELEE_VIEWANIM_ATK"),
    attacks,
    timings,
  });
}
writeFileSync(
  join(outDir, "melee-items.json"),
  JSON.stringify({ scripts: scriptsDir, models: modelsDir, items }, null, 1),
);
console.log(`melee-items.json: ${items.length} items (${items.filter((i) => !i.base).length} not bases)`);
