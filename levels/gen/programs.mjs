// Stage 3 of the map generator: building programs (PLAN.md Phase 3, "The map generator").
//
// Reads the city description (its buildings, housing table, door naming, secrets, required places), stage 2's lots
// (or their stub, common.mjs) and the architecture rulebook, and writes `03-programs.json`: per enterable building
// its units (homes by class, a business, the MSR's or the insurgents' function), every room with its kind, storey,
// target and minimum area and narrow side, its needs (street, window, none), its adjacency, the circulation it
// asks for (stair kind, corridor class, lobby), a court where the footprint is far larger than the program, the
// named doors, and each decision with the rule that made it. Deterministic: a building's choices are drawn from a
// source seeded by its id.
//
// With stage 4's network (04-network.json) it ties the building to what stands at it: each MSR hallway or passage
// ending at the lot gets its door there (a gate room of the program on that wall, at that place, where the program
// has one: `gates`, `hallways`); each lift stopping at the building a lift lobby against its shaft's exit (`lifts`);
// each checkpoint room stage 4 stood inside the lot becomes a room of the building at its place (`fixed`); and the
// floor kept for connectors is the real wells' and shafts'. Without it (stage 2's lots alone) gates face their
// passage's far node and the connectors' floor is estimated from the description.
//
//   node levels/gen/programs.mjs [description.json] [--out dir] [--lots dir] [--seed s]
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadRules, roomProgramOk } from "../lib/architecture-rules.mjs";
import { typeTable, programOf, unitsOf, unitTable } from "../lib/city-description.mjs";
import { G, rngOf, round2, round3, round4, loadCity, lotsFor, sha256, canonical } from "./common.mjs";

export const PROGRAMS_FORMAT = "smak-gen-programs/1";

/** A room's typical area over its rulebook minimum (Neufert's comfortable over minimal, about 1.45). */
export const TYPICAL = 1.45;
/** How far a storey's rooms may grow past typical before more rooms (the type's fill list) or a court are added. */
export const GROW_MAX = 2.2;
/** A court is opened only when it would take this share of a storey or more; less, and the rooms grow. */
export const COURT_MIN_SHARE = 0.12;
/** The exterior wall (16 units) and interior partition (8 units), metres: the rulebook's typical, on the grid. */
export const WALL = { exterior: 2 * G, interior: G };

/** Storey policy by room kind: ground (the street storey), top, high (upper storeys), jail (one secure storey). */
const POLICY = {
  ground: ["lobby", "front-desk", "booking", "gate", "gatehouse", "shop-floor", "barroom", "hall", "courtroom", "great-hall", "garden", "garage", "loading-bay", "factory-floor", "stall", "cellar", "workshop", "war-room"], // prettier-ignore
  top: ["upper-hall", "lookout"],
  high: ["bedroom", "study", "dormitory", "bunkroom", "records", "briefing", "lockers", "infirmary", "ward"],
  jail: ["cell", "holding-cell", "interrogation", "evidence"],
};
const POLICY_BY_TYPE = {
  house: { ground: ["living", "kitchen"] },
  manor: { ground: ["living", "kitchen", "toilet"] },
  // a station's street storey holds its processing (booking), armoury, briefing, lockers and records behind the desk
  // (the rulebook's programs.msr adjacency keeps the armoury off the lobby and the desk), so it is not left to a few
  // public rooms grown past their use; its offices go to the emptiest storey, the street storey included
  msr: { ground: ["briefing", "armory", "records", "lockers"], any: ["office"] },
  shop: { high: ["office"] },
  "double-shop": { high: ["office"] },
  bar: { high: ["office", "kitchen"] },
  factory: { ground: ["office", "storeroom"], high: ["lockers", "catwalk"] },
  workshop: { ground: ["storeroom", "office", "backroom"] },
  insurgent: { high: ["armory"] },
  public: { ground: ["ward", "front-desk", "hall", "lobby"] },
};
/** Rooms a storey takes, in order, when its program leaves it far emptier than GROW_MAX (each kind once a storey). */
const FILL = {
  shop: ["storeroom", "office", "toilet"],
  "double-shop": ["storeroom", "office", "toilet"],
  bar: ["office", "storeroom", "kitchen", "toilet"],
  workshop: ["office", "toilet", "backroom", "storeroom"],
  factory: ["workshop", "lockers", "toilet", "storeroom"],
  public: ["records", "storeroom", "toilet"],
  msr: ["toilet", "storeroom"],
  insurgent: ["storeroom", "kitchen", "toilet", "infirmary"],
  manor: ["study", "living", "toilet", "storeroom"],
  house: ["toilet", "study", "storeroom"],
  apartment: [],
  huts: ["toilet"],
};
/** Halls tall enough to rise through the storey above when that storey would be left near empty. */
const DOUBLE_HEIGHT = ["factory-floor", "hall", "courtroom"];
/** The stair kind (rulebook dimensions.stairs.width) and corridor class (dimensions.corridors) by building type. */
const STAIR_KIND = { apartment: "public", msr: "public", public: "public", bar: "public", factory: "service", insurgent: "service" }; // others domestic
const CORRIDOR_CLASS = { apartment: "public", msr: "public", public: "public", factory: "service", insurgent: "service", bar: "public" }; // others domestic
/** Where a secret door's hidden room opens from, by preference: the first kind on its storey. */
const HOST = ["upper-hall", "backroom", "office", "study", "armory", "garage", "storeroom", "ward", "bedroom", "bedsit", "living", "kitchen", "cellar", "great-hall", "war-room", "workshop", "lobby", "barroom", "shop-floor", "hall"]; // prettier-ignore
/** A terrace (an unbuilt part of an upper storey, the roof of the one below) where a storey stays this far emptier. */
const TERRACE_AT = GROW_MAX * 1.3;

/** A fixed room cut under its cap keeps this share of the cap as its gross area (its walls take the rest of the margin). */
const FIXED_UNDER_CAP = 0.92;

/**
 * The part of a fixed room's place (cells) it keeps under `maxCells` (cells squared): cut parallel to the lot's edge
 * it stands against (its depth from that edge shortened, in quarter cells), else across its longer side from its
 * high end. Null when no cut leaves it a quarter cell deep or more.
 */
export function keptUnderCap(rect, lot, maxCells) {
  const E = 1e-3;
  const q = (v) => Math.floor(v * 4 + 1e-9) / 4;
  const on = { s: Math.abs(rect.y - lot.y) < E, n: Math.abs(rect.y + rect.d - lot.y - lot.d) < E, w: Math.abs(rect.x - lot.x) < E, e: Math.abs(rect.x + rect.w - lot.x - lot.w) < E }; // prettier-ignore
  const side = ["s", "n", "w", "e"].find((k) => on[k]) ?? (rect.w >= rect.d ? "w" : "s");
  if (side === "s" || side === "n") {
    const d = q(maxCells / rect.w);
    if (d < 0.25) return null;
    return { x: rect.x, y: side === "s" ? rect.y : round3(rect.y + rect.d - d), w: rect.w, d };
  }
  const w = q(maxCells / rect.d);
  if (w < 0.25) return null;
  return { x: side === "w" ? rect.x : round3(rect.x + rect.w - w), y: rect.y, w, d: rect.d };
}

/** Cells on one storey at most (the rulebook's programs.<type>.cellsPerStorey); none: no limit. */
export const cellsPerStorey = (rules, type) => rules.programs[type]?.cellsPerStorey ?? { max: Infinity, kinds: [] };
const typicalOf = (rules, kind) => round2((rules.roomKinds[kind]?.minArea ?? 15) * TYPICAL);

/** The stairwell's clear size for a stair kind: two flights side by side and a well, an entry landing, the run, a half landing (metres). */
export function stairwellSize(rules, kind, storeyHeight) {
  const S = rules.dimensions.stairs;
  const width = Math.ceil(S.width[kind].typical / 0.0254 / 8) * 8 * 0.0254; // on 8 units
  const rise = 8 * 0.0254; // the games' commonest riser, 8 units
  const risers = Math.round(storeyHeight / rise);
  const perFlight = Math.ceil(risers / 2);
  const run = 12 * 0.0254; // 12 units, 0.305 m
  const flightRun = (perFlight - 1) * run;
  const entry = Math.max(2.4, width, S.landing.minDepth);
  const half = Math.max(width, S.landing.minDepth);
  return {
    kind,
    width: round4(width),
    rise: round4(rise),
    run: round4(run),
    risers,
    perFlight,
    flightRun: round4(flightRun),
    entryLanding: round4(entry),
    halfLanding: round4(half),
    clear: [round4(2 * width + G), round4(entry + flightRun + half)],
  };
}

const roomNeeds = (rules, kind) => ({
  street: rules.roomNeeds.street.includes(kind),
  window: rules.roomNeeds.window.includes(kind),
  noWindow: rules.roomNeeds.noWindow.includes(kind),
  ...((rules.roomNeeds.anyOutsideWall ?? []).includes(kind) ? { anyOutsideWall: true } : {}),
});

/** The program's adjacency rules for one kind, merged (`next` any of, `notNext` none of). */
const adjacencyOf = (prog, kind, extra = []) => {
  const next = [];
  const notNext = [];
  const why = [];
  for (const a of [...(prog?.adjacency ?? []), ...extra])
    if (a.a === kind) {
      if (a.next) next.push(a.next);
      if (a.notNext) notNext.push(...a.notNext);
      why.push(a.why);
    }
  return { next, notNext: [...new Set(notNext)], why };
};
/** Home rules every home keeps whatever its building (the house program's: the kitchen on the living room). */
const HOME_RULES = (rules) => rules.programs.house.adjacency;

/** Builds one building's program. */
function programFor(b, lot, desc, rules, types, unitClasses, secrets, nodes, seed, net = null) {
  const rng = rngOf(`${seed}:${b.id}:program`);
  const decisions = [];
  const decide = (rule, what) => decisions.push({ rule, what });
  const prog = rules.programs[b.type];
  const cell = desc.grid.cell;
  const storeys = b.storeys;
  const storeyHeight = lot.storeyHeight_m ?? desc.grid.storey * cell;
  const W = lot.rect.w * cell;
  const D = lot.rect.d * cell;
  const inner = (W - 2 * WALL.exterior) * (D - 2 * WALL.exterior);
  const counts = programOf(b, types);
  const homes = unitsOf(b, types);
  const residential = Boolean(types[b.type]?.residential);
  const allowed = new Set([...Object.keys(prog.required ?? {}), ...(prog.optional ?? []), ...(prog.oneOf ?? []).flat()]);
  const homeOnly = b.type === "manor" || b.type === "house";
  const columns = b.type === "huts" || (b.type === "apartment" && Object.keys(homes).every((c) => c === "house"));
  const stairKind = STAIR_KIND[b.type] ?? "domestic";
  const corridorClass = CORRIDOR_CLASS[b.type] ?? "domestic";
  const stair = storeys > 1 ? stairwellSize(rules, columns ? "domestic" : stairKind, storeyHeight) : null;
  const stairArea = stair ? (stair.clear[0] + G) * (stair.clear[1] + G) : 0;
  // connectors stopping at the building: their well or shaft is kept out of the rooms (stage 4 places it, stage 5
  // keeps it clear); here its floor is estimated (a lift or ladder shaft 1 x 1 cell, a stair's well 2.5 x 1.5) on the
  // storeys it crosses: every storey of a building it passes through, the street storey of its top stop
  const reserved = [];
  const storeyCells = desc.grid.storey;
  const storeyOfZ = (z) => Math.max(0, Math.min(storeys - 1, Math.round((z - lot.zBase) / storeyCells)));
  const L = lot.rect;
  const overlapCells = (r) => Math.max(0, Math.min(r.x + r.w, L.x + L.w) - Math.max(r.x, L.x)) * Math.max(0, Math.min(r.y + r.d, L.y + L.d) - Math.max(r.y, L.y)); // prettier-ignore
  const boxOf = (poly) => {
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys) };
  };
  if (net) {
    // the wells and shafts stage 4 stood in the lot, on the storeys they cross
    for (const c of net.connectors ?? [])
      for (const p of c.pieces ?? []) {
        if (p.kind !== "well" && p.kind !== "shaft") continue;
        const a = overlapCells(boxOf(p.poly));
        if (a <= 0) continue;
        const on = [...Array(storeys).keys()].filter((s) => p.z[0] < lot.zBase + (s + 1) * storeyCells - 0.05 && p.z[1] > lot.zBase + s * storeyCells + 0.05); // prettier-ignore
        if (on.length) reserved.push({ connector: c.id, type: c.type, area_m2: round2(a * cell * cell), storeys: on });
      }
  } else
    for (const c of desc.connectors ?? []) {
      const k = (c.stops ?? []).indexOf(b.id);
      if (k < 0 || c.type === "secret") continue;
      const top = k === c.stops.length - 1;
      const cells = c.type === "lift" || c.type === "ladder-shaft" ? 1 : c.type === "grand-stair" ? 10 : 3.75;
      reserved.push({ connector: c.id, type: c.type, area_m2: round2(cells * cell * cell), storeys: top ? [0] : [...Array(storeys).keys()] });
    }
  const reservedOn = (s) => reserved.filter((r) => r.storeys.includes(s)).reduce((a, r) => a + r.area_m2, 0);
  for (const r of reserved) decide("connector", `${r.connector} (${r.type}) stops here: about ${r.area_m2} m2 kept out of the rooms on storey ${r.storeys.join(", ")}`); // prettier-ignore

  // the rulebook's required rooms the description leaves out
  for (const [k, n] of Object.entries(prog.required ?? {})) {
    const waived = (prog.waive ?? []).some((w) => w.kinds.includes(k) && w.when?.unitsOnly && Object.keys(homes).length && Object.keys(homes).every((c) => w.when.unitsOnly.includes(c))); // prettier-ignore
    if (waived) {
      if (counts[k]) delete counts[k];
      decide("rulebook waive", `${k} waived: ${prog.waive.find((w) => w.kinds.includes(k)).why}`);
      continue;
    }
    if (homeOnly && (k === "lobby" || k === "stairwell")) continue;
    if ((counts[k] ?? 0) < n) {
      decide("rulebook required", `${k} raised from ${counts[k] ?? 0} to ${n} (programs.${b.type}.required)`);
      counts[k] = n;
    }
  }
  if (stair) delete counts.stairwell; // the stairwell is laid on every storey below

  // units
  const units = [];
  const naming = desc.housing.doorNaming;
  const fill = (pattern, vars) => pattern.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
  let n = 0;
  for (const [cls, count] of Object.entries(homes))
    for (let i = 0; i < count; i++) {
      n++;
      units.push({ id: `${b.id}.u${n}`, kind: "home", class: cls, number: n, door: fill(naming.home, { building: b.id, unit: n, class: cls }), rooms: [] }); // prettier-ignore
    }
  const fn = residential ? null : { msr: "msr", public: "public", insurgent: "insurgent" }[b.type] ?? "business";
  if (fn) units.push({ id: `${b.id}.${fn}`, kind: fn, door: fill(naming.business, { building: b.id }), rooms: [] });
  if (homeOnly && units.length === 0) units.push({ id: `${b.id}.u1`, kind: "home", class: b.type, number: 1, door: fill(naming.home, { building: b.id, unit: 1 }), rooms: [] }); // prettier-ignore
  for (const u of units) u.entry = columns || homeOnly || (u.kind !== "home") ? "street" : "common";
  if (columns) for (const u of units) u.column = true;

  // rooms
  const rooms = [];
  const kindCount = {};
  const add = (kind, extra = {}) => {
    const unit = extra.unit ?? null;
    const key = `${unit ?? b.id}.${kind}`;
    kindCount[key] = (kindCount[key] ?? 0) + 1;
    const rk = rules.roomKinds[kind];
    const idBase = unit ? `${unit}.${kind}` : `${b.id}.${kind}`;
    const room = {
      id: kindCount[key] > 1 ? `${idBase}-${kindCount[key]}` : idBase,
      kind,
      unit,
      storey: extra.storey ?? null,
      target_m2: extra.target ?? typicalOf(rules, kind),
      minArea_m2: rk?.minArea ?? 0,
      ...(rk?.maxArea ? { maxArea_m2: rk.maxArea } : {}),
      minSide_m: rk?.minSide ?? 0,
      zone: rk?.zone ?? null,
      rank: rules.zones[rk?.zone]?.rank ?? 0,
      ceiling: rk?.ceiling ?? null,
      needs: roomNeeds(rules, kind),
      ...extra,
    };
    if (room.unit === null) delete room.unit;
    if (room.storey === null) room.storey = null;
    rooms.push(room);
    return room;
  };
  const bizUnit = units.find((u) => u.kind !== "home")?.id ?? null;
  const homeOfBuilding = homeOnly ? units[0].id : null;

  // the building's own program rooms (a home's own rooms for a manor or house)
  const homeKinds = (cls) => rules.homes.byRooms[String(unitClasses[cls]?.rooms ?? 1)] ?? ["bedsit"];
  if (homeOnly) {
    const want = {};
    for (const k of homeKinds(units[0].class)) want[k] = (want[k] ?? 0) + 1;
    for (const [k, c] of Object.entries(want))
      if ((counts[k] ?? 0) < c) {
        if (!allowed.has(k)) continue;
        decide("home class", `${k} raised to ${c} for a ${units[0].class} of ${unitClasses[units[0].class]?.rooms} rooms (homes.byRooms)`);
        counts[k] = c;
      }
  }
  const sharedKinds = new Set(["lobby", "stairwell", "corridor", "lift-lobby"]);
  for (const [k, c] of Object.entries(counts))
    for (let i = 0; i < c; i++) {
      const unit = homeOnly ? homeOfBuilding : residential && sharedKinds.has(k) ? null : (bizUnit ?? null);
      add(k, { unit });
    }

  // each home's rooms (flats and houses inside an apartment, huts, flats over a shop)
  if (!homeOnly)
    for (const u of units.filter((x) => x.kind === "home")) {
      const kinds = homeKinds(u.class);
      for (const k of kinds) add(k, { unit: u.id, target: typicalOf(rules, k) });
      if (u.column && storeys > 1) add("corridor", { unit: u.id, target: 9, hallOf: u.id });
      // a toilet when the home's class leaves room for one at its typical size (an en suite off a bedsit)
      const classArea = (unitClasses[u.class]?.cells ?? [1, 2]).reduce((a, x) => a * x, 1) * cell * cell;
      const need = kinds.reduce((s, k) => s + rules.roomKinds[k].minArea, 0) + rules.roomKinds.toilet.minArea;
      if (classArea >= need * 1.1 || u.column) add("toilet", { unit: u.id, target: 5.6 });
      else decide("home toilet", `${u.id} (${u.class}, ${round2(classArea)} m2) keeps one room: a toilet would leave it under ${round2(need * 1.1)} m2`);
    }
  // a common entrance hall for homes over a business (they never pass through the shop)
  if (bizUnit && units.some((u) => u.kind === "home")) {
    add("corridor", { unit: null, target: 12, storey: 0, entranceHall: true, needs: { street: true, window: false, noWindow: false } }); // prettier-ignore
    decide("homes over a business", "a common entrance hall with the stair on the street, so the homes never pass through the business");
  }

  // secret doors' hidden rooms
  for (const s of secrets.filter((x) => x.kind === "door" && x.in === b.id)) {
    const note = (s.note ?? "").toLowerCase();
    const where = /attic|top|upper|over|panic/.test(note) ? "top" : /cellar|under|basement/.test(note) ? "ground" : "any";
    add("storeroom", { unit: null, hidden: true, secret: s.id, target: 13, where, note: s.note });
  }

  // the MSR's hallways ending at the lot (stage 4): where each meets the building's wall, its side and place
  const hallways = net ? hallwayEnds(b, lot, { ...net, hallways: net.hallways }, nodes, storeyOfZ, desc.buildings) : [];
  for (const h of hallways) decide("hallway", `${h.hallway} (${h.kind}) meets the ${h.side} wall ${h.at} cells along it on storey ${h.storey}`); // prettier-ignore
  // gates to the MSR's hallways: each at its passage's end where stage 4 routed it, else on the side facing the
  // passage's far node
  const gates = rooms.filter((r) => r.kind === "gate");
  const passages = (b.passages ?? []).filter((p) => nodes.has(p.to));
  const byPassage = (p) => hallways.find((h) => h.kind === "passage" && h.to === p.to && !h.gate);
  gates.forEach((g, i) => {
    const p = passages[i % Math.max(1, passages.length)];
    if (!p) return;
    const h = byPassage(p);
    if (h) {
      h.gate = g.id;
      g.gate = { passage: p.to, hallway: h.hallway, side: h.side, at: h.at, width: h.width };
      g.storey = h.storey;
      decide("gate", `${g.id} on the ${h.side} wall at the end of hallway ${h.hallway}, ${h.at} cells along it (04-network)`);
    } else {
      const to = nodes.get(p.to).at;
      const dx = to[0] - b.at[0];
      const dy = to[1] - b.at[1];
      g.gate = { passage: p.to, side: Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "e" : "w") : dy >= 0 ? "n" : "s" };
    }
    g.needs = { ...g.needs, exterior: true };
  });
  // checkpoint rooms and service posts stage 4 stood inside the lot: the building's rooms, at their place
  const posts = (net?.posts ?? []).map((p) => ({ id: p.id, post: true, rooms: [{ kind: p.kind, rect: p.rect, z: p.z }] }));
  if (net)
    for (const k of [...(net.checkpoints ?? []), ...posts]) {
      let hc = 0;
      for (const cr of k.rooms ?? []) {
        if (cr.kind === "holding-cell") hc++;
        const a = overlapCells(cr.rect);
        if (a < 0.5 * cr.rect.w * cr.rect.d || cr.z[0] < lot.zBase - 0.05 || cr.z[0] >= lot.zBase + storeys * storeyCells - 0.05) continue; // prettier-ignore
        if (!rules.roomKinds[cr.kind]) continue;
        const x0 = Math.max(cr.rect.x, L.x);
        const y0 = Math.max(cr.rect.y, L.y);
        let rect = { x: round3(x0), y: round3(y0), w: round3(Math.min(cr.rect.x + cr.rect.w, L.x + L.w) - x0), d: round3(Math.min(cr.rect.y + cr.rect.d, L.y + L.d) - y0) }; // prettier-ignore
        let area = a * cell * cell;
        // a room stood larger than its kind's cap (roomKinds.<kind>.maxArea) keeps the part of its place against the
        // lot's edge, in quarter cells, under the cap; the rest of the place is the storey's floor for other rooms
        const cap = rules.roomKinds[cr.kind]?.maxArea;
        if (cap && area > cap) {
          const kept = keptUnderCap(rect, L, (cap * FIXED_UNDER_CAP) / (cell * cell));
          if (kept) {
            decide("fixed room under its cap", `${k.id}'s ${cr.kind}: ${round2(area)} m2 stood, past roomKinds.${cr.kind}.maxArea ${cap}; the room keeps ${kept.w} x ${kept.d} cells of its place against the lot's edge, the rest is the storey's`); // prettier-ignore
            rect = kept;
            area = kept.w * kept.d * cell * cell;
          }
        }
        const r = add(cr.kind, { unit: bizUnit, storey: storeyOfZ(cr.z[0]), target: round2(area), ...(k.post ? { post: k.id } : { checkpoint: k.id }), fixed: rect }); // prettier-ignore
        // a checkpoint's guard post opens toward its gate: the gate's middle, for the side its own door takes
        const gr = (k.rooms ?? []).find((x) => x.kind === "gate");
        if (!k.post && cr.kind === "guard-post" && gr) r.towards = [round3(gr.rect.x + gr.rect.w / 2), round3(gr.rect.y + gr.rect.d / 2)];
        if (cr.kind === "holding-cell") r.door = fill(naming.cell, { place: k.id, n: hc });
        decide(k.post ? "post room" : "checkpoint room", `${r.id}: ${k.id}'s ${cr.kind} stands in the lot at [${rect.x}, ${rect.y}] ${rect.w} x ${rect.d} cells, a room of the building on storey ${r.storey} (04-network)`); // prettier-ignore
      }
    }
  // lifts stopping at the building: a lift lobby against each shaft's exit (lifts beside each other on one side share one)
  const lifts = [];
  if (net)
    for (const c of net.connectors ?? []) {
      if (c.type !== "lift") continue;
      const shaft = (c.pieces ?? []).find((p) => p.kind === "shaft");
      if (!shaft || overlapCells(boxOf(shaft.poly)) <= 0) continue;
      for (const e of (c.exits ?? []).filter((x) => x.stop === b.id)) lifts.push({ connector: c.id, storey: storeyOfZ(e.z), side: e.side, rect: boxOf(shaft.poly) }); // prettier-ignore
    }
  const lobbies = rooms.filter((r) => r.kind === "lift-lobby");
  const groups = [];
  for (const l of lifts) {
    const g = groups.find((x) => x.storey === l.storey && x.side === l.side);
    if (g) g.connectors.push(l.connector);
    else groups.push({ storey: l.storey, side: l.side, connectors: [l.connector] });
  }
  groups.forEach((g, i) => {
    const lob = lobbies[i];
    if (!lob) return decide("lift", `${g.connectors.join(" and ")} stop(s) on storey ${g.storey} with no lift lobby left in the program`);
    lob.lift = { connectors: g.connectors, side: g.side };
    lob.storey = g.storey;
    decide("lift lobby", `${lob.id} on storey ${g.storey} against the ${g.side} side of ${g.connectors.join(" and ")}'s shaft (04-network)`); // prettier-ignore
  });

  // adjacency from the program (and every home's kitchen on its living room)
  for (const r of rooms) {
    const extra = r.unit && units.find((u) => u.id === r.unit)?.kind === "home" ? HOME_RULES(rules) : [];
    const a = adjacencyOf(prog, r.kind, extra);
    r.next = a.next;
    r.notNext = a.notNext;
    if (r.hidden) {
      r.next = [];
      r.notNext = [];
    }
  }

  // storeys
  const pol = (kind) => {
    const t = POLICY_BY_TYPE[b.type] ?? {};
    if ((t.any ?? []).includes(kind)) return "any";
    for (const p of ["ground", "top", "high", "jail"]) if ((t[p] ?? []).includes(kind)) return p;
    for (const p of ["ground", "top", "high", "jail"]) if (POLICY[p].includes(kind)) return p;
    return "any";
  };
  const unitRooms = (u) => rooms.filter((r) => r.unit === u.id);
  const area = (list) => list.reduce((s, r) => s + r.target_m2, 0);
  const capacity = Array.from({ length: storeys }, (_, s) => inner - stairArea - reservedOn(s));
  const load = Array(storeys).fill(0);
  const put = (r, s) => {
    r.storey = s;
    load[s] += r.target_m2;
  };
  // homes in an apartment or over a business: whole flats, spread over the storeys by remaining room
  const flats = units.filter((u) => u.kind === "home" && !u.column && !homeOnly);
  const flatStoreys = bizUnit ? [...Array(storeys).keys()].filter((s) => s > 0) : [...Array(storeys).keys()];
  if (bizUnit && storeys === 1 && flats.length) flatStoreys.push(0);
  for (const r of rooms) if (r.kind === "lobby" || r.entranceHall) put(r, 0);
  for (const r of rooms) if (r.storey !== null && !(r.kind === "lobby" || r.entranceHall) && (r.fixed || r.lift || r.gate?.hallway)) put(r, r.storey);
  for (const u of rng.shuffle(flats)) {
    const s = flatStoreys.reduce((best, x) => (capacity[x] - load[x] > capacity[best] - load[best] ? x : best), flatStoreys[0]);
    for (const r of unitRooms(u)) put(r, s);
    u.storey = s;
  }
  // a column home (terrace house, hut): its own storeys by policy, the capacity of its column
  for (const u of units.filter((x) => x.column)) {
    const ur = unitRooms(u);
    const colCap = inner / units.filter((x) => x.column).length;
    const cl = Array(storeys).fill(0);
    for (const r of ur) {
      let s;
      if (r.kind === "corridor") s = 0;
      else if (storeys === 1) s = 0;
      else if (["living", "kitchen"].includes(r.kind)) s = 0;
      else if (r.kind === "bedroom" || r.kind === "study") s = 1 + (cl.slice(1).indexOf(Math.min(...cl.slice(1))));
      else s = cl.indexOf(Math.min(...cl));
      r.storey = s;
      cl[s] += r.target_m2;
    }
    u.capacity_m2 = round2(colCap);
  }
  // the rest by policy
  const jailStorey = storeys >= 3 ? 1 : 0;
  const rest = rooms.filter((r) => r.storey === null && !r.hidden);
  const order = { ground: 0, top: 1, jail: 2, high: 3, any: 4 };
  rest.sort((a, b2) => order[pol(a.kind)] - order[pol(b2.kind)] || b2.target_m2 - a.target_m2);
  let gp = 0;
  const mixedBlock = Boolean(bizUnit) && units.some((u) => u.kind === "home");
  for (const r of rest) {
    const p = pol(r.kind);
    if (storeys === 1 || (mixedBlock && r.unit === bizUnit)) put(r, 0);
    else if (p === "ground") put(r, 0);
    else if (p === "top") put(r, storeys - 1);
    else if (p === "jail") {
      // a cell block a storey: at most the rulebook's cellsPerStorey, the rest on the storey above
      const cps = cellsPerStorey(rules, b.type);
      let s = jailStorey;
      while (cps.kinds.includes(r.kind) && s + 1 < storeys && rooms.filter((x) => x.kind === r.kind && x.storey === s).length >= cps.max) s++;
      if (s !== jailStorey) decide("cell block", `${r.id} on storey ${s}: storey ${jailStorey} holds ${cps.max} cells already (programs.${b.type}.cellsPerStorey)`); // prettier-ignore
      put(r, s);
    }
    else if (r.kind === "guard-post" && b.type === "msr") put(r, gp++ === 0 && rooms.some((x) => POLICY.jail.includes(x.kind)) ? jailStorey : 0); // prettier-ignore
    else if (r.kind === "lift-lobby") put(r, Math.min(storeys - 1, rooms.filter((x) => x.kind === "lift-lobby" && x.storey !== null).length));
    else {
      const from = p === "high" ? 1 : 0;
      let best = from;
      for (let s = from; s < storeys; s++) if (capacity[s] - load[s] > capacity[best] - load[best]) best = s;
      put(r, best);
    }
  }
  // adjacency fix-up: a room whose `next` kinds are on no room of its storey, and no corridor can reach them, moves
  const corridorOk = allowed.has("corridor");
  for (let pass = 0; pass < 3; pass++)
    for (const r of rooms) {
      if (r.hidden || !r.next.length || r.unit && units.find((u) => u.id === r.unit)?.column) continue;
      for (const group of r.next) {
        const here = rooms.some((x) => x !== r && x.storey === r.storey && group.includes(x.kind) && (x.unit ?? null) === (r.unit ?? null));
        const viaCorridor = corridorOk && group.includes("corridor");
        const viaStair = group.includes("stairwell") && stair;
        if (here || viaCorridor || viaStair) continue;
        const partner = rooms.find((x) => x !== r && group.includes(x.kind) && (x.unit ?? null) === (r.unit ?? null) && x.storey !== null);
        if (partner && pol(r.kind) === "ground" && pol(partner.kind) !== "ground" && r.storey === 0) {
          decide("adjacency", `${partner.id} moved from storey ${partner.storey} to 0 beside ${r.id} (${r.kind} next to ${group.join(" or ")}, kept on the street storey)`); // prettier-ignore
          load[partner.storey] -= partner.target_m2;
          put(partner, 0);
        } else if (partner) {
          decide("adjacency", `${r.id} moved from storey ${r.storey} to ${partner.storey} beside ${partner.id} (${r.kind} next to ${group.join(" or ")})`);
          load[r.storey] -= r.target_m2;
          put(r, partner.storey);
        }
      }
    }
  // hidden rooms: their storey by the note, their host the first kind of HOST on it
  for (const r of rooms.filter((x) => x.hidden)) {
    const flatsBlock = residential && !homeOnly && !columns;
    const s = r.where === "top" ? storeys - 1 : r.where === "ground" || flatsBlock ? 0 : storeys - 1;
    // the host's unit: a hidden room off a flat's living room belongs to that flat
    let host = null;
    let hs = s;
    for (const ss of [s, ...[...Array(storeys).keys()].filter((x) => x !== s)]) {
      const onIt = rooms.filter((x) => x.storey === ss && !x.hidden && !(x.kind === "corridor" && x.hallOf));
      // a hidden room opens from a room of rank 1 or less (never only through a private room); a hut's bedsit is its only room
      const open = (k) => (rules.zones[rules.roomKinds[k]?.zone]?.rank ?? 0) < rules.zones.privateFrom || b.type === "huts";
      host = (flatsBlock && r.where !== "top" ? ["lobby", ...HOST] : HOST).find((k) => open(k) && onIt.some((x) => x.kind === k)) ?? null;
      if (host) {
        hs = ss;
        break;
      }
    }
    const hostRoom = rooms.find((x) => x.storey === hs && x.kind === host && !x.hidden);
    r.storey = hs;
    r.host = host ? [host] : [];
    r.unit = hostRoom?.unit;
    if (!r.unit) delete r.unit;
    r.next = host ? [[host]] : [];
    load[hs] += r.target_m2;
    decide("secret door", `${r.secret}'s hidden room on storey ${hs}, opening from the ${host ?? "?"} ("${r.note}")`);
  }

  // storeys far emptier than GROW_MAX take the type's fill rooms; a building far larger still opens a court
  const usableOf = (s) => inner - stairArea - reservedOn(s);
  const listFill = (FILL[b.type] ?? []).filter((k) => allowed.has(k));
  const circ = (s) => {
    const nRooms = rooms.filter((r) => r.storey === s).length;
    return nRooms > 4 ? 0.1 * usableOf(s) : 0;
  };
  const doubles = [];
  if (!columns)
    for (let s = 0; s < storeys; s++) {
      const loadOf = () => area(rooms.filter((r) => r.storey === s)) + doubles.filter((d) => d.storey < s).reduce((a, d) => a + d.target_m2 * GROW_MAX * 0.8, 0); // prettier-ignore
      // a hall rises through the storey above when that storey would stay near empty
      if (s > 0) {
        const below = rooms.find((r) => r.storey === s - 1 && DOUBLE_HEIGHT.includes(r.kind) && !r.doubleHeight);
        if (below && (usableOf(s) - circ(s)) / Math.max(1, loadOf()) > GROW_MAX * 1.5) {
          below.doubleHeight = true;
          doubles.push(below);
          decide("double height", `${below.id} rises through storey ${s} (a ${below.kind}, the storey above near empty)`);
        }
      }
      const host = s === 0 ? null : rooms.find((r) => r.storey === s && !r.hidden)?.unit ?? bizUnit ?? homeOfBuilding;
      for (const k of listFill) {
        const f = (usableOf(s) - circ(s)) / Math.max(1, loadOf());
        if (f <= GROW_MAX) break;
        if (rooms.some((r) => r.storey === s && r.kind === k && !r.hidden)) continue;
        if (rooms.filter((r) => r.storey === s).length >= 10) break; // a storey of many rooms grows them instead
        const unit = homeOnly ? homeOfBuilding : (bizUnit ?? (s === 0 ? null : host));
        if (residential && !homeOnly) break; // an apartment block's storeys grow their flats or open a court
        if (mixedBlock && s > 0) break; // flats over a business grow; the business keeps the street storey
        add(k, { unit, storey: s, fill: true });
        rooms[rooms.length - 1].next = adjacencyOf(prog, k).next;
        rooms[rooms.length - 1].notNext = adjacencyOf(prog, k).notNext;
        decide("fill", `${k} added on storey ${s}: its rooms would grow ${round2(f)} times their typical size, over ${GROW_MAX}`);
      }
    }
  // the court: a light well through every storey, as large as the emptiest storey leaves
  let court = null;
  if (!columns) {
    const spare = [];
    for (let s = 0; s < storeys; s++) {
      const l = area(rooms.filter((r) => r.storey === s)) + doubles.filter((d) => d.storey < s).reduce((a, d) => a + d.target_m2 * GROW_MAX * 0.8, 0); // prettier-ignore
      spare.push(usableOf(s) - circ(s) - l * GROW_MAX);
    }
    const a = Math.min(...spare);
    if (a >= COURT_MIN_SHARE * inner) {
      court = { area_m2: round2(a * 0.9), open: true };
      decide("court", `a court of ${round2(a * 0.9)} m2 through every storey: the emptiest storey's rooms would grow past ${GROW_MAX} times typical`);
    }
  }
  // upper storeys left far emptier than the rest: part of them stays unbuilt, a terrace on the roof below
  const voids = [];
  if (!columns)
    for (let s = 1; s < storeys; s++) {
      const l = area(rooms.filter((r) => r.storey === s)) + doubles.filter((d) => d.storey < s).reduce((a, d) => a + d.target_m2 * GROW_MAX * 0.8, 0); // prettier-ignore
      const free = usableOf(s) - circ(s) - (court?.area_m2 ?? 0);
      if (free / Math.max(1, l) <= TERRACE_AT) continue;
      const a = free - l * GROW_MAX;
      if (a < COURT_MIN_SHARE * inner) continue;
      voids.push({ storey: s, kind: "terrace", area_m2: round2(a) });
      decide("terrace", `storey ${s} leaves ${round2(a)} m2 unbuilt as a terrace: its rooms would grow ${round2(free / Math.max(1, l))} times typical`);
    }
  if (b.type === "huts") {
    decide("huts", "huts stand apart along the frontage, yards between them");
  }

  // two stairs where a storey's rooms pass the rulebook's area on one stair (circulation.stairs.maxAreaOnOneStair)
  let stairs = stair ? 1 : 0;
  if (stair && !columns) {
    // each upper storey past the area on one stair: a loggia where its rooms keep their size, else a second stair;
    // and a second stair for them all when the loggias would leave more than the rule's share of the floor unbuilt
    const limit = rules.circulation.stairs.maxAreaOnOneStair;
    const lg = rules.circulation.stairs.loggia;
    const cuts = [];
    let second = null;
    for (let s = 1; s < storeys; s++) {
      // halls rising from below are left in: the storey's rooms may still take their room when the hall is laid smaller
      const built = usableOf(s) - (court?.area_m2 ?? 0) - voids.filter((v) => v.storey === s).reduce((a, v) => a + v.area_m2, 0);
      if (built <= limit) continue;
      const load = area(rooms.filter((r) => r.storey === s));
      if (lg && built - lg.keepUnder * limit <= built - load * lg.roomsAtLeast) cuts.push({ s, built, cut: round2(built - lg.keepUnder * limit) }); // prettier-ignore
      else second ??= { s, built };
    }
    const unbuilt = (court?.area_m2 ?? 0) * storeys + voids.reduce((a, v) => a + v.area_m2, 0) + cuts.reduce((a, c) => a + c.cut, 0);
    if (!second && cuts.length && lg?.maxUnbuiltShare !== undefined && unbuilt > lg.maxUnbuiltShare * inner * storeys) {
      second = cuts[0];
      decide("second stair", `loggias of ${round2(cuts.reduce((a, c) => a + c.cut, 0))} m2 would leave ${round2(unbuilt)} m2 of ${round2(inner * storeys)} unbuilt, past ${lg.maxUnbuiltShare} (circulation.stairs.loggia.maxUnbuiltShare)`); // prettier-ignore
    }
    if (second) {
      stairs = 2;
      decide("second stair", `storey ${second.s} keeps up to ${round2(second.built)} m2 of floor, past ${limit} on one stair: two stairs`); // prettier-ignore
    } else
      for (const c of cuts) {
        const v = voids.find((x) => x.storey === c.s);
        if (v) v.area_m2 = round2(v.area_m2 + c.cut);
        else voids.push({ storey: c.s, kind: "terrace", area_m2: c.cut });
        decide("loggia", `storey ${c.s} leaves ${c.cut} m2 unbuilt (a loggia) to stay on one stair: ${round2(c.built)} m2 of floor against ${limit} (circulation.stairs.loggia)`); // prettier-ignore
      }
  }
  for (const u of units) u.rooms = rooms.filter((r) => r.unit === u.id).map((r) => r.id);
  const doors = [];
  for (const u of units) doors.push({ name: u.door, kind: u.kind === "home" ? "home" : "business", unit: u.id });
  let cellN = 0;
  for (const r of rooms.filter((x) => x.kind === "cell")) {
    r.door = fill(naming.cell, { place: b.id, n: ++cellN });
    doors.push({ name: r.door, kind: "cell", room: r.id });
  }
  for (const r of rooms.filter((x) => x.kind === "holding-cell")) {
    if (!r.checkpoint) r.door = fill(naming.cell, { place: b.id, n: ++cellN }); // a checkpoint's cells keep its name
    doors.push({ name: r.door, kind: "cell", room: r.id });
  }
  for (const r of rooms.filter((x) => x.hidden)) {
    r.door = r.secret;
    doors.push({ name: r.secret, kind: "secret", room: r.id });
  }

  const storeyInfo = Array.from({ length: storeys }, (_, s) => ({
    storey: s,
    usable_m2: round2(usableOf(s)),
    target_m2: round2(area(rooms.filter((r) => r.storey === s))),
    min_m2: round2(rooms.filter((r) => r.storey === s).reduce((a, r) => a + r.minArea_m2, 0)),
  }));
  for (const r of rooms) delete r.where;
  return {
    id: b.id,
    type: b.type,
    variant: b.variant,
    sign: b.sign ?? null,
    name: b.name ?? null,
    owner: b.owner,
    district: b.district,
    layer: lot.layer,
    lot: { id: lot.id, rect: lot.rect, frontage: lot.frontage, zBase: lot.zBase, storeyHeight_m: round3(storeyHeight), tile: lot.tile, party: lot.party ?? [], partyFrom: lot.partyFrom ?? "stub" }, // prettier-ignore
    storeys,
    footprint_m: [round3(W), round3(D)],
    inner_m2: round2(inner),
    layout: columns ? "columns" : "stack",
    stair: stair ? { ...stair, perUnit: columns, count: stairs } : null,
    corridor: { allowed: corridorOk, class: corridorClass, width_m: rules.dimensions.corridors[corridorClass].width.min },
    entrance: prog.entrance ?? [],
    court,
    voids,
    reserved,
    units,
    rooms,
    storeyInfo,
    doors,
    passages: b.passages ?? [],
    hallways: hallways.map(({ gate, ...h }) => ({ ...h, gate: gate ?? null })),
    decisions,
  };
}

/**
 * A lot's party walls: the stretches of its sides shared with a neighbouring lot of its layer (stage 2's lots, facades
 * and enterable ones alike), `[{ side, a, b (cells along that side from its west or south end), lot }]`; no window
 * opens on them. `partyFrom`: "02-lots" when the lots are stage 2's, "stub" when only the enterable lots are known.
 */
export function partyOf(lot, lotsDoc) {
  const E = 1e-6;
  const L = lot.rect;
  const party = [];
  for (const m of lotsDoc.lots ?? []) {
    if (m === lot || m.id === lot.id || (m.layer && lot.layer && m.layer !== lot.layer)) continue;
    const M = m.rect;
    const spanX = [Math.max(L.x, M.x), Math.min(L.x + L.w, M.x + M.w)];
    const spanY = [Math.max(L.y, M.y), Math.min(L.y + L.d, M.y + M.d)];
    const push = (side, [a, b], o) => b - a > E && party.push({ side, a: round3(a - o), b: round3(b - o), lot: m.id });
    if (Math.abs(M.x + M.w - L.x) < E) push("w", spanY, L.y);
    if (Math.abs(L.x + L.w - M.x) < E) push("e", spanY, L.y);
    if (Math.abs(M.y + M.d - L.y) < E) push("s", spanX, L.x);
    if (Math.abs(L.y + L.d - M.y) < E) push("n", spanX, L.x);
  }
  return { party, partyFrom: (lotsDoc.format ?? "").endsWith("stub") ? "stub" : "02-lots" };
}

/**
 * The MSR's hallways (passages and service hallways of stage 4) with an end at the lot, on the building's layer:
 * `[{ hallway, kind, to, side, at (cells along that side of the lot from its west or south end), width (cells),
 * storey }]`. The side is the lot edge the hallway crosses leaving its end (toward its next corner, or its far
 * node when it is one point); two ends at one place are one door.
 */
export function hallwayEnds(b, lot, net, nodes, storeyOfZ, buildings = []) {
  const posOf = (id) => nodes.get(id)?.at ?? buildings.find((x) => x.id === id)?.at;
  const L = lot.rect;
  const inLot = (p, m) => p[0] >= L.x - m && p[0] <= L.x + L.w + m && p[1] >= L.y - m && p[1] <= L.y + L.d + m;
  const top = lot.zBase + (lot.storeys ?? 1) * 1.5;
  const out = [];
  for (const h of net.hallways ?? []) {
    if (h.unrouted || !h.path?.length) continue;
    const z0 = h.z?.[0] ?? lot.zBase;
    if (z0 < lot.zBase - 0.05 || z0 >= top - 0.05) continue; // another layer's
    // a passage of the building's own ends at its wall; any other hallway only where its end stands inside the lot
    const ends = [];
    const last = h.path[h.path.length - 1];
    const own = h.from === b.id || h.to === b.id;
    if (h.path.length === 1) {
      // one point: the hallway's end at the wall, toward whichever of its ends is not this building
      const outside = (id) => { const q = posOf(id); return q && !inLot(q, 0); }; // prettier-ignore
      const far = h.from === b.id ? h.to : h.to === b.id ? h.from : outside(h.to) ? h.to : h.from;
      if (inLot(last, own ? 0.8 : 0)) ends.push({ p: last, next: posOf(far), far });
    } else {
      if (inLot(h.path[0], h.from === b.id ? 0.8 : 0)) ends.push({ p: h.path[0], next: h.path[1], far: h.to });
      if (inLot(last, h.to === b.id ? 0.8 : 0)) ends.push({ p: last, next: h.path[h.path.length - 2], far: h.from });
    }
    for (const e of ends) {
      const [px, py] = e.p;
      const next = e.next ?? [L.x + L.w / 2, L.y + L.d / 2];
      // the edge crossed going from the end toward the next corner; an end outside the lot takes the nearest edge
      const inside = px > L.x && px < L.x + L.w && py > L.y && py < L.y + L.d;
      const dx = next[0] - px;
      const dy = next[1] - py;
      let side;
      if (inside && (dx || dy)) {
        const t = (v, d, lo, hi) => (d > 0 ? (hi - v) / d : d < 0 ? (lo - v) / d : Infinity);
        const tx = t(px, dx, L.x, L.x + L.w);
        const ty = t(py, dy, L.y, L.y + L.d);
        // a tie (a corner): the axis on which the next point stands outside the lot, else north or south
        const outX = next[0] < L.x || next[0] > L.x + L.w;
        const outY = next[1] < L.y || next[1] > L.y + L.d;
        const alongX = Math.abs(tx - ty) < 1e-6 ? outX && !outY : tx < ty;
        side = alongX ? (dx > 0 ? "e" : "w") : dy > 0 ? "n" : "s";
      } else {
        const dist = { w: Math.abs(px - L.x), e: Math.abs(L.x + L.w - px), s: Math.abs(py - L.y), n: Math.abs(L.y + L.d - py) };
        side = Object.keys(dist).sort((a, c) => dist[a] - dist[c])[0];
      }
      const along = side === "n" || side === "s" ? px - L.x : py - L.y;
      const len = side === "n" || side === "s" ? L.w : L.d;
      const at = round3(Math.max(0, Math.min(len, along)));
      const storey = storeyOfZ(h.z?.[0] ?? lot.zBase);
      const end = { hallway: h.id, kind: h.kind, to: h.kind === "passage" ? (h.from === b.id ? h.to : h.from) : e.far, side, at, width: h.width ?? 1.5, storey }; // prettier-ignore
      // two ends at one place are one door, named by the building's own passage when one of them is
      const same = out.findIndex((o) => o.side === side && o.storey === storey && Math.abs(o.at - at) < 1);
      if (same < 0) out.push(end);
      else if (end.kind === "passage" && out[same].kind !== "passage") out[same] = end;
    }
  }
  return out;
}

/** Stage 3: the programs of every enterable building. */
export function programsOf(desc, lotsDoc, rules = loadRules(), { seed = "smak", network = null } = {}) {
  const types = typeTable(desc);
  const unitClasses = unitTable(desc);
  const nodes = new Map(desc.streets.nodes.map((n) => [n.id, n]));
  const lots = new Map(lotsDoc.lots.filter((l) => l.building && (l.kind ?? "enterable") === "enterable").map((l) => [l.building, { ...l, ...partyOf(l, lotsDoc) }])); // prettier-ignore
  const buildings = [];
  // a tile's lots name only its buildings: the programs are of those (the city's when every building has a lot)
  const scope = desc.buildings.filter((b) => b.interior).every((b) => lots.has(b.id)) ? "city" : "tile";
  for (const b of desc.buildings) {
    if (!b.interior) continue;
    const lot = lots.get(b.id);
    if (!lot) continue;
    buildings.push(programFor(b, lot, desc, rules, types, unitClasses, desc.secrets ?? [], nodes, seed, network));
  }
  return {
    format: PROGRAMS_FORMAT,
    description: desc.name,
    inputs: { description: sha256(canonical(desc)), lots: sha256(canonical(lotsDoc.lots)), rules: `${rules.format} v${rules.version}` },
    seed,
    scope,
    buildings,
  };
}

// ── the gate ──

/** Stage 3's gate: every failure a sentence naming the building, room or door and the number it wanted. */
export function checkPrograms(doc, desc, rules = loadRules()) {
  const failures = [];
  const unitClasses = unitTable(desc);
  const fail = (s) => failures.push(s);
  // homes per layer and class
  const supply = {};
  for (const b of doc.buildings)
    for (const u of b.units.filter((x) => x.kind === "home")) {
      supply[b.layer] ??= {};
      supply[b.layer][u.class] = (supply[b.layer][u.class] ?? 0) + 1;
    }
  const cityWide = doc.scope !== "tile"; // a tile holds part of the homes: the table is held city-wide only
  for (const [layer, table] of Object.entries(cityWide ? desc.housing.target ?? {} : {}))
    for (const [cls, want] of Object.entries(table)) {
      const got = supply[layer]?.[cls] ?? 0;
      if (got < want) fail(`homes: layer ${layer} has ${got} ${cls} homes, wanted ${want} or more (housing.target)`);
    }
  // variety of variants and signs
  const seenV = new Map();
  const seenS = new Map();
  for (const b of doc.buildings) {
    if (b.variant) seenV.set(b.variant, [...(seenV.get(b.variant) ?? []), b.id]);
    if (b.sign) seenS.set(b.sign, [...(seenS.get(b.sign) ?? []), b.id]);
  }
  for (const [v, ids] of seenV) if (ids.length > 1) fail(`variety: variant ${v} is used by ${ids.length} buildings (${ids.join(", ")}), wanted 1`);
  for (const [v, ids] of seenS) if (ids.length > 1) fail(`variety: sign ${v} is used by ${ids.length} buildings (${ids.join(", ")}), wanted 1`);
  const fillShare = desc.rules?.housing?.fill ?? 0.75;
  const allNames = new Map();
  for (const b of doc.buildings) {
    const name = `building ${b.id} (${b.type})`;
    // the rulebook's program: required kinds, oneOf, nothing outside it (a business with flats over it lists their
    // rooms, programs.<type>.homesOver; the homes are held to their class below too)
    const kinds = b.rooms.filter((r) => !r.hidden && r.kind !== "corridor").map((r) => ({ id: r.id, kind: r.kind, area: r.target_m2 })); // prettier-ignore
    if (b.stair) kinds.push({ id: `${b.id}.stairwell`, kind: "stairwell" });
    const unitsByClass = {};
    for (const u of b.units.filter((x) => x.kind === "home")) unitsByClass[u.class] = (unitsByClass[u.class] ?? 0) + 1;
    const check = roomProgramOk({ id: b.id, type: b.type, units: unitsByClass }, kinds, rules);
    for (const f of check.failures) fail(f);
    // targets at least the minima
    for (const r of b.rooms) {
      if (!rules.roomKinds[r.kind]) fail(`room ${r.id} of ${name}: no room kind "${r.kind}" in the rulebook`);
      else if (r.maxArea_m2 && r.target_m2 > r.maxArea_m2 + 1e-9) fail(`room ${r.id} (${r.kind}) of ${name}: target ${r.target_m2} m2, wanted ${r.maxArea_m2} or less (roomKinds.${r.kind}.maxArea)`); // prettier-ignore
      else if (r.target_m2 < r.minArea_m2 - 1e-9) fail(`room ${r.id} (${r.kind}) of ${name}: target ${r.target_m2} m2, wanted ${r.minArea_m2} or more (roomKinds.${r.kind}.minArea)`); // prettier-ignore
      if (r.storey === null || r.storey < 0 || r.storey >= b.storeys) fail(`room ${r.id} (${r.kind}) of ${name}: storey ${r.storey}, wanted 0 to ${b.storeys - 1}`);
    }
    // every storey's rooms at their minima fit inside it
    for (const s of b.storeyInfo) {
      const minimum = b.rooms.filter((r) => r.storey === s.storey).reduce((a, r) => a + r.minArea_m2, 0);
      const room = b.layout === "columns" ? b.inner_m2 : s.usable_m2;
      if (minimum > room + 1e-9) fail(`${name}: storey ${s.storey}'s rooms take ${round2(minimum)} m2 at their minima, wanted ${round2(room)} or less (its floor less the stair)`); // prettier-ignore
    }
    // homes fit at the housing fill
    const homeCells = b.units.filter((u) => u.kind === "home").reduce((a, u) => a + (unitClasses[u.class]?.cells ?? [0, 0]).reduce((x, y) => x * y, 1), 0); // prettier-ignore
    const cellsHeld = b.lot.rect.w * b.lot.rect.d * b.storeys * fillShare;
    if (homeCells > cellsHeld + 1e-9) fail(`${name}: its homes take ${homeCells} cells, its ${b.lot.rect.w}x${b.lot.rect.d} x ${b.storeys} storeys hold ${round2(cellsHeld)} at ${fillShare} fill`); // prettier-ignore
    // every home holds its class's rooms
    for (const u of b.units.filter((x) => x.kind === "home")) {
      const want = rules.homes.byRooms[String(unitClasses[u.class]?.rooms ?? 1)] ?? [];
      const have = b.rooms.filter((r) => r.unit === u.id).map((r) => r.kind);
      for (const k of new Set(want)) {
        const w = want.filter((x) => x === k).length;
        const h = have.filter((x) => x === k).length;
        if (h < w) fail(`home ${u.id} (${u.class}) of ${name}: ${h} ${k}, wanted ${w} (homes.byRooms[${unitClasses[u.class]?.rooms}])`);
      }
      if (!have.length) fail(`home ${u.id} of ${name}: no rooms, wanted ${want.length}`);
    }
    // the description's required places
    for (const q of (desc.required ?? []).filter((x) => x.building === b.id)) {
      for (const [k, w] of Object.entries(q.program ?? {})) {
        const h = b.rooms.filter((r) => r.kind === k && !r.hidden).length;
        if (h < w) fail(`required ${q.id}: ${b.id} has ${h} ${k}, wanted ${w} or more`);
      }
    }
    // a secret door's room
    for (const s of (desc.secrets ?? []).filter((x) => x.kind === "door" && x.in === b.id))
      if (!b.rooms.some((r) => r.secret === s.id)) fail(`secret ${s.id}: no hidden room in ${b.id}, wanted 1`);
    // door names
    for (const d of b.doors) allNames.set(d.name, [...(allNames.get(d.name) ?? []), b.id]);
  }
  for (const req of (desc.required ?? []).filter((x) => x.type && x.units && cityWide)) {
    const list = doc.buildings.filter((b) => b.type === req.type && (!req.district || b.district === req.district));
    if (list.length < (req.min ?? 1)) fail(`required ${req.id}: ${list.length} ${req.type} buildings in ${req.district ?? "the city"}, wanted ${req.min ?? 1} or more`);
    for (const [cls, w] of Object.entries(req.units)) {
      const h = list.reduce((a, b) => a + b.units.filter((u) => u.class === cls).length, 0);
      if (h < w) fail(`required ${req.id}: ${h} ${cls} homes, wanted ${w} or more`);
    }
  }
  const maxLen = desc.rules?.doors?.maxNameLength ?? 31;
  for (const [n, ids] of allNames) {
    if (ids.length > 1) fail(`doors: the name ${n} is given ${ids.length} times (${ids.join(", ")}), wanted once`);
    if (n.length > maxLen) fail(`doors: the name ${n} is ${n.length} characters, wanted ${maxLen} or fewer`);
  }
  return { ok: failures.length === 0, failures };
}

// ── command line ──

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("levels/gen/programs.mjs");
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const file = args.find((a) => a.endsWith(".json"));
  const desc = loadCity(file);
  const out = opt("--out", null);
  const lots = lotsFor(desc, opt("--lots", out));
  const rules = loadRules();
  const doc = programsOf(desc, lots, rules, { seed: opt("--seed", "smak") });
  const gate = checkPrograms(doc, desc, rules);
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "03-programs.json"), JSON.stringify(doc, null, 1) + "\n");
  }
  console.log(`stage 3: ${doc.buildings.length} buildings, ${doc.buildings.reduce((a, b) => a + b.rooms.length, 0)} rooms, ${doc.buildings.reduce((a, b) => a + b.units.length, 0)} units${lots.format?.endsWith("stub") ? " (lots stubbed from the description)" : ""}`); // prettier-ignore
  for (const f of gate.failures) console.log(`FAIL  ${f}`);
  console.log(gate.ok ? "PASS" : `FAIL (${gate.failures.length})`);
  process.exitCode = gate.ok ? 0 : 1;
}
