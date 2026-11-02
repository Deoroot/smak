// Stage 5 of the map generator: floor plans (PLAN.md Phase 3, "The map generator").
//
// Reads stage 3's programs (03-programs.json) and the architecture rulebook and writes `05-plans.json`: per
// building and storey its rooms as rectangles (an L as two) in metres in the lot's frame and in world cells, the
// walls with their thickness, doors (kind, the rooms or the street they join, position, width and height from the
// rulebook, the side the leaf swings to), windows, stairs (dog-leg flights at the rulebook's rise and run with
// their landings), units grouping rooms, and the property doors named by the description's pattern.
//
// How a building is laid out (layout.mjs does one zone):
// 1. Shells: a building is one shell inside its exterior walls; a terrace one shell a house, side by side behind
//    party walls; huts one small shell each along the frontage with yards between.
// 2. Fixed through every storey: the stairs (tried at several places along the side and back walls, both ways
//    round), a court where stage 3 asked for one, halls rising through the storey above, gardens open to the sky.
// 3. Each storey tries strategies (free slicing with corridor insertion; a spine corridor across or along the
//    footprint; a ring corridor round the court) and keeps the best plan. A storey with several units (flats, a
//    shop with flats over it) is laid out twice: the units as blocks round the shared circulation, then each unit
//    inside its block from its own front door.
// 4. Doors placed on the shared walls (near a corner where they fit, Alexander 196), swing into the room entered,
//    clear of stair flights and of each other; windows on every outside wall (less the party walls a neighbouring lot
//    shares) and court wall of rooms that may have them; parapets round terraces.
// 5. Stage 4 tied in: rooms it stood in the lot (a checkpoint's guard post and cells, a service post) fixed at their
//    place; a gate room at the end of its hallway, a door where every other hallway meets the wall; a lift lobby
//    against its shaft; a connector's exit into a room that may take it, never a cell.
//
//   node levels/gen/plans.mjs [description.json] [--out dir] [--lots dir] [--seed s] [--svg dir]

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadRules, rulesFor, doorFits, stairFits, ceilingFits, keepClearOf, overlapDepth, circulationOk, roomProgramOk } from "../lib/architecture-rules.mjs"; // prettier-ignore
import { G, rngOf, round2, round3, round4, gToM, loadCity, lotsFor, sha256, canonical } from "./common.mjs";
import { programsOf, checkPrograms, WALL } from "./programs.mjs";
import { searchZone, adjacencyOf, edgesOf, rectArea, overlaps, doorNeed, clipToRect, sharedSegments, shapeKey, LIGHT, SOFT_GIVE } from "./layout.mjs"; // prettier-ignore

export const PLANS_FORMAT = "smak-gen-plans/1";
const TE = 2; // exterior wall, grid steps (16 units)
const TI = 1; // interior wall (8 units)
const SLAB = G; // floor slab, 8 units
/**
 * Room footprints repeated: PLAN.md's stage-5 rule asked 20 % of rooms at most (buildings 0) with 10 % the target;
 * the plans now reach the target (the whole city 5.8 to 9.5 % over three seeds, the Core 3.5 %), so the gate holds it.
 */
export const REPEAT_GATE = 0.1;
export const REPEAT_TARGET = 0.1;

/** Door widths used per kind (metres): the rulebook's typical, an opening at a stair's width less margins. */
const DOOR_WIDTH = (rules) => ({
  house: rules.dimensions.doors.house.width.typical,
  interior: rules.dimensions.doors.interior.width.typical,
  shop: rules.dimensions.doors.shop.width.typical,
  public: rules.dimensions.doors.public.width.typical,
  cell: rules.dimensions.doors.cell.width.typical,
  secret: rules.dimensions.doors.secret.width.typical,
  opening: 1.63,
  gate: 2.44,
  lift: rules.dimensions.doors.lift.width.typical,
});
const DOOR_HEIGHT = (rules, kind) => (kind === "gate" ? Math.max(rules.dimensions.doors.gate.height.min, 2.9) : rules.dimensions.doors[kind].height.typical);
/** Room heights by ceiling class (metres), each at least the class's minimum and under the storey's slab. */
const HEIGHT = { low: 3.25, room: 3.6, public: 4.2, hall: null, corridor: 3.5, outdoor: null, cave: 4.2 };
const DISPLAY = new Set(["shop-floor", "barroom", "stall"]);
const HUB_ORDER = ["lobby", "shop-floor", "barroom", "hall", "great-hall", "front-desk", "workshop", "garage", "factory-floor", "war-room", "corridor", "living", "bedsit", "bunkroom", "lookout", "storeroom"]; // prettier-ignore
const PREFER = { stall: ["hall"], cell: ["corridor", "guard-post"], "holding-cell": ["corridor", "guard-post", "booking"], bedroom: ["corridor", "living"], toilet: ["corridor", "bedroom", "bedsit", "lobby", "living"], stairwell: ["corridor", "lobby"], office: ["corridor"], kitchen: ["living", "great-hall"] }; // prettier-ignore

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** A storey with a fault is laid out again this many times at most (planShell). */
const STOREY_RETRIES = 8;
/** The faults in a layout's reasons: what the gate fails (spare floor, a repeat or a share off its target are not). */
const faultsOf = (why) => (why ?? []).filter((w) => !/^orphan|repeat/.test(w)).length;
/** Service rooms the layout holds near their use (3.5 times their minimum), the score's cap and not the gate's. */
const SERVICE_USE = ["toilet", "storeroom", "cellar", "lockers", "records", "evidence", "cell", "holding-cell", "stall"];
/** An item's cap in grid steps squared, the rulebook's or its use's (null: none). */
const capG = (room) => (room.maxArea_m2 ? (room.maxArea_m2 * 0.92) / (G * G) : SERVICE_USE.includes(room.kind) ? (room.minArea_m2 * 3.5) / (G * G) : null); // prettier-ignore

// ── items ──

function itemOf(room, prog, rules, rng, extra = {}) {
  const jitter = 1 + rng.range(-0.14, 0.14);
  // where a storey is larger than its program, public rooms take more of the growth and service rooms less
  const grow = room.zone === "public" ? 1.5 : ["toilet", "storeroom", "cellar", "lockers", "records", "evidence"].includes(room.kind) ? 0.6 : 1;
  return {
    id: room.id,
    kind: room.kind,
    unit: room.unit ?? null,
    // never weighed under its minimum and a margin for walls: a store shrunk by the growth of its neighbours is still a store
    weight: Math.max((room.target_m2 / (G * G)) * jitter * grow, ((Math.sqrt(room.minArea_m2) + 2 * G) ** 2 * 1.15) / (G * G)),
    // a service room grown far past its use, or any room past its kind's maxArea (the rulebook's; less a margin for walls)
    maxAreaG: capG(room),
    // the rulebook's cap alone (the gate holds it): a pocket larger than the room leaves the rest spare (layout.mjs)
    hardCapG: room.maxArea_m2 ? (room.maxArea_m2 * 0.92) / (G * G) : null,
    // a corridor's clear width at most its kind's share of its class's typical (roomKinds.corridor.maxWidthOfTypical)
    maxWidthG: room.kind === "corridor" && rules.roomKinds.corridor?.maxWidthOfTypical ? Math.floor((rules.dimensions.corridors[corridorClassOf(prog, room)].width.typical * rules.roomKinds.corridor.maxWidthOfTypical) / G) : null, // prettier-ignore
    minSideG: Math.ceil(room.minSide_m / G),
    minAreaG: room.minArea_m2 / (G * G),
    rank: room.rank,
    circ: room.zone === "circulation",
    exterior: Boolean(room.needs?.window) && !room.hidden,
    next: room.hidden ? [] : room.next ?? [],
    notNext: room.notNext ?? [],
    prefer: PREFER[room.kind],
    // a secure room with a rule of what it opens on opens on nothing else (cells off a guarded corridor)
    onlyFrom: room.rank >= 3 && room.next?.length && !room.hidden ? [...new Set(room.next.flat())] : undefined,
    hidden: Boolean(room.hidden),
    host: room.hidden ? [...(room.host ?? []), "corridor"] : [],
    areaWeight: room.hidden ? 4 : 1,
    hiddenHost: false,
    side: room.gate?.side ?? null,
    room,
    group: room.hidden ? `h:${room.host?.[0]}` : ["cell", "holding-cell", "stall"].includes(room.kind) ? `strip:${room.kind}` : ["interrogation", "evidence"].includes(room.kind) ? "jail" : room.unit ?? room.id, // prettier-ignore
    stripKey: ["cell", "stall", "holding-cell"].includes(room.kind) ? room.kind : null,
    maxAspect: ["corridor", "catwalk", "stall", "cell", "holding-cell", "upper-hall", "garden"].includes(room.kind) ? 6 : 2.3,
    ...extra,
  };
}

/** Intimacy order: the hub, then by zone rank, kept groups together (stalls, the jail, a unit), hidden rooms after their host. */
function ordered(items) {
  const rank = (it) => (it.hub ? -1 : it.void ? 5 : it.rank + (it.hidden ? 0.5 : 0));
  return [...items].sort((a, b) => rank(a) - rank(b) || cmp(a.id, b.id));
}

// ── geometry helpers ──

const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.d <= b.y + b.d;

const frontSeg = (rect, side) => {
  const e = edgesOf(rect).find((x) => x.side === side);
  return { ...e };
};
const segsOfRect = (rect) => edgesOf(rect).map((e) => ({ ...e }));

/** A dog-leg stair's rectangle (partition, grid steps) and its entry landing: `long` along x or y, entry at the low or high end. */
function stairRect(at, size, longX, entryLow) {
  const [wG, lG] = size;
  const rect = longX ? { x: at[0], y: at[1], w: lG, d: wG } : { x: at[0], y: at[1], w: wG, d: lG };
  return { rect, longX, entryLow };
}
const entryZoneOf = (st, entryG) => {
  const r = st.rect;
  if (st.longX) return st.entryLow ? { x: r.x, y: r.y, w: entryG, d: r.d } : { x: r.x + r.w - entryG, y: r.y, w: entryG, d: r.d };
  return st.entryLow ? { x: r.x, y: r.y, w: r.w, d: entryG } : { x: r.x, y: r.y + r.d - entryG, w: r.w, d: entryG };
};

/**
 * Stair placements along the non-front walls of a shell: a list of candidate sets (one rect, or two far apart). A stair
 * off the front wall by less than `frontBandG` (the street room's narrowest side and its walls) is left out: the band
 * before it would hold no room the street storey needs (a lobby squeezed under its least width). So is a stair that
 * leaves a sliver or a thin band against a connector's well or column or a fixed room (`keepOff`): a pocket no room
 * could take, cut off the well's own door.
 */
export function stairCandidates(shell, size, count, court, rng, keepOff = [], frontBandG = 0) {
  const R = shell.rect;
  const front = shell.front;
  const [wG, lG] = size;
  const out = [];
  const sides = ["n", "s", "e", "w"].filter((s) => s !== front);
  const fits = (r) => r.x >= R.x && r.y >= R.y && r.x + r.w <= R.x + R.w && r.y + r.d <= R.y + R.d && !(court && overlaps(r, court)) && !keepOff.some((k) => overlaps(r, k)); // prettier-ignore
  const one = [];
  for (const side of sides)
    for (const along of [0, 0.2, 0.5, 0.8, 1])
      for (const perp of [true, false]) {
        // perp: the long axis runs away from the wall (entry at the inner end)
        const wallIsV = side === "e" || side === "w";
        const longX = wallIsV ? perp : !perp;
        const w = longX ? lG : wG;
        const d = longX ? wG : lG;
        let x;
        let y;
        if (wallIsV) {
          x = side === "w" ? R.x : R.x + R.w - w;
          y = Math.round(R.y + along * (R.d - d));
        } else {
          y = side === "s" ? R.y : R.y + R.d - d;
          x = Math.round(R.x + along * (R.w - w));
        }
        // the entry end faces into the building: away from the wall, or toward the middle along it
        let entryLow;
        if (perp) entryLow = side === "e" || side === "n";
        else entryLow = wallIsV ? y + d / 2 > R.y + R.d / 2 : x + w / 2 > R.x + R.w / 2;
        // a stair hard against the front wall would block the street storey
        const st = stairRect([x, y], size, longX, entryLow);
        if (!fits(st.rect)) continue;
        if (front === "s" && st.rect.y === R.y) continue;
        if (front === "n" && st.rect.y + st.rect.d === R.y + R.d) continue;
        if (front === "w" && st.rect.x === R.x) continue;
        if (front === "e" && st.rect.x + st.rect.w === R.x + R.w) continue;
        const gap = front === "s" ? st.rect.y - R.y : front === "n" ? R.y + R.d - st.rect.y - st.rect.d : front === "w" ? st.rect.x - R.x : R.x + R.w - st.rect.x - st.rect.w; // prettier-ignore
        if (gap > 0 && gap < frontBandG) continue;
        if (keepOff.some((k) => pocketBetween(st.rect, k))) continue;
        one.push({ st, key: `${side}${along}${perp ? "p" : "a"}` });
      }
  if (count <= 1) for (const c of one) out.push([c]);
  else
    for (let i = 0; i < one.length; i++)
      for (let j = i + 1; j < one.length; j++) {
        const a = one[i].st.rect;
        const b = one[j].st.rect;
        if (overlaps(a, b)) continue;
        const dist = Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.d / 2 - b.y - b.d / 2);
        if (dist < Math.max(R.w, R.d) * 0.45) continue;
        out.push([one[i], one[j]]);
      }
  return rng.shuffle(out);
}

/** The narrowest band between a stair and a kept-off rectangle that a room or a corridor may take (grid steps, 3.25 m). */
const BAND_MIN = 16;
/** The narrowest sliver where a stair's side and a kept-off rectangle's side nearly line up (grid steps, 1.8 m). */
const SLIVER_MIN = 9;
/** A stair `a` and a kept-off rectangle `b` leave a pocket no room can take: a thin band between them, or a sliver beside one. */
export function pocketBetween(a, b) {
  const near = (lo, hi) => lo > 0 && lo < hi;
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y);
  const gapY = Math.max(b.y - a.y - a.d, a.y - b.y - b.d);
  const gapX = Math.max(b.x - a.x - a.w, a.x - b.x - b.w);
  if (ox > 0 && near(gapY, BAND_MIN)) return true;
  if (oy > 0 && near(gapX, BAND_MIN)) return true;
  // sides nearly in line, the two near each other: the step between them is a sliver
  if (ox > 0 && gapY < 3 * BAND_MIN && (near(Math.abs(a.x - b.x), SLIVER_MIN) || near(Math.abs(a.x + a.w - b.x - b.w), SLIVER_MIN))) return true;
  if (oy > 0 && gapX < 3 * BAND_MIN && (near(Math.abs(a.y - b.y), SLIVER_MIN) || near(Math.abs(a.y + a.d - b.y - b.d), SLIVER_MIN))) return true;
  return false;
}

/**
 * The court: a rectangle of the asked area. `mode`: "centre" (a court with rooms all round, a seeded offset),
 * "back" (a yard against the back wall, rooms on three sides), "backLow" / "backHigh" (a yard in a back corner,
 * rooms on two sides). A band of rooms (6 m or more) is kept on every side that is not the yard's open one.
 */
export function courtRect(shell, area_m2, rng, mode = "centre") {
  const R = shell.rect;
  const a = area_m2 / (G * G);
  const margin = 30;
  const back = { s: "n", n: "s", e: "w", w: "e" }[shell.front];
  const alongX = back === "n" || back === "s";
  const L = alongX ? R.w : R.d;
  const Dp = alongX ? R.d : R.w;
  let along;
  let deep;
  if (mode === "centre") {
    const k = Math.sqrt(a / (R.w * R.d));
    along = Math.min(Math.round(L * k), L - 2 * margin);
    deep = Math.min(Math.round(Dp * k), Dp - 2 * margin);
  } else {
    const k = Math.sqrt(a / (L * Dp));
    const sidesKept = mode === "back" ? 2 : 1;
    along = Math.min(Math.round(L * k * 1.1), L - sidesKept * margin);
    deep = Math.min(Math.round(a / Math.max(1, along)), Dp - margin - 10);
  }
  if (along < 20 || deep < 20) return null;
  let u0;
  let v0;
  if (mode === "centre") {
    u0 = Math.round((L - along) / 2 + rng.range(-0.12, 0.12) * (L - along - 2 * margin));
    v0 = Math.round((Dp - deep) / 2 + rng.range(-0.12, 0.12) * (Dp - deep - 2 * margin));
  } else {
    v0 = 0;
    u0 = mode === "back" ? Math.round((L - along) / 2 + rng.range(-0.1, 0.1) * (L - along - 2 * margin)) : mode === "backLow" ? 0 : L - along;
  }
  if (back === "n") return { x: R.x + u0, y: R.y + R.d - v0 - deep, w: along, d: deep };
  if (back === "s") return { x: R.x + u0, y: R.y + v0, w: along, d: deep };
  if (back === "e") return { x: R.x + R.w - v0 - deep, y: R.y + u0, w: deep, d: along };
  return { x: R.x + v0, y: R.y + u0, w: deep, d: along };
}

// ── one building ──

/** Plans one building from its program. */
export function planBuilding(prog, rules, { seed = "smak", trials = 220, used = new Map(), reserved = [] } = {}) {
  const W = DOOR_WIDTH(rules);
  const Wg = Math.round(prog.lot.rect.w * 16);
  const Dg = Math.round(prog.lot.rect.d * 16);
  const side = prog.lot.frontage.side;
  const storeyH = prog.lot.storeyHeight_m;
  const clearH = round3(storeyH - SLAB);
  // the rulebook's en suites and the like, less the pairs a generator never lays itself (privateThroughNotGenerated)
  const notGenerated = new Set((rules.circulation.privateThroughNotGenerated ?? []).map(([a, b]) => `${a}>${b}`));
  const privateThrough = new Set(rules.circulation.privateThroughAllowed.map(([a, b]) => `${a}>${b}`).filter((k) => !notGenerated.has(k))); // prettier-ignore
  const noPass = new Set(rules.circulation.noPassThrough?.kinds ?? []);
  const unitsById = new Map(prog.units.map((u) => [u.id, u]));
  const corrCls = prog.corridor.class;
  const corrWidthG = (cls) => Math.ceil(rules.dimensions.corridors[cls].width.min / G) + TI;
  const stairSize = prog.stair ? [Math.ceil(prog.stair.clear[0] / G) + TI, Math.ceil(prog.stair.clear[1] / G) + TI] : null;
  const entryG = prog.stair ? Math.ceil(prog.stair.entryLanding / G) : 0;
  const mainUnit = prog.units.length === 1 ? prog.units[0].id : (prog.units.find((u) => u.kind !== "home")?.id ?? null);
  const inner = { x: TE, y: TE, w: Wg - 2 * TE, d: Dg - 2 * TE };
  const doorAtG = Math.round((prog.lot.frontage.door?.at ?? 0) * 16);
  const decisions = [];
  // connectors' wells and shafts standing in the building (stage 4): fixed, never a room, on the storeys they cross
  const storeyCells = prog.lot.storeyHeight_m / 3.2512;
  let resG = reserved.map((r) => {
    const g = { x: Math.round((r.rect.x - prog.lot.rect.x) * 16), y: Math.round((r.rect.y - prog.lot.rect.y) * 16), w: Math.round(r.rect.w * 16), d: Math.round(r.rect.d * 16) }; // prettier-ignore
    const on = [];
    for (let s = 0; s < prog.storeys; s++) {
      const z0 = prog.lot.zBase + s * storeyCells;
      if (r.z[0] < z0 + storeyCells - 0.05 && r.z[1] > z0 + 0.05) on.push(s);
    }
    const exits = (r.exits ?? []).filter((e) => e.stop === prog.id).map((e) => ({ side: e.side, storey: Math.max(0, Math.min(prog.storeys - 1, Math.round((e.z - prog.lot.zBase) / storeyCells))) })); // prettier-ignore
    // inside the exterior walls: a well may stand against the lot's edge, its wall is the building's
    const x0 = Math.max(g.x, TE);
    const y0 = Math.max(g.y, TE);
    const x1 = Math.min(g.x + g.w, Wg - TE);
    const y1 = Math.min(g.y + g.d, Dg - TE);
    return { ...r, g: { x: x0, y: y0, w: x1 - x0, d: y1 - y0 }, on, exits };
  }).filter((r) => r.on.length && r.g.w > 0 && r.g.d > 0);
  // wells and shafts that touch on the same storeys are one column (the Nexus spine: its stair, lift and the
  // prisoner lift), kept clear as their bounding rectangle so no sliver of room is left between them
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < resG.length && !merged; i++)
      for (let j = i + 1; j < resG.length && !merged; j++) {
        const a = resG[i];
        const b = resG[j];
        const touch = a.g.x <= b.g.x + b.g.w && b.g.x <= a.g.x + a.g.w && a.g.y <= b.g.y + b.g.d && b.g.y <= a.g.y + a.g.d;
        if (!touch || a.on.join() !== b.on.join()) continue;
        const x = Math.min(a.g.x, b.g.x);
        const y = Math.min(a.g.y, b.g.y);
        const g = { x, y, w: Math.max(a.g.x + a.g.w, b.g.x + b.g.w) - x, d: Math.max(a.g.y + a.g.d, b.g.y + b.g.d) - y };
        const exits = [...a.exits, ...b.exits].filter((e, k, l) => l.findIndex((f) => f.side === e.side && f.storey === e.storey) === k);
        resG.splice(j, 1);
        resG[i] = { ...a, connector: `${a.connector}+${b.connector}`, kind: "column", g, exits, rect: { x: prog.lot.rect.x + g.x / 16, y: prog.lot.rect.y + g.y / 16, w: g.w / 16, d: g.d / 16 } }; // prettier-ignore
        merged = true;
      }
  }
  for (const r of resG) decisions.push({ rule: "connector", what: `${r.connector}'s ${r.kind} kept clear on storey ${r.on.join(", ")}${r.exits.length ? `, its door on the ${r.exits.map((e) => `${e.side} at storey ${e.storey}`).join(", ")}` : ""}` }); // prettier-ignore
  // rooms stage 4 stood in the lot (a checkpoint's guard post and cells, a service post): fixed at their place
  const fixedRooms = prog.rooms
    .filter((r) => r.fixed)
    .map((r) => {
      const g = { x: Math.round((r.fixed.x - prog.lot.rect.x) * 16), y: Math.round((r.fixed.y - prog.lot.rect.y) * 16), w: Math.round(r.fixed.w * 16), d: Math.round(r.fixed.d * 16) }; // prettier-ignore
      const x0 = Math.max(g.x, TE);
      const y0 = Math.max(g.y, TE);
      return { room: r, g: { x: x0, y: y0, w: Math.min(g.x + g.w, Wg - TE) - x0, d: Math.min(g.y + g.d, Dg - TE) - y0 } };
    })
    .filter((f) => f.g.w > 0 && f.g.d > 0);
  for (const f of fixedRooms) decisions.push({ rule: "fixed room", what: `${f.room.id} (${f.room.checkpoint ?? f.room.post}'s ${f.room.kind}) laid where stage 4 stood it` }); // prettier-ignore
  const keepOffAll = [...resG.map((r) => r.g), ...fixedRooms.map((f) => f.g)];
  // the band a stair may leave before the front wall: none, or the widest of the street storey's street rooms' least
  // sides (the lobby's, a shop floor's) and its walls
  const frontBandG = Math.max(0, ...prog.rooms.filter((r) => r.storey === 0 && (r.needs?.street || prog.entrance.includes(r.kind)) && !r.fixed && !r.hidden).map((r) => Math.ceil(r.minSide_m / G) + 2 * TI)); // prettier-ignore
  // party walls (stage 3 from stage 2's lots): the stretches of the lot's outer line shared with a neighbour, no window
  const partyG = (prog.lot.party ?? []).map((p) => ({ side: p.side, a: Math.round(p.a * 16), b: Math.round(p.b * 16), lot: p.lot }));
  const onLotLine = (e) => (e.side === "w" && e.c === TE) || (e.side === "e" && e.c === Wg - TE) || (e.side === "s" && e.c === TE) || (e.side === "n" && e.c === Dg - TE); // prettier-ignore
  /** A rectangle's outside edges less the party walls: where a window or an outside door may open. */
  const openSegs = (rect) => {
    const out = [];
    for (const e of segsOfRect(rect)) {
      let pieces = [[e.a, e.b]];
      if (onLotLine(e))
        for (const p of partyG.filter((q) => q.side === e.side))
          pieces = pieces.flatMap(([a, b]) => (p.b <= a || p.a >= b ? [[a, b]] : [[a, Math.max(a, p.a)], [Math.min(b, p.b), b]]));
      for (const [a, b] of pieces) if (b > a) out.push({ ...e, a, b });
    }
    return out;
  };

  // shells
  const shells = [];
  if (prog.layout === "columns") {
    const cols = prog.units;
    const rng = rngOf(`${seed}:${prog.id}:columns`);
    const alongX = side === "n" || side === "s";
    const L = alongX ? inner.w : inner.d;
    const depthFull = alongX ? inner.d : inner.w;
    // huts by their rooms' area (±15 %); a terrace's houses near equal (±10 %): each must hold its stair, landing and a bedroom across
    const targets = cols.map((u) => prog.rooms.filter((r) => r.unit === u.id && r.storey === 0).reduce((s, r) => s + r.target_m2, 0) * (1 + rng.range(prog.type === "huts" ? -0.15 : -0.1, prog.type === "huts" ? 0.15 : 0.1))); // prettier-ignore
    const huts = prog.type === "huts";
    let widths;
    let starts;
    let depth = depthFull;
    let hutDepths = null;
    if (huts) {
      depth = Math.min(depthFull, Math.round(rng.range(34, 44)));
      // each hut a little deeper or shallower than the next (a row of huts is built hut by hut), as wide as its rooms ask
      hutDepths = cols.map(() => Math.max(30, Math.min(depthFull, depth + rng.int(9) - 4)));
      widths = targets.map((t, i) => Math.max(20, Math.round(t / (G * G) / (hutDepths[i] - 2 * TE)) + 2 * TE));
      const free = L - widths.reduce((a, b) => a + b, 0);
      const gaps = Array.from({ length: cols.length + 1 }, () => rng.range(0.5, 1.5));
      const gsum = gaps.reduce((a, b) => a + b, 0);
      starts = [];
      let x = 0;
      for (let i = 0; i < cols.length; i++) {
        x += Math.max(4, Math.floor((free * gaps[i]) / gsum));
        starts.push(x);
        x += widths[i];
      }
      decisions.push({ rule: "huts", what: `${cols.length} huts ${depth} steps deep along the frontage, yards between` });
    } else {
      const sum = targets.reduce((a, b) => a + b, 0);
      const usableL = L - (cols.length - 1) * TE;
      widths = targets.map((t) => Math.round((usableL * t) / sum));
      widths[widths.length - 1] = usableL - widths.slice(0, -1).reduce((a, b) => a + b, 0);
      // each house wide enough for its widest ground room beside its stair; the width comes from the widest
      const wmin = (u) => Math.ceil(Math.max(...prog.rooms.filter((r) => r.unit === u.id && r.storey === 0).map((r) => r.minSide_m)) / G) + 1 + (prog.storeys > 1 && stairSize ? stairSize[0] + 1 : 0); // prettier-ignore
      let mins = cols.map(wmin);
      if (mins.reduce((a, b) => a + b, 0) > usableL) mins = cols.map(() => Math.floor(usableL / cols.length)); // as equal as the row allows
      if (mins.reduce((a, b) => a + b, 0) <= usableL)
        for (let guard = 0; guard < 200; guard++) {
          const i = widths.findIndex((w, k) => w < mins[k]);
          if (i < 0) break;
          const j = widths.reduce((m, w, k) => (w - mins[k] > widths[m] - mins[m] ? k : m), 0);
          widths[i]++;
          widths[j]--;
        }
      starts = [];
      let x = 0;
      for (let i = 0; i < cols.length; i++) {
        starts.push(x);
        x += widths[i] + TE;
      }
      decisions.push({ rule: "terrace", what: `${cols.length} houses side by side behind party walls, widths ${widths.map((w) => round2(w * G)).join(", ")} m` }); // prettier-ignore
    }
    for (let i = 0; i < cols.length; i++) {
      const s0 = starts[i];
      let rect;
      const dI = hutDepths ? hutDepths[i] : depth;
      const frontAt = side === "s" || side === "w" ? 0 : depthFull - dI;
      if (alongX) rect = { x: inner.x + s0, y: inner.y + frontAt, w: widths[i], d: dI };
      else rect = { x: inner.x + frontAt, y: inner.y + s0, w: dI, d: widths[i] };
      if (huts) rect = { x: rect.x + TE, y: rect.y + TE, w: rect.w - 2 * TE, d: rect.d - 2 * TE }; // each hut its own walls
      if (huts) {
        // keep the hut's front wall on the lot's front line
        if (side === "s") rect.y -= TE;
        if (side === "n") rect.y += TE;
        if (side === "w") rect.x -= TE;
        if (side === "e") rect.x += TE;
      }
      shells.push({ id: cols[i].id, rect, front: side, units: [cols[i].id], hut: huts });
    }
  } else shells.push({ id: prog.id, rect: inner, front: side, units: prog.units.map((u) => u.id), main: true });

  const storeys = [];
  for (let s = 0; s < prog.storeys; s++) storeys.push({ storey: s, leaves: [], doors: [], fixedVoids: [], score: 0, why: [] });
  const usedB = new Map(used); // footprints taken, shell by shell
  const stairsOut = [];
  let courtOut = null;

  for (const shell of shells) {
    const shellRooms = prog.rooms.filter((r) => (prog.layout === "columns" ? r.unit === shell.id || (r.hidden && r.unit === shell.id) : true));
    const stairCount = prog.stair ? (prog.stair.perUnit ? 1 : prog.stair.count) : 0;
    const rngC = rngOf(`${seed}:${prog.id}:${shell.id}:court`);
    const courts = shell.main && prog.court ? ["centre", "back", "backLow", "backHigh"].map((m) => ({ mode: m, rect: courtRect(shell, prog.court.area_m2, rngC, m) })).filter((c) => c.rect && !keepOffAll.some((g) => overlaps(g, c.rect))) : [{ mode: null, rect: null }]; // prettier-ignore
    if (!courts.length) {
      courts.push({ mode: null, rect: null });
      decisions.push({ rule: "court", what: "no court: the footprint leaves no band of rooms round one" });
    }
    const rngS = rngOf(`${seed}:${prog.id}:${shell.id}:stairs`);
    const cands = [];
    for (const c of courts) {
      const list = stairCount ? stairCandidates(shell, stairSize, stairCount, c.rect, rngS, keepOffAll, frontBandG) : [[]];
      for (const st of list.slice(0, courts.length > 1 ? 6 : 14)) cands.push({ court: c, stairs: st });
    }
    // no court place leaves room for the stairs: the stairs first, the court left out
    if (!cands.length && stairCount && courts.some((c) => c.rect)) {
      for (const st of stairCandidates(shell, stairSize, stairCount, null, rngS, keepOffAll, frontBandG).slice(0, 14)) cands.push({ court: { mode: null, rect: null }, stairs: st }); // prettier-ignore
      if (cands.length) decisions.push({ rule: "court", what: "no court: no place for one left room for the stairs" });
    }
    if (!cands.length) {
      cands.push({ court: courts[0], stairs: [] });
      decisions.push({ rule: "stair", what: `no place for ${stairCount} stair(s) in ${shell.id}` });
    }
    const quick = Math.max(20, Math.round(trials / 6));
    const tryCand = (cand, nTrials, tag) => planShell(shell, shellRooms, cand.stairs.map((c) => c.st), cand.court.rect, nTrials, `${tag}`);
    const scored = cands.map((c, k) => ({ c, k, r: tryCand(c, quick, `q${k}`) }));
    scored.sort((a, b) => a.r.score - b.r.score || a.k - b.k);
    let best = null;
    for (const sc of scored.slice(0, 3)) {
      const r = tryCand(sc.c, trials, `f${sc.k}`);
      if (!best || r.score < best.r.score) best = { c: sc.c, r };
    }
    const res = best.r;
    for (const st of res.storeys) for (const l of st?.leaves ?? []) registerShape(usedB, l, shell.rect); // the next house of a row sees this one
    if (best.c.court.rect) {
      courtOut = best.c.court.rect;
      decisions.push({ rule: "court", what: `the court laid ${best.c.court.mode === "centre" ? "in the middle, rooms all round" : best.c.court.mode === "back" ? "against the back wall, rooms on three sides" : "in a back corner, rooms on two sides"}` }); // prettier-ignore
    }
    // merge into the storeys
    for (let s = 0; s < prog.storeys; s++) {
      const st = res.storeys[s];
      if (!st) continue;
      storeys[s].leaves.push(...st.leaves);
      storeys[s].doors.push(...st.doors);
      storeys[s].score += st.score;
      storeys[s].why.push(...st.why.map((w) => `${shell.id}: ${w}`));
    }
    best.c.stairs.forEach((c, k) => stairsOut.push({ id: stairCount > 1 ? `${shell.id}.stair${k + 1}` : `${shell.id}.stair`, st: c.st, shell: shell.id }));
  }

  // ── one shell: every storey, for one set of stair places ──
  function planShell(shell, shellRooms, stairSet, court, nTrials, tag) {
    const out = { storeys: [], score: 0 };
    let carry = []; // rects fixed from below: halls rising through, gardens open to the sky
    const local = new Map(usedB); // footprints taken: the city's so far, this building's other shells and lower storeys
    for (let s = 0; s < prog.storeys; s++) {
      const rooms = shellRooms.filter((r) => r.storey === s && !r.fixed);
      if (!rooms.length && s > 0 && !stairSet.length) {
        out.storeys.push(null);
        continue;
      }
      const fixed = [];
      stairSet.forEach((st, k) => {
        const unit = prog.layout === "columns" ? shell.id : mainUnit && prog.units.length === 1 ? mainUnit : null;
        const id = `${stairSet.length > 1 ? `${shell.id}.stair${k + 1}` : `${shell.id}.stair`}.s${s}`;
        const item = { id, kind: "stairwell", unit, rank: 1, circ: true, weight: 0, minSideG: 0, minAreaG: 0, entryZone: entryZoneOf(st, entryG), next: stairNext(), stair: k, room: { id, kind: "stairwell", unit, storey: s } }; // prettier-ignore
        fixed.push({ item, rect: st.rect });
      });
      if (court) fixed.push({ item: { id: `${prog.id}.court`, kind: "court", void: true, unit: null, rank: 0 }, rect: court });
      for (const r of resG.filter((x) => x.on.includes(s) && shell.main !== false && inside(x.g, shell.rect))) {
        const ex = r.exits.find((e) => e.storey === s);
        fixed.push({ item: { id: `${r.connector}.${r.kind}.s${s}`, kind: r.kind, void: true, unit: null, rank: 0, connector: r.connector, exitSide: ex?.side ?? null }, rect: r.g }); // prettier-ignore
      }
      for (const c of carry) fixed.push({ item: { id: `${c.id}.above${s}`, kind: c.kind, void: true, unit: null, rank: 0, below: c.id }, rect: c.rect }); // prettier-ignore
      for (const f of fixedRooms.filter((x) => x.room.storey === s && shell.main !== false && inside(x.g, shell.rect)))
        fixed.push({ item: itemOf(f.room, prog, rules, rngOf(`${seed}:${f.room.id}:w`), { fixedRoom: true }), rect: f.g });
      let res = planStorey(shell, s, rooms, fixed, nTrials, `${tag}:s${s}`, local);
      // a storey left with a fault the gate fails (a room cut off, a pinned room off its wall, one too narrow) is
      // laid out again from other seeds, on the full runs only, and the one with the fewest faults kept: the hard
      // storey of a building (a street storey with its hallways' gates, a lift and two stairs) gets the search
      for (let r = 1; r <= STOREY_RETRIES && !tag.startsWith("q") && faultsOf(res.why) > 0; r++) {
        const again = planStorey(shell, s, rooms, fixed, nTrials, `${tag}:s${s}:r${r}`, local);
        if (faultsOf(again.why) < faultsOf(res.why) || (faultsOf(again.why) === faultsOf(res.why) && again.score < res.score)) res = again;
      }
      for (const l of res.leaves) registerShape(local, l, shell.rect);
      out.storeys.push(res);
      out.score += res.score;
      // halls that rise and gardens open to the sky fix their rect on every storey above
      for (const l of res.leaves) {
        const r = l.item?.room;
        if (!r) continue;
        if (r.doubleHeight && s + 1 < prog.storeys) carry.push({ id: r.id, kind: "open-to-below", rect: l.rects[0], until: s + 1 });
        if (r.kind === "garden") carry.push({ id: r.id, kind: "open-garden", rect: l.rects[0], until: prog.storeys - 1 });
      }
      carry = carry.filter((c) => c.until > s);
    }
    return out;
  }
  /** A corridor's cap (roomKinds.corridor.maxArea, less the walls' margin) in grid steps squared, or null. */
  function corridorCapG() {
    const m = rules.roomKinds.corridor?.maxArea;
    return m ? (m * 0.92) / (G * G) : null;
  }
  /** A corridor's widest partition (its clear width at most maxWidthOfTypical times its class's typical, a wall in). */
  function corridorWideG(cls) {
    const k = rules.roomKinds.corridor?.maxWidthOfTypical;
    return k ? Math.floor((rules.dimensions.corridors[cls].width.typical * k) / G) + TI : null;
  }
  function stairNext() {
    return (rules.programs[prog.type]?.adjacency ?? []).filter((a) => a.a === "stairwell" && a.next).map((a) => a.next);
  }

  // ── one storey of one shell ──
  function planStorey(shell, s, rooms, fixed, nTrials, tag, usedHere) {
    const rng = rngOf(`${seed}:${prog.id}:${tag}:items`);
    const exterior = openSegs(shell.rect);
    const front = s === 0 ? frontSeg(shell.rect, shell.front) : null;
    const frontForWindows = frontSeg(shell.rect, shell.front);
    // terraces asked for this storey
    const voids = (prog.voids ?? []).filter((v) => v.storey === s && shell.main);
    // which units share this storey
    const unitIds = [...new Set(rooms.map((r) => r.unit ?? null))];
    const blobUnits = unitIds.filter((u) => u !== null && (unitIds.length > 1 || unitIds.includes(null)) && prog.layout !== "columns" && !(prog.units.length === 1));
    if (blobUnits.length) return storeyByUnits(shell, s, rooms, fixed, blobUnits, exterior, front, frontForWindows, voids, nTrials, tag, usedHere);
    const items = rooms.map((r) => itemOf(r, prog, rules, rngOf(`${seed}:${r.id}:w`)));
    markHub(items, s, shell);
    constrain([...items, ...fixed.map((f) => f.item)], s, shell);
    for (const v of voids) items.push({ id: `${prog.id}.terrace.s${s}`, kind: "terrace", void: true, unit: null, rank: 0, weight: (v.area_m2 / (G * G)), minSideG: 20, minAreaG: 0, exterior: true, maxAspect: 3, room: null }); // prettier-ignore
    addSlackTerrace(items, s, fixed, shell, voids);
    const unitOfZone = prog.layout === "columns" ? shell.id : mainUnit;
    const zone = baseZone(shell, s, fixed, ordered(items), exterior, front, unitOfZone, nTrials, tag);
    zone.hallAt = hallEnds(s, shell);
    zone.used = usedHere;
    zone.shellRect = shell.rect;
    return bestOfStrategies(zone, shell, s, fixed, tag);
  }

  /**
   * Where stage 4 ties a room to the building's wall: a gate room at the end of its hallway (programs' `gate.at`),
   * a lift lobby against its shaft's exit side (`lift`). Each becomes a stretch of wall the room must cover.
   */
  function constrain(items, s, shell) {
    for (const it of items) {
      const r = it?.room;
      if (!r) continue;
      if (r.checkpoint && r.kind === "guard-post") it.ownDoor = true;
      if (r.gate && r.gate.at !== undefined && r.gate.at !== null) {
        const seg = wallAt(shell, r.gate.side, r.gate.at, doorNeed(W.gate));
        if (seg) it.mustTouch = [...(it.mustTouch ?? []), { seg, need: seg.b - seg.a, why: `the end of hallway ${r.gate.hallway}` }];
      }
      if (r.lift) {
        const col = resG.find((c) => c.on.includes(s) && r.lift.connectors.some((k) => c.connector.split("+").includes(k)));
        const e = col && edgesOf(col.g).find((x) => x.side === r.lift.side);
        if (e) it.mustTouch = [...(it.mustTouch ?? []), { seg: e, need: Math.min(e.b - e.a, doorNeed(W.lift)), why: `${r.lift.connectors.join(" and ")}'s exit` }]; // prettier-ignore
      }
    }
  }
  /** A stretch of a shell's side `need` steps long centred where a hallway meets it (`at` cells from the lot's corner), or null off this shell. */
  function wallAt(shell, sideName, at, need) {
    const e = edgesOf(shell.rect).find((x) => x.side === sideName);
    const pos = Math.round(at * 16);
    if (pos < e.a - 8 || pos > e.b + 8 || e.b - e.a < need) return null;
    const a = Math.max(e.a, Math.min(e.b - need, pos - Math.floor(need / 2)));
    return { o: e.o, c: e.c, a, b: a + need };
  }
  /** The hallway ends of a storey with no gate room: a room must take each one's door there. */
  function hallEnds(s, shell) {
    const out = [];
    for (const h of (prog.hallways ?? []).filter((x) => !x.gate && x.storey === s)) {
      const seg = wallAt(shell, h.side, h.at, doorNeed(W.gate));
      if (seg) out.push({ seg, need: seg.b - seg.a, hallway: h.hallway });
    }
    return out;
  }

  /**
   * An upper storey whose rooms would grow past GROW_MAX times typical, or past their caps (the rulebook's maxArea, a
   * unit's rooms' together, SOFT_GIVE times a service room's use), leaves the rest unbuilt: a terrace.
   */
  function addSlackTerrace(items, s, fixed, shell, voids) {
    if (s === 0 || prog.layout === "columns") return;
    const free = rectArea(shell.rect) - fixed.reduce((a, f) => a + rectArea(f.rect), 0);
    const want = items.reduce((a, it) => a + (it.room?.target_m2 ?? it.target_m2 ?? 0), 0) / (G * G); // a unit's block: its rooms' targets
    const grown = items.reduce((a, it) => {
      if (it.void) return a;
      const t = ((it.room?.target_m2 ?? it.target_m2 ?? 0) / (G * G)) * 2.2;
      const c = it.blob ? it.maxAreaG : it.hardCapG ?? (it.maxAreaG ? it.maxAreaG * SOFT_GIVE : null);
      return a + (c ? Math.min(t, c) : t);
    }, 0);
    const corridors = prog.corridor.allowed && items.filter((it) => !it.void).length > 4 ? 0.1 * free : 0; // as stage 3 counts them
    const planned = voids.reduce((a, v) => a + v.area_m2, 0) / (G * G);
    // a court stage 3 asked for and stage 5 could not lay (a connector's column in the way) leaves its floor too
    const oneStair = rules.circulation.stairs.maxAreaOnOneStair / (G * G);
    const keepUnder = rules.circulation.stairs.loggia?.keepUnder ?? 1;
    const byCaps = grown < want * 2.2 - 1e-6 ? free - planned - grown - corridors : 0;
    const slack = Math.max(free - planned - want * 2.2, byCaps, fixed.filter((f) => f.item.kind === "stairwell").length === 1 ? free - planned - oneStair * keepUnder * 0.97 : 0); // prettier-ignore
    if (slack < 0.12 * free) return;
    items.push({ id: `${prog.id}.terrace${voids.length ? "-2" : ""}.s${s}`, kind: "terrace", void: true, unit: null, rank: 0, weight: slack, minSideG: 20, minAreaG: 0, exterior: true, maxAspect: 3, room: null }); // prettier-ignore
    decisions.push({ rule: "terrace", what: `storey ${s} leaves about ${round2(slack * G * G)} m2 unbuilt as a terrace: its rooms would grow past ${byCaps === slack ? "their caps (roomKinds maxArea)" : "2.2 times typical"}` }); // prettier-ignore
  }
  function markHub(items, s, shell) {
    for (const it of items) it.frontDoorWidth = W[streetKind(it)] ?? 1.63; // the street door it will take
    const entr = prog.layout === "columns" && prog.type === "apartment" ? ["corridor"] : prog.entrance;
    if (s === 0) {
      const hubKind = HUB_ORDER.find((k) => entr.includes(k) && items.some((it) => it.kind === k && !it.hidden)) ?? HUB_ORDER.find((k) => items.some((it) => it.kind === k && !it.hidden)); // prettier-ignore
      const hub = items.find((it) => it.kind === hubKind && !it.hidden);
      if (hub) {
        hub.hub = true;
        hub.front = true;
        hub.street = true;
      }
    }
    for (const it of items) {
      if (it.room?.needs?.street && s === 0 && it.room?.needs?.anyOutsideWall) {
        // a street room whose door may stand on any outside wall (roomNeeds.anyOutsideWall: a loading bay's vehicle
        // gate): the street's if it can, a side lane or yard else
        it.anyOutside = true;
        it.street = true;
        continue;
      }
      if (it.room?.needs?.street && s === 0) {
        it.front = true;
        it.street = true;
      }
      if (it.room?.entranceHall) {
        it.front = true;
        it.street = true;
        it.hub = true;
      }
      if (it.hidden) for (const h of items) if (it.host.includes(h.kind)) h.hiddenHost = true;
    }
  }

  function baseZone(shell, s, fixed, items, exterior, front, unitOfZone, nTrials, tag) {
    const cls = prog.layout === "columns" ? "domestic" : corrCls;
    return {
      rect: shell.rect,
      fixed,
      items,
      front,
      exterior,
      corridor: { allowed: prog.corridor.allowed, widthG: corrWidthG(cls), max: 2, p: 0.35, kind: cls },
      corridorUnit: unitOfZone ?? null,
      mainDoor: s === 0 ? doorAtG : null,
      entranceOf: (leaves) => entrancesOf(leaves, s, front),
      doorKind: (a, b) => doorKindOf(a, b),
      doorWidth: (k) => W[k],
      privateThrough,
      noPass,
      liftLobby: "lift-lobby",
      maxRunG: Math.floor(rules.circulation.corridor.maxRun / G),
      deadEndG: Math.floor(rules.circulation.deadEnd.maxLength / G),
      corridorCapG: corridorCapG(),
      corridorWideG: corridorWideG(cls),
      // partition area (walls in) held a little under the one-stair limit, which counts clear room area
      maxRoomAreaG: fixed.filter((f) => f.item.kind === "stairwell").length === 1 && prog.storeys > 1 && prog.layout !== "columns" ? (rules.circulation.stairs.maxAreaOnOneStair * 0.99) / (G * G) : null, // prettier-ignore
      trials: nTrials,
      noL: false,
      tag,
    };
  }

  function entrancesOf(leaves, s, front) {
    const out = [];
    leaves.forEach((l, i) => {
      const it = l.fixed?.item ?? l.item;
      if (!it) return;
      if (s > 0 || !front) {
        if (it.kind === "stairwell") out.push(i);
        return;
      }
      if (it.street && touch(l.rects, front) >= doorNeed(W[streetKind(it)])) out.push(i);
      // a checkpoint's guard post folded into the building opens onto its gate by its own door
      if (it.ownDoor && l.rects.some((r) => openSegs(r).some((e) => onLotLine(e)))) out.push(i);
    });
    if (s === 0 && !front) leaves.forEach((l, i) => (l.fixed?.item ?? l.item)?.kind === "stairwell" && out.push(i));
    return out;
  }

  /** The corridor strategies for a storey: none (free slicing), spines, the court's ring or part of it, a landing corridor at each stair. */
  function strategiesFor(zone, shell, s, fixed, tag, nItems) {
    const strategies = [{ name: "free", fixed: [] }];
    const cw = zone.corridor.widthG;
    const R = shell.rect;
    if (!zone.corridor.allowed || nItems < 3) return strategies;
    for (const sp of spines(R, shell.front, cw, s, fixed, tag)) strategies.push(sp);
    const court = fixed.find((f) => f.item.kind === "court");
    if (court) for (const r of ringsOf(court.rect, cw, R, fixed)) strategies.push(r);
    for (const f of fixed.filter((x) => x.item.kind === "stairwell")) {
      const land = landingOf(f, cw, R, fixed);
      if (land) strategies.push(land);
    }
    return strategies;
  }
  function runStrategies(zone, shell, s, fixed, tag, nItems, unitOfCorridor) {
    // a corridor along a connector's exit side would take the door its lift lobby or room must have there
    const exits = fixed.filter((f) => f.item.exitSide).map((f) => edgesOf(f.rect).find((e) => e.side === f.item.exitSide));
    const onExit = (r) => exits.some((e) => edgesOf(r).some((x) => x.o === e.o && x.c === e.c && Math.min(x.b, e.b) - Math.max(x.a, e.a) > 0));
    const strategies = strategiesFor(zone, shell, s, fixed, tag, nItems).filter((st) => st.name === "free" || !st.fixed.some(onExit));
    const withFixed = (st) => ({ ...zone, fixed: [...fixed, ...st.fixed.map((r, k) => ({ item: { id: `${shell.id}.s${s}.${st.name}${k}`, kind: "corridor", circ: true, unit: unitOfCorridor, rank: 1, weight: 0, minSideG: 0, minAreaG: 0 }, rect: r }))] }); // prettier-ignore
    const full = zone.trials;
    const first = strategies.map((st) => ({ st, r: searchZone({ ...withFixed(st), trials: Math.max(16, Math.round(full / 4)) }, rngOf(`${seed}:${prog.id}:${tag}:${st.name}:q`)) })); // prettier-ignore
    first.sort((a, b) => a.r.score - b.r.score);
    const out = [];
    for (const f of first.slice(0, 2)) {
      const r = searchZone(withFixed(f.st), rngOf(`${seed}:${prog.id}:${tag}:${f.st.name}`));
      out.push({ ...(r.score <= f.r.score ? r : f.r), strategy: f.st.name });
    }
    for (const f of first.slice(2, 3)) out.push({ ...f.r, strategy: f.st.name });
    out.sort((a, b) => a.score - b.score);
    return out;
  }
  function bestOfStrategies(zone, shell, s, fixed, tag) {
    const best = runStrategies(zone, shell, s, fixed, tag, zone.items.length, zone.corridorUnit)[0];
    return finishZone(best, s);
  }
  /** A corridor along a stair's entry end, across the shell, the stair's door on it. */
  function landingOf(f, cw, R, fixed) {
    const st = f.rect;
    const z = f.item.entryZone;
    let rect;
    const longX = z.d === st.d && z.w !== st.w;
    if (longX) {
      const low = z.x === st.x;
      const x = low ? st.x - cw : st.x + st.w;
      if (x < R.x || x + cw > R.x + R.w) return null;
      rect = { x, y: R.y, w: cw, d: R.d };
    } else {
      const low = z.y === st.y;
      const y = low ? st.y - cw : st.y + st.d;
      if (y < R.y || y + cw > R.y + R.d) return null;
      rect = { x: R.x, y, w: R.w, d: cw };
    }
    const pieces = cutAround(rect, fixed.map((x) => x.rect));
    if (!pieces.some((p) => sharedSegments(p, st).length)) return null;
    return { name: `landing-${f.item.id}`, fixed: pieces.flatMap((p) => splitRun(p)) };
  }
  /** Spine corridors: across the footprint (from behind a front band to the back) and along it, at seeded offsets. */
  function spines(R, front, cw, s, fixed, tag) {
    const rng = rngOf(`${seed}:${prog.id}:${tag}:spines`);
    const out = [];
    const across = front === "n" || front === "s" ? "y" : "x"; // the axis running from the front to the back
    for (const kind of ["across", "along"]) {
      for (let k = 0; k < 2; k++) {
        const off = rng.range(0.32, 0.68);
        let rect;
        if ((kind === "across") === (across === "y")) {
          // a corridor running in y
          const x = Math.round(R.x + off * (R.w - cw));
          const band = s === 0 ? Math.round(rng.range(0.22, 0.38) * R.d) : 0;
          const y0 = front === "s" ? R.y + band : R.y;
          const y1 = front === "n" ? R.y + R.d - band : R.y + R.d;
          rect = { x, y: y0, w: cw, d: y1 - y0 };
        } else {
          const y = Math.round(R.y + off * (R.d - cw));
          const band = s === 0 ? Math.round(rng.range(0.22, 0.38) * R.w) : 0;
          const x0 = front === "w" ? R.x + band : R.x;
          const x1 = front === "e" ? R.x + R.w - band : R.x + R.w;
          rect = { x: x0, y, w: x1 - x0, d: cw };
        }
        // a spine leaving a band too thin for a room beside a stair or a connector's column is passed over
        if (fixed.some((f) => (f.item.kind === "stairwell" || f.item.void) && pocketBetween(rect, f.rect))) continue;
        const pieces = cutAround(rect, fixed.map((f) => f.rect));
        if (pieces.length) out.push({ name: `${kind}${k}`, fixed: pieces.flatMap((p) => splitRun(p)) });
      }
    }
    return out;
  }
  /** A corridor rect with the fixed rects cut out: the longest pieces left (each a rectangle). */
  function cutAround(rect, holes) {
    let pieces = [rect];
    for (const h of holes) {
      const next = [];
      for (const p of pieces) {
        if (!overlaps(p, h)) {
          next.push(p);
          continue;
        }
        if (p.w >= p.d) {
          if (h.x > p.x) next.push({ ...p, w: h.x - p.x });
          if (h.x + h.w < p.x + p.w) next.push({ ...p, x: h.x + h.w, w: p.x + p.w - h.x - h.w });
        } else {
          if (h.y > p.y) next.push({ ...p, d: h.y - p.y });
          if (h.y + h.d < p.y + p.d) next.push({ ...p, y: h.y + h.d, d: p.y + p.d - h.y - h.d });
        }
      }
      pieces = next;
    }
    return pieces.filter((p) => Math.max(p.w, p.d) >= 24);
  }
  function splitRun(r) {
    const max = Math.floor(rules.circulation.corridor.maxRun / G);
    const long = Math.max(r.w, r.d);
    if (long <= max) return [r];
    const n = Math.ceil(long / max);
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = Math.round((long * i) / n);
      const b = Math.round((long * (i + 1)) / n);
      out.push(r.w >= r.d ? { x: r.x + a, y: r.y, w: b - a, d: r.d } : { x: r.x, y: r.y + a, w: r.w, d: b - a });
    }
    return out;
  }
  /** A gallery corridor round a court on the sides that have rooms: all of them, three, two meeting at a corner, or one. */
  function ringsOf(c, cw, R, fixed) {
    const inR = (r) => r.x >= R.x && r.y >= R.y && r.x + r.w <= R.x + R.w && r.y + r.d <= R.y + R.d;
    const sides = {
      n: { x: c.x, y: c.y + c.d, w: c.w, d: cw },
      s: { x: c.x, y: c.y - cw, w: c.w, d: cw },
      w: { x: c.x - cw, y: c.y, w: cw, d: c.d },
      e: { x: c.x + c.w, y: c.y, w: cw, d: c.d },
    };
    const corner = { ne: { x: c.x + c.w, y: c.y + c.d, w: cw, d: cw }, nw: { x: c.x - cw, y: c.y + c.d, w: cw, d: cw }, se: { x: c.x + c.w, y: c.y - cw, w: cw, d: cw }, sw: { x: c.x - cw, y: c.y - cw, w: cw, d: cw } }; // prettier-ignore
    const ok = Object.keys(sides).filter((k) => inR(sides[k]));
    const holes = fixed.filter((f) => f.item.kind !== "court").map((f) => f.rect);
    const build = (keys) => {
      const rects = keys.map((k) => sides[k]);
      for (const [k, r] of Object.entries(corner)) if (keys.includes(k[0]) && keys.includes(k[1]) && inR(r)) rects.push(r);
      return rects.flatMap((r) => cutAround(r, holes)).flatMap((r) => splitRun(r));
    };
    const sets = [];
    if (ok.length >= 3) sets.push(ok);
    if (ok.length === 4) for (const k of ok) sets.push(ok.filter((x) => x !== k));
    for (const [a, b] of [["n", "e"], ["e", "s"], ["s", "w"], ["w", "n"]]) if (ok.includes(a) && ok.includes(b)) sets.push([a, b]);
    for (const k of ok) sets.push([k]);
    return sets.map((keys) => ({ name: `ring-${keys.join("")}`, fixed: build(keys) })).filter((x) => x.fixed.length);
  }

  /** A storey with several units: the units as blocks round the shared rooms, then each unit inside its block. */
  function storeyByUnits(shell, s, rooms, fixed, blobUnits, exterior, front, frontForWindows, voids, nTrials, tag, usedHere) {
    const rngW = (id) => rngOf(`${seed}:${id}:w`);
    const shared = rooms.filter((r) => !blobUnits.includes(r.unit ?? null));
    const items = shared.map((r) => itemOf(r, prog, rules, rngW(r.id)));
    markHub(items, s, shell);
    constrain([...items, ...fixed.map((f) => f.item)], s, shell);
    for (const u of blobUnits) {
      const ur = rooms.filter((r) => r.unit === u);
      const unit = unitsById.get(u);
      const weight = ur.reduce((a, r) => a + (r.target_m2 / (G * G)) * (1 + rngW(r.id).range(-0.14, 0.14)), 0);
      const minSideG = Math.ceil(Math.max(...ur.map((r) => r.minSide_m)) / G) + 2;
      const minAreaG = (ur.reduce((a, r) => a + r.minArea_m2, 0) * 1.12) / (G * G);
      const street = unit.entry === "street";
      items.push({
        id: u,
        kind: unit.kind === "home" ? "home" : "business",
        unit: u,
        blob: true,
        unitEntry: !street,
        rank: 2,
        weight,
        minSideG,
        minAreaG,
        exterior: true,
        front: street && s === 0,
        street: street && s === 0,
        next: street ? [] : [["corridor", "lobby", "stairwell"]],
        maxAspect: 2.6,
        group: u,
        room: null,
        // a unit's block no larger than its rooms may take under their caps and the walls between them; past it the
        // storey's other rooms take the floor (a soft cap: the unit's own pockets leave the rest spare)
        maxAreaG: ur.every((r) => capG(r)) ? ur.reduce((a, r) => a + capG(r), 0) * 1.1 : null,
        hardCapG: null,
        oneRoom: ur.filter((r) => !r.hidden).length === 1, // its footprint is its room's: a repeat counts (layout.mjs)
        target_m2: ur.reduce((a, r) => a + r.target_m2, 0),
      });
    }
    for (const v of voids) items.push({ id: `${prog.id}.terrace.s${s}`, kind: "terrace", void: true, unit: null, rank: 0, weight: v.area_m2 / (G * G), minSideG: 20, minAreaG: 0, exterior: true, maxAspect: 3, room: null }); // prettier-ignore
    addSlackTerrace(items, s, fixed, shell, voids);
    const zone = baseZone(shell, s, fixed, ordered(items), exterior, front, null, Math.max(60, Math.round(nTrials * 0.8)), `${tag}:A`);
    zone.noL = true;
    zone.hallAt = hallEnds(s, shell);
    // footprints taken: a unit of one room (a bedsit flat) is its room's footprint at this level (layout.mjs)
    zone.used = usedHere;
    zone.shellRect = shell.rect;
    // the best few storey layouts, each finished by laying out its units
    const tops = runStrategies(zone, shell, s, fixed, `${tag}:A`, zone.items.length + 2, null);

    let best = null;
    for (const top of tops.slice(0, 2)) {
      const fin = finishZone(top, s);
      let total = top.score;
      const leaves = fin.leaves.filter((l) => !l.item?.blob);
      const doors = fin.doors.filter((d) => !d.a.item?.blob && !d.b.item?.blob);
      const why = [...top.why];
      const unitUsed = new Map(usedHere ?? []); // flats of one storey kept apart from each other too
      for (const blobLeaf of fin.leaves.filter((l) => l.item?.blob)) {
        const u = blobLeaf.item.unit;
        const unit = unitsById.get(u);
        const ur = rooms.filter((r) => r.unit === u);
        const rect = blobLeaf.rects[0];
        const entryDoor = fin.doors.find((d) => d.a === blobLeaf || d.b === blobLeaf);
        const voidSegs = [];
        for (const l of fin.leaves) {
          const it = l.fixed?.item ?? l.item;
          if (!it?.void || !LIGHT.has(it.kind)) continue; // light only from what is open to the sky
          for (const r of l.rects) voidSegs.push(...segsOfRect(r));
        }
        const ext = [];
        for (const e of segsOfRect(rect)) for (const x of [...exterior, ...voidSegs]) {
          if (x.o !== e.o || x.c !== e.c) continue;
          const a = Math.max(e.a, x.a);
          const b = Math.min(e.b, x.b);
          if (b > a) ext.push({ ...e, a, b });
        }
        let entry = null;
        if (entryDoor && unit.entry !== "street") {
          const need = doorNeed(W.house);
          const seg = entryDoor.seg;
          const pos = placeAlong(seg, need, rngOf(`${seed}:${u}:entry`));
          entry = { o: seg.o, c: seg.c, a: pos - Math.floor(need / 2), b: pos - Math.floor(need / 2) + need, pos };
          entryDoor.pos = pos;
        }
        const unitFront = unit.entry === "street" && s === 0 ? clipFront(rect, front) : null;
        const uitems = ur.map((r) => itemOf(r, prog, rules, rngW(r.id)));
        constrain(uitems, s, shell);
        // the unit's hub: its living room, bedsit or hall at the door; a business's hub on the street
        if (unit.entry === "street") markHub(uitems, s, shell);
        else {
          const hubKind = ["corridor", "living", "bedsit", "kitchen"].find((k) => uitems.some((it) => it.kind === k && !it.hidden));
          const hub = uitems.find((it) => it.kind === hubKind && !it.hidden);
          if (hub) {
            hub.hub = true;
            hub.entry = true;
            hub.unitEntry = true;
          }
        }
        for (const it of uitems) if (it.hidden) for (const h of uitems) if (it.host.includes(h.kind)) h.hiddenHost = true;
        const uz = {
          rect,
          fixed: [],
          items: ordered(uitems),
          front: unitFront,
          exterior: ext.length ? ext : [],
          entry,
          corridor: { allowed: prog.corridor.allowed, widthG: corrWidthG("domestic"), max: 1, p: 0.3, kind: "domestic" },
          corridorUnit: u,
          mainDoor: null,
          entranceOf: (lv) => {
            if (entry) {
              const i = lv.findIndex((l) => l.rects.some((r) => edgesOf(r).some((e) => e.o === entry.o && e.c === entry.c && e.a <= entry.a && e.b >= entry.b)));
              return i >= 0 ? [i] : [];
            }
            return entrancesOf(lv, 0, unitFront);
          },
          doorKind: (a, b) => doorKindOf(a, b),
          doorWidth: (k) => W[k],
          privateThrough,
          noPass,
          maxRunG: Math.floor(rules.circulation.corridor.maxRun / G),
          corridorCapG: corridorCapG(),
          corridorWideG: corridorWideG("domestic"),
          trials: Math.max(80, Math.round(nTrials * 0.7)),
          used: unitUsed,
          shellRect: shell.rect,
          tag: `${tag}:${u}`,
        };
        const ub = searchZone(uz, rngOf(`${seed}:${prog.id}:${tag}:B:${u}`));
        for (const l of ub.leaves) registerShape(unitUsed, l, shell.rect);
        const ufin = finishZone({ ...ub, strategy: "unit" }, s);
        total += ub.score;
        why.push(...ub.why);
        leaves.push(...ufin.leaves);
        doors.push(...ufin.doors);
        // the entry door: from the shared room into the unit room at its position
        if (entryDoor && entry) {
          const shared = entryDoor.a === blobLeaf ? entryDoor.b : entryDoor.a;
          const into = ufin.leaves.find((l) => l.rects.some((r) => edgesOf(r).some((e) => e.o === entry.o && e.c === entry.c && e.a <= entry.a && e.b >= entry.b))); // prettier-ignore
          if (into) doors.push({ a: shared, b: into, seg: entryDoor.seg, kind: "house", pos: entry.pos, entry: u });
        }
      }
      if (!best || total < best.score) best = { leaves, doors, score: total, why, strategy: top.strategy, entrances: fin.entrances };
    }
    return best;
  }

  function clipFront(rect, front) {
    if (!front) return null;
    const e = edgesOf(rect).find((x) => x.o === front.o && x.c === front.c);
    if (!e) return null;
    const a = Math.max(e.a, front.a);
    const b = Math.min(e.b, front.b);
    return b > a ? { ...front, a, b } : null;
  }

  /** Turns a search result's indices into leaf references. */
  function finishZone(best, s) {
    const leaves = best.leaves;
    const doors = best.doors.map((d) => ({ a: leaves[d.i], b: leaves[d.j], seg: d.seg, kind: d.kind }));
    return { leaves, doors, score: best.score, why: best.why, strategy: best.strategy, entrances: best.entrances.map((i) => leaves[i]) };
  }

  function streetKind(it) {
    if (it.blob) return it.kind === "business" ? "shop" : "house";
    if (it.room?.entranceHall) return "house";
    if (it.kind === "loading-bay") return "gate";
    if (["apartment", "msr", "public"].includes(prog.type) && prog.layout !== "columns") return "public";
    if (["manor", "house"].includes(prog.type) || prog.layout === "columns") return "house";
    if (prog.type === "insurgent") return "house";
    return "shop";
  }
  function doorKindOf(a, b) {
    const ks = [a.kind, b.kind];
    if (a.item?.hidden || b.item?.hidden) return "secret";
    if (ks.includes("cell") || ks.includes("holding-cell")) return "cell"; // a lockable leaf, never an opening
    if (ks.includes("stall")) return "opening";
    if (ks.includes("stairwell")) return "opening";
    if (a.kind === "corridor" && b.kind === "corridor") return "opening";
    if (ks.includes("cell") || ks.includes("holding-cell")) return "cell";
    if (a.item?.blob || b.item?.blob) return "house";
    return "interior";
  }

  // ── assemble ──
  const progRoom = new Map(prog.rooms.map((r) => [r.id, r]));
  const rngP = rngOf(`${seed}:${prog.id}:place`);
  const rooms = [];
  const doors = [];
  const windows = [];
  const voidsOut = [];
  const byLeaf = new Map();
  let corridorN = 0;
  const cellM = 3.2512;
  const toM = (r) => ({ x: gToM(r.x), y: gToM(r.y), w: gToM(r.w), d: gToM(r.d) });
  const toCells = (r) => ({ x: round3(prog.lot.rect.x + r.x / 16), y: round3(prog.lot.rect.y + r.y / 16), w: round3(r.w / 16), d: round3(r.d / 16) }); // prettier-ignore
  for (const st of storeys) {
    for (const l of st.leaves) {
      const it = l.fixed?.item ?? l.item;
      if (l.orphan || it?.void) {
        voidsOut.push({ storey: st.storey, kind: l.orphan ? "unused" : it.kind, of: it?.below ?? it?.connector ?? null, rects: l.rects.map(toM), cells: l.rects.map(toCells), g: l.rects, exitSide: it?.exitSide ?? null }); // prettier-ignore
        byLeaf.set(l, { void: true });
        continue;
      }
      let room;
      if (l.corridor || (l.fixed && it.kind === "corridor" && !it.room)) {
        const unit = l.unit ?? it?.unit ?? null;
        room = { id: `${unit ?? prog.id}.s${st.storey}.corridor-${++corridorN}`, kind: "corridor", unit, inserted: true };
      } else {
        const r = it.room;
        room = { id: r.id, kind: r.kind, unit: r.unit ?? null };
        if (r.hidden) Object.assign(room, { hidden: true, secret: r.secret });
        if (r.doubleHeight) room.doubleHeight = true;
        if (r.gate) room.gate = r.gate;
        if (r.entranceHall) room.entranceHall = true;
        if (r.checkpoint) room.checkpoint = r.checkpoint; // stage 4's checkpoint room, planned as the building's
        if (r.post) room.post = r.post; // stage 4's service post, planned as the building's
        if (it.stair !== undefined) room.stair = it.stair;
        if (it.street && st.storey === 0) room.wantsStreet = true;
      }
      const g = l.rects;
      const main = g.reduce((m, r) => (rectArea(r) > rectArea(m) ? r : m), g[0]);
      const clear = clearOf(g, inner, shells);
      const kindR = rules.roomKinds[room.kind];
      const cls = kindR?.ceiling ?? "room";
      let height = HEIGHT[cls] ?? clearH;
      if (room.doubleHeight) height = round3(clearH + storeyH);
      if (room.kind === "garden") height = round3(clearH);
      Object.assign(room, {
        storey: st.storey,
        rects: g.map(toM),
        cells: g.map(toCells),
        clear: clear.map((c) => ({ x: round4(c.x), y: round4(c.y), w: round4(c.w), d: round4(c.d) })),
        area_m2: round2(clear.reduce((s, c) => s + c.w * c.d, 0)),
        narrow_m: round3(Math.min(...clear.map((c) => Math.min(c.w, c.d)).slice(0, 1).concat([Math.min(clearOf([main], inner, shells)[0].w, clearOf([main], inner, shells)[0].d)]))), // prettier-ignore
        height_m: Math.min(height, room.doubleHeight || room.kind === "garden" ? 99 : clearH),
        g,
      });
      if (room.kind === "garden") room.open = true;
      rooms.push(room);
      byLeaf.set(l, room);
    }
  }
  // a leftover piece with nothing built over it on any storey above is a terrace (a loggia on the roof below)
  for (const v of voidsOut.filter((x) => x.kind === "unused")) {
    const open = v.g.every((q) => {
      for (let s = v.storey + 1; s < prog.storeys; s++) {
        const covered = rooms.some((r) => r.storey === s && r.g.some((p) => overlaps(p, q)));
        if (covered) return false;
      }
      return true;
    });
    // a terrace has an edge open to the drop (its parapet's); one closed by rooms all round stays unbuilt inside
    if (open && v.storey > 0 && openEdge(v)) v.kind = "terrace";
  }
  function openEdge(v) {
    for (const q of v.g)
      for (const e of edgesOf(q)) {
        let pieces = [[e.a, e.b]];
        for (const r of rooms.filter((x) => x.storey === v.storey))
          for (const p of r.g)
            for (const s2 of edgesOf(p))
              if (s2.o === e.o && s2.c === e.c) pieces = pieces.flatMap(([a, b]) => (s2.b <= a || s2.a >= b ? [[a, b]] : [[a, Math.max(a, s2.a)], [Math.min(b, s2.b), b]])); // prettier-ignore
        if (pieces.some(([a, b]) => b - a >= 1)) return true;
      }
    return false;
  }
  // doors: the zones' choices placed on their walls
  const placed = [];
  for (const st of storeys)
    for (const d of st.doors) {
      const ra = byLeaf.get(d.a);
      const rb = byLeaf.get(d.b);
      if (!ra || !rb || ra.void || rb.void) continue;
      const width = W[d.kind];
      const need = doorNeed(width);
      const pos = d.pos ?? placeAlong(d.seg, need, rngP, placed.filter((p) => p.storey === st.storey), stairsOut);
      const door = makeDoor({ a: ra, b: rb, seg: d.seg, kind: d.kind, pos, storey: st.storey });
      placed.push(door);
      doors.push(door);
    }
  // street doors: each entrance room on the front, the main one where stage 2 put it
  const roomsAt0 = rooms.filter((r) => r.storey === 0);
  for (const shell of shells) {
    const fs = frontSeg(shell.rect, shell.front);
    const inShell = roomsAt0.filter((r) => r.g.every((q) => q.x >= shell.rect.x && q.y >= shell.rect.y && q.x + q.w <= shell.rect.x + shell.rect.w && q.y + q.d <= shell.rect.y + shell.rect.d)); // prettier-ignore
    const wantStreet = inShell.filter((r) => streetRoom(r)).sort((a, b) => (HUB_ORDER.indexOf(a.kind) + 99) % 99 - (HUB_ORDER.indexOf(b.kind) + 99) % 99);
    for (const r of wantStreet) {
      const kind = streetKindOf(r);
      const width = W[kind];
      const need = doorNeed(width);
      let seg = longestTouch(r.g, fs);
      if ((!seg || seg.b - seg.a < need) && progRoom.get(r.id)?.needs?.anyOutsideWall)
        seg = openSegs(shell.rect).map((e) => longestTouch(r.g, e)).filter(Boolean).sort((a, b) => b.b - b.a - (a.b - a.a))[0] ?? null;
      if (!seg || seg.b - seg.a < need) continue;
      const main = r.id === wantStreet[0]?.id;
      let pos;
      if (main && doorAtG >= seg.a + need / 2 && doorAtG <= seg.b - need / 2) pos = doorAtG;
      else pos = placeAlong(seg, need, rngP, placed.filter((p) => p.storey === 0), stairsOut, !DISPLAY.has(r.kind)); // a shop's door to one side of its window
      const door = makeDoor({ a: null, b: r, seg, kind, pos, storey: 0, street: true });
      placed.push(door);
      doors.push(door);
    }
    // gates to the MSR's hallways: at the end of the hallway stage 4 routed, else on the side facing its far node
    const inShellAny = rooms.filter((r) => r.g.every((q) => q.x >= shell.rect.x && q.y >= shell.rect.y && q.x + q.w <= shell.rect.x + shell.rect.w && q.y + q.d <= shell.rect.y + shell.rect.d)); // prettier-ignore
    for (const r of inShellAny.filter((x) => x.gate)) {
      const need = doorNeed(W.gate);
      let seg = null;
      let pos;
      if (r.gate.at !== undefined && r.gate.at !== null) {
        seg = longestTouch(r.g, edgesOf(shell.rect).find((e) => e.side === r.gate.side));
        if (seg && seg.b - seg.a >= need) pos = Math.max(seg.a + need / 2, Math.min(seg.b - need / 2, Math.round(r.gate.at * 16)));
        else seg = null;
      }
      if (!seg) {
        // on its hallway's side where it touches it, else on the outside wall it has
        const sides = edgesOf(shell.rect).sort((a, b) => (b.side === r.gate.side) - (a.side === r.gate.side));
        seg = sides.map((e) => longestTouch(r.g, e)).find((x) => x && x.b - x.a >= need) ?? null;
        if (!seg) continue;
        pos = placeAlong(seg, need, rngP, placed.filter((p) => p.storey === r.storey), stairsOut);
      }
      const door = makeDoor({ a: null, b: r, seg, kind: "gate", pos, storey: r.storey, passage: r.gate.passage });
      if (r.gate.hallway) door.hallway = r.gate.hallway;
      placed.push(door);
      doors.push(door);
    }
    // the other hallways ending at the building: a door from the hallway into the room at its end
    for (const h of (prog.hallways ?? []).filter((x) => !x.gate)) {
      const e = edgesOf(shell.rect).find((x) => x.side === h.side);
      const want = Math.round(h.at * 16);
      if (want < e.a - 8 || want > e.b + 8) continue;
      const need = doorNeed(W.gate);
      let best = null;
      for (const room of inShellAny.filter((x) => x.storey === h.storey && !x.hidden)) {
        const seg = longestTouch(room.g, e);
        if (!seg || seg.b - seg.a < need) continue;
        const off = Math.max(0, seg.a + need / 2 - want, want - (seg.b - need / 2));
        if (!best || off < best.off) best = { room, seg, off };
      }
      if (!best || best.off > 16) {
        decisions.push({ rule: "hallway", what: `no room on the ${h.side} wall at ${h.at} cells for hallway ${h.hallway}'s door on storey ${h.storey}` }); // prettier-ignore
        continue;
      }
      const pos = Math.max(best.seg.a + need / 2, Math.min(best.seg.b - need / 2, want));
      const door = makeDoor({ a: null, b: best.room, seg: best.seg, kind: "gate", pos, storey: h.storey, passage: h.to });
      door.hallway = h.hallway;
      placed.push(door);
      doors.push(door);
    }
    // a checkpoint's guard post folded into the building: its own door on the outside wall facing its gate, clear of
    // the doors already in that wall
    for (const r of inShell.filter((x) => progRoom.get(x.id)?.checkpoint && x.kind === "guard-post")) {
      const need = doorNeed(W.public);
      const to = progRoom.get(r.id).towards;
      const toG = to ? [(to[0] - prog.lot.rect.x) * 16, (to[1] - prog.lot.rect.y) * 16] : null;
      const facing = (e) => (!toG ? 0 : e.side === "w" ? e.c - toG[0] : e.side === "e" ? toG[0] - e.c : e.side === "s" ? e.c - toG[1] : toG[1] - e.c); // prettier-ignore
      const here = placed.filter((p) => p.storey === r.storey);
      const free = (seg) => {
        // the stretch of the wall left between the doors already in it
        let pieces = [[seg.a, seg.b]];
        for (const p of here.filter((x) => x.o === seg.o && x.c === seg.c)) {
          const h = (p.width / 2 + 0.3) / G + 1;
          pieces = pieces.flatMap(([a, b]) => (p.posG + h <= a || p.posG - h >= b ? [[a, b]] : [[a, p.posG - h], [p.posG + h, b]]));
        }
        return pieces.map(([a, b]) => ({ ...seg, a: Math.ceil(a), b: Math.floor(b) })).filter((x) => x.b - x.a >= need);
      };
      const segs = openSegs(shell.rect).filter(onLotLine).flatMap((e) => { const t = longestTouch(r.g, e); return t ? free(t).map((x) => ({ ...x, side: e.side })) : []; }); // prettier-ignore
      segs.sort((a, b) => facing(b) - facing(a) || b.b - b.a - (a.b - a.a));
      const seg = segs[0];
      if (!seg) continue;
      const pos = placeAlong(seg, need, rngP, here, stairsOut, true);
      const door = makeDoor({ a: null, b: r, seg, kind: "public", pos, storey: r.storey, street: true });
      placed.push(door);
      doors.push(door);
    }
  }
  // doors onto the connectors that stop here: from the room against the well's or shaft's exit side
  const reservedOut = [];
  for (const r of resG) {
    const item = { connector: r.connector, kind: r.kind, rect_m: toM(r.g), cells: r.rect, storeys: r.on, exits: [] };
    for (const ex of r.exits) {
      const e = edgesOf(r.g).find((x) => x.side === ex.side);
      let best = null;
      // a connector opens into its lift lobby, else circulation or a public or staff room; never a cell, a private
      // room, a hidden one or a room nobody passes through (circulation.noPassThrough)
      const takes = (room) => {
        if (room.hidden) return -1;
        const pr = progRoom.get(room.id);
        if (pr?.lift && r.connector.split("+").some((k) => pr.lift.connectors.includes(k))) return 3;
        if (room.kind === "lift-lobby") return 2;
        const rank = rules.zones[rules.roomKinds[room.kind]?.zone]?.rank ?? 0;
        if (rank >= rules.zones.privateFrom || noPass.has(room.kind)) return -1;
        return rules.roomKinds[room.kind]?.zone === "circulation" ? 1 : 0;
      };
      for (const room of rooms.filter((x) => x.storey === ex.storey)) {
        const seg = longestTouch(room.g, e);
        const t = takes(room);
        if (!seg || t < 0 || seg.b - seg.a < doorNeed(r.kind === "shaft" ? W.lift : 1.63)) continue;
        if (!best || t > best.t || (t === best.t && seg.b - seg.a > best.seg.b - best.seg.a)) best = { room, seg, t };
      }
      const kind = r.kind === "shaft" ? "lift" : "opening";
      if (!best || best.seg.b - best.seg.a < doorNeed(W[kind] ?? 1.63)) {
        item.exits.push({ storey: ex.storey, side: ex.side, door: null });
        continue;
      }
      const pos = Math.round((best.seg.a + best.seg.b) / 2);
      const door = makeDoor({ a: null, b: best.room, seg: best.seg, kind, pos, storey: ex.storey, connector: r.connector });
      door.from = `connector ${r.connector}`;
      placed.push(door);
      doors.push(door);
      item.exits.push({ storey: ex.storey, side: ex.side, door: door.id, room: best.room.id });
    }
    reservedOut.push(item);
  }
  // names: each property door by the description's pattern; secret doors by the secret's id; the rest unnamed
  const nameCount = new Map();
  const nameOf = (base) => {
    const n = (nameCount.get(base) ?? 0) + 1;
    nameCount.set(base, n);
    return n === 1 ? base : `${base}_${String.fromCharCode(96 + n)}`; // a property's second door: _b, _c
  };
  for (const d of doors) {
    const into = d.to ? rooms.find((r) => r.id === d.to) : null;
    const pr = into ? progRoom.get(into.id) : null;
    if (pr?.door && (pr.kind === "cell" || pr.kind === "holding-cell" || pr.hidden)) d.name = nameOf(pr.door);
  }
  for (const u of prog.units) {
    // the unit's front doors: from the street, or its entry from shared circulation
    const own = doors.filter((d) => {
      const into = d.to ? rooms.find((r) => r.id === d.to) : null;
      if (!into || into.unit !== u.id) return false;
      const from = d.from ? rooms.find((r) => r.id === d.from) : null;
      return d.street || (from && from.unit !== u.id) || (d.passage && u.kind !== "home");
    });
    own.sort((a, b) => (b.street ? 1 : 0) - (a.street ? 1 : 0) || cmp(a.id, b.id));
    for (const d of own) if (!d.name) d.name = nameOf(u.door);
  }
  // stairs: flights in each stairwell, storey to storey
  const stairs = [];
  for (const so of stairsOut) {
    const st = so.st;
    for (let s = 0; s + 1 < prog.storeys; s++) {
      const lower = rooms.find((r) => r.kind === "stairwell" && r.storey === s && r.id.startsWith(`${so.id}.s`));
      const upper = rooms.find((r) => r.kind === "stairwell" && r.storey === s + 1 && r.id.startsWith(`${so.id}.s`));
      if (!lower || !upper) continue;
      stairs.push(makeStair(so, st, s, lower, upper));
    }
  }
  // doors moved along their wall until their keep-clear boxes are clear of walls, flights and other leaves
  {
    const H0 = clearH;
    for (let pass = 0; pass < 2; pass++) {
      const walls0 = wallsOf(rooms, voidsOut, shells, Wg, Dg, prog.storeys, doors, []);
      for (const d of doors) {
        const pieces = wallPieces(walls0, rooms, d.storey, H0).filter((p) => !(p.o === d.o && Math.abs(p.c - d.c * G) < 1e-6));
        const flights = stairBoxes(stairs.filter((x) => x.storey === d.storey), rules);
        const others = doors.filter((x) => x !== d && x.storey === d.storey);
        if (doorClear(d, pieces, flights, others, rules, H0)) continue;
        const need = doorNeed(d.width);
        const lo = Math.ceil(2 * (d.segA + 0.5 + (d.width / 2 + 0.3) / G)) / 2;
        const hi = Math.floor(2 * (d.segB - 0.5 - (d.width / 2 + 0.3) / G)) / 2;
        const keep = d.posG;
        let found = false;
        const order = [];
        for (let p = lo; p <= hi; p += 0.5) order.push(p);
        order.sort((a, b) => Math.abs(a - keep) - Math.abs(b - keep));
        for (const p of order) {
          moveDoor(d, p);
          if (doorClear(d, pieces, flights, others, rules, H0)) {
            found = true;
            break;
          }
        }
        if (!found) moveDoor(d, keep);
      }
    }
  }
  // windows on outside and court walls
  const voidG = voidsOut.filter((v) => !["open-to-below", "shaft", "well", "column", "unused"].includes(v.kind)).map((v) => ({ storey: v.storey, g: v.g }));
  for (const r of rooms) {
    const k = rules.roomKinds[r.kind];
    if (!k || r.hidden || rules.roomNeeds.noWindow.includes(r.kind)) continue;
    const segs = [];
    const shell = shells.find((sh) => r.g.every((q) => q.x >= sh.rect.x && q.y >= sh.rect.y && q.x + q.w <= sh.rect.x + sh.rect.w && q.y + q.d <= sh.rect.y + sh.rect.d)); // prettier-ignore
    if (!shell) continue;
    for (const q of r.g)
      for (const e of edgesOf(q)) {
        for (const x of openSegs(shell.rect)) {
          if (x.o !== e.o || x.c !== e.c) continue;
          const a = Math.max(e.a, x.a);
          const b = Math.min(e.b, x.b);
          if (b > a) segs.push({ ...e, a, b, street: x.side === shell.front, outside: true });
        }
        for (const v of voidG.filter((v) => v.storey === r.storey))
          for (const vr of v.g)
            for (const x of edgesOf(vr)) {
              if (x.o !== e.o || x.c !== e.c) continue;
              const a = Math.max(e.a, x.a);
              const b = Math.min(e.b, x.b);
              if (b > a) segs.push({ ...e, a, b, street: false, court: true });
            }
      }
    const display = DISPLAY.has(r.kind) && r.storey === 0;
    const wW = r.kind === "toilet" ? 0.6 : display ? 2.4 : rules.dimensions.windows.width.typical;
    const sill = display ? rules.dimensions.windows.shopSill.typical : rules.dimensions.windows.sill.typical;
    const head = Math.min(rules.dimensions.windows.head.typical, r.height_m - rules.dimensions.windows.headBelowCeiling.min);
    for (const sg of segs) {
      const lenM = (sg.b - sg.a - 1) * G;
      const n = Math.max(lenM >= wW + 0.6 ? 1 : 0, Math.floor((lenM - 0.4) / (wW + 1.6)));
      if (n < 1) continue;
      const lo = sg.a + 0.5 + (wW / 2 + 0.3) / G;
      const hi = sg.b - 0.5 - (wW / 2 + 0.3) / G;
      const taken = [];
      for (let i = 0; i < n; i++) {
        const ideal = sg.a + 0.5 + ((i + 0.5) * (sg.b - sg.a - 1)) / n;
        const clashAt = (p) => doors.some((d) => d.storey === r.storey && d.o === sg.o && Math.abs(d.c - sg.c) < 0.01 && Math.abs(d.posG - p) * G < d.width / 2 + wW / 2 + 0.3) || taken.some((t) => Math.abs(t - p) * G < wW + 0.4); // prettier-ignore
        let posG = null;
        for (let k = 0; k <= 40 && posG === null; k++)
          for (const p of [ideal + k, ideal - k]) if (p >= lo && p <= hi && !clashAt(p)) { posG = p; break; } // prettier-ignore
        if (posG === null) continue;
        taken.push(posG);
        windows.push(makeWindow(r, sg, posG, wW, sill, head));
      }
    }
    r.exterior = windows.some((w) => w.room === r.id);
  }
  // parapets: every edge of a terrace not against a room of its storey (the guard round a walked roof)
  const parapets = [];
  const P = rules.dimensions.parapets ?? { height: { typical: 1.3 }, thickness: { typical: 0.2 } };
  for (const v of voidsOut.filter((x) => x.kind === "terrace")) {
    for (const q of v.g)
      for (const e of edgesOf(q)) {
        let pieces = [[e.a, e.b]];
        for (const r of rooms.filter((x) => x.storey === v.storey))
          for (const p of r.g)
            for (const s2 of edgesOf(p))
              if (s2.o === e.o && s2.c === e.c) pieces = pieces.flatMap(([a, b]) => (s2.b <= a || s2.a >= b ? [[a, b]] : [[a, Math.max(a, s2.a)], [Math.min(b, s2.b), b]])); // prettier-ignore
        for (const [a, b] of pieces) {
          if (b - a < 1) continue;
          const A = e.o === "v" ? [e.c, a] : [a, e.c];
          const B = e.o === "v" ? [e.c, b] : [b, e.c];
          parapets.push({ storey: v.storey, of: `terrace ${voidsOut.indexOf(v) + 1}`, a: [gToM(A[0]), gToM(A[1])], b: [gToM(B[0]), gToM(B[1])], height_m: P.height.typical, thickness_m: P.thickness.typical }); // prettier-ignore
        }
      }
    v.parapet = true;
  }
  // units
  const unitsOut = prog.units.map((u) => ({ id: u.id, kind: u.kind, class: u.class ?? null, door: u.door, rooms: rooms.filter((r) => r.unit === u.id).map((r) => r.id) }));
  const shared = rooms.filter((r) => !r.unit).map((r) => r.id);
  // walls
  const walls = wallsOf(rooms, voidsOut, shells, Wg, Dg, prog.storeys, doors, windows);
  const storeyOut = storeys.map((st) => ({ storey: st.storey, z_m: round3(prog.lot.zBase * cellM + st.storey * storeyH), score: round2(st.score), strategy: null, why: st.why.slice(0, 12) })); // prettier-ignore
  for (const r of rooms) delete r.g;
  for (const r of rooms) delete r.wantsStreet;
  for (const d of doors) {
    delete d.posG;
    delete d.o;
    delete d.c;
    delete d.segA;
    delete d.segB;
    if (!d.street) delete d.street;
    if (!d.passage) delete d.passage;
  }
  for (const v of voidsOut) delete v.g;
  const plan = {
    id: prog.id,
    type: prog.type,
    variant: prog.variant,
    layer: prog.layer,
    lot: prog.lot,
    frame: { origin_cells: [prog.lot.rect.x, prog.lot.rect.y], size_m: [gToM(Wg), gToM(Dg)], exteriorWall_m: gToM(TE), interiorWall_m: gToM(TI), storeyHeight_m: storeyH, slab_m: round3(SLAB), clearHeight_m: clearH, front: side }, // prettier-ignore
    storeys: storeyOut,
    shells: shells.map((s) => ({ id: s.id, rect: toM(s.rect), front: s.front })),
    court: courtOut ? toM(courtOut) : null,
    reserved: reservedOut,
    rooms,
    voids: voidsOut,
    units: unitsOut,
    shared,
    doors,
    windows,
    stairs,
    walls,
    parapets,
    decisions,
  };
  plan.signature = sha256(canonical(rooms.map((r) => [r.kind, r.storey, r.rects])));
  for (const r of rooms) registerShape(used, { item: { kind: r.kind }, rects: [], clearKey: footKey(r, G) }, null);
  return plan;

  // ── helpers that need the building ──
  function streetRoom(r) {
    return Boolean(r.wantsStreet);
  }
  function hubId(list) {
    const entr = prog.layout === "columns" && prog.type === "apartment" ? ["corridor"] : prog.entrance;
    const units = new Set(list.map((r) => r.unit));
    // one hub per unit with a street entry (a business in a mixed block, each column home)
    for (const k of HUB_ORDER) {
      const r = list.find((x) => x.kind === k && entr.includes(k) && !x.hidden && (prog.layout === "columns" || !x.unit || unitsById.get(x.unit)?.entry === "street")); // prettier-ignore
      if (r) return r.id;
    }
    for (const k of HUB_ORDER) {
      const r = list.find((x) => x.kind === k && !x.hidden);
      if (r) return r.id;
    }
    return units.size ? null : null;
  }
  function streetKindOf(r) {
    if (progRoom.get(r.id)?.entranceHall) return "house";
    if (r.kind === "loading-bay") return "gate";
    if (prog.layout === "columns" || ["manor", "house", "insurgent"].includes(prog.type)) return "house";
    if (["apartment", "msr", "public"].includes(prog.type)) return "public";
    return "shop";
  }
  function makeDoor({ a, b, seg, kind, pos, storey, street = false, passage = null, connector = null }) {
    const width = W[kind];
    const height = DOOR_HEIGHT(rules, kind);
    // which room the leaf swings into: the room entered, unless it is too shallow or a cell (cell doors open out)
    let into = b;
    if (a && (b.kind === "corridor" || b.kind === "stairwell" || ["cell", "holding-cell"].includes(b.kind))) into = a;
    if (a && into === a && ["corridor", "stairwell"].includes(a.kind) && !["cell", "holding-cell"].includes(b.kind)) into = b;
    const sideOf = (room) => {
      // +1 when the room lies on the positive side of the line
      const q = room.g.find((r) => edgesOf(r).some((e) => e.o === seg.o && e.c === seg.c && e.a <= pos && e.b >= pos)) ?? room.g[0];
      return seg.o === "v" ? (q.x >= seg.c ? 1 : -1) : q.y >= seg.c ? 1 : -1;
    };
    const sgn = into ? sideOf(into) : -sideOf(b);
    const facing = seg.o === "v" ? [sgn, 0] : [0, sgn];
    const atG = seg.o === "v" ? [seg.c, pos] : [pos, seg.c];
    const swing = kind === "opening" || kind === "gate" || kind === "lift" ? "none" : "front";
    const hingeLow = pos - seg.a <= seg.b - pos;
    const wall = connector ? gToM(TI) : street || passage || !a ? gToM(TE) : gToM(TI);
    const door = {
      id: `${b.id}.door${doors.filter((d) => d.to === b.id).length + 1}`,
      name: null,
      kind,
      storey,
      from: a ? a.id : street ? "street" : passage ? "passage" : "outside",
      to: b.id,
      at: [round4(atG[0] * G), round4(atG[1] * G)],
      cells: [round3(prog.lot.rect.x + atG[0] / 16), round3(prog.lot.rect.y + atG[1] / 16)],
      facing,
      swing,
      swingInto: swing === "none" ? null : (into ?? b).id,
      hinge: swing === "none" ? null : hingeLow ? "low" : "high",
      width: round3(width),
      height: round3(height),
      wall,
      posG: pos,
      o: seg.o,
      c: seg.c,
      segA: seg.a,
      segB: seg.b,
      street,
      passage,
    };
    if (street) door.street = true;
    if (passage) door.passage = passage;
    // a door whose leaf would swing out over the street opens inward
    if (street) {
      door.facing = seg.o === "v" ? [sideOf(b), 0] : [0, sideOf(b)];
      door.swingInto = b.id;
    }
    // the outward edge for the exterior wall: the hole sits on the inner face; centre it in the wall
    if (street || passage) {
      const n = door.facing;
      door.at = [round4(door.at[0] - (n[0] * gToM(TE)) / 2), round4(door.at[1] - (n[1] * gToM(TE)) / 2)];
    }
    return door;
  }
  function makeWindow(r, sg, posG, width, sill, head) {
    const atG = sg.o === "v" ? [sg.c, posG] : [posG, sg.c];
    const inward = sg.o === "v" ? (r.g.some((q) => q.x >= sg.c && edgesOf(q).some((e) => e.o === "v" && e.c === sg.c)) ? 1 : -1) : r.g.some((q) => q.y >= sg.c && edgesOf(q).some((e) => e.o === "h" && e.c === sg.c)) ? 1 : -1; // prettier-ignore
    const facing = sg.o === "v" ? [inward, 0] : [0, inward];
    const wall = sg.outside ? gToM(TE) : gToM(TI);
    const at = sg.outside ? [round3(atG[0] * G - (facing[0] * wall) / 2), round3(atG[1] * G - (facing[1] * wall) / 2)] : [round3(atG[0] * G), round3(atG[1] * G)];
    return { room: r.id, storey: r.storey, at, facing, width: round3(width), sill: round3(sill), head: round3(head), wall, street: Boolean(sg.street), court: Boolean(sg.court) }; // prettier-ignore
  }
  function makeStair(so, st, s, lower, upper) {
    const S = prog.stair;
    const r = st.rect;
    // the clear stairwell (half a wall in on every side)
    const c = { x: (r.x + 0.5) * G, y: (r.y + 0.5) * G, w: (r.w - 1) * G, d: (r.d - 1) * G };
    const width = S.width;
    const along = st.longX ? [1, 0] : [0, 1];
    const dir = st.entryLow ? 1 : -1; // up the first flight
    const L = st.longX ? c.w : c.d;
    const start = st.entryLow ? (st.longX ? c.x : c.y) + S.entryLanding : (st.longX ? c.x + c.w : c.y + c.d) - S.entryLanding;
    const crossLo = st.longX ? c.y : c.x;
    const crossHi = st.longX ? c.y + c.d : c.x + c.w;
    const aMid = crossLo + width / 2;
    const bMid = crossHi - width / 2;
    const z0 = round4(prog.lot.zBase * cellM + s * storeyH);
    const rise1 = S.perFlight * S.rise;
    const rise2 = (S.risers - S.perFlight) * S.rise;
    const run1 = S.flightRun;
    const run2 = round4((S.risers - S.perFlight - 1) * S.run);
    const far = start + dir * run1;
    const pt = (u, v) => (st.longX ? [round4(u), round4(v)] : [round4(v), round4(u)]);
    const facing1 = st.longX ? [dir, 0] : [0, dir];
    const facing2 = st.longX ? [-dir, 0] : [0, -dir];
    const halfAt = far + (dir * S.halfLanding) / 2;
    const flights = [
      { at: pt(start, aMid), facing: facing1, width, run: run1, rise: round4(rise1), risers: S.perFlight, z: 0 },
      { at: pt(far, bMid), facing: facing2, width, run: run2, rise: round4(rise2), risers: S.risers - S.perFlight, z: round4(rise1) },
    ];
    const landing = { at: pt(halfAt, (crossLo + crossHi) / 2), size: st.longX ? [S.halfLanding, round4(crossHi - crossLo)] : [round4(crossHi - crossLo), S.halfLanding], z: round4(rise1) }; // prettier-ignore
    void L;
    void along;
    return {
      id: `${so.id}.s${s}`,
      kind: S.kind,
      from: lower.id,
      to: upper.id,
      storey: s,
      z_m: z0,
      rise: S.rise,
      run: S.run,
      risers: S.risers,
      width,
      landing: S.halfLanding,
      entryLanding: S.entryLanding,
      headroom: round4(storeyH - SLAB),
      flights,
      halfLanding: landing,
    };
  }
}

/** A position (grid steps, along the segment) for a door needing `need` steps: near a corner where it fits, clear of stairs and other doors' swings. */
function placeAlong(seg, need, rng, others = [], stairs = [], centre = false) {
  const lo = seg.a + need / 2;
  const hi = seg.b - need / 2;
  if (hi < lo) return Math.round((seg.a + seg.b) / 2);
  const cands = centre ? [Math.round((lo + hi) / 2), Math.ceil(lo), Math.floor(hi)] : rng.chance(0.5) ? [Math.ceil(lo), Math.floor(hi), Math.round((lo + hi) / 2)] : [Math.floor(hi), Math.ceil(lo), Math.round((lo + hi) / 2)]; // prettier-ignore
  for (const p of cands) {
    const clash = others.some((d) => d.o === seg.o && d.c === seg.c && Math.abs(d.posG - p) * G < d.width / 2 + 0.3 + (need * G) / 2);
    const near = others.some((d) => d.o !== seg.o && Math.hypot((seg.o === "v" ? seg.c : p) - (d.o === "v" ? d.c : d.posG), (seg.o === "v" ? p : seg.c) - (d.o === "v" ? d.posG : d.c)) * G < 1.4); // prettier-ignore
    if (!clash && !near) return p;
  }
  return cands[0];
}

const touch = (rects, seg) => {
  let best = 0;
  for (const r of rects)
    for (const e of edgesOf(r)) {
      if (e.o !== seg.o || e.c !== seg.c) continue;
      best = Math.max(best, Math.min(e.b, seg.b) - Math.max(e.a, seg.a));
    }
  return best;
};
const longestTouch = (rects, seg) => {
  let best = null;
  if (!seg) return null;
  for (const r of rects)
    for (const e of edgesOf(r)) {
      if (e.o !== seg.o || e.c !== seg.c) continue;
      const a = Math.max(e.a, seg.a);
      const b = Math.min(e.b, seg.b);
      if (b > a && (!best || b - a > best.b - best.a)) best = { o: e.o, c: e.c, a, b };
    }
  return best;
};

/** A room's clear rectangles (metres): its partition rectangles less half an interior wall where they meet another room. */
function clearOf(g, inner, shells) {
  return g.map((r) => {
    const onShell = (side) => shells.some((s) => edgesOf(s.rect).some((e) => e.side === side && edgesOf(r).some((x) => x.side === side && x.o === e.o && x.c === e.c && x.a >= e.a && x.b <= e.b))); // prettier-ignore
    const h = TI / 2;
    const x0 = r.x + (onShell("w") ? 0 : h);
    const x1 = r.x + r.w - (onShell("e") ? 0 : h);
    const y0 = r.y + (onShell("s") ? 0 : h);
    const y1 = r.y + r.d - (onShell("n") ? 0 : h);
    return { x: x0 * G, y: y0 * G, w: (x1 - x0) * G, d: (y1 - y0) * G };
  });
}

/**
 * Walls per storey from a raster of the plan grid: every line between two cells of different rooms (interior,
 * centred on it), a room and a void (court), a room and the shell's wall band (exterior, outside the room's face);
 * collinear runs merged. Holes: the doors' and windows' openings on them.
 */
function wallsOf(rooms, voids, shells, Wg, Dg, nStoreys, doors, windows) {
  const out = [];
  for (let s = 0; s < nStoreys; s++) {
    const lab = new Int32Array(Wg * Dg).fill(-1); // -1 outside (street, yard)
    for (const sh of shells) {
      const r = sh.rect;
      for (let y = Math.max(0, r.y - TE); y < Math.min(Dg, r.y + r.d + TE); y++)
        for (let x = Math.max(0, r.x - TE); x < Math.min(Wg, r.x + r.w + TE); x++) lab[y * Wg + x] = -2; // wall band
      for (let y = r.y; y < r.y + r.d; y++) for (let x = r.x; x < r.x + r.w; x++) lab[y * Wg + x] = -3; // void until a room claims it
    }
    const list = rooms.filter((r) => r.storey === s);
    list.forEach((room, i) => {
      for (const q of room.g) for (let y = q.y; y < q.y + q.d; y++) for (let x = q.x; x < q.x + q.w; x++) lab[y * Wg + x] = i;
    });
    const kindOf = (a, b) => (a >= 0 && b >= 0 ? "interior" : a === -2 || b === -2 ? "exterior" : "court");
    const runs = new Map();
    const push = (o, c, t, a, b) => {
      if (a === b || (a < 0 && b < 0)) return;
      const key = `${o}|${c}|${Math.min(a, b)}|${Math.max(a, b)}`;
      if (!runs.has(key)) runs.set(key, []);
      runs.get(key).push(t);
    };
    for (let y = 0; y < Dg; y++)
      for (let x = 1; x < Wg; x++) push("v", x, y, lab[y * Wg + x - 1], lab[y * Wg + x]);
    for (let y = 1; y < Dg; y++)
      for (let x = 0; x < Wg; x++) push("h", y, x, lab[(y - 1) * Wg + x], lab[y * Wg + x]);
    for (const [key, ts] of runs) {
      const [o, cS, aS, bS] = key.split("|");
      const c = Number(cS);
      const a = Number(aS);
      const b = Number(bS);
      ts.sort((p, q) => p - q);
      let start = ts[0];
      let prev = ts[0];
      const flush = (from, to) => {
        const kind = kindOf(a, b);
        const t = kind === "interior" ? TI : kind === "exterior" ? TE : TI;
        const roomA = a >= 0 ? list[a].id : null;
        const roomB = b >= 0 ? list[b].id : null;
        // an exterior wall stands outside the room's face: offset the line by half its thickness away from the room
        let line = c;
        if (kind === "exterior") {
          const roomOnLow = a >= 0; // the room's cells are before the line (a is the lower cell in the key order? check below)
          void roomOnLow;
        }
        out.push({ storey: s, o, c: line, from, to, kind, thickness_m: gToM(t), rooms: [roomA, roomB].filter(Boolean) });
      };
      for (let k = 1; k < ts.length; k++) {
        if (ts[k] !== prev + 1) {
          flush(start, prev + 1);
          start = ts[k];
        }
        prev = ts[k];
      }
      flush(start, prev + 1);
    }
  }
  // metres, with holes
  return out.map((w) => {
    const a = w.o === "v" ? [w.c, w.from] : [w.from, w.c];
    const b = w.o === "v" ? [w.c, w.to] : [w.to, w.c];
    const holes = [];
    for (const d of doors) if (d.storey === w.storey && d.o === w.o && d.c === w.c && d.posG >= w.from && d.posG <= w.to) holes.push({ kind: "door", door: d.id, along_m: round3((d.posG - w.from) * G), width: d.width, height: d.height }); // prettier-ignore
    for (const x of windows) {
      if (x.storey !== w.storey) continue;
      const lineC = w.o === "v" ? x.at[0] : x.at[1];
      const along = w.o === "v" ? x.at[1] : x.at[0];
      const lineM = w.c * G;
      if (Math.abs(lineC - lineM) > gToM(TE) / 2 + 1e-6) continue;
      if (along < w.from * G - 1e-6 || along > w.to * G + 1e-6) continue;
      holes.push({ kind: "window", along_m: round3(along - w.from * G), width: x.width, sill: x.sill, head: x.head });
    }
    return { storey: w.storey, a: [gToM(a[0]), gToM(a[1])], b: [gToM(b[0]), gToM(b[1])], kind: w.kind, thickness_m: w.thickness_m, rooms: w.rooms, holes }; // prettier-ignore
  });
}


/** Moves a door to another place along its wall (grid steps). */
function moveDoor(d, p) {
  const dp = p - d.posG;
  d.posG = p;
  if (d.o === "v") d.at = [d.at[0], round4(d.at[1] + dp * G)];
  else d.at = [round4(d.at[0] + dp * G), d.at[1]];
  d.cells = [round3(d.cells[0] + (d.o === "v" ? 0 : dp / 16)), round3(d.cells[1] + (d.o === "v" ? dp / 16 : 0))];
  d.hinge = d.swing === "none" ? null : p - d.segA <= d.segB - p ? "low" : "high";
}
/** Wall pieces of a storey (door holes cut) as boxes, metres, each with its line. */
function wallPieces(walls, rooms, storey, H) {
  const pieces = [];
  for (const w of walls.filter((x) => x.storey === storey)) {
    const vertical = w.a[0] === w.b[0];
    const len = vertical ? w.b[1] - w.a[1] : w.b[0] - w.a[0];
    const holes = w.holes.filter((h) => h.kind === "door").map((h) => [h.along_m - h.width / 2, h.along_m + h.width / 2]).sort((p, q) => p[0] - q[0]); // prettier-ignore
    let t0 = 0;
    const spans = [];
    for (const [h0, h1] of holes) {
      if (h0 > t0) spans.push([t0, h0]);
      t0 = Math.max(t0, h1);
    }
    if (len > t0) spans.push([t0, len]);
    const t = w.thickness_m;
    for (const [p0, p1] of spans) {
      if (p1 - p0 < 1e-6) continue;
      let min;
      let max;
      if (vertical) {
        const x = w.a[0];
        const [x0, x1] = w.kind === "exterior" ? exteriorSpanOf(rooms, w, x, "x") : [x - t / 2, x + t / 2];
        min = [x0, w.a[1] + p0, 0];
        max = [x1, w.a[1] + p1, H];
      } else {
        const y = w.a[1];
        const [y0, y1] = w.kind === "exterior" ? exteriorSpanOf(rooms, w, y, "y") : [y - t / 2, y + t / 2];
        min = [w.a[0] + p0, y0, 0];
        max = [w.a[0] + p1, y1, H];
      }
      pieces.push({ min, max, o: vertical ? "v" : "h", c: vertical ? w.a[0] : w.a[1], what: `the ${w.kind} wall ${w.rooms.length ? `of ${w.rooms.join(" and ")}` : ""}`.trim() }); // prettier-ignore
    }
  }
  return pieces;
}
function exteriorSpanOf(rooms, w, c, axis) {
  const t = w.thickness_m;
  const room = rooms.find((r) => w.rooms.includes(r.id) && r.storey === w.storey);
  if (!room) return [c - t / 2, c + t / 2];
  const q = room.rects[0];
  const mid = axis === "x" ? q.x + q.w / 2 : q.y + q.d / 2;
  return mid > c ? [c - t, c] : [c, c + t];
}
/** The keep-clear boxes of a storey's stair flights and landings. */
function stairBoxes(stairs, rules) {
  const out = [];
  for (const st of stairs)
    for (const [k, f] of st.flights.entries())
      out.push(...keepClearOf({ kind: "stair", id: `${st.id} flight ${k + 1}`, at: [f.at[0], f.at[1], f.z], facing: f.facing, width: f.width, run: f.run, rise: f.rise, landings: k === 0 ? [{ at: [st.halfLanding.at[0], st.halfLanding.at[1], st.halfLanding.z], size: st.halfLanding.size }] : [] }, rules)); // prettier-ignore
  return out;
}
const doorBoxesOf = (d, rules) => keepClearOf({ kind: d.swing === "none" ? "opening" : "door", id: d.id, at: [d.at[0], d.at[1], 0], facing: d.facing, width: d.width, height: d.height, wall: d.wall, swing: d.swing === "none" ? "none" : "front" }, rules); // prettier-ignore
/** A door's keep-clear boxes clear of the walls, the flights and the other doors' leaves. */
function doorClear(d, pieces, flights, others, rules, H) {
  const clip = (bx) => ({ min: bx.min, max: [bx.max[0], bx.max[1], Math.min(H, bx.max[2])] });
  const boxes = doorBoxesOf(d, rules).map((bx) => ({ ...clip(bx), what: bx.what }));
  for (const bx of boxes) {
    for (const p of pieces) if (overlapDepth(bx, p) > 1e-3) return false;
    const swing = /swing/.test(bx.what);
    if (swing) for (const f of flights) if (overlapDepth(bx, f) > 1e-3) return false;
    for (const o of others)
      for (const ob of doorBoxesOf(o, rules))
        if ((swing || /swing/.test(ob.what)) && /swing|opening/.test(ob.what) && /swing|opening/.test(bx.what) && overlapDepth(bx, clip(ob)) > 1e-3) return false; // prettier-ignore
  }
  return true;
}

/** Adds a finished leaf's footprint (clear, sides sorted, plan grid) to a registry of footprints taken. */
function registerShape(used, l, shellRect) {
  if (!used) return;
  const kind = l.item?.kind ?? l.fixed?.item?.kind;
  if (!kind || CIRCULATION.has(kind) || l.corridor || l.orphan || l.item?.void || l.fixed || l.item?.blob) return;
  const key = l.clearKey ?? shapeKey(l.rects, shellRect);
  used.set(key, (used.get(key) ?? 0) + 1);
}

// ── all buildings ──

/** Stage 5: every building's plan from stage 3's programs. */
/**
 * The wells and shafts of stage 4's connectors standing in a building's lot: `[{ connector, kind, rect (cells),
 * z: [z0, z1] (cells), exits }]`.
 */
export function reservedIn(network, prog) {
  const out = [];
  const L = prog.lot.rect;
  for (const c of network?.connectors ?? [])
    for (const p of c.pieces ?? []) {
      if (p.kind !== "well" && p.kind !== "shaft") continue;
      const xs = p.poly.map((q) => q[0]);
      const ys = p.poly.map((q) => q[1]);
      const rect = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys) };
      const ox = Math.min(rect.x + rect.w, L.x + L.w) - Math.max(rect.x, L.x);
      const oy = Math.min(rect.y + rect.d, L.y + L.d) - Math.max(rect.y, L.y);
      if (ox <= 0 || oy <= 0) continue;
      out.push({ connector: c.id, type: c.type, kind: p.kind, rect, z: p.z, exits: c.exits ?? [] });
    }
  return out;
}

export function plansOf(programsDoc, rules = loadRules(), { seed = "smak", trials = 160, attempts = 12, network = null } = {}) {
  const used = new Map(); // room footprints taken so far, buildings in the description's order
  const buildings = [];
  for (const p of programsDoc.buildings) {
    // a building whose own plan fails its gate is laid out again from the next sub-seed (at most `attempts`
    // times); the first that passes is kept, else the one with the fewest failures. Deterministic either way.
    let best = null;
    for (let k = 0; k < attempts; k++) {
      const trial = new Map(used);
      const plan = planBuilding(p, rules, { seed: k ? `${seed}~${k}` : seed, trials: Math.round(trials * (1 + 0.5 * k)), used: trial, reserved: reservedIn(network, p) });
      const g = checkPlans({ buildings: [plan] }, { buildings: [p] }, rules, { repeatTarget: 1 });
      plan.attempt = k;
      if (!best || g.failures.length < best.n) best = { plan, n: g.failures.length, used: trial };
      if (!g.failures.length) break;
    }
    for (const [key, n] of best.used) used.set(key, n);
    buildings.push(best.plan);
  }
  return {
    format: PLANS_FORMAT,
    description: programsDoc.description,
    inputs: { programs: sha256(canonical(programsDoc.buildings)), rules: `${rules.format} v${rules.version}` },
    seed,
    buildings,
    stats: statsOf(buildings),
  };
}

// ── stats ──

const CIRCULATION = new Set(["corridor", "stairwell", "lift-lobby", "gate", "upper-hall", "catwalk"]);
/** A room's footprint key: its clear rectangles' sides sorted, on a grid of `step` metres. */
export const footKey = (r, step) => r.clear.map((c) => [Math.round(c.w / step), Math.round(c.d / step)].sort((a, b) => a - b).join("x")).sort().join("+"); // prettier-ignore
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
/** Rooms per building, room footprint repeats (the plan grid's 8 units and the corpus's 32), plan variety. */
export function statsOf(buildings) {
  const perBuilding = buildings.map((b) => b.rooms.filter((r) => !CIRCULATION.has(r.kind)).length);
  const rooms = buildings.flatMap((b) => b.rooms.filter((r) => !CIRCULATION.has(r.kind)));
  const every = buildings.flatMap((b) => b.rooms.filter((r) => r.kind !== "stairwell"));
  const repeatOf = (list, step) => {
    const seen = new Map();
    for (const r of list) seen.set(footKey(r, step), (seen.get(footKey(r, step)) ?? 0) + 1);
    return list.filter((r) => seen.get(footKey(r, step)) > 1).length / Math.max(1, list.length);
  };
  const repeat = (step) => {
    const seen = new Map();
    for (const r of rooms) seen.set(footKey(r, step), (seen.get(footKey(r, step)) ?? 0) + 1);
    return rooms.filter((r) => seen.get(footKey(r, step)) > 1).length / Math.max(1, rooms.length);
  };
  const sigs = new Set(buildings.map((b) => b.signature));
  const areas = rooms.filter((r) => !CIRCULATION.has(r.kind)).map((r) => r.area_m2);
  return {
    buildings: buildings.length,
    rooms: buildings.reduce((a, b) => a + b.rooms.length, 0),
    roomsPerBuilding: { median: median(perBuilding), min: Math.min(...perBuilding), max: Math.max(...perBuilding), note: "rooms besides corridors, stairwells, lift lobbies, gates, upper halls and catwalks" }, // prettier-ignore
    medianRoom_m2: round2(median(areas)),
    roomRepeat: { share: round3(repeat(G)), grid_m: G, corpusShare: round3(repeat(4 * G)), corpusGrid_m: round3(4 * G), withCirculation: round3(repeatOf(every, G)), target: REPEAT_TARGET, gate: REPEAT_GATE, note: "share of rooms (corridors, stairwells, lift lobbies, gates, upper halls, catwalks left out) whose clear footprint, sides sorted, another room has; withCirculation: corridors and the rest counted too (stairwells still out: one stair stacked)" }, // prettier-ignore
    planVariety: { distinct: sigs.size, buildings: buildings.length },
    doors: buildings.reduce((a, b) => a + b.doors.length, 0),
    namedDoors: buildings.reduce((a, b) => a + b.doors.filter((d) => d.name).length, 0),
    windows: buildings.reduce((a, b) => a + b.windows.length, 0),
    stairs: buildings.reduce((a, b) => a + b.stairs.length, 0),
  };
}

// ── the gate ──

const EPS = 1e-6;
const box2 = (min, max) => ({ min, max });

/**
 * Stage 5's gate. Every failure a sentence naming the building, room or door and the number it wanted: the
 * program satisfied; areas and narrow sides at the rulebook's minima; every room reached from the street door, none
 * only through a private room unless the pair is allowed, adjacency, street and window needs, corridor runs and
 * dead ends, stairs between storeys (circulationOk); each unit entered only from the street or shared
 * circulation; every door fits (metres and the engine's units), every stair fits; corridor widths and every
 * ceiling; keep-clear volumes of doors and stairs clear of walls, door leaves clear of each other and of flights;
 * rooms inside the lot and not overlapping; door names unique and as the description names them; plan variety.
 */
export function checkPlans(plansDoc, programsDoc, rules = loadRules(), { engine = "goldsrc", repeatTarget = REPEAT_GATE, maxNameLength = 31, network = null } = {}) { // prettier-ignore
  const failures = [];
  const fail = (s) => failures.push(s);
  const eng = rulesFor(engine, rules);
  const unitM = rules.hull.engines[engine].unitM;
  const waived = [];
  const progs = new Map(programsDoc.buildings.map((p) => [p.id, p]));
  const names = new Map();
  for (const b of plansDoc.buildings) {
    const prog = progs.get(b.id);
    const bn = `building ${b.id}`;
    if (!prog) {
      fail(`${bn}: no program in stage 3's artifact`);
      continue;
    }
    const byId = new Map(b.rooms.map((r) => [r.id, r]));
    // 1. the program satisfied
    for (const r of prog.rooms) {
      const p = byId.get(r.id);
      if (!p) fail(`${bn}: room ${r.id} (${r.kind}) of the program has no plan, wanted 1`);
      else if (p.kind !== r.kind) fail(`${bn}: room ${r.id} is planned as a ${p.kind}, wanted a ${r.kind}`);
      else if (p.storey !== r.storey) fail(`${bn}: room ${r.id} (${r.kind}) is on storey ${p.storey}, wanted ${r.storey}`);
    }
    if (prog.stair) for (let s = 0; s < prog.storeys; s++) if (!b.rooms.some((r) => r.kind === "stairwell" && r.storey === s)) fail(`${bn}: storey ${s} has no stairwell, wanted 1 or more`); // prettier-ignore
    const homeUnits = new Set(prog.units.filter((u) => u.kind === "home").map((u) => u.id));
    const mixed = prog.units.some((u) => u.kind !== "home") && homeUnits.size > 0;
    const progCheck = roomProgramOk({ id: b.id, type: b.type, units: Object.fromEntries([...new Set(prog.units.filter((u) => u.kind === "home").map((u) => u.class))].map((c) => [c, prog.units.filter((u) => u.class === c).length])) }, b.rooms.filter((r) => !r.hidden && r.kind !== "corridor").map((r) => ({ id: r.id, kind: r.kind })), rules); // prettier-ignore
    for (const f of progCheck.failures) fail(f);
    // 2. areas and narrow sides
    for (const r of b.rooms) {
      const k = rules.roomKinds[r.kind];
      if (!k) continue;
      if (r.area_m2 < k.minArea - 1e-6) fail(`room ${r.id} (${r.kind}) of ${b.id}: ${r.area_m2} m2, wanted ${k.minArea} or more`);
      if (k.maxArea && r.area_m2 > k.maxArea + 1e-6) fail(`room ${r.id} (${r.kind}) of ${b.id}: ${r.area_m2} m2, wanted ${k.maxArea} or less (roomKinds.${r.kind}.maxArea)`); // prettier-ignore
      const main = r.clear.reduce((m, c) => (c.w * c.d > m.w * m.d ? c : m), r.clear[0]);
      const narrow = round3(Math.min(main.w, main.d));
      const minSide = r.kind === "corridor" ? rules.dimensions.corridors[corridorClassOf(prog, r)].width.min : k.minSide;
      if (narrow < minSide - 1e-6) fail(`room ${r.id} (${r.kind}) of ${b.id}: narrow side ${narrow} m, wanted ${minSide} or more`);
      for (const c of r.clear) if (Math.min(c.w, c.d) < Math.min(minSide, 1.44) - 1e-6) fail(`room ${r.id} (${r.kind}) of ${b.id}: a part ${round3(Math.min(c.w, c.d))} m wide, wanted ${Math.min(minSide, 1.44)} or more (no sliver)`); // prettier-ignore
    }
    // 3. circulation (per program part: a business and the homes over it are two)
    const parts = mixed
      ? [
          { type: b.type, rooms: b.rooms.filter((r) => r.unit && !homeUnits.has(r.unit)) },
          { type: "apartment", rooms: b.rooms.filter((r) => !r.unit || homeUnits.has(r.unit)) },
        ]
      : prog.layout === "columns"
        ? prog.units.map((u) => ({ type: b.type, rooms: b.rooms.filter((r) => r.unit === u.id) }))
        : [{ type: b.type, rooms: b.rooms }];
    for (const part of parts) {
      const ids = new Set(part.rooms.map((r) => r.id));
      const links = [];
      for (const d of b.doors) if (ids.has(d.from) && ids.has(d.to)) links.push({ from: d.from, to: d.to });
      for (const st of b.stairs) if (ids.has(st.from) && ids.has(st.to)) links.push({ from: st.from, to: st.to, type: "stair" });
      const entrances = [...new Set(b.doors.filter((d) => d.street && ids.has(d.to)).map((d) => d.to))];
      const graph = {
        id: b.id,
        type: part.type,
        rooms: part.rooms.map((r) => ({ id: r.id, kind: r.kind, storey: r.storey, street: b.doors.some((d) => d.street && d.to === r.id), exterior: r.exterior, length: r.kind === "corridor" ? Math.max(...r.clear.map((c) => Math.max(c.w, c.d))) : undefined, area: r.area_m2, home: homeUnits.has(r.unit) ? r.unit : undefined, hidden: r.hidden || undefined })), // prettier-ignore
        links,
        entrances,
      };
      for (const f of circulationOk(graph, rules).failures) fail(`${b.id}: ${f}`);
    }
    // 3b. a unit entered only from the street or shared circulation, never through another unit's rooms
    for (const d of b.doors) {
      const a = byId.get(d.from);
      const c = byId.get(d.to);
      if (!a || !c) continue;
      if ((a.unit ?? null) !== (c.unit ?? null) && a.unit && c.unit) fail(`door ${d.id} of ${b.id} joins unit ${a.unit} to unit ${c.unit}; wanted 0 doors between units`);
      if ((a.unit ?? null) !== (c.unit ?? null) && !a.unit && a.kind !== "corridor" && a.kind !== "lobby" && a.kind !== "stairwell") fail(`door ${d.id} of ${b.id} enters unit ${c.unit} from ${a.id} (${a.kind}); wanted a unit entered from shared circulation`); // prettier-ignore
    }
    // 4. doors fit (metres and the engine's units), under their rooms' ceilings
    for (const d of b.doors) {
      for (const f of doorFits({ id: d.id, kind: d.kind, width: d.width, height: d.height }, rules).failures) fail(`${b.id}: ${f}`);
      for (const f of doorFits({ id: d.id, kind: d.kind, width: d.width / unitM, height: d.height / unitM }, eng).failures) fail(`${b.id} (${engine}): ${f}`); // prettier-ignore
      for (const rid of [d.from, d.to]) {
        const r = byId.get(rid);
        if (r && d.height + rules.keepClear.door.minHeadMargin > r.height_m + 1e-6) fail(`door ${d.id} of ${b.id}: ${round3(d.height)} m high and its head margin ${rules.keepClear.door.minHeadMargin} m pass the ${r.kind} ${r.id}'s ceiling at ${r.height_m} m`); // prettier-ignore
      }
    }
    // 5. stairs fit
    for (const st of b.stairs) {
      const perFlight = Math.max(...st.flights.map((f) => f.risers));
      for (const f of stairFits({ id: st.id, kind: st.kind, rise: st.rise, run: st.run, width: st.width, headroom: st.headroom, risers: perFlight, landing: st.landing }, rules).failures) fail(`${b.id}: ${f}`); // prettier-ignore
      const total = st.flights.reduce((a, f) => a + f.rise, 0);
      if (Math.abs(total - b.frame.storeyHeight_m) > 0.03) fail(`${b.id}: stair ${st.id} rises ${round3(total)} m, wanted the storey's ${b.frame.storeyHeight_m} m`);
    }
    // 6. corridors and ceilings
    for (const r of b.rooms) {
      if (r.kind === "corridor") {
        const cls = corridorClassOf(prog, r);
        const want = rules.dimensions.corridors[cls];
        const narrow = Math.min(...r.clear.map((c) => Math.min(c.w, c.d)));
        if (narrow < want.width.min - 1e-6) fail(`corridor ${r.id} of ${b.id}: ${round3(narrow)} m wide, wanted ${want.width.min} or more (a ${cls} corridor)`);
        const wideOf = rules.roomKinds.corridor?.maxWidthOfTypical;
        if (wideOf && narrow > want.width.typical * wideOf + 1e-6) fail(`corridor ${r.id} of ${b.id}: ${round3(narrow)} m wide, wanted ${round3(want.width.typical * wideOf)} or less (a ${cls} corridor, ${wideOf} x its typical ${want.width.typical}: roomKinds.corridor.maxWidthOfTypical)`); // prettier-ignore
        if (r.height_m < want.height.min - 1e-6) fail(`corridor ${r.id} of ${b.id}: ceiling ${r.height_m} m, wanted ${want.height.min} or more`);
      }
      for (const f of ceilingFits({ id: r.id, kind: r.kind, height: r.height_m }, rules).failures) fail(`${b.id}: ${f}`);
      if (!r.doubleHeight && !r.open && r.height_m > b.frame.clearHeight_m + 1e-6) fail(`room ${r.id} of ${b.id}: ceiling ${r.height_m} m, wanted ${b.frame.clearHeight_m} or less (under the storey's slab)`); // prettier-ignore
    }
    // 7. keep-clear volumes
    keepClearChecks(b, rules, fail);
    // 8. rooms inside the lot, apart
    const inner = { x: b.frame.exteriorWall_m, y: b.frame.exteriorWall_m, w: b.frame.size_m[0] - 2 * b.frame.exteriorWall_m, d: b.frame.size_m[1] - 2 * b.frame.exteriorWall_m }; // prettier-ignore
    for (const r of b.rooms)
      for (const q of r.rects)
        if (q.x < inner.x - EPS || q.y < inner.y - EPS || q.x + q.w > inner.x + inner.w + EPS || q.y + q.d > inner.y + inner.d + EPS) fail(`room ${r.id} of ${b.id}: [${q.x}, ${q.y}, ${q.w}, ${q.d}] m leaves the lot's inside [${round3(inner.x)}, ${round3(inner.y)}, ${round3(inner.w)}, ${round3(inner.d)}]`); // prettier-ignore
    for (let s = 0; s < b.storeys.length; s++) {
      const list = [...b.rooms.filter((r) => r.storey === s).map((r) => ({ id: r.id, rects: r.rects })), ...b.voids.filter((v) => v.storey === s).map((v, k) => ({ id: `${v.kind} ${k + 1}`, rects: v.rects }))]; // prettier-ignore
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++)
          for (const p of list[i].rects)
            for (const q of list[j].rects) {
              const ox = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
              const oy = Math.min(p.y + p.d, q.y + q.d) - Math.max(p.y, q.y);
              if (ox > 1e-3 && oy > 1e-3) fail(`storey ${s} of ${b.id}: ${list[i].id} and ${list[j].id} overlap by ${round3(ox)} x ${round3(oy)} m, wanted 0`);
            }
    }
    // 8b. connectors' wells and shafts: kept clear on their storeys, a door at each exit the connector stops at
    for (const r of b.reserved ?? []) {
      for (const s of r.storeys)
        if (!b.voids.some((v) => v.storey === s && v.of === r.connector && v.kind === r.kind)) fail(`${b.id}: ${r.connector}'s ${r.kind} is not kept clear on storey ${s}, wanted its ${r.rect_m.w} x ${r.rect_m.d} m left out of every room`); // prettier-ignore
      for (const e of r.exits) if (!e.door) fail(`${b.id}: ${r.connector}'s ${r.kind} has no door on its ${e.side} side at storey ${e.storey}, wanted 1 into a room`); // prettier-ignore
    }
    // 9. names
    for (const d of b.doors) if (d.name) names.set(d.name, [...(names.get(d.name) ?? []), `${b.id}/${d.id}`]);
    for (const want of prog.doors) if (!b.doors.some((d) => d.name === want.name)) fail(`door name ${want.name} (${want.kind}) of ${b.id}: on no door, wanted 1`);
    // 9b. no two doors in one wall overlap (their openings and the side margins of their keep-clear)
    for (let i = 0; i < b.doors.length; i++)
      for (let j = i + 1; j < b.doors.length; j++) {
        const [p, q] = [b.doors[i], b.doors[j]];
        if (p.storey !== q.storey || Boolean(p.facing[0]) !== Boolean(q.facing[0])) continue;
        const ax = p.facing[0] ? 0 : 1; // the wall's line runs along y when the door faces x
        const line = Math.abs(p.at[1 - ax] - q.at[1 - ax]);
        const gap = Math.abs(p.at[ax] - q.at[ax]) - (p.width + q.width) / 2;
        if (line < Math.max(p.wall, q.wall) && gap < 0) fail(`doors ${p.id} and ${q.id} of ${b.id} overlap by ${round3(-gap)} m in one wall on storey ${p.storey}, wanted apart`); // prettier-ignore
      }
    // 10. cells: a cell or holding cell opens only by a cell door (a lockable leaf), and only on what the program's
    // adjacency names (a guarded corridor, the guard post), never on a stair, a lobby or the street
    for (const d of b.doors)
      for (const rid of [d.from, d.to]) {
        const r = byId.get(rid);
        if (!r || (r.kind !== "cell" && r.kind !== "holding-cell")) continue;
        const otherId = rid === d.from ? d.to : d.from;
        const other = byId.get(otherId);
        const okKinds = new Set((rules.programs[b.type]?.adjacency ?? []).filter((a) => a.a === r.kind && a.next).flatMap((a) => a.next));
        if (d.kind !== "cell" && d.kind !== "secret") fail(`door ${d.id} of ${b.id} into the ${r.kind} ${r.id} is a ${d.kind}, wanted a cell door (a lockable leaf)`); // prettier-ignore
        if (okKinds.size && !(other && okKinds.has(other.kind))) fail(`the ${r.kind} ${r.id} of ${b.id} opens on ${other ? `the ${other.kind} ${other.id}` : otherId}, wanted only ${[...okKinds].join(" or ")} (programs.${b.type}.adjacency)`); // prettier-ignore
      }
    // 11. stage 4's rooms at their place: a checkpoint's or a post's room planned where it stood
    for (const pr of prog.rooms.filter((r) => r.fixed)) {
      const p = byId.get(pr.id);
      if (!p) continue;
      const xs = p.cells.flatMap((c) => [c.x, c.x + c.w]);
      const ys = p.cells.flatMap((c) => [c.y, c.y + c.d]);
      const off = Math.max(Math.abs(Math.min(...xs) - pr.fixed.x), Math.abs(Math.min(...ys) - pr.fixed.y), Math.abs(Math.max(...xs) - pr.fixed.x - pr.fixed.w), Math.abs(Math.max(...ys) - pr.fixed.y - pr.fixed.d)); // prettier-ignore
      if (off > 0.2) fail(`room ${pr.id} (${pr.checkpoint ?? pr.post}'s ${pr.kind}) of ${b.id} is planned ${round3(off)} cells from where stage 4 stood it, wanted 0.2 or less`); // prettier-ignore
    }
    // 12. every hallway ending at the building has its door there (a gate room's, or the room at its end)
    for (const h of prog.hallways ?? []) {
      const d = b.doors.find((x) => x.hallway === h.hallway || (h.gate && x.to === h.gate && x.kind === "gate"));
      if (!d) fail(`${b.id}: hallway ${h.hallway} meets the ${h.side} wall ${h.at} cells along it on storey ${h.storey} and no door opens there, wanted 1`); // prettier-ignore
      else if (d.storey !== h.storey) fail(`${b.id}: hallway ${h.hallway}'s door ${d.id} is on storey ${d.storey}, wanted ${h.storey}`);
    }
    // 13. a lift lobby against its lift: the lift's door opens into it
    for (const pr of prog.rooms.filter((r) => r.lift)) {
      const exits = (b.reserved ?? []).filter((c) => c.connector.split("+").some((k) => pr.lift.connectors.includes(k))).flatMap((c) => c.exits.filter((e) => e.storey === pr.storey && e.side === pr.lift.side)); // prettier-ignore
      if (exits.length && !exits.some((e) => e.room === pr.id)) fail(`lift lobby ${pr.id} of ${b.id}: ${pr.lift.connectors.join(" and ")}'s door on the ${pr.lift.side} at storey ${pr.storey} opens into ${exits.map((e) => e.room ?? "no room").join(", ")}, wanted the lobby`); // prettier-ignore
    }
    // 14. no window on a party wall (a stretch of the lot's outer line shared with a neighbouring lot)
    const tE = b.frame.exteriorWall_m;
    for (const w of b.windows) {
      if (w.court) continue;
      const [fx, fy] = w.facing;
      const side = fx > 0 ? "w" : fx < 0 ? "e" : fy > 0 ? "s" : "n";
      const line = side === "w" ? w.at[0] < tE + 0.01 : side === "e" ? w.at[0] > b.frame.size_m[0] - tE - 0.01 : side === "s" ? w.at[1] < tE + 0.01 : w.at[1] > b.frame.size_m[1] - tE - 0.01; // prettier-ignore
      if (!line) continue;
      const along = (side === "w" || side === "e" ? w.at[1] : w.at[0]) / 3.2512;
      const p = (prog.lot.party ?? []).find((q) => q.side === side && along > q.a + 0.05 && along < q.b - 0.05);
      if (p) fail(`window of room ${w.room} of ${b.id} on storey ${w.storey} opens on the ${side} party wall shared with lot ${p.lot}, wanted none (windows only on a way, a plaza, a court or open ground)`); // prettier-ignore
    }
    // 15. every terrace edge open to the drop has its parapet
    for (const [k, v] of b.voids.entries()) if (v.kind === "terrace" && !(b.parapets ?? []).some((p) => p.of === `terrace ${k + 1}`)) fail(`${b.id}: terrace ${k + 1} on storey ${v.storey} has no parapet, wanted one on every edge not against a room (dimensions.parapets)`); // prettier-ignore
    // 16. stage 4's checkpoint rooms and posts: inside the lot only as rooms of the plan, and clear of its street doors
    if (network) {
      const L = b.lot.rect;
      const z0 = b.lot.zBase;
      const z1 = z0 + b.storeys.length * 1.5;
      const folded = prog.rooms.filter((r) => r.fixed && byId.has(r.id));
      const isPlanned = (sr) => folded.some((r) => (r.checkpoint ?? r.post) === sr.id && r.kind === sr.kind && r.fixed.x >= sr.rect.x - 0.01 && r.fixed.y >= sr.rect.y - 0.01 && r.fixed.x + r.fixed.w <= sr.rect.x + sr.rect.w + 0.01 && r.fixed.y + r.fixed.d <= sr.rect.y + sr.rect.d + 0.01); // prettier-ignore
      const stood = [...(network.checkpoints ?? []).flatMap((k) => k.rooms.map((r) => ({ id: k.id, ...r }))), ...(network.posts ?? []).map((p) => ({ id: p.id, kind: p.kind, rect: p.rect, z: p.z }))]; // prettier-ignore
      for (const r of stood) {
        if (r.z[0] >= z1 - 0.05 || r.z[1] <= z0 + 0.05) continue;
        const ox = Math.min(r.rect.x + r.rect.w, L.x + L.w) - Math.max(r.rect.x, L.x);
        const oy = Math.min(r.rect.y + r.rect.d, L.y + L.d) - Math.max(r.rect.y, L.y);
        if (ox > 0.05 && oy > 0.05 && !isPlanned(r)) fail(`${r.id}'s ${r.kind} stands ${round3(ox * oy)} cells2 inside building ${b.id}'s lot and is not a room of its plan, wanted it planned as part of the building or outside the lot`); // prettier-ignore
        if (ox > 0.05 && oy > 0.05) continue;
        // a street door's approach: its opening carried out a door's keep-clear depth, its width and margins
        for (const d of b.doors.filter((x) => x.street)) {
          const depth = rules.keepClear.door.minDepth;
          const half = d.width / 2 + rules.keepClear.door.minSideMargin;
          const [fx, fy] = d.facing; // into the building
          const cx = L.x + d.at[0] / 3.2512;
          const cy = L.y + d.at[1] / 3.2512;
          const a = { x: fx ? (fx > 0 ? cx - depth / 3.2512 : cx) : cx - half / 3.2512, y: fy ? (fy > 0 ? cy - depth / 3.2512 : cy) : cy - half / 3.2512, w: fx ? depth / 3.2512 : (2 * half) / 3.2512, d: fy ? depth / 3.2512 : (2 * half) / 3.2512 }; // prettier-ignore
          const px = Math.min(r.rect.x + r.rect.w, a.x + a.w) - Math.max(r.rect.x, a.x);
          const py = Math.min(r.rect.y + r.rect.d, a.y + a.d) - Math.max(r.rect.y, a.y);
          if (px > 0.02 && py > 0.02 && r.z[0] < z0 + 1.5) fail(`${r.id}'s ${r.kind} stands in street door ${d.id}'s approach of ${b.id}, wanted the approach clear (keepClear.door)`); // prettier-ignore
        }
      }
    }
  }
  for (const [n, where] of names) {
    if (n.length > maxNameLength) fail(`door name ${n}: ${n.length} characters, wanted ${maxNameLength} or fewer`);
    const bases = new Set(where);
    if (bases.size > 1 && where.length !== new Set(where).size) fail(`door name ${n}: given ${where.length} times, wanted once`);
    if (where.length > 1) fail(`door name ${n}: on ${where.length} doors (${where.slice(0, 4).join(", ")}), wanted 1`);
  }
  // variety: no two buildings with one plan; every variant once; room footprints repeated at most the target
  const sigs = new Map();
  for (const b of plansDoc.buildings) sigs.set(b.signature, [...(sigs.get(b.signature) ?? []), b.id]);
  for (const [, ids] of sigs) if (ids.length > 1) fail(`variety: buildings ${ids.join(", ")} share one plan, wanted every plan once`);
  const variants = new Map();
  for (const b of plansDoc.buildings) variants.set(b.variant, [...(variants.get(b.variant) ?? []), b.id]);
  for (const [v, ids] of variants) if (ids.length > 1) fail(`variety: variant ${v} is planned for ${ids.join(", ")}, wanted 1`);
  const stats = statsOf(plansDoc.buildings);
  if (stats.roomRepeat.share > repeatTarget + 1e-9) fail(`variety: ${round2(stats.roomRepeat.share * 100)} % of rooms repeat another's footprint, wanted ${round2(repeatTarget * 100)} % or less`); // prettier-ignore
  return { ok: failures.length === 0, failures, waived, stats };
}

function corridorClassOf(prog, r) {
  if (prog.layout === "columns") return "domestic";
  const unit = prog.units.find((u) => u.id === r.unit);
  if (unit?.kind === "home") return "domestic";
  return prog.corridor.class;
}

/** Keep-clear: each door's and stair's boxes against the walls, door leaves against each other and the flights. */
function keepClearChecks(b, rules, fail) {
  const H = b.frame.clearHeight_m;
  for (let s = 0; s < b.storeys.length; s++) {
    // wall pieces (holes cut out) as boxes
    const pieces = [];
    for (const w of b.walls.filter((x) => x.storey === s)) {
      const vertical = w.a[0] === w.b[0];
      const len = vertical ? w.b[1] - w.a[1] : w.b[0] - w.a[0];
      const holes = w.holes.filter((h) => h.kind === "door").map((h) => [h.along_m - h.width / 2, h.along_m + h.width / 2]).sort((p, q) => p[0] - q[0]); // prettier-ignore
      let t0 = 0;
      const spans = [];
      for (const [h0, h1] of holes) {
        if (h0 > t0) spans.push([t0, h0]);
        t0 = Math.max(t0, h1);
      }
      if (len > t0) spans.push([t0, len]);
      // the exterior wall stands outside the room's face; the interior one is centred on its line
      const t = w.thickness_m;
      for (const [p0, p1] of spans) {
        if (p1 - p0 < 1e-6) continue;
        const lo = w.kind === "exterior" ? null : -t / 2;
        let min;
        let max;
        if (vertical) {
          const x = w.a[0];
          const [x0, x1] = w.kind === "exterior" ? exteriorSpan(b, w, x, "x") : [x + lo, x - lo];
          min = [x0, w.a[1] + p0, 0];
          max = [x1, w.a[1] + p1, H];
        } else {
          const y = w.a[1];
          const [y0, y1] = w.kind === "exterior" ? exteriorSpan(b, w, y, "y") : [y + lo, y - lo];
          min = [w.a[0] + p0, y0, 0];
          max = [w.a[0] + p1, y1, H];
        }
        pieces.push({ min, max, what: `the ${w.kind} wall ${w.rooms.length ? `of ${w.rooms.join(" and ")}` : ""}`.trim() });
      }
    }
    const doors = b.doors.filter((d) => d.storey === s);
    const flights = [];
    for (const st of b.stairs.filter((x) => x.storey === s))
      for (const [k, f] of st.flights.entries()) {
        const boxes = keepClearOf({ kind: "stair", id: `${st.id} flight ${k + 1}`, at: [f.at[0], f.at[1], f.z], facing: f.facing, width: f.width, run: f.run, rise: f.rise, landings: k === 0 ? [{ at: [st.halfLanding.at[0], st.halfLanding.at[1], st.halfLanding.z], size: st.halfLanding.size }] : [] }, rules); // prettier-ignore
        flights.push(...boxes);
        for (const bx of boxes)
          for (const p of pieces) {
            const bz = { min: [bx.min[0], bx.min[1], Math.max(0, bx.min[2])], max: [bx.max[0], bx.max[1], Math.min(H, bx.max[2])] };
            const dd = overlapDepth(bz, p);
            if (dd > 1e-3) fail(`${b.id}: ${bx.what} enters ${p.what} by ${round3(dd)} m, wanted 0 (clear of it)`);
          }
      }
    const leafBoxes = [];
    for (const d of doors) {
      const boxes = keepClearOf({ kind: d.swing === "none" ? "opening" : "door", id: d.id, at: [d.at[0], d.at[1], 0], facing: d.facing, width: d.width, height: d.height, wall: d.wall, swing: d.swing === "none" ? "none" : "front" }, rules); // prettier-ignore
      for (const bx of boxes) {
        const bz = { min: [bx.min[0], bx.min[1], bx.min[2]], max: [bx.max[0], bx.max[1], Math.min(H, bx.max[2])] };
        for (const p of pieces) {
          const dd = overlapDepth(bz, p);
          if (dd > 1e-3) fail(`${b.id}: ${bx.what} enters ${p.what} by ${round3(dd)} m, wanted 0 (clear of it)`);
        }
        if (/swing/.test(bx.what)) {
          for (const f of flights) {
            const dd = overlapDepth(bz, f);
            if (dd > 1e-3) fail(`${b.id}: ${bx.what} enters ${f.what} by ${round3(dd)} m, wanted 0`);
          }
          leafBoxes.push({ box: bz, door: d.id });
        }
      }
    }
    for (let i = 0; i < leafBoxes.length; i++)
      for (let j = i + 1; j < leafBoxes.length; j++) {
        if (leafBoxes[i].door === leafBoxes[j].door) continue;
        const dd = overlapDepth(leafBoxes[i].box, leafBoxes[j].box);
        if (dd > 1e-3) fail(`${b.id}: door ${leafBoxes[i].door}'s leaf and door ${leafBoxes[j].door}'s leaf swing into each other by ${round3(dd)} m, wanted 0`); // prettier-ignore
      }
  }
}
/** An exterior wall's extent across its line: outside the rooms' face (the side with no room of this wall). */
function exteriorSpan(b, w, c, axis) {
  const t = w.thickness_m;
  const room = b.rooms.find((r) => w.rooms.includes(r.id) && r.storey === w.storey);
  if (!room) return [c - t / 2, c + t / 2];
  const q = room.rects[0];
  const mid = axis === "x" ? q.x + q.w / 2 : q.y + q.d / 2;
  return mid > c ? [c - t, c] : [c, c + t];
}

// ── command line ──

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("levels/gen/plans.mjs");
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const file = args.find((a) => a.endsWith(".json"));
  const desc = loadCity(file);
  const out = opt("--out", null);
  const rules = loadRules();
  const seed = opt("--seed", "smak");
  const lots = lotsFor(desc, opt("--lots", out));
  const programs = programsOf(desc, lots, rules, { seed });
  const g3 = checkPrograms(programs, desc, rules);
  for (const f of g3.failures) console.log(`FAIL  stage 3: ${f}`);
  const t0 = Date.now();
  const plans = plansOf(programs, rules, { seed, trials: Number(opt("--trials", 160)) });
  const gate = checkPlans(plans, programs, rules);
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "03-programs.json"), JSON.stringify(programs, null, 1) + "\n");
    writeFileSync(join(out, "05-plans.json"), JSON.stringify(plans, null, 1) + "\n");
  }
  const svgDir = opt("--svg", null);
  if (svgDir) {
    const { planSvgs } = await import("./plan-svg.mjs");
    mkdirSync(svgDir, { recursive: true });
    const zones = Object.fromEntries(Object.entries(rules.roomKinds).map(([k, v]) => [k, v.zone]));
    for (const p of planSvgs(plans, { zones })) writeFileSync(join(svgDir, p.file), p.svg);
  }
  console.log(`stage 5: ${plans.buildings.length} buildings in ${Date.now() - t0} ms; ${JSON.stringify(plans.stats)}`);
  for (const f of gate.failures) console.log(`FAIL  ${f}`);
  for (const w of gate.waived) console.log(`WAIVED ${w}`);
  console.log(gate.ok && g3.ok ? "PASS" : `FAIL (${gate.failures.length + g3.failures.length})`);
  process.exitCode = gate.ok && g3.ok ? 0 : 1;
}
