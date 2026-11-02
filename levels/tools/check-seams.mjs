#!/usr/bin/env node
// check-seams: the deck frame's rhythm across the tiles' seams, checked once a way over every tile's stage 9
// (levels/gen/forms-deck.mjs seamRhythm; the rulebook's forms.pier note). Reads <dir>/<tile>/09-forms.json for each
// tile folder there (the generator's --out of each tile), stitches each way's piers from every tile and answers PASS,
// or FAIL with the sentences: a station given by two tiles, a pier off its place in the rhythm past
// forms.pier.slide.max, tiles on different rhythms, a gap across a seam past forms.pier.maxPitchPastObstacle.
//
//   node levels/tools/check-seams.mjs <dir> [--verbose]
//
// Exit code 0 on PASS, 1 on FAIL, 2 on wrong arguments.
import fs from "node:fs";
import path from "node:path";
import { seamRhythm } from "../gen/forms-deck.mjs";
import { formRules } from "../gen/forms.mjs";
import { RULES_PATH } from "../lib/architecture-rules.mjs";

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error("usage: check-seams <dir of tile folders with 09-forms.json> [--verbose]");
  process.exit(2);
}
const tiles = [];
for (const t of fs.readdirSync(dir).sort()) {
  const f = path.join(dir, t, "09-forms.json");
  if (!fs.existsSync(f)) continue;
  const art = JSON.parse(fs.readFileSync(f, "utf8"));
  tiles.push({ tile: art.tile?.id ?? art.tile ?? t, forms: art.forms ?? [], R: art.rules?.forms ?? null });
}
if (!tiles.length) {
  console.error(`check-seams: no <tile>/09-forms.json under ${dir}`);
  process.exit(2);
}
// the rules in cells as stage 9 wrote them (every tile the same rulebook), else the rulebook's own
const R = tiles.find((t) => t.R?.pier?.slide)?.R ?? formRules(JSON.parse(fs.readFileSync(RULES_PATH, "utf8")).forms, 3.2512);
const v = seamRhythm(tiles, R);
console.log(`${v.failures.length ? "FAIL" : "PASS"}  seams: ${tiles.map((t) => t.tile).join(", ")}`);
for (const f of v.failures) console.log(`  FAIL  ${f}`);
if (process.argv.includes("--verbose") || v.failures.length) for (const n of v.notes) console.log(`  note  ${n}`);
process.exit(v.failures.length ? 1 : 0);
