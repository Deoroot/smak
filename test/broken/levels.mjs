// Layouts of levels/assembly broken in one way each against their style (levels/assembly/styles/house.json): a
// bedroom with no window, a bedroom reached only through another, the entrance opening into a study, a living room
// lit from one side, a study narrower than its kind, a kitchen larger than its kind, a bedroom of two thin arms, the
// entrance off the front; two doors whose leaves sweep the same cells; and descriptions the style refuses: a kind it has not, an area band its kind cannot have.
// The Mese's (styles/mese.json, mese-shop-a at seed 1): a shop whose window is not on the street, a building of two
// entrance rooms with one entrance.
// The layout is house-02 at seed 2, which keeps every rule of its style: each case is a copy changed in one place.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HERE } from "../helper.mjs";
import { broken } from "./case.mjs";
import { layoutOf, checkLayout } from "../../levels/assembly/layout.mjs";
import { readBuilding, checkBuilding } from "../../levels/assembly/building.mjs";
import { loadStyle, checkStyle } from "../../levels/assembly/style.mjs";

const SPEC = JSON.parse(readFileSync(join(HERE, "../levels/specs/house-02.json"), "utf8"));
const d = readBuilding(SPEC);
const style = loadStyle("house");
const whole = layoutOf(SPEC, { seed: 2 });
const copy = (v) => JSON.parse(JSON.stringify(v));
const fails = (l, s = style, desc = d) => checkStyle(l, desc, s).failures;
const warns = (l, s = style, desc = d) => checkStyle(l, desc, s).warnings;
const windowsOf = (l, id) => l.storeyPlans.flatMap((p) => p.edges.filter((e) => e.kind === "window" && e.rooms.includes(id)));
const tightened = (kind, field, value) => {
  const s = structuredClone(style);
  s.kinds[kind][field] = value;
  return s;
};

broken("checkStyle", "a bedroom with no window", {
  said: /room bed3 .*it has no window; a bedroom wants one on an outside wall/,
  broken: () => {
    const l = copy(whole);
    for (const e of windowsOf(l, "bed3")) e.kind = "exterior";
    return fails(l);
  },
  whole: () => fails(whole),
});
broken("checkStyle", "a bedroom reached only through another bedroom", {
  said: /room bed3 .* is reached only through bed2 \(bedroom\); a room is not reached through a private room/,
  broken: () => {
    const l = copy(whole);
    l.doors.find((door) => door.rooms.includes("bed3")).rooms = ["bed2", "bed3"];
    return fails(l);
  },
  whole: () => fails(whole),
});
broken("checkStyle", "a study narrower than its kind's minSide", {
  said: /room study .*its largest rectangle is 3 x 3 cells; a study wants 4 across at least/,
  broken: () => fails(whole, tightened("study", "minSide", 4)),
  whole: () => fails(whole),
});
broken("checkStyle", "a kitchen larger than its kind's area", {
  said: /room kitchen .*: 15 cells; a kitchen is 6-12/,
  broken: () => fails(whole, tightened("kitchen", "maxArea", 12)),
  whole: () => fails(whole),
});
broken("checkStyle", "the entrance opening into a room of a kind no entrance opens into", {
  said: /the entrance opens into hall \(study\); it wants one of hall, living, kitchen/,
  others: true, // a study is private: the gradient closes every room behind it too
  broken: () => fails(whole, style, { ...d, rooms: d.rooms.map((r) => (r.id === "hall" ? { ...r, kind: "study" } : r)) }),
  whole: () => fails(whole),
});
broken("checkStyle", "a living room lit from one side", {
  said: /room living .*its windows are all on the \w+ wall; a living wants light from two sides/,
  broken: () => {
    const l = copy(whole);
    const own = windowsOf(l, "living");
    const keep = own[0].from[1] === own[0].to[1] ? (e) => e.from[1] === e.to[1] && e.from[1] === own[0].from[1] : (e) => e.from[0] === e.to[0] && e.from[0] === own[0].from[0]; // prettier-ignore
    for (const e of own) if (!keep(e)) e.kind = "exterior";
    return warns(l);
  },
  whole: () => warns(whole),
});
broken("checkStyle", "a bedroom of two thin arms", {
  said: /room bed2 .*its largest rectangle \(3 x 5\) holds 15 of its 17 cells \(0\.88\); a room wants 0\.95 at least/,
  broken: () => {
    const s = structuredClone(style);
    s.rules.compact.value = 0.95;
    return warns(whole, s).filter((w) => /room bed2/.test(w));
  },
  whole: () => warns(whole),
});
broken("checkStyle", "the entrance off the front", {
  said: /the entrance stands on the south wall; the front is north/,
  others: true, // turning the front round puts the kitchen before the living room as well
  broken: () => warns(whole, style, { ...d, front: "north" }),
  whole: () => warns(whole),
});

broken("checkStyleBuilding", "a room of a kind the style has not", {
  said: /room study: its kind office is not one of style house's/,
  broken: () => checkBuilding({ ...SPEC, rooms: SPEC.rooms.map((r) => (r.id === "study" ? { ...r, kind: "office" } : r)) }).failures,
  whole: () => checkBuilding(SPEC).failures,
});
broken("checkStyleBuilding", "a room whose area band its kind cannot have", {
  said: /room kitchen: wants 20-24 cells; a kitchen of style house is 6-18 cells/,
  broken: () => checkBuilding({ ...SPEC, rooms: SPEC.rooms.map((r) => (r.id === "kitchen" ? { ...r, area: [20, 24] } : r)) }).failures,
  whole: () => checkBuilding(SPEC).failures,
});

broken("checkLayout", "two doors whose leaves sweep the same cells as they open", {
  said: /door hall-study and door hall-study \(storey 0\) both swing into study over the cells .*; one leaf, open, stands in the other's way/,
  broken: () => {
    const l = copy(whole);
    l.doors.push(copy(l.doors.find((door) => door.rooms.join() === "hall,study")));
    return checkLayout(l).failures;
  },
  whole: () => checkLayout(whole).failures,
});

// the Mese (styles/mese.json, levels/specs/mese-shop-a.json at seed 1): a shop and a stair hall, each its own street door
const MESE = JSON.parse(readFileSync(join(HERE, "../levels/specs/mese-shop-a.json"), "utf8"));
const meseD = readBuilding(MESE);
const meseStyle = loadStyle("mese");
const mese = layoutOf(MESE, { seed: 1 });
const wallOfMese = (e) => { const [w, h] = mese.size; return e.from[1] === e.to[1] ? (e.from[1] === 0 ? "south" : e.from[1] === h ? "north" : null) : e.from[0] === 0 ? "west" : e.from[0] === w ? "east" : null; }; // prettier-ignore

broken("checkStyle", "a shop whose window is not on the street", {
  said: /room shop \(storey 0, shop\): its windows are on the east wall; a shop wants one on the south wall, the front/,
  broken: () => {
    const l = copy(mese);
    for (const e of windowsOf(l, "shop")) e.kind = "exterior";
    l.storeyPlans[0].edges.find((e) => e.kind === "exterior" && e.rooms.includes("shop") && wallOfMese(e) === "east").kind = "window"; // prettier-ignore
    return fails(l, meseStyle, meseD);
  },
  whole: () => fails(mese, meseStyle, meseD),
});
broken("checkLayout", "a building of two entrance rooms with one entrance", {
  said: /the layout has 2 entrance edges; it wants 2 entrances of 2/,
  others: true, // the stair hall's flats are then reached from no entrance
  broken: () => {
    const l = copy(mese);
    const gone = l.entrances.pop();
    for (const e of l.storeyPlans[0].edges) if (gone.edges.some((g) => g.from.join() === e.from.join() && g.to.join() === e.to.join())) e.kind = "exterior"; // prettier-ignore
    return checkLayout(l, meseD).failures;
  },
  whole: () => checkLayout(mese, meseD).failures,
});

// the site (site.mjs, levels/specs/mese-01.json): a copy of its plan changed in one place each
const { planSite, checkSite, checkSpawns, spawnsOf, siteSpec } = await import("../../levels/assembly/site.mjs");
const sitePlan = planSite(siteSpec("mese-01"));
const sitePlanned = (change) => {
  const p = { ...sitePlan, site: structuredClone(sitePlan.site), cells: sitePlan.cells.map((row) => [...row]), layouts: new Map([...sitePlan.layouts].map(([k, v]) => [k, copy(v)])) }; // prettier-ignore
  change(p);
  return p;
};
const siteFails = (p, s = meseStyle) => checkSite(p, s).failures;

broken("checkSite", "a portico one cell deep", {
  said: /portico 1: 1 cell deep; a portico wants 2 at least from its columns to the shop fronts/,
  broken: () => siteFails(sitePlanned((p) => (p.site.porticoes[0].rows = [10, 11]))),
  whole: () => siteFails(sitePlan),
});
broken("checkSite", "a street narrower than the RP cities'", {
  said: /the street: its carriageway is 4 cells \(6\.5 m\) across; it wants 5 to 9/,
  broken: () => siteFails(sitePlanned((p) => Object.assign(p.site.areas.find((a) => a.kind === "street"), { from: [0, 12], to: [32, 16] }))),
  whole: () => siteFails(sitePlan),
});
broken("checkSite", "a square too small, its column near its edge", {
  said: /the square: 6 x 9 cells; it wants 8 x 8 at least/,
  others: true, // the column then stands 0 from the square's east edge as well
  broken: () => siteFails(sitePlanned((p) => (p.site.areas.find((a) => a.kind === "square").to = [26, 11]))),
  whole: () => siteFails(sitePlan),
});
broken("checkSite", "two buildings of one footprint", {
  said: /buildings a and d share the footprint 8 x 6; no two buildings are alike/,
  broken: () => siteFails(sitePlanned((p) => (p.site.buildings.find((b) => b.id === "d").size = [8, 6]))),
  whole: () => siteFails(sitePlan),
});
broken("checkSite", "a door joining two properties", {
  said: /building a: door shop-flat1 joins two properties \(shop and flat1\); a property is not reached through another's door/,
  broken: () =>
    siteFails(sitePlanned((p) => {
      const l = p.layouts.get("a");
      l.doors.push({ ...copy(l.doors[0]), rooms: ["shop", "flat1"] });
    })),
  whole: () => siteFails(sitePlan),
});
broken("checkSite", "an entrance opening onto no public floor", {
  said: /building a: the entrance of shop opens onto void at .*; an entrance opens onto public floor/,
  others: true, // the shop's door is then off the street as well
  broken: () =>
    siteFails(sitePlanned((p) => {
      const b = p.site.buildings.find((x) => x.id === "a");
      const en = p.layouts.get("a").entrances.find((x) => x.room === "shop");
      const x = b.at[0] + Math.min(en.edges[0].from[0], en.edges[0].to[0]);
      p.cells[b.at[1] - 1][x] = "void";
    })),
  whole: () => siteFails(sitePlan),
});
broken("checkSite", "homes under their share of the properties", {
  said: /10 homes of 15 properties \(67 %\); homes want 70 % at least/,
  broken: () => {
    const s = structuredClone(meseStyle);
    s.site.homesShare.value = 0.7;
    return checkSite(sitePlan, s).warnings;
  },
  whole: () => checkSite(sitePlan, meseStyle).warnings,
});

broken("checkSpawns", "two spawns too close", {
  said: /spawns 1 and [0-9]+ stand 64 apart; spawns want 256 at least/,
  broken: () => {
    const s = spawnsOf(sitePlan);
    return checkSpawns(sitePlan, [...s, { at: [s[0].at[0] - 1, s[0].at[1]], yaw: 0 }], meseStyle).failures;
  },
  whole: () => checkSpawns(sitePlan, spawnsOf(sitePlan), meseStyle).failures,
});
broken("checkSpawns", "a spawn inside a building", {
  said: /spawn [0-9]+ stands on building b at 13,21; a spawn stands on public floor/,
  broken: () => checkSpawns(sitePlan, [...spawnsOf(sitePlan), { at: [13.5, 21.5], yaw: 0 }], meseStyle).failures,
  whole: () => checkSpawns(sitePlan, spawnsOf(sitePlan), meseStyle).failures,
});

// the dressing (dress.mjs): the Mese's site assembled once, dressed by the H9 dress changed in one place
const { assembleSite } = await import("../../levels/assembly/site.mjs");
const { dressSite, loadDress } = await import("../../levels/assembly/dress.mjs");
const { loadLibrary } = await import("../../levels/assembly/library.mjs");
const siteBuilt = assembleSite(sitePlan, loadLibrary(join(HERE, "../levels/assembly/pieces/mese")), { style: meseStyle });
const h9Dress = loadDress("h9-byzantium");
broken("dressSite", "a shop's list naming a model the dress has no entry for", {
  said: /the dress names a model no_such_chair it has no entry for/,
  broken: () => dressSite(sitePlan, siteBuilt, { ...h9Dress, rooms: { ...h9Dress.rooms, shop: { base: [{ id: "no_such_chair", n: [1, 1] }] } } }).report.failures, // prettier-ignore
  whole: () => dressSite(sitePlan, siteBuilt, h9Dress).report.failures,
});

// a portico's columns held to its beams (porticoes.mjs): the Mese's site with one brush of one column moved
const { checkPorticoes } = await import("../../levels/assembly/porticoes.mjs");
const { shapeOf: shapeOfBrush, box: boxBrush } = await import("../../src/maps/source.mjs");
const porticoFirst = sitePlan.site.porticoes[0];
const porticoAt = [porticoFirst.cells[0] * 64, porticoFirst.columns * 64];
// the first column's brush at z 20..148 (the shaft), 166..176 (the abacus) or 176..192 (the beam) moved by `d` along x or y
const columnMoved = (z0, z1, d, k) => {
  const hit = (b) => { const s = shapeOfBrush(b); return Math.abs(s.min[2] - z0) < 0.5 && Math.abs(s.max[2] - z1) < 0.5 && Math.abs((s.min[0] + s.max[0]) / 2 - porticoAt[0]) <= 33 && Math.abs((s.min[1] + s.max[1]) / 2 - porticoAt[1]) <= 1 && s.max[0] - s.min[0] <= 64 && s.max[1] - s.min[1] <= 40; }; // prettier-ignore
  let done = 0;
  const move = (b) => {
    if (!hit(b)) return b;
    done++;
    const s = shapeOfBrush(b);
    const [lo, hi] = [[...s.min], [...s.max]];
    lo[k] += d;
    hi[k] += d;
    return boxBrush(lo, hi, "marb");
  };
  const map = { ...siteBuilt.map, brushes: siteBuilt.map.brushes.map(move), entities: siteBuilt.map.entities.map((e) => (e.brushes ? { ...e, brushes: e.brushes.map(move) } : e)) }; // prettier-ignore
  if (!done) throw new Error("the case found no brush to move");
  return map;
};
const porticoFails = (map) => checkPorticoes(map, sitePlan).failures;
broken("checkPorticoes", "a column's shaft 6 off its capital", {
  said: /the column at cell \d+,\d+ \(\d+,\d+\): its shaft is 6\.0 off its axis along x/,
  broken: () => porticoFails(columnMoved(20, 148, 6, 0)),
  whole: () => porticoFails(siteBuilt.map),
});
broken("checkPorticoes", "a column's capital 5 off its shaft", {
  said: /its capital is 5\.0 off its axis along y/,
  broken: () => porticoFails(columnMoved(166, 176, 5, 1)),
  whole: () => porticoFails(siteBuilt.map),
});
broken("checkPorticoes", "a solid mass through a column (an oval's corner on the column line)", {
  said: /the column at cell \d+,\d+ \(\d+,\d+\): 1 other brush stands in its way/,
  broken: () => porticoFails({ ...siteBuilt.map, brushes: [...siteBuilt.map.brushes, boxBrush([porticoAt[0] - 64, porticoAt[1] - 64, -16], [porticoAt[0] + 8, porticoAt[1], 192], "sinmarblewall")] }),
  whole: () => porticoFails(siteBuilt.map),
});
broken("checkPorticoes", "an architrave 8 off the column line", {
  said: /its architrave is 8\.0 off its axis along y/,
  others: true, // a beam moved also lies on the next column's capital only half-way; the first column's sentence is the one
  broken: () => porticoFails(columnMoved(176, 192, 8, 1)),
  whole: () => porticoFails(siteBuilt.map),
});

// the lanes of a room's doorways (dress.mjs laneProblems): a room of 3 x 2 cells with a doorway at each end, one clip changed
const { laneProblems } = await import("../../levels/assembly/dress.mjs");
const laneRoom = new Set(["0,0", "1,0", "2,0", "0,1", "1,1", "2,1"]);
const laneDoors = [{ at: [40, 64], label: "the west doorway" }, { at: [152, 64], label: "the east doorway" }];
const laneClip = (lo, hi) => [{ lo: [...lo, 0], hi: [...hi, 40] }];
broken("laneProblems", "a clip in the lane in front of a doorway", {
  said: /the west doorway has no lane 48 across in front of it: a prop's clip at 24,50,0 to 64,90,40 is in it/,
  broken: () => laneProblems(laneRoom, laneDoors, laneClip([24, 50], [64, 90]), 0),
  whole: () => laneProblems(laneRoom, laneDoors, laneClip([100, 8], [140, 40]), 0),
});
broken("laneProblems", "a wall of clips across the room between its doorways", {
  said: /the east doorway cannot be walked to from the west doorway past the props' clips/,
  broken: () => laneProblems(laneRoom, laneDoors, laneClip([90, 8], [102, 120]), 0),
  whole: () => laneProblems(laneRoom, laneDoors, laneClip([90, 8], [102, 80]), 0),
});

// the level below the streets (below.mjs): mese-01 with the tests' small sewer (test/fixtures/mese-01-below.json), changed
// in one place each
const { checkBelow, readBelow, BELOW_RULES } = await import("../../levels/assembly/below.mjs");
const BELOW = JSON.parse(readFileSync(join(HERE, "fixtures/mese-01-below.json"), "utf8"));
const belowPlan = (change = (b) => b) => planSite({ ...siteSpec("mese-01"), below: change(structuredClone(BELOW)) });
const belowWhole = belowPlan();
const starts = spawnsOf(belowWhole);
const belowFails = (p, rules = BELOW_RULES, spawns = starts) => checkBelow(p, rules, spawns).failures;
broken("checkBelow", "a level with two ways down", {
  said: /the level below has 2 ways down; it wants 3 to 5/,
  broken: () => belowFails(belowPlan((b) => ({ ...b, ways: b.ways.filter((w) => w.kind !== "drain") }))),
  whole: () => belowFails(belowWhole),
});
broken("checkBelow", "a level with no stair down", {
  said: /the level below has no stair down/,
  others: true, // and then too few ways, and the square's spur reached from none
  broken: () => belowFails(belowPlan((b) => ({ ...b, ways: b.ways.filter((w) => w.kind !== "stair") }))),
  whole: () => belowFails(belowWhole),
});
broken("checkBelow", "a room no way and no door reaches", {
  said: /the part vault of the level below is reached from no way down/,
  broken: () => belowFails(belowPlan((b) => ({ ...b, parts: [...b.parts, { id: "vault", kind: "room", from: [10, 15], to: [13, 18] }] }))),
  whole: () => belowFails(belowWhole),
});
broken("checkBelow", "a tunnel run on past the longest", {
  said: /the tunnel main runs 20 cells \(33 m\) straight; a tunnel wants 16 at the most/,
  broken: () => belowFails(belowWhole, { ...BELOW_RULES, longest: 16 }),
  whole: () => belowFails(belowWhole),
});
broken("checkBelow", "a level of fewer looks than its rule", {
  said: /the level below wears 3 looks \(cistern, sewer, stairs\); it wants 4 at least/,
  broken: () => belowFails(belowWhole, { ...BELOW_RULES, looks: 4 }),
  whole: () => belowFails(belowWhole),
});
broken("checkBelow", "a manhole where a player starts", {
  said: /the street's manhole opens at 8,14, where a player starts/,
  broken: () => belowFails(belowWhole, BELOW_RULES, [...starts, { at: [8.5, 14.5], yaw: 0 }]),
  whole: () => belowFails(belowWhole),
});
broken("checkBelow", "a drain opening onto a building (planSite's sentence)", {
  said: /below: the street's drain opens onto building a at 4,20; a street's manhole or drain opens onto public floor/,
  others: true, // its shaft then stands over no part of the level, and the level has a way the fewer
  broken: () => belowPlan((b) => ({ ...b, ways: b.ways.map((w) => (w.kind === "drain" ? { ...w, at: [4, 20] } : w)) })).failures,
  whole: () => belowWhole.failures,
});

broken("checkBelow", "a level whose tunnels do not loop (a rule of the level's own: loops)", {
  said: /the level below has 0 loops a chase can circle; it wants 2 at least/,
  broken: () => belowFails(belowWhole, { ...BELOW_RULES, loops: 2 }),
  whole: () => belowFails(belowWhole, { ...BELOW_RULES, loops: 0 }),
});
broken("checkBelow", "a tunnel too tall for the level's rule (tunnelVault)", {
  said: /the tunnel main has a clear height of 208; a tunnel wants 128 to 192, a hall is the high place/,
  others: true, // the spur and the foot are as tall
  broken: () => belowFails(belowWhole, { ...BELOW_RULES, tunnelVault: [128, 192] }),
  whole: () => belowFails(belowPlan((b) => ({ ...b, parts: b.parts.map((p) => (p.kind === "tunnel" ? { ...p, vault: 160 } : p)) })), { ...BELOW_RULES, tunnelVault: [128, 192] }), // prettier-ignore
});
broken("checkBelow", "a level of one ceiling height (vaults)", {
  said: /the level below has 2 ceiling heights \(208, 288\); it wants 3 at least/,
  broken: () => belowFails(belowWhole, { ...BELOW_RULES, vaults: 3 }),
  whole: () => belowFails(belowPlan((b) => ({ ...b, parts: b.parts.map((p) => (p.id === "spur" ? { ...p, vault: 160 } : p)) })), { ...BELOW_RULES, vaults: 3 }), // prettier-ignore
});
// two tunnels that go on one into the other: each short, the run past the longest
const splitMain = (b) => ({ ...b, parts: b.parts.flatMap((p) => (p.id === "main" ? [{ ...p, id: "main-a", to: [14, 15] }, { ...p, id: "main-b", from: [14, 12] }] : [p])) }); // prettier-ignore
broken("checkBelow", "two tunnels that go on straight, together past the longest", {
  said: /a straight run of 20 cells \(33 m\) of tunnels from 4,12 along x; a tunnel wants 16 at the most, then a turn, a hall or an end/,
  broken: () => belowFails(belowPlan(splitMain), { ...BELOW_RULES, longest: 16 }),
  whole: () => belowFails(belowPlan(splitMain), { ...BELOW_RULES, longest: 24 }),
});
const twoDistricts = (south) => ({ ...siteSpec("mese-01"), districts: [{ id: "west", from: [0, 0], to: [6, 28] }, { id: "rest", from: [6, 0], to: [32, 28] }], below: south ? { ...BELOW, ways: BELOW.ways.map((w) => (w.kind === "manhole" ? { ...w, at: [4, 14] } : w)) } : BELOW }); // prettier-ignore
broken("checkBelow", "a district with no way down to the level below (perDistrict)", {
  said: /the district west has no way down to the level below; each district wants one/,
  others: true,
  broken: () => checkBelow(planSite(twoDistricts(false)), { ...BELOW_RULES, perDistrict: true }, starts).failures,
  whole: () => checkBelow(planSite(twoDistricts(true)), { ...BELOW_RULES, perDistrict: true }, starts).failures.filter((f) => /district/.test(f)),
});
broken("checkBelow", "a ladder that steps off onto a building (planSite's sentence)", {
  said: /below: the street's manhole: its ladder steps off onto building a at 8,19; the cell past its wall \(north\) wants public floor/,
  others: true, // its shaft then stands over no part of the level
  broken: () => belowPlan((b) => ({ ...b, ways: b.ways.map((w) => (w.kind === "manhole" ? { ...w, at: [8, 18] } : w)) })).failures, // the portico's last row: building a past its north wall
  whole: () => belowWhole.failures,
});
broken("checkBelow", "a part whose vault is not a whole 16 in 96 to 336", {
  said: /below: the hall: its vault is 100; it wants a clear height over the walkway in 16s, 96 to 336/,
  broken: () => readBelow({ size: [32, 28], below: { ...BELOW, parts: BELOW.parts.map((p) => (p.id === "hall" ? { ...p, name: "the hall", vault: 100 } : p)) } }),
  whole: () => readBelow({ size: [32, 28], below: { ...BELOW, parts: BELOW.parts.map((p) => (p.id === "hall" ? { ...p, name: "the hall", vault: 96 } : p)) } }),
});

broken("checkLayout", "an open leaf cutting off a room's arm one row deep beside it", {
  // a hall 2 x 2 with an arm of one row to the west of its entrance, on the leaf's hinge side (the left of one walking
  // in): the leaf, open, stands across that row, and the arm is reached by nothing else
  said: /the entrance of h \(storey 0\): its leaf, open, stands across the first row of h beside it and cuts off 2 cells of it \(0 0, 1 0\)/,
  others: true, // the bare plan has none of the walls a layout writes
  broken: () =>
    checkLayout({
      size: [4, 2],
      storeyPlans: [{ storey: 0, cells: [["h", "h", "h", "h"], ["o", "o", "h", "h"]], edges: [] }],
      rooms: [{ id: "h", storey: 0, kind: "hall", cells: 6 }, { id: "o", storey: 0, kind: "room", cells: 2 }],
      doors: [],
      entrances: [{ room: "h", storey: 0, edges: [{ from: [2, 0], to: [3, 0] }, { from: [3, 0], to: [4, 0] }], at: [3, 0], swing: "h" }],
    }).failures,
});

// ── what a city of chases wants (test/169-assembly-chase.mjs) ──
// a stair hall or landing one cell across (style rule landingWidth): a plan of a landing with a tail
const byzantium = loadStyle("byzantium");
const landingPlan = (cells) => ({
  size: [4, 3],
  storeys: 1,
  rooms: [{ id: "la", storey: 0, kind: "landing", cells: cells.flat().filter((v) => v === "la").length }],
  storeyPlans: [{ storey: 0, cells, edges: [] }],
  doors: [],
  entrances: [],
});
const landingD = { rooms: [{ id: "la", storey: 0, kind: "landing", area: [2, 12] }] };
const landingWarns = (cells) => checkStyle(landingPlan(cells), landingD, byzantium).warnings;
broken("checkStyle", "a landing with a tail one cell across", {
  said: /room la \(storey 0, landing\): 3 cells are in a stretch one cell across \(2,1; 3,1; 3,2\); a landing wants 2 across all along/,
  broken: () => landingWarns([["la", "la", null, null], ["la", "la", "la", "la"], [null, null, null, "la"]]),
  whole: () => landingWarns([["la", "la", "la", "la"], ["la", "la", "la", "la"], [null, null, null, null]]).filter((w) => /one cell across/.test(w)),
});

// the description's second doors (building.mjs checkBuilding, `extraDoors`)
broken("checkBuilding", "an extra door naming a room that is not one", {
  said: /extra door \["back","nowhere"\]: it wants a pair \[room, room\] of two rooms of one storey/,
  broken: () => checkBuilding({ ...MESE, extraDoors: [["back", "nowhere"]] }).failures,
  whole: () => checkBuilding({ ...MESE, extraDoors: [["back", "hall"]] }).failures,
});
broken("checkBuilding", "an extra door that is a door the description already has", {
  said: /extra door shop-back is a door the description already has/,
  broken: () => checkBuilding({ ...MESE, extraDoors: [["shop", "back"]] }).failures,
  whole: () => checkBuilding({ ...MESE, extraDoors: [["back", "hall"]] }).failures,
});

// the mission arena (arena.mjs)
const { arenasOf } = await import("../../levels/assembly/arena.mjs");
const arenaSite = (a) => ({ arenas: [{ id: "yard", at: [-3072, 0, 0], size: [768, 768, 256], back: [[640, 576, 90]], ...a }] });
const arenaFails = (a) => arenasOf(arenaSite(a), "smak_x").report.failures;
broken("arenasOf", "a room too small for four players and its targets", {
  said: /arena yard: 400 x 768 x 256 is too small a room for four players and its targets; it wants 512 x 512 x 192 at least/,
  broken: () => arenaFails({ size: [400, 768, 256] }),
  whole: () => arenaFails({}),
});
broken("arenasOf", "an arena with no place in the city to put the party back", {
  said: /arena yard: it has no `back`, no place in the city to put the party when the job ends/,
  broken: () => arenaFails({ back: [] }),
  whole: () => arenaFails({}),
});
broken("arenasOf", "an arena past the 4096 a plugin's message carries", {
  said: /arena yard: it reaches -4112, past \+-4096/,
  broken: () => arenaFails({ at: [-4096, 0, 0] }),
  whole: () => arenaFails({}),
});
broken("arenasOf", "a count of starts that is not a whole number up to four", {
  said: /arena yard: spawns is how many starts to make, a whole number from 1 to 4, not 5/,
  broken: () => arenaFails({ spawns: 5 }),
  whole: () => arenaFails({ spawns: 2 }),
});
broken("arenasOf", "a plan the arenas do not have", {
  said: /arena yard: its plan is "cellar"; it wants room, yard, vault, tunnel/,
  broken: () => arenaFails({ plan: "cellar" }),
  whole: () => arenaFails({ plan: "room" }),
});
broken("arenasOf", "a yard too small for its dock, stair and stacks", {
  said: /arena yard: 768 x 768 x 256 is too small for the plan yard; its layout wants 1024 x 768 x 192 at least/,
  broken: () => arenaFails({ plan: "yard" }),
  whole: () => arenaFails({ plan: "yard", size: [1024, 768, 256] }),
});
broken("arenasOf", "a vault too small for its two rooms and the door between", {
  said: /arena yard: 768 x 768 x 256 is too small for the plan vault; its layout wants 896 x 512 x 192 at least/,
  broken: () => arenaFails({ plan: "vault" }),
  whole: () => arenaFails({ plan: "vault", size: [896, 512, 192] }),
});
broken("arenasOf", "a tunnel too short for three lanes and the turns between", {
  said: /arena yard: 768 x 768 x 256 is too small for the plan tunnel; its layout wants 1024 x 640 x 192 at least/,
  broken: () => arenaFails({ plan: "tunnel" }),
  whole: () => arenaFails({ plan: "tunnel", size: [1024, 640, 192] }),
});

// the Kowloon facade's rules (kowloon.mjs kowloonProblems): items and openings given by hand, one thing changed
const { kowloonProblems, KOWLOON_RULES: KR } = await import("../../levels/assembly/kowloon.mjs");
const kItem = (over = {}) => ({ kind: "ac", building: "t1", lo: [0, 0, 150], hi: [30, 16, 170], side: "south", jut: 14, open: 512, J: 48, ...over });
const kWindow = { kind: "window", lo: { lo: [100, 0, 104], hi: [148, 40, 184] }, side: "south" };
broken("kowloonProblems", "a box standing out of the wall at head height", {
  said: /stands out 14 into the street at 60 over the ground; nothing bigger than 2 hangs lower than 100/,
  broken: () => kowloonProblems([kItem({ lo: [0, 0, 60], hi: [30, 16, 80] })], [], KR),
  whole: () => kowloonProblems([kItem()], [], KR),
});
broken("kowloonProblems", "a cage standing out further than a narrow street allows", {
  said: /stands out 30 into a street 128 wide; it allows 24/,
  broken: () => kowloonProblems([kItem({ jut: 30, open: 128, J: 24 })], [], KR),
  whole: () => kowloonProblems([kItem({ jut: 24, open: 128, J: 24 })], [], KR),
});
broken("kowloonProblems", "a patch 3 deep on a wall over a one-cell lane, which allows only a plate of 2", {
  said: /stands out 3 into a street 64 wide; it allows 2/,
  broken: () => kowloonProblems([kItem({ kind: "patch", jut: 3, open: 64, J: 0 })], [], KR),
  whole: () => kowloonProblems([kItem({ kind: "patch", jut: 2, open: 64, J: 0 })], [], KR),
});
broken("kowloonProblems", "an air-conditioner in a window's opening", {
  said: /is in the opening of a window/,
  broken: () => kowloonProblems([kItem({ lo: [110, 0, 124], hi: [130, 16, 140] })], [kWindow], KR),
  whole: () => kowloonProblems([kItem({ lo: [110, 0, 190], hi: [130, 16, 200] })], [kWindow], KR),
});

// the ground's heights (terrain.mjs, levels/specs/terrain-test.json): a copy of its site changed in one place each
const { checkTerrain } = await import("../../levels/assembly/terrain.mjs");
const terrainPlan = planSite(siteSpec("terrain-test"));
const terrainChanged = (change) => {
  const p = { ...terrainPlan, site: structuredClone(terrainPlan.site), cells: terrainPlan.cells.map((row) => [...row]) };
  change(p.site);
  return p;
};
const terrainFails = (change) => checkTerrain(terrainChanged(change)).failures;
const terrainWarns = (change) => checkTerrain(terrainChanged(change)).warnings;
const joinOf = (s, name) => s.joins.find((j) => j.name === name);

broken("checkTerrain", "a ramp steeper than a player walks", {
  said: /the ramp: a ramp rising 600 over 512 \(50 degrees\) is steeper than a player walks/,
  others: true, // its head is then at z 600, not the terrace's 64
  broken: () => terrainFails((s) => (joinOf(s, "the ramp").z = [0, 600])),
  whole: () => terrainFails(() => {}),
});
broken("checkTerrain", "a ramp steeper than the city's 1:8", {
  said: /the ramp: a ramp rising 96 over 512 is 1:5\.3 .* steeper than the city's 1:8/,
  broken: () => terrainWarns((s) => (joinOf(s, "the ramp").z = [0, 96])),
  whole: () => terrainWarns(() => {}),
});
broken("checkTerrain", "a ramp narrower than the lowest street rank", {
  said: /the ramp: 64 wide; a ramp of a street is 96 wide at least/,
  others: true,
  broken: () => terrainFails((s) => Object.assign(joinOf(s, "the ramp"), { to: [15, 24] })),
  whole: () => terrainFails(() => {}),
});
broken("checkTerrain", "a ramp whose head is not at the ground it meets", {
  said: /the ramp: its head is at z 40, and the ground it meets at 14,24 is at z 64; a ramp meets its ground within 16/,
  others: true,
  broken: () => terrainFails((s) => (joinOf(s, "the ramp").z = [0, 40])),
  whole: () => terrainFails(() => {}),
});
broken("checkTerrain", "a stair wider than the street it climbs from", {
  said: /the terrace stair: 256 wide at its foot, wider than the narrow lane it meets \(128\); a stair is no wider than its street/,
  broken: () => terrainFails((s) => s.areas.push({ kind: "street", name: "narrow lane", from: [21, 34], to: [23, 36] })),
  whole: () => terrainFails(() => {}),
});
broken("checkTerrain", "a stair whose treads are shallower than 16", {
  said: /the terrace stair: 21 steps over 4 cells of 64 are 11 deep; a step is 16 deep at least/,
  others: true,
  broken: () => terrainFails((s) => (joinOf(s, "the terrace stair").z = [64, 400])),
  whole: () => terrainFails(() => {}),
});
broken("checkTerrain", "a stair whose rise is not whole steps", {
  said: /the terrace stair: it rises 120, which is not whole steps of 16/,
  others: true,
  broken: () => terrainFails((s) => (joinOf(s, "the terrace stair").z = [64, 184])),
  whole: () => terrainFails(() => {}),
});
broken("checkTerrain", "two heights meeting with no ramp, stair or wall", {
  said: /the ground at z 0 and z 64 meets along y 24, x 18\.\.25, 30\.\.39, with no ramp, stair or retaining wall/,
  broken: () => terrainFails((s) => (s.joins = s.joins.filter((j) => j.name !== "terrace wall east"))),
  whole: () => terrainFails(() => {}),
});
broken("checkTerrain", "a retaining wall where the ground is level", {
  said: /terrace wall west: the ground is level along it \(z 64\)/,
  others: true,
  broken: () => terrainWarns((s) => Object.assign(joinOf(s, "terrace wall west"), { from: [0, 30], to: [14, 30] })),
  whole: () => terrainWarns(() => {}),
});
broken("checkTerrain", "a bridge shorter than the canal", {
  said: /market bridge: it is shorter than the canal: the water goes on past its end at 29,7/,
  broken: () => terrainFails((s) => (s.bridges[0].to = [29, 9])),
  whole: () => terrainFails(() => {}),
});
broken("checkTerrain", "a bridge of a deck narrower than 96", {
  said: /back bridge: 64 wide; a bridge is 96 wide at least/,
  broken: () => terrainFails((s) => (s.bridges[1].width = 64)),
  whole: () => terrainFails(() => {}),
});
broken("checkTerrain", "a bridge deck that leaves a swimmer no air", {
  said: /market bridge: its underside \(z -56\) is within 48 of the water of the Cut \(z -96\)/,
  others: true, // its ends are then higher than the deck
  broken: () => terrainFails((s) => (s.bridges[0].z = -40)),
  whole: () => terrainFails(() => {}),
});
broken("checkTerrain", "a culvert whose ceiling breaks through the street", {
  said: /water gate: its ceiling \(z 8\) leaves less than 32 under the street \(z 0\)/,
  broken: () => terrainFails((s) => (s.culverts[0].height = 200)),
  whole: () => terrainFails(() => {}),
});
broken("checkTerrain", "a culvert too low to stand in", {
  said: /water gate: 64 high; a player stands 72/,
  broken: () => terrainFails((s) => (s.culverts[0].height = 64)),
  whole: () => terrainFails(() => {}),
});
broken("checkTerrain", "a canal too shallow to swim", {
  said: /the Cut: 40 deep; a player swims in 64 at the least/,
  others: true, // its bed, and the culvert's floor with it, move
  broken: () => terrainFails((s) => (s.areas.find((a) => a.kind === "water").depth = 40)),
  whole: () => terrainFails(() => {}),
});
broken("checkTerrain", "a canal with no way out", {
  said: /the Cut: no bank, ramp or stair within 40 of its surface \(z -96\); a swimmer cannot climb out/,
  broken: () => terrainWarns((s) => (s.joins = s.joins.filter((j) => j.name !== "the water stair"))),
  whole: () => terrainWarns(() => {}),
});
broken("checkTerrain", "a join of a kind there is none of", {
  said: /the ramp: its kind is "slope"; a join is a ramp, a stair or a wall/,
  broken: () => terrainFails((s) => (joinOf(s, "the ramp").kind = "slope")),
  whole: () => terrainFails(() => {}),
});
broken("checkTerrain", "a building across two heights", {
  said: /building b stands across the heights 64 and 192; give it a z, or move it to one district/,
  others: true, // the two districts then meet along y 38 with no wall
  broken: () => terrainFails((s) => ((s.districts[0].to = [40, 38]), (s.districts[1].from = [0, 38]))),
  whole: () => terrainFails(() => {}),
});

// the areas that are not rectangles of cells (shapes.mjs, levels/specs/shapes-test.json): a copy of its site changed in one place each
const { checkShapes } = await import("../../levels/assembly/shapes.mjs");
const shapesPlan = planSite(siteSpec("shapes-test"));
const shapesChanged = (change) => {
  const p = { ...shapesPlan, site: structuredClone(shapesPlan.site) };
  change(p.site);
  return p;
};
const shapeFails = (change) => checkShapes(shapesChanged(change)).failures;
const shaped = (s, name) => s.areas.find((a) => a.name === name);

broken("checkShapes", "a shape of a kind there is none of", {
  said: /octagon: shape is "blob"; it wants poly, oval, diagonal/,
  broken: () => shapeFails((s) => (shaped(s, "octagon").shape = "blob")),
  whole: () => shapeFails(() => {}),
});
broken("checkShapes", "a polygon with fewer than three points", {
  said: /octagon: a poly wants points \[\[x, y\], \.\.\.\], three at least/,
  broken: () => shapeFails((s) => (shaped(s, "octagon").points = [[2300, 900], [2400, 900]])),
  whole: () => shapeFails(() => {}),
});
broken("checkShapes", "a corner that is not a whole number", {
  said: /octagon: point 1 is \[2465\.5,832\]; it wants \[x, y\] in whole units/,
  broken: () => shapeFails((s) => (shaped(s, "octagon").points[0] = [2465.5, 832])),
  whole: () => shapeFails(() => {}),
});
broken("checkShapes", "a polygon of points on one line", {
  said: /octagon: its outline is degenerate \(all its points on one line\)/,
  broken: () => shapeFails((s) => (shaped(s, "octagon").points = [[2300, 900], [2400, 900], [2500, 900]])),
  whole: () => shapeFails(() => {}),
});
broken("checkShapes", "a polygon that crosses itself", {
  said: /octagon: its outline crosses or touches itself/,
  broken: () => shapeFails((s) => (shaped(s, "octagon").points = [[2465, 832], [2783, 1500], [2783, 832], [2465, 1600]])),
  whole: () => shapeFails(() => {}),
});
broken("checkShapes", "a corner outside the cells that hold the shape", {
  said: /octagon: its corner 2000,832 is outside its cells/,
  broken: () => shapeFails((s) => (shaped(s, "octagon").points[0] = [2000, 832])),
  whole: () => shapeFails(() => {}),
});
broken("checkShapes", "a street too narrow to walk", {
  said: /diagonal 45: at its widest it is \d+ units across; a player walks 96 at the least/,
  broken: () => shapeFails((s) => (shaped(s, "diagonal 45").width = 64)),
  whole: () => shapeFails(() => {}),
});
broken("checkShapes", "an angled wall one unit off the edge of its cells (a brush too thin to compile)", {
  said: /octagon: its angled walls do not seal: a brush [01]\.\d units thick/,
  broken: () => shapeFails((s) => ((shaped(s, "octagon").points[0] = [2465, 833]), (shaped(s, "octagon").points[1] = [2783, 833]))),
  whole: () => shapeFails(() => {}),
});
broken("checkShapes", "a polygon that touches the edge of its cells at one corner", {
  said: /octagon: its angled walls do not seal: it touches the edge of its cells at one corner only/,
  broken: () => shapeFails((s) => (shaped(s, "octagon").points = [[2300, 900], [2900, 900], [2600, 1600]])),
  whole: () => shapeFails(() => {}),
});
broken("checkShapes", "a shape whose cells another area has", {
  said: /diagonal 24 overlaps octagon at the cells 33,13 to 33,24/,
  broken: () => shapeFails((s) => (shaped(s, "octagon").from = [33, 13])),
  whole: () => shapeFails(() => {}),
});
broken("checkShapes", "a spine that is not inside its oval", {
  said: /hippodrome: its spine \(3000 x 128\) is not inside its oval/,
  broken: () => shapeFails((s) => (shaped(s, "hippodrome").spine.length = 3000)),
  whole: () => shapeFails(() => {}),
});
broken("checkShapes", "a track round the spine too narrow to walk", {
  said: /hippodrome: the track round its spine is \d+ units wide at its narrowest; a player walks 96 at the least/,
  broken: () => shapeFails((s) => (shaped(s, "hippodrome").spine.width = 760)),
  whole: () => shapeFails(() => {}),
});
broken("checkTerrain", "a raised shaped area that opens onto lower ground with no ramp", {
  said: /the ground at z 0 and z 64 meets along x 40, y 37\.\.40, with no ramp, stair or retaining wall/,
  broken: () => checkTerrain(shapesChanged((s) => (s.joins = []))).failures,
  whole: () => checkTerrain(shapesPlan).failures,
});

// ── the sewers on several levels (levels/assembly/below-levels.mjs): two halls and the tunnels between them, changed in one place each ──
const { planLevels, checkLevels, readLevels } = await import("../../levels/assembly/below-levels.mjs");
const hallsOf = (gap = 1000) => [
  { id: "a", shape: "rect", center: [400, 400], size: [256, 448], height: 224 },
  { id: "b", shape: "rect", center: [400 + gap, 400], size: [256, 448], height: 224 },
];
const tunnel = (id, dy, extra = {}, gap = 1000) => ({ id, points: [[528, 400 + dy], [400 + gap - 128, 400 + dy]], width: 64, height: 96, ...extra });
const levelsOf = ({ gap = 1000, tunnels = [tunnel("t0", -140), tunnel("t1", 0), tunnel("t2", 140)], extra = {} } = {}) => ({ levels: [{ id: "L", floor: -384, halls: hallsOf(gap), tunnels, ...extra }] });
const levelFails = (b) => {
  const deep = planLevels(b, null, null);
  return [...deep.failures, ...checkLevels(deep, {}).failures];
};
const levelWarns = (b) => checkLevels(planLevels(b, null, null), {}).warnings;
broken("checkLevels", "a straight tunnel run past 768", {
  said: /the tunnel t0 runs 844 units straight; a tunnel wants 768 at the most, then a bend, a hall or an end/,
  others: true, // the other two tunnels are as long
  broken: () => levelFails(levelsOf({ gap: 1100, tunnels: [tunnel("t0", -140, {}, 1100), tunnel("t1", 0, {}, 1100), tunnel("t2", 140, {}, 1100)] })),
  whole: () => levelFails(levelsOf()),
});
broken("checkLevels", "a tunnel too low to walk (under 72 clear)", {
  said: /the tunnel t1 is 64 high; a player walks under 72 at the least/,
  broken: () => levelFails(levelsOf({ tunnels: [tunnel("t0", -140), tunnel("t1", 0, { height: 64 }), tunnel("t2", 140)] })),
  whole: () => levelFails(levelsOf()),
});
broken("checkLevels", "a tunnel narrower than a player walks through", {
  said: /the tunnel t1 is 48 wide; a player walks through 64 at the least/,
  broken: () => levelFails(levelsOf({ tunnels: [tunnel("t0", -140), tunnel("t1", 0, { width: 48 }), tunnel("t2", 140)] })),
  whole: () => levelFails(levelsOf()),
});
const stairLevels = (width) => ({
  levels: [{ id: "U", floor: -384, halls: [{ id: "a", shape: "rect", center: [400, 400], size: [256, 256], height: 224 }] }, { id: "D", floor: -768, halls: [{ id: "b", shape: "rect", center: [1260, 400], size: [256, 256], height: 224 }] }],
  links: [{ id: "st", kind: "stair", points: [[528, 400, -384], [1132, 400, -768]], width, height: 160 }],
});
broken("checkLevels", "a stair narrower than 96", {
  said: /the stair st is 80 wide; a stair is 96 wide at the least/,
  broken: () => levelFails(stairLevels(80)),
  whole: () => levelFails(stairLevels(96)),
});
broken("checkLevels", "a stair too steep for its steps (under 24 deep)", {
  said: /the stair st drops 384 in 404; its steps are 16\.8\d* deep and want 24 at the least/,
  others: true, // its foot is then not where the lower hall's wall is
  broken: () => levelFails({ ...stairLevels(96), levels: stairLevels(96).levels.map((l) => (l.id === "D" ? { ...l, halls: [{ ...l.halls[0], center: [1060, 400] }] } : l)), links: [{ ...stairLevels(96).links[0], points: [[528, 400, -384], [932, 400, -768]] }] }),
  whole: () => levelFails(stairLevels(96)),
});
const streetStair = (start = 192, open = 3) => ({
  levels: [{ id: "S", floor: -384, halls: [{ id: "h", shape: "rect", center: [960, 1792], size: [384, 256], height: 224 }] }],
  links: [{ id: "ss", kind: "stair", points: [[start, 1792, 0], [768, 1792, -384]], width: 96, height: 160, street: { open } }],
});
broken("checkLevels", "a stair from the street that does not start at a cell corner (planLevels' sentence)", {
  said: /below: ss: a stair from the street starts at a cell corner; 200, 1792 is not one/,
  others: true, // the steps then are not 24 deep
  broken: () => planLevels(streetStair(200), null, null).failures,
  whole: () => planLevels(streetStair(), null, null).failures,
});
broken("checkLevels", "a stair from the street open to the sky for too few cells (readLevels' sentence)", {
  said: /below: ss: street\.open is 2; it wants the cells open to the sky, 3 to 6/,
  broken: () => readLevels(streetStair(192, 2)),
  whole: () => readLevels(streetStair()),
});
broken("checkLevels", "a level with fewer than two loops (a warning)", {
  said: /the level L has 0 loops a chase can circle; it wants 2 at least/,
  broken: () => levelWarns(levelsOf({ tunnels: [tunnel("t0", 0)] })),
  whole: () => levelWarns(levelsOf()),
});
broken("checkLevels", "two tunnels that run through each other", {
  said: /t1 and t3 run into each other: the walls of one are through the air of the other/,
  others: true, // the cross tunnel ends on nothing, so it is reached from no way down
  broken: () => levelFails(levelsOf({ tunnels: [tunnel("t0", -140), tunnel("t1", 0), tunnel("t2", 140), { id: "t3", points: [[900, 100], [900, 700]], width: 64, height: 96 }] })),
  whole: () => levelFails(levelsOf()),
});
broken("checkLevels", "a tunnel that meets a hall's wall at a sharp angle (planLevels' sentence)", {
  said: /below: t1: it meets a's wall at 13 degrees; a tunnel meets a wall at 30 degrees or more/,
  others: true, // a tunnel so slanted has its mouth wider than the wall's room, too
  broken: () => planLevels({ levels: [{ id: "L", floor: -384, halls: hallsOf(), tunnels: [{ id: "t1", points: [[528, 400], [600, 700]], width: 64, height: 96 }] }] }, null, null).failures,
  whole: () => planLevels(levelsOf(), null, null).failures,
});
broken("checkLevels", "a level with a floor that is not a whole 16 (readLevels' sentence)", {
  said: /below: the level L: its floor is -380; it wants the walkway's top, a whole z in 16s/,
  broken: () => readLevels({ levels: [{ id: "L", floor: -380 }] }),
  whole: () => readLevels({ levels: [{ id: "L", floor: -384 }] }),
});

// ── the levels below under a ground that is not at 0 (2026-11-07, "heights"): a fake ground of one height over the whole site ──
const { planBelow } = await import("../../levels/assembly/below.mjs");
const groundOf = (z, n = 80) => ({ ground: Array.from({ length: n }, () => new Array(n).fill(z)), lowest: Math.min(0, z), varied: true });
broken("checkLevels", "a hall whose vault is too close to the ground over it (a street sunk to -200; planLevels' sentence)", {
  said: /below: a: its vault's top at -144 is over -232, the ground the street stands on; the ground over it is at z -200, the sky box's floor at -232, and a vault keeps 32 of rock under both/,
  others: true, // the tunnels, a hall's own and its twin's, are as high
  broken: () => planLevels(levelsOf(), null, null, groundOf(-200)).failures,
  whole: () => planLevels(levelsOf(), null, null, groundOf(128)).failures,
});
const streetStairOn = (z0, run = 768, open = 3) => ({
  levels: [{ id: "S", floor: -384, halls: [{ id: "h", shape: "rect", center: [192 + run + 192, 1792], size: [384, 256], height: 224 }] }],
  links: [{ id: "ss", kind: "stair", points: [[192, 1792, z0], [192 + run, 1792, -384]], width: 96, height: 160, street: { open } }],
});
broken("checkLevels", "a stair from the street that starts at z 0 on a street at 128 (planLevels' sentence)", {
  said: /below: ss: a stair from the street starts at the street's z, 128, not 0/,
  others: true, // its steps are then 12 deep
  broken: () => planLevels(streetStairOn(0), null, null, groundOf(128)).failures,
  whole: () => planLevels(streetStairOn(128), null, null, groundOf(128)).failures,
});
broken("checkLevels", "a stair from the street whose open trench ends too high under the paving (planLevels' sentence)", {
  said: /below: ss: where its open trench ends the steps are at z 64 and the paving over them at z 112: 48 of headroom, 80 wanted; open more cells/,
  broken: () => planLevels(streetStairOn(128, 1536), null, null, groundOf(128)).failures,
  whole: () => planLevels(streetStairOn(128), null, null, groundOf(128)).failures,
});
broken("checkLevels", "a stair from the street on a street that is at two heights (planLevels' sentence)", {
  said: /below: ss: its trench is on ground at z 128 and at z 0 \(\d+,\d+\); a stair from the street goes down under a street of one height/,
  broken: () => {
    const T = groundOf(128);
    for (let y = 0; y < 80; y++) for (let x = 5; x < 80; x++) T.ground[y][x] = 0; // (the stair's trench runs from cell 3 to cell 15 along x)
    return planLevels(streetStairOn(128), null, null, T).failures;
  },
  whole: () => planLevels(streetStairOn(128), null, null, groundOf(128)).failures,
});
broken("checkBelow", "a stair way of the cell sewer on ground that is not at 0 (planBelow's sentence)", {
  said: /below: the square's stair: its wells are two stair-u \(384\) down from a street at z 0, and the ground at 26,6 is at z 128; on a ground that is not at 0 a stair from the street is a link/,
  others: true,
  broken: () => planBelow(belowWhole.site, belowWhole.cells, belowWhole.layouts, groundOf(128)).failures,
  whole: () => planBelow(belowWhole.site, belowWhole.cells, belowWhole.layouts, groundOf(0)).failures,
});
broken("checkBelow", "a part of the cell sewer too close under a ground sunk to -200 (planBelow's sentence)", {
  said: /below: main: its vault's top at -160 is over -232, the ground the street stands on; the ground over it is at z -200 and the sky box's floor at -232, and a vault keeps 32 of rock under both; a floor at -456 at the highest/,
  others: true, // its twins, the hall and the spurs
  broken: () => planBelow(belowWhole.site, belowWhole.cells, belowWhole.layouts, groundOf(-200)).failures,
  whole: () => planBelow(belowWhole.site, belowWhole.cells, belowWhole.layouts, groundOf(128)).failures.filter((f) => !/two stair-u/.test(f)),
});

// shells (shell.mjs, levels/specs/shells-test.json): a copy of the plan, or of the spec, changed in one place each
const { checkShells } = await import("../../levels/assembly/shell.mjs");
const shellSpec = JSON.parse(readFileSync(join(HERE, "../levels/specs/shells-test.json"), "utf8"));
const shellPlan = planSite(shellSpec, { cache: join((await import("node:os")).tmpdir(), "smak-shells-layouts") });
const shellPlanned = (change) => {
  const p = { ...shellPlan, site: structuredClone(shellPlan.site), layouts: new Map([...shellPlan.layouts].map(([k, v]) => [k, copy(v)])), shells: new Map([...shellPlan.shells].map(([k, v]) => [k, copy(v)])) }; // prettier-ignore
  change(p);
  return p;
};
const shellFails = (p, contract = null) => checkShells(p, contract).failures;
const shellSpecWith = (change) => {
  const s = structuredClone(shellSpec);
  change(s.buildings.find((b) => b.id === "b"));
  return planSite(s).failures;
};
const rpOf = { properties: [{ id: "a_shop", building: "a" }], places: [{ id: "a_shop", building: "a" }], paths: { nodes: [{ id: "n1", building: "a", kind: "door" }] } };

broken("checkShells", "a shell given a room in the plan", {
  said: /building b: a shell has rooms, doors or a stair in the plan \(1 rooms\); a shell is a facade and holds none/,
  broken: () => shellFails(shellPlanned((p) => (p.layouts.get("b").rooms = [{ id: "shop", storey: 0, kind: "shop", cells: 8 }]))),
  whole: () => shellFails(shellPlan, rpOf),
});
broken("checkShells", "a shell with no facade in the plan", {
  said: /building b: a shell has no facade in the plan; it cannot be built/,
  broken: () => shellFails(shellPlanned((p) => p.shells.delete("b"))),
  whole: () => shellFails(shellPlan),
});
broken("checkShells", "the level below opening a trapdoor into a shell", {
  said: /building b: the level below opens a trapdoor into a shell; a shell has no floor to cut/,
  broken: () => shellFails(shellPlanned((p) => (p.below = { ways: [{ building: "b", kind: "trapdoor" }] }))),
  whole: () => shellFails(shellPlan),
});
broken("checkShells", "an RP property made for a shell", {
  said: /building b: the RP contract gives a shell the property b_shop; a shell holds no property/,
  broken: () => shellFails(shellPlan, { properties: [{ id: "b_shop", building: "b" }] }),
  whole: () => shellFails(shellPlan, rpOf),
});
broken("checkShells", "an RP place (an NPC's) made for a shell", {
  said: /building b: the RP contract gives a shell the place b_shop; a shell holds no place or NPC/,
  broken: () => shellFails(shellPlan, { places: [{ id: "b_shop", building: "b" }] }),
  whole: () => shellFails(shellPlan, rpOf),
});
broken("checkShells", "a node of the walking graph inside a shell", {
  said: /building b: the walking graph has a door node \(n9\) in a shell; a shell has no inside to walk/,
  broken: () => shellFails(shellPlan, { paths: { nodes: [{ id: "n9", building: "b", kind: "door" }] } }),
  whole: () => shellFails(shellPlan, rpOf),
});
broken("checkShells", "a roof that is neither closed nor walked (readShell's sentence)", {
  said: /building b: roof is "tilted"; a shell's roof is "closed" or "walk"/,
  broken: () => shellSpecWith((b) => (b.roof = "tilted")),
  whole: () => shellSpecWith((b) => (b.roof = "walk")),
});
broken("checkShells", "a dome on a roof that is walked (readShell's sentence)", {
  said: /building b: a dome stands on a roof that is walked; a shell with roof "walk" has none/,
  broken: () => shellSpecWith((b) => (b.dome = "small")),
  whole: () => shellSpecWith((b) => (b.dome = undefined)),
});
broken("checkShells", "a shell that wears the facade of no program (readShell's sentence)", {
  said: /building b: its facade is "castle"; it wants the name of a program with an interior/,
  broken: () => shellSpecWith((b) => (b.facade = "castle")),
  whole: () => shellSpecWith((b) => (b.facade = "tenement")),
});
broken("checkShells", "a shell given a property (readShell's sentence)", {
  said: /building b: a shell is given a property; a shell holds no property, home, key, place or NPC/,
  broken: () => shellSpecWith((b) => (b.property = "b_shop")),
  whole: () => shellSpecWith((b) => (b.property = undefined)),
});
broken("checkShells", "a roof that is neither closed nor walked on a building that is not a shell (readShell's sentence)", {
  said: /building a: roof is "tilted"; a roof is "closed" or "walk"/,
  broken: () => planSite({ ...shellSpec, buildings: shellSpec.buildings.map((b) => (b.id === "a" ? { ...b, roof: "tilted" } : b)) }).failures,
  whole: () => planSite({ ...shellSpec, buildings: shellSpec.buildings.map((b) => (b.id === "a" ? { ...b, roof: "walk" } : b)) }).failures.filter((f) => /roof/.test(f)),
});
broken("checkShells", "a dome on a roof that is walked, on a building that is not a shell (readShell's sentence)", {
  said: /building a: a dome stands on a roof that is walked; a building with roof "walk" has none/,
  broken: () => planSite({ ...shellSpec, buildings: shellSpec.buildings.map((b) => (b.id === "a" ? { ...b, roof: "walk", dome: "small" } : b)) }).failures,
  whole: () => planSite({ ...shellSpec, buildings: shellSpec.buildings.map((b) => (b.id === "a" ? { ...b, roof: "walk" } : b)) }).failures.filter((f) => /roof/.test(f)),
});

// roofs (roofs.mjs, levels/specs/roofs-test.json): the plan, or the description, changed in one place each. The plan's
// layouts are kept as they are: a case moves a building or a roof, and the ways and links are read again over it.
const { checkRoofs, checkRoofsRp } = await import("../../levels/assembly/roofs.mjs");
const roofSpec = JSON.parse(readFileSync(join(HERE, "../levels/specs/roofs-test.json"), "utf8"));
const roofPlan = planSite(roofSpec, { cache: join((await import("node:os")).tmpdir(), "smak-roofs-layouts") });
/** The plan read again with the site changed by `change(site)` (its roofs and buildings are copies). */
const roofsWith = (change) => {
  const p = { ...roofPlan, site: structuredClone(roofPlan.site), roofs: undefined };
  change(p.site);
  return checkRoofs(p).failures;
};
const buildingOf = (site, id) => site.buildings.find((b) => b.id === id);
const way = (site, id) => site.roofs.ways.find((w) => w.id === id);
const link = (site, id) => site.roofs.links.find((l) => l.id === id);
const only = (site, ids) => ((site.roofs.ways = site.roofs.ways.filter((w) => ids.includes(w.id))), (site.roofs.links = site.roofs.links.filter((l) => ids.includes(l.id))));

broken("checkRoofs", "a ladder up to a roof that is closed", {
  said: /way L9: a ladder on building s4 lands nowhere; its roof is closed/,
  broken: () => roofsWith((s) => s.roofs.ways.push({ id: "L9", kind: "ladder", building: "s4", side: "south", at: 0 })),
  whole: () => roofsWith((s) => ((buildingOf(s, "s4").roof = "walk"), s.roofs.ways.push({ id: "L9", kind: "ladder", building: "s4", side: "south", at: 0 }))), // prettier-ignore
});
broken("checkRoofs", "a ladder past the end of its wall", {
  said: /way L1: at 9 is past the south wall of s1, which is 7 cells long/,
  broken: () => roofsWith((s) => (way(s, "L1").at = 9)),
  whole: () => roofsWith(() => {}),
});
broken("checkRoofs", "a ladder over a window", {
  said: /way L1: a ladder stands over a window of building s1 \(south wall, cell 1, storey 0\)/,
  broken: () => roofsWith((s) => (way(s, "L1").at = 1)),
  whole: () => roofsWith(() => {}),
});
broken("checkRoofs", "a ladder over the entrance", {
  said: /way L1: a ladder stands over the entrance of building s1 \(north wall, cell 1, storey 0\)/,
  broken: () => roofsWith((s) => Object.assign(way(s, "L1"), { side: "north", at: 1 })),
  whole: () => roofsWith(() => {}),
});
broken("checkRoofs", "a ladder where a street lamp hangs", {
  said: /way L1: a ladder stands where a street lamp hangs on building s1 \(south wall, cell 2\)/,
  broken: () => roofsWith((s) => (way(s, "L1").at = 2)),
  whole: () => roofsWith(() => {}),
});
broken("checkRoofs", "two ways on one cell of a wall", {
  said: /way L9: the south wall of s1 at 3 is already given to way L1; two ways cannot share a cell/,
  broken: () => roofsWith((s) => s.roofs.ways.push({ id: "L9", kind: "ladder", building: "s1", side: "south", at: 3 })),
  whole: () => roofsWith(() => {}),
});
broken("checkRoofs", "a drop from a roof that is too high over the ground", {
  said: /way D9: a drop of 384 from the roof of n1; a fall over 192 hurts/,
  broken: () => roofsWith((s) => s.roofs.ways.push({ id: "D9", kind: "drop", building: "n1", side: "north", at: 2 })),
  whole: () => roofsWith((s) => s.roofs.ways.push({ id: "D9", kind: "drop", building: "n2", side: "north", at: 2 })),
});
broken("checkRoofs", "a crate climb that runs out onto a building", {
  said: /way C1: a crate climb along the north wall of n3 runs onto building n2 at 15,26/,
  broken: () => roofsWith((s) => (way(s, "C1").run = -1)),
  whole: () => roofsWith(() => {}),
});
broken("checkRoofs", "a stair whose upper steps are a jump from a closed roof", {
  said: /way S1: an outside stair of s3 has a step at \d+ only \d+ from the closed roof of s4 \(at 384\); a player jumps from it onto that roof/,
  broken: () => roofsWith((s) => Object.assign(way(s, "S1"), { side: "east", at: 0, run: 1 })),
  others: true, // (s3 is then reached by the plank alone)
  whole: () => roofsWith(() => {}),
});
broken("checkRoofs", "a gap too wide for a jump, where a plank is required", {
  said: /link P1: a gap of 176 is too wide for a jump \(144 at most\); every gap from 160 wants a plank or a bridge/,
  broken: () => roofsWith((s) => (link(s, "P1").kind = "jump")),
  others: true, // (a jump has no width of its own: s3 keeps its stair)
  whole: () => roofsWith(() => {}),
});
broken("checkRoofs", "a plank between roofs of different heights", {
  said: /link P2: n3 is 192 higher than n2: a plank is flat and a step is 16/,
  broken: () => roofsWith((s) => (buildingOf(s, "n3").tower = 1)),
  others: true, // (the tower is one more storey: the jump J3 down to n4 is 192, the fall allowed)
  whole: () => roofsWith(() => {}),
});
broken("checkRoofs", "a plank over 512 of air", {
  said: /link P1: a plank over 752 of air; no plank is over 512 long/,
  broken: () => roofsWith((s) => ((s.buildings = s.buildings.filter((b) => b.id !== "s3")), (s.roofs.ways = s.roofs.ways.filter((w) => w.id !== "S1")), (link(s, "P1").to = "s4"), (buildingOf(s, "s4").roof = "walk"))), // prettier-ignore
  others: true, // (s4 is reached by the plank alone and has no way down)
  whole: () => roofsWith(() => {}),
});
broken("checkRoofs", "a plank 60 wide", {
  said: /link P1: a plank 60 wide; a plank is 32 to 48/,
  broken: () => roofsWith((s) => (link(s, "P1").width = 60)),
  others: true, // (s3 keeps its stair)
  whole: () => roofsWith(() => {}),
});
broken("checkRoofs", "a bridge one cell wide", {
  said: /link B1: a bridge is 2 cells wide \(a deck of 128\) with a rail on each side, not 1/,
  broken: () => roofsWith((s) => (link(s, "B1").span = 1)),
  others: true,
  whole: () => roofsWith(() => {}),
});
broken("checkRoofs", "a jump up onto a higher roof", {
  said: /link J9: n1 is 192 higher than n2: a jump goes up 16 at most/,
  broken: () => roofsWith((s) => s.roofs.links.push({ id: "J9", kind: "jump", from: "n2", to: "n1", at: 21 })),
  whole: () => roofsWith(() => {}),
});
broken("checkRoofs", "a jump down a fall that hurts", {
  said: /link J2: n2 is 384 lower than n1: a fall of 384 hurts \(192 at most\)/,
  broken: () => roofsWith((s) => (buildingOf(s, "n1").tower = 2)),
  others: true, // (the tower is two storeys over the street: its ladder reaches it still)
  whole: () => roofsWith(() => {}),
});
broken("checkRoofs", "a jump from a roof with no run-up", {
  said: /link J9: the roof of n3 is 64 deep, short of the run-up of 128 a jump wants/,
  broken: () => roofsWith((s) => ((buildingOf(s, "n3").size = [1, 6]), (buildingOf(s, "n4").at = [23, 20]), only(s, ["L1", "L2", "L3", "S1", "P1", "J1", "J2", "B1", "P2"]), s.roofs.links.push({ id: "J9", kind: "jump", from: "n3", to: "n4", at: 22 }))), // prettier-ignore
  others: true,
  whole: () => roofsWith(() => {}),
});
broken("checkRoofs", "a link onto a roof that is closed", {
  said: /link J3: it lands on a closed roof; the roof of n4 is not walked/,
  broken: () => roofsWith((s) => delete buildingOf(s, "n4").roof),
  whole: () => roofsWith(() => {}),
});
broken("checkRoofs", "a link between roofs that do not face each other", {
  said: /link J9: the roofs of s1 and n3 do not face each other/,
  broken: () => roofsWith((s) => s.roofs.links.push({ id: "J9", kind: "jump", from: "s1", to: "n3", at: 10 })),
  whole: () => roofsWith(() => {}),
});
broken("checkRoofs", "a link across another building", {
  said: /link J9: the building s2 stands in the gap at/,
  broken: () => roofsWith((s) => s.roofs.links.push({ id: "J9", kind: "plank", from: "s1", to: "s3", at: 10 })),
  whole: () => roofsWith(() => {}),
});
broken("checkRoofs", "a link between buildings that touch", {
  said: /link J3: the buildings n3 and n4 touch; there is no gap to cross/,
  broken: () => roofsWith((s) => (buildingOf(s, "n4").at = [29, 20])),
  others: true, // (n4 is reached by nothing)
  whole: () => roofsWith(() => {}),
});
broken("checkRoofs", "a link at a cell that is not across both roofs", {
  said: /link P1: the cells 5 are not across both s2 and s3/,
  broken: () => roofsWith((s) => (link(s, "P1").at = 5)),
  whole: () => roofsWith(() => {}),
});
broken("checkRoofs", "a walked roof that nothing reaches", {
  said: /roof n1: it is walked and nothing reaches it/,
  broken: () => roofsWith((s) => (s.roofs.ways = s.roofs.ways.filter((w) => w.id !== "L2"))),
  whole: () => roofsWith(() => {}),
});
broken("checkRoofs", "a roof a player gets up onto and cannot leave", {
  said: /roof n2: a player can get up onto it and no way takes him down/,
  broken: () => roofsWith((s) => {
    for (const b of s.buildings) if (!["n1", "n2"].includes(b.id)) delete b.roof;
    only(s, ["L2", "J2"]);
  }),
  whole: () => roofsWith((s) => {
    for (const b of s.buildings) if (!["n1", "n2"].includes(b.id)) delete b.roof;
    only(s, ["L2", "J2", "L3"]);
  }),
});
broken("checkRoofs", "a way of a kind the roofs do not have (readRoofs' sentence)", {
  said: /way L9: its kind is "rope"; it wants ladder, stair, crates, drop/,
  broken: () => planSite({ ...roofSpec, roofs: { ...roofSpec.roofs, ways: [{ id: "L9", kind: "rope", building: "s1", side: "south", at: 3 }] } }).failures,
  whole: () => planSite({ ...roofSpec, roofs: { ...roofSpec.roofs, ways: [{ id: "L9", kind: "ladder", building: "s1", side: "south", at: 3 }] } }).failures,
});
broken("checkRoofs", "a link to a building the site does not have (readRoofs' sentence)", {
  said: /link J9: to is "z9", no building of the site/,
  broken: () => planSite({ ...roofSpec, roofs: { ...roofSpec.roofs, links: [{ id: "J9", kind: "jump", from: "s1", to: "z9", at: 11 }] } }).failures,
  whole: () => planSite({ ...roofSpec, roofs: { ...roofSpec.roofs, links: [{ id: "J9", kind: "jump", from: "s1", to: "s2", at: 11 }] } }).failures,
});

// the roofs in the RP contract (roofs.mjs checkRoofsRp): for players, none in the NPCs' walking graph
const roofRp = (change = () => {}) => {
  const c = {
    roofs: { roofs: [{ building: "s1", top: 384 }], ways: [{ id: "L1", kind: "ladder", npc: false }, { id: "S1", kind: "stair", npc: "chase" }], links: [{ id: "J1", kind: "jump", npc: false }] },
    paths: { nodes: [{ id: "street_1", kind: "street", building: null, at: [0, 0, 36] }], links: [{ a: "street_1", b: "street_1", how: "walk" }] },
  };
  change(c);
  return checkRoofsRp(c).failures;
};
broken("checkRoofsRp", "a roof node in the walking graph", {
  said: /the walking graph has a roof node \(roof_1\); roofs are for players/,
  broken: () => roofRp((c) => c.paths.nodes.push({ id: "roof_1", kind: "roof", building: "s1", at: [200, 600, 420] })),
  whole: () => roofRp(),
});
broken("checkRoofsRp", "a node of the graph standing on a walked roof", {
  said: /the walking graph has a node \(street_2\) on the roof of s1; roofs are for players/,
  broken: () => roofRp((c) => c.paths.nodes.push({ id: "street_2", kind: "street", building: "s1", at: [200, 600, 420] })),
  whole: () => roofRp(),
});
broken("checkRoofsRp", "a ladder of the roofs marked for NPCs", {
  said: /roof way L1: a ladder is marked for NPCs \(true\); only a stair may be, and only in a chase/,
  broken: () => roofRp((c) => (c.roofs.ways[0].npc = true)),
  whole: () => roofRp(),
});
broken("checkRoofsRp", "a jump of the roofs marked for NPCs", {
  said: /roof link J1: a jump is marked for NPCs; guards do not jump, cross planks or bridges of the roofs/,
  broken: () => roofRp((c) => (c.roofs.links[0].npc = "chase")),
  whole: () => roofRp(),
});
broken("checkRoofsRp", "a link of the walking graph over a roof way", {
  said: /the walking graph has a link over a roof \(street_1 to street_1\); roofs are for players/,
  broken: () => roofRp((c) => (c.paths.links[0].way = "L1")),
  whole: () => roofRp(),
});

// ── the metro (levels/assembly/metro.mjs): metro-test's level below (a concourse, two stations, a line, an entrance), changed in one place each ──
const { checkMetro } = await import("../../levels/assembly/metro.mjs");
const METRO_BELOW = JSON.parse(readFileSync(join(HERE, "../levels/specs/metro-test.json"), "utf8")).below;
/** The metro's level planned with `change` applied to a copy of its description. */
const metroPlan = (change = () => {}) => {
  const b = structuredClone(METRO_BELOW);
  change(b, b.levels[0]);
  return planLevels(b, null, null);
};
const metroFails = (change) => {
  const deep = metroPlan(change);
  return [...deep.failures, ...checkLevels(deep, METRO_BELOW.rules).failures];
};
const metroWarns = (change) => checkLevels(metroPlan(change), METRO_BELOW.rules).warnings;
const metroSaid = (change) => {
  const deep = metroPlan(change);
  const m = checkMetro(deep, METRO_BELOW.rules);
  return [...deep.failures, ...m.failures, ...m.warnings];
};
const hallOf = (l, id) => l.halls.find((h) => h.id === id);
const tunnelOf = (l, id) => l.tunnels.find((t) => t.id === id);
broken("checkMetro", "a station lower than a hall (160)", {
  said: /the station st-a is 160 high; a station is 192 at the least, a hall and not a corridor/,
  others: true, // its mouths are then over the wall's height
  broken: () => metroSaid((b, l) => (hallOf(l, "st-a").height = 160)),
  whole: () => metroSaid(() => {}),
});
broken("checkMetro", "a trench deeper than a player drops into (80)", {
  said: /the station st-a's trench is 80 deep; it wants 32 to 64/,
  others: true, // the line is then 40 deep where it meets the station
  broken: () => metroSaid((b, l) => (hallOf(l, "st-a").trench.depth = 80)),
  whole: () => metroSaid(() => {}),
});
broken("checkMetro", "a trench too narrow for two tracks (128)", {
  said: /the station st-b's trench is 128 wide; two tracks want 160 at the least/,
  others: true, // the line is then 192 wide where it meets the station
  broken: () => metroSaid((b, l) => (hallOf(l, "st-b").trench.width = 128)),
  whole: () => metroSaid(() => {}),
});
broken("checkMetro", "platforms too narrow to walk (a hall only 352 across)", {
  said: /the station st-a's platform is 80 wide on one side; a platform is 96 at the least, on both sides of the trench/,
  others: true, // the mouths in its side walls are then off its platforms
  broken: () => metroSaid((b, l) => (hallOf(l, "st-a").size[1] = 352)),
  whole: () => metroSaid(() => {}),
});
broken("checkMetro", "a station with no crossing over its trench", {
  said: /the station st-b has no crossing over its trench; its two platforms would be two places a citizen cannot go between/,
  broken: () => metroSaid((b, l) => (hallOf(l, "st-b").trench.crossings = [])),
  whole: () => metroSaid(() => {}),
});
broken("checkMetro", "a station too short (368)", {
  said: /the station st-a is 368 long; a station is 384 at the least/,
  others: true, // its trench (160) and platforms (96) then meet a line of 192 and the passages no longer reach its walls
  broken: () =>
    metroSaid((b, l) => {
      hallOf(l, "st-a").size = [368, 352];
      hallOf(l, "st-a").trench.width = 160;
    }),
  whole: () => metroSaid(() => {}),
});
broken("checkMetro", "a line narrower than the trench it meets", {
  said: /the line line-ab is 160 wide and 40 deep where it meets the station st-a, whose trench is 192 wide and 40 deep; they are one trench/,
  others: true, // its walls are then inside the station's mouth
  broken: () => metroSaid((b, l) => (tunnelOf(l, "line-ab").width = 160)),
  whole: () => metroSaid(() => {}),
});
broken("checkMetro", "a tunnel with no trench where it meets a station's trench", {
  said: /the station st-a: line-ab meets its trench at the end wall but has no trench: the rails would stop at its mouth/,
  others: true, // the line is then a tunnel between two stations, its floor 40 over the trench
  broken: () => metroSaid((b, l) => delete tunnelOf(l, "line-ab").trench),
  whole: () => metroSaid(() => {}),
});
broken("checkMetro", "a line that runs into a hall with no trench", {
  said: /the line line-ab meets conc, a hall with no trench: a line runs from station to station/,
  others: true, // (the line then leaves the second station unjoined)
  broken: () => metroSaid((b, l) => (tunnelOf(l, "line-ab").points = [[1760, 864], [1088, 864]])),
  whole: () => metroSaid(() => {}),
});
broken("checkMetro", "a station lit pink (a warning)", {
  said: /the station st-a's light is 230,70,200; a station is lit cream or white \(the channels within 80, never pink\)/,
  others: true, // (both stations are in the one zone)
  broken: () => metroWarns((b, l) => (l.lights.station = { color: [230, 70, 200], brightness: 150, every: 192 })),
  whole: () => metroWarns(() => {}),
});
broken("checkMetro", "a station too dim to read a platform by (a warning)", {
  said: /the station st-a's light is 90 bright; a platform reads at 150 at the least/,
  others: true, // (both stations are in the one zone)
  broken: () => metroWarns((b, l) => (l.lights.station = { color: [210, 195, 175], brightness: 90, every: 192 })),
  whole: () => metroWarns(() => {}),
});
broken("checkMetro", "a line lit cold (a warning)", {
  said: /the line line-ab's lamps are 120,150,255; a line is lit warm \(more red than blue, never pink\)/,
  broken: () => metroWarns((b, l) => (l.lights.line = { color: [120, 150, 255], brightness: 150, every: 192 })),
  whole: () => metroWarns(() => {}),
});
broken("checkMetro", "a concourse lower than a hall (160)", {
  said: /the concourse conc is 160 high; a concourse is 192 at the least/,
  others: true, // the entrance's mouth is then over its wall
  broken: () => metroSaid((b, l) => (hallOf(l, "conc").height = 160)),
  whole: () => metroSaid(() => {}),
});
broken("checkMetro", "an entrance narrower than 128 (a stair of 96)", {
  said: /the entrance entrance is 96 wide; a metro entrance is 128 at the least/,
  broken: () =>
    metroSaid((b) => {
      const e = b.links[0];
      e.width = 96;
      e.points = [[192, 896, 0], [768, 896, -384]];
    }),
  whole: () => metroSaid(() => {}),
});
broken("checkMetro", "an entrance that opens straight onto a station's platforms", {
  said: /the entrance entrance opens straight onto the platforms of st-a; a concourse stands between a stair and the platforms/,
  others: true, // the concourse is then reached from no way down
  broken: () => metroSaid((b) => (b.links[0].points = [[704, 864, 0], [1184, 864, -384]])),
  whole: () => metroSaid(() => {}),
});
broken("checkMetro", "an entrance into a hall that is no concourse", {
  said: /the entrance entrance opens into conc, which is no concourse \(role: "concourse"\)/,
  broken: () => metroSaid((b, l) => delete hallOf(l, "conc").role),
  whole: () => metroSaid(() => {}),
});
broken("checkMetro", "a concourse that leads to no station", {
  said: /the concourse conc of the entrance entrance leads to no station/,
  others: true, // the stations are then reached from no way down
  broken: () => metroSaid((b, l) => (l.tunnels = l.tunnels.filter((t) => !["pass-s", "pass-n", "back"].includes(t.id)))),
  whole: () => metroSaid(() => {}),
});
broken("checkMetro", "a station whose walls are not along x and y (planLevels' sentence)", {
  said: /below: st-a: a station's walls run along x and y \(a rect hall turned a quarter turn at the most\)/,
  others: true, // the tunnels then meet its walls slantwise
  broken: () => metroFails((b, l) => (hallOf(l, "st-a").rotate = 45)),
  whole: () => metroFails(() => {}),
});
broken("checkMetro", "a wide entrance that does not start at the middle of a cell across (planLevels' sentence)", {
  said: /below: entrance: a stair from the street starts at a cell's edge along its run and the middle of a cell across it \(three cells wide\); 192, 880 is not one/,
  others: true, // its foot is then off the concourse's wall
  broken: () => metroFails((b) => (b.links[0].points = [[192, 880, 0], [768, 880, -384]])),
  whole: () => metroFails(() => {}),
});
broken("checkMetro", "a trench on a hall that is not a rect (readMetro's sentence)", {
  said: /below: st-a: a hall with a trench is a rect hall \(a station runs straight\)/,
  others: true, // (an octagon wants a radius)
  broken: () => {
    const b = structuredClone(METRO_BELOW);
    hallOf(b.levels[0], "st-a").shape = "octagon";
    return readLevels(b);
  },
  whole: () => readLevels(METRO_BELOW),
});
broken("checkMetro", "a line with a trench and water both (readMetro's sentence)", {
  said: /below: line-ab: a line has a trench or water, not both/,
  broken: () => {
    const b = structuredClone(METRO_BELOW);
    tunnelOf(b.levels[0], "line-ab").water = { depth: 24, strip: 0.5 };
    return readLevels(b);
  },
  whole: () => readLevels(METRO_BELOW),
});

// ── the metro's parked trains and fake rides (metro.mjs trench.train, ride.mjs) and a way down at a door (below.mjs doorClear) ──
broken("checkMetro", "a train that runs past the end of its station", {
  said: /the train of the station st-a runs from 96 to 880 along a hall 576 long; it keeps 72 clear of each end wall/,
  others: true, // (it is then over the crossing too)
  broken: () => metroSaid((b, l) => (hallOf(l, "st-a").trench.train = { side: 0, cars: 2, from: 96 })),
  whole: () => metroSaid(() => {}),
});
broken("checkMetro", "a train standing over its station's crossing", {
  said: /the train of the station st-a stands over its crossing \(368 to 464 along\): the platforms would not be one place/,
  broken: () => metroSaid((b, l) => (hallOf(l, "st-a").trench.train = { side: 0, cars: 1, from: 72 })),
  whole: () => metroSaid(() => {}),
});
broken("checkMetro", "a train that is not a train (readMetro's sentence)", {
  said: /below: st-a: its train wants \{ side: 0 or 1, cars: 1 to 3, from: how far along the hall it starts \}/,
  broken: () => {
    const b = structuredClone(METRO_BELOW);
    hallOf(b.levels[0], "st-a").trench.train = { side: 2, cars: 9 };
    return readLevels(b);
  },
  whole: () => readLevels(METRO_BELOW),
});
const { checkRides } = await import("../../levels/assembly/ride.mjs");
/** metro-test's site with a train of one car in each station and one ride between them, `change`d. */
const ridePlan = (change = () => {}) => {
  const b = structuredClone(METRO_BELOW);
  const l = b.levels[0];
  for (const id of ["st-a", "st-b"]) hallOf(l, id).trench.train = { side: id === "st-a" ? 0 : 1, cars: 1, from: 72 };
  b.rides = [{ id: "x", from: "st-a", to: "st-b", at: [0, 0, -3200], time: 16 }];
  change(b, l);
  return planSite({ ...siteSpec("metro-test"), below: b });
};
const rideFails = (change) => checkRides(ridePlan(change)).failures;
broken("checkRides", "a ride from a station with no train", {
  said: /ride x: st-b has no train; a ride runs from a station with a parked train to another/,
  broken: () => rideFails((b, l) => delete hallOf(l, "st-b").trench.train),
  whole: () => rideFails(() => {}),
});
broken("checkRides", "a ride between trains of different lengths", {
  said: /ride x: st-a has 1 cars and st-b 2; the ride car is the one train of both/,
  broken: () => rideFails((b, l) => (hallOf(l, "st-b").trench.train.cars = 2)),
  whole: () => rideFails(() => {}),
});
broken("checkRides", "a ride room past the world's limit", {
  said: /the ride x's room reaches .* past \+-4096/,
  broken: () => rideFails((b) => (b.rides[0].at = [9000, 0, -3200])),
  whole: () => rideFails(() => {}),
});
broken("checkRides", "a ride that lasts two seconds", {
  said: /the ride x lasts 2 seconds; it wants 8 to 40/,
  broken: () => rideFails((b) => (b.rides[0].time = 2)),
  whole: () => rideFails(() => {}),
});
broken("checkRides", "two rides in one room", {
  said: /the rooms of the rides x and y overlap; one is in the other/,
  broken: () => rideFails((b) => b.rides.push({ ...b.rides[0], id: "y" })),
  whole: () => rideFails(() => {}),
});
broken("checkRides", "two rides with one name", {
  said: /the ride x is named twice; the names of its entities would be one/,
  others: true, // (and in one room)
  broken: () => rideFails((b) => b.rides.push({ ...b.rides[0] })),
  whole: () => rideFails(() => {}),
});
broken("checkBelow", "a way down within 96 of a street door", {
  said: /opens \d+ from the door of .* in building .*; a way down keeps 100000 clear of a street door/,
  others: true, // (every way is then too near some door)
  broken: () => belowFails(belowWhole, { ...BELOW_RULES, doorClear: 100000 }),
  whole: () => belowFails(belowWhole),
});
