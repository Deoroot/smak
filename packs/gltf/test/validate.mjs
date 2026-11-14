// The points of the glTF 2.0 specification the pack relies on, checked on a .glb with no package: the
// container, the buffers and their views, the accessors (bounds, alignment, POSITION's min and max as they
// are), the indices in range, the primitives' attributes, the materials, the pictures (each PNG decoded), the
// nodes' tree and matrices, KHR_materials_unlit and KHR_lights_punctual. Written from the specification
// (registry.khronos.org/glTF/specs/2.0/glTF-2.0.html, sections 3.6 to 3.9 and 4.4; the extensions' READMEs),
// not from the pack's writer.
//
//   validateGlb(bytes)    `{ errors, json, bin, triangles(each) }`: `errors` sentences, empty when the file is whole
//   readGlbParts(bytes)   `{ json, bin }`, or a throw that says what is wrong with the container
import { unpng } from "../../../core/image.mjs";

const SIZES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const WIDTHS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const READ = { 5120: "getInt8", 5121: "getUint8", 5122: "getInt16", 5123: "getUint16", 5125: "getUint32", 5126: "getFloat32" };
const MOST = { 5121: 255, 5123: 65535 };
const MODES = ["OPAQUE", "MASK", "BLEND"];
const LIGHT_TYPES = ["directional", "point", "spot"];
const KNOWN = ["KHR_materials_unlit", "KHR_lights_punctual"];

/** A .glb's two chunks; a throw for a container the specification does not allow (4.4). */
export function readGlbParts(bytes) {
  const data = Buffer.from(bytes);
  if (data.length < 20 || data.readUInt32LE(0) !== 0x46546c67) throw new Error("not a .glb: no magic glTF");
  if (data.readUInt32LE(4) !== 2) throw new Error(`version ${data.readUInt32LE(4)}, not 2`);
  if (data.readUInt32LE(8) !== data.length) throw new Error(`the header says ${data.readUInt32LE(8)} bytes, the file is ${data.length}`); // prettier-ignore
  const chunks = [];
  for (let at = 12; at < data.length; ) {
    const length = data.readUInt32LE(at);
    if (length % 4) throw new Error(`chunk at ${at} is ${length} bytes, not a multiple of 4`);
    chunks.push({ kind: data.readUInt32LE(at + 4), bytes: data.subarray(at + 8, at + 8 + length) });
    at += 8 + length;
  }
  if (chunks[0]?.kind !== 0x4e4f534a) throw new Error("the first chunk is not JSON");
  if (chunks[1] && chunks[1].kind !== 0x004e4942) throw new Error("the second chunk is not BIN");
  return { json: JSON.parse(chunks[0].bytes.toString("utf8")), bin: chunks[1]?.bytes ?? null };
}

const multiply = (a, b) => {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
};
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** A node's local matrix (by columns) from `matrix` or translation, rotation (x, y, z, w) and scale. */
function localOf(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ]; // prettier-ignore
}
const applied = (m, [x, y, z], w = 1) => [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r] * w);

/** Every check of the module's header on `bytes`; `triangles(each)` walks the scene's triangles in the world. */
export function validateGlb(bytes) {
  const errors = [];
  const say = (line) => errors.push(line);
  let parts;
  try {
    parts = readGlbParts(bytes);
  } catch (error) {
    return { errors: [error.message], json: null, bin: null, triangles: () => {} };
  }
  const { json, bin } = parts;
  const list = (name) => json[name] ?? [];
  const has = (name, number) => Number.isInteger(number) && number >= 0 && number < list(name).length;
  if (json.asset?.version !== "2.0") say(`asset.version is ${json.asset?.version}, not "2.0"`);
  for (const name of ["meshes", "materials", "textures", "images", "accessors", "bufferViews", "buffers", "nodes", "samplers"]) if (json[name] && !json[name].length) say(`${name} is an empty list: it must be left out`); // prettier-ignore
  const used = new Set(json.extensionsUsed ?? []);
  for (const name of json.extensionsRequired ?? []) if (!used.has(name)) say(`extensionsRequired ${name} is not in extensionsUsed`);
  const found = new Set(JSON.stringify(json).match(/"(KHR_[A-Za-z_]+)"/g)?.map((name) => name.slice(1, -1)).filter((name) => KNOWN.includes(name)) ?? []); // prettier-ignore
  for (const name of found) if (!used.has(name)) say(`${name} is used and not in extensionsUsed`);

  // buffers and views (3.6.2)
  if (list("buffers").length !== 1 || list("buffers")[0].uri !== undefined) say("a .glb of the pack has one buffer, the BIN chunk, with no uri");
  else if (!bin || list("buffers")[0].byteLength > bin.length || bin.length - list("buffers")[0].byteLength > 3) say(`buffer 0 is ${list("buffers")[0].byteLength} bytes, the BIN chunk ${bin?.length ?? 0}`); // prettier-ignore
  list("bufferViews").forEach((view, n) => {
    if (!has("buffers", view.buffer)) return say(`bufferView ${n} names buffer ${view.buffer}, not there`);
    if ((view.byteOffset ?? 0) % 4) say(`bufferView ${n} starts at ${view.byteOffset}, not on 4`);
    if (!(view.byteLength >= 1) || (view.byteOffset ?? 0) + view.byteLength > list("buffers")[view.buffer].byteLength) say(`bufferView ${n} runs past its buffer`); // prettier-ignore
    if (view.byteStride !== undefined && (view.byteStride < 4 || view.byteStride > 252 || view.byteStride % 4)) say(`bufferView ${n} has stride ${view.byteStride}`); // prettier-ignore
    if (view.target !== undefined && ![34962, 34963].includes(view.target)) say(`bufferView ${n} has target ${view.target}`);
  });
  // accessors (3.6.2.4, 3.6.2.5): within their view, aligned, POSITION's bounds true
  const values = [];
  list("accessors").forEach((accessor, n) => {
    const size = SIZES[accessor.componentType];
    const width = WIDTHS[accessor.type];
    if (!size || !width) return say(`accessor ${n}: componentType ${accessor.componentType}, type ${accessor.type}`);
    if (!(accessor.count >= 1)) return say(`accessor ${n} has count ${accessor.count}`);
    if (!has("bufferViews", accessor.bufferView)) return say(`accessor ${n} names bufferView ${accessor.bufferView}, not there`);
    const view = list("bufferViews")[accessor.bufferView];
    const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    if ((accessor.byteOffset ?? 0) % size || offset % size) say(`accessor ${n} is not aligned to its ${size}-byte numbers`);
    const stride = view.byteStride ?? size * width;
    if ((accessor.byteOffset ?? 0) + stride * (accessor.count - 1) + size * width > view.byteLength) return say(`accessor ${n} runs past its bufferView`); // prettier-ignore
    if (accessor.normalized && ![5120, 5121, 5122, 5123].includes(accessor.componentType)) say(`accessor ${n} is normalized and of floats or uint32`); // prettier-ignore
    const read = new DataView(bin.buffer, bin.byteOffset + offset);
    const out = new Float64Array(accessor.count * width);
    for (let i = 0; i < accessor.count; i++)
      for (let k = 0; k < width; k++) out[i * width + k] = read[READ[accessor.componentType]](i * stride + k * size, true);
    if (accessor.normalized) for (let i = 0; i < out.length; i++) out[i] /= MOST[accessor.componentType] ?? 1;
    if (out.some((value) => !Number.isFinite(value))) say(`accessor ${n} holds a number that is not finite`);
    values[n] = { out, width };
  });
  const boundsOf = ({ out, width }) => {
    const min = new Array(width).fill(Infinity);
    const max = new Array(width).fill(-Infinity);
    out.forEach((value, at) => {
      min[at % width] = Math.min(min[at % width], value);
      max[at % width] = Math.max(max[at % width], value);
    });
    return { min, max };
  };

  // meshes and their primitives (3.7.2)
  list("meshes").forEach((mesh, m) => {
    if (!mesh.primitives?.length) say(`mesh ${m} has no primitive`);
    (mesh.primitives ?? []).forEach((primitive, p) => {
      const where = `mesh ${m} primitive ${p}`;
      const a = primitive.attributes ?? {};
      if ((primitive.mode ?? 4) !== 4) say(`${where}: mode ${primitive.mode}, the pack writes triangles`);
      if (!has("accessors", a.POSITION) || !values[a.POSITION]) return say(`${where}: no POSITION`);
      const position = list("accessors")[a.POSITION];
      const count = position.count;
      if (position.type !== "VEC3" || position.componentType !== 5126) say(`${where}: POSITION is not VEC3 float`);
      const true_ = boundsOf(values[a.POSITION]);
      if (!position.min || !position.max) say(`${where}: POSITION has no min and max (3.7.2.1 requires them)`);
      else if (true_.min.some((v, k) => Math.abs(v - position.min[k]) > 1e-5) || true_.max.some((v, k) => Math.abs(v - position.max[k]) > 1e-5)) say(`${where}: POSITION's min and max are not its bounds`); // prettier-ignore
      for (const [name, types, components] of [["NORMAL", ["VEC3"], [5126]], ["TEXCOORD_0", ["VEC2"], [5126, 5121, 5123]], ["COLOR_0", ["VEC3", "VEC4"], [5126, 5121, 5123]]]) { // prettier-ignore
        if (a[name] === undefined) continue;
        const accessor = list("accessors")[a[name]];
        if (!accessor || !values[a[name]]) { say(`${where}: ${name} names no accessor`); continue; } // prettier-ignore
        if (accessor.count !== count) say(`${where}: ${name} has ${accessor.count} elements, POSITION ${count}`);
        if (!types.includes(accessor.type) || !components.includes(accessor.componentType) || (accessor.componentType !== 5126 && !accessor.normalized)) say(`${where}: ${name} is ${accessor.type} of ${accessor.componentType}`); // prettier-ignore
        if (name === "NORMAL") for (let i = 0; i < count; i++) if (Math.abs(Math.hypot(...values[a[name]].out.subarray(i * 3, i * 3 + 3)) - 1) > 1e-3) { say(`${where}: normal ${i} is not of length 1`); break; } // prettier-ignore
        if (name === "COLOR_0" && values[a[name]].out.some((v) => v < 0 || v > 1)) say(`${where}: COLOR_0 outside 0 to 1`);
      }
      if (primitive.indices !== undefined) {
        const accessor = list("accessors")[primitive.indices];
        if (!accessor || !values[primitive.indices]) return say(`${where}: its indices name no accessor`);
        if (accessor.type !== "SCALAR" || ![5121, 5123, 5125].includes(accessor.componentType) || accessor.normalized) say(`${where}: indices are not unsigned whole numbers`); // prettier-ignore
        if (list("bufferViews")[accessor.bufferView]?.target !== 34963) say(`${where}: indices' view is not ELEMENT_ARRAY_BUFFER`);
        if (accessor.count % 3) say(`${where}: ${accessor.count} indices, not triangles`);
        if (values[primitive.indices].out.some((index) => index >= count)) say(`${where}: an index is past the ${count} corners`);
      }
      if (primitive.material !== undefined && !has("materials", primitive.material)) say(`${where}: material ${primitive.material} is not there`); // prettier-ignore
    });
  });
  // materials, textures, images (3.8, 3.9)
  list("materials").forEach((material, n) => {
    const pbr = material.pbrMetallicRoughness ?? {};
    if (pbr.baseColorTexture && !has("textures", pbr.baseColorTexture.index)) say(`material ${n}: its texture is not there`);
    if ((pbr.baseColorFactor ?? [1, 1, 1, 1]).some((v) => v < 0 || v > 1) || (pbr.baseColorFactor && pbr.baseColorFactor.length !== 4)) say(`material ${n}: baseColorFactor ${pbr.baseColorFactor}`); // prettier-ignore
    if (material.alphaMode !== undefined && !MODES.includes(material.alphaMode)) say(`material ${n}: alphaMode ${material.alphaMode}`);
    if (material.alphaCutoff !== undefined && material.alphaMode !== "MASK") say(`material ${n}: alphaCutoff without MASK`);
    if (material.extensions?.KHR_materials_unlit && Object.keys(material.extensions.KHR_materials_unlit).length) say(`material ${n}: KHR_materials_unlit is an empty object`); // prettier-ignore
  });
  list("textures").forEach((texture, n) => {
    if (!has("images", texture.source)) say(`texture ${n}: image ${texture.source} is not there`);
    if (texture.sampler !== undefined && !has("samplers", texture.sampler)) say(`texture ${n}: sampler ${texture.sampler} is not there`);
  });
  const pictures = list("images").map((image, n) => {
    if (!has("bufferViews", image.bufferView) || image.mimeType !== "image/png") return say(`image ${n}: a bufferView and mimeType image/png`), null; // prettier-ignore
    const view = list("bufferViews")[image.bufferView];
    try {
      return unpng(bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
    } catch (error) {
      return say(`image ${n} does not decode: ${error.message}`), null;
    }
  });
  // nodes: a tree, matrices or TRS, lights (3.5, KHR_lights_punctual)
  const parents = new Map();
  list("nodes").forEach((node, n) => {
    for (const child of node.children ?? []) {
      if (!has("nodes", child)) say(`node ${n}: child ${child} is not there`);
      else if (parents.has(child)) say(`node ${child} has two parents`);
      else parents.set(child, n);
    }
    if (node.matrix && (node.matrix.length !== 16 || node.translation || node.rotation || node.scale)) say(`node ${n}: a matrix of 16 and no TRS beside it`); // prettier-ignore
    if (node.matrix && Math.abs(node.matrix[3]) + Math.abs(node.matrix[7]) + Math.abs(node.matrix[11]) + Math.abs(node.matrix[15] - 1) > 1e-9) say(`node ${n}: its matrix's last row is not 0 0 0 1`); // prettier-ignore
    if (node.mesh !== undefined && !has("meshes", node.mesh)) say(`node ${n}: mesh ${node.mesh} is not there`);
    const light = node.extensions?.KHR_lights_punctual?.light;
    if (light !== undefined && !(light >= 0 && light < (json.extensions?.KHR_lights_punctual?.lights ?? []).length)) say(`node ${n}: light ${light} is not there`); // prettier-ignore
  });
  for (const root of json.scenes?.[json.scene ?? 0]?.nodes ?? []) if (parents.has(root)) say(`scene root ${root} has a parent`);
  (json.extensions?.KHR_lights_punctual?.lights ?? []).forEach((light, n) => {
    if (!LIGHT_TYPES.includes(light.type)) say(`light ${n}: type ${light.type}`);
    if ((light.color ?? [1, 1, 1]).some((v) => v < 0 || v > 1)) say(`light ${n}: color outside 0 to 1`);
    if (!(light.intensity >= 0)) say(`light ${n}: intensity ${light.intensity}`);
    if (light.range !== undefined && (!(light.range > 0) || light.type === "directional")) say(`light ${n}: range ${light.range}`);
    if (light.type === "spot") {
      const { innerConeAngle = 0, outerConeAngle = Math.PI / 4 } = light.spot ?? {};
      if (!(innerConeAngle >= 0 && innerConeAngle < outerConeAngle && outerConeAngle <= Math.PI / 2 + 1e-9)) say(`light ${n}: cones ${innerConeAngle} and ${outerConeAngle}`); // prettier-ignore
    }
  });

  /** Each triangle of the scene: `each({ corners (world, metres), uvs, colours, material, node })`. */
  const triangles = (each) => {
    const walk = (number, parent, depth) => {
      const node = list("nodes")[number];
      if (!node || depth > list("nodes").length) return;
      const world = multiply(parent, localOf(node));
      for (const primitive of list("meshes")[node.mesh]?.primitives ?? []) {
        const a = primitive.attributes;
        const p = values[a.POSITION];
        const uv = values[a.TEXCOORD_0];
        const colour = a.COLOR_0 === undefined ? null : values[a.COLOR_0];
        const index = primitive.indices === undefined ? null : values[primitive.indices].out;
        const total = index ? index.length : p.out.length / 3;
        for (let t = 0; t + 2 < total; t += 3) {
          const at = [0, 1, 2].map((k) => (index ? index[t + k] : t + k));
          each({
            corners: at.map((i) => applied(world, [...p.out.subarray(i * 3, i * 3 + 3)])),
            uvs: at.map((i) => (uv ? [uv.out[i * 2], uv.out[i * 2 + 1]] : [0, 0])),
            colours: colour ? at.map((i) => [...colour.out.subarray(i * colour.width, i * colour.width + 3)]) : null,
            material: list("materials")[primitive.material] ?? null,
            picture: pictures[list("textures")[list("materials")[primitive.material]?.pbrMetallicRoughness?.baseColorTexture?.index]?.source] ?? null, // prettier-ignore
            node: number,
          });
        }
      }
      for (const child of node.children ?? []) walk(child, world, depth + 1);
    };
    for (const root of json.scenes?.[json.scene ?? 0]?.nodes ?? []) walk(root, IDENTITY, 0);
  };
  return { errors, json, bin, triangles };
}
