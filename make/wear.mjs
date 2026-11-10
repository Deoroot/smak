// Measuring what is worn: a body in the space of the bone it hangs on, a head against the helmet over it, a
// man's piece against the woman's, a body's weight against the others of its file. A worn piece (a helmet, a
// pauldron, a pack) is made in one bone's space, so that is where it is measured: +x, +y and +z there are the
// bone's own, which `bodyIn` hands over as they are (in a biped's head bone +x is usually up and +y forwards:
// look before trusting). And pieces that hang on bones driven into each other by the animations
// (`motionOverlaps`).
import {
  readMdl,
  apply34,
  inverse34,
  mul34,
  boneParents,
  restPose,
  poseAt,
  sequenceAt,
  sequences,
} from "../core/mdl.mjs";
import { posesFor } from "./linkage.mjs";
import { planesOf } from "../core/solids.mjs";
import { posed } from "./render.mjs";
import { sub, dot, cross, unit, box } from "../core/vec.mjs";
import { FRONT } from "./mesh.mjs";

/** A normal shorter than this is no normal: the file kept none for the corner. */
const NO_NORMAL = 1e-6;
/** An axis along which the points of a piece spread less than this (the divisor of its fit) is not scaled. */
const NO_SPREAD = 1e-12;
/** A box thinner than this along an axis is not scaled along it. */
const NO_SIZE = 1e-9;
/**
 * A point fit that leaves a point farther than this share of the piece's size from its own was not of the
 * same points in the same order.
 */
const POINT_FIT_WORST = 0.05;
/** A line that meets a face at less than this (the face seen edge on) does not cross it. */
const EDGE_ON = 1e-12;
/** How far outside a face's edges, and how near the line's start, a crossing still counts. */
const ON_FACE = 1e-9;

/** The points of what a caller gives: points, corners ({ p }), or triangles of either. */
const pointsOf = (given) =>
  Array.isArray(given[0]?.[0])
    ? given.flat()
    : given[0]?.[0]?.p
      ? given.flat().map((corner) => corner.p)
      : given[0]?.p
        ? given.map((corner) => corner.p)
        : given;
/** Triangles as three points each, whether their corners are points or { p }. */
const cornersOf = (tris) => tris.map((t) => (t[0].p ? t.map((corner) => corner.p) : t));

/**
 * A body's triangles in the space of one bone: [[{ p, n, bone, on } x3]], `on` true for a corner that hangs
 * on that bone, `n` its normal there (the face's own where the file keeps none).
 *   body      the body number (what `posed` takes); bone: the bone's name or number
 *   pose      { seq, frame }: where the model stands for the corners on other bones (a corner on the bone
 *             itself is where the file has it, whatever the pose)
 *   bodypart  only that bodypart's submodel (every bodypart's unless told)
 *   only      true: only the triangles with every corner on the bone (a head out of a whole body)
 *   pick(t)   a rule of your own on a triangle of `posed` ({ tex, where, tri, c })
 * Two models on one skeleton give the same space for the same bone's name: a helmet of one file and a head of
 * another are measured against each other there.
 */
export function bodyIn(src, body, bone, { pose = {}, bodypart = null, only = false, pick = null } = {}) {
  const stand = posed(src, { ...pose, body });
  const number = typeof bone === "number" ? bone : stand.info.bones.indexOf(bone);
  if (stand.info.bones[number] === undefined)
    throw new Error(`bodyIn: no bone ${bone}: it has ${stand.info.bones.join(", ")}`);
  const intoBone = inverse34(stand.pose[number]);
  return stand.tris
    .filter(
      (t) =>
        (bodypart === null || t.where.bodypart === bodypart) &&
        (!only || t.c.every((c) => c.bone === number)) &&
        (!pick || pick(t)),
    )
    .map((t) => {
      // a file may keep no normals (all nought): the way a face is wound says which side is out
      const points = t.c.map((c) => apply34(intoBone, c.p));
      const faceOut = unit(cross(sub(points[1], points[0]), sub(points[2], points[0])).map((v) => v * FRONT));
      return t.c.map((c, k) => {
        const n = intoBone.map((row) => dot(row, c.n));
        return {
          p: points[k],
          n: Math.hypot(...n) > NO_NORMAL ? n : faceOut,
          bone: c.bone,
          on: c.bone === number,
        };
      });
    });
}

/**
 * A body's box in a bone's own space: { mn, mx, mid, size, tris, corners, off } (`off`: how many of its
 * corners hang on another bone). The options are `bodyIn`'s.
 */
export function boxIn(src, body, bone, options = {}) {
  const tris = bodyIn(src, body, bone, options);
  const corners = tris.flat();
  if (!corners.length) throw new Error(`boxIn: body ${body} has nothing there`);
  const bounds = box(corners.map((c) => c.p));
  return {
    mn: bounds.mn,
    mx: bounds.mx,
    mid: bounds.mn.map((v, a) => (v + bounds.mx[a]) / 2),
    size: bounds.mn.map((v, a) => bounds.mx[a] - v),
    tris: tris.length,
    corners: corners.length,
    off: corners.filter((c) => !c.on).length,
  };
}

/**
 * The way a set of triangles faces on the whole (a unit vector): of a helmet's top triangles, which way its
 * crown looks. Corners with normals ({ p, n }, as `bodyIn` gives) say which side is out; bare ones are taken
 * as the workshop winds them.
 */
export function facingOf(tris) {
  const sum = [0, 0, 0];
  for (const t of tris) {
    const [a, b, c] = cornersOf([t])[0];
    const face = cross(sub(b, a), sub(c, a));
    const side = t[0].n ? Math.sign(dot(face, t[0].n)) || 1 : 1;
    for (let k = 0; k < 3; k++) sum[k] += face[k] * side;
  }
  return unit(sum);
}

/**
 * The scale and shift, axis by axis, that best take the points `from` to the points `to` (as many, in the
 * same order): least squares on each axis; with `uniform`, one scale for the three.
 */
function fitByPoints(from, to, uniform) {
  const count = from.length;
  // for each axis: the sums a straight-line fit of `to` against `from` is made of
  const sums = [0, 1, 2].map((axis) => {
    let sumFrom = 0;
    let sumTo = 0;
    let sumSquares = 0;
    let sumProducts = 0;
    for (let i = 0; i < count; i++) {
      sumFrom += from[i][axis];
      sumTo += to[i][axis];
      sumSquares += from[i][axis] ** 2;
      sumProducts += from[i][axis] * to[i][axis];
    }
    return {
      spread: count * sumSquares - sumFrom * sumFrom,
      together: count * sumProducts - sumFrom * sumTo,
      sumFrom,
      sumTo,
    };
  });
  const one = uniform
    ? sums.reduce((s, axis) => s + axis.together, 0) / sums.reduce((s, axis) => s + axis.spread, 0)
    : null;
  const k = sums.map((axis) => one ?? (axis.spread > NO_SPREAD ? axis.together / axis.spread : 1));
  const t = sums.map((axis, a) => (axis.sumTo - k[a] * axis.sumFrom) / count);
  return { k, t };
}

/** The scale and shift, axis by axis, that take the box of the points `from` to the box of `to`. */
function fitByBoxes(from, to, uniform) {
  const a = box(from);
  const b = box(to);
  const size = (bounds, axis) => bounds.mx[axis] - bounds.mn[axis];
  const one = uniform
    ? Math.cbrt([0, 1, 2].reduce((s, axis) => s * (size(b, axis) / (size(a, axis) || 1)), 1))
    : null;
  const k = [0, 1, 2].map((axis) => one ?? (size(a, axis) > NO_SIZE ? size(b, axis) / size(a, axis) : 1));
  const t = [0, 1, 2].map(
    (axis) => (b.mn[axis] + b.mx[axis]) / 2 - (k[axis] * (a.mn[axis] + a.mx[axis])) / 2,
  );
  return { k, t };
}

/**
 * The fit that takes one piece to another: each axis its own `p * k + t`. Given two lists of as many points
 * in the same order (a man's helmet and the woman's made from it), the best such fit and `worst`, the
 * farthest a point is left from its own; otherwise from their two boxes (`by` says which: "points" or
 * "boxes"). `from`, `to`: points, or triangles. A point fit that leaves a point more than a twentieth of the
 * piece's size from its own was not of the same points in the same order: the boxes are used then
 * (`boxes: false` keeps the point fit whatever it leaves; `points: false` goes by the boxes at once).
 * `uniform: true`: one scale for the three axes. Returns
 * { k: [x, y, z], t: [x, y, z], scale (their mean), worst, by, at(p), back(p) }: `at` takes a point of the
 * first to the second, `back` the other way.
 */
export function fitBetween(from, to, { uniform = false, points = true, boxes = true } = {}) {
  const fromPoints = pointsOf(from);
  const toPoints = pointsOf(to);
  const same = points && fromPoints.length === toPoints.length && fromPoints.length > 1;
  const { k, t } = same
    ? fitByPoints(fromPoints, toPoints, uniform)
    : fitByBoxes(fromPoints, toPoints, uniform);
  const at = (p) => p.map((v, a) => v * k[a] + t[a]);
  const back = (p) => p.map((v, a) => (v - t[a]) / k[a]);
  const worst = same
    ? fromPoints.reduce((most, p, i) => Math.max(most, Math.hypot(...sub(at(p), toPoints[i]))), 0)
    : null;
  // as many points, but not the same ones in the same order: the boxes then
  if (same && boxes && worst > POINT_FIT_WORST * Math.hypot(...sub(box(toPoints).mx, box(toPoints).mn)))
    return fitBetween(fromPoints, toPoints, { uniform, points: false });
  return { k, t, scale: (k[0] + k[1] + k[2]) / 3, worst, by: same ? "points" : "boxes", at, back };
}

/** The point of a triangle nearest `p`. (`nearestOn` in carry.mjs is the same search, giving weights.) */
function nearest(p, a, b, c) {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  // nearest the corner a
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  // nearest the corner b
  if (d3 >= 0 && d4 <= d3) return b;
  // nearest the edge a-b
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return a.map((x, k) => x + ab[k] * v);
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  // nearest the corner c
  if (d6 >= 0 && d5 <= d6) return c;
  // nearest the edge a-c
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return a.map((x, k) => x + ac[k] * w);
  }
  // nearest the edge b-c
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + d5 - d6);
    return b.map((x, k) => x + (c[k] - x) * w);
  }
  // over the face
  const k = 1 / (va + vb + vc);
  return a.map((x, i) => x + ab[i] * vb * k + ac[i] * vc * k);
}

/**
 * Is this inside that, and by how much at the tightest place: a head in a helmet, an arm in a pauldron.
 * `inner`: points (or triangles: their corners); `shell`: the triangles of what goes over it, both in one
 * space (as `bodyIn` gives them for one bone). A shell is open somewhere (a helmet below), so "inside" is
 * taken from the middle of what is worn under it (`centre`; the middle of the inner points' box unless told):
 * looking from there through a point, the point is **inside** when the line leaves the shell beyond it,
 * **outside** when it has left the shell before reaching it (it pokes through), and **open** when it never
 * leaves it (the neck, below the rim). The line leaves the shell through a face it meets from behind: a
 * lining, or a cone that closes the inside, faces the head and is not counted (`sides: "all"`: every face
 * is). Triangles with normals ({ p, n }, as `bodyIn` gives) say which side is out; bare ones are taken as the
 * workshop winds them.
 * Returns { inside, outside, open (counts), tightest: { gap, at, on }, worst: { out, at, on } or null,
 * fits }: `tightest` is the inside point nearest the shell's outer faces, `gap` units from them at `on`; `worst`
 * the outside point farthest out; `fits` is true when none is outside. Right for a shell its wearer's middle
 * sees all of: a helmet, a cup, a boot's shaft.
 */
export function clearance(inner, shell, { centre = null, sides = "outer" } = {}) {
  const points = pointsOf(inner);
  const faces = cornersOf(shell);
  const bounds = box(points);
  const mid = centre ?? bounds.mn.map((v, a) => (v + bounds.mx[a]) / 2);
  // which way each face looks: its corners' normals where it has them, else the way it is wound
  const outOf = faces.map(([a, b, c], i) =>
    shell[i][0]?.n
      ? [0, 1, 2].map((k) => shell[i][0].n[k] + shell[i][1].n[k] + shell[i][2].n[k])
      : cross(sub(b, a), sub(c, a)),
  );
  // for each point, the last face its line leaves the shell through, and how far along the line that is (1 at
  // the point itself)
  const exits = points.map((p) => {
    const line = sub(p, mid);
    let last = -Infinity;
    let face = -1;
    faces.forEach(([a, b, c], i) => {
      if (sides !== "all" && dot(outOf[i], line) <= 0) return;
      // where the line from `mid` meets the face's plane: (u, v) within the face, `along` the line
      const edge1 = sub(b, a);
      const edge2 = sub(c, a);
      const h = cross(line, edge2);
      const det = dot(edge1, h);
      if (Math.abs(det) < EDGE_ON) return;
      const fromCorner = sub(mid, a);
      const u = dot(fromCorner, h) / det;
      const q = cross(fromCorner, edge1);
      const v = dot(line, q) / det;
      const along = dot(edge2, q) / det;
      if (u >= -ON_FACE && v >= -ON_FACE && u + v <= 1 + ON_FACE && along > ON_FACE && along > last) {
        last = along;
        face = i;
      }
    });
    return { last, face };
  });
  // the faces some line leaves through: the shell's outer wall, as far as the inner points see it
  const wall = [...new Set(exits.map((exit) => exit.face).filter((i) => i >= 0))].map((i) => faces[i]);
  const out = { inside: 0, outside: 0, open: 0, tightest: null, worst: null, fits: true };
  points.forEach((p, i) => {
    if (exits[i].face < 0) return void out.open++;
    let gap = Infinity;
    let on = null;
    for (const [a, b, c] of wall) {
      const onFace = nearest(p, a, b, c);
      const distance = Math.hypot(...sub(onFace, p));
      if (distance < gap) {
        gap = distance;
        on = onFace;
      }
    }
    if (exits[i].last >= 1) {
      out.inside++;
      if (!out.tightest || gap < out.tightest.gap) out.tightest = { gap, at: p, on };
    } else {
      out.outside++;
      out.fits = false;
      if (!out.worst || gap > out.worst.out) out.worst = { out: gap, at: p, on };
    }
  });
  return out;
}

/**
 * Every body of a bodypart with what it weighs: [{ body, name, tris, verts, norms, textures: [names] }], and
 * on the list itself `median` (the triangle count of the middle one of those that have any): for holding a
 * new body against the file's own ("the game's helmets are about 150 triangles; this one is 464").
 */
export function bodyCounts(src, bodypart = 0) {
  const part = readMdl(src).bodyparts[bodypart];
  if (!part) throw new Error(`bodyCounts: no bodypart ${bodypart}`);
  const list = part.models.map((model, k) => ({
    body: k * part.base,
    name: model.name,
    tris: model.meshes.reduce((sum, mesh) => sum + mesh.numtris, 0),
    verts: model.numverts,
    norms: model.numnorms,
    textures: [
      ...new Set(
        model.meshes.filter((mesh) => mesh.numtris && mesh.texture).map((mesh) => mesh.texture.name),
      ),
    ],
  }));
  const counts = list
    .map((entry) => entry.tris)
    .filter(Boolean)
    .sort((a, b) => a - b);
  list.median = counts.length ? counts[Math.floor(counts.length / 2)] : 0;
  return list;
}

/** Two pieces whose middles are farther apart than this share of their two reaches together cannot touch. */
const OVERLAP_TOLERANCE = 0.25;

/**
 * Rigid convex pieces on bones driven into each other by the animations: for each pair on two bones, how much
 * deeper a corner of one goes inside the other than it does as built (the rest pose, or `still`), frame by frame.
 * Only pairs whose spheres (each piece's middle and its farthest corner) meet in a frame are measured.
 *   pieces   [{ bone, tris, name? }], each convex (as `solids` makes them): `bone` a name or a number, `tris`
 *            [[{ p } x3]] or triangles of points, in the bone's space (or in model space at rest, `space: "rest"`)
 *   seqs     the animations, by name or number (every one the file keeps when not given); those kept in other
 *            files are read from `groups`, or without their file left out and named in `skipped`
 *   options  { step = 2 (every how many frames), tol = 0.25 (the depth past which a pair is told), still: { seq,
 *            frame } (the pose the pieces are built in; the rest pose unless told), space = "bone", groups (the
 *            files of animations kept beside the model, as sequenceFilesOf reads them) }
 * Returns { built, sequences: [{ name, frames, pairs }], worst, skipped }: `built` the pairs already more than
 * `tol` inside each other as built ({ a, b, deep }); each sequence's `pairs` [{ a, b, deep, frame, near }],
 * deepest first, `deep` how much deeper than built, `near` true for bones next to each other (the same parent,
 * or one the other's parent or grandparent: a joint's own parts sit in each other by design); `worst` the
 * deepest of all ({ a, b, deep, frame, sequence }, or null). `a` and `b` are the pieces' names (their numbers
 * when they have none).
 */
export function motionOverlaps(
  src,
  pieces,
  seqs,
  { step = 2, tol = OVERLAP_TOLERANCE, still = null, space = "bone", groups } = {},
) {
  const names = readMdl(src).bones;
  const parents = boneParents(src);
  const into = space === "rest" ? restPose(src).map(inverse34) : null;
  const ps = pieces.map((piece, k) => {
    const bone = typeof piece.bone === "number" ? piece.bone : names.indexOf(piece.bone);
    if (names[bone] === undefined)
      throw new Error(`motionOverlaps: no bone ${piece.bone}: it has ${names.join(", ")}`);
    const tris = cornersOf(piece.tris).map((t) => (into ? t.map((p) => apply34(into[bone], p)) : t));
    const pts = [...new Map(tris.flat().map((p) => [p.join(), p])).values()];
    const c = [0, 1, 2].map((a) => pts.reduce((s, p) => s + p[a], 0) / pts.length);
    const r = Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])));
    return { name: piece.name ?? k, bone, pts, c, r, planes: planesOf(tris) };
  });
  const nearBones = (a, b) =>
    a === b ||
    parents[a] === b ||
    parents[b] === a ||
    parents[a] === parents[b] ||
    parents[parents[a]] === b ||
    parents[parents[b]] === a;
  // how deep a point is inside a convex piece: 0 outside it
  const depthIn = (q, p) => {
    let d = Infinity;
    for (const pl of q.planes) {
      const s = pl.d - dot(pl.n, p);
      if (s <= 0) return 0;
      d = Math.min(d, s);
    }
    return d;
  };
  // its corners and its middle: a piece driven onto one of its own size and place has every corner on the
  // other's faces, at no depth, and only its middle tells
  const depthOf = (pose, inv, a, b) => {
    const T = mul34(inv[b.bone], pose[a.bone]);
    let deep = 0;
    for (const p of [...a.pts, a.c]) deep = Math.max(deep, depthIn(b, apply34(T, p)));
    return deep;
  };
  const meet = (pose) => {
    const C = ps.map((p) => apply34(pose[p.bone], p.c));
    return (i, j) => Math.hypot(...sub(C[i], C[j])) < ps[i].r + ps[j].r;
  };
  const standing = still
    ? poseAt(src, sequenceAt(src, still.seq ?? 0), still.frame ?? 0, 0, groups)
    : restPose(src);
  const builtDepth = new Map();
  {
    const inv = standing.map(inverse34);
    const touching = meet(standing);
    for (let i = 0; i < ps.length; i++)
      for (let j = 0; j < ps.length; j++)
        if (ps[i].bone !== ps[j].bone && touching(i, j))
          builtDepth.set(i * ps.length + j, depthOf(standing, inv, ps[i], ps[j]));
  }
  // the pairs in each other as built, each once (the deeper of its two ways), their names in order
  const builtPairs = new Map();
  for (const [key, deep] of builtDepth) {
    if (deep <= tol) continue;
    const [a, b] = [ps[Math.floor(key / ps.length)].name, ps[key % ps.length].name].sort();
    const was = builtPairs.get(JSON.stringify([a, b]));
    if (!was || deep > was.deep) builtPairs.set(JSON.stringify([a, b]), { a, b, deep: +deep.toFixed(3) });
  }
  const built = [...builtPairs.values()].sort((x, y) => y.deep - x.deep);
  const skipped = [];
  const sequencesOut = [];
  let worst = null;
  for (const which of seqs ?? sequences(src).map((_, n) => n)) {
    const { poses, used, skipped: left } = posesFor(src, { seqs: [which], step, groups });
    skipped.push(...left);
    if (!used.length) continue;
    const pairs = new Map();
    poses.forEach((pose, f) => {
      const inv = pose.map(inverse34);
      const touching = meet(pose);
      for (let i = 0; i < ps.length; i++)
        for (let j = 0; j < ps.length; j++) {
          if (ps[i].bone === ps[j].bone || !touching(i, j)) continue;
          const deep = depthOf(pose, inv, ps[i], ps[j]) - (builtDepth.get(i * ps.length + j) ?? 0);
          if (deep <= tol) continue;
          const [a, b] = [ps[i].name, ps[j].name].sort();
          const key = JSON.stringify([a, b]);
          const was = pairs.get(key);
          if (!was || deep > was.deep)
            pairs.set(key, {
              a,
              b,
              deep: +deep.toFixed(3),
              frame: f * step,
              near: nearBones(ps[i].bone, ps[j].bone),
            });
        }
    });
    const list = [...pairs.values()].sort((x, y) => y.deep - x.deep);
    sequencesOut.push({ name: used[0], frames: poses.length, pairs: list });
    if (list.length && (!worst || list[0].deep > worst.deep)) worst = { ...list[0], sequence: used[0] };
  }
  return { built, sequences: sequencesOut, worst, skipped };
}
