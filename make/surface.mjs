// The model's surface as a list of places, and the place on it nearest a point: for choosing where a mark, a
// wound or a badge lands before it is painted there.
import { posed } from "./render.mjs";
import { sub, dot, unit } from "../core/vec.mjs";

/**
 * A place "looks towards" a direction when its normal and the direction agree at least this much (a cosine).
 */
const FACING_LEAST = 0.35;

/**
 * The model's surface as it stands in `pose` (what `posed` takes: { seq, frame, body, skin }): one { p, n,
 * tex } a triangle, its middle, the way it faces and its texture's name. For choosing where things land.
 */
export function surface(src, pose = {}) {
  return posed(src, pose).tris.map((t) => ({
    p: [0, 1, 2].map((a) => (t.c[0].p[a] + t.c[1].p[a] + t.c[2].p[a]) / 3),
    n: unit([0, 1, 2].map((a) => t.c[0].n[a] + t.c[1].n[a] + t.c[2].n[a])),
    tex: t.tex?.name ?? null,
  }));
}

/**
 * The place of a surface (from `surface`) nearest `near` that looks towards `facing` and, when told, wears
 * one of the textures `on`. Null when there is none.
 */
export function spot(surf, near, facing = null, on = null) {
  let best = null;
  let bestDistance = Infinity;
  for (const place of surf) {
    if (on && !on.includes(place.tex)) continue;
    if (facing && dot(place.n, facing) < FACING_LEAST) continue;
    const distance = Math.hypot(...sub(place.p, near));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = place;
    }
  }
  return best;
}
