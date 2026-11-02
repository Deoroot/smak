// Compiled GoldSrc maps (.bsp, version 30, and Xash3D's BSP2) read directly: what is drawn, what is solid, what is lit, what is
// seen from where, and the entities.
//
// A map is fifteen lumps (lumps.mjs). The world is cut by planes into a tree whose leaves are either open
// (empty, water) or solid; faces are the polygons drawn, each lit by a small patch of baked light; models are
// the world (model 0) and one for each entity made of brushes (a door is `"model" "*7"`); the entities are
// text (entities.mjs).
//
//   reading       readBsp
//   the tree      contentsAt leafAt floorUnder worldBounds contentsName
//   faces         facePolygon faceNormal faceTexels faceUvs faceTexture modelFaces
//   light         faceLightmap lightmapSize hasLightmap lightSamples
//   visibility    visibleFrom sees
//   textures      embeddedTexture wantedTextures
//
// Places are in the map's units, about an inch: `+z` is up. A brush entity's model is in the model's own
// space: take the entity's `origin` from a point before asking about it.
//
// Both formats are read into the one shape below, so that nothing which reads a map asks which it is (`format`
// says, for what must). A BSP2 map (lumps.mjs: how it is told, from Xash3D FWGS's source) widens six lumps to
// 32 bit numbers, its nodes' and leaves' boxes to floats; the other nine lumps are the same bytes as version
// 30's. Xash's bsp30ext (a version 30 map with its extra header, whose clipnodes may be 32 bit and are numbered
// again for each model) is not read: its clipnodes are taken as version 30's.
import { readLumps, lumpBytes } from "./lumps.mjs";
import { parseEntities } from "./entities.mjs";
import { miptexHeader, readMiptex } from "./miptex.mjs";
import { listedWads } from "./wad.mjs";

// ── the format ─────────────────────────────────────────────────────────────
// Each table below is one struct of the engine's bspfile.h, under the name it has there: where each of its
// fields is, in bytes from the struct's start, and `sizeof`, how long it is. Numbers are little endian.

const INT16 = 2;
const INT32 = 4;
const FLOAT32 = 4;
const VEC3 = 3 * FLOAT32;
/** A map has four hulls: the world as a point meets it, and as three sizes of box do. */
const HULL_COUNT = 4;

// dplane_t: every point p of the plane has normal . p = dist
const PLANE = { normal: 0, dist: 12, type: 16, sizeof: 20 };
// dvertex_t
const VERTEX = { point: 0, sizeof: VEC3 };
// dedge_t: two vertices, by number
const EDGE = { v: 0, sizeof: 2 * INT16 };
/** A surfedge is one 32 bit number: an edge, or minus an edge for the edge walked from its second vertex. */
const SURFEDGE = INT32;
/** A marksurface is one 16 bit number: a face. A leaf's are the faces that touch it. */
const MARKSURFACE = INT16;
// dface_t
const FACE = {
  planenum: 0,
  side: 2, // not 0: the face looks the other way from its plane's normal
  firstedge: 4, // into the surfedges
  numedges: 8,
  texinfo: 10,
  styles: 12, // four bytes: the light styles its lightmap has, 255 for none
  lightofs: 16, // into the lighting lump; -1: no lightmap
  sizeof: 20,
};
/** How many light styles a face can have, and the byte that stands for "no style here". */
const FACE_STYLES = 4;
const NO_STYLE = 255;
/** dface_t.lightofs of a face that has no lightmap. */
const NO_LIGHT = -1;
// texinfo_t: `vecs` is two rows of four floats: the texture's S axis and its offset, then its T axis and
// its offset. A point p is at pixel (p . S + S offset, p . T + T offset) of the texture.
const TEXINFO = { vecs: 0, miptex: 32, flags: 36, sizeof: 40 };
const TEXINFO_AXIS = 4 * FLOAT32;
/** texinfo_t.flags: sky or liquid, which has no lightmap (TEX_SPECIAL). */
const TEX_SPECIAL = 1;
// dmodel_t
const MODEL = {
  mins: 0,
  maxs: 12,
  origin: 24,
  headnode: 36, // int[4]: where each hull's tree begins
  visleafs: 52, // the leaves that have visibility, the solid leaf 0 not counted
  firstface: 56,
  numfaces: 60,
  sizeof: 64,
};
// dnode_t: a plane and what is on each side of it; a child under 0 is a leaf, -(leaf + 1)
const NODE = {
  planenum: 0,
  children: 4, // short[2]: in front of the plane, and behind it
  mins: 8, // short[3]
  maxs: 14,
  firstface: 20,
  numfaces: 22,
  sizeof: 24,
};
// dleaf_t
const LEAF = {
  contents: 0,
  visofs: 4, // into the visibility lump; -1: none kept
  mins: 8,
  maxs: 14,
  firstmarksurface: 20,
  nummarksurfaces: 22,
  ambient_level: 24, // four bytes: how loud water, sky, slime and lava sound here
  sizeof: 28,
};
const AMBIENT_SOUNDS = 4;
/** dleaf_t.visofs of a leaf with no visibility kept. */
const NO_VISIBILITY = -1;
// dclipnode_t: a plane and what is on each side; a child under 0 is not a leaf but the contents itself
const CLIPNODE = { planenum: 0, children: 4, sizeof: 8 };

// BSP2's six wider structs, as Xash3D FWGS's common/bspfile.h has them (dnode32_t, dleaf32_t, dclipnode32_t,
// dface32_t, dedge32_t, dmarkface32_t): every number 32 bits, the boxes floats; the fields mean what the
// version 30 struct's of the same name mean
const NODE32 = { planenum: 0, children: 4, mins: 12, maxs: 24, firstface: 36, numfaces: 40, sizeof: 44 };
const LEAF32 = {
  contents: 0,
  visofs: 4,
  mins: 8, // float[3]
  maxs: 20,
  firstmarksurface: 32,
  nummarksurfaces: 36,
  ambient_level: 40,
  sizeof: 44,
};
const CLIPNODE32 = { planenum: 0, children: 4, sizeof: 12 };
const FACE32 = {
  planenum: 0,
  side: 4,
  firstedge: 8,
  numedges: 12,
  texinfo: 16,
  styles: 20,
  lightofs: 24,
  sizeof: 28,
};
const EDGE32 = { v: 0, sizeof: 2 * INT32 };
const MARKSURFACE32 = INT32;
// dmiptexlump_t, the textures lump: a count, then for each texture where its miptex_t begins, counted from
// the lump's start (-1: the texture is not there)
const TEXTURES = { nummiptex: 0, dataofs: 4 };
const NO_TEXTURE = -1;

/** How big each lump's entries are, for the lumps that are lists of one struct. */
export const ENTRY_SIZES = {
  planes: PLANE.sizeof,
  vertices: VERTEX.sizeof,
  nodes: NODE.sizeof,
  texinfo: TEXINFO.sizeof,
  faces: FACE.sizeof,
  clipnodes: CLIPNODE.sizeof,
  leaves: LEAF.sizeof,
  marksurfaces: MARKSURFACE,
  edges: EDGE.sizeof,
  surfedges: SURFEDGE,
  models: MODEL.sizeof,
};
/** The same for a BSP2 map: six of them wider. */
export const BSP2_ENTRY_SIZES = {
  ...ENTRY_SIZES,
  nodes: NODE32.sizeof,
  faces: FACE32.sizeof,
  clipnodes: CLIPNODE32.sizeof,
  leaves: LEAF32.sizeof,
  marksurfaces: MARKSURFACE32,
  edges: EDGE32.sizeof,
};
/** The entry sizes of a map's format: `format` as `readBsp` and `locateLumps` give it ("bsp30", "bsp2"). */
export const entrySizesOf = (format) => (format === "bsp2" ? BSP2_ENTRY_SIZES : ENTRY_SIZES);

/** What a leaf, or a place in a hull, holds (CONTENTS_* of bspfile.h). */
export const CONTENTS = {
  EMPTY: -1,
  SOLID: -2,
  WATER: -3,
  SLIME: -4,
  LAVA: -5,
  SKY: -6,
  ORIGIN: -7, // used up by the compiler
  CLIP: -8, // made solid by the compiler
  CURRENT_0: -9,
  CURRENT_90: -10,
  CURRENT_180: -11,
  CURRENT_270: -12,
  CURRENT_UP: -13,
  CURRENT_DOWN: -14,
  TRANSLUCENT: -15,
  LADDER: -16,
};
const CONTENTS_NAMES = Object.fromEntries(
  Object.entries(CONTENTS).map(([name, value]) => [value, name.toLowerCase()]),
);
/**
 * A contents number in words: "empty", "solid", "water" ...; "unknown (n)" for one the format does not name.
 */
export const contentsName = (contents) => CONTENTS_NAMES[contents] ?? `unknown (${contents})`;

/**
 * The four hulls. Hull 0 is the drawn world, met by a point. The others are the world grown by half the size
 * of a box, so that the box's middle can be asked about as a point: `mins` and `maxs` are the box about its
 * middle.
 */
export const HULLS = [
  { name: "point", mins: [0, 0, 0], maxs: [0, 0, 0] },
  { name: "standing", mins: [-16, -16, -36], maxs: [16, 16, 36] }, // a player on his feet: 32 x 32 x 72
  { name: "large", mins: [-32, -32, -32], maxs: [32, 32, 32] }, // a big monster: 64 x 64 x 64
  { name: "crouching", mins: [-16, -16, -18], maxs: [16, 16, 18] }, // a player ducked: 32 x 32 x 36
];

/** A lightmap has one sample for every 16 units of a face, along each axis of its texture. */
export const LUXEL = 16;
/** A lightmap's sample: three bytes, r g b. */
const SAMPLE = 3;
/** The furthest a walk down a tree goes before the tree is taken to loop (a broken file). */
const DEEPEST_WALK = 100000;
/** How far down `floorUnder` looks unless told, and how finely it places the floor it finds. */
const FLOOR_REACH = 4096;
const FLOOR_STEP = 1;
const FLOOR_HALVINGS = 12;
const FLOOR_GRAIN = 64;

// ── small tools ────────────────────────────────────────────────────────────
const vec3At = (bytes, at) => [
  bytes.readFloatLE(at),
  bytes.readFloatLE(at + FLOAT32),
  bytes.readFloatLE(at + 2 * FLOAT32),
];
const shorts3At = (bytes, at) => [
  bytes.readInt16LE(at),
  bytes.readInt16LE(at + INT16),
  bytes.readInt16LE(at + 2 * INT16),
];
/**
 * Every whole entry of a lump that is a list of one struct, each read by `read(lump bytes, where it begins)`.
 */
function entriesOf(bytes, lump, size, read) {
  const data = lumpBytes(bytes, lump);
  const list = [];
  for (let at = 0; at + size <= data.length; at += size) list.push(read(data, at));
  return list;
}

// ── reading ────────────────────────────────────────────────────────────────
const readPlane = (data, at) => ({
  normal: vec3At(data, at + PLANE.normal),
  dist: data.readFloatLE(at + PLANE.dist),
  type: data.readInt32LE(at + PLANE.type),
});
const readFace = (data, at) => ({
  plane: data.readUInt16LE(at + FACE.planenum),
  side: data.readUInt16LE(at + FACE.side),
  firstEdge: data.readInt32LE(at + FACE.firstedge),
  edgeCount: data.readUInt16LE(at + FACE.numedges),
  texinfo: data.readUInt16LE(at + FACE.texinfo),
  styles: [...data.subarray(at + FACE.styles, at + FACE.styles + FACE_STYLES)],
  lightOffset: data.readInt32LE(at + FACE.lightofs),
});
const axisAt = (data, at) => [
  data.readFloatLE(at),
  data.readFloatLE(at + FLOAT32),
  data.readFloatLE(at + 2 * FLOAT32),
  data.readFloatLE(at + 3 * FLOAT32),
];
const readTexinfo = (data, at) => ({
  s: axisAt(data, at + TEXINFO.vecs),
  t: axisAt(data, at + TEXINFO.vecs + TEXINFO_AXIS),
  texture: data.readInt32LE(at + TEXINFO.miptex),
  flags: data.readInt32LE(at + TEXINFO.flags),
});
const readModel = (data, at) => {
  const headNodes = [];
  for (let hull = 0; hull < HULL_COUNT; hull++)
    headNodes.push(data.readInt32LE(at + MODEL.headnode + hull * INT32));
  return {
    mins: vec3At(data, at + MODEL.mins),
    maxs: vec3At(data, at + MODEL.maxs),
    origin: vec3At(data, at + MODEL.origin),
    headNodes,
    visLeaves: data.readInt32LE(at + MODEL.visleafs),
    firstFace: data.readInt32LE(at + MODEL.firstface),
    faceCount: data.readInt32LE(at + MODEL.numfaces),
  };
};
const readNode = (data, at) => ({
  plane: data.readInt32LE(at + NODE.planenum),
  children: [data.readInt16LE(at + NODE.children), data.readInt16LE(at + NODE.children + INT16)],
  mins: shorts3At(data, at + NODE.mins),
  maxs: shorts3At(data, at + NODE.maxs),
  firstFace: data.readUInt16LE(at + NODE.firstface),
  faceCount: data.readUInt16LE(at + NODE.numfaces),
});
const readLeaf = (data, at) => ({
  contents: data.readInt32LE(at + LEAF.contents),
  visOffset: data.readInt32LE(at + LEAF.visofs),
  mins: shorts3At(data, at + LEAF.mins),
  maxs: shorts3At(data, at + LEAF.maxs),
  firstMarkSurface: data.readUInt16LE(at + LEAF.firstmarksurface),
  markSurfaceCount: data.readUInt16LE(at + LEAF.nummarksurfaces),
  ambient: [...data.subarray(at + LEAF.ambient_level, at + LEAF.ambient_level + AMBIENT_SOUNDS)],
});
const readClipnode = (data, at) => ({
  plane: data.readInt32LE(at + CLIPNODE.planenum),
  children: [data.readInt16LE(at + CLIPNODE.children), data.readInt16LE(at + CLIPNODE.children + INT16)],
});
// the same of BSP2, in the same shape
const ints2At = (data, at) => [data.readInt32LE(at), data.readInt32LE(at + INT32)];
const readFace32 = (data, at) => ({
  plane: data.readInt32LE(at + FACE32.planenum),
  side: data.readInt32LE(at + FACE32.side),
  firstEdge: data.readInt32LE(at + FACE32.firstedge),
  edgeCount: data.readInt32LE(at + FACE32.numedges),
  texinfo: data.readInt32LE(at + FACE32.texinfo),
  styles: [...data.subarray(at + FACE32.styles, at + FACE32.styles + FACE_STYLES)],
  lightOffset: data.readInt32LE(at + FACE32.lightofs),
});
const readNode32 = (data, at) => ({
  plane: data.readInt32LE(at + NODE32.planenum),
  children: ints2At(data, at + NODE32.children),
  mins: vec3At(data, at + NODE32.mins),
  maxs: vec3At(data, at + NODE32.maxs),
  firstFace: data.readInt32LE(at + NODE32.firstface),
  faceCount: data.readInt32LE(at + NODE32.numfaces),
});
const readLeaf32 = (data, at) => ({
  contents: data.readInt32LE(at + LEAF32.contents),
  visOffset: data.readInt32LE(at + LEAF32.visofs),
  mins: vec3At(data, at + LEAF32.mins),
  maxs: vec3At(data, at + LEAF32.maxs),
  firstMarkSurface: data.readInt32LE(at + LEAF32.firstmarksurface),
  markSurfaceCount: data.readInt32LE(at + LEAF32.nummarksurfaces),
  ambient: [...data.subarray(at + LEAF32.ambient_level, at + LEAF32.ambient_level + AMBIENT_SOUNDS)],
});
const readClipnode32 = (data, at) => ({
  plane: data.readInt32LE(at + CLIPNODE32.planenum),
  children: ints2At(data, at + CLIPNODE32.children),
});
/** How each format reads the six lumps in which they differ. */
const WIDE_READERS = {
  bsp30: {
    faces: readFace,
    nodes: readNode,
    leaves: readLeaf,
    clipnodes: readClipnode,
    edges: (data, at) => [data.readUInt16LE(at + EDGE.v), data.readUInt16LE(at + EDGE.v + INT16)],
    marksurfaces: (data, at) => data.readUInt16LE(at),
  },
  bsp2: {
    faces: readFace32,
    nodes: readNode32,
    leaves: readLeaf32,
    clipnodes: readClipnode32,
    edges: (data, at) => ints2At(data, at + EDGE32.v),
    marksurfaces: (data, at) => data.readInt32LE(at),
  },
};

/**
 * The texture directory: one entry for each texture the map names. `embedded`: its pixels are in the map;
 * otherwise they are wanted from a .wad. `at` is where its header begins in the file. An entry the map
 * leaves out (the compilers do, for a texture no face wears) is `{ absent: true }` with an empty name, so
 * that the numbers the texinfo use still fit.
 */
function readTextureDirectory(bytes, lump) {
  const data = lumpBytes(bytes, lump);
  if (data.length < INT32) return [];
  const count = data.readInt32LE(TEXTURES.nummiptex);
  if (count < 0 || TEXTURES.dataofs + count * INT32 > data.length)
    throw new RangeError(`the textures lump says it has ${count} textures, more than it has room for`);
  const textures = [];
  for (let index = 0; index < count; index++) {
    const offset = data.readInt32LE(TEXTURES.dataofs + index * INT32);
    if (offset === NO_TEXTURE) {
      textures.push({ index, name: "", width: 0, height: 0, embedded: false, absent: true, at: -1 });
      continue;
    }
    const header = miptexHeader(data, offset);
    textures.push({
      index,
      name: header.name,
      width: header.width,
      height: header.height,
      embedded: header.embedded,
      absent: false,
      at: lump.offset + offset,
    });
  }
  return textures;
}

/**
 * A map, read: `{ bytes, version, format, blueShift, lumps, entities, planes, vertices, edges, surfedges, faces,
 * texinfo, textures, models, nodes, leaves, marksurfaces, clipnodes }`.
 *
 *   version        the header's first number: 30, or BSP2_VERSION (lumps.mjs) for Xash's BSP2
 *   format         "bsp30" or "bsp2"; everything below has the same shape in both
 *   lumps          { name: { name, slot, offset, length } } for all fifteen (lumps.mjs)
 *   entities       a list of entities, each a list of [key, value] pairs in the file's order (entities.mjs)
 *   planes         [{ normal, dist, type }]
 *   vertices       [[x, y, z]]
 *   edges          [[vertex, vertex]]
 *   surfedges      [edge, or minus an edge walked backwards]
 *   faces          [{ plane, side, firstEdge, edgeCount, texinfo, styles: [4], lightOffset }]
 *   texinfo        [{ s: [x, y, z, offset], t: [x, y, z, offset], texture, flags }]
 *   textures       [{ index, name, width, height, embedded, absent, at }]
 *   models         [{ mins, maxs, origin, headNodes: [4], visLeaves, firstFace, faceCount }]
 *   nodes          [{ plane, children: [front, back], mins, maxs, firstFace, faceCount }]
 *   leaves         [{ contents, visOffset, mins, maxs, firstMarkSurface, markSurfaceCount, ambient: [4] }]
 *   marksurfaces   [face]
 *   clipnodes      [{ plane, children: [front, back] }]
 *
 * The baked light and the visibility stay in the file's bytes: `faceLightmap` and `visibleFrom` read them.
 * Nodes' and leaves' `mins`/`maxs` are whole numbers in version 30 and floats in BSP2.
 * Throws, in words, for a file that is not a GoldSrc or BSP2 map (Quake 1's version 29, Quake 3's IBSP) or
 * that is cut short. `checkBsp` reports the same without throwing.
 */
export function readBsp(bytes) {
  const { version, format, blueShift, lumps } = readLumps(bytes);
  const sizes = entrySizesOf(format);
  const wide = WIDE_READERS[format];
  const list = (name, read) => entriesOf(bytes, lumps[name], sizes[name], read);
  return {
    bytes,
    version,
    format,
    blueShift,
    lumps,
    entities: parseEntities(lumpBytes(bytes, lumps.entities)),
    planes: list("planes", readPlane),
    vertices: list("vertices", (data, at) => vec3At(data, at + VERTEX.point)),
    edges: list("edges", wide.edges),
    surfedges: list("surfedges", (data, at) => data.readInt32LE(at)),
    faces: list("faces", wide.faces),
    texinfo: list("texinfo", readTexinfo),
    textures: readTextureDirectory(bytes, lumps.textures),
    models: list("models", readModel),
    nodes: list("nodes", wide.nodes),
    leaves: list("leaves", wide.leaves),
    marksurfaces: list("marksurfaces", wide.marksurfaces),
    clipnodes: list("clipnodes", wide.clipnodes),
  };
}

// ── the tree ───────────────────────────────────────────────────────────────
/** How far a point is in front of a plane (under 0: behind it). */
const distanceTo = (plane, point) =>
  plane.normal[0] * point[0] + plane.normal[1] * point[1] + plane.normal[2] * point[2] - plane.dist;
/** The model of a map by its number, or a refusal that says how many there are. */
function modelOf(bsp, model) {
  const found = bsp.models[model];
  if (!found) throw new Error(`no model ${model}: the map has ${bsp.models.length}, numbered from 0`);
  return found;
}
/**
 * Walks a tree down from `head` to the side of each plane the point is on, and returns the first child
 * under 0 it comes to. `nodes` is the map's nodes or its clipnodes: the two are walked alike.
 */
function walkDown(bsp, nodes, head, point, what) {
  let at = head;
  for (let steps = 0; at >= 0; steps++) {
    if (steps > DEEPEST_WALK) throw new Error(`the map's ${what} never end: the tree loops (a broken file)`);
    const node = nodes[at];
    const plane = node && bsp.planes[node.plane];
    if (!plane) throw new RangeError(`the map's ${what} point outside the file (at ${at})`);
    at = node.children[distanceTo(plane, point) >= 0 ? 0 : 1];
  }
  return at;
}

/** The leaf a node's child under 0 stands for: -1 is leaf 0, -2 leaf 1. */
const leafOfChild = (child) => -1 - child;

/**
 * The leaf of the drawn world a point is in, by number. Leaf 0 is the one solid leaf every solid place
 * shares. `model`: the map's model to ask (0, the world).
 */
export function leafAt(bsp, point, model = 0) {
  return leafOfChild(walkDown(bsp, bsp.nodes, modelOf(bsp, model).headNodes[0], point, "nodes"));
}

/**
 * What is at a point: a number of `CONTENTS` (-1 empty, -2 solid, -3 water ...; `contentsName` puts it in
 * words). `hull` 0 asks the drawn world about a point; 1, 2 and 3 ask whether the middle of a standing
 * player, a large monster or a crouching player can be there (`HULLS`). `model`: the map's model to ask (0,
 * the world; a brush entity's is in its own space and is not part of the world's tree).
 */
export function contentsAt(bsp, point, { hull = 0, model = 0 } = {}) {
  if (!HULLS[hull]) throw new Error(`hull: 0 to ${HULL_COUNT - 1}, not ${hull}`);
  const head = modelOf(bsp, model).headNodes[hull];
  if (hull > 0) return walkDown(bsp, bsp.clipnodes, head, point, "clipnodes");
  const leaf = bsp.leaves[leafOfChild(walkDown(bsp, bsp.nodes, head, point, "nodes"))];
  if (!leaf) throw new RangeError("the map's nodes point at a leaf it does not have");
  return leaf.contents;
}

/**
 * The height of the floor under a point: the `z` at which, going straight down, solid begins; null when the
 * point is itself in solid or there is none within `reach` units. With `hull` 0 it is the surface a point
 * lands on. With hull 1 to 3 it is where the middle of that box comes to rest: a standing player's feet are
 * 36 under it. `model` as in `contentsAt`.
 */
export function floorUnder(bsp, point, { hull = 0, model = 0, reach = FLOOR_REACH } = {}) {
  const solidAt = (z) => contentsAt(bsp, [point[0], point[1], z], { hull, model }) === CONTENTS.SOLID;
  if (solidAt(point[2])) return null;
  let open = point[2];
  let solid = null;
  for (let fallen = FLOOR_STEP; fallen <= reach; fallen += FLOOR_STEP) {
    if (solidAt(point[2] - fallen)) {
      solid = point[2] - fallen;
      break;
    }
    open = point[2] - fallen;
  }
  if (solid === null) return null;
  // between the last open height and the first solid one, the floor is closed in on by halves
  for (let halving = 0; halving < FLOOR_HALVINGS; halving++) {
    const middle = (open + solid) / 2;
    if (solidAt(middle)) solid = middle;
    else open = middle;
  }
  // to a 64th of a unit; the 0 added makes a floor at height 0 read 0 and not -0
  return Math.round(solid * FLOOR_GRAIN) / FLOOR_GRAIN + 0;
}

/** The box the world fits in: `{ mins, maxs }`, of model 0. */
export const worldBounds = (bsp) => ({ mins: [...bsp.models[0].mins], maxs: [...bsp.models[0].maxs] });

// ── faces ──────────────────────────────────────────────────────────────────
/** A face of a map: the face itself, or its number. */
const faceOf = (bsp, face) => {
  const found = typeof face === "number" ? bsp.faces[face] : face;
  if (!found) throw new Error(`no face ${face}: the map has ${bsp.faces.length}, numbered from 0`);
  return found;
};

/**
 * The faces of one of a map's models (0: the world's own; N: those of the brush entity whose model is `*N`).
 */
export function modelFaces(bsp, model = 0) {
  const { firstFace, faceCount } = modelOf(bsp, model);
  return bsp.faces.slice(firstFace, firstFace + faceCount);
}

/**
 * A face's corners, `[[x, y, z]]`, in the order the file walks them: clockwise seen from the side the face
 * looks to. `face` is one of `bsp.faces`, or its number.
 */
export function facePolygon(bsp, face) {
  const { firstEdge, edgeCount } = faceOf(bsp, face);
  const corners = [];
  for (let nth = 0; nth < edgeCount; nth++) {
    const surfedge = bsp.surfedges[firstEdge + nth];
    const edge = bsp.edges[Math.abs(surfedge)];
    // an edge named with a minus is walked from its second vertex
    const vertex = edge && bsp.vertices[surfedge >= 0 ? edge[0] : edge[1]];
    if (!vertex) throw new RangeError("a face's edges point outside the file");
    corners.push(vertex);
  }
  return corners;
}

/**
 * The way a face looks, a unit vector: its plane's normal, turned about when the face is on the plane's back.
 */
export function faceNormal(bsp, face) {
  const { plane, side } = faceOf(bsp, face);
  const normal = bsp.planes[plane]?.normal;
  if (!normal) throw new RangeError("a face's plane is outside the file");
  return side ? normal.map((value) => -value) : [...normal];
}

/**
 * Where a point is along one axis of a texture, in pixels. The sum is kept in 32 bits, as the compilers
 * keep it: in JavaScript's own 64 a corner that stands exactly on a sample's line can come out a hair to
 * one side, and its face's lightmap one sample bigger than the one in the file.
 */
const alongAxis = (point, axis) =>
  Math.fround(point[0] * axis[0] + point[1] * axis[1] + point[2] * axis[2] + axis[3]);

/** The texinfo of a face, or a refusal. */
function texinfoOf(bsp, face) {
  const texinfo = bsp.texinfo[faceOf(bsp, face).texinfo];
  if (!texinfo) throw new RangeError("a face's texinfo is outside the file");
  return texinfo;
}

/**
 * How a face lays its texture: `{ s: [x, y, z, offset], t: [x, y, z, offset] }`, the texture's two axes in the
 * world (a point's pixel is its dot with the axis plus the offset; `t` runs down the picture).
 */
export function faceTextureAxes(bsp, face) {
  const { s, t } = texinfoOf(bsp, face);
  return { s: [...s], t: [...t] };
}

/**
 * The directory entry of the texture a face wears: `{ index, name, width, height, embedded, absent, at }`.
 */
export function faceTexture(bsp, face) {
  const texture = bsp.textures[texinfoOf(bsp, face).texture];
  if (!texture) throw new RangeError("a face's texture is outside the file");
  return texture;
}

/**
 * Where each corner of a face is on its texture, in pixels from the texture's top left: `[[s, t]]`. They run
 * past the picture's sides where it repeats.
 */
export function faceTexels(bsp, face) {
  const { s, t } = texinfoOf(bsp, face);
  return facePolygon(bsp, face).map((corner) => [alongAxis(corner, s), alongAxis(corner, t)]);
}

/**
 * The same in turns of the texture, the kit's `uv`: `[[u, v]]`, 0 to 1 across the picture once, from its top
 * left.
 */
export function faceUvs(bsp, face) {
  const { width, height, name } = faceTexture(bsp, face);
  if (!width || !height) throw new Error(`the texture ${name || "of this face"} has no size in this map`);
  return faceTexels(bsp, face).map(([s, t]) => [s / width, t / height]);
}

// ── light ──────────────────────────────────────────────────────────────────
/**
 * Whether a face has a lightmap. A face with none has -1 for where its light is; so has not a face whose
 * styles are all "none", though its offset may look good (the compiler leaves a stale one there, which
 * points into another face's light), nor a face of sky or liquid.
 */
export function hasLightmap(bsp, face) {
  const { lightOffset, styles } = faceOf(bsp, face);
  if (lightOffset === NO_LIGHT || styles[0] === NO_STYLE) return false;
  return !(texinfoOf(bsp, face).flags & TEX_SPECIAL);
}

/**
 * The size of a face's lightmap, which is nowhere in the file: it is worked out from the face. `{ width,
 * height, originS, originT }`: samples across and down, and the texture pixel its first sample stands on.
 * A sample stands on every 16th pixel of the texture's axes; the patch runs from the one at or before the
 * face's least corner to the one at or after its greatest, both counted: one more than the difference.
 */
export function lightmapSize(bsp, face) {
  const texels = faceTexels(bsp, face);
  const span = (axis) => {
    const along = texels.map((texel) => texel[axis]);
    const first = Math.floor(Math.min(...along) / LUXEL);
    const last = Math.ceil(Math.max(...along) / LUXEL);
    return { first, count: last - first + 1 };
  };
  const across = span(0);
  const down = span(1);
  return {
    width: across.count,
    height: down.count,
    originS: across.first * LUXEL,
    originT: down.first * LUXEL,
  };
}

/** Bytes per sample of a lightmap in each map, once worked out (by its lighting lump, which spreads keep). */
const SAMPLES_FOUND = new WeakMap();
/**
 * How many bytes each sample of a map's light is: 3 (r g b) or 1 (a grey, as Quake's). A version 30 map's
 * are 3. A BSP2 map may hold either, and the file does not say: Xash works it out from the faces
 * (mod_bmodel.c, Mod_LoadSurfaces: "trying determine samplecount per lightmap pixel", 1 or 3), and so is it
 * here: the samples the lit faces need, against the bytes of light there are. The compilers Half-Life's maps
 * are built with write 3 in BSP2 too.
 */
export function lightSamples(bsp) {
  if (bsp.format !== "bsp2") return SAMPLE;
  const lighting = bsp.lumps.lighting;
  if (SAMPLES_FOUND.has(lighting)) return SAMPLES_FOUND.get(lighting);
  const counted = new Set();
  let needed = 0;
  bsp.faces.forEach((face) => {
    if (counted.has(face.lightOffset) || !hasLightmap(bsp, face)) return;
    counted.add(face.lightOffset);
    const { width, height } = lightmapSize(bsp, face);
    needed += width * height * face.styles.filter((style) => style !== NO_STYLE).length;
  });
  const samples = needed && lighting.length < needed * SAMPLE ? 1 : SAMPLE;
  SAMPLES_FOUND.set(lighting, samples);
  return samples;
}

/**
 * A face's baked light: `{ width, height, originS, originT, styles: [{ style, rgb }] }`, or null for a face
 * that has none (sky, liquid, a face the compiler left unlit). Each `rgb` is `width * height` samples of
 * three bytes, row after row from the texture's top, a view of the map's bytes (a copy, each grey byte made
 * three, for a BSP2 map whose light is grey: `lightSamples`). `style` 0 is the light
 * that is always on; the others are lights that flicker or are switched, which the game adds on top (see
 * docs/MAPS.md). The sample for a point at texture pixel (s, t) is at ((s - originS) / 16, (t - originT) /
 * 16).
 */
export function faceLightmap(bsp, face) {
  if (!hasLightmap(bsp, face)) return null;
  const found = faceOf(bsp, face);
  const size = lightmapSize(bsp, found);
  const samples = lightSamples(bsp);
  const block = size.width * size.height * samples;
  const lighting = lumpBytes(bsp.bytes, bsp.lumps.lighting);
  const styles = found.styles
    .filter((style) => style !== NO_STYLE)
    .map((style, nth) => {
      const from = found.lightOffset + nth * block;
      if (from + block > lighting.length)
        throw new RangeError("a face's lightmap runs past the end of the map's light");
      const stored = lighting.subarray(from, from + block);
      if (samples === SAMPLE) return { style, rgb: stored };
      const rgb = Buffer.alloc(stored.length * SAMPLE);
      stored.forEach((grey, at) => rgb.fill(grey, at * SAMPLE, (at + 1) * SAMPLE));
      return { style, rgb };
    });
  return { ...size, styles };
}

// ── visibility ─────────────────────────────────────────────────────────────
/**
 * The leaves that can be seen from a leaf, as the compiler worked out: a list of leaf numbers, the leaf
 * itself among them, in rising order. Null when the map keeps none for that leaf (a map compiled without
 * hlvis, or leaf 0, the solid one): the engine then draws everything. `leaf` is a number, as `leafAt` gives.
 *
 * In the file a leaf's row has one bit for each leaf from 1 on, and is packed: a zero byte is followed by
 * a count of how many zero bytes it stands for.
 */
export function visibleFrom(bsp, leaf) {
  const from = bsp.leaves[leaf];
  if (!from) throw new Error(`no leaf ${leaf}: the map has ${bsp.leaves.length}, numbered from 0`);
  const packed = lumpBytes(bsp.bytes, bsp.lumps.visibility);
  if (leaf === 0 || from.visOffset === NO_VISIBILITY || !packed.length) return null;
  const leafCount = bsp.models[0].visLeaves;
  const rowBytes = (leafCount + 7) >> 3;
  const seen = [];
  let at = from.visOffset;
  let byte = 0;
  while (byte < rowBytes) {
    if (at >= packed.length)
      throw new RangeError(`the visibility of leaf ${leaf} runs past the end of its lump`);
    const bits = packed[at++];
    if (!bits) {
      // a run of zero bytes: nothing seen for eight leaves a byte
      if (at >= packed.length)
        throw new RangeError(`the visibility of leaf ${leaf} runs past the end of its lump`);
      byte += packed[at++];
      continue;
    }
    for (let bit = 0; bit < 8; bit++) {
      const other = byte * 8 + bit + 1;
      if (bits & (1 << bit) && other <= leafCount) seen.push(other);
    }
    byte++;
  }
  return seen;
}

/** Whether leaf `to` can be seen from leaf `from`. True when the map keeps no visibility for `from`. */
export function sees(bsp, from, to) {
  const seen = visibleFrom(bsp, from);
  return seen === null || seen.includes(to);
}

// ── textures ───────────────────────────────────────────────────────────────
/**
 * The number of a texture in a map's directory: `which` is a number or a name, whatever its case. -1 when
 * there is none.
 */
const textureAt = (bsp, which) =>
  typeof which === "number"
    ? which
    : bsp.textures.findIndex((texture) => texture.name.toLowerCase() === String(which).toLowerCase());

/**
 * A texture whose pixels are inside the map: `{ name, width, height, pixels, palette, mips, holes }`
 * (miptex.mjs; `textureRgba` makes a picture of it). Null when the map only names it and wants it from a
 * .wad, and for a name the map does not have (so that one name is looked for in several maps in turn).
 * `which` is its number in `bsp.textures`, or its name; a number the map has none for is refused.
 */
export function embeddedTexture(bsp, which) {
  const entry = bsp.textures[textureAt(bsp, which)];
  if (!entry && typeof which !== "number") return null;
  if (!entry) throw new Error(`no texture ${which} in this map (it has ${bsp.textures.length})`);
  if (entry.absent || !entry.embedded) return null;
  return readMiptex(bsp.bytes, entry.at);
}

/**
 * What a map needs from outside itself to be drawn: `{ wads, textures }`. `textures`: the names of those it
 * wants from .wad files. `wads`: the files its worldspawn lists, as the engine looks for them (file names
 * only, lower case). GoldSrc opens every listed file when the map wants even one texture, and stops when
 * one is not there. `wadsFor` and `texturesFor` (wad.mjs) look for them in a game's folders.
 */
export function wantedTextures(bsp) {
  const listed = (bsp.entities[0] ?? []).find((pair) => pair[0] === "wad");
  return {
    wads: listedWads(listed?.[1]),
    textures: bsp.textures
      .filter((texture) => !texture.absent && !texture.embedded)
      .map((texture) => texture.name),
  };
}
