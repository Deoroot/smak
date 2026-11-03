#!/usr/bin/env node
// layout: lays a building description (smak-building/1, levels/assembly/README.md) out on the grid and writes the
// layout with a picture of each storey. Answers PASS in one line, or FAIL with the reasons.
//
//   node levels/tools/layout.mjs <description.json> --out <folder> [--seed N]
//
// Writes, in the folder: layout.json (smak-layout/1), storey-N.txt (the character map) and storey-N.png (the plan)
// for each storey. Exit code 0 on PASS, 1 on FAIL, 2 on wrong arguments.
import fs from "node:fs";
import path from "node:path";
import { layoutOf, layoutJson } from "../assembly/layout.mjs";
import { layoutText, layoutPng } from "../assembly/layout-picture.mjs";

const args = { _: [] };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) args[a.slice(2)] = process.argv[++i];
  else args._.push(a);
}
const file = args._[0];
const seed = args.seed === undefined ? null : Number(args.seed);
if (!file || !args.out || (seed !== null && !Number.isInteger(seed))) {
  console.error("usage: layout <description.json> --out <folder> [--seed N]");
  process.exit(2);
}
let desc;
try {
  desc = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (e) {
  console.log(`FAIL: ${file}: cannot read it as JSON (${e.message})`);
  process.exit(1);
}

const layout = layoutOf(desc, { seed });
fs.mkdirSync(args.out, { recursive: true });
const written = [path.join(args.out, "layout.json")];
fs.writeFileSync(written[0], layoutJson(layout));
for (const plan of layout.storeyPlans) {
  const txt = path.join(args.out, `storey-${plan.storey}.txt`);
  const pic = path.join(args.out, `storey-${plan.storey}.png`);
  fs.writeFileSync(txt, layoutText(layout, plan.storey));
  layoutPng(layout, plan.storey, pic);
  written.push(txt, pic);
  console.log(layoutText(layout, plan.storey));
}
for (const w of layout.warnings) console.log(`WARN: ${w}`);
console.log(`wrote ${written.join(", ")}`);
const what = `${layout.building} seed ${layout.seed}`;
if (layout.failures.length) {
  console.log(`FAIL: ${what}: ${layout.failures.join("; ")}`);
  process.exit(1);
}
const rooms = layout.rooms.map((r) => `${r.id} ${r.cells}`).join(", ");
const warned = layout.warnings.length ? `, ${layout.warnings.length} warnings` : "";
console.log(`PASS: ${what} laid out on ${layout.size.join(" x ")} cells, ${layout.storeys} storeys (${rooms}), ${layout.doors.length} doors${warned}; look at storey-N.png`); // prettier-ignore
