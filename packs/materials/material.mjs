// A photographed material made a GoldSrc texture, and its set kept for other engines (README.md). The kit does not
// paint: the picture is the library's, shrunk well, made to tile where it does not, cut to 256 colours, and
// measured (the seam, the palette's error, the brightness against Valve's own textures).
//
//   readPicture(bytes)                       a JPEG or PNG as { width, height, data: floats, three a pixel }
//   resample(image, w, h, part)              shrunk (or grown) by the area each texel covers, wrapping: a box filter
//   seamOf(image)                            the step across the wrap against the steps between neighbours inside
//   mendSeams(image)                         a picture made to tile by blending its edges with itself shifted half
//   quantise(image, { dither })              { pixels, palette, error } by the kit's median cut, dithered or not
//   makeMaterial(set, options)               { texture, layers, report, warnings, errors, json }
//   writeMaterial(made, folder)              <name>.png, <name>.set/, <name>.credit.txt
//   wadOfFolder(folder)                      every <name>.png of a folder as one .wad: { bytes, textures, check }
//   wallSheet(...)                           the proof: the source, the tile 3 x 3, on a wall beside a player
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { png, unpng, unjpeg, indexed, tile, maps } from "../../src/index.mjs";
import { parseMarks, layMarks } from "./marks.mjs";

/**
 * Valve's own textures' mean brightness (luma, 0.299 r + 0.587 g + 0.114 b): halflife.wad (the game's valve folder),
 * its 2245 textures that are not a light, sky, water, a mask or animated, measured 2026-11-14: 5th 31, 10th 38,
 * median 87, 90th 145, 95th 161. GoldSrc draws texture times light: under the 5th a face stays black in any light,
 * over the 95th it washes out (the mess hall's 18 opaque textures: median 61; the owner's neon bench, 81e56e5: mid-grey textures).
 */
export const VALVE_BRIGHTNESS = { least: 31, median: 87, most: 161, n: 2245, source: "halflife.wad, 5th to 95th of 2245 textures (2026-11-14)" }; // prettier-ignore
/**
 * A tile's wrap is a seam when its step is this many times the steps inside it (seamOf). Measured 2026-11-14 at
 * 256 on 18 sets of the two libraries: whole, 0.86 to 1.41, but ambientCG CorrugatedSteel009 1.74 (it does not
 * tile: mended, 1.05); a part cut out of one 1.39 to 2.45, mended 0.58 to 1.2, but a part of MetalPlates001 2.34 to
 * 2.76 (a groove a texel wide lies on its new edge). Over SEAM_BOUND a picture is mended (a part always is: it was
 * never made to tile); still over it after, a WARN (the 3 x 3 says whether it is a line or a groove); over
 * SEAM_FAIL after mending, a FAIL (two flat halves, the broken case).
 */
export const SEAM_BOUND = 1.5;
export const SEAM_FAIL = 2.5;
const UNITS_A_METRE = 39.37;
const LUMA = [0.299, 0.587, 0.114];

/** A JPEG or a PNG as floats, three a pixel (a PNG's alpha dropped, kept apart as `alpha` when it has one). */
export function readPicture(bytes) {
  const read = bytes[0] === 0xff && bytes[1] === 0xd8 ? unjpeg(bytes) : unpng(bytes);
  const n = read.width * read.height;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) data[i * 3 + c] = read.rgb ? read.rgb[i * 3 + c] : read.rgba[i * 4 + c]; // prettier-ignore
  return { width: read.width, height: read.height, data };
}
/** One channel of a picture (a roughness, a metal, an occlusion map: grey). */
const grey = (image) => ({ width: image.width, height: image.height, data: image.data.filter((_, i) => i % 3 === 0) }); // prettier-ignore
const bytesOf = (image) => {
  const channels = image.data.length / (image.width * image.height);
  const rgba = new Uint8Array(image.width * image.height * 4);
  for (let i = 0; i < image.width * image.height; i++) for (let c = 0; c < 4; c++) rgba[i * 4 + c] = c === 3 ? 255 : Math.round(image.data[i * channels + (channels === 1 ? 0 : c)]); // prettier-ignore
  return { width: image.width, height: image.height, rgba };
};

/** The weights of a box filter along one side: for each of `n` out, the source's texels it covers and how much. */
function boxWeights(size, n, from, to) {
  const step = ((to - from) * size) / n;
  return Array.from({ length: n }, (_, k) => {
    const [a, b] = [from * size + k * step, from * size + (k + 1) * step];
    const list = [];
    for (let i = Math.floor(a); i < Math.ceil(b); i++) list.push([((i % size) + size) % size, (Math.min(b, i + 1) - Math.max(a, i)) / step]); // prettier-ignore
    return list;
  });
}
/** A picture at w x h, each texel the mean of the area of the source it covers (`part`: [x0, y0, x1, y1] of 0..1), wrapping. */
export function resample(image, w, h, part = [0, 0, 1, 1]) {
  const ch = image.data.length / (image.width * image.height);
  const [across, down] = [boxWeights(image.width, w, part[0], part[2]), boxWeights(image.height, h, part[1], part[3])]; // prettier-ignore
  const rows = new Float32Array(w * image.height * ch);
  for (let y = 0; y < image.height; y++)
    across.forEach((list, x) => { for (const [i, k] of list) for (let c = 0; c < ch; c++) rows[(y * w + x) * ch + c] += image.data[(y * image.width + i) * ch + c] * k; }); // prettier-ignore
  const data = new Float32Array(w * h * ch);
  down.forEach((list, y) => { for (const [j, k] of list) for (let x = 0; x < w * ch; x++) data[y * w * ch + x] += rows[j * w * ch + x] * k; }); // prettier-ignore
  return { width: w, height: h, data };
}

/**
 * The seam of a tile, each way: the step across its wrap (the mean difference between the last row and the first)
 * against the steps inside, the larger of their mean and of the four boundaries next to the wrap (a plate's groove
 * that lies on the edge steps there as much on both sides of it, a seam only across it): { across, down, worst }.
 */
export function seamOf({ width: w, height: h, data }) {
  const ratio = (n, m, at) => {
    const step = (a, b) => { let s = 0; for (let k = 0; k < m; k++) for (let c = 0; c < 3; c++) s += Math.abs(data[at(a, k) + c] - data[at(b, k) + c]); return s / (m * 3); }; // prettier-ignore
    const inside = Array.from({ length: n - 1 }, (_, i) => step(i, i + 1));
    const near = (inside[n - 3] + inside[n - 2] + inside[0] + inside[1]) / 4;
    return step(n - 1, 0) / (Math.max(inside.reduce((a, b) => a + b, 0) / (n - 1), near) || 1);
  };
  const across = ratio(w, h, (x, y) => (y * w + x) * 3);
  const down = ratio(h, w, (y, x) => (y * w + x) * 3);
  return { across: +across.toFixed(2), down: +down.toFixed(2), worst: +Math.max(across, down).toFixed(2) };
}
/** A picture made to tile: blended, near its edges, with itself shifted half a tile each way (whose seams are in the middle, where the picture is its own). */
export function mendSeams({ width: w, height: h, data }, band = 0.25) {
  const out = new Float32Array(data.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const edge = Math.min(Math.min(x + 0.5, w - x - 0.5) / (w * band), Math.min(y + 0.5, h - y - 0.5) / (h * band), 1); // prettier-ignore
      const k = edge * edge * (3 - 2 * edge);
      const [i, j] = [(y * w + x) * 3, (((y + h / 2) % h) * w + ((x + w / 2) % w)) * 3];
      for (let c = 0; c < 3; c++) out[i + c] = data[i + c] * k + data[j + c] * (1 - k);
    }
  return { width: w, height: h, data: out };
}

/**
 * How much a tile shouts its repeat: the spread (standard deviation over the mean) of the brightness of its 16
 * blocks, 4 a side. Measured 2026-11-14 on 17 sets at 256, tiled 3 x 3 and looked at: Poly Haven rust_coarse_01
 * (0.12) and rusty_metal_04 (0.21) show a grid of blotches, blue_metal_plate (0.09) a faint one, the others (0.001 to
 * 0.05) none; the mess hall's own 18 textures 0.006 to 0.14. Over REPEAT_BOUND, a WARN.
 */
export const REPEAT_BOUND = 0.08;
export function repeatOf({ width: w, height: h, data }) {
  const blocks = Array.from({ length: 16 }, (_, b) => {
    let sum = 0;
    for (let y = ((b >> 2) * h) / 4; y < (((b >> 2) + 1) * h) / 4; y++) for (let x = ((b & 3) * w) / 4; x < (((b & 3) + 1) * w) / 4; x++) for (let c = 0; c < 3; c++) sum += LUMA[c] * data[(y * w + x) * 3 + c]; // prettier-ignore
    return sum / ((w * h) / 16);
  });
  const mean = blocks.reduce((a, b) => a + b, 0) / 16;
  return +(Math.sqrt(blocks.reduce((a, b) => a + (b - mean) ** 2, 0) / 16) / (mean || 1)).toFixed(3);
}
/** The light's variation larger than an eighth of the tile taken out (each texel over a wide blur of the brightness, wrapping), its colour and fine grain kept: what shouts the repeat. */
export function evened({ width: w, height: h, data }) {
  let blur = Float32Array.from({ length: w * h }, (_, i) => LUMA.reduce((s, l, c) => s + l * data[i * 3 + c], 0));
  const r = Math.max(1, Math.round(w / 16));
  for (let pass = 0; pass < 6; pass++) {
    const out = new Float32Array(w * h);
    const along = pass % 2 === 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let k = -r; k <= r; k++) s += along ? blur[y * w + ((x + k + w) % w)] : blur[((y + k + h) % h) * w + x]; out[y * w + x] = s / (2 * r + 1); } // prettier-ignore
    blur = out;
  }
  const mean = blur.reduce((a, b) => a + b, 0) / (w * h);
  return { width: w, height: h, data: data.map((v, i) => Math.min(255, (v * mean) / (blur[Math.floor(i / 3)] || 1))) };
}
/** The colour of a picture moved towards `tone` (r, g, b) by `amount` (1: its mean is the tone), its light and dark kept. */
function toned(image, [r, g, b, amount = 1]) {
  const mean = [0, 1, 2].map((c) => image.data.reduce((s, v, i) => (i % 3 === c ? s + v : s), 0) / (image.width * image.height)); // prettier-ignore
  const k = [r, g, b].map((t, c) => (t / (mean[c] || 1)) ** amount);
  return { ...image, data: image.data.map((v, i) => Math.min(255, v * k[i % 3])) };
}

/**
 * 256 colours by the kit's median cut (core/image.mjs `indexed`, as writeWad cuts a picture), each texel the
 * nearest; with `dither`, the error carried to the next texels (Floyd and Steinberg, wrapping, so the tile still
 * tiles). `error`: the distance in r g b from the true colour, per texel (mean, worst) and over 4 x 4 blocks (what
 * is seen from afar, where banding shows): { pixels, palette, error }.
 */
export function quantise(image, { dither = false } = {}) {
  const { width: w, height: h } = image;
  const rgb = Uint8Array.from(image.data, (v) => Math.round(v));
  const { palette } = indexed({ width: w, height: h, rgb }, "q");
  const pixels = new Uint8Array(w * h);
  const work = Float32Array.from(image.data);
  const nearest = (r, g, b) => { let [best, least] = [0, Infinity]; for (let k = 0; k < 256; k++) { const d = (palette[k * 3] - r) ** 2 + (palette[k * 3 + 1] - g) ** 2 + (palette[k * 3 + 2] - b) ** 2; if (d < least) [best, least] = [k, d]; } return best; }; // prettier-ignore
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const k = (pixels[i] = nearest(work[i * 3], work[i * 3 + 1], work[i * 3 + 2]));
      if (!dither) continue;
      for (let c = 0; c < 3; c++) {
        const e = work[i * 3 + c] - palette[k * 3 + c];
        for (const [dx, dy, f] of [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]]) work[(((y + dy) % h) * w + ((x + dx + w) % w)) * 3 + c] += (e * f) / 16; // prettier-ignore
      }
    }
  return { pixels, palette, error: errorOf(image, pixels, palette) };
}
/** The distance in r g b of each texel's palette colour from its true colour, mean and worst, and over 4 x 4 blocks; a hole (index 255 of a mask) left out. */
function errorOf(image, pixels, palette, hole = -1) {
  const { width: w, height: h } = image;
  let [sum, worst, count, blocks, n] = [0, 0, 0, 0, 0];
  for (let i = 0; i < w * h; i++) {
    if (pixels[i] === hole) continue;
    const d = Math.hypot(...[0, 1, 2].map((c) => image.data[i * 3 + c] - palette[pixels[i] * 3 + c]));
    [sum, worst, count] = [sum + d, Math.max(worst, d), count + 1];
  }
  for (let y = 0; y < h; y += 4)
    for (let x = 0; x < w; x += 4, n++) {
      const diff = [0, 0, 0];
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) for (let c = 0; c < 3; c++) if (pixels[(y + j) * w + x + i] !== hole) diff[c] += image.data[((y + j) * w + x + i) * 3 + c] - palette[pixels[(y + j) * w + x + i] * 3 + c]; // prettier-ignore
      blocks += Math.hypot(...diff) / 16;
    }
  return { mean: +(sum / (count || 1)).toFixed(2), worst: +worst.toFixed(1), afar: +(blocks / n).toFixed(2) };
}
const brightnessOf = ({ pixels, palette }) => pixels.reduce((s, k) => s + LUMA.reduce((t, l, c) => t + l * palette[k * 3 + c], 0), 0) / pixels.length; // prettier-ignore

/**
 * A material from a downloaded set (libraries.mjs downloadSet): { texture, layers, report, warnings, errors, json, lines }.
 *   name      the texture's name (15 letters; `{` a mask from the set's opacity map)
 *   size      [w, h], multiples of 16
 *   tone      [r, g, b, amount]: shifted towards it (its own colour unless asked)
 *   part      [x0, y0, x1, y1] of 0..1: a part of the picture (it no longer tiles: mended)
 *   marks     the text of `--marks` (marks.mjs), laid on the texture and on the set's colour, normal and roughness
 *   metres    the real size a tile covers, when the library does not say or is to be overridden
 *   dither    carry the palette's error on (off unless asked: measured, README.md)
 *   even      take out the light's variation larger than an eighth of the tile (evened), when it shouts its repeat
 */
export function makeMaterial(set, { name, size, tone, part, marks, metres, dither = false, even = false } = {}) {
  const [warnings, errors, lines] = [[], [], []];
  const [w, h] = size;
  if (!name || name.length > maps.LONGEST_NAME) throw new Error(`--name: a texture's name, ${maps.LONGEST_NAME} letters at the most, not ${JSON.stringify(name)}`); // prettier-ignore
  if (!(w % 16 === 0 && h % 16 === 0 && w >= 16 && h >= 16)) throw new Error(`--size: both sides multiples of 16, not ${w}x${h}`); // prettier-ignore
  const read = (key) => set.files[key] && readPicture(readFileSync(set.files[key]));
  const layers = { color: read("color"), normal: read("normal"), roughness: read("roughness") && grey(read("roughness")) }; // prettier-ignore
  const others = { metalness: read("metalness") && grey(read("metalness")), occlusion: read("occlusion") && grey(read("occlusion")) }; // prettier-ignore
  if (set.normalFrom === "directx" && layers.normal) for (let i = 1; i < layers.normal.data.length; i += 3) layers.normal.data[i] = 255 - layers.normal.data[i]; // prettier-ignore
  const sourceSeam = seamOf(resample(layers.color, w, h));
  let picture = resample(layers.color, w, h, part ?? [0, 0, 1, 1]);
  const before = seamOf(picture);
  const mended = !!part || before.worst > SEAM_BOUND;
  if (mended) picture = mendSeams(picture);
  const after = seamOf(picture);
  const repeat = { before: repeatOf(picture) };
  if (even) picture = evened(picture);
  repeat.after = repeatOf(picture);
  if (tone) picture = toned(picture, tone);
  const laid = marks ? parseMarks(marks) : [];
  if (laid.length) layMarks({ color: picture }, laid, { width: w, height: h });
  if (laid.length) layMarks(layers, laid, { width: w, height: h });
  let texture;
  const holes = maps.hasHoles(name);
  if (holes) {
    if (!set.files.opacity) throw new Error(`${name} begins with { (a texture with holes), and ${set.source}:${set.id} has no opacity map`); // prettier-ignore
    const alpha = resample(grey(readPicture(readFileSync(set.files.opacity))), w, h, part ?? [0, 0, 1, 1]);
    const rgba = bytesOf(picture).rgba;
    for (let i = 0; i < w * h; i++) rgba[i * 4 + 3] = alpha.data[i] < 128 ? 0 : 255;
    texture = maps.mapTexture({ name, image: { width: w, height: h, rgba } });
    texture.error = errorOf(picture, texture.pixels, texture.palette, maps.HOLE);
  } else {
    const q = quantise(picture, { dither });
    texture = { name, width: w, height: h, pixels: q.pixels, palette: q.palette, error: q.error };
  }
  const brightness = +brightnessOf(texture).toFixed(1);
  const tileMetres = metres ? [metres, (metres * h) / w] : set.metres;
  const scale = tileMetres ? +((tileMetres[0] * UNITS_A_METRE) / w).toFixed(3) : null;
  const B = VALVE_BRIGHTNESS;
  if (after.worst > SEAM_FAIL) errors.push(`the tile's seam is ${after.worst} times the steps inside it${mended ? " after mending" : ""} (${SEAM_FAIL} at most): it shows as a line`); // prettier-ignore
  else if (after.worst > SEAM_BOUND) warnings.push(`the tile's seam is ${after.worst} times the steps inside it${mended ? " after mending" : ""}, over ${SEAM_BOUND}: look at the 3 x 3 for a line at the joins (a groove on the edge measures so too)`); // prettier-ignore
  if (mended) warnings.push(`the ${part ? "part taken" : "source"} does not tile (its seam ${before.worst}${part ? "; a part never does" : `, over ${SEAM_BOUND}`}): mended to ${after.worst} by blending its edges with itself shifted half a tile, which can ghost a little near them`); // prettier-ignore
  if (brightness < B.least) warnings.push(`its mean brightness is ${brightness}, under ${B.least}, Valve's 5th (${B.source}): GoldSrc draws texture times light, and it stays near black in any light; --tone lifts it`); // prettier-ignore
  if (brightness > B.most) warnings.push(`its mean brightness is ${brightness}, over ${B.most}, Valve's 95th (${B.source}): it washes out under a bright light; --tone takes it down`); // prettier-ignore
  if (repeat.after > REPEAT_BOUND) warnings.push(`it shouts its repeat: the brightness of its 16 blocks spreads ${repeat.after} of their mean, over ${REPEAT_BOUND} (rust_coarse_01's 0.12 shows a grid of blotches tiled 3 x 3)${even ? "" : "; --even takes the large light out, or --part a calmer piece, or another material"}`); // prettier-ignore
  if (/procedural/.test(set.made ?? "")) warnings.push(`${set.source}:${set.id} was drawn by a program (${set.made}), not photographed: the owner turned down textures drawn by procedure ("AI textures", the race bench, d4dbbd9); search prints how each was made`); // prettier-ignore
  if (!layers.normal) warnings.push(`${set.source}:${set.id} has no normal map: the set has no relief for an engine that lights it`); // prettier-ignore
  if (!layers.roughness) warnings.push(`${set.source}:${set.id} has no roughness map`);
  lines.push(
    `${set.name} (${set.source}:${set.id}), ${set.url}: CC0 1.0`,
    `source ${layers.color.width}x${layers.color.height}, its seam ${sourceSeam.worst} (1 is no seam)${part ? `; part ${part.join(",")}: seam ${before.worst}` : ""}${mended ? `, mended to ${after.worst}` : ""}`, // prettier-ignore
    `texture ${name} ${w}x${h}, 256 colours${dither ? ", dithered" : ""}: palette error per texel mean ${texture.error.mean}, worst ${texture.error.worst}; over 4x4 blocks ${texture.error.afar}`, // prettier-ignore
    `repeat ${repeat.after}${even ? ` (evened from ${repeat.before})` : ""}: the spread of its blocks' brightness (${REPEAT_BOUND} at most)`,
    `brightness ${brightness} (Valve's: ${B.least} to ${B.most}, median ${B.median}; ${B.source})`,
    tileMetres ? `a tile covers ${tileMetres.map((m) => m.toFixed(2)).join(" x ")} m: on a face, scale ${scale} (units a texel) shows it at its real size; GoldSrc lights in 16 texels, so that is ${(1 / scale ** 2).toFixed(1)} times the light samples of scale 1` : "the library gives no real size: --metres <m> says it; scale 1 draws a texel a unit", // prettier-ignore
    `the set (OpenGL normal, +Y up, glTF's): ${Object.keys({ ...layers, ...others }).filter((k) => ({ ...layers, ...others })[k]).join(", ")}${set.normalFrom === "directx" ? "; the normal came as DirectX's and was turned (green inverted)" : ""}`, // prettier-ignore
    ...(laid.length ? [`marks: ${laid.map((m) => m.kind).join(", ")}, on the texture and the set's colour, normal and roughness alike`] : []), // prettier-ignore
  );
  const json = { source: set.source, id: set.id, name: set.name, url: set.url, licence: "CC0 1.0 Universal", tileMetres: tileMetres ?? null, scale, texture: { name, width: w, height: h, brightness, seam: after.worst, palette: texture.error }, maps: Object.keys({ ...layers, ...others }).filter((k) => ({ ...layers, ...others })[k]), normal: { from: set.normalFrom, written: "opengl (+Y up, glTF)" }, tone: tone ?? null, part: part ?? null, even, marks: marks ?? null }; // prettier-ignore
  return { texture, picture, layers: { ...layers, ...others }, report: { seam: { source: sourceSeam.worst, before: before.worst, after: after.worst, mended }, repeat, brightness, scale, tileMetres }, warnings, errors, lines, json }; // prettier-ignore
}

/** <name>.png, <name>.set/ (color, normal, roughness, metalness, occlusion .png and material.json) and <name>.credit.txt into `folder`. */
export function writeMaterial(made, folder, set, { date = new Date().toISOString().slice(0, 10) } = {}) {
  const name = made.texture.name;
  const setFolder = join(folder, `${name}.set`);
  mkdirSync(setFolder, { recursive: true });
  const rgba = maps.textureRgba({ ...made.texture, holes: maps.hasHoles(name) });
  writeFileSync(join(folder, `${name}.png`), png(made.texture.width, made.texture.height, rgba.rgba));
  for (const [key, layer] of Object.entries(made.layers)) if (layer) { const b = bytesOf(layer); writeFileSync(join(setFolder, `${key}.png`), png(b.width, b.height, b.rgba)); } // prettier-ignore
  writeFileSync(join(setFolder, "material.json"), `${JSON.stringify({ ...made.json, made: date }, null, 2)}\n`);
  const authors = Object.entries(set.authors ?? {}).map(([who, did]) => `${who} (${did})`).join(", ");
  writeFileSync(join(folder, `${name}.credit.txt`), [
    `${name}: ${set.name}, ${set.source === "ambientcg" ? "ambientCG" : "Poly Haven"} material ${set.id}`,
    `URL: ${set.url}`,
    ...(authors ? [`Authors: ${authors}`] : []),
    `Licence: CC0 1.0 Universal (public domain): no attribution is required; this credit is given gladly.`,
    set.source === "ambientcg" ? `Created using ${set.name} from ambientCG.com, licensed under the Creative Commons CC0 1.0 Universal License.` : "Downloaded through the Poly Haven API (Powered by Poly Haven).", // prettier-ignore
    `Downloaded ${date}; made a GoldSrc texture (${made.texture.width}x${made.texture.height}, 256 colours) and its set kept at 1K by SMAK's materials pack.`, // prettier-ignore
    "",
  ].join("\n")); // prettier-ignore
  return [join(folder, `${name}.png`), setFolder, join(folder, `${name}.credit.txt`)];
}

/** A PNG of at most 256 colours as a texture, colour for colour (none merged); `null` when it has more. */
function exactIndexed(name, { width, height, rgba }) {
  const [palette, index, pixels] = [new Uint8Array(768), new Map(), new Uint8Array(width * height)];
  for (let i = 0; i < width * height; i++) {
    const key = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];
    if (!index.has(key)) { if (index.size === 256) return null; palette.set([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]], index.size * 3); index.set(key, index.size); } // prettier-ignore
    pixels[i] = index.get(key);
  }
  return { name, width, height, pixels, palette };
}
/** Every <name>.png of `folder` (not those in a .set) as one .wad, through the kit's writeWad, and checkWad's answer for goldsrc. */
export function wadOfFolder(folder) {
  const files = readdirSync(folder).filter((f) => /\.png$/i.test(f) && !/\.sheet\.png$/i.test(f)).sort();
  if (!files.length) throw new Error(`${folder} has no <texture>.png: make one with \`material\``);
  const textures = files.map((file) => {
    const name = file.replace(/\.png$/i, "");
    const image = unpng(readFileSync(join(folder, file)));
    return (!maps.hasHoles(name) && exactIndexed(name, image)) || { name, image: maps.hasHoles(name) ? image : { width: image.width, height: image.height, rgb: image.rgba.filter((_, i) => i % 4 !== 3) } }; // prettier-ignore
  });
  const bytes = maps.writeWad(textures);
  return { bytes, textures: textures.map((t) => ({ name: t.name, width: t.width ?? t.image.width, height: t.height ?? t.image.height })), check: maps.checkWad(bytes, "goldsrc") }; // prettier-ignore
}

/** A picture at `side` x `side`: `image` ({ width, height, rgba }) tiled at `perPixel` of its texels a pixel, averaged as the game's mips would; a hole dark. */
function tiled(image, side, perPixel) {
  const out = new Uint8Array(side * side * 4);
  const k = Math.max(1, Math.min(4, Math.ceil(perPixel)));
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const sum = [0, 0, 0];
      for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) { const [u, v] = [Math.floor((x + (i + 0.5) / k) * perPixel) % image.width, Math.floor((y + (j + 0.5) / k) * perPixel) % image.height]; const at = (v * image.width + u) * 4; for (let c = 0; c < 3; c++) sum[c] += image.rgba[at + 3] < 128 ? 22 : image.rgba[at + c]; } // prettier-ignore
      out.set([...sum.map((s) => s / (k * k)), 255], (y * side + x) * 4);
    }
  return { width: side, height: side, rgba: out };
}
/** A player 72 units high (Half-Life's standing hull), in outline, its feet on the bottom of a picture `pxUnit` pixels a unit. */
function figure(picture, pxUnit, left) {
  const parts = [[-4, 64, 4, 72], [-8, 36, 8, 63], [-11, 40, -8, 62], [8, 40, 11, 62], [-7, 0, -1, 36], [1, 0, 7, 36]]; // prettier-ignore
  const inside = (x, y) => parts.some(([a, b, c, d]) => x >= a && x <= c && y >= b && y <= d);
  for (let y = 0; y < picture.height; y++)
    for (let x = 0; x < picture.width; x++) {
      const [ux, uy] = [(x - left) / pxUnit, (picture.height - 1 - y) / pxUnit];
      if (!inside(ux, uy)) continue;
      const edge = !inside(ux - 1.5 / pxUnit, uy) || !inside(ux + 1.5 / pxUnit, uy) || !inside(ux, uy + 1.5 / pxUnit) || !inside(ux, uy - 1.5 / pxUnit); // prettier-ignore
      if (edge) picture.rgba.set([255, 200, 40, 255], (y * picture.width + x) * 4);
    }
  return picture;
}
/**
 * The proof of a material: the source's colour map | the texture 3 x 3 | on a wall `wall` units wide at `scale`
 * units a texel beside a player 72 high | `against` (another texture, { rgba, width, height, scale, name }) on the
 * same wall. `side`: a panel's pixels.
 */
export function wallSheet({ source, texture, scale, against, wall = 512, side = 512, name }) {
  const src = bytesOf(resample(source, side, side));
  const tex = { width: texture.width, height: texture.height, rgba: maps.textureRgba({ ...texture, holes: maps.hasHoles(name) }).rgba }; // prettier-ignore
  const panels = [src, tiled(tex, side, (3 * tex.width) / side)];
  const names = [`source ${source.width}x${source.height}`, `${name} ${tex.width}x${tex.height}, 3 x 3`];
  for (const [t, s, label] of [[tex, scale ?? 1, `${name} at scale ${scale ?? 1}`], ...(against ? [[against, against.scale ?? 1, `now: ${against.name} ${against.width}x${against.height} at scale ${against.scale ?? 1}`]] : [])]) { // prettier-ignore
    panels.push(figure(tiled(t, side, wall / side / s), side / wall, side * 0.08));
    names.push(`${label}, a wall ${wall} wide, a player 72`);
  }
  return tile(panels, 2, names);
}
