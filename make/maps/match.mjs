// Which texture of a .wad a picture shows: a patch of a view of a map (a wall, a floor) set against every
// texture of a .wad by its colours, with the brightness divided out: a map's light scales a texture's colours
// (more on a lit wall, less in a corner), and what stays is the share of its pixels in each colour against the
// patch's own mean. The nearest by that histogram (the Bhattacharyya distance) come first. It ranks candidates
// for a person or an agent to look at, not a verdict: drawn beside the patch, they say which is right.
//
// Measured on Half-Life's frenzy (each of its 25 textures, a patch of its largest lit face's view, against all
// 3116 of halflife.wad): the true texture first for 5, among the first 8 for 9. A face under a coloured lamp
// (frenzy's blue-lit ones), a lamp's face washed white and a texture smaller than the patch are not found.
//
//   matchTextures(picture, rect, textures, { count }) -> [{ name, width, height, distance }]

/** Bins a channel, and how far over the mean brightness the last bin reaches. */
const BINS = 6;
const REACH = 2.2;
/** Textures that are never seen as a picture. */
const TOOLS = /^(sky|clip|aaatrigger|null|origin|hint|skip|bevel)$/i;

/** The histogram of `n` colours (each [r, g, b] 0 to 1, from `colourAt(i)`), the mean brightness divided out. */
function histogramOf(colourAt, n) {
  const colours = [];
  let mean = 0;
  for (let i = 0; i < n; i++) {
    const c = colourAt(i);
    colours.push(c);
    mean += 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  }
  mean = Math.max(mean / n, 1e-3);
  const h = new Float32Array(BINS * BINS * BINS);
  for (const c of colours) {
    const [r, g, b] = c.map((v) => Math.min(BINS - 1, Math.floor(((v / mean) * BINS) / REACH)));
    h[(r * BINS + g) * BINS + b] += 1 / n;
  }
  return h;
}

/** How unlike two histograms are, 0 (the same) to 1. */
function bhattacharyya(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.sqrt(a[i] * b[i]);
  return 1 - s;
}

/** Each texture's histogram, kept by the texture object: a .wad of thousands is asked about again and again. */
const kept = new WeakMap();
function textureHistogram(t) {
  if (!kept.has(t))
    kept.set(
      t,
      histogramOf((i) => {
        const p = t.pixels[i] * 3;
        return [t.palette[p] / 255, t.palette[p + 1] / 255, t.palette[p + 2] / 255];
      }, t.width * t.height),
    );
  return kept.get(t);
}

/**
 * The textures of `textures` (a .wad's, `readWad(...).textures`) most like the patch `rect` ([x, y, w, h]) of
 * `picture` ({ width, height, rgba }), nearest first: `{ name, width, height, distance }`.
 */
export function matchTextures(picture, rect, textures, { count = 12 } = {}) {
  const [x0, y0, w, h] = rect.map(Math.round);
  if (w < 4 || h < 4 || x0 < 0 || y0 < 0 || x0 + w > picture.width || y0 + h > picture.height)
    throw new Error(`matchTextures: the patch [${rect.join(", ")}] is not inside the picture's ${picture.width}x${picture.height}, or is under 4 dots a side`);
  const patch = histogramOf((i) => {
    const j = ((y0 + Math.floor(i / w)) * picture.width + x0 + (i % w)) * 4;
    return [picture.rgba[j] / 255, picture.rgba[j + 1] / 255, picture.rgba[j + 2] / 255];
  }, w * h);
  return textures
    .filter((t) => !TOOLS.test(t.name))
    .map((t) => ({ name: t.name, width: t.width, height: t.height, distance: Math.round(bhattacharyya(patch, textureHistogram(t)) * 1000) / 1000 }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count);
}
