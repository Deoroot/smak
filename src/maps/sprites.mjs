// Sprites: the flat pictures the game turns to the eye (a torch's flame, a glow, smoke). A `.spr` file is
// read here, and an entity that names one (`env_sprite`, `env_glow`, any point entity whose `model` ends in
// `.spr`) is made into what the map drawing fills: its first frame as a board at the entity's `scale`, set
// up and blended as the engine does by the sprite's own kind and the entity's render mode.
//
//   readSpr(bytes)                    the file: its kind, its palette, its frames
//   spriteFrameRgba(sprite, n)        a frame as a picture, as the engine reads its format
//   spritesOf(things, { folders })    for each entity that names a sprite: the sprite, and how it is shown
//   boardOf(sprite, view)             its board for one view: a surface, and how it is painted
//   spriteBorder(sprite, n)           how much light a frame has outside its inscribed circle: a faint square when added
//
// What the arithmetic is from: Xash3D FWGS's own drawing of a sprite (ref/gl/gl_sprite.c): the board's axes
// for each of the five kinds, the blend of each render mode, the colour, and a glow's size and brightness
// by how far it is (it grows with the distance and dims with its square). An animation is not played: one
// frame is drawn.
import { readFileSync, statSync } from "node:fs";
import { sub, dot, cross, unit } from "../vec.mjs";
import { inFolders } from "./files.mjs";
import { turnOf } from "./figures.mjs";

// ── the file ────────────────────────────────────────────────────────────────
/** A sprite file begins with these four letters and this number (the writer, src/sprite/spr.mjs, shares them). */
export const IDENT = "IDSP";
export const VERSION = 2;
/** Where each number of the header is (bytes), and its length. */
export const HEADER = { type: 8, format: 12, radius: 16, width: 20, height: 24, frames: 28, beam: 32, sync: 36, sizeof: 40 };
/** A frame's own header: where its left edge and its top are from the entity's origin, and its size. */
export const FRAME = { left: 0, up: 4, width: 8, height: 12, sizeof: 16 };
/** A file may hold this many frames and a frame this many pixels a side, before it is taken as broken. */
const FRAMES_MOST = 4096;
const SIDE_MOST = 4096;
/** How a sprite is turned to the eye, by the number in its file. */
export const SPRITE_TYPES = ["upright", "facing upright", "parallel", "oriented", "parallel oriented"];
/** How a sprite's palette is meant, by the number in its file. */
export const SPRITE_FORMATS = ["normal", "additive", "index alpha", "alpha test"];
/** In an "alpha test" sprite, the palette index that is a hole. */
const HOLE_INDEX = 255;

/**
 * A sprite file read: `{ type, format (words: `SPRITE_TYPES`, `SPRITE_FORMATS`), width, height (the largest
 * frame's), palette (768 bytes), frames: [{ left, up, width, height, pixels }] }`. A frame's `left` and `up`
 * say where its left edge and its top are from the point the sprite is put at, in pixels (a frame of 64
 * about its middle: -32 and 32); `pixels` is one palette index a pixel, a view of `bytes`. The frames of a
 * group are listed one after another, and `groups` says which they are: [{ first, count, ends (each frame's
 * cumulative end time, seconds) }]. Also kept, so that a file can be written again as it was: `radius` (the
 * bounding radius), `beam` (the beam length, which Xash reads as "draw both sides"), `sync`, and `colours`
 * (the palette's count). Throws, in words, for a file that is not a Half-Life sprite.
 */
export function readSpr(bytes) {
  if (bytes.length < HEADER.sizeof + 2 || bytes.toString("latin1", 0, 4) !== IDENT)
    throw new Error("not a sprite file: it does not begin with IDSP");
  const version = bytes.readInt32LE(4);
  if (version !== VERSION)
    throw new Error(`a sprite of version ${version}: Half-Life's are version ${VERSION} (Quake's are 1)`);
  const type = bytes.readUInt32LE(HEADER.type);
  const format = bytes.readUInt32LE(HEADER.format);
  const count = bytes.readInt32LE(HEADER.frames);
  if (!(count >= 1 && count <= FRAMES_MOST))
    throw new Error(`a sprite of ${count} frames: the file is broken`);
  const colours = bytes.readUInt16LE(HEADER.sizeof);
  let at = HEADER.sizeof + 2;
  if (colours > 256 || at + colours * 3 > bytes.length)
    throw new Error(`a sprite with a palette of ${colours} colours: the file is broken`);
  const palette = new Uint8Array(768);
  palette.set(bytes.subarray(at, at + colours * 3));
  at += colours * 3;
  const frames = [];
  const groups = [];
  /** One frame at `at`: its header, then its pixels. */
  const frame = () => {
    if (at + FRAME.sizeof > bytes.length)
      throw new Error("the sprite ends inside a frame: the file is cut short");
    const width = bytes.readInt32LE(at + FRAME.width);
    const height = bytes.readInt32LE(at + FRAME.height);
    if (!(width >= 1 && height >= 1 && width <= SIDE_MOST && height <= SIDE_MOST))
      throw new Error(`a frame of ${width} x ${height}: the file is broken`);
    const pixelsAt = at + FRAME.sizeof;
    if (pixelsAt + width * height > bytes.length)
      throw new Error("the sprite ends inside a frame: the file is cut short");
    frames.push({
      left: bytes.readInt32LE(at + FRAME.left),
      up: bytes.readInt32LE(at + FRAME.up),
      width,
      height,
      pixels: bytes.subarray(pixelsAt, pixelsAt + width * height),
    });
    at = pixelsAt + width * height;
  };
  for (let nth = 0; nth < count; nth++) {
    if (at + 4 > bytes.length)
      throw new Error("the sprite ends before its last frame: the file is cut short");
    const grouped = bytes.readUInt32LE(at) !== 0;
    at += 4;
    if (!grouped) {
      frame();
      continue;
    }
    // a group: how many, how long each is shown, then the frames
    const inGroup = bytes.readInt32LE(at);
    if (!(inGroup >= 1 && inGroup <= FRAMES_MOST))
      throw new Error(`a group of ${inGroup} frames: the file is broken`);
    const ends = Array.from({ length: inGroup }, (_, k) => bytes.readFloatLE(at + 4 + k * 4));
    groups.push({ first: frames.length, count: inGroup, ends });
    at += 4 + inGroup * 4;
    for (let each = 0; each < inGroup; each++) frame();
  }
  return {
    type: SPRITE_TYPES[type] ?? SPRITE_TYPES[2],
    format: SPRITE_FORMATS[format] ?? SPRITE_FORMATS[0],
    width: bytes.readInt32LE(HEADER.width),
    height: bytes.readInt32LE(HEADER.height),
    radius: bytes.readFloatLE(HEADER.radius),
    beam: bytes.readFloatLE(HEADER.beam),
    sync: bytes.readInt32LE(HEADER.sync),
    colours,
    palette,
    frames,
    groups,
  };
}

// ── the sprites of a map's entities ─────────────────────────────────────────
/** The render modes of an entity, by their numbers. */
const MODE = { normal: 0, colour: 1, texture: 2, glow: 3, solid: 4, additive: 5 };
/** The render effect that keeps a glow as bright far away as near. */
const NO_DISSIPATION = 14;
/** A glow is as bright as this over the square of its distance, between these two; and this large a unit. */
const GLARE_FALLOFF = 19000;
const GLARE_LEAST = 0.05;
const GLOW_GROWS = 1 / 200;
/** A sprite seen from within a degree of straight above or below is not drawn, when it stands upright. */
const UPRIGHT_MOST = 0.999848;
const FULL = 255;
/** `env_sprite`'s flag for one that is on when the map starts. */
const START_ON = 1;

/**
 * A frame of a sprite (`readSpr`'s) as a picture, `{ width, height, rgba }`, as the engine reads its format (Xash
 * gl_sprite.c, img_utils.c): "normal" and "additive" every pixel its palette's colour, opaque (an additive one adds
 * it, black adding nothing); "alpha test" with holes where its index is 255, black and clear (so a game that adds it,
 * as TS does its wood chips, adds nothing there); "index alpha" all its last colour, each pixel as solid as its index
 * is high.
 */
export function spriteFrameRgba(sprite, number = 0) {
  const frame = sprite.frames[number];
  if (!frame) throw new Error(`the sprite has no frame ${number} (it has ${sprite.frames.length})`);
  const { width, height, pixels } = frame;
  const rgba = new Uint8Array(width * height * 4);
  const last = sprite.palette.subarray(HOLE_INDEX * 3, HOLE_INDEX * 3 + 3);
  pixels.forEach((index, i) => {
    if (sprite.format === "index alpha") rgba.set([last[0], last[1], last[2], index], i * 4);
    else if (sprite.format === "alpha test" && index === HOLE_INDEX) rgba.set([0, 0, 0, 0], i * 4);
    else rgba.set([...sprite.palette.subarray(index * 3, index * 3 + 3), FULL], i * 4);
  });
  return { width, height, rgba };
}

/**
 * The light a frame has in its corners, outside the circle inscribed in the frame (where a round glow is black):
 * `{ corners (pixels counted), lit (how many are not black), share (lit / corners), max (the brightest, 0 to 255) }`.
 * A pixel's light is its brightest colour channel (its coverage in an "index alpha" sprite). Added to the world,
 * even 1 to 7 of 255 shows as a faint square once Xash's texture gamma and a dark night lift it.
 */
export function spriteBorder(sprite, number = 0) {
  const { width, height, rgba } = spriteFrameRgba(sprite, number);
  const alpha = sprite.format === "index alpha";
  const [cx, cy, radius] = [width / 2, height / 2, Math.min(width, height) / 2];
  let corners = 0;
  let lit = 0;
  let max = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= radius) continue;
      corners++;
      const at = (y * width + x) * 4;
      const value = alpha ? rgba[at + 3] : Math.max(rgba[at], rgba[at + 1], rgba[at + 2]);
      if (value > 0) lit++;
      max = Math.max(max, value);
    }
  return { corners, lit, share: corners ? lit / corners : 0, max };
}

/** The sprites read so far, by their file: read again only when the file has changed. */
const files = new Map();

/** A sprite of the game's folders, read once: what `readSpr` gives with its `file`; or `{ file: null, why }`. */
export function spriteOf(name, folders) {
  const file = inFolders(folders, name);
  if (!file) return { file: null, why: `${name} is in none of the folders given` };
  const stamp = statSync(file).mtimeMs;
  const kept = files.get(file);
  if (kept?.stamp === stamp) return kept;
  let made;
  try {
    made = { ...readSpr(readFileSync(file)), file, stamp, textures: new Map() };
  } catch (error) {
    made = { file: null, stamp, why: `${name} could not be read: ${error.message}` };
  }
  files.set(file, made);
  return made;
}

/**
 * A frame of a sprite as the map drawing reads a texture (draw.mjs). An "alpha test" sprite has holes where
 * its index is 255; an "index alpha" one is all its last colour, each pixel as solid as its index is high.
 */
function textureOf(sprite, number) {
  if (sprite.textures.has(number)) return sprite.textures.get(number);
  const frame = sprite.frames[number];
  const holes = sprite.format === "alpha test";
  let palette = sprite.palette;
  let cover = null;
  if (sprite.format === "index alpha") {
    palette = new Uint8Array(768);
    cover = new Float32Array(256);
    for (let index = 0; index < 256; index++) {
      palette.set(sprite.palette.subarray(765, 768), index * 3);
      cover[index] = index / FULL;
    }
  }
  const sum = [0, 0, 0];
  let counted = 0;
  for (const index of frame.pixels) {
    if (holes && index === HOLE_INDEX) continue;
    for (let channel = 0; channel < 3; channel++) sum[channel] += palette[index * 3 + channel];
    counted++;
  }
  const texture = {
    name: sprite.file,
    levels: [{ width: frame.width, height: frame.height, pixels: frame.pixels }],
    palette,
    holes,
    cover,
    flat: null,
    mean: sum.map((value) => Math.round(value / Math.max(1, counted))),
  };
  sprite.textures.set(number, texture);
  return texture;
}

/**
 * The sprites of a map's point entities. `things`: as the drawing reads a map's entities, each with
 * `modelFile`, `origin`, `angles`, `pose` (`scale`, `frame`) and `render` (`{ mode, amount, colour, fx }`).
 *
 *   folders   the game's folders, the mod's own first: where the sprites are
 *   sprites   false: none is read
 *
 * It returns `{ sprites, notes }`. `sprites` is a Map from an entity's number to `{ file, origin, type,
 * format, frame (its number), frames (how many the file has), size: [wide, high] in units at its scale,
 * scale, mode ("normal", "colour", "texture", "glow", "solid" or "additive"), amount (0 to 1), colour
 * ([r, g, b], 0 to 1), angles, fx, texture, left, up, width, height }`. `notes`: sentences on those not
 * found, and on those that start switched off.
 */
export function spritesOf(things, { folders = [], sprites = true } = {}) {
  const found = new Map();
  const notes = [];
  if (sprites === false || !folders.length) return { sprites: found, notes };
  const missing = new Set();
  let off = 0;
  for (const thing of things) {
    if (thing.model !== null || !thing.origin || !/\.spr$/i.test(thing.modelFile ?? "")) continue;
    const sprite = spriteOf(thing.modelFile, folders);
    if (!sprite.file) {
      missing.add(sprite.why);
      continue;
    }
    const asked = Number(thing.pose?.frame ?? 0);
    const number = Math.min(
      sprite.frames.length - 1,
      Math.max(0, Math.floor(Number.isFinite(asked) ? asked : 0)),
    );
    const frame = sprite.frames[number];
    const scale = Number(thing.pose?.scale) > 0 ? Number(thing.pose.scale) : 1;
    const render = thing.render ?? {};
    const mode = Object.keys(MODE).find((name) => MODE[name] === render.mode) ?? "normal";
    const tinted = (render.colour ?? []).some((value) => value > 0);
    if (thing.classname === "env_sprite" && thing.targetname && !(thing.flags & START_ON)) off++;
    found.set(thing.number, {
      file: sprite.file,
      origin: thing.origin,
      type: sprite.type,
      format: sprite.format,
      frame: number,
      frames: sprite.frames.length,
      size: [frame.width * scale, frame.height * scale],
      scale,
      mode,
      // in the normal mode the amount says nothing: the sprite is whole
      amount: mode === "normal" ? 1 : Math.min(1, Math.max(0, (render.amount ?? 0) / FULL)),
      // a colour of 0 0 0 is no colour: the sprite's own
      colour: tinted ? render.colour.map((value) => Math.min(1, Math.max(0, value / FULL))) : [1, 1, 1],
      angles: thing.angles ?? [0, 0, 0],
      fx: render.fx ?? 0,
      texture: textureOf(sprite, number),
      left: frame.left,
      up: frame.up,
      width: frame.width,
      height: frame.height,
    });
  }
  if (missing.size)
    notes.push(`${missing.size} sprites were not drawn: ${[...missing].slice(0, 6).join("; ")}`);
  if (off)
    notes.push(
      `${off} sprites start switched off in the game (an \`env_sprite\` with a targetname and without its \`Start on\` flag): they are drawn all the same`,
    );
  return { sprites: found, notes };
}

/**
 * A sprite's board for one view: `{ surface, paint, far }`, or null when it is not shown from there (faded
 * to nothing, or an upright one seen from straight above). `view`: a camera of the map drawing (`eye`,
 * `right`, `up`, `forward`). `surface` is what the drawing fills; `paint` how: `{ alpha, additive, tint,
 * twoSided, overAll }`. A glow is `overAll`: the engine draws it over everything when a line from the eye
 * to it is clear, which the drawing asks of its picture.
 */
export function boardOf(sprite, view) {
  let scale = sprite.scale;
  let amount = sprite.amount;
  const offset = sub(sprite.origin, view.eye);
  const far = Math.hypot(...offset);
  if (sprite.mode === "glow") {
    if (sprite.fx !== NO_DISSIPATION) {
      amount *= Math.min(1, Math.max(GLARE_LEAST, GLARE_FALLOFF / (far * far)));
      scale *= far * GLOW_GROWS;
    }
  }
  if (!(amount > 0.01)) return null;
  let right = view.right;
  let up = view.up;
  let origin = sprite.origin;
  let type = sprite.type;
  if (type === "parallel" && sprite.angles[2]) type = "parallel oriented";
  if (type === "oriented") {
    // the board lies as the entity's angles say, and looks along them
    const turn = turnOf([-sprite.angles[0], sprite.angles[1], sprite.angles[2]]);
    const forward = turn.map((row) => row[0]);
    right = turn.map((row) => -row[1]);
    up = turn.map((row) => row[2]);
    origin = origin.map((value, axis) => value - forward[axis] * 0.01);
  } else if (type === "facing upright") {
    if (!(Math.hypot(offset[0], offset[1]) > 0)) return null;
    right = unit([offset[1], -offset[0], 0]);
    up = [0, 0, 1];
  } else if (type === "upright") {
    if (Math.abs(view.forward[2]) > UPRIGHT_MOST) return null;
    right = unit([view.forward[1], -view.forward[0], 0]);
    up = [0, 0, 1];
  } else if (type === "parallel oriented") {
    const angle = (sprite.angles[2] * Math.PI) / 180;
    const [sin, cos] = [Math.sin(angle), Math.cos(angle)];
    right = view.right.map((value, axis) => value * cos + view.up[axis] * sin);
    up = view.right.map((value, axis) => value * -sin + view.up[axis] * cos);
  }
  const corner = (across, down) =>
    origin.map(
      (value, axis) =>
        value + right[axis] * (sprite.left + across) * scale + up[axis] * (sprite.up - down) * scale,
    );
  const topLeft = corner(0, 0);
  let normal = cross(up, right);
  if (dot(normal, sub(view.eye, origin)) < 0) normal = normal.map((value) => -value);
  const surface = {
    polygon: [
      topLeft,
      corner(sprite.width, 0),
      corner(sprite.width, sprite.height),
      corner(0, sprite.height),
    ],
    normal,
    dist: dot(normal, origin),
    sAxis: [...right.map((value) => value / scale), -dot(right, topLeft) / scale],
    tAxis: [...up.map((value) => -value / scale), dot(up, topLeft) / scale],
    texture: sprite.texture,
    light: null,
    shade: 1,
    kind: "face",
  };
  const blended = sprite.mode === "glow" || sprite.mode === "additive";
  return {
    surface,
    paint: {
      alpha: amount,
      additive: blended,
      tint: sprite.colour.some((value) => value !== 1) ? sprite.colour : null,
      twoSided: true,
      overAll: sprite.mode === "glow",
    },
    far,
  };
}
