// levels/assembly/terrain.mjs on levels/specs/terrain-test.json: a site whose ground is not one height. Planned with no
// failure and no warning (two terraces, a ramp of 1:8, stairs with a landing, retaining walls, a canal with two bridges, a
// stair down into it and a culvert); assembled with its water brush, its fill, its bridges and its lamps in the culvert,
// and its sky box under the lowest floor; a flat site left as it was. With VHLT and the three wads, compiled with no leak
// and walked: a player gets up the ramp and the stairs, over both bridges, and into the culvert by the water. The broken
// cases of checkTerrain are in test/broken/levels.mjs.
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { test, testAsync, sure, HERE } from "./helper.mjs";
import { planSite, assembleSite, siteSpec } from "../levels/assembly/site.mjs";
import { checkTerrain } from "../levels/assembly/terrain.mjs";
import { loadLibrary } from "../levels/assembly/library.mjs";
import { writeMap, shapeOf } from "../src/maps/source.mjs";

const plan = planSite(siteSpec("terrain-test"));
const library = loadLibrary(join(HERE, "../levels/assembly/pieces/mese"));

test("assembly terrain: terrain-test planned with no failure and no warning of the ground", () => {
  const c = checkTerrain(plan);
  sure(!plan.failures.length, `the plan: ${plan.failures.join(" | ")}`);
  sure(!c.failures.length && !c.warnings.length, `the ground: ${[...c.failures, ...c.warnings].join(" | ")}`);
  const m = c.measures;
  sure(m.lowest === -192 && m.highest === 192, `lowest ${m.lowest}, highest ${m.highest}`);
  sure(m.ramps.length === 1 && Math.abs(m.ramps[0].slope - 1 / 8) < 1e-9, `ramps ${JSON.stringify(m.ramps)}`);
  const flight = m.stairs.find((s) => s.name === "the terrace stair");
  sure(flight.steps === 8 && flight.landings === 1 && flight.tread >= 16, `stairs ${JSON.stringify(m.stairs)}`);
  sure(m.water.length === 1 && m.bridges.length === 2 && m.culverts.length === 1 && m.walls === 4, JSON.stringify(m));
  sure(m.heights.includes(64) && m.heights.includes(192) && m.heights.includes(-192), `heights ${m.heights}`);
});

test("assembly terrain: assembled with the water, the fill, the ramp's slope and the culvert's lamps", () => {
  const built = assembleSite(plan, library, {});
  sure(!built.report.failures.length, `assembled: ${built.report.failures.join(" | ")}`);
  const text = writeMap(built.map);
  sure(text.includes("!gwater3"), "a water brush of !gwater3");
  const all = [...built.map.brushes, ...built.map.entities.flatMap((e) => e.brushes ?? [])].map(shapeOf);
  sure(all.some((s) => s.min[2] === -192 && s.max[2] === -96 && s.min[0] === 26 * 64 && s.max[0] === 30 * 64), "the canal's water, bed -192 to its surface -96");
  sure(all.some((s) => s.min[2] === 0 && s.max[2] === 64 && s.min[1] === 16 * 64 && s.max[1] === 24 * 64), "the ramp: a brush from z 0 to 64 over its 8 cells"); // prettier-ignore
  sure(built.report.floor === -192, `the sky box's floor under the canal: ${built.report.floor}`);
  const lamps = built.map.entities.filter((e) => e.classname === "light" && String(e.origin).split(/[ ,]+/)[2] === "-64");
  sure(lamps.length === 2, `the culvert's lamps (4 cells, one every two): ${lamps.length}`);
  const starts = built.map.entities.filter((e) => e.classname === "info_player_deathmatch").map((e) => String(e.origin).split(/[ ,]+/)[2]);
  sure(new Set(starts).size >= 3, `starts at the heights ${[...new Set(starts)]}`);
  sure(writeMap(assembleSite(plan, library, {}).map) === text, "the same site gave two different maps");
});

test("assembly terrain: a flat site has no terrain brush, its floor at -32 and its walls from -16 as ever", () => {
  const flat = planSite(siteSpec("mese-01"));
  sure(!flat.terrain.varied && flat.terrain.measures.lowest === 0, JSON.stringify(flat.terrain.measures));
  const built = assembleSite(flat, library, {});
  sure(built.report.floor === 0, "floor 0");
  const sky = built.map.brushes.map(shapeOf).filter((s) => s.min[2] === -32 && s.max[2] === -16);
  sure(sky.length === 1, `one sky floor: ${sky.length}`);
});

// ── with the compilers ──
const VHLT = process.env.VHLT_DIR;
const wads = [process.env.TS_WAD, process.env.HL_WAD, process.env.MESE_WAD];
if (!VHLT || wads.some((w) => !w || !existsSync(w)))
  console.log("skip  the terrain site compiled and walked\n      skipped: it wants VHLT in VHLT_DIR and the three wads in TS_WAD, HL_WAD and MESE_WAD"); // prettier-ignore
else await testAsync("assembly terrain: compiled with no leak; a player walks the ramp, the stairs, both bridges and into the culvert", "terrain walked", async () => { // prettier-ignore
  const { compileMap } = await import("../src/maps/compile.mjs");
  const { readBsp } = await import("../src/maps/bsp.mjs");
  const { reachOf } = await import("../src/maps/reach.mjs");
  const work = mkdtempSync(join(tmpdir(), "smak-terrain-"));
  const file = join(work, "smak_terrain_test.map");
  writeFileSync(file, writeMap(assembleSite(plan, library, {}).map));
  const r = compileMap(file, { wads, wadinclude: library.wadinclude, fast: true, timeout: 900000, compilers: { folder: VHLT } });
  sure(r.bsp && !r.leak, `compile: ${r.errors.join(" | ")}${r.leak ? " LEAK" : ""}`);
  const reach = reachOf(readBsp(readFileSync(r.bsp)));
  const at = (cx, cy, under) => reach.walked(cx * 64 + 32, cy * 64 + 32, under);
  const near = (a, b) => a !== null && Math.abs(a - b) <= 8;
  sure(near(at(16, 20), 32) && near(at(16, 23), 64), `the ramp walked: ${at(16, 20)}, ${at(16, 23)}`);
  sure(near(at(22, 38), 160) && near(at(22, 39), 160) && near(at(22, 40), 192), `the stair and its landing walked: ${at(22, 38)}, ${at(22, 39)}, ${at(22, 40)}`);
  sure(near(at(22, 46), 192), "the second terrace reached");
  sure(near(at(28, 8, 10), 0) && near(at(28, 15.5, 10), 0), "both bridges walked");
  sure(near(at(25, 12), -80) && near(at(32, 19, -100), -192), "the stair into the water, and the culvert");
  sure(reach.facts.some((f) => /all \d+ entities a player goes to are reached on foot/.test(f)), reach.facts.join(" | "));
});
