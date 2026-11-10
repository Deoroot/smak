// A sound drawn for an agent to read: its waveform over a spectrogram on a log scale of frequency, with lines
// at -6 and -20 dBFS and the loop's start marked; several sounds one under another at one time scale, so a
// made sound and the game's of its kind are seen together. research/sound-generation.md, section 5.5.
//
//   soundPicture([{ name, x, rate, loop }], { width }) -> { width, height, rgba }
//   PICTURE, levelOf(r, g, b)                         -> its layout; a spectrogram colour back to its level

import { spectrum } from "./measure.mjs";
import { label } from "../render.mjs";

const WAVE = 70;
const SPEC = 150;
const LOWEST = 50;
/** The picture's layout, for reading one back (`fromPicture`): rows, the frame, the depth of its colours (dB). */
export const PICTURE = { wave: WAVE, spectrogram: SPEC, gap: 4, lowest: LOWEST, frame: 512, depth: 80, waveColour: [90, 160, 255], ground: [18, 20, 26] };

/** A spectrogram's colour, 0 (80 dB under the loudest bin, or less) to 1 (the loudest). */
const colourOf = (v) => [Math.round(255 * Math.min(1, v * 1.5)), Math.round(255 * Math.max(0, v * 1.6 - 0.6)), Math.round(110 * Math.max(0, 1 - v * 2))];

/** A spectrogram's colour back to its level, 0 to 1; null for a colour it does not use (a mark, a line). */
export function levelOf(r, g, b) {
  const v = g > 0 ? (g / 255 + 0.6) / 1.6 : r / 382.5;
  const [cr, cg, cb] = colourOf(Math.min(1, v));
  return Math.abs(cr - r) <= 2 && Math.abs(cg - g) <= 2 && Math.abs(cb - b) <= 2 ? Math.min(1, v) : null;
}

/** One row: { name, x, rate, loop }, drawn over `seconds` (the longest of the set) across `width`. */
function rowPicture({ name, x, rate, loop }, width, seconds) {
  const height = WAVE + SPEC;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([18, 20, 26, 255], i);
  const put = (px, py, c) => {
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    rgba.set([...c, 255], (py * width + px) * 4);
  };
  const columns = Math.min(width, Math.round((x.length / rate / seconds) * width));
  // the waveform: min and max a column, lines at -6 and -20 dBFS
  for (const dB of [-6, -20]) {
    const h = Math.round((10 ** (dB / 20) * WAVE) / 2);
    for (let px = 0; px < width; px += 2) {
      put(px, WAVE / 2 - h, [60, 60, 70]);
      put(px, WAVE / 2 + h, [60, 60, 70]);
    }
  }
  for (let px = 0; px < columns; px++) {
    const a = Math.floor((px * x.length) / columns);
    const b = Math.max(a + 1, Math.floor(((px + 1) * x.length) / columns));
    let lo = 0;
    let hi = 0;
    for (let i = a; i < b && i < x.length; i++) {
      lo = Math.min(lo, x[i]);
      hi = Math.max(hi, x[i]);
    }
    for (let py = Math.round(WAVE / 2 - (hi * WAVE) / 2); py <= Math.round(WAVE / 2 - (lo * WAVE) / 2); py++) put(px, py, [90, 160, 255]);
  }
  if (loop !== null && loop !== undefined) {
    const px = Math.round((loop / x.length) * columns);
    for (let py = 0; py < height; py++) put(px, py, [255, 220, 60]);
  }
  // the spectrogram: frames of power, log frequency from 50 Hz to half the rate, 80 dB deep
  const { frames, size } = spectrum(x, rate, 512);
  const top = Math.max(...frames.map((f) => Math.max(...f)), 1e-20);
  for (let px = 0; px < columns; px++) {
    const frame = frames[Math.min(frames.length - 1, Math.floor((px / columns) * frames.length))];
    for (let py = 0; py < SPEC; py++) {
      const f = LOWEST * (rate / 2 / LOWEST) ** (1 - py / SPEC);
      const k = Math.min(frame.length - 1, Math.round((f * size) / rate));
      const v = Math.max(0, Math.min(1, (10 * Math.log10(frame[k] / top + 1e-12) + 80) / 80));
      put(px, WAVE + py, colourOf(v));
    }
  }
  // 100 Hz, 1 kHz, 5 kHz marked down the side
  for (const f of [100, 1000, 5000]) {
    if (f >= rate / 2) continue;
    const py = WAVE + Math.round(SPEC * (1 - Math.log(f / LOWEST) / Math.log(rate / 2 / LOWEST)));
    for (let px = 0; px < 6; px++) put(px, py, [200, 200, 200]);
  }
  return label({ width, height, rgba }, `${name}  ${(x.length / rate).toFixed(2)} s`, 8, 4);
}

/** The sounds one under another at one time scale. */
export function soundPicture(rows, { width = 640 } = {}) {
  const seconds = Math.max(...rows.map((r) => r.x.length / r.rate));
  const pictures = rows.map((r) => rowPicture(r, width, seconds));
  const height = pictures.reduce((h, p) => h + p.height + 4, 0);
  const rgba = new Uint8Array(width * height * 4);
  let y = 0;
  for (const p of pictures) {
    rgba.set(p.rgba, y * width * 4);
    y += p.height + 4;
  }
  return { width, height, rgba };
}
