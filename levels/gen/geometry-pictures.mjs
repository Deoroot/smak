// The R2 review's pictures (PLAN.md Phase 3, "Review stops"): plans cut from stage 10's source, sections of the tile,
// each street along its centre line and each building through its middle, drawn by SMAK's own source drawing
// (`planOfSource`, `sectionOf`, src/maps/draw.mjs). For the drawing only, the func_detail brushes are drawn as solid
// as the world's (the interiors are detail; outlined they would not read as walls); the map itself is not changed.
//
//   reviewPictures(map, { site, plans, origin }) -> [{ name, title, width, height, rgba }]
//   node levels/tools/geometry-review.mjs <out> [--png <dir>]    (the pictures of <out>'s 10-geometry as PNG files)
import { planOfSource, sectionOf } from "../../src/maps/draw.mjs";

/** The map as drawn: the detail's brushes solid, the other entities as they are. */
export function drawable(map) {
  const detail = map.entities.filter((e) => e.classname === "func_detail");
  return { worldspawn: map.worldspawn, brushes: [...map.brushes, ...detail.flatMap((e) => e.brushes)], entities: map.entities.filter((e) => e.classname !== "func_detail") }; // prettier-ignore
}

/**
 * The pictures for one tile. `site` 01-site.json, `plans` 05-plans.json, `origin` the description's grid origin (cells);
 * `width` the pictures' width
 * (pixels). Each picture's name says what it shows: plan-<tile>-<layer>, section-<tile>-ew / -ns,
 * street-<way>, building-<id>-ew / -ns.
 */
export function reviewPictures(map, { site, plans, origin = [0, 0], width = 1600, streets = true, buildings = true } = {}) {
  const d = drawable(map);
  const cu = site.grid.cellUnits;
  const [ox, oy] = origin;
  const X = (x) => (x - ox) * cu;
  const Y = (y) => (y - oy) * cu;
  const b = site.tile.box;
  const box = [X(b[0]), Y(b[1]), X(b[2]), Y(b[3])];
  const out = [];
  const id = site.tile.id;
  const zTop = Math.max(...site.layers.map((L) => (L.sky ?? L.top) * cu)) + 64;
  const layers = [...site.layers].sort((a, c) => a.floor - c.floor);
  for (const [k, L] of layers.entries()) {
    const z = L.floor * cu + 48;
    // the layer's own entities only (a point between its floor and the next layer's; a brush entity reaching into it)
    const lo = L.floor * cu - 64;
    const hi = (layers[k + 1]?.floor ?? Infinity) * cu - 64;
    const zOf = (e) => (e.origin ? Number(String(e.origin).split(" ")[2]) : null);
    const mine = d.entities.filter((e) => (e.brushes?.length ? true : zOf(e) >= lo && zOf(e) < hi));
    const im = planOfSource({ ...d, entities: mine }, { z, area: { min: [box[0], box[1]], max: [box[2], box[3]] }, width, labels: false });
    out.push({ name: `plan-${id}-${L.id}`, title: `${id} ${L.id} (${L.name}): plan cut at z ${z}`, ...im });
  }
  const mid = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  for (const [n, from, to] of [["ew", [box[0], mid[1]], [box[2], mid[1]]], ["ns", [mid[0], box[1]], [mid[0], box[3]]]]) {
    const im = sectionOf(d, { from, to, width, z: [-64, zTop], labels: false });
    out.push({ name: `section-${id}-${n}`, title: `${id}: section ${n} through the tile's middle`, ...im });
  }
  if (streets)
    for (const w of site.ways) {
      if (w.class === "service") continue;
      for (const [k, part] of (w.parts ?? []).entries()) {
        const a = [X(part[0][0]), Y(part[0][1])];
        const e = [X(part.at(-1)[0]), Y(part.at(-1)[1])];
        if (Math.hypot(e[0] - a[0], e[1] - a[1]) < 256) continue;
        const L = site.layers.find((x) => x.id === w.layer);
        const im = sectionOf(d, { from: a, to: e, width, z: [L.floor * cu - 64, ((L.sky ?? L.top) + 1) * cu], labels: false }); // prettier-ignore
        out.push({ name: `street-${w.id}${k ? `-${k}` : ""}`, title: `${w.id} (${w.layer}): section along its centre line`, ...im });
      }
    }
  if (buildings)
    for (const p of plans?.buildings ?? []) {
      const [cx, cy] = p.frame.origin_cells;
      const [sw, sd] = p.frame.size_m.map((m) => m / site.grid.cell);
      const c = [X(cx + sw / 2), Y(cy + sd / 2)];
      const L = site.layers.find((x) => x.id === p.layer);
      const z = [L.floor * cu - 64, (L.floor + p.storeys.length * site.grid.storey + 1) * cu];
      const m = 2 * cu;
      for (const [n, from, to] of [["ew", [X(cx) - m, c[1]], [X(cx + sw) + m, c[1]]], ["ns", [c[0], Y(cy) - m], [c[0], Y(cy + sd) + m]]]) {
        const im = sectionOf(d, { from, to, width: Math.min(width, 1200), z, labels: false });
        out.push({ name: `building-${p.id}-${n}`, title: `${p.id}: section ${n} through its middle`, ...im });
      }
    }
  return out;
}
