// One texture as it was before any painting, and what is known of it from there: its layers (what is mail,
// what is strap), the measure of how busy it is, and a blur that can keep to a layer. `paint` and `layersOf`
// both work on this; the steps a layer is made by (its values, its cleaning, its distances and its regions)
// are here too.
// Internal to the kit: `place.mjs` does not hand these out.
import { unit } from "../core/vec.mjs";
import { clamp, brightnessAt } from "../core/pixels.mjs";
import {
  FLAT_ON_PICTURE,
  HOLE_ALPHA,
  BARE,
  NO_ISLAND,
  NO_BORDER,
  pictureArea,
  weightOfB,
  weightOfC,
  slackOf,
  unitsAPixel,
  wrapper,
  borderAt,
  bodyNumberOf,
} from "./place-shared.mjs";

/** In a layer, a pixel of this value or more is in it. */
const IN_LAYER = 0.5;
/** `busy` measures each pixel against the mean of the square this many pixels each way about it... */
const BUSY_NEAR = 2;
/** ...as a share of that mean plus this, so that a black ground does not read as busy. */
const BUSY_FLOOR = 0.08;
/** The pixels each way that `busy` and `distSmooth` average over unless told. */
const DEFAULT_REACH = 3;
/** A blur that finds less weight than this in reach has found nothing. */
const BLUR_LEAST = 1e-4;
/**
 * How a pixel was reached by the triangles that wear the picture: by the margin of one, or lying inside one.
 */
const BY_MARGIN = 1;
const INSIDE = 2;
/** "No marked dot": farther than any two dots of a picture are from each other, squared. */
const NOWHERE = 1e20;

const round2 = (v) => +v.toFixed(2);
/** What a layer's function answered, as a number from 0 to 1 (true is 1; false, nothing or under 0 is 0). */
const answerOf = (answer) => (answer === true ? 1 : answer > 0 ? Math.min(1, answer) : 0);

// ── measures over a grid of pixels ─────────────────────────────────────────

/**
 * For every dot of a grid, how far the nearest marked one is, middle to middle, in pixels (`far` where none
 * is marked): the exact distance, in one sweep down the columns and one along the rows.
 */
function farFrom(mark, w, h, far) {
  const longest = Math.max(w, h);
  // one line of the grid at a time: `squares` in, `nearest` out (both squared distances)
  const squares = new Float64Array(longest);
  const nearest = new Float64Array(longest);
  // the parabolas that make the lower envelope of the line: where each stands, and where each begins to be
  // lowest
  const stands = new Int32Array(longest);
  const begins = new Float64Array(longest + 1);
  const columns = new Float64Array(w * h);
  const out = new Float32Array(w * h);
  const sweep = (length) => {
    let k = 0;
    stands[0] = 0;
    begins[0] = -Infinity;
    begins[1] = Infinity;
    for (let q = 1; q < length; q++) {
      let crossing;
      for (;;) {
        const p = stands[k];
        crossing = (squares[q] + q * q - squares[p] - p * p) / (2 * q - 2 * p);
        if (crossing > begins[k]) break;
        k--;
      }
      k++;
      stands[k] = q;
      begins[k] = crossing;
      begins[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < length; q++) {
      while (begins[k + 1] < q) k++;
      const p = stands[k];
      nearest[q] = (q - p) * (q - p) + squares[p];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) squares[y] = mark[y * w + x] ? 0 : NOWHERE;
    sweep(h);
    for (let y = 0; y < h; y++) columns[y * w + x] = nearest[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) squares[x] = columns[y * w + x];
    sweep(w);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.min(far, Math.sqrt(nearest[x]));
  }
  return out;
}

/**
 * The groups of marked dots that touch side to side: { id: the group's number for each dot (-1 for one not
 * marked), groups: each group's dots }, in the order their first dot comes, row by row.
 */
function groupsOf(mark, w, h) {
  const id = new Int32Array(w * h).fill(-1);
  const groups = [];
  for (let start = 0; start < w * h; start++) {
    if (!mark[start] || id[start] >= 0) continue;
    const dots = [start];
    id[start] = groups.length;
    for (let k = 0; k < dots.length; k++) {
      const i = dots[k];
      const x = i % w;
      // the four neighbours: left, right, above, below (-1 where the row ends)
      for (let side = 0; side < 4; side++) {
        const j =
          side === 0 ? (x ? i - 1 : -1) : side === 1 ? (x < w - 1 ? i + 1 : -1) : side === 2 ? i - w : i + w;
        if (j >= 0 && j < w * h && mark[j] && id[j] < 0) {
          id[j] = groups.length;
          dots.push(j);
        }
      }
    }
    groups.push(dots);
  }
  return { id, groups };
}

/** The bell a blur weighs its pixels by, kept from one call to the next. */
export function bellOf(kernels, r) {
  let bell = kernels.get(r);
  if (bell) return bell;
  const reach = Math.max(1, Math.ceil(r));
  bell = new Float32Array((2 * reach + 1) ** 2);
  for (let y = -reach; y <= reach; y++)
    for (let x = -reach; x <= reach; x++)
      bell[(y + reach) * (2 * reach + 1) + x + reach] =
        x * x + y * y > reach * reach ? 0 : Math.exp(-(x * x + y * y) / (0.5 * reach * reach));
  kernels.set(r, bell);
  return bell;
}

/**
 * A value between the middles of four pixels; with `known`, only of those that are known (worn by a
 * triangle), so that a layer does not fade towards the bare ground about an island.
 */
function readBetween(wrap, values, known, u, v) {
  const x = u - 0.5;
  const y = v - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  if (!fx && !fy) {
    const j = wrap(x0, y0);
    return known && !known[j] ? 0 : values[j];
  }
  let sum = 0;
  let weights = 0;
  for (let q = 0; q < 4; q++) {
    const weight = (q & 1 ? fx : 1 - fx) * (q & 2 ? fy : 1 - fy);
    const j = wrap(x0 + (q & 1), y0 + (q >> 1));
    if (!weight || (known && !known[j])) continue;
    sum += values[j] * weight;
    weights += weight;
  }
  return weights ? sum / weights : 0;
}

/** The mean over a square of 2r + 1 pixels, of the known ones only. */
function boxMean(values, known, r, w, h) {
  // the sum along one direction; twice, across and then down, gives the square's
  const run = (source, dx, dy) => {
    const sums = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) {
          const X = x + k * dx;
          const Y = y + k * dy;
          if (X >= 0 && X < w && Y >= 0 && Y < h) sum += source[Y * w + X];
        }
        sums[y * w + x] = sum;
      }
    return sums;
  };
  const knownValues = values.map((x, i) => (known[i] ? x : 0));
  const sums = run(run(knownValues, 1, 0), 0, 1);
  const ones = Float32Array.from(known, (k) => (k ? 1 : 0));
  const counts = run(run(ones, 1, 0), 0, 1);
  return values.map((x, i) => (counts[i] > 0 ? sums[i] / counts[i] : x));
}

/**
 * The distance to a layer's edge for every pixel: over 0 inside the layer, as far as the nearest known pixel
 * that is out of it; under 0 outside, as far as the nearest pixel in it; 0 on the line between two pixels.
 */
function signedDistance(inLayer, known, w, h) {
  const toLayer = farFrom(inLayer, w, h, w + h);
  const outside = inLayer.map((b, i) => (known[i] && !b ? 1 : 0));
  const toOutside = farFrom(outside, w, h, w + h);
  return toLayer.map((d, i) => (inLayer[i] ? toOutside[i] - 0.5 : 0.5 - d));
}

// ── which triangle wears each pixel ────────────────────────────────────────

/**
 * Which triangle each pixel takes its place from (the one it lies in, or else one it lies a pixel outside of,
 * as `paint` covers seams), its island, and the range of the body's points that wear it. Returns
 *   triangles   the list given
 *   own         for each pixel, the number of its triangle in that list (-1: none)
 *   known       0 for a pixel no triangle reaches, BY_MARGIN or INSIDE
 *   cover       the island that lies on the pixel (BARE where no triangle holds it)
 *   from        two numbers a pixel: the pixel as the triangle has it, before the picture's repeat wraps it
 *   mn, mx      three numbers a pixel: the box of the points of the body that wear it
 */
function wearOf(triangles, w, h, wrap, islandOf) {
  const size = w * h;
  const own = new Int32Array(size).fill(-1);
  const known = new Uint8Array(size);
  const cover = new Int32Array(size).fill(BARE);
  const from = new Int32Array(size * 2);
  const mn = new Float32Array(size * 3).fill(Infinity);
  const mx = new Float32Array(size * 3).fill(-Infinity);
  triangles.forEach((triangle, k) => {
    const [a, b, c] = triangle.c;
    const area = pictureArea(a, b, c);
    if (Math.abs(area) < FLAT_ON_PICTURE) return;
    const slack = slackOf(area);
    const island = islandOf(triangle)?.island ?? NO_ISLAND;
    const x0 = Math.floor(Math.min(a.u, b.u, c.u)) - 1;
    const x1 = Math.ceil(Math.max(a.u, b.u, c.u)) + 1;
    const y0 = Math.floor(Math.min(a.v, b.v, c.v)) - 1;
    const y1 = Math.ceil(Math.max(a.v, b.v, c.v)) + 1;
    for (let py = y0; py <= y1; py++)
      for (let px = x0; px <= x1; px++) {
        const u = px + 0.5;
        const v = py + 0.5;
        const wb = weightOfB(a, b, c, u, v, area);
        const wc = weightOfC(a, b, c, u, v, area);
        const wa = 1 - wb - wc;
        if (wa < -slack || wb < -slack || wc < -slack) continue;
        const inside = wa >= 0 && wb >= 0 && wc >= 0;
        const i = wrap(px, py);
        // the first triangle that holds a pixel has it; one that only reaches it by its margin gives way to
        // that
        const first = inside ? known[i] < INSIDE : !known[i];
        if (first) {
          known[i] = inside ? INSIDE : BY_MARGIN;
          own[i] = k;
          from[i * 2] = px;
          from[i * 2 + 1] = py;
          if (inside) cover[i] = island;
          for (let axis = 0; axis < 3; axis++) {
            mn[i * 3 + axis] = Infinity;
            mx[i * 3 + axis] = -Infinity;
          }
        }
        if (inside || known[i] === BY_MARGIN)
          for (let axis = 0; axis < 3; axis++) {
            const p = a.p[axis] * wa + b.p[axis] * wb + c.p[axis] * wc;
            if (p < mn[i * 3 + axis]) mn[i * 3 + axis] = p;
            if (p > mx[i * 3 + axis]) mx[i * 3 + axis] = p;
          }
      }
  });
  return { triangles, own, known, cover, from, mn, mx };
}

/**
 * For every pixel an island lies on: how far its brightness is from the mean of the pixels about it (of its
 * own island, holes left out), as a share of that mean. What `busy` averages.
 */
function busyMapOf(orig, cover, w, h, wrap, isHole) {
  const size = w * h;
  const bright = new Float32Array(size);
  for (let j = 0; j < size; j++) bright[j] = brightnessAt(orig, j * 4) / 255;
  const busy = new Float32Array(size);
  for (let j = 0; j < size; j++) {
    const island = cover[j];
    if (island === BARE || isHole(orig, j)) continue;
    const x0 = j % w;
    const y0 = (j - x0) / w;
    let sum = 0;
    let count = 0;
    for (let y = -BUSY_NEAR; y <= BUSY_NEAR; y++)
      for (let x = -BUSY_NEAR; x <= BUSY_NEAR; x++) {
        const q = wrap(x0 + x, y0 + y);
        if (cover[q] === island && !isHole(orig, q)) {
          sum += bright[q];
          count++;
        }
      }
    busy[j] = Math.abs(bright[j] - sum / count) / (sum / count + BUSY_FLOOR);
  }
  return busy;
}

// ── the steps a layer is made by ───────────────────────────────────────────

/** A layer's values from an image: its brightness (times its alpha), stretched to the texture's size. */
function valuesFromImage(image, w, h) {
  const values = new Float32Array(w * h);
  const channels = image.rgba ? 4 : 3;
  const bytes = image.rgba ?? image.rgb;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o =
        (Math.floor((y * image.height) / h) * image.width + Math.floor((x * image.width) / w)) * channels;
      values[y * w + x] = (brightnessAt(bytes, o) / 255) * (channels === 4 ? bytes[o + 3] / 255 : 1);
    }
  return values;
}

/** Takes the regions of fewer than `least` pixels out of a layer, with the faint fringe about each. */
function dropSpecks(inLayer, values, least, w, h, wrap) {
  for (const dots of groupsOf(inLayer, w, h).groups) {
    if (dots.length >= least) continue;
    for (const i of dots) {
      inLayer[i] = 0;
      const x0 = i % w;
      const y0 = (i - x0) / w;
      for (let y = -1; y <= 1; y++)
        for (let x = -1; x <= 1; x++) {
          const j = wrap(x0 + x, y0 + y);
          if (!inLayer[j]) values[j] = 0;
        }
    }
  }
}

/** Closes the holes of fewer than `least` pixels in a layer (a hole: known pixels out of it that touch). */
function fillPinholes(inLayer, values, known, least, w, h) {
  const outside = inLayer.map((b, i) => (known[i] && !b ? 1 : 0));
  for (const dots of groupsOf(outside, w, h).groups) {
    if (dots.length >= least) continue;
    for (const i of dots) {
      inLayer[i] = 1;
      values[i] = 1;
    }
  }
}

/**
 * A layer's connected regions, in the order their first pixel comes: { ids (each pixel's region, -1 outside
 * every one), regions: [{ id, size, box, centre, mn, mx, mid, islands }] }. `wear` (from `wearOf`) places
 * them on the body.
 */
function regionsOf(inLayer, w, h, wear) {
  const { id: ids, groups } = groupsOf(inLayer, w, h);
  const regions = groups.map((dots, id) => {
    const region = {
      id,
      size: dots.length,
      box: [w, h, 0, 0],
      centre: [0, 0],
      mn: [Infinity, Infinity, Infinity],
      mx: [-Infinity, -Infinity, -Infinity],
      mid: null,
      islands: [],
    };
    for (const i of dots) {
      const x = i % w;
      const y = (i - x) / w;
      region.box = [
        Math.min(region.box[0], x),
        Math.min(region.box[1], y),
        Math.max(region.box[2], x + 1),
        Math.max(region.box[3], y + 1),
      ];
      region.centre[0] += (x + 0.5) / dots.length;
      region.centre[1] += (y + 0.5) / dots.length;
      const island = wear.cover[i];
      if (island >= 0 && !region.islands.includes(island)) region.islands.push(island);
      for (let axis = 0; axis < 3; axis++) {
        region.mn[axis] = Math.min(region.mn[axis], wear.mn[i * 3 + axis]);
        region.mx[axis] = Math.max(region.mx[axis], wear.mx[i * 3 + axis]);
      }
    }
    // an image's region that no triangle wears has no place on the body
    const placed = region.mn[0] <= region.mx[0];
    region.centre = region.centre.map(round2);
    region.mn = placed ? region.mn.map(round2) : null;
    region.mx = placed ? region.mx.map(round2) : null;
    region.mid = placed ? region.mn.map((v, axis) => round2((v + region.mx[axis]) / 2)) : null;
    region.islands.sort((x, y) => x - y);
    return region;
  });
  return { ids, regions };
}

// ── the picture ────────────────────────────────────────────────────────────

/**
 * One texture as it was before any painting, and what is known of it from there: its layers, the measure of
 * how busy it is, and a blur that can keep to a layer. Shared by `paint`, `layersOf` and `layerMap`. It is
 * given
 *   islands        what `islandsOf` returned; info: the model, as `readMdl` reads it
 *   texture        the texture ({ name, flags... }); orig: its pixels as rgba, `width` by `height`
 *   holes          true for a masked texture: a pixel of low alpha is a hole, and counts nowhere
 *   trianglesOf()  gives the triangles that wear it (as `posed` lists them): asked for only when something
 *                  needs them
 *   kernels        a Map the blurs keep their bells in
 * Returns
 *   layers                  { name: layer }, as `layersOf` documents a layer
 *   add(name, declaration)  makes a layer and keeps it; show(name, layer): keeps one made before
 *   here(u, v, pixel, island)   names the point that `shared` reads at
 *   shared                  what is the same for a layer's function and for a pass of `paint`: layer, dist,
 *                           region, layerAt, distAt, distSmooth, orig, busy
 *   blurAt(picture, cover, pixel, island, r, options)   see below
 */
export function pictureOf({
  islands,
  info,
  texture,
  orig,
  width: w,
  height: h,
  holes,
  trianglesOf,
  kernels,
}) {
  const size = w * h;
  const wrap = wrapper(w, h);
  const colourAt = (rgba, i) => [rgba[i * 4] / 255, rgba[i * 4 + 1] / 255, rgba[i * 4 + 2] / 255];
  const isHole = (rgba, i) => holes && rgba[i * 4 + 3] < HOLE_ALPHA;

  // the layers by name, and three objects that read them at the point named last: layer.mail, dist.mail,
  // region.mail
  const layers = {};
  const layer = {};
  const dist = {};
  const region = {};
  const need = (name) => {
    const found = layers[name];
    if (!found)
      throw new Error(
        `no layer ${name} on ${texture.name}: ${Object.keys(layers).length ? `it has ${Object.keys(layers).join(", ")}` : "none is declared (yet)"}`,
      );
    return found;
  };

  // the point asked about: where in the picture, the pixel it is in and that pixel's island
  let hereU = 0;
  let hereV = 0;
  let herePixel = 0;
  let hereIsland = NO_ISLAND;

  // which triangle wears each pixel: worked out when first needed
  let wear = null;
  const worn = () => (wear ??= wearOf(trianglesOf(), w, h, wrap, islands.of));

  // the last blur and the last measure of busyness: a function asked several times in a pixel gets them again
  let lastBlur = null;
  let lastBusy = null;
  let busyMap = null;

  /**
   * The picture `picture` smoothed about pixel `i` within island `island` of `cover`, weighing each pixel by
   * the layers `within` and against the layers `not`; where nothing of them is in reach, within the island
   * alone.
   */
  const blurAt = (picture, cover, i, island, r, options = {}) => {
    const key = `${options.within ?? ""}|${options.not ?? ""}`;
    if (
      lastBlur &&
      lastBlur.picture === picture &&
      lastBlur.cover === cover &&
      lastBlur.i === i &&
      lastBlur.r === r &&
      lastBlur.island === island &&
      lastBlur.key === key
    )
      return lastBlur.rgb.slice();
    const reach = Math.max(1, Math.ceil(r));
    const bell = bellOf(kernels, r);
    const px = i % w;
    const py = (i - px) / w;
    const weighedMean = (inside, outside) => {
      const sum = [0, 0, 0];
      let weights = 0;
      for (let y = -reach; y <= reach; y++)
        for (let x = -reach; x <= reach; x++) {
          let weight = bell[(y + reach) * (2 * reach + 1) + x + reach];
          const j = wrap(px + x, py + y);
          if (!weight || cover[j] !== island || isHole(picture, j)) continue;
          for (const values of inside) weight *= values[j];
          for (const values of outside) weight *= 1 - values[j];
          if (!(weight > 0)) continue;
          weights += weight;
          for (let k = 0; k < 3; k++) sum[k] += picture[j * 4 + k] * weight;
        }
      return weights > BLUR_LEAST ? sum.map((v) => v / weights / 255) : null;
    };
    const inside = [options.within ?? []].flat().map((name) => need(name).value);
    const outside = [options.not ?? []].flat().map((name) => need(name).value);
    const byLayers = inside.length + outside.length ? weighedMean(inside, outside) : null;
    const rgb = byLayers ?? weighedMean([], []) ?? colourAt(picture, i);
    lastBlur = { picture, cover, i, r, island, key, rgb };
    return rgb.slice();
  };

  /**
   * How busy the picture is about pixel `i`, within island `island`: how far each pixel's brightness is from
   * the mean of the pixels about it, as a share of that mean, averaged over `r` pixels each way.
   */
  const busy = (i, island, r = DEFAULT_REACH) => {
    if (lastBusy && lastBusy.i === i && lastBusy.r === r && lastBusy.island === island) return lastBusy.value;
    const { cover } = worn();
    busyMap ??= busyMapOf(orig, cover, w, h, wrap, isHole);
    const reach = Math.max(1, Math.round(r));
    const px = i % w;
    const py = (i - px) / w;
    let sum = 0;
    let count = 0;
    for (let y = -reach; y <= reach; y++)
      for (let x = -reach; x <= reach; x++) {
        const j = wrap(px + x, py + y);
        if (cover[j] === island && !isHole(orig, j)) {
          sum += busyMap[j];
          count++;
        }
      }
    lastBusy = { i, r, island, value: count ? sum / count : 0 };
    return lastBusy.value;
  };

  /** Keeps a layer under its name, and lets `layer`, `dist` and `region` read it at the point named last. */
  const show = (name, made) => {
    layers[name] = made;
    for (const [reader, get] of [
      [layer, () => made.at(hereU, hereV)],
      [dist, () => made.distAt(hereU, hereV)],
      [region, () => made.regionAt(hereU, hereV)],
    ])
      Object.defineProperty(reader, name, { enumerable: true, configurable: true, get });
  };

  // what is the same for a layer's function and for a pass of `paint`: read at the point last named with
  // `here`
  const shared = {
    layer,
    dist,
    region,
    layerAt: (name, u = hereU, v = hereV) => need(name).at(u, v),
    distAt: (name, u = hereU, v = hereV) => need(name).distAt(u, v),
    distSmooth: (name, r = DEFAULT_REACH, u = hereU, v = hereV) =>
      readBetween(wrap, need(name).distSmooth(r), null, u, v),
    orig: (u, v) => colourAt(orig, u === undefined ? herePixel : wrap(u, v)),
    busy: (r) => busy(herePixel, hereIsland, r),
  };

  // What a layer's function is told: what `paint` tells its own, of the picture as it was. One object serves
  // every call, and works a thing out only when it is read.
  let hereTriangle = null;
  let hereWeights = null;
  let hereBorder = null;
  const facts = [];
  /** What does not change over a triangle (the number `k` in the list of those that wear the picture). */
  const factsOf = (k) =>
    (facts[k] ??= (() => {
      const triangle = worn().triangles[k];
      const [a, b, c] = triangle.c;
      const area = pictureArea(a, b, c);
      const found = islands.of(triangle);
      return {
        triangle,
        a,
        b,
        c,
        area,
        island: found?.island ?? null,
        border: found?.group.segs ?? NO_BORDER,
        per: unitsAPixel(a, b, c, area),
        body: bodyNumberOf(info, triangle.where),
      };
    })());
  /** The corners' `field` (p or n) weighed at the point asked about. */
  const mixed = (field) =>
    [0, 1, 2].map(
      (k) =>
        hereTriangle.a[field][k] * hereWeights[0] +
        hereTriangle.b[field][k] * hereWeights[1] +
        hereTriangle.c[field][k] * hereWeights[2],
    );
  const borderHere = () => (hereBorder ??= borderAt(hereTriangle.border, hereU, hereV));
  const place = {
    get p() {
      return mixed("p");
    },
    get n() {
      return unit(mixed("n"));
    },
    get rgb() {
      return colourAt(orig, herePixel);
    },
    tex: texture.name,
    get u() {
      return hereU;
    },
    get v() {
      return hereV;
    },
    get bone() {
      return info.bones[place.boneIndex];
    },
    get boneIndex() {
      const [wa, wb, wc] = hereWeights;
      const nearest = wa >= wb && wa >= wc ? hereTriangle.a : wb >= wc ? hereTriangle.b : hereTriangle.c;
      return nearest.bone;
    },
    get where() {
      return hereTriangle.triangle.where;
    },
    get body() {
      return hereTriangle.body;
    },
    get tri() {
      return hereTriangle.triangle.tri;
    },
    get island() {
      return hereTriangle.island;
    },
    get per() {
      return hereTriangle.per;
    },
    get edge() {
      return borderHere()[0];
    },
    get open() {
      return borderHere()[1];
    },
    at: (u, v) => colourAt(orig, wrap(u, v)),
    blur: (r, options) => blurAt(orig, worn().cover, herePixel, hereIsland, r, options),
    ...shared,
  };
  /**
   * Names the point (u, v) of pixel `i` as the one asked about, and returns `place` to hand a layer's
   * function.
   */
  const placeAt = (i, u, v) => {
    hereTriangle = factsOf(worn().own[i]);
    const { a, b, c, area } = hereTriangle;
    const wb = weightOfB(a, b, c, u, v, area);
    const wc = weightOfC(a, b, c, u, v, area);
    hereWeights = [1 - wb - wc, wb, wc];
    herePixel = i;
    hereIsland = hereTriangle.island ?? NO_ISLAND;
    hereU = u;
    hereV = v;
    hereBorder = null;
    return place;
  };

  /**
   * A layer's values from its function, asked of every pixel a triangle wears (at `soft` x `soft` points of
   * it).
   */
  const valuesFromFunction = (fn, softGiven) => {
    const values = new Float32Array(size);
    const { own, from } = worn();
    const soft = Math.max(1, Math.round(softGiven ?? 1));
    for (let i = 0; i < size; i++) {
      if (own[i] < 0 || isHole(orig, i)) continue;
      let sum = 0;
      for (let sy = 0; sy < soft; sy++)
        for (let sx = 0; sx < soft; sx++) {
          const u = from[i * 2] + (sx + 0.5) / soft;
          const v = from[i * 2 + 1] + (sy + 0.5) / soft;
          sum += answerOf(fn(placeAt(i, u, v)));
        }
      values[i] = sum / (soft * soft);
    }
    return values;
  };

  /**
   * A layer made and kept under its name: from a function of the picture as it was, or from an image; then
   * cleaned as its declaration asks.
   */
  const add = (name, declaration) => {
    const declared = typeof declaration === "function" ? { fn: declaration } : (declaration ?? {});
    if (declared.tex && String(declared.tex).toLowerCase() !== texture.name.toLowerCase()) return;
    // the earlier layer its blur counts within: looked for once, before anything is made, so that a name
    // that is not there is told whatever the picture holds
    const overValues = declared.over ? need(declared.over).value : null;

    // its values, and which pixels of the picture it knows anything of
    let values;
    let known;
    if (declared.image) {
      values = valuesFromImage(declared.image, w, h);
      known = new Uint8Array(size).fill(1);
    } else if (typeof declared.fn === "function") {
      known = worn().known;
      values = valuesFromFunction(declared.fn, declared.soft);
    } else throw new Error(`layer ${name}: give it a function, { fn }, or { image }`);

    // softened, then cleaned: specks of it off (with the faint fringe about each), pinholes in it closed, its
    // boundary smoothed
    if (declared.blur > 0) {
      // with `over`, only the pixels in that earlier layer are counted in the mean
      const counted = overValues ? known.map((k, i) => (k && overValues[i] >= IN_LAYER ? 1 : 0)) : known;
      const softened = boxMean(values, counted, Math.max(1, Math.round(declared.blur)), w, h);
      values = softened.map((x, i) => (known[i] ? x : 0));
    }
    const inLayer = Uint8Array.from(values, (x) => (x >= IN_LAYER ? 1 : 0));
    let distance = null;
    if (declared.drop > 1) dropSpecks(inLayer, values, declared.drop, w, h, wrap);
    if (declared.fill > 1) fillPinholes(inLayer, values, known, declared.fill, w, h);
    if (declared.smooth > 0) {
      const reach = Math.max(1, Math.round(declared.smooth));
      distance = boxMean(signedDistance(inLayer, known, w, h), known, reach, w, h);
      for (let i = 0; i < size; i++) {
        inLayer[i] = known[i] && distance[i] > 0 ? 1 : 0;
        values[i] = known[i] ? clamp(0.5 + distance[i]) : 0;
      }
    }

    // its regions and its averaged distances are made when first asked for
    let found = null;
    const smoothed = new Map();
    const made = {
      name,
      tex: texture.name,
      width: w,
      height: h,
      value: values,
      at: (u, v) => readBetween(wrap, values, known, u, v),
      distAt: (u, v) => readBetween(wrap, made.dist, null, u, v),
      regionAt: (u, v) => (made.regions, found.ids[wrap(u, v)]),
      distSmooth: (r = DEFAULT_REACH) => {
        const reach = Math.max(1, Math.round(r));
        if (!smoothed.has(reach)) smoothed.set(reach, boxMean(made.dist, known, reach, w, h));
        return smoothed.get(reach);
      },
      get dist() {
        return (distance ??= signedDistance(inLayer, known, w, h));
      },
      get regions() {
        found ??= regionsOf(inLayer, w, h, worn());
        return found.regions;
      },
    };
    show(name, made);
  };

  return {
    layers,
    add,
    show,
    shared,
    blurAt,
    here: (u, v, pixel, island) => {
      hereU = u;
      hereV = v;
      herePixel = pixel;
      hereIsland = island;
    },
  };
}

/**
 * The layers `paint` is given, made for one texture: a layer made before (by `layersOf`) is taken as it is
 * where it is of this texture (by its name, in capitals or not, and its size), anything else is a
 * declaration. `texture`: { name, width, height }. Returns the picture.
 */
export function layersFor(picture, texture, declarations) {
  for (const [name, declared] of Object.entries(declarations ?? {})) {
    if (declared?.value instanceof Float32Array) {
      const sameTexture = String(declared.tex).toLowerCase() === texture.name.toLowerCase();
      if (sameTexture && declared.value.length === texture.width * texture.height)
        picture.show(name, declared);
    } else picture.add(name, declared);
  }
  return picture;
}
