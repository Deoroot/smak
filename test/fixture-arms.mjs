// A small first-person view model made from nothing for the body measures (check/motion.mjs, make/arm.mjs): two
// forearms and two hands under one root, named as a rig whose names say nothing (Bone23 the right forearm, Bone24 its
// hand, Bone01 and Bone02 the left), no upper arm, a closed box on each bone; an idle held still and a swing of the
// right hand along an arc to a hold, each elbow put by solveArm from Half-Life's shoulders and each forearm by
// placeForearm. `viewArms()` is the clean model; `viewArms(way)` the same with its swing spoiled ONE way:
//   "elbow"    the right forearm pushed 6 units out from its shoulder in the middle of the swing (no arm reaches it)
//   "aim"      the right forearm turned onto the eye's line in the middle of the swing (seen end-on)
//   "through"  the left hand driven into the right forearm in the middle of the swing
import * as smak from "../src/index.mjs";

const S = smak.solids;
const FORE = 11.37;
const UPPER = 11.37;
export const ARMS = ["Bone23:Bone24", "Bone01:Bone02"];
const SHOULDER = { R: [-3.47, -6.72, -4.55], L: [-3.47, 6.72, -4.55] };
const BONES = [
  { name: "Bone45", parent: -1, pos: [0, 0, 0] },
  { name: "Bone23", parent: 0, pos: [0, -8, -10] },
  { name: "Bone24", parent: 1, pos: [FORE, 0, 0] },
  { name: "Bone01", parent: 0, pos: [0, 8, -10] },
  { name: "Bone02", parent: 3, pos: [FORE, 0, 0] },
];
const ARM = { R: { fore: 1, hand: 2 }, L: { fore: 3, hand: 4 } };
const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const mul = (a, k) => a.map((v) => v * k);
const unit = (a) => mul(a, 1 / Math.hypot(...a));
const lerp = (a, b, t) => add(a, mul(sub(b, a), t));
const at = (p) => [[1, 0, 0, p[0]], [0, 1, 0, p[1]], [0, 0, 1, p[2]]];
const pole = (side) => [0, side === "R" ? -0.5 : 0.5, -1];

/** One frame: each hand at its place (held level), each elbow where solveArm puts it unless told. */
function frameOf(hands, elbows = {}) {
  let values = BONES.map((b) => [...b.pos, 0, 0, 0]);
  for (const side of ["R", "L"]) {
    const { elbow } = smak.solveArm({ shoulder: SHOULDER[side], upper: UPPER, fore: FORE, hand: hands[side], pole: pole(side) });
    const put = elbows[side]?.(elbow, hands[side]) ?? { elbow, hand: hands[side] };
    values = smak.placeForearm(BONES, values, { ...ARM[side], elbow: put.elbow, target: at(put.hand) });
  }
  return values;
}

const IDLE = { R: [11, -7, -8], L: [10, 7, -9] };
const FRAMES = 21;
/** The swing's share of the way at frame f: eased over frames 0 to 14, then held. */
const eased = (f) => {
  const s = Math.min(1, f / 14);
  return s * s * (3 - 2 * s);
};
/** How much of a spoil is in frame f: none at the ends, all of it at frame `from` + 5. */
const spoilAt = (f, from = 2) => (f >= from && f <= from + 10 ? Math.sin((Math.PI * (f - from)) / 10) ** 2 : 0);
const handR = (f) => add(lerp(IDLE.R, [13, 1, -9], eased(f)), [0, 0, 2 * Math.sin(Math.PI * eased(f))]);

/** The aimed arm: the elbow on its shoulder's sphere along the eye's line `d`, the hand a forearm on along it. */
function aimed(d) {
  const b = d[0] * SHOULDER.R[0] + d[1] * SHOULDER.R[1] + d[2] * SHOULDER.R[2];
  const t = b + Math.sqrt(b * b - (Math.hypot(...SHOULDER.R) ** 2 - UPPER * UPPER));
  return { elbow: mul(d, t), hand: mul(d, t + FORE) };
}

const SPOILS = {
  elbow: (w) => ({ R: (elbow, hand) => ({ elbow: add(elbow, mul(unit(sub(elbow, SHOULDER.R)), 6 * w)), hand: add(hand, mul(unit(sub(elbow, SHOULDER.R)), 6 * w)) }) }),
  aim: (w) => ({
    R: (elbow, hand) => {
      const to = aimed(unit([1, -0.55, -0.45]));
      const e = add(SHOULDER.R, mul(unit(lerp(sub(elbow, SHOULDER.R), sub(to.elbow, SHOULDER.R), w)), UPPER));
      return { elbow: e, hand: add(e, mul(unit(lerp(unit(sub(hand, elbow)), unit(to.elbow), w)), FORE)) };
    },
  }),
};

/** The clean model, or its swing spoiled one way ("elbow", "aim", "through"): { mdl }. */
export function viewArms(way) {
  const swing = Array.from({ length: FRAMES }, (_, f) => {
    const w = way ? spoilAt(f) : 0;
    // the left hand late (after the right's swing, so that the two do not move as one) into the right forearm's middle
    const { elbow } = smak.solveArm({ shoulder: SHOULDER.R, upper: UPPER, fore: FORE, hand: handR(f), pole: pole("R") });
    const mid = lerp(elbow, handR(f), 0.5);
    const into = sub(mid, mul(unit(sub(mid, SHOULDER.L)), 1.5)); // the hand's box (1.5 ahead of its wrist) on the forearm's axis
    const hands = { R: handR(f), L: way === "through" ? lerp(IDLE.L, into, spoilAt(f, 9)) : IDLE.L };
    return frameOf(hands, SPOILS[way]?.(w));
  });
  const idle = Array.from({ length: 6 }, () => frameOf(IDLE));
  const restOf = idle[0];
  const bones = BONES.map((b, i) => ({ ...b, pos: restOf[i].slice(0, 3), rot: restOf[i].slice(3) }));
  const rest = smak.boneMatrices(bones);
  // a box in the bone's own space, written as the model stands at rest
  const boxOn = (bone, size, centre) =>
    S.trisOf(S.box(S.place(centre, [0, 0, 1], [1, 0, 0]), ...size)).map((t) => t.map((c) => ({ p: smak.apply34(rest[bone], c.p), uv: [0, 0], bone })));
  const tris = [1, 3].flatMap((fore) => [...boxOn(fore, [FORE - 1, 3.4, 3.4], [FORE / 2, 0, 0]), ...boxOn(fore + 1, [3, 2.6, 2.6], [1.5, 0, 0])]);
  const plain = smak.indexed({ width: 8, height: 8, rgb: new Uint8Array(8 * 8 * 3).fill(150) }, "plain.bmp");
  const mdl = smak.buildMdl({
    name: "v_arms.mdl",
    bones,
    bodyparts: [{ name: "arms", models: [{ name: "arms", meshes: [{ tris, texture: plain }] }] }],
    sequences: [
      { name: "idle", fps: 15, loops: false, frames: idle },
      { name: "swing", fps: 30, loops: false, frames: swing },
    ],
  });
  return { mdl };
}
