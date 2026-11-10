// The sky's picture. A map's worldspawn names it (`skyname`), and the game looks for its six sides in
// `gfx/env/`: `<name>rt`, `bk`, `lf`, `ft`, `up` and `dn`, each a `.tga` or a `.bmp`. They are read here and
// asked by the way a pixel looks, so that a view shows the sky the game shows, and not a flat colour.
//
//   readTga(bytes)                   a Targa picture: { width, height, rgb }
//   skyOf(name, folders)             the six sides of a sky, found in the game's folders
//   skyColour(sky, x, y, z, out)     the sky's colour along a way out of the eye
//
// Which side lies where, and which way up, is the engine's own table (Xash3D FWGS, ref/gl/gl_warp.c:
// `st_to_vec`, and the order its sides are bound in): `rt` is seen looking along +x, `lf` along -x, `bk`
// along +y, `ft` along -y.
import { readFileSync } from "node:fs";
import { unbmp } from "../../core/image.mjs";
import { inFolders } from "./files.mjs";
import * as W from "../workshop.mjs";

/** The sides of a sky, as their files end, in the order the drawing keeps them: +x, -x, +y, -y, +z, -z. */
export const SKY_SIDES = ["rt", "lf", "bk", "ft", "up", "dn"];
/** The kinds of file a side may be, the first found wins: the engine's own order. */
const SKY_KINDS = ["tga", "bmp"];
/** Where each number of a Targa file's header is (bytes), and the kinds of picture the kit reads. */
const TGA = {
  idLength: 0,
  mapType: 1,
  kind: 2,
  mapLength: 5,
  mapBits: 7,
  width: 12,
  height: 14,
  bits: 16,
  about: 17,
  sizeof: 18,
};
const TGA_MAPPED = 1;
const TGA_COLOUR = 2;
const TGA_GREY = 3;
const TGA_PACKED = 8;
/** In a Targa's last header byte: its rows go from the top down, its columns from the right. */
const TGA_FROM_TOP = 0x20;
const TGA_FROM_RIGHT = 0x10;
/** A sky's mean colour is taken from every this many pixels of its four upright sides. */
const MEAN_EVERY = 16;

/**
 * A Targa picture read: `{ width, height, rgb }`, three bytes a pixel from the top left. Read are the plain
 * and the run-length packed kinds, in colours of 24 or 32 bits, of 8 bits with a palette, and in greys; a
 * see-through channel is passed over. Throws, in words, for anything else.
 */
export function readTga(bytes) {
  if (bytes.length < TGA.sizeof) throw new Error("not a Targa file: it is shorter than its header");
  const kind = bytes[TGA.kind] & ~TGA_PACKED;
  const packed = Boolean(bytes[TGA.kind] & TGA_PACKED);
  const width = bytes.readUInt16LE(TGA.width);
  const height = bytes.readUInt16LE(TGA.height);
  const bits = bytes[TGA.bits];
  const mapLength = bytes[TGA.mapType] ? bytes.readUInt16LE(TGA.mapLength) : 0;
  const mapBytes = bytes[TGA.mapBits] >> 3;
  const sound =
    (kind === TGA_COLOUR && (bits === 24 || bits === 32)) ||
    (kind === TGA_GREY && bits === 8) ||
    (kind === TGA_MAPPED && bits === 8 && (mapBytes === 3 || mapBytes === 4));
  if (!sound || !width || !height)
    throw new Error(
      `a Targa of kind ${bytes[TGA.kind]} and ${bits} bits is not read: colours of 24 or 32 bits, 8 with a palette, or greys`,
    );
  const mapAt = TGA.sizeof + bytes[TGA.idLength];
  let at = mapAt + mapLength * mapBytes;
  const each = bits >> 3;
  const rgb = new Uint8Array(width * height * 3);
  const fromTop = Boolean(bytes[TGA.about] & TGA_FROM_TOP);
  const fromRight = Boolean(bytes[TGA.about] & TGA_FROM_RIGHT);
  /** Puts the pixel stored at `from` as the picture's `nth`, counted the way the file counts. */
  const put = (nth, from) => {
    const column = nth % width;
    const row = (nth - column) / width;
    const to = ((fromTop ? row : height - 1 - row) * width + (fromRight ? width - 1 - column : column)) * 3;
    if (kind === TGA_GREY) rgb.fill(bytes[from], to, to + 3);
    else {
      // stored blue, green, red: in the file itself, or in its palette
      const colour = kind === TGA_MAPPED ? mapAt + bytes[from] * mapBytes : from;
      rgb[to] = bytes[colour + 2];
      rgb[to + 1] = bytes[colour + 1];
      rgb[to + 2] = bytes[colour];
    }
  };
  const short = () => new Error("the Targa ends inside its picture: the file is cut short");
  let nth = 0;
  while (nth < width * height) {
    if (!packed) {
      if (at + each > bytes.length) throw short();
      put(nth++, at);
      at += each;
      continue;
    }
    // a run: its length, then one pixel to repeat or that many pixels
    if (at >= bytes.length) throw short();
    const head = bytes[at++];
    const run = (head & 127) + 1;
    const repeated = Boolean(head & 128);
    if (at + (repeated ? each : run * each) > bytes.length) throw short();
    for (let step = 0; step < run && nth < width * height; step++) {
      put(nth++, at);
      if (!repeated) at += each;
    }
    if (repeated) at += each;
  }
  return { width, height, rgb };
}

/** A side's file read as `{ width, height, rgb }`, whichever kind it is. */
function sideOf(file) {
  const bytes = readFileSync(file);
  if (!/\.bmp$/i.test(file)) return readTga(bytes);
  const read = unbmp(bytes);
  if (read.rgb) return read;
  const rgb = new Uint8Array(read.width * read.height * 3);
  read.pixels.forEach((index, pixel) => rgb.set(read.palette.subarray(index * 3, index * 3 + 3), pixel * 3));
  return { width: read.width, height: read.height, rgb };
}

/** The skies read so far, by their name and where they were looked for. */
const skies = new Map();

/**
 * A sky of the game's folders: `{ name, sides: [{ width, height, rgb } x 6] (in the order of `SKY_SIDES`),
 * files, mean: [r, g, b] }`; or `{ name, sides: null, why }` when a side is not found or not read. `name`
 * is a worldspawn's `skyname`; `folders` the game's, the mod's own first.
 */
export function skyOf(name, folders = []) {
  const key = JSON.stringify([name, folders]);
  if (skies.has(key)) return skies.get(key);
  let made;
  try {
    const files = SKY_SIDES.map((side) => {
      for (const kind of SKY_KINDS) {
        const file = inFolders(folders, `gfx/env/${name}${side}.${kind}`);
        if (file) return file;
      }
      throw new Error(`gfx/env/${name}${side}.tga (or .bmp) is in none of the folders given`);
    });
    const sides = files.map(sideOf);
    const sum = [0, 0, 0];
    let counted = 0;
    for (const side of sides.slice(0, 4))
      for (let at = 0; at < side.rgb.length; at += 3 * MEAN_EVERY) {
        for (let channel = 0; channel < 3; channel++) sum[channel] += side.rgb[at + channel];
        counted++;
      }
    made = { name, sides, files, mean: sum.map((value) => Math.round(value / Math.max(1, counted))) };
  } catch (error) {
    made = { name, sides: null, why: error.message };
  }
  skies.set(key, made);
  return made;
}

/**
 * The colour of a sky along a way out of the eye (`x`, `y`, `z`: of any length), written into `out` as
 * three numbers; the four pixels about the point are mixed. The side is the one the way leans to most, and
 * the place on it as the engine lays its sides out.
 */
export function skyColour(sky, x, y, z, out = [0, 0, 0]) {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  let side;
  let across;
  let upward;
  if (ax >= ay && ax >= az) {
    side = x > 0 ? 0 : 1;
    across = (x > 0 ? -y : y) / ax;
    upward = z / ax;
  } else if (ay >= az) {
    side = y > 0 ? 2 : 3;
    across = (y > 0 ? x : -x) / ay;
    upward = z / ay;
  } else {
    side = z > 0 ? 4 : 5;
    across = -y / az;
    upward = (z > 0 ? -x : x) / az;
  }
  const { width, height, rgb } = sky.sides[side];
  const column = Math.min(width - 1, Math.max(0, ((across + 1) / 2) * width - 0.5));
  const row = Math.min(height - 1, Math.max(0, (1 - (upward + 1) / 2) * height - 0.5));
  const column0 = Math.floor(column);
  const row0 = Math.floor(row);
  const column1 = Math.min(width - 1, column0 + 1);
  const row1 = Math.min(height - 1, row0 + 1);
  const shareX = column - column0;
  const shareY = row - row0;
  const a = (row0 * width + column0) * 3;
  const b = (row0 * width + column1) * 3;
  const c = (row1 * width + column0) * 3;
  const d = (row1 * width + column1) * 3;
  for (let channel = 0; channel < 3; channel++) {
    const upper = rgb[a + channel] + (rgb[b + channel] - rgb[a + channel]) * shareX;
    const lower = rgb[c + channel] + (rgb[d + channel] - rgb[c + channel]) * shareX;
    out[channel] = upper + (lower - upper) * shareY;
  }
  return out;
}

// ── making a sky ─────────────────────────────────────────────────────────────

/** A Targa 2.0 file's footer, as Valve's skies end: no extension or developer area, then the signature. */
const TGA_FOOTER = Buffer.concat([Buffer.alloc(8), Buffer.from("TRUEVISION-XFILE.\0", "latin1")]);

/** A picture `{ width, height, rgb }` as a Targa: 24 bits, not packed, rows from the bottom up, as the game's skies are. */
export function writeTga({ width, height, rgb }) {
  const head = Buffer.alloc(TGA.sizeof);
  head[TGA.kind] = TGA_COLOUR;
  head.writeUInt16LE(width, TGA.width);
  head.writeUInt16LE(height, TGA.height);
  head[TGA.bits] = 24;
  const body = Buffer.alloc(width * height * 3);
  for (let row = 0; row < height; row++)
    for (let column = 0; column < width; column++) {
      const from = (row * width + column) * 3;
      const to = ((height - 1 - row) * width + column) * 3;
      [body[to], body[to + 1], body[to + 2]] = [rgb[from + 2], rgb[from + 1], rgb[from]];
    }
  return Buffer.concat([head, body, TGA_FOOTER]);
}

/** The way out of the eye through a side's point (`across`, `upward`, each -1 to 1): skyColour's table, turned round. */
export function wayOfSide(side, across, upward) {
  return [
    [1, -across, upward],
    [-1, across, upward],
    [across, 1, upward],
    [-across, -1, upward],
    [-upward, -across, 1],
    [upward, -across, -1],
  ][side];
}

/** A day's sky and a night's, as `makeSky` takes them unless told otherwise. */
export const SKY_DAY = { zenith: [0.22, 0.42, 0.78], horizon: [0.72, 0.8, 0.9], ground: [0.33, 0.31, 0.27], haze: 0.25, clouds: { cover: 0.4, colour: [1, 1, 1], scale: 1, seed: 1 }, sun: { size: 3, colour: [1, 0.97, 0.88], glow: 12 }, stars: 0 };
export const SKY_NIGHT = { zenith: [0.01, 0.014, 0.04], horizon: [0.05, 0.06, 0.11], ground: [0.02, 0.02, 0.03], haze: 0.1, clouds: { cover: 0.15, colour: [0.16, 0.17, 0.22], scale: 1, seed: 1 }, sun: { size: 2, colour: [0.85, 0.88, 1], glow: 4 }, stars: 1 };
export const SKY_KEYS = ["night", "size", "zenith", "horizon", "ground", "haze", "clouds", "sun", "stars", "hills"];

/** A number from 0 to 1 for an integer cell and a seed: the same every run. */
const hashOf = (a, b, c, seed) => {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2147483647) ^ Math.imul(seed + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * A sky made from words: its six sides, each `size` square (256, as the game's), as `{ width, height, rgb }` in the
 * order of `SKY_SIDES`, and `mean`. Every pixel is the colour along its own way out of the eye, so the sides meet
 * with no seam. `desc` (each optional, colours 0 to 1):
 *   night        true: SKY_NIGHT's colours (a moon for the sun, stars), not SKY_DAY's
 *   zenith, horizon, ground   the colour overhead, at the horizon, and below it
 *   haze         0 to 1: how far up the horizon's colour reaches
 *   clouds       { cover 0 to 1, colour, scale (larger: bigger clouds), seed } or false
 *   sun          { yaw, pitch (where its light goes, as a light_environment's: pitch -60 is a sun 60 up, in the
 *                other direction), size and glow (degrees), colour } or false
 *   stars        0 to 1: how many
 *   hills        { height (degrees), colour, seed, roughness 0 to 1 }: a far skyline all round
 */
export function makeSky(desc = {}) {
  const unknown = Object.keys(desc).filter((key) => !SKY_KEYS.includes(key));
  if (unknown.length) throw new Error(`sky: ${unknown.join(", ")} is none of ${SKY_KEYS.join(", ")}`);
  const base = desc.night ? SKY_NIGHT : SKY_DAY;
  const d = { ...base, ...desc };
  const clouds = desc.clouds === false ? null : { ...base.clouds, ...(desc.clouds ?? {}) };
  const sunGiven = desc.sun === false ? null : { ...base.sun, yaw: 30, pitch: desc.night ? -70 : -60, ...(desc.sun ?? {}) };
  const hills = desc.hills ? { height: 4, colour: desc.night ? [0.02, 0.025, 0.04] : [0.32, 0.38, 0.42], seed: 3, roughness: 0.5, ...desc.hills } : null;
  const size = d.size ?? 256;
  const rad = Math.PI / 180;
  // the sun stands against the way its light goes: turned half round, as high as its light comes down steep
  const sunWay = sunGiven
    ? [Math.cos(-sunGiven.pitch * rad) * Math.cos((sunGiven.yaw + 180) * rad), Math.cos(-sunGiven.pitch * rad) * Math.sin((sunGiven.yaw + 180) * rad), Math.sin(-sunGiven.pitch * rad)]
    : null;
  const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
  const colourOf = (way) => {
    const length = Math.hypot(...way);
    const [x, y, z] = way.map((v) => v / length);
    const up = Math.asin(Math.max(-1, Math.min(1, z))) / rad;
    // the air: the horizon's colour low, the zenith's high, the ground's under
    let c = up >= 0 ? mix(d.horizon, d.zenith, Math.pow(Math.min(1, up / 90), Math.max(0.15, 1 - d.haze) * 0.6)) : mix(d.horizon, d.ground, Math.min(1, -up / 6));
    // the sun's glow, then the clouds over it, then its disc where they are thin
    let sunAt = 0;
    if (sunWay) {
      const angle = Math.acos(Math.max(-1, Math.min(1, x * sunWay[0] + y * sunWay[1] + z * sunWay[2]))) / rad;
      c = mix(c, sunGiven.colour, 0.6 * Math.exp(-angle / sunGiven.glow));
      sunAt = angle < sunGiven.size ? 1 : angle < sunGiven.size * 1.3 ? (sunGiven.size * 1.3 - angle) / (sunGiven.size * 0.3) : 0;
    }
    if (d.stars && up > 2) {
      const k = 180;
      const cell = [Math.floor(x * k), Math.floor(y * k), Math.floor(z * k)];
      const r = hashOf(...cell, 7);
      if (r < 0.012 * d.stars) {
        const bright = 0.4 + 0.6 * hashOf(...cell, 11);
        c = mix(c, [1, 1, 1], bright * Math.min(1, up / 10));
      }
    }
    let shade = 0;
    if (clouds && up > 0.5) {
      // a plane of cloud over the eye: seen ever more slant toward the horizon, so ever smaller and thinner
      const k = 1.2 / clouds.scale;
      const [u, v] = [(x / z) * k, (y / z) * k];
      const n = W.fbm(u + 50, v + 50, clouds.seed, 5);
      const dense = Math.max(0, Math.min(1, (n - (1 - clouds.cover) * 0.75 - 0.2) * 4));
      shade = dense * Math.min(1, up / 15);
      const lit = mix(clouds.colour.map((v) => v * 0.72), clouds.colour, Math.max(0, Math.min(1, (n - 0.45) * 3)));
      c = mix(c, lit, shade);
    }
    if (sunAt) c = mix(c, sunGiven.colour.map((v) => Math.min(1, v * 1.15)), sunAt * (1 - shade * 0.9));
    if (hills) {
      // the skyline's height round the horizon: noise on a circle, so it closes
      const az = Math.atan2(y, x);
      const ridge = hills.height * (0.35 + 0.65 * W.fbm3([Math.cos(az) * 3, Math.sin(az) * 3, 0], 1, hills.seed, 2 + Math.round(hills.roughness * 4)));
      if (up < ridge) c = mix(hills.colour, d.horizon, Math.max(0, Math.min(0.35, (ridge - up) / (ridge * 3) + d.haze * 0.3)));
    }
    return c;
  };
  const sides = SKY_SIDES.map((_, side) => {
    const rgb = new Uint8Array(size * size * 3);
    for (let row = 0; row < size; row++)
      for (let column = 0; column < size; column++) {
        const c = colourOf(wayOfSide(side, ((column + 0.5) / size) * 2 - 1, 1 - ((row + 0.5) / size) * 2));
        for (let k = 0; k < 3; k++) rgb[(row * size + column) * 3 + k] = Math.round(255 * Math.max(0, Math.min(1, c[k])));
      }
    return { width: size, height: size, rgb };
  });
  const sum = [0, 0, 0];
  let counted = 0;
  for (const side of sides.slice(0, 4))
    for (let at = 0; at < side.rgb.length; at += 3 * MEAN_EVERY) {
      for (let k = 0; k < 3; k++) sum[k] += side.rgb[at + k];
      counted++;
    }
  return { sides, mean: sum.map((v) => Math.round(v / counted)) };
}

/** A sky's six files, named as the game looks for `skyname` `name`: [{ name: "gfx/env/<name><side>.tga", bytes }]. */
export const skyFiles = (name, sides) => sides.map((side, k) => ({ name: `gfx/env/${name}${SKY_SIDES[k]}.tga`, bytes: writeTga(side) }));
