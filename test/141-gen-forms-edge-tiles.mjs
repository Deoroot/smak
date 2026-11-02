// The map generator's stage 9 on the edge tiles (levels/gen/forms-deck.mjs, forms-facade.mjs): the cases the Core
// never met, on small fixtures so they hold while the description moves. The deck's edge over a facade lot stage 2
// cut across the edge line: its fascia rising to the lot's top instead of entering it, its brackets along the
// stretches the edge overhangs, M7 counting the brackets over that overhang (a bay over a wall wants none in the
// wall's rock); a nave's stations on one rhythm through the seams (each station placed by the one tile its point is
// in) and a station giving way sliding outward first so the bays between stations keep the pitch (M6); the facade
// chooser holding M11 with every neighbour already decided, a poor front's filler drop pipe kept from breaking M11,
// a giant pilaster from the first floor where the street's props line the ground storey (M9), a setback tier on the
// rock over a vault (M4 is the deck's), two drop pipes at one point given two ids.
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { testAsync, test, sure, HERE, tmp } from "./helper.mjs";
import { runGenerator } from "../levels/gen/runner.mjs";
import { formsContext, formRules, part, instance, partFaults, boxPoly } from "../levels/gen/forms.mjs";
import { polyBox } from "../levels/gen/geom.mjs";
import { family as deck, fasciaRuns, edgeBearing, slideOrder, wholeLine, edgePiers, seamRhythm, _internal as DI } from "../levels/gen/forms-deck.mjs";
import { towerDoorSpots, towerDoorCheck } from "../levels/gen/forms-edges.mjs";
import { _internal as FI } from "../levels/gen/forms-facade.mjs";
import { brushBudgetOf } from "../levels/gen/dressing.mjs";
import { metreRules } from "../levels/gen/stage3-programs.mjs";

const SPEC = join(HERE, "../levels/specs/newbyzantium.json");
const RULES = join(HERE, "../levels/rules/architecture.json");
const desc = JSON.parse(readFileSync(SPEC, "utf8"));
const rulebook = JSON.parse(readFileSync(RULES, "utf8"));
const rules = metreRules({ rulebook, description: desc });
const CELL = 3.2512;
const R = formRules(rules.forms, CELL);
const dist2 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const has = (list, ...words) => list.some((f) => words.every((w) => f.includes(w)));

// ── a small world: New Byzantium's three layers, the deck over [22, 98], the tile c2_r1, nothing on the streets ──
const LAYERS = [
  { id: "L1", level: 1, floor: 0, top: 4, sky: null, ceiling: "vault", frame: "frame-cement", bounds: [0, 6, 120, 116] },
  { id: "L2", level: 2, floor: 5, top: 11, sky: 28, ceiling: "deck", frame: "frame-cement", bounds: [0, 0, 120, 120] },
  { id: "L3", level: 3, floor: 12, top: 20, sky: 28, ceiling: "sky", frame: "frame-marble-gold", bounds: [22, 22, 98, 98] },
];
/** A forms context by hand: `solids` what the stages before placed, `floor(lid, p)` the public floor's owner at a point. */
function smallFx({ solids = [], lots = [], floor = () => null } = {}) {
  const fx = {
    desc: { streets: { nodes: [] }, districts: [] },
    rules,
    R,
    cell: CELL,
    cu: 128,
    storey: 1.5,
    inputs: {},
    site: { ways: [], plazas: [], tile: { id: "c2_r1", box: [80, 40, 120, 80], window: [78, 38, 122, 82] } },
    lots: { lots },
    net: { connectors: [] },
    dressing: null,
    tile: { id: "c2_r1", box: [80, 40, 120, 80], window: [78, 38, 122, 82] },
    layers: LAYERS,
    layerOf: (id) => LAYERS.find((L) => L.id === id) ?? null,
    deck: { layer: "L2", over: "L3", box: [22, 22, 98, 98], soffit: 11, top: 12 },
    world: (lid) => ({ W: { ownerAt: (m) => floor(lid, [m[0] / CELL, m[1] / CELL]) } }),
    keep: () => ({ zones: [], boxes: [] }),
    seed: 1,
    solids,
  };
  return fx;
}
const facadeSolid = (id, b, z) => ({ what: `facade ${id}`, kind: "facade", id, layer: "L2", poly: boxPoly(b), z, soft: true });

test("gen forms edge tiles: the deck's edge over a facade lot cut across it, its fascia on the lot's top, its brackets where it overhangs (M7)", () => {
  // the east edge (x 98) through c2_r1: a facade lot x 95-100, y 55-60 up to the soffit (z 11, fused), another y 60-62
  // up to z 9.5 (under the brackets), as stage 2 cuts lots across the edge line
  const fx = smallFx({ solids: [facadeSolid("f_hi", [95, 55, 100, 60], [5, 11]), facadeSolid("f_lo", [95, 60, 100, 62], [5, 9.5])] });
  const a = [98, 40];
  const u = [0, 1];
  const o = [1, 0];
  const inward = [-1, 0];
  // bay 1 (y 48-56): the fascia over the deck's thickness, rising to z 11 for the last cell over f_hi
  const f1 = fasciaRuns(fx, a, u, o, 8, 16);
  sure(JSON.stringify(f1.runs) === JSON.stringify([{ t0: 8, t1: 15, z0: 10.75 }, { t0: 15, t1: 16, z0: 11 }]), JSON.stringify(f1));
  sure(has(f1.notes, "fascia 15-16 rises to z 11 over facade f_hi"), f1.notes.join(" | "));
  // no run enters the lot (the common rule the old single fascia broke: "enters facade ... by 0.25 cells")
  const box = (r) => part("box", [[98, 40 + r.t0], [98.25, 40 + r.t0], [98.25, 40 + r.t1], [98, 40 + r.t1]], [r.z0, 12]);
  for (const r of f1.runs) sure(!partFaults(fx, box(r)).length, `the fascia ${r.t0}-${r.t1} enters ${JSON.stringify(partFaults(fx, box(r)))}`);
  sure(partFaults(fx, box({ t0: 15, t1: 16, z0: 10.75 })).some((x) => x.what === "facade f_hi"), "the old fascia did enter the lot");
  // the bay's stretches: borne where f_hi stands to the soffit, free over f_lo (its top under the brackets)
  const b2 = edgeBearing(fx, a, u, inward, 16, 24);
  sure(JSON.stringify(b2) === JSON.stringify({ borne: [[16, 20]], free: [[20, 24]] }), JSON.stringify(b2));
  // M7: the brackets over the overhang only; a bay with no wall under it still one every 4 cells
  const edge = (bay, t, brackets, fasciaHeight = 1) => instance({ id: `deck.edge.e.${bay}`, family: "deck", form: "F8", kind: "deck-edge", layer: "L2", frame: true, role: "frame-cement", side: "e", bay, t, at: [98, 40 + (t[0] + t[1]) / 2], brackets, fasciaHeight, pier: { at: [96.5, 40 + (t[0] + t[1]) / 2], landing: { kind: "rock" } }, parts: [part("box", [[98, 40 + t[0]], [98.25, 40 + t[0]], [98.25, 40 + t[1]], [98, 40 + t[1]]], [11, 12])] }); // prettier-ignore
  let v = deck.check([edge(2, [16, 24], 2), edge(0, [0, 8], 2)], fx);
  sure(!has(v.failures, "brackets") && !has(v.failures, "fascia"), v.failures.join(" | "));
  v = deck.check([edge(2, [16, 24], 0), edge(0, [0, 8], 1)], fx);
  sure(has(v.failures, "M7: deck.edge.e.2 has 0 brackets over 4 cells (of its 8, 4 borne on walls), one every 4 at most"), v.failures.join(" | "));
  sure(has(v.failures, "M7: deck.edge.e.0 has 1 brackets over 8 cells, one every 4 at most"), v.failures.join(" | "));
  v = deck.check([edge(2, [16, 24], 1, 0.5)], fx);
  sure(has(v.failures, "M7: deck.edge.e.2's fascia is 0.5 cells high, at least 1") && !has(v.failures, "brackets"), v.failures.join(" | "));
});

test("gen forms edge tiles: a station giving way slides outward first, keeping the bays between stations (M6), inward where that could pass M1's 10", () => {
  const P = R.pier;
  // a leg of two stations 6.17 apart (c2_r1's s2_foundry_b): the first slides back first, the second on, up to 1.5;
  // two stations sliding 2 apart would stand 10.17 apart, past forms.pier.maxPitchPastObstacle (10): inward first there
  sure(JSON.stringify(slideOrder(0, 2, 6.17, P)) === JSON.stringify([0, -0.5, 0.5, -1, 1, -1.5, 1.5, 2, -2]), JSON.stringify(slideOrder(0, 2, 6.17, P)));
  sure(JSON.stringify(slideOrder(1, 2, 6.17, P)) === JSON.stringify([0, 0.5, -0.5, 1, -1, 1.5, -1.5, -2, 2]), JSON.stringify(slideOrder(1, 2, 6.17, P)));
  sure(JSON.stringify(slideOrder(0, 2, 5, P)) === JSON.stringify([0, -0.5, 0.5, -1, 1, -1.5, 1.5, -2, 2]), JSON.stringify(slideOrder(0, 2, 5, P)));
  // the middle station of an odd leg as before
  sure(JSON.stringify(slideOrder(1, 3, 6, P)) === JSON.stringify([0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2]), JSON.stringify(slideOrder(1, 3, 6, P)));
});

test("gen forms edge tiles: the facade chooser's neighbours on every face, a filler drop pipe kept from breaking M11, two pipes at a point two ids", () => {
  const L = { id: "L1", ceiling: "vault", floor: 0, top: 4 };
  const lot = (id, wall, x0, x1) => ({ id, enterable: false, wall, top: 3, z0: 0, L, layer: "L1", box: [x0, 10, x1, 15], storeys: 2, palette: {} });
  const A = lot("A", "tin", 0, 3);
  const B = lot("B", "tin", 3, 7);
  const C = lot("C", "brick", 7.5, 9);
  const D = lot("D", "brick", 3, 7);
  const S = {
    faces: [
      { id: "L1.s10.0", side: "s", line: 10, segs: [{ lot: A, t0: 0, t1: 3 }, { lot: B, t0: 3, t1: 7 }, { lot: C, t0: 7.5, t1: 9 }] },
      { id: "L1.e7.10", side: "e", line: 7, segs: [{ lot: B, t0: 10, t1: 15 }, { lot: D, t0: 15, t1: 16 }] },
    ],
    lots: [A, B, C, D],
  };
  // B touches A on one face and D on another; C stands half a cell off it
  sure(FI.neighboursOf(S, B).map((x) => x.id).sort().join() === "A,D", FI.neighboursOf(S, B).map((x) => x.id).join());
  const fx = { R, rules, deck: null, storey: 1.5 };
  const P = { fx, S, mine: [], placed: [], allowance: new Map() };
  // A a drop on tin: B (tin, the same height, no roof) as a drop too would differ from it in nothing
  FI.push(P, { id: "facade.pipe.A.1.5", on: "A", layer: "L1", kind: "pipe", form: "F18", pattern: "drop", why: "drop", parts: [] });
  sure(FI.dropKeepsMassing(P, B) === false, "a filler drop on B would read as B's pattern, a drop beside A's");
  // C differs from its neighbours in its wall: a drop there keeps M11
  sure(FI.dropKeepsMassing(P, C) === true, "a drop on C keeps M11");
  // a lot whose pattern is read already from an earlier form: a filler changes nothing
  FI.push(P, { id: "facade.pilaster.B", on: "B", layer: "L1", kind: "pilaster", form: "F13", pattern: "pier", parts: [] });
  sure(FI.dropKeepsMassing(P, B) === true, "B reads as a pier whatever fills it");
  // two drop pipes a storey each at one point of a front: the second numbered
  const p1 = FI.push(P, { id: "facade.pipe.C.8", on: "C", layer: "L1", kind: "pipe", form: "F18", pattern: "drop", why: "M9", parts: [] });
  const p2 = FI.push(P, { id: "facade.pipe.C.8", on: "C", layer: "L1", kind: "pipe", form: "F18", pattern: "drop", why: "M9", parts: [] });
  sure(p1.id === "facade.pipe.C.8" && p2.id === "facade.pipe.C.8.2" && new Set(P.mine.map((f) => f.id)).size === P.mine.length, P.mine.map((f) => f.id).join());
});

test("gen forms edge tiles: a setback tier on the rock over the undercity stands, one over the deck's open floor does not (M4)", () => {
  // a lot of the ring (L2 under the sky, x 109-114) over L1's canal; a lot of L3 over L2's street, which the deck spans
  const fx = smallFx({ floor: (lid) => (lid === "L1" ? { kind: "way", id: "s1_canal" } : lid === "L2" ? { kind: "way", id: "s2_street" } : null) });
  const mk = (id, Lid, top) => ({ id, enterable: false, wall: "concrete", top, z0: fx.layerOf(Lid).floor, L: fx.layerOf(Lid), layer: Lid, box: [109, 72, 114, 75.5], storeys: 3, palette: {}, district: "d" }); // prettier-ignore
  const ring = mk("ring", "L2", 9.5);
  const up = mk("up", "L3", 15);
  const S = { faces: [{ id: "f", side: "w", line: 109, segs: [{ lot: ring, side: "w", line: 109, t0: 72, t1: 75.5 }, { lot: up, side: "w", line: 109, t0: 72, t1: 75.5 }] }], lots: [ring, up] }; // prettier-ignore
  const P = { fx, S, mine: [], placed: [], allowance: new Map(), out: { notes: [] } };
  sure(FI.setbackOn(P, ring, 11) === true, "the ring's lot over the canal took no tier");
  sure(P.mine.some((f) => f.kind === "setback" && f.on === "ring" && f.top === 11), JSON.stringify(P.mine.map((f) => f.id)));
  const why = FI.setbackOn(P, up, 16.5);
  sure(why === "up's tier would stand over L2's open floor (s2_street)", String(why));
});

test("gen forms edge tiles: a front the street's props line gets its giant pilaster from the first floor up (M9)", () => {
  // a ring lot (L2 under the sky, x 11-15, its front e on x 15) four storeys to z 11, a bench and bins against its
  // whole ground storey (stage 8's street props, as on the Stacks' plaza in c0_r0)
  const prop = { what: "prop bench", kind: "prop", id: "bench", layer: "L2", poly: boxPoly([15.03, 31.5, 15.22, 34.5]), z: [5, 5.6] };
  const fx = smallFx({ solids: [prop] });
  fx.tile = { id: "c0_r0", box: [0, 0, 40, 40] };
  fx.inputs = { "06-palette.json": { things: [] } };
  const L = fx.layerOf("L2");
  const lt = { id: "f_ring", enterable: false, wall: "brick", trim: "brick", top: 11, z0: 5, L, layer: "L2", box: [11, 31.5, 15, 34.5], front: "e", storeys: 4, palette: {}, district: "d", wealth: "mid" }; // prettier-ignore
  const face = { id: "L2.e15.31.5", layer: "L2", side: "e", line: 15, t0: 31.5, t1: 34.5, segs: [{ lot: lt, side: "e", line: 15, t0: 31.5, t1: 34.5, on: ["plaza"] }], on: ["plaza"] }; // prettier-ignore
  const P = { fx, S: { faces: [face], lots: [lt], byId: new Map([[lt.id, lt]]) }, out: { notes: [], forms: [] }, placed: [], allowance: new Map(), traits: new Map() };
  P.mine = P.out.forms;
  FI.fixRelief(P);
  const major = P.mine.find((f) => f.id === "facade.pilaster.f_ring.major");
  sure(major && major.parts[0].z[0] === 6.5 && major.parts[0].z[1] === 10.75 && major.width >= 0.886, `${JSON.stringify(major)} | ${P.out.notes.join(" | ")}`);
  sure(!partFaults(fx, major.parts[0]).length, "the pilaster enters the props");
});

await testAsync("gen forms edge tiles: a nave's stations keep one rhythm through a seam, each placed by the one tile its point is in", "gen forms edge tiles seams", async () => {
  // c0_r0 and c1_r0 share the seam x 40 under the deck; their own sites (stage 1), the stages after empty
  const fxOf = async (tile) => {
    const out = join(tmp, `gen-seam-${tile}`);
    await runGenerator({ desc, out, tile, until: 1 });
    sure(existsSync(join(out, "01-site.json")), `no site for ${tile}`);
    const site = JSON.parse(readFileSync(join(out, "01-site.json"), "utf8"));
    const inputs = {
      "01-site.json": site,
      "02-lots.json": { tile, lots: [], blocks: [] },
      "04-network.json": { tile, connectors: [], hallways: [], checkpoints: [], posts: [], colonnades: [], spawns: [] },
      "05-plans.json": { tile, buildings: [] },
      "08-dressing.json": { tile, props: [], measures: { brushBudget: brushBudgetOf(desc, tile, [], []), modelProps: { wiringEntities: 0, placed: 0, limit: 412 } } }, // prettier-ignore
    };
    return formsContext({ description: desc, inputs, params: { seed: 1 } }, rules);
  };
  const A = await fxOf("c0_r0");
  const B = await fxOf("c1_r0");
  const pub = (w) => w.layer === A.deck.layer && w.class !== "service" && w.class !== "canal" && w.access === "public";
  const shared = A.site.ways.filter((w) => pub(w) && B.site.ways.some((x) => x.id === w.id));
  let crossing = 0;
  for (const wa of shared) {
    const wb = B.site.ways.find((x) => x.id === wa.id);
    const la = wholeLine(A, wa);
    const lb = wholeLine(B, wb);
    sure(la && JSON.stringify(la) === JSON.stringify(lb), `${wa.id}'s whole line differs between the tiles (${JSON.stringify(la)} / ${JSON.stringify(lb)})`);
    const legsA = DI.navesLegs(A, wa);
    const legsB = DI.navesLegs(B, wb);
    for (const g of legsA) {
      const h = legsB.find((x) => x.leg === g.leg);
      if (!h) continue;
      crossing++;
      sure(Math.abs(g.len - h.len) < 1e-9 && dist2(g.a, h.a) < 1e-9, `${wa.id} leg ${g.leg} is not one leg in both tiles`);
      const n = Math.max(1, Math.ceil(g.len / R.pier.pitch.typical - 1e-9));
      const u = [(g.b[0] - g.a[0]) / g.len, (g.b[1] - g.a[1]) / g.len];
      for (let k = 0; k < n; k++) {
        const p = [g.a[0] + u[0] * ((k + 0.5) * g.len) / n, g.a[1] + u[1] * ((k + 0.5) * g.len) / n];
        const inUnion = p[0] >= 0 && p[0] < 80 && p[1] >= 0 && p[1] < 40;
        const owners = [g.owns(p), h.owns(p)].filter(Boolean).length;
        sure(owners === (inUnion ? 1 : 0), `${wa.id} leg ${g.leg} station ${k} at [${p}] is placed by ${owners} of the two tiles`);
      }
    }
  }
  // M5 per tile holds the tile's own frame only: a way crossing the seam with no pier of the tile's own fails,
  // whatever the next tile stands (it is not let off by the neighbour's stations)
  const v5 = deck.check([], { ...A, placed: [] });
  const crossers = shared.map((w) => w.id);
  sure(v5.failures.some((x) => crossers.some((id) => x.startsWith(`M5: ${id} under the deck`))) && !v5.notes.some((n) => /next tile/.test(n)), v5.failures.concat(v5.notes).filter((n) => n.startsWith("M5")).join(" | ")); // prettier-ignore
  sure(crossing > 0, `no public way under the deck crosses the seam of c0_r0 and c1_r0 (${shared.map((w) => w.id).join(", ") || "none shared"})`);
});

test("gen forms edge tiles: edge piers chosen together where a wide way crosses the deck's edge at a bay's middle (M7)", () => {
  // c1_r0's south edge (y 22, x 40-80, five bays of 8): an avenue's carriageway over x 57.5-62.5 (bay 2's middle, 60)
  // and a ramp's carriageway and mouth over x 64.5-70.5 (bay 3's, 68) where the piers stand, 1.5 in from the edge
  const zone = (x0, x1) => ({ what: `carriageway ${x0}`, kind: "carriageway", poly: boxPoly([x0, 22, x1, 26]), z: [5, 8] });
  const fx = smallFx();
  fx.tile = { id: "c1_r0", box: [40, 0, 80, 40] };
  const a = [40, 22];
  const u = [1, 0];
  const inward = [0, 1];
  fx.keep = () => ({ zones: [], boxes: [] });
  // nothing in the way: every pier at its bay's middle, as before
  let got = edgePiers(fx, a, u, inward, 5, 8);
  sure(got.map((b) => b.pier?.t).join() === "4,12,20,28,36" && !got.moved, JSON.stringify(got.map((b) => b.pier?.t)));
  fx.keep = (lid) => ({ zones: lid === "L2" ? [zone(57.5, 62.5), zone(64.5, 70.5)] : [], boxes: [] });
  got = edgePiers(fx, a, u, inward, 5, 8);
  const ts = got.filter((b) => b.pier).map((b) => b.pier.t);
  for (let i = 1; i < ts.length; i++) sure(ts[i] - ts[i - 1] <= R.pier.maxPitchPastObstacle + 1e-6, `edge piers at ${ts.join(", ")}`);
  sure(ts.length === 5 && /bay 2/.test(got.moved) && /bay 3/.test(got.moved), JSON.stringify({ ts, moved: got.moved }));
  for (const b of got) sure(!partFaults(fx, b.pier.shaft, { layers: ["L2"] }).length, `the pier at ${b.pier.t} enters a carriageway`);
});

test("gen forms edge tiles: a wall tower whose foot a facade lot fills wants no door, one on public floor still does (V8)", () => {
  // the south wall, a gate's flanking tower at x 51.75 whose inner half stands in a facade lot x 49-54, y 0-3.5
  const lotBox = [49, 0, 54, 3.5];
  const inLot = (p) => p[0] >= lotBox[0] && p[0] <= lotBox[2] && p[1] >= lotBox[1] && p[1] <= lotBox[3];
  const fx = smallFx({ solids: [facadeSolid("f_gate_w", lotBox, [5, 9.5])], floor: (lid, p) => (lid === "L2" && p[1] > 0 && !inLot(p) ? { kind: "plaza", id: "n2_gate" } : null) }); // prettier-ignore
  const L = fx.layerOf("L2");
  const sd = { side: "s", a: [0, 0], u: [1, 0], in: [0, 1] };
  const plan = { sides: [sd] };
  const tower = (x, door) => ({ id: `edges.tower.s.${x}`, kind: "wall-tower", side: "s", layer: "L2", at: [x, 0], across: 4, parts: door ? [{ what: "door" }] : [{ what: "shaft" }] }); // prettier-ignore
  sure(!towerDoorSpots(fx, L, sd, [51.75, 0], 4).some((sp) => sp.floor), "a door spot of the buried foot has public floor");
  let v = towerDoorCheck(fx, plan, tower(51.75, false));
  sure(v?.note && v.note.includes("meets no public floor (in facade f_gate_w)"), JSON.stringify(v));
  // the same tower on the open floor east of the gate: its door is wanted
  v = towerDoorCheck(fx, plan, tower(70, false));
  sure(v?.failure === "V8: edges.tower.s.70 has no door at its foot (the scale pair)", JSON.stringify(v));
  sure(towerDoorCheck(fx, plan, tower(70, true)) === null, "a tower with its door");
});

test("gen forms edge tiles: a fusion band nothing of which stands gives no empty form", () => {
  // a facade lot under the deck (x 38-40, y 85-89, its front w on x 38) with a connector's well through its band
  const lot = { id: "f_well", kind: "facade", tile: "c2_r1", layer: "L2", district: "d", rect: { x: 38, y: 85, w: 2, d: 4 }, zBase: 5, frontage: { side: "w", way: "n2" }, facade: { height: 4.5, storeys: 3 } }; // prettier-ignore
  const well = { what: "c_palace_stair's well", kind: "connector", id: "c_palace_stair", poly: boxPoly([37, 84, 39, 90]), z: [0, 20] };
  const fx = smallFx({ solids: [well], lots: [lot] });
  fx.desc = { ...fx.desc, districts: [{ id: "d", wealth: "mid" }] };
  const out = { forms: [], notes: [] };
  DI.fusion(fx, out);
  sure(!out.forms.length, JSON.stringify(out.forms.map((f) => [f.id, f.parts.length])));
  sure(out.notes.some((n) => n.startsWith("fusion of f_well: corbel course (c_palace_stair's well), cornice (c_palace_stair's well) left out")), out.notes.join(" | ")); // prettier-ignore
});

test("gen forms edge tiles: a giant pilaster stops under the fusion band's cages, a lesene under a vault's chamfer (M9)", () => {
  // a fused lot (under the deck) four storeys to the soffit, its narrow front covered over its top storey by the cages
  const fx = smallFx();
  fx.tile = { id: "c0_r2", box: [0, 80, 40, 120] };
  fx.inputs = { "06-palette.json": { things: [] } };
  const L2 = fx.layerOf("L2");
  const lt = { id: "f_fused", lot: { id: "f_fused" }, enterable: false, wall: "panel", trim: "panel", top: 11, z0: 5, L: L2, layer: "L2", box: [33, 81, 35, 85], front: "n", storeys: 4, palette: {}, district: "d", wealth: "mid" }; // prettier-ignore
  const face = { id: "L2.n85.33", layer: "L2", side: "n", line: 85, t0: 33, t1: 35, segs: [{ lot: lt, side: "n", line: 85, t0: 33, t1: 35, on: ["plaza"] }], on: ["plaza"] }; // prettier-ignore
  const fusion = instance({ id: "deck.fusion.f_fused", family: "deck", kind: "fusion", lot: "f_fused", layer: "L2", parts: [part("box", boxPoly([33, 85, 35, 85.25]), [10.5, 11], { what: "corbel course" }), part("box", boxPoly([33.125, 85, 33.875, 85.5]), [9.5, 11], { what: "cage 1" }), part("box", boxPoly([34.125, 85, 34.875, 85.5]), [9.5, 11], { what: "cage 2" })] }); // prettier-ignore
  let P = { fx, S: { faces: [face], lots: [lt], byId: new Map([[lt.id, lt]]) }, out: { notes: [], forms: [] }, placed: [fusion], allowance: new Map(), traits: new Map() }; // prettier-ignore
  P.mine = P.out.forms;
  FI.fixRelief(P);
  const major = P.mine.find((f) => f.id === "facade.pilaster.f_fused.major");
  sure(major && major.parts[0].z[0] === 5 && major.parts[0].z[1] === 9.5, `${JSON.stringify(major?.parts)} | ${P.out.notes.join(" | ")}`);
  // an undercity cottage against a vaulted alley: the vault's chamfer runs along its wall from 1.25 cells up (under half the storey band: no relief of it)
  const L1 = fx.layerOf("L1");
  const ct = { id: "cottage", lot: { id: "cottage" }, enterable: false, wall: "brick", trim: "brick", top: 3, z0: 0, L: L1, layer: "L1", box: [20, 70, 24, 75], front: "e", storeys: 2, palette: {}, district: "d", wealth: "mid" }; // prettier-ignore
  const f1 = { id: "L1.e24.70", layer: "L1", side: "e", line: 24, t0: 70, t1: 75, segs: [{ lot: ct, side: "e", line: 24, t0: 70, t1: 75, on: ["alley"] }], on: ["alley"] }; // prettier-ignore
  const chamfer = instance({ id: "edges.vault.alley.0.0", family: "edges", kind: "vault", layer: "L1", parts: [part("wedge", boxPoly([24, 69, 24.5, 76]), [1.25, 4], { what: "chamfer" })] }); // prettier-ignore
  P = { fx, S: { faces: [f1], lots: [ct], byId: new Map([[ct.id, ct]]) }, out: { notes: [], forms: [] }, placed: [chamfer], allowance: new Map(), traits: new Map() }; // prettier-ignore
  P.mine = P.out.forms;
  FI.fixRelief(P);
  const low = P.mine.find((f) => f.id === "facade.lesene.cottage.0");
  sure(low && low.parts[0].z[0] === 0 && low.parts[0].z[1] === 0.75, `${JSON.stringify(P.mine.map((f) => [f.id, f.parts[0].z]))} | ${P.out.notes.join(" | ")}`);
});

test("gen forms edge tiles: a lot whose pattern became the pier gets another roofline to keep M11, a lesene through the ground storey under a bay (M8)", () => {
  const fx = smallFx();
  fx.tile = { id: "c2_r0", box: [80, 0, 120, 40] };
  fx.inputs = { "06-palette.json": { things: [] } };
  const L1 = fx.layerOf("L1");
  // thirty quay lots of the canal's slum on one wall; three read "3|none|null|pier|quay" already, the fourth (X, its
  // drop pipe swapped for a giant pilaster) would make four, past the repeat share (10 %: 3)
  const mk = (id, y0) => ({ id, lot: { id }, enterable: false, wall: "quay", trim: "quay", top: 3, z0: 0, L: L1, layer: "L1", box: [117, y0, 120, y0 + 2], front: "w", storeys: 2, palette: {}, district: "d", wealth: "slum" }); // prettier-ignore
  const lots = [...Array(30).keys()].map((i) => mk(`q${i}`, 40 + 3 * i));
  const X = lots[0];
  const face = { id: "L1.w117.40", layer: "L1", side: "w", line: 117, t0: 40, t1: 42, segs: [{ lot: X, side: "w", line: 117, t0: 40, t1: 42, on: ["quay"] }], on: ["quay"] }; // prettier-ignore
  const P = { fx, S: { faces: [face], lots, byId: new Map(lots.map((l) => [l.id, l])) }, out: { notes: [], forms: [] }, placed: [], allowance: new Map(), traits: new Map() }; // prettier-ignore
  P.mine = P.out.forms;
  for (const l of lots.slice(1, 4)) FI.push(P, { id: `facade.pilaster.${l.id}`, on: l.id, layer: "L1", kind: "pilaster", form: "F13", pattern: "pier", parts: [] });
  FI.push(P, { id: "facade.pilaster.q0.major", on: "q0", layer: "L1", kind: "pilaster", form: "F13", pattern: "pier", parts: [] });
  sure(FI.massingHolds(P, X) === false, "four lots alike past the share");
  sure(FI.reroof(P, face, face.segs[0], X) === true && FI.massingHolds(P, X), P.out.notes.join(" | "));
  sure(P.mine.some((f) => f.on === "q0" && f.kind === "roofline" && f.roofForm !== "plain"), JSON.stringify(P.mine.map((f) => [f.id, f.roofForm])));

  // M8: an undercity front 6 cells long, a bay over its ground storey all along it and a pier at its north end: the
  // ground storey's 5.5 cells broken by a lesene through that storey alone
  const ct = { id: "row", lot: { id: "row" }, enterable: false, wall: "brick", trim: "brick", top: 3, z0: 0, L: L1, layer: "L1", box: [20, 70, 24, 76], front: "e", storeys: 2, palette: {}, district: "d", wealth: "mid" }; // prettier-ignore
  const f1 = { id: "L1.e24.70", layer: "L1", side: "e", line: 24, t0: 70, t1: 76, segs: [{ lot: ct, side: "e", line: 24, t0: 70, t1: 76, on: ["street"] }], on: ["street"] }; // prettier-ignore
  const placed = [
    instance({ id: "x.bay", family: "x", kind: "bay", layer: "L1", parts: [part("box", boxPoly([24, 70, 24.5, 76]), [1.5, 2.75], { what: "bay" })] }),
    instance({ id: "x.pier", family: "x", kind: "pier", layer: "L1", parts: [part("box", boxPoly([24, 70, 24.5, 70.5]), [0, 1.4], { what: "pier" })] }),
  ];
  const Q = { fx, S: { faces: [f1], lots: [ct], byId: new Map([[ct.id, ct]]) }, out: { notes: [], forms: [] }, placed, allowance: new Map(), traits: new Map() }; // prettier-ignore
  Q.mine = Q.out.forms;
  FI.fixRelief(Q);
  const les = Q.mine.find((f) => /^facade\.lesene\.row\.m8\./.test(f.id));
  sure(les && les.parts[0].z[0] === 0 && les.parts[0].z[1] <= 1.5, `${JSON.stringify(Q.mine.map((f) => [f.id, f.parts[0].z]))} | ${Q.out.notes.join(" | ")}`);
});

test("gen forms edge tiles: the naves' rhythm checked once a way across the seams: a clean seam passes, a side drifting, crowding or a gap fails", () => {
  // a leg 35 cells long in 5 bays of 7 (stations at 3.5, 10.5, 17.5, 24.5, 31.5), the seam between stations 2 and 3
  const pier = (tile, k, t, more = {}) => ({ tile, p: { id: `deck.pier.s2_x.0.${k}l`, kind: "pier", onKind: "way", on: "s2_x", leg: 0, side: "l", station: k, t, nominal: 3.5 + 7 * k, bays: 5, legLength: 35, rhythm: "whole", ...more } }); // prettier-ignore
  const tilesOf = (list) => ["A", "B"].map((tile) => ({ tile, forms: list.filter((x) => x.tile === tile).map((x) => x.p) }));
  const clean = [pier("A", 0, 3.5), pier("A", 1, 11), pier("A", 2, 17.5), pier("B", 3, 24), pier("B", 4, 31.5)];
  let v = seamRhythm(tilesOf(clean), R);
  sure(!v.failures.length && v.ways === 1, v.failures.join(" | "));
  // one side drifting: tile B places station 3 three cells off its place (its own rhythm, cut at the seam)
  v = seamRhythm(tilesOf([...clean.slice(0, 3), pier("B", 3, 27.5), pier("B", 4, 31.5)]), R);
  sure(v.failures.some((x) => x.includes("s2_x leg 0 left station 3 (B) stands 3 cells off its place in the rhythm, at most 2")), v.failures.join(" | ")); // prettier-ignore
  // B on its own tile's rhythm (the way's whole line not known there)
  v = seamRhythm(tilesOf([...clean.slice(0, 3), pier("B", 0, 24, { rhythm: "tile", nominal: 24, bays: 2, legLength: 14 })]), R);
  sure(v.failures.some((x) => x.includes("B on its own tile's rhythm") && x.includes("out of step at the seam")), v.failures.join(" | "));
  // B on a different rhythm of the leg
  v = seamRhythm(tilesOf([...clean.slice(0, 3), pier("B", 3, 24.5, { bays: 6, legLength: 36 })]), R);
  sure(v.failures.some((x) => x.includes("framed on different rhythms by A, B")), v.failures.join(" | "));
  // crowding: station 2 given by both tiles
  v = seamRhythm(tilesOf([...clean, pier("B", 2, 18)]), R);
  sure(v.failures.some((x) => x.includes("station 2 is given by A at 17.5 and B at 18: crowding at the seam")), v.failures.join(" | "));
  // a gap across the seam: station 2 and 3 missing on both sides
  v = seamRhythm(tilesOf([pier("A", 0, 3.5), pier("A", 1, 10.5), pier("B", 4, 31.5)]), R);
  sure(v.failures.some((x) => x.includes("21 cells apart across the seam of A and B")), v.failures.join(" | "));
});

test("gen forms edge tiles: an alley's pier cutting the walk leaves its girder on a corbel; a sliver front's major element, tank and corner pieces (M5, M9, M10, M11)", () => {
  // a 1.25-cell alley (along y at x 90) under the deck: its girder on two piers; the left one taken out for the walk
  const fx = smallFx();
  const c = [90, 90];
  const beam = [[90.625, 89.75], [90.625, 90.25], [89.375, 90.25], [89.375, 89.75]];
  const pierL = instance({ id: "deck.pier.s2_alley.0.0l", family: "deck", kind: "pier", onKind: "way", on: "s2_alley", side: "l", layer: "L2", at: [89.2, 90], parts: [part("box", boxPoly([89.125, 89.5, 89.625, 90.5]), [5, 10])] }); // prettier-ignore
  const pierR = instance({ id: "deck.pier.s2_alley.0.0r", family: "deck", kind: "pier", onKind: "way", on: "s2_alley", side: "r", layer: "L2", at: [90.8, 90], parts: [part("box", boxPoly([90.375, 89.5, 90.875, 90.5]), [5, 10])] }); // prettier-ignore
  const rib = instance({ id: "deck.rib.s2_alley.0.0", family: "deck", kind: "rib", layer: "L2", on: "s2_alley", at: c, soffit: 10.5, bears: [pierL.id, pierR.id], parts: [part("box", beam, [10.5, 11], { what: "beam" })] }); // prettier-ignore
  const out = { forms: [pierL, pierR, rib], notes: [] };
  sure(DI.corbelInstead(fx, out, pierL) === true, "no corbel");
  const r2 = out.forms.find((f) => f.id === rib.id);
  sure(!out.forms.includes(pierL) && r2.bears.join() === pierR.id && r2.bearsOnWall.join() === "l" && r2.parts.some((p) => p.what === "corbel" && p.poly.every((q) => q[0] <= 89.625 + 1e-9)), JSON.stringify(r2)); // prettier-ignore
  // a 1-storey front 3.5 cells long, street props and a door's approach over all of it but its last 0.94: the least
  // major width (0.9375) at its end
  const fx2 = smallFx({ solids: [{ what: "prop bench", kind: "prop", id: "b", layer: "L1", poly: boxPoly([104.5, 104.62, 106.44, 105]), z: [0, 0.3] }, { what: "door's approach", kind: "post", id: "d", layer: "L1", poly: boxPoly([106.44, 104.62, 107.0625, 105]), z: [0, 0.9] }] }); // prettier-ignore
  fx2.inputs = { "06-palette.json": { things: [] } };
  const L1 = fx2.layerOf("L1");
  const ib = { id: "base", lot: { id: "base" }, enterable: false, wall: "brick", trim: "brick", top: 1.5, z0: 0, L: L1, layer: "L1", box: [104.5, 105, 111.5, 112], front: "s", storeys: 1, palette: {}, district: "d", wealth: "mid" }; // prettier-ignore
  const fs1 = { id: "L1.s105.104.5", layer: "L1", side: "s", line: 105, t0: 104.5, t1: 108, segs: [{ lot: ib, side: "s", line: 105, t0: 104.5, t1: 108, on: ["plaza"] }], on: ["plaza"] }; // prettier-ignore
  const P = { fx: fx2, S: { faces: [fs1], lots: [ib], byId: new Map([[ib.id, ib]]) }, out: { notes: [], forms: [] }, placed: [], allowance: new Map(), traits: new Map() }; // prettier-ignore
  P.mine = P.out.forms;
  FI.fixRelief(P);
  const m = P.mine.find((f) => f.id === "facade.pilaster.base.major");
  sure(m && m.width === 0.938 && Math.abs(polyBox(m.parts[0].poly)[2] - 108) < 1e-6, `${JSON.stringify(m)} | ${P.out.notes.join(" | ")}`);
  // a front a vault's chamfer runs along through the band: masked
  const vault = instance({ id: "edges.vault.alley.0.0", family: "edges", kind: "vault", layer: "L1", parts: [part("wedge", boxPoly([104.5, 104.5, 108, 105]), [0.75, 4], { what: "chamfer" })] }); // prettier-ignore
  sure(FI.maskedShare({ ...fx2, placed: [vault] }, fs1, fs1.segs[0], [0, 1.5]) >= 0.5 && FI.maskedShare(fx2, fs1, fs1.segs[0], [0, 1.5]) < 0.5, "the vault's chamfer masks the band");
  // a tank on a 0.75-cell sliver of a lot's 2-cell side
  const sl = { id: "sliver", lot: { id: "sliver" }, enterable: false, wall: "brick", trim: "brick", top: 3, z0: 0, L: L1, layer: "L1", box: [95, 98, 101, 100], front: "e", storeys: 2, palette: {}, district: "d", wealth: "slum" }; // prettier-ignore
  const fsl = { id: "L1.e101.99.25", layer: "L1", side: "e", line: 101, t0: 99.25, t1: 100, segs: [{ lot: sl, side: "e", line: 101, t0: 99.25, t1: 100 }] };
  const Q = { fx: fx2, S: { faces: [fsl], lots: [sl] }, out: { notes: [], forms: [] }, placed: [], allowance: new Map() };
  Q.mine = Q.out.forms;
  const tank = FI.buildRoof(Q, fsl, fsl.segs[0], sl, "tank");
  sure(tank && tank.parts[0].poly.every((p) => p[1] >= 98 - 1e-9 && p[1] <= 100 + 1e-9), JSON.stringify(tank));
  // corner pieces: quoins from over a bench against the corner; a turret slid a quarter cell along a face
  const C = R.corner;
  const cn = { id: "base.ws", lot: { ...ib, L: L1 }, at: [104.5, 105], sx: -1, sy: -1 };
  const fx3 = smallFx({ solids: [{ what: "prop bench", kind: "prop", id: "b", layer: "L1", poly: boxPoly([104.2, 104.6, 104.9, 104.95]), z: [0, 0.14] }] }); // prettier-ignore
  const q3 = FI.cornerParts(fx3, cn, "quoin", C, 1.5, 4, 3);
  sure(q3 && q3[0].z[0] === 0.25 && q3[0].z[1] === 1.25, JSON.stringify(q3?.map((p) => p.z)));
  const cn2 = { ...cn, lot: { ...ib, storeys: 2, top: 3 } };
  const t0 = FI.cornerParts(fx3, cn2, "turret", C, 1.5, 4, 0);
  const t1 = FI.cornerParts(fx3, cn2, "turret", C, 1.5, 4, 0, [0.25, 0]);
  sure(t0 && t1 && Math.abs(polyBox(t1[1].poly)[0] - polyBox(t0[1].poly)[0] - 0.25) < 1e-6, "the turret slid");
});
