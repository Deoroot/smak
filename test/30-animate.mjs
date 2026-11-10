// Animations written as poses (make/animate.mjs): a turn said in the model's axes whatever a bone's own are,
// a leg bent to put its foot at a place, a pose mirrored, keys joined into frames, and what was made
// measured: a loop's seam, the speed a walk's planted feet ask for and how much they slide.
//
// The skeletons are made here: a pelvis with two legs and an arm, once with every bone at rest unturned and
// once with the bones' own axes turned as a Biped's are, so that every statement about the model's axes is
// tried on a skeleton where a bone's own axes are something else.
import * as smak from "../src/index.mjs";
import { matricesOf, rigOf, poseOf, worldOf, reach, mirror, animate, between, valuesOf, track, seam, stride } from "../make/animate.mjs"; // prettier-ignore
import { test, sure, near } from "./helper.mjs";

const HIP = 40;
const THIGH = 18;
const CALF = 18;
/** A pelvis, two legs of three bones and a left arm, every bone unturned at rest: its axes are the model's. */
const plain = [
  { name: "pelvis", parent: -1, pos: [0, 0, HIP] },
  { name: "thigh.L", parent: 0, pos: [0, 4, 0] },
  { name: "calf.L", parent: 1, pos: [0, 0, -THIGH] },
  { name: "foot.L", parent: 2, pos: [0, 0, -CALF] },
  { name: "thigh.R", parent: 0, pos: [0, -4, 0] },
  { name: "calf.R", parent: 4, pos: [0, 0, -THIGH] },
  { name: "foot.R", parent: 5, pos: [0, 0, -CALF] },
  { name: "arm.L", parent: 0, pos: [0, 8, 20] },
  { name: "hand.L", parent: 7, pos: [0, 0, -16] },
];
/**
 * The same skeleton with the bones' own axes turned: the pelvis by a quarter about z, and each limb's first
 * bone so that its own x runs down its length, as a Biped's does. The joints are where `plain` has them.
 */
const QUARTER = Math.PI / 2;
const turned = [
  { name: "pelvis", parent: -1, pos: [0, 0, HIP], rot: [0, 0, QUARTER] },
  { name: "thigh.L", parent: 0, pos: [4, 0, 0], rot: [0, QUARTER, 0] },
  { name: "calf.L", parent: 1, pos: [THIGH, 0, 0] },
  { name: "foot.L", parent: 2, pos: [CALF, 0, 0] },
  { name: "thigh.R", parent: 0, pos: [-4, 0, 0], rot: [0, QUARTER, 0] },
  { name: "calf.R", parent: 4, pos: [THIGH, 0, 0] },
  { name: "foot.R", parent: 5, pos: [CALF, 0, 0] },
  { name: "arm.L", parent: 0, pos: [8, 0, 20], rot: [0, QUARTER, 0] },
  { name: "hand.L", parent: 7, pos: [16, 0, 0] },
];
const RIGS = [
  ["bones unturned", rigOf(plain)],
  ["bones turned as a Biped's", rigOf(turned)],
];
const placeOf = (rig, pose, bone) => worldOf(rig, pose)[rig.index(bone)].p;
const nearPlace = (place, expected, tolerance, what) =>
  place.forEach((value, axis) => near(value, expected[axis], tolerance, `${what}, ${"xyz"[axis]}`));
const refuses = (run, pattern) => {
  try {
    run();
  } catch (e) {
    return pattern.test(e.message) ? true : `it said: ${e.message}`;
  }
  return "it did not refuse";
};

test("a skeleton at rest is where its bones say, whatever their own axes", () => {
  for (const [what, rig] of RIGS) {
    nearPlace(placeOf(rig, rig.rest, "foot.L"), [0, 4, HIP - THIGH - CALF], 1e-9, `${what}: the left foot`);
    nearPlace(placeOf(rig, rig.rest, "hand.L"), [0, 8, HIP + 20 - 16], 1e-9, `${what}: the hand`);
    // and the kit's own matrices agree with the pose's numbers
    const hand = track(rig, [valuesOf(rig, rig.rest)], "hand.L")[0];
    nearPlace(hand, [0, 8, HIP + 4], 1e-6, `${what}: the hand by the file's numbers`);
  }
  sure(
    refuses(() => rigOf(plain).index("tail"), /no bone tail: the skeleton has pelvis/),
    "a bone it has not",
  );
  sure(
    refuses(() => rigOf([{ name: "a", parent: 1 }, { name: "b", parent: -1 }]), /comes before its parent/), // prettier-ignore
    "a child listed before its parent",
  );
});

test("a turn is said in the model's axes: forward, to the left, about the upright", () => {
  for (const [what, rig] of RIGS) {
    const shoulder = placeOf(rig, rig.rest, "arm.L");
    const hand = (turn) => {
      const place = placeOf(rig, poseOf(rig, { "arm.L": { turn } }), "hand.L");
      return place.map((value, axis) => value - shoulder[axis]);
    };
    nearPlace(hand({ y: -90 }), [16, 0, 0], 1e-9, `${what}: y -90 swings a hanging arm forward`);
    nearPlace(hand({ y: 90 }), [-16, 0, 0], 1e-9, `${what}: y 90 swings it back`);
    nearPlace(hand({ x: 90 }), [0, 16, 0], 1e-9, `${what}: x 90 swings it out to the left`);
    nearPlace(hand({ z: 90 }), [0, 0, -16], 1e-9, `${what}: about the upright a hanging arm stays`);
    // as an object: x, then y, then z; as a list: in the order written
    nearPlace(hand({ y: -90, z: 90 }), [0, 16, 0], 1e-9, `${what}: forward, then turned to the left`);
    nearPlace(hand([["z", 90], ["y", -90]]), [16, 0, 0], 1e-9, `${what}: a list is applied as written`); // prettier-ignore
    // a child's turn is carried by its parent: the knee bends the same way whatever the thigh does
    const bent = poseOf(rig, { "thigh.L": { turn: { y: -90 } }, "calf.L": { turn: { y: 90 } } });
    const hip = placeOf(rig, bent, "thigh.L");
    nearPlace(
      placeOf(rig, bent, "calf.L"),
      [hip[0] + THIGH, hip[1], hip[2]],
      1e-9,
      `${what}: the knee is forward`,
    );
    nearPlace(
      placeOf(rig, bent, "foot.L"),
      [hip[0] + THIGH, hip[1], hip[2] - CALF],
      1e-9,
      `${what}: the calf hangs`,
    );
    // a move is in the model's axes too, and a pose is made from another
    const sunk = poseOf(rig, { pelvis: { move: [0, 0, -3] } }, bent);
    near(placeOf(rig, sunk, "foot.L")[2], hip[2] - CALF - 3, 1e-9, `${what}: the body sunk by 3`);
    near(
      placeOf(rig, bent, "foot.L")[2],
      hip[2] - CALF,
      1e-9,
      `${what}: and the pose it was made from is as it was`,
    );
  }
  const rig = RIGS[0][1];
  sure(
    refuses(() => poseOf(rig, { pelvis: { turn: { w: 3 } } }), /about x, y or z, not w/),
    "a wrong axis",
  );
  sure(
    refuses(() => poseOf(rig, { pelvis: { twist: 3 } }), /by turn or move, not twist/),
    "a wrong change",
  );
  sure(
    refuses(() => poseOf(rig, { pelvis: { move: [1, 2] } }), /move is \[x, y, z\]/),
    "a wrong move",
  );
});

test("a leg told where its foot is bends its own knee, forward, and says when the place is too far", () => {
  for (const [what, rig] of RIGS) {
    const leg = ["thigh.L", "calf.L", "foot.L"];
    const to = [6, 4, 10];
    const stepped = reach(rig, rig.rest, { bones: leg, to });
    sure(stepped.reached && stepped.short === 0, `${what}: within reach`);
    nearPlace(placeOf(rig, stepped, "foot.L"), to, 1e-6, `${what}: the foot is there`);
    const knee = placeOf(rig, stepped, "calf.L");
    const hip = placeOf(rig, stepped, "thigh.L");
    near(
      Math.hypot(...knee.map((value, axis) => value - hip[axis])),
      THIGH,
      1e-6,
      `${what}: the thigh is as long as it was`,
    );
    // forward of the line from hip to foot, and bent the other way when told
    const lineAt = (z) => hip[0] + ((to[0] - hip[0]) * (hip[2] - z)) / (hip[2] - to[2]);
    sure(knee[0] > lineAt(knee[2]) + 1, `${what}: the knee is forward of the leg's line: ${knee}`);
    const back = placeOf(rig, reach(rig, rig.rest, { bones: leg, to, bend: [-1, 0, 0] }), "calf.L");
    sure(back[0] < lineAt(back[2]) - 1, `${what}: bend [-1, 0, 0] puts it behind: ${back}`);
    // the rest of the pose is used as it is: a pelvis that has sunk brings the hip down with it
    const low = reach(rig, poseOf(rig, { pelvis: { move: [0, 0, -5] } }), { bones: leg, to });
    nearPlace(placeOf(rig, low, "foot.L"), to, 1e-6, `${what}: from a sunk pelvis too`);
    // level: the foot keeps its turn of rest; without it the foot turns with the calf
    const flat = reach(rig, rig.rest, { bones: leg, to: [10, 4, 12], level: true });
    const footTurn = worldOf(rig, flat)[rig.index("foot.L")].q;
    const atRest = worldOf(rig, rig.rest)[rig.index("foot.L")].q;
    near(
      Math.abs(footTurn.reduce((sum, value, i) => sum + value * atRest[i], 0)),
      1,
      1e-9,
      `${what}: a level foot`,
    );
    // too far: straight towards it, and said
    const far = reach(rig, rig.rest, { bones: leg, to: [60, 4, HIP] });
    sure(!far.reached && Math.abs(far.short - (60 - THIGH - CALF)) < 1e-3, `${what}: short by ${far.short}`);
    near(placeOf(rig, far, "foot.L")[0], THIGH + CALF, 1e-3, `${what}: the leg is straight towards it`);
  }
  const rig = RIGS[0][1];
  sure(
    refuses(() => reach(rig, rig.rest, { bones: ["thigh.L", "foot.L", "calf.L"], to: [0, 0, 0] }), /each the next one's parent/),
    "bones that are no chain",
  ); // prettier-ignore
});

test("a pose mirrored: what the left did the right does", () => {
  for (const [what, rig] of RIGS) {
    const pose = poseOf(rig, {
      pelvis: { turn: { x: 10, z: 20 }, move: [1, 2, -3] },
      "thigh.L": { turn: { y: -40, x: 15 } },
      "calf.L": { turn: { y: 30 } },
    });
    const other = mirror(rig, pose);
    for (const [left, right] of [
      ["calf.L", "calf.R"],
      ["foot.L", "foot.R"],
    ]) {
      // prettier-ignore
      const [x, y, z] = placeOf(rig, pose, left);
      nearPlace(placeOf(rig, other, right), [x, -y, z], 1e-9, `${what}: ${right} is ${left} in a mirror`);
    }
    const twice = mirror(rig, other);
    nearPlace(placeOf(rig, twice, "foot.L"), placeOf(rig, pose, "foot.L"), 1e-9, `${what}: mirrored twice`);
  }
  // sides are found in names as they are written; a name with no side is its own
  const named = rigOf([
    { name: "Bip01", parent: -1 },
    { name: "Bip01 L Thigh", parent: 0, pos: [0, 4, 0] },
    { name: "Bip01 R Thigh", parent: 0, pos: [0, -4, 0] },
    { name: "Left_leg", parent: 1, pos: [0, 0, -10] },
    { name: "Right_leg", parent: 2, pos: [0, 0, -10] },
  ]);
  const kicked = mirror(named, poseOf(named, { "Bip01 L Thigh": { turn: { y: -90 } } }));
  nearPlace(placeOf(named, kicked, "Right_leg"), [10, -4, 0], 1e-9, "Biped's names, and Left/Right");
  nearPlace(placeOf(named, kicked, "Left_leg"), [0, 4, -10], 1e-9, "and the left is at rest");
});

test("keys are joined into frames by the shortest turn, eased, and a loop ends where it began", () => {
  const rig = RIGS[1][1];
  const up = poseOf(rig, { "arm.L": { turn: { y: -90 } } });
  const frames = animate(rig, { frames: 21, loops: true, keys: [{ at: 0, pose: rig.rest }, { at: 10, pose: up }] }); // prettier-ignore
  sure(
    frames.length === 21 && frames[0].length === rig.bones.length && frames[0][0].length === 6,
    "its shape",
  );
  const hand = track(rig, frames, "hand.L");
  nearPlace(hand[10], [16, 8, HIP + 20], 1e-6, "the key's pose at the key's frame");
  nearPlace(hand[20], hand[0], 1e-9, "the last frame is the first");
  const closed = seam(rig, frames);
  sure(closed.degrees < 1e-9 && closed.units < 1e-9, `the seam of a loop: ${JSON.stringify(closed)}`);
  // half way the arm is half way round, not half way along a straight line: it is as long as it was
  near(Math.hypot(hand[5][0], hand[5][2] - (HIP + 20)), 16, 1e-6, "the hand goes round the shoulder");
  // smooth: slow out of a key; linear: evenly
  const even = track(rig, animate(rig, { frames: 11, keys: [{ at: 0, pose: rig.rest }, { at: 10, pose: up, ease: "linear" }] }), "hand.L"); // prettier-ignore
  near(Math.atan2(even[1][0], HIP + 20 - even[1][2]) / (Math.PI / 180), 9, 1e-6, "linear: 9 degrees a frame");
  sure(hand[1][0] < even[1][0] / 2, "smooth: slower out of the first key");
  // not a loop: the last key is held to the end, and the seam is what it is
  const once = animate(rig, {
    frames: 16,
    keys: [
      { at: 0, pose: rig.rest },
      { at: 10, pose: up },
    ],
  });
  nearPlace(track(rig, once, "hand.L")[15], [16, 8, HIP + 20], 1e-6, "held after the last key");
  near(seam(rig, once).degrees, 90, 1e-6, "an open animation's seam is told");
  sure(seam(rig, once).bone === "arm.L", "with the bone");
  // each: every frame passed through, with how far along it is
  const parts = [];
  const lifted = animate(rig, {
    frames: 5,
    keys: [{ at: 0, pose: rig.rest }],
    each: (pose, frame, part) => {
      parts.push(part);
      return poseOf(rig, { pelvis: { move: [0, 0, frame] } }, pose);
    },
  });
  sure(parts.join() === "0,0.25,0.5,0.75,1", `each is told how far along: ${parts}`);
  near(track(rig, lifted, "pelvis")[3][2], HIP + 3, 1e-9, "and what it gives is the frame");
  // a whole turn in four keys: no angle leaps from one frame to the next
  const quarter = (n) => poseOf(rig, { pelvis: { turn: { z: 90 * n } } });
  const spun = animate(rig, { frames: 41, keys: [0, 1, 2, 3, 4].map((n) => ({ at: n * 10, pose: quarter(n), ease: "linear" })) }); // prettier-ignore
  let leap = 0;
  for (let frame = 1; frame < spun.length; frame++)
    for (let angle = 3; angle < 6; angle++)
      leap = Math.max(leap, Math.abs(spun[frame][0][angle] - spun[frame - 1][0][angle]));
  sure(leap < 0.2, `the widest step of an angle between two frames: ${leap}`);
  nearPlace(between(rig.rest, up, 1).p[0], up.p[0], 1e-12, "between, at its end");
  sure(
    refuses(() => animate(rig, { frames: 1, keys: [] }), /2 at the least/),
    "one frame",
  );
  sure(
    refuses(() => animate(rig, { frames: 5, keys: [{ at: 2, pose: up }] }), /first key is at frame 0/),
    "no key at 0",
  );
  sure(
    refuses(() => animate(rig, { frames: 5, loops: true, keys: [{ at: 0, pose: up }, { at: 4, pose: up }] }), /leave that key out/), // prettier-ignore
    "a loop given its last frame",
  );
  sure(
    refuses(() => animate(rig, { frames: 5, keys: [{ at: 0, pose: up, ease: "bounce" }] }), /ease is/),
    "a wrong ease",
  );
});

// a walk in place: each foot goes back along the ground for half the cycle and is carried forward, lifted,
// for the other half
const STEP = 12; // how far a planted foot goes back
const FRAMES = 25; // 24 steps: 12 planted, 12 in the air
const FPS = 24;
function walkOf(rig, { slips = 0 } = {}) {
  const footAt = (part, side) => {
    const phase = (part + (side === "L" ? 0 : 0.5)) % 1;
    const y = side === "L" ? 4 : -4;
    if (phase < 0.5) return [STEP / 2 - STEP * (phase / 0.5) * (1 - slips), y, 2];
    const air = (phase - 0.5) / 0.5;
    return [-STEP / 2 + STEP * air, y, 2 + 5 * Math.sin(Math.PI * air)];
  };
  return animate(rig, {
    frames: FRAMES,
    loops: true,
    // sunk by 6, so that a foot half a step out is within the leg's reach
    keys: [{ at: 0, pose: poseOf(rig, { pelvis: { move: [0, 0, -6] } }) }],
    each: (pose, _frame, part) =>
      ["L", "R"].reduce(
        (made, side) => reach(rig, made, { bones: [`thigh.${side}`, `calf.${side}`, `foot.${side}`], to: footAt(part, side), level: true }), // prettier-ignore
        pose,
      ),
  });
}

test("a walk is measured by its feet: the speed they ask for, and how much they slide", () => {
  for (const [what, rig] of RIGS) {
    const walk = walkOf(rig);
    const measured = stride(rig, walk, { feet: ["foot.L", "foot.R"], fps: FPS });
    // 12 units in 12 frames at 24 a second
    near(measured.speed, 24, 1e-3, `${what}: the speed the ground must pass at`);
    sure(measured.slide < 1e-3, `${what}: planted feet do not slide: ${measured.slide}`);
    near(measured.low, 2, 1e-6, `${what}: the lowest a foot goes`);
    sure(
      measured.feet.length === 2 && measured.feet[0].planted.length >= 12,
      `${what}: each foot's planted frames`,
    );
    sure(seam(rig, walk).degrees < 1e-6, `${what}: the walk closes`);
    // a foot that goes back only three quarters of its step and is then snatched to where the next begins:
    // the snatch is a slide, and is told
    const slipping = stride(rig, walkOf(rig, { slips: 0.25 }), { feet: ["foot.L", "foot.R"], fps: FPS });
    sure(slipping.slide > 30, `${what}: a foot snatched along the ground slides: ${slipping.slide}`);
  }
  const rig = RIGS[0][1];
  sure(
    refuses(() => stride(rig, walkOf(rig), { feet: [], fps: 24 }), /feet is a list/),
    "no feet",
  );
  sure(
    refuses(() => stride(rig, walkOf(rig), { feet: ["foot.L"] }), /fps is the animation's rate/),
    "no fps",
  );
  // one foot faster than the other: the speed is their mean and the slide is told
  const lame = walkOf(rig).map((values, frame, all) => values.map((six, bone) => (rig.names[bone] === "thigh.R" ? all[0][bone] : six))); // prettier-ignore
  sure(stride(rig, lame, { feet: ["foot.L", "foot.R"], fps: FPS }).slide > 5, "a foot that stays put slides");
});

test("frames made here are an animation in a model: written, read back, and where the poses put them", () => {
  for (const [what, rig] of RIGS) {
    const walk = walkOf(rig);
    const mdl = smak.writeMdl({
      name: "walker.mdl",
      bones: rig.bones,
      sequences: [{ name: "walk", fps: FPS, loops: true, frames: walk }],
      textures: [],
      bodyparts: [{ name: "body", models: [{ name: "none", verts: [], vertBones: [], meshes: [] }] }],
    });
    const read = smak.readSequence(mdl, "walk");
    // a pose drawn without being an animation: the matrices the drawing takes
    const bent = poseOf(rig, { "thigh.L": { turn: { y: -90 } } });
    const knee = matricesOf(rig, bent)[rig.index("calf.L")].map((row) => row[3]);
    sure(
      Math.abs(knee[0] - THIGH) < 1e-6 && Math.abs(knee[2] - HIP) < 1e-6,
      `${what}: matricesOf puts the knee forward: ${knee}`,
    );
    sure(read.frames.length === FRAMES, `${what}: ${read.frames.length} frames`);
    const written = track(rig, walk, "foot.L");
    const back = track(rigOf(mdl), read.frames, "foot.L");
    let gap = 0;
    written.forEach((place, frame) => place.forEach((value, axis) => (gap = Math.max(gap, Math.abs(value - back[frame][axis]))))); // prettier-ignore
    sure(gap < 0.05, `${what}: the foot read back is where it was put, within ${gap}`);
  }
});
