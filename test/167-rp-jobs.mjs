// The RP jobs check (levels/rp/jobs.mjs, levels/rp/plugin/smak_jobs.sma): the example jobs and the mtest office pass
// with nothing said, the office is inside the test room and clear of the shop, the police station and the clinic, and
// the plugin's tables, formats and skill names are the checker's. The failures, one by one, are in test/broken/rp-jobs.mjs.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test, sure, HERE } from "./helper.mjs";
import { checkJobs, LIMITS, JOBS_FORMAT, SITES_FORMAT, SKILLS, SKILL_MAX, PERMS } from "../levels/rp/jobs.mjs";

const dir = join(HERE, "../levels/rp");
const read = (p) => JSON.parse(readFileSync(join(dir, p), "utf8"));
const jobs = read("jobs/jobs.json");
const sites = read("jobs/smak_rp_mtest.jobs.json");
const src = readFileSync(join(dir, "plugin/smak_jobs.sma"), "utf8");

test("rp jobs: the example jobs and the mtest office pass with no error and no warning", () => {
  const r = checkJobs(jobs, sites);
  sure(r.errors.length === 0 && r.warnings.length === 0, `errors ${r.errors.join(" | ")}; warnings ${r.warnings.join(" | ")}`);
  sure(r.facts.some((f) => /^5 jobs/.test(f)) && r.facts.some((f) => /smak_rp_mtest: 1 offices/.test(f)), r.facts.join(" | "));
});

test("rp jobs: the jobs alone pass, and offices come as one file or several", () => {
  sure(checkJobs(jobs).errors.length === 0, "the jobs alone");
  sure(checkJobs(jobs, [sites, { ...sites, map: "other_map" }]).errors.length === 0, "two files");
});

test("rp jobs: the office is inside the test room and its circle touches no other circle of the room", () => {
  const room = { min: [-3072, 0, 0], max: [-2432, 512, 192] }; // levels/rp/test-map.mjs ROOM
  const o = sites.sites[0];
  sure(o.origin.every((v, k) => v >= room.min[k] && v <= room.max[k]), `origin ${o.origin} outside the room`);
  const others = [
    ["shop", read("items/smak_rp_mtest.shops.json").shops[0]],
    ["police station", read("law/smak_rp_mtest.law.json").stations[0]],
    ["clinic", read("implants/smak_rp_mtest.clinics.json").clinics[0]],
  ];
  for (const [what, c] of others) {
    const d = Math.hypot(...o.origin.map((v, k) => v - c.origin[k]));
    sure(d > o.radius + c.radius, `the office is ${d.toFixed(0)} from the ${what}; the circles need more than ${o.radius + c.radius}`);
  }
});

test("rp jobs: the limits, formats, skills and permissions the plugin keeps are the checker's", () => {
  const def = (n) => Number(src.match(new RegExp(`^#define ${n}[ ]+([0-9]+)`, "m"))?.[1]);
  sure(def("MAX_JOBS") === LIMITS.jobs && def("MAX_SITES") === LIMITS.sites, "jobs or offices");
  sure(def("NAME_LEN") === LIMITS.name + 1 && def("ID_LEN") === LIMITS.id + 1, "name or id length");
  sure(def("SALARY_MAX") === LIMITS.salary && def("JOB_MAX_SLOTS") === LIMITS.slots, "salary or slots");
  sure(src.includes(`#define JOBS_FORMAT   "${JOBS_FORMAT}"`) && src.includes(`#define SITES_FORMAT  "${SITES_FORMAT}"`), "format");
  const skills = readFileSync(join(dir, "plugin/smak_skills.sma"), "utf8");
  sure(skills.includes(`SK_NAME[NSK][] = { ${SKILLS.map((s) => `"${s}"`).join(", ")} }`), "the skill names");
  sure(readFileSync(join(dir, "plugin/include/smak_skills.inc"), "utf8").includes(`#define SMAK_SKILL_MAX_LEVEL ${SKILL_MAX}`), "skill max level");
  for (const p of PERMS) sure(src.includes(`equal(p, "${p}")`), `the plugin does not know the permission ${p}`);
  sure(src.includes('#define UNEMPLOYED    "unemployed"'), "default job");
});

test("rp jobs: the plugin never uses what crashes Xash", () => {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  sure(!/FM_KeyValue|get_kvd|copy_infokey_buffer|GetInfoKeyBuffer/.test(code), "a forbidden call is used");
});

test("rp events: smak_core registers smak_event, the include declares it with its kinds, and every plugin that says smak_say can load without it", () => {
  const plug = (n) => readFileSync(join(dir, `plugin/${n}.sma`), "utf8");
  const inc = readFileSync(join(dir, "plugin/include/smak_core.inc"), "utf8");
  const core = plug("smak_core");
  sure(core.includes('register_native("smak_event", "_event")') && core.includes('register_library("smak_event")'), "smak_core does not register the native and its library");
  sure(inc.includes("native smak_event(id, kind, const fmt[], any:...);") && inc.includes("stock smak_say("), "the include lacks smak_event or smak_say");
  const kinds = ["EV_INFO", "EV_MONEY", "EV_LAW", "EV_JOB", "EV_MISSION", "EV_DANGER", "EV_ITEM"];
  kinds.forEach((k, i) => sure(new RegExp(`#define ${k}[ ]+${i}[ ]`).test(inc), `kind ${k} is not ${i}`));
  sure(core.includes('create_cvar("smak_core_events"') && core.includes('"/eventos"'), "the cvar or /eventos is missing");
  sure(/ClearSyncHud/.test(core) && /set_task\(1\.0, "task_evbox"/.test(core), "the box is not redrawn on a light task, or not cleared");
  for (const n of ["law", "jobs", "items", "implants", "skills", "doors", "rp", "script"]) {
    const s = plug(`smak_${n}`);
    const uses = /smak_say\(|smak_event\(|rp_event\(/.test(s);
    if (!uses) continue;
    sure(/set_native_filter\(/.test(s), `smak_${n} uses the event box without a native filter`);
    sure(/equal\(name, "smak_event", 10\)|if \(!trap\) return PLUGIN_HANDLED/.test(s) || n === "rp", `smak_${n}'s filter does not let smak_event go missing`);
  }
  // no mission/law/job line the player must read is left as a bare chat line of the moved kind
  const law = plug("smak_law");
  sure(/smak_say\(id, EV_LAW, "Arrestado/.test(law) && /smak_say\(id, EV_LAW, "Libre/.test(law), "law's arrest and release are not events");
  sure(/smak_say\([a-z]+, EV_MONEY|ev_add\(id, EV_MONEY/.test(core), "money changes are not events");
  for (const n of ["core", "law", "items", "implants", "skills", "doors", "rp", "script", "jobs"]) {
    const code = plug(`smak_${n}`).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    sure(!/FM_KeyValue|get_kvd|copy_infokey_buffer|GetInfoKeyBuffer/.test(code), `smak_${n} uses a call that crashes Xash`);
  }
});
