// Painting a model by place: a function is asked, for every pixel some triangle wears, what colour the point
// of the body under that pixel should be. A mark so crosses from one texture to the next without a seam. One
// call may make several passes, each seeing what the one before left, over layers declared from the picture
// as it was.
import { textureOf, replaceTexture } from "../core/mdl.mjs";
import { rgbaOf, indexed, masked } from "../core/image.mjs";
import { posed, TEXTURE } from "./render.mjs";
import { unit } from "../core/vec.mjs";
import { clamp } from "../core/pixels.mjs";
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
  bodyNumberOf,
  wrapper,
  islandsOf,
  borderAt,
} from "./place-shared.mjs";
import { pictureOf, layersFor, bellOf } from "./picture.mjs";

/** Two places of the body that wear one pixel count as two when they are more than this many units apart. */
const DEFAULT_APART = 3;
/**
 * How a pixel was reached in a pass: by the margin of a triangle only, lying inside one, or inside two far
 * apart.
 */
const BY_MARGIN = 1;
const INSIDE = 2;
const INSIDE_TWO = 3;
/** What is remembered of a pixel over all the passes: some triangle wears it; two places of the body do. */
const WORN = 1;
const WORN_TWICE = 2;

/** How far the point `p` is from the one kept for pixel `i` in `places` (three numbers a pixel). */
const gapTo = (p, places, i) =>
  Math.hypot(p[0] - places[i * 3], p[1] - places[i * 3 + 1], p[2] - places[i * 3 + 2]);

/**
 * A pass as it is given (a function, or { fn, ... }) with what it leaves out taken from the call's options.
 */
function passOf(given, options) {
  const pass = typeof given === "function" ? { fn: given } : given;
  const option = (name, otherwise) => pass[name] ?? options[name] ?? otherwise;
  return {
    pass,
    pose: option("pose", {}),
    only: option("only", null),
    apart: option("apart", DEFAULT_APART),
    soft: Math.max(1, Math.round(option("soft", 1))),
    islands: option("islands", null) && new Set(option("islands", null)),
  };
}

/**
 * Which island lies on each pixel of a picture of `w` by `h`, from the triangles that hold the pixel's
 * middle.
 */
function coverOf(triangles, w, h, wrap, islandOf) {
  const cover = new Int32Array(w * h).fill(BARE);
  for (const triangle of triangles) {
    const [a, b, c] = triangle.c;
    const area = pictureArea(a, b, c);
    const island = islandOf(triangle)?.island ?? NO_ISLAND;
    if (Math.abs(area) < FLAT_ON_PICTURE) continue;
    const x0 = Math.floor(Math.min(a.u, b.u, c.u));
    const x1 = Math.ceil(Math.max(a.u, b.u, c.u));
    const y0 = Math.floor(Math.min(a.v, b.v, c.v));
    const y1 = Math.ceil(Math.max(a.v, b.v, c.v));
    for (let py = y0; py <= y1; py++)
      for (let px = x0; px <= x1; px++) {
        const u = px + 0.5;
        const v = py + 0.5;
        const wb = weightOfB(a, b, c, u, v, area);
        const wc = weightOfC(a, b, c, u, v, area);
        if (wb >= 0 && wc >= 0 && wb + wc <= 1) cover[wrap(px, py)] = island;
      }
  }
  return cover;
}

/**
 * One pass over one texture: every pixel that the triangles `mine` wear is asked of the pass's function, and
 * what it answers is written into a copy of the picture, which becomes the sheet's. `sheet` is what `paint`
 * keeps of a texture over all its passes (see there).
 */
function paintTexture(sheet, mine, { pass, apart, soft }, info, islands, kernels) {
  const { texture, width: w, height: h, holes, picture, orig } = sheet;
  const shared = picture.shared;
  // the picture as the pass before left it, and as this one leaves it
  const was = sheet.rgba;
  const rgba = Uint8Array.from(was);
  // for each pixel, how this pass reached it, and the point of the body that it was painted for
  const reached = new Uint8Array(w * h);
  const paintedFor = new Float32Array(w * h * 3);
  const wrap = wrapper(w, h);
  const colourWas = (i) => [was[i * 4] / 255, was[i * 4 + 1] / 255, was[i * 4 + 2] / 255];
  const isHole = (i) => holes && was[i * 4 + 3] < HOLE_ALPHA;

  // which island lies on each pixel, and the picture smoothed within one: made only when a function asks
  let cover = null;
  const covered = () => (cover ??= coverOf(mine, w, h, wrap, islands.of));
  let lastBlur = null;
  /**
   * The picture as it was before this pass, smoothed about pixel `i` over `r` pixels, within `island` only.
   */
  const blur = (i, island, r) => {
    if (lastBlur && lastBlur.i === i && lastBlur.r === r && lastBlur.island === island)
      return lastBlur.rgb.slice();
    const onPixel = covered();
    const reach = Math.max(1, Math.ceil(r));
    const px = i % w;
    const py = (i - px) / w;
    const sum = [0, 0, 0];
    const bell = bellOf(kernels, r);
    let weights = 0;
    for (let y = -reach; y <= reach; y++)
      for (let x = -reach; x <= reach; x++) {
        const weight = bell[(y + reach) * (2 * reach + 1) + x + reach];
        const j = wrap(px + x, py + y);
        if (!weight || onPixel[j] !== island || isHole(j)) continue;
        weights += weight;
        for (let k = 0; k < 3; k++) sum[k] += was[j * 4 + k] * weight;
      }
    lastBlur = { i, r, island, rgb: weights ? sum.map((v) => v / weights / 255) : colourWas(i) };
    return lastBlur.rgb.slice();
  };

  /**
   * True when pixel `i` needs nothing more from a triangle that reaches it at the point `p` of the body.
   * Counts the pixel as worn twice when two triangles hold it at places far apart: once, however many wear
   * it.
   */
  const doneAlready = (i, p, inside) => {
    if (!reached[i]) return false;
    if (!inside) return true;
    if (reached[i] === INSIDE && gapTo(p, paintedFor, i) > apart) {
      reached[i] = INSIDE_TWO;
      if (!(sheet.worn[i] & WORN_TWICE)) {
        sheet.worn[i] |= WORN_TWICE;
        sheet.twice++;
      }
    }
    // a pixel first reached only by the margin of a triangle is painted again by the one it lies in
    return reached[i] >= INSIDE;
  };
  /** Counts pixel `i` as worn, and as worn twice when another place of the body wore it in a pass before. */
  const countWorn = (i, p) => {
    if (!(sheet.worn[i] & WORN)) {
      sheet.worn[i] |= WORN;
      sheet.once++;
      sheet.place.set(p, i * 3);
    } else if (!(sheet.worn[i] & WORN_TWICE) && gapTo(p, sheet.place, i) > apart) {
      sheet.worn[i] |= WORN_TWICE;
      sheet.twice++;
    }
  };

  for (const triangle of mine) {
    const [a, b, c] = triangle.c;
    const area = pictureArea(a, b, c);
    if (Math.abs(area) < FLAT_ON_PICTURE) continue;
    const x0 = Math.floor(Math.min(a.u, b.u, c.u)) - 1;
    const x1 = Math.ceil(Math.max(a.u, b.u, c.u)) + 1;
    const y0 = Math.floor(Math.min(a.v, b.v, c.v)) - 1;
    const y1 = Math.ceil(Math.max(a.v, b.v, c.v)) + 1;
    // about a pixel past each edge, so that seams are covered
    const slack = slackOf(area);

    // what is the same over the whole triangle
    const found = islands.of(triangle);
    const island = found?.island ?? null;
    const border = found?.group.segs ?? NO_BORDER;
    const per = unitsAPixel(a, b, c, area);
    const body = bodyNumberOf(info, triangle.where);
    const pointAt = (wa, wb, wc) => [0, 1, 2].map((k) => a.p[k] * wa + b.p[k] * wb + c.p[k] * wc);
    const normalAt = (wa, wb, wc) => unit([0, 1, 2].map((k) => a.n[k] * wa + b.n[k] * wb + c.n[k] * wc));

    /**
     * Asks the pass's function about the point (u, v) of pixel `i`: weights wa, wb, wc, place `p`, normal
     * `n`.
     */
    const ask = (i, u, v, wa, wb, wc, p, n) => {
      const nearest = wa >= wb && wa >= wc ? a : wb >= wc ? b : c;
      let distances = null;
      const toBorder = () => (distances ??= borderAt(border, u, v));
      picture.here(u, v, i, island ?? NO_ISLAND);
      return pass.fn({
        p,
        n,
        rgb: colourWas(i),
        tex: texture.name,
        u,
        v,
        bone: info.bones[nearest.bone],
        boneIndex: nearest.bone,
        where: triangle.where,
        body,
        tri: triangle.tri,
        island,
        per,
        get edge() {
          return toBorder()[0];
        },
        get open() {
          return toBorder()[1];
        },
        at: (atU, atV) => colourWas(wrap(atU, atV)),
        blur: (r, options) =>
          options
            ? picture.blurAt(options.orig ? orig : was, covered(), i, island ?? NO_ISLAND, r, options)
            : blur(i, island ?? NO_ISLAND, r),
        layer: shared.layer,
        dist: shared.dist,
        region: shared.region,
        layerAt: shared.layerAt,
        distAt: shared.distAt,
        distSmooth: shared.distSmooth,
        orig: shared.orig,
        busy: shared.busy,
      });
    };
    /**
     * Asks at soft x soft points of the pixel (px, py) and averages; a point that is left alone keeps the
     * colour it had. Nothing when every point is left alone.
     */
    const askSoft = (i, px, py) => {
      const sum = [0, 0, 0];
      const had = colourWas(i);
      let any = false;
      for (let sy = 0; sy < soft; sy++)
        for (let sx = 0; sx < soft; sx++) {
          const u = px + (sx + 0.5) / soft;
          const v = py + (sy + 0.5) / soft;
          const wb = weightOfB(a, b, c, u, v, area);
          const wc = weightOfC(a, b, c, u, v, area);
          const wa = 1 - wb - wc;
          const answer = ask(i, u, v, wa, wb, wc, pointAt(wa, wb, wc), normalAt(wa, wb, wc));
          if (answer) any = true;
          for (let k = 0; k < 3; k++) sum[k] += clamp((answer || had)[k]);
        }
      return any ? sum.map((s) => s / (soft * soft)) : undefined;
    };

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
        const p = pointAt(wa, wb, wc);
        if (doneAlready(i, p, inside)) continue;
        if (inside) countWorn(i, p);
        reached[i] = inside ? INSIDE : BY_MARGIN;
        paintedFor.set(p, i * 3);
        if (isHole(i)) continue;

        // asked once at the pixel's middle, or at soft x soft points of it, each with its own normal
        const answer = soft === 1 ? ask(i, u, v, wa, wb, wc, p, normalAt(wa, wb, wc)) : askSoft(i, px, py);
        if (answer) {
          sheet.changed = true;
          for (let k = 0; k < 3; k++) rgba[i * 4 + k] = Math.round(clamp(answer[k]) * 255);
        }
      }
  }
  sheet.rgba = rgba;
}

/**
 * The model with every changed picture put back: each cut to 256 colours, at its own size, a masked one
 * keeping its holes. Returns what `paint` returns.
 */
function written(src, sheets) {
  let mdl = src;
  const shared = {};
  for (const number of [...sheets.keys()].sort((x, y) => x - y)) {
    const { texture, width, height, holes, rgba, twice, once, changed } = sheets.get(number);
    shared[texture.name] = +(twice / Math.max(1, once)).toFixed(2);
    if (!changed) continue;
    let next;
    if (holes) next = masked({ width, height, rgba }, texture.name);
    else {
      const rgb = new Uint8Array(width * height * 3);
      for (let i = 0; i < width * height; i++) rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
      next = indexed({ width, height, rgb }, texture.name);
    }
    mdl = replaceTexture(mdl, texture.name, { ...next, name: texture.name, flags: texture.flags });
  }
  return { mdl, shared };
}

/**
 * Paints the model by place. `fn` is called for every pixel of every texture that some triangle wears, with
 * the point of the body it colours, and returns the new colour, or nothing to leave it. A mark made at one
 * place of the body so crosses from one texture to the next without a seam. It is handed one object:
 *   p, n       the point (model space, as the model stands in `pose`) and the way the surface faces there
 *   rgb        the colour there now, 0 to 1 (in a later pass: as the passes before left it)
 *   tex        the texture's name; u, v: where in it, in pixels from its top left (the middle of the pixel,
 *              or the point inside it that is asked about when `soft` is set)
 *   bone, boneIndex   the bone the point follows (the nearest corner's), by name and by number
 *   where, body, tri  its mesh ({ bodypart, model, mesh }), the body number that shows that submodel, and the
 *              triangle's number in the mesh (as `readMesh` lists them)
 *   island     the island of the picture the triangle belongs to (see `uvIslands`)
 *   edge, open how far the pixel is from its island's border, and from the nearest open stretch of it (a hem,
 *              an armhole: no triangle goes on across it in space; Infinity when the island has none), both
 *              in pixels
 *   per        units of the model a pixel covers here: `edge * per` is the distance in units, near enough
 *   at(u, v)   the colour of this texture at another pixel, as it stood before this pass
 *   blur(r)    that picture smoothed about this pixel over `r` pixels, taking only pixels of this island: its
 *              broad light and shade without its fine detail, and nothing of a neighbour on the picture.
 *              `blur(r, { within, not, orig })`: only from pixels in the layer (or layers) `within`, leaving
 *              the layer (or layers) `not` out, each pixel weighed by the layer's value there; `orig: true`
 *              smooths the picture as it was before the first pass. Still within the island; where no such
 *              pixel is in reach, the island's plain blur
 *   orig(u, v) the colour of this texture at a pixel as it was before the first pass (`orig()`: at this one)
 *   busy(r)    how busy the picture was here before the first pass, over `r` (3) pixels each way and within
 *              the island: 0 on a flat ground; on one armour about 0.03 on smooth plate, 0.1 on ridged plate
 *              and 0.35 on mail's chequer. For telling materials apart by their texture
 *   layer      the layers given in the options, each a number from 0 to 1 at this point: `layer.mail`.
 *              `dist.mail` is the distance to that layer's edge in pixels, over 0 inside it and under 0
 *              outside; `region.mail` the id of the layer's region here (-1 outside). All three are read at
 *              the point asked about, so with `soft` their edges come out soft. At another point:
 *              `layerAt(name, u, v)`, `distAt(name, u, v)`.
 *              `distSmooth(name, r)`: the distance averaged over `r` (3) pixels each way, for a line that
 *              does not wander with the layer's noise
 * Options:
 *   layers     { name: declaration }: numbers from 0 to 1 a pixel, made once from the picture as it was
 *              before the first pass and readable in every pass. A declaration is a function of what `fn` is
 *              handed (returning 0 to 1, or true or false), or { fn | image, soft, blur, over, drop, fill,
 *              smooth, tex }: see `layersOf`, whose result is taken here too
 *   only       the names of the textures to paint (all of them unless told)
 *   islands    the ids of the islands to paint (all of them unless told): the others' triangles are not there
 *              for this call
 *   pose       as `posed` takes it
 *   soft       2, 3, 4...: `fn` is asked at that many points each way inside every pixel and the answers are
 *              averaged, so that the edge of any shape comes out soft instead of as a staircase (1, the
 *              default: once, at its middle)
 * Several passes in one call: give a list in place of `fn`, each a function or { fn, only, islands, pose,
 * soft, apart } (what a pass leaves out is taken from the options). Each pass sees what the one before left,
 * in full colour.
 * Each painted texture is cut back to 256 colours, once, after the last pass, and put back in its place at
 * its own size; a masked one keeps its holes. Returns { mdl, shared }: `shared[name]` is the share of that
 * texture's painted pixels worn by two places of the body more than `apart` (3) units from each other. Models
 * often give the left and right arm or leg the same pixels: what is painted on one side then shows on the
 * other, and nothing short of laying the texture out again changes that.
 */
export function paint(src, fn, options = {}) {
  const islands = islandsOf(src);
  // the model as it stands in each pose asked for, and the blurs' bells: made once a call
  const stands = new Map();
  const kernels = new Map();
  const standOf = (pose) => {
    const key = JSON.stringify(pose);
    if (!stands.has(key)) stands.set(key, posed(src, pose));
    return stands.get(key);
  };

  /**
   * What is kept of one texture over all the passes: its picture in full colour (`rgba`, as the last pass
   * left it), the picture as it was (`orig`) with the layers made from it (`picture`), and the count of its
   * pixels worn once and twice. Made by whichever pass comes to the texture first; the layers in the pose of
   * the call's options.
   */
  const sheetOf = (texture, number, info) => {
    const stored = textureOf(src, texture.name);
    const holes = Boolean(texture.flags & TEXTURE.masked);
    const size = stored.width * stored.height;
    const sheet = {
      texture,
      width: stored.width,
      height: stored.height,
      holes,
      rgba: rgbaOf(stored, holes),
      worn: new Uint8Array(size),
      place: new Float32Array(size * 3),
      twice: 0,
      once: 0,
      changed: false,
    };
    sheet.orig = sheet.rgba;
    const base = () => standOf(options.pose ?? {});
    sheet.picture = layersFor(
      pictureOf({
        islands,
        info,
        texture,
        orig: sheet.orig,
        width: sheet.width,
        height: sheet.height,
        holes,
        trianglesOf: () => base().tris.filter((t) => t.tex === base().info.textures[number]),
        kernels,
      }),
      { name: texture.name, width: sheet.width, height: sheet.height },
      options.layers,
    );
    return sheet;
  };

  const sheets = new Map();
  for (const given of Array.isArray(fn) ? fn : [fn]) {
    const settings = passOf(given, options);
    const { info, tris } = standOf(settings.pose);
    info.textures.forEach((texture, number) => {
      if (settings.only && !settings.only.includes(texture.name)) return;
      const mine = tris.filter(
        (t) => t.tex === texture && (!settings.islands || settings.islands.has(islands.of(t)?.island)),
      );
      if (!mine.length) return;
      if (!sheets.has(number)) sheets.set(number, sheetOf(texture, number, info));
      paintTexture(sheets.get(number), mine, settings, info, islands, kernels);
    });
  }
  return written(src, sheets);
}
