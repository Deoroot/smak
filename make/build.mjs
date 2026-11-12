// The two ways a new shape gets into the game: a whole model written from triangles (buildMdl: a prop, or a
// monster with its hit boxes, attachments and the travel of its walk), and a new piece put in the place of
// one that an existing model already shows (swapMesh), which keeps that model's bones, animations, events
// and attachments, so the game goes on using it as it did.
//
// A piece is what the workshop and the kits make: { tris, image }. A triangle is three corners
// { p: [x, y, z], uv: [u, v] (0..1, from the picture's top left) } and, where the piece hangs from more than
// one bone, `bone`.
import { writeMdl, readMdl, replaceMesh, emptyMesh, boneMatrices, mul34, inverse34 } from "../core/mdl.mjs";
import { meshOf } from "./mesh.mjs";
import { HANDS, measure, frameOf, bestTurn } from "./fit.mjs";
import { into, out, box, uniq } from "../core/vec.mjs";

/**
 * A whole model from triangles.
 *   name       what the file calls itself ("mygun.mdl")
 *   bones      [{ name, parent (-1 for a root; a parent comes before its children), pos, rot }]; one bone,
 *              "root", unless told
 *   bodyparts  [{ name, models: [{ name, meshes: [{ tris, texture }] }] }]
 *              tris: corners { p (where it is in the model, the bones at rest), uv, bone (a bone's name or
 *              number; the first unless told) }
 *              texture: { name, width, height, pixels, palette, flags } (see image.mjs: indexed, masked,
 *              textureFrom); meshes that give a texture of the same name share it. `flags` are studio.h's
 *              STUDIO_NF_ bits, added together (`TEXTURE` in render.mjs names the ones the kit draws):
 *                1  flat shaded: one light for each face, no smoothing
 *                2  chrome: the picture taken from the way the surface faces the eye (older GoldSrc draws it
 *                   right only at 64x64)
 *                4  full bright: drawn unlit, at the picture's own colours (a lantern's panes, eyes that glow).
 *                   Xash's gl_studio.c does so; Steam's GoldSrc is closed and is not known to: try it there
 *                8  no mipmaps; 16 alpha (Xash: a picture's own see-through); neither is drawn by the kit
 *                32 additive: added to what is behind it, a glow that hides nothing
 *                64 masked: palette index 255 is a hole (`masked` makes such a texture)
 *   sequences  [{ name, fps, loops, frames: [for each frame, for each bone, [x, y, z, about x, about y,
 *              about z]] }]; one, "idle", holding the bones at rest, unless told. Each may also say
 *              activity, actweight, movement [x, y, z] (how far the model travels in one play of it, the
 *              frames staying in place), events, blendFrames (a blend's frames after the first, aimed down
 *              then up) with blendtype, blendstart and blendend, and bbmin and bbmax (measured unless told):
 *              see writeMdl
 *   smooth     faces meeting at less than this many degrees share a normal (40)
 *   ownNormals true: a corner that carries `n` (a normal of its own, in the model's space like `p`) keeps
 *              it, in place of the one worked out from the faces: see `meshOf` (false: `n` is not read)
 * With no more than that it has no hit boxes or attachments: enough for a thing that is carried, worn,
 * dropped or stood somewhere. For a thing that lives (a monster), as writeMdl takes them:
 *   hitboxes   [{ bone (name or number), group, min, max (in the bone's space) }], or "auto" for the boxes
 *              studiomdl would make, or autoHitboxes' options ({ groups: { "head": HITGROUP.head }, ... })
 *   attachments  [{ name, bone, pos (in the bone's space) }]
 *   controllers  [{ bone, type, start, end, rest, index }]
 *   eyes       [x, y, z], where it sees from; and min, max, bbmin, bbmax, the header's boxes
 *   skins      more skin families after the first (the one the meshes wear): [{ [texture name]: texture }],
 *              each family the textures it changes, by the name of the one each takes the place of; one it does
 *              not name it wears as the first does. A replacement must be of the same size as the one it stands
 *              for (the corners are in its pixels). A script shows family n with the entity's skin n.
 * A weapon's first-person model is still better begun from the one the game has, with swapMesh: the game's
 * code knows its animations and attachments by number.
 */
export function buildMdl({
  name,
  bones = [{ name: "root", parent: -1 }],
  bodyparts,
  sequences,
  smooth = 40,
  ownNormals = false,
  hitboxes,
  attachments,
  controllers,
  eyes,
  min,
  max,
  bbmin,
  bbmax,
  skins,
}) {
  // each bone's matrix at rest, and its inverse: from the model's space into the bone's
  const rest = boneMatrices(bones);
  const intoBone = rest.map(inverse34);
  const textures = [];
  const boneNumber = (which) => {
    const i =
      typeof which === "number" ? which : which === undefined ? 0 : bones.findIndex((b) => b.name === which);
    if (!bones[i]) throw new Error(`${name}: no bone ${which}`);
    return i;
  };
  // the number of a texture in the model's list, which it joins when none there has its name
  const skinOf = (texture) => {
    let i = textures.findIndex((t) => t.name === texture.name);
    if (i < 0) i = textures.push(texture) - 1;
    return i;
  };
  const cornerOnBone = (corner) => {
    const bone = boneNumber(corner.bone);
    return {
      p: corner.p,
      uv: corner.uv,
      bone,
      to: intoBone[bone],
      group: corner.group,
      smooth: corner.smooth,
      n: ownNormals ? corner.n : undefined,
    };
  };
  const parts = bodyparts.map((bodypart) => ({
    name: bodypart.name,
    models: bodypart.models.map((model) => {
      // a submodel's meshes share one list of points: each mesh's are numbered on from the ones before
      const verts = [];
      const vertBones = [];
      const meshes = [];
      for (const given of model.meshes) {
        const mesh = meshOf(
          null,
          given.tris.map((tri) => tri.map(cornerOnBone)),
          given.texture,
          0,
          smooth,
        );
        const firstVert = verts.length;
        verts.push(...mesh.verts);
        vertBones.push(...mesh.vertBones);
        meshes.push({
          skin: skinOf(given.texture),
          norms: mesh.norms,
          normBones: mesh.normBones,
          tris: mesh.tris.map((tri) => tri.map(([vert, norm, s, t]) => [firstVert + vert, norm, s, t])),
        });
      }
      return { name: model.name, verts, vertBones, meshes };
    }),
  }));
  const still = bones.map((bone) => [...(bone.pos ?? [0, 0, 0]), ...(bone.rot ?? [0, 0, 0])]);
  // the skin families: the first is every texture as the meshes wear it; the others put theirs in its place
  let families = null;
  if (skins?.length) {
    const worn = textures.slice();
    families = [worn.map((_, i) => i)];
    for (const family of skins) {
      for (const named of Object.keys(family))
        if (!worn.some((t) => t.name === named)) throw new Error(`${name}: a skin changes ${named}, a texture no mesh wears`);
      families.push(
        worn.map((texture, i) => {
          const other = family[texture.name];
          if (!other) return i;
          if (other.width !== texture.width || other.height !== texture.height)
            throw new Error(`${name}: ${other.name} is ${other.width}x${other.height}, ${texture.name} ${texture.width}x${texture.height}: a skin's texture is of the size of the one it stands for`);
          const known = textures.findIndex((t) => t.name === other.name);
          return known >= 0 ? known : textures.push(other) - 1;
        }),
      );
    }
  }
  return writeMdl({
    name,
    bones,
    sequences: sequences ?? [{ name: "idle", fps: 10, loops: true, frames: [still] }],
    textures,
    skins: families,
    bodyparts: parts,
    hitboxes,
    attachments,
    controllers,
    eyes,
    min,
    max,
    bbmin,
    bbmax,
  });
}

/**
 * A fit that leaves the piece the size it was drawn at: the fit's scaling undone about the piece's lowest-x
 * end (the middle of that end of its box), so that end stays where the fit put it.
 */
export function atOwnSize(fit, tris) {
  const b = box(uniq(tris));
  const hold = fit.at([b.mn[0], (b.mn[1] + b.mx[1]) / 2, (b.mn[2] + b.mx[2]) / 2]);
  const { at, k } = fit;
  return { ...fit, k: 1, at: (p) => at(p).map((v, a) => hold[a] + (v - hold[a]) / k) };
}
/**
 * How much more a step along a piece's length counts than one across it, when its nearest corner is looked
 * for.
 */
const ALONG_WEIGHT = 3;
/** The bone of the corner (of `corners`: { p, bone }) nearest a point, or `otherwise` when there are none. */
export function boneNearest(corners, point, otherwise) {
  let bone = otherwise;
  let least = Infinity;
  for (const corner of corners) {
    const distance =
      ALONG_WEIGHT * Math.abs(corner.p[0] - point[0]) +
      Math.abs(corner.p[1] - point[1]) +
      Math.abs(corner.p[2] - point[2]);
    if (distance < least) {
      least = distance;
      bone = corner.bone;
    }
  }
  return bone;
}

/**
 * Returns a copy of a model with a new piece where one of its submodels shows an old one.
 *   body     the number the game gives the model to show that submodel
 *   bodypart the bodypart that holds it (0 unless told: a launcher's rocket and its tube may be apart)
 *   pick     (mesh) -> true for the meshes that are the old piece (default: all but the hands' and arms',
 *            told by their texture's name)
 *   piece    { tris, haft, rig, bones } as the kits make it
 *   texture  the piece's picture as a texture (indexed(piece.image, "name.bmp"))
 *   place    "fit" (default): the piece is drawn in its own axes, at any size (+x its length, +y its width,
 *              +z its thickness), and is laid over the old one: same length, same place, and of the four ways
 *              of turning it the one whose outline follows the old one's best
 *            "bone": its points are already where they must be, in the space of the bone that carries the old
 *              piece
 *   turn     with "fit": the one of the four turns to take ("as drawn", "x", "y", "z") where the outline
 *            cannot tell them apart (a box, a can): unless told, the one whose outline follows best
 *   size     "old" (default): the piece is stretched to the old one's length, whatever size it was drawn at
 *            "own": it was drawn in the game's units and keeps its size; the end it starts at (its lowest x:
 *              the grip, the butt) stays where the old one's was, so the hand still holds it
 * The first of the old meshes takes the new piece; the others are left without triangles. A corner goes on
 * the bone that carried the old piece, unless the piece says otherwise: `rig: "nearest"` gives each corner
 * the bone of the old piece's nearest corner (what bent goes on bending), and `bones: [, "name", ...]` sends
 * the corners of `part` n to that bone.
 * Returns { mdl, report }: `report.left` is what is left between the two outlines, in units (small is good).
 */
export function swapMesh(
  src,
  {
    body = 0,
    bodypart = 0,
    pick = (mesh) => !HANDS.test(mesh.texture.name),
    piece,
    texture,
    place = "fit",
    size = "old",
    turn = null,
    name = "",
  },
) {
  // `bone`: the one that carries the old piece; `original`: the old piece's triangles in that bone's space
  const { info, j: modelNumber, model, meshes, rest, bone, original } = measure(src, body, pick, name, bodypart);

  // the fit: from the piece's space to the old piece's own axes (`frame`), or none when placed by bone
  const laid = place === "fit";
  const frame = laid ? frameOf(original) : null;
  const inAxes = laid
    ? original.map((tri) => tri.map((c) => ({ p: into(frame, c.p), mesh: c.mesh, bone: c.bone })))
    : original;
  let fit = laid
    ? bestTurn(piece.tris, inAxes, piece.haft, turn)
    : { k: 1, name: "as given", left: 0, at: (p) => p };
  if (laid && size === "own") fit = atOwnSize(fit, piece.tris);

  // the bone of each corner: the piece's `bones` by the corner's `part` (part 0 is the carrying bone), or
  // with `rig: "nearest"` the bone of the old piece's nearest corner
  const partBones = (piece.bones ?? []).map((boneName, i) => (i ? info.bones.indexOf(boneName) : bone));
  const theirCorners = piece.rig === "nearest" ? inAxes.flat() : null;
  const tris = piece.tris.map((tri) =>
    tri.map((corner) => {
      const fitted = fit.at(corner.p);
      const p = laid ? out(frame, fitted) : fitted;
      const itsBone = theirCorners ? boneNearest(theirCorners, fitted, bone) : (partBones[corner.part] ?? -1);
      // `p` is in the carrying bone's space: a corner on another bone is told how to get from there to its
      // own
      return itsBone >= 0 && itsBone !== bone
        ? {
            p,
            uv: corner.uv,
            bone: itsBone,
            to: mul34(inverse34(rest[itsBone]), rest[bone]),
            group: corner.group,
            smooth: corner.smooth,
          }
        : { p, uv: corner.uv, group: corner.group, smooth: corner.smooth };
    }),
  );

  const mesh = meshOf(original, tris, texture, bone);
  const first = { bodypart, model: modelNumber, mesh: meshes[0].k };
  let mdl = replaceMesh(src, first, mesh, texture);
  for (const { k } of meshes.slice(1)) mdl = emptyMesh(mdl, { bodypart, model: modelNumber, mesh: k });

  const newBox = box(uniq(tris));
  const oldBox = box(uniq(original));
  return {
    mdl,
    report: {
      model: model.name,
      bone: info.bones[bone],
      bones: [...new Set(mesh.vertBones)].map((b) => info.bones[b]),
      was: original.length,
      now: tris.length,
      verts: mesh.verts.length,
      scale: fit.k,
      turn: fit.name,
      left: fit.left,
      boxOff: Math.max(
        ...[0, 1, 2].flatMap((a) => [
          Math.abs(newBox.mn[a] - oldBox.mn[a]),
          Math.abs(newBox.mx[a] - oldBox.mx[a]),
        ]),
      ),
      textures: readMdl(mdl).textures.length,
    },
  };
}
