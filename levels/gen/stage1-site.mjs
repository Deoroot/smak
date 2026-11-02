// Stage 1, the site: the tile and a margin round it, its layers with their floors, its nodes, and its ways as
// real polylines (a winding way a zigzag of its described length, crossing each seam at its portal; every way cut
// where it enters a plaza) with their widths, sidewalks, porticoes, carriageways and quays; its plazas with their
// colonnades (a column every rulebook pitch along the portico's inner line, none across a way's mouth) and their
// monuments; a way's porticoes their column lines (wayColonnadeOf: the inner line each side, the tile's columns,
// none across a side way's mouth); its portals, capped at the seams. Coordinates in cells, z in cells. Writes
// 01-site.json (levels/gen/ARTIFACTS.md).
import { cityPortals, diffPortals } from "../lib/city-checks.mjs";
import {
  r3, dist, polylineLength, clipPolyline, trimStartInBox, trimEndInBox, segCross, meander, seeded, seedOf,
  overlapDepth, boxInside,
} from "./geom.mjs";
import { tileBox, tileAt, seamDistance, tileSeams, measured } from "./site.mjs";
import { KERB, PORTAL_DEPTH } from "./dressing.mjs";

const rp = (p) => [r3(p[0]), r3(p[1])];
const boxOfNode = (n) => (n.size ? [n.at[0] - n.size[0] / 2, n.at[1] - n.size[1] / 2, n.at[0] + n.size[0] / 2, n.at[1] + n.size[1] / 2] : null); // prettier-ignore
const meets = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/**
 * Where a polyline crosses the edges of box t: [{ at, edge: s|n|w|e, leg }]. A vertex standing on an edge with its
 * neighbours on either side of it crosses there too (a winding way's zigzag has its portal point as a vertex, on
 * the seam: no leg crosses the edge's line properly there).
 */
export function edgeCrossings(pts, t) {
  const out = [];
  const edges = { s: [[t[0], t[1]], [t[2], t[1]]], n: [[t[0], t[3]], [t[2], t[3]]], w: [[t[0], t[1]], [t[0], t[3]]], e: [[t[2], t[1]], [t[2], t[3]]] }; // prettier-ignore
  const axis = { s: [1, t[1]], n: [1, t[3]], w: [0, t[0]], e: [0, t[2]] };
  const E = 1e-9;
  for (let i = 1; i < pts.length; i++)
    for (const [edge, [c, d]] of Object.entries(edges)) {
      const x = segCross(pts[i - 1], pts[i], c, d);
      if (x) out.push({ at: x, edge, leg: i - 1 });
      else if (i < pts.length - 1) {
        // pts[i] on the edge, the legs before and after it on either side
        const [k, v] = axis[edge];
        const q = pts[i];
        const along = q[1 - k];
        const inSpan = along >= Math.min(c[1 - k], d[1 - k]) - E && along <= Math.max(c[1 - k], d[1 - k]) + E;
        const [s0, s1] = [pts[i - 1][k] - v, pts[i + 1][k] - v];
        if (inSpan && Math.abs(q[k] - v) <= E && ((s0 < -E && s1 > E) || (s0 > E && s1 < -E))) out.push({ at: [q[0], q[1]], edge, leg: i - 1 }); // prettier-ignore
      }
    }
  return out;
}

/**
 * A square's colonnade and monuments: the portico (depth, its vault's height: the rulebook's typical, on the
 * half-storey grid), the inner line its columns stand on (a column every maxColumnPitch or closer, from each
 * corner, none inside a way's mouth: the way's width less its own porticoes, whose colonnades meet the square's)
 * and each monument with its z range. Empty for a plaza with neither.
 */
export function squareOf(n, box, m, rb, desc) {
  const out = {};
  if (n.monuments?.length) out.monuments = n.monuments.map((mo) => ({ id: mo.id, kind: mo.kind, name: mo.name ?? null, at: mo.at, base: mo.base, across: mo.across ?? Math.min(...mo.base) / 2, height: mo.height, z: [zOfLayer(desc, n.layer), r3(zOfLayer(desc, n.layer) + mo.height)] })); // prettier-ignore
  if (!(n.portico > 0)) return out;
  const mpu = rb.units.metresPerUnit;
  const cell = desc.grid.cell;
  const P = rb.dimensions.porticoes;
  const half = desc.grid.storey / 2;
  const height = Math.max(half, Math.round((P.height.typical * mpu) / cell / half) * half);
  const pitch = (P.maxColumnPitch * mpu) / cell;
  const col = r3((P.column.width.typical * mpu) / cell);
  const p = n.portico;
  const line = [box[0] + p, box[1] + p, box[2] - p, box[3] - p];
  // the mouths: where each way of the square crosses its edge, its carriageway's span on the inner line
  const mouths = [];
  for (const s of m.segments.values()) {
    if ((s.from !== n.id && s.to !== n.id) || s.class === "service") continue;
    const other = m.nodes.get(s.from === n.id ? s.to : s.from).at;
    const u = [other[0] - n.at[0], other[1] - n.at[1]];
    const side = Math.abs(u[0]) >= Math.abs(u[1]) ? (u[0] > 0 ? "e" : "w") : u[1] > 0 ? "n" : "s";
    const t = side === "e" || side === "w" ? n.at[1] + (u[1] / (Math.abs(u[0]) || 1)) * ((box[2] - box[0]) / 2) : n.at[0] + (u[0] / (Math.abs(u[1]) || 1)) * ((box[3] - box[1]) / 2); // prettier-ignore
    const halfMouth = Math.max(0, s.width / 2 - s.portico);
    mouths.push({ way: s.id, side, from: r3(t - halfMouth), to: r3(t + halfMouth) });
  }
  const columns = [];
  const sides = { s: [[line[0], line[1]], [line[2], line[1]]], e: [[line[2], line[1]], [line[2], line[3]]], n: [[line[2], line[3]], [line[0], line[3]]], w: [[line[0], line[3]], [line[0], line[1]]] }; // prettier-ignore
  for (const [side, [a, b]] of Object.entries(sides)) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(L / pitch - 1e-9));
    for (let i = 0; i < k; i++) {
      const q = [a[0] + ((b[0] - a[0]) * i) / k, a[1] + ((b[1] - a[1]) * i) / k];
      const t = side === "e" || side === "w" ? q[1] : q[0];
      if (mouths.some((mo) => mo.side === side && t > mo.from - col / 2 - 1e-9 && t < mo.to + col / 2 + 1e-9)) continue;
      columns.push({ at: q.map(r3), side });
    }
  }
  out.portico = { depth: p, height: r3(height), line: line.map(r3), pitch: r3(pitch), column: col, mouths, columns };
  return out;
}
const zOfLayer = (desc, lid) => desc.layers.find((L) => L.id === lid).z[0];

/** The portico's vault height and the column's pitch and width, in cells, from the rulebook (a square's and a way's alike). */
function porticoDims(rb, desc) {
  const mpu = rb.units.metresPerUnit;
  const cell = desc.grid.cell;
  const P = rb.dimensions.porticoes;
  const half = desc.grid.storey / 2;
  return { height: r3(Math.max(half, Math.round((P.height.typical * mpu) / cell / half) * half)), pitch: (P.maxColumnPitch * mpu) / cell, col: r3((P.column.width.typical * mpu) / cell) }; // prettier-ignore
}
const compass = (n) => (Math.abs(n[0]) >= Math.abs(n[1]) ? (n[0] > 0 ? "e" : "w") : n[1] > 0 ? "n" : "s");
const segPointDist = (p, a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1e-12;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

/**
 * A way's colonnade, both sides (the Mese's porticoes): a column line each side on the portico's inner line, the
 * edge between the portico and the carriageway, set back by the kerb (stage 8's KERB) and half a column so the shaft
 * stands wholly on the portico, clear of the carriageway and its kerb; a column every maxColumnPitch or closer along
 * each run, from each end of the run. A run is the way's line (the whole of it, city-wide, so two tiles lay the same
 * columns) cut where it crosses a seam (each tile its own columns, clear of the portal's mouth: stage 8's
 * PORTAL_DEPTH and half a shaft off the seam), and where it meets a plaza (its last column half a shaft short of the
 * plaza's edge); none inside the mouth of another way at a junction
 * end (that way's width less its own porticoes, as a square's mouth; a way running straight on is no mouth, its
 * colonnade continues this one). The vault spans the portico from the carriageway's edge to the building line at the
 * square's height. Null for a way with no portico (a canal's quay is no portico). `line` the way's centre polyline as
 * placed (cut at its end plazas' boxes); columns: [{ at, side (the compass side of the way they stand on) }].
 */
export function wayColonnadeOf(s, line, m, rb, desc) {
  if (!(s.portico > 0) || s.class === "canal" || s.class === "service" || line.length < 2) return null;
  const { height, pitch, col } = porticoDims(rb, desc);
  const cell = desc.grid.cell;
  const carriage = s.width - 2 * Math.max(s.sidewalk ?? 0, s.portico);
  const off = r3(carriage / 2 + KERB / cell + col / 2);
  const t = desc.tiles;
  const [ox, oy] = t.origin ?? [0, 0];
  const seamsX = Array.from({ length: Math.max(0, t.cols - 1) }, (_, c) => ox + (c + 1) * t.size[0]);
  const seamsY = Array.from({ length: Math.max(0, t.rows - 1) }, (_, r) => oy + (r + 1) * t.size[1]);
  const plazaBoxes = [...m.nodes.values()].filter((n) => n.size && n.layer === s.layer).map(boxOfNode);
  const onPlaza = (p) => plazaBoxes.some((b) => p[0] >= b[0] - 0.05 && p[0] <= b[2] + 0.05 && p[1] >= b[1] - 0.05 && p[1] <= b[3] + 0.05); // prettier-ignore
  const inset = col / 2 + 0.01;
  const seamInset = PORTAL_DEPTH / cell + inset; // a portal's mouth kept clear (stage 8's), as everything placed keeps it
  // the mouths at the way's junction ends: every other way of the node but one running straight on
  const mouths = [];
  for (const [end, from] of [[m.nodes.get(s.from), line[1]], [m.nodes.get(s.to), line[line.length - 2]]]) {
    if (end.size) continue;
    const d0 = [from[0] - end.at[0], from[1] - end.at[1]];
    const dl = Math.hypot(...d0) || 1;
    for (const o of m.segments.values()) {
      if (o.id === s.id || o.class === "service" || o.layer !== s.layer || (o.from !== end.id && o.to !== end.id)) continue;
      const far = m.nodes.get(o.from === end.id ? o.to : o.from).at;
      const v = [far[0] - end.at[0], far[1] - end.at[1]];
      const vl = Math.hypot(...v) || 1;
      if ((v[0] * d0[0] + v[1] * d0[1]) / (vl * dl) < -Math.cos(Math.PI / 6)) continue; // straight on
      mouths.push({ way: o.id, node: end.id, a: end.at, b: far, half: r3(Math.max(0, o.width / 2 - o.portico) + col / 2) });
    }
  }
  const columns = [];
  const gaps = [];
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const L = dist(a, b);
    if (L < 1e-6) continue;
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    for (const sg of [1, -1]) {
      const n = [-u[1] * sg, u[0] * sg];
      const side = compass(n);
      const p0 = [a[0] + n[0] * off, a[1] + n[1] * off];
      const p1 = [b[0] + n[0] * off, b[1] + n[1] * off];
      // the run's stops: its ends (half a shaft short of a plaza), the seams it crosses (half a shaft each side)
      const stops = [{ t: i === 1 && onPlaza(a) ? inset : 0 }, { t: i === line.length - 1 && onPlaza(b) ? L - inset : L }];
      for (const X of seamsX) if ((p0[0] - X) * (p1[0] - X) < 0) stops.push({ t: (L * (X - p0[0])) / (p1[0] - p0[0]), seam: true });
      for (const Y of seamsY) if ((p0[1] - Y) * (p1[1] - Y) < 0) stops.push({ t: (L * (Y - p0[1])) / (p1[1] - p0[1]), seam: true });
      stops.sort((x, y) => x.t - y.t);
      for (let k = 1; k < stops.length; k++) {
        const t0 = stops[k - 1].t + (stops[k - 1].seam ? seamInset : 0);
        const t1 = stops[k].t - (stops[k].seam ? seamInset : 0);
        if (t1 - t0 < -1e-9) continue;
        const bays = Math.max(t1 - t0 > 1e-6 ? 1 : 0, Math.ceil((t1 - t0) / pitch - 1e-9));
        for (let j = 0; j <= bays; j++) {
          const tt = bays ? t0 + ((t1 - t0) * j) / bays : t0;
          const q = [p0[0] + u[0] * tt, p0[1] + u[1] * tt];
          const mo = mouths.find((x) => segPointDist(q, x.a, x.b) < x.half - 1e-9);
          if (mo) {
            gaps.push({ at: q.map(r3), side, why: `${mo.way}'s mouth at ${mo.node}` });
            continue;
          }
          if (columns.some((c) => Math.hypot(c.at[0] - q[0], c.at[1] - q[1]) < col)) continue; // a leg's joint
          columns.push({ at: q.map(r3), side });
        }
      }
    }
  }
  return { depth: s.portico, height, offset: off, band: [r3(s.width / 2 - s.portico), r3(s.width / 2)], pitch: r3(pitch), column: col, mouths: mouths.map((x) => ({ way: x.way, node: x.node, half: x.half })), columns, gaps }; // prettier-ignore
}

function run(ctx) {
  const d0 = ctx.inputs["00-description.json"];
  const desc = d0.description;
  const m = measured(desc);
  const tile = ctx.params.tile;
  const margin = ctx.params.margin ?? desc.rules?.tiles?.seamMargin ?? 2;
  const tb = tileBox(desc, tile);
  const win = [tb[0] - margin, tb[1] - margin, tb[2] + margin, tb[3] + margin];
  const layers = desc.layers.filter((L) => meets(L.bounds, tb)).sort((a, b) => a.level - b.level);
  const layerIds = new Set(layers.map((L) => L.id));
  const zOf = (lid) => desc.layers.find((L) => L.id === lid).z[0];

  // the straight-line seam crossings of every segment, as the portal tool computes them (city-wide)
  const portalsBySeg = new Map();
  for (const p of desc.tiles.portals ?? []) if (p.segment) (portalsBySeg.get(p.segment) ?? portalsBySeg.set(p.segment, []).get(p.segment)).push(p); // prettier-ignore

  const ways = [];
  const usedNodes = new Set();
  for (const s of m.segments.values()) {
    if (!layerIds.has(s.layer)) continue;
    const A = m.nodes.get(s.from);
    const B = m.nodes.get(s.to);
    const winding = Boolean(s.winding) || s.length > s.straight * 1.01;
    let base = [A.at, B.at];
    if (winding) {
      // a zigzag of the described length that still crosses each seam at its portal: one meander per piece
      // between the portal points, each piece its share of the length
      const cuts = (portalsBySeg.get(s.id) ?? []).map((p) => p.at).sort((p, q) => dist(A.at, p) - dist(A.at, q));
      const stops = [A.at, ...cuts, B.at];
      const rng = seeded(seedOf(ctx.params.seed, s.id));
      base = [A.at];
      for (let i = 1; i < stops.length; i++) {
        const leg = dist(stops[i - 1], stops[i]);
        const share = (s.length * leg) / s.straight;
        const pieces = Math.max(2, Math.round(share / 8));
        base.push(...meander(stops[i - 1], stops[i], share, pieces, rng() < 0.5 ? 1 : -1).slice(1));
      }
    }
    let line = base;
    const [ba, bb] = [boxOfNode(A), boxOfNode(B)];
    if (ba) line = trimStartInBox(line, ba);
    if (bb) line = trimEndInBox(line, bb);
    const parts = clipPolyline(line, win);
    if (!parts.length) continue;
    usedNodes.add(s.from), usedNodes.add(s.to);
    const inTile = clipPolyline(line, tb);
    const cls = m.classes[s.class];
    const carriageway = s.class === "canal" ? null : r3(s.width - 2 * Math.max(s.sidewalk, s.portico));
    const seams = tileSeams(desc, tile);
    const caps = edgeCrossings(line, tb).map((x) => {
      const seam = seams[x.edge];
      const portal = (portalsBySeg.get(s.id) ?? []).find((p) => dist(p.at, x.at) <= (desc.rules?.tiles?.portalTolerance ?? 1.5)); // prettier-ignore
      return { at: rp(x.at), edge: x.edge, seam, portal: portal?.id ?? null };
    });
    ways.push({
      id: s.id,
      layer: s.layer,
      z: zOf(s.layer),
      class: s.class,
      district: s.district ?? null,
      name: s.name ?? null,
      from: s.from,
      to: s.to,
      access: s.access,
      vehicle: Boolean(s.vehicle),
      width: s.width,
      sidewalk: s.sidewalk,
      portico: s.portico,
      quay: s.class === "canal" ? s.sidewalk : 0,
      carriageway,
      water: s.class === "canal" ? r3(s.width - 2 * s.sidewalk) : 0,
      clearance: s.clearance,
      winding,
      length: r3(s.length),
      lengthInTile: r3(inTile.reduce((t, pl) => t + polylineLength(pl), 0)),
      parts: parts.map((pl) => pl.map(rp)),
      caps,
      lanes: s.lanes ?? cls.lanes,
    });
    // its colonnade (a portico's column lines, both sides): the columns standing in this tile
    const colonnade = wayColonnadeOf(s, line, m, d0.rulebook, desc);
    if (colonnade) ways[ways.length - 1].colonnade = { ...colonnade, columns: colonnade.columns.filter((c) => tileAt(desc, c.at) === tile), gaps: colonnade.gaps.filter((c) => tileAt(desc, c.at) === tile) }; // prettier-ignore
  }

  // two ways running straight on through a junction both end their colonnade there: its column is the first's
  const standing = [];
  for (const w of ways) {
    if (!w.colonnade) continue;
    w.colonnade.columns = w.colonnade.columns.filter((c) => !standing.some((o) => o.layer === w.layer && Math.hypot(o.at[0] - c.at[0], o.at[1] - c.at[1]) < w.colonnade.column)); // prettier-ignore
    for (const c of w.colonnade.columns) standing.push({ layer: w.layer, at: c.at });
  }

  const nodes = [];
  const plazas = [];
  for (const n of m.nodes.values()) {
    if (!layerIds.has(n.layer)) continue;
    const inWin = n.at[0] >= win[0] && n.at[0] <= win[2] && n.at[1] >= win[1] && n.at[1] <= win[3];
    const box = boxOfNode(n);
    if (!inWin && !usedNodes.has(n.id) && !(box && meets(box, win))) continue;
    nodes.push({
      id: n.id,
      layer: n.layer,
      z: zOf(n.layer),
      kind: n.kind,
      at: n.at,
      district: n.district ?? null,
      name: n.name ?? null,
      size: n.size ?? null,
      cornerRadius: n.cornerRadius ?? null,
      program: n.program ?? null,
      tile: tileAt(desc, n.at),
      inTile: tileAt(desc, n.at) === tile,
      seamDistance: r3(seamDistance(desc, n.at)),
    });
    if (box && meets(box, win)) plazas.push({ id: n.id, layer: n.layer, z: zOf(n.layer), kind: n.kind, name: n.name ?? null, box: box.map(r3), tile: tileAt(desc, n.at), ...squareOf(n, box, m, d0.rulebook, desc) }); // prettier-ignore
  }

  const seams = Object.values(tileSeams(desc, tile)).filter(Boolean);
  const portals = [];
  for (const p of desc.tiles.portals ?? []) {
    if (!seams.some((s) => s.split("|").sort().join("|") === p.seam.split("|").sort().join("|"))) continue;
    const kind = p.segment ? "segment" : p.connector ? "connector" : p.secret ? "secret" : "passage";
    const of = p.segment ?? p.connector ?? p.secret ?? p.passage;
    const seg = p.segment ? m.segments.get(p.segment) : null;
    let at = p.at ?? null;
    let layer = seg?.layer ?? null;
    if (!at) {
      // a connector, secret or passage: where the straight line between its ends leaves this tile
      const ends = p.connector ? m.connectors.find((c) => c.id === p.connector).stops : p.secret ? [desc.secrets.find((s) => s.id === p.secret).from, desc.secrets.find((s) => s.id === p.secret).to] : p.passage.split(">"); // prettier-ignore
      const pts = ends.map((e) => m.posOf(e));
      for (let i = 1; i < pts.length && !at; i++) {
        const x = edgeCrossings([pts[i - 1], pts[i]], tb)[0];
        if (x) at = rp(x.at);
      }
      if (p.secret || p.passage) layer = m.layerOf(ends[0]);
    }
    portals.push({ id: p.id, kind, of, seam: p.seam, at, layer, z: layer ? zOf(layer) : null, width: seg?.width ?? null });
  }

  const measures = { layers: {} };
  for (const L of layers) {
    const ws = ways.filter((w) => w.layer === L.id && w.class !== "service");
    let longest = { way: null, cells: 0 };
    for (const w of ws.filter((x) => x.access === "public"))
      for (const pl of w.parts.flatMap((p) => clipPolyline(p, tb)))
        for (let i = 1; i < pl.length; i++) if (dist(pl[i - 1], pl[i]) > longest.cells) longest = { way: w.id, cells: r3(dist(pl[i - 1], pl[i])) }; // prettier-ignore
    const plazaArea = plazas.filter((p) => p.layer === L.id).reduce((s, p) => s + Math.max(0, Math.min(p.box[2], tb[2]) - Math.max(p.box[0], tb[0])) * Math.max(0, Math.min(p.box[3], tb[3]) - Math.max(p.box[1], tb[1])), 0); // prettier-ignore
    measures.layers[L.id] = {
      ways: ws.length,
      service: ways.filter((w) => w.layer === L.id && w.class === "service").length,
      nodesInTile: nodes.filter((n) => n.layer === L.id && n.inTile).length,
      wayAreaInTile: r3(ws.reduce((s, w) => s + w.lengthInTile * w.width, 0)),
      plazaAreaInTile: r3(plazaArea),
      longestStraightRun: longest,
    };
  }

  return {
    tile: { id: tile, name: desc.tiles.names?.[tile] ?? null, box: tb, window: win, margin },
    grid: { cell: desc.grid.cell, cellUnits: desc.grid.cellUnits, storey: desc.grid.storey },
    layers: layers.map((L) => ({ id: L.id, level: L.level, name: L.name ?? null, z: L.z, floor: L.z[0], top: L.z[1], sky: L.ceiling === "sky" || L.ceiling === "deck" ? (L.sky ?? L.z[1]) : null, frame: L.frame ?? null, ceiling: L.ceiling, wealth: L.wealth, gated: Boolean(L.gated), bounds: L.bounds })), // prettier-ignore
    nodes,
    plazas,
    ways,
    portals,
    measures,
  };
}

function gate(a, ctx) {
  const failures = [];
  const notes = [];
  const desc = ctx.inputs["00-description.json"].description;
  const R = desc.rules ?? {};
  const tb = a.tile.box;
  const tile = a.tile.id;
  // segments cross only at nodes (the centre lines of the public and canal ways; service hallways are stage 4's)
  for (const L of a.layers) {
    const ws = a.ways.filter((w) => w.layer === L.id && w.class !== "service");
    for (let i = 0; i < ws.length; i++)
      for (let j = i + 1; j < ws.length; j++)
        for (const p of ws[i].parts)
          for (const q of ws[j].parts)
            for (let k = 1; k < p.length; k++)
              for (let l = 1; l < q.length; l++) {
                const x = segCross(p[k - 1], p[k], q[l - 1], q[l]);
                if (x) failures.push(`site: ways ${ws[i].id} and ${ws[j].id} cross at [${x.map((v) => r3(v))}] on ${L.id}, not at a node`); // prettier-ignore
              }
  }
  // nodes clear of the seams
  for (const n of a.nodes) if (n.inTile && n.seamDistance < (R.tiles?.seamMargin ?? 0)) failures.push(`site: node ${n.id} stands ${n.seamDistance} cells from a seam, at least ${R.tiles.seamMargin}`); // prettier-ignore
  // the portal tool's output, unchanged, for this tile's seams
  const fresh = cityPortals(desc);
  const touches = (p) => p.seam.split("|").includes(tile);
  const diff = diffPortals((desc.tiles.portals ?? []).filter(touches), fresh.filter(touches));
  for (const p of diff.added) failures.push(`site: the seam ${p.seam} is crossed by ${p.segment ?? p.connector ?? p.secret ?? p.passage} with no portal (the portal tool adds ${p.id}: run city-portals --write)`); // prettier-ignore
  for (const p of diff.removed) failures.push(`site: portal ${p.id} matches no crossing (stale: run city-portals --write)`);
  for (const c of diff.changed) failures.push(`site: portal ${c.id} moved from ${JSON.stringify(c.from.at)} to ${JSON.stringify(c.to.at)} (run city-portals --write)`); // prettier-ignore
  // every way leaving the tile does so at its portal
  for (const w of a.ways)
    for (const cap of w.caps) {
      if (!cap.seam) continue; // the city's own edge
      if (!cap.portal) failures.push(`site: way ${w.id} crosses the seam ${cap.seam} at [${cap.at}] with no portal there`);
    }
  // a way's colonnade: every column on its portico, clear of its carriageway and kerb and of a side way's mouth;
  // along each side no bay wider than the pitch but where the tile's edge or a mouth breaks the line (a way meets a
  // plaza only at its ends)
  const m0 = measured(desc);
  for (const w of a.ways) {
    const C = w.colonnade;
    if (!C) continue;
    const along = (q) => {
      // the arc length of the nearest point of the way's line, and the distance to it
      let best = { d: Infinity, s: 0 };
      for (const part of w.parts) {
        let acc = 0;
        for (let i = 1; i < part.length; i++) {
          const [p, r] = [part[i - 1], part[i]];
          const L = dist(p, r) || 1e-12;
          const t = Math.max(0, Math.min(L, ((q[0] - p[0]) * (r[0] - p[0]) + (q[1] - p[1]) * (r[1] - p[1])) / L));
          const d = Math.hypot(q[0] - p[0] - ((r[0] - p[0]) * t) / L, q[1] - p[1] - ((r[1] - p[1]) * t) / L);
          if (d < best.d) best = { d, s: acc + t };
          acc += L;
        }
      }
      return best;
    };
    const kerb = (w.carriageway ?? 0) / 2 + KERB / desc.grid.cell + C.column / 2;
    for (const c of C.columns) {
      const { d } = along(c.at);
      if (d < kerb - 0.01) failures.push(`colonnade: ${w.id}'s column at [${c.at}] stands ${r3(d)} cells from its centre line, in its carriageway or kerb (the column line at least ${r3(kerb)})`); // prettier-ignore
      else if (d > w.width / 2 - C.column / 2 + 0.01) failures.push(`colonnade: ${w.id}'s column at [${c.at}] stands ${r3(d)} cells from its centre line, past its portico (at most ${r3(w.width / 2 - C.column / 2)})`); // prettier-ignore
      for (const end of [w.from, w.to]) {
        const n = m0.nodes.get(end);
        if (!n || n.size) continue;
        for (const o of m0.segments.values()) {
          if (o.id === w.id || o.class === "service" || o.layer !== w.layer || (o.from !== end && o.to !== end) || !C.mouths.some((x) => x.way === o.id)) continue; // prettier-ignore
          const far = m0.nodes.get(o.from === end ? o.to : o.from).at;
          if (segPointDist(c.at, n.at, far) < Math.max(0, o.width / 2 - o.portico) + C.column / 2 - 0.01) failures.push(`colonnade: ${w.id}'s column at [${c.at}] stands in ${o.id}'s mouth at ${end}`); // prettier-ignore
        }
      }
    }
    const seamX = [tb[0], tb[2]];
    const seamY = [tb[1], tb[3]];
    const broken = (p, q) =>
      seamX.some((X) => (p[0] - X) * (q[0] - X) <= 0) || seamY.some((Y) => (p[1] - Y) * (q[1] - Y) <= 0) ||
      C.gaps.some((g) => dist(g.at, p) < dist(p, q) && dist(g.at, q) < dist(p, q));
    for (const side of new Set(C.columns.map((c) => c.side))) {
      const list = C.columns.filter((c) => c.side === side).map((c) => ({ c, s: along(c.at).s })).sort((x, y) => x.s - y.s);
      for (let i = 1; i < list.length; i++) {
        const gap = dist(list[i - 1].c.at, list[i].c.at);
        if (gap > C.pitch + 0.01 && !broken(list[i - 1].c.at, list[i].c.at)) failures.push(`colonnade: ${w.id}'s columns at [${list[i - 1].c.at}] and [${list[i].c.at}] stand ${r3(gap)} cells apart on its ${side} side, at most ${C.pitch} (dimensions.porticoes.maxColumnPitch)`); // prettier-ignore
      }
    }
  }
  // a plaza is one tile's: none reaches across a seam
  for (const p of a.plazas) {
    const inside = boxInside(p.box, tb, 0.001);
    const over = overlapDepth(p.box, tb) > 0.001;
    if (over && !inside) {
      const past = Math.max(tb[0] - p.box[0], tb[1] - p.box[1], p.box[2] - tb[2], p.box[3] - tb[3]);
      const w = r3(p.box[2] - p.box[0]);
      const d = r3(p.box[3] - p.box[1]);
      failures.push(`site: plaza ${p.id} (${w}x${d}) reaches ${r3(Math.min(past, p.box[2] - p.box[0]))} cells across the edge of ${tile} (seams are crossed only at portals; a plaza is one tile's)`); // prettier-ignore
    }
  }
  // the reach, re-run on the placed ways: inside the tile every public node reaches a portal, a connector stop or the gate
  const m = measured(desc);
  const adj = new Map();
  const add = (x, y) => ((adj.get(x) ?? adj.set(x, []).get(x)).push(y), (adj.get(y) ?? adj.set(y, []).get(y)).push(x));
  const seeds = new Set();
  const tileNodes = new Set(a.nodes.filter((n) => n.inTile && n.kind !== "service").map((n) => n.id));
  const placed = new Map(a.ways.map((w) => [w.id, w]));
  for (const s of m.segments.values()) {
    // the tile's ways: those placed, and those wholly inside a plaza (cut to nothing there, still joined)
    if (s.access !== "public" || !(placed.has(s.id) || tileNodes.has(s.from) || tileNodes.has(s.to))) continue;
    add(s.from, s.to);
    if (placed.get(s.id)?.caps.some((c) => c.seam)) seeds.add(s.from), seeds.add(s.to);
  }
  for (const c of m.connectors) if (c.access === "public" && c.type !== "secret") for (const s of c.stops) if (m.nodes.has(s)) seeds.add(s); // prettier-ignore
  for (const n of a.nodes) if (n.kind === "gate") seeds.add(n.id);
  const got = new Set(seeds);
  const q = [...seeds];
  while (q.length) for (const y of adj.get(q.shift()) ?? []) if (!got.has(y)) got.add(y), q.push(y);
  const lost = [...tileNodes].filter((id) => !got.has(id));
  if (lost.length) failures.push(`site: in ${tile}, ${lost.join(", ")} reach no portal, connector or gate by public ways`);
  // sight: a straight public run held only when the description gives a target that is not provisional
  const sight = R.space?.maxStraightRun;
  const maxRun = typeof sight === "number" ? sight : sight?.value;
  const held = maxRun !== undefined && !(typeof sight === "object" && sight?.provisional);
  const measuredRuns = Object.entries(a.measures.layers).map(([l, x]) => `${l} ${x.longestStraightRun.cells} ${x.longestStraightRun.way ?? ""}`.trim()).join(", "); // prettier-ignore
  for (const [lid, lm] of Object.entries(a.measures.layers)) {
    const run = lm.longestStraightRun;
    if (held && run.cells > maxRun) failures.push(`site: ${run.way} on ${lid} runs straight ${run.cells} cells in ${tile}, at most ${maxRun} (rules.space.maxStraightRun)`); // prettier-ignore
  }
  if (maxRun === undefined) notes.push(`site: no sight target (rules.space.maxStraightRun) in the description: the longest straight public runs are measured (${measuredRuns}), not held`); // prettier-ignore
  else if (!held) notes.push(`site: the sight target rules.space.maxStraightRun ${maxRun} is provisional: the longest straight public runs are measured (${measuredRuns}), not held${Object.values(a.measures.layers).some((x) => x.longestStraightRun.cells > maxRun) ? `; past it: ${Object.entries(a.measures.layers).filter(([, x]) => x.longestStraightRun.cells > maxRun).map(([l]) => l).join(", ")}` : ""}`); // prettier-ignore
  return { failures, notes };
}

export const stage = { n: 1, name: "site", reads: ["00-description.json"], run, gate };
