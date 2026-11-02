// Source's animations (studio models of version 44 to 49) decoded into poses: each bone's place and turn in a
// frame, read as the engine reads them (bone_setup.cpp's CalcBoneQuaternion and CalcBonePosition, studio.cpp's
// mstudioanimdesc_t::pAnim). Read only.
//
//   sourceAnimations(mdl, { ani })      [{ name, fps, frames, delta, looping }]
//   sourcePose(mdl, anim, frame, { ani })   [{ pos: [x, y, z], quat: [x, y, z, w] }] each bone's, in its parent's space
//   sourceMatrices(mdl, pose)           each bone's 3x4 matrix in the model's space, rows [r0 r1 r2 t]
//
// `mdl` is the .mdl's bytes; `ani` the bytes of the .ani beside it (`<name>.ani`), which holds the animations a
// model keeps outside itself (its animation blocks, loaded when played). Frames are whole numbers: no frame is
// blended with the next.
//
// THE DATA. An animation (mstudioanimdesc_t) keeps, for each bone that moves, one mstudioanim_t: its bone, flags,
// and the offset to the next bone's. Its turn is a raw quaternion (48 or 64 bits) or three Euler angles each
// compressed by run length (mstudioanimvalue_t) and scaled by the bone's rotscale; its place raw (three half
// floats) or the same three runs scaled by posscale. A bone with no entry stays at its rest. A long animation is cut
// into sections of `sectionframes` frames, each found on its own, its last frame in a section of its own. A delta
// animation (a layer added to another) holds only the change: nothing is added to the bone's rest.

const INT = (b, at) => b.readInt32LE(at);
// studiohdr_t: the animation blocks (mstudioanimblock_t { datastart, dataend }, the first unused)
const HDR = { numbones: 156, boneindex: 160, numlocalanim: 180, localanimindex: 184, numanimblocks: 352, animblockindex: 356 };
// mstudiobone_t
const BONE = { parent: 4, pos: 32, quat: 44, rot: 60, posscale: 72, rotscale: 84, sizeof: 216 };
// mstudioanimdesc_t
const ANIM = { sznameindex: 4, fps: 8, flags: 12, numframes: 16, animblock: 52, animindex: 56, sectionindex: 80, sectionframes: 84, sizeof: 100 }; // prettier-ignore
const LOOPING = 0x1;
const DELTA = 0x4;
const ALLZEROS = 0x20;
// kept frame by frame (mstudio_frame_anim_t, Left 4 Dead's and Alien Swarm's engine) instead of bone by bone
const FRAMEANIM = 0x40;
// mstudio_frame_anim_t's header, then a flags byte for each bone
const FRAME_HEADER = { constantsoffset: 0, frameoffset: 4, framelength: 8, sizeof: 24 };
const FRAME_RAWPOS = 0x01; // Vector48 in the constants
const FRAME_RAWROT = 0x02; // Quaternion48 in the constants
const FRAME_ANIMPOS = 0x04; // Vector48 in each frame
const FRAME_ANIMROT = 0x08; // Quaternion48 in each frame
const FRAME_FULLANIMPOS = 0x10; // Vector (three floats) in each frame
/** The bone number that ends a bone-by-bone animation holding no bone. */
const NO_BONE = 255;
// mstudioanim_t's flags
const RAWPOS = 0x01;
const RAWROT = 0x02;
const ANIMPOS = 0x04;
const ANIMROT = 0x08;
const RAWROT2 = 0x20;

const vec3 = (b, at) => [0, 1, 2].map((i) => b.readFloatLE(at + i * 4));

/** The bones' rest and their scales. */
function bonesOf(mdl) {
  return Array.from({ length: INT(mdl, HDR.numbones) }, (_, i) => {
    const at = INT(mdl, HDR.boneindex) + i * BONE.sizeof;
    return {
      parent: INT(mdl, at + BONE.parent),
      pos: vec3(mdl, at + BONE.pos),
      quat: [0, 1, 2, 3].map((k) => mdl.readFloatLE(at + BONE.quat + k * 4)),
      rot: vec3(mdl, at + BONE.rot),
      posscale: vec3(mdl, at + BONE.posscale),
      rotscale: vec3(mdl, at + BONE.rotscale),
    };
  });
}

/** Where an animation's table entry is. */
const descAt = (mdl, anim) => INT(mdl, HDR.localanimindex) + anim * ANIM.sizeof;

/** Every animation of the model, by number as its sequences name them. */
export function sourceAnimations(mdl) {
  return Array.from({ length: INT(mdl, HDR.numlocalanim) }, (_, i) => {
    const at = descAt(mdl, i);
    const flags = INT(mdl, at + ANIM.flags);
    const nameAt = at + INT(mdl, at + ANIM.sznameindex);
    return {
      name: mdl.toString("latin1", nameAt, mdl.indexOf(0, nameAt)),
      fps: mdl.readFloatLE(at + ANIM.fps),
      frames: INT(mdl, at + ANIM.numframes),
      delta: Boolean(flags & DELTA),
      looping: Boolean(flags & LOOPING),
    };
  });
}

/**
 * The bytes and offset of the first mstudioanim_t for a frame, and the frame within its section (pAnim):
 * { bytes, at, frame } or null when the animation has none.
 */
function animData(mdl, anim, frame, ani) {
  const at = descAt(mdl, anim);
  const frames = INT(mdl, at + ANIM.numframes);
  const sectionframes = INT(mdl, at + ANIM.sectionframes);
  let block = INT(mdl, at + ANIM.animblock);
  let index = INT(mdl, at + ANIM.animindex);
  if (sectionframes !== 0) {
    let section;
    if (frames > sectionframes && frame === frames - 1) {
      // the last frame of a long animation is kept apart
      section = Math.floor(frames / sectionframes) + 1;
      frame = 0;
    } else {
      section = Math.floor(frame / sectionframes);
      frame -= section * sectionframes;
    }
    const s = at + INT(mdl, at + ANIM.sectionindex) + section * 8;
    block = INT(mdl, s);
    index = INT(mdl, s + 4);
  }
  if (block === -1) return null;
  if (block === 0) return { bytes: mdl, at: at + index, frame };
  if (!ani) throw new Error(`animation ${anim} is kept in the model's .ani (block ${block}): pass { ani }`);
  if (block >= INT(mdl, HDR.numanimblocks)) throw new Error(`animation ${anim}: block ${block} past the model's ${INT(mdl, HDR.numanimblocks)}`);
  const datastart = INT(mdl, INT(mdl, HDR.animblockindex) + block * 8);
  return { bytes: ani, at: datastart + index, frame };
}

/** A run-length compressed value at a frame (ExtractAnimValue): the stored short, unscaled. */
function runValue(b, at, frame) {
  let k = frame;
  for (;;) {
    const valid = b[at];
    const total = b[at + 1];
    if (total === 0) throw new Error("a compressed animation value with a run of 0 frames");
    if (total > k) return b.readInt16LE(at + 2 * (valid > k ? k + 1 : valid));
    k -= total;
    at += 2 * (valid + 1);
  }
}

/** Three values by mstudioanim_valueptr_t at `at`: each axis's offset from it, 0 for none. */
const runValues = (b, at, frame) => [0, 1, 2].map((i) => (b.readInt16LE(at + i * 2) ? runValue(b, at + b.readInt16LE(at + i * 2), frame) : 0)); // prettier-ignore

/** A half float. */
function half(h) {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * frac * 2 ** -24;
  if (exp === 31) return frac ? NaN : sign * Infinity;
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

/** Quaternion48: x and y in 16 bits, z in 15, and w's sign. */
function quat48(b, at) {
  const x = (b.readUInt16LE(at) - 32768) / 32768;
  const y = (b.readUInt16LE(at + 2) - 32768) / 32768;
  const zw = b.readUInt16LE(at + 4);
  const z = ((zw & 0x7fff) - 16384) / 16384;
  const w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
  return [x, y, z, zw & 0x8000 ? -w : w];
}

/** Quaternion64: x, y and z in 21 bits each, and w's sign. */
function quat64(b, at) {
  const v = b.readBigUInt64LE(at);
  const part = (shift) => (Number((v >> BigInt(shift)) & 0x1fffffn) - 1048576) / 1048576.5;
  const x = part(0);
  const y = part(21);
  const z = part(42);
  const w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
  return [x, y, z, v >> 63n ? -w : w];
}

/** Source's AngleQuaternion for a RadianEuler (x, y, z). */
export function eulerQuat([x, y, z]) {
  const [sr, cr] = [Math.sin(x / 2), Math.cos(x / 2)];
  const [sp, cp] = [Math.sin(y / 2), Math.cos(y / 2)];
  const [sy, cy] = [Math.sin(z / 2), Math.cos(z / 2)];
  return [sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy, cr * cp * cy + sr * sp * sy];
}

/** Every bone's place and turn, in its parent's space, at a whole frame of an animation. */
export function sourcePose(mdl, anim, frame, { ani } = {}) {
  const bones = bonesOf(mdl);
  const at = descAt(mdl, anim);
  const flags = INT(mdl, at + ANIM.flags);
  const delta = Boolean(flags & DELTA);
  const frames = INT(mdl, at + ANIM.numframes);
  if (frame < 0 || frame >= frames || frame !== Math.floor(frame)) throw new Error(`frame ${frame}: animation ${anim} has frames 0 to ${frames - 1}`);
  const pose = bones.map((bone) => (delta ? { pos: [0, 0, 0], quat: [0, 0, 0, 1] } : { pos: [...bone.pos], quat: [...bone.quat] }));
  if (flags & ALLZEROS) return pose;
  const found = animData(mdl, anim, frame, ani);
  if (!found) return pose;
  const { bytes: b, frame: local } = found;
  if (flags & FRAMEANIM) return framePose(b, found.at, local, bones, pose);
  let p = found.at;
  for (;;) {
    const bone = b[p];
    const f = b[p + 1];
    const next = b.readInt16LE(p + 2);
    if (bone === NO_BONE) break;
    if (bone >= bones.length) throw new Error(`animation ${anim}: bone ${bone} past the model's ${bones.length}`);
    const rest = bones[bone];
    let q = p + 4;
    if (f & RAWROT2) {
      pose[bone].quat = quat64(b, q);
      q += 8;
    } else if (f & RAWROT) {
      pose[bone].quat = quat48(b, q);
      q += 6;
    } else if (f & ANIMROT) {
      const v = runValues(b, q, local);
      pose[bone].quat = eulerQuat(v.map((value, i) => value * rest.rotscale[i] + (delta ? 0 : rest.rot[i])));
      q += 6;
    }
    if (f & RAWPOS) {
      pose[bone].pos = [0, 2, 4].map((k) => half(b.readUInt16LE(q + k)));
    } else if (f & ANIMPOS) {
      const v = runValues(b, q, local);
      pose[bone].pos = v.map((value, i) => value * rest.posscale[i] + (delta ? 0 : rest.pos[i]));
    }
    if (next === 0) break;
    p += next;
  }
  return pose;
}

/**
 * A frame of an animation kept frame by frame (bone_setup.cpp's STUDIO_FRAMEANIM path): each bone's flags say
 * whether its turn and its place are constant (read once, from the constants) or kept in every frame's row; in
 * each, the turn comes before the place. A bone with neither keeps what `pose` holds (its rest, or none for a delta).
 */
function framePose(b, at, frame, bones, pose) {
  let constants = at + b.readInt32LE(at + FRAME_HEADER.constantsoffset);
  let row = at + b.readInt32LE(at + FRAME_HEADER.frameoffset) + frame * b.readInt32LE(at + FRAME_HEADER.framelength);
  bones.forEach((_, i) => {
    const f = b[at + FRAME_HEADER.sizeof + i];
    if (f & FRAME_ANIMROT) pose[i].quat = quat48(b, row);
    else if (f & FRAME_RAWROT) pose[i].quat = quat48(b, constants);
    if (f & FRAME_RAWROT) constants += 6;
    if (f & FRAME_ANIMROT) row += 6;
    if (f & FRAME_ANIMPOS) pose[i].pos = [0, 2, 4].map((k) => half(b.readUInt16LE(row + k)));
    else if (f & FRAME_FULLANIMPOS) pose[i].pos = vec3(b, row);
    else if (f & FRAME_RAWPOS) pose[i].pos = [0, 2, 4].map((k) => half(b.readUInt16LE(constants + k)));
    if (f & FRAME_RAWPOS) constants += 6;
    if (f & FRAME_ANIMPOS) row += 6;
    if (f & FRAME_FULLANIMPOS) row += 12;
  });
  return pose;
}

/** Quaternions multiplied, a then b. */
const qmul = ([ax, ay, az, aw], [bx, by, bz, bw]) => [
  aw * bx + ax * bw + ay * bz - az * by,
  aw * by - ax * bz + ay * bw + az * bx,
  aw * bz + ax * by - ay * bx + az * bw,
  aw * bw - ax * bx - ay * by - az * bz,
];

/** A delta animation's pose added onto a base pose, as a layer is (bone_setup.cpp's additive blend at weight 1). */
export function addDelta(base, delta) {
  return base.map((b, i) => ({ quat: qmul(b.quat, delta[i].quat), pos: b.pos.map((v, k) => v + delta[i].pos[k]) }));
}

// ── IK: the hands held where the animation means them (bone_setup.cpp's CIKContext) ──────────────────────
//
// An animation may carry IK rules (mstudioikrule_t): each names a chain (mstudioikchain_t: upper arm, forearm,
// hand), a type, the bone its target rides, when it holds (start, peak, tail, end as fractions of the cycle) and,
// frame by frame, where the hand belongs on that bone (a compressed error: three places and three Euler angles,
// run-length coded and scaled). A view model's hands are kept on the weapon this way (IK_SELF on weapon_bone):
// the keys alone may let a hand drift off the handle, and the engine puts it back every frame.

// studiohdr_t's chains; mstudioikchain_t; mstudioiklink_t
const IKCHAINS = { num: 284, index: 288 };
const IKCHAIN = { linktype: 4, numlinks: 8, linkindex: 12, sizeof: 16 };
const IKLINK = { bone: 0, kneeDir: 4, sizeof: 28 };
// mstudioanimdesc_t's rules, in the model or in its animation block
const ANIM_IK = { numikrules: 60, ikruleindex: 64, animblockikruleindex: 68 };
// mstudioikrule_t (152 bytes in Left 4 Dead 2's models, not the 2013 SDK's 156: each rule's compressed error
// begins right after the rules, at 152 for one, 304 for two)
const IKRULE = { type: 4, chain: 8, bone: 12, pos: 32, q: 44, compressedikerrorindex: 60, iStart: 68, start: 76, peak: 80, tail: 84, end: 88, sizeof: 152 }; // prettier-ignore
const IK_SELF = 1;
// mstudiocompressedikerror_t: scale[6], then offset[6] to each value's runs (0: none)
const IKERROR = { scale: 0, offset: 24 };

/** The model's IK chains: [{ links: [bone, bone, bone] }] (upper arm, forearm, hand). */
export function sourceIkChains(mdl) {
  return Array.from({ length: INT(mdl, IKCHAINS.num) }, (_, c) => {
    const at = INT(mdl, IKCHAINS.index) + c * IKCHAIN.sizeof;
    return { links: Array.from({ length: INT(mdl, at + IKCHAIN.numlinks) }, (_, k) => INT(mdl, at + INT(mdl, at + IKCHAIN.linkindex) + k * IKLINK.sizeof)) }; // prettier-ignore
  });
}

/** An animation's IK rules: [{ type, chain, bone, start, peak, tail, end, iStart, bytes, at }]. */
export function sourceIkRules(mdl, anim, { ani } = {}) {
  const at = descAt(mdl, anim);
  const count = INT(mdl, at + ANIM_IK.numikrules);
  if (!count) return [];
  let bytes = mdl;
  let first = at + INT(mdl, at + ANIM_IK.ikruleindex);
  if (!INT(mdl, at + ANIM_IK.ikruleindex)) {
    const block = INT(mdl, at + ANIM.animblock);
    if (!block || !INT(mdl, at + ANIM_IK.animblockikruleindex) || !ani) return [];
    bytes = ani;
    first = INT(mdl, INT(mdl, HDR.animblockindex) + block * 8) + INT(mdl, at + ANIM_IK.animblockikruleindex);
  }
  return Array.from({ length: count }, (_, r) => {
    const ra = first + r * IKRULE.sizeof;
    return {
      type: INT(bytes, ra + IKRULE.type),
      chain: INT(bytes, ra + IKRULE.chain),
      bone: INT(bytes, ra + IKRULE.bone),
      pos: vec3(bytes, ra + IKRULE.pos),
      quat: [0, 1, 2, 3].map((k) => bytes.readFloatLE(ra + IKRULE.q + k * 4)),
      iStart: INT(bytes, ra + IKRULE.iStart),
      start: bytes.readFloatLE(ra + IKRULE.start),
      peak: bytes.readFloatLE(ra + IKRULE.peak),
      tail: bytes.readFloatLE(ra + IKRULE.tail),
      end: bytes.readFloatLE(ra + IKRULE.end),
      error: INT(bytes, ra + IKRULE.compressedikerrorindex) ? ra + INT(bytes, ra + IKRULE.compressedikerrorindex) : 0,
      bytes,
    };
  });
}

/** How much a rule holds at a cycle (Studio_IKRuleWeight): 0 outside it, 1 in its full hold, eased between. */
function ruleWeight(rule, cycle) {
  let v;
  if (cycle < rule.start) return 0;
  if (cycle < rule.peak) v = (cycle - rule.start) / (rule.peak - rule.start);
  else if (cycle < rule.tail) return 1;
  else if (cycle < rule.end) v = 1 - (cycle - rule.tail) / (rule.end - rule.tail);
  else return cycle <= rule.end ? 1 : 0;
  return 3 * v * v - 2 * v * v * v;
}

/** Where a rule puts its hand at a frame, on its bone: { pos, quat } (CalcDecompressedAnimation, unscaled base 0). */
function ruleTarget(rule, frame) {
  if (!rule.error) return { pos: rule.pos, quat: rule.quat };
  const b = rule.bytes;
  const k = Math.max(0, frame - rule.iStart);
  const v = [0, 1, 2, 3, 4, 5].map((i) => {
    const offset = b.readInt16LE(rule.error + IKERROR.offset + i * 2);
    return offset ? runValue(b, rule.error + offset, k) * b.readFloatLE(rule.error + IKERROR.scale + i * 4) : 0;
  });
  return { pos: v.slice(0, 3), quat: eulerQuat(v.slice(3)) };
}

const vsub = (a, b) => a.map((v, i) => v - b[i]);
const vadd = (a, b) => a.map((v, i) => v + b[i]);
const vscale = (a, s) => a.map((v) => v * s);
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const vunit = (a) => vscale(a, 1 / (vlen(a) || 1));
const originOf = (m) => [m[0][3], m[1][3], m[2][3]];
const rot3 = (m) => [m[0].slice(0, 3), m[1].slice(0, 3), m[2].slice(0, 3)];
const mul3 = (a, b) => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
const with3 = (r, p) => r.map((row, i) => [...row, p[i]]);

/** The shortest turn taking direction a to direction b, as a 3x3 matrix. */
function turnBetween(a, b) {
  const [u, v] = [vunit(a), vunit(b)];
  const c = Math.max(-1, Math.min(1, vdot(u, v)));
  let axis = vcross(u, v);
  if (vlen(axis) < 1e-9) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  axis = vunit(axis);
  const [x, y, z] = axis;
  const s = Math.sqrt(1 - c * c);
  const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

/** A rotation matrix's quaternion. */
function quatOf(m) {
  const tr = m[0][0] + m[1][1] + m[2][2];
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    return [(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s, s / 4];
  }
  if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    return [s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] - m[1][2]) / s];
  }
  if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    return [(m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s, (m[0][2] - m[2][0]) / s];
  }
  const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
  return [(m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4, (m[1][0] - m[0][1]) / s];
}

/** Quaternions blended (shortest way), a at 0, b at 1. */
function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb = d < 0 ? b.map((v) => -v) : b;
  d = Math.abs(d);
  if (d > 0.9995) return vunit4(a.map((v, i) => v + (bb[i] - v) * t));
  const th = Math.acos(d);
  const [wa, wb] = [Math.sin((1 - t) * th) / Math.sin(th), Math.sin(t * th) / Math.sin(th)];
  return a.map((v, i) => v * wa + bb[i] * wb);
}
const vunit4 = (q) => q.map((v) => v / (Math.hypot(...q) || 1));

/**
 * A pose's matrices with an animation's IK rules done at a frame, as the engine does them: each IK_SELF rule's
 * target is its bone's matrix times the rule's place for the frame; the chain's upper arm and forearm turn so the
 * hand reaches it (the elbow kept on the side it bends to), the hand takes the target's turn, by the rule's weight,
 * and every bone below them follows. Other rule types (the ground, the world, attachments) are left out.
 */
export function applySourceIk(mdl, anim, frame, matrices, { ani } = {}) {
  const rules = sourceIkRules(mdl, anim, { ani }).filter((r) => r.type === IK_SELF);
  if (!rules.length) return matrices;
  const bones = bonesOf(mdl);
  const chains = sourceIkChains(mdl);
  const frames = INT(mdl, descAt(mdl, anim) + ANIM.numframes);
  const cycle = frames > 1 ? frame / (frames - 1) : 0;
  let M = matrices;
  for (const rule of rules) {
    const chain = chains[rule.chain];
    if (!chain || chain.links.length !== 3 || rule.bone < 0) continue;
    const weight = ruleWeight(rule, cycle);
    if (weight <= 0) continue;
    const [ua, fa, hand] = chain.links;
    const t = ruleTarget(rule, frame);
    const target = mul34(M[rule.bone], matrixOf(vunit4(t.quat), t.pos));
    const A = originOf(M[ua]);
    const B = originOf(M[fa]);
    const C = originOf(M[hand]);
    const T = vadd(C, vscale(vsub(originOf(target), C), weight));
    const l1 = vlen(vsub(B, A));
    const l2 = vlen(vsub(C, B));
    const toT = vsub(T, A);
    const d = Math.max(Math.abs(l1 - l2) + 1e-4, Math.min(vlen(toT), (l1 + l2) * 0.9999));
    const dir = vunit(toT);
    // the elbow stays in the plane of the shoulder, the target and where it is now
    let pole = vsub(vsub(B, A), vscale(dir, vdot(vsub(B, A), dir)));
    if (vlen(pole) < 1e-6) pole = vcross(dir, [0, 0, 1]);
    pole = vunit(pole);
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const B2 = vadd(vadd(A, vscale(dir, along)), vscale(pole, Math.sqrt(Math.max(0, l1 * l1 - along * along))));
    const T2 = vadd(A, vscale(dir, d));
    const old = M;
    const next = M.map((m) => m.map((r) => [...r]));
    const r1 = turnBetween(vsub(B, A), vsub(B2, A));
    next[ua] = with3(mul3(r1, rot3(old[ua])), A);
    const faRot = mul3(r1, rot3(old[fa]));
    // where the hand is once the upper arm has turned: the forearm turned with it
    const handNow = vadd(B2, [0, 1, 2].map((i) => vdot(r1[i], vsub(C, B))));
    const r2 = turnBetween(vsub(handNow, B2), vsub(T2, B2));
    next[fa] = with3(mul3(r2, faRot), B2);
    const handRot = rot3(mul34(next[fa], mul34(invert34(old[fa]), old[hand])));
    const q = slerp(quatOf(handRot), quatOf(rot3(target)), weight);
    next[hand] = matrixOf(q, T2);
    // everything below the chain follows its parent as it hung from it before
    const moved = new Set([ua, fa, hand]);
    bones.forEach((bone, i) => {
      if (moved.has(i) || bone.parent < 0) return;
      if (next[bone.parent] !== old[bone.parent] && !arraysEqual(next[bone.parent], old[bone.parent])) {
        next[i] = mul34(next[bone.parent], mul34(invert34(old[bone.parent]), old[i]));
      }
    });
    M = next;
  }
  return M;
}

const arraysEqual = (a, b) => a.every((r, i) => r.every((v, j) => v === b[i][j]));

/** A rigid 3x4 matrix's inverse. */
function invert34(m) {
  const r = [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]];
  const t = originOf(m);
  return r.map((row) => [...row, -(row[0] * t[0] + row[1] * t[1] + row[2] * t[2])]);
}

/** A quaternion and a place as a 3x4 matrix. */
function matrixOf([x, y, z, w], [tx, ty, tz]) {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), tx],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), ty],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y), tz],
  ];
}

const mul34 = (a, b) => a.map((r) => [0, 1, 2, 3].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j] + (j === 3 ? r[3] : 0)));

/** Each bone's matrix in the model's space, from a pose (parents come before their children in Source's table). */
export function sourceMatrices(mdl, pose) {
  const bones = bonesOf(mdl);
  const out = [];
  bones.forEach((bone, i) => {
    const local = matrixOf(pose[i].quat, pose[i].pos);
    out[i] = bone.parent >= 0 ? mul34(out[bone.parent], local) : local;
  });
  return out;
}
