// A compiled map and the studio models its entities place, written as one glTF 2.0 file (.glb) that another
// engine opens (Godot 4, Blender, three.js). An optional pack: it imports the kit, the kit never imports it.
//
//   mapGlb(bytes, { folders, light, sets })   `{ glb, facts }`: the file's bytes, and what went into it
//
// Two ways (`light`): "baked" (the default) is the game's light as it compiled it, below; "lit" leaves it out for an
// engine's lamps in real time: lit materials (a texture's set from packs/materials, looked for as `<name>.set/` in
// `sets`, gives normal, roughness, metalness and occlusion, with TANGENT), no COLOR_0 and no cut on the lightmap's
// grid, a texture light emissive, the props lit like the world. README.md says what each way loses.
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
//                                     every entity that shows the same model in the same pose and light, a node
//                                     each at its origin and angles; no skeleton, no animation. In a lit map lit
//                                     as the game lights a model: COLOR_0 from the floor's sample under it and
//                                     the way each corner looks, on unlit materials, as the world
//   masked textures                   cut off where the game cuts them, sampled with no mipmaps
//   extras                            on each entity's node: its number, classname, targetname, origin (in the
//                                     map's units) and every key
// Axes: GoldSrc is +z up and right-handed, glTF +y up and right-handed: (x, y, z) is written (x, z, -y), a
// turn, never a mirror, so faces keep their winding. 39.37 units are a metre, as the kit's importer takes.
import { readBsp, facePolygon, faceNormal, faceLightmap, embeddedTexture, LUXEL } from "../../core/maps/bsp.mjs";
import { textureKind, HOLE } from "../../core/maps/miptex.mjs";
import { texturesFor } from "../../core/maps/wad.mjs";
import { valueOf, asObject } from "../../core/maps/entities.mjs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { png, unpng } from "../../core/image.mjs";
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
/**
 * The alpha a texel of a masked texture is drawn from: Xash's alpha test (GL_GREATER) is 0.25 for a brush entity in
 * render mode 4 (ref/gl/gl_rsurf.c), 0.5 for a studio model's masked texture (gl_studio.c). Its mip levels average the
 * alpha (a grate a third metal is a third opaque from its fourth level), so a masked texture is sampled with no
 * mipmaps: Godot (4.7.2) reads the sampler into the material's filter, and a cut-off alone either loses the grate
 * from a distance on (0.5) or makes it a plate (0.25). README.md has the pictures.
 */
const BRUSH_CUTOFF = 0.25;
const MODEL_CUTOFF = 0.5;
/**
 * A model is lit as the game lights it (Xash gl_studio.c R_StudioDynamicLight, R_StudioLighting): one light for the
 * whole model, the sample of the first lit face of the world 8 units over its origin and down; `DIRECT` (the cvar
 * `direct`, 0.9) of it falls from straight above, the rest everywhere, and a corner keeps 1 - DIRECT x max(0,
 * (LAMBERT - 1 - nz) / LAMBERT) of it, nz the upright part of its normal (looking up 1, sideways 0.70, down 0.10).
 * Against a face's light it is MODEL_SHARE: the model's sample x 264/256 against the lightmap's x 264/256 x 171/256 x
 * 2 (gl_rsurf.c with gl_overbright, as the game's own screenshot of the mess hall measures: walls 1.3 to 1.45, a
 * model's side 0.73 to 0.87, a sample over 255 a channel, the textures' texgamma taken into account).
 */
const DIRECT = 0.9;
const LAMBERT = 1.495;
const MODEL_SHARE = 0.745;
/** Over the origin, the line down to the floor starts here, and reaches this far (units). */
const OVER = 8;
const REACH = 2048;
/** The render modes whose `renderamt` fades a brush entity (draw.mjs FADING_MODES), and the one with holes. */
const FADING = [1, 2, 3, 5];
const HOLES_MODE = 4;
/** The lit way's ambient, said in the root's extras: this share of the world's lightmap samples is darker (README.md). */
const AMBIENT_SHARE = 0.1;
/** The lit way's lamps carry the game's brightness (BRIGHTNESS, a factor on the colour) as a factor on linear light. */
const LIT_GAIN = BRIGHTNESS ** 2.2;
/**
 * A texture light's faces become lamps in the lit way, gathered by texture in cells this wide (units), the brightest
 * MOST_GLOWS of them; hlrad's (sdHLRAD lightmap.cpp, qrad.cpp): a face gives its light x area x reflectivity / pi, the
 * reflectivity the texture's mean of (c / 255)^1.76 x 0.7, and falls as cos x cos / d², scaled by 2 as a lamp's.
 */
const GLOW_CELL = 256;
const MOST_GLOWS = 32;
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

/**
 * The light of the floor under a point as the game takes it for a model standing there (Xash R_LightVec): the
 * world's tree walked down the upright line, the nearest sample of the first face it passes that has light (the
 * styles that count added up): [r, g, b], 0 to 255, or null. Brush entities' floors are not asked.
 */
function lightUnder(bsp, [x, y, z], counted) {
  const walk = (at, top, bottom) => {
    if (at < 0) return null;
    const node = bsp.nodes[at];
    const { normal, dist } = bsp.planes[node.plane];
    const flat = normal[0] * x + normal[1] * y - dist;
    const [over, under] = [flat + normal[2] * top, flat + normal[2] * bottom];
    if (over >= 0 === under >= 0) return walk(node.children[over >= 0 ? 0 : 1], top, bottom);
    const cut = top + ((bottom - top) * over) / (over - under);
    const before = walk(node.children[over >= 0 ? 0 : 1], top, cut);
    if (before) return before;
    for (let nth = 0; nth < node.faceCount; nth++) {
      const face = bsp.faces[node.firstFace + nth];
      const light = face && faceLight(bsp, face, counted);
      if (!light) continue;
      const { s, t } = bsp.texinfo[face.texinfo];
      const across = Math.round((dotted(s, [x, y, cut]) - light.originS) / LUXEL);
      const down = Math.round((dotted(t, [x, y, cut]) - light.originT) / LUXEL);
      if (across < 0 || down < 0 || across >= light.width || down >= light.height) continue;
      return [0, 1, 2].map((c) => light.rgb[(down * light.width + across) * 3 + c]);
    }
    return walk(node.children[over >= 0 ? 1 : 0], cut, bottom);
  };
  return walk(bsp.models[0].headNodes[0], z + OVER, z + OVER - REACH);
}

/** A model's corner's light in the game: the floor's `sample` and the upright part of its normal (`nz`), linear. */
const modelLight = (sample, nz) => {
  const share = 1 - DIRECT * Math.max(0, (LAMBERT - 1 - nz) / LAMBERT);
  return sample.map((s) => linear(Math.min(1, (s * BRIGHTNESS * MODEL_SHARE * share) / 255)));
};

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
    if (made.tangents.length) attributes.TANGENT = accessor(new Float32Array(made.tangents), "VEC4", FLOAT, VERTICES);
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

/** Corners gathered for one primitive: `add(point, normal, uv, colour, tangent)` gives a corner's number, `triangle(a, b, c)`. */
const corners = () => {
  const made = { positions: [], normals: [], uvs: [], colours: [], tangents: [], indices: [], triangles: 0, area: 0 };
  made.add = (p, n, uv, colour, tangent) => {
    if (tangent) made.tangents.push(...tangent);
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

/**
 * A face's TANGENT (glTF's axes): along its texture's u, and its w such that normal x tangent x w runs up the
 * picture (v falling), where glTF's normal map has +Y (OpenGL's sense, the materials pack's).
 */
function tangentOf(n, { s, t }) {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const [u, v] = [cross(t, n), cross(s, n)];
  const along = unit(u.map((x) => x * Math.sign(dot(s, u))));
  const up = v.map((x) => -x * Math.sign(dot(t, v)));
  return [...toGltf(along, 1), dot(cross(n, along), up) < 0 ? -1 : 1];
}

/** A triangle's area (any units squared). */
const areaOf = (a, b, c) => Math.hypot(...cross(a.map((v, k) => b[k] - v), a.map((v, k) => c[k] - v))) / 2;

/**
 * The map in `bytes` (a .bsp) as a .glb: `{ glb, facts }`. `folders`: the game's folders, the mod's own first
 * (its .wad files and its models). `facts`: `{ triangles: { world, props }, area (m²): { world, props },
 * faces, fanned (the faces' triangles before the light's cut), materials, images, meshes, props, lights,
 * nodes, lit, missing (textures found nowhere), notes }`.
 */
export function mapGlb(bytes, { folders = [], light = "baked", sets = [] } = {}) {
  if (!["baked", "lit"].includes(light)) throw new Error(`light "${light}": baked or lit`);
  const lit = light === "lit";
  const bsp = readBsp(bytes);
  const out = builder();
  const { json } = out;
  const facts = { triangles: { world: 0, props: 0 }, area: { world: 0, props: 0 }, faces: 0, fanned: 0, props: 0, lights: 0, lit: bsp.lumps.lighting.length > 0, missing: [], notes: [] }; // prettier-ignore
  // the baked light goes in only in the baked way; the lit way leaves it for the engine's lamps
  const baked = facts.lit && !lit;
  if (lit) Object.assign(facts, { light, sets: 0, glows: 0 });
  const counted = stylesCounted(bsp, "start");
  const things = thingsOf(bsp);

  // ── pictures and materials
  const fromWads = new Map((folders.length ? texturesFor(bsp, folders, { pixels: true }).textures : []).map((each) => [each.name.toLowerCase(), each.texture])); // prettier-ignore
  const images = new Map();
  /** A picture as a texture once; one with holes sampled with no mipmaps (sampler 1, made when first wanted). */
  const imageOf = (key, picture, holes) => {
    if (!images.has(key)) {
      json.images.push({ name: key, mimeType: "image/png", bufferView: out.view(picture.bytes ?? png(picture.width, picture.height, picture.rgba)) }); // prettier-ignore
      if (holes && json.samplers.length < 2) json.samplers.push({ magFilter: LINEAR, minFilter: LINEAR, wrapS: REPEAT, wrapT: REPEAT }); // prettier-ignore
      json.textures.push({ sampler: holes ? 1 : 0, source: json.images.length - 1 });
      images.set(key, json.textures.length - 1);
    }
    return images.get(key);
  };
  const materials = new Map();
  /** A material by its key: `look` `{ name, picture: () => rgba or null, flat, holes, cutoff, alpha, unlit, set, glow }`. */
  const materialOf = (key, look) => {
    if (materials.has(key)) return materials.get(key);
    const picture = look.picture();
    const pbr = { metallicFactor: 0, roughnessFactor: 1 };
    if (picture) pbr.baseColorTexture = { index: imageOf(`${look.name}${look.holes ? " (holes)" : ""}`, picture, look.holes) }; // prettier-ignore
    const colour = (look.flat ?? [255, 255, 255]).map((c) => linear(c / 255));
    if (look.flat || look.alpha < 1) pbr.baseColorFactor = [...colour, look.alpha];
    const material = { name: key, pbrMetallicRoughness: pbr };
    if (look.holes) Object.assign(material, { alphaMode: "MASK", alphaCutoff: look.cutoff });
    else if (look.alpha < 1) material.alphaMode = "BLEND";
    if (look.set?.normal) material.normalTexture = { index: imageOf(`${look.name} normal`, look.set.normal) };
    if (look.set?.orm) {
      pbr.metallicRoughnessTexture = { index: imageOf(`${look.name} occlusion roughness metalness`, look.set.orm) };
      pbr.metallicFactor = look.set.metal ? 1 : 0;
      if (look.set.occlusion) material.occlusionTexture = { index: pbr.metallicRoughnessTexture.index };
    }
    if (look.glow) Object.assign(material, { emissiveFactor: look.glow, ...(pbr.baseColorTexture ? { emissiveTexture: { index: pbr.baseColorTexture.index } } : {}) }); // prettier-ignore
    if (look.unlit) {
      material.extensions = { KHR_materials_unlit: {} };
      out.used.add("KHR_materials_unlit");
    }
    json.materials.push(material);
    materials.set(key, { number: json.materials.length - 1 });
    return materials.get(key);
  };
  /**
   * A texture's set from packs/materials (`<name>.set/` in a folder of `sets`), as the lit way writes it: the normal
   * as it is (OpenGL's sense, +Y up: glTF's), roughness in G, metalness in B and occlusion in R of one picture. Only
   * when the `<name>.png` the pack wrote beside it is the map's texture, colour for colour, and is not of a part.
   */
  const setOf = (name, texture) => {
    const folder = lit && texture && sets.map((each) => join(each, `${name}.set`)).find((each) => existsSync(join(each, "material.json")));
    if (!folder) return null;
    const own = existsSync(`${folder.slice(0, -4)}.png`) ? unpng(readFileSync(`${folder.slice(0, -4)}.png`)) : null;
    const off = own?.width === texture.width && own.height === texture.height ? texture.pixels.reduce((sum, i, at) => sum + [0, 1, 2].reduce((d, c) => d + Math.abs(own.rgba[at * 4 + c] - texture.palette[i * 3 + c]), 0), 0) / texture.pixels.length / 3 : Infinity; // prettier-ignore
    if (!(off < 2)) return facts.notes.push(`${name}: the set in ${folder} is not of this texture (its ${name}.png ${own ? `differs by ${off === Infinity ? "its size" : off.toFixed(1)}` : "is not there"}): left out`), null; // prettier-ignore
    if (JSON.parse(readFileSync(join(folder, "material.json"), "utf8")).part) return facts.notes.push(`${name}: its set is the whole source, the texture a part of it (--part): the maps would not lie on it, left out`), null; // prettier-ignore
    const read = (map) => (existsSync(join(folder, `${map}.png`)) ? readFileSync(join(folder, `${map}.png`)) : null);
    const [rough, metal, occlusion] = ["roughness", "metalness", "occlusion"].map((map) => read(map) && unpng(read(map)));
    const size = rough ?? metal ?? occlusion;
    const same = (map) => (map && map.width === size.width && map.height === size.height ? map : null);
    let orm = null;
    if (size) {
      const rgba = new Uint8Array(size.width * size.height * 4);
      for (let at = 0; at < rgba.length; at += 4) rgba.set([same(occlusion)?.rgba[at] ?? 255, same(rough)?.rgba[at] ?? 255, same(metal)?.rgba[at] ?? 0, 255], at); // prettier-ignore
      orm = { width: size.width, height: size.height, rgba };
    }
    facts.sets++;
    return { normal: read("normal") && { bytes: read("normal") }, orm, metal: Boolean(same(metal)), occlusion: Boolean(same(occlusion)) }; // prettier-ignore
  };
  /** The texture lights the compiler was told of (info_texlights: a texture's name, "r g b brightness"): their colour over its largest. */
  const glows = new Map();
  for (const entity of lit ? bsp.entities : [])
    if (valueOf(entity, "classname") === "info_texlights")
      for (const [key, value] of entity) {
        const said = String(value).trim().split(/\s+/).map(Number);
        const rgb = said.length >= 4 ? said.slice(0, 3).map((c) => (c / 255) * said[3]) : said.slice(0, 3);
        if (!/^(classname|origin)$/.test(key) && rgb.length === 3 && Math.max(...rgb) > 0) glows.set(key.toLowerCase(), { colour: rgb.map((c) => c / Math.max(...rgb)), rgb }); // prettier-ignore
      }
  const mapTextures = new Map();
  const mapTexture = (index) => {
    if (mapTextures.has(index)) return mapTextures.get(index);
    const entry = bsp.textures[index];
    const name = entry?.name ?? "";
    const found = (entry && !entry.absent && entry.embedded ? embeddedTexture(bsp, index) : null) ?? fromWads.get(name.toLowerCase()) ?? null; // prettier-ignore
    if (!found && !facts.missing.includes(name)) facts.missing.push(name);
    const level = found?.levels?.[0] ?? found;
    const texture = level?.pixels ? { width: level.width, height: level.height, pixels: level.pixels, palette: found.palette } : null; // prettier-ignore
    const glow = glows.get(name.toLowerCase()) ?? null;
    if (glow && texture) glow.reflects = [0, 1, 2].map((c) => (texture.pixels.reduce((sum, i) => sum + (texture.palette[i * 3 + c] / 255) ** 1.76, 0) / texture.pixels.length) * 0.7); // prettier-ignore
    facts.glows += glow ? 1 : 0;
    mapTextures.set(index, { name, texture, size: texture ? [texture.width, texture.height] : [entry?.width || 64, entry?.height || 64], set: setOf(name, texture), glow }); // prettier-ignore
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
  const glowCells = new Map();
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
      const { texture, size, set, glow } = mapTexture(texinfo.texture);
      const material = materialOf(key, { name, holes, cutoff: BRUSH_CUTOFF, alpha: look.alpha, unlit: baked, set, glow: glow?.colour, flat: texture ? null : [128, 128, 128], picture: () => texture && rgbaOf(texture, holes) }); // prettier-ignore
      if (!byMaterial.has(material.number)) byMaterial.set(material.number, corners());
      const made = byMaterial.get(material.number);
      const normal = faceNormal(bsp, face);
      let polygon = facePolygon(bsp, face);
      // wound anticlockwise seen from its front (the whole outline's turn, Newell's: a compiled face often starts with three corners in a line)
      const turn = [0, 0, 0];
      polygon.forEach((a, i) => turn.forEach((_, k) => (turn[k] += cross(a, polygon[(i + 1) % polygon.length])[k])));
      if (turn[0] * normal[0] + turn[1] * normal[1] + turn[2] * normal[2] < 0) polygon = [...polygon].reverse();
      const light = baked && !kind.water ? faceLight(bsp, face, counted) : null;
      // a face of a lit map the compiler gave no light is black, as in the game; a liquid is drawn as it is
      const colourAt = !baked ? () => null : light ? (p) => lightAt(light, texinfo, p) : () => (kind.water ? [1, 1, 1] : [0, 0, 0]); // prettier-ignore
      const pieces = light ? cells(polygon, texinfo, light) : [polygon];
      const seen = new Map();
      const n = toGltf(normal, 1);
      const tangent = set?.normal ? tangentOf(normal, texinfo) : null;
      const cornerOf = (p) => {
        const key = p.map((v) => Math.round(v / ON_LINE)).join(" ");
        if (!seen.has(key)) seen.set(key, made.add(toGltf(p), n, [dotted(texinfo.s, p) / size[0], dotted(texinfo.t, p) / size[1]], colourAt(p), tangent)); // prettier-ignore
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
      if (glow) {
        // a texture light's face, gathered by texture and cell: its area, middle and facing by area, its light
        let area = 0;
        for (let k = 1; k + 1 < polygon.length; k++) area += areaOf(polygon[0], polygon[k], polygon[k + 1]);
        const middle = [0, 1, 2].map((k) => polygon.reduce((sum, p) => sum + p[k], 0) / polygon.length);
        const key = `${name} ${middle.map((v) => Math.floor(v / GLOW_CELL)).join(" ")}`;
        const cell = glowCells.get(key) ?? glowCells.set(key, { name, area: 0, at: [0, 0, 0], facing: [0, 0, 0], power: [0, 0, 0] }).get(key); // prettier-ignore
        cell.area += area;
        for (let k = 0; k < 3; k++) {
          cell.at[k] += middle[k] * area;
          cell.facing[k] += normal[k] * area;
          cell.power[k] += (glow.rgb[k] * area * (glow.reflects?.[k] ?? 0.7)) / Math.PI;
        }
      }
    }
    if (!byMaterial.size) return undefined;
    for (const made of byMaterial.values()) {
      facts.triangles.world += made.triangles;
      facts.area.world += made.area;
    }
    json.meshes.push({ name: number ? `*${number}` : "world", primitives: primitivesOf(byMaterial) });
    return json.meshes.length - 1;
  };
  /** A mesh's primitives, one a material, from `corners()` by material number. */
  const primitivesOf = (byMaterial) => {
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
    }
    for (const [material, made] of byMaterial) if (made.triangles) primitives.push(out.primitive(made, material));
    if (first) first[1].triangles++;
    return primitives;
  };

  // ── the props: the models the kit draws for the entities, one mesh a model, pose and light
  const { figures, notes } = figuresOf(things, { models: true, folders });
  // without the game's folders no model is read: said so here, not as the drawing says it ("drawn as its box")
  facts.notes.push(...(folders.length ? notes : ["no game folders given: no prop's model was read (--game)"]));
  const propMeshes = new Map();
  /** `sample`: the floor's light under it (null in a map with no light); `upright`: the turn's row that gives a normal's z. */
  const propMesh = (figure, sample, upright) => {
    const { body, skin, sequence, frame } = figure.pose;
    const key = [figure.file, body, skin, sequence, frame, sample, sample && upright.map((v) => v.toFixed(3))].join("|"); // prettier-ignore
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
      const bright = Boolean(flags & (TEXTURE.fullbright | TEXTURE.additive));
      const material = materialOf(`${file}/${texture?.name ?? "plain"}`, { name: `${file}/${texture?.name ?? "plain"}`, holes, cutoff: MODEL_CUTOFF, alpha: 1, unlit: bright || Boolean(sample), flat, picture: () => (flat ? null : rgbaOf({ width: texture.width, height: texture.height, pixels, palette }, holes)) }); // prettier-ignore
      if (!byMaterial.has(material.number)) byMaterial.set(material.number, corners());
      const made = byMaterial.get(material.number);
      // a studio model's triangles go round the other way (FRONT): reversed, to be anticlockwise from the front
      const order = FRONT < 0 ? [0, 2, 1] : [0, 1, 2];
      const [a, b, c] = order.map((k) => triangle.c[k]);
      const triangleArea = areaOf(a.p, b.p, c.p);
      if (!(triangleArea > 1e-9)) continue;
      const size = texture ? [texture.width, texture.height] : [1, 1];
      // a fullbright or additive texture is drawn at full light (its colour white), the rest as the game lights a model
      const colourOf = (n) => sample && (bright ? [1, 1, 1] : modelLight(sample, dotted([...upright, 0], unit(n))));
      made.triangle(...[a, b, c].map((corner) => made.add(toGltf(corner.p), unit(toGltf(corner.n, 1)), [corner.u / size[0], corner.v / size[1]], colourOf(corner.n)))); // prettier-ignore
      area += triangleArea / UNITS_A_METRE ** 2;
    }
    const triangles = [...byMaterial.values()].reduce((sum, made) => sum + made.triangles, 0);
    json.meshes.push({ name: file, primitives: primitivesOf(byMaterial) });
    propMeshes.set(key, { mesh: json.meshes.length - 1, triangles, area });
    return propMeshes.get(key);
  };

  /** A node with a KHR_lights_punctual light. */
  const lampNode = (name, light, matrix, extras) => {
    json.extensions ??= { KHR_lights_punctual: { lights: [] } };
    out.used.add("KHR_lights_punctual");
    json.extensions.KHR_lights_punctual.lights.push(light);
    node({ name, matrix, extensions: { KHR_lights_punctual: { light: json.extensions.KHR_lights_punctual.lights.length - 1 } }, ...(extras ? { extras } : {}) }); // prettier-ignore
    facts.lights++;
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
    const lamp = lightOf(thing, bsp, lit ? LIT_GAIN : 1);
    if (figure?.file) {
      // in a lit map a lit face is found under nearly every prop; one over none is black, as in the game
      const sample = baked ? (lightUnder(bsp, thing.origin, counted) ?? [0, 0, 0]) : null;
      const shared = propMesh(figure, sample, turnOf(figure.pose.angles)[2]);
      const base = [thing.origin[0], thing.origin[1], thing.origin[2] - (figure.body?.feet ?? 0)];
      node({ name: nameOf(thing), mesh: shared.mesh, matrix: matrixOf(turnOf(figure.pose.angles), figure.pose.scale, base), extras }); // prettier-ignore
      facts.props++;
      facts.triangles.props += shared.triangles;
      facts.area.props += shared.area * figure.pose.scale ** 2;
    } else if (lamp) {
      const at = thing.origin ?? [0, 0, 0];
      lampNode(nameOf(thing), lamp.light, lamp.way ? aimed(lamp.way, at) : matrixOf(null, 1, at), extras);
    } else node({ name: nameOf(thing), ...(thing.origin ? { translation: toGltf(thing.origin) } : {}), extras });
  }
  // the texture lights' brightest cells as lamps, a spot facing out where its faces agree on a facing (README.md)
  const glowList = [...glowCells.values()].sort((a, b) => Math.max(...b.power) - Math.max(...a.power));
  for (const cell of glowList.slice(0, MOST_GLOWS)) {
    const most = Math.max(...cell.power);
    const strength = (most * RAD_SCALE * LIT_GAIN) / 256 / UNITS_A_METRE ** 2;
    const facing = cell.facing.map((v) => v / cell.area);
    const light = { name: `texture light ${cell.name}`, type: Math.hypot(...facing) > 0.5 ? "spot" : "point", color: cell.power.map((c) => c / most), intensity: strength, range: Math.sqrt(strength / LEAST_LIGHT) }; // prettier-ignore
    if (light.type === "spot") light.spot = { innerConeAngle: 0, outerConeAngle: Math.PI / 2 };
    const at = cell.at.map((v) => v / cell.area);
    lampNode(light.name, light, light.type === "spot" ? aimed(unit(facing), at.map((v, k) => v + unit(facing)[k])) : matrixOf(null, 1, at));
  }
  if (lit) facts.glowLamps = Math.min(MOST_GLOWS, glowList.length);
  if (lit) facts.glowCells = glowList.length;
  if (lit && facts.lit) {
    // no bounce light in an engine's lamps: the light of the world's darker samples, for its ambient (README.md)
    const sums = bsp.faces.slice(0, bsp.models[0].faceCount).flatMap((face) => { const rgb = faceLight(bsp, face, counted)?.rgb ?? []; return Array.from({ length: rgb.length / 3 }, (_, k) => [rgb[k * 3], rgb[k * 3 + 1], rgb[k * 3 + 2]]); }).sort((a, b) => a[0] + a[1] + a[2] - b[0] - b[1] - b[2]); // prettier-ignore
    const low = sums[Math.floor(sums.length * AMBIENT_SHARE)];
    if (low) json.nodes[root].extras = { ambient: (facts.ambient = low.map((c) => +linear(Math.min(1, (c * BRIGHTNESS) / 255)).toFixed(4))) }; // prettier-ignore
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
 * All x `gain`: 1 in the baked way, LIT_GAIN in the lit. README.md says what each engine makes of it.
 */
function lightOf(thing, bsp, gain = 1) {
  const kinds = { light: "point", light_spot: "spot", light_environment: "directional" };
  const type = kinds[thing.classname];
  if (!type) return null;
  const entity = bsp.entities[thing.number];
  const said = String(valueOf(entity, "_light") ?? "").trim().split(/\s+/).map(Number);
  let rgb = said.length >= 3 ? said.slice(0, 3) : [said[0], said[0], said[0]];
  if (said.length >= 4) rgb = rgb.map((c) => (c / 255) * said[3]);
  if (rgb.some((c) => !Number.isFinite(c)) || !(Math.max(...rgb) > 0)) return null;
  const most = Math.max(...rgb);
  const strength = gain * (type === "directional" ? (most * RAD_SCALE) / 256 : (most * (most * most) / 10 * RAD_SCALE) / 256 / UNITS_A_METRE ** 2); // prettier-ignore
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
