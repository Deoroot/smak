// The walking graph of a site (levels/rp/CONTRACT.md, `paths`): where a citizen, or a bot, can walk, built from the PLAN
// (the streets' cells, the walls and their gates, each building's rooms, doors, entrances and stair, the level below's
// cells, ways down and doors) and, where a compiled map is given, held against it.
//
//   pathsOf(plan, built, { places, roam })  -> { paths, roamKept }   `paths`: { nodes, links, ways, measures }
//   pruneByMap(paths, bsp)                  -> { paths, dropped: [sentence] }  what the map's hull 1 does not let a player stand or walk on, taken out
//   checkPaths(paths, { places, roam })     -> { failures, warnings, measures }  the graph's rules
//   rcwOf(paths, { mapName, gates })        -> { waypoints, bytes, dropped, facts }  RCBot's file from the same graph
//
// A NODE: { id, at: [x, y, z] (a standing player's origin: the floor + 36), kind, district, part, ... }. Kinds: street
// (open ground), sewer (a walkway below), room (a point in a room: a hub or a corner), place (a room's middle where a job
// works: `place` is its id), door (a doorway's threshold, `door` its targetname, `gate` what it is), stair (a flight's
// foot or turn), ladder (a ladder's foot), hatch (a ladder's top, on the ledge by the lid). A street spot a roaming
// citizen walks to has `roam`: its index in the contract's `roam`.
// A LINK: { a, b, how: walk | stair | ladder | jump-down, oneWay?, gate?, via?, way? } both ways unless `oneWay`. `gate`
// says what stands in the way: "door" (a named leaf, a property's), "gate" (a checkpoint in a wall), "lid" (a
// manhole's, slid by use), "grate" (a drain's, broken), "secret" (a hidden door), "trapdoor" (a den's lid in its floor).
// `way` names the way down a link belongs to.
//
// UNITS. Every point is in the map's units, a player's origin: the city is about 3 000 x 3 500 units, so every number is
// within +-4096, the most a plugin's message carries.
import { PUBLIC, sweptCells } from "../assembly/site.mjs";
import { readBsp, floorUnder } from "../../src/maps/bsp.mjs";
import { writeRcw, RCW_FLAGS, RCBOT_MOST_WAYPOINTS } from "../../src/maps/rcbot.mjs";

export const GRID = 64;
export const STOREY = 192;
/** A standing player's origin over his feet. */
export const EYE = 36;
const PLAYER = 16;
/** Where each side's vector points (north is +y). */
const SIDES = { north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0] };
const key = (x, y) => `${x},${y}`;
const unkey = (k) => k.split(",").map(Number);
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], (p[2] ?? 0) - (q[2] ?? 0));
const centre = (x, y) => [(x + 0.5) * GRID, (y + 0.5) * GRID];
/** An edge between two cells side by side, as below.mjs keys it. */
const edgeBetween = ([ax, ay], [bx, by]) => (ax === bx ? `h ${ax} ${Math.max(ay, by)}` : `v ${Math.max(ax, bx)} ${ay}`);

// ── the compiled map, when there is one: where a standing player's hull rests ──
let MAP = null;
/** The origin height a standing player rests at under (x, y), looked for from `z` + 24 down, or null. */
const restAt = (x, y, z, reach = 60) => floorUnder(MAP, [x, y, z + 24], { hull: 1, reach });
/** Whether a player can stand with his origin at p (the floor the plan says, within `tol`). Without a map, always. */
const standable = (p, tol = 12) => {
  if (!MAP) return true;
  const f = restAt(p[0], p[1], p[2]);
  return f !== null && Math.abs(f - p[2]) <= tol;
};
/** Whether the straight walk from p to q (their z's the plan's) has the floor within `tol` of the line every 8 units. */
const walkable = (p, q, tol = 14) => {
  if (!MAP || p.length < 3 || q.length < 3) return true;
  const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) / 8));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const at = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
    const f = restAt(at[0], at[1], at[2]);
    if (f === null || Math.abs(f - at[2]) > tol) return false;
  }
  return true;
};

// ── a grid of cells: which are open, which edges are joined ──
/** Whether a player stands in cell (a) and moves to cell (b), side by side or on a diagonal, with every cell between open and joined. */
function adj(g, ax, ay, bx, by) {
  if (!g.open(ax, ay) || !g.open(bx, by)) return false;
  const [dx, dy] = [bx - ax, by - ay];
  if (dx === 0 && dy === 0) return true;
  if (Math.abs(dx) + Math.abs(dy) === 1) return g.joined(ax, ay, bx, by);
  if (Math.abs(dx) === 1 && Math.abs(dy) === 1)
    return g.open(bx, ay) && g.open(ax, by) && g.joined(ax, ay, bx, ay) && g.joined(bx, ay, bx, by) && g.joined(ax, ay, ax, by) && g.joined(ax, by, bx, by); // prettier-ignore
  return false;
}

/** Whether a body of 32 across walks the straight line p to q over open, joined cells (the line and a rail 16 to each side). */
function clear(g, p, q, { step = 16, rail = PLAYER } = {}) {
  if (!walkable(p, q)) return false;
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const n = Math.max(1, Math.ceil(len / step));
  const [px, py] = len ? [-(q[1] - p[1]) / len, (q[0] - p[0]) / len] : [0, 1];
  let before = null;
  for (let i = 0; i <= n; i++) {
    const x = p[0] + ((q[0] - p[0]) * i) / n;
    const y = p[1] + ((q[1] - p[1]) * i) / n;
    const c = [Math.floor(x / GRID), Math.floor(y / GRID)];
    if (!g.open(...c)) return false;
    if (before && !adj(g, ...before, ...c)) return false;
    before = c;
    for (const o of [-rail, rail]) {
      const r = [Math.floor((x + px * o) / GRID), Math.floor((y + py * o) / GRID)];
      if (!adj(g, ...c, ...r)) return false;
    }
  }
  return true;
}

/** The cells from one to another over a grid (eight ways), the shortest, or null. */
function route(g, from, to, z, limit = 4000) {
  const goal = key(...to);
  const seen = new Map([[key(...from), null]]);
  let front = [from];
  for (let step = 0; front.length && step < limit; step++) {
    const next = [];
    for (const c of front) {
      if (key(...c) === goal) {
        const out = [];
        for (let k = goal; k; k = seen.get(k)) out.push(unkey(k));
        return out.reverse();
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const n = [c[0] + dx, c[1] + dy];
        if (seen.has(key(...n)) || !adj(g, ...c, ...n)) continue;
        if (MAP && z !== undefined && key(...n) !== goal && !standable([...centre(...n), z])) continue; // a prop's cell
        seen.set(key(...n), key(...c));
        next.push(n);
      }
    }
    front = next;
  }
  return null;
}

/** A route's corners: the points of a cell route pulled straight, from `p` to `q`. */
function corners(g, cells, p, q) {
  const z = p[2];
  const pts = [p, ...cells.slice(1, -1).map((c) => (z === undefined ? centre(...c) : [...centre(...c), z])), q];
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !clear(g, pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

// ── the graph under construction ──
const RANK = { place: 5, door: 4, ladder: 4, hatch: 4, stair: 3, room: 2, street: 1, sewer: 1 };

class Graph {
  constructor() {
    this.nodes = [];
    this.byId = new Map();
    this.at = new Map(); // "x,y,z" quantised -> id
    this.links = [];
    this.linked = new Map();
    this.n = 0;
  }
  /** A node, or the one already within 6 units of the same height (which takes the better kind and the extra fields). */
  node({ id, at, kind, ...rest }) {
    const q = `${Math.round(at[0] / 6)},${Math.round(at[1] / 6)},${Math.round(at[2] / 6)}`;
    const same = this.at.get(q);
    if (same) {
      const old = this.byId.get(same);
      if ((RANK[kind] ?? 0) > (RANK[old.kind] ?? 0)) old.kind = kind;
      for (const [k, v] of Object.entries(rest)) if (old[k] === undefined || old[k] === null) old[k] = v;
      return old.id;
    }
    id ??= `${kind}_${this.n}`;
    if (this.byId.has(id)) id = `${id}_${this.n}`;
    this.n++;
    const node = { id, at: at.map((v) => Math.round(v * 100) / 100), kind, ...rest };
    this.nodes.push(node);
    this.byId.set(id, node);
    this.at.set(q, id);
    return id;
  }
  link(a, b, how = "walk", extra = {}) {
    if (a === b) return;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (this.linked.has(k)) return;
    const l = { a, b, how, ...extra };
    this.linked.set(k, l);
    this.links.push(l);
  }
  /** The nodes of a set of ids in components by the links among them. */
  components(ids) {
    const set = new Set(ids);
    const near = new Map(ids.map((i) => [i, []]));
    for (const l of this.links) if (set.has(l.a) && set.has(l.b)) (near.get(l.a).push(l.b), near.get(l.b).push(l.a));
    const seen = new Set();
    const out = [];
    for (const i of ids) {
      if (seen.has(i)) continue;
      const comp = [i];
      seen.add(i);
      for (let k = 0; k < comp.length; k++) for (const n of near.get(comp[k])) if (!seen.has(n)) (seen.add(n), comp.push(n));
      out.push(comp);
    }
    return out;
  }
}

/**
 * A cell route's own centres from `p` to `q`, for where a straight pull catches on something: each step to the next
 * cell is taken straight if the map lets a player walk it, else by the centre of either cell (a diagonal one also round
 * either corner of its two); null when a step cannot be taken.
 */
function centresOf(cells, p, q) {
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 6;
  const out = [p];
  let at = p;
  const go = (to) => {
    if (near(at, to)) return true;
    if (!walkable(at, to)) return false;
    out.push(to);
    at = to;
    return true;
  };
  for (let i = 1; i < cells.length; i++) {
    const to = i === cells.length - 1 ? q : [...centre(...cells[i]), p[2]];
    if (go(to)) continue;
    const [a, b] = [cells[i - 1], cells[i]];
    const ways = [[...centre(...a), p[2]], [...centre(...b), p[2]]];
    if (a[0] !== b[0] && a[1] !== b[1]) ways.push([...centre(a[0], b[1]), p[2]], [...centre(b[0], a[1]), p[2]]);
    const round = ways.find((m) => walkable(at, m) && walkable(m, to));
    if (!round || !go(round) || !go(to)) return null;
  }
  return out;
}

/**
 * Links the nodes of one grid that see each other within `max` units, thinned to the relative neighbourhood (a link
 * goes where no third node is nearer to both), then joins the pieces left apart by routes round corners.
 * `where(id)` is a node's point on this grid (a doorway's threshold, a hair inside the room).
 */
function weave(G, ids, g, { max = 400, where = (id) => G.byId.get(id).at, extra = {}, corner = "room", meta = {} } = {}) {
  const P = new Map(ids.map((i) => [i, where(i)]));
  const seen = new Map();
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const d = Math.hypot(P.get(ids[i])[0] - P.get(ids[j])[0], P.get(ids[i])[1] - P.get(ids[j])[1]);
      if (d <= max && Math.abs(G.byId.get(ids[i]).at[2] - G.byId.get(ids[j]).at[2]) < 20 && clear(g, P.get(ids[i]), P.get(ids[j]))) seen.set(`${i},${j}`, d);
    }
  const see = (i, j) => seen.get(i < j ? `${i},${j}` : `${j},${i}`);
  for (const [k, d] of seen) {
    const [i, j] = k.split(",").map(Number);
    let blocked = false;
    for (let c = 0; c < ids.length && !blocked; c++) {
      if (c === i || c === j) continue;
      const a = see(i, c);
      const b = see(j, c);
      if (a !== undefined && b !== undefined && Math.max(a, b) < d) blocked = true;
    }
    if (!blocked) G.link(ids[i], ids[j], "walk", extra);
  }
  // pieces apart: the nearest pair of two that a route joins, round the corners; a piece no route joins is set aside
  const stuck = new Set();
  for (let round = 0; round < 4 * ids.length; round++) {
    const comps = G.components(ids);
    const base = comps.find((c) => !stuck.has(c[0]));
    if (comps.length < 2 || !base) break;
    const pairs = [];
    for (const a of base) for (const c of comps) if (c !== base) for (const b of c) pairs.push({ a, b, d: Math.hypot(P.get(a)[0] - P.get(b)[0], P.get(a)[1] - P.get(b)[1]) }); // prettier-ignore
    pairs.sort((x, y) => x.d - y.d);
    let best = null;
    let cs = null;
    for (const pair of pairs.slice(0, 400)) {
      const [pa, pb] = [P.get(pair.a), P.get(pair.b)];
      const cells = route(g, [Math.floor(pa[0] / GRID), Math.floor(pa[1] / GRID)], [Math.floor(pb[0] / GRID), Math.floor(pb[1] / GRID)], pa[2]);
      if (!cells) continue;
      // the corners pulled straight, or, where the map has the hull catch on a doorframe or a prop's clip along one, the
      // cells' own centres (a diagonal step round the corner it cuts); a route the map does not let a player walk joins nothing
      const found = [corners(g, cells, pa, pb), centresOf(cells, pa, pb)].find((c) => c && c.every((p, i) => i === 0 || walkable(c[i - 1], p)));
      if (found) {
        best = pair;
        cs = found;
        break;
      }
    }
    if (!best) {
      stuck.add(base[0]);
      continue;
    }
    let prev = best.a;
    for (let k = 1; k < cs.length - 1; k++) {
      const z = G.byId.get(best.a).at[2];
      const here = G.node({ at: [cs[k][0], cs[k][1], z], kind: corner, ...meta });
      if (!P.has(here)) (ids.push(here), P.set(here, [cs[k][0], cs[k][1], z]));
      G.link(prev, here, "walk", extra);
      prev = here;
    }
    G.link(prev, best.b, "walk", extra);
  }
}

// ── the street level ──
/** The street grid: public floor but the landmark's, joined across every edge but a wall's (its gates are nodes of their own). */
function streetGrid(plan) {
  const { cells, site } = plan;
  const wall = new Set();
  for (const w of site.walls ?? []) {
    const [x0, y0] = w.from;
    const [x1, y1] = w.to;
    const horizontal = y0 === y1;
    const from = Math.min(horizontal ? x0 : y0, horizontal ? x1 : y1);
    const to = Math.max(horizontal ? x0 : y0, horizontal ? x1 : y1);
    for (let t = from; t < to; t++) wall.add(horizontal ? `h ${t} ${y0}` : `v ${x0} ${t}`);
  }
  return {
    open: (x, y) => PUBLIC.has(cells[y]?.[x]) && cells[y][x] !== "landmark",
    joined: (ax, ay, bx, by) => !wall.has(edgeBetween([ax, ay], [bx, by])),
    wall,
  };
}

/**
 * The nodes of a stair-u piece (the stair piece of the library, 2 cells across and 4 long, measured on a compiled
 * map): the foot, where the first flight starts (0.4 of a cell inside the foot's edge), where it ends (2.6) and
 * the landing to the far wall (3.5, the walls a player's width off it), over to the second flight and back to where it
 * ends (1.1), then the top's foot. `at(cell, u, z)`: a point `u` cells in from the foot's edge in the cell's column, `z` the
 * floor's height.
 */
function uStair(at, bottom, top, foot0, foot1, z0, z1) {
  const half = (z1 - z0) / 2;
  return [
    at(foot0, 0.5, z0),
    at(bottom, 0.4, z0),
    at(bottom, 2.6, z0 + half),
    at(bottom, 3.5, z0 + half),
    at(top, 3.5, z0 + half),
    at(top, 1.1, z1),
    at(foot1, 0.5, z1),
  ];
}

const ROAM_EVERY = 4;
const areaOf = (site, x, y) => site.areas.find((a) => x >= a.from[0] && x < a.to[0] && y >= a.from[1] && y < a.to[1])?.name ?? null;

/**
 * The graph of a site. `places` and `roam` are the contract's (the same objects): a place becomes a node `place_<id>`,
 * a street or sewer roam spot a node with `roam: <index>`. Returns `{ paths, roamKept }`: `roamKept[i]` false for a
 * roam spot on no node (in a prop's cell, or cut off from the rest: behind the outfall's bars).
 */
export function pathsOf(plan, built, { places = [], roam = [], map = null } = {}) {
  MAP = map;
  try {
    return pathsMade(plan, built, places, roam);
  } finally {
    MAP = null;
  }
}

function pathsMade(plan, built, places, roam) {
  const { site } = plan;
  const G = new Graph();
  const warnings = [];
  const flat = (x, y, floor, kind, rest = {}) => G.node({ at: [x, y, floor + EYE], kind, ...rest });
  const doorways = built.report.doorways ?? [];
  const nameOf = (b, storey, at) => doorways.find((d) => d.building === b && d.storey === storey && d.at[0] === at[0] && d.at[1] === at[1])?.targetname ?? null; // prettier-ignore

  // ─ streets: the roaming spots, then the rest
  const sg = streetGrid(plan);
  const swept = sweptCells(plan);
  const streetIds = [];
  const districtOf = (x, y) => plan.districts[Math.floor(y / GRID)]?.[Math.floor(x / GRID)] ?? null;
  const partOf = (x, y) => areaOf(site, Math.floor(x / GRID), Math.floor(y / GRID));
  const street = (x, y, extra = {}) => {
    const id = flat(x, y, 0, "street", { district: districtOf(x, y), part: partOf(x, y), ...extra });
    if (!streetIds.includes(id)) streetIds.push(id);
    return id;
  };
  plan.cells.forEach((row, y) =>
    row.forEach((v, x) => {
      if (x % ROAM_EVERY !== 2 || y % ROAM_EVERY !== 2 || !sg.open(x, y) || swept.has(key(x, y))) return;
      if (!standable([(x + 0.5) * GRID, (y + 0.5) * GRID, EYE])) return; // a prop, or a step, on the spot
      street((x + 0.5) * GRID, (y + 0.5) * GRID);
    }),
  );
  // the checkpoints in the walls: a threshold and a spot on either side
  const gateOf = new Map();
  for (const w of site.walls ?? []) {
    const horizontal = w.from[1] === w.to[1];
    for (const g of w.gates ?? []) {
      const at = [g[0] * GRID, g[1] * GRID];
      const sides = horizontal ? [[at[0], at[1] - 32], [at[0], at[1] + 32]] : [[at[0] - 32, at[1]], [at[0] + 32, at[1]]];
      const name = (built.report.doorways ?? []).find((d) => !d.building && d.at[0] === g[0] && d.at[1] === g[1])?.targetname ?? null; // prettier-ignore
      const T = flat(at[0], at[1], 0, "door", { district: districtOf(...sides[0]), part: w.name, door: name, gate: "gate" });
      const ends = sides.map((s) => street(s[0], s[1]));
      ends.forEach((e) => G.link(T, e, "walk", { gate: "gate", via: name }));
      gateOf.set(`${g[0]},${g[1]}`, T);
    }
  }
  // the buildings' entrances: a threshold, and a spot a step outside it
  const trapTop = new Map();

  // ─ buildings: rooms, doors, stair
  const roomNodes = new Map(); // "b|storey|room" -> [node ids]
  const addToRoom = (k, id) => (roomNodes.has(k) ? roomNodes.get(k).push(id) : roomNodes.set(k, [id]));
  const placeOf = new Map(places.map((p) => [`${p.building}|${p.id}`, p]));
  for (const b of site.buildings) {
    const l = plan.layouts.get(b.id);
    if (!l?.rooms) continue;
    const floorOf = (s) => s * STOREY;
    const cellsOf = (s) => l.storeyPlans[s]?.cells ?? [];
    const valueAt = (s, x, y) => cellsOf(s)[y]?.[x] ?? null;
    const world = (x, y) => [(b.at[0] + x) * GRID, (b.at[1] + y) * GRID];
    const districtB = b.district ?? null;
    const roomGrid = (s, room) => ({ open: (x, y) => valueAt(s, x, y) === room, joined: () => true });
    // the middle cell of a room, as the contract's places take it
    const middle = (room) => {
      const cs = [];
      cellsOf(room.storey).forEach((row, y) => row.forEach((v, x) => v === room.id && cs.push([x, y])));
      return cs.length ? cs[Math.floor(cs.length / 2)] : null;
    };
    const roomOf = new Map(l.rooms.map((r) => [r.id, r]));
    // a hub for every room: the place when it is one, at the room's middle or, when a prop stands there, the nearest
    // spot of the room where a player can
    for (const room of l.rooms) {
      const m = middle(room);
      if (!m) continue;
      const own = [];
      cellsOf(room.storey).forEach((row, y) => row.forEach((v, x) => v === room.id && own.push([x, y])));
      own.sort((p, q) => Math.hypot(p[0] - m[0], p[1] - m[1]) - Math.hypot(q[0] - m[0], q[1] - m[1]));
      const z = floorOf(room.storey) + EYE;
      let spot = null;
      for (const c of MAP ? own : own.slice(0, 1))
        for (const [dx, dy] of [[0, 0], [-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
          const [wx, wy] = world(c[0] + 0.5 + dx, c[1] + 0.5 + dy);
          if (!spot && standable([wx, wy, z])) spot = [wx, wy];
        }
      if (!spot) {
        warnings.push(`building ${b.id}: no spot in the room ${room.id} where a player can stand`);
        spot = world(m[0] + 0.5, m[1] + 0.5);
      }
      const place = placeOf.get(`${b.id}|${b.id}_${room.id}`);
      const id = flat(spot[0], spot[1], floorOf(room.storey), place ? "place" : "room", { district: districtB, part: `${b.id}.${room.id}`, ...(place ? { place: place.id } : {}) }); // prettier-ignore
      if (place && G.byId.get(id).place !== place.id) G.byId.get(id).place = place.id;
      addToRoom(`${b.id}|${room.storey}|${room.id}`, id);
    }
    // doors between rooms and entrances to the street
    const sidesOf = (d) => {
      const e = d.edges[0];
      const horizontal = e.from[1] === e.to[1];
      const x = Math.min(e.from[0], e.to[0]);
      const y = Math.min(e.from[1], e.to[1]);
      return horizontal ? [{ cell: [x, y - 1], n: [0, -1] }, { cell: [x, y], n: [0, 1] }] : [{ cell: [x - 1, y], n: [-1, 0] }, { cell: [x, y], n: [1, 0] }]; // prettier-ignore
    };
    const threshold = (d) => world(d.at[0], d.at[1]);
    for (const d of l.doors ?? []) {
      const s = d.storey ?? 0;
      const sides = sidesOf(d).map((q) => ({ ...q, room: valueAt(s, ...q.cell) }));
      if (sides.some((q) => !roomOf.has(q.room))) {
        warnings.push(`building ${b.id}: the door at ${d.at} (storey ${s}) is not between two rooms`);
        continue;
      }
      const targetname = nameOf(b.id, s, d.at);
      const T = flat(...threshold(d), floorOf(s), "door", { district: districtB, part: `${b.id}.${sides[0].room}-${sides[1].room}`, door: targetname, gate: "door" }); // prettier-ignore
      // a spot 40 units in front of the leaf on each side, in line with the opening (a doorway is 64 clear)
      for (const q of sides) {
        const t = threshold(d);
        const k = [40, 28, 52, 64].find((k) => standable([t[0] + q.n[0] * k, t[1] + q.n[1] * k, floorOf(s) + EYE]));
        if (k === undefined) {
          addToRoom(`${b.id}|${s}|${q.room}`, T);
          continue;
        }
        const A = flat(t[0] + q.n[0] * k, t[1] + q.n[1] * k, floorOf(s), "door", { district: districtB, part: `${b.id}.${q.room}`, approach: true });
        G.link(T, A, "walk", { gate: "door", via: targetname });
        addToRoom(`${b.id}|${s}|${q.room}`, A);
      }
    }
    for (const d of l.entrances ?? []) {
      const s = d.storey ?? 0;
      if (s !== 0) {
        warnings.push(`building ${b.id}: an entrance on storey ${s} is not on the street`);
        continue;
      }
      const sides = sidesOf(d);
      const inside = sides.find((q) => roomOf.has(valueAt(s, ...q.cell)));
      const out = sides.find((q) => q !== inside);
      if (!inside) continue;
      const targetname = nameOf(b.id, s, d.at);
      const t = threshold(d);
      const T = flat(t[0], t[1], 0, "door", { district: districtB, part: `${b.id}.${valueAt(s, ...inside.cell)}`, door: targetname, gate: "door" }); // prettier-ignore
      const k = [40, 28, 52, 64].find((k) => standable([t[0] + inside.n[0] * k, t[1] + inside.n[1] * k, EYE]));
      if (k === undefined) addToRoom(`${b.id}|${s}|${valueAt(s, ...inside.cell)}`, T);
      else {
        const A = flat(t[0] + inside.n[0] * k, t[1] + inside.n[1] * k, 0, "door", { district: districtB, part: `${b.id}.${valueAt(s, ...inside.cell)}`, approach: true });
        G.link(T, A, "walk", { gate: "door", via: targetname });
        addToRoom(`${b.id}|${s}|${valueAt(s, ...inside.cell)}`, A);
      }
      const o = [32, 40, 56, 72, 96].map((k) => [t[0] + out.n[0] * k, t[1] + out.n[1] * k]).find((q) => sg.open(Math.floor(q[0] / GRID), Math.floor(q[1] / GRID)) && standable([q[0], q[1], EYE])) ?? [t[0] + out.n[0] * 40, t[1] + out.n[1] * 40]; // prettier-ignore
      if (!sg.open(Math.floor(o[0] / GRID), Math.floor(o[1] / GRID))) {
        warnings.push(`building ${b.id}: the entrance at ${d.at} opens onto ${plan.cells[Math.floor(o[1] / GRID)]?.[Math.floor(o[0] / GRID)]}, not public floor`);
        continue;
      }
      const O = street(o[0], o[1], { front: targetname });
      G.link(T, O, "walk", { gate: "door", via: targetname });
    }
    // the stair: its flights between the foot cells of two storeys
    const well = l.stairwell;
    const stair = [];
    if (well) {
      const f = SIDES[well.foot];
      const cellAt = (c, k = 0) => [c[0] - f[0] * k, c[1] - f[1] * k];
      const z0 = floorOf(well.from);
      const z1 = floorOf(well.to);
      const foot0 = cellAt(well.bottom, -1);
      const foot1 = cellAt(well.top, -1);
      const mk = (p, kind = "stair") => G.node({ at: p, kind, district: districtB, part: `${b.id}.stair` });
      const at = (c, u, z) => {
        const [x, y] = world(c[0] + 0.5 - f[0] * (u - 0.5), c[1] + 0.5 - f[1] * (u - 0.5));
        return [x, y, z + EYE];
      };
      const nodes = uStair(at, well.bottom, well.top, foot0, foot1, z0, z1).map((q) => mk(q));
      for (let i = 0; i + 1 < nodes.length; i++) G.link(nodes[i], nodes[i + 1], i === 1 || i === 4 ? "stair" : "walk");
      const r0 = valueAt(well.from, ...foot0);
      const r1 = valueAt(well.to, ...foot1);
      if (roomOf.has(r0)) addToRoom(`${b.id}|${well.from}|${r0}`, nodes[0]);
      else warnings.push(`building ${b.id}: the stair's foot at ${foot0} is on ${r0}, not a room`);
      if (roomOf.has(r1)) addToRoom(`${b.id}|${well.to}|${r1}`, nodes[6]);
      else warnings.push(`building ${b.id}: the stair's top at ${foot1} is on ${r1}, not a room`);
      stair.push(...nodes);
    }
    // a den's trapdoor: the hatch in its floor, on the cell by the shaft's wall
    for (const way of plan.below?.ways ?? []) {
      if (way.kind !== "trapdoor" || way.building !== b.id) continue;
      const [lx, ly] = way.local;
      const s = SIDES[way.wall];
      const room = valueAt(0, lx, ly);
      let c = [lx + s[0], ly + s[1]];
      if (valueAt(0, ...c) !== room) c = [lx, ly];
      const [x, y] = world(c[0] + 0.5, c[1] + 0.5);
      const top = flat(x, y, 0, "hatch", { district: districtB, part: `${b.id}.${room}`, way: way.name });
      trapTop.set(way.name, top);
      addToRoom(`${b.id}|0|${room}`, top);
    }
    // weave each room's nodes together
    for (const [k, ids] of roomNodes) {
      const [bid, s, room] = k.split("|");
      if (bid !== b.id) continue;
      const unique = [...new Set(ids)];
      const g = roomGrid(Number(s), room);
      const local = { open: (x, y) => g.open(x - b.at[0], y - b.at[1]), joined: () => true };
      weave(G, unique, local, { max: 1200, meta: { district: districtB, part: `${b.id}.${room}` } });
    }
  }

  // ─ the level below
  const below = plan.below;
  const wayNodes = [];
  if (below) {
    const F = below.floor;
    const bars = new Set();
    for (const bar of below.bars ?? []) {
      const horizontal = bar.from[1] === bar.to[1];
      const [t0, t1] = horizontal ? [Math.min(bar.from[0], bar.to[0]), Math.max(bar.from[0], bar.to[0])] : [Math.min(bar.from[1], bar.to[1]), Math.max(bar.from[1], bar.to[1])]; // prettier-ignore
      for (let t = t0; t < t1; t++) bars.add(horizontal ? `h ${t} ${bar.from[1]}` : `v ${bar.from[0]} ${t}`);
    }
    const doorEdges = new Set(below.doors.flatMap((d) => d.edges));
    const props = new Set((below.props ?? []).map((p) => key(...p.at)));
    const bg = {
      open: (x, y) => below.cells.get(key(x, y))?.kind === "walk" && !props.has(key(x, y)),
      joined: (ax, ay, bx, by) => {
        const e = edgeBetween([ax, ay], [bx, by]);
        return below.joins.has(e) && !bars.has(e) && !doorEdges.has(e);
      },
    };
    const sewerIds = [];
    const sew = (x, y, z, kind = "sewer", extra = {}) => {
      const cell = below.cells.get(key(Math.floor(x / GRID), Math.floor(y / GRID)));
      const id = G.node({ at: [x, y, z + EYE], kind, district: "below", part: cell?.part ?? null, ...extra });
      if (!sewerIds.includes(id)) sewerIds.push(id);
      return id;
    };
    for (const part of below.parts) {
      if (!part.place) continue;
      const p = places.find((q) => q.id === `below_${part.id}`);
      if (p) sew(p.at[0], p.at[1], F, "place", { place: p.id });
    }
    // the stair: the lower flights from the sewer to half way, the upper from half way to the street
    for (const w of below.ways.filter((q) => q.kind === "stair")) {
      const upper = [w.at[0], w.at[1]];
      const lower = [w.at[0] + 2, w.at[1]];
      const f = [0, -1]; // turn 0: the foot to the south
      const at = (c, u, z) => {
        const [x, y] = centre(c[0] - f[0] * (u - 0.5), c[1] - f[1] * (u - 0.5));
        return [x, y, z + EYE];
      };
      const lowerTop = [lower[0] + 1, lower[1]];
      const upperTop = [upper[0] + 1, upper[1]];
      // the lower flights from the sewer's foot to half way, along the landing there to the upper's, up to the street
      const chain = [
        ...uStair(at, lower, lowerTop, w.foot, lowerTop, F, F + STOREY),
        ...uStair(at, upper, upperTop, upper, [upperTop[0], upperTop[1] - 1], F + STOREY, 0),
      ];
      const ids = chain.map((q, i) => (i === 0 ? sew(q[0], q[1], F, "stair") : i === chain.length - 1 ? street(q[0], q[1], { way: w.name }) : G.node({ at: q, kind: "stair", district: "below", part: w.name })));
      const hows = ["walk", "stair", "walk", "walk", "stair", "walk", "walk", "walk", "stair", "walk", "walk", "stair", "walk"];
      for (let i = 0; i + 1 < ids.length; i++) G.link(ids[i], ids[i + 1], hows[i], { way: w.name });
      wayNodes.push({ id: w.name, kind: "stair", top: ids.at(-1), foot: ids[0] });
    }
    // the ladders: a foot at the shaft's cell by its wall, a top on the ledge beyond it
    for (const w of below.ways.filter((q) => q.kind !== "stair")) {
      const s = SIDES[w.wall];
      const [cx, cy] = centre(...w.at);
      const foot = sew(cx, cy, F, "ladder", { way: w.name });
      let top;
      if (w.kind === "trapdoor") top = trapTop.get(w.name);
      else {
        const [tx, ty] = centre(w.at[0] + s[0], w.at[1] + s[1]);
        top = street(tx, ty, { way: w.name });
        G.byId.get(top).kind = "hatch";
      }
      const gate = { manhole: "lid", drain: "grate", trapdoor: "trapdoor" }[w.kind];
      G.link(foot, top, "ladder", { way: w.name, gate });
      wayNodes.push({ id: w.name, kind: w.kind, top, foot });
      if (w.kind !== "trapdoor") G.byId.get(top).kind = "hatch";
    }
    // the roaming spots below, the secret doors, then weave
    roam.forEach((r, i) => {
      if (r.district !== "below") return;
      const cx = Math.floor(r.at[0] / GRID);
      const cy = Math.floor(r.at[1] / GRID);
      if (!bg.open(cx, cy) || !standable([r.at[0], r.at[1], F + EYE])) return;
      sew(r.at[0], r.at[1], F, "sewer");
    });
    for (const d of below.doors) {
      const line = d.line;
      const [px, py] = d.at;
      const t = [px * GRID, py * GRID];
      const sides = line === "v" ? [[t[0] - 32, t[1]], [t[0] + 32, t[1]]] : [[t[0], t[1] - 32], [t[0], t[1] + 32]];
      const named = (built.report.below?.doors ?? []).find((q) => q.at[0] === d.at[0] && q.at[1] === d.at[1])?.targetname ?? null;
      const T = G.node({ at: [t[0], t[1], F + EYE], kind: "door", district: "below", part: d.name, door: named, gate: d.secret ? "secret" : "door" });
      const ends = sides.map((s) => sew(s[0], s[1], F, "sewer"));
      for (const e of ends) G.link(T, e, "walk", { gate: d.secret ? "secret" : "door", via: named });
    }
    weave(G, sewerIds.filter((i) => G.byId.get(i).kind !== "door"), bg, { max: 520, extra: {}, corner: "sewer", meta: { district: "below" } });
  }

  // streets last, with the entrances' outsides among them
  weave(G, streetIds, sg, { max: 400, corner: "street", meta: { district: null } });

  const paths = {
    units: "origin of a standing player (the floor + 36); the city is about 3000 x 3500, inside +-4096",
    nodes: G.nodes,
    links: G.links,
    ways: wayNodes,
    warnings,
  };
  const cut = cutOff(paths);
  if (cut) warnings.push(`${cut} spots of the plan are cut off from the rest (behind bars, or in a closed pocket): left out`);
  // the roaming spots on their nodes
  const roamKept = roam.map(() => false);
  roam.forEach((r, i) => {
    const q = (v) => Math.round(v / 6);
    const node = paths.nodes.find((n) => q(n.at[0]) === q(r.at[0]) && q(n.at[1]) === q(r.at[1]) && Math.abs(n.at[2] - (r.at[2] + EYE)) < 6 && (n.kind === "street" || n.kind === "sewer")); // prettier-ignore
    if (!node) return;
    node.roam = i;
    roamKept[i] = true;
  });
  for (const p of places) if (!paths.nodes.some((n) => n.place === p.id)) warnings.push(`the place ${p.id} has no node`);
  return { paths, roamKept };
}

// ── reading the graph ──
/** The components of the whole graph, each a list of node ids, the largest first; `use(link)` says which links count. */
export function componentsOf(paths, use = () => true) {
  const near = new Map(paths.nodes.map((n) => [n.id, []]));
  for (const l of paths.links) {
    if (!use(l) || !near.has(l.a) || !near.has(l.b)) continue;
    near.get(l.a).push(l.b);
    if (!l.oneWay) near.get(l.b).push(l.a);
    else near.get(l.b);
  }
  const seen = new Set();
  const out = [];
  for (const n of paths.nodes) {
    if (seen.has(n.id)) continue;
    const comp = [n.id];
    seen.add(n.id);
    for (let k = 0; k < comp.length; k++) for (const m of near.get(comp[k])) if (!seen.has(m)) (seen.add(m), comp.push(m));
    out.push(comp);
  }
  return out.sort((a, b) => b.length - a.length);
}

/** What `reach` from a node gets to over the links that `use` allows. */
function reached(paths, from, use = () => true) {
  const near = new Map(paths.nodes.map((n) => [n.id, []]));
  for (const l of paths.links) {
    if (!use(l)) continue;
    near.get(l.a)?.push(l.b);
    if (!l.oneWay) near.get(l.b)?.push(l.a);
  }
  const seen = new Set([from]);
  const list = [from];
  for (let k = 0; k < list.length; k++) for (const m of near.get(list[k]) ?? []) if (!seen.has(m)) (seen.add(m), list.push(m));
  return seen;
}

/**
 * The graph's rules. Failures: a place or a roaming spot on no node, or not reachable from every other; a way down
 * (the sewer's stair, ladders and trapdoor) that does not join the street to the level below by itself; a node out of
 * the plugin's +-4096; a link between nodes that are not there; a link too steep or too long for a walk. Warnings: the
 * plan's own notes while the graph was made.
 */
export function checkPaths(paths, { places = [], roam = [] } = {}) {
  const failures = [];
  const warnings = [...(paths.warnings ?? [])];
  const ids = new Set(paths.nodes.map((n) => n.id));
  const measures = { nodes: paths.nodes.length, links: paths.links.length, places: places.length, roam: roam.length, components: 0, ways: paths.ways.length }; // prettier-ignore
  for (const n of paths.nodes) if (n.at.some((v) => !Number.isFinite(v) || Math.abs(v) > 4096)) failures.push(`node ${n.id} at ${n.at} is outside +-4096, which a plugin's message carries`); // prettier-ignore
  for (const l of paths.links) {
    if (!ids.has(l.a) || !ids.has(l.b)) {
      failures.push(`a link ${l.a} to ${l.b}: a node is not there`);
      continue;
    }
    const [p, q] = [paths.nodes.find((n) => n.id === l.a), paths.nodes.find((n) => n.id === l.b)];
    const flat = Math.hypot(p.at[0] - q.at[0], p.at[1] - q.at[1]);
    const rise = Math.abs(p.at[2] - q.at[2]);
    if (l.how === "walk" && rise > 24 && !l.gate) failures.push(`the walk ${l.a} to ${l.b} climbs ${Math.round(rise)}; a walk is flat, a stair or a ladder climbs`); // prettier-ignore
    if (l.how === "stair" && flat > 0 && rise / flat > 1) failures.push(`the stair ${l.a} to ${l.b} climbs ${Math.round(rise)} in ${Math.round(flat)}: steeper than 45 degrees`); // prettier-ignore
  }
  const comps = componentsOf(paths);
  measures.components = comps.length;
  const main = new Set(comps[0] ?? []);
  const mark = (n) => `${n.id} (${n.kind}${n.part ? `, ${n.part}` : ""}) at ${n.at}`;
  for (const p of places) {
    const n = paths.nodes.find((q) => q.place === p.id);
    if (!n) failures.push(`the place ${p.id} is on no node`);
    else if (!main.has(n.id)) failures.push(`the place ${p.id} cannot be reached from the largest piece of the graph: ${mark(n)}`);
  }
  roam.forEach((r, i) => {
    const n = paths.nodes.find((q) => q.roam === i);
    if (!n) failures.push(`the roaming spot ${i} at ${r.at} is on no node`);
    else if (!main.has(n.id)) failures.push(`the roaming spot ${i} cannot be reached from the largest piece of the graph: ${mark(n)}`);
  });
  const sewer = paths.nodes.filter((n) => n.district === "below");
  const start = paths.nodes.find((n) => n.kind === "street" && n.roam !== undefined && n.district !== "below") ?? paths.nodes.find((n) => n.kind === "street");
  for (const w of paths.ways) {
    // each way by itself: a street reaches the foot over this way's links and every link that is no way's
    const seen = start ? reached(paths, start.id, (l) => !l.way || l.way === w.id) : new Set();
    if (!seen.has(w.top)) failures.push(`${w.id} (${w.kind}): its top ${w.top} is not reached from the streets`);
    else if (!seen.has(w.foot)) failures.push(`${w.id} (${w.kind}) does not join the streets to its foot ${w.foot} by itself`);
  }
  if (sewer.length) {
    const streets = paths.nodes.filter((n) => n.district !== "below" && n.kind === "street");
    const seen = streets.length ? reached(paths, streets[0].id) : new Set();
    const lost = sewer.filter((n) => !seen.has(n.id));
    if (lost.length) failures.push(`${lost.length} nodes of the level below are not reached from the streets: ${lost.slice(0, 3).map(mark).join("; ")}`); // prettier-ignore
  }
  measures.sewer = sewer.length;
  return { failures, warnings, measures };
}

/**
 * Takes out the pieces of the graph that no place and no way down is in, apart from the largest: a walkway behind the
 * outfall's bars, a pocket of open ground, the rooms behind a doorway that a prop blocks. Returns how many nodes went.
 */
export function cutOff(paths) {
  const byId = new Map(paths.nodes.map((n) => [n.id, n]));
  const off = new Set();
  for (const comp of componentsOf(paths).slice(1)) {
    if (comp.some((i) => byId.get(i).place || byId.get(i).way)) continue;
    comp.forEach((i) => off.add(i));
  }
  if (off.size) {
    paths.nodes = paths.nodes.filter((n) => !off.has(n.id));
    paths.links = paths.links.filter((l) => !off.has(l.a) && !off.has(l.b));
  }
  return off.size;
}

// ── the compiled map ──
const WALK_REACH = 70;
/**
 * Holds the graph against the compiled map: a node whose floor (where a standing player's hull rests) is not where the
 * node says, within 10 units (20 on a stair, a ladder's foot, a hatch), is taken out with its links; so is a link whose
 * line (every 8 units) has no floor within 14 of it (18 on a stair), or has the hull in solid. A ladder is not walked. Returns the graph without them, and a sentence for each (`dropped`).
 */
export function pruneByMap(paths, bsp) {
  const map = bsp?.models ? bsp : readBsp(bsp);
  const dropped = [];
  const bad = new Set();
  for (const n of paths.nodes) {
    const stairish = n.kind === "stair" || n.kind === "ladder" || n.kind === "hatch";
    const f = floorUnder(map, [n.at[0], n.at[1], n.at[2] + 24], { hull: 1, reach: 90 });
    const tol = stairish ? 20 : 12;
    if (f === null || Math.abs(f - n.at[2]) > tol) {
      bad.add(n.id);
      dropped.push(`node ${n.id} (${n.kind}, ${n.part ?? ""}) at ${n.at}: the floor is ${f === null ? "not there" : `at ${f}`}`);
    }
  }
  const byId = new Map(paths.nodes.map((n) => [n.id, n]));
  const links = [];
  for (const l of paths.links) {
    if (bad.has(l.a) || bad.has(l.b)) continue;
    if (l.how === "ladder") {
      links.push(l);
      continue;
    }
    const p = byId.get(l.a).at;
    const q = byId.get(l.b).at;
    const len = dist(p, q);
    const steps = Math.max(1, Math.ceil(len / 8));
    const tol = l.how === "stair" ? 18 : 14;
    let why = null;
    for (let i = 1; i < steps && !why; i++) {
      const t = i / steps;
      const at = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
      const f = floorUnder(map, [at[0], at[1], at[2] + 24], { hull: 1, reach: WALK_REACH });
      if (f === null || Math.abs(f - at[2]) > tol) why = `no floor within ${tol} of the line at ${at.map(Math.round)} (${f === null ? "none, or solid" : `at ${f}`})`;
    }
    if (why) dropped.push(`link ${l.a} to ${l.b} (${l.how}, ${byId.get(l.a).part ?? "street"} to ${byId.get(l.b).part ?? "street"}): ${why}`);
    else links.push(l);
  }
  const keep = paths.nodes.filter((n) => !bad.has(n.id));
  return { paths: { ...paths, nodes: keep, links }, dropped };
}

// ── RCBot's file ──
/**
 * RCBot's waypoints of the graph: the nodes of the largest piece that the links allowed by `gates` join (a gate
 * kind stands for the links through it: "gate" the checkpoints; "door", "lid", "grate", "secret", "trapdoor"; the
 * default is the checkpoints alone, since a leaf with a key and a lid slid by use are not for a bot). The file's first
 * 50 are the bots' goals, so they are the street and sewer spots spread over the map, the farthest from those taken
 * first; the rest follow in the graph's order. A ladder's foot and top have LADDER, a node `crouch` CROUCH (and its
 * origin 18 over the floor), the foot of a `jump-down` JUMP. Returns `{ waypoints, bytes, dropped, facts }`.
 */
export function rcwOf(paths, { mapName, gates = ["gate"] } = {}) {
  const allowed = (l) => !l.gate || gates.includes(l.gate);
  const comps = componentsOf(paths, allowed);
  // the piece with the most roaming spots, else the largest
  const roamIn = (c) => c.filter((id) => paths.nodes.find((n) => n.id === id).roam !== undefined).length;
  const piece = new Set([...comps].sort((a, b) => roamIn(b) - roamIn(a) || b.length - a.length)[0] ?? []);
  const nodes = paths.nodes.filter((n) => piece.has(n.id));
  // the goals first: spread by the farthest taken first
  const goals = nodes.filter((n) => n.roam !== undefined || n.kind === "place");
  const first = [];
  const pool = goals.length ? [...goals] : [...nodes];
  if (pool.length) first.push(pool.splice(0, 1)[0]);
  while (first.length < Math.min(50, goals.length) && pool.length) {
    let best = 0;
    let far = -1;
    pool.forEach((n, i) => {
      const d = Math.min(...first.map((f) => dist(f.at, n.at)));
      if (d > far) ((far = d), (best = i));
    });
    first.push(pool.splice(best, 1)[0]);
  }
  const ordered = [...first, ...nodes.filter((n) => !first.includes(n))];
  const index = new Map(ordered.map((n, i) => [n.id, i]));
  const wp = ordered.map((n) => ({ flags: 0, origin: [...n.at], paths: [], id: n.id }));
  const flag = (id, f) => (wp[index.get(id)].flags |= f);
  for (const n of ordered) {
    if (n.crouch) (flag(n.id, RCW_FLAGS.CROUCH), (wp[index.get(n.id)].origin[2] -= 18));
  }
  for (const l of paths.links) {
    if (!allowed(l) || !index.has(l.a) || !index.has(l.b)) continue;
    wp[index.get(l.a)].paths.push(index.get(l.b));
    if (l.how === "jump-down") flag(l.a, RCW_FLAGS.JUMP);
    if (!l.oneWay) wp[index.get(l.b)].paths.push(index.get(l.a));
    if (l.how === "ladder") (flag(l.a, RCW_FLAGS.LADDER), flag(l.b, RCW_FLAGS.LADDER));
  }
  const dropped = paths.nodes.filter((n) => !piece.has(n.id)).map((n) => n.id);
  const facts = { waypoints: wp.length, paths: wp.reduce((s, w) => s + w.paths.length, 0), ladders: wp.filter((w) => w.flags & RCW_FLAGS.LADDER).length, dropped: dropped.length, gates }; // prettier-ignore
  if (wp.length > RCBOT_MOST_WAYPOINTS) throw new Error(`${wp.length} waypoints: the bot has room for ${RCBOT_MOST_WAYPOINTS}`);
  return { waypoints: wp, bytes: mapName ? writeRcw(wp, { mapName }) : null, dropped, facts };
}
