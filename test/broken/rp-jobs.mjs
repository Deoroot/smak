// The RP jobs check (levels/rp/jobs.mjs checkJobs) broken in one way each. The example jobs and the mtest office are the whole twin.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { HERE } from "../helper.mjs";
import { broken } from "./case.mjs";
import { checkJobs } from "../../levels/rp/jobs.mjs";

const read = (p) => JSON.parse(readFileSync(join(HERE, "../levels/rp", p), "utf8"));
const jobs = read("jobs/jobs.json");
const sites = read("jobs/smak_rp_mtest.jobs.json");
const copy = (o) => JSON.parse(JSON.stringify(o));
/** What checkJobs says is wrong, after `change(jobs, sites)` is made to copies of the files: its errors, or its warnings. */
const said = (level, change) => {
  const j = copy(jobs);
  const s = copy(sites);
  change?.(j, s);
  return checkJobs(j, s)[level];
};
const errors = (change) => said("errors", change);
const warnings = (change) => said("warnings", change);
const guard = (j) => j.jobs.find((x) => x.id === "guardia");
const whole = () => errors();
const wholeWarnings = () => warnings();

broken("checkJobs", "a jobs file of another format", {
  said: /the jobs file has format "smak-jobs\/2", not "smak-jobs\/1"/,
  broken: () => errors((j) => (j.format = "smak-jobs/2")),
  whole,
});
broken("checkJobs", "a jobs file with no default job", {
  said: /the jobs file has no default job unemployed/,
  broken: () => errors((j) => (j.jobs = j.jobs.filter((x) => x.id !== "unemployed"))),
  whole,
});
broken("checkJobs", "a job id used twice", {
  said: /the job id medico is used twice/,
  broken: () => errors((j) => j.jobs.push({ ...copy(j.jobs[2]) })),
  whole,
});
broken("checkJobs", "a negative salary", {
  said: /job 2 \(guardia\): salary must be a whole number from 0 to 10000/,
  broken: () => errors((j) => (guard(j).salary = -5)),
  whole,
});
broken("checkJobs", "a fractional salary", {
  said: /job 2 \(guardia\): salary must be a whole number from 0 to 10000/,
  broken: () => errors((j) => (guard(j).salary = 12.5)),
  whole,
});
broken("checkJobs", "a salary for the default job", {
  said: /the default job unemployed must pay no salary/,
  broken: () => errors((j) => (j.jobs[0].salary = 10)),
  whole,
});
broken("checkJobs", "a requirement on an unknown skill", {
  said: /job 2 \(guardia\): requires an unknown skill "karate"/,
  broken: () => errors((j) => (guard(j).requires = { skill: "karate", level: 2 })),
  whole,
});
broken("checkJobs", "a requirement of a level past the maximum", {
  said: /job 2 \(guardia\): the required skill level must be a whole number from 1 to 20/,
  broken: () => errors((j) => (guard(j).requires = { skill: "cuerpo", level: 21 })),
  whole,
});
broken("checkJobs", "an unknown permission", {
  said: /job 2 \(guardia\): unknown permission "fly"/,
  broken: () => errors((j) => guard(j).perms.push("fly")),
  whole,
});
broken("checkJobs", "more jobs than the plugin keeps", {
  said: /the jobs file has 10 jobs; the plugin keeps 8/,
  broken: () =>
    errors((j) => {
      for (let i = 0; i < 4; i++) j.jobs.push({ id: `extra${i}`, name: "Extra", salary: 10, max: 1 });
    }),
  whole,
});
broken("checkJobs", "arrest powers with no limit of players", {
  said: /job 2 \(guardia\): arrest powers with no limit of players/,
  broken: () => warnings((j) => (guard(j).max = 0)),
  whole: wholeWarnings,
});
broken("checkJobs", "an office that offers an unknown job", {
  said: /smak_rp_mtest office 1 \(oficina_empleo\): offers the unknown job "ladron"/,
  broken: () => errors((j, s) => (s.sites[0].jobs = ["medico", "ladron"])),
  whole,
});
broken("checkJobs", "an office with no radius", {
  said: /smak_rp_mtest office 1 \(oficina_empleo\): it needs a radius of more than 0/,
  broken: () => errors((j, s) => delete s.sites[0].radius),
  whole,
});
broken("checkJobs", "a job that no office offers", {
  said: /smak_rp_mtest: no office offers the job mecanico/,
  broken: () => warnings((j, s) => (s.sites[0].jobs = ["guardia", "medico", "comerciante", "mensajero"])),
  whole: wholeWarnings,
});
