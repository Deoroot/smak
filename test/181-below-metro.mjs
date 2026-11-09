// levels/assembly/metro.mjs, a kind of level below the street (levels/specs/metro-test.json): mese-01's street over one metro level at
// -384. A wide entrance (a stair of 160, three cells across, an arch over its head) down to a concourse; two passages onto the first
// station's platforms (a trench of 192 and 40 deep between two platforms of 176, a strip of yellow and black along each edge, rails on
// sleepers, square columns, benches, a crossing, steps up out of the trench at each end); a line (the trench between two walkways with a
// railing, under a pitched roof) to the second station; a back passage from the concourse round to the second station.
// Planned: every rule of METRO held (checkMetro says nothing). Assembled: the platforms at the level's floor, the trench 40 under it, the
// rails, strips, steps, arch and lamps where the plan says, the light cream on the platforms and warm on the walls, none of it pink. The
// RP contract: nodes on the platforms, the crossings, the concourse and the passages; none in the line; npc-sim holds it. With VHLT and the
// three wads the map is compiled with no leak and walked: from the street down the entrance to the concourse, onto a platform, across the
// crossing, down into the trench and along the line, and out of it by the steps. The broken cases are in test/broken/levels.mjs.
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { test, testAsync, sure, HERE } from "./helper.mjs";
import { planSite, assembleSite, siteSpec } from "../levels/assembly/site.mjs";
import { checkBelow } from "../levels/assembly/below.mjs";
import { loadLibrary } from "../levels/assembly/library.mjs";
import { METRO, METRO_TEX, METRO_LOOKS, EDGE, columnsOf, benchesOf, checkMetro } from "../levels/assembly/metro.mjs";
import { rpContract } from "../levels/rp/contract.mjs";
import { checkPaths } from "../levels/rp/paths.mjs";
import { walkModel } from "../levels/rp/deep.mjs";
import { analyse } from "../levels/rp/npc-sim.mjs";
import { writeMap, shapeOf } from "../src/maps/source.mjs";
import { signsWad } from "../levels/art/h9-metro-signs.mjs";
import { STATION_NAMES, SIGN_FALLBACK } from "../levels/assembly/metro.mjs";

const plan = planSite(siteSpec("metro-test"));
const library = loadLibrary(join(HERE, "../levels/assembly/pieces/mese"));
const deep = plan.below.deep;
const F = -384;
const hall = (id) => deep.halls.find((h) => h.id === id);
const chain = (id) => deep.chains.find((c) => c.id === id);

test("metro: metro-test plans with no failure; checkMetro and checkBelow say nothing; two stations, a concourse, a line, an entrance", () => {
  sure(!plan.failures.length, `plan: ${plan.failures.join(" | ")}`);
  const c = checkBelow(plan, undefined, []);
  sure(!c.failures.length && !c.warnings.length, `below: ${[...c.failures, ...c.warnings].join(" | ")}`);
  const m = checkMetro(deep, plan.site.below.rules);
  sure(!m.failures.length && !m.warnings.length, `checkMetro: ${[...m.failures, ...m.warnings].join(" | ")}`);
  sure(JSON.stringify(m.measures) === JSON.stringify({ stations: 2, concourses: 1, lines: 1, entrances: 1, crossings: 2 }), JSON.stringify(m.measures));
  const e = deep.stairs[0];
  sure(e.width === 160 && e.hole.length === 9 && new Set(e.hole.map((h) => h[1])).size === 3, `the entrance: ${e.width} wide, ${e.hole.length} cells open`);
});

test("metro: a station is a hall of 256 with platforms of 176 either side of a trench of 192 and 40; the line is the trench's width and depth", () => {
  for (const id of ["st-a", "st-b"]) {
    const h = hall(id);
    const T = h.trench;
    sure(h.height >= METRO.ceiling && T.width === 192 && T.depth === 40 && T.axis === 0, `${id}: ${h.height} high, trench ${T.width} x ${T.depth}`);
    sure(T.sides.every(([a, b]) => b - a === 176), `${id}: platforms ${T.sides.map(([a, b]) => b - a)}`);
    sure(T.crossings.length === 1 && T.crossings[0][1] - T.crossings[0][0] === 96, `${id}: crossings ${JSON.stringify(T.crossings)}`);
  }
  const line = chain("line-ab");
  sure(line.width === hall("st-a").trench.width && line.trench.depth === hall("st-a").trench.depth, "the line is one trench with the stations'");
  sure(line.ends.every((e) => e && e.hall.trench), "the line runs from station to station");
});

const built = assembleSite(plan, library, {});
const brushes = [...built.map.brushes, ...built.map.entities.flatMap((e) => e.brushes ?? [])];
const shapes = brushes.map((b) => ({ s: shapeOf(b), tex: new Set(b.faces.map((f) => f.texture)) }));
const near = (a, b, d = 0.5) => Math.abs(a - b) <= d;
const inX = (s, x0, x1) => s.min[0] >= x0 - 0.5 && s.max[0] <= x1 + 0.5;

test("metro: assembled with no failure; the platforms stand at the floor, the trench bed 40 under it, the rails, strips and steps as planned", () => {
  sure(!built.report.failures.length, `assembled: ${built.report.failures.join(" | ")}`);
  const c = built.report.below.counts;
  for (const k of ["platform", "platform-strip", "platform-edge", "trench-bed", "trench-step", "crossing", "rail", "sleeper", "bench", "column", "beam", "railing", "railing-post", "walkway-end", "arch-pillar", "arch-lintel", "arch-sign", "wainscot"]) sure(c[k] > 0, `no ${k}`); // prettier-ignore
  sure(c["trench-bed"] === 2 && c["trench-step"] === 24 && c.crossing === 2 && c["arch-pillar"] === 2 && c["arch-lintel"] === 1, JSON.stringify(c));
  // st-a: x 1184..1760, y 592..1136, its trench y 768..960
  const bed = shapes.filter(({ s, tex }) => tex.has(METRO_TEX.bed) && inX(s, 1184, 1760) && near(s.max[2], F - 40));
  sure(bed.length === 1 && near(bed[0].s.min[1], 768) && near(bed[0].s.max[1], 960), `the bed ${JSON.stringify(bed.map((b) => [b.s.min, b.s.max]))}`);
  const strips = shapes.filter(({ s, tex }) => tex.has(METRO_TEX.strip) && inX(s, 1184, 1760) && near(s.max[2], F));
  sure(strips.length === 4 && strips.every(({ s }) => near(s.min[2], F - 8) && near(s.max[1] - s.min[1], EDGE)), `strips ${strips.length}`); // (two a side: cut at the crossing)
  const south = strips.filter(({ s }) => s.max[1] <= 768 + 0.5);
  sure(south.length === 2 && south.every(({ s }) => near(s.max[1], 768)), "the strips along the trench's edge");
  // the platforms: floor at F, 176 deep (less the strip: 152 of floor)
  const floors = shapes.filter(({ s, tex }) => tex.has(METRO_LOOKS.metro.po_sewerfloor) && inX(s, 1184, 1760) && near(s.max[2], F) && s.max[2] - s.min[2] > 40);
  sure(floors.length >= 2, `${floors.length} platform slabs`);
  // the rails: four, 4 wide and 6 high on the bed, the whole length of the station, at 10 and 42 either side of the middle (864)
  const rails = shapes.filter(({ s, tex }) => tex.has(METRO_TEX.rail) && inX(s, 1184, 1760) && near(s.max[0] - s.min[0], 576) && near(s.min[2], F - 40) && near(s.max[2], F - 34));
  const at = rails.map(({ s }) => Math.round((s.min[1] + s.max[1]) / 2 - 864)).sort((a, b) => a - b);
  sure(at.join() === "-42,-10,10,42", `rails at ${at}`);
  // the steps: treads 13, 27 and 40 over the bed, a hand's reach from each platform
  const tops = [...new Set(shapes.filter(({ s, tex }) => tex.has(METRO_LOOKS.metro.po_sewerfloor) && s.min[2] === F - 40).map(({ s }) => Math.round(s.max[2] - (F - 40))))].sort((a, b) => a - b);
  sure(tops.join() === "13,27,40", `step heights ${tops}`);
  // the crossing: boards at 12 under the platform's level, across the trench
  const boards = shapes.filter(({ s, tex }) => tex.has(METRO_TEX.wood) && near(s.max[2], F) && near(s.max[1] - s.min[1], 192) && near(s.max[0] - s.min[0], 96));
  sure(boards.length === 2, `${boards.length} crossings`);
});

test("metro: the entrance's arch stands over its head, clear 72 under the lintel; the line has walkways with a railing and the lamps are warm", () => {
  const pillars = shapes.filter(({ tex }) => tex.has(METRO_TEX.pillar)).map(({ s }) => s).filter((s) => s.min[2] === 40 && s.max[2] === 112);
  sure(pillars.length === 2 && pillars.every((s) => s.min[0] === 192 && s.max[0] === 216), `pillars ${JSON.stringify(pillars)}`);
  const lintel = shapes.map(({ s }) => s).find((s) => s.min[2] === 112 && s.max[2] === 128 && near(s.max[1] - s.min[1], 192));
  sure(lintel && lintel.min[0] === 192, "the lintel across the head, 112 over the street");
  const rail = shapes.filter(({ s, tex }) => tex.has(METRO_TEX.rail) && near(s.max[2] - s.min[2], 4) && near(s.max[0] - s.min[0], 288) && s.min[2] === F + 36);
  sure(rail.length === 2, `${rail.length} railings along the line's walkways`);
  const lights = built.map.entities.filter((e) => e.classname === "light").map((e) => String(e._light).split(" ").map(Number));
  const below = lights.filter((l) => [[210, 195, 175], [180, 110, 90]].some((c) => c.every((v, i) => v === l[i])));
  sure(below.length > 20 && below.some((l) => l[0] === 210) && below.some((l) => l[0] === 180), `${below.length} metro lights`);
  sure(lights.every((l) => !(l[1] < Math.min(l[0], l[2]) - 30)), "a pink light");
  // brightness: 150 over the platforms, 170 on the walls, 150 in the line
  sure(below.every((l) => l[3] >= 150 && l[3] <= 170), `brightness ${[...new Set(below.map((l) => l[3]))]}`);
});

test("metro: columns are square, off the crossings and the mouths; benches against the back walls; neither on a crossing", () => {
  for (const id of ["st-a", "st-b"]) {
    const h = hall(id);
    const cols = columnsOf(h);
    sure(cols.length >= 3 && cols.every((c) => c.half === 24), `${id}: ${cols.length} columns`);
    sure(cols.every((c) => h.trench.crossings.every(([a, b]) => c.p[0] < a - 24 || c.p[0] > b + 24)), `${id}: a column on a crossing`);
    const benches = benchesOf(h);
    sure(benches.length >= 2, `${id}: ${benches.length} benches`);
    sure(benches.every((b) => h.trench.crossings.every(([a, c]) => b.range[1] < a || b.range[0] > c)), `${id}: a bench on a crossing`);
  }
});

// ── the RP contract ──
const contract = rpContract(plan, built);
const paths = contract.paths;

test("metro: the walking graph has nodes on the platforms, the crossings, the concourse and the passages, none in the line or the trench; checkPaths and npc-sim hold it", () => {
  const got = checkPaths(paths, contract);
  sure(got.failures.length === 0, got.failures.join(" | "));
  const mine = paths.nodes.filter((n) => n.district === "below");
  const partOf = (id) => mine.filter((n) => n.part === id).length;
  sure(partOf("conc") >= 6 && partOf("st-a") >= 8 && partOf("st-b") >= 8 && partOf("pass-s") >= 1 && partOf("pass-n") >= 1, `nodes: conc ${partOf("conc")}, st-a ${partOf("st-a")}, st-b ${partOf("st-b")}`);
  sure(partOf("line-ab") === 0, "a node in the line");
  // no node over a trench (less its crossings): the stations' blockers
  for (const id of ["st-a", "st-b"]) {
    const T = hall(id).trench;
    const inTrench = mine.filter((n) => n.part === id && n.at[1] > T.v[0] + 1 && n.at[1] < T.v[1] - 1 && !T.crossings.some(([a, b]) => n.at[0] > a && n.at[0] < b));
    sure(inTrench.length === 0, `${id}: ${inTrench.length} nodes in the trench`);
  }
  // each platform has nodes (the crossing joins them): one piece, and the south platform of st-b is reached by the back passage
  sure(got.measures.components === 1, `${got.measures.components} pieces`);
  const r = analyse(JSON.parse(JSON.stringify(contract)));
  sure(r.errors.length === 0, r.errors.join(" | "));
  sure(paths.ways.some((w) => w.kind === "stair"), "the entrance is a way a guard follows");
  const ent = paths.links.filter((l) => l.way === "entrance");
  sure(ent.length >= 2 && ent.every((l) => l.how === "stair" && !l.gate), `the entrance's links ${ent.length}`);
  const roam = contract.roam.filter((q) => q.district === "below");
  sure(roam.some((q) => q.at[1] < 864) && roam.some((q) => q.at[1] > 864), "a roaming spot on each platform");
  sure(roam.every((q) => !(Math.abs(q.at[1] - 864) < 96 && q.at[0] > 1184 && q.at[0] < 1760 && !hall("st-a").trench.crossings.some(([a, b]) => q.at[0] > a && q.at[0] < b))), "a roaming spot over the trench");
});

test("metro: the walk model keeps the trench, the benches and the square columns as slabs nobody stands on", () => {
  const M = walkModel(deep);
  sure(!M.clear([1472, 864], F), "the trench is no floor");
  sure(M.clear([1600, 864], F), "the crossing is");
  sure(M.clear([1408, 690], F), "a platform is");
  sure(!M.clear([hall("st-a").trench.v[0] - 56 + 0, 0], F), "(off the hall)");
  const col = columnsOf(hall("st-a"))[0];
  sure(!M.clear(col.p, F) && !M.clear([col.p[0] + 24 + 10, col.p[1]], F), "a column and a hull's reach of it");
  sure(M.clear([col.p[0], col.p[1] - 24 - 17.6 - 40], F) || M.clear([col.p[0] + 100, col.p[1]], F), "past a column there is room");
});

// ── with the compilers ──
const VHLT = process.env.VHLT_DIR;
const wads = [process.env.TS_WAD, process.env.HL_WAD, process.env.MESE_WAD];
if (!VHLT || wads.some((w) => !w || !existsSync(w)))
  console.log("skip  the metro compiled and walked\n      skipped: it wants VHLT in VHLT_DIR and the three wads in TS_WAD, HL_WAD and MESE_WAD"); // prettier-ignore
else await testAsync("metro: compiled with no leak; a player walks from the street down the entrance, onto a platform, across the crossing, into the trench, along the line and out by the steps", "metro walked", async () => { // prettier-ignore
  const { compileMap } = await import("../src/maps/compile.mjs");
  const { readBsp } = await import("../src/maps/bsp.mjs");
  const { reachOf } = await import("../src/maps/reach.mjs");
  const work = mkdtempSync(join(tmpdir(), "smak-metro-"));
  const file = join(work, "smak_metro_test.map");
  writeFileSync(file, writeMap(built.map));
  // the station boards' wad, as levels/tools/build-site.mjs writes it beside the map
  const signsFile = join(work, "h9_metro_signs.wad");
  writeFileSync(signsFile, signsWad({ ...STATION_NAMES, [SIGN_FALLBACK]: "STATION" }).bytes);
  const r = compileMap(file, { wads: [...wads, signsFile], wadinclude: [...(library.wadinclude ?? []), "h9_metro_signs"], fast: true, timeout: 900000, compilers: { folder: VHLT } });
  sure(r.bsp && !r.leak, `compile: ${r.errors.join(" | ")}${r.leak ? " LEAK" : ""}`);
  const reach = reachOf(readBsp(readFileSync(r.bsp)));
  const w = (x, y, under) => reach.walked(x, y, under);
  const is = (a, b, d = 8) => a !== null && Math.abs(a - b) <= d;
  sure(is(w(60, 864, 100), 0), `the street: ${w(60, 864, 100)}`);
  // down the entrance: each step lower, to the concourse's floor
  const steps = [w(230, 864, 20), w(330, 864, -20), w(450, 864, -100), w(560, 864, -200), w(755, 864, -300)];
  sure(steps.every((z, i) => z !== null && (i === 0 || z < steps[i - 1])) && is(steps.at(-1), F, 24), `down the entrance: ${steps}`);
  sure(is(w(928, 864, -300), F), `the concourse: ${w(928, 864, -300)}`);
  sure(is(w(1136, 680, -300), F) && is(w(1136, 1048, -300), F), "both passages");
  sure(is(w(1400, 690, -300), F) && is(w(1400, 1040, -300), F), "both platforms of the first station");
  sure(is(w(1600, 864, -300), F), `across the crossing: ${w(1600, 864, -300)}`);
  // the trench: 40 down, the line along it, and the second station's trench
  sure(is(w(1400, 864, -300), F - 40) && is(w(1900, 864, -300), F - 40) && is(w(2300, 864, -300), F - 40), `the trench and the line: ${w(1400, 864, -300)}, ${w(1900, 864, -300)}, ${w(2300, 864, -300)}`);
  sure(is(w(1900, 788, -300), F) && is(w(1900, 940, -300), F), `the line's walkways: ${w(1900, 788, -300)}, ${w(1900, 940, -300)}`);
  sure(is(w(2230, 700, -300), F) && is(w(2230, 1040, -300), F), `both platforms of the second station: ${w(2230, 700, -300)}, ${w(2230, 1040, -300)}`);
  // out of the trench: a tread of the steps (13, 27, 40 over the bed) beside each platform, and no place of the trench's floor that is a trap
  const treads = [w(1232, 808, F), w(1232, 792, F), w(1232, 776, F)];
  // (a hull rests on the highest tread under it: each place is at or above the one nearer the trench, the last at the platform's level)
  sure(treads.every((z, i) => z !== null && z > F - 40 && z <= F + 1 && (i === 0 || z >= treads[i - 1])) && is(treads[2], F, 2), `the steps up out of the trench: ${treads}`);
  sure(reach.trapped(1400, 864, -300) === null && reach.trapped(1900, 864, -300) === null && reach.trapped(2300, 864, -300) === null, `a place of the trench is a trap: ${reach.trapped(1400, 864, -300)}, ${reach.trapped(1900, 864, -300)}`);
});
