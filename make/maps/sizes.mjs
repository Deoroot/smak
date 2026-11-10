// The sizes of the game's pieces, by the kind of map, read from its own maps (maps/natural/tools/pieces.mjs,
// 92 maps, 2026-10-18): what a door, a step, a roof, a room's height and a way's width come to there, as
// [lower quartile, median, upper quartile] in units (a player is 72 high). Made things are made to these by
// rule, not copied: and a ruin to stand as a landmark (`ruin`).
import { brokenWall } from "./pieces.mjs";
import { boulder } from "./scatter.mjs";

export const SIZES = {
  wild: { door: { wide: [64, 96, 96], high: [96, 128, 144], thick: [4, 8, 16] }, step: { rise: [8, 16, 16], tread: [16, 20, 32] }, roof: [44, 53, 57], ceiling: [160, 272, 448], way: [194, 259, 367] }, // prettier-ignore
  settlement: { door: { wide: [64, 64, 96], high: [96, 112, 128], thick: [5, 8, 8] }, step: { rise: [8, 16, 16], tread: [16, 24, 32] }, roof: [29, 44, 54], ceiling: [144, 200, 264], way: [194, 194, 194] }, // prettier-ignore
  fortress: { door: { wide: [64, 112, 144], high: [128, 152, 188], thick: [8, 16, 16] }, step: { rise: [8, 16, 16], tread: [20, 32, 32] }, roof: [45, 63, 63], ceiling: [176, 240, 256], way: [130, 194, 259] }, // prettier-ignore
  dungeon: { door: { wide: [64, 64, 112], high: [120, 128, 128], thick: [8, 8, 16] }, step: { rise: [8, 8, 16], tread: [16, 21, 32] }, roof: [26, 26, 46], ceiling: [136, 216, 336], way: [130, 130, 194] }, // prettier-ignore
  cave: { door: { wide: [56, 64, 96], high: [104, 128, 128], thick: [6, 8, 8] }, step: { rise: [8, 16, 16], tread: [16, 24, 48] }, roof: [40, 45, 50], ceiling: [128, 224, 384], way: [130, 151, 259] }, // prettier-ignore
};

function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => (s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0) / 4294967296;
}

/**
 * A ruined house: four broken walls round a footprint `size` [wide, deep] at `at` [x, y], turned `turn`
 * degrees, their tops jagged from a room's height (`kind`'s ceiling) down to a third of it, a door's gap (the
 * kind's door) in the front wall (the one facing the turn's way), stones fallen inside and by the walls.
 * `groundAt(x, y)` the ground's height (the walls stand from 8 under its lowest at their ends), `texture` the
 * walls' and the stones' (a laid stone). Returns `{ brushes, box }`: the brushes (for a func_detail) and the
 * box it stands in, to be kept clear of what else is strewn.
 */
export function ruin({
  at,
  size = [320, 256],
  turn = 0,
  groundAt = () => 0,
  texture,
  kind = "settlement",
  seed = 1,
  thick = 16,
}) {
  const rand = rng(seed);
  const sizes = SIZES[kind] ?? SIZES.settlement;
  const top = sizes.ceiling[1];
  const door = sizes.door.wide[1];
  const a = (turn * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  // a corner of the footprint, from its own frame (u along the turn's way, v across) to the map's
  const place = (u, v) => [Math.round(at[0] + u * c - v * s), Math.round(at[1] + u * s + v * c)];
  const [hw, hd] = [size[1] / 2, size[0] / 2]; // u: depth (front at +u), v: width
  const corners = [place(hw, -hd), place(hw, hd), place(-hw, hd), place(-hw, -hd)];
  // the front, with the door's gap a little off its middle
  const off = (rand() - 0.5) * Math.max(0, size[0] / 3 - door);
  const walls = [
    [place(hw, -hd), place(hw, off - door / 2)],
    [place(hw, off + door / 2), place(hw, hd)],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
  ];
  const brushes = [];
  walls.forEach(([from, to], i) => {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (length < 32) return;
    const bottom = Math.floor(Math.min(groundAt(...from), groundAt(...to))) - 8;
    // the back stands highest; a wall or two has fallen further
    const high = bottom + top * (i === 3 ? 0.9 + rand() * 0.1 : 0.45 + rand() * 0.45);
    const args = {
      from,
      to,
      thick,
      bottom,
      top: Math.round(high),
      low: Math.round(bottom + top * 0.2),
      pieces: Math.max(2, Math.round(length / 64)),
      gaps: 0.15,
      rubble: 12,
      seed: seed * 7 + i,
      texture,
    };
    brushes.push(...brokenWall(args));
  });
  // fallen stones, inside and by the walls
  for (let k = 0; k < 5; k++) {
    const p = place((rand() - 0.5) * size[1] * 1.3, (rand() - 0.5) * size[0] * 1.3);
    const w = 24 + rand() * 40;
    try { brushes.push(boulder(p, groundAt(...p), [Math.round(w), Math.round(w * 0.6)], texture, Math.floor(rand() * 1e6))); } catch {} // prettier-ignore
  }
  const xs = corners.map((p) => p[0]),
    ys = corners.map((p) => p[1]);
  return {
    brushes,
    box: {
      min: [Math.min(...xs) - 48, Math.min(...ys) - 48],
      max: [Math.max(...xs) + 48, Math.max(...ys) + 48],
    },
  };
}
