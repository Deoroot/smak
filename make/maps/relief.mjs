// Ground that rises and falls: a space's floor as a field of triangles, the way the game's outdoor maps make
// their ground (Isle slopes half of its floor; the orchard, all level, read as a table).
//
// Over a space's floor (level or sloped) a grid of `step` is cut in triangles, each one brush from under the
// floor up to the ground's height at its three corners. The height is the floor's own plus
//   - hummocks: soft rises of noise, `amp` high at most, a few men across;
//   - banks: the ground climbing `bank` units towards the foot of the rock round it (a cliff's scree, a
//     hollow's sides), `bankWide` across;
// and it comes down to the floor where the space opens into another (a doorway, a lane's mouth, a terrace's
// edge: the floors meet there) and inside the `clear` boxes (a house, a path, a well: flat ground). A
// triangle is kept where each of its corners is in the space or in rock, never in another space. The ground
// is kept walkable by its sizes (a bank three times as wide as it is high); triangles steeper than `steepest`
// (35 degrees unless told) are counted in `steep`.
//
// Patches: `patches` [{ texture, share, wide }] paint triangles with another ground (bare earth, moss, a
// darker grass), where a noise `wide` units across is highest, over `share` of the space, the way the game's
// maps break one ground with another (thornlands' ground25 on a tenth of its floor). A painted triangle on
// level ground is lifted `lift` units, so that it is a brush to wear the picture; its neighbours slope up to it.
//
// What it gives: `{ brushes, heightAt(x, y), steep }`: the brushes (for a func_detail: the carved floor under them
// seals the map), and the ground's height at a place of the space, for what stands on it.
import { solid } from "./source.mjs";
import { spaceAt, slopePlane } from "./ground.mjs";
import { fbm } from "../workshop.mjs";

/** The distance from a point to a segment, in plan. */
function toSegment([px, py], [ax, ay], [bx, by]) {
  const [dx, dy] = [bx - ax, by - ay];
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
/** The distance from a point to a box `{ min, max }` in plan (0 inside it). */
const toBox = ([x, y], { min, max }) =>
  Math.hypot(Math.max(min[0] - x, 0, x - max[0]), Math.max(min[1] - y, 0, y - max[1]));
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * A space's ground of hummocks and banks. `space` a planned space (`planSpace`), `others` the map's other
 * spaces, `sides` the stretches of its sides with rock behind them (`[{ from, to }]`; the rest of its sides
 * open). `amp` the hummocks' height, `bank` the banks' height and `bankWide` their width, `wide` the
 * hummocks' size (units across), `step` the grid, `fade` how far from an opening or a clear box the ground
 * takes to rise, `seed`, `texture` (the floor's), `clear` boxes `[{ min: [x, y], max: [x, y] }]`.
 */
export function reliefOf({
  space,
  others = [],
  sides = [],
  amp = 24,
  bank = 48,
  bankWide,
  wide = 640,
  step = 96,
  fade = 160,
  steepest = 35,
  seed = 1,
  texture,
  clear = [],
  patches = [],
  lift = 2,
}) {
  bankWide ??= Math.max(bank * 3, 192);
  const plane = space.slope ? slopePlane(space) : { at: () => space.floor };
  const corners = space.areas.flat(2);
  const lo = [Math.min(...corners.map((p) => p[0])), Math.min(...corners.map((p) => p[1]))];
  const hi = [Math.max(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[1]))];
  // the open stretches: every side's length that is not a rock stretch, sampled as points
  const rockNear = (p) => Math.min(Infinity, ...sides.map(({ from, to }) => toSegment(p, from, to)));
  const edges = [];
  for (const ring of space.areas.flat())
    for (let i = 0; i < ring.length; i++) edges.push([ring[i], ring[(i + 1) % ring.length]]);
  const openPoints = [];
  for (const [a, b] of edges) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = Math.max(1, Math.ceil(length / 24));
    for (let k = 0; k <= count; k++) {
      const p = [a[0] + ((b[0] - a[0]) * k) / count, a[1] + ((b[1] - a[1]) * k) / count];
      if (rockNear(p) > 12) openPoints.push(p);
    }
  }
  const openNear = (p) => {
    let d = Infinity;
    for (const q of openPoints) d = Math.min(d, Math.hypot(p[0] - q[0], p[1] - q[1]));
    return d;
  };
  const clearNear = (p) => Math.min(Infinity, ...clear.map((box) => toBox(p, box)));
  const raised = new Map();
  /** How much the ground stands over the floor at a corner of the grid (whole units). */
  const raise = (x, y) => {
    const key = `${x},${y}`;
    if (raised.has(key)) return raised.get(key);
    const p = [x, y];
    const level = Math.min(smooth(openNear(p) / fade), smooth(clearNear(p) / fade));
    const hummock = amp * smooth((fbm(x / wide + 11.3, y / wide + 5.7, seed, 3) - 0.35) / 0.4);
    const near = rockNear(p);
    const toWall = near < bankWide ? (1 - near / bankWide) ** 2 : 0;
    const banked = bank * toWall * (0.6 + 0.8 * fbm(x / 300 + 3, y / 300 + 9, seed + 5, 2));
    // a bank comes down where the space opens, sooner than a hummock
    const value = Math.round(level * hummock + Math.min(1, level * 1.5) * banked);
    raised.set(key, value);
    return value;
  };
  // where a corner may be: in the space, or in rock (not in another space)
  const mid = (space.floor + Math.min(space.ceiling, space.floor + 64)) / 2;
  const allowed = (x, y) => {
    const z = plane.at(x, y) + 32;
    if (spaceAt([space], [x, y, Math.min(z, space.ceiling - 1)]) >= 0 || spaceAt([space], [x, y, mid]) >= 0)
      return "in";
    return spaceAt(others, [x, y, z]) < 0 && spaceAt(others, [x, y, z + 32]) < 0 ? "rock" : "out";
  };
  // the grid, on whole steps so that two spaces' grids meet
  const x0 = Math.floor(lo[0] / step) * step;
  const y0 = Math.floor(lo[1] / step) * step;
  const brushes = [];
  let steep = 0;
  const tan = Math.tan((steepest * Math.PI) / 180);
  // the triangles of the space, and the patches painted on them
  const kept = [];
  for (let x = x0; x < hi[0]; x += step)
    for (let y = y0; y < hi[1]; y += step) {
      const cell = [
        [x, y],
        [x + step, y],
        [x + step, y + step],
        [x, y + step],
      ];
      const tris =
        (x / step + y / step) & 1
          ? [
              [cell[0], cell[1], cell[2]],
              [cell[0], cell[2], cell[3]],
            ]
          : [
              [cell[0], cell[1], cell[3]],
              [cell[1], cell[2], cell[3]],
            ];
      for (const tri of tris) {
        const where = tri.map(([px, py]) => allowed(px, py));
        if (where.includes("out") || !where.includes("in")) continue;
        kept.push({ tri, centre: [0, 1].map((k) => tri.reduce((sum, p) => sum + p[k], 0) / 3), paint: null });
      }
    }
  const lifted = new Set();
  patches.forEach(({ texture: picture, share = 0.15, wide: across = 384 }, n) => {
    const free = kept.filter((t) => !t.paint && clearNear(t.centre) > 48);
    const noise = free.map((t) =>
      fbm(t.centre[0] / across + 7.1 * (n + 1), t.centre[1] / across + 3.3, seed + 17 + n, 3),
    );
    const cut = [...noise].sort((a, b) => b - a)[Math.floor(Math.min(1, share * (kept.length / Math.max(1, free.length))) * (noise.length - 1))]; // prettier-ignore
    free.forEach((t, i) => {
      if (noise[i] >= cut) {
        t.paint = picture;
        for (const [px, py] of t.tri) lifted.add(`${px},${py}`);
      }
    });
  });
  const top = (x, y) =>
    Math.round(plane.at(x, y)) +
    raise(x, y) +
    (lifted.has(`${x},${y}`) && raise(x, y) < lift ? lift - raise(x, y) : 0);
  for (const { tri, paint } of kept) {
    const heights = tri.map(([px, py]) => top(px, py));
    {
      // all level with the floor: the carved floor is the ground there
      if (tri.every(([px, py], i) => heights[i] <= Math.round(plane.at(px, py)))) continue;
      // steeper than a player walks up: counted, to be told (the corners are shared: none is moved alone)
      if (Math.max(...heights) - Math.min(...heights) > tan * step) steep++;
      const h = heights;
      const under = Math.floor(Math.min(...tri.map(([px, py]) => plane.at(px, py)))) - 16;
      const points = [...tri.map(([px, py]) => [px, py, under]), ...tri.map(([px, py], i) => [px, py, h[i]])];
      brushes.push(solid(points, paint ? { top: paint, sides: texture } : texture, { faces: [[0, 1, 2], [3, 4, 5], [0, 1, 3], [1, 2, 4], [2, 0, 5]] })); // prettier-ignore
    }
  }
  /** The ground's height at a place of the space: the triangle's plane over it, or the floor's. */
  const heightAt = (x, y) => {
    const [i, j] = [Math.floor((x - x0) / step), Math.floor((y - y0) / step)];
    const [cx, cy] = [x0 + i * step, y0 + j * step];
    const [u, v] = [(x - cx) / step, (y - cy) / step];
    const z = (px, py) => top(px, py);
    const [a, b, c, d] = [z(cx, cy), z(cx + step, cy), z(cx + step, cy + step), z(cx, cy + step)];
    let h;
    if ((x0 / step + i + y0 / step + j) & 1)
      h = u >= v ? a + (b - a) * u + (c - b) * v : a + (c - d) * u + (d - a) * v;
    else h = u + v <= 1 ? a + (b - a) * u + (d - a) * v : c + (d - c) * (1 - u) + (b - c) * (1 - v);
    return Math.max(plane.at(x, y), h);
  };
  return { brushes, heightAt, steep, painted: kept.filter((t) => t.paint).length };
}
