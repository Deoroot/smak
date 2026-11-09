// Form in numbers: how much of a model or a mesh is a pile of boxes. Checks measure validity, budget and
// walkability; none measured shape, and an agent (or a generator) that wants a thing that always compiles makes
// axis-aligned boxes. This is the measure that says so, with the bands of a game's own models beside it.
//
//   formOfTriangles(tris)              tris: [[p, p, p]] (points [x, y, z]) -> { measures, counts }
//   formOfMdl(src, opts)               a studio model at rest, its first body (drawn by `posed`)
//   formOfBrushes(brushes)             map brushes (as source.mjs makes them) -> the same measures on their faces
//   formOfSource(map), formOfBsp(bsp), nonAxialOfSource(map)   a map's furniture (detail and brush entities): bare boxes and edges;
//                                      its world off the axes. Held to Valve's bands by dressing.mjs (`judgeSourceForm`,
//                                      `dressingOf`'s rows): `nonAxial` and its bands are dressing.mjs's own, not repeated here
//   kindOfName(name)                   "vehicles" for a train, a car ...; else "props"
//   judgeForm(measures, kind)          { rows, warnings, boxy }: held against FORM_BANDS[kind]
//   FORM_BANDS                         numbers only (see the comment on it)
//
// The measures (all of the surface, none of the textures):
//   axisAligned  share of the surface area whose normal is within 5 degrees of an axis of the model (x, y, z)
//   sharpEdges   of the edges where the surface turns by 20 degrees or more (the creases), the share that turn
//                by 80 or more and have no chamfer or round between: a box's twelve edges are all of them;
//                a chamfered box's are 45 degrees each, and a round has none over 80
//   outline      the corners of the silhouette (outer contour, simplified to 1.5% of the model's longest side),
//                the mean over the front, side and top views: a box is 4, a bench 8, a person 20 or more
//   boxiness     0 to 1: the mean of axisAligned, sharpEdges and how near the outline is to a rectangle
//                (1 at 4 corners, 0 at 24 or more). Higher is boxier.
// Plain ESM; the model readers are imported where a model is read.

import { posed } from "./render.mjs";
import { shapeOf } from "./maps/source.mjs";
import { modelFaces, facePolygon, faceTexture } from "./maps/bsp.mjs";

const COS_AXIS = Math.cos((5 * Math.PI) / 180);
/** Where a turn is a crease at all, and where it is a sharp one (degrees). */
export const CREASE_DEGREES = 20;
export const SHARP_DEGREES = 80;
const COS_CREASE = Math.cos((CREASE_DEGREES * Math.PI) / 180);
const COS_SHARP = Math.cos((SHARP_DEGREES * Math.PI) / 180);
/** The grid a silhouette is drawn on, along the model's longest side; and the simplification, in cells. */
const GRID = 128;
const SIMPLIFY = 1.5 / 100;
/** An outline of this many corners or more counts as no box at all. */
const CORNERS_FREE = 24;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const hyp = (a) => Math.hypot(a[0], a[1], a[2]);
const r3 = (v) => Math.round(v * 1000) / 1000;

/** The weld key of a point (hundredths of a unit). */
const key = (p) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)},${Math.round(p[2] * 100)}`;

/**
 * Faces as { normal (unit), area, ring: [p, ...] } -> the measures of their surface. `polys`: each face a
 * polygon (3 or more points); the edges are those of the polygons, welded by position.
 */
function surfaceOf(polys) {
  let total = 0;
  let aligned = 0;
  const edges = new Map();
  const faces = [];
  for (const poly of polys) {
    let n = [0, 0, 0];
    for (let i = 1; i + 1 < poly.length; i++) {
      const c = cross(sub(poly[i], poly[0]), sub(poly[i + 1], poly[0]));
      n = [n[0] + c[0], n[1] + c[1], n[2] + c[2]];
    }
    const area = hyp(n) / 2;
    if (!(area > 1e-9)) continue;
    const normal = n.map((v) => v / (2 * area));
    total += area;
    if (Math.max(...normal.map(Math.abs)) >= COS_AXIS) aligned += area;
    const at = faces.push({ normal, area }) - 1;
    for (let i = 0; i < poly.length; i++) {
      const a = key(poly[i]);
      const b = key(poly[(i + 1) % poly.length]);
      if (a === b) continue;
      const id = a < b ? `${a}|${b}` : `${b}|${a}`;
      const entry = edges.get(id);
      const length = hyp(sub(poly[i], poly[(i + 1) % poly.length]));
      if (entry) entry.faces.push(at);
      else edges.set(id, { faces: [at], length });
    }
  }
  let crease = 0;
  let sharp = 0;
  for (const { faces: on, length } of edges.values()) {
    // an edge of exactly two faces; a seam where several pieces meet, or a rim, is not a crease of one surface
    if (on.length !== 2) continue;
    const d = dot(faces[on[0]].normal, faces[on[1]].normal);
    if (d <= COS_CREASE) crease += length;
    if (d <= COS_SHARP) sharp += length;
  }
  return { area: total, axisAligned: total ? aligned / total : null, sharpEdges: crease > 0 ? sharp / crease : 0, creaseLength: crease };
}

/** Corners of a closed contour kept: Douglas-Peucker over its two halves, `tolerance` in cells. */
function simplified(ring, tolerance) {
  if (ring.length < 4) return ring.length;
  const dist = (p, a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy);
    if (!l) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / l;
  };
  const inner = (arc) => {
    let kept = 0;
    const walk = (i, j) => {
      let far = -1;
      let at = 0;
      for (let k = i + 1; k < j; k++) {
        const d = dist(arc[k], arc[i], arc[j]);
        if (d > far) [far, at] = [d, k];
      }
      if (far > tolerance) {
        kept++;
        walk(i, at);
        walk(at, j);
      }
    };
    walk(0, arc.length - 1);
    return kept;
  };
  let far = -1;
  let b = 0;
  for (let k = 1; k < ring.length; k++) {
    const d = Math.hypot(ring[k][0] - ring[0][0], ring[k][1] - ring[0][1]);
    if (d > far) [far, b] = [d, k];
  }
  return 2 + inner(ring.slice(0, b + 1)) + inner([...ring.slice(b), ring[0]]);
}

/** The outer contour of the largest blob of a mask (Moore-neighbour trace), as cells. */
function contourOf(mask, w, h) {
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x] : 0);
  let start = null;
  for (let y = 0; y < h && !start; y++) for (let x = 0; x < w; x++) if (at(x, y)) { start = [x, y]; break; } // prettier-ignore
  if (!start) return [];
  const around = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]]; // prettier-ignore
  const ring = [start];
  let cur = start;
  let from = 0; // came from the west
  for (let step = 0; step < w * h * 4; step++) {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (from + k) % 8;
      const nx = cur[0] + around[d][0];
      const ny = cur[1] + around[d][1];
      if (at(nx, ny)) {
        from = (d + 5) % 8;
        cur = [nx, ny];
        found = true;
        break;
      }
    }
    if (!found) break;
    if (cur[0] === start[0] && cur[1] === start[1]) break;
    ring.push(cur);
  }
  return ring;
}

/** The silhouette of triangles seen along an axis: the corners of its outer contour, simplified. */
function outlineCorners(tris, drop, size, mins) {
  const [u, v] = [0, 1, 2].filter((a) => a !== drop);
  const k = (GRID - 4) / size;
  const w = GRID;
  const h = GRID;
  const mask = new Uint8Array(w * h);
  const px = (p) => [(p[u] - mins[u]) * k + 2, (p[v] - mins[v]) * k + 2];
  for (const tri of tris) {
    const [a, b, c] = tri.map(px);
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const x1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const y1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(den) < 1e-9) continue;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const cx = x + 0.5;
        const cy = y + 0.5;
        const l1 = ((b[1] - c[1]) * (cx - c[0]) + (c[0] - b[0]) * (cy - c[1])) / den;
        const l2 = ((c[1] - a[1]) * (cx - c[0]) + (a[0] - c[0]) * (cy - c[1])) / den;
        const l3 = 1 - l1 - l2;
        if (l1 >= 0 && l2 >= 0 && l3 >= 0) mask[y * w + x] = 1;
      }
    // a sliver thinner than a cell is still drawn: its edges' cells
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) * 2) + 1;
      for (let i = 0; i <= n; i++) {
        const x = Math.floor(p[0] + ((q[0] - p[0]) * i) / n);
        const y = Math.floor(p[1] + ((q[1] - p[1]) * i) / n);
        if (x >= 0 && y >= 0 && x < w && y < h) mask[y * w + x] = 1;
      }
    }
  }
  return simplified(contourOf(mask, w, h), SIMPLIFY * GRID);
}

/**
 * The form of triangles. `tris`: [[p, p, p], ...]. Returns { measures: { axisAligned, sharpEdges, outline,
 * boxiness }, counts: { triangles, area, creases } }, or measures of null for nothing to measure.
 */
export function formOfTriangles(tris) {
  const polys = tris.filter((t) => t.length >= 3);
  const surface = surfaceOf(polys);
  if (!(surface.area > 0)) return { measures: { axisAligned: null, sharpEdges: null, outline: null, boxiness: null }, counts: { triangles: 0, area: 0, creases: 0 } };
  const pts = polys.flat();
  const mins = [0, 1, 2].map((a) => Math.min(...pts.map((p) => p[a])));
  const maxs = [0, 1, 2].map((a) => Math.max(...pts.map((p) => p[a])));
  const size = Math.max(...maxs.map((v, a) => v - mins[a]), 1e-6);
  const corners = [0, 1, 2].map((drop) => outlineCorners(polys, drop, size, mins));
  const outline = corners.reduce((s, v) => s + v, 0) / 3;
  const rect = Math.max(0, Math.min(1, 1 - (outline - 4) / (CORNERS_FREE - 4)));
  const boxiness = (surface.axisAligned + surface.sharpEdges + rect) / 3;
  return {
    measures: { axisAligned: r3(surface.axisAligned), sharpEdges: r3(surface.sharpEdges), outline: r3(outline), boxiness: r3(boxiness) },
    counts: { triangles: polys.length, area: Math.round(surface.area), creases: Math.round(surface.creaseLength), corners },
  };
}

/** A studio model's form at rest (`posed`'s), first body, every submodel it draws. */
export function formOfMdl(src, opts = {}) {
  const { tris } = posed(src, { seq: null, ...opts });
  return formOfTriangles(tris.map((t) => t.c.map((c) => c.p)));
}

/** The form of map brushes ({ faces } as source.mjs makes them): edges welded within a brush only. */
export function formOfBrushes(brushes) {
  return surfaceOfBrushes(brushes);
}

/** Surface measures brush by brush (edges welded within a brush only), area-weighted over all. */
function surfaceOfBrushes(brushes) {
  let area = 0;
  let aligned = 0;
  let crease = 0;
  let sharp = 0;
  let bare = 0;
  let count = 0;
  for (const brush of brushes) {
    const shape = shapeOf(brush);
    if (!(shape.volume > 0) || shape.volume === Infinity) continue;
    const faces = shape.faces.filter((f) => f.polygon.length >= 3 && f.area > 0);
    count++;
    if (faces.length === 6 && faces.every((f) => Math.max(...f.normal.map(Math.abs)) >= COS_AXIS)) bare++;
    const s = surfaceOf(shape.faces.filter((f) => f.polygon.length >= 3 && f.area > 0).map((f) => f.polygon));
    if (!s.area) continue;
    area += s.area;
    aligned += s.axisAligned * s.area;
    crease += s.creaseLength;
    sharp += s.sharpEdges * s.creaseLength;
  }
  return { axisAligned: area ? aligned / area : null, sharpEdges: crease ? sharp / crease : 0, area, bare, count };
}

const TOOL_TEXTURE = /^(sky|clip|null|aaatrigger|origin|hint|skip|bevel|solidhint|noclip|nullnoclip|black_hidden|trigger)/i;
/** Brush entities that are objects a player looks at (a door or a button is a box by nature, a trigger unseen). */
const LOOKED_AT = /^(func_(detail|wall|wall_toggle|illusionary|breakable|pushable|train|tracktrain|rotating|conveyor|plat|platrot|guntarget|tank\w*)|env_\w*model_brush)$/;

/**
 * Brushes of a map's source that a player looks at as objects: the brushes of its func_detail, func_wall,
 * func_breakable, func_train ... (not doors, buttons, triggers or clip) that wear a texture of a surface, not a
 * tool. World brushes are not counted: a room is boxes by nature; its props and fixtures are the test.
 */
export function detailBrushesOf(map) {
  return (map.entities ?? [])
    .filter((e) => e.brushes?.length && LOOKED_AT.test(e.classname ?? ""))
    .flatMap((e) => e.brushes)
    .filter((b) => b?.faces?.length && !b.faces.every((f) => TOOL_TEXTURE.test(f.texture ?? "")));
}

/**
 * The form of a map's detail: `bareBoxes` the share of those brushes that are six-sided boxes on the axes,
 * `squareEdges` the share of their creases that are bare 80 degrees or sharper, `axisAligned` their face area on
 * the axes. null for a map with none.
 */
export function formOfSource(map) {
  const list = detailBrushesOf(map);
  const s = surfaceOfBrushes(list);
  return { brushes: s.count, measures: { bareBoxes: s.count ? s.bare / s.count : null, squareEdges: s.count ? s.sharpEdges : null } };
}

/**
 * The same of a compiled map's brush-entity models (a func_detail is merged into the world and is not there):
 * a model is bare when every face is on an axis and it has no creases between 20 and 80 degrees; the edges are
 * those within one model.
 */
export function formOfBsp(bsp) {
  let models = 0;
  let bare = 0;
  let area = 0;
  let aligned = 0;
  let crease = 0;
  let sharp = 0;
  const looked = new Set();
  for (const pairs of bsp.entities ?? []) {
    const keys = Object.fromEntries(pairs);
    if (LOOKED_AT.test(keys.classname ?? "") && /^\*\d+$/.test(keys.model ?? "")) looked.add(Number(keys.model.slice(1)));
  }
  for (let m = 1; m < (bsp.models?.length ?? 0); m++) {
    if (!looked.has(m)) continue;
    const polys = [];
    for (const face of modelFaces(bsp, m)) {
      if (TOOL_TEXTURE.test(faceTexture(bsp, face)?.name ?? "")) continue;
      polys.push(facePolygon(bsp, face));
    }
    if (!polys.length) continue;
    const s = surfaceOf(polys);
    if (!(s.area > 0)) continue;
    models++;
    if (s.axisAligned >= 0.999 && s.sharpEdges >= 0.999) bare++;
    area += s.area;
    aligned += s.axisAligned * s.area;
    crease += s.creaseLength;
    sharp += s.sharpEdges * s.creaseLength;
  }
  return { models, measures: { bareProps: models ? bare / models : null, squareProps: models && crease ? sharp / crease : null, propAxisAligned: area ? aligned / area : null } };
}

/**
 * Bands, numbers only: a measure's least, quartiles, median and most over a corpus (the 5th and 95th in 100),
 * as `dressing.mjs`' VALVE_DRESSING keeps Valve's. Provenance below. A model is warned of when its measure
 * is over `most` (a form boxier than 19 of 20 of the game's own).
 */
export const FORM_BANDS = {
  // Measured by node over C:/Juegos/Steam/steamapps/common/Half-Life/valve/models at rest, the first body: of its
  // 250-odd files, the studio models of version 10 only, the texture files, gibs, plants, effects and sprite-like
  // models left out. props: 49 (the items and weapons on the ground `w_*`, filecabinet, can, mil_crate, mbarrel, light,
  // crystal, big_rock, holo, hvr, sat_globe, spiggot). vehicles: 9 (apache, osprey, dead_osprey, forklift, loader,
  // construction, turret, miniturret, sentry: a small corpus, its bands rough). creatures: 31 monsters and players of
  // 200 triangles or more. least and most: the 5th and 95th in the corpus' order, with the quartiles.
  props: {
    of: "Half-Life's 49 props and items",
    measures: {
      axisAligned: { least: 0.015, q1: 0.18, median: 0.339, q3: 0.574, most: 0.737 },
      sharpEdges: { least: 0.117, q1: 0.259, median: 0.378, q3: 0.729, most: 0.971 },
      outline: { least: 5.667, q1: 8.333, median: 13, q3: 16.333, most: 23.333 },
      boxiness: { least: 0.189, q1: 0.298, median: 0.436, q3: 0.634, most: 0.854 },
    },
  },
  vehicles: {
    of: "Half-Life's 9 vehicles and machines",
    measures: {
      axisAligned: { least: 0.075, q1: 0.377, median: 0.401, q3: 0.543, most: 0.616 },
      sharpEdges: { least: 0.231, q1: 0.419, median: 0.461, q3: 0.53, most: 0.624 },
      outline: { least: 11.667, q1: 20.333, median: 24, q3: 25.667, most: 41.667 },
      boxiness: { least: 0.208, q1: 0.284, median: 0.342, q3: 0.369, most: 0.456 },
    },
  },
  creatures: {
    of: "Half-Life's 31 monsters and players",
    measures: {
      axisAligned: { least: 0.004, q1: 0.015, median: 0.034, q3: 0.08, most: 0.267 },
      sharpEdges: { least: 0.097, q1: 0.167, median: 0.23, q3: 0.28, most: 0.435 },
      outline: { least: 14, q1: 18.667, median: 26, q3: 31.333, most: 44 },
      boxiness: { least: 0.058, q1: 0.09, median: 0.121, q3: 0.203, most: 0.261 },
    },
  },
};

/** The kind of a model by its file name: "vehicles" (a word of one), else "props". Pass `kind` to say otherwise. */
export const kindOfName = (name = "") =>
  /(^|[^a-z])(train|tram|metro|subway|car|bus|truck|van|tank|jeep|boat|ship|plane|heli|chopper|apache|osprey|forklift|loader|vehicle|cart|wagon|taxi|bike|turret)([^a-z]|$)/i.test(name) ? "vehicles" : "props";

/** How each measure is said, and what to do when a form is over its band. */
export const FORM_SAID = {
  axisAligned: ["of the surface faces an axis (within 5 degrees)", true, "give it a profile: slant, taper, curve some faces off the axes"],
  sharpEdges: ["of its creases are bare 80-degree-or-sharper edges", true, "chamfer or round the edges people look at (a bevel on box/plate/cyl, a profile)"],
  outline: ["silhouette corners (mean of three views)", false, "the silhouette is plainer than the game's: give it a profile (a roofline, wheel arches, a taper, a step)"],
  boxiness: ["boxiness (mean of axis-aligned, sharp edges and how rectangular the silhouette is; 0 round, 1 a crate)", false, "a form here is a box with detail on it: start from a reference (a photo, a section, a silhouette), give it a profile, chamfer the edges; a vehicle or a curved prop is a model, not brushes"],
};

/**
 * A form's measures held against a kind's band ("props" or "creatures"). Returns { rows, warnings, boxy }: a
 * WARNING when axisAligned, sharpEdges or boxiness is over the band's most (and outline under its least).
 */
export function judgeForm(measures, kind = "props", bands = FORM_BANDS) {
  const band = bands[kind];
  const rows = [];
  const warnings = [];
  if (!band || !Object.keys(band.measures).length) return { rows, warnings, boxy: false };
  for (const [k, value] of Object.entries(measures)) {
    const b = band.measures[k];
    if (!b || value === null || value === undefined) continue;
    const off = k === "outline" ? (value < b.least ? "under" : null) : value > b.most ? "over" : null;
    rows.push({ key: k, value, band: b, off });
    // a plain silhouette alone is no fault (a card, a leaf, a bar): it is said when the surface is boxy too
    if (!off || (k === "outline" && !(measures.boxiness > band.measures.boxiness?.most))) continue;
    const said = FORM_SAID[k];
    const pct = (v) => (said?.[1] ? `${Math.round(v * 100)}%` : `${r3(v)}`);
    warnings.push(`form: ${said?.[0] ?? k}: ${pct(value)} (${band.of}: median ${pct(b.median)}, ${off === "over" ? "95th in 100" : "5th in 100"} ${pct(off === "over" ? b.most : b.least)}); ${said?.[2] ?? "break the boxes"}`);
  }
  return { rows, warnings, boxy: rows.some((r) => r.off && r.key === "boxiness") };
}

/**
 * A map's furniture, by the measures dressing.mjs carries: Valve's own bands (from the 96 campaign maps' brush-entity
 * models: func_wall, func_breakable, func_train ...; formOfBsp over valve/maps c*.bsp) and what to do over them.
 * Valve builds its props of boxes too, so a map is warned of only when its furniture is boxier than 19 of 20 of
 * Valve's maps'. `bareBoxes` and `squareEdges` are the source's own (func_detail included, which a compile merges into
 * the world), held to the same bands: the SDK's sources are not here to measure them apart.
 */
const NO_BOX = "no bare box for anything a player looks at: chamfer it (box's bevel), give it a profile (extrudeProfile, sweepProfile), or make it a model; a vehicle or a curved prop is a model, not brushes";
const NO_EDGE = "chamfer the edges people look at (box's bevel), round the corners (roundedBox)";
const NO_FLAT = "slant, taper or curve some faces: a profile (extrudeProfile, sweepProfile) instead of a box";
export const MAP_FORM = {
  bareProps: { words: "of the furniture and fixtures (brush entities) are bare boxes on the axes", band: { least: 0, q1: 0.333, median: 0.531, q3: 0.648, most: 0.811 }, over: NO_BOX },
  squareProps: { words: "of the creases of that furniture are bare 80-degree edges", band: { least: 0.45, q1: 0.753, median: 0.854, q3: 0.916, most: 0.98 }, over: NO_EDGE },
  propAxisAligned: { words: "of the furniture's face area is on the axes", band: { least: 0.352, q1: 0.658, median: 0.818, q3: 0.912, most: 0.984 }, over: NO_FLAT },
  bareBoxes: { words: "of the detail and entity brushes (the source's) are bare six-sided boxes on the axes", band: { least: 0, q1: 0.333, median: 0.531, q3: 0.648, most: 0.811 }, over: NO_BOX },
  squareEdges: { words: "of the creases of the detail and entity brushes (the source's) are bare 80-degree edges", band: { least: 0.45, q1: 0.753, median: 0.854, q3: 0.916, most: 0.98 }, over: NO_EDGE },
};

/**
 * The share of a source's world brushes' face area off the axes: the compiled map's `nonAxial` (dressing.mjs), taken
 * from the brushes where there is no compile yet. Faces on tool textures, and the sky box's, are left out. null for
 * a source with no world brush.
 */
export function nonAxialOfSource(map) {
  let area = 0;
  let off = 0;
  for (const brush of (map.brushes ?? []).flat()) {
    if (!brush?.faces?.length || brush.faces.every((f) => TOOL_TEXTURE.test(f.texture ?? ""))) continue;
    const shape = shapeOf(brush);
    if (!(shape.volume > 0) || shape.volume === Infinity) continue;
    shape.faces.forEach((f, i) => {
      if (TOOL_TEXTURE.test(brush.faces[i]?.texture ?? "") || !(f.area > 0)) return;
      area += f.area;
      if (Math.max(...f.normal.map(Math.abs)) < 0.999) off += f.area;
    });
  }
  return area ? off / area : null;
}
