// Pictures: RGB images cut down to the 256 colours a studio model's texture holds, and PNG and BMP files
// written and read, with nothing but Node's own zlib; JPEG files read (jpeg.mjs).
//
//   an image    { width, height, rgb }                    three bytes a pixel
//   a texture   { name, width, height, pixels, palette }  one palette index a pixel, 768 bytes of palette
import { deflateSync, inflateSync } from "node:zlib";
import { unjpeg } from "./jpeg.mjs";

// ── a texture ──────────────────────────────────────────────────────────────
/** The colours a texture's palette holds, and its size: three bytes (r g b) a colour. */
const PALETTE_COLOURS = 256;
const PALETTE = PALETTE_COLOURS * 3;
/** The texture flag for a mesh drawn masked (STUDIO_NF_MASKED), and the palette index that is then a hole. */
const TEX_MASKED = 64;
const HOLE = 255;
/** Alpha from which a pixel counts as solid; under it, it is a hole. */
const SOLID_ALPHA = 128;

// ── the PNG format ─────────────────────────────────────────────────────────
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** The signature's first four bytes as one number. */
const PNG_MAGIC = 0x89504e47;
// A chunk: its data's length (4 bytes, big endian), its type (4 letters), the data, and a CRC of the type and
// the data (4 bytes).
const CHUNK = { length: 0, type: 4, data: 8 };
const CHUNK_CRC = 4;
// The IHDR chunk's data
const IHDR = {
  width: 0,
  height: 4,
  bitDepth: 8,
  colourType: 9,
  compression: 10,
  filter: 11,
  interlace: 12,
  sizeof: 13,
};
/** IHDR's colour types, and how many bytes a pixel each takes at 8 bits a channel. */
const GREY = 0;
const RGB = 2;
const PALETTED = 3;
const GREY_ALPHA = 4;
const RGBA = 6;
/** The filter each row of pixels begins with: what was taken from every byte before it was packed. */
const FILTER_SUB = 1;
const FILTER_UP = 2;
const FILTER_AVERAGE = 3;
const FILTER_PAETH = 4;

// ── the BMP format ─────────────────────────────────────────────────────────
// BITMAPFILEHEADER, at the file's start
const BMP_FILE = { type: 0, size: 2, offBits: 10, sizeof: 14 };
// BITMAPINFOHEADER, after it: these are places in the file, the file header's 14 bytes counted in
const BMP_INFO = {
  size: 14,
  width: 18,
  height: 22, // over 0: the rows go from the bottom up
  planes: 26,
  bitCount: 28,
  compression: 30,
  sizeImage: 34,
  clrUsed: 46,
  sizeof: 40,
};
/** A colour of a BMP's palette: blue, green, red and a byte of nothing. */
const BMP_COLOUR = 4;
/** Where the pixels of an 8 bit BMP written here begin: after the two headers and 256 colours. */
const BMP_PIXELS = BMP_FILE.sizeof + BMP_INFO.sizeof + PALETTE_COLOURS * BMP_COLOUR;

// ── PNG ────────────────────────────────────────────────────────────────────
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc = (bytes) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data) => {
  const chunk = Buffer.alloc(CHUNK.data + data.length + CHUNK_CRC);
  chunk.writeUInt32BE(data.length, CHUNK.length);
  chunk.write(type, CHUNK.type, "latin1");
  data.copy(chunk, CHUNK.data);
  const end = CHUNK.data + data.length;
  chunk.writeUInt32BE(crc(chunk.subarray(CHUNK.type, end)), end);
  return chunk;
};
export function png(width, height, rgba) {
  const header = Buffer.alloc(IHDR.sizeof);
  header.writeUInt32BE(width, IHDR.width);
  header.writeUInt32BE(height, IHDR.height);
  header[IHDR.bitDepth] = 8;
  header[IHDR.colourType] = RGBA;
  // each row: a filter byte (0: none) and its pixels
  const stride = width * 4;
  const rows = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++)
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(rows, y * (stride + 1) + 1);
  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
/**
 * An animated PNG (APNG): `frames` (each `rgba` of `width` x `height`), each shown `delay` milliseconds, played
 * over and over (`plays` 0) or that many times. Browsers, Discord and most viewers play it; one that does not
 * shows the first frame.
 */
export function apng(width, height, frames, { delay = 100, plays = 0 } = {}) {
  const header = Buffer.alloc(IHDR.sizeof);
  header.writeUInt32BE(width, IHDR.width);
  header.writeUInt32BE(height, IHDR.height);
  header[IHDR.bitDepth] = 8;
  header[IHDR.colourType] = RGBA;
  const control = Buffer.alloc(8);
  control.writeUInt32BE(frames.length, 0);
  control.writeUInt32BE(plays, 4);
  const chunks = [Buffer.from(PNG_SIGNATURE), pngChunk("IHDR", header), pngChunk("acTL", control)];
  let sequence = 0;
  const stride = width * 4;
  frames.forEach((rgba, n) => {
    // the frame's control: its size, place, how long it is shown, and nothing kept of the frame before
    const fc = Buffer.alloc(26);
    fc.writeUInt32BE(sequence++, 0);
    fc.writeUInt32BE(width, 4);
    fc.writeUInt32BE(height, 8);
    fc.writeUInt32BE(0, 12);
    fc.writeUInt32BE(0, 16);
    fc.writeUInt16BE(Math.round(delay), 20);
    fc.writeUInt16BE(1000, 22);
    fc[24] = 0;
    fc[25] = 0;
    chunks.push(pngChunk("fcTL", fc));
    const rows = Buffer.alloc(height * (stride + 1));
    for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(rows, y * (stride + 1) + 1);
    const data = deflateSync(rows);
    if (n === 0) chunks.push(pngChunk("IDAT", data));
    else {
      const seq = Buffer.alloc(4);
      seq.writeUInt32BE(sequence++, 0);
      chunks.push(pngChunk("fdAT", Buffer.concat([seq, data])));
    }
  });
  chunks.push(pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(chunks);
}
/**
 * What a filter took from a byte: worked out from the byte to its left, the one above and the one above left.
 */
function filtered(filter, left, up, upLeft) {
  if (filter === FILTER_SUB) return left;
  if (filter === FILTER_UP) return up;
  if (filter === FILTER_AVERAGE) return (left + up) >> 1;
  if (filter === FILTER_PAETH) {
    // whichever of the three is nearest to left + up - upLeft
    const guess = left + up - upLeft;
    const fromLeft = Math.abs(guess - left);
    const fromUp = Math.abs(guess - up);
    const fromUpLeft = Math.abs(guess - upLeft);
    if (fromLeft <= fromUp && fromLeft <= fromUpLeft) return left;
    return fromUp <= fromUpLeft ? up : upLeft;
  }
  return 0;
}
/** The channels of each colour type of PNG's. */
const CHANNELS = { [GREY]: 1, [RGB]: 3, [PALETTED]: 1, [GREY_ALPHA]: 2, [RGBA]: 4 };
/** The bit depths each colour type may have. */
const DEPTHS = { [GREY]: [1, 2, 4, 8, 16], [RGB]: [8, 16], [PALETTED]: [1, 2, 4, 8], [GREY_ALPHA]: [8, 16], [RGBA]: [8, 16] };
/** Adam7's seven passes over an interlaced picture: where each starts and how far it steps, [x, y, dx, dy]. */
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]; // prettier-ignore
/**
 * A PNG file read: { width, height, rgba }. Every kind the format has: grey, RGB, a palette, with or without
 * alpha, of 1 to 16 bits a channel, interlaced or not (16 bits are kept to their upper 8; a grey of fewer bits
 * is stretched to 0 to 255; tRNS gives a palette its alphas and a grey or RGB picture its see-through colour).
 */
export function unpng(buf) {
  if (buf.length < PNG_SIGNATURE.length || buf.readUInt32BE(0) !== PNG_MAGIC)
    throw new Error("not a PNG file");
  let width = 0;
  let height = 0;
  let kind = RGBA;
  let depth = 8;
  let interlaced = false;
  // PLTE: the palette of a paletted picture; tRNS: an alpha for each of its colours, or the see-through colour
  let palette = null;
  let alphas = null;
  const packed = [];
  for (let at = PNG_SIGNATURE.length; at < buf.length; ) {
    const length = buf.readUInt32BE(at + CHUNK.length);
    const type = buf.toString("latin1", at + CHUNK.type, at + CHUNK.data);
    const data = buf.subarray(at + CHUNK.data, at + CHUNK.data + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(IHDR.width);
      height = data.readUInt32BE(IHDR.height);
      kind = data[IHDR.colourType];
      depth = data[IHDR.bitDepth];
      interlaced = data[IHDR.interlace] === 1;
      if (CHANNELS[kind] === undefined)
        throw new Error(
          `a PNG of colour type ${kind} is not one that is read: grey, RGB or a palette, with or without alpha (types 0, 2, 3, 4 and 6)`,
        );
      if (!DEPTHS[kind].includes(depth)) throw new Error(`a PNG of colour type ${kind} has no bit depth ${depth}`);
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") alphas = data;
    else if (type === "IDAT") packed.push(data);
    at += CHUNK.data + length + CHUNK_CRC;
  }
  const channels = CHANNELS[kind];
  const bits = channels * depth;
  // a filter works byte by byte, against the byte of the pixel to its left (a whole byte for fewer bits)
  const step = Math.max(1, bits >> 3);
  const most = (1 << depth) - 1;
  // the see-through colour of a grey or RGB picture, in its own bits
  const key = alphas && (kind === GREY || kind === RGB) ? Array.from({ length: channels }, (_, c) => alphas.readUInt16BE(c * 2)) : null;
  const raw = inflateSync(Buffer.concat(packed));
  const rgba = new Uint8Array(width * height * 4);
  const sample = new Array(4);
  let at = 0;
  for (const [x0, y0, dx, dy] of interlaced ? ADAM7 : [[0, 0, 1, 1]]) {
    const across = Math.ceil((width - x0) / dx);
    const down = Math.ceil((height - y0) / dy);
    if (across <= 0 || down <= 0) continue;
    const stride = Math.ceil((across * bits) / 8);
    let above = new Uint8Array(stride);
    for (let row = 0; row < down; row++) {
      const filter = raw[at++];
      // a Uint8Array: the sum of a byte and what the filter took from it wraps round at 256, as it has to
      const line = new Uint8Array(stride);
      for (let x = 0; x < stride; x++) {
        const left = x >= step ? line[x - step] : 0;
        const upLeft = x >= step ? above[x - step] : 0;
        line[x] = raw[at++] + filtered(filter, left, above[x], upLeft);
      }
      const y = y0 + row * dy;
      for (let n = 0; n < across; n++) {
        for (let c = 0; c < channels; c++) {
          const bit = (n * channels + c) * depth;
          sample[c] =
            depth === 16 ? (line[bit >> 3] << 8) | line[(bit >> 3) + 1] : depth === 8 ? line[bit >> 3] : (line[bit >> 3] >> (8 - depth - (bit & 7))) & most; // prettier-ignore
        }
        setRgba(rgba, (y * width + x0 + n * dx) * 4, sample, kind, depth, palette, alphas, key);
      }
      above = line;
    }
  }
  return { width, height, rgba };
}
/**
 * One pixel of a PNG (`v`: its samples, in their own bits) written as RGBA at `i`: 16 bits kept to their upper
 * 8, a grey of fewer than 8 stretched to 0 to 255, a palette's index looked up.
 */
function setRgba(rgba, i, v, kind, depth, palette, alphas, key) {
  const eight = (value) => (depth === 16 ? value >> 8 : depth === 8 ? value : Math.round((value * 255) / ((1 << depth) - 1)));
  if (kind === PALETTED) {
    rgba[i] = palette[v[0] * 3];
    rgba[i + 1] = palette[v[0] * 3 + 1];
    rgba[i + 2] = palette[v[0] * 3 + 2];
    rgba[i + 3] = alphas && v[0] < alphas.length ? alphas[v[0]] : 255;
  } else if (kind === GREY || kind === GREY_ALPHA) {
    rgba[i] = rgba[i + 1] = rgba[i + 2] = eight(v[0]);
    rgba[i + 3] = kind === GREY_ALPHA ? eight(v[1]) : key && v[0] === key[0] ? 0 : 255;
  } else {
    rgba[i] = eight(v[0]);
    rgba[i + 1] = eight(v[1]);
    rgba[i + 2] = eight(v[2]);
    rgba[i + 3] = kind === RGBA ? eight(v[3]) : key && v[0] === key[0] && v[1] === key[1] && v[2] === key[2] ? 0 : 255;
  }
}
/**
 * A palette image as RGBA; with `masked`, the last colour of the palette is see-through, as in the engine.
 */
export function rgbaOf({ width, height, pixels, palette }, masked = false) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const colour = pixels[i];
    rgba[i * 4] = palette[colour * 3];
    rgba[i * 4 + 1] = palette[colour * 3 + 1];
    rgba[i * 4 + 2] = palette[colour * 3 + 2];
    rgba[i * 4 + 3] = masked && colour === HOLE ? 0 : 255;
  }
  return rgba;
}

// ── texture: smaller, and down to 256 colours ──────────────────────────────
export function shrink({ width, height, rgb }, k) {
  const w = Math.floor(width / k);
  const h = Math.floor(height / k);
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        // the mean of a block of k by k pixels
        let sum = 0;
        for (let j = 0; j < k; j++)
          for (let i = 0; i < k; i++) sum += rgb[((y * k + j) * width + x * k + i) * 3 + c];
        out[(y * w + x) * 3 + c] = Math.round(sum / (k * k));
      }
  return { width: w, height: h, rgb: out };
}

/** The colour at `i` of an image's bytes as one number, 6 bits a channel: colours that near count as one. */
const colourKey = (rgb, i) => ((rgb[i] >> 2) << 12) | ((rgb[i + 1] >> 2) << 6) | (rgb[i + 2] >> 2);
/** The colours an image uses, by colourKey: [{ n: how many pixels, c: their mean [r, g, b] }]. */
function coloursIn(rgb) {
  const byKey = new Map();
  for (let i = 0; i < rgb.length; i += 3) {
    const key = colourKey(rgb, i);
    let entry = byKey.get(key);
    if (!entry) byKey.set(key, (entry = { n: 0, c: [0, 0, 0] }));
    entry.n++;
    entry.c[0] += rgb[i];
    entry.c[1] += rgb[i + 1];
    entry.c[2] += rgb[i + 2];
  }
  return [...byKey.values()].map((entry) => ({ n: entry.n, c: entry.c.map((sum) => sum / entry.n) }));
}
/** The channel a list of colours is widest in (`a`: 0 red, 1 green, 2 blue) and how wide (`w`). */
function widestChannel(colours) {
  let best = { w: -1 };
  for (let a = 0; a < 3; a++) {
    let lo = 255;
    let hi = 0;
    for (const colour of colours) {
      lo = Math.min(lo, colour.c[a]);
      hi = Math.max(hi, colour.c[a]);
    }
    if (hi - lo > best.w) best = { w: hi - lo, a };
  }
  return best;
}
/**
 * Median cut: the colours in boxes, `most` of them at the most. The box that is widest in some channel is
 * cut in two across that channel, where half of its pixels are on each side, until there are enough boxes or
 * none holds more than one colour. Returns the boxes: [{ list: its colours }].
 */
function medianCut(colours, most) {
  let boxes = [{ list: colours, ...widestChannel(colours) }];
  while (boxes.length < most) {
    const box = boxes.filter((x) => x.list.length > 1).sort((x, y) => y.w - x.w)[0];
    if (!box) break;
    const sorted = box.list.sort((x, y) => x.c[box.a] - y.c[box.a]);
    const half = sorted.reduce((sum, colour) => sum + colour.n, 0) / 2;
    let cut = 0;
    let pixels = 0;
    while (cut < sorted.length - 1 && pixels + sorted[cut].n <= half) pixels += sorted[cut++].n;
    cut = Math.max(1, cut);
    boxes = boxes
      .filter((x) => x !== box)
      .concat([sorted.slice(0, cut), sorted.slice(cut)].map((list) => ({ list, ...widestChannel(list) })));
  }
  return boxes;
}
/**
 * An image as a texture: median cut over the colours in use (counted in 6 bits a channel), down to `most`.
 */
export function indexed({ width, height, rgb }, name, most = 256) {
  const boxes = medianCut(coloursIn(rgb), most);
  // a box's colour in the palette: the mean of its colours, each weighed by its pixels
  const palette = new Uint8Array(PALETTE);
  boxes.forEach((box, i) => {
    const pixelsInBox = box.list.reduce((sum, colour) => sum + colour.n, 0);
    for (let a = 0; a < 3; a++)
      palette[i * 3 + a] = Math.round(
        box.list.reduce((sum, colour) => sum + colour.c[a] * colour.n, 0) / pixelsInBox,
      );
  });
  // each pixel takes the nearest colour of the palette, found once for each colourKey
  const nearestOf = new Map();
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i++) {
    const key = colourKey(rgb, i * 3);
    let nearest = nearestOf.get(key);
    if (nearest === undefined) {
      let least = 1e9;
      for (let j = 0; j < boxes.length; j++) {
        const distance =
          (palette[j * 3] - rgb[i * 3]) ** 2 +
          (palette[j * 3 + 1] - rgb[i * 3 + 1]) ** 2 +
          (palette[j * 3 + 2] - rgb[i * 3 + 2]) ** 2;
        if (distance < least) {
          least = distance;
          nearest = j;
        }
      }
      nearestOf.set(key, nearest);
    }
    pixels[i] = nearest;
  }
  return { name, width, height, pixels, palette };
}

// ── pictures with holes, and files of other kinds ──────────────────────────
/** RGBA as an image: the alpha is dropped. */
export function rgbOf({ width, height, rgba }) {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
  return { width, height, rgb };
}
/**
 * RGBA as a texture with holes, for a mesh drawn masked (the texture's flag 64): 255 colours, and the last
 * one of the palette where the picture is see-through (alpha under 128). `key` is the colour written there,
 * which nobody sees.
 */
export function masked({ width, height, rgba }, name, key = [0, 0, 255]) {
  const image = rgbOf({ width, height, rgba });
  const solid = Array.from({ length: width * height }, (_, i) => rgba[i * 4 + 3] >= SOLID_ALPHA);
  const first = solid.indexOf(true);
  // a hole takes a colour the picture already has, so it costs the palette nothing
  if (first >= 0)
    for (let i = 0; i < solid.length; i++)
      if (!solid[i]) image.rgb.set(image.rgb.subarray(first * 3, first * 3 + 3), i * 3);
  const texture = indexed(image, name, PALETTE_COLOURS - 1);
  for (let i = 0; i < solid.length; i++) if (!solid[i]) texture.pixels[i] = HOLE;
  texture.palette.set(key, HOLE * 3);
  return { ...texture, flags: TEX_MASKED };
}
/**
 * A texture as a BMP file of 8 bits: its palette as it is, index for index (what a model's texture was made
 * from).
 */
export function bmp({ width, height, pixels, palette }) {
  // a row of pixels takes a multiple of four bytes
  const row = (width + 3) & ~3;
  const out = Buffer.alloc(BMP_PIXELS + row * height);
  out.write("BM", BMP_FILE.type, "latin1");
  out.writeUInt32LE(out.length, BMP_FILE.size);
  out.writeUInt32LE(BMP_PIXELS, BMP_FILE.offBits);
  out.writeUInt32LE(BMP_INFO.sizeof, BMP_INFO.size);
  out.writeInt32LE(width, BMP_INFO.width);
  out.writeInt32LE(height, BMP_INFO.height);
  out.writeUInt16LE(1, BMP_INFO.planes);
  out.writeUInt16LE(8, BMP_INFO.bitCount);
  out.writeUInt32LE(row * height, BMP_INFO.sizeImage);
  out.writeUInt32LE(PALETTE_COLOURS, BMP_INFO.clrUsed);
  const colours = BMP_FILE.sizeof + BMP_INFO.sizeof;
  for (let i = 0; i < PALETTE_COLOURS; i++) {
    out[colours + i * BMP_COLOUR] = palette[i * 3 + 2];
    out[colours + i * BMP_COLOUR + 1] = palette[i * 3 + 1];
    out[colours + i * BMP_COLOUR + 2] = palette[i * 3];
  }
  // the rows from the bottom up
  for (let y = 0; y < height; y++)
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width, width).copy(
      out,
      BMP_PIXELS + (height - 1 - y) * row,
    );
  return out;
}
/**
 * A BMP file read, not compressed: of 8 bits, a texture { width, height, pixels, palette } with its palette
 * kept as it is; of 24 or 32, an image { width, height, rgb }.
 */
export function unbmp(buf) {
  if (buf.toString("latin1", BMP_FILE.type, BMP_FILE.type + 2) !== "BM") throw new Error("not a BMP file");
  const pixelsAt = buf.readUInt32LE(BMP_FILE.offBits);
  const infoSize = buf.readUInt32LE(BMP_INFO.size);
  const width = buf.readInt32LE(BMP_INFO.width);
  const storedHeight = buf.readInt32LE(BMP_INFO.height);
  const height = Math.abs(storedHeight);
  const bits = buf.readUInt16LE(BMP_INFO.bitCount);
  if (buf.readUInt32LE(BMP_INFO.compression) !== 0 || ![8, 24, 32].includes(bits))
    throw new Error("a BMP of 8, 24 or 32 bits, not compressed, is what is read");
  // a row takes a multiple of four bytes; the rows go from the bottom up unless the height is under 0
  const row = ((width * bits + 31) >> 5) << 2;
  const rowAt = (y) => pixelsAt + (storedHeight > 0 ? height - 1 - y : y) * row;
  if (bits === 8) {
    const used = buf.readUInt32LE(BMP_INFO.clrUsed) || PALETTE_COLOURS;
    const palette = new Uint8Array(PALETTE);
    const pixels = new Uint8Array(width * height);
    for (let i = 0; i < used; i++) {
      const colour = BMP_FILE.sizeof + infoSize + i * BMP_COLOUR;
      palette[i * 3] = buf[colour + 2];
      palette[i * 3 + 1] = buf[colour + 1];
      palette[i * 3 + 2] = buf[colour];
    }
    for (let y = 0; y < height; y++) pixels.set(buf.subarray(rowAt(y), rowAt(y) + width), y * width);
    return { width, height, pixels, palette };
  }
  const rgb = new Uint8Array(width * height * 3);
  const bytesAPixel = bits / 8;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const pixel = rowAt(y) + x * bytesAPixel;
      rgb[(y * width + x) * 3] = buf[pixel + 2];
      rgb[(y * width + x) * 3 + 1] = buf[pixel + 1];
      rgb[(y * width + x) * 3 + 2] = buf[pixel];
    }
  return { width, height, rgb };
}
/** Whether a file's bytes are a JPEG's. */
const isJpeg = (buf) => buf[0] === 0xff && buf[1] === 0xd8;

/**
 * A picture file of any kind the kit reads (PNG, BMP of 8, 24 or 32 bits, JPEG) as { width, height, rgba }: what
 * a spec's pictures (a reference, a projected view, a material's photo) are read by.
 */
export function unpicture(buf) {
  const bytes = Buffer.from(buf.buffer ?? buf, buf.byteOffset ?? 0, buf.length);
  const opaque = ({ width, height, rgb }) => {
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) rgba.set([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], 255], i * 4);
    return { width, height, rgba };
  };
  if (isJpeg(bytes)) return opaque(unjpeg(bytes));
  if (bytes.toString("latin1", BMP_FILE.type, BMP_FILE.type + 2) === "BM") {
    const read = unbmp(bytes);
    return read.pixels ? { width: read.width, height: read.height, rgba: rgbaOf(read) } : opaque(read);
  }
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === PNG_MAGIC) return unpng(bytes);
  throw new Error("not a picture the kit reads: PNG, BMP or JPEG");
}

/**
 * A picture file (PNG, BMP or JPEG) as a texture for a model. A BMP of 8 bits keeps its palette index for index;
 * anything else is cut down to 256 colours, or, with `holes` and a see-through PNG, to 255 and the last for
 * the holes (see masked).
 */
export function textureFrom(buf, name, { holes = false } = {}) {
  if (buf.toString("latin1", BMP_FILE.type, BMP_FILE.type + 2) === "BM") {
    const read = unbmp(buf);
    return read.pixels ? { name, ...read } : indexed(read, name);
  }
  if (isJpeg(buf)) return indexed(unjpeg(buf), name);
  const image = unpng(buf);
  return holes && image.rgba.some((v, i) => i % 4 === 3 && v < SOLID_ALPHA)
    ? masked(image, name)
    : indexed(rgbOf(image), name);
}
