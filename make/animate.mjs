// Animations written as poses, not as numbers.
//
// A sequence in the file is, for every frame and every bone, six numbers: where the bone is from its parent
// and how it is turned about x, y and z (mdl.mjs). Arithmetic on those is enough to nudge an animation that
// exists; it is no way to make a walk. A bone's own axes are whatever its modeller left them (a Biped bone's
// x runs down its length), three angles turned one after another do not add, and a foot is where a thigh, a
// knee and a pelvis together put it. This file is the layer between: a pose is said in the MODEL's axes
// (+x forward, +y left, +z up), keys are joined by the shortest turn between them, a leg is told where its
// foot is to be and bends its own knee, and what was made is measured: the seam of a loop, how fast the
// ground must pass under planted feet, and how much they slide.
//
//   const rig = rigOf(bones);                                        // of a model, or of one not written yet
//   const up = poseOf(rig, { "arm.L": { turn: { y: -80 } } });       // the left arm swung forward and up
//   const frames = animate(rig, { frames: 31, loops: true, keys: [{ at: 0, pose: rest }, { at: 15, pose: up }] });
//   addSequence(mdl, { name: "wave", fps: 15, loops: true, frames });
//
// HOW A TURN IS SAID. `turn: { x, y, z }`, in degrees, about the model's axes by the right hand's rule, as
// the bone stood at rest and carried along by its parent: a knee's `y: 40` bends it the same way whatever
// the thigh above it is doing. For a limb that hangs down:
//   y over 0   swings it BACK, under 0 forward (and tips a head or a spine forward when over 0)
//   x over 0   swings it out to the model's LEFT (+y), under 0 to its right
//   z over 0   turns it to the left about the upright, as a head saying no
// Given as an object the three are applied x, then y, then z (the engine's own order); given as a list,
// `[["y", -30], ["x", 10]]`, in the order written.
import { bones as bonesOf, boneMatrices, apply34, sequences as sequencesOf, readSequence, replaceSequence } from "../core/mdl.mjs";
import { posed } from "./render.mjs";

// ── quaternions [w, x, y, z]: a turn that can be joined to another and halved without surprises ──
// Exported for scripts that turn things themselves: qmul(a, b) (b, then a), qconj, qunit, qturn(q, v) (a
// vector turned), qabout(axis, RADIANS), qofAngles([rx, ry, rz]) and anglesOf(q) (the engine's three angles),
// qslerp(a, b, t), qarc(from, to) (the shortest turn between two directions), qframes(d, e, D, E) (the turn
// of one pair of directions onto another), degreesOf(q), and turnOf(turn) (a `turn` as poseOf takes it).
export const qmul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
export const qconj = (q) => [q[0], -q[1], -q[2], -q[3]];
export const qunit = (q) => {
  const length = Math.hypot(...q) || 1;
  return q.map((value) => value / length);
};
/** A vector turned by a quaternion. */
export const qturn = (q, v) => qmul(qmul(q, [0, ...v]), qconj(q)).slice(1);
const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const RADIANS = Math.PI / 180;
export const qabout = (axis, radians) => {
  const half = radians / 2;
  const s = Math.sin(half);
  return [Math.cos(half), axis[0] * s, axis[1] * s, axis[2] * s];
};
/** The engine's three angles as one turn: about x, then y, then z (AngleQuaternion of the SDK's mathlib.c). */
export const qofAngles = ([rx, ry, rz]) => qmul(qabout(AXES.z, rz), qmul(qabout(AXES.y, ry), qabout(AXES.x, rx)));
/** A turn as the engine's three angles, each from -pi to pi. */
export function anglesOf(q) {
  const [w, x, y, z] = q;
  // the third row and first column of the turn's matrix: -sin(ry), sin(rx)cos(ry), cos(rx)cos(ry)
  const sinY = Math.max(-1, Math.min(1, 2 * (w * y - x * z)));
  return [
    Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)),
    Math.asin(sinY),
    Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)),
  ];
}
/** The turn a part of the way from one to another, by the shorter way round. */
export function qslerp(a, b, t) {
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const to = cos < 0 ? b.map((value) => -value) : b;
  cos = Math.abs(cos);
  if (cos > 0.9995) return qunit(a.map((value, i) => value + (to[i] - value) * t));
  const angle = Math.acos(cos);
  const from = Math.sin((1 - t) * angle) / Math.sin(angle);
  const toward = Math.sin(t * angle) / Math.sin(angle);
  return a.map((value, i) => value * from + to[i] * toward);
}
/** The shortest turn that takes one direction to another. */
export function qarc(from, to) {
  const a = unit(from);
  const b = unit(to);
  const cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (cos < -0.999999) {
    // opposite: half a turn about anything square to them
    const other = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    return qabout(unit(cross(a, other)), Math.PI);
  }
  return qunit([1 + cos, ...cross(a, b)]);
}
/** The angle of a turn, in degrees, from 0 to 180. */
export const degreesOf = (q) => (2 * Math.atan2(Math.hypot(q[1], q[2], q[3]), Math.abs(q[0]))) / RADIANS;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, by) => [a[0] * by, a[1] * by, a[2] * by];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lengthOf = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => scale(a, 1 / (lengthOf(a) || 1));

// ── the rig ─────────────────────────────────────────────────────────────────
/**
 * A skeleton made ready to be posed. `bones`: a model's bytes, or a list `[{ name, parent, pos, rot }]` as
 * `writeMdl` takes it (a parent before its children). It returns
 *   { bones, names, index(name), rest }   `rest` is the pose in which every bone is as the skeleton has it
 * A bone is named by its name or its number wherever one is asked for; a name the rig has not is refused
 * with the names it has.
 */
export function rigOf(bones) {
  const list = (Buffer.isBuffer(bones) ? bonesOf(bones) : bones).map((bone) => ({
    name: bone.name,
    parent: bone.parent,
    pos: [...(bone.pos ?? [0, 0, 0])],
    rot: [...(bone.rot ?? [0, 0, 0])],
  }));
  if (!list.length) throw new Error("rigOf: a skeleton has one bone at the least");
  list.forEach((bone, i) => {
    if (!(bone.parent < i))
      throw new Error(`rigOf: bone ${i} (${bone.name}) comes before its parent: a parent is listed first`);
  });
  const local = list.map((bone) => qofAngles(bone.rot));
  // each bone's turn in the model at rest, and its parent's (a root's parent is the model itself)
  const world = [];
  list.forEach((bone, i) => world.push(bone.parent < 0 ? local[i] : qmul(world[bone.parent], local[i])));
  const names = list.map((bone) => bone.name);
  const index = (which) => {
    const at = typeof which === "number" ? which : names.indexOf(which);
    if (!(at >= 0 && at < list.length))
      throw new Error(`no bone ${which}: the skeleton has ${names.join(", ")}`);
    return at;
  };
  const rig = { bones: list, names, index, local, world };
  rig.rest = { q: local.map((q) => [...q]), p: list.map((bone) => [...bone.pos]) };
  return rig;
}
/** The turn of a bone's parent in the model at rest: nothing for a root. */
const parentWorld = (rig, i) => (rig.bones[i].parent < 0 ? [1, 0, 0, 0] : rig.world[rig.bones[i].parent]);

/** A `turn` as one quaternion in the model's axes. */
export function turnOf(turn, bone = "turnOf") {
  const steps = Array.isArray(turn)
    ? turn
    : ["x", "y", "z"].filter((axis) => turn[axis] !== undefined).map((axis) => [axis, turn[axis]]);
  if (!Array.isArray(turn))
    for (const key of Object.keys(turn))
      if (!(key in AXES)) throw new Error(`${bone}: a turn is about x, y or z, not ${key}`);
  let q = [1, 0, 0, 0];
  for (const step of steps) {
    const [axis, degrees] = step;
    const about = typeof axis === "string" ? AXES[axis] : Array.isArray(axis) ? unit(axis) : null;
    if (!about || !Number.isFinite(degrees))
      throw new Error(
        `${bone}: a turn is { x, y, z } in degrees, or a list of [axis, degrees] with the axis "x", "y", "z" or a direction, not ${JSON.stringify(step)}`,
      );
    q = qmul(qabout(about, degrees * RADIANS), q);
  }
  return q;
}

/**
 * A pose: the rest pose, or `base`, with some bones changed. `changes` is `{ bone: { turn, move } }`:
 *   turn   how the bone is turned from where `base` has it, in the model's axes (see the top of this file)
 *   move   [x, y, z]: how far it is shifted from where `base` has it, in the model's axes at rest. For a
 *          root this is the body's own movement: `{ pelvis: { move: [0, 0, -2] } }` sinks it by 2
 * A pose is plain data (`{ q, p }`, a turn and a place for each bone) and is never changed by a call: every
 * function here gives a new one.
 */
export function poseOf(rig, changes = {}, base = rig.rest) {
  const pose = { q: base.q.map((q) => [...q]), p: base.p.map((p) => [...p]) };
  for (const [name, change] of Object.entries(changes)) {
    const i = rig.index(name);
    for (const key of Object.keys(change))
      if (key !== "turn" && key !== "move")
        throw new Error(`${name}: a bone is changed by turn or move, not ${key}`);
    if (change.turn !== undefined) {
      // the turn is in the model's axes; in the bone's own it is the same turn seen from the bone at rest
      const inBone = qmul(qconj(rig.world[i]), qmul(turnOf(change.turn, name), rig.world[i]));
      pose.q[i] = qunit(qmul(pose.q[i], inBone));
    }
    if (change.move !== undefined) {
      if (!(Array.isArray(change.move) && change.move.length === 3 && change.move.every(Number.isFinite)))
        throw new Error(`${name}: move is [x, y, z], not ${JSON.stringify(change.move)}`);
      pose.p[i] = add(pose.p[i], qturn(qconj(parentWorld(rig, i)), change.move));
    }
  }
  return pose;
}

/** A pose from a frame's numbers: `values[bone] = [x, y, z, about x, about y, about z]`, a frame of `readSequence`. */
export function poseOfValues(rig, values) {
  if (values.length !== rig.bones.length) throw new Error(`poseOfValues: ${values.length} bones' values for a skeleton of ${rig.bones.length}`);
  return { q: values.map((v) => qunit(qofAngles(v.slice(3, 6)))), p: values.map((v) => v.slice(0, 3)) };
}

/** Where every bone is in the model, in a pose: `[{ q, p }]`, its turn and its place. */
export function worldOf(rig, pose) {
  const world = [];
  rig.bones.forEach((bone, i) => {
    if (bone.parent < 0) world.push({ q: pose.q[i], p: pose.p[i] });
    else {
      const parent = world[bone.parent];
      world.push({ q: qmul(parent.q, pose.q[i]), p: add(parent.p, qturn(parent.q, pose.p[i])) });
    }
  });
  return world;
}

/**
 * A limb of two bones bent so that its end is at a place: a leg told where its foot is, an arm where its
 * hand is. `bones` are three, `[upper, lower, end]` (thigh, calf, foot), each the next one's parent; `to` is
 * the place of the end bone in the model, with the rest of the pose as it is.
 *   bend    the direction the middle joint points, in the model: [1, 0, 0] for a knee (forward, the
 *           default), [-1, 0, 0] for an elbow
 *   level   true: the end bone keeps the turn it has at rest whatever the limb does (a foot flat on the
 *           ground); a `turn` instead: that turn from rest (`{ y: 30 }`, a heel lifted)
 *   aim     { axis, dir, edge, edgeDir }: what the end bone holds pointed along `dir` (in the model): `axis` is
 *           the held thing's own direction as it lies with the skeleton AT REST (a sword built along +x in
 *           the model at rest: [1, 0, 0]); `edge` and `edgeDir` (together) turn it about that axis too (the
 *           blade's edge, the lantern's front). Without them it is turned the shortest way from how the hand
 *           carries it. After `level`, which it overrides
 *   grip    a point of the model at rest (the middle of a sword's grip): the limb is bent so that THIS point
 *           is at `to`, as the hand is turned
 * It returns a new pose with `reached` (false when the place is farther than the limb is long: the limb is
 * then straight towards it) and `short` (by how much).
 */
export function reach(rig, pose, { bones, to, bend = [1, 0, 0], level, aim, grip }) {
  if (aim !== undefined || grip !== undefined) return reachHolding(rig, pose, { bones, to, bend, level, aim, grip });
  if (!(Array.isArray(bones) && bones.length === 3))
    throw new Error("reach: bones are three, [upper, lower, end], as a thigh, a calf and a foot");
  const [upper, lower, end] = bones.map((bone) => rig.index(bone));
  if (rig.bones[lower].parent !== upper || rig.bones[end].parent !== lower)
    throw new Error(
      `reach: ${rig.names[upper]}, ${rig.names[lower]} and ${rig.names[end]} are to be each the next one's parent`,
    );
  if (!(Array.isArray(to) && to.length === 3 && to.every(Number.isFinite)))
    throw new Error(`reach: to is a place [x, y, z] in the model, not ${JSON.stringify(to)}`);
  const made = { q: pose.q.map((q) => [...q]), p: pose.p.map((p) => [...p]) };
  const before = worldOf(rig, made);
  const root = before[upper].p;
  const upperLong = lengthOf(made.p[lower]);
  const lowerLong = lengthOf(made.p[end]);
  const reachMost = upperLong + lowerLong;
  const reachLeast = Math.abs(upperLong - lowerLong);
  let span = sub(to, root);
  const far = lengthOf(span);
  const within = Math.max(reachLeast + 1e-6, Math.min(reachMost - 1e-6, far));
  const reached = far <= reachMost + 1e-6 && far >= reachLeast - 1e-6;
  span = far > 1e-9 ? scale(span, within / far) : [0, 0, -within];
  // the middle joint: on the circle about the line from the limb's top to its end, on the side `bend` points
  const along = unit(span);
  const toJoint = (upperLong * upperLong - lowerLong * lowerLong + within * within) / (2 * within);
  const out = Math.sqrt(Math.max(0, upperLong * upperLong - toJoint * toJoint));
  let side = sub(bend, scale(along, bend[0] * along[0] + bend[1] * along[1] + bend[2] * along[2]));
  if (lengthOf(side) < 1e-6) side = cross(along, [0, 1, 0]); // bent along the limb itself: any side will do
  const joint = add(root, add(scale(along, toJoint), scale(unit(side), out)));
  const tip = add(root, span);
  // each bone turned, in the model, by the shortest way from where its parent carries it to where it must point
  const point = (i, child, from, towards) => {
    const world = worldOf(rig, made);
    const parent = rig.bones[i].parent < 0 ? [1, 0, 0, 0] : world[rig.bones[i].parent].q;
    const carried = qmul(parent, rig.local[i]); // the bone with no turn of its own, under this parent
    const points = qturn(carried, made.p[child]);
    const turned = qmul(qarc(points, sub(towards, from)), carried);
    made.q[i] = qunit(qmul(qconj(parent), turned));
  };
  point(upper, lower, root, joint);
  point(lower, end, joint, tip);
  if (level !== undefined && level !== false) {
    const world = worldOf(rig, made);
    const kept = level === true ? rig.world[end] : qmul(turnOf(level, rig.names[end]), rig.world[end]);
    made.q[end] = qunit(qmul(qconj(world[lower].q), kept));
  }
  made.reached = reached;
  made.short = reached ? 0 : Math.abs(far - within);
  return made;
}

/** Three numbers, or a throw naming what they were for. */
function direction(value, what) {
  if (!(Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) && lengthOf(value) > 1e-9))
    throw new Error(`reach: ${what} is a direction [x, y, z], not ${JSON.stringify(value)}`);
  return unit(value);
}
/**
 * The turn that takes the frame (d, e, d x e) to (D, E, D x E): `d` to `D` exactly, and `e` (made square to
 * `d`) as near `E` as it can go. Each pair is two directions; with no `e`, the shortest turn of `d` to `D`.
 */
export function qframes(d, e, D, E) {
  const a = unit(d);
  const b = unit(D);
  if (!e || !E) return qarc(a, b);
  const square = (v, to) => unit(sub(v, scale(to, v[0] * to[0] + v[1] * to[1] + v[2] * to[2])));
  const ea = square(e, a);
  const eb = square(E, b);
  const ta = cross(a, ea);
  const tb = cross(b, eb);
  // the matrix taking a, ea, ta to b, eb, tb, as a quaternion
  const m = [0, 1, 2].map((r) => [0, 1, 2].map((c) => b[r] * a[c] + eb[r] * ea[c] + tb[r] * ta[c]));
  const trace = m[0][0] + m[1][1] + m[2][2];
  let q;
  if (trace > 0) {
    const k = Math.sqrt(trace + 1) * 2;
    q = [k / 4, (m[2][1] - m[1][2]) / k, (m[0][2] - m[2][0]) / k, (m[1][0] - m[0][1]) / k];
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const k = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    q = [(m[2][1] - m[1][2]) / k, k / 4, (m[0][1] + m[1][0]) / k, (m[0][2] + m[2][0]) / k];
  } else if (m[1][1] > m[2][2]) {
    const k = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    q = [(m[0][2] - m[2][0]) / k, (m[0][1] + m[1][0]) / k, k / 4, (m[1][2] + m[2][1]) / k];
  } else {
    const k = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    q = [(m[1][0] - m[0][1]) / k, (m[0][2] + m[2][0]) / k, (m[1][2] + m[2][1]) / k, k / 4];
  }
  return qunit(q);
}
/** How many times the arm is bent again when the grip is not the end bone's joint: the hand's turn moves it. */
const GRIP_ROUNDS = 4;
/**
 * `reach` with something held: the end bone turned so that the held thing points `aim.dir`, and with `grip`
 * the limb bent so that the grip, not the end bone's joint, is at `to`.
 */
function reachHolding(rig, pose, { bones, to, bend, level, aim, grip }) {
  const end = rig.index(bones[2]);
  const lower = rig.index(bones[1]);
  const axis = aim && direction(aim.axis, "aim.axis");
  const dir = aim && direction(aim.dir, "aim.dir");
  const edge = aim?.edge && direction(aim.edge, "aim.edge");
  const edgeDir = aim?.edgeDir && direction(aim.edgeDir, "aim.edgeDir");
  if (aim && Boolean(edge) !== Boolean(edgeDir)) throw new Error("reach: aim.edge and aim.edgeDir go together");
  if (grip !== undefined && !(Array.isArray(grip) && grip.length === 3 && grip.every(Number.isFinite)))
    throw new Error(`reach: grip is a point [x, y, z] of the model at rest, not ${JSON.stringify(grip)}`);
  // where the grip is from the end bone's joint, at rest, in the model
  const restEnd = worldOf(rig, rig.rest)[end];
  const offset = grip ? sub(grip, restEnd.p) : [0, 0, 0];
  /** The end bone's turn in the model with the held thing aimed, for a limb bent as `made` is. */
  const aimed = (made) => {
    const world = worldOf(rig, made)[end].q;
    if (!aim) return world;
    // the held thing's axes as the hand carries them now, turned onto the ones asked for
    const fromRest = qmul(world, qconj(rig.world[end]));
    const now = qturn(fromRest, axis);
    const nowEdge = edge ? qturn(fromRest, edge) : null;
    return qunit(qmul(qframes(now, nowEdge, dir, edgeDir), world));
  };
  let wrist = to;
  let made = reach(rig, pose, { bones, to: wrist, bend, level });
  for (let round = 0; round < (grip ? GRIP_ROUNDS : 1); round++) {
    const turn = aimed(made);
    if (grip) {
      // the joint is the grip less the offset, as the hand will turn it
      wrist = sub(to, qturn(qmul(turn, qconj(rig.world[end])), offset));
      made = reach(rig, pose, { bones, to: wrist, bend, level });
    }
    const parent = worldOf(rig, made)[lower].q;
    made.q[end] = qunit(qmul(qconj(parent), aim ? aimed(made) : turn));
  }
  return made;
}

/**
 * A pose with one bone turned so that it stands at a turn of its own in the MODEL, whatever its parents do: a
 * lantern that hangs straight down from a swinging fist, a head that keeps looking ahead.
 *   turn   in the model's axes, from the way the bone stands at rest (as `poseOf` says turns; nothing: as at
 *          rest), or `{ q }`: a quaternion [w, x, y, z] of its whole turn in the model
 * Its place stays as its parent carries it.
 */
export function hold(rig, pose, bone, turn) {
  const i = rig.index(bone);
  const want = turn?.q ? qunit(turn.q) : qmul(turnOf(turn ?? {}, rig.names[i]), rig.world[i]);
  const made = { q: pose.q.map((q) => [...q]), p: pose.p.map((p) => [...p]) };
  const parent = rig.bones[i].parent < 0 ? [1, 0, 0, 0] : worldOf(rig, made)[rig.bones[i].parent].q;
  made.q[i] = qunit(qmul(qconj(parent), want));
  return made;
}

/**
 * A pose with left and right changed over: what the left arm did the right one does, mirrored, and the
 * body's own lean and turn are mirrored too. The two sides are found by their names: ` L ` and ` R ` as
 * Biped writes them, or a name that ends or begins with l/r or left/right after `.`, `_` or a space
 * (`arm.L`, `leg_r`, `Left Foot`). `pairs`: `[[left, right]]` names them by hand instead. A walk's second
 * half is the mirror of its first.
 */
export function mirror(rig, pose, { pairs } = {}) {
  const other = rig.bones.map((_, i) => i);
  if (pairs)
    for (const [left, right] of pairs) {
      other[rig.index(left)] = rig.index(right);
      other[rig.index(right)] = rig.index(left);
    }
  else
    rig.names.forEach((name, i) => {
      const partner = rig.names.indexOf(partnerName(name));
      if (partner >= 0 && partner !== i) other[i] = partner;
    });
  const made = { q: [], p: [] };
  rig.bones.forEach((bone, i) => {
    const from = other[i];
    // what the other bone did, as a turn and a shift in the model's axes, seen in a mirror across y = 0
    const did = qmul(
      rig.world[from],
      qmul(qmul(qconj(rig.local[from]), pose.q[from]), qconj(rig.world[from])),
    );
    const mirrored = [did[0], -did[1], did[2], -did[3]];
    made.q.push(qunit(qmul(rig.local[i], qmul(qconj(rig.world[i]), qmul(mirrored, rig.world[i])))));
    const shift = qturn(parentWorld(rig, from), sub(pose.p[from], rig.bones[from].pos));
    made.p.push(add(bone.pos, qturn(qconj(parentWorld(rig, i)), [shift[0], -shift[1], shift[2]])));
  });
  return made;
}
/** A bone's name with its side changed, or the name itself where it has no side. */
function partnerName(name) {
  const swap = { L: "R", R: "L", l: "r", r: "l", Left: "Right", Right: "Left", left: "right", right: "left" };
  const sided = /(^|[ ._])(Left|Right|left|right|L|R|l|r)($|[ ._])/;
  return name.replace(sided, (_, before, side, after) => `${before}${swap[side]}${after}`);
}

// ── from poses to frames ────────────────────────────────────────────────────
/** How a stretch between two keys is passed through: 0 to 1 in, 0 to 1 out. */
const EASES = {
  linear: (t) => t,
  smooth: (t) => t * t * (3 - 2 * t), // slow out of one pose, slow into the next
  in: (t) => t * t, // slow out of the pose, fast into the next: a blow landing
  out: (t) => 1 - (1 - t) * (1 - t), // fast out, slow in: a recoil settling
};
/** The pose a part of the way from one to another: each bone by its shortest turn. */
export function between(a, b, t) {
  return {
    q: a.q.map((q, i) => qslerp(q, b.q[i], t)),
    p: a.p.map((p, i) => add(p, scale(sub(b.p[i], p), t))),
  };
}
/** A pose as the file's numbers: for each bone `[x, y, z, about x, about y, about z]`. */
export function valuesOf(rig, pose) {
  return rig.bones.map((_, i) => [...pose.p[i], ...anglesOf(pose.q[i])]);
}

/**
 * An animation from key poses: `frames[frame][bone] = [x, y, z, about x, about y, about z]`, as
 * `addSequence`, `replaceSequence` and `writeMdl` take it.
 *   frames   how many frames (2 at the least)
 *   loops    true: the last frame is the first again, as the engine wants of a looping animation (it plays
 *            from frame 0 to the last and begins again, so a loop of 30 steps is 31 frames); a key at the
 *            last frame is not to be given
 *   keys     [{ at, pose, ease }]: the pose at frame `at` (any order; one at 0 is needed). Between two keys
 *            each bone goes by its shortest turn. `ease` says how a key is arrived at: "smooth" (unless
 *            told), "linear", "in" (slow, then fast: a blow landing) or "out" (fast, then slow)
 *   each     (pose, frame, part) => pose: called for every frame with the pose the keys gave and how far
 *            through the animation it is (0 to 1); what it returns is the frame. Where the feet are put
 *            (`reach`), so that they are planted by arithmetic and not by eye
 * The angles of a bone never jump by a turn from one frame to the next.
 */
export function animate(rig, { frames: count, loops = false, keys, each }) {
  if (!(Number.isInteger(count) && count >= 2))
    throw new Error(`animate: frames is a whole number, 2 at the least, not ${count}`);
  if (!Array.isArray(keys) || !keys.length) throw new Error("animate: keys is a list of { at, pose }");
  const last = count - 1;
  const sorted = [...keys].sort((a, b) => a.at - b.at);
  for (const key of sorted) {
    if (!(Number.isFinite(key.at) && key.at >= 0 && key.at <= last))
      throw new Error(`animate: a key is at a frame from 0 to ${last}, not ${key.at}`);
    if (!key.pose?.q || key.pose.q.length !== rig.bones.length)
      throw new Error(`animate: the key at ${key.at} has no pose of this rig (poseOf makes one)`);
    if (key.ease !== undefined && !(key.ease in EASES))
      throw new Error(`animate: ease is ${Object.keys(EASES).join(", ")}, not ${key.ease}`);
  }
  if (sorted[0].at !== 0) throw new Error("animate: the first key is at frame 0");
  if (loops) {
    if (sorted[sorted.length - 1].at === last)
      throw new Error(
        `animate: a looping animation's last frame (${last}) is its first again: leave that key out`,
      );
    sorted.push({ ...sorted[0], at: last });
  }
  const made = [];
  for (let frame = 0; frame < count; frame++) {
    let next = sorted.findIndex((key) => key.at >= frame);
    if (next < 0) next = sorted.length - 1;
    const to = sorted[next];
    const from = sorted[Math.max(0, next - 1)];
    const part = to.at === from.at || frame >= to.at ? 1 : (frame - from.at) / (to.at - from.at);
    let pose = next === 0 ? to.pose : between(from.pose, to.pose, EASES[to.ease ?? "smooth"](part));
    if (each) pose = each(pose, frame, frame / last) ?? pose;
    made.push(valuesOf(rig, pose));
  }
  if (loops) made[last] = made[0].map((six) => [...six]);
  // an angle is the same turn with a whole turn added: keep each near the frame before, so that what is
  // stored for a bone does not leap (a leap costs the file's 16 bits their fineness)
  for (let frame = 1; frame < count; frame++)
    made[frame].forEach((six, bone) => {
      for (let angle = 3; angle < 6; angle++) {
        const before = made[frame - 1][bone][angle];
        six[angle] -= 2 * Math.PI * Math.round((six[angle] - before) / (2 * Math.PI));
      }
    });
  return made;
}

/**
 * A pose as the matrices the drawing takes: `render(mdl, { pose: matricesOf(rig, pose) })` draws a model in
 * a pose that is in no animation of it yet.
 */
export function matricesOf(rig, pose) {
  return boneMatrices(rig.bones, valuesOf(rig, pose));
}

// ── what was made, measured ─────────────────────────────────────────────────
/**
 * Where a point of a bone is in the model, frame by frame: `[[x, y, z]]`. `at` is the point in the bone's
 * own space (unless told, the bone's own place: a joint).
 */
export function track(rig, frames, bone, at = [0, 0, 0]) {
  const i = rig.index(bone);
  return frames.map((values) => apply34(boneMatrices(rig.bones, values)[i], at));
}

/**
 * How far a looping animation's last frame is from its first: `{ degrees, units, bone }`, the widest turn
 * and the widest shift of any bone, and the bone with the widest turn. Both are 0 for a loop that closes.
 */
export function seam(rig, frames) {
  const first = frames[0];
  const last = frames[frames.length - 1];
  let degrees = 0;
  let units = 0;
  let bone = null;
  rig.bones.forEach((each, i) => {
    const turn = degreesOf(qmul(qconj(qofAngles(first[i].slice(3))), qofAngles(last[i].slice(3))));
    if (turn > degrees) {
      degrees = turn;
      bone = each.name;
    }
    units = Math.max(units, lengthOf(sub(first[i], last[i])));
  });
  return { degrees, units, bone };
}

/**
 * A walk measured by its feet. A monster that walks in place is moved by the game at some speed; where a
 * foot is on the ground it must go back under the body at that very speed, or it slides. For each foot
 * (`feet`: bones, or `{ bone, at }` for a point of one, such as a sole) this finds the frames it is planted
 * (within `ground` units of the lowest it ever is; unless told, 1) and how fast it goes back along -x
 * while it is.
 *   fps      the animation's rate
 * It returns
 *   { speed            units a second: the speed to move the monster at so that its feet hold the ground
 *     slide            units a second: how far the planted feet's own speeds are from that, at the worst
 *     low              the lowest any foot goes (z): under 0 it is in the ground when the model's feet are at 0
 *     feet: [{ name, planted: [frames], speed, slide, low }] }
 * `speed` is null when no foot is planted for two frames together.
 */
export function stride(rig, frames, { feet, fps, ground = 1 }) {
  if (!Array.isArray(feet) || !feet.length) throw new Error("stride: feet is a list of bones");
  if (!(fps > 0)) throw new Error(`stride: fps is the animation's rate, over 0, not ${fps}`);
  const measured = feet.map((foot) => {
    const named = typeof foot === "object" && !Array.isArray(foot) ? foot : { bone: foot };
    const path = track(rig, frames, named.bone, named.at);
    const low = Math.min(...path.map((point) => point[2]));
    const planted = path.map((point, frame) => (point[2] <= low + ground ? frame : -1)).filter((f) => f >= 0);
    const speeds = [];
    for (let frame = 1; frame < path.length; frame++)
      if (planted.includes(frame) && planted.includes(frame - 1))
        speeds.push((path[frame - 1][0] - path[frame][0]) * fps);
    const speed = speeds.length ? speeds.reduce((sum, value) => sum + value, 0) / speeds.length : null;
    return { name: rig.names[rig.index(named.bone)], planted, speed, speeds, low };
  });
  const known = measured.filter((foot) => foot.speed !== null);
  const speed = known.length ? known.reduce((sum, foot) => sum + foot.speed, 0) / known.length : null;
  let slide = 0;
  for (const foot of measured) {
    foot.slide = speed === null ? 0 : Math.max(0, ...foot.speeds.map((value) => Math.abs(value - speed)));
    slide = Math.max(slide, foot.slide);
    delete foot.speeds;
  }
  return { speed, slide, low: Math.min(...measured.map((foot) => foot.low)), feet: measured };
}

// ── on the ground ───────────────────────────────────────────────────────────
/**
 * A model's animations kept on the ground: in every frame of `seqs`, the lowest point of the model as built
 * (every triangle of `body`, as the game draws it) is measured, and where it is under `ground` (z, 0) the
 * root bones are lifted by that much. A fall or a kneel made by key poses sinks knees and elbows into the
 * floor; this puts them on it. With `touch: true` a frame that floats is lowered onto it too (a body lying
 * down; not for a jump).
 *   mdl    the model's bytes, its animations in it
 *   seqs   the animations' names or numbers (all of them unless told)
 * Returns { mdl (the animations replaced where they stand, their boxes measured again), frames ({ name:
 * frames }: the lifted frames, for a builder that makes the model again with `buildMdl`), lifted ({ name: [the
 * lift of each frame] }) }.
 */
export function grounded(mdl, { seqs, body = 0, ground = 0, touch = false } = {}) {
  const all = sequencesOf(mdl);
  const chosen = (seqs ?? all.map((_, n) => n)).map((which) => {
    const at = typeof which === "number" ? which : all.findIndex((s) => s.name === which);
    if (!all[at]) throw new Error(`grounded: no animation ${which}: it has ${all.map((s) => s.name).join(", ")}`);
    return at;
  });
  const roots = bonesOf(mdl).flatMap((bone, i) => (bone.parent < 0 ? [i] : []));
  let out = mdl;
  const frames = {};
  const lifted = {};
  for (const number of chosen) {
    const sequence = readSequence(mdl, number);
    const lifts = sequence.frames.map((_, frame) => {
      let low = Infinity;
      for (const t of posed(mdl, { seq: number, frame, body }).tris) for (const c of t.c) low = Math.min(low, c.p[2]);
      if (!Number.isFinite(low)) return 0;
      return low < ground || (touch && low > ground) ? ground - low : 0;
    });
    const made = sequence.frames.map((values, frame) =>
      values.map((six, bone) => (roots.includes(bone) ? [six[0], six[1], six[2] + lifts[frame], ...six.slice(3)] : [...six])),
    );
    frames[sequence.name] = made;
    lifted[sequence.name] = lifts.map((v) => +v.toFixed(3));
    if (lifts.some((v) => v !== 0)) out = replaceSequence(out, number, { frames: made });
  }
  return { mdl: out, frames, lifted };
}
