// Brushes that are not boxes: a 2-D profile drawn out along a line or a path (mouldings, cornices, a rounded roof,
// a vehicle's section), a box with its corners rounded, a loft between two rings. The map builders of source.mjs are
// boxes and prisms; these are what to reach for when a player will look at the thing (docs/MAPS-DESIGN.md, "Form").
// (`box(min, max, texture, { bevel, edges })` in source.mjs is the chamfered box.)
//
//   convexParts(profile)                         a 2-D outline of any shape cut into convex outlines (Hertel-Mehlhorn)
//   extrudeProfile(profile, from, to, texture, opts)
//                                                the profile drawn out along an axis (from, to numbers; opts.axis "x"|"y"|"z",
//                                                the profile's two coordinates as `prism`'s) or along a line (from, to
//                                                points; opts.up); [brush], one for each convex part
//   sweepProfile(profile, path, texture, opts)   the profile along a path of points, mitred at the bends; [brush]
//   roundedBox(min, max, texture, opts)          a box whose upright edges are rounded: radius, steps (corner sides, 2 = 45 degrees)
//   loftBrush(ringA, ringB, texture)             one convex brush through two rings of 3-D points
//   brushFaults(brush, opts)                     sentences for a brush the compilers will drop or the map pays for: a face under
//                                                MIN_AREA, an edge under MIN_EDGE, more than MAX_FACES faces
//
// LIMITS (every builder here throws, in words, rather than hand on a brush the compilers cut down): no edge under
// 1 unit (MIN_EDGE), no face under 4 square units (MIN_AREA), at most 32 faces a brush (MAX_FACES: a shape with more
// curves is a model). Rounded shapes are off the grid; `snap: 1` rounds corners to whole units (see `offGrid`).
import { solid, prism, shapeOf, withScale } from "./source.mjs";
import { earClip, sweepRings } from "../../core/solids.mjs";

export const MIN_EDGE = 1;
export const MIN_AREA = 4;
export const MAX_FACES = 32;

const area2 = (poly) => poly.reduce((s, [x, y], i) => s + (x * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * y), 0) / 2;
const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/**
 * A 2-D outline (any simple polygon, either way round) cut into convex outlines, counter-clockwise: ears are
 * clipped, then neighbours are merged while the merge stays convex, so an L is two and a rectangle is one.
 */
export function convexParts(profile) {
  if (!Array.isArray(profile) || profile.length < 3) throw new Error("convexParts: an outline has three points at least");
  const poly = area2(profile) < 0 ? [...profile].reverse() : profile;
  const parts = earClip(poly).map((t) => [...t]);
  const convex = (idx) => idx.every((_, i) => cr(poly[idx[i]], poly[idx[(i + 1) % idx.length]], poly[idx[(i + 2) % idx.length]]) >= -1e-9);
  for (let again = true; again; ) {
    again = false;
    outer: for (let a = 0; a < parts.length; a++)
      for (let b = a + 1; b < parts.length; b++) {
        const A = parts[a];
        const B = parts[b];
        for (let i = 0; i < A.length; i++) {
          const u = A[i];
          const v = A[(i + 1) % A.length];
          const j = B.findIndex((w, k) => w === v && B[(k + 1) % B.length] === u);
          if (j < 0) continue;
          // A walked from v round to u, then B from after u round to before v
          const merged = [];
          for (let k = 0; k < A.length; k++) merged.push(A[(i + 1 + k) % A.length]);
          for (let k = 2; k < B.length; k++) merged.push(B[(j + k) % B.length]);
          if (!convex(merged)) continue;
          parts[a] = merged;
          parts.splice(b, 1);
          again = true;
          break outer;
        }
      }
  }
  // collinear middle points go
  return parts.map((idx) => idx.filter((p, k) => Math.abs(cr(poly[idx[(k + idx.length - 1) % idx.length]], poly[p], poly[idx[(k + 1) % idx.length]])) > 1e-9).map((i) => poly[i]));
}

/** Sentences for a brush that is too small to compile or too heavy to keep (empty: it is fine). */
export function brushFaults(brush, { minEdge = MIN_EDGE, minArea = MIN_AREA, maxFaces = MAX_FACES } = {}) {
  const shape = shapeOf(brush);
  const out = [...shape.faults];
  if (brush.faces.length > maxFaces) out.push(`${brush.faces.length} faces: over ${maxFaces}; a shape with that many curves is a model`);
  shape.faces.forEach((f, i) => {
    if (f.area > 0 && f.area < minArea) out.push(`face ${i} (${f.texture}) is ${Math.round(f.area * 100) / 100} square units: under ${minArea}, a microface`);
    f.polygon.forEach((p, k) => {
      const q = f.polygon[(k + 1) % f.polygon.length];
      const e = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      if (e < minEdge) out.push(`face ${i} (${f.texture}) has an edge of ${Math.round(e * 100) / 100}: under ${minEdge}`);
    });
  });
  return out;
}

const snapped = (p, snap) => (snap ? p.map((v) => Math.round(v / snap) * snap) : p);

/** Every brush checked against the limits; throws one sentence for the first that fails. */
function whole(brushes, who, opts) {
  for (const b of brushes) {
    const faults = brushFaults(b, opts);
    if (faults.length) throw new Error(`${who}: ${faults[0]}: widen the profile or leave the detail out`);
  }
  return brushes;
}

/** A profile counter-clockwise, and the number of a point in it. */
function oriented(profile) {
  const poly = area2(profile) < 0 ? [...profile].reverse() : profile;
  return { poly, index: (pt) => poly.findIndex((q) => q[0] === pt[0] && q[1] === pt[1]) };
}

/**
 * The profile drawn out. With `from` and `to` numbers, along `opts.axis` ("z" unless told) as `prism` does, the
 * profile's two coordinates those of the other axes in their order. With `from` and `to` points, along the line
 * between them: the profile's x runs to the line's right (the line crossed with `opts.up`, [0, 0, 1]) and y along
 * up. A profile that is not convex gives several brushes, side by side. `scale` (a number or [x, y]) is the
 * picture's scale on every face. Returns [brush].
 */
export function extrudeProfile(profile, from, to, texture, { axis = "z", up = [0, 0, 1], snap = 0, scale, ...limits } = {}) {
  texture = withScale(texture, scale);
  const parts = convexParts(profile);
  if (typeof from === "number") return whole(parts.map((part) => prism(axis, part, from, to, texture)), "extrudeProfile", limits);
  const { index } = oriented(profile);
  const { a, b } = sweepRings(profile, [from, to], { up })[0];
  return whole(
    parts.map((part) => {
      const ids = part.map(index);
      return solid([...ids.map((i) => snapped(a[i], snap)), ...ids.map((i) => snapped(b[i], snap))], texture);
    }),
    "extrudeProfile",
    limits,
  );
}

/**
 * The profile along a path of points, one brush a convex part and segment, the sections mitred at the bends.
 * `closed`: the path is a loop (a ring beam). `up` and `scale` as `extrudeProfile`'s. Returns [brush].
 */
export function sweepProfile(profile, path, texture, { up = [0, 0, 1], closed = false, snap = 0, scale, ...limits } = {}) {
  texture = withScale(texture, scale);
  const parts = convexParts(profile);
  const { index } = oriented(profile);
  const out = [];
  for (const { a, b } of sweepRings(profile, path, { up, closed }))
    for (const part of parts) {
      const ids = part.map(index);
      out.push(solid([...ids.map((i) => snapped(a[i], snap)), ...ids.map((i) => snapped(b[i], snap))], texture));
    }
  return whole(out, "sweepProfile", limits);
}

/**
 * A box from `min` to `max` whose edges along `axis` (z unless told: the upright ones) are rounded by `radius`, each
 * corner `steps` sides (1 is a 45-degree cut, 2 a corner of two facets, 3 reads round). The radius is 1 to half the
 * smaller side across. `snap: 1` rounds the corners to whole units. One brush of at most 4 * (steps + 1) + 2 faces (corners snapped to the grid lose the facets that fall in one line).
 */
export function roundedBox(min, max, texture, { radius = 8, steps = 2, axis = "z", snap = 0, ...limits } = {}) {
  const a = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  const [u, v] = [0, 1, 2].filter((i) => i !== a);
  const w = max[u] - min[u];
  const h = max[v] - min[v];
  if (!(radius >= 1) || radius > Math.min(w, h) / 2) throw new Error(`roundedBox: the radius is 1 to ${Math.min(w, h) / 2} (half the smaller side), not ${radius}`);
  const outline = [];
  const corners = [[max[u] - radius, max[v] - radius, 0], [min[u] + radius, max[v] - radius, 90], [min[u] + radius, min[v] + radius, 180], [max[u] - radius, min[v] + radius, 270]]; // prettier-ignore
  for (const [cx, cy, from] of corners)
    for (let s = 0; s <= steps; s++) {
      const t = ((from + (90 * s) / steps) * Math.PI) / 180;
      const p = [cx + radius * Math.cos(t), cy + radius * Math.sin(t)];
      outline.push(snap ? [Math.round(p[0] / snap) * snap, Math.round(p[1] / snap) * snap] : p);
    }
  const clean = outline.filter((p, i) => Math.hypot(p[0] - outline[(i + 1) % outline.length][0], p[1] - outline[(i + 1) % outline.length][1]) > 1e-6);
  return whole([prism(axis, clean, min[a], max[a], texture)], "roundedBox", limits)[0];
}

/** One convex brush through two rings of 3-D points (the same count each; a tapering post, a flared base). */
export function loftBrush(ringA, ringB, texture) {
  if (ringA.length !== ringB.length || ringA.length < 3) throw new Error("loftBrush: two rings of as many points, three at least");
  return whole([solid([...ringA, ...ringB], texture)], "loftBrush", {})[0];
}
