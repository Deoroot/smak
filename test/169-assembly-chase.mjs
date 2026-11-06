// levels/assembly, what a city of chases wants (the rebuild of smak_rp_byz01, 2026-11-06): a second door between a
// shop's back room and its stair hall (`extraDoors`, a loop through the building that makes neither room a property
// of its own); a plain passage in a wall (`gaps`, the gate's frame with no leaf, joined in the walking graph); the
// glass of the ground storey not breakable (`groundGlass: "sealed"`); a stair hall or landing one cell across measured
// (style rule landingWidth, narrowCells); a sealed mission arena (arena.mjs) with the contract's names and its entry
// in the contract; and the guards' spawn points of a building with a control room (a police post). The broken cases
// of the new sentences are in test/broken/levels.mjs.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test, sure, HERE } from "./helper.mjs";
import { layoutOf, checkLayout } from "../levels/assembly/layout.mjs";
import { readBuilding, checkBuilding } from "../levels/assembly/building.mjs";
import { narrowCells } from "../levels/assembly/style.mjs";
import { loadStyle } from "../levels/assembly/style.mjs";
import { planSite, assembleSite, siteSpec, propertiesOf, checkSite, readSite, buildingOf } from "../levels/assembly/site.mjs";
import { loadLibrary } from "../levels/assembly/library.mjs";
import { arenasOf } from "../levels/assembly/arena.mjs";
import { rpContract } from "../levels/rp/contract.mjs";
import { checkPaths } from "../levels/rp/paths.mjs";

const SPEC = JSON.parse(readFileSync(join(HERE, "../levels/specs/mese-shop-a.json"), "utf8"));
const style = loadStyle("mese");
// (a shop of the Byzantine site: its walls leave room for the back door at seed 1; the Mese's small shop at none of 12)
const byz = readSite(siteSpec("byzantium-01")).site;
const m1 = buildingOf(byz, { ...byz.buildings.find((b) => b.id === "m1"), seed: 1 }, loadStyle("byzantium"));
const library = loadLibrary(join(HERE, "../levels/assembly/pieces/mese"));

test("chase: an extra door between the back room and the stair hall, where a wall allows one, with no failure and no property split", () => {
  sure(m1.extraDoors?.[0]?.join() === "back,hall", "backDoor: true does not give the building its extra door");
  const l = layoutOf(m1);
  sure(!l.failures.length, l.failures.join(" | "));
  const extra = l.doors.filter((d) => d.extra);
  sure(extra.length === 1 && extra[0].rooms.join() === "back,hall", `extra doors: ${JSON.stringify(extra.map((d) => d.rooms))}`);
  sure(!checkLayout(l, readBuilding(m1)).failures.length, checkLayout(l, readBuilding(m1)).failures.join(" | "));
  // the back room stays the shop's: the hall's own second door does not make it a property
  const props = propertiesOf(l, loadStyle("byzantium"));
  const shop = l.rooms.find((r) => r.kind === "shop").id;
  sure(props.get("back") === shop && props.get(shop) === shop, `properties ${JSON.stringify([...props])}`);
  sure(props.get("hall") === "hall", "the hall is not its own property");
  // the Mese's small shop has no wall for it at seed 1: no door, and a sentence saying so
  const small = layoutOf({ ...SPEC, extraDoors: [["back", "hall"]] }, { seed: 1 });
  sure(!small.doors.some((d) => d.extra) && small.warnings.some((w) => /extra door back-hall: no wall/.test(w)), "no sentence for a missing wall");
  // without it nothing changes: no door of the kind
  sure(!layoutOf(SPEC, { seed: 1 }).doors.some((d) => d.extra), "a layout with no extraDoors has an extra door");
});

test("chase: an extra door naming a room twice, a room that is not, or two storeys is refused by its sentence", () => {
  for (const [pair, what] of [[["back", "back"], /extra door \["back","back"\]: it wants a pair/], [["back", "nowhere"], /extra door \["back","nowhere"\]: it wants a pair/], [["back", "landing"], /extra door \["back","landing"\]: it wants a pair/], [["shop", "back"], /extra door shop-back is a door the description already has/]])
    sure(checkBuilding({ ...SPEC, extraDoors: [pair] }).failures.some((f) => what.test(f)), `${pair}: ${checkBuilding({ ...SPEC, extraDoors: [pair] }).failures.join(" | ")}`); // prettier-ignore
});

test("chase: narrowCells finds the cells of a hall or landing that are in no stretch 2 across, the stairwell's cells counting as the room's", () => {
  const cells = [
    ["la", "la", null, null],
    ["la", "la", "la", "la"],
    [null, null, null, "la"],
  ];
  sure(JSON.stringify(narrowCells(cells, "la")) === JSON.stringify([[2, 1], [3, 1], [3, 2]]), `narrow: ${JSON.stringify(narrowCells(cells, "la"))}`);
  const withStair = [["la", "stair"], ["la", "la"]];
  sure(!narrowCells(withStair, "la").length, "the stairwell's cell does not count as part of the room");
  sure(narrowCells([["la", "la"]], "la").length === 2, "a corridor of one row is narrow");
});

// ── the site: a wall with a gap, glass sealed ──
const spec = siteSpec("mese-01");
spec.walls = [{ name: "the test wall", from: [26, 11], to: [26, 17], gaps: [[26, 14]] }];
spec.groundGlass = "sealed";
const plan = planSite(spec);
const built = assembleSite(plan, library, { style });

test("chase: a gap in a wall is the gate's frame with no leaf: no door, no name, the street joined across it", () => {
  sure(!plan.failures.length && !built.report.failures.length, `${[...plan.failures, ...built.report.failures].join(" | ")}`);
  sure(built.report.counts.passage === 1 && !built.report.counts.checkpoint, `counts: ${JSON.stringify(built.report.counts)}`); // prettier-ignore
  sure(!built.report.doorways.some((d) => !d.building), "a gap is a doorway of the report");
  const contract = rpContract(plan, built);
  const checked = checkPaths(contract.paths, contract);
  sure(!checked.failures.length && checked.measures.components === 1, `paths: ${checked.failures.join(" | ")} ${checked.measures.components} pieces`);
  // (the street goes round the wall by its porticoes, so no piece is cut: the gap is held by the links across it)
  const closed = planSite({ ...spec, walls: [{ name: "the test wall", from: [26, 11], to: [26, 17] }] });
  const noGap = rpContract(closed, assembleSite(closed, library, { style }));
  sure(contract.paths.links.length > noGap.paths.links.length, `links with the gap ${contract.paths.links.length}, without ${noGap.paths.links.length}`);
});

test("chase: groundGlass sealed makes the ground storey's panes unbreakable and leaves the upper ones as they are", () => {
  const panes = built.map.entities.filter((e) => e.classname === "func_breakable");
  sure(panes.length > 10, `${panes.length} panes`);
  const z = (e) => Math.min(...e.brushes.flatMap((b) => b.faces.flatMap((f) => f.points.map((p) => p[2]))));
  const low = panes.filter((e) => z(e) < 96);
  const high = panes.filter((e) => z(e) >= 96);
  sure(low.length && low.every((e) => Number(e.spawnflags) === 1), `${low.filter((e) => Number(e.spawnflags) !== 1).length} of ${low.length} ground panes still break`);
  sure(high.length && high.every((e) => !Number(e.spawnflags)), `${high.filter((e) => Number(e.spawnflags)).length} of ${high.length} upper panes sealed`);
  const loose = assembleSite(plan, library, { style, groundGlass: "open" });
  sure(loose.map.entities.filter((e) => e.classname === "func_breakable").every((e) => !Number(e.spawnflags)), "groundGlass other than sealed seals a pane");
});

test("chase: every leaf has dmg 0; a home's is use-only and toggle with wait -1, the others use-only and swing back; one-way only on cells and gates", () => {
  const contract = rpContract(plan, built);
  const kindOf = new Map(contract.properties.flatMap((p) => p.doors.map((d) => [d, p.kind])));
  const leaves = built.map.entities.filter((e) => e.classname === "func_door_rotating");
  sure(leaves.length >= 20, `${leaves.length} leaves`);
  const seen = new Set();
  for (const e of leaves) {
    const kind = kindOf.get(e.targetname);
    seen.add(kind);
    sure(Number(e.dmg) === 0 && e.dmg !== undefined, `${e.targetname}: dmg ${e.dmg}`);
    const flags = Number(e.spawnflags);
    if (kind === "home") sure(flags === 288 && Number(e.wait) === -1, `home ${e.targetname}: spawnflags ${flags}, wait ${e.wait}`);
    else sure(flags === 256 && Number(e.wait) === 4, `${kind} ${e.targetname}: spawnflags ${flags}, wait ${e.wait}`); // prettier-ignore
  }
  sure(seen.has("home") && seen.has("shop") && seen.has("public"), `kinds seen: ${[...seen].join(" ")}`);
});

test("chase: an arena is a sealed room beside the city with the contract's names, and its entry is in the contract", () => {
  const site = { ...spec, arenas: [{ id: "yard", at: [-3072, 0, 0], size: [768, 768, 256], back: [[640, 576, 90], [704, 576, 90]] }] };
  const a = arenasOf(site, "smak_x");
  sure(!a.report.failures.length, a.report.failures.join(" | "));
  const names = a.entities.map((e) => e.targetname).filter(Boolean).sort();
  for (const w of ["spawn1", "spawn4", "back1", "back2", "goal", "button", "crate", "reset", "bell"]) sure(names.includes(`smak_x_arena_yard_${w}`), `no ${w}: ${names.join(" ")}`); // prettier-ignore
  sure(a.arenas[0].spawns.length === 4 && a.arenas[0].back.length === 2 && a.arenas[0].reset[0] === "smak_x_arena_yard_reset", JSON.stringify(a.arenas[0])); // prettier-ignore
  // out of every refusal: it is sealed (carve's rock on six sides) and inside +-4096
  sure(a.brushes.length >= 6 && a.entities.some((e) => e.classname === "func_breakable"), "no room or no crate");
  const withArena = assembleSite(planSite(site), library, { style });
  sure(withArena.report.arenas.length === 1 && withArena.report.counts.arena === 1, "assembleSite does not carry the arena");
  const contract = rpContract(planSite(site), withArena);
  sure(contract.arenas.length === 1 && contract.arenas[0].id === "yard", `contract arenas: ${JSON.stringify(contract.arenas)}`);
});

test("chase: a site with a police post: its guard room's cells and two outside its door are the guards' spawns", () => {
  // (the Byzantine style: it has the post's kinds, a counter, a guard room, a cell and an armory)
  const small = siteSpec("mese-01");
  small.style = "byzantium";
  const post = { id: "post", at: [10, 3], size: [7, 5], front: "north", program: "post", seed: 1, seeds: 6 };
  small.buildings = [...small.buildings.filter((b) => b.id !== "e"), post];
  const p = planSite(small);
  const l = p.layouts.get("post");
  sure(l && !l.failures.length, `the post: ${l?.failures.join(" | ")}`);
  const contract = rpContract(p, assembleSite(p, library, { style: loadStyle("byzantium") }));
  const mine = contract.spawns.filter((s) => s.building === "post");
  sure(mine.length >= 3 && mine.every((s) => s.role === "guard" && /^post_spawn\d$/.test(s.id)), `spawns: ${JSON.stringify(mine)}`);
  const kinds = new Map(contract.properties.filter((q) => q.building === "post").map((q) => [q.id, q.kind]));
  sure([...kinds.values()].includes("police") && [...kinds.values()].includes("jail"), `kinds: ${JSON.stringify([...kinds])}`);
});
