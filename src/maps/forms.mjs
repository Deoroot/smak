// Builders of form for a map written by hand: a roof. Pure functions that return brushes
// (convex solids of the map's `solid`), each the one way to make its thing (ARCHITECTURE 2.4). Their sloped
// faces wear their picture along the face (source.mjs, `align: "auto"`).
import { solid, prism } from "./source.mjs";

const tidy = (value) => Math.round(value * 1e6) / 1e6;
const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len2 = (a) => Math.hypot(a[0], a[1]);
const unit2 = (a) => {
  const n = len2(a);
  return [a[0] / n, a[1] / n];
};
const mid2 = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];

/** The outline anticlockwise (seen from above), as 2D points. */
function ringOf(outline, who) {
  if (!Array.isArray(outline) || outline.length < 3 || !outline.every((p) => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite)))
    throw new Error(`${who}: the outline is a list of [x, y] points, three at least`);
  const ring = outline.map((p) => [p[0], p[1]]);
  let area = 0;
  ring.forEach((p, i) => (area += cross2(p, ring[(i + 1) % ring.length])));
  if (!(Math.abs(area) > 1e-6)) throw new Error(`${who}: the outline has no area`);
  return area > 0 ? ring : ring.reverse();
}

/** The ring with each edge i moved out by `by[i]` (negative: in), the corners where the moved edges meet. */
function expanded(ring, by) {
  const n = ring.length;
  const lines = ring.map((p, i) => {
    const q = ring[(i + 1) % n];
    const d = unit2(sub2(q, p));
    const out = [d[1], -d[0]]; // anticlockwise ring: the outside is to the right
    return { p: [p[0] + out[0] * by[i], p[1] + out[1] * by[i]], d };
  });
  return ring.map((_, i) => {
    const a = lines[(i + n - 1) % n];
    const b = lines[i];
    const det = cross2(a.d, b.d);
    if (Math.abs(det) < 1e-9) return b.p;
    const t = cross2(sub2(b.p, a.p), b.d) / det;
    return [a.p[0] + a.d[0] * t, a.p[1] + a.d[1] * t];
  });
}

/** A rectangle's frame: its corner p0, the directions along (p0 to p1) and across (p0 to p3), and the two sizes. */
function rectangleOf(ring, who) {
  if (ring.length !== 4) throw new Error(`${who}: a gable or a hip roof is over four points, not ${ring.length}`);
  const along = sub2(ring[1], ring[0]);
  const across = sub2(ring[3], ring[0]);
  const a = len2(along);
  const b = len2(across);
  const skew = Math.abs(cross2(unit2(along), unit2(across))) < 0.999;
  const open = len2(sub2(sub2(ring[2], ring[1]), across)) > 2;
  if (skew || open) throw new Error(`${who}: a gable or a hip roof is over a rectangle (its corners square, within 2 units)`);
  return { p0: ring[0], u: unit2(along), v: unit2(across), a, b };
}

const overhangOf = (overhang) =>
  typeof overhang === "number" ? { eaves: overhang, gable: overhang } : { eaves: overhang?.eaves ?? 0, gable: overhang?.gable ?? 0 };

/**
 * A roof over a convex outline: the roof solids, a list of `solid`s. `outline` is [x, y] points (a fourth or
 * a third number is ignored); `z` the height of the walls' top the roof stands on.
 *
 *   kind      "gable"  two slabs meeting at a ridge along the longer side of a rectangle (the attic under them is
 *                      empty): the slabs' undersides cross `z` at the wall line and rise `pitch` degrees to the ridge
 *             "hip"    one solid sloping down on all four sides of a rectangle, the ridge along its longer side
 *                      (a point on a square)
 *             "shed"   one slab over any convex outline, rising away from the outline's first edge (point 0 to 1)
 *             "flat"   one slab `thick` high over the outline
 *   pitch     degrees (35); not for "flat"
 *   overhang  units the roof reaches out past the outline (0); or { eaves, gable }: past the long sides and past the
 *             short ones (a gable's ends); a hip and a flat roof take `eaves` all round, a shed on its first edge
 *             and `gable` on the others
 *   thick     a slab's thickness, vertical (8)
 *   snap      1 (the default) rounds the corners to whole units, which can make a slab a few faces more; 0 keeps them exact
 *   ridge     for a gable: "long" (default) the ridge along the longer side; "first" parallel to the outline's first
 *             edge (point 0 to 1), "second" parallel to its second
 *   texture   anything a builder takes: the sloped faces wear it along the face
 */
export function roof(outline, { pitch = 35, kind = "gable", overhang = 0, thick = 8, z = 0, ridge = "long", snap = 1, texture } = {}) {
  const who = "roof";
  if (!["gable", "hip", "shed", "flat"].includes(kind)) throw new Error(`${who}: kind is gable, hip, shed or flat, not ${kind}`);
  if (texture === undefined) throw new Error(`${who}: it needs a texture`);
  if (kind !== "flat" && !(pitch > 0 && pitch < 80)) throw new Error(`${who}: pitch is degrees over 0 and under 80, not ${pitch}`);
  if (!(thick > 0)) throw new Error(`${who}: thick is over 0, not ${thick}`);
  const ring = ringOf(outline, who);
  const over = overhangOf(overhang);
  if (over.eaves < 0 || over.gable < 0) throw new Error(`${who}: an overhang is 0 or more`);
  const tan = Math.tan((pitch * Math.PI) / 180);
  const thickZ = thick / Math.cos((pitch * Math.PI) / 180);
  const grid = (v) => (snap ? Math.round(v / snap) * snap : tidy(v));
  const at = (p, h) => [grid(p[0]), grid(p[1]), grid(h)];

  if (kind === "flat") {
    const wide = expanded(ring, ring.map(() => over.eaves));
    return [prism("z", wide.map((p) => [grid(p[0]), grid(p[1])]), z, z + thick, texture)];
  }

  if (kind === "shed") {
    const wide = expanded(ring, ring.map((_, i) => (i === 0 ? over.eaves : over.gable)));
    const d = unit2(sub2(ring[1], ring[0]));
    // height by the distance in from the first edge (the low one): the underside crosses z at the wall line
    const top = (p) => z + tan * cross2(d, sub2(p, ring[0])) + thickZ;
    return [solid([...wide.map((p) => at(p, top(p))), ...wide.map((p) => at(p, top(p) - thickZ))], texture)];
  }

  const { p0, u, v, a, b } = rectangleOf(ring, who);
  const point = (s, t) => [p0[0] + u[0] * s + v[0] * t, p0[1] + u[1] * s + v[1] * t];
  // the ridge runs along the longer side, or along the edge `ridge` names
  const longAlong = kind === "gable" && ridge === "first" ? true : kind === "gable" && ridge === "second" ? false : a >= b;
  const [long, short] = longAlong ? [a, b] : [b, a]; // along the ridge, across it
  const half = short / 2;
  const L = (s, t) => (longAlong ? point(s, t) : point(t, s)); // s along the ridge, t across it
  const ridgeAt = z + tan * half;
  // the eaves reach `over.eaves` past the long sides, the gable ends `over.gable` past the short ones
  const heightAt = (across) => z + tan * (half - Math.abs(across - half));
  if (kind === "gable") {
    const ends = [-over.gable, long + over.gable];
    const slabs = [];
    for (const edge of [-over.eaves, short + over.eaves]) {
      const top = [0, 1].map((e) => [L(ends[e], edge), heightAt(edge) + thickZ]);
      const crest = [0, 1].map((e) => [L(ends[e], half), ridgeAt + thickZ]);
      const under = [...top, ...crest].map(([p, h]) => [p, h - thickZ]);
      slabs.push(solid([...[...top, ...crest].map(([p, h]) => at(p, h)), ...under.map(([p, h]) => at(p, h))], texture));
    }
    return slabs;
  }
  // hip: the eaves' top ring, the base under it, the ridge shortened by the half span at both ends
  const edge = [-over.eaves, short + over.eaves];
  const reach = [-over.eaves, long + over.eaves];
  const eave = [[reach[0], edge[0]], [reach[1], edge[0]], [reach[1], edge[1]], [reach[0], edge[1]]];
  const dropZ = z - tan * over.eaves;
  const bottom = over.eaves > 0 ? dropZ - thick : dropZ;
  const ridges = long - short > 1e-6 ? [[half, half], [long - half, half]] : [[half, half]];
  return [
    solid(
      [
        ...eave.map(([s, t]) => at(L(s, t), bottom)),
        ...(bottom === dropZ ? [] : eave.map(([s, t]) => at(L(s, t), dropZ))),
        ...ridges.map(([s, t]) => at(L(s, t), ridgeAt)),
      ],
      texture,
    ),
  ];
}
