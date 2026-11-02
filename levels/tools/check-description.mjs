#!/usr/bin/env node
// check-description: checks a level description (levels/specs/*.json) with no geometry: valid, every space
// reachable, the goal reachable without a secret, every key before its gate, no one-way drop that strands the
// player; then its measures held to a style's bands. Answers PASS in one line, or FAIL with the reasons.
//
//   node levels/tools/check-description.mjs <description.json> [--bands bands.json | --bands msr-provisional | --bands none]
//        [--json out.json] [--verbose]
//
//   --bands    a bands object as JSON ({ metrics: { <metric>: { p5, q1, median, q3, p95, min, max } } }), or
//              "msr-provisional" (the fixture in levels/lib/description-checks.mjs), or "none" (graph checks only).
//              A style file of levels/styles/ (it has `bands` of { band: { median, p10, p90 } }) is read
//              through bandsFromStyle: crossing, walkedArea, loops, branches, offPathShare where banded.
//              Default: msr-provisional when the description's style.kind is "rpg-exploration", else none.
//   --json     writes the whole result (metrics, route, pacing curve, every band's verdict) to a file
//   --verbose  prints the pacing curve and the notes when it passes too
//
// Exit code 0 on PASS, 1 on FAIL, 2 on wrong arguments.
import fs from "node:fs";
import path from "node:path";
import {
  checkDescription,
  describeCheck,
  bandsFromStyle,
  MSR_EXPLORATION_PROVISIONAL,
} from "../lib/description-checks.mjs";

const args = { _: [] };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--verbose") args.verbose = true;
  else if (a.startsWith("--")) args[a.slice(2)] = process.argv[++i];
  else args._.push(a);
}
const file = args._[0];
if (!file || (args.bands === undefined && "bands" in args)) {
  console.error("usage: check-description <description.json> [--bands file.json|msr-provisional|none] [--json out.json] [--verbose]"); // prettier-ignore
  process.exit(2);
}
let desc;
try {
  desc = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (e) {
  console.error(`FAIL  ${file}: cannot read it as JSON (${e.message})`);
  process.exit(1);
}

let bands = null;
const choice = args.bands ?? (desc?.style?.kind === "rpg-exploration" ? "msr-provisional" : "none");
if (choice === "msr-provisional") bands = MSR_EXPLORATION_PROVISIONAL;
else if (choice !== "none") {
  try {
    bands = JSON.parse(fs.readFileSync(choice, "utf8"));
    if (!bands.metrics && bands.bands) bands = bandsFromStyle(bands);
  } catch (e) {
    console.error(`check-description: cannot read the bands ${choice} (${e.message})`);
    process.exit(2);
  }
}

const result = checkDescription(desc, bands);
const bandsName = bands ? (bands.name ?? path.basename(choice)) : null;
console.log(
  describeCheck(result, { name: desc?.name ?? path.basename(file), bandsName, verbose: args.verbose }),
);
if (args.json) {
  fs.writeFileSync(args.json, JSON.stringify({ file, bands: bandsName, ...result }, null, 1));
  console.log(`  detail: ${args.json}`);
}
process.exit(result.pass ? 0 : 1);
