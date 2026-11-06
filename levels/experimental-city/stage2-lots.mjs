// Stage 2, blocks and lots: on each layer of the tile, the blocks are what the ways and plazas leave (cut by
// district); each block's frontage is cut into lots. Only the description's enterable buildings get enterable lots
// (their footprint at `at`, the side and door facing their frontage); every other lot is a facade of its
// district (a kind, a variant, a height in storeys) for later stages to dress. Writes 02-lots.json.
//
// Written rules for what the description leaves open (each recorded in the artifact):
//  - a facade lot is cut along a block's frontage, the sides taken in the order s, e, n, w and each from its least
//    corner, `LOT[density]` cells wide (a seeded step of up to a cell either way) and deep; a run of frontage
//    narrower or shallower than `MIN_LOT` is left a blank wall of the block;
//  - an enterable building's door is on the side of its footprint that faces most of its frontage (ties: the
//    nearer, then the side facing the city's gate), at the middle of the stretch facing it, at the rulebook's
//    typical door width for its owner (residents: house, business: shop, the rest: public);
//  - a facade's storeys are seeded in `STOREYS[density]`, never above its layer's height; under the sky (a sky
//    layer, or a deck layer outside the layer above's bounds) a range past that height is shifted down under it,
//    keeping its spread, and a lot there takes a height other than its block's last lot's (in a deck layer's ring
//    under the sky, its last two lots'), so the skyline's heights still differ (stage 9's M11, M12).
import {
  r3, half, dist, clamp, rectOf, box4, rectFromBox, rectCentre, roundRect, overlapDepth, pointBoxDist, boxInside,
  polylineBoxDist, pointPolylineDist, sideSeg, sideLength, pointOnSide, NORMAL, SIDES, seeded, seedOf,
} from "./geom.mjs";
import { tileAt } from "./site.mjs";
import { siteGrid, K, RES, N4 } from "./raster.mjs";

export const LOT = { dense: [3, 4], medium: [4, 5], sparse: [6, 6] }; // [frontage width, depth] in cells
export const MIN_LOT = [2, 2];
export const STOREYS = { dense: [3, 5], medium: [2, 4], sparse: [2, 3] };
export const FACADE_KINDS = {
  slum: ["sewer-front", "shack-front"],
  low: ["tenement", "warehouse-front"],
  mid: ["row-house", "blind-shopfront"],
  high: ["townhouse", "office-front"],
  elite: ["palazzo", "colonnade-front"],
};
export const VARIANTS = 4;
const DOOR_KIND = { residents: "house", business: "shop", city: "public", msr: "public", insurgents: "house" };

/** The frontage of a rect: its geometry ({ way, parts, width } | { plaza, box } | { node, at, halfWidth }) from the site. */
export function frontageGeom(site, desc, id) {
  const w = site.ways.find((x) => x.id === id);
  if (w) return { kind: "way", id, parts: w.parts, width: w.width };
  const p = site.plazas.find((x) => x.id === id);
  if (p) return { kind: "plaza", id, box: p.box };
  const n = desc.streets.nodes.find((x) => x.id === id);
  if (n) {
    const widths = site.ways.filter((x) => (x.from === id || x.to === id) && x.class !== "service").map((x) => x.width);
    return { kind: "node", id, at: n.at, halfWidth: Math.max(0, ...widths) / 2 };
  }
  const s = desc.streets.segments.find((x) => x.id === id);
  if (s) {
    const [a, b] = [desc.streets.nodes.find((x) => x.id === s.from), desc.streets.nodes.find((x) => x.id === s.to)];
    return { kind: "way", id, parts: [[a.at, b.at]], width: s.width ?? 4 };
  }
  return null;
}
/** How far a point is from the frontage's edge (0 inside it). */
export function gapTo(f, p) {
  if (!f) return Infinity;
  if (f.kind === "way") return Math.max(0, Math.min(...f.parts.map((pl) => pointPolylineDist(p, pl))) - f.width / 2);
  if (f.kind === "plaza") return pointBoxDist(p, f.box);
  return Math.max(0, dist(p, f.at) - f.halfWidth);
}

/** The side of a rect facing its frontage and the door on it: { side, at, gap, facing }. */
export function doorOf(rect, f, { maxDoorGap = 1, doorWidth = 0.5, gateAt = null } = {}) {
  const c = rectCentre(rect);
  const cands = SIDES.map((side) => {
    const [a, b] = sideSeg(rect, side);
    const L = sideLength(rect, side);
    const n = NORMAL[side];
    const steps = Math.max(1, Math.round(L / 0.25));
    const facing = [];
    let gap = Infinity;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const probe = [p[0] + n[0] * 0.25, p[1] + n[1] * 0.25];
      const gp = gapTo(f, probe);
      gap = Math.min(gap, gp);
      if (gp <= maxDoorGap) facing.push(t * L);
    }
    const g = gateAt ? (gateAt[0] - c[0]) * n[0] + (gateAt[1] - c[1]) * n[1] : 0;
    return { side, L, facing, gap, toGate: g };
  });
  cands.sort((p, q) => q.facing.length - p.facing.length || p.gap - q.gap || q.toGate - p.toGate || SIDES.indexOf(p.side) - SIDES.indexOf(q.side)); // prettier-ignore
  const best = cands[0];
  // the door: on the quarter-cell steps of the side, the opening nearest its frontage, then nearest the middle of
  // the stretch facing it
  const hw = Math.min(doorWidth / 2, best.L / 2);
  const mid = best.facing.length ? (best.facing[0] + best.facing[best.facing.length - 1]) / 2 : best.L / 2;
  let pick = null;
  for (let at = Math.ceil(hw * 4) / 4; at <= best.L - hw + 1e-9; at += 0.25) {
    const gap = doorGap(rect, best.side, at, doorWidth, f);
    if (!pick || gap < pick.gap - 1e-6 || (Math.abs(gap - pick.gap) <= 1e-6 && Math.abs(at - mid) < Math.abs(pick.at - mid))) pick = { at: r3(at), gap }; // prettier-ignore
  }
  pick ??= { at: r3(best.L / 2), gap: doorGap(rect, best.side, best.L / 2, doorWidth, f) };
  return { side: best.side, at: pick.at, gap: r3(pick.gap), facing: r3(best.facing.length ? best.facing[best.facing.length - 1] - best.facing[0] : 0) }; // prettier-ignore
}

/** How far a door's opening (`width` cells, centred `at` along the side) is from the frontage's edge, at its nearest. */
export function doorGap(rect, side, at, width, f) {
  let best = Infinity;
  for (let k = -2; k <= 2; k++) best = Math.min(best, gapTo(f, pointOnSide(rect, side, clamp(at + (k * width) / 4, 0, sideLength(rect, side)))));
  return best;
}

/** Whether a rect of layer L stands under the sky: a sky layer, or a deck layer outside the layer above's bounds. */
function underSky(L, rect, desc) {
  if (L.ceiling === "sky") return true;
  if (L.ceiling !== "deck") return false;
  const up = desc.layers.find((x) => x.level === L.level + 1);
  if (!up) return true;
  const c = rectCentre(rect);
  const b = up.bounds;
  return !(c[0] > b[0] && c[0] < b[2] && c[1] > b[1] && c[1] < b[3]);
}

function run(ctx) {
  const d0 = ctx.inputs["00-description.json"];
  const site = ctx.inputs["01-site.json"];
  const desc = d0.description;
  const rb = d0.rulebook;
  const tile = site.tile.id;
  const cellM = desc.grid.cell;
  const mPerU = rb.units.metresPerUnit;
  const storeyM = r3(desc.grid.storey * cellM);
  const maxDoorGap = desc.rules?.placement?.maxDoorGap ?? 1;
  const gate = desc.streets.nodes.find((n) => n.kind === "gate");
  const districtOf = new Map(desc.districts.map((d) => [d.id, d]));
  const lots = [];
  const blocks = [];
  const measures = { layers: {} };

  for (const L of site.layers) {
    const g = siteGrid(site, desc, L.id);
    // blocks: the districts' floor the ways leave, 4-connected, cut at district borders
    let nb = 0;
    const comp = [];
    for (let j = 0; j < g.ny; j++)
      for (let i = 0; i < g.nx; i++) {
        const k0 = g.idx(i, j);
        if (g.kind[k0] !== K.BACK || g.block[k0] >= 0) continue;
        const id = nb++;
        const cells = [];
        const q = [[i, j]];
        g.block[k0] = id;
        while (q.length) {
          const [a, b] = q.pop();
          cells.push([a, b]);
          for (const [di, dj] of N4) {
            const [x, y] = [a + di, b + dj];
            if (!g.inside(x, y)) continue;
            const k = g.idx(x, y);
            if (g.kind[k] === K.BACK && g.block[k] < 0 && g.district[k] === g.district[k0]) (g.block[k] = id), q.push([x, y]); // prettier-ignore
          }
        }
        comp.push({ id, district: g.district[k0], cells });
      }
    const blockId = (n) => `blk_${tile}_${L.id}_${String(n).padStart(2, "0")}`;
    const minBlockCells = (MIN_LOT[0] * MIN_LOT[1]) / (RES * RES);

    // enterable lots: the description's buildings standing in this tile on this layer
    const here = (desc.buildings ?? []).filter((b) => districtOf.get(b.district)?.layer === L.id && b.at && tileAt(desc, b.at) === tile); // prettier-ignore
    const layerLots = [];
    for (const b of here) {
      const rect = roundRect(rectOf(b.at, b.footprint));
      const f = frontageGeom(site, desc, b.frontage);
      const doorKind = b.type === "huts" ? "house" : (DOOR_KIND[b.owner] ?? "public");
      const widthM = r3(rb.dimensions.doors[doorKind].width.typical * mPerU);
      const door = doorOf(rect, f, { maxDoorGap, doorWidth: widthM / cellM, gateAt: gate?.at });
      const counts = new Map();
      for (const [i, j] of g.cellsInBox(box4(rect))) {
        const bl = g.block[g.idx(i, j)];
        if (bl >= 0) counts.set(bl, (counts.get(bl) ?? 0) + 1);
      }
      const bl = [...counts].sort((p, q) => q[1] - p[1] || p[0] - q[0])[0]?.[0];
      const lot = {
        id: `lot_${b.id}`,
        building: b.id,
        tile,
        layer: L.id,
        rect,
        frontage: { way: b.frontage, side: door.side, door: { at: door.at, width_m: widthM, kind: doorKind } },
        zBase: L.floor,
        storeys: b.storeys,
        storeyHeight_m: storeyM,
        kind: b.interior ? "enterable" : "facade",
        type: b.type,
        owner: b.owner,
        district: b.district,
        block: bl === undefined ? null : blockId(bl),
        standsOn: f?.kind === "plaza" && overlapDepth(box4(rect), f.box) > 0 ? f.id : null,
        doorGap: door.gap,
      };
      if (!b.interior) lot.facade = { kind: `${b.type}-front`, variant: 0, storeys: b.storeys, height: r3(b.storeys * desc.grid.storey) }; // prettier-ignore
      // a tower: a shell over the roof (no rooms, never enterable), its crown on the layer's storey grid
      if (b.tower) lot.tower = { at: b.tower.at ?? b.at, across: b.tower.across, silhouette: b.tower.silhouette, storeys: b.tower.storeys, z: [r3(L.floor + b.storeys * desc.grid.storey), r3(L.floor + (b.storeys + b.tower.storeys) * desc.grid.storey)], enterable: false }; // prettier-ignore
      layerLots.push(lot);
      for (const [i, j] of g.cellsInBox(box4(rect))) {
        const k = g.idx(i, j);
        g.kind[k] = K.LOT;
        g.owner[k] = lot.id;
      }
    }

    // facade lots along each block's frontage
    const scrap = new Set(comp.filter((c) => c.cells.length < minBlockCells).map((c) => c.id));
    const isPublic = (i, j) => g.inside(i, j) && (g.kind[g.idx(i, j)] === K.WAY || g.kind[g.idx(i, j)] === K.PLAZA);
    const free = (i, j, bl) => g.inside(i, j) && g.kind[g.idx(i, j)] === K.BACK && g.block[g.idx(i, j)] === bl;
    const ORDER = [
      { side: "s", f: [0, -1], along: [1, 0], depth: [0, 1] },
      { side: "e", f: [1, 0], along: [0, 1], depth: [-1, 0] },
      { side: "n", f: [0, 1], along: [1, 0], depth: [0, -1] },
      { side: "w", f: [-1, 0], along: [0, 1], depth: [1, 0] },
    ];
    let nf = 0;
    for (const o of ORDER) {
      const js = [...Array(g.ny).keys()];
      const is = [...Array(g.nx).keys()];
      if (o.side === "n") js.reverse();
      if (o.side === "e") is.reverse();
      const outer = o.side === "s" || o.side === "n" ? js : is;
      const inner = o.side === "s" || o.side === "n" ? is : js;
      for (const u of outer)
        for (const v of inner) {
          const [i, j] = o.side === "s" || o.side === "n" ? [v, u] : [u, v];
          const k = g.idx(i, j);
          const bl = g.block[k];
          if (g.kind[k] !== K.BACK || bl < 0 || scrap.has(bl) || !isPublic(i + o.f[0], j + o.f[1])) continue;
          const district = districtOf.get(g.district[k]);
          const [W, D] = LOT[district.density] ?? LOT.medium;
          const rng = seeded(seedOf(ctx.params.seed, `${tile}:${L.id}:${i}:${j}:${o.side}`));
          const wantW = Math.max(MIN_LOT[0], W + [-1, -0.5, 0, 0.5, 1][Math.floor(rng() * 5)]) / RES;
          let w = 0;
          while (w < wantW && free(i + o.along[0] * w, j + o.along[1] * w, bl) && isPublic(i + o.along[0] * w + o.f[0], j + o.along[1] * w + o.f[1])) w++; // prettier-ignore
          if (w * RES < MIN_LOT[0]) continue;
          let dd = 0;
          const wantD = D / RES;
          while (dd < wantD) {
            let ok = true;
            for (let a = 0; a < w && ok; a++) ok = free(i + o.along[0] * a + o.depth[0] * dd, j + o.along[1] * a + o.depth[1] * dd, bl); // prettier-ignore
            if (!ok) break;
            dd++;
          }
          if (dd * RES < MIN_LOT[1]) continue;
          const cells = [];
          for (let a = 0; a < w; a++) for (let t = 0; t < dd; t++) cells.push([i + o.along[0] * a + o.depth[0] * t, j + o.along[1] * a + o.depth[1] * t]); // prettier-ignore
          const xs = cells.map(([x]) => x);
          const ys = cells.map(([, y]) => y);
          const rect = roundRect(rectFromBox([g.box[0] + Math.min(...xs) * RES, g.box[1] + Math.min(...ys) * RES, g.box[0] + (Math.max(...xs) + 1) * RES, g.box[1] + (Math.max(...ys) + 1) * RES])); // prettier-ignore
          const ways = new Map();
          for (let a = 0; a < w; a++) {
            const id = g.owner[g.idx(i + o.along[0] * a + o.f[0], j + o.along[1] * a + o.f[1])];
            ways.set(id, (ways.get(id) ?? 0) + 1);
          }
          const way = [...ways].sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1))[0][0];
          const id = `f_${tile}_${L.id}_${String(++nf).padStart(3, "0")}`;
          for (const [x, y] of cells) (g.kind[g.idx(x, y)] = K.FACADE), (g.owner[g.idx(x, y)] = id);
          const kinds = FACADE_KINDS[district.wealth] ?? FACADE_KINDS.mid;
          const [s0, s1] = STOREYS[district.density] ?? STOREYS.medium;
          const cap = Math.max(1, Math.floor((L.top - L.floor) / desc.grid.storey));
          // under the sky a range the cap cuts keeps its spread, shifted down under the cap: clamped, a dense
          // district's 3-5 storeys on a 4-storey layer fall on two heights, most at the top, and stage 9's skyline
          // (M12: three roof heights in a face's 20 cells) cannot be met there; under a deck or a vault, as before
          const shifted = s1 > cap && underSky(L, rect, desc);
          const [lo, hi] = shifted ? [Math.max(1, Math.min(s0, cap - (s1 - s0))), cap] : [s0, s1];
          let storeys = Math.min(cap, lo + Math.floor(rng() * (hi - lo + 1)));
          const inBlock = layerLots.filter((x) => x.kind === "facade" && x.block === blockId(bl));
          const prev = inBlock.at(-1);
          // there, as the variant does, a height other than the block's last lot's; in a deck layer's ring under the
          // sky (no tier rises past the layer's top there), other than its last two lots' when the range has three
          const ring = L.ceiling === "deck" && underSky(L, rect, desc);
          const avoid = new Set((ring ? inBlock.slice(-2) : shifted ? inBlock.slice(-1) : []).map((x) => x.facade.storeys));
          if (avoid.has(storeys)) for (let k = 1; k <= hi - lo; k++) {
            const s = lo + ((storeys - lo + k) % (hi - lo + 1));
            if (!avoid.has(s)) {
              storeys = Math.min(cap, s);
              break;
            }
          }
          let variant = Math.floor(rng() * VARIANTS);
          if (prev && prev.facade.variant === variant) variant = (variant + 1) % VARIANTS;
          layerLots.push({
            id,
            kind: "facade",
            tile,
            layer: L.id,
            district: district.id,
            block: blockId(bl),
            rect,
            frontage: { way, side: o.side },
            zBase: L.floor,
            facade: {
              kind: district.density === "dense" ? kinds[0] : kinds[Math.floor(rng() * kinds.length)],
              palette: district.id,
              variant,
              storeys,
              height: r3(storeys * desc.grid.storey),
              storeyHeight_m: storeyM,
            },
          });
        }
    }

    // the blocks as recorded: outline as row runs, area, district, frontage left blank
    for (const c of comp) {
      const runs = [];
      const byRow = new Map();
      for (const [i, j] of c.cells) (byRow.get(j) ?? byRow.set(j, []).get(j)).push(i);
      for (const [j, is] of [...byRow].sort((p, q) => p[0] - q[0])) {
        is.sort((p, q) => p - q);
        let s = is[0];
        for (let k = 1; k <= is.length; k++)
          if (k === is.length || is[k] !== is[k - 1] + 1) {
            runs.push([r3(g.box[0] + s * RES), r3(g.box[1] + j * RES), r3(g.box[0] + (is[k - 1] + 1) * RES), r3(g.box[1] + (j + 1) * RES)]); // prettier-ignore
            s = is[k];
          }
      }
      let blank = 0;
      for (const [i, j] of c.cells)
        if (g.kind[g.idx(i, j)] === K.BACK && N4.some(([di, dj]) => isPublic(i + di, j + dj))) blank++;
      const xs = c.cells.map(([x]) => x);
      const ys = c.cells.map(([, y]) => y);
      blocks.push({
        id: blockId(c.id),
        layer: L.id,
        district: c.district,
        area: r3(c.cells.length * RES * RES),
        box: [r3(g.box[0] + Math.min(...xs) * RES), r3(g.box[1] + Math.min(...ys) * RES), r3(g.box[0] + (Math.max(...xs) + 1) * RES), r3(g.box[1] + (Math.max(...ys) + 1) * RES)], // prettier-ignore
        rows: runs,
        scrap: scrap.has(c.id),
        blankFrontage: r3(blank * RES),
        lots: layerLots.filter((x) => x.block === blockId(c.id)).map((x) => x.id),
      });
    }
    lots.push(...layerLots);
    const ent = layerLots.filter((x) => x.kind === "enterable").length;
    measures.layers[L.id] = {
      blocks: comp.filter((c) => !scrap.has(c.id)).length,
      scraps: scrap.size,
      lots: layerLots.length,
      enterable: ent,
      facades: layerLots.length - ent,
      blankFrontage: r3(blocks.filter((b) => b.layer === L.id).reduce((s, b) => s + b.blankFrontage, 0)),
    };
  }
  const ent = lots.filter((x) => x.kind === "enterable").length;
  measures.lots = lots.length;
  measures.enterable = ent;
  measures.facades = lots.length - ent;
  measures.enterableShare = lots.length ? r3(ent / lots.length) : 0;
  return { tile: site.tile, rules: { LOT, MIN_LOT, STOREYS, FACADE_KINDS, VARIANTS, doorKinds: DOOR_KIND }, blocks, lots, measures };
}

function gate(a, ctx) {
  const failures = [];
  const notes = [];
  const desc = ctx.inputs["00-description.json"].description;
  const site = ctx.inputs["01-site.json"];
  const R = desc.rules ?? {};
  const RB = R.buildings ?? {};
  const { maxDoorGap = 1, overlap = 0.25 } = R.placement ?? {};
  const tb = site.tile.box;
  const districtOf = new Map(desc.districts.map((d) => [d.id, d]));
  const named = new Map((desc.buildings ?? []).map((b) => [b.id, b]));
  const solid = (w) => w.class !== "service" && !w.winding;
  for (const lot of a.lots) {
    const box = box4(lot.rect);
    const name = lot.kind === "enterable" ? `${lot.id} (${lot.building})` : lot.id;
    if (lot.kind === "enterable") {
      const b = named.get(lot.building);
      if (!b || !b.interior) failures.push(`lots: ${lot.id} is enterable but the description names no enterable building ${lot.building}`); // prettier-ignore
      const d = districtOf.get(lot.district);
      const out = d ? Math.max(d.area[0] - box[0], d.area[1] - box[1], box[2] - d.area[2], box[3] - d.area[3]) : Infinity;
      if (out > 0.01) failures.push(`placement: ${name} reaches ${r3(out)} cells outside its district ${lot.district}`);
      if (!boxInside(box, tb, 0.001)) failures.push(`placement: ${name} crosses the edge of ${site.tile.id}; a building is one tile's`); // prettier-ignore
      for (const p of site.plazas) if (p.layer === lot.layer && p.id !== lot.frontage.way && overlapDepth(box, p.box) > overlap) failures.push(`placement: ${name} stands ${r3(overlapDepth(box, p.box))} cells into plaza ${p.id}`); // prettier-ignore
      const f = frontageGeom(site, desc, lot.frontage?.way);
      if (!lot.frontage?.door || !"nsew".includes(lot.frontage.side)) {
        failures.push(`lots: ${name} has no door on a side facing its frontage`);
        continue;
      }
      const gap = doorGap(lot.rect, lot.frontage.side, lot.frontage.door.at, lot.frontage.door.width_m / desc.grid.cell, f);
      if (!(gap <= maxDoorGap + 1e-9)) failures.push(`placement: ${name}'s door is ${gap === Infinity ? "nowhere near" : `${r3(gap)} cells from`} its frontage ${lot.frontage.way}, at most ${maxDoorGap}`); // prettier-ignore
      if (!(lot.frontage.door.at >= 0 && lot.frontage.door.at <= sideLength(lot.rect, lot.frontage.side))) failures.push(`lots: ${name}'s door at ${lot.frontage.door.at} is off its ${lot.frontage.side} side`); // prettier-ignore
    }
    for (const w of site.ways) {
      if (w.layer !== lot.layer || !solid(w)) continue; // its frontage too: a building fronts its way, never stands in it
      const depth = w.width / 2 - Math.min(...w.parts.map((pl) => polylineBoxDist(pl, box)));
      if (depth > overlap) failures.push(`placement: ${name} stands ${r3(depth)} cells into ${w.class} ${w.id}`);
    }
  }
  const byLayer = new Map();
  for (const lot of a.lots) (byLayer.get(lot.layer) ?? byLayer.set(lot.layer, []).get(lot.layer)).push(lot);
  for (const [lid, ls] of byLayer) {
    for (let i = 0; i < ls.length; i++)
      for (let j = i + 1; j < ls.length; j++) {
        const dd = overlapDepth(box4(ls[i].rect), box4(ls[j].rect));
        if (dd > 0.01) failures.push(`lots: ${ls[i].id} and ${ls[j].id} overlap by ${r3(dd)} cells on ${lid}`);
      }
    const ent = ls.filter((x) => x.kind === "enterable").length;
    if (ent > (RB.maxEnterablePerLayer ?? Infinity)) failures.push(`budget: ${lid} has ${ent} enterable lots in ${site.tile.id}, at most ${RB.maxEnterablePerLayer}`); // prettier-ignore
  }
  // the layer's cap held city-wide too (the description's enterable buildings by layer)
  const cityLayer = new Map();
  for (const b of desc.buildings ?? []) if (b.interior) cityLayer.set(districtOf.get(b.district).layer, (cityLayer.get(districtOf.get(b.district).layer) ?? 0) + 1); // prettier-ignore
  for (const [lid, n] of cityLayer) if (n > (RB.maxEnterablePerLayer ?? Infinity)) failures.push(`budget: ${lid} has ${n} enterable buildings in the city, at most ${RB.maxEnterablePerLayer}`); // prettier-ignore
  const ent = a.lots.filter((x) => x.kind === "enterable").length;
  const share = a.lots.length ? ent / a.lots.length : 0;
  if (RB.maxEnterableLotShare !== undefined && share > RB.maxEnterableLotShare + 1e-9) failures.push(`budget: ${ent} of ${a.lots.length} lots in ${site.tile.id} are enterable (${Math.round(share * 100)} %), at most ${Math.round(RB.maxEnterableLotShare * 100)} %: the rest are facades`); // prettier-ignore
  // every enterable building of the description standing in this tile has its lot
  for (const b of desc.buildings ?? []) {
    if (!b.interior || !b.at || tileAt(desc, b.at) !== site.tile.id) continue;
    if (!site.layers.some((L) => L.id === districtOf.get(b.district).layer)) continue;
    if (!a.lots.some((x) => x.building === b.id && x.kind === "enterable")) failures.push(`lots: ${b.id} is an enterable building of ${site.tile.id} with no lot`); // prettier-ignore
  }
  // blockFill: a block's enterable lots against its area
  for (const bl of a.blocks) {
    const area = a.lots.filter((x) => x.kind === "enterable" && x.block === bl.id).reduce((s, x) => s + x.rect.w * x.rect.d, 0);
    if (area > bl.area * (RB.blockFill ?? 1) + 1e-9 && bl.area > 0) notes.push(`lots: ${bl.id}'s enterable lots cover ${r3(area)} cells of its ${bl.area} (blockFill ${RB.blockFill}); the building spills over its block's ways`); // prettier-ignore
  }
  return { failures, notes };
}

export const stage = { n: 2, name: "lots", reads: ["00-description.json", "01-site.json"], run, gate };
