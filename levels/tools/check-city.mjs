#!/usr/bin/env node
// check-city: checks a city description (levels/specs/*.json, smak-city-description/1) with no geometry: valid
// field by field; every place reached on foot by public ways; the vehicle network joined to the gate, wide enough
// and turning; the layers joined by enough connectors within a walk; homes per class and layer; buildings per
// layer; repeats; palette discipline; the required places and their programs; the MSR's network and checkpoints;
// secrets; tiles, seams and portals, each tile on its own; the engine budget whole and per tile. Answers PASS in
// a few lines, or FAIL with the reasons. levels/specs/CITY.md documents the format and the checks.
//
//   node levels/tools/check-city.mjs <city.json> [--bands file.json | --bands rp-provisional | --bands none]
//        [--json out.json] [--verbose]
//
//   --bands    a bands object ({ metrics: { <metric>: { p5, q1, median, q3, p95, min, max } } }) or an rp-city
//              style file of levels/styles/ (its `bands` of { band: { median, p10, p90 } }, held where a city
//              measure has the name), or "rp-provisional" (RP_CITY_PROVISIONAL in levels/lib/city-checks.mjs), or
//              "none". Default: levels/styles/rp-city.json when it exists, else rp-provisional.
//   --json     writes the whole result (metrics, walks, tiles, budget, every band's verdict) to a file
//   --verbose  prints the notes when it passes too
//
// Exit code 0 on PASS, 1 on FAIL, 2 on wrong arguments.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkCity, describeCityCheck, bandsFromCityStyle, RP_CITY_PROVISIONAL } from "../lib/city-checks.mjs";

const args = { _: [] };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--verbose") args.verbose = true;
  else if (a.startsWith("--")) args[a.slice(2)] = process.argv[++i];
  else args._.push(a);
}
const file = args._[0];
if (!file || ("bands" in args && args.bands === undefined) || ("json" in args && args.json === undefined)) {
  console.error("usage: check-city <city.json> [--bands file.json|rp-provisional|none] [--json out.json] [--verbose]"); // prettier-ignore
  process.exit(2);
}
let desc;
try {
  desc = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (e) {
  console.error(`FAIL  ${file}: cannot read it as JSON (${e.message})`);
  process.exit(1);
}
const STYLE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../styles/rp-city.json");
let choice = args.bands ?? (fs.existsSync(STYLE) ? STYLE : "rp-provisional");
let bands = null;
if (choice === "rp-provisional") bands = RP_CITY_PROVISIONAL;
else if (choice !== "none") {
  try {
    bands = bandsFromCityStyle(JSON.parse(fs.readFileSync(choice, "utf8")));
  } catch (e) {
    console.error(`check-city: cannot read the bands ${choice} (${e.message})`);
    process.exit(2);
  }
}
const result = checkCity(desc, bands);
const bandsName = bands ? (bands.name ?? path.basename(choice)) : null;
console.log(describeCityCheck(result, { name: desc?.name ?? path.basename(file), bandsName, verbose: args.verbose }));
if (bands?.unheld?.length && args.verbose) console.log(`  bands not held (no city measure of that name): ${bands.unheld.join(", ")}`); // prettier-ignore
if (args.json) {
  fs.writeFileSync(args.json, JSON.stringify({ file, bands: bandsName, ...result }, null, 1));
  console.log(`  detail: ${args.json}`);
}
process.exit(result.pass ? 0 : 1);
