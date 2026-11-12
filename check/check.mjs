// A model looked over before it goes into a game: what would crash the engine or draw wrong (errors), and
// what it will put up with but should be known (warnings). Run it on everything that is written.
//
// The two engines read the same file and differ in how much of it they hold:
//   goldsrc   Half-Life's own engine (Steam), which a GoldSrc mod runs on today
//   xash      Xash3D FWGS, which holds more
//   source    a model the kit builds for Source (builtToGmod, src/source/gmod.mjs): this file is only the step between, ported
//             to Source's compiler's files, so it is held to what that port and Source take, not to GoldSrc's
// A model that passes for goldsrc passes for xash.
import {
  readMdl,
  readMesh,
  sequences,
  bones,
  frameValues,
  drawnCorners,
  skinFamilies,
  hitboxes,
  attachments,
  boneControllers,
  boneMatrices,
  basesByRule,
  events,
  modelName,
} from "../core/mdl.mjs";
import { sub, dot, cross } from "../core/vec.mjs";
import { FRONT } from "../make/mesh.mjs";
import { isEngineLayout } from "../core/layout.mjs";
import { formOfMdl, judgeForm, kindOfName } from "./form.mjs";
import { motionOf, judgeMotion, MOTION_SAID, MOTION_LIMITS } from "./motion.mjs";

/**
 * What each engine holds. `verts`: points and normals of one submodel, and the corners it draws.
 * `textures` is no limit of an engine's: see TEXTURES_READ.
 */
export const LIMITS = {
  goldsrc: {
    verts: 2048,
    bones: 128,
    textures: 100,
    bodyparts: 32,
    models: 32,
    meshes: 256,
    sequences: 2048,
    texture: 512,
  },
  // a submodel's corners are 16-bit numbers in this file (Source's own .vvd holds 65536); Source's bones are
  // MAXSTUDIOBONES, 128; its pictures 4096 a side at the most here, the kit's choice: Half-Life 2's own are 2048 at
  // the most (scripts/source-budgets.mjs)
  source: {
    verts: 32767,
    bones: 128,
    textures: 256,
    bodyparts: 32,
    models: 32,
    meshes: 256,
    sequences: 2048,
    texture: 4096,
  },
  xash: {
    verts: 16384,
    bones: 128,
    textures: 256,
    bodyparts: 32,
    models: 32,
    meshes: 256,
    sequences: 2048,
    texture: 4096,
  },
};

// ── the format: what is read here straight from the file (the engine's studio.h; see mdl.mjs) ──────────────
/** studiohdr_t.length: how long the file says it is. */
const HDR_LENGTH = 72;
/** mstudiomodel_t.vertinfoindex and norminfoindex: where a submodel keeps a bone (one byte) for each of its
 *  vertices, and for each of its normals. */
const MODEL_VERTINFOINDEX = 84;
const MODEL_NORMINFOINDEX = 96;
/** A texture's palette, which follows its pixels: 256 colours of three bytes. */
const PALETTE = 256 * 3;
/** mstudiotexture_t.flags: chrome (STUDIO_NF_CHROME), and the one size older GoldSrc draws it right at. */
const TEX_CHROME = 2;
const CHROME_SIZE = 64;
// A mesh's triangle commands: a 16 bit count (0 ends the list; its sign tells a strip from a fan), then
// that many corners of four 16 bit numbers (mstudiotrivert_t), the first two a vertex and a normal of the
// submodel.
const COMMAND_COUNT = 2;
const CORNER = { vertex: 0, normal: 2, sizeof: 8 };

/**
 * How many textures a model may have, as far as it can be read (2026-10-13). The 100 is MAXSTUDIOSKINS of
 * the SDK's studio.h ("total textures"), and what uses it is the compiler: studiomdl keeps its textures in a
 * table of that size and stops at one more. Nothing that READS a model was found to count them:
 *   Xash3D FWGS (its source, engine/common/mod_studio.c and ref/gl/gl_studio.c): Mod_LoadStudioModel and
 *     R_StudioLoadTexture walk `numtextures` as the file gives it; its studio.h has MAXSTUDIOSKINS 256 and
 *     no line of the engine uses the name. What ends is the renderer's own table of every texture of the
 *     game, MAX_TEXTURES: 8192 (1024 in the software renderer built for little memory), shared by the map,
 *     the sprites and every model loaded
 *   a dedicated server (ReHLDS, Mod_LoadStudioModel, from memory of it): copies the textures in the table's
 *     order, by the same count, into memory it asks for by the file's size
 *   GoldSrc's own client is closed: that it has no table of 100 is NOT read from its source. A mesh's
 *     `skinref` and the skin table are 16 bits, which is no limit in practice
 * Of the 682 models one mod ships none has more than 100, as files written by that compiler would not.
 */
const TEXTURES_READ = {
  goldsrc:
    "that is the compiler's limit (studiomdl's MAXSTUDIOSKINS), not one found in an engine: Xash and a dedicated server read as many as the file has, and GoldSrc's own client, whose source is closed, is not known to count them. A model made here never passes through that compiler; try it in the game on Steam's engine before it is relied on",
  source: "a port writes one material a texture, and Source's compiler takes many more",
  xash: "Xash's studio.h names 256 (MAXSTUDIOSKINS) and nothing in the engine uses it: the textures are loaded as many as the file has, into the renderer's table of every texture of the game (8192; 1024 in the software renderer built for little memory)",
};

/** Near a limit: this share of it. */
const NEAR_LIMIT = 0.75;
/** The share of triangles turned from their normals above which it is told. */
const TURNED_SHARE = 0.05;
/** How many names a sentence lists before it counts the rest. */
const NAMES_LISTED = 4;
/**
 * How far a bone may be, in a looping animation's last frame, from where it is in the first before it is
 * told: this many units, or this many degrees (motion.mjs keeps the numbers with their provenance: in every
 * looping animation of Half-Life's zombie, hgrunt, headcrab, houndeye and bullsquid the last frame is the first
 * again, to 0.0 degrees and at most 0.31 of a unit, the root's, left over where a walk's travel was taken out).
 */
const { SEAM_UNITS, SEAM_DEGREES } = MOTION_LIMITS;

const pow2 = (n) => n > 0 && (n & (n - 1)) === 0;
/** The first few of a list of names, and how many more there are. */
const some = (list) =>
  `${list.slice(0, NAMES_LISTED).join(", ")}${list.length > NAMES_LISTED ? ` and ${list.length - NAMES_LISTED} more` : ""}`;

/** The textures: each one whole inside the file, and the sizes the engine draws less well. */
function checkTextures(src, info, engine, { errors, warnings, facts }, sourceTextures = null) {
  const limits = LIMITS[engine];
  const tooBig = [];
  const notPow2 = [];
  for (const t of info.textures) {
    if (t.index + t.width * t.height + PALETTE > src.length)
      errors.push(`the texture ${t.name} runs past the end of the file`);
    if (t.width > limits.texture || t.height > limits.texture)
      tooBig.push(`${t.name} ${t.width}x${t.height}`);
    if (!pow2(t.width) || !pow2(t.height)) notPow2.push(`${t.name} ${t.width}x${t.height}`);
    if (t.flags & TEX_CHROME && engine === "goldsrc" && (t.width !== CHROME_SIZE || t.height !== CHROME_SIZE))
      warnings.push(
        `the chrome texture ${t.name} is ${t.width}x${t.height}: older GoldSrc draws chrome right only at 64x64`,
      );
  }
  // with a source: the ones it has at the same size are told apart, as the source's and not this file's doing
  const fromSource = (list) => list.filter((entry) => sourceTextures?.has(entry));
  const ownOnly = (list) => list.filter((entry) => !sourceTextures?.has(entry));
  const tooBigSaid = (list) =>
    engine === "goldsrc"
      ? `${list.length} textures larger than 512 (${some(list)}): GoldSrc draws nothing finer than gl_max_size (512 by default, 256 in builds before 2023) and shrinks them`
      : `${list.length} textures larger than ${limits.texture} (${some(list)})`;
  if (ownOnly(tooBig).length) warnings.push(tooBigSaid(ownOnly(tooBig)));
  if (fromSource(tooBig).length) warnings.push(`${INHERITED}${tooBigSaid(fromSource(tooBig))}`);
  if (notPow2.length && engine === "goldsrc")
    facts.push(
      `${notPow2.length} textures have a side that is not a power of two (${some(notPow2)}): GoldSrc stretches those to one when it loads them, a little softer`,
    );
}

/**
 * One mesh of a submodel: its skin, and every corner's point and normal, which have to be the submodel's
 * own, and the normal one of this mesh's turn (`normsBefore`: how many normals the meshes before it have).
 * Its triangles are counted into `count`: all of them, and those that look the other way from their normals.
 */
function checkMesh(src, { info, refs, model, mesh, normsBefore, where }, { errors, warnings }, count) {
  if (info.textures.length && mesh.skinref >= refs)
    errors.push(`${where}: wears skin ${mesh.skinref}, and there are ${refs}`);
  if (!mesh.numtris) return;
  let outside = 0;
  let notOwn = 0;
  for (let at = mesh.triindex; ; ) {
    const corners = Math.abs(src.readInt16LE(at));
    at += COMMAND_COUNT;
    if (!corners) break;
    for (let i = 0; i < corners; i++, at += CORNER.sizeof) {
      const vertex = src.readInt16LE(at + CORNER.vertex);
      const normal = src.readInt16LE(at + CORNER.normal);
      if (vertex < 0 || vertex >= model.numverts || normal < 0 || normal >= model.numnorms) outside++;
      else if (normal < normsBefore || normal >= normsBefore + mesh.numnorms) notOwn++;
    }
  }
  if (outside) {
    errors.push(`${where}: ${outside} corners point outside the submodel's points or normals`);
    return;
  }
  if (notOwn)
    warnings.push(
      `${where}: ${notOwn} corners use normals that are not this mesh's own: they are lit with another texture's light`,
    );
  for (const tri of readMesh(src, model, mesh)) {
    count.total++;
    // told only of a triangle on one bone: its points and its normal are then in one space
    const oneBone = tri[0].bone === tri[1].bone && tri[0].bone === tri[2].bone;
    const face = () => cross(sub(tri[1].p, tri[0].p), sub(tri[2].p, tri[0].p));
    if (oneBone && dot(face(), tri[0].n) * FRONT < 0) count.turned++;
  }
}

/** One submodel: how much of it there is against what the engine holds, its bones, and each of its meshes. */
function checkModel(src, { info, refs, engine, model, corners, where }, report, count) {
  const { errors, warnings } = report;
  const limits = LIMITS[engine];
  const boneCount = info.bones.length;
  if (model.numverts > limits.verts)
    errors.push(`${where}: ${model.numverts} points: ${engine} holds ${limits.verts} a submodel`);
  if (model.numnorms > limits.verts)
    errors.push(`${where}: ${model.numnorms} normals: ${engine} holds ${limits.verts} a submodel`);
  if (engine === "xash" && corners > limits.verts)
    errors.push(`${where}: ${corners} corners to draw: Xash holds ${limits.verts} a submodel`);
  else if (engine === "xash" && corners > limits.verts * NEAR_LIMIT)
    warnings.push(`${where}: ${corners} corners to draw, near Xash's ${limits.verts}`);
  if (model.meshes.length > limits.meshes)
    errors.push(`${where}: ${model.meshes.length} meshes: the engine holds ${limits.meshes}`);
  // the first point, and the first normal, on a bone the model has not
  const vertBones = src.readInt32LE(model.at + MODEL_VERTINFOINDEX);
  const normBones = src.readInt32LE(model.at + MODEL_NORMINFOINDEX);
  for (let i = 0; i < model.numverts; i++)
    if (src[vertBones + i] >= boneCount) {
      errors.push(`${where}: a point on bone ${src[vertBones + i]}, and there are ${boneCount}`);
      break;
    }
  for (let i = 0; i < model.numnorms; i++)
    if (src[normBones + i] >= boneCount) {
      errors.push(`${where}: a normal on bone ${src[normBones + i]}, and there are ${boneCount}`);
      break;
    }
  let normsBefore = 0;
  model.meshes.forEach((mesh, q) => {
    checkMesh(src, { info, refs, model, mesh, normsBefore, where: `${where} mesh ${q}` }, report, count);
    normsBefore += mesh.numnorms;
  });
}

/** The animations kept in the file: each has frames, and can be read to its last one in every blend. */
function checkSequences(src, seqs, { errors }) {
  for (const [q, s] of seqs.entries()) {
    if (s.group) continue;
    if (s.frames < 1) errors.push(`the animation ${s.name} has no frames`);
    try {
      for (let blend = 0; blend < s.blends; blend++) frameValues(src, q, Math.max(0, s.frames - 1), blend);
    } catch {
      errors.push(`the animation ${s.name} cannot be read to its last frame`);
    }
  }
}

/**
 * The events on frames their animation has not. The engine looks an animation's events up by the frames it
 * passed since it last looked (the SDK's GetAnimationEvent on the server and StudioProcessEvents in the client,
 * from memory of them): the frames run from 0 to frames - 1, so an event on frame `frames` or after, or under
 * 0, is never passed and never fires. The model loads, and the sound or the swing's hit is never heard.
 */
function checkEvents(src, seqs, { warnings }) {
  const off = [];
  seqs.forEach((s, q) => {
    for (const e of events(src, q))
      if (e.frame < 0 || e.frame >= Math.max(1, s.frames))
        off.push(`${s.name}'s event ${e.event} on frame ${e.frame} of ${Math.max(1, s.frames)}`);
  });
  if (off.length)
    warnings.push(
      `${off.length} events are on frames their animation has not (${some(off)}): the engine fires an event as the animation passes its frame, numbered from 0 to the count less one, so these never fire`,
    );
}

/** The angle between two bones' turns (the 3 by 3 of their matrices), in degrees. */
function degreesBetween(a, b) {
  let trace = 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) trace += a[r][c] * b[r][c];
  return (Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2))) * 180) / Math.PI;
}
/**
 * The looping animations that do not come back to where they start: a bone that is somewhere else in the
 * last frame than in the first.
 * How the engine plays one is in the Half-Life SDK's renderer (StudioEstimateFrame, StudioModelRenderer.cpp,
 * from memory of it): the frame it draws runs from 0 up to frames - 1 and, for a looping sequence, is taken
 * modulo frames - 1. So the last frame is the same moment as the first: it is blended towards and never
 * rested on, and the next thing drawn is the first frame. A last frame that is not the first again is a
 * jump once a turn. The compiler does nothing about it (studiomdl writes the frames it is given, as far as
 * its source is remembered), and the games' own files bear the rule out: see SEAM_UNITS.
 */
function checkLoops(src, seqs, names, { warnings }) {
  // each bone as a root of its own: boneMatrices then gives its own matrix, not the chain's
  const alone = names.map(() => ({ parent: -1 }));
  for (const [q, s] of seqs.entries()) {
    if (!s.loops || s.group || s.frames < 2) continue;
    let worst = null;
    try {
      for (let blend = 0; blend < s.blends; blend++) {
        const first = frameValues(src, q, 0, blend);
        const last = frameValues(src, q, s.frames - 1, blend);
        const turnsFirst = boneMatrices(alone, first);
        const turnsLast = boneMatrices(alone, last);
        first.forEach((values, i) => {
          const units = Math.hypot(...[0, 1, 2].map((axis) => values[axis] - last[i][axis]));
          const degrees = degreesBetween(turnsFirst[i], turnsLast[i]);
          const over = Math.max(units / SEAM_UNITS, degrees / SEAM_DEGREES);
          if (over > 1 && over > (worst?.over ?? 0)) worst = { over, units, degrees, bone: names[i] };
        });
      }
    } catch {
      // an animation that cannot be read is checkSequences' to tell
      continue;
    }
    if (worst)
      warnings.push(
        `the looping animation ${s.name} does not come back to where it starts: in its last frame ${worst.bone} is ${worst.units.toFixed(2)} units and ${worst.degrees.toFixed(1)} degrees from where it is in the first. The engine plays a looping animation up to its last frame and begins again at the first, taking the two for the same moment, so the difference shows as a jerk every time round: make the last frame a copy of the first`,
      );
  }
}

/**
 * What a monster has beyond a prop: hit boxes, attachments and bone controllers on bones the model has, and
 * each animation's box. `drawn`: whether the model has any triangle to draw.
 */
function checkParts(src, seqs, names, drawn, { errors, warnings, facts }) {
  const boneCount = names.length;
  // each of these names a bone by its number, and the engine takes that bone's matrix without asking
  // whether it has one
  const onBones = [
    ["hit box", hitboxes(src)],
    ["attachment", attachments(src)],
    ["bone controller", boneControllers(src)],
  ];
  for (const [what, list] of onBones)
    list.forEach((item, i) => {
      if (item.bone < 0 || item.bone >= boneCount)
        errors.push(
          `${what} ${i} is on bone ${item.bone}, and the model has ${boneCount}: the engine would read a bone that is not there`,
        );
    });
  // That a shot is traced against the entity's own box when there are no hit boxes is from memory of the
  // engine (SV_HullForStudioModel falls back to the entity's hull), not tried in the game: a note, no more.
  const travelling = seqs
    .filter((sequence) => sequence.movement.some((v) => v))
    .map((sequence) => sequence.name);
  if (!onBones[0][1].length && travelling.length)
    facts.push(
      `it has no hit boxes: traces against it use the entity's box (and ${travelling.length} of its animations travel, ${some(travelling)}: a thing that walks is usually a thing that is shot at; autoHitboxes makes them)`,
    );
  // The engine decides whether a model is in view by the box of the animation it is playing (from memory
  // of the renderer's R_StudioCheckBBox, which Xash's source also has); studiomdl always fills it.
  const boxless = seqs
    .filter((sequence) => sequence.bbmin.every((v, axis) => v === sequence.bbmax[axis]))
    .map((sequence) => sequence.name);
  if (drawn && boxless.length)
    warnings.push(
      `${boxless.length} animations have a box of no size (${some(boxless)}): their bbmin and bbmax are the same point, and the engine decides by that box whether the model is in view, so it can vanish while part of it is still on the screen. replaceSequence with an animation's own frames measures its box again`,
    );
}

/**
 * Each bodypart's `base`: what a body number is divided by to pick its submodel. The engine's renderer
 * (R_StudioSetupModel; Xash's ref/gl/gl_studio.c has the same two lines) takes
 *   index = body / bodypart->base;   index = index % bodypart->nummodels;
 * and a compiler writes for `base` the product of the counts of the bodyparts before (`basesByRule`), so
 * that every pairing of submodels has one number. A base of 0 is a division by nothing. Another base than
 * the rule's still draws, and some submodel of each bodypart: but the body numbers no longer mean what the
 * counts say (a submodel added to an earlier bodypart also turns this one, or cannot be shown with every
 * one of this one's), so it is told, and plainly when this bodypart has one submodel only and so nothing
 * to turn.
 */
function checkBases(src, info, { errors, warnings }) {
  const rule = basesByRule(src);
  info.bodyparts.forEach((bodypart, i) => {
    if (bodypart.base < 1)
      errors.push(
        `the bodypart ${bodypart.name} has base ${bodypart.base}: the engine divides the body number by it`,
      );
    else if (bodypart.base !== rule[i])
      warnings.push(
        `the bodypart ${bodypart.name} has base ${bodypart.base}, and the bodyparts before it have ${rule[i]} pairings of submodels (${info.bodyparts
          .slice(0, i)
          .map((before) => before.models.length)
          .join(" x ")}): the engine picks its submodel as floor(body / base) % ${bodypart.models.length}, so its base is to be ${rule[i]}${
          bodypart.models.length === 1
            ? "; it has one submodel, so every body number still shows it, and the fault waits for its second"
            : ": as it is, body numbers show other submodels of it than their counts say"
        } (a submodel was added to an earlier bodypart by a tool that left this number; addModel raises it)`,
      );
  });
}

/**
 * Everything `check` looks at once the file's tables have been read (`info`), written into `report`. It
 * throws a RangeError when something in the file points past its end.
 */
function inspect(src, engine, info, report) {
  const limits = LIMITS[engine];
  const { errors, warnings, facts } = report;
  if (src.readInt32LE(HDR_LENGTH) !== src.length)
    errors.push(`the file says it is ${src.readInt32LE(HDR_LENGTH)} bytes long and is ${src.length}`);
  if (!isEngineLayout(src))
    errors.push(
      "the texture table does not come before the textures, or they are not in its order: a dedicated server (HLDS, ReHLDS) reads it wrongly and dies on a change of level. Pass the model through engineLayout before writing it",
    );
  const boneCount = info.bones.length;
  const seqs = sequences(src);
  const families = skinFamilies(src);
  const refs = families[0]?.length ?? 0;
  if (boneCount > limits.bones) errors.push(`${boneCount} bones: the engine holds ${limits.bones}`);
  if (!boneCount) warnings.push("no bones");
  bones(src).forEach((bone, i) => {
    if (bone.parent >= i) errors.push(`the bone ${bone.name} hangs from a bone that comes after it`);
  });
  // the compiler's own limits, which models in use are known to pass: told, not refused. For Xash, whose
  // source says there is no such limit, it is a fact and no warning
  if (info.textures.length > limits.textures)
    (engine === "goldsrc" ? warnings : facts).push(
      `${info.textures.length} textures, more than ${limits.textures}: ${TEXTURES_READ[engine]}`,
    );
  if (info.bodyparts.length > limits.bodyparts)
    errors.push(`${info.bodyparts.length} bodyparts: the engine holds ${limits.bodyparts}`);
  if (seqs.length > limits.sequences)
    warnings.push(
      `${seqs.length} animations: more than the ${limits.sequences} the engine's header allows for; try it in the game`,
    );
  if (!seqs.length) warnings.push("no animation: the engine expects one at least");
  const elsewhere = seqs.filter((s) => s.group);
  if (elsewhere.length)
    warnings.push(
      `${elsewhere.length} animations are kept in other files (name01.mdl...): they cannot be read or changed here, and the engine finds them by this file's own name, so a copy under a new name needs them copied under it too (barney_olive.mdl takes barney_olive01.mdl...)`,
    );
  if (!info.textures.length && info.bodyparts.some((bp) => bp.models.some((m) => m.meshes.length)))
    warnings.push(
      "its textures are kept in another file (the same name with a t before .mdl): put them inside with withTextures before working on it",
    );
  checkTextures(src, info, engine, report, report.sourceTextures);

  checkBases(src, info, report);

  // the submodels, in the order drawnCorners lists them
  const drawn = drawnCorners(src);
  const count = { total: 0, turned: 0 };
  let nth = 0;
  for (const bodypart of info.bodyparts) {
    if (!bodypart.models.length)
      errors.push(
        `the bodypart ${bodypart.name} has no submodel: the engine divides a body number by their count, and stops on none`,
      );
    if (bodypart.models.length > limits.models)
      facts.push(
        `${bodypart.name}: ${bodypart.models.length} submodels, more than the compiler's ${limits.models} (models in use have as many)`,
      );
    for (const model of bodypart.models) {
      const corners = drawn[nth++].corners;
      const where = `${bodypart.name}/${model.name}`;
      checkModel(src, { info, refs, engine, model, corners, where }, report, count);
    }
  }
  if (count.total && count.turned / count.total > TURNED_SHARE)
    warnings.push(
      `${count.turned} of ${count.total} triangles look the other way from their normals: right for a sheet seen from both sides (a leaf, a cloth), wrong for a solid, which would be seen from inside`,
    );
  checkSequences(src, seqs, report);
  checkEvents(src, seqs, report);
  checkLoops(src, seqs, info.bones, report);
  checkParts(src, seqs, info.bones, count.total > 0, report);
  facts.push(
    `${src.length} bytes, ${boneCount} bones, ${info.textures.length} textures, ${seqs.length} animations, ${info.bodyparts.length} bodyparts, ${count.total} triangles in all`,
  );
  checkForm(src, info, report);
  checkMotion(src, seqs, report);
  const heaviest = [...drawn].sort((a, b) => b.corners - a.corners)[0];
  if (heaviest) facts.push(`the heaviest submodel is ${heaviest.name}: ${heaviest.corners} corners drawn`);
}

/** Fewer triangles than this are no form to judge (a plane, a sprite card, a single leaf). */
const FORM_LEAST_TRIANGLES = 8;
/**
 * The model's form held against the game's own (form.mjs): a WARNING when it is boxier than 19 of 20 of the
 * game's models of its kind. `kind`: "props", "vehicles" or "creatures", else from the file's name. A
 * model under 8 triangles, or with no bones drawn, is passed over.
 */
function checkForm(src, info, report) {
  const { name, kind } = report.form ?? {};
  if (kind === false || info.bodyparts.every((bp) => bp.models.every((m) => !m.meshes.length))) return;
  let form;
  try {
    form = formOfMdl(src);
  } catch {
    return; // a model too broken to draw has its errors said already
  }
  if (form.counts.triangles < FORM_LEAST_TRIANGLES || form.measures.boxiness === null) return;
  const m = form.measures;
  report.facts.push(`form: ${Math.round(m.axisAligned * 100)}% of the surface on the axes, ${Math.round(m.sharpEdges * 100)}% of its creases bare edges, ${m.outline} silhouette corners, boxiness ${m.boxiness} (0 round, 1 a crate)`); // prettier-ignore
  const judged = judgeForm(m, kind ?? kindOfName(name ?? modelName(src)));
  report.warnings.push(...judged.warnings);
}

/** An animation under this many frames has no motion to judge. */
const MOTION_LEAST_FRAMES = 3;
/**
 * The motion of every animation kept in the file held to the hard faults of motion.mjs (pops, jitter, flips, a joint
 * past its range, lockstep, a stall, a tail still moving, foot slide), as WARNINGS grouped by fault: one line a kind,
 * naming the first few animations with their frame and bone and counting the rest, with what to do. The loop's seam
 * is checkLoops' to say; parts through each other and the feet's slide are the costly measures, left to `smak motion`.
 * `check(src, engine, { motion: false })` leaves it out.
 */
function checkMotion(src, seqs, report) {
  if (report.motion === false) return;
  const byKind = new Map();
  seqs.forEach((s, q) => {
    if (s.group || s.frames < MOTION_LEAST_FRAMES) return;
    let judged;
    try {
      judged = judgeMotion(motionOf(src, { seq: q, overlaps: false, slide: false }));
    } catch {
      return; // an animation that cannot be read is checkSequences' to tell
    }
    for (const f of judged.found) {
      if (f.key === "seam") continue;
      const at = [s.name, f.frame !== null ? `frame ${f.frame}` : null, f.bone].filter(Boolean).join(" ");
      if (!byKind.has(f.key)) byKind.set(f.key, []);
      byKind.get(f.key).push(at);
    }
  });
  for (const [key, list] of byKind) {
    const [what, todo] = MOTION_SAID[key] ?? [key, ""];
    report.warnings.push(`motion: ${what} in ${list.length} animation${list.length === 1 ? "" : "s"} (${some(list)}): ${todo}; smak motion <mdl> --seq <name> --draw <png> shows it`);
  }
}

/** What is said of a file in which something points past its end. */
const cutShort = (src) =>
  `the file is cut short or broken: something in it points past its end (it is ${src.length} bytes long)`;

/**
 * Returns { errors, warnings, facts }, each a list of sentences. A file that is cut short or broken is
 * reported as an error like any other: nothing is thrown for what is wrong with the model.
 * `source`: the file this one was made from (the game's own, for a re-skin). A warning that it has too is then
 * begun with INHERITED ("inherited from the source: "), and textures it has at the same name and size are
 * said apart from this file's own; `inherited` counts those warnings. `kind`: the form's (false for none); `motion: false`
 * leaves the motion judgement out.
 */
export function check(src, engine = "goldsrc", { source, sourceTextures, name, kind, motion } = {}) {
  if (!LIMITS[engine]) throw new Error(`engine: ${Object.keys(LIMITS).join(", ")}, not ${engine}`);
  if (source) return withSource(check(src, engine, { sourceTextures: texturesOf(source), name, kind, motion }), check(source, engine, { name, kind, motion }));
  const errors = [];
  const warnings = [];
  const facts = [];
  const report = { errors, warnings, facts };
  // (from `withSource`: the textures of the file this one was made from, by name and size)
  if (sourceTextures) report.sourceTextures = sourceTextures;
  report.form = { name, kind };
  report.motion = motion;
  let info;
  try {
    info = readMdl(src);
  } catch (e) {
    return { errors: [e instanceof RangeError ? cutShort(src) : e.message], warnings, facts };
  }
  try {
    inspect(src, engine, info, report);
  } catch (e) {
    // a read past the end of the file is the file's fault; anything else is the kit's, and is not hidden
    if (!(e instanceof RangeError)) throw e;
    errors.push(cutShort(src));
  }
  delete report.sourceTextures;
  delete report.form;
  delete report.motion;
  return report;
}

/** What starts a warning that the file it was made from has too (`check`'s `source`). */
export const INHERITED = "inherited from the source: ";
/** A model's textures as "name WxH", as `checkTextures` lists them; none for a file that cannot be read. */
function texturesOf(source) {
  try {
    return new Set(readMdl(source).textures.map((t) => `${t.name} ${t.width}x${t.height}`));
  } catch {
    return new Set();
  }
}
/**
 * A report with the warnings the source's own report has word for word marked as inherited, and `inherited`,
 * how many warnings are so marked (the source's textures kept at their size were told apart already).
 */
function withSource(report, ofSource) {
  const theirs = new Set(ofSource.warnings);
  const warnings = report.warnings.map((warning) =>
    !warning.startsWith(INHERITED) && theirs.has(warning) ? INHERITED + warning : warning,
  );
  return { ...report, warnings, inherited: warnings.filter((w) => w.startsWith(INHERITED)).length };
}
