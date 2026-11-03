// City measures of one compiled GoldSrc role-play city: its streets and plazas, its buildings behind doors, its
// vertical layers and what joins them, how much it repeats itself, its light and its role-play furniture.
// MEASURES ONLY: nothing of the map is kept, only numbers (and counts of names by kind, never the names).
//
// It stands on goldsrc-level-measures.mjs's places: the walked floor on a grid of 32, each with its width,
// headroom and whether it is under open sky. `cityOf` is pure (synthetic places in, numbers out); `cityInputOf`
// turns a map read by the kit (readBsp, liftsOf) and its measured places into what `cityOf` takes.
//
//   streets    the floor under open sky (and, beside it, all public floor) cut into streets and plazas: each
//              part rasterised on the grid, thinned to its middle lines (Zhang-Suen), short spurs pruned; a
//              plaza is a patch 12 m wide or more both ways (aspect 3 or under, 150 m2 or more), a junction a
//              middle-line node of three ways or more; streets are the lines between nodes. Vehicle-wide:
//              4 m or more
//   buildings  the walked floor cut at the doors (func_door, func_door_rotating panels): the largest part is
//              the city's public floor; a part beside a door, mostly roofed and no larger than 2 500 m2 is a
//              room; rooms joined by a door no public floor touches are one building
//   layers     heights of 32 units holding 1 % of the floor or more, neighbours merged, kept at 2 %; joined
//              by stairs and ramps (places between two layers or stepping from one to another), lifts, ladders
//              and teleports. Spacing: the walk from each public place to the nearest of them
//   variety    rooms and buildings by footprint (a repeated shape), brush models by size and textures, the
//              world's textures per area, districts: 512-unit tiles of like texture palettes joined
//   light      the floor's light (lightmaps) on each walked place; the light entities' colours by hue
//   furniture  doors (named), switches, spawns, cells, lifts, teleports, ladders; hidden ways (a door
//              textured as the walls round it, func_wall_toggle, func_illusionary, a name that says so)
//
//   cityOf(input)                          the record (see the function)
//   cityInputOf(built, lifted, cells, o)   input from a map: `built` as read (repaired), `lifted` after liftsOf
//   CITY                                   the constants, in units
import { modelFaces, faceNormal, facePolygon, faceTexture } from "../../src/maps/bsp.mjs";
import { floorSamples, stylesCounted } from "../../src/maps/light.mjs";
import { textureKind } from "../../src/maps/miptex.mjs";
import { valueOf, brushModelOf, originOf, numberOf } from "../../src/maps/entities.mjs";

const UNIT_M = 0.0254;
const PLAYER_HEIGHT = 72;
export const CITY = {
  grid: 32,
  /** a street this wide (4 m) takes a vehicle */
  vehicle: 4 / UNIT_M,
  /** a plaza's places are this wide (12 m) or wider; the patch is 150 m2 or more, its box no longer than 3 to 1 */
  plazaWidth: 12 / UNIT_M,
  plazaLeastM2: 150,
  plazaAspectMost: 3,
  /** two neighbouring places on one floor differ in height this much at the most (a storey is more) */
  sameFloor: 56,
  /** a door's panel claims the places this far round it */
  doorPad: 20,
  /** a part cut off by doors under this many places is the doorway's own floor, not a room */
  roomLeastPlaces: 4,
  /** a room behind a door is no larger than this (a bigger part beyond a gate is public) and is half roofed */
  roomMostM2: 2500,
  roomRoofedLeast: 0.5,
  /** an apartment-sized building: this much floor */
  apartmentM2: [15, 150],
  layerBin: 32,
  layerKeep: 0.01,
  layerShare: 0.02,
  /** a lift, ladder or teleport serves the places this far round its box */
  connectorPad: 48,
  districtTile: 512,
  paletteShare: 0.7,
  paletteMost: 8,
  districtLikeness: 0.3,
  districtLeastTiles: 3,
  dark: 24,
  bright: 128,
};

// ── small arithmetic ────────────────────────────────────────────────────────
const round = (value, places = 0) =>
  value === null || value === undefined || !Number.isFinite(value) ? null : Number(value.toFixed(places));
const quantile = (sorted, share) => {
  if (!sorted.length) return null;
  const at = share * (sorted.length - 1);
  const low = Math.floor(at);
  const high = Math.min(sorted.length - 1, low + 1);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
};
/** median, quartiles, p10, p90 of a list (null when empty), rounded */
const spread = (list, places = 0) => {
  const s = list.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const q = (x) => round(quantile(s, x), places);
  return { n: s.length, median: q(0.5), q1: q(0.25), q3: q(0.75), p10: q(0.1), p90: q(0.9), most: round(s[s.length - 1], places) };
};
const m = (units) => (units == null ? null : units * UNIT_M);
const share = (part, all) => (all ? round(part / all, 3) : null);
/** a spread of lengths in units, given in metres */
const inMetres = (list) => spread(list.map(m), 2);

/** union-find over 0..n-1 */
function unions(n) {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i) => {
    while (parent[i] !== i) (parent[i] = parent[parent[i]]), (i = parent[i]);
    return i;
  };
  return { find, join: (a, b) => (parent[find(a)] = find(b)) };
}

// ── the places as a graph ───────────────────────────────────────────────────
const FOUR = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAGONALS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
/**
 * The places' neighbours: for each place, the place of each of the 8 neighbouring columns whose floor is
 * nearest its own and within `sameFloor`. `four[i]` and `diagonal[i]` are lists of indices.
 */
function graphOf(cells, grid, sameFloor) {
  const byColumn = new Map();
  cells.forEach((c, i) => {
    const key = `${c.at[0]},${c.at[1]}`;
    (byColumn.get(key) ?? byColumn.set(key, []).get(key)).push(i);
  });
  const nearest = (i, dx, dy) => {
    const c = cells[i];
    const list = byColumn.get(`${c.at[0] + dx * grid},${c.at[1] + dy * grid}`);
    if (!list) return -1;
    let best = -1;
    let bestDz = Infinity;
    for (const j of list) {
      const dz = Math.abs(cells[j].at[2] - c.at[2]);
      if (dz <= sameFloor && dz < bestDz) (best = j), (bestDz = dz);
    }
    return best;
  };
  const four = cells.map((_, i) => FOUR.map(([dx, dy]) => nearest(i, dx, dy)).filter((j) => j >= 0));
  const diagonal = cells.map((_, i) => DIAGONALS.map(([dx, dy]) => nearest(i, dx, dy)).filter((j) => j >= 0));
  return { four, diagonal, byColumn };
}

/** the parts of the places `keep(i)` says, joined four ways: an array of part numbers (-1 for others) and the parts */
function partsOf(cells, four, keep) {
  const part = new Int32Array(cells.length).fill(-1);
  const parts = [];
  for (let i = 0; i < cells.length; i++) {
    if (part[i] >= 0 || !keep(i)) continue;
    const id = parts.length;
    const list = [i];
    part[i] = id;
    for (let k = 0; k < list.length; k++)
      for (const j of four[list[k]]) if (part[j] < 0 && keep(j)) (part[j] = id), list.push(j);
    parts.push(list);
  }
  return { part, parts };
}

/** the walk over the places (8 ways, 32 or 45 a step) from every source at once: distance per place */
function walkFrom(cells, graph, grid, sources) {
  const far = new Float64Array(cells.length).fill(Infinity);
  const heap = [];
  const push = (d, i) => {
    heap.push([d, i]);
    for (let k = heap.length - 1; k > 0; ) {
      const up = (k - 1) >> 1;
      if (heap[up][0] <= heap[k][0]) break;
      [heap[up], heap[k]] = [heap[k], heap[up]];
      k = up;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ; ) {
        const a = 2 * k + 1;
        const b = a + 1;
        let low = k;
        if (a < heap.length && heap[a][0] < heap[low][0]) low = a;
        if (b < heap.length && heap[b][0] < heap[low][0]) low = b;
        if (low === k) break;
        [heap[low], heap[k]] = [heap[k], heap[low]];
        k = low;
      }
    }
    return top;
  };
  for (const i of sources) if (far[i] > 0) (far[i] = 0), push(0, i);
  const diag = grid * Math.SQRT2;
  while (heap.length) {
    const [d, i] = pop();
    if (d > far[i]) continue;
    for (const j of graph.four[i]) if (d + grid < far[j]) (far[j] = d + grid), push(far[j], j);
    for (const j of graph.diagonal[i]) if (d + diag < far[j]) (far[j] = d + diag), push(far[j], j);
  }
  return far;
}

// ── layers ──────────────────────────────────────────────────────────────────
/**
 * The floor's layers: heights of `layerBin` holding `layerKeep` of the places or more, neighbouring bins merged,
 * kept when the layer holds `layerShare`. `{ layers: [{ z, low, high, share }], layerOf: Int32Array }`, -1
 * for a place between layers.
 */
export function layersOf(cells, o = CITY) {
  const bins = new Map();
  for (const c of cells) {
    const b = Math.round(c.at[2] / o.layerBin);
    bins.set(b, (bins.get(b) ?? 0) + 1);
  }
  const kept = [...bins].filter(([, n]) => n / cells.length >= o.layerKeep).sort((a, b) => a[0] - b[0]);
  const groups = [];
  for (const [b, n] of kept) {
    const last = groups[groups.length - 1];
    if (last && b - last.highBin <= 1) (last.highBin = b), (last.n += n), (last.sum += b * o.layerBin * n);
    else groups.push({ lowBin: b, highBin: b, n, sum: b * o.layerBin * n });
  }
  const layers = groups
    .filter((g) => g.n / cells.length >= o.layerShare)
    .map((g) => ({
      z: Math.round(g.sum / g.n),
      low: g.lowBin * o.layerBin - o.layerBin / 2,
      high: g.highBin * o.layerBin + o.layerBin / 2,
      share: share(g.n, cells.length),
    }));
  const layerOf = new Int32Array(cells.length).fill(-1);
  cells.forEach((c, i) => {
    const k = layers.findIndex((l) => c.at[2] >= l.low && c.at[2] < l.high);
    layerOf[i] = k;
  });
  return { layers, layerOf };
}

// ── streets: middle lines of a part of the floor ────────────────────────────
/** Zhang-Suen thinning of a 0/1 raster with a zero border, in place */
function thin(img, w, h) {
  const ring = (i) => [img[i - w], img[i - w + 1], img[i + 1], img[i + w + 1], img[i + w], img[i + w - 1], img[i - 1], img[i - w - 1]]; // prettier-ignore
  for (let changed = true; changed; ) {
    changed = false;
    for (const step of [0, 1]) {
      const gone = [];
      for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!img[i]) continue;
          const [p2, p3, p4, p5, p6, p7, p8, p9] = ring(i);
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          if (transitions([p2, p3, p4, p5, p6, p7, p8, p9]) !== 1) continue;
          if (step === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
          gone.push(i);
        }
      for (const i of gone) img[i] = 0;
      if (gone.length) changed = true;
    }
  }
}
/** 0 to 1 changes round a pixel's eight neighbours, in order */
const transitions = (ring) => {
  let a = 0;
  for (let k = 0; k < 8; k++) if (!ring[k] && ring[(k + 1) % 8]) a++;
  return a;
};
const EIGHT = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

/**
 * The street network of some places (each part rasterised in plan; where a part lies over itself the lower
 * floor is kept). `{ area, width, vehicleShare, plazas, junctions, streets, deadEnds, ... }` in metres.
 */
export function networkOf(cells, list, four, o = CITY) {
  const grid = o.grid;
  const inList = new Uint8Array(cells.length);
  for (const i of list) inList[i] = 1;
  const { parts } = partsOf(cells, four, (i) => inList[i] === 1);
  const plazaAreas = [];
  const between = [];
  const deadEndLengths = [];
  const allStreets = [];
  let junctions = 0;
  let vehicleLength = 0;
  let streetLength = 0;
  const pxM2 = (grid * UNIT_M) ** 2;
  for (const part of parts) {
    if (part.length < 3) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; // prettier-ignore
    for (const i of part) {
      const [x, y] = cells[i].at;
      x0 = Math.min(x0, x), y0 = Math.min(y0, y), x1 = Math.max(x1, x), y1 = Math.max(y1, y); // prettier-ignore
    }
    const w = Math.round((x1 - x0) / grid) + 3;
    const h = Math.round((y1 - y0) / grid) + 3;
    const img = new Uint8Array(w * h);
    const widthAt = new Float64Array(w * h);
    const zAt = new Float64Array(w * h).fill(Infinity);
    for (const i of part) {
      const c = cells[i];
      const p = (Math.round((c.at[1] - y0) / grid) + 1) * w + Math.round((c.at[0] - x0) / grid) + 1;
      if (c.at[2] >= zAt[p]) continue;
      zAt[p] = c.at[2];
      img[p] = 1;
      widthAt[p] = c.width;
    }
    const full = img.slice();
    // the plazas: patches of wide places, broad both ways
    const plazaOf = new Int32Array(w * h).fill(-1);
    const seen = new Uint8Array(w * h);
    const plazaIds = [];
    for (let p = 0; p < w * h; p++) {
      if (!full[p] || seen[p] || widthAt[p] < o.plazaWidth) continue;
      const patch = [p];
      seen[p] = 1;
      for (let k = 0; k < patch.length; k++) {
        const q = patch[k];
        const qx = q % w;
        const qy = (q / w) | 0;
        for (const [dx, dy] of EIGHT) {
          const r = (qy + dy) * w + qx + dx;
          if (full[r] && !seen[r] && widthAt[r] >= o.plazaWidth) (seen[r] = 1), patch.push(r);
        }
      }
      const xs = patch.map((q) => q % w);
      const ys = patch.map((q) => (q / w) | 0);
      const long = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 1;
      const short = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 1;
      if (patch.length * pxM2 < o.plazaLeastM2 || long / short > o.plazaAspectMost) continue;
      const id = plazaIds.length;
      plazaIds.push(patch.length);
      for (const q of patch) plazaOf[q] = id;
      plazaAreas.push(patch.length * pxM2);
    }
    thin(img, w, h);
    const around = (p) => EIGHT.map(([dx, dy]) => p + dy * w + dx);
    const count = (p) => around(p).reduce((s, q) => s + img[q], 0);
    // spurs: a line from an end to a branch shorter than half the street's width there, twice over
    for (let pass = 0; pass < 2; pass++) {
      for (let p = 0; p < w * h; p++) {
        if (!img[p] || count(p) !== 1) continue;
        const path = [p];
        const onPath = new Set(path);
        let cur = p;
        let branch = -1;
        for (;;) {
          const next = around(cur).filter((q) => img[q] && !onPath.has(q));
          if (cur !== p && count(cur) >= 3) {
            branch = cur;
            break;
          }
          if (next.length !== 1) {
            if (next.length >= 2) branch = cur;
            break;
          }
          cur = next[0];
          path.push(cur);
          onPath.add(cur);
          if (path.length > 64) break;
        }
        if (branch < 0) continue;
        const limit = Math.max(3, Math.round(widthAt[branch] / grid / 2) + 1);
        const spur = path.filter((q) => q !== branch);
        if (spur.length <= limit) for (const q of spur) img[q] = 0;
      }
    }
    // the nodes: where three ways or more meet, and every middle line inside a plaza (one node a plaza)
    const nodeOf = new Int32Array(w * h).fill(-1);
    const nodes = []; // { plaza }
    for (let i = 0; i < plazaIds.length; i++) nodes.push({ plaza: true });
    for (let p = 0; p < w * h; p++) {
      if (!img[p]) continue;
      if (plazaOf[p] >= 0) nodeOf[p] = plazaOf[p];
    }
    for (let p = 0; p < w * h; p++) {
      if (!img[p] || nodeOf[p] >= 0) continue;
      if (transitions(around(p).map((q) => img[q])) < 3) continue;
      // a node of its own, or joined to a node beside it
      const near = around(p).map((q) => nodeOf[q]).filter((n) => n >= 0);
      nodeOf[p] = near.length ? near[0] : nodes.push({ plaza: false }) - 1;
    }
    // a node takes the middle-line pixels round it, so the ways leaving it do not touch one another there
    const grown = [];
    for (let p = 0; p < w * h; p++)
      if (nodeOf[p] >= 0 && !nodes[nodeOf[p]].plaza) for (const q of around(p)) if (img[q] && nodeOf[q] < 0) grown.push([q, nodeOf[p]]);
    for (const [q, n] of grown) if (nodeOf[q] < 0) nodeOf[q] = n;
    // nodes touching are one (a thick crossing leaves a clump)
    const u = unions(nodes.length);
    for (let p = 0; p < w * h; p++)
      if (nodeOf[p] >= 0) for (const q of around(p)) if (nodeOf[q] >= 0 && nodeOf[q] !== nodeOf[p]) {
        const a = nodeOf[p];
        const b = nodeOf[q];
        // a plaza swallows a node beside it; two plazas stay two
        if (nodes[a].plaza && nodes[b].plaza) continue;
        u.join(a, b);
      }
    const rootOf = (n) => {
      // a plaza's node is the root of its group, whichever way the joins went
      const r = u.find(n);
      return r;
    };
    const groupPlaza = new Map();
    nodes.forEach((node, n) => {
      if (node.plaza) groupPlaza.set(rootOf(n), true);
    });
    // the segments: middle lines between nodes
    const segOf = new Int32Array(w * h).fill(-1);
    const edges = []; // { ends: [node or free], length (px), widths }
    for (let p = 0; p < w * h; p++) {
      if (!img[p] || nodeOf[p] >= 0 || segOf[p] >= 0) continue;
      const id = edges.length;
      const pixels = [p];
      segOf[p] = id;
      for (let k = 0; k < pixels.length; k++)
        for (const q of around(pixels[k])) if (img[q] && nodeOf[q] < 0 && segOf[q] < 0) (segOf[q] = id), pixels.push(q);
      let length = 0;
      const touched = new Set();
      for (const q of pixels) {
        const qx = q % w;
        const qy = (q / w) | 0;
        for (const [dx, dy] of EIGHT) {
          const r = (qy + dy) * w + qx + dx;
          if (nodeOf[r] >= 0) touched.add(rootOf(nodeOf[r]));
          if (segOf[r] !== id || r < q) continue;
          if (dx && dy) {
            if (segOf[qy * w + qx + dx] === id || segOf[(qy + dy) * w + qx] === id) continue;
            length += Math.SQRT2;
          } else length += 1;
        }
      }
      const ends = [...touched];
      length += 2 * ends.length; // the steps onto each node
      while (ends.length < 2) ends.push(`free${id}.${ends.length}`);
      edges.push({ ends: ends.slice(0, 2), length, widths: pixels.map((q) => widthAt[q]) });
    }
    // two nodes joined by a line shorter than the street is wide are one crossing (the thinning splits a
    // wide crossing into two nodes a step apart); a plaza keeps its own node
    const up = new Map();
    const top = (n) => {
      while (up.has(n)) n = up.get(n);
      return n;
    };
    for (const e of edges) {
      const [a, b] = e.ends.map(top);
      if (typeof a === "string" || typeof b === "string" || a === b) continue;
      const widths = e.widths.slice().sort((x, y) => x - y);
      if (e.length * grid >= (quantile(widths, 0.5) ?? 0)) continue;
      if (groupPlaza.has(a) && groupPlaza.has(b)) continue;
      if (groupPlaza.has(a)) up.set(b, a);
      else up.set(a, b);
      e.gone = true;
    }
    for (const e of edges) e.ends = e.ends.map(top);
    for (const e of edges) if (!e.gone && e.ends[0] === e.ends[1] && typeof e.ends[0] !== "string" && e.length * grid < 4 * o.grid) e.gone = true; // prettier-ignore
    // two-way nodes are no junction: their two lines are one street
    const degree = new Map();
    const touch = (n, d) => degree.set(n, (degree.get(n) ?? 0) + d);
    for (const e of edges) if (!e.gone) for (const n of e.ends) touch(n, 1);
    let merged = true;
    while (merged) {
      merged = false;
      for (const [n, d] of degree) {
        if (d !== 2 || typeof n === "string" || groupPlaza.has(n)) continue;
        const two = edges.filter((e) => !e.gone && e.ends.includes(n));
        if (two.length !== 2) continue;
        const [a, b] = two;
        const far = (e) => (e.ends[0] === n ? e.ends[1] : e.ends[0]);
        const joined = { ends: [far(a), far(b)], length: a.length + b.length, widths: [...a.widths, ...b.widths] };
        a.gone = b.gone = true;
        edges.push(joined);
        degree.delete(n);
        merged = true;
        break;
      }
    }
    const live = edges.filter((e) => !e.gone);
    const junctionNodes = [...degree].filter(([n, d]) => typeof n !== "string" && !groupPlaza.has(n) && d >= 3);
    junctions += junctionNodes.length;
    const isNode = (n) => typeof n !== "string" && (groupPlaza.has(n) || (degree.get(n) ?? 0) >= 3);
    for (const e of live) {
      const units = e.length * grid;
      const widths = e.widths.slice().sort((a, b) => a - b);
      const width = quantile(widths, 0.5) ?? 0;
      streetLength += units;
      if (width >= o.vehicle) vehicleLength += units;
      allStreets.push({ units, width });
      const nodeEnds = e.ends.filter(isNode).length;
      if (nodeEnds === 2) between.push(units);
      else if (nodeEnds === 1) deadEndLengths.push(units);
    }
  }
  const widths = list.map((i) => cells[i].width);
  const area = list.length * pxM2;
  return {
    places: list.length,
    areaM2: Math.round(area),
    width: inMetres(widths),
    vehicleShare: share(widths.filter((x) => x >= o.vehicle).length, widths.length),
    pedestrianShare: share(widths.filter((x) => x < o.vehicle).length, widths.length),
    plazas: plazaAreas.length,
    plazaM2: spread(plazaAreas),
    plazaShare: share(plazaAreas.reduce((s, a) => s + a, 0), area),
    junctions,
    junctionsPerHa: area ? round(junctions / (area / 10000), 2) : null,
    streets: allStreets.length,
    streetLengthM: round(m(streetLength), 0),
    vehicleStreetShare: streetLength ? share(vehicleLength, streetLength) : null,
    streetWidth: inMetres(allStreets.map((s) => s.width)),
    betweenJunctions: inMetres(between),
    deadEnds: deadEndLengths.length,
    deadEndLength: inMetres(deadEndLengths),
  };
}

// ── names ───────────────────────────────────────────────────────────────────
/** what a door's name says the building behind it is, first match wins */
export const NAMED = [
  ["jail", /cell|jail|prison|brig|holding/],
  ["hideout", /hideout|hide|secret|stash|safe\b|safehouse/],
  ["home", /resident|apt|apartment|flat|house|home|citizen|condo|estate|suite|bed|dorm|lux|hab\b|habblock|room\d/],
  ["shop", /shop|store|market|bar\b|bar\d|club|cafe|diner|restaurant|noodle|steak|gun|ammo|pawn|gear|dealer|garage|kiosk|food|booth|broth|casino|hotel|tshop|storage/],
  ["public", /police|cop|^cp|_cp|station|hospital|clinic|surgery|operating|med|bank|hall|court|office|lab|admin|mayor|city|church|school|gov|news|hq|datacom|armou?ry|barracks|control|core|research|maint|vault|tech|recep/],
];
export const kindOfName = (name) => {
  if (!name) return "unnamed";
  const lower = name.toLowerCase();
  for (const [kind, rule] of NAMED) if (rule.test(lower)) return kind;
  return "other";
};
const HIDDEN_NAME = /secret|hidden|hideout|stash/;

// ── light colours ───────────────────────────────────────────────────────────
/** a light's colour as a hue band: white (pale), red, orange, yellow, green, cyan, blue, purple */
export function hueOf([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max <= 0) return "white";
  const sat = (max - min) / max;
  if (sat < 0.2) return "white";
  let h;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h = (h * 60 + 360) % 360;
  if (h < 20 || h >= 330) return "red";
  if (h < 45) return "orange";
  if (h < 70) return "yellow";
  if (h < 160) return "green";
  if (h < 200) return "cyan";
  if (h < 260) return "blue";
  return "purple";
}
const WARM = new Set(["red", "orange", "yellow"]);
const COOL = new Set(["green", "cyan", "blue", "purple"]);

// ── the record ──────────────────────────────────────────────────────────────
/**
 * A city's record. `input`:
 *   cells       [{ at: [x, y, floor], width, headroom, sky, light? }]: the walked places on the grid
 *   doors       [{ min, max, name, disguised? }]: doorway panels (boxes in the map)
 *   connectors  [{ kind: "lift" | "ladder" | "teleport", min, max }]
 *   lights      [{ rgb: [r, g, b] }]: light entities' colours (the sky's apart: `sky: true`)
 *   faces       [{ texture, at: [x, y, z], area }]: the world's faces, tools and sky left out
 *   models      [{ size: [x, y, z], textures: [names] }]: brush models of fixed scenery and doors
 *   entities    [{ classname, name }]
 *   lifts       liftsOf's counts, when known
 *   detail      true: the record also carries `detail`, the cut itself (each place's part and door node, the
 *               rooms, the buildings' rooms and door nodes, the layers), for a per-room survey. Nothing else
 *               of the record changes
 */
export function cityOf(input, o = CITY) {
  const { cells, doors = [], connectors = [], lights = [], faces = [], models = [], entities = [] } = input;
  const grid = o.grid;
  const pxM2 = (grid * UNIT_M) ** 2;
  if (!cells?.length) throw new Error("cityOf: no walked places");
  const graph = graphOf(cells, grid, o.sameFloor);
  const { layers, layerOf } = layersOf(cells, o);

  // ── doors cut the floor ──
  const doorOf = new Int32Array(cells.length).fill(-1);
  doors.forEach((d, k) => {
    for (let x = Math.ceil((d.min[0] - o.doorPad) / grid) * grid; x <= d.max[0] + o.doorPad; x += grid)
      for (let y = Math.ceil((d.min[1] - o.doorPad) / grid) * grid; y <= d.max[1] + o.doorPad; y += grid)
        for (const i of graph.byColumn.get(`${x},${y}`) ?? [])
          if (cells[i].at[2] >= d.min[2] - 24 && cells[i].at[2] <= d.min[2] + 40) doorOf[i] = k;
  });
  let isDoor = (i) => doorOf[i] >= 0;
  let { part, parts } = partsOf(cells, graph.four, (i) => !isDoor(i));
  // the doorway's own floor (a sliver between a door and its frame) is the door's
  const tiny = new Uint8Array(cells.length);
  for (const list of parts) if (list.length < o.roomLeastPlaces) for (const i of list) tiny[i] = 1;
  isDoor = (i) => doorOf[i] >= 0 || tiny[i] === 1;
  ({ part, parts } = partsOf(cells, graph.four, (i) => !isDoor(i)));
  const largest = parts.reduce((best, list, id) => (best < 0 || list.length > parts[best].length ? id : best), -1);
  // door nodes: door floor joined, what parts each touches, the names it carries
  const { part: doorNode, parts: doorNodes } = partsOf(cells, graph.four, isDoor);
  const doorTouches = doorNodes.map((list) => {
    const touches = new Set();
    const names = new Set();
    const panels = new Set();
    for (const i of list) {
      if (doorOf[i] >= 0) panels.add(doorOf[i]);
      for (const j of graph.four[i]) if (part[j] >= 0) touches.add(part[j]);
    }
    for (const k of panels) names.add(doors[k].name ?? null);
    return { touches, names: [...names], panels: [...panels] };
  });
  const roofedShare = (list) => list.filter((i) => !cells[i].sky).length / list.length;
  const doorsOfPart = parts.map(() => []);
  doorTouches.forEach((d, n) => d.touches.forEach((p) => doorsOfPart[p].push(n)));
  const isRoom = parts.map(
    (list, id) =>
      id !== largest &&
      doorsOfPart[id].length > 0 &&
      roofedShare(list) >= o.roomRoofedLeast &&
      list.length * pxM2 <= o.roomMostM2,
  );
  const publicCell = (i) => part[i] >= 0 && !isRoom[part[i]];
  // rooms joined by a door that touches no public floor are one building
  const u = unions(parts.length);
  for (const d of doorTouches) {
    const rooms = [...d.touches].filter((p) => isRoom[p]);
    if (rooms.length < 2 || [...d.touches].some((p) => !isRoom[p])) continue;
    for (let k = 1; k < rooms.length; k++) u.join(rooms[0], rooms[k]);
  }
  const groups = new Map();
  parts.forEach((_, id) => {
    if (!isRoom[id]) return;
    const r = u.find(id);
    (groups.get(r) ?? groups.set(r, []).get(r)).push(id);
  });
  // the street layer: the layer with the most public floor under the sky, else the most public floor
  const layerCount = (test) => layers.map((_, k) => cells.filter((c, i) => layerOf[i] === k && test(i)).length);
  const skyCounts = layerCount((i) => publicCell(i) && cells[i].sky);
  const publicCounts = layerCount(publicCell);
  const pickMost = (counts) => counts.reduce((best, n, k) => (best < 0 || n > counts[best] ? k : best), -1);
  const streetLayer = skyCounts.some((n) => n > 0) ? pickMost(skyCounts) : pickMost(publicCounts);
  const relLayer = (k) => (k < 0 || streetLayer < 0 ? "between" : String(k - streetLayer));

  const roomGroups = [...groups.values()];
  const buildings = roomGroups.map((rooms) => {
    const list = rooms.flatMap((id) => parts[id]);
    const zs = list.map((i) => cells[i].at[2]).sort((a, b) => a - b);
    const z = quantile(zs, 0.5);
    const k = layers.findIndex((l) => z >= l.low && z < l.high);
    const doorIds = [...new Set(rooms.flatMap((id) => doorsOfPart[id]))];
    const names = doorIds.flatMap((n) => doorTouches[n].names).filter(Boolean);
    const kinds = names.map(kindOfName);
    const kind = ["jail", "hideout", "home", "shop", "public", "other"].find((x) => kinds.includes(x)) ?? "unnamed";
    const entered = doorIds.some((n) => [...doorTouches[n].touches].some((p) => !isRoom[p]));
    // a footprint: the box in places (sorted sides) and the place count, rounded
    const xs = list.map((i) => cells[i].at[0]);
    const ys = list.map((i) => cells[i].at[1]);
    const sides = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)].map((s) => Math.round(s / grid) + 1).sort((a, b) => a - b); // prettier-ignore
    const roomShapes = rooms
      .map((id) => {
        const rx = parts[id].map((i) => cells[i].at[0]);
        const ry = parts[id].map((i) => cells[i].at[1]);
        const s = [Math.max(...rx) - Math.min(...rx), Math.max(...ry) - Math.min(...ry)].map((v) => Math.round(v / grid) + 1).sort((a, b) => a - b); // prettier-ignore
        return `${s.join("x")}:${Math.round(parts[id].length / 2)}`;
      })
      .sort();
    return {
      rooms: rooms.length,
      roomAreas: rooms.map((id) => parts[id].length * pxM2),
      area: list.length * pxM2,
      layer: relLayer(k),
      kind,
      entered,
      shape: `${sides.join("x")}:${Math.round(list.length / 4)}`,
      roomShapes,
    };
  });

  // ── connectors: stairs and ramps between layers, lifts, ladders, teleports ──
  const isLink = (i) => layerOf[i] < 0 || graph.four[i].some((j) => layerOf[j] !== layerOf[i] && layerOf[j] >= 0);
  const { parts: linkParts } = partsOf(cells, graph.four, isLink);
  const stairs = [];
  for (const list of linkParts) {
    const touched = new Set();
    for (const i of list) {
      if (layerOf[i] >= 0) touched.add(layerOf[i]);
      for (const j of graph.four[i]) if (layerOf[j] >= 0) touched.add(layerOf[j]);
    }
    if (touched.size >= 2) stairs.push({ kind: "stairs", cells: list, layers: [...touched] });
  }
  const placed = connectors.map((c) => {
    const list = [];
    for (let x = Math.ceil((c.min[0] - o.connectorPad) / grid) * grid; x <= c.max[0] + o.connectorPad; x += grid)
      for (let y = Math.ceil((c.min[1] - o.connectorPad) / grid) * grid; y <= c.max[1] + o.connectorPad; y += grid)
        for (const i of graph.byColumn.get(`${x},${y}`) ?? [])
          if (cells[i].at[2] >= c.min[2] - 24 - PLAYER_HEIGHT && cells[i].at[2] <= c.max[2] + 24) list.push(i);
    return { kind: c.kind, cells: list, layers: [...new Set(list.map((i) => layerOf[i]).filter((k) => k >= 0))] };
  });
  const allLinks = [...stairs, ...placed.filter((c) => c.cells.length)];
  const sources = new Set(allLinks.flatMap((c) => c.cells));
  const far = sources.size ? walkFrom(cells, graph, grid, sources) : null;
  const publicList = [];
  for (let i = 0; i < cells.length; i++) if (publicCell(i)) publicList.push(i);
  const toLink = far ? publicList.map((i) => far[i]).filter(Number.isFinite) : [];
  const joins = new Set();
  const joinsBy = {};
  for (const c of allLinks) {
    const ks = c.layers.slice().sort((a, b) => a - b);
    for (let a = 0; a < ks.length; a++)
      for (let b = a + 1; b < ks.length; b++) {
        joins.add(`${ks[a]}-${ks[b]}`);
        joinsBy[c.kind] = (joinsBy[c.kind] ?? 0) + 1;
      }
  }
  const walked = cells.length * pxM2;
  const kindCount = (k) => allLinks.filter((c) => c.kind === k).length;

  // ── streets ──
  const skyPublic = publicList.filter((i) => cells[i].sky);
  const streets = { ...networkOf(cells, skyPublic, graph.four, o) };
  const publicWays = networkOf(cells, publicList, graph.four, o);

  // ── variety ──
  const repeats = (signatures) => {
    const counts = new Map();
    for (const s of signatures) counts.set(s, (counts.get(s) ?? 0) + 1);
    const repeated = signatures.filter((s) => counts.get(s) > 1).length;
    return { n: signatures.length, shapes: counts.size, repeatedShare: share(repeated, signatures.length), mostOfOne: counts.size ? Math.max(...counts.values()) : 0 }; // prettier-ignore
  };
  const roomSignatures = buildings.flatMap((b) => b.roomShapes);
  const modelSignatures = models.map((md) => `${md.size.map((v) => Math.round(v / 2) * 2).join("x")}|${[...new Set(md.textures)].sort().join(",")}`); // prettier-ignore
  const textures = new Set(faces.map((f) => f.texture));
  // districts: tiles of the floor's plan, each with its palette (the textures covering most of its faces)
  const tile = o.districtTile;
  const tiles = new Map();
  for (const c of cells) {
    const key = `${Math.floor(c.at[0] / tile)},${Math.floor(c.at[1] / tile)}`;
    if (!tiles.has(key)) tiles.set(key, new Map());
  }
  for (const f of faces) {
    const key = `${Math.floor(f.at[0] / tile)},${Math.floor(f.at[1] / tile)}`;
    const t = tiles.get(key);
    if (t) t.set(f.texture, (t.get(f.texture) ?? 0) + f.area);
  }
  const palettes = new Map();
  for (const [key, t] of tiles) {
    const sorted = [...t].sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((s, [, a]) => s + a, 0);
    const palette = new Set();
    let run = 0;
    for (const [name, a] of sorted) {
      if (palette.size >= o.paletteMost || (total && run / total >= o.paletteShare)) break;
      palette.add(name);
      run += a;
    }
    if (palette.size) palettes.set(key, { palette, textures: t.size });
  }
  const keys = [...palettes.keys()];
  const index = new Map(keys.map((k, n) => [k, n]));
  const du = unions(keys.length);
  const likeness = (a, b) => {
    let both = 0;
    for (const x of a) if (b.has(x)) both++;
    return both / (a.size + b.size - both);
  };
  for (const key of keys) {
    const [tx, ty] = key.split(",").map(Number);
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const other = `${tx + dx},${ty + dy}`;
      if (!palettes.has(other)) continue;
      if (likeness(palettes.get(key).palette, palettes.get(other).palette) >= o.districtLikeness) du.join(index.get(key), index.get(other));
    }
  }
  const districtTiles = new Map();
  keys.forEach((k, n) => districtTiles.set(du.find(n), (districtTiles.get(du.find(n)) ?? 0) + 1));
  const tileM2 = (tile * UNIT_M) ** 2;
  const districts = [...districtTiles.values()].filter((n) => n >= o.districtLeastTiles);

  // ── light ──
  const lit = cells.filter((c) => Number.isFinite(c.light));
  const lightOf = (list) => {
    const values = list.map((c) => c.light).filter(Number.isFinite);
    if (!values.length) return null;
    return {
      ...spread(values, 1),
      mean: round(values.reduce((s, v) => s + v, 0) / values.length, 1),
      darkShare: share(values.filter((v) => v < o.dark).length, values.length),
      brightShare: share(values.filter((v) => v >= o.bright).length, values.length),
    };
  };
  const roomCells = cells.filter((c, i) => part[i] >= 0 && isRoom[part[i]]);
  const hues = {};
  const lamps = lights.filter((l) => !l.sky);
  for (const l of lamps) {
    const h = hueOf(l.rgb);
    hues[h] = (hues[h] ?? 0) + 1;
  }

  // ── furniture ──
  const classCount = (re) => entities.filter((e) => re.test(e.classname ?? "")).length;
  const doorEntities = entities.filter((e) => /^(func_door|func_door_rotating|momentary_door)$/.test(e.classname ?? ""));
  const namedDoors = doorEntities.filter((e) => e.name);
  const doorKinds = {};
  for (const e of namedDoors) {
    const k = kindOfName(e.name);
    doorKinds[k] = (doorKinds[k] ?? 0) + 1;
  }
  const lifts = input.lifts ?? {};

  const count = (list, f) => list.filter(f).length;
  const byLayer = {};
  for (const b of buildings) byLayer[b.layer] = (byLayer[b.layer] ?? 0) + 1;
  const byKind = {};
  for (const b of buildings) byKind[b.kind] = (byKind[b.kind] ?? 0) + 1;
  const publicArea = publicList.length * pxM2;
  // asked with `input.detail`: the cut itself, for a tool measuring each room (levels/tools/survey-rp-rooms.mjs);
  // indices into `cells`, `doors` and the parts, never written to a corpus as such
  const detail = input.detail
    ? {
        part, // each place's part (-1: door floor)
        parts, // each part's places
        isRoom, // each part: a room
        publicPart: largest, // the largest part: the city's public floor
        doorNode, // each place's door node (-1: none)
        doorNodes: doorTouches.map((d, n) => ({ places: doorNodes[n], panels: d.panels, touches: [...d.touches], names: d.names })),
        buildings: roomGroups.map((rooms, k) => ({
          rooms,
          doorNodes: [...new Set(rooms.flatMap((id) => doorsOfPart[id]))],
          kind: buildings[k].kind,
          entered: buildings[k].entered,
          layer: buildings[k].layer,
        })),
        layers,
        layerOf,
        streetLayer,
      }
    : null;
  return {
    ...(detail ? { detail } : {}),
    grid,
    walkedM2: Math.round(walked),
    publicM2: Math.round(publicArea),
    publicShare: share(publicList.length, cells.length),
    publicRoofedShare: share(count(publicList, (i) => !cells[i].sky), publicList.length),
    streets, // the public floor under open sky
    publicWays, // all public floor, roofed or not
    buildings: {
      count: buildings.length,
      entered: count(buildings, (b) => b.entered),
      perHa: walked ? round(buildings.length / (walked / 10000), 2) : null,
      rooms: buildings.reduce((s, b) => s + b.rooms, 0),
      roomsPerBuilding: spread(buildings.map((b) => b.rooms), 1),
      roomM2: spread(buildings.flatMap((b) => b.roomAreas), 1),
      buildingM2: spread(buildings.map((b) => b.area), 1),
      apartmentSized: count(buildings, (b) => b.area >= o.apartmentM2[0] && b.area <= o.apartmentM2[1]),
      byLayer,
      byKind,
      roomShare: share(roomCells.length, cells.length),
    },
    layers: {
      count: layers.length,
      heights: layers.map((l) => round(m(l.z - (layers[streetLayer]?.z ?? 0)), 2)), // metres over the street layer
      shares: layers.map((l) => l.share),
      street: streetLayer,
      span: layers.length ? round(m(layers[layers.length - 1].z - layers[0].z), 2) : 0,
      connectors: { stairs: kindCount("stairs"), lift: kindCount("lift"), ladder: kindCount("ladder"), teleport: kindCount("teleport") }, // prettier-ignore
      connectorsPerHa: walked ? round(allLinks.length / (walked / 10000), 2) : null,
      layerPairsJoined: joins.size,
      joinsBy,
      toConnector: inMetres(toLink),
      unreachedShare: far ? share(publicList.length - toLink.length, publicList.length) : null,
    },
    variety: {
      rooms: repeats(roomSignatures),
      buildings: repeats(buildings.map((b) => `${b.shape}|${b.roomShapes.join(";")}`)),
      brushModels: repeats(modelSignatures),
      textures: textures.size,
      texturesPerHa: walked ? round(textures.size / (walked / 10000), 1) : null,
      districts: districts.length,
      districtM2: spread(districts.map((n) => n * tileM2)),
      districtTileShare: share(districts.reduce((s, n) => s + n, 0), keys.length),
      texturesPerTile: spread([...palettes.values()].map((p) => p.textures)),
      palettePerTile: spread([...palettes.values()].map((p) => p.palette.size)),
    },
    light: {
      floor: lightOf(lit),
      public: lightOf(publicList.map((i) => cells[i])),
      rooms: lightOf(roomCells),
      lights: lamps.length,
      lightsPerHa: walked ? round(lamps.length / (walked / 10000), 1) : null,
      hues,
      warmShare: share(lamps.filter((l) => WARM.has(hueOf(l.rgb))).length, lamps.length),
      coolShare: share(lamps.filter((l) => COOL.has(hueOf(l.rgb))).length, lamps.length),
      whiteShare: share(lamps.filter((l) => hueOf(l.rgb) === "white").length, lamps.length),
    },
    furniture: {
      doors: doorEntities.length,
      namedDoors: namedDoors.length,
      doorNames: new Set(namedDoors.map((e) => e.name)).size,
      doorKinds,
      doorways: doors.length,
      switches: classCount(/^(func_button|func_rot_button|momentary_rot_button)$/),
      spawns: classCount(/^(info_player_deathmatch|info_player_start|info_player_team\d*|info_ts_spawn.*)$/),
      cells: count(doorEntities, (e) => e.name && kindOfName(e.name) === "jail"),
      jails: byKind.jail ?? 0,
      lifts: (lifts.plats ?? 0) + (lifts.platrots ?? 0) + (lifts.doors ?? 0) + (lifts.trains ?? 0),
      trains: classCount(/^(func_train|func_tracktrain)$/),
      teleports: classCount(/^trigger_teleport$/),
      ladders: classCount(/^func_ladder$/),
      wallToggles: classCount(/^func_wall_toggle$/),
      illusionary: classCount(/^func_illusionary$/),
      disguisedDoors: count(doors, (d) => d.disguised),
      hiddenNames: count(entities, (e) => e.name && HIDDEN_NAME.test(e.name.toLowerCase())),
      breakables: classCount(/^func_breakable$/),
      props: classCount(/^(ts_model|cycler|cycler_sprite|monster_furniture|monster_generic|env_model)$/),
      sounds: classCount(/^(ambient_generic|env_sound)$/),
    },
  };
}

// ── from a map ──────────────────────────────────────────────────────────────
const DOOR = /^(func_door|func_door_rotating|momentary_door)$/;
const TOOL = /^(aaa|clip|null|origin|hint|skip|trigger|bevel|sky$|solidhint|black_hidden)/i;
const SCENERY = /^(func_wall|func_illusionary|func_breakable|func_wall_toggle|func_door|func_door_rotating)$/;
const DOORLIKE = /door|gate|lift|elev|hatch|shutter|garage|metal|lab_|blast/i;
const areaOf = (points) => {
  const sum = [0, 0, 0];
  for (let k = 0; k < points.length; k++) {
    const a = points[k];
    const b = points[(k + 1) % points.length];
    sum[0] += a[1] * b[2] - a[2] * b[1];
    sum[1] += a[2] * b[0] - a[0] * b[2];
    sum[2] += a[0] * b[1] - a[1] * b[0];
  }
  return Math.hypot(...sum) / 2;
};
const boxOf = (bsp, entity) => {
  const number = brushModelOf(entity);
  const model = number === null ? null : bsp.models[number];
  if (!model) return null;
  const origin = originOf(entity) ?? [0, 0, 0];
  return { model, number, min: model.mins.map((v, a) => v + origin[a]), max: model.maxs.map((v, a) => v + origin[a]) };
};
const textureName = (bsp, face) => (faceTexture(bsp, face)?.name ?? "").toLowerCase();

/**
 * What `cityOf` takes, from a map: `built` as read (repaired), `lifted` what liftsOf gave (its entities one
 * for one with `built`'s), `cells` measure's walked places each with `sky`; `lifts` liftsOf's counts.
 * Each place is given the floor's light under it (the lightmap's samples within 24 of its floor, by area).
 */
export function cityInputOf(built, lifted, cells, { lifts = null, grid = CITY.grid } = {}) {
  // the world's faces: textures and where they are
  const faces = [];
  const wallTextures = new Set();
  for (const face of modelFaces(built, 0)) {
    const name = textureName(built, face);
    const kind = textureKind(name);
    if (TOOL.test(name) || kind.sky || kind.tool) continue;
    const points = facePolygon(built, face);
    const at = [0, 1, 2].map((a) => points.reduce((s, p) => s + p[a], 0) / points.length);
    faces.push({ texture: name, at, area: areaOf(points) });
    if (Math.abs(faceNormal(built, face)[2]) < 0.3) wallTextures.add(name);
  }
  const doors = [];
  const connectors = [];
  const models = [];
  const entities = [];
  const lights = [];
  built.entities.forEach((entity, k) => {
    const classname = valueOf(entity, "classname") ?? "";
    const now = valueOf(lifted.entities[k], "classname") ?? classname;
    const name = valueOf(entity, "targetname") ?? null;
    entities.push({ classname, name });
    const box = boxOf(built, entity);
    if (/^(light|light_spot|light_environment)$/.test(classname)) {
      const rgb = (valueOf(entity, "_light") ?? "255 255 255").trim().split(/\s+/).map(Number).slice(0, 3);
      if (rgb.length === 3 && rgb.every(Number.isFinite)) lights.push({ rgb, sky: classname === "light_environment" });
    }
    if (box && SCENERY.test(classname)) {
      const textures = modelFaces(built, box.number).map((f) => textureName(built, f));
      models.push({ size: box.max.map((v, a) => v - box.min[a]), textures });
    }
    if (box && DOOR.test(classname) && now !== "func_plat") {
      const size = box.max.map((v, a) => v - box.min[a]);
      const width = Math.max(size[0], size[1]);
      const thickness = Math.min(size[0], size[1]);
      if (size[2] >= 64 && width >= 24 && thickness <= Math.max(32, width / 3)) {
        const textures = [...new Set(modelFaces(built, box.number).map((f) => textureName(built, f)))].filter((t) => !TOOL.test(t)); // prettier-ignore
        const disguised = textures.length > 0 && textures.every((t) => wallTextures.has(t) && !DOORLIKE.test(t));
        doors.push({ min: box.min, max: box.max, name, disguised, classname, entity: k });
      }
    }
    if (classname === "func_ladder" && box) connectors.push({ kind: "ladder", min: box.min, max: box.max });
    if (classname === "trigger_teleport" && box) connectors.push({ kind: "teleport", min: box.min, max: box.max });
  });
  // the lifts the walk rides: func_plat after liftsOf (built at its top, riding down `height`)
  for (const entity of lifted.entities) {
    if (valueOf(entity, "classname") !== "func_plat") continue;
    const box = boxOf(lifted, entity);
    if (!box) continue;
    const height = numberOf(entity, "height") ?? box.max[2] - box.min[2];
    connectors.push({ kind: "lift", min: [box.min[0], box.min[1], box.max[2] - height - (box.max[2] - box.min[2])], max: box.max });
  }
  // the floor's light under each place
  const byColumn = new Map();
  cells.forEach((c, i) => {
    const key = `${c.at[0]},${c.at[1]}`;
    (byColumn.get(key) ?? byColumn.set(key, []).get(key)).push(i);
  });
  const sum = new Float64Array(cells.length);
  const weight = new Float64Array(cells.length);
  if (built.lumps?.lighting?.length)
    floorSamples(
      built,
      (point, brightness, area) => {
        const key = `${Math.round(point[0] / grid) * grid},${Math.round(point[1] / grid) * grid}`;
        for (const i of byColumn.get(key) ?? [])
          if (Math.abs(cells[i].at[2] - point[2]) <= 24) {
            sum[i] += brightness * area;
            weight[i] += area;
            break;
          }
      },
      stylesCounted(built, "start"),
    );
  const placed = cells.map((c, i) => ({ at: c.at, width: c.width, headroom: c.headroom, sky: !!c.sky, light: weight[i] ? sum[i] / weight[i] : null })); // prettier-ignore
  return { cells: placed, doors, connectors, lights, faces, models, entities, lifts };
}
