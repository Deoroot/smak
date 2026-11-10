// Things strewn over the ground the way the game's makers strew them: grass and flowers on cards, bushes and
// ferns as models, stones and boulders as brushes. Read from the game's own maps (maps/natural/, 2026-10-18):
// in its wild maps some 38 things stand on each 1000 player-heights squared of floor, in clumps (their nearest
// neighbour is 0.42 of what chance gives), and more by the walls than chance puts there (86% within two
// player-heights of a wall, against 71%). So: clumps, thicker by the rock, none on the paths or by the houses.
import { solid, brushEntity, pointEntity, textureAxes } from "./source.mjs";
import { spaceAt } from "./ground.mjs";
import { fbm } from "../workshop.mjs";

/** What the game's maps give, by kind: things per 1000 player-heights squared of floor, and their clumping. */
export const STREWN = {
  wild: { density: 38, clump: 0.42, byWall: 0.86 },
  settlement: { density: 75, clump: 0.43, byWall: 0.92 },
  fortress: { density: 39, clump: 0.56, byWall: 0.96 },
  dungeon: { density: 59, clump: 0.65, byWall: 0.98 },
  cave: { density: 27, clump: 0.37, byWall: 0.93 },
};

function toSegment([px, py], [ax, ay], [bx, by]) {
  const [dx, dy] = [bx - ax, by - ay];
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const inBox = ([x, y], { min, max }, grow = 0) => x >= min[0] - grow && x <= max[0] + grow && y >= min[1] - grow && y <= max[1] + grow; // prettier-ignore
function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => (s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0) / 4294967296;
}

/**
 * A stone: a convex lump of rock, `size` [wide, high] units, its foot sunk under `ground` at `at` [x, y].
 * Its corners are a squashed ball's, pushed in and out, so that no two stones are alike.
 */
export function boulder(at, ground, size, texture, seed = 1) {
  const rand = rng(seed);
  const [w, h] = size;
  const points = [];
  const n = 9 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI + rand() * 0.5;
    const r = (w / 2) * (0.7 + 0.3 * rand());
    const up = rand() < 0.5 ? h * (0.15 + 0.25 * rand()) : h * (0.55 + 0.45 * rand());
    points.push([Math.round(at[0] + Math.cos(a) * r * (up > h / 2 ? 0.75 : 1)), Math.round(at[1] + Math.sin(a) * r * (up > h / 2 ? 0.75 : 1)), Math.round(ground + up)]); // prettier-ignore
  }
  // the foot, under the ground
  const sink = Math.round(ground - Math.max(8, h * 0.25));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * 2 * Math.PI + 0.4;
    points.push([Math.round(at[0] + Math.cos(a) * w * 0.4), Math.round(at[1] + Math.sin(a) * w * 0.4), sink]);
  }
  return solid(points, texture);
}

/**
 * A card: two upright pictures crossed (grass, flowers, a bush), each a thin brush wearing a see-through
 * texture. `size` [wide, high] units, standing on `ground` at `at`, turned `turn` degrees. `texture` a name,
 * or `{ name, size: [w, h] }` (its texels): then the picture is fitted to the card once, its foot on the
 * ground, on both its faces.
 */
export function card(at, ground, size, texture, turn = 0, { crossed = true, tile = false } = {}) {
  const [w, h] = size;
  const name = typeof texture === "string" ? texture : texture.name;
  const texels = typeof texture === "object" ? texture.size : null;
  const brushes = [];
  for (const extra of crossed ? [0, 90] : [0]) {
    const a = ((turn + extra) * Math.PI) / 180;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    const along = [c * (w / 2), s * (w / 2)];
    const across = [-s, c]; // one unit thick
    const z0 = Math.round(ground - 2);
    const z1 = Math.round(ground - 2 + h);
    const corners = [
      [at[0] - along[0], at[1] - along[1]],
      [at[0] + along[0], at[1] + along[1]],
    ];
    const pts = [];
    for (const [x, y] of corners)
      for (const side of [-0.5, 0.5]) for (const z of [z0, z1]) pts.push([+(x + across[0] * side).toFixed(2), +(y + across[1] * side).toFixed(2), z]); // prettier-ignore
    // the picture once across each broad face: its left edge at the card's end, its top at the card's top
    const fit = (normal) => {
      if (!texels || Math.abs(normal[2]) > 0.1 || Math.abs(normal[0] * c + normal[1] * s) > 0.5) return name;
      // tiled: the picture keeps its shape and repeats along (a line of trees); else once across
      const scale = tile ? [h / texels[1], h / texels[1]] : [w / texels[0], h / texels[1]];
      const { u, v } = textureAxes(normal, { align: "face" });
      const ends = [
        [...corners[0], z1],
        [...corners[1], z1],
      ].map((p) => p[0] * u[0] + p[1] * u[1] + p[2] * u[2]);
      const left = Math.min(...ends);
      const top = Math.min(z1 * v[2], z0 * v[2]);
      return { name, align: "face", scale, offset: [-left / scale[0], -top / scale[1]] };
    };
    brushes.push(solid(pts, fit));
  }
  return brushes;
}

/**
 * Things strewn over spaces. `places`: `[{ space, sides, groundAt }]` (sides: the stretches with rock behind
 * them, as `reliefOf` takes them; groundAt(x, y) the ground's height); `palette`: `[{ kind: "card" | "model"
 * | "stone", weight, size: [[wideLow, wideHigh], [highLow, highHigh]], texture | model, byWall (how much more
 * by the rock: 0 none, 1 as the game's), room (how much ground it keeps to itself, units) }]`; `density` things
 * per 1000 player-heights squared (the kind's, `STREWN`); `clear` boxes kept bare (houses, wells), `avoid`
 * paths `[{ points: [[x, y], ...], width }]`; `player` the player's height (72).
 *
 * `fringe`: `{ texture, height: [low, high], length: [low, high], gap: [low, high], inset, sink }`: grass along the
 * foot of the rock (every place's `sides`). Or several such rows, a list: a forest's edge is one, its pictures
 * (`textures`, one picked each time) a line of trees, `keepShape` its length from its height, or `tile` the
 * picture kept in shape and repeated along the length; a `gap` below 0 to overlap them, `inset` [low, high]
 * how far out from the rock (and from a cliff's foot) it stands.
 *
 * Returns `{ entities, facts }`: the cards as func_illusionary (solid render, by the map's cells of 1024), the
 * stones as one func_detail, the models as env_model.
 */
export function scatter({
  places,
  palette,
  density = STREWN.wild.density,
  clear = [],
  avoid = [],
  seed = 1,
  player = 72,
  fringe,
}) {
  const rand = rng(seed);
  const H2 = player * player;
  const total = palette.reduce((s, p) => s + p.weight, 0);
  const cards = new Map();
  const stones = [];
  const models = [];
  const taken = [];
  let tried = 0;
  for (const [nth, { space, sides = [], groundAt }] of places.entries()) {
    const corners = space.areas.flat(2);
    const lo = [Math.min(...corners.map((p) => p[0])), Math.min(...corners.map((p) => p[1]))];
    const hi = [Math.max(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[1]))];
    // candidates on a jittered grid, each with a weight: in a clump, by the rock, off the paths
    const step = 40;
    const candidates = [];
    for (let x = lo[0]; x < hi[0]; x += step)
      for (let y = lo[1]; y < hi[1]; y += step) {
        const p = [x + rand() * step, y + rand() * step];
        if (spaceAt([space], [...p, space.floor + 1]) < 0 && spaceAt([space], [...p, space.ceiling - 1]) < 0)
          continue;
        if (clear.some((box) => inBox(p, box, 24))) continue;
        if (
          avoid.some(({ points, width }) =>
            points.some((q, i) => i && toSegment(p, points[i - 1], q) < width / 2 + 16),
          )
        )
          continue;
        const rock = Math.min(Infinity, ...sides.map(({ from, to }) => toSegment(p, from, to)));
        const clump = Math.max(0, (fbm(p[0] / 420 + nth * 7, p[1] / 420, seed + 3, 3) - 0.45) / 0.55);
        const wall = rock < 2 * player ? 1 : rock < 4 * player ? 0.4 : 0.12;
        candidates.push({ p, rock, w: clump * clump * (0.35 + wall) });
      }
    const area = candidates.length * step * step;
    const want = Math.round((density * area) / H2 / 1000);
    const sum = candidates.reduce((s, c) => s + c.w, 0);
    if (!want || !sum) continue;
    let placed = 0;
    for (let tries = 0; placed < want && tries < want * 30; tries++) {
      tried++;
      let r = rand() * sum;
      const c = candidates.find((each) => (r -= each.w) <= 0) ?? candidates[candidates.length - 1];
      // which thing: by its weight, and by the rock for those that keep to it
      let q = rand() * total;
      const item = palette.find((each) => (q -= each.weight) <= 0) ?? palette[0];
      if (item.byWall && c.rock > 3 * player && rand() < item.byWall) continue;
      const room = item.room ?? 24;
      if (taken.some((t) => Math.hypot(t.p[0] - c.p[0], t.p[1] - c.p[1]) < Math.max(room, t.room))) continue;
      let [wide, high] = item.size.map(([a, b]) => a + (b - a) * rand());
      // a card keeps its picture's shape unless told: its height from its width
      if (item.kind === "card" && item.texture?.size && item.keepShape !== false)
        high = (wide * item.texture.size[1]) / item.texture.size[0];
      const g = groundAt(c.p[0], c.p[1]);
      if (g === null || g === undefined) continue;
      const turn = Math.round(rand() * 180);
      if (item.kind === "card") {
        const key = `${Math.floor(c.p[0] / 1024)},${Math.floor(c.p[1] / 1024)}`;
        // sunk a little (`sink`, a share of its height): its foot in the grass, not on it
        const sunk = Math.round(high * (item.sink ?? 0.15));
        (cards.get(key) ?? cards.set(key, []).get(key)).push(...card(c.p, g - sunk, [Math.round(wide), Math.round(high)], item.texture, turn));
      } else if (item.kind === "stone") {
        try { stones.push(boulder(c.p, g, [Math.round(wide), Math.round(high)], item.texture, Math.floor(rand() * 1e6))); } catch { continue; } // prettier-ignore
      } else models.push(pointEntity("env_model", [Math.round(c.p[0]), Math.round(c.p[1]), Math.round(g - 2)], { model: item.model, angles: `0 ${turn * 2} 0`, ...(item.keys ?? {}) })); // prettier-ignore
      taken.push({ p: c.p, room });
      placed++;
    }
  }
  // the fringe: grass along the foot of the rock, one picture a stretch, standing a little off the rock, with
  // gaps; where the rock meets the ground there is no hard line (the game's rock01_ewok has its own fringe)
  let fringes = 0;
  for (const row of [fringe ?? []].flat())
    for (const { space, sides = [], groundAt } of places)
      for (const { from, to } of sides) {
        const fringe = row;
        const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
        const dir = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
        const left = [-dir[1], dir[0]]; // into the space
        let u = rand() * 48;
        while (u < length - 48) {
          const texture = fringe.textures
            ? fringe.textures[Math.floor(rand() * fringe.textures.length)]
            : fringe.texture;
          let high = Math.round(fringe.height[0] + rand() * (fringe.height[1] - fringe.height[0]));
          let shaped = fringe.keepShape && texture.size ? (high * texture.size[0]) / texture.size[1] : null;
          // a line of trees is not squeezed to fit what is left of the side: it is made smaller, not too small;
          // where even that does not fit (a short side) it keeps its size and stands back over the side's end,
          // or across a short side's middle, its ends past the corners: no bare wall is left behind it
          let last = false;
          if (shaped && shaped > length - u) {
            const smaller = Math.round(((length - u) * texture.size[1]) / texture.size[0]);
            if (smaller >= fringe.height[0] * 0.6) {
              shaped = length - u;
              high = smaller;
            } else {
              u = length > shaped ? length - shaped : (length - shaped) / 2;
              last = true;
            }
          }
          const run =
            shaped ?? Math.min(length - u, fringe.length[0] + rand() * (fringe.length[1] - fringe.length[0]));
          // off the rock, and off a cliff's foot where the space has cliffs (they stand out over the ground)
          const [in0, in1] = Array.isArray(fringe.inset)
            ? fringe.inset
            : [fringe.inset ?? 8, (fringe.inset ?? 8) + 20];
          const inset = (space.cliff?.foot ?? 0) + in0 + rand() * (in1 - in0);
          const a = [from[0] + dir[0] * u + left[0] * inset, from[1] + dir[1] * u + left[1] * inset];
          const b = [
            from[0] + dir[0] * (u + run) + left[0] * inset,
            from[1] + dir[1] * (u + run) + left[1] * inset,
          ];
          const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          u = last
            ? length
            : u + Math.max(32, run + fringe.gap[0] + rand() * (fringe.gap[1] - fringe.gap[0]));
          if (
            spaceAt([space], [...mid, space.floor + 1]) < 0 &&
            spaceAt([space], [...mid, space.ceiling - 1]) < 0
          )
            continue;
          if (clear.some((box) => inBox(mid, box, 24))) continue;
          if (
            avoid.some(({ points, width }) =>
              points.some((q, i) => i && toSegment(mid, points[i - 1], q) < width / 2 + 16),
            )
          )
            continue;
          const g = Math.min(
            groundAt(...a) ?? Infinity,
            groundAt(...b) ?? Infinity,
            groundAt(...mid) ?? Infinity,
          );
          if (!Number.isFinite(g)) continue;
          const turn = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
          const key = `${Math.floor(mid[0] / 1024)},${Math.floor(mid[1] / 1024)}`;
          // half sunk: a strip of grass is dense to its foot, and only its tips should stand out of the ground
          const sink = Math.round(high * (fringe.sink ?? 0.45));
          (cards.get(key) ?? cards.set(key, []).get(key)).push(
            ...card(mid, g - sink, [Math.round(run), high], texture, turn, {
              crossed: false,
              tile: fringe.tile,
            }),
          );
          fringes++;
        }
      }
  const entities = [];
  for (const brushes of cards.values())
    entities.push(brushEntity("func_illusionary", brushes, { rendermode: 4, renderamt: 255 }));
  if (stones.length) entities.push(brushEntity("func_detail", stones, { zhlt_detaillevel: 1 }));
  entities.push(...models);
  const cardCount = [...cards.values()].reduce((s, b) => s + b.length / 2, 0) - fringes / 2;
  return {
    entities,
    facts: { cards: cardCount, fringes, stones: stones.length, models: models.length, tried },
  };
}
