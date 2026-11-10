// What a point entity is drawn as, at its true size: the box it moves with, or its model. A dot on a plan
// and a small box in a view say where a thing is and nothing of whether it fits there; a box 32 by 32 by 72
// that stands on the floor, or goes into it, does.
//
//   the box     a place to start and anything that walks (a monster, an NPC) gets the box of a standing
//               player, or the one `bodies` names for it (space.mjs: `bodyFor`). It costs nothing
//   the model   with `models` and the game's `folders`: an entity that names a `.mdl` (its `model` key) is
//               drawn as that model, and so is one `models` names a file for. The model is read from the
//               game's folders and stood where the entity is, as the entity's own keys say: `angles` (all
//               three), `body`, `skin`, `sequence` (and `frame`: the first unless told), `scale`. Each
//               triangle wears its texture; a masked texture's holes are holes (a tree's crown is leaves and
//               air, not a blob), an additive one is added to what is behind it
//
// A model is drawn with its own origin at the entity's FEET (for a place to start: 36 under its origin).
// Whether the game stands it just there (it may drop it to the floor) is for the game to show, and so is
// what a script makes of it afterwards: another body, another animation.
import { statSync } from "node:fs";
import { posed, TEXTURE } from "../render.mjs";
import { sequences } from "../../core/mdl.mjs";
import { readStudio } from "../../core/studio-file.mjs";
import { FRONT } from "../mesh.mjs";
import { bytesOf } from "../../core/pixels.mjs";
import { sub, dot, cross } from "../../core/vec.mjs";
import { bodyFor } from "./space.mjs";
import { inFolders } from "./files.mjs";

/** A model with more triangles than this is drawn as the box about it: a tree of 20000 is no help. */
const TRIANGLES_MOST = 12000;
/** The colour of a model's triangle whose texture is not to be had. */
const NO_TEXTURE = [150, 150, 150];
/** In a masked texture, the palette index that is a hole. */
const HOLE_INDEX = 255;
const DEGREES = Math.PI / 180;

/**
 * A model's texture as the map drawing reads one (draw.mjs): its one size, its palette, whether index 255 is
 * a hole, and its mean colour with the holes left out. `additive`: it is added to what is behind it;
 * `fullbright`: no light falls on it. A chrome texture has no place of its own on a triangle (the engine
 * takes it from the way the surface faces the eye): it is drawn as its mean colour.
 */
function textureOf(bytes, texture) {
  const { pixels, palette } = bytesOf(bytes, texture);
  const holes = Boolean(texture.flags & TEXTURE.masked);
  const sum = [0, 0, 0];
  let counted = 0;
  for (const index of pixels) {
    if (holes && index === HOLE_INDEX) continue;
    for (let channel = 0; channel < 3; channel++) sum[channel] += palette[index * 3 + channel];
    counted++;
  }
  const mean = sum.map((value) => Math.round(value / Math.max(1, counted)));
  const chrome = Boolean(texture.flags & TEXTURE.chrome);
  return {
    name: texture.name,
    levels: chrome ? null : [{ width: texture.width, height: texture.height, pixels }],
    palette,
    holes,
    flat: chrome ? mean : null,
    mean,
    additive: Boolean(texture.flags & TEXTURE.additive),
    fullbright: Boolean(texture.flags & (TEXTURE.fullbright | TEXTURE.additive)),
  };
}
/** The stand-in for a mesh with no texture. */
const PLAIN = {
  name: "",
  levels: null,
  palette: null,
  holes: false,
  flat: NO_TEXTURE,
  mean: NO_TEXTURE,
  additive: false,
  fullbright: false,
};

/** The models read so far, by their file: read again only when the file has changed. */
const files = new Map();

/**
 * A model of the game's folders, read once: `{ file, bytes, textures (a Map, filled as they are asked for),
 * shapes (the same, by pose) }`; or `{ file: null, why }` when it is not found or cannot be read.
 */
function modelOf(name, folders) {
  const file = inFolders(folders, name);
  if (!file) return { file: null, why: `${name} is in none of the folders given` };
  const stamp = statSync(file).mtimeMs;
  const kept = files.get(file);
  if (kept?.stamp === stamp) return kept;
  let made;
  try {
    // a model whose textures are in a file of their own, `name`t.mdl beside it, read with them
    const bytes = readStudio(file).src;
    made = { file, stamp, bytes, textures: new Map(), shapes: new Map() };
    shapeOf(made, {});
  } catch (error) {
    made = { file: null, stamp, why: `${name} could not be read: ${error.message}` };
  }
  files.set(file, made);
  return made;
}

/**
 * A model in one pose, about its own origin and facing +x: `{ triangles: [{ points, uv, texture }], min, max,
 * said }`. `pose`: `{ body, skin, sequence, frame }` as an entity's keys give them; an animation or a skin
 * the model does not have is its first, and `said` says so.
 */
function shapeOf(model, { body = 0, skin = 0, sequence = 0, frame = 0 }) {
  const key = [body, skin, sequence, frame].join(" ");
  if (model.shapes.has(key)) return model.shapes.get(key);
  const said = [];
  const list = sequences(model.bytes);
  let seq = sequence;
  if (list.length && !(Number.isInteger(seq) && seq >= 0 && seq < list.length)) {
    said.push(`it has no animation ${sequence} (it has ${list.length}): its first is drawn`);
    seq = 0;
  }
  const { tris } = posed(model.bytes, { seq, frame, body, skin });
  const triangles = tris.map((triangle) => {
    const texture = triangle.tex;
    if (texture && !model.textures.has(texture)) model.textures.set(texture, textureOf(model.bytes, texture));
    return {
      points: triangle.c.map((corner) => corner.p),
      uv: triangle.c.map((corner) => [corner.u, corner.v]),
      texture: model.textures.get(texture) ?? PLAIN,
    };
  });
  const points = triangles.flatMap((triangle) => triangle.points);
  if (!points.length) throw new Error("it has no triangle");
  const shape = {
    triangles,
    min: [0, 1, 2].map((axis) => points.reduce((least, point) => Math.min(least, point[axis]), Infinity)),
    max: [0, 1, 2].map((axis) => points.reduce((most, point) => Math.max(most, point[axis]), -Infinity)),
    said,
  };
  model.shapes.set(key, shape);
  return shape;
}

/**
 * The matrix that turns a model as the engine turns one by an entity's `angles` (`[pitch, yaw, roll]` in
 * degrees): three rows of three. It is the engine's own arithmetic (`AngleMatrix`), with the pitch turned
 * about first as the engine does for a model and for nothing else: a pitch over 0 lifts a model's front.
 */
export function turnOf([pitch = 0, yaw = 0, roll = 0]) {
  const [sp, cp] = [Math.sin(-pitch * DEGREES), Math.cos(-pitch * DEGREES)];
  const [sy, cy] = [Math.sin(yaw * DEGREES), Math.cos(yaw * DEGREES)];
  const [sr, cr] = [Math.sin(roll * DEGREES), Math.cos(roll * DEGREES)];
  return [
    [cp * cy, sr * sp * cy - cr * sy, cr * sp * cy + sr * sy],
    [cp * sy, sr * sp * sy + cr * cy, cr * sp * sy - sr * cy],
    [-sp, sr * cp, cr * cp],
  ];
}

/**
 * A triangle of a model in the world as a surface the map drawing fills (draw.mjs): its plane as seen from
 * its front (the side the game draws), and the two axes that give a point's place on its texture, worked
 * out from its corners' own. Null for a triangle with no area.
 */
function surfaceOf(points, uv, texture) {
  const [a, b, c] = points;
  const one = sub(b, a);
  const two = sub(c, a);
  let normal = cross(one, two);
  const length = Math.hypot(...normal);
  if (!(length > 0)) return null;
  normal = normal.map((value) => (value * FRONT) / length);
  // the place on the texture is `axis . p + axis[3]`, and the axis lies in the triangle's plane: it is some
  // of one side and some of the other, found from what it has to be at the three corners
  const oneOne = dot(one, one);
  const oneTwo = dot(one, two);
  const twoTwo = dot(two, two);
  const size = oneOne * twoTwo - oneTwo * oneTwo;
  const axisOf = (which) => {
    if (!texture.levels || !(size > 0)) return [0, 0, 0, 0];
    const alongOne = uv[1][which] - uv[0][which];
    const alongTwo = uv[2][which] - uv[0][which];
    const first = (alongOne * twoTwo - alongTwo * oneTwo) / size;
    const second = (alongTwo * oneOne - alongOne * oneTwo) / size;
    const axis = [0, 1, 2].map((each) => one[each] * first + two[each] * second);
    return [...axis, uv[0][which] - dot(axis, a)];
  };
  return { polygon: points, normal, dist: dot(normal, a), sAxis: axisOf(0), tAxis: axisOf(1), texture };
}

/** A number of an entity's keys, or `otherwise` when it is not one. */
const numberFrom = (value, otherwise) => (Number.isFinite(Number(value ?? NaN)) ? Number(value) : otherwise);

/**
 * What each point entity is drawn as. `things`: `[{ number, classname, targetname, origin, yaw, angles,
 * modelFile, script, pose }]`, as the drawing reads a map's entities; `pose` is `{ body, skin, sequence,
 * frame, scale }` from the entity's own keys.
 *
 *   bodies      `{ name: "large" | "standing" | "crouching" | { half, height, feet } }`, by classname or
 *               targetname (`bodyFor`)
 *   models      false (unless told): boxes only. true: an entity whose `model` key names a `.mdl` is drawn as
 *               it. `{ name: "models/monsters/boar1.mdl" }`: these too, the name a targetname, a
 *               `scriptfile` or a classname (looked for in that order)
 *   modelsBy    `{ number: "models/x.mdl" }`: the model of an entity by its number, where nothing above
 *               names one (what a mod's profile gives, `modelsOf`); only with `models`
 *   folders     the game's folders, the mod's own first (`.../msc`, `.../valve`): where the models are
 *   modelScale  false: a model is drawn at its own size whatever the entity's `scale` says. The engine's own
 *               drawing does not scale a model; a mod's may (Master Sword's does), which is why `scale` is
 *               honoured unless told
 *
 * It returns `{ figures, notes }`. `figures` is a Map from an entity's number to
 *   { min, max      the box about it in the world
 *     body          the box it moves with (`bodyFor`), or null
 *     surfaces      its model's triangles in the world, each a surface the drawing fills (`{ polygon, normal,
 *                   dist, sAxis, tAxis, texture }`); null when it is drawn as a box
 *     triangles     the same as `[{ points, colour }]`, the colour its texture's mean: for a picture of
 *                   your own
 *     corners       its model's box as four corners in plan, turned the way it faces; null with no model
 *     file          the model's file, or null
 *     pose }        `{ body, skin, sequence, frame, scale, angles }` as it was drawn; null with no model
 * An entity with neither a body nor a model has no figure. `notes`: sentences on the models not found, and
 * on the keys a model could not follow.
 */
export function figuresOf(
  things,
  { bodies = {}, models = false, modelsBy = {}, folders = [], modelScale = true } = {},
) {
  const figures = new Map();
  const notes = [];
  const missing = new Set();
  const said = new Set();
  const names = models && typeof models === "object" ? models : {};
  for (const thing of things) {
    if (thing.model !== null || !thing.origin) continue;
    const stands = bodyFor(thing.classname, thing.targetname, bodies);
    let name = null;
    if (models) {
      name = names[thing.targetname] ?? names[thing.script] ?? names[thing.classname] ?? null;
      name ??= modelsBy?.[thing.number] ?? null;
      if (!name && /\.mdl$/i.test(thing.modelFile ?? "")) name = thing.modelFile;
    }
    const model = name ? modelOf(name, folders) : null;
    if (model && !model.file) missing.add(model.why);
    if (!stands && !model?.file) continue;
    const figure = {
      min: stands ? stands.mins.map((value, axis) => thing.origin[axis] + value) : null,
      max: stands ? stands.maxs.map((value, axis) => thing.origin[axis] + value) : null,
      body: stands,
      surfaces: null,
      triangles: null,
      corners: null,
      file: null,
      pose: null,
    };
    if (model?.file) {
      const pose = {
        body: Math.max(0, Math.trunc(numberFrom(thing.pose?.body, 0))),
        skin: Math.max(0, Math.trunc(numberFrom(thing.pose?.skin, 0))),
        sequence: Math.trunc(numberFrom(thing.pose?.sequence, 0)),
        frame: Math.max(0, numberFrom(thing.pose?.frame, 0)),
      };
      const asked = numberFrom(thing.pose?.scale, 0);
      const scale = modelScale && asked > 0 ? asked : 1;
      const angles = thing.angles ?? [0, thing.yaw ?? 0, 0];
      const turn = turnOf(angles);
      let shape;
      try {
        shape = shapeOf(model, pose);
      } catch (error) {
        said.add(`${name}: ${error.message}; drawn as it is with no key set`);
        shape = shapeOf(model, {});
      }
      for (const each of shape.said) said.add(`${name}: ${each}`);
      const feet = thing.origin[2] - (stands?.feet ?? 0);
      const base = [thing.origin[0], thing.origin[1], feet];
      const inWorld = (point) => turn.map((row, axis) => base[axis] + dot(row, point) * scale);
      figure.file = model.file;
      figure.pose = { ...pose, scale, angles };
      // the box about it: the corners of the model's own box, turned
      const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((corner) =>
        inWorld([0, 1, 2].map((axis) => ((corner >> axis) & 1 ? shape.max : shape.min)[axis])),
      );
      figure.min = [0, 1, 2].map((axis) => Math.min(...corners.map((corner) => corner[axis])));
      figure.max = [0, 1, 2].map((axis) => Math.max(...corners.map((corner) => corner[axis])));
      figure.corners = [
        [shape.min[0], shape.min[1]],
        [shape.max[0], shape.min[1]],
        [shape.max[0], shape.max[1]],
        [shape.min[0], shape.max[1]],
      ].map((corner) => inWorld([...corner, 0]));
      if (shape.triangles.length <= TRIANGLES_MOST) {
        figure.surfaces = [];
        figure.triangles = [];
        for (const triangle of shape.triangles) {
          const points = triangle.points.map(inWorld);
          const surface = surfaceOf(points, triangle.uv, triangle.texture);
          if (!surface) continue;
          figure.surfaces.push(surface);
          figure.triangles.push({ points, colour: triangle.texture.mean });
        }
      }
    }
    figures.set(thing.number, figure);
  }
  if (models && !folders.length)
    notes.push("models were asked for and no folders were given: every entity is drawn as its box");
  if (missing.size)
    notes.push(`${missing.size} models were not drawn: ${[...missing].slice(0, 6).join("; ")}`);
  if (said.size)
    notes.push(
      `${said.size} models could not follow their entity's keys: ${[...said].slice(0, 6).join("; ")}`,
    );
  return { figures, notes };
}
