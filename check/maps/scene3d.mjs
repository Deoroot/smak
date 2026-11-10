// A map as a scene for a page that draws in 3D (the map viewer, `smak map-viewer`), and the things standing
// in it checked against the world (`smak map-props`): which stand in a wall, hang over the floor, or face a
// wall at their nose.
//
//   sceneOf3d(map, options)   the world's faces and every point entity's model or box, as plain numbers
//                             grouped by texture, with the textures and a compiled map's light as pictures
//   propsOf(map, options)     each point entity that has a model or a body: its box, what is solid in it,
//                             the gap under it, how far it stands from a wall in front, behind and aside
//
// A compiled map's (.bsp) faces are drawn as the game draws them, with their lightmaps packed into one
// picture; brush source (.map, what `writeMap` takes) is drawn from its brushes' faces, unlit, with the
// textures of the .wad files its worldspawn lists or the game's folders hold. Tools' textures (clip, origin,
// trigger) come in a batch of their own, for the page to show or hide.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import {
  CONTENTS,
  LUXEL,
  contentsAt,
  facePolygon,
  faceNormal,
  faceLightmap,
  embeddedTexture,
} from "../../core/maps/bsp.mjs";
import { textureKind, HOLE } from "../../core/maps/miptex.mjs";
import { texturesFor, readWad, textureFromWad, listedWads } from "../../core/maps/wad.mjs";
import { shapeOf, planesOf } from "../../make/maps/source.mjs";
import { figuresOf } from "../../make/maps/figures.mjs";
import { stylesCounted } from "./light.mjs";
import { withMod } from "../../make/maps/mod.mjs";
import { thingsOf } from "./draw.mjs";

// ── constants ───────────────────────────────────────────────────────────────
/** The lightmaps' picture is this wide; it grows down as they are packed. Each lightmap keeps a pixel apart. */
const ATLAS_WIDTH = 1024;
const ATLAS_GAP = 1;
/** A thing's box is looked into this far from its sides before what is solid in it counts (units). */
const INSET = 4;
/** Points a side of a thing's box is looked at, for what is solid in it. */
const SAMPLES = 4;
/**
 * Over this share of a thing's box in solid, it is told: a thing that walks is stuck, a prop partly in a wall;
 * over BURIED a prop is buried.
 */
const IN_SOLID = 0.08;
const BURIED = 0.5;
/** A thing whose box hangs more than this over the floor everywhere under it floats (units). */
const FLOATS = 4;
/** How far down from a thing the floor is looked for, and how far round it a wall (units). */
const FLOOR_REACH = 128;
const WALL_REACH = 512;
/** Steps of the walk out to a wall (units). */
const WALL_STEP = 2;
/** A thing with a wall nearer than this at its nose, and room behind it, may face the wrong way (units). */
const NOSE_TO_WALL = 16;
const ROOM_BEHIND = 48;
/** A thing thinner than this one way is laid against a wall, not buried in it (units). */
const THIN = 16;
/** Classes of items a game lets fall to the floor as they spawn (a chest, a weapon on the ground). */
const DROPPED = /(item|treasure|weapon_|ammo_|chest)/i;
/** A thing with a side this near a wall hangs on it, and does not float (units). */
const ON_WALL = 8;
/** The share of that side that has to have wall behind it. */
const HUNG = 0.6;
/** Classes whose way they face says nothing: lights, sounds, sprites, info markers. */
const NO_FACING =
  /^(light|ambient_|env_sound|env_sprite|env_glow|info_target|info_null|info_texlights|path_|multi_|trigger_|game_)/i;

// ── textures ────────────────────────────────────────────────────────────────
/**
 * The textures a scene uses, each once: `add(texture)` gives its number. A texture is what the drawing
 * reads (`{ name, levels, palette, holes, flat }`) or a .wad's (`{ name, width, height, pixels, palette }`).
 */
function textureList() {
  const list = [];
  const numbers = new Map();
  const add = (texture) => {
    if (numbers.has(texture)) return numbers.get(texture);
    const pixels = texture.levels?.[0]?.pixels ?? texture.pixels ?? null;
    const width = texture.levels?.[0]?.width ?? texture.width ?? 8;
    const height = texture.levels?.[0]?.height ?? texture.height ?? 8;
    const holes = texture.holes ?? textureKind(texture.name ?? "").holes;
    list.push({ name: texture.name ?? "", width, height, pixels, palette: texture.palette ?? null, holes, flat: texture.flat ?? texture.mean ?? null }); // prettier-ignore
    numbers.set(texture, list.length - 1);
    return list.length - 1;
  };
  return { list, add };
}

/** A texture of the list as RGBA, for a PNG: a flat one is 8 by 8 of its colour; holes are see-through. */
export function sceneTextureRgba(entry) {
  if (!entry.pixels || !entry.palette) {
    const colour = entry.flat ?? [128, 128, 128];
    const rgba = new Uint8Array(8 * 8 * 4);
    for (let at = 0; at < 64; at++) rgba.set([...colour, 255], at * 4);
    return { width: 8, height: 8, rgba };
  }
  const { width, height, pixels, palette, holes } = entry;
  const rgba = new Uint8Array(width * height * 4);
  for (let at = 0; at < width * height; at++) {
    const index = pixels[at];
    rgba[at * 4] = palette[index * 3];
    rgba[at * 4 + 1] = palette[index * 3 + 1];
    rgba[at * 4 + 2] = palette[index * 3 + 2];
    rgba[at * 4 + 3] = holes && index === HOLE ? 0 : 255;
  }
  return { width, height, rgba };
}

/** A colour for a texture with no picture, from its name: the same name, the same colour. */
function colourOfName(name) {
  let hash = 2166136261;
  for (const char of String(name).toLowerCase()) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return [80 + (hash & 127), 80 + ((hash >>> 8) & 127), 80 + ((hash >>> 16) & 127)];
}

/**
 * The pictures of brush source's textures, from the .wad files its worldspawn lists (by their path, or by
 * their name in the game's folders) and from every .wad in those folders: `name → texture`, lower case.
 */
function sourceTextures(map, folders) {
  const wanted = new Set();
  const all = [...(map.brushes ?? []), ...(map.entities ?? []).flatMap((entity) => entity.brushes ?? [])];
  for (const brush of all) for (const face of brush.faces) wanted.add(face.texture.toLowerCase());
  const listed = String([map.worldspawn?.wad ?? ""].flat().join(";"));
  const paths = [];
  for (const path of listed
    .split(";")
    .map((each) => each.trim())
    .filter(Boolean))
    if (existsSync(path)) paths.push(path);
  const names = new Set(listedWads(listed));
  for (const folder of folders)
    try {
      for (const file of readdirSync(folder))
        if (/\.wad$/i.test(file) && (names.has(file.toLowerCase()) || !names.size || true))
          paths.push(join(folder, file));
    } catch {
      // a folder that is not there holds no .wad
    }
  const found = new Map();
  for (const path of [...new Set(paths)]) {
    if (![...wanted].some((name) => !found.has(name))) break;
    let wad;
    try {
      wad = readWad(readFileSync(path));
    } catch {
      continue;
    }
    for (const name of wanted) {
      if (found.has(name)) continue;
      const texture = textureFromWad(wad, name);
      if (texture) found.set(name, texture);
    }
  }
  return found;
}

// ── the lightmaps' picture ──────────────────────────────────────────────────
/** Lightmaps packed in rows into one picture: `place(width, height)` gives where one goes. */
function atlas() {
  let x = ATLAS_GAP;
  let y = ATLAS_GAP;
  let row = 0;
  const pieces = [];
  const place = (width, height, rgb) => {
    if (x + width + ATLAS_GAP > ATLAS_WIDTH) {
      x = ATLAS_GAP;
      y += row + ATLAS_GAP;
      row = 0;
    }
    const at = [x, y];
    pieces.push({ at, width, height, rgb });
    x += width + ATLAS_GAP;
    row = Math.max(row, height);
    return at;
  };
  const picture = () => {
    const height = Math.max(1, y + row + ATLAS_GAP);
    const rgba = new Uint8Array(ATLAS_WIDTH * height * 4).fill(255);
    for (const { at, width, height: tall, rgb } of pieces)
      for (let row2 = -ATLAS_GAP; row2 < tall + ATLAS_GAP; row2++)
        for (let col = -ATLAS_GAP; col < width + ATLAS_GAP; col++) {
          // the gap round a lightmap is its own edge again, so that a sample at the edge is not mixed with another's
          const sx = Math.min(width - 1, Math.max(0, col));
          const sy = Math.min(tall - 1, Math.max(0, row2));
          const from = (sy * width + sx) * 3;
          const to = ((at[1] + row2) * ATLAS_WIDTH + at[0] + col) * 4;
          rgba[to] = rgb[from];
          rgba[to + 1] = rgb[from + 1];
          rgba[to + 2] = rgb[from + 2];
          rgba[to + 3] = 255;
        }
    return { width: ATLAS_WIDTH, height, rgba };
  };
  return { place, picture };
}

// ── batches ─────────────────────────────────────────────────────────────────
/** Triangles grouped by texture and kind: `push(key, polygon, uv, lightUv)` fans a polygon into them. */
function batches() {
  const byKey = new Map();
  const push = ({ texture, kind, alpha = 1 }, polygon, uvs, luvs, normal) => {
    // wound anticlockwise seen from its front, so that the page's normal (its first corners' cross) is the face's
    if (normal && polygon.length >= 3) {
      // the whole outline's turn (Newell's), not its first three corners': a compiled face often begins with
      // three in a line (the compiler puts corners along an edge), and their cross is then any way at all
      const cross = [0, 0, 0];
      polygon.forEach((a, i) => {
        const b = polygon[(i + 1) % polygon.length];
        cross[0] += (a[1] - b[1]) * (a[2] + b[2]);
        cross[1] += (a[2] - b[2]) * (a[0] + b[0]);
        cross[2] += (a[0] - b[0]) * (a[1] + b[1]);
      });
      if (cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2] < 0) {
        polygon = [...polygon].reverse();
        uvs = [...uvs].reverse();
        if (luvs) luvs = [...luvs].reverse();
      }
    }
    const key = `${texture}|${kind}|${alpha}`;
    let batch = byKey.get(key);
    if (!batch)
      byKey.set(key, (batch = { texture, kind, alpha, positions: [], uv: [], luv: luvs ? [] : null }));
    if (luvs && !batch.luv) batch.luv = [];
    for (let k = 1; k + 1 < polygon.length; k++)
      for (const corner of [0, k, k + 1]) {
        batch.positions.push(...polygon[corner].map((value) => Math.round(value * 100) / 100));
        batch.uv.push(...uvs[corner].map((value) => Math.round(value * 10000) / 10000));
        if (batch.luv) batch.luv.push(...(luvs ? luvs[corner] : [-1, -1]));
      }
  };
  return { push, list: () => [...byKey.values()] };
}

const dotted = (axis, point) => axis[0] * point[0] + axis[1] * point[1] + axis[2] * point[2] + axis[3];

/** The kind of face a texture makes: "sky", "liquid", "tool" (clip, origin, trigger, hint, null) or "face". */
function kindOfTexture(name) {
  const kind = textureKind(name);
  if (kind.sky) return "sky";
  if (kind.water) return "liquid";
  if (kind.tool) return "tool";
  return "face";
}

// ── the scene ───────────────────────────────────────────────────────────────
/**
 * A map as a scene for a page that draws in 3D: `{ world, things, textures, lightmap, bounds, notes }`.
 *   world      `[{ texture, kind, alpha, positions, uv, luv }]`: triangles by texture; `positions` x, y, z by
 *              threes, `uv` the place on the texture (1 a texture's width), `luv` on the lightmaps' picture
 *              (a compiled map's; -1 where a face has no light). `kind`: "face", "sky", "liquid", "tool",
 *              "entity" (a brush entity's face: a door, a wall that breaks)
 *   things     each point entity: `{ number, classname, targetname, kind, origin, yaw, angles, file, min,
 *              max, body, batches, props }`, `batches` its model's triangles as `world`'s are; `props` what
 *              `propsOf` says of it
 *   textures   `[{ name, width, height, pixels, palette, holes, flat }]`: `sceneTextureRgba` makes each a picture
 *   lightmap   `{ width, height, rgba }` (a compiled map's), or null
 * `options`: `folders` (the game's, the mod's own first), `mod` (a profile: its folders, its bodies, the
 * models it gives its classes), `light` ("start" unless told: the switched lights as the map starts).
 */
export function sceneOf3d(map, options = {}) {
  options = withMod({ models: true, ...options }, map);
  const folders = options.folders ?? [];
  const compiled = Array.isArray(map?.faces) && Array.isArray(map?.leaves);
  const textures = textureList();
  const world = batches();
  const notes = [];
  let lightmap = null;
  const things = thingsOf(map);
  const hiddenModels = new Set(things.filter((thing) => thing.model !== null && thing.model !== 0 && thing.look?.hidden).map((thing) => thing.model)); // prettier-ignore
  if (compiled) {
    const bsp = map;
    const fromWads = new Map(
      (folders.length ? texturesFor(bsp, folders, { pixels: true }).textures : []).map((each) => [
        each.name.toLowerCase(),
        each.texture,
      ]),
    );
    const byIndex = new Map();
    const textureAt = (index) => {
      if (byIndex.has(index)) return byIndex.get(index);
      const entry = bsp.textures[index];
      const name = entry?.name ?? "";
      let found = entry && !entry.absent && entry.embedded ? embeddedTexture(bsp, index) : null;
      found ??= fromWads.get(name.toLowerCase()) ?? { name, flat: colourOfName(name) };
      const number = textures.add(found);
      byIndex.set(index, number);
      return number;
    };
    const counted = stylesCounted(bsp, options.light ?? "start");
    const packed = atlas();
    const lit = bsp.lumps.lighting.length > 0;
    for (const [modelNumber, model] of bsp.models.entries()) {
      if (hiddenModels.has(modelNumber)) continue;
      for (let nth = 0; nth < model.faceCount; nth++) {
        const face = bsp.faces[model.firstFace + nth];
        const texinfo = bsp.texinfo[face.texinfo];
        const name = bsp.textures[texinfo.texture]?.name ?? "";
        const kind = kindOfTexture(name);
        if (kind === "tool") continue;
        const polygon = facePolygon(bsp, face);
        const number = textureAt(texinfo.texture);
        const size = [textures.list[number].width, textures.list[number].height];
        const uvs = polygon.map((point) => [
          dotted(texinfo.s, point) / size[0],
          dotted(texinfo.t, point) / size[1],
        ]);
        let luvs = null;
        if (lit && kind === "face") {
          const lightmapOf = faceLightmap(bsp, face);
          const wanted = lightmapOf?.styles.filter((each) => counted(each.style)) ?? [];
          if (wanted.length) {
            let rgb = wanted[0].rgb;
            if (wanted.length > 1) {
              rgb = new Uint8ClampedArray(rgb.length);
              for (const each of wanted) for (let at = 0; at < rgb.length; at++) rgb[at] += each.rgb[at];
            }
            const at = packed.place(lightmapOf.width, lightmapOf.height, rgb);
            luvs = polygon.map((point) => [
              at[0] + (dotted(texinfo.s, point) - lightmapOf.originS) / LUXEL + 0.5,
              at[1] + (dotted(texinfo.t, point) - lightmapOf.originT) / LUXEL + 0.5,
            ]);
          } else luvs = polygon.map(() => [-2, -2]);
        }
        world.push({ texture: number, kind: modelNumber === 0 ? kind : kind === "face" ? "entity" : kind }, polygon, uvs, luvs, faceNormal(bsp, face)); // prettier-ignore
      }
    }
    if (lit) {
      lightmap = packed.picture();
      for (const batch of world.list())
        if (batch.luv)
          for (let at = 0; at < batch.luv.length; at += 2)
            if (batch.luv[at] >= 0) {
              batch.luv[at] = Math.round((batch.luv[at] / lightmap.width) * 1e5) / 1e5;
              batch.luv[at + 1] = Math.round((batch.luv[at + 1] / lightmap.height) * 1e5) / 1e5;
            }
    }
  } else {
    const found = sourceTextures(map, folders);
    const byName = new Map();
    const textureOf = (name) => {
      const key = name.toLowerCase();
      if (!byName.has(key))
        byName.set(key, textures.add(found.get(key) ?? { name, flat: colourOfName(name) }));
      return byName.get(key);
    };
    const drawBrush = (brush, kindFor) => {
      const shape = shapeOf(brush);
      shape.faces.forEach((face, nth) => {
        if (!(face.area > 0)) return;
        const source = brush.faces[nth];
        const kind = kindOfTexture(source.texture);
        const number = textureOf(source.texture);
        const size = [textures.list[number].width, textures.list[number].height];
        const uvs = face.polygon.map((point) => [
          (dotted([...source.u.slice(0, 3), 0], point) / source.scale[0] + source.u[3]) / size[0],
          (dotted([...source.v.slice(0, 3), 0], point) / source.scale[1] + source.v[3]) / size[1],
        ]);
        world.push({ texture: number, kind: kindFor(kind) }, face.polygon, uvs, null, face.normal);
      });
    };
    for (const brush of map.brushes ?? []) drawBrush(brush, (kind) => kind);
    for (const thing of things)
      if (thing.model !== null && !thing.look?.hidden)
        for (const brush of thing.brushes ?? [])
          drawBrush(brush, (kind) => (kind === "face" ? "entity" : kind));
      else if (thing.model !== null) for (const brush of thing.brushes ?? []) drawBrush(brush, () => "tool");
    const missing = [
      ...new Set((map.brushes ?? []).flatMap((brush) => brush.faces.map((face) => face.texture))),
    ].filter((name) => kindOfTexture(name) === "face" && !found.has(name.toLowerCase()));
    if (missing.length) notes.push(`${missing.length} textures not found in the .wad files (drawn in a colour of their name): ${missing.slice(0, 8).join(", ")}`); // prettier-ignore
  }
  // the things: their models or their boxes, and what propsOf says
  const { figures, notes: figureNotes } = figuresOf(things, options);
  notes.push(...figureNotes);
  const said = propsOf(map, { ...options, figures });
  const props = new Map(said.props.map((prop) => [prop.number, prop]));
  const listed = [];
  for (const thing of things) {
    if (!thing.origin || thing.model !== null) continue;
    const figure = figures.get(thing.number);
    const own = batches();
    if (figure?.surfaces)
      for (const surface of figure.surfaces) {
        const number = textures.add(surface.texture);
        const size = [textures.list[number].width, textures.list[number].height];
        const uvs = surface.polygon.map((point) => [
          dotted(surface.sAxis, point) / size[0],
          dotted(surface.tAxis, point) / size[1],
        ]);
        own.push({ texture: number, kind: surface.texture.additive ? "additive" : "model" }, surface.polygon, uvs, null, surface.normal); // prettier-ignore
      }
    listed.push({
      number: thing.number,
      classname: thing.classname,
      targetname: thing.targetname ?? null,
      kind: thing.kind,
      origin: thing.origin,
      yaw: thing.yaw,
      angles: thing.angles,
      file: figure?.file ?? (/\.(mdl|spr)$/i.test(thing.modelFile ?? "") ? thing.modelFile : null),
      min: figure?.min ?? null,
      max: figure?.max ?? null,
      body: Boolean(figure?.body),
      batches: own.list(),
      props: props.get(thing.number) ?? null,
    });
  }
  const all = [
    ...world.list().flatMap((batch) => batch.positions),
    ...listed.flatMap((thing) => thing.origin),
  ];
  const bounds = { min: [0, 1, 2].map((axis) => Infinity), max: [0, 1, 2].map(() => -Infinity) };
  for (let at = 0; at < all.length; at += 3)
    for (let axis = 0; axis < 3; axis++) {
      bounds.min[axis] = Math.min(bounds.min[axis], all[at + axis]);
      bounds.max[axis] = Math.max(bounds.max[axis], all[at + axis]);
    }
  return { world: world.list(), things: listed, textures: textures.list, lightmap, bounds, notes, compiled };
}

// ── things against the world ────────────────────────────────────────────────
/**
 * Whether a point is solid: a compiled map's world (hull 0); brush source's world brushes, those of tools'
 * textures alone (clip, origin, hint, skip) left out, and its brush entities that stand (doors, walls) too.
 */
function solidTest(map) {
  if (Array.isArray(map?.faces) && Array.isArray(map?.leaves))
    return (point) => contentsAt(map, point) === CONTENTS.SOLID;
  const standing = [
    ...(map.brushes ?? []),
    ...(map.entities ?? []).filter((entity) => /^func_(wall|door|breakable|detail|illusionary_never)/i.test(entity.classname ?? "")).flatMap((entity) => entity.brushes ?? []), // prettier-ignore
  ].filter((brush) => brush.faces.some((face) => kindOfTexture(face.texture) !== "tool"));
  const solids = standing.map((brush) => {
    const shape = shapeOf(brush);
    return { planes: planesOf(brush), min: shape.min, max: shape.max };
  });
  return ([x, y, z]) =>
    solids.some(
      ({ planes, min, max }) =>
        x > min[0] &&
        x < max[0] &&
        y > min[1] &&
        y < max[1] &&
        z > min[2] &&
        z < max[2] &&
        planes.every(
          (plane) =>
            plane && plane.normal[0] * x + plane.normal[1] * y + plane.normal[2] * z - plane.dist < 0,
        ),
    );
}

/**
 * Each point entity that has a model or a body (a prop, an NPC, a monster, a chest, a place to start) held
 * against the world: `{ props, warned }`. A prop is
 *   { number, classname, targetname, file, origin, yaw, min, max,
 *     inSolid     the share of its box (looked into 4 units from its sides) that is solid: a wall or the
 *                 floor through it
 *     floats      how far its box's foot hangs over the floor at the least, where it does everywhere under
 *                 it (null when it stands); told only when no side of it is against a wall (a painting
 *                 hangs)
 *     clear       { front, back, left, right }: how far from its box's side to a wall that way, by the way
 *                 it faces (its yaw); null past 512
 *     warnings    sentences on what is wrong wherever it is: a thing that walks (an NPC, a monster, a start)
 *                 stuck in solid, a prop buried in it (over half its box), a prop that floats with no side
 *                 against a wall
 *     notes }     what a mapper may mean and a look tells: a prop partly in a wall (a sword in a rack), its
 *                 nose to a wall with room behind it (turned the wrong way, if its model's front is +x, as
 *                 most are), a thing that walks placed over the floor (the game drops most to it)
 * It returns `{ props, warned, noted }`: `noted` those with notes and no warning.
 * `options` as `sceneOf3d`'s (`figures`: those already worked out). A model's box is its own box turned:
 * loose about a model of odd shape, so a few in a hundred in solid is the box, not the model.
 */
export function propsOf(map, options = {}) {
  options = withMod({ models: true, ...options }, map);
  const things = thingsOf(map);
  const figures = options.figures ?? figuresOf(things, options).figures;
  const solid = solidTest(map);
  const props = [];
  for (const thing of things) {
    const figure = figures.get(thing.number);
    if (!figure?.min || !thing.origin || thing.model !== null) continue;
    const { min, max } = figure;
    const inset = [0, 1, 2].map((axis) => Math.min(INSET, (max[axis] - min[axis]) / 4));
    let inside = 0;
    let looked = 0;
    for (let i = 0; i < SAMPLES; i++)
      for (let j = 0; j < SAMPLES; j++)
        for (let k = 0; k < SAMPLES; k++) {
          const at = [i, j, k].map(
            (step, axis) =>
              min[axis] + inset[axis] + ((max[axis] - min[axis] - 2 * inset[axis]) * (step + 0.5)) / SAMPLES,
          );
          looked++;
          if (solid(at)) inside++;
        }
    const inSolid = inside / looked;
    // the gap under its foot, at its middle and its corners
    const feet = [
      [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2],
      [min[0] + inset[0], min[1] + inset[1]],
      [max[0] - inset[0], min[1] + inset[1]],
      [min[0] + inset[0], max[1] - inset[1]],
      [max[0] - inset[0], max[1] - inset[1]],
    ];
    const gaps = feet.map(([x, y]) => {
      for (let down = 0; down <= FLOOR_REACH; down += 1) if (solid([x, y, min[2] - down + 0.5])) return down;
      return FLOOR_REACH;
    });
    const gap = Math.min(...gaps);
    const floats = gap > FLOATS ? gap : null;
    // how far to a wall each way it faces, from its box's middle height near the floor
    const yaw = ((thing.angles?.[1] ?? thing.yaw ?? 0) * Math.PI) / 180;
    const ways = { front: [Math.cos(yaw), Math.sin(yaw)], back: [-Math.cos(yaw), -Math.sin(yaw)], left: [-Math.sin(yaw), Math.cos(yaw)], right: [Math.sin(yaw), -Math.cos(yaw)] }; // prettier-ignore
    const centre = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
    const z = min[2] + Math.min(24, (max[2] - min[2]) / 2);
    const clear = {};
    for (const [way, [dx, dy]] of Object.entries(ways)) {
      // from the side of its box that way
      const half = (Math.abs(dx) * (max[0] - min[0])) / 2 + (Math.abs(dy) * (max[1] - min[1])) / 2;
      let found = null;
      for (let out = 0; out <= WALL_REACH; out += WALL_STEP)
        if (solid([centre[0] + dx * (half + out), centre[1] + dy * (half + out), z])) {
          found = out;
          break;
        }
      clear[way] = found;
    }
    // told as a warning what is wrong wherever it is; as a note what a mapper may mean (a sword stuck in a
    // rack, a prop turned to a wall) and a look tells
    const warnings = [];
    const notes = [];
    // a thing that walks, and an item the game lets fall, is dropped to the floor as it spawns
    const walks = Boolean(figure.body);
    const drops = walks || DROPPED.test(thing.classname);
    const percent = Math.round(inSolid * 100);
    if (walks && inSolid > IN_SOLID)
      warnings.push(`${percent}% of its box is in solid: it is stuck in a wall or the floor`);
    // a thin thing (a vest on a rack, a sign, a painting) is laid against a wall, its box half in it
    else if (inSolid > BURIED && Math.min(...[0, 1, 2].map((axis) => max[axis] - min[axis])) >= THIN)
      warnings.push(`${percent}% of its box is in solid: it is buried in a wall or the floor`);
    else if (inSolid > IN_SOLID)
      notes.push(`${percent}% of its box is in solid: partly in a wall or the floor`);
    // a thing with a side against a wall hangs on it (a painting, a sign, a lamp on a bracket): it does not float.
    // Most of that side has wall behind it, looked at over the side's breadth and height: one in a doorway has
    // the jamb near one edge and the opening behind the rest (Meridian's pictures hung in its doorways)
    const onWall = Object.values(ways).some(([dx, dy]) => {
      const half = (Math.abs(dx) * (max[0] - min[0])) / 2 + (Math.abs(dy) * (max[1] - min[1])) / 2;
      const breadth = (Math.abs(dy) * (max[0] - min[0])) / 2 + (Math.abs(dx) * (max[1] - min[1])) / 2;
      let behind = 0;
      for (let i = 0; i < SAMPLES; i++)
        for (let k = 0; k < SAMPLES; k++) {
          const across = breadth * (((i + 0.5) * 2) / SAMPLES - 1);
          const up = min[2] + inset[2] + ((max[2] - min[2] - 2 * inset[2]) * (k + 0.5)) / SAMPLES;
          const out = half + ON_WALL;
          if (solid([centre[0] + dx * out - dy * across, centre[1] + dy * out + dx * across, up])) behind++;
        }
      return behind / (SAMPLES * SAMPLES) >= HUNG;
    });
    const far = floats !== null && floats >= FLOOR_REACH ? `more than ${FLOOR_REACH}` : floats;
    // a prop on a table, a shelf or a crate that is a model of its own stands on it
    const standsOn =
      floats === null
        ? null
        : [...figures.entries()].find(
            ([number, other]) =>
              number !== thing.number &&
              other.min &&
              other.max[2] <= min[2] + FLOATS &&
              other.max[2] >= min[2] - FLOATS &&
              centre[0] >= other.min[0] &&
              centre[0] <= other.max[0] &&
              centre[1] >= other.min[1] &&
              centre[1] <= other.max[1],
          );
    if (standsOn)
      notes.push(
        `it stands on entity ${standsOn[0]} (${standsOn[1].file ? basename(standsOn[1].file) : "its box"}), not on the world`,
      );
    else if (floats !== null && drops)
      notes.push(`it is ${far} over the floor: the game drops it to the floor, if it does so for this class`);
    else if (
      floats !== null &&
      !onWall &&
      !/^(light|env_sprite|env_glow|ambient_|info_target)/i.test(thing.classname)
    )
      warnings.push(`it floats ${far} over the floor`);
    const turned = thing.turned || figure.file;
    if (
      turned &&
      !NO_FACING.test(thing.classname) &&
      clear.front !== null &&
      clear.front < NOSE_TO_WALL &&
      (clear.back === null || clear.back > ROOM_BEHIND)
    )
      notes.push(
        `its front is ${clear.front} from a wall and its back ${clear.back ?? "over 512"} from one: does it face the wrong way? (as its model's front is +x)`,
      );
    props.push({
      number: thing.number,
      classname: thing.classname,
      targetname: thing.targetname ?? null,
      file: figure.file ? basename(figure.file) : null,
      origin: thing.origin,
      yaw: Math.round(((thing.angles?.[1] ?? thing.yaw ?? 0) % 360) * 100) / 100,
      min: min.map((value) => Math.round(value * 10) / 10),
      max: max.map((value) => Math.round(value * 10) / 10),
      inSolid: Math.round(inSolid * 1000) / 1000,
      floats,
      clear,
      warnings,
      notes,
    });
  }
  return {
    props,
    warned: props.filter((prop) => prop.warnings.length),
    noted: props.filter((prop) => prop.notes.length && !prop.warnings.length),
  };
}
