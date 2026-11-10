// Noise shaped in the frequency domain: short-time Fourier frames (512 samples, a hop of 128, a Hann window)
// whose magnitudes follow a curve of [Hz, dB] and whose phases are random, overlap-added; and the curve may move
// through the sound. A spectrum as steep or as many-peaked as a curve says, which the biquads cannot make
// without their skirts leaking into each other (research/asset-reproduction-failures.md, section 4, A1 and
// A2). Griffin-Lim iterations make the frames' phases agree, so the sound's own spectrogram follows the curve
// closer still.
//
//   shapeAt(shape, t)                         -> the curve at `t` seconds: [[Hz, dB], ...]
//   curveAt(curve, f)                         -> a curve's dB at `f` Hz
//   shapedNoise(shape, n, rate, random, { iterations }) -> Float32Array of `n` samples
//
// A curve of 0 dB at every frequency is white noise as the kit's `noise` makes it (-1 to 1, RMS 0.577).

import { fft } from "./measure.mjs";

const SIZE = 512;
const HOP = 128;
/** A periodic Hann window: its squares overlapped at a hop of a quarter sum to 1.5 everywhere. */
const WINDOW = Float64Array.from({ length: SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SIZE));
const OVERLAP = 1.5;
/** The magnitude of a bin that makes white noise of the kit's level (variance 1/3) at 0 dB. */
const UNIT = Math.sqrt((SIZE * OVERLAP) / 3);
/**
 * What a frame of that noise measures, once its frames agree: random phases overlapped lose half their size,
 * so Griffin-Lim aims at the magnitudes a consistent noise of the same level has (the window's energy, not the
 * overlap's).
 */
const CONSISTENT = Math.sqrt(WINDOW.reduce((a, w) => a + w * w, 0) / (SIZE * OVERLAP));

/** The keys of a shape: a curve alone is one key, held. */
const keysOf = (shape) => (Array.isArray(shape) ? [{ at: 0, curve: shape }] : shape.keys);

/** A curve's dB at `f`, straight between its points on a log scale of frequency, held past its ends. */
export function curveAt(curve, f) {
  if (f <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++)
    if (f <= curve[i][0]) {
      const u = Math.log(f / curve[i - 1][0]) / Math.log(curve[i][0] / curve[i - 1][0] || 1.000001);
      return curve[i - 1][1] + (curve[i][1] - curve[i - 1][1]) * u;
    }
  return curve.at(-1)[1];
}

/** The shape's curve at `t` seconds: between two keys, each point's dB straight in time. */
export function shapeAt(shape, t) {
  const keys = keysOf(shape);
  if (t <= keys[0].at || keys.length === 1) return keys[0].curve;
  for (let i = 1; i < keys.length; i++)
    if (t <= keys[i].at) {
      const u = (t - keys[i - 1].at) / (keys[i].at - keys[i - 1].at || 1e-9);
      const fs = [...new Set([...keys[i - 1].curve, ...keys[i].curve].map((p) => p[0]))].sort((a, b) => a - b);
      return fs.map((f) => [f, curveAt(keys[i - 1].curve, f) * (1 - u) + curveAt(keys[i].curve, f) * u]);
    }
  return keys.at(-1).curve;
}

/** Each key's magnitudes by bin, once: the frames then mix two keys' rows. */
function magnitudesOf(shape, rate) {
  return keysOf(shape).map((key) => ({
    at: key.at,
    dB: Float64Array.from({ length: SIZE / 2 + 1 }, (_, k) => (k === 0 || k === SIZE / 2 ? -Infinity : curveAt(key.curve, (k * rate) / SIZE))),
  }));
}

/** The frame's magnitudes at `t`: the keys' dB mixed in time, as linear magnitudes. */
function frameMagnitudes(keys, t, out) {
  let a = keys[0];
  let b = keys[0];
  let u = 0;
  if (t > keys[0].at && keys.length > 1) {
    const i = keys.findIndex((key) => key.at >= t);
    if (i < 0) a = b = keys.at(-1);
    else {
      a = keys[i - 1];
      b = keys[i];
      u = (t - a.at) / (b.at - a.at || 1e-9);
    }
  }
  for (let k = 0; k <= SIZE / 2; k++) {
    const dB = a.dB[k] * (1 - u) + b.dB[k] * u;
    out[k] = Number.isFinite(dB) ? UNIT * 10 ** (dB / 20) : 0;
  }
  return out;
}

/** Frames (each SIZE / 2 + 1 bins, re and im) overlap-added into `length` samples of a padded line. */
function overlapAdd(frames, length) {
  const out = new Float64Array(length);
  const re = new Float64Array(SIZE);
  const im = new Float64Array(SIZE);
  frames.forEach((frame, m) => {
    // the inverse transform by the forward one: the conjugate in, the conjugate out, over SIZE
    re[0] = frame.re[0];
    im[0] = 0;
    re[SIZE / 2] = frame.re[SIZE / 2];
    im[SIZE / 2] = 0;
    for (let k = 1; k < SIZE / 2; k++) {
      re[k] = frame.re[k];
      im[k] = -frame.im[k];
      re[SIZE - k] = frame.re[k];
      im[SIZE - k] = frame.im[k];
    }
    fft(re, im);
    const start = m * HOP;
    for (let i = 0; i < SIZE && start + i < length; i++) out[start + i] += ((re[i] / SIZE) * WINDOW[i]) / OVERLAP;
  });
  return out;
}

/** The frames of a padded line, as `overlapAdd` lays them. */
function analyse(x, count) {
  const frames = [];
  const re = new Float64Array(SIZE);
  const im = new Float64Array(SIZE);
  for (let m = 0; m < count; m++) {
    const start = m * HOP;
    for (let i = 0; i < SIZE; i++) {
      re[i] = (x[start + i] ?? 0) * WINDOW[i];
      im[i] = 0;
    }
    fft(re, im);
    frames.push({ re: re.slice(0, SIZE / 2 + 1), im: im.slice(0, SIZE / 2 + 1) });
  }
  return frames;
}

/**
 * `n` samples of noise whose spectrum is `shape`: a curve [[Hz, dB], ...] or a moving one { keys: [{ at, curve
 * }] } (`at` in seconds from the noise's start). `iterations` of the fast Griffin-Lim (Perraudin, Balazs and
 * Søndergaard 2013) after the random phases; 0 unless told.
 */
export function shapedNoise(shape, n, rate, random, { iterations = 0 } = {}) {
  const keys = magnitudesOf(shape, rate);
  // padded by a frame each side, so that every sample kept has its full overlap
  const length = n + 2 * SIZE;
  const count = Math.ceil((length - SIZE) / HOP) + 1;
  const targets = [];
  const frames = [];
  for (let m = 0; m < count; m++) {
    const t = (m * HOP + SIZE / 2 - SIZE) / rate;
    const mag = frameMagnitudes(keys, t, new Float64Array(SIZE / 2 + 1));
    const re = new Float64Array(SIZE / 2 + 1);
    const im = new Float64Array(SIZE / 2 + 1);
    for (let k = 1; k < SIZE / 2; k++) {
      const phase = random() * 2 * Math.PI;
      re[k] = mag[k] * Math.cos(phase);
      im[k] = mag[k] * Math.sin(phase);
    }
    targets.push(mag);
    frames.push({ re, im });
  }
  let x = overlapAdd(frames, length);
  let last = frames;
  for (let it = 0; it < iterations; it++) {
    // project: the frames of what was made, given back the magnitudes asked for; then a step past it
    const made = analyse(x, count);
    const projected = made.map((frame, m) => {
      const re = new Float64Array(SIZE / 2 + 1);
      const im = new Float64Array(SIZE / 2 + 1);
      for (let k = 1; k < SIZE / 2; k++) {
        const size = Math.hypot(frame.re[k], frame.im[k]);
        if (size > 1e-12) {
          re[k] = (CONSISTENT * targets[m][k] * frame.re[k]) / size;
          im[k] = (CONSISTENT * targets[m][k] * frame.im[k]) / size;
        }
      }
      return { re, im };
    });
    const ahead = projected.map((frame, m) => {
      const re = new Float64Array(SIZE / 2 + 1);
      const im = new Float64Array(SIZE / 2 + 1);
      for (let k = 0; k <= SIZE / 2; k++) {
        re[k] = frame.re[k] + 0.99 * (frame.re[k] - last[m].re[k]);
        im[k] = frame.im[k] + 0.99 * (frame.im[k] - last[m].im[k]);
      }
      return { re, im };
    });
    last = projected;
    x = overlapAdd(it === iterations - 1 ? projected : ahead, length);
  }
  return Float32Array.from(x.subarray(SIZE, SIZE + n));
}
