// A glTF model (.glb or .gltf) made an s&box model with its skin and its animations, by the same DMX and ModelDoc
// files as a GoldSrc port (dmx.mjs, vmdl.mjs) and compiled by s&box's own resourcecompiler: no .mdl on the way, so
// none of GoldSrc's limits (a bone a vertex, 2048 points a submodel, 128 bones) are put on a model that has none.
//
//   glbToSbox(buffer, { name, folder, fps, resources })   -> { name, vmdl, files: [{ path, data }], facts, warnings,
//                                                              poses(animation, frame) }
//   glbExpected(port, { perSequence })                   what s&box must hold of it (check.mjs's expected)
//   glbToSboxFile(file, { out, name, folder, compile })  written under a project's Assets and compiled
//   checkSboxGlb(file, { project, name, folder })        read back in s&box's editor and held to the file
//
// THE BONES: the nodes the skins hang from, every node above them, and each node an unskinned mesh hangs from (a
// hat on a head), in the file's order (a parent before its children). Each bone's place is its node's from its
// parent as a rigid frame in s&box's axes (+x forward, +z up, as GoldSrc's: readGlb's `stand`) and in s&box's units
// (an inch: a metre is 39.37). A node scaled (an armature exported at 100, a bone at 0.01) has its scale taken into
// its children's places and its meshes' points, where s&box keeps it: a DMX bone has no scale.
//
// THE REST is the nodes' own (readGlb skins every point by the nodes at rest, not by the skin's inverse binds), so
// the mesh's points are where its bones' rest puts them; each corner keeps the skin's weights (four at most, as s&box
// takes them; the heaviest four, made to sum to one), an unskinned mesh's wholly its node's bone.
//
// THE ANIMATIONS: each the file has, sampled at `fps` (30) from its first moment to its last, every bone in every
// frame. A file with the same animation twice, once under its armature's name ("Armature|Idle" beside "Idle", as
// Blender exports one), keeps it once. One whose name says it goes round (idle, walk, run, a loop) loops.
//
// THE MATERIALS: each a picture of its own colour where the file gives no picture (a base colour factor in linear
// light, written in sRGB as a picture is); where it gives one, that picture times nothing (its factor is not baked
// in: said as a warning when it is not white).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { readGlb } from "../glb.mjs";
import { UNITS_A_METRE } from "../import-shape.mjs";
import { anglesOf, qofAngles } from "../animate.mjs";
import { png, unpng } from "../image.mjs";
import { tile } from "../render.mjs";
import { dmxOf, boneNameOf } from "./dmx.mjs";
import { vmdlOf, vmatOf } from "./vmdl.mjs";
import { compileVmdl, findSbox } from "./compile.mjs";
import { editorFor, runCsharp, sboxCall, projectFolder, compileAssets } from "./editor.mjs";
import { probeCode, compareSbox, removeProbeCode, lookViewsOf, lookProbeCode } from "./check.mjs";

/** The rate animations are sampled at, frames a second. */
const FPS = 30;
/** The most bones a vertex follows in s&box. */
const MOST_LINKS = 4;
/** A colour's picture: this many pixels a side. */
const SWATCH = 4;
/** An animation that goes round, by its name. */
const LOOPS = /idle|walk|run|loop|cycle|jog|sprint|strafe/i;

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit3 = (a) => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** A 3x4 matrix times another (b first). */
const mul34 = (a, b) => a.map((r) => [0, 1, 2, 3].map((c) => r[0] * b[0][c] + r[1] * b[1][c] + r[2] * b[2][c] + (c === 3 ? r[3] : 0)));

/**
 * A matrix's rigid part: its turn (its columns made unit and square to one another, x kept, then y) and its place
 * times `k`: { turn: 3x3 rows, at: [x, y, z] }.
 */
function rigid(m, k) {
  const col = (c) => [m[0][c], m[1][c], m[2][c]];
  const x = unit3(col(0));
  let y = col(1);
  y = unit3(sub3(y, x.map((v) => v * dot3(x, y))));
  let z = cross3(x, y);
  // a mirrored frame (a negative scale) keeps its own z's way, so it still turns its children as the file does
  if (dot3(z, col(2)) < 0) z = z.map((v) => -v);
  return { turn: [0, 1, 2].map((r) => [x[r], y[r], z[r]]), at: [m[0][3] * k, m[1][3] * k, m[2][3] * k] };
}

/** A turn (3x3 rows) as a quaternion [w, x, y, z]. */
function quaternionOfTurn(t) {
  const tr = t[0][0] + t[1][1] + t[2][2];
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [s / 4, (t[2][1] - t[1][2]) / s, (t[0][2] - t[2][0]) / s, (t[1][0] - t[0][1]) / s];
  } else if (t[0][0] > t[1][1] && t[0][0] > t[2][2]) {
    const s = Math.sqrt(1 + t[0][0] - t[1][1] - t[2][2]) * 2;
    q = [(t[2][1] - t[1][2]) / s, s / 4, (t[0][1] + t[1][0]) / s, (t[0][2] + t[2][0]) / s];
  } else if (t[1][1] > t[2][2]) {
    const s = Math.sqrt(1 + t[1][1] - t[0][0] - t[2][2]) * 2;
    q = [(t[0][2] - t[2][0]) / s, (t[0][1] + t[1][0]) / s, s / 4, (t[1][2] + t[2][1]) / s];
  } else {
    const s = Math.sqrt(1 + t[2][2] - t[0][0] - t[1][1]) * 2;
    q = [(t[1][0] - t[0][1]) / s, (t[0][2] + t[2][0]) / s, (t[1][2] + t[2][1]) / s, s / 4];
  }
  const n = Math.hypot(...q) || 1;
  return q.map((v) => v / n);
}

/** One rigid frame seen from another: { turn, at } of `child` in `parent`'s. */
function within(parent, child) {
  const T = parent.turn;
  const d = sub3(child.at, parent.at);
  const turn = [0, 1, 2].map((r) => [0, 1, 2].map((c) => T[0][r] * child.turn[0][c] + T[1][r] * child.turn[1][c] + T[2][r] * child.turn[2][c]));
  return { turn, at: [0, 1, 2].map((r) => T[0][r] * d[0] + T[1][r] * d[1] + T[2][r] * d[2]) };
}

/** A colour in linear light as sRGB, 0 to 255. */
const srgb = (v) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));

/** A name as a file's: letters, digits and underscores, lower case. */
const fileName = (name) => String(name).replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "unnamed";

/**
 * The s&box model of a glTF file's bytes (see the top of this file). `name`: the model's name in s&box (its .vmdl's,
 * models/<folder>/<name>.vmdl); `folder` ("smak"); `fps` (30); `resources` (a .gltf's files: readGlb's).
 */
export function glbToSbox(buffer, { name, folder = "smak", fps = FPS, resources } = {}) {
  if (!name) throw new Error("glbToSbox: the model's name in s&box (name)");
  const scene = readGlb(buffer, { resources });
  const warnings = [...scene.warnings];
  const k = (scene.unit?.metres ?? 1) * UNITS_A_METRE;
  const { nodes } = scene;

  // ── the bones: the joints, what is above them, the nodes an unskinned mesh hangs from
  const wanted = new Set();
  const climb = (n) => {
    for (let i = n; i >= 0 && !wanted.has(i); i = nodes[i].parent) wanted.add(i);
  };
  scene.joints.forEach(climb);
  for (const group of scene.groups) for (const tri of group.tris) for (const c of tri) if (!c.weights?.length) climb(c.node);
  const order = nodes.map((_, i) => i).filter((i) => wanted.has(i));
  const boneOf = new Map(order.map((n, b) => [n, b]));
  const taken = new Map();
  const bones = order.map((n, b) => {
    // two nodes whose names come out one in s&box (Hand.L and Hand_L) kept apart
    let bone = boneNameOf(nodes[n].name || `node${n}`);
    const seen = taken.get(bone.toLowerCase()) ?? 0;
    taken.set(bone.toLowerCase(), seen + 1);
    if (seen) bone = `${bone}_${seen + 1}`;
    const parent = nodes[n].parent;
    return { name: bone, parent: parent >= 0 && boneOf.has(parent) ? boneOf.get(parent) : -1, node: n };
  });

  // ── a pose: every bone's six numbers from its parent, from each node's own matrix (the rest unless `own` has one)
  const worldsOf = (own) => {
    const world = [];
    nodes.forEach((node, i) => {
      const local = own?.get(i) ?? node.rest;
      world.push(node.parent < 0 ? mul34(scene.stand, local) : mul34(world[node.parent], local));
    });
    return world;
  };
  const sixOf = (own) => {
    const world = worldsOf(own);
    const frames = bones.map((b) => rigid(world[b.node], k));
    return bones.map((b, i) => {
      const local = b.parent < 0 ? frames[i] : within(frames[b.parent], frames[i]);
      return [...local.at, ...anglesOf(quaternionOfTurn(local.turn))];
    });
  };
  const rest = sixOf(null);

  // ── the mesh: every corner in s&box's units, its bones as the skin weighs them
  const materials = scene.materials.map((m, i) => ({ ...m, file: fileName(m.name || `material${i}`) }));
  const materialOf = new Map(materials.map((m) => [m.name, m]));
  const triangles = [];
  let cut = 0;
  for (const group of scene.groups) {
    // a mesh with no material (or one the file does not hold) drawn in glTF's default, white
    let material = materialOf.get(group.material);
    if (!material) {
      const file = fileName(group.material ?? "default");
      material = materials.find((m) => m.file === file);
      if (!material) materials.push((material = { name: group.material ?? "default", file, colour: [1, 1, 1] }));
    }
    for (const tri of group.tris) {
      const corners = tri.map((c) => {
        let links = (c.weights?.length ? c.weights : [[c.node, 1]])
          .map(([n, w]) => {
            // a weight on a node that is no bone (none should be) goes to the nearest bone above it
            let at = n;
            while (at >= 0 && !boneOf.has(at)) at = nodes[at].parent;
            return [boneOf.get(at) ?? 0, w];
          })
          .filter(([, w]) => w > 0);
        if (links.length > MOST_LINKS) {
          cut++;
          links = links.sort((a, b) => b[1] - a[1]).slice(0, MOST_LINKS);
        }
        const sum = links.reduce((s, [, w]) => s + w, 0) || 1;
        links = links.map(([b, w]) => [b, w / sum]);
        return {
          bone: links[0][0],
          p: c.p.map((v) => v * k),
          n: c.n ?? [0, 0, 1],
          // the kit counts v from the picture's top; a DMX from its bottom
          uv: [c.uv[0], 1 - c.uv[1]],
          links,
        };
      });
      triangles.push({ material: material.file, corners });
    }
  }
  if (cut) warnings.push(`${cut} corners followed more than ${MOST_LINKS} bones: kept their heaviest ${MOST_LINKS}, made to weigh one`);

  // ── the animations: each once, sampled from its first moment to its last
  const seen = new Set();
  const animations = [];
  for (const a of scene.animations) {
    const plain = String(a.name).split("|").pop();
    const key = plain.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const count = Math.max(2, Math.round(a.duration * fps) + 1);
    const frames = Array.from({ length: count }, (_, f) => sixOf(a.at(Math.min(a.duration, f / fps))));
    animations.push({ name: fileName(plain), frames, loops: LOOPS.test(plain), at: a.at, duration: a.duration });
  }
  const dropped = scene.animations.length - animations.length;
  if (dropped) warnings.push(`${dropped} animations the file holds twice (under the armature's name too) kept once`);

  // ── the files
  const where = String(folder).split(/[\\/]+/).filter(Boolean).map(fileName).join("/");
  const own = fileName(name);
  const base = `models/${where}/${own}`;
  const files = [];
  const boneList = bones.map(({ name: n, parent }) => ({ name: n, parent }));
  const mesh = `${base}/${own}_reference.dmx`;
  files.push({ path: mesh, data: dmxOf({ bones: boneList, frames: [rest], triangles }, { fps, name: own }) });
  const sequences = animations.map((a) => {
    const file = `${base}/anims/${a.name}.dmx`;
    files.push({ path: file, data: dmxOf({ bones: boneList, frames: a.frames }, { fps, name: a.name }) });
    return { name: a.name, file, fps, loops: a.loops };
  });
  const used = new Set(triangles.map((t) => t.material));
  const vmats = [];
  for (const m of materials.filter((m) => used.has(m.file))) {
    const picture = `materials/${where}/${own}/${m.file}.png`;
    const image = m.image !== undefined ? scene.images[m.image] : null;
    if (image && image.mime === "image/png") {
      files.push({ path: picture, data: Buffer.from(image.bytes) });
      if (m.colour && m.colour.some((v) => Math.abs(v - 1) > 0.01)) warnings.push(`${m.name}: its colour factor is not baked into its picture`);
    } else {
      if (image) warnings.push(`${m.name}: its picture is ${image.mime}, not PNG: drawn in its colour instead`);
      const [r, g, b] = (m.colour ?? [1, 1, 1]).map(srgb);
      const rgba = new Uint8Array(SWATCH * SWATCH * 4);
      for (let i = 0; i < SWATCH * SWATCH; i++) rgba.set([r, g, b, 255], i * 4);
      files.push({ path: picture, data: png(SWATCH, SWATCH, rgba) });
    }
    const path = `materials/${where}/${own}/${m.file}.vmat`;
    files.push({ path, data: vmatOf({ color: picture }).replace("from a GoldSrc texture", "from a glTF material") });
    vmats.push({ name: m.file, path });
  }
  const vmdl = `${base}.vmdl`;
  files.push({
    path: vmdl,
    data: vmdlOf({ meshes: [{ name: own, file: mesh }], materials: vmats, sequences }),
  });

  /**
   * Every bone's place in the model's space at an animation's frame (null: the rest), as s&box must put it: from the
   * file's own nodes, not from the frames written, so that a check against it holds the whole port to the file.
   */
  const poses = (animation, frame) => {
    const a = animation === null ? null : animations.find((x) => x.name === animation);
    const world = worldsOf(a ? a.at(Math.min(a.duration, frame / fps)) : null);
    return bones.map((b) => rigid(world[b.node], k).at);
  };
  /** The same from the frames written (each bone's six numbers chained from the root): what the DMX says. */
  const written = (animation, frame) => {
    const six = animation === null ? rest : animations.find((a) => a.name === animation).frames[frame];
    const at = [];
    const turns = [];
    six.forEach(([x, y, z, rx, ry, rz], i) => {
      const t = turnOfQ(qofAngles([rx, ry, rz]));
      const p = bones[i].parent;
      if (p < 0) {
        turns.push(t);
        at.push([x, y, z]);
      } else {
        const T = turns[p];
        turns.push(T.map((r) => [0, 1, 2].map((c) => r[0] * t[0][c] + r[1] * t[1][c] + r[2] * t[2][c])));
        at.push(T.map((r, j) => r[0] * x + r[1] * y + r[2] * z + at[p][j]));
      }
    });
    return at;
  };

  return {
    name: own,
    vmdl,
    files,
    warnings,
    poses,
    written,
    facts: {
      bones: bones.map((b) => b.name),
      parents: bones.map((b) => b.parent),
      triangles: triangles.length,
      // the box about its points at rest, in s&box's units: where its pictures look
      box: [0, 1, 2].map((a) => [Math.min(...triangles.flatMap((t) => t.corners.map((c) => c.p[a]))), Math.max(...triangles.flatMap((t) => t.corners.map((c) => c.p[a])))]), // prettier-ignore
      materials: vmats.length,
      animations: animations.map((a) => ({ name: a.name, frames: a.frames.length, fps, loops: a.loops })),
    },
  };
}

/** A quaternion [w, x, y, z] as a turn (3x3 rows). */
function turnOfQ([w, x, y, z]) {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}

/**
 * What s&box must hold of a glb's port (check.mjs's expected, for probeCode and compareSbox): every bone under its
 * parent; every animation, of its length; and each animation at its first frame and its middle one (`perSequence`
 * frames in all), every bone where the port's own frames put it.
 */
export function glbExpected(port, { perSequence = 2 } = {}) {
  const samples = [];
  const poses = [];
  for (const a of port.facts.animations) {
    const picks = [...new Set(Array.from({ length: Math.min(perSequence, a.frames) }, (_, j) => Math.round((j * (a.frames - 1)) / Math.max(1, perSequence - 1))))]; // prettier-ignore
    for (const frame of picks) {
      samples.push({ sequence: a.name, time: frame / a.fps });
      poses.push({ name: a.name, frame, bones: port.poses(a.name, frame) });
    }
  }
  return {
    bones: port.facts.bones.map((n, i) => [n, port.facts.parents[i]]),
    sequences: port.facts.animations.map((a) => ({ name: a.name, duration: (a.frames - 1) / a.fps })),
    // whose poses they are: the file's own nodes, said so in compareSbox's answer
    source: "the file's",
    parts: [],
    skins: [],
    attachments: [],
    hitboxes: 0,
    samples,
    poses,
    physics: null,
    graph: null,
    graphParameters: [],
    graphSamples: [],
    graphPoses: [],
    sounds: [],
    soundEvents: [],
  };
}

/**
 * The whole port of a .glb (or a .gltf, the files it names read from beside it): written under `out` (a project's
 * Assets) and compiled by s&box's resourcecompiler unless `compile` is false. -> the port, { written, compiled }.
 */
export function glbToSboxFile(file, { out, name, folder, fps, compile = true, sbox } = {}) {
  if (!out) throw new Error("glbToSboxFile: the folder the port goes to (out: a project's Assets)");
  const own = basename(file).replace(/\.(glb|gltf)$/i, "");
  const port = glbToSbox(readFileSync(file), { name: name ?? own, folder, fps, resources: resourcesOf(file) });
  for (const { path, data } of port.files) {
    const to = join(resolve(out), path);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, data);
  }
  const materials = port.files.map((f) => f.path).filter((path) => path.endsWith(".vmat"));
  const compiled = compile ? compileVmdl(resolve(out), port.vmdl, { sbox, materials }) : null;
  return { ...port, written: join(resolve(out), port.vmdl), compiled };
}

/** A .gltf's files (its .bin, its pictures) by the names it gives them, read from beside it; nothing for a .glb. */
function resourcesOf(file) {
  if (!/\.gltf$/i.test(file)) return undefined;
  const json = JSON.parse(readFileSync(file, "utf8"));
  const names = [...(json.buffers ?? []), ...(json.images ?? [])].map((x) => x.uri).filter((u) => u && !u.startsWith("data:"));
  return Object.fromEntries(names.map((u) => [u, readFileSync(join(dirname(file), decodeURIComponent(u)))]));
}

/**
 * A .glb's port read back in s&box's editor and held to the file (as checkSboxPort holds a GoldSrc port): every bone
 * under its parent, every animation of its length, each animation at `perSequence` frames with every bone where the
 * file's own nodes put it (within `tolerance`), and every material compiled. How it looks is not held to anything (the
 * kit draws GoldSrc's models, not a glTF's): with `shot` (a .png), s&box's own pictures of it from four sides, in its
 * first animation's first frame, are saved there to be looked at. -> { passed, faults, said, worst, opened, shot }.
 */
export async function checkSboxGlb(file, { project, name, folder, fps, sbox, perSequence = 2, tolerance, shot } = {}) {
  const engine = sbox ?? findSbox();
  const root = projectFolder(project);
  const assets = join(root, "Assets");
  const own = basename(file).replace(/\.(glb|gltf)$/i, "");
  const port = glbToSbox(readFileSync(file), { name: name ?? own, folder, fps, resources: resourcesOf(file) });
  if (!existsSync(join(assets, port.vmdl)))
    throw new Error(`${port.vmdl} is not in ${assets}: port it there first (smak sbox-port ${basename(file)} -o ${assets})`);
  const materials = port.files.map((f) => f.path).filter((path) => path.endsWith(".vmat"));
  if (!existsSync(join(assets, `${port.vmdl}_c`))) compileVmdl(assets, port.vmdl, { sbox: engine, materials });
  const expected = glbExpected(port, { perSequence });
  const editor = await editorFor(root, { sbox: engine });
  try {
    sboxCall(root, "asset_compile", { path: port.vmdl }, { sbox: engine });
    const read = runCsharp(root, probeCode(port.vmdl, expected.samples, expected.graphSamples), { sbox: engine });
    const result = compareSbox(expected, read, { tolerance });
    const failed = compileAssets(root, materials, { sbox: engine });
    if (failed.length) result.faults.push(`${failed.length} of its ${materials.length} materials not compiled (s&box draws them red): ${failed.slice(0, 6).join(", ")}`); // prettier-ignore
    result.passed = !result.faults.length;
    if (shot && !read.error) {
      const box = port.facts.box;
      const mid = box.map(([lo, hi]) => (lo + hi) / 2);
      const far = Math.hypot(...box.map(([lo, hi]) => (hi - lo) / 2));
      const views = lookViewsOf({ mid, far });
      const drawn = runCsharp(root, lookProbeCode(port.vmdl, views.views), { sbox: engine });
      if (drawn.error) result.said.push(`not pictured: ${drawn.error}`);
      else {
        const pictures = drawn.pictures.map((b) => unpng(Buffer.from(b, "base64")));
        const sheet = tile(pictures, pictures.length, views.views.map((v) => `s&box yaw ${v.yaw}`));
        writeFileSync(shot, png(sheet.width, sheet.height, sheet.rgba));
        result.shot = shot;
      }
    }
    runCsharp(root, removeProbeCode(), { sbox: engine });
    return { ...result, opened: editor.opened };
  } finally {
    await editor.close();
  }
}
