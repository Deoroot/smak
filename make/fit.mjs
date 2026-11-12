// Laying a new piece over the one it replaces: where the original sits in its model file,
// its own axes, and the placing that makes the new one follow it. Used by build.mjs
// (swapMesh) and by anything that has to measure a model before making a piece for it.
import { readMdl, readMesh, restPose, mul34, apply34, inverse34 } from "../core/mdl.mjs";
import { sub, dot, cross, box, out, into, uniq, mainAxes } from "../core/vec.mjs";

// The hands' own meshes, which a view model's submodel may hold next to the weapon.
// the meshes of a first-person model that are its hands and sleeves, by their texture's name: Half-Life's
// are GLOVED_sleeve, rubbergloveCHROME, GLOVED_knuckle, GLOVE_handpak and HAND_ForeArm1 (not "hand" alone:
// the .357's grip is Pythonhandle)
export const HANDS = /hands|arms|forearm|body|glove|sleeve|knuckle|handpak/i;

/**
 * One submodel's weapon, measured: the meshes `pick` chooses, the bone that carries most
 * of them, and their triangles in that bone's space. `body` is the number the item's
 * script gives; `what` names the file in the error. `part`: the bodypart whose submodel is meant (the
 * first unless told).
 */
export function measure(src, body, pick, what = "", part = 0) {
  const info = readMdl(src);
  const bodypart = info.bodyparts[part];
  if (!bodypart) throw new Error(`${what}: no bodypart ${part}`);
  const j = Math.floor(body / bodypart.base) % bodypart.models.length;
  const model = bodypart.models[j];
  const meshes = model.meshes.map((mesh, k) => ({ mesh, k })).filter(({ mesh }) => pick(mesh));
  if (!meshes.length) throw new Error(`${what} ${model.name}: no mesh of the weapon`);
  // everything into the space of the bone that carries most of it
  const rest = restPose(src);
  const tris = meshes.flatMap(({ mesh }) =>
    readMesh(src, model, mesh).map((tri) => tri.map((corner) => ({ ...corner, mesh }))),
  );
  const cornersOn = new Map();
  for (const corner of tris.flat()) cornersOn.set(corner.bone, (cornersOn.get(corner.bone) ?? 0) + 1);
  const bone = [...cornersOn].sort((a, b) => b[1] - a[1])[0][0];
  const toMain = (from) => mul34(inverse34(rest[bone]), rest[from]);
  const original = tris.map((tri) =>
    tri.map((corner) =>
      corner.bone === bone
        ? corner
        : {
            ...corner,
            p: apply34(toMain(corner.bone), corner.p),
            n: toMain(corner.bone).map((row) => dot(row, corner.n)),
          },
    ),
  );
  return { info, j, model, meshes, rest, bone, original };
}

// ── frames: a piece's own axes ─────────────────────────────────────────────
/** A triangle smaller than this is left out of the samples: it has no area to weigh by. */
const NO_AREA = 1e-9;
/**
 * Weighted points [x, y, z, weight] for mainAxes: each triangle's three corners and its middle, sharing its
 * area between them.
 */
const samplesOf = (tris) =>
  tris.flatMap((tri) => {
    const [a, b, c] = tri.map((corner) => corner.p);
    const area = Math.hypot(...cross(sub(b, a), sub(c, a))) / 2;
    if (area < NO_AREA) return [];
    const middle = [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3);
    return [a, b, c, middle].map((p) => [...p, area / 4]);
  });
/** The middle of a box along one axis. */
const mid = (b, axis) => (b.mn[axis] + b.mx[axis]) / 2;
/**
 * Principal axes weighed by area (the same shape with another mesh has to give the same axes), centred on
 * its box.
 */
export function frameOf(tris) {
  const { X, Y, o } = mainAxes(samplesOf(tris));
  const frame = { X, Y, Z: cross(X, Y), o };
  const b = box(uniq(tris).map((p) => into(frame, p)));
  return {
    ...frame,
    o: out(
      frame,
      [0, 1, 2].map((a) => mid(b, a)),
    ),
  };
}

// ── laying the new piece over the original ─────────────────────────────────
/**
 * Same length, starting at the same end, centred across the width and the thickness. Both in the original's
 * axes.
 */
function overlay(points, onto) {
  const theirs = box(onto);
  const ours = box(points);
  const k = (theirs.mx[0] - theirs.mn[0]) / (ours.mx[0] - ours.mn[0]);
  const move = [
    theirs.mn[0] - ours.mn[0] * k,
    (theirs.mx[1] + theirs.mn[1]) / 2 - ((ours.mx[1] + ours.mn[1]) / 2) * k,
    (theirs.mx[2] + theirs.mn[2]) / 2 - ((ours.mx[2] + ours.mn[2]) / 2) * k,
  ];
  return { k, at: (p) => [0, 1, 2].map((a) => p[a] * k + move[a]) };
}
/** How many stretches an outline is measured in, and how finely each triangle is sampled (steps a side). */
const OUTLINE_STRETCHES = 24;
const SAMPLE_STEPS = 4;
/**
 * A piece's outline along x: in each of n stretches, how far it reaches in y and in z, as [least y, greatest
 * y, least z, greatest z]. A stretch no point falls in is left at infinities.
 */
function profile(tris, x0, x1, n = OUTLINE_STRETCHES) {
  const reach = Array.from({ length: n }, () => [Infinity, -Infinity, Infinity, -Infinity]);
  // points spread evenly over the triangle, its corners and edges among them
  for (const tri of tris)
    for (let s = 0; s <= SAMPLE_STEPS; s++)
      for (let r = 0; r <= SAMPLE_STEPS - s; r++) {
        const weights = [s / SAMPLE_STEPS, r / SAMPLE_STEPS, 1 - (s + r) / SAMPLE_STEPS];
        const p = [0, 1, 2].map(
          (k) => tri[0][k] * weights[0] + tri[1][k] * weights[1] + tri[2][k] * weights[2],
        );
        const stretch = reach[Math.min(n - 1, Math.max(0, Math.floor(((p[0] - x0) / (x1 - x0)) * n)))];
        stretch[0] = Math.min(stretch[0], p[1]);
        stretch[1] = Math.max(stretch[1], p[1]);
        stretch[2] = Math.min(stretch[2], p[2]);
        stretch[3] = Math.max(stretch[3], p[2]);
      }
  return reach;
}
/**
 * What is left between two outlines (see profile), in units: the mean difference of their four reaches over
 * the stretches both have points in. Infinity when they share none.
 */
function outlineGap(theirs, ours) {
  let sum = 0;
  let shared = 0;
  theirs.forEach((their, i) => {
    const our = ours[i];
    if (!isFinite(their[0]) || !isFinite(our[0])) return;
    shared++;
    for (let j = 0; j < 4; j++) sum += Math.abs(their[j] - our[j]) / 4;
  });
  return shared ? sum / shared : Infinity;
}
/** Two turns whose outlines are within this share of each other follow the original about as well. */
const UPRIGHT_TIE = 0.05;
/**
 * The four ways of turning a piece round that keep it along its own axes: as it is, or half a turn about one.
 */
const TURNS = [
  { about: null, turn: (p) => p },
  { about: "x", turn: (p) => [p[0], -p[1], -p[2]] },
  { about: "y", turn: (p) => [-p[0], p[1], -p[2]] },
  { about: "z", turn: (p) => [-p[0], -p[1], p[2]] },
];
/**
 * The new piece on the original, both in their own axes: of the four ways of turning it
 * round, the one whose outline follows the original's best. Returns the placing and what
 * is left over between the two outlines, in units.
 */
export function bestTurn(piece, original, haft = false, only = null) {
  if (haft) {
    const fit = onHaft(piece, original);
    if (fit) return fit;
  }
  // what stands off a piece without being part of it (flames: `loose`) is not measured
  const solid = piece.some((tri) => tri.loose) ? piece.filter((tri) => !tri.loose) : piece;
  // "as drawn": the axes it was built along (+x its length), not its principal axes, which a hooked stock or a
  // deep grip tilts; any other turn starts from the principal axes as before
  const drawn = () => {
    const b = box(uniq(solid));
    return { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1], o: [0, 1, 2].map((a) => mid(b, a)) };
  };
  const theirs = original.map((tri) => tri.map((corner) => corner.p));
  const theirBox = box(theirs.flat());
  const theirOutline = profile(theirs, theirBox.mn[0], theirBox.mx[0]);
  /** Of the turns `keep` lets through, in the axes `own`, the one whose outline follows the original's best. */
  const bestIn = (own, keep) => {
    const mine = solid.map((tri) => tri.map((corner) => into(own, corner.p)));
    let best = null;
    for (const { about, turn } of TURNS.filter(keep)) {
      const name = about ? `turned about ${about}` : "as drawn";
      const turned = mine.map((tri) => tri.map(turn));
      const laid = overlay(turned.flat(), theirs.flat());
      const outline = profile(
        turned.map((tri) => tri.map(laid.at)),
        theirBox.mn[0],
        theirBox.mx[0],
      );
      const left = outlineGap(theirOutline, outline);
      if (!best || left < best.left) best = { left, name, k: laid.k, at: (p) => laid.at(turn(into(own, p))) };
    }
    return best;
  };
  // "upright": a piece that knows its up and its front (a gun). The outline decides, as for any piece; where two
  // turns follow it about as well (within UPRIGHT_TIE), the one that leaves its front and its top where laying it
  // as drawn puts them. By its outline alone a shotgun was laid end for end in another player's hands, the two
  // turns 0.99 off each; laid as drawn always, a submachine gun lay upside down there (1.9 off where the free fit
  // had it right at 1.0), and a pistol's grip, which tilts the original's axes, 1.6 off for 0.7 (2026-10-17)
  if (only === "upright") {
    const asDrawn = bestIn(drawn(), (t) => !t.about);
    const way = (fit, v) => sub(fit.at(v), fit.at([0, 0, 0]));
    const keeps = (fit) => [[1, 0, 0], [0, 0, 1]].every((v) => dot(way(fit, v), way(asDrawn, v)) > 0);
    const all = [asDrawn, ...TURNS.map((t) => bestIn(frameOf(solid), (u) => u === t))];
    const least = Math.min(...all.map((fit) => fit.left));
    const near = all.filter((fit) => fit.left <= least * (1 + UPRIGHT_TIE));
    return (near.filter(keeps).length ? near.filter(keeps) : near).reduce((a, b) => (b.left < a.left ? b : a));
  }
  // `only`: the one turn to take ("as drawn", "x", "y", "z"), when the outline cannot tell (a box)
  return bestIn(only === "as drawn" ? drawn() : frameOf(solid), (t) => !only || (t.about ?? "as drawn") === only);
}
/**
 * Triangles in the groups that touch one another: two are in one group when they share a point (to two
 * decimals), or are joined by others that do. `pointOf` gives a corner's point.
 */
function touching(tris, pointOf = (corner) => corner) {
  const key = (corner) =>
    pointOf(corner)
      .map((v) => v.toFixed(2))
      .join();
  // each point leads to another of its group, and so on to the one that stands for the group
  const leader = new Map();
  const root = (k) => {
    while (leader.get(k) !== k) k = leader.get(k);
    return k;
  };
  for (const tri of tris) for (const corner of tri) leader.set(key(corner), key(corner));
  for (const tri of tris) for (const j of [1, 2]) leader.set(root(key(tri[j])), root(key(tri[0])));
  const groups = new Map();
  for (const tri of tris) {
    const k = root(key(tri[0]));
    (groups.get(k) ?? groups.set(k, []).get(k)).push(tri);
  }
  return [...groups.values()];
}
/** The pieces of a mesh that do not touch one another. */
const pieces = (tris) => touching(tris);

/**
 * What makes a piece a handle: at least this share of the weapon's length, and this many times longer than
 * thick.
 */
const HAFT_LEAST_SHARE = 0.3;
const HAFT_LEAST_SLENDER = 4;
/** A flat piece is taken to be this thick at the least, so that its length can be divided by it. */
const LEAST_THICK = 1e-6;
/**
 * The line of the handle of a hafted weapon (an axe, a scythe), in the weapon's own axes:
 * the main axis of the longest, thinnest piece of its meshes (`groups`: its triangles, mesh by mesh). A head
 * on one side pulls the weapon's main axes off the handle, and the hand holds the handle. Null when no piece
 * of it looks like a handle.
 */
function haftLine(groups, length) {
  let best = null;
  for (const piece of groups.flatMap(pieces)) {
    const { X, Y, o } = mainAxes(samplesOf(piece.map((tri) => tri.map((p) => ({ p })))));
    const frame = { X, Y, Z: cross(X, Y), o };
    const b = box(piece.flat().map((p) => into(frame, p)));
    const long = b.mx[0] - b.mn[0];
    const thick = Math.max(b.mx[1] - b.mn[1], b.mx[2] - b.mn[2], LEAST_THICK);
    if (long < HAFT_LEAST_SHARE * length || long / thick < HAFT_LEAST_SLENDER) continue;
    if (!best || long / thick > best.score)
      best = {
        score: long / thick,
        X: X[0] < 0 ? X.map((v) => -v) : X,
        o: out(frame, [0, mid(b, 1), mid(b, 2)]),
      };
  }
  return best;
}
/**
 * A piece drawn with its handle on its own x axis, laid on the original's handle: same
 * length along it, and of the four ways of turning it round the one whose outline follows best.
 */
function onHaft(piece, original) {
  const theirs = original.map((tri) => tri.map((corner) => corner.p));
  const theirBox = box(theirs.flat());
  const byMesh = new Map();
  for (const tri of original) {
    const mesh = tri[0].mesh;
    (byMesh.get(mesh) ?? byMesh.set(mesh, []).get(mesh)).push(tri.map((corner) => corner.p));
  }
  const line = haftLine([...byMesh.values()], theirBox.mx[0] - theirBox.mn[0]);
  if (!line) return null;
  const toLength1 = (v) => {
    const length = Math.hypot(...v);
    return v.map((t) => t / length);
  };
  // axes with X along the handle and Z as near the original's own z as that allows: what is left of that z
  // with its part along the handle taken out. A handle that lies along z itself leaves nothing of it, and Z
  // is then as near the original's x
  const X = toLength1(line.X);
  const acrossFrom = (axis) =>
    sub(
      axis,
      X.map((t) => t * dot(axis, X)),
    );
  const fromZ = acrossFrom([0, 0, 1]);
  const Z = toLength1(Math.hypot(...fromZ) ? fromZ : acrossFrom([1, 0, 0]));
  const Y = cross(Z, X);
  const origin = line.o;
  // how far along the handle's line the original reaches, each way
  const along = theirs.flat().map((p) => dot(sub(p, origin), X));
  const start = Math.min(...along);
  const end = Math.max(...along);
  const theirOutline = profile(theirs, theirBox.mn[0], theirBox.mx[0]);
  let best = null;
  for (const { about, turn } of TURNS) {
    const name = about ? `on its handle, turned about ${about}` : "on its handle";
    const xs = piece.flatMap((tri) => tri.map((corner) => turn(corner.p)[0]));
    const lowest = Math.min(...xs);
    const k = (end - start) / (Math.max(...xs) - lowest);
    const at = (p) => {
      const turned = turn(p);
      const s = start + (turned[0] - lowest) * k;
      return [0, 1, 2].map((i) => origin[i] + X[i] * s + Y[i] * turned[1] * k + Z[i] * turned[2] * k);
    };
    const outline = profile(
      piece.map((tri) => tri.map((corner) => at(corner.p))),
      theirBox.mn[0],
      theirBox.mx[0],
    );
    const left = outlineGap(theirOutline, outline);
    if (!best || left < best.left) best = { left, name, k, at };
  }
  return best;
}
export const straight = (piece, original) =>
  overlay(
    uniq(piece),
    original.flat().map((corner) => corner.p),
  );

// ── shields ────────────────────────────────────────────────────────────────
/**
 * A shield's point is looked for in the last part of its length: past this share of the way to its far end.
 */
const SHIELD_END_SHARE = 0.8;
/**
 * A shield, measured for a new one to be made to it: its body and the straps on its back,
 * told apart as the pieces of the mesh that do not touch (the body is the largest).
 * Returns its frame (+x along its length towards the point, +z out of its face, the origin
 * in the middle of the body and on the plane of its back) and, in that frame, what a new
 * shield has to keep for the arm of this model to carry it the same: the body's length,
 * width and depth, and each strap's place `{ x0, x1, y, width, reach }` (`reach`: how far
 * it stands off the back).
 */
export function shieldFit(original) {
  const [body, ...straps] = touching(original, (corner) => corner.p).sort((a, b) => b.length - a.length);
  if (!straps.length) throw new Error("a shield without straps");
  let { X, Y, o } = frameOf(body);
  let Z = cross(X, Y);
  const centre = (tris) => {
    const b = box(uniq(tris));
    return [0, 1, 2].map((a) => (b.mn[a] + b.mx[a]) / 2);
  };
  // the straps are on the back
  if (dot(sub(centre(straps.flat()), o), Z) > 0) Z = Z.map((v) => -v);
  // the point is the end where the body is narrow
  const inPlane = uniq(body).map((p) => [dot(sub(p, o), X), dot(sub(p, o), Y)]);
  const farthest = Math.max(...inPlane.map(([x]) => Math.abs(x)));
  const widthAtEnd = (side) => {
    const ys = inPlane.filter(([x]) => x * side > farthest * SHIELD_END_SHARE).map(([, y]) => y);
    return Math.max(...ys) - Math.min(...ys);
  };
  if (widthAtEnd(-1) < widthAtEnd(1)) X = X.map((v) => -v);
  Y = cross(Z, X);
  // the origin: the middle of the body, on the plane of its back
  let frame = { X, Y, Z, o };
  const bodyBox = box(uniq(body).map((p) => into(frame, p)));
  frame = { ...frame, o: out(frame, [mid(bodyBox, 0), mid(bodyBox, 1), bodyBox.mn[2]]) };
  const p = {
    length: bodyBox.mx[0] - bodyBox.mn[0],
    width: bodyBox.mx[1] - bodyBox.mn[1],
    depth: bodyBox.mx[2] - bodyBox.mn[2],
    straps: straps
      .map((strap) => {
        const b = box(uniq(strap).map((q) => into(frame, q)));
        return {
          x0: b.mn[0],
          x1: b.mx[0],
          y: mid(b, 1),
          width: b.mx[1] - b.mn[1],
          reach: -b.mn[2],
        };
      })
      .sort((a, b) => a.y - b.y),
  };
  return { frame, p };
}
