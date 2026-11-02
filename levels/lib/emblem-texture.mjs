// Vector art made a GoldSrc texture: an SVG (levels/lib/emblems.mjs) rasterized (levels/lib/svg-raster.mjs), finished
// the way a painter would (a dark keyline round a masked sign, the relief of its gold lit from the top left, the
// grain of a CC0 photo through the paint, spray thinning at its edges), then cut to 256 colours with index 255 the
// hole, its four mips made, and written to a WAD by the art kit's own code (levels/lib/art-kit.mjs).
//
//   svgPicture(svg, width, height)                      -> { width, height, rgba } (straight alpha)
//   grainOf(picture)                                    -> Float32Array: each pixel's luminance over the mean
//   finishPicture(picture, opts)                        -> { width, height, rgba } ready to quantize
//   paletteTexture(name, picture)                       -> a texture { name, width, height, pixels, palette, mips, holes, stats }
//
// Deterministic: the same SVG, photos and options give the same bytes.
import { rasterizeSvg } from "./svg-raster.mjs";
import { quantize, textureMeasures, MASK_KEY } from "../../src/maps/texture-recipe.mjs";
import { mipsOf, HOLE } from "../../src/maps/miptex.mjs";
import { nameProblems } from "./art-kit.mjs";

/** The SVG drawn at the texture's size; refuses one that holds things the rasterizer leaves out. */
export function svgPicture(svg, width, height, supersample = 4) {
  const p = rasterizeSvg(svg, { width, height, supersample });
  if (p.skipped.length) throw new Error(`the SVG holds what is not drawn: ${p.skipped.join(", ")}`);
  return { width: p.width, height: p.height, rgba: p.rgba };
}
/** Each pixel's luminance over the picture's mean (1 = average): a photo's grain to lay through flat paint. */
export function grainOf({ width, height, rgba }) {
  const g = new Float32Array(width * height);
  let sum = 0;
  for (let i = 0; i < g.length; i++)
    sum += g[i] = 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];
  const mean = sum / g.length || 1;
  for (let i = 0; i < g.length; i++) g[i] /= mean;
  return g;
}
const boxBlur = (src, w, h, r) => {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) if (x + k >= 0 && x + k < w) ((s += src[y * w + x + k]), n++);
      tmp[y * w + x] = s / n;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) if (y + k >= 0 && y + k < h) ((s += tmp[(y + k) * w + x]), n++);
      out[y * w + x] = s / n;
    }
  return out;
};
/**
 * The rasterized art finished for the engine. Options:
 *   masked      true: alpha under `threshold` (0-1, default 0.5) becomes a hole, the rest solid
 *   keyline     { px, colour [r,g,b] }: a dark rim `px` texels wide under a masked sign, so it reads on any wall
 *   height      a picture whose luminance x alpha is the relief (the same design in the height palette)
 *   emboss      how strongly the relief is lit from the top left (0-1.5, default 0.8)
 *   grain       { high, low, amount }: grains (grainOf) laid through the colour, `high` where the relief is over
 *               0.75 (the gold), `low` elsewhere; `amount` 0-1 (default 0.25)
 *   spray       true: paint thinner (lighter, less saturated) where its coverage is low, as a can's edge
 *   under       a picture the art is laid over (a plain texture's background)
 */
export function finishPicture(picture, opts = {}) {
  const { width: w, height: h } = picture;
  const N = w * h;
  const rgb = new Float32Array(N * 3);
  let alpha = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    alpha[i] = picture.rgba[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = picture.rgba[i * 4 + c] / 255;
  }
  if (opts.spray)
    for (let i = 0; i < N; i++) {
      const thin = 1 - Math.min(1, alpha[i] * 1.25);
      for (let c = 0; c < 3; c++) rgb[i * 3 + c] = rgb[i * 3 + c] * (1 - 0.35 * thin) + 0.12 * thin;
    }
  if (opts.height) {
    const H = new Float32Array(N);
    for (let i = 0; i < N; i++)
      H[i] =
        ((0.2126 * opts.height.rgba[i * 4] +
          0.7152 * opts.height.rgba[i * 4 + 1] +
          0.0722 * opts.height.rgba[i * 4 + 2]) /
          255) *
        (opts.height.rgba[i * 4 + 3] / 255);
    const hb = boxBlur(boxBlur(H, w, h, 1), w, h, 1);
    const k = (opts.emboss ?? 0.8) * 2.2;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const at = (xx, yy) => hb[Math.min(h - 1, Math.max(0, yy)) * w + Math.min(w - 1, Math.max(0, xx))];
        const dx = at(x + 1, y) - at(x - 1, y);
        const dy = at(x, y + 1) - at(x, y - 1);
        // light from the top left: a face rising toward it is lit, one falling away is shaded
        const shade = Math.max(0.45, Math.min(1.6, 1 + k * (-dx - dy) * 0.7));
        const g = opts.grain ? (H[i] > 0.75 ? opts.grain.high : opts.grain.low) : null;
        const grain = g ? 1 + (opts.grain.amount ?? 0.25) * (g[i] - 1) : 1;
        for (let c = 0; c < 3; c++) rgb[i * 3 + c] *= shade * grain;
      }
  } else if (opts.grain) {
    const g = opts.grain.low ?? opts.grain.high;
    for (let i = 0; i < N; i++)
      for (let c = 0; c < 3; c++) rgb[i * 3 + c] *= 1 + (opts.grain.amount ?? 0.25) * (g[i] - 1);
  }
  if (opts.keyline?.px > 0) {
    // the rim: the art's coverage grown by px texels (a disc), dark, under the art
    const r = opts.keyline.px;
    const grown = new Float32Array(N);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let m = 0;
        for (let j = -Math.ceil(r); j <= Math.ceil(r); j++)
          for (let i = -Math.ceil(r); i <= Math.ceil(r); i++) {
            if (i * i + j * j > r * r + 0.25) continue;
            const xx = x + i;
            const yy = y + j;
            if (xx >= 0 && yy >= 0 && xx < w && yy < h) m = Math.max(m, alpha[yy * w + xx]);
          }
        grown[y * w + x] = m;
      }
    const kc = opts.keyline.colour.map((v) => v / 255);
    for (let i = 0; i < N; i++) {
      const a = alpha[i];
      for (let c = 0; c < 3; c++) rgb[i * 3 + c] = rgb[i * 3 + c] * a + kc[c] * (1 - a);
    }
    alpha = grown;
  }
  const rgba = new Uint8Array(N * 4);
  const t = opts.threshold ?? 0.5;
  for (let i = 0; i < N; i++) {
    let a = alpha[i];
    let col = [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]];
    if (opts.under) {
      const u = [0, 1, 2].map((c) => opts.under.rgba[i * 4 + c] / 255);
      col = col.map((v, c) => v * a + u[c] * (1 - a));
      a = 1;
    }
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.round(Math.max(0, Math.min(1, col[c])) * 255);
    rgba[i * 4 + 3] = opts.masked ? (a >= t ? 255 : 0) : 255;
  }
  return { width: w, height: h, rgba };
}
/**
 * A finished picture as a GoldSrc texture: 256 colours (a `{` name keeps index 255 pure blue for its holes), its
 * four mips, and its measures (textureMeasures on what the WAD holds). Refuses a name GoldSrc would.
 */
export function paletteTexture(name, picture, { dither = 0 } = {}) {
  const { width, height } = picture;
  const problems = nameProblems(name, { width, height });
  if (problems.length) throw new Error(problems.join("; "));
  const masked = name.startsWith("{");
  const q = quantize(picture, { masked, dither });
  if (masked) q.palette.set(MASK_KEY, HOLE * 3);
  const texture = { name, width, height, pixels: q.pixels, palette: q.palette };
  const mips = mipsOf(texture, masked);
  const shown = new Uint8Array(width * height * 4);
  let solid = 0;
  for (let i = 0; i < width * height; i++) {
    shown.set(q.palette.subarray(q.pixels[i] * 3, q.pixels[i] * 3 + 3), i * 4);
    const hole = masked && q.pixels[i] === HOLE;
    shown[i * 4 + 3] = hole ? 0 : 255;
    if (!hole) solid++;
  }
  return {
    ...texture,
    pixels: mips[0],
    mips,
    holes: masked,
    stats: {
      colours: q.colours,
      holeShare: +(1 - solid / (width * height)).toFixed(3),
      measures: textureMeasures({ width, height, rgba: shown }),
    },
  };
}
