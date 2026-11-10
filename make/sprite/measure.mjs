// What a sprite is, in numbers, as the engine reads it (research/sprite-generation.md, 6.1): each frame
// turned to "energy" (what lands on the screen: brightness for additive and normal, coverage for index alpha,
// brightness where solid for alpha test), then
//
//   wrap     a loop's step at the wrap (frame n-2 to frame 0, as the engine shows it) over its mean step:
//            about 1 closes as smoothly as it moves; over 2.5 a jump the eye sees each time round
//   jitter   flicker: the mean second difference over the mean first; about 1.7 for unrelated frames
//   border   the brightest and the mean of the outer two pixels: a lit border shows the frame's square
//   envelope each frame's mean; where it peaks (0 to 1), its first and last over the peak
//   dark     the share of pixels under 0.03
//
//   measureSprite(spr) -> { frames, size, wrap, jitter, border: { max, mean }, envelope: { peakAt, first, last }, dark }
// `spr` as readSpr gives it.
//
//   measureSheet(picture, { size, format, cols, cell, tint }) -> { frames, dark, border: { max, mean }, lab }
// the same measures read off a contact sheet as sheetOf draws one (a reference picture): MEASURES ONLY, its
// pixels are never kept (research/asset-reproduction-failures.md, section 7).
import { toLab } from "./colours.mjs";
import { DARK, GREY, cellOf } from "./draw.mjs";

const lum = (r, g, b) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

/** A frame's energy, a Float32Array of 0 to 1 a pixel. */
export function energyOf(spr, frame) {
  const { palette, format } = spr;
  const e = new Float32Array(frame.width * frame.height);
  for (let i = 0; i < e.length; i++) {
    const p = frame.pixels[i];
    e[i] =
      format === "index alpha" ? p / 255 : format === "alpha test" && p === 255 ? 0 : lum(palette[p * 3], palette[p * 3 + 1], palette[p * 3 + 2]);
  }
  return e;
}

const meanAbs = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / (a.length || 1);
};
const round = (v, k = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** k) / 10 ** k : null);

export function measureSprite(spr, { loop = false } = {}) {
  const same = spr.frames.every((f) => f.width === spr.frames[0].width && f.height === spr.frames[0].height);
  const energies = spr.frames.map((f) => energyOf(spr, f));
  const { width, height } = spr.frames[0];
  // the border: the outer two pixels of every frame
  let borderMax = 0;
  let borderSum = 0;
  let borderN = 0;
  let dark = 0;
  let all = 0;
  energies.forEach((e, n) => {
    const f = spr.frames[n];
    for (let y = 0; y < f.height; y++)
      for (let x = 0; x < f.width; x++) {
        const v = e[y * f.width + x];
        all++;
        if (v < 0.03) dark++;
        if (x < 2 || y < 2 || x >= f.width - 2 || y >= f.height - 2) {
          borderMax = Math.max(borderMax, v);
          borderSum += v;
          borderN++;
        }
      }
  });
  const means = energies.map((e) => e.reduce((s, v) => s + v, 0) / (e.length || 1));
  const peak = Math.max(...means, 1e-9);
  const peakAt = means.indexOf(peak);
  const out = {
    frames: spr.frames.length,
    size: [width, height],
    border: { max: round(borderMax), mean: round(borderSum / (borderN || 1)) },
    envelope: { peakAt: round(spr.frames.length > 1 ? peakAt / (spr.frames.length - 1) : 0, 2), first: round(means[0] / peak, 2), last: round(means.at(-1) / peak, 2) },
    dark: round(dark / (all || 1), 2),
    wrap: null,
    jitter: null,
  };
  if (same && energies.length >= 3) {
    // the frames the engine shows: a loop's last frame is its first again and is never shown
    const shown = loop ? energies.slice(0, -1) : energies;
    const steps = shown.slice(1).map((e, i) => meanAbs(e, shown[i]));
    const meanStep = steps.reduce((s, v) => s + v, 0) / (steps.length || 1);
    if (loop && shown.length >= 2) out.wrap = round(meanAbs(shown.at(-1), shown[0]) / (meanStep || 1e-9), 2);
    if (shown.length >= 3) {
      let second = 0;
      for (let t = 1; t < shown.length - 1; t++) {
        let s = 0;
        for (let i = 0; i < shown[t].length; i++) s += Math.abs(shown[t + 1][i] - 2 * shown[t][i] + shown[t - 1][i]);
        second += s / shown[t].length;
      }
      out.jitter = round(second / (shown.length - 2) / (meanStep || 1e-9), 2);
    }
  }
  return out;
}

/**
 * What Half-Life's own sprites of each kind measure (research/sprite-generation.md, 6.2; numbers only).
 * Explosions, loops and sparks are the ranges of ten, ten and four files; a smoke puff's rests on one
 * (steam1: jitter 1.11, peak at 0.40, first and last 0.04 and 0.03), widened; glows, flares and rings are held
 * only to a dark border, which all but two of the game's 74 animated sprites keep. A beam is drawn along its
 * length and across its width, so its edge is lit: the game's sixteen (laserbeam, lgtning, plasma, smoke, xenobeam,
 * xbeam1-5, zbeam1-6) have a border of 0.009 to 0.261, are 16 or 32 by 64, and hold steady (first and last 0.92 to 1).
 * A muzzle flash's frames are flashes each of its own: the engine shows one frame, picked at random, for one frame
 * of play (R_MuzzleFlash; Xash3D's engine/client/cl_tent.c). The game's four (muzzleflash, 1 to 3) are every frame
 * bright (first and last 0.94 to 1), with a dark border.
 */
export const SPRITE_CLASSES = {
  explosion: { jitter: [1.04, 1.48], border: [0, 0.005], peakAt: [0.22, 0.71], first: [0, 0.22], last: [0, 0.03] },
  "fire loop": { jitter: [1.33, 1.79], wrap: [0, 2.48], border: [0, 0.028], first: [0.57, 1], last: [0.57, 1] },
  "smoke loop": { jitter: [1.33, 1.79], wrap: [0, 2.48], border: [0, 0.028], first: [0.57, 1], last: [0.57, 1] },
  sparks: { jitter: [1.72, 2.0], border: [0, 0.005] },
  "smoke puff": { jitter: [0.9, 1.5], border: [0, 0.005], peakAt: [0.2, 0.6], first: [0, 0.35], last: [0, 0.1] },
  glow: { border: [0, 0.005] },
  flare: { border: [0, 0.005] },
  "muzzle flash": { border: [0, 0.005], first: [0.9, 1], last: [0.9, 1] },
  ring: { border: [0, 0.005], last: [0, 0.1] },
  beam: { border: [0, 0.27], first: [0.9, 1], last: [0.9, 1] },
};

/** The measures held against a kind: [{ measure, value, range, ok }] and words for each one out. */
export function againstClass(measured, name) {
  const ranges = SPRITE_CLASSES[name];
  if (!ranges) return null;
  const value = { jitter: measured.jitter, wrap: measured.wrap, border: measured.border.mean, peakAt: measured.envelope.peakAt, first: measured.envelope.first, last: measured.envelope.last };
  const hints = { jitter: ["too smooth: little inner motion", "flickers: more coherence from frame to frame"], wrap: ["", "jumps at the wrap: make the motion periodic"], border: ["", "light at the edge: fade more (finish.edge) or shrink the effect"], peakAt: ["peaks too soon", "peaks too late"], first: ["starts too dark for a loop", "starts too bright: an attack in its envelope"], last: ["ends too dark for a loop", "does not end dark: a decay in its envelope"] };
  return Object.entries(ranges)
    .filter(([k]) => value[k] !== null && value[k] !== undefined)
    .map(([k, [lo, hi]]) => {
      const v = value[k];
      const ok = v >= lo && v <= hi;
      return { measure: k, value: v, range: [lo, hi], ok, words: ok ? "" : hints[k][v < lo ? 0 : 1] };
    });
}

/** Where a sheet writes a frame's number, from its cell's corner: the band behind the digits (render.mjs's label). */
const NUMBER = { x: 4, y: 4, high: 14, digit: 8, colour: [235, 235, 235] };

/** The mean CIELAB of a picture's pixels that differ from its ground: the judge's mean colour. */
export function meanLab(picture, ground) {
  let s = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < picture.rgba.length; i += 4) {
    const c = [picture.rgba[i], picture.rgba[i + 1], picture.rgba[i + 2]];
    if (ground && c.every((v, k) => Math.abs(v - ground[k]) < 4)) continue;
    const lab = toLab(c.map((v) => v / 255));
    s = s.map((v, k) => v + lab[k]);
    n++;
  }
  return n ? s.map((v) => v / n) : null;
}

/**
 * A contact sheet measured as measureSprite measures a sprite: `size` the frame's [w, h], `format` the
 * sprite's, `cols` and `cell` as the sheet was drawn with (8 and 128). Each frame is read at the middle of
 * each of its enlarged pixels, its number's band left out; its energy is the light over the dark ground
 * (additive), the colour itself (normal, alpha test), or how far it is from the grey toward `tint` (index
 * alpha). A cell counts as a frame when its number is written in it.
 */
export function measureSheet(picture, { size: [w, h], format = "additive", cols = 8, cell = 128, tint = [1, 1, 1] }) {
  const k = cellOf([w, h], cell);
  const [cw, ch] = [w * k, h * k];
  if (picture.width % cw || picture.height % ch) return { error: `the picture (${picture.width}x${picture.height}) is not a grid of ${cw}x${ch} cells: a ${w}x${h} sprite drawn ${cols} to a row at cell ${cell}` };
  const ground = format === "additive" ? DARK : GREY;
  const at = (x, y) => [0, 1, 2].map((j) => picture.rgba[(y * picture.width + x) * 4 + j]);
  const toward = lum(...tint.map((v) => v * 255)) - lum(...ground);
  const energy = (c) => {
    if (format === "additive") return lum(...c.map((v, j) => Math.max(0, v - ground[j])));
    if (format === "index alpha") return Math.min(1, Math.max(0, (lum(...c) - lum(...ground)) / (toward || 1)));
    if (format === "alpha test" && c.every((v, j) => v === ground[j])) return 0;
    return lum(...c);
  };
  let frames = 0;
  let dark = 0;
  // each frame's brightness by sprite pixel (the effect's energy, 0 to 1): its shape at any level of light
  const masks = [];
  let all = 0;
  let borderMax = 0;
  let borderSum = 0;
  let borderN = 0;
  const across = Math.min(cols, picture.width / cw);
  for (let row = 0; row < picture.height / ch; row++)
    for (let col = 0; col < across; col++) {
      const left = col * cw;
      const top = row * ch;
      // the frame's number, in the label's light grey within the band at the cell's corner
      const digits = String(row * across + col).length;
      const band = { x1: NUMBER.x + NUMBER.digit * digits + 2, y1: NUMBER.y + NUMBER.high };
      let numbered = false;
      for (let y = NUMBER.y; y < band.y1 && !numbered; y++)
        for (let x = NUMBER.x; x < band.x1 && !numbered; x++) numbered = x < cw && y < ch && at(left + x, top + y).every((v, j) => v === NUMBER.colour[j]);
      if (!numbered) continue;
      frames++;
      const mask = new Float32Array(w * h);
      masks.push(mask);
      for (let fy = 0; fy < h; fy++)
        for (let fx = 0; fx < w; fx++) {
          const x = fx * k + (k >> 1);
          const y = fy * k + (k >> 1);
          if (x >= NUMBER.x - 2 && x < band.x1 && y >= NUMBER.y - 2 && y < band.y1) continue;
          const e = energy(at(left + x, top + y));
          all++;
          if (e < 0.03) dark++;
          mask[fy * w + fx] = e;
          if (fx < 2 || fy < 2 || fx >= w - 2 || fy >= h - 2) {
            borderMax = Math.max(borderMax, e);
            borderSum += e;
            borderN++;
          }
        }
    }
  return { frames, dark: round(dark / (all || 1), 2), border: { max: round(borderMax), mean: round(borderSum / (borderN || 1)) }, lab: meanLab(picture, ground), masks };
}

/** The levels of light a shape is compared at: its faint edge, its body, its core. */
export const SHAPE_LEVELS = [0.03, 0.15, 0.4];

/**
 * How two sheets' shapes agree, frame by frame (`masks` of `measureSheet`, one sprite size): each frame of
 * `ours` set against the frame of `theirs` at the same share of the way through, at each level of
 * SHAPE_LEVELS the share of pixels over it in both of those over it in either, and the frame's overlap the
 * mean of the levels where either has any. `{ mean, frames: [overlap a frame], levels: [mean at each level],
 * worst: [frame numbers under 0.6] }`: a core too wide or too narrow shows at the higher levels.
 */
export function shapeOverlap(theirs, ours) {
  if (!theirs.length || !ours.length) return { mean: 0, frames: [], levels: [], worst: [] };
  const atLevels = ours.map((mine, i) => {
    const other = theirs[Math.min(theirs.length - 1, Math.round((i / Math.max(1, ours.length - 1)) * (theirs.length - 1)))];
    return SHAPE_LEVELS.map((level) => {
      let both = 0;
      let either = 0;
      for (let j = 0; j < mine.length; j++) {
        const a = mine[j] >= level;
        const b = other[j] >= level;
        if (a && b) both++;
        if (a || b) either++;
      }
      return either ? both / either : null;
    });
  });
  const frames = atLevels.map((ls) => {
    const some = ls.filter((v) => v !== null);
    return some.length ? round(some.reduce((a, b) => a + b, 0) / some.length, 2) : 1;
  });
  const levels = SHAPE_LEVELS.map((_, k) => {
    const some = atLevels.map((ls) => ls[k]).filter((v) => v !== null);
    return some.length ? round(some.reduce((a, b) => a + b, 0) / some.length, 2) : null;
  });
  return { mean: round(frames.reduce((a, b) => a + b, 0) / frames.length, 2), frames, levels, worst: frames.map((v, i) => [v, i]).filter(([v]) => v < 0.6).map(([, i]) => i) };
}

/**
 * A reference sheet's colour by brightness, as ramp stops: every lit pixel of its frames (the frame numbers left
 * out), less the sheet's ground, grouped by its brightness against the sheet's brightest into `count` steps, each
 * step's mean colour. A layer with `ramp: "reference"` wears it: its colour at each brightness is the reference's
 * own there (Steven, 2026-10-15: a flare's halo peach in the original and violet in the copy).
 */
export function rampOfSheet(picture, { format = "additive", count = 12, most: given = null } = {}) {
  const ground = format === "additive" ? DARK : GREY;
  const { width, height, rgba } = picture;
  const lumOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  const lits = [];
  let most = 0;
  for (let i = 0; i < width * height; i++) {
    const c = [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]];
    if (c.every((v, j) => v === NUMBER.colour[j])) continue;
    const own = c.map((v, j) => Math.max(0, v - ground[j]) / 255);
    const l = lumOf(...own);
    if (l < 0.01) continue;
    lits.push([l, own]);
    most = Math.max(most, l);
  }
  if (!lits.length) return null;
  if (given) most = given;
  const sums = Array.from({ length: count }, () => ({ n: 0, c: [0, 0, 0] }));
  for (const [l, c] of lits) {
    const k = Math.min(count - 1, Math.floor((l / most) * count));
    sums[k].n++;
    c.forEach((v, j) => (sums[k].c[j] += v));
  }
  const stops = [[0, [0, 0, 0]]];
  sums.forEach((s, k) => s.n && stops.push([(k + 0.5) / count, s.c.map((v) => Math.round((v / s.n) * 1000) / 1000)]));
  return stops;
}

/**
 * The reference's colour by brightness frame by frame: `{ frames: [stops, ...] }`, each frame's own (its brightness
 * against the whole sheet's brightest, so a dim late frame keeps its place), a frame with few lit pixels taking the
 * whole sheet's. An explosion is white at its height and orange as it cools, at the same brightness.
 */
export function rampOfFrames(picture, { size: [w, h], format = "additive", cols = 8, cell = 128, frames }) {
  const whole = rampOfSheet(picture, { format });
  if (!whole) return null;
  const k = cellOf([w, h], cell);
  const [cw, ch] = [w * k, h * k];
  const ground = format === "additive" ? DARK : GREY;
  let most = 0;
  for (let i = 0; i < picture.width * picture.height; i++) {
    const c = [0, 1, 2].map((j) => Math.max(0, picture.rgba[i * 4 + j] - ground[j]) / 255);
    if ([0, 1, 2].every((j) => picture.rgba[i * 4 + j] === NUMBER.colour[j])) continue;
    most = Math.max(most, 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]);
  }
  const across = Math.min(cols, Math.floor(picture.width / cw));
  const list = [];
  for (let n = 0; n < frames; n++) {
    const [left, top] = [(n % across) * cw, Math.floor(n / across) * ch];
    if (top + ch > picture.height) break;
    const rgba = new Uint8Array(cw * ch * 4);
    for (let y = 0; y < ch; y++) rgba.set(picture.rgba.subarray(((top + y) * picture.width + left) * 4, ((top + y) * picture.width + left + cw) * 4), y * cw * 4);
    // the frame's number in its corner is left out by its colour
    const own = rampOfSheet({ width: cw, height: ch, rgba }, { format, most });
    list.push(own && own.length >= 4 ? own : whole);
  }
  return list.length ? { frames: list } : whole;
}
