// Models broken in one way each: over the engine's limits, a texture of a size it draws badly, an animation that
// does not come back or whose event is on no frame of it, a hit box or an attachment on a bone the model has
// not, a bodypart's base of 0, a file that says another length; a contract broken, a file not kept whole, a
// shape with a hole, pieces swung into each other, a Wavefront face of no area. Each model is made here, of a
// triangle or a box.
import * as smak from "../../src/index.mjs";
import { broken, knownBroken } from "./case.mjs";

// where things are in a .mdl file (the engine's studio.h; see src/mdl.mjs)
const HDR_LENGTH = 72; // how long the file says it is
const HDR_BONEINDEX = 144; // the table of bones
const HDR_HITBOXINDEX = 160; // the table of hit boxes
const HDR_BODYPARTINDEX = 208; // the table of bodyparts
const HDR_ATTACHMENTINDEX = 216; // the table of attachments
const BONE_PARENT = 32; // in a bone's entry (112 bytes): its parent's number
const BONE_SIZEOF = 112;
const BODYPART_BASE = 68; // in a bodypart's entry: its base
const ATTACHMENT_BONE = 36; // in an attachment's entry: its bone

/** A texture of one colour, `side` pixels each way; `flags` 2 for chrome. */
const plain = (name, side = 8, flags = 0) => ({ name, width: side, height: side, pixels: new Uint8Array(side * side), palette: new Uint8Array(768).fill(128), flags }); // prettier-ignore
/** A triangle with its corners on `bone`, `x` along. */
const triangle = (x, bone = "root") => [
  { p: [x, 0, 0], uv: [0, 0], bone },
  { p: [x + 1, 0, 0], uv: [1, 0], bone },
  { p: [x, 1, 1], uv: [0, 1], bone },
];
const ROOT = [{ name: "root", parent: -1, pos: [0, 0, 0] }];
const STILL = [[0, 0, 0, 0, 0, 0]];
/** A chain of `count` bones, each 1 along the one before. */
const chain = (count) => Array.from({ length: count }, (_, i) => ({ name: `b${i}`, parent: i - 1, pos: [1, 0, 0] }));

/**
 * A model of one bodypart: `meshes` (by default one triangle wearing one texture), `bones`, `sequences` (by
 * default one still frame, looping) and the rest as buildMdl takes them.
 */
function model({ bones = ROOT, meshes, sequences, ...rest } = {}) {
  const still = bones.map((bone) => [...(bone.pos ?? [0, 0, 0]), 0, 0, 0]);
  return smak.buildMdl({
    name: "broken.mdl",
    bones,
    bodyparts: [{ name: "body", models: [{ name: "m", meshes: meshes ?? [{ tris: [triangle(0, bones[0].name)], texture: plain("a.bmp") }] }] }], // prettier-ignore
    sequences: sequences ?? [{ name: "idle", fps: 10, loops: true, frames: [still] }],
    ...rest,
  });
}
/** Meshes of one triangle each, a texture each. */
const meshesOf = (textures) => textures.map((texture, i) => ({ tris: [triangle(i * 2)], texture }));
/** What `check` says at the levels that stop or warn: a model that passes says nothing. */
const said = (mdl, engine = "goldsrc") => {
  const report = smak.check(mdl, engine);
  return [...report.errors, ...report.warnings];
};
/** A copy of `mdl` with a 32 bit number written at `at`, where `table` (a header's index) says plus `into`. */
const patched = (mdl, table, into, value) => {
  const copy = Buffer.from(mdl);
  copy.writeInt32LE(value, copy.readInt32LE(table) + into);
  return copy;
};

// ── check: the engine's limits ──

broken("check", "129 bones, one more than the engine holds", {
  said: /^129 bones: the engine holds 128$/,
  broken: () => said(model({ bones: chain(129) })),
  whole: () => said(model({ bones: chain(128) })),
});

broken("check", "2100 points in one submodel, over GoldSrc's 2048", {
  said: /^body\/m: 2100 points: goldsrc holds 2048 a submodel$/,
  broken: () => said(model({ meshes: [{ tris: Array.from({ length: 700 }, (_, i) => triangle(i * 3)), texture: plain("a.bmp") }] })), // prettier-ignore
  whole: () => said(model({ meshes: [{ tris: Array.from({ length: 682 }, (_, i) => triangle(i * 3)), texture: plain("a.bmp") }] })), // prettier-ignore
});

broken("check", "101 textures, over the compiler's 100", {
  said: /^101 textures, more than 100: that is the compiler's limit/,
  broken: () => said(model({ meshes: meshesOf(Array.from({ length: 101 }, (_, i) => plain(`t${i}.bmp`))) })),
  whole: () => said(model({ meshes: meshesOf(Array.from({ length: 100 }, (_, i) => plain(`t${i}.bmp`))) })),
});

broken("check", "a texture of 1024, over what GoldSrc draws", {
  said: /^1 textures larger than 512 \(big\.bmp 1024x1024\): GoldSrc draws nothing finer than gl_max_size/,
  broken: () => said(model({ meshes: meshesOf([plain("big.bmp", 1024)]) })),
  whole: () => said(model({ meshes: meshesOf([plain("big.bmp", 512)]) })),
});

broken("check", "a chrome texture that is not 64 x 64", {
  said: /^the chrome texture shine\.bmp is 128x128: older GoldSrc draws chrome right only at 64x64$/,
  broken: () => said(model({ meshes: meshesOf([plain("shine.bmp", 128, 2)]) })),
  whole: () => said(model({ meshes: meshesOf([plain("shine.bmp", 64, 2)]) })),
});

// ── check: animations ──

broken("check", "a looping animation whose last frame is not its first", {
  said: /^the looping animation idle does not come back to where it starts: in its last frame root is 5\.00 units and 0\.0 degrees/,
  broken: () => said(model({ sequences: [{ name: "idle", fps: 10, loops: true, frames: [STILL, [[5, 0, 0, 0, 0, 0]]] }] })), // prettier-ignore
  whole: () => said(model({ sequences: [{ name: "idle", fps: 10, loops: true, frames: [STILL, [[5, 0, 0, 0, 0, 0]], STILL] }] })), // prettier-ignore
});

// the engine fires an event as the animation passes its frame: one past the last never fires
broken("check", "an event on a frame the animation has not", {
  said: /^1 events are on frames their animation has not \(swing's event 1004 on frame 5 of 2\): .* these never fire$/,
  broken: () => said(model({ sequences: [{ name: "swing", fps: 10, frames: [STILL, STILL], events: [{ frame: 5, event: 1004, options: "hit.wav" }] }] })), // prettier-ignore
  whole: () => said(model({ sequences: [{ name: "swing", fps: 10, frames: [STILL, STILL], events: [{ frame: 1, event: 1004, options: "hit.wav" }] }] })), // prettier-ignore
});

broken("check", "no animation at all", {
  said: /^no animation: the engine expects one at least$/,
  broken: () => said(model({ sequences: [] })),
  whole: () => said(model()),
});

// ── check: what names a bone ──

const twoBones = [...ROOT, { name: "hand", parent: 0, pos: [4, 0, 0] }];
broken("check", "a hit box on a bone the model has not", {
  said: /^hit box 0 is on bone 5, and the model has 2: the engine would read a bone that is not there$/,
  // the writer refuses such a box, so the file's number is changed after it
  broken: () => said(patched(model({ bones: twoBones, hitboxes: [{ bone: "hand", min: [0, -1, -1], max: [2, 1, 1] }] }), HDR_HITBOXINDEX, 0, 5)), // prettier-ignore
  whole: () => said(model({ bones: twoBones, hitboxes: [{ bone: "hand", min: [0, -1, -1], max: [2, 1, 1] }] })),
});

broken("check", "an attachment on a bone the model has not", {
  said: /^attachment 0 is on bone 9, and the model has 2: the engine would read a bone that is not there$/,
  broken: () => said(patched(model({ bones: twoBones, attachments: [{ name: "tip", bone: "hand", pos: [2, 0, 0] }] }), HDR_ATTACHMENTINDEX, ATTACHMENT_BONE, 9)), // prettier-ignore
  whole: () => said(model({ bones: twoBones, attachments: [{ name: "tip", bone: "hand", pos: [2, 0, 0] }] })),
});

broken("check", "a bone that hangs from a bone after it", {
  said: /^the bone root hangs from a bone that comes after it$/,
  broken: () => said(patched(model({ bones: twoBones }), HDR_BONEINDEX, BONE_PARENT, 1)),
  whole: () => said(model({ bones: twoBones })),
});

// ── check: the file ──

broken("check", "a bodypart whose base is 0", {
  said: /^the bodypart body has base 0: the engine divides the body number by it$/,
  broken: () => said(patched(model(), HDR_BODYPARTINDEX, BODYPART_BASE, 0)),
  whole: () => said(model()),
});

broken("check", "a header that says another length than the file's", {
  said: /^the file says it is \d+ bytes long and is \d+$/,
  broken: () => {
    const mdl = Buffer.from(model());
    mdl.writeInt32LE(mdl.length + 4, HDR_LENGTH);
    return said(mdl);
  },
  whole: () => said(model()),
});

// ── compareContract: what a mod's code asks of a model ──

const contractOf = (mdl) => smak.contractOf(mdl);
const withAnimations = (names, attachments = []) =>
  model({ bones: twoBones, attachments, sequences: names.map((name) => ({ name, fps: 10, frames: [twoBones.map((b) => [...b.pos, 0, 0, 0])] })) }); // prettier-ignore
const REFERENCE = () => contractOf(withAnimations(["idle", "walk", "attack"], [{ bone: "hand", pos: [2, 0, 0] }]));

broken("compareContract", "an animation of the reference missing", {
  said: /^1 of the reference's 3 animations are missing: attack$/,
  broken: () => smak.compareContract(REFERENCE(), contractOf(withAnimations(["idle", "walk"], [{ bone: "hand", pos: [2, 0, 0] }]))).faults, // prettier-ignore
  whole: () => smak.compareContract(REFERENCE(), contractOf(withAnimations(["idle", "walk", "attack", "dance"], [{ bone: "hand", pos: [2, 0, 0] }]))).faults, // prettier-ignore
});

broken("compareContract", "an attachment on another bone than the reference's", {
  said: /^attachment 0 is on root, the reference's on hand$/,
  broken: () => smak.compareContract(REFERENCE(), contractOf(withAnimations(["idle", "walk", "attack"], [{ bone: "root", pos: [2, 0, 0] }]))).faults, // prettier-ignore
});

broken("compareContract", "animations in another order (code plays them by number)", {
  said: /^2 animations are at another number than the reference's \(code plays them by number\): walk \(1 -> 2\), attack \(2 -> 1\)$/,
  broken: () => smak.compareContract(REFERENCE(), contractOf(withAnimations(["idle", "attack", "walk"], [{ bone: "hand", pos: [2, 0, 0] }]))).faults, // prettier-ignore
});

// a head the game's code turns: the reference's controller is in the contract (contractOf lists it), and a model
// without it is not told of
knownBroken(
  "compareContract",
  "a bone controller of the reference missing",
  "compareContract holds the bones, animations, activities, attachments and bodyparts, and never the controllers: a model made for a monster whose code turns its head passes without the controller. Made a fault, every model spec built with a `contract` against a game's model that has controllers would fail (buildModelSpec writes none): for the owner to decide",
);

// ── keptWhole: a file added to holds what it held ──

broken("keptWhole", "an animation of the file changed", {
  said: /^the same bones and animations$/,
  broken: () => {
    const before = model({ sequences: [{ name: "idle", fps: 10, frames: [STILL] }] });
    const after = model({ sequences: [{ name: "idle", fps: 30, frames: [STILL] }] });
    return smak.keptWhole(before, after).lines.filter((line) => !line.ok).map((line) => line.text);
  },
  whole: () => smak.keptWhole(model(), model()).lines.filter((line) => !line.ok).map((line) => line.text),
});

broken("keptWhole", "a picture of the file changed at its number", {
  said: /^0 of the 1 pictures it had are the same at the same numbers$/,
  broken: () => {
    const red = { ...plain("a.bmp"), palette: new Uint8Array(768).fill(200) };
    const after = model({ meshes: meshesOf([red]) });
    return smak.keptWhole(model({ meshes: meshesOf([plain("a.bmp")]) }), after).lines.filter((line) => !line.ok).map((line) => line.text); // prettier-ignore
  },
});

// ── soundness and seeThrough: a shape whole ──

const W = smak.workshop;
const Z = { x: 0, y: 0, w: 64, h: 64 };
const upright = (s, a, b) => [a, b, s];
/** A model of one bone and one mesh of a turned shape: caps [bottom, top]. */
const turned = (caps) => {
  const M = W.shape(64, 64);
  M.turn([[0, 10], [12, 11], [24, 10]], Z, { sides: 16, caps, at: upright });
  return smak.buildMdl({
    name: "barrel.mdl",
    bodyparts: [{ name: "body", models: [{ name: "b", meshes: [{ tris: M.tris.map((t) => t.map((c) => ({ ...c, bone: "root" }))), texture: smak.indexed(W.sheet(64, 64).image(), "b.bmp") }] }] }], // prettier-ignore
    sequences: [{ name: "idle", fps: 10, frames: [STILL] }],
  });
};

broken("soundness", "a barrel with no lid: a hole of 16 open edges", {
  said: /^16 open edges, in 1 pieces \(b\.bmp; the first at .*\): holes/,
  broken: () => smak.soundness(turned([true, false])).faults,
  whole: () => smak.soundness(turned([true, true])).faults,
});

broken("seeThrough", "a barrel with no lid, looked into from above", {
  said: /^the pictures look through the model at [\d.]+% of its dots .*: a hole, or faces turned away$/,
  broken: () => smak.seeThrough(turned([true, false]), { size: 64 }).faults,
  whole: () => smak.seeThrough(turned([true, true]), { size: 64 }).faults,
});

// ── motionOverlaps: pieces on bones driven into each other ──

// a hinge: a guard on the root a quarter turn round from a block on the arm, and an animation that turns the arm
// that way (into it) or the other (away)
const HINGE = [{ name: "root", parent: -1, pos: [0, 0, 0] }, { name: "arm", parent: 0, pos: [0, 0, 0] }];
const S = smak.solids;
const cube = (centre, half) => S.box(S.place(centre, [0, 0, 1], [1, 0, 0]), 2 * half, 2 * half, 2 * half);
const trisOf = (solid) => S.trisOf(solid);
const hinge = (degrees) =>
  smak.buildMdl({
    name: "hinge.mdl",
    bones: HINGE,
    bodyparts: [{ name: "body", models: [{ name: "b", meshes: [{ tris: [triangle(0)], texture: plain("a.bmp") }] }] }],
    sequences: [{ name: "swing", fps: 10, frames: [0, 1, 2, 3].map((k) => [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, (k / 3) * (degrees * Math.PI) / 180]]) }], // prettier-ignore
  });
const pieces = (guard, block) => [
  { name: "guard", bone: "root", tris: trisOf(cube([0, 12, 0], guard)) },
  { name: "block", bone: "arm", tris: trisOf(cube([12, 0, 0], block)) },
];
const overlapsOf = (mdl, guard = 4, block = 2) => {
  const found = smak.motionOverlaps(mdl, pieces(guard, block), ["swing"], { space: "rest", step: 1 });
  return found.sequences.flatMap((s) => s.pairs.map((pair) => `${s.name}: ${pair.a} into ${pair.b}, ${pair.deep.toFixed(1)} deep at frame ${pair.frame}`)); // prettier-ignore
};

broken("motionOverlaps", "a block swung a quarter turn into the guard beside it", {
  said: /^swing: block into guard, [\d.]+ deep at frame 3$/,
  broken: () => overlapsOf(hinge(90)),
  whole: () => overlapsOf(hinge(-90)),
});

// the same block and guard, of one size: swung onto it, every corner of the one is on a face of the other, at no
// depth (this passed before the piece's middle was asked too)
broken("motionOverlaps", "a block swung onto a guard of its own size, wholly in it", {
  said: /^swing: block into guard, 3\.0 deep at frame 3$/,
  broken: () => overlapsOf(hinge(90), 3, 3),
  whole: () => overlapsOf(hinge(-90), 3, 3),
});

// ── objMeshes: a Wavefront file's faces made a model's ──

const OBJ = "v 0 0 0\nv 8 0 0\nv 0 8 0\nv 16 0 0\nf 1 2 3\n";
broken("objMeshes", "a face whose three points are in a line", {
  said: /^1 triangles of no area \(a line or a point\) were left out$/,
  broken: () => smak.objMeshes(smak.readObj(`${OBJ}f 1 2 4\n`)).warnings,
  whole: () => smak.objMeshes(smak.readObj(OBJ)).warnings,
});

// ── form: a pile of boxes ──
const turnedPost = () => S.lathe(S.place([0, 0, 0], [0, 0, 1], [1, 0, 0]), [[6, 0], [6, 3], [3, 8], [2.5, 40], [4, 46]], { n: 12 });
/** A model of one solid, its corners on the root, and what `check` says of its form. */
const formSaid = (solid, name) => {
  const mdl = model({ meshes: [{ texture: plain("a.bmp", 16), tris: S.trisOf(solid).map((t) => t.map(({ p, k }) => ({ p, uv: [k % 2 ? 15 : 0, k % 3 ? 15 : 0], bone: "root" }))) }] }); // prettier-ignore
  return smak.check(mdl, "goldsrc", { name }).warnings.filter((w) => /^form:/.test(w));
};
const cubeSolid = () => S.box(S.place([0, 0, 0], [0, 0, 1], [1, 0, 0]), 20, 20, 20);

broken("judgeForm", "a model that is one cube: all its surface on the axes, all its edges bare", {
  said: /^form: boxiness \(mean of axis-aligned, sharp edges and how rectangular the silhouette is; 0 round, 1 a crate\): 1 \(Half-Life's 49 props and items: median 0.436, 95th in 100 0.854\); a form here is a box with detail on it: start from a reference/,
  others: true,
  broken: () => formSaid(cubeSolid(), "crate.mdl"),
  whole: () => formSaid(turnedPost(), "crate.mdl"),
});

broken("judgeForm", "a train that is one box, held to the vehicles' band by its name", {
  said: /^form: boxiness .*\(Half-Life's 9 vehicles and machines: median 0.342, 95th in 100 0.456\)/,
  others: true,
  broken: () => formSaid(cubeSolid(), "metro_train.mdl"),
  whole: () => formSaid(turnedPost(), "metro_train.mdl").filter((w) => /boxiness/.test(w)),
});
