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
