// The building description (`smak-building/1`, levels/assembly/README.md): read with its defaults filled, and
// checked before any layout is tried. What must hold for a building to be laid out at all: every field of the
// right kind, the rooms' areas fitting each storey's footprint once the stairwell is taken out of it, the stair
// joining two storeys one apart, and every room reached from the entrance through the doors and the stair.
// Each failure is a sentence naming the thing and the number it wanted, as SMAK's checks give them. A description
// may name a style (`"style": "house"`, style.mjs): its rooms' kinds and areas are then checked against it, and
// `"doors": "auto"` takes the doors from it.
import { styleOf, doorsFor, checkStyleBuilding } from "./style.mjs";

export const BUILDING_FORMAT = "smak-building/1";

/** The stairwell of the stair piece, in cells: 2 wide, 4 long (README, "Units and the grid"). */
export const STAIRWELL = { wide: 2, long: 4 };
export const STAIRWELL_CELLS = STAIRWELL.wide * STAIRWELL.long;

const isInt = (v) => Number.isInteger(v);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * A description with its defaults filled: seed 1, storeys 2, stair { at: "auto" }, base [0, 0, 0], a room's
 * kind "room", doors []. Takes the object or its JSON text; a copy is returned, the input is left alone.
 */
export function readBuilding(source) {
  const d = typeof source === "string" ? JSON.parse(source) : JSON.parse(JSON.stringify(source ?? {}));
  d.format ??= BUILDING_FORMAT;
  d.name ??= "building";
  d.seed ??= 1;
  d.storeys ??= 2;
  d.stair ??= { at: "auto" };
  d.stair.at ??= "auto";
  d.base ??= [0, 0, 0];
  d.doors ??= [];
  d.rooms ??= [];
  for (const r of Array.isArray(d.rooms) ? d.rooms : []) {
    if (r && typeof r === "object") {
      r.kind ??= "room";
      r.entrance = !!r.entrance;
    }
  }
  if (d.doors === "auto" && typeof d.style === "string" && Array.isArray(d.rooms)) {
    try {
      d.doors = doorsFor(d, styleOf(d));
      d.doorsAuto = true;
    } catch {
      // an unknown style: checkBuilding says so
    }
  }
  return d;
}

/** The cells one storey leaves to its rooms: the footprint, less the stairwell when the building has a stair. */
export const cellsLeft = (d) => {
  const [w, h] = d.footprint.cells;
  return w * h - (d.storeys > 1 ? STAIRWELL_CELLS : 0);
};

/**
 * Checks a description (read or not). Returns `{ building, failures, warnings }`: `building` the description with
 * its defaults, `failures` the sentences that stop a layout, `warnings` the ones that do not.
 */
export function checkBuilding(source) {
  const failures = [];
  const warnings = [];
  let d;
  try {
    d = readBuilding(source);
  } catch (e) {
    return { building: null, failures: [`the description is not JSON (${e.message})`], warnings };
  }
  const fail = (s) => failures.push(s);

  // ── the fields, one by one ──
  if (d.format !== BUILDING_FORMAT) fail(`format is ${JSON.stringify(d.format)}; a building description is ${BUILDING_FORMAT}`); // prettier-ignore
  if (!isInt(d.seed)) fail(`seed is ${JSON.stringify(d.seed)}; it wants a whole number`);
  if (!isInt(d.storeys) || d.storeys < 1) fail(`storeys is ${JSON.stringify(d.storeys)}; it wants a whole number, 1 or more`); // prettier-ignore
  if (d.stair.at !== "auto") fail(`stair.at is ${JSON.stringify(d.stair.at)}; only "auto" is read yet`);
  if (!Array.isArray(d.base) || d.base.length !== 3 || !d.base.every(Number.isFinite)) fail(`base is ${JSON.stringify(d.base)}; it wants [x, y, z] in units`); // prettier-ignore
  const cells = d.footprint?.cells;
  const footOk = Array.isArray(cells) && cells.length === 2 && cells.every((v) => isInt(v) && v >= 1);
  if (!footOk) fail(`footprint.cells is ${JSON.stringify(cells)}; it wants [cellsX, cellsY], whole numbers 1 or more`); // prettier-ignore
  else if (d.storeys > 1) {
    // the stairwell (2 x 4) and the two cells at its foot, one way or the other
    const [w, h] = cells;
    const fits = (w >= STAIRWELL.wide && h >= STAIRWELL.long + 1) || (w >= STAIRWELL.long + 1 && h >= STAIRWELL.wide);
    if (!fits) fail(`footprint: ${w} x ${h} cells holds no stairwell of 2 x 4 with a row at its foot; it wants at least 2 x 5 or 5 x 2`); // prettier-ignore
  }
  if (!Array.isArray(d.rooms) || !d.rooms.length) fail("rooms: the description has none; a building wants at least one");
  if (d.front !== undefined && !["south", "north", "east", "west"].includes(d.front)) fail(`front is ${JSON.stringify(d.front)}; it wants "south", "north", "east" or "west" (the wall the entrance stands on)`); // prettier-ignore
  if (d.blind !== undefined && (!Array.isArray(d.blind) || !d.blind.every((s) => ["south", "north", "east", "west"].includes(s)))) fail(`blind is ${JSON.stringify(d.blind)}; it wants a list of the walls a neighbour stands against, of "south", "north", "east", "west"`); // prettier-ignore
  else if (d.blindBelow !== undefined && (!Array.isArray(d.blindBelow) || !d.blindBelow.every((s) => ["south", "north", "east", "west"].includes(s)))) fail(`blindBelow is ${JSON.stringify(d.blindBelow)}; it wants a list of the walls blind on the ground storey only, of "south", "north", "east", "west"`); // prettier-ignore
  else if (d.blind?.includes(d.front)) fail(`blind names the ${d.front} wall, the front; the entrance stands on the front`);
  if (d.noWindows !== undefined && (!Array.isArray(d.noWindows) || !d.noWindows.every((k) => typeof k === "string"))) fail(`noWindows is ${JSON.stringify(d.noWindows)}; it wants a list of room kinds that have no window (a cell, an armory)`); // prettier-ignore
  if (d.stairOffFront !== undefined && typeof d.stairOffFront !== "boolean") fail(`stairOffFront is ${JSON.stringify(d.stairOffFront)}; it wants true or false (the stairwell kept off the front wall)`); // prettier-ignore
  if (d.windowStep !== undefined && !(Number.isInteger(d.windowStep) && d.windowStep >= 2)) fail(`windowStep is ${JSON.stringify(d.windowStep)}; it wants a whole number 2 or more (a window every so many edges of an outside wall)`); // prettier-ignore
  if (!Array.isArray(d.doors)) fail(`doors is ${JSON.stringify(d.doors)}; it wants a list of [room, room] pairs`);
  if (failures.length) return { building: d, failures, warnings };

  const byId = new Map();
  for (const [i, r] of d.rooms.entries()) {
    const name = typeof r?.id === "string" && r.id ? `room ${r.id}` : `room ${i + 1}`;
    if (typeof r?.id !== "string" || !r.id) {
      fail(`${name} has no id; every room wants a name`);
      continue;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(r.id)) fail(`${name}: its id holds characters other than letters, digits, - and _`); // prettier-ignore
    if (byId.has(r.id)) fail(`${name} is named twice; ids are unique`);
    byId.set(r.id, r);
    if (!isInt(r.storey) || r.storey < 0 || r.storey >= d.storeys) fail(`${name} is on storey ${JSON.stringify(r.storey)}; the building has storeys 0 to ${d.storeys - 1}`); // prettier-ignore
    const a = r.area;
    if (!Array.isArray(a) || a.length !== 2 || !a.every(isInt) || a[0] < 1 || a[1] < a[0])
      fail(`${name}: area is ${JSON.stringify(a)}; it wants [least, most] in cells, 1 <= least <= most`);
  }
  const entrances = d.rooms.filter((r) => r?.entrance);
  if (!entrances.length) fail(`the building has no entrance room; it wants 1 at least (entrance: true)`);
  for (const r of entrances)
    if (r.storey !== 0) fail(`room ${r.id}, an entrance, is on storey ${r.storey}; an entrance stands on storey 0`); // prettier-ignore

  const pairs = new Set();
  for (const [i, pair] of d.doors.entries()) {
    if (!Array.isArray(pair) || pair.length !== 2) {
      fail(`door ${i + 1} is ${JSON.stringify(pair)}; a door is a pair [room, room]`);
      continue;
    }
    const [a, b] = pair;
    const missing = pair.filter((id) => !byId.has(id));
    if (missing.length) {
      fail(`door ${a}-${b} names ${missing.join(" and ")}, which no room is`);
      continue;
    }
    if (a === b) fail(`door ${a}-${b} joins a room to itself`);
    else if (byId.get(a).storey !== byId.get(b).storey) fail(`door ${a}-${b} joins storey ${byId.get(a).storey} to storey ${byId.get(b).storey}; a door joins rooms of one storey, a stair joins storeys`); // prettier-ignore
    const key = [a, b].sort().join("|");
    if (pairs.has(key)) fail(`door ${a}-${b} is named twice`);
    pairs.add(key);
  }

  // ── the style: every kind one of its own, every area band one its kind can have ──
  if (d.style !== undefined) {
    let style = null;
    try {
      style = styleOf(d);
    } catch (e) {
      fail(e.message);
    }
    if (style) {
      const s = checkStyleBuilding(d, style);
      failures.push(...s.failures), warnings.push(...s.warnings);
    }
  }

  // ── the stair ──
  const hasStair = d.stairFrom !== undefined || d.stairTo !== undefined;
  if (d.storeys > 1 && !hasStair) fail(`the building has ${d.storeys} storeys and no stair; it wants stairFrom and stairTo`); // prettier-ignore
  if (hasStair) {
    const from = byId.get(d.stairFrom);
    const to = byId.get(d.stairTo);
    if (d.storeys < 2) fail(`the building has 1 storey; a stair wants 2`);
    if (!from) fail(`stairFrom ${JSON.stringify(d.stairFrom)} is no room`);
    if (!to) fail(`stairTo ${JSON.stringify(d.stairTo)} is no room`);
    if (from && to && isInt(from.storey) && isInt(to.storey) && to.storey - from.storey !== 1)
      fail(`stair: stairFrom ${from.id} is on storey ${from.storey} and stairTo ${to.id} on storey ${to.storey}; a stair climbs 1 storey, from storey k to k+1 (this one ${to.storey - from.storey})`); // prettier-ignore
    if (d.storeys > 2) warnings.push(`the building has ${d.storeys} storeys and one stair; the storeys it does not join are reached by nothing`); // prettier-ignore
  }
  if (failures.length) return { building: d, failures, warnings };

  // ── areas: each storey's rooms against the cells its footprint leaves ──
  const left = cellsLeft(d);
  const less = d.storeys > 1 ? ` (${d.footprint.cells[0] * d.footprint.cells[1]} less the stairwell's ${STAIRWELL_CELLS})` : ""; // prettier-ignore
  for (let s = 0; s < d.storeys; s++) {
    const rooms = d.rooms.filter((r) => r.storey === s);
    if (!rooms.length) {
      fail(`storey ${s} has no rooms; it wants rooms to cover its ${left} cells`);
      continue;
    }
    const least = rooms.reduce((n, r) => n + r.area[0], 0);
    const most = rooms.reduce((n, r) => n + r.area[1], 0);
    if (least > left) fail(`storey ${s}: its rooms want at least ${least} cells, the footprint leaves ${left}${less}`);
    if (most < left) fail(`storey ${s}: its rooms take at most ${most} cells, the footprint leaves ${left}${less} to fill`); // prettier-ignore
    for (const r of rooms) {
      const others = least - r.area[0];
      const room = left - others;
      if (r.area[0] > room) fail(`room ${r.id}: wants ${r.area[0]}-${r.area[1]} cells, the footprint left ${Math.max(0, room)}`); // prettier-ignore
    }
  }

  // ── reach: from the entrance through the doors and the stair ──
  const links = new Map(d.rooms.map((r) => [r.id, new Set()]));
  for (const [a, b] of d.doors) links.get(a).add(b), links.get(b).add(a);
  if (hasStair) links.get(d.stairFrom).add(d.stairTo), links.get(d.stairTo).add(d.stairFrom);
  const start = entrances.map((r) => r.id).join(" or ");
  const seen = new Set(entrances.map((r) => r.id));
  const queue = entrances.map((r) => r.id);
  while (queue.length) for (const n of links.get(queue.shift())) if (!seen.has(n)) seen.add(n), queue.push(n);
  for (const r of d.rooms) {
    if (seen.has(r.id)) continue;
    const own = [...links.get(r.id)];
    const why = own.length ? `its doors join only ${own.join(", ")}, which the entrance does not reach either` : "no door names it"; // prettier-ignore
    fail(`room ${r.id} (storey ${r.storey}) is not reached from the entrance ${start} through the doors and the stair: ${why}`); // prettier-ignore
  }
  return { building: d, failures, warnings };
}
