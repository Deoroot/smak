// glTF 2.0: the other file bought models come in, as one binary .glb or as a .gltf with a .bin beside it,
// read into the kit's triangles. A glTF is a JSON text that lists nodes, meshes, materials, skins and
// animations, and says where in a block of bytes each list of numbers lies (an "accessor").
//
//   readGlb(buffer, { resources })   the scene in the common shape of import-shape.mjs
//
// A .glb carries its bytes and usually its pictures inside it; a .gltf names files, which the caller reads
// and hands over as `resources`. Nothing here reads the disk.
import {
  IDENTITY,
  mul,
  mulAll,
  apply,
  applyDir,
  det,
  normalsOf,
  moved,
  stretched,
  turnOfQuaternion,
  ofColumns,
  standingUp,
} from "./import-math.mjs";
import { creased, measured, axisName } from "./import-shape.mjs";

// ── the file ───────────────────────────────────────────────────────────────
/** How a .glb begins ("glTF"), its header's length, and the two kinds of chunk it holds. */
const GLB_MAGIC = 0x46546c67;
const GLB_HEADER = 12;
const CHUNK_HEADER = 8;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
/** The kinds of number an accessor holds: [bytes, how one is read, the most a whole one holds]. */
const COMPONENTS = {
  5120: [1, (view, at) => view.getInt8(at), 127],
  5121: [1, (view, at) => view.getUint8(at), 255],
  5122: [2, (view, at) => view.getInt16(at, true), 32767],
  5123: [2, (view, at) => view.getUint16(at, true), 65535],
  5125: [4, (view, at) => view.getUint32(at, true), 4294967295],
  5126: [4, (view, at) => view.getFloat32(at, true), 1],
};
/** How many numbers one element of an accessor is, by its type. */
const WIDTHS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
/** How a primitive's corners make triangles (`mode`); the others are points and lines. */
const TRIANGLES = 4;
const TRIANGLE_STRIP = 5;
const TRIANGLE_FAN = 6;
/** Ways of packing a mesh that are not read: each needs a decoder of its own. */
const PACKINGS = ["KHR_draco_mesh_compression", "EXT_meshopt_compression"];
/** What a corner without texture coordinates is given: the picture's middle. */
const NO_COORDINATES = [0.5, 0.5];
/** A weight under this binds nothing. */
const NO_WEIGHT = 1e-6;
/** A `data:` address: what kind of bytes, and the bytes in base64. */
const DATA_ADDRESS = /^data:([^;,]*)(;base64)?,/i;

/** The bytes an address of the file names: inside the address itself, or one of the caller's `resources`. */
function bytesAt(address, resources, what) {
  const data = DATA_ADDRESS.exec(address);
  if (data) {
    const said = address.slice(data[0].length);
    return data[2] ? Buffer.from(said, "base64") : Buffer.from(decodeURIComponent(said), "latin1");
  }
  const names = [address, decodeURIComponent(address)];
  const found =
    typeof resources === "function"
      ? names.map((name) => resources(name)).find(Boolean)
      : names.map((name) => resources?.[name]).find(Boolean);
  if (!found)
    throw new Error(
      `readGlb: ${what} is in the file ${address}, which was not given: pass { resources: { "${address}": its bytes } } (a .gltf keeps its numbers in a .bin beside it)`,
    );
  return Buffer.from(found);
}

/** A .glb or a .gltf taken apart: { json, bin }. */
function partsOf(buffer) {
  const bytes = Buffer.from(buffer.buffer ?? buffer, buffer.byteOffset ?? 0, buffer.length);
  if (bytes.length >= GLB_HEADER && bytes.readUInt32LE(0) === GLB_MAGIC) {
    const version = bytes.readUInt32LE(4);
    if (version !== 2)
      throw new Error(`readGlb: a .glb of version ${version}: version 2 is read (glTF 1 keeps its scene another way)`);
    let json = null;
    let bin = null;
    for (let at = GLB_HEADER; at + CHUNK_HEADER <= bytes.length; ) {
      const length = bytes.readUInt32LE(at);
      const kind = bytes.readUInt32LE(at + 4);
      const data = bytes.subarray(at + CHUNK_HEADER, at + CHUNK_HEADER + length);
      if (data.length < length) throw new Error("readGlb: the file is cut short: a chunk runs past its end");
      if (kind === CHUNK_JSON && !json) json = JSON.parse(data.toString("utf8"));
      else if (kind === CHUNK_BIN && !bin) bin = data;
      at += CHUNK_HEADER + length + ((4 - (length % 4)) % 4);
    }
    if (!json) throw new Error("readGlb: the .glb has no JSON chunk: it is not whole");
    return { json, bin, binary: true };
  }
  const whole = bytes.toString("utf8");
  // a text saved with a byte order mark begins with one letter that is not the text's
  const text = whole.charCodeAt(0) === 0xfeff ? whole.slice(1) : whole;
  if (!/^\s*\{/.test(text))
    throw new Error('readGlb: neither a .glb (which begins "glTF") nor a .gltf (a JSON text)');
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`readGlb: the .gltf is not JSON that can be read: ${error.message}`);
  }
  if (!json.asset) throw new Error("readGlb: the JSON has no `asset`: it is not a glTF");
  return { json, bin: null, binary: false };
}

// ── turns between keys ─────────────────────────────────────────────────────
/** A turn part of the way from one quaternion to another, by the shorter way round. */
function slerp(a, b, share) {
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const to = cos < 0 ? b.map((value) => -value) : b;
  cos = Math.abs(cos);
  if (cos > 0.9995) return a.map((value, i) => value + (to[i] - value) * share);
  const angle = Math.acos(cos);
  const from = Math.sin((1 - share) * angle) / Math.sin(angle);
  const toward = Math.sin(share * angle) / Math.sin(angle);
  return a.map((value, i) => value * from + to[i] * toward);
}

/**
 * A glTF 2.0 file (.glb, or the JSON of a .gltf) read into the common shape of import-shape.mjs: see there
 * for what comes back. Besides, `version` ("2.0"), `binary` and `generator` (the tool that wrote it).
 *
 * What is read
 *   - every mesh of the scene: its primitives of triangles (lists, strips and fans; indexed or not) with
 *     POSITION, NORMAL and TEXCOORD_0, each number in any of the kinds the format has (whole numbers
 *     `normalized` are brought to 0..1), sparse accessors too
 *   - each node's place (a matrix, or a move, a turn and a scale) through its parents. A node that mirrors
 *     has its faces turned back the right way round
 *   - materials: their names, the base colour (`baseColorFactor`) and its picture (`baseColorTexture`; the
 *     older `KHR_materials_pbrSpecularGlossiness` gives its `diffuseTexture`). A picture inside the file is in
 *     `images` as the bytes it is (PNG or JPEG) and the material's `image` is its number; one in a file of
 *     its own gives the material's `picture`, the file's name
 *   - skins: JOINTS_0 and WEIGHTS_0 with the inverse bind matrices: each corner's `weights` and the joint
 *     that weighs most on it (`node`); a skinned point is where its joints hold it as the scene rests
 *   - animations: for each node its move, turn and scale between keys, LINEAR or STEP. CUBICSPLINE is read
 *     through its keys in a straight line (the bends between them are not)
 * glTF is +y up with its front towards +z, in metres: the scene is turned so that its up is +z and its front
 * +x, and `unit.metres` is 1. A picture's coordinates count from its top left, as the kit's do.
 * What is not: meshes packed with Draco or meshopt (refused, saying so), points and lines, a second set of
 * texture coordinates, vertex colours, morph targets, cameras, lights, and a picture moved or turned on its
 * material (`KHR_texture_transform`: warned of).
 * Options:
 *   resources   the files a .gltf names, by the name it gives them: { "scene.bin": bytes, ... } or a function
 *               of a name that returns its bytes. A picture's file may be left out: its name is then all that
 *               is known of it
 */
export function readGlb(buffer, { resources } = {}) {
  const { json, bin, binary } = partsOf(buffer);
  const warnings = [];
  const packed = (json.extensionsRequired ?? []).filter((name) => PACKINGS.includes(name));
  if (packed.length)
    throw new Error(
      `readGlb: the meshes are packed with ${packed.join(" and ")}, which is not read: export the file again without mesh compression`,
    );

  // ── the bytes and the lists of numbers in them
  const buffers = [];
  const bufferOf = (number) => {
    if (buffers[number]) return buffers[number];
    const said = json.buffers?.[number];
    if (!said) throw new Error(`readGlb: the file names a buffer ${number} that it has not got`);
    const bytes = said.uri === undefined ? bin : bytesAt(said.uri, resources, `buffer ${number}`);
    if (!bytes) throw new Error("readGlb: the .glb has no chunk of bytes for its numbers: it is not whole");
    return (buffers[number] = bytes);
  };
  const viewBytes = (number) => {
    const view = json.bufferViews?.[number];
    if (!view) throw new Error(`readGlb: the file names a bufferView ${number} that it has not got`);
    const bytes = bufferOf(view.buffer);
    const from = view.byteOffset ?? 0;
    if (from + view.byteLength > bytes.length)
      throw new Error(`readGlb: the file is cut short: bufferView ${number} runs past the end of its bytes`);
    return { bytes: bytes.subarray(from, from + view.byteLength), stride: view.byteStride };
  };
  const read = new Map();
  /** An accessor's numbers, one array an element wide after another: { values (a Float64Array), width, count }. */
  const numbersOf = (number) => {
    if (read.has(number)) return read.get(number);
    const accessor = json.accessors?.[number];
    if (!accessor) throw new Error(`readGlb: the file names an accessor ${number} that it has not got`);
    const component = COMPONENTS[accessor.componentType];
    const width = WIDTHS[accessor.type];
    if (!component || !width)
      throw new Error(`readGlb: accessor ${number} is of a kind the format has not (${accessor.componentType}, ${accessor.type})`);
    const [size, get, most] = component;
    const values = new Float64Array(accessor.count * width);
    const fill = (viewNumber, offset, count, eachWidth, into, at) => {
      const { bytes, stride } = viewBytes(viewNumber);
      const step = stride || size * eachWidth;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (offset + (count - 1) * step + size * eachWidth > bytes.length && count)
        throw new Error(`readGlb: the file is cut short: accessor ${number} runs past the end of its bytes`);
      for (let i = 0; i < count; i++)
        for (let k = 0; k < eachWidth; k++) into[at(i) + k] = get(view, offset + i * step + k * size);
    };
    if (accessor.bufferView !== undefined)
      fill(accessor.bufferView, accessor.byteOffset ?? 0, accessor.count, width, values, (i) => i * width);
    if (accessor.sparse) {
      // a few elements written apart from the rest: which ones, then their values
      const { count, indices, values: changed } = accessor.sparse;
      const which = new Float64Array(count);
      const [indexSize, indexGet] = COMPONENTS[indices.componentType];
      const { bytes } = viewBytes(indices.bufferView);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i < count; i++) which[i] = indexGet(view, (indices.byteOffset ?? 0) + i * indexSize);
      fill(changed.bufferView, changed.byteOffset ?? 0, count, width, values, (i) => which[i] * width);
    }
    if (accessor.normalized && most !== 1)
      for (let i = 0; i < values.length; i++) values[i] = Math.max(-1, values[i] / most);
    const result = { values, width, count: accessor.count };
    read.set(number, result);
    return result;
  };

  // ── pictures and materials
  const images = [];
  const imageNumbers = new Map();
  /** The picture a texture of the file shows: { picture (a file's name) } or { image (its number in `images`) }. */
  const pictureOf = (textureNumber) => {
    const texture = json.textures?.[textureNumber];
    const source = texture?.source ?? texture?.extensions?.KHR_texture_basisu?.source;
    const said = json.images?.[source];
    if (!said) return {};
    if (imageNumbers.has(source)) return imageNumbers.get(source);
    let found;
    if (said.bufferView !== undefined) {
      const bytes = Buffer.from(viewBytes(said.bufferView).bytes);
      found = { image: images.push({ name: said.name ?? `image${source}`, mime: said.mimeType ?? "", bytes }) - 1 };
    } else if (DATA_ADDRESS.test(said.uri ?? "")) {
      const mime = DATA_ADDRESS.exec(said.uri)[1];
      const bytes = bytesAt(said.uri, resources, "a picture");
      found = { image: images.push({ name: said.name ?? `image${source}`, mime, bytes }) - 1 };
    } else found = said.uri ? { picture: decodeURIComponent(said.uri) } : {};
    imageNumbers.set(source, found);
    return found;
  };
  const taken = new Set();
  const materials = (json.materials ?? []).map((said, number) => {
    const pbr = said.pbrMetallicRoughness ?? {};
    const older = said.extensions?.KHR_materials_pbrSpecularGlossiness ?? {};
    const texture = pbr.baseColorTexture ?? older.diffuseTexture;
    const factor = pbr.baseColorFactor ?? older.diffuseFactor;
    if (texture?.extensions?.KHR_texture_transform)
      warnings.push(
        `the material ${said.name ?? number} moves or turns its picture (KHR_texture_transform): that is not read, and the picture may lie wrong`,
      );
    if ((texture?.texCoord ?? 0) !== 0)
      warnings.push(
        `the material ${said.name ?? number} lays its picture by a second set of texture coordinates: the first is read`,
      );
    let name = said.name ?? `material${number}`;
    for (let nth = 2; taken.has(name); nth++) name = `${said.name ?? `material${number}`}.${nth}`;
    taken.add(name);
    return {
      name,
      colour: factor ? factor.slice(0, 3).map((v) => Math.min(1, Math.max(0, v))) : null,
      picture: null,
      ...(texture ? pictureOf(texture.index) : {}),
    };
  });

  // ── the nodes: a parent before its children
  const said = json.nodes ?? [];
  const parentOf = new Array(said.length).fill(-1);
  said.forEach((node, number) => {
    for (const child of node.children ?? []) if (said[child]) parentOf[child] = number;
  });
  const localOf = (node, translation, rotation, scale) =>
    mulAll(
      moved(translation ?? node.translation ?? [0, 0, 0]),
      turnOfQuaternion(rotation ?? node.rotation ?? [0, 0, 0, 1]),
      stretched(scale ?? node.scale ?? [1, 1, 1]),
    );
  const order = [];
  const numberOf = new Array(said.length).fill(-1);
  const place = (number, depth = 0) => {
    if (numberOf[number] >= 0) return;
    if (parentOf[number] >= 0 && depth < said.length) place(parentOf[number], depth + 1);
    numberOf[number] = order.push(number) - 1;
  };
  said.forEach((_, number) => place(number));
  const nodes = order.map((number) => {
    const node = said[number];
    return {
      name: node.name ?? `node${number}`,
      parent: parentOf[number] < 0 ? -1 : numberOf[parentOf[number]],
      kind: node.mesh !== undefined ? "Mesh" : "",
      rest: node.matrix ? ofColumns(node.matrix) : localOf(node),
    };
  });
  const world = [];
  nodes.forEach((node, i) => world.push(node.parent < 0 ? node.rest : mul(world[node.parent], node.rest)));
  // only what the scene shows: the nodes under its roots (every node, when the file names no scene)
  const scene = json.scenes?.[json.scene ?? 0];
  const shown = new Set();
  const show = (number) => {
    if (shown.has(number) || !said[number]) return;
    shown.add(number);
    for (const child of said[number].children ?? []) show(child);
  };
  if (scene?.nodes) scene.nodes.forEach(show);
  else said.forEach((_, number) => show(number));

  const stand = standingUp([1, 1], [2, 1]);

  // ── the meshes
  const groups = [];
  const meshes = [];
  const jointSet = new Set();
  for (const number of order) {
    const node = said[number];
    const mesh = json.meshes?.[node.mesh];
    if (!mesh || !shown.has(number)) continue;
    const own = numberOf[number];
    const name = node.name ?? mesh.name ?? `mesh${node.mesh}`;
    const skin = json.skins?.[node.skin];
    const joints = skin?.joints.map((joint) => numberOf[joint]);
    const inverseBinds = skin?.inverseBindMatrices === undefined ? null : numbersOf(skin.inverseBindMatrices).values;
    // the matrix from the mesh to the scene by each joint at rest
    const byJoint = joints?.map((joint, i) =>
      mulAll(stand, world[joint], inverseBinds ? ofColumns(inverseBinds.subarray(i * 16, i * 16 + 16)) : IDENTITY),
    );
    const normalsByJoint = [];
    const toScene = mul(stand, world[own]);
    const normalsToScene = normalsOf(toScene);
    const mirrored = det(toScene) < 0;
    const byMaterial = new Map();
    let triangles = 0;
    let points = 0;
    let uvSets = 0;
    let skinned = false;
    for (const primitive of mesh.primitives ?? []) {
      const mode = primitive.mode ?? TRIANGLES;
      if (primitive.extensions && PACKINGS.some((packing) => primitive.extensions[packing]))
        throw new Error(`readGlb: the mesh ${name} is packed (${Object.keys(primitive.extensions).join(", ")}), which is not read`);
      if (mode !== TRIANGLES && mode !== TRIANGLE_STRIP && mode !== TRIANGLE_FAN) {
        warnings.push(`${name}: a primitive of points or lines (mode ${mode}) is passed over`);
        continue;
      }
      const attributes = primitive.attributes ?? {};
      if (attributes.POSITION === undefined) continue;
      const position = numbersOf(attributes.POSITION);
      const normal = attributes.NORMAL === undefined ? null : numbersOf(attributes.NORMAL);
      const coordinate = attributes.TEXCOORD_0 === undefined ? null : numbersOf(attributes.TEXCOORD_0);
      const jointOf = attributes.JOINTS_0 === undefined || !byJoint ? null : numbersOf(attributes.JOINTS_0);
      const weightOf = attributes.WEIGHTS_0 === undefined || !byJoint ? null : numbersOf(attributes.WEIGHTS_0);
      uvSets = Math.max(uvSets, Object.keys(attributes).filter((key) => key.startsWith("TEXCOORD_")).length);
      points += position.count;
      const made = new Array(position.count);
      const cornerOf = (point) => {
        if (made[point]) return made[point];
        const at = point * 3;
        const p0 = [position.values[at], position.values[at + 1], position.values[at + 2]];
        const n0 = normal ? [normal.values[at], normal.values[at + 1], normal.values[at + 2]] : null;
        let p;
        let onNode = own;
        let weights = null;
        let turn = normalsToScene;
        if (jointOf && weightOf) {
          const bound = [];
          for (let k = 0; k < 4; k++) {
            const weight = weightOf.values[point * 4 + k];
            const joint = jointOf.values[point * 4 + k];
            if (weight > NO_WEIGHT && byJoint[joint]) bound.push([joint, weight]);
          }
          if (bound.length) {
            bound.sort((a, b) => b[1] - a[1]);
            const total = bound.reduce((sum, [, weight]) => sum + weight, 0);
            p = [0, 0, 0];
            for (const [joint, weight] of bound) {
              const there = apply(byJoint[joint], p0);
              for (let a = 0; a < 3; a++) p[a] += (there[a] * weight) / total;
              jointSet.add(joints[joint]);
            }
            const heaviest = bound[0][0];
            onNode = joints[heaviest];
            weights = bound.map(([joint, weight]) => [joints[joint], weight / total]);
            turn = normalsByJoint[heaviest] ??= normalsOf(byJoint[heaviest]);
            skinned = true;
          }
        }
        p ??= apply(toScene, p0);
        let n = null;
        if (n0) {
          const there = applyDir(turn, n0);
          const length = Math.hypot(...there);
          n = length > 0 ? there.map((t) => t / length) : null;
        }
        const uv = Object.assign(
          coordinate ? [coordinate.values[point * 2], coordinate.values[point * 2 + 1]] : [...NO_COORDINATES],
          { given: Boolean(coordinate) },
        );
        return (made[point] = { p, uv, n, node: onNode, ...(weights ? { weights } : {}) });
      };
      const index = primitive.indices === undefined ? null : numbersOf(primitive.indices).values;
      const count = index ? index.length : position.count;
      const pointAt = (i) => (index ? index[i] : i);
      const material = materials[primitive.material]?.name ?? "";
      const list = byMaterial.get(material) ?? byMaterial.set(material, []).get(material);
      const add = (a, b, c) => {
        if (a >= position.count || b >= position.count || c >= position.count) return;
        const face = creased([cornerOf(a), cornerOf(b), cornerOf(c)]);
        list.push(mirrored ? [face[0], face[2], face[1]] : face);
        triangles++;
      };
      if (mode === TRIANGLES) for (let i = 0; i + 2 < count; i += 3) add(pointAt(i), pointAt(i + 1), pointAt(i + 2));
      else if (mode === TRIANGLE_FAN) for (let i = 1; i + 1 < count; i++) add(pointAt(0), pointAt(i), pointAt(i + 1));
      else
        // a strip: every other triangle is written the other way round
        for (let i = 0; i + 2 < count; i++)
          if (i % 2) add(pointAt(i + 1), pointAt(i), pointAt(i + 2));
          else add(pointAt(i), pointAt(i + 1), pointAt(i + 2));
    }
    for (const [material, tris] of byMaterial)
      if (tris.length) groups.push({ object: name, group: "", material, tris });
    meshes.push({
      name,
      node: own,
      triangles,
      points,
      materials: [...byMaterial.keys()],
      skinned,
      uvSets,
    });
  }

  // ── animations
  const animations = [];
  (json.animations ?? []).forEach((animation, number) => {
    /** node (its number in the file) -> { translation, rotation, scale }: each { times, values, width, step } */
    const moves = new Map();
    let last = 0;
    let first = Infinity;
    let bent = false;
    for (const channel of animation.channels ?? []) {
      const sampler = animation.samplers?.[channel.sampler];
      const node = channel.target?.node;
      const path = channel.target?.path;
      if (!sampler || !said[node] || !["translation", "rotation", "scale"].includes(path)) continue;
      const times = numbersOf(sampler.input).values;
      const output = numbersOf(sampler.output);
      if (!times.length) continue;
      const cubic = sampler.interpolation === "CUBICSPLINE";
      bent ||= cubic;
      // a cubic key is three values: the bend in, the value, the bend out
      const values = cubic
        ? Float64Array.from({ length: times.length * output.width }, (_, i) => {
            const key = Math.floor(i / output.width);
            return output.values[(key * 3 + 1) * output.width + (i % output.width)];
          })
        : output.values;
      const entry = moves.get(node) ?? moves.set(node, {}).get(node);
      entry[path] = { times, values, width: output.width, step: sampler.interpolation === "STEP" };
      first = Math.min(first, times[0]);
      last = Math.max(last, times[times.length - 1]);
    }
    if (!moves.size) return;
    if (bent)
      warnings.push(
        `the animation ${animation.name ?? number} has CUBICSPLINE keys: it is read through its keys in straight lines`,
      );
    const start = Number.isFinite(first) ? first : 0;
    const valueAt = (move, time) => {
      const { times, values, width, step } = move;
      const key = (i) => Array.from(values.subarray(i * width, i * width + width));
      const end = times.length - 1;
      if (time <= times[0]) return key(0);
      if (time >= times[end]) return key(end);
      let low = 0;
      let high = end;
      while (high - low > 1) {
        const middle = (low + high) >> 1;
        if (times[middle] <= time) low = middle;
        else high = middle;
      }
      if (step) return key(low);
      const share = (time - times[low]) / (times[high] - times[low] || 1);
      const a = key(low);
      const b = key(high);
      return width === 4 ? slerp(a, b, share) : a.map((value, i) => value + (b[i] - value) * share);
    };
    animations.push({
      name: animation.name ?? `animation${number}`,
      duration: Math.max(0, last - start),
      nodes: [...moves.keys()].map((node) => numberOf[node]),
      at: (seconds) => {
        const time = start + seconds;
        const locals = new Map();
        for (const [node, entry] of moves)
          locals.set(
            numberOf[node],
            localOf(
              said[node],
              entry.translation && valueAt(entry.translation, time),
              entry.rotation && valueAt(entry.rotation, time),
              entry.scale && valueAt(entry.scale, time),
            ),
          );
        return locals;
      },
    });
  });

  if (!groups.length)
    warnings.push("the file has no mesh of triangles: nothing to make a model of (a skeleton or animations alone?)");
  return {
    format: binary ? "glb" : "gltf",
    version: String(json.asset?.version ?? "2.0"),
    binary,
    generator: json.asset?.generator ?? null,
    groups,
    materials,
    images,
    libraries: [],
    meshes,
    nodes,
    joints: [...jointSet].sort((a, b) => a - b),
    animations,
    stand,
    axes: { up: axisName([1, 1]), front: axisName([2, 1]), said: "glTF's own" },
    unit: { metres: 1, said: "glTF's own: a metre" },
    box: measured(groups).box,
    warnings,
  };
}
