// A map texture as GoldSrc keeps it, inside a map or inside a .wad: a name, a size, the picture at four sizes
// (each half the one before) as palette indices, and then its own palette of 256 colours.
//
//   a map texture   { name, width, height, pixels, palette, mips, holes }
//                   `pixels` is the full size picture, one palette index a pixel (the same bytes as mips[0]);
//                   `palette` 768 bytes (r g b); `holes`: palette index 255 is see-through
//
// It is the kit's texture ({ name, width, height, pixels, palette }) with the smaller sizes added, so that
// the
// functions of image.mjs (rgbaOf, bmp) take it as it is.
import { indexed, masked, rgbaOf } from "../image.mjs";

// ── the format ─────────────────────────────────────────────────────────────
/** A texture's name is char[16], closed by a zero byte: fifteen letters at the most. */
const NAME_ROOM = 16;
/** The most letters a texture's name has. */
export const LONGEST_NAME = NAME_ROOM - 1;
const UINT32 = 4;
/** The picture is kept at four sizes: whole, a half, a quarter and an eighth. */
export const MIP_LEVELS = 4;
// miptex_t: `offsets` are where each size's pixels begin, counted from this header's start. All four are 0
// in a map whose texture is to be taken from a .wad file.
const MIPTEX = { name: 0, width: 16, height: 20, offsets: 24, sizeof: 24 + MIP_LEVELS * UINT32 };
/**
 * After the smallest size: how many colours (16 bits), the colours, and two bytes to end on a multiple of 4.
 */
const COLOUR_COUNT = 2;
const PALETTE_COLOURS = 256;
const PALETTE = PALETTE_COLOURS * 3;
const PALETTE_PAD = 2;
/** Both engines refuse a texture whose sides are not multiples of 16: the eighth size must be whole. */
export const TEXTURE_GRID = 16;
/** In a texture whose name begins with `{`, this palette index is a hole. */
export const HOLE = 255;
const HOLES_PREFIX = "{";
/**
 * Making a smaller size of a texture with holes: a block of pixels in which this share or less is solid
 * becomes a hole. It is the 40% of qlumpy, the tool the game's own textures were made with, as its GrabMip
 * is remembered: its source was not at hand.
 */
const SOLID_SHARE = 0.4;

// ── small tools ────────────────────────────────────────────────────────────
/** The text of a name: up to its zero byte. */
const nameAt = (bytes, at) => {
  const end = bytes.indexOf(0, at);
  return bytes.toString("latin1", at, end < 0 || end > at + NAME_ROOM ? at + NAME_ROOM : end);
};
/** How many pixels size `level` of a picture has. */
const mipPixels = (width, height, level) => (width >> level) * (height >> level);
/** The pixels of all four sizes together. */
const allMipPixels = (width, height) => {
  let pixels = 0;
  for (let level = 0; level < MIP_LEVELS; level++) pixels += mipPixels(width, height, level);
  return pixels;
};

/** How many bytes a texture of this size takes in a map or a .wad, header and palette counted in. */
export const miptexSize = (width, height) =>
  MIPTEX.sizeof + allMipPixels(width, height) + COLOUR_COUNT + PALETTE + PALETTE_PAD;

/** Whether a texture of this name has holes: the engine goes by the name's first letter. */
export const hasHoles = (name) => name.startsWith(HOLES_PREFIX);

/**
 * What a texture's name tells the engine and the compilers to do with it: `{ holes, sky, water, animated,
 * frame, random, lit, tool }`. `{name`: index 255 is a hole; `sky`: not drawn, the sky shows; `!name` and
 * `water...`: a liquid that moves; `+0name`..`+9name`: a frame of an animation (`+a`..`+j`: of its other
 * state); `-0name`: one of several tiled at random; `~name`: lit by the compilers' lights.rad; `tool`: a
 * name the compilers use up and never draw (clip, origin, null, hint, skip, aaatrigger and the like).
 */
export function textureKind(name) {
  const lower = name.toLowerCase();
  const animated = /^\+[0-9a-j]/.test(lower);
  return {
    holes: hasHoles(name),
    sky: lower.startsWith("sky"),
    water: lower.startsWith("!") || lower.startsWith("water"),
    animated,
    frame: animated ? lower[1] : null,
    random: /^-[0-9]/.test(lower),
    lit: lower.includes("~"),
    tool: ["clip", "origin", "null", "hint", "skip", "aaatrigger", "bevel", "contentwater"].includes(lower),
  };
}

// ── reading ────────────────────────────────────────────────────────────────
/**
 * What a texture's header says, with nothing decoded: `{ name, width, height, offsets, embedded }`. `at` is
 * where the miptex_t begins in `bytes`; `embedded` is false when the pixels are not here but in a .wad.
 */
export function miptexHeader(bytes, at) {
  if (at < 0 || at + MIPTEX.sizeof > bytes.length)
    throw new RangeError(`a texture's header at ${at} runs past the end of its ${bytes.length} bytes`);
  const offsets = [];
  for (let level = 0; level < MIP_LEVELS; level++)
    offsets.push(bytes.readUInt32LE(at + MIPTEX.offsets + level * UINT32));
  return {
    name: nameAt(bytes, at + MIPTEX.name),
    width: bytes.readUInt32LE(at + MIPTEX.width),
    height: bytes.readUInt32LE(at + MIPTEX.height),
    offsets,
    embedded: offsets[0] !== 0,
  };
}

/**
 * Where the engine looks for a texture's palette: straight after the four sizes, taken to follow the header
 * one after another (GoldSrc's Mod_LoadTextures does not read the offsets for this).
 */
export const enginePaletteAt = (header) =>
  MIPTEX.sizeof + allMipPixels(header.width, header.height) + COLOUR_COUNT;

/**
 * The texture whose miptex_t begins at `at` in `bytes`: `{ name, width, height, pixels, palette, mips,
 * holes, colours }`, or null when its pixels are not here but wanted from a .wad. The pixels are views of
 * `bytes`, not copies. Throws, naming the texture, when it is cut short or its size is not one the engine
 * takes.
 */
export function readMiptex(bytes, at) {
  const header = miptexHeader(bytes, at);
  if (!header.embedded) return null;
  const { name, width, height, offsets } = header;
  if (!width || !height || width % TEXTURE_GRID || height % TEXTURE_GRID)
    throw new Error(
      `the texture ${name} is ${width}x${height}: both sides must be multiples of ${TEXTURE_GRID}`,
    );
  const mips = offsets.map((offset, level) => {
    const start = at + offset;
    const end = start + mipPixels(width, height, level);
    if (end > bytes.length)
      throw new RangeError(`the texture ${name} is cut short: its pixels run past the end`);
    return bytes.subarray(start, end);
  });
  // the palette follows the smallest size: a count of colours, then the colours
  const countAt = at + offsets[MIP_LEVELS - 1] + mipPixels(width, height, MIP_LEVELS - 1);
  if (countAt + COLOUR_COUNT > bytes.length)
    throw new RangeError(`the texture ${name} is cut short: it has no palette`);
  const colours = Math.min(bytes.readUInt16LE(countAt), PALETTE_COLOURS);
  const coloursAt = countAt + COLOUR_COUNT;
  if (coloursAt + colours * 3 > bytes.length)
    throw new RangeError(`the texture ${name} is cut short: its palette runs past the end`);
  let palette = bytes.subarray(coloursAt, coloursAt + colours * 3);
  if (colours < PALETTE_COLOURS) {
    // a short palette is filled out with black, so that every index has a colour
    const whole = new Uint8Array(PALETTE);
    whole.set(palette);
    palette = whole;
  }
  return { name, width, height, pixels: mips[0], palette, mips, holes: hasHoles(name), colours };
}

/**
 * A map texture as a picture: `{ width, height, rgba }`, at full size or at one of the smaller ones
 * (`level` 1 to 3). A hole has alpha 0.
 */
export function textureRgba(texture, level = 0) {
  const width = texture.width >> level;
  const height = texture.height >> level;
  const pixels = texture.mips ? texture.mips[level] : texture.pixels;
  if (!pixels || (level && !texture.mips))
    throw new Error(`the texture ${texture.name} has no size ${level}`);
  const holes = texture.holes ?? hasHoles(texture.name);
  return { width, height, rgba: rgbaOf({ width, height, pixels, palette: texture.palette }, holes) };
}

/**
 * A decal (a texture of a decals.wad: `{shot1`, `{blood1`) as the engine draws it (Xash imagelib img_wad.c and
 * img_utils.c; stevenlafl's convert-decals): `{ width, height, rgba, gradient }`. A palette whose last colour is pure
 * blue makes it masked, each pixel its colour and index 255 a hole; any other a gradient, every pixel that last colour
 * with its index as its alpha (LUMP_GRADIENT: blood).
 */
export function decalRgba(texture) {
  const { width, height, pixels, palette } = texture;
  const last = palette.subarray(HOLE * 3, HOLE * 3 + 3);
  const gradient = !(last[0] === 0 && last[1] === 0 && last[2] === 255);
  if (!gradient) return { width, height, rgba: rgbaOf({ width, height, pixels, palette }, true), gradient };
  const rgba = new Uint8Array(width * height * 4);
  pixels.forEach((index, i) => rgba.set([last[0], last[1], last[2], index], i * 4));
  return { width, height, rgba, gradient };
}

// ── writing ────────────────────────────────────────────────────────────────
/** The colour of the palette nearest to r g b, among its first `count` colours. */
function nearestColour(palette, count, red, green, blue) {
  let nearest = 0;
  let least = Infinity;
  for (let colour = 0; colour < count; colour++) {
    const distance =
      (palette[colour * 3] - red) ** 2 +
      (palette[colour * 3 + 1] - green) ** 2 +
      (palette[colour * 3 + 2] - blue) ** 2;
    if (distance < least) {
      least = distance;
      nearest = colour;
    }
  }
  return nearest;
}

/**
 * One smaller size of a picture: each pixel is a block of `step` by `step` pixels of the full size, their
 * colours averaged and the palette's nearest colour taken. With `holes`, the holes of a block are left out
 * of the average, and a block that is mostly holes is a hole. Measured against the games' own .wad files
 * (halflife.wad, gatecity.wad) this lands on the very index they keep for a third of the pixels and within
 * about 4 levels in 255 a channel on average: their tool also carried each pixel's error on to the next,
 * which is not done here.
 */
function shrunkMip({ width, height, pixels, palette }, level, holes) {
  const step = 1 << level;
  const mipWidth = width >> level;
  const mipHeight = height >> level;
  const fewest = Math.floor(step * step * SOLID_SHARE);
  const usable = holes ? HOLE : PALETTE_COLOURS;
  const mip = new Uint8Array(mipWidth * mipHeight);
  for (let y = 0; y < mipHeight; y++)
    for (let x = 0; x < mipWidth; x++) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let solid = 0;
      for (let j = 0; j < step; j++)
        for (let i = 0; i < step; i++) {
          const colour = pixels[(y * step + j) * width + x * step + i];
          if (holes && colour === HOLE) continue;
          red += palette[colour * 3];
          green += palette[colour * 3 + 1];
          blue += palette[colour * 3 + 2];
          solid++;
        }
      mip[y * mipWidth + x] =
        holes && solid <= fewest
          ? HOLE
          : nearestColour(palette, usable, red / solid, green / solid, blue / solid);
    }
  return mip;
}

/**
 * The four sizes of a texture, made from its full size picture: `[pixels, half, quarter, eighth]`.
 * `holes`: index 255 is a hole (by default, whether the name begins with `{`).
 */
export function mipsOf(texture, holes = hasHoles(texture.name ?? "")) {
  const mips = [Uint8Array.from(texture.pixels)];
  for (let level = 1; level < MIP_LEVELS; level++) mips.push(shrunkMip(texture, level, holes));
  return mips;
}

/** Whether a picture has a see-through pixel. */
const anySeeThrough = ({ width, height, rgba }) => {
  for (let pixel = 0; pixel < width * height; pixel++) if (rgba[pixel * 4 + 3] < 128) return true;
  return false;
};

/**
 * A map texture from what the kit has: `source` is `{ name, image }` with an image `{ width, height, rgb }`
 * or `{ width, height, rgba }` (cut down to 256 colours here; for a name that begins with `{`, to 255 and the
 * see-through pixels made holes), or a texture already cut down, `{ name, width, height, pixels, palette }`,
 * whose palette is kept index for index. Its smaller sizes are made unless it brings them (`mips`). Throws,
 * in words, for a name or a size the engine would not take.
 */
export function mapTexture(source) {
  const name = source.name;
  if (typeof name !== "string" || !name) throw new Error("a map texture needs a name");
  if (name.length > LONGEST_NAME)
    throw new Error(`the texture name ${name} is ${name.length} letters: a map's holds ${LONGEST_NAME}`);
  const holes = hasHoles(name);
  let texture = source;
  if (source.image) {
    const image = source.image;
    if (holes && !image.rgba)
      throw new Error(
        `the texture ${name} begins with { and so has holes: give its picture as rgba, see-through where the holes are`,
      );
    if (!holes && image.rgba && anySeeThrough(image))
      throw new Error(
        `the picture of ${name} has see-through pixels, and only a texture whose name begins with { has holes`,
      );
    if (holes) texture = masked(image, name);
    else if (image.rgb) texture = indexed(image, name);
    else texture = indexed({ ...image, rgb: rgbWithoutAlpha(image) }, name);
  }
  const { width, height, pixels, palette } = texture;
  if (!width || !height || width % TEXTURE_GRID || height % TEXTURE_GRID)
    throw new Error(
      `the texture ${name} is ${width}x${height}: both sides must be multiples of ${TEXTURE_GRID}, or the engine refuses the map`,
    );
  if (!pixels || pixels.length !== width * height)
    throw new Error(`the texture ${name} needs ${width * height} pixels, one palette index each`);
  if (!palette || palette.length !== PALETTE)
    throw new Error(`the texture ${name} needs a palette of ${PALETTE} bytes (256 colours, r g b)`);
  const sized = { name, width, height, pixels, palette };
  const mips = source.mips ?? mipsOf(sized, holes);
  return { ...sized, pixels: mips[0], mips, holes, colours: PALETTE_COLOURS };
}

/** The colours of an RGBA picture, three bytes a pixel. */
function rgbWithoutAlpha({ width, height, rgba }) {
  const rgb = new Uint8Array(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel++)
    rgb.set(rgba.subarray(pixel * 4, pixel * 4 + 3), pixel * 3);
  return rgb;
}

/**
 * A texture as the bytes a map or a .wad keeps: the header, the four sizes one after another, and the
 * palette. Takes what `mapTexture` takes.
 */
export function writeMiptex(source) {
  const texture = source.mips && source.palette ? source : mapTexture(source);
  const { name, width, height, mips, palette } = texture;
  const bytes = Buffer.alloc(miptexSize(width, height));
  bytes.write(name, MIPTEX.name, LONGEST_NAME, "latin1");
  bytes.writeUInt32LE(width, MIPTEX.width);
  bytes.writeUInt32LE(height, MIPTEX.height);
  let at = MIPTEX.sizeof;
  mips.forEach((mip, level) => {
    bytes.writeUInt32LE(at, MIPTEX.offsets + level * UINT32);
    bytes.set(mip, at);
    at += mip.length;
  });
  bytes.writeUInt16LE(PALETTE_COLOURS, at);
  bytes.set(palette, at + COLOUR_COUNT);
  return bytes;
}
