// The map generator's stage 9, the facade and skyline family (levels/gen/forms-facade.mjs): New Byzantium's Core with
// its fronts broken by pilasters, lesenes, drop pipes, bays, cages, loggias and buttresses, corner pieces at its
// nodes, rooflines, setback tiers for the skyline, the Nexus tower's crown, passing stage 9's gate within the tile's
// brushes (the forms on enterable buildings paid from their facade allowance); the same body twice; the gate failing
// a broken copy by its sentence (fronts stripped: M8, M9, M10, M11; the skyline flattened: M12; a tier to a new
// carve height: M19; a tier on the street line: F16; a landmark too low: M13; a pilaster of too many brushes: M18;
// the frame's role on a front; a claim past a building's allowance; a form inside another; a capital off its
// column); the rulebook's facade entries and their validator; a dome over a named room.
import { join } from "node:path";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { testAsync, test, sure, HERE, tmp } from "./helper.mjs";
import { runGenerator, regate } from "../levels/gen/runner.mjs";
import { stage as stage9 } from "../levels/gen/stage9-forms.mjs";
import { familyFaults, formsContext } from "../levels/gen/forms.mjs";
import { family as facade, _internal as F } from "../levels/gen/forms-facade.mjs";
import { metreRules } from "../levels/gen/stage3-programs.mjs";
import { loadRules, validateRules, tighten } from "../levels/lib/architecture-rules.mjs";

const SPEC = join(HERE, "../levels/specs/newbyzantium.json");
const RULES = join(HERE, "../levels/rules/architecture.json");
const desc = JSON.parse(readFileSync(SPEC, "utf8"));
const rulebook = JSON.parse(readFileSync(RULES, "utf8"));
const copy = (v) => JSON.parse(JSON.stringify(v));
let art = null;
let inputs = null;

const gateSays = async (broken, words, d = desc) => {
  const v = await regate("forms", broken, { desc: d, inputs });
  const hit = v.failures.find((f) => words.every((w) => f.includes(w)));
  sure(hit, `the forms gate did not say ${JSON.stringify(words)}; it said: ${v.failures.slice(0, 4).join(" | ") || "nothing (it passed)"}`);
  return hit;
};

await testAsync("gen forms facade: the Core's fronts, corners and skyline worked, within its brushes, pass stage 9's gate, the same body twice", "gen forms facade", async () => {
  // the stage 9 test's run when it ran before in this process, else a run of our own
  let dir = join(tmp, "gen-forms");
  if (!existsSync(join(dir, "09-forms.json"))) {
    dir = join(tmp, "gen-forms-facade");
    const res = await runGenerator({ desc, out: dir, tile: "c1_r1", until: 9 });
    sure(res.ok, `the run: ${res.refused ?? `stopped at ${res.stopped?.n} ${res.stopped?.name}: ${res.stopped?.failures?.slice(0, 2).join(" | ")}`}`);
  }
  inputs = {};
  for (const f of readdirSync(dir)) if (/^0[0-8]-.*\.json$/.test(f)) inputs[f] = JSON.parse(readFileSync(join(dir, f), "utf8"));
  art = JSON.parse(readFileSync(join(dir, "09-forms.json"), "utf8"));
  const v = await regate("forms", art, { desc, inputs });
  sure(v.failures.length === 0, `stage 9's gate: ${v.failures.slice(0, 3).join(" | ")}`);
  const fam = art.families.find((f) => f.id === "facade");
  sure(fam && fam.placed > 0, `the facade family placed nothing: ${JSON.stringify(art.families)}`);
  const mine = art.forms.filter((f) => f.family === "facade");
  for (const k of ["pilaster", "corner", "setback", "tower-crown", "roofline", "buttress"]) sure(mine.some((f) => f.kind === k), `no ${k} in the Core`);
  // the Nexus tower's crown within its own height, paid by the estimate's crown and cap
  const crown = mine.find((f) => f.kind === "tower-crown");
  sure(crown.on === "msr_nexus" && crown.top === 27 && crown.allowance === crown.brushes && crown.allowanceOf.kind === "tower", JSON.stringify(crown).slice(0, 300));
  // setbacks only to heights L3 already carves
  for (const s of mine.filter((f) => f.kind === "setback")) sure(F.carveHeightsOf(formsContext({ description: desc, inputs, params: art.params }, metreRules({ rulebook, description: desc })), s.layer).includes(s.top), `${s.id} to z ${s.top}`); // prettier-ignore
  // the regime's buildings paid from their facade allowance, each claim within it
  sure(mine.some((f) => f.allowanceOf?.building === "msr_nexus" && f.allowanceOf.kind === "facade"), "the Nexus's buttresses claim nothing");
  const B = art.measures.budget.brushes;
  sure(B.total <= B.limit && B.allowance > 0, `the Core at ${B.total} of ${B.limit} (allowance ${B.allowance})`);
  // each form on its lot's palette, never the frame's
  sure(mine.every((f) => !f.frame && f.role !== "frame-cement" && f.role !== "frame-marble-gold"), "a facade form in the frame's role");
  sure(v.notes.some((n) => /^facade: M13: d3_mese's landmark msr_nexus \(round\) at z 27/.test(n)), "M13's note");
  // the same body from the same inputs
  const again = stage9.run({ description: desc, rulebook, params: art.params, inputs });
  sure(JSON.stringify(again.forms.filter((f) => f.family === "facade")) === JSON.stringify(mine), "the facade family gave different forms the second time");
});

await testAsync("gen forms facade: stage 9's gate fails a broken copy by its sentence", "gen forms facade broken", async () => {
  sure(art, "no 09-forms to break");
  const mine = art.forms.filter((f) => f.family === "facade");
  // the fronts stripped: M8 (a long run), M9 (a bare front), M10 (a bare corner), M11 (one massing everywhere)
  let b = copy(art);
  b.forms = b.forms.filter((f) => f.family !== "facade");
  for (const w of [["M8: face", "unbroken"], ["M9:", "has no element"], ["M10: block corner", "has no corner treatment"], ["M11:", "share one massing"]]) await gateSays(b, w); // prettier-ignore
  // the skyline flattened (M12)
  b = copy(art);
  b.forms = b.forms.filter((f) => f.kind !== "setback");
  await gateSays(b, ["M12:"]);
  // a tier to a new carve height (M19), a tier on the street line (F16)
  const tier = mine.find((f) => f.kind === "setback");
  b = copy(art);
  let t = b.forms.find((f) => f.id === tier.id);
  t.top = 18;
  t.parts[0].z = [t.parts[0].z[0], 18];
  await gateSays(b, [`M19: setback ${tier.id} rises to z 18, no carve height`]);
  b = copy(art);
  t = b.forms.find((f) => f.id === tier.id);
  const lot = inputs["02-lots.json"].lots.find((l) => l.id === tier.on);
  t.parts[0].poly = [[lot.rect.x, lot.rect.y], [lot.rect.x + lot.rect.w, lot.rect.y], [lot.rect.x + lot.rect.w, lot.rect.y + lot.rect.d], [lot.rect.x, lot.rect.y + lot.rect.d]]; // prettier-ignore
  await gateSays(b, [`F16: setback ${tier.id} stands 0 cells from ${tier.on}'s`]);
  // a landmark too low (M13): the Nexus tower of one storey
  const low = copy(desc);
  low.buildings.find((x) => x.id === "msr_nexus").tower.storeys = 1;
  b = copy(art);
  b.forms = b.forms.filter((f) => f.kind !== "tower-crown");
  await gateSays(b, ["M13: district d3_mese's landmark msr_nexus tops out at z 18, at least 19.5"], low);
  // a pilaster of too many brushes (M18), the frame's role on a front, a claim past a building's allowance
  const pil = mine.find((f) => f.kind === "pilaster");
  b = copy(art);
  b.forms.find((f) => f.id === pil.id).brushes = 3;
  await gateSays(b, [`form ${pil.id}: a pilaster of 3 brushes, at most 1 (forms.maxBrushesBy, M18)`]);
  b = copy(art);
  b.forms.find((f) => f.id === pil.id).role = "frame-cement";
  await gateSays(b, [`form ${pil.id}: wears the frame's role "frame-cement"`]);
  const paid = mine.find((f) => f.allowanceOf?.kind === "facade");
  b = copy(art);
  b.forms.find((f) => f.id === paid.id).allowance = 99;
  await gateSays(b, [`form ${paid.id}: claims 99 brushes of ${paid.allowanceOf.building}'s facade allowance, more than its`]);
  b = copy(art);
  for (const f of b.forms.filter((x) => x.allowanceOf?.building === "msr_nexus" && x.allowanceOf.kind === "facade")) (f.allowance = f.brushes), (f.brushes += 0); // prettier-ignore
  b.forms.push(...Array.from({ length: 70 }, (_, i) => ({ ...copy(b.forms.find((f) => f.allowanceOf?.building === "msr_nexus" && f.kind === "buttress")), id: `facade.extra.${i}`, parts: [] }))); // prettier-ignore
  b.forms.slice(-70).forEach((f) => (f.parts = copy(mine.find((x) => x.kind === "buttress" && x.on === "msr_nexus").parts)) && (f.parts.forEach((p) => (p.z = [p.z[0] + 30, p.z[1] + 30])))); // prettier-ignore
  await gateSays(b, ["allowance: the forms claim", "of msr_nexus's facade allowance, the description's estimate gives it 120"]);
  // a form inside another: a copy of a pilaster under another name
  b = copy(art);
  b.forms.push({ ...copy(pil), id: `${pil.id}.twin` });
  await gateSays(b, [`enters ${pil.id}.twin by`]);
  // F22 and F27: a dome on a layer under the deck, a capital off its column's top
  const cap = mine.find((f) => f.kind === "capital");
  if (cap) {
    b = copy(art);
    b.forms.find((f) => f.id === cap.id).parts[0].z = [13, 13.25];
    await gateSays(b, [`F27: capital ${cap.id}'s top at z 13.25, not its column's top`]);
  }
});

test("gen forms facade: the rulebook's facade entries carry their sources, never loosened; the family contract; a dome over a named room", () => {
  const r = loadRules();
  for (const k of ["facade", "facadeThemes", "pilaster", "buttress", "balcony", "gallery", "bay", "cage", "setback", "corner", "wallServices", "dome", "towerCrown", "roofline", "capital", "massing", "skyline", "landmark"]) sure(r.forms[k]?.source?.length && r.forms[k].note, `forms.${k} without its source or note`); // prettier-ignore
  for (const k of ["pilaster", "buttress", "bay", "cage", "setback", "corner", "pipe", "roofline", "tower-crown", "capital", "gallery"]) sure(Number.isInteger(r.forms.maxBrushesBy[k]), `maxBrushesBy.${k}`); // prettier-ignore
  const bad = copy(r);
  bad.forms.facadeThemes.mid.corners = ["pier", "pier", "quoin", "quoin"];
  bad.forms.facadeThemes.low.patterns = ["cage", "balloon"];
  bad.forms.dome.over = ["hall", "throne-room"];
  bad.forms.massing.minDiffer = 9;
  delete bad.forms.skyline.source;
  const errs = validateRules(bad).errors;
  for (const w of ["forms.facadeThemes.mid.corners: wanted 4 different corner pieces", 'forms.facadeThemes.low.patterns: no such pattern "balloon"', 'forms.dome.over: no such room kind "throne-room"', "forms.massing.minDiffer", "forms.skyline.source"]) sure(errs.some((e) => e.startsWith(w)), `${w}: ${errs.join(" | ")}`); // prettier-ignore
  const t = tighten(r, { forms: { massing: { maxRepeatShare: 0.5 }, skyline: { minHeights: 2 }, facade: { unbroken: { ground: { max: 20 } } } } });
  for (const w of ["forms.massing.maxRepeatShare", "forms.skyline.minHeights", "forms.facade.unbroken.ground.max"]) sure(t.errors.some((e) => e.includes(w)), `${w}: ${t.errors.join(" | ")}`); // prettier-ignore
  sure(familyFaults(facade).length === 0, familyFaults(facade).join("; "));
  // a dome over a 6 x 6 salon on a roof at z 15: a drum, three shells and a lantern, ribs, within maxBrushesBy.dome
  const R = { across: { min: 4, max: 10 }, drum: { height: { typical: 1 } }, rise: 0.5, lantern: { height: { typical: 0.5 } }, ribs: 8 };
  const fx = { cell: 3.2512, rules: r, R: {} };
  const lt = { top: 15, L: { sky: 28, top: 20 } };
  const d = F.domeOn(fx, lt, { cells: [{ x: 10, y: 10, w: 6, d: 6 }] }, R);
  sure(d.parts && d.parts.length <= r.forms.maxBrushesBy.dome && d.parts.filter((p) => p.build === "world").length === 4 && d.top <= 28, JSON.stringify(d).slice(0, 200)); // prettier-ignore
  sure(/a dome at least 4/.test(F.domeOn(fx, lt, { cells: [{ x: 0, y: 0, w: 3, d: 6 }] }, R).why ?? ""), "a small room took a dome");
});
