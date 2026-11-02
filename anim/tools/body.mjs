// Vermintide 2's third-person one-handed sword blows (anim/lib/vt2body.mjs) measured from the local cache, their bands
// written to anim/corpus/body-vt2.json (measures only), and a table of the medians by strength.
//
//   node anim/tools/body.mjs [--list]
//
// --list prints every clip's measures.
import { writeFileSync } from "node:fs";
import { vt2Body, bodyBands } from "../lib/vt2body.mjs";
import { CORPUS } from "../lib/bands.mjs";

const got = vt2Body({ log: (m) => console.error(m) });
if (!got.blows.length) process.exit(1);
const bands = bodyBands(got);
const rows = got.blows.map(({ hero, template, events, sub_action, strength, values }) => ({ hero, template, events, sub_action, strength, values }));
const path = `${CORPUS}body-vt2.json`;
writeFileSync(
  path,
  JSON.stringify(
    {
      reference: "vt2",
      game: "vt2",
      what: "third-person one-handed sword blows (the body other players see), once per hero and clip; lengths in forearms or body heights, angles in degrees, seconds as played",
      how: "anim/tools/body.mjs (anim/lib/vt2body.mjs) from anim/vt2/thirdperson.py's local cache",
      count: rows.length,
      ...bands,
      readyRows: got.ready,
      rows,
    },
    null,
    1,
  ),
);
if (process.argv.includes("--list"))
  for (const r of rows) console.log(`${r.hero.padEnd(15)} ${r.strength.padEnd(7)} ${r.events.join(",").padEnd(50)} ${JSON.stringify(r.values)}`);
const cols = Object.keys(bands.strengths);
console.log(`${rows.length} clips (${cols.map((s) => `${s} ${bands.strengths[s].n}`).join(", ")}); medians [q1, q3]:`);
const keys = [...new Set(cols.flatMap((s) => Object.keys(bands.strengths[s]).filter((k) => k !== "n")))];
const cell = (b) => (b ? `${b.median.toFixed(2)} [${b.q1.toFixed(2)},${b.q3.toFixed(2)}]` : "-").padStart(22);
console.log(`${"".padEnd(22)}${cols.map((c) => c.padStart(22)).join("")}`);
for (const k of keys) console.log(`${k.padEnd(22)}${cols.map((c) => cell(bands.strengths[c][k])).join("")}`);
console.log("ready pose:");
for (const [k, b] of Object.entries(bands.ready)) if (k !== "n") console.log(`  ${k.padEnd(20)}${cell(b)}`);
console.log(`wrote ${path}`);
