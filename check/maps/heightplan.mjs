// Height plans: a map's floors drawn from above, one picture a layer (layer 0 the lowest floor at a place, 1 the next
// above it...), each cell's floor height as a colour and the headroom over it as another, with a legend that says
// which colour is which height. The pictures a person or a tool can make of a level that has storeys, and that a
// map spec reads back as its floor plan (`floorplan`): every cell's open space, merged into boxes of air and carved
// out of rock in one, so that a gallery over a hall and the hall under it are one space. research/map-geometry.md,
// experiment A: drawn from frenzy and read back with no agent, the walked floor overlaps the original's 0.898 (the
// best maker's leg had 0.689), c1a0's 0.98.
//
//   heightPlanOf(map, { cell, pixels })  ->  { legend, layers: [{ floor: image, room: image }] }   (map: a read .bsp)
//   openBoxesOf(layers, legend, { grow }) ->  { boxes: [{ min, max }], cells, layers }
// An image is { width, height, rgba }. A cell with no floor on a layer is EMPTY (near black).
import { reachOf } from "./reach.mjs";
import { contentsAt, floorUnder, CONTENTS } from "../../core/maps/bsp.mjs";

/** The colour of a cell with no floor on that layer. */
export const EMPTY = [20, 20, 24];
/** Headroom is read up to this (units); an open sky over a yard is this tall. */
const HEADROOM_MOST = 1024;
/** No open space is made lower than a crouching player (72 standing, 36 crouched; a crawlway is 40 or more). */
const HEADROOM_LEAST = 80;

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

/**
 * A height plan read back into open space: each cell's floors and headroom from the colours nearest the legend's,
 * the walked floor grown by `grow` cells to the walls (a player's middle keeps 16 off them), cells of the same open
 * stretches merged into rectangles, each stretch one box of air. `layers`: [{ floor, room }] images as drawn.
 */
export function openBoxesOf(layers, legend, { grow = 1 } = {}) {
  const { cell: C, pixels: PX, x0, y1, width: W, height: H } = legend;
  const nearest = (rgb, list, key) => {
    if (Math.abs(rgb[0] - EMPTY[0]) + Math.abs(rgb[1] - EMPTY[1]) + Math.abs(rgb[2] - EMPTY[2]) < 12) return null;
    let best = null;
    let d = Infinity;
    for (const e of list) {
      const dd = (e.rgb[0] - rgb[0]) ** 2 + (e.rgb[1] - rgb[1]) ** 2 + (e.rgb[2] - rgb[2]) ** 2;
      if (dd < d) [d, best] = [dd, e[key]];
    }
    return best;
  };
  const cells = Array.from({ length: W * H }, () => []);
  for (const { floor, room } of layers) {
    if (floor.width !== W * PX || floor.height !== H * PX) throw new Error(`a layer's picture is ${floor.width} x ${floor.height}; the legend says ${W * PX} x ${H * PX}`);
    const at = (img, i, j) => {
      const k = ((j * PX + (PX >> 1)) * img.width + i * PX + (PX >> 1)) * 4;
      return [img.rgba[k], img.rgba[k + 1], img.rgba[k + 2]];
    };
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const h = nearest(at(floor, i, j), legend.heights, "h");
        if (h === null) continue;
        const up = nearest(at(room, i, j), legend.rooms, "v") ?? HEADROOM_LEAST;
        cells[j * W + i].push([h, h + Math.max(up, HEADROOM_LEAST)]);
      }
  }
  for (let g = 0; g < grow; g++) {
    const was = cells.map((c) => c.slice());
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        if (was[j * W + i].length) continue;
        let best = null;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          if (i + di < 0 || i + di >= W || j + dj < 0 || j + dj >= H) continue;
          const n = was[(j + dj) * W + i + di];
          if (!n.length) continue;
          if (!best || n.length > best.length || (n.length === best.length && n[0][0] < best[0][0])) best = n;
        }
        if (best) cells[j * W + i] = best.map((v) => v.slice());
      }
  }
  // each cell's open stretches, overlapping ones joined, as a key
  const openOf = (list) => {
    const out = [];
    for (const [a, b] of [...list].sort((p, q) => p[0] - q[0])) {
      const last = out[out.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else out.push([a, b]);
    }
    return out;
  };
  const key = cells.map((c) => JSON.stringify(openOf(c)));
  const used = new Uint8Array(W * H);
  const boxes = [];
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      if (used[j * W + i] || !cells[j * W + i].length) continue;
      const k = key[j * W + i];
      let w = 1;
      while (i + w < W && !used[j * W + i + w] && key[j * W + i + w] === k) w++;
      let h = 1;
      rows: while (j + h < H) {
        for (let u = 0; u < w; u++) if (used[(j + h) * W + i + u] || key[(j + h) * W + i + u] !== k) break rows;
        h++;
      }
      for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) used[(j + v) * W + i + u] = 1;
      // cell (i, j): x from x0 + i * C; y from its top edge y1 + C - j * C down
      const [xa, yb] = [x0 + i * C, y1 + C - j * C];
      for (const [za, zb] of JSON.parse(k)) boxes.push({ min: [xa, yb - h * C, za], max: [xa + w * C, yb, zb] });
    }
  return { boxes, cells: cells.filter((c) => c.length).length, layers: layers.length };
}
