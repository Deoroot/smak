// The architecture rulebook (levels/rules/architecture.json, levels/lib/architecture-rules.mjs): the rulebook valid,
// converted to GoldSrc's and s&box's units through the hull, a description's tightening taken and its loosening
// refused, and each check passing a good case and failing a broken copy by the sentence it gives: doors, stairs,
// ceilings, keep-clear volumes and props against them, room programs, circulation. Then New Byzantium's buildings and
// connectors and rpg-dungeon-01's spaces held to the rulebook; where they break it, the sentences are printed as
// notes (those files belong to their descriptions, not to this test).
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test, sure, HERE } from "./helper.mjs";
import {
  loadRules, validateRules, rulesFor, tighten, hullMetres, doorFits, stairFits, ceilingFits, keepClearOf,
  overlapsKeepClear, roomProgramOk, circulationOk, FORMAT, DOOR_KINDS_WANTED,
} from "../levels/lib/architecture-rules.mjs"; // prettier-ignore
import { BUILDING_TYPES, ROOM_SIZES, UNIT_CLASSES, typeTable, programOf, unitsOf } from "../levels/lib/city-description.mjs"; // prettier-ignore
import { DEFAULT_SIZES } from "../levels/lib/description.mjs";

const RULES = loadRules();
const fresh = () => JSON.parse(JSON.stringify(RULES));
const has = (r, words, what) => {
  const all = r.failures.join(" | ");
  sure(!r.ok && all.includes(words), `${what}: wanted a failure with "${words}", got: ${all || "PASS"}`);
};
const passes = (r, what) => sure(r.ok, `${what}: ${r.failures.join(" | ")}`);

test("architecture rules: the rulebook validates, names every door kind and city type, and states its scale", () => {
  const { errors } = validateRules(RULES);
  sure(errors.length === 0, errors.join(" | "));
  sure(RULES.format === FORMAT, `format ${RULES.format}`);
  for (const k of DOOR_KINDS_WANTED) sure(RULES.dimensions.doors[k], `door kind ${k}`);
  for (const t of Object.keys(BUILDING_TYPES)) sure(RULES.programs[t], `no program for the city type ${t}`);
  sure(RULES.scale.horizontal === 1.6 && RULES.scale.why.length > 100, "the scale factor and why");
  const hull = hullMetres(RULES);
  sure(Math.abs(hull.width - 0.8128) < 1e-9 && Math.abs(hull.height - 1.8288) < 1e-9 && Math.abs(hull.step - 0.4572) < 1e-9, `hull ${JSON.stringify(hull)}`); // prettier-ignore
});

test("architecture rules: rulesFor converts lengths and areas through the hull and leaves grades alone", () => {
  const g = rulesFor("goldsrc", RULES);
  sure(g.units.length === "units" && g.hullNow.width === 32 && g.hullNow.step === 18, "GoldSrc's hull");
  sure(Math.abs(g.dimensions.doors.house.width.min - 1.2 / 0.0254) < 0.01, `house door ${g.dimensions.doors.house.width.min}`); // prettier-ignore
  sure(Math.abs(g.roomKinds.bedroom.minArea - 20 / 0.0254 ** 2) < 1, `bedroom area ${g.roomKinds.bedroom.minArea}`);
  sure(g.dimensions.stairs.maxPitch === 0.75 && g.dimensions.ramps.vehicle.maxGrade === 0.15, "grades unchanged");
  sure(g.placement.maxCoveredShare.public === 0.35 && g.circulation.stairs.minPerStorey === 1, "shares and counts unchanged"); // prettier-ignore
  const s = rulesFor("sbox", RULES);
  sure(s.hullNow.height === 72 && s.hullNow.crouch === 36, "s&box's hull from rpg_sbox's scenes");
  // an 8-unit riser on a 12-unit run, 64 units wide: a GoldSrc stair passes in units
  passes(stairFits({ id: "g", kind: "public", rise: 8, run: 12, width: 80 }, g), "GoldSrc stair in units");
  let threw = "";
  try { rulesFor("quake", RULES); } catch (e) { threw = e.message; } // prettier-ignore
  sure(threw.includes('no hull for engine "quake"'), threw);
});

test("architecture rules: validation names the field and what it wanted", () => {
  const r = fresh();
  r.dimensions.doors.secret.width.min = 0.7;
  r.dimensions.doors.house.source = ["nobody"];
  delete r.dimensions.doors.gate;
  r.dimensions.corridors.public.width.typical = 1.0;
  r.dimensions.stairs.rise.max = 0.5;
  r.programs.shop.required.vault = 1;
  r.roomKinds.toilet.zone = "attic";
  r.placement.maxCoveredShare.hall = 1.5;
  r.programs.huts.entranceRank.allowed = ["toilet"];
  delete r.programs.msr.cellsPerStorey.why;
  r.circulation.noPassThrough.kinds.push("closet");
  r.circulation.stairs.loggia.keepUnder = 2;
  r.dimensions.cellBars.kinds.push("cage");
  r.dimensions.cellBars.clearGap.max = 0.01;
  r.dimensions.cellBars.fallback = "sprite";
  r.forms.reserveShare = 1;
  const all = validateRules(r).errors.join(" | ");
  for (const words of [
    "dimensions.doors.secret.width.min: 0.7 m is under the hull's 1.013 m",
    'dimensions.doors.house.source: cites "nobody"',
    "dimensions.doors.gate: missing",
    "dimensions.corridors.public.width.typical: 1 is under the min 2.4",
    "dimensions.stairs.rise.max: 0.5 m is over the hull's step (0.457 m)",
    "programs.shop.required.vault: no such room kind",
    "roomKinds.toilet.zone: wanted one of",
    "placement.maxCoveredShare.hall: wanted a share in [0, 1]",
    `programs.huts.entranceRank.allowed: "toilet" is not one of the program's entrance kinds`,
    "programs.msr.cellsPerStorey.why: wanted the reason, a sentence",
    'circulation.noPassThrough.kinds: no such room kind "closet"',
    "circulation.stairs.loggia.keepUnder: wanted a share of maxAreaOnOneStair in (0, 1]",
    `dimensions.cellBars.kinds: no such room kind "cage"`,
    "dimensions.cellBars.clearGap.max: wanted the clear gap between bars in metres",
    `dimensions.cellBars.fallback: wanted "masked" or nothing, got "sprite"`,
    "forms.reserveShare: wanted a share in [0, 1) with its reserveNote",
  ]) sure(all.includes(words), `missing "${words}" in: ${all}`); // prettier-ignore
  sure(validateRules({ format: "x" }).errors[0].startsWith("format:"), "format named first");
});

test("architecture rules: a description may tighten the rulebook, never loosen it", () => {
  const ok = tighten(RULES, {
    dimensions: { doors: { house: { width: { min: 1.42, typical: 1.6 } } }, stairs: { maxPitch: 0.6 } },
    circulation: { privateThroughAllowed: [["bedroom", "toilet"]], corridor: { maxRun: 20 } },
    programs: { shop: { required: { "shop-floor": 1, backroom: 1, storeroom: 1 }, adjacency: [...RULES.programs.shop.adjacency, { a: "storeroom", next: ["backroom"], why: "stock behind" }] } }, // prettier-ignore
    placement: { maxCoveredShare: { public: 0.3 } },
  });
  sure(ok.errors.length === 0, ok.errors.join(" | "));
  sure(ok.rules.dimensions.doors.house.width.min === 1.42 && ok.rules.dimensions.stairs.maxPitch === 0.6, "tightened numbers"); // prettier-ignore
  sure(ok.rules.circulation.privateThroughAllowed.length === 1 && ok.rules.programs.shop.required.storeroom === 1, "lists and programs"); // prettier-ignore
  const bad = tighten(RULES, {
    dimensions: { doors: { house: { width: { min: 0.9 } } }, stairs: { maxPitch: 0.9 } },
    circulation: { privateThroughAllowed: [["bedroom", "toilet"], ["bedroom", "kitchen"]], everyRoomReached: false },
    programs: { shop: { required: { backroom: 0 }, waive: [{ when: { unitsOnly: ["flat-s"] }, kinds: ["backroom"] }] }, msr: { adjacency: [] } }, // prettier-ignore
    placement: { maxCoveredShare: { storage: 0.9 } },
    hull: { engines: { goldsrc: { width: 24 } } },
  });
  const all = bad.errors.join(" | ");
  for (const words of [
    "dimensions.doors.house.width.min: 0.9 would loosen the rulebook's 1.2; a description may only raise it",
    "dimensions.stairs.maxPitch: 0.9 would loosen the rulebook's 0.75; a description may only lower it",
    'circulation.privateThroughAllowed: may only shorten (it lists allowances); [["bedroom","kitchen"]] would loosen it',
    "circulation.everyRoomReached: true in the rulebook; a description may not turn it off",
    "programs.shop.required.backroom: 0 would loosen the rulebook's 1",
    "programs.shop.waive: may only shorten",
    "programs.msr.adjacency: may only lengthen (it lists demands)",
    "placement.maxCoveredShare.storage: 0.9 would loosen the rulebook's 0.7",
    "hull.engines.goldsrc.width: fixed by the rulebook at 32",
  ]) sure(all.includes(words), `missing "${words}" in: ${all}`); // prettier-ignore
  sure(bad.rules.dimensions.doors.house.width.min === 1.2 && bad.rules.programs.msr.adjacency.length > 0, "loosening left as it was"); // prettier-ignore
});

test("architecture rules: doorFits, stairFits and ceilingFits pass good cases and name the number a broken one wanted", () => {
  passes(doorFits({ id: "d1", kind: "house", width: 1.42, height: 2.5 }, RULES), "house door");
  has(doorFits({ id: "d1", kind: "house", width: 1.0, height: 2.5 }, RULES), "door d1 (house): clear width 1 m, wanted 1.2 m or more", "narrow door"); // prettier-ignore
  has(doorFits({ id: "g", kind: "gate", width: 3.25, height: 2.0 }, RULES), "door g (gate): clear height 2 m, wanted 2.7 m or more", "low gate"); // prettier-ignore
  has(doorFits({ id: "x", kind: "hatch", width: 2, height: 3 }, RULES), 'no door kind "hatch"', "unknown kind");
  const good = { id: "s1", kind: "public", rise: 0.2, run: 0.3, width: 2.4, headroom: 3.0, risers: 15, landing: 2.4 };
  passes(stairFits(good, RULES), "public stair");
  has(stairFits({ ...good, rise: 0.25 }, RULES), "stair s1 (public): rise 0.25 m, wanted 0.21 m or more".replace("or more", "or less"), "steep riser"); // prettier-ignore
  has(stairFits({ ...good, rise: 0.2, run: 0.25 }, RULES), "pitch 0.8 (rise over run), wanted 0.75 or less", "steep pitch"); // prettier-ignore
  has(stairFits({ ...good, width: 1.2 }, RULES), "width 1.2 m, wanted 1.8 m or more", "narrow stair");
  has(stairFits({ ...good, headroom: 2.0 }, RULES), "headroom 2 m, wanted 2.44 m or more", "low headroom");
  has(stairFits({ ...good, risers: 19 }, RULES), "19 risers in a flight, wanted 16 or fewer", "long flight");
  has(stairFits({ ...good, landing: 1.5 }, RULES), "landing 1.5 m deep, wanted 2.4 m or more", "short landing");
  passes(ceilingFits({ id: "c", kind: "cell", height: 3.0 }, RULES), "cell ceiling");
  has(ceilingFits({ id: "h", kind: "hall", height: 3.0 }, RULES), "room h (hall): ceiling 3 m, wanted 4.5 m or more (a hall ceiling)", "low hall"); // prettier-ignore
});

test("architecture rules: keep-clear volumes and props against them", () => {
  const door = { kind: "door", id: "d1", at: [0, 0, 0], facing: [1, 0], width: 1.4, height: 2.5, wall: 0.2 };
  const boxes = keepClearOf(door, RULES);
  sure(boxes.length === 4 && boxes.map((b) => b.what).join(",").includes("approach (back)"), boxes.map((b) => b.what).join(", ")); // prettier-ignore
  const front = boxes.find((b) => b.what.includes("approach (front)"));
  sure(front.min[0] === 0.1 && front.max[0] === 1.3 && front.min[1] === -1 && front.max[1] === 1 && front.max[2] === 2.8, JSON.stringify(front)); // prettier-ignore
  const items = [
    door,
    { kind: "stair", id: "s1", at: [5, 0, 0], facing: [0, 1], width: 2, run: 4, rise: 3 },
    { kind: "light", id: "l1", at: [3, 3, 3.5], size: [0.3, 0.3, 0.2] },
    { kind: "switch", id: "w1", at: [-0.1, 2, 1.2], facing: [-1, 0], size: [0.1, 0.15] },
    { kind: "sign", id: "g1", at: [0.1, -3, 2.0], facing: [1, 0], size: [1.2, 0.6] },
    { kind: "lift", id: "lf", at: [10, 10, 0], facing: [-1, 0], car: [2.4, 2.4, 3.0] },
    { kind: "spawn", id: "sp", at: [8, -6, 0] },
    { kind: "window", id: "wn", at: [3, -0.1, 0], facing: [0, 1], width: 1.2, sill: 1.1, head: 2.6 },
  ];
  passes(overlapsKeepClear({ id: "crate", at: [3, -5, 0], size: [0.8, 0.8, 0.8] }, items, RULES), "a crate in the clear");
  has(overlapsKeepClear({ id: "crate", at: [0.6, 0, 0], size: [0.8, 0.8, 0.8] }, items, RULES), "prop crate enters door d1's approach (front) by", "crate in a doorway"); // prettier-ignore
  has(overlapsKeepClear({ id: "beam", at: [0, 0, 0], size: [3, 0.2, 3] }, items, RULES), "enters door d1's opening", "a prop across the opening"); // prettier-ignore
  has(overlapsKeepClear({ id: "crate", at: [5, 2, 0], size: [0.8, 0.8, 0.8] }, items, RULES), "enters stair s1's flight and headroom", "crate on a stair"); // prettier-ignore
  has(overlapsKeepClear({ id: "shelf", at: [3, 3, 0], size: [0.6, 0.6, 3.0] }, items, RULES), "enters light l1's fitting and below it", "tall shelf under a lamp"); // prettier-ignore
  has(overlapsKeepClear({ id: "box", at: [-0.6, 2, 0], size: [0.5, 0.5, 0.5] }, items, RULES), "enters switch w1's use space", "box before a switch"); // prettier-ignore
  has(overlapsKeepClear({ id: "pillar", at: [1.5, -3, 0], size: [0.4, 0.4, 3] }, items, RULES), "enters sign g1's reading space", "pillar before a sign"); // prettier-ignore
  has(overlapsKeepClear({ id: "barrel", at: [8, 10, 0], size: [0.6, 0.6, 1] }, items, RULES), "enters lift lf's landing", "barrel on a lift landing"); // prettier-ignore
  has(overlapsKeepClear({ id: "barrel", at: [8.4, -6, 0], size: [0.6, 0.6, 1] }, items, RULES), "enters spawn sp's hull and margin", "barrel on a spawn"); // prettier-ignore
  has(overlapsKeepClear({ id: "cabinet", at: [3, 0.3, 0], size: [1, 0.5, 2] }, items, RULES), "enters window wn's front", "cabinet before a window"); // prettier-ignore
  // in GoldSrc's units the same doorway, scaled, gives the same answer
  const g = rulesFor("goldsrc", RULES);
  const u = (m) => m / 0.0254;
  const gd = { ...door, width: u(1.4), height: u(2.5), wall: u(0.2) };
  has(overlapsKeepClear({ id: "crate", at: [u(0.6), 0, 0], size: [32, 32, 32] }, [gd], g), "units, wanted 0 units", "units in the sentence"); // prettier-ignore
  let threw = "";
  try { keepClearOf({ kind: "door", id: "dx", at: [0, 0, 0], facing: [1, 1], width: 1, height: 2 }, RULES); } catch (e) { threw = e.message; } // prettier-ignore
  sure(threw.includes("dx.facing: wanted an axis"), threw);
});

test("architecture rules: roomProgramOk holds a building's rooms to its type's program", () => {
  const shop = { id: "pawn", type: "shop", footprint: [9.75, 13], storeys: 1 };
  passes(roomProgramOk(shop, [{ kind: "shop-floor", w: 6.5, d: 8 }, { kind: "backroom", w: 4, d: 4 }], RULES), "a shop");
  has(roomProgramOk(shop, { "shop-floor": 1 }, RULES), "building pawn (shop): 0 backroom, wanted 1 or more", "no back room"); // prettier-ignore
  has(roomProgramOk(shop, { "shop-floor": 1, backroom: 1, cell: 1 }, RULES), "a cell is not in the program of a shop (wanted 0", "a cell in a shop"); // prettier-ignore
  has(roomProgramOk(shop, [{ kind: "shop-floor", w: 3, d: 8 }, { kind: "backroom", w: 4, d: 4 }], RULES), "narrow side 3 m, wanted 4.8 m or more", "narrow shop floor"); // prettier-ignore
  has(roomProgramOk(shop, [{ kind: "shop-floor", w: 9, d: 12 }, { kind: "backroom", w: 4, d: 6 }], RULES), "its rooms take 132 m2, wanted 126.75 or less", "rooms over the footprint"); // prettier-ignore
  has(roomProgramOk({ id: "c", type: "public" }, { office: 1, stall: 2 }, RULES), "none of hall, ward, courtroom, wanted 1 or more", "a public building without its hall"); // prettier-ignore
  const terrace = { id: "t", type: "apartment", units: { house: 4 } };
  passes(roomProgramOk(terrace, {}, RULES), "a terrace waives the lobby and stair");
  has(roomProgramOk({ ...terrace, units: { "flat-s": 4 } }, {}, RULES), "0 lobby, wanted 1 or more", "flats need a lobby"); // prettier-ignore
  has(roomProgramOk({ id: "w", type: "apartment", homes: [{ name: "flat-m", area: 50, rooms: ["living", "bedroom"] }] }, { lobby: 1, stairwell: 1 }, RULES), "home flat-m of building w (apartment): 50 m2, wanted 61 or more", "a cramped home"); // prettier-ignore
  has(roomProgramOk({ id: "q", type: "castle" }, {}, RULES), 'no program for type "castle"', "unknown type");
});

test("architecture rules: circulationOk holds reach, privacy, adjacency, corridors and stairs", () => {
  const house = {
    id: "h1", type: "house", entrances: ["hall"],
    rooms: [
      { id: "hall", kind: "corridor", storey: 0, length: 6 },
      { id: "liv", kind: "living", storey: 0, exterior: true, area: 45 },
      { id: "kit", kind: "kitchen", storey: 0, area: 16 },
      { id: "st", kind: "stairwell", storey: [0, 1], area: 20 },
      { id: "bed1", kind: "bedroom", storey: 1, exterior: true, area: 22 },
      { id: "wc", kind: "toilet", storey: 1, area: 4 },
      { id: "bed2", kind: "bedroom", storey: 1, exterior: true, area: 22 },
      { id: "land", kind: "corridor", storey: 1, length: 4 },
    ],
    links: [
      { from: "hall", to: "liv" }, { from: "liv", to: "kit" }, { from: "hall", to: "st" }, { from: "st", to: "land" },
      { from: "land", to: "bed1" }, { from: "bed1", to: "wc" }, { from: "land", to: "bed2" },
    ],
  }; // prettier-ignore
  passes(circulationOk(house, RULES), "a house");
  const copy = () => JSON.parse(JSON.stringify(house));
  let g = copy();
  g.links = g.links.filter((l) => l.to !== "bed2");
  has(circulationOk(g, RULES), "room bed2 (bedroom) is not reached from the entrance (hall), wanted every room reached", "cut off"); // prettier-ignore
  g = copy();
  g.rooms.push({ id: "study", kind: "study", storey: 1, exterior: true });
  g.links.push({ from: "bed2", to: "study" });
  passes(circulationOk(g, RULES), "a study off a bedroom is allowed");
  g.rooms.push({ id: "store", kind: "storeroom", storey: 1 });
  g.links.push({ from: "bed2", to: "store" });
  has(circulationOk(g, RULES), "room store (storeroom) is reached only through room bed2 (bedroom); wanted a way through no private room, or the pair [bedroom, storeroom] allowed", "store through a bedroom"); // prettier-ignore
  g = copy();
  g.links = g.links.filter((l) => l.to !== "kit");
  g.links.push({ from: "hall", to: "kit" });
  has(circulationOk(g, RULES), "room kit (kitchen) opens on none of living, wanted 1 or more (the kitchen opens on the living room)", "kitchen apart"); // prettier-ignore
  g = copy();
  g.entrances = ["bed1"];
  has(circulationOk(g, RULES), "room bed1 (bedroom) is an entrance of zone rank 2, wanted 1 or less", "a bedroom as the entrance"); // prettier-ignore
  g = copy();
  g.rooms.find((r) => r.id === "bed2").exterior = false;
  has(circulationOk(g, RULES), "room bed2 (bedroom) has no window, wanted 1 or more", "a windowless bedroom");
  g = copy();
  g.rooms.find((r) => r.id === "hall").length = 30;
  has(circulationOk(g, RULES), "room hall (corridor) runs 30 m, wanted 25 m or less", "a long corridor");
  g = copy();
  g.rooms.push({ id: "spur", kind: "corridor", storey: 1, length: 12 });
  g.links.push({ from: "land", to: "spur" });
  has(circulationOk(g, RULES), "room spur (corridor) is a dead end 12 m long, wanted 9.75 m or less", "a long dead end");
  g = copy();
  g.rooms = g.rooms.filter((r) => r.id !== "st");
  g.links = g.links.filter((l) => l.from !== "st" && l.to !== "st");
  g.links.push({ from: "hall", to: "land", type: "ladder" });
  has(circulationOk(g, RULES), "storeys 0 and 1 of h1 are joined by 0 stairs, wanted 1 or more", "no stair");
  g = copy();
  g.rooms.find((r) => r.id === "bed2").area = 700;
  has(circulationOk(g, RULES), "joined by 1 stair, wanted 2 or more (storey 1 has 746 m2, over 600 on one stair)", "a big storey on one stair"); // prettier-ignore
  // the MSR: cells off a guarded corridor, never off the lobby; homes never open into each other
  const msr = {
    id: "p", type: "msr", entrances: ["lob"],
    rooms: [{ id: "lob", kind: "lobby", storey: 0 }, { id: "desk", kind: "front-desk", storey: 0 }, { id: "gp", kind: "guard-post", storey: 0 }, { id: "c1", kind: "cell", storey: 0, exterior: false }, { id: "off", kind: "office", storey: 0, exterior: true }], // prettier-ignore
    links: [{ from: "lob", to: "desk" }, { from: "desk", to: "gp" }, { from: "gp", to: "c1" }, { from: "desk", to: "off" }],
  };
  passes(circulationOk(msr, RULES), "a precinct");
  const bad = JSON.parse(JSON.stringify(msr));
  bad.links.push({ from: "lob", to: "c1" });
  has(circulationOk(bad, RULES), "room c1 (cell) opens on a lobby, wanted 0 (never off the lobby)", "a cell off the lobby");
  const flats = {
    id: "a", type: "apartment", entrances: ["lob"],
    rooms: [{ id: "lob", kind: "lobby", storey: 0 }, { id: "st", kind: "stairwell", storey: 0 }, { id: "a1", kind: "bedsit", storey: 0, home: "a_1" }, { id: "a2", kind: "bedsit", storey: 0, home: "a_2" }], // prettier-ignore
    links: [{ from: "lob", to: "st" }, { from: "st", to: "a1" }, { from: "a1", to: "a2" }],
  };
  has(circulationOk(flats, RULES), "room a1 (bedsit) of home a_1 opens into room a2 (bedsit) of home a_2; wanted 0 links between homes", "a home through a home"); // prettier-ignore
  // a hut's one room is its entrance (programs.huts.entranceRank, when it is the home's only room)
  const hut = { id: "h", type: "huts", entrances: ["b"], rooms: [{ id: "b", kind: "bedsit", storey: 0, exterior: true }, { id: "t", kind: "toilet", storey: 0 }], links: [{ from: "b", to: "t" }] }; // prettier-ignore
  passes(circulationOk(hut, RULES), "a hut entered into its bedsit");
  const hut2 = JSON.parse(JSON.stringify(hut));
  hut2.rooms.push({ id: "b2", kind: "bedroom", storey: 0, exterior: true });
  hut2.links.push({ from: "b", to: "b2" });
  has(circulationOk(hut2, RULES), "room b (bedsit) is an entrance of zone rank 2, wanted 1 or less", "a hut of two rooms entered through a private one"); // prettier-ignore
  // nobody passes through a store (circulation.noPassThrough), but a hidden room may open off one
  const store = JSON.parse(JSON.stringify(msr));
  store.rooms.push({ id: "st", kind: "storeroom", storey: 0 }, { id: "rec", kind: "records", storey: 0 });
  store.links.push({ from: "off", to: "st" }, { from: "st", to: "rec" });
  has(circulationOk(store, RULES), "room rec (records) is reached only through room st (storeroom), a room nobody passes through", "records behind a store"); // prettier-ignore
  store.rooms.find((r) => r.id === "rec").hidden = true;
  passes(circulationOk(store, RULES), "a hidden room off a store");
  // a dungeon: drops one way, dead ends rewarded
  const dungeon = {
    id: "d", type: "dungeon", entrances: ["gate"], goal: "tomb",
    rooms: [{ id: "gate", kind: "room" }, { id: "pass", kind: "corridor", length: 10 }, { id: "hall", kind: "hall" }, { id: "vault", kind: "room", reward: { kind: "loot" } }, { id: "pit", kind: "cave" }, { id: "tomb", kind: "hall" }], // prettier-ignore
    links: [{ from: "gate", to: "pass" }, { from: "pass", to: "hall" }, { from: "hall", to: "vault" }, { from: "hall", to: "pit", type: "drop" }, { from: "pit", to: "tomb" }], // prettier-ignore
  };
  passes(circulationOk(dungeon, RULES), "a dungeon");
  const d2 = JSON.parse(JSON.stringify(dungeon));
  delete d2.rooms[3].reward;
  has(circulationOk(d2, RULES), "room vault (room) is a dead end holding nothing, wanted a reward, a key or the goal", "an empty dead end"); // prettier-ignore
  d2.links = d2.links.filter((l) => l.type !== "drop");
  d2.links.push({ from: "pit", to: "hall", type: "drop" });
  has(circulationOk(d2, RULES), "room pit (cave) is not reached from the entrance", "a drop the wrong way");
});

// ── the two specs against the rulebook (notes, not failures: those files are their descriptions') ──

const cityConflicts = () => {
  const d = JSON.parse(readFileSync(join(HERE, "../levels/specs/newbyzantium.json"), "utf8"));
  const cell = d.grid.cell;
  const types = typeTable(d);
  const sizes = { ...ROOM_SIZES, ...(d.roomSizes ?? {}) };
  const notes = [];
  let checked = 0;
  for (const b of d.buildings) {
    const program = programOf(b, types);
    const rooms = Object.entries(program).map(([kind, count]) => {
      const [w, dd] = sizes[kind] ?? [2, 3];
      return { kind, w: w * cell, d: dd * cell, count };
    });
    const units = unitsOf(b, types);
    const homeIsBuilding = b.type === "manor" || b.type === "house";
    const homes = homeIsBuilding
      ? []
      : Object.entries(units).map(([cls, count]) => {
          const u = UNIT_CLASSES[cls];
          return { name: cls, area: u.cells[0] * u.cells[1] * cell * cell, rooms: RULES.homes.byRooms[u.rooms] ?? [], count };
        }); // prettier-ignore
    const building = { id: b.id, type: b.type, units, footprint: b.footprint.map((x) => x * cell), storeys: b.storeys, homes };
    const r = roomProgramOk(building, rooms, RULES);
    checked++;
    notes.push(...r.failures);
  }
  // stairs between layers: the whole rise over the path length, landings included, no steeper than a flight
  const layerOf = new Map();
  for (const n of d.streets.nodes) layerOf.set(n.id, n.layer);
  const districtLayer = new Map(d.districts.map((x) => [x.id, x.layer]));
  for (const b of d.buildings) layerOf.set(b.id, districtLayer.get(b.district));
  const floor = new Map(d.layers.map((l) => [l.id, l.z[0]]));
  for (const c of d.connectors) {
    const zs = c.stops.map((s) => floor.get(layerOf.get(s))).filter((z) => z !== undefined);
    const rise = Math.max(...zs) - Math.min(...zs);
    if ((c.type === "stair" || c.type === "grand-stair") && c.length && rise / c.length > RULES.dimensions.stairs.maxPitch)
      notes.push(`connector ${c.id} (${c.type}): rises ${rise} cells over ${c.length}, grade ${Math.round((rise / c.length) * 100) / 100}, wanted ${RULES.dimensions.stairs.maxPitch} or less (a flight's pitch, landings included; length ${Math.ceil(rise / RULES.dimensions.stairs.maxPitch)} cells or more)`); // prettier-ignore
    if (c.type === "ramp" && c.length && rise / c.length > RULES.dimensions.ramps.vehicle.maxGrade)
      notes.push(`connector ${c.id} (ramp): grade ${rise / c.length}, wanted ${RULES.dimensions.ramps.vehicle.maxGrade} or less`); // prettier-ignore
    if (c.type === "ramp" && c.width && c.width * cell < RULES.dimensions.ramps.vehicle.width.min)
      notes.push(`connector ${c.id} (ramp): ${c.width * cell} m wide, wanted ${RULES.dimensions.ramps.vehicle.width.min} m or more`); // prettier-ignore
    checked++;
  }
  // street classes as corridors
  const classes = { alley: 2, catwalk: 1, service: 1.5, ...Object.fromEntries(Object.entries(d.streets.classes ?? {}).map(([k, v]) => [k, v.width])) }; // prettier-ignore
  for (const [k, kind] of [["alley", "alley"], ["catwalk", "catwalk"], ["service", "service"]])
    if (classes[k] * cell < RULES.dimensions.corridors[kind].width.min) notes.push(`street class ${k}: ${classes[k] * cell} m wide, wanted ${RULES.dimensions.corridors[kind].width.min} m or more`); // prettier-ignore
  // a storey's clear height under a slab against a hall's ceiling
  const clear = d.grid.storey * cell - RULES.dimensions.walls.exterior.thickness.min;
  if (clear < RULES.dimensions.ceilings.hall.min) notes.push(`grid.storey: ${clear} m clear under a slab, wanted ${RULES.dimensions.ceilings.hall.min} m for a one-storey hall`); // prettier-ignore
  return { notes, checked };
};

const dungeonConflicts = () => {
  const d = JSON.parse(readFileSync(join(HERE, "../levels/specs/rpg-dungeon-01.json"), "utf8"));
  const cell = d.grid.cell;
  const notes = [];
  const size = (s) => (s.cells ?? { ...DEFAULT_SIZES[s.type], ...(d.sizes?.[s.type] ?? {}) }[s.size]).map((x) => x * cell);
  const span = (s) => (Array.isArray(s.storey) ? s.storey[1] - s.storey[0] + 1 : 1);
  const spaces = d.spaces.map((s) => ({ s, wd: size(s) }));
  notes.push(...roomProgramOk({ id: d.name, type: "dungeon" }, spaces.map(({ s, wd }) => ({ id: s.id, kind: s.type, w: wd[0], d: wd[1] })), RULES).failures); // prettier-ignore
  for (const { s } of spaces) if (s.type !== "stair" && s.type !== "yard") notes.push(...ceilingFits({ id: s.id, kind: s.type, height: d.grid.storey * span(s) }, RULES).failures); // prettier-ignore
  for (const link of new Set(d.links.map((l) => l.type))) {
    const kind = RULES.spaceKinds.linkDoors[link];
    const [dw, dh] = link === "gate" && d.grid.gate ? d.grid.gate : d.grid.door; // a gate its own size when the grid gives one
    if (kind && kind !== "opening") notes.push(...doorFits({ id: `grid.${link === "gate" && d.grid.gate ? "gate" : "door"} as a ${link}`, kind, width: dw, height: dh }, RULES).failures); // prettier-ignore
  }
  for (const { s, wd } of spaces.filter(({ s }) => s.type === "stair")) {
    const risers = Math.round(d.grid.storey / d.grid.stairRise);
    notes.push(...stairFits({ id: s.id, kind: RULES.spaceKinds.stair.stair, rise: d.grid.stairRise, run: d.grid.stairRun, width: Math.min(...wd), risers }, RULES).failures); // prettier-ignore
  }
  if (d.grid.wall < RULES.dimensions.walls.interior.thickness.min) notes.push(`grid.wall: ${d.grid.wall} m, wanted ${RULES.dimensions.walls.interior.thickness.min} m or more`); // prettier-ignore
  const graph = {
    id: d.name, type: "dungeon", entrances: [d.route.start], goal: d.route.goal,
    rooms: spaces.map(({ s, wd }) => ({ id: s.id, kind: s.type, length: Math.max(...wd), reward: s.reward, key: s.key ?? s.keys })), // prettier-ignore
    links: d.links,
  };
  notes.push(...circulationOk(graph, RULES).failures);
  return { notes, spaces: spaces.length };
};

test("architecture rules: New Byzantium's buildings, connectors and street classes held to the rulebook (conflicts as notes)", () => {
  const { notes, checked } = cityConflicts();
  sure(checked > 40, `checked ${checked}`);
  sure(notes.every((n) => typeof n === "string" && /wanted/.test(n)), "each conflict a sentence with the number wanted");
  for (const n of notes) console.log(`      note: newbyzantium.json: ${n}`);
  sure(notes.length === 0, `New Byzantium meets the rulebook: ${notes.join(" | ")}`);
});

test("architecture rules: rpg-dungeon-01's spaces, doors, stairs and circulation held to the rulebook (conflicts as notes)", () => {
  const { notes, spaces } = dungeonConflicts();
  sure(spaces === 24, `spaces ${spaces}`);
  for (const n of notes) console.log(`      note: rpg-dungeon-01.json: ${n}`);
  sure(notes.length === 0, `rpg-dungeon-01 meets the rulebook: ${notes.join(" | ")}`);
  // the kit's old 1.0 x 1.95 m door is still caught
  const kitDoor = doorFits({ id: "grid.door as a door", kind: RULES.spaceKinds.linkDoors.door, width: 1.0, height: 1.95 }, RULES).failures.join(" | ");
  sure(kitDoor.includes("wanted 1.1 m or more"), kitDoor);
});
