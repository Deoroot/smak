// Height plans: a map's floors drawn from above, one picture a layer (layer 0 the lowest floor at a place, 1 the next
// above it...), each cell's floor height as a colour and the headroom over it as another, with a legend that says
// which colour is which height: the pictures a person or a tool can make of a level that has storeys.
//
//   heightPlanOf(map, { cell, pixels })  ->  { legend, layers: [{ floor: image, room: image }] }   (map: a read .bsp)
// An image is { width, height, rgba }. A cell with no floor on a layer is EMPTY (near black).
import { reachOf } from "./reach.mjs";
import { contentsAt, floorUnder, CONTENTS } from "../../core/maps/bsp.mjs";

/** The colour of a cell with no floor on that layer. */
export const EMPTY = [20, 20, 24];
/** Headroom is read up to this (units); an open sky over a yard is this tall. */
const HEADROOM_MOST = 1024;

/** Colours far apart, spread over hue and lightness: the k-th of a legend. */
export function colourOf(k) {
  const hue = (k * 0.618034) % 1;
  const light = 0.35 + (0.4 * ((k * 7) % 5)) / 4;
  const f = (t) => {
    const x = (t + hue) % 1;
    return Math.round(255 * Math.min(1, Math.max(0, Math.abs(x * 6 - 3) - 1)) * (0.4 + light * 0.6));
  };
  return [f(0), f(2 / 3), f(1 / 3)];
}

/**
 * A compiled map's height plans: at each `cell` of its box, every floor a standing player fits on, lowest first,
 * with the headroom over it, `pixels` pixels a cell. The legend gives the cell, the world's x at the pictures' left
 * edge and y at their top, and each height's and headroom's colour (heights to 4 units, headroom to 16).
 */
export function heightPlanOf(bsp, { cell = 16, pixels = 4 } = {}) {
  const walk = reachOf(bsp);
  const { mins, maxs } = bsp.models[0];
  const x0 = Math.floor(mins[0] / cell) * cell;
  const x1 = Math.floor(maxs[0] / cell) * cell;
  const y0 = Math.floor(mins[1] / cell) * cell;
  const y1 = Math.floor(maxs[1] / cell) * cell;
  const W = (x1 - x0) / cell + 1;
  const H = (y1 - y0) / cell + 1;
  const solid = (p) => {
    const c = contentsAt(bsp, p);
    return c === CONTENTS.SOLID || c === CONTENTS.SKY;
  };
  const columns = [];
  let most = 0;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const [x, y] = [x0 + i * cell + cell / 2, y1 - j * cell + cell / 2];
      const floors = [];
      let under;
      for (let k = 0; k < 8; k++) {
        const h = walk.stands(x, y, under);
        if (typeof h !== "number") break;
        // the surface under the player's middle, as the draw sees it (the walk's own height is its clip hull's)
        const g = floorUnder(bsp, [x, y, h + 20]);
        const at = g === null ? h : g;
        let up = 1;
        while (up < HEADROOM_MOST && !solid([x, y, at + up])) up += 4;
        floors.push({ h: at, room: Math.min(up, HEADROOM_MOST) });
        under = h - 40;
      }
      floors.reverse();
      most = Math.max(most, floors.length);
      columns.push(floors);
    }
  const q = (v, s) => Math.round(v / s) * s;
  const heights = [...new Set(columns.flat().map((f) => q(f.h, 4)))].sort((a, b) => a - b);
  const rooms = [...new Set(columns.flat().map((f) => q(f.room, 16)))].sort((a, b) => a - b);
  const legend = {
    cell,
    pixels,
    x0,
    y1,
    width: W,
    height: H,
    layers: most,
    heights: heights.map((h, k) => ({ h, rgb: colourOf(k) })),
    rooms: rooms.map((v, k) => ({ v, rgb: colourOf(k + 3) })),
  };
  const layers = [];
  for (let L = 0; L < most; L++) {
    const out = {};
    for (const kind of ["floor", "room"]) {
      const rgba = new Uint8Array(W * pixels * H * pixels * 4);
      for (let j = 0; j < H; j++)
        for (let i = 0; i < W; i++) {
          const f = columns[j * W + i][L];
          const rgb = !f ? EMPTY : kind === "floor" ? legend.heights.find((e) => e.h === q(f.h, 4)).rgb : legend.rooms.find((e) => e.v === q(f.room, 16)).rgb;
          for (let v = 0; v < pixels; v++) for (let u = 0; u < pixels; u++) rgba.set([...rgb, 255], ((j * pixels + v) * W * pixels + i * pixels + u) * 4);
        }
      out[kind] = { width: W * pixels, height: H * pixels, rgba };
    }
    layers.push(out);
  }
  return { legend, layers };
}
