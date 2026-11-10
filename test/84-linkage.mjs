// A piston across a joint (make/linkage.mjs): on a hinge of two bones, made up here, the anchors on the hinge's
// own axis are the answer (their bearing never turns, so the rod never strays), found among anchors off it;
// an animation kept in another file is left out and named; anchors too near for a piston give none.
import * as smak from "../src/index.mjs";
import { test, sure, near } from "./helper.mjs";

const plain = smak.indexed({ width: 8, height: 8, rgb: new Uint8Array(8 * 8 * 3).fill(128) }, "plain.bmp");
const block = (x0, x1, bone) => {
  const a = [x0, -1, -1],
    b = [x1, 1, 1];
  const P = (i, j, k) => [i ? b[0] : a[0], j ? b[1] : a[1], k ? b[2] : a[2]];
  const quads = [[P(1,0,0),P(1,1,0),P(1,1,1),P(1,0,1)],[P(0,1,0),P(0,0,0),P(0,0,1),P(0,1,1)],[P(1,1,0),P(0,1,0),P(0,1,1),P(1,1,1)],[P(0,0,0),P(1,0,0),P(1,0,1),P(0,0,1)],[P(0,0,1),P(1,0,1),P(1,1,1),P(0,1,1)],[P(0,1,0),P(1,1,0),P(1,0,0),P(0,0,0)]]; // prettier-ignore
  return quads.flatMap((q) => [[0, 1, 2], [0, 2, 3]].map((t) => t.map((i) => ({ p: q[i], uv: [0, 0], bone })))); // prettier-ignore
};
// the lower bone turns about the z axis through its origin, (10, 0, 0) at rest, by up to 70 degrees
const frame = (turn) => [
  [0, 0, 0, 0, 0, 0],
  [10, 0, 0, 0, 0, turn],
];
const hinge = smak.buildMdl({
  name: "hinge.mdl",
  bones: [
    { name: "upper", parent: -1 },
    { name: "lower", parent: 0, pos: [10, 0, 0] },
  ],
  bodyparts: [{ name: "body", models: [{ name: "arm", meshes: [{ tris: [...block(0, 9, "upper"), ...block(11, 20, "lower")], texture: plain }] }] }], // prettier-ignore
  sequences: [
    { name: "idle", frames: [frame(0)] },
    { name: "bend", frames: Array.from({ length: 11 }, (_, f) => frame((f / 10) * 1.22)) },
    { name: "far", frames: [frame(0), frame(0.5)] },
  ],
});
// "far" marked as kept in another file (mstudioseqdesc_t.seqgroup, 156 bytes into the third sequence's record)
const withFar = Buffer.from(hinge);
withFar.writeInt32LE(1, withFar.readInt32LE(168) + 2 * 176 + 156);

const onAxisA = [10, 0, -4];
const onAxisB = [10, 0, 4];
const candidatesA = [[6, 2, 0], [6, -2, 0], onAxisA, [8, 1.5, 3], [4, 0, -2]]; // prettier-ignore
const candidatesB = [[14, 2, 0], [14, -2, 1], [16, 0, 0], onAxisB, [12, 2, -3]]; // prettier-ignore

test("findPiston: on a hinge, the anchors on its axis, where the rod never strays", () => {
  const found = smak.findPiston(hinge, {
    boneA: "upper",
    boneB: "lower",
    candidatesA,
    candidatesB,
    seqs: ["idle", "bend"],
  });
  sure(found.found, "a piston");
  const { report } = found;
  near(Math.hypot(...smak.sub(report.anchorA, onAxisA)), 0, 1e-6, "the cylinder's anchor");
  near(Math.hypot(...smak.sub(report.anchorB, onAxisB)), 0, 1e-6, "the rod's anchor");
  near(report.stray, 0, 0.01, "its stray");
  sure(
    report.angleA === 0 && report.angleB === 0,
    `the bearings turn ${report.angleA} and ${report.angleB} degrees`,
  );
  near(report.dmin, 8, 1e-6, "the anchors' least distance");
  near(report.dmax, 8, 1e-6, "and their most");
  near(Math.abs(report.axisA[2]), 1, 1e-6, "the cylinder along the hinge's axis");
  near(report.cylinder, 7.5, 1e-6, "the cylinder stops 0.5 short of the rod's eye");
  sure(report.cylinder + report.rod >= report.dmax + 0.6, "the rod stays in the cylinder");
  sure(
    report.frames === 7 && report.sequences.join() === "idle,bend",
    `${report.frames} frames of ${report.sequences}`,
  );
  for (const solid of [...found.cylinder, ...found.rod])
    sure(smak.solids.closed(smak.solids.trisOf(solid)).closed, "closed solids");
  // the halves into the model, each on its bone: the rod's tip stays on the cylinder's axis as the hinge bends
  const { mdl } = smak.putRigid(hinge, {
    pieces: [
      {
        bone: "upper",
        tris: found.cylinder.flatMap(smak.solids.trisOf).map((t) => t.map((c) => ({ p: c.p, uv: [0, 0] }))),
      },
      {
        bone: "lower",
        tris: found.rod.flatMap(smak.solids.trisOf).map((t) => t.map((c) => ({ p: c.p, uv: [0, 0] }))),
      },
    ],
    texture: plain,
    space: "rest",
  });
  sure(!smak.check(mdl).errors.length, smak.check(mdl).errors.join("; "));
});

test("findPiston: off the axis, the best pair strays as the hinge turns", () => {
  const off = smak.findPiston(hinge, {
    boneA: 0,
    boneB: 1,
    candidatesA: candidatesA.filter((p) => p !== onAxisA),
    candidatesB: candidatesB.filter((p) => p !== onAxisB),
    seqs: ["bend"],
  });
  sure(off.found, "a piston");
  sure(
    off.report.stray > 0.1 && off.report.angleB > 5,
    `stray ${off.report.stray}, its bearing turns ${off.report.angleB} degrees`,
  );
});

test("findPiston: an animation kept in another file left out and named; anchors too near give none", () => {
  const found = smak.findPiston(withFar, {
    boneA: "upper",
    boneB: "lower",
    candidatesA: [onAxisA],
    candidatesB: [onAxisB],
  });
  sure(found.found, "a piston");
  sure(found.report.sequences.join() === "idle,bend", `posed: ${found.report.sequences}`);
  sure(
    found.skipped.length === 1 &&
      found.skipped[0].name === "far" &&
      /another file/.test(found.skipped[0].why),
    JSON.stringify(found.skipped),
  );
  const missing = smak.findPiston(hinge, {
    boneA: "upper",
    boneB: "lower",
    candidatesA: [onAxisA],
    candidatesB: [onAxisB],
    seqs: ["bend", "jump"],
  });
  sure(
    missing.skipped[0]?.name === "jump" && /not in the model/.test(missing.skipped[0].why),
    JSON.stringify(missing.skipped),
  );
  const near = smak.findPiston(hinge, {
    boneA: "upper",
    boneB: "lower",
    candidatesA: [[10, 0, -0.6]],
    candidatesB: [[10, 0, 0.6]],
  });
  sure(!near.found && near.cylinder === null, "no piston 1.2 units long");
});
