// Authoring: a first-person blow said by the weapon's PATH in the camera's space (where the tip is cocked, where
// it meets the target, where it is carried through, when the damage lands), and solved by IK into frames of the
// model's own skeleton, so that the arm, not the wrist, carries the blade.
//
//   const made = swing(buf, { kind: "slash", contact: { depth: 40, side: 0, height: -6 }, hitFrame: 18 });
//   addSequence(buf, { name: "my_slash", fps: made.fps, frames: made.frames, like: made.like });
//   made.plan       // the frames it chose: cocked (from), contact (the speed peak), through, the hit
//   made.shares     // how much of the strike's turning the shoulder, elbow and wrist did, against the wanted
//
// SPACE. A spec's places are from the EYE, in the view model's axes: [ahead, left, up] (+y is LEFT on screen),
// so [40, 0, 0] is 40 straight ahead on the crosshair. `{ depth, side, height }` says the same with `side`
// positive to the RIGHT. Inside, everything is in the model's space, where the eye is 1 above the origin
// (anims/lib/corpus.mjs).
//
// THE ARM. Ten numbers turn the striking arm away from the idle's first frame: the shoulder (the upper arm
// turned in the model, a rotation vector: 3), the elbow (Biped's hinge about the forearm's own z: 1), the wrist
// (the hand rolled about the forearm's length, as pronation does, then bent about its own y and z: 3) and the
// body (the clavicle, the part above the arm, turned in the model: 3; the shoulder's turn rides on it). The
// other arm and the weapon's bones under the hand are never moved: the hand keeps the handle where the model put
// it. The body moves as much as its share asks: none in MSR's manner (its shoulders stay put), a sixth of the
// turning in Vermintide 2's (its body carries near half the tip's travel). The elbow cannot leave its hinge; it,
// the shoulder's cone, the wrist's bend, the roll and the body's turn are kept inside a body's limits by
// penalties.
//
// HOW IT IS SOLVED. The spec becomes keys: rest (frame 0), any wind-up keys, cocked (`from`), contact, through,
// any recovery keys, rest (the last frame). Each key's arm is found by least squares: the tip at its place, the
// blade along its direction where one is given, and each joint kept near the key before at a cost (a joint
// that should do little of the blow is dear to move). Between rest and cocked and between through and rest the
// arm goes in its joints (a curve through the keys' arms, still at still keys), as an animator's keys go. The
// strike (cocked to through) is said by the path: the tip runs a curve through where the cocked, contact and
// through keys put it and the via points between (a circle's arc when there are only the three), timed so that
// it is fastest at contact (a cut) or a little before it (a thrust); each frame's arm is solved again with the
// tip on that curve, kept near the keys' arms. The costs are then set again until the joints' shares of the
// strike's turn are the ones asked for (by default the model's own attacks' shares), so the wrist does not do
// the arm's work. The shares may come from a reference's bands (swing's `style`: its family's medians of the
// judge's share.* measures) rather than the model's own attacks. A cut's blade at contact trails its motion as MSR's do (KINDS' `trail`) unless told.
import { readSequence, sequences, sequenceAt, bones as bonesOf } from "../../src/mdl.mjs";
import { rigOf, poseOfValues, worldOf, valuesOf, qmul, qconj, qturn, qabout, qunit, degreesOf } from "../../src/animate.mjs";
import { armBones, weaponOf, weaponPath, handSizes, EYE_ABOVE_ORIGIN } from "./corpus.mjs";
import { fingersOf } from "./judge.mjs";
import { rollBonesOf, turnRolls } from "./fitarms.mjs";

const DEG = Math.PI / 180;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => scale(a, 1 / (len(a) || 1));
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r2 = (v) => Number(v.toFixed(2));

// ── the kinds of blow: where a short sword's tip goes, from the eye ──────────
// Each is a starting point for a spec, not a copy of an MSR attack: the spec's own places win. `mscOffset` is
// how many frames after the hit the contact comes in MSC's manner (attack1 and 2 are fastest 4 after it),
// `syncOffset` the same for "sync" timing. `peakAt` says where the tip is fastest: "contact" for a cut (it meets
// the target at full speed and carries on), a share of the drive for a thrust (it is fastest on the way, meets
// the target still driving and slows as the arm straightens to the through point, its deepest). `trail`: unless
// told, a cut's blade at contact points ahead and back against its motion by this many degrees off the line from
// the eye, as MSR's do (attack1's and attack2's blades are 50 off ahead, on the side the blow comes from), which
// is also what straightens the arm at contact.
export const KINDS = {
  // forehand: cocked high on the right, down and across to the low left
  slash: {
    from: [2, -10, 12],
    contact: [38, -2, -8],
    through: [24, 16, -32],
    blade: { from: [-0.5, -0.4, 0.75] },
    phases: { windup: 0.35, strike: 0.25, follow: 0.12, recovery: 0.28 },
    mscOffset: 3,
    trail: 50,
  },
  // backhand: cocked across the body on the left, level to the right
  backhand: {
    from: [-6, 16, -2],
    contact: [37, 0, -4],
    through: [18, -34, 2],
    blade: { from: [-0.6, 0.75, 0.1] },
    phases: { windup: 0.36, strike: 0.25, follow: 0.1, recovery: 0.29 },
    mscOffset: 3,
    trail: 50,
  },
  // thrust: drawn back low on the right, driven straight at the crosshair, the point leading
  thrust: {
    from: [24, -9, -18],
    contact: [44, 0, -2],
    through: [47, 0, -2],
    blade: { from: [1, 0.05, 0.3], contact: [1, 0.05, 0.4], through: [1, 0.05, 0.35] },
    phases: { windup: 0.4, strike: 0.2, follow: 0.12, recovery: 0.28 },
    peakAt: 0.65,
    mscOffset: 1,
    syncOffset: 0,
    // the drive starts gently (a quick start would take its speed from the middle) and carries on into its
    // full reach, turning back there without stopping dead
    flow: { enter: 0.3, leave: 1, lead: 0.75 },
  },
  // overhead: cocked above and behind the head, down the middle
  overhead: {
    from: [0, -4, 20],
    contact: [40, 0, -4],
    through: [26, 2, -34],
    blade: { from: [-0.6, 0, 0.8] },
    phases: { windup: 0.38, strike: 0.24, follow: 0.1, recovery: 0.28 },
    mscOffset: 3,
    trail: 50,
  },
};

/** Shares used when a model has no attacks of its own to measure (the short sword's: 0.58, 0.25, 0.17). */
const FALLBACK_SHARES = { shoulder: 0.58, elbow: 0.25, wrist: 0.17, body: 0 };
/** The joints whose shares of the turning a blow is balanced by. */
export const JOINTS = ["shoulder", "elbow", "wrist", "body"];

// ── limits of a body (degrees), kept by penalties ────────────────────────────
// The elbow's bend from straight, the shoulder's turn from the idle's, the wrist's bend and roll from the idle's.
// Inside MSR's own: elbow.min down to -3 and elbow.max to 114, shoulder.cone to 105, wrist.bend to 73,
// wrist.twist to 92 (anims/corpus/bands.json, 1h swords).
// The body's turn: the clavicle's (Vermintide 2's clavicle and spine together).
const LIMITS = { bendLeast: 4, bendMost: 135, cone: 100, wristBend: 55, roll: 85, body: 35 };
/**
 * How far a style may widen the limits: a body's (a shoulder's raise and swing, a wrist's bend, a forearm's
 * turn). Vermintide 2's rig bends its hand bone past them (its wrist.bend to 172 at the 95th, the fingers making up
 * for it); a GoldSrc arm bent so looks broken.
 */
const BODY_MOST = { cone: 140, wristBend: 90, roll: 120 };
/** How hard a limit pushes back: units of tip error a radian past it. */
const LIMIT_WEIGHT = 80;
/** How hard a joint is held near its reference: units of tip error a radian, before the joint's own cost. */
const HOLD = 3;
/** How hard a blade direction is held: units of tip error per unit of direction error (the blade is ~26 long). */
const BLADE_WEIGHT = 8;
/**
 * How hard the edge is held into the cut (where the weapon's head is flat: judge.edgeOf): its lean off the plane of
 * the blade and the way the tip goes, weighed as the blade's direction is. Vermintide 2's and MSR's cuts lead with
 * the edge (edge.lead 8 and 6 deg at the median); the blade's direction alone leaves the edge free to face anywhere.
 */
const EDGE_WEIGHT = 8;
/**
 * The edge's lean left free (degrees): a hand does not hold it exactly into the cut (Vermintide 2's lean 8 at the
 * median, 4 at its 5%; held to nought, the backhand's leaned 0.4, past Vermintide's least)
 */
const EDGE_FREE = 8;
/** A way under this share across the blade is a thrust's, along it: no edge to lead. */
const EDGE_ACROSS = 0.5;

// ── the arm ─────────────────────────────────────────────────────────────────

/**
 * The striking arm of a model, ready to be posed by seven numbers: its bones, the idle's first frame (`base`),
 * the weapon's tip and grip on their bone, the elbow's bend at rest.
 */
export function armOf(buf, { bodypart = 0, submodel = 0, rest } = {}) {
  const rig = rigOf(buf);
  const arms = armBones(buf, { bodypart, submodel });
  const weapon = weaponOf(buf, { bodypart, submodel, arms });
  if (weapon.empty) throw new Error("swing: no weapon in that submodel");
  const side = weapon.hand ?? "R";
  const { shoulder: upper, elbow: fore, hand } = arms[side];
  if ([upper, fore, hand].some((b) => b === undefined)) throw new Error(`swing: no ${side} arm bones`);
  const idle = rest ?? sequences(buf).find((s) => /idle/i.test(s.name))?.name ?? 0;
  const baseValues = readSequence(buf, idle).frames[0];
  const base = poseOfValues(rig, baseValues);
  const baseWorld = worldOf(rig, base);
  // the forearm's child (the hand) along its x, and the elbow a hinge across it: Biped's about the forearm's z;
  // another rig's (Comp-3's arms, rpg_sbox) about the axis the idle bends it about, so long as that is across the
  // forearm (no twist in it)
  const handAt = base.p[hand];
  if (Math.hypot(handAt[1], handAt[2]) > 0.05 * len(handAt)) throw new Error("swing: the forearm is not a Biped forearm (its hand is not along its x)");
  const turn = base.q[fore];
  let hinge = [0, 0, 1];
  if (Math.hypot(turn[1], turn[2]) > 0.02) {
    const across = Math.hypot(turn[2], turn[3]);
    if (Math.abs(turn[1]) > 0.02 || across < 1e-6) throw new Error("swing: the idle's elbow twists about the forearm's length: it is not a hinge");
    // its sign as Biped's: the bend is the turn the other way about it
    hinge = [0, -turn[2] / across, -turn[3] / across];
  }
  const bendRest = -2 * Math.atan2(turn[1] * hinge[0] + turn[2] * hinge[1] + turn[3] * hinge[2], turn[0]);
  // the off arm's elbow the same way, where it is a hinge (else the off hand is not reached for, only swung)
  const offSide = side === "R" ? "L" : "R";
  const offElbow = arms[offSide]?.elbow;
  let offHinge = null;
  let offBendRest = 0;
  if (offElbow !== undefined && arms[offSide]?.hand !== undefined) {
    const q = base.q[offElbow];
    const across = Math.hypot(q[2], q[3]);
    const offHandAt = base.p[arms[offSide].hand];
    const alongX = Math.hypot(offHandAt[1], offHandAt[2]) <= 0.05 * len(offHandAt);
    if (alongX && Math.hypot(q[1], q[2], q[3]) <= 0.02) offHinge = [0, 0, 1];
    else if (alongX && Math.abs(q[1]) <= 0.02 && across > 1e-6) offHinge = [0, -q[2] / across, -q[3] / across];
    if (offHinge) offBendRest = -2 * Math.atan2(q[1] * offHinge[0] + q[2] * offHinge[1] + q[3] * offHinge[2], q[0]);
  }
  // the trunk: the lowest bone above both arms' clavicles (Biped's neck), which carries the off arm with the
  // striking one when the body turns
  const clavicle = rig.bones[upper].parent;
  const otherSide = side === "R" ? "L" : "R";
  const chain = (i) => {
    const out = [];
    for (; i >= 0; i = rig.bones[i].parent) out.push(i);
    return out;
  };
  const otherClavicle = arms[otherSide]?.shoulder !== undefined ? rig.bones[arms[otherSide].shoulder].parent : -1;
  const theirs = new Set(otherClavicle >= 0 ? chain(otherClavicle) : []);
  const trunk = clavicle >= 0 ? chain(rig.bones[clavicle].parent).find((i) => theirs.has(i)) ?? -1 : -1;
  const sizes = handSizes(buf, { bodypart, submodel, arms, weapon });
  const offFingers = arms[otherSide]?.hand !== undefined ? handOf(rig, base, baseWorld, arms[otherSide].hand) : null;
  if (offFingers?.channel && sizes.handle && sizes.finger) offFingers.channel.seat = seatOf(base, offFingers, sizes);
  return {
    rig,
    side,
    // each hand's fingers as the grip closes them (handOf), and the sizes they close round
    fingers: handOf(rig, base, baseWorld, hand),
    offFingers,
    sizes,
    upper,
    fore,
    hand,
    clavicle,
    trunk,
    forearm: len(handAt),
    // the off arm, swung with the blow by `offArm` of the striking shoulder's turn (none unless told)
    offUpper: arms[otherSide]?.shoulder ?? -1,
    offFore: arms[otherSide]?.elbow ?? -1,
    offHand: arms[otherSide]?.hand ?? -1,
    // the off arm's length, shoulder to wrist at rest: how far from its shoulder the off hand can take the handle
    offLength:
      arms[otherSide]?.hand !== undefined && arms[otherSide]?.elbow !== undefined && arms[otherSide]?.shoulder !== undefined
        ? len(sub(baseWorld[arms[otherSide].elbow].p, baseWorld[arms[otherSide].shoulder].p)) + len(sub(baseWorld[arms[otherSide].hand].p, baseWorld[arms[otherSide].elbow].p))
        : 0,
    // both hands on the handle (swing sets it for a spec whose offHand is "grip"): the striking arm keeps the handle
    // within the off arm's reach
    bothHands: false,
    offHinge,
    offBendRest,
    offArm: 0,
    // the share of the body's turn the trunk takes (the rest the clavicle's): none unless a style or spec says
    trunkShare: 0,
    limits: { ...LIMITS },
    weapon,
    idle: typeof idle === "number" ? sequences(buf)[idle].name : idle,
    like: sequenceAt(buf, idle),
    base,
    baseValues,
    // the arms' roll bones (a fitted rig's, fitarms.mjs): each frame's turned from the hand's roll and the upper arm's
    // twist, and a forearm with one keeps its own roll off (shareRoll)
    bones: bonesOf(buf),
    rolls: rollBonesOf(bonesOf(buf), arms),
    baseWorld,
    bendRest,
    hinge,
  };
}

/** A rotation vector (axis times angle, radians) as a quaternion. */
function qOfVector(v) {
  const angle = len(v);
  return angle < 1e-12 ? [1, 0, 0, 0] : qabout(scale(v, 1 / angle), angle);
}

/**
 * The pose of ten numbers: [shoulder x, y, z (a rotation vector in the model), elbow, roll, wrist y, wrist z,
 * body x, y, z (the clavicle's turn, a rotation vector in the model)]; seven leave the body as it is. The body's
 * turn is shared between the trunk (arm.trunkShare of it, carrying both arms) and the clavicle (the rest).
 */
export function poseFrom(arm, p) {
  const { base, baseWorld, upper, fore, hand, clavicle, trunk } = arm;
  const pose = { q: base.q.map((q) => [...q]), p: base.p.map((x) => [...x]) };
  const parent = clavicle < 0 ? [1, 0, 0, 0] : baseWorld[clavicle].q;
  if (clavicle >= 0 && (p[7] || p[8] || p[9])) {
    const body = [p[7], p[8], p[9]];
    const t = trunk >= 0 ? arm.trunkShare ?? 0 : 0;
    const worldOfParent = (i) => (arm.rig.bones[i].parent < 0 ? [1, 0, 0, 0] : baseWorld[arm.rig.bones[i].parent].q);
    const turnT = qOfVector(scale(body, t));
    if (t > 0) pose.q[trunk] = qunit(qmul(qconj(worldOfParent(trunk)), qmul(turnT, baseWorld[trunk].q)));
    // the clavicle's world: the rest of the turn on top of the trunk's; its parent rides on the trunk when below it
    const above = arm.rig.bones[clavicle].parent;
    let underTrunk = false;
    for (let i = above; i >= 0; i = arm.rig.bones[i].parent) if (i === trunk) underTrunk = true;
    const parentWorld = above < 0 ? [1, 0, 0, 0] : t > 0 && underTrunk ? qmul(turnT, baseWorld[above].q) : baseWorld[above].q;
    // the clavicle turned in the model; the upper arm's turn below is taken in its base, so it rides on this
    pose.q[clavicle] = qunit(qmul(qconj(parentWorld), qmul(qOfVector(scale(body, 1 - t)), qmul(turnT, baseWorld[clavicle].q))));
  }
  pose.q[upper] = qunit(qmul(qconj(parent), qmul(qOfVector([p[0], p[1], p[2]]), baseWorld[upper].q)));
  // the off arm with the blow (numbers 11 to 13, set by swing per frame): its upper arm turned in the model by that
  // rotation vector (on top of the trunk's, which its clavicle rides), its elbow straightened as far as that turn
  // goes (a radian: all the way), as Vermintide 2's heavies fling the off arm out with the swing
  if ((p[10] || p[11] || p[12] || p[13]) && arm.offUpper >= 0) {
    const t = trunk >= 0 && clavicle >= 0 ? arm.trunkShare ?? 0 : 0;
    const turnT = t > 0 ? qOfVector(scale([p[7] ?? 0, p[8] ?? 0, p[9] ?? 0], t)) : [1, 0, 0, 0];
    const offClavicle = arm.rig.bones[arm.offUpper].parent;
    const clavicleWorld = offClavicle < 0 ? [1, 0, 0, 0] : qmul(turnT, baseWorld[offClavicle].q);
    const swing = [p[10], p[11], p[12]];
    pose.q[arm.offUpper] = qunit(qmul(qconj(clavicleWorld), qmul(qOfVector(swing), qmul(turnT, baseWorld[arm.offUpper].q))));
    if (arm.offFore >= 0 && p[13] !== undefined && arm.offHinge) {
      // its own bend from rest (reached for: offReach)
      pose.q[arm.offFore] = qabout(arm.offHinge, -(arm.offBendRest + p[13]));
    } else if (arm.offFore >= 0) {
      const straight = clamp(len(swing), 0, 1);
      const q0 = base.q[arm.offFore];
      // toward the forearm in line with the upper arm (Biped's: no turn), by a normalised blend
      const sgn = q0[0] < 0 ? -1 : 1;
      pose.q[arm.offFore] = qunit(q0.map((v, i) => v * (1 - straight) + (i === 0 ? sgn : 0) * straight));
    }
  }
  // the off hand turned in its own space (numbers 15 to 17, a rotation vector: offReach aims it at a handle)
  if (arm.offHand >= 0 && (p[14] || p[15] || p[16])) pose.q[arm.offHand] = qunit(qmul(base.q[arm.offHand], qOfVector([p[14], p[15], p[16]])));
  pose.q[fore] = qabout(arm.hinge, -(arm.bendRest + p[3]));
  // the roll about the forearm's length (the forearm's x), then the bend about the hand's own axes
  pose.q[hand] = qunit(qmul(qabout([1, 0, 0], p[4]), qmul(base.q[hand], qmul(qabout([0, 1, 0], p[5]), qabout([0, 0, 1], p[6])))));
  const rolled = (b) => arm.rolls?.some((r) => r.kind === "fore" && r.parent === b);
  if (!rolled(fore)) shareRoll(pose, base, fore, hand);
  if (arm.offHinge && arm.offFore >= 0 && arm.offHand >= 0 && !rolled(arm.offFore)) shareRoll(pose, base, arm.offFore, arm.offHand);
  return pose;
}

/** The share of a hand's roll about the forearm's length that the forearm bone takes (the rest stays at the wrist). */
const ROLL_SHARE = 0.5;

/** A turn's twist about a unit axis (x unless told), in radians (-PI to PI). */
const twistX = (q, u = [1, 0, 0]) => {
  const t = 2 * Math.atan2(q[1] * u[0] + q[2] * u[1] + q[3] * u[2], q[0]);
  return t > Math.PI ? t - 2 * Math.PI : t < -Math.PI ? t + 2 * Math.PI : t;
};

/**
 * A hand's roll about its forearm's length (its twist about the forearm's x, from the idle's) shared with the forearm:
 * ROLL_SHARE of it turns the forearm bone about its own length (the line to the hand's joint: a rig's hand is not quite on
 * the forearm's x, and a turn about x would move it) and the hand takes the rest, the hand exactly where it was.
 * GoldSrc arms have no twist bones: a forearm's whole roll on the hand bone wrings the wrist's skin like a sweet's
 * wrapper (MSR's sword wrist turned 60 to 88 degrees in a follow-through); a forearm turns along its length.
 */
// (a rig with a forearm roll bone, fitarms.mjs, has the share on that bone instead: turnRolls)
function shareRoll(pose, base, fore, hand) {
  const u = unit(base.p[hand]);
  let t = twistX(pose.q[hand], u) - twistX(base.q[hand], u);
  t = t > Math.PI ? t - 2 * Math.PI : t < -Math.PI ? t + 2 * Math.PI : t;
  const moved = ROLL_SHARE * t;
  if (Math.abs(moved) < 1e-9) return;
  pose.q[fore] = qunit(qmul(pose.q[fore], qabout(u, moved)));
  pose.q[hand] = qunit(qmul(qabout(u, -moved), pose.q[hand]));
}

/** The eye, in the model's space. */
const EYE = [0, 0, EYE_ABOVE_ORIGIN];
/** No point of the arm in view nearer the eye than this many forearms (solve). */
const EYE_ROOM = 0.9;
/** In view: within this many degrees of the line of sight. */
const EYE_CONE = 65;

/**
 * How far points along the arm (the upper arm's middle, the elbow, the forearm's middle, the wrist) come into the
 * room before the eye, each as a share of EYE_ROOM forearms, where they are in view (within EYE_CONE degrees of
 * the line of sight, eased out over the last 10): a point beside or behind the eye is not seen cut.
 */
function tooNear(arm, at) {
  const shoulder = at.world[arm.upper].p;
  // the arm (the upper arm's middle, the elbow, the forearm's middle, the wrist) and the weapon (its butt, the grip,
  // a quarter, half and three quarters up the blade): a two-handed grip cocked by the shoulder brought the hilt and
  // the blade across the eye
  return nearness(arm, [lerp(shoulder, at.elbow, 0.5), at.elbow, lerp(at.elbow, at.wrist, 0.5), at.wrist, at.butt, at.grip, lerp(at.grip, at.tip, 0.25), lerp(at.grip, at.tip, 0.5), lerp(at.grip, at.tip, 0.75)]);
}
/** How far each point in view comes inside EYE_ROOM forearms of the eye (shares of it, 0 outside or unseen). */
function nearness(arm, points) {
  const room = EYE_ROOM * arm.forearm;
  return points.map((p) => {
    const q = sub(p, EYE);
    const off = Math.atan2(Math.hypot(q[1], q[2]), q[0]) / DEG;
    const seen = clamp((EYE_CONE - off) / 10, 0, 1);
    return (seen * Math.max(0, room - len(q))) / room;
  });
}
/** Is some point of the arm in view nearer the eye than EYE_ROOM forearms, in a pose of ten numbers? */
const nearEye = (arm, p) => tooNear(arm, pointsOf(arm, p)).some((x) => x > 0);

/** The blade's weight, as a share, where a frame is solved again to keep the arm and hilt off the camera. */
const EYE_BLADE = 0.1;

/** A reference's place is kept within this share of the arm's full reach from its shoulder. */
const REACHABLE = 0.95;

/** The arm's full reach at rest, as the judge takes it: upper arm, forearm, and the hand to the weapon's tip. */
export function fullReachOf(arm) {
  const { tip, wrist, elbow, world } = pointsOf(arm, JOINT.map(() => 0));
  return len(sub(elbow, world[arm.upper].p)) + len(sub(wrist, elbow)) + len(sub(tip, wrist));
}

/** The weapon's tip and grip, and the blade's direction, in a pose of ten numbers. */
export function pointsOf(arm, p) {
  const world = worldOf(arm.rig, poseFrom(arm, p));
  const at = (point) => add(world[point.bone].p, qturn(world[point.bone].q, point.p));
  const tip = at(arm.weapon.tip);
  const grip = at(arm.weapon.grip);
  const edge = arm.weapon.edge ? qturn(world[arm.weapon.edge.bone].q, arm.weapon.edge.d) : null;
  return { tip, grip, butt: at(arm.weapon.butt), blade: unit(sub(tip, grip)), edge, wrist: world[arm.hand].p, elbow: world[arm.fore].p, world };
}

/** How far each limit is passed (radians, 0 inside). */
function pastLimits(arm, p) {
  const LIMITS = arm.limits;
  const bend = arm.bendRest + p[3];
  return [
    Math.max(0, LIMITS.bendLeast * DEG - bend) + Math.max(0, bend - LIMITS.bendMost * DEG),
    Math.max(0, len([p[0], p[1], p[2]]) - LIMITS.cone * DEG),
    Math.max(0, Math.hypot(p[5], p[6]) - LIMITS.wristBend * DEG),
    Math.max(0, Math.abs(p[4]) - LIMITS.roll * DEG),
    Math.max(0, Math.hypot(p[7] ?? 0, p[8] ?? 0, p[9] ?? 0) - LIMITS.body * DEG),
  ];
}

/** Which joint each of the ten numbers belongs to. */
const JOINT = ["shoulder", "shoulder", "shoulder", "elbow", "wrist", "wrist", "wrist", "body", "body", "body"];

/**
 * The ten numbers nearest `start` that put the arm's `point` ("tip" or "grip") at `place` (the model's space),
 * the blade along `blade` where given, each number held near `ref` at its joint's cost (`costs`), the limits
 * kept: least squares by Levenberg-Marquardt on a numeric Jacobian.
 */
export function solve(arm, start, { place, point = "tip", blade, bladeWeight = BLADE_WEIGHT, ref, costs, hold = HOLD, way = null }) {
  const weights = JOINT.map((j) => hold * Math.sqrt(costs[j]));
  const residual = (p) => {
    const at = pointsOf(arm, p);
    const r = [...sub(at[point], place)];
    if (blade) r.push(...scale(sub(at.blade, blade), bladeWeight));
    // the edge into the cut: square to the blade and to the way the tip goes across it, either edge
    if (way && at.edge) {
      const across = cross(at.blade, way);
      r.push(len(across) >= EDGE_ACROSS * len(way) ? EDGE_WEIGHT * Math.max(0, Math.abs(dot(at.edge, unit(across))) - Math.sin(EDGE_FREE * DEG)) : 0);
    }
    for (let i = 0; i < JOINT.length; i++) r.push(weights[i] * (p[i] - (ref[i] ?? 0)));
    for (const past of pastLimits(arm, p)) r.push(LIMIT_WEIGHT * past);
    // both hands on the handle: the handle kept within the off arm's reach (a slash cocked out to the right is past it)
    if (arm.bothHands) {
      const on = add(at.grip, scale(sub(at.butt, at.grip), GRIP_ALONG));
      r.push(LIMIT_WEIGHT * Math.max(0, len(sub(on, at.world[arm.offUpper].p)) - GRIP_REACH * arm.offLength));
    }
    // the arm kept off the camera (a sleeve passed through the eye is seen cut open by the near plane)
    for (const x of tooNear(arm, at)) r.push(LIMIT_WEIGHT * x);
    return r;
  };
  const sumsq = (r) => r.reduce((s, v) => s + v * v, 0);
  let p = JOINT.map((_, i) => start[i] ?? 0);
  let r = residual(p);
  let cost = sumsq(r);
  let mu = 1e-3;
  const h = 1e-5;
  for (let iteration = 0; iteration < 60; iteration++) {
    const J = Array.from({ length: JOINT.length }, (_, k) => {
      const q = [...p];
      q[k] += h;
      return residual(q).map((v, i) => (v - r[i]) / h);
    });
    const A = J.map((a) => J.map((b) => a.reduce((s, v, i) => s + v * b[i], 0)));
    const g = J.map((a) => a.reduce((s, v, i) => s + v * r[i], 0));
    let better = false;
    while (mu < 1e8) {
      const M = A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + mu) + 1e-9 : v)));
      const step = linearSolve(M, g.map((v) => -v));
      const trial = p.map((v, i) => v + step[i]);
      const rt = residual(trial);
      const ct = sumsq(rt);
      if (ct < cost) {
        better = cost - ct > 1e-10 * (1 + cost);
        [p, r, cost] = [trial, rt, ct];
        mu = Math.max(mu / 4, 1e-9);
        break;
      }
      mu *= 5;
    }
    if (!better) break;
  }
  const at = pointsOf(arm, p);
  return { p, miss: len(sub(at[point], place)), bladeOff: blade ? Math.acos(clamp(dot(at.blade, blade), -1, 1)) / DEG : null };
}

/**
 * The off arm's four numbers (its upper arm's turn in the model, its elbow's bend from rest: poseFrom's 11 to 14)
 * that put the off hand (its wrist) at `place`, the striking arm and the body as `p` has them: kept near `ref`
 * and the elbow within a body's bend.
 */
export function offReach(arm, p, place, ref = [0, 0, 0, 0], hold = OFF_HOLD, aim = null) {
  const worldAt = (x) => worldOf(arm.rig, poseFrom(arm, [...p.slice(0, JOINT.length), ...x]));
  // with an aim ({ axis }: the handle's way, butt to tip), the hand's channel (handOf) is put at the place and turned
  // along the handle, the hand turned at the wrist too (seven numbers); else its wrist is put there
  const channel = aim && arm.offFingers?.channel;
  const at = (x) => {
    const h = worldAt(x)[arm.offHand];
    return channel ? add(h.p, qturn(h.q, (channel.seat ?? channel).centre)) : h.p;
  };
  const residual = (x) => {
    const w = worldAt(x);
    const [s, e, h] = [w[arm.offUpper].p, w[arm.offFore].p, w[arm.offHand].p];
    const r = channel ? [...sub(add(h, qturn(w[arm.offHand].q, (channel.seat ?? channel).centre)), place)] : [...sub(h, place)];
    if (channel) {
      for (const v of sub(qturn(w[arm.offHand].q, channel.axis), aim.axis)) r.push((aim.weight ?? AIM_WEIGHT) * arm.forearm * v);
      // its turn about the forearm's length (the hand's x along it, a Biped's) is the forearm's roll, which the off
      // arm has no number of its own for; the rest the wrist's bend: each kept to the striking arm's limits
      const turn = qOfVector([x[4] ?? 0, x[5] ?? 0, x[6] ?? 0]);
      const roll = twistX(turn);
      const bend = 2 * Math.acos(clamp(Math.abs(qmul(turn, qabout([1, 0, 0], -roll))[0]), 0, 1));
      // the off arm is not a style's: a body's own limits (LIMITS), not the style's wider ones
      r.push(LIMIT_WEIGHT * arm.forearm * Math.max(0, Math.abs(roll) - LIMITS.roll * DEG));
      r.push(LIMIT_WEIGHT * arm.forearm * Math.max(0, bend - LIMITS.wristBend * DEG));
    }
    // kept off the camera as the striking arm is
    for (const near of nearness(arm, [lerp(s, e, 0.5), e, lerp(e, h, 0.5), h])) r.push(LIMIT_WEIGHT * arm.forearm * near);
    for (let i = 0; i < x.length; i++) r.push(hold * arm.forearm * (x[i] - (ref[i] ?? 0)));
    const bend = arm.offBendRest + x[3];
    r.push(LIMIT_WEIGHT * arm.forearm * Math.max(0, LIMITS.bendLeast * DEG - bend, bend - LIMITS.bendMost * DEG));
    return r;
  };
  const sumsq = (r) => r.reduce((s, v) => s + v * v, 0);
  let x = channel ? [...ref, 0, 0, 0].slice(0, 7) : [...ref];
  let r = residual(x);
  let cost = sumsq(r);
  let mu = 1e-3;
  for (let iteration = 0; iteration < 40; iteration++) {
    const J = x.map((_, k) => {
      const q = [...x];
      q[k] += 1e-5;
      return residual(q).map((v, i) => (v - r[i]) / 1e-5);
    });
    const A = J.map((a) => J.map((b) => a.reduce((s, v, i) => s + v * b[i], 0)));
    const g = J.map((a) => a.reduce((s, v, i) => s + v * r[i], 0));
    let better = false;
    while (mu < 1e8) {
      const step = linearSolve(A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + mu) + 1e-9 : v))), g.map((v) => -v));
      const trial = x.map((v, i) => v + step[i]);
      const rt = residual(trial);
      const ct = sumsq(rt);
      if (ct < cost) {
        better = cost - ct > 1e-10 * (1 + cost);
        [x, r, cost] = [trial, rt, ct];
        mu = Math.max(mu / 4, 1e-9);
        break;
      }
      mu *= 5;
    }
    if (!better) break;
  }
  return { x, miss: len(sub(at(x), place)) };
}
/** Where the off hand takes the handle: this share of the way from the striking hand's grip to the butt. */
const GRIP_ALONG = 0.6;
/** The handle kept within this share of the off arm's length from its shoulder (the wrist beside it, not on it). */
const GRIP_REACH = 0.95;
/** How loosely the off arm is held to its last pose while it keeps to the handle (as OFF_HOLD). */
const GRIP_HOLD = 0.03;
/** The off hand's own turn is back at rest this many frames after it lets go of the handle. */
const RELEASE_FRAMES = 10;
/** The off hand lets go of the handle after the hit where it would be more than this far from it (forearms). */
const LET_GO = 0.1;
/** A blow that ends on a held pose glides there from the through point with a key every this many frames. */
const GLIDE_EVERY = 6;
/** How hard the off hand's channel is turned along the handle after the hit, when it holds on to the end. */
const AIM_AFTER = 0.5;
/** How hard the off hand's channel is turned along the handle (per unit of the two ways' difference, in forearms). */
const AIM_WEIGHT = 2;
/** The striking hand is closed on the handle by this share of the wind-up (Vermintide 2's squeeze early in it). */
const SQUEEZE_BY = 0.4;
/** The off hand's fingers close on the handle over this many frames before it holds it, and open as long after. */
const OFF_CLOSE_FRAMES = 6;
/** How near its rest the off arm is kept while it reaches (per radian, in forearms). */
const OFF_HOLD = 0.3;

// ── fingers: closed round the handle ──────────────────────────────────────

/** Each joint's share of a finger's closing, knuckle out (a fingertip's last joint bends less). */
const CLOSE_SHARES = [1, 1, 0.75];
/**
 * A palm bone's share of its finger's closing from the rest (a palm cupped round the handle). Vermintide 2's,
 * measured at the hit of 120 blows against the bind pose: the pinky's palm folds 7 deg as its knuckle closes 39 (0.18); the others' do
 * not move (under 1 deg against 47-57): its palm bones shape the skin, and only the little finger's side cups.
 */
const CUP = { pinky: 0.18 };
/** A finger's end past its last joint, as a share of that joint's offset from the one before (judge's NAIL). */
const FINGER_END = 0.8;
/** No finger curls more than this (degrees, the judge's curl: its segments' turns, the hand's origin out). */
const FIST = 265;
/** The closing tried, degrees from the idle's (a finger through the handle at idle is opened). */
const CLOSE_FROM = -40;
const CLOSE_TO = 120;
/** A finger holds the handle when pressed this share of its thickness into it (flesh gives: MSR's own grips are). */
const PRESS = 0.25;

/**
 * A hand's fingers as the grip closes them: { hand, fingers: { name: { palm, joints, axes } } } with the joints
 * from the knuckle out (judge.fingersOf; palm bones, Vermintide 2's and the fitter's, are left as they are) and the axis each closes
 * about, in its own space: the normal of the plane the finger curls in at the idle (its segments' crosses summed),
 * so that a finger closes in its own plane whatever the rig. And its channel: where a handle goes through the hand
 * as its fingers curl at the idle ({ centre, axis } in the hand's space: the mean of the circles through each finger's
 * knuckle, middle joint and end, and of their planes' normals, turned to point the way the thumb's end goes): MSR's
 * sword hand's is within 4 degrees and a quarter of a unit of the handle it holds. Null for a hand without fingers.
 */
function handOf(rig, base, baseWorld, hand) {
  const named = fingersOf(rig.bones, hand);
  const fingers = {};
  // the rest (a GoldSrc model's bind pose, the hand as it was skinned): a cupped palm's measure starts there
  const restWorld = worldOf(rig, rig.rest);
  const bendAt = (world, a, b, c) => Math.acos(clamp(dot(unit(sub(world[b].p, world[a].p)), unit(sub(world[c].p, world[b].p))), -1, 1));
  for (const [name, chain] of Object.entries(named)) {
    const joints = chain.filter((j) => !/inhand|palm/i.test(rig.bones[j].name));
    const palm = chain.filter((j) => !joints.includes(j));
    if (joints.length < 2) continue;
    const pts = [baseWorld[hand].p, ...chain.map((j) => baseWorld[j].p)];
    pts.push(add(pts.at(-1), qturn(baseWorld[chain.at(-1)].q, scale(base.p[chain.at(-1)], FINGER_END))));
    let n = [0, 0, 0];
    for (let i = 2; i < pts.length; i++) n = add(n, cross(sub(pts[i - 1], pts[i - 2]), sub(pts[i], pts[i - 1])));
    // a straight finger: the hand's own z (a Biped's fingers bend about their z, as its elbow)
    if (len(n) < 1e-6) n = qturn(baseWorld[hand].q, [0, 0, 1]);
    n = unit(n);
    fingers[name] = { palm, joints, axes: joints.map((j) => qturn(qconj(baseWorld[j].q), n)), palmAxes: palm.map((j) => qturn(qconj(baseWorld[j].q), n)), cup: palm.length ? CUP[name] ?? 0 : 0 };
    // how far the knuckle is closed at the idle already, from the rest: the palm's cup counts from there
    const fg = fingers[name];
    fg.cupFrom = fg.cup && joints.length >= 2 ? bendAt(baseWorld, palm.at(-1), joints[0], joints[1]) - bendAt(restWorld, palm.at(-1), joints[0], joints[1]) : 0;
  }
  if (!Object.keys(fingers).length) return null;
  const inHand = (p) => qturn(qconj(baseWorld[hand].q), sub(p, baseWorld[hand].p));
  const endOf = (chain) => inHand(add(baseWorld[chain.at(-1)].p, qturn(baseWorld[chain.at(-1)].q, scale(base.p[chain.at(-1)], FINGER_END))));
  let [centre, axis, k] = [[0, 0, 0], [0, 0, 0], 0];
  for (const name of ["index", "middle", "ring", "pinky"]) {
    const fg = fingers[name];
    if (!fg || fg.joints.length < 2) continue;
    const [a, b, c] = [inHand(baseWorld[fg.joints[0]].p), inHand(baseWorld[fg.joints[1]].p), endOf(fg.joints)];
    const [ab, ac] = [sub(b, a), sub(c, a)];
    const n = cross(ab, ac);
    const nn = dot(n, n);
    if (nn < 1e-12) continue;
    // the circle through the three: its centre
    centre = add(centre, add(a, scale(add(scale(cross(n, ab), dot(ac, ac)), scale(cross(ac, n), dot(ab, ab))), 1 / (2 * nn))));
    axis = add(axis, k && dot(n, axis) < 0 ? scale(unit(n), -1) : unit(n));
    k++;
  }
  let channel = null;
  if (k) {
    centre = scale(centre, 1 / k);
    axis = unit(axis);
    if (fingers.thumb && dot(sub(endOf(fingers.thumb.joints), centre), axis) < 0) axis = scale(axis, -1);
    channel = { centre, axis };
  }
  return { hand, fingers, channel };
}

/** The handle is seated this far at most from a hand's channel toward its palm (units of the handle's radius), SEAT_STEPS tried. */
const SEAT_MOST = 1.5;
const SEAT_STEPS = 15;

/**
 * Where a hand's idle fist takes a handle best ({ centre, axis } in its space): along its channel (handOf), moved
 * toward the palm as far as leaves its fingers least to open to hold it (closeOn): a fist's curl is not a handle's
 * circle, and MSR's sword hand holds its own a quarter of a unit to the palm side.
 */
function seatOf(base, hand, sizes) {
  const { centre, axis } = hand.channel;
  const toWrist = sub([0, 0, 0], centre);
  const palm = unit(sub(toWrist, scale(axis, dot(toWrist, axis))));
  let best = { cost: Infinity, centre };
  for (let i = 0; i <= SEAT_STEPS; i++) {
    const c = add(centre, scale(palm, (SEAT_MOST * sizes.handle * i) / SEAT_STEPS));
    const close = closeOn(base, hand, [sub(c, scale(axis, 10 * sizes.handle)), add(c, scale(axis, 40 * sizes.handle))], sizes.handle, sizes.finger);
    const cost = Object.entries(close).reduce((sum, [k, v]) => sum + (k === "thumb" ? 0 : Math.max(0, -v.hold) ** 2), 0);
    if (cost < best.cost) best = { cost, centre: c };
  }
  return { centre: best.centre, axis };
}

/**
 * A finger's points (each joint, knuckle out, and its end) in the hand's space, closed by "close" radians, its first
 * joint turned first by "turn" ({ axis in that joint's space, angle }: the thumb swung round the handle) where given.
 */
function fingerAt(base, finger, close, turn = null) {
  let q = [1, 0, 0, 0];
  let p = [0, 0, 0];
  const out = [];
  const bones = [...finger.palm, ...finger.joints];
  for (const j of bones) {
    p = add(p, qturn(q, base.p[j]));
    const k = finger.joints.indexOf(j);
    const own = k === 0 && turn ? qmul(base.q[j], qabout(turn.axis, turn.angle)) : base.q[j];
    const pk = finger.palm.indexOf(j);
    const local = k < 0 ? (finger.cup && pk >= 0 ? qmul(base.q[j], qabout(finger.palmAxes[pk], (finger.cupFrom + close) * finger.cup)) : base.q[j]) : qmul(own, qabout(finger.axes[k], close * (CLOSE_SHARES[k] ?? CLOSE_SHARES.at(-1))));
    q = qmul(q, local);
    if (k >= 0) out.push(p);
  }
  out.push(add(p, qturn(q, scale(base.p[bones.at(-1)], FINGER_END))));
  return out;
}

/** The turns between a finger's segments, the hand's origin out (degrees): the judge's curl. */
function curlOf(points) {
  const pts = [[0, 0, 0], ...points];
  let sum = 0;
  for (let i = 2; i < pts.length; i++) sum += Math.acos(clamp(dot(unit(sub(pts[i - 1], pts[i - 2])), unit(sub(pts[i], pts[i - 1]))), -1, 1)) / DEG;
  return sum;
}

/**
 * How each finger of a hand closes on a handle (its butt and tip in the hand's space, its radius, a finger's
 * half-thickness): { name: { hold, most } } in radians from the idle's: hold where it first holds it, pressed PRESS of
 * its thickness in, looked for from the idle's pose (opened as far as CLOSE_FROM degrees where the idle's is in
 * deeper, else closed as far as CLOSE_TO), kept to FIST; a finger that never reaches it closes as far as FIST lets.
 * most: the farthest it may close, its middle on the handle's surface. Given `thumbAlong` (degrees: the judge's
 * fingers.thumbAlong, 0 along the handle, 90 across it), the thumb is first swung round the handle (its first joint
 * turned about the line from the handle's axis to it, THUMB_TURNS) to the turn whose thumb, once holding, lies
 * nearest that against the handle: its { hold, most, turn }.
 */
export function closeOn(base, hand, handle, radius, finger, thumbAlong = null) {
  const [b0, t0] = handle;
  const ax = unit(sub(t0, b0));
  const L = len(sub(t0, b0));
  // the clearance of a point from the handle's surface (beyond its ends, from the end's rim), less a finger's
  const clear = (q) => {
    const d = sub(q, b0);
    const along = dot(d, ax);
    const off = len(sub(d, scale(ax, along))) - radius;
    const past = along < 0 ? -along : along > L ? along - L : 0;
    return Math.hypot(Math.max(off, 0), past) + Math.min(off, 0) - finger * (1 - PRESS);
  };
  const least = (pts, give = 1 - PRESS) => {
    let m = Infinity;
    // from the middle of the first segment out: the knuckle does not move as the finger closes
    for (let i = 1; i < pts.length; i++) for (const u of [0.5, 1]) m = Math.min(m, clear(lerp(pts[i - 1], pts[i], u)) + finger * (1 - PRESS - give));
    return m;
  };
  // the first closing from `from` by `step` degrees where in(d) turns true (bisected), or the last tried
  const sweep = (inside, from, to, step, ok) => {
    let prev = from;
    for (let d = from + step; step > 0 ? d <= to : d >= to; d += step) {
      if (!ok(d)) return prev;
      if (inside(d)) {
        let [lo, hi] = [prev, d];
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          if (inside(mid)) hi = mid;
          else lo = mid;
        }
        return hi;
      }
      prev = d;
    }
    return prev;
  };
  const out = {};
  const closing = (fg, turn = null) => {
    const at = (deg) => fingerAt(base, fg, deg * DEG, turn);
    const fits = (d) => curlOf(at(d)) <= FIST;
    const holds = (d) => least(at(d)) <= 0;
    // in deeper than PRESS at the idle: opened until it is not, else closed until it is
    const hold = holds(0) ? sweep((d) => !holds(d), 0, CLOSE_FROM, -1, () => true) : sweep(holds, 0, CLOSE_TO, 1, fits);
    const most = Math.max(hold, sweep((d) => least(at(d), 0) <= 0, Math.min(hold, 0), CLOSE_TO, 1, fits));
    return { hold: hold * DEG, most: most * DEG, held: least(at(hold)) <= 1e-6, at: at(hold) };
  };
  for (const [name, fg] of Object.entries(hand.fingers)) {
    let best = closing(fg);
    if (name === "thumb" && thumbAlong !== null) {
      // the thumb's first joint in the hand's space, and the line out to it from the handle's axis
      let q = [1, 0, 0, 0];
      let p = [0, 0, 0];
      for (const j of [...fg.palm, fg.joints[0]]) {
        p = add(p, qturn(q, base.p[j]));
        q = qmul(q, base.q[j]);
      }
      const d = sub(p, b0);
      const out = sub(d, scale(ax, dot(d, ax)));
      if (len(out) > 1e-6) {
        const axis = qturn(qconj(q), unit(out));
        const angleOf = (pts) => Math.acos(Math.min(1, Math.abs(dot(unit(sub(pts.at(-1), pts.at(-2))), ax)))) / DEG;
        // how far from the wanted angle, a turn that does not hold the handle or turns far dearer
        const miss = (c, deg) => Math.abs(angleOf(c.at) - thumbAlong) + (c.held ? 0 : THUMB_LOOSE) + THUMB_COST * Math.abs(deg);
        let bestMiss = miss(best, 0);
        best.turn = null;
        // and the idle's thumb as it is (MSR's lies along the grip clear of it): no closing, no turn
        const idle = { hold: 0, most: Math.max(best.most, 0), held: least(fingerAt(base, fg, 0)) <= 1e-6, at: fingerAt(base, fg, 0), turn: null };
        if (miss(idle, 0) < bestMiss) [best, bestMiss] = [idle, miss(idle, 0)];
        for (let deg = -THUMB_TURNS; deg <= THUMB_TURNS; deg += 5) {
          if (!deg) continue;
          const turn = { axis, angle: deg * DEG };
          const c = closing(fg, turn);
          const m = miss(c, deg);
          if (m < bestMiss) [best, bestMiss, best.turn] = [c, m, turn];
        }
      }
    }
    out[name] = { hold: best.hold, most: best.most, ...(best.turn ? { turn: best.turn } : {}) };
  }
  return out;
}
/** The thumb is swung round the handle as far as this either way (degrees). */
const THUMB_TURNS = 90;
/** Degrees of the thumb's angle a turn of a degree costs, and a thumb that does not hold the handle. */
const THUMB_COST = 0.1;
const THUMB_LOOSE = 30;

/**
 * Each finger's squeeze (radians from the idle's): closed to where it holds the handle, or kept as the idle has it
 * where that is already tighter, then closed `squeeze` degrees of the hand's curl more (Vermintide 2's squeeze before
 * the strike), never past where its middle meets the handle's surface.
 */
function squeezeOf(close, squeeze) {
  const more = (squeeze * DEG) / CLOSE_SHARES.reduce((a, b) => a + b, 0);
  return Object.fromEntries(
    Object.entries(close).map(([k, c]) => {
      // a thumb swung round the handle holds from its swing's own closing: no idle's to keep
      const c0 = Math.min(Math.max(c.turn ? c.hold : Math.max(c.hold, 0), c.hold) + more, Math.max(c.most, c.hold));
      return [k, c.turn ? { close: c0, turn: c.turn } : c0];
    }),
  );
}

/** A pose's fingers closed by "closing" ({ name: radians, or { close, turn } for a thumb swung }) times "amount", in place. */
function closeFingers(pose, base, hand, closing, amount) {
  for (const [name, fg] of Object.entries(hand.fingers)) {
    const v = closing[name] ?? 0;
    const c = (typeof v === "number" ? v : v.close) * amount;
    const turn = typeof v === "number" ? null : v.turn;
    fg.joints.forEach((j, k) => {
      const own = k === 0 && turn ? qmul(base.q[j], qabout(turn.axis, turn.angle * amount)) : base.q[j];
      pose.q[j] = qunit(qmul(own, qabout(fg.axes[k], c * (CLOSE_SHARES[k] ?? CLOSE_SHARES.at(-1)))));
    });
    // the palm cupped with it (CUP): by its share of the knuckle's closing from the rest, the idle's part of it
    // coming in with the blow (none at its ends, where the frames are the idle's)
    if (fg.cup) fg.palm.forEach((j, k) => {
      pose.q[j] = qunit(qmul(base.q[j], qabout(fg.palmAxes[k], (fg.cupFrom * amount + c) * fg.cup)));
    });
  }
}

/** A smooth step from 0 at a to 1 at b. */
const ease = (x, a, b) => (b <= a ? (x >= b ? 1 : 0) : ((t) => t * t * (3 - 2 * t))(clamp((x - a) / (b - a), 0, 1)));

/** Gaussian elimination with partial pivoting: x of M x = b. */
function linearSolve(M, b) {
  const n = b.length;
  const a = M.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let best = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[best][c])) best = r;
    [a[c], a[best]] = [a[best], a[c]];
    const d = a[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const k = a[r][c] / d;
      for (let k2 = c; k2 <= n; k2++) a[r][k2] -= k * a[c][k2];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = a[r][n];
    for (let c = r + 1; c < n; c++) s -= a[r][c] * x[c];
    x[r] = s / (a[r][r] || 1e-12);
  }
  return x;
}

// ── shares: how much of a strike's turning each joint does ───────────────────

/**
 * The shoulder's, elbow's and wrist's shares of the turning while the tip moves (speed over 15% of its peak, the
 * judge's strike and follow-through): each joint's own turn (the upper arm in the clavicle, the forearm in the
 * upper arm, the hand in the forearm) summed frame to frame, over the three's sum.
 */
export function sharesOfPoses(arm, poses) {
  const worlds = poses.map((pose) => worldOf(arm.rig, pose));
  const tips = worlds.map((world) => {
    const t = arm.weapon.tip;
    return add(world[t.bone].p, qturn(world[t.bone].q, t.p));
  });
  const n = tips.length;
  const speeds = tips.map((_, i) => len(sub(tips[Math.min(n - 1, i + 1)], tips[Math.max(0, i - 1)])));
  const peak = speeds.indexOf(Math.max(...speeds));
  let a = peak;
  while (a > 0 && speeds[a - 1] >= 0.15 * speeds[peak]) a--;
  let b = peak;
  while (b < n - 1 && speeds[b + 1] >= 0.15 * speeds[peak]) b++;
  const sum = { shoulder: 0, elbow: 0, wrist: 0, body: 0 };
  // each joint's own turn, the forearm's roll about its length counted at the wrist as the judge counts it (shareRoll
  // puts some on the forearm bone)
  const jointsOf = (pose) => {
    const u = unit(arm.base.p[arm.hand]);
    const m = twistX(qmul(qconj(arm.base.q[arm.fore]), pose.q[arm.fore]), u);
    return { shoulder: pose.q[arm.upper], elbow: qmul(pose.q[arm.fore], qabout(u, -m)), wrist: qmul(qabout(u, m), pose.q[arm.hand]) };
  };
  for (let f = a + 1; f <= b; f++) {
    const [was, now] = [jointsOf(poses[f - 1]), jointsOf(poses[f])];
    for (const joint of ["shoulder", "elbow", "wrist"]) sum[joint] += degreesOf(qmul(qconj(was[joint]), now[joint]));
    // the body as the judge takes it: the clavicle turning in the model
    if (arm.clavicle >= 0) sum.body += degreesOf(qmul(qconj(worlds[f - 1][arm.clavicle].q), worlds[f][arm.clavicle].q));
  }
  const total = sum.shoulder + sum.elbow + sum.wrist + sum.body || 1;
  return { shoulder: sum.shoulder / total, elbow: sum.elbow / total, wrist: sum.wrist / total, body: sum.body / total, degrees: total, window: [a, b] };
}

/** The shares of one of a model's sequences. */
export function sharesOf(buf, seq, arm = armOf(buf)) {
  return sharesOfPoses(arm, readSequence(buf, seq).frames.map((values) => poseOfValues(arm.rig, values)));
}

/** The model's own attacks' shares, averaged ("attack1", "attack2"...; else the short sword's). */
export function corpusShares(buf, arm = armOf(buf)) {
  const own = sequences(buf).map((s) => s.name).filter((name) => /^attack\d+$/i.test(name));
  if (!own.length) return { ...FALLBACK_SHARES };
  const all = own.map((name) => sharesOf(buf, name, arm));
  const mean = (k) => all.reduce((s, x) => s + x[k], 0) / all.length;
  return { shoulder: mean("shoulder"), elbow: mean("elbow"), wrist: mean("wrist"), body: mean("body") };
}

// ── curves ──────────────────────────────────────────────────────────────────

/**
 * A path through points, sampled finely: { at(s) (the point s along it), length, knots (the length at each
 * point) }. Three points not in a line make a circle's arc (a swing turns about something); more, a centripetal
 * Catmull-Rom curve through them all.
 */
export function pathThrough(points, samples = 400) {
  let dense;
  let knotParams;
  const [A, B, C] = points;
  const a = points.length === 3 ? sub(A, C) : null;
  const b = points.length === 3 ? sub(B, C) : null;
  const bent = a && len(cross(a, b)) > 0.08 * len(a) * len(b);
  if (bent) {
    // the circle through three points: its centre, and the angle from A to B to C about it
    const axb = cross(a, b);
    const centre = add(C, scale(cross(sub(scale(b, dot(a, a)), scale(a, dot(b, b))), axb), 1 / (2 * dot(axb, axb))));
    const radius = len(sub(A, centre));
    const u = unit(sub(A, centre));
    let w = unit(cross(unit(axb), u));
    const angle = (p) => {
      const d = sub(p, centre);
      let t = Math.atan2(dot(d, w), dot(d, u));
      return t < 0 ? t + 2 * Math.PI : t;
    };
    if (angle(B) > angle(C)) w = scale(w, -1);
    const end = angle(C);
    dense = Array.from({ length: samples + 1 }, (_, i) => {
      const t = (end * i) / samples;
      return add(centre, add(scale(u, radius * Math.cos(t)), scale(w, radius * Math.sin(t))));
    });
    knotParams = [0, angle(B) / end, 1].map((x) => x * samples);
  } else {
    // centripetal Catmull-Rom: the ends extended by mirroring their neighbours
    const pts = [sub(scale(points[0], 2), points[1] ?? points[0]), ...points, sub(scale(points.at(-1), 2), points.at(-2) ?? points.at(-1))];
    const per = Math.max(8, Math.ceil(samples / Math.max(1, points.length - 1)));
    dense = [];
    knotParams = [];
    for (let i = 1; i < pts.length - 2; i++) {
      knotParams.push(dense.length);
      const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
      const t0 = 0;
      const t1 = t0 + Math.sqrt(len(sub(p1, p0))) + 1e-6;
      const t2 = t1 + Math.sqrt(len(sub(p2, p1))) + 1e-6;
      const t3 = t2 + Math.sqrt(len(sub(p3, p2))) + 1e-6;
      for (let k = 0; k < per; k++) {
        const t = t1 + ((t2 - t1) * k) / per;
        const A1 = add(scale(p0, (t1 - t) / (t1 - t0)), scale(p1, (t - t0) / (t1 - t0)));
        const A2 = add(scale(p1, (t2 - t) / (t2 - t1)), scale(p2, (t - t1) / (t2 - t1)));
        const A3 = add(scale(p2, (t3 - t) / (t3 - t2)), scale(p3, (t - t2) / (t3 - t2)));
        const B1 = add(scale(A1, (t2 - t) / (t2 - t0)), scale(A2, (t - t0) / (t2 - t0)));
        const B2 = add(scale(A2, (t3 - t) / (t3 - t1)), scale(A3, (t - t1) / (t3 - t1)));
        dense.push(add(scale(B1, (t2 - t) / (t2 - t1)), scale(B2, (t - t1) / (t2 - t1))));
      }
    }
    knotParams.push(dense.length);
    dense.push(points.at(-1));
  }
  const lengths = [0];
  for (let i = 1; i < dense.length; i++) lengths.push(lengths[i - 1] + len(sub(dense[i], dense[i - 1])));
  const at = (s) => {
    const x = clamp(s, 0, lengths.at(-1));
    let lo = 0;
    let hi = lengths.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lengths[mid] <= x) lo = mid;
      else hi = mid;
    }
    const k = lengths[hi] > lengths[lo] ? (x - lengths[lo]) / (lengths[hi] - lengths[lo]) : 0;
    return lerp(dense[lo], dense[hi], k);
  };
  return { at, length: lengths.at(-1), knots: knotParams.map((i) => lengths[Math.round(i)]), dense };
}

/** A cubic between two values with given slopes (per unit of x) over [x0, x1]. */
function hermite(x0, x1, v0, v1, m0, m1, x) {
  const d = x1 - x0;
  const t = d ? (x - x0) / d : 0;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * d * m0 + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * d * m1;
}

/**
 * Lists of numbers through knots at `xs` (increasing): Catmull-Rom slopes, nought at the ends and at the knots
 * marked still, or the slopes `given` (per knot a list of numbers per unit of x, where not null). The value at x.
 */
function throughKnots(xs, values, still, x, given = []) {
  const k = clamp(xs.findIndex((v, i) => i < xs.length - 1 && x <= xs[i + 1]), 0, xs.length - 2);
  const slope = (i, d) => {
    if (given[i]) return given[i][d];
    if (i === 0 || i === xs.length - 1 || still[i]) return 0;
    return (values[i + 1][d] - values[i - 1][d]) / (xs[i + 1] - xs[i - 1]);
  };
  return values[0].map((_, d) => hermite(xs[k], xs[k + 1], values[k][d], values[k + 1][d], slope(k, d), slope(k + 1, d), clamp(x, xs[k], xs[k + 1])));
}

// ── the spec ────────────────────────────────────────────────────────────────

/** A place from the eye ([ahead, left, up], or { depth, side (+ right), height }) in the model's space. */
export function placeOf(v) {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return [v[0], v[1], v[2] + EYE_ABOVE_ORIGIN];
  return [v.depth ?? 0, -(v.side ?? 0), (v.height ?? 0) + EYE_ABOVE_ORIGIN];
}
/** A place in the model's space as the spec says it (from the eye). */
export const eyePlace = (p) => [r2(p[0]), r2(p[1]), r2(p[2] - EYE_ABOVE_ORIGIN)];

/**
 * A spec with every default filled in and its frames chosen:
 *   frames (37), fps (the model's attacks', else 30), hitFrame (else delay x fps; delay 0.6),
 *   timing "msc" (the tip's fastest `peakOffset` frames from the hit, the kind's MSR-like offset) or "sync"
 *   (the fastest on the hit), phases (shares of the frames: wind-up rest to cocked, strike cocked to contact,
 *   follow contact to through, recovery through to rest; the contact frame is fixed by the hit, the shares
 *   split what is before it and after it), at { from, through } (frames, instead of the phases),
 *   from, via (points the strike passes before contact), contact, after (points after contact), through,
 *   windup and recovery ([{ at, place, blade, still }]: keys in the joints' part of the blow),
 *   blade { from, contact, through } (directions the blade is held along there, softly),
 *   shares { shoulder, elbow, wrist, body } (of the strike's turning; else the style's, else the model's own
 *   attacks'),
 *   point "tip" (the places are the tip's) or "grip",
 *   line "level" or "diagonal" (a cut's, for a style's places: its plane tilted under 20 degrees, or more).
 * A style's `places` (a reference's bands' places: per kind, and by strength, the medians of where its blows'
 * tips are cocked, fastest, at the hit and end, in full reaches) stand in for the kind's from, contact and through where the
 * spec gives none, scaled by this arm's full reach and carried from the reference's shoulder to this arm's: the
 * reference's size of blow on this model, reached for from its body; and its blades'
 * directions there where the spec gives none.
 */
export function resolveSpec(buf, spec, arm = armOf(buf), style = null) {
  const kind = KINDS[spec.kind ?? "slash"];
  if (!kind) throw new Error(`swing: kind is ${Object.keys(KINDS).join(", ")}, not ${spec.kind}`);
  const attacks = sequences(buf).filter((s) => /^attack\d+$/i.test(s.name));
  const fps = spec.fps ?? attacks[0]?.fps ?? 30;
  const count = spec.frames ?? 37;
  const hit = spec.hitFrame ?? Math.round((spec.delay ?? 0.6) * fps);
  const timing = spec.timing ?? "msc";
  const offset = spec.peakOffset ?? (timing === "sync" ? kind.syncOffset ?? 0 : kind.mscOffset);
  const contactAt = clamp(spec.at?.contact ?? hit + offset, 4, count - 6);
  const phases = { ...kind.phases, ...spec.phases };
  const fromAt = spec.at?.from ?? clamp(Math.round((contactAt * phases.windup) / (phases.windup + phases.strike)), 2, contactAt - 3);
  const throughAt = spec.at?.through ?? clamp(contactAt + Math.round(((count - 1 - contactAt) * phases.follow) / (phases.follow + phases.recovery)), contactAt + 2, count - 4);
  // a cut's line, where the spec says one and the reference has enough of it ("level" or "diagonal")
  const lined = spec.line && style?.places?.[`${spec.kind ?? "slash"}/${spec.line}`];
  const placed = lined && lined.all.n >= 5 ? lined : style?.places?.[spec.kind ?? "slash"];
  const ref = placed && ((placed[spec.strength]?.n ?? 0) >= 5 ? placed[spec.strength] : placed.all);
  // the hands' measures (squeeze, thumb) from the style's hands where its places are not given (a kind with fewer
  // than five of its own blows takes its family's: style.hand)
  const handsOf = style?.hands?.[spec.kind ?? "slash"];
  const hands = ref ?? (handsOf && ((handsOf[spec.strength]?.n ?? 0) >= 5 ? handsOf[spec.strength] : handsOf.all));
  const reach = ref ? fullReachOf(arm) : 0;
  // carried from the reference's shoulder to this arm's: a blow is reached for from the body, and the camera
  // sits apart from the shoulder by another amount in each game (Vermintide 2's shoulder is lower and farther out)
  const ours = ref?.shoulder ? eyePlace(arm.baseWorld[arm.upper].p).map((x) => x / reach) : null;
  const shift = ours ? ours.map((x, i) => x - ref.shoulder.median[i]) : [0, 0, 0];
  // and kept within this arm's reach of its shoulder (REACHABLE of it): Vermintide 2 meets its targets past one
  // full reach by leaning the body in, which a clavicle's turn cannot
  const shoulderAt = ref ? arm.baseWorld[arm.upper].p : null;
  const within = (p) => {
    const d = sub(p, shoulderAt);
    const most = REACHABLE * reach;
    return len(d) > most ? add(shoulderAt, scale(d, most / len(d))) : p;
  };
  const theirs = (k) => {
    const m = ref?.[k]?.median;
    if (!m) return undefined;
    // from the eye, as a spec says it
    return eyePlace(within(placeOf(m.map((x, i) => (x + shift[i]) * reach))));
  };
  // the reference's blade directions with its places (a cut's contact then is its, not trailed as MSR's)
  const refBlade = ref?.blades ? { start: ref.blades.start, from: ref.blades.cocked, contact: ref.blades.contact, through: ref.blades.through, end: ref.blades.end } : {};
  // where the clip starts: the idle, unless the style crossfades into its clips (Vermintide 2's: a light's first
  // frame is near its cock, the engine's crossfade bridges the rest, and the wind-up is not seen) and has the
  // place (and the spec does not say its own cock: a start goes with the cock it leads to); spec.start a place,
  // or "rest"
  const start = spec.start === "rest" ? null : spec.start ? placeOf(spec.start) : style?.crossfade && !spec.from && theirs("start") ? placeOf(theirs("start")) : null;
  const blade = { ...kind.blade, ...refBlade, ...spec.blade };
  // where the clip ends: the idle, unless the style blends out of its clips (Vermintide 2's: its blows glide from the
  // through point to a pose they hold, low before the body and out of view, and its state machine blends from there
  // into the idle) and has the place; spec.end a place, or "idle"
  const end = spec.end === "idle" ? null : spec.end ? placeOf(spec.end) : style?.crossfade && theirs("end") ? placeOf(theirs("end")) : null;
  let from = placeOf(spec.from ?? theirs("cocked") ?? kind.from);
  // a cut's contact is its fastest; a thrust's is where it meets the target, past its fastest: the hit's place
  const contact = placeOf(spec.contact ?? ((spec.peakAt ?? kind.peakAt ?? "contact") === "contact" ? theirs("contact") : theirs("hit") ?? theirs("contact")) ?? kind.contact);
  let through = placeOf(spec.through ?? theirs("through") ?? kind.through);
  let via = (spec.via ?? []).map(placeOf);
  let after = (spec.after ?? []).map(placeOf);
  // edge-on: the strike's plane put through the eye (the plane of the eye, the contact and the way from the cock
  // to the through point; the others moved onto it), so that the stroke is a straight line across the screen, as
  // Vermintide 2's are (plane.eyeAngle 8.6 deg at the median). By the style, only the places the spec does not
  // give are moved; a spec that says edgeOn: true has its own moved too. A thrust drives along the line of sight:
  // it has no plane to see edge-on
  const cut = (spec.peakAt ?? kind.peakAt ?? "contact") === "contact";
  if (cut && (spec.edgeOn ?? style?.edgeOn ?? false)) {
    const eye = [0, 0, EYE_ABOVE_ORIGIN];
    const n = unit(cross(sub(contact, eye), sub(through, from)));
    const all = spec.edgeOn === true;
    if (len(n) > 0.5) {
      const onto = (p) => sub(p, scale(n, dot(sub(p, contact), n)));
      if (all || !spec.from) from = onto(from);
      if (all || !spec.through) through = onto(through);
      if (all || !spec.via) via = via.map(onto);
      if (all || !spec.after) after = after.map(onto);
    }
  }
  // the forearm's roll from the cock to the through point (degrees, as a right arm's: judge's info.roll): the spec's,
  // else the reference's for the kind, as far as its blows roll (rollSize) and the way most of them do. The blade's
  // direction leaves its turn about its own length free, and the solver may leave the forearm unrolled (Vermintide
  // 2's heavy overheads roll 68 deg, the generator's rolled 1). Asked only of a blow that rolls less that way than
  // the reference's lower quartile (rollLeast): one already rolling as the reference's do is left as it is
  const roll = spec.roll ?? (ref?.rollSize ? (Math.sign(ref.roll?.median ?? 0) || 1) * ref.rollSize.median : null);
  const rollLeast = spec.roll !== undefined ? Math.abs(spec.roll) : ref?.rollSize?.q1 ?? 0;
  const shares = { ...corpusShares(buf, arm), ...style?.shares, ...spec.shares };
  if (arm.clavicle < 0) shares.body = 0; // nothing above the arm to turn
  const total = JOINTS.reduce((t, k) => t + (shares[k] ?? 0), 0);
  // a body asked to do (next to) nothing is held still, as MSR's: no share to balance
  for (const k of JOINTS) shares[k] = k === "body" && !((shares.body ?? 0) / total >= 0.01) ? 0 : Math.max(0.02, (shares[k] ?? 0) / total);
  const keyList = (list = []) =>
    list.map((k) => ({ at: k.at, place: placeOf(k.place), blade: k.blade ? unit(k.blade) : null, still: Boolean(k.still) }));
  return {
    name: spec.name ?? `swing_${spec.kind ?? "slash"}`,
    kind: spec.kind ?? "slash",
    // "light" (a click's) or "heavy" (released from a held charge): which of the reference's bands judge it
    strength: spec.strength ?? null,
    point: spec.point ?? "tip",
    peakAt: spec.peakAt ?? kind.peakAt ?? "contact",
    trail: spec.trail ?? kind.trail ?? null,
    fps,
    count,
    hit,
    timing,
    offset: contactAt - hit,
    at: { from: fromAt, contact: contactAt, through: throughAt },
    start,
    from,
    contact,
    through,
    end,
    via,
    after,
    windup: keyList(spec.windup),
    recovery: keyList(spec.recovery),
    blade: Object.fromEntries(Object.entries(blade).filter(([, v]) => v).map(([k, v]) => [k, unit(v)])),
    bladeWeight: spec.bladeWeight ?? BLADE_WEIGHT,
    shares,
    still: { from: Boolean(spec.still?.from), through: Boolean(spec.still?.through) },
    flow: { ...FLOW, ...kind.flow, ...spec.flow },
    roll,
    rollLeast,
    split: spec.split ?? null,
    // the striking hand's squeeze past holding the handle, degrees of its curl: the spec's, else the reference's median
    squeeze: spec.squeeze ?? ((hands?.squeeze?.n ?? 0) >= 5 ? hands.squeeze.median : style?.hand?.squeeze ?? 0),
    // the thumb's angle against the handle (0 along it, 90 wrapped across): the spec's, else the reference's median,
    // else as the idle has it (null)
    thumbAlong: spec.thumbAlong ?? ((hands?.thumb?.n ?? 0) >= 5 ? hands.thumb.median : style?.hand?.thumbAlong ?? null),
    // where the off hand goes (model space): the spec's ({ cocked, hit } from the eye; false for none), else for a
    // heavy the reference's for the kind (its blows with one weapon in one hand). Vermintide 2's heavies bring the off
    // hand forward into view; its lights keep it about where it rests, and reached for from MSR's lower rest their
    // off hand went too far and too fast (other.counter, other.speed past Vermintide's)
    // or "grip": the off hand takes the handle too, from the cock through the follow-through, as most of the
    // reference's one-weapon heavies of the kind do (Vermintide 2's heavy slashes 5 of 6, its overheads 2 of 6)
    offHand: spec.offHand === "grip" || (spec.offHand === undefined && spec.strength === "heavy" && (ref?.grip ?? 0) > 0.5) ? "grip" : spec.offHand === false || (spec.offHand === undefined && spec.strength !== "heavy") ? null : ((hitAt, cockedAt, throughAt) => (hitAt ? { hit: hitAt, cocked: cockedAt, through: throughAt } : null))(
          placeOf(spec.offHand?.hit) ?? (theirs("offHit") ? placeOf(theirs("offHit")) : null),
          placeOf(spec.offHand?.cocked) ?? (theirs("offCocked") ? placeOf(theirs("offCocked")) : null),
          placeOf(spec.offHand?.through) ?? (theirs("offThrough") ? placeOf(theirs("offThrough")) : null),
        ),
  };
}

/**
 * How the blow flows from one part into the next, unless a spec says (`flow`): MSR's arm never stops between
 * them (anims/verdicts.md, F4 A1). `start`: the arm leaves the idle already moving, at this share of its first
 * part's mean speed (MSR's tips at frame 0 are a sixth to a third of their peak). `enter`, `leave`: the tip's
 * speed along the strike's path at the cocked and the through frames, as shares of each side's mean (a stop
 * there only when the spec says `still: { from: true }` or `{ through: true }`); a cut's `enter` is held down
 * so that its speed rises to contact without a lull. The joints carry the strike's own velocity into and out
 * of it, so the wind-up's last turn is the strike's first and each joint turns back at its own moment, not all
 * at once. `end`: the last part comes onto the idle still moving, at this share of its mean speed (MSR's end
 * moving). `lead`: the shoulder leaves the cock already turning, at this share of its mean turn to contact,
 * while the tip is still slow (the elbow and the wrist make up for it), as MSR's shoulder keeps turning while
 * its elbow stops. `windupWrist`: how much dearer the wrist is to move in the wind-up's keys than in the strike
 * (MSR's short sword holds its wrist through the wind-up and snaps it in the strike).
 */
export const FLOW = { start: 0.5, enter: 1, leave: 0.5, end: 0.5, lead: 1.5, windupWrist: 10 };

/** A joint's cost from its share: dear to move when it is to do little. */
const costsOf = (shares) => Object.fromEntries(Object.entries(shares).map(([k, s]) => [k, s > 0 ? (1 / 3 / s) ** 2 : HELD]));
/** The roll parameter's turn (p[4], about the forearm's x) against the judge's twist: the same way or the other. */
const ROLL_WAY = 1;
/** The cost of a joint held still (a share of nought). */
const HELD = 1e6;

/**
 * A blow from a spec (see resolveSpec): { name, fps, frames (each bone's six numbers per frame, as addSequence
 * takes them), poses, like (the idle's sequence number), plan (frames, places, the design's path), shares
 * (wanted, made), misses (how far each key's point is from its place), notes }.
 */
export function swing(buf, spec, { rounds = 6, style = null } = {}) {
  const arm = armOf(buf, { bodypart: spec.bodypart, submodel: spec.submodel, rest: spec.rest });
  // a style's ranges widen the limits (never narrow them), as far as a body goes
  for (const [k, v] of Object.entries(style?.limits ?? {})) if (k in BODY_MOST && v > arm.limits[k]) arm.limits[k] = Math.min(v, BODY_MOST[k]);
  // how much of the body's turn the trunk takes: the spec's, else the style's (its body.trunk), else none
  arm.trunkShare = clamp(spec.trunk ?? style?.trunk ?? 0, 0, 1);
  // and how far the off arm swings with the blow: the spec's, else none
  arm.offArm = clamp(spec.offArm ?? 0, 0, 2);
  const s = resolveSpec(buf, spec, arm, style);
  arm.bothHands = s.offHand === "grip" && arm.offUpper >= 0 && arm.offLength > 0;
  const notes = [];
  let costs = costsOf(s.shares);
  let made;
  let best = null;
  for (let round = 0; round < rounds; round++) {
    made = build(arm, s, costs);
    const got = sharesOfPoses(arm, made.poses);
    const off = Math.max(...JOINTS.filter((k) => s.shares[k] > 0).map((k) => Math.abs(got[k] - s.shares[k])));
    if (!best || off < best.off) best = { made, got, off, costs };
    if (off < 0.03) break;
    // a joint that turned more than its share is made dearer, one that turned less cheaper
    costs = Object.fromEntries(Object.entries(costs).map(([k, c]) => [k, s.shares[k] > 0 ? c * clamp((got[k] / s.shares[k]) ** 2, 0.25, 4) : c]));
  }
  ({ made } = best);
  if (best.off >= 0.05) notes.push(`the joints' shares (${JOINTS.join("/")}) came out ${JOINTS.map((k) => r2(best.got[k])).join("/")} against ${JOINTS.map((k) => r2(s.shares[k])).join("/")} asked`);
  // the first and last frames are the idle's first, number for number: no seam
  // (from the poses: the fingers are closed on them, not in the numbers)
  const frames = made.poses.map((pose) => valuesOf(arm.rig, pose));
  if (arm.rolls.length) turnRolls(arm.bones, arm.rolls, frames);
  if (!s.start) frames[0] = arm.baseValues.map((six) => [...six]);
  if (!s.end) frames[frames.length - 1] = arm.baseValues.map((six) => [...six]);
  unwind(frames);
  return {
    name: s.name,
    fps: s.fps,
    frames,
    poses: made.poses,
    params: made.params,
    like: arm.like,
    spec: s,
    plan: {
      frames: s.count,
      hit: s.hit,
      from: s.at.from,
      contact: s.at.contact,
      through: s.at.through,
      timing: s.timing,
      peakOffset: s.offset,
      designed: made.designed.map((p) => (p ? eyePlace(p) : null)),
    },
    shares: { wanted: s.shares, made: best.got, costs: best.costs },
    misses: made.misses,
    grip: made.grip,
    notes: [...new Set([...notes, ...made.notes])],
  };
}

/** The keys' arms and every frame's, for one set of joint costs. */
function build(arm, s, costs) {
  const notes = [];
  // the fingers' closing (radians a finger) of the striking hand and the off hand at the hit, and the frames the off hand holds the handle
  const grip = {};
  const misses = {};
  const zero = JOINT.map(() => 0);
  const flow = s.flow;
  // the wind-up's keys hold the wrist dearer: it waits for the strike
  const windupCosts = { ...costs, wrist: costs.wrist * (flow.windupWrist ?? 1) };
  // the keys in time, each solved from the one before
  const keys = [{ at: 0, p: zero, still: true, name: "rest" }];
  let before = zero;
  const key = (name, at, place, blade, still, keyCosts = costs, ref = before, way = null) => {
    const got = solve(arm, before, { place, point: s.point, blade, bladeWeight: s.bladeWeight, ref, costs: keyCosts, way });
    misses[name] = { miss: r2(got.miss), bladeOff: got.bladeOff === null ? null : r2(got.bladeOff) };
    keys.push({ at, p: got.p, still, name, place });
    before = got.p;
    return got.p;
  };
  // the way the tip is to go at contact, along the planned path: a cut's edge leads it (a thrust drives its point)
  const cut = s.peakAt === "contact";
  const planned = pathThrough([s.from, ...s.via, s.contact, ...s.after, s.through]);
  const contactWay = ((at) => sub(planned.at(at + 0.5), planned.at(at - 0.5)))(planned.knots[1 + s.via.length]);
  // a cut's blade at contact, unless told: ahead, trailing its motion (the path's way at contact) by `trail`
  let contactBlade = s.blade.contact;
  if (!contactBlade && s.trail !== null) {
    const way = contactWay;
    const ahead = unit(sub(s.contact, [0, 0, EYE_ABOVE_ORIGIN]));
    const across = unit(sub(way, scale(ahead, dot(way, ahead))));
    contactBlade = unit(sub(scale(ahead, Math.cos(s.trail * DEG)), scale(across, Math.sin(s.trail * DEG))));
  }
  // a clip that starts where the style's do: its first key solved there (from the idle's arm), in place of the idle
  if (s.start) {
    keys.length = 0;
    key("start", 0, s.start, s.blade.start, true, windupCosts);
  }
  s.windup.forEach((k, i) => key(`windup${i + 1}`, k.at, k.place, k.blade, k.still, windupCosts));
  const cocked = key("from", s.at.from, s.from, s.blade.from, s.still.from, windupCosts);
  let contact = key("contact", s.at.contact, s.contact, contactBlade, false, costs, before, cut ? contactWay : null);
  let through = key("through", s.at.through, s.through, s.blade.through, s.still.through);
  // a forearm that rolls less than it should (s.rollLeast, the way s.roll says) asked to roll from the cock: half the
  // roll by contact, all of it by the through point
  const rolledSoFar = (ROLL_WAY * (through[4] - cocked[4])) / DEG;
  if (typeof s.roll === "number" && s.roll !== 0 && rolledSoFar * Math.sign(s.roll) < s.rollLeast) {
    keys.length -= 2;
    before = cocked;
    const rolled = (share) => before.map((v, i) => (i === 4 ? cocked[4] + ROLL_WAY * share * s.roll * DEG : v));
    contact = key("contact", s.at.contact, s.contact, contactBlade, false, costs, rolled(0.5), cut ? contactWay : null);
    through = key("through", s.at.through, s.through, s.blade.through, s.still.through, costs, rolled(1));
  }
  s.recovery.forEach((k, i) => key(`recovery${i + 1}`, k.at, k.place, k.blade, k.still));
  // and the last: the idle, or where a style that blends out of its clips ends them (held there, still)
  if (s.end) {
    // glided there along the straight line from the through point, a key every few frames each solved from the one
    // before: the joints' own way between two poses solved apart can swing the arm back up through the view
    const from = pointsOf(arm, through)[s.point];
    const fromBlade = pointsOf(arm, through).blade;
    const toBlade = s.blade.end ?? fromBlade;
    const steps = Math.max(1, Math.round((s.count - 1 - s.at.through) / GLIDE_EVERY));
    for (let j = 1; j < steps; j++) {
      const t = ease(j, 0, steps);
      key(`glide${j}`, Math.round(s.at.through + ((s.count - 1 - s.at.through) * j) / steps), lerp(from, s.end, t), unit(lerp(fromBlade, toBlade, t)), false);
      keys.at(-1).glide = t;
    }
    key("end", s.count - 1, s.end, s.blade.end, true);
    keys.at(-1).glide = 1;
  }
  else keys.push({ at: s.count - 1, p: zero, still: true, name: "rest" });

  const params = new Array(s.count);
  const designed = new Array(s.count).fill(null);

  // the strike: the point on its path, fastest at contact (a cut) or a little before it (a thrust). The path
  // runs through where the keys' points came to be, so that it meets the joints' parts without a step
  const reached = (p) => pointsOf(arm, p)[s.point];
  const path = pathThrough([reached(cocked), ...s.via, reached(contact), ...s.after, reached(through)]);
  const contactArc = path.knots[1 + s.via.length];
  const [S, P, E] = [s.at.from, s.at.contact, s.at.through];
  const d1 = contactArc / (P - S);
  const d2 = (path.length - contactArc) / (E - P);
  // the point's speed where the strike begins and ends: moving through the cock and on through the through
  // point unless they are still
  let m0 = s.still.from ? 0 : clamp(flow.enter ?? 0, 0, 1.5) * d1;
  const mE = s.still.through ? 0 : clamp(flow.leave ?? 0, 0, 1.5) * d2;
  // the point's speed at contact, in units a frame. A cut: at least 1.5 times each side's mean speed (so the
  // fastest is at contact) and at most what keeps each side's cubic from running back (Fritsch-Carlson: the two
  // end slopes over the mean inside a circle of 3). A thrust: what puts the fastest `peakAt` of the way from
  // cocked to contact (from the cubic's speed, 6t(1-t) d1 + (1-4t+3t^2) m0 + (3t^2-2t) m, at its top), the
  // blade still driving when it meets the target and slowing to the through point
  const most1 = d1 * Math.sqrt(Math.max(0, 9 - (m0 / d1) ** 2));
  const most2 = d2 * Math.sqrt(Math.max(0, 9 - (mE / d2) ** 2));
  let m;
  let lo;
  let hi;
  if (s.peakAt === "contact") {
    lo = 1.5 * Math.max(d1, d2);
    hi = Math.min(most1, most2);
    m = clamp(2 * Math.sqrt(d1 * d2), Math.min(lo, hi), Math.max(lo, hi));
  } else {
    const t = clamp(s.peakAt, 0.4, 0.72);
    m = (6 * (1 - 2 * t) * d1 + (6 * t - 4) * m0) / (2 - 6 * t);
    lo = 0;
    hi = Math.min(most1, most2);
  }
  // a cut's speed rises from the cock to contact without a lull on the way: the cubic's speed does not dip
  // after the cock when m0 <= 1.5 d1 - m / 2 (its slope's slope at the cock not below nought)
  if (s.peakAt === "contact") m0 = Math.min(m0, Math.max(0, 1.5 * d1 - 0.5 * Math.min(m, hi)));
  if (m > hi) {
    m = hi;
    notes.push(`the strike's two sides do not agree in speed (${r2(d1 * s.fps)} and ${r2(d2 * s.fps)} u/s on average): the fastest comes before contact; carry the through point farther or give it fewer frames`);
  } else if (m < lo) notes.push(`the strike's two sides do not agree in speed (${r2(d1 * s.fps)} and ${r2(d2 * s.fps)} u/s on average): the fastest comes after contact`);
  const arcAt = (f) => (f <= P ? hermite(S, P, 0, contactArc, m0, m, f) : hermite(P, E, contactArc, path.length, m, mE, f));
  // the arm's reference through the strike: the three keys' arms, by how far along the path the point is. The
  // shoulder's own leaves the cock already turning (`lead`: at this share of its mean turn to contact), by time,
  // while the point is still slow there: the elbow and the wrist make up for it (the arm turns about the blade's
  // point), so that at the cock the shoulder is already striking while the wrist is still cocking
  const lead = flow.lead ?? 0;
  const keyArms = [cocked, contact, through];
  const shoulderStart = cocked.map((v, i) => ((contact[i] - v) * lead) / Math.max(1, P - S));
  const refAt = (f) => {
    const byPath = throughKnots([0, contactArc, path.length], keyArms, [true, false, true], arcAt(f));
    if (!lead) return byPath;
    const byTime = throughKnots([S, P, E], keyArms, [true, false, true], f, [shoulderStart, null, null]);
    // the body leads as the shoulder does: the turn starts at the trunk and runs out to the hand
    return JOINT.map((j, i) => (j === "shoulder" || j === "body" ? byTime[i] : byPath[i]));
  };
  let previous = cocked;
  for (let f = S; f <= E; f++) {
    const arc = arcAt(f);
    const place = path.at(arc);
    designed[f] = place;
    // a blow that glides on to a held end (s.end) reaches its through point from the frame before, as the strike's
    // frames are, and the glide starts from there: the through key, solved on its own, sits on another of the arm's
    // ways to put the tip there, and the step to it (four to eleven units in a frame, the off hand dragged with it)
    // showed once the glide after it was slow
    if (f === E && s.end && E > S + 1) {
      const got = solve(arm, previous, { place, point: s.point, ref: refAt(f), costs, way: cut ? sub(path.at(arc + 0.5), path.at(arc - 0.5)) : null });
      params[f] = got.p;
      keys[keys.findIndex((k) => k.name === "through")].p = got.p;
      // and the glide's keys solved again from it, each from the one before
      let from = got.p;
      const start = pointsOf(arm, got.p);
      const glides = keys.filter((k) => k.glide);
      for (const k of glides) {
        const t = k.glide;
        const g = solve(arm, from, { place: lerp(start[s.point], s.end, t), point: s.point, blade: unit(lerp(start.blade, s.blade.end ?? start.blade, t)), bladeWeight: s.bladeWeight, ref: from, costs });
        k.p = g.p;
        from = g.p;
      }
      continue;
    }
    if (f === S || f === E) {
      params[f] = f === S ? cocked : through;
      continue;
    }
    const got = solve(arm, previous, { place, point: s.point, ref: refAt(f), costs, way: cut ? sub(path.at(arc + 0.5), path.at(arc - 0.5)) : null });
    if (got.miss > 1) notes.push(`frame ${f}: the ${s.point} is ${r2(got.miss)} from its path`);
    params[f] = got.p;
    previous = got.p;
  }
  // the joints' parts: rest to cocked, through to rest, through the keys in each. They meet the strike with its
  // own velocity (a frame's step at each end of it), so the arm does not stop between the parts; the first part
  // leaves the idle already moving (`flow.start`), the last comes to rest on the idle
  const step = (a, b) => a.map((v, i) => b[i] - v);
  const enterSlope = s.still.from || E - S < 2 ? null : step(params[S], params[S + 1]);
  const leaveSlope = s.still.through || E - S < 2 ? null : step(params[E - 1], params[E]);
  const joints = (list, given) => {
    const xs = list.map((k) => k.at);
    for (let f = xs[0]; f <= xs.at(-1); f++) params[f] = throughKnots(xs, list.map((k) => k.p), list.map((k) => k.still), f, given);
  };
  const iFrom = keys.findIndex((k) => k.name === "from");
  const iThrough = keys.findIndex((k) => k.name === "through");
  const first = keys.slice(0, iFrom + 1);
  const startSlope = flow.start ? step(first[0].p, first[1].p).map((v) => (v * flow.start) / Math.max(1, first[1].at - first[0].at)) : null;
  joints(first, first.map((k, i) => (i === 0 ? startSlope : i === first.length - 1 ? enterSlope : null)));
  // a blow split for a charge (s.split: the release starts there, from the charge's held pose): from the split to
  // the cock the joints leave already moving, at their mean speed over it, and speed up into the strike. Joined
  // through the wind-up's keys instead, they slowed to a near stop in between (the heavy's flow.stall 70 deg/s,
  // Vermintide 2's heavies 118 at their 5%); the step from the held pose is under the crossfade into the release
  if (s.split > 0 && s.split < S - 1) {
    const at = s.split;
    const mean = step(params[at], params[S]).map((v) => v / (S - at));
    joints([{ at, p: params[at], still: false }, { at: S, p: params[S], still: s.still.from }], [mean, enterSlope]);
  }
  const last = keys.slice(iThrough);
  // ending on a held pose (s.end) the arm comes to a stop there; ending on the idle it may arrive moving (flow.end)
  const endSlope = flow.end && !s.end ? step(last.at(-2).p, last.at(-1).p).map((v) => (v * flow.end) / Math.max(1, last.at(-1).at - last.at(-2).at)) : null;
  joints(last, last.map((k, i) => (i === 0 ? leaveSlope : i === last.length - 1 ? endSlope : null)));
  // the joints' parts kept off the camera too: a frame whose arm or hilt comes nearer the eye than EYE_ROOM is solved
  // again with its tip where it was, its blade held loosely (EYE_BLADE of its weight: the hilt turns away about the
  // tip, as with the blade held it cannot) and its joints kept near
  for (let f = 1; f < s.count - 1; f++) {
    if (f >= S && f <= E) continue;
    if (!nearEye(arm, params[f])) continue;
    const here = pointsOf(arm, params[f]);
    params[f] = solve(arm, params[f], { place: here[s.point], point: s.point, blade: here.blade, bladeWeight: EYE_BLADE * s.bladeWeight, ref: params[f], costs }).p;
  }
  params[0] = keys[0].p;
  params[s.count - 1] = keys.at(-1).p;
  // the off arm: still until the cock, then turned by offArm of the striking shoulder's turn since the cock, eased
  // back to its rest by the last frame from the through point on
  const k = arm.offArm ?? 0;
  if (s.offHand === "grip" && arm.offUpper >= 0 && arm.offHand >= 0 && arm.offHinge) {
    // both hands on the handle: the off hand's channel (handOf) on the handle between the striking hand and the butt
    // and turned along it, its thumb toward the tip as the striking hand's, solved each frame from the cock (from the split for a charged blow: Vermintide 2's charge brings
    // the off hand to the handle, and its release starts with both on it) to the through point (the handle moves too
    // fast to join keys through), reached from rest before and let go to rest after
    const last = s.count - 1;
    const H = s.split > 0 && s.split < S ? s.split : S;
    const handleFor = (p) => {
      const at = pointsOf(arm, p);
      return { place: add(at.grip, scale(sub(at.butt, at.grip), GRIP_ALONG)), aim: { axis: unit(sub(at.tip, at.butt)) } };
    };
    const held = new Array(s.count).fill(null);
    const aimed = !!arm.offFingers?.channel;
    let x = aimed ? [0, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0];
    let worst = 0;
    // the off hand's thumb toward the tip as the striking hand's, unless where it takes the handle it reaches it
    // nearer the other way round: chosen there and kept, a hand does not turn over on the handle
    let way = 1;
    if (aimed) {
      const { place, aim } = handleFor(params[H]);
      const misses = [1, -1].map((k) => offReach(arm, params[H], place, x, GRIP_HOLD, { axis: scale(aim.axis, k) }).miss);
      if (misses[1] < misses[0] - 0.5) way = -1;
    }
    // and let go where the handle swings out of its reach after the hit (Vermintide 2's off hand lets go in the
    // follow-through): the last frame held
    // A blow that ends on a held pose (s.end: a style that blends out of its clips) keeps both hands on the handle
    // to its last frame, as Vermintide 2's two-handed heavies do (their wrists 0.25 to 0.6 forearms apart throughout,
    // the hit and after): after the hit the hand is held to the handle's way more loosely (AIM_AFTER), so that it
    // keeps to the handle where the wrist cannot turn as far as the handle does
    const holdToEnd = !!s.end;
    let L = holdToEnd ? last : E;
    const hitAt = Math.round(s.hit);
    for (let f = H; f <= (holdToEnd ? last : E); f++) {
      // held loosely to the frame before: the hand goes where the handle is, as far as the arm turns
      const { place, aim } = handleFor(params[f]);
      const got = offReach(arm, params[f], place, x, GRIP_HOLD, aimed ? { axis: scale(aim.axis, way), weight: holdToEnd && f > hitAt ? AIM_AFTER : AIM_WEIGHT } : null);
      if (!holdToEnd && f > Math.max(H + 1, hitAt) && got.miss > LET_GO * arm.forearm) {
        L = f - 1;
        break;
      }
      x = got.x;
      held[f] = x;
      worst = Math.max(worst, got.miss);
    }
    grip.held = [H, L];
    if (worst > 1.5) notes.push(`the off hand is up to ${r2(worst)} from the handle`);
    const rest = x.map(() => 0);
    const into = held[H + 1].map((v, i) => v - held[H][i]);
    // let go: the arm eases back to rest over the rest of the blow, the way it was going; the hand's own turn (numbers
    // 15 to 17) back to rest within RELEASE_FRAMES, not carried turned through the recovery
    const outOf = held[L].map((v, i) => (i < 4 ? v - held[L - 1][i] : 0));
    for (let f = 0; f <= last; f++) {
      const off = f < H ? throughKnots([0, H], [rest, held[H]], [true, false], f, [null, into]) : f <= L ? held[f] : throughKnots([L, last], [held[L], rest], [false, true], f, [outOf, null]);
      if (f > L) for (let i = 4; i < off.length; i++) off[i] = held[L][i] * (1 - ease(f, L, Math.min(last, L + RELEASE_FRAMES)));
      params[f] = [...params[f].slice(0, JOINT.length), ...off];
    }
  } else if (s.offHand && arm.offUpper >= 0 && arm.offHand >= 0 && arm.offHinge) {
    // the off hand reached for: at rest at the first frame, at the reference's places at the cock and the hit, back
    // at rest by the last, the off arm's numbers joined through them as the striking arm's are
    const last = s.count - 1;
    const hitAt = clamp(Math.round(s.hit), S + 1, Math.max(S + 1, E));
    const rest = [0, 0, 0, 0];
    const offKeys = [{ at: 0, p: rest, still: true }];
    let before = rest;
    const reach = (f, place, name) => {
      const got = offReach(arm, params[f], place, before);
      if (got.miss > 1.5) notes.push(`the off hand at the ${name} is ${r2(got.miss)} from its place`);
      before = got.x;
      return got.x;
    };
    if (s.offHand.cocked && S > 1) offKeys.push({ at: S, p: reach(S, s.offHand.cocked, "cock"), still: false });
    offKeys.push({ at: hitAt, p: reach(hitAt, s.offHand.hit, "hit"), still: false });
    if (s.offHand.through && E > hitAt && E < last - 1) offKeys.push({ at: E, p: reach(E, s.offHand.through, "through point"), still: false });
    offKeys.push({ at: last, p: rest, still: true });
    const xs = offKeys.map((q) => q.at);
    for (let f = 0; f <= last; f++) params[f] = [...params[f].slice(0, JOINT.length), ...throughKnots(xs, offKeys.map((q) => q.p), offKeys.map((q) => q.still), f)];
  } else if (k > 0 && arm.offUpper >= 0) {
    const last = s.count - 1;
    for (let f = 0; f <= last; f++) {
      const since = f < S ? [0, 0, 0] : [0, 1, 2].map((i) => (params[f][i] - params[S][i]) * k);
      const fade = f <= E ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (f - E)) / Math.max(1, last - E));
      params[f] = [...params[f].slice(0, JOINT.length), ...scale(since, fade)];
    }
  }
  const poses = params.map((p) => poseFrom(arm, p));
  // the fingers: the striking hand closed on the handle (it is rigid in the hand, so once) from the idle's grip over
  // the wind-up, held through the hit and let go back to the idle's over the rest, as Vermintide 2's squeeze before
  // the strike and loosen after it; a hand on the handle in both closed on it each frame it holds it
  if (s.fingers !== false && arm.fingers && arm.sizes?.handle && arm.sizes?.finger) {
    const last = s.count - 1;
    const hitAt = clamp(Math.round(s.hit), S, Math.max(S, E));
    const tight = s.split > 0 && s.split < S ? s.split : Math.max(1, Math.round(S * SQUEEZE_BY));
    const w0 = arm.baseWorld[arm.hand];
    const inHand = (q) => qturn(qconj(w0.q), sub(q, w0.p));
    const at0 = pointsOf(arm, zero);
    const closing = squeezeOf(closeOn(arm.base, arm.fingers, [inHand(at0.butt), inHand(at0.tip)], arm.sizes.handle, arm.sizes.finger, s.thumbAlong), s.squeeze);
    for (let f = 0; f <= last; f++) closeFingers(poses[f], arm.base, arm.fingers, closing, Math.min(ease(f, 0, tight), 1 - ease(f, hitAt, last)));
    grip.main = closing;
    if (s.offHand === "grip" && arm.offFingers && grip.held) {
      const [H, E2] = grip.held;
      for (let f = 0; f <= last; f++) {
        const amount = Math.min(ease(f, Math.max(0, H - OFF_CLOSE_FRAMES), H), 1 - ease(f, E2, Math.min(last, E2 + OFF_CLOSE_FRAMES)));
        if (amount <= 0) continue;
        const h = worldOf(arm.rig, poses[f])[arm.offHand];
        const local = (q) => qturn(qconj(h.q), sub(q, h.p));
        const here = pointsOf(arm, params[f]);
        // closed to hold it where the fist is short of it; a fist already round it (or through it, as tight as the
        // striking hand's own idle grip is) kept as it is
        const c = Object.fromEntries(Object.entries(closeOn(arm.base, arm.offFingers, [local(here.butt), local(here.tip)], arm.sizes.handle, arm.sizes.finger)).map(([k, v]) => [k, Math.max(v.hold, 0)]));
        closeFingers(poses[f], arm.base, arm.offFingers, c, amount);
        if (f === hitAt) grip.offHit = c;
      }
    }
  }
  for (const [name, x] of Object.entries(misses)) if (x.miss > 1.5) notes.push(`the ${name} key's ${s.point} is ${x.miss} from its place: out of reach or past a limit`);
  return { params, poses, designed, misses, notes, grip };
}

/**
 * A heavy blow as a charged attack plays it (anim/lib/charge.mjs): a made blow split at frame `at` into a charge
 * (the blow's wind-up, retimed so that it is a tenth of its way from where it ends by `reach` seconds and there by
 * `full`, easing in, then held until `hold`) and a release (the rest, from `at` on: what plays when the button
 * is let go). The charge's last frame is the release's first. { charge: { name, fps, frames }, release } with the
 * release as swing's own, its frames and plan counted from the split.
 */
export function charged(made, { at, reach = 0.47, full = 0.7, hold = 1.0 }) {
  const fps = made.fps;
  if (!(at > 0 && at < made.frames.length - 2)) throw new Error(`charged: split at ${at} is not inside the blow`);
  const D = Math.max(2, Math.round(full * fps));
  const H = Math.max(D + 1, Math.round(hold * fps));
  // the share of the wind-up done by time t (0..1 of the charge's drawing back): 1 - (1 - t)^k, a tenth left at reach
  const k = Math.log(0.1) / Math.log(1 - clamp(reach / full, 0.05, 0.95));
  const sample = (u) => {
    const a = Math.floor(u);
    const b = Math.min(at, a + 1);
    const t = u - a;
    return made.frames[a].map((six, bone) => six.map((v, i) => v + (made.frames[b][bone][i] - v) * t));
  };
  const frames = [];
  for (let f = 0; f <= H; f++) frames.push(f >= D ? made.frames[at].map((six) => [...six]) : sample(at * (1 - (1 - f / D) ** k)));
  const shift = (x) => (x === null || x === undefined ? x : x - at);
  const plan = made.plan;
  return {
    charge: { name: `${made.name}_charge`, fps, frames },
    release: {
      ...made,
      frames: made.frames.slice(at),
      poses: made.poses.slice(at),
      params: made.params.slice(at),
      spec: { ...made.spec, hit: made.spec.hit - at, count: made.spec.count - at },
      plan: { ...plan, frames: plan.frames - at, hit: shift(plan.hit), from: shift(plan.from), contact: shift(plan.contact), through: shift(plan.through), designed: plan.designed.slice(at), split: at },
    },
  };
}

/** An angle kept near the frame before's, a whole turn taken off where it leaps (as animate does). */
function unwind(frames) {
  for (let f = 1; f < frames.length; f++)
    frames[f].forEach((six, bone) => {
      for (let k = 3; k < 6; k++) six[k] -= 2 * Math.PI * Math.round((six[k] - frames[f - 1][bone][k]) / (2 * Math.PI));
    });
}

// ── a sequence described as a spec ──────────────────────────────────────────

/**
 * One of a model's own blows said as a spec, by reading its weapon's path (corpus.weaponPath): the strike's
 * start (the slowest frame before the fastest, past any slow drift), its contact (the fastest frame), its end
 * (the first slowest frame after, under half the fastest speed), the tip at every frame of the strike as via
 * points, the slowest frames of the wind-up and recovery and one every `every` frames as keys, the blade's
 * direction at each key, its joints' shares. What swing makes of it, set against the sequence, says how near a
 * spec comes to the game's own.
 */
export function describe(buf, seq, { delay = 0.6, every = 6, kind = "slash" } = {}) {
  const path = weaponPath(buf, { seq });
  const f = path.frames;
  const n = f.length;
  const speeds = f.map((x) => x.speed);
  const peak = speeds.indexOf(Math.max(...speeds));
  // the strike starts at the slowest frame before the fastest (where the blade turns from its wind-up), moved on
  // past a slow drift into the strike (attack1 creeps over the head from 10 to 15 below 15% of its peak)
  let start = peak - 1;
  while (start > 1 && !(speeds[start] <= speeds[start - 1] && speeds[start] <= speeds[start + 1])) start--;
  while (start < peak - 2 && speeds[start + 1] < 0.15 * speeds[peak]) start++;
  let end = peak + 1;
  // and ends at the first slowest frame after it, under half its speed (attack3 dips and speeds up again)
  while (end < n - 2 && !(speeds[end] <= speeds[end - 1] && speeds[end] <= speeds[end + 1] && speeds[end] < 0.5 * speeds[peak])) end++;
  const eye = (p) => [p[0], p[1], p[2] - EYE_ABOVE_ORIGIN];
  const bladeAt = (i) => unit(sub(f[i].tip, f[i].grip));
  const slowest = (i) => speeds[i] <= speeds[i - 1] && speeds[i] <= speeds[i + 1];
  const keysIn = (a, b) => {
    const out = [];
    for (let i = a + 1; i < b; i++)
      // a key at a slowest frame, still only where the original's tip all but stops (its arm may turn on)
      if (slowest(i) || (i - a) % every === 0) out.push({ at: i, place: eye(f[i].tip), blade: bladeAt(i).map(r2), still: slowest(i) && speeds[i] < 0.05 * speeds[peak] });
    return out.filter((k, i, list) => !list[i + 1] || list[i + 1].at - k.at > 1);
  };
  const shares = sharesOf(buf, seq);
  const hit = Math.round(delay * path.fps);
  // how the original flows: its tip's speed at the cock, the through point and the two ends, as shares of the
  // mean speeds of the parts about them (FLOW); its own arm is followed by its keys, so no lead and no wrist held
  const arcOf = (a, b) => f.slice(a + 1, b + 1).reduce((sum, x, i) => sum + Math.hypot(...x.tip.map((v, k) => v - f[a + i].tip[k])), 0);
  const perFrame = (i) => speeds[i] / path.fps;
  const share = (i, a, b) => r2(perFrame(i) / Math.max(1e-6, arcOf(a, b) / Math.max(1, b - a)));
  const windupKeys = keysIn(0, start);
  const recoveryKeys = keysIn(end, n - 1);
  const flow = {
    start: share(0, 0, windupKeys[0]?.at ?? start),
    enter: share(start, start, peak),
    leave: share(end, peak, end),
    end: share(n - 1, recoveryKeys.at(-1)?.at ?? end, n - 1),
    lead: 0,
    windupWrist: 1,
  };
  return {
    name: `re_${path.seq}`,
    kind,
    frames: n,
    fps: path.fps,
    hitFrame: hit,
    timing: "msc",
    at: { from: start, contact: peak, through: end },
    from: eye(f[start].tip),
    via: f.slice(start + 1, peak).map((x) => eye(x.tip)),
    contact: eye(f[peak].tip),
    after: f.slice(peak + 1, end).map((x) => eye(x.tip)),
    through: eye(f[end].tip),
    windup: windupKeys,
    recovery: recoveryKeys,
    blade: { from: bladeAt(start), contact: bladeAt(peak), through: bladeAt(end) },
    flow,
    shares: { shoulder: r2(shares.shoulder), elbow: r2(shares.elbow), wrist: r2(shares.wrist), body: r2(shares.body) },
  };
}
