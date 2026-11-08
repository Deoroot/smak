// The walking graph of the sewers on several levels (levels/assembly/below-levels.mjs, `below.levels` in a site), for the RP
// contract (levels/rp/CONTRACT.md, `paths`). paths.mjs asks this module for the nodes and links of the deep levels;
// contract.mjs asks it for the places and roaming spots (given in the spec, or picked) that land on a level's floor.
//
//   walkModel(deep)                 -> the floors a player can stand on: halls (less the basin of a pool, the columns, the slabs of
//                                      a shaft's ledges), tunnel segments (less a water channel; a stair's treads), a shaft's ledges
//   deepGraph(deep, { places, roam }) -> { nodes, links, ways, warnings, failures, measures }
//   deepSpots(deep, below)          -> { places, roam, failures } the spec's `below.places` / `below.roam` on the floor, and the roaming
//                                      spots picked in every hall and along every tunnel
//   checkDeepPaths(paths)           -> { failures, warnings, measures } the levels' links held against the graph made
//
// The rules the graph keeps (the reasons are in levels/assembly/README.md, "Sewers on several levels"):
//  - a node stands where a player's hull (16 each side) clears every wall, column and slab, on the level's floor (a stair's tread);
//  - a link is made only where the straight walk between two nodes keeps that clearance at every 8 units, at the height between
//    them: a corner is never cut through a wall, a column is walked round;
//  - water is never a route: a channel with ledges beside it is walked on a ledge (18 from the wall, 20 wide at the least), a
//    pool is walked round on its rim, a channel with no ledge is no route and is warned of;
//  - a stair is `stair` links (a climb over 24 is), a ladder between levels is a `ladder` link the NPCs do not take.
import { at, inside, columnsOf, ledgesOf, shaftCellOf, SHELL } from "../assembly/below-levels.mjs";

export const EYE = 36;
/** A player's hull half-width: a node and the walk between two keep it clear of a wall. */
export const HULL = 16;
/** The gap between the nodes along a tunnel and across a hall, units. */
export const SPACING = 112;
/** The longest link tried, units. */
export const REACH = 220;
/** The narrowest ledge beside a channel somebody walks on. */
export const LEDGE_MIN = 16;
const GRID = 64;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const r2 = (v) => Math.round(v * 100) / 100;
// a player's hull is a box 32 square, not a disc: its corner reaches 22.6 toward a wall slanted at 45 degrees
// (1.5 more than the hull's 16, for what the compiler's planes round)
const BOX = HULL + 1.5;
const RING = [];
for (let i = 0; i <= 18; i++) for (const [x, y] of [[-BOX + (i * BOX) / 9, -BOX], [-BOX + (i * BOX) / 9, BOX], [-BOX, -BOX + (i * BOX) / 9], [BOX, -BOX + (i * BOX) / 9]]) RING.push([x, y]);

/** Whether a point is in a convex polygon (counter-clockwise), a hair of slack. */
const within = (poly, p, slack = 0.05) => inside(poly, p, -slack);

// ── the model: what a player can stand on ────────────────────────────────────
export function walkModel(deep) {
  const surfaces = [];
  const levelAt = (z) => deep.levels.find((l) => Math.abs(l.floor - z) < 8)?.id ?? null;
  const box = (poly) => {
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  for (const h of deep.halls) {
    const level = h.shaft ? h.shaft.to : h.level;
    const ledges = ledgesOf(h);
    const blockers = [...columnsOf(h).map((c) => ({ circle: true, p: c.p, r: c.r })), ...ledges.map((l) => ({ poly: l.quad }))];
    let bed = null;
    if (h.pool) {
      const [x0, y0, x1, y1] = box(h.poly);
      const k = h.pool.inset ?? 64;
      bed = [x0 + k, y0 + k, x1 - k, y1 - k];
    }
    surfaces.push({ kind: "hall", id: h.id, level, poly: h.poly, z: h.floor, blockers, bed, box: box(h.poly) });
    for (const l of ledges) surfaces.push({ kind: "ledge", id: h.id, level: levelAt(l.z) ?? level, poly: l.quad, z: l.z, blockers: [], bed: null, box: box(l.quad) });
  }
  for (const c of deep.chains) {
    if (!c.segs || c.segs.length !== c.pts.length - 1) continue;
    const a = c.width / 2;
    c.segs.forEach((s, i) => {
      const quad = [at(s, c.cuts[i], -a), at(s, c.cuts[i + 1], -a), at(s, c.cuts[i + 1], a), at(s, c.cuts[i], a)];
      const N = s.stair ? Math.ceil(Math.abs(s.z1 - s.z0) / 16) : 0;
      const sx = c.water ? (c.water.strip >= 1 ? a : a * c.water.strip) : 0;
      surfaces.push({ kind: "seg", id: c.id, chain: c, i, level: c.kind === "stair" ? c.id : c.level, poly: quad, p0: s.p0, u: s.u, n: s.n, L: s.L, z0: s.z0, z1: s.z1, N, water: c.water ? sx : 0, box: box(quad) });
    });
  }
  const zOf = (S, p) => {
    if (S.kind !== "seg") return S.z;
    const t = Math.max(0, Math.min(S.L, dot(sub(p, S.p0), S.u)));
    if (!S.N) return S.z0 + ((S.z1 - S.z0) * t) / S.L;
    const k = Math.max(1, Math.min(S.N, Math.ceil((t / S.L) * S.N)));
    return S.z0 + ((S.z1 - S.z0) * k) / S.N;
  };
  // the surfaces by 128-unit cell of their boxes, for the many looks the hull's rim takes
  const CELL = 128;
  const bucket = new Map();
  for (const S of surfaces)
    for (let i = Math.floor(S.box[0] / CELL); i <= Math.floor(S.box[2] / CELL); i++)
      for (let j = Math.floor(S.box[1] / CELL); j <= Math.floor(S.box[3] / CELL); j++) {
        const k = `${i},${j}`;
        if (!bucket.has(k)) bucket.set(k, []);
        bucket.get(k).push(S);
      }
  /** Surfaces whose air holds p and whose floor there is within `tol` of z. */
  const under = (p, z, tol) => (bucket.get(`${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`) ?? []).filter((S) => p[0] >= S.box[0] - 0.1 && p[0] <= S.box[2] + 0.1 && p[1] >= S.box[1] - 0.1 && p[1] <= S.box[3] + 0.1 && within(S.poly, p) && Math.abs(zOf(S, p) - z) <= tol);
  /** Whether the floor under the middle of p is a floor (not a basin, not a channel). */
  const supports = (S, p) => {
    if (S.bed && p[0] > S.bed[0] && p[0] < S.bed[2] && p[1] > S.bed[1] && p[1] < S.bed[3]) return false;
    if (S.water && Math.abs(dot(sub(p, S.p0), S.n)) < S.water - 12) return false;
    return true;
  };
  /** A hull standing at p on the floor z: its middle on a floor, its rim in air of that level, no column or slab in it. */
  const clear = (p, z, tol = 10) => {
    const here = under(p, z, tol).filter((S) => supports(S, p));
    if (!here.length) return false;
    const slope = Math.max(tol, 20); // the hull's rim may rest on a step 16 off the middle
    for (const S of here) {
      for (const b of S.blockers ?? []) {
        if (b.circle) {
          if (Math.hypot(Math.max(Math.abs(p[0] - b.p[0]) - BOX, 0), Math.max(Math.abs(p[1] - b.p[1]) - BOX, 0)) < b.r + 1) return false;
        } else if (within(b.poly, p, 0) || RING.some(([dx, dy]) => within(b.poly, [p[0] + dx, p[1] + dy], 0))) return false;
      }
    }
    for (const [dx, dy] of RING) if (!under([p[0] + dx, p[1] + dy], z, slope).length) return false;
    // a column or a slab belongs to its hall: a walker on that hall's floor
    return true;
  };
  /** Whether the walk from p to q (floors pz and qz) keeps its clearance all the way. */
  const line = (p, q, pz, qz) => {
    const L = dist2(p, q);
    const n = Math.max(1, Math.ceil(L / 8));
    const tol = Math.abs(pz - qz) > 6 ? 22 : 10;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (!clear([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], pz + (qz - pz) * t, tol)) return false;
    }
    return true;
  };
  return { surfaces, levelAt, zOf, under, clear, line, supports };
}

/**
 * Where a tunnel is walked: `{ d: [offset at each point], say }` or `{ say }` when nobody walks it. A dry tunnel is walked down
 * its middle; one with a water channel along a ledge, as far from its wall as the hull (a box, so more toward a slanted wall) and
 * the ledge's middle ask, the hull's half on the ledge being enough to stand on; water is never a route.
 */
export function walkLine(c) {
  const a = c.width / 2;
  if (!c.water) return { d: c.pts.map(() => 0) };
  const ledge = c.water.strip >= 1 ? 0 : a - a * c.water.strip;
  if (ledge < LEDGE_MIN) return { say: `the tunnel ${c.id}: ${c.water.strip >= 1 ? "its floor is all water" : `its ledge beside the water is ${Math.round(ledge)} wide, ${LEDGE_MIN} wanted`}; nobody walks it (water is never a route)` };
  const w = c.segs.map((s) => Math.max(ledge / 2, BOX * (Math.abs(s.u[0]) + Math.abs(s.u[1])) + 0.1));
  const sx = a - ledge;
  const d = c.pts.map((_, j) => a - Math.max(w[Math.max(0, j - 1)], w[Math.min(w.length - 1, j)]));
  if (d.some((v) => v < sx - 12)) return { say: `the tunnel ${c.id}: its ledge beside the water is ${Math.round(ledge)} wide and a bend of it leaves no room for a hull; nobody walks it` };
  return { d };
}

// ── the graph ────────────────────────────────────────────────────────────────
/**
 * The nodes and links of the deep levels. `places` and `roam` are the contract's: those of district "below" become nodes at
 * their points when a hull clears there (a place a `place` node, a roaming spot a `sewer` node with `roam`: its index). A node:
 * { id, at: [x, y, floor + 36], kind: sewer | place | stair | ladder | hatch, part, level }. A link: { a, b, how }; the ladder
 * links of the shafts carry `way`. `ways` lists the street manholes' feet: { id, node } for paths.mjs to join to the street.
 */
export function deepGraph(deep, { places = [], roam = [] } = {}) {
  const M = walkModel(deep);
  const warnings = [];
  const failures = [];
  const nodes = [];
  const levelOfZ = M.levelAt;
  const RANK = { place: 5, ladder: 4, hatch: 4, stair: 3, sewer: 1 };
  const put = (x, y, z, kind, part, extra = {}) => {
    const near = nodes.find((n) => Math.abs(n.z - z) < 8 && dist2([n.x, n.y], [x, y]) < 14);
    if (near) {
      if ((RANK[kind] ?? 0) > (RANK[near.kind] ?? 0)) near.kind = kind;
      for (const [k, v] of Object.entries(extra)) if (near[k] === undefined) near[k] = v;
      return near;
    }
    const n = { i: nodes.length, x, y, z, kind, part, level: levelOfZ(z) ?? M.under([x, y], z, 22)[0]?.level ?? part, ...extra };
    nodes.push(n);
    return n;
  };
  const stairOf = (S, p) => (S.N ? true : false);
  void stairOf;

  // ─ the places and roaming spots of the spec, exactly where the contract put them
  const placeNode = new Map();
  for (const p of places) {
    if (p.district !== "below") continue;
    const z = p.at[2];
    if (!M.clear([p.at[0], p.at[1]], z)) {
      warnings.push(`the place ${p.id} at ${p.at[0]} ${p.at[1]}: a player cannot stand there on the floor ${z}; it has no node`);
      continue;
    }
    const part = M.under([p.at[0], p.at[1]], z, 10)[0]?.id ?? p.id;
    placeNode.set(p.id, put(p.at[0], p.at[1], z, "place", part, { place: p.id }));
  }
  const roamNode = new Map();
  roam.forEach((r, i) => {
    if (r.district !== "below") return;
    if (!M.clear([r.at[0], r.at[1]], r.at[2])) return;
    const part = M.under([r.at[0], r.at[1]], r.at[2], 10)[0]?.id ?? "below";
    const n = put(r.at[0], r.at[1], r.at[2], "sewer", part);
    roamNode.set(i, n);
  });
  // ─ the tunnels: a line of nodes down each, mitred at the bends, 24 from an end
  const lineOf = new Map(); // chain id -> { d } the offset of its walk line
  for (const c of deep.chains) {
    if (!c.segs || c.segs.length !== c.pts.length - 1) continue;
    const wl = walkLine(c);
    if (wl.say) {
      warnings.push(wl.say);
      continue;
    }
    const dAt = wl.d;
    lineOf.set(c.id, { d: dAt });
    c.segs.forEach((s, i) => {
      const part = c.id;
      const d = dAt[i];
      const A0 = at(s, c.cuts[i], dAt[i]);
      const B0 = at(s, c.cuts[i + 1], dAt[i + 1]);
      if (s.stair) {
        // one node on a tread about every 96: its middle, at the tread's top
        const N = Math.ceil(Math.abs(s.z1 - s.z0) / 16);
        const want = Math.max(2, Math.ceil(s.L / 96));
        const treads = new Set();
        for (let j = 0; j < want; j++) treads.add(Math.max(1, Math.min(N, Math.round(((j + 0.5) / want) * N + 0.5))));
        treads.add(1);
        treads.add(N);
        // a hull rests 16 later than a tread's edge, so the first and last nodes keep 20 from the flats at the ends: no link climbs a step in no run
        for (const k of [...treads].sort((x, y) => x - y)) {
          const t = ((k - 0.5) * s.L) / N;
          if (t < 20 || t > s.L - 20) continue;
          put(s.p0[0] + s.n[0] * d + s.u[0] * t, s.p0[1] + s.n[1] * d + s.u[1] * t, s.z0 + ((s.z1 - s.z0) * k) / N, "stair", part);
        }
        return;
      }
      const A = i === 0 ? [A0[0] + s.u[0] * 24, A0[1] + s.u[1] * 24] : A0;
      const B = i === c.segs.length - 1 ? [B0[0] - s.u[0] * 24, B0[1] - s.u[1] * 24] : B0;
      const len = dist2(A, B);
      const k = Math.max(1, Math.ceil(len / SPACING));
      for (let j = 0; j <= k; j++) put(A[0] + ((B[0] - A[0]) * j) / k, A[1] + ((B[1] - A[1]) * j) / k, s.z0, "sewer", part);
    });
  }
  // ─ a node inside each hall, 40 past each mouth (24 on a ledge)
  for (const p of deep.ports) {
    const c = deep.chains.find((q) => q.id === p.chain);
    const line = lineOf.get(p.chain);
    if (!line) continue;
    const s = p.which ? c.segs.at(-1) : c.segs[0];
    const W = at(s, c.cuts[p.which ? c.pts.length - 1 : 0], line.d[p.which ? c.pts.length - 1 : 0]);
    const into = p.which ? s.u : [-s.u[0], -s.u[1]];
    const h = deep.halls.find((q) => q.id === p.hall);
    const onLedge = h.shaft && p.z >= h.floor + 8;
    const k = onLedge ? 24 : 40;
    put(W[0] + into[0] * k, W[1] + into[1] * k, p.z, "sewer", p.hall);
    if (p.z > h.floor + 8 && !h.shaft) warnings.push(`the tunnel ${p.chain} meets ${p.hall} ${Math.round(p.z - h.floor)} over its floor: nobody steps down from it`);
  }
  // ─ the halls: a grid across each, a ring on the rim of a pool
  for (const S of M.surfaces) {
    if (S.kind !== "hall") continue;
    const [x0, y0, x1, y1] = S.box;
    const nx = Math.max(1, Math.round((x1 - x0) / SPACING));
    const ny = Math.max(1, Math.round((y1 - y0) / SPACING));
    const spots = [];
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) spots.push([x0 + ((i + 0.5) * (x1 - x0)) / nx, y0 + ((j + 0.5) * (y1 - y0)) / ny]);
    if (S.bed) {
      const k = (S.bed[0] - x0) / 2;
      const ring = [[x0 + k, y0 + k], [x1 - k, y0 + k], [x1 - k, y1 - k], [x0 + k, y1 - k]];
      for (let e = 0; e < 4; e++) {
        const [P, Q] = [ring[e], ring[(e + 1) % 4]];
        const m = Math.max(1, Math.ceil(dist2(P, Q) / SPACING));
        for (let j = 0; j < m; j++) spots.push([P[0] + ((Q[0] - P[0]) * j) / m, P[1] + ((Q[1] - P[1]) * j) / m]);
      }
    }
    for (const p of spots) {
      if (!M.clear(p, S.z)) continue;
      if (nodes.some((n) => Math.abs(n.z - S.z) < 8 && dist2([n.x, n.y], p) < 56)) continue;
      put(p[0], p[1], S.z, "sewer", S.id);
    }
  }
  // ─ the ways: the foot of each street manhole, the two ends of each ladder shaft
  const ways = [];
  const clearNear = (p, z, r = 80) => {
    if (M.clear(p, z)) return p;
    for (let ring = 8; ring <= r; ring += 8)
      for (let k = 0; k < 16; k++) {
        const q = [p[0] + Math.cos((k * Math.PI) / 8) * ring, p[1] + Math.sin((k * Math.PI) / 8) * ring];
        if (M.clear(q, z)) return q;
      }
    return null;
  };
  for (const w of deep.ways) {
    const [cx, cy] = w.cell;
    const spot = clearNear([(cx + 0.5) * GRID, (cy + 0.5) * GRID], w.floor, 48);
    if (!spot) {
      failures.push(`${w.id}: no spot a player can stand at the foot of its ladder at the cell ${cx},${cy}`);
      continue;
    }
    ways.push({ id: w.id, node: put(spot[0], spot[1], w.floor, "ladder", w.hall, { way: w.id }), cell: w.cell, wall: w.wall });
  }
  const ladders = [];
  for (const h of deep.halls.filter((q) => q.shaft)) {
    const k = h.shaft;
    const cell = shaftCellOf(h);
    const foot = clearNear([(cell[0] + 0.5) * GRID, (cell[1] + 0.5) * GRID], h.floor, 48);
    const ledges = ledgesOf(h);
    if (!foot) {
      failures.push(`${k.id}: no spot a player can stand at the foot of its ladder at the cell ${cell}`);
      continue;
    }
    if (!ledges.length) {
      failures.push(`${k.id}: no tunnel of ${k.from} meets its shaft above the floor, so its ladder's top reaches nothing`);
      continue;
    }
    const mid = (l) => [(l.quad[0][0] + l.quad[1][0] + l.quad[2][0] + l.quad[3][0]) / 4, (l.quad[0][1] + l.quad[1][1] + l.quad[2][1] + l.quad[3][1]) / 4];
    const ledge = ledges.map((l) => ({ l, d: dist2(mid(l), [(cell[0] + 0.5) * GRID, (cell[1] + 0.5) * GRID]) })).sort((p, q) => p.d - q.d)[0].l;
    const top = clearNear(mid(ledge), ledge.z, 24);
    if (!top) {
      failures.push(`${k.id}: no spot a player can stand at the top of its ladder on the ledge`);
      continue;
    }
    const f = put(foot[0], foot[1], h.floor, "ladder", h.id, { way: k.id });
    const t = put(top[0], top[1], ledge.z, "hatch", h.id, { way: k.id });
    ladders.push({ id: k.id, foot: f, top: t, from: k.from, to: k.to });
  }

  // ─ the stairs from the street: the tread nearest its head, the one farthest down, and the street spot beside the head
  const stairWays = [];
  for (const c of deep.stairs ?? []) {
    const mine0 = nodes.filter((n) => n.part === c.id && n.kind === "stair");
    if (mine0.length < 2) {
      failures.push(`${c.id}: a stair from the street has no treads a player can stand on`);
      continue;
    }
    const s0 = c.segs[0];
    // a head node on the first two treads, 16 in from the street's edge: a hull there rests on them, and the link to the street node 16 out
    // of it (z 0 on the paving) keeps the hull's rest within the tolerance of its line all the way
    put(s0.p0[0] + s0.u[0] * 16 + s0.n[0] * (lineOf.get(c.id)?.d[0] ?? 0), s0.p0[1] + s0.u[1] * 16 + s0.n[1] * (lineOf.get(c.id)?.d[0] ?? 0), s0.z0 - 16, "stair", c.id);
    const mine = nodes.filter((n) => n.part === c.id && n.kind === "stair");
    const byDistance = [...mine].sort((p, q) => dist2([p.x, p.y], s0.p0) - dist2([q.x, q.y], s0.p0));
    stairWays.push({ id: c.id, node: byDistance[0], foot: byDistance.at(-1), out: c.out });
  }
  const wayChains = new Set((deep.stairs ?? []).map((c) => c.id));

  // ─ the links: a straight walk that keeps its clearance, then only those no shorter pair of them goes round
  // a link on a stair from the street is that way's (the plugin: no civilian takes it, a guard only hunting)
  const wayOf = (p, q) => {
    const id = [p, q].map((n) => n.part).find((x) => wayChains.has(x));
    return id ? { way: id } : {};
  };
  const near = [];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const [p, q] = [nodes[i], nodes[j]];
      if (p.way && q.way && p.way === q.way) continue; // a ladder's two ends are joined by the ladder
      const d = dist2([p.x, p.y], [q.x, q.y]);
      if (d > REACH || Math.abs(p.z - q.z) > 200 || d + Math.abs(p.z - q.z) < 1e-6) continue;
      if (M.line([p.x, p.y], [q.x, q.y], p.z, q.z)) near.push({ a: i, b: j, d: Math.hypot(d, p.z - q.z) });
    }
  const has = new Map(near.map((e) => [`${e.a}|${e.b}`, e.d]));
  const dd = (a, b) => has.get(a < b ? `${a}|${b}` : `${b}|${a}`);
  const links = [];
  const adj = new Map(nodes.map((n) => [n.i, []]));
  for (const e of near) (adj.get(e.a).push(e.b), adj.get(e.b).push(e.a));
  for (const e of near) {
    // the relative-neighbourhood rule: a link a third node c is nearer to both ends of goes round it
    const shorter = adj.get(e.a).some((c) => c !== e.b && dd(c, e.a) < e.d && dd(c, e.b) !== undefined && dd(c, e.b) < e.d);
    if (shorter) continue;
    const [p, q] = [nodes[e.a], nodes[e.b]];
    links.push({ a: e.a, b: e.b, how: Math.abs(p.z - q.z) > 24 || p.kind === "stair" || q.kind === "stair" ? "stair" : "walk", ...wayOf(p, q) });
  }
  // a piece the rule or the clearance cut off from the rest is joined by the nearest pair that can see each other, if any
  const comp = (ls) => {
    const g = new Map(nodes.map((n) => [n.i, []]));
    for (const l of ls) (g.get(l.a).push(l.b), g.get(l.b).push(l.a));
    const seen = new Set();
    const out = [];
    for (const n of nodes) {
      if (seen.has(n.i)) continue;
      const cc = [n.i];
      seen.add(n.i);
      for (let k = 0; k < cc.length; k++) for (const m of g.get(cc[k])) if (!seen.has(m)) (seen.add(m), cc.push(m));
      out.push(cc);
    }
    return out.sort((x, y) => y.length - x.length);
  };
  for (const l of ladders) void l;
  const reachFor = (cc) => cc;
  void reachFor;
  for (let pass = 0; pass < 8; pass++) {
    const cs = comp(links);
    if (cs.length < 2) break;
    const main = new Set(cs[0]);
    let best = null;
    for (const c of cs.slice(1))
      for (const i of c)
        for (const j of main) {
          const [p, q] = [nodes[i], nodes[j]];
          const d = dist2([p.x, p.y], [q.x, q.y]);
          if (d > 2 * REACH || Math.abs(p.z - q.z) > 200 || (best && d >= best.d)) continue;
          if (M.line([p.x, p.y], [q.x, q.y], p.z, q.z)) best = { a: i, b: j, d };
        }
    if (!best) break;
    const [p, q] = [nodes[best.a], nodes[best.b]];
    links.push({ a: best.a, b: best.b, how: Math.abs(p.z - q.z) > 24 || p.kind === "stair" || q.kind === "stair" ? "stair" : "walk", ...wayOf(p, q) });
  }
  // the ladders last: not for walking
  for (const l of ladders) links.push({ a: l.foot.i, b: l.top.i, how: "ladder", way: l.id });

  const stairs = deep.chains.filter((c) => c.kind === "stair").map((c) => {
    const zs = c.pts.map((p) => p.z);
    return { id: c.id, top: deep.levels.find((l) => Math.abs(l.floor - Math.max(...zs)) < 8)?.id ?? null, low: deep.levels.find((l) => Math.abs(l.floor - Math.min(...zs)) < 8)?.id ?? null };
  });
  const measures = { nodes: nodes.length, links: links.length, ladders: ladders.length, ways: ways.length, levels: deep.levels.map((lv) => ({ id: lv.id, floor: lv.floor, nodes: nodes.filter((n) => n.level === lv.id).length })), stairs, shafts: ladders.map((l) => ({ id: l.id, from: l.from, to: l.to })) };
  return { nodes, links, ways, stairWays, ladders, placeNode, roamNode, warnings, failures, measures, model: M };
}

// ── places and roaming spots ─────────────────────────────────────────────────
const nearestClear = (M, p, z, r) => {
  if (M.clear(p, z)) return p;
  for (let ring = 8; ring <= r; ring += 8)
    for (let k = 0; k < 24; k++) {
      const q = [p[0] + Math.cos((k * Math.PI) / 12) * ring, p[1] + Math.sin((k * Math.PI) / 12) * ring];
      if (M.clear(q, z)) return q;
    }
  return null;
};
/**
 * The places (`below.places`: [{ id, kind, hall | level + at: [x, y] }]) and the extra roaming spots (`below.roam`: [{ hall | level +
 * at }]) of a description on the floor, and the roaming spots picked: a hall's middle and a spot along each tunnel every ~384
 * units (never within 96 of a way down, a ladder or a stair), 256 apart at the least. Places: { id: "below_<id>", kind, at: [x, y,
 * floor], building: null, district: "below" }; roam: { district: "below", at: [x, y, floor] }. `failures`: the sentences of a
 * place or a spot that lands on no floor.
 */
export function deepSpots(deep, below = {}, { kinds = null } = {}) {
  const M = walkModel(deep);
  const failures = [];
  const place = [];
  const roam = [];
  const levelOf = (id) => deep.levels.find((l) => l.id === id);
  const hallOf = (id) => deep.halls.find((h) => h.id === id);
  const centroid = (poly) => [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  /** { at: [x, y, floor] } for an entry { hall } or { level, at }, or null with the failure said. */
  const landing = (e, what) => {
    let floor;
    let want;
    if (e.hall) {
      const h = hallOf(e.hall);
      if (!h) return failures.push(`${what}: there is no hall ${e.hall}`), null;
      floor = h.floor;
      want = e.at ?? centroid(h.poly);
    } else {
      const lv = levelOf(e.level);
      if (!lv || !Array.isArray(e.at)) return failures.push(`${what}: it wants a hall, or a level and at [x, y]`), null;
      floor = lv.floor;
      want = e.at;
    }
    const spot = nearestClear(M, want, floor, e.hall && !e.at ? 160 : 96);
    if (!spot) return failures.push(`${what}: no spot a player can stand within ${e.hall && !e.at ? 160 : 96} units of ${want.map(Math.round).join(", ")} on the floor ${floor}${e.hall ? ` of ${e.hall}` : ` of ${e.level}`}`), null;
    return [r2(spot[0]), r2(spot[1]), floor];
  };
  for (const p of below.places ?? []) {
    if (!p.id || (kinds && !kinds.has(p.kind))) {
      failures.push(`the place ${p.id ?? "(no id)"} of the levels below: its kind ${JSON.stringify(p.kind)} is not one of ${[...(kinds ?? [])].join(", ")}`);
      continue;
    }
    const at = landing(p, `the place ${p.id}`);
    if (at) place.push({ id: `below_${p.id}`, kind: p.kind, at, building: null, district: "below" });
  }
  // keep off the ways down and the stairs
  const away = [];
  for (const w of deep.ways) away.push(...[[(w.cell[0] + 0.5) * GRID, (w.cell[1] + 0.5) * GRID]]);
  for (const h of deep.halls.filter((q) => q.shaft)) {
    const c = shaftCellOf(h);
    away.push([(c[0] + 0.5) * GRID, (c[1] + 0.5) * GRID]);
  }
  const stairs = deep.chains.filter((c) => c.kind === "stair");
  const farFromWays = (p) => away.every((q) => dist2(p, q) >= 96) && stairs.every((c) => !c.segs?.some((s) => s.stair && segDist(p, s.p0, [s.p0[0] + s.u[0] * s.L, s.p0[1] + s.u[1] * s.L]) < 96));
  const picked = [];
  const pick = (p, z, gap = 256) => {
    if (!M.clear(p, z) || !farFromWays(p) || place.some((q) => q.at[2] === z && dist2(p, q.at) < 96)) return false;
    if (picked.some((q) => q[2] === z && dist2(p, q) < gap)) return false;
    picked.push([r2(p[0]), r2(p[1]), z]);
    return true;
  };
  for (const e of below.roam ?? []) {
    const at = landing(e, "a roaming spot of the description");
    if (at) picked.push(at);
  }
  for (const h of deep.halls) {
    if (h.shaft) continue;
    const c = centroid(h.poly);
    const spot = nearestClear(M, c, h.floor, 160);
    if (spot) pick(spot, h.floor, 160);
  }
  for (const c of deep.chains) {
    if (c.kind === "stair" || !c.segs || c.segs.length !== c.pts.length - 1) continue;
    const wl = walkLine(c);
    if (!wl.d) continue;
    let run = 0;
    for (const [i, s] of c.segs.entries()) {
      const d = wl.d[i];
      if (s.stair) continue;
      for (let t = 48 + ((384 - (run % 384)) % 384); t <= s.L - 48; t += 384) pick([s.p0[0] + s.n[0] * d + s.u[0] * t, s.p0[1] + s.n[1] * d + s.u[1] * t], s.z0);
      run += s.L;
    }
  }
  for (const p of picked) roam.push({ district: "below", at: p });
  return { places: place, roam, failures };
}
function segDist(p, a, b) {
  const e = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), e) / dot(e, e)));
  return dist2(p, [a[0] + e[0] * t, a[1] + e[1] * t]);
}

// ── the levels held against the graph made ───────────────────────────────────
/**
 * What the graph says of the deep levels (the nodes with a `level`): every one reached from the first level's over the links the
 * NPCs take (walk and stair); a stair of the description that no walk joins is a failure, a level reached only by ladder a
 * warning; the longest shortest route between two nodes, in nodes, against the plugin's ROUTE_LEN.
 */
export const ROUTE_LEN = 320;
export function checkDeepPaths(paths) {
  const deep = paths.deep ?? null;
  const failures = [];
  const warnings = [];
  const mine = paths.nodes.filter((n) => n.district === "below" && n.level !== undefined);
  const measures = { nodes: mine.length, levels: {}, longestRoute: 0, ladderOnly: [] };
  if (!mine.length) return { failures, warnings, measures };
  const ids = new Set(mine.map((n) => n.id));
  const walk = new Map(mine.map((n) => [n.id, []]));
  const ladder = new Map(mine.map((n) => [n.id, []]));
  for (const l of paths.links) {
    if (!ids.has(l.a) || !ids.has(l.b)) continue;
    const m = l.how === "walk" || l.how === "stair" ? walk : l.how === "ladder" ? ladder : null;
    if (!m || l.gate) continue;
    m.get(l.a).push(l.b);
    if (!l.oneWay) m.get(l.b).push(l.a);
  }
  const bfs = (from, graph) => {
    const d = new Map([[from, 0]]);
    const q = [from];
    for (let k = 0; k < q.length; k++) for (const m of graph.get(q[k]) ?? []) if (!d.has(m)) (d.set(m, d.get(q[k]) + 1), q.push(m));
    return d;
  };
  const levelIds = deep?.levels ? deep.levels.map((l) => l.id) : [...new Set(mine.map((n) => n.level))];
  const byLevel = new Map(levelIds.map((id) => [id, mine.filter((n) => n.level === id)]));
  for (const [id, ns] of byLevel) measures.levels[id] = ns.length;
  const first = levelIds.find((id) => byLevel.get(id).length);
  if (first === undefined) return { failures, warnings, measures };
  const home = bfs(byLevel.get(first)[0].id, walk);
  // each node of the level reached from its level's first over walk and stair links, or from a stair's end of another
  const all = new Map(mine.map((n) => [n.id, ladder.get(n.id).length ? [...walk.get(n.id), ...ladder.get(n.id)] : walk.get(n.id)]));
  const full = bfs(byLevel.get(first)[0].id, all);
  const lostByWalk = mine.filter((n) => !home.has(n.id));
  const lostAll = mine.filter((n) => !full.has(n.id));
  if (lostAll.length) failures.push(`${lostAll.length} nodes of the levels below are reached from the first level by no link: ${lostAll.slice(0, 3).map((n) => `${n.id} (${n.level}, ${n.part}) at ${n.at}`).join("; ")}`);
  for (const id of levelIds) {
    const ns = byLevel.get(id);
    if (!ns.length) continue;
    const walkable = ns.some((n) => home.has(n.id));
    if (!walkable && ns.every((n) => full.has(n.id))) {
      warnings.push(`the level ${id} is reached only by ladder: a guard on a chase cannot follow (it wants a stair from another level)`);
      measures.ladderOnly.push(id);
    } else if (!walkable) failures.push(`the level ${id} is reached from the first level by no link`);
    else if (ns.some((n) => !home.has(n.id) && full.has(n.id))) {
      const n = ns.find((q) => !home.has(q.id));
      warnings.push(`${ns.filter((q) => !home.has(q.id)).length} nodes of the level ${id} are reached only by ladder, from ${n.id} (${n.part}) at ${n.at}`);
    }
  }
  void lostByWalk;
  // every stair link of the description joins its two levels by a walk
  if (deep) {
    for (const c of deep.stairs ?? []) {
      if (!c.top || !c.low || c.top === c.low) continue;
      const a = byLevel.get(c.top)?.[0];
      const b = byLevel.get(c.low) ?? [];
      if (!a || !b.length) continue;
      const d = bfs(a.id, walk);
      if (!b.some((n) => d.has(n.id))) failures.push(`the stair ${c.id} joins ${c.top} and ${c.low} in the plan, but no walk or stair link joins them in the graph`);
    }
  }
  // the longest shortest route, in nodes (the plugin's route holds ROUTE_LEN)
  let longest = 0;
  for (const n of mine) for (const v of bfs(n.id, walk).values()) longest = Math.max(longest, v);
  measures.longestRoute = longest;
  // from the first level's way in (a foot of a manhole, else its first node) to each node of the deepest level, the shortest walk
  const floorOf = (id) => deep?.levels?.find((l) => l.id === id)?.floor ?? 0;
  const deepest = levelIds.filter((id) => byLevel.get(id).length).sort((x, y) => floorOf(x) - floorOf(y))[0];
  if (deepest && deepest !== first) {
    const byId = new Map(mine.map((n) => [n.id, n]));
    const start = byLevel.get(first).find((n) => n.way && n.kind === "ladder") ?? byLevel.get(first)[0];
    const dist = new Map([[start.id, 0]]);
    const hops = new Map([[start.id, 0]]);
    const todo = [start.id];
    while (todo.length) {
      todo.sort((a, b) => dist.get(b) - dist.get(a));
      const cur = todo.pop();
      for (const m of walk.get(cur)) {
        const [p, q] = [byId.get(cur).at, byId.get(m).at];
        const nd = dist.get(cur) + Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        if (!dist.has(m) || nd < dist.get(m) - 1e-9) (dist.set(m, nd), hops.set(m, hops.get(cur) + 1), todo.push(m));
      }
    }
    const reachedDeep = byLevel.get(deepest).filter((n) => dist.has(n.id));
    if (reachedDeep.length) {
      const far = reachedDeep.sort((a, b) => dist.get(b.id) - dist.get(a.id))[0];
      measures.toDeepest = { from: first, to: deepest, units: Math.round(dist.get(far.id)), nodes: hops.get(far.id) + 1 };
    }
  }
  if (longest + 1 > ROUTE_LEN) failures.push(`the longest route between two nodes of the levels below is ${longest + 1} nodes; the plugin's route holds ${ROUTE_LEN}`);
  return { failures, warnings, measures };
}
export { SHELL };
