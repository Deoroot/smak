// Builders of form for a map written by hand: a roof, a dome, an arcade, a tree. Pure functions that return
// brushes (convex solids of the map's `solid`), each the one way to make its thing (ARCHITECTURE 2.4). Their
// sloped faces wear their picture along the face (source.mjs, `align: "auto"`); each takes `scale` (a number or
// [x, y]), the picture's scale on every face it makes (`withScale`).
import { solid, solidOfPlanes, prism, arch, box, turned, withScale } from "./source.mjs";
import { frame } from "./frame.mjs";

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
 *   scale     the picture's scale on every face, a number or [x, y]
 */
export function roof(outline, { pitch = 35, kind = "gable", overhang = 0, thick = 8, z = 0, ridge = "long", snap = 1, texture, scale } = {}) {
  const who = "roof";
  if (!["gable", "hip", "shed", "flat"].includes(kind)) throw new Error(`${who}: kind is gable, hip, shed or flat, not ${kind}`);
  if (texture === undefined) throw new Error(`${who}: it needs a texture`);
  texture = withScale(texture, scale);
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

/**
 * A dome: the upper half of a sphere of `radius` round `center` (the middle of its base, [x, y, z]), a shell
 * `thick` thick (16) of `rings` bands of `segments` tiles (4 and 12), each tile a convex solid. A tile's
 * faces are planes through its corners, so the shell is the sphere's polygon, not the sphere. `open` is
 * the radius of an eye at the top, left open (a lantern's, a Pantheon's); without it the top is closed by a
 * cap of pointed tiles. Corners are rounded to whole units (`snap` 1; 0 keeps them exact).
 * `texture`: anything a builder takes; `scale` the picture's scale on every face.
 */
export function dome(center, radius, { rings = 4, segments = 12, thick = 16, texture, open = 0, snap = 1, scale } = {}) {
  const who = "dome";
  if (!(Array.isArray(center) && center.length === 3 && center.every(Number.isFinite))) throw new Error(`${who}: the center is [x, y, z]`);
  if (!(radius > 0)) throw new Error(`${who}: a radius over 0, not ${radius}`);
  if (!(rings >= 1 && Number.isInteger(rings))) throw new Error(`${who}: rings is a whole number, 1 at least, not ${rings}`);
  if (!(segments >= 3 && Number.isInteger(segments))) throw new Error(`${who}: segments is a whole number, 3 at least, not ${segments}`);
  if (!(thick > 0 && thick < radius)) throw new Error(`${who}: thick is over 0 and under the radius, not ${thick}`);
  if (!(open >= 0 && open < radius - thick)) throw new Error(`${who}: the eye (open) is 0 or more and under the inner radius ${radius - thick}, not ${open}`);
  if (texture === undefined) throw new Error(`${who}: it needs a texture`);
  texture = withScale(texture, scale);
  const top = open > 0 ? Math.acos(open / radius) : Math.PI / 2;
  const inner = radius - thick;
  const on = (r, elevation, k) => {
    const turn = (2 * Math.PI * k) / segments;
    const flat = r * Math.cos(elevation);
    const p = [center[0] + flat * Math.cos(turn), center[1] + flat * Math.sin(turn), center[2] + r * Math.sin(elevation)];
    return p.map((v) => (snap ? Math.round(v / snap) * snap : tidy(v)));
  };
  // A tile's faces are planes through three rounded corners each, and a plane two tiles share is given the
  // same three corners by both: the tiles meet without a crack, and no face is asked to hold a fourth corner
  // that rounding moved off it (the compiler refuses the sliver that makes). The faces are, in a tile of band
  // b and segment k: its outer and inner side, the meridian plane at k and at k + 1, the ring plane under
  // it and the one over it (the band below's and above's, too).
  const tiles = [];
  const elevation = (ring) => (top * ring) / rings;
  const meridian = (ring, k) => [on(radius, elevation(ring), k), on(radius, elevation(ring + 1), k), on(inner, elevation(ring), k)];
  const ringOf = (ring, k) => [on(radius, elevation(ring), k), on(radius, elevation(ring), k + 1), on(inner, elevation(ring), k)];
  for (let band = 0; band < rings; band++) {
    const [e0, e1] = [elevation(band), elevation(band + 1)];
    const capped = open === 0 && band === rings - 1;
    for (let k = 0; k < segments; k++) {
      const corners = [[radius, e0, k], [radius, e0, k + 1], [inner, e0, k], [inner, e0, k + 1]];
      if (capped) corners.push([radius, e1, 0], [inner, e1, 0]);
      else corners.push([radius, e1, k], [radius, e1, k + 1], [inner, e1, k], [inner, e1, k + 1]);
      const points = corners.map(([r, e, i]) => on(r, e, i));
      const middle = [0, 1, 2].map((i) => points.reduce((sum, point) => sum + point[i], 0) / points.length);
      const threes = [
        [on(radius, e0, k), on(radius, e0, k + 1), on(radius, e1, k)],
        [on(inner, e0, k), on(inner, e0, k + 1), on(inner, e1, k)],
        meridian(band, k),
        meridian(band, k + 1),
        ringOf(band, k),
      ];
      // the ring over a pointed cap is no face: the tiles meet at the apex
      if (!capped) threes.push(ringOf(band + 1, k));
      tiles.push(solidOfPlanes(threes, middle, texture));
    }
  }
  return tiles;
}

/**
 * An arcade: a row of `bays` round arches along the line `from` to `to` ([x, y, z], the floor at from[2]),
 * piers between them, as a portico, a cloister or a bridge's underside. Each arch is `arch`'s run of
 * wedges, the masonry round the curve up to the top of the row; the opening under it is clear.
 *
 *   bays     how many arches (3)
 *   width    the clear width of a bay; without it, what the length leaves after the piers
 *   pier     a pier's width along the row (32); with `width` given too, they have to fill the length
 *   height   the opening's height from the floor to the crown of its arch (1.5 x the bay's width)
 *   cap      the masonry over the crowns up to the top of the row (24)
 *   depth    the row's thickness across the line, centred on it (32)
 *   texture  anything a builder takes
 *   scale    the picture's scale on every face, a number or [x, y]
 * The line may run any way; corners are whole units. It returns the list of brushes.
 */
export function arcade(from, to, { bays = 3, width, pier, height, cap = 24, depth = 32, texture, pieces = 6, scale } = {}) {
  const who = "arcade";
  for (const [name, p] of [["from", from], ["to", to]])
    if (!(Array.isArray(p) && p.length === 3 && p.every(Number.isFinite))) throw new Error(`${who}: ${name} is [x, y, z]`);
  if (!(Number.isInteger(bays) && bays >= 1)) throw new Error(`${who}: bays is a whole number, 1 at least, not ${bays}`);
  if (texture === undefined) throw new Error(`${who}: it needs a texture`);
  texture = withScale(texture, scale);
  const run = [to[0] - from[0], to[1] - from[1]];
  const length = Math.hypot(...run);
  if (!(length > 0)) throw new Error(`${who}: from and to are the same place`);
  let b = width;
  let p = pier;
  if (b === undefined && p === undefined) p = 32;
  if (b === undefined) b = (length - (bays + 1) * p) / bays;
  else if (p === undefined) p = (length - bays * b) / (bays + 1);
  else if (Math.abs(bays * b + (bays + 1) * p - length) > 1)
    throw new Error(`${who}: ${bays} bays of ${b} and ${bays + 1} piers of ${p} make ${bays * b + (bays + 1) * p}, not the ${Math.round(length)} between the points`);
  if (!(b >= 16 && p >= 8)) throw new Error(`${who}: a bay of ${b} between piers of ${p} will not fit in ${Math.round(length)}: fewer bays`);
  const wide = 2 * Math.round(b / 2); // an even bay: the arch's centre is on a whole unit
  const crown = Math.round(height ?? wide * 1.5);
  if (!(crown >= b / 2)) throw new Error(`${who}: the opening's height ${crown} is under half its width ${b / 2}: no room for the curve`);
  if (!(cap > 0 && depth > 0)) throw new Error(`${who}: cap and depth are over 0`);
  const spring = crown - wide / 2;
  const top = crown + cap;
  const yaw = (Math.atan2(run[1], run[0]) * 180) / Math.PI;
  const half = depth / 2;
  // in the row's own frame: along +x from the origin, its floor at z 0, its depth across y
  const brushes = [];
  const lefts = Array.from({ length: bays }, (_, i) => Math.round(p + i * (b + p)));
  const end = Math.round(length);
  let edge = 0;
  for (let i = 0; i <= bays; i++) {
    const next = i < bays ? lefts[i] : end;
    brushes.push(box([edge, -half, 0], [next, half, top], texture));
    edge = next + wide;
  }
  for (const x0 of lefts)
    brushes.push(...arch("y", { centre: [x0 + wide / 2, spring], radius: wide / 2, outer: { min: [x0, spring], max: [x0 + wide, top] }, pieces, snap: 1 }, -half, half, texture));
  return frame({ at: from, yaw }).place({ brushes }).brushes;
}

/**
 * A ring of `sides` points of radius `r` round `c` ([x, y]) at height `z`, turned `turn` degrees; the points exact
 * (a ring rounded to the grid would bend the sides of the solid through it).
 */
const ringAt = (c, r, z, turn, sides) =>
  Array.from({ length: sides }, (_, k) => {
    const a = ((turn + (360 * k) / sides) * Math.PI) / 180;
    return [tidy(c[0] + r * Math.cos(a)), tidy(c[1] + r * Math.sin(a)), z];
  });

/**
 * A frustum: one convex solid from the ring of `r0` round `c0` at `z0` to the ring of `r1` round `c1` at `z1`
 * (`r1` 0: to a point), 8 sides. The two rings are alike, so each side is one flat face, whether or not the
 * axis leans (`c1` off `c0`) or `z1` is under `z0`.
 */
function frustum(c0, r0, z0, c1, r1, z1, texture, turn = 0, sides = 8) {
  const base = ringAt(c0, r0, z0, turn, sides);
  const faces = [[0, 1, 2]];
  if (r1 > 0) {
    faces.push([sides, sides + 1, sides + 2]);
    for (let k = 0; k < sides; k++) faces.push([k, (k + 1) % sides, sides + k]);
    return solid([...base, ...ringAt(c1, r1, z1, turn, sides)], texture, { faces });
  }
  for (let k = 0; k < sides; k++) faces.push([k, (k + 1) % sides, sides]);
  return solid([...base, [c1[0], c1[1], z1]], texture, { faces });
}

/**
 * A tree of brushes, as the game's own maps make them (faceted): `at` is [x, y, z], the foot of its trunk on the
 * ground; `height` its top (256); `trunk` the trunk's radius at the foot (12); `crown` the foliage's widest radius
 * (96; a cypress's 40; a palm's frond reach); `bark` and `leaves` its two textures, anything a builder takes.
 *
 *   kind  "round"    an 8-sided trunk tapering to the crown, and three lobes of leaves stacked and set a little
 *                    off the axis, the middle one the widest, the lowest smaller: each lobe two frusta that meet
 *                    at its widest ring (7 brushes)
 *         "cypress"  a short trunk and a tall spindle, two frusta meeting at a third of the way up, pointed (3)
 *         "palm"     the trunk in two pieces leaning out a quarter of `crown`, and seven fronds radiating from
 *                    its head, each a thin wedge rising then drooping, alternate ones shorter and lower (9)
 *   snap  1 rounds the heights, centres and radii to whole units; 0 keeps them exact. A ring's corners are exact
 *         either way, so every side is flat and every brush closes for sdHLCSG (`csgFaults`)
 *   scale the pictures' scale on every face, a number or [x, y]
 * It returns the list of brushes: put a tree in a `func_detail` or a `func_wall`, as a map does, not in the world.
 */
export function tree(at, { height = 256, trunk = 12, crown, kind = "round", bark, leaves, snap = 1, scale } = {}) {
  const who = "tree";
  if (!(Array.isArray(at) && at.length === 3 && at.every(Number.isFinite))) throw new Error(`${who}: at is [x, y, z], the foot of the trunk`);
  if (!["round", "cypress", "palm"].includes(kind)) throw new Error(`${who}: kind is round, cypress or palm, not ${kind}`);
  if (bark === undefined || leaves === undefined) throw new Error(`${who}: it needs bark and leaves, its two textures`);
  if (!(height >= 64 && trunk >= 2)) throw new Error(`${who}: a height of 64 at least and a trunk of 2 at least, not ${height} and ${trunk}`);
  crown ??= kind === "cypress" ? 40 : 96;
  if (!(crown >= trunk)) throw new Error(`${who}: the crown (${crown}) is as wide as the trunk at least`);
  const grid = (v) => (snap ? Math.round(v / snap) * snap : tidy(v));
  const c = (dx, dy) => [grid(at[0] + dx), grid(at[1] + dy)];
  const h = (share) => grid(at[2] + height * share);
  const [barkOf, leafOf] = [withScale(bark, scale), withScale(leaves, scale)];
  const foot = c(0, 0);
  if (kind === "round") {
    // the lobes: the centre's offset (shares of the crown), the radius's share, the heights of the bottom, the
    // widest ring and the top (shares of the height), the turn of the ring
    const lobes = [[[0.18, -0.12], 0.72, 0.28, 0.42, 0.58, 0], [[-0.1, 0.08], 1, 0.46, 0.64, 0.82, 22.5], [[0.06, 0.1], 0.68, 0.74, 0.86, 1, 0]]; // prettier-ignore
    const brushes = [frustum(foot, trunk, at[2], foot, grid(trunk * 0.6), h(0.42), barkOf, 22.5)];
    for (const [[ox, oy], share, bottom, widest, top, turn] of lobes) {
      const centre = c(ox * crown, oy * crown);
      const r = grid(crown * share);
      brushes.push(frustum(centre, r, h(widest), centre, grid(r * 0.6), h(bottom), leafOf, turn));
      brushes.push(frustum(centre, r, h(widest), centre, grid(r * 0.5), h(top), leafOf, turn));
    }
    return brushes;
  }
  if (kind === "cypress") {
    const waist = h(0.12 + 0.88 / 3);
    return [
      frustum(foot, trunk, at[2], foot, grid(trunk * 0.7), h(0.14), barkOf, 22.5),
      frustum(foot, crown, waist, foot, grid(crown * 0.3), h(0.12), leafOf),
      frustum(foot, crown, waist, foot, 0, h(1), leafOf),
    ];
  }
  // palm: the trunk leans out as it rises, in two pieces; the fronds are wedges along +x, each turned to its angle
  const lean = crown / 4;
  const mid = c(lean * 0.4, lean * 0.15);
  const head = c(lean, lean * 0.35);
  const top = h(1) - 16;
  const brushes = [
    frustum(foot, trunk, at[2], mid, grid(trunk * 0.85), h(0.5), barkOf, 22.5),
    frustum(mid, grid(trunk * 0.85), h(0.5), head, grid(trunk * 0.7), top, barkOf, 22.5),
  ];
  for (let k = 0; k < 7; k++) {
    const reach = k % 2 ? grid(crown * 0.85) : crown;
    const droop = k % 2 ? 0.55 : 0.4;
    const section = [[0, -4], [reach, -grid(reach * droop)], [grid(reach * 0.4), 16], [0, 6]].map(([x, z]) => [head[0] + x, top + z]);
    const frond = prism("y", section, head[1] - 5, head[1] + 5, leafOf);
    brushes.push(turned(frond, (360 * k) / 7 + (k % 2 ? 8 : 0), [head[0], head[1], top]));
  }
  return brushes;
}
