// The header of a compiled GoldSrc map (.bsp, version 30, or Xash3D's BSP2): a version number, then where each
// of its fifteen lumps is in the file and how long. Everything else in a map is found through this table, and both engines
// go by it alone: nothing in them expects the lumps in any order, or one after another.
//
//   a lump   { name, slot, offset, length, inside }    `slot` is its place in the header's table
//
// BSP2 is the Quake format of that name, which Xash3D FWGS loads with Half-Life's textures and light: the same
// header and the same fifteen lumps in the same order, but the letters "BSP2" where the version is, and six
// lumps (nodes, leaves, faces, clipnodes, marksurfaces, edges) with 32 bit numbers where version 30 has 16
// (bsp.mjs reads them). Xash tells the two by that first number alone. From Xash3D FWGS (github.com/FWGS/
// xash3d-fwgs, master at 3426d75): common/bspfile.h,
//   #define HLBSP_VERSION 30
//   #define QBSP2_VERSION (( 'B' << 0 ) | ( 'S' << 8 ) | ( 'P' << 16 ) | ( '2' << 24 ))
// and engine/common/mod_bmodel.c, Mod_LoadBmodelLumps: `switch( header->version )` takes HLBSP_VERSION (and
// only there looks for Blue Shift's swapped lumps or Xash's extra header), Q1BSP_VERSION and QBSP2_VERSION;
// Mod_LoadLump then "always use[s] alternate entrysize for BSP2" (the lumps' `entrysize32`).

// ── the format (the engine's bspfile.h) ────────────────────────────────────
/** The version a GoldSrc map begins with, and the ones that are other formats. */
export const BSP_VERSION = 30;
/** Xash3D's BSP2: the letters B S P 2 read as one little endian number (QBSP2_VERSION). */
export const BSP2_VERSION = 0x32505342;
/** What `locateLumps` calls each of the two: its `format`. */
export const FORMATS = { [BSP_VERSION]: "bsp30", [BSP2_VERSION]: "bsp2" };
const QUAKE_VERSION = 29;
/** Formats that begin with four letters instead of a version number. */
const OTHER_FORMATS = {
  IBSP: "a Quake 2 or Quake 3 map (IBSP)",
  VBSP: "a Source engine map (VBSP)",
  "2PSB": "a Quake map in the 2PSB format",
  RBSP: "a Raven map (RBSP)",
};

const INT32 = 4;
// lump_t: where a lump begins, from the file's start, and how many bytes it is
const LUMP = { fileofs: 0, filelen: 4, sizeof: 8 };
/** The lumps of a map, in the order of the header's table (LUMP_ENTITIES ... LUMP_MODELS). */
export const LUMP_NAMES = [
  "entities",
  "planes",
  "textures",
  "vertices",
  "visibility",
  "nodes",
  "texinfo",
  "faces",
  "lighting",
  "clipnodes",
  "leaves",
  "marksurfaces",
  "edges",
  "surfedges",
  "models",
];
// dheader_t: the version, then one lump_t for each lump
const HEADER = { version: 0, lumps: INT32, sizeof: INT32 + LUMP_NAMES.length * LUMP.sizeof };
/** How long the header is: no map is shorter. */
export const HEADER_SIZE = HEADER.sizeof;
/** The text every entity lump holds, by which a lump of entities is told from any other. */
const ENTITY_MARK = '"classname"';
/**
 * Maps made for Half-Life: Blue Shift keep the entities in the table's second place and the planes in its
 * first. The engine tells them by the game's folder; here, as in Xash, by which of the two holds text.
 */
const BLUE_SHIFT_SLOTS = { entities: 1, planes: 0 };

// ── small tools ────────────────────────────────────────────────────────────
/** Where in the header the lump_t of a slot is. */
const slotAt = (slot) => HEADER.lumps + slot * LUMP.sizeof;
/** Whether a stretch of the file holds entity text. */
const holdsEntities = (bytes, offset, length) =>
  offset >= 0 && length > 0 && offset + length <= bytes.length
    ? bytes.subarray(offset, offset + length).includes(ENTITY_MARK, 0, "latin1")
    : false;

/** Refuses a file that is not a GoldSrc map, saying what it is instead when that can be told. */
function refuseOtherFormats(bytes) {
  if (bytes.length < HEADER.sizeof)
    throw new Error(
      `not a GoldSrc map: it is ${bytes.length} bytes long, and the header alone is ${HEADER.sizeof}`,
    );
  const version = bytes.readInt32LE(HEADER.version);
  if (version === BSP_VERSION || version === BSP2_VERSION) return;
  const letters = bytes.toString("latin1", 0, INT32);
  if (OTHER_FORMATS[letters])
    throw new Error(
      `not a GoldSrc map: this is ${OTHER_FORMATS[letters]}, another format with other lumps. SMAK reads version ${BSP_VERSION} and Xash's BSP2 only`,
    );
  if (version === QUAKE_VERSION)
    throw new Error(
      `not a GoldSrc map: version ${QUAKE_VERSION} is a Quake 1 map, whose textures have no palette of their own and whose light has no colour. SMAK reads version ${BSP_VERSION} and Xash's BSP2 only`,
    );
  throw new Error(
    `not a GoldSrc map: its version is ${version}, and a GoldSrc map's is ${BSP_VERSION} (Quake 1's is ${QUAKE_VERSION}; Quake 3's begins with the letters IBSP)`,
  );
}

/**
 * Where each lump of a map is: `{ version, format, blueShift, lumps: { name: { name, slot, offset, length,
 * inside } } }`. `version` is the header's first number (30, or BSP2_VERSION); `format` "bsp30" or "bsp2".
 * `inside` is false for a lump that the header puts outside the file (a file cut short): nothing is thrown
 * for that here, so that a broken file can still be told about. Throws, in words, for a file that is not a
 * GoldSrc map at all.
 */
export function locateLumps(bytes) {
  refuseOtherFormats(bytes);
  const at = (slot) => ({
    offset: bytes.readInt32LE(slotAt(slot) + LUMP.fileofs),
    length: bytes.readInt32LE(slotAt(slot) + LUMP.filelen),
  });
  const version = bytes.readInt32LE(HEADER.version);
  const first = at(0);
  const second = at(1);
  // Xash looks for Blue Shift's order in a version 30 map only
  const blueShift =
    version === BSP_VERSION &&
    !holdsEntities(bytes, first.offset, first.length) && holdsEntities(bytes, second.offset, second.length);
  const lumps = {};
  LUMP_NAMES.forEach((name, order) => {
    const slot = blueShift && name in BLUE_SHIFT_SLOTS ? BLUE_SHIFT_SLOTS[name] : order;
    const { offset, length } = at(slot);
    const inside = offset >= 0 && length >= 0 && offset + length <= bytes.length;
    lumps[name] = { name, slot, offset, length, inside };
  });
  return { version, format: FORMATS[version], blueShift, lumps };
}

/** The same, for a file that must be whole: throws, naming the lump, when one lies outside the file. */
export function readLumps(bytes) {
  const located = locateLumps(bytes);
  for (const lump of Object.values(located.lumps))
    if (!lump.inside)
      throw new Error(
        `the map is cut short or broken: its ${lump.name} lump is said to be at ${lump.offset}, ${lump.length} bytes long, and the file is ${bytes.length} bytes long`,
      );
  return located;
}

/** The bytes of one lump, not copied: a view of the file. */
export const lumpBytes = (bytes, lump) => bytes.subarray(lump.offset, lump.offset + lump.length);

/** Writes a lump's place and length into the header of `bytes`, in the lump's own slot. */
export function pointLump(bytes, lump, offset, length) {
  bytes.writeInt32LE(offset, slotAt(lump.slot) + LUMP.fileofs);
  bytes.writeInt32LE(length, slotAt(lump.slot) + LUMP.filelen);
}
