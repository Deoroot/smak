// A GoldSrc sound file: RIFF/WAVE PCM, mono, 8 or 16 bit, at 11025, 22050 or 44100 Hz, with one cue point
// when it loops (the engine loops from the cue's sample to the end). research/sound-generation.md, section 2,
// has where each rule comes from.
//
//   readWav(bytes, { split })               -> { format, channels, rate, bits, samples, x (Float32Array, -1..1), cue, chunks }
//                                              (with split, also xs: each channel's own samples)
//   writeWav(x, { rate, bits, loop, seed }) -> bytes: mono, a cue at `loop` (a sample) when given
//   resample(x, from, to)                   -> x at another rate, band-limited (a generator's 44.1 or 48 kHz to the game's)

/** The rates both engines take as they are. */
export const RATES = [11025, 22050, 44100];

/**
 * A file's samples and what it says of itself. A stereo file is read as the mean of its channels. Any PCM
 * the game's tools or a generator write: 8, 16, 24 or 32-bit whole numbers, 32 or 64-bit floats, plain or in
 * the extensible format's wrapper (`format` is then the one inside it).
 */
export function readWav(bytes, { split = false } = {}) {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAVE file (RIFF/WAVE)");
  let at = 12;
  let fmt = null;
  let data = null;
  let cue = null;
  const chunks = [];
  while (at + 8 <= bytes.length) {
    const id = bytes.toString("ascii", at, at + 4);
    const length = bytes.readUInt32LE(at + 4);
    const body = bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + length));
    chunks.push(id);
    if (id === "fmt ") {
      fmt = { format: body.readUInt16LE(0), channels: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) };
      // WAVE_FORMAT_EXTENSIBLE: the real format is the first two bytes of its sub-format's GUID
      if (fmt.format === 0xfffe && body.length >= 26) fmt.format = body.readUInt16LE(24);
    }
    else if (id === "data") data = body;
    else if (id === "cue ") {
      const count = body.readUInt32LE(0);
      cue = Array.from({ length: count }, (_, i) => body.readUInt32LE(4 + i * 24 + 20));
    }
    at += 8 + length + (length & 1);
  }
  if (!fmt || !data) throw new Error("a WAVE file without its fmt or data chunk");
  if (fmt.format !== 1 && fmt.format !== 3) throw new Error(`a WAVE file of format ${fmt.format}: PCM (1) or float (3) only`);
  if (fmt.format === 1 ? ![8, 16, 24, 32].includes(fmt.bits) : ![32, 64].includes(fmt.bits)) throw new Error(`a WAVE file of ${fmt.bits}-bit ${fmt.format === 1 ? "PCM" : "float"}`);
  const width = fmt.bits / 8;
  const sample =
    fmt.format === 3
      ? width === 4
        ? (o) => data.readFloatLE(o)
        : (o) => data.readDoubleLE(o)
      : width === 1
        ? (o) => (data[o] - 128) / 128
        : width === 2
          ? (o) => data.readInt16LE(o) / 32768
          : width === 3
            ? (o) => data.readIntLE(o, 3) / 8388608
            : (o) => data.readInt32LE(o) / 2147483648;
  const samples = Math.floor(data.length / width / fmt.channels);
  const x = new Float32Array(samples);
  const xs = split ? Array.from({ length: fmt.channels }, () => new Float32Array(samples)) : null;
  for (let i = 0; i < samples; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const v = sample((i * fmt.channels + c) * width);
      if (xs) xs[c][i] = v;
      sum += v;
    }
    x[i] = sum / fmt.channels;
  }
  return { ...fmt, samples, x, ...(xs ? { xs } : {}), cue, chunks };
}

/**
 * The bytes of a mono PCM file of the samples `x` (-1..1, clamped). `bits` 16 (unless told) or 8, with a
 * triangular dither of one step when 8 (seeded: the same samples give the same bytes); `loop`: the sample
 * the engine loops back to, written as the one cue point, and no `ltxt` length (which can stop GoldSrc
 * looping).
 */
export function writeWav(x, { rate = 22050, bits = 16, loop = null, seed = 1 } = {}) {
  if (!RATES.includes(rate)) throw new Error(`writeWav: a rate of ${RATES.join(", ")} Hz, not ${rate}`);
  if (bits !== 8 && bits !== 16) throw new Error(`writeWav: 8 or 16 bits, not ${bits}`);
  if (loop !== null && !(loop >= 0 && loop < x.length)) throw new Error(`writeWav: the loop's start (${loop}) is not a sample of the sound (0 to ${x.length - 1})`);
  const width = bits / 8;
  const data = Buffer.alloc(x.length * width + ((x.length * width) & 1));
  let state = seed >>> 0 || 1;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < x.length; i++) {
    const v = Math.max(-1, Math.min(1, x[i]));
    if (width === 1) data[i] = Math.max(0, Math.min(255, Math.round(v * 128 + 128 + (random() - random()) * 0.5)));
    else data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32768))), i * 2);
  }
  const chunk = (id, body, length = body.length) => {
    const head = Buffer.alloc(8);
    head.write(id, 0, "ascii");
    head.writeUInt32LE(length, 4);
    return Buffer.concat([head, body]);
  };
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(rate, 4);
  fmt.writeUInt32LE(rate * width, 8);
  fmt.writeUInt16LE(width, 12);
  fmt.writeUInt16LE(bits, 14);
  const parts = [chunk("fmt ", fmt), chunk("data", data, x.length * width)];
  if (loop !== null) {
    const cue = Buffer.alloc(28);
    cue.writeUInt32LE(1, 0);
    cue.writeUInt32LE(1, 4);
    cue.writeUInt32LE(loop, 8);
    cue.write("data", 12, "ascii");
    cue.writeUInt32LE(loop, 24);
    parts.push(chunk("cue ", cue));
  }
  const body = Buffer.concat([Buffer.from("WAVE", "ascii"), ...parts]);
  return chunk("RIFF", body);
}

/**
 * `x` at the rate `to` from the rate `from`: each new sample a windowed sinc (Blackman, 16 zero crossings a
 * side) of the old ones, cut off under the lower rate's half, so that a 48 kHz take brought to 22050 does not
 * fold its top octave back down as hiss.
 */
export function resample(x, from, to) {
  if (from === to) return Float32Array.from(x);
  const ratio = to / from;
  const cut = Math.min(1, ratio) * 0.95;
  const half = Math.ceil(16 / cut);
  // the kernel tabled at a 512th of a sample and read between: a sine and two cosines a tap made a minute of
  // music take tens of seconds
  const STEPS = 512;
  const table = new Float64Array(half * STEPS + 2);
  for (let i = 0; i < table.length; i++) {
    const d = i / STEPS;
    const sinc = d === 0 ? 1 : Math.sin(Math.PI * cut * d) / (Math.PI * cut * d);
    const w = d >= half ? 0 : 0.42 + 0.5 * Math.cos((Math.PI * d) / half) + 0.08 * Math.cos((2 * Math.PI * d) / half);
    table[i] = cut * sinc * w;
  }
  const kernel = (d) => {
    const a = Math.abs(d) * STEPS;
    const i = Math.floor(a);
    return table[i] + (table[i + 1] - table[i]) * (a - i);
  };
  const out = new Float32Array(Math.max(1, Math.round(x.length * ratio)));
  for (let i = 0; i < out.length; i++) {
    const centre = i / ratio;
    const j0 = Math.max(0, Math.ceil(centre - half));
    const j1 = Math.min(x.length - 1, Math.floor(centre + half));
    let sum = 0;
    for (let j = j0; j <= j1; j++) sum += x[j] * kernel(j - centre);
    out[i] = sum;
  }
  return out;
}
