// glTF written (src/glb-write.mjs): a skinned rig with an animation written from what readGlb gave and read back
// with every bone where it was at every moment and every weight kept; a cube under a turned node with its picture
// inside, the picture's bytes kept; the file as other tools read it (aligned, bounded, targets); and a studio model
// made from nothing written as a .glb, every bone where the model's own poses put it.
import * as smak from "../src/index.mjs";
import { inverse, mul, moved, turnOfQuaternion } from "../src/import-math.mjs";
import { test, sure, near } from "./helper.mjs";
import { gltfBuilder, CUBE_POINTS, CUBE_FACES } from "./fixture-import.mjs";
import { figure, BONES } from "./fixture-figure.mjs";

/** Sixteen numbers, columns first, of a matrix of the kit's three rows. */
const columns = (m) => [0, 1, 2, 3].flatMap((c) => [m[0][c], m[1][c], m[2][c], c === 3 ? 1 : 0]);
/** Two boxes standing on each other along glTF's +y: the lower from y 0 to 8, the upper from 10 to 12. */
const boxPoints = (a, b) => [
  [a[0], a[1], a[2]], [b[0], a[1], a[2]], [b[0], b[1], a[2]], [a[0], b[1], a[2]],
  [a[0], a[1], b[2]], [b[0], a[1], b[2]], [b[0], b[1], b[2]], [a[0], b[1], b[2]],
]; // prettier-ignore
const POINTS = [...boxPoints([-1, 0, -1], [1, 8, 1]), ...boxPoints([-1, 10, -1], [1, 12, 1])];
const POLYGONS = [...CUBE_FACES, ...CUBE_FACES.map((face) => face.map((i) => i + 8))];

/**
 * A rig as 37-import-rig's: joints root, tip (10 above) and end (2 above tip, turned 30 degrees about y at rest);
 * the lower box on root, the upper on tip (0.6), root (0.3) and end (0.1); an animation that turns tip a quarter
 * about z (LINEAR), moves root 5 along z at its end (STEP) and swings end about x through three keys.
 */
function rigGlb() {
  const g = gltfBuilder();
  const POSITION = g.accessor(POINTS.flat(), "VEC3");
  const JOINTS_0 = g.accessor(POINTS.flatMap((_, i) => (i < 8 ? [0, 0, 0, 0] : [1, 0, 2, 0])), "VEC4", 5121);
  const WEIGHTS_0 = g.accessor(POINTS.flatMap((_, i) => (i < 8 ? [1, 0, 0, 0] : [0.6, 0.3, 0.1, 0])), "VEC4");
  const index = g.accessor(POLYGONS.flatMap((f) => [f[0], f[1], f[2], f[0], f[2], f[3]]), "SCALAR", 5123);
  const half = Math.PI / 12;
  const endTurn = [0, Math.sin(half), 0, Math.cos(half)];
  const endWorld = mul(moved([0, 12, 0]), turnOfQuaternion(endTurn));
  const binds = g.accessor([...columns(inverse(moved([0, 0, 0]))), ...columns(inverse(moved([0, 10, 0]))), ...columns(inverse(endWorld))], "MAT4"); // prettier-ignore
  const times = g.accessor([0, 1], "SCALAR");
  const s = Math.SQRT1_2;
  const turns = g.accessor([0, 0, 0, 1, 0, 0, s, s], "VEC4");
  const steps = g.accessor([0, 0, 0, 0, 0, 5], "VEC3");
  const swingTimes = g.accessor([0, 0.4, 1], "SCALAR");
  const swing = (a) => {
    // end's own turn: its rest's, then about x by `a`
    const q = [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
    const [x1, y1, z1, w1] = endTurn;
    const [x2, y2, z2, w2] = q;
    return [w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2]; // prettier-ignore
  };
  const swings = g.accessor([...swing(0), ...swing(1.2), ...swing(-0.5)], "VEC4");
  Object.assign(g.json, {
    scenes: [{ nodes: [0, 2] }],
    nodes: [
      { name: "root", children: [1] },
      { name: "tip", translation: [0, 10, 0], children: [3] },
      { name: "body", mesh: 0, skin: 0 },
      { name: "end", translation: [0, 2, 0], rotation: endTurn },
    ],
    skins: [{ joints: [0, 1, 3], inverseBindMatrices: binds }],
    meshes: [{ primitives: [{ attributes: { POSITION, JOINTS_0, WEIGHTS_0 }, indices: index }] }],
    animations: [
      {
        name: "bend",
        samplers: [
          { input: times, output: turns, interpolation: "LINEAR" },
          { input: times, output: steps, interpolation: "STEP" },
          { input: swingTimes, output: swings, interpolation: "LINEAR" },
        ],
        channels: [
          { sampler: 0, target: { node: 1, path: "rotation" } },
          { sampler: 1, target: { node: 0, path: "translation" } },
          { sampler: 2, target: { node: 3, path: "rotation" } },
        ],
      },
    ],
  });
  return g.glb();
}

/** Every node's place in the scene (GoldSrc's axes, the file's units), by its name, at a moment of an animation (or at rest). */
function placesOf(read, animation, seconds) {
  const own = animation ? animation.at(seconds) : new Map();
  const world = [];
  const places = new Map();
  read.nodes.forEach((node, i) => {
    const local = own.get(i) ?? node.rest;
    world.push(node.parent < 0 ? mul(read.stand, local) : mul(world[node.parent], local));
    places.set(node.name, [world[i][0][3], world[i][1][3], world[i][2][3]]);
  });
  return places;
}
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** A .glb taken apart as a reader takes it: { json, binLength, length, said (the header's length) }. */
function opened(glb) {
  const said = glb.readUInt32LE(8);
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8"));
  const binAt = 20 + jsonLength;
  const binLength = binAt < glb.length ? glb.readUInt32LE(binAt) : 0;
  return { json, jsonLength, binLength, binKind: binAt < glb.length ? glb.readUInt32LE(binAt + 4) : 0, length: glb.length, said };
}

/** What Blender's and s&box's importers hold a file to: every fault found, none for a whole one. */
function faultsOfFile(glb) {
  const faults = [];
  const { json, jsonLength, binLength, binKind, length, said } = opened(glb);
  if (glb.readUInt32LE(0) !== 0x46546c67 || glb.readUInt32LE(4) !== 2) faults.push("not a .glb of version 2");
  if (said !== length) faults.push(`the header says ${said} bytes, the file is ${length}`);
  if (jsonLength % 4 || binLength % 4) faults.push("a chunk not a multiple of 4");
  if (binKind !== 0x004e4942) faults.push("no BIN chunk");
  if (json.buffers[0].byteLength > binLength || binLength - json.buffers[0].byteLength > 3) faults.push("the buffer's length against its chunk's");
  const targetOf = new Map();
  json.bufferViews.forEach((v, i) => {
    if (v.byteOffset % 4) faults.push(`bufferView ${i} at ${v.byteOffset}`);
    if (v.byteOffset + v.byteLength > binLength) faults.push(`bufferView ${i} past the bytes`);
  });
  for (const mesh of json.meshes)
    for (const p of mesh.primitives) {
      const position = json.accessors[p.attributes.POSITION];
      if (position.min?.length !== 3 || position.max?.length !== 3) faults.push("POSITION without min and max");
      for (const a of Object.values(p.attributes)) targetOf.set(json.accessors[a].bufferView, 34962);
      targetOf.set(json.accessors[p.indices].bufferView, 34963);
    }
  json.bufferViews.forEach((v, i) => {
    if (v.target !== targetOf.get(i)) faults.push(`bufferView ${i}: target ${v.target}, not ${targetOf.get(i)}`);
  });
  for (const a of json.animations ?? [])
    for (const s of a.samplers) if (!json.accessors[s.input].min || !json.accessors[s.input].max) faults.push("an animation's times without min and max");
  return faults;
}

const rig = smak.readGlb(rigGlb());
const rigWritten = smak.writeGlb(rig);
const rigAgain = smak.readGlb(rigWritten.glb);

test("writeGlb: a rig read and written read back with every bone where it was, at rest and through its animation", () => {
  sure(!rig.warnings.length && !rigWritten.warnings.length, [...rig.warnings, ...rigWritten.warnings].join(" | "));
  sure(rigAgain.nodes.map((n) => n.name).join() === "root,tip,body,end", rigAgain.nodes.map((n) => n.name).join());
  sure(rigAgain.nodes.map((n) => n.parent).join() === "-1,0,-1,1", rigAgain.nodes.map((n) => n.parent).join());
  sure(rigAgain.joints.map((j) => rigAgain.nodes[j].name).join() === "root,tip,end", `joints ${rigAgain.joints}`);
  sure(rigAgain.animations.length === 1 && rigAgain.animations[0].name === "bend", "the animation");
  near(rigAgain.animations[0].duration, 1, 1e-6, "its length");
  // 30 a second, first to last: 31 keys
  sure(rigWritten.facts.animations[0].keys === 31, JSON.stringify(rigWritten.facts.animations));
  let worst = 0;
  // at the keys and between them (0.25 and 0.55 fall between two); not between the last two, where the STEP's jump
  // is a ramp over one frame
  for (const t of [null, 0, 0.25, 0.4, 0.5, 0.55, 0.9, 1]) {
    const before = placesOf(rig, t === null ? null : rig.animations[0], t);
    const after = placesOf(rigAgain, t === null ? null : rigAgain.animations[0], t);
    for (const name of ["root", "tip", "end"]) worst = Math.max(worst, gap(before.get(name), after.get(name)));
  }
  near(worst, 0, 1e-4, "the farthest a bone is from where it was (metres)");
  console.log(`      the farthest bone of the rig off: ${worst.toExponential(2)} m`);
  // and the moments themselves: at the end the tip turned and the whole moved 5 along glTF's z, GoldSrc's x
  near(gap(placesOf(rigAgain, rigAgain.animations[0], 1).get("tip"), [5, 0, 10]), 0, 1e-5, "the tip at the end");
});

test("writeGlb: every corner where it was with its weights, three bones a corner, heaviest first", () => {
  const key = (c) => c.p.map((v) => v.toFixed(4)).join();
  const before = new Map(rig.groups.flatMap((g) => g.tris.flat()).map((c) => [key(c), c]));
  const after = rigAgain.groups.flatMap((g) => g.tris.flat());
  sure(after.length === rig.groups.flatMap((g) => g.tris.flat()).length, `${after.length} corners`);
  let worst = 0;
  for (const c of after) {
    const was = before.get(key(c));
    sure(was, `a corner at ${c.p} that was not`);
    sure(c.weights.length === was.weights.length, `${c.weights.length} weights against ${was.weights.length}`);
    c.weights.forEach(([node, w], k) => {
      sure(rigAgain.nodes[node].name === rig.nodes[was.weights[k][0]].name, "the same bone");
      worst = Math.max(worst, Math.abs(w - was.weights[k][1]));
    });
  }
  near(worst, 0, 1e-6, "the farthest a weight is from its own");
  const upper = after.filter((c) => c.p[2] > 9.5);
  sure(upper.length && upper.every((c) => c.weights.map(([n]) => rigAgain.nodes[n].name).join() === "tip,root,end"), "the upper box on tip, root and end");
});

/** A picture of 4x4 as a PNG: red on its top row, grey below. */
const picture = (() => {
  const rgba = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; i++) rgba.set(i < 4 ? [255, 0, 0, 255] : [128, 128, 128, 255], i * 4);
  return smak.png(4, 4, rgba);
})();

/** 35-glb-read's cube: on a node turned a quarter about glTF's y, under one moved 3 along x; a picture inside on two materials' one. */
function cubeGlb() {
  const g = gltfBuilder();
  const positions = [];
  const uvs = [];
  const indices = [];
  CUBE_FACES.forEach((face, n) => {
    face.forEach((point) => positions.push(...CUBE_POINTS[point]));
    uvs.push(0, 1, 1, 1, 1, 0, 0, 0);
    indices.push(n * 4, n * 4 + 1, n * 4 + 2, n * 4, n * 4 + 2, n * 4 + 3);
  });
  const POSITION = g.accessor(positions, "VEC3");
  const TEXCOORD_0 = g.accessor(uvs, "VEC2");
  const sides = g.accessor(indices.slice(12), "SCALAR", 5123);
  const ends = g.accessor(indices.slice(0, 12), "SCALAR", 5123);
  const image = g.image(picture, "image/png");
  Object.assign(g.json, {
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "holder", translation: [3, 0, 0], children: [1] },
      { name: "cube", mesh: 0, rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION, TEXCOORD_0 }, indices: sides, material: 0 }, { attributes: { POSITION, TEXCOORD_0 }, indices: ends, material: 1 }] }],
    materials: [
      { name: "painted", pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
      { name: "plain", pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.6, 1] } },
    ],
    textures: [{ source: image }],
  });
  return g.glb();
}

test("writeGlb: a mesh under a turned node kept there, its picture inside byte for byte, a colour, the texture coordinates", () => {
  const read = smak.readGlb(cubeGlb());
  const written = smak.writeGlb(read);
  const again = smak.readGlb(written.glb);
  sure(again.images.length === 1 && Buffer.from(again.images[0].bytes).equals(picture), "the picture's bytes, as they were");
  const painted = again.materials.find((m) => m.name === "painted");
  sure(painted.image === 0 && again.images[0].mime === "image/png", JSON.stringify(painted));
  const plain = again.materials.find((m) => m.name === "plain").colour;
  sure(plain.every((v, i) => Math.abs(v - [0.2, 0.4, 0.6][i]) < 1e-6), `the colour ${plain}`);
  // the mesh on its node still, not skinned: the node turned and moved as it was
  const cube = again.nodes.findIndex((n) => n.name === "cube");
  sure(again.meshes.length === 1 && again.meshes[0].node === cube && !again.meshes[0].skinned, JSON.stringify(again.meshes));
  const key = (c) => [...c.p.map((v) => v.toFixed(5)), ...c.uv.map((v) => v.toFixed(5))].join();
  const was = read.groups.flatMap((g) => g.tris.map((t) => `${g.material}:${t.map(key).join("|")}`)).sort();
  const is = again.groups.flatMap((g) => g.tris.map((t) => `${g.material}:${t.map(key).join("|")}`)).sort();
  sure(was.join() === is.join(), "every triangle where it was, wound the same way, wearing the same coordinates and material");
});

test("writeGlb: the file as other tools read it: aligned to 4, POSITION's and the times' bounds, each view's target", () => {
  for (const glb of [rigWritten.glb, smak.writeGlb(smak.readGlb(cubeGlb())).glb]) {
    const faults = faultsOfFile(glb);
    sure(!faults.length, faults.join("; "));
  }
  const { json } = opened(rigWritten.glb);
  // no target on the inverse bind matrices, the animation's times and keys
  const ibm = json.bufferViews[json.accessors[json.skins[0].inverseBindMatrices].bufferView];
  sure(ibm.target === undefined, "the matrices' view has no target");
  sure(json.asset.version === "2.0" && json.skins[0].skeleton === 0, JSON.stringify(json.skins));
  // a weight's four make one, as floats
  const w = json.accessors[json.meshes[0].primitives[0].attributes.WEIGHTS_0];
  sure(w.componentType === 5126 && w.type === "VEC4", JSON.stringify(w));
});

// ── a studio model from nothing: the figure of boxes on a Biped's bones, with an animation that turns its limbs
// about every axis and a walk that travels ──
const still = BONES.map(([, , pos]) => [...pos, 0, 0, 0]);
const bone = (name) => BONES.findIndex(([n]) => n === name);
const wave = Array.from({ length: 11 }, (_, f) => {
  const s = Math.sin((f / 10) * Math.PI * 2);
  const frame = still.map((six) => [...six]);
  frame[0] = [0, 0, 36 + 2 * s, 0.1 * s, 0, 0.3 * s];
  frame[bone("Bip01 Spine")] = [0, 0, 6, 0.1, 0.2 * s, 0.3];
  frame[bone("Bip01 L UpperArm")] = [0, 5, 0, 0, 0.3, 0.8 * s];
  frame[bone("Bip01 R Forearm")] = [0, -11, 0, 0.5 * s, -0.4, 0.2];
  frame[bone("Bip01 L Thigh")] = [0, 4, 0, 0.2, -0.6 * s, 0];
  frame[bone("Bip01 Head")] = [0, 0, 3, 1.2, 0.7, -2.5];
  return frame;
});
const walk = Array.from({ length: 5 }, (_, f) => {
  const frame = still.map((six) => [...six]);
  frame[bone("Bip01 R Thigh")] = [0, -4, 0, 0, 0.5 * Math.cos((f / 4) * Math.PI * 2), 0];
  return frame;
});
let figureMdl = figure({ name: "walker.mdl" }).src;
figureMdl = smak.addSequence(figureMdl, { name: "wave", fps: 10, frames: wave });
figureMdl = smak.addSequence(figureMdl, { name: "walk", fps: 12, loops: true, frames: walk, movement: [24, 0, 0] });

test("mdlToGlb: a studio model's bones, skin and animations, every bone where the model's own poses put it", () => {
  const made = smak.mdlToGlb(figureMdl);
  sure(!faultsOfFile(made.glb).length, faultsOfFile(made.glb).join("; "));
  const read = smak.readGlb(made.glb);
  sure(read.nodes.slice(0, BONES.length).map((n) => n.name).join() === BONES.map(([n]) => n).join(), read.nodes.map((n) => n.name).join());
  // every bone a joint of the one skin (an armature's bone in Blender), the mesh skinned on them
  sure(opened(made.glb).json.skins[0].joints.length === BONES.length && read.meshes.length === 1 && read.meshes[0].skinned, JSON.stringify(read.meshes));
  const list = smak.sequences(figureMdl);
  sure(read.animations.map((a) => a.name).join() === list.map((s) => s.name).join(), read.animations.map((a) => a.name).join());
  // its textures as PNG pictures inside, of the texture's size
  const texture = smak.readMdl(figureMdl).textures[0];
  sure(read.images.length === 1 && smak.unpng(Buffer.from(read.images[0].bytes)).width === texture.width, "the picture inside");
  // GoldSrc's inch is a metre's 39.37th: the scene read back in metres, its places made inches again
  const inches = 39.37;
  let worst = 0;
  const checked = [];
  list.forEach((s, seq) => {
    const animation = read.animations.find((a) => a.name === s.name);
    for (const frame of [...new Set([0, Math.floor((s.frames - 1) / 2), s.frames - 1])]) {
      const pose = smak.poseAt(figureMdl, seq, frame);
      const places = placesOf(read, animation, frame / s.fps);
      // a loop's travel is in its root's frames, as the ports put it back (GoldSrc's engine moved the monster instead)
      const share = s.loops && s.frames > 1 ? frame / (s.frames - 1) : 0;
      BONES.forEach(([name], b) => {
        const want = [0, 1, 2].map((a) => pose[b][a][3] + s.movement[a] * share);
        worst = Math.max(worst, gap(places.get(name).map((v) => v * inches), want));
      });
      checked.push(`${s.name}:${frame}`);
    }
  });
  near(worst, 0, 1e-4, `the farthest a bone is from the model's own (inches), at ${checked.join(" ")}`);
  console.log(`      the farthest bone of the figure off: ${worst.toExponential(2)} inches (${checked.length} poses)`);
  // the mesh at rest where the model has it
  const own = smak.mdlScene(figureMdl).box;
  near(Math.max(...[0, 1, 2].flatMap((a) => [Math.abs(read.box.mn[a] * inches - own.mn[a]), Math.abs(read.box.mx[a] * inches - own.mx[a])])), 0, 1e-3, "the box about its points"); // prettier-ignore
  // one animation chosen, by its name
  const one = smak.readGlb(smak.mdlToGlb(figureMdl, { sequences: ["wave"] }).glb);
  sure(one.animations.map((a) => a.name).join() === "wave", one.animations.map((a) => a.name).join());
});
