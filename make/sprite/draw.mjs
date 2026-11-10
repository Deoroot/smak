// A sprite drawn for looking at: every frame as the engine blends it (an additive one added to a dark ground,
// a coverage one laid over a mid grey, an alpha test one with its holes), enlarged by whole times, in a grid
// with each frame's number: the contact sheet the agent reads. And an animated PNG of it for the person.
//
//   sheetOf(spr, { cols, cell }) -> { width, height, rgba }
//   cellOf(size, cell) -> the whole times a frame of `size` is enlarged in a sheet's cell
//   animationOf(spr, { fps, cell }) -> PNG bytes (animated)
import { tile } from "../render.mjs";
import { apng } from "../../core/image.mjs";

/** The grounds a sprite is drawn over: dark for an additive one, a mid grey for the others. */
export const DARK = [20, 22, 26];
export const GREY = [110, 112, 116];

/** One frame as the engine would show it over its ground, enlarged `k` times: { width, height, rgba }. */
function shown(spr, frame, k, size) {
  const [w, h] = size;
  const rgba = new Uint8Array(w * k * h * k * 4);
  const additive = spr.format === "additive" || spr.format === "normal";
  const ground = spr.format === "additive" ? DARK : GREY;
  const ox = Math.floor((w - frame.width) / 2);
  const oy = Math.floor((h - frame.height) / 2);
  for (let y = 0; y < h * k; y++)
    for (let x = 0; x < w * k; x++) {
      const fx = Math.floor(x / k) - ox;
      const fy = Math.floor(y / k) - oy;
      let c = ground;
      if (fx >= 0 && fy >= 0 && fx < frame.width && fy < frame.height) {
        const p = frame.pixels[fy * frame.width + fx];
        const col = [0, 1, 2].map((j) => spr.palette[p * 3 + j]);
        if (spr.format === "index alpha") {
          const tint = [0, 1, 2].map((j) => spr.palette[255 * 3 + j]);
          c = ground.map((g, j) => Math.round(g * (1 - p / 255) + tint[j] * (p / 255)));
        } else if (spr.format === "alpha test") c = p === 255 ? ground : col;
        else c = additive && spr.format === "additive" ? ground.map((g, j) => Math.min(255, g + col[j])) : col;
      }
      rgba.set([...c, 255], (y * w * k + x) * 4);
    }
  return { width: w * k, height: h * k, rgba };
}

export const cellOf = ([w, h], cell) => Math.max(1, Math.floor(cell / Math.max(w, h)));
const fit = (spr, cell) => {
  const w = Math.max(...spr.frames.map((f) => f.width));
  const h = Math.max(...spr.frames.map((f) => f.height));
  return { size: [w, h], k: cellOf([w, h], cell) };
};

export function sheetOf(spr, { cols = 8, cell = 128 } = {}) {
  const { size, k } = fit(spr, cell);
  const pictures = spr.frames.map((f) => shown(spr, f, k, size));
  return tile(pictures, Math.min(cols, pictures.length), pictures.map((_, n) => String(n)));
}

export function animationOf(spr, { fps = 10, cell = 192, loop = false } = {}) {
  const { size, k } = fit(spr, cell);
  // as the engine plays a loop: every frame but the last, which stands for the first
  const frames = loop && spr.frames.length > 2 ? spr.frames.slice(0, -1) : spr.frames;
  const pictures = frames.map((f) => shown(spr, f, k, size));
  return apng(pictures[0].width, pictures[0].height, pictures.map((p) => p.rgba), { delay: 1000 / fps });
}
