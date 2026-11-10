// The islands of a model's pictures: the patches each texture is cut into (a trunk's front, a sleeve, a
// boot's sole), listed with their place on the body, and drawn tinted and numbered to choose from.
import { bodyOf, apply34 } from "../core/mdl.mjs";
import { posed } from "./render.mjs";
import { sub, cross, unit } from "../core/vec.mjs";
import { FRONT } from "./mesh.mjs";
import { mapScaleOf, drawLine } from "../core/pixels.mjs";
import { islandsOf, borderLength, eachEdge, textureAt, greyed, numberAt, round1 } from "./place-shared.mjs";

/** Larger than any coordinate of a model or a picture: where a box starts before its first point. */
const FAR = 1e9;
/** A triangle of the map with less than this (twice its area, in pixels) tints nothing. */
const FLAT_ON_MAP = 1e-9;
/** How much of an island's own colour goes over the greyed picture. */
const TINT_SHARE = 0.5;
/** An island at least this many pixels across on the map gets its number in large dots. */
const LARGE_ISLAND = 60;
/** An island's number is written this much brighter than its tint. */
const NUMBER_BRIGHTER = 70;
const WHITE = [255, 255, 255, 255];
/**
 * Each island's hue is this far round the colour wheel from the one before: the golden ratio keeps them
 * apart.
 */
const HUE_STEP = 0.618034;

/**
 * The islands of the model's pictures: the patches a texture is cut into, each a group of triangles joined
 * through the edges they share in the picture. A trunk's front, a sleeve, a boot's sole is usually one
 * island.
 * Returns { list, of }:
 *   list   [{ id, tex, tris, box: [x0, y0, x1, y1],
 *            uses: [{ bodypart, model, mesh, body, part, name, tris }], bones, mn, mx, mid, n, border, open,
 *            bodies }]
 *            box: in pixels of its texture; uses: the meshes that have triangles of it, `body` the body
 *            number that shows each;
 *            tris: its triangles over every mesh that uses it, so twice a body's own where two bodies lay the
 *            same triangles on the picture; bodies: [{ body, tris }], the count for each body number, which
 *            is the one that reads true of a body;
 *            bones: the names of the bones it hangs on, the one that carries most of it first;
 *            mn, mx, mid: its place in model space as the model stands in `pose`, over every submodel that
 *            uses it;
 *            n: the way it faces on the whole (a unit vector: n[0] > 0.5 looks forwards);
 *            border: the length of its edge in pixels; open: how much of that has no triangle going on across
 *            it in space (a hem, an armhole, a neckline: the rest is seams, where the surface goes on in
 *            another island). Both are measured mesh by mesh, and where several meshes have triangles of the
 *            island (see `uses`) they are the longest of those, not their sum: two bodies that lay the same
 *            triangles on the picture give the island one border, not two. An island cut between two meshes
 *            of one body so reads as its longer part's border, the cut between the two counted in
 *   of(t)  the id of the island a triangle belongs to, for a `t` with `where` and `tri`: what `posed` lists,
 *          what `dropTriangles` hands its rule and what `paint` hands its function
 * An id stays the same for as long as the file's meshes do: another picture, or a body added after the
 * others, moves none.
 */
export function uvIslands(src, pose = {}) {
  const islands = islandsOf(src);
  const { info } = islands;
  const matrices = posed(src, pose).pose;
  const list = [];
  for (const t of islands.all) {
    const bodypart = info.bodyparts[t.where.bodypart];
    const entry = (list[t.island] ??= {
      id: t.island,
      tex: info.textures[t.tex].name,
      tris: 0,
      box: [FAR, FAR, -FAR, -FAR],
      uses: [],
      bones: new Map(),
      mn: [FAR, FAR, FAR],
      mx: [-FAR, -FAR, -FAR],
      n: [0, 0, 0],
      groups: new Set(),
    });
    let use = entry.uses.find(
      (x) => x.bodypart === t.where.bodypart && x.model === t.where.model && x.mesh === t.where.mesh,
    );
    if (!use) {
      use = {
        ...t.where,
        body: t.where.model * bodypart.base,
        part: bodypart.name,
        name: bodypart.models[t.where.model].name,
        tris: 0,
      };
      entry.uses.push(use);
    }
    use.tris++;
    entry.tris++;
    entry.groups.add(t.group);

    const points = t.c.map((corner) => apply34(matrices[corner.bone], corner.p));
    const face = cross(sub(points[1], points[0]), sub(points[2], points[0]));
    for (let a = 0; a < 3; a++) entry.n[a] += face[a] * FRONT;
    t.c.forEach((corner, k) => {
      entry.box = [
        Math.min(entry.box[0], corner.s),
        Math.min(entry.box[1], corner.t),
        Math.max(entry.box[2], corner.s),
        Math.max(entry.box[3], corner.t),
      ];
      entry.bones.set(corner.bone, (entry.bones.get(corner.bone) ?? 0) + 1);
      for (let a = 0; a < 3; a++) {
        entry.mn[a] = Math.min(entry.mn[a], points[k][a]);
        entry.mx[a] = Math.max(entry.mx[a], points[k][a]);
      }
    });
  }
  // an island's border is kept mesh by mesh: the longest of them is the island's (not their sum: the same
  // island laid by two bodies has one border)
  const longest = (groups, openOnly) =>
    Math.round(Math.max(...[...groups].map(({ segs }) => borderLength(segs, openOnly))));
  return {
    list: list.map(({ groups, ...entry }) => ({
      ...entry,
      bones: [...entry.bones].sort((x, y) => y[1] - x[1]).map(([bone]) => info.bones[bone]),
      mn: entry.mn.map(round1),
      mx: entry.mx.map(round1),
      mid: entry.mn.map((v, a) => round1((v + entry.mx[a]) / 2)),
      n: unit(entry.n).map((v) => +v.toFixed(2)),
      border: longest(groups, false),
      open: longest(groups, true),
      bodies: [...new Set(entry.uses.map((use) => use.body))].map((body) => ({
        body,
        tris: entry.uses.reduce((sum, use) => sum + (use.body === body ? use.tris : 0), 0),
      })),
    })),
    of: (t) => islands.of(t)?.island,
  };
}

/** The colour an island is tinted in on the map: a hue of its own, never dark. */
function inkOf(id) {
  const hue = ((id * HUE_STEP) % 1) * 6;
  const f = hue - Math.floor(hue);
  const sixths = [
    [1, f, 0],
    [1 - f, 1, 0],
    [0, 1, f],
    [0, 1 - f, 1],
    [f, 0, 1],
    [1, 0, 1 - f],
  ];
  return sixths[Math.floor(hue)].map((v) => Math.round(255 * (0.25 + 0.75 * v)));
}

/**
 * Tints the pixels of a map that the triangle a, b, c ([x, y] each, `det` twice its area) lies on. A dot is
 * tinted once, however many triangles lie on it: `tinted` remembers which were.
 */
function tintTriangle(img, tinted, a, b, c, det, colour) {
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const x1 = Math.min(img.width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const y1 = Math.min(img.height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  for (let py = y0; py <= y1; py++)
    for (let px = x0; px <= x1; px++) {
      const u = px + 0.5;
      const v = py + 0.5;
      const wb = ((u - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (v - a[1])) / det;
      const wc = ((b[0] - a[0]) * (v - a[1]) - (u - a[0]) * (b[1] - a[1])) / det;
      const o = py * img.width + px;
      if (wb < 0 || wc < 0 || wb + wc > 1 || tinted[o]) continue;
      tinted[o] = 1;
      for (let j = 0; j < 3; j++)
        img.rgba[o * 4 + j] = Math.round(img.rgba[o * 4 + j] * (1 - TINT_SHARE) + colour[j] * TINT_SHARE);
    }
}

/**
 * One of the model's textures, enlarged and greyed, with each of its islands tinted and numbered: the picture
 * to choose islands from. An open border (a hem, an armhole) is drawn white, a seam in the island's own
 * colour.
 * `which`: the texture's number or name; `body`: only the islands the submodels of that body number use
 * (every submodel's unless told). Returns the picture with `scale`, `texture` and `islands` (the ids drawn).
 */
export function islandMap(src, which, { scale, body } = {}) {
  const islands = islandsOf(src);
  const [number, texture] = textureAt(islands.info, which);
  const enlarged = scale ?? mapScaleOf(texture);
  const img = greyed(src, texture, enlarged);
  const shown = body === undefined ? null : bodyOf(src, body);
  const mine = islands.all.filter(
    (t) => t.tex === number && (!shown || shown[t.where.bodypart] === t.where.model),
  );

  // the tint, and for each island where its number goes: the middle of its largest triangle
  const marks = new Map();
  const borders = new Set();
  const tinted = new Uint8Array(img.width * img.height);
  for (const t of mine) {
    const [a, b, c] = t.c.map((corner) => [corner.s * enlarged, corner.t * enlarged]);
    const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    const colour = inkOf(t.island);
    const mark = marks.get(t.island) ?? { area: -1, tris: 0, colour, lo: [FAR, FAR], hi: [-FAR, -FAR] };
    borders.add(t.group);
    marks.set(t.island, mark);
    mark.tris++;
    for (const corner of [a, b, c])
      for (let j = 0; j < 2; j++) {
        mark.lo[j] = Math.min(mark.lo[j], corner[j]);
        mark.hi[j] = Math.max(mark.hi[j], corner[j]);
      }
    if (Math.abs(det) > mark.area)
      Object.assign(mark, {
        area: Math.abs(det),
        x: (a[0] + b[0] + c[0]) / 3,
        y: (a[1] + b[1] + c[1]) / 3,
      });
    if (Math.abs(det) < FLAT_ON_MAP) continue;
    tintTriangle(img, tinted, a, b, c, det, colour);
  }

  // the borders, each drawn once
  for (const t of mine)
    if (borders.delete(t.group))
      eachEdge(t.group.segs, (from, to, open) =>
        drawLine(
          img.rgba,
          img.width,
          img.height,
          [from[0] * enlarged, from[1] * enlarged],
          [to[0] * enlarged, to[1] * enlarged],
          open ? WHITE : [...inkOf(t.island), 255],
        ),
      );

  // the numbers, a large island's after a small one's so that it lies over it
  for (const [id, mark] of [...marks].sort((x, y) => x[1].tris - y[1].tris)) {
    const dots = Math.min(mark.hi[0] - mark.lo[0], mark.hi[1] - mark.lo[1]) > LARGE_ISLAND ? 2 : 1;
    const bright = mark.colour.map((v) => Math.min(255, v + NUMBER_BRIGHTER));
    numberAt(img, id, mark.x, mark.y, dots, bright);
  }
  return { ...img, scale: enlarged, texture, islands: [...marks.keys()].sort((x, y) => x - y) };
}
