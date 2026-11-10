// levels/assembly/fronts.mjs: what a player meets as a door opens, and as a place to start loads (ARCHITECTURE 2.4, 2.5).
// Two checks over data a caller hands them, so that a broken case can be made without a compiled map:
//
//   checkDoorFronts   for each door of the doorway list, a trace from its middle at 40 over its floor outward along its
//                     front: FAIL when something solid is nearer than 72 units, or when it is solid at 10, 40 and 70 over the
//                     floor all within 112 (a wall or a column that fills the view of a player stepping out: the door
//                     views stand 72 off; 120 is the facing wall of the narrowest street), or when a standing player cannot stand on the front 36 out. The doors that a battery once passed ("doors PASS: 4 doors of the map's") were
//                     the 4 movers; the 14 street doors are teleports, and four of them looked at a wall or a column.
//   checkSpawnViews   from each spawn at eye height along its own yaw: FAIL under 128 to the first solid; WARN when the
//                     yaw is unset (0 by default) and another way is open the longer.
//
// `data.trace(from, to)` is the distance along the line to the first solid of the world, or null; `data.boxes` the solid
// boxes it does not know (`{ lo, hi, what }`: props, CLIP brushes, brush entities); `data.stands(feet)` is true, or what
// stops a standing player at those feet (a sentence). `data.say(point)` may name the face a point of the world's trace hit; `data.models(from, to)` is `{ distance, what }` for the first solid of the brush entities' own geometry, or null (a func_wall's box is a box of many things: it is not asked as a box).
export const FRONT_CLEAR = 72;
export const FRONT_STAND = 36;
export const FRONT_Z = 40;
/**
 * How far a wall that fills the view (solid at 10, 40 and 70 over the floor) must stand: the narrowest street of a plan is 2 cells (128) between
 * its facades, which puts the facing wall 120 from a door (8 for the door's set-back); a wall nearer than 112 is a column, a mass or a prop in the street.
 */
export const FRONT_VIEW = 112;
export const SPAWN_LOOK = 128;
export const EYE = 64;

/** The distance along a horizontal-or-not line to a box (slab test), or null. */
export function boxHit(from, to, box) {
  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 3; k++) {
    const d = to[k] - from[k];
    if (Math.abs(d) < 1e-9) {
      if (from[k] < box.lo[k] || from[k] > box.hi[k]) return null;
      continue;
    }
    let a = (box.lo[k] - from[k]) / d;
    let b = (box.hi[k] - from[k]) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0 * Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
}

/** The first solid on a line: `{ distance, what }` over the world and the boxes, or null. */
export function firstSolid(data, from, to) {
  let best = null;
  const world = data.trace(from, to);
  if (world !== null && world !== undefined) {
    const d = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const at = [0, 1, 2].map((k) => from[k] + ((to[k] - from[k]) * world) / d);
    best = { distance: world, what: data.say?.(at) ?? "the world's wall" };
  }
  const model = data.models?.(from, to);
  if (model && (best === null || model.distance < best.distance)) best = model;
  for (const box of data.boxes ?? []) {
    const hit = boxHit(from, to, box);
    if (hit !== null && (best === null || hit < best.distance)) best = { distance: hit, what: box.what };
  }
  return best;
}

export const compass = ([x, y]) => (Math.abs(x) > Math.abs(y) ? (x > 0 ? "east" : "west") : y > 0 ? "north" : "south");
const at3 = (p) => p.map(Math.round).join(" ");

/**
 * `data.doors`: `[{ name, middle: [x, y], floor, front: [fx, fy] }]` (front: the unit vector the door's outside runs along).
 * Returns `{ failures, warnings, measures }`; `measures.doors` is each door's `{ name, front, distance, what, stands }`.
 */
export function checkDoorFronts(data) {
  const failures = [];
  const measures = { doors: [], clear: FRONT_CLEAR, stand: FRONT_STAND };
  for (const d of data.doors) {
    const floor = d.floor ?? 0;
    const ray = (up, far) => firstSolid(data, [d.middle[0], d.middle[1], floor + up], [d.middle[0] + d.front[0] * far, d.middle[1] + d.front[1] * far, floor + up]);
    const hit = ray(FRONT_Z, FRONT_CLEAR);
    const view = [10, FRONT_Z, 70].map((up) => ray(up, FRONT_VIEW));
    const fills = view.every(Boolean) ? view.reduce((a, b) => (b.distance > a.distance ? b : a)) : null;
    const feet = [d.middle[0] + d.front[0] * FRONT_STAND, d.middle[1] + d.front[1] * FRONT_STAND, floor];
    const stands = data.stands(feet);
    const nearest = hit ?? view[1];
    measures.doors.push({ name: d.name, front: d.front, distance: nearest ? Math.round(nearest.distance) : null, what: nearest?.what ?? null, fills: !!fills, stands: stands === true });
    const where = `${d.name} at ${at3([...d.middle, d.floor ?? 0])}, its front ${compass(d.front)}`;
    const source = "a door with a wall or column before it cannot be used: owner's walk of byz02 2026-11-08, seen again in the door views 2026-11-10";
    if (hit) failures.push(`${where}: ${hit.what} stands ${Math.round(hit.distance)} units before it, under the ${FRONT_CLEAR} a player needs (${source})`);
    else if (fills) failures.push(`${where}: ${fills.what} fills the view, solid from 10 to 70 over the floor within ${Math.round(fills.distance)} units, under the ${FRONT_VIEW} that shows the street to a player stepping out (${source})`);
    else if (stands !== true) failures.push(`${where}: a standing player (32 x 32 x 72) cannot stand ${FRONT_STAND} out from it: ${stands} (${source})`);
  }
  return { failures, warnings: [], measures };
}

const EIGHT = Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)]);
const FAR = 1024;

/** How far a line from `from` along the yaw (degrees) goes before the first solid, up to FAR. */
export function lookDistance(data, from, yaw) {
  const r = (yaw * Math.PI) / 180;
  const hit = firstSolid(data, from, [from[0] + Math.cos(r) * FAR, from[1] + Math.sin(r) * FAR, from[2]]);
  return hit ? hit.distance : FAR;
}

/**
 * The yaw (degrees, of eight) that looks the farthest from a spot: `{ yaw, distance }`, ties to the first (east, then counter-clockwise).
 */
export function longestOpen(data, from) {
  let best = null;
  EIGHT.forEach((v, i) => {
    const distance = lookDistance(data, from, i * 45);
    if (!best || distance > best.distance + 1) best = { yaw: i * 45, distance };
  });
  return best;
}

/**
 * `data.spawns`: `[{ number, from: [x, y, z at the eye], yaw, set }]`, `set` false when the entity has no angle. Returns
 * `{ failures, warnings, measures }`; `measures.spawns` has each spawn's `{ number, yaw, distance, best }`.
 */
export function checkSpawnViews(data) {
  const failures = [];
  const warnings = [];
  const measures = { spawns: [], look: SPAWN_LOOK };
  for (const s of data.spawns) {
    const distance = lookDistance(data, s.from, s.yaw);
    const best = longestOpen(data, s.from);
    measures.spawns.push({ number: s.number, yaw: s.yaw, distance: Math.round(distance), best });
    const where = `spawn ${s.number} at ${at3(s.from)}, looking yaw ${s.yaw}`;
    if (distance < SPAWN_LOOK) failures.push(`${where}: the first solid is ${Math.round(distance)} units away, under ${SPAWN_LOOK}; the longest open way is yaw ${best.yaw} (${Math.round(best.distance)}) (a player spawning into a wall: the eye views of byz02, 2026-11-10)`);
    else if (!s.set && best.yaw !== s.yaw && best.distance > distance * 2) warnings.push(`${where}: the entity has no angle (0 by default) and the open side is elsewhere: yaw ${best.yaw} sees ${Math.round(best.distance)}, this ${Math.round(distance)}`);
  }
  return { failures, warnings, measures };
}
