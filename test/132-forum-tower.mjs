// The R1 review's remarks on the Core's Nexus Forum (2026-11-02): (1) the forum sized from data and framed, the
// Nexus a tower: the rulebook's squares (an open span no wider than the games' p90 sight, a wide square framed by a
// portico and a monument), porticoes, monuments and towers, each with its source; the format's plaza `portico` and
// `monuments` and building `tower`; the checks holding them; (2) stairs, bridges and hallways on the axes of the
// streets and plazas (circulation.axial): the description's check, stage 4's routing (orthogonal legs, a stair's
// L turning at a landing, a switchback well where neither fits) and its gate. Each check passes on the spec and
// fails a copy broken in one way, by its sentence.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test, testAsync, sure, HERE, tmp } from "./helper.mjs";
import { validateCity, SILHOUETTES, MONUMENT_KINDS, towerTiers } from "../levels/lib/city-description.mjs";
import { solid, prism } from "../src/maps/source.mjs";
import { checkCity, analyseCity, towerCost, towerTop, porticoCost, tileEstimateOf } from "../levels/lib/city-checks.mjs";
import { loadRules, validateRules, tighten, rulesFor } from "../levels/lib/architecture-rules.mjs";
import { measureCity } from "../levels/lib/city-description.mjs";
import { runGenerator, regate } from "../levels/gen/runner.mjs";
import { columnBlockers, columnPoly } from "../levels/gen/stage4-network.mjs";
import { polyOverlap } from "../levels/gen/geom.mjs";

const SPEC = join(HERE, "../levels/specs/newbyzantium.json");
const TEXT = readFileSync(SPEC, "utf8");
const fresh = () => JSON.parse(TEXT);
const byId = (list, id) => list.find((x) => x.id === id);
const copy = (v) => JSON.parse(JSON.stringify(v));
const RULES = loadRules();
const forumOf = (d) => byId(d.streets.nodes, "n3_nexus");
const nexusOf = (d) => byId(d.buildings, "msr_nexus");
/** A copy changed by `change`, which must fail checkCity with a sentence containing every one of `words`. */
const breaks = (what, change, ...words) => {
  const d = fresh();
  change(d);
  const f = checkCity(d).failures.join(" | ");
  for (const w of words) sure(f.includes(w), `${what}: wanted a failure with "${w}", got: ${f || "PASS"}`);
};
/** A copy changed by `change`, which validation must refuse with an error containing `words`. */
const refuses = (what, change, words) => {
  const d = fresh();
  change(d);
  const e = validateCity(d).errors.join(" | ");
  sure(e.includes(words), `${what}: wanted an error with "${words}", got: ${e || "valid"}`);
};

test("forum: the rulebook's squares, porticoes, monuments, towers and axial circulation, each with its source", () => {
  sure(validateRules(RULES).errors.length === 0, validateRules(RULES).errors.join(" | "));
  const D = RULES.dimensions;
  for (const k of ["squares", "porticoes", "monuments", "towers"]) sure(D[k]?.source?.length && D[k].note, `dimensions.${k} without its source and note`);
  sure(D.squares.maxOpenSpan === 68.45 && D.squares.maxUnframedSpan === 50.67 && D.squares.source.includes("l4d2"), JSON.stringify(D.squares)); // prettier-ignore
  sure(D.squares.minArea === 215 && D.squares.source.includes("rp-city"), "the RP cities' p10 plaza as the floor");
  sure(D.porticoes.depth.min <= 6.5 && D.porticoes.maxColumnPitch === 3.25 && RULES.sources.vitruvius, JSON.stringify(D.porticoes));
  sure(RULES.sources["forum-constantine"] && D.monuments.source.includes("forum-constantine"), "Constantine's forum cited");
  const AX = RULES.circulation.axial;
  sure(AX.kinds.includes("grand-stair") && AX.kinds.includes("bridge") && AX.exempt.includes("secret") && /diagonal/.test(AX.why), JSON.stringify(AX)); // prettier-ignore
  // counts and degrees are no lengths: the engine's units leave them alone; the lengths convert
  const gs = rulesFor("goldsrc", RULES);
  sure(gs.dimensions.towers.maxBrushes === 24 && gs.circulation.axial.maxSkewDeg === 0.5, "a count or an angle converted to units");
  sure(Math.abs(gs.dimensions.squares.maxOpenSpan - 68.45 / 0.0254) < 0.01, `maxOpenSpan ${gs.dimensions.squares.maxOpenSpan} units`);
  // a description may tighten them, never loosen
  sure(tighten(RULES, { dimensions: { squares: { maxOpenSpan: 50 } } }).errors.length === 0, "lowering maxOpenSpan refused");
  sure(tighten(RULES, { dimensions: { squares: { maxOpenSpan: 90 } } }).errors.some((e) => e.includes("dimensions.squares.maxOpenSpan")), "raising maxOpenSpan allowed"); // prettier-ignore
  sure(tighten(RULES, { dimensions: { towers: { maxBrushes: 40 } } }).errors.some((e) => e.includes("dimensions.towers.maxBrushes")), "more tower brushes allowed"); // prettier-ignore
});

test("forum: the format's plaza portico and monuments and building tower, validated field by field", () => {
  const d = fresh();
  sure(validateCity(d).errors.length === 0, validateCity(d).errors.join(" | "));
  const f = forumOf(d);
  sure(f.size.join() === "24,24" && f.portico === 2 && f.monuments[0].kind === "column" && /\d/.test(f.note), JSON.stringify(f));
  sure(SILHOUETTES.round === 16 && MONUMENT_KINDS.includes("column"), "the tables");
  refuses("a portico on a junction", (d) => (byId(d.streets.nodes, "n3_mese_n").portico = 2), "only a plaza carries a portico or monuments");
  refuses("porticoes filling the square", (d) => (forumOf(d).portico = 12), "two porticoes of 12 leave no open floor");
  refuses("a monument of no kind", (d) => (forumOf(d).monuments[0].kind = "arch"), "monuments[0] (column_republic).kind: wanted one of");
  refuses("a monument in the portico", (d) => (forumOf(d).monuments[0].at = [60, 71.5]), "is not on the square's open floor");
  refuses("a tower of no storeys", (d) => (nexusOf(d).tower.storeys = 0), "msr_nexus).tower.storeys");
  refuses("a tower wider than its building", (d) => (nexusOf(d).tower.across = 10), "wider than the building's footprint [11,9]");
  refuses("a tower of no shape", (d) => (nexusOf(d).tower.silhouette = "spiral"), "tower.silhouette: wanted one of round, octagon, square");
  refuses("an enterable tower", (d) => (nexusOf(d).tower.interior = true), "a tower's shaft is not enterable");
  refuses("a connector's site", (d) => (byId(d.connectors, "c32_forum_stair_w").site = [1]), "c32_forum_stair_w).site: wanted [x, y]");
});

// spire and stepped (2026-11-02): the rulebook's six landmark silhouettes less dome (a form, not a tower) in the
// format; d3_spire's landmark a spire on spire_manor_c (stage 9 M13: round, octagon and square all taken on L3)
test("forum: a spire and a stepped tower, valid in the format, their tiers convex brushes under their top", () => {
  for (const k of ["round", "octagon", "square", "spire", "stepped"]) sure(SILHOUETTES[k] >= 4, `no silhouette ${k}`);
  for (const k of Object.keys(SILHOUETTES)) sure(RULES.forms.landmark.silhouettes.includes(k), `${k} not in the rulebook's landmark silhouettes`);
  const d = fresh();
  sure(byId(d.buildings, "spire_manor_c").tower?.silhouette === "spire", "spire_manor_c has no spire");
  const l3 = d.buildings.filter((b) => b.tower && (b.layer ?? byId(d.districts, b.district)?.layer) === "L3").map((b) => b.tower.silhouette);
  sure(new Set(l3).size === l3.length, `L3's tower silhouettes repeat: ${l3}`);
  const stepped = fresh();
  byId(stepped.buildings, "spire_manor_c").tower.silhouette = "stepped";
  sure(validateCity(stepped).errors.length === 0, validateCity(stepped).errors.join(" | "));
  // a spire: its shaft to half its height, then a point; one more brush than a prism, within the estimate
  const tw = { z: [15, 21], across: 4, storeys: 4, at: [0, 0] };
  const sp = towerTiers({ ...tw, silhouette: "spire" });
  sure(sp.length === 2 && !sp[0].apex && sp[1].apex && sp[0].z.join() === "15,18" && sp[1].z.join() === "18,21" && sp[1].sides === 8, JSON.stringify(sp)); // prettier-ignore
  // stepped: a tier a storey, each narrower, stacked without a gap, the last at the top
  const st = towerTiers({ ...tw, silhouette: "stepped" });
  sure(st.length === 4 && st.every((t, i) => t.sides === 4 && !t.apex && (i === 0 ? t.z[0] === 15 : t.z[0] === st[i - 1].z[1] && t.across < st[i - 1].across)) && st[3].z[1] === 21, JSON.stringify(st)); // prettier-ignore
  sure(towerTiers({ ...tw, silhouette: "octagon" }).length === 1, "an octagon is one prism");
  for (const s of ["spire", "stepped"]) sure(towerTiers({ ...tw, silhouette: s }).length <= towerCost({ tower: { ...tw, silhouette: s } }).brushes, `${s}: more tiers than its estimate`); // prettier-ignore
  // as brushes (stage 10's way): the point a convex solid of its ring and apex, 8 sides and a foot; each tier a prism
  const ringOf = (t) => Array.from({ length: t.sides }, (_, k) => [Math.round(64 * t.across * Math.cos((2 * Math.PI * (k + 0.5)) / t.sides)), Math.round(64 * t.across * Math.sin((2 * Math.PI * (k + 0.5)) / t.sides))]); // prettier-ignore
  const point = solid([...ringOf(sp[1]).map((q) => [q[0], q[1], 1152]), [0, 0, 1344]], "x");
  sure(point.faces.length === 9, `the spire's point has ${point.faces.length} faces`);
  for (const t of st) sure(prism("z", ringOf(t), t.z[0] * 64, t.z[1] * 64, "x").faces.length === 6, "a stepped tier not a box");
  refuses("a tower of no shape, the new ones listed", (d) => (nexusOf(d).tower.silhouette = "spiral"), "wanted one of round, octagon, square, spire, stepped");
});

test("forum: the square sized from data, framed by its portico and the Column of the Republic", () => {
  const d = fresh();
  const r = checkCity(d);
  sure(r.pass, r.failures.join(" | "));
  // 24 cells (78 m) less a portico each side: 65 m of open floor, under 68.45; past 50.67, so framed
  const f = forumOf(d);
  const span = (24 - 2 * f.portico) * d.grid.cell;
  sure(span < 68.45 && 24 * d.grid.cell > 50.67, `open span ${span} m`);
  breaks("the old 28-cell forum", (d) => (forumOf(d).size = [28, 28]), "space: plaza n3_nexus is 78 m across inside its porticoes, at most 68.45 m");
  breaks("the forum with no portico", (d) => delete forumOf(d).portico, "space: plaza n3_nexus is 78 m across, past 50.67 m", "it wants a portico along its edges"); // prettier-ignore
  breaks("the forum with no monument", (d) => delete forumOf(d).monuments, "it wants a monument");
  breaks("the column against the Nexus", (d) => (forumOf(d).monuments[0].at = [60, 64.5]), "space: monument column_republic on n3_nexus stands 1.63 m from msr_nexus, at least 2.4 m");
  breaks("a column taller than the sky", (d) => (forumOf(d).monuments[0].height = 9), "rises to z 21, over L3's top 20");
  breaks("a plinth filling the square", (d) => Object.assign(forumOf(d).monuments[0], { base: [6, 5], at: [60, 67] }), "stands on 30 cells2, at most");
  breaks("a thin portico", (d) => (forumOf(d).portico = 1), "space: plaza n3_nexus's portico is 3.25 m deep, at least 4.8 m");
  // the Bazaar Square (45.5 m) needs no frame; widened past the median sight it would
  breaks("the Bazaar widened", (d) => (byId(d.streets.nodes, "n2_bazaar").size = [16, 14]), "space: plaza n2_bazaar is 52 m across, past 50.67 m");
  // the colonnade's cost: a column a cell along the inner line, none in the four mouths, its vault
  const m = measureCity(d);
  const pc = porticoCost(m.nodes.get("n3_nexus"), m);
  sure(pc.mouths === 4 && pc.columns === 63 && pc.brushes === 63 + 8, JSON.stringify(pc));
});

test("forum: the Nexus a tower over its three storeys, under the sky, cheap, never enterable", () => {
  const d = fresh();
  const m = measureCity(d);
  const b = m.buildings.get("msr_nexus");
  // seven storeys over its three since the sky went up to z 28 (2026-11-02): its crown at z 27, under the lid
  sure(b.storeys === 3 && b.tower.storeys === 7 && towerTop(b, m) === 27, `top ${towerTop(b, m)}`);
  const cost = towerCost(b);
  sure(cost.brushes === 10 && cost.faces === 10 * 18, JSON.stringify(cost));
  // it counts in the brushes and the structural, not in the rooms, homes, doors or the enterable buildings
  const plain = fresh();
  delete nexusOf(plain).tower;
  const [a, p] = [analyseCity(d), analyseCity(plain)];
  sure(a.enterable === undefined || JSON.stringify(a.enterable) === JSON.stringify(p.enterable), "a tower changed the enterable count");
  const [t, tp] = [tileEstimateOf(d, "c1_r1"), tileEstimateOf(plain, "c1_r1")];
  sure(t.brushes - tp.brushes === 10 && t.structural - tp.structural === 10 && t.rooms === tp.rooms, `${JSON.stringify(t)} against ${JSON.stringify(tp)}`); // prettier-ignore
  // under the sky it cuts no rock: the Core's carve heights and rock are the same with it or without
  sure(a.rock.byTile.c1_r1.rock === p.rock.byTile.c1_r1.rock, `rock ${a.rock.byTile.c1_r1.rock} against ${p.rock.byTile.c1_r1.rock}`);
  breaks("a tower into the sky", (d) => (nexusOf(d).tower.storeys = 8), "towers: msr_nexus's tower rises to z 28.5, at most 27.61 (L3's sky 28 less dimensions.towers.topClearance 1.28 m)");
  breaks("a tower under the old lid", (d) => (byId(d.layers, "L3").sky = byId(d.layers, "L2").sky = 20), "towers: msr_nexus's tower rises to z 27, at most 19.61");
  breaks("a tower off its building", (d) => (nexusOf(d).tower.at = [64, 58.5]), "towers: msr_nexus's tower (7 across at [64,58.5]) stands past its building's footprint"); // prettier-ignore
  breaks("a tower of many bands", (d) => (d.engine.estimate = { tower: { brushesFixed: 3, brushesPerStorey: 12 } }), "costs 87 brushes, at most 24");
});

test("forum: a stair whose stops an L along the axes cannot join is refused by the description", () => {
  breaks("the West Basin Stair stretched", (d) => {
    const c = byId(d.connectors, "c21_basin_w_stair");
    byId(d.streets.nodes, "n1_canal_w").at = [10, 10];
    c.length = 16;
  }, "axial: c21_basin_w_stair joins n1_canal_w and n2_stacks_s");
  // a secret stair is exempt
  const d = fresh();
  sure(!checkCity(d).failures.some((f) => f.includes("axial:")), "the spec fails the axial check");
});

const OUT = join(tmp, "gen-forum");
let net = null;
await testAsync("forum: stage 4 routes the Core on the axes: hallways, bridges, the Forum Stairs' wells, the colonnade", "gen forum", async () => {
  const res = await runGenerator({ desc: fresh(), out: OUT, tile: "c1_r1", until: 4 });
  sure(res.ok, `stopped: ${res.refused ?? JSON.stringify(res.stopped)}`);
  net = JSON.parse(readFileSync(join(OUT, "04-network.json"), "utf8"));
  const axial = (p, q) => Math.abs(p[0] - q[0]) < 1e-3 || Math.abs(p[1] - q[1]) < 1e-3;
  for (const h of net.hallways) {
    for (const lg of h.legs) sure(axial(lg.from, lg.to), `${h.id}'s leg ${JSON.stringify(lg)}`);
    for (const br of h.bridges) sure(axial(br.from, br.to), `${h.id}'s bridge ${JSON.stringify(br)}`);
  }
  // the hallways within the MSR's budget (maxServiceTotal 280, not loosened)
  sure(net.measures.service.total > 150 && fresh().rules.msr.maxServiceTotal === 280, JSON.stringify(net.measures.service));
  // the Forum Stairs: switchback wells at their sites in the north portico, both exits facing the Mese's axis
  for (const [id, x] of [["c32_forum_stair_w", 57], ["c32_forum_stair_e", 63]]) {
    const c = net.connectors.find((k) => k.id === id);
    const well = c.pieces.find((p) => p.kind === "well");
    const cx = (Math.min(...well.poly.map((p) => p[0])) + Math.max(...well.poly.map((p) => p[0]))) / 2;
    sure(c.form === "switchback" && Math.abs(cx - x) <= 1 && c.lengthBuilt <= c.lengthDescribed + 1, `${id}: ${c.form} at ${cx}, ${c.lengthBuilt}`);
    sure(c.exits.every((e) => Math.abs(e.at[0] - 60) <= 1.5) && c.exits.map((e) => e.stop).join() === "n2_lift_n,n3_nexus", `${id}'s exits ${JSON.stringify(c.exits.map((e) => [e.stop, e.at]))}`); // prettier-ignore
  }
  // every column kept stands clear of every piece, exit, gate, room, post and hallway on the ground
  const col = net.colonnades.find((c) => c.plaza === "n3_nexus");
  sure(col && col.columns.length + col.dropped.length === 64 && col.dropped.length > 0, JSON.stringify(col && [col.columns.length, col.dropped.length]));
  const blockers = columnBlockers(net, col.layer, col.z[0], col.z[1]);
  for (const c of col.columns) sure(!blockers.some((b) => polyOverlap(columnPoly(c.at, col.column), b.poly) > 1e-6), `a column at ${c.at} in something`);
});

await testAsync("forum: stage 4's gate fails a diagonal hallway, a diagonal flight and a column in an exit", "gen forum gate", async () => {
  sure(net, "no stage 4 run");
  const inputs = Object.fromEntries(["00-description.json", "01-site.json", "02-lots.json"].map((f) => [f, JSON.parse(readFileSync(join(OUT, f), "utf8"))]));
  const says = async (what, change, ...words) => {
    const a = copy(net);
    change(a);
    const v = await regate("network", a, { inputs });
    sure(v.failures.some((f) => words.every((w) => f.includes(w))), `${what}: ${v.failures.slice(0, 3).join(" | ") || "PASS"}`);
  };
  await says("a hallway leg off the axes", (a) => {
    const h = a.hallways.find((x) => x.id === "sv3_e");
    h.legs[0].to = [h.legs[0].to[0], h.legs[0].to[1] + 2];
  }, "axial: hallway sv3_e runs off the axes");
  await says("a bridge off the axes", (a) => {
    const h = a.hallways.find((x) => x.bridges.length);
    h.bridges[0].to = [h.bridges[0].to[0] + 3, h.bridges[0].to[1] + 3];
  }, "'s bridge over", "runs off the axes");
  await says("a flight off the axes", (a) => {
    const c = a.connectors.find((x) => x.id === "c32_forum_stair_w");
    const fl = c.pieces.find((p) => p.kind === "flight");
    fl.poly[1] = [fl.poly[1][0] + 0.5, fl.poly[1][1] + 0.7];
  }, "axial: c32_forum_stair_w's flight runs off the axes");
  await says("a column in an exit", (a) => {
    const col = a.colonnades.find((c) => c.plaza === "n3_nexus");
    const ex = a.connectors.find((x) => x.id === "c32_forum_stair_w").exits.find((e) => e.stop === "n3_nexus");
    col.columns.push({ at: ex.at, side: "n" });
  }, "colonnade: n3_nexus's column at", "c32_forum_stair_w");
});
