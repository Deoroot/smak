// FBX: the file most bought models come in, read into the kit's triangles. An FBX file is a tree of named
// records, each with a list of values and records of its own; the scene is in two of them: `Objects` (every
// node, mesh, material, picture, bone binding and animation curve, each with a number) and `Connections` (which
// of them belongs to which, by those numbers).
//
//   parseFbx(buffer)   the tree as it is: { version, binary, nodes: [{ name, props, nodes }] }
//   readFbx(buffer)    the scene in the common shape of import-shape.mjs: every mesh as triangles, each
//                      node's place applied, stood up for GoldSrc, with its materials, skeleton and animations
//
// Read: binary FBX of versions 7.0 to 7.7 (records of 32 bit offsets, and of 64 bit ones from 7.5; arrays
// packed with zlib), and the text form of the same versions. Nothing here reads the disk.
import { inflateSync } from "node:zlib";
import {
  IDENTITY,
  mul,
  mulAll,
  apply,
  applyDir,
  det,
  inverse,
  normalsOf,
  moved,
  stretched,
  turned,
  ofRowsMovedLast,
  standingUp,
} from "./import-math.mjs";
import { creased, measured, axisName } from "./import-shape.mjs";

// ── the binary form ────────────────────────────────────────────────────────
/** How a binary file begins, and where its version is written after that (a number such as 7400). */
const MAGIC = "Kaydara FBX Binary  ";
const VERSION_AT = 23;
const HEADER_BYTES = 27;
/** From this version a record's three counts are 64 bit numbers. */
const WIDE_FROM = 7500;
/** The versions this reads: 7.0 to 7.7. */
const VERSION_LEAST = 7000;
const VERSION_MOST = 7799;
/** An array's header: how many values, how they are packed (1: zlib), and how many bytes that takes. */
const ARRAY_HEADER = 12;
const PACKED = 1;
/** The bytes one value of an array takes, by the letter of its kind. */
const ARRAY_WIDTH = { f: 4, d: 8, l: 8, i: 4, b: 1, c: 1 };
/** In a record's name, what parts an object's name from its class ("Cube\0\1Model"). */
const NAME_FROM_CLASS = "\u0000\u0001";

/** An array's bytes as numbers. The file is little-endian, as every machine Node runs on is. */
function arrayOf(kind, bytes, count) {
  // a typed array wants its bytes to begin at a multiple of its width: a copy does
  const own = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + count * ARRAY_WIDTH[kind]);
  if (kind === "d") return new Float64Array(own);
  if (kind === "f") return new Float32Array(own);
  if (kind === "i") return new Int32Array(own);
  if (kind === "l") return Float64Array.from(new BigInt64Array(own), Number);
  return new Uint8Array(own);
}

/** The tree of a binary file. */
function parseBinary(buffer, version) {
  const wide = version >= WIDE_FROM;
  const counts = wide ? 24 : 12;
  const count = (at) => (wide ? Number(buffer.readBigUInt64LE(at)) : buffer.readUInt32LE(at));
  const cut = (at, what) => {
    throw new Error(`readFbx: the file is cut short, or is not whole: ${what} at byte ${at} runs past its end`);
  };

  /** One value at `at`: [the value, where the next begins]. */
  const valueAt = (at) => {
    const kind = String.fromCharCode(buffer[at++]);
    if (kind === "Y") return [buffer.readInt16LE(at), at + 2];
    if (kind === "C") return [buffer[at] !== 0, at + 1];
    if (kind === "I") return [buffer.readInt32LE(at), at + 4];
    if (kind === "F") return [buffer.readFloatLE(at), at + 4];
    if (kind === "D") return [buffer.readDoubleLE(at), at + 8];
    if (kind === "L") {
      // an object's number may be longer than a JavaScript number holds whole: such a one stays a BigInt
      const long = buffer.readBigInt64LE(at);
      return [Number.isSafeInteger(Number(long)) ? Number(long) : long, at + 8];
    }
    if (kind === "S" || kind === "R") {
      const length = buffer.readUInt32LE(at);
      if (at + 4 + length > buffer.length) cut(at, "a text");
      const bytes = buffer.subarray(at + 4, at + 4 + length);
      return [kind === "S" ? bytes.toString("utf8") : bytes, at + 4 + length];
    }
    if (ARRAY_WIDTH[kind]) {
      const length = buffer.readUInt32LE(at);
      const packing = buffer.readUInt32LE(at + 4);
      const bytes = buffer.readUInt32LE(at + 8);
      if (at + ARRAY_HEADER + bytes > buffer.length) cut(at, "an array");
      const stored = buffer.subarray(at + ARRAY_HEADER, at + ARRAY_HEADER + bytes);
      const plain = packing === PACKED ? inflateSync(stored) : stored;
      if (plain.length < length * ARRAY_WIDTH[kind]) cut(at, "an array's values");
      return [arrayOf(kind, plain, length), at + ARRAY_HEADER + bytes];
    }
    throw new Error(`readFbx: a value of the kind "${kind}" at byte ${at - 1}: not one an FBX file has`);
  };

  /** The record at `at`: [the record, where the next begins]; null for the empty record that ends a list. */
  const recordAt = (at) => {
    if (at + counts + 1 > buffer.length) cut(at, "a record");
    const end = count(at);
    const values = count(at + counts / 3);
    const nameLength = buffer[at + counts];
    if (!end) return [null, at + counts + 1];
    if (end > buffer.length) cut(at, "a record");
    let next = at + counts + 1 + nameLength;
    const record = { name: buffer.toString("latin1", at + counts + 1, next), props: [], nodes: [] };
    for (let i = 0; i < values; i++) {
      const [value, after] = valueAt(next);
      record.props.push(value);
      next = after;
    }
    while (next < end) {
      const [inner, after] = recordAt(next);
      next = after;
      if (!inner) break;
      record.nodes.push(inner);
    }
    return [record, end];
  };

  const nodes = [];
  for (let at = HEADER_BYTES; at < buffer.length; ) {
    const [record, next] = recordAt(at);
    if (!record) break;
    nodes.push(record);
    at = next;
  }
  return nodes;
}

// ── the text form ──────────────────────────────────────────────────────────
/** The tree of a file in the text form: `Name: value, value { records }`, a comment from `;` to the line's end. */
function parseText(text) {
  let at = 0;
  const end = text.length;
  const isBlank = (letter) => letter === " " || letter === "\t" || letter === "\r";
  /** Past blanks on this line; with `lines`, past line ends and comments too. */
  const skip = (lines) => {
    while (at < end) {
      const letter = text[at];
      if (isBlank(letter) || (lines && letter === "\n")) at++;
      else if (lines && letter === ";") while (at < end && text[at] !== "\n") at++;
      else break;
    }
  };
  const bare = () => {
    const from = at;
    while (at < end && !/[\s,{}]/.test(text[at])) at++;
    return text.slice(from, at);
  };
  const value = () => {
    if (text[at] === '"') {
      const close = text.indexOf('"', at + 1);
      if (close < 0) throw new Error("readFbx: a text of the file is not closed");
      const said = text.slice(at + 1, close);
      at = close + 1;
      return said.replaceAll("&quot;", '"');
    }
    if (text[at] === "*") {
      // an array: *count { a: 1,2,3 }
      at++;
      const count = Number(bare());
      skip(true);
      if (text[at] !== "{") throw new Error("readFbx: an array of the file has no values");
      const close = text.indexOf("}", at);
      const inner = text.slice(at + 1, close < 0 ? end : close);
      at = close < 0 ? end : close + 1;
      const numbers = inner.slice(inner.indexOf(":") + 1).split(",");
      return Float64Array.from(count ? numbers : [], Number);
    }
    const word = bare();
    return word !== "" && Number.isFinite(Number(word)) ? Number(word) : word;
  };
  const records = () => {
    const list = [];
    for (;;) {
      skip(true);
      if (at >= end) return list;
      if (text[at] === "}") {
        at++;
        return list;
      }
      const colon = text.indexOf(":", at);
      if (colon < 0) return list;
      const record = { name: text.slice(at, colon).trim(), props: [], nodes: [] };
      at = colon + 1;
      for (;;) {
        skip(false);
        if (at >= end || text[at] === "\n" || text[at] === "{" || text[at] === "}" || text[at] === ";") break;
        record.props.push(value());
        skip(false);
        if (text[at] !== ",") break;
        at++;
        // a list of values goes on in the next line after a comma
        skip(true);
      }
      skip(false);
      if (text[at] === "{") {
        at++;
        record.nodes = records();
      }
      list.push(record);
    }
  };
  return records();
}

/**
 * An FBX file as the tree it is: { version, binary, nodes }. A record is { name, props, nodes }: `props` its
 * values (numbers, texts, true and false, bytes, and arrays of numbers as typed arrays), `nodes` the records
 * inside it. It throws on a file that is not FBX, on a version this does not read and on one cut short.
 */
export function parseFbx(buffer) {
  const bytes = Buffer.from(buffer.buffer ?? buffer, buffer.byteOffset ?? 0, buffer.length);
  if (bytes.toString("latin1", 0, MAGIC.length) === MAGIC) {
    const version = bytes.readUInt32LE(VERSION_AT);
    if (version < VERSION_LEAST || version > VERSION_MOST)
      throw new Error(
        `readFbx: a binary FBX of version ${version / 1000}: 7.0 to 7.7 are read. Save it again from the tool that made it (Blender writes 7.4)`,
      );
    return { version, binary: true, nodes: parseBinary(bytes, version) };
  }
  const text = bytes.toString("utf8");
  if (!/FBXHeaderExtension\s*:/.test(text.slice(0, 4096)))
    throw new Error(
      'readFbx: not an FBX file: a binary one begins "Kaydara FBX Binary", a text one with FBXHeaderExtension',
    );
  const nodes = parseText(text);
  const header = nodes.find((node) => node.name === "FBXHeaderExtension");
  const version = Number(header?.nodes.find((node) => node.name === "FBXVersion")?.props[0] ?? 0);
  if (version < VERSION_LEAST || version > VERSION_MOST)
    throw new Error(
      `readFbx: a text FBX of version ${version / 1000}: 7.0 to 7.7 are read (an older one keeps its scene another way)`,
    );
  return { version, binary: false, nodes };
}

// ── the scene ──────────────────────────────────────────────────────────────
/** The first record of that name inside another, and all of them. */
const inside = (record, name) => record?.nodes.find((node) => node.name === name);
const allInside = (record, name) => (record ? record.nodes.filter((node) => node.name === name) : []);
/** The first value of the record of that name inside another. */
const valueIn = (record, name) => inside(record, name)?.props[0];

/**
 * A record's properties, by name: each is its values (a place is three numbers, a number one). They are the
 * `P` records of its `Properties70`: name, kind, a label, flags, then the values.
 */
function propertiesOf(record) {
  const properties = new Map();
  for (const property of allInside(inside(record, "Properties70"), "P"))
    properties.set(property.props[0], property.props.slice(4));
  return properties;
}

/** An object's name without its class: "Cube\0\1Model" in a binary file, "Model::Cube" in a text one. */
function nameOf(written) {
  const text = String(written ?? "");
  const cut = text.indexOf(NAME_FROM_CLASS);
  if (cut >= 0) return text.slice(0, cut);
  const colons = text.indexOf("::");
  return colons >= 0 ? text.slice(colons + 2) : text;
}

/** The orders the three turns of a node are done in, by the number of its `RotationOrder`. */
const ROTATION_ORDERS = ["xyz", "xzy", "yzx", "yxz", "zxy", "zyx"];
/** FBX counts time in these, 46186158000 to a second. */
const TICKS_A_SECOND = 46186158000;
/** A cluster's weight under this binds nothing. */
const NO_WEIGHT = 1e-6;
/** What a corner without texture coordinates is given: the picture's middle. */
const NO_COORDINATES = [0.5, 0.5];
/** The property of a material that names the picture of its colour, by the tools that write one. */
const COLOUR_PROPERTY = /diffuse|base_?colou?r/i;

/**
 * How a layer of a mesh (normals, texture coordinates, materials) gives its values: a function of a corner's
 * number, its point's and its polygon's that returns where its values begin in `values`, or -1 for none.
 */
function layerReader(layer, indexName, width, valueCount) {
  const mapping = String(valueIn(layer, "MappingInformationType") ?? "");
  const reference = String(valueIn(layer, "ReferenceInformationType") ?? "Direct");
  const index = reference === "Direct" ? null : inside(layer, indexName)?.props[0];
  const by =
    mapping === "ByPolygonVertex"
      ? 0
      : /^By(Vertice|Vertex|ControlPoint)$/.test(mapping)
        ? 1
        : mapping === "ByPolygon"
          ? 2
          : mapping === "AllSame"
            ? 3
            : -1;
  if (by < 0) return null;
  return (corner, point, polygon) => {
    const key = by === 0 ? corner : by === 1 ? point : by === 2 ? polygon : 0;
    const number = index ? index[key] : key;
    return number >= 0 && (number + 1) * width <= valueCount ? number * width : -1;
  };
}

/**
 * An FBX file read into the common shape of import-shape.mjs: see there for what comes back. Besides,
 * `version` (7400) and `binary`.
 *
 * What is read
 *   - every mesh (`Geometry` of the kind Mesh under a `Model`): its polygons cut into fans of triangles (the
 *     end of a polygon is the corner written as -(number) - 1), points, the first set of texture coordinates
 *     and the normals in each of the ways a layer gives them (by corner, by point, by polygon or one for all;
 *     direct or through an index), and each polygon's material (`LayerElementMaterial`). A mesh under several
 *     nodes is read once for each
 *   - each node's place: `Lcl Translation`, `Lcl Rotation` in its `RotationOrder`, `Lcl Scaling`, with
 *     `PreRotation`, `PostRotation`, the pivots and offsets, through its parents; and the mesh's own
 *     `GeometricTranslation`, `GeometricRotation`, `GeometricScaling`. A node that mirrors (a scale under 0)
 *     has its faces turned back the right way round
 *   - `GlobalSettings`: `UpAxis`, `FrontAxis` (with their signs) and `UnitScaleFactor`. The scene is turned
 *     so that its up is +z and its front +x; the points stay in the file's units, and `unit.metres` says what
 *     one is (a `UnitScaleFactor` of 1 is a centimetre)
 *   - materials: their names, `DiffuseColor`, and the file name of the picture joined to it (`picture`: the
 *     `RelativeFilename`, else the `FileName`); a picture kept inside the file (`Video` with `Content`) is in
 *     `images`
 *   - skins (`Deformer` Skin and Cluster): each corner's `weights` and the bone that weighs most on it
 *     (`node`); a skinned point is where its bones hold it as the scene rests
 *   - animations (`AnimationStack`, `AnimationLayer`, `AnimationCurveNode`, `AnimationCurve`): the curves of
 *     a node's `Lcl Translation`, `Lcl Rotation` and `Lcl Scaling`, read between their keys in a straight
 *     line (a curve's own bends between keys are not: tools that bake a key a frame lose nothing)
 * What is not: cameras, lights, shape keys (blend shapes), NURBS and patches, a second set of texture
 * coordinates, vertex colours, how a node's scale is handed to its children (`InheritType`: every node is read
 * as passing on all of it), layers of animation beyond a stack's first, and constraints.
 * Options:
 *   up, front   [axis, sign] each (axis 0, 1, 2; sign 1, -1): the file's own axes, for one whose
 *               `GlobalSettings` say them wrong
 */
export function readFbx(buffer, options = {}) {
  const { version, binary, nodes: tree } = parseFbx(buffer);
  const top = (name) => tree.find((node) => node.name === name);
  const warnings = [];

  // ── what the file says of itself
  const settings = propertiesOf(top("GlobalSettings"));
  const setting = (name, otherwise) => {
    const value = settings.get(name)?.[0];
    return typeof value === "number" ? value : otherwise;
  };
  const upSaid = [setting("UpAxis", 1), setting("UpAxisSign", 1) < 0 ? -1 : 1];
  const frontSaid = [setting("FrontAxis", 2), setting("FrontAxisSign", 1) < 0 ? -1 : 1];
  const up = options.up ?? upSaid;
  const front = options.front ?? frontSaid;
  if (up[0] === front[0])
    throw new Error(`readFbx: the file's up (${axisName(up)}) and its front (${axisName(front)}) are one axis`);
  const stand = standingUp(up, front);
  const centimetres = setting("UnitScaleFactor", 1);

  // ── the objects and what joins them
  const objects = new Map();
  for (const record of top("Objects")?.nodes ?? []) {
    const id = String(record.props[0]);
    objects.set(id, {
      id,
      kind: record.name,
      name: nameOf(record.props[1]),
      type: String(record.props[2] ?? ""),
      record,
    });
  }
  // the values a kind of object has when its record says nothing
  const defaults = new Map();
  for (const type of allInside(top("Definitions"), "ObjectType")) {
    const template = inside(type, "PropertyTemplate");
    if (template) defaults.set(String(type.props[0]), propertiesOf(template));
  }
  /** below[id]: the objects joined under it, in the file's order; above[id]: the ones it is joined under. */
  const below = new Map();
  const above = new Map();
  for (const join of allInside(top("Connections"), "C")) {
    const [, child, parent, property] = join.props;
    const link = { child: String(child), parent: String(parent), property: property ?? null };
    (below.get(link.parent) ?? below.set(link.parent, []).get(link.parent)).push(link);
    (above.get(link.child) ?? above.set(link.child, []).get(link.child)).push(link);
  }
  const under = (id, kind) =>
    (below.get(id) ?? [])
      .map((link) => ({ ...link, object: objects.get(link.child) }))
      .filter((link) => link.object?.kind === kind);

  // ── the nodes: every Model, a parent before its children
  const models = [...objects.values()].filter((object) => object.kind === "Model");
  for (const model of models) {
    const own = propertiesOf(model.record);
    const template = defaults.get("Model");
    model.property = (name, otherwise) => own.get(name) ?? template?.get(name) ?? otherwise;
    const parent = (above.get(model.id) ?? []).find((link) => objects.get(link.parent)?.kind === "Model");
    model.parent = parent ? objects.get(parent.parent) : null;
  }
  const ordered = [];
  const placedIn = new Set();
  const place = (model, depth = 0) => {
    if (placedIn.has(model)) return;
    // a file whose nodes are joined in a ring is not a tree: the ring is cut where it is met again
    if (model.parent && depth < models.length) place(model.parent, depth + 1);
    placedIn.add(model);
    model.number = ordered.push(model) - 1;
  };
  models.forEach((model) => place(model));

  /**
   * A node's own matrix from its parent, of its place, its three angles and its scale: the pivots, offsets
   * and the turns before and after are the node's own and do not change as it is animated.
   */
  const localOf = (model, translation, rotation, scaling) => {
    const three = (name, otherwise) => {
      const value = model.property(name);
      return value && value.length >= 3 ? value.slice(0, 3).map(Number) : otherwise;
    };
    const order = ROTATION_ORDERS[model.property("RotationOrder")?.[0] ?? 0] ?? "xyz";
    const rotationPivot = three("RotationPivot", [0, 0, 0]);
    const scalingPivot = three("ScalingPivot", [0, 0, 0]);
    const back = (v) => v.map((t) => -t);
    return mulAll(
      moved(translation),
      moved(three("RotationOffset", [0, 0, 0])),
      moved(rotationPivot),
      turned(three("PreRotation", [0, 0, 0])),
      turned(rotation, order),
      inverse(turned(three("PostRotation", [0, 0, 0]))),
      moved(back(rotationPivot)),
      moved(three("ScalingOffset", [0, 0, 0])),
      moved(scalingPivot),
      stretched(scaling),
      moved(back(scalingPivot)),
    );
  };
  const resting = (model, name, otherwise) => {
    const value = model.property(name);
    return value && value.length >= 3 ? value.slice(0, 3).map(Number) : otherwise;
  };
  for (const model of ordered) {
    model.translation = resting(model, "Lcl Translation", [0, 0, 0]);
    model.rotation = resting(model, "Lcl Rotation", [0, 0, 0]);
    model.scaling = resting(model, "Lcl Scaling", [1, 1, 1]);
    model.rest = localOf(model, model.translation, model.rotation, model.scaling);
    model.world = model.parent ? mul(model.parent.world, model.rest) : model.rest;
    const inherit = model.property("InheritType")?.[0] ?? 0;
    if (inherit === 2 && model.parent) {
      const s = model.parent.scaling;
      if (Math.abs(s[0] - 1) + Math.abs(s[1] - 1) + Math.abs(s[2] - 1) > 1e-6)
        warnings.push(
          `the node ${model.name} is marked not to take its parent's scale (InheritType 2), and its parent ${model.parent.name} has one: it is read as taking it, and may be the wrong size`,
        );
    }
  }

  // ── materials and their pictures
  const images = [];
  const materialOf = new Map();
  const materials = [];
  const taken = new Set();
  for (const object of objects.values()) {
    if (object.kind !== "Material") continue;
    const properties = propertiesOf(object.record);
    const colour = properties.get("DiffuseColor") ?? properties.get("Diffuse");
    const textures = under(object.id, "Texture");
    const worn = textures.find((link) => COLOUR_PROPERTY.test(String(link.property ?? ""))) ?? textures[0];
    let picture = null;
    let image;
    if (worn) {
      const record = worn.object.record;
      picture = String(valueIn(record, "RelativeFilename") || valueIn(record, "FileName") || "") || null;
      const video = under(worn.object.id, "Video")[0]?.object.record;
      const content = valueIn(video, "Content");
      if (content instanceof Uint8Array && content.length) {
        const name = String(valueIn(video, "RelativeFilename") || valueIn(video, "Filename") || picture || "");
        image = images.push({ name, mime: mimeOf(content), bytes: Buffer.from(content) }) - 1;
      }
    }
    // two materials of one name are told apart: a mesh names its material by that name from here on
    let name = object.name;
    for (let nth = 2; taken.has(name); nth++) name = `${object.name}.${nth}`;
    taken.add(name);
    const material = {
      name,
      colour: colour && colour.length >= 3 ? colour.slice(0, 3).map((v) => Math.min(1, Math.max(0, v))) : null,
      picture,
      ...(image === undefined ? {} : { image }),
    };
    materialOf.set(object.id, material);
    materials.push(material);
  }

  // ── skins: for each mesh, what binds each of its points
  /** geometry id -> for each point, [[{ bone, toBone: the matrix from the mesh to the bone }, weight], ...] */
  const bindingsOf = (geometryId, pointCount) => {
    const skins = under(geometryId, "Deformer").filter((link) => link.object.type === "Skin");
    if (!skins.length) return null;
    const bindings = Array.from({ length: pointCount }, () => []);
    let bound = 0;
    for (const skin of skins)
      for (const cluster of under(skin.child, "Deformer")) {
        const bone = under(cluster.child, "Model")[0]?.object;
        const indexes = valueIn(cluster.object.record, "Indexes");
        const weights = valueIn(cluster.object.record, "Weights");
        const transform = valueIn(cluster.object.record, "Transform");
        if (!bone || !indexes || !weights) continue;
        // one for all the points of the cluster: the matrix from the mesh to the scene by this bone at rest
        const by = { bone, toBone: transform?.length === 16 ? ofRowsMovedLast(transform) : IDENTITY };
        for (let i = 0; i < indexes.length; i++) {
          if (!(weights[i] > NO_WEIGHT) || !bindings[indexes[i]]) continue;
          bindings[indexes[i]].push([by, weights[i]]);
          bound++;
        }
      }
    return bound ? bindings : null;
  };

  // ── the meshes
  const groups = [];
  const meshes = [];
  const jointSet = new Set();
  for (const model of ordered)
    for (const { object: geometry } of under(model.id, "Geometry")) {
      const points = valueIn(geometry.record, "Vertices");
      const polygonCorners = valueIn(geometry.record, "PolygonVertexIndex");
      if (geometry.type !== "Mesh" || !points || !polygonCorners) {
        if (geometry.type && geometry.type !== "Mesh")
          warnings.push(`${model.name}: a ${geometry.type} is not a mesh of polygons, and is passed over`);
        continue;
      }
      const pointCount = Math.floor(points.length / 3);
      const worn = under(model.id, "Material").map((link) => materialOf.get(link.child)?.name ?? "");
      const geometric = mulAll(
        moved(resting(model, "GeometricTranslation", [0, 0, 0])),
        turned(resting(model, "GeometricRotation", [0, 0, 0])),
        stretched(resting(model, "GeometricScaling", [1, 1, 1])),
      );
      const toScene = mulAll(stand, model.world, geometric);
      const normalsToScene = normalsOf(toScene);
      // a mirror turns every face inside out: its corners are taken the other way round
      const mirrored = det(toScene) < 0;

      const uvLayers = allInside(geometry.record, "LayerElementUV");
      const uvValues = valueIn(uvLayers[0], "UV");
      const uvAt = uvValues && layerReader(uvLayers[0], "UVIndex", 2, uvValues.length);
      const normalLayer = inside(geometry.record, "LayerElementNormal");
      const normalValues = valueIn(normalLayer, "Normals");
      const normalAt = normalValues && layerReader(normalLayer, "NormalsIndex", 3, normalValues.length);
      const materialLayer = inside(geometry.record, "LayerElementMaterial");
      const materialValues = valueIn(materialLayer, "Materials");
      const materialAt = materialValues && layerReader(materialLayer, "", 1, materialValues.length);
      if (uvLayers.length > 1)
        warnings.push(
          `${model.name}: ${uvLayers.length} sets of texture coordinates: the first is read (${nameOf(valueIn(uvLayers[0], "Name")) || "unnamed"})`,
        );

      // a skinned point: where its bones hold it as the scene rests, and the bone that weighs most
      const bindings = bindingsOf(geometry.id, pointCount);
      const held = new Map();
      const heldAt = (point) => {
        if (held.has(point)) return held.get(point);
        const own = [points[point * 3], points[point * 3 + 1], points[point * 3 + 2]];
        const binding = bindings?.[point];
        let result;
        if (!binding?.length) result = { p: apply(toScene, own), node: model.number, to: toScene, weights: null };
        else {
          const sorted = [...binding].sort((a, b) => b[1] - a[1]);
          const total = sorted.reduce((sum, [, weight]) => sum + weight, 0);
          const p = [0, 0, 0];
          for (const [by, weight] of sorted) {
            by.to ??= mulAll(stand, by.bone.world, by.toBone, geometric);
            const there = apply(by.to, own);
            for (let a = 0; a < 3; a++) p[a] += (there[a] * weight) / total;
            jointSet.add(by.bone.number);
          }
          result = {
            p,
            node: sorted[0][0].bone.number,
            to: sorted[0][0].to,
            weights: sorted.map(([by, weight]) => [by.bone.number, weight / total]),
          };
        }
        held.set(point, result);
        return result;
      };
      const normalMatrices = new Map();
      const normalsBy = (to) => normalMatrices.get(to) ?? normalMatrices.set(to, normalsOf(to)).get(to);

      const byMaterial = new Map();
      let polygon = 0;
      let first = 0;
      let triangles = 0;
      let outOfRange = 0;
      const cornerOf = (corner) => {
        const written = polygonCorners[corner];
        const point = written < 0 ? -written - 1 : written;
        if (point >= pointCount) return null;
        const at = heldAt(point);
        const uvFrom = uvAt ? uvAt(corner, point, polygon) : -1;
        const normalFrom = normalAt ? normalAt(corner, point, polygon) : -1;
        // FBX counts a picture from its bottom left, the kit from its top left
        const uv = Object.assign(
          uvFrom >= 0 ? [uvValues[uvFrom], 1 - uvValues[uvFrom + 1]] : [...NO_COORDINATES],
          { given: uvFrom >= 0 },
        );
        let n = null;
        if (normalFrom >= 0) {
          const own = [normalValues[normalFrom], normalValues[normalFrom + 1], normalValues[normalFrom + 2]];
          const there = applyDir(at.weights ? normalsBy(at.to) : normalsToScene, own);
          const length = Math.hypot(...there);
          n = length > 0 ? there.map((t) => t / length) : null;
        }
        return { p: at.p, uv, n, node: at.node, ...(at.weights ? { weights: at.weights } : {}) };
      };
      for (let corner = 0; corner < polygonCorners.length; corner++) {
        if (polygonCorners[corner] >= 0) continue;
        // the polygon runs from `first` to here: a fan from its first corner
        const corners = [];
        for (let each = first; each <= corner; each++) corners.push(cornerOf(each));
        const materialFrom = materialAt ? materialAt(first, 0, polygon) : -1;
        const material = worn[materialFrom >= 0 ? materialValues[materialFrom] : 0] ?? "";
        if (corners.includes(null)) outOfRange++;
        else if (corners.length >= 3) {
          const face = creased(corners);
          const list = byMaterial.get(material) ?? byMaterial.set(material, []).get(material);
          for (let i = 1; i + 1 < face.length; i++) {
            list.push(mirrored ? [face[0], face[i + 1], face[i]] : [face[0], face[i], face[i + 1]]);
            triangles++;
          }
        }
        first = corner + 1;
        polygon++;
      }
      if (outOfRange)
        warnings.push(`${model.name}: ${outOfRange} polygons name points the mesh has not got, and are left out`);
      for (const [material, tris] of byMaterial) groups.push({ object: model.name, group: "", material, tris });
      meshes.push({
        name: model.name,
        node: model.number,
        triangles,
        points: pointCount,
        materials: [...byMaterial.keys()],
        skinned: Boolean(bindings),
        uvSets: uvLayers.length,
      });
    }

  // ── animations
  const animations = [];
  for (const stack of objects.values()) {
    if (stack.kind !== "AnimationStack") continue;
    const layers = under(stack.id, "AnimationLayer");
    if (layers.length > 1)
      warnings.push(`the animation ${stack.name} has ${layers.length} layers: the first is read`);
    if (!layers.length) continue;
    /** model -> { T, R, S }: each three curves or null, with the value a channel has when it has no curve */
    const moves = new Map();
    let last = 0;
    let firstKey = Infinity;
    for (const { object: curveNode } of under(layers[0].child, "AnimationCurveNode")) {
      const target = (above.get(curveNode.id) ?? []).find(
        (link) => objects.get(link.parent)?.kind === "Model" && /^Lcl /.test(String(link.property ?? "")),
      );
      if (!target) continue;
      const model = objects.get(target.parent);
      const channel = { "Lcl Translation": "T", "Lcl Rotation": "R", "Lcl Scaling": "S" }[target.property];
      if (!channel) continue;
      const stated = propertiesOf(curveNode.record);
      const curves = [null, null, null];
      for (const link of under(curveNode.id, "AnimationCurve")) {
        const axis = ["d|X", "d|Y", "d|Z"].indexOf(String(link.property));
        const times = valueIn(link.object.record, "KeyTime");
        const values = valueIn(link.object.record, "KeyValueFloat");
        if (axis < 0 || !times?.length || !values?.length) continue;
        curves[axis] = { times: Float64Array.from(times, (t) => t / TICKS_A_SECOND), values };
        firstKey = Math.min(firstKey, curves[axis].times[0]);
        last = Math.max(last, curves[axis].times[curves[axis].times.length - 1]);
      }
      const still = { T: model.translation, R: model.rotation, S: model.scaling }[channel];
      const fallback = ["d|X", "d|Y", "d|Z"].map((name, axis) => {
        const value = stated.get(name)?.[0];
        return typeof value === "number" ? value : still[axis];
      });
      const entry = moves.get(model) ?? moves.set(model, {}).get(model);
      entry[channel] = { curves, fallback };
    }
    if (!moves.size) continue;
    const start = Number.isFinite(firstKey) ? firstKey : 0;
    const valueAt = (curve, time, otherwise) => {
      if (!curve) return otherwise;
      const { times, values } = curve;
      if (time <= times[0]) return values[0];
      const end = times.length - 1;
      if (time >= times[end]) return values[end];
      // the last key at or before `time`, found by halving
      let low = 0;
      let high = end;
      while (high - low > 1) {
        const middle = (low + high) >> 1;
        if (times[middle] <= time) low = middle;
        else high = middle;
      }
      const share = (time - times[low]) / (times[high] - times[low] || 1);
      return values[low] + (values[high] - values[low]) * share;
    };
    const three = (model, entry, channel, time) => {
      const still = { T: model.translation, R: model.rotation, S: model.scaling }[channel];
      const move = entry[channel];
      if (!move) return still;
      return [0, 1, 2].map((axis) => valueAt(move.curves[axis], time, move.fallback[axis]));
    };
    animations.push({
      name: stack.name,
      duration: Math.max(0, last - start),
      nodes: [...moves.keys()].map((model) => model.number),
      at: (seconds) => {
        const time = start + seconds;
        const locals = new Map();
        for (const [model, entry] of moves)
          locals.set(
            model.number,
            localOf(model, three(model, entry, "T", time), three(model, entry, "R", time), three(model, entry, "S", time)),
          );
        return locals;
      },
    });
  }

  if (!groups.length)
    warnings.push("the file has no mesh of polygons: nothing to make a model of (a skeleton or animations alone?)");
  return {
    format: "fbx",
    version,
    binary,
    groups,
    materials,
    images,
    libraries: [],
    meshes,
    nodes: ordered.map((model) => ({
      name: model.name,
      parent: model.parent ? model.parent.number : -1,
      kind: model.type,
      rest: model.rest,
    })),
    joints: [...jointSet].sort((a, b) => a - b),
    animations,
    stand,
    axes: {
      up: axisName(up),
      front: axisName(front),
      said: options.up || options.front ? "told" : settings.has("UpAxis") ? "GlobalSettings" : "not said: FBX's own (+y up)",
    },
    unit: {
      metres: centimetres / 100,
      said: settings.has("UnitScaleFactor") ? `UnitScaleFactor ${+centimetres.toFixed(6)}` : "not said: a centimetre",
    },
    box: measured(groups).box,
    warnings,
  };
}

/** What kind of picture some bytes are, by how they begin. */
function mimeOf(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
  return "application/octet-stream";
}
