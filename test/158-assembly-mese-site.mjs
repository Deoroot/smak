// levels/assembly, the site (site.mjs, levels/specs/mese-01.json): a stretch of the Mese, its street, porticoes,
// lanes and square given, five buildings laid out from their program (a shop and two flats each). The plan with no
// failure, every site rule kept (properties, portico depth, street width, the square, footprints, homes' share), the
// spawns on public floor; the properties of a building (the back room the shop's, each flat its own, the stair hall
// the building's door); the site assembled from the Mese's pieces with every leaf named for its property, the facade,
// shopfronts and shop windows on the street, the lamps out of the world; the same site the same map twice; the switched
// lamps (24 names at the most, each with its button) and the jail (a site of the Nexus alone: its cells opened by no
// player, all by one button in the guard room). With VHLT
// and the three wads, the site compiled with no leak and walked to every room. The broken cases of checkSite and
// checkSpawns are in test/broken/levels.mjs.
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { test, testAsync, sure, HERE } from "./helper.mjs";
import { planSite, checkSite, spawnsOf, checkSpawns, propertiesOf, assembleSite, siteLight, siteSpec, switchesOf, SWITCHES_MOST } from "../levels/assembly/site.mjs";
import { checkBelow, readBelow } from "../levels/assembly/below.mjs";
import { loadLibrary } from "../levels/assembly/library.mjs";
import { loadStyle } from "../levels/assembly/style.mjs";
import { writeMap, shapeOf } from "../src/maps/source.mjs";

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
  // (the switched rooms' lamps are apart, one func_wall a name: the next test)
  const leaves = built.map.entities.filter((e) => e.classname === "func_wall" && e.zhlt_noclip && !e.zhlt_lightflags && !e.targetname);
  // (a building's lamps, its wall lamps outside and a portico's: each kind apart from the world, and split into zone-sized
  // parts, so none touches more than 48 leaves; levels/assembly/assemble.mjs, apartEntities)
  sure(leaves.length >= 12, `the lamps out of the world: ${leaves.length} func_wall with no clip, want a building's, its wall lamps outside and a portico's at least`);
  const wide = built.map.entities.filter((e) => e.classname === "func_wall" && e.brushes.length > 1).filter((e) => {
    const s = e.brushes.map(shapeOf);
    const [lo, hi] = [0, 1, 2].map((k) => [Math.min(...s.map((q) => q.min[k])), Math.max(...s.map((q) => q.max[k]))]).reduce((a, [l, h]) => [[...a[0], l], [...a[1], h]], [[], []]);
    const sky = Number(e.zhlt_lightflags) === 2 && e.zhlt_noclip;
    return hi[2] - lo[2] > (sky ? 200 : 160) || (!sky && ((hi[0] - lo[0]) * (hi[1] - lo[1]) > 130000 || Math.max(hi[0] - lo[0], hi[1] - lo[1]) > 448)); // prettier-ignore
  });
  sure(!wide.length, `${wide.length} func_wall reach past a zone (160 high, 130000 of floor, 448 long; the skyline 200 high); the engine would send them always`);
  // the skyline: each building's crown (its parapets and turrets) one func_wall with no clip that casts its shadow
  const crowns = built.map.entities.filter((e) => e.classname === "func_wall" && e.zhlt_noclip && Number(e.zhlt_lightflags) === 2);
  sure(crowns.length >= plan.site.buildings.length + 1 && c.parapet > 0 && c["crown-corner"] > 0, `the crowns: ${crowns.length} func_wall, parapets ${c.parapet}, turrets ${c["crown-corner"]}`); // prettier-ignore
  const doors = built.map.entities.filter((e) => e.classname === "func_door_rotating");
  sure(doors.length === 25 && doors.every((e) => e.targetname && Number(e.spawnflags) & 256), "every door named and opened by use");
  sure(built.report.spawns.length >= 8 && built.map.entities.filter((e) => e.classname === "info_player_deathmatch").length === built.report.spawns.length, "the spawns"); // prettier-ignore
  sure(writeMap(assembleSite(plan, library, { style }).map) === writeMap(built.map), "the same site gave two different maps");
});

test("assembly site: the switched lamps: 24 names at the most, each a room's lamps, its glass's light and a switch by its door", () => {
  const built = assembleSite(plan, library, { style });
  const E = built.map.entities;
  const names = [...new Set(E.filter((e) => /^light/.test(e.classname) && e.targetname).map((e) => e.targetname))];
  sure(names.length > 0 && names.length <= SWITCHES_MOST, `${names.length} switched names; ${SWITCHES_MOST} at the most (GoldSrc holds 32 switched styles)`);
  sure(names.length === built.report.switches.length, `${names.length} named lights, ${built.report.switches.length} switches reported`);
  for (const name of names) {
    const buttons = E.filter((e) => e.classname === "func_button" && e.target === name);
    sure(buttons.length === 1 && !(Number(buttons[0].spawnflags) & 256), `${name}: ${buttons.length} buttons target it; it wants one, used and not touched`);
    sure(E.some((e) => e.classname === "func_wall" && e.targetname === name), `${name}: its lamps' fittings are no entity of that name (their +A frame, dark)`);
    sure(E.some((e) => e.classname === "light_surface" && e.targetname === name && e._fname === name), `${name}: no light_surface puts its glass's light on its style`);
  }
  // every button's target answered
  for (const b of E.filter((e) => e.classname === "func_button")) sure(E.some((e) => e.targetname === b.target), `a button targets ${b.target}, which nothing is named`);
  // a site of more than the most: the shops first, then whole buildings' homes; the rest go without
  const few = switchesOf(plan, style, 7);
  sure(few.chosen.length <= 7 && few.chosen.slice(0, 5).every((p) => p.kind === "shop") && few.skipped.length + few.chosen.length === names.length, `7 switches: ${few.chosen.map((p) => `${p.building}.${p.property}`).join(" ")}`); // prettier-ignore
  const byBuilding = new Map();
  for (const p of few.chosen.filter((p) => p.kind === "home")) byBuilding.set(p.building, (byBuilding.get(p.building) ?? 0) + 1);
  for (const [b, n] of byBuilding) sure(n === [...few.chosen, ...few.skipped].filter((p) => p.building === b && p.kind === "home").length, `building ${b}: some of its homes switched, not all`); // prettier-ignore
});

// the jail: a site of the Nexus alone (one seed: its layout takes some 20 s)
const JAIL_SITE = {
  format: "smak-site/1", name: "smak_jail", style: "byzantium", theme: "techno-byzantium", size: [16, 14], seeds: 1,
  districts: [{ id: "nexus", from: [0, 0], to: [16, 14] }],
  areas: [{ kind: "plaza", name: "the forecourt", from: [0, 0], to: [6, 14] }],
  buildings: [{ id: "nexus", at: [6, 1], size: [10, 12], front: "west", program: "nexus", blind: ["north", "south", "east"], seed: 1 }],
};
test("assembly site: the jail: its cells' doors opened by no prisoner, all of them by one switch in the guard room", () => {
  const jailPlan = planSite(JAIL_SITE);
  sure(!jailPlan.failures.length, `the plan: ${jailPlan.failures.join(" | ")}`);
  const built = assembleSite(jailPlan, library);
  sure(!built.report.failures.length, `assembled: ${built.report.failures.join(" | ")}`);
  const E = built.map.entities;
  const cells = E.filter((e) => e.classname === "func_door_rotating" && /_cell\d+$/.test(e.targetname ?? ""));
  sure(cells.length === 3, `${cells.length} cell doors, 3 wanted`);
  // named and not "use only" (256): CBaseDoor gives a player no use of it and locks its touch; toggle (32): it stays open
  sure(cells.every((e) => !(Number(e.spawnflags) & 256) && Number(e.spawnflags) & 32), `the cells' flags: ${cells.map((e) => e.spawnflags).join(" ")}`); // prettier-ignore
  const others = E.filter((e) => e.classname === "func_door_rotating" && !cells.includes(e));
  sure(others.every((e) => Number(e.spawnflags) & 256), "every other door opened by use");
  const j = built.report.jail;
  sure(j?.room === "guard", `the jail's switch: ${JSON.stringify(j)}`);
  const buttons = E.filter((e) => e.classname === "func_button" && e.target === j.name);
  const mm = E.filter((e) => e.classname === "multi_manager" && e.targetname === j.name);
  sure(buttons.length === 1 && mm.length === 1, `${buttons.length} buttons and ${mm.length} multi_managers named ${j.name}; one of each`);
  sure(cells.every((e) => mm[0][e.targetname] !== undefined), "the multi_manager fires every cell's door");
  // nothing else fires a cell
  const firing = E.filter((e) => e !== mm[0] && (cells.some((c) => e.target === c.targetname) || (e.classname === "multi_manager" && cells.some((c) => e[c.targetname] !== undefined)))); // prettier-ignore
  sure(!firing.length, `the cells are fired by ${firing.map((e) => e.classname).join(", ")} too`);
  // the switch stands in the guard room, on its wall, at hand height
  const l = jailPlan.layouts.get("nexus");
  const b = JAIL_SITE.buildings[0];
  const [cx, cy] = [Math.floor(j.at[0] / 64) - b.at[0], Math.floor(j.at[1] / 64) - b.at[1]];
  const near = [[0, 0], [-1, 0], [0, -1], [-1, -1]].map(([dx, dy]) => l.storeyPlans[0].cells[cy + dy]?.[cx + dx]);
  sure(near.includes("guard"), `the jail's switch at ${j.at.join(" ")} is by no guard room's cell (${near.join(", ")})`);
});

// the level below the streets (below.mjs): mese-01 with a small sewer under its street (test/fixtures/mese-01-below.json)
const BELOW = JSON.parse(readFileSync(join(HERE, "fixtures/mese-01-below.json"), "utf8"));
test("assembly site: a level below: planned with its rules kept, its ways down cut through the street, its ladders and lids, every part reached", () => {
  const site = { ...siteSpec("mese-01"), below: BELOW };
  const p = planSite(site);
  sure(!p.failures.length, `the plan: ${p.failures.join(" | ")}`);
  const built = assembleSite(p, library, { style });
  sure(!built.report.failures.length, `assembled: ${built.report.failures.join(" | ")}`);
  const c = checkBelow(p, undefined, built.report.spawns);
  sure(!c.failures.length && c.measures.ways === 3 && c.measures.reached === c.measures.cells, `the level's rules: ${c.failures.join(" | ")} ${JSON.stringify(c.measures)}`); // prettier-ignore
  const b = built.report.below;
  sure(b.ways.length === 3 && b.ways.map((w) => w.kind).join() === "stair,manhole,drain", `ways: ${b.ways.map((w) => w.kind)}`);
  const E = built.map.entities;
  sure(E.filter((e) => e.classname === "func_ladder").length === 2, "a func_ladder in each shaft (the manhole's, the drain's)");
  const lids = E.filter((e) => e.classname === "func_door" && Number(e.spawnflags) & 256);
  sure(lids.length === 1 && E.some((e) => e.classname === "func_breakable" && Number(e.material) === 2), "the manhole's lid used, the drain's grate broken");
  sure(E.filter((e) => e.classname === "info_player_deathmatch").length === spawnsOf(planSite(siteSpec("mese-01"))).length, "the spawns are the street's, none below");
  // nothing over a shaft's opening at the street: no paving's or sky's brush covers its cell between -32 and 0 (a
  // stair's opening has the stair's own flights in it)
  const holes = b.ways.filter((w) => w.kind !== "stair").map((w) => [w.at[0] * 64 + 32, w.at[1] * 64 + 32]);
  sure(b.holes.length === 10, `${b.holes.length} cells opened at the street, 10 wanted (the stair's 8, the manhole's, the drain's)`);
  const covers = (br, [x, y]) => {
    const { min: lo, max: hi } = shapeOf(br);
    return x > lo[0] && x < hi[0] && y > lo[1] && y < hi[1] && hi[2] > -32 && lo[2] < 0 && hi[2] <= 0;
  };
  sure(holes.length === 2 && holes.every((h) => !built.map.brushes.some((br) => covers(br, h))), `a way's opening is closed at the street: ${holes.length} holes`);
  sure(writeMap(assembleSite(p, library, { style }).map) === writeMap(built.map), "the same level gave two different maps");
  // the description's own sentences
  sure(readBelow({ size: [32, 28], below: { ...BELOW, floor: -200 } }).some((f) => /the ground the street stands on/.test(f)), "a floor too high is refused");
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
