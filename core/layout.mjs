// The layout a dedicated server's engine needs of a studio model (HLDS and ReHLDS, Mod_LoadStudioModel): it
// copies the file up to texturedataindex as it is, then reads the textures one after another from there, in
// the table's order, and takes the table's place (textureindex) to be inside what it copied. The writer here
// adds textures and the table at the file's end, after the first textures: the table is then read from memory
// never written, which is zero on the first map and whatever was there on the next: the server dies on a
// change of level. Xash and the game's own client draw such a file without complaint, so nothing shows until
// a real server changes map.
// engineLayout moves every texture to the end, in the table's order, and closes the gaps. Pass a model
// through it last, before it is written; check() refuses one that was not.

// ── the format ─────────────────────────────────────────────────────────────
// The fields of the engine's structs (studio.h) that are read here: where each is, in bytes from its struct's
// start, and `sizeof`, how long the struct is. A `...index` field is a place in the file, counted from its
// start; those are what has to follow the bytes they point at when the bytes move.

// studiohdr_t
const HDR = {
  length: 72,
  boneindex: 144,
  bonecontrollerindex: 152,
  hitboxindex: 160,
  numseq: 164,
  seqindex: 168,
  seqgroupindex: 176,
  numtextures: 180,
  textureindex: 184,
  texturedataindex: 188,
  skinindex: 200,
  numbodyparts: 204,
  bodypartindex: 208,
  attachmentindex: 216,
  soundindex: 224,
  soundgroupindex: 232,
  transitionindex: 240,
};
/** Every `...index` of the header but texturedataindex, which is worked out again from the textures. */
const HEADER_INDEXES = [
  HDR.boneindex,
  HDR.bonecontrollerindex,
  HDR.hitboxindex,
  HDR.seqindex,
  HDR.seqgroupindex,
  HDR.textureindex,
  HDR.skinindex,
  HDR.bodypartindex,
  HDR.attachmentindex,
  HDR.soundindex,
  HDR.soundgroupindex,
  HDR.transitionindex,
];
// mstudiotexture_t: at `index`, width x height palette indices and then the palette
const TEXTURE = { width: 68, height: 72, index: 76, sizeof: 80 };
/** A texture's palette: 256 colours of three bytes. */
const PALETTE = 256 * 3;
// mstudioseqdesc_t (an animation)
const SEQ = {
  eventindex: 52,
  pivotindex: 64,
  automoveposindex: 88,
  automoveangleindex: 92,
  animindex: 124,
  sizeof: 176,
};
const SEQ_INDEXES = [
  SEQ.eventindex,
  SEQ.pivotindex,
  SEQ.automoveposindex,
  SEQ.automoveangleindex,
  SEQ.animindex,
];
// mstudiobodyparts_t
const BODYPART = { nummodels: 64, modelindex: 72, sizeof: 76 };
// mstudiomodel_t (a submodel)
const MODEL = {
  nummesh: 72,
  meshindex: 76,
  vertinfoindex: 84,
  vertindex: 88,
  norminfoindex: 96,
  normindex: 100,
  groupindex: 108,
  sizeof: 112,
};
const MODEL_INDEXES = [
  MODEL.meshindex,
  MODEL.vertinfoindex,
  MODEL.vertindex,
  MODEL.norminfoindex,
  MODEL.normindex,
  MODEL.groupindex,
];
// mstudiomesh_t
const MESH = { triindex: 4, normindex: 16, sizeof: 20 };

/**
 * The file's textures: where each one's table entry is (`at`), where its bytes are (`index`) and how many.
 */
const textures = (mdl) =>
  Array.from({ length: mdl.readInt32LE(HDR.numtextures) }, (_, i) => {
    const at = mdl.readInt32LE(HDR.textureindex) + i * TEXTURE.sizeof;
    return {
      at,
      index: mdl.readInt32LE(at + TEXTURE.index),
      size: mdl.readInt32LE(at + TEXTURE.width) * mdl.readInt32LE(at + TEXTURE.height) + PALETTE,
    };
  });

/** Whether the texture table comes before the textures, and they follow one another in its order. */
export function isEngineLayout(mdl) {
  // the textures are in another file
  if (!mdl.readInt32LE(HDR.textureindex)) return true;
  let next = mdl.readInt32LE(HDR.texturedataindex);
  const tableEnd = mdl.readInt32LE(HDR.textureindex) + mdl.readInt32LE(HDR.numtextures) * TEXTURE.sizeof;
  if (tableEnd > next) return false;
  for (const texture of textures(mdl)) {
    if (texture.index !== next) return false;
    next += texture.size;
  }
  // and nothing after them: what follows the textures is not where the engine looks for it
  return next === mdl.length;
}

/**
 * The stretches of the file that textures take (`start` to `end`), merged where they touch, in the file's
 * order. `cut` is how much of each is taken out: a multiple of four, so what follows stays aligned.
 */
function textureSpans(list) {
  const spans = [];
  for (const texture of [...list].sort((a, b) => a.index - b.index)) {
    const last = spans[spans.length - 1];
    if (last && texture.index <= last.end) last.end = Math.max(last.end, texture.index + texture.size);
    else spans.push({ start: texture.index, end: texture.index + texture.size });
  }
  for (const span of spans) span.cut = (span.end - span.start) & ~3;
  return spans;
}

/**
 * The same model with its textures moved to the end in the table's order. Returns src itself when it is
 * already so.
 */
export function engineLayout(src) {
  if (isEngineLayout(src)) return src;
  const list = textures(src);
  // the textures' bytes, merged where they touch; each gap is closed by a multiple of four so what follows
  // stays aligned
  const spans = textureSpans(list);
  // where a place in the old file is in the new one: nearer the start by every span cut before it
  const moved = (place) => {
    let cut = 0;
    for (const span of spans) {
      if (place >= span.end) cut += span.cut;
      else if (place > span.start) throw new Error(`layout: ${place} points into a texture`);
    }
    return place - cut;
  };

  // everything but the textures, then the textures on a multiple of four
  const kept = [];
  let from = 0;
  for (const span of spans) {
    kept.push(src.subarray(from, span.start));
    from = span.start + span.cut;
  }
  kept.push(src.subarray(from));
  let body = Buffer.concat(kept);
  if (body.length & 3) body = Buffer.concat([body, Buffer.alloc(4 - (body.length & 3))]);
  const out = Buffer.concat([
    body,
    ...list.map((texture) => src.subarray(texture.index, texture.index + texture.size)),
  ]);

  // an `...index` field of the old file (`field`: where it is), written where it now is with what it now
  // points at
  const fix = (field) => {
    const pointsAt = src.readInt32LE(field);
    if (pointsAt) out.writeInt32LE(moved(pointsAt), moved(field));
  };
  for (const index of HEADER_INDEXES) fix(index);
  for (let i = 0; i < src.readInt32LE(HDR.numseq); i++) {
    const seq = src.readInt32LE(HDR.seqindex) + i * SEQ.sizeof;
    for (const index of SEQ_INDEXES) fix(seq + index);
  }
  for (let i = 0; i < src.readInt32LE(HDR.numbodyparts); i++) {
    const bodypart = src.readInt32LE(HDR.bodypartindex) + i * BODYPART.sizeof;
    fix(bodypart + BODYPART.modelindex);
    for (let j = 0; j < src.readInt32LE(bodypart + BODYPART.nummodels); j++) {
      const model = src.readInt32LE(bodypart + BODYPART.modelindex) + j * MODEL.sizeof;
      for (const index of MODEL_INDEXES) fix(model + index);
      for (let k = 0; k < src.readInt32LE(model + MODEL.nummesh); k++) {
        const mesh = src.readInt32LE(model + MODEL.meshindex) + k * MESH.sizeof;
        fix(mesh + MESH.triindex);
        fix(mesh + MESH.normindex);
      }
    }
  }
  // the textures themselves, one after another from the end of the rest
  let next = body.length;
  out.writeInt32LE(next, HDR.texturedataindex);
  for (const texture of list) {
    out.writeInt32LE(next, moved(texture.at) + TEXTURE.index);
    next += texture.size;
  }
  out.writeInt32LE(out.length, HDR.length);
  if (!isEngineLayout(out)) throw new Error("layout: the result is not laid out as the engine needs");
  return out;
}
