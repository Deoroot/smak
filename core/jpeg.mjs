// JPEG pictures read, with nothing but Node: what cameras, phones and the web write, so that a photo can be a
// material's reference, a texture, or a bought model's picture as a PNG is.
//
//   unjpeg(bytes, { orient })   { width, height, rgb, orientation }: eight bits a channel
//
// Read (ITU T.81): baseline and extended sequential (SOF0, SOF1) and progressive (SOF2) JPEG with Huffman
// coding, 8 bits a sample; one component (grey), three (YCbCr, or RGB when an Adobe marker says so) or four
// (CMYK, or YCCK, as Adobe writes them); each component sampled at 1 to 4 a side; interleaved scans or one
// component a scan; restart markers; the EXIF orientation a camera writes (the picture turned upright unless
// `orient: false`). Not read, and refused saying so: lossless, hierarchical and arithmetic coding, 12 bit
// samples.
//
// The structure (frame, scans, the four progressive decoders, an end-of-band run kept across blocks) follows
// the JPEG standard as pdf.js's jpg.js and libjpeg's jdphuff.c lay it out (pdf.js: Apache 2.0, Mozilla); the
// code is the kit's own. Colour sampled at half is spread back by the centred blend libjpeg calls fancy
// upsampling (each sample three quarters of the nearer and a quarter of the farther), so a picture agrees with
// what libjpeg (ImageMagick, browsers) shows to within a step or two of 255. A plain floating point inverse DCT.

/** The order the 64 coefficients of a block are written in: the zigzag from the top left. */
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21,
  28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61,
  54, 47, 55, 62, 63,
];
/** cos((2x + 1) u pi / 16) / 2, with the factor 1/sqrt(2) for u = 0: the inverse DCT's table, [u * 8 + x]. */
const COSINES = Float64Array.from({ length: 64 }, (_, i) => {
  const u = Math.floor(i / 8);
  const x = i % 8;
  return ((u ? 1 : Math.SQRT1_2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16)) / 2;
});
/** The markers. */
const SOF_BASELINE = 0xc0;
const SOF_EXTENDED = 0xc1;
const SOF_PROGRESSIVE = 0xc2;
const DHT = 0xc4;
const JPG = 0xc8;
const DAC = 0xcc;
const RST_FIRST = 0xd0;
const RST_LAST = 0xd7;
const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const DQT = 0xdb;
const DNL = 0xdc;
const DRI = 0xdd;
const APP1 = 0xe1;
const APP14 = 0xee;
/** The EXIF tag of the orientation, and the TIFF header's two byte orders. */
const ORIENTATION = 0x0112;

/** A Huffman table as a lookup: for each code length, the largest code and where its symbols begin. */
function huffmanTable(counts, symbols) {
  const table = { maxCode: new Int32Array(18).fill(-1), offset: new Int32Array(17), symbols };
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length++) {
    table.offset[length] = k - code;
    code += counts[length - 1];
    k += counts[length - 1];
    if (counts[length - 1]) table.maxCode[length] = code - 1;
    code <<= 1;
  }
  return table;
}

/**
 * A JPEG file's picture: { width, height, rgb, orientation }. It throws, saying what is read, on a kind of JPEG
 * that is not and on a file cut short. `orient` (true unless told): turned upright as its EXIF orientation says.
 */
export function unjpeg(buffer, { orient = true } = {}) {
  const bytes = Buffer.from(buffer.buffer ?? buffer, buffer.byteOffset ?? 0, buffer.length);
  if (bytes[0] !== 0xff || bytes[1] !== SOI) throw new Error("not a JPEG file");
  const quantisers = [];
  const dcTables = [];
  const acTables = [];
  let frame = null;
  let restartInterval = 0;
  let adobe = null;
  let orientation = 1;
  let at = 2;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) {
      at++;
      continue;
    }
    const marker = bytes[at + 1];
    if (marker === 0xff || marker === 0 || marker === SOI) {
      at++;
      continue;
    }
    if (marker === EOI) break;
    if (marker >= RST_FIRST && marker <= RST_LAST) {
      at += 2;
      continue;
    }
    if (at + 4 > bytes.length) throw new Error("the JPEG is cut short");
    const length = bytes.readUInt16BE(at + 2);
    if (at + 2 + length > bytes.length) throw new Error("the JPEG is cut short");
    const data = bytes.subarray(at + 4, at + 2 + length);
    if (marker === DQT) {
      for (let k = 0; k < data.length; ) {
        const wide = data[k] >> 4;
        const id = data[k] & 15;
        // kept in the blocks' own order (not the zigzag), as the coefficients are
        const table = new Int32Array(64);
        for (let i = 0; i < 64; i++) table[ZIGZAG[i]] = wide ? data.readUInt16BE(k + 1 + i * 2) : data[k + 1 + i];
        quantisers[id] = table;
        k += 1 + 64 * (wide ? 2 : 1);
      }
    } else if (marker === DHT) {
      for (let k = 0; k < data.length; ) {
        const kind = data[k] >> 4;
        const id = data[k] & 15;
        const counts = data.subarray(k + 1, k + 17);
        const total = counts.reduce((sum, n) => sum + n, 0);
        (kind ? acTables : dcTables)[id] = huffmanTable(counts, data.subarray(k + 17, k + 17 + total));
        k += 17 + total;
      }
    } else if (marker === SOF_BASELINE || marker === SOF_EXTENDED || marker === SOF_PROGRESSIVE) {
      if (frame) throw new Error("the JPEG has two frames: a hierarchical JPEG is not read");
      if (data[0] !== 8) throw new Error(`a JPEG of ${data[0]} bits a sample: 8 are read`);
      const count = data[5];
      if (![1, 3, 4].includes(count)) throw new Error(`a JPEG of ${count} components: grey (1), colour (3) and CMYK (4) are read`);
      frame = {
        progressive: marker === SOF_PROGRESSIVE,
        height: data.readUInt16BE(1),
        width: data.readUInt16BE(3),
        components: Array.from({ length: count }, (_, i) => ({ id: data[6 + i * 3], h: data[7 + i * 3] >> 4, v: data[7 + i * 3] & 15, q: data[8 + i * 3] })),
      };
      if (!frame.width) throw new Error("the JPEG gives no width");
      if (frame.components.some((c) => c.h < 1 || c.h > 4 || c.v < 1 || c.v > 4)) throw new Error("the JPEG samples a component at other than 1 to 4 a side");
      frame.hMax = Math.max(...frame.components.map((c) => c.h));
      frame.vMax = Math.max(...frame.components.map((c) => c.v));
      if (frame.height) prepare(frame);
    } else if (marker >= 0xc3 && marker <= 0xcf && marker !== DHT && marker !== JPG && marker !== DAC) {
      const kind = marker === 0xc3 ? "lossless" : marker >= 0xc9 ? "arithmetic coded" : "hierarchical";
      throw new Error(`a ${kind} JPEG (SOF${marker - 0xc0}): baseline and progressive JPEG are read. Save it again as a PNG, or as an ordinary JPEG`);
    } else if (marker === DAC) throw new Error("an arithmetic coded JPEG: baseline and progressive JPEG with Huffman coding are read");
    else if (marker === DRI) restartInterval = data.readUInt16BE(0);
    else if (marker === DNL) {
      // the height given after the first scan: rare, written by some scanners
      if (frame && !frame.height) frame.height = data.readUInt16BE(0);
    } else if (marker === APP14 && data.toString("latin1", 0, 5) === "Adobe") adobe = { transform: data[11] };
    else if (marker === APP1 && data.toString("latin1", 0, 6) === "Exif\0\0") orientation = exifOrientation(data.subarray(6)) ?? orientation;
    else if (marker === SOS) {
      if (!frame) throw new Error("the JPEG has a scan before its frame");
      if (!frame.height) throw new Error("the JPEG gives its height nowhere (a DNL marker that is not read)");
      if (!frame.prepared) prepare(frame);
      at = scan(bytes, at + 2 + length, data, frame, { quantisers, dcTables, acTables, restartInterval });
      continue;
    }
    at += 2 + length;
  }
  if (!frame?.prepared) throw new Error("the JPEG has no frame and scan: it is not whole");
  for (const component of frame.components) {
    const quantiser = quantisers[component.q];
    if (!quantiser) throw new Error("the JPEG names a quantisation table it has not given");
    samplesOf(component, quantiser);
  }
  const picture = colours(frame, adobe);
  return { ...(orient ? turned(picture, orientation) : picture), orientation };
}

/** The frame's blocks laid out: each component's coefficients, as many blocks as its MCUs cover. */
function prepare(frame) {
  frame.mcusAcross = Math.ceil(frame.width / (8 * frame.hMax));
  frame.mcusDown = Math.ceil(frame.height / (8 * frame.vMax));
  for (const c of frame.components) {
    // the blocks the component's own part of the picture needs (a scan of it alone covers these), and the
    // blocks its MCUs hold (an interleaved scan covers those)
    c.blocksAcross = Math.ceil(Math.ceil((frame.width * c.h) / frame.hMax) / 8);
    c.blocksDown = Math.ceil(Math.ceil((frame.height * c.v) / frame.vMax) / 8);
    c.across = frame.mcusAcross * c.h;
    c.down = frame.mcusDown * c.v;
    c.coefficients = new Int32Array(c.across * c.down * 64);
  }
  frame.prepared = true;
}

/** The orientation of an EXIF block (its TIFF header onward): 1 to 8, or null. */
function exifOrientation(tiff) {
  if (tiff.length < 8) return null;
  const little = tiff.toString("latin1", 0, 2) === "II";
  if (!little && tiff.toString("latin1", 0, 2) !== "MM") return null;
  const u16 = (k) => (little ? tiff.readUInt16LE(k) : tiff.readUInt16BE(k));
  const u32 = (k) => (little ? tiff.readUInt32LE(k) : tiff.readUInt32BE(k));
  const first = u32(4);
  if (first + 2 > tiff.length) return null;
  const count = u16(first);
  for (let i = 0; i < count; i++) {
    const entry = first + 2 + i * 12;
    if (entry + 12 > tiff.length) return null;
    if (u16(entry) === ORIENTATION) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** A picture turned upright as EXIF orientation `o` says (2 to 8: mirrored, turned, or both). */
function turned(picture, o) {
  if (o === 1) return picture;
  const { width: w, height: h, rgb } = picture;
  const swap = o >= 5;
  const [W, H] = swap ? [h, w] : [w, h];
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      // the stored pixel that shows at (x, y) of the upright picture
      const [sx, sy] = [
        null,
        [x, y],
        [w - 1 - x, y], // mirrored
        [w - 1 - x, h - 1 - y], // half a turn
        [x, h - 1 - y], // mirrored upside down
        [y, x], // mirrored across the diagonal
        [y, h - 1 - x], // a quarter turn clockwise
        [w - 1 - y, h - 1 - x], // across the other diagonal
        [w - 1 - y, x], // a quarter turn anticlockwise
      ][o];
      const from = (sy * w + sx) * 3;
      out.set(rgb.subarray(from, from + 3), (y * W + x) * 3);
    }
  return { width: W, height: H, rgb: out };
}

/** One scan's coded data read into its components' coefficients. Returns where the data ends. */
function scan(bytes, from, header, frame, { dcTables, acTables, restartInterval }) {
  const count = header[0];
  const components = Array.from({ length: count }, (_, i) => {
    const component = frame.components.find((c) => c.id === header[1 + i * 2]);
    if (!component) throw new Error("the JPEG's scan names a component its frame has not");
    component.dc = dcTables[header[2 + i * 2] >> 4];
    component.ac = acTables[header[2 + i * 2] & 15];
    component.predictor = 0;
    return component;
  });
  const tail = 1 + count * 2;
  const [start, end, approximation] = [header[tail], header[tail + 1], header[tail + 2]];
  const [high, low] = [approximation >> 4, approximation & 15];
  const progressive = frame.progressive;
  if (!progressive && (start !== 0 || end !== 63 || approximation)) throw new Error("the JPEG's sequential scan is cut into bands, as only a progressive one is");
  if (progressive && (start > end || end > 63 || (start === 0 && end !== 0) || (start > 0 && count !== 1)))
    throw new Error("the JPEG's progressive scan has a band the standard does not allow");
  const dcNeeded = !progressive || (start === 0 && high === 0);
  const acNeeded = !progressive || start > 0;
  for (const c of components)
    if ((dcNeeded && !c.dc) || (acNeeded && !c.ac)) throw new Error("the JPEG's scan names a Huffman table it has not given");

  // the coded bits, with the zero byte after every 0xff taken out; at a marker, what is left reads as zeros
  let at = from;
  let bits = 0;
  let bitCount = 0;
  const bit = () => {
    if (!bitCount) {
      let byte = 0;
      if (at < bytes.length) {
        byte = bytes[at];
        if (byte === 0xff) {
          if (bytes[at + 1] === 0) at += 2;
          else byte = 0;
        } else at++;
      }
      bits = byte;
      bitCount = 8;
    }
    bitCount--;
    return (bits >> bitCount) & 1;
  };
  const receive = (length) => {
    let value = 0;
    for (let i = 0; i < length; i++) value = (value << 1) | bit();
    return value;
  };
  const extend = (value, length) => (length && value < 1 << (length - 1) ? value - (1 << length) + 1 : value);
  const decode = (table) => {
    let code = 0;
    for (let length = 1; length <= 16; length++) {
      code = (code << 1) | bit();
      if (code <= table.maxCode[length]) return table.symbols[code + table.offset[length]];
    }
    throw new Error("the JPEG's coded data is not whole (a code no table has)");
  };

  // a run of bands that end at once, carried from block to block (progressive AC scans)
  let endRun = 0;
  const one = 1 << low;
  const minusOne = -1 << low;
  /** A block of a sequential JPEG: its DC and its 63 AC coefficients. */
  const sequential = (c, blocks, o) => {
    const size = decode(c.dc);
    c.predictor += size ? extend(receive(size), size) : 0;
    blocks[o] = c.predictor;
    for (let k = 1; k < 64; ) {
      const symbol = decode(c.ac);
      const zeros = symbol >> 4;
      const length = symbol & 15;
      if (!length) {
        if (zeros !== 15) break;
        k += 16;
        continue;
      }
      k += zeros;
      if (k > 63) break;
      blocks[o + ZIGZAG[k]] = extend(receive(length), length);
      k++;
    }
  };
  /** The first pass over the DC: its high bits, `low` of them left for later passes. */
  const dcFirst = (c, blocks, o) => {
    const size = decode(c.dc);
    c.predictor += size ? extend(receive(size), size) * one : 0;
    blocks[o] = c.predictor;
  };
  /** A later pass over the DC: one more bit. */
  const dcRefine = (c, blocks, o) => {
    if (bit()) blocks[o] |= one;
  };
  /** The first pass over a band of AC coefficients. */
  const acFirst = (c, blocks, o) => {
    if (endRun) {
      endRun--;
      return;
    }
    for (let k = start; k <= end; ) {
      const symbol = decode(c.ac);
      const zeros = symbol >> 4;
      const length = symbol & 15;
      if (!length) {
        if (zeros < 15) {
          endRun = (1 << zeros) - 1 + (zeros ? receive(zeros) : 0);
          break;
        }
        k += 16;
        continue;
      }
      k += zeros;
      if (k > 63) break;
      blocks[o + ZIGZAG[k]] = extend(receive(length), length) * one;
      k++;
    }
  };
  /** A later pass over a band of AC coefficients: a bit more of those already begun, and new ones of size 1. */
  const acRefine = (c, blocks, o) => {
    const sharpen = (z) => {
      if (bit() && (blocks[z] & one) === 0) blocks[z] += blocks[z] >= 0 ? one : minusOne;
    };
    let k = start;
    if (!endRun) {
      for (; k <= end; k++) {
        const symbol = decode(c.ac);
        let zeros = symbol >> 4;
        let value = 0;
        if (symbol & 15) value = bit() ? one : minusOne;
        else if (zeros !== 15) {
          endRun = (1 << zeros) + (zeros ? receive(zeros) : 0);
          break;
        }
        // past `zeros` coefficients still zero, sharpening those already begun on the way
        while (k <= end) {
          const z = o + ZIGZAG[k];
          if (blocks[z]) sharpen(z);
          else if (--zeros < 0) break;
          k++;
        }
        if (value && k <= end) blocks[o + ZIGZAG[k]] = value;
      }
    }
    if (endRun) {
      for (; k <= end; k++) {
        const z = o + ZIGZAG[k];
        if (blocks[z]) sharpen(z);
      }
      endRun--;
    }
  };
  const decodeBlock = !progressive ? sequential : start === 0 ? (high === 0 ? dcFirst : dcRefine) : high === 0 ? acFirst : acRefine;
  const block = (c, row, column) => decodeBlock(c, c.coefficients, (row * c.across + column) * 64);

  const single = count === 1;
  const first = components[0];
  // one component alone is read in its own blocks, as many as its part of the picture needs
  const across = single ? first.blocksAcross : frame.mcusAcross;
  const down = single ? first.blocksDown : frame.mcusDown;
  const total = across * down;
  for (let n = 0; n < total; n++) {
    if (restartInterval && n && n % restartInterval === 0) {
      // a restart: the bits begin again at a whole byte after its marker, and so do predictors and runs
      bitCount = 0;
      while (at + 1 < bytes.length && !(bytes[at] === 0xff && bytes[at + 1] >= RST_FIRST && bytes[at + 1] <= RST_LAST)) at++;
      at += 2;
      for (const c of components) c.predictor = 0;
      endRun = 0;
    }
    const row = Math.floor(n / across);
    const column = n % across;
    if (single) block(first, row, column);
    else
      for (const c of components)
        for (let v = 0; v < c.v; v++) for (let h = 0; h < c.h; h++) block(c, row * c.v + v, column * c.h + h);
  }
  // past the coded data: to the next marker that is not a restart
  while (at + 1 < bytes.length && !(bytes[at] === 0xff && bytes[at + 1] !== 0 && !(bytes[at + 1] >= RST_FIRST && bytes[at + 1] <= RST_LAST))) at++;
  return at;
}

/** A component's coefficients made samples: each block multiplied by its steps and turned back by the DCT. */
function samplesOf(c, quantiser) {
  const stride = c.across * 8;
  c.samples = new Uint8Array(stride * c.down * 8);
  const block = new Float64Array(64);
  const rows = new Float64Array(64);
  for (let by = 0; by < c.down; by++)
    for (let bx = 0; bx < c.across; bx++) {
      const o = (by * c.across + bx) * 64;
      let flat = true;
      for (let i = 0; i < 64; i++) {
        block[i] = c.coefficients[o + i] * quantiser[i];
        if (i && block[i]) flat = false;
      }
      const at = by * 8 * stride + bx * 8;
      if (flat) {
        // a block of one value: its DC alone
        const value = Math.round(block[0] / 8 + 128);
        const v = value < 0 ? 0 : value > 255 ? 255 : value;
        for (let y = 0; y < 8; y++) c.samples.fill(v, at + y * stride, at + y * stride + 8);
        continue;
      }
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          let sum = 0;
          for (let u = 0; u < 8; u++) sum += COSINES[u * 8 + x] * block[y * 8 + u];
          rows[y * 8 + x] = sum;
        }
      for (let x = 0; x < 8; x++)
        for (let y = 0; y < 8; y++) {
          let sum = 0;
          for (let v = 0; v < 8; v++) sum += COSINES[v * 8 + y] * rows[v * 8 + x];
          const value = Math.round(sum + 128);
          c.samples[at + y * stride + x] = value < 0 ? 0 : value > 255 ? 255 : value;
        }
    }
  c.coefficients = null;
}

/**
 * A component's samples at the picture's full size: the same where it is sampled in full, and spread back by
 * a centred blend where at less (libjpeg's fancy upsampling at half, the same blend at any other share).
 */
function fullSize(frame, c) {
  const { width, height, hMax, vMax } = frame;
  const stride = c.across * 8;
  if (c.h === hMax && c.v === vMax) {
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) out.set(c.samples.subarray(y * stride, y * stride + width), y * width);
    return out;
  }
  const [sw, sh] = [Math.ceil((width * c.h) / hMax), Math.ceil((height * c.v) / vMax)];
  const out = new Uint8Array(width * height);
  const xs = Array.from({ length: width }, (_, x) => {
    const f = Math.min(sw - 1, Math.max(0, ((x + 0.5) * c.h) / hMax - 0.5));
    const i = Math.floor(f);
    return [i, Math.min(sw - 1, i + 1), f - i];
  });
  for (let y = 0; y < height; y++) {
    const f = Math.min(sh - 1, Math.max(0, ((y + 0.5) * c.v) / vMax - 0.5));
    const j = Math.floor(f);
    const [r0, r1, t] = [j * stride, Math.min(sh - 1, j + 1) * stride, f - j];
    for (let x = 0; x < width; x++) {
      const [i0, i1, s] = xs[x];
      const top = c.samples[r0 + i0] + (c.samples[r0 + i1] - c.samples[r0 + i0]) * s;
      const bottom = c.samples[r1 + i0] + (c.samples[r1 + i1] - c.samples[r1 + i0]) * s;
      out[y * width + x] = Math.round(top + (bottom - top) * t);
    }
  }
  return out;
}

/** The components as RGB: grey; YCbCr or RGB; CMYK or YCCK (Adobe's, written inverted). */
function colours(frame, adobe) {
  const { width, height, components } = frame;
  const planes = components.map((c) => fullSize(frame, c));
  const rgb = new Uint8Array(width * height * 3);
  const clamp = (value) => (value < 0 ? 0 : value > 255 ? 255 : Math.round(value));
  const n = width * height;
  if (planes.length === 1) {
    for (let i = 0; i < n; i++) rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = planes[0][i];
    return { width, height, rgb };
  }
  // three components are YCbCr unless an Adobe marker says they are RGB (its transform 0); four are CMYK,
  // YCCK when Adobe's transform is 2
  const ycc = planes.length === 3 ? adobe?.transform !== 0 : adobe?.transform === 2;
  const [a, b, c] = planes;
  for (let i = 0; i < n; i++) {
    let [r, g, bl] = [a[i], b[i], c[i]];
    if (ycc) [r, g, bl] = [clamp(a[i] + 1.402 * (c[i] - 128)), clamp(a[i] - 0.344136 * (b[i] - 128) - 0.714136 * (c[i] - 128)), clamp(a[i] + 1.772 * (b[i] - 128))];
    if (planes.length === 4) {
      // Adobe's CMYK is written inverted: each value is 255 less the ink, so the colour is it times K's. YCCK
      // carries the inks themselves in its YCC (libjpeg's ycck_cmyk_convert): taken from 255 first
      if (ycc) [r, g, bl] = [255 - r, 255 - g, 255 - bl];
      const k = planes[3][i] / 255;
      [r, g, bl] = [clamp(r * k), clamp(g * k), clamp(bl * k)];
    }
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = bl;
  }
  return { width, height, rgb };
}
