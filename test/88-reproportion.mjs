// A skeleton's proportions changed (make/reproportion.mjs): bones made longer and shorter with every turn of every
// frame kept, the feet left on the ground, a walk's planted foot not sliding, rigid pieces not stretched, and
// factors of 1 giving the file back as it was. An animation kept in a file of its own (<name>01.mdl) is carried
// too, its file untouched.
//
// The model is made here: a small Biped (Bip01, its pelvis, two legs of thigh, calf and foot, a spine, a neck, a
// head, two clavicles and arms), the bones' own axes turned as a Biped's are, a block on every bone. Its idle
// stands with the pelvis bobbing, its walk plants each foot for half the cycle, its crouch sinks the pelvis 12;
// in all three the feet are put by `reach`, so they are where they are by arithmetic.
import * as smak from "../src/index.mjs";
import { rigOf, poseOf, reach, animate } from "../make/animate.mjs";
import { test, sure, near, tmp, runSmak } from "./helper.mjs";
import { join } from "node:path";
import { writeFileSync, readFileSync } from "node:fs";

const Q = Math.PI / 2;
const HIP = 40;
const THIGH = 18;
const CALF = 18;
const SOLE = 2; // the foot bone stands this far over the floor when a foot is flat on it
const BONES = [
  { name: "Bip01", parent: -1, pos: [0, 0, HIP], rot: [0, 0, Q] },
  { name: "Bip01 Pelvis", parent: 0 },
  { name: "Bip01 L Thigh", parent: 1, pos: [4, 0, 0], rot: [0, Q, 0] },
  { name: "Bip01 L Calf", parent: 2, pos: [THIGH, 0, 0] },
  { name: "Bip01 L Foot", parent: 3, pos: [CALF, 0, 0] },
  { name: "Bip01 R Thigh", parent: 1, pos: [-4, 0, 0], rot: [0, Q, 0] },
  { name: "Bip01 R Calf", parent: 5, pos: [THIGH, 0, 0] },
  { name: "Bip01 R Foot", parent: 6, pos: [CALF, 0, 0] },
  { name: "Bip01 Spine", parent: 1, pos: [0, 0, 4] },
  { name: "Bip01 Neck", parent: 8, pos: [0, 0, 16] },
  { name: "Bip01 Head", parent: 9, pos: [0, 0, 3] },
  { name: "Bip01 L Clavicle", parent: 9 },
  { name: "Bip01 L UpperArm", parent: 11, pos: [7, 0, 0] },
  { name: "Bip01 L Forearm", parent: 12, pos: [0, 0, -12] },
  { name: "Bip01 R Clavicle", parent: 9 },
  { name: "Bip01 R UpperArm", parent: 14, pos: [-7, 0, 0] },
  { name: "Bip01 R Forearm", parent: 15, pos: [0, 0, -12] },
];
const REST_FOOT = HIP - THIGH - CALF; // 4: the foot bone's height at rest

/** A block from `lo` to `hi` in the model at rest, every corner on `bone`. */
const block = (lo, hi, bone) => {
  const corner = (x, y, z) => ({
    p: [x ? hi[0] : lo[0], y ? hi[1] : lo[1], z ? hi[2] : lo[2]],
    uv: [x, z],
    bone,
  });
  const sides = [
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
    [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  ]; // prettier-ignore
  return sides.flatMap(([a, b, c, d]) => [
    [corner(...a), corner(...b), corner(...c)],
    [corner(...a), corner(...c), corner(...d)],
  ]);
};
const SHAPE = [
  ...["L", "R"].flatMap((side) => {
    const y = side === "L" ? 4 : -4;
    return [
      ...block([-2, y - 1.5, REST_FOOT - SOLE], [6, y + 1.5, REST_FOOT + 2], `Bip01 ${side} Foot`),
      ...block([-1.5, y - 1.5, REST_FOOT + 3], [1.5, y + 1.5, REST_FOOT + CALF - 1], `Bip01 ${side} Calf`),
      ...block([-2, y - 2, HIP - THIGH + 1], [2, y + 2, HIP - 2], `Bip01 ${side} Thigh`),
      ...block([-1, y * 2.5 - 1, HIP + 8], [1, y * 2.5 + 1, HIP + 18], `Bip01 ${side} UpperArm`),
    ];
  }),
  ...block([-3, -5, HIP - 2], [3, 5, HIP + 3], "Bip01 Pelvis"),
  ...block([-3, -5, HIP + 4], [3, 5, HIP + 19], "Bip01 Spine"),
  ...block([-3, -3, HIP + 23], [3, 3, HIP + 29], "Bip01 Head"),
];
const GREY = smak.indexed({ width: 16, height: 16, rgb: new Uint8Array(16 * 16 * 3).fill(140) }, "grey.bmp");

const rig = rigOf(BONES);
const FPS = 24;
const legs = (pose, footAt) =>
  ["L", "R"].reduce(
    (made, side) => reach(rig, made, { bones: [`Bip01 ${side} Thigh`, `Bip01 ${side} Calf`, `Bip01 ${side} Foot`], to: footAt(side), level: true }), // prettier-ignore
    pose,
  );
const standing = (side) => [0, side === "L" ? 4 : -4, SOLE];
const sunk = (by) => poseOf(rig, { Bip01: { move: [0, 0, -by] } });
// the idle: the pelvis 6 down, bobbing a unit up and down, the feet flat where they stand
const IDLE = animate(rig, {
  frames: 21,
  loops: true,
  keys: [{ at: 0, pose: sunk(6) }],
  each: (_, frame) => legs(sunk(6 - Math.sin((frame / 20) * 2 * Math.PI)), standing),
});
// the walk: each foot goes back 12 along the ground for half the cycle and is carried forward for the other half
const STEP = 12;
const WALK = animate(rig, {
  frames: 25,
  loops: true,
  keys: [{ at: 0, pose: sunk(6) }],
  each: (pose, _frame, part) =>
    legs(pose, (side) => {
      const phase = (part + (side === "L" ? 0 : 0.5)) % 1;
      const y = side === "L" ? 4 : -4;
      if (phase < 0.5) return [STEP / 2 - STEP * (phase / 0.5), y, SOLE];
      const air = (phase - 0.5) / 0.5;
      return [-STEP / 2 + STEP * air, y, SOLE + 5 * Math.sin(Math.PI * air)];
    }),
});
const WALK_TRAVEL = 2 * STEP; // a foot goes back 12 in 12 frames: 24 in the cycle's 24
// the crouch: the pelvis sunk from 6 to 18, the feet flat where they stand
const CROUCH = animate(rig, {
  frames: 11,
  keys: [{ at: 0, pose: sunk(6) }],
  each: (_, frame) => legs(sunk(6 + (12 * frame) / 10), standing),
});

const SRC = smak.buildMdl({
  name: "biped.mdl",
  bones: BONES,
  bodyparts: [{ name: "body", models: [{ name: "blocks", meshes: [{ tris: SHAPE, texture: GREY }] }] }],
  sequences: [
    { name: "idle", fps: FPS, loops: true, frames: IDLE, activity: 1 },
    { name: "walk", fps: FPS, loops: true, frames: WALK, activity: 3, movement: [WALK_TRAVEL, 0, 0] },
    { name: "crouch", fps: FPS, frames: CROUCH, activity: 17 },
  ],
  hitboxes: "auto",
  attachments: [{ name: "knee", bone: "Bip01 L Thigh", pos: [THIGH, 0, 0] }],
  eyes: [3, 0, HIP + 26],
});
// longer legs, narrower shoulders, a longer neck (the spine's length, along its own z)
const LEG = 1.2;
const FACTORS = {
  "Bip01 L Thigh": LEG,
  "Bip01 L Calf": LEG,
  "Bip01 L Clavicle": 0.8,
  "Bip01 Spine": [1, 1, 1.1],
};
const MADE = smak.reproportion(SRC, FACTORS);
const OUT = MADE.mdl;

const names = smak.bones(SRC).map((bone) => bone.name);
const numberOf = (name) => names.indexOf(name);
/** The lowest point of the model (z) in each frame of an animation. */
const lowsOf = (mdl, seq) => {
  const frames = smak.sequences(mdl)[smak.sequenceAt(mdl, seq)].frames;
  return Array.from({ length: frames }, (_, frame) =>
    Math.min(...smak.posed(mdl, { seq, frame }).tris.flatMap((t) => t.c.map((c) => c.p[2]))),
  );
};

test("reproportion: a bone's factor is its length, the place of the bones hanging from it; the turns are untouched", () => {
  const before = smak.bones(SRC);
  const after = smak.bones(OUT);
  const times = (name, f) => before[numberOf(name)].pos.map((v, a) => v * (Array.isArray(f) ? f[a] : f));
  const expect = {
    "Bip01 L Calf": times("Bip01 L Calf", LEG), // the thigh's length
    "Bip01 L Foot": times("Bip01 L Foot", LEG), // the calf's
    "Bip01 R Calf": times("Bip01 R Calf", LEG), // the other side, mirrored
    "Bip01 R Foot": times("Bip01 R Foot", LEG),
    "Bip01 L UpperArm": times("Bip01 L UpperArm", 0.8),
    "Bip01 R UpperArm": times("Bip01 R UpperArm", 0.8),
    "Bip01 Neck": times("Bip01 Neck", [1, 1, 1.1]),
    "Bip01 L Thigh": before[numberOf("Bip01 L Thigh")].pos, // the thigh itself stays where the pelvis has it
    "Bip01 Head": before[numberOf("Bip01 Head")].pos,
  };
  for (const [name, pos] of Object.entries(expect))
    pos.forEach((v, a) => near(after[numberOf(name)].pos[a], v, 1e-5, `${name} at rest, ${"xyz"[a]}`));
  sure(MADE.mirrored.join() === "Bip01 R Thigh,Bip01 R Calf,Bip01 R Clavicle", `mirrored: ${MADE.mirrored}`);
  // every frame of every animation: each turn exactly as it was, each length times its parent's factor
  const factorOf = (i) => {
    const parent = before[i].parent;
    if (parent < 0) return null;
    const given = MADE.factors[names[parent]];
    return given ?? [1, 1, 1];
  };
  for (const seq of ["idle", "walk", "crouch"]) {
    const was = smak.readSequence(SRC, seq).frames;
    const now = smak.readSequence(OUT, seq).frames;
    was.forEach((frame, f) =>
      frame.forEach((six, i) => {
        for (let j = 3; j < 6; j++)
          sure(now[f][i][j] === six[j], `${seq} ${f} ${names[i]}: angle ${j} changed`);
        const k = factorOf(i);
        if (k)
          for (let a = 0; a < 3; a++)
            near(now[f][i][a], six[a] * k[a], 1e-4, `${seq} ${f} ${names[i]} ${"xyz"[a]}`);
      }),
    );
  }
  // in a pose, the joints are that much farther apart
  const pose = smak.poseAt(OUT, smak.sequenceAt(OUT, "walk"), 7);
  const posed0 = smak.poseAt(SRC, smak.sequenceAt(SRC, "walk"), 7);
  const gap = (p, a, b) => Math.hypot(...[0, 1, 2].map((r) => p[numberOf(a)][r][3] - p[numberOf(b)][r][3]));
  near(gap(pose, "Bip01 L Thigh", "Bip01 L Calf"), THIGH * LEG, 1e-3, "the thigh, posed");
  near(gap(pose, "Bip01 R Calf", "Bip01 R Foot"), CALF * LEG, 1e-3, "the right calf, posed");
  near(gap(pose, "Bip01 L Clavicle", "Bip01 L UpperArm") / gap(posed0, "Bip01 L Clavicle", "Bip01 L UpperArm"), 0.8, 1e-4, "the shoulder"); // prettier-ignore
  // hit boxes and attachments on a bone that grew, grown with it
  const knee = smak.attachments(OUT)[0].pos;
  near(knee[0], THIGH * LEG, 1e-4, "the attachment at the knee");
  const thighBox = (mdl) => smak.hitboxes(mdl).find((box) => box.bone === numberOf("Bip01 L Thigh"));
  near(thighBox(OUT).max[0], thighBox(SRC).max[0] * LEG, 1e-4, "the thigh's hit box reaches the new knee");
  sure(MADE.boxes.measured === 3 && !MADE.boxes.carried.length, `boxes: ${JSON.stringify(MADE.boxes)}`);
  sure(!smak.check(OUT, "goldsrc").errors.length, `check: ${smak.check(OUT, "goldsrc").errors}`);
});

test("reproportion: a hit box grows along its bone and keeps its thickness across it; all three axes when told", () => {
  const boxOf = (mdl, name) => smak.hitboxes(mdl).find((box) => box.bone === numberOf(name));
  // the thigh runs along its x (the calf stands out along it), the spine along its z (the neck)
  sure(MADE.along["Bip01 L Thigh"] === "x" && MADE.along["Bip01 Spine"] === "z", JSON.stringify(MADE.along));
  for (const [name, axis, k] of [["Bip01 L Thigh", 0, LEG], ["Bip01 R Calf", 0, LEG], ["Bip01 Spine", 2, 1.1], ["Bip01 L Clavicle", 0, 0.8]]) {
    const was = boxOf(SRC, name);
    const now = boxOf(OUT, name);
    if (!was) continue;
    for (let a = 0; a < 3; a++) {
      const f = a === axis ? k : 1;
      near(now.min[a], was.min[a] * f, 1e-4, `${name} min ${"xyz"[a]}`);
      near(now.max[a], was.max[a] * f, 1e-4, `${name} max ${"xyz"[a]}`);
    }
  }
  sure(boxOf(SRC, "Bip01 L Thigh") && boxOf(SRC, "Bip01 Spine"), "the thigh and the spine have boxes");
  // the pelvis runs up to the spine (z), not out to the thighs at its sides (x)
  const hips = smak.reproportion(SRC, { "Bip01 Pelvis": 1.1 });
  sure(boxOf(SRC, "Bip01 Pelvis") && hips.along["Bip01 Pelvis"] === "z", JSON.stringify(hips.along));
  // the old way: every axis times the factor
  const all = smak.reproportion(SRC, FACTORS, { hitboxes: "all" }).mdl;
  const thigh = boxOf(SRC, "Bip01 L Thigh");
  near(boxOf(all, "Bip01 L Thigh").max[1], thigh.max[1] * LEG, 1e-4, "all: the thigh thicker too");
  near(boxOf(all, "Bip01 L Thigh").max[0], boxOf(OUT, "Bip01 L Thigh").max[0], 1e-4, "all: as long");
  let said = "";
  try {
    smak.reproportion(SRC, FACTORS, { hitboxes: "thick" });
  } catch (e) {
    said = e.message;
  }
  sure(/hitboxes is "along" or "all"/.test(said), `a wrong one: ${said}`);
});

test("reproportion: the feet stay on the ground, standing, walking and crouching, and the pelvis rises", () => {
  near(MADE.stride, LEG, 1e-6, "the stride is the leg's change");
  for (const seq of ["idle", "walk", "crouch"]) {
    const was = lowsOf(SRC, seq);
    const now = lowsOf(OUT, seq);
    near(Math.min(...was), 0, 1e-2, `${seq}: the original stands on the floor`);
    now.forEach((low, f) => near(low, was[f], 0.05, `${seq} frame ${f}: the lowest point`));
  }
  const pelvis = (mdl) => smak.poseAt(mdl, smak.sequenceAt(mdl, "idle"), 0)[numberOf("Bip01 Pelvis")][2][3];
  near(
    pelvis(OUT) - pelvis(SRC),
    (LEG - 1) * (HIP - 6 - SOLE),
    0.02,
    "the pelvis is raised by the legs' growth",
  );
  // the head higher by that and the spine's growth
  sure(
    MADE.ground.bone.endsWith("Foot") && MADE.ground.seq === "idle",
    `the ground: ${JSON.stringify(MADE.ground)}`,
  );
  // left alone, the feet sink
  const sinking = smak.reproportion(SRC, FACTORS, { ground: false }).mdl;
  sure(Math.min(...lowsOf(sinking, "idle")) < -5, "with ground: false the feet go under the floor");
});

test("reproportion: a walk's planted foot does not slide, the travel lengthened with the legs", () => {
  near(smak.sequences(OUT)[1].movement[0], WALK_TRAVEL * LEG, 1e-3, "the walk's travel");
  // the sole's middle under each foot, followed through the walk with the travel put back in
  const slides = (mdl) => {
    const walk = smak.sequences(mdl)[1];
    let worst = 0;
    for (const side of ["L", "R"]) {
      const foot = numberOf(`Bip01 ${side} Foot`);
      const world = Array.from({ length: walk.frames }, (_, f) => {
        const pose = smak.poseAt(mdl, 1, f);
        const p = smak.apply34(pose[foot], soleOf(foot));
        return [p[0] + (walk.movement[0] * f) / (walk.frames - 1), p[1], p[2]];
      });
      const low = Math.min(...world.map((p) => p[2]));
      for (let f = 1; f < world.length; f++)
        if (world[f][2] < low + 0.05 && world[f - 1][2] < low + 0.05)
          worst = Math.max(worst, Math.hypot(world[f][0] - world[f - 1][0], world[f][1] - world[f - 1][1]));
    }
    return worst;
  };
  const was = slides(SRC);
  const now = slides(OUT);
  sure(was < 0.02, `the original's planted feet hold: ${was} a frame`);
  sure(now < was + 0.02, `planted feet slide ${now} a frame after, ${was} before`);
  // the stride left at 1: the longer legs push the planted foot back faster than the model is moved
  const slipping = slides(smak.reproportion(SRC, FACTORS, { stride: 1 }).mdl);
  sure(slipping > 0.15, `with the stride left as it was a planted foot slides: ${slipping} a frame`);
});

test("footSlide: a walk's planted foot held or sliding, its travel applied, and the floor under every frame", () => {
  const was = smak.footSlide(SRC, "walk");
  sure(was.seq === "walk" && was.frames === 25 && was.planted >= 20, `planted steps: ${was.planted}`);
  sure(was.most < 0.05, `the original's planted foot holds: ${was.most} at most`);
  near(was.ground[0], 0, 0.01, "the lowest point is on the floor");
  sure(was.lows.length === 25 && was.ground[1] < 0.5, `the floor through the walk: ${was.ground}`);
  const now = smak.footSlide(OUT, "walk");
  sure(now.most < was.most + 0.05, `after: ${now.most}, before: ${was.most}`);
  const slipping = smak.footSlide(smak.reproportion(SRC, FACTORS, { stride: 1 }).mdl, "walk");
  sure(slipping.mean > 0.15, `the stride left as it was: the planted foot slides ${slipping.mean} a frame`);
  // the feet by name; a walk kept in another file read from it
  const named = smak.footSlide(SRC, "walk", { feet: ["Bip01 L Foot", numberOf("Bip01 R Foot")] });
  sure(JSON.stringify(named) === JSON.stringify(was), "the feet named");
  const main = Buffer.from(SRC);
  main.writeInt32LE(1, main.readInt32LE(168) + 176 + 156);
  const side = Buffer.from(SRC);
  side.write("IDSQ", 0, "latin1");
  const read = smak.footSlide(main, "walk", { groups: [undefined, side] });
  sure(JSON.stringify(read) === JSON.stringify(was), "the same from the side file");
  let said = "";
  try {
    smak.footSlide(SRC, "walk", { feet: /Tail/ });
  } catch (e) {
    said = e.message;
  }
  sure(/no points on the feet/.test(said), `no feet: ${said}`);
});

/** A point under the middle of a foot's sole, in the foot bone's own space. */
function soleOf(foot) {
  const rest = smak.restPose(SRC)[foot];
  return smak.apply34(smak.inverse34(rest), [2, rest[1][3], REST_FOOT - SOLE]);
}

test("reproportion: rigid pieces keep their shape: points stay in their bone's space, and move with it", () => {
  const corners = (mdl) => {
    const model = smak.readMdl(mdl).bodyparts[0].models[0];
    return model.meshes.flatMap((mesh) => smak.readMesh(mdl, model, mesh).flat());
  };
  const was = corners(SRC);
  const now = corners(OUT);
  sure(was.length === now.length, "the same corners");
  was.forEach((c, k) => sure(c.bone === now[k].bone && c.p.every((v, a) => v === now[k].p[a]), `corner ${k} moved in its bone`)); // prettier-ignore
  // posed, the distances between the points of one bone are what they were
  for (const frame of [0, 9, 17]) {
    const before = smak.posed(SRC, { seq: "walk", frame }).tris.flatMap((t) => t.c);
    const after = smak.posed(OUT, { seq: "walk", frame }).tris.flatMap((t) => t.c);
    for (let k = 1; k < before.length; k++) {
      const first = before.findIndex((c) => c.bone === before[k].bone);
      const d0 = Math.hypot(...before[k].p.map((v, a) => v - before[first].p[a]));
      const d1 = Math.hypot(...after[k].p.map((v, a) => v - after[first].p[a]));
      near(d1, d0, 1e-3, `frame ${frame}, corner ${k} from the first on its bone`);
    }
  }
});

test("reproportion: factors of 1 give the file back byte for byte; wrong factors are refused", () => {
  sure(
    smak.reproportion(SRC, { "Bip01 L Thigh": 1, "Bip01 Spine": [1, 1, 1] }).mdl.equals(SRC),
    "factors of 1",
  );
  sure(smak.reproportion(SRC, {}).mdl.equals(SRC), "no factors");
  const refused = (factors, pattern, opts) => {
    try {
      smak.reproportion(SRC, factors, opts);
    } catch (e) {
      return pattern.test(e.message) || `it said: ${e.message}`;
    }
    return "it did not refuse";
  };
  sure(refused({ "Bip01 Tail": 1.1 }, /no bone "Bip01 Tail"/) === true, "a bone it has not");
  sure(refused({ "Bip01 L Thigh": 0 }, /factor over 0/) === true, "a factor of 0");
  sure(refused({ "Bip01 L Thigh": [1, 2] }, /three/) === true, "two numbers");
  sure(
    refused({ "Bip01 L Thigh": 1.1, "Bip01 L Leg": 1.2 }, /given twice/) === true,
    "one bone by two names",
  );
  // the older Biped's names are the same bones; with mirror off only the one side changes
  const one = smak.reproportion(SRC, { "Bip01 L Leg": 1.1 }, { mirror: false });
  sure(
    Object.keys(one.factors).join() === "Bip01 L Thigh" && !one.mirrored.length,
    `one side: ${Object.keys(one.factors)}`,
  );
});

test("reproportion: an animation kept in another file is scaled through the bones, its file untouched", () => {
  // the walk made a sequence group's: its values read from a copy of the file marked as a sequence file
  const SEQINDEX = 168;
  const SEQ_SIZE = 176;
  const SEQGROUP = 156;
  const main = Buffer.from(SRC);
  main.writeInt32LE(1, main.readInt32LE(SEQINDEX) + SEQ_SIZE + SEQGROUP);
  const side = Buffer.from(SRC);
  side.write("IDSQ", 0, "latin1");
  const groups = [undefined, side];
  sure(smak.sequences(main)[1].group === 1, "the walk is kept in another file");
  let said = "";
  try {
    smak.frameValues(main, 1, 0);
  } catch (e) {
    said = e.message;
  }
  sure(/kept in another file/.test(said), `without the file: ${said}`);
  const read = smak.readSequence(main, "walk", 0, groups).frames;
  sure(
    JSON.stringify(read) === JSON.stringify(smak.readSequence(SRC, "walk").frames),
    "read from the side file",
  );
  const sideBefore = Buffer.from(side);
  const made = smak.reproportion(main, FACTORS, { groups });
  sure(side.equals(sideBefore), "the side file is not changed");
  sure(made.boxes.measured === 3, `its box measured through the side file: ${JSON.stringify(made.boxes)}`);
  const now = smak.readSequence(made.mdl, "walk", 0, groups).frames;
  const was = smak.readSequence(OUT, "walk").frames;
  now.forEach((frame, f) => frame.forEach((six, i) => six.forEach((v, j) => near(v, was[f][i][j], 1e-4, `walk ${f} ${names[i]} ${j}`)))); // prettier-ignore
  // without the file, its box is carried from the reference pose's
  const carried = smak.reproportion(main, FACTORS);
  sure(carried.boxes.carried.join() === "walk", `carried: ${carried.boxes.carried}`);
  const box = smak.sequences(carried.mdl)[1];
  sure(box.bbmax[2] > smak.sequences(SRC)[1].bbmax[2], "the carried box is taller");
});

test("smak reproportion: factors on the command line, the files of animations beside it read", () => {
  const file = join(tmp, "biped.mdl");
  const out = join(tmp, "biped_tall.mdl");
  writeFileSync(file, SRC);
  const said = runSmak(
    "reproportion",
    file,
    "Bip01 L Thigh=1.2",
    "Bip01 L Calf=1.2",
    "Bip01 Spine=1,1,1.1",
    "-o",
    out,
  );
  sure(/Bip01 R Calf\s+x1\.2\s+\(its other side's\)/.test(said), `the mirrored side said: ${said}`);
  sure(
    /stride x1\.2000/.test(said) && /fitted over \d+ frames/.test(said),
    `the stride and the ground said: ${said}`,
  );
  const made = readFileSync(out);
  near(smak.bones(made)[numberOf("Bip01 L Foot")].pos[0], CALF * 1.2, 1e-4, "the calf in the file written");
  near(smak.bones(made)[numberOf("Bip01 Neck")].pos[2], 16 * 1.1, 1e-4, "the spine, along its z");
});
