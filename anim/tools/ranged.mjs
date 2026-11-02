// The hands on ranged weapons (anim/lib/ranged.mjs): Vermintide 2's shots and reloads measured from the local
// cache, their bands written to anim/corpus/ranged-vt2.json (measures only), and a table of the medians by kind
// (shot, reload) and weapon (guns, crossbows, bows, pistols, staves, thrown).
//
//   node anim/tools/ranged.mjs [--list]
//
// --list prints every clip's measures.
import { writeFileSync } from "node:fs";
import { measureRanged, vt2Shots, rangedBands, OFF, KICK } from "../lib/ranged.mjs";
import { CORPUS } from "../lib/bands.mjs";

const rows = [];
for (const s of vt2Shots({ log: (m) => console.error(m) })) {
  const m = measureRanged(s.model, s.opts);
  rows.push({ template: s.template, event: s.event, kind: s.kind, class: s.class, values: m.values });
  if (process.argv.includes("--list"))
    console.log(
      `${s.kind.padEnd(6)} ${s.class.padEnd(9)} ${s.template.slice(0, 34).padEnd(34)} ${s.event.slice(0, 28).padEnd(28)} ${Object.entries(
        m.values,
      )
        .map(([k, v]) => `${k.split(".")[1]} ${v}`)
        .join("  ")}`,
    );
}
const bands = rangedBands(rows);
const path = `${CORPUS}ranged-vt2.json`;
writeFileSync(
  path,
  JSON.stringify({ reference: "vt2", game: "vt2", off: OFF, kick: KICK, ...bands }, null, 1),
);

const keys = [
  "offhand.gap",
  "offhand.gapMost",
  "offhand.away",
  "offhand.leave",
  "offhand.back",
  "kick.back",
  "kick.turn",
  "kick.settle",
  "parts.moving",
];
const fmt = (b) => (b ? `${b.median.toFixed(2)}`.padStart(6) : "     -");
console.log(
  `${rows.length} ranged clips: ${Object.entries(bands.kinds)
    .map(([k, x]) => `${x.n} ${k}s`)
    .join(", ")}; medians (lengths in forearms, times in seconds, turns in degrees):`,
);
console.log(`${"".padEnd(18)}${keys.map((k) => k.split(".")[1].slice(0, 7).padStart(8)).join("")}`);
for (const [kind, x] of Object.entries(bands.kinds)) {
  console.log(`${`${kind} (${x.n})`.padEnd(18)}${keys.map((k) => fmt(x.all[k]).padStart(8)).join("")}`);
  for (const [c, b] of Object.entries(x.classes))
    console.log(`${`  ${c} (${b.n})`.padEnd(18)}${keys.map((k) => fmt(b[k]).padStart(8)).join("")}`);
}
console.log(`wrote ${path}`);
