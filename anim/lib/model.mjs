// A view model as the judge reads one, whatever game it comes from: its bones, sequences and their events, its
// pose at a frame, its bodyparts, and the vertices and triangles of a submodel, each vertex in its bone's space.
//
//   asModel(buf | model)                          a GoldSrc .mdl's bytes wrapped (the same object for the same bytes)
//   sourceViewModel({ files, anim, meshes })       a Source view model: the skeleton and animations of `anim`
//                                                  (a melee weapon's own .mdl, or a gun's anim_v_*.mdl), drawn with
//                                                  the meshes of `meshes` (the weapon first, then the arms), each
//                                                  vertex joined to `anim`'s bone of the same name
//
// The shape: { kind, name, bones: [{ name, parent }], sequences: [{ name, frames, fps, loops, activity }],
// sequenceAt(name | number), events(seq): [{ frame, event, options }], pose(seq, frame): each bone's 3x4 matrix,
// bodyparts: [{ name, base, models: [{ name, numverts }] }], verts(bodypart, submodel): [{ p, bone }],
// tris(bodypart, submodel): [[{ p, bone } x3]] }. A Source model's corners also have `w`: [[bone, weight]], the skin's
// weights on the animated skeleton's bones (`bone` is the first, whose space `p` is in).
//
// Both games keep a view model in the eye's space: +x forward, +y left, +z up, in the same units.
import { readMdl, readMesh, bones as bonesOf, sequences, sequenceAt, events as eventsOf, poseAt } from "../../src/mdl.mjs";
import { readSourceMdl } from "../../src/source/mdl.mjs";
import { readSourceModel } from "../../src/source/draw.mjs";
import { sourceAnimations, sourcePose, sourceMatrices, addDelta, applySourceIk } from "../../src/source/anim.mjs";

const wrapped = new WeakMap();

/** A GoldSrc .mdl's bytes as a model (a model given is returned as it is). */
export function asModel(buf) {
  if (!Buffer.isBuffer(buf)) return buf;
  if (wrapped.has(buf)) return wrapped.get(buf);
  const info = readMdl(buf);
  const submodel = (b, m) => {
    const model = info.bodyparts[b]?.models[m];
    if (!model) throw new Error(`no submodel ${m} in bodypart ${b}`);
    return model;
  };
  const model = {
    kind: "goldsrc",
    name: info.name,
    buf,
    bones: bonesOf(buf),
    sequences: sequences(buf),
    sequenceAt: (s) => sequenceAt(buf, s),
    events: (i) => eventsOf(buf, i),
    pose: (i, f) => poseAt(buf, i, f),
    bodyparts: info.bodyparts,
    verts(b, m) {
      const seen = new Map();
      for (const mesh of submodel(b, m).meshes)
        for (const tri of readMesh(buf, submodel(b, m), mesh)) for (const v of tri) seen.set(`${v.bone}:${v.p.join(",")}`, { p: v.p, bone: v.bone });
      return [...seen.values()];
    },
    tris(b, m) {
      const tris = [];
      for (const mesh of submodel(b, m).meshes) if (mesh.numtris) for (const t of readMesh(buf, submodel(b, m), mesh)) tris.push(t);
      return tris;
    },
  };
  wrapped.set(buf, model);
  return model;
}

/** A model's bones' matrices at rest, from its bone table (pos and quat). */
function restOf(bytes) {
  const info = readSourceMdl(bytes);
  const boneindex = bytes.readInt32LE(160);
  const quat = (i) => [0, 1, 2, 3].map((k) => bytes.readFloatLE(boneindex + i * 216 + 44 + k * 4));
  return sourceMatrices(bytes, info.bones.map((b, i) => ({ pos: b.pos, quat: quat(i) })));
}

/** A model-space point in a rigid matrix's space. */
function toBone(m, p) {
  const d = [p[0] - m[0][3], p[1] - m[1][3], p[2] - m[2][3]];
  return [0, 1, 2].map((c) => m[0][c] * d[0] + m[1][c] * d[1] + m[2][c] * d[2]);
}

/**
 * A Source view model (Left 4 Dead 2's: the weapon's skeleton and animations, the survivor's arms merged onto
 * them by bone name). `files` is source/draw.mjs's sourceFiles; `anim` the path of the model whose skeleton and
 * animations are played; `meshes` the paths whose triangles are drawn, one bodypart each. A delta animation (a
 * layer) is added onto the first frame of `base` (else the first idle that is not a delta, else animation 0).
 */
export function sourceViewModel({ files, anim, meshes, base, ik = true }) {
  const bytes = files.read(anim);
  if (!bytes) throw new Error(`no ${anim}`);
  const aniPath = anim.replace(/\.mdl$/i, ".ani");
  const ani = files.has(aniPath) ? files.read(aniPath) : undefined;
  const info = readSourceMdl(bytes);
  const bones = info.bones.map((b) => ({ name: b.name, parent: b.parent }));
  const index = new Map(bones.map((b, i) => [b.name.toLowerCase(), i]));
  const anims = sourceAnimations(bytes);
  const baseAnim = base !== undefined ? anims.findIndex((a) => a.name === base) : anims.findIndex((a) => !a.delta && /idle/i.test(a.name));
  const baseAt = baseAnim >= 0 ? baseAnim : 0;
  const posed = new Map();
  const pose = (i, f) => {
    const key = `${i}:${f}`;
    if (!posed.has(key)) {
      let p = sourcePose(bytes, i, f, { ani });
      if (anims[i].delta) p = addDelta(sourcePose(bytes, baseAt, 0, { ani }), p);
      // the hands put where the animation's IK rules hold them, as the engine does every frame
      const m = sourceMatrices(bytes, p);
      posed.set(key, ik ? applySourceIk(bytes, i, f, m, { ani }) : m);
    }
    return posed.get(key);
  };
  // each mesh's triangles, every corner on the animated skeleton's bone of its own bone's name (or of the
  // nearest of its bone's parents the skeleton has), in that bone's space
  const parts = meshes.map((path) => {
    const model = readSourceModel(path, files);
    const own = model.mdl.bones;
    const rest = restOf(files.read(path));
    const onto = own.map((b) => {
      for (let k = own.indexOf(b); k >= 0; k = own[k].parent) if (index.has(own[k].name.toLowerCase())) return index.get(own[k].name.toLowerCase());
      return 0;
    });
    const boneOf = (c) => c.bones[0]?.[0] ?? 0;
    // a motion-blur card: the same mesh again on another bone, drawn stretched (L4D2's v_fireaxe_ref_blur: the axe
    // on weapon_bone and a longer copy on weapon_trigger, stretched further in the swing, its texture smeared). Told
    // by two bones carrying meshes of the same corner count and material that are not the body's; of the two, the
    // one spread wider is the card, left out
    const groups = new Map();
    for (const t of model.triangles) {
      const bone = boneOf(t.corners[0]);
      const g = groups.get(bone) ?? { corners: 0, materials: new Set(), points: [] };
      g.corners += t.corners.length;
      g.materials.add(t.material);
      for (const c of t.corners) g.points.push(c.p);
      groups.set(bone, g);
    }
    const spread = (points) => Math.hypot(...[0, 1, 2].map((i) => Math.max(...points.map((p) => p[i])) - Math.min(...points.map((p) => p[i]))));
    const list = [...groups]
      .filter(([bone]) => !/bip01/i.test(own[bone].name))
      .map(([bone, g]) => ({ bone, key: `${g.corners}:${[...g.materials].sort()}`, spread: spread(g.points) }));
    const blur = new Set();
    for (const a of list)
      for (const b of list) if (a !== b && a.key === b.key && a.spread > b.spread + 1e-6) blur.add(a.bone);
    const tris = model.triangles
      .filter((t) => !t.corners.some((c) => blur.has(boneOf(c))))
      .map((t) => t.corners.map((c) => ({ p: toBone(rest[boneOf(c)], c.p), bone: onto[boneOf(c)], w: c.bones.map(([b, x]) => [onto[b], x]) })));
    return { name: path.replace(/^.*\//, "").replace(/\.mdl$/i, ""), tris, blur: [...blur].map((b) => own[b].name) };
  });
  return {
    kind: "source",
    name: anim,
    blurCards: parts.flatMap((p) => p.blur),
    bones,
    sequences: anims.map((a) => ({ name: a.name.replace(/^@/, ""), frames: a.frames, fps: a.fps, loops: a.looping, activity: "", delta: a.delta })),
    sequenceAt(s) {
      if (typeof s === "number") return s;
      const want = String(s).replace(/^@/, "").toLowerCase();
      return anims.findIndex((a) => a.name.replace(/^@/, "").toLowerCase() === want);
    },
    events: () => [],
    pose,
    bodyparts: parts.map((p) => ({ name: p.name, base: 1, models: [{ name: p.name, numverts: p.tris.length * 3 }] })),
    verts(b, m) {
      if (!parts[b] || m !== 0) throw new Error(`no submodel ${m} in bodypart ${b}`);
      const seen = new Map();
      for (const t of parts[b].tris) for (const v of t) seen.set(`${v.bone}:${v.p.join(",")}`, v);
      return [...seen.values()];
    },
    tris(b, m) {
      if (!parts[b] || m !== 0) throw new Error(`no submodel ${m} in bodypart ${b}`);
      return parts[b].tris;
    },
  };
}
