#!/usr/bin/env node
// build-site: a site spec (smak-site/1) planned, assembled from a piece library, dressed, written as a .map and
// compiled: the whole map a person plays.
//
//   node levels/tools/build-site.mjs <spec> --out <folder> [--pieces mese] [--dress h9-byzantium] [--mode fast|full|none]
//        [--cache <folder>] [--engine xash|goldsrc] [--format bsp2|bsp30ext|bsp30|smallest] [--rcw-gates gate,lid,...]
//
//   <spec>    a name under levels/specs (byzantium-01) or a path
//   --mode    fast (the default): hlvis and hlrad at their fastest, for a look; full: -extra and 8 bounces, the light
//             the game gets; none: the .map only
//   --cache   a folder where the site's building layouts are kept between runs (they take the longest)
//   --engine  xash (the default: the maps are for H9, on Xash3D FWGS) or goldsrc
//   --format  bsp2 (the default with xash: every RP map is BSP2 from 2026-11-05, the person's word), bsp30ext,
//             bsp30, or smallest (the smallest that fits). Both want SDHLT's goldsrc fork (2cwldys/sdhlt, built in
//             C:/Herramientas/sdhlt-xash/tools on this machine) in VHLT_DIR: VHLT knows neither switch
//
// The compilers and wads from the environment, as the self-test takes them: VHLT_DIR, and TS_WAD (specialists.wad),
// HL_WAD (halflife.wad), MESE_WAD (the H9 wad the Mese's pieces use, embedded in the .bsp).
// With a `below` in the spec, the level under the streets too (levels/assembly/below.mjs), its rules checked.
// Writes <name>.map, <name>.bsp (the spec's `name`), dress-report.json, and the RP contract (levels/rp/CONTRACT.md):
// <name>.rp.json (with its `paths`, the walking graph, held against the compiled map) and tsrp_roamspots_<name>.cfg, and
// RCBot's <name>.rcw from the same graph, in the folder. The .rcw goes to <game>/rcbot/waypoints/ts/ (H9XASH/rcbot/waypoints/ts/);
// --rcw-gates names the gates its paths may go through (default `gate`: the checkpoints; a leaf with a key is not a
// bot's, nor a lid slid by use; `gate,lid,grate` puts the ladders in). Ends with one line, PASS or
// FAIL; exit code 1 on a failure of the plan, the assembly, the dressing or the compile, or a leak.
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { planSite, checkSite, checkSpawns, assembleSite, siteSpec } from "../assembly/site.mjs";
import { dressSite, loadDress } from "../assembly/dress.mjs";
import { checkBelow } from "../assembly/below.mjs";
import { loadLibrary } from "../assembly/library.mjs";
import { writeMap } from "../../src/maps/source.mjs";
import { compileMap } from "../../src/maps/compile.mjs";
import { rpContract, roamspotsCfg } from "../rp/contract.mjs";
import { checkPaths, rcwOf } from "../rp/paths.mjs";
import { readRcw, waypointFlagNames } from "../../src/maps/rcbot.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const spec = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const out = flag("out");
const mode = flag("mode", "fast");
const engine = flag("engine", "xash");
const format = flag("format", engine === "xash" ? "bsp2" : "smallest");
if (!spec || !out || !["fast", "full", "none"].includes(mode) || !["xash", "goldsrc"].includes(engine) || !["bsp2", "bsp30ext", "bsp30", "smallest"].includes(format)) {
  console.error("build-site <spec> --out <folder> [--pieces mese] [--dress h9-byzantium] [--mode fast|full|none] [--cache <folder>] [--engine xash|goldsrc] [--format bsp2|bsp30ext|bsp30|smallest]"); // prettier-ignore
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const cache = flag("cache");
const plan = planSite(siteSpec(spec), cache ? { cache } : {});
const library = loadLibrary(join(HERE, "../assembly/pieces", flag("pieces", "mese")));
const built = assembleSite(plan, library);
const dress = flag("dress", "h9-byzantium");
const dressed = dress === "none" ? { brushes: [], entities: [], report: { failures: [], counts: {} } } : dressSite(plan, built, loadDress(dress));
const below = checkBelow(plan, undefined, built.report.spawns);
const failures = [...built.report.failures, ...checkSite(plan).failures, ...checkSpawns(plan, built.report.spawns).failures, ...below.failures, ...dressed.report.failures]; // prettier-ignore
const name = plan.site?.name ?? basename(spec, ".json");
console.log(`${name}: ${built.report.brushes} brushes, ${built.map.entities.length} entities; dressed ${JSON.stringify(dressed.report.counts)}`); // prettier-ignore
if (plan.below) {
  const m = below.measures;
  console.log(`below: ${m.parts} parts, ${m.cells} cells (${m.reached} reached from a way down), the longest tunnel ${m.longest} cells; ${m.ways} ways down (${Object.entries(m.kinds).map(([k, n]) => `${n} ${k}`).join(", ")}); looks ${m.looks.join(", ")}`); // prettier-ignore
  for (const w of below.warnings) console.log(`WARN  ${w}`);
}
for (const f of failures) console.log(`ERROR ${f}`);
const map = { ...built.map, brushes: [...built.map.brushes, ...dressed.brushes], entities: [...built.map.entities, ...dressed.entities] }; // prettier-ignore
const file = join(out, `${name}.map`);
writeFileSync(file, writeMap(map));
writeFileSync(join(out, "dress-report.json"), `${JSON.stringify(dressed.report, null, 1)}\n`);
/** The RP contract beside the map: its build the .bsp's sha1 when there is one; the .rcw from its graph. */
const writeContract = (bsp) => {
  const contract = rpContract(plan, built, { bsp });
  writeFileSync(join(out, `${name}.rp.json`), `${JSON.stringify(contract, null, 1)}
`);
  writeFileSync(join(out, `tsrp_roamspots_${name}.cfg`), roamspotsCfg(contract));
  console.log(`${name}.rp.json: ${contract.properties.length} properties, ${contract.places.length} places, ${contract.roam.length} roaming spots, ${contract.missions.length} missions`); // prettier-ignore
  const checked = checkPaths(contract.paths, contract);
  const rcw = rcwOf(contract.paths, { mapName: name, gates: flag("rcw-gates", "gate").split(",").filter(Boolean) });
  writeFileSync(join(out, `${name}.rcw`), rcw.bytes);
  const back = readRcw(rcw.bytes);
  const m = checked.measures;
  console.log(`paths: ${m.nodes} nodes, ${m.links} links, ${m.ways} ways down, ${m.components} piece${m.components === 1 ? "" : "s"}; ${bsp ? `held against the map: ${contract.paths.pruned} dropped` : "not held against a map (not compiled)"}`); // prettier-ignore
  console.log(`${name}.rcw: ${back.waypoints.length} waypoints, ${rcw.facts.paths} paths, ${rcw.facts.ladders} on ladders, ${rcw.facts.dropped} nodes left out (their ways need ${[...new Set(contract.paths.links.map((l) => l.gate).filter(Boolean))].filter((g) => !rcw.facts.gates.includes(g)).join(", ") || "nothing"} to pass), map ${back.mapName}; flags used: ${[...new Set(back.waypoints.flatMap((w) => waypointFlagNames(w.flags)))].join(", ") || "none"}`); // prettier-ignore
  for (const w of [...contract.paths.warnings, ...checked.warnings.filter((x) => !contract.paths.warnings.includes(x))]) console.log(`WARN  ${w}`);
  for (const n of contract.paths.notes ?? []) console.log(`WARN  paths: ${n}`);
  if ((contract.paths.pruned ?? 0) > (contract.paths.notes?.length ?? 0)) console.log(`WARN  paths: ${contract.paths.pruned - contract.paths.notes.length} more dropped by the map (contract.paths.pruned)`);
  for (const f of checked.failures) (failures.push(`paths: ${f}`), console.log(`ERROR paths: ${f}`));
  if (back.waypoints.length !== rcw.waypoints.length) failures.push("the .rcw read back is not the one written");
};
if (mode === "none") {
  writeContract(null);
  console.log(failures.length ? `FAIL: ${failures.length} failures before the compile` : `PASS: ${file} written (not compiled)`);
  process.exit(failures.length ? 1 : 0);
}
const wads = [process.env.TS_WAD, process.env.HL_WAD, process.env.MESE_WAD];
if (!process.env.VHLT_DIR || wads.some((w) => !w || !existsSync(w))) {
  console.log("FAIL: the compile wants VHLT in VHLT_DIR and the three wads in TS_WAD, HL_WAD and MESE_WAD");
  process.exit(1);
}
const started = Date.now();
const r = compileMap(file, { wads, wadinclude: library.wadinclude, fast: mode === "fast", engine, ...(format === "smallest" ? {} : { format }), compilers: { folder: process.env.VHLT_DIR }, args: mode === "full" ? { hlrad: ["-extra", "-bounce", "8"] } : {} }); // prettier-ignore
if (r.bsp) writeContract(readFileSync(r.bsp));
for (const e of r.errors) console.log(`ERROR ${e}`);
for (const w of r.warnings) console.log(`WARN  ${w}`);
const took = Math.round((Date.now() - started) / 1000);
const bad = failures.length + r.errors.length + (r.leak ? 1 : 0) + (r.bsp ? 0 : 1);
console.log(bad ? `FAIL: ${failures.length} failures, compile ${r.bsp ? "done" : "failed"}${r.leak ? `, LEAK near ${JSON.stringify(r.leak.at)}` : ""} (${took} s)` : `PASS: ${r.bsp} compiled in ${took} s, no leak`); // prettier-ignore
process.exit(bad ? 1 : 0);
