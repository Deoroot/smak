// The layers of a picture: what each pixel of an old texture is (mail, plate, a strap), declared by rule and
// made before painting, and the map that shows them tinted over the texture. The making itself is in
// picture.mjs.
import { readMdl, textureOf } from "../core/mdl.mjs";
import { rgbaOf } from "../core/image.mjs";
import { posed, label, TEXTURE } from "./render.mjs";
import { mapScaleOf } from "../core/pixels.mjs";
import { islandsOf, textureAt, greyed, numberAt } from "./place-shared.mjs";
import { pictureOf, layersFor } from "./picture.mjs";

/** The colours layers are tinted in on a layer map, in the order they are declared (then round again). */
const TINTS = [
  [255, 70, 70],
  [70, 190, 255],
  [255, 215, 50],
  [110, 255, 120],
  [255, 110, 255],
  [255, 150, 40],
  [150, 130, 255],
  [60, 255, 220],
];
/** How much of its tint a layer of value 1 puts over the greyed picture. */
const TINT_SHARE = 0.7;
/** A region's number is written this much paler than its layer's tint. */
const NUMBER_PALER = 90;
/** A pixel of this value or more is counted as in the layer. */
const IN_LAYER = 0.5;
/**
 * Where the layers' names are listed on the map: from this corner, a line this many pixels under the last.
 */
const NAMES_AT = 6;
const NAMES_LINE = 16;

/**
 * The layers of one texture: for each, a number from 0 to 1 for every pixel, made from the picture as it is
 * in `src`. What `paint` makes of its `layers` option, here on its own: to look at a layer, to count and
 * place its regions before writing the passes that use them, and to hand `paint` afterwards so that it is not
 * made twice.
 * `layers` is { name: declaration }, in order: a later one may read the ones before it. A declaration is a
 * function, or an object:
 *   fn(place)  what `paint` hands its function, of the picture as it is: p, n, rgb, tex, u, v, bone, island,
 *              edge, open, per, at, blur, orig, busy(r), and layer, dist, region, layerAt, distAt, distSmooth
 *              for the layers declared before it. Returns 0 to 1, or true or false. It is asked of every
 *              pixel a triangle of the pose wears (and a pixel past each border, as `paint` paints); the rest
 *              of the picture is 0
 *   image      in place of `fn`: { width, height, rgb } or { ..., rgba }, its brightness (times its alpha)
 *              the layer, stretched to the texture's size
 *   soft       2, 3...: `fn` asked at that many points each way inside every pixel, and averaged
 *   blur       softened: each pixel the mean of the layer over this many pixels each way (of the pixels a
 *              triangle wears). With `over`, the name of an earlier layer: only the pixels in that layer are
 *              counted in the mean
 *   drop       regions of fewer pixels than this are taken out (a region: pixels of 0.5 and over that touch
 *              side to side)
 *   fill       holes of fewer pixels than this are closed (a hole: pixels a triangle wears, under 0.5, that
 *              touch)
 *   smooth     its boundary straightened: the distance to it is averaged over this many pixels each way, and
 *              the layer made again from that, so that the layer, its regions and its `dist` go by one even
 *              line
 *   tex        the one texture it is for (every painted one unless told)
 * Options: `pose` (as `posed` takes it), and `tex`, the texture's name (the first of `only`, or the first the
 * pose shows).
 * Returns { name: layer }, a layer being
 *   name, tex, width, height
 *   value            a Float32Array, one number a pixel, row by row
 *   dist             the same of the distance to the layer's edge, in pixels: over 0 inside it (how far the
 *                    nearest pixel that is out of it and worn by a triangle), under 0 outside (how far the
 *                    nearest pixel in it), 0 on the edge. The border of an island is not an edge of a layer:
 *                    `edge` and `open` measure to that
 *   regions          [{ id, size, box: [x0, y0, x1, y1], centre: [u, v], mn, mx, mid, islands }]: its
 *                    connected regions in the order their first pixel comes, row by row; size in pixels, box
 *                    and centre in pixels of the texture, and mn, mx, mid the range of the body's points that
 *                    wear the region, in model space as the model stands in `pose` (over both, where two
 *                    places share the pixels; null for an image's region no triangle wears); islands: the ids
 *                    of the islands it lies on
 *   at(u, v), distAt(u, v), regionAt(u, v)   the value and the distance at a point (between the pixels'
 *                    middles), and the id of the region there (-1 outside every one)
 *   distSmooth(r)    `dist` averaged over r pixels each way, as a Float32Array
 */
export function layersOf(src, layers, { pose = {}, tex, only } = {}) {
  const islands = islandsOf(src);
  const stand = posed(src, pose);
  const name = tex ?? only?.[0] ?? stand.tris.find((t) => t.tex)?.tex.name;
  const found = stand.info.textures.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
  if (!found) throw new Error(`no texture ${name}`);
  const texture = textureOf(src, found.name);
  const holes = Boolean(found.flags & TEXTURE.masked);
  const picture = pictureOf({
    islands,
    info: stand.info,
    texture: found,
    orig: rgbaOf(texture, holes),
    width: texture.width,
    height: texture.height,
    holes,
    trianglesOf: () => stand.tris.filter((t) => t.tex === found),
    kernels: new Map(),
  });
  return layersFor(picture, texture, layers).layers;
}

/**
 * One of the model's textures, enlarged and greyed, with layers tinted over it, each in a colour of its own
 * and named in the corner, and each region of `min` (30) pixels or more numbered: the picture to check a
 * layer in before painting with it. `layers`: declarations, or what `layersOf` returned. `which`: the
 * texture's number or name;
 * `pose`, `body`: the pose the layers are made in. Returns the picture with `scale`, `texture` and `layers`
 * ({ name: { pixels, regions } }).
 */
export function layerMap(src, which, layers, { scale, pose = {}, body, min = 30 } = {}) {
  const [, texture] = textureAt(readMdl(src), which);
  const size = texture.width * texture.height;
  const alreadyMade = Object.values(layers).some((l) => l?.value instanceof Float32Array);
  const made = alreadyMade
    ? layers
    : layersOf(src, layers, { pose: body === undefined ? pose : { ...pose, body }, tex: texture.name });
  const mine = Object.values(made).filter((l) => l.tex === texture.name && l.value.length === size);
  const tintOf = (number) => TINTS[number % TINTS.length];

  // the greyed picture, each pixel tinted by every layer it is in, a later layer over an earlier
  const enlarged = scale ?? mapScaleOf(texture);
  const img = greyed(src, texture, enlarged);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const i = Math.floor(y / enlarged) * texture.width + Math.floor(x / enlarged);
      const o = (y * img.width + x) * 4;
      const colour = [img.rgba[o], img.rgba[o + 1], img.rgba[o + 2]];
      mine.forEach((l, number) => {
        const share = TINT_SHARE * l.value[i];
        if (share > 0)
          for (let j = 0; j < 3; j++) colour[j] = colour[j] * (1 - share) + tintOf(number)[j] * share;
      });
      img.rgba.set([Math.round(colour[0]), Math.round(colour[1]), Math.round(colour[2]), 255], o);
    }

  // each layer's regions numbered, and its name in the corner
  const said = {};
  mine.forEach((l, number) => {
    const dots = enlarged > 2 ? 2 : 1;
    const pale = tintOf(number).map((v) => Math.min(255, v + NUMBER_PALER));
    let pixels = 0;
    for (let i = 0; i < size; i++) if (l.value[i] >= IN_LAYER) pixels++;
    for (const region of l.regions)
      if (region.size >= min)
        numberAt(img, region.id, region.centre[0] * enlarged, region.centre[1] * enlarged, dots, pale);
    label(img, l.name, NAMES_AT, NAMES_AT + number * NAMES_LINE, 2, tintOf(number));
    said[l.name] = { pixels, regions: l.regions.length };
  });
  return { ...img, scale: enlarged, texture, layers: said };
}
