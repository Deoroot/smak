// The map generator's building stages (levels/gen/programs.mjs, plans.mjs, layout.mjs; stage3-programs.mjs and
// stage5-plans.mjs plug them into the runner): every one of New Byzantium's 29 enterable buildings given a program
// and floor plans that pass both gates (lots stubbed from the description, as stage 2 gives them for the whole
// city); the same inputs give the same bytes; each gate fails a broken copy with the sentence naming the thing and
// the number; the stats against the targets (rooms per building, room footprints repeated, plan variety).
import { test, sure } from "./helper.mjs";
import { loadRules } from "../levels/lib/architecture-rules.mjs";
import { loadCity, stubLots } from "../levels/gen/common.mjs";
import { programsOf, checkPrograms } from "../levels/gen/programs.mjs";
import { plansOf, checkPlans, planBuilding, REPEAT_TARGET, REPEAT_GATE } from "../levels/gen/plans.mjs";
import { stage as stage3 } from "../levels/gen/stage3-programs.mjs";
import { stage as stage5 } from "../levels/gen/stage5-plans.mjs";
import { planSvgs } from "../levels/gen/plan-svg.mjs";

const rules = loadRules();
const desc = loadCity();
const copy = (v) => JSON.parse(JSON.stringify(v));
const says = (res, ...words) => {
  const hit = res.failures.find((f) => words.every((w) => f.includes(w)));
  sure(hit, `the gate did not say ${JSON.stringify(words)}; it said: ${res.failures.slice(0, 4).join(" | ") || "nothing (it passed)"}`);
};
let programs = null;
let plans = null; // the whole city, laid out once
const byKind = (b, id) => b.rooms.find((r) => r.id === id)?.kind;

test("gen buildings: stage 3 gives every enterable building a program that passes, the same twice", () => {
  const lots = stubLots(desc);
  programs = programsOf(desc, lots, rules);
  sure(programs.buildings.length === 29, `${programs.buildings.length} programs, wanted 29`);
  const again = programsOf(loadCity(), stubLots(loadCity()), rules);
  sure(JSON.stringify(again) === JSON.stringify(programs), "the same description gave different programs");
  const g = checkPrograms(programs, desc, rules);
  sure(g.ok, `stage 3's gate: ${g.failures.slice(0, 4).join(" | ")}`);
  // the housing table is met city-wide; the Nexus holds its required program
  const homes = programs.buildings.flatMap((b) => b.units.filter((u) => u.kind === "home"));
  sure(homes.length === 65, `${homes.length} homes, wanted 65 (the housing table's 64 and the emporium's flat-m)`);
  const nexus = programs.buildings.find((b) => b.id === "msr_nexus");
  sure(nexus.rooms.filter((r) => r.kind === "cell").length === 12, "the Nexus lost cells");
  // the runner's stage: run and gate on the same lots
  const ctx = { description: desc, rulebook: rules, params: { tile: "c1_r1", seed: 1 }, inputs: { "02-lots.json": lots } };
  const body = stage3.run(ctx);
  const v = stage3.gate({ ...body }, ctx);
  sure(v.failures.length === 0, `stage3.gate: ${v.failures.slice(0, 3).join(" | ")}`);
});

test("gen buildings: stage 3's gate fails a broken program by its sentence", () => {
  const base = programs;
  let b = copy(base);
  const huts = b.buildings.find((x) => x.id === "canal_huts_west");
  huts.units = huts.units.filter((u) => u.number !== 1);
  says(checkPrograms(b, desc, rules), "homes: layer L1 has 11 hut homes, wanted 12 or more");
  b = copy(base);
  b.buildings.find((x) => x.id === "drains_pawn").variant = b.buildings.find((x) => x.id === "drains_den").variant;
  says(checkPrograms(b, desc, rules), "variety: variant den-vault is used by 2 buildings");
  b = copy(base);
  b.buildings.find((x) => x.id === "drains_house").rooms.find((r) => r.kind === "kitchen").target_m2 = 9;
  says(checkPrograms(b, desc, rules), "drains_house.u1.kitchen (kitchen)", "target 9 m2, wanted 15 or more");
  b = copy(base);
  const nx = b.buildings.find((x) => x.id === "msr_nexus");
  nx.rooms = nx.rooms.filter((r) => r.id !== "msr_nexus.msr.cell-12");
  says(checkPrograms(b, desc, rules), "required nexus: msr_nexus has 11 cell, wanted 12 or more");
  b = copy(base);
  b.buildings.find((x) => x.id === "drains_pawn").doors[0].name = "drains_den";
  says(checkPrograms(b, desc, rules), "doors: the name drains_den is given 2 times");
  b = copy(base);
  b.buildings.find((x) => x.id === "drains_house").rooms.find((r) => r.kind === "bedroom").storey = 5;
  says(checkPrograms(b, desc, rules), "storey 5, wanted 0 to 1");
  b = copy(base);
  b.buildings.find((x) => x.id === "drains_pawn").rooms.push({ id: "drains_pawn.business.cell", kind: "cell", storey: 0, target_m2: 20, minArea_m2: 15, minSide_m: 3.2, next: [], notNext: [] }); // prettier-ignore
  says(checkPrograms(b, desc, rules), "a cell is not in the program of a shop");
});

test("gen buildings: stage 5 lays out all 29 buildings and every plan passes its gate", () => {
  plans = plansOf(programs, rules);
  const g = checkPlans(plans, programs, rules);
  sure(g.ok, `stage 5's gate: ${g.failures.slice(0, 6).join(" | ")}`);
  sure(plans.buildings.length === 29, `${plans.buildings.length} plans`);
  // every program room planned, every named door on a door, every home's door named by the pattern
  for (const b of plans.buildings) {
    const prog = programs.buildings.find((p) => p.id === b.id);
    for (const r of prog.rooms) sure(b.rooms.some((x) => x.id === r.id), `${r.id} not planned`);
    for (const d of prog.doors) sure(b.doors.some((x) => x.name === d.name), `door ${d.name} not placed`);
  }
  sure(plans.buildings.find((b) => b.id === "stacks_block_a").doors.some((d) => d.name === "stacks_block_a_12"), "a flat's door name missing");
  sure(plans.buildings.find((b) => b.id === "msr_nexus").doors.some((d) => d.name === "msr_nexus_cell12"), "a cell door name missing");
  // stairs at the rulebook's riser, a storey's height in two flights
  for (const b of plans.buildings) for (const st of b.stairs) sure(Math.max(...st.flights.map((f) => f.risers)) <= rules.dimensions.stairs.maxRisersPerFlight, `${st.id} too many risers`); // prettier-ignore
  // the stats against the targets
  const s = plans.stats;
  console.log(`      rooms per building: median ${s.roomsPerBuilding.median} (target 3 or more; ${s.roomsPerBuilding.min} to ${s.roomsPerBuilding.max}); median room ${s.medianRoom_m2} m2 (the rp-city corpus: 32)`); // prettier-ignore
  console.log(`      room footprints repeated: ${(s.roomRepeat.share * 100).toFixed(1)} % (gate ${REPEAT_GATE * 100} %, target ${REPEAT_TARGET * 100} %; ${(s.roomRepeat.withCirculation * 100).toFixed(1)} % with corridors; the old generator 81 %)`); // prettier-ignore
  console.log(`      plans: ${s.planVariety.distinct} distinct of ${s.planVariety.buildings}; ${s.rooms} rooms, ${s.doors} doors (${s.namedDoors} named), ${s.windows} windows, ${s.stairs} flights pairs`); // prettier-ignore
  sure(s.roomsPerBuilding.median >= 3, `median rooms per building ${s.roomsPerBuilding.median}, wanted 3 or more`);
  sure(s.planVariety.distinct === s.planVariety.buildings, "two buildings share a plan");
  sure(s.roomRepeat.share <= REPEAT_GATE, `room repeats ${s.roomRepeat.share}`);
  // a picture of each
  const pics = planSvgs(plans);
  sure(pics.length === 29 && pics.every((p) => p.svg.startsWith("<svg") && p.svg.includes(">storey 0</text>")), "the plan pictures");
});

test("gen buildings: the same program gives the same plan, byte for byte", () => {
  for (const id of ["drains_pawn", "bazaar_emporium", "hearth_clinic"]) {
    const p = programs.buildings.find((b) => b.id === id);
    const a = JSON.stringify(planBuilding(copy(p), rules, { trials: 60 }));
    const b = JSON.stringify(planBuilding(copy(p), rules, { trials: 60 }));
    sure(a === b, `${id}: two plans from one program differ`);
  }
});

test("gen buildings: stage 5's gate fails a broken plan by its sentence", () => {
  const base = plans;
  const gate = (doc) => checkPlans(doc, programs, rules);
  const one = (doc, id) => doc.buildings.find((b) => b.id === id);
  let d = copy(base);
  one(d, "drains_pawn").rooms = one(d, "drains_pawn").rooms.filter((r) => r.kind !== "backroom");
  says(gate(d), "room drains_pawn.business.backroom (backroom) of the program has no plan, wanted 1");
  d = copy(base);
  let r = one(d, "drains_house").rooms.find((x) => x.id === "drains_house.u1.kitchen");
  r.area_m2 = 9;
  says(gate(d), "room drains_house.u1.kitchen (kitchen) of drains_house: 9 m2, wanted 15 or more");
  d = copy(base);
  r = one(d, "drains_house").rooms.find((x) => x.id === "drains_house.u1.kitchen");
  r.clear = [{ ...r.clear[0], w: 2 }];
  says(gate(d), "room drains_house.u1.kitchen (kitchen) of drains_house: narrow side 2 m, wanted 2.88 or more");
  // reach: the doors into the pawnbroker's back room taken away
  d = copy(base);
  one(d, "drains_pawn").doors = one(d, "drains_pawn").doors.filter((x) => x.to !== "drains_pawn.business.backroom" && x.from !== "drains_pawn.business.backroom"); // prettier-ignore
  says(gate(d), "room drains_pawn.business.backroom (backroom) is not reached from the entrance");
  // private through: the house's landing called a cell, so the bedrooms beyond it pass through a secure room
  d = copy(base);
  const house = one(d, "drains_house");
  const corr = house.rooms.find((x) => x.kind === "corridor" && x.storey === 1);
  sure(corr, "drains_house has no landing corridor upstairs");
  corr.kind = "cell";
  says(gate(d), `is reached only through room ${corr.id} (cell)`); // its number is the plan's (a bay before it counts)
  // a door too narrow, in metres and in the engine's units
  d = copy(base);
  one(d, "drains_pawn").doors.find((x) => x.street).width = 1;
  says(gate(d), "(shop): clear width 1 m, wanted 1.42 m or more");
  says(gate(d), "(goldsrc): door", "clear width 39.37 units, wanted 55.906 units or more");
  // a stair too steep
  d = copy(base);
  one(d, "drains_house").stairs[0].rise = 0.25;
  says(gate(d), "drains_house: stair drains_house.stair.s0 (domestic): rise 0.25 m, wanted 0.21 m or less");
  // a corridor too narrow, a ceiling too low
  d = copy(base);
  const sb = one(d, "stacks_block_a").rooms.find((x) => x.kind === "corridor" && !x.unit);
  sb.clear = sb.clear.map((c) => (c.w < c.d ? { ...c, w: 1.5 } : { ...c, d: 1.5 }));
  says(gate(d), `corridor ${sb.id} of stacks_block_a: 1.5 m wide, wanted 2.4 or more (a public corridor)`);
  d = copy(base);
  one(d, "drains_den").rooms.find((x) => x.kind === "barroom").height_m = 3;
  says(gate(d), "ceiling 3 m, wanted 3.6 m or more (a public ceiling)");
  // keep-clear: a wall stood in the pawnshop's street door's approach
  d = copy(base);
  const pawn = one(d, "drains_pawn");
  const door = pawn.doors.find((x) => x.street);
  const [fx, fy] = door.facing;
  const at = [door.at[0] + fx * 0.9, door.at[1] + fy * 0.9];
  pawn.walls.push({ storey: 0, a: fx ? [at[0], at[1] - 2] : [at[0] - 2, at[1]], b: fx ? [at[0], at[1] + 2] : [at[0] + 2, at[1]], kind: "interior", thickness_m: 0.2032, rooms: ["test"], holes: [] }); // prettier-ignore
  says(gate(d), `door ${door.id}'s approach (front) enters the interior wall of test`);
  // two leaves swinging into each other
  d = copy(base);
  const den = one(d, "drains_den");
  const swing = den.doors.filter((x) => x.swing === "front");
  swing[1].at = [...swing[0].at];
  swing[1].facing = [...swing[0].facing];
  says(gate(d), "swing into each other");
  // a room outside the lot; two rooms overlapping
  d = copy(base);
  one(d, "drains_cutter").rooms[0].rects[0].x = -3;
  says(gate(d), "of drains_cutter:", "leaves the lot's inside");
  d = copy(base);
  const cut = one(d, "drains_cutter").rooms;
  cut[1].rects = [{ ...cut[0].rects[0] }];
  says(gate(d), "storey 0 of drains_cutter:", "overlap by");
  // names: twice, missing, too long
  d = copy(base);
  one(d, "drains_cutter").doors.find((x) => x.name).name = "drains_pawn";
  says(gate(d), "door name drains_pawn: on 2 doors");
  says(gate(d), "door name drains_cutter (business) of drains_cutter: on no door, wanted 1");
  // plan variety and repeated room footprints
  d = copy(base);
  one(d, "drains_cutter").signature = one(d, "drains_pawn").signature;
  says(gate(d), "variety: buildings drains_pawn, drains_cutter share one plan");
  says(checkPlans(base, programs, rules, { repeatTarget: 0.01 }), "% of rooms repeat another's footprint, wanted 1 % or less");
});

test("gen buildings: a connector's well kept clear and opened onto, its loss failed by name (stage 5's reservations)", () => {
  const prog = copy(programs.buildings.find((b) => b.id === "msr_precinct"));
  // the Nexus spine through the precinct, as stage 4 places it
  const network = {
    connectors: [
      { id: "c_spine_lift", type: "lift", pieces: [{ kind: "shaft", poly: [[64.5, 58.5], [65.5, 58.5], [65.5, 59.5], [64.5, 59.5]], z: [-0.06, 12.923] }], exits: [{ stop: "msr_precinct", z: 5, side: "e" }] }, // prettier-ignore
      { id: "c_spine_stair", type: "stair", pieces: [{ kind: "well", poly: [[64.5, 57], [67, 57], [67, 58.5], [64.5, 58.5]], z: [-0.06, 12.75] }], exits: [{ stop: "msr_precinct", z: 5, side: "w" }] }, // prettier-ignore
    ],
  };
  const doc = plansOf({ buildings: [prog] }, rules, { network });
  const b = doc.buildings[0];
  const g = checkPlans(doc, { buildings: [prog] }, rules);
  sure(g.ok, `the precinct with the spine: ${g.failures.slice(0, 4).join(" | ")}`);
  sure(b.reserved.length === 1 && b.reserved[0].kind === "column" && b.reserved[0].storeys.join() === "0", `the spine column: ${JSON.stringify(b.reserved)}`); // prettier-ignore
  sure(b.reserved[0].exits.every((e) => e.door), "an exit of the spine has no door");
  const broken = copy(doc);
  broken.buildings[0].voids = broken.buildings[0].voids.filter((v) => !(v.kind === "column" && v.storey === 0));
  says(checkPlans(broken, { buildings: [prog] }, rules), "c_spine_lift+c_spine_stair's column is not kept clear on storey 0");
  // the stage file: the same work through the runner's interface
  const ctx = { description: desc, rulebook: rules, params: { tile: "c1_r1", seed: 1 }, inputs: { "03-programs.json": { buildings: [prog] }, "04-network.json": network } }; // prettier-ignore
  sure(stage5.name === "plans" && stage5.n === 5 && stage5.reads.includes("04-network.json"), "stage 5's registration");
  void ctx;
});

test("gen buildings: stage 4 tied in (a hallway's end, a checkpoint's rooms, a lift lobby), each loss failed by name", () => {
  // the precinct with a passage ending on its north wall, a checkpoint's guard post and cell stood in its lot, the
  // spine's lift stopping at it: stage 3 ties them to the building, stage 5 plans them where they stand
  const network = {
    connectors: [
      { id: "c_spine_lift", type: "lift", pieces: [{ kind: "shaft", poly: [[64.5, 58.5], [65.5, 58.5], [65.5, 59.5], [64.5, 59.5]], z: [-0.06, 12.923] }], exits: [{ stop: "msr_precinct", z: 5, side: "e" }] }, // prettier-ignore
    ],
    hallways: [{ id: "hw_test", kind: "passage", from: "msr_precinct", to: "v2_core", width: 1.5, z: [5, 6.5], path: [[69.25, 62.25], [69.25, 66]] }], // prettier-ignore
    checkpoints: [{ id: "cp_test", node: "n2_test", rooms: [{ kind: "guard-post", rect: { x: 69, y: 55, w: 2, d: 2 }, z: [5, 6.5] }, { kind: "holding-cell", rect: { x: 67, y: 55, w: 2, d: 1.5 }, z: [5, 6.5] }] }], // prettier-ignore
    posts: [],
  };
  const progs = programsOf(desc, stubLots(desc), rules, { network });
  const prog = progs.buildings.find((b) => b.id === "msr_precinct");
  sure(prog.hallways.some((h) => h.hallway === "hw_test" && h.side === "n" && h.at === 6.25), `the hallway's end: ${JSON.stringify(prog.hallways)}`); // prettier-ignore
  sure(prog.rooms.filter((r) => r.checkpoint === "cp_test").map((r) => r.kind).join() === "guard-post,holding-cell", "the checkpoint's rooms folded in"); // prettier-ignore
  sure(prog.rooms.find((r) => r.kind === "holding-cell" && r.checkpoint)?.door === "cp_test_cell1", "the checkpoint's cell keeps its name");
  sure(prog.rooms.some((r) => r.kind === "lift-lobby" && r.lift?.connectors.includes("c_spine_lift") && r.lift.side === "e"), "the lift lobby on the lift");
  const doc = plansOf({ buildings: [prog] }, rules, { network });
  const g = checkPlans(doc, { buildings: [prog] }, rules, { network });
  sure(g.ok, `the precinct tied to its network: ${g.failures.slice(0, 4).join(" | ")}`);
  const b = doc.buildings[0];
  sure(b.doors.some((d) => d.hallway === "hw_test" && d.kind === "gate"), "a door at the hallway's end");
  sure(b.rooms.some((r) => r.checkpoint === "cp_test" && r.kind === "guard-post") && b.doors.some((d) => d.street && byKind(b, d.to) === "guard-post"), "the guard post planned, with its own door"); // prettier-ignore
  const gate = (d, net = network) => checkPlans(d, { buildings: [prog] }, rules, { network: net });
  let d = copy(doc);
  d.buildings[0].doors = d.buildings[0].doors.filter((x) => x.hallway !== "hw_test");
  says(gate(d), "msr_precinct: hallway hw_test meets the n wall 6.25 cells along it on storey 0 and no door opens there, wanted 1");
  d = copy(doc);
  d.buildings[0].rooms.find((r) => r.checkpoint === "cp_test" && r.kind === "guard-post").cells[0].x += 1;
  says(gate(d), "(cp_test's guard-post) of msr_precinct is planned 1 cells from where stage 4 stood it, wanted 0.2 or less");
  const more = copy(network);
  more.checkpoints[0].rooms.push({ kind: "holding-cell", rect: { x: 63.5, y: 61, w: 1.5, d: 1.5 }, z: [5, 6.5] });
  says(gate(copy(doc), more), "cp_test's holding-cell stands 2.25 cells2 inside building msr_precinct's lot and is not a room of its plan");
  const street = b.doors.find((x) => x.street && byKind(b, x.to) === "lobby");
  const block = copy(network);
  block.checkpoints[0].rooms.push({ kind: "holding-cell", rect: { x: street.cells[0] - 1.5, y: street.cells[1] - 0.5, w: 1.4, d: 1 }, z: [5, 6.5] }); // prettier-ignore
  says(gate(copy(doc), block), `cp_test's holding-cell stands in street door ${street.id}'s approach of msr_precinct`);
  d = copy(doc);
  const ex = d.buildings[0].reserved[0].exits.find((e) => e.side === "e");
  ex.room = "msr_precinct.msr.lobby";
  says(gate(d), "lift lobby msr_precinct.msr.lift-lobby of msr_precinct: c_spine_lift's door on the e at storey 0 opens into msr_precinct.msr.lobby, wanted the lobby"); // prettier-ignore
  // a cell opens only by a cell door, only on a guarded corridor or post (the Nexus's cells)
  d = copy(plans);
  const nx = d.buildings.find((x) => x.id === "msr_nexus");
  const cd = nx.doors.find((x) => x.name === "msr_nexus_cell1");
  cd.kind = "opening";
  cd.from = nx.rooms.find((r) => r.kind === "stairwell").id;
  says(checkPlans(d, programs, rules), `door ${cd.id} of msr_nexus into the cell`, "is a opening, wanted a cell door (a lockable leaf)");
  says(checkPlans(d, programs, rules), "of msr_nexus opens on the stairwell", "wanted only guard-post or corridor");
  // no window on a party wall; every terrace with its parapet
  d = copy(plans);
  const pp = programs.buildings.find((x) => x.id === "drains_pawn");
  const pawn = d.buildings.find((x) => x.id === "drains_pawn");
  const w = pawn.windows.find((x) => !x.court && x.facing[0] === 1);
  sure(w, "the pawnshop has a window on its west wall");
  const party = copy(programs);
  party.buildings.find((x) => x.id === "drains_pawn").lot.party = [{ side: "w", a: 0, b: pp.lot.rect.d, lot: "f_test" }];
  says(checkPlans(d, party, rules), `window of room ${w.room} of drains_pawn on storey 0 opens on the w party wall shared with lot f_test, wanted none`); // prettier-ignore
  const withTerrace = d.buildings.find((x) => x.voids.some((v) => v.kind === "terrace"));
  sure(withTerrace && withTerrace.parapets.length, "a terrace and its parapets");
  withTerrace.parapets = [];
  says(checkPlans(d, programs, rules), `${withTerrace.id}: terrace`, "has no parapet, wanted one on every edge not against a room");
});
