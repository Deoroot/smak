// levels/assembly/shapes.mjs: areas of a site that are not rectangles of cells: a diagonal street, a plaza that is a
// polygon, an oval with a spine (the Hippodrome). A site (site.mjs) is cells of 64; the cell grid stays the ownership
// model: a shaped area claims the cells of its bounds (`from`, `to`, as any area), and inside them the real shape is
// cut by angled brushes. The floor is the shape itself, a prism of 16 under the area's ground; the rest of the bounds
// (what lies between the shape and the edge of its cells) is a solid mass, a storey high, whose faces are the walls
// that face the floor. Cells that the shape does not touch are labelled "solid" (not public floor); where the shape
// reaches an edge of its bounds it is open to the cell beyond, as any street is.
//
// The description (areas[], units of the world, whole numbers, y north; `from`/`to` are the cells it lives in, and are
// worked out from the shape when left out):
//   { kind: "plaza", name, shape: "poly",     points: [[x, y], ...] }              any simple polygon, convex or not
//   { kind: "plaza", name, shape: "oval",     center: [x, y], radii: [rx, ry], turn?, sides?,
//                         spine?: { length, width } }                               an oval; a spine is a solid island along its long axis
//   { kind: "street", name, shape: "diagonal", line: [[x0, y0], [x1, y1]], width, from, to }   a street along a line at any angle, cut by its cells (`from`, `to`)
//   any of them may have `z` (terrain.mjs) and `wall` (the mass's height, 192 unless told)
//
//   readShapes(site)            -> failures: the description's own sentences (types, ranges)
//   fillBounds(area, size)      -> sets from/to of a shaped area that has none, from its shape
//   shapesOf(site)              -> { list, failures, warnings, measures, owns, on, opens, mark, spawnsFor, brushes, ... }
//   checkShapes(plan)           -> { failures, warnings, measures }: shapesOf for a planned site (the broken cases)
//   shapeBrushes(shapes, opts)  -> { brushes, counts }: the floor and the walls of every shaped area
//
// Every vertex is a whole number and every brush is a prism of whole-number corners, so every plane is written with
// whole-number points (nothing for the compiler to round); the floor and the walls are cut from the same vertices and
// tile their cells exactly, which is what seals them.
import { prism } from "../../src/maps/source.mjs";

const GRID = 64;
/** The shapes an area may have. */
export const SHAPES = ["poly", "oval", "diagonal"];
/** The kinds of area a shape may be (water has its own cut, terrain.mjs). */
const KINDS = ["street", "plaza", "square", "alley", "paving"];
/** The narrowest a shaped area is anywhere a player walks it (a street's lowest rank, terrain.mjs WIDTH.least). */
export const WALKABLE = 96;
/** The height of the walls round a shaped area, over its floor: a storey. */
export const WALL_HEIGHT = 192;
/** A brush thinner than this is no brush to the compiler (it merges its planes): refused. */
export const MICRO = 2;
/** The least of a cell a shape covers for it to stay public floor. */
const COVERED = 0.02;
const SPINE_HEIGHT = WALL_HEIGHT;
/** How near a wall a standing player's origin goes: the hull is a box 32 across, so at 45 degrees a wall is 16 x 1.41 off, and some more. */
const BODY = 24;
const isInt = (v) => Number.isInteger(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const pt = (p) => Array.isArray(p) && p.length === 2 && p.every(isNum);
const ipt = (p) => Array.isArray(p) && p.length === 2 && p.every(isInt);

// ── plane geometry (points are [x, y]) ──
const cross2 = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
/** Twice the signed area of a ring (positive anticlockwise). */
const area2 = (p) => p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0);
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const ccw = (p) => (area2(p) < 0 ? [...p].reverse() : p);
function dedupe(p) {
  const out = [];
  for (const q of p) if (!out.length || !same(q, out.at(-1))) out.push(q);
  while (out.length > 1 && same(out[0], out.at(-1))) out.pop();
  return out;
}
/** A ring without the corners that lie on the line between their neighbours. */
function straight(p) {
  let out = dedupe(p);
  for (let again = true; again && out.length > 3; ) {
    again = false;
    for (let i = 0; i < out.length; i++) {
      if (cross2(out[(i + out.length - 1) % out.length], out[i], out[(i + 1) % out.length]) === 0) {
        out = out.filter((_, k) => k !== i);
        again = true;
        break;
      }
    }
  }
  return out;
}
const segLen = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** The distance from a point to a segment. */
function toSegment(p, a, b) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}
const onSegment = (a, b, p) => cross2(a, b, p) === 0 && Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);
/** Whether two segments share a point (touching counts). */
function meets(a, b, c, d) {
  const [d1, d2, d3, d4] = [cross2(a, b, c), cross2(a, b, d), cross2(c, d, a), cross2(c, d, b)];
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}
/** The pair of edges of a ring that cross or touch where they should not, or null. */
function selfTouch(p) {
  const n = p.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const next = (j + 1) % n === i;
      const [a, b, c, d] = [p[i], p[(i + 1) % n], p[j], p[(j + 1) % n]];
      if (j === i + 1 || next) {
        // edges side by side share their corner: bad only when one doubles back over the other
        const [o, u, v] = j === i + 1 ? [b, a, d] : [a, b, c];
        if (cross2(o, u, v) === 0 && (u[0] - o[0]) * (v[0] - o[0]) + (u[1] - o[1]) * (v[1] - o[1]) > 0) return [i, j];
        continue;
      }
      if (meets(a, b, c, d)) return [i, j];
    }
  return null;
}
/** Whether a point is in a ring (the boundary is in). */
function inRing(p, ring) {
  let inside = false;
  for (let i = 0; i < ring.length; i++) {
    const [a, b] = [ring[i], ring[(i + 1) % ring.length]];
    if (onSegment(a, b, p)) return true;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
/** The pieces of a convex ring cut by the half-plane left of a -> b (Sutherland-Hodgman). */
function cut(ring, a, b) {
  const out = [];
  const side = (p) => cross2(a, b, p);
  for (let i = 0; i < ring.length; i++) {
    const [p, q] = [ring[i], ring[(i + 1) % ring.length]];
    const [sp, sq] = [side(p), side(q)];
    if (sp >= 0) out.push(p);
    if ((sp > 0 && sq < 0) || (sp < 0 && sq > 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}
/** A convex ring cut to the rectangle [x0, y0, x1, y1]. */
function clipRect(ring, [x0, y0, x1, y1]) {
  let r = ring;
  for (const [a, b] of [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]]]) {
    if (r.length) r = cut(r, a, b);
  }
  return r;
}
/** The area of a ring (plain). */
const areaOf = (r) => Math.abs(area2(r)) / 2;
/** The thinnest a convex ring is: the least over its edges of its extent across that edge. */
function thinnest(ring) {
  let least = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [a, b] = [ring[i], ring[(i + 1) % ring.length]];
    const len = segLen(a, b);
    if (!len) continue;
    let far = 0;
    for (const p of ring) far = Math.max(far, Math.abs(cross2(a, b, p)) / len);
    least = Math.min(least, far);
  }
  return least;
}

// ── a simple polygon cut into convex pieces ──
const inTriangle = (p, a, b, c) => cross2(a, b, p) >= 0 && cross2(b, c, p) >= 0 && cross2(c, a, p) >= 0;
/** Ear clipping: the triangles of a simple anticlockwise ring. Throws where the ring is not simple. */
function triangles(ring) {
  const idx = ring.map((_, i) => i);
  const tris = [];
  while (idx.length > 3) {
    const n = idx.length;
    let found = false;
    for (let k = 0; k < n && !found; k++) {
      const [a, b, c] = [ring[idx[(k + n - 1) % n]], ring[idx[k]], ring[idx[(k + 1) % n]]];
      if (cross2(a, b, c) <= 0) continue;
      if (idx.some((j) => !same(ring[j], a) && !same(ring[j], b) && !same(ring[j], c) && inTriangle(ring[j], a, b, c))) continue;
      tris.push([a, b, c]);
      idx.splice(k, 1);
      found = true;
    }
    if (!found) {
      const k = idx.findIndex((_, q) => cross2(ring[idx[(q + n - 1) % n]], ring[idx[q]], ring[idx[(q + 1) % n]]) === 0);
      if (k < 0) throw new Error("the outline is not a simple polygon");
      idx.splice(k, 1);
    }
  }
  if (idx.length === 3 && cross2(ring[idx[0]], ring[idx[1]], ring[idx[2]]) !== 0) tris.push(idx.map((i) => ring[i]));
  return tris;
}
/** Triangles joined into convex pieces where their union stays convex (Hertel-Mehlhorn). */
function convexPieces(tris) {
  const pieces = tris.map((t) => [...t]);
  const edgeOf = (p, k) => [p[k], p[(k + 1) % p.length]];
  for (let again = true; again; ) {
    again = false;
    search: for (let i = 0; i < pieces.length; i++)
      for (let j = i + 1; j < pieces.length; j++) {
        const [A, B] = [pieces[i], pieces[j]];
        for (let k = 0; k < A.length; k++) {
          const [a0, a1] = edgeOf(A, k);
          const m = B.findIndex((_, q) => same(edgeOf(B, q)[0], a1) && same(edgeOf(B, q)[1], a0));
          if (m < 0) continue;
          const ring = [];
          for (let q = 0; q < A.length; q++) ring.push(A[(k + 1 + q) % A.length]);
          for (let q = 2; q < B.length; q++) ring.push(B[(m + q) % B.length]);
          if (ring.every((_, q) => cross2(ring[(q + ring.length - 1) % ring.length], ring[q], ring[(q + 1) % ring.length]) >= 0)) {
            pieces.splice(j, 1);
            pieces[i] = straight(ring);
            again = true;
            break search;
          }
        }
      }
  }
  return pieces;
}
/**
 * A convex ring cut across its middle until none has more corners than a face may have: the compilers' surfaces hold 28
 * points a face (hlbsp: "ReadSurfs: 44 > MAXPOINTS"), and csg adds some where it clips, so a piece keeps to 12.
 */
export const CORNERS_MOST = 12;
function cutDown(ring) {
  if (ring.length <= CORNERS_MOST) return [ring];
  const h = Math.floor(ring.length / 2);
  return [...cutDown(straight(ring.slice(0, h + 1))), ...cutDown(straight([...ring.slice(h), ring[0]]))];
}
/** A simple ring as convex pieces of few corners. */
const piecesOf = (ring) => convexPieces(triangles(straight(ring))).flatMap((p) => cutDown(straight(p)));

// ── the rest of a rectangle round a polygon ──
/** Where a point of a rectangle's edge lies along its perimeter, anticlockwise from its south-west corner (null off the edge). */
function along(p, [x0, y0, x1, y1]) {
  const [w, h] = [x1 - x0, y1 - y0];
  if (p[1] === y0) return p[0] - x0;
  if (p[0] === x1) return w + (p[1] - y0);
  if (p[1] === y1) return w + h + (x1 - p[0]);
  if (p[0] === x0) return 2 * w + h + (y1 - p[1]);
  return null;
}
/**
 * The solid between an anticlockwise polygon and the rectangle that holds it, as convex pieces. Where the polygon
 * reaches the rectangle's edge (two corners of it or more) each stretch of its outline between two such corners closes
 * with the edge's own corners; a polygon clear of the edge is cut by two chords from its western- and easternmost
 * corners to the edge. Returns { pieces } or { fail } with the sentence's tail.
 */
function surround(ring, rect) {
  const [x0, y0, x1, y1] = rect;
  const n = ring.length;
  const contact = ring.map((p, i) => (along(p, rect) === null ? -1 : i)).filter((i) => i >= 0);
  if (contact.length === 1) return { fail: "touches the edge of its cells at one corner only; keep it clear of the edge, or let it reach the edge along a side" };
  const polys = [];
  if (contact.length >= 2) {
    const per = 2 * (x1 - x0 + y1 - y0);
    const corners = [[x0, y0, 0], [x1, y0, x1 - x0], [x1, y1, x1 - x0 + y1 - y0], [x0, y1, 2 * (x1 - x0) + y1 - y0]];
    for (let k = 0; k < contact.length; k++) {
      const [ia, ib] = [contact[k], contact[(k + 1) % contact.length]];
      const chain = [];
      for (let i = ia; ; i = (i + 1) % n) {
        chain.push(ring[i]);
        if (i === ib && chain.length > 1) break;
      }
      const [ta, tb] = [along(ring[ia], rect), along(ring[ib], rect)];
      const span = (((tb - ta) % per) + per) % per;
      const between = corners.filter(([, , t]) => {
        const d = (((t - ta) % per) + per) % per;
        return d > 0 && d < span;
      });
      between.sort((u, v) => ((u[2] - ta + per) % per) - ((v[2] - ta + per) % per));
      polys.push([...chain.reverse(), ...between.map(([cx, cy]) => [cx, cy])]);
    }
  } else {
    let [il, ir] = [0, 0];
    ring.forEach((p, i) => {
      if (p[0] < ring[il][0] || (p[0] === ring[il][0] && p[1] < ring[il][1])) il = i;
      if (p[0] > ring[ir][0] || (p[0] === ring[ir][0] && p[1] > ring[ir][1])) ir = i;
    });
    const [L, R] = [ring[il], ring[ir]];
    const top = [[x1, R[1]], [x1, y1], [x0, y1], [x0, L[1]]];
    for (let i = il; ; i = (i + n - 1) % n) {
      top.push(ring[i]);
      if (i === ir) break;
    }
    const bottom = [[x0, y0], [x1, y0], [x1, R[1]]];
    for (let i = ir; ; i = (i + n - 1) % n) {
      bottom.push(ring[i]);
      if (i === il) break;
    }
    bottom.push([x0, L[1]]);
    polys.push(top, bottom);
  }
  const pieces = [];
  for (const poly of polys) {
    const clean = straight(poly);
    if (clean.length < 3 || area2(clean) === 0) continue;
    const r = ccw(clean);
    if (selfTouch(r)) return { fail: "leaves a wall that folds back on itself between its outline and the edge of its cells" };
    pieces.push(...piecesOf(r));
  }
  return { pieces };
}

// ── what a description makes ──
const unitOf = (a, b) => {
  const l = segLen(a, b);
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
};
const rot = (v, deg) => {
  const t = (deg * Math.PI) / 180;
  return [v[0] * Math.cos(t) - v[1] * Math.sin(t), v[0] * Math.sin(t) + v[1] * Math.cos(t)];
};
const roundP = (p) => [Math.round(p[0]) + 0, Math.round(p[1]) + 0];
/** The sides of an oval of radii a and b: edges about 96 long (the chord 2 units off the curve at 500), a multiple of 4. */
function sidesOf([a, b]) {
  const perimeter = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  return Math.min(64, Math.max(16, 4 * Math.ceil(perimeter / 384)));
}
function ovalRing(center, [rx, ry], turn, n) {
  return Array.from({ length: n }, (_, i) => {
    const t = (360 * i) / n;
    const v = rot([rx * Math.cos((t * Math.PI) / 180), ry * Math.sin((t * Math.PI) / 180)], turn);
    return roundP([center[0] + v[0], center[1] + v[1]]);
  });
}
/** The outline (unclipped, in units) of a shaped area, or null when its description lacks what the shape needs. */
function outlineOf(a) {
  if (a.shape === "poly") return a.points.map((p) => [...p]);
  if (a.shape === "oval") return ovalRing(a.center, a.radii, a.turn ?? 0, a.sides ?? sidesOf(a.radii));
  const [p, q] = a.line;
  const u = unitOf(p, q);
  const h = a.width / 2;
  const nrm = [-u[1] * h, u[0] * h];
  return [[p[0] - nrm[0], p[1] - nrm[1]], [q[0] - nrm[0], q[1] - nrm[1]], [q[0] + nrm[0], q[1] + nrm[1]], [p[0] + nrm[0], p[1] + nrm[1]]];
}

/** The description's own sentences: types and ranges, before any geometry. */
export function readShapes(site) {
  const failures = [];
  const fail = (s) => failures.push(s);
  for (const a of site.areas ?? []) {
    if (a.shape === undefined) continue;
    const n = a.name ?? a.kind;
    if (!SHAPES.includes(a.shape)) {
      fail(`${n}: shape is ${JSON.stringify(a.shape)}; it wants ${SHAPES.join(", ")}`);
      continue;
    }
    if (!KINDS.includes(a.kind)) fail(`${n}: a ${a.kind} area has no shape; ${KINDS.join(", ")} may`);
    if (a.landmark !== undefined) fail(`${n}: a shaped area has no landmark column`);
    if (a.wall !== undefined && !(isInt(a.wall) && a.wall >= 64)) fail(`${n}: wall is ${JSON.stringify(a.wall)}; it wants the walls' height, whole units, 64 or more`);
    if (a.shape === "poly") {
      if (!Array.isArray(a.points) || a.points.length < 3) fail(`${n}: a poly wants points [[x, y], ...], three at least`);
      else a.points.forEach((p, i) => !ipt(p) && fail(`${n}: point ${i + 1} is ${JSON.stringify(p)}; it wants [x, y] in whole units (the compiler's planes want whole-number points)`));
    } else if (a.shape === "oval") {
      if (!ipt(a.center)) fail(`${n}: center is ${JSON.stringify(a.center)}; it wants [x, y] in whole units`);
      if (!ipt(a.radii) || a.radii.some((r) => r <= 0)) fail(`${n}: radii is ${JSON.stringify(a.radii)}; it wants [rx, ry], whole units over 0`);
      if (a.turn !== undefined && !isNum(a.turn)) fail(`${n}: turn is ${JSON.stringify(a.turn)}; it wants degrees`);
      if (a.sides !== undefined && !(isInt(a.sides) && a.sides >= 8 && a.sides <= 64 && a.sides % 2 === 0)) fail(`${n}: sides is ${JSON.stringify(a.sides)}; it wants an even number, 8 to 64`);
      if (a.spine !== undefined && !(isInt(a.spine?.length) && isInt(a.spine?.width) && a.spine.length > 0 && a.spine.width > 0)) fail(`${n}: spine is ${JSON.stringify(a.spine)}; it wants { length, width } in whole units`);
    } else {
      if (!Array.isArray(a.line) || a.line.length !== 2 || !a.line.every(pt)) fail(`${n}: a diagonal wants line [[x, y], [x, y]], the street's axis in units`);
      else if (a.line[0][0] === a.line[1][0] && a.line[0][1] === a.line[1][1]) fail(`${n}: its line has no length`);
      if (!isInt(a.width) || a.width <= 0) fail(`${n}: width is ${JSON.stringify(a.width)}; it wants whole units over 0`);
      if (a.from === undefined || a.to === undefined) fail(`${n}: a diagonal wants from [x, y] and to [x, y], the cells that cut it (its ends are the edges of those cells)`);
    }
  }
  return failures;
}

/** Sets `from` and `to` (cells) of a shaped area that has none, to the cells that hold its shape. Never throws. */
export function fillBounds(a, size) {
  if (a.shape === undefined || (ipt(a.from) && ipt(a.to)) || readShapes({ areas: [{ ...a, from: [0, 0], to: [1, 1] }] }).length) return;
  const ring = outlineOf(a);
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const clamp = (v, hi) => Math.max(0, Math.min(hi, v));
  a.from = [clamp(Math.floor(Math.min(...xs) / GRID), size?.[0] ?? 1e9), clamp(Math.floor(Math.min(...ys) / GRID), size?.[1] ?? 1e9)];
  a.to = [clamp(Math.ceil(Math.max(...xs) / GRID), size?.[0] ?? 1e9), clamp(Math.ceil(Math.max(...ys) / GRID), size?.[1] ?? 1e9)];
}

/** One shaped area made: its outline, floor, walls, and the sentences of whatever is wrong with it. */
function makeOne(a) {
  const n = a.name;
  const failures = [];
  const warnings = [];
  const rect = [a.from[0] * GRID, a.from[1] * GRID, a.to[0] * GRID, a.to[1] * GRID];
  const out = { area: a, name: n, rect, failures, warnings, floor: [], mass: [], solids: [], outline: null, walls: [], width: null };
  let ring = outlineOf(a);
  // a diagonal is cut by its cells; an oval too where it is larger than them (a track flattened where the streets pass)
  if (a.shape === "diagonal" || (a.shape === "oval" && ring.some((p) => p[0] < rect[0] || p[1] < rect[1] || p[0] > rect[2] || p[1] > rect[3]))) {
    ring = clipRect(ring, rect);
    if (ring.length < 3) {
      failures.push(`${n}: its ${a.shape === "oval" ? "oval" : "line"} does not cross its cells (${a.from.join(",")} to ${a.to.join(",")}); it is outside them`);
      return out;
    }
    ring = ring.map(roundP);
  }
  ring = dedupe(ring);
  if (ring.length < 3 || area2(ring) === 0) {
    failures.push(`${n}: its outline is degenerate (${ring.length < 3 ? `${ring.length} distinct ${ring.length === 1 ? "point" : "points"}` : "all its points on one line"}); a polygon wants three corners that do not lie on a line`);
    return out;
  }
  ring = ccw(ring);
  const touch = selfTouch(ring);
  if (touch) {
    failures.push(`${n}: its outline crosses or touches itself (the edge from ${ring[touch[0]]} and the edge from ${ring[touch[1]]}); a polygon is one loop that does not cross itself`);
    return out;
  }
  const clean = straight(ring);
  const outside = clean.find((p) => p[0] < rect[0] || p[1] < rect[1] || p[0] > rect[2] || p[1] > rect[3]);
  if (outside) {
    failures.push(`${n}: its corner ${outside} is outside its cells (${rect.join(", ")}); the cells ${a.from.join(",")} to ${a.to.join(",")} must hold the whole shape`);
    return out;
  }
  out.outline = clean;
  // the spine of an oval: an island of the same number of sides, along its long axis
  let spine = null;
  if (a.shape === "oval" && a.spine) {
    const n2 = a.sides ?? sidesOf(a.radii);
    const radii = a.radii[1] > a.radii[0] ? [a.spine.width / 2, a.spine.length / 2] : [a.spine.length / 2, a.spine.width / 2];
    spine = ovalRing(a.center, radii, a.turn ?? 0, n2);
    spine = ccw(dedupe(spine));
    if (!clean.every((p) => !inRing(p, spine)) || !spine.every((p) => inRing(p, clean))) {
      failures.push(`${n}: its spine (${a.spine.length} x ${a.spine.width}) is not inside its oval`);
      return out;
    }
    out.spine = spine;
  }
  // the pieces: the floor, the walls round it
  try {
    const s = surround(clean, rect);
    if (s.fail) {
      failures.push(`${n}: its angled walls do not seal: it ${s.fail}`);
      return out;
    }
    out.mass = s.pieces;
    if (spine) {
      // the floor is the oval round its island: cut in two by a bridge from each end of the island to the same end of the oval
      const most = (r, dir) => r.reduce((best, p, i) => (dir * (p[0] - r[best][0]) > 0 || (p[0] === r[best][0] && p[1] < r[best][1]) ? i : best), 0);
      const [ol, or, sl, sr] = [most(clean, -1), most(clean, 1), most(spine, -1), most(spine, 1)];
      const walk = (r, from, to, step) => {
        const got = [];
        for (let i = from; ; i = (i + step + r.length) % r.length) {
          got.push(r[i]);
          if (i === to) break;
        }
        return got;
      };
      const top = [...walk(clean, or, ol, 1), ...walk(spine, sl, sr, -1)];
      const bottom = [...walk(clean, ol, or, 1), ...walk(spine, sr, sl, -1)];
      for (const loop of [top, bottom]) out.floor.push(...piecesOf(ccw(loop)));
      out.solids.push(...cutDown(spine));
    } else out.floor = piecesOf(clean);
  } catch (e) {
    failures.push(`${n}: its angled walls do not seal: ${e.message}`);
    return out;
  }
  // sealing: the floor, the walls and the spine tile the cells exactly, and no brush is a sliver
  const total = out.floor.concat(out.mass, out.solids).reduce((s, p) => s + Math.abs(area2(p)), 0);
  const want = 2 * (rect[2] - rect[0]) * (rect[3] - rect[1]);
  if (total !== want) failures.push(`${n}: its angled walls do not seal: floor and walls cover ${total / 2} of the ${want / 2} square units of its cells`);
  const thin = out.floor.concat(out.mass, out.solids).map((p) => ({ p, w: thinnest(p) })).sort((u, v) => u.w - v.w)[0];
  if (thin && thin.w < MICRO) failures.push(`${n}: its angled walls do not seal: a brush ${thin.w.toFixed(1)} units thick at ${thin.p[0]} (a brush under ${MICRO} units is lost in the compile); move that corner onto the edge of the cells, or at least ${MICRO} off a wall`);
  // the width of the floor: the widest circle a player's body fits (the walls are the outline's edges off the cells' edge, and the spine's)
  const edges = [];
  const wallEdge = ([p, q]) => !((p[0] === q[0] && (p[0] === rect[0] || p[0] === rect[2])) || (p[1] === q[1] && (p[1] === rect[1] || p[1] === rect[3])));
  clean.forEach((p, i) => wallEdge([p, clean[(i + 1) % clean.length]]) && edges.push([p, clean[(i + 1) % clean.length]]));
  if (spine) spine.forEach((p, i) => edges.push([p, spine[(i + 1) % spine.length]]));
  out.walls = edges;
  // (the width is the widest circle inside the outline: the edges on the cells' edge count too, or an open end would measure wide)
  const closing = clean.map((p, i) => [p, clean[(i + 1) % clean.length]]).concat(spine ? spine.map((p, i) => [p, spine[(i + 1) % spine.length]]) : []);
  let best = 0;
  for (let y = rect[1]; y <= rect[3]; y += 8)
    for (let x = rect[0]; x <= rect[2]; x += 8) {
      if (!out.floor.some((f) => inRing([x, y], f))) continue;
      let d = Infinity;
      for (const [p, q] of closing) d = Math.min(d, toSegment([x, y], p, q));
      best = Math.max(best, d);
    }
  out.width = Math.round(best * 2);
  if (out.width + 8 < WALKABLE) failures.push(`${n}: at its widest it is ${out.width} units across; a player walks ${WALKABLE} at the least (a street's lowest rank)`);
  if (spine) {
    let track = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const [p, q] = [ring[i], ring[(i + 1) % ring.length]];
      const len = segLen(p, q);
      for (let t = 0; t < len; t += 16) {
        const s = [p[0] + ((q[0] - p[0]) * t) / len, p[1] + ((q[1] - p[1]) * t) / len];
        for (let k = 0; k < spine.length; k++) track = Math.min(track, toSegment(s, spine[k], spine[(k + 1) % spine.length]));
      }
    }
    out.track = Math.round(track);
    if (track + 2 < WALKABLE) failures.push(`${n}: the track round its spine is ${out.track} units wide at its narrowest; a player walks ${WALKABLE} at the least`);
  }
  return out;
}

/** The cells' key. */
const key = (x, y) => `${x},${y}`;

/**
 * The shaped areas of a site made: for each, its floor and walls as whole-number convex pieces (`floor`, `mass`,
 * `solids`), and the sentences of what is wrong (failures: a degenerate outline, too narrow to walk, walls that do not
 * seal, two areas on the same cells). Never throws.
 */
export function shapesOf(site) {
  const failures = readShapes(site);
  const warnings = [];
  const list = [];
  if (!failures.length)
    for (const a of site.areas ?? []) {
      if (a.shape === undefined) continue;
      if (!ipt(a.from) || !ipt(a.to) || a.to[0] <= a.from[0] || a.to[1] <= a.from[1]) {
        failures.push(`${a.name}: it wants from [x, y] and to [x, y], the cells that hold it, to past from`);
        continue;
      }
      const one = makeOne(a);
      failures.push(...one.failures);
      warnings.push(...one.warnings);
      list.push(one);
    }
  // two areas on the same cells
  const rects = [...(site.areas ?? []).map((a) => ({ n: a.name, a })), ...(site.buildings ?? []).map((b) => ({ n: `building ${b.id}`, a: { from: b.at, to: [b.at[0] + b.size[0], b.at[1] + b.size[1]] } }))];
  for (const s of list) {
    for (const o of rects) {
      if (o.a === s.area || !ipt(o.a.from) || !ipt(o.a.to)) continue;
      const [x0, y0, x1, y1] = [Math.max(s.area.from[0], o.a.from[0]), Math.max(s.area.from[1], o.a.from[1]), Math.min(s.area.to[0], o.a.to[0]), Math.min(s.area.to[1], o.a.to[1])];
      if (x0 < x1 && y0 < y1 && (o.a.shape === undefined || rects.indexOf(o) > rects.findIndex((r) => r.a === s.area))) failures.push(`${s.name} overlaps ${o.n} at the cells ${x0},${y0} to ${x1 - 1},${y1 - 1}; the cells of a shaped area are its own`);
    }
  }
  const owner = new Map();
  for (const s of list) for (let y = s.area.from[1]; y < s.area.to[1]; y++) for (let x = s.area.from[0]; x < s.area.to[0]; x++) owner.set(key(x, y), s);
  const cellRect = (x, y) => [x * GRID, y * GRID, (x + 1) * GRID, (y + 1) * GRID];
  const coverage = new Map();
  const coverOf = (s, x, y) => {
    const k = key(x, y);
    if (!coverage.has(k)) coverage.set(k, s.floor.reduce((sum, f) => sum + areaOf(clipRect(f, cellRect(x, y))), 0) / (GRID * GRID));
    return coverage.get(k);
  };
  const onFloor = (s, p) => s.floor.some((f) => inRing(p, f));
  const partial = new Set();
  for (const [k, s] of owner) {
    const [x, y] = k.split(",").map(Number);
    if (coverOf(s, x, y) < 0.999) partial.add(k);
  }
  const api = {
    list,
    failures,
    warnings,
    /** The cells that hold a shape, and those of them the floor does not fill. */
    owner,
    partial,
    owns: (x, y) => owner.has(key(x, y)),
    coverage: (x, y) => (owner.has(key(x, y)) ? coverOf(owner.get(key(x, y)), x, y) : null),
    /** undefined off every shape's cells; true where a player stands (on the floor, a body's half width off every wall); false on a wall, the spine, or too near one. */
    on(wx, wy) {
      const s = owner.get(key(Math.floor(wx / GRID), Math.floor(wy / GRID)));
      if (!s) return undefined;
      return onFloor(s, [wx, wy]) && s.walls.every(([u, v]) => toSegment([wx, wy], u, v) >= BODY);
    },
    /** Whether the floor crosses the edge between two side-by-side cells (a walk from one to the other can go over it). */
    opens(a, b) {
      const s = owner.get(key(...a)) ?? owner.get(key(...b));
      if (!s) return true;
      const [x, y] = a[0] === b[0] ? [a[0] * GRID, Math.max(a[1], b[1]) * GRID] : [Math.max(a[0], b[0]) * GRID, a[1] * GRID];
      for (let t = 4; t < GRID; t += 8) if (onFloor(s, a[0] === b[0] ? [x + t, y] : [x, y + t])) return true;
      return false;
    },
    /** Labels the cells of the shapes the floor does not touch "solid" (they are mass), in `cells` [y][x]. */
    mark(cells) {
      for (const [k, s] of owner) {
        const [x, y] = k.split(",").map(Number);
        if (cells[y]?.[x] !== undefined && coverOf(s, x, y) < COVERED) cells[y][x] = "solid";
      }
    },
    /** The starts of a shaped area, in cells (floats), clear of its walls: along a diagonal street's axis, spread over a plaza. */
    spawnsFor(a) {
      const s = list.find((q) => q.area === a);
      if (!s?.outline) return [];
      const clear = (p) => s.floor.some((f) => inRing(p, f)) && s.walls.every(([u, v]) => toSegment(p, u, v) >= 56);
      const pick = [];
      if (a.shape === "diagonal") {
        const [p, q] = a.line;
        const len = segLen(p, q);
        const u = unitOf(p, q);
        const yaw = Math.round((Math.atan2(u[1], u[0]) * 180) / Math.PI);
        for (let t = 128; t < len; t += 256) {
          const at = [p[0] + u[0] * t, p[1] + u[1] * t];
          if (clear(at)) pick.push({ at: [at[0] / GRID, at[1] / GRID], yaw: (yaw + 360) % 360 });
        }
        return pick;
      }
      const cand = [];
      for (let y = s.rect[1]; y <= s.rect[3]; y += 32) for (let x = s.rect[0]; x <= s.rect[2]; x += 32) if (clear([x, y])) cand.push([x, y]);
      if (!cand.length) return [];
      const mid = [(s.rect[0] + s.rect[2]) / 2, (s.rect[1] + s.rect[3]) / 2];
      let first = cand[0];
      for (const c of cand) if (segLen(c, mid) < segLen(first, mid)) first = c;
      const chosen = [];
      // the four corners first (farthest from the middle in each quarter), then the rest by distance
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const q = cand.filter((c) => Math.sign(c[0] - mid[0]) === sx && Math.sign(c[1] - mid[1]) === sy).sort((u, v) => segLen(v, mid) - segLen(u, mid))[0];
        if (q) chosen.push(q);
      }
      if (!chosen.length) chosen.push(first);
      for (const c of chosen) pick.push({ at: [c[0] / GRID, c[1] / GRID], yaw: (Math.round((Math.atan2(mid[1] - c[1], mid[0] - c[0]) * 180) / Math.PI) + 360) % 360 });
      return pick;
    },
  };
  api.measures = list.map((s) => ({ name: s.name, shape: s.area.shape, width: s.width, track: s.track ?? null, floorPieces: s.floor.length, wallPieces: s.mass.length + s.solids.length, corners: s.outline?.length ?? 0 }));
  return api;
}

/** shapesOf for a planned site (the broken cases and the picture): the same sentences. */
export function checkShapes(plan) {
  const s = shapesOf(plan.site);
  return { failures: s.failures, warnings: s.warnings, measures: s.measures };
}

/**
 * The brushes of every shaped area: a prism of the floor (its top at the area's ground, 16 thick), and of the walls
 * (from the floor's underside to `wall` over it; the spine's the same), as whole-number convex prisms.
 * `zOf(area)`: the ground's z; `textures(area)`: { floor, wall } (the district's look). Returns { brushes, counts }.
 */
export function shapeBrushes(shapes, { zOf = () => 0, textures = () => ({}) } = {}) {
  const brushes = [];
  const counts = { floor: 0, wall: 0 };
  for (const s of shapes.list) {
    if (!s.outline || s.failures.length) continue;
    const z = zOf(s.area);
    const t = { floor: "marb", wall: "sinmarblewall" };
    for (const [k, v] of Object.entries(textures(s.area) ?? {})) if (v) t[k] = v;
    for (const p of s.floor) (brushes.push(prism("z", p, z - 16, z, { top: t.floor, sides: t.wall, bottom: t.wall })), counts.floor++);
    for (const p of s.mass) (brushes.push(prism("z", p, z - 16, z + (s.area.wall ?? WALL_HEIGHT), t.wall)), counts.wall++);
    for (const p of s.solids) (brushes.push(prism("z", p, z - 16, z + (s.area.wall ?? SPINE_HEIGHT), t.wall)), counts.wall++);
  }
  return { brushes, counts };
}
