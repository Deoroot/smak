// Third-person blows for a humanoid body: the upper body's turn, the sword arm's path, the off arm and a small lunge,
// made on a game's own skeleton as keys of local bone rotations (our own data), for a game to lay over its locomotion.
// Shaped by Vermintide 2's third-person bands (anim/corpus/body-vt2.json, lib/vt2body.mjs), measured with the same
// measureBlow and held to those bands (bodyVerdicts). No clip, key or pose of Vermintide's is used: only its numbers.
//
// The rig (rigFromDump) comes from the game: bone names, parents, the bind pose, and the body's armed idle as its
// animation graph poses it (a dump: rpg_sbox's tools/cs/body_dump.cs). It stays local (the body is the game's).
// Space: the model's (s&box: +x ahead, +y left, +z up, inches). A spec's places are in forearms from the sword
// shoulder at the ready pose, [ahead, left, up]; its directions [ahead, left, up]; angles in degrees.
//
// A blow is keys in time (spec.blows[].keys): each may set the grip (the hand's hold point), the blade's direction,
// the edge's (else led by the tip's motion where `edge: "lead"`, else the wrist's most natural roll), the trunk's
// turn [yaw + left, lean + forward, side + right], the head's [yaw, pitch + down], the hips' lunge [ahead in forearms,
// drop in body heights], the off wrist's place, and a pace (how fast the path runs through the key against the
// segments' mean: 0 still, 1 even, >1 the strike's peak). Between keys every value follows one Catmull-Rom curve on
// the keys' index, run in time by a Hermite of the paces, so the tip's fastest moment can be put on the hit.
// Every frame the sword arm is solved by two-bone IK from the turned trunk, over the elbow's swivel and the blade's
// roll: the wrist's bend and twist held to a body's range, the edge led, no flip from the frame before. The legs are
// bent back to the idle's feet (the lunge is for standing still; a game drops it while moving).
//
// Out (keysFile): { rig, fps, bones, modes, idle, clips: { name: { frames, hit, blendIn, standing, rot, pos } } }:
// per frame a quaternion per bone; "add" bones (the trunk and head) as a turn from the idle's local (to lay over
// the locomotion's own aim), "abs" bones (arms, hands, fingers, the hold) as their local rotation, "stand" bones
// (pelvis, legs) as their local rotation, the pelvis's offset from the idle in `pos` (standing only).

import { measureBlow } from "./vt2body.mjs";
import { overall } from "./judge.mjs";

const DEG = Math.PI / 180;
// ── vectors and quaternions ([x, y, z, w]) ──
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const angleOf = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) / DEG;
const perp = (v, n) => unit(sub(v, mul(n, dot(v, n))));

export const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
export const qrot = (q, v) => {
  const t = mul(cross(q, v), 2);
  return add(add(v, mul(t, q[3])), cross(q, t));
};
const qnorm = (q) => {
  const l = Math.hypot(...q) || 1;
  return q.map((x) => x / l);
};
export const qaxis = (axis, deg) => {
  const a = unit(axis);
  const s = Math.sin((deg * DEG) / 2);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos((deg * DEG) / 2)];
};
export function qslerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) (d = -d), (bb = b.map((x) => -x));
  if (d > 0.9995) return qnorm(a.map((x, i) => x + (bb[i] - x) * t));
  const th = Math.acos(d);
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return a.map((x, i) => x * wa + bb[i] * wb);
}
/** The rotation whose columns are the orthonormal x, y, z. */
export function qbasis(x, y, z) {
  const m = [
    [x[0], y[0], z[0]],
    [x[1], y[1], z[1]],
    [x[2], y[2], z[2]],
  ];
  const tr = m[0][0] + m[1][1] + m[2][2];
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s, s / 4];
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    q = [s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] - m[1][2]) / s];
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    q = [(m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s, (m[0][2] - m[2][0]) / s];
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    q = [(m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4, (m[1][0] - m[0][1]) / s];
  }
  return qnorm(q);
}
/** The least turn taking direction a to direction b. */
export function qfromTo(a, b) {
  const u = unit(a);
  const v = unit(b);
  const d = dot(u, v);
  if (d < -0.99999) {
    const o = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    return qaxis(cross(u, o), 180);
  }
  const c = cross(u, v);
  return qnorm([c[0], c[1], c[2], 1 + d]);
}
/** A rotation's twist about an axis (degrees, signed) and the swing's angle. */
export function swingTwist(q, axis) {
  const a = unit(axis);
  const p = dot([q[0], q[1], q[2]], a);
  let tw = qnorm([a[0] * p, a[1] * p, a[2] * p, q[3]]);
  if (tw[3] < 0) tw = tw.map((x) => -x);
  const twist = (2 * Math.atan2(dot([tw[0], tw[1], tw[2]], a), tw[3])) / DEG;
  const swing = angleOf(qrot(q, a), a);
  return { twist, swing };
}
const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

// ── the rig ──

/** The citizen's bones by part (s&box's citizen skeleton; another rig passes its own map). */
export const CITIZEN = {
  hips: "pelvis",
  spine: ["spine_0", "spine_1", "spine_2"],
  neck: "neck_0",
  head: "head",
  R: { clav: "clavicle_R", upper: "arm_upper_R", fore: "arm_lower_R", hand: "hand_R", hold: "hold_R", twist: "arm_lower_R_twist1" },
  L: { clav: "clavicle_L", upper: "arm_upper_L", fore: "arm_lower_L", hand: "hand_L", hold: "hold_L", twist: "arm_lower_L_twist1" },
  legs: {
    R: { upper: "leg_upper_R", lower: "leg_lower_R", foot: "ankle_R", toe: "ball_R" },
    L: { upper: "leg_upper_L", lower: "leg_lower_L", foot: "ankle_L", toe: "ball_L" },
  },
  /** the sword hand's fingers (closed round the grip from a pose where they hold something) */
  fingers: /^finger_.*_R$/,
};

const parseT = (s) => {
  const v = s.trim().split(/\s+/).map(Number);
  return { p: v.slice(0, 3), q: qnorm(v.slice(3, 7)) };
};

/**
 * A rig from a game's dump: { names, parent, bind (model space), idle (local: parent space), idleModel } and the
 * map's indices. `dump` as tools/cs/body_dump.cs writes it ({ body: { bones: [{ Name, parent, bind }] }, liveParent:
 * [[ "x y z qx qy qz qw" per bone ] per frame] }); `grip` another such dump whose sword-hand fingers hold something
 * (their locals are taken for the grip).
 */
export function rigFromDump(dump, { grip = null, map = CITIZEN, frame = 0 } = {}) {
  const bones = dump.body.bones;
  const names = bones.map((b) => b.Name);
  const parent = bones.map((b) => b.parent);
  const bind = bones.map((b) => parseT(b.bind));
  const idle = dump.liveParent[frame].map(parseT);
  const at = (n) => {
    const i = names.indexOf(n);
    if (i < 0) throw new Error(`bodyblow: no bone ${n} in the rig`);
    return i;
  };
  const rig = { names, parent, bind, idle, map, at };
  // the fingers' grip
  if (grip) {
    const gNames = grip.body.bones.map((b) => b.Name);
    const gIdle = grip.liveParent[frame].map(parseT);
    rig.gripLocal = {};
    names.forEach((n, i) => {
      if (map.fingers.test(n) && gNames.includes(n)) rig.gripLocal[i] = gIdle[gNames.indexOf(n)];
    });
  }
  rig.idleModel = fk(rig, idle);
  // the hold point on the hand: where the bind puts it (the axis through the fist, pinky to index, as its +z)
  const h = at(map.R.hand);
  const o = at(map.R.hold);
  const hb = bind[h];
  const ob = bind[o];
  rig.holdLocal = { p: qrot(qinv(hb.q), sub(ob.p, hb.p)), q: qmul(qinv(hb.q), ob.q) };
  if (grip) {
    // the hold's place in a closed fist (the grip pose's), its turn the bind's
    const gNames = grip.body.bones.map((b) => b.Name);
    const gi = gNames.indexOf(map.R.hold);
    if (gi >= 0) rig.holdLocal.p = parseT(grip.liveParent[frame][gi]).p;
  }
  // lengths
  const P = (n) => rig.idleModel[at(n)].p;
  rig.forearm = (len(sub(P(map.R.hand), P(map.R.fore))) + len(sub(P(map.L.hand), P(map.L.fore)))) / 2;
  rig.upperArm = (len(sub(P(map.R.fore), P(map.R.upper))) + len(sub(P(map.L.fore), P(map.L.upper)))) / 2;
  rig.height = P(map.head)[2];
  // the elbow's hinge in each arm bone's own axes, from a pose where the elbow bends (the grip's, else the idle's)
  const ref = grip ? rigPose(grip, names, frame) : rig.idleModel;
  rig.hinge = {};
  for (const side of ["R", "L"]) {
    const m = map[side];
    const u = sub(ref[at(m.fore)].p, ref[at(m.upper)].p);
    const f = sub(ref[at(m.hand)].p, ref[at(m.fore)].p);
    const n = unit(cross(u, f));
    rig.hinge[side] = { upper: qrot(qinv(ref[at(m.upper)].q), n), fore: qrot(qinv(ref[at(m.fore)].q), n) };
  }
  return rig;
}

/** Another dump's model-space pose, its bones in `names` order. */
function rigPose(dump, names, frame) {
  const gNames = dump.body.bones.map((b) => b.Name);
  const parent = dump.body.bones.map((b) => b.parent);
  const local = dump.liveParent[frame].map(parseT);
  const model = fk({ parent }, local);
  return names.map((n) => model[gNames.indexOf(n)] ?? { p: [0, 0, 0], q: [0, 0, 0, 1] });
}

/** Model-space transforms from locals (parents before children is not assumed). */
export function fk(rig, local) {
  const out = new Array(local.length);
  const get = (i) => {
    if (out[i]) return out[i];
    const pi = rig.parent[i];
    if (pi < 0) return (out[i] = { p: local[i].p.slice(), q: local[i].q.slice() });
    const P = get(pi);
    return (out[i] = { p: add(P.p, qrot(P.q, local[i].p)), q: qnorm(qmul(P.q, local[i].q)) });
  };
  for (let i = 0; i < local.length; i++) get(i);
  return out;
}

const toLocal = (parentModel, model) => ({ p: qrot(qinv(parentModel.q), sub(model.p, parentModel.p)), q: qnorm(qmul(qinv(parentModel.q), model.q)) });

// ── curves ──

/** Catmull-Rom on the keys' index (uniform), for numbers or vectors; `u` from 0 to keys-1. */
function curve(values, u) {
  const n = values.length;
  const i = Math.max(0, Math.min(n - 2, Math.floor(u)));
  const t = u - i;
  const P = (k) => values[Math.max(0, Math.min(n - 1, k))];
  const p0 = P(i - 1);
  const p1 = P(i);
  const p2 = P(i + 1);
  const p3 = P(i + 2);
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return Array.isArray(p1) ? p1.map((_, k) => f(p0[k], p1[k], p2[k], p3[k])) : f(p0, p1, p2, p3);
}

/** The keys' index at time t: a Hermite per segment, its slopes the keys' paces of the secants' mean, kept monotone. */
function timeMap(times, paces) {
  const n = times.length;
  const sec = [];
  for (let k = 0; k < n - 1; k++) sec.push(1 / Math.max(1e-6, times[k + 1] - times[k]));
  const slope = times.map((_, k) => {
    const s = k === 0 ? sec[0] : k === n - 1 ? sec[n - 2] : (sec[k - 1] + sec[k]) / 2;
    const lim = 3 * Math.min(k > 0 ? sec[k - 1] : Infinity, k < n - 1 ? sec[k] : Infinity);
    return Math.min(lim, paces[k] * s);
  });
  return (t) => {
    if (t <= times[0]) return 0;
    if (t >= times[n - 1]) return n - 1;
    let k = 0;
    while (k < n - 2 && t > times[k + 1]) k++;
    const h = times[k + 1] - times[k];
    const s = (t - times[k]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    // u from k to k+1, du/dt = slope at the ends
    return k * (2 * s3 - 3 * s2 + 1) + slope[k] * h * (s3 - 2 * s2 + s) + (k + 1) * (-2 * s3 + 3 * s2) + slope[k + 1] * h * (s3 - s2);
  };
}

/**
 * How fast a blow runs, by strength: the tip's peak (forearms a second), the strike bell's half-widths before and

 * (speed: of the run's own measure, the tip's way and GRIP_WEIGHT of the grip's, so above the tip's own peak)
 * after the hit (s: the speed is 40% of the peak at 0.96 of them, 15% at 1.38), the wind-up's own bump (it ends
 * `windupEnd` s before the hit) and the glide home after the follow-through. From Vermintide 2's third person: a
 * light's tip peaks at 96 fa/s, its strike lasts 0.26 s, its follow-through 0.11; a heavy's 90, 0.32, 0.13.
 */
/** How much the grip's way counts against the tip's in a blow's run (strikeTime). */
export const GRIP_WEIGHT = 0.5;
export const STRIKE_TIME = {
  light: { speed: 125, rise: 0.12, fall: 0.13, windupEnd: 0.1 },
  heavy: { speed: 115, rise: 0.15, fall: 0.16, windupEnd: 0.1 },
};

/**
 * The keys' index in time for a blow with a hit: the tip's arc length along the keys' path (tipOfU) run on a speed
 * profile, the strike's bell peaking on the hit (so the tip passes the hit key at hitAt, at its fastest), a wind-up
 * bump before it and a glide home after, each scaled so the path is run exactly: { u(t), info }.
 */
export function strikeTime(tipOfU, count, hitKey, hitAt, length, { speed, rise, fall, windupEnd }) {
  // the path's arc length on u
  const N = 4000;
  const A = new Float64Array(N + 1);
  // the tip's way and, weighed in, the grip's: where the tip all but stops while the hand still moves (a cusp of the
  // tip's path) the hand's own way keeps the run from leaping through it in a frame
  let last = tipOfU(0);
  for (let i = 1; i <= N; i++) {
    const p = tipOfU(((count - 1) * i) / N);
    A[i] = A[i - 1] + len(sub(p.tip, last.tip)) + GRIP_WEIGHT * len(sub(p.grip, last.grip));
    last = p;
  }
  const uOfS = (sv) => {
    let lo = 0;
    let hi = N;
    if (sv <= 0) return 0;
    if (sv >= A[N]) return count - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (A[mid] < sv) lo = mid;
      else hi = mid;
    }
    const f = (sv - A[lo]) / (A[hi] - A[lo] || 1);
    return ((lo + f) * (count - 1)) / N;
  };
  const sHit = A[Math.round((hitKey * N) / (count - 1))];
  const sEnd = A[N];
  const dt = 1 / 1200;
  const steps = Math.ceil(length / dt);
  const bell = (t, w) => Math.exp(-(((t - hitAt) / w) ** 2));
  const tw = Math.max(0.05, hitAt - windupEnd);
  const bump = (t) => (t >= 0 && t <= tw ? Math.sin((Math.PI * t) / tw) ** 2 : 0);
  const glide = (t) => (t > hitAt && t < length ? Math.sin((Math.PI * (t - hitAt)) / (length - hitAt)) : 0);
  const integ = (f, a, b) => {
    let s = 0;
    for (let t = a; t < b; t += dt) s += f(t + dt / 2) * dt;
    return s;
  };
  let V = speed;
  const preBell = integ((t) => bell(t, rise), 0, hitAt);
  const preBump = integ(bump, 0, hitAt);
  let w2 = fall;
  let postBell = integ((t) => bell(t, w2), hitAt, length);
  const postGlide = integ(glide, hitAt, length);
  // the peak no faster than either side's path allows (a short way home or a short wind-up lowers it)
  V = Math.min(V, (sEnd - sHit) / postBell, sHit / preBell);
  let b = Math.max(0, (sHit / V - preBell) / (preBump || 1));
  // after the hit: the bell's fall and the glide, the fall narrowed if the path is still too short for it
  let a = ((sEnd - sHit) / V - postBell) / (postGlide || 1);
  while (a < 0 && w2 > 0.02) {
    w2 *= 0.9;
    postBell = integ((t) => bell(t, w2), hitAt, length);
    a = ((sEnd - sHit) / V - postBell) / (postGlide || 1);
  }
  a = Math.max(0, a);
  const v = (t) => (t <= hitAt ? V * (bell(t, rise) + b * bump(t)) : V * (bell(t, w2) + a * glide(t)));
  const S = new Float64Array(steps + 1);
  for (let i = 1; i <= steps; i++) S[i] = S[i - 1] + v((i - 0.5) * dt) * dt;
  // exact at the hit and the end: each side scaled to its own arc
  const iHit = Math.round(hitAt / dt);
  const kPre = sHit / (S[iHit] || 1);
  const kPost = (sEnd - sHit) / (S[steps] - S[iHit] || 1);
  const sAt = (t) => {
    const i = Math.max(0, Math.min(steps, Math.round(t / dt)));
    return i <= iHit ? S[i] * kPre : sHit + (S[i] - S[iHit]) * kPost;
  };
  return { u: (t) => uOfS(sAt(t)), info: { peak: V, windupBump: b, fall: w2, glide: a, arc: sEnd, arcToHit: sHit } };
}

// ── two-bone IK ──

/** Elbow place for a shoulder s, a wrist target w, bone lengths a and b, a swivel `phi` about s->w from `ref`. */
function elbowAt(s, w, a, b, ref, phi) {
  const d0 = sub(w, s);
  const d = Math.max(Math.abs(a - b) + 1e-3, Math.min(a + b - 1e-3, len(d0)));
  const u = unit(d0);
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const v0 = perp(ref, u);
  const v = qrot(qaxis(u, phi), v0);
  return { e: add(s, add(mul(u, a * cosA), mul(v, a * sinA))), w: add(s, mul(u, d)), u, v, short: len(d0) - d };
}

/** An arm bone's model rotation: its +x along `dir`, its hinge axis (in its own axes) on the world hinge `n`. */
function boneAlong(dir, n, hingeLocal) {
  const x = unit(dir);
  const y = perp(n, x);
  const z = cross(x, y);
  const lx = [1, 0, 0];
  const ly = perp(hingeLocal, lx);
  const lz = cross(lx, ly);
  return qmul(qbasis(x, y, z), qinv(qbasis(lx, ly, lz)));
}

// ── the spec ──

const RIGHT_FROM = (rig) => rig.idleModel[rig.at(rig.map.R.upper)].p;

/** Defaults for a blow's keys, from the spec's `ready` key. */
function keyValues(spec, rig, ready, key) {
  const fa = rig.forearm;
  const place = (v) => v;
  const k = key.at === "ready" ? { ...ready, ...key, at: undefined } : { ...key };
  return {
    t: k.t,
    pace: k.pace ?? (key.at === "ready" ? 0 : 1),
    grip: k.grip ?? ready.grip,
    blade: unit(k.blade ?? ready.blade),
    edge: k.edge === "lead" || k.edge === undefined ? null : unit(k.edge),
    lead: k.edge === "lead" ? 1 : 0,
    trunk: k.trunk ?? [0, 0, 0],
    head: k.head ?? [0, 0],
    hips: k.hips ?? [0, 0],
    off: k.off ?? null,
    clav: k.clav ?? 0.25,
    swivel: k.swivel ?? ready.swivel ?? 0,
    hit: !!k.hit,
  };
}

/** Limits and costs of the sword arm's solve. */
export const ARM = {
  wristBend: 50, // the wrist's swing from straight, degrees, beyond which it costs
  twist: 85, // the forearm's roll from the fist's own, either way
  swivelStep: 10,
  rollStep: 10,
  keep: 0.05, // cost of a degree's change of swivel or roll from the frame before
  lead: 0.004, // cost of a degree of the edge off the tip's way (where led)
  pref: 0.0006, // cost of a degree off the key's swivel
};

/**
 * A blow made: { frames: [local pose per frame], model: [model pose per frame], tips, info }.
 * `blow` a spec blow ({ name, strength, fps?, keys }), `spec` the whole (ready, blade, fps).
 */
export function makeBlow(rig, spec, blow) {
  const fps = blow.fps ?? spec.fps ?? 60;
  const ready = spec.ready;
  const keys = blow.keys.map((k) => keyValues(spec, rig, ready, k));
  const times = keys.map((k) => k.t);
  const length = times.at(-1);
  const umap = timeMap(times, keys.map((k) => k.pace));
  const n = Math.round(length * fps) + 1;
  const m = rig.map;
  const at = rig.at;
  const fa = rig.forearm;
  const H = rig.height;
  // the off wrist where a key leaves it: the idle's
  const offIdle = mul(sub(rig.idleModel[at(m.L.hand)].p, rig.idleModel[at(m.R.upper)].p), 1 / fa);
  const offs = keys.map((k) => k.off ?? offIdle);
  const blade = spec.blade ?? 30;
  const series = (f) => keys.map(f);
  const val = (list, u) => curve(list, u);
  const grips = series((k) => k.grip);
  const blades = series((k) => k.blade);
  // a key's edge where given; else none (the solver picks the roll)
  const out = { frames: [], model: [], tips: [], grips: [], info: { short: 0, wristMax: 0, twistMax: 0, clearMin: Infinity, clearAt: -1 } };
  let prev = null;
  // the tip's motion is needed for a led edge: the path first, sampled
  const hitKey = keys.findIndex((k) => k.hit);
  // a blow with a hit is run by the tip's arc length on a speed profile whose peak is the hit (strikeTime); else by
  // the keys' own times and paces
  // the body before the arms at u: the lunge (standing), the legs bent back onto the idle's feet, the trunk's turn
  // shared down the spine as turns in the model's axes, the neck and head
  const hips = at(m.hips);
  const trunkAt = (u) => {
    const local = rig.idle.map((t) => ({ p: t.p.slice(), q: t.q.slice() }));
    const [ahead, drop] = val(series((k) => k.hips), u);
    local[hips].p = add(rig.idle[hips].p, [ahead * fa, 0, -drop * H]);
    let model = fk(rig, local);
    for (const side of ["R", "L"]) {
      const L = m.legs[side];
      const iu = at(L.upper);
      const il = at(L.lower);
      const iF = at(L.foot);
      const goal = rig.idleModel[iF];
      const s = model[iu].p;
      const a = len(sub(rig.idleModel[il].p, rig.idleModel[iu].p));
      const b = len(sub(rig.idleModel[iF].p, rig.idleModel[il].p));
      const kneeRef = sub(rig.idleModel[il].p, add(rig.idleModel[iu].p, mul(unit(sub(goal.p, rig.idleModel[iu].p)), a)));
      const ik = elbowAt(s, goal.p, a, b, len(kneeRef) > 1e-4 ? kneeRef : [1, 0, 0], 0);
      // the leg bones turned the least from their idle directions
      const upQ = qmul(qfromTo(qrot(rig.idleModel[iu].q, [1, 0, 0]), sub(ik.e, s)), rig.idleModel[iu].q);
      const loQ0 = qmul(qfromTo(qrot(rig.idleModel[il].q, [1, 0, 0]), sub(ik.w, ik.e)), rig.idleModel[il].q);
      local[iu].q = qnorm(qmul(qinv(model[rig.parent[iu]].q), upQ));
      local[il].q = qnorm(qmul(qinv(upQ), loQ0));
      local[iF].q = qnorm(qmul(qinv(loQ0), goal.q));
    }
    const [yaw, lean, side] = val(series((k) => k.trunk), u);
    const [hYaw, hPitch] = val(series((k) => k.head), u);
    const T = (sh) => qmul(qaxis([0, 0, 1], yaw * sh), qmul(qaxis([0, 1, 0], lean * sh), qaxis([1, 0, 0], side * sh)));
    const share = [0.3, 0.65, 1];
    model = fk(rig, local);
    const newQ = {};
    m.spine.forEach((bn, i) => (newQ[at(bn)] = qmul(T(share[i]), rig.idleModel[at(bn)].q)));
    const headQ = qmul(qaxis([0, 0, 1], hYaw), qmul(qaxis([0, 1, 0], hPitch), qmul(T(1), rig.idleModel[at(m.head)].q)));
    newQ[at(m.neck)] = qslerp(qmul(T(1), rig.idleModel[at(m.neck)].q), headQ, 0.5);
    newQ[at(m.head)] = headQ;
    for (const bn of [...m.spine, m.neck, m.head]) {
      const i = at(bn);
      const pq = rig.parent[i] === hips ? model[hips].q : newQ[rig.parent[i]];
      local[i].q = qnorm(qmul(qinv(pq), newQ[i]));
    }
    return { local, model: fk(rig, local) };
  };
  // places are from the sword shoulder where the trunk has carried it (before the clavicle's own reach)
  const shoulderAt = (u) => trunkAt(u).model[at(m.R.upper)].p;
  const tipOfU = (u) => {
    const g = add(shoulderAt(u), mul(val(grips, u), fa));
    return { grip: g, tip: add(g, mul(unit(val(blades, u)), blade)) };
  };
  const timing = { ...STRIKE_TIME[blow.strength ?? "light"], ...(blow.timing ?? {}) };
  const tmap = hitKey >= 0 ? strikeTime(tipOfU, keys.length, hitKey, keys[hitKey].t, length, { ...timing, speed: timing.speed * fa }) : null;
  const us = Array.from({ length: n }, (_, f) => (tmap ? tmap.u(Math.min(length, f / fps)) : umap(Math.min(length, f / fps))));
  if (tmap) blow._timing = tmap.info;
  const tipAt = us.map((u) => tipOfU(u).tip);
  const bladeAt = us.map((u) => unit(val(blades, u)));
  // how much the edge leads, eased in and out over a tenth of a second (a sudden lead turns the hand over in a frame)
  const leadRaw = us.map((u, f) => {
    const w = Math.max(0, Math.min(1, val(series((k) => k.lead), u)));
    const way = f > 0 && f < n - 1 ? len(sub(tipOfU(us[f + 1]).tip, tipOfU(us[f - 1]).tip)) : 0;
    return w * Math.min(1, way / (0.04 * fa));
  });
  const ease = Math.max(1, Math.round(0.05 * fps));
  const leadAt = leadRaw.map((_, f) => {
    let s2 = 0;
    let c = 0;
    for (let g = f - ease; g <= f + ease; g++) if (g >= 0 && g < n) (s2 += leadRaw[g]), c++;
    return s2 / c;
  });
  // two passes: the first searches each frame's elbow swivel and blade roll; their results (the elbow's place, the
  // edge's way) are smoothed over a few frames and the second solves each frame on them, so the arm cannot switch
  // between ways of holding the blade from one frame to the next
  const chosen = [];
  for (const pass of [1, 2]) {
  if (pass === 2) {
    const sig = 2.5;
    const span = Math.ceil(3 * sig);
    const smooth = (get) =>
      chosen.map((_, f) => {
        let acc = [0, 0, 0];
        let wsum = 0;
        for (let g = f - span; g <= f + span; g++) {
          if (g < 0 || g >= n) continue;
          const w = Math.exp(-((g - f) ** 2) / (2 * sig * sig));
          acc = add(acc, mul(get(chosen[g]), w));
          wsum += w;
        }
        return mul(acc, 1 / wsum);
      });
    const exS = smooth((c) => c.ex);
    const eS = smooth((c) => c.eOff);
    chosen.forEach((c, f) => ((c.exS = exS[f]), (c.eOffS = eS[f])));
    out.frames = [];
    out.model = [];
    out.tips = [];
    out.grips = [];
    out.info = { short: 0, wristMax: 0, twistMax: 0, clearMin: Infinity, clearAt: -1 };
    prev = null;
  }
  for (let f = 0; f < n; f++) {
    const u = us[f];
    let { local, model } = trunkAt(u);
    const S0 = model[at(m.R.upper)].p;
    // ── the sword hand's target ──
    const grip = add(S0, mul(val(grips, u), fa));
    const B = bladeAt[f];
    const tipWay = f > 0 && f < n - 1 ? sub(tipAt[f + 1], tipAt[f - 1]) : [0, 0, 0];
    const lead = leadAt[f];
    const keyEdge = (() => {
      // a key's edge: the nearest key at or before with one
      let best = null;
      for (let k = 0; k < keys.length; k++) if (keys[k].edge && k <= Math.round(u)) best = keys[k].edge;
      return best;
    })();
    const swivelPref = val(series((k) => k.swivel), u);
    const clavShare = val(series((k) => k.clav), u);
    const R = m.R;
    // the clavicle lifts and reaches toward the grip a little
    {
      const ic = at(R.clav);
      const iu = at(R.upper);
      const c = model[ic].p;
      const sh = model[iu].p;
      const want = sub(grip, sh);
      const shift = mul(unit(want), Math.min(len(want), 2 * fa) * clavShare * 0.12);
      const turn = qfromTo(sub(sh, c), add(sub(sh, c), shift));
      const cq = qmul(turn, model[ic].q);
      local[ic].q = qnorm(qmul(qinv(model[rig.parent[ic]].q), cq));
      model = fk(rig, local);
    }
    const s = model[at(R.upper)].p;
    const a = len(sub(rig.idleModel[at(R.fore)].p, rig.idleModel[at(R.upper)].p));
    const b = len(sub(rig.idleModel[at(R.hand)].p, rig.idleModel[at(R.fore)].p));
    const hold = rig.holdLocal;
    // the hinge's reference: down and out from the shoulder, turned by the swivel
    const down = [0, 0, -1];
    let best = null;
    const rolls = [];
    for (let r = -180; r < 180; r += ARM.rollStep) rolls.push(r);
    const swivels = [];
    for (let p = -180; p < 180; p += ARM.swivelStep) swivels.push(p);
    const bx = perp(Math.abs(B[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], B);
    const fixed = pass === 2 ? chosen[f] : null;
    for (const roll of fixed ? [0] : rolls) {
      // the hold's frame: +z the blade, +x the edge
      const ex = fixed ? perp(fixed.exS, B) : qrot(qaxis(B, roll), bx);
      const Qs = qbasis(ex, cross(B, ex), B);
      const Qh = qmul(Qs, qinv(hold.q));
      const W = sub(grip, qrot(Qh, hold.p));
      let edgeCost = 0;
      if (keyEdge && lead < 0.5) edgeCost = ARM.lead * 4 * angleOf(ex, perp(keyEdge, B)) ** 2 * 0.25;
      if (lead > 0 && len(tipWay) > 1e-6) edgeCost += lead * ARM.lead * angleOf(ex, perp(tipWay, B)) ** 2;
      for (const sw of fixed ? [0] : swivels) {
        const ik = fixed ? elbowAt(s, W, a, b, fixed.eOffS, 0) : elbowAt(s, W, a, b, down, sw + 0);
        const n0 = unit(cross(ik.u, ik.v));
        const Qu = boneAlong(sub(ik.e, s), n0, rig.hinge.R.upper);
        const Qf = boneAlong(sub(ik.w, ik.e), n0, rig.hinge.R.fore);
        const rel = qmul(qinv(Qf), Qh);
        const st = swingTwist(rel, [1, 0, 0]);
        const tw = wrap(st.twist - (rig.fistTwist ?? 0));
        let cost = 0;
        cost += Math.max(0, st.swing - ARM.wristBend) ** 2 * 0.05 + st.swing * 0.002 * st.swing * 0.1;
        cost += Math.max(0, Math.abs(tw) - ARM.twist) ** 2 * 0.05 + tw * tw * 0.0004;
        cost += edgeCost;
        cost += ARM.pref * wrap(sw - swivelPref) ** 2;
        // the elbow not up past the shoulder unless the hand is up too
        cost += Math.max(0, ik.e[2] - Math.max(s[2], W[2]) - 0.2 * fa) * 0.5;
        // the elbow not inside the trunk
        const spineP = model[at(m.spine[1])].p;
        const toE = sub(ik.e, spineP);
        const flat = Math.hypot(toE[0], toE[1]);
        cost += Math.max(0, 0.75 * fa - flat) * 2;
        // no jump from the frame before: the swivel, the blade's roll and the forearm's twist each held to it (a twist
        // that wraps past its range would flip the hand over in one frame)
        if (prev) cost += ARM.keep * (wrap(sw - prev.sw) ** 2 + wrap(roll - prev.roll) ** 2) * 0.5 + ARM.keep * 3 * Math.max(0, Math.abs(wrap(tw - prev.tw)) - 8) ** 2;
        if (!best || cost < best.cost) best = { cost, sw, roll, Qu, Qf, Qh, ik, st, tw, W, ex };
      }
    }
    prev = best;
    if (pass === 1) chosen[f] = { ex: best.ex, eOff: sub(best.ik.e, s) };
    (out.info.arm ??= []).push({ swing: best.st.swing, twist: best.tw, swivel: best.sw, roll: best.roll });
    out.info.short = Math.max(out.info.short, best.ik.short / fa);
    out.info.wristMax = Math.max(out.info.wristMax, best.st.swing);
    out.info.twistMax = Math.max(out.info.twistMax, Math.abs(best.tw));
    {
      const iu = at(R.upper);
      const iF = at(R.fore);
      const ih = at(R.hand);
      local[iu].q = qnorm(qmul(qinv(model[rig.parent[iu]].q), best.Qu));
      local[iF].q = qnorm(qmul(qinv(best.Qu), best.Qf));
      local[ih].q = qnorm(qmul(qinv(best.Qf), best.Qh));
      local[at(R.hold)] = { p: hold.p.slice(), q: hold.q.slice() };
      // the forearm's twist bone takes half the hand's roll from the idle's
      const it = at(R.twist);
      const twNow = swingTwist(qmul(qinv(best.Qf), best.Qh), [1, 0, 0]).twist;
      local[it].q = qnorm(qmul(rig.idle[it].q, qaxis([1, 0, 0], 0.5 * wrap(twNow - (rig.idleTwist?.R ?? twNow)))));
      if (rig.gripLocal) for (const [i, t] of Object.entries(rig.gripLocal)) local[i].q = t.q.slice();
    }
    // ── the off arm: its wrist to its place, the hand as the idle holds it ──
    {
      const L = m.L;
      model = fk(rig, local);
      const off = add(S0, mul(val(offs, u), fa));
      const so = model[at(L.upper)].p;
      const ao = len(sub(rig.idleModel[at(L.fore)].p, rig.idleModel[at(L.upper)].p));
      const bo = len(sub(rig.idleModel[at(L.hand)].p, rig.idleModel[at(L.fore)].p));
      const ik = elbowAt(so, off, ao, bo, [-0.3, 0.5, -1], 0);
      const n0 = unit(cross(ik.u, ik.v));
      const Qu = boneAlong(sub(ik.e, so), n0, rig.hinge.L.upper);
      const Qf = boneAlong(sub(ik.w, ik.e), n0, rig.hinge.L.fore);
      local[at(L.upper)].q = qnorm(qmul(qinv(model[rig.parent[at(L.upper)]].q), Qu));
      local[at(L.fore)].q = qnorm(qmul(qinv(Qu), Qf));
    }
    model = fk(rig, local);
    // the blade's clearance from the trunk (a capsule from the hips to the neck, its radius a forearm)
    {
      const holdM = model[at(R.hold)];
      const g = holdM.p;
      const tip = add(g, mul(qrot(holdM.q, [0, 0, 1]), blade));
      const h0 = model[hips].p;
      const h1 = model[at(m.neck)].p;
      let least = Infinity;
      let legs = Infinity;
      const P = (bn) => model[at(bn)].p;
      for (let i = 2; i <= 10; i++) {
        const q = lerp(g, tip, i / 10);
        least = Math.min(least, segDist(q, h0, h1));
        for (const side of ["R", "L"]) {
          const L = m.legs[side];
          legs = Math.min(legs, segDist(q, P(L.upper), P(L.lower)), segDist(q, P(L.lower), P(L.foot)));
        }
      }
      if (least < out.info.clearMin) (out.info.clearMin = least), (out.info.clearAt = f);
      if (legs < (out.info.legsMin ?? Infinity)) (out.info.legsMin = legs), (out.info.legsAt = f);
      out.tips.push(tip);
      out.grips.push(g);
    }
    out.frames.push(local);
    out.model.push(model);
  }
  }
  out.info.clearMin /= fa;
  out.info.legsMin /= fa;
  out.info.fps = fps;
  out.info.length = length;
  out.info.hitKey = hitKey;
  out.info.hitAt = hitKey >= 0 ? keys[hitKey].t : null;
  return out;
}

function segDist(p, a, b) {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return len(sub(p, add(a, mul(ab, t))));
}

/** The idle's own forearm-to-hand twist (so the twist bone is turned by the change only) and the fist's. */
export function calibrate(rig) {
  const m = rig.map;
  const at = rig.at;
  rig.idleTwist = {};
  for (const side of ["R", "L"]) {
    const rel = qmul(qinv(rig.idleModel[at(m[side].fore)].q), rig.idleModel[at(m[side].hand)].q);
    rig.idleTwist[side] = swingTwist(rel, [1, 0, 0]).twist;
  }
  rig.fistTwist = rig.idleTwist.R;
  return rig;
}

// ── measured as Vermintide 2's are ──

/** Model space (+x ahead, +y left) to vt2body's root space (+x right, +y ahead), lengths kept. */
const toVt2 = (v) => [-v[1], v[0], v[2]];
const C = [
  [0, -1, 0],
  [1, 0, 0],
  [0, 0, 1],
];
function matOf(q) {
  const cols = [qrot(q, [1, 0, 0]), qrot(q, [0, 1, 0]), qrot(q, [0, 0, 1])];
  const M = [0, 1, 2].map((i) => [cols[0][i], cols[1][i], cols[2][i]]);
  // C M C^T
  const CM = [0, 1, 2].map((i) => [0, 1, 2].map((j) => C[i][0] * M[0][j] + C[i][1] * M[1][j] + C[i][2] * M[2][j]));
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => CM[i][0] * C[j][0] + CM[i][1] * C[j][1] + CM[i][2] * C[j][2]));
}

/**
 * A pose (model space) as vt2body's sampleClip frame. Rotations are given as turns from the idle's (`idle`, model
 * space), so the idle's own are the identity: vt2body reads a bone's turn against the idle's (the same either way)
 * and the hips' heading from their rotation applied to ahead, which holds only for bones whose axes are Vermintide's.
 */
export function bodyFrame(rig, model, tip, idle = model) {
  const m = rig.map;
  const at = rig.at;
  const J = {
    hips: m.hips,
    spine: m.spine.at(-1),
    neck: m.neck,
    head: m.head,
    lUpleg: m.legs.L.upper,
    rUpleg: m.legs.R.upper,
    lKnee: m.legs.L.lower,
    rKnee: m.legs.R.lower,
    lFoot: m.legs.L.foot,
    rFoot: m.legs.R.foot,
    lToe: m.legs.L.toe,
    rToe: m.legs.R.toe,
    lShoulder: m.L.upper,
    rShoulder: m.R.upper,
    lElbow: m.L.fore,
    rElbow: m.R.fore,
    lHand: m.L.hand,
    rHand: m.R.hand,
    rAttach: m.R.hold,
  };
  const p = {};
  const r = {};
  for (const [k, n] of Object.entries(J)) {
    p[k] = toVt2(model[at(n)].p);
    r[k] = matOf(qmul(model[at(n)].q, qinv(idle[at(n)].q)));
  }
  p.tip = toVt2(tip);
  return { p, r, root: [0, 0, 0] };
}

/** The ready pose alone (one frame), as a blow's first key makes it. */
export function readyPose(rig, spec) {
  const one = makeBlow(rig, spec, { name: "ready", keys: [{ t: 0, at: "ready" }, { t: 1 / (spec.fps ?? 60), at: "ready" }] });
  return { local: one.frames[0], model: one.model[0], tip: one.tips[0] };
}

/** Measures that cannot be like the reference's by design, shown and not counted: why. */
export const BY_DESIGN = {
  "trunk.hipsYawCock": "the hips stay the locomotion's (the turn is the spine's)",
  "trunk.hipsYawHit": "the hips stay the locomotion's",
  "trunk.hipsYawRange": "the hips stay the locomotion's",
  "trunk.twistHit": "the spine turns alone (the reference's hips turn with it)",
  "body.hipsTravel": "no steps: a small lunge over planted feet",
  "body.hipsAhead": "no steps: a small lunge over planted feet",
  "body.hipsDrop": "no steps: a small lunge over planted feet",
  "body.footTravel": "the feet stay planted (no steps)",
  "body.steps": "the feet stay planted (no steps)",
  "body.stanceHit": "the feet are the locomotion's",
  "body.rootTravel": "no root motion either way",
  "time.blendIn": "the game's cross-fade, not the clip's",
  "time.peakVsFp": "no first-person window here",
  "time.inFp": "no first-person window here",
  "time.chainShown": "the game's chain",
  "time.settledByChain": "the game's chain",
  "time.lengthVsFp": "no first-person clip here",
  "end.fromIdle": "ends exactly on the ready pose (the reference's within 0.02 of its idle)",
  "end.poseFromIdle": "ends exactly on the ready pose (the reference's within 0.04 of its idle)",
  "trunk.spineYawCock": "signed by the blow's side (the reference's lights mix both sides)",
  "trunk.spineYawHit": "signed by the blow's side",
  "trunk.headYawCock": "signed by the blow's side",
  "trunk.headYawHit": "signed by the blow's side",
  "trunk.sideCock": "signed by the blow's side",
  "trunk.sideHit": "signed by the blow's side",
};

/** Each measure against the reference's band for the strength: entries as judge.verdicts' (where, far, say). */
export function bodyVerdicts(values, bands, strength) {
  const b = bands.strengths?.[strength];
  if (!b) throw new Error(`bodyblow: no ${strength} bands`);
  const out = [];
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined) continue;
    const band = b[key];
    const entry = { key, value, band, noise: !!BY_DESIGN[key], why: BY_DESIGN[key] };
    if (!band) {
      entry.where = "unbanded";
      out.push(entry);
      continue;
    }
    const iqr = Math.max(band.q3 - band.q1, 1e-6);
    if (value < band.p5) (entry.where = "low"), (entry.far = (band.p5 - value) / iqr);
    else if (value > band.p95) (entry.where = "high"), (entry.far = (value - band.p95) / iqr);
    else if (value < band.q1 || value > band.q3) entry.where = "edge";
    else entry.where = "in";
    out.push(entry);
  }
  return out;
}

/** A blow measured: vt2body's measures, the verdicts and the overall word. */
export function judgeBlow(rig, made, ready, bands, strength, { blendIn = 0 } = {}) {
  const frames = made.model.map((model, f) => bodyFrame(rig, model, made.tips[f], ready.model));
  const idle = bodyFrame(rig, ready.model, ready.tip, ready.model);
  const m = measureBlow(frames, idle, { fps: made.info.fps, blendIn });
  const list = bodyVerdicts(m.values, bands, strength);
  const word = overall(list, {}, { reference: "Vermintide 2's third person" });
  return { values: m.values, info: m.info, list, word };
}

/** The keys file a game reads: the bones keyed, how each is laid on, and every clip's rotations. */
export function keysFile(rig, spec, made, { digits = 4 } = {}) {
  const m = rig.map;
  const add_ = [...m.spine, m.neck, m.head];
  const stand = [m.hips, m.legs.R.upper, m.legs.R.lower, m.legs.R.foot, m.legs.L.upper, m.legs.L.lower, m.legs.L.foot];
  const abs = [m.R.clav, m.R.upper, m.R.fore, m.R.hand, m.R.hold, m.R.twist, m.L.clav, m.L.upper, m.L.fore, ...rig.names.filter((n) => m.fingers.test(n))];
  const bones = [...add_, ...abs, ...stand];
  const modes = Object.fromEntries([...add_.map((b) => [b, "add"]), ...abs.map((b) => [b, "abs"]), ...stand.map((b) => [b, "stand"])]);
  const r = (x) => Number(x.toFixed(digits));
  const qOut = (q) => {
    const s = q[3] < 0 ? -1 : 1;
    return q.map((x) => r(x * s));
  };
  const idle = Object.fromEntries(bones.map((b) => [b, qOut(rig.idle[rig.at(b)].q)]));
  const clips = {};
  for (const [name, c] of Object.entries(made)) {
    const rot = c.frames.map((local) =>
      bones.map((b) => {
        const i = rig.at(b);
        const q = modes[b] === "add" ? qmul(qinv(rig.idle[i].q), local[i].q) : local[i].q;
        return qOut(q);
      }),
    );
    const hips = rig.at(m.hips);
    const pos = c.frames.map((local) => sub(local[hips].p, rig.idle[hips].p).map(r));
    clips[name] = { frames: c.frames.length, fps: c.info.fps, length: r(c.info.length), hit: c.info.hitAt, blendIn: c.blendIn ?? 0.1, hold: !!c.hold, rot, pos };
  }
  return { what: "SMAK body blows (anim/lib/bodyblow.mjs): per clip and frame a quaternion [x, y, z, w] per bone; add = a turn on the live local, abs = the local, stand = the local while standing (pelvis offset in pos)", rig: spec.rig ?? "citizen", fps: spec.fps ?? 60, bones, modes, idle, clips };
}
