// A picture's light and colour in numbers a person reads (lookOf), and a map's view said against the reference it is
// built from (lookAgainst, lookSheet; smak map-look): how bright, how much near black and near white, the contrast
// between its dark and bright regions, how much is coloured and in which colours, warm against cool. Facts with the
// reference beside them, never a gate: a style is the person's (ARCHITECTURE.md, a style band is a FACT). Contrast,
// colour and warmth are ratios, so a darker copy of a picture differs from it in brightness alone.
import { unpng } from "../../core/image.mjs";
import { unjpeg } from "../../core/jpeg.mjs";
import { label, tile } from "../../make/render.mjs";

/** Near black under this luma (0 to 1), near white over NEAR_WHITE: a tenth from each end. */
const NEAR_BLACK = 0.1;
const NEAR_WHITE = 0.9;
/** Coloured: a pixel brighter than near black whose channels spread a quarter of its brightest or more (HSV's S). */
const SATURATED = 0.25;
/** Contrast is taken over regions: the picture cut into this many columns, and rows to keep them square. */
const REGIONS = 16;
/** Hue names by the degree each ends at. */
const HUES = [["red", 15], ["orange", 45], ["yellow", 70], ["green", 160], ["teal", 200], ["blue", 255], ["purple", 290], ["pink", 340], ["red", 360]]; // prettier-ignore
/**
 * A gap under these is said "close": just over the most the light bench's two lightings differ by from four matching
 * cameras (brightness 0.05, contrast 0.12, coloured 0.17, a hue 0.17, warmth 0.09; 2026-11-14), which the owner
 * called "both fine, little difference". Near black is no gap of its own: it moved 15 to 20 points on that bench
 * (its floors sit at the line). The kit's view against the game's screenshot was not measured: a gap near these may
 * be the renderer's (docs/MAPS-LOOKING.md, "A view against its reference").
 */
export const LOOK_CLOSE = { brightness: 0.06, contrast: 0.13, coloured: 0.18, colour: 0.18, warmth: 0.1 };

/** A PNG or JPEG file's picture as `{ width, height, rgba }`. */
export function pictureOf(bytes) {
  if (bytes[0] !== 0xff) return unpng(bytes);
  const { width, height, rgb } = unjpeg(bytes);
  const rgba = new Uint8Array(width * height * 4).fill(255);
  for (let i = 0; i < width * height; i++) rgba.set(rgb.subarray(i * 3, i * 3 + 3), i * 4);
  return { width, height, rgba };
}

/**
 * Pictures of any sizes in one sheet, `cols` to a row, each fitted whole into a cell of `width` x `height` (averaged
 * where it shrinks, dark bars where its shape is not the cell's), its name in its corner. An item is a picture
 * (`{ width, height, rgba }`, or a PNG's or a JPEG's bytes), null (a dark cell: no reference, no build before), or
 * `{ picture, crop: [x0, y0, x1, y1] (a piece of it, in its pixels), over (an item laid over it), opacity (0.5: how
 * much of `over` shows), name }`. One item with `over` and `cols: 1` is a view under its reference: a camera fitted.
 */
export function pictureSheet(items, { cols = 3, width = 480, height = 270 } = {}) {
  const fit = (item) => {
    const { picture = item, crop } = item?.picture !== undefined ? item : {};
    const im = picture instanceof Uint8Array ? pictureOf(picture) : picture;
    const rgba = new Uint8Array(width * height * 4);
    const [x0, y0, x1, y1] = crop ?? [0, 0, im?.width ?? width, im?.height ?? height];
    const k = Math.min(width / (x1 - x0), height / (y1 - y0));
    const [ox, oy, n] = [(width - (x1 - x0) * k) / 2, (height - (y1 - y0) * k) / 2, Math.max(1, Math.round(1 / k))];
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const [fx, fy] = [x0 + (x - ox) / k, y0 + (y - oy) / k];
        const inside = im && fx >= x0 && fx < x1 && fy >= y0 && fy < y1;
        const colour = inside ? [0, 0, 0, 255] : [24, 24, 28, 255];
        for (let j = 0; inside && j < n; j++)
          for (let i = 0; i < n; i++) {
            const at = (Math.min(im.height - 1, Math.floor(fy + j / k / n)) * im.width + Math.min(im.width - 1, Math.floor(fx + i / k / n))) * 4;
            for (let c = 0; c < 3; c++) colour[c] += im.rgba[at + c] / (n * n);
          }
        rgba.set(colour, (y * width + x) * 4);
      }
    return rgba;
  };
  const tiles = items.map((item) => {
    const rgba = fit(item);
    const [top, share] = [item?.over === undefined ? null : fit(item.over), item?.opacity ?? 0.5];
    for (let i = 0; top && i < rgba.length; i++) if (i % 4 !== 3) rgba[i] = rgba[i] * (1 - share) + top[i] * share;
    return { width, height, rgba };
  });
  return tile(tiles, Math.min(cols, tiles.length), items.map((item) => item?.name)); // prettier-ignore
}

const hueOf = (r, g, b, most, spread) =>
  ((most === r ? (g - b) / spread + 6 : most === g ? (b - r) / spread + 2 : (r - g) / spread + 4) % 6) * 60;
const round = (v, places = 2) => Math.round(v * 10 ** places) / 10 ** places;

/**
 * What a picture is in light and colour: `{ pixels, brightness, black, white, contrast, coloured, warmth, colours,
 * palette }`. brightness: the mean luma, 0 to 1; black, white: the share near each; contrast: (p90 - p10) / (p90 +
 * p10) of the regions' mean luma, 0 evenly lit to 1 pools of light in the dark; coloured: the share that is not grey;
 * warmth: (red - blue) / (red + blue) over the picture, + warm, - cool; colours: each name's share (black, grey,
 * white, red ... pink); palette: the five largest with their mean colour. `ignore`: boxes [x0, y0, x1, y1] in pixels
 * left out (a HUD, a caption).
 */
export function lookOf({ width, height, rgba }, { ignore = [] } = {}) {
  const rows = Math.max(1, Math.round((REGIONS * height) / width));
  const regions = Array.from({ length: REGIONS * rows }, () => [0, 0]);
  const names = {};
  let [n, sum, black, white, coloured, red, blue] = [0, 0, 0, 0, 0, 0, 0];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (ignore.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1)) continue;
      const i = (y * width + x) * 4;
      const [r, g, b] = [rgba[i] / 255, rgba[i + 1] / 255, rgba[i + 2] / 255];
      const luma = 0.3 * r + 0.59 * g + 0.11 * b;
      const most = Math.max(r, g, b);
      const spread = most - Math.min(r, g, b);
      const tinted = most >= NEAR_BLACK && spread >= SATURATED * most;
      const region = regions[Math.floor((y * rows) / height) * REGIONS + Math.floor((x * REGIONS) / width)];
      [n, sum, black, white, coloured, red, blue] = [n + 1, sum + luma, black + (luma < NEAR_BLACK), white + (luma > NEAR_WHITE), coloured + tinted, red + r, blue + b]; // prettier-ignore
      region[0] += luma;
      region[1]++;
      const hue = tinted && hueOf(r, g, b, most, spread);
      const name = tinted ? HUES.find(([, end]) => hue < end)[0] : luma < NEAR_BLACK ? "black" : luma > NEAR_WHITE ? "white" : "grey"; // prettier-ignore
      const kept = (names[name] ??= [0, 0, 0, 0]);
      [kept[0], kept[1], kept[2], kept[3]] = [kept[0] + 1, kept[1] + r, kept[2] + g, kept[3] + b];
    }
  if (!n) throw new Error("lookOf: every pixel is ignored");
  const full = (width / REGIONS) * (height / rows);
  const means = regions.filter(([, count]) => count >= full / 2).map(([total, count]) => total / count).sort((a, b) => a - b); // prettier-ignore
  const [low, high] = [means[Math.floor(means.length * 0.1)] ?? 0, means[Math.ceil(means.length * 0.9) - 1] ?? 0];
  const colours = Object.fromEntries(Object.entries(names).map(([name, [count]]) => [name, round(count / n, 3)]));
  const palette = Object.entries(names).sort((a, b) => b[1][0] - a[1][0]).slice(0, 5).map(([name, [count, r, g, b]]) => ({ name, share: round(count / n, 3), rgb: [r, g, b].map((v) => Math.round((v / count) * 255)) })); // prettier-ignore
  return {
    pixels: n,
    brightness: round(sum / n),
    black: round(black / n, 3),
    white: round(white / n, 3),
    contrast: round(high + low > 0 ? (high - low) / (high + low) : 0),
    coloured: round(coloured / n, 3),
    warmth: round(red + blue > 0 ? (red - blue) / (red + blue) : 0),
    colours,
    palette,
  };
}

const pct = (v) => `${Math.round(v * 100)}%`;
const signed = (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
/** Each measure's line: its name, the words for the view under and over the reference, how a picture's is shown. */
const SAID = {
  brightness: ["brightness", "darker", "brighter", (l) => `${l.brightness.toFixed(2)} (near black ${pct(l.black)}, near white ${pct(l.white)})`], // prettier-ignore
  contrast: ["contrast", "more evenly lit (fewer pools of light and dark)", "more contrasted (stronger pools of light and dark)", (l) => l.contrast.toFixed(2)], // prettier-ignore
  coloured: ["coloured", "greyer", "more coloured", (l) => pct(l.coloured)],
  warmth: ["warmth", "cooler", "warmer", (l) => signed(l.warmth)],
};
/** The hues whose shares differ most, the largest first, as words. */
function colourGaps(view, reference) {
  const hues = HUES.map(([name]) => name).filter((name, i, all) => all.indexOf(name) === i);
  return hues.map((name) => [name, (view.colours[name] ?? 0) - (reference.colours[name] ?? 0)])
    .filter(([, gap]) => Math.abs(gap) >= LOOK_CLOSE.colour).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 2) // prettier-ignore
    .map(([name, gap]) => { const [more, less] = gap > 0 ? ["view", "reference"] : ["reference", "view"]; const of = (which) => (which === "view" ? view : reference).colours[name] ?? 0; return `the ${more} is ${pct(of(more))} ${name}, the ${less} ${pct(of(less))}`; }); // prettier-ignore
}

/**
 * A view said against its reference, measure by measure: `{ said, gaps, measures: { view, reference }, failures,
 * warnings }`. `said`: one line a measure ("contrast: the view is more evenly lit ...: 0.21 against the reference's
 * 0.58"), "close" when the gap is under LOOK_CLOSE; `gaps`: the measures that are not close. Facts: no failure, no
 * warning (a style is chosen, and the instrument's own error against the game is not measured).
 */
export function lookAgainst(view, reference) {
  const said = [];
  const gaps = [];
  for (const [key, [name, less, more, shown]] of Object.entries(SAID)) {
    const gap = view[key] - reference[key];
    const close = Math.abs(gap) < LOOK_CLOSE[key];
    if (!close) gaps.push(key);
    said.push(`${name}: ${close ? "close" : `the view is ${gap < 0 ? less : more}`}: ${shown(view)} against the reference's ${shown(reference)}`); // prettier-ignore
  }
  const hues = colourGaps(view, reference);
  if (hues.length) gaps.push("colours");
  said.push(`colours: ${hues.length ? hues.join("; ") : "close"} (the view ${view.palette.map((c) => `${c.name} ${pct(c.share)}`).join(", ")}; the reference ${reference.palette.map((c) => `${c.name} ${pct(c.share)}`).join(", ")})`); // prettier-ignore
  return { said, gaps, measures: { view, reference }, failures: [], warnings: [] };
}

/** One picture's measures in two short lines, for under it. */
const summary = (look) => [
  `brightness ${look.brightness.toFixed(2)}  near black ${pct(look.black)}  near white ${pct(look.white)}  contrast ${look.contrast.toFixed(2)}`, // prettier-ignore
  `coloured ${pct(look.coloured)}  warmth ${signed(look.warmth)}  ${look.palette.map((c) => `${c.name} ${pct(c.share)}`).join(" ")}`, // prettier-ignore
];
const LINE = 16;
const BAR = 20;

/**
 * The reference and the view side by side at the view's size (the reference stretched to it; its ignored boxes
 * darkened), each one's palette as a bar and its measures under it, and the lines of `lookAgainst` under both.
 */
export function lookSheet(view, reference, { ignore = [], look = lookAgainst(lookOf(view), lookOf(reference, { ignore })) } = {}) { // prettier-ignore
  const { width: w, height: h } = view;
  const shown = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [rx, ry] = [Math.floor((x * reference.width) / w), Math.floor((y * reference.height) / h)];
      const from = (ry * reference.width + rx) * 4;
      const dim = ignore.some(([x0, y0, x1, y1]) => rx >= x0 && rx < x1 && ry >= y0 && ry < y1) ? 0.3 : 1;
      for (let c = 0; c < 3; c++) shown[(y * w + x) * 4 + c] = reference.rgba[from + c] * dim;
      shown[(y * w + x) * 4 + 3] = 255;
    }
  const top = tile([{ width: w, height: h, rgba: shown }, view], 2, ["reference", "view"]);
  const band = 3 * LINE + BAR + LINE * (look.said.length + 1);
  const out = { width: 2 * w, height: h + band, rgba: new Uint8Array(2 * w * (h + band) * 4) };
  out.rgba.set(top.rgba);
  for (let i = top.rgba.length; i < out.rgba.length; i += 4) out.rgba.set([20, 22, 26, 255], i);
  [look.measures.reference, look.measures.view].forEach((one, half) => {
    let x = half * w + 8;
    for (const { share, rgb } of one.palette) {
      const wide = Math.round(share * (w - 16));
      for (let y = h + 8; y < h + 8 + BAR; y++) for (let i = 0; i < wide; i++) out.rgba.set([...rgb, 255], (y * out.width + x + i) * 4); // prettier-ignore
      x += wide;
    }
    summary(one).forEach((text, i) => label(out, text, half * w + 8, h + BAR + LINE * (i + 1)));
  });
  look.said.forEach((text, i) => label(out, text.replace(/ \(the view .*\)$/, ""), 8, h + BAR + LINE * (i + 3.5), 2, [255, 214, 120]));
  return out;
}
