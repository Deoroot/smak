// A drive check: a vehicle's way along a line (no physics), read off the compiled map's tree in a chosen hull.
// Made from a rally map's hand-written check (KIT-FAULTS R6): the walk checks are for a player on foot, and a car holds to a
// line of waypoints: the floor under it, the step from one sample to the next, the slope, anything solid at its height on the
// line, and, for a map that fences the road with walls nobody sees, how far out each side the wall stands.
import { readBsp, contentsAt, floorUnder, CONTENTS } from "../../core/maps/bsp.mjs";
import { byClass, originOf, numberOf } from "../../core/maps/entities.mjs";

/** The distance between samples. */
const STEP = 32;
/** Over a sample's point the floor is looked for from this far up, down to this far (units): a line a little in the air or in the ground still has its floor. */
const UP = 40;
const REACH = 200;
/** The vehicle's height: solid at 4, half this and this over the floor, on the line, is the line running through something. */
const HIGH = 60;
/** The wall is looked for at this height over the floor, every 8 units out. */
const WALL_AT = 64;
const OUT = 8;
/** Limits. A step between neighbours over the engine's own stair (sv_stepsize, 18) stops a wheel; a slope of 50% (27 degrees) is a hill a car climbs slowly; a change of slope of 40 points of grade between samples 32 apart is a crest or a hollow that throws a car. */
const MAX_STEP = 18;
const MAX_SLOPE = 50;
const MAX_BUMP = 40;
const SHOWN = 6;

const at = (p) => p.map(Math.round).join(" ");
const round = (v, k = 1) => Math.round(v * 10 ** k) / 10 ** k;
const dist = (a, b) => Math.hypot(...a.map((v, k) => v - b[k]));

/** A line's points from the map's entities: `class` (a classname), `key` (the number to order them by; none: nearest next from the first). */
export function lineFrom(bsp, { class: name, key }) {
  const found = byClass(bsp.entities, name).map((entity) => ({ p: originOf(entity), n: key ? numberOf(entity, key) : undefined }));
  if (!found.length) throw new Error(`no entity of class ${name} in the map`);
  if (key) {
    if (found.some((one) => one.n === undefined)) throw new Error(`an entity of class ${name} has no number in "${key}"`);
    return found.sort((a, b) => a.n - b.n).map((one) => one.p);
  }
  const rest = found.map((one) => one.p);
  const line = [rest.shift()];
  while (rest.length) {
    const near = rest.reduce((best, p, i) => (dist(p, line.at(-1)) < dist(rest[best], line.at(-1)) ? i : best), 0);
    line.push(rest.splice(near, 1)[0]);
  }
  return line;
}

/** The points of a polyline, every `step` units along it, each with the way it runs (a unit vector, flat) . */
export function sampleLine(points, step = STEP, closed = false) {
  const route = closed ? [...points, points[0]] : points;
  const samples = [];
  let along = 0;
  let next = 0;
  for (let i = 0; i + 1 < route.length; i++) {
    const [a, b] = [route[i], route[i + 1]];
    const length = dist(a, b);
    const run = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    for (; next < along + length || (i + 2 === route.length && next <= along + length + 1e-6); next += step) {
      const f = length ? (next - along) / length : 0;
      samples.push({ p: a.map((v, k) => v + (b[k] - v) * f), dir: [(b[0] - a[0]) / run, (b[1] - a[1]) / run] });
    }
    along += length;
  }
  return samples;
}

/**
 * The drive over `bsp` along `line` (`points`, or `class` and `key` as `lineFrom`; `closed`). Options: `hull` (0), `step`, `high` (the vehicle's
 * height), `side` (how far out each side a wall is looked for; none: not asked), `half` (the road's half width: walls are measured from its
 * edge), `wallAt`, `maxStep`, `maxSlope` (%), `maxBump` (points of grade). `{ passed, said, warnings, facts, samples, noFloor, step, slope,
 * bump, blocked, walls }`: each measure with its place.
 */
export function driveOf(source, options = {}) {
  const bsp = Buffer.isBuffer(source) || source instanceof Uint8Array ? readBsp(source) : source;
  const { hull = 0, step = STEP, high = HIGH, side, half = 0, wallAt = WALL_AT, maxStep = MAX_STEP, maxSlope = MAX_SLOPE, maxBump = MAX_BUMP } = options;
  const points = options.points ?? (options.class ? lineFrom(bsp, options) : null);
  if (!points || points.length < 2) throw new Error("a line of two points at least: points, or class (and key)");
  const samples = sampleLine(points, step, options.closed);
  const noFloor = [];
  const blocked = [];
  const worst = { step: { v: 0 }, slope: { v: 0 }, bump: { v: 0 } };
  const over = { step: [], slope: [], bump: [] };
  const limit = { step: maxStep, slope: maxSlope, bump: maxBump };
  const note = (name, v, place) => {
    if (v > worst[name].v) worst[name] = { v, at: place };
    if (v > limit[name]) over[name].push({ v, at: place });
  };
  const walls = [];
  let open = 0;
  let prev = null;
  let before = null;
  for (const { p, dir } of samples) {
    const floor = floorUnder(bsp, [p[0], p[1], p[2] + UP], { hull, reach: REACH });
    if (floor === null) {
      if ([0, UP].some((z) => contentsAt(bsp, [p[0], p[1], p[2] + z], { hull }) === CONTENTS.SOLID)) blocked.push(at(p));
      else noFloor.push(at(p));
      prev = before = null;
      continue;
    }
    if (prev !== null) {
      const slope = ((floor - prev) / step) * 100;
      note("step", Math.abs(floor - prev), at(p));
      note("slope", Math.abs(slope), at(p));
      if (before !== null) note("bump", Math.abs(slope - before), at(p));
      before = slope;
    }
    prev = floor;
    if ([4, high / 2, high].some((z) => contentsAt(bsp, [p[0], p[1], floor + z], { hull }) === CONTENTS.SOLID)) blocked.push(at(p));
    if (side === undefined) continue;
    for (const sign of [1, -1]) {
      let found = null;
      for (let u = half; u <= half + side; u += OUT) {
        if (contentsAt(bsp, [p[0] - dir[1] * sign * u, p[1] + dir[0] * sign * u, floor + wallAt], { hull }) === CONTENTS.SOLID) {
          found = u - half;
          break;
        }
      }
      if (found === null) open++;
      else walls.push(found);
    }
  }
  walls.sort((a, b) => a - b);
  const listed = (list) => list.slice(0, SHOWN).join("; ") + (list.length > SHOWN ? `; and ${list.length - SHOWN} more` : "");
  const worstOf = (name) => over[name].reduce((a, b) => (b.v > a.v ? b : a));
  const warnings = [];
  if (noFloor.length) warnings.push(`${noFloor.length} samples with no floor within ${REACH} under them (hull ${hull}), at ${listed(noFloor)}`);
  if (over.step.length) warnings.push(`${over.step.length} steps between neighbouring samples over ${maxStep}, the largest ${round(worstOf("step").v)} at ${worstOf("step").at}`);
  if (over.slope.length) warnings.push(`${over.slope.length} slopes over ${maxSlope}%, the steepest ${round(worstOf("slope").v)}% at ${worstOf("slope").at}`);
  if (over.bump.length) warnings.push(`${over.bump.length} changes of slope over ${maxBump} points of grade, the sharpest ${round(worstOf("bump").v)} at ${worstOf("bump").at}`);
  if (blocked.length) warnings.push(`${blocked.length} samples with something solid on the line at ${high} units or less over the floor, at ${listed(blocked)}`);
  if (open) warnings.push(`${open} of ${samples.length * 2} sides with no wall within ${side} of the road's edge at ${wallAt} over the floor`);
  const mid = walls[Math.floor(walls.length / 2)];
  const facts = [
    `${samples.length} samples every ${step} units along ${points.length} points${options.closed ? ", closed" : ""}, hull ${hull}`,
    `floor-less ${noFloor.length}; largest step between neighbours ${round(worst.step.v)} at ${worst.step.at ?? "none"}; steepest slope ${round(worst.slope.v)}% at ${worst.slope.at ?? "none"}; sharpest change of slope ${round(worst.bump.v)} points of grade at ${worst.bump.at ?? "none"}; solid on the line ${blocked.length}`,
  ];
  if (side !== undefined) facts.push(`walls past the road's edge (half ${half}): min ${walls[0] ?? "none"} median ${mid ?? "none"} max ${walls.at(-1) ?? "none"}; sides with no wall within ${side}: ${open} of ${samples.length * 2}`);
  const faults = [noFloor.length && "floor", over.step.length && "step", over.slope.length && "slope", over.bump.length && "bump", blocked.length && "solid", open && "walls"].filter(Boolean);
  const said = faults.length ? `${faults.length} of the drive's measures over their limit (${faults.join(", ")}); ${facts[0]}` : `${facts[0]}; floor everywhere, steps up to ${round(worst.step.v)}, slopes up to ${round(worst.slope.v)}%, nothing solid on the line${side === undefined ? "" : `, a wall on every side within ${side}`}`;
  return { passed: !faults.length, said, warnings, facts, samples: samples.length, noFloor, step: worst.step, slope: worst.slope, bump: worst.bump, blocked, walls: { open, min: walls[0], median: mid, max: walls.at(-1) } };
}
