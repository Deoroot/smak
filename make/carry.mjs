// A painted picture carried from an old shape to a new one: each pixel the new body wears is painted again
// from the old picture, read at the same place of the shape. Three ways of finding "the same place" are tried
// in turn: the same pixels, the same part of the shape by its own measure, and the nearest point in space.
import { textureOf } from "../core/mdl.mjs";
import { rgbaOf } from "../core/image.mjs";
import { posed } from "./render.mjs";
import { sub, dot, cross, unit } from "../core/vec.mjs";
import { FRONT } from "./mesh.mjs";
import { layoutKey } from "./place-shared.mjs";
import { paint } from "./paint.mjs";

/** A triangle of a flat list with less than this (twice its area) holds no point. */
const FLAT = 1e-12;
/** Two rings of a part are the same ring when their places along it agree to this many decimal places. */
const RING_PLACES = 6;

/**
 * The point of a triangle nearest `p`, as weights of its three corners. (`nearest` in wear.mjs is the same
 * search, giving the point itself.)
 */
function nearestOn(p, a, b, c) {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  // nearest the corner a
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  // nearest the corner b
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  // nearest the edge a-b
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [1 - v, v, 0];
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  // nearest the corner c
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  // nearest the edge a-c
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [1 - w, 0, w];
  }
  // nearest the edge b-c
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + d5 - d6);
    return [0, 1 - w, w];
  }
  // over the face
  const k = 1 / (va + vb + vc);
  return [1 - (vb + vc) * k, vb * k, vc * k];
}

/**
 * A triangle laid flat for `holding`: its corners' `xs` and `ys`, its box, and whatever `more` it carries.
 */
const flatOf = (xs, ys, more) => ({
  x: xs,
  y: ys,
  lo: [Math.min(...xs), Math.min(...ys)],
  hi: [Math.max(...xs), Math.max(...ys)],
  ...more,
});

/**
 * Which triangle of a flat list ([{ x: [three], y: [three] }]) holds a point, and its weights there; the
 * nearest when none does. `last` is tried first.
 */
function holding(list, x, y, last) {
  let best = null;
  let bestScore = -Infinity;
  // true when the triangle holds the point; keeps it as the best so far when it is nearer to holding it
  const tryOne = (t) => {
    const det = (t.x[1] - t.x[0]) * (t.y[2] - t.y[0]) - (t.x[2] - t.x[0]) * (t.y[1] - t.y[0]);
    if (Math.abs(det) < FLAT) return false;
    const wb = ((x - t.x[0]) * (t.y[2] - t.y[0]) - (t.x[2] - t.x[0]) * (y - t.y[0])) / det;
    const wc = ((t.x[1] - t.x[0]) * (y - t.y[0]) - (x - t.x[0]) * (t.y[1] - t.y[0])) / det;
    const wa = 1 - wb - wc;
    // how far inside the point is (under 0: outside), in the triangle's own size
    const score = Math.min(wa, wb, wc) * Math.sqrt(Math.abs(det));
    if (score > bestScore) {
      bestScore = score;
      best = { t, w: [wa, wb, wc] };
    }
    return score >= 0;
  };
  if (last && tryOne(last)) return best;
  for (const t of list) {
    if (t !== last && x >= t.lo[0] && x <= t.hi[0] && y >= t.lo[1] && y <= t.hi[1] && tryOne(t)) return best;
  }
  if (!best || bestScore < 0) for (const t of list) tryOne(t);
  return best;
}

/**
 * A reader of a picture ({ width, height, rgba } or rgb, or a texture): `read(u, v)` is its colour, 0 to 1,
 * at a point of it in pixels, between the middles of four pixels.
 */
function readerOf(picture) {
  const { width, height, rgb } = picture;
  const rgba = picture.rgba ?? (rgb ? null : rgbaOf(picture));
  const dotAt = (x, y) => {
    const i = Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x));
    return rgba
      ? [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]
      : [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]];
  };
  return (u, v) => {
    const x = u - 0.5;
    const y = v - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const topLeft = dotAt(x0, y0);
    if (!fx && !fy) return topLeft.map((c) => c / 255);
    const topRight = dotAt(x0 + 1, y0);
    const bottomLeft = dotAt(x0, y0 + 1);
    const bottomRight = dotAt(x0 + 1, y0 + 1);
    return [0, 1, 2].map(
      (k) =>
        ((topLeft[k] * (1 - fx) + topRight[k] * fx) * (1 - fy) +
          (bottomLeft[k] * (1 - fx) + bottomRight[k] * fx) * fy) /
        255,
    );
  };
}

/**
 * The places along a part (the first of each corner's `q`) that its triangles' corners stand at, in order.
 */
const ringsOf = (measures) =>
  [...new Set(measures.flatMap((q) => q.map((v) => +v[0].toFixed(RING_PLACES))))].sort((a, b) => a - b);

/**
 * A part's first measure (along it) from the new shape to the old, given the rings of each (from `ringsOf`):
 * a value both have is the same place (a ring that stayed), the two ends are the ends, and between two such
 * it goes in proportion.
 */
function alongOf(oldRings, newRings) {
  // pairs [new, old] that are the same place, kept only while both go on rising
  const pins = newRings
    .filter((v, i) => i > 0 && i < newRings.length - 1 && oldRings.includes(v))
    .map((v) => [v, v]);
  pins.unshift([newRings[0], oldRings[0]]);
  pins.push([newRings.at(-1), oldRings.at(-1)]);
  const rising = pins.filter((pin, i) => !i || (pin[0] > pins[i - 1][0] && pin[1] > pins[i - 1][1]));
  return (x) => {
    let i = 0;
    while (i + 2 < rising.length && x > rising[i + 1][0]) i++;
    const a = rising[i];
    const b = rising[i + 1];
    return !b || b[0] === a[0] ? a[1] : a[1] + ((x - a[0]) * (b[1] - a[1])) / (b[0] - a[0]);
  };
}

/**
 * A painted picture carried from an old shape to a new one: every pixel that the body `body` of `now` wears
 * is painted again from the picture the body `from` (the same number unless told) of `old` wore, read at the
 * same place of the shape. So a shape can be changed (a ring more, a taller crown, a part moved) after its
 * texture was painted.
 * Where "the same place" is:
 *   0. a triangle that lies on the picture exactly where one of the old body lay keeps its pixels as they
 *      are, wherever it now stands (a finial that went up with the crown)
 *   1. else, with `was` and `is` (the old and the new shape's triangles as the workshop made them, with their
 *      `of` and `q`): the same part by name, at the same place in the part's own measure. Round a turned part
 *      that is the share of the way round; along it, a ring that both shapes have (the same `s`) is the same
 *      place, the two ends are the ends, and between two such the paint is stretched in proportion. So a rim
 *      stays on its rim, what was painted beside a ring stays beside it, and only the bands that changed are
 *      stretched, however the part is laid on the picture now
 *   2. else by place: the nearest point of the old body that faces the same way, no farther than `reach`
 *      units (`moved(p, place)`, when given, says where the point `p` of the new body was on the old one)
 * A pixel for which none finds a place is left as `now` has it and counted in `lost`.
 *   tex       the texture's name, or several (every one both bodies wear unless told); fromTex: the old
 *             body's texture, when it goes by another name
 *   picture   the old picture, when it is not the one in `old`: { width, height, rgba } (or rgb), or a
 *             texture: what was painted outside the file (in the editor's project, say)
 *   pose      as `posed` takes it, for both; soft: as `paint` (1; 2 or 3 where the layout was stretched)
 * Returns { mdl, report: { name: { pixels, same, part, place, lost, far } } }: how many pixels carried each
 * way (same: a triangle that lay as it was; part: by the part's own measure; place: the nearest of the old
 * body), and the farthest a pixel carried by place was from where it was read, in units. The picture is cut
 * to 256 colours once, as `paint` does.
 */
export function carryPicture(
  old,
  now,
  {
    body = 0,
    from = body,
    tex = null,
    fromTex = null,
    pose = {},
    picture = null,
    was = null,
    is = null,
    moved = null,
    reach = Infinity,
    soft = 1,
  } = {},
) {
  const before = posed(old, { ...pose, body: from });
  const stand = { ...pose, body };
  const after = posed(now, stand);
  const report = {};
  const names = (tex ? [tex].flat() : [...new Set(after.tris.map((t) => t.tex?.name))]).filter(
    (name) =>
      name &&
      after.info.textures.some((t) => t.name === name) &&
      (picture || before.tris.some((t) => t.tex?.name === (fromTex ?? name))),
  );
  let mdl = now;
  for (const name of names) {
    const oldName = fromTex ?? name;
    const source = picture ?? textureOf(old, oldName);
    const read = readerOf(source);
    // three sizes may differ: the old picture's, the new file's texture's, and the old file's texture's.
    // `toOldU`, `toOldV` take a pixel of the new texture to the old picture; `fileToOldU`, `fileToOldV` the
    // old body's corners, which are in pixels of the old file's texture
    const textureNow = after.info.textures.find((t) => t.name === name);
    const toOldU = source.width / textureNow.width;
    const toOldV = source.height / textureNow.height;
    const textureBefore = before.info.textures.find((t) => t.name === oldName);
    const fileToOldU = textureBefore ? source.width / textureBefore.width : 1;
    const fileToOldV = textureBefore ? source.height / textureBefore.height : 1;

    // the old body's triangles in space, and where each lay on the picture (in pixels of the new texture)
    const oldTriangles = before.tris
      .filter((t) => t.tex?.name === oldName)
      .map((t) => {
        const mid = [0, 1, 2].map((k) => (t.c[0].p[k] + t.c[1].p[k] + t.c[2].p[k]) / 3);
        return {
          c: t.c,
          mid,
          far: Math.max(...t.c.map((c) => Math.hypot(...sub(c.p, mid)))),
          n: unit(cross(sub(t.c[1].p, t.c[0].p), sub(t.c[2].p, t.c[0].p)).map((v) => v * FRONT)),
        };
      });
    const oldLayouts = new Set(
      oldTriangles.map((t) => layoutKey(t.c, fileToOldU / toOldU, fileToOldV / toOldV)),
    );
    const triangleKey = (where, tri) => `${where.bodypart}|${where.model}|${where.mesh}|${tri}`;
    const layoutNow = new Map(
      after.tris
        .filter((t) => t.tex?.name === name)
        .map((t) => [triangleKey(t.where, t.tri), layoutKey(t.c, 1, 1)]),
    );

    // the parts: the new shape's triangles on its picture, the old one's in each part's own measure
    const byParts = Boolean(was && is);
    const oldParts = new Map();
    const newFlat = byParts
      ? is
          .filter((t) => t[0].of !== undefined)
          .map((t, i) =>
            flatOf(
              t.map((c) => c.uv[0] * textureNow.width),
              t.map((c) => c.uv[1] * textureNow.height),
              { tri: t, i },
            ),
          )
      : [];
    const newCount = new Map();
    if (byParts) {
      for (const t of was) {
        const partName = t[0].of;
        if (partName === undefined) continue;
        if (!oldParts.has(partName)) oldParts.set(partName, []);
        const measure = t.every((c) => c.q) ? t.map((c) => c.q) : null;
        oldParts.get(partName).push(
          flatOf(
            measure ? measure.map((v) => v[0]) : [0, 0, 0],
            measure ? measure.map((v) => v[1]) : [0, 0, 0],
            {
              uv: t.map((c) => [c.uv[0] * source.width, c.uv[1] * source.height]),
              q: measure,
              of: oldParts.get(partName),
            },
          ),
        );
      }
      // each new triangle's number within its part, for a part made by hand
      for (const flat of newFlat) {
        const partName = flat.tri[0].of;
        flat.nth = newCount.get(partName) ?? 0;
        newCount.set(partName, flat.nth + 1);
      }
    }
    /**
     * The way along the part `partName` from the new shape to the old one, whose measured triangles are
     * given.
     */
    const alongPart = (measured, partName) =>
      alongOf(
        ringsOf(measured.map((flat) => flat.q)),
        ringsOf(
          newFlat
            .filter((flat) => flat.tri[0].of === partName && flat.tri.every((c) => c.q))
            .map((flat) => flat.tri.map((c) => c.q)),
        ),
      );

    const counts = (report[name] = { pixels: 0, part: 0, same: 0, place: 0, lost: 0, far: 0 });
    // the triangles found last, tried first for the next pixel
    let lastNew = null;
    let lastOld = null;

    /**
     * Way 1: the colour at the same place of the same part, or nothing when the pixel is in no part both
     * have.
     */
    const fromPart = (place) => {
      const held = holding(newFlat, place.u, place.v, lastNew);
      const partName = held?.t.tri[0].of;
      const oldPart = held && oldParts.get(partName);
      if (!held || !oldPart) return undefined;
      lastNew = held.t;
      const tri = held.t.tri;
      let oldFlat = null;
      let weights = held.w;
      if (tri.every((c) => c.q)) {
        const q = [0, 1].map(
          (k) => tri[0].q[k] * held.w[0] + tri[1].q[k] * held.w[1] + tri[2].q[k] * held.w[2],
        );
        oldPart.measured ??= oldPart.filter((flat) => flat.q);
        oldPart.along ??= alongPart(oldPart.measured, partName);
        const heldOld = holding(
          oldPart.measured,
          oldPart.along(q[0]),
          q[1],
          lastOld?.of === oldPart ? lastOld : null,
        );
        if (heldOld) {
          oldFlat = lastOld = heldOld.t;
          weights = heldOld.w;
        }
      } else if (oldPart.length === newCount.get(partName)) {
        // a part made by hand: triangle for triangle, when it has as many as it had
        oldFlat = oldPart[held.t.nth];
      }
      if (!oldFlat) return undefined;
      counts.part++;
      return read(
        oldFlat.uv[0][0] * weights[0] + oldFlat.uv[1][0] * weights[1] + oldFlat.uv[2][0] * weights[2],
        oldFlat.uv[0][1] * weights[0] + oldFlat.uv[1][1] * weights[1] + oldFlat.uv[2][1] * weights[2],
      );
    };

    /**
     * Way 2: the colour at the nearest point of the old body that faces the same way, or nothing past
     * `reach`.
     */
    const fromPlace = (place) => {
      const p = moved ? moved(place.p, place) : place.p;
      let best = null;
      let bestDistance = reach;
      for (const t of oldTriangles) {
        // facing away, or too far for any point of it to be nearer than the best
        if (
          dot(t.n, place.n) <= 0 ||
          Math.hypot(t.mid[0] - p[0], t.mid[1] - p[1], t.mid[2] - p[2]) - t.far > bestDistance
        )
          continue;
        const w = nearestOn(p, t.c[0].p, t.c[1].p, t.c[2].p);
        const distance = Math.hypot(
          ...[0, 1, 2].map((k) => t.c[0].p[k] * w[0] + t.c[1].p[k] * w[1] + t.c[2].p[k] * w[2] - p[k]),
        );
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = { t, w };
        }
      }
      if (!best) {
        counts.lost++;
        return undefined;
      }
      counts.place++;
      counts.far = Math.max(counts.far, bestDistance);
      const { t, w } = best;
      return read(
        (t.c[0].u * w[0] + t.c[1].u * w[1] + t.c[2].u * w[2]) * fileToOldU,
        (t.c[0].v * w[0] + t.c[1].v * w[1] + t.c[2].v * w[2]) * fileToOldV,
      );
    };

    const carry = (place) => {
      counts.pixels++;
      // way 0: the triangle lies on the picture where one of the old body lay
      if (oldLayouts.has(layoutNow.get(triangleKey(place.where, place.tri)))) {
        counts.same++;
        return read(place.u * toOldU, place.v * toOldV);
      }
      if (newFlat.length) {
        const colour = fromPart(place);
        if (colour) return colour;
      }
      return fromPlace(place);
    };
    mdl = paint(mdl, carry, { pose: stand, only: [name], soft }).mdl;

    counts.far = +counts.far.toFixed(3);
    // with `soft`, the function was asked soft x soft times a pixel
    if (soft > 1)
      for (const k of ["pixels", "part", "same", "place", "lost"])
        counts[k] = Math.round(counts[k] / (soft * soft));
  }
  return { mdl, report };
}
