// A map looked over before it goes into a game: what would stop the engine loading it or make it draw wrong
// (errors), what it will put up with but should be known (warnings), and what the map is and needs (facts).
// It is the maps' counterpart of check.mjs for models, and answers in the same form.
//
//   goldsrc   Half-Life's own engine (Steam), which a GoldSrc mod runs on today
//   xash      Xash3D FWGS, which holds more
import { locateLumps, LUMP_NAMES, HEADER_SIZE } from "../../core/maps/lumps.mjs";
import {
  readBsp,
  entrySizesOf,
  CONTENTS,
  hasLightmap,
  lightmapSize,
  facePolygon,
  wantedTextures,
  embeddedTexture,
  worldBounds,
} from "../../core/maps/bsp.mjs";
import { valueOf, brushModelOf, LONGEST_KEY, LONGEST_VALUE, modelless } from "../../core/maps/entities.mjs";
import { miptexHeader, enginePaletteAt, TEXTURE_GRID, MIP_LEVELS } from "../../core/maps/miptex.mjs";
import { texturesFor } from "../../core/maps/wad.mjs";
import { spriteOf, spriteBorder } from "../../make/maps/sprites.mjs";
import { modOf } from "../../make/maps/mod.mjs";
import { checkEntities as checkAgainstMod } from "./rules.mjs";

/**
 * How many of each thing an engine holds in a version 30 map. Where each number is from:
 *
 * goldsrc, from the engine's code as ReHLDS has it (rehlds/engine/model.cpp, public/rehlds/bspfile.h) and
 * from the format's own header as Valve's SDK ships it (utils/common/bspfile.h):
 *   planes        32767   MAX_MAP_PLANES of the SDK; and Mod_LoadFaces reads a face's plane as a signed short
 *   nodes         32767   MAX_MAP_NODES: a node's children are signed shorts, and under 0 is a leaf
 *   clipnodes     32767   MAX_MAP_CLIPNODES: the same, and under 0 is a contents
 *   leaves        32767   MAX_MAP_LEAFS of the engine's bspfile.h (its visibility row is that many bits).
 *                         The SDK's compilers stopped at 8192
 *   vertices      65535   MAX_MAP_VERTS: an edge names its vertices with unsigned shorts
 *   faces         65535   MAX_MAP_FACES: a node names its faces with unsigned shorts
 *   marksurfaces  65535   MAX_MAP_MARKSURFACES: a leaf names its first with an unsigned short
 *   texinfo       32767   Mod_LoadFaces reads a face's texinfo as a signed short (the SDK's compilers: 8192)
 *   models        512     MAX_MODELS of common/qlimits.h (9 bits on the wire): every brush model takes one of
 *                         the slots that the game's .mdl and .spr files also need. The SDK's compilers: 400
 * The SDK's other numbers (256000 edges, 512000 surfedges, 512 textures, 2 MB of light) bound its old
 * compilers, not the engine, which takes these lumps at whatever size they are: today's maps pass them.
 *
 * xash, from Xash3D FWGS's common/bspfile.h (MAX_MAP_*), each cut down to what the 16 bit numbers of a
 * version 30 map can name where that is less:
 *   planes 131072   edges 1048576   surfedges 2097152   models 2048   textures 2048   entities 8192
 *   nodes, clipnodes 32767 (MAX_MAP_CLIPNODES_HLBSP; signed shorts)   leaves 32768 (131072, but a node's
 *   child is a short)   vertices, faces, marksurfaces, texinfo 65535 (524288, 262144, 524288, 262144, but
 *   unsigned shorts)
 * and, in bytes: entity text 2 MB (MAX_MAP_ENTSTRING), textures 32 MB (MAX_MAP_MIPTEX), light 32 MB
 * (MAX_MAP_LIGHTING), visibility 16 MB (MAX_MAP_VISIBILITY).
 */
export const MAP_LIMITS = {
  goldsrc: {
    planes: 32767,
    nodes: 32767,
    clipnodes: 32767,
    leaves: 32767,
    vertices: 65535,
    faces: 65535,
    marksurfaces: 65535,
    texinfo: 32767,
    models: 512,
  },
  xash: {
    planes: 131072,
    nodes: 32767,
    clipnodes: 32767,
    leaves: 32768,
    vertices: 65535,
    faces: 65535,
    marksurfaces: 65535,
    texinfo: 65535,
    edges: 1048576,
    surfedges: 2097152,
    models: 2048,
    textures: 2048,
    entities: 8192,
    entityBytes: 0x200000,
    textureBytes: 0x2000000,
    lightBytes: 0x2000000,
    visibilityBytes: 0x1000000,
  },
};
/**
 * Xash's limits for a BSP2 map, whose 32 bit numbers name all that common/bspfile.h allows: MAX_MAP_NODES
 * 262144, MAX_MAP_CLIPNODES_BSP2 524288, MAX_MAP_LEAFS 131072, MAX_MAP_VERTS 524288, MAX_MAP_FACES 262144,
 * MAX_MAP_MARKSURFACES 524288, MAX_MAP_TEXINFO (= MAX_MAP_FACES). GoldSrc does not load BSP2 at all.
 */
const XASH_BSP2_LIMITS = {
  ...MAP_LIMITS.xash,
  nodes: 262144,
  clipnodes: 524288,
  leaves: 131072,
  vertices: 524288,
  faces: 262144,
  marksurfaces: 524288,
  texinfo: 262144,
};
/** The limits that are counted in bytes of a lump: which lump each is of. */
const BYTE_LIMITS = {
  entityBytes: "entities",
  textureBytes: "textures",
  lightBytes: "lighting",
  visibilityBytes: "visibility",
};

/**
 * GoldSrc reads the faces a leaf names (the marksurfaces), a face's plane and its texinfo as signed shorts:
 * a number over this comes out under 0 and the engine reads before its tables.
 */
const SIGNED_SHORT_MOST = 32767;
/**
 * The widest a lit face may be across its texture, in pixels: MAX_SURFACE_TEXTURE_SIZE of the engine's
 * model.h, 512 for the OpenGL renderer and the dedicated server (Mod_LoadFaces stops with "Bad surface
 * extents" over it) and 256 for the software renderer. In samples of light, 33 and 17 a side.
 */
const WIDEST_FACE = 512;
const WIDEST_FACE_SOFTWARE = 256;
const LUXEL = 16;
/** Xash refuses an entity lump shorter than this (the `mincount` of its entities in mod_bmodel.c). */
const XASH_LEAST_ENTITY_BYTES = 32;
/**
 * The letters of the two blocks of extra lumps other tools add: Xash's own, after the header, and BSPX, after
 * the lumps.
 */
const XASH_EXTRA_ID = "XASH";
const BSPX_ID = "BSPX";
/** Near a limit: this share of it. */
const NEAR_LIMIT = 0.75;
/** How many names a sentence lists before it counts the rest. */
const NAMES_LISTED = 6;
/** The files an entity can name, by what they are. */
const RESOURCE_KINDS = { models: /\.mdl$/i, sprites: /\.spr$/i, sounds: /\.(wav|mp3)$/i };

/** The first few of a list of names, and how many more there are. */
const some = (list, listed = NAMES_LISTED) =>
  `${list.slice(0, listed).join(", ")}${list.length > listed ? ` and ${list.length - listed} more` : ""}`;
/** What is said of a file in which something points past its end. */
const cutShort = (bytes) =>
  `the map is cut short or broken: something in it points past its end (it is ${bytes.length} bytes long)`;

// ── the lumps ──────────────────────────────────────────────────────────────
/**
 * Every lump inside the file and a whole number of entries long. False when the file cannot be read further.
 */
function checkLumps(bytes, located, { errors }) {
  let whole = true;
  for (const name of LUMP_NAMES) {
    const lump = located.lumps[name];
    if (!lump.inside) {
      errors.push(
        `the ${name} lump is said to be at ${lump.offset}, ${lump.length} bytes long, and the file is ${bytes.length} bytes long: the map is cut short or broken`,
      );
      whole = false;
      continue;
    }
    const size = entrySizesOf(located.format)[name];
    if (size && lump.length % size)
      errors.push(
        `the ${name} lump is ${lump.length} bytes long, not a whole number of its ${size} byte entries: the engine stops with "funny lump size"`,
      );
  }
  return whole;
}

/** The counts against what the engine holds. */
function checkCounts(bsp, engine, { errors, warnings }) {
  const limits = engine === "xash" && bsp.format === "bsp2" ? XASH_BSP2_LIMITS : MAP_LIMITS[engine];
  const counts = {
    planes: bsp.planes.length,
    nodes: bsp.nodes.length,
    clipnodes: bsp.clipnodes.length,
    leaves: bsp.leaves.length,
    vertices: bsp.vertices.length,
    faces: bsp.faces.length,
    marksurfaces: bsp.marksurfaces.length,
    texinfo: bsp.texinfo.length,
    edges: bsp.edges.length,
    surfedges: bsp.surfedges.length,
    models: bsp.models.length,
    textures: bsp.textures.length,
    entities: bsp.entities.length,
  };
  for (const [limit, lump] of Object.entries(BYTE_LIMITS)) counts[limit] = bsp.lumps[lump].length;
  for (const [what, most] of Object.entries(limits)) {
    const has = counts[what];
    const named = BYTE_LIMITS[what] ? `bytes of ${BYTE_LIMITS[what]}` : what;
    if (has > most) errors.push(`${has} ${named}: ${engine} holds ${most}`);
    else if (has > most * NEAR_LIMIT) warnings.push(`${has} ${named}: near the ${most} that ${engine} holds`);
  }
  // not a fault, but the number an author must add the game's models and sprites to
  if (engine === "goldsrc" && counts.models - 1 > limits.models / 2)
    warnings.push(
      `${counts.models - 1} brush entities take ${counts.models - 1} of the ${limits.models} slots GoldSrc has for every model and sprite the game loads on this map`,
    );
  return counts;
}

// ── what points at what ────────────────────────────────────────────────────
/** Every number in the file that names a thing in another lump names one that is there. */
function checkReferences(bsp, engine, { errors }) {
  const bad = (what) => errors.push(`${what}: the map is broken`);
  const count = (list, wrong) => list.reduce((sum, each) => sum + (wrong(each) ? 1 : 0), 0);

  const badPlanes = count(bsp.faces, (face) => face.plane >= bsp.planes.length);
  if (badPlanes) bad(`${badPlanes} faces name a plane the map does not have`);
  const badTexinfo = count(bsp.faces, (face) => face.texinfo >= bsp.texinfo.length);
  if (badTexinfo) bad(`${badTexinfo} faces name a texinfo the map does not have`);
  const badEdges = count(
    bsp.faces,
    (face) => face.firstEdge < 0 || face.firstEdge + face.edgeCount > bsp.surfedges.length,
  );
  if (badEdges) bad(`${badEdges} faces name edges the map does not have`);
  const badTextures = count(
    bsp.texinfo,
    (texinfo) => texinfo.texture < 0 || texinfo.texture >= bsp.textures.length,
  );
  if (badTextures) bad(`${badTextures} texinfo name a texture the map does not have`);
  const badMarks = count(bsp.marksurfaces, (face) => face >= bsp.faces.length);
  if (badMarks) bad(`${badMarks} marksurfaces name a face the map does not have`);
  const badLeafMarks = count(
    bsp.leaves,
    (leaf) => leaf.firstMarkSurface + leaf.markSurfaceCount > bsp.marksurfaces.length,
  );
  if (badLeafMarks) bad(`${badLeafMarks} leaves name marksurfaces the map does not have`);
  const badNodes = count(bsp.nodes, (node) =>
    node.children.some((child) =>
      child >= 0 ? child >= bsp.nodes.length : -(child + 1) >= bsp.leaves.length,
    ),
  );
  if (badNodes) bad(`${badNodes} nodes have a child the map does not have`);
  const badClipnodes = count(bsp.clipnodes, (node) =>
    node.children.some((child) => child >= bsp.clipnodes.length),
  );
  if (badClipnodes) bad(`${badClipnodes} clipnodes have a child the map does not have`);
  const visibility = bsp.lumps.visibility.length;
  const badVisibility = count(bsp.leaves, (leaf) => leaf.visOffset >= 0 && leaf.visOffset >= visibility);
  if (badVisibility && visibility)
    bad(`${badVisibility} leaves keep their visibility past the end of its lump`);
  const badModels = count(
    bsp.models,
    (model) => model.firstFace < 0 || model.firstFace + model.faceCount > bsp.faces.length,
  );
  if (badModels) bad(`${badModels} models name faces the map does not have`);

  if (engine === "goldsrc") {
    // the numbers GoldSrc reads as signed shorts
    const lostPlanes = count(bsp.faces, (face) => face.plane > SIGNED_SHORT_MOST);
    const lostTexinfo = count(bsp.faces, (face) => face.texinfo > SIGNED_SHORT_MOST);
    const lostFaces = count(bsp.marksurfaces, (face) => face > SIGNED_SHORT_MOST);
    if (lostPlanes)
      errors.push(
        `${lostPlanes} faces are on a plane numbered over ${SIGNED_SHORT_MOST}, which GoldSrc reads as under 0`,
      );
    if (lostTexinfo)
      errors.push(
        `${lostTexinfo} faces have a texinfo numbered over ${SIGNED_SHORT_MOST}, which GoldSrc reads as under 0`,
      );
    if (lostFaces)
      errors.push(
        `${lostFaces} of the leaves' faces are numbered over ${SIGNED_SHORT_MOST}, which GoldSrc reads as under 0: its limit on faces in the world is in practice ${SIGNED_SHORT_MOST + 1}`,
      );
  }
}

// ── light and visibility ───────────────────────────────────────────────────
/** Each lit face's light inside the lump, and no face wider than the engine lights. */
function checkLight(bsp, engine, { errors, warnings, facts }) {
  const lightBytes = bsp.lumps.lighting.length;
  let lit = 0;
  let samples = 0;
  let past = 0;
  let tooWide = 0;
  let wideForSoftware = 0;
  const styles = new Set();
  bsp.faces.forEach((face) => {
    if (face.edgeCount < 3 || !hasLightmap(bsp, face)) return;
    const size = lightmapSize(bsp, face);
    const styleCount = face.styles.filter((style) => style !== 255).length;
    face.styles.forEach((style) => style !== 255 && styles.add(style));
    lit++;
    samples += size.width * size.height;
    if (face.lightOffset + size.width * size.height * 3 * styleCount > lightBytes) past++;
    const widest = (Math.max(size.width, size.height) - 1) * LUXEL;
    if (widest > WIDEST_FACE) tooWide++;
    else if (widest > WIDEST_FACE_SOFTWARE) wideForSoftware++;
  });
  if (past)
    errors.push(`the light of ${past} faces runs past the end of the lighting lump: the map is broken`);
  if (tooWide && engine === "goldsrc")
    errors.push(
      `${tooWide} lit faces are wider than ${WIDEST_FACE} pixels of their texture: GoldSrc stops with "Bad surface extents"`,
    );
  if (wideForSoftware && engine === "goldsrc")
    warnings.push(
      `${wideForSoftware} lit faces are wider than ${WIDEST_FACE_SOFTWARE} pixels of their texture: GoldSrc's software renderer stops on them (its OpenGL one does not)`,
    );
  if (!lightBytes && bsp.faces.length)
    warnings.push(
      "no baked light (compiled without hlrad): the engine draws the whole map at full brightness",
    );
  else
    facts.push(
      `light: ${lit} of ${bsp.faces.length} faces lit, ${samples} samples, ${lightBytes} bytes; styles ${[...styles].sort((a, b) => a - b).join(" ")}`,
    );
  const kept = bsp.leaves.filter((leaf) => leaf.visOffset >= 0).length;
  if (!bsp.lumps.visibility.length && bsp.leaves.length > 1)
    warnings.push(
      "no visibility (compiled without hlvis, or with a leak): the engine draws the whole map from everywhere",
    );
  else
    facts.push(
      `visibility: ${kept} of ${bsp.leaves.length} leaves keep what they see, ${bsp.lumps.visibility.length} bytes`,
    );
}

// ── textures ───────────────────────────────────────────────────────────────
/**
 * The textures inside the map whole and of sizes the engine takes; those wanted from .wad files, and whether
 * found.
 */
function checkTextures(bsp, engine, folders, { errors, warnings, facts }) {
  const used = new Set(bsp.faces.map((face) => bsp.texinfo[face.texinfo].texture));
  const embedded = [];
  for (const entry of bsp.textures) {
    if (entry.absent) {
      if (used.has(entry.index))
        warnings.push(
          `texture ${entry.index} is worn by faces but is not in the map: drawn as the engine's stand-in`,
        );
      continue;
    }
    if (entry.width % TEXTURE_GRID || entry.height % TEXTURE_GRID || !entry.width || !entry.height)
      (engine === "goldsrc" ? errors : warnings).push(
        `the texture ${entry.name} is ${entry.width}x${entry.height}: GoldSrc stops on a side that is not a multiple of ${TEXTURE_GRID}`,
      );
    if (!entry.embedded) continue;
    embedded.push(entry.name);
    try {
      embeddedTexture(bsp, entry.index);
      const header = miptexHeader(bsp.bytes, entry.at);
      const paletteAt =
        header.offsets[MIP_LEVELS - 1] +
        (header.width >> (MIP_LEVELS - 1)) * (header.height >> (MIP_LEVELS - 1)) +
        2;
      if (paletteAt !== enginePaletteAt(header))
        warnings.push(
          `the texture ${entry.name} keeps its four sizes apart from one another: GoldSrc takes them to follow its header and would read its palette from the wrong place`,
        );
    } catch (e) {
      errors.push(e.message);
    }
  }
  const wanted = wantedTextures(bsp);
  facts.push(
    `textures: ${bsp.textures.length}, ${embedded.length} with their pixels inside the map, ${wanted.textures.length} wanted from .wad files`,
  );
  if (!wanted.textures.length) return { wanted, found: null };
  facts.push(`wanted from .wad files: ${some(wanted.textures)}`);
  facts.push(
    wanted.wads.length
      ? `the worldspawn lists ${wanted.wads.length} .wad files: ${some(wanted.wads)}`
      : "the worldspawn lists no .wad file",
  );
  if (!wanted.wads.length)
    warnings.push(
      `${wanted.textures.length} textures are wanted from .wad files and the worldspawn's "wad" key lists none: they are drawn as the engine's stand-in`,
    );
  if (!folders) {
    facts.push(
      "no game folders were given: whether the .wad files and their textures are there was not looked at",
    );
    return { wanted, found: null };
  }
  const found = texturesFor(bsp, folders);
  if (found.wads.missing.length)
    (engine === "goldsrc" ? errors : warnings).push(
      `${found.wads.missing.length} of the listed .wad files are not in the folders given (${some(found.wads.missing)}): GoldSrc stops with "couldn't open" on the first it does not find`,
    );
  for (const wad of found.unreadable)
    warnings.push(`${wad.name} was found and could not be read: ${wad.reason}`);
  if (found.missing.length)
    warnings.push(
      `${found.missing.length} textures are in none of the .wad files found (${some(found.missing)}): drawn as the engine's stand-in`,
    );
  facts.push(
    `found in the folders given: ${found.wads.found.length} of ${wanted.wads.length} .wad files, ${found.textures.length} of ${wanted.textures.length} textures`,
  );
  return { wanted, found };
}

// ── entities ───────────────────────────────────────────────────────────────

/**
 * The entities: a worldspawn first, brush entities on models the map has, and nothing the engine cannot read.
 */
function checkEntities(bsp, engine, { errors, warnings, facts }) {
  const { entities } = bsp;
  if (!entities.length) {
    errors.push("the map has no entities: not even a worldspawn");
    return { models: [], sprites: [], sounds: [] };
  }
  if (valueOf(entities[0], "classname") !== "worldspawn")
    errors.push("the map's first entity is not the worldspawn: the engine takes the first to be the world");
  if (engine === "xash" && bsp.lumps.entities.length < XASH_LEAST_ENTITY_BYTES)
    errors.push(
      `the entity lump is ${bsp.lumps.entities.length} bytes: Xash refuses one under ${XASH_LEAST_ENTITY_BYTES}`,
    );

  const empty = modelless(entities, valueOf);
  if (empty.length)
    errors.push(
      `${empty.length} entities precache a model they do not name, and the map stops on load ("PF_precache_model_I: Bad string ''"): ${empty.slice(0, 8).map(({ entity, index }) => `${index} ${valueOf(entity, "classname")}`).join(", ")}: give each its model (a sprite for env_sprite and env_glow)`,
    );
  const shown = new Set([0]);
  const nameless = [];
  const longKeys = [];
  const longValues = [];
  const resources = { models: new Set(), sprites: new Set(), sounds: new Set() };
  entities.forEach((entity, index) => {
    const classname = valueOf(entity, "classname");
    if (classname === undefined) nameless.push(index);
    const model = brushModelOf(entity);
    if (model !== null) {
      shown.add(model);
      if (model >= bsp.models.length)
        errors.push(
          `entity ${index} (${classname}) is made of model *${model}, and the map has only ${bsp.models.length} models`,
        );
    }
    for (const [key, value] of entity) {
      if (key.length > LONGEST_KEY) longKeys.push(`${key} of entity ${index}`);
      if (value.length > LONGEST_VALUE) longValues.push(`${key} of entity ${index}`);
      for (const [kind, pattern] of Object.entries(RESOURCE_KINDS))
        if (pattern.test(value)) resources[kind].add(value.replace(/\\/g, "/"));
    }
  });
  if (nameless.length)
    warnings.push(`${nameless.length} entities have no classname (${some(nameless)}): the engine drops them`);
  if (longValues.length)
    errors.push(`values longer than the ${LONGEST_VALUE} letters the engine reads: ${some(longValues)}`);
  if (longKeys.length)
    warnings.push(
      `keys longer than the ${LONGEST_KEY} letters the compilers and the game's code expect: ${some(longKeys)}`,
    );
  const orphans = bsp.models.map((_, model) => model).filter((model) => !shown.has(model));
  if (orphans.length)
    warnings.push(
      `${orphans.length} of the map's models belong to no entity (${some(orphans.map((model) => `*${model}`))}): they are in the file and never shown`,
    );

  const classes = new Map();
  for (const entity of entities) {
    const classname = valueOf(entity, "classname") ?? "(no classname)";
    classes.set(classname, (classes.get(classname) ?? 0) + 1);
  }
  const commonest = [...classes]
    .sort((a, b) => b[1] - a[1])
    .map(([classname, count]) => `${classname} ${count}`);
  facts.push(
    `entities: ${entities.length}, ${bsp.models.length - 1} of them made of brushes; ${classes.size} classes: ${some(commonest, 8)}`,
  );
  const named = Object.fromEntries(
    Object.entries(resources).map(([kind, names]) => [kind, [...names].sort()]),
  );
  for (const [kind, names] of Object.entries(named))
    if (names.length) facts.push(`its entities name ${names.length} ${kind}: ${some(names)}`);
  return named;
}

/** Everything `checkBsp` looks at once the lumps are known to be inside the file. */
function inspect(bytes, engine, folders, located, report, against) {
  const { facts, warnings } = report;
  const bsp = readBsp(bytes);
  const counts = checkCounts(bsp, engine, report);
  facts.push(
    `${bytes.length} bytes, version ${bsp.format === "bsp2" ? "BSP2" : bsp.version}: ${counts.models} models, ${counts.faces} faces, ${counts.vertices} vertices, ${counts.planes} planes, ${counts.nodes} nodes, ${counts.leaves} leaves, ${counts.clipnodes} clipnodes`,
  );
  if (!bsp.models.length) {
    report.errors.push("the map has no models: not even the world");
    return { counts };
  }
  const bounds = worldBounds(bsp);
  facts.push(
    `the world reaches from ${bounds.mins.map(Math.round).join(" ")} to ${bounds.maxs.map(Math.round).join(" ")}`,
  );
  if (located.blueShift)
    (engine === "goldsrc" ? warnings : facts).push(
      "the entities and the planes have changed places in the header, as in Half-Life: Blue Shift. GoldSrc reads such a map only for the game folder bshift; Xash tells by itself",
    );
  if (bytes.toString("latin1", HEADER_SIZE, HEADER_SIZE + XASH_EXTRA_ID.length) === XASH_EXTRA_ID)
    facts.push("the map has Xash's block of extra lumps after its header, which is not read here");
  if (bytes.includes(BSPX_ID, HEADER_SIZE, "latin1") && endsWithExtraLumps(bytes, located))
    facts.push("the map has a block of extra lumps (BSPX) after its own, which is not read here");
  checkReferences(bsp, engine, report);
  // a file that points outside itself is not walked further: what follows goes by those numbers
  if (report.errors.length) return { counts };
  checkLight(bsp, engine, report);
  const textures = checkTextures(bsp, engine, folders, report);
  const resources = checkEntities(bsp, engine, report);
  if (folders?.length) checkGlowBorders(bsp, folders, warnings);
  // the entities against the mod: its classes and keys, the names, its rules, its files
  if (against.mod || against.definitions) {
    const found = checkAgainstMod(bsp, { ...against, folders });
    report.errors.push(...found.errors);
    warnings.push(...found.warnings);
    facts.push(...found.facts);
  }
  const openOutside = bsp.leaves.length > 0 && bsp.leaves[0].contents !== CONTENTS.SOLID;
  if (openOutside) warnings.push("leaf 0 is not solid: every map's is, and the engine counts on it");
  const degenerate = bsp.faces.filter((face) => face.edgeCount < 3).length;
  if (degenerate) warnings.push(`${degenerate} faces have fewer than three corners`);
  // a face must be read whole for its corners to be trusted: one is tried
  if (bsp.faces.length) facePolygon(bsp, 0);
  return { counts, resources, wanted: textures.wanted, found: textures.found };
}

/** A glow's corners count as a faint square when this share of them, or more, is lit, and the brightest is this or more. */
const SQUARE_SHARE = 0.02;
const SQUARE_MAX = 2;

/**
 * The sprites a map adds to the world (an `env_glow`, an entity in render mode 3 or 5, a sprite whose own format
 * is additive) held to a black border: outside the circle inscribed in the frame, a lit pixel is added too and
 * draws a faint square round the glow, worse at night and under Xash's texture gamma.
 */
function checkGlowBorders(bsp, folders, warnings) {
  const users = new Map();
  for (const entity of bsp.entities) {
    const name = (valueOf(entity, "model") ?? "").replace(/\\/g, "/");
    if (!/\.spr$/i.test(name)) continue;
    const mode = Number(valueOf(entity, "rendermode") ?? 0);
    const kept = users.get(name) ?? { classes: new Set(), count: 0, modes: new Set() };
    kept.classes.add(valueOf(entity, "classname"));
    kept.modes.add(mode);
    kept.count++;
    users.set(name, kept);
  }
  const square = [];
  for (const [name, { classes, count, modes }] of users) {
    const sprite = spriteOf(name, folders);
    if (!sprite.file) continue;
    const added = classes.has("env_glow") || modes.has(3) || modes.has(5) || sprite.format === "additive";
    if (!added) continue;
    const border = spriteBorder(sprite, 0);
    if (border.share >= SQUARE_SHARE && border.max >= SQUARE_MAX)
      square.push(
        `${name} (${count} entities): ${border.lit} of ${border.corners} pixels outside its inscribed circle are not black, up to ${border.max} of 255`,
      );
  }
  if (square.length)
    warnings.push(
      `${square.length} glow sprites draw a faint square around the glow, worse in the dark and under Xash's gamma, because their border is not black: ${square.join("; ")}`,
    );
}

/**
 * Whether the letters BSPX stand where Xash looks for them: after the end of the last lump, on a multiple of
 * four.
 */
function endsWithExtraLumps(bytes, located) {
  let end = 0;
  for (const name of LUMP_NAMES) end = Math.max(end, located.lumps[name].offset + located.lumps[name].length);
  end += (4 - (end % 4)) % 4;
  return bytes.toString("latin1", end, end + BSPX_ID.length) === BSPX_ID;
}

/**
 * A map looked over: `{ errors, warnings, facts, counts, resources }`. The first three are lists of
 * sentences, as `check` gives for a model. `counts` is how many of each thing the map has; `resources` the
 * files its entities name, `{ models, sprites, sounds }`.
 *
 * `engine`: "goldsrc" or "xash", whose limits it is held to. `folders`: the game's folders (the mod's own,
 * then `valve`), in which the .wad files and the textures the map wants are then looked for; without them
 * the map's wants are only listed. A file that is cut short, broken or not a GoldSrc map is reported as an
 * error like any other: nothing is thrown for what is wrong with the map.
 *
 * `mod`: the mod's profile (mod.mjs), which gives the folders unless they are given and has the entities
 * checked against the mod; `definitions`: entity definitions beside the profile's, or with no profile (an
 * FGD's, or learned from the mod's maps). With either, what `checkEntities` of rules.mjs finds is among the
 * sentences: a class that does not exist (an error), a key its class does not have, a value of the wrong
 * kind, a name nothing answers to, a broken rule of the mod, a file the game does not have.
 */
export function checkBsp(bytes, { engine = "goldsrc", folders = undefined, mod, definitions } = {}) {
  if (!MAP_LIMITS[engine]) throw new Error(`engine: goldsrc or xash, not ${engine}`);
  const profile = modOf(mod);
  if (folders === undefined && profile?.folders.length) folders = profile.folders;
  const errors = [];
  const warnings = [];
  const facts = [];
  const report = { errors, warnings, facts };
  let located;
  try {
    located = locateLumps(bytes);
  } catch (e) {
    return { errors: [e.message], warnings, facts };
  }
  if (located.format === "bsp2" && engine === "goldsrc")
    errors.push("the map is Xash3D's BSP2, which Half-Life's own engine does not load: only Xash3D FWGS does");
  if (!checkLumps(bytes, located, report)) return report;
  try {
    Object.assign(report, inspect(bytes, engine, folders, located, report, { mod, definitions }));
  } catch (e) {
    // a read past the end of the file is the file's fault; anything else is the kit's, and is not hidden
    if (!(e instanceof RangeError)) throw e;
    errors.push(cutShort(bytes));
  }
  return report;
}
