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
