// How charged attacks are played (anim/lib/charge.mjs): Vermintide 2's charges measured from the local cache, their
// bands written to anim/corpus/charge-vt2.json (measures only), and a table of the medians overall, by place (the
// first press, a charge that follows a blow) and by family.
//
//   node anim/tools/charge.mjs [--list]
//
// --list prints every charge's measures.
import { writeFileSync } from "node:fs";
import { measureCharge, vt2Charges, chargeBands, TAP } from "../lib/charge.mjs";
import { CORPUS } from "../lib/bands.mjs";

const rows = [];
for (const c of vt2Charges({ log: (m) => console.error(m) })) {
  const m = measureCharge(c.model, c.opts);
  rows.push({ template: c.template, event: c.event, family: c.family, place: c.place, values: m.values });
  if (process.argv.includes("--list"))
    console.log(
      `${c.place.padEnd(8)} ${c.family.padEnd(10)} ${c.template.slice(0, 34).padEnd(34)} ${c.event.slice(0, 34).padEnd(34)} ${Object.entries(m.values)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => `${k.split(".")[1]} ${v}`)
        .join("  ")}`,
    );
}
const bands = chargeBands(rows);
const path = `${CORPUS}charge-vt2.json`;
writeFileSync(path, JSON.stringify({ reference: "vt2", game: "vt2", tap: TAP, count: rows.length, ...bands }, null, 1));

const keys = Object.keys(bands.overall).filter((k) => k !== "n");
const fmt = (b) => (b ? b.median.toFixed(2) : "-").padStart(8);
const head = (k) => k.split(".")[1].replace(/^(light|heavy)/, (x) => x[0]).slice(0, 7).padStart(8);
console.log(`${rows.length} charges; medians (seconds, lengths in forearms; a click holds ${TAP} s):`);
console.log(`${"".padEnd(18)}${keys.map(head).join("")}`);
const line = (name, b) => console.log(`${`${name} (${b.n})`.padEnd(18)}${keys.map((k) => fmt(b[k])).join("")}`);
line("all", bands.overall);
for (const [p, b] of Object.entries(bands.places)) line(p, b);
for (const [f, b] of Object.entries(bands.families)) line(f, b);
console.log(`wrote ${path}`);
