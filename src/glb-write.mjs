// glTF 2.0 written: a binary .glb made from the kit's common shape (the one readGlb, readFbx and importedObj give,
// src/import-shape.mjs), so that a file read is written again, and from a GoldSrc model by the parts its ports are
// made of (source/port.mjs). The counterpart of glb.mjs, which reads one.
//
//   writeGlb(scene, { fps, pictures, generator })   -> { glb (the file's bytes), warnings, facts }
//   mdlScene(mdl, { sequences })                    a studio model in the common shape
//   mdlToGlb(mdl, { sequences, fps })               the two together -> { glb, warnings, facts }
//
// THE FILE is glTF's own: +y up, its front towards +z, in metres. The scene's points (which the common shape keeps
// in GoldSrc's axes, +x forward and +z up, in the file's units) are turned back by `stand` and made metres by
// `unit.metres`; a node's own matrix (in the file's axes and units) is seen in glTF's the same way, so a scene read
// from a .glb is written with its nodes as they were. A GoldSrc model's unit is an inch: a metre is 39.37 of them.
//
// WHAT IS WRITTEN
//   - every node, under its parent, as a move, a turn and a scale (a shear is not kept: warned of);
//   - each mesh (the groups of one `object`) with POSITION, NORMAL (a corner without one is given its face's),
//     TEXCOORD_0 (when any corner has one; from the picture's top left, as glTF and the kit count) and a primitive
//     of indexed triangles for each material. A mesh whose corners all hang from one node, unweighted, is written
//     under that node in its space; any other is skinned: JOINTS_0 and WEIGHTS_0 (the heaviest four, made to
//     weigh one; a corner unweighted wholly its node's), one skin for the scene whose inverse bind matrices are
//     the joints' rest, so the points lie where the nodes at rest put them;
//   - materials: the base colour (`colour`, linear, as glTF's baseColorFactor), the picture inside the file when
//     the material has one (`image`, its bytes as they are), not metallic; `mask` (a GoldSrc texture's holes)
//     cut at half its alpha;
//   - animations: every node it moves, sampled at `fps` (the animation's own `fps` when it has one) from its start
//     to its end (the end a key, if it falls between two), its move, turn and (when any differs from 1) scale, LINEAR.
//     A STEP between two keys comes out a ramp over one frame; a curve between keys, as straight lines between
//     the frames.
// THE CHECKS a reader makes, made before the file is given: every accessor within its bytes and aligned, every
// bufferView at a multiple of 4, POSITION's and each animation's times' min and max, the targets of the views of
// points and of indices (and none on the others), every joint and weight in range, a tree with no loop. A fault is
// the writer's, and throws.
import { IDENTITY, mul, apply, applyDir, inverse, det, moved, turnOfQuaternion, normalsOf, standingUp } from "./import-math.mjs";
import { UNITS_A_METRE, measured } from "./import-shape.mjs";
import { png } from "./image.mjs";
import { boneMatrices, bones as bonesOfMdl } from "./mdl.mjs";
import { quaternionOf } from "./sbox/dmx.mjs";
import { portToSource } from "./source/port.mjs";

/** glTF's axes as the kit stands them up: its up +y, its front +z (readGlb's `stand`). */
const GLTF_STAND = standingUp([1, 1], [2, 1]);
/** The animations' rate unless told, frames a second. */
const FPS = 30;
/** The most bones a corner follows in JOINTS_0 and WEIGHTS_0. */
const MOST_LINKS = 4;
/** A weight under this binds nothing. */
const NO_WEIGHT = 1e-6;
/** A scale this near 1, a move this near 0, is none. */
const NOTHING = 1e-9;
/** A shear (axes of a node's matrix this far from square) is warned of. */
const SHEAR = 1e-5;
/** The kinds of number written: glTF's componentType, and its bytes. */
const FLOAT = 5126;
const UNSIGNED_BYTE = 5121;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const SIZE = { [FLOAT]: 4, [UNSIGNED_BYTE]: 1, [UNSIGNED_SHORT]: 2, [UNSIGNED_INT]: 4, 5120: 1, 5122: 2 };
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
/** A bufferView's target: points' numbers, and indices. */
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
/** A .glb's header and chunks. */
const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const transposed = (m) => [0, 1, 2].map((r) => [m[0][r], m[1][r], m[2][r], 0]);
const unit3 = (v) => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n > 0 ? v.map((x) => x / n) : null;
};
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A turn (three rows) as a quaternion [x, y, z, w], by its largest part (Shepperd's way: no loss near a half turn). */
function quaternionOfTurn(t) {
  const trace = t[0][0] + t[1][1] + t[2][2];
  let q;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(t[2][1] - t[1][2]) / s, (t[0][2] - t[2][0]) / s, (t[1][0] - t[0][1]) / s, s / 4];
  } else if (t[0][0] > t[1][1] && t[0][0] > t[2][2]) {
    const s = Math.sqrt(1 + t[0][0] - t[1][1] - t[2][2]) * 2;
    q = [s / 4, (t[0][1] + t[1][0]) / s, (t[0][2] + t[2][0]) / s, (t[2][1] - t[1][2]) / s];
  } else if (t[1][1] > t[2][2]) {
    const s = Math.sqrt(1 + t[1][1] - t[0][0] - t[2][2]) * 2;
    q = [(t[0][1] + t[1][0]) / s, s / 4, (t[1][2] + t[2][1]) / s, (t[0][2] - t[2][0]) / s];
  } else {
    const s = Math.sqrt(1 + t[2][2] - t[0][0] - t[1][1]) * 2;
    q = [(t[0][2] + t[2][0]) / s, (t[1][2] + t[2][1]) / s, s / 4, (t[1][0] - t[0][1]) / s];
  }
  const n = Math.hypot(...q) || 1;
  return q.map((v) => v / n);
}

/**
 * A node's matrix as glTF writes it: { translation, rotation ([x, y, z, w]), scale, sheared }. A matrix that
 * mirrors has its x scaled below 0.
 */
function trsOf(m) {
  const column = (c) => [m[0][c], m[1][c], m[2][c]];
  const axes = [column(0), column(1), column(2)];
  const scale = axes.map((a) => Math.hypot(...a));
  if (det(m) < 0) scale[0] = -scale[0];
  const turn = [0, 1, 2].map((r) => [0, 1, 2].map((c) => (scale[c] ? axes[c][r] / scale[c] : r === c ? 1 : 0)));
  const sheared =
    Math.abs(dot3(column(0), column(1))) > SHEAR * Math.abs(scale[0] * scale[1]) ||
    Math.abs(dot3(column(1), column(2))) > SHEAR * Math.abs(scale[1] * scale[2]) ||
    Math.abs(dot3(column(0), column(2))) > SHEAR * Math.abs(scale[0] * scale[2]);
  return { translation: [m[0][3], m[1][3], m[2][3]], rotation: quaternionOfTurn(turn), scale, sheared };
}

/** The matrix glTF makes of a move, a turn and a scale: what a reader makes of what trsOf gives. */
const matrixOfTrs = ({ translation, rotation, scale }) =>
  mul(mul(moved(translation), turnOfQuaternion(rotation)), [
    [scale[0], 0, 0, 0],
    [0, scale[1], 0, 0],
    [0, 0, scale[2], 0],
  ]);

/** The bytes and the JSON's lists of numbers, as they are made: bufferViews at multiples of 4. */
function binary() {
  const pieces = [];
  let length = 0;
  const json = { bufferViews: [], accessors: [] };
  const view = (bytes, target) => {
    const pad = (4 - (length % 4)) % 4;
    if (pad) {
      pieces.push(Buffer.alloc(pad));
      length += pad;
    }
    pieces.push(bytes);
    json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length, ...(target ? { target } : {}) });
    length += bytes.length;
    return json.bufferViews.length - 1;
  };
  /** An accessor of numbers (`values`, element after element) of a kind, in a view of its own. */
  const accessor = (values, type, componentType = FLOAT, { target, bounds = false } = {}) => {
    const width = WIDTH[type];
    const count = values.length / width;
    const array =
      componentType === FLOAT
        ? Float32Array.from(values)
        : componentType === UNSIGNED_BYTE
          ? Uint8Array.from(values)
          : componentType === UNSIGNED_SHORT
            ? Uint16Array.from(values)
            : Uint32Array.from(values);
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    const said = { bufferView: view(bytes, target), componentType, count, type };
    if (bounds) {
      // what the file holds, as a reader reads it: the numbers once written as floats
      const min = new Array(width).fill(Infinity);
      const max = new Array(width).fill(-Infinity);
      for (let i = 0; i < count; i++)
        for (let k = 0; k < width; k++) {
          min[k] = Math.min(min[k], array[i * width + k]);
          max[k] = Math.max(max[k], array[i * width + k]);
        }
      Object.assign(said, { min, max });
    }
    json.accessors.push(said);
    return json.accessors.length - 1;
  };
  return { json, view, accessor, bytes: () => Buffer.concat(pieces), length: () => length };
}

/** A fault of the file as a reader would find it; none when it is whole. */
function faultsOf(json, binLength) {
  const faults = [];
  const views = json.bufferViews ?? [];
  const accessors = json.accessors ?? [];
  views.forEach((v, i) => {
    if ((v.byteOffset ?? 0) % 4) faults.push(`bufferView ${i} begins at ${v.byteOffset}, not a multiple of 4`);
    if ((v.byteOffset ?? 0) + v.byteLength > binLength) faults.push(`bufferView ${i} runs past the bytes`);
    if (v.target !== undefined && v.target !== ARRAY_BUFFER && v.target !== ELEMENT_ARRAY_BUFFER) faults.push(`bufferView ${i}: target ${v.target}`);
  });
  accessors.forEach((a, i) => {
    const v = views[a.bufferView];
    const size = SIZE[a.componentType];
    if (!v || !size || !WIDTH[a.type]) return faults.push(`accessor ${i} is of no view or kind`);
    if (!(a.count > 0)) faults.push(`accessor ${i} holds nothing`);
    if ((a.byteOffset ?? 0) % size) faults.push(`accessor ${i} is not aligned to its numbers`);
    if ((a.byteOffset ?? 0) + a.count * size * WIDTH[a.type] > v.byteLength) faults.push(`accessor ${i} runs past its view`);
    if (a.min && a.min.some((x, k) => !(x <= a.max[k]))) faults.push(`accessor ${i}: its min is over its max`);
  });
  /** Which views are of points, of indices, of anything else: each its own target. */
  const kinds = new Map();
  const kind = (accessor, what) => {
    const v = accessors[accessor]?.bufferView;
    if (v === undefined) return;
    if (kinds.has(v) && kinds.get(v) !== what) faults.push(`bufferView ${v} is both of ${kinds.get(v)} and of ${what}`);
    kinds.set(v, what);
  };
  const jointCount = json.skins?.[0]?.joints.length ?? 0;
  for (const mesh of json.meshes ?? [])
    for (const p of mesh.primitives) {
      const position = accessors[p.attributes.POSITION];
      if (!position) faults.push(`mesh ${mesh.name}: no POSITION`);
      else if (position.min?.length !== 3 || position.max?.length !== 3) faults.push(`mesh ${mesh.name}: POSITION without its min and max`);
      for (const [name, a] of Object.entries(p.attributes)) {
        kind(a, "points");
        if (accessors[a].count !== position?.count) faults.push(`mesh ${mesh.name}: ${name} of another count than POSITION`);
      }
      if (p.indices !== undefined) {
        kind(p.indices, "indices");
        const i = accessors[p.indices];
        if (![UNSIGNED_BYTE, UNSIGNED_SHORT, UNSIGNED_INT].includes(i.componentType) || i.type !== "SCALAR" || i.count % 3)
          faults.push(`mesh ${mesh.name}: indices not of whole triangles`);
      }
      if ((p.attributes.JOINTS_0 === undefined) !== (p.attributes.WEIGHTS_0 === undefined))
        faults.push(`mesh ${mesh.name}: JOINTS_0 without WEIGHTS_0`);
    }
  for (const skin of json.skins ?? []) {
    kind(skin.inverseBindMatrices, "matrices");
    if (accessors[skin.inverseBindMatrices]?.count !== skin.joints.length) faults.push("the skin's inverse bind matrices are not one a joint");
  }
  for (const a of json.animations ?? [])
    for (const s of a.samplers) {
      kind(s.input, "times");
      kind(s.output, "keys");
      const times = accessors[s.input];
      if (!times?.min || !times?.max) faults.push(`animation ${a.name}: its times without their min and max`);
    }
  for (const image of json.images ?? []) if (image.bufferView !== undefined) kinds.set(image.bufferView, "a picture");
  for (const [v, what] of kinds) {
    const want = what === "points" ? ARRAY_BUFFER : what === "indices" ? ELEMENT_ARRAY_BUFFER : undefined;
    if (views[v].target !== want) faults.push(`bufferView ${v} (of ${what}) has target ${views[v].target}, not ${want}`);
  }
  // the tree: each node one parent at most, no loop, the scene's nodes its roots
  const parent = new Map();
  (json.nodes ?? []).forEach((n, i) =>
    (n.children ?? []).forEach((c) => {
      if (parent.has(c)) faults.push(`node ${c} has two parents`);
      parent.set(c, i);
    }),
  );
  (json.nodes ?? []).forEach((_, i) => {
    let at = i;
    for (let steps = 0; parent.has(at); steps++) {
      at = parent.get(at);
      if (steps > json.nodes.length) return faults.push(`node ${i} is its own ancestor`);
    }
  });
  for (const root of json.scenes?.[0]?.nodes ?? []) if (parent.has(root)) faults.push(`node ${root} is in the scene's list and has a parent`);
  return faults;
}

/** A turn part of the way to another, by the shorter way round ([x, y, z, w]). */
function slerp(a, b, share) {
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const to = cos < 0 ? b.map((v) => -v) : b;
  cos = Math.abs(cos);
  if (cos > 0.9995) {
    const q = a.map((v, i) => v + (to[i] - v) * share);
    const n = Math.hypot(...q);
    return q.map((v) => v / n);
  }
  const angle = Math.acos(cos);
  const from = Math.sin((1 - share) * angle) / Math.sin(angle);
  const toward = Math.sin(share * angle) / Math.sin(angle);
  return a.map((v, i) => v * from + to[i] * toward);
}

/**
 * A binary glTF 2.0 (.glb) of a scene in the kit's common shape (import-shape.mjs: what readGlb, readFbx and
 * importedObj give, and mdlScene), as the top of this file says. Options:
 *   fps         the rate animations are sampled at (30), unless an animation has an `fps` of its own
 *   pictures    { name: bytes }: a material's picture that is a file's name (`picture`), to be put inside the file;
 *               one not given is named as a file beside it (uri), warned of
 *   generator   what the file says wrote it ("SMAK writeGlb")
 * -> { glb (a Buffer), warnings, facts: { nodes, joints, meshes, triangles, points, materials, images,
 *      animations: [{ name, keys, duration }] } }
 */
export function writeGlb(scene, { fps = FPS, pictures = {}, generator = "SMAK writeGlb" } = {}) {
  if (!scene?.groups) throw new Error("writeGlb: a scene in the common shape ({ groups, nodes, materials, ... }: readGlb's)");
  if (!(fps > 0)) throw new Error(`writeGlb: fps more than 0, not ${fps}`);
  const warnings = [];
  const b = binary();
  const json = { asset: { version: "2.0", generator }, scene: 0, scenes: [{ nodes: [] }], nodes: [], ...b.json };

  // ── the file's axes and units as glTF's: a point p of the scene is metres * Gᵀ p, a node's own matrix L is
  // seen as C L Cᵀ (C = Gᵀ stand: the file's axes to glTF's) with its move made metres
  const metres = scene.unit?.metres ?? 1;
  const toGltf = transposed(GLTF_STAND);
  const C = mul(toGltf, scene.stand ?? GLTF_STAND);
  const Ct = transposed(C);
  const local = (m) => {
    const seen = mul(mul(C, m), Ct);
    for (let r = 0; r < 3; r++) seen[r][3] *= metres;
    return seen;
  };
  const point = (p) => apply(toGltf, p).map((v) => v * metres);
  const direction = (n) => applyDir(toGltf, n);

  // ── the nodes, in the scene's order (a parent before its children)
  const nodes = scene.nodes ?? [];
  let sheared = 0;
  const rests = nodes.map((node) => {
    const trs = trsOf(local(node.rest ?? IDENTITY));
    if (trs.sheared) sheared++;
    return trs;
  });
  const worlds = [];
  nodes.forEach((node, i) => {
    const own = matrixOfTrs(rests[i]);
    worlds.push(node.parent >= 0 ? mul(worlds[node.parent], own) : own);
  });
  const trsJson = ({ translation, rotation, scale }) => ({
    ...(translation.some((v) => Math.abs(v) > NOTHING) ? { translation } : {}),
    ...(Math.abs(rotation[3]) < 1 - NOTHING ? { rotation } : {}),
    ...(scale.some((v) => Math.abs(v - 1) > NOTHING) ? { scale } : {}),
  });
  nodes.forEach((node, i) => json.nodes.push({ name: node.name ?? `node${i}`, ...trsJson(rests[i]) }));
  const addNode = (name, parent) => {
    json.nodes.push({ name });
    const at = json.nodes.length - 1;
    worlds[at] = parent >= 0 ? worlds[parent] : IDENTITY;
    nodeParent[at] = parent;
    return at;
  };
  const nodeParent = nodes.map((node) => node.parent ?? -1);
  if (sheared) warnings.push(`${sheared} nodes are sheared (their axes not square): written as a move, a turn and a scale, without the shear`);

  // ── materials and their pictures
  const imageOf = new Map();
  const imageNumber = (key, make) => {
    if (!imageOf.has(key)) {
      const made = make();
      if (!made) return undefined;
      (json.images ??= []).push(made);
      json.textures ??= [];
      json.samplers ??= [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
      json.textures.push({ sampler: 0, source: json.images.length - 1 });
      imageOf.set(key, json.textures.length - 1);
    }
    return imageOf.get(key);
  };
  const mimeOf = (bytes) => (bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : "");
  const materialNumber = new Map();
  (scene.materials ?? []).forEach((m, i) => {
    let texture;
    if (m.image !== undefined && scene.images?.[m.image]) {
      const image = scene.images[m.image];
      const bytes = Buffer.from(image.bytes);
      const mime = image.mime || mimeOf(bytes);
      if (mime !== "image/png" && mime !== "image/jpeg") warnings.push(`${m.name}: its picture is ${mime || "of no kind known"}, which glTF does not hold: left out`);
      else texture = imageNumber(`image${m.image}`, () => ({ name: image.name ?? `image${m.image}`, mimeType: mime, bufferView: b.view(bytes) }));
    } else if (m.picture) {
      const given = pictures[m.picture];
      if (given) texture = imageNumber(`file:${m.picture}`, () => ({ name: m.picture, mimeType: mimeOf(given) || "image/png", bufferView: b.view(Buffer.from(given)) }));
      else {
        warnings.push(`${m.name}: its picture ${m.picture} is a file of its own, not given (pictures): named as a file beside the .glb`);
        texture = imageNumber(`file:${m.picture}`, () => ({ name: m.picture, uri: encodeURI(m.picture) }));
      }
    }
    const pbr = { metallicFactor: 0, roughnessFactor: 1 };
    if (m.colour) pbr.baseColorFactor = [...m.colour.slice(0, 3).map((v) => Math.min(1, Math.max(0, v))), 1];
    if (texture !== undefined) pbr.baseColorTexture = { index: texture };
    (json.materials ??= []).push({
      name: m.name ?? `material${i}`,
      pbrMetallicRoughness: pbr,
      ...(m.mask ? { alphaMode: "MASK", alphaCutoff: 0.5 } : {}),
    });
    materialNumber.set(m.name, json.materials.length - 1);
  });

  // ── the meshes: one for each object, a primitive for each of its materials
  const objects = new Map();
  for (const group of scene.groups) {
    if (!group.tris?.length) continue;
    const name = group.object || group.group || "mesh";
    (objects.get(name) ?? objects.set(name, []).get(name)).push(group);
  }
  const corners = (groups) => groups.flatMap((g) => g.tris.flat());
  // the one skin: every node a corner is weighed on, the scene's joints, and every node above them
  const jointSet = new Set(scene.joints ?? []);
  const skinnedObject = new Map();
  for (const [name, groups] of objects) {
    const all = corners(groups);
    const holders = new Set(all.map((c) => c.node));
    const skinned = all.some((c) => c.weights?.length) || holders.size > 1;
    skinnedObject.set(name, skinned);
    if (skinned)
      for (const c of all) {
        if (!(c.node >= 0) && !c.weights?.length) throw new Error(`writeGlb: a corner of ${name} hangs from no node (node), in a mesh that is skinned`);
        for (const [n] of c.weights?.length ? c.weights : [[c.node, 1]]) jointSet.add(n);
      }
  }
  for (const j of [...jointSet]) for (let at = nodeParent[j]; at >= 0; at = nodeParent[at]) jointSet.add(at);
  const joints = [...jointSet].filter((j) => j >= 0 && j < nodes.length).sort((x, y) => x - y);
  const jointOf = new Map(joints.map((j, i) => [j, i]));
  const holding = new Set();
  let cut = 0;
  let triangles = 0;
  let points = 0;
  const meshNodes = [];
  for (const [name, groups] of objects) {
    const skinned = skinnedObject.get(name);
    const all = corners(groups);
    const holder = all[0].node;
    // the node it is written on: a mesh's own node of its name; else, unskinned, its node (or a child of it holding
    // nothing else); skinned, a node of its own at the root (a skinned mesh's node's place counts for nothing)
    const named = nodes.findIndex((n, i) => n.name === name && n.kind === "Mesh" && !holding.has(i));
    let at;
    if (skinned) at = named >= 0 ? named : addNode(name, -1);
    else if (holder >= 0 && holder < nodes.length) at = !holding.has(holder) ? holder : addNode(name, holder);
    else at = named >= 0 && !(holder >= 0) ? named : addNode(name, -1);
    holding.add(at);
    // from glTF's world to the mesh's own space: the identity for a skinned mesh, whose points are where the rest has them
    const into = skinned ? IDENTITY : inverse(worlds[at]);
    const normalsInto = normalsOf(into);
    const mirrored = det(into) < 0;
    const primitives = [];
    for (const group of groups) {
      const keys = new Map();
      const values = { p: [], n: [], uv: [], j: [], w: [] };
      const indices = [];
      const givenUv = group.tris.some((t) => t.some((c) => c.uv && c.uv.given !== false));
      for (const tri of group.tris) {
        const ps = tri.map((c) => apply(into, point(c.p)));
        const face = unit3(cross3(sub3(ps[1], ps[0]), sub3(ps[2], ps[0]))) ?? [0, 1, 0];
        const order = mirrored ? [0, 2, 1] : [0, 1, 2];
        for (const k of order) {
          const c = tri[k];
          const p = ps[k];
          const n = (c.n && unit3(applyDir(normalsInto, direction(c.n)))) ?? (mirrored ? face.map((v) => -v) : face);
          const uv = givenUv ? [c.uv?.[0] ?? 0, c.uv?.[1] ?? 0] : null;
          let links = [];
          if (skinned) {
            links = (c.weights?.length ? c.weights : [[c.node, 1]]).filter(([, w]) => w > NO_WEIGHT).sort((x, y) => y[1] - x[1]);
            if (links.length > MOST_LINKS) {
              cut++;
              links = links.slice(0, MOST_LINKS);
            }
            if (!links.length) links = [[c.node, 1]];
            const sum = links.reduce((s, [, w]) => s + w, 0);
            links = links.map(([node, w]) => [jointOf.get(node), Math.fround(w / sum)]);
            // made to weigh one as a float: the heaviest takes what the others leave
            links[0][1] = Math.fround(1 - links.slice(1).reduce((s, [, w]) => s + w, 0));
          }
          const key = [...p.map(Math.fround), ...n.map(Math.fround), ...(uv ?? []).map(Math.fround), ...links.flat()].join();
          let index = keys.get(key);
          if (index === undefined) {
            index = keys.size;
            keys.set(key, index);
            values.p.push(...p);
            values.n.push(...n);
            if (uv) values.uv.push(...uv);
            if (skinned)
              for (let l = 0; l < MOST_LINKS; l++) {
                values.j.push(links[l]?.[0] ?? 0);
                values.w.push(links[l]?.[1] ?? 0);
              }
          }
          indices.push(index);
        }
        triangles++;
      }
      points += keys.size;
      const attributes = {
        POSITION: b.accessor(values.p, "VEC3", FLOAT, { target: ARRAY_BUFFER, bounds: true }),
        NORMAL: b.accessor(values.n, "VEC3", FLOAT, { target: ARRAY_BUFFER }),
      };
      if (givenUv) attributes.TEXCOORD_0 = b.accessor(values.uv, "VEC2", FLOAT, { target: ARRAY_BUFFER });
      if (skinned) {
        attributes.JOINTS_0 = b.accessor(values.j, "VEC4", joints.length > 256 ? UNSIGNED_SHORT : UNSIGNED_BYTE, { target: ARRAY_BUFFER });
        attributes.WEIGHTS_0 = b.accessor(values.w, "VEC4", FLOAT, { target: ARRAY_BUFFER });
      }
      const indexKind = keys.size > 65535 ? UNSIGNED_INT : UNSIGNED_SHORT;
      const material = materialNumber.get(group.material);
      primitives.push({
        attributes,
        indices: b.accessor(indices, "SCALAR", indexKind, { target: ELEMENT_ARRAY_BUFFER }),
        mode: 4,
        ...(material !== undefined ? { material } : {}),
      });
    }
    (json.meshes ??= []).push({ name, primitives });
    json.nodes[at].mesh = json.meshes.length - 1;
    if (skinned) json.nodes[at].skin = 0;
    meshNodes.push(at);
  }
  if (cut) warnings.push(`${cut} corners followed more than ${MOST_LINKS} nodes: kept their heaviest ${MOST_LINKS}, made to weigh one`);
  if (joints.length && meshNodes.some((at) => json.nodes[at].skin === 0)) {
    // each joint's rest undone: a point of the mesh (where the rest has it) into the joint's own space, columns first
    const binds = joints.flatMap((j) => {
      const m = inverse(worlds[j]);
      return [0, 1, 2, 3].flatMap((c) => [m[0][c], m[1][c], m[2][c], c === 3 ? 1 : 0]);
    });
    // every node above a joint is one, so the joints' roots are the scene's: one root is the skeleton's
    const roots = joints.filter((j) => nodeParent[j] < 0);
    json.skins = [{ joints, inverseBindMatrices: b.accessor(binds, "MAT4"), ...(roots.length === 1 ? { skeleton: roots[0] } : {}) }];
  } else for (const at of meshNodes) delete json.nodes[at].skin;

  // ── the tree, written: children under their parents, the roots the scene's
  nodeParent.forEach((parent, i) => {
    if (parent >= 0) (json.nodes[parent].children ??= []).push(i);
    else json.scenes[0].nodes.push(i);
  });

  // ── the animations
  const animationFacts = [];
  for (const [number, a] of (scene.animations ?? []).entries()) {
    const rate = a.fps > 0 ? a.fps : fps;
    const duration = Math.max(0, a.duration ?? 0);
    const times = [];
    for (let f = 0; f / rate <= duration + 1e-9; f++) times.push(Math.min(duration, f / rate));
    if (duration - times[times.length - 1] > 1e-6) times.push(duration);
    const poses = times.map((t) => a.at(t));
    const moving = [...new Set(a.nodes ?? [...poses[0].keys()])].filter((n) => n >= 0 && n < nodes.length);
    if (!moving.length) continue;
    const input = b.accessor(times, "SCALAR", FLOAT, { bounds: true });
    const samplers = [];
    const channels = [];
    for (const n of moving) {
      const keys = poses.map((pose) => trsOf(local(pose.get(n) ?? nodes[n].rest ?? IDENTITY)));
      // each turn on the side of the last, so a reader's straight line between them goes the short way
      for (let k = 1; k < keys.length; k++) {
        const [p, q] = [keys[k - 1].rotation, keys[k].rotation];
        if (p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3] * q[3] < 0) keys[k].rotation = q.map((v) => -v);
      }
      const paths = [
        ["translation", "VEC3"],
        ["rotation", "VEC4"],
      ];
      if (keys.some((k) => k.scale.some((v) => Math.abs(v - 1) > NOTHING)) || rests[n].scale.some((v) => Math.abs(v - 1) > NOTHING))
        paths.push(["scale", "VEC3"]);
      for (const [path, type] of paths) {
        samplers.push({ input, output: b.accessor(keys.flatMap((k) => k[path]), type), interpolation: "LINEAR" });
        channels.push({ sampler: samplers.length - 1, target: { node: n, path } });
      }
    }
    (json.animations ??= []).push({ name: a.name ?? `animation${number}`, samplers, channels });
    animationFacts.push({ name: a.name ?? `animation${number}`, keys: times.length, duration });
  }

  // ── the file: its JSON and its bytes, each a chunk of a multiple of 4
  const bin = b.bytes();
  if (bin.length) json.buffers = [{ byteLength: bin.length }];
  if (!json.bufferViews.length) delete json.bufferViews;
  if (!json.accessors.length) delete json.accessors;
  const faults = faultsOf(json, bin.length);
  if (faults.length) throw new Error(`writeGlb: the file made is not whole (a fault of the writer's): ${faults.slice(0, 6).join("; ")}`);
  const text = Buffer.from(JSON.stringify(json), "utf8");
  const jsonChunk = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const binChunk = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const head = (length, kind) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(length, 0);
    h.writeUInt32LE(kind, 4);
    return h;
  };
  const chunks = [head(jsonChunk.length, CHUNK_JSON), jsonChunk, ...(bin.length ? [head(binChunk.length, CHUNK_BIN), binChunk] : [])];
  const total = 12 + chunks.reduce((s, c) => s + c.length, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  return {
    glb: Buffer.concat([header, ...chunks]),
    warnings,
    facts: {
      nodes: json.nodes.length,
      joints: joints.length,
      meshes: json.meshes?.length ?? 0,
      triangles,
      points,
      materials: json.materials?.length ?? 0,
      images: json.images?.length ?? 0,
      animations: animationFacts,
    },
  };
}

/**
 * A studio model (.mdl's bytes) in the common shape, from the parts its ports to Source and s&box are made of
 * (portToSource): its bones as nodes (their names made unique, as the ports make them), each bodypart's first
 * submodel (body 0) as a mesh of its own, every corner wholly on its bone, its textures as PNG pictures inside
 * (a masked one's holes see-through, `mask`), and its animations, each its first blend at its own fps, a loop's
 * travel (LX, LY, LZ) put back into its root bones' frames as the ports put it. GoldSrc's axes (+x forward, +z up)
 * and units (an inch: `unit.metres` 0.0254). `sequences`: which animations (their names or numbers; every one
 * unless told). Each animation's `at(seconds)` gives every bone's own matrix, between two frames the turn slerped
 * and the move straight, as the engine plays it.
 */
export function mdlScene(mdl, { sequences } = {}) {
  const port = portToSource(Buffer.from(mdl), { name: "model", kind: "thing", collision: "none" });
  const { parts } = port;
  const warnings = [];
  const ownMatrix = (six) => boneMatrices([{ parent: -1 }], [six])[0];
  const rest = bonesOfMdl(Buffer.from(mdl)).map(({ pos, rot }) => [...pos, ...rot]);
  const nodes = parts.bones.map((bone, i) => ({ name: bone.name, parent: bone.parent, kind: "", rest: ownMatrix(rest[i]) }));

  // the pictures: a PNG each texture worn
  const images = [];
  const materials = [];
  const materialOf = new Map();
  const materialFor = (name) => {
    if (materialOf.has(name)) return name;
    const t = parts.textures.find((x) => x.name === name);
    let image;
    if (t) image = images.push({ name: `${t.name}.png`, mime: "image/png", bytes: png(t.width, t.height, t.rgba) }) - 1;
    materials.push({ name, colour: [1, 1, 1], picture: null, ...(image !== undefined ? { image } : {}), ...(t && t.flags & 64 ? { mask: true } : {}) });
    materialOf.set(name, materials.length - 1);
    return name;
  };
  const groups = [];
  for (const bodygroup of parts.bodygroups) {
    const file = bodygroup.models[0];
    if (!file) continue;
    const byMaterial = new Map();
    for (const tri of parts.smd.get(file).triangles) {
      const material = materialFor(tri.material);
      const corners = tri.corners.map((c) => ({
        p: c.p,
        n: c.n,
        // the ports count v from the picture's bottom, as Valve's files; the kit and glTF from its top
        uv: Object.assign([c.uv[0], 1 - c.uv[1]], { given: true }),
        node: c.bone,
        weights: c.links?.length ? c.links : [[c.bone, 1]],
      }));
      (byMaterial.get(material) ?? byMaterial.set(material, []).get(material)).push(corners);
    }
    for (const [material, tris] of byMaterial) groups.push({ object: file.replace(/\.smd$/, ""), group: "", material, tris });
    if (bodygroup.models.length > 1) warnings.push(`bodypart ${bodygroup.name}: its first submodel written (body 0), not its other ${bodygroup.models.length - 1}`);
  }

  // the animations: each its first blend, every bone every frame
  const wanted = sequences === undefined ? null : (Array.isArray(sequences) ? sequences : [sequences]).map((s) => (typeof s === "number" ? s : String(s).toLowerCase()));
  const chosen = parts.sequences.filter((s) => !wanted || wanted.includes(s.index) || wanted.includes(s.name.toLowerCase()));
  if (wanted) {
    const missing = wanted.filter((w) => !parts.sequences.some((s) => s.index === w || s.name.toLowerCase() === w));
    if (missing.length) throw new Error(`mdlScene: no animation ${missing.join(", ")}: it has ${parts.sequences.map((s) => s.name).join(", ")}`);
  }
  const animations = chosen.map((s) => {
    if (s.files.length > 1) warnings.push(`animation ${s.name}: its first blend written, not its other ${s.files.length - 1}`);
    const frames = parts.smd.get(s.files[0]).frames;
    const rate = s.fps > 0 ? s.fps : 30;
    const turns = frames.map((frame) => frame.map((six) => quaternionOf(six.slice(3))));
    return {
      name: s.name,
      fps: rate,
      loops: s.loops,
      duration: (frames.length - 1) / rate,
      nodes: nodes.map((_, i) => i),
      at: (seconds) => {
        const f = Math.min(frames.length - 1, Math.max(0, seconds * rate));
        const near = Math.round(f);
        const exact = Math.abs(f - near) < 1e-6;
        const i = exact ? near : Math.floor(f);
        const share = exact ? 0 : f - i;
        const pose = new Map();
        nodes.forEach((_, bone) => {
          if (!share) return pose.set(bone, ownMatrix(frames[i][bone]));
          const [a, z] = [frames[i][bone], frames[i + 1][bone]];
          const at = [0, 1, 2].map((k) => a[k] + (z[k] - a[k]) * share);
          pose.set(bone, mul(moved(at), turnOfQuaternion(slerp(turns[i][bone], turns[i + 1][bone], share))));
        });
        return pose;
      },
    };
  });

  return {
    format: "mdl",
    version: "10",
    groups,
    materials,
    images,
    libraries: [],
    meshes: [...new Set(groups.map((g) => g.object))].map((name) => {
      const own = groups.filter((g) => g.object === name);
      return { name, node: -1, triangles: own.reduce((s, g) => s + g.tris.length, 0), points: 0, materials: own.map((g) => g.material), skinned: true, uvSets: 1 };
    }),
    nodes,
    joints: nodes.map((_, i) => i),
    animations,
    stand: IDENTITY,
    axes: { up: "+z", front: "+x", said: "GoldSrc's" },
    unit: { metres: 1 / UNITS_A_METRE, said: "GoldSrc's: an inch, 39.37 a metre" },
    box: measured(groups).box,
    warnings,
  };
}

/**
 * A studio model (.mdl's bytes) as a .glb: mdlScene, then writeGlb. Options: `sequences` (mdlScene's), `fps`
 * (writeGlb's, for an animation without its own: none of a model's is). -> writeGlb's { glb, warnings, facts }.
 */
export function mdlToGlb(mdl, { sequences, fps, ...rest } = {}) {
  const scene = mdlScene(mdl, { sequences });
  const written = writeGlb(scene, { fps, ...rest, generator: "SMAK mdlToGlb" });
  return { ...written, warnings: [...scene.warnings, ...written.warnings] };
}
