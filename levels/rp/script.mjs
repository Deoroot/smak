// script.mjs: the offline check of a smak_script file (levels/rp/plugin/smak_script.sma), format "smak-script/1",
// and of what `smak check rp <file>` is given (an rp.json, held to the contract; a script.json, held to this).
//
//   {
//     "format": "smak-script/1",
//     "map": "smak_rp_mtest",                 optional; must be the map (the global file has none)
//     "rules": [
//       { "id": "fixer_talk", "on": "use", "npc": "fixer", "duck": true,
//         "if": [ {"no_flag":"met"}, {"hour":[7,20]}, {"money":50}, {"chance":30}, {"flag":"x"} ],
//         "do": [ {"say":"..."}, {"give_money":50}, {"take_money":10}, {"set_flag":"met"}, {"clear_flag":"met"},
//                 {"open_menu":{"title":"...","options":[{"text":"...","if":[...],"do":[...]}]}},
//                 {"open_shop":"shop_id"}, {"cooldown":60} ] }
//     ]
//   }
//
// Events (`on`): use (an NPC of rp.json by `npc`, or a named entity by `entity`; `duck` only while ducking), say
// (`words`, near `npc` within `radius`, or anywhere), hour (`hour` 0-23 of smak_npc's clock; near `npc` within
// `radius` or for everybody), spawn. Rules are tried in order; for use and say the first whose `if` holds ends the event
// unless `continue` is true. `speaker` names who talks when there is no `npc`.
//
// checkScript(json, { rp, global, refs, extras }) -> { errors, warnings, facts }
//   rp      the map's rp.json (its npcs are checked); without it NPC names cannot be, and a warning says so
//   global  the file is global.script.json: an unknown NPC is a warning (the rule is skipped on maps without it)
//   refs    { shops: Set, items: Set } when another checker (items.mjs) knows them: open_shop ids are then checked
//   extras  [(json, context) => ({ errors, warnings })]: more checks to run on the same file (the items checker)
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { RP_FORMAT, checkRewards } from "./contract.mjs";
import { checkPaths, badCounters } from "./paths.mjs";
import { npcIds } from "./npc-sim.mjs";

export const SCRIPT_FORMAT = "smak-script/1";

/** The limits of the plugin (smak_script.sma #defines): a file over them is refused whole. */
export const LIMITS = {
  fileRules: 64, rules: 96, conditions: 256, actions: 400, texts: 220, menus: 24, flags: 128, words: 192,
  ruleConditions: 6, ruleWords: 8, list: 12, options: 7, depth: 2, say: 150, title: 60, option: 40, flag: 24, id: 31,
  word: 24, money: 100000, radius: [32, 4000], cooldown: 86400, entity: 47, speaker: 31, shop: 31,
}; // prettier-ignore

const RULE_KEYS = ["id", "on", "npc", "entity", "words", "radius", "hour", "speaker", "duck", "continue", "if", "do"];
const FILE_KEYS = ["format", "map", "note", "rules"];
const EVENTS = ["use", "say", "hour", "spawn"];
const NAME = /^[a-z0-9_]+$/;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const bytes = (s) => Buffer.byteLength(s, "utf8");
/** The plugin's own normalisation of a word: lower case, only a-z and 0-9, a run of other characters one space. */
export const normalise = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * What is wrong with a script file (`errors`: the plugin would refuse the file, or it cannot work), what looks
 * wrong (`warnings`), and what it holds (`facts`).
 */
export function checkScript(json, { rp = null, global = false, refs = null, extras = [], generated = null } = {}) {
  const errors = [];
  const warnings = [];
  const facts = [];
  const err = (s) => errors.push(s);
  const warn = (s) => warnings.push(s);
  if (!isObject(json)) return { errors: ["the file is not a JSON object"], warnings, facts };
  for (const k of Object.keys(json)) if (!FILE_KEYS.includes(k)) err(`file: unknown key "${k}"`);
  if (json.format !== SCRIPT_FORMAT) err(`format is ${JSON.stringify(json.format)}, expected "${SCRIPT_FORMAT}"`);
  if (json.map !== undefined) {
    if (typeof json.map !== "string") err(`map must be a string`);
    else if (!global && rp?.map && json.map !== rp.map) err(`the file is for map ${json.map}, the rp.json is for ${rp.map}`);
  }
  if (!Array.isArray(json.rules)) {
    err(`no "rules" list`);
    return { errors, warnings, facts };
  }
  if (json.rules.length < 1 || json.rules.length > LIMITS.fileRules)
    err(`"rules" has ${json.rules.length} rules, from 1 to ${LIMITS.fileRules} are allowed`);

  const npcs = new Map((rp?.npcs ?? []).map((n) => [n.id, n]));
  // the people smak_npc.sma generates at load (npc-sim.mjs npcIds): `generated` is a list of ids, else derived from the rp.json's paths graph
  let gen = new Set(generated ?? []);
  if (generated === null && rp?.paths) {
    try {
      gen = new Set(npcIds(rp));
    } catch (e) {
      warn(`the ids of smak_npc's people could not be derived from the rp.json (${e.message})`);
    }
  }
  if (!rp) warn(`no rp.json given: the NPC names of the rules are not checked (give --rp <map.rp.json>)`);
  const count = { conditions: 0, actions: 0, texts: 0, menus: 0, words: 0 };
  const flagsSet = new Map(); // name -> rules that set it
  const flagsTested = new Map(); // name -> rules that test it
  const flagsAll = new Set();
  const seen = new Set();
  const note = (map, name, where) => map.set(name, [...(map.get(name) ?? []), where]);

  function flagName(v, where, what) {
    if (typeof v !== "string" || !NAME.test(v) || v.length > LIMITS.flag) {
      err(`${where}: ${what} must be 1 to ${LIMITS.flag} characters of a-z 0-9 _, not ${JSON.stringify(v)}`);
      return null;
    }
    flagsAll.add(v);
    return v;
  }

  function conditions(list, where, onTest) {
    if (list === undefined) return;
    if (!Array.isArray(list)) return err(`${where}: "if" is not a list`);
    if (list.length > LIMITS.ruleConditions) err(`${where}: "if" has ${list.length} conditions, at most ${LIMITS.ruleConditions}`);
    count.conditions += list.length;
    for (const c of list) {
      if (!isObject(c) || Object.keys(c).length !== 1) {
        err(`${where}: a condition is an object with one key`);
        continue;
      }
      const [key, v] = Object.entries(c)[0];
      if (key === "flag" || key === "no_flag") {
        const f = flagName(v, where, `condition ${key}`);
        if (f) onTest(f);
      } else if (key === "money") {
        if (!Number.isInteger(v) || v < 1 || v > 1e9) err(`${where}: condition money must be an integer from 1 to 1000000000, not ${JSON.stringify(v)}`);
      } else if (key === "chance") {
        if (!Number.isInteger(v) || v < 1 || v > 99) err(`${where}: condition chance must be an integer percent from 1 to 99, not ${JSON.stringify(v)}`);
      } else if (key === "hour") {
        const ok = Array.isArray(v) && v.length === 2 && v.every((h) => Number.isInteger(h) && h >= 0 && h <= 24) && v[0] !== v[1];
        if (!ok) err(`${where}: condition hour must be [from, to], two different whole hours from 0 to 24, not ${JSON.stringify(v)}`);
      } else err(`${where}: unknown condition "${key}" (flag, no_flag, money, hour, chance)`);
    }
  }

  /** Walks an action list; `ctx` says what gates it (flags the rule tests with no_flag, whether a cooldown is on). */
  function actions(list, where, depth, ctx) {
    if (!Array.isArray(list)) {
      err(`${where}: "do" is not a list`);
      return;
    }
    if (list.length < 1 || list.length > LIMITS.list) err(`${where}: an action list has ${list.length} entries, from 1 to ${LIMITS.list} are allowed`);
    count.actions += list.length;
    const sets = new Set();
    let cooled = list.some((a) => isObject(a) && "cooldown" in a);
    let pays = 0;
    list.forEach((a, i) => {
      if (!isObject(a) || Object.keys(a).length !== 1) {
        err(`${where}: an action is an object with one key`);
        return;
      }
      const [key, v] = Object.entries(a)[0];
      switch (key) {
        case "say":
          count.texts++;
          if (typeof v !== "string" || !v) err(`${where}: say wants a text`);
          else {
            if (bytes(v) > LIMITS.say) err(`${where}: a say line is ${bytes(v)} bytes, at most ${LIMITS.say}: "${v.slice(0, 40)}..."`);
            if (/[^\x20-\x7e]/.test(v)) warn(`${where}: the line "${v.slice(0, 30)}..." has accents or non-ASCII characters; the chat font may not draw them (write without accents)`); // prettier-ignore
          }
          break;
        case "give_money":
        case "take_money":
          if (!Number.isInteger(v) || v < 1 || v > LIMITS.money) err(`${where}: ${key} must be an integer from 1 to ${LIMITS.money}, not ${JSON.stringify(v)}`);
          else if (key === "give_money") {
            pays += v;
            if (v >= 5000) warn(`${where}: give_money ${v} is a lot of money for one line`);
          }
          if (key === "give_money") ctx.gives = true;
          break;
        case "set_flag":
        case "clear_flag": {
          const f = flagName(v, where, key);
          if (f && key === "set_flag") {
            sets.add(f);
            note(flagsSet, f, where);
          }
          break;
        }
        case "open_shop":
          if (typeof v !== "string" || !NAME.test(v) || v.length > LIMITS.shop) err(`${where}: open_shop wants a shop id of a-z 0-9 _, not ${JSON.stringify(v)}`);
          else {
            count.texts++;
            if (refs?.shops && !refs.shops.has(v)) err(`${where}: open_shop ${v}: no such shop`);
          }
          break;
        case "cooldown":
          if (!Number.isInteger(v) || v < 1 || v > LIMITS.cooldown) err(`${where}: cooldown must be whole seconds from 1 to ${LIMITS.cooldown}, not ${JSON.stringify(v)}`);
          break;
        case "open_menu":
          if (i !== list.length - 1) warn(`${where}: open_menu is not the last action; the actions after it run at once, before the player chooses`);
          menu(v, `${where} > menu`, depth + 1, ctx);
          break;
        default:
          err(`${where}: unknown action "${key}" (say, give_money, take_money, set_flag, clear_flag, open_menu, open_shop, cooldown)`);
      }
    });
    if (pays > 0 && !cooled && !ctx.gated(sets)) {
      warn(`${where}: gives money and nothing stops it being repeated (no cooldown, and no flag set here that the conditions require to be absent): it can be farmed`);
    }
  }

  function menu(m, where, depth, ctx) {
    if (!isObject(m)) return err(`${where}: open_menu wants an object {title, options}`);
    if (depth > LIMITS.depth) return err(`${where}: menus inside menus go ${LIMITS.depth} deep at most`);
    for (const k of Object.keys(m)) if (k !== "title" && k !== "options") err(`${where}: unknown key "${k}"`);
    count.menus++;
    count.texts++;
    if (typeof m.title !== "string" || !m.title || bytes(m.title) > LIMITS.title) err(`${where}: the title must be 1 to ${LIMITS.title} bytes`);
    if (!Array.isArray(m.options) || m.options.length < 1 || m.options.length > LIMITS.options) return err(`${where}: a menu has 1 to ${LIMITS.options} options`);
    m.options.forEach((o, i) => {
      const at = `${where} option ${i + 1}`;
      if (!isObject(o)) return err(`${at}: not an object`);
      for (const k of Object.keys(o)) if (!["text", "if", "do"].includes(k)) err(`${at}: unknown key "${k}"`);
      count.texts++;
      if (typeof o.text !== "string" || !o.text || bytes(o.text) > LIMITS.option) err(`${at}: the text must be 1 to ${LIMITS.option} bytes`);
      else if (/[^\x20-\x7e]/.test(o.text)) warn(`${at}: "${o.text}" has non-ASCII characters; the menu font may not draw them`);
      const gate = new Set(ctx.gate);
      conditions(o.if, at, (f) => note(flagsTested, f, at));
      if (Array.isArray(o.if)) for (const c of o.if) if (isObject(c) && typeof c.no_flag === "string") gate.add(c.no_flag);
      actions(o.do, at, depth, { gate, gated: (sets) => [...sets].some((f) => gate.has(f)) });
    });
  }

  json.rules.forEach((r, i) => {
    let where = `rule ${i + 1}`;
    if (!isObject(r)) return err(`${where}: not an object`);
    if (typeof r.id !== "string" || !NAME.test(r.id) || r.id.length > LIMITS.id) err(`${where}: "id" must be 1 to ${LIMITS.id} characters of a-z 0-9 _`);
    else {
      where = `rule ${r.id}`;
      if (seen.has(r.id)) err(`${where}: the id is used twice`);
      seen.add(r.id);
    }
    for (const k of Object.keys(r)) if (!RULE_KEYS.includes(k)) err(`${where}: unknown key "${k}"`);
    if (!EVENTS.includes(r.on)) err(`${where}: "on" is ${JSON.stringify(r.on)}, expected use, say, hour or spawn`);
    if (r.npc !== undefined) {
      if (typeof r.npc !== "string") err(`${where}: "npc" is not a string`);
      else if (rp && !npcs.has(r.npc) && !gen.has(r.npc)) {
        const known = [...npcs.keys()].join(", ") || "none";
        const made = gen.size ? `; smak_npc makes: ${[...gen].join(", ")}` : "";
        (global ? warn : err)(`${where}: the NPC "${r.npc}" is not in the rp.json (it has: ${known}${made})${global ? "; a global rule is skipped on a map without it" : ""}`);
      }
    }
    if (r.entity !== undefined && (typeof r.entity !== "string" || !r.entity || r.entity.length > LIMITS.entity)) err(`${where}: "entity" must be a targetname of 1 to ${LIMITS.entity} characters`);
    if (r.speaker !== undefined && (typeof r.speaker !== "string" || r.speaker.length > LIMITS.speaker)) err(`${where}: "speaker" must be a text of at most ${LIMITS.speaker} characters`);
    for (const k of ["duck", "continue"]) if (r[k] !== undefined && typeof r[k] !== "boolean") err(`${where}: "${k}" must be true or false`);
    if (r.radius !== undefined && (!Number.isInteger(r.radius) || r.radius < LIMITS.radius[0] || r.radius > LIMITS.radius[1])) err(`${where}: "radius" must be a whole number from ${LIMITS.radius[0]} to ${LIMITS.radius[1]}`);
    if (r.on === "use") {
      if ((r.npc === undefined) === (r.entity === undefined)) err(`${where}: a use rule names exactly one of "npc" and "entity"`);
    } else if (r.entity !== undefined) warn(`${where}: "entity" only means something to a use rule`);
    if (r.on === "say") {
      const w = r.words;
      if (!Array.isArray(w) || w.length < 1 || w.length > LIMITS.ruleWords) err(`${where}: a say rule needs "words": 1 to ${LIMITS.ruleWords} keywords`);
      else {
        count.words += w.length;
        for (const x of w) {
          const n = typeof x === "string" ? normalise(x) : "";
          if (n.length < 2 || n.length > LIMITS.word) err(`${where}: the keyword ${JSON.stringify(x)} must be 2 to ${LIMITS.word} letters or digits`);
          else if (n !== x) warn(`${where}: the keyword ${JSON.stringify(x)} is matched as "${n}" (lower case, letters and digits only, accents are not matched)`);
        }
      }
      if (r.npc === undefined && r.radius !== undefined) warn(`${where}: "radius" has no meaning without "npc"; the words are heard anywhere`);
      if (r.npc === undefined && !r.duck) warn(`${where}: the words are heard anywhere on the map, by anyone`);
    } else if (r.words !== undefined) warn(`${where}: "words" only means something to a say rule`);
    if (r.on === "hour") {
      if (!Number.isInteger(r.hour) || r.hour < 0 || r.hour > 23) err(`${where}: an hour rule needs "hour", a whole number from 0 to 23`);
    } else if (r.hour !== undefined) warn(`${where}: "hour" only means something to an hour rule (use {"hour":[a,b]} in "if" to limit another)`);
    if ((r.on === "hour" || r.on === "spawn") && r.continue !== undefined) warn(`${where}: "continue" means nothing to ${r.on} rules, which all run`);
    if (!r.npc && !r.speaker) {
      // a say with no one to say it: allowed (plain text), but worth knowing
      const speaks = Array.isArray(r.do) && r.do.some((a) => isObject(a) && "say" in a);
      if (speaks) facts.push(`${where}: says its lines with no speaker name`);
    }
    const gate = new Set();
    conditions(r.if, where, (f) => note(flagsTested, f, where));
    if (Array.isArray(r.if)) for (const c of r.if) if (isObject(c) && typeof c.no_flag === "string") gate.add(c.no_flag);
    actions(r.do, where, 0, { gate, gated: (sets) => [...sets].some((f) => gate.has(f)) });
  });

  // a rule that an earlier one always answers first
  const rules = json.rules.filter(isObject);
  rules.forEach((b, j) => {
    for (const a of rules.slice(0, j)) {
      if (a.on !== b.on || a.continue || (a.if?.length ?? 0) > 0) continue;
      if ((a.do ?? []).some((x) => isObject(x) && "cooldown" in x)) continue; // the cooldown lets the next rule answer
      const same =
        b.on === "use"
          ? a.npc === b.npc && a.entity === b.entity && !!a.duck === !!b.duck
          : b.on === "say"
            ? a.npc === b.npc && !!a.duck === !!b.duck && (a.radius ?? 300) >= (b.radius ?? 300) && Array.isArray(a.words) && Array.isArray(b.words) && b.words.every((w) => a.words.map(normalise).includes(normalise(w)))
            : false;
      if (same) {
        warn(`rule ${b.id}: can never run, rule ${a.id} comes first for the same trigger and has no conditions (and no "continue")`);
        break;
      }
    }
  });

  for (const [f, where] of flagsSet) if (!flagsTested.has(f)) warn(`flag ${f} is set (${where[0]}) but no condition ever tests it`);
  for (const [f, where] of flagsTested) if (!flagsSet.has(f)) warn(`flag ${f} is tested (${where[0]}) but nothing here sets it (fine if another script file does)`);

  const over = (what, n, max) => n > max && err(`the file holds ${n} ${what}, the plugin holds ${max} in all`);
  over("conditions", count.conditions, LIMITS.conditions);
  over("actions", count.actions, LIMITS.actions);
  over("texts", count.texts, LIMITS.texts);
  over("menus", count.menus, LIMITS.menus);
  over("keywords", count.words, LIMITS.words);
  over("flag names", flagsAll.size, LIMITS.flags);

  for (const extra of extras) {
    const out = extra(json, { rp, global, errors, warnings }) ?? {};
    errors.push(...(out.errors ?? []));
    warnings.push(...(out.warnings ?? []));
  }
  facts.unshift(`${rules.length} rules, ${count.actions} actions, ${count.menus} menus, ${flagsAll.size} flag names, ${count.words} keywords`);
  return { errors, warnings, facts };
}

/**
 * What is wrong with an rp.json, by the contract (CONTRACT.md): the format, the lists, the missions' rewards
 * (contract.mjs checkRewards) and the walking graph (paths.mjs checkPaths). Does not change contract.mjs.
 */
export function checkRp(rp) {
  const errors = [];
  const warnings = [];
  const facts = [];
  if (!isObject(rp)) return { errors: ["the file is not a JSON object"], warnings, facts };
  if (rp.format !== RP_FORMAT) errors.push(`format is ${JSON.stringify(rp.format)}, expected "${RP_FORMAT}"`);
  if (typeof rp.map !== "string" || !rp.map) errors.push(`no "map"`);
  for (const k of ["properties", "places", "npcs", "arenas", "missions"]) if (!Array.isArray(rp[k])) errors.push(`"${k}" is not a list`);
  if (errors.length) return { errors, warnings, facts };
  const ids = new Set();
  for (const n of rp.npcs) {
    if (!n.id || ids.has(n.id)) errors.push(`npc id ${JSON.stringify(n.id)} is empty or used twice`);
    ids.add(n.id);
    if (!Array.isArray(n.at) || n.at.length !== 3 || n.at.some((v) => !Number.isFinite(v))) errors.push(`npc ${n.id}: "at" must be [x, y, z]`);
  }
  const arenas = new Set(rp.arenas.map((a) => a.id));
  for (const m of rp.missions) {
    if (!ids.has(m.giver)) errors.push(`mission ${m.id}: the giver "${m.giver}" is not an npc`);
    if (!arenas.has(m.arena)) errors.push(`mission ${m.id}: the arena "${m.arena}" is not in "arenas"`);
  }
  try {
    errors.push(...checkRewards(rp.missions));
  } catch (e) {
    errors.push(String(e.message));
  }
  if (rp.paths) {
    try {
      const r = checkPaths(rp.paths, { places: rp.places, roam: rp.roam ?? [] });
      errors.push(...r.failures);
      warnings.push(...r.warnings);
      errors.push(...badCounters(rp).map((b) => b.say)); // (a counter in every shop, bar and clinic room, the keeper behind it)
    } catch (e) {
      errors.push(`paths: ${e.message}`);
    }
  }
  facts.push(`${rp.map}: ${rp.npcs.length} npcs, ${rp.arenas.length} arenas, ${rp.missions.length} missions, ${rp.places.length} places${rp.paths ? `, ${rp.paths.nodes.length} path nodes` : ""}`);
  return { errors, warnings, facts };
}

const readJson = (file) => {
  try {
    return { json: JSON.parse(readFileSync(file, "utf8")) };
  } catch (e) {
    return { error: `${file}: not valid JSON (${e.message})` };
  }
};

/**
 * `smak check rp <file>`: the file is an rp.json or a script.json (by its name, else by its "format"). Returns
 * `{ detail, shown, passed, said }` for the command to print. A script file is held with its map's rp.json
 * (`options.rp`, else <map>.rp.json beside it); an rp.json is held to the contract and, if a script file stands
 * beside it (<map>.script.json, global.script.json), those are checked with it.
 */
export function checkRpFile(file, { rp: rpFile, extras = [], npcs: npcList = null } = {}) {
  const detail = [];
  let errors = 0;
  let warnings = 0;
  const shown = [];
  const say = (kind, label, lines) => {
    for (const l of lines) {
      const line = `${kind} ${label}: ${l}`;
      detail.push(line);
      shown.push(line);
    }
    if (kind === "ERROR") errors += lines.length;
    else warnings += lines.length;
  };
  const one = (path, rpJson) => {
    const label = basename(path);
    const read = readJson(path);
    if (read.error) {
      say("ERROR", label, [read.error]);
      return null;
    }
    const isScript = /\.script\.json$/i.test(path) || read.json?.format === SCRIPT_FORMAT;
    const r = isScript
      ? checkScript(read.json, { rp: rpJson, global: /^global\.script\.json$/i.test(label), extras, generated: npcList })
      : checkRp(read.json);
    for (const f of r.facts) detail.push(`      ${label}: ${f}`);
    say("ERROR", label, r.errors);
    say("WARN ", label, r.warnings);
    return isScript ? null : read.json;
  };
  const dir = dirname(file);
  const name = basename(file);
  if (/\.script\.json$/i.test(name)) {
    let rpJson = null;
    const guess = name.toLowerCase() === "global.script.json" ? null : join(dir, name.replace(/\.script\.json$/i, ".rp.json"));
    const rpPath = rpFile ?? guess;
    if (rpPath && existsSync(rpPath)) {
      const read = readJson(rpPath);
      if (read.error) say("ERROR", basename(rpPath), [read.error]);
      else rpJson = read.json;
    }
    one(file, rpJson);
  } else {
    const rpJson = one(file, null);
    const base = name.replace(/\.rp\.json$/i, "");
    for (const sib of [join(dir, `${base}.script.json`), join(dir, "global.script.json")]) if (existsSync(sib)) one(sib, rpJson);
  }
  return {
    detail,
    shown,
    passed: errors === 0,
    said: errors ? `${errors} errors${warnings ? `, ${warnings} warnings` : ""}: ${name} is not fit for the plugin` : `${name} is fit for the plugin${warnings ? `, with ${warnings} warnings` : ""}`,
  };
}
