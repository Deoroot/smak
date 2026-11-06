// The script plugin's offline check (levels/rp/script.mjs checkScript, levels/rp/plugin/smak_script.sma): the test map's
// script clean against its NPC, the limits in the checker the plugin's own, a global file's unknown NPC a warning and a
// map file's an error, a later checker plugged in (refs, extras), and `smak check rp` ending in PASS or FAIL.
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test, sure, tmp, HERE } from "./helper.mjs";
import { checkScript, checkRp, LIMITS, normalise } from "../levels/rp/script.mjs";

const scriptPath = join(HERE, "../levels/rp/scripts/smak_rp_mtest.script.json");
const script = JSON.parse(readFileSync(scriptPath, "utf8"));
const rp = { format: "smak-rp/1", map: "smak_rp_mtest", npcs: [{ id: "fixer", name: "Marco the Fixer", at: [-2592, 256, 0] }] };
const copy = (o) => JSON.parse(JSON.stringify(o));
const smak = (...args) => spawnSync(process.execPath, [join(HERE, "../bin/smak.mjs"), ...args], { encoding: "utf8" });

test("script check: the test map's script has no errors and no warnings against its NPC", () => {
  const r = checkScript(script, { rp });
  sure(r.errors.length === 0 && r.warnings.length === 0, `errors: ${r.errors.join(" | ")} warnings: ${r.warnings.join(" | ")}`);
  sure(/7 rules/.test(r.facts[0]), r.facts[0]);
});

test("script check: without the rp.json the NPC names cannot be checked, and a warning says so", () => {
  const r = checkScript(script);
  sure(r.errors.length === 0 && r.warnings.length === 1 && /no rp\.json given/.test(r.warnings[0]), r.warnings.join(" | "));
});

test("script check: the limits are the plugin's (#defines of smak_script.sma)", () => {
  const sma = readFileSync(join(HERE, "../levels/rp/plugin/smak_script.sma"), "utf8");
  const define = (name) => Number(new RegExp(`#define\\s+${name}\\s+(\\d+)`).exec(sma)?.[1]);
  const pairs = {
    MAX_FILE_RULES: LIMITS.fileRules, MAX_RULES: LIMITS.rules, MAX_COND: LIMITS.conditions, MAX_ACT: LIMITS.actions,
    MAX_TEXT: LIMITS.texts, MAX_MENUS: LIMITS.menus, MAX_FLAGS: LIMITS.flags, MAX_WORDS: LIMITS.words,
    MAX_RULE_COND: LIMITS.ruleConditions, MAX_RULE_WORDS: LIMITS.ruleWords, MAX_LIST: LIMITS.list,
    MAX_OPTIONS: LIMITS.options, MAX_DEPTH: LIMITS.depth, SAY_LEN: LIMITS.say, TITLE_LEN: LIMITS.title,
    OPTION_LEN: LIMITS.option, MAX_MONEY: LIMITS.money, WORD_LEN: LIMITS.word, FLAG_LEN: LIMITS.flag,
  }; // prettier-ignore
  for (const [name, value] of Object.entries(pairs)) sure(define(name) === value, `${name}: plugin ${define(name)}, checker ${value}`);
  sure(LIMITS.id === define("NAME_LEN") - 1 && LIMITS.shop === LIMITS.id && LIMITS.speaker === LIMITS.id, "NAME_LEN");
});

test("script check: a global file's unknown NPC is a warning (skipped on that map), a map file's is an error", () => {
  const s = { format: "smak-script/1", rules: [{ id: "x", on: "use", npc: "ghost", do: [{ say: "Hola." }] }] };
  const g = checkScript(s, { rp, global: true });
  sure(g.errors.length === 0 && g.warnings.some((w) => /NPC "ghost" is not in the rp\.json/.test(w)), `${g.errors} ${g.warnings}`);
  const m = checkScript(s, { rp });
  sure(m.errors.some((e) => /NPC "ghost" is not in the rp\.json \(it has: fixer\)/.test(e)), `${m.errors}`);
});

test("script check: another checker plugs in through refs and extras", () => {
  const s = copy(script);
  s.rules.push({ id: "shop_talk", on: "use", npc: "fixer", do: [{ open_shop: "marco" }] });
  const ok = checkScript(s, { rp, refs: { shops: new Set(["marco"]) } });
  sure(ok.errors.length === 0, ok.errors.join(" | "));
  const bad = checkScript(s, { rp, refs: { shops: new Set(["other"]) } });
  sure(bad.errors.some((e) => /open_shop marco: no such shop/.test(e)), bad.errors.join(" | "));
  const extra = checkScript(script, { rp, extras: [() => ({ errors: ["extra says no"], warnings: ["extra warns"] })] });
  sure(extra.errors.includes("extra says no") && extra.warnings.includes("extra warns"), "extras not run");
});

test("script check: the keywords are matched as the plugin normalises them", () => {
  sure(normalise("Dame  DINERO!") === "dame dinero" && normalise("  hola, ") === "hola", "normalise");
});

test("rp check: the contract checker passes a small good rp.json and says why on a bad one", () => {
  const good = { ...rp, properties: [], places: [], arenas: [{ id: "yard" }], missions: [{ id: "m", giver: "fixer", arena: "yard", done: { reward: { money: 50 } } }] };
  const r = checkRp(good);
  sure(r.errors.length === 0, r.errors.join(" | "));
  const bad = copy(good);
  bad.missions[0].done.reward.money = 5000000;
  sure(checkRp(bad).errors.some((e) => /reward\.money must be an integer from 0 to 100000/.test(e)), "reward");
});

test("smak check rp: ends in PASS for the test map's files and FAIL for a broken one, its last line", () => {
  const rpFile = join(tmp, "smak_rp_mtest.rp.json");
  const scr = join(tmp, "smak_rp_mtest.script.json");
  writeFileSync(rpFile, JSON.stringify({ ...rp, properties: [], places: [], arenas: [], missions: [] }));
  writeFileSync(scr, JSON.stringify(script));
  const a = smak("check", "rp", scr);
  sure(a.status === 0 && /^PASS: /.test(a.stdout.trim().split("\n").pop()), `${a.stdout} ${a.stderr}`);
  const b = smak("check", "rp", rpFile);
  sure(b.status === 0 && /^PASS: /.test(b.stdout.trim().split("\n").pop()), `${b.stdout} ${b.stderr}`);
  const broken = copy(script);
  broken.rules[0].do.push({ teleport_all: 1 });
  writeFileSync(scr, JSON.stringify(broken));
  const c = smak("check", "rp", scr);
  const lines = c.stdout.trim().split("\n");
  sure(c.status === 1 && /^FAIL: /.test(lines.pop()) && lines.some((l) => /unknown action "teleport_all"/.test(l)), `${c.stdout} ${c.stderr}`);
  const d = smak("check", "rp", join(tmp, "nothing.script.json"));
  sure(d.status === 1 && /no such file/.test(d.stderr), `${d.stdout} ${d.stderr}`);
});

test("script check: an id smak_npc generates is accepted beside the rp.json's own NPCs, one it does not is not", () => {
  const s = copy(script);
  s.rules.push({ id: "keeper_talk", on: "use", npc: "shopkeeper_ms1_shop", duck: true, do: [{ say: "Hola." }] });
  const ok = checkScript(s, { rp, generated: ["shopkeeper_ms1_shop"] });
  sure(ok.errors.length === 0, ok.errors.join(" | "));
  const bad = checkScript(s, { rp, generated: ["citizen_01"] });
  sure(bad.errors.some((e) => /NPC "shopkeeper_ms1_shop" is not in the rp\.json/.test(e)), bad.errors.join(" | "));
});
