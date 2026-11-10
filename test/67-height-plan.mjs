// A floor plan of height plans: pictures of each layer of floor (its height and the headroom over it as colours,
// with a legend) read back into open space, carved in one, storeys over storeys; what stands on it placed at the
// world's [x, y] on the floor there. research/map-geometry.md, experiment A.
import { test, sure } from "./helper.mjs";
import { openBoxesOf, colourOf, EMPTY } from "../check/maps/heightplan.mjs";

// a hall 8 by 6 cells of 32 at floor 0 with 192 of headroom, and over its east half (under a slab 16 thick, its
// headroom 112) a gallery at 128 with 96
const C = 32;
const PX = 2;
const [W, H] = [8, 6];
const legend = { cell: C, pixels: PX, x0: 0, y1: 80, width: W, height: H, layers: 2, heights: [0, 128].map((h, k) => ({ h, rgb: colourOf(k) })), rooms: [64, 96, 112, 192].map((v, k) => ({ v, rgb: colourOf(k + 3) })) };
const picture = (fill) => {
  const rgba = new Uint8Array(W * PX * H * PX * 4);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) for (let v = 0; v < PX; v++) for (let u = 0; u < PX; u++) rgba.set([...(fill(i, j) ?? EMPTY), 255], ((j * PX + v) * W * PX + i * PX + u) * 4);
  return { width: W * PX, height: H * PX, rgba };
};
const hues = (list, value) => list.find((e) => (e.h ?? e.v) === value).rgb;
const layers = [
  { floor: picture(() => hues(legend.heights, 0)), room: picture((i) => hues(legend.rooms, i >= 4 ? 112 : 192)) },
  { floor: picture((i) => (i >= 4 ? hues(legend.heights, 128) : null)), room: picture((i) => (i >= 4 ? hues(legend.rooms, 96) : null)) },
];

test("a height plan read back: each layer's floor and headroom, cells of one kind merged into boxes, storeys kept apart", () => {
  const { boxes, cells } = openBoxesOf(layers, legend, { grow: 0 });
  sure(cells === W * H, `${cells} cells with a floor`);
  const under = boxes.filter((b) => b.min[2] === 0);
  const over = boxes.filter((b) => b.min[2] === 128);
  sure(over.length >= 1 && over.every((b) => b.max[2] === 224 && b.min[0] >= 128), JSON.stringify(over));
  sure(under.some((b) => b.max[2] === 192) && under.some((b) => b.max[2] === 112), JSON.stringify(under));
  const area = boxes.reduce((n, b) => n + ((b.max[0] - b.min[0]) * (b.max[1] - b.min[1])) / (C * C), 0);
  sure(area === W * H + (W / 2) * H, `cells of the boxes ${area}`);
});
