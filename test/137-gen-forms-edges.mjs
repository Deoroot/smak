// The map generator's stage 9, the edges family (levels/experimental-city/forms-edges.mjs): New Byzantium's Core with its
// undercity vaulted (chamfers and ribs over the ways), the Cistern a column hall at 2-2.5 cells with architraves,
// giant fans and light shafts under the deck, an arcade, raised daises, the room echoes and the city's hum, the
// worldspawn keys (MaxRange, the sky's name) handed to the geometry, within the tile's brushes; the same body twice;
// the edge mechanics on fixtures (the Core reaches no side of the city; the edge tiles' later stages do not run
// yet): two edge tiles' own site and lots with stages 4-8 empty, where the wall gets its towers on one rhythm, the
// backdrop its pockets, cards, a model, a train, the gate its road going on, the Drains a bottomless shaft under a
// grate, the canal its arches; and every check failing a broken copy by its sentence (M14, M15, M17, M21, V3, V4,
// V7, V8, F25, the city's sound loops); the rulebook's entries for the family.
import { join } from "node:path";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { testAsync, test, sure, HERE, tmp } from "./helper.mjs";
import { runGenerator } from "../levels/experimental-city/runner.mjs";
import { stage as stage9 } from "../levels/experimental-city/stage9-forms.mjs";
import { familyFaults, formsContext, commonChecks, loadFamilies } from "../levels/experimental-city/forms.mjs";
import { family as edges, _internal as E } from "../levels/experimental-city/forms-edges.mjs";
import { family as deck } from "../levels/experimental-city/forms-deck.mjs";
import { brushBudgetOf } from "../levels/experimental-city/dressing.mjs";
import { metreRules } from "../levels/experimental-city/stage3-programs.mjs";
import { loadRules, validateRules, tighten } from "../levels/lib/architecture-rules.mjs";

const SPEC = join(HERE, "../levels/specs/newbyzantium.json");
const RULES = join(HERE, "../levels/rules/architecture.json");
const desc = JSON.parse(readFileSync(SPEC, "utf8"));
const rulebook = JSON.parse(readFileSync(RULES, "utf8"));
const copy = (v) => JSON.parse(JSON.stringify(v));
const has = (list, ...words) => list.some((f) => words.every((w) => f.includes(w)));
const say = (r) => r.failures.slice(0, 4).join(" | ") || "nothing (it passed)";
const fxOf = (inputs, params = { seed: 1 }) => formsContext({ description: desc, inputs, params }, metreRules({ rulebook, description: desc }));

/** The family's check on its own forms of a list (the others as placed), the world as given. */
const checkOf = (forms, fx, world) => edges.check(forms.filter((f) => f.family === "edges"), { ...fx, placed: forms }, world);

let core = null;

await testAsync("gen forms edges: the Core's undercity vaulted, the Cistern a column hall, fans and light under the deck, the worldspawn keys, within its brushes", "gen forms edges", async () => {
  // the deck family's test (134) ran the Core to stage 9 into tmp/gen-forms; run it here when it did not
  // (SMAK_GEN_FORMS: a folder of 00-09 to read instead, while the chain before stage 9 is being worked on)
  let OUT = process.env.SMAK_GEN_FORMS ?? join(tmp, "gen-forms");
  if (!existsSync(join(OUT, "09-forms.json"))) {
    OUT = join(tmp, "gen-forms-edges");
    const res = await runGenerator({ desc, out: OUT, tile: "c1_r1", until: 9 });
    sure(res.ok, `the run: ${res.refused ?? `stopped at ${res.stopped?.n} ${res.stopped?.name}: ${res.stopped?.failures?.slice(0, 2).join(" | ")}`}`);
  }
  const inputs = {};
  for (const f of readdirSync(OUT)) if (/^0[0-8]-.*\.json$/.test(f)) inputs[f] = JSON.parse(readFileSync(join(OUT, f), "utf8"));
  const art = JSON.parse(readFileSync(join(OUT, "09-forms.json"), "utf8"));
  sure(art.gate?.pass !== false, `stage 9's gate: ${(art.gate?.failures ?? []).slice(0, 3).join(" | ")}`);
  const mine = art.forms.filter((f) => f.family === "edges");
  const kinds = new Set(mine.map((f) => f.kind));
  for (const k of ["vault", "vault-rib", "cistern-column", "fan", "light-shaft", "sounds"]) sure(kinds.has(k), `no ${k} in the Core (${[...kinds].join(", ")})`);
  const cols = mine.filter((f) => f.kind === "cistern-column");
  sure(cols.every((c) => c.on === "n1_cistern" && c.pitch >= 2 && c.pitch <= 2.5 && Math.max(...c.parts.map((p) => p.z[1])) === 4), "the Cistern's columns at 2-2.5 cells, to the vault at z 4"); // prettier-ignore
  sure(art.families.some((f) => f.id === "edges" && f.order === 20), JSON.stringify(art.families.map((f) => f.id)));
  // the world handed to the geometry
  sure(art.world?.worldspawn?.MaxRange === 32768 && art.world.worldspawn.skyname === "nbstorm", JSON.stringify(art.world?.worldspawn));
  sure(art.world.edge.tileSides.length === 0 && art.world.edge.wallTop === 20 && art.world.edge.loops.count <= 5, JSON.stringify(art.world.edge).slice(0, 300)); // prettier-ignore
  // within the tile's brushes and entities; the fans' entities one each though they are 5 brushes
  const m = art.measures;
  sure(m.budget.brushes.total <= m.budget.brushes.limit && m.budget.entities.total <= m.budget.entities.limit, JSON.stringify(m.budget.brushes));
  for (const fan of mine.filter((f) => f.kind === "fan")) sure(fan.entities === 1 && fan.brushes === 5 && fan.brushModels === 1, JSON.stringify(fan).slice(0, 200)); // prettier-ignore
  // the same body from the same inputs
  const again = stage9.run({ description: desc, rulebook, params: art.params, inputs });
  sure(JSON.stringify(again.forms.filter((f) => f.family === "edges")) === JSON.stringify(mine) && JSON.stringify(again.world) === JSON.stringify(art.world), "stage 9 gave the edges family's forms differently the second time"); // prettier-ignore
  // its check passes on the artifact
  const fx = fxOf(inputs, art.params);
  const v = checkOf(art.forms, fx, art.world);
  sure(!v.failures.length, say(v));
  core = { art, inputs, fx };
});

await testAsync("gen forms edges: the Core's checks fail a broken copy by their sentence (M17, M15, V4, V8, F25)", "gen forms edges broken", async () => {
  sure(core, "no Core (the first case failed)");
  const { art, fx } = core;
  // a leg's ribs taken away
  const rib = art.forms.find((f) => f.kind === "vault-rib");
  let b = art.forms.filter((f) => !(f.kind === "vault-rib" && f.on === rib.on));
  let v = checkOf(b, fx, art.world);
  sure(has(v.failures, `M17: ${rib.on} leg ${rib.leg} has no rib for`, "at most 6 (forms.vault)"), say(v));
  // the Cistern's columns 3 cells apart, one short of the vault, most of them gone
  b = copy(art.forms);
  for (const c of b.filter((f) => f.kind === "cistern-column")) c.pitch = 3;
  v = checkOf(b, fx, art.world);
  sure(has(v.failures, "M17: the columns of n1_cistern stand 3 cells apart, wanted 2 to 2.5"), say(v));
  b = copy(art.forms);
  const col = b.find((f) => f.kind === "cistern-column");
  col.parts[1].z = [3, 3.5];
  v = checkOf(b, fx, art.world);
  sure(has(v.failures, `M17: column ${col.id} stands z 0 to 3.75, wanted the hall's full height 0 to 4`), say(v));
  b = art.forms.filter((f) => f.kind !== "cistern-column" || f.id.endsWith(".0"));
  v = checkOf(b, fx, art.world);
  sure(has(v.failures, "M17: 1 of 25 columns of n1_cistern's grid stand, at least 50 %"), say(v));
  // worldspawn's far clip short, no sky name
  v = checkOf(art.forms, fx, { ...art.world, worldspawn: { MaxRange: 4096 } });
  sure(has(v.failures, "V4: worldspawn MaxRange 4096 is under the longest line to the backdrop") && has(v.failures, "S1: worldspawn has no skyname"), say(v)); // prettier-ignore
  // a fan with nothing human-sized near it, a dais sunk and one raised past a step
  b = copy(art.forms);
  const fan = b.find((f) => f.kind === "fan");
  fan.at = [200, 200];
  v = checkOf(b, fx, art.world);
  sure(has(v.failures, `V8: fan ${fan.id} has nothing human-sized`), say(v));
  b = copy(art.forms);
  const dais = b.find((f) => f.kind === "dais");
  sure(dais, "no dais in the Core");
  const floor = fx.layerOf(dais.layer).floor;
  dais.parts[0].z = [floor - 0.5, floor];
  v = checkOf(b, fx, art.world);
  sure(has(v.failures, `F25: ${dais.id} sinks under`, "never sunk"), say(v));
  dais.parts[0].z = [floor, floor + 0.5];
  v = checkOf(b, fx, art.world);
  sure(has(v.failures, `F25: ${dais.id} rises 0.5 cells with no flight`), say(v));
  // M15: a long way with nothing to see (the plazas and every form taken away from the context)
  const bare = { ...fx, site: { ...fx.site, plazas: [], ways: [{ id: "w_long", layer: "L2", access: "public", class: "street", parts: [[[42, 60], [78, 60]]] }] }, lots: { lots: [] }, deck: null }; // prettier-ignore
  v = edges.check([], { ...bare, placed: [] }, null);
  sure(has(v.failures, "M15: w_long runs", "with no view", "at most 25"), say(v));
});

/** An edge tile's fixture: its own site and lots from stages 1-2 (written even where stage 2's gate stops), 4-8 empty. */
async function edgeFixture(tile, { lots = true } = {}) {
  const out = join(tmp, `gen-edge-${tile}`);
  await runGenerator({ desc, out, tile, until: lots ? 2 : 1 });
  const site = JSON.parse(readFileSync(join(out, "01-site.json"), "utf8"));
  const lotsArt = lots && existsSync(join(out, "02-lots.json")) ? JSON.parse(readFileSync(join(out, "02-lots.json"), "utf8")) : { tile: site.tile, lots: [], blocks: [] }; // prettier-ignore
  const inputs = {
    "01-site.json": site,
    "02-lots.json": lotsArt,
    "04-network.json": { tile, connectors: [], hallways: [], checkpoints: [], posts: [], colonnades: [], spawns: [] },
    "05-plans.json": { tile, buildings: [] },
    "08-dressing.json": { tile, props: [], measures: { brushBudget: brushBudgetOf(desc, tile, [], []), modelProps: { wiringEntities: 0, placed: 0, limit: Math.floor(1650 * 0.25) } } }, // prettier-ignore
  };
  const fx = fxOf(inputs);
  const placed = deck.place({ ...fx, placed: [] }).forms.map((f) => ({ ...f, family: "deck" }));
  const got = edges.place({ ...fx, placed });
  const forms = [...placed, ...got.forms.map((f) => ({ ...f, family: "edges" }))];
  return { fx, forms, got, world: got.world };
}

await testAsync("gen forms edges: on edge tiles (fixtures), the wall's towers on one rhythm, the backdrop's pockets, cards and motion, a gate's road, a shaft, the canal's arches", "gen forms edges fixture", async () => {
  // the west side: c0_r1 (the Stacks and the Drains)
  const W = await edgeFixture("c0_r1");
  sure(!W.got.failures.length, W.got.failures.join(" | "));
  const mine = W.got.forms;
  const towers = mine.filter((f) => f.kind === "wall-tower");
  sure(towers.length >= 2 && towers.every((t) => t.side === "w" && t.projection >= 2 && t.parts[0].z[1] >= 21.5 && t.parts.some((p) => p.what === "door")), JSON.stringify(towers.map((t) => [t.id, t.t]))); // prettier-ignore
  for (let i = 1; i < towers.length; i++) sure(towers[i].t - towers[i - 1].t >= 15 - 2 && towers[i].t - towers[i - 1].t <= 20, `towers ${towers[i - 1].t} and ${towers[i].t}`); // prettier-ignore
  const pk = W.world.edge.pockets;
  sure(pk.length === 1 && pk[0].side === "w" && pk[0].box[0] === -30 && pk[0].z[0] === 20 && pk[0].z[1] === 28 && pk[0].cards.length >= 2, JSON.stringify(pk)); // prettier-ignore
  const bd = mine.find((f) => f.kind === "backdrop");
  sure(bd.parts.filter((p) => p.entity === "func_train").length === 3 && bd.points.filter((p) => p.classname === "path_corner").length === 2 && bd.entities === 5, JSON.stringify(bd).slice(0, 300)); // prettier-ignore
  const shaft = mine.find((f) => f.kind === "shaft");
  sure(shaft && shaft.on === "n1_drains" && shaft.rock === 20 && shaft.parts.some((p) => p.build === "cut" && p.shaft && p.z[1] === 0), JSON.stringify(shaft).slice(0, 300)); // prettier-ignore
  sure(mine.some((f) => f.kind === "cistern-column" && f.on === "n1_drains"), "the Drain Market a column hall");
  // the common rules and the family's check on its own forms pass
  const families = await loadFamilies();
  const cc = commonChecks(W.forms.filter((f) => f.family === "edges"), W.fx, families);
  sure(!cc.failures.length, cc.failures.slice(0, 4).join(" | "));
  let v = checkOf(W.forms, W.fx, W.world);
  sure(!v.failures.length, say(v));
  // M14: a tower taken away; V4: a card past the lid; V7: the shaft's grate gone; M19: a shaft not down from the floor
  let b = W.forms.filter((f) => f.id !== towers[0].id);
  v = checkOf(b, W.fx, W.world);
  sure(has(v.failures, "M14: the w wall's towers leave", "at most 20") || has(v.failures, "M14: towers on the w wall stand"), say(v));
  b = copy(W.forms);
  const card = b.find((f) => f.kind === "card");
  card.parts[0].z = [20, 30];
  v = checkOf(b, W.fx, W.world);
  sure(has(v.failures, `V4: ${card.id}'s skyline card rises past the sky lid 28`), say(v));
  b = copy(W.forms);
  const sh = b.find((f) => f.kind === "shaft");
  sh.parts = sh.parts.filter((p) => p.build === "cut");
  v = checkOf(b, W.fx, W.world);
  sure(has(v.failures, `V7: shaft ${sh.id} is not guarded`), say(v));
  sh.parts[0].z = [-16, -2];
  const c2 = commonChecks([sh], W.fx, families);
  sure(has(c2.failures, `form ${sh.id}: its shaft spans z -16 to -2, wanted from below down to L1's floor 0 (M19)`), c2.failures.join(" | "));
  // M21 and M14: the wall's top under the open layers' eyes (a rulebook copy with the wall low)
  const low = { ...W.fx, R: { ...W.fx.R, wall: { ...W.fx.R.wall, top: { min: 10 } } } };
  v = checkOf(W.forms, low, W.world);
  sure(has(v.failures, "M21: the wall's top z 10 is under L3's eye z 12.5"), say(v));
  sure(E.tileSides(W.fx, E.cityPlan(W.fx)).map((x) => x.side).join() === "w", "c0_r1 reaches the west side");

  // the south side: c1_r0 (the front gate, the canal), its site only (its stage 1 stops on the gate's plaza)
  const S = await edgeFixture("c1_r0", { lots: false });
  sure(!S.got.failures.length, S.got.failures.join(" | "));
  const road = S.got.forms.find((f) => f.kind === "gate-road");
  sure(road && road.on === "n2_gate" && road.points.filter((p) => p.what === "road lamp").length >= 6 && S.world.edge.roads[0].box[1] === -25, JSON.stringify(road).slice(0, 300)); // prettier-ignore
  const gate = S.got.forms.filter((f) => f.kind === "wall-tower" && f.gate === "n2_gate");
  sure(gate.length === 2, `gate towers ${gate.map((t) => t.id)}`);
  const arches = S.got.forms.filter((f) => f.kind === "canal-arch");
  // two since the Pump Bridge and the Outfall became basin squares (2026-11-02): s1_canal_m2's stretch holds them
  sure(arches.length >= 2 && arches.every((a) => a.parts.length === 4 && a.parts.every((p) => p.shape === "voussoir" && p.soffit)), JSON.stringify(arches.map((a) => a.id))); // prettier-ignore
  v = checkOf(S.forms, S.fx, S.world);
  sure(!v.failures.length, say(v));
  b = copy(S.forms);
  b.find((f) => f.id === road.id).parts.find((p) => p.what === "end card").z = [5, 5.25];
  v = checkOf(b, S.fx, S.world);
  sure(has(v.failures, `M21: ${road.id} does not end in a card from its floor past the eye`), say(v));
  // V3: the gate's floor at the wall with no gate described there, no tower and no relief: a bare face
  b = S.forms.filter((f) => f.kind !== "wall-face" && f.kind !== "wall-tower");
  const noGate = { ...S.fx, desc: { ...desc, streets: { ...desc.streets, nodes: desc.streets.nodes.filter((n) => n.id !== "n2_gate") } } };
  v = checkOf(b, noGate, S.world);
  sure(has(v.failures, "V3: the s wall is a bare face at", "no tower, pilaster or gate within 2 cells"), say(v));
  b = S.forms.filter((f) => !(f.kind === "canal-arch" && f.on === arches[0].on && f.leg === arches[0].leg));
  v = checkOf(b, S.fx, S.world);
  sure(has(v.failures, `M17: ${arches[0].on} leg ${arches[0].leg} has no arch for`), say(v));
  // the city's sound loops past their most
  const loud = { ...S.fx, R: { ...S.fx.R, scaleIllusion: { ...S.fx.R.scaleIllusion, sounds: { maxPerCity: 2 } } } };
  v = checkOf(S.forms, loud, S.world);
  sure(has(v.failures, "S6: 4 distant sound loops in the city", "at most 2"), say(v));
});

test("gen forms edges: the rulebook's entries carry their sources, never loosened; validator cases; the family contract", () => {
  const r = loadRules();
  for (const k of ["edges", "vault", "cistern", "arcade", "gantry", "ground", "wall", "backdrop", "scaleIllusion"]) sure(r.forms[k]?.source?.length && r.forms[k].note, `forms.${k} without its source or note`); // prettier-ignore
  for (const k of ["vault", "vault-rib", "canal-arch", "cistern-column", "architrave", "gantry", "dais", "wall-face", "card", "fan", "shaft"]) sure(Number.isInteger(r.forms.maxBrushesBy[k]), `maxBrushesBy.${k}`); // prettier-ignore
  const bad = copy(r);
  bad.forms.ground.step.max = 0.6;
  bad.forms.vault.canalArch.segments = 2;
  bad.forms.edges.maxShareOfHeadroom = 1.5;
  bad.forms.backdrop.farClipMargin = -1;
  delete bad.forms.wall.source;
  const errs = validateRules(bad).errors;
  for (const w of ["forms.ground.step.max: 0.6 m is past goldsrc's step", "forms.vault.canalArch.segments", "forms.edges.maxShareOfHeadroom", "forms.backdrop.farClipMargin", "forms.wall.source"]) sure(errs.some((e) => e.startsWith(w)), `${w}: ${errs.join(" | ")}`); // prettier-ignore
  const t = tighten(r, { forms: { cistern: { pitch: { max: 9 } }, wall: { tower: { pitch: { max: 70 } } }, vault: { rib: { every: { max: 25 } } } } });
  for (const w of ["forms.cistern.pitch.max", "forms.wall.tower.pitch.max", "forms.vault.rib.every.max"]) sure(t.errors.some((e) => e.includes(w)), t.errors.join(" | "));
  sure(familyFaults(edges).length === 0, familyFaults(edges).join("; "));
  const R = metreRules({ rulebook, description: desc }).forms;
  sure(R.cistern.pitch.max === 8.13 && r.forms.scaleIllusion.fan.blades === 4, "the rulebook in metres");
});
