// Shared reading of a city description for the stages: the tile's rectangle and window, a way's widths, the
// districts of a layer, a description's walk graph distances (for the walk measured past a seam).
import { measureCity } from "../lib/city-description.mjs";

/** The tile's rectangle [x0, y0, x1, y1] in cells. */
export function tileBox(desc, id) {
  const t = desc.tiles;
  const [ox, oy] = t.origin ?? [0, 0];
  const [w, d] = t.size;
  const [c, r] = id.slice(1).split("_r").map(Number);
  return [ox + c * w, oy + r * d, ox + (c + 1) * w, oy + (r + 1) * d];
}
/** The tile a point stands in, or null outside every tile. */
export function tileAt(desc, [x, y]) {
  const t = desc.tiles;
  const [ox, oy] = t.origin ?? [0, 0];
  const c = Math.floor((x - ox) / t.size[0]);
  const r = Math.floor((y - oy) / t.size[1]);
  return c < 0 || r < 0 || c >= t.cols || r >= t.rows ? null : `c${c}_r${r}`;
}
/** Distance from a point to the nearest seam between two tiles (the city's outer edge is no seam). */
export function seamDistance(desc, [x, y]) {
  const t = desc.tiles;
  const [ox, oy] = t.origin ?? [0, 0];
  let best = Infinity;
  for (let c = 1; c < t.cols; c++) best = Math.min(best, Math.abs(x - (ox + c * t.size[0])));
  for (let r = 1; r < t.rows; r++) best = Math.min(best, Math.abs(y - (oy + r * t.size[1])));
  return best;
}
/** The seam names of a tile's four edges: { s: "c1_r1|c1_r0", ... } (null at the city's edge). */
export function tileSeams(desc, id) {
  const [c, r] = id.slice(1).split("_r").map(Number);
  const t = desc.tiles;
  const n = (cc, rr) => (cc < 0 || rr < 0 || cc >= t.cols || rr >= t.rows ? null : `c${cc}_r${rr}`);
  const s = (o) => (o ? `${id}|${o}` : null);
  return { s: s(n(c, r - 1)), n: s(n(c, r + 1)), w: s(n(c - 1, r)), e: s(n(c + 1, r)) };
}
export const seamMatches = (seam, a) => seam && a && new Set(seam.split("|")).size === 2 && seam.split("|").every((t) => a.split("|").includes(t)); // prettier-ignore

/** The district a point on a layer belongs to: the smallest district area holding it (description order on a tie). */
export function districtAt(desc, layerId, p) {
  let best = null;
  for (const d of desc.districts) {
    if (d.layer !== layerId) continue;
    const [x0, y0, x1, y1] = d.area;
    if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) continue;
    const area = (x1 - x0) * (y1 - y0);
    if (!best || area < best.area) best = { id: d.id, area };
  }
  return best?.id ?? null;
}

/** measureCity, kept per description object (stages call it more than once). */
const cache = new WeakMap();
export function measured(desc) {
  if (!cache.has(desc)) cache.set(desc, measureCity(desc));
  return cache.get(desc);
}

/** Dijkstra over an adjacency Map(vertex -> [[vertex, length]]). */
export function shortest(adj, starts) {
  const d = new Map(starts.map((s) => [s, 0]));
  const open = new Set(starts);
  while (open.size) {
    let best = null;
    for (const v of open) if (best === null || d.get(v) < d.get(best)) best = v;
    open.delete(best);
    for (const [n, len] of adj.get(best) ?? []) {
      const dd = d.get(best) + len;
      if (!d.has(n) || dd < d.get(n) - 1e-9) d.set(n, dd), open.add(n);
    }
  }
  return d;
}
