// GoldSrc studio models (.mdl, version 10) read and written directly, with no decompiler and no studiomdl.
//
// A change to a file is made by appending: new vertices, normals, triangles, textures, animations or tables
// go at the end and the file's own tables are pointed at them. Everything else (bones, the other submodels,
// what was not asked to change) is left byte for byte as it was. Every function that changes a model takes a
// Buffer and returns a new one. What a function returns has its textures moved to the file's end, in their
// table's order (layout.mjs): a dedicated server's engine reads them so, and dies on a change of level over a
// file left as the appending makes it.
//
//   reading     readMdl readMesh readTris textureOf skinFamilies bodyOf bones boneParents sequences readSequence
//               frameValues sequenceGroups events attachments hitboxes boneControllers drawnCorners modelBoxes
//   posing      restPose poseAt poseBetween poseOf boneMatrices
//               (matrices: 3 rows of 4, bone space -> model space)
//   meshes      replaceMesh addMesh addModel addBodypart removeBodypart emptyMesh clearModel filterMesh
//   pictures    retexture replaceTexture withTextures
//   animations  replaceSequence addSequence setEvents addBones insertBones
//   a monster's setHitboxes autoHitboxes setAttachments setBoneControllers setModelBoxes
//   bones       setBoneValues (their rest and scale; reproportion.mjs changes a skeleton's lengths by it)
//   whole       writeMdl modelName setModelName

import { engineLayout } from "./layout.mjs";

// ── the format ─────────────────────────────────────────────────────────────
// Each table below is one struct of the engine's studio.h, under the name it has there: where each of its
// fields is, in bytes from the struct's start, and `sizeof`, how long the struct is. Numbers are little
// endian; a `...index` field is a place in the file, counted from its start.

const STUDIO_ID = "IDST";
const STUDIO_VERSION = 10;

/** The sizes of the plain values the structs are made of. */
const INT16 = 2;
const INT32 = 4;
const FLOAT32 = 4;
const VEC3 = 3 * FLOAT32;
/** Names are char[32] or char[64], closed by a zero byte. */
const SHORT_NAME = 32;
const LONG_NAME = 64;

// studiohdr_t
const HDR = {
  id: 0,
  version: 4,
  name: 8, // char[64]
  length: 72,
  eyeposition: 76,
  min: 88, // four vec3 one after another: min, max, bbmin, bbmax
  max: 100,
  bbmin: 112,
  bbmax: 124,
  flags: 136,
  numbones: 140,
  boneindex: 144,
  numbonecontrollers: 148,
  bonecontrollerindex: 152,
  numhitboxes: 156,
  hitboxindex: 160,
  numseq: 164,
  seqindex: 168,
  numseqgroups: 172,
  seqgroupindex: 176,
  numtextures: 180,
  textureindex: 184,
  texturedataindex: 188,
  numskinref: 192,
  numskinfamilies: 196,
  skinindex: 200,
  numbodyparts: 204,
  bodypartindex: 208,
  numattachments: 212,
  attachmentindex: 216,
  soundtable: 220,
  soundindex: 224,
  soundgroups: 228,
  soundgroupindex: 232,
  numtransitions: 236,
  transitionindex: 240,
  sizeof: 244,
};
/** The header's tables that writeMdl leaves empty: their `...index` fields. */
const EMPTY_TABLES = [HDR.soundindex, HDR.soundgroupindex, HDR.transitionindex];

// mstudiobone_t: `value` is the six rest values (x y z, then the angles about x y z) and `scale` what one
// step of an animation's stored value is worth on each of the six
const BONE = {
  name: 0, // char[32]
  parent: 32,
  flags: 36,
  bonecontroller: 40, // int[6], -1: none
  value: 64, // float[6]
  scale: 88, // float[6]
  sizeof: 112,
};
// mstudiobonecontroller_t: `type` is one of the MOTION bits X to ZR (which of the bone's six values it
// turns), `start` and `end` the range it reaches (degrees for an angle), `index` which of the entity's
// controllers drives it (0 to 3; 4 is the mouth)
const BONECONTROLLER = { bone: 0, type: 4, start: 8, end: 12, rest: 16, index: 20, sizeof: 24 };
// mstudiobbox_t (a hit box)
const BBOX = { bone: 0, group: 4, bbmin: 8, bbmax: 20, sizeof: 32 };
// mstudioattachment_t
const ATTACHMENT = { name: 0, type: 32, bone: 36, org: 40, vectors: 52, sizeof: 88 };
// mstudioseqdesc_t (an animation)
const SEQ = {
  label: 0, // char[32]
  fps: 32,
  flags: 36,
  activity: 40,
  actweight: 44,
  numevents: 48,
  eventindex: 52,
  numframes: 56,
  numpivots: 60,
  pivotindex: 64,
  motiontype: 68,
  motionbone: 72,
  linearmovement: 76, // vec3
  automoveposindex: 88,
  automoveangleindex: 92,
  bbmin: 96, // vec3, and bbmax after it
  bbmax: 108,
  numblends: 120,
  animindex: 124,
  blendtype: 128,
  blendstart: 136,
  blendend: 144,
  blendparent: 152,
  seqgroup: 156,
  entrynode: 160,
  exitnode: 164,
  nodeflags: 168,
  nextseq: 172,
  sizeof: 176,
};
/** mstudioseqdesc_t.flags: the animation is marked looping. studio.h gives a sequence's flags no other bit. */
const STUDIO_LOOPING = 1;
/**
 * The motion bits of studio.h (STUDIO_X ... STUDIO_RLOOP), which say an axis in two places: a sequence's
 * `motiontype` and a bone controller's `type`. X Y Z are the three positions and XR YR ZR the three angles;
 * LX LY LZ mark the axes along which a sequence's travel was taken out of its frames and written as its
 * `linearmovement` (the QC's "LX" on a $sequence line); AX to AZR the same for motion kept frame by frame
 * (which this kit does not write); RLOOP a controller that wraps round. The values were read off Half-Life's
 * own models: its walks have motiontype 64, hgrunt's strafes 192, and its head controller type 8.
 */
export const MOTION = {
  X: 0x0001,
  Y: 0x0002,
  Z: 0x0004,
  XR: 0x0008,
  YR: 0x0010,
  ZR: 0x0020,
  LX: 0x0040,
  LY: 0x0080,
  LZ: 0x0100,
  AX: 0x0200,
  AY: 0x0400,
  AZ: 0x0800,
  AXR: 0x1000,
  AYR: 0x2000,
  AZR: 0x4000,
  RLOOP: 0x8000,
};
/** The three bits that say along which axes a sequence travels, in the order of `linearmovement`. */
const TRAVEL_BITS = [MOTION.LX, MOTION.LY, MOTION.LZ];
/** The six bits a bone controller's type is one of, in the order of a bone's six values. */
const CONTROLLED_BITS = [MOTION.X, MOTION.Y, MOTION.Z, MOTION.XR, MOTION.YR, MOTION.ZR];
/**
 * A hit box's `group`, as the Half-Life SDK's game code names them (HITGROUP_GENERIC ... in cbase.h): what
 * was hit, by which a monster's TraceAttack scales the damage. A mod may number its own beyond these
 * (hgrunt.mdl has an 11).
 */
export const HITGROUP = {
  generic: 0,
  head: 1,
  chest: 2,
  stomach: 3,
  leftArm: 4,
  rightArm: 5,
  leftLeg: 6,
  rightLeg: 7,
};
/**
 * The names of a sequence's `activity` number (the SDK's activity.h, in its order: ACT_IDLE = 1 to
 * ACT_FLINCH_RIGHTLEG = 76; 0 is none, the sequence asked for by its name alone), by which a monster's code asks
 * for "a walk" without knowing the sequence's name. The order was held to the sequences of Half-Life's 301
 * models (2026-10-25), each number on sequences that fit its name: "walk_scared" 63, "run1" 64, "draw" and
 * "pull_needle" 33, "disarm" 34, "chewcycle" 35, "fear1" 58, "combatidle" and "madidle" 47, "drop_grenade" 60,
 * "repel_repel" 51, "threat" 57, "victorydance" 65, "diegutshot" 68. A number past 76 is a mod's own
 * (Half-Life's tentacle has 1010 to 1044), named only by its game's code.
 */
export const ACTIVITY = {
  1: "ACT_IDLE",
  2: "ACT_GUARD",
  3: "ACT_WALK",
  4: "ACT_RUN",
  5: "ACT_FLY",
  6: "ACT_SWIM",
  7: "ACT_HOP",
  8: "ACT_LEAP",
  9: "ACT_FALL",
  10: "ACT_LAND",
  11: "ACT_STRAFE_LEFT",
  12: "ACT_STRAFE_RIGHT",
  13: "ACT_ROLL_LEFT",
  14: "ACT_ROLL_RIGHT",
  15: "ACT_TURN_LEFT",
  16: "ACT_TURN_RIGHT",
  17: "ACT_CROUCH",
  18: "ACT_CROUCHIDLE",
  19: "ACT_STAND",
  20: "ACT_USE",
  21: "ACT_SIGNAL1",
  22: "ACT_SIGNAL2",
  23: "ACT_SIGNAL3",
  24: "ACT_TWITCH",
  25: "ACT_COWER",
  26: "ACT_SMALL_FLINCH",
  27: "ACT_BIG_FLINCH",
  28: "ACT_RANGE_ATTACK1",
  29: "ACT_RANGE_ATTACK2",
  30: "ACT_MELEE_ATTACK1",
  31: "ACT_MELEE_ATTACK2",
  32: "ACT_RELOAD",
  33: "ACT_ARM",
  34: "ACT_DISARM",
  35: "ACT_EAT",
  36: "ACT_DIESIMPLE",
  37: "ACT_DIEBACKWARD",
  38: "ACT_DIEFORWARD",
  39: "ACT_DIEVIOLENT",
  40: "ACT_BARNACLE_HIT",
  41: "ACT_BARNACLE_PULL",
  42: "ACT_BARNACLE_CHOMP",
  43: "ACT_BARNACLE_CHEW",
  44: "ACT_SLEEP",
  45: "ACT_INSPECT_FLOOR",
  46: "ACT_INSPECT_WALL",
  47: "ACT_IDLE_ANGRY",
  48: "ACT_WALK_HURT",
  49: "ACT_RUN_HURT",
  50: "ACT_HOVER",
  51: "ACT_GLIDE",
  52: "ACT_FLY_LEFT",
  53: "ACT_FLY_RIGHT",
  54: "ACT_DETECT_SCENT",
  55: "ACT_SNIFF",
  56: "ACT_BITE",
  57: "ACT_THREAT_DISPLAY",
  58: "ACT_FEAR_DISPLAY",
  59: "ACT_EXCITED",
  60: "ACT_SPECIAL_ATTACK1",
  61: "ACT_SPECIAL_ATTACK2",
  62: "ACT_COMBAT_IDLE",
  63: "ACT_WALK_SCARED",
  64: "ACT_RUN_SCARED",
  65: "ACT_VICTORY_DANCE",
  66: "ACT_DIE_HEADSHOT",
  67: "ACT_DIE_CHESTSHOT",
  68: "ACT_DIE_GUTSHOT",
  69: "ACT_DIE_BACKSHOT",
  70: "ACT_FLINCH_HEAD",
  71: "ACT_FLINCH_CHEST",
  72: "ACT_FLINCH_STOMACH",
  73: "ACT_FLINCH_LEFTARM",
  74: "ACT_FLINCH_RIGHTARM",
  75: "ACT_FLINCH_LEFTLEG",
  76: "ACT_FLINCH_RIGHTLEG",
};
// mstudioevent_t
const EVENT = { frame: 0, event: 4, type: 8, options: 12, sizeof: 76 }; // options: char[64]
// mstudioseqgroup_t
const SEQGROUP = { label: 0, name: 32, sizeof: 104 };
/** What a sequence file (<name>01.mdl) begins with: its own header, and its animations' values after it. */
const SEQUENCE_FILE_ID = "IDSQ";
// mstudioanim_t: for one bone in one blend, six 16 bit offsets, one for each of its six values (0: the bone
// rests on that channel), each counted from this entry's own start to the channel's runs of values
const ANIM = { offset: 0, sizeof: 6 * INT16 };
/** The furthest an mstudioanim_t offset reaches. */
const MAX_ANIM_OFFSET = 65535;
// mstudioanimvalue_t: a run of a channel's values is one of these as a pair of bytes, [valid: how many
// values are written, total: how many frames they cover], then `valid` of them as 16 bit values (steps of
// the bone's scale away from its rest). The last value written holds to the end of its run.
const RUN = { valid: 0, total: 1, values: 2 };
/** The most values or frames one run holds: its counts are bytes. */
const MAX_RUN = 255;
/** The range of a stored value. */
const STEP_MIN = -32768;
const STEP_MAX = 32767;
// mstudiotexture_t: at `index`, width x height palette indices and then the palette
const TEXTURE = { name: 0, flags: 64, width: 68, height: 72, index: 76, sizeof: 80 }; // name: char[64]
/** A texture's palette: 256 colours of three bytes (r g b). */
const PALETTE = 256 * 3;
/** A skin reference: a 16 bit texture number. The skin table has numskinref of them for each family. */
const SKINREF = INT16;
// mstudiobodyparts_t
const BODYPART = { name: 0, nummodels: 64, base: 68, modelindex: 72, sizeof: 76 }; // name: char[64]
// mstudiomodel_t (a submodel): `vertinfoindex` and `norminfoindex` are a bone (one byte) for each vertex
// and each normal, `vertindex` and `normindex` the vertices and normals themselves (vec3)
const MODEL = {
  name: 0, // char[64]
  type: 64,
  boundingradius: 68,
  nummesh: 72,
  meshindex: 76,
  numverts: 80,
  vertinfoindex: 84,
  vertindex: 88,
  numnorms: 92,
  norminfoindex: 96,
  normindex: 100,
  numgroups: 104,
  groupindex: 108,
  sizeof: 112,
};
/** The bounding radius written for a new submodel. */
const NEW_MODEL_RADIUS = 64;
// mstudiomesh_t
const MESH = { numtris: 0, triindex: 4, skinref: 8, numnorms: 12, normindex: 16, sizeof: 20 };
// A mesh's triangles (at `triindex`) are a list of commands: a 16 bit count (over 0: a strip of that many
// corners; under 0: a fan; 0: the end of the list), then the corners, each four 16 bit numbers
// (mstudiotrivert_t): its vertex and its normal, by their numbers in the submodel, and s and t, its place
// in the texture in pixels.
const COMMAND_COUNT = INT16;
const CORNER = { vertex: 0, normal: 2, s: 4, t: 6, sizeof: 8 };
/** A triangle written as a strip of three corners. */
const TRIANGLE_COMMAND = COMMAND_COUNT + 3 * CORNER.sizeof;
/** The zero that ends a list of commands, and the four zero bytes an empty mesh's `triindex` points at. */
const COMMANDS_END = INT16;
const NO_COMMANDS = 4;

/** A bone's six values, by number: x y z from its parent, then its angles about x y z. */
const CHANNELS = [0, 1, 2, 3, 4, 5];
const isAngle = (channel) => channel >= 3;
/** The scale of a channel that nothing moves: a position's, and an angle's. */
const restScale = (channel) => (isAngle(channel) ? Math.PI / 32768 : 1 / 256);

// ── small tools ────────────────────────────────────────────────────────────
const int32 = (buffer, at) => buffer.readInt32LE(at);
/** A Uint8Array (a fetch, a browser's read) taken as the Buffer the readers use, without a copy. */
const asBuffer = (b) => (Buffer.isBuffer(b) ? b : Buffer.from(b.buffer, b.byteOffset, b.byteLength));
/** The text of a name of `room` bytes: up to its zero byte, or all of it when it has none. */
const textAt = (buffer, at, room) => {
  const end = buffer.indexOf(0, at);
  return buffer.toString("latin1", at, end < 0 || end > at + room ? at + room : end);
};
/** A name written into `room` bytes of a buffer of zeros: cut so that a zero byte is left after it. */
const writeName = (buffer, at, text, room) => buffer.write(text, at, room - 1, "latin1");
/** How many bytes bring a length up to a multiple of four. */
const padTo4 = (length) => (4 - (length % 4)) % 4;
/** Points or normals as the file keeps them: three floats each. */
const vec3s = (list) => {
  const bytes = Buffer.alloc(list.length * VEC3);
  list.forEach((p, i) => {
    bytes.writeFloatLE(p[0], i * VEC3);
    bytes.writeFloatLE(p[1], i * VEC3 + FLOAT32);
    bytes.writeFloatLE(p[2], i * VEC3 + 2 * FLOAT32);
  });
  return bytes;
};
/** Three floats of a file, as a point. */
const vec3At = (buffer, at) => [0, 1, 2].map((axis) => buffer.readFloatLE(at + axis * FLOAT32));
/** A point written into a buffer as three floats. */
const writeVec3 = (buffer, at, p) => p.forEach((v, axis) => buffer.writeFloatLE(v, at + axis * FLOAT32));
/** `value` when it is three numbers; otherwise it throws, saying of `what` that it needs them. */
function threeNumbers(value, what) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((v) => !Number.isFinite(v)))
    throw new Error(`${what} needs three numbers [x, y, z], not ${JSON.stringify(value)}`);
  return value;
}
const boneAt = (mdl, i) => int32(mdl, HDR.boneindex) + i * BONE.sizeof;
const seqAt = (mdl, i) => int32(mdl, HDR.seqindex) + i * SEQ.sizeof;

/**
 * A file being added to. `head` is the file as it was, in a copy of its own, whose tables are then pointed at
 * what is added; `add(block)` puts a block at the end, on a multiple of four bytes, and returns where it is;
 * `whole()` writes the new length in the header and returns everything as one buffer.
 */
function growing(head) {
  const parts = [head];
  let size = head.length;
  const add = (block) => {
    const pad = padTo4(size);
    if (pad) {
      parts.push(Buffer.alloc(pad));
      size += pad;
    }
    const at = size;
    parts.push(block);
    size += block.length;
    return at;
  };
  const whole = () => {
    head.writeInt32LE(size, HDR.length);
    return Buffer.concat(parts);
  };
  return { head, add, whole };
}

// ── triangle commands ──────────────────────────────────────────────────────
/** The triangle commands of a mesh, as triangles of corners [vertex, normal, s, t]. */
export function readTris(mdl, at) {
  mdl = asBuffer(mdl);
  const tris = [];
  for (;;) {
    const command = mdl.readInt16LE(at);
    at += COMMAND_COUNT;
    if (!command) break;
    const fan = command < 0;
    const count = Math.abs(command);
    const corners = [];
    for (let i = 0; i < count; i++, at += CORNER.sizeof)
      corners.push([
        mdl.readInt16LE(at + CORNER.vertex),
        mdl.readInt16LE(at + CORNER.normal),
        mdl.readInt16LE(at + CORNER.s),
        mdl.readInt16LE(at + CORNER.t),
      ]);
    for (let i = 2; i < count; i++) {
      // a fan's triangles all start at its first corner; a strip's are its last three corners, every other
      // one with two of them changed over so that all go the same way round
      if (fan) tris.push([corners[0], corners[i - 1], corners[i]]);
      else if (i % 2) tris.push([corners[i - 1], corners[i - 2], corners[i]]);
      else tris.push([corners[i - 2], corners[i - 1], corners[i]]);
    }
  }
  return { tris, end: at };
}
/**
 * Goes through a list of commands, calling `each(at)` with the place of every corner. Returns where it ends.
 */
function eachCorner(buffer, at, each) {
  for (;;) {
    const count = Math.abs(buffer.readInt16LE(at));
    at += COMMAND_COUNT;
    if (!count) return at;
    for (let i = 0; i < count; i++, at += CORNER.sizeof) each?.(at);
  }
}
/**
 * Triangles of corners [vertex, normal, s, t] as commands: each a strip of three, and the zero that ends
 * them.
 */
function stripsOf(tris) {
  const commands = Buffer.alloc(tris.length * TRIANGLE_COMMAND + COMMANDS_END);
  tris.forEach((tri, i) => {
    commands.writeInt16LE(3, i * TRIANGLE_COMMAND);
    tri.forEach(([vertex, normal, s, t], c) => {
      const at = i * TRIANGLE_COMMAND + COMMAND_COUNT + c * CORNER.sizeof;
      commands.writeInt16LE(vertex, at + CORNER.vertex);
      commands.writeInt16LE(normal, at + CORNER.normal);
      commands.writeInt16LE(s, at + CORNER.s);
      commands.writeInt16LE(t, at + CORNER.t);
    });
  });
  return commands;
}

// ── reading ────────────────────────────────────────────────────────────────
export function readMdl(mdl) {
  mdl = asBuffer(mdl);
  if (mdl.toString("latin1", HDR.id, HDR.version) !== STUDIO_ID || int32(mdl, HDR.version) !== STUDIO_VERSION)
    throw new Error("not a studio model, version 10");
  const bones = [];
  for (let i = 0; i < int32(mdl, HDR.numbones); i++) bones.push(textAt(mdl, boneAt(mdl, i), SHORT_NAME));
  const textures = [];
  for (let i = 0; i < int32(mdl, HDR.numtextures); i++) {
    const entry = int32(mdl, HDR.textureindex) + i * TEXTURE.sizeof;
    textures.push({
      name: textAt(mdl, entry + TEXTURE.name, LONG_NAME),
      flags: int32(mdl, entry + TEXTURE.flags),
      width: int32(mdl, entry + TEXTURE.width),
      height: int32(mdl, entry + TEXTURE.height),
      index: int32(mdl, entry + TEXTURE.index),
    });
  }
  const bodyparts = [];
  for (let i = 0; i < int32(mdl, HDR.numbodyparts); i++) {
    const bodypart = int32(mdl, HDR.bodypartindex) + i * BODYPART.sizeof;
    const models = [];
    for (let j = 0; j < int32(mdl, bodypart + BODYPART.nummodels); j++) {
      const model = int32(mdl, bodypart + BODYPART.modelindex) + j * MODEL.sizeof;
      const meshes = [];
      for (let k = 0; k < int32(mdl, model + MODEL.nummesh); k++) {
        const mesh = int32(mdl, model + MODEL.meshindex) + k * MESH.sizeof;
        const skinref = int32(mdl, mesh + MESH.skinref);
        meshes.push({
          at: mesh,
          numtris: int32(mdl, mesh + MESH.numtris),
          triindex: int32(mdl, mesh + MESH.triindex),
          skinref,
          numnorms: int32(mdl, mesh + MESH.numnorms),
          // the texture it wears in the first skin family
          texture: textures[mdl.readInt16LE(int32(mdl, HDR.skinindex) + skinref * SKINREF)],
        });
      }
      models.push({
        at: model,
        name: textAt(mdl, model + MODEL.name, LONG_NAME),
        numverts: int32(mdl, model + MODEL.numverts),
        numnorms: int32(mdl, model + MODEL.numnorms),
        meshes,
      });
    }
    bodyparts.push({
      name: textAt(mdl, bodypart + BODYPART.name, LONG_NAME),
      base: int32(mdl, bodypart + BODYPART.base),
      models,
    });
  }
  return { bones, textures, bodyparts };
}

/** One mesh, read out: its triangles with positions and normals in the space of each vertex's bone. */
export function readMesh(mdl, model, mesh) {
  mdl = asBuffer(mdl);
  if (typeof mesh === "number") mesh = model.meshes[mesh];
  if (!mesh?.triindex) throw new Error("readMesh takes a mesh of readMdl's model.meshes, or its index there");
  const vertBones = int32(mdl, model.at + MODEL.vertinfoindex);
  const verts = int32(mdl, model.at + MODEL.vertindex);
  const norms = int32(mdl, model.at + MODEL.normindex);
  const vec3At = (list, i) => [
    mdl.readFloatLE(list + i * VEC3),
    mdl.readFloatLE(list + i * VEC3 + FLOAT32),
    mdl.readFloatLE(list + i * VEC3 + 2 * FLOAT32),
  ];
  return readTris(mdl, mesh.triindex).tris.map((tri) =>
    tri.map(([vertex, normal, s, t]) => ({
      p: vec3At(verts, vertex),
      n: vec3At(norms, normal),
      bone: mdl[vertBones + vertex],
      s,
      t,
    })),
  );
}

// ── meshes changed ─────────────────────────────────────────────────────────
/**
 * One entry of the texture table (mstudiotexture_t), for a texture whose pixels and palette are at `dataAt`.
 */
function textureEntry(texture, dataAt) {
  const entry = Buffer.alloc(TEXTURE.sizeof);
  writeName(entry, TEXTURE.name, texture.name, LONG_NAME);
  entry.writeInt32LE(texture.flags ?? 0, TEXTURE.flags);
  entry.writeInt32LE(texture.width, TEXTURE.width);
  entry.writeInt32LE(texture.height, TEXTURE.height);
  entry.writeInt32LE(dataAt, TEXTURE.index);
  return entry;
}
/** What a texture's `index` points at: its pixels, then its palette. */
const textureData = (texture) => Buffer.concat([Buffer.from(texture.pixels), Buffer.from(texture.palette)]);

/**
 * One more texture in a file being added to (`file`, begun from `src`): its pixels and palette, the texture
 * table again with the new entry after the others, and the skin table again with one more reference in each
 * family, which means the new texture. Returns that reference's number.
 */
function appendTexture(file, src, texture) {
  const { head, add } = file;
  const count = int32(src, HDR.numtextures);
  const refs = int32(src, HDR.numskinref);
  const families = int32(src, HDR.numskinfamilies);

  const entry = textureEntry(texture, add(textureData(texture)));
  const oldTable = int32(src, HDR.textureindex);
  const table = Buffer.concat([src.subarray(oldTable, oldTable + count * TEXTURE.sizeof), entry]);
  head.writeInt32LE(add(table), HDR.textureindex);
  head.writeInt32LE(count + 1, HDR.numtextures);

  const oldSkins = int32(src, HDR.skinindex);
  const skins = Buffer.alloc(families * (refs + 1) * SKINREF);
  for (let f = 0; f < families; f++) {
    const family = f * (refs + 1) * SKINREF;
    src.copy(skins, family, oldSkins + f * refs * SKINREF, oldSkins + (f + 1) * refs * SKINREF);
    skins.writeInt16LE(count, family + refs * SKINREF);
  }
  head.writeInt32LE(add(skins), HDR.skinindex);
  head.writeInt32LE(refs + 1, HDR.numskinref);
  return refs;
}
/**
 * The skin reference of the first family that means the texture of that name (the last, of several), or -1.
 */
function skinrefNamed(src, info, name) {
  const texture = info.textures.findIndex((t) => t.name === name);
  if (texture < 0) return -1;
  let found = -1;
  for (let ref = 0; ref < int32(src, HDR.numskinref); ref++)
    if (src.readInt16LE(int32(src, HDR.skinindex) + ref * SKINREF) === texture) found = ref;
  return found;
}

/**
 * Returns a copy of the file with one mesh replaced.
 *   where:   { bodypart, model, mesh } (indices)
 *   mesh:    { bone, verts: [[x,y,z]], norms: [[x,y,z]], tris: [[[vert, norm, s, t] x3]] }, in the bone's
 *            space; vertBones and normBones (one bone each) when the piece hangs from more than one
 *   texture: { name, width, height, pixels (Uint8Array, one palette index each), palette (768 bytes), flags
 *            (the engine's; 32 draws it additively) }
 */
export function replaceMesh(src, where, mesh, texture) {
  const file = growing(Buffer.from(src));
  const { head, add } = file;
  const info = readMdl(src);
  const model = info.bodyparts[where.bodypart].models[where.model];
  const old = model.meshes[where.mesh];
  const fieldOf = (field) => int32(src, model.at + field);

  // The texture: a longer texture table and a longer skin table, both at the end of the file.
  // A texture of that name already there (an earlier call on the same file) is used as it is.
  const known = skinrefNamed(src, info, texture.name);
  const skinref = known >= 0 ? known : appendTexture(file, src, texture);

  // Vertices: the old ones stay (the other meshes use them), the new ones follow.
  const oldVerts = model.numverts;
  const newVertBones = Buffer.from(mesh.vertBones ?? new Array(mesh.verts.length).fill(mesh.bone));
  const vertBones = src.subarray(fieldOf(MODEL.vertinfoindex), fieldOf(MODEL.vertinfoindex) + oldVerts);
  head.writeInt32LE(add(Buffer.concat([vertBones, newVertBones])), model.at + MODEL.vertinfoindex);
  const verts = src.subarray(fieldOf(MODEL.vertindex), fieldOf(MODEL.vertindex) + oldVerts * VEC3);
  head.writeInt32LE(add(Buffer.concat([verts, vec3s(mesh.verts)])), model.at + MODEL.vertindex);
  head.writeInt32LE(oldVerts + mesh.verts.length, model.at + MODEL.numverts);

  // Normals are lit mesh by mesh, in order, so each mesh's block has to stay where its turn comes.
  const before = model.meshes.slice(0, where.mesh).reduce((sum, x) => sum + x.numnorms, 0);
  const after = model.numnorms - before - old.numnorms;
  // a list of the submodel's normals in two: what comes before this mesh's and what comes after
  const aroundOld = (field, each) => [
    src.subarray(fieldOf(field), fieldOf(field) + before * each),
    src.subarray(fieldOf(field) + (before + old.numnorms) * each, fieldOf(field) + model.numnorms * each),
  ];
  const [bonesBefore, bonesAfter] = aroundOld(MODEL.norminfoindex, 1);
  const [normsBefore, normsAfter] = aroundOld(MODEL.normindex, VEC3);
  const newNormBones = Buffer.from(mesh.normBones ?? new Array(mesh.norms.length).fill(mesh.bone));
  head.writeInt32LE(
    add(Buffer.concat([bonesBefore, newNormBones, bonesAfter])),
    model.at + MODEL.norminfoindex,
  );
  head.writeInt32LE(
    add(Buffer.concat([normsBefore, vec3s(mesh.norms), normsAfter])),
    model.at + MODEL.normindex,
  );
  head.writeInt32LE(before + mesh.norms.length + after, model.at + MODEL.numnorms);
  // the meshes after this one find their normals further on, or nearer: their commands are written again
  const shift = mesh.norms.length - old.numnorms;
  if (shift)
    for (const later of model.meshes.slice(where.mesh + 1)) {
      const end = eachCorner(src, later.triindex);
      const commands = Buffer.from(src.subarray(later.triindex, end));
      eachCorner(commands, 0, (corner) =>
        commands.writeInt16LE(commands.readInt16LE(corner + CORNER.normal) + shift, corner + CORNER.normal),
      );
      head.writeInt32LE(add(commands), later.at + MESH.triindex);
    }

  // Triangles, each as a strip of three.
  const commands = stripsOf(
    mesh.tris.map((tri) => tri.map(([vertex, normal, s, t]) => [oldVerts + vertex, before + normal, s, t])),
  );
  head.writeInt32LE(mesh.tris.length, old.at + MESH.numtris);
  head.writeInt32LE(add(commands), old.at + MESH.triindex);
  head.writeInt32LE(skinref, old.at + MESH.skinref);
  head.writeInt32LE(mesh.norms.length, old.at + MESH.numnorms);

  return engineLayout(file.whole());
}

/**
 * Returns a copy of the file with one mesh wearing another texture: its points, normals and
 * triangles stay. `uvOf(triangle, corner)`, when given, says where a corner is in the new
 * picture ([u, v], 0..1); otherwise each corner keeps its place, scaled to the new size.
 * As in replaceMesh, the texture is added to the file unless one of that name is there already (an earlier
 * call on the same file): that one is then worn as it is, at its own size, and none is added, so that names
 * stay unique. replaceTexture changes the picture of a texture the file has.
 */
export function retexture(src, where, texture, uvOf) {
  const file = growing(Buffer.from(src));
  const { head, add } = file;
  const info = readMdl(src);
  const mesh = info.bodyparts[where.bodypart].models[where.model].meshes[where.mesh];
  const old = mesh.texture;
  const known = skinrefNamed(src, info, texture.name);
  const skinref = known >= 0 ? known : appendTexture(file, src, texture);
  // the picture the mesh wears from here on: the file's own of that name, or the one just added
  const worn = known >= 0 ? info.textures.find((t) => t.name === texture.name) : texture;
  const tris = readTris(src, mesh.triindex).tris;
  const commands = stripsOf(
    tris.map((tri, i) =>
      tri.map(([vertex, normal, s, t], c) => {
        const uv = uvOf ? uvOf(i, c) : [s / old.width, t / old.height];
        return [vertex, normal, Math.round(uv[0] * worn.width), Math.round(uv[1] * worn.height)];
      }),
    ),
  );
  head.writeInt32LE(tris.length, mesh.at + MESH.numtris);
  head.writeInt32LE(add(commands), mesh.at + MESH.triindex);
  head.writeInt32LE(skinref, mesh.at + MESH.skinref);
  return engineLayout(file.whole());
}

/**
 * Returns a copy of the file with one more mesh in a submodel, empty, after the ones it has: for a part
 * that needs a texture of its own (a glow) where the original had a single mesh. `where`: { bodypart,
 * model }. replaceMesh fills it.
 */
export function addMesh(src, where) {
  const file = growing(Buffer.from(src));
  const model = readMdl(src).bodyparts[where.bodypart].models[where.model];
  const count = model.meshes.length;
  const oldTable = int32(src, model.at + MODEL.meshindex);
  // the meshes it has, the new one, and the zero bytes that are the new one's commands
  const newMesh = count * MESH.sizeof;
  const end = newMesh + MESH.sizeof;
  const table = Buffer.alloc(end + NO_COMMANDS);
  src.copy(table, 0, oldTable, oldTable + count * MESH.sizeof);
  const at = file.add(table);
  table.writeInt32LE(at + end, newMesh + MESH.triindex);
  file.head.writeInt32LE(count + 1, model.at + MODEL.nummesh);
  file.head.writeInt32LE(at, model.at + MODEL.meshindex);
  return engineLayout(file.whole());
}

/**
 * Returns a copy of the file with one more submodel in a bodypart, after the ones it has, holding one
 * empty mesh: replaceMesh fills it. Its number is the old count. The bodypart's table of submodels is
 * written again at the end of the file; the old one stays where it was, unused.
 * The bodyparts after it have their `base` raised with the count. The engine picks a bodypart's submodel
 * from a body number as floor(body / base) % count (R_StudioSetupModel), and a compiler writes for `base`
 * the product of the counts of the bodyparts before it: with a base left at the old count, the new
 * submodel's own number would also turn the next bodypart's. So a bodypart that is not the last may be
 * added to; what changes is the body number of every pairing that does not show the first submodel of
 * each later bodypart (it is counted in the new bases). A later base that is not a multiple of the old
 * count was not written by that rule: it is left as it is, and `check` tells of it.
 */
export function addModel(src, bodypart, name) {
  const file = growing(Buffer.from(src));
  const entry = int32(src, HDR.bodypartindex) + bodypart * BODYPART.sizeof;
  const count = int32(src, entry + BODYPART.nummodels);
  const oldTable = int32(src, entry + BODYPART.modelindex);
  // the submodels it has, the new one, the new one's mesh, and the zero bytes that are the mesh's commands
  const newModel = count * MODEL.sizeof;
  const mesh = newModel + MODEL.sizeof;
  const end = mesh + MESH.sizeof;
  const table = Buffer.alloc(end + NO_COMMANDS);
  src.copy(table, 0, oldTable, oldTable + count * MODEL.sizeof);
  const at = file.add(table);
  writeName(table, newModel + MODEL.name, name, LONG_NAME);
  table.writeFloatLE(NEW_MODEL_RADIUS, newModel + MODEL.boundingradius);
  table.writeInt32LE(1, newModel + MODEL.nummesh);
  table.writeInt32LE(at + mesh, newModel + MODEL.meshindex);
  table.writeInt32LE(at + end, mesh + MESH.triindex);
  file.head.writeInt32LE(count + 1, entry + BODYPART.nummodels);
  file.head.writeInt32LE(at, entry + BODYPART.modelindex);
  // the bases of the bodyparts after it: each held the old count as a factor, and now holds the new one
  for (let later = bodypart + 1; later < int32(src, HDR.numbodyparts); later++) {
    const baseAt = int32(src, HDR.bodypartindex) + later * BODYPART.sizeof + BODYPART.base;
    const base = int32(src, baseAt);
    if (count > 0 && base > 0 && base % count === 0)
      file.head.writeInt32LE((base / count) * (count + 1), baseAt);
  }
  return engineLayout(file.whole());
}

/**
 * Returns a copy of the file with one more bodypart, after the ones it has, holding a submodel for each name
 * in `models` (one, called as the bodypart, unless told), each with one empty mesh: replaceMesh fills it. Its
 * number is the old count. The engine draws one submodel of every bodypart, so a bodypart of one submodel is
 * always shown, whatever the body number: a piece of gear that every body wears, or the room for more points
 * than one submodel holds (2048).
 * Its base is the product of the counts of the bodyparts before it (`basesByRule`), or more when a base of the
 * file reaches past that: every body number the file had shows the first submodel of the new bodypart, so each
 * keeps what it showed. The bodypart table is written again at the end of the file; the old one stays, unused.
 */
export function addBodypart(src, name, models = [name]) {
  if (!models.length) throw new Error("addBodypart: a bodypart needs one submodel at least");
  const file = growing(Buffer.from(src));
  const count = int32(src, HDR.numbodyparts);
  const oldTable = int32(src, HDR.bodypartindex);
  // the base: past every body number the file has, which is the product of the counts by the compiler's rule
  let base = 1;
  for (let i = 0; i < count; i++) {
    const entry = oldTable + i * BODYPART.sizeof;
    base = Math.max(
      base * int32(src, entry + BODYPART.nummodels),
      int32(src, entry + BODYPART.base) * int32(src, entry + BODYPART.nummodels),
    );
  }
  // the submodels, each followed by nothing yet: its one mesh and that mesh's empty commands come after them all
  const meshes = models.length * MODEL.sizeof;
  const commands = meshes + models.length * MESH.sizeof;
  const modelTable = Buffer.alloc(commands + NO_COMMANDS);
  const modelsAt = file.add(modelTable);
  models.forEach((modelName, k) => {
    const entry = k * MODEL.sizeof;
    writeName(modelTable, entry + MODEL.name, modelName, LONG_NAME);
    modelTable.writeFloatLE(NEW_MODEL_RADIUS, entry + MODEL.boundingradius);
    modelTable.writeInt32LE(1, entry + MODEL.nummesh);
    modelTable.writeInt32LE(modelsAt + meshes + k * MESH.sizeof, entry + MODEL.meshindex);
    // every mesh points at the one end of commands: none has triangles
    modelTable.writeInt32LE(modelsAt + commands, meshes + k * MESH.sizeof + MESH.triindex);
  });
  const table = Buffer.alloc((count + 1) * BODYPART.sizeof);
  src.copy(table, 0, oldTable, oldTable + count * BODYPART.sizeof);
  const entry = count * BODYPART.sizeof;
  writeName(table, entry + BODYPART.name, name, LONG_NAME);
  table.writeInt32LE(models.length, entry + BODYPART.nummodels);
  table.writeInt32LE(base, entry + BODYPART.base);
  table.writeInt32LE(modelsAt, entry + BODYPART.modelindex);
  file.head.writeInt32LE(file.add(table), HDR.bodypartindex);
  file.head.writeInt32LE(count + 1, HDR.numbodyparts);
  return engineLayout(file.whole());
}

/**
 * Returns { mdl, removed, bases, bodies, changed }: a copy of the file with one bodypart taken out (`which`: its
 * number or its name), the counterpart of addBodypart. The bodyparts after it move up one, and every one left is
 * given the base a compiler writes (`basesByRule`: the product of the counts before it), so the body numbers are
 * counted again over the bodyparts that remain.
 * A body number the game asks for is read by the engine as floor(body / base) % count for each bodypart. Where
 * the new bases would make a number the file had show another submodel of a bodypart that remains (the bodypart
 * taken out had several submodels, and one after it has several too), it throws and says which numbers, unless
 * told: `renumber: true` takes the new numbers (`bodies` says, for every old number, the new one that shows what
 * it showed), `keep: true` keeps the bases the others had instead, so that every number shows what it showed of
 * them (two numbers may then show the same).
 *   removed  { name, models: [{ name, tris }] }: what was taken out
 *   bases    each remaining bodypart's base
 *   bodies   [{ was, now }]: every body number the file had, and the one that shows the same submodels now
 *   changed  the body numbers that show something else of the bodyparts that remain ([] unless renumbered)
 * It throws when the model has no such bodypart, or only that one (the engine needs one at least).
 */
export function removeBodypart(src, which, { renumber = false, keep = false } = {}) {
  const info = readMdl(src);
  const parts = info.bodyparts;
  const k = typeof which === "number" ? which : parts.findIndex((bp) => bp.name === which);
  if (!parts[k])
    throw new Error(
      `removeBodypart: no bodypart ${JSON.stringify(which)}: it has ${parts.map((bp, i) => `${i} ${bp.name}`).join(", ")}`,
    );
  if (parts.length === 1)
    throw new Error(`removeBodypart: ${parts[k].name} is the model's only bodypart, and the engine needs one`);
  const left = parts.map((_, i) => i).filter((i) => i !== k);
  let product = 1;
  const byRule = left.map((i) => {
    const own = product;
    product *= parts[i].models.length;
    return own;
  });
  const bases = keep ? left.map((i) => parts[i].base) : byRule;
  // every body number the file had: what it showed of each bodypart that remains, before and after
  const count = Math.max(1, ...parts.map((bp) => bp.base * bp.models.length));
  const shownBy = (body, base, n) => (n ? Math.floor(body / base) % n : 0);
  const bodies = [];
  const changed = [];
  for (let body = 0; body < count; body++) {
    const was = left.map((i) => shownBy(body, parts[i].base, parts[i].models.length));
    const now = left.map((i, j) => shownBy(body, bases[j], parts[i].models.length));
    bodies.push({ was: body, now: was.reduce((sum, m, j) => sum + m * bases[j], 0) });
    if (was.some((m, j) => m !== now[j])) changed.push(body);
  }
  if (changed.length && !renumber) {
    const said = changed
      .slice(0, 6)
      .map((body) => {
        const swaps = left.flatMap((i, j) => {
          const models = parts[i].models;
          const was = models[shownBy(body, parts[i].base, models.length)].name;
          const now = models[shownBy(body, bases[j], models.length)].name;
          return was === now ? [] : [`${now} instead of ${was}`];
        });
        return `body ${body} would show ${swaps.join(", ")}`;
      })
      .join("; ");
    throw new Error(
      `removeBodypart: taking ${parts[k].name} out changes what ${changed.length} body numbers show: ${said}${changed.length > 6 ? " ..." : ""}. Give { renumber: true } for the new numbers (\`bodies\` maps the old to the new), or { keep: true } to keep the other bodyparts' bases`,
    );
  }
  // the table written again where it was, one entry shorter (the last entry's room left as zeros): the file
  // keeps its size
  const out = Buffer.from(src);
  const oldTable = int32(src, HDR.bodypartindex);
  const table = Buffer.alloc(parts.length * BODYPART.sizeof);
  left.forEach((i, j) => {
    src.copy(table, j * BODYPART.sizeof, oldTable + i * BODYPART.sizeof, oldTable + (i + 1) * BODYPART.sizeof);
    table.writeInt32LE(bases[j], j * BODYPART.sizeof + BODYPART.base);
  });
  table.copy(out, oldTable);
  out.writeInt32LE(left.length, HDR.numbodyparts);
  return {
    mdl: engineLayout(out),
    removed: {
      name: parts[k].name,
      models: parts[k].models.map((m) => ({ name: m.name, tris: m.meshes.reduce((n, mesh) => n + mesh.numtris, 0) })),
    },
    bases,
    bodies,
    changed,
  };
}

/** The name in the model's header (studiomdl writes the file's name there: `models/player/x/x.mdl`). */
export const modelName = (mdl) => textAt(mdl, HDR.name, LONG_NAME);

/**
 * Returns a copy of the file with another name in its header: a model made from another keeps that one's name
 * until told (a player made from the merc still says merc.mdl inside). At most 63 letters, of Latin-1.
 */
export function setModelName(src, name) {
  const latin1 = typeof name === "string" && [...name].every((ch) => ch.charCodeAt(0) >= 1 && ch.charCodeAt(0) <= 255);
  if (!latin1 || !name.length || name.length > LONG_NAME - 1)
    throw new Error(`setModelName: a name of 1 to ${LONG_NAME - 1} Latin-1 letters, not ${JSON.stringify(name)}`);
  const out = Buffer.from(src);
  out.fill(0, HDR.name, HDR.name + LONG_NAME);
  writeName(out, HDR.name, name, LONG_NAME);
  return out;
}

/**
 * The `base` a compiler writes for each bodypart of a file: 1 for the first, and for each one after it the
 * product of the counts of submodels of those before it. With those bases every pairing of submodels has a
 * body number of its own: the sum, over the bodyparts, of a submodel's number times its bodypart's base.
 */
export const basesByRule = (mdl) => {
  let base = 1;
  return readMdl(mdl).bodyparts.map((bodypart) => {
    const own = base;
    base *= bodypart.models.length;
    return own;
  });
};

/**
 * Returns a copy of the file with one mesh left without triangles (its normals stay, so the others keep
 * their turn).
 */
export function emptyMesh(src, where) {
  const file = growing(Buffer.from(src));
  const mesh = readMdl(src).bodyparts[where.bodypart].models[where.model].meshes[where.mesh];
  file.head.writeInt32LE(0, mesh.at + MESH.numtris);
  file.head.writeInt32LE(file.add(Buffer.alloc(NO_COMMANDS)), mesh.at + MESH.triindex);
  return engineLayout(file.whole());
}

/**
 * Returns a copy of the file with a submodel emptied: its meshes keep their places and textures with no
 * triangles, and its points and normals are gone, so that what replaceMesh puts in next counts alone
 * against the engine's 2048 a submodel. Use it only where every mesh of the submodel is given anew.
 */
export function clearModel(src, where) {
  const file = growing(Buffer.from(src));
  const model = readMdl(src).bodyparts[where.bodypart].models[where.model];
  for (const mesh of model.meshes) {
    file.head.writeInt32LE(0, mesh.at + MESH.numtris);
    file.head.writeInt32LE(file.add(Buffer.alloc(NO_COMMANDS)), mesh.at + MESH.triindex);
    file.head.writeInt32LE(0, mesh.at + MESH.numnorms);
  }
  file.head.writeInt32LE(0, model.at + MODEL.numverts);
  file.head.writeInt32LE(0, model.at + MODEL.numnorms);
  return engineLayout(file.whole());
}

/**
 * Returns a copy of the file with one mesh keeping only the triangles `keep` accepts; it is
 * given the bones of a triangle's three corners. Vertices and normals stay as they are.
 */
export function filterMesh(src, where, keep) {
  const file = growing(Buffer.from(src));
  const model = readMdl(src).bodyparts[where.bodypart].models[where.model];
  const mesh = model.meshes[where.mesh];
  const vertBones = int32(src, model.at + MODEL.vertinfoindex);
  const tris = readTris(src, mesh.triindex).tris.filter((tri) =>
    keep(tri.map(([vertex]) => src[vertBones + vertex])),
  );
  file.head.writeInt32LE(tris.length, mesh.at + MESH.numtris);
  file.head.writeInt32LE(file.add(stripsOf(tris)), mesh.at + MESH.triindex);
  return engineLayout(file.whole());
}

/**
 * Returns a copy of the file with some triangles of one mesh moved into a mesh of their own, after the others
 * of the same submodel, wearing `texture`: { mdl, mesh (the new mesh's number), moved }.
 *   where    { bodypart, model, mesh }: the mesh they are in
 *   pick(i)  true for a triangle that moves (`i`: its number in the mesh, as `readMesh` lists them)
 *   uvOf(i, corner, [s, t])  where that corner is in the new picture, in its pixels; unless given, where it
 *            was in the old one
 * The triangles keep their points and normals, copied into the new mesh, which keeps its normals in a block
 * of its own as the engine lights them, mesh by mesh. The old mesh keeps the rest of its triangles; every
 * mesh, submodel and body keeps its number. As in `replaceMesh`, `texture` is added to the file unless one of
 * its name is there (that one is then worn); in a model of several skin families the new mesh wears it in
 * each. A mesh of which nothing is picked is left alone (`mesh` -1).
 */
export function moveTriangles(src, where, pick, texture, uvOf) {
  const model = readMdl(src).bodyparts[where.bodypart].models[where.model];
  const mesh = model.meshes[where.mesh];
  const all = readTris(src, mesh.triindex).tris;
  const moving = all.map((_, i) => Boolean(pick(i)));
  if (!moving.includes(true)) return { mdl: src, mesh: -1, moved: 0 };
  const fieldOf = (field) => int32(src, model.at + field);
  // each old point and normal the moved triangles use, once, with its bone: numbered anew for their mesh
  const gather = (vecField, boneField) => {
    const list = [];
    const bonesOf = [];
    const numbers = new Map();
    const numberOf = (old) => {
      if (!numbers.has(old)) {
        numbers.set(old, list.length);
        list.push(vec3At(src, fieldOf(vecField) + old * VEC3));
        bonesOf.push(src[fieldOf(boneField) + old]);
      }
      return numbers.get(old);
    };
    return { list, bonesOf, numberOf };
  };
  const points = gather(MODEL.vertindex, MODEL.vertinfoindex);
  const normals = gather(MODEL.normindex, MODEL.norminfoindex);
  const moved = [];
  all.forEach((tri, i) => {
    if (!moving[i]) return;
    moved.push(
      tri.map(([vertex, normal, s, t], corner) => {
        const [u, v] = uvOf ? uvOf(i, corner, [s, t]) : [s, t];
        return [points.numberOf(vertex), normals.numberOf(normal), Math.round(u), Math.round(v)];
      }),
    );
  });
  // the old mesh without them (its normals stay, so the meshes after it keep their turn)
  const file = growing(Buffer.from(src));
  const kept = all.filter((_, i) => !moving[i]);
  file.head.writeInt32LE(kept.length, mesh.at + MESH.numtris);
  file.head.writeInt32LE(file.add(stripsOf(kept)), mesh.at + MESH.triindex);
  const added = model.meshes.length;
  const out = replaceMesh(
    addMesh(engineLayout(file.whole()), where),
    { ...where, mesh: added },
    {
      verts: points.list,
      vertBones: points.bonesOf,
      norms: normals.list,
      normBones: normals.bonesOf,
      tris: moved,
    },
    texture,
  );
  return { mdl: out, mesh: added, moved: moved.length };
}

/**
 * How many corners the engine draws for each submodel: its meshes' triangle commands, corner by
 * corner. The renderer keeps them in a table of MAXSTUDIOVERTS (16384): one more and it writes past it.
 */
export const MAXSTUDIOVERTS = 16384;
export function drawnCorners(mdl) {
  mdl = asBuffer(mdl);
  const cornersIn = (commands) => {
    let count = 0;
    eachCorner(mdl, commands, () => count++);
    return count;
  };
  return readMdl(mdl).bodyparts.flatMap((bodypart) =>
    bodypart.models.map((model) => ({
      name: model.name,
      corners: model.meshes.reduce((sum, mesh) => sum + (mesh.numtris ? cornersIn(mesh.triindex) : 0), 0),
    })),
  );
}

// ── bones and poses ────────────────────────────────────────────────────────
/** Each bone's parent (-1 for a root). */
export const boneParents = (mdl) =>
  Array.from({ length: int32(mdl, HDR.numbones) }, (_, i) => int32(mdl, boneAt(mdl, i) + BONE.parent));

/** A bone's own matrix from its six values: where it is from its parent and how it is turned. */
const matrixOf = (v) => {
  const [sx, cx, sy, cy, sz, cz] = [v[3], v[4], v[5]].flatMap((a) => [Math.sin(a), Math.cos(a)]);
  // roll about x, then pitch about y, then yaw about z, as the engine's AngleQuaternion
  return [
    [cy * cz, sx * sy * cz - cx * sz, cx * sy * cz + sx * sz, v[0]],
    [cy * sz, sx * sy * sz + cx * cz, cx * sy * sz - sx * cz, v[1]],
    [-sy, sx * cy, cx * cy, v[2]],
  ];
};
/**
 * Every bone's matrix into model space, from each bone's six values (`values`) and its parent's number
 * (`parentOf(i)`): a bone's own matrix after its parent's. A parent comes before its children.
 */
function chain(values, parentOf) {
  const pose = [];
  values.forEach((six, i) => {
    const own = matrixOf(six);
    const parent = parentOf(i);
    pose.push(parent < 0 ? own : mul34(pose[parent], own));
  });
  return pose;
}
/** The six rest values of the bone whose entry is at `bone`. */
const restOf = (mdl, bone) => CHANNELS.map((j) => mdl.readFloatLE(bone + BONE.value + j * FLOAT32));

/**
 * Every bone's matrix (3 rows of 4) in the model's rest pose, from the bones' own default position and
 * angles.
 */
export function restPose(mdl) {
  mdl = asBuffer(mdl);
  const parents = boneParents(mdl);
  return chain(
    parents.map((_, i) => restOf(mdl, boneAt(mdl, i))),
    (i) => parents[i],
  );
}
/**
 * The model's animations: [{ name, fps, frames, loops, flags, activity, actweight, movement, motiontype,
 * speed, bbmin, bbmax, blends, blendtype, blendstart, blendend, group }] (mstudioseqdesc_t, 176 bytes).
 *  `loops`: the sequence is marked looping (STUDIO_LOOPING, the one bit studio.h gives `flags`).
 *  `activity`: what a monster's code asks for it as (ACTIVITY has the names; 0: only by its name), and
 *  `actweight` how often it is picked among the sequences of one activity.
 *  `movement`: how far the model travels in one play of it (linearmovement); the frames themselves stay in
 *  place. `speed`: the ground speed that makes, in units a second (distance * fps / (frames - 1), what the
 *  SDK's GetSequenceInfo gives a monster as m_flGroundSpeed; the engine also plays a player's legs by it, in
 *  StudioProcessGait). `motiontype`: the MOTION bits, LX LY LZ for the axes of `movement`.
 *  `bbmin`, `bbmax`: the box about the model through the whole sequence, in the model's space.
 *  `blends`: how many animations it blends between (1: none). `blendtype`, `blendstart`, `blendend`: for each
 *  of its two axes, the MOTION bit the game's value turns (XR, a pitch, on Half-Life's aiming) and the values the
 *  first and the last blend stand for (barney.mdl's shootgun: XR, -50 to 50); the game's 0 to 255 is laid over
 *  that range. Of four blends, the first two are the second axis's start, the next two its end.
 *  `group`: not 0 when the animation is kept in another file (poseAt cannot read it).
 *  `move` and `motion` are `movement` and `motiontype` under their older names.
 */
export function sequences(mdl) {
  mdl = asBuffer(mdl);
  return Array.from({ length: int32(mdl, HDR.numseq) }, (_, i) => {
    const seq = seqAt(mdl, i);
    const fps = mdl.readFloatLE(seq + SEQ.fps);
    const frames = int32(mdl, seq + SEQ.numframes);
    const flags = int32(mdl, seq + SEQ.flags);
    const movement = vec3At(mdl, seq + SEQ.linearmovement);
    const distance = Math.hypot(...movement);
    const motiontype = int32(mdl, seq + SEQ.motiontype);
    return {
      name: textAt(mdl, seq + SEQ.label, SHORT_NAME),
      fps,
      frames,
      loops: Boolean(flags & STUDIO_LOOPING),
      flags,
      activity: int32(mdl, seq + SEQ.activity),
      actweight: int32(mdl, seq + SEQ.actweight),
      movement,
      motiontype,
      motion: motiontype,
      move: movement,
      speed: frames > 1 && distance ? distance / ((frames - 1) / fps) : 0,
      bbmin: vec3At(mdl, seq + SEQ.bbmin),
      bbmax: vec3At(mdl, seq + SEQ.bbmax),
      blends: int32(mdl, seq + SEQ.numblends),
      blendtype: [0, 1].map((axis) => int32(mdl, seq + SEQ.blendtype + axis * 4)),
      blendstart: [0, 1].map((axis) => mdl.readFloatLE(seq + SEQ.blendstart + axis * 4)),
      blendend: [0, 1].map((axis) => mdl.readFloatLE(seq + SEQ.blendend + axis * 4)),
      group: int32(mdl, seq + SEQ.seqgroup),
    };
  });
}
/**
 * Every bone's matrix at a moment of an animation between its frames (`at` in frames, fractional), each
 * matrix's numbers mixed between the two frames around it: near enough a turn for the small steps of one
 * frame. With `loop`, past the last frame goes on to the first. An animation kept in another file is read from
 * `groups`, as poseAt reads it.
 */
export function poseBetween(mdl, seq, at, loop = true, groups) {
  mdl = asBuffer(mdl);
  const frames = int32(mdl, seqAt(mdl, seq) + SEQ.numframes);
  const moment = loop ? ((at % frames) + frames) % frames : Math.max(0, Math.min(frames - 1, at));
  const frame = Math.floor(moment);
  const next = loop ? (frame + 1) % frames : Math.min(frame + 1, frames - 1);
  const mix = moment - frame;
  const from = poseAt(mdl, seq, frame, 0, groups);
  const to = mix ? poseAt(mdl, seq, next, 0, groups) : from;
  return from.map((matrix, bone) =>
    matrix.map((row, r) => row.map((v, c) => v + (to[bone][r][c] - v) * mix)),
  );
}

/**
 * One channel at a frame, as the file stores it: how many steps of the bone's scale it is from the bone's
 * rest. `run`: where the channel's runs of values begin (see mstudioanimvalue_t above). `emptyRun`, when
 * given, is called on a run that covers no frame: the values end there.
 */
function stepAt(mdl, run, frame, emptyRun) {
  let left = frame;
  while (mdl[run + RUN.total] <= left) {
    if (emptyRun && !mdl[run + RUN.total]) emptyRun();
    left -= mdl[run + RUN.total];
    run += RUN.values + mdl[run + RUN.valid] * INT16;
  }
  // past the values written, the last of them holds
  const written = mdl[run + RUN.valid];
  const value = written > left ? left : written - 1;
  return mdl.readInt16LE(run + RUN.values + value * INT16);
}
/**
 * A bone's six values at a frame: its rest and, on the channels the animation moves, the stored steps
 * times the bone's scale. `bone`: where the bone's entry is; `anim`: where its mstudioanim_t is, in `data`
 * (the model's own file, or the sequence file that keeps the animation: the bones are always the model's).
 */
function valuesAt(mdl, bone, anim, frame, emptyRun, data = mdl) {
  return CHANNELS.map((j) => {
    const rest = mdl.readFloatLE(bone + BONE.value + j * FLOAT32);
    const offset = data.readUInt16LE(anim + ANIM.offset + j * INT16);
    if (!offset) return rest;
    return (
      rest + stepAt(data, anim + offset, frame, emptyRun) * mdl.readFloatLE(bone + BONE.scale + j * FLOAT32)
    );
  });
}
/**
 * The file an animation's values are in: the model's own, or for one kept in another file (`group` not 0)
 * that file, from `groups` (`groups[group]`, as sequenceFilesOf gives them). It throws when that is not given.
 */
function animFile(mdl, sequence, groups) {
  const group = int32(mdl, sequence + SEQ.seqgroup);
  if (!group) return mdl;
  const file = groups?.[group];
  if (!file) throw new Error("an animation kept in another file");
  if (file.toString("latin1", 0, 4) !== SEQUENCE_FILE_ID)
    throw new Error(
      `the file given for sequence group ${group} is not a sequence file (${SEQUENCE_FILE_ID})`,
    );
  return file;
}
/**
 * What poseAt and frameValues hand `stepAt` for a run that covers no frame: it throws, naming the bone whose
 * entry is at `bone`.
 */
const valuesEnd = (mdl, bone, frame) => () => {
  throw new Error(
    `the animation's values for ${textAt(mdl, bone + BONE.name, SHORT_NAME)} end before frame ${frame}`,
  );
};
/**
 * Every bone's matrix at one frame of an animation (its first blend, or the one asked for). An animation kept
 * in another file is read from `groups` (see frameValues). It throws, naming the bone, when the file's values
 * for a bone end before that frame.
 */
export function poseAt(mdl, seq, frame, blend = 0, groups) {
  mdl = asBuffer(mdl);
  const values = frameValues(mdl, seq, frame, blend, groups);
  return chain(values, (i) => int32(mdl, boneAt(mdl, i) + BONE.parent));
}
export const mul34 = (a, b) =>
  a.map((r) =>
    [0, 1, 2, 3].map((c) => r[0] * b[0][c] + r[1] * b[1][c] + r[2] * b[2][c] + (c === 3 ? r[3] : 0)),
  );
export const apply34 = (m, p) => m.map((r) => r[0] * p[0] + r[1] * p[1] + r[2] * p[2] + r[3]);
/** The inverse of a rigid matrix. */
export const inverse34 = (m) =>
  [0, 1, 2].map((r) => [
    m[0][r],
    m[1][r],
    m[2][r],
    -(m[0][r] * m[0][3] + m[1][r] * m[1][3] + m[2][r] * m[2][3]),
  ]);

// ── bones and whole models written ─────────────────────────────────────────
// A bone is 112 bytes (mstudiobone_t): name[32], parent, flags, six bone controllers (-1: none), six rest
// values (x y z, then the angles about x y z) and six scales (what one step of an animation's stored value
// is worth). An animation is, for each blend, a table of six offsets a bone (mstudioanim_t, 12 bytes; 0: the
// bone rests on that channel), each offset counted from its own entry to runs of values: [how many are
// written, how many frames they cover], then the values, as 16 bit steps.

/** Where a channel's runs end: they are read until they cover every frame. */
function runsEnd(mdl, at, frames) {
  let covered = 0;
  while (covered < frames) {
    covered += mdl[at + RUN.total];
    at += RUN.values + mdl[at + RUN.valid] * INT16;
  }
  return at;
}
/** A new bone's six rest values: [x, y, z, about x, about y, about z], 0 where it does not say. */
const restOfNew = (bone) => [...(bone.pos ?? [0, 0, 0]), ...(bone.rot ?? [0, 0, 0])];
function boneEntry(bone) {
  const entry = Buffer.alloc(BONE.sizeof);
  const rest = restOfNew(bone);
  writeName(entry, BONE.name, bone.name, SHORT_NAME);
  entry.writeInt32LE(bone.parent, BONE.parent);
  for (const j of CHANNELS) {
    entry.writeInt32LE(-1, BONE.bonecontroller + j * INT32);
    entry.writeFloatLE(rest[j], BONE.value + j * FLOAT32);
    entry.writeFloatLE(bone.scale?.[j] ?? restScale(j), BONE.scale + j * FLOAT32);
  }
  return entry;
}
/**
 * An animation being written: the table of every bone's offsets in every blend (`entries` of mstudioanim_t)
 * and, after it, the runs they point to. `put(entry, channel, runs)` adds a channel's runs after what is
 * there and points the entry at them; it returns false, and adds nothing, when they are further than an
 * offset reaches. `bytes()` is the whole.
 */
function animTable(entries) {
  const table = Buffer.alloc(entries * ANIM.sizeof);
  const data = [];
  let end = table.length;
  const put = (entry, channel, runs) => {
    const offset = end - entry * ANIM.sizeof;
    if (offset > MAX_ANIM_OFFSET) return false;
    table.writeUInt16LE(offset, entry * ANIM.sizeof + ANIM.offset + channel * INT16);
    data.push(runs);
    end += runs.length;
    return true;
  };
  return { put, bytes: () => Buffer.concat([table, ...data]) };
}
/**
 * Returns a copy of the file with more bones after the ones it has: [{ name, parent (a bone's number: one of
 * the file's, or of these, counted on from the file's), pos [x, y, z], rot [about x, y, z] }], each resting
 * in every animation. The bones it had keep their numbers, so its bone controllers, attachments, hit boxes
 * and every corner's bone stay as they were. The bone table and every animation are written again at the end
 * of the file (an animation's table has an entry a bone, and its offsets are counted from the entry, so the
 * values move with it); the old ones stay where they were, unused.
 */
export function addBones(src, bones) {
  const had = int32(src, HDR.numbones);
  bones.forEach((bone, k) => {
    if (bone.parent >= had + k || bone.parent < -1)
      throw new Error(`the bone ${bone.name} hangs from a bone after it`);
  });
  // each new bone after the file's, in the order given: its number is its place, and its parent's too
  return placeBones(
    src,
    bones.map((bone, k) => ({ ...bone, at: had + k, adopt: [] })),
  );
}
/** The most bones a model can have here: a corner names its bone in one byte. */
const MOST_BONES = 256;
/**
 * Returns a copy of the file with new bones put among the ones it has: [{ name, parent, pos [x, y, z], rot
 * [about x, y, z], at, adopt }], each resting in every animation.
 *  `at`: the bone's number in the new list. The places no new bone takes are filled by the file's bones in
 *  their order, then by the new bones given no `at`, in the order given; so with no `at` anywhere the new
 *  bones go after the file's, as addBones puts them. Two new bones cannot have one place.
 *  `parent`: a number is one of the file's bones, by its number in the file as it is (-1, or nothing: a
 *  root); a name is one of these new bones. It has to come before the new bone in the new list: the engine
 *  works a bone out after its parent, in the list's order.
 *  `adopt`: the file's bones (by their numbers in the file as it is) that hang from the new bone from then on
 *  in place of their parent. Only a new bone that hangs from their own parent and is not turned from it
 *  (`rot` [0, 0, 0]) can take them, and each has to come after it in the new list. An adopted bone's rest
 *  position becomes what it was less the new bone's `pos`: a frame's value is its rest and the stored steps
 *  times the bone's scale, so every frame of every animation puts it where it was, with nothing of the
 *  animation written again.
 * A new bone's name is one the model does not have. Everything that names a bone by its number follows the
 * bones to their new numbers: their parents, every corner's and every normal's bone, the attachments, hit
 * boxes and bone controllers, each animation's motionbone, and each animation's table (an entry a bone in
 * every blend; a new bone's entry is empty, so it rests). The bone table and every animation are written
 * again at the end of the file, as addBones writes them. It throws on an animation kept in another file: its
 * table cannot be rewritten here.
 */
export function insertBones(src, bones) {
  const had = int32(src, HDR.numbones);
  const now = had + bones.length;
  const names = readMdl(src).bones;
  bones.forEach((bone, k) => {
    if (typeof bone.name !== "string" || !bone.name) throw new Error(`new bone ${k} needs a name`);
    if (names.includes(bone.name)) throw new Error(`the model already has a bone named ${bone.name}`);
    if (bones.findIndex((other) => other.name === bone.name) !== k)
      throw new Error(`two new bones are named ${bone.name}`);
    if (bone.at === undefined) return;
    if (!Number.isInteger(bone.at) || bone.at < 0 || bone.at >= now)
      throw new Error(
        `the bone ${bone.name} is put at ${JSON.stringify(bone.at)}, and the new list has ${now} bones (0 to ${now - 1})`,
      );
    if (bones.findIndex((other) => other.at === bone.at) !== k)
      throw new Error(`two new bones are put at ${bone.at}`);
  });
  // every place in the new list: the ones asked for, then the file's bones in order, then the rest
  const taken = new Set(bones.map((bone) => bone.at).filter((at) => at !== undefined));
  const free = Array.from({ length: now }, (_, i) => i).filter((i) => !taken.has(i));
  const newOf = free.slice(0, had);
  let next = had;
  const places = bones.map((bone) => bone.at ?? free[next++]);
  const parentOf = (bone) => {
    const parent = bone.parent ?? -1;
    if (typeof parent === "string") {
      const k = bones.findIndex((other) => other.name === parent);
      if (k < 0)
        throw new Error(`the bone ${bone.name} hangs from ${parent}, which is none of the new bones`);
      return places[k];
    }
    if (!Number.isInteger(parent) || parent < -1 || parent >= had)
      throw new Error(
        `the bone ${bone.name} hangs from ${JSON.stringify(parent)}: a number is one of the file's ${had} bones (-1: none), a name one of the new bones`,
      );
    return parent < 0 ? -1 : newOf[parent];
  };
  const oldParents = boneParents(src);
  const adopted = new Set();
  const placed = bones.map((bone, k) => {
    const parent = parentOf(bone);
    if (parent >= places[k])
      throw new Error(
        `the bone ${bone.name} would be bone ${places[k]} and its parent bone ${parent}: a parent comes before its bones`,
      );
    const adopt = bone.adopt ?? [];
    const turned = restOfNew(bone).slice(3);
    for (const child of adopt) {
      if (!Number.isInteger(child) || child < 0 || child >= had)
        throw new Error(
          `the bone ${bone.name} adopts ${JSON.stringify(child)}, which is none of the file's ${had} bones`,
        );
      if (adopted.has(child)) throw new Error(`the bone ${names[child]} is adopted twice`);
      adopted.add(child);
      if (typeof bone.parent === "string" || oldParents[child] !== (bone.parent ?? -1))
        throw new Error(
          `the bone ${bone.name} adopts ${names[child]}, which does not hang from the bone the new one hangs from: only that bone's own children can be handed over`,
        );
      if (turned.some((angle) => angle !== 0))
        throw new Error(
          `the bone ${bone.name} adopts ${names[child]} and is turned (rot ${turned.join(", ")}): only a bone that is not turned from their parent keeps them where they were`,
        );
      if (newOf[child] < places[k])
        throw new Error(
          `the bone ${bone.name} adopts ${names[child]}, which would be bone ${newOf[child]}, before it (bone ${places[k]}): a parent comes before its bones`,
        );
    }
    return { ...bone, at: places[k], parent, adopt };
  });
  return placeBones(src, placed, newOf);
}
/**
 * What insertBones and addBones write: `bones` the new ones, each with its place in the new list (`at`), its
 * parent's number in that list and the file's bones it adopts (by their numbers in the file), all of it
 * already checked; `newOf[i]` the new number of the file's bone i (by default each keeps its own).
 */
function placeBones(src, bones, newOf = Array.from({ length: int32(src, HDR.numbones) }, (_, i) => i)) {
  const had = int32(src, HDR.numbones);
  const now = had + bones.length;
  if (now > MOST_BONES)
    throw new Error(
      `${now} bones: a corner names its bone in one byte, so a model holds ${MOST_BONES} at the most`,
    );
  const file = growing(Buffer.from(src));
  const { head, add } = file;
  const renumber = (bone) => (bone >= 0 && bone < had ? newOf[bone] : bone);
  // the new list: for each place, the file's bone that is there, or the new one
  const order = new Array(now);
  newOf.forEach((at, i) => (order[at] = { old: i }));
  bones.forEach((bone) => (order[bone.at] = { bone }));
  const adoptedBy = new Map(bones.flatMap((bone) => bone.adopt.map((child) => [child, bone])));
  const entries = order.map((place) => {
    if (place.bone) return boneEntry(place.bone);
    const at = boneAt(src, place.old);
    const entry = Buffer.from(src.subarray(at, at + BONE.sizeof));
    const by = adoptedBy.get(place.old);
    entry.writeInt32LE(by ? by.at : renumber(int32(entry, BONE.parent)), BONE.parent);
    // an adopted bone rests where it did, from the new bone that now carries it
    if (by)
      restOfNew(by)
        .slice(0, 3)
        .forEach((p, j) =>
          entry.writeFloatLE(entry.readFloatLE(BONE.value + j * FLOAT32) - p, BONE.value + j * FLOAT32),
        );
    return entry;
  });
  head.writeInt32LE(add(Buffer.concat(entries)), HDR.boneindex);
  head.writeInt32LE(now, HDR.numbones);
  // every corner's and every normal's bone, a byte each, read from the file as it was: two submodels may
  // share them
  for (let b = 0; b < int32(src, HDR.numbodyparts); b++) {
    const bodypart = int32(src, HDR.bodypartindex) + b * BODYPART.sizeof;
    for (let m = 0; m < int32(src, bodypart + BODYPART.nummodels); m++) {
      const model = int32(src, bodypart + BODYPART.modelindex) + m * MODEL.sizeof;
      for (const [count, index] of [
        [MODEL.numverts, MODEL.vertinfoindex],
        [MODEL.numnorms, MODEL.norminfoindex],
      ]) {
        const at = int32(src, model + index);
        for (let i = 0; i < int32(src, model + count); i++) head[at + i] = renumber(src[at + i]);
      }
    }
  }
  // the tables whose entries name a bone
  for (const [count, index, struct] of [
    [HDR.numattachments, HDR.attachmentindex, ATTACHMENT],
    [HDR.numhitboxes, HDR.hitboxindex, BBOX],
    [HDR.numbonecontrollers, HDR.bonecontrollerindex, BONECONTROLLER],
  ])
    for (let i = 0; i < int32(src, count); i++) {
      const entry = int32(src, index) + i * struct.sizeof;
      head.writeInt32LE(renumber(int32(src, entry + struct.bone)), entry + struct.bone);
    }
  for (let q = 0; q < int32(src, HDR.numseq); q++) {
    const seq = seqAt(src, q);
    const frames = int32(src, seq + SEQ.numframes);
    const blends = int32(src, seq + SEQ.numblends);
    const oldAnim = int32(src, seq + SEQ.animindex);
    if (int32(src, seq + SEQ.seqgroup))
      throw new Error(
        `the animation ${textAt(src, seq + SEQ.label, SHORT_NAME)} is kept in another file: its bones cannot be added to here`,
      );
    head.writeInt32LE(renumber(int32(src, seq + SEQ.motionbone)), seq + SEQ.motionbone);
    // the tables of every blend first, then each channel's values, as the compiler lays them
    const anim = animTable(blends * now);
    for (let blend = 0; blend < blends; blend++)
      order.forEach((place, at) => {
        if (place.bone) return;
        const oldEntry = oldAnim + (blend * had + place.old) * ANIM.sizeof;
        for (const j of CHANNELS) {
          const offset = src.readUInt16LE(oldEntry + ANIM.offset + j * INT16);
          if (!offset) continue;
          const runs = src.subarray(oldEntry + offset, runsEnd(src, oldEntry + offset, frames));
          if (!anim.put(blend * now + at, j, runs))
            throw new Error(`the animation ${textAt(src, seq + SEQ.label, SHORT_NAME)} is too long to move`);
        }
      });
    head.writeInt32LE(add(anim.bytes()), seq + SEQ.animindex);
  }
  return engineLayout(file.whole());
}

/** How much of a stored value's range the widest swing of a channel takes in a model written from nothing. */
const STEPS_USED = 32000;
/** The least box a model written from nothing says it is drawn within: this far each way from its origin. */
const LEAST_BOX = 16;

/**
 * Each bone's six scales for a model written from nothing: the least that holds each channel's widest swing
 * in 16 bits, so nothing is lost that need not be. `rest`: each bone's six rest values.
 */
function scalesFor(rest, sequences) {
  return rest.map((restOfBone, i) =>
    CHANNELS.map((j) => {
      let widest = 0;
      for (const sequence of sequences)
        for (const frames of blendsOf(sequence))
          for (const frame of frames) widest = Math.max(widest, Math.abs(frame[i][j] - restOfBone[j]));
      return widest ? widest / STEPS_USED : restScale(j);
    }),
  );
}
/** A sequence's frames, blend by blend: its own `frames`, then each of `blendFrames`. */
const blendsOf = (sequence) => [sequence.frames, ...(sequence.blendFrames ?? [])];
/** A channel's values as runs of up to 255, every value written (none held). */
function plainRuns(steps) {
  const runs = [];
  for (let first = 0; first < steps.length; first += MAX_RUN) {
    const count = Math.min(MAX_RUN, steps.length - first);
    const run = Buffer.alloc(RUN.values + count * INT16);
    run[RUN.valid] = count;
    run[RUN.total] = count;
    for (let k = 0; k < count; k++) run.writeInt16LE(steps[first + k], RUN.values + k * INT16);
    runs.push(run);
  }
  return Buffer.concat(runs);
}
/**
 * The box about a model's points through some frames, in the model's space: { min, max }, or null for a model
 * of no points. `parents`: each bone's parent; `carried`: its points (see carriedPoints); `blends`: [for each
 * blend, its frames]. This is how studiomdl fills a sequence's bbmin and bbmax (in SimplifyModel, "find
 * bounding box for each sequence": every vertex of every submodel, taken through its bone at every frame of
 * every blend; from memory of its source, and borne out on Half-Life's own files: the boxes this gives for
 * sequences of zombie.mdl, hgrunt.mdl, headcrab.mdl, houndeye.mdl and bullsquid.mdl are the ones those files
 * have, to within 0.03 of a unit).
 */
function boxThrough(parents, carried, blends) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const frames of blends)
    for (const values of frames) {
      const pose = chain(values, (i) => parents[i]);
      for (const { verts, vertBones } of carried)
        verts.forEach((p, k) => {
          const matrix = pose[vertBones[k]];
          if (!matrix) return;
          for (let axis = 0; axis < 3; axis++) {
            const row = matrix[axis];
            const v = row[0] * p[0] + row[1] * p[1] + row[2] * p[2] + row[3];
            if (v < min[axis]) min[axis] = v;
            if (v > max[axis]) max[axis] = v;
          }
        });
    }
  return Number.isFinite(min[0]) ? { min, max } : null;
}
/**
 * Every submodel's points with the bone each is on: [{ verts: [[x, y, z]] in their bones' space, vertBones }],
 * of a file or of what writeMdl is given (its `bodyparts`).
 */
function carriedPoints(what) {
  if (!Buffer.isBuffer(what))
    return what.bodyparts.flatMap((bodypart) =>
      bodypart.models.map((model) => ({ verts: model.verts, vertBones: model.vertBones })),
    );
  return readMdl(what).bodyparts.flatMap((bodypart) =>
    bodypart.models.map((model) => {
      const points = int32(what, model.at + MODEL.vertindex);
      const theirBones = int32(what, model.at + MODEL.vertinfoindex);
      return {
        verts: Array.from({ length: model.numverts }, (_, i) => vec3At(what, points + i * VEC3)),
        vertBones: Array.from(what.subarray(theirBones, theirBones + model.numverts)),
      };
    }),
  );
}
/**
 * The motiontype of a sequence that travels `movement`: LX, LY and LZ for the axes it travels along, and
 * whatever else `was` there. studiomdl takes those bits from the QC ("LX" on the $sequence line), measures
 * the travel of the first bone along them from the first frame to the last, takes it out of the frames and
 * writes it as linearmovement (ExtractMotion, from memory of its source); here the frames are given in place
 * already and the travel is told, so the bits are the axes it is not zero on. Half-Life's own files: a walk
 * forwards has 64 (LX) and a sequence that stays 0; hgrunt's strafes have 192 (LX + LY) for a travel that is
 * all along y, the QC having named both, which `motiontype` given outright can say here too. Nothing in the
 * SDK's game code reads these three bits (GetSequenceInfo takes the speed from linearmovement alone).
 */
const travelBits = (movement, was = 0) =>
  TRAVEL_BITS.reduce((bits, bit, axis) => (movement[axis] ? bits | bit : bits & ~bit), was);
/** A table of events (mstudioevent_t), in the order of their frames, and four bytes of nothing after it. */
function eventTable(list) {
  const table = Buffer.alloc(list.length * EVENT.sizeof + 4);
  [...list]
    .sort((a, b) => a.frame - b.frame)
    .forEach((event, i) => {
      const entry = i * EVENT.sizeof;
      table.writeInt32LE(event.frame, entry + EVENT.frame);
      table.writeInt32LE(event.event, entry + EVENT.event);
      table.writeInt32LE(event.type ?? 0, entry + EVENT.type);
      writeName(table, entry + EVENT.options, String(event.options ?? ""), LONG_NAME);
    });
  return table;
}
/**
 * writeMdl's animations: each one's values, the table of them, the one sequence group, and the boxes: each
 * sequence's own, and the four of the header (`boxes`: { min, max, bbmin, bbmax }, those that were given).
 * `parents` and `carried`: the bones' parents and the model's points, for the boxes.
 */
function writeSequences(file, sequences, { rest, scale, parents, carried, boxes }) {
  const { head, add } = file;
  const table = Buffer.alloc(sequences.length * SEQ.sizeof);
  // for a model of no points, the box it had before boxes were measured: every position any bone takes in
  // any frame, and LEAST_BOX each way at the least
  const allValues = sequences.flatMap((sequence) => blendsOf(sequence).flat(2));
  const plain = {
    min: [0, 1, 2].map((axis) => allValues.reduce((v, six) => Math.min(v, six[axis]), -LEAST_BOX)),
    max: [0, 1, 2].map((axis) => allValues.reduce((v, six) => Math.max(v, six[axis]), LEAST_BOX)),
  };
  // every sequence's box together: what the header says when it is not told
  const whole = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  sequences.forEach((sequence, q) => {
    const entry = q * SEQ.sizeof;
    const said = `${sequence.name}: `;
    const blends = blendsOf(sequence);
    if (blends.some((frames) => frames.length !== sequence.frames.length))
      throw new Error(`${said}every blend has as many frames as its frames (${sequence.frames.length})`);
    // the tables of every blend first, then each channel's values, as the compiler lays them
    const anim = animTable(blends.length * rest.length);
    blends.forEach((frames, blend) => {
      for (let i = 0; i < rest.length; i++)
        for (const j of CHANNELS) {
          const steps = frames.map((frame) => Math.round((frame[i][j] - rest[i][j]) / scale[i][j]));
          if (steps.every((step) => !step)) continue;
          if (!anim.put(blend * rest.length + i, j, plainRuns(steps))) throw new Error(`the animation ${sequence.name} is too long`);
        }
    });
    writeName(table, entry + SEQ.label, sequence.name, SHORT_NAME);
    table.writeFloatLE(sequence.fps, entry + SEQ.fps);
    table.writeInt32LE((sequence.flags ?? 0) | (sequence.loops ? STUDIO_LOOPING : 0), entry + SEQ.flags);
    const activity = sequence.activity ?? 0;
    table.writeInt32LE(activity, entry + SEQ.activity);
    table.writeInt32LE(sequence.actweight ?? (activity ? 1 : 0), entry + SEQ.actweight);
    table.writeInt32LE(sequence.frames.length, entry + SEQ.numframes);
    const movement = threeNumbers(sequence.movement ?? [0, 0, 0], `${said}movement`);
    table.writeInt32LE(sequence.motiontype ?? travelBits(movement), entry + SEQ.motiontype);
    writeVec3(table, entry + SEQ.linearmovement, movement);
    // its box: told, or measured about the model's points through its frames
    const measured =
      sequence.bbmin && sequence.bbmax ? null : (boxThrough(parents, carried, blends) ?? plain);
    const bbmin = threeNumbers(sequence.bbmin ?? measured.min, `${said}bbmin`);
    const bbmax = threeNumbers(sequence.bbmax ?? measured.max, `${said}bbmax`);
    writeVec3(table, entry + SEQ.bbmin, bbmin);
    writeVec3(table, entry + SEQ.bbmax, bbmax);
    for (let axis = 0; axis < 3; axis++) {
      whole.min[axis] = Math.min(whole.min[axis], bbmin[axis]);
      whole.max[axis] = Math.max(whole.max[axis], bbmax[axis]);
    }
    if (sequence.events?.length) {
      table.writeInt32LE(sequence.events.length, entry + SEQ.numevents);
      table.writeInt32LE(add(eventTable(sequence.events)), entry + SEQ.eventindex);
    }
    table.writeInt32LE(blends.length, entry + SEQ.numblends);
    for (let axis = 0; axis < 2; axis++) {
      table.writeInt32LE(sequence.blendtype?.[axis] ?? 0, entry + SEQ.blendtype + axis * 4);
      table.writeFloatLE(sequence.blendstart?.[axis] ?? 0, entry + SEQ.blendstart + axis * 4);
      table.writeFloatLE(sequence.blendend?.[axis] ?? (blends.length > 1 && !axis ? 1 : 0), entry + SEQ.blendend + axis * 4);
    }
    table.writeInt32LE(add(anim.bytes()), entry + SEQ.animindex);
  });
  head.writeInt32LE(sequences.length, HDR.numseq);
  head.writeInt32LE(add(table), HDR.seqindex);
  const group = Buffer.alloc(SEQGROUP.sizeof);
  group.write("default", SEQGROUP.label, "latin1");
  head.writeInt32LE(1, HDR.numseqgroups);
  head.writeInt32LE(add(group), HDR.seqgroupindex);
  // The header's four: min and max are the box the model moves with (the QC's $bbox) and bbmin and bbmax the
  // box it is clipped by ($cbox). studiomdl leaves each at zero unless the QC says (zombie.mdl and
  // hgrunt.mdl have all four at zero; headcrab.mdl has min and max -12 -12 0 to 12 12 24). This kit has
  // always written the model's own box in all four, and goes on doing so for the ones not told.
  const own = sequences.length ? whole : plain;
  writeVec3(head, HDR.min, threeNumbers(boxes.min ?? own.min, "min"));
  writeVec3(head, HDR.max, threeNumbers(boxes.max ?? own.max, "max"));
  writeVec3(head, HDR.bbmin, threeNumbers(boxes.bbmin ?? own.min, "bbmin"));
  writeVec3(head, HDR.bbmax, threeNumbers(boxes.bbmax ?? own.max, "bbmax"));
}
/**
 * One submodel of writeMdl's: its meshes' commands, its mesh table, its points and normals. Returns its
 * entry.
 */
function modelEntry(file, model) {
  const { add } = file;
  const entry = Buffer.alloc(MODEL.sizeof);
  const norms = model.meshes.flatMap((mesh) => mesh.norms);
  const normBones = model.meshes.flatMap((mesh) => mesh.normBones);
  const meshes = Buffer.alloc(model.meshes.length * MESH.sizeof);
  // a mesh numbers its normals from 0; the submodel keeps them in one list, mesh after mesh
  let normsBefore = 0;
  model.meshes.forEach((mesh, q) => {
    const commands = stripsOf(
      mesh.tris.map((tri) => tri.map(([vertex, normal, s, t]) => [vertex, normsBefore + normal, s, t])),
    );
    meshes.writeInt32LE(mesh.tris.length, q * MESH.sizeof + MESH.numtris);
    meshes.writeInt32LE(add(commands), q * MESH.sizeof + MESH.triindex);
    meshes.writeInt32LE(mesh.skin ?? 0, q * MESH.sizeof + MESH.skinref);
    meshes.writeInt32LE(mesh.norms.length, q * MESH.sizeof + MESH.numnorms);
    normsBefore += mesh.norms.length;
  });
  writeName(entry, MODEL.name, model.name, LONG_NAME);
  entry.writeFloatLE(NEW_MODEL_RADIUS, MODEL.boundingradius);
  entry.writeInt32LE(model.meshes.length, MODEL.nummesh);
  entry.writeInt32LE(add(meshes), MODEL.meshindex);
  entry.writeInt32LE(model.verts.length, MODEL.numverts);
  entry.writeInt32LE(add(Buffer.from(model.vertBones)), MODEL.vertinfoindex);
  entry.writeInt32LE(add(vec3s(model.verts)), MODEL.vertindex);
  entry.writeInt32LE(norms.length, MODEL.numnorms);
  entry.writeInt32LE(add(Buffer.from(normBones)), MODEL.norminfoindex);
  entry.writeInt32LE(add(vec3s(norms)), MODEL.normindex);
  return entry;
}
/**
 * writeMdl's shapes: each model's corners, then mesh by mesh its normals and triangles (each triangle a
 * strip of three).
 */
function writeBodyparts(file, bodyparts) {
  const { head, add } = file;
  const table = Buffer.alloc(bodyparts.length * BODYPART.sizeof);
  // a body number picks one submodel of each bodypart: floor(body / base) modulo its count of them
  let base = 1;
  bodyparts.forEach((bodypart, b) => {
    const models = Buffer.alloc(bodypart.models.length * MODEL.sizeof);
    bodypart.models.forEach((model, k) => modelEntry(file, model).copy(models, k * MODEL.sizeof));
    const entry = b * BODYPART.sizeof;
    writeName(table, entry + BODYPART.name, bodypart.name, LONG_NAME);
    table.writeInt32LE(bodypart.models.length, entry + BODYPART.nummodels);
    table.writeInt32LE(base, entry + BODYPART.base);
    table.writeInt32LE(add(models), entry + BODYPART.modelindex);
    base *= bodypart.models.length;
  });
  head.writeInt32LE(bodyparts.length, HDR.numbodyparts);
  head.writeInt32LE(add(table), HDR.bodypartindex);
}
/** writeMdl's pictures: the table, the families, then each picture's dots and its palette. */
function writeTextures(file, textures, skins) {
  const { head, add } = file;
  const refs = skins ? skins[0].length : textures.length;
  const families = skins ?? [textures.map((_, i) => i)];
  const skinTable = Buffer.alloc(families.length * refs * SKINREF);
  families.forEach((family, f) =>
    family.forEach((texture, ref) => skinTable.writeInt16LE(texture, (f * refs + ref) * SKINREF)),
  );
  const table = Buffer.alloc(textures.length * TEXTURE.sizeof);
  head.writeInt32LE(textures.length, HDR.numtextures);
  head.writeInt32LE(add(table), HDR.textureindex);
  head.writeInt32LE(refs, HDR.numskinref);
  head.writeInt32LE(families.length, HDR.numskinfamilies);
  head.writeInt32LE(add(skinTable), HDR.skinindex);
  textures.forEach((texture, i) => {
    const dataAt = add(textureData(texture));
    textureEntry(texture, dataAt).copy(table, i * TEXTURE.sizeof);
    if (!i) head.writeInt32LE(dataAt, HDR.texturedataindex);
  });
}

/**
 * A whole model written from nothing (version 10, its textures inside it):
 *   name       what the file calls itself
 *   bones      [{ name, parent (-1 for a root), pos, rot }], a parent before its children
 *   sequences  [{ name, fps, loops, frames: [ for each frame, for each bone, [x, y, z, about x, about y,
 *              about z] ] }]
 *   textures   [{ name, width, height, pixels (one palette index each), palette (768 bytes), flags (64: its
 *              last colour is a hole) }]
 *   skins      the families: for each, which texture each mesh's `skin` number means (default: one family,
 *              as numbered)
 *   bodyparts  [{ name, models: [{ name, verts: [[x, y, z]] in their bones' space, vertBones, meshes:
 *              [{ skin, norms, normBones, tris: [[[vert, norm (of this mesh's), s, t] x3]] }] }] }]
 * and, for a thing that lives (a monster), what the rest of the format holds:
 *   sequences  each may also say activity and actweight, movement [x, y, z] (how far the model travels in
 *              one play of it, its frames staying in place: see travelBits for the motiontype that sets, or
 *              give motiontype), events [{ frame, event, options, type }], flags, blendFrames (the frames of each blend
 *              after its first, `frames`: a gun aimed down, then up) with blendtype, blendstart and blendend
 *              (each of two axes, as `sequences` reads them), and bbmin and bbmax (its
 *              box, which is otherwise measured about the model's points through its frames, as studiomdl
 *              does: the engine culls by it)
 *   hitboxes   [{ bone (its number or name), group (HITGROUP; 0 unless told), min, max (in the bone's
 *              space) }], or "auto", or the options of autoHitboxes ({ groups, least, thin })
 *   attachments  [{ name, bone, pos [x, y, z] in the bone's space }]
 *   controllers  [{ bone, type (MOTION.XR ...), start, end, rest, index }]: see setBoneControllers
 *   eyes       [x, y, z]: where it sees from (eyeposition; the QC's $eyeposition)
 *   min, max, bbmin, bbmax   the header's boxes: see writeSequences for what they are when not told
 * Every bodypart needs one submodel at least (it may have no meshes): one with none is refused.
 */
export function writeMdl({
  name,
  bones,
  sequences,
  textures,
  skins = null,
  bodyparts,
  hitboxes: boxesAsked = [],
  attachments: fastened = [],
  controllers = [],
  eyes = [0, 0, 0],
  min,
  max,
  bbmin,
  bbmax,
}) {
  // the engine picks a bodypart's submodel by dividing by how many it has: none stops it
  for (const bodypart of bodyparts)
    if (!bodypart.models.length)
      throw new Error(
        `${name}: the bodypart ${bodypart.name} has no submodel, and the engine needs one at least: give it one (a submodel with no meshes shows nothing), or leave the bodypart out`,
      );
  const file = growing(Buffer.alloc(HDR.sizeof));
  const { head, add } = file;
  head.write(STUDIO_ID, HDR.id, "latin1");
  head.writeInt32LE(STUDIO_VERSION, HDR.version);
  writeName(head, HDR.name, name, LONG_NAME);
  // each channel's scale is the least that holds its widest swing in 16 bits, so nothing is lost that need
  // not be
  const rest = bones.map(restOfNew);
  const scale = scalesFor(rest, sequences);
  writeVec3(head, HDR.eyeposition, threeNumbers(eyes, `${name}: eyes`));
  const names = bones.map((bone) => bone.name);
  const boneTable = Buffer.concat(bones.map((bone, i) => boneEntry({ ...bone, scale: scale[i] })));
  head.writeInt32LE(bones.length, HDR.numbones);
  head.writeInt32LE(controllers.length, HDR.numbonecontrollers);
  head.writeInt32LE(add(controllerTable(controllers, names, boneTable)), HDR.bonecontrollerindex);
  head.writeInt32LE(add(boneTable), HDR.boneindex);
  const boxes = Array.isArray(boxesAsked)
    ? boxesAsked
    : autoHitboxes({ bones, bodyparts }, boxesAsked === "auto" ? {} : boxesAsked);
  head.writeInt32LE(boxes.length, HDR.numhitboxes);
  head.writeInt32LE(add(hitboxTable(boxes, names)), HDR.hitboxindex);
  head.writeInt32LE(fastened.length, HDR.numattachments);
  head.writeInt32LE(add(attachmentTable(fastened, names)), HDR.attachmentindex);
  // tables with nothing in them
  const nowhere = add(Buffer.alloc(4));
  for (const index of EMPTY_TABLES) head.writeInt32LE(nowhere, index);
  writeSequences(file, sequences, {
    rest,
    scale,
    parents: bones.map((bone) => bone.parent),
    carried: carriedPoints({ bodyparts }),
    boxes: { min, max, bbmin, bbmax },
  });
  writeBodyparts(file, bodyparts);
  writeTextures(file, textures, skins);
  return engineLayout(file.whole());
}

// ── pictures read and changed ──────────────────────────────────────────────
const textureNumber = (mdl, which) => {
  const list = readMdl(mdl).textures;
  const i =
    typeof which === "number"
      ? which
      : list.findIndex((t) => t.name.toLowerCase() === String(which).toLowerCase());
  if (!list[i]) throw new Error(`no texture ${which}`);
  return i;
};
/**
 * One of the file's textures, copied out: { name, flags, width, height, pixels, palette }. `which`: its
 * number or its name.
 */
export function textureOf(mdl, which) {
  mdl = asBuffer(mdl);
  const texture = readMdl(mdl).textures[textureNumber(mdl, which)];
  const count = texture.width * texture.height;
  const palette = texture.index + count;
  return {
    name: texture.name,
    flags: texture.flags,
    width: texture.width,
    height: texture.height,
    pixels: Uint8Array.from(mdl.subarray(texture.index, palette)),
    palette: Uint8Array.from(mdl.subarray(palette, palette + PALETTE)),
  };
}
/**
 * What a change of size leaves at odds: the submodels with a mesh that wears texture `number` in one skin
 * family and, in another, a texture that is not `width` by `height`. Returns { wearers: the submodels' names,
 * others: those textures as "name (WxH)" }, each once.
 */
function sizesApart(src, info, number, width, height) {
  const families = skinFamilies(src);
  const wearers = new Set();
  const others = new Set();
  for (const bodypart of info.bodyparts)
    for (const model of bodypart.models)
      for (const mesh of model.meshes) {
        if (!mesh.numtris) continue;
        const worn = families.map((family) => family[mesh.skinref]);
        if (!worn.includes(number)) continue;
        for (const other of worn) {
          const its = info.textures[other];
          if (other === number || !its || (its.width === width && its.height === height)) continue;
          wearers.add(model.name);
          others.add(`${its.name} (${its.width}x${its.height})`);
        }
      }
  return { wearers: [...wearers], others: [...others] };
}
/**
 * Returns a copy of the file with one of its textures holding another picture: { width, height, pixels,
 * palette } and, when given, `name` and `flags`. Every mesh that wears it goes on wearing it. A picture of
 * another size is written at the end of the file and the corners of the meshes that wear it, which are kept
 * in pixels, are moved to the same place in the new one.
 * A mesh keeps one set of corners, counted in pixels of the texture it wears in the first skin family, so the
 * textures it wears in the other families have to be of that size. The corners moved are therefore those of
 * the meshes that wear this texture in the first family. Where a new size leaves a mesh wearing pictures of
 * different sizes in different skins, one of them lies wrongly on it, and that is told on the console (unless
 * `quiet`): replace the others at the same size too, in any order, and it is right again.
 */
export function replaceTexture(src, which, texture, { quiet = false } = {}) {
  const i = textureNumber(src, which);
  const info = readMdl(src);
  const old = info.textures[i];
  const entry = int32(src, HDR.textureindex) + i * TEXTURE.sizeof;
  const count = texture.width * texture.height;
  if (texture.pixels.length !== count || texture.palette.length !== PALETTE)
    throw new Error(
      `${old.name}: ${texture.width}x${texture.height} needs ${count} pixels and 768 bytes of palette`,
    );
  const data = textureData(texture);
  let out;
  if (texture.width === old.width && texture.height === old.height) {
    out = Buffer.from(src);
    data.copy(out, old.index);
  } else {
    const file = growing(Buffer.from(src));
    const dataAt = file.add(data);
    out = file.whole();
    out.writeInt32LE(texture.width, entry + TEXTURE.width);
    out.writeInt32LE(texture.height, entry + TEXTURE.height);
    out.writeInt32LE(dataAt, entry + TEXTURE.index);
    // the corners of the meshes that wear it (in the first skin family: a mesh's corners are in pixels of
    // that one), to the same place in a picture of the new size
    const scaleS = texture.width / old.width;
    const scaleT = texture.height / old.height;
    const scaled = (at, scale) => out.writeInt16LE(Math.round(out.readInt16LE(at) * scale), at);
    for (const bodypart of info.bodyparts)
      for (const model of bodypart.models)
        for (const mesh of model.meshes) {
          if (mesh.texture !== old || !mesh.numtris) continue;
          eachCorner(out, mesh.triindex, (corner) => {
            scaled(corner + CORNER.s, scaleS);
            scaled(corner + CORNER.t, scaleT);
          });
        }
    const apart = sizesApart(src, info, i, texture.width, texture.height);
    if (apart.others.length && !quiet)
      console.warn(
        `smak: replaceTexture: ${old.name} is now ${texture.width}x${texture.height}, and ${apart.wearers.join(", ")} ${apart.wearers.length > 1 ? "wear" : "wears"} it in one skin and ${apart.others.join(", ")} in another. A mesh keeps one place in the picture for each corner, in pixels of the picture it wears in the first skin, so until those pictures are all one size one skin or another lies wrongly on it: replace the others at ${texture.width}x${texture.height} too`,
      );
  }
  if (texture.name !== undefined && texture.name !== old.name) {
    out.fill(0, entry + TEXTURE.name, entry + TEXTURE.name + LONG_NAME);
    writeName(out, entry + TEXTURE.name, texture.name, LONG_NAME);
  }
  if (texture.flags !== undefined) out.writeInt32LE(texture.flags, entry + TEXTURE.flags);
  return engineLayout(out);
}
/** How many textures a model holds inside itself, read from its header: none for one that keeps them in `name`t.mdl. */
export const texturesInside = (src) => (src.length > HDR.numtextures + 4 ? int32(src, HDR.numtextures) : 0);

/**
 * A model whose textures are kept in a file of their own (`name`t.mdl beside `name`.mdl: the model itself
 * says it has none), with them put inside it: returns a copy of `src` holding the textures and the skin
 * table of `tfile`.
 */
export function withTextures(src, tfile) {
  if (int32(src, HDR.numtextures)) return src;
  const file = growing(Buffer.from(src));
  const { head, add } = file;
  const count = int32(tfile, HDR.numtextures);
  const theirTable = int32(tfile, HDR.textureindex);
  const table = Buffer.from(tfile.subarray(theirTable, theirTable + count * TEXTURE.sizeof));
  for (let i = 0; i < count; i++) {
    const entry = i * TEXTURE.sizeof;
    const size =
      table.readInt32LE(entry + TEXTURE.width) * table.readInt32LE(entry + TEXTURE.height) + PALETTE;
    const theirs = table.readInt32LE(entry + TEXTURE.index);
    table.writeInt32LE(add(tfile.subarray(theirs, theirs + size)), entry + TEXTURE.index);
    if (!i) head.writeInt32LE(table.readInt32LE(TEXTURE.index), HDR.texturedataindex);
  }
  head.writeInt32LE(count, HDR.numtextures);
  head.writeInt32LE(add(table), HDR.textureindex);
  const refs = int32(tfile, HDR.numskinref);
  const families = int32(tfile, HDR.numskinfamilies);
  const theirSkins = int32(tfile, HDR.skinindex);
  head.writeInt32LE(refs, HDR.numskinref);
  head.writeInt32LE(families, HDR.numskinfamilies);
  head.writeInt32LE(add(tfile.subarray(theirSkins, theirSkins + refs * families * SKINREF)), HDR.skinindex);
  return engineLayout(file.whole());
}
/**
 * The skin families: for each, which texture (its number) each mesh's `skinref` means. A model shown with
 * `skin` n wears family n.
 */
export function skinFamilies(mdl) {
  mdl = asBuffer(mdl);
  const refs = int32(mdl, HDR.numskinref);
  const table = int32(mdl, HDR.skinindex);
  return Array.from({ length: int32(mdl, HDR.numskinfamilies) }, (_, family) =>
    Array.from({ length: refs }, (_, ref) => mdl.readInt16LE(table + (family * refs + ref) * SKINREF)),
  );
}
/** Which submodel of each bodypart a `body` number shows, as the engine works it out. */
export const bodyOf = (mdl, body = 0) =>
  readMdl(mdl).bodyparts.map((bodypart) =>
    bodypart.models.length ? Math.floor(body / bodypart.base) % bodypart.models.length : 0,
  );

// ── animations read whole and written into a file ──────────────────────────
// A frame is, for every bone, six numbers: where it is from its parent (x y z) and how it is turned (about
// x y z, radians).

/**
 * Every bone's matrix for a frame given as numbers ([for each bone, [x, y, z, about x, about y, about z]]):
 * what poseAt gives for a frame of the file.
 */
export function poseOf(mdl, values) {
  mdl = asBuffer(mdl);
  const parents = boneParents(mdl);
  return chain(values, (i) => parents[i]);
}
/**
 * Every bone's matrix for a frame of numbers and each bone's parent's number (a parent before its children): what
 * poseOf gives, for a skeleton that is not the file's (one with bones added).
 */
export const poseOfValues = (values, parents) => chain(values, (i) => parents[i]);
/**
 * The bones as they rest: [{ name, parent, pos [x, y, z], rot [about x, y, z], scale (what one stored step
 * of each of the six is worth) }].
 */
export function bones(mdl) {
  mdl = asBuffer(mdl);
  return Array.from({ length: int32(mdl, HDR.numbones) }, (_, i) => {
    const bone = boneAt(mdl, i);
    const rest = restOf(mdl, bone);
    return {
      name: textAt(mdl, bone + BONE.name, SHORT_NAME),
      parent: int32(mdl, bone + BONE.parent),
      pos: rest.slice(0, 3),
      rot: rest.slice(3),
      scale: CHANNELS.map((j) => mdl.readFloatLE(bone + BONE.scale + j * FLOAT32)),
    };
  });
}
/**
 * One frame of an animation as numbers: for each bone, [x, y, z, about x, about y, about z]. An animation
 * kept in another file (`group` not 0) is read from `groups[group]`, that file's bytes (sequenceFilesOf
 * reads them beside the model); without it, it throws "an animation kept in another file". It throws, naming
 * the bone, when the file's values for a bone end before that frame.
 */
export function frameValues(mdl, seq, frame, blend = 0, groups) {
  mdl = asBuffer(mdl);
  const sequence = seqAt(mdl, seq);
  const count = int32(mdl, HDR.numbones);
  const anim = int32(mdl, sequence + SEQ.animindex) + blend * count * ANIM.sizeof;
  const data = animFile(mdl, sequence, groups);
  return Array.from({ length: count }, (_, i) => {
    const bone = boneAt(mdl, i);
    return valuesAt(mdl, bone, anim + i * ANIM.sizeof, frame, valuesEnd(mdl, bone, frame), data);
  });
}
/**
 * An animation whole: what sequences() tells of it and `frames` (see frameValues), of its first blend or the
 * one asked for; one kept in another file from `groups`.
 */
export function readSequence(mdl, which, blend = 0, groups) {
  mdl = asBuffer(mdl);
  const index = sequenceAt(mdl, which);
  const sequence = sequences(mdl)[index];
  if (!sequence) throw new Error(`no animation ${which}`);
  return {
    ...sequence,
    index,
    frames: Array.from({ length: sequence.frames }, (_, frame) =>
      frameValues(mdl, index, frame, blend, groups),
    ),
  };
}
/**
 * The model's sequence groups (mstudioseqgroup_t): [{ label, name }], the first ("default") the model's own
 * file, each after it a file of animations (`name` as the model says it: "models\hgrunt01.mdl").
 */
export function sequenceGroups(mdl) {
  mdl = asBuffer(mdl);
  const table = int32(mdl, HDR.seqgroupindex);
  return Array.from({ length: int32(mdl, HDR.numseqgroups) }, (_, i) => ({
    label: textAt(mdl, table + i * SEQGROUP.sizeof + SEQGROUP.label, SHORT_NAME),
    name: textAt(mdl, table + i * SEQGROUP.sizeof + SEQGROUP.name, LONG_NAME),
  }));
}
/**
 * Returns a copy of the file with its bones' six rest values and six scales changed where `list` says:
 * [{ pos, rot, scale }] by bone number, each part left as it is when not given (an entry may be undefined).
 * Nothing else is touched. The stored steps of every animation are read against these (rest + step * scale),
 * so a position's rest and its scale multiplied together multiply that position in every frame of every
 * animation, those kept in other files too, without one of them being written again.
 */
export function setBoneValues(src, list) {
  const out = Buffer.from(src);
  list.forEach((bone, i) => {
    if (!bone) return;
    if (i >= int32(src, HDR.numbones)) throw new Error(`setBoneValues: the model has no bone ${i}`);
    const at = boneAt(src, i);
    if (bone.pos)
      threeNumbers(bone.pos, `bone ${i}: pos`).forEach((v, j) =>
        out.writeFloatLE(v, at + BONE.value + j * FLOAT32),
      );
    if (bone.rot)
      threeNumbers(bone.rot, `bone ${i}: rot`).forEach((v, j) =>
        out.writeFloatLE(v, at + BONE.value + (3 + j) * FLOAT32),
      );
    if (bone.scale) {
      if (!Array.isArray(bone.scale) || bone.scale.length !== 6 || !bone.scale.every(Number.isFinite))
        throw new Error(`bone ${i}: scale needs six numbers`);
      bone.scale.forEach((v, j) => out.writeFloatLE(v, at + BONE.scale + j * FLOAT32));
    }
  });
  return out;
}
/**
 * The header's eye and boxes: { eyes (eyeposition), min, max (the box it moves with), bbmin, bbmax (the box
 * it is clipped by) }, each [x, y, z].
 */
export function modelBoxes(mdl) {
  mdl = asBuffer(mdl);
  return {
    eyes: vec3At(mdl, HDR.eyeposition),
    min: vec3At(mdl, HDR.min),
    max: vec3At(mdl, HDR.max),
    bbmin: vec3At(mdl, HDR.bbmin),
    bbmax: vec3At(mdl, HDR.bbmax),
  };
}
/** Returns a copy of the file with the header's eye and boxes that are given (see modelBoxes) written. */
export function setModelBoxes(src, boxes) {
  const out = Buffer.from(src);
  for (const key of ["eyes", "min", "max", "bbmin", "bbmax"])
    if (boxes[key] !== undefined)
      writeVec3(out, key === "eyes" ? HDR.eyeposition : HDR[key], threeNumbers(boxes[key], key));
  return out;
}
/** The number of the animation of that name (or the number itself), or -1. */
export const sequenceAt = (mdl, which) =>
  typeof which === "number"
    ? which >= 0 && which < int32(mdl, HDR.numseq)
      ? which
      : -1
    : sequences(mdl).findIndex((s) => s.name.toLowerCase() === String(which).toLowerCase());

/**
 * A channel's values as runs: [how many are written, how many frames they cover], the values; three or more
 * alike are held, not written.
 */
function runsOf(steps) {
  const runs = [];
  for (let i = 0; i < steps.length; ) {
    const written = [steps[i++]];
    let held = 0;
    while (i < steps.length && written.length < MAX_RUN) {
      // how far the value last written repeats from here, within what one run can cover
      let j = i;
      while (
        j < steps.length &&
        steps[j] === written[written.length - 1] &&
        written.length + (j - i) < MAX_RUN
      )
        j++;
      // three or more repeats, or repeats to the very end, are held and close the run
      if (j - i >= 3 || (j > i && j === steps.length)) {
        held = j - i;
        i = j;
        break;
      }
      written.push(steps[i++]);
    }
    const run = Buffer.alloc(RUN.values + written.length * INT16);
    run[RUN.valid] = written.length;
    run[RUN.total] = written.length + held;
    written.forEach((step, k) => run.writeInt16LE(step, RUN.values + k * INT16));
    runs.push(run);
  }
  return Buffer.concat(runs);
}
const TURN = 2 * Math.PI;
const nearTurn = (angle) => angle - TURN * Math.round(angle / TURN);
/** How far a frame's number is from the bone's rest, as it is stored: a turn is taken the short way round. */
const awayFrom = (rest, value, channel) => (isAngle(channel) ? nearTurn(value - rest) : value - rest);
/** The rest value of one channel of a bone as bones() gives it. */
const restOn = (bone, channel) => (isAngle(channel) ? bone.rot[channel - 3] : bone.pos[channel]);
/**
 * An animation's blends ([for each blend, its frames]) as the file keeps them, by the bones' own rest and
 * scale in `mdl`.
 */
function animOf(mdl, blends, name) {
  const all = bones(mdl);
  const count = all.length;
  const anim = animTable(blends.length * count);
  blends.forEach((frames, blend) => {
    for (const frame of frames)
      if (frame.length !== count)
        throw new Error(`${name}: a frame of ${frame.length} bones for a model of ${count}`);
    for (let i = 0; i < count; i++)
      for (const j of CHANNELS) {
        const rest = restOn(all[i], j);
        const scale = all[i].scale[j];
        const steps = frames.map((frame) => {
          if (!scale) return 0;
          const away = awayFrom(rest, frame[i][j], j);
          const step = Math.round(away / scale);
          // a half turn read back a hair past it lands one step over the range; a turn the other way is the same
          // angle (a bicycle's crank at half a turn from rest, read back after another bone widened its scale)
          if (isAngle(j) && (step > STEP_MAX || step < STEP_MIN)) {
            const other = Math.round((away - Math.sign(away) * TURN) / scale);
            if (other <= STEP_MAX && other >= STEP_MIN) return other;
          }
          return step;
        });
        if (steps.every((step) => !step)) continue;
        if (steps.some((step) => step > STEP_MAX || step < STEP_MIN))
          throw new Error(`${name}: ${all[i].name} moves further than its scale holds`);
        if (!anim.put(blend * count + i, j, runsOf(steps)))
          throw new Error(
            `${name}: too long for one animation (its values pass 64 KB): fewer frames, or cut it in two`,
          );
      }
  });
  // the engine reads one value past a frame to blend towards it: four bytes of nothing after the last
  return Buffer.concat([anim.bytes(), Buffer.alloc(4)]);
}
/**
 * How much wider than the swing it has to hold a scale is made when it is widened, and how near counts as
 * held.
 */
const SCALE_ROOM = 1.02;
const SCALE_SLACK = 1.00001;
/**
 * Returns a copy of the file whose bones can hold `blends` (frames a blend): where a bone would move further
 * from its rest than its scale reaches in 16 bits, the scale is made larger and every animation of the file
 * written again by it (a little coarser in that bone, nothing else changed). The file itself when nothing
 * needs it.
 */
function roomFor(src, blends, name) {
  const all = bones(src);
  // `want`: the least scale that holds each bone's widest swing in 16 bits
  const want = all.map(() => [0, 0, 0, 0, 0, 0]);
  for (const frames of blends)
    for (const frame of frames) {
      if (frame.length !== all.length)
        throw new Error(`${name}: a frame of ${frame.length} bones for a model of ${all.length}`);
      frame.forEach((values, i) => {
        for (const j of CHANNELS) {
          const away = awayFrom(restOn(all[i], j), values[j], j);
          want[i][j] = Math.max(want[i][j], away > 0 ? away / STEP_MAX : away / STEP_MIN);
        }
      });
    }
  const wider = all.map((bone, i) =>
    bone.scale.map((scale, j) => (want[i][j] > scale * SCALE_SLACK ? want[i][j] * SCALE_ROOM : scale)),
  );
  if (wider.every((scales, i) => scales.every((scale, j) => scale === all[i].scale[j]))) return src;
  // every animation as numbers, read by the old scales, to be written again by the new
  const seqs = sequences(src);
  const kept = seqs.map((sequence, q) => {
    if (sequence.group)
      throw new Error(`${name}: needs a wider scale, and ${sequence.name} is kept in another file`);
    return Array.from({ length: sequence.blends }, (_, blend) => readSequence(src, q, blend).frames);
  });
  const file = growing(Buffer.from(src));
  const { head, add } = file;
  wider.forEach((scales, i) =>
    scales.forEach((scale, j) => head.writeFloatLE(scale, boneAt(src, i) + BONE.scale + j * FLOAT32)),
  );
  kept.forEach((blendsOfIt, q) =>
    head.writeInt32LE(add(animOf(head, blendsOfIt, seqs[q].name)), seqAt(src, q) + SEQ.animindex),
  );
  return file.whole();
}
/**
 * Returns a copy of the file with one animation played from other frames: { frames (see frameValues) or
 * blends: [frames, ...], fps, loops, activity, actweight, movement, motiontype, bbmin, bbmax }; what is not
 * given stays. Its place in the list stays, and so does everything else it says (its events, and its
 * activity and how far it travels unless told): game code that asks for an animation by its number goes on
 * getting this one.
 * Given `frames`, an animation that had several blends is left with one.
 *   movement   [x, y, z]: how far the model travels in one play of it (linearmovement), the frames staying
 *              in place; the motiontype's LX, LY and LZ are set for the axes it is not zero on and cleared
 *              for the others (see travelBits), unless `motiontype` says the whole of it
 *   activity   and `actweight` (1 unless told when the sequence had none; 0 with activity 0)
 *   bbmin, bbmax  its box. With new frames and no box told, it is measured again about the model's points
 *              through them, as studiomdl does (see boxThrough): the engine culls by it
 */
export function replaceSequence(
  src,
  which,
  {
    frames,
    blends = frames && [frames],
    fps,
    loops,
    activity,
    actweight,
    movement,
    motiontype,
    bbmin,
    bbmax,
  } = {},
) {
  const index = sequenceAt(src, which);
  if (index < 0) throw new Error(`no animation ${which}`);
  let out = Buffer.from(src);
  const seq = seqAt(src, index);
  const name = textAt(src, seq + SEQ.label, SHORT_NAME);
  if (blends) {
    if (int32(src, seq + SEQ.seqgroup)) throw new Error(`${name} is kept in another file`);
    if (!blends[0]?.length || blends.some((f) => f.length !== blends[0].length))
      throw new Error(`${name}: every blend needs the same number of frames, and one at least`);
    const file = growing(Buffer.from(roomFor(out, blends, name)));
    const animAt = file.add(animOf(file.head, blends, name));
    out = file.whole();
    out.writeInt32LE(animAt, seq + SEQ.animindex);
    out.writeInt32LE(blends.length, seq + SEQ.numblends);
    out.writeInt32LE(blends[0].length, seq + SEQ.numframes);
  }
  if (fps !== undefined) out.writeFloatLE(fps, seq + SEQ.fps);
  if (loops !== undefined) {
    const flags = int32(out, seq + SEQ.flags);
    out.writeInt32LE(loops ? flags | STUDIO_LOOPING : flags & ~STUDIO_LOOPING, seq + SEQ.flags);
  }
  if (activity !== undefined) {
    const weight = actweight ?? (activity ? int32(out, seq + SEQ.actweight) || 1 : 0);
    out.writeInt32LE(activity, seq + SEQ.activity);
    out.writeInt32LE(weight, seq + SEQ.actweight);
  } else if (actweight !== undefined) out.writeInt32LE(actweight, seq + SEQ.actweight);
  if (movement !== undefined) {
    writeVec3(out, seq + SEQ.linearmovement, threeNumbers(movement, `${name}: movement`));
    out.writeInt32LE(travelBits(movement, int32(out, seq + SEQ.motiontype)), seq + SEQ.motiontype);
  }
  if (motiontype !== undefined) out.writeInt32LE(motiontype, seq + SEQ.motiontype);
  // the box: told, or measured again when the frames are new (a model of no points keeps the one it had)
  const measured =
    blends && !(bbmin && bbmax) ? boxThrough(boneParents(src), carriedPoints(src), blends) : null;
  const box = { min: bbmin ?? measured?.min, max: bbmax ?? measured?.max };
  if (box.min) writeVec3(out, seq + SEQ.bbmin, threeNumbers(box.min, `${name}: bbmin`));
  if (box.max) writeVec3(out, seq + SEQ.bbmax, threeNumbers(box.max, `${name}: bbmax`));
  return engineLayout(out);
}
/**
 * Returns a copy of the file with one more animation after the ones it has (its number is the old count, so
 * the ones the game knows by number stay where they were): { name, fps, loops, frames, activity, actweight,
 * movement, motiontype, events, bbmin, bbmax } (see replaceSequence for each).
 * The box it is drawn within is measured about the model's points through its frames; with `like` (an
 * animation's number) it is that animation's instead, as it also is for a model of no points (the first's).
 * The table of animations is written again at the end of the file.
 */
export function addSequence(
  src,
  {
    name,
    fps = 30,
    loops = false,
    frames,
    blends,
    activity = 0,
    actweight,
    movement,
    motiontype,
    events: itsEvents,
    bbmin,
    bbmax,
    like,
  },
) {
  const file = growing(Buffer.from(src));
  const count = int32(src, HDR.numseq);
  const oldTable = int32(src, HDR.seqindex);
  // after the table, one frame of every bone at rest: what the new animation is until its frames are written
  const restingAnim = (count + 1) * SEQ.sizeof;
  const table = Buffer.alloc(restingAnim + int32(src, HDR.numbones) * ANIM.sizeof + 4);
  const at = file.add(table);
  const entry = count * SEQ.sizeof;
  if (count) src.copy(table, 0, oldTable, oldTable + count * SEQ.sizeof);
  writeName(table, entry + SEQ.label, name, SHORT_NAME);
  table.writeFloatLE(fps, entry + SEQ.fps);
  table.writeInt32LE(activity, entry + SEQ.activity);
  table.writeInt32LE(actweight ?? (activity ? 1 : 0), entry + SEQ.actweight);
  table.writeInt32LE(1, entry + SEQ.numframes);
  table.writeInt32LE(1, entry + SEQ.numblends);
  table.writeInt32LE(at + restingAnim, entry + SEQ.animindex);
  // bbmin and bbmax of the animation it is like: what it keeps when its own are not measured or told
  const likeIt = count ? oldTable + Math.min(like ?? 0, count - 1) * SEQ.sizeof : -1;
  if (count) src.copy(table, entry + SEQ.bbmin, likeIt + SEQ.bbmin, likeIt + SEQ.bbmin + 2 * VEC3);
  file.head.writeInt32LE(count + 1, HDR.numseq);
  file.head.writeInt32LE(at, HDR.seqindex);
  const copied = count && like !== undefined;
  const out = replaceSequence(file.whole(), count, {
    frames,
    blends,
    loops,
    movement,
    motiontype,
    bbmin: bbmin ?? (copied ? vec3At(src, likeIt + SEQ.bbmin) : undefined),
    bbmax: bbmax ?? (copied ? vec3At(src, likeIt + SEQ.bbmax) : undefined),
  });
  return engineLayout(itsEvents?.length ? setEvents(out, count, itsEvents) : out);
}

/**
 * Frames of an animation by number, from what is written on a command line or in a script: "80-57" (80 down
 * to 57: played backwards), "57-80", "57,58,57", "80-57,57" (a list of either), or a list of numbers. Each
 * must be a frame the animation has (0 to `count` - 1); it throws, saying which, when one is not.
 */
export function frameNumbers(spec, count) {
  const list = [];
  const parts = Array.isArray(spec) ? spec.map(String) : String(spec).split(",");
  for (const part of parts) {
    const range = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!range) throw new Error(`frames: a frame, a range "a-b" or a list of them, not "${part}"`);
    const a = Number(range[1]);
    const b = range[2] === undefined ? a : Number(range[2]);
    for (const n of [a, b])
      if (n >= count) throw new Error(`frames: ${n} is past the last frame, ${count - 1}`);
    const way = b >= a ? 1 : -1;
    for (let n = a; n !== b + way; n += way) list.push(n);
  }
  if (!list.length) throw new Error("frames: none given");
  return list;
}

/**
 * Returns a copy of the file with one more animation, made of frames of one it has: a kneel out of a
 * sit-and-stand, played backwards; a held pose out of one frame and the next. The new animation's number is
 * the old count, as with `addSequence`.
 *   from     the animation the frames are taken from: a name or a number
 *   frames   which, in order: see `frameNumbers` ("80-57", "57,58,57", [57, 58, 57])
 *   name     the new animation's
 *   fps      its rate (unless told, that of `from`); `loops` (false); `activity` (0) and `actweight`
 *   events   true: the events of `from` on the frames taken go with them, each to its frame's first place in
 *            the new animation (unless told, none: a sound timed for the whole motion seldom fits a piece)
 *   movement how far one play of it travels (none unless told: the frames are taken as they stand)
 *   like     as `addSequence`: its box is that animation's (true: `from`'s) instead of being measured
 * Several blends: the first is taken.
 */
export function addSequenceFrom(
  src,
  { from, frames, name, fps, loops = false, activity = 0, actweight, events: carry = false, movement, like },
) {
  if (typeof name !== "string" || !name) throw new Error("addSequenceFrom: name the new animation");
  const source = readSequence(src, from);
  if (!source.frames.length) throw new Error(`addSequenceFrom: ${source.name} has no frames`);
  const numbers = frameNumbers(frames, source.frames.length);
  const taken = numbers.map((n) => source.frames[n].map((six) => [...six]));
  const carried = carry
    ? events(src, source.index).flatMap((event) => {
        const at = numbers.indexOf(event.frame);
        return at < 0 ? [] : [{ ...event, frame: at }];
      })
    : [];
  return addSequence(src, {
    name,
    fps: fps ?? source.fps,
    loops,
    frames: taken,
    activity,
    actweight,
    movement,
    events: carried,
    like: like === true ? source.index : like,
  });
}

// ── what an animation sets off, and where things are fastened ──────────────
/**
 * An animation's events: [{ frame, event (the number the game's code knows: 5004 plays a sound in the
 * client, 5001 a muzzle flash...), options (its text: the sound's file), type }].
 */
export function events(mdl, which) {
  mdl = asBuffer(mdl);
  const index = sequenceAt(mdl, which);
  if (index < 0) throw new Error(`no animation ${which}`);
  const seq = seqAt(mdl, index);
  const table = int32(mdl, seq + SEQ.eventindex);
  return Array.from({ length: int32(mdl, seq + SEQ.numevents) }, (_, i) => {
    const event = table + i * EVENT.sizeof;
    return {
      frame: int32(mdl, event + EVENT.frame),
      event: int32(mdl, event + EVENT.event),
      type: int32(mdl, event + EVENT.type),
      options: textAt(mdl, event + EVENT.options, LONG_NAME),
    };
  });
}
/**
 * Returns a copy of the file with one animation setting off these events and no others: [{ frame, event,
 * options, type }].
 */
export function setEvents(src, which, list) {
  const index = sequenceAt(src, which);
  if (index < 0) throw new Error(`no animation ${which}`);
  const file = growing(Buffer.from(src));
  const seq = seqAt(src, index);
  file.head.writeInt32LE(list.length, seq + SEQ.numevents);
  file.head.writeInt32LE(file.add(eventTable(list)), seq + SEQ.eventindex);
  return engineLayout(file.whole());
}
/**
 * The model's attachments: [{ name, bone (its number), pos [x, y, z] in that bone's space }]: where a muzzle
 * flash, a shell or a held thing goes.
 */
export function attachments(mdl) {
  mdl = asBuffer(mdl);
  const table = int32(mdl, HDR.attachmentindex);
  return Array.from({ length: int32(mdl, HDR.numattachments) }, (_, i) => {
    const attachment = table + i * ATTACHMENT.sizeof;
    return {
      name: textAt(mdl, attachment + ATTACHMENT.name, SHORT_NAME),
      bone: int32(mdl, attachment + ATTACHMENT.bone),
      pos: [0, 1, 2].map((axis) => mdl.readFloatLE(attachment + ATTACHMENT.org + axis * FLOAT32)),
    };
  });
}
/** The hit boxes: [{ bone, group, min, max }], each in its bone's space. */
export function hitboxes(mdl) {
  mdl = asBuffer(mdl);
  const table = int32(mdl, HDR.hitboxindex);
  return Array.from({ length: int32(mdl, HDR.numhitboxes) }, (_, i) => {
    const box = table + i * BBOX.sizeof;
    return {
      bone: int32(mdl, box + BBOX.bone),
      group: int32(mdl, box + BBOX.group),
      min: vec3At(mdl, box + BBOX.bbmin),
      max: vec3At(mdl, box + BBOX.bbmax),
    };
  });
}
/**
 * The bone controllers: [{ bone, type, start, end, rest, index }]: the bones the game's code turns by itself
 * (a head that follows a target, a mouth that opens with a sentence). `type`: which of the bone's six values
 * (MOTION.X to MOTION.ZR, with MOTION.RLOOP for one that wraps round); `start` and `end`: the range the
 * entity's controller value (0 to 255) is spread over, in degrees for an angle and units for a position;
 * `index`: which of the entity's controllers it is (0 to 3; 4 is the mouth).
 */
export function boneControllers(mdl) {
  mdl = asBuffer(mdl);
  const table = int32(mdl, HDR.bonecontrollerindex);
  return Array.from({ length: int32(mdl, HDR.numbonecontrollers) }, (_, i) => {
    const controller = table + i * BONECONTROLLER.sizeof;
    return {
      bone: int32(mdl, controller + BONECONTROLLER.bone),
      type: int32(mdl, controller + BONECONTROLLER.type),
      start: mdl.readFloatLE(controller + BONECONTROLLER.start),
      end: mdl.readFloatLE(controller + BONECONTROLLER.end),
      rest: int32(mdl, controller + BONECONTROLLER.rest),
      index: int32(mdl, controller + BONECONTROLLER.index),
    };
  });
}

// ── what a monster has: hit boxes, attachments, bone controllers, written ──
/** How many of a model's bones a sentence lists. */
const BONES_NAMED = 6;
/**
 * A bone's number from its number or its name, among the bones called `names`. It throws, saying `what`
 * names it, when the model has no such bone.
 */
function boneNumbered(names, which, what) {
  const i = typeof which === "number" ? which : names.indexOf(which);
  if (!Number.isInteger(i) || i < 0 || i >= names.length)
    throw new Error(
      `${what} is on the bone ${JSON.stringify(which)}, and the model has no such bone: it has ${names.length} (${names.slice(0, BONES_NAMED).join(", ")}${names.length > BONES_NAMED ? "..." : ""})`,
    );
  return i;
}
/** A table of hit boxes (mstudiobbox_t), and four bytes of nothing after it. */
function hitboxTable(list, names) {
  const table = Buffer.alloc(list.length * BBOX.sizeof + 4);
  list.forEach((box, i) => {
    const entry = i * BBOX.sizeof;
    const what = `hit box ${i}`;
    table.writeInt32LE(boneNumbered(names, box.bone, what), entry + BBOX.bone);
    table.writeInt32LE(box.group ?? HITGROUP.generic, entry + BBOX.group);
    writeVec3(table, entry + BBOX.bbmin, threeNumbers(box.min, `${what}: min`));
    writeVec3(table, entry + BBOX.bbmax, threeNumbers(box.max, `${what}: max`));
  });
  return table;
}
/**
 * A table of attachments (mstudioattachment_t), and four bytes of nothing after it. Their `type` and their
 * three `vectors` are left at zero, as studiomdl leaves them: the engine reads the bone and the point only.
 */
function attachmentTable(list, names) {
  const table = Buffer.alloc(list.length * ATTACHMENT.sizeof + 4);
  list.forEach((attachment, i) => {
    const entry = i * ATTACHMENT.sizeof;
    const what = `attachment ${i}`;
    writeName(table, entry + ATTACHMENT.name, attachment.name ?? "", SHORT_NAME);
    table.writeInt32LE(boneNumbered(names, attachment.bone, what), entry + ATTACHMENT.bone);
    writeVec3(table, entry + ATTACHMENT.org, threeNumbers(attachment.pos ?? [0, 0, 0], `${what}: pos`));
  });
  return table;
}
/**
 * A table of bone controllers (mstudiobonecontroller_t), and four bytes of nothing after it. Each bone also
 * says, for each of its six values, which controller turns it (mstudiobone_t.bonecontroller, -1: none):
 * those are written into `boneTable` (the bones' entries, one after another), every one first set to none.
 * That a controller's number goes in the slot of its type's axis is from memory of studiomdl's source
 * (WriteBoneInfo), and borne out on hgrunt.mdl: its one controller, type XR on bone 27, is in that bone's
 * fourth slot.
 */
function controllerTable(list, names, boneTable) {
  const table = Buffer.alloc(list.length * BONECONTROLLER.sizeof + 4);
  for (let i = 0; i < names.length; i++)
    for (const j of CHANNELS) boneTable.writeInt32LE(-1, i * BONE.sizeof + BONE.bonecontroller + j * INT32);
  list.forEach((controller, i) => {
    const entry = i * BONECONTROLLER.sizeof;
    const what = `bone controller ${i}`;
    const bone = boneNumbered(names, controller.bone, what);
    const channel = CONTROLLED_BITS.indexOf(controller.type & ~MOTION.RLOOP);
    if (channel < 0)
      throw new Error(
        `${what} has type ${controller.type}: it turns one of a bone's six values, so its type is one of MOTION.X, Y, Z, XR, YR or ZR (1, 2, 4, 8, 16, 32), with MOTION.RLOOP added for one that wraps round`,
      );
    if (![controller.start, controller.end].every(Number.isFinite))
      throw new Error(`${what} needs a start and an end: the range it turns the bone through`);
    table.writeInt32LE(bone, entry + BONECONTROLLER.bone);
    table.writeInt32LE(controller.type, entry + BONECONTROLLER.type);
    table.writeFloatLE(controller.start, entry + BONECONTROLLER.start);
    table.writeFloatLE(controller.end, entry + BONECONTROLLER.end);
    table.writeInt32LE(controller.rest ?? 0, entry + BONECONTROLLER.rest);
    table.writeInt32LE(controller.index ?? 0, entry + BONECONTROLLER.index);
    boneTable.writeInt32LE(i, bone * BONE.sizeof + BONE.bonecontroller + channel * INT32);
  });
  return table;
}
/**
 * Returns a copy of the file with these hit boxes and no others: [{ bone (its number or name), group
 * (HITGROUP; 0 unless told), min, max (in the bone's space) }]. Nothing else changes. It throws on a box
 * whose bone the model has not.
 */
export function setHitboxes(src, list) {
  const file = growing(Buffer.from(src));
  file.head.writeInt32LE(list.length, HDR.numhitboxes);
  file.head.writeInt32LE(file.add(hitboxTable(list, readMdl(src).bones)), HDR.hitboxindex);
  return engineLayout(file.whole());
}
/**
 * Returns a copy of the file with these attachments and no others: [{ name, bone (its number or name), pos
 * [x, y, z] in the bone's space }]. Game code asks for an attachment by its number, so on a model the game
 * already uses keep the ones it has in their order and add after them.
 */
export function setAttachments(src, list) {
  const file = growing(Buffer.from(src));
  file.head.writeInt32LE(list.length, HDR.numattachments);
  file.head.writeInt32LE(file.add(attachmentTable(list, readMdl(src).bones)), HDR.attachmentindex);
  return engineLayout(file.whole());
}
/**
 * Returns a copy of the file with these bone controllers and no others: [{ bone (its number or name), type
 * (MOTION.X ... MOTION.ZR: which of the bone's six values), start, end (degrees for an angle), rest (0),
 * index (which of the entity's controllers, 0 to 3; 4: the mouth) }]. The bones' own note of which
 * controller turns them is rewritten to match; nothing else changes.
 */
export function setBoneControllers(src, list) {
  const file = growing(Buffer.from(src));
  const names = readMdl(src).bones;
  const bonesAt = int32(src, HDR.boneindex);
  const boneTable = file.head.subarray(bonesAt, bonesAt + names.length * BONE.sizeof);
  file.head.writeInt32LE(list.length, HDR.numbonecontrollers);
  file.head.writeInt32LE(file.add(controllerTable(list, names, boneTable)), HDR.bonecontrollerindex);
  return engineLayout(file.whole());
}
/** The least a hit box measures on every axis for autoHitboxes to keep it: studiomdl's own one unit. */
const THINNEST_BOX = 1;
/**
 * The hit boxes studiomdl makes by itself for a model whose QC names none: [{ bone, group, min, max }], one
 * for each bone that carries something, about what it carries, in the bone's own space. `what`: a file, or
 * what writeMdl is given ({ bones, bodyparts }).
 *   groups   { "a bone's name": group } (HITGROUP): that bone's group, and that of the bones under it that
 *            say none (the QC's $hgroup); 0 where nothing says
 *   least    the fewest points a bone carries to get a box (0: studiomdl counts none)
 *   thin     a box no thicker than this on some axis is left out (1)
 * As studiomdl does it (SimplifyModel, "automatically build hit boxes", from memory of its source): a
 * bone's box starts as nothing at the bone's own origin, grows to hold every point the bone carries in any
 * submodel of any bodypart, then the origin of each bone that hangs from it (so a thigh's box reaches the
 * knee); a box under one unit on any axis is dropped; a bone's group is its $hgroup's, else its parent's,
 * else 0. It counts no points, so a bone that carries none still gets a box when the bones under it are spread
 * widely enough (houndeye.mdl's pelvis has one); `least` is this kit's own, for leaving those out. Borne out
 * on Half-Life's own files whose boxes are of studiomdl's making: for headcrab.mdl, houndeye.mdl and
 * bullsquid.mdl this returns the 13, 14 and 39 boxes the files have, each to a hundredth of a unit.
 */
export function autoHitboxes(what, { groups = {}, least = 0, thin = THINNEST_BOX } = {}) {
  const list = Buffer.isBuffer(what) ? bones(what) : what.bones;
  const boxes = list.map(() => ({ min: [0, 0, 0], max: [0, 0, 0], points: 0 }));
  const grow = (box, p) => {
    for (let axis = 0; axis < 3; axis++) {
      box.min[axis] = Math.min(box.min[axis], p[axis]);
      box.max[axis] = Math.max(box.max[axis], p[axis]);
    }
  };
  for (const { verts, vertBones } of carriedPoints(what))
    verts.forEach((p, k) => {
      const box = boxes[vertBones[k]];
      if (!box) return;
      grow(box, p);
      box.points++;
    });
  list.forEach((bone) => {
    if (bone.parent >= 0) grow(boxes[bone.parent], bone.pos ?? [0, 0, 0]);
  });
  for (const name of Object.keys(groups))
    if (!list.some((bone) => bone.name === name))
      throw new Error(
        `autoHitboxes: groups names the bone ${JSON.stringify(name)}, and the model has no such bone`,
      );
  // a parent comes before its children, so its group is known when theirs is asked
  const groupOf = [];
  list.forEach((bone, i) => {
    groupOf[i] = groups[bone.name] ?? (bone.parent >= 0 ? groupOf[bone.parent] : HITGROUP.generic);
  });
  return boxes.flatMap((box, bone) =>
    box.points >= least && box.min.every((v, axis) => v < box.max[axis] - thin)
      ? [{ bone, group: groupOf[bone], min: box.min, max: box.max }]
      : [],
  );
}
/**
 * Every bone's matrix for a list of bones that is not in a file yet ([{ parent, pos, rot }], a parent before
 * its children), as they rest or at `values`.
 */
export function boneMatrices(list, values = list.map(restOfNew)) {
  return chain(
    list.map((_, i) => values[i]),
    (i) => list[i].parent,
  );
}
