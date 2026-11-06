// The RP law check (levels/rp/law.mjs, levels/rp/plugin/smak_law.sma): the mtest police station passes with nothing
// said, the station is inside the test room and clear of the shop, and the plugin's table sizes are the checker's.
// The failures, one by one, are in test/broken/rp-law.mjs.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test, sure, HERE } from "./helper.mjs";
import { checkLaw, LIMITS, LAW_FORMAT } from "../levels/rp/law.mjs";

const dir = join(HERE, "../levels/rp");
const law = JSON.parse(readFileSync(join(dir, "law/smak_rp_mtest.law.json"), "utf8"));
const shops = JSON.parse(readFileSync(join(dir, "items/smak_rp_mtest.shops.json"), "utf8"));

test("rp law: the mtest police station passes with no error and no warning", () => {
  const r = checkLaw(law);
  sure(r.errors.length === 0 && r.warnings.length === 0, `errors ${r.errors.join(" | ")}; warnings ${r.warnings.join(" | ")}`);
  sure(r.facts.some((f) => /smak_rp_mtest: 1 stations/.test(f)), r.facts.join(" | "));
});

test("rp law: the station is inside the test room and its circle does not touch the shop's", () => {
  const room = { min: [-3072, 0, 0], max: [-2432, 512, 192] }; // levels/rp/test-map.mjs ROOM
  const st = law.stations[0];
  sure(st.origin.every((v, k) => v >= room.min[k] && v <= room.max[k]), `origin ${st.origin} outside the room`);
  const sh = shops.shops[0];
  const d = Math.hypot(...st.origin.map((v, k) => v - sh.origin[k]));
  sure(d > st.radius + sh.radius, `distance ${d.toFixed(0)} <= ${st.radius + sh.radius}`);
});

test("rp law: the limits the plugin keeps are the checker's", () => {
  const src = readFileSync(join(dir, "plugin/smak_law.sma"), "utf8");
  const def = (n) => Number(src.match(new RegExp(`^#define ${n}[ ]+([0-9]+)`, "m"))?.[1]);
  sure(def("MAX_STATIONS") === LIMITS.stations, "stations");
  sure(def("NAME_LEN") === LIMITS.name + 1 && def("ID_LEN") === LIMITS.id + 1, "name or id length");
  sure(src.includes(`#define LAW_FORMAT    "${LAW_FORMAT}"`), "format");
});

test("rp law: the jail's natives, cvars, commands and table are in the plugin and its include", () => {
  const src = readFileSync(join(dir, "plugin/smak_law.sma"), "utf8");
  const inc = readFileSync(join(dir, "plugin/include/smak_law.inc"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const n of ["smak_law_jailed", "smak_law_release"]) {
    sure(new RegExp(`^native (bool:)?${n}[(]`, "m").test(inc), `${n} is not in smak_law.inc`);
    sure(code.includes(`register_native("${n}"`), `${n} is not registered`);
  }
  for (const [c, v] of [["smak_law_jail_sec", "60"], ["smak_law_jail_star", "15"], ["smak_law_jail_max", "180"], ["smak_law_jail_radius", "192"]])
    sure(new RegExp(`create_cvar[(]"${c}", "${v}"`).test(code), `cvar ${c} with default ${v}`);
  for (const k of ["kill", "explode", "spectate"]) sure(code.includes(`register_clcmd("${k}", "cmd_noescape")`), `${k} is not held`);
  sure(code.includes('register_concmd("smak_unjail"'), "smak_unjail");
  sure(code.includes("RegisterHamPlayer(Ham_Spawn") && code.includes("FM_ClientDisconnect"), "the respawn or disconnect hook");
  sure(/#define Q_CREATE_JAIL "CREATE TABLE IF NOT EXISTS law_jail/.test(src), "the law_jail table");
  sure(/the cells are the places of kind|"cell"/.test(code), "cells are read from the places of kind cell");
  sure(!/FM_KeyValue|get_kvd|copy_infokey_buffer|GetInfoKeyBuffer/.test(code), "a forbidden call is used");
});

test("rp jobs/law: role spawns and the arrest chat in smak_jobs use only what the include offers", () => {
  const jobs = readFileSync(join(dir, "plugin/smak_jobs.sma"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  sure(jobs.includes('create_cvar("smak_jobs_role_spawn", "1"') && jobs.includes("RegisterHamPlayer(Ham_Spawn"), "role spawn cvar or hook");
  sure(jobs.includes("smak_law_jailed(") && jobs.includes("law_ok()"), "a prisoner is left in his cell");
  sure(/json_object_get_value\(root, "spawns"\)/.test(jobs), "spawns are read from the rp.json");
});
