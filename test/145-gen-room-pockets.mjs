// Pockets (R2, the room caps held): a room alone in a piece of floor larger than its kind's cap (a pocket the fixed
// rectangles cut: a stair, a connector's column, a stage-4 post) takes a part under its cap and the rest is spare
// floor, taken by a neighbour with room under its own cap, made a corridor bay, or left unbuilt (a terrace where it is
// open above, else a closed void); a fixed room stood larger than its cap keeps the part against the lot's edge; a
// stair leaving a band too thin for a room is passed over; the kinds that soaked the floor are capped with their data.
// Each broken case fails by its sentence.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test, sure, HERE } from "./helper.mjs";
import { loadRules } from "../levels/lib/architecture-rules.mjs";
import { loadCity, stubLots } from "../levels/gen/common.mjs";
import { programsOf, checkPrograms, keptUnderCap } from "../levels/gen/programs.mjs";
import { planBuilding, checkPlans, pocketBetween } from "../levels/gen/plans.mjs";
import { searchZone, cappedWeights, capacityOf, edgesOf, SOFT_GIVE } from "../levels/gen/layout.mjs";
import { rngOf, G } from "../levels/gen/common.mjs";

const RULES = loadRules();
const raw = JSON.parse(readFileSync(join(HERE, "../levels/specs/newbyzantium.json"), "utf8"));
const copy = (v) => JSON.parse(JSON.stringify(v));
const says = (list, ...words) => {
  const hit = list.find((f) => words.every((w) => f.includes(w)));
  sure(hit, `nothing said ${JSON.stringify(words)}; said: ${list.slice(0, 4).join(" | ") || "nothing"}`);
};
const area = (l) => l.rects.reduce((s, r) => s + r.w * r.d, 0);

/** A zone of one storey (grid steps): a 60 x 40 floor, a connector's column filling its east third, `items` to lay. */
const zoneOf = (items, extra = {}) => {
  const rect = { x: 0, y: 0, w: 60, d: 40 };
  const front = { ...edgesOf(rect).find((e) => e.side === "s") };
  return {
    rect,
    fixed: [{ item: { id: "z.column", kind: "column", void: true, rank: 0, unit: null }, rect: { x: 40, y: 0, w: 20, d: 40 } }],
    items,
    front,
    exterior: edgesOf(rect),
    corridor: { allowed: false, widthG: 13, max: 0, p: 0, kind: "public" },
    corridorUnit: null,
    entranceOf: (leaves) => leaves.map((l, i) => (l.item?.hub && l.rects.some((r) => r.y === 0) ? i : -1)).filter((i) => i >= 0),
    doorKind: () => "interior",
    doorWidth: () => 1.22,
    privateThrough: new Set(),
    noPass: new Set(),
    maxRunG: 123,
    corridorCapG: (61 * 0.92) / (G * G),
    trials: 40,
    used: new Map(),
    shellRect: rect,
    ...extra,
  };
};
const itemOf = (id, kind, capM2, extra = {}) => ({ id, kind, weight: 800, minSideG: 16, minAreaG: 300, rank: 0, next: [], notNext: [], hardCapG: capM2 === null ? null : (capM2 * 0.92) / (G * G), maxAreaG: capM2 === null ? null : (capM2 * 0.92) / (G * G), room: { id, kind }, ...extra }); // prettier-ignore

test("pockets: the kinds that soaked the floor carry a cap from real data with their reason", () => {
  for (const k of ["office", "cell", "upper-hall", "lobby", "briefing", "gate", "lift-lobby", "guard-post", "interrogation", "armory", "living", "great-hall", "kitchen", "bedsit"]) { // prettier-ignore
    const r = RULES.roomKinds[k];
    sure(r.maxArea > r.minArea * 1.2, `${k}: maxArea ${r.maxArea}`);
    sure(/m2( real)? x the games' 2\.5 area factor = \d+ m2/.test(r.maxNote), `${k}: the maxNote does not say the real area and the factor`);
    sure(Number(r.maxNote.match(/= (\d+) m2/)[1]) === r.maxArea, `${k}: the maxNote's sum is not its maxArea`);
    for (const s of r.maxSource) sure(RULES.sources[s], `${k}: ${s} is not a source`);
    // a typical room (minArea x 1.45) fits under its cap: stage 3's targets never start past one
    sure(r.minArea * 1.45 <= r.maxArea, `${k}: typical ${r.minArea * 1.45} past its cap ${r.maxArea}`);
  }
});

test("pockets: a room alone in a pocket past its cap takes a part under it and leaves the rest spare", () => {
  // a lobby on the street, alone west of the column: 40 x 40 steps of floor against its cap of 60 m2 (about 1340 steps)
  const zone = zoneOf([itemOf("z.lobby", "lobby", 60, { hub: true, front: true, street: true })]);
  const best = searchZone(zone, rngOf("pockets"));
  const lobby = best.leaves.find((l) => l.item?.id === "z.lobby");
  sure(area(lobby) <= zone.items[0].hardCapG + 1e-6, `the lobby took ${area(lobby)} steps, its cap ${zone.items[0].hardCapG}`);
  sure(lobby.rects.some((r) => r.y === 0), "the lobby was cut off the street");
  const spare = best.leaves.filter((l) => l.orphan || l.bay);
  sure(spare.length && Math.abs(spare.reduce((s, l) => s + area(l), 0) + area(lobby) - 1600) < 1e-6, "the rest of the pocket is not spare floor");
  sure(best.why.every((w) => !/past its cap/.test(w)), `still past its cap: ${best.why.join(", ")}`);
  // broken: with no cap the same lobby fills the pocket (the cap made the cut, not the layout)
  const free = searchZone(zoneOf([itemOf("z.lobby", "lobby", null, { hub: true, front: true, street: true })]), rngOf("pockets"));
  sure(area(free.leaves.find((l) => l.item?.id === "z.lobby")) === 1600, "an uncapped lobby did not fill its pocket");
});

test("pockets: spare floor goes to a neighbour under its cap, never past it", () => {
  // two rooms west of the column, a capped one and an uncapped store: the store takes the capped room's spare floor
  const items = [itemOf("z.lobby", "lobby", 60, { hub: true, front: true, street: true }), itemOf("z.store", "storeroom", null, { rank: 1 })];
  const best = searchZone(zoneOf(items), rngOf("pockets-2"));
  const lobby = best.leaves.find((l) => l.item?.id === "z.lobby");
  sure(area(lobby) <= items[0].hardCapG + 1e-6, `the lobby took ${area(lobby)} steps`);
  sure(!best.leaves.some((l) => l.orphan), "spare floor was left where an uncapped neighbour could take it");
  // and both capped: the spare stays spare, neither passes its cap
  const both = [itemOf("z.lobby", "lobby", 30, { hub: true, front: true, street: true }), itemOf("z.office", "office", 30, { rank: 1 })];
  const b2 = searchZone(zoneOf(both), rngOf("pockets-3"));
  for (const it of both) sure(area(b2.leaves.find((l) => l.item?.id === it.id)) <= it.hardCapG + 1e-6, `${it.id} past its cap`);
});

test("pockets: the weights hold every room to its cap, the service rooms give a little first", () => {
  const items = [
    { id: "a.office", weight: 100, maxAreaG: 50, hardCapG: 50 },
    { id: "a.store", weight: 100, maxAreaG: 20, hardCapG: null },
  ];
  // on a floor they can hold: the office under its cap, the store under its use
  const out = cappedWeights(items, 60);
  const total = out.reduce((s, it) => s + it.weight, 0);
  const share = (it) => (it.weight / total) * 60;
  sure(share(out[0]) <= 50 + 1e-6 && share(out[1]) <= 20 + 1e-6, `the shares ${out.map(share)}`);
  // on a floor past what both may take: each weighed by its cap (the store's its use times SOFT_GIVE), so each passes
  // it by one share and the polish's pockets leave the rest spare beside each
  const over = cappedWeights(items, 200);
  sure(over[0].weight <= 50 && over[0].weight >= 40 && over[1].weight <= 20 * SOFT_GIVE && over[1].weight >= 20 * SOFT_GIVE * 0.8, `weights ${over.map((x) => x.weight)}`); // prettier-ignore
  sure(capacityOf(items) === 50 + 20 * SOFT_GIVE, `capacity ${capacityOf(items)}`);
  sure(capacityOf([...items, { id: "a.hall", weight: 10 }]) === Infinity, "an uncapped room gave the list a capacity");
});

test("pockets: a fixed room stood past its cap keeps the part against the lot's edge, quarter cells", () => {
  const lot = { x: 56, y: 54, w: 11, d: 9 };
  // the Nexus's post office: 3 x 3 cells on the street edge (95 m2) against the office's cap (70 m2 x 0.92 / 10.57 m2 a cell)
  const k = keptUnderCap({ x: 60.5, y: 54, w: 3, d: 3 }, lot, (70 * 0.92) / (3.2512 * 3.2512));
  sure(k && k.x === 60.5 && k.y === 54 && k.w === 3 && k.d === 2, `kept ${JSON.stringify(k)}`);
  // on the north edge it keeps the north part
  const n = keptUnderCap({ x: 60, y: 60, w: 2, d: 3 }, lot, 4);
  sure(n && n.y + n.d === 63 && n.d === 2, `kept ${JSON.stringify(n)}`);
  // broken: a cap under a quarter cell's strip leaves nothing to keep
  sure(keptUnderCap({ x: 60.5, y: 54, w: 3, d: 3 }, lot, 0.5) === null, "a room was kept under a quarter cell");
});

test("pockets: a stair leaving a band too thin for a room beside a column is passed over", () => {
  const col = { x: 136, y: 48, w: 38, d: 56 };
  sure(pocketBetween({ x: 132, y: 116, w: 42, d: 26 }, col), "a 12-step band under the column was allowed");
  sure(pocketBetween({ x: 132, y: 104, w: 42, d: 26 }, col), "a 4-step sliver beside the column was allowed");
  sure(!pocketBetween({ x: 136, y: 104, w: 38, d: 26 }, col), "a stair flush with the column was refused");
  sure(!pocketBetween({ x: 136, y: 130, w: 38, d: 26 }, col), "a stair a room's depth off the column was refused");
});

let programs = null;
test("pockets: the MSR's buildings and the homes laid under their caps, a room past one failing by its sentence", () => {
  const desc = loadCity();
  programs = programsOf(desc, stubLots(desc), RULES);
  sure(checkPrograms(programs, desc, RULES).ok, "the city's programs fail");
  for (const id of ["msr_barracks", "stacks_block_a"]) {
    const prog = programs.buildings.find((b) => b.id === id);
    let plan = null;
    let g = null;
    for (let k = 0; k < 4 && !g?.ok; k++) {
      plan = planBuilding(copy(prog), RULES, { seed: k ? `smak~${k}` : "smak", trials: 120 });
      g = checkPlans({ buildings: [plan] }, { buildings: [prog] }, RULES, { repeatTarget: 1 });
    }
    sure(g.ok, `${id}: ${g.failures.slice(0, 3).join(" | ")}`);
    for (const r of plan.rooms) if (RULES.roomKinds[r.kind]?.maxArea) sure(r.area_m2 <= RULES.roomKinds[r.kind].maxArea, `${r.id}: ${r.area_m2} m2`);
    // broken: the barracks' briefing room grown past its cap, a flat's living room past its own
    const bad = copy(plan);
    const kind = id === "msr_barracks" ? "briefing" : "living";
    const r = bad.rooms.find((x) => x.kind === kind);
    r.area_m2 = RULES.roomKinds[kind].maxArea + 12.5;
    says(checkPlans({ buildings: [bad] }, { buildings: [prog] }, RULES, { repeatTarget: 1 }).failures, `room ${r.id} (${kind})`, `wanted ${RULES.roomKinds[kind].maxArea} or less (roomKinds.${kind}.maxArea)`); // prettier-ignore
  }
});

test("pockets: stage 3 fails an office's target past its cap by its sentence", () => {
  const b = copy(programs);
  const office = b.buildings.find((x) => x.id === "msr_nexus").rooms.find((r) => r.kind === "office");
  office.target_m2 = 88.3;
  says(checkPrograms(b, loadCity(), RULES).failures, `room ${office.id} (office)`, "target 88.3 m2, wanted 70 or less (roomKinds.office.maxArea)");
});

test("pockets: the Nexus's program gains rooms for its spare floor, its note says why", () => {
  const nexus = raw.buildings.find((x) => x.id === "msr_nexus");
  sure(/R2 \(room caps, pockets\)/.test(nexus.note), "the Nexus has no note for its change");
  sure(nexus.rooms.office === 7 && nexus.rooms.interrogation === 3 && nexus.rooms.evidence === 2, `the Nexus's rooms: ${JSON.stringify(nexus.rooms)}`);
  sure(nexus.footprint[0] === 11 && nexus.footprint[1] === 9, "the Nexus's footprint changed: its tower stands on it");
});
