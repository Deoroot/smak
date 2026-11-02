#!/usr/bin/env node
// plan-picture: the R1 review pictures of a description (PLAN.md Phase 3, "Review stops"): top-down plans drawn
// before any geometry, as SVG. A city description (smak-city-description/1) gives overview.svg, layer-<L>.svg per
// layer and tile-<tile>-<L>.svg per tile and layer (full labels); a level description (smak-level-description/1)
// gives overview.svg and storey-<n>.svg per storey (m1 for -1). Beside them review.json lists each picture with its
// sha256 and the description's hash: the record an approval references, so a changed description asks again.
//
//   node levels/tools/plan-picture.mjs <description.json> --out <dir> [--layer L2] [--tile c1_r1]
//
//   --layer   one layer only (a city's layer id, a level's storey number: 0, -1 or m1)
//   --tile    one tile of a city only (its tile pictures; the layer-wide pictures and the overview are left out)
//
// A description that does not validate is refused with the validator's sentence. Exit code 0 when written, 1 when
// refused, 2 on wrong arguments.
import fs from "node:fs";
import path from "node:path";
import { planPictures, reviewRecord, sha256 } from "../lib/plan-picture.mjs";

const args = { _: [] };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) args[a.slice(2)] = process.argv[++i];
  else args._.push(a);
}
const file = args._[0];
const usage = "usage: plan-picture <description.json> --out <dir> [--layer L2] [--tile c1_r1]";
if (!file || !args.out || ["layer", "tile"].some((k) => k in args && !args[k])) {
  console.error(usage);
  process.exit(2);
}
let bytes;
let desc;
try {
  bytes = fs.readFileSync(file);
  desc = JSON.parse(bytes.toString("utf8"));
} catch (e) {
  console.error(`FAIL  ${file}: cannot read it as JSON (${e.message})`);
  process.exit(1);
}
let result;
try {
  result = planPictures(desc, { layer: args.layer ?? null, tile: args.tile ?? null });
} catch (e) {
  console.error(`FAIL  ${file}: ${e.message}`);
  process.exit(1);
}
fs.mkdirSync(args.out, { recursive: true });
for (const p of result.pictures) fs.writeFileSync(path.join(args.out, p.file), p.svg);
const record = reviewRecord(result, { file: path.basename(file), fileSha256: sha256(bytes) });
fs.writeFileSync(path.join(args.out, "review.json"), JSON.stringify(record, null, 1) + "\n");
console.log(`${result.title} (${result.name}), description sha256 ${result.hash}`);
for (const p of record.pictures) console.log(`  ${p.file}  ${p.sha256.slice(0, 16)}  ${p.bytes} bytes${p.labelsLeftOff ? `, ${p.labelsLeftOff} labels left off at this zoom` : ""}`); // prettier-ignore
console.log(`  review.json: ${record.pictures.length} pictures in ${args.out}`);
