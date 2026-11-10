// Whole bodies moved, copied and added: meshes grafted from one model onto another on the same skeleton, a
// body copied under a new texture, several models drawn as one, a body put in from triangles, and the measure
// of how far a body's layout on its picture has moved from the one it was painted for.
import {
  readMdl,
  readMesh,
  textureOf,
  replaceTexture,
  replaceMesh,
  addMesh,
  addModel,
  addBodypart,
  clearModel,
  bones,
  boneParents,
  restPose,
  bodyOf,
  apply34,
  mul34,
  inverse34,
} from "../core/mdl.mjs";
import { indexed } from "../core/image.mjs";
import { posed } from "./render.mjs";
import { dot } from "../core/vec.mjs";
import { meshOf } from "./mesh.mjs";
import {
  FLAT_ON_PICTURE,
  pictureArea,
  weightOfB,
  weightOfC,
  unitsAPixel,
  layoutKey,
} from "./place-shared.mjs";

/** `layoutMoved` warns when more than this share of a body's pixels colour another place than they did. */
const MOVED_WARNING = 0.02;
/** A texture's name is kept in 64 bytes, the last a zero. */
const NAME_MOST = 63;
// Where a studio model's header and a bodypart's record keep what `together` rewrites (bytes from their
// start), and the size of one submodel's record.
const HEADER_BODYPARTS = 204;
const HEADER_BODYPARTS_AT = 208;
const BODYPART_MODELS = 64;
const BODYPART_BASE = 68;
const BODYPART_MODELS_AT = 72;
const MODEL_BYTES = 112;

/** What a caller gives for a texture, as a texture: the name of one in the file, a texture, or an image. */
const textureGiven = (src, texture) =>
  typeof texture === "string"
    ? textureOf(src, texture)
    : texture.pixels
      ? texture
      : indexed(texture, texture.name);

/** Two textures show the same picture. */
const alike = (a, b) =>
  a.width === b.width &&
  a.height === b.height &&
  Buffer.from(a.pixels).equals(Buffer.from(b.pixels)) &&
  Buffer.from(a.palette).equals(Buffer.from(b.palette));

/**
 * The points and normals of a mesh being put together, each pair of bone and value stored once.
 * `vert(p, bone)` and `norm(n, bone)` give the number a corner refers to it by.
 */
function cornerStore() {
  const verts = [];
  const vertBones = [];
  const norms = [];
  const normBones = [];
  const vertAt = new Map();
  const normAt = new Map();
  const once = (list, boneOf, at, value, bone) => {
    const key = bone + ":" + value.join();
    if (!at.has(key)) {
      at.set(key, list.length);
      list.push(value);
      boneOf.push(bone);
    }
    return at.get(key);
  };
  return {
    verts,
    vertBones,
    norms,
    normBones,
    vert: (p, bone) => once(verts, vertBones, vertAt, p, bone),
    norm: (n, bone) => once(norms, normBones, normAt, n, bone),
  };
}

/**
 * Meshes of one model added to another that hangs from the same skeleton: a head, a pack, a holster. Every
 * point stays where it is in the space of its own bone, and the bone is looked up in the target **by name**,
 * so the two files may keep their bones in another order. The meshes' textures come with them.
 *   pick(mesh, model, bodypart)   which meshes of `from` to take (mesh.texture.name, mesh.numtris,
 *                                 model.name)
 *   where                         the submodel of `to` that receives them: { bodypart, model }
 *   move(p, boneName)             a nudge to a point in its bone's space, when the two bodies differ a little
 * Throws when `from` uses a bone `to` has no bone of that name for. Mind the limit of points in the receiving
 * submodel.
 *   { missing: "ancestor" }       instead of throwing: such corners (a jaw, a hat's tassel) hang on the
 *                                 nearest bone up their own skeleton that the target has, where they stand
 *                                 when `from` is at rest; `move` is then given the point in that bone's
 *                                 space, with the name of the bone it came from
 */
export function graft(
  to,
  from,
  pick,
  where = { bodypart: 0, model: 0 },
  move = (p) => p,
  { missing = "throw" } = {},
) {
  const target = readMdl(to);
  const source = readMdl(from);
  const names = bones(from).map((b) => b.name);
  /** The number the target gives the bone that `from` numbers `i`. */
  const numberIn = (i) => {
    const number = target.bones.indexOf(names[i]);
    if (number < 0)
      throw new Error(
        `graft: the target has no bone called ${names[i]}${missing === "ancestor" ? ", nor any it hangs from" : ' ({ missing: "ancestor" } hangs its corners on the nearest bone above it that the target has)'}`,
      );
    return number;
  };
  const parents = missing === "ancestor" ? boneParents(from) : null;
  const rest = parents && restPose(from);
  const kin = new Map();
  /** for a bone the target lacks: the bone above it that it has, and the matrix that takes a point there */
  const kinOf = (i) => {
    if (!kin.has(i)) {
      let above = i;
      while (above >= 0 && target.bones.indexOf(names[above]) < 0) above = parents[above];
      kin.set(
        i,
        above === i
          ? null
          : { bone: numberIn(above < 0 ? i : above), matrix: mul34(inverse34(rest[above]), rest[i]) },
      );
    }
    return kin.get(i);
  };

  let mdl = to;
  for (const bodypart of source.bodyparts)
    for (const model of bodypart.models)
      for (const mesh of model.meshes) {
        if (!mesh.numtris || !mesh.texture || !pick(mesh, model, bodypart)) continue;
        const store = cornerStore();
        const tris = readMesh(from, model, mesh).map((t) =>
          t.map((corner) => {
            const boneName = names[corner.bone];
            const moved = parents && kinOf(corner.bone);
            if (moved)
              return [
                store.vert(move(apply34(moved.matrix, corner.p), boneName), moved.bone),
                store.norm(
                  moved.matrix.map((row) => dot(row, corner.n)),
                  moved.bone,
                ),
                corner.s,
                corner.t,
              ];
            const bone = numberIn(corner.bone);
            return [
              store.vert(move(corner.p, boneName), bone),
              store.norm(corner.n, bone),
              corner.s,
              corner.t,
            ];
          }),
        );
        // the mesh goes after the ones the receiving submodel has by now
        const number = readMdl(mdl).bodyparts[where.bodypart].models[where.model].meshes.length;
        const { verts, norms, vertBones, normBones } = store;
        mdl = replaceMesh(
          addMesh(mdl, where),
          { ...where, mesh: number },
          { bone: vertBones[0], verts, norms, vertBones, normBones, tris },
          textureOf(from, mesh.texture.name),
        );
      }
  return mdl;
}

/**
 * A body again, as a new body, wearing another texture: the way a game adds an armour or a team's colours to
 * a model (the same shape, point for point, on the same bones, under a new name and number). Returns the
 * model with the new submodel after the others of its bodypart: its body number is that bodypart's old count
 * of submodels times its `base`.
 *   body      the body to copy: its submodel's name, or the body number that shows it
 *   name      the new submodel's name
 *   texture   what it wears: the name of a texture already in the file, or a new one, as a texture ({ name,
 *             width, height, pixels, palette, flags }) or as an image with a name
 *             ({ name, width, height, rgb }: cut to 256 colours here). Of another size than the one it
 *             replaces, the corners are moved to the same place in it
 *   instead   the name of the texture of the old body that the new one takes the place of. Needed only when
 *             the body wears several: its other meshes are copied wearing what they wore
 *   bodypart  for a body number: which bodypart's submodel is meant (the first unless told)
 * In a model of several bodyparts, a body added to one that is not the last raises the `base` of those
 * after it (`addModel`): the new body's own number is as said above, and the numbers that show another
 * than the first submodel of a later bodypart change with the bases. Mind the engine's count of submodels
 * (`check` tells).
 * The copy stores each pair of bone and normal once, so it may store fewer normals than the original (a body
 * whose normals are all 0, 0, 0 on one bone: one). Every corner still reads the normal it read, and the
 * engine lights a stored normal from its bone and its numbers alone, so the copy is lit as the original
 * (docs/ENGINES.md).
 */
export function copyBody(src, body, name, texture, { instead = null, bodypart = 0 } = {}) {
  const info = readMdl(src);
  // the submodel to copy: by its body number in the bodypart told, or by its name wherever it is
  let part = bodypart;
  let number;
  if (typeof body === "number") number = bodyOf(src, body)[part];
  else {
    const called = (model) => model.name.toLowerCase() === String(body).toLowerCase();
    part = info.bodyparts.findIndex((x) => x.models.some(called));
    number = part < 0 ? -1 : info.bodyparts[part].models.findIndex(called);
  }
  const from = info.bodyparts[part]?.models[number];
  const full = from?.meshes.filter((mesh) => mesh.numtris) ?? [];
  if (!from)
    throw new Error(
      `copyBody: no body ${body}: it has ${info.bodyparts.map((x) => x.models.map((m, k) => `${k * x.base}=${m.name}`).join(" ")).join("; ")}`,
    );
  if (!full.length) throw new Error(`copyBody: the body ${from.name} is empty`);
  if (full.some((mesh) => !mesh.texture))
    throw new Error(
      "copyBody: the model's textures are in another file: put them inside with withTextures first",
    );

  // which of the textures it wears the new one takes the place of
  const worn = [...new Set(full.map((mesh) => mesh.texture.name))];
  const old = instead ?? (worn.length === 1 ? worn[0] : null);
  if (!worn.includes(old))
    throw new Error(
      `copyBody: the body ${from.name} wears ${worn.join(", ")}: say which the new texture takes the place of with { instead: name }`,
    );
  const given = textureGiven(src, texture);
  if (!given.name) throw new Error("copyBody: the texture needs a name");

  const added = info.bodyparts[part].models.length;
  let mdl = addModel(src, part, name);
  full.forEach((mesh, k) => {
    const replaced = mesh.texture.name === old;
    // corners are kept in pixels: in a texture of another size they go to the same place of it
    const scaleU = replaced ? given.width / mesh.texture.width : 1;
    const scaleV = replaced ? given.height / mesh.texture.height : 1;
    const store = cornerStore();
    const tris = readMesh(src, from, mesh).map((t) =>
      t.map((corner) => [
        store.vert(corner.p, corner.bone),
        store.norm(corner.n, corner.bone),
        Math.round(corner.s * scaleU),
        Math.round(corner.t * scaleV),
      ]),
    );
    const { verts, norms, vertBones, normBones } = store;
    // a new submodel has one mesh, empty: the first is put there, the others added
    if (k) mdl = addMesh(mdl, { bodypart: part, model: added });
    mdl = replaceMesh(
      mdl,
      { bodypart: part, model: added, mesh: k },
      { bone: vertBones[0], verts, norms, vertBones, normBones, tris },
      replaced ? given : textureOf(src, mesh.texture.name),
    );
  });
  return mdl;
}

/**
 * Several models that hang from one skeleton, as one model to draw: a head, an armour and a helmet in one
 * picture.
 * `list`: models, or { mdl, body, pick(mesh, model, bodypart), move }: of each, the submodels that its `body`
 * number shows (0), of those the meshes `pick` accepts (all). The first gives the bones and the animations;
 * the others are hung on them by their bones' names, and a corner on a bone the first lacks goes on the
 * nearest one above it that it has (as `graft` with { missing: "ancestor" }). A texture of a name that is
 * taken, with another picture, comes under a name of its own.
 * Returns a model with one body: `render`, `sheet`, `strip` and `lineup` take it as it is, with `seq` and
 * `frame` of the first. It is for drawing and measuring, not for the game: its bodies are gone, and it may
 * pass the engine's limits.
 */
export function together(list) {
  const items = list.map((x) => (Buffer.isBuffer(x) ? { mdl: x } : x));
  const base = items[0].mdl;
  // everything goes into one new submodel, after the ones the first bodypart has
  const added = readMdl(base).bodyparts[0].models.length;
  let mdl = addModel(base, 0, "together");
  items.forEach((item, nth) => {
    let from = item.mdl;
    const taken = readMdl(mdl).textures.map((t) => t.name);
    for (const t of readMdl(from).textures)
      if (taken.includes(t.name) && !alike(textureOf(mdl, t.name), textureOf(from, t.name)))
        from = replaceTexture(from, t.name, {
          ...textureOf(from, t.name),
          name: `${nth}_${t.name}`.slice(0, NAME_MOST),
        });
    const info = readMdl(from);
    const shown = bodyOf(from, item.body ?? 0).map((model, part) => info.bodyparts[part].models[model]?.at);
    mdl = graft(
      mdl,
      from,
      (mesh, model, bodypart) =>
        shown.includes(model.at) && (item.pick ? Boolean(item.pick(mesh, model, bodypart)) : true),
      { bodypart: 0, model: added },
      item.move,
      { missing: "ancestor" },
    );
  });
  // one bodypart of one submodel: the one just filled
  const out = Buffer.from(mdl);
  const bodypartAt = out.readInt32LE(HEADER_BODYPARTS_AT);
  out.writeInt32LE(1, HEADER_BODYPARTS);
  out.writeInt32LE(1, bodypartAt + BODYPART_MODELS);
  out.writeInt32LE(1, bodypartAt + BODYPART_BASE);
  out.writeInt32LE(
    out.readInt32LE(bodypartAt + BODYPART_MODELS_AT) + added * MODEL_BYTES,
    bodypartAt + BODYPART_MODELS_AT,
  );
  return out;
}

/**
 * How triangles (as `posed` lists them) lie on a picture of `w` by `h`, their corners scaled by `scaleU`,
 * `scaleV`:
 *   id     for each pixel, the number of the first triangle that holds its middle (-1: none)
 *   at     three numbers a pixel: the point of the body that pixel colours
 *   keys   for each triangle, a name for where its three corners lie on the picture
 *   per    for each triangle, the units of the model a pixel covers on it (0 for one that is flat on the
 *          picture)
 */
function layoutOf(tris, scaleU, scaleV, w, h) {
  const id = new Int32Array(w * h).fill(-1);
  const at = new Float32Array(w * h * 3);
  const keys = [];
  const per = [];
  tris.forEach((t, k) => {
    const [a, b, c] = t.c.map((corner) => ({ u: corner.u * scaleU, v: corner.v * scaleV, p: corner.p }));
    const area = pictureArea(a, b, c);
    keys.push(layoutKey(t.c, scaleU, scaleV));
    per.push(Math.abs(area) < FLAT_ON_PICTURE ? 0 : unitsAPixel(a, b, c, area));
    if (Math.abs(area) < FLAT_ON_PICTURE) return;
    const x0 = Math.max(0, Math.floor(Math.min(a.u, b.u, c.u)));
    const x1 = Math.min(w - 1, Math.ceil(Math.max(a.u, b.u, c.u)));
    const y0 = Math.max(0, Math.floor(Math.min(a.v, b.v, c.v)));
    const y1 = Math.min(h - 1, Math.ceil(Math.max(a.v, b.v, c.v)));
    for (let py = y0; py <= y1; py++)
      for (let px = x0; px <= x1; px++) {
        const u = px + 0.5;
        const v = py + 0.5;
        const wb = weightOfB(a, b, c, u, v, area);
        const wc = weightOfC(a, b, c, u, v, area);
        const wa = 1 - wb - wc;
        const i = py * w + px;
        if (wa < 0 || wb < 0 || wc < 0 || id[i] >= 0) continue;
        id[i] = k;
        for (let axis = 0; axis < 3; axis++)
          at[i * 3 + axis] = a.p[axis] * wa + b.p[axis] * wb + c.p[axis] * wc;
      }
  });
  return { id, at, keys, per };
}

/**
 * How much of a body's picture is laid out otherwise than it was: `old` and `now` are two models (or one
 * model twice, for two of its bodies) and the body `body` of `now` is held against the body `from` of `old`
 * (the same number unless told). A pixel is kept when the triangle on it lies on the picture exactly where
 * one of the old body lay, or colours a place of the body within `tol` (2) pixels' worth of where the old one
 * did; it is moved when it colours another place, and fresh when the old body wore nothing there. Returns
 * { name: { pixels, kept, moved, fresh, bare, share, warning } } for each texture both wear (`tex`: one name,
 * or several): `share` is what is moved or fresh of the pixels the new body wears, `bare` the pixels only the
 * old one wore, `warning` a sentence when `share` passes 2 in 100 (else null): a picture painted for the old
 * body then no longer fits, and `carryPicture` is what carries it over.
 */
export function layoutMoved(
  old,
  now,
  { body = 0, from = body, tex = null, pose = {}, tol = 2, bodypart = null } = {},
) {
  const before = posed(old, { ...pose, body: from });
  const after = posed(now, { ...pose, body });
  const out = {};
  const wearing = (stand, name) =>
    stand.tris.filter((t) => t.tex?.name === name && (bodypart === null || t.where.bodypart === bodypart));
  for (const name of tex ? [tex].flat() : [...new Set(after.tris.map((t) => t.tex?.name))]) {
    const textureBefore = before.info.textures.find((t) => t.name === name);
    const textureAfter = after.info.textures.find((t) => t.name === name);
    if (!textureBefore || !textureAfter || !wearing(after, name).length || !wearing(before, name).length)
      continue;
    const w = textureAfter.width;
    const h = textureAfter.height;
    // both layouts on the new picture's pixels: the old body's corners are in pixels of the old file's
    // texture
    const was = layoutOf(wearing(before, name), w / textureBefore.width, h / textureBefore.height, w, h);
    const is = layoutOf(wearing(after, name), 1, 1, w, h);
    const count = { pixels: 0, kept: 0, moved: 0, fresh: 0, bare: 0 };
    for (let i = 0; i < w * h; i++) {
      const oldTriangle = was.id[i];
      const newTriangle = is.id[i];
      if (newTriangle < 0) {
        if (oldTriangle >= 0) count.bare++;
        continue;
      }
      count.pixels++;
      if (oldTriangle < 0) count.fresh++;
      else if (
        was.keys[oldTriangle] === is.keys[newTriangle] ||
        Math.hypot(
          was.at[i * 3] - is.at[i * 3],
          was.at[i * 3 + 1] - is.at[i * 3 + 1],
          was.at[i * 3 + 2] - is.at[i * 3 + 2],
        ) <=
          tol * is.per[newTriangle]
      )
        count.kept++;
      else count.moved++;
    }
    count.share = +((count.moved + count.fresh) / Math.max(1, count.pixels)).toFixed(3);
    count.warning =
      count.share > MOVED_WARNING
        ? `${Math.round(count.share * 100)} in 100 of the pixels of ${name} that body ${body} wears (${count.moved + count.fresh} of ${count.pixels}) now colour another place of it than they were painted for${count.fresh ? `, or lay bare (${count.fresh})` : ""}: a picture painted for the old shape does not fit the new one there. carryPicture(old, new, { body: ${body} }) repaints it from the old one`
        : null;
    out[name] = count;
  }
  return out;
}

/**
 * A body made from triangles, put into a model that is there already: as a new body after the others of its
 * bodypart (give `name`), or in the place of one (give `body`: its number, or its submodel's name), whose
 * first mesh takes it.
 *   tris      [[{ p, uv, bone } x3]]: what the workshop makes. `p` is in the space of the bone the corner
 *             hangs on, unless `pose` is given; `uv` 0 to 1; `bone` a name or a number where a corner hangs
 *             on another than `bone`. A corner may carry `to` (with no `pose`): the matrix that takes its
 *             `p` from the space it is given in to its own bone's, as `meshOf` has it, for a piece laid out
 *             in one bone's space whose corners hang on several (its faces are then measured whole)
 *   bone      the bone the body hangs on (a name or a number; the first unless told)
 *   pose      { seq, frame }: `p` is in model space, as the model stands in that pose, and is taken into its
 *             bone's space
 *   texture   a texture, an image with a `name` (cut to 256 colours), or the name of one in the file
 *   smooth    as `meshOf` (40); corners may carry `group` and `smooth`
 *   ownNormals  true: a corner that carries `n` (a normal of its own, in the space `p` is in) keeps it, in
 *             place of the one worked out from the faces: see `meshOf` (false: `n` is not read)
 * Returns { mdl, body (the number that shows it), warnings, report: { model, tris, verts, norms } }. It
 * warns, in `warnings` and on the console (unless `quiet`), when a body is replaced by one that lies
 * elsewhere on a picture the old one wore (see `layoutMoved`: what was painted there no longer fits), and
 * when the file has a texture of that name with another picture (the body then wears the file's).
 */
export function putBody(
  src,
  {
    name,
    body,
    bodypart = 0,
    tris,
    texture,
    bone = 0,
    pose = null,
    smooth = 40,
    ownNormals = false,
    quiet = false,
  },
) {
  const info = readMdl(src);
  const part = info.bodyparts[bodypart];
  const warnings = [];
  if (!part) throw new Error(`putBody: no bodypart ${bodypart}`);
  const numberOf = (given) => {
    const number = typeof given === "number" ? given : info.bones.indexOf(given);
    if (info.bones[number] === undefined)
      throw new Error(`putBody: no bone ${given}: it has ${info.bones.join(", ")}`);
    return number;
  };

  // the corners as `meshOf` takes them: each on its bone, with the way into that bone's space when a pose is
  // given
  const main = numberOf(bone);
  const intoBone = pose ? posed(src, pose).pose.map(inverse34) : null;
  const corners = tris.map((t) =>
    t.map((corner) => {
      const own = corner.bone === undefined ? main : numberOf(corner.bone);
      return {
        p: corner.p,
        uv: corner.uv,
        group: corner.group,
        smooth: corner.smooth,
        n: ownNormals ? corner.n : undefined,
        ...(intoBone ? { bone: own, to: intoBone[own] } : own !== main ? { bone: own } : {}),
        ...(!intoBone && corner.to ? { to: corner.to } : {}),
      };
    }),
  );

  const given = textureGiven(src, texture);
  if (!given.name) throw new Error("putBody: the texture needs a name");
  if (typeof texture !== "string" && info.textures.some((t) => t.name === given.name)) {
    if (!alike(textureOf(src, given.name), given))
      warnings.push(
        `the file has a texture called ${given.name} already, with another picture: the body wears the file's as it is (replaceTexture changes it)`,
      );
  }
  const mesh = meshOf(null, corners, given, main, smooth);

  // the submodel that takes it: the one named by `body`, or a new one after the others
  let number = -1;
  let mdl;
  if (body !== undefined) {
    number =
      typeof body === "number"
        ? bodyOf(src, body)[bodypart]
        : part.models.findIndex((m) => m.name.toLowerCase() === String(body).toLowerCase());
    if (!part.models[number])
      throw new Error(
        `putBody: no body ${body}: it has ${part.models.map((m, k) => `${k * part.base}=${m.name}`).join(" ")}`,
      );
  }
  if (number < 0) {
    if (!name) throw new Error("putBody: a new body needs a name, a replaced one its number (body)");
    number = part.models.length;
    mdl = replaceMesh(addModel(src, bodypart, name), { bodypart, model: number, mesh: 0 }, mesh, given);
  } else {
    // its first mesh takes the triangles, its other meshes are emptied
    // emptied first, points and normals too: the old body's would still count against the engine's limits
    const old = part.models[number];
    mdl = replaceMesh(
      old.meshes.length ? clearModel(src, { bodypart, model: number }) : addMesh(src, { bodypart, model: number }),
      { bodypart, model: number, mesh: 0 },
      mesh,
      given,
    );
    if (old.meshes.some((m) => m.numtris && m.texture?.name === given.name)) {
      const moved = layoutMoved(src, mdl, {
        body: number * part.base,
        tex: given.name,
        bodypart,
        pose: pose ?? {},
      });
      const warning = moved[given.name]?.warning;
      if (warning) warnings.push(warning);
    }
  }
  if (!quiet) for (const warning of warnings) console.warn(`smak: putBody: ${warning}`);
  return {
    mdl,
    body: number * part.base,
    warnings,
    report: {
      model: name ?? part.models[number].name,
      tris: mesh.tris.length,
      verts: mesh.verts.length,
      norms: mesh.norms.length,
    },
  };
}

/**
 * Rigid pieces, each wholly on one bone, put into a model as bodyparts of their own (`addBodypart`): as many as
 * the engine's points and normals a submodel need (`budget`, 2048 each in GoldSrc), each of one submodel, so
 * every body shows them all. For a figure of hard pieces on a game's skeleton: nothing in them stretches when
 * the game's animations play, and the model's own bodies keep their numbers.
 *   pieces    [{ bone, tris, name? }]: `bone` a name or a number; `tris` [[{ p, uv } x3]], `uv` 0 to 1, a corner
 *             may carry `group` and `smooth` (as `meshOf`). Each piece's faces are smoothed among themselves
 *             only: two pieces that touch do not share a normal
 *   space     "bone" (`p` in the space of the piece's bone) or "rest" (in model space, the bones at rest)
 *   texture   a texture, an image with a `name`, or the name of one in the file
 *   budget    the most points, and the most normals, a submodel is given (2048)
 *   name      the bodyparts are called `name`, `name2`, `name3`... ("rigid")
 *   smooth    as `meshOf` (30)
 * The pieces are laid into the bodyparts in the order given, a new one begun when the next would pass the
 * budget. Returns { mdl, bodyparts: [number], report: [{ bodypart, name, pieces, tris, verts, norms }] }.
 * Throws when one piece alone needs more than the budget, or the bodyparts would pass the engine's 32.
 */
export function putRigid(
  src,
  { pieces, texture, budget = 2048, space = "bone", name = "rigid", smooth = 30 },
) {
  if (!Array.isArray(pieces) || !pieces.length) throw new Error("putRigid: no pieces");
  if (space !== "bone" && space !== "rest")
    throw new Error(`putRigid: space is "bone" or "rest", not ${space}`);
  const info = readMdl(src);
  const given = textureGiven(src, texture);
  if (!given.name) throw new Error("putRigid: the texture needs a name");
  const into = space === "rest" ? restPose(src).map(inverse34) : null;
  const numberOf = (bone) => {
    const number = typeof bone === "number" ? bone : info.bones.indexOf(bone);
    if (info.bones[number] === undefined)
      throw new Error(`putRigid: no bone ${bone}: it has ${info.bones.join(", ")}`);
    return number;
  };
  // each piece's corners as meshOf takes them, its faces in a group of their own, and what it costs alone
  const built = pieces.map((piece, k) => {
    const bone = numberOf(piece.bone);
    const corners = piece.tris.map((t) =>
      t.map((c) => ({
        p: c.p,
        uv: c.uv,
        group: `${k}:${c.group ?? ""}`,
        smooth: c.smooth,
        bone,
        ...(into ? { to: into[bone] } : {}),
      })),
    );
    const alone = meshOf(null, corners, given, bone, smooth);
    const what = piece.name ?? `piece ${k}`;
    if (alone.verts.length > budget || alone.norms.length > budget)
      throw new Error(
        `putRigid: ${what} alone has ${alone.verts.length} points and ${alone.norms.length} normals, past the budget of ${budget}`,
      );
    return { corners, verts: alone.verts.length, norms: alone.norms.length };
  });
  // the pieces in order, a new bodypart when the next would pass the budget (the sums are the most it can be:
  // points two pieces share on one bone are kept once)
  const groups = [];
  let open = null;
  built.forEach((b, k) => {
    if (!open || open.verts + b.verts > budget || open.norms + b.norms > budget)
      groups.push((open = { pieces: [], verts: 0, norms: 0 }));
    open.pieces.push(k);
    open.verts += b.verts;
    open.norms += b.norms;
  });
  if (info.bodyparts.length + groups.length > 32)
    throw new Error(
      `putRigid: ${groups.length} bodyparts more than the ${info.bodyparts.length} the model has pass the engine's 32: fewer points, or a larger budget`,
    );
  let mdl = src;
  const bodyparts = [];
  const report = [];
  groups.forEach((group, g) => {
    const part = info.bodyparts.length + g;
    const partName = g ? `${name}${g + 1}` : name;
    const corners = group.pieces.flatMap((k) => built[k].corners);
    const mesh = meshOf(null, corners, given, corners[0][0].bone, smooth);
    mdl = replaceMesh(addBodypart(mdl, partName), { bodypart: part, model: 0, mesh: 0 }, mesh, given);
    bodyparts.push(part);
    report.push({
      bodypart: part,
      name: partName,
      pieces: group.pieces.length,
      tris: mesh.tris.length,
      verts: mesh.verts.length,
      norms: mesh.norms.length,
    });
  });
  return { mdl, bodyparts, report };
}
