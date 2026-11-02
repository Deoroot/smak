// A layer of the tile on a half-cell grid: what stands on each half cell's centre (a way, a plaza, an enterable
// lot, a facade lot, a block's back, rock), for cutting blocks and lots (stage 2) and for placing and walking
// (stage 4). Built from the artifacts only, so a gate rebuilds it from what a stage wrote.
import { pointInBox, box4, pointInPoly, polyBox, polylineBoxDist, polyOverlap, rectPoly } from "./geom.mjs";
import { districtAt } from "./site.mjs";

export const RES = 0.5;
export const K = { ROCK: 0, BACK: 1, FACADE: 2, LOT: 3, WAY: 4, PLAZA: 5 };

export class LayerGrid {
  constructor(box, layerId) {
    this.box = box;
    this.layer = layerId;
    this.nx = Math.round((box[2] - box[0]) / RES);
    this.ny = Math.round((box[3] - box[1]) / RES);
    this.kind = new Uint8Array(this.nx * this.ny);
    this.owner = new Array(this.nx * this.ny).fill(null);
    this.district = new Array(this.nx * this.ny).fill(null);
    this.block = new Int32Array(this.nx * this.ny).fill(-1);
    this.taken = new Array(this.nx * this.ny).fill(null); // stage 4: a piece, room or hallway standing here
  }
  idx(i, j) {
    return j * this.nx + i;
  }
  inside(i, j) {
    return i >= 0 && j >= 0 && i < this.nx && j < this.ny;
  }
  centre(i, j) {
    return [this.box[0] + (i + 0.5) * RES, this.box[1] + (j + 0.5) * RES];
  }
  cellOf([x, y]) {
    return [Math.floor((x - this.box[0]) / RES), Math.floor((y - this.box[1]) / RES)];
  }
  /** The half cells whose centres a box [x0, y0, x1, y1] holds. */
  *cellsInBox(b) {
    const i0 = Math.max(0, Math.ceil((b[0] - this.box[0]) / RES - 0.5));
    const i1 = Math.min(this.nx - 1, Math.floor((b[2] - this.box[0]) / RES - 0.5 - 1e-9));
    const j0 = Math.max(0, Math.ceil((b[1] - this.box[1]) / RES - 0.5));
    const j1 = Math.min(this.ny - 1, Math.floor((b[3] - this.box[1]) / RES - 0.5 - 1e-9));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) yield [i, j];
  }
  *cellsInPoly(poly) {
    for (const [i, j] of this.cellsInBox(polyBox(poly))) if (pointInPoly(this.centre(i, j), poly)) yield [i, j];
  }
  /** The half cells whose squares a convex polygon meets by more than `tol` (a piece's footprint, exactly). */
  *cellsTouching(poly, tol = 0.02) {
    const b = polyBox(poly);
    for (const [i, j] of this.cellsInBox([b[0] - RES, b[1] - RES, b[2] + RES, b[3] + RES])) {
      const [x, y] = this.centre(i, j);
      if (polyOverlap(rectPoly({ x: x - RES / 2, y: y - RES / 2, w: RES, d: RES }), poly) > tol) yield [i, j];
    }
  }
}

/** The ways (not the service hallways) and plazas of a layer, laid on its grid; the rest is the districts' (BACK) or rock. */
export function siteGrid(site, desc, layerId) {
  const tb = site.tile.box;
  const L = site.layers.find((x) => x.id === layerId);
  const g = new LayerGrid(tb, layerId);
  const ways = site.ways.filter((w) => w.layer === layerId && w.class !== "service");
  const plazas = site.plazas.filter((p) => p.layer === layerId);
  for (let j = 0; j < g.ny; j++)
    for (let i = 0; i < g.nx; i++) {
      const p = g.centre(i, j);
      const k = g.idx(i, j);
      if (!pointInBox(p, L.bounds)) continue; // rock: outside the layer
      const plaza = plazas.find((pl) => pointInBox(p, pl.box) && p[0] < pl.box[2] && p[1] < pl.box[3]);
      if (plaza) {
        g.kind[k] = K.PLAZA;
        g.owner[k] = plaza.id;
        g.district[k] = site.nodes.find((n) => n.id === plaza.id)?.district ?? districtAt(desc, layerId, p);
        continue;
      }
      // a half cell is the way's when its square meets the band (by more than 0.02): a lot or a hallway made of
      // the other half cells then never stands in a way, whatever its slant
      let best = null;
      const sq = [p[0] - RES / 2, p[1] - RES / 2, p[0] + RES / 2, p[1] + RES / 2];
      for (const w of ways) {
        const dd = Math.min(...w.parts.map((pl) => polylineBoxDist(pl, sq)));
        if (dd < w.width / 2 - 0.02 && (!best || dd < best.d)) best = { id: w.id, d: dd, district: w.district };
      }
      if (best) {
        g.kind[k] = K.WAY;
        g.owner[k] = best.id;
        g.district[k] = best.district ?? districtAt(desc, layerId, p);
        continue;
      }
      const dId = districtAt(desc, layerId, p);
      if (dId) {
        g.kind[k] = K.BACK;
        g.district[k] = dId;
      }
    }
  return g;
}

/** Lays lots on a site grid: enterable lots (over anything but their own plaza is a fault the gate names) and facades. */
export function layLots(g, lots) {
  for (const lot of lots) {
    if (lot.layer !== g.layer) continue;
    for (const [i, j] of g.cellsInBox(box4(lot.rect))) {
      const k = g.idx(i, j);
      if (lot.kind === "enterable") (g.kind[k] = K.LOT), (g.owner[k] = lot.id);
      else if (g.kind[k] === K.BACK) (g.kind[k] = K.FACADE), (g.owner[k] = lot.id);
    }
  }
  return g;
}

export const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]]; // prettier-ignore
