// The room-dressing trade (levels/notes-megastructure.md, the first trade; the rulebook's placement.dressing and
// placement.requiredProps): a room kind's dressing allowance in brushes, the rooms role-play happens in kept whole,
// the props that make a room what it is never taken out; trimming after placing, so a prop kept never moves. The
// rulebook's two entries (their sources and notes, every dressed kind decided, a description lowering and never
// raising an allowance); trimRoom on a made-up room (the order, the put-back, the required props, the same objects);
// stage 8 on the Core with and without the entries (every prop kept identical, the trimmed rooms within their
// allowance, the RP rooms untouched); the gate failing a bedroom without its bed, a shop floor without its counter,
// an office without its desk, a cell without its cot and a storeroom past its allowance, each by its sentence.
import { join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { test, testAsync, sure, HERE, tmp } from "./helper.mjs";
import { validateRules, tighten, rulesFor } from "../levels/lib/architecture-rules.mjs";
import { runGenerator, regate } from "../levels/experimental-city/runner.mjs";
import { stage as stage8 } from "../levels/experimental-city/stage8-dressing.mjs";
import { CATALOGUE, FURNISH, CLEAR_KINDS, trimRoom, requiredOf, dressingRuleOf } from "../levels/experimental-city/dressing.mjs";

const RULES = JSON.parse(readFileSync(join(HERE, "../levels/rules/architecture.json"), "utf8"));
const SPEC = join(HERE, "../levels/specs/newbyzantium.json");
const desc = JSON.parse(readFileSync(SPEC, "utf8"));
const copy = (v) => JSON.parse(JSON.stringify(v));
const D = RULES.placement.dressing;
const REQ = RULES.placement.requiredProps.byKind;

test("dressing trade: the rulebook's allowance and required props, each with its source and reason, every dressed kind decided", () => {
  sure(validateRules(RULES).errors.length === 0, validateRules(RULES).errors.join(" | "));
  for (const k of ["dressing", "requiredProps"]) {
    const e = RULES.placement[k];
    sure(e.source.includes("judged") && e.note.length > 80, `placement.${k}: ${JSON.stringify(e.source)}`);
  }
  sure(/13 -> 6/.test(D.note) && /forms now carry/.test(D.note) && /never moves/.test(D.note), D.note);
  // every kind stage 8 dresses is kept full or given an allowance, never both
  for (const k of Object.keys(FURNISH)) sure((D.full.includes(k)) !== (D.maxBrushesBy[k] !== undefined), `${k}: wanted in placement.dressing.full or maxBrushesBy, one of them`); // prettier-ignore
  for (const k of CLEAR_KINDS) sure(D.maxBrushesBy[k] === 0, `${k}: circulation, wanted an allowance of 0`);
  // the rooms role-play happens in are kept whole
  for (const k of ["cell", "holding-cell", "barroom", "shop-floor", "office", "dormitory", "interrogation", "front-desk", "booking", "armory", "workshop", "ward", "kitchen", "living", "bedroom"]) // prettier-ignore
    sure(D.full.includes(k), `${k}: an RP room, wanted in placement.dressing.full`);
  for (const k of ["storeroom", "lockers", "evidence", "records", "garage", "toilet"]) sure(Number.isInteger(D.maxBrushesBy[k]), `${k}: wanted an allowance`); // prettier-ignore
  // every required prop a kind the catalogue has and the kind's furnishing asks for; the allowance holds the required
  for (const [k, groups] of Object.entries(REQ)) {
    for (const g of groups) {
      for (const p of g) sure(CATALOGUE[p], `${k}: requires a ${p}, which the catalogue has not`);
      sure(g.some((p) => (FURNISH[k] ?? []).some((f) => f.kind === p && f.n >= 1)), `${k}: requires one of ${g.join(", ")}, which its furnishing (FURNISH) does not always give`); // prettier-ignore
    }
    const max = D.maxBrushesBy[k];
    if (max !== undefined) sure(groups.reduce((s, g) => s + Math.min(...g.map((p) => CATALOGUE[p].brushes)), 0) <= max, `${k}: its required props take more than its allowance ${max}`); // prettier-ignore
  }
  for (const k of ["bedroom", "dormitory", "shop-floor", "front-desk", "booking", "office", "barroom", "cell", "ward", "workshop"]) sure(REQ[k]?.length, `${k}: no required props`); // prettier-ignore
  sure(REQ.bedroom[0].includes("bed-double") && REQ.cell[0].includes("cot") && REQ.barroom[0].includes("bar-counter") && REQ.office[0].includes("desk"), "a room's defining prop missing"); // prettier-ignore
  // brush counts, not lengths: left alone in the engine's units
  sure(rulesFor("goldsrc", RULES).placement.dressing.maxBrushesBy.storeroom === D.maxBrushesBy.storeroom, "the allowance converted as a length");
  // a description may lower an allowance, never raise it
  sure(tighten(RULES, { placement: { dressing: { maxBrushesBy: { storeroom: 4 } } } }).errors.length === 0, "lowering the storeroom's allowance refused");
  const up = tighten(RULES, { placement: { dressing: { maxBrushesBy: { storeroom: 20 } } } });
  sure(up.errors.some((e) => e.includes("placement.dressing.maxBrushesBy.storeroom") && e.includes("loosen")), up.errors.join(" | "));
});

test("dressing trade: the rulebook's entries refused when broken, each by its sentence", () => {
  const says = (mut, ...words) => {
    const r = copy(RULES);
    mut(r);
    const errs = validateRules(r).errors;
    sure(errs.some((e) => words.every((w) => e.includes(w))), `wanted ${JSON.stringify(words)}; got ${errs.join(" | ") || "none"}`);
  };
  says((r) => r.placement.dressing.full.push("storeroom"), "placement.dressing.full", '"storeroom" is kept full and given an allowance');
  says((r) => delete r.placement.dressing.note, "placement.dressing.note", "its reason");
  says((r) => (r.placement.requiredProps.source = []), "placement.requiredProps.source");
  says((r) => (r.placement.dressing.maxBrushesBy.attic = 4), "placement.dressing.maxBrushesBy.attic", "no such room kind");
  says((r) => (r.placement.dressing.maxBrushesBy.storeroom = 2.5), "placement.dressing.maxBrushesBy.storeroom", "whole number");
  says((r) => (r.placement.requiredProps.byKind.office = [[]]), "placement.requiredProps.byKind.office", "non-empty list");
});

test("dressing trade: trimRoom takes scatter, decor, duplicates, then the rest, never a required prop, puts back what fits, moves nothing", () => {
  const P = (kind, n) => ({ kind, n, foot: [n, 0, n + 1, 1], facing: [0, 1] });
  // a storeroom: shelving x3 (4 each), crate x2, barrel (1 each): 15 brushes
  const props = [P("shelving", 1), P("shelving", 2), P("shelving", 3), P("crate", 1), P("crate", 2), P("barrel", 1)];
  const rule = { max: 6, required: [["shelving"]], scatter: ["crate", "barrel"], decor: [] };
  const t = trimRoom(props, rule);
  // the scatter out, last placed first (barrel, crate-2, crate-1): 12; the later shelves out to 4; then put back, the last
  // taken out first, while it fits: crate-1, crate-2 (6); the barrel, taken out first, stays out
  sure(t.before === 15 && t.after === 6, `${t.before} -> ${t.after}`);
  sure(JSON.stringify(t.kept.map((p) => `${p.kind}-${p.n}`)) === JSON.stringify(["shelving-1", "crate-1", "crate-2"]), t.kept.map((p) => `${p.kind}-${p.n}`).join(" ")); // prettier-ignore
  sure(t.kept.every((p) => props.includes(p)), "a kept prop is not the very object placed");
  sure(JSON.stringify(t.trimmed.map((p) => [`${p.kind}-${p.n}`, p.rank])) === JSON.stringify([["shelving-2", "duplicate"], ["shelving-3", "duplicate"], ["barrel-1", "scatter"]]), JSON.stringify(t.trimmed.map((p) => [p.kind, p.n, p.rank]))); // prettier-ignore
  // decor before a duplicate; a model (no brushes) never taken
  const hall = [P("bench", 1), P("bench", 2), P("dining-table", 1), P("planter", 1)];
  const h = trimRoom(hall, { max: 6, required: [["bench"]], scatter: [], decor: ["dining-table", "planter"] });
  sure(h.trimmed.length === 1 && h.trimmed[0].kind === "dining-table" && h.after === 6 && h.kept.some((p) => p.kind === "planter"), JSON.stringify(h.trimmed)); // prettier-ignore
  // a kind kept full (max null) and a room within its allowance: untouched, the same array
  sure(trimRoom(props, { ...rule, max: null }).kept === props && trimRoom(props, { ...rule, max: 15 }).kept === props, "a room within its allowance was trimmed"); // prettier-ignore
  // the required props alone past the allowance: kept, the rest out
  const r2 = trimRoom([P("workbench", 1), P("crate", 1)], { max: 2, required: [["workbench"]], scatter: ["crate"], decor: [] });
  sure(r2.kept.length === 1 && r2.kept[0].kind === "workbench" && r2.after === 5, JSON.stringify(r2));
  // requiredOf: one prop a group, the first placed
  const q = requiredOf([P("worktop", 1), P("stove", 1), P("worktop", 2)], [["worktop"], ["stove"], ["fridge"]]);
  sure([...q.used].join() === "0,1" && q.missing.length === 1 && q.missing[0][0] === "fridge", JSON.stringify([...q.used]));
  // without the rulebook entries nothing is trimmed
  const bare = copy(RULES);
  delete bare.placement.dressing;
  delete bare.placement.requiredProps;
  sure(dressingRuleOf("storeroom", bare).max === null && dressingRuleOf("storeroom", bare).required.length === 0, "a rulebook without the entries trims");
});

const OUT = join(tmp, "gen-dressing-trade");
let art = null;
let inputs = null;

await testAsync("dressing trade: the Core's stage 8 within each room's allowance, every kept prop where it stood without the trade, the RP rooms whole", "dressing trade core", async () => {
  const res = await runGenerator({ desc, out: OUT, tile: "c1_r1", until: 8 });
  const r8 = res.results.find((r) => r.n === 8);
  sure(res.ok && r8?.pass, `stage 8: ${res.refused ?? JSON.stringify(res.stopped)}`);
  inputs = {};
  for (const f of readdirSync(OUT)) if (/^0[0-7]-.*\.json$/.test(f)) inputs[f] = JSON.parse(readFileSync(join(OUT, f), "utf8"));
  art = JSON.parse(readFileSync(join(OUT, "08-dressing.json"), "utf8"));
  // the same stage on the same inputs, the rulebook without the trade's entries: the dressing as it was
  const bare = copy(RULES);
  delete bare.placement.dressing;
  delete bare.placement.requiredProps;
  const was = stage8.run({ description: desc, rulebook: bare, params: art.params, inputs });
  const before = new Map(was.props.map((p) => [p.id, JSON.stringify(p)]));
  const moved = art.props.filter((p) => before.get(p.id) !== JSON.stringify(p)).map((p) => p.id);
  sure(moved.length === 0, `props not identical to the dressing without the trade: ${moved.slice(0, 5).join(", ")}`);
  const after = new Set(art.props.map((p) => p.id));
  const gone = was.props.filter((p) => !after.has(p.id));
  sure(gone.length > 0 && gone.every((p) => p.place === "room" && p.build === "brush"), `taken out: ${gone.length}, a street prop or a model among them`); // prettier-ignore
  const m = art.measures;
  sure(m.trimmed.props === gone.length && m.trimmed.brushes === was.measures.brushBudget.total - m.brushBudget.total, `${JSON.stringify(m.trimmed)} against ${was.measures.brushBudget.total} -> ${m.brushBudget.total}`); // prettier-ignore
  sure(m.brushBudget.total < was.measures.brushBudget.total - 200, `the Core's brushes ${was.measures.brushBudget.total} -> ${m.brushBudget.total}`);
  const goneRooms = new Set(gone.map((p) => p.room));
  for (const r of art.rooms) {
    if (!r.dressed) continue;
    const kept = D.full.includes(r.kind);
    if (kept) sure(!goneRooms.has(r.room) && !r.trimmed, `${r.room} (${r.kind}): kept full, but trimmed`);
    if (r.allowance) sure(r.allowance.kept <= r.allowance.max || !r.trimmed.length, `${r.room}: ${r.allowance.kept} brushes past ${r.allowance.max}`);
    // what makes it one: every group held
    const list = art.props.filter((p) => p.room === r.room);
    sure(requiredOf(list, REQ[r.kind] ?? []).missing.length === 0, `${r.room} (${r.kind}): a required prop missing`);
  }
  sure(art.rooms.some((r) => r.kind === "storeroom" && r.trimmed?.length), "no storeroom trimmed");
});

await testAsync("dressing trade: stage 8's gate fails a room without what makes it one, and a room past its allowance, by its sentence", "dressing trade broken", async () => {
  sure(art, "no 08-dressing to break (the case before failed)");
  const gateSays = async (broken, ...words) => {
    const v = await regate("dressing", broken, { desc, inputs });
    const hit = v.failures.find((f) => words.every((w) => f.includes(w)));
    sure(hit, `the dressing gate did not say ${JSON.stringify(words)}; it said: ${v.failures.slice(0, 4).join(" | ") || "nothing (it passed)"}`);
  };
  const v0 = await regate("dressing", art, { desc, inputs });
  sure(v0.failures.length === 0, v0.failures.slice(0, 3).join(" | "));
  const without = async (roomKind, propKinds, words) => {
    const r = art.rooms.find((x) => x.dressed && x.kind === roomKind && art.props.some((p) => p.room === x.room && propKinds.includes(p.kind)));
    sure(r, `no dressed ${roomKind} with a ${propKinds.join(" or ")}`);
    const b = copy(art);
    b.props = b.props.filter((p) => !(p.room === r.room && propKinds.includes(p.kind)));
    await gateSays(b, `room ${r.room} (${roomKind}): holds no ${words}`, "placement.requiredProps");
  };
  await without("bedroom", ["bed-double", "bed-single"], "bed-double or bed-single");
  await without("shop-floor", ["counter"], "counter");
  await without("office", ["desk"], "desk");
  await without("cell", ["cot", "bunk", "bench"], "cot or bunk or bench");
  await without("kitchen", ["stove"], "stove");
  // a storeroom given back a shelf it was trimmed of: past its allowance
  const s = art.rooms.find((r) => r.kind === "storeroom" && r.trimmed?.some((t) => t.kind === "shelving"));
  sure(s, "no storeroom trimmed of a shelf");
  const bare = copy(RULES);
  delete bare.placement.dressing;
  delete bare.placement.requiredProps;
  const was = stage8.run({ description: desc, rulebook: bare, params: art.params, inputs });
  const shelf = was.props.find((p) => p.id === s.trimmed.find((t) => t.kind === "shelving").id);
  const b = copy(art);
  b.props.push(shelf);
  await gateSays(b, `room ${s.room} (storeroom): its props take`, `wanted ${D.maxBrushesBy.storeroom} or less (placement.dressing.maxBrushesBy.storeroom)`, shelf.id);
});
