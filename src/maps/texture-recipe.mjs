// A map texture made from a recipe: CC0 photographs laid at the texture's density, shapes drawn over them with
// real relief (a height field), weathering driven by that relief, and light baked into the colour the way GoldSrc
// textures were painted (a fixed key light from the top left, ambient occlusion in every cavity). Then cut down to
// 256 colours, and measured for the look of programmer art (flat colour, ruler-straight edges, panels that repeat).
//
//   composeTexture(recipe, { width, height, bases, params, seed })   -> { width, height, rgba, fits }
//   quantize(picture, { masked, dither })                             -> { pixels, palette, colours }
//   textureMeasures(picture)                                          -> { flatShare, straightEdges, repeat, saturation, flags }
//   photoFit seamlessCrop linearOf                                    the photo's placement, for tests and tools
//   RECIPE_OPS                                                        every op's name (a manifest is checked against it)
//
// A base is `{ picture: {width,height,rgba}, metres: [w, h], maps?: { NormalGL, Displacement, AmbientOcclusion } }`:
// the colour photo, its size in the world, and the provider's other maps of the same surface, read as data.
// Variation (a panel's tone, its place in the photo, a chipped corner) is chosen from the photo's own light and
// dark, or from a hash of the texture's seed and the panel's index: never from noise made up for the purpose.
// Everything is deterministic.

/** One GoldSrc unit in metres (1 cell = 128 units = 3.25 m). */
export const UNIT_METRES = 0.0254;
const PALETTE_BYTES = 768;
const HOLE = 255;
/** The colour index 255 shows in a masked texture: the engine's own key, pure blue. */
export const MASK_KEY = [0, 0, 255];
export const RECIPE_OPS = ["photo", "fill", "panels", "lines", "beams", "rivets", "cylinder", "moulding", "gradient", "glow", "clear", "alpha", "weather", "bake", "grade"];

// ── colour ─────────────────────────────────────────────────────────────────
const toLinear = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const srgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a || 1e-6));
  return t * t * (3 - 2 * t);
};
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** `#rrggbb` as [r, g, b] in 0..1. */
export const hexColour = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h));
  if (!m) throw new Error(`${h} is not a colour #rrggbb`);
  const v = parseInt(m[1], 16);
  return [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};
const colourOf = (c) => (Array.isArray(c) ? c.map((v) => (v > 1 ? v / 255 : v)) : hexColour(c));
function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}
/** r g b (0..1) as [hue degrees, saturation 0..1 (HSV), value]. */
function hsv(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 1e-6) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx > 0 ? d / mx : 0, mx];
}
/** A number in [0, 1) from integers: the same arguments, the same number (a panel's own jitter). */
export function hash01(...ints) {
  let h = 2166136261;
  for (const v of ints) {
    h ^= Math.floor(v) & 0xffffffff;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return (h >>> 0) / 4294967296;
}
const seedOf = (s) => (typeof s === "number" ? s : [...String(s ?? "")].reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619), 2166136261));

// ── pictures ───────────────────────────────────────────────────────────────
/** A decoded file `{ width, height, rgba }` as linear light (colour) or as data 0..1 (`data`: a normal or height map). */
export function linearOf({ width, height, rgba }, data = false) {
  const rgb = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = data ? rgba[i * 4 + c] / 255 : toLinear[rgba[i * 4 + c]];
  return { width, height, rgb };
}
function boxShrink({ width, height, rgb }, k) {
  const w = Math.max(1, Math.floor(width / k));
  const h = Math.max(1, Math.floor(height / k));
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) s += rgb[((y * k + j) * width + x * k + i) * 3 + c];
        out[(y * w + x) * 3 + c] = s / (k * k);
      }
  return { width: w, height: h, rgb: out };
}
/**
 * A region of a tiling photo made to tile on its own: `fx`, `fy` the share of each side kept, from (`ox`, `oy`).
 * The photo past the region's far edge is cross-faded over the region's first `band` share, so the region's last
 * column meets its first exactly as the photo does.
 */
export function seamlessCrop(photo, fx, fy, ox = 0, oy = 0, band = 0.15) {
  const { width, height, rgb } = photo;
  const w = Math.max(2, Math.round(width * fx));
  const h = Math.max(2, Math.round(height * fy));
  const x0 = Math.round(width * ox);
  const y0 = Math.round(height * oy);
  const bw = fx < 1 ? Math.max(1, Math.round(w * band)) : 0;
  const bh = fy < 1 ? Math.max(1, Math.round(h * band)) : 0;
  const at = (x, y, c) => rgb[((((y0 + y) % height) + height) % height * width + ((((x0 + x) % width) + width) % width)) * 3 + c];
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        const across = (yy) => {
          if (x >= bw) return at(x, yy, c);
          const t = x / bw; // 0 at the first column: exactly the photo past the far edge
          return at(x, yy, c) * t + at(x + w, yy, c) * (1 - t);
        };
        let v = across(y);
        if (y < bh) {
          const t = y / bh;
          v = v * t + across(y + h) * (1 - t);
        }
        out[(y * w + x) * 3 + c] = v;
      }
  return { width: w, height: h, rgb: out };
}
function sampleWrap(p, u, v, out) {
  const x = u - 0.5;
  const y = v - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const W = p.width;
  const H = p.height;
  const xa = ((x0 % W) + W) % W;
  const xb = (xa + 1) % W;
  const ya = ((y0 % H) + H) % H;
  const yb = (ya + 1) % H;
  for (let c = 0; c < 3; c++) {
    const a = p.rgb[(ya * W + xa) * 3 + c] * (1 - fx) + p.rgb[(ya * W + xb) * 3 + c] * fx;
    const b = p.rgb[(yb * W + xa) * 3 + c] * (1 - fx) + p.rgb[(yb * W + xb) * 3 + c] * fx;
    out[c] = a * (1 - fy) + b * fy;
  }
  return out;
}
/**
 * How a photo of `metres` lands on a texture of `width` x `height` texels, each `texelUnits` units: whole repeats
 * when the texture holds three quarters of it or more, else a seamless crop. `{ repeat, crop, texelMetres }`.
 */
export function photoFit(metres, width, height, texelUnits = 1, { crop = true } = {}) {
  const want = [width * texelUnits * UNIT_METRES, height * texelUnits * UNIT_METRES];
  const repeat = [1, 1];
  const share = [1, 1];
  for (let a = 0; a < 2; a++) {
    const r = want[a] / metres[a];
    if (r >= 0.75 || !crop) repeat[a] = Math.max(1, Math.round(r));
    else share[a] = r;
  }
  const texelMetres = [0, 1].map((a) => (metres[a] * share[a] * repeat[a]) / [width, height][a]);
  return { repeat, crop: share, texelMetres };
}
/** A layer's colour graded: levels, gamma, gain, saturation, colorize, tint. */
function grader(g = {}) {
  const [lo, hi] = g.levels ?? [0, 1];
  const gamma = g.gamma ?? 1;
  const gain = g.gain ?? 1;
  const sat = g.saturation ?? 1;
  const tint = g.tint ? colourOf(g.tint) : null;
  const col = g.colorize ? { hue: g.colorize.hue, s: g.colorize.sat ?? 0.5, mix: g.colorize.mix ?? 1 } : null;
  return (rgb) => {
    for (let c = 0; c < 3; c++) {
      let v = clamp01((rgb[c] - lo) / Math.max(1e-6, hi - lo));
      if (gamma !== 1) v = v ** (1 / gamma);
      rgb[c] = v * gain;
    }
    const y = luma(rgb[0], rgb[1], rgb[2]);
    if (sat !== 1) for (let c = 0; c < 3; c++) rgb[c] = y + (rgb[c] - y) * sat;
    if (col) {
      const target = hsl(col.hue, col.s, 0.5);
      const ty = luma(...target) || 1e-6;
      for (let c = 0; c < 3; c++) rgb[c] = rgb[c] * (1 - col.mix) + ((target[c] * y) / ty) * col.mix;
    }
    if (tint) for (let c = 0; c < 3; c++) rgb[c] *= tint[c];
    return rgb;
  };
}
function blend(mode, d, s) {
  switch (mode) {
    case "multiply":
      return d * s;
    case "screen":
      return 1 - (1 - d) * (1 - s);
    case "overlay":
      return d < 0.5 ? 2 * d * s : 1 - 2 * (1 - d) * (1 - s);
    case "add":
      return d + s;
    case "soft":
      return s < 0.5 ? d - (1 - 2 * s) * d * (1 - d) : d + (2 * s - 1) * (Math.sqrt(d) - d);
    default:
      return s;
  }
}
function segDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return { d: Math.hypot(qx, qy), t, across: (qx * dy - qy * dx) / Math.sqrt(l2) };
}
function rectsOf(op, W, H) {
  if (op.rects) return op.rects;
  if (op.grid) {
    const [x, y, w, h] = op.grid.rect ?? [0, 0, W, H];
    const cols = op.grid.cols ?? 1;
    const rows = op.grid.rows ?? 1;
    const gap = op.grid.gap ?? 0;
    const out = [];
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) out.push([x + (i * w) / cols + gap / 2, y + (j * h) / rows + gap / 2, w / cols - gap, h / rows - gap]);
    return out;
  }
  return [op.rect ?? [0, 0, W, H]];
}
/** A recipe's values with `$param` strings replaced from `params`. */
export function withParams(value, params) {
  if (typeof value === "string" && value.startsWith("$")) {
    const key = value.slice(1);
    if (!(key in params)) throw new Error(`the parameter ${value} is not given`);
    return params[key];
  }
  if (Array.isArray(value)) return value.map((v) => withParams(v, params));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withParams(v, params)]));
  return value;
}
/** Sentences against a recipe's ops: an op unknown, a moulding's profile out of order, a cylinder's axis, a wear outside 0-1. */
export function recipeProblems(recipe, where = "the recipe") {
  const out = [];
  if (!Array.isArray(recipe)) return [`${where} is not a list of ops`];
  recipe.forEach((op, i) => {
    if (!RECIPE_OPS.includes(op?.op)) out.push(`${where}: op ${i} (${op?.op}) is not one the kit knows (${RECIPE_OPS.join(", ")})`);
    if (op?.op === "moulding") {
      const p = op.profile ?? [];
      if (p.length < 2 || p.some((s, k) => k && s[0] <= p[k - 1][0]) || p[0][0] !== 0 || p.at(-1)[0] !== 1)
        out.push(`${where}: op ${i}'s moulding profile must run from 0 to 1 across, in order`);
    }
    if (op?.op === "alpha" && !op.photo) out.push(`${where}: op ${i} (alpha) needs the photo its mask comes from`);
    if (op?.op === "alpha" && op.threshold !== undefined && (op.threshold < 0 || op.threshold > 1)) out.push(`${where}: op ${i}'s threshold ${op.threshold} is outside 0-1`);
    if ((op?.op === "cylinder" || op?.op === "moulding") && op.axis !== undefined && !["x", "y"].includes(op.axis))
      out.push(`${where}: op ${i}'s axis ${op.axis} is not x or y`);
    if (op?.op === "weather" && typeof op.wear === "number" && (op.wear < 0 || op.wear > 1)) out.push(`${where}: op ${i}'s wear ${op.wear} is outside 0-1`);
  });
  return out;
}

// ── composing ──────────────────────────────────────────────────────────────
/**
 * A texture's picture made from its recipe: `{ width, height, rgba, fits }`. Drawn at `supersample` times the size
 * and boxed down in linear light. Lengths are in texels of the final texture; `rect` is [x, y, w, h]. Besides its
 * colour, the canvas keeps a height field (texels), a detail normal (from the photos' normal maps) and an occlusion
 * (from their AO maps): `weather` and `bake` read them.
 *
 *   photo    { photo, rect?, offset?, grade?, crop?, texelUnits?, rotate?: 90, stretch?: [kx, ky], detail?, relief?, aoMap? }
 *            the base at the texture's density. `detail` (0-1) takes its normal map into the lighting, `relief`
 *            (texels) its displacement into the height, `aoMap` (0-1) its AO into the occlusion; `stretch` samples it
 *            at kx, ky times its density (0.1 on y draws its runs out into streaks)
 *   fill     { colour, rect|rects|grid }
 *   panels   { rects|grid, fill?, relief: texels (+ raised, - sunk), bevel, groove, grooveDepth, vary?, light?, dark? }
 *            `vary` { tone, hue, scale, seam, chips }: each panel its own tone (+-), hue shift (degrees), photo scale
 *            (+-share) and place in the photo; seams wander by up to `seam` texels and corners chip where the photo's
 *            own dark falls near an edge (`chips` 0-1). `light`/`dark` add the old painted bevel (no bake needed)
 *   lines    { lines: [[x0,y0,x1,y1]], width, colour|fill, shade: round|box|flat, relief, vary?: { seam, tone } }
 *            `vary.seam` (texels) makes each strip wander off its ruled line by the photo's own light and dark
 *   beams    as lines, and makes its pixels solid in a masked texture (after `clear`); wraps round the edges
 *   rivets   { rects|grid, spacing, inset, radius, sides: x|y|both }   domes in the height field
 *   cylinder { rect, axis: x|y (the run), fill, solid? }   a pipe lying in the rect: a half-round height across it
 *   moulding { rect, axis: x|y (the run), profile: [[across 0-1, height]], bands?: [[from, to, fill]], fill }
 *            a run of moulding: its section as heights, each band of it its own material
 *   gradient { axis, stops: [[at, value]], rect?, colour?, blend (multiply) }
 *   glow     { rect, colour, core, radius }   a lit lens, untouched by the bake (it is the light)
 *   clear    {}   a masked texture: all holes, until beams/cylinders fill them back
 *   alpha    { photo, map?: Opacity|Color|..., threshold, softness, invert?, normalise?, rect?, shape?: { radial, fade } }
 *            a masked texture's solid part from a photo: its opacity map, or its luminance; `shape.radial` (0-1)
 *            fades it out toward the rect's rim, `shape.fade` "down"/"up" along y; `normalise` first sets the map's
 *            mean to 0.5 and its spread to a quarter (so a faint stain photo gives a stain, not a disc)
 *   weather  { wear 0-1, grime, streaks, dust, rust, edges, rustPhoto?, noise?, streakLength, grimeColour?, dustColour? }
 *            weathering driven by the relief: grime in cavities and at the bottom of recesses, streaks running down
 *            from every edge that drops, dust on faces turned up, rust in joints and round bolts, worn convex edges;
 *            where each lands is chosen by the luminance of a photo (`noise`, default the first photo), never noise
 *   bake     { key 0-1, ambient 0-1, ao 0-1, light?: [x, y, z] }   the GoldSrc look: the height and the photos'
 *            normals lit by a fixed key from the top left, cavities darkened; a flat face keeps its colour
 *   grade    { saturation?, maxSaturation?, harmony?: { hue, amount }, gain?, contrast? }   the whole picture
 */
export function composeTexture(recipe, { width, height, bases = {}, params = {}, supersample = 4, seed = 0 }) {
  const S = supersample;
  const W = width * S;
  const H = height * S;
  const N = W * H;
  const rgbBuf = new Float32Array(N * 3);
  const alpha = new Float32Array(N).fill(1);
  const hgt = new Float32Array(N);
  const grain = new Float32Array(N); // the share of the height that is the photos' own relief, not drawn
  const nd = new Float32Array(N * 2);
  const occ = new Float32Array(N).fill(1);
  const lit = new Uint8Array(N); // a lit lens: the bake leaves it alone
  const fits = [];
  const ops = withParams(recipe, params);
  const problems = recipeProblems(ops);
  if (problems.length) throw new Error(problems.join("; "));
  const seedN = seedOf(seed);
  const tmp = [0, 0, 0];
  const tmp2 = [0, 0, 0];
  const wrapI = (x, y) => ((((y % H) + H) % H) * W + (((x % W) + W) % W));

  // ── photos: one preparation per base, map and density ──
  const prepared = new Map();
  const prep = (spec, map = "Color") => {
    const base = bases[spec.photo];
    if (!base) throw new Error(`the base ${spec.photo} is not loaded`);
    const texelUnits = spec.texelUnits ?? 1;
    const key = `${spec.photo}|${map}|${texelUnits}|${spec.crop !== false}`;
    let p = prepared.get(key);
    if (p) return p;
    const source = map === "Color" ? base.picture : base.maps?.[map];
    if (!source) return null;
    const fit = photoFit(base.metres, width, height, texelUnits, { crop: spec.crop !== false });
    const cacheKey = map === "Color" ? "linear" : `data${map}`;
    let pic = base[cacheKey] ?? (base[cacheKey] = linearOf(source, map !== "Color"));
    if (fit.crop[0] < 1 || fit.crop[1] < 1) pic = seamlessCrop(pic, fit.crop[0], fit.crop[1]);
    const perRepeat = [W / fit.repeat[0], H / fit.repeat[1]];
    const k = Math.floor(Math.min(pic.width / perRepeat[0], pic.height / perRepeat[1]));
    if (k >= 2) pic = boxShrink(pic, k);
    // the scale is that of the colour photo, so every map of a base lands on the same place
    p = { pic, fit, sx: pic.width / perRepeat[0], sy: pic.height / perRepeat[1] };
    prepared.set(key, p);
    if (map === "Color") fits.push({ base: spec.photo, repeat: fit.repeat, crop: fit.crop.map((v) => +v.toFixed(3)), texelMetres: fit.texelMetres.map((v) => +v.toFixed(4)) });
    return p;
  };
  /** Where a canvas pixel falls in a photo: the op's offset, the rect's own place, its scale jitter, a turn. */
  const placer = (spec, ri = 0, scale = 1) => {
    const [ou, ov] = spec.offset ?? [0, 0];
    const jitter = [hash01(seedN, ri, 11), hash01(seedN, ri, 12)];
    const rot = spec.rotate === 90;
    const [kx, ky] = spec.stretch ?? [1, 1];
    return (p, cx, cy) => {
      const su = ((ou + (ri ? jitter[0] : 0)) % 1) * p.pic.width;
      const sv = ((ov + (ri ? jitter[1] : 0)) % 1) * p.pic.height;
      return [(rot ? cy : cx) * p.sx * scale * kx + su, (rot ? cx : cy) * p.sy * scale * ky + sv];
    };
  };
  /** A layer: colour, and optionally the photo's detail normal, height and occlusion at a canvas pixel. */
  const layer = (spec, ri = 0, vary = null) => {
    if (!spec) return null;
    if (!spec.photo) {
      const c = colourOf(spec.colour ?? spec);
      return { colour: (cx, cy, out) => ((out[0] = c[0]), (out[1] = c[1]), (out[2] = c[2]), out) };
    }
    const scale = vary?.scale ? 1 + (hash01(seedN, ri, 21) * 2 - 1) * vary.scale : 1;
    const place = placer(spec, ri, scale);
    const pc = prep(spec, "Color");
    const pn = spec.detail ? prep(spec, "NormalGL") : null;
    const ph = spec.relief ? prep(spec, "Displacement") : null;
    const pa = spec.aoMap ? prep(spec, "AmbientOcclusion") : null;
    const grade = grader(spec.grade);
    const toneJ = vary?.tone ? 1 + (hash01(seedN, ri, 31) * 2 - 1) * vary.tone : 1;
    const hueJ = vary?.hue ? (hash01(seedN, ri, 32) * 2 - 1) * vary.hue : 0;
    const rot = spec.rotate === 90;
    const out = {
      gain: 1,
      colour: (cx, cy, o, plain = false) => {
        const [u, v] = place(pc, cx, cy);
        sampleWrap(pc.pic, u, v, o);
        for (let c = 0; c < 3; c++) o[c] = srgb(clamp01(o[c]));
        grade(o);
        if (plain) return o;
        if (hueJ) {
          // a hue turn about the grey axis (Rodrigues), small: the panel a shade warmer or cooler
          const a = (hueJ * Math.PI) / 180;
          const k = 1 / Math.sqrt(3);
          const cos = Math.cos(a);
          const sin = Math.sin(a);
          const [r, g, b] = o;
          const dot = (r + g + b) * k;
          o[0] = r * cos + (k * (b - g)) * sin + k * dot * (1 - cos);
          o[1] = g * cos + (k * (r - b)) * sin + k * dot * (1 - cos);
          o[2] = b * cos + (k * (g - r)) * sin + k * dot * (1 - cos);
        }
        for (let c = 0; c < 3; c++) o[c] *= out.gain * toneJ;
        return o;
      },
      detail: pn
        ? (cx, cy) => {
            const [u, v] = place(pn, cx, cy);
            sampleWrap(pn.pic, u, v, tmp2);
            const a = (tmp2[0] * 2 - 1) * spec.detail;
            const b = -(tmp2[1] * 2 - 1) * spec.detail; // GL's green is up; the canvas's y is down
            return rot ? [b, a] : [a, b];
          }
        : null,
      relief: ph
        ? (cx, cy) => {
            const [u, v] = place(ph, cx, cy);
            sampleWrap(ph.pic, u, v, tmp2);
            return (tmp2[0] - 0.5) * spec.relief;
          }
        : null,
      ao: pa
        ? (cx, cy) => {
            const [u, v] = place(pa, cx, cy);
            sampleWrap(pa.pic, u, v, tmp2);
            return 1 - (1 - tmp2[0]) * spec.aoMap;
          }
        : null,
    };
    if (spec.grade?.mean !== undefined) out.gain = meanGainOf(out, spec.grade.mean, vary?.rect);
    return out;
  };
  const meanGainOf = (ly, mean, rect) => {
    const [x, y, w, h] = rect ?? [0, 0, width, height];
    let sum = 0;
    let n = 0;
    for (let j = 0; j < 24; j++)
      for (let i = 0; i < 24; i++) {
        // the layer's own colour, before this panel's tone and hue: the jitter is kept, not measured away
        const c = ly.colour((x + ((i + 0.5) / 24) * w) * S, (y + ((j + 0.5) / 24) * h) * S, tmp, true);
        sum += luma(c[0], c[1], c[2]);
        n++;
      }
    return sum > 0 ? mean / (sum / n) : 1;
  };
  /** A photo's luminance as a mask in about 0..1 (mean 0.5), at `freq` times the photo's own scale. */
  const maskOf = (photoKey, freq = 1, shift = 0) => {
    if (!photoKey || !bases[photoKey]) return () => 0.5;
    const p = prep({ photo: photoKey }, "Color");
    let sum = 0;
    let sq = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      sampleWrap(p.pic, hash01(7, i) * p.pic.width, hash01(8, i) * p.pic.height, tmp2);
      const l = luma(tmp2[0], tmp2[1], tmp2[2]);
      sum += l;
      sq += l * l;
    }
    const mean = sum / n;
    const sd = Math.sqrt(Math.max(1e-8, sq / n - mean * mean));
    const o = [0, 0, 0];
    return (cx, cy) => {
      sampleWrap(p.pic, cx * p.sx * freq + shift * p.pic.width, cy * p.sy * freq + shift * 0.7 * p.pic.height, o);
      return clamp01(((luma(o[0], o[1], o[2]) - mean) / sd) * 0.25 + 0.5);
    };
  };
  const firstPhoto = ops.find((o) => o.photo)?.photo ?? ops.find((o) => o.fill?.photo)?.fill.photo;
  const put = (i, c, mode, opacity) => {
    const o = i * 3;
    for (let k = 0; k < 3; k++) rgbBuf[o + k] = rgbBuf[o + k] * (1 - opacity) + blend(mode, rgbBuf[o + k], c[k]) * opacity;
  };
  const layDetail = (ly, i, cx, cy) => {
    if (ly?.detail) {
      const [a, b] = ly.detail(cx, cy);
      nd[i * 2] = a;
      nd[i * 2 + 1] = b;
    }
    if (ly?.ao) occ[i] = ly.ao(cx, cy);
    if (!ly?.relief) return 0;
    const r = ly.relief(cx, cy);
    grain[i] = r;
    return r;
  };

  ops.forEach((op, opIndex) => {
    const mode = op.blend ?? "normal";
    const opacity = op.opacity ?? 1;
    const opSeed = opIndex * 1000;
    if (op.op === "photo" || op.op === "fill") {
      const rects = op.op === "photo" ? [op.rect ?? [0, 0, width, height]] : rectsOf(op, width, height);
      rects.forEach((r, ri) => {
        const ly = op.op === "photo" ? layer(op, opSeed + ri, { rect: r }) : layer({ colour: op.colour });
        const [x0, y0, x1, y1] = [r[0] * S, r[1] * S, (r[0] + r[2]) * S, (r[1] + r[3]) * S].map(Math.round);
        for (let y = Math.max(0, y0); y < Math.min(H, y1); y++)
          for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
            const i = y * W + x;
            put(i, ly.colour(x + 0.5, y + 0.5, tmp), mode, opacity);
            if (mode === "normal") hgt[i] += layDetail(ly, i, x + 0.5, y + 0.5);
          }
      });
    } else if (op.op === "panels") {
      const rects = rectsOf(op, width, height);
      const bevel = (op.bevel ?? 2) * S;
      const groove = (op.groove ?? 0) * S;
      const relief = op.relief ?? 1.5;
      const grooveDepth = op.grooveDepth ?? Math.max(1, Math.abs(relief));
      const grooveDark = op.grooveDark ?? 0.15;
      const vary = op.vary ?? {};
      const seamWander = (vary.seam ?? 0) * S;
      const chips = vary.chips ?? 0;
      const light = op.light ?? 0;
      const dark = op.dark ?? 0;
      const wander = seamWander ? maskOf(op.fill?.photo ?? firstPhoto, 0.35, 0.13) : null;
      const chipMask = chips ? maskOf(op.fill?.photo ?? firstPhoto, 1.7, 0.41) : null;
      const before = Float32Array.from(hgt);
      rects.forEach((r, ri) => {
        const ly = layer(op.fill, opSeed + ri, { ...vary, rect: r });
        const [x0, y0, x1, y1] = [r[0] * S, r[1] * S, (r[0] + r[2]) * S, (r[1] + r[3]) * S];
        const pad = groove + seamWander + 1;
        for (let y = Math.max(0, Math.floor(y0 - pad)); y < Math.min(H, Math.ceil(y1 + pad)); y++)
          for (let x = Math.max(0, Math.floor(x0 - pad)); x < Math.min(W, Math.ceil(x1 + pad)); x++) {
            const px = x + 0.5;
            const py = y + 0.5;
            const i = y * W + x;
            const dl = px - x0;
            const dt = py - y0;
            const dr = x1 - px;
            const db = y1 - py;
            let d = Math.min(dl, dt, dr, db);
            if (wander) d += (wander(px, py) - 0.5) * 2 * seamWander;
            if (d < 0) {
              if (d > -groove) {
                hgt[i] = Math.min(hgt[i], before[i] - grooveDepth);
                for (let c = 0; c < 3; c++) rgbBuf[i * 3 + c] *= 1 - grooveDark * opacity;
              }
              continue;
            }
            let c = ly ? ly.colour(px, py, tmp) : null;
            let hh = before[i] + relief * smooth(0, 1, d / bevel);
            if (chipMask && d < bevel * 2.5) {
              // a chip: where the photo is darkest near the edge, the face is broken back to the joint
              const m = chipMask(px + ri * 37, py);
              const reach = 1 - d / (bevel * 2.5);
              if (m < chips * 0.45 * reach) {
                hh = before[i] + relief * 0.15 - (relief > 0 ? 0.6 : 0);
                if (c) for (let k = 0; k < 3; k++) c[k] *= 0.72;
              }
            }
            if (c) {
              put(i, c, mode, opacity);
              if (ly) hh += layDetail(ly, i, px, py);
            }
            hgt[i] = hh;
            if ((light || dark) && d < bevel) {
              const t = 1 - d / bevel;
              const isLit = d === dl || d === dt;
              for (let k = 0; k < 3; k++)
                rgbBuf[i * 3 + k] = isLit ? rgbBuf[i * 3 + k] + (1 - rgbBuf[i * 3 + k]) * light * t : rgbBuf[i * 3 + k] * (1 - dark * t);
            }
          }
      });
    } else if (op.op === "lines" || op.op === "beams") {
      const segs = op.op === "lines" ? op.lines : op.segments;
      const half = ((op.width ?? 4) * S) / 2;
      const shade = op.shade ?? (op.op === "beams" ? "round" : "flat");
      const bevelW = op.bevel ?? 1;
      const relief = op.relief ?? (op.width ?? 4) / 2;
      const wanderBy = (op.vary?.seam ?? 0) * S;
      const wander = wanderBy ? maskOf(op.fill?.photo ?? firstPhoto, 0.5, 0.21) : null;
      segs.forEach((sg, si) => {
        const ly = layer(op.fill ?? { colour: op.colour ?? "#808080" }, opSeed + si, op.vary);
        const [ax, ay, bx, by] = sg.map((v) => v * S);
        const pad = half + 2;
        for (const [ox, oy] of [[0, 0], [-W, 0], [W, 0], [0, -H], [0, H]]) {
          const minX = Math.max(0, Math.floor(Math.min(ax, bx) + ox - pad));
          const maxX = Math.min(W, Math.ceil(Math.max(ax, bx) + ox + pad));
          const minY = Math.max(0, Math.floor(Math.min(ay, by) + oy - pad));
          const maxY = Math.min(H, Math.ceil(Math.max(ay, by) + oy + pad));
          for (let y = minY; y < maxY; y++)
            for (let x = minX; x < maxX; x++) {
              let { d, across } = segDistance(x + 0.5 - ox, y + 0.5 - oy, ax, ay, bx, by);
              if (wander) {
                // the strip's centre moved sideways by the photo's light and dark along it: a hand-laid line
                const w = (wander(x + 0.5 + si * 53, y + 0.5) - 0.5) * 2 * wanderBy;
                const past = Math.sqrt(Math.max(0, d * d - across * across)); // beyond the segment's ends
                across += w;
                d = Math.hypot(past, across);
              }
              if (d > half) continue;
              const i = y * W + x;
              const s = Math.abs(across / half);
              const profile = shade === "round" ? Math.sqrt(Math.max(0, 1 - s * s)) : shade === "box" ? smooth(0, 1, (1 - s) * half / (bevelW * S)) : 1;
              const hh = (op.op === "beams" ? 0 : hgt[i]) + relief * profile;
              if (op.op === "beams" || hh >= hgt[i] - 1e-6) {
                put(i, ly.colour(x + 0.5, y + 0.5, tmp), mode, opacity);
                hgt[i] = hh + layDetail(ly, i, x + 0.5, y + 0.5);
                if (op.op === "beams") alpha[i] = 1;
              }
            }
        }
      });
    } else if (op.op === "rivets") {
      const rects = rectsOf(op, width, height);
      const r0 = (op.radius ?? 1.5) * S;
      const sp = op.spacing ?? 16;
      const inset = op.inset ?? 4;
      const heads = [];
      for (const [x, y, w, h] of rects) {
        const nx = Math.max(1, Math.round((w - 2 * inset) / sp));
        const ny = Math.max(1, Math.round((h - 2 * inset) / sp));
        if (op.sides !== "y") for (let i = 0; i <= nx; i++) heads.push([x + inset + ((w - 2 * inset) * i) / nx, y + inset], [x + inset + ((w - 2 * inset) * i) / nx, y + h - inset]);
        if (op.sides !== "x") for (let j = op.sides === "y" ? 0 : 1; j < (op.sides === "y" ? ny + 1 : ny); j++) heads.push([x + inset, y + inset + ((h - 2 * inset) * j) / ny], [x + w - inset, y + inset + ((h - 2 * inset) * j) / ny]);
      }
      const ly = op.fill ? layer(op.fill, opSeed) : null;
      for (const [hx, hy] of heads) {
        const cx = hx * S;
        const cy = hy * S;
        for (let y = Math.max(0, Math.floor(cy - r0)); y < Math.min(H, Math.ceil(cy + r0)); y++)
          for (let x = Math.max(0, Math.floor(cx - r0)); x < Math.min(W, Math.ceil(cx + r0)); x++) {
            const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r0;
            if (d > 1) continue;
            const i = y * W + x;
            hgt[i] += (op.height ?? (op.radius ?? 1.5) * 0.9) * Math.sqrt(1 - d * d);
            if (ly) put(i, ly.colour(x + 0.5, y + 0.5, tmp), "normal", 1);
            nd[i * 2] *= 0.3;
            nd[i * 2 + 1] *= 0.3;
          }
      }
    } else if (op.op === "cylinder") {
      const [rx, ry, rw, rh] = op.rect.map((v) => v * S);
      const along = (op.axis ?? "x") === "x";
      const thick = along ? rh : rw;
      const R = thick / 2 / S; // texels
      const ly = layer(op.fill ?? { colour: "#808080" }, opSeed);
      for (let y = Math.max(0, Math.floor(ry)); y < Math.min(H, Math.ceil(ry + rh)); y++)
        for (let x = Math.max(0, Math.floor(rx)); x < Math.min(W, Math.ceil(rx + rw)); x++) {
          const s = along ? (y + 0.5 - ry) / rh * 2 - 1 : (x + 0.5 - rx) / rw * 2 - 1;
          const i = y * W + x;
          const hh = (op.on ?? hgt[i]) + R * Math.sqrt(Math.max(0, 1 - s * s));
          put(i, ly.colour(x + 0.5, y + 0.5, tmp), mode, opacity);
          hgt[i] = hh + layDetail(ly, i, x + 0.5, y + 0.5);
          if (op.solid !== false) alpha[i] = 1;
        }
    } else if (op.op === "moulding") {
      const [rx, ry, rw, rh] = op.rect.map((v) => v * S);
      const along = (op.axis ?? "x") === "x";
      const prof = op.profile;
      const bands = (op.bands ?? []).map(([a, b, f], bi) => [a, b, layer(f, opSeed + 1 + bi)]);
      const base = layer(op.fill, opSeed);
      for (let y = Math.max(0, Math.floor(ry)); y < Math.min(H, Math.ceil(ry + rh)); y++)
        for (let x = Math.max(0, Math.floor(rx)); x < Math.min(W, Math.ceil(rx + rw)); x++) {
          const t = along ? (y + 0.5 - ry) / rh : (x + 0.5 - rx) / rw;
          let k = 1;
          while (k < prof.length - 1 && prof[k][0] < t) k++;
          const [ta, ha] = prof[k - 1];
          const [tb, hb] = prof[k];
          const u = clamp01((t - ta) / (tb - ta));
          const hh = ha + (hb - ha) * u;
          const i = y * W + x;
          const band = bands.find(([a, b]) => t >= a && t < b);
          const ly = band ? band[2] : base;
          if (ly) put(i, ly.colour(x + 0.5, y + 0.5, tmp), mode, opacity);
          hgt[i] = (op.on ?? hgt[i]) + hh + (ly ? layDetail(ly, i, x + 0.5, y + 0.5) : 0);
        }
    } else if (op.op === "gradient") {
      const stops = op.stops;
      const axisY = (op.axis ?? "y") === "y";
      const [rx, ry, rw, rh] = (op.rect ?? [0, 0, width, height]).map((v) => v * S);
      for (let y = Math.max(0, Math.floor(ry)); y < Math.min(H, Math.ceil(ry + rh)); y++)
        for (let x = Math.max(0, Math.floor(rx)); x < Math.min(W, Math.ceil(rx + rw)); x++) {
          const t = axisY ? (y + 0.5 - ry) / rh : (x + 0.5 - rx) / rw;
          let v = stops[0][1];
          for (let s = 1; s < stops.length; s++)
            if (t >= stops[s - 1][0]) {
              const [a, va] = stops[s - 1];
              const [b, vb] = stops[s];
              v = t >= b ? vb : va + ((vb - va) * (t - a)) / Math.max(1e-6, b - a);
            }
          put(y * W + x, op.colour ? colourOf(op.colour).map((k) => k * v) : [v, v, v], op.blend ?? "multiply", opacity);
        }
    } else if (op.op === "glow") {
      const [x, y, w, h] = op.rect.map((v) => v * S);
      const col = colourOf(op.colour);
      const core = op.core ?? 1;
      const rad = (op.radius ?? 4) * S;
      for (let py = 0; py < H; py++)
        for (let px = 0; px < W; px++) {
          const dx = Math.max(x - (px + 0.5), 0, px + 0.5 - (x + w));
          const dy = Math.max(y - (py + 0.5), 0, py + 0.5 - (y + h));
          const d = Math.hypot(dx, dy);
          if (d > rad * 3) continue;
          const o = (py * W + px) * 3;
          if (d === 0) {
            // the lens: brighter at its middle, as a tube behind a diffuser
            const across = Math.abs((py + 0.5 - y) / h - 0.5) * 2;
            for (let c = 0; c < 3; c++) rgbBuf[o + c] = clamp01(col[c] * core * (1 - 0.35 * across * across) + 0.25 * (1 - across));
            lit[py * W + px] = 1;
          } else {
            const k = core * 0.6 * Math.exp(-d / rad) * opacity;
            for (let c = 0; c < 3; c++) rgbBuf[o + c] = clamp01(rgbBuf[o + c] + col[c] * k);
          }
        }
    } else if (op.op === "clear") {
      alpha.fill(0);
    } else if (op.op === "alpha") {
      const map = op.map ?? "Color";
      const p = prep(op, map);
      if (!p) throw new Error(`the base ${op.photo} has no ${map} map for an alpha`);
      const place = placer(op, 0);
      const th = op.threshold ?? 0.5;
      const soft = op.softness ?? 0.08;
      const [rx, ry, rw, rh] = (op.rect ?? [0, 0, width, height]).map((v) => v * S);
      const o3 = [0, 0, 0];
      const valueOf = (c) => (map === "Color" ? srgb(clamp01(luma(c[0], c[1], c[2]))) : c[0]);
      let norm = null;
      if (op.normalise) {
        let sum = 0;
        let sq = 0;
        const n = 900;
        for (let k = 0; k < n; k++) {
          sampleWrap(p.pic, hash01(5, k) * p.pic.width, hash01(6, k) * p.pic.height, o3);
          const v = valueOf(o3);
          sum += v;
          sq += v * v;
        }
        const mean = sum / n;
        norm = { mean, sd: Math.sqrt(Math.max(1e-8, sq / n - mean * mean)) };
      }
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          const u = (x + 0.5 - rx) / rw;
          const v = (y + 0.5 - ry) / rh;
          if (u < 0 || u > 1 || v < 0 || v > 1) {
            if (op.rect) alpha[i] = 0;
            continue;
          }
          const [pu, pv] = place(p, x + 0.5 - rx, y + 0.5 - ry);
          sampleWrap(p.pic, pu, pv, o3);
          let val = valueOf(o3);
          if (norm) val = clamp01(((val - norm.mean) / norm.sd) * 0.25 + 0.5);
          if (op.invert) val = 1 - val;
          if (op.shape?.radial) {
            const r = Math.hypot(u - 0.5, v - 0.5) * 2;
            val *= 1 - smooth(1 - op.shape.radial, 1, r);
          }
          if (op.shape?.fade === "down") val *= 1 - smooth(0.2, 1, v);
          if (op.shape?.fade === "up") val *= 1 - smooth(0.2, 1, 1 - v);
          alpha[i] = smooth(th - soft, th + soft, val);
        }
    } else if (op.op === "weather") weather(op);
    else if (op.op === "bake") bake(op);
    else if (op.op === "grade") gradeAll(op);
  });

  // ── geometry read back: normals, occlusion, curvature ──
  function normals() {
    const n = new Float32Array(N * 3);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const gx = ((hgt[wrapI(x + 1, y)] - hgt[wrapI(x - 1, y)]) * S) / 2;
        const gy = ((hgt[wrapI(x, y + 1)] - hgt[wrapI(x, y - 1)]) * S) / 2;
        let a = -gx + nd[i * 2];
        let b = -gy + nd[i * 2 + 1];
        const l = Math.hypot(a, b, 1);
        n[i * 3] = a / l;
        n[i * 3 + 1] = b / l;
        n[i * 3 + 2] = 1 / l;
      }
    return n;
  }
  /** Occlusion from the height field: how much of the sky round each pixel the relief hides (1 open, 0 shut). */
  function heightAO(radii = [1, 2, 4, 8]) {
    const out = new Float32Array(N);
    const dirs = [];
    for (let k = 0; k < 8; k++) dirs.push([Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)]);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let o = 0;
        for (const [dx, dy] of dirs) {
          let horizon = 0;
          for (const r of radii) {
            const q = wrapI(Math.round(x + dx * r * S), Math.round(y + dy * r * S));
            horizon = Math.max(horizon, (hgt[q] - hgt[i]) / r);
          }
          o += Math.atan(horizon) / (Math.PI / 2);
        }
        out[i] = 1 - o / dirs.length;
      }
    return out;
  }
  function weather(op) {
    const wear = op.wear ?? 0.5;
    const grime = (op.grime ?? 1) * wear;
    const streaks = (op.streaks ?? 1) * wear;
    const dust = (op.dust ?? 0.5) * wear;
    const rust = (op.rust ?? 0) * wear;
    const edges = (op.edges ?? 0.5) * wear;
    const n = normals();
    const ao = heightAO([1, 2, 4]);
    const noise = maskOf(op.noise ?? firstPhoto, 0.8, 0.29);
    const fine = maskOf(op.noise ?? firstPhoto, 2.3, 0.57);
    const grimeC = colourOf(op.grimeColour ?? "#2a241d");
    const dustC = colourOf(op.dustColour ?? "#8c877b");
    const rustL = op.rustPhoto ? layer({ photo: op.rustPhoto, grade: { saturation: 0.75 } }, 77) : null;
    // the bottom of every recess: rising toward a lip below, felt a few texels up
    const bottom = new Float32Array(N);
    const reachUp = Math.exp(-1 / ((op.grimeReach ?? 6) * S));
    for (let x = 0; x < W; x++)
      for (let pass = 0; pass < 2; pass++)
        for (let y = H - 1; y >= 0; y--) {
          const i = y * W + x;
          const rise = Math.max(0, hgt[wrapI(x, y + 1)] - hgt[i]);
          bottom[i] = Math.max(Math.min(1, rise * 1.5), bottom[wrapI(x, y + 1)] * reachUp);
        }
    // streaks: water running down from every edge that drops, longer and more broken the more worn
    const stream = new Float32Array(N);
    const runDown = Math.exp(-1 / (((op.streakLength ?? 40) * (0.4 + wear)) * S));
    // which columns run: the photo's light and dark along two rows, blurred over a few texels so a streak has
    // width (a brick photo's mortar would otherwise rule the wall in hairlines)
    const raw = new Float32Array(W);
    for (let x = 0; x < W; x++) raw[x] = noise(x + 0.5, 0) * 0.6 + noise(x + 0.5, H * 0.37) * 0.4;
    const reach = Math.max(1, Math.round((op.streakWidth ?? 3) * S));
    const columns = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let k = -reach; k <= reach; k++) sum += raw[(((x + k) % W) + W) % W];
      columns[x] = sum / (2 * reach + 1);
    }
    let cMean = 0;
    for (let x = 0; x < W; x++) cMean += columns[x];
    cMean /= W;
    let cDev = 0;
    for (let x = 0; x < W; x++) cDev += Math.abs(columns[x] - cMean);
    cDev = cDev / W || 1e-6;
    for (let x = 0; x < W; x++) columns[x] = clamp01((columns[x] - cMean) / (cDev * 4) + 0.5);
    for (let x = 0; x < W; x++) {
      const column = columns[x]; // some columns run, some do not
      for (let pass = 0; pass < 2; pass++)
        for (let y = 0; y < H; y++) {
          const i = y * W + x;
          // water leaves the drawn edges (ledges, lips, ribs), not the photo's own grain
          const above = wrapI(x, y - 1);
          const drop = Math.max(0, hgt[above] - grain[above] - (hgt[i] - grain[i]));
          stream[i] = Math.min(1, stream[above] * runDown + drop * 0.8 * smooth(0.35, 0.75, column));
        }
    }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (lit[i]) continue;
        const o = i * 3;
        const px = x + 0.5;
        const py = y + 0.5;
        const cav = clamp01((1 - ao[i]) * 2.2);
        const lap = 4 * hgt[i] - hgt[wrapI(x + 1, y)] - hgt[wrapI(x - 1, y)] - hgt[wrapI(x, y + 1)] - hgt[wrapI(x, y - 1)];
        const convex = clamp01(lap * S * 0.6);
        const nz = noise(px, py);
        const fz = fine(px, py);
        let c = [rgbBuf[o], rgbBuf[o + 1], rgbBuf[o + 2]];
        // grime: in cavities and at the bottom of recesses, broken up by the photo's own dark
        const g = clamp01((cav * 0.8 + bottom[i] * 0.7) * grime * (0.55 + nz));
        c = c.map((v, k) => v * (1 - 0.75 * g) + grimeC[k] * 0.75 * g * 0.6);
        // streaks: darker, a little browner
        const s = clamp01(stream[i] * streaks * (0.7 + nz * 0.6));
        c = c.map((v, k) => v * (1 - 0.45 * s) + grimeC[k] * 0.2 * s);
        // rust: in joints and round bolts, where a second look at the photo is dark enough
        if (rustL) {
          const want = clamp01((cav * 1.4 + bottom[i] * 0.5) * rust * 1.6);
          const m = smooth(1 - want, 1 - want + 0.18, 1 - fz);
          if (m > 0) {
            const rc = rustL.colour(px, py, tmp);
            c = c.map((v, k) => v * (1 - m) + rc[k] * (0.55 + 0.5 * v) * m);
          }
        }
        // dust on faces turned up (the canvas's y runs down: up is -y)
        const up = clamp01(-n[i * 3 + 1] * 2.2);
        const du = clamp01(up * dust * (0.4 + nz));
        c = c.map((v, k) => v * (1 - 0.5 * du) + dustC[k] * 0.5 * du);
        // worn edges: the convex lips rubbed bright where the photo is light
        const e = clamp01(convex * edges * 2.5) * smooth(0.35, 0.65, fz);
        if (e > 0) {
          const y0 = luma(c[0], c[1], c[2]);
          c = c.map((v) => v + (Math.min(1, y0 * 1.6 + 0.08) * (0.6 + 0.4 * (v / Math.max(1e-4, y0))) - v) * 0.55 * e);
        }
        rgbBuf[o] = c[0];
        rgbBuf[o + 1] = c[1];
        rgbBuf[o + 2] = c[2];
      }
  }
  function bake(op) {
    const key = op.key ?? 0.55;
    const amb = op.ambient ?? 0.45;
    const aoK = op.ao ?? 0.8;
    const L = op.light ?? [-1, -1.15, 1.6];
    const l = Math.hypot(...L);
    const [lx, ly, lz] = L.map((v) => v / l);
    const flat = amb + key * lz;
    const n = normals();
    const ao = heightAO();
    for (let i = 0; i < N; i++) {
      if (lit[i]) continue;
      const nl = Math.max(0, n[i * 3] * lx + n[i * 3 + 1] * ly + n[i * 3 + 2] * lz);
      const occl = 1 - aoK * (1 - ao[i] * occ[i]);
      const f = ((amb * occl + key * nl * (0.5 + 0.5 * occl)) / flat);
      for (let c = 0; c < 3; c++) rgbBuf[i * 3 + c] *= f;
    }
  }
  function gradeAll(op) {
    const sat = op.saturation ?? 1;
    const most = op.maxSaturation ?? 1;
    const gain = op.gain ?? 1;
    const contrast = op.contrast ?? 1;
    const harmony = op.harmony ? { hue: op.harmony.hue, k: op.harmony.amount ?? 0.15 } : null;
    const tone = harmony ? hsl(harmony.hue, 0.5, 0.5) : null;
    for (let i = 0; i < N; i++) {
      if (lit[i] && op.lit !== true) continue;
      const o = i * 3;
      let [r, g, b] = [rgbBuf[o], rgbBuf[o + 1], rgbBuf[o + 2]];
      let y = luma(r, g, b);
      // contrast about a mid grey of 0.22, the kit's dark middle
      if (contrast !== 1) {
        const ny = Math.max(0, 0.22 + (y - 0.22) * contrast);
        const k = y > 1e-5 ? ny / y : 1;
        r *= k;
        g *= k;
        b *= k;
        y = ny;
      }
      if (tone) {
        // split toward the theme's hue, kept to the pixel's brightness: colours that belong together
        const ty = luma(...tone) || 1e-6;
        r += (tone[0] * (y / ty) - r) * harmony.k;
        g += (tone[1] * (y / ty) - g) * harmony.k;
        b += (tone[2] * (y / ty) - b) * harmony.k;
      }
      let s = sat;
      const [, sv] = hsv(clamp01(r), clamp01(g), clamp01(b));
      if (sv * sat > most) s = most / Math.max(1e-6, sv);
      r = (y + (r - y) * s) * gain;
      g = (y + (g - y) * s) * gain;
      b = (y + (b - y) * s) * gain;
      rgbBuf[o] = r;
      rgbBuf[o + 1] = g;
      rgbBuf[o + 2] = b;
    }
  }

  // down to the texture's size in linear light; alpha by coverage, a hole under half
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const acc = [0, 0, 0];
      let cover = 0;
      let wsum = 0;
      for (let j = 0; j < S; j++)
        for (let i = 0; i < S; i++) {
          const k = (y * S + j) * W + x * S + i;
          cover += alpha[k];
          const wgt = alpha[k] > 0.5 ? 1 : 1e-4;
          for (let c = 0; c < 3; c++) acc[c] += lin(clamp01(rgbBuf[k * 3 + c])) * wgt;
          wsum += wgt;
        }
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) rgba[o + c] = Math.round(srgb(acc[c] / wsum) * 255);
      rgba[o + 3] = cover / (S * S) >= 0.5 ? 255 : 0;
    }
  return { width, height, rgba, fits };
}

// ── 256 colours ────────────────────────────────────────────────────────────
const WR = 2;
const WG = 4;
const WB = 3;
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/**
 * An RGBA picture cut down to a palette: median cut over its colours (6 bits a channel), refined by k-means, then
 * every pixel to its nearest colour with an optional 4x4 ordered dither (`dither` 0-1). `masked`: alpha under 128
 * takes index 255, pure blue, and the picture's colours the other 255. `{ pixels, palette, colours }`, deterministic.
 */
export function quantize({ width, height, rgba }, { masked = false, dither = 0, iterations = 8 } = {}) {
  const most = masked ? 255 : 256;
  const n = width * height;
  const byKey = new Map();
  for (let i = 0; i < n; i++) {
    if (masked && rgba[i * 4 + 3] < 128) continue;
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    let e = byKey.get(key);
    if (!e) byKey.set(key, (e = { key, n: 0, c: [0, 0, 0] }));
    e.n++;
    e.c[0] += r;
    e.c[1] += g;
    e.c[2] += b;
  }
  const colours = [...byKey.values()].sort((a, b) => a.key - b.key).map((e) => ({ n: e.n, c: e.c.map((v) => v / e.n) }));
  let centres = [];
  if (colours.length <= most) centres = colours.map((e) => e.c.slice());
  else {
    const spread = (list) => {
      let best = { w: -1, a: 0 };
      const pixels = list.reduce((s, e) => s + e.n, 0);
      for (let a = 0; a < 3; a++) {
        let lo = 255;
        let hi = 0;
        for (const e of list) {
          lo = Math.min(lo, e.c[a]);
          hi = Math.max(hi, e.c[a]);
        }
        const w = (hi - lo) * [WR, WG, WB][a] * Math.sqrt(pixels);
        if (w > best.w) best = { w, a };
      }
      return best;
    };
    const boxes = [{ list: colours, ...spread(colours) }];
    while (boxes.length < most) {
      let pick = -1;
      for (let i = 0; i < boxes.length; i++) if (boxes[i].list.length > 1 && (pick < 0 || boxes[i].w > boxes[pick].w)) pick = i;
      if (pick < 0) break;
      const box = boxes[pick];
      const sorted = box.list.slice().sort((x, y) => x.c[box.a] - y.c[box.a] || x.c[0] - y.c[0] || x.c[1] - y.c[1] || x.c[2] - y.c[2]);
      const half = sorted.reduce((s, e) => s + e.n, 0) / 2;
      let cut = 0;
      let acc = 0;
      while (cut < sorted.length - 1 && acc + sorted[cut].n <= half) acc += sorted[cut++].n;
      cut = Math.max(1, cut);
      const a = sorted.slice(0, cut);
      const b = sorted.slice(cut);
      boxes.splice(pick, 1, { list: a, ...spread(a) }, { list: b, ...spread(b) });
    }
    centres = boxes.map((box) => {
      const t = box.list.reduce((s, e) => s + e.n, 0);
      return [0, 1, 2].map((a) => box.list.reduce((s, e) => s + e.c[a] * e.n, 0) / t);
    });
    const assign = new Int32Array(colours.length);
    for (let it = 0; it < iterations; it++) {
      let moved = 0;
      for (let i = 0; i < colours.length; i++) {
        const k = nearest(centres, colours[i].c[0], colours[i].c[1], colours[i].c[2]);
        if (k !== assign[i] || it === 0) moved++;
        assign[i] = k;
      }
      const sum = centres.map(() => [0, 0, 0, 0]);
      colours.forEach((e, i) => {
        const s = sum[assign[i]];
        s[0] += e.c[0] * e.n;
        s[1] += e.c[1] * e.n;
        s[2] += e.c[2] * e.n;
        s[3] += e.n;
      });
      sum.forEach((s, k) => {
        if (s[3]) centres[k] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
      });
      if (!moved) break;
    }
  }
  centres = centres
    .map((c) => c.map((v) => Math.max(0, Math.min(255, Math.round(v)))))
    .sort((a, b) => luma(...a) - luma(...b) || a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const palette = new Uint8Array(PALETTE_BYTES);
  centres.forEach((c, i) => palette.set(c, i * 3));
  if (masked) palette.set(MASK_KEY, HOLE * 3);
  let step = 0;
  if (dither > 0 && centres.length > 1) {
    for (let i = 1; i < centres.length; i++) step += Math.hypot(...centres[i].map((v, a) => v - centres[i - 1][a]));
    step = (step / (centres.length - 1)) * dither;
  }
  const pixels = new Uint8Array(n);
  const memo = new Map();
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (masked && rgba[i * 4 + 3] < 128) {
        pixels[i] = HOLE;
        continue;
      }
      let r = rgba[i * 4];
      let g = rgba[i * 4 + 1];
      let b = rgba[i * 4 + 2];
      if (step) {
        const t = (BAYER4[(y & 3) * 4 + (x & 3)] / 16 - 0.47) * step;
        r += t;
        g += t;
        b += t;
      }
      const key = (Math.round(r) + 64) * 1e6 + (Math.round(g) + 64) * 1e3 + Math.round(b) + 64;
      let k = memo.get(key);
      if (k === undefined) memo.set(key, (k = nearest(centres, r, g, b)));
      pixels[i] = k;
    }
  return { pixels, palette, colours: centres.length };
}
function nearest(centres, r, g, b) {
  let best = 0;
  let least = Infinity;
  for (let k = 0; k < centres.length; k++) {
    const c = centres[k];
    const d = WR * (c[0] - r) ** 2 + WG * (c[1] - g) ** 2 + WB * (c[2] - b) ** 2;
    if (d < least) {
      least = d;
      best = k;
    }
  }
  return best;
}

// ── measuring the look of programmer art ───────────────────────────────────
/** Where a measure says a texture reads as made by a program, not painted (see textureMeasures). */
export const PROGRAMMER_ART = { flatShare: 0.3, straightEdges: 0.6, repeat: 0.8, saturation: 0.45 };
const FLAT_RANGE = 4;
/**
 * How flat, straight, repetitive and loud a texture is, measured on its solid pixels (the texture tiles: every
 * neighbour wraps round):
 *   flatShare      share of pixels in smooth fields: the luminance blurred over 5x5 (the photo's grain gone) varies
 *                  by under FLAT_RANGE levels of 255 across the 9x9 round it. Flat panels, solid fills, plain bands
 *   straightEdges  of the strong edges (a step over 24 levels), the share lying on a ruler-straight run of 8 or more
 *                  pixels along x or y: drawn rectangles, where a photograph's edges wander
 *   repeat         the strongest likeness of the picture to itself shifted by a half or a quarter of a side
 *                  (1 = the same; repeated identical panels score high)
 *   saturation     the mean HSV saturation, weighed by brightness (loud colour on dark reads as cartoon)
 *   flags          the measures past PROGRAMMER_ART, as sentences
 */
export function textureMeasures({ width, height, rgba }, limits = PROGRAMMER_ART) {
  if (!rgba || rgba.length !== width * height * 4) throw new Error(`a picture of ${width}x${height} needs ${width * height * 4} bytes of rgba`);
  const N = width * height;
  const L = new Float32Array(N);
  const solid = new Uint8Array(N);
  let satSum = 0;
  let satW = 0;
  for (let i = 0; i < N; i++) {
    const r = rgba[i * 4] / 255;
    const g = rgba[i * 4 + 1] / 255;
    const b = rgba[i * 4 + 2] / 255;
    L[i] = luma(r, g, b) * 255;
    solid[i] = rgba[i * 4 + 3] >= 128 ? 1 : 0;
    if (solid[i]) {
      const [, s, v] = hsv(r, g, b);
      satSum += s * v;
      satW += v;
    }
  }
  const at = (x, y) => (((y % height) + height) % height) * width + (((x % width) + width) % width);
  const blur = new Float32Array(N);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) sum += L[at(x + k, y + j)];
      blur[y * width + x] = sum / 25;
    }
  let flat = 0;
  let count = 0;
  let edges = 0;
  let straight = 0;
  const RUN = 8;
  const isEdgeX = (x, y) => solid[at(x, y)] && solid[at(x + 1, y)] && Math.abs(L[at(x + 1, y)] - L[at(x, y)]) > 24;
  const isEdgeY = (x, y) => solid[at(x, y)] && solid[at(x, y + 1)] && Math.abs(L[at(x, y + 1)] - L[at(x, y)]) > 24;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!solid[i]) continue;
      count++;
      let lo = 255;
      let hi = 0;
      for (let j = -4; j <= 4; j += 2)
        for (let k = -4; k <= 4; k += 2) {
          const q = at(x + k, y + j);
          if (!solid[q]) continue;
          lo = Math.min(lo, blur[q]);
          hi = Math.max(hi, blur[q]);
        }
      if (hi - lo < FLAT_RANGE) flat++;
      // an edge across x (a vertical line) is straight when the edges above and below line up with it
      for (const [edge, dx, dy] of [[isEdgeX, 0, 1], [isEdgeY, 1, 0]]) {
        if (!edge(x, y)) continue;
        edges++;
        let run = 1;
        for (let s = 1; s < RUN && edge(x + dx * s, y + dy * s); s++) run++;
        for (let s = 1; s < RUN && edge(x - dx * s, y - dy * s); s++) run++;
        if (run >= RUN) straight++;
      }
    }
  // likeness to itself under a shift: 1 - mean |difference| / (2 x mean deviation)
  let mean = 0;
  for (let i = 0; i < N; i++) mean += L[i];
  mean /= N;
  let dev = 0;
  for (let i = 0; i < N; i++) dev += Math.abs(L[i] - mean);
  dev = dev / N || 1e-6;
  let repeat = 0;
  for (const [sx, sy] of [[width / 2, 0], [width / 4, 0], [0, height / 2], [0, height / 4]]) {
    if (!Number.isInteger(sx) || !Number.isInteger(sy) || (sx === 0 && sy === 0)) continue;
    let diff = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) diff += Math.abs(L[y * width + x] - L[at(x + sx, y + sy)]);
    repeat = Math.max(repeat, 1 - diff / N / (2 * dev));
  }
  const m = {
    flatShare: +(flat / Math.max(1, count)).toFixed(3),
    straightEdges: +(straight / Math.max(1, edges)).toFixed(3),
    repeat: +Math.max(0, repeat).toFixed(3),
    saturation: +(satSum / Math.max(1e-6, satW)).toFixed(3),
  };
  m.flags = [];
  if (m.flatShare > limits.flatShare) m.flags.push(`flat: ${Math.round(m.flatShare * 100)}% of its pixels are solid colour (over ${Math.round(limits.flatShare * 100)}%)`);
  if (m.straightEdges > limits.straightEdges) m.flags.push(`ruled: ${Math.round(m.straightEdges * 100)}% of its edges are ruler-straight (over ${Math.round(limits.straightEdges * 100)}%)`);
  if (m.repeat > limits.repeat) m.flags.push(`repeats: it is ${Math.round(m.repeat * 100)}% like itself shifted by part of a side (over ${Math.round(limits.repeat * 100)}%)`);
  if (m.saturation > limits.saturation) m.flags.push(`loud: mean saturation ${m.saturation} (over ${limits.saturation})`);
  return m;
}
