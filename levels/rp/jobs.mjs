// The offline check of the RP jobs (levels/rp/plugin/smak_jobs.sma): `jobs.json` (format "smak-jobs/1") and a map's
// `<map>.jobs.json` of employment offices (format "smak-jobsites/1"). It reads the files as the plugin does and says,
// in sentences, what the plugin would refuse or leave out, and what would make a bad economy.
export const JOBS_FORMAT = "smak-jobs/1";
export const SITES_FORMAT = "smak-jobsites/1";
/** The plugin's fixed tables: jobs, offices, bytes of an id and a name (minus the end of the string), the salary and the slots. */
export const LIMITS = { jobs: 8, sites: 8, id: 31, name: 47, salary: 10000, slots: 32 };
export const PERMS = ["arrest", "heal", "repair", "lawful"];
export const SKILLS = ["punteria", "cuerpo", "atletismo", "resistencia"]; // smak_skills.sma
export const SKILL_MAX = 20;
export const DEFAULT_JOB = "unemployed";
const WARN_SALARY = 2000;
const ID = /^[a-z][a-z0-9_]*$/;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);

/**
 * Returns { errors, warnings, facts }. `sites` is a map file or a list of them (optional). Errors are what the plugin
 * would refuse or leave out; warnings are what it keeps but is probably a mistake.
 */
export function checkJobs(jobs, sites) {
  const errors = [];
  const warnings = [];
  const facts = [];
  if (!jobs || typeof jobs !== "object" || Array.isArray(jobs)) return { errors: ["the jobs file is not a JSON object"], warnings, facts };
  if (jobs.format !== JOBS_FORMAT) errors.push(`the jobs file has format ${JSON.stringify(jobs.format)}, not "${JOBS_FORMAT}"`);
  const list = Array.isArray(jobs.jobs) ? jobs.jobs : null;
  if (!list) {
    errors.push("the jobs file has no `jobs` list");
    return { errors, warnings, facts };
  }
  if (list.length > LIMITS.jobs) errors.push(`the jobs file has ${list.length} jobs; the plugin keeps ${LIMITS.jobs}`);
  const ids = new Set();
  list.forEach((j, i) => {
    const at = `job ${i + 1}${typeof j?.id === "string" ? ` (${j.id})` : ""}`;
    if (!j || typeof j !== "object") return errors.push(`${at} is not an object`);
    if (typeof j.id !== "string" || !j.id) errors.push(`${at} has no id`);
    else if (!ID.test(j.id) || j.id.length > LIMITS.id) errors.push(`${at}: the id must be lower-case letters, digits and _, up to ${LIMITS.id} characters`);
    else if (ids.has(j.id)) errors.push(`the job id ${j.id} is used twice`);
    else ids.add(j.id);
    if (typeof j.name !== "string" || !j.name.trim()) errors.push(`${at} has no name`);
    else if (Buffer.byteLength(j.name) > LIMITS.name) errors.push(`${at}: the name is longer than ${LIMITS.name} bytes`);
    if (!isInt(j.salary) || j.salary < 0 || j.salary > LIMITS.salary) errors.push(`${at}: salary must be a whole number from 0 to ${LIMITS.salary}`);
    else if (j.salary > WARN_SALARY) warnings.push(`${at}: salary ${j.salary} per paycheck is very high`);
    if (!isInt(j.max) || j.max < 0 || j.max > LIMITS.slots) errors.push(`${at}: max must be a whole number from 0 (no limit) to ${LIMITS.slots}`);
    if (j.requires !== undefined) {
      const r = j.requires;
      if (!r || typeof r !== "object" || Array.isArray(r)) errors.push(`${at}: requires must be { skill, level }`);
      else if (!SKILLS.includes(r.skill)) errors.push(`${at}: requires an unknown skill ${JSON.stringify(r.skill)} (${SKILLS.join(", ")})`);
      else if (!isInt(r.level) || r.level < 1 || r.level > SKILL_MAX) errors.push(`${at}: the required skill level must be a whole number from 1 to ${SKILL_MAX}`);
    }
    if (j.perms !== undefined) {
      if (!Array.isArray(j.perms)) errors.push(`${at}: perms must be a list`);
      else for (const p of j.perms) if (!PERMS.includes(p)) errors.push(`${at}: unknown permission ${JSON.stringify(p)} (${PERMS.join(", ")})`);
    }
    if (j.id === DEFAULT_JOB) {
      if (j.salary !== 0) errors.push(`the default job ${DEFAULT_JOB} must pay no salary: everybody has it`);
      if (j.perms?.length) errors.push(`the default job ${DEFAULT_JOB} must give no permissions: everybody has it`);
      if (j.requires) errors.push(`the default job ${DEFAULT_JOB} cannot have a requirement: everybody has it`);
      if (j.max !== 0) errors.push(`the default job ${DEFAULT_JOB} cannot have a limit of players: everybody has it`);
    } else if (Array.isArray(j.perms) && j.perms.includes("arrest") && j.max === 0)
      warnings.push(`${at}: arrest powers with no limit of players: anyone may become a guard`);
  });
  if (!ids.has(DEFAULT_JOB)) errors.push(`the jobs file has no default job ${DEFAULT_JOB}`);
  if (!list.some((j) => j?.id !== DEFAULT_JOB && j?.salary > 0)) warnings.push("no job pays a salary");
  facts.push(`${list.length} jobs`);

  const files = sites === undefined ? [] : Array.isArray(sites) ? sites : [sites];
  for (const file of files) {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      errors.push("a jobsites file is not a JSON object");
      continue;
    }
    if (file.format !== SITES_FORMAT) errors.push(`the jobsites file has format ${JSON.stringify(file.format)}, not "${SITES_FORMAT}"`);
    if (typeof file.map !== "string" || !file.map) errors.push("the jobsites file names no map");
    const map = file.map || "?";
    if (!Array.isArray(file.sites)) {
      errors.push(`${map}: the jobsites file has no \`sites\` list`);
      continue;
    }
    if (file.sites.length > LIMITS.sites) errors.push(`${map} has ${file.sites.length} offices; the plugin keeps ${LIMITS.sites}`);
    if (!file.sites.length) warnings.push(`${map}: no office: /trabajo can never be used on this map`);
    const seen = new Set();
    const offered = new Set();
    let all = false;
    file.sites.forEach((s, i) => {
      const at = `${map} office ${i + 1}${typeof s?.id === "string" ? ` (${s.id})` : ""}`;
      if (!s || typeof s !== "object") return errors.push(`${at} is not an object`);
      if (typeof s.id !== "string" || !s.id) errors.push(`${at} has no id`);
      else if (!ID.test(s.id) || s.id.length > LIMITS.id) errors.push(`${at}: the id must be lower-case letters, digits and _, up to ${LIMITS.id} characters`);
      else if (seen.has(s.id)) errors.push(`the office id ${s.id} is used twice in ${map}`);
      else seen.add(s.id);
      if (typeof s.name !== "string" || !s.name.trim()) errors.push(`${at} has no name`);
      else if (Buffer.byteLength(s.name) > LIMITS.name) errors.push(`${at}: the name is longer than ${LIMITS.name} bytes`);
      if (!Array.isArray(s.origin) || s.origin.length !== 3 || !s.origin.every(isNum)) errors.push(`${at}: origin must be [x, y, z]`);
      else if (s.origin.some((v) => Math.abs(v) > 4096)) warnings.push(`${at}: origin ${JSON.stringify(s.origin)} is past +-4096`);
      if (!isNum(s.radius) || s.radius <= 0) errors.push(`${at}: it needs a radius of more than 0`);
      else if (s.radius > 512) warnings.push(`${at}: radius ${s.radius} is large: a job can be taken from far away`);
      if (s.jobs === undefined) all = true;
      else if (!Array.isArray(s.jobs) || !s.jobs.length) errors.push(`${at}: jobs must be a list of job ids (leave it out to offer them all)`);
      else
        for (const id of s.jobs) {
          if (id === DEFAULT_JOB) errors.push(`${at}: offers ${DEFAULT_JOB}, which is taken by quitting`);
          else if (!ids.has(id)) errors.push(`${at}: offers the unknown job ${JSON.stringify(id)}`);
          else offered.add(id);
        }
    });
    if (file.sites.length && !all)
      for (const j of list) if (j?.id && j.id !== DEFAULT_JOB && !offered.has(j.id)) warnings.push(`${map}: no office offers the job ${j.id}`);
    facts.push(`${map}: ${file.sites.length} offices`);
  }
  return { errors, warnings, facts };
}
