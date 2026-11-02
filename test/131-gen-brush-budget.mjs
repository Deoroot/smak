// The R1 review's two remarks on the Core tile c1_r1: (A) stage 8's brush budget counts a room's furniture once:
// the description's estimate carries a dressing allowance in each room's 8 brushes (ESTIMATE.room.dressingBrushes),
// and stage 8 takes it out for each described room it dresses, adding the props it placed instead; (B) a dormitory
// is at most the rulebook's maxArea (eight beds, Neufert's per-bed area times the games' area factor), with its
// reason, and the barracks' program fills its floors with dormitories under it. Reads stage 8's run of test 129
// (the Core's 05 and 08 artifacts) when it is there, else runs stages 0-8 itself.
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { test, testAsync, sure, HERE, tmp } from "./helper.mjs";
import { ESTIMATE, analyseCity, tileEstimateOf } from "../levels/lib/city-checks.mjs";
import { brushBudgetOf, CATALOGUE } from "../levels/gen/dressing.mjs";
import { loadRules, validateRules, tighten } from "../levels/lib/architecture-rules.mjs";
import { runGenerator } from "../levels/gen/runner.mjs";

const SPEC = join(HERE, "../levels/specs/newbyzantium.json");
const desc = JSON.parse(readFileSync(SPEC, "utf8"));
const RULES = loadRules();
const copy = (v) => JSON.parse(JSON.stringify(v));

test("brush budget: the description's tile estimate in counts, its rooms' dressing allowance apart", () => {
  sure(ESTIMATE.room.dressingBrushes > 0 && ESTIMATE.room.dressingBrushes < ESTIMATE.room.brushes, `room ${JSON.stringify(ESTIMATE.room)}`);
  const t = tileEstimateOf(desc, "c1_r1");
  sure(t && t.rooms > 50, `c1_r1: ${JSON.stringify(t)}`);
  sure(t.roomDressing === t.rooms * ESTIMATE.room.dressingBrushes, `allowance ${t.roomDressing} for ${t.rooms} rooms`);
  sure(t.structural >= t.rock + t.shellWalls && t.brushes > t.structural + t.rooms * ESTIMATE.room.brushes, JSON.stringify(t));
  // the same number analyseCity gives as a share of the limit (rounded to 3 places there)
  const max = desc.engine.limits.brushes.value;
  const share = analyseCity(desc).tiles.find((x) => x.tile === "c1_r1").budget.brushes;
  sure(Math.abs(t.brushes - share * max) <= max * 0.0005 + 1e-9, `${t.brushes} against the share ${share} x ${max}`);
  sure(tileEstimateOf(desc, "c9_r9") === null, "a tile the description does not hold has an estimate");
  // a description's room override keeps the coefficients it does not name
  const d = copy(desc);
  d.engine.estimate = { room: { brushes: 10 } };
  const t2 = tileEstimateOf(d, "c1_r1");
  sure(t2.roomDressing === t.roomDressing && t2.brushes === t.brushes + 2 * t.rooms, `with room.brushes 10: ${JSON.stringify(t2)}`);
});

test("brush budget: the props replace the allowance of the rooms they dress, the rest keep it", () => {
  const t = tileEstimateOf(desc, "c1_r1");
  const per = ESTIMATE.room.dressingBrushes;
  const prop = (kind, place) => ({ kind, build: CATALOGUE[kind].build, place });
  const props = [prop("wardrobe", "room"), prop("desk", "room"), prop("lamp-post", "street"), prop("rubble", "street")];
  const pb = CATALOGUE.wardrobe.brushes + CATALOGUE.desk.brushes + CATALOGUE["lamp-post"].brushes;
  // no room dressed: every allowance kept, the props added
  const none = brushBudgetOf(desc, "c1_r1", props, []);
  sure(none.described === t.brushes && none.allowance.replaced === 0 && none.allowance.kept === t.rooms * per, JSON.stringify(none.allowance));
  sure(none.total === t.brushes + pb && none.props === pb && none.streetProps === CATALOGUE["lamp-post"].brushes, JSON.stringify(none));
  // two rooms dressed: two allowances out
  const two = brushBudgetOf(desc, "c1_r1", props, [{ props: ["a"] }, { props: ["b"] }, { props: [] }]);
  sure(two.allowance.roomsDressed === 2 && two.allowance.replaced === 2 * per && two.total === t.brushes - 2 * per + pb, JSON.stringify(two));
  // more rooms dressed than described (stage 5 splits some): no more than the described rooms' allowance comes out
  const many = brushBudgetOf(desc, "c1_r1", props, Array.from({ length: t.rooms + 9 }, () => ({ props: ["x"] })));
  sure(many.allowance.replaced === t.rooms * per && many.allowance.kept === 0, JSON.stringify(many.allowance));
  sure(/counted once/.test(many.note) && /uncalibrated/.test(many.note), many.note);
});

test("dormitory: at most the rulebook's maxArea, with its reason; a maxArea without one refused", () => {
  const dorm = RULES.roomKinds.dormitory;
  sure(dorm.maxArea >= dorm.minArea && dorm.maxArea <= 100, `dormitory ${dorm.minArea}-${dorm.maxArea}`);
  sure(/neufert/i.test(dorm.maxNote) && /2\.5/.test(dorm.maxNote) && dorm.maxSource.includes("neufert"), dorm.maxNote);
  for (const [k, r] of Object.entries(RULES.roomKinds)) if (r.maxArea !== undefined) sure(r.maxNote && r.maxSource?.length, `${k}: a maxArea without its maxNote and maxSource`); // prettier-ignore
  const bad = copy(RULES);
  delete bad.roomKinds.dormitory.maxSource;
  sure(validateRules(bad).errors.some((e) => e.startsWith("roomKinds.dormitory.maxArea") && e.includes("maxSource")), validateRules(bad).errors.join(" | "));
  // a description may lower it, never raise it
  sure(tighten(RULES, { roomKinds: { dormitory: { maxArea: 80 } } }).errors.length === 0, "lowering the dormitory's maxArea refused");
  const up = tighten(RULES, { roomKinds: { dormitory: { maxArea: 160 } } });
  sure(up.errors.some((e) => e.includes("roomKinds.dormitory.maxArea") && e.includes("loosen")), up.errors.join(" | "));
});

await testAsync("barracks: the Core's dormitories under the maxArea, the brush budget's sentence says the allowance", "gen brush budget", async () => {
  const dir = join(tmp, "gen-dressing"); // test 129's run
  let out = dir;
  if (!existsSync(join(dir, "08-dressing.json"))) {
    out = join(tmp, "gen-brush-budget");
    const res = await runGenerator({ desc, out, tile: "c1_r1", until: 8 });
    sure(res.results.filter((r) => r.n <= 5).every((r) => r.pass), `stages 0-5: ${res.refused ?? JSON.stringify(res.stopped)}`);
  }
  const plans = JSON.parse(readFileSync(join(out, "05-plans.json"), "utf8"));
  const b = plans.buildings.find((x) => x.id === "msr_barracks");
  sure(b, "no msr_barracks in the Core's plans");
  const dorms = b.rooms.filter((r) => r.kind === "dormitory");
  sure(dorms.length === desc.buildings.find((x) => x.id === "msr_barracks").rooms.dormitory, `${dorms.length} dormitories`);
  for (const r of dorms) sure(r.area_m2 >= RULES.roomKinds.dormitory.minArea && r.area_m2 <= RULES.roomKinds.dormitory.maxArea, `${r.id}: ${r.area_m2} m2`);
  for (const pb of plans.buildings) for (const r of pb.rooms) if (RULES.roomKinds[r.kind]?.maxArea) sure(r.area_m2 <= RULES.roomKinds[r.kind].maxArea + 1e-6, `${r.id}: ${r.area_m2} m2 past ${r.kind}'s maxArea`); // prettier-ignore
  if (!existsSync(join(out, "08-dressing.json"))) return; // 6 and 7 built apart: the budget is test 129's
  const bb = JSON.parse(readFileSync(join(out, "08-dressing.json"), "utf8")).measures.brushBudget;
  sure(bb.total === bb.described - bb.allowance.replaced + bb.props, JSON.stringify(bb));
  sure(bb.props === bb.roomProps + bb.streetProps && bb.allowance.replaced > 0, JSON.stringify(bb));
});
