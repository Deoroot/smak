// The physical judge: one first-person attack measured as a body and a blade move, so that each measure can be
// set against a reference game's blows (anim/corpus/bands-<game>.json, Vermintide 2's unless told; lib/bands.mjs)
// and said plainly: how far the tip reaches and where,
// how the blow is phased, whether the tip keeps to a plane, whether the arm or only the wrist swings it, whether
// the joints bend as joints do, whether the hand keeps the handle, when the hit falls, how smooth it is, and
// whether the player sees it.
//
//   const m = measure(buf, { bodypart: 0, submodel: 0, seq: "attack1", delay: 0.6, range: 60 });
//   m.values["reach.hitDistance"]          // the tip's distance from the eye at the hit frame
//   verdicts(m, bands, "1h swords")        // per measure: in band or not, how far, what it means
//   verdicts(m, bands, "1h swords", "heavy") // against the heavy blows' bands where the reference keeps them
//
// Space as anims/lib/corpus.mjs says: the view model's space, +x ahead, +y left, +z up, the eye 1 unit above
// the origin. Every "from rest" is from the first frame of the model's idle (the pose the attack leaves from
// and comes back to).
import {
  readMdl,
  readMesh,
  bones as bonesOf,
  sequences,
  sequenceAt,
  poseAt,
  apply34,
} from "../../src/mdl.mjs";
import { armBones, weaponOf, EYE_ABOVE_ORIGIN } from "./corpus.mjs";
import { asModel } from "./model.mjs";
import { FOV, NEAR } from "./view.mjs";

const DEG = 180 / Math.PI;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => {
  const l = len(a);
  return l > 1e-9 ? scale(a, 1 / l) : [0, 0, 0];
};
const origin = (m) => [m[0][3], m[1][3], m[2][3]];
/** A point as the eye sees it: from the eye, not from the model's origin. */
const fromEye = (p) => [p[0], p[1], p[2] - EYE_ABOVE_ORIGIN];

// ── rotations: the 3x3 part of a bone's matrix ─────────────────────────────
const rot = (m) => [0, 1, 2].map((r) => [m[r][0], m[r][1], m[r][2]]);
const tr = (a) => [0, 1, 2].map((r) => [a[0][r], a[1][r], a[2][r]]);
const mm = (a, b) => [0, 1, 2].map((r) => [0, 1, 2].map((c) => a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c]));
const mv = (a, v) => [0, 1, 2].map((r) => a[r][0] * v[0] + a[r][1] * v[1] + a[r][2] * v[2]);
/** A rotation's angle, degrees. */
const angleOf = (r) => Math.acos(Math.max(-1, Math.min(1, (r[0][0] + r[1][1] + r[2][2] - 1) / 2))) * DEG;
/** A rotation as a unit quaternion [w, x, y, z]. */
function quatOf(m) {
  const t = m[0][0] + m[1][1] + m[2][2];
  let q;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    q = [s / 4, (m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s];
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    q = [(m[2][1] - m[1][2]) / s, s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s];
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    q = [(m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s];
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    q = [(m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4];
  }
  return q[0] < 0 ? q.map((v) => -v) : q;
}
/** A rotation split into a twist about `axis` and the swing left: both in degrees, the twist signed. */
function swingTwist(m, axis) {
  const [w, x, y, z] = quatOf(m);
  const p = x * axis[0] + y * axis[1] + z * axis[2];
  let twist = 2 * Math.atan2(p, w) * DEG;
  if (twist > 180) twist -= 360;
  if (twist < -180) twist += 360;
  const swing = 2 * Math.acos(Math.min(1, Math.hypot(w, p))) * DEG;
  return { swing, twist };
}
/** A rotation of `angle` degrees about a unit `axis`, as a matrix. */
function rotationAbout(axis, angle) {
  const [x, y, z] = axis;
  const c = Math.cos(angle / DEG);
  const s = Math.sin(angle / DEG);
  const k = 1 - c;
  return [
    [c + x * x * k, x * y * k - z * s, x * z * k + y * s],
    [y * x * k + z * s, c + y * y * k, y * z * k - x * s],
    [z * x * k - y * s, z * y * k + x * s, c + z * z * k],
  ];
}

/**
 * An elbow's and a wrist's turns (the forearm in the upper arm, Le; the hand in the forearm, Lh) with the forearm's
 * roll about its own length (from rest: L0e, faAxis in its space) counted at the wrist: a forearm's roll is the
 * wrist's turning over (pronation), whichever bone a rig keeps it on (a GoldSrc arm's hand, an arm whose generator
 * shares it with the forearm, swing.mjs's shareRoll). The hand's place is the same either way.
 */
function rollToWrist(Le, Lh, L0e, faAxis) {
  const T = rotationAbout(faAxis, swingTwist(mm(tr(L0e), Le), faAxis).twist);
  return { Le: mm(Le, tr(T)), Lh: mm(T, Lh) };
}

/** The axis and angle (radians) of a rotation. */
function axisAngle(r) {
  const angle = Math.acos(Math.max(-1, Math.min(1, (r[0][0] + r[1][1] + r[2][2] - 1) / 2)));
  const axis = [r[2][1] - r[1][2], r[0][2] - r[2][0], r[1][0] - r[0][1]];
  return { axis: unit(axis), angle };
}

/** A tip moving across its blade less than this share of its speed is thrusting: its edge is not judged. */
const EDGE_ACROSS = 0.5;
/** The share of a weapon's length, from the butt, past which its points are its striking head (a blade, an axe's bit). */
const HEAD_FROM = 0.6;
/** A head this much wider than thick (the spread of its points across the length) has an edge. */
const FLAT = 2;

/**
 * Which way a weapon's edge faces: the widest way across its head (its points past HEAD_FROM of the way from the
 * butt to the tip), square to its length, a unit direction in the frame the points, tip and butt are in; null for a
 * head about as thick as wide (a mace, a haft, a fist) or too few points to tell. A sword's two edges lie along it,
 * either way; an axe's bit faces along it.
 */
export function edgeOf(points, tip, butt) {
  const axis = sub(tip, butt);
  const L2 = dot(axis, axis);
  if (!(L2 > 0) || !points?.length) return null;
  const ax = scale(axis, 1 / Math.sqrt(L2));
  const head = points
    .filter((p) => dot(sub(p, butt), axis) / L2 >= HEAD_FROM)
    .map((p) => {
      const d = sub(p, butt);
      return sub(d, scale(ax, dot(d, ax)));
    });
  if (head.length < 8) return null;
  const mean = scale(head.reduce(add), 1 / head.length);
  const cov = [0, 1, 2].map((r) => [0, 1, 2].map((k) => head.reduce((s, p) => s + (p[r] - mean[r]) * (p[k] - mean[k]), 0) / head.length));
  const [, thin, wide] = eigen3(cov);
  if (!(wide.value > 0) || Math.sqrt(wide.value / Math.max(thin.value, 1e-12)) < FLAT) return null;
  return unit(wide.vector);
}

/** Eigen of a symmetric 3x3 (Jacobi): { values (ascending), vectors (columns as arrays) }. */
function eigen3(a) {
  const m = a.map((r) => [...r]);
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = m[0][1] ** 2 + m[0][2] ** 2 + m[1][2] ** 2;
    if (off < 1e-18) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(m[p][q]) < 1e-15) continue;
      const th = (m[q][q] - m[p][p]) / (2 * m[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const [mkp, mkq] = [m[k][p], m[k][q]];
        m[k][p] = c * mkp - s * mkq;
        m[k][q] = s * mkp + c * mkq;
      }
      for (let k = 0; k < 3; k++) {
        const [mpk, mqk] = [m[p][k], m[q][k]];
        m[p][k] = c * mpk - s * mqk;
        m[q][k] = s * mpk + c * mqk;
      }
      for (let k = 0; k < 3; k++) {
        const [vkp, vkq] = [v[k][p], v[k][q]];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return [0, 1, 2]
    .map((i) => ({ value: m[i][i], vector: [v[0][i], v[1][i], v[2][i]] }))
    .sort((x, y) => x.value - y.value);
}

/** A weighted median (weights need not sum to one). */
function weightedMedian(values, weights) {
  const pairs = values.map((v, i) => [v, weights[i]]).filter((p) => Number.isFinite(p[0]) && p[1] > 0);
  if (!pairs.length) return null;
  pairs.sort((a, b) => a[0] - b[0]);
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let acc = 0;
  for (const [v, w] of pairs) if ((acc += w) >= total / 2) return v;
  return pairs.at(-1)[0];
}

// ── the model's pieces ─────────────────────────────────────────────────────

/**
 * The idle an attack leaves from and returns to: the one with the attack's own prefix and suffix about its verb
 * ("eattack2" -> "eidle1", "nh_attack3" -> "nh_idle1", "ANIM_ATTACK1_mithral" -> "ANIM_IDLE1_mithral",
 * "r_fists_punch" -> "r_fists_idle1"), else the first idle without a prefix, else the first idle, else 0.
 */
export function idleFor(buf, seqName = "") {
  const list = asModel(buf).sequences.map((s, i) => ({ name: s.name.toLowerCase(), i }));
  const idles = list.filter((s) => /idle/.test(s.name));
  if (!idles.length) return 0;
  const VERB = /(attack|punch|thrust|swing|stab|poke|strike|spin|groundhit)[a-z]*\d*/;
  const m = VERB.exec(seqName.toLowerCase());
  const [pre, post] = m ? [seqName.toLowerCase().slice(0, m.index), seqName.toLowerCase().slice(m.index + m[0].length)] : ["", ""];
  const shape = (s) => {
    const k = s.name.indexOf("idle");
    return { pre: s.name.slice(0, k), post: s.name.slice(k + 4).replace(/^\d*/, "") };
  };
  const exact = idles.filter((s) => shape(s).pre === pre && shape(s).post === post);
  const samePre = idles.filter((s) => shape(s).pre === pre);
  const bare = idles.filter((s) => shape(s).pre === "");
  return (exact[0] ?? samePre[0] ?? bare[0] ?? idles[0]).i;
}

/** The triangles of what the player sees: the asked submodel of its bodypart, the first of every other. */
function shownTriangles(buf, bodypart, submodel) {
  const M = asModel(buf);
  const tris = [];
  M.bodyparts.forEach((bp, b) => {
    const m = b === bodypart ? submodel : 0;
    if (bp.models[m]) for (const t of M.tris(b, m)) tris.push(t);
  });
  return tris;
}

/** Is `bone` below `top` (or `top`)? */
/**
 * The handle's line in a hand's own space, frame by frame: { held, lines: [{ off, along }] }. `held` is where the
 * hand holds it at the blow's first frame (the point of the line nearest the wrist, in the hand's space); `off`
 * how far the line is from it in each frame (the weapon floating or turning in the hand), `along` where along
 * the line it falls (the shaft sliding through the fist, as a polearm's may). From the blow's own first frame,
 * not the idle's: a grip changed between them is a seam (seam.*), and Source blends it away. `from`: the frame the
 * grip is taken at instead (the first one the engine shows unblended).
 */
function handleLinesOf(poses, hand, tipAt, buttAt, from = 0) {
  const first = poses[from];
  const [b0, t0] = [buttAt(first), tipAt(first)];
  const axis0 = sub(t0, b0);
  const k = Math.max(0, Math.min(1, dot(sub(origin(first[hand]), b0), axis0) / dot(axis0, axis0)));
  const held = toBone(first[hand], add(b0, scale(axis0, k)));
  const lines = poses.map((p) => {
    const b = toBone(p[hand], buttAt(p));
    const axis = unit(sub(toBone(p[hand], tipAt(p)), b));
    const d = sub(held, b);
    const along = dot(d, axis);
    return { off: len(sub(d, scale(axis, along))), along };
  });
  return { held, lines };
}

function isBelow(list, bone, top) {
  for (let b = bone; b >= 0; b = list[b].parent) if (b === top) return true;
  return false;
}

/**
 * A hand's fingers: { thumb, index, middle, ring, pinky } each its joints from the knuckle out (bone indices), the
 * bones between the hand and the knuckle first (Vermintide 2's palm bones). Named as Vermintide 2's rig names them
 * (j_righthandindex1-3, j_rightinhandindex) or a biped's (Bip01 R Finger1, Finger11, Finger12; Finger0 the thumb).
 * A finger the rig lacks is left out; a hand with neither naming has none.
 */
export function fingersOf(list, hand) {
  const NAMES = ["thumb", "index", "middle", "ring", "pinky"];
  const out = {};
  // a hand's side by its name ("Bip01 R Hand", "j_righthand"): a finger of the other side's is not its (v_2hswords
  // hangs its left hand from the right)
  const sideOf = (n) => /(?:^|[\s_.])([RL])(?:[\s_]|$)/.exec(n)?.[1] ?? (/right/i.test(n) ? "R" : /left/i.test(n) ? "L" : null);
  const side = sideOf(list[hand].name);
  const below = list
    .map((b, i) => i)
    .filter((i) => i !== hand && isBelow(list, i, hand) && (!side || !sideOf(list[i].name) || sideOf(list[i].name) === side));
  for (const [k, name] of NAMES.entries()) {
    const joints = below
      .filter((i) => new RegExp(`hand${name}\\d$`, "i").test(list[i].name) || new RegExp(`Finger${k}\\d?$`).test(list[i].name))
      .sort((x, y) => (isBelow(list, y, x) ? -1 : isBelow(list, x, y) ? 1 : 0));
    if (joints.length < 2) continue;
    const palm = [];
    for (let b = list[joints[0]].parent; b >= 0 && b !== hand; b = list[b].parent) palm.unshift(b);
    out[name] = [...palm, ...joints];
  }
  return out;
}

/** The four fingers (the thumb is not one): a hand's curl is theirs. */
const CURLERS = ["index", "middle", "ring", "pinky"];
/** A joint's last bone has no child to say where the finger ends: the end is this share of the bone before's length on. */
const NAIL = 0.8;

/**
 * A finger's points at a pose: the hand's origin, each joint's, and the end past the last (along the last bone as
 * the one before it lies in its parent: rigs keep a joint's offset along its parent's length).
 */
function fingerPoints(pose, hand, joints) {
  const pts = [origin(pose[hand]), ...joints.map((j) => origin(pose[j]))];
  const [a, b] = [joints.at(-2), joints.at(-1)];
  const local = toBone(pose[a], origin(pose[b]));
  const along = mv3(pose[b], local);
  pts.push(add(pts.at(-1), scale(along, NAIL)));
  return pts.filter((p, i) => i === 0 || len(sub(p, pts[i - 1])) > 1e-4);
}
const mv3 = (m, d) => [0, 1, 2].map((r) => m[r][0] * d[0] + m[r][1] * d[1] + m[r][2] * d[2]);

/**
 * A hand's shape at a pose, whatever the rig's proportions: angles and ratios of the hand's own points, never its
 * bones' rotations (two rigs' rest poses differ). { curl: the four fingers' mean bend, the turns between each
 * finger's segments from the hand's origin out (0 flat, about 270 a fist), curls: each finger's, stagger: the
 * pinky's curl less the index's, thumbAlong: the thumb's last segment against the handle (0 along it, pressed up
 * the grip; 90 across, wrapped round), wrap: the fingertips' mean distance from the handle's line over the
 * knuckles' (under 1 the fingers close round it) }. `axis`: the handle's [butt, tip] at that pose, or null.
 */
export function handShape(pose, hand, fingers, axis = null) {
  const curls = {};
  const turn = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) * DEG;
  for (const name of CURLERS) {
    if (!fingers[name]) continue;
    const p = fingerPoints(pose, hand, fingers[name]);
    let sum = 0;
    for (let i = 2; i < p.length; i++) sum += turn(sub(p[i - 1], p[i - 2]), sub(p[i], p[i - 1]));
    curls[name] = sum;
  }
  const have = Object.values(curls);
  if (!have.length) return null;
  const out = { curl: have.reduce((x, y) => x + y, 0) / have.length, curls, stagger: curls.index !== undefined && curls.pinky !== undefined ? curls.pinky - curls.index : null, thumbAlong: null, wrap: null };
  if (axis) {
    const [b0, t0] = axis;
    const ax = unit(sub(t0, b0));
    const fromLine = (q) => {
      const d = sub(q, b0);
      return len(sub(d, scale(ax, dot(d, ax))));
    };
    if (fingers.thumb) {
      const p = fingerPoints(pose, hand, fingers.thumb);
      out.thumbAlong = Math.acos(Math.min(1, Math.abs(dot(unit(sub(p.at(-1), p.at(-2))), ax)))) * DEG;
    }
    let [tips, knuckles] = [0, 0];
    for (const name of CURLERS) {
      if (!fingers[name]) continue;
      const p = fingerPoints(pose, hand, fingers[name]);
      tips += fromLine(p.at(-1));
      // the knuckle: three joints and the end back (the palm's bones, where a rig has them, before it)
      knuckles += fromLine(p.at(-4) ?? p[1]);
    }
    out.wrap = knuckles > 1e-6 ? tips / knuckles : null;
  }
  return out;
}

/** A model-space point in a bone's space (the bone's matrix is rigid). */
function toBone(m, p) {
  const d = [p[0] - m[0][3], p[1] - m[1][3], p[2] - m[2][3]];
  return [0, 1, 2].map((c) => m[0][c] * d[0] + m[1][c] * d[1] + m[2][c] * d[2]);
}

/**
 * The fist of a hand as a striking point: the vertex below that hand's bone farthest from the elbow at rest
 * (the knuckles), kept on its bone. For martial arts, where the "weapon" submodel is the arms themselves.
 */
function fistOf(tris, list, arms, side, rest) {
  const hand = arms[side].hand;
  const elbow = origin(rest[arms[side].elbow]);
  let best = null;
  let far = -1;
  for (const t of tris)
    for (const v of t)
      if (isBelow(list, v.bone, hand)) {
        const d = len(sub(apply34(rest[v.bone], v.p), elbow));
        if (d > far) [best, far] = [v, d];
      }
  return best ? { bone: best.bone, p: best.p } : null;
}

// ── the measure ────────────────────────────────────────────────────────────

/** Speeds below this share of the peak end the strike; below FOLLOW the follow-through. */
export const STRIKE = 0.4;
export const FOLLOW = 0.15;
/**
 * Lengths are the rig's own: in forearms (elbow to wrist at rest, both arms' mean), which every rig has, so a
 * band made from one game holds for a model of any scale (Vermintide's metres, GoldSrc's units, anyone's rig).
 * The limits below were first set in MSR's units, whose forearm is REF_FOREARM of them.
 */
export const REF_FOREARM = 8.84;
/** MSR's median full reach in forearms: the tip measures' tolerances were carried over at it. */
export const REF_REACH = 5.83;
/** The off hand is on the handle when its wrist is this near the handle's line at rest (forearms). */
const TWO_HANDS = 12 / REF_FOREARM;
/** The off hand this near the handle's line (forearms) holds it: Vermintide 2's both-hands heavies 0.1 to 0.4 at the hit. */
const GRAB = 0.5;
/** Another hand holds the weapon only when it keeps to the handle this much better than the one it hangs from. */
const HAND_MARGIN = 0.5 / REF_FOREARM;
/** A step this many times its neighbours', and longer than JUMP_LEN (forearms), is a jump. */
const JUMP_RATIO = 3;
const JUMP_LEN = 3 / REF_FOREARM;
/** A step below this (forearms; half a GoldSrc unit) counts as still when a jump is set against its neighbours. */
const STILL_STEP = 0.5 / REF_FOREARM;
/** A step this long or less (forearms; a GoldSrc unit) is too small to be a jump at all. */
const LEAST_JUMP = 1 / REF_FOREARM;
/** A wrist moving less than this over the strike (forearms) is still: the tip's travel over it is capped. */
const STILL_WRIST = 0.05 / REF_FOREARM;
/** The view's near plane, in forearms (GoldSrc's 4 units at MSR's scale). */
const NEAR_LEN = NEAR / REF_FOREARM;
/**
 * A pop: a point that leaves its way in one step and comes back to it in another, within POP_FRAMES frames, with
 * no slowing at either end. Every step is taken less the window's own drift (the way from its first frame to its
 * last, shared out), so a pop in a moving wind-up counts as one on a still arm: the step out and the step back
 * each longer than POP_LEN and against each other, and the steps between them, before and after them, less than
 * half as long. A blow's own reversals (the wind-up into the strike, a bounce off the target) slow into the turn
 * or come out of motion; a fast blow keeps its way and is no pop, however far it goes in a frame (a snap strike,
 * a smear frame).
 */
const POP_FRAMES = 3;
const POP_LEN = 3 / REF_FOREARM;
/**
 * A wrong pose is seen when it is held on screen this long (seconds): a state shown for a frame or two in a fast
 * blow goes by unseen (Valve's own shipped one-frame slips), one held through a strike does not. A glitch in the
 * motion (a pop, a flip) is seen in a single frame, and is counted whenever it is on screen.
 */
const HOLD = 0.1;
/**
 * Speeds and smoothness are taken over this span of time, whatever a game's frame rate (MSR samples at 20 fps, a
 * Vermintide 2 attack at 50 to 90): a finer sampling catches higher peaks and more jerk, so speeds taken frame to
 * frame compare rates, not movements. One frame at 20 fps, the coarsest of the corpus; frames between are
 * interpolated. Glitches (pops, flips, jumps) stay frame by frame: a frame is what the player sees.
 */
export const SPEED_SPAN = 0.05;
/** An elbow bent this much or more is clearly bent: its plane turning over there is a flip, not a straightening. */
const BENT = 25;
/** The forearm passing within this of the upper arm's line (degrees) passes through straight. */
const STRAIGHT = 5;
/** A turn of the blade smaller than this between two frames is no rotation: the blade only moves along. */
const STILL_TURN = 0.3 / DEG;

/**
 * Every measure of one sequence: { info, values: { "group.name": number | null }, notes, path }.
 * opts: { bodypart, submodel, seq (name or number), delay (MELEE_DMG_DELAY, s), range (MELEE_RANGE), fps
 * (when the item plays it at another rate), idle (sequence, else idleFor), fist (true: the striking point is a
 * fist, not a weapon's tip), settle (seconds the engine crossfades into the sequence: the grip is taken and the
 * faults counted after it), twoHanded (true: the off hand belongs on the handle, as it is at rest; else it
 * is taken to when it is there at rest and for most of the blow), fov, aspect (4/3), near (in the model's units; else NEAR_LEN forearms) }.
 * Lengths and speeds come out in forearms (MEASURES' units), whatever the model's scale.
 */
export function measure(buf, opts = {}) {
  const { bodypart = 0, submodel = 0, delay = null, range = null, fov = FOV, aspect = 4 / 3 } = opts;
  const M = asModel(buf);
  const index = typeof opts.seq === "number" ? opts.seq : M.sequenceAt(opts.seq);
  const seqs = M.sequences;
  const s = seqs[index];
  if (!s || index < 0) throw new Error(`no sequence ${opts.seq}`);
  const fps = opts.fps ?? s.fps;
  const n = s.frames;
  // settle: an engine that crossfades into the sequence (Vermintide's state machines: the blend-in its transition
  // sets) shows its first frames mixed with the pose before; the grip is taken after it and faults counted from it
  const settle = Math.max(0, Math.min(n - 1, Math.round((opts.settle ?? 0) * fps)));
  // where the next attack may cut in (seconds; a combo's chain point): what plays after it is seldom seen, so the
  // recovery is counted up to it. Unset, the sequence plays to its end.
  const cut = opts.cut === null || opts.cut === undefined ? n - 1 : Math.max(0, Math.min(n - 1, Math.round(opts.cut * fps)));
  const list = M.bones;
  const arms = opts.arms ? armsByName(list, opts.arms) : armBones(buf, { bodypart, submodel });
  // arms cut off at the elbow (The Specialists' view models: forearm and hand only) ride their forearm's parent
  // as a stand-in shoulder; what it would make up (the upper arm, the elbow's bend, the shoulder) is left out
  const forearmOnly = [];
  for (const k of ["R", "L"])
    if (arms[k].hand !== undefined && arms[k].elbow !== undefined && arms[k].shoulder === undefined && list[arms[k].elbow].parent >= 0) {
      arms[k].shoulder = list[arms[k].elbow].parent;
      forearmOnly.push(k);
    }
  const sides = ["R", "L"].filter((k) => arms[k].hand !== undefined && arms[k].elbow !== undefined && arms[k].shoulder !== undefined);
  if (!sides.length) throw new Error("no arm bones (hand, forearm, upper arm) to judge");
  const idle = opts.idle === undefined ? idleFor(buf, s.name) : typeof opts.idle === "number" ? opts.idle : M.sequenceAt(opts.idle);
  const rest = M.pose(idle, 0);
  // the unit: the forearm at rest, both arms' mean; the limits in forearms become the model's units by it
  const F = sides.reduce((sum, k) => sum + len(sub(origin(rest[arms[k].hand]), origin(rest[arms[k].elbow]))), 0) / sides.length || 1;
  const near = opts.near ?? NEAR_LEN * F;
  const poses = Array.from({ length: n }, (_, f) => M.pose(index, f));
  const tris = shownTriangles(buf, bodypart, submodel);
  const notes = [];
  const handled = new Map();
  const handleLines = (k) => {
    if (!handled.has(k)) handled.set(k, handleLinesOf(poses, arms[k].hand, tipAt, buttAt, settle));
    return handled.get(k);
  };

  // the striking point: the weapon's tip, or for bare hands the fist that goes deepest
  // a weapon given (a model without meshes: Vermintide's, whose weapon is measured from its own unit): { name,
  // boneName, bones, length, hand, tip: { bone, p }, butt: { bone, p } }
  const weapon = opts.fist ? { empty: true } : opts.weapon ?? weaponOf(buf, { bodypart, submodel, arms });
  let tipAt;
  let gripAt = null;
  let buttAt = null;
  let body; // the bone the striking point rides: its turn is the blade's
  let side;
  let fist = Boolean(opts.fist) || weapon.empty;
  if (fist) {
    const fists = sides.map((k) => ({ k, f: fistOf(tris, list, arms, k, rest) })).filter((x) => x.f);
    if (!fists.length) throw new Error("no fist to follow");
    const deepest = (x) => Math.max(...poses.map((p) => apply34(p[x.f.bone], x.f.p)[0]));
    const chosen = fists.reduce((a, b) => (deepest(b) > deepest(a) ? b : a));
    side = chosen.k;
    body = chosen.f.bone;
    tipAt = (p) => apply34(p[chosen.f.bone], chosen.f.p);
    notes.push(`bare hands: the striking point is the ${side} fist`);
  } else {
    body = weapon.tip.bone;
    tipAt = (p) => apply34(p[weapon.tip.bone], weapon.tip.p);
    buttAt = (p) => apply34(p[weapon.butt.bone], weapon.butt.p);
    side = weapon.hand && sides.includes(weapon.hand) ? weapon.hand : sides[0];
    // hand: "auto" (the default): the hand that keeps to the handle through the blow holds it (L4D2's bat is held
    // by the left, its right let go in the follow-through); "R" or "L" says which
    if ((opts.hand ?? "auto") === "auto" && sides.length > 1) {
      // the hand the weapon hangs from (or the nearest at rest) unless another keeps to the handle clearly better
      const most = (k) => Math.max(...handleLines(k).lines.map((l) => l.off));
      const hangs = side;
      for (const k of sides) if (most(k) < most(side) - HAND_MARGIN * F) side = k;
      if (side !== hangs) notes.push(`held by the ${side} hand (it keeps to the handle; the ${hangs} lets go)`);
    } else if (opts.hand === "R" || opts.hand === "L") side = opts.hand;
  }
  const arm = arms[side];
  const other = sides.find((k) => k !== side);
  // where the fist closes on the handle: the point of the handle's line nearest the wrist at the blow's first frame
  if (buttAt) {
    const q = handleLines(side).held;
    gripAt = (p) => apply34(p[arm.hand], q);
  }

  const tips = poses.map(tipAt);
  const joint = (role, k = side) => poses.map((p) => origin(p[arms[k][role]]));
  const wrists = joint("hand");
  const elbows = joint("elbow");
  const shoulders = joint("shoulder");
  // what the player sees: Hor+, a wider screen sees more across, the same up and down
  const tx = Math.tan(fov / DEG / 2) * (aspect / (4 / 3));
  const ty = Math.tan(fov / DEG / 2) / (4 / 3);
  const onScreen = (p) => {
    const q = fromEye(p);
    return q[0] > near && Math.abs(q[1]) / q[0] <= tx && Math.abs(q[2]) / q[0] <= ty;
  };

  // ── speeds and phases ──
  // a point of a track at a fractional frame, between the frames about it
  const atFrame = (track, f) => {
    const g = Math.max(0, Math.min(n - 1, f));
    const i = Math.min(n - 2, Math.floor(g));
    if (i < 0) return track[0];
    const t = g - i;
    return [0, 1, 2].map((k) => track[i][k] * (1 - t) + track[i + 1][k] * t);
  };
  const half = (SPEED_SPAN * fps) / 2; // half the span, in frames
  const spanSpeeds = (track) =>
    track.map((_, i) => {
      const a = Math.max(0, i - half);
      const b = Math.min(n - 1, i + half);
      return b > a ? (len(sub(atFrame(track, b), atFrame(track, a))) / (b - a)) * fps : 0;
    });
  const speeds = spanSpeeds(tips);
  const peak = speeds.reduce((best, v, i) => (v > speeds[best] ? i : best), 0);
  const top = speeds[peak] || 1e-9;
  let a = peak;
  while (a > 0 && speeds[a - 1] >= STRIKE * top) a--;
  let b = peak;
  while (b < n - 1 && speeds[b + 1] >= STRIKE * top) b++;
  let c = b;
  while (c < n - 1 && speeds[c + 1] >= FOLLOW * top) c++;
  let w = a;
  while (w > 0 && speeds[w - 1] >= FOLLOW * top) w--;
  const strikeFrames = [];
  for (let i = a; i <= b; i++) strikeFrames.push(i);
  const phaseOf = (f) => (f < a ? "wind-up" : f <= b ? "strike" : f <= c ? "follow-through" : "recovery");

  const v = {};
  const put = (key, value) => (v[key] = value === null || value === undefined || !Number.isFinite(value) ? null : Number(value.toFixed(4)));

  // ── reach ──
  const eye = (p) => len(fromEye(p));
  const offSight = (p) => {
    const q = fromEye(p);
    return Math.atan2(Math.hypot(q[1], q[2]), q[0]) * DEG;
  };
  const exact = delay === null ? null : delay * fps;
  const hit = exact === null ? null : Math.max(0, Math.min(n - 1, Math.round(exact)));
  const deepest = tips.reduce((best, t, i) => (t[0] > tips[best][0] ? i : best), 0);
  if (hit !== null) {
    put("reach.hitDistance", eye(tips[hit]));
    put("reach.hitDepth", tips[hit][0]);
    put("reach.hitAngle", offSight(tips[hit]));
    if (range) put("reach.hitOverRange", eye(tips[hit]) / range);
  }
  put("reach.maxDepth", tips[deepest][0]);
  put("reach.deepDistance", eye(tips[deepest]));
  put("reach.deepAngle", offSight(tips[deepest]));

  // ── phases ──
  put("phase.windup", a / fps);
  put("phase.strike", (b - a + 1) / fps);
  put("phase.follow", (c - b) / fps);
  put("phase.recovery", Math.max(0, cut - c) / fps);
  put("phase.strikeShare", (b - a + 1) / n);
  put("phase.peakSpeed", top);
  const strikeWay = sub(tips[b], tips[a]);
  put("phase.windupBack", len(strikeWay) > 1e-6 ? -dot(sub(tips[a], tips[0]), unit(strikeWay)) / len(strikeWay) : null);

  // ── strike plane ──
  const lo = Math.max(0, Math.min(a, b - 2));
  const hi = Math.min(n - 1, Math.max(b, lo + 2));
  const pts = tips.slice(lo, hi + 1);
  const mean = scale(pts.reduce(add), 1 / pts.length);
  const cov = [0, 1, 2].map((r) => [0, 1, 2].map((k) => pts.reduce((sum, p) => sum + (p[r] - mean[r]) * (p[k] - mean[k]), 0) / pts.length));
  const eig = eigen3(cov);
  let arc = 0;
  for (let i = lo + 1; i <= hi; i++) arc += len(sub(tips[i], tips[i - 1]));
  const rms = Math.sqrt(Math.max(0, eig[0].value));
  put("plane.residual", rms);
  put("plane.flatness", arc > 1e-6 ? rms / arc : null);
  put("strike.arc", arc);
  put("strike.turn", angleOf(mm(rot(poses[hi][body]), tr(rot(poses[lo][body])))));
  // the plane's tilt: its normal against up; 0 a flat (horizontal) sweep, 90 an upright (vertical) one
  put("plane.tilt", Math.acos(Math.min(1, Math.abs(eig[0].vector[2]))) * DEG);
  // the eye against the plane, seen from the stroke's middle: 0 when the plane passes through the eye, so that the
  // stroke is seen edge-on, a straight line across the screen; more, a curve seen from beside its plane
  const toEye = sub([0, 0, EYE_ABOVE_ORIGIN], mean);
  put("plane.eyeAngle", len(toEye) > 1e-6 ? Math.asin(Math.min(1, Math.abs(dot(toEye, eig[0].vector)) / len(toEye))) * DEG : null);

  // ── the edge ──
  // the angle between the blade's edge and the way the tip moves across the blade, over the strike, weighted by
  // that motion: 0 the edge leads (a cut), 90 the flat leads (a slap). Frames where the tip moves mostly along the
  // blade (a thrust) say nothing of the edge and are left out
  const edgeFrames = [];
  if (weapon.edge && buttAt && !fist) {
    let sum = 0;
    let weight = 0;
    for (const f of strikeFrames) {
      if (f < 1 || f > n - 2) continue;
      const way = sub(tips[f + 1], tips[f - 1]);
      const ax = unit(sub(tips[f], buttAt(poses[f])));
      const across = sub(way, scale(ax, dot(way, ax)));
      if (len(across) < EDGE_ACROSS * len(way)) continue;
      const e = mv(rot(poses[f][weapon.edge.bone]), weapon.edge.d);
      const edge = unit(sub(e, scale(ax, dot(e, ax))));
      const angle = Math.acos(Math.min(1, Math.abs(dot(edge, unit(across))))) * DEG;
      edgeFrames.push({ f, angle });
      sum += angle * len(across);
      weight += len(across);
    }
    put("edge.lead", weight > 0 ? sum / weight : null);
  }

  // ── fan and pivot ──
  let tipTravel = 0;
  let wristTravel = 0;
  for (let i = lo + 1; i <= hi; i++) {
    tipTravel += len(sub(tips[i], tips[i - 1]));
    wristTravel += len(sub(wrists[i], wrists[i - 1]));
  }
  // capped: a hand that does not move at all would make it endless
  put("fan.travelRatio", Math.min(100, tipTravel / Math.max(wristTravel, STILL_WRIST * F)));
  const forearm = len(sub(origin(rest[arm.hand]), origin(rest[arm.elbow])));
  const upperarm = len(sub(origin(rest[arm.elbow]), origin(rest[arm.shoulder])));
  // the blow's full reach, the unit of the tip's measures: the arm and the weapon from the wrist to the tip, at
  // rest (an arm cut at the elbow: its upper arm taken as long as the forearm)
  const fullReach = (forearmOnly.includes(side) ? 2 * forearm : upperarm + forearm) + len(sub(tipAt(rest), origin(rest[arm.hand])));
  // the blade's rotation axis in each strike frame (the screw axis of its bone between the frames about it):
  // how far the wrist, the elbow and the shoulder are from it says what the blow turns about
  const pivots = [];
  const weights = [];
  const nearestJoint = { wrist: 0, elbow: 0, shoulder: 0, beyond: 0 };
  // for the pictures: each strike frame's centre of turn (null when the blade only moves along) and its joint
  const pivotAt = [];
  for (const i of strikeFrames) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    if (i1 === i0) continue;
    const dt = (i1 - i0) / fps;
    const turn = axisAngle(mm(rot(poses[i1][body]), tr(rot(poses[i0][body]))));
    let dw;
    let toAxis;
    let centre = null;
    if (turn.angle < STILL_TURN * (i1 - i0)) {
      dw = Infinity; // the blade only moves along: no pivot near the body
      toAxis = () => Infinity;
    } else {
      const omega = scale(turn.axis, turn.angle / dt);
      const p = tips[i];
      const vel = scale(sub(tips[i1], tips[i0]), 1 / dt);
      centre = add(p, scale(cross(omega, vel), 1 / dot(omega, omega)));
      toAxis = (q) => len(cross(sub(q, centre), turn.axis));
      dw = toAxis(wrists[i]);
    }
    pivots.push(Math.min(dw / Math.max(forearm, 1), 10));
    weights.push(speeds[i]);
    const d = { wrist: dw, elbow: toAxis(elbows[i]), shoulder: toAxis(shoulders[i]) };
    const best = Object.entries(d).sort((x, y) => x[1] - y[1])[0];
    // nearer the shoulder than an upper arm's length or beyond the body: the torso or a translation
    nearestJoint[best[1] > upperarm + forearm ? "beyond" : best[0]] += speeds[i];
    pivotAt.push({ frame: i, centre, joint: best[1] > upperarm + forearm ? "beyond" : best[0] });
  }
  put("fan.pivot", weightedMedian(pivots, weights));
  const pivotJoint = Object.entries(nearestJoint).sort((x, y) => y[1] - x[1])[0][0];

  // ── joints, the striking arm (and the other, for its faults) ──
  const armMeasures = (k) => {
    const A = arms[k];
    const R = (p, bone) => rot(p[bone]);
    const uaRest = R(rest, A.shoulder);
    const faRest = R(rest, A.elbow);
    const hRest = R(rest, A.hand);
    const parentOf = list[A.shoulder].parent;
    const parentRest = parentOf >= 0 ? R(rest, parentOf) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    // directions in the upper arm's own space: the upper arm, the forearm (elbow to wrist)
    const inUA = (p, d) => unit(mv(tr(R(p, A.shoulder)), d));
    const uaDir = inUA(rest, sub(origin(rest[A.elbow]), origin(rest[A.shoulder])));
    const faDir = (p) => inUA(p, sub(origin(p[A.hand]), origin(p[A.elbow])));
    // the elbow's bend axis: at rest, else (an arm straight at rest) the most bent frame's
    let hinge = cross(uaDir, faDir(rest));
    if (len(hinge) < Math.sin(10 / DEG)) {
      const most = poses.reduce((best, p) => (len(cross(uaDir, faDir(p))) > len(cross(uaDir, faDir(best))) ? p : best), rest);
      hinge = cross(uaDir, faDir(most));
    }
    hinge = unit(hinge);
    const across = cross(hinge, uaDir);
    const flexOf = (p) => {
      const f = faDir(p);
      return { flex: Math.atan2(dot(f, across), dot(f, uaDir)) * DEG, off: Math.asin(Math.max(-1, Math.min(1, dot(f, hinge)))) * DEG };
    };
    const flexes = poses.map(flexOf);
    const restFlex = flexOf(rest).flex;
    // the whole bend, in or out of the hinge's plane: how far the elbow folds
    const folds = poses.map((p) => Math.acos(Math.max(-1, Math.min(1, dot(faDir(p), uaDir)))) * DEG);
    // Which way the elbow bends, from the joints' places alone, so that it holds on any skeleton (ValveBiped's
    // upper arm carries a roll its elbow does not, which turns a hinge read in the upper arm's space): the plane
    // of shoulder, elbow and wrist, its side carried frame to frame from rest, where the arm bends the right way.
    // The side changes only when the forearm passes through straight between two frames (its way from one frame's
    // bend to the next comes within STRAIGHT of the upper arm's line); a plane that turns over around the line, the
    // arm nearly straight, is the arm rolled, not bent back. An arm held straight for frames has no plane: there
    // its places cannot tell a roll from a bend, and the upper arm's own space says which side it bends on after.
    // A plane that turns over in one frame while the arm is bent is a flip: the elbow swaps sides and the arm pops
    // (an IK pole crossing, baked).
    const planeOf = (p) => cross(sub(origin(p[A.elbow]), origin(p[A.shoulder])), sub(origin(p[A.hand]), origin(p[A.elbow])));
    const foldOf = (p) => Math.acos(Math.max(-1, Math.min(1, dot(unit(sub(origin(p[A.elbow]), origin(p[A.shoulder]))), unit(sub(origin(p[A.hand]), origin(p[A.elbow]))))))) * DEG;
    let sideNow = 1;
    let before = { p: rest, n: unit(planeOf(rest)), fold: foldOf(rest) };
    let straight = false;
    const flips = [];
    const hiddenFlips = [];
    const inUpperArm = (x) => mv(tr(R(x.p, A.shoulder)), x.n);
    const bends = poses.map((p, f) => {
      const now = { p, n: unit(planeOf(p)), fold: foldOf(p) };
      if (now.fold < STRAIGHT) {
        straight = true;
        return sideNow * now.fold;
      }
      const turn = Math.acos(Math.max(-1, Math.min(1, dot(now.n, before.n))));
      if (straight) {
        if (dot(inUpperArm(now), inUpperArm(before)) < 0) sideNow = -sideNow;
        straight = false;
      } else if (turn > Math.PI / 2) {
        // an engine that crossfades into the sequence (Source, Vermintide) never shows the step from rest to its
        // first frame as one frame: no flip there
        if (Math.min(now.fold, before.fold) >= BENT) {
          if (f >= settle && !(f === 0 && (M.kind === "source" || M.kind === "vt2"))) (onScreen(origin(p[A.elbow])) || onScreen(origin(p[A.hand])) ? flips : hiddenFlips).push(f);
        }
        else {
          // the two bends as points about the upper arm's line (fold out, the plane's turn round): how near the
          // straight line from one to the other passes the line itself
          const p1 = [before.fold, 0];
          const p2 = [now.fold * Math.cos(turn), now.fold * Math.sin(turn)];
          const d = [p2[0] - p1[0], p2[1] - p1[1]];
          const along = Math.max(0, Math.min(1, -(p1[0] * d[0] + p1[1] * d[1]) / (d[0] * d[0] + d[1] * d[1] || 1)));
          if (Math.hypot(p1[0] + along * d[0], p1[1] + along * d[1]) < STRAIGHT) sideNow = -sideNow;
        }
      }
      before = now;
      return sideNow * now.fold;
    });
    // the bones keep their lengths unless a hand is held by something else (v_2hswords' left hand rides the
    // sword): then the forearm stretches or shrinks between the elbow and the wrist
    const span = (p, a2, b2) => len(sub(origin(p[a2]), origin(p[b2])));
    const stretch = Math.max(...poses.map((p) => Math.max(Math.abs(span(p, A.hand, A.elbow) - span(rest, A.hand, A.elbow)), Math.abs(span(p, A.elbow, A.shoulder) - span(rest, A.elbow, A.shoulder)))));
    // the hand's own long axis (wrist to the knuckles), in the hand's space: the wrist's angle to the forearm
    const knuckles = list.map((bn, i) => i).filter((i) => i !== A.hand && isBelow(list, i, A.hand) && /(finger[1-4]|index1|mid1|fore1|pinky1)$/i.test(list[i].name));
    const knuckle = knuckles.length
      ? toBone(rest[A.hand], scale(knuckles.map((i) => origin(rest[i])).reduce(add), 1 / knuckles.length))
      : null;
    const wristAngles = knuckle
      ? poses.map((p) => {
          const h = unit(sub(apply34(p[A.hand], knuckle), origin(p[A.hand])));
          return Math.acos(Math.max(-1, Math.min(1, dot(h, unit(sub(origin(p[A.hand]), origin(p[A.elbow]))))))) * DEG;
        })
      : null;
    // the forearm's long axis in its own space, and in the hand's at rest
    const faAxis = unit(mv(tr(faRest), sub(origin(rest[A.hand]), origin(rest[A.elbow]))));
    const handAxis = mv(tr(mm(tr(faRest), hRest)), faAxis);
    const uaAxis = uaDir;
    const L0e = mm(tr(uaRest), faRest);
    const L0h = mm(tr(faRest), hRest);
    const L0s = mm(tr(parentRest), uaRest);
    const per = poses.map((p) => {
      const ua = R(p, A.shoulder);
      const fa = R(p, A.elbow);
      const h = R(p, A.hand);
      const par = parentOf >= 0 ? R(p, parentOf) : parentRest;
      const Le0 = mm(tr(ua), fa);
      const Lh0 = mm(tr(fa), h);
      const Ls = mm(tr(par), ua);
      const elbowTw = swingTwist(mm(tr(L0e), Le0), faAxis).twist;
      const wrist = swingTwist(mm(tr(L0h), Lh0), handAxis);
      const shoulder = swingTwist(mm(tr(L0s), Ls), uaAxis);
      // the joints' turning (speed.*, flow.*) with the forearm's roll at the wrist
      const { Le, Lh } = rollToWrist(Le0, Lh0, L0e, faAxis);
      return { Le, Lh, Ls, cone: shoulder.swing, bend: wrist.swing, twist: elbowTw + wrist.twist };
    });
    // the twist kept going on past a half turn rather than leaping back a whole one (a forearm rolled past 180)
    for (let i = 1; i < per.length; i++) per[i].twist -= 360 * Math.round((per[i].twist - per[i - 1].twist) / 360);
    // from the first frame shown: a clip crossfaded in from a blow before starts with the forearm already rolled
    // (Vermintide's chained blows, up to 135 from the idle's), which is the blow before's twist, not this one's
    const twist0 = per[settle].twist;
    // the frame each joint turns fastest into, for the pictures
    const fastest = {};
    const turns = { Ls: [0], Le: [0], Lh: [0] };
    const speedOf = (key) => {
      let most = 0;
      // the turn over SPEED_SPAN up to each frame: over the frames about it, weighed between them
      const k = Math.max(1, SPEED_SPAN * fps);
      const over = (i, d) => angleOf(mm(tr(per[Math.max(0, i - d)][key]), per[i][key])) / (Math.min(i, d) / fps || 1);
      for (let i = 1; i < n; i++) {
        const lo = Math.floor(k);
        const t = k - lo;
        const turn = t ? over(i, lo) * (1 - t) + over(i, lo + 1) * t : over(i, lo);
        turns[key].push(turn);
        // a turn that reaches back into the crossfade is not seen as the clip has it
        if (i - Math.ceil(k) < settle) continue;
        if (turn > most) fastest[key] = i;
        most = Math.max(most, turn);
      }
      return most;
    };
    const spans = poses.map((p) => Math.max(Math.abs(span(p, A.hand, A.elbow) - span(rest, A.hand, A.elbow)), Math.abs(span(p, A.elbow, A.shoulder) - span(rest, A.elbow, A.shoulder))));
    // the joints' ranges over the frames shown as the clip has them: past the engine's crossfade into it (where
    // Vermintide's wrists fold back past what a wrist can, mixed away with the pose before and mostly behind the eye)
    const shown = (list) => list.slice(settle);
    return {
      elbowMin: Math.min(...shown(bends)),
      flips,
      hiddenFlips,
      elbowMax: Math.max(...shown(folds)),
      stretch,
      wristAngle: wristAngles ? Math.max(...shown(wristAngles)) : null,
      wristAngleRest: wristAngles ? wristAngles[0] : null,
      elbowRest: restFlex,
      offHinge: Math.max(...shown(flexes).map((f) => Math.abs(f.off))),
      cone: Math.max(...shown(per).map((x) => x.cone)),
      bend: Math.max(...shown(per).map((x) => x.bend)),
      twist: Math.max(...shown(per).map((x) => Math.abs(x.twist - twist0))),
      twist0,
      shoulderSpeed: speedOf("Ls"),
      elbowSpeed: speedOf("Le"),
      wristSpeed: speedOf("Lh"),
      perFrame: per.map((x, i) => ({
        flex: bends[i],
        off: flexes[i].off,
        cone: x.cone,
        bend: x.bend,
        twist: x.twist,
        fold: folds[i],
        angle: wristAngles ? wristAngles[i] : null,
        stretch: spans[i],
        knuckle: knuckle ? apply34(poses[i][A.hand], knuckle) : null,
      })),
      fastest: { shoulder: fastest.Ls ?? 0, elbow: fastest.Le ?? 0, wrist: fastest.Lh ?? 0 },
      turns: { shoulder: turns.Ls, elbow: turns.Le, wrist: turns.Lh },
      // the forearm at rest in the upper arm, and its length in its own space: for rollToWrist
      L0e,
      faAxis,
    };
  };
  const J = armMeasures(side);
  put("elbow.min", J.elbowMin);
  put("elbow.flipsHidden", J.hiddenFlips.length);
  put("elbow.max", J.elbowMax);
  put("elbow.range", J.elbowMax - J.elbowMin);
  put("elbow.offHinge", J.offHinge);
  put("shoulder.cone", J.cone);
  put("wrist.bend", J.bend);
  put("wrist.angle", J.wristAngle);
  put("arm.stretch", J.stretch);
  put("wrist.twist", J.twist);
  // the forearm's roll through the strike and follow-through: how far its twist goes from one end to the other
  const rolls = J.perFrame.slice(Math.max(a, settle), c + 1).map((x) => x.twist);
  put("wrist.roll", rolls.length > 1 ? Math.max(...rolls) - Math.min(...rolls) : null);
  put("speed.shoulder", J.shoulderSpeed);
  put("speed.elbow", J.elbowSpeed);
  put("speed.wrist", J.wristSpeed);
  const O = other ? armMeasures(other) : null;
  if (O) {
    put("other.elbowMin", O.elbowMin);
    put("other.elbowFlipsHidden", O.hiddenFlips.length);
    put("other.offHinge", O.offHinge);
    put("other.stretch", O.stretch);
  }

  // ── the off arm, the body, the camera: how the rest of the player moves with the blow ──
  const lo3 = w;
  const hi3 = Math.max(w + 1, Math.min(n - 1, c));
  if (other) {
    const off = joint("hand", other);
    let travel = 0;
    let along = 0;
    for (let i = lo3; i < hi3; i++) {
      const d = sub(off[i + 1], off[i]);
      const t = sub(tips[i + 1], tips[i]);
      travel += len(d);
      if (len(t) > 0) along += dot(d, t) / len(t);
    }
    const os = spanSpeeds(off);
    const op = os.reduce((best, v, i) => (v > os[best] ? i : best), 0);
    put("other.travel", travel);
    put("other.speed", os[op]);
    // when and which way only for an off hand that moves (a tenth of a forearm or more)
    const moves = travel >= 0.1 * F;
    put("other.lag", moves ? (op - peak) / fps : null);
    put("other.counter", moves ? along / travel : null);
    put("other.onScreen", off.filter((q) => onScreen(q)).length / n);
  }
  // the body above the striking arm (clavicle, spine): the tip as that part's motion alone would carry it, step by
  // step, against the tip's own travel
  const above = forearmOnly.includes(side) ? -1 : list[arm.shoulder].parent;
  if (above >= 0) {
    const into = (m, q) => {
      const d = sub(q, origin(m));
      return [0, 1, 2].map((k) => m[0][k] * d[0] + m[1][k] * d[1] + m[2][k] * d[2]);
    };
    const outOf = (m, q) => [0, 1, 2].map((r) => m[r][0] * q[0] + m[r][1] * q[1] + m[r][2] * q[2] + m[r][3]);
    let carried = 0;
    let own = 0;
    for (let i = lo3; i < hi3; i++) {
      carried += len(sub(outOf(poses[i + 1][above], into(poses[i][above], tips[i])), tips[i]));
      own += len(sub(tips[i + 1], tips[i]));
    }
    put("body.share", own > 0 ? carried / own : null);
    // the trunk's part of it: the lowest bone above both arms' clavicles (a spine, a neck), which carries the off
    // arm with the striking one, as a torso's turn does
    const otherAbove = other && arms[other]?.shoulder !== undefined && !forearmOnly.includes(other) ? list[arms[other].shoulder].parent : -1;
    if (otherAbove >= 0 && carried > 0) {
      const chain = (i) => {
        const out = [];
        for (; i >= 0; i = list[i].parent) out.push(i);
        return out;
      };
      const theirs = new Set(chain(otherAbove));
      const trunk = chain(above).find((i) => theirs.has(i));
      if (trunk !== undefined && trunk !== above) {
        let byTrunk = 0;
        for (let i = lo3; i < hi3; i++) byTrunk += len(sub(outOf(poses[i + 1][trunk], into(poses[i][trunk], tips[i])), tips[i]));
        put("body.trunk", byTrunk / carried);
      }
    }
    const sh = joint("shoulder");
    let shTravel = 0;
    for (let i = lo3; i < hi3; i++) shTravel += len(sub(sh[i + 1], sh[i]));
    put("body.shoulderTravel", shTravel);
    // each joint's share of the turning while the blow moves: the upper arm in its parent, the forearm in the
    // upper arm, the hand in the forearm, and the body (the part above the arm, as the view sees it turn): what
    // the swing generator balances (anim/lib/swing.mjs)
    // (the forearm's roll about its length counted at the wrist: rollToWrist)
    const localOf = (b, f) => mm(tr(poses[f][list[b].parent]), poses[f][b]);
    const jointsAt = (f) => {
      const { Le, Lh } = rollToWrist(rot(localOf(arm.elbow, f)), rot(localOf(arm.hand, f)), J.L0e, J.faAxis);
      return { shoulder: rot(localOf(arm.shoulder, f)), elbow: Le, wrist: Lh };
    };
    const turned = { shoulder: 0, elbow: 0, wrist: 0, body: 0 };
    for (let f = lo3 + 1; f <= hi3; f++) {
      const [was, now] = [jointsAt(f - 1), jointsAt(f)];
      for (const k of ["shoulder", "elbow", "wrist"]) turned[k] += angleOf(mm(tr(was[k]), now[k]));
      turned.body += angleOf(mm(tr(poses[f - 1][above]), poses[f][above]));
    }
    const all = turned.shoulder + turned.elbow + turned.wrist + turned.body;
    for (const k of Object.keys(turned)) put(`share.${k}`, all > 0 ? turned[k] / all : null);
  }
  // a rig that animates its camera (Vermintide 2's camera_node): how far the view turns and shifts from the idle's
  if (M.camera) {
    const ref = M.camera(idle, 0);
    let turn = 0;
    let shift = 0;
    for (let f = 0; f < n; f++) {
      const C = M.camera(index, f);
      turn = Math.max(turn, angleOf(mm(tr(ref), C)));
      shift = Math.max(shift, len(sub(origin(C), origin(ref))));
    }
    put("camera.turn", turn);
    put("camera.shift", shift);
  }

  // ── grip ──
  let twoHanded = false;
  // for the pictures, per frame: how far the handle's line is from the fist, how far it slid, where the fist
  // holds (the rest grip carried by the hand), the handle's ends, and the off hand's gap from the handle
  let gripFrames = null;
  // the off hand's distance from the handle's line, each frame (where both are known)
  let offGaps = null;
  if (gripAt) {
    // in the hand's own space the handle's line should keep to the fist: off its line is the weapon floating
    // or turning in the hand; along it is the shaft sliding through the fist (a polearm's may)
    const { held, lines } = handleLines(side);
    const restLine = lines[settle];
    put("grip.drift", Math.max(...lines.map((l) => l.off)));
    put("grip.slide", Math.max(...lines.map((l) => Math.abs(l.along - restLine.along))));
    gripFrames = poses.map((p, f) => ({
      drift: lines[f].off,
      slide: Math.abs(lines[f].along - restLine.along),
      held: apply34(p[arm.hand], held),
      butt: buttAt(p),
      tip: tipAt(p),
      offhand: null,
    }));
    if (other) {
      const toHandle = (p) => {
        const q = origin(p[arms[other].hand]);
        const [b0, t0] = [buttAt(p), tipAt(p)];
        const axis = sub(t0, b0);
        const k = Math.max(0, Math.min(1, dot(sub(q, b0), axis) / dot(axis, axis)));
        return len(sub(q, add(b0, scale(axis, k))));
      };
      const restGap = toHandle(rest);
      const gaps = poses.map(toHandle);
      offGaps = gaps;
      // on the handle at rest and, unless told the weapon is held in both, for most of the blow
      const middle = [...gaps].sort((x, y) => x - y)[Math.floor(n / 2)];
      // "held": the weapon is two-handed and the hand must stay; "seen": it happens to be on the handle
      twoHanded = restGap >= TWO_HANDS * F ? false : opts.twoHanded ? "held" : middle < TWO_HANDS * F ? "seen" : false;
      if (twoHanded) {
        put("grip.offhand", Math.max(...gaps.map((g) => Math.abs(g - restGap))));
        gaps.forEach((g, f) => (gripFrames[f].offhand = Math.abs(g - restGap)));
      }
    }
  }

  // ── fingers ──
  // each hand's shape (handShape: angles and ratios of its own points, so rigs of other proportions compare) at
  // the hit, or the tip's fastest where there is none, and how far its curl changes from the first frame shown
  const shapeAt = hit ?? peak;
  const hands = {};
  for (const [key, k] of [["main", side], ["off", other]]) {
    if (!k) continue;
    const fingers = fingersOf(list, arms[k].hand);
    const shape = (f) => handShape(poses[f], arms[k].hand, fingers, buttAt && !fist ? [buttAt(poses[f]), tipAt(poses[f])] : null);
    const at = shape(shapeAt);
    if (!at) continue;
    const from = shape(settle).curl;
    let change = 0;
    let changeAt = settle;
    for (let f = settle; f < n; f++) {
      const d = Math.abs(shape(f).curl - from);
      if (d > change) [change, changeAt] = [d, f];
    }
    hands[key] = { ...at, change, changeAt };
  }
  if (hands.main) {
    put("fingers.curl", hands.main.curl);
    put("fingers.curlChange", hands.main.change);
    put("fingers.stagger", hands.main.stagger);
    put("fingers.wrap", hands.main.wrap);
    put("fingers.thumbAlong", hands.main.thumbAlong);
  }
  if (hands.off) {
    put("other.curl", hands.off.curl);
    put("other.curlChange", hands.off.change);
    // and how it closes round the handle, where it is on it
    if (offGaps && offGaps[shapeAt] < GRAB * F) put("other.wrap", hands.off.wrap);
  }

  // ── timing ──
  if (exact !== null) {
    put("timing.hitMinusPeak", (exact - peak) / fps);
    put("timing.hitMinusDeep", (exact - deepest) / fps);
    put("timing.hitSpeedShare", speeds[hit] / top);
    if (exact > n - 1) notes.push(`the hit (frame ${exact.toFixed(1)}) falls after the last frame ${n - 1}`);
  }

  // ── smoothness ──
  const lo2 = w;
  const hi2 = c;
  // the tip's path resampled every SPEED_SPAN over the moving part (and a step either side), its jerk there
  const step = SPEED_SPAN * fps;
  const path = [];
  for (let f = lo2 - step; f <= hi2 + 2 * step + 1e-9; f += step) path.push(atFrame(tips, f));
  let jerk2 = 0;
  for (let i = 1; i + 2 < path.length; i++) {
    const j = [0, 1, 2].map((k) => (path[i + 2][k] - 3 * path[i + 1][k] + 3 * path[i][k] - path[i - 1][k]) / SPEED_SPAN ** 3);
    jerk2 += dot(j, j) * SPEED_SPAN;
  }
  const T = Math.max(1, hi2 - lo2) / fps;
  put("smooth.ldlj", jerk2 > 0 ? -Math.log((T ** 3 / (top * top)) * jerk2) : null);
  let jumpRatio = 1;
  let jumps = 0;
  const jumpFrames = [];
  // for the pictures: each jump's point and size, and the frame of the biggest step against its neighbours'
  const jumpsSeen = [];
  let jumpRatioFrame = null;
  // the biggest step over its neighbours', a style: over SPEED_SPAN steps (a finer sampling has steps nearer
  // alike, so frame by frame it would compare rates); its neighbours' at least STILL_STEP (a still point's tremble
  // is no jump), a step of LEAST_JUMP or less none
  const every = SPEED_SPAN * fps;
  for (const track of [tips, wrists, elbows]) {
    const at = [];
    for (let f = 0; f <= n - 1 + 1e-9; f += every) at.push(atFrame(track, f));
    const steps = at.map((p, i) => (i ? len(sub(p, at[i - 1])) : 0));
    for (let i = 1; i < at.length; i++) {
      if (steps[i] <= LEAST_JUMP * F) continue;
      const around = Math.max(i > 1 ? steps[i - 1] : 0, i + 1 < at.length ? steps[i + 1] : 0, STILL_STEP * F);
      const r = steps[i] / around;
      if (r > jumpRatio) jumpRatioFrame = Math.min(n - 1, Math.round(i * every));
      jumpRatio = Math.max(jumpRatio, r);
    }
  }
  // the jumps, a glitch: frame by frame, as the player sees them
  for (const [what, track] of [["tip", tips], ["wrist", wrists], ["elbow", elbows]]) {
    const steps = track.map((p, i) => (i ? len(sub(p, track[i - 1])) : 0));
    for (let i = 1; i < n; i++) {
      if (steps[i] <= LEAST_JUMP * F) continue;
      const around = Math.max(i > 1 ? steps[i - 1] : 0, i + 1 < n ? steps[i + 1] : 0, STILL_STEP * F);
      const r = steps[i] / around;
      if (r > JUMP_RATIO && steps[i] > JUMP_LEN * F) {
        jumps++;
        jumpFrames.push(i);
        jumpsSeen.push({ frame: i, what, step: steps[i], ratio: r });
      }
    }
  }
  put("smooth.jumpRatio", jumpRatio);
  put("smooth.jumps", jumps);
  // the pops: the tip and both arms' wrists and elbows
  const popFrames = [];
  const popsSeen = [];
  const tracks = [["tip", tips], ["wrist", wrists], ["elbow", elbows]];
  if (other) tracks.push(["other wrist", joint("hand", other)], ["other elbow", joint("elbow", other)]);
  for (const [what, track] of tracks) {
    const out = new Map();
    const step = (i) => (i >= 1 && i < n ? sub(track[i], track[i - 1]) : null);
    for (let k = 1; k <= POP_FRAMES; k++)
      for (let a = 0; a + k + 1 < n; a++) {
        const b = a + k + 1;
        const drift = scale(sub(track[b], track[a]), 1 / (b - a));
        const own = (i) => (step(i) ? sub(step(i), drift) : null);
        const away = own(a + 1);
        const back = own(b);
        const least = Math.min(len(away), len(back));
        if (least <= POP_LEN * F || dot(away, back) > -0.5 * len(away) * len(back)) continue;
        const calm = [a, ...Array.from({ length: k - 1 }, (_, j) => a + 2 + j), b + 1].map(own).filter(Boolean);
        if (calm.some((s) => len(s) > least / 2)) continue;
        // how fast the point moves about it (its own way through the window, the steps into and out of it): a pop
        // in a fast swing is hidden by the motion; one on a slow or still arm is seen
        const moving = Math.max(len(drift), ...[step(a), step(b + 1)].filter(Boolean).map(len));
        for (let f = a + 1; f < b; f++) if (!out.has(f) || out.get(f).off < len(sub(track[f], track[a]))) out.set(f, { off: len(sub(track[f], track[a])), least, moving });
      }
    // frames in a row are one pop, seen when the point is on screen in any of them
    const frames = [...out.keys()].sort((x, y) => x - y);
    frames.forEach((f, i) => {
      if (i === 0 || f > frames[i - 1] + 1) popsSeen.push({ frame: f, what, ...out.get(f), seen: false });
      if (onScreen(track[f])) popsSeen.at(-1).seen = true;
      popFrames.push(f);
    });
  }
  // a pop off screen is not seen (L4D2's frying pan pops 48 units below the view): counted, but no fault
  put("smooth.popsHidden", popsSeen.filter((p) => !p.seen).length);
  // the seams: the attack begins and ends where the idle stands (view models are not blended)
  const restPoints = [tipAt(rest), ...sides.flatMap((k) => ["hand", "elbow"].map((r) => origin(rest[arms[k][r]])))];
  const pointsAt = (p) => [tipAt(p), ...sides.flatMap((k) => ["hand", "elbow"].map((r) => origin(p[arms[k][r]])))];
  const seam = (p) => Math.max(...pointsAt(p).map((q, i) => len(sub(q, restPoints[i]))));
  // Source blends a view model from one sequence into the next (a sequence's fade-in): no seam is seen there
  // engines that crossfade into and out of a sequence (Source, Vermintide's state machines) never show its first
  // and last frames as they are
  const blended = M.kind === "source" || M.kind === "vt2";
  if (blended) notes.push(`${M.kind === "source" ? "Source" : "Vermintide"} blends into and out of a sequence: its seams are left out`);
  put("seam.start", blended ? null : seam(poses[0]));
  put("seam.end", blended ? null : seam(poses[n - 1]));

  // ── the tail: from the follow-through's end to the clip's last frame, past where the next attack may cut in.
  // Vermintide 2's glide from the through point to a pose they hold, its state machine blending from there into the
  // idle; a clip that has to come back to the idle by itself (GoldSrc's) can wander on its way
  const tailFrom = Math.min(c, n - 1);
  const handsAt = (f) => sides.flatMap((k) => [origin(poses[f][arms[k].hand]), origin(poses[f][arms[k].elbow])]);
  const seenAt = (f) => onScreen(tips[f]) || handsAt(f).some(onScreen);
  // the weapon, a hand or an elbow coming into view after the strike and leaving it again before the end (from the
  // strike's end: a tail that moves fast is counted as follow-through by its speed)
  let tailPeeks = 0;
  const peekFrames = [];
  const peekFrom = Math.min(b, n - 1);
  for (let f = peekFrom + 1, was = seenAt(peekFrom), from = null; f < n; f++) {
    const now = seenAt(f);
    if (now && !was) from = f;
    if (!now && was && from !== null) {
      tailPeeks++;
      for (let g = from; g < f; g++) peekFrames.push(g);
      from = null;
    }
    was = now;
  }
  put("tail.peeks", n - 1 > peekFrom ? tailPeeks : null);
  // how far the tip drops below the lower of where the tail begins and ends (a dip under the view and back)
  const tailZ = tips.slice(tailFrom).map((p) => fromEye(p)[2]);
  const dipFrame = tailFrom + tailZ.indexOf(Math.min(...tailZ));
  put("tail.dip", n - 1 > tailFrom ? Math.min(tailZ[0], tailZ[tailZ.length - 1]) - Math.min(...tailZ) : null);
  // the tail's path against the straight line from its start to its end: 1 goes straight there
  let tailTravel = 0;
  for (let f = tailFrom + 1; f < n; f++) tailTravel += len(sub(tips[f], tips[f - 1]));
  const tailLine = len(sub(tips[n - 1], tips[tailFrom]));
  put("tail.wander", n - 1 > tailFrom && tailLine > 0.05 * fullReach ? tailTravel / tailLine : null);
  // when it settles: seconds from the follow-through's end until the tip stays within a twentieth of a reach of its last place
  let settledAt = n - 1;
  while (settledAt > tailFrom && len(sub(tips[settledAt - 1], tips[n - 1])) <= 0.05 * fullReach) settledAt--;
  put("tail.settle", n - 1 > tailFrom ? (settledAt - tailFrom) / fps : null);
  // where it ends against the idle: 0 a clip that comes back to the idle by itself (lengths here in units: a length
  // measure is made reaches with the rest, below)
  put("tail.endFromIdle", len(sub(tips[n - 1], tipAt(rest))));

  // ── faults: what a body cannot do, or a glitch, where and as long as the player sees it ──
  // Each is the worst level held on screen for HOLD seconds (frames in a row, every one of them seen). The
  // measures above stay as they are, the whole sequence's, for the bands; these are the hard limits.
  const holdFrames = Math.max(1, Math.ceil(HOLD * fps));
  const held = (series, seen) => {
    let worst = 0;
    let at = null;
    for (let i = settle; i + holdFrames <= n; i++) {
      let level = Infinity;
      for (let j = i; j < i + holdFrames && level > -Infinity; j++) level = seen[j] && series[j] !== null && series[j] !== undefined ? Math.min(level, series[j]) : -Infinity;
      if (level > worst) [worst, at] = [level, i];
    }
    return { value: worst, at };
  };
  const forearmSeen = (k) => poses.map((p) => onScreen(origin(p[arms[k].elbow])) || onScreen(origin(p[arms[k].hand])));
  const handSeen = (k) => poses.map((p) => onScreen(origin(p[arms[k].hand])));
  const whole = sides.filter((k) => !forearmOnly.includes(k));
  const faultAt = {};
  const worstOf = (key, list) => {
    const best = list.reduce((a, b) => (b.value > a.value ? b : a), { value: 0, at: null });
    put(key, best.value);
    faultAt[key] = best.at;
  };
  const perArm = (k) => (k === side ? J : k === other ? O : null);
  worstOf("fault.hyperextension", whole.map((k) => held(perArm(k).perFrame.map((x) => -x.flex), forearmSeen(k))));
  worstOf("fault.elbowFold", whole.map((k) => held(perArm(k).perFrame.map((x) => x.fold), forearmSeen(k))));
  worstOf("fault.armStretch", whole.map((k) => held(perArm(k).perFrame.map((x) => x.stretch), forearmSeen(k))));
  worstOf("fault.wristFold", [held(J.perFrame.map((x) => x.angle), handSeen(side))]);
  if (gripFrames) {
    worstOf("fault.gripLost", [held(gripFrames.map((x) => x.drift), handSeen(side))]);
    if (twoHanded === "held") worstOf("fault.offhandLost", [held(gripFrames.map((x) => x.offhand), handSeen(other))]);
  }
  put("fault.pops", popsSeen.filter((p) => p.seen && p.frame >= settle).length);
  put("fault.elbowFlips", whole.reduce((s, k) => s + perArm(k).flips.length, 0));

  // ── framing ──
  put("frame.tipOnScreen", strikeFrames.filter((i) => onScreen(tips[i])).length / strikeFrames.length);
  if (hit !== null) put("frame.tipOnScreenAtHit", onScreen(tips[hit]) ? 1 : 0);
  // a triangle crossing the near plane inside the screen's rectangle there is seen cut open
  const weaponBones = new Set(fist ? [] : weapon.bones.map((name) => list.findIndex((bn) => bn.name === name)));
  const cutFrames = { arms: [], weapon: [] };
  poses.forEach((p, f) => {
    let armCut = false;
    let weaponCut = false;
    for (const t of tris) {
      const isWeapon = weaponBones.has(t[0].bone);
      if (isWeapon ? weaponCut : armCut) continue;
      const q = t.map((vx) => fromEye(apply34(p[vx.bone], vx.p)));
      const before = q.map((x) => x[0] < near);
      if (before.every(Boolean) || !before.some(Boolean)) continue;
      for (let e = 0; e < 3; e++) {
        const [u, v2] = [q[e], q[(e + 1) % 3]];
        if (u[0] < near === v2[0] < near) continue;
        const k = (near - u[0]) / (v2[0] - u[0]);
        const y = u[1] + (v2[1] - u[1]) * k;
        const z = u[2] + (v2[2] - u[2]) * k;
        if (Math.abs(y) <= near * tx && Math.abs(z) <= near * ty) {
          if (isWeapon) weaponCut = true;
          else armCut = true;
          break;
        }
      }
      if (armCut && (weaponCut || !weaponBones.size)) break;
    }
    if (armCut) cutFrames.arms.push(f);
    if (weaponCut) cutFrames.weapon.push(f);
  });
  put("frame.nearArms", cutFrames.arms.length / n);
  put("frame.nearWeapon", cutFrames.weapon.length / n);

  // ── flow: does the arm stop between the wind-up and the strike? ──
  // The fastest of the shoulder's, elbow's and wrist's turns into each frame (deg/s). Over the wind-up and the
  // strike's first frame (from frame 2: the first turn is into frame 1), its least is the stall: MSR's arm never
  // stops there all at once (some joint still turns, 48 deg/s in v_1hswords attack1, 120 in attack2), an arm
  // placed by keys in its joints and swung from a still key does. After the strike MSR does hold (polearms,
  // rune axes), so only the way in is judged.
  const fastestJoint = Array.from({ length: n }, (_, f) => Math.max(J.turns.shoulder[f], J.turns.elbow[f], J.turns.wrist[f]));
  let stallAt = Math.min(2, n - 1);
  for (let f = stallAt; f <= Math.max(stallAt, Math.min(a, n - 1)); f++) if (fastestJoint[f] < fastestJoint[stallAt]) stallAt = f;
  put("flow.stall", fastestJoint[stallAt]);
  // lockstep about the cock (the tip's slowest frame before the strike): how alike the joints' speed curves are
  // over the six frames either side (Pearson's r, each pair counted by its weaker joint's motion). 1: they slow
  // and speed up together, as joints interpolated between keys do; MSR's 1h swords' attack1-3 are near 0 (the
  // shoulder turns on while the elbow stops, the wrist waits for the strike); MSR's axes are near 1 too.
  let cock = Math.min(1, n - 1);
  for (let f = 1; f < a; f++) if (speeds[f] < speeds[cock]) cock = f;
  const lockFrames = Array.from({ length: Math.max(0, Math.min(n - 1, cock + 6) - Math.max(1, cock - 6) + 1) }, (_, k) => Math.max(1, cock - 6) + k);
  {
    const curves = ["shoulder", "elbow", "wrist"].map((k) => lockFrames.map((f) => J.turns[k][f]));
    const biggest = Math.max(...curves.flat(), 1e-9);
    let sum = 0;
    let weight = 0;
    for (let i = 0; i < 3; i++)
      for (let k = i + 1; k < 3; k++) {
        const [A, B] = [curves[i], curves[k]];
        const [ma, mb] = [A.reduce((x, y) => x + y, 0) / A.length, B.reduce((x, y) => x + y, 0) / B.length];
        let [sab, saa, sbb] = [0, 0, 0];
        for (let z = 0; z < A.length; z++) {
          sab += (A[z] - ma) * (B[z] - mb);
          saa += (A[z] - ma) ** 2;
          sbb += (B[z] - mb) ** 2;
        }
        const wk = Math.min(Math.max(...A), Math.max(...B)) / biggest;
        if (saa > 1e-9 && sbb > 1e-9) sum += (wk * sab) / Math.sqrt(saa * sbb);
        weight += wk;
      }
    put("flow.lockstep", lockFrames.length >= 4 && weight > 1e-6 ? sum / weight : null);
  }

  // ── where each measure happens, for the pictures ──
  // { key: { at: the one frame that shows it best, frames: the frames it is about (a span, or the frames it
  // happens in) } }; nothing above is changed by it
  const span = (from, to) => Array.from({ length: Math.max(0, to - from + 1) }, (_, k) => from + k);
  const most = (list, f = (x) => x) => list.reduce((best, x, i) => (f(x, i) > f(list[best], best) ? i : best), 0);
  const least = (list, f) => most(list, (x) => -f(x));
  const planeOff = tips.map((p) => Math.abs(dot(sub(p, mean), eig[0].vector)));
  const strikeSpan = span(lo, hi);
  const tipSeen = tips.map(onScreen);
  const offScreen = strikeFrames.filter((i) => !tipSeen[i]);
  const one = (f) => ({ at: f, frames: [f] });
  const where = {
    "reach.maxDepth": one(deepest),
    "reach.deepDistance": one(deepest),
    "reach.deepAngle": one(deepest),
    "phase.windup": { at: a, frames: span(0, a - 1) },
    "phase.strike": { at: peak, frames: span(a, b) },
    "phase.follow": { at: Math.min(n - 1, b + 1), frames: span(b + 1, c) },
    "phase.recovery": { at: Math.min(n - 1, c + 1), frames: span(c + 1, Math.max(c, cut)) },
    "phase.strikeShare": { at: peak, frames: span(a, b) },
    "phase.peakSpeed": one(peak),
    "phase.windupBack": { at: a, frames: span(0, a) },
    "plane.residual": { at: strikeSpan[most(strikeSpan, (i) => planeOff[i])], frames: strikeSpan },
    "plane.flatness": { at: strikeSpan[most(strikeSpan, (i) => planeOff[i])], frames: strikeSpan },
    "plane.tilt": { at: peak, frames: strikeSpan },
    "strike.arc": { at: peak, frames: strikeSpan },
    "strike.turn": { at: peak, frames: strikeSpan },
    "edge.lead": edgeFrames.length ? { at: edgeFrames.reduce((x, y) => (y.angle > x.angle ? y : x)).f, frames: edgeFrames.map((x) => x.f) } : null,
    "fan.travelRatio": { at: peak, frames: strikeSpan },
    "fan.pivot": { at: peak, frames: strikeFrames },
    "elbow.min": one(least(J.perFrame, (x) => x.flex)),

    "elbow.max": one(most(J.perFrame, (x) => x.fold)),
    "elbow.range": { at: least(J.perFrame, (x) => x.flex), frames: [least(J.perFrame, (x) => x.flex), most(J.perFrame, (x) => x.fold)] },
    "elbow.offHinge": one(most(J.perFrame, (x) => Math.abs(x.off))),
    "shoulder.cone": one(most(J.perFrame, (x) => x.cone)),
    "wrist.bend": one(most(J.perFrame, (x) => x.bend)),
    "wrist.angle": one(most(J.perFrame, (x) => x.angle ?? -Infinity)),
    "arm.stretch": one(most(J.perFrame, (x) => x.stretch)),
    "wrist.twist": one(most(J.perFrame, (x, i) => (i < settle ? -Infinity : Math.abs(x.twist - J.twist0)))),
    "wrist.roll": { at: peak, frames: span(Math.max(a, settle), c) },
    "speed.shoulder": one(J.fastest.shoulder),
    "speed.elbow": one(J.fastest.elbow),
    "speed.wrist": one(J.fastest.wrist),
    "smooth.ldlj": { at: peak, frames: span(w, c) },
    "smooth.jumpRatio": one(jumpRatioFrame ?? peak),
    "smooth.jumps": { at: jumpFrames[0] ?? peak, frames: [...new Set(jumpFrames)].sort((x, y) => x - y) },
    "fault.pops": { at: popsSeen.find((p) => p.seen)?.frame ?? peak, frames: [...new Set(popFrames)].sort((x, y) => x - y) },
    "fault.elbowFlips": { at: [...J.flips, ...(O?.flips ?? [])][0] ?? 0, frames: [...J.flips, ...(O?.flips ?? [])] },
    "seam.start": one(0),
    "seam.end": one(n - 1),
    "tail.peeks": { at: peekFrames[0] ?? tailFrom, frames: peekFrames },
    "tail.dip": one(dipFrame),
    "tail.wander": { at: tailFrom, frames: span(tailFrom, n - 1) },
    "tail.settle": one(settledAt),
    "tail.endFromIdle": one(n - 1),
    "frame.tipOnScreen": { at: offScreen[0] ?? peak, frames: offScreen },
    "frame.nearArms": { at: cutFrames.arms[0] ?? 0, frames: cutFrames.arms },
    "frame.nearWeapon": { at: cutFrames.weapon[0] ?? 0, frames: cutFrames.weapon },
    "flow.stall": { at: stallAt, frames: span(Math.min(2, n - 1), Math.max(Math.min(2, n - 1), Math.min(a, n - 1))) },
    "flow.lockstep": { at: cock, frames: lockFrames },
  };
  if (O) {
    where["other.elbowMin"] = one(least(O.perFrame, (x) => x.flex));

    where["other.offHinge"] = one(most(O.perFrame, (x) => Math.abs(x.off)));
    where["other.stretch"] = one(most(O.perFrame, (x) => x.stretch));
  }
  for (const [key, at] of Object.entries(faultAt)) if (at !== null) where[key] = { at, frames: Array.from({ length: holdFrames }, (_, j) => Math.min(n - 1, at + j)) };
  if (gripFrames) {
    where["grip.drift"] = one(most(gripFrames, (x) => x.drift));
    where["grip.slide"] = one(most(gripFrames, (x) => x.slide));
    if (twoHanded) where["grip.offhand"] = one(most(gripFrames, (x) => x.offhand ?? -Infinity));
  }
  for (const [key, h] of [["fingers", hands.main], ["other", hands.off]]) {
    if (!h) continue;
    for (const k of key === "fingers" ? ["fingers.curl", "fingers.stagger", "fingers.wrap", "fingers.thumbAlong"] : ["other.curl", "other.wrap"]) where[k] = one(shapeAt);
    where[key === "fingers" ? "fingers.curlChange" : "other.curlChange"] = one(h.changeAt);
  }
  if (hit !== null) {
    for (const key of ["reach.hitDistance", "reach.hitDepth", "reach.hitAngle", "reach.hitOverRange", "timing.hitSpeedShare", "frame.tipOnScreenAtHit"])
      where[key] = one(hit);
    where["timing.hitMinusPeak"] = { at: hit, frames: [hit, peak] };
    where["timing.hitMinusDeep"] = { at: hit, frames: [hit, deepest] };
  }
  if (forearmOnly.includes(side)) {
    for (const key of UPPER_ARM_MEASURES) v[key] = null;
    notes.push(`the ${side} arm is a forearm and hand only: the upper arm's, elbow's and shoulder's measures are left out`);
  }
  if (other && forearmOnly.includes(other)) for (const key of ["other.elbowMin", "other.elbowFlipsHidden", "other.offHinge", "other.stretch"]) v[key] = null;

  // lengths and speeds out in forearms; the tip's in full reaches
  for (const key of Object.keys(v)) if (v[key] !== null && MEASURES[key]?.length) v[key] = Number((v[key] / (MEASURES[key].reach ? fullReach : F)).toFixed(4));

  return {
    info: {
      seq: s.name,
      unit: F,
      fullReach,
      index,
      frames: n,
      fps,
      seconds: (n - 1) / fps,
      idle: seqs[idle].name,
      side,
      fist,
      twoHanded,
      weapon: fist ? null : { name: weapon.name, length: weapon.length, bone: weapon.boneName },
      forearm,
      upperarm,
      delay,
      range,
      hitFrame: exact,
      cutFrame: cut < n - 1 ? cut : null,
      hitPhase: hit === null ? null : phaseOf(hit),
      peakFrame: peak,
      deepestFrame: deepest,
      phases: { windup: [0, a - 1], strike: [a, b], follow: [b + 1, c], recovery: [c + 1, Math.max(c, cut)], moving: [w, c] },
      // the tip from the eye ([ahead, left, up], in full reaches) at the clip's first frame (start: where an engine
      // that crossfades leaves the clip from), where the strike starts (cocked), at its fastest
      // (contact), where the follow-through ends (through) and at the hit, where there is one: a blow's path as
      // swing.mjs's specs say it
      path: Object.fromEntries(
        [["start", 0], ["cocked", a], ["contact", peak], ["through", c], ["hit", hit], ["end", n - 1]]
          .filter(([, f]) => f !== null)
          .map(([k, f]) => [k, fromEye(tips[f]).map((x) => Number((x / fullReach).toFixed(4)))])
          // and the striking shoulder at rest: where the body is that the places are reached from
          .concat([["shoulder", fromEye(origin(rest[arm.shoulder])).map((x) => Number((x / fullReach).toFixed(4)))]])
          // the off hand (its wrist) at the first frame shown, at the cock, at the hit (where there is one) and where the
          // follow-through ends
          .concat(
            other
              ? [["offStart", settle], ["offCocked", a], ["offHit", hit], ["offThrough", c], ["offEnd", n - 1]]
                  .filter(([, f]) => f !== null)
                  .map(([k, f]) => [k, fromEye(origin(poses[f][arms[other].hand])).map((x) => Number((x / fullReach).toFixed(4)))])
              : [],
          ),
      ),
      // the off hand on the handle (within GRAB forearms of its line): the share of the strike's frames it is, and
      // whether it is at the hit. A one-handed weapon's heavy may be swung with both hands (Vermintide 2's sword's
      // heavy left and right, its mace's heavy left: the charge brings the off hand to the handle)
      // each hand's shape at the hit (or the tip's fastest): handShape's curl, curls, stagger, thumbAlong, wrap
      hands: Object.fromEntries(
        Object.entries(hands).map(([k, h]) => [k, { curl: Number(h.curl.toFixed(1)), curls: Object.fromEntries(Object.entries(h.curls).map(([f, c]) => [f, Number(c.toFixed(1))])), stagger: h.stagger === null ? null : Number(h.stagger.toFixed(1)), thumbAlong: h.thumbAlong === null ? null : Number(h.thumbAlong.toFixed(1)), wrap: h.wrap === null ? null : Number(h.wrap.toFixed(3)) }]),
      ),
      offGrip: offGaps
        ? {
            strike: Number((strikeFrames.filter((f) => offGaps[f] < GRAB * F).length / Math.max(1, strikeFrames.length)).toFixed(3)),
            hit: hit === null ? null : offGaps[hit] < GRAB * F,
          }
        : null,
      // the forearm's roll from the cock to the follow-through's end, signed (about the forearm, elbow to hand,
      // turning right-handed; a left arm's the other way to compare with a right's)
      roll: rolls.length > 1 ? Number((rolls.at(-1) - rolls[0]).toFixed(2)) : null,
      // and the blade's direction there (butt to tip), where the weapon has a butt
      blades: buttAt
        ? Object.fromEntries(
            [["start", 0], ["cocked", a], ["contact", peak], ["through", c], ["end", n - 1]].map(([k, f]) => [k, unit(sub(tips[f], buttAt(poses[f]))).map((x) => Number(x.toFixed(4)))]),
          )
        : null,
      pivotJoint,
      jumpFrames,
      cutFrames,
      // for the pictures (anims/lib/draw.mjs)
      jumps: jumpsSeen,
      pops: popsSeen,
      bodypart,
      submodel,
      where,
      pivots: pivotAt,
      plane: { mean, normal: eig[0].vector, frames: [lo, hi] },
    },
    values: v,
    notes,
    path: {
      tips,
      wrists,
      elbows,
      shoulders,
      speeds,
      joints: J.perFrame,
      // for the pictures: each joint's turn into each frame (deg/s)
      turns: J.turns,
      // the fastest of the three joints' turns into each frame (deg/s), and the cock (flow.*)
      fastestJoint,
      cock,
      // for the pictures: the other arm's joints and its per-frame bends, the grip, the tip on screen, the tip
      // off the strike's plane, and where the idle's first frame has the tip and the joints
      other: other ? { side: other, wrists: joint("hand", other), elbows: joint("elbow", other), shoulders: joint("shoulder", other), joints: O.perFrame } : null,
      grip: gripFrames,
      tipSeen,
      planeOff,
      rest: { tip: tipAt(rest), wrist: origin(rest[arm.hand]), elbow: origin(rest[arm.elbow]), shoulder: origin(rest[arm.shoulder]) },
    },
  };
}

/** What a stand-in shoulder would make up, left out for arms cut off at the elbow. */
const UPPER_ARM_MEASURES = ["elbow.min", "elbow.flipsHidden", "elbow.max", "elbow.range", "elbow.offHinge", "shoulder.cone", "arm.stretch", "wrist.twist", "wrist.roll", "speed.shoulder", "speed.elbow", "flow.stall", "flow.lockstep"];

/** Arms named by the caller: { R: { hand: "Bone24", elbow: "Bone23" }, L: {...} } as bone numbers. */
function armsByName(list, named) {
  const arms = { R: {}, L: {} };
  for (const side of ["R", "L"])
    for (const [role, name] of Object.entries(named[side] ?? {})) {
      const i = list.findIndex((b) => b.name === name);
      if (i < 0) throw new Error(`no bone ${name} for the ${side} ${role}`);
      arms[side][role] = i;
    }
  return arms;
}

// ── what the measures mean ─────────────────────────────────────────────────

/**
 * Each measure: its unit, what it is, what a low and a high value mean in the body, the hard limits of a real
 * body where there are any (outside them it is wrong whatever the reference does), and `tol`: the least width its band
 * is given (a measure the corpus holds constant would otherwise flag any rounding). `length`: a length or a speed,
 * computed in the model's units and given out in forearms; `reach`: a measure of the tip's, given out in full
 * reaches instead (the arm and the weapon from the wrist to the tip, at rest), so a dagger and a spear compare.
 */
export const MEASURES = {
  "reach.hitDistance": { unit: "reaches", length: true, reach: true, what: "tip's distance from the eye at the hit frame", low: "the blade has not reached the target when the damage lands", high: "the tip is thrown far out at the hit", tol: 0.039 },
  "reach.hitDepth": { unit: "reaches", length: true, reach: true, what: "tip's depth ahead of the eye at the hit frame", low: "the tip is still beside or behind the eye at the hit: cocked, not striking", high: "the tip is deep ahead at the hit", tol: 0.039 },
  "reach.hitAngle": { unit: "deg", what: "tip's angle off the line of sight at the hit frame", low: "the tip is on the crosshair at the hit", high: "the tip is far off the line of sight when the damage lands", tol: 3 },
  "reach.hitOverRange": { unit: "x", what: "tip distance at the hit over MELEE_RANGE", low: "the blade stops well short of the item's range", high: "the blade passes beyond the item's range", tol: 0.05 },
  "reach.maxDepth": { unit: "reaches", length: true, reach: true, what: "the deepest the tip goes ahead", low: "the blow never goes out to meet anything: short reach", high: "the arm is thrown far out: a long reach", tol: 0.039 },
  "reach.deepDistance": { unit: "reaches", length: true, reach: true, what: "tip's distance from the eye at its deepest", low: "short reach", high: "overlong reach", tol: 0.039 },
  "reach.deepAngle": { unit: "deg", what: "tip's angle off the line of sight at its deepest", low: "the deepest point is on the crosshair", high: "the blow's deepest point is off to a side: it reaches past the target, not into it", tol: 3 },
  "phase.windup": { unit: "s", what: "time before the strike", low: "no wind-up: the blow starts at full speed", high: "a long wind-up", tol: 0.03 },
  "phase.strike": { unit: "s", what: "the strike's length (tip faster than 40% of its peak)", low: "a snap: the strike is over in a frame or two", high: "a slow, drawn-out strike", tol: 0.03 },
  "phase.follow": { unit: "s", what: "follow-through (tip 15-40% of its peak after the strike)", low: "the blade stops dead after the strike: no follow-through", high: "a long follow-through", tol: 0.03 },
  "phase.recovery": { unit: "s", what: "recovery (after the follow-through, up to where the next attack may cut in)", low: "no recovery: the next attack cuts in while it is still moving", high: "a long hold or return", tol: 0.05 },
  "phase.strikeShare": { unit: "x", what: "strike frames over all frames", low: "the strike is a small part of the sequence", high: "most of the sequence is the strike: no wind-up or recovery", tol: 0.03 },
  "phase.peakSpeed": { unit: "reaches/s", length: true, reach: true, what: "the tip's peak speed", low: "a slow, weightless blow", high: "a fast, whipping tip", tol: 0.39 },
  "phase.windupBack": { unit: "x", what: "how far the wind-up draws the tip back against the strike's way (over the strike's length)", low: "the tip comes into the strike from in front: no drawing back", high: "a long draw back", tol: 0.05 },
  "plane.residual": { unit: "reaches", length: true, reach: true, what: "RMS distance of the strike's tip path from its best plane", low: "the strike keeps to one plane", high: "the tip path wanders out of its plane: a wobbling, curling cut", tol: 0.0098 },
  "plane.eyeAngle": { unit: "deg", what: "the eye's angle off the strike's plane, from the stroke's middle (0: the plane through the eye, a straight stroke on screen)", low: "the stroke is seen edge-on: a straight line across the screen", high: "the stroke is seen from beside its plane: a curve on screen", tol: 2 },
  "plane.flatness": { unit: "x", what: "plane residual over the strike's arc length", low: "flat as a cut should be", high: "the path curls out of its plane for its length", tol: 0.01 },
  "plane.tilt": { unit: "deg", what: "the strike plane's tilt (0 a level sweep, 90 an upright chop)", low: "a level sweep", high: "an upright chop or thrust", tol: 5 },
  "strike.arc": { unit: "reaches", length: true, reach: true, what: "the tip's path length during the strike", low: "a short strike", high: "a long sweep", tol: 0.039 },
  "edge.lead": { unit: "deg", what: "the edge against the way the blade moves across itself in the strike (0: the edge leads, 90: the flat)", low: "the edge leads the cut", high: "the blade swings flat: the edge does not lead", tol: 3 },
  "strike.turn": { unit: "deg", what: "how far the blade turns during the strike", low: "the blade hardly turns: a push or thrust", high: "the blade turns a long way during the strike", tol: 5 },
  "fan.travelRatio": { unit: "x", what: "tip travel over wrist travel during the strike", low: "the hand carries the tip: the arm drives the blow", high: "the tip sweeps far about a hand that moves little: a wrist-led fan", tol: 0.2 },
  "fan.pivot": { unit: "forearms", what: "the wrist's distance from the blade's rotation axis, in forearm lengths (0 = the blade turns about the wrist, 1 about the elbow, 2 about the shoulder)", low: "the blade turns about the wrist: a wrist-led snap", high: "the blade turns about something far from the hand (shoulder, torso) or barely turns (a thrust)", tol: 0.15 },
  "elbow.min": { unit: "deg", what: "the elbow's least bend (0 straight, negative bent the wrong way)", low: "the elbow goes past straight: hyperextended", high: "the arm never straightens", tol: 3 },
  "elbow.flipsHidden": { unit: "", what: "elbow flips with the forearm off screen: unseen in play, but there", low: "", high: "the elbow flips where the player does not see it", tol: 0.5 },
  "elbow.max": { unit: "deg", what: "the elbow's most fold (forearm against upper arm, in or out of the hinge's plane)", low: "the arm stays nearly straight", high: "the elbow folds tight", tol: 3 },
  "elbow.range": { unit: "deg", what: "the elbow's bend range in the sequence", low: "the elbow barely moves: the blow is all shoulder or wrist", high: "a big elbow swing", tol: 3 },
  "elbow.offHinge": { unit: "deg", what: "the forearm out of the elbow's rest bend plane, in the upper arm's space (a turn of the upper arm about its length its bone does not carry looks the same)", low: "the elbow bends on its one axis", high: "the forearm swings far sideways at the elbow", tol: 3 },
  "shoulder.cone": { unit: "deg", what: "the upper arm's most swing from rest", low: "the shoulder stays put: the arm alone moves", high: "the upper arm swings far from rest", tol: 3 },
  "wrist.bend": { unit: "deg", what: "the hand's most turn against the forearm from rest, its twist about the forearm taken out", low: "a stiff wrist", high: "the wrist bends hard", tol: 3 },
  "wrist.angle": { unit: "deg", what: "the wrist's most angle between the forearm and the hand (wrist to knuckles)", low: "a straight wrist", high: "the hand folds back on the forearm", tol: 3 },
  "arm.stretch": { unit: "forearms", length: true, what: "the most an arm bone's length (shoulder-elbow, elbow-wrist) changes", low: "the arm keeps its length", high: "the arm stretches or shrinks: the hand is held by something else and the arm does not follow", tol: 0.057 },
  "other.travel": { unit: "forearms", length: true, what: "how far the off hand's wrist travels while the blow moves", low: "the off hand stays still", high: "the off hand travels far, with or against the blow", tol: 0.11 },
  "other.speed": { unit: "forearms/s", length: true, what: "the off hand's fastest", low: "a still off hand", high: "a fast off hand", tol: 0.5 },
  "other.lag": { unit: "s", what: "the off hand's fastest moment less the tip's (an off hand that moves)", low: "the off hand leads the blow", high: "the off hand follows the blow", tol: 0.03 },
  "other.counter": { unit: "r", what: "the off hand's travel along the tip's way over its whole travel: -1 against the blow, +1 with it", low: "the off hand pulls back as the blow goes out: a counterbalance", high: "the off hand goes with the blow", tol: 0.1 },
  "other.onScreen": { unit: "x", what: "the share of frames the off hand is on screen", low: "the off hand stays out of view", high: "the off hand is in view through the blow", tol: 0.05 },
  "body.share": { unit: "x", what: "the tip's travel the body above the arm (clavicle, spine) carries, over the tip's own, while the blow moves", low: "the arm alone moves the blade", high: "the body throws the blow: shoulder and torso carry it", tol: 0.03 },
  "body.trunk": { unit: "x", what: "of the tip's travel the body carries, the share the trunk (the lowest bone above both arms) carries", low: "the shoulder turns alone: the off arm stays", high: "the torso turns: both arms go with the blow", tol: 0.05 },
  "body.shoulderTravel": { unit: "forearms", length: true, what: "how far the shoulder joint travels while the blow moves", low: "a fixed shoulder", high: "the shoulder moves far: a lunge or a torso turn", tol: 0.057 },
  "share.shoulder": { unit: "x", what: "the shoulder's share of the joints' turning while the blow moves (shoulder, elbow, wrist, body)", low: "the shoulder does little of the blow", high: "the shoulder swings the blow", tol: 0.03 },
  "share.elbow": { unit: "x", what: "the elbow's share of the joints' turning while the blow moves", low: "a stiff elbow", high: "the elbow drives the blow", tol: 0.03 },
  "share.wrist": { unit: "x", what: "the wrist's share of the joints' turning while the blow moves", low: "a firm wrist", high: "the wrist flicks the blade", tol: 0.03 },
  "share.body": { unit: "x", what: "the body's share (the part above the arm, turning in the view) of the joints' turning while the blow moves", low: "the body stays put", high: "the body turns into the blow", tol: 0.03 },
  "camera.turn": { unit: "deg", what: "the view's most turn from the idle's (a rig that animates its camera)", low: "a still view", high: "the view turns with the blow", tol: 1 },
  "camera.shift": { unit: "forearms", length: true, what: "the view's most shift from the idle's (a rig that animates its camera)", low: "a still view", high: "the view moves with the blow", tol: 0.057 },
  "wrist.twist": { unit: "deg", what: "the forearm's most twist from the first frame shown (forearm and wrist about the forearm's axis)", low: "no twist", high: "the forearm twists a long way", tol: 3 },
  "wrist.roll": { unit: "deg", what: "how far the forearm rolls through the strike and follow-through (its twist from one end to the other)", low: "the forearm does not roll as the blade comes round: the blow is swung, not turned over", high: "the forearm rolls a long way through the strike", tol: 3 },
  "speed.shoulder": { unit: "deg/s", what: "the shoulder's fastest turn", low: "a slow shoulder", high: "a fast shoulder", tol: 30 },
  "speed.elbow": { unit: "deg/s", what: "the elbow's fastest turn", low: "a slow elbow", high: "a fast elbow", tol: 30 },
  "speed.wrist": { unit: "deg/s", what: "the wrist's fastest turn", low: "a slow wrist", high: "a fast wrist", tol: 30 },
  "other.elbowMin": { unit: "deg", what: "the other arm's least elbow bend", low: "the other elbow is hyperextended", high: "", tol: 3 },
  "other.elbowFlipsHidden": { unit: "", what: "the other elbow's flips off screen", low: "", high: "the other elbow flips where the player does not see it", tol: 0.5 },
  "other.offHinge": { unit: "deg", what: "the other forearm out of its elbow's plane", low: "", high: "the other elbow bends sideways", tol: 3 },
  "other.stretch": { unit: "forearms", length: true, what: "the most the other arm's bones change length", low: "", high: "the other arm stretches: its hand is held by the weapon and the arm does not follow", tol: 0.057 },
  "fingers.curl": { unit: "deg", what: "the striking hand's four fingers' mean bend at the hit (the turns between each finger's segments, hand to fingertip: 0 flat, about 270 a fist); shown, not counted: how far a hand curls round a handle is its fingers' length against the handle's thickness", low: "an open or loose hand on the handle", high: "a tight fist", tol: 5, rigBound: true },
  "fingers.curlChange": { unit: "deg", what: "the most the striking hand's curl changes from the first frame shown", low: "the grip keeps its shape through the blow", high: "the hand tightens or opens on the handle as it swings", tol: 5 },
  "fingers.stagger": { unit: "deg", what: "the pinky's curl less the index's at the hit", low: "the index curls tighter than the pinky", high: "the pinky closes tighter than the index: a hammer grip, the index looser along the handle", tol: 5 },
  "fingers.wrap": { unit: "x", what: "the fingertips' mean distance from the handle's line over the knuckles' at the hit", low: "the fingertips come round close to the handle: a closed grip", high: "the fingertips stand off the handle: an open hand", tol: 0.05 },
  "fingers.thumbAlong": { unit: "deg", what: "the thumb's last segment against the handle at the hit (0 along it, 90 across)", low: "the thumb is pressed along the grip", high: "the thumb wraps round the handle", tol: 5 },
  "other.curl": { unit: "deg", what: "the off hand's four fingers' mean bend at the hit (shown, not counted, as fingers.curl)", low: "the off hand is open", high: "the off hand is a fist", tol: 5, rigBound: true },
  "other.wrap": { unit: "x", what: "the off hand's fingertips' mean distance from the handle's line over its knuckles', at the hit, where it holds the handle (counted only above the band: Vermintide 2's off hand lies on the handle a loose fist, and one closed round it is no fault)", low: "the off hand closes round the handle", high: "the off hand lies on the handle open", tol: 0.05, counts: "high" },
  "other.curlChange": { unit: "deg", what: "the most the off hand's curl changes from the first frame shown", low: "the off hand keeps its shape", high: "the off hand opens or closes during the blow", tol: 5 },
  "grip.drift": { unit: "forearms", length: true, what: "how far the handle's line leaves the fist (in the hand's space)", low: "the hand keeps the handle", high: "the weapon floats or turns in the hand", tol: 0.057 },
  "grip.slide": { unit: "forearms", length: true, what: "how far the handle slides along its length through the fist", low: "the fist keeps its place on the handle", high: "the handle slides through the fist (a spear's shaft may; a sword's should not)", tol: 0.057 },
  "grip.offhand": { unit: "forearms", length: true, what: "how far the off hand leaves the handle's line (two hands; sliding along a shaft is allowed)", low: "both hands stay on the handle", high: "the second hand lets go of the handle", tol: 0.11 },
  "timing.hitMinusPeak": { unit: "s", what: "the hit's moment less the tip's fastest", low: "the damage lands before the blade is at speed", high: "the damage lands after the fastest moment, as the blade slows", tol: 0.03 },
  "timing.hitMinusDeep": { unit: "s", what: "the hit's moment less the tip's deepest", low: "the damage lands before the blade reaches out", high: "the damage lands after the blade has passed its deepest", tol: 0.03 },
  "timing.hitSpeedShare": { unit: "x", what: "the tip's speed at the hit over its peak", low: "the blade is nearly still when the damage lands", high: "the hit is at the blow's fastest", tol: 0.05 },
  "smooth.ldlj": { unit: "", what: "log dimensionless jerk of the tip over the moving part (higher = smoother)", low: "a jerky tip path", high: "a very smooth tip path", tol: 0.3 },
  "smooth.jumpRatio": { unit: "x", what: "the biggest single step of tip, wrist or elbow over its neighbours'", low: "no jumps", high: "a point jumps in one frame: a teleport", tol: 0.3 },
  "smooth.jumps": { unit: "", what: "steps over 3x their neighbours and a third of a forearm", low: "", high: "frames where the arm or blade moves far more than in the frames about it: a snap or smear frame, or a teleport", tol: 0.5 },
  "smooth.popsHidden": { unit: "", what: "pops off screen", low: "", high: "a point pops where the player does not see it", tol: 0.5 },
  "seam.start": { unit: "forearms", length: true, what: "the farthest a joint or the tip is, at the first frame, from the idle's", low: "the attack begins where the idle stands", high: "a jump from the idle into the attack", tol: 0.11 },
  "seam.end": { unit: "forearms", length: true, what: "the farthest a joint or the tip is, at the last frame, from the idle's", low: "the attack ends where the idle begins", high: "a jump from the attack back to the idle", tol: 0.11 },
  "fault.hyperextension": { unit: "deg", what: "the most an elbow is bent past straight, held 0.1 s with its forearm on screen", low: "", high: "an elbow bent backwards where the player sees it", tol: 3, hard: [null, 10], fault: true },
  "fault.elbowFold": { unit: "deg", what: "the most an elbow folds, held 0.1 s on screen", low: "", high: "the forearm folds into the upper arm, past what an elbow can", tol: 3, hard: [null, 160], fault: true },
  "fault.armStretch": { unit: "forearms", length: true, what: "the most an arm bone's length changes, held 0.1 s on screen", low: "", high: "an arm stretches or shrinks: its hand is held by something the arm does not follow", tol: 0.057, hard: [null, 0.34], fault: true },
  "fault.wristFold": { unit: "deg", what: "the wrist's most angle between forearm and hand, held 0.1 s with the hand on screen", low: "", high: "the hand folds back on the forearm past what a wrist can", tol: 3, hard: [null, 135], fault: true },
  "fault.gripLost": { unit: "forearms", length: true, what: "how far the handle's line leaves the fist, held 0.1 s with the hand on screen", low: "", high: "the weapon floats or turns in the hand where the player sees it", tol: 0.057, hard: [null, 0.34], fault: true },
  "fault.offhandLost": { unit: "forearms", length: true, what: "how far the off hand leaves the handle of a weapon held in both, held 0.1 s on screen", low: "", high: "the second hand lets go of a two-handed weapon", tol: 0.11, hard: [null, 0.9], fault: true },
  "fault.pops": { unit: "", what: "points (tip, wrists, elbows) that leave their way in a step and come back in another within 3 frames, with no slowing about it, on screen", low: "", high: "a point pops out and back where the player sees it: a glitch, not a fast move", tol: 0.5, hard: [null, 0], fault: true },
  "fault.elbowFlips": { unit: "", what: "frames where an arm's plane of shoulder, elbow and wrist turns over while it is bent, its forearm on screen", low: "", high: "an elbow swaps sides in a frame: the arm pops (a baked IK pole flip)", tol: 0.5, hard: [null, 0], fault: true },
  "tail.peeks": { unit: "", what: "times the weapon, a hand or an elbow comes back into view after the strike and leaves it again before the clip ends", low: "", high: "the arms bob back into view on their way home", tol: 0.5 },
  "tail.dip": { unit: "reaches", length: true, reach: true, what: "how far the tip drops after the follow-through below the lower of where that part begins and ends", low: "", high: "the arms dive under the view and come back up", tol: 0.039 },
  "tail.wander": { unit: "x", what: "the tip's path after the follow-through over the straight line from its start to its end", low: "", high: "a roundabout way home", tol: 0.1 },
  "tail.settle": { unit: "s", what: "from the follow-through's end until the tip comes to rest", low: "it stops at once", high: "still drifting long after the blow", tol: 0.05 },
  "tail.endFromIdle": { unit: "reaches", length: true, reach: true, what: "the tip at the clip's last frame from where the idle holds it", low: "the clip comes back to the idle by itself", high: "it ends away from the idle (an engine that blends takes it from there)", tol: 0.039 },
  "frame.tipOnScreen": { unit: "x", what: "share of strike frames with the tip on screen (FOV 90, 4:3)", low: "the player does not see the blow land", high: "", tol: 0.05 },
  "frame.tipOnScreenAtHit": { unit: "x", what: "tip on screen at the hit frame (1 yes)", low: "the tip is off screen when the damage lands", high: "", tol: 0.5 },
  "frame.nearArms": { unit: "x", what: "share of frames with an arm cut by the near plane in view", low: "", high: "the arm passes through the camera: seen cut open", tol: 0.03 },
  "frame.nearWeapon": { unit: "x", what: "share of frames with the weapon cut by the near plane in view", low: "", high: "the weapon passes through the camera", tol: 0.03 },
  "flow.stall": { unit: "deg/s", what: "the least, over the wind-up and into the strike, of the fastest arm joint's turn speed", low: "the whole arm stops at the cock and then swings: placed, stopped, swung", high: "the arm never slows into the strike", tol: 10 },
  "flow.lockstep": { unit: "r", what: "how alike the shoulder's, elbow's and wrist's speed curves are about the cock (Pearson, by the weaker joint's motion)", low: "the joints take turns: one keeps turning while another stops", high: "the joints slow and speed up together, as if interpolated between keys", tol: 0.1 },
};

/**
 * A blow's kind from its path (measure()'s info.path) as swing.mjs's KINDS name them, the striking hand's `side`
 * mirrored to a right hand's: a thrust turns the blade little (strike.turn under 60 degrees) and goes ahead more
 * than across; an overhead comes down more than twice as much as across; else a slash (right to left on screen,
 * for a right hand) or a backhand (left to right). { kind, path, blades } with the path and the blades (info.blades)
 * mirrored.
 */
export function blowKind(path, side = "R", turn = null, blades = null) {
  const L = side === "L" ? -1 : 1;
  const mirror = (o) => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [v[0], v[1] * L, v[2]]]));
  const p = mirror(path);
  const d = p.through.map((x, i) => x - p.cocked[i]);
  const kind =
    turn !== null && turn < 60 && d[0] > 0.5 * Math.hypot(d[1], d[2])
      ? "thrust"
      : d[2] < 0 && Math.abs(d[1]) < 0.5 * Math.abs(d[2])
        ? "overhead"
        : d[1] > 0
          ? "slash"
          : "backhand";
  return { kind, path: p, blades: mirror(blades) };
}

/** The weapon families the bands are kept for. */
export const FAMILIES = ["1h swords", "2h swords", "axes", "blunts", "polearms", "smallarms", "martial arts"];

/** An item's family from its view model and its skill. */
export function familyOf(model, stat = "") {
  const m = model.toLowerCase().replace(/^.*[\\/]/, "").replace(/\.mdl$/, "");
  if (/martial/.test(m)) return "martial arts";
  if (m === "v_1hswordssb" && /smallarms/.test(stat)) return "smallarms";
  if (/smallarms/.test(m)) return "smallarms";
  if (/2hswords/.test(m)) return "2h swords";
  if (/1hswords/.test(m)) return "1h swords";
  if (/axes/.test(m)) return "axes";
  if (/blunts/.test(m)) return "blunts";
  if (/polearm/.test(m)) return "polearms";
  return null;
}

// ── bands ──────────────────────────────────────────────────────────────────

/** Quantiles of weighted values: { n, median, q1, q3, p5, p95 }. */
export function band(values, weights = values.map(() => 1)) {
  const pairs = values.map((v, i) => [v, weights[i]]).filter((p) => p[0] !== null && Number.isFinite(p[0]));
  if (!pairs.length) return null;
  pairs.sort((a, b) => a[0] - b[0]);
  const total = pairs.reduce((s, p) => s + p[1], 0);
  // the value at a share of the weight, read between the midpoints of the weighted values
  const at = (q) => {
    let acc = 0;
    const mids = pairs.map(([x, w]) => {
      const m = (acc + w / 2) / total;
      acc += w;
      return [m, x];
    });
    if (q <= mids[0][0]) return mids[0][1];
    for (let i = 1; i < mids.length; i++)
      if (q <= mids[i][0]) {
        const [m0, x0] = mids[i - 1];
        const [m1, x1] = mids[i];
        return x0 + ((x1 - x0) * (q - m0)) / (m1 - m0 || 1);
      }
    return mids.at(-1)[1];
  };
  const r = (x) => Number(x.toFixed(4));
  return { n: pairs.length, median: r(at(0.5)), q1: r(at(0.25)), q3: r(at(0.75)), p5: r(at(0.05)), p95: r(at(0.95)) };
}

const fmt = (x) => (x === null || x === undefined ? "-" : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));

/**
 * Each measure against its band in `bands` (a reference game's, lib/bands.mjs: the family's when it has enough
 * sequences, else the game's whole). With a `strength` ("light" or "heavy") and a reference that keeps its blows
 * apart by it (Vermintide 2's: a heavy is released from a held charge, so it starts cocked and lands sooner after
 * its clip starts), that strength's family band first, then its whole, then as without:
 * [{ key, value, band, where: "in" | "edge" | "low" | "high" | "fault", far (in IQRs past p5/p95), say }].
 * A value past a body's hard limit is a fault whatever the band.
 */
export function verdicts(m, bands, family, strength = null) {
  const out = [];
  const ref = bands.reference ?? "the reference";
  const kept = strength && bands.strengths?.[strength];
  for (const [key, value] of Object.entries(m.values)) {
    const meta = MEASURES[key];
    if (!meta || value === null) continue;
    // a band only where it stands on five sequences or more (a model's submodels are not more sequences)
    const enough = (x) => x && (x.sequences ?? x.n) >= 5;
    const choices = [
      [kept && family && kept.families?.[family]?.[key], `${strength} ${family}`],
      [kept && kept.overall?.[key], `${strength}`],
      [family && bands.families?.[family]?.[key], family],
    ];
    const [b, from] = choices.find(([x]) => enough(x)) ?? [bands.overall[key], "all"];
    // (a measure bound to the rig's proportions is shown, not counted: another hand's curl round another handle)
    const entry = { key, value, band: b, from, noise: (bands.noise?.includes(key) ?? false) || !!meta.rigBound };
    // a hand that may let go (a one-handed weapon the off hand only rests on) has no hard limit
    const [hardLo, hardHi] = meta.heldOnly && m.info.twoHanded !== "held" ? [null, null] : meta.hard ?? [null, null];
    if ((hardLo !== null && value < hardLo) || (hardHi !== null && value > hardHi)) {
      entry.where = "fault";
      entry.say = `past a body's limit (${hardLo ?? "-"}..${hardHi ?? "-"}): ${value < (hardLo ?? -Infinity) ? meta.low : meta.high}`;
    } else if (meta.fault) {
      entry.where = "in";
      entry.say = "no fault";
    } else if (!b) {
      entry.where = "unbanded";
      entry.say = "no band";
    } else {
      const tol = meta.tol ?? 0;
      const lo = b.p5 - tol;
      const hi = b.p95 + tol;
      const iqr = Math.max(b.q3 - b.q1, tol, 1e-6);
      if (value < lo) {
        entry.where = "low";
        entry.far = (lo - value) / iqr;
        entry.say = `${fmt(lo - value)} ${meta.unit} below ${ref}'s 5% (${fmt(entry.far)} IQR): ${meta.low}`;
      } else if (value > hi) {
        entry.where = "high";
        entry.far = (value - hi) / iqr;
        entry.say = `${fmt(value - hi)} ${meta.unit} above ${ref}'s 95% (${fmt(entry.far)} IQR): ${meta.high}`;
      } else if (value < b.q1 - tol || value > b.q3 + tol) {
        entry.where = "edge";
        const side = value < b.q1 ? "low" : "high";
        const means = side === "low" ? meta.low : meta.high;
        entry.say = `inside ${ref}'s 5-95% but outside its middle half (${side}${means ? `: ${means}` : ""})`;
      } else {
        entry.where = "in";
        entry.say = `in ${ref}'s middle half`;
      }
      // a measure that counts on one side only (meta.counts: "low" or "high") is shown, not counted, past the other
      if (meta.counts && (entry.where === "low" || entry.where === "high") && entry.where !== meta.counts) entry.noise = true;
    }
    out.push(entry);
  }
  return out;
}

/**
 * One line for the whole sequence from its verdicts, and which layer decided it: `style` "like" | "near" |
 * "unlike" the reference, `faults` the body's. Measures of one kind (reach.*, elbow.*, timing.* ...)
 * say much the same thing, so they count once: FAILS on a fault, on any measure more than 3 IQR outside the reference's
 * 5-95%, or on two kinds more than 1 IQR outside; DOUBTFUL on one kind more than 1 IQR outside or three kinds
 * outside at all; else PASSES. The noise measures are not counted. Set on MSR's sequences each left out of
 * its own bands, and on the bad set (anims/tools/judge.mjs survey's numbers are in its report).
 *
 * Timing, as the owner chose (2026-10-22): "msc" (the default) holds the hit only to MSR's own loose bands;
 * "sync" also wants the damage within SYNC_FRAMES of the tip's fastest and in the strike or follow-through,
 * else the sequence is at best DOUBTFUL.
 */
export const SYNC_FRAMES = 3;
export function overall(list, info = {}, { timing = "msc", reference = "the reference" } = {}) {
  const kind = (v) => v.key.split(".")[0];
  const faults = list.filter((v) => v.where === "fault");
  const outside = list.filter((v) => (v.where === "low" || v.where === "high") && !v.noise);
  const far = outside.filter((v) => v.far > 1);
  const farthest = Math.max(0, ...outside.map((v) => v.far));
  const farKinds = new Set(far.map(kind)).size;
  const kinds = new Set(outside.map(kind)).size;
  const parts = [];
  if (faults.length) parts.push(`${faults.length} physical fault${faults.length > 1 ? "s" : ""} (${faults.map((v) => v.key).join(", ")})`);
  if (outside.length) parts.push(`${outside.length} measure${outside.length > 1 ? "s" : ""} outside ${reference}'s 5-95% (${outside.map((v) => v.key).join(", ")}), ${far.length} of them more than 1 IQR`);
  // the damage should land while the blade is moving through the target, whatever the reference does
  const offPhase = info.hitPhase && info.hitPhase !== "strike" && info.hitPhase !== "follow-through";
  const offPeak = info.hitFrame != null && info.peakFrame != null && Math.abs(info.hitFrame - info.peakFrame) > SYNC_FRAMES;
  const unsynced = timing === "sync" && (offPhase || offPeak);
  if (offPhase) parts.push(`the damage lands in the ${info.hitPhase}, not while the blade sweeps through${timing === "sync" ? "" : ` (as ${reference}'s own may)`}`);
  if (timing === "sync" && offPeak) parts.push(`the damage is ${fmt(Math.abs(info.hitFrame - info.peakFrame))} frames from the tip's fastest (sync wants ${SYNC_FRAMES} or fewer)`);
  const word = faults.length || farthest > 3 || farKinds >= 2 ? "FAILS" : farKinds || kinds >= 3 || unsynced ? "DOUBTFUL" : "PASSES";
  // the two layers apart: a body's faults (wrong whatever the style), and how far the blow is from the reference's
  // style (which also catches lifeless or wandering blows: the bad set's flat, noplane and short)
  const style = farthest > 3 || farKinds >= 2 ? "unlike" : farKinds || kinds >= 3 ? "near" : "like";
  const why = faults.length ? "physical faults" : word === "PASSES" ? "" : unsynced && style === "like" ? "timing" : `style: ${style === "unlike" ? "unlike" : "near the edge of"} ${reference}'s`;
  return { word, style, faults: faults.length, outside: outside.length, far: far.length, say: `${word}${why ? ` (${why})` : ""}: ${parts.length ? parts.join("; ") : `every measure within ${reference}'s own spread`}` };
}
