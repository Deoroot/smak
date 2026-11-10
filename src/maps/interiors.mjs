// A room dressed as the game's interiors are (ms_wicardoven, the keeps, the crypts; maps/natural/tools/rooms.mjs
// measured them): a base of another stone along the walls, a moulding under the ceiling, beams across the short
// way resting on corbels (on pilasters in a hall), torches on the walls with their fire and their light, and
// the things a room of its use has: tables and chairs, shelves, beds, barrels, a hearth, urns. Over a room a
// sketch has carved (`sketchMap`'s `places`: its space and the stretches of its walls with rock behind them, so
// nothing is put in a doorway).
import { solid, pointEntity, light } from "./source.mjs";
import { card } from "./scatter.mjs";

/**
 * Interiors' textures, from MSC's own .wad files (ms_generic.wad: one set made to go together).
 *   wall, floor, ceiling   what the sketch carves the room with: lists, a room takes one of each (`pickSet`)
 *   inlay     a floor laid in the middle of a room in another stone (a list too)
 *   webs, moss, chains   what hangs: the share of cut corners with a web across them high up, of walls
 *             with moss hanging from their top, and chains hanging from a beam (0 to 1)
 *   base      the band along the foot of the walls; trim the moulding; beam the beams, corbels, pilasters
 */
export const INTERIOR_SETS = {
  /** A keep's hall: laid stone, a floor of flags, a ceiling of planks on beams. */
  keep: { wall: ["ms_stnwall01", "ms_stnwall02", "ms_stnwall05"], floor: ["ms_floor03", "ms_floor05", "ms_floor06"], ceiling: ["ms_stnwall02", "ms_wood02"], inlay: ["ms_floor01", "ms_floor04", "ms_floor02"], webs: 0.3, moss: 0, chains: 0.5, base: ["ms_stnwall07", "ms_stnwall06", "ms_stnwall03"], trim: ["ms_trim01", "ms_trim02", "ms_wood04"], beam: ["ms_wood04", "ms_wood01", "ms_wood03"], pillar: ["ms_stnwall07", "ms_stnwall06", "ms_stnwall02"], door: { name: "ms_wddoor01", size: [64, 128] } }, // prettier-ignore
  /** A cellar or a crypt: dark stone, cobbles, a stone ceiling. */
  cellar: { wall: ["ms_stnwall04", "ms_stnwall03", "ms_stnwall07"], floor: ["ms_floor01", "ms_floor02"], ceiling: ["ms_stnwall03", "ms_rock01"], inlay: ["ms_floor06", "ms_floor03"], webs: 0.6, moss: 0.35, chains: 0.6, base: ["ms_stnwall03", "ms_rock01", "ms_stnwall07"], trim: ["ms_stnwall03", "ms_stnwall04"], beam: ["ms_wood04", "ms_wood01"], pillar: ["ms_stnwall03", "ms_stnwall07"], door: { name: "ms_wddoor02", size: [96, 128] } }, // prettier-ignore
  /** A house's rooms: plaster, boards, a plank ceiling on beams. */
  house: { wall: ["ms_wall01", "ms_stnwall06"], floor: ["ms_floor04", "ms_plank01", "ms_wood02"], ceiling: ["ms_wood02", "ms_wood03"], inlay: ["ms_plank02", "ms_floor03"], webs: 0.15, moss: 0, chains: 0, base: "ms_wood04", trim: "ms_trim02", beam: "ms_wood04", pillar: "ms_wood04", door: { name: "ms_wddoor01", size: [64, 128] } }, // prettier-ignore
};

/**
 * The game's things for a room (MSC's models), with their size on the plan (`r`, units: how much room they
 * take), `lift` (how far their origin is under their foot: a few are made standing on their middle) and
 * whether they stand against a wall (`wall`: how far their middle is from it) or free.
 */
/** The wall torch a room's torches are (MSC's, as its maps hang it: an env_model of framerate 1, a light by it). */
export const TORCH = "models/props/torch_med.mdl";
/** The size it hangs at: whole, its cage is as high as a head (the game's rooms' torches are about half its height). */
export const TORCH_SCALE = 0.6;

export const ROOM_THINGS = {
  table: { model: "models/misc/dinner_table2.mdl", r: 64 },
  smallTable: { model: "models/misc/table2.mdl", r: 50, wall: 26 },
  chair: { model: "models/misc/chair.mdl", r: 18 },
  bed: { model: "models/props/bed_empty-wood.mdl", r: 66, wall: 64 },
  shelves: { model: "models/props/shelves1.mdl", r: 44, wall: 14, lift: 32 },
  books: { model: "models/props/books1.mdl", r: 18 },
  barrel: { model: "models/props/wood_barrel1.mdl", r: 26, wall: 28 },
  chest: { model: "models/props/foot_locker.mdl", r: 20, wall: 14 },
  hearth: { model: "models/props/fireplace_logs1.mdl", r: 28, wall: 36 },
  pot: { model: "models/props/pot1.mdl", r: 20, wall: 36 },
  urns: { model: "models/props/urns.mdl", r: 34, wall: 34 },
  treasure: { model: "models/misc/treasure.mdl", r: 18, wall: 22 },
  skeleton: { model: "models/misc/skeleton.mdl", r: 30, wall: 30 },
};

/** What a room of each use has: things against its walls (weights) and in its middle, and how many to its floor. */
export const ROOM_USES = {
  hall: {
    middle: "tables",
    walls: { shelves: 1, barrel: 1, chest: 0.6 },
    perArea: 1 / 9000,
    pilasters: true,
  },
  store: { walls: { barrel: 4, chest: 2, urns: 1 }, perArea: 1 / 3500 },
  bedroom: { walls: { bed: 2, chest: 1.5, smallTable: 1, shelves: 0.5 }, perArea: 1 / 6000 },
  kitchen: {
    walls: { hearth: 1, barrel: 2, pot: 1, shelves: 1 },
    middle: "table",
    perArea: 1 / 6000,
    once: ["hearth"],
  },
  library: { walls: { shelves: 4, smallTable: 0.5 }, middle: "table", perArea: 1 / 4000 },
  crypt: { walls: { urns: 3, skeleton: 1, treasure: 0.7 }, perArea: 1 / 5000 },
  passage: { walls: {}, perArea: 0 },
};

function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  const next = () => (s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0) / 4294967296;
  // stirred a few times first: seeds one apart would give first numbers alike
  for (let i = 0; i < 4; i++) next();
  return next;
}
const round = (v) => Math.round(v * 1000) / 1000;

/** One room's textures from a set (INTERIOR_SETS' name or its keys): one of each list, by the seed. */
export function pickSet(set = "keep", seed = 1) {
  const rand = rng(seed);
  const t = typeof set === "string" ? INTERIOR_SETS[set] : { ...INTERIOR_SETS.keep, ...set };
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Array.isArray(v) ? v[Math.floor(rand() * v.length)] : v])); // prettier-ignore
}

/**
 * An outline with its corners cut `cut` units back along both sides (a 45 degree face across a square
 * corner): the game's interiors' walls face many ways, a room carved square faces four.
 */
export function chamfered(outline, cut = 32) {
  const out = [];
  for (let i = 0; i < outline.length; i++) {
    const [prev, p, next] = [outline[(i + outline.length - 1) % outline.length], outline[i], outline[(i + 1) % outline.length]]; // prettier-ignore
    const toward = (q) => { const l = Math.hypot(q[0] - p[0], q[1] - p[1]); const c = Math.min(cut, l / 3); return [Math.round(p[0] + ((q[0] - p[0]) * c) / l), Math.round(p[1] + ((q[1] - p[1]) * c) / l)]; }; // prettier-ignore
    out.push(toward(prev), toward(next));
  }
  return out;
}

/**
 * A band along a wall from `a` to `b`, standing out `out` units to the room's side (`inward`), from z0 to z1;
 * `outTop` how far out its top stands (less than `out`: its face leans back).
 */
function band(a, b, inward, out, z0, z1, texture, outTop = out) {
  const at = (p, d) => [round(p[0] + inward[0] * d), round(p[1] + inward[1] * d)];
  const lo = [at(a, 0), at(b, 0), at(b, out), at(a, out)];
  const hi = [at(a, 0), at(b, 0), at(b, outTop), at(a, outTop)];
  return solid([...lo.map(([x, y]) => [x, y, z0]), ...hi.map(([x, y]) => [x, y, z1])], texture, {
    faces: [[0, 1, 2], [4, 5, 6], [0, 1, 4], [1, 2, 5], [2, 3, 6], [3, 0, 7]], // prettier-ignore
  });
}
/** A post of `w` by `d` (along `u`, along `v`) round the point p, from z0 to z1. */
function post(p, u, v, w, d, z0, z1, texture) {
  const c = (su, sv) => [round(p[0] + u[0] * su + v[0] * sv), round(p[1] + u[1] * su + v[1] * sv)];
  const q = [c(-w / 2, 0), c(w / 2, 0), c(w / 2, d), c(-w / 2, d)];
  return solid([...q.map(([x, y]) => [x, y, z0]), ...q.map(([x, y]) => [x, y, z1])], texture, {
    faces: [[0, 1, 2], [4, 5, 6], [0, 1, 4], [1, 2, 5], [2, 3, 6], [3, 0, 7]], // prettier-ignore
  });
}

/** Whether [x, y] is inside the ring (even-odd). */
function within(ring, [x, y]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = [ring[i], ring[j]];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/**
 * A room dressed (see the top of this file): `place` one of `sketchMap(...).places` (its `space` with its
 * `floor`, `ceiling` and outline, and its `sides`: the walls with rock behind them, the room to their left).
 *   use       what the room is for: hall, store, bedroom, kitchen, library, crypt, passage (ROOM_USES)
 *   set       INTERIOR_SETS' name or a set of its keys
 *   base      the height of the band along the walls' foot (32); trim: the moulding under the ceiling (12)
 *   beams     units between beams across the short way (160); 0: none (a vault, a cave)
 *   torches   units between torches along the walls (320); 0: none. `torchHeight` (104) over the floor
 *   glow      the torches' light: [r, g, b, brightness] (255 170 90, 100)
 *   vault     units: a pitched ceiling, its ridge this much over the walls' top, tie beams across there
 *   inlay     true: the floor's middle laid in another stone (the set's `inlay`), a band round it
 *   dais      true: a step of 16 at one end of the room (a hall's high table)
 *   clear     [[x, y, r]]: places kept free of things (before doorways)
 *   doors     [[x, y, half]]: the doorways in the room's walls (their middle, half their width with the
 *             frame): the base stops at them, and no torch, pilaster or column stands before one
 *   gallery   a second level in the room (wicardoven's halls have them): true, or { near: [x, y] (the wall
 *             nearest it; the longest unless told), height (128), deep (96), length (160), stair (64 wide),
 *             rise (16), tread (24), loose }: a ledge `height` up along that wall, on posts, railed, and a
 *             stair along the same wall up to its end; a doorway at `near` (the builder's) opens onto it.
 *             loose: the stair's steps are not in `brushes` but in `gallery.steps` (one brush a step, lowest
 *             first: a builder makes them move)
 *   spots     how many more places by the walls to keep free and give back (`spots`: [{ at, yaw }], facing
 *             into the room): for what the builder puts there (a chest that breaks, where a monster stands)
 *   seed
 * Returns `{ brushes, cards, entities, things }`: the brushes (for a func_detail), the see-through cards
 * (webs, moss, chains: for a func_illusionary of render mode 4), the entities (env_model, the torches'
 * env_sprite and light), and `things` ([{ name, at, yaw }]) of what was put where; with a gallery, `gallery`:
 * { top (its floor's height), from, to (its ends on the wall), foot (the stair's foot) }.
 */
export function dressRoom({
  place,
  use = "hall",
  set = "keep",
  base = 32,
  trim = 12,
  beams = 160,
  torches = 320,
  torchHeight = 104,
  glow = [255, 170, 90, 100],
  vault = null,
  inlay = true,
  dais = false,
  clear = [],
  doors = [],
  gallery = null,
  spots = 0,
  seed = 1,
}) {
  // a set picked already (its wall one name), or a set's name or keys to pick from
  const t = typeof set === "object" && typeof set.wall === "string" ? set : pickSet(set, seed);
  const how = ROOM_USES[use] ?? ROOM_USES.hall;
  const rand = rng(seed);
  const { space, sides } = place;
  const floor = space.floor;
  const ceiling = space.ceiling;
  const rings = space.areas.flat();
  const ring = rings.reduce((a, b) => (Math.abs(areaOf(b)) > Math.abs(areaOf(a)) ? b : a));
  const brushes = [];
  const entities = [];
  const things = [];
  const walls = sides.map(({ from, to }) => {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const along = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
    // the doorways in it: [from, to] along it (a doorway's middle within 48 of its line)
    const gaps = doors
      .map(([x, y, half]) => [
        (x - from[0]) * along[0] + (y - from[1]) * along[1],
        Math.abs((x - from[0]) * -along[1] + (y - from[1]) * along[0]),
        half,
      ]) // prettier-ignore
      .filter(([s, off, half]) => off < 48 && s > -half && s < length + half)
      .map(([s, , half]) => [s - half, s + half]);
    return { from, to, length, along, inward: [-along[1], along[0]], gaps };
  });
  // whether a place by a wall is before one of its doorways (`margin` more each side)
  const beforeDoor = (p, margin = 0) =>
    walls.some((w) => {
      const s = (p[0] - w.from[0]) * w.along[0] + (p[1] - w.from[1]) * w.along[1];
      const off = (p[0] - w.from[0]) * w.inward[0] + (p[1] - w.from[1]) * w.inward[1];
      // (from a little in the wall: a post's foot is)
      return off > -24 && off < 64 + margin && w.gaps.some(([a, b]) => s > a - margin && s < b + margin);
    });
  // a wall's stretches between its doorways: [from, to] points
  const stretches = (w) => {
    const cuts = [[-Infinity, 0], ...w.gaps.slice().sort((a, b) => a[0] - b[0]), [w.length, Infinity]];
    const out = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const [a, b] = [Math.max(0, cuts[i][1]), Math.min(w.length, cuts[i + 1][0])];
      if (b - a >= 4) out.push([0, 1].map((k) => { const d = k ? b : a; return [round(w.from[0] + w.along[0] * d), round(w.from[1] + w.along[1] * d)]; })); // prettier-ignore
    }
    return out;
  };
  // a gallery: a ledge up along one wall and a stair beside it along the same wall; the wall's base and
  // torches keep off them, as off a doorway
  let raised = null;
  const keepOff = []; // [x, y, r]: what the gallery takes of the floor (the things keep off it)
  if (gallery && walls.length) {
    const g = { height: 128, deep: 96, length: 160, stair: 64, rise: 16, tread: 24, ...(gallery === true ? {} : gallery) }; // prettier-ignore
    const along = (w, p) => (p[0] - w.from[0]) * w.along[0] + (p[1] - w.from[1]) * w.along[1];
    const off = (w, p) => Math.abs((p[0] - w.from[0]) * w.inward[0] + (p[1] - w.from[1]) * w.inward[1]);
    const distance = (w, p) => { const s = Math.max(0, Math.min(w.length, along(w, p))); return Math.hypot(off(w, p), along(w, p) - s); }; // prettier-ignore
    const piece = g.near ? walls.reduce((a, b) => (distance(b, g.near) < distance(a, g.near) ? b : a)) : walls.reduce((a, b) => (b.length > a.length ? b : a)); // prettier-ignore
    // the whole wall: the pieces on its line (a doorway in it parts it in two), as one
    const line = walls.filter((o) => o.along[0] * piece.along[0] + o.along[1] * piece.along[1] > 0.999 && off(piece, o.from) < 2); // prettier-ignore
    const ends = line.flatMap((o) => [along(piece, o.from), along(piece, o.to)]);
    const [e0, e1] = [Math.min(...ends), Math.max(...ends)];
    const start = [piece.from[0] + piece.along[0] * e0, piece.from[1] + piece.along[1] * e0];
    const w = { from: start, length: e1 - e0, along: piece.along, inward: piece.inward };
    const steps = Math.ceil(g.height / g.rise);
    const run = (steps - 1) * g.tread;
    // the stair's foot wants open floor before it: 64 of the wall past it (a corner there, its base and its
    // cut, would stand across the way onto the first step)
    const room = 64;
    if (w.length >= g.length + run + room + 8) {
      const want = g.near ? along(w, g.near) : w.length - g.length / 2 - 8;
      let l0 = Math.round(Math.max(8, Math.min(w.length - 8 - g.length, want - g.length / 2)));
      // the stair before the ledge where it fits, after it otherwise (the ledge moved over when neither does)
      let before = l0 - run >= room;
      if (!before && l0 + g.length + run > w.length - room) { l0 = room + run; before = true; } // prettier-ignore
      const l1 = l0 + g.length;
      const top = floor + g.height;
      const P = (s, d) => [round(w.from[0] + w.along[0] * s + w.inward[0] * d), round(w.from[1] + w.along[1] * s + w.inward[1] * d)]; // prettier-ignore
      const quad = (s0, s1, d0, d1, z0, z1, texture) => solid([P(s0, d0), P(s1, d0), P(s1, d1), P(s0, d1)].flatMap((q) => [[...q, z0]]).concat([P(s0, d0), P(s1, d0), P(s1, d1), P(s0, d1)].map((q) => [...q, z1])), texture, { faces: [[0, 1, 2], [4, 5, 6], [0, 1, 4], [1, 2, 5], [2, 3, 6], [3, 0, 7]] }); // prettier-ignore
      const stone = { top: t.floor, bottom: t.ceiling, sides: t.base };
      // the ledge: a slab of 16, on posts along its edge, a parapet of 36 along its edge and its far end
      brushes.push(quad(l0, l1, 0, g.deep, top - 16, top, stone));
      const posts = Math.max(2, Math.round(g.length / 128) + 1);
      for (let k = 0; k < posts; k++) {
        const s = l0 + 12 + ((g.length - 24) * k) / (posts - 1);
        brushes.push(quad(s - 8, s + 8, g.deep - 20, g.deep - 4, floor, top - 16, t.pillar));
      }
      brushes.push(quad(l0, l1, g.deep - 8, g.deep, top, top + 36, t.base));
      const far = before ? [l1 - 8, l1] : [l0, l0 + 8];
      brushes.push(quad(far[0], far[1], 0, g.deep - 8, top, top + 36, t.base));
      // the stair: a step every `tread` along the wall, each solid down to the floor, up to the ledge's end
      const stair = [];
      for (let k = 1; k < steps; k++) {
        const z = floor + Math.round((k * g.height) / steps);
        const [s0, s1] = before ? [l0 - run + (k - 1) * g.tread, l0] : [l1, l1 + run - (k - 1) * g.tread];
        stair.push(quad(s0, s1, 0, g.stair, floor - 1, z, stone));
      }
      if (!g.loose) brushes.push(...stair);
      const [g0, g1] = before ? [l0 - run, l1] : [l0, l1 + run];
      for (const o of line) { const at = along(w, o.from); o.gaps.push([g0 - 8 - at, g1 + 8 - at]); } // prettier-ignore
      for (let s = g0 + 24; s < g1; s += 48) keepOff.push([...P(s, g.deep / 2), g.deep / 2 + 8]);
      const foot = before ? P(l0 - run - 40, g.stair / 2) : P(l1 + run + 40, g.stair / 2);
      keepOff.push([...foot, 40]);
      raised = { top, from: P(l0, 0), to: P(l1, 0), foot, ...(g.loose ? { steps: stair } : {}) };
    }
  }
  // the base along every wall battered (its face leaning back, 10 out at the floor and 3 at its top, as the
  // keeps' walls are), and the moulding under the ceiling
  for (const w of walls) {
    if (base > 0)
      for (const [a, b] of stretches(w))
        brushes.push(band(a, b, w.inward, 10, floor, floor + base, t.base, 3));
    const top = vault > 0 ? ceiling - vault : ceiling;
    if (trim > 0 && top - floor > 96) brushes.push(band(w.from, w.to, w.inward, 6, top - trim, top, t.trim));
  }
  // the beams: across the room's short way (the long way is its longest wall's), resting on corbels or pilasters
  const taken = [...clear.map(([x, y, r = 64]) => [x, y, r]), ...keepOff]; // [x, y, r]: places the things keep off (doorways, a gallery)
  const longest = walls.length ? walls.reduce((a, b) => (b.length > a.length ? b : a)) : null;
  const posts = []; // [x, y, r]: pilasters and corbels on the walls, which a torch keeps off
  const chainsAt = []; // [x, y]: where chains hang from the beams
  const cards = []; // see-through pictures: webs, moss, chains (a func_illusionary of render mode 4)
  // a pitched ceiling (wicardoven's halls and lofts): two slopes from the long walls up to a ridge along the
  // room's middle, `vault` units over the walls' top, with tie beams across there
  let tie = ceiling;
  if (vault > 0 && longest) {
    const u = longest.along;
    const v = [-u[1], u[0]];
    const us = ring.map((p) => p[0] * u[0] + p[1] * u[1]);
    const vs = ring.map((p) => p[0] * v[0] + p[1] * v[1]);
    const [u0, u1, v0, v1] = [Math.min(...us) - 16, Math.max(...us) + 16, Math.min(...vs) - 16, Math.max(...vs) + 16]; // prettier-ignore
    const vm = (v0 + v1) / 2;
    tie = ceiling - vault;
    const at = (uu, vv) => [round(u[0] * uu + v[0] * vv), round(u[1] * uu + v[1] * vv)];
    for (const [a, b] of [
      [v0, vm],
      [v1, vm],
    ]) {
      // the slope's solid: from the wall's line at the walls' top up to the ridge, filled to the ceiling
      const corners = [];
      for (const uu of [u0, u1]) for (const [vv, z] of [[a, tie], [a, ceiling], [b, ceiling]]) corners.push([...at(uu, vv), z]); // prettier-ignore
      brushes.push(solid(corners, t.ceiling));
    }
  }
  if (inlay && t.inlay && walls.length) {
    // the middle of the floor laid in another stone, a band of the room's own round it (2 high: a player
    // steps on it unawares)
    const inner = insetRing(ring, 56);
    if (inner && Math.abs(areaOf(inner)) > 96 * 96)
      brushes.push(solid([...inner.map(([x, y]) => [x, y, floor]), ...inner.map(([x, y]) => [x, y, floor + 2])], { top: t.inlay, bottom: t.inlay, sides: t.base })); // prettier-ignore
  }
  if (dais && longest) {
    // a dais at one end of a hall: a step of 16 along its far wall across the long way, 96 deep
    const ends = walls.filter(
      (w) => Math.abs(w.along[0] * longest.along[0] + w.along[1] * longest.along[1]) < 0.3,
    );
    const end = ends.sort((a, b) => b.length - a.length)[0];
    if (end) {
      brushes.push(band(end.from, end.to, end.inward, 96, floor, floor + 16, { top: t.inlay ?? t.floor, bottom: t.floor, sides: t.base })); // prettier-ignore
      const mid = [
        (end.from[0] + end.to[0]) / 2 + end.inward[0] * 48,
        (end.from[1] + end.to[1]) / 2 + end.inward[1] * 48,
      ];
      taken.push([mid[0], mid[1], 40]);
    }
  }
  if (beams > 0 && tie - floor >= 128 && walls.length) {
    const u = walls.reduce((a, b) => (b.length > a.length ? b : a)).along;
    const v = [-u[1], u[0]];
    const us = ring.map((p) => p[0] * u[0] + p[1] * u[1]);
    const [u0, u1] = [Math.min(...us), Math.max(...us)];
    const count = Math.floor((u1 - u0) / beams);
    for (let k = 1; k <= count; k++) {
      const s = u0 + ((u1 - u0) * k) / (count + 1);
      // where the line p·u = s crosses the room: pairs of crossings of the outline
      const hits = [];
      for (let i = 0; i < ring.length; i++) {
        const [a, b] = [ring[i], ring[(i + 1) % ring.length]];
        const [da, db] = [a[0] * u[0] + a[1] * u[1] - s, b[0] * u[0] + b[1] * u[1] - s];
        if (da < 0 === db < 0 || da === db) continue;
        const f = da / (da - db);
        const p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        hits.push(p[0] * v[0] + p[1] * v[1]);
      }
      hits.sort((a, b) => a - b);
      for (let h = 0; h + 1 < hits.length; h += 2) {
        const [v0, v1] = [hits[h] - 8, hits[h + 1] + 8];
        const at = (vv) => [u[0] * s + v[0] * vv, u[1] * s + v[1] * vv];
        brushes.push(post(at(v0), u, v, 16, v1 - v0, tie - 16, tie, t.beam));
        // its ends: a pilaster from the floor in a hall, a corbel under it elsewhere
        for (const [end, sign] of [
          [hits[h], 1],
          [hits[h + 1], -1],
        ]) {
          const foot = at(end - sign * 8);
          const dir = sign > 0 ? v : [-v[0], -v[1]];
          // (a corbel where a doorway is under the beam's end: a pilaster would stand in it)
          if (how.pilasters && !beforeDoor(foot, 24))
            brushes.push(post(foot, u, dir, 28, 20, floor, tie - 16, t.pillar));
          else brushes.push(post(foot, u, dir, 18, 24, tie - 44, tie - 16, t.beam));
          const inner = at(end + sign * 16);
          taken.push([inner[0], inner[1], how.pilasters ? 28 : 8]);
          posts.push([foot[0], foot[1], how.pilasters ? 20 : 12]);
        }
        // a wide hall's columns: under the beam, 96 in from each wall, standing free (a thing before another)
        if (how.pilasters && hits[h + 1] - hits[h] >= 320)
          for (const vv of [hits[h] + 96, hits[h + 1] - 96]) {
            if (beforeDoor(at(vv), 64)) continue;
            brushes.push(post(at(vv), u, v, 24, 24, floor, tie - 16, t.pillar));
            brushes.push(post(at(vv), u, v, 36, 36, floor, floor + 12, t.base));
            taken.push([...at(vv), 32]);
          }
        // a chain hanging from a beam
        if ((t.chains ?? 0) > 0 && rand() < t.chains)
          chainsAt.push(at((hits[h] + hits[h + 1]) / 2 + (rand() - 0.5) * 64));
      }
    }
  }
  // torches on the walls: a bracket, its fire, its light
  const hung = []; // [x, y]: the torches hung so far
  if (torches > 0)
    for (const w of walls) {
      if (w.length < 96) continue;
      const count = Math.max(1, Math.round(w.length / torches));
      for (let k = 0; k < count; k++) {
        // its place along the wall: the middle of its share, or a little to either side, off the posts
        const at = (s) => [w.from[0] + w.along[0] * s, w.from[1] + w.along[1] * s];
        const share = w.length / count;
        // (off the posts, the doorways and the other torches: two on the walls either side of a cut corner
        // would hang side by side)
        const p = [0, 0.2, -0.2, 0.35, -0.35].map((f) => at(share * (k + 0.5 + f))).find((q) => !posts.some(([x, y, r]) => Math.hypot(x - q[0], y - q[1]) < r + 16) && !hung.some(([x, y]) => Math.hypot(x - q[0], y - q[1]) < 128) && !w.gaps.some(([a, b]) => { const s = (q[0] - w.from[0]) * w.along[0] + (q[1] - w.from[1]) * w.along[1]; return s > a - 32 && s < b + 32; })); // prettier-ignore
        if (!p) continue;
        hung.push(p);
        const z = floor + torchHeight;
        // the game's own wall torch (the_wall's), at 0.6 of its size (whole, it is 92 high: twice a torch of
        // the game's rooms): its plate 18 out of its middle on its +y, its fire in a cage 22 the other way,
        // 11 to 52 over its origin; it turns so that its plate is on the wall
        const at0 = [p[0] + w.inward[0] * 18 * TORCH_SCALE, p[1] + w.inward[1] * 18 * TORCH_SCALE].map(
          Math.round,
        );
        const yaw = Math.round((Math.atan2(-w.inward[1], -w.inward[0]) * 180) / Math.PI - 90);
        entities.push(pointEntity("env_model", [...at0, z - 10], { model: TORCH, angles: `0 ${yaw} 0`, framerate: "1.0", scale: String(TORCH_SCALE) })); // prettier-ignore
        const fire = [p[0] + w.inward[0] * 26, p[1] + w.inward[1] * 26].map(Math.round);
        entities.push(light([...fire, z + 14], { color: glow.slice(0, 3), brightness: glow[3] }));
        // no thing of a room stands as high as a torch (104): they keep nothing off the floor
      }
    }
  // what hangs: webs across the cut corners high up, moss down from the walls' tops, chains from the beams
  const top = vault > 0 ? ceiling - vault : ceiling;
  for (const w of walls) {
    if (w.length < 72 && (t.webs ?? 0) > 0 && rand() < t.webs) {
      // a cut corner (a short wall): a web across it, a little out from it, its top at the ceiling
      const mid = [
        (w.from[0] + w.to[0]) / 2 + w.inward[0] * 10,
        (w.from[1] + w.to[1]) / 2 + w.inward[1] * 10,
      ];
      const size = Math.round(w.length + 24);
      const turn = (Math.atan2(w.along[1], w.along[0]) * 180) / Math.PI;
      cards.push(...card(mid, top - size, [size, size], { name: rand() < 0.5 ? "{Transp_Web4" : "{Transp_Web5", size: [128, 128] }, turn, { crossed: false })); // prettier-ignore
    } else if (w.length >= 128 && (t.moss ?? 0) > 0 && rand() < t.moss) {
      // moss hanging down a wall from its top, along some of it
      const long = Math.min(w.length - 32, 128 + rand() * 128);
      const s = 16 + rand() * (w.length - 32 - long) + long / 2;
      const mid = [
        w.from[0] + w.along[0] * s + w.inward[0] * 3,
        w.from[1] + w.along[1] * s + w.inward[1] * 3,
      ];
      const high = Math.round(long / 2);
      const turn = (Math.atan2(w.along[1], w.along[0]) * 180) / Math.PI;
      cards.push(...card(mid, top - high, [Math.round(long), high], { name: rand() < 0.5 ? "{moss2" : "{ms_moss01", size: [256, 256] }, turn, { crossed: false })); // prettier-ignore
    }
  }
  for (const at of chainsAt) {
    const long = 64 + Math.round(rand() * 64);
    cards.push(
      ...card(at, tie - 16 - long, [16, long], { name: "{chain", size: [64, 240] }, rand() * 90, {
        crossed: true,
      }),
    );
  }

  // the things: in the middle (tables down the long way), then against the walls
  const area = Math.abs(areaOf(ring));
  const free = (p, r) =>
    within(ring, p) && !taken.some(([x, y, q]) => Math.hypot(x - p[0], y - p[1]) < q + r);
  const put = (name, p, yaw, over = 0) => {
    const thing = ROOM_THINGS[name];
    entities.push(pointEntity("env_model", [Math.round(p[0]), Math.round(p[1]), Math.round(floor + over + (thing.lift ?? 0))], { model: thing.model, angles: `0 ${Math.round(yaw)} 0` })); // prettier-ignore
    if (!over) taken.push([p[0], p[1], thing.r]);
    things.push({ name, at: p.map(Math.round), yaw: Math.round(yaw) });
  };
  if (how.middle && walls.length) {
    const yaw = (Math.atan2(longest.along[1], longest.along[0]) * 180) / Math.PI;
    const c = centreOf(ring);
    const tables = how.middle === "tables" ? Math.max(1, Math.floor(longest.length / 260)) : 1;
    for (let k = 0; k < tables; k++) {
      const off = (k - (tables - 1) / 2) * 200;
      // its place in the middle, or moved along the room's length where a doorway keeps that clear
      const p = [0, 64, -64, 128, -128].map((shift) => [c[0] + longest.along[0] * (off + shift), c[1] + longest.along[1] * (off + shift)]).find((q) => free(q, ROOM_THINGS.table.r)); // prettier-ignore
      if (!p) continue;
      // chairs either side first (the table keeps the rest off once it is put)
      for (const side of [-1, 1])
        for (const along of [-30, 30]) {
          const q = [p[0] + longest.inward[0] * side * 60 + longest.along[0] * along, p[1] + longest.inward[1] * side * 60 + longest.along[1] * along]; // prettier-ignore
          if (rand() < 0.75 && free(q, 10))
            put("chair", q, yaw + (side > 0 ? -90 : 90) + (rand() - 0.5) * 30);
        }
      put("table", p, yaw + 90);
      // books on a library's table
      if (use === "library" && rand() < 0.8) put("books", p, rand() * 360, 30);
    }
  }
  // places kept for the builder: by a wall, free, found before the wall things are put (a full room has none left)
  const kept = [];
  for (let tries = 0; kept.length < spots && tries < spots * 40 && walls.length; tries++) {
    const w = walls[Math.floor(rand() * walls.length)];
    if (w.length < 72) continue;
    const s = 32 + rand() * (w.length - 64);
    const p = [w.from[0] + w.along[0] * s + w.inward[0] * 36, w.from[1] + w.along[1] * s + w.inward[1] * 36];
    if (!free(p, 32) || beforeDoor(p, 16)) continue;
    taken.push([p[0], p[1], 32]);
    kept.push({
      at: p.map(Math.round),
      yaw: Math.round((Math.atan2(w.inward[1], w.inward[0]) * 180) / Math.PI),
    });
  }
  const choices = Object.entries(how.walls);
  const wanted = Math.round(area * how.perArea + rand());
  const once = new Set();
  for (let tries = 0, made = 0; made < wanted && tries < wanted * 12 && choices.length; tries++) {
    let r = rand() * choices.reduce((s, [, w]) => s + w, 0);
    const [name] = choices.find(([, w]) => (r -= w) < 0) ?? choices[0];
    if (how.once?.includes(name) && once.has(name)) continue;
    const thing = ROOM_THINGS[name];
    const w = walls[Math.floor(rand() * walls.length)];
    if (!w || w.length < thing.r * 2 + 24) continue;
    const s = thing.r + 12 + rand() * (w.length - thing.r * 2 - 24);
    const out = thing.wall ?? thing.r;
    const p = [w.from[0] + w.along[0] * s + w.inward[0] * (out + 4), w.from[1] + w.along[1] * s + w.inward[1] * (out + 4)]; // prettier-ignore
    if (!free(p, thing.r)) continue;
    put(name, p, (Math.atan2(w.inward[1], w.inward[0]) * 180) / Math.PI);
    once.add(name);
    made++;
  }
  return { brushes, cards, entities, things, spots: kept, ...(raised ? { gallery: raised } : {}) };
}

/** The ring moved in by `d` along each side's inward normal (a convex ring; null if it vanishes). */
function insetRing(ring, d) {
  const sign = areaOf(ring) > 0 ? 1 : -1;
  const lines = ring.map((p, i) => {
    const q = ring[(i + 1) % ring.length];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const n = [(-(q[1] - p[1]) / l) * sign, ((q[0] - p[0]) / l) * sign];
    return { p: [p[0] + n[0] * d, p[1] + n[1] * d], dir: [(q[0] - p[0]) / l, (q[1] - p[1]) / l] };
  });
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const [a, b] = [lines[(i + lines.length - 1) % lines.length], lines[i]];
    const den = a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0];
    if (Math.abs(den) < 1e-6) continue;
    const k = ((b.p[0] - a.p[0]) * b.dir[1] - (b.p[1] - a.p[1]) * b.dir[0]) / den;
    out.push([Math.round(a.p[0] + a.dir[0] * k), Math.round(a.p[1] + a.dir[1] * k)]);
  }
  return out.length >= 3 && Math.sign(areaOf(out)) === sign ? out : null;
}

function areaOf(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [p, q] = [ring[i], ring[(i + 1) % ring.length]];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}
function centreOf(ring) {
  const a = areaOf(ring);
  let cx = 0,
    cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [p, q] = [ring[i], ring[(i + 1) % ring.length]];
    const k = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * k;
    cy += (p[1] + q[1]) * k;
  }
  return [cx / (6 * a), cy / (6 * a)];
}
