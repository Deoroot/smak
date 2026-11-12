// Motion in numbers: what one animation of any studio model does, bone by bone and frame by frame, and the hard
// faults in it. `check` judges an animation's validity (frames, events on missing frames, a loop that closes) and
// `form` a shape's boxiness; nothing judged the motion itself, and an animation made by arithmetic or by keys on
// every bone at once can pop, jitter, bend a joint the wrong way, stop dead in the middle and end still swinging,
// and pass every check. This is the measure that says so, as form.mjs says a box: the measures first (`motionOf`,
// numbers only), the judgement over them (`judgeMotion`: faults by thresholds that hold on the games' own files,
// and bands of a class of animation reported as facts, never as faults: ARCHITECTURE.md 8.1, a game's bands are
// its style).
//
//   motionOf(mdl, { seq, groups, overlaps, slide })   one animation measured -> the measures (below)
//   judgeMotion(measures, { kind, bands })            -> { faults, facts, rows, summary }
//   motionKindOf(name, boneNames)                     "figure" for a model with Biped feet that is not a view model
//   MOTION_LIMITS                                     the thresholds of the faults, each with its reason
//   MOTION_BANDS                                      the classes' bands, numbers only (the corpus in the comment)
//   motionPicture(mdl, measures, judged, opts)        the timeline of the bones' speeds with the faults marked, the strip under it
//
// The measures of one animation (every turn is a bone's own, from its parent: a joint's motion, not the limb's
// travel, so a hand carried by a swinging arm is still only when its wrist is):
//   turns[f][b]     [degrees, axis x, y, z]: how far bone b turns between frame f-1 and f, and about what (f from 1)
//   moves[f][b]     units bone b shifts from its parent between frame f-1 and f (a root's: the body's travel in place)
//   total[f]        the sum of the turns of frame f: the animation's motion profile; peak its fastest step
//   still[f]        true when nothing turns or shifts between f-1 and f (within STILL)
//   median[b]       bone b's run: the median of its steps that are not still
//   joints          the named joints found (make/biped.mjs's names): elbows and knees as flex[f] (degrees bent, 0
//                   straight, under 0 past straight the wrong way); wrists and heads as turn[f] from rest;
//                   `named: false` when the skeleton has none of the names
//   seam            { degrees, units, bone } for a looping animation (make/animate.mjs's seam); null otherwise
//   slide           for an animation that travels on a model with two feet: { travel (units a second, the sequence's),
//                   planted (the feet's own speed while on the ground, the median of their planted steps), off (how far
//                   apart, as a share of the travel), steps }; { why } otherwise (make/animate.mjs's track)
//   overlaps        pairs of closed pieces (a bone whose triangles close a volume: a rigid part, not a skinned chunk)
//                   driven into each other, not neighbours (make/wear.mjs's motionOverlaps); { why } with none
//   events          [{ frame, event, options, motion }]: each event with the motion at its frame as a share of the peak
// Plain ESM; the model is read with core/mdl.mjs, the poses with make/animate.mjs's quaternions.

import { sequences as sequencesOf, sequenceAt, bones as bonesOf, frameValues, poseAt, events as eventsOf, readMdl, readMesh, bodyOf, inverse34, apply34 } from "../core/mdl.mjs";
import { qofAngles, qmul, qconj, qunit, degreesOf, rigOf, seam as seamOf, track, worldOf } from "../make/animate.mjs";
import { boneIn } from "../make/biped.mjs";
import { motionOverlaps } from "../make/wear.mjs";
import { closed, box, place, trisOf } from "../core/solids.mjs";
import { shoulderFor } from "../make/arm.mjs";
import { strip, label } from "../make/render.mjs";

const DEG = 180 / Math.PI;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const hyp = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => {
  const l = hyp(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const median = (list) => {
  if (!list.length) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const mean = (list) => (list.length ? list.reduce((s, v) => s + v, 0) / list.length : 0);

/**
 * The thresholds of the hard faults. Each was set where it holds on Half-Life's own third-person models (the
 * figures of MOTION_BANDS' corpus, 51 walk, run and idle animations of 10 models) and on its view models (the
 * crowbar's, the pistol's, the shotgun's), which pass every one of them but for what is said beside it; the
 * spoiled set in test/broken/motion.mjs is what each must catch.
 */
export const MOTION_LIMITS = {
  /** A step under this many degrees, and a shift under this many units, is no motion: Half-Life's idles hold their bones to 0.1 degree. */
  STILL_DEGREES: 0.05,
  STILL_UNITS: 0.01,
  /**
   * A pop: a bone turns in one frame POP_RATIO times its own run (the median of its moving steps in the animation) and
   * POP_LEAST degrees at least, and the next step turns it back (the axes against each other, by half the angle or
   * more). Valve ships one-frame slips of 3 to 6 times the run (the scientist's fingers, barney's idle3 at 7.6); 10 is
   * over every one of them and under the spoiled set's 25.
   */
  POP_RATIO: 10,
  POP_LEAST: 15,
  /**
   * Jitter: this many steps in a row each turning JITTER_LEAST degrees or more, each against the one before (the axes'
   * dot under -0.5). A tremble meant is the same motion (the scientist's scared walk shakes its arms 3 to 4 degrees a
   * frame all through, and is told); a head shake of 5 steps (the slave's idle) is under the run.
   */
  JITTER_RUN: 7,
  JITTER_LEAST: 1.5,
  /** A flip: a bone that turns this far between two frames. No joint does it; a baked IK pole crossing or a wrapped angle does. */
  FLIP_DEGREES: 150,
  /**
   * An elbow or a knee bent this far past straight, the wrong way (the way it bends at rest, or most in the animation
   * when it is straight at rest). A wrist turned this far from its rest: 80 of flex and the forearm's roll that a rig
   * without a twist bone puts in the hand: the hgrunt's left hand sits 128 from its rest in every animation (its rest
   * holds the hand elsewhere than the gun does) and the gman's brushes his suit at 124, both under it. A head turned
   * this far from rest looks behind itself.
   */
  HYPER_DEGREES: 10,
  WRIST_DEGREES: 130,
  HEAD_DEGREES: 90,
  /**
   * Lockstep: the moving bones' speed curves alike to this (the mean of their pairwise Pearson r, each pair weighed by
   * its weaker bone's motion). Keys on every bone at the same frames with the same ease give 0.95 and more; Half-Life's
   * figures' walks and runs are 0.05 to 0.6 (the joints take turns), its view models up to 0.85 (one arm, one weapon).
   * A breathing idle is 0.95 and more by nature (the whole torso rises and falls together, under 20 degrees a second),
   * so it is judged only where the fastest bone turns LOCKSTEP_SPEED degrees a second or more, over 3 moving bones or
   * more and 6 steps or more (the shotgun's 11-frame reholster, everything lowered together at 139, is told).
   */
  LOCKSTEP_R: 0.9,
  LOCKSTEP_BONES: 3,
  LOCKSTEP_STEPS: 6,
  LOCKSTEP_SPEED: 60,
  /** A stall: this many still frames in a row in the middle of a non-looping animation that moves before and after. */
  STALL_FRAMES: 3,
  /**
   * The tail: a non-looping animation whose last step is this share of its fastest step or more, and TAIL_SPEED degrees
   * a second or more, ends mid-swing with no held pose for the game to blend from. An animation another follows at once
   * (a reload's pieces, a miss into the idle: the crowbar's attack1miss ends at its fastest, the shotgun's reload too)
   * ends moving by design and is told all the same, since the kit cannot know what follows.
   */
  TAIL_SHARE: 0.5,
  TAIL_SPEED: 200,
  /** A dead hold: the last frames of a non-looping animation identical for this many frames, or this many seconds (a fact). */
  DEAD_HOLD_FRAMES: 4,
  DEAD_HOLD_SECONDS: 0.3,
  /**
   * The loop's seam: how far a bone may be, in a looping animation's last frame, from where it is in the first (units,
   * degrees). In every looping animation of Half-Life's zombie, hgrunt, headcrab, houndeye and bullsquid the last frame is
   * the first again, to 0.0 degrees and at most 0.31 of a unit.
   */
  SEAM_UNITS: 1,
  SEAM_DEGREES: 2,
  /**
   * Foot slide: the feet's own speed while planted (within SLIDE_GROUND of the leg's length of their lowest) against the
   * travel the game moves the model at (the sequence's), as a share of it; over SLIDE_SHARE the feet skate. Half-Life's
   * walks are 0 to 0.09 off (the gman's the most: its feet go 70.6 units a second under a travel of 77.2), its runs 0 to
   * 0.3 (the scientist's, over 4 planted steps); an animation with its travel doubled is 0.5 off. A jump or a dive, with a
   * foot on the ground in under SLIDE_GROUNDED of its frames, is no gait and is not measured (Half-Life's runs have one
   * in a quarter and more).
   */
  SLIDE_SHARE: 0.5,
  SLIDE_GROUND: 0.02,
  SLIDE_STEPS: 3,
  SLIDE_GROUNDED: 0.2,
  /** Parts through each other: a bone's closed piece this deep in another's that is no neighbour (motionOverlaps' `deep`, units: a skin's thickness). */
  OVERLAP_UNITS: 1,
  /** An event this near the fastest step (frames) is at the peak of motion. */
  EVENT_NEAR_PEAK: 3,
  /**
   * The body behind a view model's arms (make/arm.mjs), judged only in the frames where the forearm is on the
   * screen (EYE). An elbow (the forearm's root) farther from or nearer to its shoulder than the upper arm is long by
   * this share of it: Half-Life's upper arms are rigid (off by 0.00 in all 9157 arm-frames) and its shoulders,
   * carried by the bone above the arm, move by up to 2.97 units (0.26 of the upper arm: the grenade's throw) in the
   * frames its forearms are seen; 0.3 is over every one.
   */
  REACH_SHARE: 0.3,
  /** An elbow above its shoulder by this share of the upper arm: Half-Life's are 0.87 below in the median and 0.21 above at the most (the grenade's throw, frame 0). */
  ELBOW_ABOVE: 0.3,
  /**
   * A forearm seen end-on: the angle between it and the line from the eye to its root under this many degrees.
   * Half-Life's seen forearms are 35.1 at the least (the crowbar's attack3, frame 3), 39.3 the 1st in 100.
   */
  AIM_DEGREES: 30,
  /**
   * The eye the arms are judged by: the field of view across a 4:3 screen and the screen's shape, widened as the
   * game widens it (Hor+). The owner plays at 1920x1080 with r_adjust_fov 1: 90 on a 4:3 base, about 106 across.
   */
  EYE: { fov: 90, aspect: 16 / 9 },
  /** The fastest stretch of a hand's path: the frames about its fastest step whose speed is this share of it or more (arc, spacing, lag). */
  STRETCH_SHARE: 0.5,
};

/** The joints the named measures look for: Biped's names, in whichever language and under whichever root (biped.mjs). */
const JOINTS = [
  { name: "elbow", side: "L", chain: ["Bip01 L UpperArm", "Bip01 L Forearm", "Bip01 L Hand"] },
  { name: "elbow", side: "R", chain: ["Bip01 R UpperArm", "Bip01 R Forearm", "Bip01 R Hand"] },
  { name: "knee", side: "L", chain: ["Bip01 L Thigh", "Bip01 L Calf", "Bip01 L Foot"] },
  { name: "knee", side: "R", chain: ["Bip01 R Thigh", "Bip01 R Calf", "Bip01 R Foot"] },
  { name: "wrist", side: "L", bone: "Bip01 L Hand" },
  { name: "wrist", side: "R", bone: "Bip01 R Hand" },
  { name: "head", side: "", bone: "Bip01 Head" },
];
/** A limb bent less than this at rest has no bend to tell the right way by: the animation's most bent frame says. */
const BENT_AT_REST = 10;

/** The 3 by 3 of a pose's matrix as a direction, and its origin. */
const originOf = (m) => [m[0][3], m[1][3], m[2][3]];

/** A direction taken into a bone's own space (the transpose of its matrix's 3 by 3). */
const inBone = (m, d) => [m[0][0] * d[0] + m[1][0] * d[1] + m[2][0] * d[2], m[0][1] * d[0] + m[1][1] * d[1] + m[2][1] * d[2], m[0][2] * d[0] + m[1][2] * d[1] + m[2][2] * d[2]];

/**
 * A hinge joint's signed flex over the frames, from the joints' places seen in the upper bone's own space (so that the
 * shoulder's or the hip's roll does not turn the hinge: a dive, a death): 0 straight, positive bent the way the limb
 * bends at rest (or, for a limb straight at rest, the way it bends most in this animation), negative past straight.
 * `poses[f][bone]` are the frames' matrices.
 */
function flexOf(poses, [upper, lower, end]) {
  const dirs = poses.map((p) => ({
    ua: unit(inBone(p[upper], sub(originOf(p[lower]), originOf(p[upper])))),
    fa: unit(inBone(p[upper], sub(originOf(p[end]), originOf(p[lower])))),
  }));
  const fold = dirs.map((d) => Math.acos(Math.max(-1, Math.min(1, dot(d.ua, d.fa)))) * DEG);
  // the hinge: the normal of the limb's plane at the frame that bends most (the first, when it is bent at rest)
  let at = 0;
  if (fold[0] < BENT_AT_REST) at = fold.indexOf(Math.max(...fold));
  const hinge = unit(cross(dirs[at].ua, dirs[at].fa));
  if (hyp(cross(dirs[at].ua, dirs[at].fa)) < 1e-6) return { flex: fold.map(() => 0), fold, straight: true };
  return {
    flex: dirs.map((d) => {
      const across = unit(cross(hinge, d.ua));
      return Math.atan2(dot(d.fa, across), dot(d.fa, d.ua)) * DEG;
    }),
    fold,
    straight: false,
  };
}

/** The named joints of a skeleton: each JOINTS entry whose bones the skeleton has, with their numbers. */
function jointsIn(names) {
  const found = [];
  for (const joint of JOINTS) {
    if (joint.chain) {
      const bones = joint.chain.map((n) => boneIn(n, names)).map((n) => (n === null ? -1 : names.indexOf(n)));
      if (bones.every((b) => b >= 0)) found.push({ ...joint, bones });
    } else {
      const bone = boneIn(joint.bone, names);
      if (bone !== null) found.push({ ...joint, bones: [names.indexOf(bone)] });
    }
  }
  return found;
}

/** The names of the feet, when the skeleton has two with a side. */
const feetOf = (names) => names.filter((n) => /(Foot|Piede)/i.test(n) && / (L|R|SX|DX) /.test(` ${n} `));

/**
 * The feet against the travel: each foot's place frame by frame (track), planted where it is within `ground` of the
 * lowest it ever is; its speed back against the travel's own direction (a walk's x, a strafe's y) between two planted
 * frames; `planted` the median of those speeds over both feet (units a second), `off` how far that is from the
 * sequence's travel as a share of it.
 */
function slideOf(list, values, feet, fps, travel, movement) {
  const rig = rigOf(list);
  const along = unit(movement);
  const rest = worldOf(rig, rig.rest);
  const hips = rig.names.filter((n) => /(Thigh|Leg|Coscia)$/.test(n)).map((n) => rest[rig.index(n)].p[2]);
  const foot = rest[rig.index(feet[0])].p[2];
  const leg = hips.length ? Math.abs(Math.max(...hips) - foot) : 0;
  const ground = Math.max(0.1, MOTION_LIMITS.SLIDE_GROUND * leg);
  const speeds = [];
  const onGround = values.map(() => false);
  for (const name of feet) {
    const path = track(rig, values, name);
    const low = Math.min(...path.map((p) => p[2]));
    const planted = path.map((p) => p[2] <= low + ground);
    planted.forEach((on, f) => (onGround[f] ||= on));
    for (let f = 1; f < path.length; f++) if (planted[f] && planted[f - 1]) speeds.push(dot(sub(path[f - 1], path[f]), along) * fps);
  }
  const grounded = onGround.filter(Boolean).length;
  if (grounded < MOTION_LIMITS.SLIDE_GROUNDED * values.length) return { why: `a foot is on the ground in ${grounded} of ${values.length} frames, under a fifth: a jump or a dive, not a gait` };
  if (speeds.length < MOTION_LIMITS.SLIDE_STEPS) return { why: `the feet are planted for ${speeds.length} steps, fewer than ${MOTION_LIMITS.SLIDE_STEPS}` };
  const planted = median(speeds);
  return { travel: r2(travel), planted: r2(planted), off: travel > 0 ? r3(Math.abs(planted - travel) / travel) : null, steps: speeds.length, ground: r2(ground) };
}

/**
 * One animation measured (see the top of this file). `seq`: its name or number. `groups`: the files of animations
 * kept beside the model (sequenceFilesOf), for one kept there. `overlaps` and `slide` (true unless told) run
 * motionOverlaps over the bones' own triangles and footSlide over the feet: the costly measures, left out by `check`.
 * Throws for an animation the model has not, or one kept in another file with no `groups`.
 */
export function motionOf(mdl, { seq = 0, groups, overlaps = true, slide = true, arms, eye = MOTION_LIMITS.EYE } = {}) {
  const index = sequenceAt(mdl, seq);
  const all = sequencesOf(mdl);
  const sequence = all[index];
  if (!sequence) throw new Error(`motionOf: no animation ${seq}: it has ${all.map((s) => s.name).join(", ")}`);
  if (sequence.group && !groups?.[sequence.group])
    throw new Error(`motionOf: the animation ${sequence.name} is kept in another file: give groups (sequenceFilesOf)`);
  const list = bonesOf(mdl);
  const names = list.map((b) => b.name);
  const n = sequence.frames;
  const L = MOTION_LIMITS;
  const values = Array.from({ length: n }, (_, f) => frameValues(mdl, index, f, 0, groups));
  const quats = values.map((frame) => frame.map((six) => qunit(qofAngles(six.slice(3)))));
  const turns = [null];
  const moves = [null];
  const total = [0];
  const still = [false];
  for (let f = 1; f < n; f++) {
    const row = [];
    const shift = [];
    let sum = 0;
    let quiet = true;
    for (let b = 0; b < list.length; b++) {
      const d = qmul(qconj(quats[f - 1][b]), quats[f][b]);
      const degrees = degreesOf(d);
      // the axis of the turn, the way the quaternion's vector part points (the sign of w taken out)
      const sign = d[0] < 0 ? -1 : 1;
      const axis = hyp([d[1], d[2], d[3]]) > 1e-12 ? unit([sign * d[1], sign * d[2], sign * d[3]]) : [0, 0, 0];
      row.push([degrees, ...axis]);
      const units = hyp(sub(values[f][b].slice(0, 3), values[f - 1][b].slice(0, 3)));
      shift.push(units);
      sum += degrees;
      if (degrees >= L.STILL_DEGREES || units >= L.STILL_UNITS) quiet = false;
    }
    turns.push(row);
    moves.push(shift);
    total.push(sum);
    still.push(quiet);
  }
  const med = list.map((_, b) => median(turns.slice(1).map((row) => row[b][0]).filter((v) => v >= L.STILL_DEGREES)));
  const travelled = list.map((_, b) => turns.slice(1).reduce((s, row) => s + row[b][0], 0));
  let peak = 1;
  for (let f = 2; f < n; f++) if (total[f] > total[peak]) peak = f;

  // the named joints, from the frames' matrices
  const found = jointsIn(names);
  let joints = { named: found.length > 0, list: [] };
  const chains = arms ? armsIn(names, list, arms) : [];
  const poses = found.length || chains.length ? Array.from({ length: n }, (_, f) => poseAt(mdl, index, f, 0, groups)) : null;
  if (found.length && n > 0) {
    const rig = rigOf(list);
    for (const joint of found) {
      if (joint.chain) {
        const { flex, fold, straight } = flexOf(poses, joint.bones);
        joints.list.push({ name: joint.name, side: joint.side, bone: names[joint.bones[1]], flex: flex.map(r2), fold: fold.map(r2), straight });
      } else {
        const b = joint.bones[0];
        const rest = rig.rest.q[b];
        joints.list.push({ name: joint.name, side: joint.side, bone: names[b], turn: quats.map((q) => r2(degreesOf(qmul(qconj(rest), q[b])))) });
      }
    }
  }

  // the seam of a loop, the feet's slide, the parts through each other
  const seam = sequence.loops && n >= 2 ? seamOf(rigOf(list), values) : null;
  let slid = null;
  if (slide) {
    const feet = feetOf(names);
    if (!sequence.movement.some((v) => v)) slid = { why: "does not travel" };
    else if (feet.length < 2) slid = { why: "no two feet with a side among the bones" };
    else if (n < 3) slid = { why: "under 3 frames" };
    else slid = slideOf(list, values, feet, sequence.fps, sequence.speed, sequence.movement);
  }
  let through = null;
  const { pieces, open, byBone } = overlaps || chains.length ? piecesOf(mdl, names, chains) : {};
  if (overlaps) {
    if (pieces.length < 2) through = { why: `${pieces.length} closed piece${pieces.length === 1 ? "" : "s"} on the bones (${open} skinned chunks left out): nothing to drive into another` };
    else {
      // with arms, the pieces are as built in the first frame of the first animation (the idle's hold: a hand on the grip by design)
      const found = motionOverlaps(mdl, pieces, [index], { groups, still: chains.length ? { seq: 0, frame: 0 } : null });
      // two arms' bones hang from one body bone and are no joint of each other: a forearm through the other is told
      const armOf = new Map(chains.flatMap((c, k) => [c.fore, c.hand, c.held].map((b) => [names[b], k])));
      const apart = (p) => armOf.has(p.a) && armOf.has(p.b) && armOf.get(p.a) !== armOf.get(p.b);
      through = { pairs: (found.sequences[0]?.pairs ?? []).filter((p) => !p.near || apart(p)), pieces: pieces.length, open, skipped: found.skipped };
    }
  }
  const body = arms ? armsBody(mdl, list, chains, poses, byBone, { eye, groups }) : null;
  const events = eventsOf(mdl, index).map((e) => ({
    ...e,
    motion: e.frame >= 0 && e.frame < n ? r3(total[peak] ? total[Math.max(1, Math.min(n - 1, e.frame))] / total[peak] : 0) : null,
  }));
  return {
    name: sequence.name,
    index,
    frames: n,
    fps: sequence.fps,
    loops: sequence.loops,
    movement: sequence.movement,
    bones: names,
    turns,
    moves,
    total,
    still,
    peak,
    median: med,
    travelled,
    joints,
    seam,
    slide: slid,
    overlaps: through,
    body,
    events,
  };
}

/**
 * Each bone's own triangles (every corner on it) that close a volume (a rigid part: a weapon, a helmet, a kit's piece),
 * as pieces motionOverlaps takes, in the bone's space; `open` counts the bones whose triangles do not close (a skinned
 * body's chunks, which run on into their neighbours and are no solid to measure). The bones of `chains` (armsIn's: a
 * forearm, its hand, what it holds) that do not close stand in as a box about the bulk of their corners (the 10th to
 * the 90th in 100 on each of the bone's axes), so that a forearm cut open at the screen's edge is still a limb.
 * `byBone`: each bone's corners.
 */
function piecesOf(mdl, names, chains = []) {
  const info = readMdl(mdl);
  const shown = bodyOf(mdl, 0);
  const byBone = new Map();
  info.bodyparts.forEach((bodypart, i) => {
    const model = bodypart.models[shown[i]];
    if (!model) return;
    for (const mesh of model.meshes)
      for (const tri of readMesh(mdl, model, mesh)) {
        if (tri[0].bone !== tri[1].bone || tri[0].bone !== tri[2].bone) continue;
        if (!byBone.has(tri[0].bone)) byBone.set(tri[0].bone, []);
        byBone.get(tri[0].bone).push(tri.map((c) => c.p));
      }
  });
  const pieces = [];
  let open = 0;
  const limbs = new Set(chains.flatMap((c) => [c.fore, c.hand, c.held]));
  for (const [bone, tris] of byBone) {
    if (!(tris.length >= 4 && closed(tris).closed)) {
      if (limbs.has(bone)) pieces.push({ bone, name: names[bone], tris: bulkOf(tris.flat()) });
      else open++;
      continue;
    }
    // motionOverlaps reads a piece's inside from its triangles' winding: a piece wound inward (as a file may store it)
    // is turned outward by its signed volume
    const volume = tris.reduce((sum, [a, b, c]) => sum + dot(a, cross(b, c)), 0);
    pieces.push({ bone, name: names[bone], tris: volume < 0 ? tris.map(([a, b, c]) => [a, c, b]) : tris });
  }
  return { pieces, open, byBone };
}

/** A closed box about the bulk of a bone's corners: the 10th to the 90th in 100 on each of its axes. */
function bulkOf(points) {
  const span = [0, 1, 2].map((a) => {
    const s = points.map((p) => p[a]).sort((x, y) => x - y);
    return [s[Math.floor(0.1 * (s.length - 1))], s[Math.ceil(0.9 * (s.length - 1))]];
  });
  const size = span.map(([lo, hi]) => Math.max(0.1, hi - lo));
  return trisOf(box(place(span.map(([lo, hi]) => (lo + hi) / 2), [0, 0, 1], [1, 0, 0]), size[0], size[1], size[2]));
}

// ── the body behind a view model's arms ──────────────────────────────────────
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

/**
 * The arms to judge: `arms` true for Biped's (each side's Forearm and Hand, with its UpperArm when that is the
 * forearm's parent), or a list of [fore, hand, held?] (or "fore:hand:held", or { fore, hand, held }) by name or number,
 * for a rig whose names say nothing (Bone01 ...). -> [{ fore, hand, held, upper }], numbers; upper -1 with no upper arm.
 */
function armsIn(names, list, arms) {
  const at = (which) => {
    if (which === undefined || which === null || which === "") return undefined;
    const i = /^\d+$/.test(String(which)) ? Number(which) : names.indexOf(which);
    if (!(i >= 0 && i < names.length)) throw new Error(`motionOf: no bone ${which} for an arm: it has ${names.join(", ")}`);
    return i;
  };
  const upperOf = (fore) => {
    const parent = list[fore].parent;
    return parent >= 0 && ["L", "R"].some((side) => boneIn(`Bip01 ${side} UpperArm`, [names[parent]]) !== null) ? parent : -1;
  };
  if (arms === true)
    return ["L", "R"]
      .map((side) => [boneIn(`Bip01 ${side} Forearm`, names), boneIn(`Bip01 ${side} Hand`, names)].map((n) => (n === null ? -1 : names.indexOf(n))))
      .filter(([fore, hand]) => fore >= 0 && hand >= 0 && list[hand].parent === fore)
      .map(([fore, hand]) => ({ fore, hand, held: undefined, upper: upperOf(fore) }));
  return arms.map((arm) => {
    const [fore, hand, held] = (typeof arm === "string" ? arm.split(":") : Array.isArray(arm) ? arm : [arm.fore, arm.hand, arm.held]).map(at);
    if (fore === undefined || hand === undefined || list[hand].parent !== fore)
      throw new Error(`motionOf: an arm is a forearm and its hand, the hand the forearm's child: ${JSON.stringify(arm)}`);
    return { fore, hand, held, upper: upperOf(fore) };
  });
}

/**
 * Each arm against a body (make/arm.mjs), frame by frame: its shoulder (the upper arm's root where the rig has one;
 * else shoulderFor's, fitted to the forearm's root in the first frame of the first animation and carried by the
 * forearm's parent), and for each frame whether the forearm or its hand is on the screen of `eye` (a point along it
 * or the hand's farthest corner), its root's distance from the
 * shoulder less the upper arm (`reach`), its height over the shoulder as a share of the upper arm (`above`), the
 * angle between the forearm and the eye's line to its root (`aim`), the hand's place and the tip's (the corner of
 * what the hand holds, or of the hand, farthest from its bone). The first arm's path is measured for the principles.
 */
function armsBody(mdl, list, chains, poses, byBone, { eye, groups }) {
  if (!chains.length) return { why: "no arms: name them (Biped's forearms and hands, or --arms fore:hand)" };
  let ref = poses[0];
  try {
    ref = poseAt(mdl, 0, 0, 0, groups);
  } catch {}
  const tall = Math.tan((eye.fov * Math.PI) / 360) * 0.75;
  const wide = tall * eye.aspect;
  const onScreen = (p) => p[0] > 1 && Math.abs(p[1]) <= wide * p[0] && Math.abs(p[2]) <= tall * p[0];
  const arms = chains.map((c) => {
    const e0 = originOf(ref[c.fore]);
    const fore = hyp(sub(originOf(ref[c.hand]), e0));
    const side = e0[1] >= 0 ? "L" : "R";
    let upper;
    let shoulderAt;
    let fitted = null;
    if (c.upper >= 0) {
      upper = hyp(sub(e0, originOf(ref[c.upper])));
      shoulderAt = (p) => originOf(p[c.upper]);
    } else {
      const fit = shoulderFor({ elbow: e0, fore, side });
      upper = fit.upper;
      fitted = fit.fitted;
      const parent = list[c.fore].parent;
      const local = parent < 0 ? fit.shoulder : apply34(inverse34(ref[parent]), fit.shoulder);
      shoulderAt = (p) => (parent < 0 ? local : apply34(p[parent], local));
    }
    const farthest = (bone) => (byBone?.get(bone) ?? []).flat().reduce((far, p) => (hyp(p) > hyp(far) ? p : far), [0, 0, 0]);
    const tipBone = c.held ?? c.hand;
    const tipLocal = farthest(tipBone);
    const fingers = farthest(c.hand);
    const frames = poses.map((p) => {
      const s = shoulderAt(p);
      const e = originOf(p[c.fore]);
      const h = originOf(p[c.hand]);
      const fa = sub(h, e);
      return {
        seen: [0, 0.25, 0.5, 0.75, 1].some((t) => onScreen(add(e, scale(fa, t)))) || onScreen(apply34(p[c.hand], fingers)),
        reach: r2(hyp(sub(e, s)) - upper),
        above: r3((e[2] - s[2]) / upper),
        aim: r2(Math.acos(Math.min(1, Math.abs(dot(unit(fa), unit(e))))) * DEG),
        hand: h,
        tip: apply34(p[tipBone], tipLocal),
      };
    });
    return { fore: list[c.fore].name, hand: list[c.hand].name, held: c.held === undefined ? null : list[c.held].name, side, forearm: r2(fore), upper: r2(upper), shoulder: shoulderAt(ref).map(r2), fitted, frames };
  });
  return { eye, arms, principles: principlesOf(arms[0].frames) };
}

/**
 * The principles of animation as numbers, over a hand's path and its tip's (armsBody's frames), about the hand's
 * fastest stretch (the frames about its fastest step whose speed is STRETCH_SHARE of it or more):
 *   arc           `straight` the chord over the path (1: a line), `bow` how far the path leaves the chord, over its length
 *   spacing       `rise` and `fall`: frames from a fifth of the peak speed to it and back; `jump` the largest change of
 *                 speed in one step, as a share of the peak (near 1: no ease into or out of the cut)
 *   anticipation  `back`: how far the hand goes against the stretch's direction before it, as a share of the chord
 *   lag           `frames`: the tip's fastest step after the hand's; `travel`: the tip's path over the hand's in the stretch
 * null for a hand that does not move.
 */
function principlesOf(frames) {
  const n = frames.length;
  const speed = (key) => frames.map((f, i) => (i ? hyp(sub(f[key], frames[i - 1][key])) : 0));
  const v = speed("hand");
  const vt = speed("tip");
  let peak = 1;
  for (let f = 2; f < n; f++) if (v[f] > v[peak]) peak = f;
  if (!(n >= 3 && v[peak] > MOTION_LIMITS.STILL_UNITS)) return null;
  let a = peak;
  let b = peak;
  while (a > 1 && v[a - 1] >= MOTION_LIMITS.STRETCH_SHARE * v[peak]) a--;
  while (b < n - 1 && v[b + 1] >= MOTION_LIMITS.STRETCH_SHARE * v[peak]) b++;
  const at = (f) => frames[f].hand;
  const chord = sub(at(b), at(a - 1));
  const long = hyp(chord);
  const path = v.slice(a, b + 1).reduce((s, x) => s + x, 0);
  const dir = unit(chord);
  let bow = 0;
  for (let f = a - 1; f <= b; f++) {
    const off = sub(at(f), at(a - 1));
    bow = Math.max(bow, hyp(sub(off, scale(dir, dot(off, dir)))));
  }
  let back = 0;
  for (let f = 0; f < a - 1; f++) back = Math.max(back, -dot(sub(at(f), at(a - 1)), dir));
  let rise = peak;
  while (rise > 1 && v[rise - 1] >= 0.2 * v[peak]) rise--;
  let fall = peak;
  while (fall < n - 1 && v[fall + 1] >= 0.2 * v[peak]) fall++;
  let jump = 0;
  for (let f = 2; f < n; f++) jump = Math.max(jump, Math.abs(v[f] - v[f - 1]) / v[peak]);
  let tipPeak = 1;
  for (let f = 2; f < n; f++) if (vt[f] > vt[tipPeak]) tipPeak = f;
  return {
    from: a - 1,
    to: b,
    peak,
    arc: { straight: long > 1e-9 ? r3(long / path) : null, bow: long > 1e-9 ? r3(bow / long) : null },
    spacing: { rise: peak - rise + 1, fall: fall - peak + 1, jump: r3(jump) },
    anticipation: { back: long > 1e-9 ? r3(back / long) : 0, units: r2(back) },
    lag: { frames: tipPeak - peak, travel: path > 1e-9 ? r2(vt.slice(a, b + 1).reduce((s, x) => s + x, 0) / path) : null },
  };
}

/** Pearson's r of two lists. */
function pearson(a, b) {
  const ma = mean(a);
  const mb = mean(b);
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < a.length; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return saa > 1e-9 && sbb > 1e-9 ? sab / Math.sqrt(saa * sbb) : null;
}

/**
 * The per-animation scalars the bands hold (and the summary line prints), from the measures:
 *   peak       the fastest any bone turns, degrees a second
 *   speed      the mean turn of the moving bones, degrees a second
 *   moving     the share of the bones that turn 2 degrees or more over the animation
 *   lockstep   how alike the moving bones' speed curves are (mean pairwise r, weighed); null under 3 bones or 6 steps
 *   spike      the largest step of any bone as a multiple of that bone's run (its median moving step)
 *   stillness  the share of the steps in which nothing moves
 *   jerk       how unsteady the motion is: the mean change of the total turn from step to step over its mean
 */
export function motionSummary(m) {
  const L = MOTION_LIMITS;
  const steps = m.frames - 1;
  const bones = m.bones.length;
  const moving = m.bones.map((_, b) => b).filter((b) => m.travelled[b] >= 2);
  const curves = moving.map((b) => m.turns.slice(1).map((row) => row[b][0]));
  const peakBone = Math.max(0, ...m.turns.slice(1).flatMap((row) => row.map((t) => t[0])));
  let lockstep = null;
  if (moving.length >= L.LOCKSTEP_BONES && steps >= L.LOCKSTEP_STEPS) {
    const most = Math.max(1e-9, ...curves.flat());
    let sum = 0;
    let weight = 0;
    for (let i = 0; i < curves.length; i++)
      for (let k = i + 1; k < curves.length; k++) {
        const r = pearson(curves[i], curves[k]);
        if (r === null) continue;
        const w = Math.min(Math.max(...curves[i]), Math.max(...curves[k])) / most;
        sum += w * r;
        weight += w;
      }
    lockstep = weight > 1e-9 ? r3(sum / weight) : null;
  }
  let spike = 0;
  for (const b of moving) {
    const run = m.median[b];
    if (run > 0) spike = Math.max(spike, Math.max(...curves[moving.indexOf(b)]) / run);
  }
  const totals = m.total.slice(1);
  const jerk = totals.length > 1 && mean(totals) > 1e-9 ? mean(totals.slice(1).map((t, i) => Math.abs(t - totals[i]))) / mean(totals) : 0;
  return {
    peak: r2(peakBone * m.fps),
    speed: steps && moving.length ? r2((mean(curves.flat()) || 0) * m.fps) : 0,
    moving: bones ? r3(moving.length / bones) : 0,
    lockstep,
    spike: r2(spike),
    stillness: steps ? r3(m.still.slice(1).filter(Boolean).length / steps) : 0,
    jerk: r3(jerk),
  };
}

/**
 * Bands, numbers only: a measure's least, quartiles, median and most over a corpus (the 5th and 95th in 100), as
 * FORM_BANDS keeps a form's. A band is said as a FACT ("inside the middle half", "above the 95th in 100"), never as a
 * fault: bands from one game are that game's style, not quality (ARCHITECTURE.md 8.1).
 */
export const MOTION_BANDS = {
  // Measured by node (motionSummary over motionOf) on Half-Life's own third-person models in its valve/models folder,
  // 2026-11-11: scientist, barney, hgrunt, zombie, headcrab, houndeye, bullsquid, islave, gman and player (the ten
  // player/* bodies share player.mdl's animations), every animation named walk*, run* or idle* or of the activity
  // ACT_WALK, ACT_RUN or ACT_IDLE that is kept in the model's own file and has 3 frames or more: 59 animations.
  // least and most: the 5th and 95th in the corpus' order, with the quartiles. `stillness` is 0 through the corpus and
  // has no band. Half-Life's are keyed by hand at 10 to 40 frames a second, which the spike (one-frame slips of 6 to
  // 15 times a bone's run are its median) and the jerk say: a motion-captured corpus would read lower on both.
  figure: {
    of: "Half-Life's figures' 59 walks, runs and idles",
    measures: {
      peak: { least: 14.83, q1: 168.46, median: 582.04, q3: 1218.1, most: 2341.23 },
      speed: { least: 4.9, q1: 17.74, median: 43.23, q3: 138.24, most: 277.99 },
      moving: { least: 0.205, q1: 0.417, median: 0.706, q3: 0.833, most: 0.917 },
      lockstep: { least: 0.052, q1: 0.129, median: 0.239, q3: 0.379, most: 0.875 },
      spike: { least: 1.75, q1: 6.16, median: 9.44, q3: 15.36, most: 31.79 },
      jerk: { least: 0.085, q1: 0.154, median: 0.222, q3: 0.279, most: 0.359 },
    },
  },
  // melee (first-person blows) and firearm (first-person draws, shots and reloads) come with their pieces
  // (ARCHITECTURE.md 8.4): each is measured from its reference when that piece is made. An empty band judges nothing.
  melee: { of: "no corpus yet", measures: {} },
  firearm: { of: "no corpus yet", measures: {} },
};

/** How each summary measure is said in a band's fact. */
const SUMMARY_SAID = {
  peak: "the fastest bone turns (degrees a second)",
  speed: "the moving bones' mean turn (degrees a second)",
  moving: "share of the bones that move",
  lockstep: "lockstep (how alike the bones' speed curves are, 0 to 1)",
  spike: "the largest step as a multiple of its bone's run",
  stillness: "share of the steps in which nothing moves",
  jerk: "jerk (the change of speed from step to step, over the mean speed)",
};

/** "figure" for a model with two Biped feet whose file is no view model (v_*); undefined otherwise: the class is told. */
export function motionKindOf(name = "", boneNames = []) {
  if (/^v_/i.test(name.replace(/^.*[\\/]/, ""))) return undefined;
  return feetOf(boneNames).length >= 2 ? "figure" : undefined;
}

const frameOf = (f) => `frame ${f}`;

/**
 * The judgement over `motionOf`'s measures: { faults, facts, rows, summary }. `faults` are sentences of the hard
 * faults (MOTION_LIMITS), each naming the frame, the bone and what to do; `facts` what is worth knowing and is no
 * fault (a dead hold, the events against the motion, and with `kind` each band measure's place: inside the middle
 * half, below or above it, past the 5th or 95th in 100). `rows`: the bands' numbers for a table.
 */
export function judgeMotion(m, { kind, bands = MOTION_BANDS } = {}) {
  const L = MOTION_LIMITS;
  const faults = [];
  const found = [];
  const facts = [];
  /** A fault by its key (MOTION_SAID's), the frame and the bone it is at, and its sentence. */
  const fault = (key, frame, bone, said) => {
    found.push({ key, frame, bone, said });
    faults.push(said);
  };
  const n = m.frames;
  const steps = n - 1;
  const where = (f, b) => `${frameOf(f)}, ${m.bones[b]}`;
  if (steps >= 1) {
    // pops, jitter and flips, bone by bone
    for (let b = 0; b < m.bones.length; b++) {
      const run = m.median[b];
      let popped = null;
      let flipped = null;
      let jitterAt = null;
      let reversals = 0;
      for (let f = 1; f <= steps; f++) {
        const [deg, ...axis] = m.turns[f][b];
        if (deg > L.FLIP_DEGREES && flipped === null) flipped = f;
        const next = f < steps ? m.turns[f + 1][b] : null;
        if (next && deg >= L.POP_LEAST && deg >= L.POP_RATIO * run && dot(axis, next.slice(1)) < -0.5 && next[0] >= deg / 2 && popped === null)
          popped = { f, deg, run };
        if (next && deg >= L.JITTER_LEAST && next[0] >= L.JITTER_LEAST && dot(axis, next.slice(1)) < -0.5) {
          reversals++;
          if (reversals >= L.JITTER_RUN - 1 && jitterAt === null) jitterAt = f + 1 - (L.JITTER_RUN - 1);
        } else reversals = 0;
      }
      if (flipped !== null)
        fault("flip", flipped, m.bones[b], `motion: ${m.name}: ${where(flipped, b)} turns ${Math.round(m.turns[flipped][b][0])} degrees in one frame: a flip (a joint turned the long way round, or an angle wrapped); turn it the short way, or spread the turn over frames`);
      else if (popped)
        fault("pop", popped.f, m.bones[b], `motion: ${m.name}: ${where(popped.f, b)} turns ${Math.round(popped.deg)} degrees in one frame and back the next${popped.run > 0 ? `, ${Math.round(popped.deg / popped.run)} times its run of ${r2(popped.run)}` : ", and is still otherwise"}: a pop (a one-frame slip); take the frame out or ease it between its neighbours`);
      if (jitterAt !== null && popped === null && flipped === null)
        fault("jitter", jitterAt, m.bones[b], `motion: ${m.name}: ${where(jitterAt, b)} turns one way and back every frame for ${L.JITTER_RUN} steps: jitter (noise on the keys, unless a tremble is meant); smooth the channel or key it less often`);
    }
    // joints past their range
    for (const j of m.joints.list) {
      const side = j.side ? `${j.side === "L" ? "left" : "right"} ` : "";
      if (j.flex && !j.straight) {
        const f = j.flex.findIndex((v) => v < -L.HYPER_DEGREES);
        if (f >= 0)
          fault("hyper", f, j.bone, `motion: ${m.name}: ${frameOf(f)}, the ${side}${j.name} (${j.bone}) bends ${Math.round(-j.flex[f])} degrees past straight, the wrong way: hyperextended; keep its bend on the side it has at rest (reach's bend)`);
      }
      if (j.turn) {
        const most = j.name === "wrist" ? L.WRIST_DEGREES : L.HEAD_DEGREES;
        const f = j.turn.findIndex((v) => v > most);
        if (f >= 0)
          fault("range", f, j.bone, `motion: ${m.name}: ${frameOf(f)}, the ${side}${j.name} (${j.bone}) is turned ${Math.round(j.turn[f])} degrees from rest, past the ${most} a ${j.name} turns: bring the turn into the ${j.name === "wrist" ? "forearm" : "neck and spine"} too`);
      }
    }
    // lockstep, the stall, the tail, the seam
    const summary = motionSummary(m);
    if (summary.lockstep !== null && summary.lockstep > L.LOCKSTEP_R && summary.peak >= L.LOCKSTEP_SPEED)
      fault("lockstep", null, null, `motion: ${m.name}: the moving bones speed up and slow down together (lockstep r ${summary.lockstep}, over ${L.LOCKSTEP_R}): keys on every bone at the same frames with the same ease; stagger the keys so that the joints take turns (the hip leads, the knee follows, the foot last)`);
    if (!m.loops) {
      let run = 0;
      let movedBefore = false;
      let stall = null;
      for (let f = 1; f <= steps; f++) {
        if (m.still[f]) run++;
        else {
          if (movedBefore && run >= L.STALL_FRAMES && stall === null) stall = f - run;
          run = 0;
          movedBefore = true;
        }
      }
      if (stall !== null)
        fault("stall", stall, null, `motion: ${m.name}: nothing moves from ${frameOf(stall)} for ${L.STALL_FRAMES} frames or more, between motion before and after: a stall (a key held, then the next); let some joint keep turning through it, or take the held frames out`);
      const last = m.total[steps] ?? 0;
      const peakStep = Math.max(...m.total.slice(1).map((t, i) => Math.max(...(m.turns[i + 1]?.map((x) => x[0]) ?? [0]))));
      const lastStep = Math.max(...(m.turns[steps]?.map((x) => x[0]) ?? [0]));
      if (steps >= 2 && lastStep * m.fps >= L.TAIL_SPEED && lastStep >= L.TAIL_SHARE * peakStep)
        fault("tail", steps, null, `motion: ${m.name}: it ends still moving (${frameOf(steps)}: the fastest bone turns ${r2(lastStep)} degrees, ${Math.round(lastStep * m.fps)} a second, of a peak of ${r2(peakStep)}): no held pose for the game to blend from, unless another animation follows it at once; ease the last frames into a hold`);
      const holdFrames = Math.max(L.DEAD_HOLD_FRAMES, Math.ceil(L.DEAD_HOLD_SECONDS * m.fps));
      let held = 0;
      for (let f = steps; f >= 1 && m.still[f]; f--) held++;
      if (held >= holdFrames && held < steps) facts.push(`motion: ${m.name}: its last ${held + 1} frames are identical (a dead hold of ${r2((held + 1) / m.fps)} s): the game holds the last frame itself; a breath or a settle there reads as alive`);
      if (last === 0 && steps >= 1 && m.total.slice(1).every((t) => t === 0)) facts.push(`motion: ${m.name}: nothing moves in it`);
    } else if (m.seam && (m.seam.degrees > L.SEAM_DEGREES || m.seam.units > L.SEAM_UNITS))
      fault("seam", steps, m.seam.bone, `motion: ${m.name}: the loop does not close: in its last frame ${m.seam.bone} is ${r2(m.seam.degrees)} degrees and ${r2(m.seam.units)} units from where it is in the first; make the last frame a copy of the first`);
    // the feet, and parts through each other
    if (m.slide?.off !== undefined && m.slide.off !== null && m.slide.off > L.SLIDE_SHARE)
      fault("slide", null, null, `motion: ${m.name}: the planted feet go ${m.slide.planted} units a second and the travel is ${m.slide.travel}: foot slide (${Math.round(m.slide.off * 100)}% off); set the travel to the feet's own speed, or the feet to the travel (stride)`);
    else if (m.slide?.off !== undefined && m.slide.off !== null) facts.push(`motion: ${m.name}: the planted feet go ${m.slide.planted} units a second, the travel ${m.slide.travel} (${Math.round(m.slide.off * 100)}% off, over ${m.slide.steps} planted steps)`);
    if (m.overlaps?.pairs?.length) {
      const deep = m.overlaps.pairs.filter((p) => p.deep > L.OVERLAP_UNITS);
      if (deep.length) {
        const worst = deep[0];
        fault("overlap", worst.frame, worst.a, `motion: ${m.name}: ${frameOf(worst.frame)}, ${worst.a} is ${r2(worst.deep)} units inside ${worst.b}${deep.length > 1 ? ` (and ${deep.length - 1} more pairs)` : ""}: parts through each other; move the limb clear, or the piece`);
      }
    }
    if (m.overlaps?.why) facts.push(`motion: ${m.name}: parts through each other not measured: ${m.overlaps.why}`);
    // the body behind the arms, in the frames the forearm is on the screen
    if (m.body?.why) facts.push(`motion: ${m.name}: the body not measured: ${m.body.why}`);
    for (const arm of m.body?.arms ?? []) {
      const said = `the ${arm.side === "L" ? "left" : "right"} forearm (${arm.fore})`;
      const seen = arm.frames.map((f, i) => ({ ...f, i })).filter((f) => f.seen);
      const far = seen.filter((f) => Math.abs(f.reach) > L.REACH_SHARE * arm.upper);
      const high = seen.filter((f) => f.above > L.ELBOW_ABOVE);
      const aimed = seen.filter((f) => f.aim < L.AIM_DEGREES);
      if (far.length) {
        const w = far.reduce((x, y) => (Math.abs(y.reach) > Math.abs(x.reach) ? y : x));
        fault("elbow", w.i, arm.fore, `motion: ${m.name}: ${frameOf(w.i)}, ${said} starts ${r2(Math.abs(w.reach))} units ${w.reach > 0 ? "farther from" : "nearer"} its shoulder than the upper arm's ${arm.upper} (in ${far.length} frame${far.length === 1 ? "" : "s"} on the screen): no shoulder holds it there; put its root where an upper arm reaches (make/arm.mjs solveArm, placeForearm)`);
      } else if (high.length) {
        const w = high.reduce((x, y) => (y.above > x.above ? y : x));
        fault("elbow", w.i, arm.fore, `motion: ${m.name}: ${frameOf(w.i)}, ${said} starts ${r2(w.above)} of the upper arm above its shoulder, past the ${L.ELBOW_ABOVE} an elbow rises (in ${high.length} frame${high.length === 1 ? "" : "s"} on the screen): lower the elbow (solveArm's pole down)`);
      }
      if (aimed.length) {
        const w = aimed.reduce((x, y) => (y.aim < x.aim ? y : x));
        fault("aim", w.i, arm.fore, `motion: ${m.name}: ${frameOf(w.i)}, ${said} lies ${Math.round(w.aim)} degrees off the eye's line to its root, under ${L.AIM_DEGREES} (in ${aimed.length} frame${aimed.length === 1 ? "" : "s"}): seen end-on, it is aimed at the camera; swing the elbow out and down so that the forearm crosses the view`);
      }
      const hidden = arm.frames.length - seen.length;
      facts.push(`motion: ${m.name}: ${said}: shoulder at ${arm.shoulder.join(", ")} from the eye${arm.fitted === null ? " (its upper arm's root)" : arm.fitted ? ", fitted to the first frame of the first animation" : ", Half-Life's: no shoulder at its lateral and height reaches the first frame's elbow"}; upper arm ${arm.upper}, forearm ${arm.forearm}; off the screen in ${hidden} of ${arm.frames.length} frames (not judged there)`);
    }
    const pr = m.body?.principles;
    if (pr)
      facts.push(
        `motion: ${m.name}: the hand's fastest stretch, frames ${pr.from} to ${pr.to}: arc ${pr.arc.straight} straight (1 a line), bowed ${pr.arc.bow} of its length; spacing: from a fifth of its peak speed in ${pr.spacing.rise} frames, back in ${pr.spacing.fall}, the largest change in one step ${pr.spacing.jump} of the peak; anticipation: back ${pr.anticipation.back} of the stroke (${pr.anticipation.units} units) before it; lag: the tip's fastest step ${pr.lag.frames} frames after the hand's, the tip travels ${pr.lag.travel} times the hand`,
      );
    // events against the motion
    const inside = m.events.filter((e) => e.motion !== null);
    for (const e of inside)
      if (e.motion === 0 && !m.total.slice(1).every((t) => t === 0)) facts.push(`motion: ${m.name}: the event ${e.event}${e.options ? ` (${e.options})` : ""} on ${frameOf(e.frame)} is on a frame where nothing moves`);
    if (inside.length && steps >= 4 && !inside.some((e) => Math.abs(e.frame - m.peak) <= L.EVENT_NEAR_PEAK))
      facts.push(`motion: ${m.name}: no event within ${L.EVENT_NEAR_PEAK} frames of the fastest step (${frameOf(m.peak)}); its events are on ${inside.map((e) => e.frame).join(", ")}`);
    // the class's bands, as facts
    const rows = [];
    const band = kind ? bands[kind] : null;
    if (band && Object.keys(band.measures).length)
      for (const [key, b] of Object.entries(band.measures)) {
        const value = summary[key];
        if (value === null || value === undefined) continue;
        const place = value < b.least ? "under the 5th in 100" : value > b.most ? "over the 95th in 100" : value < b.q1 ? "in the lowest quarter" : value > b.q3 ? "in the highest quarter" : "inside the middle half";
        rows.push({ key, value, band: b, place });
        facts.push(`motion: ${m.name}: ${SUMMARY_SAID[key] ?? key} ${value}: ${place} of ${band.of} (median ${b.median}, 5th ${b.least}, 95th ${b.most})`);
      }
    else if (kind) facts.push(`motion: ${m.name}: no band for the kind ${kind}${band ? ` (${band.of})` : ""}: the measures are facts alone`);
    if (!m.joints.named) facts.push(`motion: ${m.name}: no named joints (Biped's elbow, knee, wrist, head): the joint-range measures are not made`);
    return { faults, found, facts, rows, summary };
  }
  return { faults, found, facts: [`motion: ${m.name}: one frame, nothing to measure`], rows: [], summary: motionSummary(m) };
}

/** Each fault's key (judgeMotion's `found`): what it is in a few words, and what to do, for `check`'s grouped lines. */
export const MOTION_SAID = {
  pop: ["pops (a bone turns many times its run in one frame and back the next)", "take the frame out or ease it between its neighbours"],
  jitter: ["jitter (a bone turning one way and back every frame)", "smooth the channel or key it less often, unless a tremble is meant"],
  flip: ["a flip (a bone turned 150 degrees or more in one frame)", "turn it the short way, or spread the turn over frames"],
  hyper: ["an elbow or a knee bent past straight the wrong way", "keep its bend on the side it has at rest (reach's bend)"],
  range: ["a wrist or a head turned past its range", "bring the turn into the forearm, or the neck and spine, too"],
  lockstep: ["lockstep (every moving bone speeds up and slows down together)", "stagger the keys so that the joints take turns"],
  stall: ["a stall (frames of no motion between motion before and after)", "let some joint keep turning through it, or take the held frames out"],
  tail: ["a tail still moving (no held pose at the end)", "ease the last frames into a hold, unless another animation follows at once"],
  seam: ["a loop that does not close", "make the last frame a copy of the first"],
  slide: ["foot slide (the planted feet's speed off the travel by half or more)", "set the travel to the feet's own speed, or the feet to the travel"],
  overlap: ["parts through each other", "move the limb clear, or the piece"],
  elbow: ["a forearm whose root no shoulder reaches", "put its root where an upper arm reaches (solveArm, placeForearm)"],
  aim: ["a forearm seen end-on, aimed at the camera", "swing the elbow out and down so that the forearm crosses the view"],
};

// ── the picture ────────────────────────────────────────────────────────────
const INKS = [
  [255, 196, 40],
  [80, 210, 255],
  [255, 110, 200],
  [130, 255, 120],
  [255, 140, 60],
  [190, 150, 255],
];
const GREY = [110, 114, 122];
const FAULT_INK = [255, 60, 60];
const BACK = [30, 32, 38];
const PLOT_HEIGHT = 240;
const MARGIN = 40;

function pixel(img, x, y, c) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  img.rgba.set([c[0], c[1], c[2], 255], (y * img.width + x) * 4);
}
function line(img, x0, y0, x1, y1, c) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    pixel(img, x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/**
 * One picture: the bones' turn per frame over the animation as a timeline (the six that move most in colour and
 * named, the rest grey, every frame of a fault marked in red with the fault's word), and the kit's strip of the
 * animation under it. `judged`: judgeMotion's answer. `opts` go to strip (view, count, cols, body, groups ...).
 */
export function motionPicture(mdl, m, judged, opts = {}) {
  const film = strip(mdl, { seq: m.index, count: Math.min(12, m.frames), ...opts });
  const width = Math.max(film.width, 480);
  const plot = { width, height: PLOT_HEIGHT + MARGIN, rgba: new Uint8Array(width * (PLOT_HEIGHT + MARGIN) * 4) };
  for (let i = 0; i < width * plot.height; i++) plot.rgba.set([...BACK, 255], i * 4);
  const steps = m.frames - 1;
  const x0 = 60;
  const x1 = width - 16;
  const y0 = 12;
  const y1 = PLOT_HEIGHT;
  const xOf = (f) => Math.round(x0 + ((x1 - x0) * f) / Math.max(1, steps));
  const most = Math.max(1e-6, ...m.turns.slice(1).flatMap((row) => row.map((t) => t[0])));
  const yOf = (deg) => Math.round(y1 - ((y1 - y0) * deg) / most);
  line(plot, x0, y1, x1, y1, GREY);
  line(plot, x0, y0, x0, y1, GREY);
  label(plot, `${Math.round(most * 10) / 10} DEG/FRAME`, 2, y0, 1);
  label(plot, "0", x0 - 10, y1 - 5, 1);
  for (let f = 0; f <= steps; f += Math.max(1, Math.round(steps / 10))) label(plot, String(f), xOf(f) - 2, y1 + 4, 1);
  // the faults' frames
  const marked = new Map();
  for (const said of judged.faults) {
    const f = said.match(/frame (\d+)/)?.[1];
    const word = said.match(/: ([a-z -]+?)(?: \(|;|:|$)/g)?.at(-1) ?? "";
    if (f !== undefined) marked.set(Number(f), (said.match(/: (a pop|jitter|a flip|hyperextended|a stall|foot slide|parts through each other|lockstep)/)?.[1] ?? word).replace(/^a /, ""));
  }
  if (judged.faults.some((s) => /lockstep/.test(s))) label(plot, "LOCKSTEP", x1 - 60, y0, 1, FAULT_INK);
  if (judged.faults.some((s) => /ends still moving/.test(s))) marked.set(steps, "tail");
  for (const [f, word] of marked) {
    line(plot, xOf(f), y0, xOf(f), y1, FAULT_INK);
    label(plot, word, Math.min(xOf(f) + 3, width - 60), y0 + 8 + (([...marked.keys()].indexOf(f) % 3) * 9), 1, FAULT_INK);
  }
  // the bones, the still ones grey and the six that move most in colour
  const order = m.bones.map((_, b) => b).sort((a, b) => m.travelled[b] - m.travelled[a]);
  const coloured = order.slice(0, INKS.length).filter((b) => m.travelled[b] > 0);
  for (const b of order.slice().reverse()) {
    const ink = coloured.includes(b) ? INKS[coloured.indexOf(b)] : GREY;
    for (let f = 2; f <= steps; f++) line(plot, xOf(f - 1), yOf(m.turns[f - 1][b][0]), xOf(f), yOf(m.turns[f][b][0]), ink);
  }
  coloured.forEach((b, i) => label(plot, m.bones[b].slice(0, 18), x0 + 4 + i * 96, y1 + 16, 1, INKS[i]));
  label(plot, `${m.name}: ${m.frames} frames at ${m.fps} fps${m.loops ? ", loops" : ""}`, x0 + 60, y0, 1);
  // the strip under the plot
  const out = { width, height: plot.height + film.height, rgba: new Uint8Array(width * (plot.height + film.height) * 4) };
  for (let i = 0; i < out.width * out.height; i++) out.rgba.set([...BACK, 255], i * 4);
  out.rgba.set(plot.rgba, 0);
  for (let y = 0; y < film.height; y++) out.rgba.set(film.rgba.subarray(y * film.width * 4, (y + 1) * film.width * 4), ((plot.height + y) * width) * 4);
  return out;
}
