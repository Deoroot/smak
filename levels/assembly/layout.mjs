// The layout of a building (`smak-layout/1`, levels/assembly/README.md): a building description laid on the
// 64-unit grid, storey by storey, by constrained growth (Lopes, Tutenel, Smelik, de Kraker, Bidarra, "A
// constrained growth method for procedural floor plan generation", GAME-ON 2010; levels/notes-prior-art.md,
// "Layout"):
//
// 1. the stairwell (2 x 4 cells) is placed first, its long side on an outside wall where it can be, the two cells at
//    its foot inside the building; the same cells are kept on every storey ("stair", and on the storey the stair
//    climbs to "void" over the flights with the top landing "stair");
// 2. the rooms the stair opens onto (stairFrom, stairTo) start on the two cells at its foot; the others are seeded
//    one by one, each near the rooms it shares a door with, the entrance room and the rooms that want windows on an
//    outside wall;
// 3. the rooms grow as rectangles, the one furthest below its share first, then into L shapes by whole runs of
//    cells along a side, then the cells left over go to the neighbour that wants them most; a repair then moves
//    cells so that every two rooms a door joins share a straight wall of 2 edges at least (a doorway is 128 of wall,
//    its middle vertex free of other walls), lengthened towards 4 so the door stands clear of the corners;
// 4. doors and the entrance are put on 2 collinear edges each, with a room 2 cells deep in front of them on the side
//    the leaf swings into (`swing`); the windows on single outside edges away from them; a rail closes the void.
//
// One seed gives one layout: a small PRNG of its own drives every choice, and a number of tries (each its own
// stream of the seed) are made and the best kept: the fewest failures, then the fewest slivers, ragged rooms and
// doors at a wall's corners. The most promising tries are made again with a polish (a descent over cell moves,
// polishStorey) and, when the best still warns, shaken out of it. A door pair with no doorway that fits fails the
// try. The layout is then checked (checkLayout) and its sentences put in failures and warnings.
import { checkBuilding, STAIRWELL } from "./building.mjs";
import { styleOf, checkStyle, storeyCost } from "./style.mjs";

export const LAYOUT_FORMAT = "smak-layout/1";
export const GRID = 64;
export const STOREY_HEIGHT = 192;
/** How many tries a seed makes; the best is kept. */
export const TRIES = 192;
/** How many of the best tries are made again with the polish (polishStorey). */
export const POLISHED = 16;
/** When the best polished try still warns: how many of the best tries are shaken (KICKS times each storey). */
export const SHAKEN = 4;
export const KICKS = 24;

// ── the seeded numbers ──

/** mulberry32: a small PRNG, a float in [0, 1) each call. */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const streamOf = (seed, n) => (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(n + 1, 0x85ebca6b)) >>> 0;
/** One of `items` chosen with chance in proportion to `weight(item)`. */
const pick = (rng, items, weight = () => 1) => {
  const ws = items.map(weight);
  const sum = ws.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return items[Math.floor(rng() * items.length)];
  let r = rng() * sum;
  for (let i = 0; i < items.length; i++) if ((r -= ws[i]) < 0) return items[i];
  return items[items.length - 1];
};

// ── the grid ──

const DIRS = { north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0] };
const STEPS = Object.values(DIRS);
const isRoom = (v) => typeof v === "string" && v !== "stair" && v !== "void";
const at = (cells, x, y) => (y >= 0 && y < cells.length && x >= 0 && x < cells[0].length ? cells[y][x] : null);

/**
 * The two cells either side of an edge (from/to grid vertices, one 64 segment): [south or west, north or east].
 */
export function cellsAcross(edge) {
  const [[x0, y0], [x1, y1]] = [edge.from, edge.to];
  if (y0 === y1) return [[Math.min(x0, x1), y0 - 1], [Math.min(x0, x1), y0]];
  return [[x0 - 1, Math.min(y0, y1)], [x0, Math.min(y0, y1)]];
}
/** The edge between two cells side by side, from its lesser vertex to its greater. */
export function edgeBetween([ax, ay], [bx, by]) {
  if (ay === by) {
    const x = Math.max(ax, bx);
    return { from: [x, ay], to: [x, ay + 1] };
  }
  const y = Math.max(ay, by);
  return { from: [ax, y], to: [ax + 1, y] };
}
export const edgeKey = (e) => `${e.from[0]},${e.from[1]}-${e.to[0]},${e.to[1]}`;

/** The edges a doorway spans (README, "Units and the grid"): two collinear edges, 128 of wall. */
export const DOOR_EDGES = 2;
/** The wall a doorway wants to stand clear of both its corners: one edge either side of it. */
export const CLEAR_EDGES = 4;
/**
 * The cells of room a leaf swings into, in front of a doorway: 2 rows deep across its 2 edges. The door piece's leaf,
 * open, stands out 74 from the wall; a room one cell deep (56 clear) cannot hold it.
 */
export const SWING_DEPTH = 2;
/** Rooms a door swings out of when the room on its other side has the depth: halls and corridors. */
const passage = (kind) => kind === "hall" || kind === "corridor";

/**
 * The straight runs of wall between room `a` and room `b` (null: outside the building) on a storey's cells, each
 * { flat, line, start, len, aSide }: flat runs lie along y = line from x = start, upright ones along x = line from
 * y = start; aSide is +1 when a's cells are on the greater side (north or east), -1 when on the lesser. Along one
 * run a stays on one side, so every vertex inside a run is free of other walls.
 */
export function runsBetween(cells, a, b) {
  const h = cells.length;
  const w = cells[0].length;
  const runs = [];
  const scan = (flat, lines, len, sideOf) => {
    for (let line = 0; line <= lines; line++) {
      let run = null;
      for (let k = 0; k <= len; k++) {
        const side = k < len ? sideOf(line, k) : 0;
        if (run && side === run.aSide) run.len++;
        else {
          if (run) runs.push(run);
          run = side ? { flat, line, start: k, len: 1, aSide: side } : null;
        }
      }
    }
  };
  // flat edges: between (x, y - 1) and (x, y); upright: between (x - 1, y) and (x, y)
  const side = (lo, hi) => (lo === b && hi === a ? 1 : lo === a && hi === b ? -1 : 0);
  scan(true, h, w, (y, x) => side(at(cells, x, y - 1), at(cells, x, y)));
  scan(false, w, h, (x, y) => side(at(cells, x - 1, y), at(cells, x, y)));
  return runs;
}
/** The longest straight run of wall two rooms share, in edges (0 when they do not touch). */
export const sharedRun = (cells, a, b) => Math.max(0, ...runsBetween(cells, a, b).map((r) => r.len));

/**
 * Every place a doorway (2 edges of one run) can stand between a and b: { edges, at, ends, len, i, corners, off,
 * deep } where corners counts its two ends that are a run's end (a corner, or another wall's end), off is how far
 * its middle is from the run's, and deep lists the rooms (a, b) with SWING_DEPTH rows of their own in front of it.
 */
export function doorwaysBetween(cells, a, b) {
  const out = [];
  const vert = (r, k) => (r.flat ? [k, r.line] : [r.line, k]);
  const cell = (r, k, depth) => {
    // the cell `depth` rows (1, 2) in front of along-position k, on side s (+1 greater, -1 lesser)
    const row = (s) => (s > 0 ? r.line + depth - 1 : r.line - depth);
    return (s) => (r.flat ? at(cells, k, row(s)) : at(cells, row(s), k));
  };
  for (const r of runsBetween(cells, a, b))
    for (let i = 0; i + DOOR_EDGES <= r.len; i++) {
      const k0 = r.start + i;
      const edges = [0, 1].map((j) => ({ from: vert(r, k0 + j), to: vert(r, k0 + j + 1) }));
      const deep = [];
      for (const [room, s] of [[a, r.aSide], [b, -r.aSide]]) {
        if (room === null) continue;
        let ok = true;
        for (let d = 1; d <= SWING_DEPTH && ok; d++) for (const k of [k0, k0 + 1]) if (cell(r, k, d)(s) !== room) ok = false;
        if (ok) deep.push(room);
      }
      out.push({
        edges,
        at: vert(r, k0 + 1),
        ends: [vert(r, k0), vert(r, k0 + 2)],
        len: r.len,
        i,
        corners: (i === 0) + (i + DOOR_EDGES === r.len),
        off: Math.abs(i + 1 - r.len / 2),
        deep,
      });
    }
  return out;
}
/** The sentence of two rooms whose shared wall is too short for a door. */
export const shortWallSentence = (a, b, n, storey) =>
  `door ${a}-${b}: ${a} and ${b} share ${n ? `a straight wall of ${n} ${n === 1 ? "edge" : "edges"}` : "no wall"} on storey ${storey}; a door wants ${DOOR_EDGES} with no wall meeting its middle (64 clear needs 128 of wall)`;
/** The sentence of a door with no room deep enough to swing into. */
export const shallowSentence = (a, b, storey) =>
  `door ${a}-${b}: on storey ${storey} no doorway on the wall ${a} and ${b} share has ${SWING_DEPTH} rows of either room in front of it; its leaf, open, stands 74 into the room it swings into (a room 1 cell deep holds 56)`;

// ── 1. the stairwell ──

/** Every stairwell the footprint holds: 2 x 4 cells, with two cells inside the building at its foot. */
function stairwells(w, h) {
  const out = [];
  const add = (x, y, sw, sh, foot) => {
    if (x < 0 || y < 0 || x + sw > w || y + sh > h) return;
    const cells = [];
    for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) cells.push([x + i, y + j]);
    // the foot end's row inside the well and the two cells beyond it, lane 0 then lane 1. Lane 0 (the first flight)
    // is on the left of one walking up into the well, the one hand the stair piece has (stair-u: its frame's x 0..64)
    const row = {
      south: [[x, y], [x + 1, y]],
      north: [[x + 1, y + sh - 1], [x, y + sh - 1]],
      west: [[x, y + 1], [x, y]],
      east: [[x + sw - 1, y], [x + sw - 1, y + 1]],
    }[foot];
    const [dx, dy] = DIRS[foot];
    const outside = row.map(([cx, cy]) => [cx + dx, cy + dy]);
    if (outside.some(([cx, cy]) => cx < 0 || cy < 0 || cx >= w || cy >= h)) return;
    // the long sides on the outside wall
    const long = foot === "south" || foot === "north" ? [x === 0, x + sw === w] : [y === 0, y + sh === h];
    // the gaps it leaves to the outside walls: none, or 2 cells and more (a gap of 1 is a sliver of a room)
    const gaps = [x, y, w - x - sw, h - y - sh];
    const footGap = { west: gaps[0], south: gaps[1], east: gaps[2], north: gaps[3] }[foot];
    const tidy = gaps.every((g) => g === 0 || g >= 2) && footGap >= 2;
    out.push({ rect: [x, y, sw, sh], cells, foot, row, outside, onWall: long.filter(Boolean).length, tidy });
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      for (const foot of ["south", "north"]) add(x, y, STAIRWELL.wide, STAIRWELL.long, foot);
      for (const foot of ["west", "east"]) add(x, y, STAIRWELL.long, STAIRWELL.wide, foot);
    }
  return out;
}

/**
 * The stairwell of one try: a long side on an outside wall, and no gap of a single cell to a wall, when the footprint
 * allows.
 */
function chooseStairwell(w, h, rng, offFront = null) {
  let all = stairwells(w, h);
  if (!all.length) return null;
  // off the front wall when asked (description `stairOffFront`): the front is for the doors and shop windows
  if (offFront) {
    const onFront = (s) => s.cells.some(([x, y]) => ({ south: y === 0, north: y === h - 1, west: x === 0, east: x === w - 1 })[offFront]); // prettier-ignore
    if (all.some((s) => !onFront(s))) all = all.filter((s) => !onFront(s));
  }
  const tidy = all.some((s) => s.tidy) ? all.filter((s) => s.tidy) : all;
  const best = Math.max(...tidy.map((s) => s.onWall));
  return pick(rng, tidy.filter((s) => s.onWall === best));
}

// ── 2. and 3. the rooms of one storey, seeded and grown ──

function growStorey(cells, rooms, doors, rng, polish = null) {
  const h = cells.length;
  const w = cells[0].length;
  const free = (x, y) => x >= 0 && y >= 0 && x < w && y < h && cells[y][x] === undefined;
  const state = new Map(rooms.map((r) => [r.id, { room: r, cells: [], rect: null }]));
  const put = (id, x, y) => {
    cells[y][x] = id;
    state.get(id).cells.push([x, y]);
  };
  const left = cells.flat().filter((v) => v === undefined).length;
  const sumLeast = rooms.reduce((n, r) => n + r.area[0], 0);
  const sumMost = rooms.reduce((n, r) => n + r.area[1], 0);
  const share = (r) =>
    sumMost === sumLeast ? r.area[0] : r.area[0] + ((left - sumLeast) * (r.area[1] - r.area[0])) / (sumMost - sumLeast);
  for (const r of rooms) state.get(r.id).target = Math.min(r.area[1], Math.max(r.area[0], share(r)));

  const partners = new Map(rooms.map((r) => [r.id, new Set()]));
  for (const [a, b] of doors) partners.get(a)?.add(b), partners.get(b)?.add(a);

  // the rooms the stair opens onto stand on the cells at its foot already
  for (const r of rooms)
    if (r.fixed) {
      for (const [x, y] of r.fixed) put(r.id, x, y);
      const xs = r.fixed.map((c) => c[0]);
      const ys = r.fixed.map((c) => c[1]);
      state.get(r.id).rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }

  // the seeding order: from the rooms already placed (else the entrance) outward through the doors
  const order = [];
  const queue = rooms.filter((r) => r.fixed).map((r) => r.id);
  if (!queue.length) queue.push(...(rooms.some((r) => r.entrance) ? rooms.filter((r) => r.entrance) : [rooms[0]]).map((r) => r.id)); // prettier-ignore
  const queued = new Set(queue);
  while (order.length < rooms.length) {
    if (!queue.length) {
      const next = rooms.find((r) => !queued.has(r.id));
      queue.push(next.id), queued.add(next.id);
    }
    const id = queue.shift();
    order.push(id);
    for (const p of partners.get(id)) if (!queued.has(p)) queued.add(p), queue.push(p);
  }

  const onWall = (x, y) => x === 0 || y === 0 || x === w - 1 || y === h - 1;
  const wantsWall = (r) => r.entrance || r.kind !== "hall";
  for (const id of order) {
    const st = state.get(id);
    if (st.cells.length) continue;
    const placed = [...state.values()].filter((s) => s.cells.length);
    const options = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!free(x, y)) continue;
        let near = Infinity;
        let pull = 0;
        for (const s of placed) {
          let d = Infinity;
          let m = Infinity;
          for (const [cx, cy] of s.cells) {
            d = Math.min(d, Math.max(Math.abs(cx - x), Math.abs(cy - y)));
            m = Math.min(m, Math.abs(cx - x) + Math.abs(cy - y));
          }
          near = Math.min(near, d);
          if (partners.get(id).has(s.room.id)) pull += 1 / (1 + m);
        }
        // room to grow: free cells in the square about the cell as wide as the room's share
        const reach = Math.max(1, Math.round(Math.sqrt(st.target) / 2));
        let room = 0;
        for (let j = -reach; j <= reach; j++) for (let i = -reach; i <= reach; i++) if (free(x + i, y + j)) room++;
        const weight =
          (pull + 0.05) *
          (wantsWall(st.room) && onWall(x, y) ? 2 : 1) *
          (1 + Math.min(near, 4)) *
          (room / (2 * reach + 1) ** 2) ** 2;
        options.push({ x, y, near, weight });
      }
    if (!options.length) continue;
    const apart = options.filter((o) => o.near >= 2);
    const pool = (apart.length ? apart : options).sort((a, b) => b.weight - a.weight).slice(0, 5);
    const c = pick(rng, pool, (o) => o.weight);
    put(id, c.x, c.y);
    st.rect = [c.x, c.y, c.x, c.y];
  }

  // rectangles: the room furthest below its share grows a whole side, the side that keeps it squarest
  const strip = ([x0, y0, x1, y1], dir) => {
    const out = [];
    if (dir === "east" || dir === "west") {
      const x = dir === "east" ? x1 + 1 : x0 - 1;
      for (let y = y0; y <= y1; y++) out.push([x, y]);
    } else {
      const y = dir === "north" ? y1 + 1 : y0 - 1;
      for (let x = x0; x <= x1; x++) out.push([x, y]);
    }
    return out;
  };
  const grown = (r, dir) => {
    const [x0, y0, x1, y1] = r;
    return { east: [x0, y0, x1 + 1, y1], west: [x0 - 1, y0, x1, y1], north: [x0, y0, x1, y1 + 1], south: [x0, y0 - 1, x1, y1] }[dir]; // prettier-ignore
  };
  const ratio = (s) => s.cells.length / s.target;
  const active = new Set([...state.values()].filter((s) => s.rect).map((s) => s.room.id));
  while (active.size) {
    const s = [...active].map((id) => state.get(id)).sort((a, b) => ratio(a) - ratio(b))[0];
    const n = s.cells.length;
    const options = [];
    for (const dir of Object.keys(DIRS)) {
      const add = strip(s.rect, dir);
      if (!add.every(([x, y]) => free(x, y))) continue;
      const area = n + add.length;
      if (!(area <= Math.ceil(s.target) || (n < s.room.area[0] && area <= s.room.area[1]))) continue;
      const [x0, y0, x1, y1] = grown(s.rect, dir);
      const [a, b] = [x1 - x0 + 1, y1 - y0 + 1];
      options.push({ dir, add, aspect: Math.max(a, b) / Math.min(a, b) });
    }
    if (!options.length || n >= s.target) {
      active.delete(s.room.id);
      continue;
    }
    const least = Math.min(...options.map((o) => o.aspect));
    const o = pick(rng, options.filter((o) => o.aspect === least));
    for (const [x, y] of o.add) put(s.room.id, x, y);
    s.rect = grown(s.rect, o.dir);
  }

  // L shapes: a room still below its share takes a run of free cells along one of its sides, two or more long
  const runsBeside = (s) => {
    const runs = [];
    const mine = new Set(s.cells.map(([x, y]) => `${x},${y}`));
    for (const [dir, [dx, dy]] of Object.entries(DIRS)) {
      const line = new Map();
      for (const [x, y] of s.cells) {
        const [nx, ny] = [x + dx, y + dy];
        if (!free(nx, ny) || mine.has(`${nx},${ny}`)) continue;
        const k = dx ? nx : ny;
        (line.get(k) ?? line.set(k, []).get(k)).push([nx, ny]);
      }
      for (const group of line.values()) {
        group.sort((a, b) => (dx ? a[1] - b[1] : a[0] - b[0]));
        let run = [group[0]];
        for (let i = 1; i <= group.length; i++) {
          const prev = group[i - 1];
          const c = group[i];
          if (c && (dx ? c[1] - prev[1] : c[0] - prev[0]) === 1) run.push(c);
          else {
            runs.push({ dir, cells: run });
            if (c) run = [c];
          }
        }
      }
    }
    return runs;
  };
  for (let round = 0; round < w * h; round++) {
    const wanting = [...state.values()].filter((s) => s.cells.length && s.cells.length < Math.round(s.target));
    let done = false;
    for (const s of wanting.sort((a, b) => ratio(a) - ratio(b))) {
      const room = Math.round(s.target) - s.cells.length;
      const shortOf = s.room.area[0] - s.cells.length;
      const runs = runsBeside(s).filter((r) => r.cells.length >= 2 || shortOf > 0);
      if (!runs.length) continue;
      const longest = Math.max(...runs.map((r) => Math.min(r.cells.length, Math.max(room, shortOf))));
      const r = pick(rng, runs.filter((r) => Math.min(r.cells.length, Math.max(room, shortOf)) === longest));
      for (const [x, y] of r.cells.slice(0, Math.max(room, shortOf, 1))) put(s.room.id, x, y);
      done = true;
      break;
    }
    if (!done) break;
  }

  // the cells left over: each to the neighbour room that holds it best (most of its own cells about it, under
  // its most), one at a time
  for (;;) {
    let best = null;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!free(x, y)) continue;
        const around = new Map();
        for (const [dx, dy] of STEPS) {
          const v = at(cells, x + dx, y + dy);
          if (isRoom(v) && state.has(v)) around.set(v, (around.get(v) ?? 0) + 1);
        }
        for (const [id, sides] of around) {
          const s = state.get(id);
          const score = (s.cells.length < s.room.area[1] ? 0 : 100) - sides * 10 + ratio(s);
          if (!best || score < best.score) best = { x, y, id, score };
        }
      }
    if (!best) break;
    put(best.id, best.x, best.y);
  }

  repairStorey(cells, state, doors, new Set(rooms.flatMap((r) => (r.fixed ?? []).map(([x, y]) => `${x},${y}`))), polish); // prettier-ignore
  for (const s of state.values()) s.cells = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (state.has(cells[y][x])) state.get(cells[y][x]).cells.push([x, y]); // prettier-ignore
  return state;
}

/**
 * What growth alone leaves wrong, mended by moving cells from room to room: two rooms that want a door and share
 * no wall are joined by a short way of cells given to one of them (a hall first), and a room outside its area takes
 * cells from a neighbour or gives them. No move splits a room, takes it below its least or past its most, parts two
 * rooms a door joins, or moves a cell at the stair's foot (`locked`).
 */
function repairStorey(cells, state, doors, locked, polish = null) {
  const h = cells.length;
  const w = cells[0].length;
  const cellsOf = (id) => {
    const out = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (cells[y][x] === id) out.push([x, y]);
    return out;
  };
  const connected = (id) => {
    const mine = cellsOf(id);
    if (!mine.length) return false;
    const seen = new Set([`${mine[0][0]},${mine[0][1]}`]);
    const queue = [mine[0]];
    while (queue.length) {
      const [x, y] = queue.shift();
      for (const [dx, dy] of STEPS) {
        const k = `${x + dx},${y + dy}`;
        if (!seen.has(k) && at(cells, x + dx, y + dy) === id) seen.add(k), queue.push([x + dx, y + dy]);
      }
    }
    return seen.size === mine.length;
  };
  const meets = (a, b) =>
    cellsOf(a).some(([x, y]) => STEPS.some(([dx, dy]) => at(cells, x + dx, y + dy) === b));
  // two rooms a door joins "touch" when they share a straight wall a doorway fits on, with a room deep enough in
  // front of it for its leaf
  const touch = (a, b) => doorwaysBetween(cells, a, b).some((o) => o.deep.length);
  const area = (id) => state.get(id).room.area;
  // a door's doorway lies on its two rooms' cells alone: a move changes only the doors of the rooms it touches
  const joined = (ids = null) => doors.filter(([a, b]) => (!ids || ids.has(a) || ids.has(b)) && touch(a, b)).length;
  /** Whether the doors among `ids` stand as many after `redo` as before it (the cells as they are now: after). */
  const kept = (ids, undo, redo) => {
    const now = joined(ids);
    undo();
    const was = joined(ids);
    redo();
    return now >= was;
  };
  /** Moves the cells to `to`; undoes it and answers false when a rule above is broken. */
  const move = (list, to, loose = false) => {
    const before = list.map(([x, y]) => cells[y][x]);
    const undo = () => list.forEach(([x, y], i) => (cells[y][x] = before[i]));
    const redo = () => list.forEach(([x, y]) => (cells[y][x] = to));
    redo();
    const donors = [...new Set(before)];
    const ok =
      donors.every((id) => cellsOf(id).length >= area(id)[0] && connected(id)) &&
      cellsOf(to).length <= area(to)[1] &&
      connected(to) &&
      (loose || kept(new Set([...donors, to]), undo, redo));
    if (!ok) undo();
    return ok;
  };

  // doors: the shortest way of other rooms' cells from `a` to a cell beside `b`, given to `a`
  const join = (a, b) => {
    const start = cellsOf(a);
    const prev = new Map(start.map(([x, y]) => [`${x},${y}`, null]));
    const queue = [...start];
    while (queue.length) {
      const [x, y] = queue.shift();
      for (const [dx, dy] of STEPS) {
        const [nx, ny] = [x + dx, y + dy];
        const k = `${nx},${ny}`;
        const v = at(cells, nx, ny);
        if (prev.has(k) || !state.has(v) || v === b || locked.has(k)) continue;
        prev.set(k, [x, y]);
        if (STEPS.some(([ex, ey]) => at(cells, nx + ex, ny + ey) === b)) {
          const way = [];
          for (let c = [nx, ny]; c && cells[c[1]][c[0]] !== a; c = prev.get(`${c[0]},${c[1]}`)) way.push(c);
          if (way.length <= 3 && move(way, a)) return true;
          continue;
        }
        queue.push([nx, ny]);
      }
    }
    return false;
  };
  // a shared wall lengthened along its line by a cell or two given to either room: to make room for a doorway
  // (2 edges), then to stand it clear of the corners (4). No door that stood is lost.
  const widen = (a, b) => {
    const run = sharedRun(cells, a, b);
    const was = joined();
    const tries = [];
    for (const [x, y] of cellsOf(a))
      for (const [dx, dy] of STEPS) {
        if (at(cells, x + dx, y + dy) !== b) continue;
        // the shared edge between (x, y) and its b neighbour; step along it both ways
        for (const s of [1, -1]) {
          const [tx, ty] = [dy * s, dx * s];
          const p = [x + tx, y + ty];
          const q = [x + dx + tx, y + dy + ty];
          const [vp, vq] = [at(cells, ...p), at(cells, ...q)];
          if (!state.has(vp) || !state.has(vq)) continue;
          if (locked.has(`${p[0]},${p[1]}`) || locked.has(`${q[0]},${q[1]}`)) continue;
          const list = [];
          if (vp !== a) list.push([p, a]);
          if (vq !== b) list.push([q, b]);
          if (list.length) tries.push(list);
        }
      }
    for (const list of tries.sort((p, q) => p.length - q.length)) {
      const before = list.map(([[x, y]]) => cells[y][x]);
      let ok = true;
      for (const [c, to] of list) if (!(ok = move([c], to, true))) break;
      if (ok && sharedRun(cells, a, b) > run && joined() >= was) return true;
      // undo what moved
      list.forEach(([[x, y]], i) => (cells[y][x] = before[i]));
    }
    return false;
  };
  const hallFirst = (a, b) => (state.get(b).room.kind === "hall" && state.get(a).room.kind !== "hall" ? [b, a] : [a, b]);
  for (let round = 0; round < 3; round++) {
    for (const pair of doors) {
      if (touch(...pair)) continue;
      const [a, b] = hallFirst(...pair);
      if (!meets(a, b)) join(a, b) || join(b, a);
      widen(a, b) || widen(b, a);
    }
    // a door clear of its corners wants a wall of 4: the short ones lengthened where the rules allow
    for (const pair of doors)
      for (let k = 0; k < 2 && sharedRun(cells, ...pair) >= DOOR_EDGES && sharedRun(cells, ...pair) < CLEAR_EDGES; k++)
        if (!(widen(...pair) || widen(pair[1], pair[0]))) break;
    // areas: one cell at a time between neighbours, the move that keeps both rooms most compact
    for (let step = 0; step < w * h; step++) {
      const out = [...state.keys()].filter((id) => {
        const n = cellsOf(id).length;
        return n < area(id)[0] || n > area(id)[1];
      });
      if (!out.length) break;
      let done = false;
      const options = [];
      for (const id of out) {
        const over = cellsOf(id).length > area(id)[1];
        for (const [x, y] of over ? cellsOf(id) : []) {
          if (locked.has(`${x},${y}`)) continue;
          for (const [dx, dy] of STEPS) {
            const v = at(cells, x + dx, y + dy);
            if (state.has(v) && v !== id) options.push({ cell: [x, y], from: id, to: v });
          }
        }
        if (!over)
          for (const [x, y] of cellsOf(id))
            for (const [dx, dy] of STEPS) {
              const [nx, ny] = [x + dx, y + dy];
              const v = at(cells, nx, ny);
              if (state.has(v) && v !== id && !locked.has(`${nx},${ny}`)) options.push({ cell: [nx, ny], from: v, to: id });
            }
      }
      const same = ([x, y], id) => STEPS.filter(([dx, dy]) => at(cells, x + dx, y + dy) === id).length;
      options.sort((p, q) => same(q.cell, q.to) - same(q.cell, q.from) - (same(p.cell, p.to) - same(p.cell, p.from)));
      for (const o of options) if (move([o.cell], o.to)) {
        done = true;
        break;
      }
      if (!done) break;
    }
  }
  // slivers: a cell that sticks out of its room (one side or none of its own) goes to the neighbour that holds it
  // on more sides, when the rules allow
  for (let step = 0; step < w * h; step++) {
    let done = false;
    for (let y = 0; y < h && !done; y++)
      for (let x = 0; x < w && !done; x++) {
        const id = cells[y][x];
        if (!state.has(id) || locked.has(`${x},${y}`)) continue;
        const sides = (v) => STEPS.filter(([dx, dy]) => at(cells, x + dx, y + dy) === v).length;
        if (sides(id) > 1) continue;
        const takers = [...new Set(STEPS.map(([dx, dy]) => at(cells, x + dx, y + dy)))]
          .filter((v) => state.has(v) && v !== id && sides(v) >= 2)
          .sort((a, b) => sides(b) - sides(a) || (a < b ? -1 : 1));
        for (const v of takers) if (move([[x, y]], v)) {
          done = true;
          break;
        }
      }
    if (!done) break;
  }
  /** Several cells moved at once, each [x, y, to]; undone, answering false, when a rule above is broken after. */
  const moveAll = (list) => {
    const before = list.map(([x, y]) => cells[y][x]);
    const undo = () => list.forEach(([x, y], i) => (cells[y][x] = before[i]));
    const redo = () => list.forEach(([x, y, to]) => (cells[y][x] = to));
    redo();
    const touched = [...new Set([...before, ...list.map((m) => m[2])])];
    const ok =
      touched.every((id) => { const n = cellsOf(id).length; return n >= area(id)[0] && n <= area(id)[1] && connected(id); }) && // prettier-ignore
      kept(new Set(touched), undo, redo);
    if (!ok) undo();
    return ok;
  };
  if (polish) polishStorey(cells, state, doors, locked, moveAll, polish);
}

/**
 * The polish, for the most promising tries only: cells moved between neighbouring rooms when that lowers the storey's
 * cost (its rooms' shapes, and the walls its doors and its entrances stand on: doorwayCost), the move that lowers it
 * most first, under the repair's rules (`moveAll`), until no move does. The moves: one cell, or two side by side of
 * one room, to a room beside them; two rooms trading a cell each; a wall slid by a cell. With `kicks`, the polished
 * storey is then shaken that many times (two moves at random from its own stream, `rng`, and polished again), and
 * the shaken one kept when it costs less: a way out of a plan no single move improves.
 */
function polishStorey(cells, state, doors, locked, moveAll, { entrances = [], kicks = 0, rng = null, style = null, front = null }) {
  const h = cells.length;
  const w = cells[0].length;
  const kinds = new Map([...state].map(([id, st]) => [id, st.room.kind]));
  const score = () =>
    shapeCost(cells) +
    (style ? storeyCost(cells, kinds, style, front) : 0) +
    doors.reduce((n, [a, b]) => n + doorwayCost(cells, a, b), 0) +
    entrances.reduce((n, id) => n + (state.has(id) ? doorwayCost(cells, id, null) : 0), 0);
  const free = (x, y) => state.has(at(cells, x, y)) && !locked.has(`${x},${y}`);
  const takersOf = (list, id) =>
    [...new Set(list.flatMap(([x, y]) => STEPS.map(([dx, dy]) => at(cells, x + dx, y + dy))))].filter((v) => state.has(v) && v !== id).sort(); // prettier-ignore
  const movesOf = () => {
    const moves = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!free(x, y)) continue;
        const id = cells[y][x];
        const groups = [[[x, y]]];
        for (const [dx, dy] of [[1, 0], [0, 1]]) if (free(x + dx, y + dy) && cells[y + dy][x + dx] === id) groups.push([[x, y], [x + dx, y + dy]]); // prettier-ignore
        for (const g of groups) for (const v of takersOf(g, id)) moves.push(g.map(([cx, cy]) => [cx, cy, v]));
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const [nx, ny] = [x + dx, y + dy];
          const v = at(cells, nx, ny);
          if (!free(nx, ny) || v === id) continue;
          // a trade: (x, y) to v and a cell of v elsewhere beside id to id
          for (let j = 0; j < h; j++)
            for (let i = 0; i < w; i++)
              if (cells[j][i] === v && free(i, j) && !(i === nx && j === ny) && STEPS.some(([ex, ey]) => at(cells, i + ex, j + ey) === id)) // prettier-ignore
                moves.push([[x, y, v], [i, j, id]]);
        }
      }
    // walls slid by a cell: the row of one room's cells along a wall it shares with another given to that one
    const ids = [...state.keys()].sort();
    for (const p of ids)
      for (const q of ids) {
        if (p >= q) continue;
        for (const r of runsBetween(cells, p, q))
          for (const [to, side] of [[q, r.aSide], [p, -r.aSide]]) {
            const row = [];
            for (let k = r.start; k < r.start + r.len; k++) {
              const [x, y] = r.flat ? [k, side > 0 ? r.line : r.line - 1] : [side > 0 ? r.line : r.line - 1, k];
              if (!free(x, y)) break;
              row.push([x, y, to]);
            }
            if (row.length === r.len && r.len > 1) moves.push(row);
          }
      }
    return moves;
  };
  const descend = () => {
    let now = score();
    for (let round = 0; round < w * h; round++) {
      let best = null;
      for (const list of movesOf()) {
        const before = list.map(([x, y]) => cells[y][x]);
        if (!moveAll(list)) continue;
        const got = score();
        list.forEach(([x, y], i) => (cells[y][x] = before[i]));
        if (got < now - 1e-9 && (!best || got < best.got)) best = { list, got };
      }
      if (!best) break;
      for (const [x, y, to] of best.list) cells[y][x] = to;
      now = best.got;
    }
    return now;
  };
  let now = descend();
  const snapshot = () => cells.map((row) => row.slice());
  const restore = (s) => s.forEach((row, y) => row.forEach((v, x) => (cells[y][x] = v)));
  for (let k = 0; k < kicks; k++) {
    const kept = snapshot();
    let shaken = 0;
    for (let n = 0; n < 8 && shaken < 2; n++) {
      const moves = movesOf();
      if (moves.length && moveAll(moves[Math.floor(rng() * moves.length)])) shaken++;
    }
    const got = descend();
    if (got < now - 1e-9) now = got;
    else restore(kept);
  }
}

// ── 4. edges: walls, doors, the entrance, windows, rails ──

/** Every cell edge of a storey with what stands on it before doors and windows: exterior, interior, rail, or open. */
function wallsOf(cells, stair) {
  const h = cells.length;
  const w = cells[0].length;
  const open = new Set(stair?.open ?? []);
  const rails = new Set(stair?.rails ?? []);
  const edges = [];
  const add = (a, b, e) => {
    const ka = at(cells, ...a);
    const kb = at(cells, ...b);
    if (ka === kb) return;
    const key = edgeKey(e);
    if (open.has(key)) return;
    const kind = ka === null || kb === null ? "exterior" : rails.has(key) ? "rail" : "interior";
    edges.push({ from: e.from, to: e.to, kind, rooms: [ka, kb] });
  };
  for (let y = 0; y <= h; y++) for (let x = 0; x < w; x++) add([x, y - 1], [x, y], { from: [x, y], to: [x + 1, y] });
  for (let x = 0; x <= w; x++) for (let y = 0; y < h; y++) add([x - 1, y], [x, y], { from: [x, y], to: [x, y + 1] });
  return edges;
}

/** The walls meeting at each vertex: "x,y" -> the edges (any kind) touching it. */
function vertexIndex(edges) {
  const out = new Map();
  for (const e of edges)
    for (const v of [e.from, e.to]) {
      const k = `${v[0]},${v[1]}`;
      (out.get(k) ?? out.set(k, []).get(k)).push(e);
    }
  return out;
}
const horizontal = (e) => e.from[1] === e.to[1];
/**
 * The cells a doorway's leaf sweeps as it opens: SWING_DEPTH rows of its swing room in front of both its edges, as
 * "x,y" keys. Two doorways that sweep a cell in common stand in each other's way (learnt from house-02 at seed 16:
 * a kitchen's two doors at one corner, the hall's leaf open across the living room's doorway).
 */
export function sweptBy(cells, way) {
  const out = [];
  for (const edge of way.edges) {
    const across = cellsAcross(edge);
    const s = at(cells, ...across[1]) === way.swing ? 1 : at(cells, ...across[0]) === way.swing ? -1 : 0;
    if (!s) continue;
    const [cx, cy] = s > 0 ? across[1] : across[0];
    const [dx, dy] = horizontal(edge) ? [0, s] : [s, 0];
    for (let k = 0; k < SWING_DEPTH; k++) out.push(`${cx + dx * k},${cy + dy * k}`);
  }
  return out;
}
/**
 * The cells of a doorway's swing room its leaf, open, cuts off. The leaf stands across the first row in front of the
 * doorway at its hinge, the middle of its cell on the left of one walking into the swing room (every door piece's
 * `open.hinge`, README "Units and the grid"), and reaches 74 into the room, past the first row (64): a player in the
 * opening gets past it along the wall only round its tip, through the second row. So the move along the first row out
 * past the doorway's left end is closed, and every cell of
 * the room is to be reached from the cells the leaf sweeps without them (learnt in smak_byz01, 2026-11-03: an
 * entrance at a hall's end, the hall going on beside it one row deep, its rooms behind the leaf). Returns the keys.
 */
export function leafCut(cells, way) {
  let into = null;
  const list = [...way.edges].sort((a, b) => (horizontal(a) ? Math.min(a.from[0], a.to[0]) - Math.min(b.from[0], b.to[0]) : Math.min(a.from[1], a.to[1]) - Math.min(b.from[1], b.to[1]))); // prettier-ignore
  const first = [];
  for (const edge of list) {
    const across = cellsAcross(edge);
    const s = at(cells, ...across[1]) === way.swing ? 1 : at(cells, ...across[0]) === way.swing ? -1 : 0;
    if (!s) return [];
    first.push(s > 0 ? across[1] : across[0]);
    into = horizontal(edge) ? [0, s] : [s, 0];
  }
  if (first.length !== 2) return [];
  // the left of one walking in: the way in turned a quarter anticlockwise
  const left = [-into[1], into[0]];
  const hinge = first[0][0] * left[0] + first[0][1] * left[1] > first[1][0] * left[0] + first[1][1] * left[1] ? first[0] : first[1]; // prettier-ignore
  const closed = new Set([`${hinge.join(",")}|${hinge[0] + left[0]},${hinge[1] + left[1]}`]);
  const shut = (a, b) => closed.has(`${a}|${b}`) || closed.has(`${b}|${a}`);
  const seen = new Set(sweptBy(cells, way).filter((k) => at(cells, ...k.split(",").map(Number)) === way.swing));
  const queue = [...seen];
  while (queue.length) {
    const k = queue.shift();
    const [x, y] = k.split(",").map(Number);
    for (const [dx, dy] of STEPS) {
      const n = `${x + dx},${y + dy}`;
      if (seen.has(n) || at(cells, x + dx, y + dy) !== way.swing || shut(k, n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  const cut = [];
  cells.forEach((row, y) => row.forEach((v, x) => v === way.swing && !seen.has(`${x},${y}`) && cut.push(`${x},${y}`)));
  return cut;
}
/**
 * The straight runs of `edges` (each run end to end on one line), in order along the line. Used for the shared wall
 * of two rooms, and for a room's outside walls.
 */
function runsOf(edges) {
  const lines = new Map();
  for (const e of edges) {
    const k = horizontal(e) ? `h${e.from[1]}` : `v${e.from[0]}`;
    (lines.get(k) ?? lines.set(k, []).get(k)).push(e);
  }
  const runs = [];
  for (const k of [...lines.keys()].sort()) {
    const line = lines.get(k).sort((a, b) => (horizontal(a) ? a.from[0] - b.from[0] : a.from[1] - b.from[1]));
    let run = [line[0]];
    for (let i = 1; i <= line.length; i++) {
      const e = line[i];
      const prev = line[i - 1];
      if (e && (horizontal(e) ? e.from[0] === prev.to[0] : e.from[1] === prev.to[1])) run.push(e);
      else {
        runs.push(run);
        if (e) run = [e];
      }
    }
  }
  return runs;
}
/** True when nothing but the wall's own line meets the vertex `v` (no corner, no wall joining it). */
const clearAt = (index, v, e) =>
  (index.get(`${v[0]},${v[1]}`) ?? []).every((o) => o === e || horizontal(o) === horizontal(e));

/**
 * Doors, the entrances and windows of one storey put on its walls. Returns { doors, entrances, notes } where notes
 * are { failures, warnings, cost } of what could not be placed well.
 */
function openingsOf(edges, cells, storey, d, isGround, frontWindow = []) {
  const notes = { failures: [], warnings: [], cost: 0 };
  const index = vertexIndex(edges);
  const byKey = new Map(edges.map((e) => [edgeKey(e), e]));
  const [w, h] = d.footprint.cells;
  const isCorner = ([x, y]) => (x === 0 || x === w) && (y === 0 || y === h);
  const vk = (v) => `${v[0]},${v[1]}`;
  const kindOf = new Map(d.rooms.map((r) => [r.id, r.kind]));
  const doors = [];
  const swept = new Set();
  // a door: two edges of the wall the two rooms share, a room deep enough in front of it to swing into, as far from
  // the wall's corners as it lets it stand
  for (const [a, b] of d.doors) {
    if (d.rooms.find((r) => r.id === a).storey !== storey) continue;
    const all = doorwaysBetween(cells, a, b);
    if (!all.length) {
      notes.failures.push(shortWallSentence(a, b, sharedRun(cells, a, b), storey));
      notes.cost += 1000;
      continue;
    }
    // the room it swings into: not a hall when the other has the depth, else whichever has it
    const options = all
      .map((o) => ({ ...o, swing: o.deep.find((r) => !passage(kindOf.get(r))) ?? o.deep[0] }))
      .filter((o) => o.swing);
    if (!options.length) {
      notes.failures.push(shallowSentence(a, b, storey));
      notes.cost += 1000;
      continue;
    }
    for (const o of options) (o.clash = sweptBy(cells, o).filter((k) => swept.has(k)).length), (o.cut = leafCut(cells, o).length); // prettier-ignore
    options.sort((p, q) => p.clash - q.clash || p.cut - q.cut || p.corners - q.corners || q.len - p.len || p.off - q.off || passage(kindOf.get(p.swing)) - passage(kindOf.get(q.swing)) || p.i - q.i); // prettier-ignore
    const o = options[0];
    for (const k of sweptBy(cells, o)) swept.add(k);
    if (o.corners === 2) {
      notes.warnings.push(`door ${a}-${b}: ${a} and ${b} share a straight wall of ${o.len} edges where a door can stand; it fills it from corner to corner (a door clear of corners wants 4)`); // prettier-ignore
      notes.cost += 100;
    } else notes.cost += o.corners * 15;
    for (const e of o.edges) byKey.get(edgeKey(e)).kind = "door";
    doors.push({ rooms: [a, b], storey, edges: o.edges, at: o.at, swing: o.swing });
  }
  // the entrance: two edges of the entrance room's outside wall, the room deep enough inside it for the leaf, away
  // from the building's corners and the walls that meet its outside wall
  // (a building may have several: a shop's own street door and its stair hall's, each one property's)
  const entrances = [];
  const wall = (e) => (e.from[1] === e.to[1] ? (e.from[1] === 0 ? "south" : e.from[1] === h ? "north" : null) : e.from[0] === 0 ? "west" : e.from[0] === w ? "east" : null); // prettier-ignore
  // the building's blind walls (description `blind`): walls a neighbour stands against, with no entrance and no window;
  // `blindBelow` blind on the ground storey only (a window up there is out of reach from the street)
  const blind = new Set([...(d.blind ?? []), ...(isGround ? (d.blindBelow ?? []) : [])]);
  for (const room of isGround ? d.rooms.filter((r) => r.entrance) : []) {
    const all = doorwaysBetween(cells, room.id, null).filter((o) => !blind.has(wall(o.edges[0])));
    // on the front wall when the description names one (style.mjs, the rule "front")
    const options = all.filter((o) => o.deep.includes(room.id)).map((o) => ({ ...o, outer: o.ends.filter(isCorner).length, back: d.front && wall(o.edges[0]) !== d.front ? 1 : 0, clash: sweptBy(cells, { ...o, swing: room.id }).filter((k) => swept.has(k)).length, cut: leafCut(cells, { ...o, swing: room.id }).length })); // prettier-ignore
    if (!options.length) {
      const longest = sharedRun(cells, room.id, null);
      notes.failures.push(all.length
        ? `room ${room.id}, the entrance: no stretch of its outside wall has ${SWING_DEPTH} rows of ${room.id} inside it; the entrance's leaf, open, stands 74 into the room (a room 1 cell deep holds 56)` // prettier-ignore
        : `room ${room.id}, the entrance: ${longest ? `its longest straight outside wall is ${longest} ${longest === 1 ? "edge" : "edges"}` : "it has no outside wall"}; an entrance wants ${DOOR_EDGES} with no wall meeting its middle (64 clear needs 128 of wall)`); // prettier-ignore
      notes.cost += 1000;
    } else {
      options.sort((p, q) => p.back - q.back || p.clash - q.clash || p.cut - q.cut || p.outer - q.outer || p.corners - q.corners || q.len - p.len || p.off - q.off || p.i - q.i); // prettier-ignore
      const o = options[0];
      if (o.outer) {
        notes.warnings.push(`room ${room.id}, the entrance: its outside wall of ${o.len} edges ends at the building's corner; the entrance stands at it (one clear of corners wants 4)`); // prettier-ignore
        notes.cost += 100;
      } else if (o.corners === 2) {
        notes.warnings.push(`room ${room.id}, the entrance: its outside wall is ${o.len} edges long; the entrance fills it from corner to corner (one clear of corners wants 4)`); // prettier-ignore
        notes.cost += 100;
      } else notes.cost += o.corners * 15;
      for (const e of o.edges) byKey.get(edgeKey(e)).kind = "entrance";
      const entrance = { room: room.id, storey, edges: o.edges, at: o.at, swing: room.id };
      for (const k of sweptBy(cells, entrance)) swept.add(k);
      entrances.push(entrance);
    }
  }
  // windows: along each room's outside walls, every other edge, never the first or last of a run, never touching
  // a doorway's middle vertex or any vertex of an entrance
  const near = new Set();
  const avoid = [...doors.map((o) => o.at), ...entrances.flatMap((en) => [en.at, ...en.edges.flatMap((e) => [e.from, e.to])])]; // prettier-ignore
  for (const v of avoid) for (const o of index.get(vk(v)) ?? []) near.add(o);
  // (none in a room of a kind the description says has none, `noWindows`: a cell, an armory)
  const windowless = new Set(d.noWindows ?? []);
  for (const r of d.rooms.filter((r) => r.storey === storey && !windowless.has(r.kind))) {
    const outside = edges.filter((e) => e.kind === "exterior" && e.rooms.includes(r.id) && !blind.has(wall(e)));
    for (const run of runsOf(outside))
      for (let i = 1; i < run.length - 1; i += d.windowStep ?? 2) {
        const e = run[i];
        if (near.has(e) || !clearAt(index, e.from, e) || !clearAt(index, e.to, e)) continue;
        e.kind = "window";
      }
  }
  // an entrance's room of a kind the style wants a front window in (its rule frontWindow: a shop) with no window on the
  // wall its entrance stands on (the runs above break at the entrance, and a short run beside it holds none) takes one there, as near the entrance as a wall lets it: a shop's window beside
  // its door. Any edge of that wall serves whose ends no other wall meets and that touches no doorway's middle.
  const middles = new Set([...doors, ...entrances].map((o) => vk(o.at)));
  for (const en of entrances) {
    if (!frontWindow.includes(d.rooms.find((r) => r.id === en.room)?.kind)) continue;
    const side = wall(en.edges[0]);
    const mine = (e) => e.rooms.includes(en.room) && wall(e) === side;
    if (edges.some((e) => e.kind === "window" && mine(e))) continue;
    const mid = (e) => [(e.from[0] + e.to[0]) / 2, (e.from[1] + e.to[1]) / 2];
    const away = (e) => Math.abs(mid(e)[0] - en.at[0]) + Math.abs(mid(e)[1] - en.at[1]);
    const options = edges
      .filter((e) => e.kind === "exterior" && mine(e) && !middles.has(vk(e.from)) && !middles.has(vk(e.to)) && clearAt(index, e.from, e) && clearAt(index, e.to, e)) // prettier-ignore
      .sort((p, q) => away(p) - away(q) || p.from[0] - q.from[0] || p.from[1] - q.from[1]);
    if (options.length) options[0].kind = "window";
  }
  return { doors, entrances, notes };
}

// ── the layout ──

/** One try: a stairwell, every storey grown, the edges and openings. */
function attempt(d, rng, polish = null, frontWindow = []) {
  const [w, h] = d.footprint.cells;
  const roomsOn = (s) => d.rooms.filter((r) => r.storey === s);
  let well = null;
  if (d.storeys > 1 && d.stairFrom) {
    const c = chooseStairwell(w, h, rng, d.stairOffFront ? d.front : null);
    const from = d.rooms.find((r) => r.id === d.stairFrom).storey;
    // lane 0 holds the first flight (its foot on storey `from`), lane 1 the second (its top on storey `to`)
    const [dx, dy] = DIRS[c.foot];
    const inward = ([x, y]) => [x - dx, y - dy];
    well = {
      ...c,
      from,
      to: from + 1,
      bottom: c.row[0],
      top: c.row[1],
      open: [c.row[1], inward(c.row[1])],
      rail: [c.row[0], inward(c.row[0])],
    };
  }
  const plans = [];
  const grownRooms = new Map();
  for (let s = 0; s < d.storeys; s++) {
    const cells = Array.from({ length: h }, () => new Array(w).fill(undefined));
    const stair = { open: [], rails: [] };
    if (well) {
      const row = new Set(well.row.map(([x, y]) => `${x},${y}`));
      for (const [x, y] of well.cells) cells[y][x] = s === well.to && !row.has(`${x},${y}`) ? "void" : "stair";
      // the foot opens onto the rooms the stair joins, with no wall
      if (s === well.from || s === well.to) for (let i = 0; i < 2; i++) stair.open.push(edgeKey(edgeBetween(well.row[i], well.outside[i]))); // prettier-ignore
      if (s === well.to) {
        stair.open.push(edgeKey(edgeBetween(...well.open)));
        stair.rails.push(edgeKey(edgeBetween(...well.rail)));
      }
    }
    const rooms = roomsOn(s).map((r) => ({
      ...r,
      fixed: well && ((s === well.from && r.id === d.stairFrom) || (s === well.to && r.id === d.stairTo)) ? well.outside : null, // prettier-ignore
    }));
    const doors = d.doors.filter(([a]) => rooms.some((r) => r.id === a));
    const entranceRooms = rooms.filter((r) => r.entrance).map((r) => r.id);
    const state = growStorey(cells, rooms, doors, rng, polish && { entrances: entranceRooms, kicks: polish.kicks, rng: prng(polish.stream + s), style: polish.style, front: d.front ?? null }); // prettier-ignore
    for (const [id, st] of state) grownRooms.set(id, st);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (cells[y][x] === undefined) cells[y][x] = null;
    plans.push({ storey: s, cells, edges: wallsOf(cells, stair) });
  }
  const doors = [];
  const entrances = [];
  const notes = { failures: [], warnings: [], cost: 0 };
  for (const p of plans) {
    const o = openingsOf(p.edges, p.cells, p.storey, d, p.storey === 0, frontWindow);
    doors.push(...o.doors);
    entrances.push(...o.entrances);
    notes.failures.push(...o.notes.failures);
    notes.warnings.push(...o.notes.warnings);
    notes.cost += o.notes.cost;
  }
  // the order the contract reads: horizontal edges by y then x, then vertical ones by x then y
  for (const p of plans)
    p.edges.sort((a, b) => horizontal(b) - horizontal(a) || (horizontal(a) ? a.from[1] - b.from[1] || a.from[0] - b.from[0] : a.from[0] - b.from[0] || a.from[1] - b.from[1])); // prettier-ignore

  const layout = {
    format: LAYOUT_FORMAT,
    building: d.name,
    seed: d.seed,
    grid: GRID,
    storeyHeight: STOREY_HEIGHT,
    base: d.base,
    size: [w, h],
    storeys: d.storeys,
    stairwell: well && {
      cells: well.cells,
      from: well.from,
      to: well.to,
      foot: well.foot,
      bottom: well.bottom,
      top: well.top,
      rooms: [d.stairFrom, d.stairTo],
    },
    storeyPlans: plans,
    rooms: d.rooms.map((r) => ({ id: r.id, storey: r.storey, kind: r.kind, cells: grownRooms.get(r.id)?.cells.length ?? 0, area: r.area })), // prettier-ignore
    doors,
    entrance: entrances[0] ?? null,
    entrances,
    failures: [],
    warnings: [],
  };
  return { layout, notes };
}

/** What a cell one wide across its room costs, each way: more than a door standing at its wall's corners. */
const SLIVER = 120;
/** How far one storey's rooms are from plausible: slivers, ragged rooms, long thin ones. Lower is better. */
function shapeCost(cells) {
  let cost = 0;
  {
    const boxes = new Map();
    for (let y = 0; y < cells.length; y++)
      for (let x = 0; x < cells[0].length; x++) {
        const v = cells[y][x];
        if (!isRoom(v)) continue;
        const same = (dx, dy) => at(cells, x + dx, y + dy) === v;
        if (!same(1, 0) && !same(-1, 0)) cost += SLIVER; // one cell wide across
        if (!same(0, 1) && !same(0, -1)) cost += SLIVER;
        const b = boxes.get(v) ?? boxes.set(v, [x, y, x, y, 0]).get(v);
        b[0] = Math.min(b[0], x), b[1] = Math.min(b[1], y), b[2] = Math.max(b[2], x), b[3] = Math.max(b[3], y), b[4]++; // prettier-ignore
      }
    for (const [x0, y0, x1, y1, n] of boxes.values()) {
      const [a, b] = [x1 - x0 + 1, y1 - y0 + 1];
      cost += (a * b - n) * 1.5; // the box's cells it does not fill: an L or worse
      cost += Math.max(0, Math.max(a, b) / Math.min(a, b) - 2) * 4; // long and thin
    }
  }
  return cost;
}
/** What a doorway's corners cost it: none clear of both, a little at one, a warning's worth at both. */
const cornerCost = (n) => [0, 15, 100][n];
/**
 * What the best doorway between a and b (null: the outside, the entrance) costs: none to stand on at all, none with
 * a room deep enough to swing into, else its corners (and, for the entrance, the building's corners).
 */
function doorwayCost(cells, a, b) {
  const all = doorwaysBetween(cells, a, b);
  if (!all.length) return 1000;
  const fit = all.filter((o) => (b === null ? o.deep.includes(a) : o.deep.length));
  if (!fit.length) return 600;
  const [w, h] = [cells[0].length, cells.length];
  const outer = (o) => (b === null ? o.ends.filter(([x, y]) => (x === 0 || x === w) && (y === 0 || y === h)).length * 100 : 0); // prettier-ignore
  return Math.min(...fit.map((o) => cornerCost(o.corners) + outer(o)));
}

/** How far a layout is from a plausible plan: slivers, ragged rooms, rooms off their share. Lower is better. */
function costOf(layout, d) {
  let cost = 0;
  for (const p of layout.storeyPlans) cost += shapeCost(p.cells);
  for (const r of layout.rooms) {
    const want = d.rooms.find((q) => q.id === r.id).area;
    if (r.cells < want[0]) cost += (want[0] - r.cells) * 50;
    if (r.cells > want[1]) cost += (r.cells - want[1]) * 50;
  }
  return cost;
}

/**
 * Lays a building description out. `seed` overrides the description's. Returns the layout (smak-layout/1) with
 * `failures` and `warnings`; a description that does not check is returned with its failures and no plans.
 */
export function layoutOf(description, { seed = null, tries = TRIES } = {}) {
  const checked = checkBuilding(description);
  const d = checked.building;
  if (d && seed !== null) d.seed = seed;
  if (checked.failures.length) {
    return {
      format: LAYOUT_FORMAT,
      building: d?.name ?? null,
      seed: d?.seed ?? null,
      grid: GRID,
      storeyHeight: STOREY_HEIGHT,
      base: d?.base ?? [0, 0, 0],
      size: d?.footprint?.cells ?? null,
      storeys: d?.storeys ?? null,
      stairwell: null,
      storeyPlans: [],
      rooms: [],
      doors: [],
      entrance: null,
      entrances: [],
      failures: checked.failures,
      warnings: checked.warnings,
    };
  }
  let best = null;
  const judged = [];
  const style = styleOf(d);
  const judge = (t, polish) => {
    const { layout, notes } = attempt(d, prng(streamOf(d.seed, t)), polish, style?.rules.frontWindow?.kinds ?? []);
    const check = checkLayout(layout, d);
    const kept = style ? checkStyle(layout, d, style) : { failures: [], warnings: [], cost: 0 };
    const failures = [...new Set([...notes.failures, ...check.failures, ...kept.failures])];
    const warnings = [...notes.warnings, ...check.warnings, ...kept.warnings];
    const score = failures.length * 10000 + notes.cost + costOf(layout, d) + kept.cost;
    if (!best || score < best.score) best = { t, layout, failures, warnings, score };
    return score;
  };
  for (let t = 0; t < tries; t++) judged.push({ t, score: judge(t, false) });
  // the most promising tries made again with the polish
  for (const { t } of judged.sort((p, q) => p.score - q.score || p.t - q.t).slice(0, POLISHED)) judge(t, { kicks: 0, style }); // prettier-ignore
  // the best of them, when it still has a warning, shaken out of where the polish left it
  for (const t of best.warnings.length ? judged.slice(0, SHAKEN).map((j) => j.t) : []) judge(t, { kicks: KICKS, stream: streamOf(d.seed ^ 0x2545f491, t), style }); // prettier-ignore
  best.layout.failures = best.failures;
  best.layout.warnings = [...checked.warnings, ...best.warnings];
  return best.layout;
}

/**
 * Checks a layout, alone or against its description (for the areas and the doors it names): every room's cells in
 * one piece; each door on 2 collinear edges of kind door between its two rooms, no other wall meeting their middle
 * vertex (`at`), the room it swings into 2 cells deep in front of both edges; every door the description names
 * there (else the wall its rooms share, measured, in the sentence); the stairwell's foot open onto stairFrom and its
 * top onto stairTo; one entrance for each entrance room, kept as a door is; every room reached from an entrance through the doors and the
 * stair. Returns { failures, warnings }.
 */
export function checkLayout(layout, description = null) {
  const failures = [];
  const warnings = [];
  const plans = layout.storeyPlans ?? [];
  const keyed = plans.map((p) => new Map(p.edges.map((e) => [edgeKey(e), e])));
  const cellOf = (s, [x, y]) => at(plans[s].cells, x, y);

  // rooms: their cells, in one piece, of the area they want
  for (const r of layout.rooms) {
    const p = plans[r.storey];
    if (!p) continue;
    const mine = [];
    p.cells.forEach((row, y) => row.forEach((v, x) => v === r.id && mine.push([x, y])));
    if (!mine.length) {
      failures.push(`room ${r.id} (storey ${r.storey}) has no cells; the footprint left it none`);
      continue;
    }
    const seen = new Set([`${mine[0][0]},${mine[0][1]}`]);
    const queue = [mine[0]];
    while (queue.length) {
      const [x, y] = queue.shift();
      for (const [dx, dy] of STEPS) {
        const k = `${x + dx},${y + dy}`;
        if (!seen.has(k) && at(p.cells, x + dx, y + dy) === r.id) seen.add(k), queue.push([x + dx, y + dy]);
      }
    }
    if (seen.size !== mine.length) failures.push(`room ${r.id} (storey ${r.storey}): its ${mine.length} cells fall apart (${seen.size} joined to the first); a room is one piece`); // prettier-ignore
    const want = description?.rooms.find((q) => q.id === r.id)?.area ?? r.area;
    if (want && (mine.length < want[0] || mine.length > want[1])) failures.push(`room ${r.id}: wants ${want[0]}-${want[1]} cells, the layout gave it ${mine.length}`); // prettier-ignore
  }

  // doors: two collinear edges of kind door meeting at `at`, its two rooms on their sides, no other wall at `at`
  /** Checks one doorway (a door or the entrance); true when it stands. */
  const doorway = (name, storey, list, mid, kind, want, swing) => {
    const p = plans[storey];
    if (!p) return failures.push(`${name}: it is on storey ${storey}, which the layout has no plan of`), false;
    if (!Array.isArray(list) || list.length !== DOOR_EDGES || !list.every((e) => Array.isArray(e?.from) && Array.isArray(e?.to))) // prettier-ignore
      return failures.push(`${name}: it has ${Array.isArray(list) ? list.length : 0} edges; a doorway spans ${DOOR_EDGES} collinear edges (128) of its wall`), false; // prettier-ignore
    let ok = true;
    for (const edge of list) {
      const e = keyed[storey].get(edgeKey(edge));
      const sides = cellsAcross(edge).map((c) => cellOf(storey, c));
      const where = `${edge.from.join(",")} to ${edge.to.join(",")}`;
      if (!e || e.kind !== kind) failures.push(`${name}: the edge ${where} on storey ${storey} is ${e ? `a wall of kind ${e.kind}` : "no wall"}; it wants kind ${kind}`), (ok = false); // prettier-ignore
      else if (!want.every((r) => sides.includes(r))) failures.push(`${name}: the edge ${where} on storey ${storey} has ${sides.map(String).join(" and ")} on its sides; it wants ${want.map(String).join(" and ")}`), (ok = false); // prettier-ignore
    }
    const [e, f] = list;
    const same = (u, v) => Array.isArray(u) && Array.isArray(v) && u[0] === v[0] && u[1] === v[1];
    const ends = (x) => [x.from, x.to];
    const meet = Array.isArray(mid) && ends(e).some((v) => same(v, mid)) && ends(f).some((v) => same(v, mid));
    if (!meet || horizontal(e) !== horizontal(f) || edgeKey(e) === edgeKey(f)) {
      failures.push(`${name}: its edges ${ends(e).map((v) => v.join(",")).join(" to ")} and ${ends(f).map((v) => v.join(",")).join(" to ")} are not 2 collinear edges meeting at its middle (${Array.isArray(mid) ? mid.join(" ") : "none given"})`); // prettier-ignore
      return false;
    }
    const others = p.edges.filter((o) => [o.from, o.to].some((v) => same(v, mid)) && edgeKey(o) !== edgeKey(e) && edgeKey(o) !== edgeKey(f)); // prettier-ignore
    if (others.length) failures.push(`${name}: another wall meets its middle vertex (${mid.join(" ")}): ${others.map((o) => `${o.kind} ${o.from.join(",")} to ${o.to.join(",")}`).join(", ")}; a doorway's middle has no corner post`), (ok = false); // prettier-ignore
    // the room its leaf swings into: one of its sides, SWING_DEPTH rows of it in front of both edges
    if (!want.filter(Boolean).includes(swing)) {
      failures.push(`${name}: it swings into ${swing === undefined ? "no room named" : swing}; it wants one of ${want.filter(Boolean).join(" and ")} (swing)`); // prettier-ignore
      return false;
    }
    let depth = 0;
    for (let k = 1; k <= SWING_DEPTH; k++) {
      const row = list.map((edge) => {
        const across = cellsAcross(edge); // [lesser side, greater side]
        const s = cellOf(storey, across[1]) === swing ? 1 : cellOf(storey, across[0]) === swing ? -1 : 0;
        if (!s) return null;
        const [cx, cy] = s > 0 ? across[1] : across[0];
        const [dx, dy] = horizontal(edge) ? [0, s] : [s, 0];
        return cellOf(storey, [cx + dx * (k - 1), cy + dy * (k - 1)]);
      });
      if (row.every((v) => v === swing)) depth = k;
      else break;
    }
    if (depth < SWING_DEPTH) failures.push(`${name}: it swings into ${swing}, which is ${depth} ${depth === 1 ? "cell" : "cells"} deep in front of it; its leaf, open, stands 74 into the room (it wants ${SWING_DEPTH} rows of ${swing} in front of both its edges)`), (ok = false); // prettier-ignore
    return ok;
  };
  const doorLinks = [];
  for (const door of layout.doors) {
    const [a, b] = door.rooms;
    if (doorway(`door ${a}-${b}`, door.storey, door.edges, door.at, "door", [a, b], door.swing)) doorLinks.push([a, b]);
  }
  const listed = (door, s, e) => door.storey === s && (door.edges ?? []).some((x) => edgeKey(x) === edgeKey(e));
  for (const p of plans)
    for (const e of p.edges.filter((e) => e.kind === "door"))
      if (!layout.doors.some((door) => listed(door, p.storey, e)))
        warnings.push(`storey ${p.storey}: the door edge ${e.from.join(",")} to ${e.to.join(",")} is in no door of the list`); // prettier-ignore
  for (const [a, b] of description?.doors ?? []) {
    if (layout.doors.some((door) => door.rooms.includes(a) && door.rooms.includes(b))) continue;
    const s = description.rooms.find((r) => r.id === a)?.storey;
    if (plans[s]) failures.push(shortWallSentence(a, b, sharedRun(plans[s].cells, a, b), s));
    else failures.push(`door ${a}-${b}: the layout has no door between ${a} and ${b}; the description wants 1`);
  }

  // leaves: no two doorways of a storey sweep a cell in common as they open
  const ways = [...layout.doors.map((door) => ({ ...door, name: `door ${door.rooms.join("-")}` })), ...entrancesOf(layout).map((en) => ({ ...en, storey: en.storey ?? 0, name: `the entrance of ${en.room}` }))]; // prettier-ignore
  for (let i = 0; i < ways.length; i++)
    for (let j = i + 1; j < ways.length; j++) {
      const [p, q] = [ways[i], ways[j]];
      if (p.storey !== q.storey || !plans[p.storey] || p.swing !== q.swing || !Array.isArray(p.edges) || !Array.isArray(q.edges)) continue; // prettier-ignore
      const mine = new Set(sweptBy(plans[p.storey].cells, p));
      const both = sweptBy(plans[q.storey].cells, q).filter((k) => mine.has(k));
      if (both.length) failures.push(`${p.name} and ${q.name} (storey ${p.storey}) both swing into ${p.swing} over the cells ${[...new Set(both)].map((k) => k.replace(",", " ")).join(", ")}; one leaf, open, stands in the other's way (each wants its ${SWING_DEPTH} rows to itself)`); // prettier-ignore
    }
  // leaves: none, open, cuts off part of the room it swings into (leafCut)
  for (const w of ways) {
    if (!plans[w.storey] || !Array.isArray(w.edges) || w.edges.length !== DOOR_EDGES) continue;
    const cut = leafCut(plans[w.storey].cells, w);
    if (cut.length) failures.push(`${w.name} (storey ${w.storey}): its leaf, open, stands across the first row of ${w.swing} beside it and cuts off ${cut.length} ${cut.length === 1 ? "cell" : "cells"} of it (${cut.slice(0, 6).map((k) => k.replace(",", " ")).join(", ")}${cut.length > 6 ? " ..." : ""}); the first row beside a doorway is passed only round the leaf's tip, through the second`); // prettier-ignore
  }

  // the stair: its foot open onto stairFrom, its top landing onto stairTo
  const well = layout.stairwell;
  let stairJoins = null;
  if (well) {
    const [dx, dy] = DIRS[well.foot] ?? [0, 0];
    const row = [well.bottom, well.top];
    const beyond = row.map(([x, y]) => [x + dx, y + dy]);
    let ok = true;
    for (const [s, room, what] of [[well.from, well.rooms[0], "foot"], [well.to, well.rooms[1], "top"]]) { // prettier-ignore
      if (!plans[s]) continue;
      const got = beyond.map((c) => cellOf(s, c));
      const walls = row.map((c, i) => keyed[s].get(edgeKey(edgeBetween(c, beyond[i])))).filter(Boolean);
      if (got.some((v) => v !== room)) {
        failures.push(`stair: its ${what} on storey ${s} opens onto ${got.map(String).join(" and ")}; it wants ${room} on both of its 2 cells`); // prettier-ignore
        ok = false;
      } else if (walls.length) {
        failures.push(`stair: its ${what} on storey ${s} has ${walls.length} ${walls.length === 1 ? "wall" : "walls"} (${walls.map((e) => e.kind).join(", ")}) between it and ${room}; it wants 0`); // prettier-ignore
        ok = false;
      }
    }
    if (ok) stairJoins = well.rooms;
  }

  // the entrances: one for each entrance room (one at least), on the ground storey
  const listedEntrances = entrancesOf(layout);
  const wanted = Math.max(1, description ? description.rooms.filter((r) => r.entrance).length : listedEntrances.length);
  const entranceEdges = plans.flatMap((p) => p.edges.filter((e) => e.kind === "entrance"));
  if (plans.length && entranceEdges.length !== wanted * DOOR_EDGES) failures.push(`the layout has ${entranceEdges.length} entrance edges; it wants ${wanted === 1 ? "1 entrance" : `${wanted} entrances`} of ${DOOR_EDGES}`); // prettier-ignore
  if (plans.length)
    for (const en of listedEntrances)
      doorway(`the entrance of ${en.room}`, en.storey ?? 0, en.edges, en.at, "entrance", [en.room, null], en.swing);
  // the blind walls (a neighbour against them): no window and no entrance on them
  const blind = new Set(description?.blind ?? []);
  if (blind.size && layout.size) {
    const [w, h] = layout.size;
    const wallOf = (e) => (e.from[1] === e.to[1] ? (e.from[1] === 0 ? "south" : e.from[1] === h ? "north" : null) : e.from[0] === 0 ? "west" : e.from[0] === w ? "east" : null); // prettier-ignore
    for (const p of plans)
      for (const e of p.edges)
        if ((e.kind === "window" || e.kind === "entrance") && blind.has(wallOf(e)))
          failures.push(`storey ${p.storey}: the ${e.kind} ${e.from.join(",")} to ${e.to.join(",")} stands on the ${wallOf(e)} wall, which is blind (a neighbour stands against it); a blind wall has no window and no entrance`); // prettier-ignore
  }
  const starts = listedEntrances.length ? listedEntrances.map((en) => en.room) : (description?.rooms.filter((r) => r.entrance).map((r) => r.id) ?? []); // prettier-ignore
  const start = starts.join(" or ");

  // reach: from the entrance rooms through the doors that stand and the stair
  if (starts.length && plans.length) {
    const links = new Map(layout.rooms.map((r) => [r.id, new Set()]));
    for (const [a, b] of doorLinks) links.get(a)?.add(b), links.get(b)?.add(a);
    if (stairJoins) links.get(stairJoins[0])?.add(stairJoins[1]), links.get(stairJoins[1])?.add(stairJoins[0]);
    const seen = new Set(starts);
    const queue = [...starts];
    while (queue.length) for (const n of links.get(queue.shift()) ?? []) if (!seen.has(n)) seen.add(n), queue.push(n);
    for (const r of layout.rooms)
      if (!seen.has(r.id)) failures.push(`room ${r.id} (storey ${r.storey}) is not reached from the entrance ${start} through the doors and the stair`); // prettier-ignore
  }
  return { failures, warnings };
}

/** A layout's entrances: `entrances`, or the one `entrance` of a layout written before there could be several. */
export const entrancesOf = (layout) => layout.entrances ?? (layout.entrance ? [layout.entrance] : []);

/** The layout as JSON, a list of numbers or names on one line (a cell row, a vertex), the rest indented. */
export function layoutJson(layout) {
  const flat = (v) => Array.isArray(v) && v.every((x) => x === null || typeof x !== "object");
  const write = (v, pad) => {
    if (flat(v)) return JSON.stringify(v);
    if (Array.isArray(v)) {
      if (!v.length) return "[]";
      if (v.every((x) => flat(x) && x.length <= 3)) return `[${v.map((x) => JSON.stringify(x)).join(", ")}]`;
      return `[\n${v.map((x) => pad + "  " + write(x, pad + "  ")).join(",\n")}\n${pad}]`;
    }
    if (v && typeof v === "object") {
      const keys = Object.keys(v);
      if (!keys.length) return "{}";
      const inner = keys.map((k) => `${JSON.stringify(k)}: ${write(v[k], pad + "  ")}`);
      const line = `{ ${inner.join(", ")} }`;
      if (line.length <= 100 && !line.includes("\n")) return line;
      return `{\n${inner.map((s) => pad + "  " + s).join(",\n")}\n${pad}}`;
    }
    return JSON.stringify(v);
  };
  return write(layout, "") + "\n";
}
