// Convex solids for hard-surface pieces, in plain JavaScript: boxes, plates, prisms, cylinders, beams, balls and
// lofts, each a stack of convex rings along a place's Z, made into triangles that face out. A piece made of
// these is all planes, which is what a hard-surface robot is, and what `motionOverlaps` (src/wear.mjs) measures
// a solid inside another by. Exported from src/index.mjs as `solids`.
//
// A place is { at, X, Y, Z }: a point and three axes at right angles (in model space, or any space the caller
// keeps). A solid is { place, rings: [{ z, poly: [[x, y], ...] }], mat }: every ring has as many corners as the
// others, so its sides are quads, and the two ends are capped. Each ring convex and counter-clockwise, and the
// rings nested sensibly (no ring wider than the two beside it would allow), a solid is convex.
//
//   place(at, z, xHint)            a place with Z along `z`, X as near `xHint` as Z lets it
//   at(pl, x, y, z), shift, quarter, flip, along     points of a place, places moved and turned
//   rect, ngon, outline, inset     convex outlines, counter-clockwise
//   box, plate, prism, cyl, beam, tube, ball, loft   solids
//   lathe(pl, profile, opts)       a solid of revolution: [[radius, z], ...] turned n-sided (a lamp post, a vase, a bollard)
//   sweepTris(profile, path, opts) a 2-D profile (concave allowed) swept along a path: tris, as trisOf gives them
//                                  (mouldings, rails, a rounded roof, an arch, a tram's section); `extrudeTris` a straight one
//   trisOf(solid)                  its triangles, facing out: [[{ p, k }]] (k: the corner's number as built)
//   pointsOf(solids)               the points they cost, each corner once (GoldSrc holds 2048 a submodel)
//   planesOf(tris)                 the planes of a convex piece: [{ n, d }], n outward; inside when n.p < d
//   closed(tris)                   every edge met by two faces, once each way: { closed, open, doubled }
//
// Sizes are in units. Plain ESM, no dependencies.

// ── vectors ────────────────────────────────────────────────────────────────
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => mul(a, 1 / (len(a) || 1));
/** `v` with its part along the unit `a` taken out. */
export const orth = (v, a) => sub(v, mul(a, dot(v, a)));
export const lerp3 = (a, b, t) => add(a, mul(sub(b, a), t));

/** Below this an X hint along Z is no hint: another axis is tried. */
const HINT_LEAST = 0.2;
/** A face with less area than this (twice over, as the cross product's length) is no face. */
const NO_FACE = 1e-7;

// ── places ─────────────────────────────────────────────────────────────────

/** A place at `at` with Z along `z`, X as near `xHint` as Z lets it (or along x, or y, when it is along Z). */
export function place(at, z, xHint = [0, 0, 1]) {
  const Z = unit(z);
  let X = orth(xHint, Z);
  if (len(X) < HINT_LEAST) X = orth([1, 0, 0], Z);
  if (len(X) < HINT_LEAST) X = orth([0, 1, 0], Z);
  X = unit(X);
  return { at, X, Y: cross(Z, X), Z };
}

/** A point of a place: x along its X, y its Y, z its Z. */
export const at = (pl, x, y, z) => add(pl.at, add(mul(pl.X, x), add(mul(pl.Y, y), mul(pl.Z, z))));
/** The same place moved, in its own axes. */
export const shift = (pl, x, y, z) => ({ ...pl, at: at(pl, x, y, z) });
/** The same place turned a quarter about its Z. */
export const quarter = (pl) => ({ at: pl.at, X: pl.Y, Y: mul(pl.X, -1), Z: pl.Z });
/** The same place upside down: its Z (and Y) the other way. */
export const flip = (pl) => ({ at: pl.at, X: pl.X, Y: mul(pl.Y, -1), Z: mul(pl.Z, -1) });
/** A place whose Z is one of this place's axes: "X" lays a solid's length along X, "Y" along Y. */
export function along(pl, axis) {
  if (axis === "X") return { at: pl.at, X: pl.Z, Y: mul(pl.Y, -1), Z: pl.X };
  if (axis === "Y") return { at: pl.at, X: pl.X, Y: mul(pl.Z, -1), Z: pl.Y };
  return pl;
}

// ── outlines (convex, counter-clockwise) ───────────────────────────────────

/** A rectangle sx by sy about (cx, cy), its corners cut by `cut` (an octagon). */
export function rect(sx, sy, cut = 0, cx = 0, cy = 0) {
  const x = sx / 2;
  const y = sy / 2;
  const c = Math.min(cut, x * 0.95, y * 0.95);
  const corners =
    c > 1e-4
      ? [[x, -y + c], [x, y - c], [x - c, y], [-x + c, y], [-x, y - c], [-x, -y + c], [-x + c, -y], [x - c, -y]] // prettier-ignore
      : [[x, -y], [x, y], [-x, y], [-x, -y]]; // prettier-ignore
  return corners.map(([a, b]) => [a + cx, b + cy]);
}

/** A regular polygon of n corners, radius rx by ry, the first corner turned `turn` radians from x. */
export function ngon(n, rx, ry = rx, turn = Math.PI / n) {
  return Array.from({ length: n }, (_, k) => [
    rx * Math.cos(turn + (2 * Math.PI * k) / n),
    ry * Math.sin(turn + (2 * Math.PI * k) / n),
  ]);
}

/** A convex outline given by its corners in any order, put counter-clockwise about its middle. */
export function outline(points) {
  const c = points.reduce((s, p) => [s[0] + p[0] / points.length, s[1] + p[1] / points.length], [0, 0]);
  return [...points].sort(
    (a, b) => Math.atan2(a[1] - c[1], a[0] - c[0]) - Math.atan2(b[1] - c[1], b[0] - c[0]),
  );
}

/** The area of an outline: over 0 when it runs counter-clockwise. */
export const area2 = (poly) =>
  poly.reduce(
    (s, p, i) => s + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1],
    0,
  ) / 2;

/**
 * A convex outline moved in by `d` all round: each side moved in, the corners where the sides meet. An inset
 * that would fold the outline over (more than it has inside it) shrinks it to half about its middle instead.
 */
export function inset(poly, d) {
  if (d <= 0) return poly;
  const n = poly.length;
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n];
    const t = [q[0] - p[0], q[1] - p[1]];
    const l = Math.hypot(t[0], t[1]) || 1;
    // counter-clockwise: the inside is to the left
    return { p: [p[0] - (t[1] / l) * d, p[1] + (t[0] / l) * d], t };
  });
  const out = lines.map((b, i) => {
    const a = lines[(i + n - 1) % n];
    const den = a.t[0] * b.t[1] - a.t[1] * b.t[0];
    if (Math.abs(den) < 1e-9) return b.p;
    const s = ((b.p[0] - a.p[0]) * b.t[1] - (b.p[1] - a.p[1]) * b.t[0]) / den;
    return [a.p[0] + a.t[0] * s, a.p[1] + a.t[1] * s];
  });
  // folded: a side runs the other way (a rectangle moved in past its middle turns over both ways and keeps
  // its area), or almost nothing is left
  const reversed = out.some((p, i) => {
    const q = out[(i + 1) % n];
    return (q[0] - p[0]) * lines[i].t[0] + (q[1] - p[1]) * lines[i].t[1] < 0;
  });
  if (reversed || area2(out) <= 0.05 * area2(poly)) {
    const c = poly.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n], [0, 0]);
    return poly.map((p) => [c[0] + (p[0] - c[0]) * 0.5, c[1] + (p[1] - c[1]) * 0.5]);
  }
  return out;
}

const scale2 = (poly, kx, ky = kx) => poly.map(([x, y]) => [x * kx, y * ky]);

// ── solids ─────────────────────────────────────────────────────────────────

/** The triangles of a solid, facing out (counter-clockwise seen from outside); each corner { p, k }. */
export function trisOf(solid) {
  const { place: pl, rings } = solid;
  const pts = rings.map((r) => r.poly.map(([x, y]) => at(pl, x, y, r.z)));
  const all = pts.flat();
  const centre = mul(
    all.reduce((s, p) => add(s, p), [0, 0, 0]),
    1 / all.length,
  );
  const tris = [];
  const put = (P) => {
    const n = cross(sub(P[1], P[0]), sub(P[2], P[0]));
    if (len(n) < NO_FACE) return;
    const mid = mul(add(P[0], add(P[1], P[2])), 1 / 3);
    const order = dot(n, sub(mid, centre)) < 0 ? [0, 2, 1] : [0, 1, 2];
    tris.push(order.map((k) => ({ p: P[k], k })));
  };
  const n = pts[0].length;
  for (let i = 0; i + 1 < pts.length; i++)
    for (let j = 0; j < n; j++) {
      const a = pts[i][j];
      const b = pts[i][(j + 1) % n];
      const c = pts[i + 1][(j + 1) % n];
      const d = pts[i + 1][j];
      put([a, b, c]);
      put([a, c, d]);
    }
  for (const ring of [pts[0], pts[pts.length - 1]])
    for (let j = 1; j + 1 < n; j++) put([ring[0], ring[j], ring[j + 1]]);
  return tris;
}

/** The points a list of solids costs, each corner once. */
export const pointsOf = (list) => list.reduce((s, x) => s + x.rings.length * x.rings[0].poly.length, 0);

/** Cuts under this (half a texel at 3 a unit) are lost in the paint and cost points: left off. */
const LEAST_CUT = 0.15;

/**
 * A box sx by sy by sz about the place (its foot at z = -sz/2, or at 0 with `foot`). `cut`: its upright edges cut
 * (an octagon); `bevel`: its top's edges cut; `bevelFoot`: its foot's; `taper`, `taperY`: the top that much of
 * the foot.
 */
export function box(pl, sx, sy, sz, o = {}) {
  let { cut = 0, bevel = 0, bevelFoot = 0 } = o;
  const { taper = 1, taperY = taper, foot = false, mat = "dark" } = o;
  if (bevel < LEAST_CUT) bevel = 0;
  if (bevelFoot < LEAST_CUT) bevelFoot = 0;
  if (cut < LEAST_CUT) cut = 0;
  const z0 = foot ? 0 : -sz / 2;
  const z1 = z0 + sz;
  const p0 = rect(sx, sy, cut);
  const p1 = scale2(p0, taper, taperY);
  const rings = [];
  if (bevelFoot > 0) rings.push({ z: z0, poly: inset(p0, bevelFoot) }, { z: z0 + bevelFoot, poly: p0 });
  else rings.push({ z: z0, poly: p0 });
  if (bevel > 0) rings.push({ z: z1 - bevel, poly: p1 }, { z: z1, poly: inset(p1, bevel) });
  else rings.push({ z: z1, poly: p1 });
  return { place: pl, rings, mat };
}

/** A plate: a convex outline in the place's XY, `t` thick out along Z from `z0`, its top's edges cut by `bevel`. */
export function plate(pl, poly, t, { bevel = 0, z0 = 0, top = 1, mat = "olive" } = {}) {
  const b = Math.min(bevel, t * 0.8);
  const p1 = scale2(poly, top);
  const rings = [{ z: z0, poly }];
  if (b > 0) rings.push({ z: z0 + t - b, poly: p1 }, { z: z0 + t, poly: inset(p1, b) });
  else rings.push({ z: z0 + t, poly: p1 });
  return { place: pl, rings, mat };
}

/** A prism: a convex outline from z0 to z1 along the place's Z, its top `top` times the foot. */
export const prism = (pl, poly, z0, z1, { top = 1, mat = "dark" } = {}) => ({
  place: pl,
  rings: [
    { z: z0, poly },
    { z: z1, poly: scale2(poly, top) },
  ],
  mat,
});

/** A cylinder along Z from z0 to z1, radius r (r1 at its top), n sides; `bevel` cuts both ends' rims. */
export function cyl(pl, r, z0, z1, { n = 6, r1 = r, bevel = 0, mat = "dark" } = {}) {
  // a thin rod is four-sided, a rim under half a texel left off: neither shows, both cost points
  if (Math.max(r, r1) < 0.3) n = 4;
  if (bevel < 0.1) bevel = 0;
  const b = Math.min(bevel, (z1 - z0) / 3, r * 0.4);
  const rings =
    b > 0
      ? [
          { z: z0, poly: ngon(n, r - b) },
          { z: z0 + b, poly: ngon(n, r) },
          { z: z1 - b, poly: ngon(n, r1) },
          { z: z1, poly: ngon(n, r1 - b) },
        ]
      : [
          { z: z0, poly: ngon(n, r) },
          { z: z1, poly: ngon(n, r1) },
        ];
  return { place: pl, rings, mat };
}

/** A box from p0 to p1, `w` across (along `up` as near as it goes) by `d`; `opts` as `box`'s. */
export function beam(p0, p1, w, d, up = [0, 0, 1], opts = {}) {
  const pl = place(lerp3(p0, p1, 0.5), sub(p1, p0), up);
  return box(pl, w, d, len(sub(p1, p0)), opts);
}

/** A rod from p0 to p1, radius r. */
export function tube(p0, p1, r, { n = 6, r1 = r, up = [0, 0, 1], mat = "dark", bevel = 0 } = {}) {
  return cyl(place(p0, sub(p1, p0), up), r, 0, len(sub(p1, p0)), { n, r1, mat, bevel });
}

/** A faceted ball about c: three rings of n corners, the middle one of radius r. */
export function ball(c, r, axis = [0, 0, 1], { n = 6, mat = "dark" } = {}) {
  return {
    place: place(c, axis),
    rings: [
      { z: -r * 0.72, poly: ngon(n, r * 0.62) },
      { z: 0, poly: ngon(n, r) },
      { z: r * 0.72, poly: ngon(n, r * 0.62) },
    ],
    mat,
  };
}

/** Any stack of rings on a place: [{ z, poly }], each of as many corners. */
export const loft = (pl, rings, mat = "olive") => ({ place: pl, rings, mat });


/**
 * A solid of revolution on a place: `profile` is [[radius, z], ...] from the foot up, turned n-sided (n = 8 to 16
 * reads round; 6 is a bolt). A radius under 0.05 is made that (a ring cannot be a point). Each ring is convex, so
 * a profile that swells and narrows is a stack of convex rings, as `loft`'s.
 */
export function lathe(pl, profile, { n = 10, mat = "dark" } = {}) {
  if (!Array.isArray(profile) || profile.length < 2) throw new Error("lathe: a profile is [[radius, z], ...], two points at least");
  return { place: pl, rings: profile.map(([r, z]) => ({ z, poly: ngon(n, Math.max(r, 0.05)) })), mat };
}

/** The area of a 2-D polygon, positive when counter-clockwise. */
const area2d = (poly) => poly.reduce((s, [x, y], i) => s + (x * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * y), 0) / 2;

/**
 * A closed 2-D `profile` ([[x, y], ...], any outline, convex or not) swept along `path` ([[x, y, z], ...], two points
 * or more) as triangles facing out, in the form `trisOf` gives: [[{ p, k }]]. In each section x runs to the path's
 * right (the path's direction crossed with `up`) and y along `up`. The sections at a bend are mitred (cut by the
 * plane between the two directions), so a path turning in one plane keeps the profile's width; a path that climbs
 * and turns twists a little there. `closed`: the path is a loop, with no end caps. `caps`: false leaves the ends open.
 * The triangles are one surface and may be concave: for a map's brushes, split it (`extrude` in maps/source.mjs).
 */
/** The sections of a sweep (see `sweepTris`): [{ a, b }] one a segment, each a ring of 3-D points, one for each profile point. */
export function sweepRings(profile, path, { up = [0, 0, 1], closed: loop = false } = {}) {
  if (profile.length < 3) throw new Error("sweepTris: a profile has three points at least");
  if (path.length < 2) throw new Error("sweepTris: a path has two points at least");
  const ring = area2d(profile) < 0 ? [...profile].reverse() : profile;
  const n = path.length;
  const dirs = [];
  for (let i = 0; i + 1 < n; i++) dirs.push(unit(sub(path[i + 1], path[i])));
  if (loop) dirs.push(unit(sub(path[0], path[n - 1])));
  const frame = (d) => {
    let right = cross(d, up);
    if (len(right) < 0.2) right = cross(d, [1, 0, 0]);
    right = unit(right);
    return { right, up: unit(cross(right, d)) };
  };
  // a section of segment `s` at path point `i`: the profile in the segment's frame, carried along the segment's
  // direction onto the plane at that point whose normal is the mean of the directions that meet there
  const section = (s, i) => {
    const d = dirs[s];
    const before = loop ? dirs[(i - 1 + dirs.length) % dirs.length] : dirs[i - 1];
    const after = loop ? dirs[i % dirs.length] : dirs[i];
    const m = before && after ? unit(add(before, after)) : d;
    const f = frame(d);
    return ring.map(([x, y]) => {
      const q = add(path[i % n], add(mul(f.right, x), mul(f.up, y)));
      const k = dot(m, d);
      const t = Math.abs(k) < 1e-6 ? 0 : dot(m, sub(path[i % n], q)) / k;
      return add(q, mul(d, t));
    });
  };
  const out = [];
  for (let s = 0; s < (loop ? n : n - 1); s++) out.push({ a: section(s, s), b: section(s, s + 1) });
  return out;
}

/** The triangles of a sweep (the comment above says how): [[{ p, k }]], facing out. */
export function sweepTris(profile, path, { up = [0, 0, 1], closed: loop = false, caps = true } = {}) {
  const rings = sweepRings(profile, path, { up, closed: loop });
  const ring = area2d(profile) < 0 ? [...profile].reverse() : profile;
  const tris = [];
  const put = (a, b, c, k) => {
    if (len(cross(sub(b, a), sub(c, a))) < NO_FACE) return;
    tris.push([a, b, c].map((p, j) => ({ p, k: k[j] })));
  };
  const m = ring.length;
  for (const { a, b } of rings)
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      put(a[j], a[j2], b[j2], [j, j2, m + j2]);
      put(a[j], b[j2], b[j], [j, m + j2, m + j]);
    }
  if (caps && !loop) {
    // a concave profile is cut into triangles by ear clipping
    const first = rings[0].a;
    const last = rings.at(-1).b;
    for (const j of earClip(ring)) {
      put(first[j[0]], first[j[2]], first[j[1]], [j[0], j[2], j[1]]);
      put(last[j[0]], last[j[1]], last[j[2]], [j[0], j[1], j[2]]);
    }
  }
  // facing out: the signed volume of the surface is positive, or all are turned over
  const centre = tris.flat().reduce((s, c) => add(s, c.p), [0, 0, 0]).map((v) => v / (tris.length * 3 || 1));
  const volume = tris.reduce((s, t) => s + dot(sub(t[0].p, centre), cross(sub(t[1].p, centre), sub(t[2].p, centre))), 0);
  return volume < 0 ? tris.map((t) => [t[0], t[2], t[1]]) : tris;
}

/** A straight sweep: `profile` along the line from `p0` to `p1` (see `sweepTris`). */
export const extrudeTris = (profile, p0, p1, opts = {}) => sweepTris(profile, [p0, p1], opts);

/** Triangles [i, j, k] (indices) of a counter-clockwise polygon, concave allowed, by ear clipping. */
export function earClip(poly) {
  const idx = poly.map((_, i) => i);
  const out = [];
  const cr = (a, b, c) => (poly[b][0] - poly[a][0]) * (poly[c][1] - poly[a][1]) - (poly[b][1] - poly[a][1]) * (poly[c][0] - poly[a][0]);
  const inside = (p, a, b, c) => cr(a, b, p) >= -1e-9 && cr(b, c, p) >= -1e-9 && cr(c, a, p) >= -1e-9;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length];
      const b = idx[i];
      const c = idx[(i + 1) % idx.length];
      if (cr(a, b, c) <= 1e-9) continue;
      if (idx.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push([a, b, c]);
      idx.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

// ── measures of a piece ────────────────────────────────────────────────────

/** Two planes closer than this in their direction (as a cosine) and their distance are one. */
const SAME_PLANE = 0.9999;
const SAME_DISTANCE = 1e-3;

/**
 * The planes of a convex piece: [{ n, d }], `n` outward and of length 1; a point p is inside when n.p < d for
 * every plane. `tris` as `trisOf` gives them (corners with `p`), or triangles of points.
 */
export function planesOf(tris) {
  const planes = [];
  for (const t of tris) {
    const [a, b, c] = t.map((corner) => corner.p ?? corner);
    const raw = cross(sub(b, a), sub(c, a));
    if (len(raw) < NO_FACE) continue;
    const n = unit(raw);
    const d = dot(n, a);
    if (!planes.some((q) => dot(q.n, n) > SAME_PLANE && Math.abs(q.d - d) < SAME_DISTANCE))
      planes.push({ n, d });
  }
  return planes;
}

const keyOf = (p) => p.map((v) => Math.round(v * 1e4)).join(",");

/**
 * Whether triangles close a volume: every edge met by exactly two faces, once each way round. Returns
 * { closed, open (edges met once), doubled (edges met twice the same way: a face turned over, or more) }.
 */
export function closed(tris) {
  const edges = new Map();
  for (const t of tris) {
    const k = t.map((corner) => keyOf(corner.p ?? corner));
    for (let i = 0; i < 3; i++) {
      const e = `${k[i]}|${k[(i + 1) % 3]}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  let open = 0;
  let doubled = 0;
  for (const [e, count] of edges) {
    const [a, b] = e.split("|");
    const back = edges.get(`${b}|${a}`) ?? 0;
    if (count > 1) doubled++;
    else if (back !== 1) open++;
  }
  return { closed: !open && !doubled, open, doubled };
}
