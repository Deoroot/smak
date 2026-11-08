// The ground's heights working with everything a real city site uses (2026-11-07, byzantium-02 Phase 1 "heights"):
// levels/specs/heights-test.json, a low district (z 0) and a high one (z 128) joined by a ramp of 1:8 and a stair, each with
// an interior building, a shell, a portico and the dressing; two shells flank the ramp; the high one has a shaped plaza;
// S1 (floor -384) under both with a manhole on each street and a stair from the high district's cross street, 512 down.
// Planned with no failure; the below, the dressing and the RP contract stand at the ground of their cells; a flat site is
// as it was; with VHLT and the three wads, compiled with no leak and walked down to S1. The broken cases (a vault too close
// to the ground, a stair from the street at the wrong z, ...) are in test/broken/levels.mjs.
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { test, testAsync, sure, HERE } from "./helper.mjs";
import { planSite, assembleSite, siteSpec, checkSite, checkSpawns } from "../levels/assembly/site.mjs";
import { checkBelow } from "../levels/assembly/below.mjs";
import { groundTools } from "../levels/assembly/below-levels.mjs";
import { dressSite, loadDress } from "../levels/assembly/dress.mjs";
import { loadLibrary } from "../levels/assembly/library.mjs";
import { rpContract } from "../levels/rp/contract.mjs";
import { checkPaths } from "../levels/rp/paths.mjs";
import { writeMap, shapeOf } from "../src/maps/source.mjs";

const plan = planSite(siteSpec("heights-test"));
const library = loadLibrary(join(HERE, "../levels/assembly/pieces/mese"));
const built = assembleSite(plan, library, {});
const dressed = dressSite(plan, built, loadDress("h9-byzantium"));
const spec = plan.site;
const ground = plan.terrain.ground;
const brushes = [...built.map.brushes, ...built.map.entities.flatMap((e) => e.brushes ?? [])].map(shapeOf);
const originOf = (e) => String(e.origin).split(/[ ,]+/).map(Number);

test("assembly heights: heights-test planned with no failure: two districts, a ramp of 1:8, a stair, S1 under both with three ways down", () => {
  sure(!plan.failures.length, `the plan: ${plan.failures.join(" | ")}`);
  const m = plan.terrain.measures;
  sure(m.heights.includes(0) && m.heights.includes(128) && m.ramps.length === 1 && Math.abs(m.ramps[0].slope - 1 / 8) < 1e-9, JSON.stringify(m));
  sure(plan.below.deep && plan.below.ways.length === 3, `ways ${plan.below.ways.map((w) => w.kind)}`);
  const c = checkBelow(plan, undefined, built.report.spawns);
  sure(!c.failures.length && !c.warnings.length, `below: ${[...c.failures, ...c.warnings].join(" | ")}`);
  sure(!checkSite(plan).failures.length && !checkSpawns(plan, built.report.spawns).failures.length, "site and spawns");
  const stair = plan.below.deep.stairs[0];
  sure(stair.ground === 128 && stair.varied && stair.roof === 112, `the street stair: ground ${stair.ground}, roof ${stair.roof}`);
});

test("assembly heights: the assembled site has no failure; the ways down start at the ground of their cell", () => {
  sure(!built.report.failures.length, `assembled: ${built.report.failures.join(" | ")}`);
  const ways = built.report.below.ways;
  const lowTop = ways.find((w) => w.name === "low-manhole").top;
  const highTop = ways.find((w) => w.name === "high-manhole").top;
  sure(lowTop[2] === 0 && highTop[2] === 128, `manhole tops ${lowTop[2]} and ${highTop[2]}`);
  const stair = ways.find((w) => w.kind === "street-stair");
  sure(stair.top[2] === 128 && stair.foot[2] === -384, `the street stair ${stair.top} to ${stair.foot}`);
  // a lid on each street, at its ground
  const lids = built.map.entities.filter((e) => e.classname === "func_door" && (e.brushes ?? []).some((b) => shapeOf(b).min[2] >= -1 && shapeOf(b).min[2] <= 129));
  const lidAt = (cx, cy, z) => lids.some((e) => e.brushes.some((b) => { const s = shapeOf(b); return s.min[0] >= cx * 64 - 80 && s.max[0] <= (cx + 1) * 64 + 80 && s.min[1] >= cy * 64 && s.max[1] <= (cy + 1) * 64 && s.min[2] >= z - 16 && s.max[2] <= z + 16; })); // prettier-ignore
  sure(lidAt(12, 10, 0) && lidAt(51, 7, 128), "a lid on each street at its ground");
  // each ladder spans from S1's floor to its street: the high one is 512 long
  const ladders = built.map.entities.filter((e) => e.classname === "func_ladder").map((e) => e.brushes.map(shapeOf)).map((l) => [Math.min(...l.map((s) => s.min[2])), Math.max(...l.map((s) => s.max[2]))]);
  sure(ladders.some(([lo, hi]) => lo <= -384 && hi >= 128 + 16 && hi <= 128 + 32), `the high ladder: ${JSON.stringify(ladders)}`);
  sure(ladders.some(([lo, hi]) => lo <= -384 && hi >= 16 && hi <= 32), `the low ladder: ${JSON.stringify(ladders)}`);
});

test("assembly heights: the high chimney and the stair's trench stand on the high ground; the fill and the sky floor are cut under the stair, the paving its roof", () => {
  // no solid in the air of the covered trench (cells 51,52 x rows 11..19), over its steps and under the paving
  const at = (x, y, z) => brushes.filter((s) => x > s.min[0] && x < s.max[0] && y > s.min[1] && y < s.max[1] && z > s.min[2] && z < s.max[2]);
  for (const y of [14 * 64 + 32, 12 * 64 + 32]) {
    const step = 128 - ((1472 - y) * 512) / 768; // the steps' top at this y
    const hit = [at(3300, y, step + 48), at(3300, y, 40), at(3300, y, -24)].flat();
    sure(!hit.length, `solid in the trench at y ${y}: ${hit.map((s) => `${s.min}..${s.max}`).join(" | ")}`);
  }
  // the paving over it, 16 under 128 (its underside the roof)
  sure(at(3300, 14 * 64 + 32, 120).length > 0, "no paving over the covered trench");
  // its walls to the parapet over the open cells: 168 over the street at 128
  sure(brushes.some((s) => s.max[2] === 168 && s.min[0] >= 3264 - 20 && s.max[0] <= 3392 + 20 && s.min[1] >= 20 * 64 && s.max[1] <= 23 * 64), "the parapet round the open trench at z 168");
  // the sky box's floor is under the lowest of the ground (0 here), the high fill is under the high paving
  sure(built.report.floor === 0, `the floor ${built.report.floor}`);
  sure(brushes.some((s) => s.min[2] === -16 && s.max[2] === 112 && s.min[0] >= 40 * 64), "the fill under the high district: -16 to the paving's underside, 112");
});

test("assembly heights: shells, porticoes and the shaped plaza stand at their district's height", () => {
  const roofs = (id) => spec.buildings.find((b) => b.id === id);
  sure(roofs("high-shell").groundZ === 128 && roofs("low-shell").groundZ === 0 && roofs("ramp-s1").groundZ === 0 && roofs("high-bar").groundZ === 128, "buildings' ground");
  // a shell's mass starts 16 under its ground: the high one at 112, the low at -16
  sure(brushes.some((s) => s.min[2] === 112 && s.min[0] >= 54 * 64 && s.max[0] <= 63 * 64 + 16 && s.min[1] >= 13 * 64 - 16 && s.max[1] <= 20 * 64 + 16), "the high shell's mass from 112");
  sure(brushes.some((s) => s.min[2] === -16 && s.min[0] >= 14 * 64 - 16 && s.max[0] <= 23 * 64 + 16 && s.min[1] >= 13 * 64 - 16 && s.max[1] <= 20 * 64 + 16), "the low shell's mass from -16");
  // porticoes: the high one's roof piece over its cells at 128 and up
  const roof = brushes.filter((s) => s.min[0] >= 52 * 64 - 1 && s.max[0] <= 60 * 64 + 1 && s.min[1] >= 5 * 64 - 1 && s.max[1] <= 7 * 64 + 1);
  sure(roof.length && Math.min(...roof.map((s) => s.min[2])) >= 128 - 16 && Math.max(...roof.map((s) => s.max[2])) >= 128 + 176, `the high portico at z ${Math.min(...roof.map((s) => s.min[2]))}..${Math.max(...roof.map((s) => s.max[2]))}`);
  // the shaped plaza's floor, 16 under the high ground
  sure(brushes.some((s) => s.min[2] === 112 && s.max[2] === 128 && s.min[0] >= 2816 && s.max[0] <= 3200 && s.min[1] >= 64 && s.max[1] <= 448), "the octagon's floor at 112..128");
  const starts = built.map.entities.filter((e) => e.classname === "info_player_deathmatch").map((e) => originOf(e)[2]);
  sure(starts.includes(36) && starts.includes(164), `starts at the heights ${[...new Set(starts)]}`);
});

test("assembly heights: the dressing stands at the ground of its cell, and on a ramp at the slope's height", () => {
  sure(!dressed.report.failures.length, `dressing: ${dressed.report.failures.join(" | ")}`);
  const bad = [];
  let onRamp = 0;
  let high = 0;
  for (const e of dressed.entities) {
    if (!["ts_model", "env_glow", "ambient_generic", "light"].includes(e.classname)) continue;
    const [x, y, z] = originOf(e);
    const [cx, cy] = [Math.floor(x / 64), Math.floor(y / 64)];
    const label = plan.cells[cy]?.[cx];
    if (!label || label.startsWith("building ")) continue;
    const j = plan.terrain.joinCell.get(`${cx},${cy}`);
    if (label === "stair" && e.classname !== "ambient_generic") {
      bad.push(`${e.classname} on a stair at ${x},${y},${z}`);
      continue;
    }
    if (e.classname === "ts_model") {
      if (j?.join.kind === "ramp") {
        onRamp++;
        const [dx, dy] = j.dir;
        const u = dx > 0 ? x / 64 - cx : dx < 0 ? 1 - (x / 64 - cx) : dy > 0 ? y / 64 - cy : 1 - (y / 64 - cy);
        const floor = j.low + (j.high - j.low) * u;
        if (Math.abs(z - floor) > 26) bad.push(`a prop on the ramp at ${x},${y} is at z ${z}, the slope at ${floor.toFixed(0)}`);
      } else if (z - ground[cy][cx] < -2 || z - ground[cy][cx] > 24) bad.push(`a prop at ${x},${y},${z} on ground ${ground[cy][cx]}`);
      if (ground[cy][cx] === 128) high++;
    }
    if (e.classname === "env_glow" && z - ground[cy][cx] < 100) bad.push(`a glow at ${x},${y},${z} on ground ${ground[cy][cx]}`);
    if (e.classname === "ambient_generic" && Math.abs(z - (j?.low ?? ground[cy][cx]) - 96) > 2) bad.push(`a sound at ${x},${y},${z} on ground ${ground[cy][cx]}`);
  }
  sure(!bad.length, bad.slice(0, 5).join(" | "));
  sure(onRamp >= 1 && high >= 4, `props on the ramp ${onRamp}, props on the high ground ${high}`);
  // the rooms of a building on the high ground: their props 128 up (and the second storey 320)
  const inHigh = dressed.entities.filter((e) => e.classname === "ts_model").map(originOf).filter(([x, y]) => x > 40 * 64 && x < 49 * 64 && y > 13 * 64 && y < 20 * 64);
  sure(inHigh.length >= 4 && inHigh.every(([, , z]) => z >= 126), `the props in the high bar: ${inHigh.map((p) => p[2])}`);
});

test("assembly heights: the RP contract stands at the ground: places, roaming spots, nodes, the street stair and the lids", () => {
  const contract = rpContract(plan, built, {});
  const checked = checkPaths(contract.paths, contract);
  sure(!checked.failures.length, `paths: ${checked.failures.join(" | ")}`);
  const place = (id) => contract.places.find((p) => p.id === id);
  sure(place("high-bar_bar").at[2] === 128 && place("low-clinic_clinic").at[2] === 0 && place("below_low-cistern").at[2] === -384, JSON.stringify(contract.places.map((p) => [p.id, p.at[2]])));
  for (const r of contract.roam) {
    const [x, y, z] = r.at;
    const g = ground[Math.floor(y / 64)]?.[Math.floor(x / 64)];
    sure(r.district === "below" || g === undefined || Math.abs(z - g) <= 128, `a roaming spot ${r.at} on ground ${g}`);
  }
  const nodes = contract.paths.nodes;
  const hatch = nodes.filter((n) => n.kind === "hatch").map((n) => Math.round(n.at[2])).sort((a, b) => a - b);
  sure(hatch.length === 2 && hatch[0] < 60 && hatch[1] > 128 && hatch[1] < 200, `hatches ${hatch}`);
  const stairs = nodes.filter((n) => n.kind === "stair" && n.at[0] > 49 * 64 && n.at[0] < 54 * 64);
  sure(stairs.some((n) => n.at[2] < -300) && stairs.some((n) => n.at[2] > 100), `the street stair's nodes ${stairs.map((n) => Math.round(n.at[2]))}`);
  // a street spot is on its cell's ground
  for (const n of nodes.filter((q) => q.kind === "street")) {
    const [cx, cy] = [Math.floor(n.at[0] / 64), Math.floor(n.at[1] / 64)];
    const j = plan.terrain.joinCell.get(`${cx},${cy}`);
    const lo = j ? j.low : ground[cy][cx];
    const hi = j ? j.high : ground[cy][cx];
    sure(n.at[2] >= lo - 1 && n.at[2] <= hi + 1 + 64, `a street node ${n.at} on ground ${lo}..${hi}`);
  }
});

test("assembly heights: a flat site is as it was: the levels' ground tools say 0 and -32, below-levels-01 keeps its lids at 0", () => {
  const G = groundTools(null);
  sure(G.at(5, 5) === 0 && G.limit(0, 0, 100, 100) === -32 && !G.varied, "no terrain");
  const flat = planSite(siteSpec("below-levels-01"));
  sure(!flat.failures.length, flat.failures.join(" | "));
  const f = assembleSite(flat, library, {});
  sure(f.report.below.ways.every((w) => w.top[2] === 0) && !f.report.below.roofed.length, "flat ways at 0, nothing roofed");
  sure(JSON.stringify(f.report.below.ways) === JSON.stringify(assembleSite(planSite(siteSpec("below-levels-01")), library, {}).report.below.ways), "twice the same");
});

// ── with the compilers ──
const VHLT = process.env.VHLT_DIR;
const wads = [process.env.TS_WAD, process.env.HL_WAD, process.env.MESE_WAD];
if (!VHLT || wads.some((w) => !w || !existsSync(w)))
  console.log("skip  the heights site compiled and walked\n      skipped: it wants VHLT in VHLT_DIR and the three wads in TS_WAD, HL_WAD and MESE_WAD"); // prettier-ignore
else await testAsync("assembly heights: compiled with no leak; a player walks the ramp, the stair, the high district, S1 and the street stair down to it", "heights walked", async () => { // prettier-ignore
  const { compileMap } = await import("../src/maps/compile.mjs");
  const { readBsp } = await import("../src/maps/bsp.mjs");
  const { reachOf } = await import("../src/maps/reach.mjs");
  const work = mkdtempSync(join(tmpdir(), "smak-heights-"));
  const file = join(work, "smak_heights_test.map");
  const map = { ...built.map, brushes: [...built.map.brushes, ...dressed.brushes], entities: [...built.map.entities, ...dressed.entities] };
  writeFileSync(file, writeMap(map));
  const r = compileMap(file, { wads, wadinclude: library.wadinclude, fast: true, timeout: 900000, compilers: { folder: VHLT } });
  sure(r.bsp && !r.leak, `compile: ${r.errors.join(" | ")}${r.leak ? " LEAK" : ""}`);
  const reach = reachOf(readBsp(readFileSync(r.bsp)));
  const at = (cx, cy, under) => reach.walked(cx * 64 + 32, cy * 64 + 32, under);
  const near = (a, b, d = 8) => a !== null && Math.abs(a - b) <= d;
  sure(near(at(10, 9), 0) && near(at(45, 10), 128), `both districts walked: ${at(10, 9)}, ${at(45, 10)}`);
  sure(near(at(32, 10), 70, 10) && near(at(39, 10), 126, 10), `the ramp walked: ${at(32, 10)}, ${at(39, 10)}`);
  sure(near(at(30, 23), 48) && near(at(31, 23), 112) && near(at(35, 23), 128), `the stair walked: ${at(30, 23)}, ${at(31, 23)}, ${at(35, 23)}`);
  sure(near(at(10, 8, -300), -384) && near(at(51, 9, -300), -384) && near(at(30, 13, -300), -384) && near(at(37, 13, -300), -384), "S1: both halls and the tunnel under the ramp");
  sure(near(at(51, 22, 200), 112, 12) && near(at(51, 16, 130), 128), "the high street over the street stair");
  const steps = [at(51, 20, 200), at(51, 19, 0), at(51, 17, 0), at(51, 14, 0), at(51, 11, 0)];
  sure(steps.every((z, i) => z !== null && (i === 0 || z < steps[i - 1])) && near(steps.at(-1), -368, 16), `the street stair walked down: ${steps}`);
});
