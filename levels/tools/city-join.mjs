#!/usr/bin/env node
// city-join: the city's one map from its tiles (PLAN.md, "Tiles": the city is one BSP2 map; the tiles are for
// building, checking and budgeting). Reads <tilesDir>/<tile>/<tile>.map with its 10-geometry.json (the rock's count)
// and 01-site.json (its seam portals) for each tile folder there, joins them (levels/experimental-city/city-join.mjs: one
// worldspawn, the seam caps between present tiles taken off, the outer border's kept, clashing names made unique,
// one light_environment), writes the joined .map and checks it: the counts against engine.limits and H9's
// max_edicts, the names and targets, checkPlan with its leak flood, every seam portal open, a finer flood on each
// seam. It does not compile.
//
//   node levels/tools/city-join.mjs <description.json> <tilesDir> --out <city.map> [--json <report.json>] [--no-seams]
//
// Exit code 0 when the checks pass, 1 when one fails (the map is written either way), 2 on wrong arguments.
import fs from "node:fs";
import path from "node:path";
import { readMap, writeMap } from "../../src/maps/source.mjs";
import { joinTiles, cityChecks } from "../experimental-city/city-join.mjs";

const args = process.argv.slice(2);
const opt = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const [descFile, dir] = args.filter((a, i) => !a.startsWith("--") && !["--out", "--json"].includes(args[i - 1]));
const out = opt("--out");
if (!descFile || !dir || !out || !fs.existsSync(descFile) || !fs.existsSync(dir)) {
  console.error("usage: city-join <description.json> <tilesDir> --out <city.map> [--json <report.json>] [--no-seams]");
  process.exit(2);
}
const desc = JSON.parse(fs.readFileSync(descFile, "utf8"));
const tiles = [];
const portals = new Map();
const hallZ = new Map();
const portalZ = new Map();
const zMismatch = [];
for (const id of fs.readdirSync(dir).filter((t) => /^c\d+_r\d+$/.test(t)).sort()) {
  const f = path.join(dir, id, `${id}.map`);
  const g = path.join(dir, id, "10-geometry.json");
  if (!fs.existsSync(f) || !fs.existsSync(g)) continue;
  const geo = JSON.parse(fs.readFileSync(g, "utf8"));
  tiles.push({ id, map: readMap(fs.readFileSync(f, "utf8")), rock: geo.counts?.rock, box: geo.seams?.box });
  const s = path.join(dir, id, "01-site.json");
  if (fs.existsSync(s)) for (const p of JSON.parse(fs.readFileSync(s, "utf8")).portals ?? []) if (!portals.has(p.id)) portals.set(p.id, p);
  // a portal 01 gives no height (an MSR passage): its hallway's floor in 04, where the hallway leaves the tile
  const n = path.join(dir, id, "04-network.json");
  if (fs.existsSync(n)) {
    const net = JSON.parse(fs.readFileSync(n, "utf8"));
    for (const h of net.hallways ?? []) if (h.seam && h.z) hallZ.set(h.id, { z: h.z[0], width: h.width }); // prettier-ignore
    // a connector's or secret passage's portal: the floor its seam chain has there (04's seams), alike in both tiles
    for (const c of [...(net.connectors ?? []), ...(net.passages ?? [])])
      for (const sm of c.seams ?? []) {
        const had = portalZ.get(sm.portal);
        if (had && Math.abs(had.z - sm.z[0]) > 1e-3) zMismatch.push(`portal ${sm.portal}: ${had.tile} gives it a floor at ${had.z}, ${id} at ${sm.z[0]}`); // prettier-ignore
        if (!had) portalZ.set(sm.portal, { z: sm.z[0], width: sm.width, tile: id });
      }
  }
}
for (const [k, p] of portals) if ((p.z === null || p.z === undefined) && hallZ.has(p.of)) portals.set(k, { ...p, ...hallZ.get(p.of) });
for (const [k, p] of portals) if ((p.z === null || p.z === undefined) && portalZ.has(k)) portals.set(k, { ...p, z: portalZ.get(k).z, width: portalZ.get(k).width }); // prettier-ignore
if (!tiles.length) {
  console.error(`city-join: no <tile>/<tile>.map with its 10-geometry.json under ${dir}`);
  process.exit(2);
}
const ids = new Set(tiles.map((t) => t.id));
// only the portals between two tiles that are here
const seamPortals = [...portals.values()].filter((p) => p.seam.split("|").every((t) => ids.has(t)));
const { map, report, origin } = joinTiles(desc, tiles);
const text = writeMap(map);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, text);
const checks = cityChecks(map, desc, tiles, seamPortals, { rock: report.rock, origin, shared: report.shared, seams: !args.includes("--no-seams") });
// the two sides of a connector's or passage's portal at two heights: a step at the seam the line check may miss
for (const m of zMismatch) checks.failures.push(`${m} (the two sides must meet at one height)`);
const C = checks.counts;
const lim = desc.engine?.limits ?? {};
const of = (k) => lim[k]?.value ?? "-";
console.log(`${checks.failures.length ? "FAIL" : "PASS"}  ${desc.name ?? "city"}: ${tiles.map((t) => t.id).join(", ")} -> ${out} (${(Buffer.byteLength(text) / 1048576).toFixed(1)} MB)`); // prettier-ignore
console.log(`  brushes ${C.brushes} of ${of("brushes")} (world ${C.world} of ${of("structural")}, rock ${report.rock} of ${of("rock")}, detail ${C.detail}, in brush entities ${C.entityBrushes})`); // prettier-ignore
console.log(`  brush models ${C.brushModels} of ${of("brushModels")}; entities ${C.entities}, staying ${C.staying} of ${of("entities")}; edicts ${C.edicts} of 4098`); // prettier-ignore
const caps = Object.values(report.caps).reduce((s, c) => ({ cut: s.cut + c.cut, dropped: s.dropped + c.dropped, beyond: s.beyond + c.keptBeyond }), { cut: 0, dropped: 0, beyond: 0 }); // prettier-ignore
console.log(`  seams: ${caps.cut} rock brushes cut on a seam line, ${caps.dropped} cap pieces taken off, ${caps.beyond} pieces kept past their tile (the outer border, under a shallower neighbour)`); // prettier-ignore
const open = checks.portals.filter((p) => p.open).length;
console.log(`  portals: ${open} of ${checks.portals.filter((p) => p.open !== null).length} with a height open across their seam (${checks.portals.filter((p) => p.open === null).length} with none, not checked)${checks.portals.some((p) => p.open && !p.all) ? ` (${checks.portals.filter((p) => p.open && !p.all).length} partly shut across their width)` : ""}`); // prettier-ignore
console.log(`  leak: checkPlan ${checks.check.leak ? `OPEN near ${checks.check.leak.at.map(Math.round).join(" ")}` : "none found"}; seams ${checks.seams.filter((s) => !s.leak).length} of ${checks.seams.length} closed (cells ${[...new Set(checks.seams.map((s) => s.cell))].join(", ")})`); // prettier-ignore
console.log(`  worldspawn: wad ${map.worldspawn.wad.join(";")}; sky ${map.worldspawn.skyname}; light_environment ${report.lightEnvironment ?? "none"}`); // prettier-ignore
for (const c of report.conflicts) console.log(`  conflict  ${c}`);
for (const r of report.renames) console.log(`  renamed  ${r.tile}: ${r.from} -> ${r.to}`);
for (const s of report.shared) console.log(`  shared  ${s.name} (${s.tiles.length} tiles): ${s.why}`);
for (const n of report.notes) console.log(`  note  ${n}`);
for (const f of checks.failures) console.log(`  FAIL  ${f}`);
if (args.includes("--verbose")) for (const n of checks.notes) console.log(`  note  ${n}`);
const jsonOut = opt("--json");
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ report, counts: C, failures: checks.failures, notes: checks.notes, portals: checks.portals, seams: checks.seams, leak: checks.check.leak }, null, 2) + "\n"); // prettier-ignore
process.exit(checks.failures.length ? 1 : 0);
