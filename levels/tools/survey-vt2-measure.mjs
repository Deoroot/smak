// Vermintide 2's campaign levels in numbers, beside GoldSrc's and Source's: floor width, the floor's runs,
// walkable area, the narrow share, vertical spread, openings on the main path, the main path against the
// straight line, loops, and the pacing along the path. MEASURES ONLY go out (levels/corpus/levels-vt2.json);
// what is read (the navmesh's triangles, the main path's nodes) stays in levels/vt2/out/, local.
//
//   node levels/tools/survey-vt2-measure.mjs [<level key> ...]
//
// Reads what survey-vt2-nav.py (out/nav/<level>.bin: the navmesh) and survey-vt2.py (out/levels/<level>.json:
// main path, zones, routes, smart objects, events) wrote. The notes (levels/notes-vt2.md) say what each
// measure means and how it differs from measure.mjs's.
//
// HOW A PLACE IS MEASURED. There is no solid geometry here (the levels' collision is PhysX meshes inside
// thousands of unit resources, not decoded): the floor is the navmesh, the game's own walkable surface (made
// for an AI 1.6 m tall and 0.38-0.4 m round, so it stops that radius short of every wall). It is rastered
// at 0.2 m, keeping every floor of a place where several lie one over another, and walked: from the main
// path's nodes, over neighbouring samples no more than 0.5 m apart in height (the navmesh is continuous over
// stairs and slopes; a drop, a ledge or a jump is not walked: the player's one-way ways are left out, as the
// GoldSrc survey leaves out drops). Places are looked over on a grid of 0.8 m (measure.mjs's 32 units, a
// player's width, scaled by player heights: 32/72 of 1.8 m) and from each, sixteen lines are walked out
// along the floor, one every 22.5 degrees, each until the floor ends (75 m at the most: measure.mjs's 3000
// units scaled the same way):
//   width     the narrowest of the eight lines through the place, plus the navmesh's radius at each end
//             (the floor the AI's centre may stand on, widened back to the wall). Unlike measure.mjs's, which
//             is taken at eye height between solids, the floor's end narrows it too: a drop, a ledge, a low
//             wall or a crate a player looks over all end the line.
//   floorRun  the longest of the sixteen lines: how far the floor runs from there, not how far one sees (a
//             sight line crosses gaps and looks over walls). A floor for sight, never over it.
//   headroom  not measured: the navmesh only says there are 1.6 m clear over it.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const OUT = join(REPO, "levels", "vt2", "out");

// ── constants ───────────────────────────────────────────────────────────────
/** A player's height, metres: the length measures are also given in (ph). The heroes' eyes stand 1.3-1.7 m. */
const PLAYER = 1.8;
/** GoldSrc's player is 72 units: its lines scale to ours by player heights. */
const UNIT = PLAYER / 72;
/** The raster's sample, metres. */
const RASTER = 0.2;
/** Two samples side by side are one floor when this near in height, metres. */
const STEP = 0.5;
/** The places' grid, metres (32 units). */
const GRID = 32 * UNIT;
/** A line is walked this far at the most (3000 units). */
const FAR = 3000 * UNIT;
const WAYS = 16;
/** Narrow: under two player heights wide. Wide: four and over. The kit's corridor line: 176 units. */
const NARROW = 2 * PLAYER;
const WIDE = 4 * PLAYER;
const KIT_NARROW = 176 * UNIT;
/** Loops: the walked floor in tiles of 256 and 512 units, as the GoldSrc survey. */
const LOOP_TILES = [256 * UNIT, 512 * UNIT];
/** A height band of the floor (32 units) holding 2% of it or more is one of its levels. */
const LEVEL_BIN = 32 * UNIT;
const LEVEL_SHARE = 0.02;
/** The main path is sampled every metre for its openings: a place at most this wide... */
const PATH_SAMPLE = 1;
/** ...narrower than its neighbours within OPEN_NEAR metres, and with floor twice as wide within OPEN_SIDE m both ways. */
const OPEN_NEAR = 2;
const OPEN_SIDE = 15;
const OPEN_RATIO = 2;
/** The path's winding is taken over stretches of this many metres (samples). */
const WINDOW = 100;

// ── small arithmetic (as levels/lib/goldsrc-level-measures.mjs) ─────────────
function quantile(sorted, share) {
  if (!sorted.length) return null;
  const at = share * (sorted.length - 1);
  const low = Math.floor(at);
  const high = Math.min(sorted.length - 1, low + 1);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}
function weightedQuantile(pairs, share) {
  const total = pairs.reduce((sum, [, w]) => sum + w, 0);
  if (!total) return null;
  let run = 0;
  for (const [value, weight] of pairs) {
    run += weight;
    if (run >= share * total - 1e-12) return value;
  }
  return pairs[pairs.length - 1][0];
}
const round = (v, places = 2) => (v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(places)));
function bandOf(values, weights = null, places = 2) {
  const kept = [];
  values.forEach((v, i) => {
    if (v !== null && v !== undefined && Number.isFinite(v)) kept.push([v, weights ? weights[i] : 1]);
  });
  kept.sort((a, b) => a[0] - b[0]);
  const at = weights ? (s) => weightedQuantile(kept, s) : (s) => quantile(kept.map(([v]) => v), s);
  return { n: kept.length, median: round(at(0.5), places), q1: round(at(0.25), places), q3: round(at(0.75), places), p5: round(at(0.05), places), p95: round(at(0.95), places) };
}
const summary = (values) => {
  const b = bandOf(values);
  delete b.n;
  return b;
};
const scaleBand = (b, k, places = 2) => Object.fromEntries(Object.entries(b).map(([key, v]) => [key, key === "n" ? v : round(v === null ? null : v * k, places)]));
const share = (part, all) => (all ? round(part / all, 3) : null);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ── the navmesh, rastered ───────────────────────────────────────────────────
function readNav(path) {
  const buf = readFileSync(path);
  const n = buf.readUInt32LE(0);
  const f = new Float32Array(buf.buffer.slice(buf.byteOffset + 4, buf.byteOffset + 4 + n * 36));
  return { n, f };
}

function rasterOf(nav) {
  const { n, f } = nav;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, area = 0;
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    for (let k = 0; k < 3; k++) {
      x0 = Math.min(x0, f[o + 3 * k]); x1 = Math.max(x1, f[o + 3 * k]);
      y0 = Math.min(y0, f[o + 3 * k + 1]); y1 = Math.max(y1, f[o + 3 * k + 1]);
    }
    area += Math.abs((f[o + 3] - f[o]) * (f[o + 7] - f[o + 1]) - (f[o + 6] - f[o]) * (f[o + 4] - f[o + 1])) / 2;
  }
  x0 -= 1; y0 -= 1; x1 += 1; y1 += 1;
  const nx = Math.ceil((x1 - x0) / RASTER), ny = Math.ceil((y1 - y0) / RASTER);
  const N = nx * ny;
  if (N > 120e6) throw new Error(`raster too big: ${nx} x ${ny}`);
  const z0 = new Float32Array(N).fill(NaN);
  const head = new Int32Array(N).fill(-1);
  const exZ = [], exNext = [], exCell = [];
  const add = (c, z) => {
    if (Number.isNaN(z0[c])) { z0[c] = z; return; }
    if (Math.abs(z0[c] - z) < STEP) return;
    for (let k = head[c]; k >= 0; k = exNext[k]) if (Math.abs(exZ[k] - z) < STEP) return;
    exZ.push(z); exNext.push(head[c]); exCell.push(c); head[c] = exZ.length - 1;
  };
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const ax = f[o], ay = f[o + 1], az = f[o + 2], bx = f[o + 3], by = f[o + 4], bz = f[o + 5], cx = f[o + 6], cy = f[o + 7], cz = f[o + 8];
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-9) continue;
    const i0 = Math.floor((Math.min(ax, bx, cx) - x0) / RASTER), i1 = Math.floor((Math.max(ax, bx, cx) - x0) / RASTER);
    const j0 = Math.floor((Math.min(ay, by, cy) - y0) / RASTER), j1 = Math.floor((Math.max(ay, by, cy) - y0) / RASTER);
    const eps = 1e-6;
    for (let j = j0; j <= j1; j++) {
      const py = y0 + (j + 0.5) * RASTER;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * RASTER;
        const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
        const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < -eps || l2 < -eps || l3 < -eps) continue;
        add(j * nx + i, l1 * az + l2 * bz + l3 * cz);
      }
    }
  }
  return { x0, y0, nx, ny, N, z0, head, exZ: Float32Array.from(exZ), exNext: Int32Array.from(exNext), exCell: Int32Array.from(exCell), area };
}

/** The node (a floor of a sample) at sample c nearest height z within tol: its id (c, or N + extra), or -1. */
function nodeAt(r, c, z, tol) {
  let best = -1, bd = tol;
  const a = r.z0[c];
  if (!Number.isNaN(a) && Math.abs(a - z) <= bd) { best = c; bd = Math.abs(a - z); }
  for (let k = r.head[c]; k >= 0; k = r.exNext[k]) {
    const dz = Math.abs(r.exZ[k] - z);
    if (dz <= bd) { best = r.N + k; bd = dz; }
  }
  return best;
}
const zOf = (r, id) => (id < r.N ? r.z0[id] : r.exZ[id - r.N]);
const cellOf = (r, id) => (id < r.N ? id : r.exCell[id - r.N]);
const sampleOf = (r, x, y) => {
  const i = Math.floor((x - r.x0) / RASTER), j = Math.floor((y - r.y0) / RASTER);
  return i < 0 || j < 0 || i >= r.nx || j >= r.ny ? -1 : j * r.nx + i;
};

/** The floor walked from the seeds: a mark per node. */
function reachOf(r, seeds) {
  const total = r.N + r.exZ.length;
  const reached = new Uint8Array(total);
  const queue = new Int32Array(total);
  let qh = 0, qt = 0;
  for (const s of seeds) if (s >= 0 && !reached[s]) { reached[s] = 1; queue[qt++] = s; }
  const nb = [1, -1, r.nx, -r.nx];
  while (qh < qt) {
    const id = queue[qh++];
    const c = cellOf(r, id), z = zOf(r, id);
    const i = c % r.nx;
    for (const d of nb) {
      if ((d === 1 && i === r.nx - 1) || (d === -1 && i === 0)) continue;
      const cc = c + d;
      if (cc < 0 || cc >= r.N) continue;
      const a = r.z0[cc];
      if (!Number.isNaN(a) && Math.abs(a - z) <= STEP && !reached[cc]) { reached[cc] = 1; queue[qt++] = cc; }
      for (let k = r.head[cc]; k >= 0; k = r.exNext[k]) {
        const nid = r.N + k;
        if (Math.abs(r.exZ[k] - z) <= STEP && !reached[nid]) { reached[nid] = 1; queue[qt++] = nid; }
      }
    }
  }
  return { reached, count: qt };
}

const DIRS = Array.from({ length: WAYS }, (_, k) => [Math.cos((k * 2 * Math.PI) / WAYS), Math.sin((k * 2 * Math.PI) / WAYS)]);
/** A line walked along the floor from (x, y, z): how far until the floor ends (its last sample's middle). */
function runOf(r, x, y, z, [dx, dy], far = FAR) {
  let d = 0;
  for (;;) {
    const nd = d + RASTER;
    if (nd > far) return far;
    const c = sampleOf(r, x + dx * nd, y + dy * nd);
    if (c < 0) return d + RASTER / 2;
    const id = nodeAt(r, c, z, STEP);
    if (id < 0) return d + RASTER / 2;
    z = zOf(r, id);
    d = nd;
  }
}
function placeLines(r, x, y, z, radius, sightToo = true) {
  const runs = DIRS.map((dir, k) => (sightToo || k < WAYS ? runOf(r, x, y, z, dir) : 0));
  let width = Infinity;
  for (let k = 0; k < WAYS / 2; k++) width = Math.min(width, runs[k] + runs[k + WAYS / 2]);
  return { width: width + 2 * radius, floorRun: Math.max(...runs) + radius };
}

// ── loops (as the GoldSrc survey: regions in tiles, cycles of their graph less the trivial rings) ──
function loopsOf(places, besides, tile) {
  const n = places.length;
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (s) => { while (parent[s] !== s) { parent[s] = parent[parent[s]]; s = parent[s]; } return s; };
  const tileOf = places.map((p) => `${Math.floor(p.x / tile)},${Math.floor(p.y / tile)}`);
  const crossing = [];
  for (let s = 0; s < n; s++) for (const o of besides[s]) if (o > s) {
    if (tileOf[s] === tileOf[o]) parent[find(s)] = find(o);
    else crossing.push([s, o]);
  }
  const regions = new Set();
  for (let s = 0; s < n; s++) regions.add(find(s));
  const edges = new Set(), adj = new Map();
  for (const [s, o] of crossing) {
    const a = find(s), b = find(o);
    if (a === b) continue;
    const key = a < b ? `${a} ${b}` : `${b} ${a}`;
    if (edges.has(key)) continue;
    edges.add(key);
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b); adj.get(b).add(a);
  }
  const seen = new Set();
  let parts = 0;
  for (const rg of regions) {
    if (seen.has(rg)) continue;
    parts++;
    const stack = [rg]; seen.add(rg);
    while (stack.length) for (const nx of adj.get(stack.pop()) ?? []) if (!seen.has(nx)) (seen.add(nx), stack.push(nx));
  }
  const regionTile = new Map();
  for (let s = 0; s < n; s++) regionTile.set(find(s), tileOf[s].split(",").map(Number));
  let faces = 0;
  for (const a of regions) {
    const [i, j] = regionTile.get(a);
    const near = adj.get(a);
    if (!near) continue;
    const east = [...near].filter((q) => { const [x, y] = regionTile.get(q); return x === i + 1 && y === j; });
    const north = [...near].filter((q) => { const [x, y] = regionTile.get(q); return x === i && y === j + 1; });
    for (const b of east) for (const d of north) for (const c of adj.get(b) ?? []) {
      const [x, y] = regionTile.get(c);
      if (x === i + 1 && y === j + 1 && adj.get(d)?.has(c)) faces++;
    }
  }
  return { regions: regions.size, joins: edges.size, cycles: Math.max(0, edges.size - regions.size + parts - faces) };
}

/** Whether the floor runs from place p to place q (a straight walk, ending on q's floor). */
function walksTo(r, p, q) {
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  const dx = (q.x - p.x) / len, dy = (q.y - p.y) / len;
  let z = p.z;
  for (let d = RASTER; d <= len + 1e-6; d += RASTER) {
    const c = sampleOf(r, p.x + dx * d, p.y + dy * d);
    const id = c < 0 ? -1 : nodeAt(r, c, z, STEP);
    if (id < 0) return false;
    z = zOf(r, id);
  }
  return Math.abs(z - q.z) <= STEP;
}

/**
 * The longest walk across the places: two sweeps of a flood over the places' grid (8 ways), in the largest
 * part of the walked floor (the main path's breaks part it).
 */
function spanOf(places, besides) {
  const flood = (from) => {
    const far = new Float64Array(places.length).fill(Infinity);
    far[from] = 0;
    // Dijkstra with a simple binary heap
    const heap = [[0, from]];
    const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, rr = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    while (heap.length) {
      const [d, s] = pop();
      if (d > far[s]) continue;
      const p = places[s];
      for (const o of besides[s]) {
        const q = places[o];
        const nd = d + Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
        if (nd < far[o]) { far[o] = nd; push([nd, o]); }
      }
    }
    let best = from;
    for (let i = 0; i < far.length; i++) if (far[i] !== Infinity && far[i] > far[best]) best = i;
    return { best, far: far[best] };
  };
  // the largest part
  const part = new Int32Array(places.length).fill(-1);
  let bestPart = -1, bestSize = 0, bestFrom = 0;
  for (let s = 0, np = 0; s < places.length; s++) {
    if (part[s] >= 0) continue;
    const stack = [s]; part[s] = np; let size = 0;
    while (stack.length) { const at = stack.pop(); size++; for (const o of besides[at]) if (part[o] < 0) { part[o] = np; stack.push(o); } }
    if (size > bestSize) { bestSize = size; bestPart = np; bestFrom = s; }
    np++;
  }
  const a = flood(bestFrom);
  const b = flood(a.best);
  const pa = places[a.best], pb = places[b.best];
  const straight = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
  return { walk: round(b.far, 1), straight: round(straight, 1), ratio: straight > 0 ? round(b.far / straight, 2) : null };
}

// ── one level ───────────────────────────────────────────────────────────────
function measureLevel(L) {
  const times = {};
  let t = Date.now();
  const nav = readNav(join(OUT, "nav", L.nav.bin));
  const r = rasterOf(nav);
  const radius = L.nav.radius;
  times.raster = Date.now() - t; t = Date.now();

  // seeds: every node of the main path, on the floor under it
  const seeds = [];
  for (const s of L.segments) for (const p of s.nodes) {
    let id = -1;
    for (let rad = 0; rad <= 5 && id < 0; rad++)
      for (let dj = -rad; dj <= rad && id < 0; dj++) for (let di = -rad; di <= rad && id < 0; di++) {
        const c = sampleOf(r, p[0] + di * RASTER, p[1] + dj * RASTER);
        if (c >= 0) id = nodeAt(r, c, p[2], 1.5);
      }
    seeds.push(id);
  }
  const { reached, count } = reachOf(r, seeds);
  times.walk = Date.now() - t; t = Date.now();

  // places on the grid
  const places = [];
  const index = new Map();
  const step = Math.round(GRID / RASTER); // 4 samples
  for (let j = Math.floor(step / 2); j < r.ny; j += step)
    for (let i = Math.floor(step / 2); i < r.nx; i += step) {
      const c = j * r.nx + i;
      const ids = [];
      if (!Number.isNaN(r.z0[c]) && reached[c]) ids.push(c);
      for (let k = r.head[c]; k >= 0; k = r.exNext[k]) if (reached[r.N + k]) ids.push(r.N + k);
      for (const id of ids) {
        index.set(id, places.length);
        places.push({ x: r.x0 + (i + 0.5) * RASTER, y: r.y0 + (j + 0.5) * RASTER, z: zOf(r, id), i, j, id });
      }
    }
  for (const p of places) Object.assign(p, placeLines(r, p.x, p.y, p.z, radius));
  times.measure = Date.now() - t; t = Date.now();

  // places beside one another (8 ways on the grid, joined along the floor by a short walk)
  const at = new Map();
  places.forEach((p, k) => {
    const key = `${p.i},${p.j}`;
    if (!at.has(key)) at.set(key, []);
    at.get(key).push(k);
  });
  // four ways for the loops (as the GoldSrc survey's walk grid), eight for the span's walk
  const besides4 = places.map(() => []), besides8 = places.map(() => []);
  places.forEach((p, k) => {
    for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      for (const o of at.get(`${p.i + di * step},${p.j + dj * step}`) ?? []) {
        const q = places[o];
        if (!walksTo(r, p, q)) continue;
        besides8[k].push(o); besides8[o].push(k);
        if (di === 0 || dj === 0) { besides4[k].push(o); besides4[o].push(k); }
      }
    }
  });
  const loops = LOOP_TILES.map((tile) => loopsOf(places, besides4, tile));
  const span = places.length ? spanOf(places, besides8) : null;
  times.extra = Date.now() - t; t = Date.now();

  // the main path: samples every metre, their widths, the openings
  const pathWidths = [];
  const windings = [];
  for (const s of L.segments) {
    // the path's winding: every WINDOW m of it against the straight line over the same stretch
    const pts = [];
    for (let k = 0; k + 1 < s.nodes.length; k++) {
      const a = s.nodes[k], b = s.nodes[k + 1], len = dist(a, b);
      for (let d = 0; d < len; d += PATH_SAMPLE) pts.push([a[0] + (b[0] - a[0]) * (d / len), a[1] + (b[1] - a[1]) * (d / len), a[2] + (b[2] - a[2]) * (d / len)]);
    }
    for (let k = 0; k + WINDOW < pts.length; k += WINDOW / 4) windings.push(WINDOW / Math.max(dist(pts[k], pts[k + WINDOW]), 1e-6));
    const nodes = s.nodes;
    for (let k = 0; k + 1 < nodes.length; k++) {
      const a = nodes[k], b = nodes[k + 1];
      const len = dist(a, b);
      for (let d = 0; d < len; d += PATH_SAMPLE) {
        const f = d / len;
        const p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
        const c = sampleOf(r, p[0], p[1]);
        const id = c >= 0 ? nodeAt(r, c, p[2], 1.5) : -1;
        if (id < 0) { pathWidths.push(null); continue; }
        let w = Infinity;
        const z = zOf(r, id);
        for (let q = 0; q < WAYS / 2; q++) w = Math.min(w, runOf(r, p[0], p[1], z, DIRS[q]) + runOf(r, p[0], p[1], z, DIRS[q + WAYS / 2]));
        pathWidths.push(w + 2 * radius);
      }
    }
    pathWidths.push(null); // a segment's end: no opening across a break
  }
  const openings = [];
  for (let i = 0; i < pathWidths.length; i++) {
    const w = pathWidths[i];
    if (w === null) continue;
    let ok = true;
    for (let k = Math.max(0, i - OPEN_NEAR); k <= Math.min(pathWidths.length - 1, i + OPEN_NEAR) && ok; k++)
      if (k !== i && pathWidths[k] !== null && (pathWidths[k] < w || (pathWidths[k] === w && k < i))) ok = false;
    if (!ok) continue;
    let before = 0, after = 0;
    for (let k = i - 1; k >= Math.max(0, i - OPEN_SIDE) && pathWidths[k] !== null; k--) before = Math.max(before, pathWidths[k]);
    for (let k = i + 1; k <= Math.min(pathWidths.length - 1, i + OPEN_SIDE) && pathWidths[k] !== null; k++) after = Math.max(after, pathWidths[k]);
    if (before >= OPEN_RATIO * w && after >= OPEN_RATIO * w) openings.push(w);
  }
  times.path = Date.now() - t;

  // ── the record: numbers only ──
  const widths = places.map((p) => p.width);
  const runs = places.map((p) => p.floorRun);
  const zs = places.map((p) => p.z).sort((a, b) => a - b);
  const stacks = new Map();
  for (const p of places) stacks.set(`${p.i},${p.j}`, (stacks.get(`${p.i},${p.j}`) ?? 0) + 1);
  const bins = new Map();
  for (const z of zs) bins.set(Math.floor(z / LEVEL_BIN), (bins.get(Math.floor(z / LEVEL_BIN)) ?? 0) + 1);
  const pathLength = L.total_length ?? L.segments.reduce((s, g) => s + g.length, 0);
  const first = L.segments[0].nodes[0], lastSeg = L.segments[L.segments.length - 1], last = lastSeg.nodes[lastSeg.nodes.length - 1];
  const straight = dist(first, last);
  const allNodes = L.segments.flatMap((g) => g.nodes);
  let extent = 0;
  for (let a = 0; a < allNodes.length; a++) for (let b = a + 1; b < allNodes.length; b++) extent = Math.max(extent, dist(allNodes[a], allNodes[b]));
  const km = pathLength / 1000;
  // zones: the band of floor beside the path, per metre of it
  const mainZones = L.zones.filter((z) => !z.island && typeof z.travel === "number").sort((a, b) => a.travel - b.travel);
  const islands = L.zones.filter((z) => z.island);
  const zoneArea = (z) => z.areas.reduce((s, a) => s + a, 0);
  const band = mainZones.map((z) => zoneArea(z) / 10);
  const bandMed = quantile([...band].sort((a, b) => a - b), 0.5);
  const open = [];
  for (let k = 0; k < band.length; k++) if (band[k] >= 2 * bandMed && (k === 0 || band[k - 1] < 2 * bandMed)) open.push(mainZones[k].travel);
  const openGaps = open.slice(1).map((v, k) => v - open[k]);
  const allZoneArea = L.zones.reduce((s, z) => s + zoneArea(z), 0);
  const routes = L.routes ?? [];
  const bosses = routes.filter((x) => x.kind === "boss"), patrols = routes.filter((x) => x.kind === "patrol");
  const so = L.smart_objects ?? [];
  const ledges = so.filter((o) => o.type?.startsWith("ledges"));
  const jumps = so.filter((o) => o.type === "jumps");
  const ev = L.terror_events ?? {};
  const hordeEvents = Object.values(ev).filter((steps) => steps.some((s) => /horde/.test(s)));
  const crossroads = Object.keys(L.crossroads ?? {}).length;
  const markerCross = new Set((L.markers ?? []).map((m) => m.crossroads).filter(Boolean)).size;
  const reachedArea = count * RASTER * RASTER;

  return {
    name: L.key,
    level: L.level,
    act: L.act,
    bossLevel: L.boss_level,
    nav: { radius: round(L.nav.radius), height: round(L.nav.height), step: round(L.nav.step), slope: round(L.nav.slope, 0), triangles: nav.n },
    area: round(r.area, 0), // m2, the whole navmesh, level (projected)
    reachedArea: round(reachedArea, 0), // m2, walked from the main path
    reachedShare: share(reachedArea, r.area),
    places: places.length,
    width: summary(widths),
    narrowShare: share(widths.filter((w) => w < NARROW).length, widths.length),
    kitNarrowShare: share(widths.filter((w) => w < KIT_NARROW).length, widths.length),
    wideShare: share(widths.filter((w) => w >= WIDE).length, widths.length),
    floorRun: summary(runs),
    floorRunBeyond700: share(runs.filter((v) => v > 700 * UNIT).length, runs.length),
    vertical: {
      levels: [...bins.values()].filter((c) => c / zs.length >= LEVEL_SHARE).length,
      range: round(zs[zs.length - 1] - zs[0], 1),
      range90: round(quantile(zs, 0.95) - quantile(zs, 0.05), 1),
      stacked: Math.max(...stacks.values()),
      stackedShare: share([...stacks.values()].filter((c) => c > 1).length, stacks.size),
    },
    openings: { count: openings.length, per100m: round((openings.length / pathLength) * 100, 2), width: openings.length ? summary(openings) : null },
    pathWidth: summary(pathWidths.filter((w) => w !== null)),
    crossing: { walk: round(pathLength, 1), straight: round(straight, 1), straight2d: round(dist2(first, last), 1), ratio: round(pathLength / straight, 2), extent: round(extent, 1), extentRatio: round(pathLength / extent, 2), winding100: windings.length ? summary(windings) : null, segments: L.segments.length, breaksPerKm: round((L.segments.length - 1) / km, 2) },
    span,
    loops: Object.fromEntries(loops.map((l, k) => [`tile${[256, 512][k]}`, l])),
    routes: {
      crossroads,
      markerCrossroads: markerCross,
      islandShare: share(islands.reduce((s, z) => s + zoneArea(z), 0), allZoneArea),
      roofShare: share(islands.filter((z) => z.roof).reduce((s, z) => s + zoneArea(z), 0), allZoneArea),
      islands: islands.length,
    },
    pacing: {
      zones: mainZones.length,
      bandWidth: summary(band), // m2 of zone per metre of path: the floor along the path, per metre
      bandCv: round(Math.sqrt(band.reduce((s, b) => s + (b - band.reduce((x, y) => x + y, 0) / band.length) ** 2, 0) / band.length) / (band.reduce((x, y) => x + y, 0) / band.length), 2),
      openSpaces: open.length,
      openSpacesPerKm: round(open.length / km, 2),
      openSpacing: openGaps.length ? summary(openGaps) : null,
      bossRoutes: bosses.length,
      bossAt: bosses.filter((b) => b.travel_dist !== null).map((b) => round(b.travel_dist / pathLength, 2)).sort((a, b) => a - b),
      patrolRoutes: patrols.length,
      patrolsPerKm: round(patrols.length / km, 2),
      events: Object.keys(ev).length,
      hordeEvents: hordeEvents.length,
      ledgesPer100m: round((ledges.length / pathLength) * 100, 2),
      ledgeDrop: ledges.length ? summary(ledges.filter((o) => o.pos1 && o.pos2).map((o) => Math.abs(o.pos1[2] - o.pos2[2]))) : null,
      jumpsPer100m: round((jumps.length / pathLength) * 100, 2),
      coverPer100m: round(((L.cover_points ?? 0) / pathLength) * 100, 2),
      roamingSets: [...new Set((L.markers ?? []).map((m) => m.roaming).filter(Boolean))].length,
    },
    times,
    _pool: { widths, runs },
  };
}

// ── all levels, and the bands ───────────────────────────────────────────────
const corpus = JSON.parse(readFileSync(join(OUT, "corpus.json"), "utf8"));
const want = process.argv.slice(2);
const started = Date.now();
const maps = [], failed = [];
for (const c of corpus) {
  if (want.length && !want.includes(c.key)) continue;
  const file = join(OUT, "levels", c.level.replace("levels/", "").replace("/world", "").replaceAll("/", "~") + ".json");
  if (!existsSync(file)) { failed.push({ name: c.key, why: "no level data" }); continue; }
  const L = JSON.parse(readFileSync(file, "utf8"));
  if (!L.nav || !L.segments) { failed.push({ name: c.key, why: "no navmesh or main path" }); continue; }
  try {
    const m = measureLevel(L);
    maps.push(m);
    console.error(`${m.name.padEnd(22)} places ${String(m.places).padStart(6)}  width ${m.width.median} m  narrow ${m.narrowShare}  path ${m.crossing.walk} m x${m.crossing.ratio}  loops ${m.loops.tile256.cycles}/${m.loops.tile512.cycles}  ${Object.values(m.times).reduce((a, b) => a + b, 0) / 1000}s`);
  } catch (e) {
    failed.push({ name: c.key, why: String(e) });
    console.error(c.key, "failed", e);
  }
}

const lengths = (b) => ({ m: b, ph: scaleBand(b, 1 / PLAYER) });
const ofMaps = (get, places = 2) => bandOf(maps.map(get), null, places);
const pooled = (key) => {
  const values = [], weights = [];
  for (const m of maps) for (const v of m._pool[key]) { values.push(v); weights.push(1 / m._pool[key].length); }
  return bandOf(values, weights);
};
const bands = {
  width: { ofMaps: lengths(ofMaps((m) => m.width.median)), pooled: lengths(pooled("widths")) },
  floorRun: { ofMaps: lengths(ofMaps((m) => m.floorRun.median)), pooled: lengths(pooled("runs")) },
  narrowShare: { ofMaps: ofMaps((m) => m.narrowShare, 3) },
  kitNarrowShare: { ofMaps: ofMaps((m) => m.kitNarrowShare, 3) },
  wideShare: { ofMaps: ofMaps((m) => m.wideShare, 3) },
  floorRunBeyond700Share: { ofMaps: ofMaps((m) => m.floorRunBeyond700, 3) },
  area: { ofMaps: { m2: ofMaps((m) => m.area, 0) } },
  reachedArea: { ofMaps: { m2: ofMaps((m) => m.reachedArea, 0) } },
  reachedShare: { ofMaps: ofMaps((m) => m.reachedShare, 3) },
  floorLevels: { ofMaps: ofMaps((m) => m.vertical.levels, 1) },
  floorRange: { ofMaps: lengths(ofMaps((m) => m.vertical.range, 1)) },
  floorRange90: { ofMaps: lengths(ofMaps((m) => m.vertical.range90, 1)) },
  stackedShare: { ofMaps: ofMaps((m) => m.vertical.stackedShare, 3) },
  pathWidth: { ofMaps: lengths(ofMaps((m) => m.pathWidth.median)) },
  openingWidth: { ofMaps: lengths(ofMaps((m) => m.openings.width?.median ?? null)) },
  openingsPer100m: { ofMaps: ofMaps((m) => m.openings.per100m, 2) },
  pathLength: { ofMaps: lengths(ofMaps((m) => m.crossing.walk, 0)) },
  pathStraight: { ofMaps: lengths(ofMaps((m) => m.crossing.straight, 0)) },
  pathRatio: { ofMaps: ofMaps((m) => m.crossing.ratio, 2) },
  pathExtent: { ofMaps: lengths(ofMaps((m) => m.crossing.extent, 0)) },
  pathExtentRatio: { ofMaps: ofMaps((m) => m.crossing.extentRatio, 2) },
  pathWinding100: { ofMaps: ofMaps((m) => m.crossing.winding100?.median ?? null, 2) },
  pathSegments: { ofMaps: ofMaps((m) => m.crossing.segments, 1) },
  breaksPerKm: { ofMaps: ofMaps((m) => m.crossing.breaksPerKm, 2) },
  span: { ofMaps: lengths(ofMaps((m) => m.span?.walk ?? null, 0)) },
  spanRatio: { ofMaps: ofMaps((m) => m.span?.ratio ?? null, 2) },
  loops256: { ofMaps: ofMaps((m) => m.loops.tile256.cycles, 1) },
  loops512: { ofMaps: ofMaps((m) => m.loops.tile512.cycles, 1) },
  loops512PerKm: { ofMaps: ofMaps((m) => m.loops.tile512.cycles / (m.crossing.walk / 1000), 2) },
  crossroads: { ofMaps: ofMaps((m) => m.routes.crossroads, 1) },
  islandShare: { ofMaps: ofMaps((m) => m.routes.islandShare, 3) },
  roofShare: { ofMaps: ofMaps((m) => m.routes.roofShare, 3) },
  bandWidth: { ofMaps: lengths(ofMaps((m) => m.pacing.bandWidth.median)) },
  bandCv: { ofMaps: ofMaps((m) => m.pacing.bandCv, 2) },
  openSpacesPerKm: { ofMaps: ofMaps((m) => m.pacing.openSpacesPerKm, 2) },
  openSpacing: { ofMaps: lengths(ofMaps((m) => m.pacing.openSpacing?.median ?? null, 0)) },
  bossRoutes: { ofMaps: ofMaps((m) => m.pacing.bossRoutes, 1) },
  patrolsPerKm: { ofMaps: ofMaps((m) => m.pacing.patrolsPerKm, 2) },
  events: { ofMaps: ofMaps((m) => m.pacing.events, 1) },
  hordeEvents: { ofMaps: ofMaps((m) => m.pacing.hordeEvents, 1) },
  ledgesPer100m: { ofMaps: ofMaps((m) => m.pacing.ledgesPer100m, 2) },
  ledgeDrop: { ofMaps: lengths(ofMaps((m) => m.pacing.ledgeDrop?.median ?? null)) },
  jumpsPer100m: { ofMaps: ofMaps((m) => m.pacing.jumpsPer100m, 2) },
  coverPer100m: { ofMaps: ofMaps((m) => m.pacing.coverPer100m, 2) },
};
for (const m of maps) delete m._pool;

const out = {
  game: "vt2",
  title: "Warhammer: Vermintide 2 (campaign levels)",
  made: new Date().toISOString().slice(0, 10),
  tool: "levels/tools/survey-vt2-extract.py, survey-vt2-nav.py, survey-vt2.py, survey-vt2-measure.mjs",
  what: "Measures and bands only: no geometry, navmesh, path, entity or level file of the game is in this file.",
  units: {
    length: `m; ph = m / ${PLAYER} (a player's height, taken as ${PLAYER} m: the heroes' first-person eyes stand 1.3-1.7 m, Kruber 1.65; the navmesh's AI is 1.6 m)`,
    area: "m2, projected on the level",
    narrow: `floor under ${NARROW} m wide (two player heights) is narrow; wide is ${WIDE} m (four) and over; the kit's corridor line is 176 units scaled to ${round(KIT_NARROW)} m`,
    grid: `places every ${round(GRID)} m (32 units scaled by player heights); lines walked ${round(FAR)} m at the most (3000 units)`,
  },
  source: "The floor is the game's navmesh (.navdata, Gameware Navigation), not solid geometry: width is to the floor's end (wall, drop or low obstacle), widened by the navmesh's radius at each end; floorRun is how far the floor runs, not sight; there is no headroom. The main path, zones, routes, ledges, jumps and events are the AI director's own baked data (world_spawn_zones, world_patrol_waypoints, world_smartobjects, terror_events Lua).",
  banding: "Each band is n, median, q1, q3, p5, p95 across levels, a level one vote: `ofMaps` bands each level's own median (or value); `pooled` bands every measured place of every level, each level's places weighing 1 in all.",
  counts: { found: corpus.length, measured: maps.length, failed: failed.length },
  runSeconds: Math.round((Date.now() - started) / 1000),
  bands,
  maps,
  failed,
};
if (!want.length) writeFileSync(join(REPO, "levels", "corpus", "levels-vt2.json"), JSON.stringify(out, null, 1) + "\n");
else console.log(JSON.stringify(maps, null, 1).slice(0, 4000));
