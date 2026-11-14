// A compiled map and the studio models its entities place, written as one glTF 2.0 file (.glb) that another
// engine opens (Godot 4, Blender, three.js). An optional pack: it imports the kit, the kit never imports it.
//
//   mapGlb(bytes, { folders })   `{ glb, facts }`: the file's bytes, and what went into it
//
// What the file holds (README.md says why each is so):
//   the world and each brush entity   a mesh each, one primitive per material, a material per texture (and per
//                                     way it is drawn: opaque, masked, faded), the textures inside as PNG.
//                                     Sky and tools' textures (clip, origin, null, hint, skip, aaatrigger) are
//                                     left out, and so is an entity the game never draws (a trigger): its node
//                                     stays, empty, with its name and keys
//   the baked light                   COLOR_0 on the world's corners, each face cut on its lightmap's grid (a
//                                     corner on every sample), the materials unlit (KHR_materials_unlit): what
//                                     Godot and Blender show on import is texture x lightmap, as the game draws
//   the lights                        light, light_spot and light_environment as KHR_lights_punctual
//   the props                         each studio model the kit draws for an entity (figuresOf), one mesh for
//                                     every entity that shows the same model in the same pose, a node each at
//                                     its origin and angles; no skeleton, no animation
//   extras                            on each entity's node: its number, classname, targetname, origin (in the
//                                     map's units) and every key
// Axes: GoldSrc is +z up and right-handed, glTF +y up and right-handed: (x, y, z) is written (x, z, -y), a
// turn, never a mirror, so faces keep their winding. 39.37 units are a metre, as the kit's importer takes.
import { readBsp, facePolygon, faceNormal, faceLightmap, embeddedTexture, LUXEL } from "../../core/maps/bsp.mjs";
import { textureKind, HOLE } from "../../core/maps/miptex.mjs";
import { texturesFor } from "../../core/maps/wad.mjs";
import { valueOf, asObject } from "../../core/maps/entities.mjs";
import { png } from "../../core/image.mjs";
import { bytesOf } from "../../core/pixels.mjs";
import { readStudio } from "../../core/studio-file.mjs";
import { UNITS_A_METRE } from "../../core/import-shape.mjs";
import { posed, TEXTURE } from "../../make/render.mjs";
import { FRONT } from "../../make/mesh.mjs";
import { figuresOf, turnOf } from "../../make/maps/figures.mjs";
import { thingsOf } from "../../check/maps/draw.mjs";
import { stylesCounted } from "../../check/maps/light.mjs";

/** What a light sample is multiplied by before it multiplies the texture: draw.mjs's BRIGHTNESS, the game's look. */
const BRIGHTNESS = 1.55;
/** hlrad's defaults (sdHLRAD qrad.h, lightmap.cpp): light is scaled by 2 and then by a gamma of 0.55 into a byte. */
const RAD_SCALE = 2;
/** A light dimmer than this share of white is past its range (1 of 256 levels). */
const LEAST_LIGHT = 1 / 256;
/** A corner this near a line of the light's grid (texels) is on it; corners this near each other (units) are one. */
const ON_LINE = 0.01;
/** glTF's numbers for its kinds of number and buffer. */
const FLOAT = 5126;
const UBYTE = 5121;
const USHORT = 5123;
const UINT = 5125;
const VERTICES = 34962;
const INDICES = 34963;
const LINEAR = 9729;
const LINEAR_MIPMAP_LINEAR = 9987;
const REPEAT = 10497;
/** The render modes whose `renderamt` fades a brush entity (draw.mjs FADING_MODES), and the one with holes. */
const FADING = [1, 2, 3, 5];
const HOLES_MODE = 4;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

/** A point or a direction of the map in glTF's axes, in metres (a direction: `scale` 1). */
const toGltf = ([x, y, z], scale = 1 / UNITS_A_METRE) => [x * scale, z * scale, -y * scale];
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const dotted = (axis, p) => axis[0] * p[0] + axis[1] * p[1] + axis[2] * p[2] + axis[3];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => v.map((value) => value / (Math.hypot(...v) || 1));

/** A convex polygon cut where `value` crosses `at`: [the part under, the part over] (either may be empty). */
function split(polygon, value, at) {
  const under = [];
  const over = [];
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    // a corner within ON_LINE of the line is on it: no sliver of a triangle is cut off beside it
    const a = Math.abs(value(p) - at) < ON_LINE ? 0 : value(p) - at;
    const b = Math.abs(value(q) - at) < ON_LINE ? 0 : value(q) - at;
    if (a <= 0) under.push(p);
    if (a >= 0) over.push(p);
    if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
      const cut = p.map((v, k) => v + ((q[k] - v) * a) / (a - b));
      under.push(cut);
      over.push(cut);
    }
  });
  return [under, over].map((part) => (part.length >= 3 ? part : []));
}

/** A face cut along the lines of its lightmap's samples (every LUXEL texels from its origin), as convex pieces. */
function cells(polygon, texinfo, light) {
  let pieces = [polygon];
  for (const [axis, origin] of [[texinfo.s, light.originS], [texinfo.t, light.originT]]) {
    const value = (p) => dotted(axis, p);
    const values = polygon.map(value);
    const first = Math.floor((Math.min(...values) - origin) / LUXEL) + 1;
    const last = Math.ceil((Math.max(...values) - origin) / LUXEL) - 1;
    for (let k = first; k <= last; k++)
      pieces = pieces.flatMap((piece) => split(piece, value, origin + k * LUXEL)).filter((piece) => piece.length);
  }
  return pieces;
}

/** The light at a point of a face, sampled between its four nearest samples: linear [r, g, b], 0 to 1. */
function lightAt(light, texinfo, p) {
  const u = Math.min(light.width - 1, Math.max(0, (dotted(texinfo.s, p) - light.originS) / LUXEL));
  const v = Math.min(light.height - 1, Math.max(0, (dotted(texinfo.t, p) - light.originT) / LUXEL));
  const [x, y] = [Math.floor(u), Math.floor(v)];
  const [x2, y2] = [Math.min(light.width - 1, x + 1), Math.min(light.height - 1, y + 1)];
  const [fx, fy] = [u - x, v - y];
  const at = (i, j, c) => light.rgb[(j * light.width + i) * 3 + c];
  return [0, 1, 2].map((c) => {
    const top = at(x, y, c) * (1 - fx) + at(x2, y, c) * fx;
    const bottom = at(x, y2, c) * (1 - fx) + at(x2, y2, c) * fx;
    return linear(Math.min(1, ((top * (1 - fy) + bottom * fy) * BRIGHTNESS) / 255));
  });
}

/** A face's light as the game starts: its styles that count added up (draw.mjs lightOf), or null. */
function faceLight(bsp, face, counted) {
  const light = faceLightmap(bsp, face);
  const wanted = light?.styles.filter((each) => counted(each.style)) ?? [];
  if (!wanted.length) return null;
  const rgb = new Uint8ClampedArray(wanted[0].rgb.length);
  for (const each of wanted) for (let at = 0; at < rgb.length; at++) rgb[at] += each.rgb[at];
  return { ...light, rgb };
}

/** A texture as RGBA: index 255 a hole when `holes` (its colour the mean of the rest, so no blue fringe). */
function rgbaOf({ width, height, pixels, palette }, holes) {
  const rgba = new Uint8Array(width * height * 4);
  const sum = [0, 0, 0, 0];
  for (let at = 0; at < width * height; at++) {
    const index = pixels[at];
    for (let c = 0; c < 3; c++) rgba[at * 4 + c] = palette[index * 3 + c];
    rgba[at * 4 + 3] = holes && index === HOLE ? 0 : 255;
    if (rgba[at * 4 + 3]) for (let c = 0; c < 3; c++) sum[c] += rgba[at * 4 + c];
    sum[3] += rgba[at * 4 + 3] ? 1 : 0;
  }
  if (holes)
    for (let at = 0; at < width * height; at++)
      if (!rgba[at * 4 + 3]) for (let c = 0; c < 3; c++) rgba[at * 4 + c] = Math.round(sum[c] / Math.max(1, sum[3]));
  return { width, height, rgba };
}

// ── the file being made ─────────────────────────────────────────────────────
/** The JSON and the bytes of a glTF as they are added to; `glb()` packs them. */
function builder() {
  const json = { asset: { version: "2.0", generator: "SMAK packs/gltf" }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], textures: [], images: [], samplers: [{ magFilter: LINEAR, minFilter: LINEAR_MIPMAP_LINEAR, wrapS: REPEAT, wrapT: REPEAT }], accessors: [], bufferViews: [], buffers: [] }; // prettier-ignore
  const parts = [];
  let length = 0;
  const used = new Set();
  const view = (bytes, target) => {
    const pad = (4 - (length % 4)) % 4;
    if (pad) parts.push(Buffer.alloc(pad));
    length += pad;
    json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    parts.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    length += bytes.byteLength;
    return json.bufferViews.length - 1;
  };
  const accessor = (array, type, componentType, target, extra = {}) => {
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    json.accessors.push({ bufferView: view(array, target), componentType, count: array.length / width, type, ...extra });
    return json.accessors.length - 1;
  };
  const positions = (array) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let at = 0; at < array.length; at++) {
      min[at % 3] = Math.min(min[at % 3], array[at]);
      max[at % 3] = Math.max(max[at % 3], array[at]);
    }
    return accessor(array, "VEC3", FLOAT, VERTICES, { min, max });
  };
  /** A primitive of triangles from what `corners()` gathered: `{ positions, normals, uvs, colours, indices }`. */
  const primitive = (made, material) => {
    const count = made.positions.length / 3;
    const attributes = { POSITION: positions(new Float32Array(made.positions)), NORMAL: accessor(new Float32Array(made.normals), "VEC3", FLOAT, VERTICES), TEXCOORD_0: accessor(new Float32Array(made.uvs), "VEC2", FLOAT, VERTICES) }; // prettier-ignore
    if (made.colours.length) attributes.COLOR_0 = accessor(new Uint8Array(made.colours), "VEC4", UBYTE, VERTICES, { normalized: true }); // prettier-ignore
    const indices = count > 65535 ? new Uint32Array(made.indices) : new Uint16Array(made.indices);
    return { attributes, indices: accessor(indices, "SCALAR", count > 65535 ? UINT : USHORT, INDICES), material, mode: 4 }; // prettier-ignore
  };
  const glb = () => {
    const bin = Buffer.concat(parts);
    const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
    json.buffers.push({ byteLength: bin.length });
    if (used.size) json.extensionsUsed = [...used];
    for (const key of ["meshes", "materials", "textures", "images", "accessors", "bufferViews"]) if (!json[key].length) delete json[key]; // prettier-ignore
    if (!json.textures) delete json.samplers;
    const text = Buffer.from(JSON.stringify(json));
    const jsonPadded = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8);
    const chunk = (kind, bytes) => {
      const head = Buffer.alloc(8);
      head.writeUInt32LE(bytes.length, 0);
      head.writeUInt32LE(kind, 4);
      return Buffer.concat([head, bytes]);
    };
    return Buffer.concat([header, chunk(JSON_CHUNK, jsonPadded), chunk(BIN_CHUNK, binPadded)]);
  };
  return { json, view, primitive, glb, used };
}

/** Corners gathered for one primitive: `add(point, normal, uv, colour)` gives a corner's number, `triangle(a, b, c)`. */
const corners = () => {
  const made = { positions: [], normals: [], uvs: [], colours: [], indices: [], triangles: 0, area: 0 };
  made.add = (p, n, uv, colour) => {
    made.positions.push(...p);
    made.normals.push(...n);
    made.uvs.push(...uv);
    if (colour) made.colours.push(...colour.map((c) => Math.round(c * 255)), 255);
    return made.positions.length / 3 - 1;
  };
  made.triangle = (a, b, c) => {
    made.indices.push(a, b, c);
    made.triangles++;
  };
  return made;
};

/** A triangle's area (any units squared). */
const areaOf = (a, b, c) => Math.hypot(...cross(a.map((v, k) => b[k] - v), a.map((v, k) => c[k] - v))) / 2;

/**
 * The map in `bytes` (a .bsp) as a .glb: `{ glb, facts }`. `folders`: the game's folders, the mod's own first
 * (its .wad files and its models). `facts`: `{ triangles: { world, props }, area (m²): { world, props },
 * faces, fanned (the faces' triangles before the light's cut), materials, images, meshes, props, lights,
 * nodes, lit, missing (textures found nowhere), notes }`.
 */
export function mapGlb(bytes, { folders = [] } = {}) {
  const bsp = readBsp(bytes);
  const out = builder();
  const { json } = out;
  const facts = { triangles: { world: 0, props: 0 }, area: { world: 0, props: 0 }, faces: 0, fanned: 0, props: 0, lights: 0, lit: bsp.lumps.lighting.length > 0, missing: [], notes: [] }; // prettier-ignore
  const counted = stylesCounted(bsp, "start");
  const things = thingsOf(bsp);

  // ── pictures and materials
  const fromWads = new Map((folders.length ? texturesFor(bsp, folders, { pixels: true }).textures : []).map((each) => [each.name.toLowerCase(), each.texture])); // prettier-ignore
  const images = new Map();
  const imageOf = (key, picture) => {
    if (!images.has(key)) {
      json.images.push({ name: key, mimeType: "image/png", bufferView: out.view(png(picture.width, picture.height, picture.rgba)) }); // prettier-ignore
      json.textures.push({ sampler: 0, source: json.images.length - 1 });
      images.set(key, json.textures.length - 1);
    }
    return images.get(key);
  };
  const materials = new Map();
  /** A material by its key: `look` `{ name, picture: () => rgba or null, flat, holes, alpha, unlit, size }`. */
  const materialOf = (key, look) => {
    if (materials.has(key)) return materials.get(key);
    const picture = look.picture();
    const pbr = { metallicFactor: 0, roughnessFactor: 1 };
    if (picture) pbr.baseColorTexture = { index: imageOf(`${look.name}${look.holes ? " (holes)" : ""}`, picture) };
    const colour = (look.flat ?? [255, 255, 255]).map((c) => linear(c / 255));
    if (look.flat || look.alpha < 1) pbr.baseColorFactor = [...colour, look.alpha];
    const material = { name: key, pbrMetallicRoughness: pbr };
    if (look.holes) Object.assign(material, { alphaMode: "MASK", alphaCutoff: 0.5 });
    else if (look.alpha < 1) material.alphaMode = "BLEND";
    if (look.unlit) {
      material.extensions = { KHR_materials_unlit: {} };
      out.used.add("KHR_materials_unlit");
    }
    json.materials.push(material);
    materials.set(key, { number: json.materials.length - 1 });
    return materials.get(key);
  };
  const mapTextures = new Map();
  const mapTexture = (index) => {
    if (mapTextures.has(index)) return mapTextures.get(index);
    const entry = bsp.textures[index];
    const name = entry?.name ?? "";
    const found = (entry && !entry.absent && entry.embedded ? embeddedTexture(bsp, index) : null) ?? fromWads.get(name.toLowerCase()) ?? null; // prettier-ignore
    if (!found && !facts.missing.includes(name)) facts.missing.push(name);
    const level = found?.levels?.[0] ?? found;
    const texture = level?.pixels ? { width: level.width, height: level.height, pixels: level.pixels, palette: found.palette } : null; // prettier-ignore
    mapTextures.set(index, { name, texture, size: texture ? [texture.width, texture.height] : [entry?.width || 64, entry?.height || 64] }); // prettier-ignore
    return mapTextures.get(index);
  };

  // ── nodes
  const root = json.nodes.push({ name: (valueOf(bsp.entities[0] ?? [], "message") || "map").slice(0, 64), children: [] }) - 1; // prettier-ignore
  json.scenes[0].nodes.push(root);
  const node = (made) => {
    json.nodes.push(made);
    json.nodes[root].children.push(json.nodes.length - 1);
    return json.nodes.length - 1;
  };
  const extrasOf = (thing) => ({ number: thing.number, classname: thing.classname, ...(thing.targetname ? { targetname: thing.targetname } : {}), ...(thing.origin ? { origin: thing.origin } : {}), keys: asObject(bsp.entities[thing.number]) }); // prettier-ignore
  const nameOf = (thing) => [thing.number, thing.classname, thing.targetname].filter((v) => v !== undefined && v !== "").join(" ");

  // ── the world and the brush entities
  const meshOfModel = (number, look) => {
    const model = bsp.models[number];
    const byMaterial = new Map();
    for (let nth = 0; nth < model.faceCount; nth++) {
      const face = bsp.faces[model.firstFace + nth];
      const texinfo = bsp.texinfo[face.texinfo];
      const name = bsp.textures[texinfo.texture]?.name ?? "";
      const kind = textureKind(name);
      if (kind.sky || kind.tool) continue;
      const holes = kind.holes && look.holes;
      const key = `${name}${holes ? " masked" : ""}${look.alpha < 1 ? ` faded ${look.alpha.toFixed(2)}` : ""}`;
      const { texture, size } = mapTexture(texinfo.texture);
      const material = materialOf(key, { name, holes, alpha: look.alpha, unlit: facts.lit, flat: texture ? null : [128, 128, 128], picture: () => texture && rgbaOf(texture, holes) }); // prettier-ignore
      if (!byMaterial.has(material.number)) byMaterial.set(material.number, corners());
      const made = byMaterial.get(material.number);
      const normal = faceNormal(bsp, face);
      let polygon = facePolygon(bsp, face);
      // wound anticlockwise seen from its front (the whole outline's turn, Newell's: a compiled face often starts with three corners in a line)
      const turn = [0, 0, 0];
      polygon.forEach((a, i) => turn.forEach((_, k) => (turn[k] += cross(a, polygon[(i + 1) % polygon.length])[k])));
      if (turn[0] * normal[0] + turn[1] * normal[1] + turn[2] * normal[2] < 0) polygon = [...polygon].reverse();
      const light = facts.lit && !kind.water ? faceLight(bsp, face, counted) : null;
      // a face of a lit map the compiler gave no light is black, as in the game; a liquid is drawn as it is
      const colourAt = !facts.lit ? () => null : light ? (p) => lightAt(light, texinfo, p) : () => (kind.water ? [1, 1, 1] : [0, 0, 0]); // prettier-ignore
      const pieces = light ? cells(polygon, texinfo, light) : [polygon];
      const seen = new Map();
      const n = toGltf(normal, 1);
      const cornerOf = (p) => {
        const key = p.map((v) => Math.round(v / ON_LINE)).join(" ");
        if (!seen.has(key)) seen.set(key, made.add(toGltf(p), n, [dotted(texinfo.s, p) / size[0], dotted(texinfo.t, p) / size[1]], colourAt(p))); // prettier-ignore
        return seen.get(key);
      };
      for (const piece of pieces)
        for (let k = 1; k + 1 < piece.length; k++) {
          const area = areaOf(piece[0], piece[k], piece[k + 1]);
          if (!(area > 1e-6)) continue;
          const at = [cornerOf(piece[0]), cornerOf(piece[k]), cornerOf(piece[k + 1])];
          if (new Set(at).size < 3) continue;
          made.triangle(...at);
          made.area += area / UNITS_A_METRE ** 2;
        }
      facts.faces++;
      facts.fanned += polygon.length - 2;
    }
    if (!byMaterial.size) return undefined;
    const primitives = [];
    // Godot (4.7.2, gltf_document.cpp) flags a material "vertex colour as albedo" only once an earlier primitive of
    // the same mesh had COLOR_0 (it reads the material before the attributes): the first material's first triangle
    // goes ahead as a primitive of its own, so that the rest of it, and every material after, is flagged
    const [first] = [...byMaterial].filter(([, made]) => made.triangles > 1 && made.colours.length);
    if (first) {
      const [material, made] = first;
      const head = corners();
      const at = made.indices.splice(0, 3);
      made.triangles--;
      head.triangle(...at.map((i) => head.add(made.positions.slice(i * 3, i * 3 + 3), made.normals.slice(i * 3, i * 3 + 3), made.uvs.slice(i * 2, i * 2 + 2), made.colours.slice(i * 4, i * 4 + 3).map((c) => c / 255)))); // prettier-ignore
      primitives.push(out.primitive(head, material));
      facts.triangles.world++;
    }
    for (const [material, made] of byMaterial) {
      if (!made.triangles) continue;
      primitives.push(out.primitive(made, material));
      facts.triangles.world += made.triangles;
      facts.area.world += made.area;
    }
    json.meshes.push({ name: number ? `*${number}` : "world", primitives });
    return json.meshes.length - 1;
  };

  // ── the props: the models the kit draws for the entities, one mesh a model and pose
  const { figures, notes } = figuresOf(things, { models: true, folders });
  // without the game's folders no model is read: said so here, not as the drawing says it ("drawn as its box")
  facts.notes.push(...(folders.length ? notes : ["no game folders given: no prop's model was read (--game)"]));
  const propMeshes = new Map();
  const propMesh = (figure) => {
    const { body, skin, sequence, frame } = figure.pose;
    const key = [figure.file, body, skin, sequence, frame].join("|");
    if (propMeshes.has(key)) return propMeshes.get(key);
    const src = readStudio(figure.file).src;
    let tris;
    try {
      tris = posed(src, { seq: sequence, frame, body, skin }).tris;
    } catch {
      tris = posed(src, {}).tris;
    }
    const file = figure.file.replace(/\\/g, "/").split("/").slice(-2).join("/");
    const byMaterial = new Map();
    let area = 0;
    for (const triangle of tris) {
      const texture = triangle.tex;
      const flags = texture?.flags ?? 0;
      const chrome = Boolean(flags & TEXTURE.chrome);
      const holes = Boolean(flags & TEXTURE.masked);
      const { pixels, palette } = texture ? bytesOf(src, texture) : {};
      const flat = !texture || chrome ? meanOf(pixels, palette) : null;
      const material = materialOf(`${file}/${texture?.name ?? "plain"}`, { name: `${file}/${texture?.name ?? "plain"}`, holes, alpha: 1, unlit: Boolean(flags & (TEXTURE.fullbright | TEXTURE.additive)), flat, picture: () => (flat ? null : rgbaOf({ width: texture.width, height: texture.height, pixels, palette }, holes)) }); // prettier-ignore
      if (!byMaterial.has(material.number)) byMaterial.set(material.number, corners());
      const made = byMaterial.get(material.number);
      // a studio model's triangles go round the other way (FRONT): reversed, to be anticlockwise from the front
      const order = FRONT < 0 ? [0, 2, 1] : [0, 1, 2];
      const [a, b, c] = order.map((k) => triangle.c[k]);
      const triangleArea = areaOf(a.p, b.p, c.p);
      if (!(triangleArea > 1e-9)) continue;
      const size = texture ? [texture.width, texture.height] : [1, 1];
      made.triangle(...[a, b, c].map((corner) => made.add(toGltf(corner.p), unit(toGltf(corner.n, 1)), [corner.u / size[0], corner.v / size[1]], null))); // prettier-ignore
      area += triangleArea / UNITS_A_METRE ** 2;
    }
    const primitives = [...byMaterial].filter(([, made]) => made.triangles).map(([material, made]) => out.primitive(made, material)); // prettier-ignore
    const triangles = [...byMaterial.values()].reduce((sum, made) => sum + made.triangles, 0);
    json.meshes.push({ name: file, primitives });
    propMeshes.set(key, { mesh: json.meshes.length - 1, triangles, area });
    return propMeshes.get(key);
  };

  for (const thing of things) {
    const extras = extrasOf(thing);
    if (thing.model !== null && thing.model !== undefined) {
      const hidden = thing.look?.hidden || !bsp.models[thing.model];
      const mesh = hidden ? undefined : meshOfModel(thing.model, thing.model === 0 ? { alpha: 1, holes: false } : thing.look); // prettier-ignore
      const origin = thing.model && thing.origin ? toGltf(thing.origin) : null;
      node({ name: thing.model === 0 ? "world" : nameOf(thing), ...(mesh !== undefined ? { mesh } : {}), ...(origin ? { translation: origin } : {}), extras }); // prettier-ignore
      continue;
    }
    const figure = figures.get(thing.number);
    const lit = lightOf(thing, bsp);
    if (figure?.file) {
      const shared = propMesh(figure);
      const base = [thing.origin[0], thing.origin[1], thing.origin[2] - (figure.body?.feet ?? 0)];
      node({ name: nameOf(thing), mesh: shared.mesh, matrix: matrixOf(turnOf(figure.pose.angles), figure.pose.scale, base), extras }); // prettier-ignore
      facts.props++;
      facts.triangles.props += shared.triangles;
      facts.area.props += shared.area * figure.pose.scale ** 2;
    } else if (lit) {
      json.extensions ??= { KHR_lights_punctual: { lights: [] } };
      out.used.add("KHR_lights_punctual");
      json.extensions.KHR_lights_punctual.lights.push(lit.light);
      const at = thing.origin ?? [0, 0, 0];
      node({ name: nameOf(thing), matrix: lit.way ? aimed(lit.way, at) : matrixOf(null, 1, at), extensions: { KHR_lights_punctual: { light: json.extensions.KHR_lights_punctual.lights.length - 1 } }, extras }); // prettier-ignore
      facts.lights++;
    } else node({ name: nameOf(thing), ...(thing.origin ? { translation: toGltf(thing.origin) } : {}), extras });
  }
  facts.meshes = json.meshes.length;
  facts.materials = json.materials.length;
  facts.images = json.images.length;
  facts.nodes = json.nodes.length;
  facts.shared = propMeshes.size;
  const glb = out.glb();
  return { glb, facts };
}

/** The mean colour of a texture's pixels ([r, g, b]), grey when there is none. */
function meanOf(pixels, palette) {
  if (!pixels?.length) return [150, 150, 150];
  const sum = [0, 0, 0];
  for (const index of pixels) for (let c = 0; c < 3; c++) sum[c] += palette[index * 3 + c];
  return sum.map((value) => Math.round(value / pixels.length));
}

/** A node's matrix (glTF's: by columns) from a turn of the map's axes (rows of three, or null), a scale and a place in units. */
function matrixOf(turn, scale, at) {
  // the turn seen in glTF's axes: M R Mᵀ, where M takes (x, y, z) to (x, z, -y)
  const r = turn ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const column = (k) => toGltf([r[0][k], r[1][k], r[2][k]], scale);
  const [x, y, z] = [column(0), column(2), column(1).map((v) => -v)];
  return [...x, 0, ...y, 0, ...z, 0, ...toGltf(at), 1];
}

/** The matrix of a node at `at` (units) whose -z looks along `way` (the map's axes): a spot or the sun. */
function aimed(way, at) {
  const back = toGltf(way, 1).map((v) => -v);
  const up = Math.abs(back[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
  const x = unit(cross(up, back));
  const y = cross(back, x);
  return [...x, 0, ...y, 0, ...back, 0, ...toGltf(at), 1];
}

/**
 * An entity's light for KHR_lights_punctual, or null: `{ light, way }`. hlrad's arithmetic (sdHLRAD lightmap.cpp):
 * `_light` "r g b [brightness]" gives I (r / 255 x brightness), and a point light or a spot is made I x max(I)² / 10;
 * a sample at d units is that x cos / d², scaled by 2, so 1 of white (256 x 2) is reached at I / d² = 128. Written
 * as candela so that the light at d metres in lux is that share of white: I x max(I)² / 10 x 2 / 256 / 39.37²
 * (a `_light` "255 255 255 200": 4.0 cd, white at 2 m). The sun (light_environment) is not over d²: lux = 2 I / 256.
 * README.md says what each engine makes of it.
 */
function lightOf(thing, bsp) {
  const kinds = { light: "point", light_spot: "spot", light_environment: "directional" };
  const type = kinds[thing.classname];
  if (!type) return null;
  const entity = bsp.entities[thing.number];
  const said = String(valueOf(entity, "_light") ?? "").trim().split(/\s+/).map(Number);
  let rgb = said.length >= 3 ? said.slice(0, 3) : [said[0], said[0], said[0]];
  if (said.length >= 4) rgb = rgb.map((c) => (c / 255) * said[3]);
  if (rgb.some((c) => !Number.isFinite(c)) || !(Math.max(...rgb) > 0)) return null;
  const most = Math.max(...rgb);
  const strength = type === "directional" ? (most * RAD_SCALE) / 256 : (most * (most * most) / 10 * RAD_SCALE) / 256 / UNITS_A_METRE ** 2; // prettier-ignore
  const light = { name: thing.classname, type, color: rgb.map((c) => c / most), intensity: strength };
  if (type !== "directional") light.range = Math.sqrt(strength / LEAST_LIGHT);
  let way = null;
  if (type !== "point") {
    const target = valueOf(entity, "target");
    const to = target && bsp.entities.find((other) => valueOf(other, "targetname") === target);
    const there = to && String(valueOf(to, "origin") ?? "").split(/\s+/).map(Number);
    if (there?.length === 3 && thing.origin) way = unit(there.map((v, k) => v - thing.origin[k]));
    else {
      const angles = String(valueOf(entity, "angles") ?? "0 0 0").split(/\s+/).map(Number);
      const angle = Number(valueOf(entity, "angle") ?? 0);
      const pitch = (Number(valueOf(entity, "pitch") ?? 0) || angles[0] || 0) * (Math.PI / 180);
      const yaw = (angle || angles[1] || 0) * (Math.PI / 180);
      way = angle === -1 ? [0, 0, 1] : angle === -2 ? [0, 0, -1] : [Math.cos(yaw) * Math.cos(pitch), Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch)]; // prettier-ignore
    }
  }
  if (type === "spot") {
    const degrees = (key, otherwise) => Number(valueOf(entity, key) ?? 0) || otherwise;
    const inner = Math.min(89, degrees("_cone", 10));
    const outer = Math.min(90, Math.max(inner, degrees("_cone2", inner)));
    light.spot = { outerConeAngle: (outer * Math.PI) / 180, innerConeAngle: (Math.min(inner, outer * 0.95) * Math.PI) / 180 }; // prettier-ignore
  }
  return { light, way };
}
