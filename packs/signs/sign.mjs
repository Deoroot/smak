// A sign drawn by a program onto a texture (README.md): words in the pack's stroke font and shapes, in the sign's own
// units, with one of four finishes: neon (a glow round the strokes on a dark ground), lit (a bright panel, as a
// backlit poster), paint (laid over a material of packs/materials, worn, its set carried over) and plate (a board
// with a frame). Out comes what packs/materials writes: the 8-bit texture, its .png and, where there is one, a set.
//
//   makeSign(spec, { base })      { texture, picture, layers, emissive, lines, warnings, errors, json }
//   writeSign(made, folder)       <name>.png, <name>.set/ (a painted material's maps, or emissive.png), the credit
//   signSheet(rows)               the proof: each row's pictures at their size and at a quarter, named
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { png, label, maps } from "../../src/index.mjs";
import { quantise, resample, readPicture } from "../materials/material.mjs";
import { textPaths } from "./font.mjs";

/** The finishes: the ground, the ink and the frame's colour each takes when the spec says none; `glows`: `~name` and an emissive picture. */
export const FINISHES = {
  neon: { ground: [14, 8, 20], colour: [255, 120, 235], frame: [44, 40, 46], glows: true },
  lit: { ground: [232, 238, 244], colour: [16, 22, 30], frame: [10, 14, 24], glows: true },
  paint: { colour: [214, 210, 196] },
  plate: { ground: [36, 38, 36], colour: [214, 212, 196], frame: [96, 96, 88] },
};
/**
 * A capital under 7 texels high is not read: the font's grid is 12 high and its closest strokes (the arms of an E,
 * the bowls of a B and an 8) are 6 apart, so under 7 texels they are under 3.5 apart and a stroke a texel wide leaves
 * a gap of 2 or less (looked at 5, 6, 7, 8 and 10 texels, 2026-11-15: at 6 an E, a B and an 8 are one blot).
 */
export const SMALLEST_CAP = 7;
/** A stroke over a quarter of the capital's height leaves, between strokes half a capital apart, a gap thinner than the stroke: the letter fills in. */
export const FATTEST_STROKE = 0.25;
/**
 * The least contrast of words against what is under them, as WCAG 2.1 measures it ((L1 + 0.05) / (L2 + 0.05), L the
 * relative luminance), or that of their red, green or blue alone when it is larger (a red number on a grey wall of
 * its own lightness is read by its colour). Looked at 2026-11-15, grey capitals 10 texels high on a grey plate: 1.3
 * is not found, 1.6 is faint, 2 is read; WCAG's own bar for large text, 3, is for weak sight.
 */
export const LEAST_CONTRAST = 2;
const LUMA = [0.299, 0.587, 0.114];
const MAPS = ["color", "normal", "roughness", "metalness", "occlusion"];
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lumaAt = (data, i) => data[i * 3] * LUMA[0] + data[i * 3 + 1] * LUMA[1] + data[i * 3 + 2] * LUMA[2];
const colourOf = (c) => (typeof c === "string" ? [1, 3, 5].map((at) => parseInt(c.slice(at, at + 2), 16)) : c);
const linear = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
const luminance = (rgb) => 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
const ratio = (p, q) => (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05);
const contrast = (a, b) => Math.max(ratio(luminance(a), luminance(b)), ...[0, 1, 2].map((c) => ratio(linear(a[c]), linear(b[c]))));
const hash = (x, y, s) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 362437)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }; // prettier-ignore
/** Noise of 0 to 1 that varies smoothly over a cell of 1. */
function noise(x, y, s) {
  const [xi, yi] = [Math.floor(x), Math.floor(y)];
  const [fx, fy] = [x - xi, y - yi].map((t) => t * t * (3 - 2 * t));
  const row = (j) => hash(xi, yi + j, s) * (1 - fx) + hash(xi + 1, yi + j, s) * fx;
  return row(0) * (1 - fy) + row(1) * fy;
}

/** Lines of words laid at a place (`at`: the first capital's top, its left, middle or right by `align`) or in a `box` (centred up and down; with no `height`, the largest that fits). */
function textOf(item) {
  const rows = [item.text].flat().map(String);
  const [gap, leading, box] = [item.gap ?? 0.2, item.leading ?? 1.5, item.box];
  const tall = rows.length * leading - leading + 1; // the block's height in capitals
  const widest = (h) => Math.max(...rows.map((row) => textPaths(row, 0, 0, h, gap).width));
  if (!item.height && !box) throw new Error(`text ${JSON.stringify(rows[0])}: its height, or a box to fit`);
  const height = item.height ?? Math.min((box[3] - box[1]) / (tall + 0.125), (box[2] - box[0]) / (widest(1) + 0.125));
  const width = item.width ?? height / 8;
  const align = item.align ?? (box ? "centre" : "left");
  const [left, right] = box ? [box[0] + width / 2, box[2] - width / 2] : [item.at[0], item.at[0]];
  const top = box ? (box[1] + box[3] - tall * height) / 2 : item.at[1];
  const [paths, missing] = [[], []];
  rows.forEach((row, n) => {
    const w = textPaths(row, 0, 0, height, gap).width;
    const x = align === "left" ? left : align === "right" ? right - w : (left + right - w) / 2;
    const made = textPaths(row, x, top + n * leading * height, height, gap);
    paths.push(...made.paths);
    missing.push(...made.missing);
  });
  const over = box && item.height && (widest(height) + width > box[2] - box[0] + 0.01 || (tall + 0.125) * height > box[3] - box[1] + 0.01);
  return { paths, width, rows, height, missing, over: over ? Math.min((box[3] - box[1]) / (tall + 0.125), (box[2] - box[0]) / (widest(1) + 0.125)) : 0 }; // prettier-ignore
}
/** An item's middle lines in the sign's units: { paths, fill, width } (and a text's rows, height and missing letters). */
function shapeOf(item) {
  const turn = (cx, cy, r, a0, a1, n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 7.5))) => Array.from({ length: n + 1 }, (_, i) => { const t = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; }); // prettier-ignore
  if (item.text !== undefined) return textOf(item);
  if (item.line) return { paths: [item.closed ? [...item.line, item.line[0]] : item.line] };
  if (item.polygon) return { paths: [[...item.polygon, item.polygon[0]]], fill: true };
  if (item.circle) return { paths: [turn(...item.circle, item.from ?? 0, item.to ?? 360)] };
  if (item.rect) {
    const [x0, y0, x1, y1] = item.rect;
    const r = Math.min(item.radius ?? 0, (x1 - x0) / 2, (y1 - y0) / 2);
    const path = r ? [...turn(x1 - r, y0 + r, r, -90, 0), ...turn(x1 - r, y1 - r, r, 0, 90), ...turn(x0 + r, y1 - r, r, 90, 180), ...turn(x0 + r, y0 + r, r, 180, 270)] : [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; // prettier-ignore
    return { paths: [[...path, path[0]]] };
  }
  if (item.arrow) {
    const [cx, cy, s] = item.arrow;
    const t = ((item.dir ?? 0) * Math.PI) / 180;
    const at = ([u, v]) => [cx + (u * Math.cos(t) + v * Math.sin(t)) * s, cy + (v * Math.cos(t) - u * Math.sin(t)) * s];
    return { paths: [[[-1, 0], [1, 0]].map(at), [[0.15, -0.7], [1, 0], [0.15, 0.7]].map(at)] }; // prettier-ignore
  }
  throw new Error(`an item is a text, line, polygon, rect, circle or arrow, not ${JSON.stringify(item).slice(0, 80)}`);
}
/** How far each pixel's middle is from the nearest of `paths` (pixels), out to `reach`; inside a filled shape, negative. */
function fieldOf(W, H, paths, fill, reach) {
  const d = new Float32Array(W * H).fill(Infinity);
  for (const path of paths)
    for (let n = 0; n < Math.max(1, path.length - 1); n++) {
      const [a, b] = [path[n], path[n + 1] ?? path[n]];
      const [vx, vy] = [b[0] - a[0], b[1] - a[1]];
      const l = vx * vx + vy * vy;
      for (let y = Math.max(0, Math.floor(Math.min(a[1], b[1]) - reach)); y <= Math.min(H - 1, Math.ceil(Math.max(a[1], b[1]) + reach)); y++)
        for (let x = Math.max(0, Math.floor(Math.min(a[0], b[0]) - reach)); x <= Math.min(W - 1, Math.ceil(Math.max(a[0], b[0]) + reach)); x++) {
          const t = l ? clamp(((x + 0.5 - a[0]) * vx + (y + 0.5 - a[1]) * vy) / l) : 0;
          const far = Math.hypot(x + 0.5 - a[0] - t * vx, y + 0.5 - a[1] - t * vy);
          if (far < d[y * W + x]) d[y * W + x] = far;
        }
    }
  for (let y = 0; fill && y < H; y++) {
    const xs = [];
    for (const path of paths) path.forEach((a, n) => { const b = path[(n + 1) % path.length]; if (a[1] <= y + 0.5 !== b[1] <= y + 0.5) xs.push(a[0] + ((y + 0.5 - a[1]) * (b[0] - a[0])) / (b[1] - a[1])); }); // prettier-ignore
    xs.sort((p, q) => p - q);
    for (let n = 0; n + 1 < xs.length; n += 2) for (let x = Math.max(0, Math.ceil(xs[n] - 0.5)); x < W && x + 0.5 < xs[n + 1]; x++) d[y * W + x] = -d[y * W + x]; // prettier-ignore
  }
  return d;
}
/** Every item as ink at `S` pixels a unit: its distance field, half its stroke, its colour, its glow, its box in units. */
function inksOf(spec, S, W, H) {
  const finish = FINISHES[spec.finish];
  let seed = (spec.seed ?? 1) * 7919;
  const chance = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  const inks = [];
  for (const item of spec.items ?? []) {
    const shape = shapeOf(item);
    const width = item.width ?? shape.width ?? spec.width ?? 2;
    const fill = item.fill ?? shape.fill ?? false;
    const [nx, ny, dx, dy] = item.repeat ?? [1, 1, 0, 0];
    const paths = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (item.some === undefined || chance() < item.some) for (const p of shape.paths) paths.push(p.map(([x, y]) => [(x + i * dx) * S, (y + j * dy) * S])); // prettier-ignore
    const half = fill ? 0 : (width * S) / 2;
    const glow = spec.finish === "neon" ? (item.glow ?? Math.max(1.5, width)) * S : 0;
    const all = shape.paths.flat();
    const box = [0, 1].flatMap((c) => [Math.min(...all.map((p) => p[c])) - width / 2, Math.max(...all.map((p) => p[c])) + width / 2]); // x0, x1, y0, y1
    const d = fieldOf(W, H, paths, fill, half + 1 + 6 * glow);
    const inside = item.within === undefined ? null : inks[item.within];
    if (item.within !== undefined && !inside) throw new Error(`within: ${item.within} is not an item before this one (the first is 0)`);
    for (let i = 0; inside && i < d.length; i++) if (cover(inside.d[i], inside.half) < 0.5) d[i] = Infinity;
    inks.push({ item, shape, width, half, glow, box, d, colour: colourOf(item.colour ?? spec.colour ?? finish.colour), opacity: item.opacity ?? 1 });
  }
  return inks;
}
const cover = (d, half) => clamp(half + 0.5 - d);
/** An ink laid flat on a picture of floats. */
function lay({ data }, ink) {
  for (let i = 0; i < ink.d.length; i++) {
    const c = cover(ink.d[i], ink.half) * ink.opacity;
    if (c > 0) for (let k = 0; k < 3; k++) data[i * 3 + k] += (ink.colour[k] - data[i * 3 + k]) * c;
  }
}
/** Neon: every tube's halo first (its colour deepened, a near glow and a wide faint one, even along the tube), then the tubes, white-hot along their middle. */
function layNeon({ data }, inks) {
  for (const ink of inks) {
    const most = Math.max(...ink.colour, 1);
    const halo = ink.colour.map((v) => v * (v / most) ** 1.5);
    for (let i = 0; i < ink.d.length; i++) {
      if (ink.d[i] === Infinity) continue;
      const e = Math.max(0, ink.d[i] - ink.half) / ink.glow;
      const g = (0.6 * Math.exp(-e * e / 2) + 0.12 * Math.exp(-e * e / 18)) * ink.opacity;
      for (let k = 0; k < 3; k++) data[i * 3 + k] += halo[k] * g;
    }
  }
  for (const ink of inks)
    for (let i = 0; i < ink.d.length; i++) {
      const [c, hot] = [cover(ink.d[i], ink.half) * ink.opacity, cover(ink.d[i], ink.half * 0.45 - 0.25) * 0.8 * ink.opacity];
      if (c > 0) for (let k = 0; k < 3; k++) { data[i * 3 + k] += (ink.colour[k] - data[i * 3 + k]) * c; data[i * 3 + k] += (0.35 * ink.colour[k] + 166 - data[i * 3 + k]) * hot; } // prettier-ignore
    }
}
/** The inks as one coat of paint: its colour and how much of it covers, a pixel. */
function coatOf(inks, W, H) {
  const [rgb, alpha] = [new Float32Array(W * H * 3), new Float32Array(W * H)];
  for (const ink of inks)
    for (let i = 0; i < W * H; i++) {
      const c = cover(ink.d[i], ink.half) * ink.opacity;
      if (c <= 0) continue;
      const a = alpha[i] + (1 - alpha[i]) * c;
      for (let k = 0; k < 3; k++) rgb[i * 3 + k] = (rgb[i * 3 + k] * alpha[i] * (1 - c) + ink.colour[k] * c) / a;
      alpha[i] = a;
    }
  return { rgb, alpha };
}
/**
 * A coat laid over a material's picture, worn: `kept` (one a texel of the texture, `k` pixels of this picture a texel)
 * says where the paint stayed; chipped, a ghost of it (`thin`) is left. The paint takes the material's light and dark.
 * Returns how much paint is on each pixel.
 */
function painted(image, coat, kept, k, { fade = 0, thin = 0.12 }) {
  const { width: W, height: H, data } = image;
  const [w, h] = [W / k, H / k];
  let mean = 0;
  for (let i = 0; i < W * H; i++) mean += lumaAt(data, i) / (W * H);
  const on = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!coat.alpha[i]) continue;
    const [u, v] = [clamp(((i % W) + 0.5) / k - 0.5, 0, w - 1), clamp((Math.floor(i / W) + 0.5) / k - 0.5, 0, h - 1)];
    const [x, y] = [Math.min(w - 2, Math.floor(u)), Math.min(h - 2, Math.floor(v))];
    const stays = (kept[y * w + x] * (x + 1 - u) + kept[y * w + x + 1] * (u - x)) * (y + 1 - v) + (kept[(y + 1) * w + x] * (x + 1 - u) + kept[(y + 1) * w + x + 1] * (u - x)) * (v - y); // prettier-ignore
    const a = (on[i] = coat.alpha[i] * (thin + (1 - thin) * stays) * (1 - fade));
    const m = 0.45 + 0.55 * clamp(lumaAt(data, i) / (mean || 1), 0.5, 1.5);
    for (let c = 0; c < 3; c++) data[i * 3 + c] += (Math.min(255, coat.rgb[i * 3 + c] * m) - data[i * 3 + c]) * a;
  }
  return on;
}
/** A material of packs/materials by its place and name (no .png): its texture, and its set when that lies on it. */
function readMaterial(at) {
  if (!existsSync(`${at}.png`)) throw new Error(`on: ${at}.png is not there: a material packs/materials made (its <name>.png, its <name>.set/ beside it), named with no .png`); // prettier-ignore
  const json = existsSync(join(`${at}.set`, "material.json")) ? JSON.parse(readFileSync(join(`${at}.set`, "material.json"), "utf8")) : null;
  const set = {};
  for (const key of json && !json.part ? MAPS : []) if (existsSync(join(`${at}.set`, `${key}.png`))) set[key] = readPicture(readFileSync(join(`${at}.set`, `${key}.png`))); // prettier-ignore
  return { at, texture: readPicture(readFileSync(`${at}.png`)), json, set: Object.keys(set).length ? set : null, why: !json ? "has no set beside it" : json.part ? "is a part of its source (--part), so its set does not lie on it" : "has no map in its set" }; // prettier-ignore
}

/**
 * A sign from its spec: { texture, picture, layers, emissive, lines, warnings, errors, json }.
 *   name     the texture's name (15 letters; `~name` for one that glows)
 *   size     [w, h] in the sign's units; `texels` a unit (1): the texture is size x texels, multiples of 16
 *   finish   neon | lit | paint | plate (FINISHES)
 *   ground   a colour ([r, g, b] or "#rrggbb"), or { from, to, folds: [amount, every] }: top to bottom, in folds
 *   on, at   paint: the material (`base`/<on>.png and .set) and the texel of it the sign's corner lies on ([0, 0])
 *   wear, fade, seed   paint: how much is chipped (0.35), how thin what stays is (0), which chips
 *   frame    a width in units, or { width, colour }; flat: a lit panel with no falling off to its edges
 *   colour, width      what an item takes when it says none
 *   items    { text, at | box, height, align, gap, leading } | { line, closed } | { polygon } | { rect, radius } |
 *            { circle: [x, y, r], from, to } | { arrow: [x, y, size], dir }, each with colour, width, fill, opacity,
 *            glow, repeat: [nx, ny, dx, dy], some (the share of the copies kept), within (an earlier item's number:
 *            only where that one is)
 */
export function makeSign(spec, { base = "." } = {}) {
  const [warnings, errors, lines] = [[], [], []];
  const finish = FINISHES[spec.finish];
  if (!finish) throw new Error(`finish: ${Object.keys(FINISHES).join(", ")}, not ${JSON.stringify(spec.finish)}`);
  if (!Array.isArray(spec.size) || !(spec.size[0] > 0 && spec.size[1] > 0)) throw new Error(`size: [w, h] in the sign's units, not ${JSON.stringify(spec.size)}`); // prettier-ignore
  const [name, S] = [String(spec.name ?? ""), spec.texels ?? 1];
  const [W, H] = spec.size.map((v) => v * S);
  if (!name || name.length > maps.LONGEST_NAME) errors.push(`the name ${JSON.stringify(name)} is ${name.length} letters: a texture's name holds ${maps.LONGEST_NAME}`); // prettier-ignore
  if (W % 16 || H % 16) errors.push(`the texture would be ${W}x${H} (${spec.size.join(" x ")} units at ${S} texel${S === 1 ? "" : "s"} a unit): both sides are multiples of 16 (${Math.ceil(W / 16) * 16}x${Math.ceil(H / 16) * 16} is the next)`); // prettier-ignore
  if (errors.length) return { errors, warnings, lines };
  const paint = spec.finish === "paint";
  const material = paint ? readMaterial(join(base, String(spec.on))) : null;
  const [ox, oy] = spec.at ?? [0, 0];
  const picture = { width: W, height: H, data: new Float32Array(W * H * 3) };
  const from = colourOf(spec.ground?.from ?? spec.ground ?? finish.ground);
  const [to, [folds, every]] = [colourOf(spec.ground?.to ?? from), spec.ground?.folds ?? [0, 16]];
  for (let i = 0; i < W * H; i++) {
    const [x, y] = [i % W, Math.floor(i / W)];
    const at = material && ((((y + oy) % material.texture.height) + material.texture.height) % material.texture.height) * material.texture.width + ((((x + ox) % material.texture.width) + material.texture.width) % material.texture.width); // prettier-ignore
    const k = (1 - folds * (0.5 - 0.5 * Math.sin((x / S / every) * 2 * Math.PI + Math.sin((y / S) * 0.04) * 1.5))) * (spec.finish === "plate" ? 1 + (hash(x, y, 3) - 0.5) * 0.12 : 1); // prettier-ignore
    for (let c = 0; c < 3; c++) picture.data[i * 3 + c] = material ? material.texture.data[at * 3 + c] : (from[c] + ((to[c] - from[c]) * y) / (H - 1)) * k; // prettier-ignore
  }
  const inks = inksOf(spec, S, W, H);
  const caps = [];
  for (const ink of inks) {
    if (ink.shape.rows) {
      const said = JSON.stringify(ink.shape.rows.join(" / "));
      const [x0, x1, y0, y1] = ink.box.map((v, n) => clamp(Math.round(v * S), 0, n < 2 ? W : H));
      const under = [0, 0, 0];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) under[c] += picture.data[(y * W + x) * 3 + c] / Math.max(1, (x1 - x0) * (y1 - y0)); // prettier-ignore
      const [cap, stroke, read] = [ink.shape.height * S, ink.width * S, contrast(ink.colour, under)];
      caps.push(cap);
      if (ink.shape.missing.length) warnings.push(`${said}: the font has no ${[...new Set(ink.shape.missing)].map((l) => JSON.stringify(l)).join(", ")}: left out (capitals, digits, . , : ! ? ' " - + / ( ) = < > % and the four arrows)`); // prettier-ignore
      if (cap < SMALLEST_CAP) warnings.push(`${said}: its capitals are ${+cap.toFixed(1)} texels high, under ${SMALLEST_CAP}: the strokes of an E or a B run together; a larger height, or more texels a unit`); // prettier-ignore
      if (stroke < 1) warnings.push(`${said}: its strokes are ${+stroke.toFixed(2)} of a texel wide, under 1: they break up and fade; a wider stroke`);
      if (ink.width > ink.shape.height * FATTEST_STROKE + 1e-9) warnings.push(`${said}: its strokes are ${+ink.width.toFixed(2)} wide on capitals ${+ink.shape.height.toFixed(2)} high, over ${FATTEST_STROKE} of them: the letters fill in`); // prettier-ignore
      if (read < LEAST_CONTRAST) warnings.push(`${said}: its colour ${ink.colour.join("/")} on ${under.map(Math.round).join("/")} is a contrast of ${read.toFixed(1)} to 1, under ${LEAST_CONTRAST}: hard to read`); // prettier-ignore
      if (ink.box[0] < -0.01 || ink.box[2] < -0.01 || ink.box[1] > spec.size[0] + 0.01 || ink.box[3] > spec.size[1] + 0.01) warnings.push(`${said}: it is cut by the sign's edge (it reaches ${ink.box.map((v) => +v.toFixed(1)).join(", ")} of x0, x1, y0, y1 on a sign ${spec.size.join(" x ")})`); // prettier-ignore
      if (ink.shape.over) warnings.push(`${said}: at a height of ${ink.shape.height} it does not fit its box; ${+ink.shape.over.toFixed(2)} does (or give no height)`);
    }
    if (!paint && spec.finish !== "neon") lay(picture, ink);
  }
  if (spec.finish === "neon") layNeon(picture, inks);
  if (spec.finish === "lit" && !spec.flat) for (let i = 0; i < W * H; i++) { const k = 1 - 0.14 * Math.max(Math.abs((2 * (i % W)) / W - 1), Math.abs((2 * Math.floor(i / W)) / H - 1)) ** 3; for (let c = 0; c < 3; c++) picture.data[i * 3 + c] *= k; } // prettier-ignore
  const layers = {};
  let emissive = null;
  if (paint) {
    let mean = 0;
    for (let i = 0; i < W * H; i++) mean += lumaAt(picture.data, i) / (W * H);
    const [wear, seed] = [spec.wear ?? 0.35, spec.seed ?? 1];
    const kept = Float32Array.from({ length: W * H }, (_, i) => { const [x, y] = [i % W, Math.floor(i / W)]; const t = (0.55 * noise(x / 2.5, y / 2.5, seed) + 0.45 * noise(x / 20, y / 20, seed + 7) + 0.9 * (clamp(lumaAt(picture.data, i) / (mean || 1), 0.5, 1.5) - 1) - wear + 0.07) / 0.14; return clamp(t) ** 2 * (3 - 2 * clamp(t)); }); // prettier-ignore
    const bare = { width: W, height: H, data: picture.data.slice() };
    const on = painted(picture, coatOf(inks, W, H), kept, 1, spec);
    const [covered, stayed] = [inks.reduce((s, ink) => s + ink.d.reduce((n, d, i) => n + (cover(d, ink.half) > 0.5 ? 1 : 0), 0), 0), on.reduce((n, a) => n + (a > 0.5 ? 1 : 0), 0)]; // prettier-ignore
    lines.push(`paint on ${basename(material.at)} from its texel ${ox}, ${oy}: wear ${wear}, ${covered ? Math.round((100 * stayed) / covered) : 0}% of the paint stayed, chipped first where the material is dark`);
    if (material.set) {
      const k = Math.max(1, Math.min(Math.floor(Object.values(material.set)[0].width / material.texture.width), Math.floor(1024 / Math.max(W, H))));
      const part = [ox / material.texture.width, oy / material.texture.height, (ox + W) / material.texture.width, (oy + H) / material.texture.height];
      for (const key of MAPS) if (material.set[key] || key === "color") layers[key] = material.set[key] ? resample(material.set[key], W * k, H * k, part) : resample(bare, W * k, H * k); // a set with no colour: the texture's own
      const coat = painted(layers.color, coatOf(inksOf(spec, S * k, W * k, H * k), W * k, H * k), kept, k, spec);
      if (layers.roughness) layers.roughness.data.forEach((v, i, all) => (all[i] = v + (95 - v) * 0.4 * coat[Math.floor(i / 3)]));
      lines.push(`its set carried over at ${W * k}x${H * k}: ${Object.keys(layers).join(", ")}; the paint on the colour and, a little smoother, on the roughness`); // prettier-ignore
    } else warnings.push(`${basename(material.at)} ${material.why}: the sign has no set, and an engine that lights it gives it no relief where the wall round it has`); // prettier-ignore
  } else if (finish.glows) {
    emissive = { width: W, height: H, data: picture.data.map((v, i) => clamp(spec.finish === "neon" ? v - from[i % 3] : v, 0, 255)) };
    const glow = [0, 0, 0];
    for (let i = 0; i < W * H; i++) if (lumaAt(emissive.data, i) > 40) for (let c = 0; c < 3; c++) glow[c] += emissive.data[i * 3 + c];
    const most = Math.max(...glow, 1);
    lines.push(`its light: ${glow.map((v) => Math.round((255 * v) / most)).join(" ")}; as a texture light, "${name}" "${glow.map((v) => Math.round((255 * v) / most)).join(" ")} <brightness>" in info_texlights, which packs/gltf's lit way makes emissive with this picture`); // prettier-ignore
    if (name[0] !== "~") lines.push(`${name} does not begin with ~: an engine that draws ~ textures at full light (Xash) lights this one as a wall`);
  }
  const frame = spec.frame ?? (spec.finish === "plate" ? 2 : 0);
  const [edge, tint] = [Math.round((frame.width ?? frame) * S), colourOf(frame.colour ?? finish.frame ?? finish.colour)];
  for (let i = 0; edge && i < W * H; i++) {
    const [x, y] = [i % W, Math.floor(i / W)];
    const inset = Math.min(x, y, W - 1 - x, H - 1 - y);
    const bevel = spec.finish !== "plate" || inset ? 1 : x === 0 || y === 0 ? 1.4 : 0.6;
    if (inset < edge) for (let c = 0; c < 3; c++) { picture.data[i * 3 + c] = tint[c] * bevel; if (emissive) emissive.data[i * 3 + c] = 0; } // prettier-ignore
  }
  for (let i = 0; i < picture.data.length; i++) picture.data[i] = clamp(picture.data[i], 0, 255);
  const q = quantise(picture);
  const texture = { name, width: W, height: H, pixels: q.pixels, palette: q.palette };
  lines.unshift(`texture ${name} ${W}x${H}, 256 colours (palette error mean ${q.error.mean}, worst ${q.error.worst}): ${spec.size.join(" x ")} units at ${S} texel${S === 1 ? "" : "s"} a unit, so lay it at scale ${+(1 / S).toFixed(3)}; ${spec.finish}, ${inks.length} item${inks.length === 1 ? "" : "s"}${caps.length ? `, its smallest capitals ${+Math.min(...caps).toFixed(1)} texels high` : ""}`); // prettier-ignore
  const json = { name, finish: spec.finish, size: spec.size, texels: S, texture: { name, width: W, height: H }, ...(paint ? { on: basename(material.at), at: [ox, oy] } : {}) }; // prettier-ignore
  return { texture, picture, layers, emissive, material, lines, warnings, errors, json };
}
const rgbaOf = ({ width, height, data }) => { const rgba = new Uint8Array(width * height * 4).fill(255); for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.round(clamp(data[i * 3 + c], 0, 255)); return { width, height, rgba }; }; // prettier-ignore
/** A made sign's texture as { width, height, rgba }, its own 256 colours. */
export const pictureOf = (made) => ({ width: made.texture.width, height: made.texture.height, rgba: maps.textureRgba(made.texture).rgba });

/** <name>.png into `folder`; a painted material's set as <name>.set/ (material.json: packs/gltf's lit way reads it) and its credit; a glowing sign's <name>.set/emissive.png and sign.json. */
export function writeSign(made, folder, { date = new Date().toISOString().slice(0, 10) } = {}) {
  const name = made.texture.name;
  const [file, set] = [join(folder, `${name}.png`), join(folder, `${name}.set`)];
  const written = [file];
  const put = (layer, to) => { const b = rgbaOf(layer); writeFileSync(to, png(b.width, b.height, b.rgba)); };
  mkdirSync(folder, { recursive: true });
  writeFileSync(file, png(made.texture.width, made.texture.height, pictureOf(made).rgba));
  if (made.layers.color || made.emissive) {
    mkdirSync(set, { recursive: true });
    written.push(set);
    for (const [key, layer] of Object.entries(made.layers)) put(layer, join(set, `${key}.png`));
    if (made.emissive) put(made.emissive, join(set, "emissive.png"));
    writeFileSync(join(set, made.emissive ? "sign.json" : "material.json"), `${JSON.stringify({ ...(made.material?.json ?? {}), ...made.json, part: null, maps: Object.keys(made.layers), made: date }, null, 2)}\n`); // prettier-ignore
  }
  if (made.material && existsSync(`${made.material.at}.credit.txt`)) {
    writeFileSync(join(folder, `${name}.credit.txt`), `${name}: painted by SMAK's signs pack over ${basename(made.material.at)}, whose credit follows.\n${readFileSync(`${made.material.at}.credit.txt`, "utf8")}`); // prettier-ignore
    written.push(join(folder, `${name}.credit.txt`));
  }
  return written;
}

/** The proof: a row a sign, `{ name, pictures }` ({ width, height, rgba } each: what it replaces first, when there is one), each picture at its size and beside it at a quarter, as from four times as far. */
export function signSheet(rows) {
  const small = (p) => rgbaOf(resample({ width: p.width, height: p.height, data: Float32Array.from({ length: p.width * p.height * 3 }, (_, i) => p.rgba[Math.floor(i / 3) * 4 + (i % 3)]) }, Math.max(1, Math.round(p.width / 4)), Math.max(1, Math.round(p.height / 4)))); // prettier-ignore
  const placed = rows.map((row) => ({ ...row, all: row.pictures.flatMap((p) => [p, small(p)]) }));
  const width = Math.max(...placed.map((row) => row.all.reduce((s, p) => s + p.width + 12, 12)));
  const sheet = { width, height: placed.reduce((s, row) => s + Math.max(...row.all.map((p) => p.height)) + 30, 0), rgba: null };
  sheet.rgba = new Uint8Array(sheet.width * sheet.height * 4).fill(255);
  for (let i = 0; i < sheet.width * sheet.height; i++) sheet.rgba.set([58, 60, 64], i * 4);
  let top = 0;
  for (const row of placed) {
    label(sheet, row.name, 12, top + 6);
    let left = 12;
    for (const p of row.all) {
      for (let y = 0; y < p.height; y++) sheet.rgba.set(p.rgba.subarray(y * p.width * 4, (y + 1) * p.width * 4), ((top + 22 + y) * sheet.width + left) * 4);
      left += p.width + 12;
    }
    top += Math.max(...row.all.map((p) => p.height)) + 30;
  }
  return sheet;
}
