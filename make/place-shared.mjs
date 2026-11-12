// What the modules that work by place share (islands, picture, layers, paint, pieces, bodies, carry): the
// islands every triangle belongs to, where a pixel lies in a triangle of a picture, and the greyed, enlarged
// picture that the island map and the layer map are drawn on.
// Internal to the kit: `place.mjs` does not hand these out.
import { readMdl, readMesh } from "../core/mdl.mjs";
import { sub, cross } from "../core/vec.mjs";
import { bytesOf } from "../core/pixels.mjs";
import { label } from "./render.mjs";

/** A triangle whose corners span less than this on the picture (twice its area, in pixels) wears no pixel. */
export const FLAT_ON_PICTURE = 1e-6;
/** How far past a triangle's edges paint goes, so that seams are covered: about a pixel (see `slackOf`). */
const SEAM_SLACK = 1.2;
/** In a pixel's alpha, under this is a hole of a masked texture. */
export const HOLE_ALPHA = 128;
/** The greyed picture under a map: this much of the texture's brightness, on a floor of `GREY_FLOOR`. */
const GREY_SHARE = 0.45;
const GREY_FLOOR = 24;

/** In a map of which island lies on each pixel: no triangle wears the pixel. */
export const BARE = -1;
/** The same, for a pixel worn by a triangle that is in no island. */
export const NO_ISLAND = -2;
/** The border of a triangle that is in no island: no edges. */
export const NO_BORDER = new Float64Array(0);
/** How many numbers `islandsOf` keeps for each edge of a border: u, v, u, v and whether it is open. */
const EDGE_NUMBERS = 5;

/** A number to one decimal place. */
export const round1 = (v) => +v.toFixed(1);

// ── a pixel in a triangle of a picture ─────────────────────────────────────
// Corners here are { u, v } in pixels (as `posed` gives them). A point of the picture is the corners weighed:
// a * (1 - wb - wc) + b * wb + c * wc. The formulas are kept in one place so that every module cuts a picture
// into triangles in exactly the same way.

/** Twice the area of a triangle on its picture, with its sign: the divisor of the two weights below. */
export const pictureArea = (a, b, c) => (b.u - a.u) * (c.v - a.v) - (c.u - a.u) * (b.v - a.v);
/** The weight of corner `b` at the point (u, v); `area` is `pictureArea(a, b, c)`. */
export const weightOfB = (a, b, c, u, v, area) => ((u - a.u) * (c.v - a.v) - (c.u - a.u) * (v - a.v)) / area;
/** The weight of corner `c` at the point (u, v). */
export const weightOfC = (a, b, c, u, v, area) => ((b.u - a.u) * (v - a.v) - (u - a.u) * (b.v - a.v)) / area;
/**
 * How far under 0 a weight may be for a pixel still to be painted from the triangle: about a pixel past each
 * edge.
 */
export const slackOf = (area) => SEAM_SLACK / Math.sqrt(Math.abs(area));
/** The units of the model a pixel covers on a triangle (corners { p, u, v }). */
export const unitsAPixel = (a, b, c, area) =>
  Math.sqrt(Math.hypot(...cross(sub(b.p, a.p), sub(c.p, a.p))) / Math.abs(area));
/** The body number that shows the submodel a triangle (as `posed` lists it) is in. */
export const bodyNumberOf = (info, where) => where.model * info.bodyparts[where.bodypart].base;

/**
 * A name for where a triangle's three corners ({ u, v }, scaled by `scaleU` and `scaleV`) lie on a picture,
 * to a hundredth of a pixel: two triangles of the same name lie on the same pixels, whichever corner comes
 * first.
 */
export const layoutKey = (corners, scaleU, scaleV) =>
  corners
    .map((corner) => `${(corner.u * scaleU).toFixed(2)},${(corner.v * scaleV).toFixed(2)}`)
    .sort()
    .join("|");

/**
 * For a picture of `w` by `h`: the number of the pixel a point lies in, the picture repeating past its edges.
 */
export const wrapper = (w, h) => (u, v) =>
  (((Math.floor(v) % h) + h) % h) * w + (((Math.floor(u) % w) + w) % w);

// ── a texture by its number or name, and the map it is drawn on ────────────

/**
 * The texture `which` (a number, or a name in any case) of a model read by `readMdl`: [its number, the
 * texture].
 */
export function textureAt(info, which) {
  const number =
    typeof which === "number"
      ? which
      : info.textures.findIndex((x) => x.name.toLowerCase() === String(which).toLowerCase());
  const texture = info.textures[number];
  if (!texture) throw new Error(`no texture ${which}`);
  return [number, texture];
}

/** A texture enlarged `scale` times and greyed: { width, height, rgba }, the ground a map is tinted on. */
export function greyed(src, texture, scale) {
  const width = texture.width * scale;
  const height = texture.height * scale;
  const img = { width, height, rgba: new Uint8Array(width * height * 4) };
  const { pixels, palette } = bytesOf(src, texture);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = pixels[Math.floor(y / scale) * texture.width + Math.floor(x / scale)];
      const grey = Math.round(
        GREY_FLOOR + (GREY_SHARE * (palette[p * 3] + palette[p * 3 + 1] + palette[p * 3 + 2])) / 3,
      );
      img.rgba.set([grey, grey, grey, 255], (y * width + x) * 4);
    }
  return img;
}

// ── the islands of a picture ───────────────────────────────────────────────
const uvKey = (corner) => corner.s + "," + corner.t;
const pointKey = (corner) => corner.bone + ":" + corner.p.join();
/** One name for an edge, whichever end comes first. */
const edgeKey = (a, b) => (a < b ? a + ";" + b : b + ";" + a);
const meshKey = (where) => `${where.bodypart}|${where.model}|${where.mesh}`;
const submodelKey = (where) => `${where.bodypart}|${where.model}|`;

/** Counts, under each key, the different things added under it. */
function tally() {
  const sets = new Map();
  return {
    add(key, thing) {
      let set = sets.get(key);
      if (!set) sets.set(key, (set = new Set()));
      set.add(thing);
    },
    count: (key) => sets.get(key)?.size ?? 0,
  };
}

/** Every triangle of the file that wears a texture, mesh after mesh: { all, byMesh }. */
function wornTriangles(src, info) {
  const all = [];
  const byMesh = new Map();
  info.bodyparts.forEach((bodypart, i) =>
    bodypart.models.forEach((model, j) =>
      model.meshes.forEach((mesh, k) => {
        const tex = info.textures.indexOf(mesh.texture);
        if (!mesh.numtris || tex < 0) return;
        const where = { bodypart: i, model: j, mesh: k };
        const list = readMesh(src, model, mesh).map((c, tri) => ({
          where,
          tex,
          tri,
          c,
          uvKeys: c.map(uvKey),
          pointKeys: c.map(pointKey),
        }));
        byMesh.set(meshKey(where), list);
        for (const t of list) all.push(t);
      }),
    ),
  );
  return { all, byMesh };
}

/**
 * Every triangle that wears a texture (of the first skin family), with the island of that picture it belongs
 * to: triangles of one texture joined through an edge they share in the picture. Islands are numbered through
 * the whole model, texture after texture, in the order their first triangle comes in the file. Each triangle
 * also gets its island's border within its own mesh: the edges with one triangle of the picture on them (the
 * same triangle twice, as a sheet seen from both sides or two arms on the same pixels, counts once), five
 * numbers an edge: u, v, u, v and 1 when the border is open (no triangle of its submodel goes on across it in
 * space) or 0 for a seam.
 * Returns { info, all, of(t) }: each triangle of `all` is { where, tex (the texture's number), tri, c (its
 * corners as `readMesh` gives them), island, group: { segs } (the border) }; `of` finds one by its `where`
 * and `tri`.
 */
export function islandsOf(src) {
  const info = readMdl(src);
  const { all, byMesh } = wornTriangles(src, info);

  // triangles of one texture that share an edge of the picture are joined into one island
  const parent = all.map((_, n) => n);
  const rootOf = (n) => {
    while (parent[n] !== n) n = parent[n] = parent[parent[n]];
    return n;
  };
  const firstOnEdge = new Map();
  // how many different triangles lie on an edge: within a mesh on the picture, within a submodel in space
  const onPicture = tally();
  const inSpace = tally();
  all.forEach((t, n) => {
    const mesh = meshKey(t.where);
    const submodel = submodelKey(t.where);
    const sameOnPicture = [...t.uvKeys].sort().join("|");
    const sameInSpace = [...t.pointKeys].sort().join("|");
    for (let e = 0; e < 3; e++) {
      const edge = edgeKey(t.uvKeys[e], t.uvKeys[(e + 1) % 3]);
      const edgeOfTexture = t.tex + "|" + edge;
      if (firstOnEdge.has(edgeOfTexture)) parent[rootOf(n)] = rootOf(firstOnEdge.get(edgeOfTexture));
      else firstOnEdge.set(edgeOfTexture, n);
      onPicture.add(mesh + "|" + edge, sameOnPicture);
      inSpace.add(submodel + edgeKey(t.pointKeys[e], t.pointKeys[(e + 1) % 3]), sameInSpace);
    }
  });

  // the islands' numbers: texture after texture, in the order their first triangle comes
  const ids = new Map();
  const inOrder = all.map((_, n) => n).sort((x, y) => all[x].tex - all[y].tex || x - y);
  for (const n of inOrder) {
    const root = rootOf(n);
    if (!ids.has(root)) ids.set(root, ids.size);
    all[n].island = ids.get(root);
  }

  // each island's border within each mesh: the edges of the picture that only one triangle lies on
  const groups = new Map();
  for (const t of all) {
    const mesh = meshKey(t.where);
    const submodel = submodelKey(t.where);
    const groupKey = mesh + "|" + t.island;
    if (!groups.has(groupKey)) groups.set(groupKey, { segs: [], at: new Map() });
    const group = (t.group = groups.get(groupKey));
    for (let e = 0; e < 3; e++) {
      const a = t.c[e];
      const b = t.c[(e + 1) % 3];
      const edge = edgeKey(t.uvKeys[e], t.uvKeys[(e + 1) % 3]);
      if (t.uvKeys[e] === t.uvKeys[(e + 1) % 3] || onPicture.count(mesh + "|" + edge) !== 1) continue;
      const open = inSpace.count(submodel + edgeKey(t.pointKeys[e], t.pointKeys[(e + 1) % 3])) === 1;
      const offset = group.at.get(edge);
      if (offset === undefined) {
        group.at.set(edge, group.segs.length);
        group.segs.push(a.s, a.t, b.s, b.t, open ? 1 : 0);
      } else if (!open) group.segs[offset + 4] = 0;
    }
  }
  for (const group of groups.values()) group.segs = Float64Array.from(group.segs);
  return { info, all, of: (t) => byMesh.get(meshKey(t.where))?.[t.tri] };
}

/**
 * How far a point of a picture is from the nearest edge of a border, and from the nearest open one:
 * [pixels, pixels].
 */
export function borderAt(segs, u, v) {
  let any = Infinity;
  let open = Infinity;
  for (let o = 0; o < segs.length; o += EDGE_NUMBERS) {
    const x = segs[o];
    const y = segs[o + 1];
    const dx = segs[o + 2] - x;
    const dy = segs[o + 3] - y;
    // the point of the edge nearest (u, v): how far along it, from 0 to 1
    const along = Math.max(0, Math.min(1, ((u - x) * dx + (v - y) * dy) / (dx * dx + dy * dy)));
    const squared = (u - x - dx * along) ** 2 + (v - y - dy * along) ** 2;
    if (squared < any) any = squared;
    if (segs[o + 4] && squared < open) open = squared;
  }
  return [Math.sqrt(any), Math.sqrt(open)];
}

/** The length of a border in pixels; with `openOnly`, of its open edges alone. */
export function borderLength(segs, openOnly) {
  let length = 0;
  for (let o = 0; o < segs.length; o += EDGE_NUMBERS)
    if (!openOnly || segs[o + 4]) length += Math.hypot(segs[o + 2] - segs[o], segs[o + 3] - segs[o + 1]);
  return length;
}

/** Calls `each([u, v], [u, v], open)` for every edge of a border. */
export function eachEdge(segs, each) {
  for (let o = 0; o < segs.length; o += EDGE_NUMBERS)
    each([segs[o], segs[o + 1]], [segs[o + 2], segs[o + 3]], Boolean(segs[o + 4]));
}

/**
 * Writes a number on a map with its middle at (x, y): what the island map and the layer map name their
 * patches by.
 */
export function numberAt(img, number, x, y, dots, colour) {
  const text = String(number);
  // a glyph is 3 dots wide with one between, and 5 high
  label(img, text, Math.round(x - text.length * 2 * dots), Math.round(y - 2.5 * dots), dots, colour);
}
