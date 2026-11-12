// A small biped made from nothing for the motion judge (check/motion.mjs): Biped's names on its bones so that the
// named joints are found, a closed box on each bone so that parts through each other can be measured, a walk that
// travels (the legs put by `reach`, the arms swinging against them) and a swing of the right arm that ends in a
// hold, the joints keyed at different frames so that nothing moves in lockstep. `biped()` is the clean model;
// `spoiled(way)` the same with ONE of its two animations broken in one named way, as test/broken/motion.mjs lists them.
import * as smak from "../src/index.mjs";
import { rigOf, poseOf, reach, animate, valuesOf, between, worldOf, qmul, qconj, qabout } from "../make/animate.mjs";

const S = smak.solids;
const HIP = 36;
const THIGH = 17;
const CALF = 17;
const UPPER = 12;
const FORE = 11;
const RAD = Math.PI / 180;
/** The bones, unturned at rest but for the elbows (bent 20 forward) and the knees (bent 14 back): the hinges' sides. */
export const BONES = [
  { name: "Bip01", parent: -1, pos: [0, 0, HIP] },
  { name: "Bip01 Pelvis", parent: 0, pos: [0, 0, 0] },
  { name: "Bip01 Spine", parent: 1, pos: [0, 0, 4] },
  { name: "Bip01 Spine1", parent: 2, pos: [0, 0, 8] },
  { name: "Bip01 Neck", parent: 3, pos: [0, 0, 8] },
  { name: "Bip01 Head", parent: 4, pos: [0, 0, 3] },
  { name: "Bip01 L Clavicle", parent: 3, pos: [0, 3, 6] },
  { name: "Bip01 L UpperArm", parent: 6, pos: [0, 5, 0] },
  { name: "Bip01 L Forearm", parent: 7, pos: [0, 0, -UPPER], rot: [0, -20 * RAD, 0] },
  { name: "Bip01 L Hand", parent: 8, pos: [0, 0, -FORE] },
  { name: "Bip01 R Clavicle", parent: 3, pos: [0, -3, 6] },
  { name: "Bip01 R UpperArm", parent: 10, pos: [0, -5, 0] },
  { name: "Bip01 R Forearm", parent: 11, pos: [0, 0, -UPPER], rot: [0, -20 * RAD, 0] },
  { name: "Bip01 R Hand", parent: 12, pos: [0, 0, -FORE] },
  { name: "Bip01 L Thigh", parent: 1, pos: [0, 4, 0] },
  { name: "Bip01 L Calf", parent: 14, pos: [0, 0, -THIGH], rot: [0, 14 * RAD, 0] },
  { name: "Bip01 L Foot", parent: 15, pos: [0, 0, -CALF] },
  { name: "Bip01 R Thigh", parent: 1, pos: [0, -4, 0] },
  { name: "Bip01 R Calf", parent: 17, pos: [0, 0, -THIGH], rot: [0, 14 * RAD, 0] },
  { name: "Bip01 R Foot", parent: 18, pos: [0, 0, -CALF] },
];
const rig = rigOf(BONES);
const plain = smak.indexed({ width: 8, height: 8, rgb: new Uint8Array(8 * 8 * 3).fill(140) }, "plain.bmp");

/** A closed box about a bone, in the model's space at rest, its corners on that bone. */
function boxOn(bone, size, offset = [0, 0, 0]) {
  const at = worldOf(rig, rig.rest)[rig.index(bone)].p;
  const centre = [at[0] + offset[0], at[1] + offset[1], at[2] + offset[2]];
  const tris = S.trisOf(S.box(S.place(centre, [0, 0, 1], [1, 0, 0]), size[0], size[1], size[2]));
  return tris.map((t) => t.map((c) => ({ p: c.p, uv: [0, 0], bone })));
}
const MESH = [
  ...boxOn("Bip01 Pelvis", [6, 8, 6], [0, 0, 1]),
  ...boxOn("Bip01 Spine", [6, 8, 7], [0, 0, 4]),
  ...boxOn("Bip01 Spine1", [6, 9, 7], [0, 0, 4]),
  ...boxOn("Bip01 Head", [6, 6, 7], [0, 0, 4]),
  ...boxOn("Bip01 L UpperArm", [2.5, 2.5, UPPER - 1], [0, 0, -UPPER / 2]),
  ...boxOn("Bip01 L Forearm", [2.2, 2.2, FORE - 1], [0, 0, -FORE / 2]),
  ...boxOn("Bip01 L Hand", [2, 2, 3], [0, 0, -1.5]),
  ...boxOn("Bip01 R UpperArm", [2.5, 2.5, UPPER - 1], [0, 0, -UPPER / 2]),
  ...boxOn("Bip01 R Forearm", [2.2, 2.2, FORE - 1], [0, 0, -FORE / 2]),
  ...boxOn("Bip01 R Hand", [2, 2, 3], [0, 0, -1.5]),
  ...boxOn("Bip01 L Thigh", [3, 3, THIGH - 1], [0, 0, -THIGH / 2]),
  ...boxOn("Bip01 L Calf", [2.5, 2.5, CALF - 1], [0, 0, -CALF / 2]),
  ...boxOn("Bip01 L Foot", [6, 3, 2], [2, 0, 1]),
  ...boxOn("Bip01 R Thigh", [3, 3, THIGH - 1], [0, 0, -THIGH / 2]),
  ...boxOn("Bip01 R Calf", [2.5, 2.5, CALF - 1], [0, 0, -CALF / 2]),
  ...boxOn("Bip01 R Foot", [6, 3, 2], [2, 0, 1]),
];

// ── the walk: 17 frames at 20 fps, looping; the feet planted go back at one speed, the travel is that speed ──
const WALK_FRAMES = 17;
const WALK_FPS = 20;
const STRIDE = 9; // each foot goes from +STRIDE to -STRIDE while planted
const LIFT = 4;
const FOOT_Z = HIP - THIGH - CALF; // where a foot is at rest (the knee's bend is taken up by reach)
const footAt = (phase) => {
  const t = ((phase % 1) + 1) % 1;
  if (t < 0.5) {
    const u = t / 0.5; // swinging forward, lifted
    return [-STRIDE + 2 * STRIDE * u, LIFT * Math.sin(Math.PI * u)];
  }
  const u = (t - 0.5) / 0.5; // planted, going back at one speed
  return [STRIDE - 2 * STRIDE * u, 0];
};
const WALK_SPEED = (2 * STRIDE) / (0.5 * (WALK_FRAMES - 1) / WALK_FPS); // units a second while planted
function walkPose(part) {
  const [lx, lz] = footAt(part);
  const [rx, rz] = footAt(part + 0.5);
  // the arms swing against the legs, the spine and head lean a little, each on its own phase
  let pose = poseOf(rig, {
    "Bip01 L UpperArm": { turn: { y: 25 * Math.cos(2 * Math.PI * part) } },
    "Bip01 R UpperArm": { turn: { y: -25 * Math.cos(2 * Math.PI * part) } },
    "Bip01 L Forearm": { turn: { y: -12 - 10 * Math.sin(2 * Math.PI * part) } },
    "Bip01 R Forearm": { turn: { y: -12 + 10 * Math.sin(2 * Math.PI * part) } },
    "Bip01 Spine": { turn: { z: 4 * Math.sin(2 * Math.PI * part) } },
    "Bip01 Head": { turn: { z: -4 * Math.sin(2 * Math.PI * part + 0.6) } },
    Bip01: { move: [0, 0, -1.2 - 0.8 * Math.cos(4 * Math.PI * part)] },
  });
  pose = reach(rig, pose, { bones: ["Bip01 L Thigh", "Bip01 L Calf", "Bip01 L Foot"], to: [lx, 4, FOOT_Z + lz], bend: [1, 0, 0], level: true });
  pose = reach(rig, pose, { bones: ["Bip01 R Thigh", "Bip01 R Calf", "Bip01 R Foot"], to: [rx, -4, FOOT_Z + rz], bend: [1, 0, 0], level: true });
  return pose;
}
const walkFrames = () => {
  const frames = Array.from({ length: WALK_FRAMES }, (_, f) => valuesOf(rig, walkPose(f / (WALK_FRAMES - 1))));
  frames[WALK_FRAMES - 1] = frames[0].map((six) => [...six]);
  return frames;
};
const WALK_TRAVEL = WALK_SPEED * ((WALK_FRAMES - 1) / WALK_FPS);

// ── the swing: 31 frames at 30 fps, the right arm up (shoulder first), the elbow next, the wrist last, down to a hold ──
const SWING_FRAMES = 31;
const SWING_FPS = 30;
const rest = rig.rest;
const up = poseOf(rig, { "Bip01 R UpperArm": { turn: { y: -95 } }, "Bip01 Spine": { turn: { z: -8 } } });
const bent = poseOf(rig, { "Bip01 R Forearm": { turn: { y: -60 } } }, up);
const flicked = poseOf(rig, { "Bip01 R Hand": { turn: { y: -40 } } }, bent);
const hold = poseOf(rig, { "Bip01 R UpperArm": { turn: { y: -30 } }, "Bip01 R Forearm": { turn: { y: -25 } }, "Bip01 Spine": { turn: { z: -3 } } });
const swingFrames = () =>
  animate(rig, {
    frames: SWING_FRAMES,
    keys: [
      { at: 0, pose: rest },
      { at: 9, pose: up, ease: "smooth" },
      { at: 15, pose: bent, ease: "in" },
      { at: 19, pose: flicked, ease: "out" },
      { at: 27, pose: hold, ease: "smooth" },
    ],
  });

/** The clean biped: { mdl, walk, swing, rig }, its animations 0 "walk" and 1 "swing". */
export function biped({ walk = walkFrames(), swing = swingFrames(), travel = WALK_TRAVEL, events, loops = true, fps = WALK_FPS } = {}) {
  const mdl = smak.buildMdl({
    name: "biped.mdl",
    bones: BONES,
    bodyparts: [{ name: "body", models: [{ name: "body", meshes: [{ tris: MESH, texture: plain }] }] }],
    sequences: [
      { name: "walk", fps, loops, frames: walk, movement: [travel, 0, 0] },
      { name: "swing", fps: SWING_FPS, loops: false, frames: swing, events },
    ],
  });
  return { mdl, walk, swing, rig };
}

// ── short contacts: 41 frames at 40 fps, each foot down for a 16th of the cycle, a flight between ──
const RUN_FRAMES = 41;
const RUN_FPS = 40;
const CONTACT = 1 / 16;
const RUN_SPEED = (2 * STRIDE) / ((CONTACT * (RUN_FRAMES - 1)) / RUN_FPS);
const runFoot = (phase) => {
  const t = ((phase % 1) + 1) % 1;
  if (t < CONTACT) return [STRIDE - (2 * STRIDE * t) / CONTACT, 0]; // planted, going back at one speed
  const u = (t - CONTACT) / (1 - CONTACT); // in the air, forward
  return [-STRIDE + 2 * STRIDE * u, 18 * Math.sin(Math.PI * u)];
};
/**
 * The biped's "walk" made a run (the feet down by turns, as The Specialists' run2), a hop (the feet down together, a
 * loop) or a dive (the run once through, no loop); `travel` is the planted feet's speed over the cycle unless given.
 */
export function gait(way, { travel } = {}) {
  const pose = (part) => {
    const [lx, lz] = runFoot(part);
    const [rx, rz] = runFoot(way === "hop" ? part : part + 0.5);
    let p = poseOf(rig, { Bip01: { move: [0, 0, -2] }, "Bip01 L UpperArm": { turn: { y: 30 * Math.cos(2 * Math.PI * part) } } });
    p = reach(rig, p, { bones: ["Bip01 L Thigh", "Bip01 L Calf", "Bip01 L Foot"], to: [lx, 4, FOOT_Z + lz], bend: [1, 0, 0], level: true });
    return reach(rig, p, { bones: ["Bip01 R Thigh", "Bip01 R Calf", "Bip01 R Foot"], to: [rx, -4, FOOT_Z + rz], bend: [1, 0, 0], level: true });
  };
  const frames = Array.from({ length: RUN_FRAMES }, (_, f) => valuesOf(rig, pose(f / (RUN_FRAMES - 1))));
  frames[RUN_FRAMES - 1] = frames[0].map((six) => [...six]);
  return biped({ walk: frames, fps: RUN_FPS, loops: way !== "dive", travel: travel ?? (RUN_SPEED * (RUN_FRAMES - 1)) / RUN_FPS });
}
export const RUN = { frames: RUN_FRAMES, fps: RUN_FPS, speed: RUN_SPEED };

/** A frame's copy with one bone turned about the model's axis by degrees (on top of what it has). */
function turned(frame, bone, axis, degrees) {
  const copy = frame.map((six) => [...six]);
  const i = rig.index(bone);
  const pose = { q: copy.map((six) => smak.animate.qofAngles(six.slice(3))), p: copy.map((six) => six.slice(0, 3)) };
  const inBone = qmul(qconj(rig.world[i]), qmul(qabout(axis, degrees * RAD), rig.world[i]));
  pose.q[i] = qmul(pose.q[i], inBone);
  return valuesOf(rig, pose);
}
const X = [1, 0, 0];
const Y = [0, 1, 0];
const Z = [0, 0, 1];

/**
 * The biped with one animation broken in one way:
 *   pop        the swing's spine turned 30 degrees for frame 15 alone
 *   jitter     the swing's right forearm turned 2.5 degrees one way and the other every frame from 4 to 26
 *   flip       the swing's right hand turned 170 degrees from frame 15 on
 *   hyper      the swing's right elbow bent 60 degrees the wrong way over frames 10 to 20
 *   stall      the swing's frames 12 to 16 made copies of frame 12
 *   lockstep   the swing re-made with every bone keyed at frames 0, 12 and 24 with the same ease
 *   seam       the walk's last frame made a copy of its frame 8
 *   slide      the walk's travel made three times the feet's speed
 *   tail       the swing cut off at frame 13, as the arm is fastest
 *   overlap    the left arm, which hangs through the swing, turned so that its hand is in the left thigh over frames 10 to 24
 *   wrist      the swing's right hand turned 140 degrees about the forearm, 14 a frame
 *   head       the head turned 100 degrees about the upright over the swing
 */
export function spoiled(way) {
  const walk = walkFrames();
  const swing = swingFrames();
  const each = (frames, from, to, change) => frames.map((frame, f) => (f >= from && f <= to ? change(frame, f) : frame));
  switch (way) {
    case "pop":
      return biped({ swing: each(swing, 15, 15, (frame) => turned(frame, "Bip01 Spine", X, 30)) });
    case "jitter":
      return biped({ swing: each(swing, 4, 26, (frame, f) => turned(frame, "Bip01 R Forearm", X, f % 2 ? 2.5 : -2.5)) });
    case "flip":
      return biped({ swing: each(swing, 15, SWING_FRAMES - 1, (frame) => turned(frame, "Bip01 R Hand", Z, 170)) });
    case "hyper":
      return biped({ swing: each(swing, 10, 20, (frame, f) => turned(frame, "Bip01 R Forearm", Y, 60 * Math.sin((Math.PI * (f - 10)) / 10) + 40)) });
    case "stall":
      return biped({ swing: each(swing, 13, 16, () => swing[12].map((six) => [...six])) });
    case "lockstep":
      return biped({ swing: animate(rig, { frames: SWING_FRAMES, keys: [{ at: 0, pose: rest }, { at: 12, pose: flicked }, { at: 24, pose: hold }] }) });
    case "seam":
      return biped({ walk: each(walk, WALK_FRAMES - 1, WALK_FRAMES - 1, () => walk[8].map((six) => [...six])) });
    case "slide":
      return biped({ travel: WALK_TRAVEL * 3 });
    case "tail":
      return biped({ swing: swing.slice(0, 14) });
    case "overlap":
      return biped({ swing: each(swing, 10, 24, (frame) => turned(turned(frame, "Bip01 L UpperArm", X, -10), "Bip01 L UpperArm", Y, 9.5)) });
    case "wrist":
      return biped({ swing: each(swing, 5, SWING_FRAMES - 1, (frame, f) => turned(frame, "Bip01 R Hand", Z, Math.min(140, 14 * (f - 4)))) });
    case "head":
      return biped({ swing: each(swing, 5, SWING_FRAMES - 1, (frame, f) => turned(frame, "Bip01 Head", Z, Math.min(100, 8 * (f - 4)))) });
    default:
      throw new Error(`spoiled: no way ${way}`);
  }
}
export const SWING = { frames: SWING_FRAMES, fps: SWING_FPS };
export const WALK = { frames: WALK_FRAMES, fps: WALK_FPS, speed: WALK_SPEED, travel: WALK_TRAVEL };
export { between };
