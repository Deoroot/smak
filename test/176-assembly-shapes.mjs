// levels/assembly/shapes.mjs on levels/specs/shapes-test.json: areas that are not rectangles of cells. Planned with no
// failure (a street at 45 degrees and one at 24, an octagon plaza, the Hippodrome: an oval track round a spine, flattened
// where the streets pass, and a raised court, a concave polygon at z 64 with a ramp); assembled with whole-number angled
// brushes that tile their cells exactly (no gap, no overlap, no brush under 2 units); the RP layer standing on the shaped
// floors (levels/rp/paths.mjs groundOf: a node on the floor, none in a wall, the raised court at its own z, one graph);
// a flat site with a shaped area given the ground too. With VHLT and the three wads, compiled with no leak and walked.
// The broken cases of checkShapes are in test/broken/levels.mjs.
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { test, testAsync, sure, sureEach, HERE } from "./helper.mjs";
import { planSite, assembleSite, siteSpec } from "../levels/assembly/site.mjs";
import { checkShapes, shapeBrushes } from "../levels/assembly/shapes.mjs";
import { checkTerrain } from "../levels/assembly/terrain.mjs";
import { loadLibrary } from "../levels/assembly/library.mjs";
import { rpContract, roamspotsCfg } from "../levels/rp/contract.mjs";
import { groundOf, checkPaths, componentsOf, EYE } from "../levels/rp/paths.mjs";
import { writeMap, shapeOf, holds, offGrid } from "../src/maps/source.mjs";

const plan = planSite(siteSpec("shapes-test"));
const library = loadLibrary(join(HERE, "../levels/assembly/pieces/mese"));
const S = plan.shapes;
const byName = (n) => S.list.find((s) => s.name === n);
const angleOf = (a, b) => ((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 360) % 180;

test("assembly shapes: shapes-test planned with no failure, five shapes of a width a player walks", () => {
  const c = checkShapes(plan);
  sure(!plan.failures.length, `the plan: ${plan.failures.join(" | ")}`);
  sure(!c.failures.length && !c.warnings.length, `the shapes: ${[...c.failures, ...c.warnings].join(" | ")}`);
  sure(S.list.length === 5, `${S.list.length} shapes`);
  sureEach(S.list, "the shapes", (s) => sure(s.width >= 96 && s.floor.length && s.mass.length, `${s.name}: width ${s.width}`));
  sure(byName("hippodrome").track >= 96 && byName("hippodrome").solids.length, `the spine and the track: ${byName("hippodrome").track}`);
  // the cells the floor does not touch are solid, the rest public
  const labels = new Set(plan.cells.flat());
  sure(labels.has("solid"), "solid cells");
  sure(plan.cells[25][2] === "solid" && plan.cells[18][8] === "street", `the 45 degree street's far corner and its axis: ${plan.cells[25][2]} / ${plan.cells[18][8]}`);
});

test("assembly shapes: the angles are the ones asked for, the corners whole numbers", () => {
  const edges = (n) => byName(n).outline.map((p, i, r) => [p, r[(i + 1) % r.length]]);
  const near = (n, deg) => edges(n).some(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 200 && Math.abs(angleOf(p, q) - deg) < 0.6);
  sure(near("diagonal 45", 45), "an edge at 45 degrees on the 45 degree street");
  sure(near("diagonal 24", 24), "an edge at 24 degrees on the 24 degree street");
  sure(near("octagon", 45) && near("octagon", 90) && near("octagon", 0), "the octagon's flat and diagonal sides");
  const { brushes } = shapeBrushes(S, { zOf: () => 0 });
  sure(brushes.length > 60, `${brushes.length} brushes`);
  sureEach(brushes, "the shapes' brushes", (b) => {
    sure(!offGrid(b, 1, 1e-9).length, "a plane point off the whole numbers");
    const s = shapeOf(b);
    sure(!s.faults.length, `faults ${s.faults.join("; ")}`);
    sure(Math.min(...[0, 1, 2].map((i) => s.max[i] - s.min[i])) >= 2, "a brush under 2 units");
  });
});

test("assembly shapes: floor, walls and spine tile their cells exactly: every point under the floor is in one brush", () => {
  const { brushes } = shapeBrushes(S, { zOf: () => 0 });
  let n = 0;
  for (const s of S.list) {
    const mine = brushes.filter((b) => {
      const sh = shapeOf(b);
      return sh.min[0] >= s.rect[0] - 0.01 && sh.max[0] <= s.rect[2] + 0.01 && sh.min[1] >= s.rect[1] - 0.01 && sh.max[1] <= s.rect[3] + 0.01;
    });
    for (let y = s.rect[1] + 3.31; y < s.rect[3]; y += 29.7)
      for (let x = s.rect[0] + 5.17; x < s.rect[2]; x += 29.7) {
        const hit = mine.filter((b) => holds(b, [x, y, -8]));
        sure(hit.length === 1, `${s.name}: the point ${x},${y} is in ${hit.length} brushes`);
        n++;
      }
  }
  sure(n > 1500, `${n} points`);
});

test("assembly shapes: assembled with the angled floor and walls instead of the paving of their cells; the same twice", () => {
  const built = assembleSite(plan, library, {});
  sure(!built.report.failures.length, `assembled: ${built.report.failures.join(" | ")}`);
  sure(built.report.counts["shape-floor"] > 20 && built.report.counts["shape-wall"] > 20, JSON.stringify(built.report.counts));
  const all = built.map.brushes.map(shapeOf);
  // no paving slab over a shaped cell (a 64 box from -16 to 0 on the 45 degree street's corner cell)
  sure(!all.some((s) => s.min[2] === -16 && s.max[2] === 0 && s.max[0] - s.min[0] === 64 && s.min[0] === 2 * 64 && s.min[1] === 12 * 64), "paving left under the shaped street");
  // the raised court is at z 64: its floor's top
  sure(all.some((s) => s.max[2] === 64 && s.min[2] === 48 && s.min[0] >= 30 * 64 && s.max[0] <= 40 * 64), "the raised court's floor at 64");
  sure(all.some((s) => s.max[2] === 64 + 192), "the raised court's walls");
  sure(writeMap(assembleSite(plan, library, {}).map) === writeMap(built.map), "the same site gave two different maps");
});

test("assembly shapes: the ground of a shaped area given a z with no way up to it fails; the ramp lets it pass", () => {
  const c = checkTerrain(plan);
  sure(!c.failures.length, `the ground: ${c.failures.join(" | ")}`);
  const raw = structuredClone(plan.site);
  raw.joins = [];
  const p = { ...plan, site: raw };
  const t = checkTerrain(p).failures;
  sure(t.some((f) => /the ground at z 0 and z 64 meets along x 40, y 37\.\.40, with no ramp, stair or retaining wall/.test(f)), t.join(" | "));
});

// ── the RP layer ──
test("assembly shapes: the walking graph stands on the shaped floors: a node on the floor, none in a wall, the court at its z, one piece", () => {
  const built = assembleSite(plan, library, {});
  const c = rpContract(plan, built);
  const GR = groundOf(plan);
  sure(GR, "groundOf for a site with shaped areas");
  const nodes = c.paths.nodes;
  const inShape = (n) => S.list.find((s) => n.at[0] >= s.rect[0] && n.at[0] < s.rect[2] && n.at[1] >= s.rect[1] && n.at[1] < s.rect[3]);
  const shaped = nodes.filter(inShape);
  sure(shaped.length >= 20, `${shaped.length} nodes in the shaped areas`);
  sureEach(shaped, "the nodes in shaped areas", (n) => {
    const f = GR.floor(n.at[0], n.at[1]);
    sure(f !== null && Math.abs(f + EYE - n.at[2]) <= 1, `${n.id} at ${n.at}: the floor is ${f}`);
    sure(S.on(n.at[0], n.at[1]) === true, `${n.id} at ${n.at} is not on the floor of ${inShape(n).name}`);
  });
  const courtNodes = shaped.filter((n) => inShape(n).name === "raised court");
  sure(courtNodes.length >= 2 && courtNodes.every((n) => n.at[2] === 64 + EYE), `the court's nodes: ${courtNodes.map((n) => n.at[2])}`);
  for (const name of ["diagonal 45", "diagonal 24", "octagon", "hippodrome"]) sure(shaped.some((n) => inShape(n).name === name), `a node in ${name}`);
  sure(componentsOf(c.paths).length === 1, `${componentsOf(c.paths).length} pieces`);
  const checked = checkPaths(c.paths, c);
  sure(!checked.failures.length, checked.failures.join(" | "));
  // the roaming spots of the contract: none in a wall (the cells the floor does not touch are not public)
  sureEach(c.roam, "the roaming spots", (r) => {
    const on = S.on(r.at[0], r.at[1]);
    sure(on !== false, `a roaming spot at ${r.at} in a wall`);
  });
  sure(roamspotsCfg(c).trim().split("\n").length === c.roam.length + 1, "the roambots' file");
  // the starts on the floor
  sureEach(built.report.spawns, "the starts", (s) => sure(S.on(s.at[0] * 64, s.at[1] * 64) !== false, `a start at ${s.at} in a wall`));
  sure(built.report.spawns.some((s) => inShape({ at: [s.at[0] * 64, s.at[1] * 64] })), "a start in a shaped area");
});

test("assembly shapes: a flat site with a shaped area gets the ground too: floor under the shape, none in its walls", () => {
  const flat = structuredClone(siteSpec("shapes-test"));
  for (const a of flat.areas) delete a.z;
  flat.joins = [];
  const p = planSite(flat);
  sure(!p.failures.length, p.failures.join(" | "));
  sure(!p.terrain.varied && p.terrain.shaped, "a flat site, shaped");
  const GR = groundOf(p);
  sure(GR, "groundOf for a flat site with shaped areas");
  const oct = p.shapes.list.find((s) => s.name === "octagon");
  const mid = [(oct.rect[0] + oct.rect[2]) / 2, (oct.rect[1] + oct.rect[3]) / 2];
  sure(GR.floor(...mid) === 0, `the octagon's middle: ${GR.floor(...mid)}`);
  sure(GR.floor(oct.rect[0] + 8, oct.rect[1] + 8) === null, "the octagon's corner is a wall");
  const hip = p.shapes.list.find((s) => s.name === "hippodrome");
  sure(GR.floor(896, 2496) === null, "the spine is a wall");
  sure(GR.floor(896, 2496 + 250) === 0, `the track: ${GR.floor(896, 2496 + 250)}`);
  void hip;
  // and a flat site with no shaped area has no ground to speak of
  sure(groundOf(planSite(siteSpec("mese-01"))) === null, "mese-01 has no groundOf");
});

// ── with the compilers ──
const VHLT = process.env.VHLT_DIR;
const wads = [process.env.TS_WAD, process.env.HL_WAD, process.env.MESE_WAD];
if (!VHLT || wads.some((w) => !w || !existsSync(w)))
  console.log("skip  the shapes site compiled and walked\n      skipped: it wants VHLT in VHLT_DIR and the three wads in TS_WAD, HL_WAD and MESE_WAD"); // prettier-ignore
else await testAsync("assembly shapes: compiled with no leak; a player walks the angled streets, the octagon, the track and the court, and not their walls", "shapes walked", async () => { // prettier-ignore
  const { compileMap } = await import("../src/maps/compile.mjs");
  const { readBsp } = await import("../src/maps/bsp.mjs");
  const { reachOf } = await import("../src/maps/reach.mjs");
  const work = mkdtempSync(join(tmpdir(), "smak-shapes-"));
  const file = join(work, "smak_shapes_test.map");
  writeFileSync(file, writeMap(assembleSite(plan, library, {}).map));
  const r = compileMap(file, { wads, wadinclude: library.wadinclude, fast: true, timeout: 900000, compilers: { folder: VHLT } });
  sure(r.bsp && !r.leak, `compile: ${r.errors.join(" | ")}${r.leak ? " LEAK" : ""}`);
  const reach = reachOf(readBsp(readFileSync(r.bsp)));
  const at = (x, y, under) => reach.walked(x, y, under);
  const near = (a, b) => a !== null && Math.abs(a - b) <= 8;
  // the 45 degree street's axis (448,1088), the 24 degree street's (1664, 1216), the octagon's middle, the track at the spine's side, the court
  sure(near(at(448, 1088), 0) && near(at(704, 1344), 0), `the 45 degree street walked: ${at(448, 1088)}, ${at(704, 1344)}`);
  sure(near(at(1664, 1216), 0) && near(at(1900, 1320), 0), `the 24 degree street walked: ${at(1664, 1216)}, ${at(1900, 1320)}`);
  sure(near(at(2624, 1216), 0) && near(at(2500, 1100), 0), `the octagon walked: ${at(2624, 1216)}, ${at(2500, 1100)}`);
  sure(near(at(896, 2496 + 250), 0) && near(at(896, 2496 - 250), 0) && near(at(300, 2496), 0), `the track walked: ${at(896, 2496 + 250)}, ${at(896, 2496 - 250)}, ${at(300, 2496)}`);
  sure(near(at(2240, 2420), 64) && near(at(2150, 2300), 64) && near(at(2540, 2496), 64), `the raised court walked: ${at(2240, 2420)}, ${at(2150, 2300)}, ${at(2540, 2496)}`);
  sure(near(at(2700, 2496), 46), `the ramp: ${at(2700, 2496)}`);
  // the walls and the spine are not floor
  sure(at(896, 2496) === null, "the spine is not walked");
  sure(at(900, 800) === null && at(150, 1600) === null, `the 45 degree street's walls: ${at(900, 800)}, ${at(150, 1600)}`);
  sure(reach.facts.some((f) => /all \d+ entities a player goes to are reached on foot/.test(f)), reach.facts.join(" | "));
});
