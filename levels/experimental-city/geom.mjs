// Plan geometry for the map generator's stages, in cells (x, y on the floor; z up, in cells too). Points are
// [x, y]; a rect is { x, y, w, d } (x, y its least corner, w along x, d along y) or [x0, y0, x1, y1] where said;
// a polygon is a list of points, counter-clockwise. Nothing here knows an engine or a description.

export const EPS = 1e-9;
/** Rounded to a thousandth of a cell: every number an artifact stores goes through this, so runs match byte for byte. */
export const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
export const r1 = (v) => Math.round(v * 10) / 10 + 0;
/** Rounded to the half cell. */
export const half = (v) => Math.round(v * 2) / 2 + 0;
export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export const polylineLength = (pts) => pts.slice(1).reduce((s, p, i) => s + dist(pts[i], p), 0);

/** The nearest point to p on segment ab, and its parameter t. */
export function nearestOnSeg(p, a, b) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const L = dx * dx + dy * dy;
  const t = L ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L, 0, 1) : 0;
  return { point: [a[0] + dx * t, a[1] + dy * t], t };
}
export const pointSegDist = (p, a, b) => dist(p, nearestOnSeg(p, a, b).point);
export function pointPolylineDist(p, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, pointSegDist(p, pts[i - 1], pts[i]));
  return pts.length === 1 ? dist(p, pts[0]) : best;
}

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
/** Where segments ab and cd cross properly (not at an end of either), or null. */
export function segCross(a, b, c, d) {
  const [d1, d2, d3, d4] = [cross(c, d, a), cross(c, d, b), cross(a, b, c), cross(a, b, d)];
  if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) {
    const t = d1 / (d1 - d2);
    return lerp(a, b, t);
  }
  return null;
}
export function segSegDist(a, b, c, d) {
  if (segCross(a, b, c, d)) return 0;
  return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b));
}

// ── rects ──
export const rectOf = (at, [w, d]) => ({ x: at[0] - w / 2, y: at[1] - d / 2, w, d });
export const box4 = (r) => [r.x, r.y, r.x + r.w, r.y + r.d];
export const rectFromBox = ([x0, y0, x1, y1]) => ({ x: x0, y: y0, w: x1 - x0, d: y1 - y0 });
export const rectCentre = (r) => [r.x + r.w / 2, r.y + r.d / 2];
export const rectPoly = (r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.d], [r.x, r.y + r.d]];
export const roundRect = (r) => ({ x: r3(r.x), y: r3(r.y), w: r3(r.w), d: r3(r.d) });
/** How deep two boxes [x0, y0, x1, y1] overlap (0 or less: apart or touching). */
export const overlapDepth = (a, b) => Math.min(a[2] - b[0], b[2] - a[0], a[3] - b[1], b[3] - a[1]);
export const pointInBox = (p, b, e = 0) => p[0] >= b[0] - e && p[0] <= b[2] + e && p[1] >= b[1] - e && p[1] <= b[3] + e;
export const pointBoxDist = (p, b) => Math.hypot(Math.max(b[0] - p[0], 0, p[0] - b[2]), Math.max(b[1] - p[1], 0, p[1] - b[3])); // prettier-ignore
export const boxBoxDist = (a, b) => Math.hypot(Math.max(0, b[0] - a[2], a[0] - b[2]), Math.max(0, b[1] - a[3], a[1] - b[3])); // prettier-ignore
export const boxInside = (inner, outer, e = 0.01) => inner[0] >= outer[0] - e && inner[1] >= outer[1] - e && inner[2] <= outer[2] + e && inner[3] <= outer[3] + e; // prettier-ignore
export function segBoxDist(a, b, r) {
  if (pointInBox(a, r) || pointInBox(b, r)) return 0;
  const cs = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
  return Math.min(...cs.map((c, i) => segSegDist(a, b, c, cs[(i + 1) % 4])));
}
export function polylineBoxDist(pts, r) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, segBoxDist(pts[i - 1], pts[i], r));
  return best;
}
/** Where the line from p (inside box r) toward q leaves r. */
export function exitPoint(p, q, r) {
  let t = 1;
  const [dx, dy] = [q[0] - p[0], q[1] - p[1]];
  if (dx > 0) t = Math.min(t, (r[2] - p[0]) / dx);
  else if (dx < 0) t = Math.min(t, (r[0] - p[0]) / dx);
  if (dy > 0) t = Math.min(t, (r[3] - p[1]) / dy);
  else if (dy < 0) t = Math.min(t, (r[1] - p[1]) / dy);
  return [p[0] + dx * t, p[1] + dy * t];
}

/** A polyline clipped to box r (Liang-Barsky per piece): a list of polylines, in order along it. */
export function clipPolyline(pts, r) {
  const out = [];
  let cur = null;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    let [t0, t1] = [0, 1];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const tests = [[-dx, a[0] - r[0]], [dx, r[2] - a[0]], [-dy, a[1] - r[1]], [dy, r[3] - a[1]]];
    let keep = true;
    for (const [p, q] of tests) {
      if (Math.abs(p) < EPS) {
        if (q < 0) keep = false;
      } else {
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
      }
    }
    if (!keep || t0 > t1 + EPS) {
      if (cur) out.push(cur), (cur = null);
      continue;
    }
    const [p0, p1] = [lerp(a, b, t0), lerp(a, b, t1)];
    if (cur && dist(cur[cur.length - 1], p0) < 1e-6) cur.push(p1);
    else {
      if (cur) out.push(cur);
      cur = [p0, p1];
    }
    if (t1 < 1 - EPS) out.push(cur), (cur = null);
  }
  if (cur) out.push(cur);
  return out.filter((pl) => polylineLength(pl) > 1e-6);
}

/** The polyline cut where it first leaves box r from its start (it starts inside r). */
export function trimStartInBox(pts, r) {
  if (!pointInBox(pts[0], r)) return pts;
  for (let i = 1; i < pts.length; i++) {
    if (!pointInBox(pts[i], r)) return [exitPoint(pts[i - 1], pts[i], r), ...pts.slice(i)];
  }
  return [pts[pts.length - 1], pts[pts.length - 1]];
}
export const trimEndInBox = (pts, r) => trimStartInBox([...pts].reverse(), r).reverse();

// ── convex polygons (oriented boxes) ──
/** An oriented rectangle along the line from a to b (its centre line), `width` across. */
export function bandPoly(a, b, width) {
  const L = dist(a, b) || 1;
  const [ux, uy] = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const [vx, vy] = [-uy * (width / 2), ux * (width / 2)];
  return [[a[0] - vx, a[1] - vy], [b[0] - vx, b[1] - vy], [b[0] + vx, b[1] + vy], [a[0] + vx, a[1] + vy]];
}
const axesOf = (poly) => poly.map((p, i) => {
  const q = poly[(i + 1) % poly.length];
  return [-(q[1] - p[1]), q[0] - p[0]];
});
/** How deep two convex polygons overlap: the least overlap of their shadows on their edges' normals, in cells (<= 0: apart or touching). */
export function polyOverlap(a, b) {
  let depth = Infinity;
  for (const ax of [...axesOf(a), ...axesOf(b)]) {
    const L = Math.hypot(ax[0], ax[1]);
    if (L < EPS) continue;
    const n = [ax[0] / L, ax[1] / L];
    const proj = (poly) => poly.map((p) => p[0] * n[0] + p[1] * n[1]);
    const [pa, pb] = [proj(a), proj(b)];
    const d = Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb));
    depth = Math.min(depth, d);
    if (depth <= 0) return depth;
  }
  return depth;
}
export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = [poly[i], poly[j]];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export const polyBox = (poly) => [Math.min(...poly.map((p) => p[0])), Math.min(...poly.map((p) => p[1])), Math.max(...poly.map((p) => p[0])), Math.max(...poly.map((p) => p[1]))]; // prettier-ignore
export const roundPoly = (poly) => poly.map((p) => [r3(p[0]), r3(p[1])]);

/** The side of a rect a direction faces: n (+y), s (-y), e (+x), w (-x). */
export const SIDES = ["s", "e", "n", "w"];
export const NORMAL = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] };
/** A rect's side as a segment, from its left or bottom corner (the corner `door.at` counts from). */
export function sideSeg(r, side) {
  if (side === "s") return [[r.x, r.y], [r.x + r.w, r.y]];
  if (side === "n") return [[r.x, r.y + r.d], [r.x + r.w, r.y + r.d]];
  if (side === "w") return [[r.x, r.y], [r.x, r.y + r.d]];
  return [[r.x + r.w, r.y], [r.x + r.w, r.y + r.d]];
}
export const sideLength = (r, side) => (side === "n" || side === "s" ? r.w : r.d);
/** The point `at` cells along a rect's side from its left (s, n) or bottom (e, w) corner. */
export function pointOnSide(r, side, at) {
  const [a] = sideSeg(r, side);
  return side === "n" || side === "s" ? [a[0] + at, a[1]] : [a[0], a[1] + at];
}

// ── seeded choice (no clock, no Math.random) ──
/** mulberry32, as SMAK's own `seeded` (src/workshop.mjs): the same seed, the same numbers. */
export { seeded } from "../../src/workshop.mjs";
/** A seed for one named thing: the run's seed mixed with the name, so adding a thing does not reshuffle the others. */
export function seedOf(seed, name) {
  let h = (seed | 0) ^ 0x9e3779b9;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** A winding way: a zigzag between a and b with `pieces` legs whose length is `length` (solved by bisection). */
export function meander(a, b, length, pieces, sign = 1) {
  const D = dist(a, b);
  if (!(length > D * 1.001) || pieces < 2) return [a, b];
  const [ux, uy] = [(b[0] - a[0]) / D, (b[1] - a[1]) / D];
  const make = (h) => {
    const pts = [a];
    for (let i = 1; i < pieces; i++) {
      const s = (i % 2 ? 1 : -1) * sign * h;
      const p = lerp(a, b, i / pieces);
      pts.push([p[0] - uy * s, p[1] + ux * s]);
    }
    pts.push(b);
    return pts;
  };
  let [lo, hi] = [0, length];
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (polylineLength(make(mid)) < length) lo = mid;
    else hi = mid;
  }
  return make((lo + hi) / 2);
}

/** A convex polygon (counter-clockwise or not) grown by d: each edge moved out by d, the corners where they meet. */
export function growPoly(poly, d) {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) area += poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1];
  const s = area >= 0 ? 1 : -1;
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n];
    const L = dist(p, q) || 1;
    const nx = (s * (q[1] - p[1])) / L;
    const ny = (-s * (q[0] - p[0])) / L;
    return [[p[0] + nx * d, p[1] + ny * d], [q[0] + nx * d, q[1] + ny * d]];
  });
  return lines.map((l, i) => {
    const [a, b] = lines[(i + n - 1) % n];
    const [c, e] = l;
    const den = (a[0] - b[0]) * (c[1] - e[1]) - (a[1] - b[1]) * (c[0] - e[0]);
    if (Math.abs(den) < EPS) return c;
    const t = ((a[0] - c[0]) * (c[1] - e[1]) - (a[1] - c[1]) * (c[0] - e[0])) / den;
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  });
}
