// levels/assembly, the site (site.mjs, levels/specs/mese-01.json): a stretch of the Mese, its street, porticoes,
// lanes and square given, five buildings laid out from their program (a shop and two flats each). The plan with no
// failure, every site rule kept (properties, portico depth, street width, the square, footprints, homes' share), the
// spawns on public floor; the properties of a building (the back room the shop's, each flat its own, the stair hall
// the building's door); the site assembled from the Mese's pieces with every leaf named for its property, the facade,
// shopfronts and shop windows on the street, the lamps out of the world; the same site the same map twice. With VHLT
// and the three wads, the site compiled with no leak and walked to every room. The broken cases of checkSite and
// checkSpawns are in test/broken/levels.mjs.
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { test, testAsync, sure, HERE } from "./helper.mjs";
import { planSite, checkSite, spawnsOf, checkSpawns, propertiesOf, assembleSite, siteLight, siteSpec } from "../levels/assembly/site.mjs";
import { loadLibrary } from "../levels/assembly/library.mjs";
import { loadStyle } from "../levels/assembly/style.mjs";
import { writeMap } from "../src/maps/source.mjs";

const plan = planSite(siteSpec("mese-01"));
const style = loadStyle("mese");
const library = loadLibrary(join(HERE, "../levels/assembly/pieces/mese"));

test("assembly site: mese-01 planned with no failure and every site rule of the Mese kept", () => {
  sure(!plan.failures.length, `the plan: ${plan.failures.join(" | ")}`);
  const c = checkSite(plan, style);
  sure(!c.failures.length && !c.warnings.length, `the site: ${[...c.failures, ...c.warnings].join(" | ")}`);
  const m = c.measures;
  sure(m.properties.shop === 5 && m.properties.home === 10 && m.homesShare >= 0.6, `properties: ${JSON.stringify(m.properties)}`);
  sure(m.porticoes.every((d) => d >= 2) && m.street >= 5 && m.street <= 9, `porticoes ${m.porticoes}, street ${m.street}`);
  const spawns = spawnsOf(plan);
  sure(spawns.length >= 8 && !checkSpawns(plan, spawns, style).failures.length, `spawns: ${checkSpawns(plan, spawns, style).failures.join(" | ")}`); // prettier-ignore
});

test("assembly site: a building's properties: the back room the shop's, each flat its own, the stair hall the door's", () => {
  const props = propertiesOf(plan.layouts.get("a"), style);
  const got = Object.fromEntries(props);
  sure(got.shop === "shop" && got.back === "shop" && got.flat1 === "flat1" && got.flat2 === "flat2" && got.hall === "hall" && got.landing === null, `properties: ${JSON.stringify(got)}`); // prettier-ignore
});

test("assembly site: assembled from the Mese's pieces, every leaf named, the street's pieces on the street, the same map twice", () => {
  const built = assembleSite(plan, library, { style });
  sure(!built.report.failures.length, `assembled: ${built.report.failures.join(" | ")}`);
  const names = built.report.doorways.map((d) => d.targetname);
  sure(names.length === 25 && names.every((n) => /^smak_mese01_[a-e]_(shop|hall|flat1|flat2)$/.test(n)), `names: ${names.join(" ")}`);
  const c = built.report.counts;
  sure(c.shopfront === 5 && c["shop-window"] >= 5 && c.facade > 0 && c["floor-home"] > 0 && c.column > 0 && c.landmark === 1, `counts: ${JSON.stringify(c)}`); // prettier-ignore
  const leaves = built.map.entities.filter((e) => e.classname === "func_wall" && e.zhlt_noclip && !e.zhlt_lightflags);
  sure(leaves.length === 12, `the lamps out of the world: ${leaves.length} func_wall with no clip, want one a building, one for its wall lamps outside and one a portico`);
  // the skyline: each building's crown (its parapets and turrets) one func_wall with no clip that casts its shadow
  const crowns = built.map.entities.filter((e) => e.classname === "func_wall" && e.zhlt_noclip && Number(e.zhlt_lightflags) === 2);
  sure(crowns.length === plan.site.buildings.length + 1 && c.parapet > 0 && c["crown-corner"] > 0, `the crowns: ${crowns.length} func_wall, parapets ${c.parapet}, turrets ${c["crown-corner"]}`); // prettier-ignore
  const doors = built.map.entities.filter((e) => e.classname === "func_door_rotating");
  sure(doors.length === 25 && doors.every((e) => e.targetname && Number(e.spawnflags) & 256), "every door named and opened by use");
  sure(built.report.spawns.length >= 8 && built.map.entities.filter((e) => e.classname === "info_player_deathmatch").length === built.report.spawns.length, "the spawns"); // prettier-ignore
  sure(writeMap(assembleSite(plan, library, { style }).map) === writeMap(built.map), "the same site gave two different maps");
});

// ── with the compilers ──
const VHLT = process.env.VHLT_DIR;
const wads = [process.env.TS_WAD, process.env.HL_WAD, process.env.MESE_WAD];
if (!VHLT || wads.some((w) => !w || !existsSync(w)))
  console.log("skip  the Mese's site compiled, its light measured and walked\n      skipped: it wants VHLT in VHLT_DIR and the three wads in TS_WAD, HL_WAD and MESE_WAD"); // prettier-ignore
else await testAsync("assembly site: compiled with no leak, rooms lit above the street, every room walked to", "mese site walked", async () => { // prettier-ignore
  const { compileMap } = await import("../src/maps/compile.mjs");
  const { readBsp } = await import("../src/maps/bsp.mjs");
  const { navWalk, navAvailable } = await import("../levels/assembly/navwalk.mjs");
  const work = mkdtempSync(join(tmpdir(), "smak-mese-"));
  const file = join(work, "smak_mese01.map");
  writeFileSync(file, writeMap(assembleSite(plan, library, { style }).map));
  // the light as the game will have it: a full compile with its bounces (a draft's rooms are darker than its street)
  const r = compileMap(file, { wads, wadinclude: library.wadinclude, compilers: { folder: VHLT }, args: { hlrad: ["-extra", "-bounce", "8"] } }); // prettier-ignore
  sure(r.bsp && !r.leak, `compile: ${r.errors.join(" | ")}${r.leak ? " LEAK" : ""}`);
  const light = siteLight(readBsp(readFileSync(r.bsp)), plan, style);
  sure(light.measures.rooms > light.measures.public, `light: ${JSON.stringify(light.measures)}`);
  if (!(await navAvailable())) return;
  const walk = join(work, "smak_mese01_walk.map");
  writeFileSync(walk, writeMap(assembleSite(plan, library, { style, open: true }).map));
  const w = compileMap(walk, { wads, vis: false, light: false, compilers: { folder: VHLT } });
  const targets = [];
  for (const b of plan.site.buildings) {
    const l = plan.layouts.get(b.id);
    for (const room of l.rooms) {
      const cells = [];
      l.storeyPlans[room.storey].cells.forEach((row, y) => row.forEach((v, x) => v === room.id && cells.push([x, y])));
      const [x, y] = cells[Math.floor(cells.length / 2)];
      targets.push({ name: `${b.id}.${room.id}`, at: [(b.at[0] + x + 0.5) * 64, (b.at[1] + y + 0.5) * 64, room.storey * 192 + 40] });
    }
  }
  // the CLIP brushes rebuilt from hull 1 are left out: their rebuild closed every stair's second flight here, which
  // a trace of hull 1 itself stands on from 96 to 192 (README, "The site")
  const got = await navWalk(readBsp(readFileSync(w.bsp)), { targets, clips: false });
  const missed = got.targets.filter((t) => !t.reached).map((t) => t.name);
  sure(!missed.length, `not walked to: ${missed.join(", ")}`);
});
