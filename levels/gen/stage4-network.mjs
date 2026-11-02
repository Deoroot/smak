// Stage 4, connectors, networks and spawns, placed by need: each connector with a stop in the tile gets its
// physical pieces (a stair's flights and landings by the rulebook's pitch and widths, as a straight run or a
// switchback well; a lift's shaft, car and landings; a ladder shaft; a ramp), standing where its stops are; each
// checkpoint at a node of the tile gets its rooms (a gate across every exit it controls there, a guard post, its
// holding cells); each MSR service node a post, and the MSR's hallways and passages are routed between them
// (bridged over public floor, a post added to break a run over maxServiceRun); and the description's share of
// spawns is placed on public floor clear of every keep-clear volume; a square's colonnade and a way's porticoes
// keep the columns no piece, exit, gate, room or door's way stands on. Writes 04-network.json.
//
// Written rules for what the description leaves open:
//  - a well or shaft stands on rock, a block's back or a facade lot (the facade is taken), on its own stop's plaza
//    or inside its own stop building, never in a way; its exits open onto its stop's public floor (the node, its
//    ways, a plaza it stands on the edge of) within NEAR cells of the node; candidates nearest the stops first;
//  - a straight run lies on the axes (the rulebook's circulation.axial): on the line between its stops when they
//    share an axis, else an L of two axial legs turning at a landing (a secret stair, hidden, keeps its line);
//    when neither fits, a switchback well; it passes over a way only above the way's clearance and over a
//    building only above its roof; its head opening is in its upper stop's own floor;
//  - a well or shaft the description gives a `site` for is looked for round that point first;
//  - a vehicle ramp that cannot run straight winds as a helix in a square well (connectors.mjs rampDims): its foot
//    and head open on any side of the well, as a shaft's doors do, each approach one ramp wide;
//  - a hallway or bridge runs on the axes too: orthogonal steps, each turn charged TURN;
//  - a monument stands on its square to its height: nothing is placed through it; a column of a square's portico
//    or of a way's (stage 1's) that a piece, an exit's approach, a gate, a room, a post or a hallway on the ground
//    stands on is left out (a wider bay there), and the stage says which; so is one standing in front of a door
//    under the portico (the door's approach, keepClear's band, carried across the portico past the column line);
//  - a gate room covers each exit the checkpoint controls at its node; the guard post touches the first gate, the
//    holding cells the post or each other; a service node's post stands off public floor, nearest the node;
//  - spawns: the tile's share of the description's spawns by its share of the spawnable floor (public ways and
//    plazas of layers that are not gated: nobody spawns past the checkpoints), on public floor, clear of doors,
//    exits, landings and gates, at least `spawns.minSpacing` apart, interleaved by layer and district.
import { ROOM_SIZES } from "../lib/city-description.mjs";
import { CONNECTOR_TYPES } from "../lib/city-description.mjs";
import {
  r3, dist, box4, boxBoxDist, rectPoly, roundPoly, rectCentre, bandPoly, polyOverlap, polyBox, pointInBox, pointOnSide, NORMAL,
  SIDES, seeded, seedOf, clipPolyline, growPoly, pointInPoly, polylineBoxDist,
} from "./geom.mjs";
import { tileAt, measured, shortest } from "./site.mjs";
import { siteGrid, layLots, K, RES, N4, N8 } from "./raster.mjs";
import { stairDims, stairKind, liftDims, shaftDims, rampDims } from "./connectors.mjs";
import { Heap } from "./heap.mjs";

export const NEAR = 6; // an exit within this many cells of its stop node (or of its plaza's edge)
const SEARCH = 9; // how far from its target a piece is looked for, cells
const T = 0.06; // a stair's structure under its treads and landings, cells (0.2 m)
const HALL = 1.5; // the service hallway's width and height, cells (the service class)
const TURN = 2; // a hallway's turn charged as this many half-cell steps: one cell (judged: few, long legs)

// ── the world: the tile's layers on the half-cell grid, with what stage 4 places on them ──
function world(desc, site, lotsArt) {
  const grids = new Map();
  for (const L of site.layers) {
    const g = layLots(siteGrid(site, desc, L.id), lotsArt.lots);
    g.taken = new Array(g.nx * g.ny).fill(null);
    grids.set(L.id, g);
  }
  const layers = site.layers;
  const lotById = new Map(lotsArt.lots.map((l) => [l.id, l]));
  const lotOfBuilding = new Map(lotsArt.lots.filter((l) => l.building).map((l) => [l.building, l]));
  const below = (L) => {
    const lower = desc.layers.filter((x) => x.level < L.level).sort((a, b) => b.level - a.level)[0];
    return lower ? lower.z[1] : L.floor - 1;
  };
  /** The layers a z range stands in: from the slab under a layer's floor to its top. */
  const layersHit = (z0, z1) => layers.filter((L) => z1 > below(L) + 1e-9 && z0 < L.top - 1e-9);
  const nodes = new Map(desc.streets.nodes.map((n) => [n.id, n]));
  const plazaBox = new Map(site.plazas.map((p) => [p.id, p.box]));
  /** A node's own public floor: itself (a plaza), its ways, and a plaza it stands on the edge of. */
  const floorOf = (nid) => {
    const out = new Set([nid]);
    for (const s of desc.streets.segments) if ((s.from === nid || s.to === nid) && s.class !== "service") out.add(s.id);
    const n = nodes.get(nid);
    for (const [pid, b] of plazaBox) {
      const dx = Math.max(b[0] - n.at[0], 0, n.at[0] - b[2]);
      const dy = Math.max(b[1] - n.at[1], 0, n.at[1] - b[3]);
      if (Math.hypot(dx, dy) <= 0.5 && nodes.get(pid)?.layer === n.layer) out.add(pid);
    }
    return out;
  };
  const clearanceOf = (owner) => {
    const w = site.ways.find((x) => x.id === owner);
    if (w) return w.clearance;
    const ws = [...measured(desc).segments.values()].filter((x) => (x.from === owner || x.to === owner) && x.class !== "service"); // prettier-ignore
    return Math.max(1.5, ...ws.map((x) => x.clearance)); // a plaza: the clearance of the ways that meet it
  };
  /**
   * A layer's highest clearance over each half cell of public floor: its owner's, and that of every other way whose
   * band meets the half cell's square (as the raster takes a way: by more than 0.02), so where two ways' bands
   * overlap near their node the higher one counts.
   */
  const clearMemo = new Map();
  const clearUnder = (lid) => {
    if (clearMemo.has(lid)) return clearMemo.get(lid);
    const g = grids.get(lid);
    const out = new Float64Array(g.nx * g.ny);
    const ways = site.ways.filter((w) => w.layer === lid && w.class !== "service");
    for (let j = 0; j < g.ny; j++)
      for (let i = 0; i < g.nx; i++) {
        const k = g.idx(i, j);
        if (g.kind[k] !== K.WAY && g.kind[k] !== K.PLAZA) continue;
        let c = clearanceOf(g.owner[k]);
        const p = g.centre(i, j);
        const sq = [p[0] - RES / 2, p[1] - RES / 2, p[0] + RES / 2, p[1] + RES / 2];
        for (const w of ways) if (w.clearance > c && w.parts.some((pl) => polylineBoxDist(pl, sq) < w.width / 2 - 0.02)) c = w.clearance; // prettier-ignore
        out[k] = c;
      }
    clearMemo.set(lid, out);
    return out;
  };
  return { grids, layers, lotById, lotOfBuilding, layersHit, nodes, floorOf, clearanceOf, below, clearUnder };
}

const zOverlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) > 1e-6;
function conflicts(g, k, z0, z1, ok = () => false) {
  for (const e of g.taken[k] ?? []) if (zOverlap(z0, z1, e.z0, e.z1) && !ok(e)) return e;
  return null;
}
function take(g, cells, entry) {
  for (const [i, j] of cells) {
    const k = g.idx(i, j);
    (g.taken[k] ??= []).push(entry);
  }
}
const cellsOf = (g, poly) => [...g.cellsInPoly(poly)];
const cellsUnder = (g, poly) => [...g.cellsTouching(poly)];
const allInside = (g, poly) => {
  const b = polyBox(poly);
  return b[0] >= g.box[0] - 1e-6 && b[1] >= g.box[1] - 1e-6 && b[2] <= g.box[2] + 1e-6 && b[3] <= g.box[3] + 1e-6;
};
const approachRect = (r, side, depth, across = null) => {
  const w = across ?? (side === "n" || side === "s" ? r.w : r.d);
  const [cx, cy] = rectCentre(r);
  if (side === "s") return { x: cx - w / 2, y: r.y - depth, w, d: depth };
  if (side === "n") return { x: cx - w / 2, y: r.y + r.d, w, d: depth };
  if (side === "w") return { x: r.x - depth, y: cy - w / 2, w: depth, d: w };
  return { x: r.x + r.w, y: cy - w / 2, w: depth, d: w };
};
const OPP = { n: "s", s: "n", e: "w", w: "e" };

function run(ctx) {
  const d0 = ctx.inputs["00-description.json"];
  const site = ctx.inputs["01-site.json"];
  const lotsArt = ctx.inputs["02-lots.json"];
  const desc = d0.description;
  const rb = d0.rulebook;
  const m = measured(desc);
  const W = world(desc, site, lotsArt);
  const tile = site.tile.id;
  const grid = desc.grid;
  const rooms = { ...ROOM_SIZES, ...(desc.roomSizes ?? {}) };
  const sizeOf = (kind) => rooms[kind] ?? [2, 2];
  const notes = [];
  const layerById = new Map(W.layers.map((L) => [L.id, L]));
  const inTileLayer = (lid) => layerById.has(lid);
  // the squares' monuments: solid from the floor to their tops, so nothing is placed through them
  for (const p of site.plazas) {
    const g = W.grids.get(p.layer);
    if (!g) continue;
    for (const mo of p.monuments ?? []) take(g, cellsUnder(g, monumentPoly(mo)), { id: mo.id, z0: mo.z[0], z1: mo.z[1], kind: "monument" }); // prettier-ignore
  }

  /** A stop of a connector: { id, kind: node|building|service, layer, z, at, lot? }. */
  const stopOf = (id) => {
    const n = W.nodes.get(id);
    if (n) return { id, kind: n.kind === "service" ? "service" : "node", node: n, layer: n.layer, z: m.layers.get(n.layer).z[0], at: n.at, inTile: tileAt(desc, n.at) === tile }; // prettier-ignore
    const b = m.buildings.get(id);
    const lot = W.lotOfBuilding.get(id);
    return { id, kind: "building", layer: b.layer, z: m.layers.get(b.layer).z[0], at: b.at, lot, inTile: Boolean(lot) };
  };

  // ── posts: a room for each MSR service node of the tile, off public floor, nearest the node ──
  const posts = [];
  const postOf = new Map();
  const msrLot = (lot) => lot && desc.buildings.find((b) => b.id === lot.building)?.owner === "msr";
  const roomCellOk = (g, k, z, extra = () => false) => {
    const kind = g.kind[k];
    if (conflicts(g, k, z, z + grid.storey)) return false;
    if (kind === K.BACK || kind === K.FACADE || kind === K.ROCK) return true;
    if (kind === K.LOT) return msrLot(W.lotById.get(g.owner[k]));
    return extra(kind, g.owner[k]);
  };
  /** The first rect of size [w, d] (either way round) nearest `at` whose cells all pass `ok`. */
  const findRect = (g, at, [w, d], ok, { radius = SEARCH, touch = null, near = null, gap = 0 } = {}) => {
    const cands = [];
    for (let dx = -radius; dx <= radius; dx += RES)
      for (let dy = -radius; dy <= radius; dy += RES)
        for (const [ww, dd] of w === d ? [[w, d]] : [[w, d], [d, w]]) {
          const r = { x: Math.round((at[0] + dx - ww / 2) * 2) / 2, y: Math.round((at[1] + dy - dd / 2) * 2) / 2, w: ww, d: dd }; // prettier-ignore
          cands.push([dist(rectCentre(r), at), r]);
        }
    cands.sort((p, q) => p[0] - q[0] || p[1].x - q[1].x || p[1].y - q[1].y || p[1].w - q[1].w);
    for (const [, r] of cands) {
      const poly = rectPoly(r);
      if (!allInside(g, poly)) continue;
      if (touch && !touches(r, touch)) continue;
      if (near && !near.some((q) => boxBoxDist(box4(r), box4(q)) <= gap + 1e-6)) continue;
      const cells = cellsOf(g, poly);
      if (cells.length && cells.every(([i, j]) => ok(g.idx(i, j)))) return { rect: r, cells };
    }
    return null;
  };
  const touches = (a, b) => {
    const [A, B] = [box4(a), box4(b)];
    const ox = Math.min(A[2], B[2]) - Math.max(A[0], B[0]);
    const oy = Math.min(A[3], B[3]) - Math.max(A[1], B[1]);
    return (Math.abs(ox) < 1e-6 && oy > 0.49) || (Math.abs(oy) < 1e-6 && ox > 0.49);
  };
  for (const n of desc.streets.nodes) {
    if (n.kind !== "service" || !inTileLayer(n.layer) || tileAt(desc, n.at) !== tile) continue;
    const g = W.grids.get(n.layer);
    const z = layerById.get(n.layer).floor;
    const kind = Object.keys(n.program ?? { "guard-post": 1 })[0];
    const found = findRect(g, n.at, sizeOf(kind), (k) => roomCellOk(g, k, z), { radius: 12 });
    if (!found) {
      notes.push(`posts: no room for ${n.id}'s ${kind} within 12 cells off public floor`);
      continue;
    }
    const post = { id: `post_${n.id}`, node: n.id, kind, layer: n.layer, z: [z, r3(z + grid.storey)], rect: found.rect, offset: r3(dist(rectCentre(found.rect), n.at)), reason: "the service node's post" }; // prettier-ignore
    take(g, found.cells, { id: post.id, z0: z, z1: z + grid.storey, kind: "post" });
    posts.push(post);
    postOf.set(n.id, post);
  }

  // ── connectors ──
  const connectors = [];
  const lift = liftDims(rb, grid);
  const ladder = shaftDims(rb, grid);
  const order = [...m.connectors].sort((a, b) => (a.access === "msr" ? 0 : 1) - (b.access === "msr" ? 0 : 1)); // the MSR's first: they live in their buildings
  for (const c of order) {
    const stops = c.stops.map(stopOf);
    const here = stops.filter((s) => s.inTile && inTileLayer(s.layer));
    if (!here.length) continue;
    const rec = { id: c.id, type: c.type, access: c.access, name: c.name ?? null, stops: c.stops, inTile: here.map((s) => s.id), lengthDescribed: c.length ?? null, pieces: [], exits: [], facadesTaken: [] }; // prettier-ignore
    const outside = stops.filter((s) => !s.inTile);
    const T0 = Math.min(...stops.map((s) => s.z));
    const T1 = Math.max(...stops.map((s) => s.z));
    const horizontal = Math.max(...stops.slice(1).map((s, i) => dist(s.at, stops[i].at)));
    let dims;
    if (c.type === "lift") dims = { form: "shaft", ...lift, well: { across: lift.shaft, deep: lift.shaft }, top: lift.carHeight, approach: lift.landing }; // prettier-ignore
    else if (c.type === "ladder-shaft") dims = { form: "shaft", ...ladder, well: { across: ladder.shaft, deep: ladder.shaft }, approach: ladder.landing }; // prettier-ignore
    else if (c.type === "ramp") dims = rampDims(c, T1 - T0, horizontal, rb, grid, desc.vehicle);
    else {
      // a stair (or a secret one): each link sized; a multi-stop stair is one well, so all links switchback then
      const links = stops.slice(1).map((s, i) => stairDims(s.z - stops[i].z, dist(s.at, stops[i].at), stairKind(c), rb, grid)); // prettier-ignore
      const form = links.length === 1 ? links[0].form : "switchback";
      const L0 = links[0];
      dims = { ...L0, form, links, well: { across: Math.max(...links.map((l) => l.well.across)), deep: Math.max(...links.map((l) => l.well.deep)) }, top: L0.headroom, path: r3(links.reduce((s, l) => s + l.path, 0)) }; // prettier-ignore
    }
    rec.dims = dims;
    rec.form = dims.form;
    rec.lengthBuilt = dims.path ?? r3(T1 - T0);
    if (outside.length) {
      rec.crossesSeam = outside.map((s) => s.id);
      const portal = (desc.tiles.portals ?? []).find((p) => p.connector === c.id);
      rec.portal = portal?.id ?? null;
    }
    let placed = dims.form === "straight" && !outside.length ? placeRun(rec, stops, dims) : outside.length && dims.form === "straight" ? placeStub(rec, here, dims) : placeColumn(rec, stops, here, dims, c); // prettier-ignore
    if (!placed && dims.form === "straight" && !outside.length && c.type !== "ramp") {
      // no straight run or L on the axes fits: a switchback well, at typical treads, between the stops
      const links = stops.slice(1).map((s, i) => stairDims(s.z - stops[i].z, 0, stairKind(c), rb, grid));
      const L0 = links[0];
      dims = { ...L0, form: "switchback", links, well: { across: Math.max(...links.map((l) => l.well.across)), deep: Math.max(...links.map((l) => l.well.deep)) }, top: L0.headroom, path: r3(links.reduce((s, l) => s + l.path, 0)) }; // prettier-ignore
      rec.dims = dims;
      rec.form = dims.form;
      rec.lengthBuilt = dims.path;
      rec.why = undefined;
      placed = placeColumn(rec, stops, here, dims, c);
      if (placed) notes.push(`connectors: ${c.id} found no straight run or L on the axes between its stops: built as a switchback well`); // prettier-ignore
    }
    if (!placed) rec.unplaced = rec.unplaced ?? `no site for ${c.id} within ${SEARCH} cells of its stops${rec.why ? ` (the sites tried stood on ${[...rec.why].sort((p, q) => q[1] - p[1]).slice(0, 3).map(([w, n]) => `${w} ${n} times`).join(", ")})` : ""}`; // prettier-ignore
    delete rec.why;
    connectors.push(rec);
  }

  /** The cells a piece may stand on, on one layer: never a way; its own plaza or building; rock, backs, facades. */
  function pieceCellOk(g, k, z0, z1, rec, L, stopHere, { under = null } = {}) {
    if (conflicts(g, k, z0, z1, (e) => e.id === rec.id)) return false;
    const kind = g.kind[k];
    const owner = g.owner[k];
    if (kind === K.WAY || kind === K.PLAZA) {
      if (under !== null && under >= L.floor + W.clearanceOf(owner) - 1e-9) return true; // over it, above its clearance
      if (kind === K.PLAZA && stopHere && stopHere.kind === "node" && W.floorOf(stopHere.id).has(owner)) return true;
      if (rec.headOpening === stopHere?.id && stopHere.kind === "node" && W.floorOf(stopHere.id).has(owner)) return true; // the head's opening in its own floor
      return false;
    }
    if (kind === K.LOT) {
      const lot = W.lotById.get(owner);
      if (rec.stops.includes(lot.building)) return true;
      return under !== null && under >= lot.zBase + lot.storeys * grid.storey - 1e-9;
    }
    return true;
  }
  /** How high an exit's approach is kept clear: its headroom, or a storey where a checkpoint's gate will stand on it. */
  function clearAbove(rec, stopId) {
    const gated = (desc.checkpoints ?? []).some((k) => k.node === stopId && k.controls.includes(rec.id));
    const head = rec.dims.headroom ?? rec.dims.top ?? 1;
    return gated ? Math.max(head, grid.storey) : head;
  }
  /** An exit's approach on its stop's layer: public floor of the stop (a node), its building, or its post. */
  function approachOk(g, poly, stop, rec, z, headIn) {
    const head = Math.max(headIn ?? 0, clearAbove(rec, stop.id));
    if (!allInside(g, poly)) return false;
    const cells = cellsOf(g, poly);
    if (!cells.length) return false;
    if (stop.kind === "building") return cells.every(([i, j]) => g.owner[g.idx(i, j)] === stop.lot.id && !conflicts(g, g.idx(i, j), z, z + head, (e) => e.id === rec.id)); // prettier-ignore
    if (stop.kind === "service") {
      const post = postOf.get(stop.id);
      return cells.every(([i, j]) => {
        const k = g.idx(i, j);
        const p = g.centre(i, j);
        if (post && pointInBox(p, box4(post.rect))) return true;
        return [K.BACK, K.FACADE, K.ROCK].includes(g.kind[k]) && !conflicts(g, k, z, z + head, (e) => e.id === rec.id);
      });
    }
    // nothing else under any part of it (the half cells it touches) but another exit's approach (two exits may share
    // a landing's floor, as the gate allows), public floor under its half cells' centres
    const mine = (e) => e.id === rec.id || e.kind === "approach";
    for (const [i, j] of cellsUnder(g, poly)) if (conflicts(g, g.idx(i, j), z, z + head, mine)) return false; // prettier-ignore
    const floor = W.floorOf(stop.id);
    let own = 0;
    for (const [i, j] of cells) {
      const k = g.idx(i, j);
      if (g.kind[k] !== K.WAY && g.kind[k] !== K.PLAZA) return false;
      if (conflicts(g, k, z, z + head, mine)) return false;
      if (floor.has(g.owner[k])) own++;
    }
    const c = polyBox(poly);
    const centre = [(c[0] + c[2]) / 2, (c[1] + c[3]) / 2];
    const reach = stop.node.size ? Math.max(...stop.node.size) / 2 + 2 : NEAR;
    return own > 0 && dist(centre, stop.at) <= Math.max(NEAR, reach);
  }
  function commit(rec, layerCells, exits) {
    const taken = new Set();
    for (const [lid, x] of layerCells) {
      const g = W.grids.get(lid);
      for (const { cells, z0, z1 } of Array.isArray(x) ? x : [x]) {
        take(g, cells, { id: rec.id, z0, z1, kind: "piece" });
        for (const [i, j] of cells) {
          const k = g.idx(i, j);
          if (g.kind[k] === K.FACADE) {
            const lot = W.lotById.get(g.owner[k]);
            if (z0 < lot.zBase + lot.facade.height - 1e-9) taken.add(lot.id);
          }
        }
      }
    }
    for (const ex of exits) {
      const g = W.grids.get(ex.layer);
      take(g, cellsUnder(g, ex.approach), { id: rec.id, z0: ex.z, z1: ex.z + clearAbove(rec, ex.stop), kind: "approach" }); // prettier-ignore
    }
    rec.facadesTaken = [...taken].sort();
  }
  function pieceLayers(rec, poly, z0, z1, stopsByLayer, under = null) {
    const out = [];
    for (const L of W.layersHit(z0, z1)) {
      const g = W.grids.get(L.id);
      if (!allInside(g, poly)) return null;
      const cells = cellsUnder(g, poly);
      const stopHere = stopsByLayer.get(L.id) ?? null;
      for (const [i, j] of cells)
        if (!pieceCellOk(g, g.idx(i, j), z0, z1, rec, L, stopHere, { under })) {
          const k = g.idx(i, j);
          const e = conflicts(g, k, z0, z1, (x) => x.id === rec.id);
          const why = e ? `${e.id}'s ${e.kind}` : g.kind[k] === K.LOT ? `building ${W.lotById.get(g.owner[k]).building}` : `${["rock", "back", "facade", "lot", "way", "plaza"][g.kind[k]]} ${g.owner[k] ?? ""}`.trim(); // prettier-ignore
          rec.why ??= new Map();
          rec.why.set(`${why} on ${L.id}`, (rec.why.get(`${why} on ${L.id}`) ?? 0) + 1);
          return null;
        }
      out.push([L.id, { cells, z0, z1 }]);
    }
    return out;
  }

  /** A vertical piece (a switchback well, a lift's or a ladder's shaft) through all its stops. */
  function placeColumn(rec, stops, here, dims, c) {
    if (here.length < stops.length) {
      rec.unplaced = `${c.id} stands one over the other, but its stops ${stops.filter((s) => !s.inTile).map((s) => s.id).join(", ")} are outside ${tile}`; // prettier-ignore
      return false;
    }
    const z0 = Math.min(...stops.map((s) => s.z)) - T;
    const z1 = Math.max(...stops.map((s) => s.z)) + (dims.top ?? dims.headroom);
    const byLayer = new Map(stops.map((s) => [s.layer, s]));
    // the description's site for it when given (where its well or shaft is wanted), else between its stops
    const target = c.site ?? [stops.reduce((s, x) => s + x.at[0], 0) / stops.length, stops.reduce((s, x) => s + x.at[1], 0) / stops.length]; // prettier-ignore
    // a building stop holds the well: look inside it first
    const inB = c.site ? null : stops.find((s) => s.kind === "building");
    const centre = inB ? rectCentre(inB.lot.rect) : target;
    const cands = [];
    for (let dx = -SEARCH; dx <= SEARCH; dx += RES)
      for (let dy = -SEARCH; dy <= SEARCH; dy += RES)
        for (const facing of SIDES) {
          const [w, d] = facing === "n" || facing === "s" ? [dims.well.across, dims.well.deep] : [dims.well.deep, dims.well.across];
          const r = { x: Math.round((centre[0] + dx - w / 2) * 2) / 2, y: Math.round((centre[1] + dy - d / 2) * 2) / 2, w, d }; // prettier-ignore
          cands.push([dist(rectCentre(r), target) + (inB ? dist(rectCentre(r), centre) : 0), facing, r]);
        }
    cands.sort((p, q) => p[0] - q[0] || SIDES.indexOf(p[1]) - SIDES.indexOf(q[1]) || p[2].x - q[2].x || p[2].y - q[2].y);
    for (const [, facing, r] of cands) {
      const poly = rectPoly(r);
      const layerCells = pieceLayers(rec, poly, z0, z1, byLayer);
      if (!layerCells) continue;
      // the half-cell raster can miss a way's edge: the well kept out of every way's band but its stops' own
      const ownFloor = (wid) => stops.some((st) => W.nodes.has(st.id) && W.floorOf(st.id).has(wid));
      if (wayBands().some((bd) => z0 < bd.z[1] - 0.01 && z1 > bd.z[0] + 0.01 && !ownFloor(bd.owner) && polyOverlap(poly, bd.poly) > 0.02)) continue; // prettier-ignore
      // exits: a switchback's foot on its facing side and each floor after on the side its flights' parity gives;
      // a shaft's door on whichever side opens onto the stop
      const exits = [];
      let ok = true;
      let flights = 0;
      for (let si = 0; si < stops.length && ok; si++) {
        const s = stops[si];
        const g = W.grids.get(s.layer);
        if (si > 0 && dims.links) flights += dims.links[si - 1].flights;
        const sides = dims.form === "switchback" ? [flights % 2 ? OPP[facing] : facing] : [...SIDES].sort((a, b) => sideScore(r, b, s.at) - sideScore(r, a, s.at)); // prettier-ignore
        let got = null;
        for (const side of sides) {
          const ap = rectPoly(approachRect(r, side, dims.approach, dims.form === "helix" ? dims.width : null)); // a helix opens one ramp wide
          if (approachOk(g, ap, s, rec, s.z, dims.headroom ?? dims.top)) {
            got = { stop: s.id, layer: s.layer, z: s.z, side, at: pointOnSide(r, side, (side === "n" || side === "s" ? r.w : r.d) / 2).map(r3), approach: roundPoly(ap) }; // prettier-ignore
            break;
          }
        }
        if (!got) ok = false;
        else exits.push(got);
      }
      if (!ok) continue;
      rec.pieces.push({ kind: dims.form === "switchback" || dims.form === "helix" ? "well" : "shaft", poly: roundPoly(poly), z: [r3(z0), r3(z1)] });
      if (c.type === "lift") rec.pieces.push({ kind: "car", poly: roundPoly(poly), z: [r3(Math.min(...stops.map((s) => s.z))), r3(Math.min(...stops.map((s) => s.z)) + lift.carHeight)] }); // prettier-ignore
      if (dims.form === "switchback") flightsOfWell(rec, r, facing, stops, dims);
      rec.exits = exits;
      rec.facing = facing;
      commit(rec, layerCells, exits);
      return true;
    }
    return false;
  }
  function sideScore(r, side, at) {
    const c = rectCentre(r);
    return (at[0] - c[0]) * NORMAL[side][0] + (at[1] - c[1]) * NORMAL[side][1];
  }
  /** A switchback's flights and landings inside its well, for the stages after (one lane up, the other back). */
  function flightsOfWell(rec, r, facing, stops, dims) {
    const n = NORMAL[facing];
    const back = [-n[0], -n[1]];
    const across = [n[1], -n[0]];
    const [cx, cy] = rectCentre(r);
    const deep = facing === "n" || facing === "s" ? r.d : r.w;
    const wide = facing === "n" || facing === "s" ? r.w : r.d;
    const front = [cx + n[0] * (deep / 2), cy + n[1] * (deep / 2)];
    const L = dims.landing;
    let z = stops[0].z;
    let k = 0;
    for (const link of dims.links ?? [dims]) {
      for (let f = 0; f < link.flights; f++, k++) {
        const lane = k % 2 ? -1 : 1;
        const rise = (link.perFlight[f] * link.riser_m) / desc.grid.cell;
        const laneC = [front[0] + across[0] * lane * (wide / 4), front[1] + across[1] * lane * (wide / 4)];
        const a = [laneC[0] + back[0] * L, laneC[1] + back[1] * L];
        const b = [a[0] + back[0] * link.flightRuns[f], a[1] + back[1] * link.flightRuns[f]];
        const [p, q] = k % 2 ? [b, a] : [a, b];
        rec.pieces.push({ kind: "flight", poly: roundPoly(bandPoly(p, q, Math.min(link.width, wide / 2))), z: [r3(z), r3(z + rise)], risers: link.perFlight[f] }); // prettier-ignore
        z += rise;
        const end = k % 2 ? front : [front[0] + back[0] * (deep - L / 2) - back[0] * (L / 2), front[1] + back[1] * (deep - L / 2) - back[1] * (L / 2)]; // prettier-ignore
        const lc = k % 2 ? [front[0] + back[0] * (L / 2), front[1] + back[1] * (L / 2)] : [front[0] + back[0] * (deep - L / 2), front[1] + back[1] * (deep - L / 2)]; // prettier-ignore
        void end;
        rec.pieces.push({ kind: "landing", poly: roundPoly(bandPoly([lc[0] - across[0] * (wide / 2), lc[1] - across[1] * (wide / 2)], [lc[0] + across[0] * (wide / 2), lc[1] + across[1] * (wide / 2)], L)), z: [r3(z - T), r3(z)] }); // prettier-ignore
      }
    }
  }

  // the ways' bands to their clearance, as the gate's overlap test takes them (the half-cell raster can miss an edge)
  function wayBands() {
    wayBands.of ??= site.ways.filter((w) => w.class !== "service").flatMap((w) => w.parts.flatMap((part) => part.slice(1).map((q, i) => ({ owner: w.id, poly: bandPoly(part[i], q, w.width - 0.02), z: [w.z, w.z + w.clearance] })))); // prettier-ignore
    return wayBands.of;
  }
  /**
   * A straight run between two stops, on the axes (the rulebook's circulation.axial): one straight leg when the stops
   * share an axis, else an L of two axial legs whose turn is a landing (a square as deep as the landing), each split
   * of the flights between the legs tried, the split nearest the stops' own offsets first. Its head at the upper stop.
   */
  function placeRun(rec, stops, dims) {
    const [A, B] = [stops[0], stops[stops.length - 1]];
    const d = [B.at[0] - A.at[0], B.at[1] - A.at[1]];
    const axial = Math.abs(d[0]) < 1e-6 || Math.abs(d[1]) < 1e-6;
    const ax = [Math.sign(d[0]) || 1, 0];
    const ay = [0, Math.sign(d[1]) || 1];
    const nf = dims.flights;
    const Ld = dims.landing;
    const runOf = (f0, f1) => dims.flightRuns.slice(f0, f1).reduce((t, x) => t + x, 0) + Math.max(0, f1 - f0 - 1) * Ld;
    const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
    const shapes = [];
    if (axial) shapes.push({ u1: Math.abs(d[0]) > 1e-6 ? ax : ay, u2: Math.abs(d[0]) > 1e-6 ? ax : ay, k: nf, score: 0 });
    else if (rec.type === "secret") {
      // a secret stair is hidden under the floor and in the walls: no street or plaza sees it, so it keeps its line
      const n = Math.hypot(d[0], d[1]);
      shapes.push({ u1: [d[0] / n, d[1] / n], u2: [d[0] / n, d[1] / n], k: nf, score: 0 });
    } else
      for (const [u1, u2] of [[ax, ay], [ay, ax]])
        for (let k = 1; k < nf; k++) shapes.push({ u1, u2, k, score: Math.abs(runOf(0, k) + Ld / 2 - Math.abs(dot(d, u1))) + Math.abs(runOf(k, nf) + Ld / 2 - Math.abs(dot(d, u2))) }); // prettier-ignore
    shapes.sort((p, q) => p.score - q.score || p.k - q.k);
    const byLayer = new Map(stops.map((s) => [s.layer, s]));
    const tries = [];
    for (let h = 0; h <= 8; h += RES) for (const hs of h ? [h, -h] : [0]) for (let o = 0; o <= 4; o += RES) for (const os of o ? [o, -o] : [0]) tries.push([Math.abs(hs) + Math.abs(os), hs, os]); // prettier-ignore
    tries.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    const w = dims.width;
    const add = (p, u, t) => [p[0] + u[0] * t, p[1] + u[1] * t];
    rec.headOpening = B.id;
    for (const { u1, u2, k: turn } of shapes)
      for (const [, hs, os] of tries) {
        const v2 = [-u2[1], u2[0]];
        const H = add(add(B.at, u2, hs), v2, os);
        // the foot: back from the head along the last leg, round the turn's landing, back along the first
        const F = turn === nf ? add(H, u2, -dims.path) : add(add(add(H, u2, -(runOf(turn, nf) + Ld / 2)), u1, -Ld / 2), u1, -runOf(0, turn));
        const pieces = [];
        let p = F;
        let u = u1;
        let z = A.z;
        for (let f = 0; f < nf; f++) {
          const run = dims.flightRuns[f];
          const rise = (dims.perFlight[f] * dims.riser_m) / desc.grid.cell;
          // a flight in pieces of about a cell, each with the z range of its own stretch (so it may pass over a way)
          const n = Math.max(1, Math.ceil(run));
          for (let k = 0; k < n; k++) {
            const [za, zb] = [z + (rise * k) / n, z + (rise * (k + 1)) / n];
            pieces.push({ kind: "flight", poly: bandPoly(add(p, u, (run * k) / n), add(p, u, (run * (k + 1)) / n), w), z: [za - T, zb + dims.headroom], under: za - T, flight: f }); // prettier-ignore
          }
          p = add(p, u, run);
          z += rise;
          if (f === nf - 1) break;
          if (f === turn - 1) {
            // the turn: a square landing, the next leg leaving it from its middle
            pieces.push({ kind: "landing", turn: true, poly: bandPoly(p, add(p, u, Ld), Math.max(w, Ld)), z: [z - T, z + dims.headroom], under: z - T }); // prettier-ignore
            p = add(add(p, u, Ld / 2), u2, Ld / 2);
            u = u2;
          } else {
            pieces.push({ kind: "landing", poly: bandPoly(p, add(p, u, Ld), w), z: [z - T, z + dims.headroom], under: z - T });
            p = add(p, u, Ld);
          }
        }
        const layerCells = new Map();
        let ok = true;
        for (const pc of pieces) {
          const got = pieceLayers(rec, pc.poly, pc.z[0], pc.z[1], byLayer, pc.under);
          if (!got) {
            ok = false;
            break;
          }
          for (const [lid, x] of got) (layerCells.get(lid) ?? layerCells.set(lid, []).get(lid)).push(x);
        }
        if (!ok) continue;
        // no flight or landing under a way's clearance reaches into its band, unless the way is a stop's own floor
        const ownFloor = (wid) => stops.some((st) => W.nodes.has(st.id) && W.floorOf(st.id).has(wid));
        if (pieces.some((pc) => wayBands().some((bd) => pc.z[0] < bd.z[1] - 0.01 && pc.z[1] > bd.z[0] + 0.01 && !ownFloor(bd.owner) && polyOverlap(pc.poly, bd.poly) > 0.02))) continue; // prettier-ignore
        const footAp = bandPoly(add(F, u1, -dims.approach), F, w);
        const headAp = bandPoly(H, add(H, u2, dims.approach), w);
        if (!approachOk(W.grids.get(A.layer), footAp, A, rec, A.z, dims.headroom)) continue;
        if (!approachOk(W.grids.get(B.layer), headAp, B, rec, B.z, dims.headroom)) continue;
        rec.pieces.push(...pieces.map((pc) => ({ kind: pc.kind, ...(pc.turn ? { turn: true } : {}), poly: roundPoly(pc.poly), z: [r3(pc.z[0]), r3(pc.z[1])] }))); // prettier-ignore
        rec.exits = [
          { stop: A.id, layer: A.layer, z: A.z, side: null, dir: [r3(-u1[0]), r3(-u1[1])], at: [r3(F[0]), r3(F[1])], approach: roundPoly(footAp) }, // prettier-ignore
          { stop: B.id, layer: B.layer, z: B.z, side: null, dir: [r3(u2[0]), r3(u2[1])], at: [r3(H[0]), r3(H[1])], approach: roundPoly(headAp) }, // prettier-ignore
        ];
        rec.offset = { along: hs, across: os };
        rec.legs = turn === nf ? 1 : 2;
        commit(rec, layerCells, rec.exits);
        delete rec.headOpening;
        return true;
      }
    delete rec.headOpening;
    return false;
  }

  /** A connector whose far stop is in another tile: a run from its stop here to the seam, at its stop's floor. */
  function placeStub(rec, here, dims) {
    const s = here[0];
    const g = W.grids.get(s.layer);
    const far = rec.stops.map(stopOf).find((x) => !x.inTile);
    const line = clipPolyline([s.at, far.at], site.tile.box)[0];
    if (!line) return false;
    const end = line[line.length - 1];
    const poly = bandPoly(s.at, end, dims.width);
    // a secret one is hidden under the floor (as placeRun keeps a secret stair from every street and plaza): its
    // stub runs in the slab under its stop's floor, so it neither crosses the public floor it passes under nor
    // stands in its walk; any other runs at its stop's floor
    const under = rec.type === "secret";
    const z0 = under ? s.z - T - dims.headroom : s.z;
    const z1 = under ? s.z - T : s.z + dims.headroom;
    const cells = cellsUnder(g, poly);
    for (const [i, j] of cells) if (!pieceCellOk(g, g.idx(i, j), z0, z1, rec, layerById.get(s.layer), s, { under: null }) && ![K.WAY, K.PLAZA].includes(g.kind[g.idx(i, j)])) return false; // prettier-ignore
    rec.pieces.push({ kind: "stub", poly: roundPoly(poly), z: [r3(z0), r3(z1)], toSeam: end.map(r3) });
    // its exit: the stub's own first cell, inside its stop
    const u = [(end[0] - s.at[0]) / (dist(s.at, end) || 1), (end[1] - s.at[1]) / (dist(s.at, end) || 1)];
    rec.exits = [{ stop: s.id, layer: s.layer, z: s.z, side: null, dir: [r3(-u[0]), r3(-u[1])], at: s.at, approach: roundPoly(bandPoly([s.at[0] - u[0] * dims.approach, s.at[1] - u[1] * dims.approach], s.at, dims.width)) }]; // prettier-ignore
    rec.stub = true;
    rec.lengthBuilt = r3(dist(s.at, end));
    take(g, cells.filter(([i, j]) => ![K.WAY, K.PLAZA].includes(g.kind[g.idx(i, j)])), { id: rec.id, z0, z1, kind: "piece" });
    return true;
  }

  // ── checkpoints: a gate over each exit controlled at the node, the post touching it, the cells off the post ──
  const checkpoints = [];
  for (const cp of desc.checkpoints ?? []) {
    const n = W.nodes.get(cp.node);
    if (!inTileLayer(n.layer) || tileAt(desc, n.at) !== tile) continue;
    const L = layerById.get(n.layer);
    const g = W.grids.get(n.layer);
    const z = L.floor;
    const rec = { id: cp.id, node: cp.node, layer: n.layer, controls: cp.controls, reason: cp.reason, program: cp.program ?? {}, rooms: [] }; // prettier-ignore
    const floor = W.floorOf(cp.node);
    const own = (kind, owner) => kind === K.PLAZA && floor.has(owner); // a room may stand on its own plaza, never in a way
    for (const cid of cp.controls) {
      const conn = connectors.find((x) => x.id === cid);
      const ex = conn?.exits.find((e) => e.stop === cp.node);
      if (!ex) {
        if (W.nodes.get(cid)?.kind === "gate") {
          const width = Math.max(...site.ways.filter((w) => w.from === cid || w.to === cid).map((w) => w.width), 2);
          const r = { x: n.at[0] - width / 2, y: n.at[1] - 0.5, w: width, d: 1 };
          rec.rooms.push({ kind: "gate", fronts: cid, rect: r, z: [z, r3(z + grid.storey)] });
          take(g, cellsOf(g, rectPoly(r)), { id: cp.id, z0: z, z1: z + grid.storey, kind: "gate" });
        } else if (conn && !conn.unplaced) notes.push(`checkpoints: ${cp.id} controls ${cid}, which has no exit at ${cp.node} in ${tile}`); // prettier-ignore
        continue;
      }
      // the gate: the exit's approach widened and deepened to the gate room's size, so it covers the approach
      const [gw, gd] = sizeOf("gate");
      const ap = ex.approach;
      const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      // the approach is a band [a0, a1, a2, a3]: a0-a1 and a3-a2 its long sides from the exit outward, or a rect
      // the approach's two centre lines (it is a rect or a band); the gate runs out from the exit along one of them
      const lines = [[mid(ap[0], ap[3]), mid(ap[1], ap[2]), dist(ap[0], ap[3])], [mid(ap[0], ap[1]), mid(ap[3], ap[2]), dist(ap[0], ap[1])]]; // prettier-ignore
      const pick = lines.flatMap(([p, q, w]) => [[p, q, w], [q, p, w]]).sort((x, y) => dist(x[0], ex.at) - dist(y[0], ex.at))[0];
      const [p0, p1, wide] = pick;
      const len = Math.max(dist(p0, p1), gd);
      const u = [(p1[0] - p0[0]) / (dist(p0, p1) || 1), (p1[1] - p0[1]) / (dist(p0, p1) || 1)];
      const mine = (e) => e.id === cp.id || e.id === cid || (e.kind === "approach" && cp.controls.includes(e.id)); // it abuts its own exit
      const hit = (pl) => {
        for (const [i, j] of cellsUnder(g, pl)) {
          const k = g.idx(i, j);
          if (g.kind[k] === K.LOT) return `building ${W.lotById.get(g.owner[k]).building}`;
          const e = conflicts(g, k, z, z + grid.storey, mine);
          if (e) return `${e.id}'s ${e.kind}`;
        }
        return null;
      };
      let poly = roundPoly(bandPoly(p0, [p0[0] + u[0] * len, p0[1] + u[1] * len], Math.max(wide, gw)));
      if (hit(poly)) poly = roundPoly(bandPoly(p0, [p0[0] + u[0] * len, p0[1] + u[1] * len], wide));
      if (hit(poly)) rec.unplaced = `${cp.id}: its gate over ${cid}'s exit at ${cp.node} would stand on ${hit(poly)}`;
      const bb = polyBox(poly);
      rec.rooms.push({ kind: "gate", fronts: cid, rect: { x: r3(bb[0]), y: r3(bb[1]), w: r3(bb[2] - bb[0]), d: r3(bb[3] - bb[1]) }, poly, z: [z, r3(z + grid.storey)] }); // prettier-ignore
      take(g, cellsUnder(g, poly), { id: cp.id, z0: z, z1: z + grid.storey, kind: "gate" });
    }
    const first = rec.rooms.find((x) => x.kind === "gate");
    const gates = rec.rooms.filter((x) => x.kind === "gate").map((x) => x.rect); // the post within 4 cells of a gate off the floor, or 2 on its plaza
    const offFloor = (k) => roomCellOk(g, k, z);
    const ok = (k) => roomCellOk(g, k, z, own);
    // outside every building first: a checkpoint's rooms stand in an MSR building only when nothing else is near (the
    // building's plan then takes them as its rooms, stage 3)
    const offLots = (k) => g.kind[k] !== K.LOT && offFloor(k);
    let last = first?.rect ?? { x: n.at[0] - 0.5, y: n.at[1] - 0.5, w: 1, d: 1 };
    const program = Object.entries(cp.program ?? {}).filter(([kind]) => kind !== "gate" && kind !== "vehicle-gate");
    let post = null;
    for (const [kind, count] of program.sort((a, b) => (a[0] === "guard-post" ? -1 : b[0] === "guard-post" ? 1 : 0))) {
      for (let i = 0; i < count; i++) {
        const near = kind === "guard-post" ? (first?.rect ?? last) : (post?.rect ?? last);
        // off the public floor first; on the checkpoint's own plaza only when nothing off it touches
        let found = null;
        for (const test of [offLots, offFloor, ok]) {
          found ??= kind === "guard-post" && gates.length ? findRect(g, rectCentre(near), sizeOf(kind), test, { radius: 8, near: gates, gap: test === ok ? 2 : 4 }) : findRect(g, rectCentre(near), sizeOf(kind), test, { radius: 8, touch: near }); // prettier-ignore
          if (!found && kind !== "guard-post") found = findRect(g, rectCentre(last), sizeOf(kind), test, { radius: 8, touch: last }); // prettier-ignore
        }
        if (!found) {
          rec.unplaced = `${cp.id}: no room for its ${kind} touching ${kind === "guard-post" ? "its gate" : "its post"} at ${cp.node}`; // prettier-ignore
          break;
        }
        const room = { kind, rect: found.rect, z: [z, r3(z + grid.storey)] };
        rec.rooms.push(room);
        take(g, found.cells, { id: cp.id, z0: z, z1: z + grid.storey, kind: "room" });
        last = found.rect;
        if (kind === "guard-post" && !post) post = room;
      }
      if (rec.unplaced) break;
    }
    checkpoints.push(rec);
  }

  // ── the MSR's hallways and passages: routed between posts, checkpoint posts, MSR buildings and portals ──
  const hallways = [];
  // a checkpoint's guard posts (the front gate has two): a hallway ends at the one nearest its other end
  const cpPosts = new Map(checkpoints.map((k) => [k.node, k.rooms.filter((r) => r.kind === "guard-post")]));
  const legs = [];
  for (const s of desc.streets.segments) if (s.class === "service") legs.push({ id: s.id, kind: "service", from: s.from, to: s.to, layer: W.nodes.get(s.from).layer }); // prettier-ignore
  for (const b of desc.buildings ?? []) for (const ps of b.passages ?? []) if ((ps.access ?? "public") === "msr") legs.push({ id: `${b.id}>${ps.to}`, kind: "passage", from: b.id, to: ps.to, layer: m.buildings.get(b.id).layer }); // prettier-ignore
  const posOf = (id) => W.nodes.get(id)?.at ?? m.buildings.get(id).at;
  const endOf = (id, layer, toward = null) => {
    const n = W.nodes.get(id);
    const at = n ? n.at : m.buildings.get(id).at;
    if (tileAt(desc, at) !== tile) return { id, out: true, at };
    if (n?.kind === "service") return postOf.get(id) ? { id, rect: postOf.get(id).rect, at } : { id, at, rect: { x: at[0] - 0.5, y: at[1] - 0.5, w: 1, d: 1 } }; // prettier-ignore
    const cp = cpPosts.get(id) ?? [];
    const near = toward ? [...cp].sort((p, q) => dist(rectCentre(p.rect), toward) - dist(rectCentre(q.rect), toward))[0] : cp[0]; // prettier-ignore
    if (n) return near ? { id, rect: near.rect, at } : { id, door: true, at };
    const lot = W.lotOfBuilding.get(id);
    return { id, rect: lot.rect, at, building: true };
  };
  for (const leg of legs) {
    if (!inTileLayer(leg.layer)) continue;
    const a = endOf(leg.from, leg.layer, posOf(leg.to));
    const b = endOf(leg.to, leg.layer, posOf(leg.from));
    if (a.out && b.out) continue;
    const g = W.grids.get(leg.layer);
    const L = layerById.get(leg.layer);
    // its portal on this tile's seam (a hallway through a third tile has one on each seam it crosses)
    const mine = (desc.tiles.portals ?? []).filter((p) => p.segment === leg.id || p.passage === leg.id);
    const portal = mine.find((p) => p.seam.split("|").includes(tile)) ?? mine[0];
    const res = route(g, L, leg, a.out ? { ...a, portal } : a, b.out ? { ...b, portal } : b);
    hallways.push(res);
  }

  function goalCells(g, end, leg) {
    if (end.out) {
      // the seam: where the straight line from the tile end leaves the tile (the portal's point when it has one)
      const at = end.portal?.at ?? null;
      const inner = leg.from === end.id ? endOf(leg.to, leg.layer) : endOf(leg.from, leg.layer);
      const p = at ?? clipPolyline([inner.at, end.at], site.tile.box)[0]?.at(-1) ?? end.at;
      const [ci, cj] = g.cellOf([Math.min(Math.max(p[0], g.box[0] + 0.01), g.box[2] - 0.01), Math.min(Math.max(p[1], g.box[1] + 0.01), g.box[3] - 0.01)]); // prettier-ignore
      const out = [];
      for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) if (g.inside(ci + di, cj + dj)) out.push([ci + di, cj + dj]);
      return { cells: out, seam: p };
    }
    if (end.door) {
      // a public node with no checkpoint here: an MSR door onto its floor, from the block beside it
      const floor = W.floorOf(end.id);
      const out = [];
      for (const [i, j] of g.cellsInBox([end.at[0] - NEAR, end.at[1] - NEAR, end.at[0] + NEAR, end.at[1] + NEAR])) {
        const k = g.idx(i, j);
        if ([K.BACK, K.FACADE].includes(g.kind[k]) && N4.some(([di, dj]) => g.inside(i + di, j + dj) && floor.has(g.owner[g.idx(i + di, j + dj)]))) out.push([i, j]); // prettier-ignore
      }
      return { cells: out };
    }
    return { cells: [...g.cellsInBox(box4(end.rect))] };
  }
  function route(g, L, leg, a, b) {
    const rec = { id: leg.id, kind: leg.kind, layer: leg.layer, from: leg.from, to: leg.to, width: HALL, z: [L.floor, r3(L.floor + HALL)], path: [], legs: [], length: 0, bridges: [], pierced: [], runs: [], posts: [] }; // prettier-ignore
    const ga = goalCells(g, a, leg);
    const gb = goalCells(g, b, leg);
    if (!ga.cells.length || !gb.cells.length) {
      rec.unrouted = `no ${!ga.cells.length ? "start" : "end"} for ${leg.id} in ${tile}`;
      return rec;
    }
    // an end's half cells: those whose 3 x 3 holds no public floor (so the hallway's width stays off it), if any
    const inner = (cs) => {
      const pub = (i, j) => g.inside(i, j) && (g.kind[g.idx(i, j)] === K.WAY || g.kind[g.idx(i, j)] === K.PLAZA);
      const ok = cs.filter(([i, j]) => [-1, 0, 1].every((di) => [-1, 0, 1].every((dj) => !pub(i + di, j + dj))));
      return ok.length ? ok : cs;
    };
    const startSet = new Set(inner(ga.cells).map(([i, j]) => g.idx(i, j)));
    const goalSet = new Set(inner(gb.cells).map(([i, j]) => g.idx(i, j)));
    const roomEnd = new Set([...(a.out ? [] : startSet), ...(b.out ? [] : goalSet)]);
    const ends = (k) => roomEnd.has(k);
    const endIds = new Set([`post_${leg.from}`, `post_${leg.to}`, ...checkpoints.filter((k) => k.node === leg.from || k.node === leg.to).map((k) => k.id)]); // prettier-ignore
    const okEntry = (e) => endIds.has(e.id) || e.kind === "hall";
    const isPub = (k) => g.kind[k] === K.WAY || g.kind[k] === K.PLAZA;
    // a step's mode: on the ground, or a bridge where any of its 3 x 3 half cells is public floor (the bridge
    // reaches half a cell past the way each side), at the height of the highest clearance under it: of every way
    // whose band meets the half cell, not only the one the raster gave it to (near a node two ways' bands overlap,
    // and a bridge at the lower one's clearance would stand in the other)
    const clearAt = W.clearUnder(leg.layer);
    const modeOf = (i, j) => {
      if (ends(g.idx(i, j))) return 0;
      let bz = 0;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (g.inside(i + di, j + dj) && isPub(g.idx(i + di, j + dj))) bz = Math.max(bz, clearAt[g.idx(i + di, j + dj)]); // prettier-ignore
      return bz;
    };
    const cellOkAt = (k, z0, z1, bridge) => {
      if (ends(k)) return true;
      const kind = g.kind[k];
      if (kind === K.LOT && !msrLot(W.lotById.get(g.owner[k]))) return false;
      if (!bridge && isPub(k)) return false;
      return !conflicts(g, k, z0, z1, okEntry);
    };
    const stepCache = new Map();
    const stepOk = (i, j) => {
      const key = g.idx(i, j);
      if (stepCache.has(key)) return stepCache.get(key);
      const bz = modeOf(i, j);
      const z0 = L.floor + bz;
      let ok = z0 + HALL <= L.top + 1e-9;
      for (let di = -1; di <= 1 && ok; di++) for (let dj = -1; dj <= 1 && ok; dj++) if (g.inside(i + di, j + dj)) ok = cellOkAt(g.idx(i + di, j + dj), z0, z0 + HALL, bz > 0); // prettier-ignore
      stepCache.set(key, ok);
      return ok;
    };
    const endStepOk = (i, j) => {
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (g.inside(i + di, j + dj) && !ends(g.idx(i + di, j + dj)) && conflicts(g, g.idx(i + di, j + dj), L.floor, L.floor + HALL, okEntry)) return false; // prettier-ignore
      return true;
    };
    const stepCost = (i, j) => {
      const k = g.idx(i, j);
      if (ends(k)) return 1;
      if (modeOf(i, j) > 0) return 2; // a bridge: dearer than the ground, cheaper than a long way round
      return g.kind[k] === K.FACADE ? 2.5 : 1;
    };
    const heap = new Heap();
    const best = new Map();
    const prev = new Map();
    const target = [...goalSet].reduce((s, k) => [s[0] + (k % g.nx) / goalSet.size, s[1] + Math.floor(k / g.nx) / goalSet.size], [0, 0]); // prettier-ignore
    // orthogonal steps only (the rulebook's circulation.axial: a hallway or a bridge runs along the axes of the
    // streets and plazas, never a diagonal leg over them), each turn charged TURN steps so a leg runs straight and
    // turns once rather than stepping a staircase; a state is a half cell and the direction it was entered by
    const manhattan = (x, y) => Math.abs(x - target[0]) + Math.abs(y - target[1]);
    const S = (k, dir) => k * 4 + dir;
    for (const k of startSet) {
      for (let dir = 0; dir < 4; dir++) best.set(S(k, dir), 0), heap.push(manhattan(k % g.nx, Math.floor(k / g.nx)), S(k, dir));
    }
    let found = null;
    while (heap.size) {
      const [, s] = heap.pop();
      const [k, dir] = [Math.floor(s / 4), s % 4];
      if (goalSet.has(k)) {
        found = s;
        break;
      }
      const [i, j] = [k % g.nx, Math.floor(k / g.nx)];
      N4.forEach(([di, dj], nd4) => {
        const [x, y] = [i + di, j + dj];
        if (!g.inside(x, y)) return;
        const kk = g.idx(x, y);
        if (!ends(kk) && !stepOk(x, y)) return; // a seam end is walked like any step: bridged where the seam is public
        if (ends(kk) && !endStepOk(x, y)) return; // into its room: the hallway's width beside it clear of every piece
        const turn = nd4 !== dir && !startSet.has(k) ? TURN : 0;
        const nd = best.get(s) + stepCost(x, y) + turn;
        const ss = S(kk, nd4);
        if (nd < (best.get(ss) ?? Infinity) - 1e-9) {
          best.set(ss, nd);
          prev.set(ss, s);
          heap.push(nd + manhattan(x, y), ss);
        }
      });
    }
    if (found === null) {
      rec.unrouted = `no way for ${leg.kind} ${leg.id} from ${leg.from} to ${leg.to} in ${tile} that keeps off the public floor (or bridges it) and off every building and piece, on the axes`; // prettier-ignore
      return rec;
    }
    const cells = [];
    for (let s = found; s !== undefined; s = prev.get(s)) cells.push(Math.floor(s / 4));
    cells.reverse();
    const ij = (k) => [k % g.nx, Math.floor(k / g.nx)];
    const pts = cells.map((k) => g.centre(...ij(k)));
    const zs = cells.map((k) => modeOf(...ij(k)));
    // the length walked to each cell (a diagonal step RES x sqrt 2)
    const acc = [0];
    for (let idx = 1; idx < cells.length; idx++) acc.push(acc[idx - 1] + Math.hypot(pts[idx][0] - pts[idx - 1][0], pts[idx][1] - pts[idx - 1][1]));
    // legs: straight stretches at one height (a turn or a change of height starts the next)
    let s0 = 0;
    for (let idx = 1; idx <= cells.length; idx++) {
      const last = idx === cells.length;
      const heightChange = !last && zs[idx] !== zs[s0];
      const turn = !last && !heightChange && idx - s0 >= 1 && idx >= 2 && (pts[idx][0] - pts[idx - 1][0]) * (pts[idx - 1][1] - pts[idx - 2][1]) - (pts[idx][1] - pts[idx - 1][1]) * (pts[idx - 1][0] - pts[idx - 2][0]) !== 0; // prettier-ignore
      if (last || heightChange || turn) {
        rec.legs.push({ from: pts[s0].map(r3), to: pts[idx - 1].map(r3), z: [r3(L.floor + zs[s0]), r3(L.floor + zs[s0] + HALL)] }); // prettier-ignore
        s0 = turn ? idx - 1 : idx;
      }
    }
    const corners = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const [p, q, r] = [pts[i - 1], pts[i], pts[i + 1]];
      if ((q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]) !== 0) corners.push(q);
    }
    if (pts.length > 1) corners.push(pts[pts.length - 1]);
    rec.path = corners.map((p) => [r3(p[0]), r3(p[1])]);
    rec.length = r3(acc[cells.length - 1]);
    if (ga.seam || gb.seam) rec.seam = (ga.seam ?? gb.seam).map(r3);
    const pierced = new Set();
    let run = null;
    cells.forEach((k, idx) => {
      if (g.kind[k] === K.FACADE) pierced.add(g.owner[k]);
      if (zs[idx] > 0) {
        // a bridge is straight: at a turn the one so far ends at the corner and the next leaves it
        const turned = run && idx >= 2 && (pts[idx][0] - pts[idx - 1][0]) * (pts[idx - 1][1] - pts[idx - 2][1]) - (pts[idx][1] - pts[idx - 1][1]) * (pts[idx - 1][0] - pts[idx - 2][0]) !== 0; // prettier-ignore
        if (turned) {
          rec.bridges.push({ over: [...run.over].sort(), from: run.from.map(r3), to: run.to.map(r3), z: [r3(L.floor + run.z), r3(L.floor + run.z + HALL)] }); // prettier-ignore
          run = { over: new Set(), from: pts[idx - 1], to: pts[idx - 1], z: run.z };
        }
        if (!run) run = { over: new Set(), from: pts[idx], to: pts[idx], z: zs[idx] };
        const [i, j] = ij(k);
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (g.inside(i + di, j + dj) && isPub(g.idx(i + di, j + dj))) run.over.add(g.owner[g.idx(i + di, j + dj)]); // prettier-ignore
        run.to = pts[idx];
        run.z = Math.max(run.z, zs[idx]);
      } else if (run) {
        rec.bridges.push({ over: [...run.over].sort(), from: run.from.map(r3), to: run.to.map(r3), z: [r3(L.floor + run.z), r3(L.floor + run.z + HALL)] }); // prettier-ignore
        run = null;
      }
    });
    if (run) rec.bridges.push({ over: [...run.over].sort(), from: run.from.map(r3), to: run.to.map(r3), z: [r3(L.floor + run.z), r3(L.floor + run.z + HALL)] }); // prettier-ignore
    rec.pierced = [...pierced].sort();
    // the hallway's cells taken at their heights
    const seen = new Set();
    cells.forEach((k, idx) => {
      const [i, j] = ij(k);
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++) {
          if (!g.inside(i + di, j + dj)) continue;
          const kk = g.idx(i + di, j + dj);
          const key = `${kk}:${zs[idx]}`;
          if (seen.has(key)) continue;
          seen.add(key);
          (g.taken[kk] ??= []).push({ id: leg.id, z0: L.floor + zs[idx], z1: L.floor + zs[idx] + HALL, kind: "hall" });
        }
    });
    // runs between posts: over maxServiceRun, a post added on the path before the limit, on the ground off public floor
    const maxRun = desc.rules?.msr?.maxServiceRun ?? Infinity;
    let lastPost = 0;
    for (let idx = 1; idx < cells.length; idx++) {
      if (acc[idx] - acc[lastPost] <= maxRun - 1 || acc[cells.length - 1] - acc[lastPost] <= maxRun) continue;
      let placedPost = null;
      for (let at = idx; at > lastPost + 2 && !placedPost; at--) {
        if (zs[at] > 0) continue;
        const p = pts[at];
        for (const [ox, oy] of [[0, 0], [-0.5, 0], [0, -0.5], [-0.5, -0.5], [0.5, 0], [0, 0.5], [0.5, 0.5]]) {
          const r = { x: Math.round((p[0] - 1 + ox) * 2) / 2, y: Math.round((p[1] - 1 + oy) * 2) / 2, w: 2, d: 2 };
          if (!pointInBox(p, box4(r))) continue;
          const cs = [...g.cellsInBox(box4(r))];
          const fine = cs.length === 16 && cs.every(([i, j]) => {
            const kk = g.idx(i, j);
            const kind = g.kind[kk];
            if (isPub(kk) || (kind === K.LOT && !msrLot(W.lotById.get(g.owner[kk])))) return false;
            return !conflicts(g, kk, L.floor, L.floor + grid.storey, (e) => e.id === leg.id || e.kind === "hall");
          });
          if (fine) {
            placedPost = { at, r, cs };
            break;
          }
        }
      }
      if (!placedPost) break;
      const post = { id: `post_${leg.id}_${rec.posts.length + 1}`, node: null, kind: "guard-post", layer: leg.layer, z: [L.floor, r3(L.floor + grid.storey)], rect: placedPost.r, reason: `breaks ${leg.id} under maxServiceRun ${maxRun}` }; // prettier-ignore
      take(g, placedPost.cs, { id: post.id, z0: L.floor, z1: L.floor + grid.storey, kind: "post" });
      rec.runs.push(r3(acc[placedPost.at] - acc[lastPost]));
      rec.posts.push(post.id);
      posts.push(post);
      lastPost = placedPost.at;
      idx = lastPost;
    }
    rec.runs.push(r3(acc[cells.length - 1] - acc[lastPost]));
    return rec;
  }

  // ── spawns ──
  const sp = desc.spawns ?? { count: 0, minSpacing: 0 };
  const share = spawnShare(desc, site);
  const target = Math.ceil((sp.count ?? 0) * share.share - 1e-9);
  const keep = keepClear(desc, site, lotsArt, { connectors, checkpoints }, W);
  const spawns = [];
  const candidates = [];
  for (const L of W.layers) {
    if (L.gated) continue;
    const g = W.grids.get(L.id);
    for (let j = 1; j < g.ny - 1; j++)
      for (let i = 1; i < g.nx - 1; i++) {
        let ok = true;
        for (let di = -1; di <= 1 && ok; di++)
          for (let dj = -1; dj <= 1 && ok; dj++) {
            const k = g.idx(i + di, j + dj);
            ok = (g.kind[k] === K.WAY || g.kind[k] === K.PLAZA) && !conflicts(g, k, L.floor, L.floor + 1) && !keep.get(L.id).has(k);
          }
        if (ok) candidates.push([L, i, j]);
      }
  }
  const rng = seeded(seedOf(ctx.params.seed, `${tile}:spawns`));
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  for (const [L, i, j] of candidates) {
    if (spawns.length >= target) break;
    const g = W.grids.get(L.id);
    const p = g.centre(i, j);
    if (spawns.some((s) => s.layer === L.id && dist(s.at, p) < (sp.minSpacing ?? 0) - 1e-9)) continue;
    const k = g.idx(i, j);
    const district = g.district[k] ?? null;
    spawns.push({ layer: L.id, district, group: `${L.id}:${district}`, at: [r3(p[0]), r3(p[1])], z: L.floor, on: g.owner[k] });
  }
  // interleaved by group (TS reads the first 32 it finds): one of each group in turn
  const groups = new Map();
  for (const s of spawns.sort((a, b) => (a.group < b.group ? -1 : a.group > b.group ? 1 : a.at[0] - b.at[0] || a.at[1] - b.at[1]))) (groups.get(s.group) ?? groups.set(s.group, []).get(s.group)).push(s); // prettier-ignore
  const ordered = [];
  for (let round = 0; ordered.length < spawns.length; round++) for (const list of groups.values()) if (list[round]) ordered.push(list[round]);
  ordered.forEach((s, i) => (s.id = `spawn_${tile}_${String(i + 1).padStart(2, "0")}`));

  // ── the colonnades (a square's, a way's porticoes): the columns nothing of this stage stands on ──
  const colonnades = [];
  const keepColumns = (ref, layer, P, depth) => {
    const L = layerById.get(layer);
    if (!L) return null;
    const z1 = L.floor + P.height;
    const blockers = columnBlockers({ connectors, checkpoints, posts, hallways }, layer, L.floor, z1, doorLanes(desc, lotsArt, ref, depth)); // prettier-ignore
    const kept = [];
    const dropped = [];
    for (const c of P.columns) {
      const hit = blockers.find((b) => polyOverlap(columnPoly(c.at, P.column), b.poly) > 1e-6);
      if (hit) dropped.push({ at: c.at, side: c.side, why: hit.what });
      else kept.push(c);
    }
    if (dropped.length) notes.push(`colonnade: ${ref} leaves out ${dropped.length} of its ${P.columns.length} columns where ${[...new Set(dropped.map((d) => d.why))].slice(0, 4).join(", ")} stand`); // prettier-ignore
    return { ref, layer, z: [L.floor, r3(z1)], depth: P.depth, column: P.column, columns: kept, dropped };
  };
  for (const p of site.plazas) {
    if (!p.portico || p.tile !== tile) continue;
    const col = keepColumns(p.id, p.layer, p.portico, porticoDoorDepth(p.portico.depth, p.portico.column));
    if (col) colonnades.push({ plaza: p.id, way: null, ...col, line: p.portico.line });
  }
  for (const w of site.ways) {
    if (!w.colonnade?.columns.length) continue;
    const C = w.colonnade;
    const col = keepColumns(w.id, w.layer, C, porticoDoorDepth(w.width / 2 - C.offset, C.column));
    if (col) colonnades.push({ plaza: null, way: w.id, ...col, offset: C.offset, band: C.band });
  }

  const artifact = { tile: site.tile, connectors, checkpoints, posts, hallways, colonnades, spawns: ordered, notes };
  artifact.measures = {
    walk: measureWalk(desc, site, lotsArt, artifact),
    spawns: { target, placed: ordered.length, share: r3(share.share), tileFloor: r3(share.tile), cityFloor: r3(share.city), groups: groups.size }, // prettier-ignore
    service: { hallways: hallways.length, total: r3(hallways.reduce((s, h) => s + h.length, 0)), described: r3(serviceDescribed(desc, site)), longestRun: r3(Math.max(0, ...hallways.flatMap((h) => h.runs))), bridges: hallways.reduce((s, h) => s + h.bridges.length, 0), postsAdded: posts.filter((p) => !p.node).length }, // prettier-ignore
    connectors: { placed: connectors.filter((c) => !c.unplaced).length, unplaced: connectors.filter((c) => c.unplaced).length, facadesTaken: [...new Set(connectors.flatMap((c) => c.facadesTaken))].length }, // prettier-ignore
  };
  return artifact;
}

/** The service hallways' and MSR passages' length inside the tile as the description draws them (straight, node to node). */
export function serviceDescribed(desc, site) {
  const m = measured(desc);
  let total = 0;
  for (const s of m.segments.values()) {
    if (s.class !== "service" || !site.layers.some((L) => L.id === s.layer)) continue;
    total += clipPolyline([m.nodes.get(s.from).at, m.nodes.get(s.to).at], site.tile.box).reduce((t, pl) => t + dist(pl[0], pl[pl.length - 1]), 0); // prettier-ignore
  }
  for (const b of m.buildings.values())
    for (const ps of b.passages ?? []) {
      if ((ps.access ?? "public") !== "msr" || !site.layers.some((L) => L.id === b.layer)) continue;
      total += clipPolyline([b.at, m.posOf(ps.to)], site.tile.box).reduce((t, pl) => t + dist(pl[0], pl[pl.length - 1]), 0);
    }
  return total;
}

/** A monument's base as a polygon (cells). */
export const monumentPoly = (mo) => rectPoly({ x: mo.at[0] - mo.base[0] / 2, y: mo.at[1] - mo.base[1] / 2, w: mo.base[0], d: mo.base[1] });
/** A column's footprint as a polygon (cells): a square of its width round its centre. */
export const columnPoly = (at, w) => rectPoly({ x: at[0] - w / 2, y: at[1] - w / 2, w, d: w });
/**
 * An enterable lot's street door kept clear (keepClear's band: the door's width and 0.3 m each side, out of its
 * front by the approach and the leaf's swing), or as far out as `depth` cells when that is deeper: a door under a
 * portico keeps its way across the portico to the column line open.
 */
export function doorApproach(desc, lot, depth = null) {
  const p = pointOnSide(lot.rect, lot.frontage.side, lot.frontage.door.at);
  const n = NORMAL[lot.frontage.side];
  const w = lot.frontage.door.width_m / desc.grid.cell + 2 * (0.3 / desc.grid.cell);
  const d = Math.max(1.2 / desc.grid.cell + w, depth ?? 0); // the approach and the leaf's swing
  return bandPoly(p, [p[0] + n[0] * d, p[1] + n[1] * d], w);
}
/** How far a door's approach reaches under a portico: across it to past its column line (the line `toLine` cells from the building line). */
export const porticoDoorDepth = (toLine, column) => r3(toLine + column / 2 + 0.05);
/** The doors fronting a square or a way (`ref`), their approaches `depth` deep: what a colonnade's column may not stand in. */
export function doorLanes(desc, lotsArt, ref, depth) {
  return (lotsArt?.lots ?? []).filter((l) => l.kind === "enterable" && l.frontage?.way === ref && l.frontage.door).map((l) => ({ what: `${l.building}'s door`, poly: doorApproach(desc, l, depth) })); // prettier-ignore
}

/** What a portico's column may not stand in on a layer between z0 and z1: pieces, exits' approaches, gates, rooms, posts, hallways on the ground, and `doors` (doorLanes). */
export function columnBlockers(net, layer, z0, z1, doors = []) {
  const out = [...doors];
  const zHit = (z) => z[0] < z1 - 1e-6 && z[1] > z0 + 1e-6;
  for (const c of net.connectors) {
    for (const p of c.pieces) if (p.kind !== "car" && zHit(p.z)) out.push({ what: `${c.id}'s ${p.kind}`, poly: p.poly });
    for (const e of c.exits) if (e.layer === layer) out.push({ what: `${c.id}'s exit`, poly: e.approach });
  }
  for (const k of net.checkpoints) if (k.layer === layer) for (const r of k.rooms) out.push({ what: `${k.id}'s ${r.kind}`, poly: r.poly ?? rectPoly(r.rect) }); // prettier-ignore
  for (const p of net.posts) if (p.layer === layer) out.push({ what: p.id, poly: rectPoly(p.rect) });
  for (const h of net.hallways)
    for (const lg of h.legs ?? []) {
      if (h.layer !== layer || !zHit(lg.z)) continue;
      const L = Math.hypot(lg.to[0] - lg.from[0], lg.to[1] - lg.from[1]);
      const u = L ? [(lg.to[0] - lg.from[0]) / L, (lg.to[1] - lg.from[1]) / L] : [1, 0];
      out.push({ what: `hallway ${h.id}`, poly: bandPoly([lg.from[0] - u[0] * 0.75, lg.from[1] - u[1] * 0.75], [lg.to[0] + u[0] * 0.75, lg.to[1] + u[1] * 0.75], HALL) }); // prettier-ignore
    }
  return out;
}

/** The tile's share of the spawnable floor (public ways and plazas of layers that are not gated), from the description. */
export function spawnShare(desc, site) {
  const m = measured(desc);
  const tb = site.tile.box;
  const gated = new Set(desc.layers.filter((L) => L.gated).map((L) => L.id));
  const plazaBoxes = [...m.nodes.values()].filter((n) => n.size).map((n) => [n.id, [n.at[0] - n.size[0] / 2, n.at[1] - n.size[1] / 2, n.at[0] + n.size[0] / 2, n.at[1] + n.size[1] / 2], n.layer]); // prettier-ignore
  let city = 0;
  let tile = 0;
  const clipArea = (b, r) => Math.max(0, Math.min(b[2], r[2]) - Math.max(b[0], r[0])) * Math.max(0, Math.min(b[3], r[3]) - Math.max(b[1], r[1])); // prettier-ignore
  for (const s of m.segments.values()) {
    if (gated.has(s.layer) || s.class === "service" || s.access !== "public") continue;
    const a = m.nodes.get(s.from).at;
    const b = m.nodes.get(s.to).at;
    const walked = s.class === "canal" ? 2 * s.sidewalk : s.width;
    // the length outside the plazas at its ends, scaled for a winding way
    const n = Math.max(2, Math.ceil(s.straight * 4));
    let out = 0;
    let inTile = 0;
    for (let i = 0; i < n; i++) {
      const p = [a[0] + ((b[0] - a[0]) * (i + 0.5)) / n, a[1] + ((b[1] - a[1]) * (i + 0.5)) / n];
      if (plazaBoxes.some(([id, bx, lid]) => lid === s.layer && (id === s.from || id === s.to) && pointInBox(p, bx))) continue;
      out++;
      if (pointInBox(p, tb)) inTile++;
    }
    city += (out / n) * s.length * walked;
    tile += (inTile / n) * s.length * walked;
  }
  for (const [, bx, lid] of plazaBoxes) {
    if (gated.has(lid)) continue;
    city += (bx[2] - bx[0]) * (bx[3] - bx[1]);
    tile += clipArea(bx, tb);
  }
  return { city, tile, share: city ? tile / city : 0 };
}

/** The half cells nothing may stand on (spawns): every enterable door's approach, every exit's approach and landing, every gate. */
export function keepClear(desc, site, lotsArt, net, W) {
  const out = new Map(W.layers.map((L) => [L.id, new Set()]));
  const add = (lid, poly) => {
    const g = W.grids.get(lid);
    if (!g) return;
    for (const [i, j] of g.cellsInPoly(poly)) out.get(lid).add(g.idx(i, j));
  };
  const rb = desc.__rulebook;
  void rb;
  for (const lot of lotsArt.lots) if (lot.kind === "enterable") add(lot.layer, doorApproach(desc, lot));
  for (const c of net.connectors) for (const e of c.exits) add(e.layer, e.approach);
  for (const k of net.checkpoints) for (const r of k.rooms) if (r.kind === "gate") add(k.layer, growPoly(r.poly ?? rectPoly(r.rect), 1));
  return out;
}

/**
 * The walk to a public connector measured on the real footprints: each layer's public floor on the half-cell grid
 * (ways and plazas less every piece, room, lot and post standing on it; gates passable), walked 8-ways from every
 * public connector's exit, and from each way's portal at the description's own walk from there to the nearest
 * public connector outside the tile. Returns the farthest node and door per layer, the p90 of the floor, and what
 * no walk reaches.
 */
export function measureWalk(desc, site, lotsArt, net) {
  const W = world(desc, site, lotsArt);
  const m = measured(desc);
  const tile = site.tile.id;
  // the floor each layer: public cells less what stands at walking height
  const pub = new Map();
  for (const L of W.layers) {
    const g = W.grids.get(L.id);
    const open = new Uint8Array(g.nx * g.ny);
    for (let k = 0; k < open.length; k++) open[k] = g.kind[k] === K.WAY || g.kind[k] === K.PLAZA ? 1 : 0;
    const block = (poly, z0, z1) => {
      if (!(z0 < L.floor + 0.56 && z1 > L.floor + 1e-6)) return;
      for (const [i, j] of g.cellsInPoly(poly)) open[g.idx(i, j)] = 0;
    };
    for (const c of net.connectors) for (const p of c.pieces) if (p.kind !== "car" && p.kind !== "flight" && p.kind !== "landing") block(p.poly, p.z[0], p.z[1]); // prettier-ignore
    for (const c of net.connectors) if (c.form === "straight") for (const p of c.pieces) block(p.poly, p.z[0], p.z[1]);
    for (const k of net.checkpoints) if (k.layer === L.id) for (const r of k.rooms) if (r.kind !== "gate") block(rectPoly(r.rect), r.z[0], r.z[1]); // prettier-ignore
    for (const p of net.posts) if (p.layer === L.id) block(rectPoly(p.rect), p.z[0], p.z[1]);
    for (const p of site.plazas) if (p.layer === L.id) for (const mo of p.monuments ?? []) block(monumentPoly(mo), mo.z[0], mo.z[1]); // prettier-ignore
    pub.set(L.id, { g, open });
  }
  // seeds: public connector exits in the tile; portals at the description's walk to a connector outside the tile
  const seeds = new Map(W.layers.map((L) => [L.id, []]));
  for (const c of net.connectors) {
    if (c.access !== "public" || c.type === "secret" || c.unplaced) continue;
    for (const e of c.exits) {
      const P = pub.get(e.layer);
      if (!P) continue;
      for (const [i, j] of P.g.cellsInPoly(e.approach)) {
        P.open[P.g.idx(i, j)] = 1;
        seeds.get(e.layer).push([P.g.idx(i, j), 0]);
      }
    }
  }
  const adj = new Map();
  const addE = (a, b, len) => ((adj.get(a) ?? adj.set(a, []).get(a)).push([b, len]), (adj.get(b) ?? adj.set(b, []).get(b)).push([a, len])); // prettier-ignore
  for (const e of m.edges) if (!e.secret && e.access === "public" && e.kind !== "connector") addE(e.a, e.b, e.length);
  for (const L of W.layers) {
    const starts = new Set();
    for (const c of m.connectors) {
      if (c.type === "secret" || c.access !== "public") continue;
      for (const s of c.stops) if (m.layerOf(s) === L.id && tileAt(desc, m.posOf(s)) !== tile) starts.add(m.vertexOf(s));
    }
    const d = shortest(adj, [...starts]);
    const P = pub.get(L.id);
    for (const w of site.ways) {
      if (w.layer !== L.id || w.access !== "public" || w.class === "service") continue;
      const s = m.segments.get(w.id);
      for (const cap of w.caps) {
        if (!cap.seam) continue;
        const a = m.nodes.get(s.from).at;
        const x = (dist(a, cap.at) * s.length) / (s.straight || 1);
        const dd = Math.min((d.get(`n:${s.from}`) ?? Infinity) + x, (d.get(`n:${s.to}`) ?? Infinity) + (s.length - x), (d.get(`s:${s.id}`) ?? Infinity) + Math.abs(s.length / 2 - x)); // prettier-ignore
        if (!Number.isFinite(dd)) continue;
        // the way's cells along the seam, inside the tile
        for (let j = 0; j < P.g.ny; j++)
          for (let i = 0; i < P.g.nx; i++) {
            const k = P.g.idx(i, j);
            if (!P.open[k] || P.g.owner[k] !== w.id) continue;
            const c = P.g.centre(i, j);
            const edge = Math.min(c[0] - P.g.box[0], P.g.box[2] - c[0], c[1] - P.g.box[1], P.g.box[3] - c[1]);
            if (edge <= RES && dist(c, cap.at) <= w.width) seeds.get(L.id).push([k, dd + dist(c, cap.at)]);
          }
      }
    }
  }
  // walk each layer
  const out = { byLayer: {}, p90: null, maxWalk: null, unreached: [], samples: 0 };
  const all = [];
  let worst = { id: null, d: 0 };
  for (const L of W.layers) {
    const { g, open } = pub.get(L.id);
    const d = new Float64Array(g.nx * g.ny).fill(Infinity);
    const heap = new Heap();
    for (const [k, v] of seeds.get(L.id)) if (v < d[k]) (d[k] = v), heap.push(v, k);
    while (heap.size) {
      const [dk, k] = heap.pop();
      if (dk > d[k]) continue;
      const [i, j] = [k % g.nx, Math.floor(k / g.nx)];
      for (const [di, dj, c] of N8) {
        const [x, y] = [i + di, j + dj];
        if (!g.inside(x, y)) continue;
        const kk = g.idx(x, y);
        if (!open[kk]) continue;
        if (di && dj && !(open[g.idx(i + di, j)] && open[g.idx(i, j + dj)])) continue; // no corner cutting
        const nd = dk + c * RES;
        if (nd < d[kk] - 1e-9) (d[kk] = nd), heap.push(nd, kk);
      }
    }
    const at = (p) => {
      const [i, j] = g.cellOf(p);
      let best = Infinity;
      for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) if (g.inside(i + di, j + dj) && open[g.idx(i + di, j + dj)]) best = Math.min(best, d[g.idx(i + di, j + dj)] + Math.hypot(di, dj) * RES); // prettier-ignore
      return best;
    };
    // a node is reached when its floor is: a plaza any of its open half cells, a junction within its widest way
    const floorAt = (n) => {
      if (n.size) {
        let best = Infinity;
        for (let k = 0; k < open.length; k++) if (open[k] && g.owner[k] === n.id) best = Math.min(best, d[k]);
        if (Number.isFinite(best)) return best;
      }
      const half = Math.max(1, ...site.ways.filter((w) => (w.from === n.id || w.to === n.id) && w.class !== "service").map((w) => w.width / 2)); // prettier-ignore
      let best = at(n.at);
      for (const [i, j] of g.cellsInBox([n.at[0] - half, n.at[1] - half, n.at[0] + half, n.at[1] + half])) {
        const k = g.idx(i, j);
        if (open[k] && dist(g.centre(i, j), n.at) <= half) best = Math.min(best, d[k] + dist(g.centre(i, j), n.at));
      }
      return best;
    };
    const things = [];
    for (const n of site.nodes) if (n.layer === L.id && n.inTile && n.kind !== "service") things.push([n.id, floorAt(n)]);
    for (const lot of lotsArt.lots) {
      if (lot.layer !== L.id || lot.kind !== "enterable") continue;
      const p = pointOnSide(lot.rect, lot.frontage.side, lot.frontage.door.at);
      const n = NORMAL[lot.frontage.side];
      things.push([`${lot.building} (door)`, at([p[0] + n[0] * 0.5, p[1] + n[1] * 0.5])]);
    }
    let lw = { id: null, d: 0 };
    for (const [id, v] of things) {
      if (!Number.isFinite(v)) out.unreached.push(`${id} on ${L.id}`);
      else if (v > lw.d) lw = { id, d: v };
    }
    if (lw.d > worst.d) worst = { ...lw, layer: L.id };
    const samples = [];
    let cut = 0;
    for (let k = 0; k < open.length; k++) if (open[k] && (g.kind[k] === K.WAY || g.kind[k] === K.PLAZA)) Number.isFinite(d[k]) ? samples.push(d[k]) : cut++;
    samples.sort((p, q) => p - q);
    all.push(...samples);
    out.byLayer[L.id] = { farthest: lw.id, distance: r3(lw.d), p90: samples.length ? r3(samples[Math.min(samples.length - 1, Math.ceil(0.9 * samples.length) - 1)]) : null, floorCells: r3(samples.length * RES * RES), cutOffCells: r3(cut * RES * RES) }; // prettier-ignore
  }
  all.sort((p, q) => p - q);
  out.samples = all.length;
  out.p90 = all.length ? r3(all[Math.min(all.length - 1, Math.ceil(0.9 * all.length) - 1)]) : null;
  out.maxWalk = { id: worst.id, layer: worst.layer ?? null, distance: r3(worst.d) };
  return out;
}

/** Every solid the stage placed or found, as convex polygons with a z range, for the overlap gate. */
function solids(desc, site, lotsArt, a, W) {
  const S = [];
  // the rooms a hallway ends in: its nodes' posts and their checkpoints' guard posts
  const endRooms = (h) => [h.from, h.to].flatMap((id) => [...a.posts.filter((p) => p.node === id).map((p) => p.rect), ...a.checkpoints.filter((k) => k.node === id).flatMap((k) => k.rooms.filter((r) => r.kind === "guard-post").map((r) => r.rect))]); // prettier-ignore
  const zOfL = new Map(site.layers.map((L) => [L.id, L]));
  for (const c of a.connectors) {
    for (const p of c.pieces) if (p.kind !== "car" && p.kind !== "flight" && p.kind !== "landing") S.push({ what: `${c.id}'s ${p.kind}`, owner: c.id, kind: "piece", conn: c, poly: p.poly, z: p.z }); // prettier-ignore
    if (c.form === "straight") for (const p of c.pieces) if (p.kind === "flight" || p.kind === "landing") S.push({ what: `${c.id}'s ${p.kind}`, owner: c.id, kind: "piece", conn: c, poly: p.poly, z: p.z }); // prettier-ignore
    for (const e of c.exits) S.push({ what: `${c.id}'s exit approach at ${e.stop}`, owner: c.id, kind: "approach", conn: c, stop: e.stop, poly: e.approach, z: [e.z, r3(e.z + (c.dims.headroom ?? 0.75))] }); // prettier-ignore
  }
  for (const k of a.checkpoints) for (const r of k.rooms) S.push({ what: `${k.id}'s ${r.kind}`, owner: k.id, kind: r.kind === "gate" ? "gate" : "room", cp: k, fronts: r.fronts, poly: r.poly ?? rectPoly(r.rect), z: r.z }); // prettier-ignore
  for (const p of a.posts) S.push({ what: `${p.id}`, owner: p.id, kind: "post", node: p.node, poly: rectPoly(p.rect), z: p.z });
  for (const h of a.hallways)
    for (const leg of h.legs ?? []) {
      // a leg covers its half cells' squares: a quarter cell past its end centres, HALL across
      const L = Math.hypot(leg.to[0] - leg.from[0], leg.to[1] - leg.from[1]);
      const u = L ? [(leg.to[0] - leg.from[0]) / L, (leg.to[1] - leg.from[1]) / L] : [1, 0];
      const a0 = [leg.from[0] - u[0] * 0.25, leg.from[1] - u[1] * 0.25];
      const a1 = [leg.to[0] + u[0] * 0.25, leg.to[1] + u[1] * 0.25];
      const arrives = endRooms(h).some((r) => [leg.from, leg.to].some((p) => pointInBox(p, box4(r))));
      S.push({ what: `hallway ${h.id}`, owner: h.id, kind: "hall", hall: h, arrives, poly: bandPoly(a0, a1, HALL - 0.04), z: leg.z, ends: [h.from, h.to] }); // prettier-ignore
    }
  for (const lot of lotsArt.lots) if (lot.kind === "enterable") S.push({ what: `building ${lot.building}`, owner: lot.id, kind: "lot", lot, poly: rectPoly(lot.rect), z: [lot.zBase, r3(lot.zBase + lot.storeys * desc.grid.storey)] }); // prettier-ignore
  for (const w of site.ways) {
    if (w.class === "service") continue;
    for (const part of w.parts) for (let i = 1; i < part.length; i++) S.push({ what: `${w.class} ${w.id}`, owner: w.id, kind: "way", way: w, poly: bandPoly(part[i - 1], part[i], w.width - 0.02), z: [w.z, r3(w.z + w.clearance)] }); // prettier-ignore
  }
  for (const p of site.plazas) S.push({ what: `plaza ${p.id}`, owner: p.id, kind: "plaza", poly: rectPoly({ x: p.box[0], y: p.box[1], w: p.box[2] - p.box[0], d: p.box[3] - p.box[1] }), z: [p.z, r3(p.z + W.clearanceOf(p.id))] }); // prettier-ignore
  for (const p of site.plazas) for (const mo of p.monuments ?? []) S.push({ what: `monument ${mo.id}`, owner: mo.id, kind: "monument", plaza: p.id, poly: monumentPoly(mo), z: mo.z }); // prettier-ignore
  for (const s of a.spawns) {
    const h = 0.3; // the hull and its margin, about 0.56 cells across
    S.push({ what: `spawn ${s.id}`, owner: s.id, kind: "spawn", poly: rectPoly({ x: s.at[0] - h, y: s.at[1] - h, w: 2 * h, d: 2 * h }), z: [s.z, r3(s.z + 0.6)] }); // prettier-ignore
  }
  return S;
}

function gate(a, ctx) {
  const failures = [];
  const notes = [...(a.notes ?? [])];
  const d0 = ctx.inputs["00-description.json"];
  const desc = d0.description;
  const site = ctx.inputs["01-site.json"];
  const lotsArt = ctx.inputs["02-lots.json"];
  const R = desc.rules ?? {};
  const W = world(desc, site, lotsArt);
  const tile = site.tile.id;
  const m = measured(desc);

  for (const c of a.connectors) if (c.unplaced) failures.push(`connectors: ${c.unplaced}`);
  for (const c of a.connectors) for (const f of c.dims?.fits ?? []) failures.push(`connectors: ${c.id}: ${f}`);
  for (const k of a.checkpoints) if (k.unplaced) failures.push(`checkpoints: ${k.unplaced}`);
  for (const h of a.hallways) if (h.unrouted) failures.push(`msr: ${h.unrouted}`);

  // every connector of the tile has its pieces, and each stop in the tile its exit
  for (const c of m.connectors) {
    const here = c.stops.filter((s) => tileAt(desc, m.posOf(s)) === tile && site.layers.some((L) => L.id === m.layerOf(s)));
    if (!here.length) continue;
    const rec = a.connectors.find((x) => x.id === c.id);
    if (!rec) failures.push(`connectors: ${c.id} has stops in ${tile} (${here.join(", ")}) and no pieces`);
    else if (!rec.unplaced) for (const s of here) if (!rec.exits.some((e) => e.stop === s)) failures.push(`connectors: ${c.id} has no exit at its stop ${s}`); // prettier-ignore
  }

  // walk limits, re-measured on the real footprints
  const walk = measureWalk(desc, site, lotsArt, a);
  const RC = R.connectors ?? {};
  for (const u of walk.unreached) failures.push(`walk: ${u} reaches no public connector by public floor in ${tile}`);
  for (const [lid, w] of Object.entries(walk.byLayer)) if (w.distance > (RC.maxWalk ?? Infinity)) failures.push(`walk: on ${lid} ${w.farthest} is ${w.distance} cells from a public connector on the real footprints, at most ${RC.maxWalk} (maxWalk)`); // prettier-ignore
  if (RC.p90Walk !== undefined && walk.p90 > RC.p90Walk) failures.push(`walk: the p90 walk from ${tile}'s public floor to a public connector is ${walk.p90} cells on the real footprints, at most ${RC.p90Walk} (p90Walk)`); // prettier-ignore

  // every arrival on a gated layer controlled: a gate room over the exit, at the controlling checkpoint's stop
  const controllers = (cid) => (desc.checkpoints ?? []).filter((k) => k.controls.includes(cid));
  for (const c of m.connectors) {
    if (c.access !== "public" || c.type === "secret") continue;
    const gatedStop = c.stops.find((s) => site.layers.find((L) => L.id === m.layerOf(s))?.gated);
    if (!gatedStop) continue;
    if (!c.stops.some((s) => tileAt(desc, m.posOf(s)) === tile)) continue;
    const ks = controllers(c.id);
    if (!ks.length) {
      failures.push(`gated: ${c.id} arrives on the gated layer ${m.layerOf(gatedStop)} at ${gatedStop} and no checkpoint controls it`); // prettier-ignore
      continue;
    }
    const rec = a.connectors.find((x) => x.id === c.id);
    let held = false;
    for (const k of ks) {
      if (tileAt(desc, m.posOf(k.node)) !== tile) {
        notes.push(`gated: ${c.id} is controlled by ${k.id} at ${k.node}, in another tile`);
        held = true;
        continue;
      }
      const ex = rec?.exits.find((e) => e.stop === k.node);
      const room = a.checkpoints.find((x) => x.id === k.id)?.rooms.find((r) => r.kind === "gate" && r.fronts === c.id);
      if (!ex) failures.push(`gated: ${c.id} has no exit at ${k.node}, where ${k.id} controls it`);
      else if (!room) failures.push(`gated: ${k.id} has no gate room over ${c.id}'s exit at ${k.node}`);
      else {
        // the gate covers the whole approach: the public floor reaches the exit only through it
        const gp = growPoly(room.poly ?? rectPoly(room.rect), 0.01);
        const covered = ex.approach.every((p) => pointInPoly(p, gp));
        if (!covered) failures.push(`gated: ${k.id}'s gate at ${k.node} leaves ${c.id}'s exit open to the public floor (its approach reaches past the gate)`); // prettier-ignore
        else held = true;
      }
    }
    if (!held && !failures.some((f) => f.includes(c.id))) failures.push(`gated: ${c.id}'s arrival on the gated layer is not controlled in ${tile}`); // prettier-ignore
  }

  // on the axes (the rulebook's circulation.axial): every hallway's and bridge's leg, every flight and landing of a
  // straight run square to the streets and plazas (a secret stair, hidden, is exempt)
  const AX = d0.rulebook.circulation?.axial;
  if (AX) {
    const tol = Math.tan((AX.maxSkewDeg * Math.PI) / 180);
    const skew = (p, q) => Math.min(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])) > tol * Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])) + 1e-3; // prettier-ignore
    for (const h of a.hallways) for (const lg of h.legs ?? []) if (skew(lg.from, lg.to)) failures.push(`axial: ${h.kind === "passage" ? "passage" : "hallway"} ${h.id} runs off the axes from [${lg.from}] to [${lg.to}]${lg.z[0] > (site.layers.find((L) => L.id === h.layer)?.floor ?? 0) + 1e-6 ? " as a bridge" : ""} (circulation.axial: along the streets' and plazas' axes, turns at a corner)`); // prettier-ignore
    for (const h of a.hallways) for (const br of h.bridges ?? []) if (skew(br.from, br.to)) failures.push(`axial: ${h.id}'s bridge over ${br.over.join(", ")} runs off the axes from [${br.from}] to [${br.to}] (circulation.axial: a bridge square to what it crosses)`); // prettier-ignore
    for (const c of a.connectors) {
      if (c.unplaced || AX.exempt.includes(c.type) || !AX.kinds.includes(c.type)) continue;
      for (const p of c.pieces) if ((p.kind === "flight" || p.kind === "landing") && p.poly.some((q, i) => skew(q, p.poly[(i + 1) % p.poly.length]))) {
        failures.push(`axial: ${c.id}'s ${p.kind} runs off the axes (circulation.axial: a stair along the streets' and plazas' axes, turning at a landing)`); // prettier-ignore
        break;
      }
    }
  }
  // a colonnade (a square's, a way's): no column it keeps stands in a piece, an exit, a gate, a room, a post, a
  // hallway or a door's way across the portico
  for (const col of a.colonnades ?? []) {
    const ref = col.ref ?? col.plaza;
    const w = col.way ? site.ways.find((x) => x.id === col.way) : null;
    const depth = w ? porticoDoorDepth(w.width / 2 - col.offset, col.column) : porticoDoorDepth(col.depth, col.column);
    const blockers = columnBlockers(a, col.layer, col.z[0], col.z[1], doorLanes(desc, lotsArt, ref, depth));
    for (const c of col.columns) {
      const hit = blockers.find((b) => polyOverlap(columnPoly(c.at, col.column), b.poly) > 1e-6);
      if (hit) failures.push(`colonnade: ${ref}'s column at [${c.at}] stands in ${hit.what}`);
    }
  }

  // the MSR's runs
  const maxRun = R.msr?.maxServiceRun ?? Infinity;
  for (const h of a.hallways) for (const r of h.runs) if (r > maxRun + 1e-9) failures.push(`msr: hallway ${h.id} runs ${r} cells between posts, at most ${maxRun} (maxServiceRun)`); // prettier-ignore
  const total = a.hallways.reduce((s, h) => s + h.length, 0);
  // the city's service hallways in all: routed here, the description's straight lengths in the tiles not built yet
  let city = 0;
  for (const sg of m.segments.values()) {
    if (sg.class !== "service") continue;
    const line = [m.nodes.get(sg.from).at, m.nodes.get(sg.to).at];
    const inside = site.layers.some((L) => L.id === sg.layer) ? clipPolyline(line, site.tile.box).reduce((t, pl) => t + dist(pl[0], pl[pl.length - 1]), 0) : 0; // prettier-ignore
    const routed = a.hallways.find((h) => h.kind === "service" && h.id === sg.id && !h.unrouted);
    city += (sg.length * (sg.straight - inside)) / (sg.straight || 1) + (routed ? routed.length : (sg.length * inside) / (sg.straight || 1));
  }
  if (city > (R.msr?.maxServiceTotal ?? Infinity) + 1e-9) failures.push(`msr: ${r3(city)} cells of service hallway in the city (routed in ${tile}, as described elsewhere), at most ${R.msr.maxServiceTotal} (maxServiceTotal)`); // prettier-ignore
  notes.push(`msr: ${r3(total)} cells of service hallway and passage routed in ${tile}; the city's service hallways ${r3(city)} cells counted on them (at most ${R.msr?.maxServiceTotal ?? "no limit"})`); // prettier-ignore
  // a connector built longer than the description says (the two may not drift: at most a cell apart)
  for (const c of a.connectors) {
    if (c.unplaced || c.stub || c.lengthDescribed === null || c.lengthDescribed === undefined) continue;
    if (c.lengthBuilt > c.lengthDescribed + 1 + 1e-9) failures.push(`connectors: ${c.id} is built ${c.lengthBuilt} cells long by the rulebook, the description says ${c.lengthDescribed}: set its length to the built one (they may differ by a cell at most)`); // prettier-ignore
  }

  // spawns: the tile's share, on public floor, clear of the keep-clear volumes, apart
  const share = spawnShare(desc, site);
  const want = Math.ceil((desc.spawns?.count ?? 0) * share.share - 1e-9);
  if (a.spawns.length < want) failures.push(`spawns: ${a.spawns.length} placed in ${tile}, its share of the description's ${desc.spawns?.count} is ${want} (${Math.round(share.share * 1000) / 10} % of the spawnable floor)`); // prettier-ignore
  const keep = keepClear(desc, site, lotsArt, a, W);
  for (const s of a.spawns) {
    const g = W.grids.get(s.layer);
    if (!g) {
      failures.push(`spawns: ${s.id} is on ${s.layer}, not a layer of ${tile}`);
      continue;
    }
    const L = site.layers.find((x) => x.id === s.layer);
    if (L.gated) failures.push(`spawns: ${s.id} stands on the gated layer ${s.layer} (nobody spawns past the checkpoints)`);
    const [i, j] = g.cellOf(s.at);
    const k = g.inside(i, j) ? g.idx(i, j) : -1;
    if (k < 0 || !(g.kind[k] === K.WAY || g.kind[k] === K.PLAZA)) failures.push(`spawns: ${s.id} at [${s.at}] is not on public floor`); // prettier-ignore
    else if (keep.get(s.layer).has(k)) failures.push(`spawns: ${s.id} at [${s.at}] stands in a keep-clear volume (a door, an exit, a landing or a gate)`); // prettier-ignore
  }
  for (let i = 0; i < a.spawns.length; i++)
    for (let j = i + 1; j < a.spawns.length; j++) {
      const [p, q] = [a.spawns[i], a.spawns[j]];
      if (p.layer === q.layer && dist(p.at, q.at) < (desc.spawns?.minSpacing ?? 0) - 1e-9) failures.push(`spawns: ${p.id} and ${q.id} stand ${r3(dist(p.at, q.at))} cells apart, at least ${desc.spawns.minSpacing}`); // prettier-ignore
    }

  // nothing overlaps: every pair of solids apart in plan or in height, but for the pairs placed together on purpose
  const S = solids(desc, site, lotsArt, a, W);
  const nodeFloor = new Map();
  const floorOf = (nid) => nodeFloor.get(nid) ?? nodeFloor.set(nid, m.nodes.has(nid) ? W.floorOf(nid) : new Set()).get(nid);
  const standing = new Map();
  for (const lot of lotsArt.lots) if (lot.standsOn) (standing.get(lot.standsOn) ?? standing.set(lot.standsOn, []).get(lot.standsOn)).push(box4(lot.rect)); // prettier-ignore
  const msrOwned = (lot) => desc.buildings.find((b) => b.id === lot.building)?.owner === "msr";
  const allowed = (x, y) => {
    if (x.owner === y.owner) return true;
    // a building standing on its plaza, and whatever stands inside such a building, against that plaza
    for (const [P, Q] of [[x, y], [y, x]]) {
      if (Q.kind !== "plaza") continue;
      if (P.kind === "lot" && (P.lot.standsOn === Q.owner || P.lot.frontage.way === Q.owner)) return true;
      const pb = polyBox(P.poly);
      if ((standing.get(Q.owner) ?? []).some((b) => pb[0] >= b[0] - 0.01 && pb[1] >= b[1] - 0.01 && pb[2] <= b[2] + 0.01 && pb[3] <= b[3] + 0.01)) return true; // prettier-ignore
    }
    const pair = (k1, k2, f) => (x.kind === k1 && y.kind === k2 ? f(x, y) : y.kind === k1 && x.kind === k2 ? f(y, x) : false);
    const publicKinds = (p) => p.kind === "way" || p.kind === "plaza";
    if (publicKinds(x) && publicKinds(y)) return true; // ways meet at their nodes; stage 1 holds their crossings
    if ((x.kind === "piece" || x.kind === "approach") && y.kind === "lot" && x.conn.stops.includes(y.lot.building)) return true;
    if ((y.kind === "piece" || y.kind === "approach") && x.kind === "lot" && y.conn.stops.includes(x.lot.building)) return true;
    if (pair("approach", "way", (p) => true) || pair("approach", "plaza", () => true)) return true; // an exit opens onto public floor
    if (pair("piece", "way", (p, w) => p.conn.stops.some((s) => floorOf(s).has(w.owner))) || pair("piece", "plaza", (p, w) => p.conn.stops.some((s) => floorOf(s).has(w.owner)))) return true; // prettier-ignore
    if (pair("gate", "approach", (g, p) => g.fronts === p.owner || g.cp.controls.includes(p.owner)) || pair("gate", "way", () => true) || pair("gate", "plaza", () => true)) return true; // prettier-ignore
    if (pair("room", "plaza", (r, p) => floorOf(r.cp.node).has(p.owner)) || pair("room", "way", (r, p) => floorOf(r.cp.node).has(p.owner))) return true; // prettier-ignore
    if (pair("room", "lot", (r, l) => msrOwned(l.lot)) || pair("post", "lot", (p, l) => msrOwned(l.lot))) return true;
    if (pair("hall", "lot", (h, l) => msrOwned(l.lot)) || pair("hall", "hall", () => true) || pair("hall", "post", () => true) || pair("hall", "room", () => true) || pair("hall", "gate", () => true)) return true; // prettier-ignore
    if (pair("hall", "piece", (h, p) => p.conn.access === "msr") || pair("hall", "approach", (h, p) => p.conn.access === "msr")) return true; // prettier-ignore
    if (pair("approach", "post", (p, q) => p.stop === q.node) || pair("approach", "room", (p, r) => p.conn.access === "msr")) return true; // prettier-ignore
    if (pair("hall", "plaza", (h) => h.arrives) || pair("hall", "way", (h) => h.arrives)) return true; // it comes down into its room
    if (pair("spawn", "way", () => true) || pair("spawn", "plaza", () => true)) return true;
    if (pair("approach", "approach", () => true)) return true; // two exits may share a landing's floor
    if (pair("monument", "plaza", (mo, p) => mo.plaza === p.owner)) return true; // a monument stands on its square
    return false;
  };
  const boxes = S.map((s) => polyBox(s.poly));
  const seen = new Set();
  for (let i = 0; i < S.length; i++)
    for (let j = i + 1; j < S.length; j++) {
      const [x, y] = [S[i], S[j]];
      if (Math.min(x.z[1], y.z[1]) - Math.max(x.z[0], y.z[0]) <= 0.01) continue;
      const [bx, by] = [boxes[i], boxes[j]];
      if (bx[0] >= by[2] || by[0] >= bx[2] || bx[1] >= by[3] || by[1] >= bx[3]) continue;
      if (allowed(x, y)) continue;
      const depth = polyOverlap(x.poly, y.poly);
      if (depth <= 0.02) continue;
      const key = `${x.what}|${y.what}`;
      if (seen.has(key)) continue;
      seen.add(key);
      failures.push(`overlap: ${x.what} and ${y.what} overlap by ${r3(depth)} cells (z ${r3(Math.max(x.z[0], y.z[0]))} to ${r3(Math.min(x.z[1], y.z[1]))})`); // prettier-ignore
    }
  return { failures, notes };
}

export const stage = { n: 4, name: "network", reads: ["00-description.json", "01-site.json", "02-lots.json"], run, gate };
export { CONNECTOR_TYPES };
