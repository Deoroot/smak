// The Core review's oversized rooms (R2): the room kinds the generator can hold to it (a hall, a ward, a shop floor,
// a workshop, a bedroom, a holding cell) carry a maxArea from real data (Neufert, the CPT) times the games' area
// factor, with its reason (the MSR's kinds, the office and the home's rooms too, since stage 5 splits a pocket: test
// 145); a corridor holds an area
// and a width cap (roomKinds.corridor.maxWidthOfTypical, times its class's typical width). The rulebook refuses a cap
// without its reason or citing no source, a description may lower a cap and never raise it; stage 3 fails a target
// past a cap, stage 5 a room past it and a corridor too wide, each by its sentence; the layout aims a capped room
// under its cap and gives the floor it leaves to the others; the description's buildings fill their floors with
// rooms (or a smaller footprint) instead of growing rooms past them.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test, sure, HERE } from "./helper.mjs";
import { loadRules, validateRules, tighten, rulesFor } from "../levels/lib/architecture-rules.mjs";
import { loadCity, stubLots } from "../levels/experimental-city/common.mjs";
import { programsOf, checkPrograms } from "../levels/experimental-city/programs.mjs";
import { planBuilding, checkPlans } from "../levels/experimental-city/plans.mjs";
import { cappedWeights } from "../levels/experimental-city/layout.mjs";

const RULES = loadRules();
const desc = loadCity();
const raw = JSON.parse(readFileSync(join(HERE, "../levels/specs/newbyzantium.json"), "utf8"));
const copy = (v) => JSON.parse(JSON.stringify(v));
const CAPPED = { "front-desk": 80, booking: 80, "holding-cell": 45, hall: 200, ward: 120, "shop-floor": 100, workshop: 100, bedroom: 60, dormitory: 90, corridor: 61, office: 70, cell: 35, "upper-hall": 100, lobby: 80, briefing: 80, gate: 30, "lift-lobby": 50, "guard-post": 40, interrogation: 40, armory: 45, living: 90, "great-hall": 140, kitchen: 50, bedsit: 75 }; // prettier-ignore
const says = (list, ...words) => {
  const hit = list.find((f) => words.every((w) => f.includes(w)));
  sure(hit, `nothing said ${JSON.stringify(words)}; said: ${list.slice(0, 4).join(" | ") || "nothing"}`);
};

test("room caps: every oversized kind holds its maxArea with the data and the area factor it came from", () => {
  for (const [k, max] of Object.entries(CAPPED)) {
    const r = RULES.roomKinds[k];
    sure(r.maxArea === max, `${k}: maxArea ${r.maxArea}, wanted ${max}`);
    sure(r.maxArea >= r.minArea * 1.2, `${k}: maxArea ${r.maxArea} too near its minArea ${r.minArea}`);
    sure(/2\.5 area factor/.test(r.maxNote) && /m2/.test(r.maxNote), `${k}: the maxNote does not say the real area and the factor`);
    for (const s of r.maxSource) sure(RULES.sources[s], `${k}: maxSource ${s} is not in sources`);
  }
  // the corridor's width: twice its class's typical (a house's hall as wide as its dog-leg stair passes)
  const c = RULES.roomKinds.corridor;
  sure(c.maxWidthOfTypical === 2 && RULES.dimensions.corridors.domestic.width.typical * c.maxWidthOfTypical >= 3.46, "the domestic hall cap"); // prettier-ignore
  // the longest corridor the rulebook lets run at a public corridor's clear width is under the corridor's maxArea
  sure(RULES.circulation.corridor.maxRun * 2.44 <= c.maxArea + 0.1, "corridor maxArea under maxRun x the public clear width");
  // a converted rulebook scales the areas, never the width ratio
  const gs = rulesFor("goldsrc", RULES);
  sure(gs.roomKinds.corridor.maxWidthOfTypical === 2 && gs.roomKinds.workshop.maxArea > 1000, "rulesFor scaled the ratio or not the area");
});

test("room caps: the rulebook refuses a cap without its reason, an unknown source, a bad width ratio", () => {
  let bad = copy(RULES);
  delete bad.roomKinds.workshop.maxNote;
  says(validateRules(bad).errors, "roomKinds.workshop.maxArea", "maxNote");
  bad = copy(RULES);
  bad.roomKinds.ward.maxSource = ["hbn"];
  says(validateRules(bad).errors, "roomKinds.ward.maxSource", `cites "hbn"`);
  bad = copy(RULES);
  bad.roomKinds.bedroom.maxArea = 10;
  says(validateRules(bad).errors, "roomKinds.bedroom.maxArea", "at least its minArea 20");
  bad = copy(RULES);
  bad.roomKinds.corridor.maxWidthOfTypical = 0.5;
  says(validateRules(bad).errors, "roomKinds.corridor.maxWidthOfTypical", "1 or more");
  bad = copy(RULES);
  delete bad.roomKinds.corridor.maxNote;
  says(validateRules(bad).errors, "roomKinds.corridor.maxWidthOfTypical", "its reason");
  // a description may lower a cap, never raise it
  sure(tighten(RULES, { roomKinds: { workshop: { maxArea: 80 }, corridor: { maxWidthOfTypical: 1.5 } } }).errors.length === 0, "lowering refused"); // prettier-ignore
  says(tighten(RULES, { roomKinds: { workshop: { maxArea: 120 } } }).errors, "roomKinds.workshop.maxArea", "loosen");
  says(tighten(RULES, { roomKinds: { corridor: { maxWidthOfTypical: 3 } } }).errors, "roomKinds.corridor.maxWidthOfTypical", "loosen");
});

test("room caps: the layout holds a capped room's share under its cap and gives the rest to the others", () => {
  const items = [
    { id: "a.office", weight: 100, maxAreaG: 50 },
    { id: "a.office-2", weight: 100, maxAreaG: 50 },
    { id: "a.armory", weight: 100 },
  ];
  const out = cappedWeights(items, 300);
  const total = out.reduce((s, it) => s + it.weight, 0);
  const share = (it) => (it.weight / total) * 300;
  for (const it of out.slice(0, 2)) sure(share(it) <= it.maxAreaG * 0.96 + 1e-6 && share(it) >= it.maxAreaG * 0.79, `${it.id}: ${share(it)}`);
  sure(Math.abs(share(out[0]) - share(out[1])) > 0.5, "two offices held at one size (their footprints would repeat)");
  sure(share(out[2]) > 190, `the uncapped room took ${share(out[2])}`);
  sure(items[0].weight === 100, "the items were changed in place");
  // every room past its cap: each weighed by its cap (each passes it by one share; the polish's pockets leave the
  // rest spare beside each, test 145)
  const all = cappedWeights([{ id: "b.office", weight: 100, maxAreaG: 50 }, { id: "b.cell", weight: 100, maxAreaG: 20 }], 300);
  sure(all[0].weight > 2 * all[1].weight && all[0].weight <= 50 && all[1].weight <= 20, `an all-capped zone kept its shares: ${all.map((x) => x.weight)}`); // prettier-ignore
});

let programs = null;
test("room caps: stage 3 fails a target past its kind's maxArea by its sentence", () => {
  programs = programsOf(desc, stubLots(desc), RULES);
  sure(checkPrograms(programs, desc, RULES).ok, "the city's programs fail");
  const b = copy(programs);
  const ward = b.buildings.find((x) => x.id === "hearth_clinic").rooms.find((r) => r.kind === "ward");
  ward.target_m2 = 158;
  says(checkPrograms(b, desc, RULES).failures, `room ${ward.id} (ward)`, "target 158 m2, wanted 120 or less (roomKinds.ward.maxArea)");
});

test("room caps: stage 5 lays the shop and the clinic under their caps and fails a room past one, a corridor too wide", () => {
  for (const id of ["drains_pawn", "hearth_clinic", "bazaar_emporium"]) {
    const prog = programs.buildings.find((x) => x.id === id);
    const plan = planBuilding(copy(prog), RULES, { trials: 120 });
    const g = checkPlans({ buildings: [plan] }, { buildings: [prog] }, RULES, { repeatTarget: 1 });
    sure(g.ok, `${id}: ${g.failures.slice(0, 3).join(" | ")}`);
    for (const r of plan.rooms) if (RULES.roomKinds[r.kind]?.maxArea) sure(r.area_m2 <= RULES.roomKinds[r.kind].maxArea, `${r.id}: ${r.area_m2} m2`);
    if (id === "drains_pawn") {
      const bad = copy(plan);
      const shop = bad.rooms.find((r) => r.kind === "shop-floor");
      shop.area_m2 = 133.37;
      says(checkPlans({ buildings: [bad] }, { buildings: [prog] }, RULES, { repeatTarget: 1 }).failures, `room ${shop.id} (shop-floor)`, "133.37 m2, wanted 100 or less (roomKinds.shop-floor.maxArea)"); // prettier-ignore
    }
    if (id === "bazaar_emporium") {
      const bad = copy(plan);
      const hall = bad.rooms.find((r) => r.kind === "corridor" && r.storey === 0);
      for (const c of hall.clear) (c.w < c.d ? (c.w = 4.2) : (c.d = 4.2));
      says(checkPlans({ buildings: [bad] }, { buildings: [prog] }, RULES, { repeatTarget: 1 }).failures, `corridor ${hall.id}`, "4.2 m wide, wanted 3.6 or less", "maxWidthOfTypical"); // prettier-ignore
    }
  }
});

test("room caps: the terraces' houses five cells deep under the bedroom's cap, each change with its note", () => {
  const b = (id) => raw.buildings.find((x) => x.id === id);
  for (const id of ["hearth_terrace", "palace_townhouses"]) {
    sure(/R2 \(room caps\)/.test(b(id).note ?? ""), `${id}: no note for its change`);
    sure(b(id).footprint[1] === 5, `${id}: ${b(id).footprint[1]} cells deep, wanted 5`);
  }
  // the street front kept: the lot's front edge where it was (hearth_terrace's low y 69; palace_townhouses' high y 30 on the
  // Gilded Arcade court since 2026-11-02, its old place on s3_west crossed by s3_gallery_b)
  sure(b("hearth_terrace").at[1] - 2.5 === 69 && b("palace_townhouses").at[1] + 2.5 === 30, "a terrace's street front moved");
  // their houses' bedrooms under the cap in the city's plans (the plans of the case before)
  for (const id of ["hearth_terrace", "palace_townhouses"]) {
    const prog = programs.buildings.find((x) => x.id === id);
    const plan = planBuilding(copy(prog), RULES, { trials: 120 });
    for (const r of plan.rooms.filter((x) => x.kind === "bedroom")) sure(r.area_m2 <= RULES.roomKinds.bedroom.maxArea, `${r.id}: ${r.area_m2} m2`); // prettier-ignore
  }
});
