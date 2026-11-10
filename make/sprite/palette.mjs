// One palette for every frame of a sprite, as the format needs it (research/sprite-generation.md, 5.5):
//
//   additive     near-black made black; 255 colours by median cut over every frame stacked, sorted dark to
//                bright with pure black at 0 (black adds nothing: it is the sprite's "clear")
//   index alpha  the index is the coverage (0 clear, 255 solid); the colour is palette entry 255, the rest a
//                grey ramp for an editor to read
//   alpha test   255 colours over the solid pixels; index 255 is a hole (blue in the palette, as decals have it)
//   normal       256 colours by median cut
//
//   quantiseFrames(frames, format, { colour }) -> { palette, pixels: [Uint8Array a frame], error, colours }
// A frame is { width, height, rgb: Float32Array (3 a pixel, 0 to 1), a: Float32Array (coverage, 0 to 1) }.
import { indexed } from "../../core/image.mjs";

/** Under this (0 to 1, the brightest channel), an additive pixel is black: anything above adds a faint square. */
const BLACK_UNDER = 0.02;
const luminance = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Frames stacked into one picture of bytes, pixels for which `take` is false left black. */
function stacked(frames, take = () => true) {
  const width = Math.max(...frames.map((f) => f.width));
  const height = frames.reduce((sum, f) => sum + f.height, 0);
  const rgb = new Uint8Array(width * height * 3);
  let row = 0;
  for (const f of frames) {
    for (let y = 0; y < f.height; y++)
      for (let x = 0; x < f.width; x++) {
        const i = y * f.width + x;
        if (!take(f, i)) continue;
        const o = ((row + y) * width + x) * 3;
        for (let c = 0; c < 3; c++) rgb[o + c] = Math.round(255 * Math.min(1, Math.max(0, f.rgb[i * 3 + c])));
      }
    row += f.height;
  }
  return { width, height, rgb };
}

/** Each frame's pixels cut back out of the stacked picture's indices. */
function unstack(frames, indices, width) {
  const out = [];
  let row = 0;
  for (const f of frames) {
    const pixels = new Uint8Array(f.width * f.height);
    for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) pixels[y * f.width + x] = indices[(row + y) * width + x];
    out.push(pixels);
    row += f.height;
  }
  return out;
}

/**
 * The one colour every lit pixel of the frames is a shade of (its brightest channel 1), or null: each pixel within
 * 2 in 255 of that colour scaled to its brightness.
 */
function oneHue(frames) {
  let best = null;
  let most = 0;
  for (const f of frames)
    for (let i = 0; i < f.width * f.height; i++) {
      const m = Math.max(f.rgb[i * 3], f.rgb[i * 3 + 1], f.rgb[i * 3 + 2]);
      if (m > most) [most, best] = [m, [f.rgb[i * 3] / m, f.rgb[i * 3 + 1] / m, f.rgb[i * 3 + 2] / m]];
    }
  if (!best) return null;
  for (const f of frames)
    for (let i = 0; i < f.width * f.height; i++) {
      const m = Math.max(f.rgb[i * 3], f.rgb[i * 3 + 1], f.rgb[i * 3 + 2]);
      if (m < BLACK_UNDER) continue;
      for (let c = 0; c < 3; c++) if (Math.abs(Math.min(1, f.rgb[i * 3 + c]) - Math.min(1, best[c] * m)) > 2 / 255) return null;
    }
  return best;
}

export function quantiseFrames(frames, format, { colour = [1, 1, 1] } = {}) {
  const palette = new Uint8Array(768);
  let pixels;
  if (format === "index alpha") {
    for (let i = 0; i < 255; i++) palette.set([i, i, i], i * 3);
    palette.set(colour.map((v) => Math.round(255 * v)), 255 * 3);
    pixels = frames.map((f) => Uint8Array.from(f.a, (a) => Math.round(255 * Math.min(1, Math.max(0, a)))));
  } else if (format === "alpha test") {
    const picture = stacked(frames, (f, i) => f.a[i] >= 0.5);
    const texture = indexed(picture, "sprite", 255);
    palette.set(texture.palette.subarray(0, 255 * 3));
    palette.set([0, 0, 255], 255 * 3);
    const all = unstack(frames, texture.pixels, picture.width);
    pixels = all.map((p, n) => p.map((index, i) => (frames[n].a[i] >= 0.5 ? index : 255)));
  } else if (format === "additive" && oneHue(frames)) {
    // a light of one colour (a white glow): 255 steps of that colour from black, as Valve's glows are. Median cut
    // spent its entries on the many faint pixels' few values and left a soft falloff in 48 bands (Steven, 2026-10-15:
    // "as if I went from 16 to 8 bit colour")
    const hue = oneHue(frames);
    for (let k = 0; k < 256; k++) palette.set(hue.map((c) => Math.round((255 * c * k) / 255)), k * 3);
    pixels = frames.map((f) => {
      const out = new Uint8Array(f.width * f.height);
      for (let i = 0; i < out.length; i++) {
        const level = Math.max(f.rgb[i * 3], f.rgb[i * 3 + 1], f.rgb[i * 3 + 2]) / Math.max(...hue);
        out[i] = level * Math.max(...hue) < BLACK_UNDER ? 0 : Math.max(1, Math.min(255, Math.round(255 * level)));
      }
      return out;
    });
  } else if (format === "additive") {
    // near-black to black first, so that one entry is pure black and nothing faint is left round the effect
    const darkened = frames.map((f) => ({ ...f, rgb: f.rgb.map((v, i, all) => (Math.max(all[i - (i % 3)], all[i - (i % 3) + 1], all[i - (i % 3) + 2]) < BLACK_UNDER ? 0 : v)) }));
    const picture = stacked(darkened);
    const texture = indexed(picture, "sprite", 255);
    // sorted dark to bright, black first: index 0 pure black
    const order = Array.from({ length: 255 }, (_, i) => i).sort(
      (a, b) => luminance(...texture.palette.subarray(a * 3, a * 3 + 3)) - luminance(...texture.palette.subarray(b * 3, b * 3 + 3)),
    );
    const newIndex = new Uint8Array(256);
    order.forEach((old, k) => {
      newIndex[old] = k + 1;
      palette.set(texture.palette.subarray(old * 3, old * 3 + 3), (k + 1) * 3);
    });
    const black = (i) => picture.rgb[i * 3] === 0 && picture.rgb[i * 3 + 1] === 0 && picture.rgb[i * 3 + 2] === 0;
    const remapped = texture.pixels.map((p, i) => (black(i) ? 0 : newIndex[p]));
    pixels = unstack(frames, remapped, picture.width);
  } else {
    const picture = stacked(frames);
    const texture = indexed(picture, "sprite", 256);
    palette.set(texture.palette);
    pixels = unstack(frames, texture.pixels, picture.width);
  }
  // what was lost: the mean difference in energy (luminance, or coverage) a pixel, 0 to 1
  let lost = 0;
  let count = 0;
  frames.forEach((f, n) => {
    for (let i = 0; i < f.width * f.height; i++) {
      const p = pixels[n][i];
      const before = format === "index alpha" ? f.a[i] : luminance(f.rgb[i * 3], f.rgb[i * 3 + 1], f.rgb[i * 3 + 2]);
      const after = format === "index alpha" ? p / 255 : format === "alpha test" && p === 255 ? 0 : luminance(palette[p * 3] / 255, palette[p * 3 + 1] / 255, palette[p * 3 + 2] / 255);
      lost += Math.abs(Math.min(1, before) - after);
      count++;
    }
  });
  const used = new Set(pixels.flatMap((p) => [...p]));
  return { palette, pixels, error: Math.round((10000 * lost) / (count || 1)) / 10000, colours: used.size };
}
