// levels/assembly/roofs.mjs on levels/specs/roofs-test.json: eight buildings round a street (five shells, three with
// interiors, one of them with a tower), seven of their roofs walked, joined to the street and to each other: ladders (two from
// the street, one from a terrace), a crate climb, an outside stair, a drop onto the terrace; jumps (112, down 192, 48), planks
// (176), a bridge over the street (304). Planned: every way and link read, the numbers held (checkRoofs says nothing), the
// roofs reached and left, openings left in the rails exactly where a way or link meets them. Assembled: the ladders, stair
// steps, crates, planks and bridge are there and sized as the rules say; the rail is clip everywhere else. In the RP
// contract the roofs are for players: none in the walking graph, the stair alone open to a guard's chase. Each link is then
// walked alone with the kit's walk test (`reachOf`, over the source map: ladders climbed, jumps with `jump`): a plank and a
// bridge are crossed on foot, a jump reaches its roof only with `jump`. With VHLT and the three wads the map is compiled: no
// leak, and in the compiled hulls the rails are open at the ways and links and shut elsewhere, the planks and the bridge
// are floor from roof to roof, the jumps are gaps a run crosses (JUMP_REACH) at equal or lower height, the ladders have
// their func_ladder from the street to over the roof. The broken cases are in test/broken/levels.mjs.
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { test, testAsync, sure, HERE } from "./helper.mjs";
import { planSite, assembleSite } from "../levels/assembly/site.mjs";
import { loadLibrary } from "../levels/assembly/library.mjs";
import { ROOF_RAIL } from "../levels/assembly/shell.mjs";
import { ROOF, checkRoofs, checkRoofsRp, roofsContract, roofsPicture, roofOpenings, planRoofs } from "../levels/assembly/roofs.mjs";
import { rpContract } from "../levels/rp/contract.mjs";
import { writeMap, shapeOf } from "../src/maps/source.mjs";
import { reachOf, JUMP_REACH, JUMP_HEIGHT } from "../src/maps/reach.mjs";

const cache = join(tmpdir(), "smak-roofs-layouts");
const spec = JSON.parse(readFileSync(join(HERE, "../levels/specs/roofs-test.json"), "utf8"));
const plan = planSite(spec, { cache });
const library = loadLibrary(join(HERE, "../levels/assembly/pieces/mese"));
const R = (id) => plan.roofs.roofs.get(id);
const W = (id) => plan.roofs.ways.find((w) => w.id === id);
const L = (id) => plan.roofs.links.find((l) => l.id === id);

test("assembly roofs: the site plans with no failure; seven roofs walked, at 576 (n1, a tower) and 384", () => {
  sure(!plan.failures.length, `plan: ${plan.failures.join(" | ")}`);
  const walked = [...plan.roofs.roofs.values()].filter((r) => r.walk);
  sure(walked.map((r) => r.id).join() === "n1,n2,n3,n4,s1,s2,s3", `walked: ${walked.map((r) => r.id)}`);
  sure(R("n1").top === 576 && walked.filter((r) => r.id !== "n1").every((r) => r.top === 384), "heights");
  sure(!R("s4").walk, "s4's roof is closed");
  sure(plan.site.buildings.filter((b) => b.roof === "walk" && b.program !== "shell").length === 3 && plan.site.buildings.filter((b) => b.roof === "walk" && b.program === "shell").length === 4, "shells and buildings with interiors"); // prettier-ignore
});

test("assembly roofs: checkRoofs says nothing; every way and link is as the rules say; every roof is reached and left", () => {
  const c = checkRoofs(plan);
  sure(!c.failures.length && !c.warnings.length, `checkRoofs: ${[...c.failures, ...c.warnings].join(" | ")}`);
  sure(c.measures.walked === 7 && c.measures.reached === 7 && c.measures.ways === 6 && c.measures.links === 6, JSON.stringify(c.measures));
  sure(plan.roofs.ways.every((w) => w.ok) && plan.roofs.links.every((l) => l.ok), "a way or link not ok");
  // the gaps and heights, in units, as the design says
  const gaps = Object.fromEntries(plan.roofs.links.map((l) => [l.id, [l.gap, l.d]]));
  sure(JSON.stringify(gaps) === JSON.stringify({ J1: [112, 0], P1: [176, 0], B1: [304, 0], J2: [112, -192], P2: [176, 0], J3: [48, 0] }), JSON.stringify(gaps)); // prettier-ignore
  for (const l of plan.roofs.links) {
    if (l.kind === "plank") sure(l.gap >= ROOF.plankFrom && l.gap <= ROOF.plank.longest && l.width >= 32 && l.width <= 48, `plank ${l.id}`);
    if (l.kind === "jump") sure(l.gap <= ROOF.jumpMost && l.d <= ROOF.step && -l.d <= ROOF.fallMost, `jump ${l.id}`);
    if (l.kind === "bridge") sure(l.span === 2 && l.gap <= ROOF.bridge.longest && Math.abs(l.d) <= ROOF.step, `bridge ${l.id}`);
  }
  // a stair of risers 16 at the most; a crate climb of steps 32 to 48
  sure(W("S1").rise / W("S1").steps <= ROOF.riser && W("S1").steps === 24, `stair ${W("S1").rise} in ${W("S1").steps}`);
  const step = W("C1").rise / W("C1").steps;
  sure(step >= ROOF.crate.least && step <= ROOF.crate.most && W("C1").steps === 10, `crates ${step}`);
  sure(W("D1").rise === 192 && W("L3").foot === 192 && W("L2").rise === 576, `drop ${W("D1").rise}, L3 from ${W("L3").foot}, L2 ${W("L2").rise}`);
});

test("assembly roofs: the rails are open exactly where a way or a link meets them", () => {
  const open = roofOpenings(plan);
  const cut = (id, side) => [...(open.get(id)?.[side] ?? [])].sort((a, b) => a - b).join();
  sure(cut("s1", "south") === "3" && cut("s1", "east") === "3", `s1: ${cut("s1", "south")} / ${cut("s1", "east")}`);
  sure(cut("s2", "west") === "3" && cut("s2", "east") === "3" && cut("s2", "south") === "" && cut("s2", "north") === "2,3", `s2: ${cut("s2", "north")}`); // (the bridge's two cells)
  sure(cut("n2", "south") === "2,3" && cut("n2", "west") === "3" && cut("n2", "east") === "3" && cut("n2", "north") === "1,4", `n2: ${cut("n2", "north")}`);
  sure(cut("n1", "west") === "2" && cut("n1", "east") === "3", `n1: ${cut("n1", "west")} / ${cut("n1", "east")}`);
  sure(cut("n3", "north") === "0" && cut("n3", "west") === "3" && cut("n3", "east") === "2", `n3: ${cut("n3", "north")}`);
  sure(cut("s3", "south") === "0" && cut("s3", "west") === "3", `s3: ${cut("s3", "south")}`);
  sure(cut("n4", "west") === "2", `n4: ${cut("n4", "west")}`);
});

const built = assembleSite(plan, library, {});
const brushes = built.map.brushes;
const shapes = brushes.map(shapeOf);

test("assembly roofs: assembled with no failure; the ladders, stair steps, crates, planks and bridge are there as planned", () => {
  sure(!built.report.failures.length, `assembled: ${built.report.failures.join(" | ")}`);
  const c = built.report.roofs.counts;
  sure(c.ladder === 3 && c["stair-step"] === 24 && c.crate === 9 && c.plank === 2 && c.bridge === 1 && c.jump === 3, JSON.stringify(c));
  // each ladder's func_ladder runs from the ground it stands on to 16 over the roof
  const ladders = built.map.entities.filter((e) => e.classname === "func_ladder").map((e) => shapeOf(e.brushes[0]));
  const roofLadders = ladders.filter((s) => s.max[2] > 300 && s.max[2] <= 576 + ROOF.ladderOver);
  sure(roofLadders.length === 3, `${roofLadders.length} ladders to roofs`);
  sure(roofLadders.filter((s) => s.min[2] === 0 && s.max[2] === 384 + 16).length === 1 && roofLadders.filter((s) => s.min[2] === 0 && s.max[2] === 576 + 16).length === 1 && roofLadders.filter((s) => s.min[2] === 192 && s.max[2] === 384 + 16).length === 1, JSON.stringify(roofLadders)); // prettier-ignore
  // the stair: 23 steps and the landing, each 16 over the one below (S1: s3's south wall, x 1344 on, y 440 to 504)
  const stair = shapes.filter((s) => s.min[0] >= 1344 - 1 && s.max[0] <= 1344 + 64 + 23 * 16 + 1 && s.min[1] >= 448 - 1 && s.max[1] <= 504 + 1 && s.min[2] === 0 && s.max[2] > 0 && s.max[2] <= 384);
  const tops = [...new Set(stair.map((s) => s.max[2]))].sort((a, b) => b - a);
  sure(tops.length === 24 && tops[0] === 384 && tops.every((t, i) => i === 0 || tops[i - 1] - t === 16), `stair tops ${tops.join(" ")}`);
  // the crates: nine boxes, each at most 48 over the one below, the top one 38 under the roof
  const crates = brushes.filter((b) => b.faces.every((f) => f.texture === "xcrate10a")).map(shapeOf).sort((a, b) => b.max[2] - a.max[2]);
  sure(crates.length === 9, `${crates.length} crates`);
  const heights = [384, ...crates.map((s) => s.max[2]), 0];
  sure(heights.every((h, i) => i === 0 || (heights[i - 1] - h >= 32 && heights[i - 1] - h <= 48)), `crate heights ${heights.join(" ")}`);
  // the planks: 36 and 40 wide, 8 thick, their top at the roofs' level; the bridge deck 128 wide, 16 thick
  const plank = shapes.filter((s) => s.max[2] === 384 && s.min[2] === 376);
  sure(plank.length >= 2, `planks ${plank.length}`);
  const p1 = plank.find((s) => s.min[0] === 1150 && Math.abs(s.max[1] - s.min[1] - 40) < 1e-6) ?? plank.find((s) => Math.abs(s.max[1] - s.min[1] - 40) < 1e-6 && s.max[0] - s.min[0] > 170);
  sure(p1 && p1.max[0] - p1.min[0] === 176 + 4, `P1 ${JSON.stringify(p1)}`);
  const deck = shapes.find((s) => s.min[2] === 368 && s.max[2] === 384 && s.max[0] - s.min[0] === 128);
  sure(deck && deck.max[1] - deck.min[1] === 304 + 4, `the deck ${JSON.stringify(deck)}`);
  // its clip rails: 64 high, along both sides
  const rails = shapes.filter((s) => s.min[2] === 384 && s.max[2] === 448 && s.max[0] - s.min[0] === 4 && s.max[1] - s.min[1] === 304);
  sure(rails.length === 2, `the bridge's clip rails ${rails.length}`);
});

test("assembly roofs: the rail is clip along the roof's open edges and open at the ways and links", () => {
  const clip = brushes.filter((b) => b.faces.every((f) => f.texture === "CLIP")).map(shapeOf).filter((s) => s.min[2] >= 384 && s.max[2] - s.min[2] === ROOF_RAIL.height);
  const covers = (x, y, z) => clip.some((s) => x > s.min[0] && x < s.max[0] && y > s.min[1] && y < s.max[1] && z > s.min[2] && z < s.max[2]);
  // s1 (x 128..576, y 512..960, top 384): its south edge is clip but at cell 3 (x 320..384); its east edge at cell 3 (y 704..768)
  sure(covers(160, 508, 410) && covers(290, 508, 410) && covers(420, 508, 410), "s1's south rail");
  sure(!covers(352, 508, 410), "s1's south rail is open at the ladder's cell");
  sure(covers(575, 540, 410) && !covers(575, 736, 410), "s1's east rail is open at J1's cell");
  // n1 (a tower, top 576): its west edge open at cell 2 (y 1344..1408), shut at 1
  sure(covers(60, 1300, 600) && !covers(60, 1440, 600), "n1's west rail");
  // the bridge's cells on n2's south edge: x 832..960 (cells 13 and 14)
  sure(covers(780, 1276, 410) && !covers(840, 1276, 410) && !covers(950, 1276, 410) && covers(980, 1276, 410), "n2's south rail at B1");
  // a closed roof has none (s4: x 1920..2368, y 512..960)
  sure(!covers(2000, 508, 410) && !covers(1916, 700, 410), "a rail on a closed roof");
});

test("assembly roofs: the roofs in the RP contract are for players: none in the walking graph, the stair alone for a guard's chase", () => {
  const contract = rpContract(plan, built);
  const r = contract.roofs;
  sure(r && r.roofs.length === 7 && r.ways.length === 6 && r.links.length === 6, JSON.stringify(Object.keys(r ?? {})));
  const npc = Object.fromEntries(r.ways.map((w) => [w.id, w.npc]));
  sure(npc.S1 === "chase" && ["L1", "L2", "L3", "C1", "D1"].every((id) => npc[id] === false) && r.links.every((l) => l.npc === false), JSON.stringify(npc));
  const c = checkRoofsRp(contract);
  sure(!c.failures.length && !c.warnings.length, `checkRoofsRp: ${c.failures.join(" | ")}`);
  // the graph holds no node on a roof, and no roaming spot or place on a way's ground
  const tops = new Map(r.roofs.map((q) => [q.building, q.top]));
  sure(contract.paths.nodes.every((n) => n.kind !== "roof" && !(n.building && tops.has(n.building) && n.at[2] >= tops.get(n.building))), "a node on a roof");
  const ground = new Set(r.ways.map((w) => `${Math.floor(w.at[0] / 64)},${Math.floor(w.at[1] / 64)}`));
  sure(contract.roam.every((q) => !ground.has(`${Math.floor(q.at[0] / 64)},${Math.floor(q.at[1] / 64)}`)), "a roaming spot on a way's cell");
});

test("assembly roofs: the plan picture is a PNG with the route drawn", () => {
  const png = roofsPicture(plan);
  sure(png[0] === 0x89 && png.toString("latin1", 1, 4) === "PNG" && png.length > 4000, `${png.length} bytes`);
  sure(typeof planRoofs(plan).openings.get("s1").south.has === "function", "planRoofs again");
});

// ── each link walked alone, with the kit's walk test over the source map ──
// A copy of the site with only the two roofs of one link walked, a ladder up to the first and the link: the second roof is
// reached by the link or by nothing. `walked(x, y, under)` is the floor a player walks at a place: the roof's own height.
const alone = (id, up) => {
  const s = structuredClone(spec);
  const l = s.roofs.links.find((q) => q.id === id);
  const ladderOn = up ?? l.from; // (the roof the ladder is on)
  for (const b of s.buildings) if (b.id !== l.from && b.id !== l.to) delete b.roof;
  s.roofs.links = [l];
  const side = "south"; // (the street side: the terrace behind the north block is no way in)
  for (let at = 0; at < 7; at++) {
    s.roofs.ways = [{ id: "W", kind: "ladder", building: ladderOn, side, at }];
    if (!planSite(s, { cache }).roofs.failures.some((f) => /way W/.test(f))) break;
  }
  return s;
};
for (const [id, onFoot, up] of [["J1", false], ["J2", false], ["J3", false], ["P1", true], ["P2", true], ["B1", true, "s2"]]) { // (B1's ladder is on s2: the bridge leaves n2's south wall too full for one)
  test(`assembly roofs: link ${id} (${spec.roofs.links.find((l) => l.id === id).kind}) walked alone: the far roof ${onFoot ? "is reached on foot" : "is reached only with a jump"}`, () => {
    const p = planSite(alone(id, up), { cache });
    const l = p.roofs.links[0];
    const A = p.roofs.roofs.get(up ?? l.from);
    const B = p.roofs.roofs.get(up ? l.from : l.to);
    const b = assembleSite(p, library, {});
    sure(!b.report.failures.length, `${id}: ${b.report.failures.join(" | ")}`);
    const at = (r) => [((r.x0 + r.x1) / 2) * 64, ((r.y0 + r.y1) / 2) * 64, r.top + 40];
    const foot = reachOf(b.map, { jump: false });
    const jump = reachOf(b.map, { jump: true });
    sure(foot.walked(...at(A)) === A.top, `${id}: the first roof is not reached by its ladder (${foot.walked(...at(A))})`);
    sure((foot.walked(...at(B)) === B.top) === onFoot, `${id}: on foot the far roof gives ${foot.walked(...at(B))} (its roof is at ${B.top})`);
    sure(jump.walked(...at(B)) === B.top, `${id}: with a jump the far roof gives ${jump.walked(...at(B))}`);
    if (l.kind === "jump") sure(l.gap + 32 <= JUMP_REACH && l.d <= JUMP_HEIGHT, `${id}: ${l.gap} across (+ the hull's 32) against the run's ${JUMP_REACH}`);
  });
}

// ── with the compilers ──
const VHLT = process.env.VHLT_DIR;
const wads = [process.env.TS_WAD, process.env.HL_WAD, process.env.MESE_WAD];
if (!VHLT || wads.some((w) => !w || !existsSync(w)))
  console.log("skip  the roofs compiled and measured in the hulls\n      skipped: it wants VHLT in VHLT_DIR and the three wads in TS_WAD, HL_WAD and MESE_WAD"); // prettier-ignore
else await testAsync("assembly roofs: compiled with no leak; in the hulls the rails are open at the ways and links, the planks and bridge are floor, the jumps are gaps a run crosses, the whole route is walked", "roofs compiled", async () => {
  const { compileMap } = await import("../src/maps/compile.mjs");
  const { readBsp, contentsAt, floorUnder, CONTENTS } = await import("../src/maps/bsp.mjs");
  const work = mkdtempSync(join(tmpdir(), "smak-roofs-"));
  const file = join(work, "smak_roofs_test.map");
  writeFileSync(file, writeMap(built.map));
  const r = compileMap(file, { wads, wadinclude: library.wadinclude, fast: true, timeout: 900000, compilers: { folder: VHLT } });
  sure(r.bsp && !r.leak, `compile: ${r.errors.join(" | ")}${r.leak ? " LEAK" : ""}`);
  const bsp = readBsp(readFileSync(r.bsp));
  const free = (x, y, z) => contentsAt(bsp, [x, y, z], { hull: 1 }) !== CONTENTS.SOLID;
  // a player standing on a roof (origin 37 over it) is held at the edge by the rail, and passes where it is open
  const edge = (id, side, cell) => {
    const q = R(id);
    const top = q.top + 37;
    const m = (a0, i) => (a0 + i + 0.5) * 64;
    const [x, y] = { south: [m(q.x0, cell), q.y0 * 64 - 4], north: [m(q.x0, cell), q.y1 * 64 + 4], west: [q.x0 * 64 - 4, m(q.y0, cell)], east: [q.x1 * 64 + 4, m(q.y0, cell)] }[side];
    return free(x, y, top);
  };
  const open = roofOpenings(plan);
  for (const [id, sides] of open) for (const [side, set] of Object.entries(sides)) for (const c of set) sure(edge(id, side, c), `${id} ${side} ${c}: the rail is shut where a way or link meets it`);
  for (const [id, side, cells] of [["s1", "south", [0, 1, 2, 4, 5, 6]], ["n2", "south", [0, 1, 4, 5, 6]], ["n3", "north", [1, 2, 3, 4, 5]], ["s2", "south", [0, 3, 6]]]) for (const c of cells) sure(!edge(id, side, c), `${id} ${side} ${c}: the rail is open where nothing meets it`); // prettier-ignore
  // planks and the bridge: the player's floor under every 8 units from roof to roof, at the roofs' height
  for (const id of ["P1", "P2", "B1"]) {
    const l = L(id);
    const A = R(l.from);
    const B = R(l.to);
    const mid = (l.at + l.span / 2) * 64;
    const [a0, a1] = l.along === 0 ? [(l.sa === "east" ? A.x1 : B.x1) * 64 - 16, (l.sa === "east" ? B.x0 : A.x0) * 64 + 16] : [(l.sa === "north" ? A.y1 : B.y1) * 64 - 16, (l.sa === "north" ? B.y0 : A.y0) * 64 + 16];
    for (let u = Math.min(a0, a1); u <= Math.max(a0, a1); u += 8) {
      const f = l.along === 0 ? floorUnder(bsp, [u, mid, A.top + 40], { hull: 1, reach: 60 }) : floorUnder(bsp, [mid, u, A.top + 40], { hull: 1, reach: 60 });
      sure(f !== null && Math.abs(f - (A.top + 36)) <= 2, `${id}: no floor at ${u} (${f})`);
    }
  }
  // jumps: floor on both roofs, none between, the gap the player's middle crosses within the run's reach; nothing over the lane
  for (const id of ["J1", "J2", "J3"]) {
    const l = L(id);
    const A = R(l.from);
    const B = R(l.to);
    const mid = (l.at + 0.5) * 64;
    const at = (u, z) => (l.along === 0 ? [u, mid, z] : [mid, u, z]);
    const dir = l.sa === "east" || l.sa === "north" ? 1 : -1;
    const lineA = l.along === 0 ? (l.sa === "east" ? A.x1 : A.x0) * 64 : (l.sa === "north" ? A.y1 : A.y0) * 64;
    // the middle of a player standing on a roof's top is 36 over it: it rests there, on that roof and not the other
    const on = (u, q) => {
      const f = floorUnder(bsp, at(u, q.top + 38), { hull: 1, reach: 12 });
      return f !== null && Math.abs(f - (q.top + 36)) < 1;
    };
    // from the near roof outwards: the last point with floor, then none, then floor again (on the far roof)
    let lastA = null;
    let firstB = null;
    for (let k = -96; k <= l.gap + 16 + 96 && firstB === null; k += 2) {
      const u = lineA + dir * k;
      const floor = on(u, A) || on(u, B);
      if (floor && lastA === (k === -96 ? null : k - 2)) lastA = k;
      else if (floor && lastA !== null) firstB = k;
    }
    sure(lastA !== null && firstB !== null, `${id}: no floor on one of the roofs (${lastA}, ${firstB}; ${l.sa}, ${l.along}, ${lineA}, ${mid})`);
    sure(firstB - lastA > 0 && firstB - lastA <= JUMP_REACH, `${id}: the player's middle crosses ${firstB - lastA}, a run carries ${JUMP_REACH}`);
    sure(B.top - A.top <= JUMP_HEIGHT, `${id}: ${B.top - A.top} up`);
    // nothing over the lane at the height a jump reaches, from the edge to the far roof
    for (let k = 0; k <= l.gap + 16; k += 8) sure(free(...at(lineA + dir * k, Math.max(A.top, B.top) + 37 + JUMP_HEIGHT)), `${id}: something over the lane at ${k}`);
    console.log(`      ${id}: the gap ${l.gap}, the player's middle crosses ${firstB - lastA} (a run carries ${JUMP_REACH}), ${B.top - A.top} up`);
  }
  // the route walked on the compiled map: every roof, and the terrace, the whole map
  const foot = reachOf(bsp, { jump: false });
  const jump = reachOf(bsp, { jump: true });
  const top = (id) => R(id).top;
  const at = (id) => [((R(id).x0 + R(id).x1) / 2) * 64, ((R(id).y0 + R(id).y1) / 2) * 64, top(id) + 40];
  for (const id of ["n1", "n2", "n3", "s1", "s2", "s3"]) sure(foot.walked(...at(id)) === top(id), `${id}'s roof is not walked on foot (${foot.walked(...at(id))})`);
  sure(foot.walked(...at("n4")) !== top("n4") && jump.walked(...at("n4")) === top("n4"), "n4's roof is reached only with a jump (J3)");
  sure(!foot.oneWay?.length && !jump.oneWay?.length, `one-way places: ${JSON.stringify(foot.oneWay)}`);
  console.log("      compiled with no leak; every roof walked on foot but n4's, which a jump reaches; no one-way place");
});
