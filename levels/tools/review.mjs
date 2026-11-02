#!/usr/bin/env node
// review: the R1 review stop of the map generator (PLAN.md Phase 3, "Review stops"), drawn from the artifacts a run
// wrote (levels/gen/ARTIFACTS.md), and the person's approval recorded against their hashes.
//
//   node levels/tools/review.mjs <artifact dir> --out <dir> [--scale 20]
//   node levels/tools/review.mjs --approve <review dir> --by <name> [--note "..."] [--artifacts <dir>]
//
// Drawing writes plan-<tile>-<L>.svg per layer, wiring-<tile>-<L>.svg per layer when 07 is there,
// section-<tile>-ns.svg / -ew.svg through the Nexus spine, building-<id>.svg per building of 05, and review.json
// (smak-review/1, stop R1): every picture's sha256, the artifacts' hashes, the numbered looks, `approval: null`.
// Approving records { by, at, note } in review.json only while every artifact still hashes as it did when the
// pictures were drawn (and the pictures are the ones recorded); otherwise it refuses, naming the changed artifact.
// A remark is not an edit: it becomes a change to the description or the rulebook, and the run is made again.
//
// Exit code 0 when written or approved, 1 when refused, 2 on wrong arguments.
import fs from "node:fs";
import { writeReview, approveReview } from "../lib/review-picture.mjs";

const args = { _: [] };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
  else args._.push(a);
}
const usage = [
  "usage: review <artifact dir> --out <dir> [--scale 20]",
  "       review --approve <review dir> --by <name> [--note \"...\"] [--artifacts <dir>]",
].join("\n");

if (args.approve !== undefined) {
  if (typeof args.approve !== "string" || typeof args.by !== "string") {
    console.error(usage);
    process.exit(2);
  }
  const res = approveReview(args.approve, { by: args.by, note: typeof args.note === "string" ? args.note : null, artifactDir: typeof args.artifacts === "string" ? args.artifacts : null }); // prettier-ignore
  if (!res.ok) {
    console.log(`REFUSED  ${res.reason}`);
    process.exit(1);
  }
  console.log(`APPROVED  R1 of tile ${res.record.tile.id} by ${res.record.approval.by} at ${res.record.approval.at}: ${res.record.pictures.length} pictures, ${Object.keys(res.record.artifacts.files).length} artifacts`); // prettier-ignore
  process.exit(0);
}

const dir = args._[0];
if (!dir || typeof args.out !== "string" || (args.scale !== undefined && !(Number(args.scale) > 0))) {
  console.error(usage);
  process.exit(2);
}
try {
  fs.mkdirSync(args.out, { recursive: true });
  const { record } = writeReview(dir, args.out, { scale: args.scale ? Number(args.scale) : 20 });
  console.log(`R1 review of tile ${record.tile.id}${record.tile.name ? ` (${record.tile.name})` : ""} from ${Object.keys(record.artifacts.files).join(", ")}`); // prettier-ignore
  for (const p of record.pictures) console.log(`  ${p.file}  ${p.sha256.slice(0, 16)}  ${p.bytes} bytes${p.looks?.length ? `, marks ${p.looks.join(",")}` : ""}${p.labelsLeftOff ? `, ${p.labelsLeftOff} labels left off` : ""}`); // prettier-ignore
  for (const lk of record.looks) console.log(`  look ${lk.n}  ${lk.kind}  ${lk.text}`);
  console.log(`  review.json in ${args.out}: approval null; approve with: node levels/tools/review.mjs --approve ${args.out} --by <name>`); // prettier-ignore
} catch (e) {
  console.error(`FAIL  ${dir}: ${e.message}`);
  process.exit(1);
}
