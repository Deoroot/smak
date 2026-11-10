// Fewer triangles for a figure of rigid pieces, its look kept: what is never seen taken out, and each piece made of
// as few triangles as keep its shape within a tolerance. A robot of plates and cages laid over a skeleton is
// mostly faces buried in other pieces, inside a cage or turned against a neighbour; GoldSrc draws them all.
//
//   sphereViews(n) -> n directions spread evenly over the sphere
//   triangleVisibility(src, pieces, { poses, views, px, groups, space }) -> { seen, could, sign }
//   cullHidden(src, pieces, { keep, seqs, at, first, poses, views, px, groups, space, together })
//     -> { pieces, before, after, gone, poses, share }
//   shapeDeviation(a, b) -> the farthest a point of either surface lies from the other
//   reduceWithin(tris, { tol, shares, creaseAngle }) -> fewer triangles, within `tol` of the shape
//   reducePieces(pieces, { tol, shares, creaseAngle }) -> { pieces, before, after, reduced }
//
// THE VISIBILITY PASS. The pieces are posed (each on its bone) in every pose given, and drawn from many directions
// at a fixed size of pixel, front faces only, with a depth test, as the game draws them. A triangle's `seen` is the
// area of the pixels it wins; one too small to win any counts one pixel, once in a measure, the first time its
// middle is not behind what its pixel shows. Its `could` is the area it would cover with nothing in front of it,
// over the views it faces. A
// triangle whose share, seen over could, is under `keep` is hidden nearly always, and goes. Every step is
// arithmetic on the triangles in the order given: the same pieces give the same answer.
//
// Plain ESM, no dependencies.
import { readMdl, restPose, poseAt, sequences, sequenceAt, apply34, inverse34 } from "../core/mdl.mjs";
import { reduce } from "./qem.mjs";

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** The points of a triangle given as corners ({ p }) or as points. */
const pointsOfTri = (t) => t.map((c) => c.p ?? c);

/** The activity of an idle (ACT_IDLE): the first pose of the visibility pass is its first frame. */
const ACT_IDLE = 1;
/** How far behind what a pixel shows a triangle's middle may lie and still count as seen there. */
const NEAR_DEPTH = 0.05;

/** n directions spread evenly over the sphere (a Fibonacci lattice), each a unit vector towards the camera. */
export function sphereViews(n) {
  const out = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - z * z);
    out.push([Math.cos(golden * i) * r, Math.sin(golden * i) * r, z]);
  }
  return out;
}

/**
 * Which way the pieces' triangles face: +1 when a triangle's (b - a) x (c - a) points out of its piece (away from
 * the piece's middle) for most of them, else -1.
 */
function windingOf(pieces) {
  let votes = 0;
  for (const piece of pieces) {
    const pts = piece.tris.flat();
    if (!pts.length) continue;
    const m = [0, 1, 2].map((a) => pts.reduce((s, q) => s + q[a], 0) / pts.length);
    for (const t of piece.tris) {
      const n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
      const c = [0, 1, 2].map((a) => (t[0][a] + t[1][a] + t[2][a]) / 3);
      votes += Math.sign(dot(n, sub(c, m)));
    }
  }
  return votes >= 0 ? 1 : -1;
}

/** Pieces as numbers of bones and triangles of points in each bone's space. */
function piecesIn(src, pieces, space, caller) {
  const names = readMdl(src).bones;
  const into = space === "rest" ? restPose(src).map(inverse34) : null;
  return pieces.map((piece) => {
    const bone = typeof piece.bone === "number" ? piece.bone : names.indexOf(piece.bone);
    if (names[bone] === undefined) throw new Error(`${caller}: no bone ${piece.bone}: it has ${names.join(", ")}`);
    const tris = piece.tris.map(pointsOfTri).map((t) => (into ? t.map((p) => apply34(into[bone], p)) : t));
    return { bone, tris };
  });
}

/** A pose as the visibility pass takes it, its matrices read: { seq: a name or number (null: at rest), frame }. */
function matricesOf(src, pose, groups) {
  if (pose.seq === null || pose.seq === undefined || pose.seq === "rest") return restPose(src);
  const n = sequenceAt(src, pose.seq);
  if (n < 0) throw new Error(`no animation ${pose.seq}`);
  const frames = sequences(src)[n].frames;
  return poseAt(src, n, Math.max(0, Math.min(frames - 1, pose.frame ?? 0)), 0, groups);
}

/**
 * How much of each triangle of rigid pieces is seen, over poses and directions (see the top of this file).
 *   pieces  [{ bone, tris }]: `bone` a name or number, `tris` [[{ p } x3]] or triangles of points, in the bone's
 *           space (or in model space at rest, `space: "rest"`)
 *   poses   [{ seq, frame, views, px, weight }]: an animation by name or number (null: the bones at rest) and its
 *           frame; each may say its own `views` and `px`, and `weight`, how much its views count (1)
 *   views   the directions for a pose that says none: a number (spread over the sphere) or unit vectors (14)
 *   px      units a pixel for a pose that says none (0.2)
 *   groups  the files of animations kept beside the model (sequenceFilesOf)
 * A triangle too small to win a pixel counts one, once, the first time its middle is seen.
 * Returns { seen, could, sign }: for each piece, each triangle's area won (`seen`) and the area it would cover
 * with nothing in front (`could`), in square units summed over every view of every pose (times its weight);
 * `sign` the winding taken as the front (+1: counter-clockwise seen from outside, as the pieces mostly are).
 */
export function triangleVisibility(src, pieces, { poses, views = 14, px = 0.2, groups, space = "bone" } = {}) {
  const ps = piecesIn(src, pieces, space, "triangleVisibility");
  const sign = windingOf(ps);
  const seen = ps.map((p) => new Float64Array(p.tris.length));
  const could = ps.map((p) => new Float64Array(p.tris.length));
  const list = [];
  ps.forEach((p, i) => p.tris.forEach((t, k) => list.push({ i, k, bone: p.bone, t })));
  const N = list.length;
  if (!N) return { seen, could, sign };
  // single floats, enough at these sizes and half the memory: posed corners, then each view's screen and depth
  const W = new Float32Array(N * 9);
  const X = new Float32Array(N * 3);
  const Y = new Float32Array(N * 3);
  const Z = new Float32Array(N * 3);
  const front = new Uint8Array(N);
  const won = new Float64Array(N);
  for (const pose of poses ?? [{ seq: null }]) {
    const M = matricesOf(src, pose, groups);
    const dirs = Array.isArray(pose.views ?? views) ? (pose.views ?? views) : sphereViews(pose.views ?? views);
    const size = pose.px ?? px;
    const area = size * size * (pose.weight ?? 1);
    list.forEach((e, j) => e.t.forEach((p, c) => W.set(apply34(M[e.bone], p), j * 9 + c * 3)));
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let j = 0; j < N * 3; j++)
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], W[j * 3 + a]);
        hi[a] = Math.max(hi[a], W[j * 3 + a]);
      }
    const mid = lo.map((v, a) => (v + hi[a]) / 2);
    const R = Math.hypot(...sub(hi, lo)) / 2 + 1;
    const S = Math.ceil((2 * R) / size);
    const depth = new Float32Array(S * S);
    const owner = new Int32Array(S * S);
    for (const d of dirs) {
      const right = unit(Math.abs(d[2]) > 0.95 ? cross([1, 0, 0], d) : cross([0, 0, 1], d));
      const up = cross(d, right);
      depth.fill(-Infinity);
      owner.fill(-1);
      front.fill(0);
      won.fill(0);
      for (let j = 0; j < N * 3; j++) {
        const q = [W[j * 3] - mid[0], W[j * 3 + 1] - mid[1], W[j * 3 + 2] - mid[2]];
        X[j] = dot(q, right) / size + S / 2;
        Y[j] = dot(q, up) / size + S / 2;
        Z[j] = dot(q, d);
      }
      for (let j = 0; j < N; j++) {
        const a = j * 3;
        const b = a + 1;
        const c = a + 2;
        // the triangle's facing against the view, by its winding on the screen
        const twice = (X[b] - X[a]) * (Y[c] - Y[a]) - (X[c] - X[a]) * (Y[b] - Y[a]);
        if (twice * sign <= 0) continue;
        front[j] = 1;
        could[list[j].i][list[j].k] += (Math.abs(twice) / 2) * area;
        const x0 = Math.max(0, Math.floor(Math.min(X[a], X[b], X[c])));
        const x1 = Math.min(S - 1, Math.ceil(Math.max(X[a], X[b], X[c])));
        const y0 = Math.max(0, Math.floor(Math.min(Y[a], Y[b], Y[c])));
        const y1 = Math.min(S - 1, Math.ceil(Math.max(Y[a], Y[b], Y[c])));
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++) {
            const sx = x + 0.5;
            const sy = y + 0.5;
            const w0 = ((X[b] - sx) * (Y[c] - sy) - (X[c] - sx) * (Y[b] - sy)) / twice;
            const w1 = ((X[c] - sx) * (Y[a] - sy) - (X[a] - sx) * (Y[c] - sy)) / twice;
            const w2 = 1 - w0 - w1;
            if (w0 < 0 || w1 < 0 || w2 < 0) continue;
            const z = w0 * Z[a] + w1 * Z[b] + w2 * Z[c];
            const o = y * S + x;
            if (z > depth[o]) {
              depth[o] = z;
              owner[o] = j;
            }
          }
      }
      for (let o = 0; o < S * S; o++) if (owner[o] >= 0) won[owner[o]]++;
      // a triangle that has won no pixel yet, smaller than one: seen, once, when its middle is not behind what its
      // pixel shows
      for (let j = 0; j < N; j++) {
        if (!front[j] || won[j] || seen[list[j].i][list[j].k]) continue;
        const a = j * 3;
        const x = Math.floor((X[a] + X[a + 1] + X[a + 2]) / 3);
        const y = Math.floor((Y[a] + Y[a + 1] + Y[a + 2]) / 3);
        if (x < 0 || y < 0 || x >= S || y >= S) continue;
        if ((Z[a] + Z[a + 1] + Z[a + 2]) / 3 >= depth[y * S + x] - NEAR_DEPTH) won[j] = 1;
      }
      for (let j = 0; j < N; j++) if (won[j]) seen[list[j].i][list[j].k] += won[j] * area;
    }
  }
  return { seen, could, sign };
}

/**
 * The poses the hidden is looked for in: the first frame of `first` (the first idle unless told, else the first
 * animation, else the bones at rest) seen from `firstViews` directions at `firstPx`, then each animation of `seqs`
 * (every one the model can read unless told) at each share `at` of its frames, from `views` at `px`.
 */
function posesToCull(src, { seqs, at, first, firstViews, firstPx, views, px, weight, groups }) {
  const all = sequences(src);
  const readable = (n) => n >= 0 && (!all[n].group || Boolean(groups?.[all[n].group]));
  let start = first === undefined ? all.findIndex((s, n) => s.activity === ACT_IDLE && readable(n)) : sequenceAt(src, first);
  if (first === undefined && start < 0) start = all.findIndex((_, n) => readable(n));
  const out = [{ seq: start >= 0 ? start : null, frame: 0, views: firstViews, px: firstPx }];
  for (const which of seqs ?? all.map((_, n) => n)) {
    const n = sequenceAt(src, which);
    if (!readable(n)) continue;
    for (const share of at) out.push({ seq: n, frame: Math.floor(all[n].frames * share), views, px, weight });
  }
  return out;
}

/**
 * The pieces with the triangles never seen taken out (see the top of this file), and those left with none
 * dropped whole.
 *   pieces     [{ bone, tris, name?, share? }] as triangleVisibility takes them; every other key is kept
 *   keep       the share of what a triangle could show that it must show to stay (0.04: hidden nearly always)
 *   seqs       the animations whose poses count (every one the model can read), each at the shares `at` of its
 *              frames ([0.3, 0.7]), seen from `views` directions (14) at `px` units a pixel (0.2), each such
 *              pose's views counting `weight` (1)
 *   first      the pose seen closest: the first frame of this animation (the first idle unless told), from
 *              `firstViews` directions (80) at `firstPx` (0.15)
 *   poses      instead of all that: the poses, as triangleVisibility takes them, measured together (the close
 *              pose and the others are measured apart otherwise, and their areas summed)
 *   together   (piece) -> a key: the pieces of one key with as many triangles (a left plate and its right, laid
 *              on one set of texels) keep a triangle that any of them shows; by their `share` unless told
 *   groups, space   as triangleVisibility
 * Returns { pieces, before, after (triangles), gone (the names, or numbers, of the pieces dropped whole), poses
 * (how many), share (for each piece given, each triangle's share seen) }.
 * The cost is the poses times their views times the triangles: a figure of 6,000 triangles over 100 poses, half
 * a minute; fewer `seqs` or `at`, or fewer `views`, for less.
 */
export function cullHidden(
  src,
  pieces,
  {
    keep = 0.04,
    seqs,
    at = [0.3, 0.7],
    first,
    firstViews = 80,
    firstPx = 0.15,
    views = 14,
    px = 0.2,
    weight = 1,
    poses,
    together = (piece) => piece.share,
    groups,
    space = "bone",
  } = {},
) {
  // the close pose and the others measured apart (a small triangle's one pixel counted in each), their areas summed
  const posed = poses ?? posesToCull(src, { seqs, at, first, firstViews, firstPx, views, px, weight, groups });
  const passes = poses ? [posed] : [posed.slice(0, 1), posed.slice(1)];
  const seen = pieces.map((p) => new Float64Array(p.tris.length));
  const could = pieces.map((p) => new Float64Array(p.tris.length));
  for (const pass of passes) {
    if (!pass.length) continue;
    const v = triangleVisibility(src, pieces, { poses: pass, views, px, groups, space });
    pieces.forEach((p, i) =>
      p.tris.forEach((_, k) => {
        seen[i][k] += v.seen[i][k];
        could[i][k] += v.could[i][k];
      }),
    );
  }
  const share = pieces.map((p, i) => Array.from(p.tris, (_, k) => seen[i][k] / Math.max(1e-12, could[i][k])));
  const shown = share.map((list) => list.map((v) => v >= keep));
  // the pieces of one key and one count keep a triangle that any of them shows
  const byKey = new Map();
  pieces.forEach((p, i) => {
    const key = together(p, i);
    if (key === undefined || key === null) return;
    const full = `${key}|${p.tris.length}`;
    byKey.set(full, [...(byKey.get(full) ?? []), i]);
  });
  for (const members of byKey.values()) {
    const any = pieces[members[0]].tris.map((_, k) => members.some((i) => shown[i][k]));
    for (const i of members) shown[i] = [...any];
  }
  const gone = [];
  const kept = [];
  pieces.forEach((p, i) => {
    const tris = p.tris.filter((_, k) => shown[i][k]);
    if (tris.length) kept.push({ ...p, tris });
    else gone.push(p.name ?? i);
  });
  const count = (list) => list.reduce((n, p) => n + p.tris.length, 0);
  return { pieces: kept, before: count(pieces), after: count(kept), gone, poses: posed.length, share };
}

// ---- fewer triangles a piece, its shape kept within a tolerance ----

/** The distance from a point to a triangle. */
function pointToTriangle(p, a, b, c) {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return Math.hypot(...ap);
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return Math.hypot(...bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return Math.hypot(...sub(p, [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]));
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return Math.hypot(...cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return Math.hypot(...sub(p, [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]));
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return Math.hypot(...sub(p, [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]));
  }
  const n = cross(ab, ac);
  return Math.abs(dot(n, ap)) / (Math.hypot(...n) || 1);
}

/**
 * How far apart two surfaces lie at most: each one's corners and the middles of its triangles measured to the
 * nearest triangle of the other, both ways. `a`, `b`: triangles of points or of corners ({ p }).
 */
export function shapeDeviation(a, b) {
  const A = a.map(pointsOfTri);
  const B = b.map(pointsOfTri);
  const probes = (tris) => tris.flatMap((t) => [...t, [0, 1, 2].map((k) => (t[0][k] + t[1][k] + t[2][k]) / 3)]);
  const farthest = (pts, tris) =>
    pts.reduce((most, p) => Math.max(most, tris.reduce((m, t) => Math.min(m, pointToTriangle(p, t[0], t[1], t[2])), Infinity)), 0); // prettier-ignore
  return Math.max(farthest(probes(A), B), farthest(probes(B), A));
}

/**
 * A piece's triangles as few as `reduce` makes them while no point of either shape lies farther than `tol` from
 * the other (shapeDeviation): each share of the triangles in `shares` is tried, the fewest first, and the first
 * within `tol` is taken. The corners come back as { p } (a reduced piece is laid out again); the triangles as
 * given when no share keeps the shape. `creaseAngle` (60) holds edges sharper than that where they are.
 */
export function reduceWithin(
  tris,
  { tol = 0.12, shares = [0.35, 0.45, 0.55, 0.65, 0.75, 0.85], creaseAngle = 60 } = {},
) {
  const plain = tris.map((t) => pointsOfTri(t).map((p) => ({ p })));
  for (const share of shares) {
    const target = Math.floor(tris.length * share);
    if (target < 4 || target >= tris.length) continue;
    let made;
    try {
      made = reduce(plain, { target, creaseAngle }).tris;
    } catch {
      continue;
    }
    if (made.length >= tris.length) continue;
    if (shapeDeviation(plain, made) <= tol) return made.map((t) => t.map((c) => ({ p: c.p })));
  }
  return tris;
}

/**
 * Every piece through reduceWithin. Returns { pieces (each with every key it had, its `tris` reduced), before,
 * after (triangles), reduced (the numbers of the pieces made lighter) }.
 */
export function reducePieces(pieces, options = {}) {
  const reduced = [];
  const out = pieces.map((piece, i) => {
    const tris = reduceWithin(piece.tris, options);
    if (tris !== piece.tris) reduced.push(i);
    return { ...piece, tris };
  });
  const count = (list) => list.reduce((n, p) => n + p.tris.length, 0);
  return { pieces: out, before: count(pieces), after: count(out), reduced };
}
