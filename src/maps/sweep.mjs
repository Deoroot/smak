// A map swept for what a player would find wrong by walking it, with no game and no AI: the deterministic checks
// Steven's play-test of the frenzy reproductions asked for (examples/reproduce/reviews/maps-2026-10-14.json).
//
//   sweepOf(bsp, { reach }) -> { drops, floating, islands, facts }
//
// drops: places a player walks to and can step off, falling further than Half-Life's safe fall (580 units a
// second, sv_gravity 800: about 210 units), each with the floor walked from and the one landed on. floating:
// lights with nothing solid within LIGHT_REACH of them in any of the six directions: a lamp in mid-air. The
// walk test's own finds (what is not reached, what stands in solid, one-way places) are its own report.
import { reachOf } from "./reach.mjs";
import { contentsAt, CONTENTS, readBsp } from "./bsp.mjs";
import { valueOf, vectorOf } from "./entities.mjs";

/** Half-Life's PLAYER_MAX_SAFE_FALL_SPEED (580) under sv_gravity 800: the drop that starts to hurt, in units. */
export const SAFE_DROP = Math.round((580 * 580) / (2 * 800));
/** A light this far from anything solid in every direction hangs in the air. */
export const LIGHT_REACH = 32;
/**
 * What is looked at for hanging in the air: the sprites a player sees (a glow on a lamp), and the light entities,
 * which the game does not draw. Valve's frenzy has every glow on something and two of its eight lights in open
 * air; frenzy_pictures had seven of eight glows floating: what Steven saw as "random lights in the middle of the air".
 */
const SEEN = ["env_glow", "env_sprite"];
const LIGHTS = ["light", "light_spot", ...SEEN];
/** Where a body's chest is over the floor: open there, a player walks off the edge. */
const CHEST = 36;

/** The drops that hurt and the lights in mid-air of a compiled map (bytes or as `readBsp` gives it). */
export function sweepOf(bytes, { reach = null } = {}) {
  const bsp = bytes instanceof Uint8Array ? readBsp(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)) : bytes;
  const walk = reach ?? reachOf(bsp);
  const cell = walk.cell;
  const solid = (p) => contentsAt(bsp, p) === CONTENTS.SOLID;
  const { mins, maxs } = bsp.models[0];

  // every walked floor, cell by cell, each storey of it
  const drops = [];
  const seen = new Set();
  for (let x = Math.floor(mins[0] / cell) * cell; x <= maxs[0]; x += cell)
    for (let y = Math.floor(mins[1] / cell) * cell; y <= maxs[1]; y += cell) {
      let under;
      for (let storey = 0; storey < 8; storey++) {
        const h = walk.walked(x, y, under);
        if (h === null || h === undefined) break;
        under = h - 40;
        for (const [dx, dy] of [[cell, 0], [-cell, 0], [0, cell], [0, -cell]]) {
          const [nx, ny] = [x + dx, y + dy];
          // open at the chest beside it, and no floor there within a step: the edge
          if (solid([nx, ny, h + CHEST])) continue;
          const there = walk.stands(nx, ny, h + 18);
          if (there !== null && there !== undefined && there >= h - 18) continue;
          // a body falls onto the first solid under it: a floor it fits on further down, under a slab it does not
          // fit on (by a wall, under a stair), is no drop (the mezzanine's edge by a wall read as a fall to the cellar)
          const below = lowestOpenFloor(solid, nx, ny, h, mins[2]);
          const landed = there !== null && there !== undefined && below !== null ? Math.max(there, below) : there ?? below;
          if (landed === null || h - landed <= SAFE_DROP) continue;
          const key = `${Math.round(x / 64)},${Math.round(y / 64)},${Math.round(h / 64)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          drops.push({ at: [x, y, Math.round(h)], to: [nx, ny, Math.round(landed)], fall: Math.round(h - landed) });
        }
      }
    }
  drops.sort((a, b) => b.fall - a.fall);

  const floating = [];
  bsp.entities.forEach((entity, number) => {
    if (!LIGHTS.includes(valueOf(entity, "classname"))) return;
    const o = vectorOf(entity, "origin");
    if (!o) return;
    const near = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some((d) => {
      for (let t = 2; t <= LIGHT_REACH; t += 2) if (solid([o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t])) return true;
      return false;
    });
    if (!near) floating.push({ number, classname: valueOf(entity, "classname"), seen: SEEN.includes(valueOf(entity, "classname")), at: o.map(Math.round) });
  });

  const notes = [];
  const islands = islandsOf(bsp, notes);
  const facts = [
    `${drops.length} places a player can step off and fall more than ${SAFE_DROP} (hurt)${drops.length ? `: ${drops.slice(0, 6).map((d) => `${d.fall} down at ${d.at.join(" ")}`).join("; ")}` : ""}`,
    `${floating.filter((f) => f.seen).length} glows and sprites with nothing solid within ${LIGHT_REACH} of them${floating.some((f) => f.seen) ? `: ${floating.filter((f) => f.seen).slice(0, 8).map((f) => `${f.number} ${f.classname} at ${f.at.join(" ")}`).join("; ")}` : ""}`,
    `${floating.filter((f) => !f.seen).length} light entities in open air (the game draws them not; Valve's frenzy has two)`,
  ];
  facts.push(notes.length ? notes.join("; ") : `${islands.length} pieces of solid that touch nothing (floating in the air)${islands.length ? `: ${islands.slice(0, 6).map((i) => `${i.from.join(" ")} to ${i.to.join(" ")}`).join("; ")}` : ""}`); // prettier-ignore
  return { drops, floating, islands, facts };
}

/** The highest floor under a point a body would land on, found by going down through open space; null: none. */
function lowestOpenFloor(solid, x, y, from, bottom) {
  for (let z = from; z > bottom; z -= 4) if (solid([x, y, z - 4])) return z;
  return null;
}

/** Solid is sampled on a grid this fine; an island of fewer cells is a thin brush the grid caught alone. */
const ISLAND_CELL = 16;
const ISLAND_LEAST = 8;
/**
 * The most cells either grid may hold (a byte each, twice): a map in a sky box of 16384 x 16384 x 4096 would be 268
 * million cells of 16 and ran a sweep out of memory (2 GB, the plaza's variant A); past this the islands are not
 * looked for, and that is said.
 */
const MOST_CELLS = 48_000_000;
/** Solid to a body: the world's solid and its sky (a sky box's floor holds what stands on it). */
const holds = (contents) => contents === CONTENTS.SOLID || contents === CONTENTS.SKY;
/**
 * The world's solid pieces that touch nothing: cells of ISLAND_CELL joined face to face that never reach the map's
 * outer shell. Valve's frenzy has none of 8 cells or more; a slab or a wall left in the air is one. The sky's brushes
 * count as solid. `notes` gets a sentence when the map is too large to look over (MOST_CELLS), and none are listed.
 */
export function islandsOf(bsp, notes = []) {
  const { mins, maxs } = bsp.models[0];
  const c = ISLAND_CELL;
  const n = [0, 1, 2].map((k) => Math.ceil((maxs[k] - mins[k]) / c) + 2);
  if (n[0] * n[1] * n[2] > MOST_CELLS) {
    notes.push(`the pieces of solid that touch nothing were not looked for: the map is ${n.map((v) => v * c).join(" x ")} units, ${Math.round((n[0] * n[1] * n[2]) / 1e6)} million cells of ${c}, over the ${MOST_CELLS / 1e6} million a sweep holds`); // prettier-ignore
    return [];
  }
  const at = (i, j, k) => [mins[0] + (i - 0.5) * c, mins[1] + (j - 0.5) * c, mins[2] + (k - 0.5) * c];
  const index = (i, j, k) => (k * n[1] + j) * n[0] + i;
  const solid = new Uint8Array(n[0] * n[1] * n[2]);
  for (let k = 0; k < n[2]; k++)
    for (let j = 0; j < n[1]; j++)
      for (let i = 0; i < n[0]; i++) {
        const inside = i > 0 && j > 0 && k > 0 && i < n[0] - 1 && j < n[1] - 1 && k < n[2] - 1;
        solid[index(i, j, k)] = !inside || holds(contentsAt(bsp, at(i, j, k))) ? 1 : 0;
      }
  const seen = new Uint8Array(solid.length);
  const islands = [];
  for (let s = 0; s < solid.length; s++) {
    if (!solid[s] || seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    let size = 0;
    let outer = false;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    while (stack.length) {
      const q = stack.pop();
      size++;
      const ijk = [q % n[0], Math.floor(q / n[0]) % n[1], Math.floor(q / (n[0] * n[1]))];
      if (ijk.some((v, a) => v === 0 || v === n[a] - 1)) outer = true;
      ijk.forEach((v, a) => ((lo[a] = Math.min(lo[a], v)), (hi[a] = Math.max(hi[a], v))));
      for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const m = ijk.map((v, a) => v + d[a]);
        if (m.some((v, a) => v < 0 || v >= n[a])) continue;
        const o = index(...m);
        if (solid[o] && !seen[o]) (seen[o] = 1), stack.push(o);
      }
    }
    if (!outer && size >= ISLAND_LEAST) islands.push({ cells: size, from: at(...lo).map((v) => Math.round(v - c / 2)), to: at(...hi).map((v) => Math.round(v + c / 2)) });
  }
  // a post, a trunk or a leg thinner than the grid holds what stands on it: each island is looked at again,
  // finely, in the space about it, and one whose solid reaches out of that space is held after all
  // (an island too large to look at finely is no post thinner than the grid: it stays)
  return islands.filter((island) => !heldFinely(bsp, island)).sort((a, b) => b.cells - a.cells);
}

/** The finer grid an island is looked at again on, and how far about it. */
const FINE_CELL = 2;
const FINE_ROOM = 48;
/** Whether the solid of an island, sampled every FINE_CELL, reaches the edge of the space FINE_ROOM about it. */
function heldFinely(bsp, { from, to }) {
  const c = FINE_CELL;
  const lo = from.map((v) => v - FINE_ROOM);
  const n = [0, 1, 2].map((k) => Math.ceil((to[k] + FINE_ROOM - lo[k]) / c));
  if (n[0] * n[1] * n[2] > MOST_CELLS) return false;
  const at = (i, j, k) => [lo[0] + (i + 0.5) * c, lo[1] + (j + 0.5) * c, lo[2] + (k + 0.5) * c];
  const index = (i, j, k) => (k * n[1] + j) * n[0] + i;
  const state = new Uint8Array(n[0] * n[1] * n[2]); // 0 unknown, 1 solid, 2 open
  const isSolid = (i, j, k) => {
    const q = index(i, j, k);
    if (!state[q]) state[q] = holds(contentsAt(bsp, at(i, j, k))) ? 1 : 2;
    return state[q] === 1;
  };
  // start from the island's own middle cells
  const stack = [];
  const seen = new Uint8Array(state.length);
  for (let k = 0; k < n[2]; k++)
    for (let j = 0; j < n[1]; j++)
      for (let i = 0; i < n[0]; i++) {
        const p = at(i, j, k);
        if ([0, 1, 2].every((a) => p[a] >= from[a] && p[a] <= to[a]) && isSolid(i, j, k)) (seen[index(i, j, k)] = 1), stack.push([i, j, k]);
      }
  while (stack.length) {
    const [i, j, k] = stack.pop();
    if (i === 0 || j === 0 || k === 0 || i === n[0] - 1 || j === n[1] - 1 || k === n[2] - 1) return true;
    for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const m = [i + di, j + dj, k + dk];
      const q = index(...m);
      if (!seen[q] && isSolid(...m)) (seen[q] = 1), stack.push(m);
    }
  }
  return false;
}

