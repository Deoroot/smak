#!/usr/bin/env node
// geometry-review: the R2 review's pictures of a generator run's stage 10 (PLAN.md Phase 3, "Review stops"): plans
// per layer cut from the tile's .map, sections of the tile, of every street along its centre line and of every
// building through its middle, as PNG files. levels/gen/geometry-pictures.mjs draws them.
//
//   node levels/tools/geometry-review.mjs <out> [--png <dir>]
//
// <out> the generator's folder (01-site.json, 05-plans.json, 10-geometry.json and the tile's .map); --png where the
// pictures go (default <out>/r2). Refuses a 10-geometry.json whose .map changed after it was made.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readMap } from "../../src/maps/source.mjs";
import { png } from "../../src/image.mjs";
import { reviewPictures } from "../gen/geometry-pictures.mjs";

const args = process.argv.slice(2);
const out = args[0];
const dir = args.includes("--png") ? args[args.indexOf("--png") + 1] : out && join(out, "r2");
if (!out || !existsSync(join(out, "10-geometry.json"))) {
  console.error("usage: geometry-review <out> [--png <dir>]   (<out> holds 10-geometry.json)");
  process.exit(2);
}
const read = (f) => JSON.parse(readFileSync(join(out, f), "utf8"));
const geo = read("10-geometry.json");
const file = geo.files?.[0];
const text = readFileSync(join(out, file.file), "utf8");
const hash = createHash("sha256").update(text).digest("hex");
if (hash !== file.sha256) {
  console.error(`REFUSED  ${file.file} changed after 10-geometry.json was made (sha256 ${file.sha256.slice(0, 12)}, now ${hash.slice(0, 12)})`);
  process.exit(1);
}
const pics = reviewPictures(readMap(text), { site: read("01-site.json"), plans: read("05-plans.json"), origin: geo.units.origin });
mkdirSync(dir, { recursive: true });
for (const p of pics) {
  writeFileSync(join(dir, `${p.name}.png`), png(p.width, p.height, p.rgba));
  console.log(`${p.name}.png  ${p.width} x ${p.height}  ${p.title}`);
}
console.log(`${pics.length} pictures in ${dir}`);
