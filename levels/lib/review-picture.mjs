// The R1 review drawn from the generator's artifacts (PLAN.md Phase 3, "Review stops"): what stages 1-8 actually
// made for one tile, drawn before any geometry, so the person can see a building in the wrong place, a missing
// connection or a prop in a doorway at a glance and approve the tile (or answer with a change to the description or
// the rulebook, never a hand edit of an artifact). plan-picture.mjs draws the description; this draws the artifacts,
// in the same look (its kit is shared).
//
// Pictures, all SVG text, no dependencies:
// - plan-<tile>-<L>.svg per layer, ~20 px a cell: the ways' real polylines at their widths (sidewalks, porticoes'
//   colonnades, quays, water), plazas, districts, blocks and lots (facades hatched with their kind and height, the
//   enterable lots with their building's ground storey inside: rooms by zone, walls, doors with their swings,
//   windows, stairs, voids), connector pieces on this layer (wells, shafts, flights with treads and the way up,
//   landings, lift cars) and their exits with the keep-clear approach and a line to the stop they serve,
//   checkpoint rooms, posts, the MSR's hallways and their bridges, spawns, portals; from 06 a palette swatch per
//   district and the lamps, from 08 the props. Red numbered marks: things to look at (aids, not checks).
// - wiring-<tile>-<L>.svg per layer when 07 is there: the plan faded, the named doors and the zones over it.
// - building-<id>.svg per building of 05: every storey (plan-svg.mjs's sheet), with the marks of its rooms.
// - section-<tile>-ns.svg and -ew.svg: the layer stack cut through the Nexus spine (layers, floors, slabs, the
//   buildings' storeys, the spine stair and lift, whatever else the cut meets), to scale, up to the sky lid.
// - From 09 (stage 9, forms), on the plans and the sections: the deck's frame (piers and their capitals, girders,
//   trusses, coffers, hung services), the fusion band of the facades under the deck by its mode, the deck's edge
//   (fascia, brackets, edge piers, parapet), the oculi with their guards, pier feet in the layer below and the
//   spine's drum; a section draws what it cuts solid and the frame within BEYOND cells of it in outline. The
//   edges family's forms too (vaults, ribs, canal arches, hall columns and architraves, arcades, daises, gantries,
//   the wall's towers and relief, cards, fans, light shafts, shafts, the point entities as glyphs), and in the
//   walled layer's margin the city's edge: the whole city with the wall's towers, gates, the pockets beyond it, the
//   deck and this tile, and an edge profile across the wall with the eye lines (M21) and the sky lid (09's world).
//   The facade family's forms too: pilasters, lesenes and buttresses at the street solid, bays, cages and loggias over
//   it dashed, the corner pieces, wall pipes, rooflines, setback tiers hatched (world), the tower's crown and domes in
//   outline, the gold capitals; in section the skyline's tiers, crowns and domes beyond the cut in outline.
// review.json (smak-review/1, stop R1) lists every picture with its sha256 and the hashes of the artifacts it was
// drawn from, `approval: null`; approveReview records an approval only while those artifacts still hash the same.
//
// The same artifacts give the same bytes: nothing here reads the clock or a hash map's order.

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  canonicalJson, sha256, fmt as f, esc, el, text, textW, Labels, Column, around, STYLE, DEFS,
  portalGlyph, lookGlyph, spawnGlyph, checkpointGlyph, WEALTH_FILL, STREET_LOOK, OTHER_LOOK, CASING, BUILDING_FILL, INK, PORTAL, WARN, // prettier-ignore
} from "./plan-picture.mjs";
import { buildingSvg } from "../experimental-city/plan-svg.mjs";

export const REVIEW_FORMAT = "smak-review/1";
export const RENDERER = "levels/lib/review-picture.mjs";
/** The stages R1 draws: an artifact of one of these appearing or changing after the pictures asks again. */
export const R1_STAGES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

// ── reading the artifacts ──

/** Every `NN-<stage>.json` of a folder: { file: { file, n, text, hash, artifact } }, by file name. */
export function readArtifacts(dir) {
  const out = {};
  for (const file of readdirSync(dir).filter((x) => /^\d\d-[a-z0-9-]+\.json$/.test(x)).sort()) {
    const text = readFileSync(join(dir, file), "utf8");
    let artifact;
    try {
      artifact = JSON.parse(text);
    } catch (e) {
      throw new Error(`${file} in ${dir} is not JSON (${e.message})`);
    }
    out[file] = { file, n: Number(file.slice(0, 2)), text, hash: sha256(text), artifact };
  }
  return out;
}

// ── small geometry (cells) ──

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const boxOfRect = (r) => [r.x, r.y, r.x + r.w, r.y + r.d];
const boxOfPoly = (p) => [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))]; // prettier-ignore
const centre = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const polyC = (p) => [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];
const boxesMeet = (a, b, e = 0) => a[0] < b[2] - e && a[2] > b[0] + e && a[1] < b[3] - e && a[3] > b[1] + e;
const grow = (b, k) => [b[0] - k, b[1] - k, b[2] + k, b[3] + k];
const pointBoxDist = (p, r) => Math.hypot(Math.max(r[0] - p[0], 0, p[0] - r[2]), Math.max(r[1] - p[1], 0, p[1] - r[3])); // prettier-ignore
const lineLen = (pts) => pts.slice(1).reduce((a, p, i) => a + dist(pts[i], p), 0);
/** The point at half the length of a polyline. */
const midOf = (pts) => {
  let left = lineLen(pts) / 2;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (d >= left && d > 0) return [pts[i - 1][0] + ((pts[i][0] - pts[i - 1][0]) * left) / d, pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * left) / d]; // prettier-ignore
    left -= d;
  }
  return pts[pts.length - 1];
};
/** Separating axes: whether two convex polygons overlap by more than `e`. */
const polysMeet = (A, B, e = 1e-3) => {
  for (const P of [A, B])
    for (let i = 0; i < P.length; i++) {
      const [a, b] = [P[i], P[(i + 1) % P.length]];
      const n = [b[1] - a[1], a[0] - b[0]];
      const L = Math.hypot(n[0], n[1]) || 1;
      const pa = A.map((q) => (q[0] * n[0] + q[1] * n[1]) / L);
      const pb = B.map((q) => (q[0] * n[0] + q[1] * n[1]) / L);
      if (Math.max(...pa) <= Math.min(...pb) + e || Math.max(...pb) <= Math.min(...pa) + e) return false;
    }
  return true;
};
const polyOfBox = (b) => [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
/** Where a convex polygon meets the line {axis} = c: [lo, hi] along the other axis, or null. */
const cutPoly = (poly, axis, c) => {
  const o = 1 - axis;
  const hits = [];
  for (let i = 0; i < poly.length; i++) {
    const [a, b] = [poly[i], poly[(i + 1) % poly.length]];
    if ((a[axis] - c) * (b[axis] - c) > 0) continue;
    if (a[axis] === b[axis]) hits.push(a[o], b[o]);
    else hits.push(a[o] + ((b[o] - a[o]) * (c - a[axis])) / (b[axis] - a[axis]));
  }
  return hits.length ? [Math.min(...hits), Math.max(...hits)] : null;
};
/** The spans [lo, hi] where a polyline of width w crosses the line {axis} = c. */
const cutLine = (pts, w, axis, c) => {
  const o = 1 - axis;
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    if ((a[axis] - c) * (b[axis] - c) > 0 || a[axis] === b[axis]) continue;
    const t = (c - a[axis]) / (b[axis] - a[axis]);
    const at = a[o] + (b[o] - a[o]) * t;
    const d = dist(a, b);
    const sin = Math.abs(b[axis] - a[axis]) / d;
    const half = w / 2 / Math.max(sin, 0.2);
    out.push([at - half, at + half]);
  }
  return out;
};

// ── the look of this stop's own things ──

const ZONE_FILL = { public: "#f6e3b4", staff: "#d9e4f0", home: "#e3efd6", private: "#f3d6d6", secure: "#cfc6e0", circulation: "#e9e9e9", outdoor: "#cfe8c4" }; // prettier-ignore
const CONNECTOR_INK = { "grand-stair": "#1d4f91", stair: "#2c6db5", ramp: "#3b8f6a", lift: "#7a3fa0", "ladder-shaft": "#8a5a1c", secret: "#7b3fa0" }; // prettier-ignore
const HALL = "#c0392b";
const EXIT = "#0f8a4a";
const LAMP = "#f5b800";
const PROP = "#5a3d1e";
const PAD = 16;
const HEADER = 66;
const LEGEND_W = 340;
const MORE_DEFS = [
  '<pattern id="fhatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#e7e0d2"/><line x1="0" y1="0" x2="0" y2="7" stroke="#a89c88" stroke-width="1.4"/></pattern>', // prettier-ignore
  '<pattern id="vhatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="6" height="6" fill="#eef3f6"/><line x1="0" y1="0" x2="0" y2="6" stroke="#9ab" stroke-width="1.2"/></pattern>', // prettier-ignore
  '<pattern id="rhatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#f7d4cf"/><line x1="0" y1="0" x2="0" y2="5" stroke="#c0392b" stroke-width="1.4"/></pattern>', // prettier-ignore
  '<pattern id="shatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="5" height="5" fill="#d8e4f2" fill-opacity=".7"/><line x1="0" y1="0" x2="0" y2="5" stroke="#2c6db5" stroke-width="1"/></pattern>', // prettier-ignore
  '<pattern id="ghatch" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#bfe3ff"/><path d="M0,0H4M0,0V4" stroke="#1d4ed8" stroke-width="0.9"/></pattern>', // prettier-ignore
  '<marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#0f8a4a"/></marker>', // prettier-ignore
  '<marker id="up" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0L10,5L0,10z" fill="#c00"/></marker>', // prettier-ignore
].join("");

function svgDoc(width, height, title, meta, body) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(width)}" height="${f(height)}" viewBox="0 0 ${f(width)} ${f(height)}">`, // prettier-ignore
    el("title", {}, esc(title)),
    el("metadata", {}, esc(canonicalJson(meta))),
    el("style", {}, STYLE + ".m{fill:#7a1a10}.g{fill:#0f6a3a}"),
    el("defs", {}, DEFS + MORE_DEFS),
    el("rect", { width, height, fill: "#ffffff" }),
    body,
    "</svg>",
    "",
  ].join("\n");
}

// ── the context: every artifact read once, indexed ──

const ofStage = (arts, n) => Object.values(arts).find((a) => a.n === n) ?? null;
/** The first point an object of an artifact we do not know the schema of carries (cells). */
const pointOf = (o) => {
  if (!o || typeof o !== "object") return null;
  for (const k of ["at", "pos", "position", "origin", "cells", "centre", "center"]) {
    const v = o[k];
    if (Array.isArray(v) && v.length >= 2 && v.every((x) => typeof x === "number")) return [v[0], v[1]];
    if (v && typeof v === "object" && typeof v.x === "number" && typeof v.y === "number") return typeof v.w === "number" ? [v.x + v.w / 2, v.y + (v.d ?? 0) / 2] : [v.x, v.y]; // prettier-ignore
  }
  if (o.rect && typeof o.rect.x === "number") return centre(boxOfRect(o.rect));
  if (Array.isArray(o.poly) && o.poly.length >= 3) return polyC(o.poly);
  if (Array.isArray(o.box) && o.box.length === 4) return centre(o.box);
  return null;
};
/** The first array of objects found under any of these keys, at the top or one level down. */
const listOf = (doc, keys) => {
  if (!doc) return [];
  for (const k of keys) if (Array.isArray(doc[k])) return doc[k];
  for (const v of Object.values(doc)) if (v && typeof v === "object" && !Array.isArray(v)) for (const k of keys) if (Array.isArray(v[k])) return v[k]; // prettier-ignore
  return [];
};
const coloursIn = (v, out = []) => {
  if (typeof v === "string") {
    const m = v.match(/#[0-9a-fA-F]{6}\b/g);
    if (m) out.push(...m);
  } else if (Array.isArray(v)) v.forEach((x) => coloursIn(x, out));
  else if (v && typeof v === "object") for (const k of Object.keys(v)) coloursIn(v[k], out);
  return out;
};

function contextOf(arts, { scale = 20 } = {}) {
  const a0 = ofStage(arts, 0);
  const a1 = ofStage(arts, 1);
  const a2 = ofStage(arts, 2);
  if (!a1 || !a2) throw new Error(`the review needs 01-site.json and 02-lots.json at least; the folder has ${Object.keys(arts).join(", ") || "no artifacts"}`); // prettier-ignore
  const [a3, a4, a5, a6, a7, a8, a9] = [3, 4, 5, 6, 7, 8, 9].map((n) => ofStage(arts, n));
  const site = a1.artifact;
  const lots = a2.artifact;
  const net = a4?.artifact ?? null;
  const plans = a5?.artifact ?? null;
  const desc = a0?.artifact.description ?? null;
  const rules = a0?.artifact.rulebook ?? null;
  const C = { arts, site, lots, net, plans, progs: a3?.artifact ?? null, desc, rules, scale };
  C.a = { a0, a1, a2, a3, a4, a5, a6, a7, a8, a9 };
  C.forms = a9?.artifact?.forms ?? [];
  C.deck = a9?.artifact?.deck ?? null;
  C.tile = site.tile;
  C.cell = site.grid.cell;
  C.layers = site.layers;
  C.layerById = new Map(site.layers.map((L) => [L.id, L]));
  C.nodes = new Map(site.nodes.map((n) => [n.id, n]));
  C.lotOf = new Map(lots.lots.filter((l) => l.kind === "enterable").map((l) => [l.building, l]));
  C.planOf = new Map((plans?.buildings ?? []).map((b) => [b.id, b]));
  C.progOf = new Map((C.progs?.buildings ?? []).map((b) => [b.id, b]));
  C.zones = rules?.roomKinds ? Object.fromEntries(Object.entries(rules.roomKinds).map(([k, v]) => [k, v.zone])) : {};
  const mpu = rules?.units?.metresPerUnit ?? 0.0254;
  C.corridorRun_m = rules?.circulation?.corridor?.maxRun ? rules.circulation.corridor.maxRun * mpu : 25;
  C.maxServiceRun = desc?.rules?.msr?.maxServiceRun ?? null;
  C.districts = (desc?.districts ?? []).filter((d) => Array.isArray(d.area));
  // 06, 07, 08: their schemas are their stages'; read what is there, skip what is not
  C.palette = new Map();
  C.lamps = [];
  C.layerAtZ = (z) => (typeof z === "number" ? site.layers.find((L) => z >= L.floor - 0.3 && z <= L.top + 0.3)?.id ?? null : null); // prettier-ignore
  if (a6) {
    const doc = a6.artifact;
    // a district's palette as built: the roles its things wear by slot, the colours of its lamps
    const thingOf = new Map((doc.things ?? []).map((t) => [t.id, t]));
    const pal = (id) => C.palette.get(id) ?? C.palette.set(id, { colours: [], roles: {} }).get(id);
    for (const t of doc.things ?? []) {
      if (!t.district) continue;
      const p = pal(t.faction ? `${t.faction} (faction)` : t.district);
      for (const [slot, v] of Object.entries(t.slots ?? {})) if (v?.role) (p.roles[slot.split(".")[0]] ??= new Set()).add(v.role);
    }
    C.lamps = listOf(doc, ["lamps", "lights"]).map((x) => ({ o: x, at: pointOf(x), z: typeof x.z === "number" ? x.z : Array.isArray(x.at) ? x.at[2] : null, layer: x.layer ?? null, id: x.id ?? x.name ?? null, colour: (String(x.colour ?? "").match(/#[0-9a-fA-F]{6}/) ?? [LAMP])[0], kind: x.kind ?? null })).filter((x) => x.at); // prettier-ignore
    for (const lp of C.lamps) {
      lp.layer ??= C.layerAtZ(lp.z);
      const t = thingOf.get(lp.o.space);
      if (t?.district) {
        const p = pal(t.district);
        if (!p.colours.includes(lp.colour)) p.colours.push(lp.colour);
      }
    }
  }
  C.props = a8 ? listOf(a8.artifact, ["props", "items", "dressing", "placed"]).map((x) => ({ o: x, at: pointOf(x), box: x.rect ? boxOfRect(x.rect) : Array.isArray(x.poly) ? boxOfPoly(x.poly) : Array.isArray(x.box) ? x.box : null, layer: x.layer ?? null, id: x.id ?? null, kind: x.kind ?? x.model ?? x.prop ?? x.type ?? "prop" })).filter((x) => x.at) : []; // prettier-ignore
  C.wiring = a7?.artifact ?? null;
  // positions of everything by id, for the gate notes and the looks
  C.where = new Map();
  const put = (id, v) => id && !C.where.has(id) && C.where.set(id, v);
  for (const n of site.nodes) put(n.id, { layer: n.layer, at: n.at });
  for (const w of site.ways) if (w.parts?.[0]) put(w.id, { layer: w.layer, at: midOf(w.parts[0]) });
  for (const l of lots.lots) put(l.kind === "enterable" ? l.building : l.id, { layer: l.layer, at: centre(boxOfRect(l.rect)) }); // prettier-ignore
  for (const b of plans?.buildings ?? []) {
    for (const r of b.rooms) put(r.id, { layer: b.layer, at: centre(boxOfRect(r.cells[0])), building: b.id, storey: r.storey }); // prettier-ignore
    for (const d of b.doors) put(d.id, { layer: b.layer, at: d.cells, building: b.id, storey: d.storey });
  }
  for (const c of net?.connectors ?? []) {
    const e = c.exits?.[0];
    const p = c.pieces?.[0];
    if (e) put(c.id, { layer: e.layer, at: e.at });
    else if (p) put(c.id, { layer: null, at: polyC(p.poly) });
  }
  for (const cp of net?.checkpoints ?? []) if (cp.rooms?.[0]) put(cp.id, { layer: cp.layer, at: centre(boxOfRect(cp.rooms[0].rect)) }); // prettier-ignore
  for (const p of net?.posts ?? []) put(p.id, { layer: p.layer, at: centre(boxOfRect(p.rect)) });
  for (const h of net?.hallways ?? []) if (h.path?.length) put(h.id, { layer: h.layer, at: midOf(h.path) });
  for (const s of net?.spawns ?? []) put(s.id, { layer: s.layer, at: s.at });
  C.looks = looksOf(C);
  return C;
}

// ── things to look at: numbered red marks, aids for the eye (the gates stay the judges) ──

const doorSwingPoly = (d) => {
  const [fx, fy] = d.facing;
  const [ux, uy] = [-fy, fx];
  const h = d.width / 2;
  const p0 = [d.at[0] - ux * h, d.at[1] - uy * h];
  const p1 = [d.at[0] + ux * h, d.at[1] + uy * h];
  if (d.swing === "none") return null;
  return [p0, p1, [p1[0] + fx * d.width, p1[1] + fy * d.width], [p0[0] + fx * d.width, p0[1] + fy * d.width]];
};
const flightPoly = (fl) => {
  const [fx, fy] = fl.facing;
  const [ux, uy] = [-fy, fx];
  const h = fl.width / 2;
  return [
    [fl.at[0] - ux * h, fl.at[1] - uy * h],
    [fl.at[0] + ux * h, fl.at[1] + uy * h],
    [fl.at[0] + ux * h + fx * fl.run, fl.at[1] + uy * h + fy * fl.run],
    [fl.at[0] - ux * h + fx * fl.run, fl.at[1] - uy * h + fy * fl.run],
  ];
};
const landingPoly = (hl) => polyOfBox([hl.at[0] - hl.size[0] / 2, hl.at[1] - hl.size[1] / 2, hl.at[0] + hl.size[0] / 2, hl.at[1] + hl.size[1] / 2]); // prettier-ignore
/** A point of a building's frame (metres) in cells. */
const cellsOf = (b, cell, p) => [b.frame.origin_cells[0] + p[0] / cell, b.frame.origin_cells[1] + p[1] / cell];

function looksOf(C) {
  const out = [];
  const add = (lk) => out.push({ n: out.length + 1, ...lk });
  const cell = C.cell;
  for (const b of C.plans?.buildings ?? []) {
    for (const r of b.rooms)
      if (r.narrow_m < 1.5) add({ kind: "narrow-room", text: `${r.id}: ${r.kind} only ${f(r.narrow_m)} m wide (under 1.5 m), storey ${r.storey}`, layer: b.layer, at: centre(boxOfRect(r.cells[0])), building: b.id, storey: r.storey }); // prettier-ignore
    for (const r of b.rooms.filter((x) => x.kind === "corridor")) {
      const run = Math.max(...(r.clear ?? r.rects).map((q) => Math.max(q.w, q.d)));
      if (run > C.corridorRun_m) add({ kind: "long-corridor", text: `${r.id}: a straight corridor of ${f(run)} m, past the rulebook's run of ${f(C.corridorRun_m)} m, storey ${r.storey}`, layer: b.layer, at: centre(boxOfRect(r.cells[0])), building: b.id, storey: r.storey }); // prettier-ignore
    }
    // doors whose leaf swings over a flight or a half landing of the same storey
    for (const d of b.doors) {
      const sw = doorSwingPoly(d);
      if (!sw) continue;
      for (const st of b.stairs.filter((s) => s.storey === d.storey)) {
        const hit = st.flights.some((fl) => polysMeet(sw, flightPoly(fl), 0.02)) ? "a flight" : st.halfLanding && polysMeet(sw, landingPoly(st.halfLanding), 0.02) ? "a half landing" : null; // prettier-ignore
        if (hit) {
          add({ kind: "door-on-stair", text: `${d.id}: its leaf swings over ${hit} of ${st.id}, storey ${d.storey}`, layer: b.layer, at: d.cells, building: b.id, storey: d.storey }); // prettier-ignore
          break;
        }
      }
    }
  }
  // street doors opening onto a connector's piece, a checkpoint room or an exit's approach (the city's floor)
  const pieceLayer = (c, p, L) => p.z[0] < L.top && p.z[1] > L.floor - 0.5;
  for (const b of C.plans?.buildings ?? []) {
    const L = C.layerById.get(b.layer);
    if (!L) continue;
    const zDoor = C.lotOf.get(b.id)?.zBase ?? L.floor;
    for (const d of b.doors.filter((x) => x.street && x.storey === 0)) {
      const [fx, fy] = d.facing;
      const out0 = cellsOf(b, cell, [d.at[0] - fx * 0.05, d.at[1] - fy * 0.05]);
      const deep = 1.2 / cell;
      const half = d.width / 2 / cell;
      const [ux, uy] = [-fy, fx];
      const zone = [
        [out0[0] - ux * half, out0[1] - uy * half],
        [out0[0] + ux * half, out0[1] + uy * half],
        [out0[0] + ux * half - fx * deep, out0[1] + uy * half - fy * deep],
        [out0[0] - ux * half - fx * deep, out0[1] - uy * half - fy * deep],
      ];
      const hits = [];
      for (const c of C.net?.connectors ?? [])
        for (const p of c.pieces ?? []) if (pieceLayer(c, p, L) && p.kind !== "stub" && p.z[0] < zDoor + (d.height ?? 2.44) / cell && polysMeet(zone, p.poly)) hits.push(`${c.id}'s ${p.kind}`); // prettier-ignore
      // a checkpoint's room folded into the building (05's room carries its `checkpoint`) opens onto that
      // checkpoint's own rooms by design (its guard post's door faces its gate): not a block
      const own = b.rooms.find((r) => r.id === d.to || r.id === d.from)?.checkpoint ?? null;
      for (const cp of C.net?.checkpoints ?? []) if (cp.layer === b.layer && cp.id !== own) for (const r of cp.rooms) if (polysMeet(zone, r.poly ?? polyOfBox(boxOfRect(r.rect)))) hits.push(`${cp.id}'s ${r.kind}`); // prettier-ignore
      if (hits.length) add({ kind: "door-blocked", text: `${d.id} (${d.name ?? "street door"}): the floor in front of it is ${[...new Set(hits)].slice(0, 3).join(", ")}`, layer: b.layer, at: d.cells, building: b.id, storey: 0 }); // prettier-ignore
    }
  }
  // connectors: unplaced, or a stop in the tile with no exit
  for (const c of C.net?.connectors ?? []) {
    if (c.unplaced) add({ kind: "unplaced", text: `${c.id}: not placed (${typeof c.unplaced === "string" ? c.unplaced : "no room for it"})`, layer: C.where.get(c.stops?.find((s) => C.where.has(s)))?.layer ?? null, at: C.where.get(c.stops?.find((s) => C.where.has(s)))?.at ?? null }); // prettier-ignore
    for (const s of c.inTile ?? []) if (!c.unplaced && !(c.exits ?? []).some((e) => e.stop === s)) add({ kind: "no-exit", text: `${c.id}: no exit at its stop ${s}`, layer: C.where.get(s)?.layer ?? null, at: C.where.get(s)?.at ?? null }); // prettier-ignore
  }
  for (const cp of C.net?.checkpoints ?? []) if (cp.unplaced) add({ kind: "unplaced", text: `${cp.id}: rooms not placed (${cp.unplaced})`, layer: cp.layer, at: C.where.get(cp.node)?.at ?? null }); // prettier-ignore
  for (const h of C.net?.hallways ?? []) {
    if (h.unrouted) add({ kind: "unrouted", text: `${h.id}: not routed (${h.from} to ${h.to})`, layer: h.layer, at: C.where.get(h.from)?.at ?? null }); // prettier-ignore
    if (C.maxServiceRun && (h.runs ?? []).some((r) => r > C.maxServiceRun)) add({ kind: "long-run", text: `${h.id}: a run of ${f(Math.max(...h.runs))} cells between posts, past ${C.maxServiceRun}`, layer: h.layer, at: midOf(h.path) }); // prettier-ignore
  }
  // props near doors (08): within a metre of a door's opening, inside or out; a room's prop only by a door of its own
  // room (one behind the wall, in the next room, cannot stand in the doorway)
  if (C.props.length) {
    const doors = [];
    for (const b of C.plans?.buildings ?? []) for (const d of b.doors) doors.push({ b, d, at: d.cells, storey: d.storey });
    const near = 1 / cell;
    for (const p of C.props) {
      const pb = p.box ?? [p.at[0], p.at[1], p.at[0], p.at[1]];
      const hit = doors.find((x) => (!p.layer || p.layer === x.b.layer) && (p.o.storey === undefined || p.o.storey === x.storey) && (p.o.building === undefined || p.o.building === x.b.id) && (p.o.room === undefined || x.d.from === p.o.room || x.d.to === p.o.room) && pointBoxDist(x.at, pb) < near + x.d.width / 2 / cell); // prettier-ignore
      if (hit) add({ kind: "prop-at-door", text: `prop ${p.id ?? p.kind} (${p.kind}) within 1 m of door ${hit.d.id}${hit.d.name ? ` (${hit.d.name})` : ""}`, layer: hit.b.layer, at: p.at, building: hit.b.id, storey: hit.storey }); // prettier-ignore
    }
  }
  // every artifact's gate failures and notes, placed at the first thing they name
  for (const a of Object.values(C.arts)) {
    const g = a.artifact.gate ?? {};
    for (const [kind, list] of [["gate-failure", g.failures ?? []], ["gate-note", g.notes ?? []]])
      for (const s of list) {
        const ids = String(s).match(/[A-Za-z][A-Za-z0-9_.+-]*[A-Za-z0-9]/g) ?? [];
        const id = ids.filter((x) => C.where.has(x)).sort((p, q) => q.length - p.length)[0];
        const w = id ? C.where.get(id) : null;
        add({ kind, text: `${a.file}: ${s}${w?.storey ? ` [at ${id}, storey ${w.storey}]` : ""}`, layer: w?.layer ?? null, at: w?.at ?? null, building: w?.building ?? null, storey: w?.storey ?? null, artifact: a.file }); // prettier-ignore
      }
  }
  return out;
}

// ── one layer's plan ──

const lookLegend = (col) => col.row((x, y, w, h) => lookGlyph(x + 15, y + h / 2, 7, 1), "look here: an aid for the eye, not a check (the gates judge)"); // prettier-ignore

function layerPlan(C, L, { faded = false, wiring = false } = {}) {
  const s = C.scale;
  const cell = C.cell;
  const [x0, y0, x1, y1] = C.tile.window;
  const mapW = (x1 - x0) * s;
  const mapH = (y1 - y0) * s;
  const MX = PAD;
  const MY = HEADER;
  const X = (x) => MX + (x - x0) * s;
  const Y = (y) => MY + (y1 - y) * s;
  const P = (p) => `${f(X(p[0]))},${f(Y(p[1]))}`;
  const R = (b) => ({ x: X(b[0]), y: Y(b[3]), width: (b[2] - b[0]) * s, height: (b[3] - b[1]) * s });
  const pxBox = (b) => [X(b[0]), Y(b[3]), X(b[2]), Y(b[1])];
  const path = (pts) => `M${pts.map(P).join("L")}`;
  const poly = (pts, a) => el("polygon", { points: pts.map(P).join(" "), ...a });
  const win = C.tile.window;
  const G = { bg: [], dist: [], blocks: [], lots: [], ways: [], plazas: [], bldg: [], hall: [], pieces: [], cp: [], exits: [], dress: [], frame: [], marks: [], grid: [], top: [] }; // prettier-ignore
  const labels = new Labels([MX + 2, MY + 2, MX + mapW - 2, MY + mapH - 2]);
  const shows = { buildings: [], facades: 0, ways: [], plazas: [], connectors: [], checkpoints: [], posts: [], hallways: [], spawns: [], portals: [], lamps: 0, props: 0, looks: [] }; // prettier-ignore
  const onL = (o) => o.layer === L.id;

  // ground: no floor outside the layer's bounds; districts tinted by wealth
  G.bg.push(el("rect", { ...R(win), fill: "url(#nofloor)" }));
  const lb = [Math.max(L.bounds[0], x0), Math.max(L.bounds[1], y0), Math.min(L.bounds[2], x1), Math.min(L.bounds[3], y1)];
  if (lb[2] > lb[0] && lb[3] > lb[1]) G.bg.push(el("rect", { ...R(lb), fill: "#f7f5ef" }));
  const dists = C.districts.filter((d) => d.layer === L.id && boxesMeet(d.area, win));
  for (const d of dists) {
    G.dist.push(el("rect", { ...R(d.area), fill: WEALTH_FILL[d.wealth] ?? "#ddd", "fill-opacity": 0.55 }));
    G.dist.push(el("rect", { ...R(d.area), fill: "none", stroke: "#6d6150", "stroke-width": 1.4, "stroke-dasharray": "10 4" }));
  }

  // blocks: what the ways leave, outlined
  for (const bk of C.lots.blocks.filter(onL)) {
    for (const r of bk.rows) G.blocks.push(el("rect", { ...R(r), fill: bk.scrap ? "#ddd6c6" : "#ebe6da" }));
    G.blocks.push(el("rect", { ...R(bk.box), fill: "none", stroke: "#8b7f6c", "stroke-width": 0.6, "stroke-dasharray": "2 3" }));
  }

  // facade lots: hatched, kind and height written in
  const taken = new Set((C.net?.connectors ?? []).flatMap((c) => c.facadesTaken ?? []));
  for (const l of C.lots.lots.filter((x) => onL(x) && x.kind === "facade")) {
    const b = boxOfRect(l.rect);
    shows.facades++;
    G.lots.push(el("rect", { ...R(b), fill: "url(#fhatch)", stroke: taken.has(l.id) ? "#2c6db5" : "#6d6150", "stroke-width": taken.has(l.id) ? 1.4 : 0.9, "stroke-dasharray": taken.has(l.id) ? "3 2" : null })); // prettier-ignore
    const fc = l.facade ?? {};
    const words = `${fc.kind ?? "facade"} ${fc.storeys ?? "?"}st/${f(fc.height ?? 0)}c`;
    const [bx0, by0, bx1, by1] = pxBox(b);
    const vertical = by1 - by0 > bx1 - bx0;
    const room = vertical ? by1 - by0 : bx1 - bx0;
    const size = Math.min(8, Math.max(5.5, (room - 4) / (words.length * 0.56)));
    if (words.length * size * 0.56 < room - 2 && Math.min(bx1 - bx0, by1 - by0) > 9) {
      const [cx, cy] = [(bx0 + bx1) / 2, (by0 + by1) / 2];
      G.lots.push(el("text", { x: cx, y: cy + size * 0.35, "font-size": size, "text-anchor": "middle", fill: "#4a3f30", transform: vertical ? `rotate(-90 ${f(cx)} ${f(cy)})` : null, class: "h" }, esc(words))); // prettier-ignore
    }
  }

  // ways: casing, the sidewalk / portico / quay band, the carriageway or the water; colonnades; lane line
  const ways = C.site.ways.filter((w) => onL(w) && w.class !== "service");
  const look = (cls) => STREET_LOOK[cls] ?? OTHER_LOOK;
  const edge = (w) => (w.class === "canal" ? w.quay ?? 0 : Math.max(w.sidewalk ?? 0, w.portico ?? 0));
  const discs = [];
  for (const n of C.site.nodes) {
    if (n.layer !== L.id || C.site.plazas.some((p) => p.id === n.id)) continue;
    const inc = ways.filter((w) => w.from === n.id || w.to === n.id);
    if (!inc.length) continue;
    discs.push({ at: n.at, w: inc.reduce((a, b) => (b.width > a.width ? b : a)) });
  }
  const pass = (stroke, widthOf) => {
    for (const w of ways) for (const pts of w.parts) if (widthOf(w) > 0) G.ways.push(el("path", { d: path(pts), fill: "none", stroke: stroke(w), "stroke-width": widthOf(w), "stroke-linejoin": "round" })); // prettier-ignore
    for (const d of discs) if (widthOf(d.w) > 0) G.ways.push(el("circle", { cx: X(d.at[0]), cy: Y(d.at[1]), r: widthOf(d.w) / 2, fill: stroke(d.w) })); // prettier-ignore
  };
  pass(() => CASING, (w) => w.width * s + 2);
  pass((w) => look(w.class).band, (w) => w.width * s);
  pass((w) => (w.class === "canal" ? "#73aadd" : look(w.class).way), (w) => (edge(w) > 0 ? (w.width - 2 * edge(w)) * s : 0));
  for (const w of ways) {
    if (!(w.portico > 0)) continue;
    if (w.colonnade) {
      // stage 1's column lines: 04's kept columns (a hollow ring where one was left out), else 01's
      const col = (C.net?.colonnades ?? []).find((c) => c.way === w.id);
      const sz = w.colonnade.column * s;
      for (const c of col ? col.columns : w.colonnade.columns) G.ways.push(el("rect", { x: X(c.at[0]) - Math.max(2, sz / 2), y: Y(c.at[1]) - Math.max(2, sz / 2), width: Math.max(4, sz), height: Math.max(4, sz), fill: "#6b5a3a" })); // prettier-ignore
      for (const c of col?.dropped ?? []) G.ways.push(el("circle", { cx: X(c.at[0]), cy: Y(c.at[1]), r: 2.4, fill: "none", stroke: "#6b5a3a", "stroke-width": 0.8 })); // prettier-ignore
      continue;
    }
    // an artifact from before stage 1 placed a way's columns: the line every cell, as drawn then
    const off = w.width / 2 - w.portico;
    for (const pts of w.parts)
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]];
        const D = dist(a, b);
        if (D < 1e-6) continue;
        const [ux, uy] = [(b[0] - a[0]) / D, (b[1] - a[1]) / D];
        for (let t = 0.5; t < D; t += 1)
          for (const side of [-1, 1]) G.ways.push(el("circle", { cx: X(a[0] + ux * t - uy * off * side), cy: Y(a[1] + uy * t + ux * off * side), r: 2.2, fill: "#6b5a3a" })); // prettier-ignore
      }
  }
  for (const w of ways) {
    const lk = look(w.class);
    for (const pts of w.parts) {
      if (lk.centre && w.lanes >= 2) G.ways.push(el("path", { d: path(pts), fill: "none", stroke: lk.centre, "stroke-width": 1, "stroke-dasharray": "6 5" })); // prettier-ignore
      if (w.access && w.access !== "public") G.ways.push(el("path", { d: path(pts), fill: "none", stroke: INK[w.access] ?? INK.private, "stroke-width": 1.5, "stroke-dasharray": "2 3" })); // prettier-ignore
    }
    shows.ways.push(w.id);
  }
  // described service segments: their line only (the routed hallways are 04's, drawn below)
  for (const w of C.site.ways.filter((x) => onL(x) && x.class === "service")) for (const pts of w.parts) G.ways.push(el("path", { d: path(pts), fill: "none", stroke: HALL, "stroke-width": 0.8, "stroke-dasharray": "1 4", "stroke-opacity": 0.7 })); // prettier-ignore
  for (const p of C.site.plazas.filter(onL)) {
    G.plazas.push(el("rect", { ...R(p.box), fill: p.kind === "gate" ? "#e6d199" : "#f2ead6", stroke: CASING, "stroke-width": 1.6 }));
    shows.plazas.push(p.id);
    if (p.portico) {
      // the portico: the band from the edge to the column line, its columns (04's kept ones; a hollow ring where one was left out)
      const [b0, b1, b2, b3] = p.box;
      const [l0, l1, l2, l3] = p.portico.line;
      G.plazas.push(el("path", { d: `${path([[b0, b1], [b2, b1], [b2, b3], [b0, b3]])}Z${path([[l0, l1], [l0, l3], [l2, l3], [l2, l1]])}Z`, fill: STREET_LOOK.avenue.band, "fill-rule": "evenodd", stroke: "none" })); // prettier-ignore
      G.plazas.push(el("rect", { ...R(p.portico.line), fill: "none", stroke: "#6b5a3a", "stroke-width": 0.6, "stroke-dasharray": "2 3" }));
      const col = (C.net?.colonnades ?? []).find((c) => c.plaza === p.id);
      for (const c of col ? col.columns : p.portico.columns) G.plazas.push(el("rect", { x: X(c.at[0]) - Math.max(2, (p.portico.column * s) / 2), y: Y(c.at[1]) - Math.max(2, (p.portico.column * s) / 2), width: Math.max(4, p.portico.column * s), height: Math.max(4, p.portico.column * s), fill: "#6b5a3a" })); // prettier-ignore
      for (const c of col?.dropped ?? []) G.plazas.push(el("circle", { cx: X(c.at[0]), cy: Y(c.at[1]), r: 2.4, fill: "none", stroke: "#6b5a3a", "stroke-width": 0.8 })); // prettier-ignore
    }
    for (const mo of p.monuments ?? []) {
      const base = [mo.at[0] - mo.base[0] / 2, mo.at[1] - mo.base[1] / 2, mo.at[0] + mo.base[0] / 2, mo.at[1] + mo.base[1] / 2];
      G.top.push(el("rect", { ...R(base), fill: "#cdbb93", stroke: "#4a3f30", "stroke-width": 1.4 }) + el("circle", { cx: X(mo.at[0]), cy: Y(mo.at[1]), r: (mo.across * s) / 2, fill: "#7a2f4f", stroke: "#3b1626", "stroke-width": 1.2 })); // prettier-ignore
      labels.place([{ text: `${mo.id} (${mo.kind})`, size: 9, cls: "b" }, { text: `${f(mo.height)} cells high, base ${mo.base.join(" x ")}`, size: 8, cls: "d" }], around(X(mo.at[0]), Y(mo.at[1]), (Math.max(...mo.base) * s) / 2 + 4, [1, 1.6]), { leader: [X(mo.at[0]), Y(mo.at[1])] }); // prettier-ignore
      labels.block(pxBox(base));
    }
  }

  // enterable buildings: the lot, the ground storey's plan inside, the label
  const bldgBoxes = [];
  for (const lot of C.lots.lots.filter((x) => onL(x) && x.kind === "enterable")) {
    const b = C.planOf.get(lot.building);
    const lb2 = boxOfRect(lot.rect);
    bldgBoxes.push(pxBox(lb2));
    const cat = lot.owner === "msr" ? "msr" : lot.owner === "insurgents" ? "insurgent" : lot.owner === "residents" ? "home" : "business"; // prettier-ignore
    const parts = [el("title", {}, esc(`${lot.building}: ${lot.type}, ${lot.storeys} storeys, ${lot.rect.w} x ${lot.rect.d} cells, front ${lot.frontage.side} on ${lot.frontage.way}`))]; // prettier-ignore
    parts.push(el("rect", { ...R(lb2), fill: BUILDING_FILL[cat] ?? "#fff", stroke: "none" }));
    if (b) {
      const gs = groundStorey(C, b, X, Y, s, wiring);
      parts.push(gs.body);
      G.top.push(gs.texts);
    }
    else {
      // no plan yet: the lot's door toward its frontage
      const fr = lot.frontage;
      const at = fr.side === "s" ? [lot.rect.x + fr.door.at, lot.rect.y] : fr.side === "n" ? [lot.rect.x + fr.door.at, lot.rect.y + lot.rect.d] : fr.side === "w" ? [lot.rect.x, lot.rect.y + fr.door.at] : [lot.rect.x + lot.rect.w, lot.rect.y + fr.door.at]; // prettier-ignore
      parts.push(el("circle", { cx: X(at[0]), cy: Y(at[1]), r: 4, fill: "#c84" }));
    }
    parts.push(el("rect", { ...R(lb2), fill: "none", stroke: "#111", "stroke-width": 2.4 }));
    G.bldg.push(el("g", { id: `b-${lot.building}` }, parts.join("")));
    if (lot.tower) {
      // its tower over the roof: the silhouette dashed, what it is written beside it
      const t = lot.tower;
      const n = t.silhouette === "square" ? 4 : t.silhouette === "octagon" ? 8 : 32;
      const rr = (t.across / 2) * (n === 4 ? Math.SQRT2 : 1); // a square's corners on the circle round it
      const pts = Array.from({ length: n }, (_, i) => [t.at[0] + Math.cos(((i + 0.5) / n) * 2 * Math.PI) * rr, t.at[1] + Math.sin(((i + 0.5) / n) * 2 * Math.PI) * rr]); // prettier-ignore
      G.top.push(poly(pts, { fill: "none", stroke: "#4a1f6b", "stroke-width": 2.2, "stroke-dasharray": "7 4" }));
      G.top.push(el("circle", { cx: X(t.at[0]), cy: Y(t.at[1]), r: 2.5, fill: "#4a1f6b" }));
      labels.place([{ text: `${lot.building}'s tower (${t.silhouette}, ${f(t.across)} across)`, size: 9, cls: "b" }, { text: `${t.storeys} storeys over its ${lot.storeys}, not enterable, z ${f(t.z[0])} to ${f(t.z[1])}`, size: 8, cls: "d" }], around(X(t.at[0]), Y(t.at[1]), (t.across * s) / 2 + 4, [0.5, 1]), { force: true, leader: [X(t.at[0]), Y(t.at[1] + t.across / 2)] }); // prettier-ignore
    }
    shows.buildings.push(lot.building);
  }
  for (const bb of bldgBoxes) labels.block(bb);

  // the MSR's hallways: translucent red bands at their width, bridges darker with what they cross
  for (const h of (C.net?.hallways ?? []).filter(onL)) {
    if (!h.path?.length) continue;
    G.hall.push(el("path", { d: path(h.path), fill: "none", stroke: HALL, "stroke-opacity": 0.28, "stroke-width": h.width * s, "stroke-linejoin": "miter" })); // prettier-ignore
    G.hall.push(el("path", { d: path(h.path), fill: "none", stroke: "#8e1f15", "stroke-width": 1.1, "stroke-dasharray": "5 3" }));
    for (const br of h.bridges ?? []) G.hall.push(el("path", { d: path([br.from, br.to]), fill: "none", stroke: "#8e1f15", "stroke-opacity": 0.5, "stroke-width": h.width * s, "stroke-linecap": "butt", "stroke-dasharray": "3 3" }) + el("path", { d: path([br.from, br.to]), fill: "none", stroke: "#8e1f15", "stroke-width": 1.4 })); // prettier-ignore
    if (h.seam) G.hall.push(el("circle", { cx: X(h.seam[0]), cy: Y(h.seam[1]), r: 4, fill: "#8e1f15" }));
    shows.hallways.push(h.id);
  }
  for (const p of (C.net?.posts ?? []).filter(onL)) {
    G.cp.push(el("rect", { ...R(boxOfRect(p.rect)), fill: "url(#rhatch)", stroke: "#8e1f15", "stroke-width": 1.6 }));
    shows.posts.push(p.id);
  }

  // connectors: pieces on this layer's height; the column's outline wherever it passes; exits on this layer
  const conns = C.net?.connectors ?? [];
  const pieceHere = (p) => p.z[0] < L.top && p.z[1] > L.floor - 0.5;
  const connLabels = [];
  for (const c of conns) {
    const ink = CONNECTOR_INK[c.type] ?? "#333";
    const pcs = c.pieces ?? [];
    const here = pcs.filter(pieceHere);
    const passes = pcs.some((p) => p.z[0] < L.top + 0.5 && p.z[1] > L.floor - 0.5);
    const exitsHere = (c.exits ?? []).filter((e) => e.layer === L.id);
    if (!passes && !exitsHere.length) continue;
    const g = [el("title", {}, esc(`${c.id}: ${c.type} (${c.form}), ${c.access}, stops ${c.stops.join(" > ")}${c.lengthBuilt ? `, built ${c.lengthBuilt} cells` : ""}`))]; // prettier-ignore
    pcs.forEach((p, i) => {
      if (!here.includes(p)) return;
      if (p.kind === "well" || p.kind === "shaft") g.push(poly(p.poly, { fill: p.kind === "shaft" ? "#efe6f5" : "#e6eef8", stroke: ink, "stroke-width": 2 })); // prettier-ignore
    });
    pcs.forEach((p, i) => {
      if (!here.includes(p)) return;
      if (p.kind === "flight") {
        g.push(poly(p.poly, { fill: "#ffffff", stroke: ink, "stroke-width": 1 }));
        // treads across the run: the run is toward the next piece (the one before for the last)
        const nb = pcs[i + 1] ?? pcs[i - 1];
        const c0 = polyC(p.poly);
        const c1 = nb ? polyC(nb.poly) : c0;
        let dir = [c1[0] - c0[0], c1[1] - c0[1]];
        if (!pcs[i + 1]) dir = [-dir[0], -dir[1]];
        const D = Math.hypot(dir[0], dir[1]) || 1;
        dir = [dir[0] / D, dir[1] / D];
        const e0 = [p.poly[1][0] - p.poly[0][0], p.poly[1][1] - p.poly[0][1]];
        const runIs0 = Math.abs(e0[0] * dir[0] + e0[1] * dir[1]) > Math.hypot(...e0) * 0.7;
        const [A, B, Cc, Dd] = runIs0 ? [p.poly[0], p.poly[3], p.poly[1], p.poly[2]] : [p.poly[0], p.poly[1], p.poly[3], p.poly[2]];
        for (let k = 1; k < 4; k++) {
          const t = k / 4;
          g.push(el("line", { x1: X(A[0] + (Cc[0] - A[0]) * t), y1: Y(A[1] + (Cc[1] - A[1]) * t), x2: X(B[0] + (Dd[0] - B[0]) * t), y2: Y(B[1] + (Dd[1] - B[1]) * t), stroke: "#888", "stroke-width": 0.7 })); // prettier-ignore
        }
        const half = 0.25;
        g.push(el("line", { x1: X(c0[0] - dir[0] * half), y1: Y(c0[1] - dir[1] * half), x2: X(c0[0] + dir[0] * half), y2: Y(c0[1] + dir[1] * half), stroke: "#c00", "stroke-width": 1, "marker-end": "url(#up)" })); // prettier-ignore
      } else if (p.kind === "landing") g.push(poly(p.poly, { fill: "#d7e3f1", stroke: ink, "stroke-width": 1 }));
      else if (p.kind === "car") g.push(poly(p.poly, { fill: ink, "fill-opacity": 0.35, stroke: ink, "stroke-width": 1 }) + el("path", { d: path([p.poly[0], p.poly[2]]) + path([p.poly[1], p.poly[3]]).replace("M", "M"), stroke: ink, "stroke-width": 1 })); // prettier-ignore
      else if (p.kind === "stub") {
        g.push(poly(p.poly, { fill: "url(#shatch)", stroke: ink, "stroke-width": 1.2, "stroke-dasharray": "4 2" }));
        if (p.toSeam) g.push(el("circle", { cx: X(p.toSeam[0]), cy: Y(p.toSeam[1]), r: 4.5, fill: ink, stroke: "#fff" }));
      }
    });
    // a column passing this layer without a piece at its height: its outline, dashed
    if (!here.length && passes) for (const p of pcs.filter((q) => q.kind === "well" || q.kind === "shaft")) g.push(poly(p.poly, { fill: "none", stroke: ink, "stroke-width": 1.2, "stroke-dasharray": "3 3" })); // prettier-ignore
    // exits: the keep-clear approach, an arrow out, a line to the stop it serves
    for (const e of exitsHere) {
      if (e.approach) g.push(poly(e.approach, { fill: EXIT, "fill-opacity": 0.16, stroke: EXIT, "stroke-width": 1, "stroke-dasharray": "3 2" })); // prettier-ignore
      const ac = e.approach ? polyC(e.approach) : e.at;
      g.push(el("line", { x1: X(e.at[0]), y1: Y(e.at[1]), x2: X(ac[0]), y2: Y(ac[1]), stroke: EXIT, "stroke-width": 2.2, "marker-end": "url(#ah)" })); // prettier-ignore
      const stop = C.where.get(e.stop);
      if (stop?.at && dist(stop.at, ac) > 1.2) g.push(el("path", { d: path([ac, stop.at]), stroke: EXIT, "stroke-width": 1, "stroke-dasharray": "1.5 2.5", fill: "none" })); // prettier-ignore
    }
    G.pieces.push(el("g", { id: `c-${c.id}` }, g.join("")));
    const anchor = (here[0] && polyC((here.find((p) => p.kind === "well" || p.kind === "shaft") ?? here[0]).poly)) ?? exitsHere[0]?.at ?? polyC(pcs[0].poly); // prettier-ignore
    const others = c.stops.filter((st) => !exitsHere.some((e) => e.stop === st)).map((st) => `${st}${C.where.get(st)?.layer ? ` (${C.where.get(st).layer})` : C.nodes.has(st) || C.lotOf.has(st) ? "" : " (other tile)"}`); // prettier-ignore
    connLabels.push({ c, anchor, lines: [{ text: c.id, size: 10, cls: "b" }, { text: `${c.type}${c.access !== "public" ? ` (${c.access})` : ""}: ${exitsHere.map((e) => e.stop).join(", ") || "passes"} → ${others.join(", ") || "-"}`, size: 8.5 }] }); // prettier-ignore
    shows.connectors.push(c.id);
  }

  // checkpoints: their rooms, the gate's own outline
  for (const cp of (C.net?.checkpoints ?? []).filter(onL)) {
    const g = [el("title", {}, esc(`${cp.id}: controls ${cp.controls.join(", ")}; ${cp.reason}`))];
    for (const r of cp.rooms) {
      const pp = r.poly ?? polyOfBox(boxOfRect(r.rect));
      g.push(poly(pp, { fill: r.kind === "gate" ? "url(#rhatch)" : r.kind === "holding-cell" ? "#d9c6e8" : "#f2c4bd", stroke: "#8e1f15", "stroke-width": r.kind === "gate" ? 2.4 : 1.4 })); // prettier-ignore
      const bc = centre(boxOfPoly(pp));
      const short = r.kind === "gate" ? "G" : r.kind === "guard-post" ? "GP" : r.kind === "holding-cell" ? "HC" : r.kind.slice(0, 3);
      g.push(text(X(bc[0]), Y(bc[1]) + 3, short, { "font-size": 8, "text-anchor": "middle", class: "b m" }));
    }
    G.cp.push(el("g", { id: `cp-${cp.id}` }, g.join("")));
    shows.checkpoints.push(cp.id);
  }

  // spawns, lamps (06), props (08)
  for (const sp of (C.net?.spawns ?? []).filter(onL)) {
    G.dress.push(spawnGlyph(X(sp.at[0]), Y(sp.at[1]), 6.5));
    shows.spawns.push(sp.id);
  }
  // lamps at this layer's ground (an upper storey's lamps stay off the ground plan)
  for (const lp of C.lamps.filter((x) => (!x.layer || x.layer === L.id) && (x.z === null || x.z < L.floor + 1.6))) {
    if (lp.at[0] < x0 || lp.at[0] > x1 || lp.at[1] < y0 || lp.at[1] > y1) continue;
    const big = lp.kind !== "room";
    G.dress.push((big ? el("circle", { cx: X(lp.at[0]), cy: Y(lp.at[1]), r: 8, fill: lp.colour, "fill-opacity": 0.22 }) : "") + el("circle", { cx: X(lp.at[0]), cy: Y(lp.at[1]), r: big ? 3.2 : 2, fill: lp.colour, stroke: "#5a4300", "stroke-width": big ? 1 : 0.6 })); // prettier-ignore
    shows.lamps++;
  }
  for (const pr of C.props.filter((x) => !x.layer || x.layer === L.id)) {
    if (pr.box && pr.box[2] > pr.box[0]) G.dress.push(el("rect", { ...R(pr.box), fill: PROP, "fill-opacity": 0.55, stroke: PROP, "stroke-width": 0.8 }));
    else G.dress.push(el("rect", { x: X(pr.at[0]) - 2.5, y: Y(pr.at[1]) - 2.5, width: 5, height: 5, fill: PROP }));
    shows.props++;
  }

  // 09: the deck's frame, the fusion band, the deck's edge, oculi, feet, the spine's drum
  const frameShows = C.a.a9 ? framePlan(C, L, { X, Y, P, poly, s, labels, G }) : null;

  // the tile, its margin, portals on the seams, the section lines
  const tb = C.tile.box;
  G.grid.push(el("path", { d: `M${f(X(x0))},${f(Y(y0))}H${f(X(x1))}V${f(Y(y1))}H${f(X(x0))}z M${f(X(tb[0]))},${f(Y(tb[1]))}V${f(Y(tb[3]))}H${f(X(tb[2]))}V${f(Y(tb[1]))}z`, fill: "#fff", "fill-opacity": 0.55, "fill-rule": "evenodd" })); // prettier-ignore
  G.grid.push(el("rect", { ...R(tb), fill: "none", stroke: "#1a5c8a", "stroke-width": 1.8, "stroke-dasharray": "9 5" }));
  for (const p of C.site.portals.filter((p) => !p.layer || onL(p))) {
    G.grid.push(portalGlyph(X(p.at[0]), Y(p.at[1]), 6));
    labels.block([X(p.at[0]) - 6, Y(p.at[1]) - 6, X(p.at[0]) + 6, Y(p.at[1]) + 6]);
    shows.portals.push(p.id);
  }
  const cut = sectionCut(C);
  if (cut) {
    G.grid.push(el("path", { d: path([[cut.x, y0], [cut.x, y1]]), stroke: "#333", "stroke-width": 1, "stroke-dasharray": "12 3 2 3" })); // prettier-ignore
    G.grid.push(el("path", { d: path([[x0, cut.y], [x1, cut.y]]), stroke: "#333", "stroke-width": 1, "stroke-dasharray": "12 3 2 3" })); // prettier-ignore
    G.top.push(text(X(cut.x) + 3, MY + 12, "section N-S", { "font-size": 9, class: "h d" }), text(MX + 4, Y(cut.y) - 3, "section E-W", { "font-size": 9, class: "h d" })); // prettier-ignore
  }

  // the marks
  const looksHere = C.looks.filter((lk) => lk.layer === L.id && lk.at);
  const used = [];
  for (const lk of looksHere) {
    let [cx, cy] = [X(lk.at[0]) + 9, Y(lk.at[1]) - 9];
    while (used.some((u) => Math.hypot(u[0] - cx, u[1] - cy) < 15)) cx += 15;
    used.push([cx, cy]);
    G.marks.push(el("line", { x1: X(lk.at[0]), y1: Y(lk.at[1]), x2: cx, y2: cy, stroke: WARN, "stroke-width": 1.2 }) + el("circle", { cx: X(lk.at[0]), cy: Y(lk.at[1]), r: 2.5, fill: WARN }) + lookGlyph(cx, cy, 7.5, lk.n)); // prettier-ignore
    labels.block([cx - 8, cy - 8, cx + 8, cy + 8]);
    shows.looks.push(lk.n);
  }

  // 07's names first on the wiring picture, the plan's own labels faded behind them
  const over = wiring ? wiringOverlay(C, L, X, Y, R, labels, shows) : "";
  const bl = wiring ? (ls, cands, o = {}) => labels.place(ls, cands, { ...o, force: !!(o.force && o.keep), fade: true }) : (ls, cands, o) => labels.place(ls, cands, o); // prettier-ignore
  // labels: buildings and connectors first (forced), then checkpoints, posts, spawns, plazas, ways, hallways
  for (const lot of C.lots.lots.filter((x) => onL(x) && x.kind === "enterable")) {
    const bb = pxBox(boxOfRect(lot.rect));
    const pl = C.planOf.get(lot.building);
    const sub = `${lot.type}${pl ? `, ${pl.variant}` : ""}, ${lot.storeys} st, door ${lot.frontage.side} on ${lot.frontage.way}`;
    bl([{ text: lot.building, size: 12, cls: "b" }, { text: sub, size: 8.5, cls: "d" }], [[bb[0], bb[1] - 2, 0, 1], [bb[2], bb[1] - 2, 1, 1], [bb[0], bb[3] + 2, 0, 0], [bb[2], bb[3] + 2, 1, 0], [bb[2] + 3, bb[1], 0, 0], [bb[0] - 3, bb[1], 1, 0], [bb[0] + 3, bb[1] + 3, 0, 0]], { force: true, keep: true, leader: [bb[0] + 2, bb[1] + 2] }); // prettier-ignore
  }
  for (const cl of connLabels) bl(cl.lines, around(X(cl.anchor[0]), Y(cl.anchor[1]), 16, [1, 1.8, 2.8]), { force: true, leader: [X(cl.anchor[0]), Y(cl.anchor[1])] }); // prettier-ignore
  for (const cp of (C.net?.checkpoints ?? []).filter(onL)) {
    const bc = centre(boxOfRect(cp.rooms.find((r) => r.kind === "guard-post")?.rect ?? cp.rooms[0].rect));
    bl([{ text: cp.id, size: 10, cls: "b m" }, { text: `controls ${cp.controls.join(", ")}`, size: 8, cls: "m" }], around(X(bc[0]), Y(bc[1]), 18, [1, 1.8, 2.6]), { force: true, leader: [X(bc[0]), Y(bc[1])] }); // prettier-ignore
  }
  for (const p of (C.net?.posts ?? []).filter(onL)) {
    const bc = centre(boxOfRect(p.rect));
    bl([{ text: p.id, size: 8, cls: "m" }], around(X(bc[0]), Y(bc[1]), 14, [1, 1.8]), { force: true, leader: [X(bc[0]), Y(bc[1])] }); // prettier-ignore
  }
  for (const sp of (C.net?.spawns ?? []).filter(onL)) bl([{ text: sp.id, size: 7.5, cls: "g" }], around(X(sp.at[0]), Y(sp.at[1]), 8, [1, 2]), { force: true, leader: [X(sp.at[0]), Y(sp.at[1])] }); // prettier-ignore
  for (const p of C.site.portals.filter((p) => !p.layer || onL(p))) bl([{ text: p.id, size: 8, cls: "d" }], around(X(p.at[0]), Y(p.at[1]), 9, [1, 1.8]), { force: true }); // prettier-ignore
  for (const p of C.site.plazas.filter(onL)) {
    const bb = pxBox(p.box);
    bl([{ text: `${p.name ?? p.id}`, size: 11, cls: "b" }, { text: `${p.id} (${p.kind})`, size: 8.5, cls: "d" }], [[bb[0] + 4, bb[1] + 4, 0, 0], [bb[2] - 4, bb[1] + 4, 1, 0], [bb[0] + 4, bb[3] - 4, 0, 1], [bb[2] - 4, bb[3] - 4, 1, 1]], { force: true, keep: true }); // prettier-ignore
  }
  for (const w of ways) {
    const pts = w.parts.reduce((a, b) => (lineLen(b) > lineLen(a) ? b : a));
    const at = midOf(pts);
    if (at[0] < x0 || at[0] > x1 || at[1] < y0 || at[1] > y1) continue;
    bl([{ text: `${w.id} ${f(w.width)}c${w.portico ? ` portico ${f(w.portico)}` : w.sidewalk ? ` walk ${f(w.sidewalk)}` : ""}`, size: 8.5, cls: "d" }], around(X(at[0]), Y(at[1]), w.width * s * 0.5 + 4, [1, 1.6]).concat([[X(at[0]), Y(at[1]), 0.5, 0.5]]), { leader: [X(at[0]), Y(at[1])] }); // prettier-ignore
  }
  for (const h of (C.net?.hallways ?? []).filter((x) => onL(x) && x.path?.length)) {
    const at = midOf(h.path);
    bl([{ text: `${h.id}${h.bridges?.length ? ` (${h.bridges.length} bridge${h.bridges.length > 1 ? "s" : ""})` : ""}`, size: 7.5, cls: "m" }], around(X(at[0]), Y(at[1]), 10, [1, 1.6]), { leader: [X(at[0]), Y(at[1])] }); // prettier-ignore
  }
  for (const d of dists) {
    const bb = pxBox(d.area);
    const pal = C.palette.get(d.id);
    const box = bl([{ text: d.name, size: 11, cls: "b i" }, { text: `${d.id}, ${d.wealth}`, size: 8.5, cls: "d" }], [[Math.max(bb[0], MX) + 4, Math.max(bb[1], MY) + 4, 0, 0], [Math.min(bb[2], MX + mapW) - 4, Math.max(bb[1], MY) + 4, 1, 0], [Math.max(bb[0], MX) + 4, Math.min(bb[3], MY + mapH) - 4 - (pal ? 12 : 0), 0, 1]], { force: true, keep: true }); // prettier-ignore
    if (pal && box) {
      pal.colours.slice(0, 8).forEach((c, i) => G.top.push(el("rect", { x: box[0] + 1 + i * 11, y: box[3] + 1, width: 10, height: 9, fill: c, stroke: "#333", "stroke-width": 0.6 }))); // prettier-ignore
      labels.block([box[0], box[3], box[0] + 90, box[3] + 11]);
    }
  }

  // scale bar and north arrow
  const nice = 5;
  const sb = { x: MX + 10, y: MY + mapH - 40, w: nice * s + 130, h: 32 };
  const scale = [el("rect", { x: sb.x, y: sb.y, width: sb.w, height: sb.h, fill: "#fff", "fill-opacity": 0.9, stroke: "#555", "stroke-width": 0.8 })]; // prettier-ignore
  for (let i = 0; i < 5; i++) scale.push(el("rect", { x: sb.x + 10 + i * s, y: sb.y + 6, width: s, height: 6, fill: i % 2 ? "#fff" : "#111", stroke: "#111", "stroke-width": 0.8 })); // prettier-ignore
  scale.push(text(sb.x + 10, sb.y + 25, `${nice} cells = ${f(nice * cell)} m = ${nice * C.site.grid.cellUnits} units`, { "font-size": 10 })); // prettier-ignore
  const na = { x: MX + mapW - 26, y: MY + 12 };
  const north = el("path", { d: `M${f(na.x)},${f(na.y)}L${f(na.x + 8)},${f(na.y + 22)}L${f(na.x)},${f(na.y + 17)}L${f(na.x - 8)},${f(na.y + 22)}z`, fill: "#111", stroke: "#fff", "stroke-width": 1 }) + text(na.x, na.y + 34, "N", { "font-size": 12, "text-anchor": "middle", class: "h b" }); // prettier-ignore


  // the legend
  const col = new Column(MX + mapW + PAD, MY - 14, LEGEND_W);
  if (wiring) {
    col.heading("Named (07)");
    col.line(`zones ${shows.zones.length}, doors on the ground storey ${shows.namedDoors.length} (${shows.upperDoors} more on upper storeys: see 07-wiring.json), switches here ${shows.switches.length}`); // prettier-ignore
    for (const [o, words] of [["residents", "residents"], ["business", "business"], ["msr", "the MSR"], ["insurgents", "insurgents"], ["city", "city"]]) col.row((x, y, w, h) => el("rect", { x: x + 4, y: y + 3, width: 8, height: 8, fill: o === "msr" ? "#b3261e" : o === "insurgents" ? "#6a2c91" : o === "residents" ? "#0f6a3a" : o === "business" ? "#1d4f91" : "#444" }) + el("rect", { x: x + 18, y: y + 3, width: 8, height: 8, fill: "#fff", stroke: o === "msr" ? "#b3261e" : o === "insurgents" ? "#6a2c91" : o === "residents" ? "#0f6a3a" : o === "business" ? "#1d4f91" : "#444", "stroke-width": 1.6 }), `door of ${words}: filled lockable, hollow not; property doors' names bold`); // prettier-ignore
    col.row((x, y, w, h) => el("rect", { x, y, width: w, height: h, fill: "#1d4f91", "fill-opacity": 0.06, stroke: "#1d4f91", "stroke-dasharray": "8 3", "stroke-width": 1.6 }), "zone (blue building, red MSR, brown district, green way)"); // prettier-ignore
    col.row((x, y, w, h) => el("rect", { x: x + 4, y: y + 3, width: 8, height: 8, fill: "#f5b800", stroke: "#222" }) + el("circle", { cx: x + 22, cy: y + 7, r: 4.5, fill: "#fff3b0", stroke: "#a07800", "stroke-width": 1.4 }), "switch (S) and the light it may target"); // prettier-ignore
    col.row((x, y, w, h) => el("circle", { cx: x + 15, cy: y + 7, r: 5, fill: "#7a3fa0" }), "lift stop and its call button");
  }
  col.heading(`${L.id} ${L.name ?? ""}`);
  col.line(`z ${L.z[0]} to ${L.z[1]} cells (${f(L.z[0] * cell)} to ${f(L.z[1] * cell)} m), ceiling ${L.ceiling}, ${L.wealth}${L.gated ? ", gated" : ""}`); // prettier-ignore
  const ent = shows.buildings.length;
  col.line(`enterable buildings ${ent}, facades ${shows.facades}, ways ${shows.ways.length}, plazas ${shows.plazas.length}; connectors ${shows.connectors.length}, checkpoints ${shows.checkpoints.length}, posts ${shows.posts.length}, hallways ${shows.hallways.length}, spawns ${shows.spawns.length}${C.a.a6 ? `, lamps ${shows.lamps}` : ""}${C.a.a8 ? `, props ${shows.props}` : ""}`); // prettier-ignore
  const wk = C.net?.measures?.walk?.byLayer?.[L.id];
  if (wk) col.line(`walk to a connector: farthest ${f(wk.distance)} cells (${wk.farthest}), p90 ${f(wk.p90)}${wk.cutOffCells ? `, ${wk.cutOffCells} cells cut off` : ""}`, { cls: "d" }); // prettier-ignore
  if (!faded) {
    col.heading("Ground and ways (widths to scale)");
    col.row((x, y, w, h) => el("rect", { x, y, width: w, height: h, fill: WEALTH_FILL.mid, "fill-opacity": 0.55, stroke: "#6d6150", "stroke-dasharray": "6 3" }), "district, tinted by wealth (dashed edge)"); // prettier-ignore
    col.row((x, y, w, h) => el("rect", { x, y, width: w, height: h, fill: "url(#nofloor)" }), "no floor on this layer");
    col.row((x, y, w, h) => el("rect", { x, y, width: w, height: h, fill: STREET_LOOK.street.band, stroke: CASING }) + el("rect", { x, y: y + 3.5, width: w, height: h - 7, fill: STREET_LOOK.street.way }), "way: sidewalk band, carriageway"); // prettier-ignore
    col.row((x, y, w, h) => el("rect", { x, y, width: w, height: h, fill: STREET_LOOK.avenue.band, stroke: CASING }) + el("rect", { x, y: y + 4, width: w, height: h - 8, fill: STREET_LOOK.avenue.way }) + [3, 9, 15, 21, 27].map((cx) => el("circle", { cx: x + cx, cy: y + 4, r: 1.4, fill: "#6b5a3a" }) + el("circle", { cx: x + cx, cy: y + h - 4, r: 1.4, fill: "#6b5a3a" })).join(""), "portico: a colonnade each side"); // prettier-ignore
    col.row((x, y, w, h) => el("rect", { x, y, width: w, height: h, fill: STREET_LOOK.canal.band, stroke: CASING }) + el("rect", { x, y: y + 3.5, width: w, height: h - 7, fill: "#73aadd" }), "canal: quays and water"); // prettier-ignore
    col.row((x, y, w, h) => el("rect", { x, y, width: w, height: h, fill: "#f2ead6", stroke: CASING }), "plaza");
    col.row((x, y, w, h) => el("rect", { x, y, width: w, height: h, fill: STREET_LOOK.avenue.band, stroke: CASING }) + el("rect", { x: x + 6, y: y + 4, width: w - 12, height: h - 8, fill: "#f2ead6" }) + [6, 12, 18, 24].map((cx) => el("rect", { x: x + cx - 1.5, y: y + 2.5, width: 3, height: 3, fill: "#6b5a3a" })).join("") + el("circle", { cx: x + 3, cy: y + h - 3, r: 1.6, fill: "none", stroke: "#6b5a3a", "stroke-width": 0.7 }), "a square's portico and its columns (a ring: a column left out)"); // prettier-ignore
    col.row((x, y, w, h) => el("rect", { x: x + 8, y: y + 1, width: 12, height: h - 2, fill: "#cdbb93", stroke: "#4a3f30" }) + el("circle", { cx: x + 14, cy: y + h / 2, r: 3, fill: "#7a2f4f" }) + el("circle", { cx: x + 26, cy: y + h / 2, r: 4.5, fill: "none", stroke: "#4a1f6b", "stroke-width": 1.6, "stroke-dasharray": "3 2" }), "monument on its plinth; a tower over its building (dashed)"); // prettier-ignore
    col.heading("Lots and buildings");
    col.row((x, y, w, h) => el("rect", { x, y, width: w, height: h, fill: "url(#fhatch)", stroke: "#6d6150" }), "facade lot: kind, storeys / height in cells (blue dashes: a connector stands in it)"); // prettier-ignore
    col.row((x, y, w, h) => el("rect", { x, y, width: w, height: h, fill: "#fff", stroke: "#111", "stroke-width": 2.4 }), "enterable lot: its ground storey drawn inside"); // prettier-ignore
    for (const [z, words] of [["public", "public rooms"], ["staff", "staff"], ["home", "home"], ["private", "private"], ["secure", "secure (cells)"], ["circulation", "corridor, stairwell"]]) // prettier-ignore
      col.row((x, y, w, h) => el("rect", { x: x + 6, y, width: 18, height: h, fill: ZONE_FILL[z], stroke: "#999" }), words);
    col.row((x, y, w, h) => el("rect", { x: x + 6, y, width: 18, height: h, fill: "url(#vhatch)", stroke: "#9ab" }), "court, terrace, well or shaft kept clear"); // prettier-ignore
    col.row((x, y, w, h) => el("line", { x1: x + 4, y1: y + h - 2, x2: x + 4, y2: y + 1, stroke: "#c84", "stroke-width": 1.8 }) + el("path", { d: `M${x + 4},${y + 1}A13 13 0 0 1 ${x + 17},${y + h - 2}`, fill: "none", stroke: "#c84", "stroke-width": 0.8, "stroke-dasharray": "2 2" }) + el("line", { x1: x + 20, y1: y + h / 2, x2: x + 30, y2: y + h / 2, stroke: "#2a7bd0", "stroke-width": 3 }), "door and its swing (orange: street), window (blue)"); // prettier-ignore
    col.heading("Between layers");
    for (const [k, words] of [["grand-stair", "grand stair"], ["stair", "stair"], ["lift", "lift"], ["secret", "secret"]]) col.row((x, y, w, h) => el("rect", { x: x + 4, y, width: 22, height: h, fill: "#fff", stroke: CONNECTOR_INK[k], "stroke-width": 2 }) + [8, 13, 18, 23].map((xx) => el("line", { x1: x + xx, y1: y, x2: x + xx, y2: y + h, stroke: "#888", "stroke-width": 0.7 })).join(""), `${words}: flight with treads, red arrow up`); // prettier-ignore
    col.row((x, y, w, h) => el("rect", { x: x + 4, y, width: 22, height: h, fill: "#e6eef8", stroke: CONNECTOR_INK.stair, "stroke-width": 2 }) + el("rect", { x: x + 9, y: y + 3, width: 12, height: h - 6, fill: "#d7e3f1", stroke: CONNECTOR_INK.stair }), "well with a landing; dashed: a column passing this layer"); // prettier-ignore
    col.row((x, y, w, h) => el("rect", { x: x + 8, y, width: 14, height: h, fill: "#efe6f5", stroke: CONNECTOR_INK.lift, "stroke-width": 2 }) + el("rect", { x: x + 10, y: y + 2, width: 10, height: h - 4, fill: CONNECTOR_INK.lift, "fill-opacity": 0.35 }), "lift shaft, its car at this layer"); // prettier-ignore
    col.row((x, y, w, h) => el("rect", { x: x + 14, y, width: 14, height: h, fill: EXIT, "fill-opacity": 0.16, stroke: EXIT, "stroke-dasharray": "3 2" }) + el("line", { x1: x + 2, y1: y + h / 2, x2: x + 20, y2: y + h / 2, stroke: EXIT, "stroke-width": 2.2, "marker-end": "url(#ah)" }), "exit, its keep-clear approach; dots lead to its stop"); // prettier-ignore
    col.row((x, y, w, h) => el("rect", { x: x + 4, y, width: 22, height: h, fill: "url(#shatch)", stroke: CONNECTOR_INK.secret, "stroke-dasharray": "4 2" }), "stub to a stop in another tile"); // prettier-ignore
    col.heading("The MSR and the public");
    col.row((x, y, w, h) => el("rect", { x, y, width: 14, height: h, fill: "url(#rhatch)", stroke: "#8e1f15", "stroke-width": 2 }) + el("rect", { x: x + 16, y, width: 14, height: h, fill: "#f2c4bd", stroke: "#8e1f15" }), "checkpoint gate (G), guard post (GP), holding cell (HC); post"); // prettier-ignore
    col.row((x, y, w, h) => el("rect", { x, y: y + 2, width: w, height: h - 4, fill: HALL, "fill-opacity": 0.33 }) + el("rect", { x: x + 10, y: y + 2, width: 10, height: h - 4, fill: "#8e1f15", "fill-opacity": 0.75 }), "service hallway (1.5 cells), a bridge over public floor darker"); // prettier-ignore
    col.row((x, y, w, h) => spawnGlyph(x + 15, y + h / 2, 6), "spawn");
    col.row((x, y, w, h) => el("path", { d: `M${x},${y + h / 2}h30`, stroke: "#1a5c8a", "stroke-width": 1.6, "stroke-dasharray": "9 5" }) + portalGlyph(x + 15, y + h / 2, 4.5), "tile edge (the margin beyond it paled), portal"); // prettier-ignore
    if (C.a.a6) {
      col.row((x, y, w, h) => el("circle", { cx: x + 15, cy: y + h / 2, r: 8, fill: LAMP, "fill-opacity": 0.22 }) + el("circle", { cx: x + 15, cy: y + h / 2, r: 3.2, fill: LAMP, stroke: "#5a4300" }), "lamp at this layer's ground, in its colour (06)"); // prettier-ignore
      col.heading("Palette as built (06): lamp colours, roles");
      for (const d of dists) {
        const pal = C.palette.get(d.id);
        if (!pal) continue;
        col.row((x, y, w, h) => pal.colours.slice(0, 3).map((c, i) => el("rect", { x: x + i * 10, y, width: 9, height: h, fill: c, stroke: "#333", "stroke-width": 0.6 })).join(""), `${d.id}: ${["wall", "floor", "trim", "door"].filter((k) => pal.roles[k]).map((k) => `${k} ${[...pal.roles[k]].join(", ")}`).join("; ")}`); // prettier-ignore
      }
      for (const [id, pal] of [...C.palette.entries()].filter(([id]) => id.endsWith("(faction)"))) col.row(() => "", `${id}: ${["wall", "floor", "door"].filter((k) => pal.roles[k]).map((k) => `${k} ${[...pal.roles[k]].join(", ")}`).join("; ")}`); // prettier-ignore
    }
    if (C.a.a8) col.row((x, y, w, h) => el("rect", { x: x + 11, y: y + 3, width: 8, height: 8, fill: PROP }), "prop (08)");
    if (C.a.a9) frameLegend(C, L, col, frameShows);
    if (C.a.a9) edgeView(C, L, col);
  }
  const notesHere = C.looks.filter((lk) => lk.layer === L.id);
  const notesNowhere = C.looks.filter((lk) => !lk.layer);
  col.heading(`Look here on ${L.id} (${notesHere.length})`);
  lookLegend(col);
  if (!notesHere.length) col.line("nothing marked", { cls: "d" });
  for (const lk of notesHere) col.line(`${lk.n}. ${lk.text}`, { size: 9.5, cls: lk.kind === "gate-note" ? "d" : "w" });
  if (notesNowhere.length) {
    col.heading(`Gate notes with no place (${notesNowhere.length})`);
    for (const lk of notesNowhere) col.line(`${lk.n}. ${lk.text}`, { size: 9.5, cls: lk.kind === "gate-failure" ? "w" : "d" });
  }
  const missing = [6, 7, 8].filter((n) => !C.a[`a${n}`]);
  if (missing.length) col.line(`not drawn, not made yet: ${missing.map((n) => `0${n}`).join(", ")}`, { cls: "d", size: 9.5 });

  const width = MX + mapW + PAD + LEGEND_W + PAD;
  const height = Math.max(MY + mapH + PAD, col.y + PAD + 10);
  const kindWord = wiring ? "named doors and zones (07)" : "plan";
  const titleText = `${C.desc?.title ?? C.desc?.name ?? "city"}: tile ${C.tile.id}${C.tile.name ? ` (${C.tile.name})` : ""}, ${L.id} ${L.name ?? ""}: ${kindWord}`; // prettier-ignore
  const hashes = Object.values(C.arts).map((a) => `${a.file.slice(0, 2)} ${a.hash.slice(0, 8)}`).join("  ");
  const head = [
    text(PAD, 24, titleText, { "font-size": 19, class: "b" }),
    text(PAD, 42, `R1 review from the generator's artifacts · seed ${C.site.params?.seed ?? "?"} · 1 cell = ${f(cell)} m = ${C.site.grid.cellUnits} units, ${s} px a cell · window x ${x0} to ${x1}, y ${y0} to ${y1}`, { "font-size": 11, class: "d" }), // prettier-ignore
    text(PAD, 57, `artifacts sha256: ${hashes}`, { "font-size": 10, class: "d" }),
  ].join("");
  const clip = el("clipPath", { id: "map" }, el("rect", { x: MX, y: MY, width: mapW, height: mapH }));
  const base = [G.bg, G.dist, G.blocks, G.lots, G.ways, G.plazas, G.bldg, G.hall, G.pieces, G.cp, G.dress, G.frame].map((x) => x.join("")).join("\n"); // prettier-ignore
  const body = [
    head,
    clip,
    el("g", { "clip-path": "url(#map)" }, (faded ? el("g", { opacity: 0.35 }, base) : base) + over + [G.grid, G.marks, G.top].map((x) => x.join("")).join("\n")), // prettier-ignore
    el("rect", { x: MX, y: MY, width: mapW, height: mapH, fill: "none", stroke: "#222", "stroke-width": 1.2 }),
    el("g", { id: "labels", "clip-path": "url(#map)" }, labels.svg.join("")),
    scale.join(""),
    north,
    el("g", { id: "legend" }, col.svg.join("")),
  ].join("\n");
  const meta = { review: "R1", tile: C.tile.id, layer: L.id, picture: wiring ? "wiring" : "plan", artifacts: Object.fromEntries(Object.values(C.arts).map((a) => [a.file, a.hash])) }; // prettier-ignore
  return { svg: svgDoc(width, height, titleText, meta, body), shows, omitted: labels.omitted };
}

/** A building's ground storey in the city's frame: rooms by zone, voids, walls, windows, doors, stairs. */
function groundStorey(C, b, X, Y, s, quiet = false) {
  const cell = C.cell;
  const M = (p) => cellsOf(b, cell, p);
  const XM = (x) => X(b.frame.origin_cells[0] + x / cell);
  const YM = (y) => Y(b.frame.origin_cells[1] + y / cell);
  const k = s / cell; // px a metre
  const g = [];
  const st = 0;
  const rectM = (q, a) => el("rect", { x: XM(q.x), y: YM(q.y + q.d), width: q.w * k, height: q.d * k, ...a });
  for (const v of b.voids.filter((x) => x.storey === st)) for (const q of v.rects) g.push(rectM(q, { fill: "url(#vhatch)", stroke: "#9ab", "stroke-width": 0.8 })); // prettier-ignore
  for (const r of b.rooms.filter((x) => x.storey === st)) {
    const zone = C.zones[r.kind] ?? (r.kind === "corridor" || r.kind === "stairwell" ? "circulation" : null);
    const fill = r.hidden ? "#c9b48a" : ZONE_FILL[zone] ?? "#f0f0f0";
    for (const q of r.rects) g.push(rectM(q, { fill }));
  }
  for (const w of b.walls.filter((x) => x.storey === st)) {
    const t = Math.max(1, w.thickness_m * k);
    const vertical = w.a[0] === w.b[0];
    const len = vertical ? w.b[1] - w.a[1] : w.b[0] - w.a[0];
    const holes = w.holes.filter((h) => h.kind === "door").map((h) => [h.along_m - h.width / 2, h.along_m + h.width / 2]).sort((p, q) => p[0] - q[0]); // prettier-ignore
    let t0 = 0;
    const spans = [];
    for (const [h0, h1] of holes) {
      if (h0 > t0) spans.push([t0, h0]);
      t0 = Math.max(t0, h1);
    }
    if (len > t0) spans.push([t0, len]);
    const off = w.kind === "exterior" ? exteriorOffset(b, w) : 0;
    for (const [p0, p1] of spans) {
      if (vertical) g.push(el("line", { x1: XM(w.a[0] + off), y1: YM(w.a[1] + p0), x2: XM(w.a[0] + off), y2: YM(w.a[1] + p1), stroke: "#222", "stroke-width": t })); // prettier-ignore
      else g.push(el("line", { x1: XM(w.a[0] + p0), y1: YM(w.a[1] + off), x2: XM(w.a[0] + p1), y2: YM(w.a[1] + off), stroke: "#222", "stroke-width": t })); // prettier-ignore
    }
  }
  for (const w of b.windows.filter((x) => x.storey === st)) {
    const [fx, fy] = w.facing;
    const [ux, uy] = [-fy, fx];
    const h = w.width / 2;
    g.push(el("line", { x1: XM(w.at[0] - ux * h), y1: YM(w.at[1] - uy * h), x2: XM(w.at[0] + ux * h), y2: YM(w.at[1] + uy * h), stroke: w.street ? "#2a7bd0" : "#7ab", "stroke-width": 2.2 })); // prettier-ignore
  }
  for (const stp of b.stairs.filter((x) => x.storey === st)) {
    for (const fl of stp.flights) {
      const c = flightPoly(fl);
      g.push(el("polygon", { points: c.map((p) => `${f(XM(p[0]))},${f(YM(p[1]))}`).join(" "), fill: "#fff", stroke: "#444", "stroke-width": 0.8 })); // prettier-ignore
      const n = Math.max(2, Math.min(8, fl.risers - 1));
      const [fx, fy] = fl.facing;
      for (let i = 1; i < n; i++) {
        const t = (fl.run * i) / n;
        g.push(el("line", { x1: XM(c[0][0] + fx * t), y1: YM(c[0][1] + fy * t), x2: XM(c[1][0] + fx * t), y2: YM(c[1][1] + fy * t), stroke: "#999", "stroke-width": 0.5 })); // prettier-ignore
      }
      g.push(el("line", { x1: XM(fl.at[0] + fx * 0.3), y1: YM(fl.at[1] + fy * 0.3), x2: XM(fl.at[0] + fx * (fl.run - 0.4)), y2: YM(fl.at[1] + fy * (fl.run - 0.4)), stroke: "#c00", "stroke-width": 0.9, "marker-end": "url(#up)" })); // prettier-ignore
    }
    if (stp.halfLanding) g.push(el("polygon", { points: landingPoly(stp.halfLanding).map((p) => `${f(XM(p[0]))},${f(YM(p[1]))}`).join(" "), fill: "#eef", stroke: "#444", "stroke-width": 0.6 })); // prettier-ignore
  }
  for (const d of b.doors.filter((x) => x.storey === st)) {
    const [fx, fy] = d.facing;
    const [ux, uy] = [-fy, fx];
    const h = d.width / 2;
    const p0 = [d.at[0] - ux * h, d.at[1] - uy * h];
    const p1 = [d.at[0] + ux * h, d.at[1] + uy * h];
    const col = d.street ? "#d0671b" : d.kind === "secret" ? "#a60" : d.kind === "cell" ? "#649" : "#06c";
    if (d.swing === "none") g.push(el("line", { x1: XM(p0[0]), y1: YM(p0[1]), x2: XM(p1[0]), y2: YM(p1[1]), stroke: col, "stroke-width": 1.4, "stroke-dasharray": "2 1.5" })); // prettier-ignore
    else {
      const hinge = d.hinge === "low" ? p0 : p1;
      const free = d.hinge === "low" ? p1 : p0;
      const tip = [hinge[0] + fx * d.width, hinge[1] + fy * d.width];
      g.push(el("line", { x1: XM(hinge[0]), y1: YM(hinge[1]), x2: XM(tip[0]), y2: YM(tip[1]), stroke: col, "stroke-width": d.street ? 2 : 1.3 })); // prettier-ignore
      const cross = (tip[0] - hinge[0]) * (free[1] - hinge[1]) - (tip[1] - hinge[1]) * (free[0] - hinge[0]);
      g.push(el("path", { d: `M ${f(XM(tip[0]))} ${f(YM(tip[1]))} A ${f(d.width * k)} ${f(d.width * k)} 0 0 ${cross > 0 ? 1 : 0} ${f(XM(free[0]))} ${f(YM(free[1]))}`, fill: "none", stroke: col, "stroke-width": 0.7, "stroke-dasharray": "2 1.5" })); // prettier-ignore
    }
    if (d.street) {
      // the street door: a bold notch outside, so the entrance reads at a glance
      const o = [d.at[0] - fx * 0.5, d.at[1] - fy * 0.5];
      g.push(el("circle", { cx: XM(o[0]), cy: YM(o[1]), r: 3, fill: "#d0671b", stroke: "#fff", "stroke-width": 0.8 }));
    }
  }
  const texts = [];
  if (!quiet)
    for (const r of b.rooms.filter((x) => x.storey === st)) {
      const main = r.rects.reduce((m, q) => (q.w * q.d > m.w * m.d ? q : m), r.rects[0]);
      const [w, h] = [main.w * k, main.d * k];
      const size = 7;
      const word = r.kind;
      if (textW(word, size) < w - 3 && h > 10) texts.push(el("text", { x: XM(main.x + main.w / 2), y: YM(main.y + main.d / 2) - 3, "font-size": size, "text-anchor": "middle", class: "h" }, esc(word))); // prettier-ignore
    }
  void M;
  return { body: g.join(""), texts: texts.join("") };
}

function exteriorOffset(b, w) {
  const t = w.thickness_m;
  const room = b.rooms.find((r) => w.rooms.includes(r.id) && r.storey === w.storey);
  if (!room) return 0;
  const q = room.rects[0];
  const vertical = w.a[0] === w.b[0];
  const c = vertical ? w.a[0] : w.a[1];
  const mid = vertical ? q.x + q.w / 2 : q.y + q.d / 2;
  return mid > c ? -t / 2 : t / 2;
}

// ── 07: the named doors and the zones over a faded plan ──

function wiringOverlay(C, L, X, Y, R, labels, shows) {
  const doc = C.wiring;
  const out = [];
  shows.namedDoors = [];
  shows.zones = [];
  const zones = listOf(doc, ["zones"]);
  for (const z of zones) {
    const id = z.id ?? z.name;
    let box = Array.isArray(z.box) ? z.box : z.rect ? boxOfRect(z.rect) : Array.isArray(z.poly) ? boxOfPoly(z.poly) : null;
    let layer = z.layer ?? null;
    if (!box) {
      const ref = z.building ?? z.of ?? id;
      const lot = C.lotOf.get(ref);
      const dd = C.districts.find((d) => d.id === ref);
      const way = C.site.ways.find((w) => w.id === ref);
      if (lot) (box = boxOfRect(lot.rect)), (layer ??= lot.layer);
      else if (dd) (box = dd.area), (layer ??= dd.layer);
      else if (way?.parts?.[0]) (box = grow(boxOfPoly(way.parts.flat()), way.width / 2)), (layer ??= way.layer);
    }
    if (!box || (layer && layer !== L.id)) continue;
    const kind = z.kind ?? "zone";
    const ink = kind === "msr" || /msr/.test(id) ? "#b3261e" : kind === "district" ? "#6d6150" : kind === "building" ? "#1d4f91" : "#0f8a4a";
    out.push(el("rect", { ...R(box), fill: ink, "fill-opacity": 0.06, stroke: ink, "stroke-width": 1.6, "stroke-dasharray": "8 3" }));
    labels.place([{ text: `zone ${id}`, size: 8.5, cls: "b" }], [[R(box).x + 3, R(box).y + R(box).height - 3, 0, 1], [R(box).x + R(box).width - 3, R(box).y + 3, 1, 0]], { force: true }); // prettier-ignore
    shows.zones.push(id);
  }
  // doors of the ground storey (and the checkpoints' and hatches'), by owner; filled when lockable
  const doorById = new Map();
  for (const b of C.plans?.buildings ?? []) for (const d of b.doors) doorById.set(d.id, { b, d });
  const inkOf = (o) => (o === "msr" ? "#b3261e" : o === "insurgents" ? "#6a2c91" : o === "residents" ? "#0f6a3a" : o === "business" ? "#1d4f91" : "#444"); // prettier-ignore
  shows.upperDoors = 0;
  for (const d of listOf(doc, ["doors"])) {
    const name = d.name ?? d.id;
    const ref = doorById.get(d.id);
    const at = Array.isArray(d.at) ? d.at : ref?.d.cells ?? null;
    const layer = d.layer ?? C.layerAtZ(at?.[2]) ?? ref?.b.layer ?? C.lotOf.get(d.building)?.layer ?? null;
    if (!at || (layer && layer !== L.id)) continue;
    if ((d.storey ?? ref?.d.storey ?? 0) !== 0) {
      shows.upperDoors++;
      continue;
    }
    const ink = inkOf(d.owner);
    out.push(el("rect", { x: X(at[0]) - 3.5, y: Y(at[1]) - 3.5, width: 7, height: 7, fill: d.lockable ? ink : "#fff", stroke: ink, "stroke-width": 1.6 })); // prettier-ignore
    labels.place([{ text: name, size: d.property ? 9 : 7.5, cls: d.property ? "b" : "" }], around(X(at[0]), Y(at[1]), 6, [1, 2, 3]), { force: !!d.property, leader: [X(at[0]), Y(at[1])] }); // prettier-ignore
    shows.namedDoors.push(name);
  }
  // switches, switchable lights, lift stops and call buttons
  shows.switches = [];
  for (const sw of listOf(doc, ["switches"])) {
    const at = sw.at;
    if (!Array.isArray(at) || (C.layerAtZ(at[2]) ?? L.id) !== L.id || at[2] > L.floor + 1.6) continue;
    out.push(el("rect", { x: X(at[0]) - 4, y: Y(at[1]) - 4, width: 8, height: 8, fill: "#f5b800", stroke: "#222", "stroke-width": 1 }) + el("text", { x: X(at[0]), y: Y(at[1]) + 2.6, "font-size": 7, "text-anchor": "middle", class: "b" }, "S")); // prettier-ignore
    labels.place([{ text: `${sw.name} → ${(sw.targets ?? []).join(", ")}`, size: 7.5 }], around(X(at[0]), Y(at[1]), 7, [1, 2]), { leader: [X(at[0]), Y(at[1])] }); // prettier-ignore
    shows.switches.push(sw.name);
  }
  for (const lt of listOf(doc, ["lights"])) {
    const at = lt.at;
    if (!Array.isArray(at) || (C.layerAtZ(at[2]) ?? L.id) !== L.id || at[2] > L.floor + 1.6) continue;
    out.push(el("circle", { cx: X(at[0]), cy: Y(at[1]), r: 4.5, fill: "#fff3b0", stroke: "#a07800", "stroke-width": 1.4 }));
    labels.place([{ text: lt.name, size: 7 }], around(X(at[0]), Y(at[1]), 6, [1]), {});
  }
  for (const lf of listOf(doc, ["lifts"]))
    for (const st of lf.stops ?? []) {
      if (st.layer !== L.id || !Array.isArray(st.at)) continue;
      out.push(el("circle", { cx: X(st.at[0]), cy: Y(st.at[1]), r: 5, fill: "#7a3fa0", stroke: "#fff", "stroke-width": 1 }));
      labels.place([{ text: `${st.name}${st.call ? ` (call ${st.call})` : ""}`, size: 8, cls: "b" }], around(X(st.at[0]), Y(st.at[1]), 8, [1, 2, 3]), { force: true, leader: [X(st.at[0]), Y(st.at[1])] }); // prettier-ignore
    }
  return out.join("");
}

// ── the section through the Nexus spine ──

/** Where the section cuts: through the spine's column (the connector reaching the most layers, a spine first). */
function sectionCut(C) {
  const conns = (C.net?.connectors ?? []).filter((c) => (c.pieces ?? []).some((p) => p.kind === "well" || p.kind === "shaft"));
  if (!conns.length) return null;
  const layersOf = (c) => new Set((c.exits ?? []).map((e) => e.layer)).size;
  const rank = (c) => layersOf(c) * 10 + (/spine/.test(c.id) ? 5 : 0) + (c.type === "stair" || c.type === "grand-stair" ? 1 : 0);
  const spine = conns.reduce((a, b) => (rank(b) > rank(a) ? b : a));
  const col = spine.pieces.find((p) => p.kind === "well" || p.kind === "shaft");
  const [x, y] = polyC(col.poly);
  return { x, y, spine };
}

function sectionPicture(C, axis) {
  // axis 0: the cut is x = const and runs south to north (N-S); axis 1: y = const, west to east (E-W)
  const cut = sectionCut(C);
  if (!cut) return null;
  const s = C.scale;
  const cell = C.cell;
  const c = axis === 0 ? cut.x : cut.y;
  const [w0, w1] = axis === 0 ? [C.tile.window[1], C.tile.window[3]] : [C.tile.window[0], C.tile.window[2]];
  const zTop = Math.max(...C.layers.map((L) => L.sky ?? L.top)) + 1.5;
  const zBot = Math.min(...C.layers.map((L) => L.floor)) - 1;
  const MX = PAD + 46;
  const MY = HEADER + 22;
  const mapW = (w1 - w0) * s;
  const mapH = (zTop - zBot) * s;
  const H = (u) => MX + (u - w0) * s;
  const V = (z) => MY + (zTop - z) * s;
  const g = { layers: [], deck: [], lots: [], rooms: [], ways: [], pieces: [], net: [], frame: [], labels: [] };
  const labels = new Labels([MX, MY, MX + mapW, MY + mapH]);
  const shows = { buildings: [], connectors: [], layers: [] };
  const span = (lo, hi, z0, z1, a) => el("rect", { x: H(lo), y: V(z1), width: Math.max(0.5, (hi - lo) * s), height: Math.max(0.5, (z1 - z0) * s), ...a }); // prettier-ignore
  const o = 1 - axis;
  // layers: the floor slab across the layer's bounds, the top dashed
  for (const L of C.layers) {
    const [b0, b1] = axis === 0 ? [L.bounds[1], L.bounds[3]] : [L.bounds[0], L.bounds[2]];
    if (!(L.bounds[axis] <= c && L.bounds[axis + 2] >= c)) continue;
    const [lo, hi] = [Math.max(b0, w0), Math.min(b1, w1)];
    g.layers.push(span(lo, hi, L.floor - 0.25, L.floor, { fill: "#7d7466" }));
    g.layers.push(span(lo, hi, L.floor, L.top, { fill: WEALTH_FILL[L.wealth] ?? "#eee", "fill-opacity": 0.25 }));
    g.layers.push(el("line", { x1: H(lo), y1: V(L.top), x2: H(hi), y2: V(L.top), stroke: "#7d7466", "stroke-width": 1, "stroke-dasharray": "6 4" })); // prettier-ignore
    g.labels.push(text(PAD, V(L.floor) - 4, `${L.id}`, { "font-size": 12, class: "b" }), text(PAD, V(L.floor) + 9, `z ${L.floor}`, { "font-size": 9, class: "d" })); // prettier-ignore
    g.labels.push(text(H(hi) - 4, V(L.top) - 3, `${L.id} top ${L.top} (${L.sky > L.top ? `${L.ceiling}: built to here, the lid at ${L.sky}` : L.ceiling})`, { "font-size": 9, "text-anchor": "end", class: "d h" })); // prettier-ignore
    shows.layers.push(L.id);
  }
  // ways and plazas cut: the floor they make, their clearance dashed
  for (const w of C.site.ways) {
    for (const pts of w.parts)
      for (const [lo, hi] of cutLine(pts, w.width, axis, c)) {
        g.ways.push(span(lo, hi, w.z - 0.12, w.z, { fill: w.class === "service" ? HALL : "#4a4a4a" }));
        if (w.clearance) g.ways.push(span(lo, hi, w.z, w.z + w.clearance, { fill: "none", stroke: "#999", "stroke-width": 0.6, "stroke-dasharray": "2 3" })); // prettier-ignore
        labels.place([{ text: w.id, size: 8, cls: "d" }], [[H((lo + hi) / 2), V(w.z) + 3, 0.5, 0], [H((lo + hi) / 2), V(w.z) - 3, 0.5, 1]], {}); // prettier-ignore
      }
    // its porticoes (stage 1's colonnade): across the cut, the vault over each portico and a column at each line; a
    // leg running along the cut within 8 cells, its column line seen beyond (dashed) or cut (in its portico band)
    const Cw = w.colonnade;
    if (!Cw) continue;
    const kept = (C.net?.colonnades ?? []).find((x) => x.way === w.id)?.columns ?? Cw.columns;
    const vault = w.z + Cw.height;
    for (const pts of w.parts) {
      for (const [lo, hi] of cutLine(pts, w.width, axis, c)) {
        const sc = (hi - lo) / w.width; // the cut's slant
        for (const [b0, b1, line] of [[lo, lo + w.portico * sc, (w.width / 2 - Cw.offset) * sc + lo], [hi - w.portico * sc, hi, hi - (w.width / 2 - Cw.offset) * sc]]) {
          g.ways.push(span(b0, b1, vault - 0.2, vault, { fill: "#6b5a3a" }));
          g.ways.push(span(line - Cw.column / 2, line + Cw.column / 2, w.z, vault - 0.2, { fill: "#8b7a55" }));
        }
        labels.place([{ text: `${w.id}'s porticoes ${f(w.portico)} deep, vault at ${f(Cw.height)}`, size: 8, cls: "d" }], [[H(lo), V(vault) - 3, 0, 1], [H(hi), V(vault) - 3, 1, 1]], {}); // prettier-ignore
      }
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]];
        if (Math.abs(a[axis] - b[axis]) > 1e-6) continue; // not along the cut
        const off = a[axis] - c;
        if (Math.abs(off) > w.width / 2 + 8) continue;
        const [lo, hi] = [Math.min(a[o], b[o]), Math.max(a[o], b[o])].map((v) => Math.max(w0, Math.min(w1, v)));
        if (hi - lo < 1e-6) continue;
        // the nearer column line; cut when the cut runs through its portico band
        const sideOff = Math.abs(off + Cw.offset) <= Math.abs(off - Cw.offset) ? Cw.offset : -Cw.offset;
        const inBand = Math.abs(off) <= w.width / 2 && Math.abs(off) >= w.width / 2 - w.portico;
        const st = inBand ? { fill: "#8b7a55" } : { fill: "none", stroke: "#6b5a3a", "stroke-width": 0.8, "stroke-dasharray": "3 2" };
        g.ways.push(span(lo, hi, vault - 0.2, vault, inBand ? { fill: "#6b5a3a" } : st));
        for (const k of kept) {
          if (Math.abs(k.at[axis] - (a[axis] + sideOff)) > 0.01 || k.at[o] < lo - 1e-6 || k.at[o] > hi + 1e-6) continue;
          g.ways.push(span(k.at[o] - Cw.column / 2, k.at[o] + Cw.column / 2, w.z, vault - 0.2, st));
        }
        labels.place([{ text: `${w.id}'s colonnade ${inBand ? "cut" : "beyond"}, vault at ${f(Cw.height)}`, size: 8, cls: "d" }], [[H((lo + hi) / 2), V(vault) - 3, 0.5, 1]], {}); // prettier-ignore
      }
    }
  }
  for (const p of C.site.plazas) {
    const r = cutPoly(polyOfBox(p.box), axis, c);
    if (r) {
      g.ways.push(span(r[0], r[1], p.z - 0.12, p.z, { fill: "#a08a5a" }));
      labels.place([{ text: `${p.id} (plaza)`, size: 8.5, cls: "d" }], [[H((r[0] + r[1]) / 2), V(p.z) + 3, 0.5, 0]], { force: true });
    }
    if (r && p.portico) {
      // its portico where the cut crosses it: the vault over the band, a column at the line
      const d = p.portico.depth;
      const inBand = c < p.box[axis] + d || c > p.box[axis + 2] - d;
      const bands = inBand ? [[r[0], r[1]]] : [[r[0], r[0] + d], [r[1] - d, r[1]]];
      for (const [lo, hi] of bands) {
        g.ways.push(span(lo, hi, p.z + p.portico.height - 0.2, p.z + p.portico.height, { fill: "#6b5a3a" }));
        if (!inBand) g.ways.push(span(lo === r[0] ? hi - p.portico.column : lo, lo === r[0] ? hi : lo + p.portico.column, p.z, p.z + p.portico.height - 0.2, { fill: "#8b7a55" })); // prettier-ignore
      }
      labels.place([{ text: `portico ${f(d)} deep, vault at ${f(p.portico.height)}`, size: 8, cls: "d" }], [[H(bands[0][0]), V(p.z + p.portico.height) - 3, 0, 1]], {}); // prettier-ignore
    }
    for (const mo of p.monuments ?? []) {
      // a monument: its plinth and shaft cut, or drawn beyond when it stands within 8 cells of the cut
      const off = Math.abs(mo.at[axis] - c);
      const beyond = off > mo.base[axis] / 2;
      if (beyond && off > 8) continue;
      const u = mo.at[o];
      const st = beyond ? { fill: "none", stroke: "#3b1626", "stroke-width": 1, "stroke-dasharray": "4 3" } : { fill: "#7a2f4f", stroke: "#3b1626" };
      g.lots.push(span(u - mo.base[o] / 2, u + mo.base[o] / 2, mo.z[0], mo.z[0] + 0.5, { ...st, fill: beyond ? "none" : "#cdbb93" }));
      g.lots.push(span(u - mo.across / 2, u + mo.across / 2, mo.z[0] + 0.5, mo.z[1], st));
      labels.place([{ text: `${mo.id}${beyond ? ` (beyond, ${f(off)} cells)` : ""}`, size: 9, cls: "b" }, { text: `${mo.kind}, z ${f(mo.z[0])} to ${f(mo.z[1])}`, size: 8, cls: "d" }], around(H(u), V(mo.z[1]) - 6, 12, [1, 2, 3]), { force: true, leader: [H(u), V(mo.z[1])] }); // prettier-ignore
    }
  }
  for (const l of C.lots.lots) {
    if (!l.tower) continue;
    // a tower: its shaft cut (a round one's chord), or beyond within 8 cells; its storeys' cornices
    const t = l.tower;
    const rad = t.across / 2;
    const off = Math.abs(t.at[axis] - c);
    const beyond = off > rad - 1e-6;
    if (beyond && off > rad + 8) continue;
    const half = beyond ? rad : t.silhouette === "round" ? Math.sqrt(rad * rad - off * off) : rad;
    const u = t.at[o];
    g.lots.push(span(u - half, u + half, t.z[0], t.z[1], beyond ? { fill: "none", stroke: "#4a1f6b", "stroke-width": 1.4, "stroke-dasharray": "6 3" } : { fill: "#d9cfe6", stroke: "#4a1f6b", "stroke-width": 2 })); // prettier-ignore
    const sh = (t.z[1] - t.z[0]) / t.storeys;
    for (let k = 1; k <= t.storeys; k++) g.lots.push(span(u - half - 0.15, u + half + 0.15, t.z[0] + k * sh - 0.12, t.z[0] + k * sh, { fill: "#4a1f6b" })); // prettier-ignore
    labels.place([{ text: `${l.building}'s tower${beyond ? ` (beyond, ${f(off)} cells)` : ""}`, size: 10, cls: "b" }, { text: `${t.silhouette}, ${t.storeys} storeys not enterable, z ${f(t.z[0])} to ${f(t.z[1])}`, size: 8, cls: "d" }], around(H(u), V(t.z[1]) - 6, 14, [1, 2, 3, 4]), { force: true, leader: [H(u), V(t.z[1])] }); // prettier-ignore
  }
  // lots cut: facades to their height, enterable buildings with their storeys and the rooms the cut meets
  for (const l of C.lots.lots) {
    const r = cutPoly(polyOfBox(boxOfRect(l.rect)), axis, c);
    if (!r || r[1] - r[0] < 1e-3) continue;
    if (l.kind === "facade") {
      g.lots.push(span(r[0], r[1], l.zBase, l.zBase + (l.facade?.height ?? 1), { fill: "url(#fhatch)", stroke: "#6d6150", "stroke-width": 0.7 })); // prettier-ignore
      continue;
    }
    const b = C.planOf.get(l.building);
    const sh = (l.storeyHeight_m ?? 4.877) / cell;
    const top = l.zBase + l.storeys * sh;
    g.lots.push(span(r[0], r[1], l.zBase, top, { fill: BUILDING_FILL[l.owner === "msr" ? "msr" : l.owner === "residents" ? "home" : "business"], stroke: "#111", "stroke-width": 2 })); // prettier-ignore
    for (let k = 1; k <= l.storeys; k++) g.lots.push(span(r[0], r[1], l.zBase + k * sh - 0.06, l.zBase + k * sh, { fill: "#333" }));
    if (b) {
      for (const rm of b.rooms) {
        const z0 = l.zBase + rm.storey * sh;
        for (const q of rm.cells) {
          const rr = cutPoly(polyOfBox(boxOfRect(q)), axis, c);
          if (!rr || rr[1] - rr[0] < 0.05) continue;
          const zone = C.zones[rm.kind] ?? (rm.kind === "corridor" || rm.kind === "stairwell" ? "circulation" : null);
          g.rooms.push(span(rr[0], rr[1], z0 + 0.06, z0 + (rm.height_m ?? b.frame.clearHeight_m) / cell, { fill: ZONE_FILL[zone] ?? "#f0f0f0", stroke: "#666", "stroke-width": 0.6 })); // prettier-ignore
          if ((rr[1] - rr[0]) * s > textW(rm.kind, 7) + 4) g.rooms.push(text(H((rr[0] + rr[1]) / 2), V(z0 + 0.5), rm.kind, { "font-size": 7, "text-anchor": "middle", fill: "#333" })); // prettier-ignore
        }
      }
    }
    labels.place([{ text: l.building, size: 10.5, cls: "b" }, { text: `${l.storeys} storeys, z ${f(l.zBase)} to ${f(top)}`, size: 8, cls: "d" }], [[H((r[0] + r[1]) / 2), V(top) - 3, 0.5, 1], [H(r[1]) + 3, V(top), 0, 0]], { force: true }); // prettier-ignore
    shows.buildings.push(l.building);
  }
  // 09: the deck's band and the sky, the frame cut and beyond
  if (C.a.a9 || C.layers.some((L) => L.sky)) frameSection(C, axis, c, { H, V, span, s, g, labels, w0, w1 });
  // connectors cut: every piece the line meets at its z range; the spine bold
  for (const cn of C.net?.connectors ?? []) {
    const ink = CONNECTOR_INK[cn.type] ?? "#333";
    const spine = cn.id === cut.spine.id || (cut.spine.stops.join() === cn.stops.join() && cn.pieces?.some((p) => p.kind === "well" || p.kind === "shaft")); // prettier-ignore
    let hit = false;
    for (const p of cn.pieces ?? []) {
      const r = cutPoly(p.poly, axis, c);
      if (!r) continue;
      hit = true;
      const [z0, z1] = p.z;
      if (p.kind === "well" || p.kind === "shaft") g.pieces.push(span(r[0], r[1], z0, z1, { fill: p.kind === "shaft" ? "#efe6f5" : "#e6eef8", "fill-opacity": 0.6, stroke: ink, "stroke-width": spine ? 2.4 : 1.4 })); // prettier-ignore
      else if (p.kind === "car") g.pieces.push(span(r[0], r[1], z0, z1, { fill: ink, "fill-opacity": 0.5, stroke: ink }));
      else if (p.kind === "flight") g.pieces.push(span(r[0], r[1], z0, z1, { fill: "url(#shatch)", stroke: ink, "stroke-width": 0.8 }));
      else if (p.kind === "landing") g.pieces.push(span(r[0], r[1], z0, Math.min(z1, z0 + 0.15), { fill: ink }));
      else g.pieces.push(span(r[0], r[1], z0, z1, { fill: "url(#shatch)", stroke: ink, "stroke-dasharray": "3 2" }));
    }
    if (!hit) {
      // a column just beside the cut (the spine's lift beside its stair): drawn beyond, dashed
      const col = (cn.pieces ?? []).find((p) => p.kind === "well" || p.kind === "shaft");
      if (!col) continue;
      const bx = boxOfPoly(col.poly);
      const off = axis === 0 ? Math.max(bx[0] - c, c - bx[2], 0) : Math.max(bx[1] - c, c - bx[3], 0);
      if (off > 3) continue;
      const [lo, hi] = axis === 0 ? [bx[1], bx[3]] : [bx[0], bx[2]];
      g.pieces.push(span(lo, hi, col.z[0], col.z[1], { fill: "none", stroke: ink, "stroke-width": 1.2, "stroke-dasharray": "5 3" }));
      for (const p of cn.pieces.filter((q) => q.kind === "car")) g.pieces.push(span(lo, hi, p.z[0], p.z[1], { fill: ink, "fill-opacity": 0.25, stroke: ink, "stroke-dasharray": "3 2" })); // prettier-ignore
      labels.place([{ text: `${cn.id} (beyond, ${f(off)} cells)`, size: 9, cls: "b" }, { text: `${cn.type}: ${cn.stops.join(" > ")}`, size: 8, cls: "d" }], around(H((lo + hi) / 2), V(col.z[1]) - 6, 14, [1, 2, 3, 4, 5]), { force: true, leader: [H((lo + hi) / 2), V(col.z[1])] }); // prettier-ignore
      shows.connectors.push(cn.id);
      continue;
    }
    for (const e of cn.exits ?? []) {
      const u = e.at[o];
      if (Math.abs(e.at[axis] - c) > 3) continue;
      g.net.push(el("path", { d: `M${f(H(u))},${f(V(e.z) - 2)}l-5,-9h10z`, fill: EXIT }));
    }
    const col = cn.pieces.find((p) => cutPoly(p.poly, axis, c));
    const rr = cutPoly(col.poly, axis, c);
    labels.place([{ text: cn.id, size: spine ? 11 : 9, cls: "b" }, { text: `${cn.type}: ${cn.stops.join(" > ")}`, size: 8, cls: "d" }], around(H((rr[0] + rr[1]) / 2), V(Math.max(...cn.pieces.map((p) => p.z[1]))) - 6, 14, [1, 2, 3, 4]), { force: true, leader: [H((rr[0] + rr[1]) / 2), V(Math.max(...cn.pieces.map((p) => p.z[1])))] }); // prettier-ignore
    shows.connectors.push(cn.id);
  }
  // checkpoints, posts, hallways cut
  for (const cp of C.net?.checkpoints ?? [])
    for (const r of cp.rooms) {
      const rr = cutPoly(r.poly ?? polyOfBox(boxOfRect(r.rect)), axis, c);
      if (rr) g.net.push(span(rr[0], rr[1], r.z[0], r.z[1], { fill: "#f2c4bd", stroke: "#8e1f15" }));
    }
  for (const p of C.net?.posts ?? []) {
    const rr = cutPoly(polyOfBox(boxOfRect(p.rect)), axis, c);
    if (rr) g.net.push(span(rr[0], rr[1], p.z[0], p.z[1], { fill: "url(#rhatch)", stroke: "#8e1f15" }));
  }
  for (const h of C.net?.hallways ?? [])
    for (const lg of h.legs ?? [])
      for (const [lo, hi] of cutLine([lg.from, lg.to], h.width, axis, c)) {
        g.net.push(span(lo, hi, lg.z[0], lg.z[1], { fill: HALL, "fill-opacity": 0.45, stroke: "#8e1f15", "stroke-width": 0.8 }));
        labels.place([{ text: h.id, size: 7.5, cls: "m" }], [[H((lo + hi) / 2), V(lg.z[1]) - 2, 0.5, 1]], {});
      }
  // axes: z in cells and metres; along in cells
  const ax = [];
  for (let z = Math.ceil(zBot); z <= zTop; z++) {
    ax.push(el("line", { x1: MX - 4, y1: V(z), x2: MX, y2: V(z), stroke: "#555" }));
    if (z % 2 === 0) ax.push(text(MX - 6, V(z) + 3, `${z}`, { "font-size": 8.5, "text-anchor": "end", class: "d" }));
  }
  for (let u = Math.ceil(w0 / 5) * 5; u <= w1; u += 5) ax.push(el("line", { x1: H(u), y1: MY + mapH, x2: H(u), y2: MY + mapH + 4, stroke: "#555" }), text(H(u), MY + mapH + 14, `${u}`, { "font-size": 8.5, "text-anchor": "middle", class: "d" })); // prettier-ignore
  const tb = axis === 0 ? [C.tile.box[1], C.tile.box[3]] : [C.tile.box[0], C.tile.box[2]];
  for (const u of tb) ax.push(el("line", { x1: H(u), y1: MY, x2: H(u), y2: MY + mapH, stroke: "#1a5c8a", "stroke-width": 1.4, "stroke-dasharray": "9 5" })); // prettier-ignore
  const name = axis === 0 ? "N-S" : "E-W";
  const ends = axis === 0 ? ["S", "N"] : ["W", "E"];
  ax.push(text(MX, MY + mapH + 28, `${ends[0]}  (${axis === 0 ? "y" : "x"}, cells)`, { "font-size": 10, class: "b" }), text(MX + mapW, MY + mapH + 28, `(${axis === 0 ? "y" : "x"}, cells)  ${ends[1]}`, { "font-size": 10, "text-anchor": "end", class: "b" })); // prettier-ignore
  const width = MX + mapW + PAD;
  const height = MY + mapH + 44;
  const titleText = `${C.desc?.title ?? "city"}: tile ${C.tile.id}${C.tile.name ? ` (${C.tile.name})` : ""}, section ${name} through ${cut.spine.id} at ${axis === 0 ? "x" : "y"} = ${f(c)}`; // prettier-ignore
  const hashes = Object.values(C.arts).map((a) => `${a.file.slice(0, 2)} ${a.hash.slice(0, 8)}`).join("  ");
  const head = [
    text(PAD, 24, titleText, { "font-size": 18, class: "b" }),
    text(PAD, 42, `to scale, ${s} px a cell both ways (1 cell = ${f(cell)} m), z in cells on the left; the layers' floors as slabs, their tops dashed; buildings with their storeys and the rooms the cut meets;`, { "font-size": 10.5, class: "d" }), // prettier-ignore
    text(PAD, 56, `connector pieces at their z ranges (flights hatched, landings solid, a lift's car filled; dashed: a column beside the cut), exits as green triangles; the MSR's rooms, posts and hallways red`, { "font-size": 10.5, class: "d" }), // prettier-ignore
    text(PAD, 71, `artifacts sha256: ${hashes}`, { "font-size": 10, class: "d" }),
    C.a.a9 ? text(PAD, 84, `09: the deck's frame cut solid, within ${BEYOND} cells beyond in outline; the deck's band hatched; the sky lid dashed blue`, { "font-size": 10.5, class: "d" }) : "", // prettier-ignore
  ].join("");
  const body = [head, ...Object.values(g).map((x) => x.join("")), ax.join(""), el("g", { id: "labels" }, labels.svg.join(""))].join("\n");
  const meta = { review: "R1", tile: C.tile.id, picture: `section-${name}`, at: c, spine: cut.spine.id, artifacts: Object.fromEntries(Object.values(C.arts).map((a) => [a.file, a.hash])) }; // prettier-ignore
  return { svg: svgDoc(width, height, titleText, meta, body), shows, omitted: labels.omitted };
}

// ── the frame of stage 9 (09-forms.json) on the plans and the sections ──

const FRAME_INK = { pier: "#3f4650", "pier-foot": "#7a5a3a", rib: "#3f4650", truss: "#56606c", coffers: "#7d8794", services: "#0f766e", "deck-edge": "#1f2937", parapet: "#7c2d12", oculus: "#1d4ed8", core: "#7a3fa0" }; // prettier-ignore
const FUSION_INK = { full: "#9a3412", partial: "#b7791f", gap: "#2f855a" };
/** How far beyond a section's cut its frame is drawn in outline, cells. */
const BEYOND = 4;
const FRAME_WORDS = { pier: "deck pier (F1)", "pier-foot": "pier foot (F2)", rib: "girder (F3)", coffers: "coffers (F4)", truss: "truss (F5)", services: "hung services (F6)", fusion: "fusion band (F7)", "deck-edge": "deck edge (F8)", parapet: "deck-edge parapet (F8)", oculus: "oculus (F9)", core: "spine drum (F26)" }; // prettier-ignore

/** One part of a form on a plan (top-down): what stands solid, what hangs overhead translucent. */
function partOnPlan(fm, pt, poly, P) {
  if (fm.family === "edges") return edgePartOnPlan(fm, pt, poly);
  if (fm.family === "facade") return facadePartOnPlan(fm, pt, poly);
  const ink = fm.kind === "fusion" ? FUSION_INK[fm.mode] ?? "#b7791f" : FRAME_INK[fm.kind] ?? "#555";
  if (pt.build === "cut") return poly(pt.poly, { fill: "#bfe3ff", "fill-opacity": 0.85, stroke: FRAME_INK.oculus, "stroke-width": 1.6 });
  if (pt.build === "entity") return poly(pt.poly, { fill: "url(#ghatch)", stroke: FRAME_INK.oculus, "stroke-width": 1 });
  switch (fm.kind) {
    case "pier":
    case "pier-foot":
      if (pt.shape === "frustum") return poly(pt.top ?? pt.poly, { fill: "none", stroke: ink, "stroke-width": 0.8, "stroke-dasharray": "2 2" });
      return poly(pt.poly, { fill: ink, stroke: "#111", "stroke-width": 0.6 });
    case "rib":
      return poly(pt.poly, { fill: ink, "fill-opacity": pt.shape === "wedge" ? 0.18 : 0.32, stroke: ink, "stroke-width": 0.7 });
    case "truss":
      if (pt.shape === "diagonal") {
        const b = boxOfPoly(pt.poly);
        const across = b[2] - b[0] >= b[3] - b[1];
        const [p0, p1] = across ? [[b[0], (b[1] + b[3]) / 2], [b[2], (b[1] + b[3]) / 2]] : [[(b[0] + b[2]) / 2, b[1]], [(b[0] + b[2]) / 2, b[3]]];
        return el("path", { d: `M${P(p0)}L${P(p1)}`, stroke: ink, "stroke-width": 2.2, "stroke-opacity": 0.5 });
      }
      return poly(pt.poly, { fill: ink, "fill-opacity": 0.35, stroke: ink, "stroke-width": 0.6 });
    case "coffers":
      return poly(pt.poly, { fill: ink, "fill-opacity": 0.28, stroke: ink, "stroke-width": 0.4, "stroke-opacity": 0.6 });
    case "services":
      return poly(pt.poly, { fill: ink, "fill-opacity": 0.45, stroke: ink, "stroke-width": 0.5 });
    case "fusion":
      return poly(pt.poly, { fill: ink, "fill-opacity": /cage/.test(pt.what ?? "") ? 0.85 : 0.6, stroke: ink, "stroke-width": 0.5 });
    case "deck-edge":
      if (pt.shape === "frustum") return poly(pt.top ?? pt.poly, { fill: "none", stroke: ink, "stroke-width": 0.8, "stroke-dasharray": "2 2" });
      return poly(pt.poly, { fill: ink, "fill-opacity": pt.shape === "wedge" ? 0.45 : 0.85, stroke: "#111", "stroke-width": 0.5 });
    default:
      return poly(pt.poly, { fill: ink, "fill-opacity": 0.75, stroke: "#111", "stroke-width": 0.5 });
  }
}

/** The frame of 09 on a layer's plan; returns what it drew, for the legend. */
function framePlan(C, L, { X, Y, P, poly, labels, G }) {
  const shows = { byKind: {}, brushes: 0, modes: {} };
  const here = C.forms.filter((fm) => fm.layer === L.id);
  const deckHere = C.deck && C.deck.layer === L.id;
  const overDeck = C.deck && C.deck.over === L.id;
  if (deckHere || overDeck) G.frame.push(poly(polyOfBox(C.deck.box), { fill: "none", stroke: "#1f2937", "stroke-width": 2, "stroke-dasharray": "16 4 3 4" })); // prettier-ignore
  const order = { coffers: 0, services: 1, truss: 2, rib: 3, fusion: 4, "deck-edge": 5, oculus: 6, parapet: 7, core: 8, "pier-foot": 9, pier: 10 };
  for (const fm of [...here].sort((a, b) => (order[a.kind] ?? 5) - (order[b.kind] ?? 5) || (a.id < b.id ? -1 : 1))) {
    shows.byKind[fm.kind] = (shows.byKind[fm.kind] ?? 0) + 1;
    shows.brushes += fm.brushes + (fm.rock ?? 0);
    if (fm.kind === "fusion") shows.modes[fm.mode] = (shows.modes[fm.mode] ?? 0) + 1;
    for (const pt of fm.parts) G.frame.push(partOnPlan(fm, pt, poly, P));
  }
  // the deck's oculi seen from under the deck, and the trusses' and oculi's words
  if (deckHere)
    for (const fm of C.forms.filter((x) => x.kind === "oculus")) {
      G.frame.push(poly(polyOfBox(fm.hole), { fill: "#bfe3ff", "fill-opacity": 0.45, stroke: FRAME_INK.oculus, "stroke-width": 1.6, "stroke-dasharray": "6 3" })); // prettier-ignore
      shows.byKind["oculus (over)"] = (shows.byKind["oculus (over)"] ?? 0) + 1;
    }
  for (const fm of C.forms.filter((x) => x.kind === "oculus" && (deckHere || x.layer === L.id))) {
    const c = polyC(polyOfBox(fm.hole));
    labels.place([{ text: `oculus ${f(fm.hole[2] - fm.hole[0])} x ${f(fm.hole[3] - fm.hole[1])}`, size: 9, cls: "b" }, { text: `${fm.guard} on ${(fm.opensOn ?? []).join(", ")}${deckHere ? " (over)" : ""}`, size: 8, cls: "d" }], around(X(c[0]), Y(c[1]), 30, [1, 1.6, 2.4]), { force: true, leader: [X(c[0]), Y(c[1])] }); // prettier-ignore
  }
  for (const fm of here.filter((x) => x.kind === "truss")) labels.place([{ text: `truss ${f(fm.span)} c, ${f(fm.depth)} deep, ${fm.panels} panels`, size: 8, cls: "d" }], around(X(fm.at[0]), Y(fm.at[1]), 8, [1, 1.6]), { leader: [X(fm.at[0]), Y(fm.at[1])] }); // prettier-ignore
  for (const fm of here.filter((x) => x.kind === "core")) labels.place([{ text: `spine drum, ${fm.parts.length} brushes on ${fm.layer}`, size: 8.5, cls: "b" }], around(X(fm.at[0]), Y(fm.at[1]), fm.radius * C.scale + 6, [1, 1.6]), { force: true, leader: [X(fm.at[0]), Y(fm.at[1])] }); // prettier-ignore
  edgePlan(C, L, { X, Y, P, poly, labels, G, here });
  facadePlan(C, L, { X, Y, labels, here });
  return shows;
}

/** The frame's rows in a plan's legend. */
function frameLegend(C, L, col, shows) {
  if (!shows) return;
  const a9 = C.a.a9.artifact;
  col.heading(`The frame (09): ${shows.brushes} brushes on ${L.id}`);
  const kinds = Object.keys(shows.byKind);
  if (!kinds.length) col.line("nothing of the frame on this layer", { cls: "d" });
  const sw = (kind, extra = {}) => (x, y, w, h) => el("rect", { x: x + 4, y: y + 2, width: 22, height: h - 4, fill: FRAME_INK[kind] ?? EDGE_INK[kind] ?? "#555", "fill-opacity": extra.op ?? 0.8, stroke: "#111", "stroke-width": 0.5 }); // prettier-ignore
  for (const k of kinds) {
    const n = shows.byKind[k];
    if (k === "fusion") {
      for (const [mode, m] of Object.entries(shows.modes)) col.row((x, y, w, h) => el("rect", { x: x + 4, y: y + 4, width: 22, height: h - 8, fill: FUSION_INK[mode], "fill-opacity": 0.7 }), `fusion band (F7), ${mode}: ${m} facade faces (${mode === "full" ? "corbel course and cages: fused into the deck" : mode === "partial" ? "cornice at its roof, corbel course under the deck" : "cornice and a carved gap"})`); // prettier-ignore
      continue;
    }
    if (k === "oculus (over)") {
      col.row((x, y, w, h) => el("rect", { x: x + 4, y: y + 2, width: 22, height: h - 4, fill: "#bfe3ff", stroke: FRAME_INK.oculus, "stroke-dasharray": "5 3" }), `oculus overhead: ${n} (light from the sky through the deck)`); // prettier-ignore
      continue;
    }
    const op = { rib: 0.32, truss: 0.35, coffers: 0.28, services: 0.45 }[k] ?? 0.8;
    col.row(sw(k, { op }), `${FRAME_WORDS[k] ?? EDGE_WORDS[k] ?? k}: ${n}${["rib", "truss", "coffers", "services"].includes(k) ? " (overhead, translucent)" : ""}`); // prettier-ignore
  }
  if (C.deck && (C.deck.layer === L.id || C.deck.over === L.id)) col.row((x, y, w, h) => el("path", { d: `M${x},${y + h / 2}h30`, stroke: "#1f2937", "stroke-width": 2, "stroke-dasharray": "8 3 2 3" }), `the deck's edge (${C.deck.over}'s bounds), soffit z ${f(C.deck.soffit)}, top z ${f(C.deck.top)}`); // prettier-ignore
  const B = a9.measures?.budget;
  if (B?.brushes?.total != null) col.line(`tile: ${B.brushes.total} brushes with the forms' ${B.brushes.forms} (stage 8 ${B.brushes.before}), limit ${B.brushes.limit}; entities ${B.entities.total} of ${B.entities.limit}`, { cls: "d", size: 9.5 }); // prettier-ignore
}

/** The sky lid, the deck's band and the frame in a section. */
function frameSection(C, axis, c, { H, V, span, g, labels, w0, w1 }) {
  const o = 1 - axis;
  // the sky lid of every layer open to it, over where it is open
  for (const L of C.layers) {
    if (!(L.sky > L.top) || !(L.bounds[axis] <= c && L.bounds[axis + 2] >= c)) continue;
    let pieces = [[Math.max(L.bounds[o], w0), Math.min(L.bounds[o + 2], w1)]];
    if (L.ceiling === "deck") {
      const up = C.layers.find((x) => x.level === L.level + 1);
      if (up && up.bounds[axis] <= c && up.bounds[axis + 2] >= c) pieces = pieces.flatMap(([lo, hi]) => [[lo, Math.min(hi, up.bounds[o])], [Math.max(lo, up.bounds[o + 2]), hi]]); // prettier-ignore
    }
    for (const [lo, hi] of pieces.filter(([lo, hi]) => hi - lo > 0.01)) {
      g.deck.push(el("line", { x1: H(lo), y1: V(L.sky), x2: H(hi), y2: V(L.sky), stroke: "#2b6cb0", "stroke-width": 1.6, "stroke-dasharray": "10 5" })); // prettier-ignore
      g.labels.push(text(H(hi) - 4, V(L.sky) - 4, `${L.id}'s sky lid z ${f(L.sky)} (${f(L.sky * C.cell)} m)`, { "font-size": 9, "text-anchor": "end", class: "d h", fill: "#2b6cb0" })); // prettier-ignore
    }
  }
  if (!C.a.a9) return;
  const D = C.deck;
  if (D && D.box[axis] <= c && D.box[axis + 2] >= c) {
    const [lo, hi] = [Math.max(D.box[o], w0), Math.min(D.box[o + 2], w1)];
    if (hi > lo) g.deck.push(span(lo, hi, D.soffit, D.top, { fill: "url(#fhatch)", stroke: "#3f4650", "stroke-width": 1 }));
  }
  // the fusion band of the facades the cut meets
  for (const fm of C.forms.filter((x) => x.kind === "fusion" && x.fused)) {
    const lot = C.lots.lots.find((l) => l.id === fm.lot);
    const r = lot && cutPoly(polyOfBox(boxOfRect(lot.rect)), axis, c);
    if (r) g.deck.push(span(r[0], r[1], fm.band[0], fm.band[1], { fill: FUSION_INK[fm.mode], "fill-opacity": 0.28, stroke: FUSION_INK[fm.mode], "stroke-width": 0.6, "stroke-dasharray": "3 2" })); // prettier-ignore
  }
  const beyondKinds = new Set(["pier", "pier-foot", "rib", "truss", "deck-edge", "core", "parapet", ...EDGE_BEYOND]);
  for (const k of FACADE_BEYOND) beyondKinds.add(k);
  const said = new Set();
  for (const fm of C.forms) {
    const ink = fm.kind === "fusion" ? FUSION_INK[fm.mode] ?? "#b7791f" : FRAME_INK[fm.kind] ?? "#555";
    for (const pt of fm.parts) {
      const r = cutPoly(pt.poly, axis, c);
      if (r) {
        if (pt.build === "cut") g.frame.push(span(r[0], r[1], pt.z[0], pt.z[1], { fill: "#bfe3ff", stroke: FRAME_INK.oculus, "stroke-width": 1.2 }));
        else g.frame.push(span(r[0], r[1], pt.z[0], pt.z[1], { fill: ink, "fill-opacity": ["coffers", "services"].includes(fm.kind) ? 0.6 : 0.9, stroke: "#111", "stroke-width": 0.5 })); // prettier-ignore
        if (fm.family === "edges" && EDGE_SAY[fm.kind] && !said.has(`${fm.kind}:${fm.on}`)) {
          said.add(`${fm.kind}:${fm.on}`);
          labels.place([{ text: EDGE_SAY[fm.kind](fm), size: 8.5, cls: "b" }], around(H((r[0] + r[1]) / 2), V(pt.z[0]) + 8, 12, [1, 1.8]), { leader: [H((r[0] + r[1]) / 2), V(pt.z[0])] }); // prettier-ignore
        }
        if (fm.family === "facade" && FACADE_SAY[fm.kind] && !said.has(`${fm.kind}:${fm.on}`)) {
          said.add(`${fm.kind}:${fm.on}`);
          labels.place([{ text: FACADE_SAY[fm.kind](fm), size: 8.5, cls: "b" }], around(H((r[0] + r[1]) / 2), V(pt.z[1]) - 8, 12, [1, 1.8]), { leader: [H((r[0] + r[1]) / 2), V(pt.z[1])] }); // prettier-ignore
        }
        if (!said.has(fm.id) && ["rib", "truss", "oculus", "core"].includes(fm.kind)) {
          said.add(fm.id);
          const words = fm.kind === "rib" ? `girder over ${fm.on}: span ${f(fm.span)}, ${f(fm.depth)} deep` : fm.kind === "truss" ? `truss over ${fm.on}: ${f(fm.span)} c, ${f(fm.depth)} deep` : fm.kind === "oculus" ? `oculus over ${fm.on} (${fm.guard})` : `spine drum (${fm.layer})`; // prettier-ignore
          labels.place([{ text: words, size: 8.5, cls: "b" }], around(H((r[0] + r[1]) / 2), V(pt.z[0]) + 8, 12, [1, 1.8]), { leader: [H((r[0] + r[1]) / 2), V(pt.z[0])] }); // prettier-ignore
        }
        continue;
      }
      if (!beyondKinds.has(fm.kind)) continue;
      const b = boxOfPoly(pt.poly);
      const off = Math.max(b[axis] - c, c - b[axis + 2], 0);
      if (off > BEYOND) continue;
      g.frame.push(span(b[o], b[o + 2], pt.z[0], pt.z[1], { fill: ink, "fill-opacity": 0.12, stroke: ink, "stroke-width": 0.8, "stroke-dasharray": "4 2" })); // prettier-ignore
    }
  }
}

// ── the edges family's forms (forms-edges.mjs): vaults, halls, arcades, the wall, the backdrop, the scale cues ──

const EDGE_INK = { vault: "#8a7356", "vault-rib": "#6b5537", "canal-arch": "#6b5537", "cistern-column": "#374151", architrave: "#9ca3af", arch: "#a16207", gantry: "#0f766e", dais: "#c2a878", "wall-tower": "#7c2d12", "wall-face": "#9a3412", card: "#6b21a8", backdrop: "#6b21a8", "gate-road": "#6b21a8", fan: "#0e7490", "light-shaft": "#ca8a04", searchlight: "#ca8a04", shaft: "#111827", sounds: "#be185d" }; // prettier-ignore
const EDGE_WORDS = { vault: "vault chamfers (F11)", "vault-rib": "vault rib (F11)", "canal-arch": "canal arch (F11)", "cistern-column": "hall column (F12)", architrave: "architrave (F12)", arch: "arcade arch (F10)", gantry: "gantry, out of reach (F19)", dais: "dais, one step up (F25)", "wall-tower": "wall tower (F20)", "wall-face": "wall relief (F20)", card: "skyline card beyond the wall (F21)", backdrop: "backdrop model, train, airship (S2, S6)", "gate-road": "gate road: lamps, fog and end cards (S7)", fan: "giant fan, func_rotating (S5)", "light-shaft": "light shaft under an oculus (S5)", searchlight: "searchlight (S5)", shaft: "bottomless shaft under a grate (S4)", sounds: "sound loop and echoes (S6)" }; // prettier-ignore
/** The edges family's kinds a section draws in outline beyond its cut, and the words it labels a cut one with. */
const EDGE_BEYOND = ["vault-rib", "canal-arch", "cistern-column", "arch", "wall-tower"];
const EDGE_SAY = {
  "cistern-column": (fm) => `hall ${fm.on}: columns ${f(fm.pitch)} c apart, ${f(fm.height)} c tall`,
  "vault-rib": (fm) => `vault rib over ${fm.on}`,
  "canal-arch": (fm) => `canal arch over ${fm.on}`,
  arch: (fm) => `arcade of ${fm.on}`,
  "wall-tower": (fm) => `wall tower (${fm.side})`,
  fan: (fm) => `fan ${f(fm.across)} c`,
  gantry: (fm) => `gantry over ${fm.on}`,
  shaft: (fm) => `shaft to z ${f(fm.bottom)}`,
};

/** One part of an edges form on a plan. */
function edgePartOnPlan(fm, pt, poly) {
  const ink = EDGE_INK[fm.kind] ?? "#555";
  if (pt.build === "cut") return poly(pt.poly, { fill: "#111827", "fill-opacity": 0.85, stroke: "#000", "stroke-width": 1.2 });
  if (fm.kind === "shaft") return poly(pt.poly, { fill: "url(#ghatch)", stroke: "#111", "stroke-width": 1 });
  if (pt.shape === "frustum") return poly(pt.top ?? pt.poly, { fill: "none", stroke: ink, "stroke-width": 0.7, "stroke-dasharray": "2 2" });
  switch (fm.kind) {
    case "vault":
    case "vault-rib":
    case "canal-arch":
    case "architrave":
      return poly(pt.poly, { fill: ink, "fill-opacity": fm.kind === "vault" ? 0.22 : 0.4, stroke: ink, "stroke-width": 0.5 });
    case "light-shaft":
    case "searchlight":
      return poly(pt.poly, { fill: "#fde047", "fill-opacity": 0.3, stroke: ink, "stroke-width": 0.8, "stroke-dasharray": "3 2" });
    case "fan":
      return poly(pt.poly, { fill: ink, "fill-opacity": 0.35, stroke: ink, "stroke-width": 0.6 });
    case "card":
    case "backdrop":
    case "gate-road":
      return poly(pt.poly, { fill: ink, "fill-opacity": 0.7, stroke: ink, "stroke-width": 0.8 });
    case "dais":
      return poly(pt.poly, { fill: ink, "fill-opacity": 0.35, stroke: "#7c6a46", "stroke-width": 0.8, "stroke-dasharray": "5 2" });
    case "gantry":
      return poly(pt.poly, { fill: ink, "fill-opacity": 0.3, stroke: ink, "stroke-width": 0.6 });
    default:
      return poly(pt.poly, { fill: ink, "fill-opacity": 0.85, stroke: "#111", "stroke-width": 0.5 });
  }
}

/** The edges family's words and glyphs on a layer's plan: its halls, fans, towers, the pockets and the point entities. */
function edgePlan(C, L, { X, Y, P, poly, labels, G, here }) {
  const E = C.a.a9?.artifact?.world?.edge;
  if (E && E.layer === L.id) {
    for (const pk of [...(E.pockets ?? []), ...(E.roads ?? [])]) G.frame.push(poly(polyOfBox(pk.box), { fill: "#6b21a8", "fill-opacity": 0.08, stroke: "#6b21a8", "stroke-width": 1.4, "stroke-dasharray": "10 4" })); // prettier-ignore
  }
  const said = new Set();
  for (const fm of here) {
    for (const p of fm.points ?? []) {
      const glyph = { ambient_generic: "♪", env_sound: "e", env_sprite: "*", path_corner: "+", cycler_sprite: "M" }[p.classname] ?? "·";
      G.frame.push(el("circle", { cx: X(p.at[0]), cy: Y(p.at[1]), r: 5, fill: "#fff", stroke: EDGE_INK.sounds, "stroke-width": 1 }) + text(X(p.at[0]), Y(p.at[1]) + 3.5, glyph, { "font-size": 9, "text-anchor": "middle", fill: EDGE_INK.sounds })); // prettier-ignore
    }
    const say = EDGE_SAY[fm.kind];
    if (!say || fm.family !== "edges" || said.has(`${fm.kind}:${fm.on}`) || ["vault-rib", "arch", "canal-arch"].includes(fm.kind)) continue;
    said.add(`${fm.kind}:${fm.on}`);
    labels.place([{ text: say(fm), size: 8.5, cls: "b" }], around(X(fm.at[0]), Y(fm.at[1]), 10, [1, 1.6, 2.4]), { leader: [X(fm.at[0]), Y(fm.at[1])] }); // prettier-ignore
  }
  void P;
}

/**
 * In a plan's margin, for the walled layer (09's world.edge): the whole city with its wall, the towers' rhythm, the
 * gates, the pockets of air beyond the wall (the backdrop), the deck and this tile; and an edge profile, the wall
 * cut across from the deck's edge to the pocket's back, with the eye lines that must meet the wall before the sky.
 */
function edgeView(C, L, col) {
  const W = C.a.a9?.artifact?.world;
  const E = W?.edge;
  if (!E || E.layer !== L.id) return;
  col.heading("The city's edge and the backdrop (09)");
  const [ex, ey] = [E.sides.find((s) => s.side === "s")?.len ?? 120, E.sides.find((s) => s.side === "w")?.len ?? 120];
  const d = E.depth;
  const size = 300;
  const k = size / (Math.max(ex, ey) + 2 * d);
  const x0 = col.x + 10;
  const y0 = col.y + 8;
  const PX = (x) => x0 + (x + d) * k;
  const PY = (y) => y0 + (ey + d - y) * k;
  const out = [];
  // the pockets beyond every side (the plan's depth), this tile's solid
  const sideBox = { s: [0, -d, ex, 0], n: [0, ey, ex, ey + d], w: [-d, 0, 0, ey], e: [ex, 0, ex + d, ey] };
  for (const [s, b] of Object.entries(sideBox)) out.push(el("rect", { x: PX(b[0]), y: PY(b[3]), width: (b[2] - b[0]) * k, height: (b[3] - b[1]) * k, fill: "#6b21a8", "fill-opacity": 0.07, stroke: "#6b21a8", "stroke-width": 0.5, "stroke-dasharray": "4 3" }) + text((PX(b[0]) + PX(b[2])) / 2, (PY(b[1]) + PY(b[3])) / 2 + 3, { s: "pocket s: airship", n: "pocket n: airship", w: "pocket w: train", e: "pocket e: train" }[s], { "font-size": 8, "text-anchor": "middle", fill: "#6b21a8" })); // prettier-ignore
  for (const pk of E.pockets ?? []) out.push(el("rect", { x: PX(pk.box[0]), y: PY(pk.box[3]), width: (pk.box[2] - pk.box[0]) * k, height: (pk.box[3] - pk.box[1]) * k, fill: "#6b21a8", "fill-opacity": 0.3, stroke: "#6b21a8", "stroke-width": 1 })); // prettier-ignore
  for (const r of E.roads ?? []) out.push(el("rect", { x: PX(r.box[0]), y: PY(r.box[3]), width: (r.box[2] - r.box[0]) * k, height: (r.box[3] - r.box[1]) * k, fill: "#a16207", "fill-opacity": 0.35, stroke: "#a16207", "stroke-width": 1 })); // prettier-ignore
  // the tiles, this one, the deck
  const T = C.desc?.tiles;
  if (T) for (let r = 0; r <= T.rows; r++) out.push(el("line", { x1: PX(0), y1: PY(r * T.size[1]), x2: PX(ex), y2: PY(r * T.size[1]), stroke: "#bbb", "stroke-width": 0.5 })); // prettier-ignore
  if (T) for (let c = 0; c <= T.cols; c++) out.push(el("line", { x1: PX(c * T.size[0]), y1: PY(0), x2: PX(c * T.size[0]), y2: PY(ey), stroke: "#bbb", "stroke-width": 0.5 })); // prettier-ignore
  const tb = C.tile.box;
  out.push(el("rect", { x: PX(tb[0]), y: PY(tb[3]), width: (tb[2] - tb[0]) * k, height: (tb[3] - tb[1]) * k, fill: "#2563eb", "fill-opacity": 0.12, stroke: "#2563eb", "stroke-width": 1.5 })); // prettier-ignore
  if (C.deck) out.push(el("rect", { x: PX(C.deck.box[0]), y: PY(C.deck.box[3]), width: (C.deck.box[2] - C.deck.box[0]) * k, height: (C.deck.box[3] - C.deck.box[1]) * k, fill: "none", stroke: "#1f2937", "stroke-width": 1, "stroke-dasharray": "8 3 2 3" })); // prettier-ignore
  // the wall, its towers' rhythm and the gates
  out.push(el("rect", { x: PX(0), y: PY(ey), width: ex * k, height: ey * k, fill: "none", stroke: "#7c2d12", "stroke-width": 2.5 }));
  for (const sd of E.sides) {
    const at = (t) => (sd.side === "s" ? [t, 0] : sd.side === "n" ? [t, ey] : sd.side === "w" ? [0, t] : [ex, t]);
    for (const g of sd.gates ?? []) {
      const [a, b] = [at(g.span[0]), at(g.span[1])];
      out.push(el("line", { x1: PX(a[0]), y1: PY(a[1]), x2: PX(b[0]), y2: PY(b[1]), stroke: "#fff", "stroke-width": 3.5 }) + text(PX((a[0] + b[0]) / 2), PY((a[1] + b[1]) / 2) + (sd.side === "s" ? 11 : -5), `${g.id}${g.outside ? ": its way goes on" : ""}`, { "font-size": 8, "text-anchor": "middle", fill: "#a16207" })); // prettier-ignore
    }
    for (const t of sd.towers) {
      const p = at(t);
      out.push(el("circle", { cx: PX(p[0]), cy: PY(p[1]), r: 3.2, fill: "#7c2d12" }));
    }
  }
  out.push(text(x0, y0 + (ey + 2 * d) * k + 12, `this tile (blue); the deck (dashed); towers every ${E.sides.map((s) => f(s.pitch)).filter((v, i, a) => a.indexOf(v) === i).join(", ")} c (M14); pockets ${f(d)} c deep`, { "font-size": 8.5, class: "d" })); // prettier-ignore
  col.svg.push(el("g", { id: "edge-inset" }, out.join("")));
  col.y = y0 + (ey + 2 * d) * k + 18;
  // the edge profile: the wall cut across, z up to the sky lid
  const prof = [];
  const pw = 320;
  const ph = 150;
  const px0 = col.x + 10;
  const py0 = col.y + 8;
  const span = 26 + d;
  const kk = Math.min(pw / span, ph / E.sky);
  const HX = (x) => px0 + (x + d) * kk; // x: cells inside the wall (> 0) or beyond it (< 0)
  const VZ = (z) => py0 + (E.sky - z) * kk;
  const layers = C.layers ?? [];
  prof.push(el("rect", { x: HX(-d), y: VZ(E.sky), width: span * kk, height: E.sky * kk, fill: "#f5f3ef" }));
  for (const Ly of layers) {
    prof.push(el("rect", { x: HX(0), y: VZ(Ly.floor), width: 26 * kk, height: 2, fill: "#555" }) + text(HX(26) - 2, VZ(Ly.floor) - 2, `${Ly.id} z ${f(Ly.floor)}`, { "font-size": 7.5, "text-anchor": "end", fill: "#555" })); // prettier-ignore
  }
  const deckL = layers.find((x) => x.ceiling === "deck");
  const up = deckL && layers.find((x) => x.level === deckL.level + 1);
  const edgeIn = up ? Math.min(up.bounds[0], (C.desc?.extent?.x ?? ex) - up.bounds[2]) : null;
  if (deckL && up && edgeIn !== null) prof.push(el("rect", { x: HX(edgeIn), y: VZ(up.floor), width: (26 - edgeIn) * kk, height: (up.floor - deckL.top) * kk, fill: "url(#fhatch)", stroke: "#3f4650", "stroke-width": 0.8 }) + text(HX(edgeIn) + 2, VZ(up.floor) - 3, "the deck's edge", { "font-size": 7.5, fill: "#3f4650" })); // prettier-ignore
  const low = Math.min(...layers.map((x) => x.floor));
  prof.push(el("rect", { x: HX(-d), y: VZ(E.wallTop), width: d * kk, height: (E.wallTop - low) * kk, fill: "url(#fhatch)", stroke: "#7c2d12", "stroke-width": 1 }) + text(HX(-d) + 3, VZ(E.wallTop) + 10, `the wall, its top z ${f(E.wallTop)}`, { "font-size": 7.5, fill: "#7c2d12" })); // prettier-ignore
  const tw = E.towerTop ?? E.wallTop + 1.5;
  prof.push(el("rect", { x: HX(-2), y: VZ(tw + 1.5), width: 4 * kk, height: (tw + 1.5 - (deckL?.floor ?? low)) * kk, fill: "#7c2d12", "fill-opacity": 0.55, stroke: "#7c2d12" })); // prettier-ignore
  prof.push(el("rect", { x: HX(-d), y: VZ(E.sky), width: d * kk, height: (E.sky - E.wallTop) * kk, fill: "#6b21a8", "fill-opacity": 0.1, stroke: "#6b21a8", "stroke-dasharray": "4 3" }) + text(HX(-d) + 3, VZ(E.sky) + 10, `pocket of air, ${f(d)} c: cards, a model, a train`, { "font-size": 7.5, fill: "#6b21a8" })); // prettier-ignore
  for (const frac of [0.45, 0.75]) prof.push(el("rect", { x: HX(-d * frac) - 1, y: VZ(Math.min(E.sky - 0.25, E.wallTop + 7)), width: 2.5, height: (Math.min(E.sky - 0.25, E.wallTop + 7) - E.wallTop) * kk, fill: "#6b21a8" })); // prettier-ignore
  prof.push(el("line", { x1: HX(-d), y1: VZ(E.sky), x2: HX(26), y2: VZ(E.sky), stroke: "#2b6cb0", "stroke-width": 1.4, "stroke-dasharray": "8 4" }) + text(HX(26) - 2, VZ(E.sky) - 3, `sky lid z ${f(E.sky)}`, { "font-size": 7.5, "text-anchor": "end", fill: "#2b6cb0" })); // prettier-ignore
  // the eye lines (M21): from the open layers' floors at eye height, level, toward the wall
  for (const Ly of layers.filter((x) => x.sky)) {
    const from = Ly === up ? edgeIn : 2;
    const ze = Ly.floor + 0.5;
    prof.push(el("line", { x1: HX(from), y1: VZ(ze), x2: HX(0), y2: VZ(ze), stroke: "#16a34a", "stroke-width": 1, "stroke-dasharray": "3 2" }) + el("circle", { cx: HX(from), cy: VZ(ze), r: 2, fill: "#16a34a" })); // prettier-ignore
  }
  col.svg.push(el("g", { id: "edge-profile" }, prof.join("")));
  col.y = py0 + E.sky * kk + 6;
  col.line(`edge profile across the wall: an eye line (green) from each open layer, level, meets the wall under its top (M21: no sky below eye level); worldspawn MaxRange ${W.worldspawn?.MaxRange ?? "?"} for a longest line of ${E.longestUnits} units (V4), sky "${W.worldspawn?.skyname ?? "?"}"; distant sound loops in the city ${E.loops?.count ?? 0} (${(E.loops?.what ?? []).join(", ")})`, { cls: "d", size: 9 }); // prettier-ignore
  const here = E.tileSides?.length ? `this tile reaches the ${E.tileSides.join(", ")} side: its pockets ${E.pockets.map((p) => p.id).join(", ")}${E.roads?.length ? `, its gate roads ${E.roads.map((r) => r.id).join(", ")}` : ""}` : "this tile reaches no side of the city: its wall, pockets and roads are drawn from the city plan only";
  col.line(here, { cls: "d", size: 9 });
}

// ── a building's sheet: plan-svg's storeys, with this stop's marks on them ──

function buildingSheet(C, b) {
  const scale = 14;
  let svg = buildingSvg(b, { scale, zones: C.zones });
  const [, D] = b.frame.size_m;
  const [pad, gap, head] = [30, 40, 46];
  const pw = b.frame.size_m[0] * scale;
  const marks = [];
  const nums = [];
  for (const lk of C.looks.filter((x) => x.building === b.id && x.at)) {
    const st = lk.storey ?? 0;
    const local = [(lk.at[0] - b.frame.origin_cells[0]) * C.cell, (lk.at[1] - b.frame.origin_cells[1]) * C.cell];
    const px = pad + st * (pw + gap) + local[0] * scale;
    const py = head + pad + (D - local[1]) * scale;
    marks.push(el("line", { x1: px, y1: py, x2: px + 10, y2: py - 10, stroke: WARN, "stroke-width": 1.2 }) + el("circle", { cx: px, cy: py, r: 2.5, fill: WARN }) + lookGlyph(px + 10, py - 10, 8, lk.n)); // prettier-ignore
    nums.push(lk.n);
  }
  const lot = C.lotOf.get(b.id);
  const tag = `<text x="${pad}" y="${f(head + pad * 2 + D * scale + 14)}" font-size="10" fill="#555">layer ${b.layer}, lot ${lot ? `${lot.rect.x},${lot.rect.y} (${lot.rect.w} x ${lot.rect.d} cells), door ${lot.frontage.side} on ${lot.frontage.way}${lot.tower ? `; a ${lot.tower.silhouette} tower ${lot.tower.across} across at [${lot.tower.at}], ${lot.tower.storeys} storeys over the roof (z ${lot.tower.z[0]} to ${lot.tower.z[1]}), not enterable` : ""}` : "?"}; R1 marks: ${nums.length ? nums.join(", ") : "none"}; 05-plans sha256 ${C.a.a5.hash.slice(0, 16)}</text>`; // prettier-ignore
  svg = svg.replace(/<\/svg>\s*$/, `${tag}\n<g id="looks" font-family="Arial">${marks.join("")}</g>\n</svg>\n`);
  return { svg, looks: nums };
}

// ── all of it ──

/**
 * The R1 pictures of a folder of artifacts (readArtifacts): { tile, pictures: [{ file, kind, layer, building, svg,
 * from, shows, looks, omitted }], looks }. Needs 01 and 02; draws 04-08 when they are there.
 */
export function reviewPictures(arts, { scale = 20 } = {}) {
  const C = contextOf(arts, { scale });
  const pictures = [];
  const files = (ns) => ns.map((n) => C.a[`a${n}`]?.file).filter(Boolean);
  const T = C.tile.id;
  for (const L of C.layers) {
    const p = layerPlan(C, L);
    pictures.push({ file: `plan-${T}-${L.id}.svg`, kind: "plan", layer: L.id, building: null, svg: p.svg, from: files([0, 1, 2, 3, 4, 5, 6, 8, 9]), shows: p.shows, looks: p.shows.looks, omitted: p.omitted }); // prettier-ignore
  }
  if (C.wiring)
    for (const L of C.layers) {
      const p = layerPlan(C, L, { faded: true, wiring: true });
      pictures.push({ file: `wiring-${T}-${L.id}.svg`, kind: "wiring", layer: L.id, building: null, svg: p.svg, from: files([1, 2, 4, 5, 7]), shows: p.shows, looks: p.shows.looks, omitted: p.omitted }); // prettier-ignore
    }
  for (const [axis, name] of [[0, "ns"], [1, "ew"]]) {
    const p = C.net ? sectionPicture(C, axis) : null;
    if (p) pictures.push({ file: `section-${T}-${name}.svg`, kind: "section", layer: null, building: null, svg: p.svg, from: files([0, 1, 2, 4, 5, 9]), shows: p.shows, looks: [], omitted: p.omitted }); // prettier-ignore
  }
  for (const b of C.plans?.buildings ?? []) {
    const p = buildingSheet(C, b);
    pictures.push({ file: `building-${b.id}.svg`, kind: "building", layer: b.layer, building: b.id, svg: p.svg, from: files([5]), shows: { buildings: [b.id], rooms: b.rooms.length }, looks: p.looks, omitted: 0 }); // prettier-ignore
  }
  return { tile: C.tile, pictures, looks: C.looks, artifacts: Object.fromEntries(Object.values(arts).map((a) => [a.file, a.hash])) }; // prettier-ignore
}

/** The review record: every picture with its sha256 and the artifacts it was drawn from; `approval: null`. */
export function reviewRecord(result, { dir = null } = {}) {
  return {
    format: REVIEW_FORMAT,
    stop: "R1",
    tile: { id: result.tile.id, name: result.tile.name ?? null },
    renderer: RENDERER,
    artifacts: { dir, files: result.artifacts },
    pictures: result.pictures.map((p) => ({ file: p.file, kind: p.kind, layer: p.layer, building: p.building, sha256: sha256(p.svg), bytes: Buffer.byteLength(p.svg), from: Object.fromEntries(p.from.map((x) => [x, result.artifacts[x]])), shows: p.shows, looks: p.looks, labelsLeftOff: p.omitted })), // prettier-ignore
    looks: result.looks.map((lk) => ({ n: lk.n, kind: lk.kind, text: lk.text, layer: lk.layer, at: lk.at, building: lk.building ?? null, storey: lk.storey ?? null })), // prettier-ignore
    approval: null,
  };
}

/** Writes the pictures and review.json to `out`; returns the record. */
export function writeReview(artifactDir, out, { scale = 20, writeFile = writeFileSync } = {}) {
  const arts = readArtifacts(artifactDir);
  const result = reviewPictures(arts, { scale });
  for (const p of result.pictures) writeFile(join(out, p.file), p.svg);
  const record = reviewRecord(result, { dir: resolve(artifactDir) });
  writeFile(join(out, "review.json"), JSON.stringify(record, null, 1) + "\n");
  return { record, result };
}

/**
 * Records the person's approval in `<reviewDir>/review.json`, only while every artifact the pictures were drawn
 * from still hashes the same, no artifact of a stage R1 draws has appeared since, and every picture is the one
 * shown. Returns { ok, record } or { ok: false, reason } naming what changed.
 */
export function approveReview(reviewDir, { by, note = null, artifactDir = null, now = new Date() } = {}) {
  if (!by) return { ok: false, reason: "an approval needs the name of who approves (--by)" };
  const file = join(reviewDir, "review.json");
  if (!existsSync(file)) return { ok: false, reason: `no review.json in ${reviewDir}: draw the pictures first` };
  const record = JSON.parse(readFileSync(file, "utf8"));
  if (record.format !== REVIEW_FORMAT) return { ok: false, reason: `review.json is ${JSON.stringify(record.format)}, not ${REVIEW_FORMAT}` }; // prettier-ignore
  const dir = artifactDir ?? record.artifacts?.dir;
  if (!dir || !existsSync(dir)) return { ok: false, reason: `the artifacts' folder ${dir} is not there` };
  const now_ = readArtifacts(dir);
  for (const [name, hash] of Object.entries(record.artifacts.files)) {
    const cur = now_[name];
    if (!cur) return { ok: false, reason: `${name} is gone from ${dir} since the pictures were drawn: draw them again` };
    if (cur.hash !== hash) return { ok: false, reason: `${name} changed since the pictures were drawn (sha256 ${hash.slice(0, 12)} then, ${cur.hash.slice(0, 12)} now): draw them again and look again` }; // prettier-ignore
  }
  for (const a of Object.values(now_))
    if (R1_STAGES.includes(a.n) && !(a.file in record.artifacts.files)) return { ok: false, reason: `${a.file} appeared since the pictures were drawn: draw them again and look again` }; // prettier-ignore
  for (const p of record.pictures) {
    const pf = join(reviewDir, p.file);
    if (!existsSync(pf)) return { ok: false, reason: `the picture ${p.file} is missing from ${reviewDir}` };
    const h = sha256(readFileSync(pf, "utf8"));
    if (h !== p.sha256) return { ok: false, reason: `the picture ${p.file} is not the one recorded (sha256 ${p.sha256.slice(0, 12)}, now ${h.slice(0, 12)})` }; // prettier-ignore
  }
  record.approval = { by, at: now.toISOString(), note, artifacts: record.artifacts.files, pictures: record.pictures.length };
  writeFileSync(file, JSON.stringify(record, null, 1) + "\n");
  return { ok: true, record };
}

// ── the facade family of stage 9 (forms-facade.mjs) on the plans and the sections ──

const FACADE_INK = { pilaster: "#6b7280", buttress: "#4b5563", balcony: "#7c3aed", gallery: "#7c3aed", bay: "#2563eb", cage: "#9a3412", setback: "#475569", corner: "#be185d", pipe: "#0f766e", dome: "#b45309", "tower-crown": "#ca8a04", roofline: "#a16207", capital: "#d4a017" }; // prettier-ignore
const FACADE_WORDS = { pilaster: "pilaster, lesene (F13)", buttress: "buttress (F13)", balcony: "loggia (F14)", gallery: "gallery (F14)", bay: "bay, overhead (F15)", cage: "cage, box (F15)", setback: "setback tier (F16, world)", corner: "corner piece (F17)", pipe: "wall pipe (F18)", dome: "dome (F22)", "tower-crown": "tower crown (F23)", roofline: "roofline (F24)", capital: "gold capital (F27)" }; // prettier-ignore
/** The facade family's kinds a section draws in outline beyond its cut (the skyline), and the words it labels a cut one with. */
const FACADE_BEYOND = ["setback", "tower-crown", "dome", "corner", "buttress", "capital"];
const FACADE_SAY = {
  setback: (fm) => `tier of ${fm.on} to z ${f(fm.top)}`,
  "tower-crown": (fm) => `${fm.on}'s crown (${fm.silhouette}) to z ${f(fm.top)}`,
  dome: (fm) => `dome over ${fm.over}, ${f(fm.across)} c`,
  capital: (fm) => `gold capitals on ${fm.on}`,
  corner: (fm) => `${fm.treatment} at ${fm.node}`,
};
// the legend reads the frame's inks and words: the facade family's are theirs too
Object.assign(FRAME_INK, FACADE_INK);
Object.assign(FRAME_WORDS, FACADE_WORDS);

/** One part of a facade form on a plan: what stands at the street solid, what hangs over it translucent and dashed. */
function facadePartOnPlan(fm, pt, poly) {
  const ink = FACADE_INK[fm.kind] ?? "#555";
  switch (fm.kind) {
    case "capital":
      return poly(pt.top ?? pt.poly, { fill: ink, stroke: "#713f12", "stroke-width": 0.6 });
    case "bay":
    case "cage":
    case "balcony":
    case "gallery":
      return poly(pt.poly, { fill: ink, "fill-opacity": 0.3, stroke: ink, "stroke-width": 0.7, "stroke-dasharray": "3 2" });
    case "setback":
      return poly(pt.poly, { fill: "url(#fhatch)", stroke: ink, "stroke-width": 1.4 });
    case "dome":
    case "tower-crown":
      return poly(pt.top ?? pt.poly, { fill: "none", stroke: ink, "stroke-width": pt.what === "lantern" ? 1.6 : 1, "stroke-dasharray": pt.build === "world" ? "" : "3 2" }); // prettier-ignore
    case "roofline":
      return poly(pt.poly, { fill: ink, "fill-opacity": 0.55, stroke: ink, "stroke-width": 0.4 });
    case "corner":
      return poly(pt.top ?? pt.poly, { fill: ink, "fill-opacity": pt.what === "corbel" ? 0.2 : 0.75, stroke: "#111", "stroke-width": 0.5 });
    default:
      return poly(pt.poly, { fill: ink, "fill-opacity": 0.9, stroke: "#111", "stroke-width": 0.4 });
  }
}

/** The facade family's words on a layer's plan: its landmarks, setbacks and capitals. */
function facadePlan(C, L, { X, Y, labels, here }) {
  const said = new Set();
  for (const fm of here) {
    if (fm.family !== "facade" || !["setback", "tower-crown", "dome", "capital"].includes(fm.kind)) continue;
    const key = fm.kind === "capital" ? `capital:${fm.on}` : fm.id;
    if (said.has(key)) continue;
    said.add(key);
    const n = fm.kind === "capital" ? here.filter((x) => x.kind === "capital" && x.on === fm.on).length : 0;
    const words = fm.kind === "capital" ? `${n} gold capitals (F27)` : FACADE_SAY[fm.kind](fm);
    labels.place([{ text: words, size: 8.5, cls: "b" }], around(X(fm.at[0]), Y(fm.at[1]), 10, [1, 1.6, 2.4]), { leader: [X(fm.at[0]), Y(fm.at[1])] }); // prettier-ignore
  }
  void L;
}
