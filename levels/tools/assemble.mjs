#!/usr/bin/env node
// assemble: a building description (smak-building/1) made into a map of Half-Life that a person walks: laid out
// (levels/assembly/layout.mjs), assembled from the pieces (assemble.mjs, pieces/hl), checked before the compile,
// compiled with VHLT, walked twice on its walk map (the navmesh, navwalk.mjs; and SMAK's own walk, reachOf), each
// doorway traced by a standing player, its edges measured and its light read (views.mjs, light.mjs), and every view
// of it drawn.
//
//   node levels/tools/assemble.mjs <building.json> --out <folder> [--seed N] [--draft] [--name house]
//        [--wad <halflife.wad>] [--vhlt <folder>] [--pieces <folder>] [--texlight-scale 0.5] [--lamp-scale 0.5]
//
//   --draft   hlvis and hlrad at their fastest (no bounce): the light is not the map's; its band is not checked
//   --texlight-scale, --lamp-scale   the pieces' texture lights, and their lamps' light entities, times these
//             (assemble.mjs, TEXLIGHT_SCALE and LAMP_SCALE)
//   --wad     Half-Life's valve/halflife.wad (or HL_WAD); --vhlt the compilers' folder (or VHLT_DIR)
//
// Writes, in the folder: <name>.map, <name>.bsp, <name>-walk.map, <name>-walk.bsp, layout.json, storey-N.txt,
// report.json, and views/ (the cutaways, plans, heights, light maps and eye shots of the lit map; views/open/ the eye
// shots and cutaways of the walk map, its leaves drawn where they stand open). The checks, each a sentence when it
// fails: the layout and the assembly; the plan check (checkPlan, its errors); the compile with no leak and no error;
// THE WALK MAP: the same map with every door piece placed open (its leaf a world brush at its open position, no
// door entity: walkMapProblems), compiled with no light; on it, and only on it, the walks: the navmesh walk from
// the start reaches every room's middle, both sides of every door and of the entrance (48 from the wall), the
// stair's foot and its top, nothing taken away (doors "closed": there are none, the leaves are world); SMAK's walk
// (reachOf) agrees on each; every doorway passes a standing player (hull 1) straight through at its middle and at
// 12 to each side, and its piece's doorway is 48 wide with its leaf open (doorwayClearance). A leaf REMOVED is not
// a leaf open: the walk tests once passed an entrance of 36 that nobody could pass in the game. Then every storey's
// plan has no edge that is not as the layout says; no room's floor under the dark line (24), every room's mean light in LIGHT_BAND and
//   not under YARD_SHARE of the yard's; the counts within GoldSrc's limits.
// Ends with ONE line, PASS or FAIL. Exit code 0 on PASS, 1 on FAIL, 2 on wrong arguments.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readBuilding } from "../assembly/building.mjs";
import { layoutOf, layoutJson, cellsAcross } from "../assembly/layout.mjs";
import { layoutText } from "../assembly/layout-picture.mjs";
import { loadLibrary } from "../assembly/library.mjs";
import { assemble, radText, walkMapProblems, doorwayClearance } from "../assembly/assemble.mjs";
import { judgeSourceForm } from "../../src/maps/dressing.mjs";
import { allViews, eyeShots, storeyCutaways } from "../assembly/views.mjs";
import { navWalk, navAvailable } from "../assembly/navwalk.mjs";
import { writeMap } from "../../src/maps/source.mjs";
import { checkPlan, wadTextureNames, SOURCE_LIMITS } from "../../src/maps/plan.mjs";
import { compileMap } from "../../src/maps/compile.mjs";
import { readBsp, contentsAt, CONTENTS } from "../../src/maps/bsp.mjs";
import { checkBsp } from "../../src/maps/check.mjs";
import { reachOf } from "../../src/maps/reach.mjs";
import { lightReport, DARK_FLOOR } from "../../src/maps/light.mjs";
import { readWad } from "../../src/maps/wad.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** A room's mean floor light (0 to 255, as the compiler stored it) is wanted in this band. */
export const LIGHT_BAND = [48, 200];
/** ... and not under this share of the yard's mean (the sun's ground): a room may be darker than outside, not by much. */
export const YARD_SHARE = 0.3;
/** The walk's targets either side of a doorway: this far from the wall's line. */
const DOOR_TARGET = 48;
/** GoldSrc's entities a map may start with (the engine's default edicts, less room for the players and what spawns). */
const ENTITY_LIMIT = 600;
/** The navmesh walk's voxels: 2 units (navwalk's own 4 eats up to 4 of each side of a narrow passage). */
const NAV_AGENT = { cs: 2 };

const args = { _: [] };
const FLAGS = ["draft"];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) args._.push(a);
  else if (FLAGS.includes(a.slice(2))) args[a.slice(2)] = true;
  else args[a.slice(2)] = process.argv[++i];
}
const file = args._[0];
const seed = args.seed === undefined ? null : Number(args.seed);
if (!file || !args.out || (seed !== null && !Number.isInteger(seed))) {
  console.error("usage: assemble <building.json> --out <folder> [--seed N] [--draft] [--name house] [--wad halflife.wad] [--vhlt folder] [--pieces folder]"); // prettier-ignore
  process.exit(2);
}
const out = path.resolve(args.out);
const name = args.name ?? "house";
const wadFile = args.wad ?? process.env.HL_WAD ?? "C:/Juegos/Steam/steamapps/common/Half-Life/valve/halflife.wad";
const vhlt = args.vhlt ?? process.env.VHLT_DIR ?? "C:/Herramientas/vhlt";
const piecesFolder = path.resolve(args.pieces ?? path.join(HERE, "../assembly/pieces/hl"));
const failures = [];
const warns = [];
const report = { building: file, seed: null, draft: Boolean(args.draft), checks: {}, failures, warnings: warns };
const say = (line) => console.log(line);
const finish = () => {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const w of warns) say(`WARN: ${w}`);
  const what = `${report.building ? path.basename(report.building) : "building"} seed ${report.seed}`;
  if (failures.length) {
    say(`FAIL: ${what}: ${failures.length} checks failed: ${failures.join("; ")}`);
    process.exit(1);
  }
  say(`PASS: ${what}: ${report.summary}; look at ${path.join(out, "views")}`);
  process.exit(0);
};

// ── the layout ──
let desc;
try {
  desc = readBuilding(fs.readFileSync(file, "utf8"));
} catch (e) {
  failures.push(`${file} cannot be read as a building description (${e.message})`);
  finish();
}
const layout = layoutOf(desc, { seed });
report.seed = layout.seed;
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "layout.json"), layoutJson(layout));
for (const plan of layout.storeyPlans ?? []) fs.writeFileSync(path.join(out, `storey-${plan.storey}.txt`), layoutText(layout, plan.storey)); // prettier-ignore
for (const w of layout.warnings ?? []) warns.push(`layout: ${w}`);
if (layout.failures.length) {
  failures.push(...layout.failures.map((f) => `layout: ${f}`));
  finish();
}

// ── the assembly and the plan ──
const library = loadLibrary(piecesFolder);
const scales = {};
if (args["texlight-scale"] !== undefined) scales.texlightScale = Number(args["texlight-scale"]);
if (args["lamp-scale"] !== undefined) scales.lampScale = Number(args["lamp-scale"]);
const built = assemble(layout, library, scales);
report.assembly = { texlights: built.report.texlights, counts: built.report.counts, lamps: built.report.lamps, site: built.report.site, start: built.report.start, light: built.report.light }; // prettier-ignore
for (const w of built.report.warnings) warns.push(`assembly: ${w}`);
for (const w of judgeSourceForm(built.map)) warns.push(`assembly: ${w}`); // form: the world's faces off the axes and the detail's bare boxes, against Valve's
if (built.report.failures.length) {
  failures.push(...built.report.failures.map((f) => `assembly: ${f}`));
  finish();
}
const mapFile = path.join(out, `${name}.map`);
fs.writeFileSync(mapFile, writeMap(built.map));
if (!fs.existsSync(wadFile)) {
  failures.push(`there is no halflife.wad at ${wadFile}: give --wad or HL_WAD`);
  finish();
}
const wadBytes = fs.readFileSync(wadFile);
const plan = checkPlan(built.map, { textures: wadTextureNames(wadBytes) });
report.checks.plan = { errors: plan.errors, warnings: plan.warnings };
for (const w of plan.warnings) warns.push(`plan: ${w}`);
if (plan.errors.length) {
  failures.push(...plan.errors.map((e) => `plan: ${e}`));
  finish();
}
if (built.report.counts.brushes > SOURCE_LIMITS.brushes) failures.push(`the map has ${built.report.counts.brushes} brushes; the compilers hold ${SOURCE_LIMITS.brushes}`); // prettier-ignore

// ── the compile ──
// the pieces' texture lights (pieces/hl/lights.rad) as the assembler scales them, written beside the map for hlrad
const rad = path.join(out, "lights.rad");
fs.writeFileSync(rad, radText(built.report.texlights));
const hlrad = [...(args.draft ? [] : ["-extra", "-bounce", "8"]), "-lights", rad];
const compiled = compileMap(mapFile, { wads: [wadFile], compilers: { folder: vhlt }, fast: Boolean(args.draft), args: { hlrad } }); // prettier-ignore
report.checks.compile = {
  bsp: compiled.bsp,
  hlrad,
  seconds: Object.fromEntries(compiled.logs.map((l) => [l.tool, l.seconds])),
  errors: compiled.errors,
  warnings: compiled.warnings,
  facts: compiled.facts,
  leak: compiled.leak && { entity: compiled.leak.entity, at: compiled.leak.at },
};
for (const w of compiled.warnings) warns.push(`compile: ${w}`);
if (compiled.leak) failures.push(`the map leaks: ${compiled.errors.find((e) => /leak/i.test(e)) ?? `from ${compiled.leak.at}`}`);
else if (compiled.errors.length || !compiled.bsp) failures.push(...(compiled.errors.length ? compiled.errors : ["the compile left no .bsp"]).map((e) => `compile: ${e}`)); // prettier-ignore
if (!compiled.bsp) finish();
const total = Object.values(report.checks.compile.seconds).reduce((a, b) => a + b, 0);
say(`compiled ${compiled.bsp} in ${Math.round(total)} s (${compiled.logs.map((l) => `${l.tool} ${Math.round(l.seconds)}`).join(", ")}); hlrad ${hlrad.join(" ")}`); // prettier-ignore
const bytes = fs.readFileSync(compiled.bsp);
const bsp = readBsp(bytes);

// ── the counts ──
const counted = checkBsp(bytes, { engine: "goldsrc" });
report.checks.counts = { ...counted.counts, brushes: built.report.counts.brushes, errors: counted.errors, warnings: counted.warnings }; // prettier-ignore
for (const e of counted.errors) failures.push(`counts: ${e}`);
for (const w of counted.warnings) warns.push(`counts: ${w}`);
if (counted.counts.entities > ENTITY_LIMIT) failures.push(`the map starts with ${counted.counts.entities} entities; it wants ${ENTITY_LIMIT} at most, of GoldSrc's 900 edicts`); // prettier-ignore

// ── the walk map: every leaf a world brush where it stands open, compiled as a draft (its light is only for its views) ──
const walkBuilt = assemble(layout, library, { ...scales, open: true });
const walkProblems = [...walkBuilt.report.failures.map((f) => `walk map: ${f}`), ...walkMapProblems(walkBuilt)];
const walkFile = path.join(out, `${name}-walk.map`);
fs.writeFileSync(walkFile, writeMap(walkBuilt.map));
report.checks.walkMap = { map: walkFile, problems: walkProblems, leaves: walkBuilt.report.doorways.map((d) => ({ name: d.name, leaf: d.leaf })) }; // prettier-ignore
failures.push(...walkProblems);
const walkCompiled = compileMap(walkFile, { wads: [wadFile], compilers: { folder: vhlt }, fast: true, args: { hlrad: ["-lights", rad] } });
report.checks.walkMap.compile = { bsp: walkCompiled.bsp, errors: walkCompiled.errors, seconds: Object.fromEntries(walkCompiled.logs.map((l) => [l.tool, l.seconds])) }; // prettier-ignore
if (walkCompiled.leak || walkCompiled.errors.length || !walkCompiled.bsp) {
  failures.push(...(walkCompiled.errors.length ? walkCompiled.errors : ["the compile left no .bsp"]).map((e) => `walk map compile: ${e}`)); // prettier-ignore
  finish();
}
const walkBsp = readBsp(fs.readFileSync(walkCompiled.bsp));
// the leaves are there, solid, in the compiled walk map
for (const d of walkBuilt.report.doorways) {
  if (!d.leaf) continue;
  const mid = [0, 1, 2].map((k) => (d.leaf[0][k] + d.leaf[1][k]) / 2);
  if (contentsAt(walkBsp, mid) !== CONTENTS.SOLID) failures.push(`${d.name}: the compiled walk map is not solid in its open leaf's middle (${mid.join(" ")}); it wants the leaf there`); // prettier-ignore
}
say(`walk map: ${walkCompiled.bsp}, ${walkBuilt.report.doorways.filter((d) => d.leaf).length} leaves as world brushes where they stand open`); // prettier-ignore

// ── the walk: the targets ──
const g = layout.grid;
const H = layout.storeyHeight;
const [bx, by, bz] = layout.base;
const floorOf = (s) => bz + s * H;
const centre = ([i, j], s, up = 8) => [bx + (i + 0.5) * g, by + (j + 0.5) * g, floorOf(s) + up];
const targets = [];
for (const room of layout.rooms) {
  const cells = [];
  layout.storeyPlans[room.storey].cells.forEach((row, j) => row.forEach((v, i) => v === room.id && cells.push([i, j])));
  const mean = [0, 1].map((k) => cells.reduce((s, c) => s + c[k], 0) / cells.length);
  // not a cell where an open leaf stands: a standing player at its middle would be in the leaf (house-01 seed 2's bath)
  const leaves = walkBuilt.report.doorways.filter((d) => d.storey === room.storey && d.leaf).map((d) => d.leaf);
  const free = cells.filter(([i, j]) => {
    const [x, y] = centre([i, j], room.storey);
    return !leaves.some(([lo, hi]) => x + 16 > lo[0] && x - 16 < hi[0] && y + 16 > lo[1] && y - 16 < hi[1]);
  });
  const mid = (free.length ? free : cells).reduce((b, c) => (Math.hypot(c[0] - mean[0], c[1] - mean[1]) < Math.hypot(b[0] - mean[0], b[1] - mean[1]) - 1e-9 ? c : b)); // prettier-ignore
  targets.push({ name: `${room.id}'s middle`, at: centre(mid, room.storey) });
}
// both sides of every doorway, 48 from the wall's line on its middle
for (const d of walkBuilt.report.doorways) {
  const other = d.rooms.find((r) => r !== d.swing) ?? "outside";
  for (const [room, sign] of [[other, -1], [d.swing, 1]]) targets.push({ name: `${d.what} on ${room}'s side`, at: [d.middle[0] + d.into[0] * sign * DOOR_TARGET, d.middle[1] + d.into[1] * sign * DOOR_TARGET, d.floor + 8] }); // prettier-ignore
}
const well = layout.stairwell;
if (well) {
  targets.push({ name: "the stair's foot", at: centre(well.bottom, well.from) });
  targets.push({ name: "the stair's top", at: centre(well.top, well.to) });
}
const startAt = built.report.start.at;

// navmesh, on the walk map: nothing taken away (doors "closed": the leaves are world brushes, no door is left out)
if (!(await navAvailable())) failures.push("the navmesh walk needs the npm package recast-navigation (npm install in the kit's folder)");
else {
  // no CLIP brushes: their rebuild from hull 1 can keep a wall's growth over a doorway as a box 72 up (navwalk.mjs,
  // `clips`); this map's clips only smooth the stair and cap rails, which a navmesh walks without
  const nav = await navWalk(walkBsp, { from: [[startAt[0], startAt[1], startAt[2] + 36]], targets, doors: "closed", agent: NAV_AGENT, clips: false }); // prettier-ignore
  const missed = nav.targets.filter((t) => !t.reached);
  report.checks.navwalk = { map: "walk (leaves open, world)", ok: nav.ok, failures: nav.failures, reached: nav.targets.length - missed.length, of: nav.targets.length, targets: nav.targets.map((t) => ({ name: t.name, reached: t.reached, floor: t.floor, island: t.island })), seconds: nav.navmesh?.seconds }; // prettier-ignore
  if (missed.length) failures.push(`the navmesh walk (leaves open) from the start reaches ${nav.targets.length - missed.length} of ${nav.targets.length} targets; it wants all: not ${missed.map((t) => t.name).join(", ")}`); // prettier-ignore
  else if (!nav.ok) failures.push(`the navmesh walk: ${nav.failures[0]}`);
}
// SMAK's own walk, on the walk map
const reach = reachOf(walkBsp, { doors: "closed" });
const reachMissed = [];
for (const t of targets) {
  const z = reach.walked(t.at[0], t.at[1], t.at[2] + 40);
  if (z === null || Math.abs(z - (t.at[2] - 8)) > 18) reachMissed.push(`${t.name} (${z === null ? "no floor walked" : `walked at z ${Math.round(z)}`})`); // prettier-ignore
}
report.checks.reach = { map: "walk (leaves open, world)", share: reach.share, area: reach.area, missed: reachMissed };
if (reachMissed.length) failures.push(`SMAK's walk (reachOf, leaves open) does not agree: it reaches ${targets.length - reachMissed.length} of ${targets.length} targets; not ${reachMissed.join(", ")}`); // prettier-ignore

// each doorway's clear width, a standing player traced through it
const clearance = doorwayClearance(walkBsp, walkBuilt, library);
report.checks.doorways = clearance.doorways;
failures.push(...clearance.failures);
say(`doorways (clear as built, leaf open): ${clearance.doorways.map((d) => `${d.name} ${d.clear}`).join("; ")}`);

// ── the views, the edges as built ──
const views = path.join(out, "views");
fs.mkdirSync(views, { recursive: true });
const textures = readWad(wadBytes).textures;
const seen = allViews(bsp, { layout, out: views, textures });
// the walk map's own: its leaves drawn where they stand open (it has no light: drawn fully bright)
const openViews = path.join(views, "open");
fs.mkdirSync(openViews, { recursive: true });
const openFiles = [...storeyCutaways(walkBsp, { layout, out: openViews, textures, flat: true }), ...eyeShots(walkBsp, layout, { out: openViews, textures })].map((p) => p.facts.file).filter(Boolean); // prettier-ignore
report.checks.views = { files: [...seen.files, ...openFiles].map((f) => path.relative(out, f)), mismatches: seen.mismatches, dark: seen.dark };
if (seen.mismatches.length) failures.push(`${seen.mismatches.length} edges of the layout are not as built (views/plan-s*.png, red crosses); it wants 0: ${seen.mismatches.slice(0, 3).join("; ")}${seen.mismatches.length > 3 ? " ..." : ""}`); // prettier-ignore

// ── the light ──
if (!bsp.lumps.lighting.length) failures.push("the map has no light data; it wants hlrad's");
else {
  const boxes = {};
  for (const room of layout.rooms)
    layout.storeyPlans[room.storey].cells.forEach((row, j) => row.forEach((v, i) => {
      if (v === room.id) boxes[`${room.id}#${i},${j}`] = { min: [bx + i * g, by + j * g, floorOf(room.storey) - 2], max: [bx + (i + 1) * g, by + (j + 1) * g, floorOf(room.storey) + H - 64] }; // prettier-ignore
    }));
  const site = built.report.site;
  const [[fx0, fy0], [fx1, fy1]] = site.footprint;
  boxes["yard#s"] = { min: [site.min[0], site.min[1], bz - 2], max: [site.max[0], fy0 - 16, bz + 64] };
  boxes["yard#n"] = { min: [site.min[0], fy1 + 16, bz - 2], max: [site.max[0], site.max[1], bz + 64] };
  boxes["yard#w"] = { min: [site.min[0], fy0, bz - 2], max: [fx0 - 16, fy1, bz + 64] };
  boxes["yard#e"] = { min: [fx1 + 16, fy0, bz - 2], max: [site.max[0], fy1, bz + 64] };
  const told = lightReport(bsp, { rooms: boxes });
  const sums = new Map();
  for (const r of told.rooms) {
    const key = r.name.split("#")[0];
    if (key === "elsewhere" || r.mean === null || !r.area) continue;
    const s = sums.get(key) ?? sums.set(key, { area: 0, sum: 0, least: Infinity }).get(key);
    s.area += r.area;
    s.sum += r.mean * r.area;
    s.least = Math.min(s.least, r.least ?? r.mean);
  }
  const mean = (k) => (sums.get(k) ? Math.round((sums.get(k).sum / sums.get(k).area) * 10) / 10 : null);
  const yardMean = mean("yard");
  const rooms = layout.rooms.map((r) => ({ id: r.id, storey: r.storey, mean: mean(r.id), least: sums.get(r.id)?.least ?? null }));
  report.checks.light = { band: LIGHT_BAND, yardShare: YARD_SHARE, dark: DARK_FLOOR, yard: yardMean, rooms, darkInViews: seen.dark };
  for (const r of rooms) {
    if (r.mean === null) failures.push(`room ${r.id} (storey ${r.storey}) has no light samples on its floor`);
    else if (r.mean < DARK_FLOOR) failures.push(`room ${r.id} (storey ${r.storey}) has a dark floor: its mean light is ${r.mean}, under the dark line ${DARK_FLOOR}`); // prettier-ignore
    else if (!args.draft && (r.mean < LIGHT_BAND[0] || r.mean > LIGHT_BAND[1])) failures.push(`room ${r.id} (storey ${r.storey}) has a mean light of ${r.mean}; it wants ${LIGHT_BAND[0]} to ${LIGHT_BAND[1]}`); // prettier-ignore
    else if (!args.draft && yardMean && r.mean < yardMean * YARD_SHARE) failures.push(`room ${r.id} (storey ${r.storey}) has a mean light of ${r.mean}, under ${YARD_SHARE} of the yard's ${yardMean}; it wants ${Math.round(yardMean * YARD_SHARE)} at least`); // prettier-ignore
  }
  for (const d of seen.dark) if (!failures.some((f) => f.includes("dark floor"))) failures.push(`the light map says a room's floor is dark: ${d}`); // prettier-ignore
  say(`light: yard ${yardMean}; ${rooms.map((r) => `${r.id} ${r.mean}`).join(", ")}`);
}

const c = built.report.counts;
report.summary = `${c.brushes} brushes, ${c.entities} entities, ${report.checks.counts.faces} faces; ${Object.entries(c.kinds).map(([k, n]) => `${n} ${k}`).join(", ")}; no leak; ${targets.length} of ${targets.length} targets walked to with every leaf open (navmesh and reachOf); ${clearance.doorways.length} doorways passed by a standing player (clear ${Math.min(...clearance.doorways.map((d) => d.clear))} to ${Math.max(...clearance.doorways.map((d) => d.clear))}); 0 edges off the layout; every room lit (${report.checks.light?.rooms.map((r) => `${r.id} ${Math.round(r.mean)}`).join(", ")}, yard ${Math.round(report.checks.light?.yard ?? 0)}); compiled in ${Math.round(total)} s`; // prettier-ignore
finish();
