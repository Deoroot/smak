// A new thing in models a game already has. A game that shows every weapon of a kind from one file (the
// hands and each weapon as a submodel of one bodypart, picked by a number its scripts name) takes a new
// weapon as one more submodel after the ones the file holds: nothing it has is moved, so every number the
// game's own scripts use still means what it meant.
//
//   addFitted   one piece, as a new submodel of one bodypart, laid on a submodel that is there already (the
//               one the game holds the same way): same place, same length, the turn whose outline follows it
//   addItem     the same piece in every file and place a kind of item is shown from (a "family": in the
//               hands' view, in each hand of the body seen from outside, on the floor, on the back), with
//               the numbers a script needs
//   itemSheet   each new submodel drawn beside the one it was laid on
//
// Nothing here knows a game: a family is data (which files, bodyparts, bones and reference submodels, and
// how a script's numbers follow from where the new submodels landed), and a mod's profile is where it is
// kept (docs/ITEMS.md).
import { readMdl, readMesh, textureOf, mul34, inverse34, drawnCorners, sequences } from "../core/mdl.mjs";
import { putBody, graft } from "./bodies.mjs";
import { HANDS, measure, frameOf, bestTurn, shieldFit } from "./fit.mjs";
import { atOwnSize, boneNearest } from "./build.mjs";
import { indexed, shrink } from "../core/image.mjs";
import { render, tile, framing } from "./render.mjs";
import { engineLayout } from "../core/layout.mjs";
import { into, out, box, uniq } from "../core/vec.mjs";

/** The ways a piece is laid on the submodel it is fitted to (`how`). */
const HOWS = ["outline", "shield", "bone"];
/** What is done when the file already has a submodel of the new one's name (`existing`). */
const EXISTING = ["refuse", "same"];
/** Where a family's placement writes the item's name in a submodel's. */
const NAME_HERE = "{name}";

/** A choice of meshes as a function of a mesh: a function as it is, a RegExp on the texture's name. */
const pickOf = (given, otherwise) =>
  given === undefined || given === null
    ? otherwise
    : given instanceof RegExp
      ? (mesh) => given.test(mesh.texture?.name ?? "")
      : given;

/** The number of a bodypart given by its number or its name. */
function bodypartNumber(info, which, what) {
  const number =
    typeof which === "number"
      ? which
      : info.bodyparts.findIndex((part) => part.name.toLowerCase() === String(which).toLowerCase());
  if (!info.bodyparts[number])
    throw new Error(
      `${what}: no bodypart ${which}: it has ${info.bodyparts.map((part, i) => `${i}=${part.name}`).join(" ")}`,
    );
  return number;
}

/** The number of a submodel of a bodypart given by its number or its name. */
function submodelNumber(part, which, what) {
  const number =
    typeof which === "number"
      ? which
      : part.models.findIndex((model) => model.name.toLowerCase() === String(which).toLowerCase());
  if (!part.models[number])
    throw new Error(
      `${what}: the bodypart ${part.name} has no submodel ${which} to fit to: it has ${part.models.length}, ${part.models
        .slice(0, 12)
        .map((model, i) => `${i}=${model.name}`)
        .join(" ")}${part.models.length > 12 ? " ..." : ""}`,
    );
  return number;
}

/** Two textures show the same picture, in the same way. */
const sameTexture = (a, b) =>
  a.width === b.width &&
  a.height === b.height &&
  (a.flags ?? 0) === (b.flags ?? 0) &&
  Buffer.from(a.pixels).equals(Buffer.from(b.pixels)) &&
  Buffer.from(a.palette).equals(Buffer.from(b.palette));

/**
 * A submodel as text, to tell whether two are the same thing: of each of its meshes that has triangles, the
 * texture's name and every corner's point, normal, bone (by name) and place on the picture.
 */
function bodyText(mdl, info, model) {
  return JSON.stringify(
    model.meshes
      .filter((mesh) => mesh.numtris)
      .map((mesh) => [
        mesh.texture?.name,
        readMesh(mdl, model, mesh).map((tri) =>
          tri.map((corner) => [corner.p, corner.n, info.bones[corner.bone], corner.s, corner.t]),
        ),
      ]),
  );
}

/**
 * A piece drawn as a shield (+x along its length, +y across it, +z out of its face, z = 0 the plane of its
 * back) on a measured one (`shieldFit`'s `p`): the middle of its box on the middle of the old body, its back
 * on the old back, and as long as the old one unless it keeps its own size.
 */
function onBack(tris, measures, size) {
  const b = box(uniq(tris));
  const k = size === "own" ? 1 : measures.length / (b.mx[0] - b.mn[0]);
  const middle = [(b.mn[0] + b.mx[0]) / 2, (b.mn[1] + b.mx[1]) / 2];
  return {
    k,
    name: "on its back",
    at: (p) => [(p[0] - middle[0]) * k, (p[1] - middle[1]) * k, p[2] * k],
  };
}

/**
 * One piece added to a model as a new submodel, after the ones its bodypart has, laid on a submodel that is
 * there already.
 *   name      the new submodel's name
 *   piece     { tris, haft, rig, bones, shield } as the kits make it (a corner is { p, uv } and may carry
 *             `group`, `smooth` and `part`)
 *   texture   what it wears: a texture ({ name, width, height, pixels, palette }), an image with a `name`
 *             (cut to 256 colours), or the name of one the file has. One of that name already in the file is
 *             worn as it is
 *   bodypart  the bodypart added to: its number or its name (the first unless told). It need not be the
 *             last: the bases of those after it follow (`addModel`)
 *   like      the submodel of that bodypart the piece is fitted to: its number or its name
 *   from      the file `like` is measured in, when it is another copy of this one (the game's own, where the
 *             file added to has had that submodel's mesh replaced): the same bones in the same order
 *   pick      which meshes of `like` are the thing itself: a function of a mesh or a RegExp on its texture's
 *             name (unless told: all but the hands' and arms')
 *   keep      meshes of `like` that go into the new submodel as they are, with their textures and bones (a
 *             bow's nocked arrow): a function or a RegExp; none unless told
 *   bone      the bone the piece hangs on, by name (unless told: the one that carries most of `like`). Another
 *             than that one is reached through the bones at rest
 *   how       "outline" (unless told): the piece is drawn in its own axes at any size (+x its length) and is
 *               laid over `like`: same length, same place, of the four ways of turning it the one whose
 *               outline follows best (`bestTurn`; a piece with `haft: true` goes on the old handle's line)
 *             "shield": `like` is measured as a shield (`shieldFit`: its body and the straps on its back) and
 *               the piece, drawn +x along its length, +y across, +z out of its face with z = 0 its back, is
 *               put on its back plane, as long as the old body. A piece whose `shield` is a function is made
 *               by it to those measures (`piece.shield(measures)` gives the triangles, in that frame)
 *             "bone": its points are where they must be already, in the space of the bone that carries `like`
 *   size      "old" (unless told): as long as `like`; "own": the size it was drawn at
 *   bones     [, "name", ...]: the corners the piece marks `part` n hang on that bone (part 0 is the bone
 *             the piece hangs on): a bow's string, whose middle the kit marks part 1, on the bone that
 *             draws it. Unless told, the piece's own `bones`
 *   rig       "nearest": each corner that `bones` does not place takes the bone of the nearest corner of
 *             `like` (what bent goes on bending: a bow's limbs), of those that are on none of the bones
 *             `bones` names. Unless told, the piece's own `rig`. It goes by distance alone: a corner of
 *             the new thing that lies nearer a moving part of the old than its own counterpart goes with
 *             that part (a stave's belly at the grip with the string's middle, when `bones` does not keep
 *             the string apart), so look at the pictures
 *   existing  what is done when the bodypart has a submodel of that name: "refuse" (unless told: it throws),
 *             or "same": the piece is made all the same, and when what the file holds is that very thing
 *             (every corner, bone and the picture) the file comes back as it is with `kept: true`; when it is
 *             another thing it throws, since a file that has been added to cannot be added to again
 * Returns { mdl, model (the new submodel's number in its bodypart), body (the body number that shows it,
 * the other bodyparts at their first), kept, report: { model, like, bone, bones, tris, verts, norms, corners
 * (drawn), scale, turn, left (between the two outlines, in units), boxOff, carried (meshes kept from `like`),
 * textures } }.
 */
export function addFitted(
  src,
  {
    name,
    piece,
    texture,
    bodypart = 0,
    like,
    from = src,
    pick,
    keep = null,
    bone = null,
    how = "outline",
    size = "old",
    rig = piece?.rig ?? null,
    bones = piece?.bones ?? [],
    existing = "refuse",
    smooth = 40,
    what = "addFitted",
  },
) {
  if (!name) throw new Error(`${what}: the new submodel needs a name`);
  if (!piece?.tris?.length && typeof piece?.shield !== "function")
    throw new Error(`${what}: a piece is { tris, ... }, as the kits and the workshop make it`);
  if (!HOWS.includes(how)) throw new Error(`${what}: how is ${HOWS.join(", ")}, not ${how}`);
  if (!EXISTING.includes(existing))
    throw new Error(`${what}: existing is ${EXISTING.join(" or ")}, not ${existing}`);
  if (like === undefined || like === null)
    throw new Error(`${what}: like, the submodel the piece is fitted to (its number or its name)`);
  const info = readMdl(src);
  const part = bodypartNumber(info, bodypart, what);
  const reference = from === src ? info : readMdl(from);
  if (reference.bones.join("\n") !== info.bones.join("\n"))
    throw new Error(
      `${what}: the file ${like} is measured in has other bones than the file added to: it is to be a copy of the same model`,
    );
  if (!reference.bodyparts[part]) throw new Error(`${what}: the file measured in has no bodypart ${part}`);
  const likeNumber = submodelNumber(reference.bodyparts[part], like, what);
  const present = info.bodyparts[part].models.findIndex((model) => model.name === name);
  if (present >= 0 && existing === "refuse")
    throw new Error(
      `${what}: the bodypart ${info.bodyparts[part].name} has a submodel called ${name} already (number ${present}): the file was added to before. Begin again from the file as it was, or pass existing: "same" to keep what is there when it is this very thing`,
    );

  // the thing it is fitted to, in the space of the bone that carries it
  const chosen = pickOf(pick, (mesh) => !HANDS.test(mesh.texture?.name ?? ""));
  const {
    model: likeModel,
    rest,
    bone: carrying,
    original,
  } = measure(from, likeNumber * reference.bodyparts[part].base, chosen, what, part);

  // the fit: from the piece's own space to the old thing's axes (`frame`), or none when placed by bone
  let frame = null;
  let drawn = piece.tris;
  let fit = { k: 1, name: "as given", left: 0, at: (p) => p };
  if (how === "outline") {
    frame = frameOf(original);
  } else if (how === "shield") {
    const made = shieldFit(original);
    frame = made.frame;
    if (typeof piece.shield === "function") {
      drawn = piece.shield(made.p);
      fit = { ...fit, name: "made to its straps" };
    } else fit = onBack(drawn, made.p, size);
  }
  const theirs = frame
    ? original.map((tri) => tri.map((c) => ({ p: into(frame, c.p), mesh: c.mesh, bone: c.bone })))
    : original;
  if (how === "outline") {
    fit = bestTurn(drawn, theirs, piece.haft);
    if (size === "own") fit = atOwnSize(fit, drawn);
  }

  // the bone of each corner: the one asked for, or the one that carries the old thing; with `rig: "nearest"`
  // the bone of the old thing's nearest corner; or the piece's `bones` by the corner's `part`
  const main = bone === null ? carrying : info.bones.indexOf(bone);
  if (main < 0) throw new Error(`${what}: no bone ${bone}: it has ${info.bones.join(", ")}`);
  const partBones = bones.map((boneName, i) => (i && boneName ? info.bones.indexOf(boneName) : main));
  if (partBones.includes(-1))
    throw new Error(`${what}: no bone ${bones[partBones.indexOf(-1)]}: it has ${info.bones.join(", ")}`);
  const apart = partBones.filter((own) => own !== main);
  const theirCorners =
    rig === "nearest" ? theirs.flat().filter((corner) => !apart.includes(corner.bone)) : null;
  const toBone = new Map();
  /** from the carrying bone's space, where the fit leaves a point, to another bone's, the bones at rest */
  const into34 = (own) => {
    if (!toBone.has(own)) toBone.set(own, mul34(inverse34(rest[own]), rest[carrying]));
    return toBone.get(own);
  };
  const tris = drawn.map((tri) =>
    tri.map((corner) => {
      const fitted = fit.at(corner.p);
      const p = frame ? out(frame, fitted) : fitted;
      let own = main;
      if (corner.part && partBones[corner.part] !== undefined) own = partBones[corner.part];
      else if (theirCorners) {
        const nearest = boneNearest(theirCorners, fitted, carrying);
        own = nearest === carrying ? main : nearest;
      }
      return {
        p,
        uv: corner.uv,
        group: corner.group,
        smooth: corner.smooth,
        ...(own !== main ? { bone: own } : {}),
        ...(own !== carrying ? { to: into34(own) } : {}),
      };
    }),
  );

  // the picture: one of that name in the file is worn as it is (an earlier placement of the same item)
  const given = typeof texture === "string" || texture.pixels ? texture : indexed(texture, texture.name);
  const held = typeof given !== "string" && info.textures.some((t) => t.name === given.name);
  const put = putBody(src, {
    name,
    bodypart: part,
    tris,
    texture: held ? given.name : given,
    bone: main,
    smooth,
    quiet: true,
  });
  let mdl = put.mdl;
  const number = info.bodyparts[part].models.length;

  // what the old thing has beside itself, taken along as it is
  const kept = keep === null ? null : pickOf(keep);
  const carried = kept ? likeModel.meshes.filter((mesh) => mesh.numtris && kept(mesh)).length : 0;
  if (carried)
    mdl = graft(mdl, from, (mesh, model) => model.at === likeModel.at && Boolean(kept(mesh)), {
      bodypart: part,
      model: number,
    });

  const newBox = box(uniq(tris));
  const oldBox = box(uniq(original));
  const made = readMdl(mdl);
  const report = {
    model: name,
    like: likeModel.name,
    bone: info.bones[main],
    bones: [
      ...new Set(tris.flatMap((tri) => tri.map((corner) => info.bones[corner.bone ?? main]))),
    ],
    tris: put.report.tris,
    verts: put.report.verts,
    norms: put.report.norms,
    corners: drawnCorners(mdl)[
      made.bodyparts.slice(0, part).reduce((sum, before) => sum + before.models.length, 0) + number
    ].corners,
    scale: fit.k,
    turn: fit.name,
    left: fit.left,
    boxOff: Math.max(
      ...[0, 1, 2].flatMap((a) => [
        Math.abs(newBox.mn[a] - oldBox.mn[a]),
        Math.abs(newBox.mx[a] - oldBox.mx[a]),
      ]),
    ),
    carried,
    textures: made.textures.length,
  };

  // a file that holds it already: the same thing is kept, another is refused
  if (present >= 0) {
    const same =
      bodyText(src, info, info.bodyparts[part].models[present]) ===
        bodyText(mdl, made, made.bodyparts[part].models[number]) &&
      (typeof given === "string" || sameTexture(textureOf(src, given.name), given));
    if (!same)
      throw new Error(
        `${what}: the bodypart ${info.bodyparts[part].name} has a submodel called ${name} already (number ${present}), and it is not what is made now (another shape, place or picture): it cannot be changed where it is. Begin again from the file as it was before it was added to`,
      );
    return {
      mdl: src,
      model: present,
      body: present * info.bodyparts[part].base,
      kept: true,
      report,
    };
  }
  return { mdl, model: number, body: number * info.bodyparts[part].base, kept: false, report };
}

/**
 * One item put into every file and place its family shows it from.
 *   read(file)   the bytes of a model file to add to, by the name the family gives it
 *   item         { name, piece, texture }: `name` goes into each submodel's (a placement's `name`, with
 *                "{name}" where it stands); `piece` as `addFitted` takes it, with `image`, its picture;
 *                `texture` the name the picture has in the files ("mace_new.bmp"), or a function of a
 *                placement that gives the texture it wears there
 *   family       {
 *                  placements  [{ group, file, bodypart, like, bone, name, shrink, pick, keep, how, size,
 *                              rig, bones, seq, frame, view }]: `file`, `bodypart`, `like`, `bone`, `pick`,
 *                              `keep`, `how`, `size`, `rig` and `bones` as `addFitted` has them; `shrink`: how many
 *                              times smaller the picture is in that file (1 unless told); `group`: a name
 *                              for the placements a script counts together; `seq`, `frame`, `view`: the
 *                              pose `itemSheet` draws it in
 *                  numbers     { CONSTANT: group }: the script's constant that is the number of the first
 *                              submodel of that group. The group's submodels are to follow one another in
 *                              one bodypart of one file, in the order given: a script reaches the others by
 *                              counting on from the first
 *                  constants   { CONSTANT: value }: what else a script of the family sets, as it is
 *                }
 *   options      reference(file): the bytes each `like` is measured in (unless told: `read`'s);
 *                existing: as `addFitted` ("same" makes a second run on its own result leave it as it is)
 * Returns { files (a Map from each file's name to its new bytes, laid out for a dedicated server), placed
 * ([{ ...placement, name, model, body, kept, report }]), numbers ({ CONSTANT: number }), constants (the
 * family's, with the numbers), kept (true when every placement was there already) }.
 */
export function addItem(read, item, family, { reference = read, existing = "refuse" } = {}) {
  if (!item?.name || !item.piece) throw new Error("addItem: an item is { name, piece, texture }");
  if (!family?.placements?.length) throw new Error("addItem: a family is { placements: [...], numbers }");
  const files = new Map();
  const measured = new Map();
  const pictures = new Map();
  /** the picture as that placement's file wears it: the piece's, `shrink` times smaller, cut to a palette */
  const textureFor = (place) => {
    if (typeof item.texture === "function") return item.texture(place);
    if (!item.piece.image) return item.texture;
    const times = place.shrink ?? 1;
    if (!pictures.has(times))
      pictures.set(
        times,
        indexed(times > 1 ? shrink(item.piece.image, times) : item.piece.image, item.texture),
      );
    return pictures.get(times);
  };
  const placed = [];
  for (const place of family.placements) {
    if (!files.has(place.file)) files.set(place.file, read(place.file));
    if (!measured.has(place.file)) measured.set(place.file, reference(place.file));
    const name = String(place.name ?? `${NAME_HERE}_${placed.length}`).replaceAll(NAME_HERE, item.name);
    const result = addFitted(files.get(place.file), {
      name,
      piece: item.piece,
      texture: textureFor(place),
      bodypart: place.bodypart ?? 0,
      like: place.like,
      from: measured.get(place.file),
      pick: place.pick,
      keep: place.keep ?? null,
      bone: place.bone ?? null,
      how: place.how ?? family.how ?? "outline",
      size: place.size ?? "old",
      rig: place.rig === undefined ? (item.piece.rig ?? null) : place.rig,
      bones: place.bones ?? item.piece.bones ?? [],
      existing,
      what: `${place.file} ${name}`,
    });
    files.set(place.file, result.mdl);
    placed.push({ ...place, name, model: result.model, body: result.body, kept: result.kept, report: result.report }); // prettier-ignore
  }
  // the numbers a script names the item by: the first of each group, the others counted on from it
  const numbers = {};
  for (const [constant, group] of Object.entries(family.numbers ?? {})) {
    const of = placed.filter((place) => place.group === group);
    if (!of.length) throw new Error(`addItem: ${constant} is the first of the group ${group}, which has no placement`); // prettier-ignore
    of.forEach((place, i) => {
      if (place.file !== of[0].file || (place.bodypart ?? 0) !== (of[0].bodypart ?? 0) || place.model !== of[0].model + i) // prettier-ignore
        throw new Error(
          `addItem: the submodels of the group ${group} do not follow one another (${of.map((each) => `${each.name}=${each.model}`).join(" ")}): a script counts on from ${constant}`,
        );
    });
    numbers[constant] = of[0].model;
  }
  for (const [file, bytes] of files) files.set(file, engineLayout(bytes));
  return {
    files,
    placed,
    numbers,
    constants: { ...family.constants, ...numbers },
    kept: placed.every((place) => place.kept),
  };
}

/** The lines of a script that name an item's models: each of `addItem`'s constants, as `const NAME value`. */
export const itemConstants = (result) =>
  Object.entries(result.constants).map(([constant, value]) => `const ${constant} ${value}`);

/**
 * What `addItem` placed in one file, drawn: each new submodel beside the one it was laid on, a pair a row,
 * in the pose its placement names (`seq`, `frame`; `view`: "first" for the hands' own view, else as `render`
 * takes it). `mdl`: the file's new bytes; `placed`: `addItem`'s, of that file. Returns a picture.
 */
export function itemSheet(mdl, placed, { width = 384, height = 384 } = {}) {
  const info = readMdl(mdl);
  const pictures = [];
  const labels = [];
  for (const place of placed) {
    const part = info.bodyparts[bodypartNumber(info, place.bodypart ?? 0, "itemSheet")];
    const like = submodelNumber(part, place.like, "itemSheet");
    const first = place.view === "first";
    const poseOf = (model) => ({ body: model * part.base, seq: place.seq ?? 0, frame: place.frame ?? 0 });
    // from outside, the two to one scale: both framed by what holds them both
    const within = first ? null : framing(mdl, [poseOf(like), poseOf(place.model)]);
    const one = (model) =>
      render(mdl, {
        ...poseOf(model),
        ...(first ? { view: "first" } : { yaw: 35, pitch: 20, ...place.view, within }),
        width: first ? Math.round((height * 4) / 3) : width,
        height,
      });
    pictures.push(one(like), one(place.model));
    labels.push(part.models[like].name.toUpperCase(), place.name.toUpperCase());
  }
  return tile(pictures, 2, labels);
}

/**
 * Whether a file that was added to still holds everything it held, where it held it: what a game's own
 * scripts name by number must not have moved. `before` and `after` are the two files. Looked at: every
 * submodel each bodypart had (the same name, corners, bones and textures at the same number), each
 * bodypart's `base` against the compiler's rule (`basesByRule`), every texture (the same picture at the same
 * number), the bones and the animations. Returns { ok, lines: [{ ok, text }] }.
 */
export function keptWhole(before, after) {
  const was = readMdl(before);
  const now = readMdl(after);
  const lines = [];
  const say = (ok, text) => lines.push({ ok, text });
  let base = 1;
  was.bodyparts.forEach((old, p) => {
    const got = now.bodyparts[p];
    const same = old.models.filter(
      (model, i) =>
        got?.models[i]?.name === model.name && bodyText(before, was, model) === bodyText(after, now, got.models[i]),
    ).length; // prettier-ignore
    const added = (got?.models.length ?? 0) - old.models.length;
    say(
      same === old.models.length && added >= 0 && got.base === base,
      `bodypart ${p} "${old.name}": ${same} of its ${old.models.length} submodels read back the same at the same numbers${added > 0 ? `, ${added} new after them (${got.models.slice(old.models.length).map((model, i) => `${old.models.length + i}=${model.name}`).join(" ")})` : ""}; its base ${old.base}${got && got.base !== old.base ? ` -> ${got.base}` : ""} (by the rule: ${base})`,
    );
    base *= got?.models.length ?? 1;
  });
  say(now.bodyparts.length === was.bodyparts.length, `${now.bodyparts.length} bodyparts (it had ${was.bodyparts.length})`); // prettier-ignore
  const pictures = was.textures.filter(
    (texture, i) =>
      now.textures[i]?.name === texture.name && sameTexture(textureOf(before, i), textureOf(after, i)),
  ).length;
  const fresh = now.textures.slice(was.textures.length).map((texture) => `${texture.name} ${texture.width}x${texture.height}`); // prettier-ignore
  say(
    pictures === was.textures.length,
    `${pictures} of the ${was.textures.length} pictures it had are the same at the same numbers${fresh.length ? `, ${fresh.length} new (${fresh.join(", ")})` : ""}`,
  );
  say(
    was.bones.join("\n") === now.bones.join("\n") &&
      JSON.stringify(sequences(before)) === JSON.stringify(sequences(after)),
    "the same bones and animations",
  );
  return { ok: lines.every((line) => line.ok), lines };
}
