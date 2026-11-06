// The map generator's stage 9, forms (levels/experimental-city/stage9-forms.mjs, forms.mjs, forms-deck.mjs) and the sky raised to
// z 28 (2026-11-02): New Byzantium's Core under its deck framed by piers, girders, trusses, coffers, services, the
// fusion band, oculi, pier feet and the spine's drum, passing its gate within the tile's brushes; the same body
// twice; a stale input refused; the gate failing a broken copy by its sentence (a pier in a carriageway, a slender
// pier, a shallow girder, a girder in the clearance, the frame taken off a way, piers too far apart, a pier over a
// way of the layer below, an unguarded oculus, a cut at a new carve height, the wrong frame role, a pier of too
// many brushes, the tile past its brushes, the deck's edge bare); the rulebook's forms entries; the family contract.
import { join } from "node:path";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { testAsync, test, sure, HERE, tmp } from "./helper.mjs";
import { runGenerator, regate } from "../levels/experimental-city/runner.mjs";
import { stage as stage9 } from "../levels/experimental-city/stage9-forms.mjs";
import { familyFaults, formsContext, part, instance } from "../levels/experimental-city/forms.mjs";
import { family as deck } from "../levels/experimental-city/forms-deck.mjs";
import { metreRules } from "../levels/experimental-city/stage3-programs.mjs";
import { loadRules, validateRules, tighten } from "../levels/lib/architecture-rules.mjs";
import { validateCity } from "../levels/lib/city-description.mjs";
import { checkCity } from "../levels/lib/city-checks.mjs";

const SPEC = join(HERE, "../levels/specs/newbyzantium.json");
const RULES = join(HERE, "../levels/rules/architecture.json");
const desc = JSON.parse(readFileSync(SPEC, "utf8"));
const rulebook = JSON.parse(readFileSync(RULES, "utf8"));
const OUT = join(tmp, "gen-forms");
const copy = (v) => JSON.parse(JSON.stringify(v));
let art = null;
let inputs = null;

const gateSays = async (broken, ...words) => {
  const v = await regate("forms", broken, { desc, inputs });
  const hit = v.failures.find((f) => words.every((w) => f.includes(w)));
  sure(hit, `the forms gate did not say ${JSON.stringify(words)}; it said: ${v.failures.slice(0, 4).join(" | ") || "nothing (it passed)"}`);
  return hit;
};
const shift = (poly, dx, dy) => poly.map((p) => [p[0] + dx, p[1] + dy]);
const moveForm = (f, dx, dy) => {
  for (const p of f.parts) {
    p.poly = shift(p.poly, dx, dy);
    if (p.top) p.top = shift(p.top, dx, dy);
  }
  f.at = [f.at[0] + dx, f.at[1] + dy];
};

await testAsync("gen forms: the Core's deck framed, within its brushes, passes stage 9's gate, the same body twice", "gen forms", async () => {
  const res = await runGenerator({ desc, out: OUT, tile: "c1_r1", until: 9 });
  sure(res.ok, `the run: ${res.refused ?? `stopped at ${res.stopped?.n} ${res.stopped?.name}: ${res.stopped?.failures?.slice(0, 2).join(" | ")}`}`);
  const r9 = res.results.find((r) => r.n === 9);
  sure(r9?.pass && r9.file === "09-forms.json", `stage 9: ${JSON.stringify(r9?.failures?.slice(0, 3))}`);
  inputs = {};
  for (const f of readdirSync(OUT)) if (/^0[0-8]-.*\.json$/.test(f)) inputs[f] = JSON.parse(readFileSync(join(OUT, f), "utf8"));
  art = JSON.parse(readFileSync(join(OUT, "09-forms.json"), "utf8"));
  sure(art.format === "smak-gen/1" && art.n === 9 && Object.keys(art.inputs).includes("08-dressing.json"), "09's header");
  // the same body from the same inputs
  const again = stage9.run({ description: desc, rulebook, params: art.params, inputs });
  for (const k of ["forms", "measures", "deck", "families"]) sure(JSON.stringify(again[k]) === JSON.stringify(art[k]), `stage 9 gave a different ${k} the second time`);
  // what it holds: the deck family's forms in the Core
  const m = art.measures;
  for (const F of ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F9"]) sure(m.byForm[F]?.instances > 0, `no ${F} in the Core (${JSON.stringify(m.byForm)})`);
  sure(art.deck.layer === "L2" && art.deck.soffit === 11 && art.deck.top === 12, JSON.stringify(art.deck));
  sure(art.forms.filter((f) => f.kind === "rib").every((r) => r.parts[0].z[1] === 11), "a girder's top off the soffit");
  sure(art.forms.filter((f) => f.kind === "fusion").every((f) => f.mode === "partial"), "the Core's districts are mid: partial fusion");
  sure(m.budget.brushes.total <= m.budget.brushes.limit, `the Core at ${m.budget.brushes.total} brushes, limit ${m.budget.brushes.limit}`);
  sure(m.budget.entities.total <= m.budget.entities.limit, `entities ${m.budget.entities.total} of ${m.budget.entities.limit}`);
  sure(r9.notes.some((n) => /^brushes: \d+ estimated in the tile \(stage 8's \d+ \+ \d+ of forms/.test(n)), "the budget sentence");
});

await testAsync("gen forms: an 08-dressing.json gone stale under it is refused by stage 9", "gen forms stale", async () => {
  sure(art, "no 09-forms (the first case failed)");
  const f = join(OUT, "07-wiring.json");
  const text = readFileSync(f, "utf8");
  writeFileSync(f, text.replace('"stage": "wiring"', '"stage":  "wiring"'));
  const res = await runGenerator({ desc, out: OUT, tile: "c1_r1", from: 9, until: 9 });
  writeFileSync(f, text);
  sure(!res.ok && /08-dressing.json is stale: its input 07-wiring.json changed after it was made/.test(res.refused ?? ""), `refused: ${res.refused}`);
});

await testAsync("gen forms: stage 9's gate fails a broken copy by its sentence", "gen forms broken", async () => {
  sure(art, "no 09-forms to break");
  const piers = art.forms.filter((f) => f.kind === "pier" && f.onKind === "way");
  const pier = piers[0];
  // a pier into the carriageway
  let b = copy(art);
  let p = b.forms.find((f) => f.id === pier.id);
  const way = inputs["01-site.json"].ways.find((w) => w.id === pier.on);
  const pts = way.parts[0];
  const mid = [(pts[0][0] + pts[pts.length - 1][0]) / 2, (pts[0][1] + pts[pts.length - 1][1]) / 2];
  moveForm(p, mid[0] - p.at[0], mid[1] - p.at[1]);
  await gateSays(b, `form ${pier.id} part 0 (prism) enters`, "carriageway");
  // a slender pier (M3)
  b = copy(art);
  b.forms.find((f) => f.id === pier.id).width = 0.5;
  await gateSays(b, `M3: pier ${pier.id} is 0.5 cells wide, at least 1`);
  // a shallow girder, a girder in the clearance (M2)
  const rib = art.forms.find((f) => f.kind === "rib");
  b = copy(art);
  b.forms.find((f) => f.id === rib.id).depth = 0.125;
  await gateSays(b, `M2: girder ${rib.id} is 0.125 cells deep over a`, "span/12 in game height");
  b = copy(art);
  b.forms.find((f) => f.id === rib.id).soffit = 7;
  await gateSays(b, `M2: girder ${rib.id}'s soffit at z 7 is under ${rib.on}'s clearance`);
  // the frame taken off a way (M5)
  b = copy(art);
  b.forms = b.forms.filter((f) => !(["pier", "rib"].includes(f.kind) && f.on === "s2_hearth_w"));
  await gateSays(b, "M5: s2_hearth_w under the deck has a pier, girder or truss within 4 cells on");
  // piers too far apart (M1): the last pier of a side moved 6 cells on along its way
  const run = piers.filter((x) => x.on === "s2_hearth_w" && x.side === "l").sort((x, y) => x.t - y.t);
  sure(run.length >= 2, `piers on s2_hearth_w's left: ${run.length}`);
  b = copy(art);
  b.forms.find((f) => f.id === run[run.length - 1].id).t += 6;
  await gateSays(b, "M1: piers along s2_hearth_w leg", "left stand", "at most 8 (10 past an obstacle)");
  // a pier over a way of the layer below (M4)
  const s1 = inputs["01-site.json"].ways.find((w) => w.id === "s1_main");
  b = copy(art);
  p = b.forms.find((f) => f.id === pier.id);
  const over = [s1.parts[0][0][0], (s1.parts[0][0][1] + s1.parts[0][1][1]) / 2];
  moveForm(p, over[0] - p.at[0], over[1] - p.at[1]);
  await gateSays(b, `M4: pier ${pier.id} does not land: over L1's way s1_main`);
  // an unguarded oculus (M16), a cut at a new carve height (M19)
  const oc = art.forms.find((f) => f.kind === "oculus");
  b = copy(art);
  p = b.forms.find((f) => f.id === oc.id);
  p.parts = p.parts.filter((x) => x.build === "cut");
  await gateSays(b, `M16: oculus ${oc.id} is not guarded`);
  b = copy(art);
  b.forms.find((f) => f.id === oc.id).parts.find((x) => x.build === "cut").z = [10, 12];
  await gateSays(b, `form ${oc.id}: its cut spans z 10 to 12, not the deck's band 11 to 12`, "M19");
  // the wrong frame role (M20), a pier of too many brushes (M18)
  b = copy(art);
  b.forms.find((f) => f.id === pier.id).role = "brick-red";
  await gateSays(b, `form ${pier.id}: wears "brick-red", its layer L2's frame role is "frame-cement" (M20)`);
  b = copy(art);
  p = b.forms.find((f) => f.id === pier.id);
  p.brushes = 6;
  await gateSays(b, `form ${pier.id}: a pier of 6 brushes, at most 4 (forms.maxBrushesBy, M18)`);
  // the tile past its brushes: coffers a thousand beams heavier
  b = copy(art);
  const cf = b.forms.find((f) => f.kind === "coffers");
  cf.parts = [...Array(600)].map(() => copy(cf.parts[0]));
  cf.brushes = 600;
  await gateSays(b, "brushes:", "estimated in the tile", "past the limit");
  // the deck's edge bare (M7): a bay of one bracket and a short fascia, on a tile that has none, checked by the family
  const fx = formsContext({ description: desc, inputs, params: art.params }, metreRules({ rulebook, description: desc }));
  const edge = instance({ id: "deck.edge.test", family: "deck", form: "F8", kind: "deck-edge", layer: "L2", frame: true, role: "frame-cement", side: "s", t: [0, 8], at: [60, 22], brackets: 1, fasciaHeight: 0.5, pier: null, parts: [part("box", [[56, 21.75], [64, 21.75], [64, 22], [56, 22]], [11.5, 12])] }); // prettier-ignore
  const v = deck.check([edge], fx);
  sure(v.failures.some((f) => f.includes("M7: deck.edge.test's fascia is 0.5 cells high, at least 1")), v.failures.join(" | "));
  sure(v.failures.some((f) => f.includes("M7: deck.edge.test has 1 brackets over 8 cells")), v.failures.join(" | "));
  sure(v.failures.some((f) => f.includes("M7: the deck's s edge in the tile has no edge pier")), v.failures.join(" | "));
});

test("gen forms: the rulebook's forms entries carry their sources, never loosened; the family contract", () => {
  const r = loadRules();
  for (const [k, v] of Object.entries(r.forms)) if (v && typeof v === "object" && !Array.isArray(v) && k !== "maxBrushesBy") sure(v.source?.length && v.note, `forms.${k} without its source or note`); // prettier-ignore
  const bad = copy(r);
  delete bad.forms.girder.source;
  bad.forms.fusion.modeByWealth.low = "melted";
  const errs = validateRules(bad).errors;
  sure(errs.some((e) => e.startsWith("forms.girder.source")) && errs.some((e) => e.startsWith("forms.fusion.modeByWealth.low")), errs.join(" | "));
  const t = tighten(r, { forms: { pier: { pitch: { max: 30 } }, girder: { minDepthPerSpan: 0.05 } } });
  sure(t.errors.some((e) => e.includes("forms.pier.pitch.max")) && t.errors.some((e) => e.includes("forms.girder.minDepthPerSpan")), t.errors.join(" | ")); // prettier-ignore
  sure(familyFaults(deck).length === 0, familyFaults(deck).join("; "));
  const faults = familyFaults({ id: "Bad Name", order: "x", forms: ["pier"] });
  sure(faults.length === 4, faults.join("; "));
});

test("gen forms: the sky raised to z 28 over L3 and L2's ring, held by the description's checks", () => {
  sure(desc.layers.find((L) => L.id === "L3").sky === 28 && desc.layers.find((L) => L.id === "L2").sky === 28, "the sky");
  sure(validateCity(desc).errors.length === 0 && checkCity(desc).pass, "New Byzantium as described");
  const low = copy(desc);
  low.layers.find((L) => L.id === "L3").sky = 18;
  sure(validateCity(low).errors.some((e) => e.includes("(L3).sky: wanted the sky lid's height in cells, at or above the layer's top 20")), validateCity(low).errors.join(" | ")); // prettier-ignore
  const two = copy(desc);
  two.layers.find((L) => L.id === "L2").sky = 24;
  sure(validateCity(two).errors.some((e) => e.includes("L2's sky (z 24) rises past L3's floor") && e.includes("wanted one lid")), validateCity(two).errors.join(" | ")); // prettier-ignore
  const vault = copy(desc);
  vault.layers.find((L) => L.id === "L1").sky = 9;
  sure(validateCity(vault).errors.some((e) => e.includes("(L1).sky: only a layer open to the sky")), validateCity(vault).errors.join(" | ")); // prettier-ignore
  const role = copy(desc);
  role.layers.find((L) => L.id === "L2").frame = "no-such-role";
  sure(validateCity(role).errors.some((e) => e.includes('(L2).frame: "no-such-role" is no material\'s role')), validateCity(role).errors.join(" | ")); // prettier-ignore
});
