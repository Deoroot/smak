// Ground in plan: spaces of any outline (a plaza of five sides, a hall shaped like an L, a yard with a well in
// it) carved out of one block of rock, as `carve` does with boxes; paths and curves that bend, for streets,
// tunnels and tracks; and the outlines a person draws read from a sketch (sketch.mjs).
//
// A space is a shape in plan between a floor and a ceiling. What is not a space is rock, so, as with
// `carve`, no gap can be left and the map cannot leak. The rock is cut into convex brushes by the outlines
// themselves: within each band of heights the plan is cut into strips at every corner and every crossing
// of two outlines, each strip into the pieces between the outlines that cross it, and the pieces of rock
// are joined again wherever two of them make one convex piece. Walls run along the outlines as drawn, at
// any angle.
//
// An outline is a list of [x, y] points, either way round, closed by itself (the last point joins the
// first). A space is given as
//   { outline: ring }                 one outline
//   { outlines: [ring, ...] }         several, the space where any of them is (a path's pieces, overlapping)
//   { rings: [ring, ...] }            one shape with holes: inside where an odd number of rings are about
//                                     the point (a yard round a well, a ring of road round a block)
//   { areas: [[ring, ...], ...] }     several shapes with holes, the space where any of them is
// with its `floor` and `ceiling` (heights), and a `texture` of its own if it wears one: `{ floor, ceiling,
// wall }`, or one name for all three. `slope: { rise, toward }` makes its floor a ramp that climbs `rise`
// units across it towards `toward` degrees (0 east, 90 north) from `floor` on its lowest side.
import { prism, planeOf, solid, onFloor, box } from "./source.mjs";

// ── constants ───────────────────────────────────────────────────────────────
/**
 * Two cuts along x nearer than this are one (units), the whole one kept: a crossing a hair from a corner
 * would leave a strip too thin for the compiler to work out.
 */
const SAME_CUT = 0.5;
/** A piece thinner than this, or two points nearer, is nothing (units). */
const NOTHING = 1e-4;
/** A turn this small, in the cross product of two edges of length 1, is no turn: the points are in a line. */
const IN_LINE = 1e-7;
/**
 * A corner of an outline that turns less than this (degrees), or strays less than STRAIGHT_BY units from the
 * line past it, is made straight: two faces of a brush nearly in one plane are what the compiler calls an
 * "edge without opposite face".
 */
const STRAIGHT_TURN = 1;
const STRAIGHT_BY = 0.5;
/** A sloped floor's brushes reach this far under the floor, into the rock, so that none is thin at its foot. */
const SLOPE_BED = 16;
/** Rock thinner than this between two outlines is a sliver, left open (units). */
const SLIVER = 1;
/**
 * An edge whose ends are this near another space's line is on it (units): the corners of a turned drawing rounded
 * to whole units one by one stray up to 0.7 off the lines they were drawn on.
 */
const WELD = 1;
/** Two edges whose ways differ by less than this (the sine of the angle between them: 3 degrees) may be one line. */
const WELD_TURN = 0.05;
/** A piece's end narrower than this (units) is a point: where its two lines cross. */
const TINY_END = 0.5;
/** How far past a face of rock the space it faces is looked for (units). */
const PROBE = 0.5;
/** Under a sky of air: the clearance over the highest roof (units), and the thickness of the sky box. */
const SKY_CLEAR = 128;
const SKY_WALL = 64;
/** Where along a face of rock the space it faces is looked for: the most often found wins. */
const PROBES_ALONG = [0.1, 0.3, 0.5, 0.7, 0.9];

// ── small arithmetic in plan ────────────────────────────────────────────────
const tidy = (value) => Math.round(value * 1e9) / 1e9 + 0;
const samePoint = (a, b) => Math.abs(a[0] - b[0]) < NOTHING && Math.abs(a[1] - b[1]) < NOTHING;
/** Twice the signed area of an outline: over 0 when it runs anticlockwise (+x east, +y north). */
const signedArea = (ring) =>
  ring.reduce((sum, point, i) => {
    const next = ring[(i + 1) % ring.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
/** Whether a point is inside an odd number of the rings (the even-odd rule). */
function insideRings(rings, [x, y]) {
  let inside = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}
/** Whether a point in plan is in a space (in any of its areas). */
const inPlan = (space, point) => space.areas.some((rings) => insideRings(rings, point));

/** A ring with repeated points and points in a line taken out. */
function cleanRing(ring) {
  let points = ring.filter((point, i) => !samePoint(point, ring[(i + ring.length - 1) % ring.length]));
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    for (let i = 0; i < points.length; i++) {
      const before = points[(i + points.length - 1) % points.length];
      const here = points[i];
      const after = points[(i + 1) % points.length];
      const a = [here[0] - before[0], here[1] - before[1]];
      const b = [after[0] - here[0], after[1] - here[1]];
      const turn = (a[0] * b[1] - a[1] * b[0]) / ((Math.hypot(...a) || 1) * (Math.hypot(...b) || 1));
      if (Math.abs(turn) < IN_LINE && a[0] * b[0] + a[1] * b[1] > 0) {
        points.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return points;
}

/** The turn at a corner, in degrees, and how far the corner strays from the line between its neighbours. */
function turnAt(before, here, after) {
  const a = [here[0] - before[0], here[1] - before[1]];
  const b = [after[0] - here[0], after[1] - here[1]];
  const degrees =
    (Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])) * 180) / Math.PI;
  const c = [after[0] - before[0], after[1] - before[1]];
  const length = Math.hypot(...c) || 1;
  const strays = Math.abs(c[0] * (before[1] - here[1]) - c[1] * (before[0] - here[0])) / length;
  return { degrees, strays };
}

/** An outline with each corner that hardly turns taken out (STRAIGHT_TURN, STRAIGHT_BY). */
function straightRing(ring) {
  const points = [...ring];
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    for (let i = 0; i < points.length && points.length > 3; i++) {
      const { degrees, strays } = turnAt(
        points[(i + points.length - 1) % points.length],
        points[i],
        points[(i + 1) % points.length],
      );
      if (degrees < STRAIGHT_TURN || strays < STRAIGHT_BY) {
        points.splice(i, 1);
        changed = true;
      }
    }
  }
  return points;
}

// ── spaces ──────────────────────────────────────────────────────────────────
/** A ring checked: three points or more, each two finite numbers. */
function checkedRing(ring, who) {
  if (!Array.isArray(ring) || ring.length < 3)
    throw new Error(`${who}: an outline has three points at least`);
  for (const point of ring)
    if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]))
      throw new Error(`${who}: a point of an outline is [x, y], not ${JSON.stringify(point)}`);
  const clean = straightRing(cleanRing(ring.map(([x, y]) => [x, y])));
  if (clean.length < 3 || Math.abs(signedArea(clean)) < NOTHING)
    throw new Error(`${who}: an outline with no area (its points are in a line)`);
  return clean;
}

/** A space as `{ areas, floor, ceiling, texture, name }`, from any of the ways one is given. */
export function planSpace(space, nth = 0) {
  const who = `space ${space?.name ?? nth}`;
  if (!space || typeof space !== "object") throw new Error(`${who}: a space is an object`);
  let areas;
  if (space.areas) areas = space.areas;
  else if (space.rings) areas = [space.rings];
  else if (space.outlines) areas = space.outlines.map((ring) => [ring]);
  else if (space.outline) areas = [[space.outline]];
  else throw new Error(`${who}: no outline (outline, outlines, rings or areas)`);
  if (!Array.isArray(areas) || !areas.length) throw new Error(`${who}: no outline`);
  areas = areas.map((rings) => {
    if (!Array.isArray(rings) || !rings.length) throw new Error(`${who}: an area is a list of rings`);
    return rings.map((ring) => checkedRing(ring, who));
  });
  if (!Number.isFinite(space.floor) || !Number.isFinite(space.ceiling))
    throw new Error(`${who}: its floor and ceiling are heights, not ${space.floor} and ${space.ceiling}`);
  if (!(space.ceiling > space.floor))
    throw new Error(`${who}: its ceiling (${space.ceiling}) is not over its floor (${space.floor})`);
  return { ...space, areas, name: space.name ?? String(nth) };
}

/** The first space (its number) a point is in: in its plan and between its floor and ceiling; -1 for none. */
export function spaceAt(spaces, [x, y, z]) {
  return spaces.findIndex((space) => space.floor <= z && z <= space.ceiling && inPlan(space, [x, y]));
}

/** The box round spaces in plan: `{ min: [x, y], max: [x, y] }`. */
function planBounds(spaces) {
  const points = spaces.flatMap((space) => space.areas.flat(2));
  return {
    min: [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))],
    max: [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))],
  };
}

/**
 * A point inside a space, as near its middle as comes: the middle of its box when that is in it, else the
 * middle of the widest stretch of it across that line or the lines near it (a ring of road, an L).
 */
export function pointIn(space) {
  const made = space.areas ? space : planSpace(space);
  const { min, max } = planBounds([made]);
  const middle = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  if (inPlan(made, middle)) return middle.map(tidy);
  const rows = 16;
  let best = null;
  for (let row = 0; row <= rows; row++) {
    const y = min[1] + ((max[1] - min[1]) * (row + 0.5)) / (rows + 1);
    // where the row crosses the outlines, then the widest stretch of it inside
    const crossings = [];
    for (const ring of made.areas.flat())
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if (a[1] > y !== b[1] > y) crossings.push(a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]));
      }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i++) {
      const point = [(crossings[i] + crossings[i + 1]) / 2, y];
      const width = crossings[i + 1] - crossings[i];
      const score = width - Math.abs(y - middle[1]) * 0.5;
      if (width > NOTHING && inPlan(made, point) && (!best || score > best.score)) best = { point, score };
    }
  }
  if (!best) throw new Error(`pointIn: space ${made.name}: no point found inside it`);
  return best.point.map(tidy);
}

// ── the rock, cut in plan ───────────────────────────────────────────────────
/**
 * A straight line through two points, as the cuts know it: `{ key, y(x) }`. Two edges on one line (the
 * walls of two rooms that meet) share the key.
 */
function lineOf(a, b) {
  let nx = -(b[1] - a[1]);
  let ny = b[0] - a[0];
  const length = Math.hypot(nx, ny);
  nx /= length;
  ny /= length;
  if (ny < 0 || (ny === 0 && nx < 0)) [nx, ny] = [-nx, -ny];
  const c = nx * a[0] + ny * a[1];
  const key = `${tidy(nx).toFixed(7)},${tidy(ny).toFixed(7)},${tidy(c).toFixed(4)}`;
  return { key, y: (x) => a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]), a, b };
}
/** A level line, y = value. */
const levelLine = (value) => ({
  key: `0,1,${value.toFixed(4)}`,
  y: () => value,
  a: [0, value],
  b: [1, value],
});

/** The x where two lines (lineOf) cross, or null when they run side by side. */
function crossingOfLines(p, q) {
  const slope = (line) => (line.b[1] - line.a[1]) / (line.b[0] - line.a[0]);
  const [m, n] = [slope(p), slope(q)];
  if (Math.abs(m - n) < 1e-12) return null;
  return (q.y(0) - p.y(0)) / (m - n);
}

/** Where two edges cross, strictly inside both: its x, or null. */
function crossingX(p, q) {
  const r = [p.b[0] - p.a[0], p.b[1] - p.a[1]];
  const s = [q.b[0] - q.a[0], q.b[1] - q.a[1]];
  const denominator = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denominator) < 1e-12) return null;
  const qp = [q.a[0] - p.a[0], q.a[1] - p.a[1]];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / denominator;
  const u = (qp[0] * r[1] - qp[1] * r[0]) / denominator;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return p.a[0] + r[0] * t;
}

/**
 * The rock in plan within `bounds`, where none of the `open` spaces is: convex outlines, anticlockwise.
 * The plan is cut into strips at every corner and crossing, each strip into the pieces between the edges
 * that cross it, and the pieces of rock that make one convex piece together are joined.
 */
function rockInPlan(bounds, open, seen, tagOf, keepOpen = false) {
  const edges = [];
  for (const space of [...open, ...seen])
    for (const ring of space.areas.flat())
      for (let i = 0; i < ring.length; i++) {
        let a = ring[i];
        let b = ring[(i + 1) % ring.length];
        if (Math.abs(a[0] - b[0]) < NOTHING) continue;
        if (a[0] > b[0]) [a, b] = [b, a];
        edges.push({ a, b });
      }
  const cuts = [bounds.min[0], bounds.max[0]];
  for (const edge of edges) cuts.push(edge.a[0], edge.b[0]);
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const first = edges[i];
      const second = edges[j];
      if (first.b[0] <= second.a[0] || second.b[0] <= first.a[0]) continue;
      const x = crossingX(first, second);
      if (x !== null) cuts.push(x);
    }
  cuts.sort((a, b) => a - b);
  const isWhole = (x) => Math.abs(x - Math.round(x)) < 1e-6;
  const xs = [];
  for (const x of cuts) {
    const last = xs.length - 1;
    if (last < 0 || x - xs[last] > SAME_CUT) xs.push(x);
    else if (!isWhole(xs[last]) && isWhole(x)) xs[last] = x;
  }
  // the block's own ends stay where they are
  xs[0] = cuts[0];
  xs[xs.length - 1] = cuts[cuts.length - 1];
  const inOpen = (point) => open.some((space) => inPlan(space, point));
  const below = levelLine(bounds.min[1]);
  const above = levelLine(bounds.max[1]);
  const pieces = [];
  let running = new Map();
  for (let k = 0; k + 1 < xs.length; k++) {
    const x0 = xs[k];
    const x1 = xs[k + 1];
    const middle = (x0 + x1) / 2;
    const lines = new Map([
      [below.key, below],
      [above.key, above],
    ]);
    for (const edge of edges)
      if (edge.a[0] <= x0 + SAME_CUT && edge.b[0] >= x1 - SAME_CUT) {
        const line = lineOf(edge.a, edge.b);
        if (!lines.has(line.key)) lines.set(line.key, line);
      }
    const sorted = [...lines.values()].sort((p, q) => p.y(middle) - q.y(middle));
    // the stretches of the strip between the lines, rock or open; rock beside rock under and over the
    // same spaces is one stretch (a line that only parts the pieces of one space parts nothing)
    const stretches = [];
    for (let i = 0; i + 1 < sorted.length; i++) {
      const low = sorted[i];
      const high = sorted[i + 1];
      const yLow = low.y(middle);
      const yHigh = high.y(middle);
      if (yHigh - yLow < NOTHING || yLow < bounds.min[1] - NOTHING || yHigh > bounds.max[1] + NOTHING)
        continue;
      const inside = [middle, (yLow + yHigh) / 2];
      const rock = !inOpen(inside);
      const tag = rock ? tagOf(inside) : null;
      const last = stretches[stretches.length - 1];
      if (last && last.rock === rock && last.tag === tag && last.high === low) last.high = high;
      else stretches.push({ low, high, rock, tag });
    }
    const next = new Map();
    for (const { low, high, rock, tag } of stretches) {
      if (rock === keepOpen) continue;
      // a sliver between two outlines (two shapes drawn almost touching) is no wall: it is left open, and
      // the compiler is spared a brush thinner than it can work out
      const thin = (x) => high.y(x) - low.y(x) < SLIVER;
      const openBeside =
        inOpen([middle, low.y(middle) - SLIVER]) && inOpen([middle, high.y(middle) + SLIVER]);
      if (rock && low !== below && high !== above && thin(x0) && thin(x1) && openBeside) continue;
      // the piece goes on from the strip before when it lies between the same two lines
      const key = `${low.key}|${high.key}`;
      const piece = running.get(key) ?? { low, high, x0, tag };
      piece.x1 = x1;
      if (!running.has(key)) pieces.push(piece);
      next.set(key, piece);
    }
    running = next;
  }
  // two lines that cross within SAME_CUT of a cut may cross inside the strip: the piece ends at their crossing,
  // or its outline would twist on itself
  // (and one that ends a hair short of their crossing ends at it: not in an edge a tenth of a unit long, which
  // the compiler cannot tell from none)
  const ends = (low, high, x) => {
    const gap = high.y(x) - low.y(x);
    if (gap >= TINY_END) return [[x, low.y(x)], [x, high.y(x)]];
    const at = crossingOfLines(low, high);
    if (gap < 0) return [[at ?? x, low.y(at ?? x)], [at ?? x, low.y(at ?? x)]];
    if (at === null || Math.abs(at - x) > SAME_CUT) return [[x, low.y(x)], [x, high.y(x)]];
    return [[at, low.y(at)], [at, low.y(at)]];
  };
  const outlines = pieces.map(({ low, high, x0, x1, tag }) => {
    const [lowStart, highStart] = ends(low, high, x0);
    const [lowEnd, highEnd] = ends(low, high, x1);
    return { tag, ring: cleanRing([lowStart, lowEnd, highEnd, highStart]).map((point) => point.map(tidy)) };
  });
  return joinConvex(outlines.filter(({ ring }) => ring.length >= 3 && signedArea(ring) > NOTHING));
}

/**
 * A space's own ground in plan cut into convex outlines, anticlockwise: what a brush that fills the space (a
 * sloped floor, a pool of water, a trigger the shape of a yard) is made of, one brush a piece.
 */
export function convexPieces(space) {
  const made = space.areas ? space : planSpace(space);
  const bounds = planBounds([made]);
  return rockInPlan(bounds, [made], [], () => "", true).map(({ ring }) => ring);
}

/** Whether an anticlockwise outline is convex (no turn to the right). */
function convex(ring) {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const c = ring[(i + 2) % ring.length];
    const turn = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (turn < -1e-6 * (Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]) || 1))
      return false;
  }
  return true;
}

/**
 * Convex outlines (`{ ring, tag }`) joined two by two wherever they share a whole edge, wear the same tag
 * (what is over and under them) and the two together are convex, until no more can be: fewer brushes, and
 * walls of one piece.
 */
function joinConvex(outlines) {
  const pieces = outlines.map(({ ring }) => ring.map((point) => [...point]));
  const tags = outlines.map(({ tag }) => tag);
  const keyOf = (a, b) => `${a[0].toFixed(4)},${a[1].toFixed(4)}>${b[0].toFixed(4)},${b[1].toFixed(4)}`;
  let joined = true;
  while (joined) {
    joined = false;
    const edges = new Map();
    pieces.forEach((ring, nth) => {
      if (!ring) return;
      ring.forEach((point, i) => edges.set(keyOf(point, ring[(i + 1) % ring.length]), { nth, i }));
    });
    for (const [nth, ring] of pieces.entries()) {
      if (!ring) continue;
      for (let i = 0; i < ring.length && !joined; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const other = edges.get(keyOf(b, a));
        if (!other || other.nth === nth || !pieces[other.nth] || tags[other.nth] !== tags[nth]) continue;
        const them = pieces[other.nth];
        // this ring from b round to a, then theirs from a round to b
        const mine = [...ring.slice(i + 1), ...ring.slice(0, i + 1)];
        const theirs = [...them.slice(other.i + 1), ...them.slice(0, other.i + 1)];
        const together = cleanRing([...mine.slice(0, -1), ...theirs.slice(0, -1)]);
        if (together.length < 3 || !convex(together) || signedArea(together) <= NOTHING) continue;
        // a corner left nearly straight would be two faces nearly in one plane
        const nearlyStraight = together.some((point, k) => {
          const { degrees } = turnAt(
            together[(k + together.length - 1) % together.length],
            point,
            together[(k + 1) % together.length],
          );
          return degrees < STRAIGHT_TURN;
        });
        if (nearlyStraight) continue;
        pieces[nth] = together;
        pieces[other.nth] = null;
        joined = true;
      }
      if (joined) break;
    }
  }
  return pieces.flatMap((ring, nth) => (ring ? [{ ring, tag: tags[nth] }] : []));
}

/**
 * The outlines of spaces welded where they meet, so that what was drawn as one place is one place after a turn
 * and the rounding of each corner to whole units: an edge whose two ends lie within WELD of another space's longer
 * edge's line, near its way (a door's end drawn on a room's wall, two spaces drawn touching, the walls of a row of
 * rooms drawn on one line) is put on that line, each corner where its two edges' lines cross, so every line kept is
 * kept exactly. Without it a door's end lands a few tenths off its room's wall and the carve leaves a wedge of rock
 * across the door, two touching spaces a wall 0.6 thick between them, and ambiguous leaves where the walls of a
 * row are planes a hair apart (the plaza's drawing: 21 such pairs of planes, 2 to 8 ambiguous leaves; 0 and 0).
 */
function weldOutlines(made) {
  const owners = made.flatMap((space, nth) => space.areas.flat().map((ring) => ({ ring, nth })));
  // each edge's line, the longest first; an edge near a longer one's line (of another space) takes that line
  const edges = owners.flatMap(({ ring, nth }) =>
    ring.map((a, i) => {
      const b = ring[(i + 1) % ring.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return { nth, a, way: [(b[0] - a[0]) / length, (b[1] - a[1]) / length], ends: [a, b], length };
    }),
  );
  const off = (line, [x, y]) => Math.abs((x - line.a[0]) * line.way[1] - (y - line.a[1]) * line.way[0]);
  const byLength = [...edges].sort((p, q) => q.length - p.length);
  for (const [k, edge] of byLength.entries()) {
    if (edge.line) continue;
    edge.line = edge;
    for (const other of byLength.slice(k + 1))
      if (!other.line && other.nth !== edge.nth && Math.abs(other.way[0] * edge.way[1] - other.way[1] * edge.way[0]) < WELD_TURN && other.ends.every((end) => off(edge, end) < WELD)) // prettier-ignore
        other.line = edge;
  }
  // each corner where the lines of its two edges cross
  let at = 0;
  for (const { ring } of owners) {
    const own = edges.slice(at, (at += ring.length));
    const moved = ring.map((point, i) => {
      const p = own[(i + ring.length - 1) % ring.length].line;
      const q = own[i].line;
      if (p === own[(i + ring.length - 1) % ring.length] && q === own[i]) return point;
      const across = p.way[0] * q.way[1] - p.way[1] * q.way[0];
      if (Math.abs(across) < IN_LINE) return point;
      const t = ((q.a[0] - p.a[0]) * q.way[1] - (q.a[1] - p.a[1]) * q.way[0]) / across;
      const to = [p.a[0] + p.way[0] * t, p.a[1] + p.way[1] * t];
      return Math.hypot(to[0] - point[0], to[1] - point[1]) < 2 * WELD ? to : point;
    });
    moved.forEach((point, i) => (ring[i] = point));
  }
  return made.map((space) => ({ ...space, areas: space.areas.map((rings) => rings.map(cleanRing)) }));
}

// ── carving ─────────────────────────────────────────────────────────────────
/** A room's three textures from what was given: `{ floor, ceiling, wall }`, or one thing for all three. */
function wornBy(texture) {
  const named = texture && typeof texture === "object" && !texture.name;
  if (named && (texture.floor || texture.ceiling || texture.wall)) {
    const any = texture.wall ?? texture.floor ?? texture.ceiling;
    return { floor: texture.floor ?? any, ceiling: texture.ceiling ?? any, wall: texture.wall ?? any };
  }
  return { floor: texture, ceiling: texture, wall: texture };
}

/**
 * Spaces of any outline carved out of one block of rock that wraps them with `wall` units to spare: what is
 * not a space is rock, so the map cannot leak. Spaces that overlap or touch join (a path into a plaza; a
 * stair hall over a shop, when one's ceiling is the other's floor no rock is left between them). The walls
 * follow the outlines as drawn, at any angle.
 *
 * `texture`: `{ floor, ceiling, wall }` (or one for all), worn wherever a space brings none of its own; each
 * face of rock wears the texture of the space it is seen from (the floor on its top, the ceiling on its
 * underside, the wall on its sides). A face of rock seen from two spaces of different textures wears the one
 * seen along most of it. An outdoor space is one whose ceiling is `sky`: the rock over it is sky all round,
 * as the compilers want a brush of sky.
 *
 * It returns the list of brushes, every one a convex prism standing upright.
 */
export function carvePlan(spaces, wall, texture) {
  if (!Array.isArray(spaces) || !spaces.length) throw new Error("carvePlan: a list of spaces");
  if (!(wall > 0)) throw new Error(`carvePlan: the rock round the spaces needs a thickness, not ${wall}`);
  const made = weldOutlines(spaces.map((space, nth) => planSpace(space, nth)));
  const plan = planBounds(made);
  const bounds = {
    min: [plan.min[0] - wall, plan.min[1] - wall],
    max: [plan.max[0] + wall, plan.max[1] + wall],
  };
  const low = Math.min(...made.map((space) => space.floor)) - wall;
  const fallback = wornBy(texture);
  // a space's own textures; a part it does not name (a yard that names only its sky) wears the carve's
  const worn = made.map(({ texture: own }) => {
    if (own === undefined) return fallback;
    const parts = own && typeof own === "object" && !own.name;
    if (!parts) return wornBy(own);
    return {
      floor: own.floor ?? fallback.floor,
      ceiling: own.ceiling ?? fallback.ceiling,
      wall: own.wall ?? fallback.wall,
    };
  });
  /**
   * Where each space's rock turns to sky (Infinity: it does not). Outdoors, at its horizon. A room with a `horizon`
   * (its roof line) keeps a stone roof over its ceiling, `wall` thick at least, to the horizon, and sky over that.
   */
  const skyFrom = made.map((space, nth) =>
    !(space.horizon > 0)
      ? Infinity
      : isSky(worn[nth].ceiling)
        ? space.floor + space.horizon
        : Math.max(space.floor + space.horizon, space.ceiling + wall),
  );
  // a space with a horizon makes the sky air: over every roof and rim the volume is empty up to one slab of sky, with
  // four walls of sky round the plan, the only sky there is (one that is solid hides what stands behind it)
  const skied = skyFrom.some((at) => at < Infinity);
  const highest = Math.max(...made.map((space) => space.ceiling));
  const high = skied ? Math.max(highest, Math.max(...skyFrom.filter((at) => at < Infinity)) + SKY_CLEAR) : highest + wall;
  const levels = [
    ...new Set([
      low,
      high,
      ...made.flatMap((space) => [space.floor, space.ceiling]),
      ...made.flatMap((space, nth) => (skyFrom[nth] < high ? [skyFrom[nth]] : [])),
    ]),
  ].sort((a, b) => a - b);
  /** The space (its number) seen from a point; -1 for none. */
  const seenFrom = (point) => spaceAt(made, point);
  /** Each space's least corner in plan: where its walls' pictures start. */
  const corners = made.map((space) => {
    const points = space.areas.flat(2);
    return [0, 1].map((k) => Math.min(...points.map((p) => p[k])));
  });
  /**
   * A wall's picture standing on the floor of the space it faces and starting at that space's corner, as `carve`
   * lines its walls up (onFloor): along +y on a face that looks along x most, along +x on one that looks along y.
   */
  /** Whether walls seen from spaces `a` and `b` (-1: none) line up alike: on one floor, from one corner. */
  const linesUp = (a, b) =>
    a < 0 || b < 0 || a === b || (made[a].floor === made[b].floor && corners[a].every((v, k) => v === corners[b][k]));
  const standing = (side, normal) =>
    side.nth < 0 || isSky(side.wears)
      ? side.wears
      : onFloor(side.wears, made[side.nth].floor, corners[side.nth][Math.abs(normal[0]) >= Math.abs(normal[1]) ? 1 : 0]);
  // a face that looks at no space (the block's outside) never wears the sky: the brush would be sky all round,
  // and the ground under an outdoor map with it
  const outside = (part) =>
    isSky(fallback[part])
      ? ([fallback.wall, fallback.floor, fallback.ceiling].find((each) => !isSky(each)) ?? fallback[part])
      : fallback[part];
  const wearing = (nth, part) => (nth < 0 ? outside(part) : worn[nth][part]);
  /** The sky texture round space `nth`: its own ceiling's outdoors, a room's takes the first outdoor space's, or "sky". */
  const skyOf = (nth) =>
    isSky(worn[nth].ceiling) ? worn[nth].ceiling : (worn.find((each) => isSky(each.ceiling))?.ceiling ?? "sky");
  /** The space whose sky starts lowest: `{ nth, at }`, or null when none has one. */
  const lowestHorizon = made.reduce((best, space, nth) => {
    if (!(skyFrom[nth] < Infinity)) return best;
    const at = skyFrom[nth];
    return best && best.at <= at ? best : { nth, at };
  }, null);
  /** Whether rock from z up, seen from outdoor space `nth`, is over its horizon: drawn as sky. */
  const overHorizon = (nth, z) => nth >= 0 && z >= skyFrom[nth];

  // every outline's edges, by their line, for the planes' whole points
  const lines = new Map();
  for (const space of made)
    for (const ring of space.areas.flat())
      ring.forEach((a, i) => {
        const b = ring[(i + 1) % ring.length];
        if (Math.abs(a[0] - b[0]) < NOTHING) return;
        const line = a[0] < b[0] ? lineOf(a, b) : lineOf(b, a);
        if (!lines.has(line.key)) lines.set(line.key, line);
      });
  const brushes = [];
  let before = new Map();
  for (let level = 0; level + 1 < levels.length; level++) {
    const z0 = levels[level];
    const z1 = levels[level + 1];
    const open = made.filter((space) => space.floor <= z0 && space.ceiling >= z1);
    const middle = (z0 + z1) / 2;
    const now = new Map();
    // the spaces just over and under the band cut its rock too, so that each piece's top and underside
    // look into one space
    // (and, under a sky of air, the rooms without a horizon below the band: their rock stands to the slab)
    const columns = skied ? made.filter((space) => !(space.horizon > 0) && space.ceiling <= z0) : [];
    const seen = made.filter(
      (space) => !open.includes(space) && (space.floor === z1 || space.ceiling === z0 || columns.includes(space)),
    );
    const columnOf = ([x, y]) => columns.findIndex((space) => inPlan(space, [x, y]));
    const tagOf = ([x, y]) =>
      [seenFrom([x, y, z1 + PROBE]), seenFrom([x, y, z0 - PROBE]), columnOf([x, y])].join("/");
    for (const { ring: outline, tag } of rockInPlan(bounds, open, seen, tagOf)) {
      const [over, under, column] = tag.split("/").map(Number);
      // each side's texture: the space seen most along it
      const sides = outline.map((a, i) => {
        const b = outline[(i + 1) % outline.length];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const out = [(b[1] - a[1]) / length, -(b[0] - a[0]) / length];
        const counts = new Map();
        for (const t of PROBES_ALONG) {
          const nth = seenFrom([
            a[0] + (b[0] - a[0]) * t + out[0] * PROBE,
            a[1] + (b[1] - a[1]) * t + out[1] * PROBE,
            middle,
          ]);
          counts.set(nth, (counts.get(nth) ?? 0) + (nth < 0 ? 0.5 : 1));
        }
        const nth = [...counts.entries()].sort((p, q) => q[1] - p[1])[0][0];
        return { out, nth, wears: wearing(nth, "wall") };
      });
      // rock over the horizons is air (the one sky is the outer box, below), so that the ground looks out over a land
      // beyond and not up a cliff to the top of the map
      // (rock that no space sees goes too, or it would hang in the sky its neighbours became)
      const looking = sides.filter((side) => side.nth >= 0);
      if (
        lowestHorizon !== null &&
        column < 0 &&
        z0 >= lowestHorizon.at &&
        looking.every((side) => overHorizon(side.nth, z0)) &&
        over < 0 &&
        (under < 0 || isSky(worn[under].ceiling))
      )
        continue;
      const key = JSON.stringify([outline, sides.map((side) => side.wears)]);
      const piece = before.get(key);
      // a piece over another of the same outline and textures goes on it, each side seeing the space either sees
      // (a wall's foot under the floor sees none): not where they see two spaces whose walls line up otherwise
      if (piece && piece.z1 === z0 && piece.sides.every((side, i) => linesUp(side.nth, sides[i].nth))) {
        piece.z1 = z1;
        piece.over = over;
        piece.sides.forEach((side, i) => {
          if (side.nth < 0) side.nth = sides[i].nth;
        });
        now.set(key, piece);
      } else {
        const fresh = { outline, sides, z0, z1, over, under };
        brushes.push(fresh);
        now.set(key, fresh);
      }
    }
    before = now;
  }
  // the one sky: a slab over everything and four walls round the block, from its lowest rock to the slab
  const skyBox = (() => {
    if (!skied) return [];
    const sky = skyOf(lowestHorizon.nth);
    const [x0, y0] = [bounds.min[0] - SKY_WALL, bounds.min[1] - SKY_WALL];
    const [x1, y1] = [bounds.max[0] + SKY_WALL, bounds.max[1] + SKY_WALL];
    const top = high + SKY_WALL;
    return [
      box([x0, y0, high], [x1, y1, top], sky),
      box([x0, y0, low], [bounds.min[0], y1, high], sky),
      box([bounds.max[0], y0, low], [x1, y1, high], sky),
      box([bounds.min[0], y0, low], [bounds.max[0], bounds.min[1], high], sky),
      box([bounds.min[0], bounds.max[1], low], [bounds.max[0], y1, high], sky),
    ];
  })();
  const ramps = made.flatMap((space, nth) => (space.slope ? slopeOf(space, worn[nth]) : []));
  return [
    ...brushes.map(({ outline, sides, z0, z1, over, under }) => {
      const top = wearing(over, "floor");
      const bottom = wearing(under, "ceiling");
      // a brush with a face of sky is sky all round: the compilers take a brush of mixed sky and stone for
      // neither, and the map is left with no inside and no light
      const sky = [top, bottom, ...sides.map((side) => side.wears)].find(isSky);
      if (sky) return onWholePoints(prism(2, outline, z0, z1, sky), lines);
      const rule = (normal) => {
        if (normal[2] > 0.5) return top;
        if (normal[2] < -0.5) return bottom;
        let best = sides[0];
        for (const side of sides)
          if (
            side.out[0] * normal[0] + side.out[1] * normal[1] >
            best.out[0] * normal[0] + best.out[1] * normal[1]
          )
            best = side;
        return standing(best, normal);
      };
      return onWholePoints(prism(2, outline, z0, z1, rule), lines);
    }),
    ...ramps,
    ...skyBox,
  ];
}

/**
 * The plane a sloped space's floor lies in: `{ at(x, y), run, rise }`. `slope` is `{ rise, toward }`: the
 * floor climbs `rise` units across the space towards `toward` (degrees: 0 east, 90 north), from its `floor`
 * on the lowest side.
 */
export function slopePlane(space) {
  const made = space.areas ? space : planSpace(space);
  const { rise, toward = 0 } = made.slope;
  const angle = (toward * Math.PI) / 180;
  const way = [Math.cos(angle), Math.sin(angle)];
  const along = made.areas.flat(2).map(([x, y]) => x * way[0] + y * way[1]);
  const least = Math.min(...along);
  const run = Math.max(...along) - least;
  return { rise, run, at: (x, y) => made.floor + (rise * (x * way[0] + y * way[1] - least)) / run };
}

/** A sloped space's floor: one brush a convex piece of it, from under its floor up to its plane. */
function slopeOf(space, wears) {
  const { rise, run, at } = slopePlane(space);
  if (!(rise > 0)) throw new Error(`carvePlan: space ${space.name}: a slope rises over 0, not ${rise}`);
  if (!(space.floor + rise < space.ceiling))
    throw new Error(
      `carvePlan: space ${space.name}: its slope (${rise}) climbs into its ceiling (${space.ceiling - space.floor} over the floor)`,
    );
  if (!(run > 0)) throw new Error(`carvePlan: space ${space.name}: no run to slope along`);
  const under = space.floor - SLOPE_BED;
  return convexPieces(space).map((ring) =>
    solid(
      [
        ...ring.map(([x, y]) => [x, y, under]),
        // the plane's own heights, not rounded: a ramp at an angle would have its corners off its plane
        ...ring.map(([x, y]) => [x, y, at(x, y)]),
      ],
      wears.floor,
      {
        faces: [
          [0, 1, 2],
          [ring.length, ring.length + 1, ring.length + 2],
          ...ring.map((_, i) => [i, (i + 1) % ring.length, ring.length + i]),
        ],
      },
    ),
  );
}

/** Whether a texture (a name, or a fit `{ name }`) is the sky. */
const isSky = (texture) => /^sky$/i.test(typeof texture === "string" ? texture : (texture?.name ?? ""));

/** Points that give the plane of `normal`, at `dist`, in the compiler's order, from two points a and b of it. */
function threePoints(normal, a, b, up) {
  const points = [b, a, up];
  const plane = planeOf(points);
  return plane && plane.normal[0] * normal[0] + plane.normal[1] * normal[1] + plane.normal[2] * normal[2] > 0
    ? points
    : [up, a, b];
}

/**
 * A brush's planes written through whole points where they can be: a level face through (0, 0, z), an
 * upright face along x or y through its whole coordinate, and an upright face along an outline as drawn
 * through the outline's own two corners (`lines`, by lineOf's key). What is left (a cut where two outlines
 * cross) keeps the points it was worked out from.
 */
function onWholePoints(brush, lines) {
  const whole = (value) => Math.abs(value - Math.round(value)) < 1e-6;
  return {
    faces: brush.faces.map((face) => {
      const plane = planeOf(face.points);
      if (!plane) return face;
      const [nx, ny, nz] = plane.normal;
      let points = null;
      if (Math.abs(Math.abs(nz) - 1) < 1e-9 && whole(plane.dist * nz)) {
        const z = Math.round(plane.dist * nz);
        points = threePoints(plane.normal, [0, 0, z], [64, 0, z], [0, 64, z]);
      } else if (Math.abs(nz) < 1e-9) {
        if (Math.abs(Math.abs(nx) - 1) < 1e-9 && whole(plane.dist * nx)) {
          const x = Math.round(plane.dist * nx);
          points = threePoints(plane.normal, [x, 0, 0], [x, 64, 0], [x, 0, 64]);
        } else if (Math.abs(Math.abs(ny) - 1) < 1e-9 && whole(plane.dist * ny)) {
          const y = Math.round(plane.dist * ny);
          points = threePoints(plane.normal, [0, y, 0], [64, y, 0], [0, y, 64]);
        } else {
          // the outline it lies along, by the key lineOf gives the same line
          let [kx, ky, kc] = [nx, ny, plane.dist];
          if (ky < 0 || (ky === 0 && kx < 0)) [kx, ky, kc] = [-kx, -ky, -kc];
          const line = lines.get(`${tidy(kx).toFixed(7)},${tidy(ky).toFixed(7)},${tidy(kc).toFixed(4)}`);
          if (line && line.a.every(whole) && line.b.every(whole))
            points = threePoints(plane.normal, [...line.a, 0], [...line.b, 0], [...line.a, 64]);
        }
      }
      return points ? { ...face, points } : face;
    }),
  };
}

// ── outlines that bend ──────────────────────────────────────────────────────
/** A round outline (a plaza, a well, a tower's floor): `sides` corners round `centre`, turned `turn` degrees. */
export function circle(centre, radius, { sides = 16, turn = 0, snap = 1 } = {}) {
  if (!(sides >= 3)) throw new Error(`circle: three sides at least, not ${sides}`);
  const [ra, rb] = Array.isArray(radius) ? radius : [radius, radius];
  const round = (value) => (snap ? Math.round(value / snap) * snap + 0 : value);
  return cleanRing(
    Array.from({ length: sides }, (_, i) => {
      const angle = ((turn + (360 * i) / sides) * Math.PI) / 180;
      return [round(centre[0] + ra * Math.cos(angle)), round(centre[1] + rb * Math.sin(angle))];
    }),
  );
}

/**
 * A smooth line through points (a Catmull-Rom curve): `pieces` points between each two, rounded to `snap`
 * (1: whole units, which keeps the walls' planes on the grid). `closed`: the line comes back round to the
 * first point, an outline. Good for a track, a river's bank, a street that bends, a cave's wall.
 */
export function curve(points, { pieces = 6, closed = false, snap = 1 } = {}) {
  if (!Array.isArray(points) || points.length < 2) throw new Error("curve: two points at least");
  const round = (value) => (snap ? Math.round(value / snap) * snap + 0 : value);
  const count = points.length;
  const at = (i) =>
    closed ? points[((i % count) + count) % count] : points[Math.min(count - 1, Math.max(0, i))];
  const out = [];
  const spans = closed ? count : count - 1;
  for (let i = 0; i < spans; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let step = 0; step < pieces; step++) {
      const t = step / pieces;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push(
        [0, 1].map((k) =>
          round(
            0.5 *
              (2 * p1[k] +
                (-p0[k] + p2[k]) * t +
                (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
                (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3),
          ),
        ),
      );
    }
  }
  if (!closed) out.push([round(points[count - 1][0]), round(points[count - 1][1])]);
  return out.filter((point, i) => i === 0 || !samePoint(point, out[i - 1]));
}

/**
 * A path `width` wide along a line of points (a street, a tunnel, a track; `curve` makes one bend): its
 * outline, as a list of one, to be a space's `outlines`. Its sides are the line moved out by half the width
 * each way, meeting at each corner in a point (a mitre), cut square at a corner sharper than `mitre` times
 * the half width would reach; where the inner side of a tight bend runs back over itself, the loop is cut
 * off. The ends are square unless `ends: "round"`. Rounded to `snap` (1: whole units), with points that
 * rounding leaves nearer than a unit to the one before taken out.
 */
export function path(points, width, { ends = "square", sides = 8, snap = 1, mitre = 3 } = {}) {
  if (!Array.isArray(points) || points.length < 2) throw new Error("path: two points at least");
  if (!(width > 0)) throw new Error(`path: a width over 0, not ${width}`);
  const round = (value) => (snap ? Math.round(value / snap) * snap + 0 : value);
  const line = points.filter(
    (point, i) => i === 0 || Math.hypot(point[0] - points[i - 1][0], point[1] - points[i - 1][1]) > NOTHING,
  );
  if (line.length < 2) throw new Error("path: its points are all one point");
  const half = width / 2;
  const across = (a, b) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
  };
  /** One side of the path: the line moved `k` (1 left, -1 right) half widths out, mitred at each corner. */
  const sideLine = (k) => {
    const out = [];
    for (let i = 0; i < line.length; i++) {
      const before = i > 0 ? across(line[i - 1], line[i]) : null;
      const after = i + 1 < line.length ? across(line[i], line[i + 1]) : null;
      const p = line[i];
      if (!before || !after) {
        const n = before ?? after;
        out.push([p[0] + n[0] * half * k, p[1] + n[1] * half * k]);
        continue;
      }
      const sum = [before[0] + after[0], before[1] + after[1]];
      const cos = (before[0] * after[0] + before[1] * after[1] + 1) / 2;
      const reach = cos > 1e-9 ? 1 / Math.sqrt(cos) : Infinity;
      if (reach <= mitre) {
        const length = Math.hypot(...sum);
        out.push([p[0] + (sum[0] / length) * half * reach * k, p[1] + (sum[1] / length) * half * reach * k]);
      } else {
        out.push([p[0] + before[0] * half * k, p[1] + before[1] * half * k]);
        out.push([p[0] + after[0] * half * k, p[1] + after[1] * half * k]);
      }
    }
    return withoutLoops(out);
  };
  const left = sideLine(1);
  const right = sideLine(-1);
  let ring = [...right, ...left.reverse()].map(([x, y]) => [round(x), round(y)]);
  ring = ring.filter(
    (point, i) =>
      i === 0 || Math.hypot(point[0] - ring[i - 1][0], point[1] - ring[i - 1][1]) >= Math.min(1, half),
  );
  const outlines = [cleanRing(ring)];
  if (ends === "round")
    for (const end of [line[0], line[line.length - 1]]) outlines.push(circle(end, half, { sides, snap }));
  return outlines.filter((outline) => outline.length >= 3 && Math.abs(signedArea(outline)) > NOTHING);
}

/** A line of points with each loop it makes over itself cut off where it crosses itself. */
function withoutLoops(points) {
  const out = [...points];
  for (let i = 0; i + 1 < out.length; i++)
    for (let j = out.length - 2; j > i + 1; j--) {
      const p = { a: out[i], b: out[i + 1] };
      const q = { a: out[j], b: out[j + 1] };
      const r = [p.b[0] - p.a[0], p.b[1] - p.a[1]];
      const s = [q.b[0] - q.a[0], q.b[1] - q.a[1]];
      const denominator = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(denominator) < 1e-12) continue;
      const qp = [q.a[0] - p.a[0], q.a[1] - p.a[1]];
      const t = (qp[0] * s[1] - qp[1] * s[0]) / denominator;
      const u = (qp[0] * r[1] - qp[1] * r[0]) / denominator;
      if (t > 0 && t < 1 && u > 0 && u < 1) {
        out.splice(i + 1, j - i, [p.a[0] + r[0] * t, p.a[1] + r[1] * t]);
        break;
      }
    }
  return out;
}
