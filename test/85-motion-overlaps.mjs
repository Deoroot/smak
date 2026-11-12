// Pieces on bones driven into each other by the animations (`motionOverlaps`, make/wear.mjs): on a hinge of two
// bones, made up here, the lower bone's block swings into a guard on the upper as the hinge bends and is caught;
// a block on the side it swings away from is not; a pair set into each other as built counts only for what the
// animation adds; an animation kept in another file is left out and named.
import * as smak from "../src/index.mjs";
import { test, sure, near } from "./helper.mjs";

const S = smak.solids;
const plain = smak.indexed({ width: 8, height: 8, rgb: new Uint8Array(8 * 8 * 3).fill(128) }, "plain.bmp");
/** a box from a to b in model space at rest, as a solid's triangles */
const block = (a, b) => S.trisOf(S.box(S.place(S.lerp3(a, b, 0.5), [0, 0, 1], [1, 0, 0]), b[0] - a[0], b[1] - a[1], b[2] - a[2])); // prettier-ignore
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
  bodyparts: [{ name: "body", models: [{ name: "arm", meshes: [{ tris: block([0, -1, -1], [9, 1, 1]).map((t) => t.map((c) => ({ p: c.p, uv: [0, 0] }))), texture: plain }] }] }], // prettier-ignore
  sequences: [
    { name: "idle", frames: [frame(0)] },
    { name: "bend", frames: Array.from({ length: 11 }, (_, f) => frame((f / 10) * 1.22)) },
    { name: "far", frames: [frame(0), frame(0.5)] },
  ],
});
// the lower bone turns its +x towards +y: its block sweeps up into the guard, away from the back
const pieces = [
  { bone: "lower", name: "arm", tris: block([12, -1, -1], [16, 1, 1]) },
  { bone: "upper", name: "guard", tris: block([10.5, 3, -0.5], [13, 5, 0.5]) },
  { bone: "upper", name: "back", tris: block([10.5, -5, -0.5], [13, -3, 0.5]) },
  // a pin through the joint, into a socket, as built
  { bone: "lower", name: "pin", tris: block([9.5, -0.5, 1.6], [10.5, 0.5, 2.0]) },
  { bone: "upper", name: "socket", tris: block([8.8, -1, 1], [10.2, 1, 2.4]) },
];

test("motionOverlaps: the block driven into the guard is caught, the one on the far side is not", () => {
  const found = smak.motionOverlaps(hinge, pieces, ["idle", "bend"], { space: "rest" });
  const bend = found.sequences.find((s) => s.name === "bend");
  sure(bend && bend.frames === 6, `bend posed in ${bend?.frames} frames`);
  const hit = bend.pairs.find((p) => p.a === "arm" && p.b === "guard");
  sure(hit, `the arm and the guard: ${JSON.stringify(bend.pairs)}`);
  sure(hit.deep > 0.4 && hit.frame > 0, `${hit.deep} deep at frame ${hit.frame}`);
  sure(hit.near, "on bones next to each other");
  sure(!bend.pairs.some((p) => p.a === "back" || p.b === "back"), "the back is never touched");
  sure(
    found.worst.a === "arm" && found.worst.b === "guard" && found.worst.sequence === "bend",
    JSON.stringify(found.worst),
  );
  const idle = found.sequences.find((s) => s.name === "idle");
  sure(idle.pairs.length === 0, `nothing more at rest: ${JSON.stringify(idle.pairs)}`);
});

test("motionOverlaps: a pair set into each other as built is told apart, and counts only for what is added", () => {
  const found = smak.motionOverlaps(hinge, pieces, ["bend"], { space: "rest" });
  const pin = found.built.find((p) => p.a === "pin" && p.b === "socket");
  sure(pin && pin.deep > 0.25, `the pin in its socket as built: ${JSON.stringify(found.built)}`);
  sure(!found.built.some((p) => p.a === "arm" || p.b === "arm"), "the arm is clear as built");
  // turning about the pin's own axis drives it no deeper
  sure(
    !found.sequences[0].pairs.some((p) => p.a === "pin" || p.b === "pin"),
    JSON.stringify(found.sequences[0].pairs),
  );
  // built at the hinge's bend, the arm and the guard are in each other from the start, and the rest pose is no deeper
  const bent = smak.motionOverlaps(hinge, pieces, ["idle"], {
    space: "rest",
    still: { seq: "bend", frame: 10 },
  });
  sure(
    bent.built.some((p) => p.a === "arm" && p.b === "guard"),
    JSON.stringify(bent.built),
  );
  sure(!bent.sequences[0].pairs.length, JSON.stringify(bent.sequences[0].pairs));
});

test("motionOverlaps: pieces given in their bones' space, every animation by default, one kept elsewhere named", () => {
  const inv = smak.restPose(hinge).map(smak.inverse34);
  const onBones = pieces.map((p) => {
    const bone = p.bone === "upper" ? 0 : 1;
    return { ...p, bone, tris: p.tris.map((t) => t.map((c) => smak.apply34(inv[bone], c.p))) };
  });
  const withFar = Buffer.from(hinge);
  withFar.writeInt32LE(1, withFar.readInt32LE(168) + 2 * 176 + 156);
  const found = smak.motionOverlaps(withFar, onBones);
  sure(found.sequences.map((s) => s.name).join() === "idle,bend", found.sequences.map((s) => s.name).join());
  sure(found.skipped.length === 1 && found.skipped[0].name === "far", JSON.stringify(found.skipped));
  const again = smak.motionOverlaps(hinge, pieces, ["bend"], { space: "rest" });
  near(found.worst.deep, again.worst.deep, 1e-6, "the same depth either way");
});
