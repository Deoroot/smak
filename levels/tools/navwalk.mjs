#!/usr/bin/env node
// navwalk: the second walk test of a compiled map, on a navmesh (levels/assembly/navwalk.mjs, Recast & Detour),
// sharing no walking code with `smak map-reach`. From the map's info_player_start and info_player_deathmatch it asks
// whether each target is reached; with no targets, whether every island of floor of a cell (64 x 64) or more is.
//
//   node levels/tools/navwalk.mjs <map.bsp> [--targets targets.json] [--doors open|closed] [--report out.json]
//                                 [--islands fail|report] [--verbose]
//
// targets.json: `[{ "name": "bed1's middle", "at": [x, y, z] }]` (or `{ "targets": [...] }`).
// The detail (the whole report) goes to --report, or unless told to <the system's temp folder>/smak/navwalk-<map>.json.
// Ends with one line, PASS or FAIL. Exit code 0 on PASS, 1 on FAIL, 2 on wrong arguments or no navmesh library.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { navWalk, navAvailable } from "../assembly/navwalk.mjs";

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const usage = "usage: navwalk <map.bsp> [--targets targets.json] [--doors open|closed] [--report out.json] [--islands fail|report] [--verbose]"; // prettier-ignore
const file = args.find(
  (a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && args[i - 1] !== "--verbose"),
);
if (!file || !fs.existsSync(file)) {
  console.error(file ? `navwalk: no file ${file}\n${usage}` : usage);
  process.exit(2);
}
const doors = option("--doors") ?? "open";
if (doors !== "open" && doors !== "closed") {
  console.error(`navwalk: --doors is open or closed, not ${doors}\n${usage}`);
  process.exit(2);
}
const islands = option("--islands");
if (islands !== undefined && islands !== "fail" && islands !== "report") {
  console.error(`navwalk: --islands is fail or report, not ${islands}\n${usage}`);
  process.exit(2);
}
let targets = [];
const targetsFile = option("--targets");
if (targetsFile) {
  try {
    const read = JSON.parse(fs.readFileSync(targetsFile, "utf8"));
    targets = Array.isArray(read) ? read : read.targets;
    if (!Array.isArray(targets) || targets.some((t) => !Array.isArray(t.at) || t.at.length !== 3))
      throw new Error('it is a list of { "name", "at": [x, y, z] }');
  } catch (e) {
    console.error(`navwalk: the targets in ${targetsFile} cannot be read: ${e.message}`);
    process.exit(2);
  }
}
if (!(await navAvailable())) {
  console.error("FAIL: navwalk needs the npm package recast-navigation: run npm install in the kit's folder");
  process.exit(2);
}

const report = await navWalk(fs.readFileSync(file), { targets, doors, islands });
const out =
  option("--report") ??
  path.join(os.tmpdir(), "smak", `navwalk-${path.basename(file, path.extname(file))}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ map: path.resolve(file), ...report }, null, 2) + "\n");

const name = path.basename(file);
if (args.includes("--verbose")) console.log(JSON.stringify(report, null, 2));
const start = report.islands.filter((i) => i.start);
const walked = start.reduce((s, i) => s + i.area, 0);
const total = report.islands.reduce((s, i) => s + i.area, 0);
const reached = report.targets.filter((t) => t.reached).length;
console.log(`      ${report.geometry}`);
console.log(`      navmesh: ${report.navmesh?.polygons ?? 0} polygons in ${report.islands.length} islands; the start's ${start.length > 1 ? `${start.length} islands` : "island"} ${walked} of ${total} square units; ${report.navmesh?.seconds ?? "?"} s`); // prettier-ignore
for (const f of report.failures) console.log(`FAIL  ${f}`);
console.log(`      the detail: ${out}`);
const what = targets.length
  ? `${reached} of ${targets.length} targets reached`
  : `${report.islands.length} islands`;
if (report.ok) console.log(`PASS: ${name}: ${what} on the navmesh (radius 16, height 72, step 18)`);
else console.log(`FAIL: ${name}: ${what}; ${report.failures.length} failures: ${report.failures[0]}${report.failures.length > 1 ? " ..." : ""}`); // prettier-ignore
process.exit(report.ok ? 0 : 1);
