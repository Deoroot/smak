// A sound's picture (the waveform over the spectrogram that `soundPicture` draws) read back as numbers: its
// length and rate off its label and its marks, its outline, the spectrogram's colours turned back into dB,
// band levels over time, tone lines and onsets. Two uses: the measures a judge takes of the sound, read off
// the picture (`pictureMeasures`), and a draft spec of tens of numbers for the kit's own layers to make
// (`fromPicture`): noise with a moving shape, modes for each tone line, envelope points.
//
// Never samples. A picture inverted to a sound (Griffin-Lim on the decoded spectrogram) is a traced copy of
// the recording it was drawn from; research/asset-reproduction-failures.md, section 7, draws that line, and
// the kit keeps to the side of measures and parameters.
//
//   readSoundPicture(picture, { row, length, rate }) -> { name, length, rate, loop, columns, outline, frames, binHz }
//   pictureMeasures(picture, options)                -> { length, rate, peak, crest, t20, centroid, flatness, bands, onsets, ... }
//   fromPicture(picture, options)                    -> { spec, measures, lines, onsets }

import { unpng } from "../../core/image.mjs";
import { label } from "../render.mjs";
import { PICTURE, levelOf } from "./draw.mjs";
import { RATES } from "../../core/audio/wav.mjs";
import { BANDS, FLAT_TOP } from "./measure.mjs";
import { curveAt } from "./spectral.mjs";

const { wave: WAVE, spectrogram: SPEC, gap: GAP, lowest: LOWEST, frame: SIZE, depth: DEPTH } = PICTURE;
const HOP = SIZE / 2;
const BINS = SIZE / 2;
const round = (v, k = 1) => Math.round(v * 10 ** k) / 10 ** k;
const same = (rgba, i, c) => rgba[i] === c[0] && rgba[i + 1] === c[1] && rgba[i + 2] === c[2];
const TICK = [200, 200, 200];
const LOOP = [255, 220, 60];
const INK = [235, 235, 235];
const LABEL_AT = [8, 4];
const DOT = 2;

/** The letters of a label, each as the 15 dots it lights: drawn once by the kit's own `label`. */
const LETTERS = (() => {
  const letters = new Map();
  for (const ch of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-._:/=+(), ") {
    const img = { width: 12, height: 16, rgba: new Uint8Array(12 * 16 * 4) };
    label(img, ch, 2, 2, DOT);
    let bits = "";
    for (let r = 0; r < 5; r++) for (let b = 0; b < 3; b++) bits += same(img.rgba, ((2 + r * DOT) * 12 + 2 + b * DOT) * 4, INK) ? "1" : "0";
    letters.set(bits, [...(letters.get(bits) ?? []), ch]);
  }
  return letters;
})();
const BAND = (() => {
  const img = { width: 8, height: 8, rgba: new Uint8Array(8 * 8 * 4) };
  label(img, " ", 4, 4, DOT);
  return [...img.rgba.subarray((4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 3)];
})();

/** The label of a row (its name, then its length in seconds), each letter as the letters its dots could be. */
function readLabel({ width, rgba }, top) {
  const cells = [];
  for (let n = 0; ; n++) {
    const x = LABEL_AT[0] + n * 4 * DOT;
    const y = top + LABEL_AT[1];
    if (x + 3 * DOT >= width || !same(rgba, ((y + 5 * DOT) * width + x + 1) * 4, BAND)) break;
    let bits = "";
    for (let r = 0; r < 5; r++) for (let b = 0; b < 3; b++) bits += same(rgba, ((y + r * DOT) * width + x + b * DOT) * 4, INK) ? "1" : "0";
    cells.push(LETTERS.get(bits) ?? ["?"]);
  }
  // the end is "<seconds> S": read back from it, taking the digit where a letter looks the same (0 O, 5 S)
  let end = cells.length - 1;
  while (end >= 0 && cells[end].includes(" ")) end--;
  if (end < 0 || !cells[end].includes("S")) return { name: null, length: null };
  let k = end - 1;
  while (k >= 0 && cells[k].includes(" ")) k--;
  let number = "";
  for (; k >= 0; k--) {
    const digit = cells[k].find((c) => /[0-9.]/.test(c));
    if (digit === undefined) break;
    number = digit + number;
  }
  const name = cells
    .slice(0, k + 1)
    .map((c) => c.find((x) => !/[0-9]/.test(x)) ?? c[0])
    .join("")
    .trim()
    .toLowerCase();
  const length = Number.parseFloat(number);
  return { name: name || null, length: Number.isFinite(length) ? length : null };
}

/** The rate the spectrogram was drawn at, by where its 100, 1000 and 5000 Hz marks are. */
function rateOf({ width, rgba }, top) {
  const found = [];
  for (let py = 0; py < SPEC; py++) if (same(rgba, ((top + WAVE + py) * width + 3) * 4, TICK)) found.push(py);
  if (!found.length) return null;
  let best = null;
  for (const rate of RATES) {
    const marks = [100, 1000, 5000].filter((f) => f < rate / 2).map((f) => Math.round(SPEC * (1 - Math.log(f / LOWEST) / Math.log(rate / 2 / LOWEST)))).sort((a, b) => a - b);
    const off = marks.length === found.length ? marks.reduce((a, m, i) => a + Math.abs(m - found[i]), 0) : Infinity;
    if (!best || off < best.off) best = { rate, off };
  }
  return best.off < Infinity ? best.rate : null;
}

/** The frames `spectrum` makes of `n` samples, as the picture drew them. */
function frameCount(n) {
  let count = 0;
  for (let s = 0; s === 0 || s + SIZE <= n; s += HOP) {
    count++;
    if (s + SIZE >= n) break;
  }
  return count;
}

/**
 * A sound's picture read: `picture` a PNG's bytes or an image ({ width, height, rgba }); `row` which sound
 * of several (0, the top one); `length` and `rate` when its label and marks cannot be read. Returns { name,
 * length, rate, loop, columns, outline (the peak of each column, 0 to 1), frames: [{ t, dB: by bin, rows: dB by row
 * of the picture }], binHz, rowHz, rowBin }.
 */
export function readSoundPicture(picture, { row = 0, length, rate } = {}) {
  const image = Buffer.isBuffer(picture) || picture instanceof Uint8Array ? unpng(Buffer.from(picture)) : picture;
  const { width, rgba } = image;
  const top = row * (WAVE + SPEC + GAP);
  if (top + WAVE + SPEC > image.height) throw new Error(`fromPicture: the picture has no row ${row}: it is ${image.height} high, a row ${WAVE + SPEC}`);
  const at = (px, py) => (py * width + px) * 4;
  const read = readLabel(image, top);
  length ??= read.length;
  rate ??= rateOf(image, top);
  if (!length) throw new Error("fromPicture: its label's length cannot be read; give { length } in seconds");
  if (!rate) throw new Error("fromPicture: its frequency marks cannot be read; give { rate }");
  // how many columns the sound takes: the last with a colour of the spectrogram
  const mid = top + WAVE + Math.round(SPEC / 2);
  let columns = width;
  while (columns > 1 && levelOf(rgba[at(columns - 1, mid)], rgba[at(columns - 1, mid) + 1], rgba[at(columns - 1, mid) + 2]) === null) columns--;
  let loop = false;
  for (let px = 0; px < columns; px++) if (same(rgba, at(px, top + WAVE + 1), LOOP)) loop = true;
  // the outline: the waveform's run in each column, above and below the middle; the label hides the top of
  // the first columns, so the larger side is taken
  const outline = new Float64Array(columns);
  const centre = WAVE / 2;
  for (let px = 0; px < columns; px++) {
    let high = centre;
    let low = centre;
    for (let py = 0; py < WAVE; py++)
      if (same(rgba, at(px, top + py), PICTURE.waveColour)) {
        high = Math.min(high, py);
        low = Math.max(low, py);
      }
    outline[px] = Math.min(1, Math.max(centre - high, low - centre) / centre);
  }
  // the spectrogram: each frame's rows back to dB, then to bins on the frame's own scale
  const n = Math.round(length * rate);
  const count = frameCount(n);
  const rowHz = Array.from({ length: SPEC }, (_, py) => LOWEST * (rate / 2 / LOWEST) ** (1 - py / SPEC));
  const rowBin = rowHz.map((f) => Math.min(BINS - 1, Math.round((f * SIZE) / rate)));
  const binHz = Float64Array.from({ length: BINS }, (_, k) => (k * rate) / SIZE);
  const frames = [];
  for (let f = 0; f < count; f++) {
    const px = Math.min(columns - 1, Math.ceil((f * columns) / count));
    if (Math.floor((px * count) / columns) !== f && count <= columns) continue;
    const dB = new Float64Array(SPEC).fill(Number.NaN);
    for (let py = 0; py < SPEC; py++) {
      const i = at(px, top + WAVE + py);
      const v = levelOf(rgba[i], rgba[i + 1], rgba[i + 2]);
      if (v !== null) dB[py] = v * DEPTH - DEPTH;
    }
    // a mark over a row (the frequency marks, a loop's line): the rows beside it
    for (let py = 0; py < SPEC; py++)
      if (Number.isNaN(dB[py])) {
        const near = [dB[py - 1], dB[py + 1], dB[py - 2], dB[py + 2]].filter((v) => v !== undefined && !Number.isNaN(v));
        dB[py] = near.length ? near.reduce((a, b) => a + b, 0) / near.length : -DEPTH;
      }
    // rows onto bins: the rows of one bin averaged, a bin with no row between its neighbours on a log scale
    const sum = new Float64Array(BINS);
    const many = new Float64Array(BINS);
    for (let py = 0; py < SPEC; py++) {
      sum[rowBin[py]] += dB[py];
      many[rowBin[py]]++;
    }
    const known = [];
    for (let k = 1; k < BINS; k++) if (many[k]) known.push(k);
    const bins = new Float64Array(BINS).fill(-DEPTH);
    for (let k = 1; k < BINS; k++) {
      if (many[k]) {
        bins[k] = sum[k] / many[k];
        continue;
      }
      const above = known.find((j) => j > k);
      const below = known.findLast((j) => j < k);
      if (below === undefined) bins[k] = sum[above] / many[above];
      else if (above === undefined) bins[k] = sum[below] / many[below];
      else {
        const u = Math.log(k / below) / Math.log(above / below);
        bins[k] = (sum[below] / many[below]) * (1 - u) + (sum[above] / many[above]) * u;
      }
    }
    frames.push({ index: f, t: (f * HOP + HOP) / rate, dB: bins, rows: dB });
  }
  return { name: read.name, length, rate, loop, columns, outline, frames, binHz, rowHz, rowBin };
}

const power = (dB) => 10 ** (dB / 10);

/** Each frame's level, dB under the loudest frame. */
function levelsOf(frames) {
  const total = frames.map((frame) => frame.dB.reduce((a, d, k) => (k ? a + power(d) : a), 0));
  const top = Math.max(...total, 1e-30);
  return total.map((p) => 10 * Math.log10(p / top + 1e-12));
}

/**
 * What the judge measures of a sound, read off its picture: `length`, `centroid` (Hz), `flatness` and `bands` (% of
 * power) from the spectrogram, `t20` (s, peak to -20 dB, by the picture's frames), `onsets` (the spectral
 * flux's peaks, as `features` counts them, on the picture's frames), `peak` (dBFS) off the outline and
 * `crest` (dB) about: the RMS is the outline's, each column's peak taken for the peak of noise of its
 * width of samples. Measures only.
 */
export function pictureMeasures(picture, options = {}) {
  const read = picture.frames ? picture : readSoundPicture(picture, options);
  const { frames, binHz, rate, length, outline, columns } = read;
  const bins = new Float64Array(BINS);
  for (const frame of frames) for (let k = 1; k < BINS; k++) bins[k] += power(frame.dB[k]);
  let total = 0;
  let weighted = 0;
  for (let k = 1; k < BINS; k++) {
    total += bins[k];
    weighted += binHz[k] * bins[k];
  }
  total ||= 1e-20;
  // flatness as the judge's `features` takes it (the whole sound's spectrum under FLAT_TOP, geometric over
  // arithmetic mean), on the picture's bins
  let logs = 0;
  let under = 0;
  let counted = 0;
  for (let k = 1; k < BINS; k++) {
    if (binHz[k] >= FLAT_TOP) continue;
    logs += Math.log(bins[k] + 1e-20);
    under += bins[k];
    counted++;
  }
  const flatness = under ? Math.exp(logs / counted) / (under / counted) : 0;
  const bands = Object.fromEntries(
    BANDS.map(([name, lo, hi]) => {
      let e = 0;
      for (let k = 1; k < BINS; k++) if (binHz[k] >= lo && binHz[k] < hi) e += bins[k];
      return [name, round((100 * e) / total)];
    }),
  );
  const levels = levelsOf(frames);
  const topAt = levels.indexOf(Math.max(...levels));
  let last = topAt;
  for (let i = frames.length - 1; i >= topAt; i--)
    if (levels[i] > -20) {
      last = i;
      break;
    }
  const t20 = ((frames[last].index + 1 - frames[topAt].index) * HOP) / rate;
  // when its loudest moment comes, from its start: a door that slides 4 s before it bangs, a hit at once
  const peakAt = round(frames[topAt].t, 3);
  // onsets: the flux of magnitudes frame to frame, over its mean and two deviations, 50 ms apart
  const flux = [];
  for (let i = 1; i < frames.length; i++) {
    let f = 0;
    for (let k = 0; k < BINS; k++) f += Math.max(0, 10 ** (frames[i].dB[k] / 20) - 10 ** (frames[i - 1].dB[k] / 20));
    flux.push(f);
  }
  const mean = flux.reduce((a, b) => a + b, 0) / (flux.length || 1);
  const deviation = Math.sqrt(flux.reduce((a, b) => a + (b - mean) ** 2, 0) / (flux.length || 1));
  const apart = Math.max(1, Math.round((0.05 * rate) / HOP));
  const onsets = [];
  for (let i = 1; i < flux.length - 1; i++)
    if (flux[i] > mean + 2 * deviation && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1] && (!onsets.length || i - onsets.at(-1).i >= apart)) onsets.push({ i, t: round(frames[i + 1].t - HOP / rate, 3) });
  // the outline's peak and, about, its RMS from each column's peak
  const peak = Math.max(...outline, 1e-6);
  // (Gaussian noise of m samples peaks near sqrt(2 ln m) of its RMS; Valve's sounds, nearer three fifths of
  // that in dB: fitted on the ten of research/sound-shape-results.md, within 3 dB of each)
  const per = Math.max(2, (length * rate) / columns);
  const spread = Math.sqrt(2 * Math.log(per)) ** 0.6;
  const rms = Math.sqrt(outline.reduce((a, v) => a + (v / spread) ** 2, 0) / (columns || 1)) || 1e-6;
  return {
    length,
    rate,
    loop: read.loop,
    peak: round(20 * Math.log10(peak)),
    crest: round(20 * Math.log10(peak / rms)),
    t20: round(t20, 3),
    peakAt,
    centroid: Math.round(weighted / total),
    flatness: round(flatness, 3),
    bands,
    onsets: onsets.length,
    onsetTimes: onsets.map((o) => o.t),
    levels: levels.map((v) => round(v)),
  };
}

/** A line through points of [t, dB] made of fewer, none further than `tolerance` dB from it (Douglas-Peucker). */
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1;
    let far = 0;
    for (let i = a + 1; i < b; i++) {
      const u = (points[i][0] - points[a][0]) / (points[b][0] - points[a][0] || 1e-9);
      const off = Math.abs(points[i][1] - (points[a][1] + (points[b][1] - points[a][1]) * u));
      if (off > far) {
        far = off;
        worst = i;
      }
    }
    if (far > tolerance) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Rows of the spectrogram that stand 6 dB over the rows two away, in over 60% of the frames that sound: the
 * tone lines (research/asset-reproduction-failures.md, section 4). A line between two rows lights one in some
 * frames and the other in the rest, so two rows side by side are taken as one. Each with its bin and its Hz.
 */
function linesOf(read, levels) {
  const { frames, rowBin, binHz } = read;
  const sounding = frames.filter((_, i) => levels[i] > -40);
  const found = [];
  for (let r = 2; r < SPEC - 3; r++) {
    let hits = 0;
    let upper = 0;
    for (const { rows: d } of sounding) {
      const top = Math.max(d[r], d[r + 1]);
      if (top >= d[r - 1] && top >= d[r + 2] && top > Math.max(d[r - 2], d[r + 3]) + 6) {
        hits++;
        if (d[r] >= d[r + 1]) upper++;
      }
    }
    // its bin: the one of the two rows that is the louder more often
    if (hits > 0.6 * sounding.length) found.push({ r, k: rowBin[upper * 2 >= hits ? r : r + 1], share: hits / sounding.length });
  }
  // a line over two rows, or two rows of one bin, is one: the stronger
  const lines = [];
  for (const line of found) {
    const last = lines.at(-1);
    if (last && (line.r - last.r <= 1 || Math.abs(line.k - last.k) <= 1)) {
      if (line.share > last.share) lines[lines.length - 1] = line;
    } else lines.push(line);
  }
  return lines.filter(({ k }) => k >= 3 && k < BINS - 3).map(({ k, share }) => ({ k, f: Math.round(binHz[k]), share: round(share, 2) }));
}

/**
 * A draft sound spec from a sound's picture, for the kit's own layers: one noise layer whose `shape` moves
 * through keys read off the spectrogram (the tone lines taken out of it), its envelope's points, and a
 * `modes` layer for each tone line with its level and decay. `points` (16) the points of each key's curve;
 * `iterations` (32) the noise's Griffin-Lim iterations; `name` the spec's file. Returns { spec, measures,
 * lines, onsets }: the agent edits the spec (a crack, a limiter at the crest it wants) and builds it.
 */
export function fromPicture(picture, { points = 16, iterations = 32, name, ...options } = {}) {
  const read = readSoundPicture(picture, options);
  const measures = pictureMeasures(read);
  const { frames, binHz, rate, length } = read;
  const levels = levelsOf(frames);
  const lines = linesOf(read, levels);
  const lineBins = new Set(lines.flatMap(({ k }) => [k - 2, k - 1, k, k + 1, k + 2]));
  // each frame: its power (to the loudest), the share of it in the lines, and its bins with the lines taken out
  const each = frames.map((frame, i) => {
    const total = frame.dB.reduce((a, d, k) => (k ? a + power(d) : a), 0) || 1e-30;
    const shares = lines.map(({ k }) => {
      const floor = (power(frame.dB[k - 3]) + power(frame.dB[k + 3])) / 2;
      return Math.max(0, (1.5 * (power(frame.dB[k]) - floor)) / total);
    });
    const tonal = Math.min(0.95, shares.reduce((a, b) => a + b, 0));
    const noise = Float64Array.from(frame.dB, (d, k) => {
      if (!lineBins.has(k)) return d;
      let lo = k;
      let hi = k;
      while (lineBins.has(lo) && lo > 1) lo--;
      while (lineBins.has(hi) && hi < BINS - 1) hi++;
      return frame.dB[lo] + ((frame.dB[hi] - frame.dB[lo]) * (k - lo)) / (hi - lo || 1);
    });
    return { t: frame.t, energy: 10 ** (levels[i] / 10), shares, tonal, noise };
  });
  // the keys: where it starts, its loudest, and as it falls by 6, 12, 20, 30 and 45 dB; a loop's evenly
  const topAt = levels.indexOf(Math.max(...levels));
  let at = [];
  if (read.loop) at = Array.from({ length: 6 }, (_, i) => Math.round((i * (frames.length - 1)) / 5));
  else {
    const first = levels.findIndex((v) => v > -40);
    if (first >= 0 && topAt - first >= 2) at.push(first);
    at.push(topAt);
    for (const fall of [-6, -12, -20, -30, -45]) {
      const i = levels.findIndex((v, j) => j > topAt && v < fall);
      if (i > 0 && i - at.at(-1) >= 2) at.push(i);
    }
  }
  at = [...new Set(at)].sort((a, b) => a - b);
  const pointHz = Array.from({ length: points }, (_, i) => LOWEST * (rate / 2 / LOWEST) ** (i / (points - 1)));
  const half = Math.sqrt((rate / 2 / LOWEST) ** (1 / (points - 1)));
  const keys = at.map((i, n) => {
    const from = n ? Math.ceil((at[n - 1] + i) / 2) : 0;
    const to = n < at.length - 1 ? Math.floor((i + at[n + 1]) / 2) : frames.length - 1;
    const mean = new Float64Array(BINS);
    for (let j = from; j <= to; j++) for (let k = 1; k < BINS; k++) mean[k] += power(each[j].noise[k]) / (to - from + 1);
    let curve = pointHz.map((f) => {
      let sum = 0;
      let many = 0;
      for (let k = 1; k < BINS; k++)
        if (binHz[k] >= f / half && binHz[k] < f * half) {
          sum += mean[k];
          many++;
        }
      if (!many) {
        const k = Math.max(1, Math.min(BINS - 1, Math.round((f * SIZE) / rate)));
        sum = mean[k];
        many = 1;
      }
      return [Math.round(f), 10 * Math.log10(sum / many + 1e-30)];
    });
    // each key at the level of white noise: the envelope carries the loudness
    const level = 10 * Math.log10(Array.from(binHz).slice(1).reduce((a, f) => a + power(curveAt(curve, f)), 0) / (BINS - 1));
    curve = curve.map(([f, d]) => [f, round(Math.max(-90, d - level))]);
    return { at: round(frames[i].t, 3), curve };
  });
  // the noise's envelope: its share of each frame's power, as the amplitude of noise of the kit's level
  const start = read.outline.findIndex((v) => v > 0);
  const onset = start > 0 ? (start / read.columns) * length : 0;
  const level = (e) => 10 * Math.log10(3 * e.energy * (1 - e.tonal) + 1e-12);
  // the frames' levels: 23 to 46 ms each. The outline's columns added on top of them (tried: a step's heel,
  // a shot's crack) moved each one's peak onto a spike, and T20 with it, on 7 of the 10
  const later = each.filter((e) => e.t > onset);
  const envelope = [...(onset > 0 ? [[0, -90]] : []), [onset, level(later[0] ?? each.at(-1))], ...later.map((e) => [e.t, level(e)])];
  let tolerance = 1.5;
  let env = simplify(envelope, tolerance);
  while (env.length > 24) env = simplify(envelope, (tolerance *= 1.5));
  const loudest = Math.max(...env.map((p) => p[1]));
  env = env.map(([t, d]) => [round(t, 3), round(Math.max(-90, d - loudest))]);
  // a mode for each line: from where it rises, at its own level, dying as the frames say
  const modes = lines.map((line, n) => {
    const amp = each.map((e) => Math.sqrt(2 * e.energy * e.shares[n]));
    const strongest = Math.max(...amp, 1e-12);
    const peakAt = amp.indexOf(strongest);
    const rise = Math.max(0, amp.findIndex((a) => a > strongest / 10));
    const fit = [];
    for (let j = peakAt; j < amp.length && amp[j] > strongest / 100; j++) fit.push([each[j].t, 20 * Math.log10(amp[j])]);
    let decay = 0.1;
    if (fit.length >= 3) {
      const mt = fit.reduce((a, p) => a + p[0], 0) / fit.length;
      const md = fit.reduce((a, p) => a + p[1], 0) / fit.length;
      const slope = fit.reduce((a, p) => a + (p[0] - mt) * (p[1] - md), 0) / (fit.reduce((a, p) => a + (p[0] - mt) ** 2, 0) || 1e-9);
      decay = slope < -1e-3 ? Math.min(8, Math.max(0.02, -60 / slope)) : Math.min(8, length * 3);
    }
    const from = Math.max(0, each[rise].t - HOP / rate);
    const gain = strongest * Math.exp((6.9078 * (each[peakAt].t - from)) / decay) * 10 ** (-loudest / 20);
    return { id: `line${n + 1}`, kind: "modes", at: round(from, 3), modes: [{ f: line.f, gain: round(gain, 4), decay: round(decay, 3) }] };
  });
  const spec = {
    spec: "smak.sound/1",
    name: name ?? "draft.wav",
    rate,
    length: round(length, 3),
    layers: [{ id: "body", kind: "noise", shape: keys.length > 1 ? { keys } : keys[0].curve, iterations, env: { points: env } }, ...modes],
    ...(read.loop ? { loop: true } : {}),
  };
  return { spec, measures, lines: lines.map(({ f, share }) => ({ f, share })), onsets: measures.onsetTimes };
}
