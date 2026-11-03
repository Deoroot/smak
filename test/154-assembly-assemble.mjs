// levels/assembly, part A: the assembler (assemble.mjs) and its command (levels/tools/assemble.mjs). Without the
// compilers: house-01 (seed 3) assembled from the pieces of pieces/hl, a piece on every edge of the layout by its kind
// (none inside the stairwell, which the stair piece owns), a corner at every vertex where walls meet, a floor under
// every cell but the stairwell's upper storey, the roof over the top one, and every piece standing on its storey's
// floor (z = base + storey * 192); the stair's connectors on the layout's foot and top cells for every foot; the same
// layout gives the same .map, letter for letter; and a broken layout (a door's edge moved off the wall its rooms
// share) fails by its sentence. Each doorway is ONE piece over its two edges, turned into the room its leaf swings
// into, with no corner post at its middle vertex; the walk map has every leaf as a world brush where it stands open,
// and a map whose leaves were removed instead is told apart by its sentence; the old door (36 clear, its open leaf
// standing in the opening) fails doorwayOf's 48. With VHLT (named in VHLT_DIR) and Half-Life's halflife.wad (in
// HL_WAD): the old door built into house-01 fails the standing player's trace through it by its sentence, and the
// command compiles house-01 with no leak, walks to every target on the walk map and ends PASS (skipped with a note
// otherwise).
import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test, testAsync, sure, sureEach, tmp, HERE } from "./helper.mjs";
import { layoutOf, cellsAcross, edgeKey } from "../levels/assembly/layout.mjs";
import { loadLibrary, placed, connectorsOf, doorwayOf } from "../levels/assembly/library.mjs";
import { assemble, edgeFrame, doorwaysOf, walkMapProblems, doorwayClearance } from "../levels/assembly/assemble.mjs";
import { writeMap, shapeOf, box } from "../src/maps/source.mjs";
import { findCompilers, compileMap, COMPILERS_VARIABLE } from "../src/maps/compile.mjs";
import { readBsp } from "../src/maps/bsp.mjs";
import { navAvailable } from "../levels/assembly/navwalk.mjs";

const SPEC = join(HERE, "../levels/specs/house-01.json");
const LIBRARY = join(HERE, "../levels/assembly/pieces/hl");
const house = () => JSON.parse(readFileSync(SPEC, "utf8"));
const copy = (v) => JSON.parse(JSON.stringify(v));
const say = (r) => r.report.failures.slice(0, 4).join(" | ") || "nothing (it passed)";
const library = loadLibrary(LIBRARY);
const layout = layoutOf(house(), { seed: 3 });
const built = assemble(layout, library);
const wellOf = (l) => new Set(l.stairwell.cells.map(([i, j]) => `${i},${j}`));
const inWell = (l, e) => cellsAcross(e).every(([i, j]) => wellOf(l).has(`${i},${j}`));
const zRange = (brushes) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of brushes) for (const f of shapeOf(b).faces) for (const p of f.polygon) (lo = Math.min(lo, p[2])), (hi = Math.max(hi, p[2])); // prettier-ignore
  return [lo, hi];
};

test("assembly: house-01 (seed 3) assembles with no failure, a piece on every edge by its kind", () => {
  sure(!layout.failures.length, layout.failures.join(" | "));
  sure(!built.report.failures.length, say(built));
  const want = {};
  for (const p of layout.storeyPlans) for (const e of p.edges) if (!inWell(layout, e)) want[e.kind] = (want[e.kind] ?? 0) + 1;
  const got = built.report.counts.kinds;
  for (const [kind, n] of Object.entries(want)) sure(got[kind] === n, `${kind}: the layout has ${n} edges outside the stairwell, the assembly placed ${got[kind] ?? 0}`); // prettier-ignore
  const byPiece = built.report.counts.pieces;
  const cells = layout.storeyPlans.reduce((n, p) => n + p.cells.flat().filter((v) => v !== null).length, 0);
  sure(byPiece.floor === cells - layout.stairwell.cells.length, `${byPiece.floor} floor pieces; the storeys have ${cells} cells, less the 8 of the stairwell's upper storey`); // prettier-ignore
  sure(byPiece["ceiling-roof"] === layout.size[0] * layout.size[1], `${byPiece["ceiling-roof"]} roof pieces`);
  sure(byPiece["stair-u"] === 1, `${byPiece["stair-u"]} stair pieces`);
  // a corner at every vertex where walls meet
  for (const p of layout.storeyPlans) {
    const walls = new Set(p.edges.filter((e) => e.kind !== "rail" && !inWell(layout, e)).map(edgeKey));
    const middles = new Set(doorwaysOf(layout).filter((d) => d.storey === p.storey).map((d) => d.at.join(",")));
    const corners = new Set(built.report.placements.filter((q) => q.kind === "corner" && q.storey === p.storey).map((q) => q.vertex.join(","))); // prettier-ignore
    for (let y = 0; y <= layout.size[1]; y++)
      for (let x = 0; x <= layout.size[0]; x++) {
        const meet = !middles.has(`${x},${y}`) && [[[x, y], [x, y + 1]], [[x, y], [x + 1, y]], [[x, y - 1], [x, y]], [[x - 1, y], [x, y]]].some(([a, b]) => walls.has(edgeKey({ from: a, to: b }))); // prettier-ignore
        sure(meet === corners.has(`${x},${y}`), `storey ${p.storey}: the vertex ${x},${y} ${meet ? "has walls and no corner" : "has a corner and no wall"}`); // prettier-ignore
      }
  }
  // the lamps: every room has one at least
  sureEach(layout.rooms, "the rooms", (r) => sure(built.report.lamps.some((l) => l.room === r.id && l.kind === "ceiling"), `room ${r.id} has no ceiling lamp`)); // prettier-ignore
});

test("assembly: every piece stands on its storey's floor, and nothing stands on an edge inside the stairwell", () => {
  for (const q of built.report.placements) {
    if (q.piece === "filler") continue;
    const floor = layout.base[2] + q.storey * layout.storeyHeight;
    sure(q.at[2] === floor, `${q.piece} on storey ${q.storey} is placed at z ${q.at[2]}; its storey's floor is at ${floor}`);
    for (const e of q.edges ?? (q.edge ? [q.edge] : [])) sure(!inWell(layout, e), `${q.piece} stands on the edge ${edgeKey(e)} inside the stairwell`); // prettier-ignore
    if (q.slot === "lamp") continue;
    // its brushes: from its floor (a slab or a threshold 16 under it) and no lower
    const piece = library.pieces.get(q.piece);
    const got = placed(piece, { at: q.at, turn: q.turn });
    const [lo] = zRange([...got.brushes, ...got.entities.flatMap((e) => e.brushes ?? [])]);
    sure(lo === floor || lo === floor - 16 || (q.piece === "ceiling-roof" && lo === floor + 176), `${q.piece} on storey ${q.storey} reaches down to z ${lo}; its floor is at ${floor}`); // prettier-ignore
  }
  // no wall or rail of the layout's inside the stairwell got a piece
  const inside = layout.storeyPlans.flatMap((p) => p.edges.filter((e) => inWell(layout, e)));
  sure(inside.length >= 1, "the layout has no edge inside the stairwell to leave out (its rail)");
});

test("assembly: the stair's foot and top land on the layout's bottom and top cells, for every foot", () => {
  const stair = library.pieces.get("stair-u");
  for (const seed of [1, 2, 3]) {
    const l = layoutOf(house(), { seed });
    const r = assemble(l, library);
    sure(!r.report.failures.length, `seed ${seed}: ${say(r)}`);
    const q = r.report.placements.find((p) => p.piece === "stair-u");
    const cs = connectorsOf(stair, { at: q.at, turn: q.turn });
    const cell = (c) => [Math.floor((c.at[0] - c.facing[0] * 32) / 64), Math.floor((c.at[1] - c.facing[1] * 32) / 64)];
    const foot = cs.find((c) => c.type === "stair-foot");
    const top = cs.find((c) => c.type === "stair-top");
    sure(cell(foot).join() === l.stairwell.bottom.join() && foot.at[2] === 0, `seed ${seed} (foot ${l.stairwell.foot}): the stair's foot is on ${cell(foot)} at z ${foot.at[2]}; the layout's bottom is ${l.stairwell.bottom}`); // prettier-ignore
    sure(cell(top).join() === l.stairwell.top.join() && top.at[2] === 192, `seed ${seed} (foot ${l.stairwell.foot}): the stair's top is on ${cell(top)} at z ${top.at[2]}; the layout's top is ${l.stairwell.top}`); // prettier-ignore
  }
});

test("assembly: the same layout gives the same .map, letter for letter", () => {
  const a = writeMap(assemble(layoutOf(house(), { seed: 3 }), library).map);
  const b = writeMap(assemble(layoutOf(house(), { seed: 3 }), loadLibrary(LIBRARY)).map);
  sure(a === b, "two assemblies of one layout wrote different .map files");
  sure(/"wad" "\\half-life\\valve\\halflife\.wad"/.test(a), "the worldspawn does not name halflife.wad");
  sure(/"classname" "light_environment"/.test(a) && /"_diffuse_light"/.test(a), "no sun with a sky's diffuse light");
  sure(/"classname" "info_player_start"/.test(a), "no place to start");
});

test("assembly: an edge frame turns a piece's +y to the side asked", () => {
  const h = { from: [2, 3], to: [3, 3] };
  const v = { from: [2, 3], to: [2, 4] };
  sure(JSON.stringify(edgeFrame(h, 1)) === '{"at":[2,3],"turn":0}', JSON.stringify(edgeFrame(h, 1)));
  sure(JSON.stringify(edgeFrame(h, 0)) === '{"at":[3,3],"turn":180}', JSON.stringify(edgeFrame(h, 0)));
  sure(JSON.stringify(edgeFrame(v, 0)) === '{"at":[2,3],"turn":90}', JSON.stringify(edgeFrame(v, 0)));
  sure(JSON.stringify(edgeFrame(v, 1)) === '{"at":[2,4],"turn":270}', JSON.stringify(edgeFrame(v, 1)));
});

test("assembly: a door's edge moved off the wall its rooms share fails by its sentence", () => {
  const l = copy(layout);
  const door = l.doors.find((d) => d.storey === 0);
  const plan = l.storeyPlans[0];
  const at = (e) => cellsAcross(e).map(([i, j]) => plan.cells[j]?.[i] ?? null);
  // an interior wall between two rooms, not the two the door joins
  const other = plan.edges.find((e) => e.kind === "interior" && !inWell(l, e) && !at(e).every((r) => door.rooms.includes(r))); // prettier-ignore
  const old = plan.edges.find((e) => edgeKey(e) === edgeKey(door.edges[1]));
  old.kind = "interior";
  other.kind = "door";
  other.rooms = [...door.rooms];
  door.edges[1] = { from: other.from, to: other.to };
  const r = assemble(l, library);
  const where = `${other.from.join(",")} to ${other.to.join(",")} on storey 0`;
  sure(r.report.failures.some((f) => f.includes(`the door edge ${where}`) && f.includes("it wants the 2 rooms it joins")), say(r)); // prettier-ignore
});

test("assembly: each doorway is one piece over its two edges, its +y into the room it swings into, no post at its middle", () => { // prettier-ignore
  for (const seed of [1, 2, 3]) {
    const l = layoutOf(house(), { seed });
    const r = assemble(l, library);
    sure(!r.report.failures.length, `seed ${seed}: ${say(r)}`);
    const list = doorwaysOf(l);
    sure(list.length === l.doors.length + 1 && r.report.doorways.length === list.length, `seed ${seed}: ${r.report.doorways.length} doorways placed, the layout has ${list.length}`); // prettier-ignore
    for (const d of list) {
      const keys = d.edges.map(edgeKey);
      const on = r.report.placements.filter((q) => q.storey === d.storey && [...(q.edges ?? []), ...(q.edge ? [q.edge] : [])].some((e) => keys.includes(edgeKey(e)))); // prettier-ignore
      sure(on.length === 1 && ["wall-door", "wall-entrance"].includes(on[0].piece), `seed ${seed}, ${d.name}: ${on.map((q) => q.piece).join(", ") || "nothing"} on its edges; it wants one door piece over both`); // prettier-ignore
      sure(!r.report.placements.some((q) => q.storey === d.storey && q.kind === "corner" && q.vertex.join() === d.at.join()), `seed ${seed}, ${d.name}: a corner post at its middle`); // prettier-ignore
      // the leaf's side: the two cells in front of the doorway's middle, along the piece's +y, are the swing room
      const where = r.report.doorways.find((x) => x.name === d.name);
      for (const s of [-0.5, 0.5]) {
        const c = [0, 1].map((k) => Math.floor(d.at[k] + where.into[k] * 0.5 + where.along[k] * s));
        const v = l.storeyPlans[d.storey].cells[c[1]][c[0]];
        sure(v === d.swing, `seed ${seed}, ${d.name}: its piece's +y looks into ${v} (cell ${c}); its leaf swings into ${d.swing}`); // prettier-ignore
      }
      // its open leaf stands beside the opening (32 or more from its middle, along the wall), not in it
      const [lo, hi] = where.leaf;
      const k = Math.abs(where.along[0]) > 0.5 ? 0 : 1;
      const m = where.middle[k];
      sure(hi[k] <= m - 32 + 1e-6 || lo[k] >= m + 32 - 1e-6, `seed ${seed}, ${d.name}: its open leaf (${lo} to ${hi}) stands within 32 of the opening's middle`); // prettier-ignore
    }
    // no sconce on a doorway's edges
    for (const lamp of r.report.lamps.filter((x) => x.kind === "wall"))
      sure(!list.some((d) => d.storey === lamp.storey && d.edges.some((e) => edgeKey(e) === edgeKey(lamp.edge))), `seed ${seed}: a sconce on the doorway edge ${edgeKey(lamp.edge)}`); // prettier-ignore
  }
});

const walk = assemble(layout, library, { open: true });
test("assembly: the walk map has every leaf as a world brush where it stands open; a map with the leaves REMOVED is told apart", () => { // prettier-ignore
  sure(!walk.report.failures.length, say(walk));
  const problems = walkMapProblems(walk);
  sure(!problems.length, problems.join(" | "));
  sure(!/"classname" "func_door_rotating"/.test(writeMap(walk.map)), "the walk map still has a func_door_rotating");
  sure(/"classname" "func_door_rotating"/.test(writeMap(built.map)), "the lit map has no func_door_rotating");
  sure(walk.report.doorways.length === 7 && walk.report.doorways.every((d) => d.leaf), "a doorway with no leaf");
  // the walk tests' old way: the door entities taken away, nothing in their place
  const removed = { ...built, map: { ...built.map, entities: built.map.entities.filter((e) => e.classname !== "func_door_rotating") }, report: { ...built.report, open: true } }; // prettier-ignore
  const said = walkMapProblems(removed);
  sure(said.length === walk.report.doorways.length && said.every((s) => s.includes("its leaf is not in the walk map as a world brush at its open position")), said.join(" | ")); // prettier-ignore
  console.log(`      the leaves removed: ${said[0]}`);
  // and the lit map, its doors closed, is no walk map
  sure(walkMapProblems(built).some((s) => s.includes("door entities")), walkMapProblems(built).join(" | "));
});

/** The old door, as house-01 had it in the game: a jamb narrowing the opening to 36, the leaf open standing in it. */
const oldDoor = (lib) => {
  const door = lib.pieces.get("wall-door");
  const jamb = box([32, -8, 0], [56, 8, 112], lib.palette.wall ?? "FIFTIES_WALL14A");
  const piece = { ...door, map: { ...door.map, brushes: [...door.map.brushes, jamb] }, open: { ...door.open, box: [[56, 10, 1], [60, 74, 111]] } }; // prettier-ignore
  return { ...lib, pieces: new Map([...lib.pieces, ["wall-door", piece]]) };
};
test("assembly: the old door (36 clear, its open leaf standing in the opening) fails doorwayOf's 48 by its sentence", () => {
  const got = doorwayOf(oldDoor(library).pieces.get("wall-door"), { want: [48, 72] });
  sure(got.width < 48 && got.failures.some((f) => f.includes("48 wanted")), JSON.stringify(got));
  console.log(`      ${got.failures[0]}`);
  const good = doorwayOf(library.pieces.get("wall-door"), { want: [48, 72] });
  sure(!good.failures.length && good.width >= 64, JSON.stringify(good));
});

// ── with the compilers ──
const wad = process.env.HL_WAD;
const compilers = process.env[COMPILERS_VARIABLE] ? findCompilers() : { found: false };
if (!compilers.found || !wad || !existsSync(wad) || !(await navAvailable()))
  console.log(`skip  the assembled house compiled and walked\n      skipped: it wants VHLT in ${COMPILERS_VARIABLE}, Half-Life's halflife.wad in HL_WAD and the npm package recast-navigation`); // prettier-ignore
else {
  await testAsync("assembly: the old door built into house-01 stops a standing player in its doorway, by its sentence", "old door traced", async () => { // prettier-ignore
    const folder = join(tmp, "old-door");
    mkdirSync(folder, { recursive: true });
    const lib = oldDoor(library);
    const bad = assemble(layout, lib, { open: true });
    sure(!walkMapProblems(bad).length, walkMapProblems(bad).join(" | "));
    const file = join(folder, "old-door.map");
    writeFileSync(file, writeMap(bad.map));
    const c = compileMap(file, { wads: [wad], compilers: { folder: compilers.folder ?? process.env[COMPILERS_VARIABLE] }, light: false, vis: false }); // prettier-ignore
    sure(c.bsp && !c.errors.length, c.errors.join(" | "));
    const traced = doorwayClearance(readBsp(readFileSync(c.bsp)), bad, lib);
    for (const d of bad.report.doorways.filter((x) => x.piece === "wall-door"))
      sure(traced.failures.some((f) => f.startsWith(`${d.name}: a standing player does not pass`)), `${d.name} was not stopped: ${traced.failures.join(" | ")}`); // prettier-ignore
    const entrance = traced.doorways.find((d) => d.piece === "wall-entrance");
    sure(entrance.clear >= 63 && !entrance.blocked, `the entrance (the good piece) is ${entrance.clear} clear: ${entrance.blocked}`); // prettier-ignore
    console.log(`      ${traced.failures.find((f) => f.includes("does not pass"))}`);
  });
  await testAsync("assembly: the command compiles house-01 with no leak, every target walked to on the walk map, and ends PASS", "assemble house-01", async () => { // prettier-ignore
    const out = join(tmp, "assembled");
    const run = spawnSync(process.execPath, [join(HERE, "../levels/tools/assemble.mjs"), SPEC, "--seed", "3", "--out", out, "--wad", wad, "--vhlt", compilers.folder ?? process.env[COMPILERS_VARIABLE]], { encoding: "utf8" }); // prettier-ignore
    const last = run.stdout.trim().split("\n").pop();
    sure(run.status === 0 && last.startsWith("PASS: house-01.json seed 3"), `${last}\n${run.stderr}`);
    const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    sure(!report.checks.compile.leak && report.checks.compile.bsp, "no .bsp, or a leak");
    sure(report.checks.navwalk.reached === report.checks.navwalk.of && report.checks.navwalk.of >= 20, JSON.stringify(report.checks.navwalk)); // prettier-ignore
    sure(!report.checks.reach.missed.length, report.checks.reach.missed.join(", "));
    sure(!report.checks.views.mismatches.length, report.checks.views.mismatches.join("; "));
    sure(!report.checks.walkMap.problems.length && /walk/.test(report.checks.navwalk.map) && /walk/.test(report.checks.reach.map), JSON.stringify(report.checks.walkMap.problems)); // prettier-ignore
    sure(report.checks.doorways.length === 7 && report.checks.doorways.every((d) => d.clear >= 48 && !d.blocked), JSON.stringify(report.checks.doorways)); // prettier-ignore
    sure(!/func_door_rotating/.test(readFileSync(join(out, "house-walk.map"), "utf8")) && /func_door_rotating/.test(readFileSync(join(out, "house.map"), "utf8")), "the walk map has door entities, or the lit map none"); // prettier-ignore
    for (const f of ["house.map", "house.bsp", "house-walk.map", "house-walk.bsp", "views/open/eye-s0-entrance-hall-from-outside.png", "layout.json", "storey-0.txt", "storey-1.txt", "views/cutaway-s0.png", "views/plan-s1.png", "views/light-s0.png"]) sure(existsSync(join(out, f)), `no ${f}`); // prettier-ignore
  });
}
