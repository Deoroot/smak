// A map's dressing in numbers, beside Valve's own: how its walls are banded and textured, how much detail it has,
// how its lamps light it, how its floors are lit. The facts a maker revising a map is told, measured, never a
// model's opinion (research/level-dressing.md, sections 6 and 8: symbolic checks agree with people where a
// picture judge does near chance). Valve's numbers are measured, not stated by Valve: `VALVE_DRESSING`, from
// research/valve-dressing.mjs over the campaign maps named there.
//
//   dressingOf(bsp, { source, views, against })  -> { measures, rows, facts, warnings }
//     bsp      a compiled map (readBsp): its world's faces, textures and light
//     source   the map's brush source (readMap's, or what a map spec built): its brushes' roles, as Valve's
//              .rmf sources are measured (panels, strips, lamp brushes, angled)
//     views    pictures of it ({ width, height, rgba }): their edge density and how far they compress
//     against  the bands it is held to: Valve's (VALVE_DRESSING) unless told; a mod's profile gives its own
//              (`dressing`, as `learnDressing` measures them over the mod's maps)
//   learnDressing(list)    the bands of many maps' measures, in VALVE_DRESSING's shape
//   dressingOfSource(map)  the brush roles alone, for a map not yet compiled
//   brushRole(shape)       one brush's role: "lit", "strip", "panel", "block" (and `angled`)
//   isLampTexture(name)    a texture that lights or shows as a lamp
import { modelFaces, facePolygon, faceNormal, faceTexture, faceTextureAxes, faceLightmap } from "../../core/maps/bsp.mjs";
import { shapeOf } from "../../make/maps/source.mjs";
import { TEXLIGHTS } from "../../make/maps/texlights.mjs";
import { png } from "../../core/image.mjs";
import { formOfBsp, formOfSource, nonAxialOfSource, MAP_FORM } from "../form.mjs";

/**
 * Valve's own, measured: each measure's least, lower quartile, median, upper quartile and most over the
 * campaign maps research/valve-dressing.mjs names (the face measures, compiled maps), and over the SDK's two
 * c1a0 sources for the brush roles. A map's measure outside [least, most] is warned of.
 */
export const VALVE_DRESSING = {
  name: "Valve's",
  of: "Valve's campaign maps",
  maps: "every campaign map (96, c0a0 to c5a1, compiled, valve/maps); the brush roles from the SDK's c1a0.rmf and c1a0d.rmf, whose two numbers are widened a quarter each way for least and most",
  // each band the 5th to the 95th in 100 of the maps (least, most), with the quartiles and the median
  measures: {
    scaleOne: { least: 0.263, q1: 0.527, median: 0.791, q3: 0.878, most: 0.972 },
    shifted: { least: 0.279, q1: 0.453, median: 0.705, q3: 0.89, most: 0.975 },
    bandedWalls: { least: 0.014, q1: 0.075, median: 0.13, q3: 0.242, most: 0.407 },
    oneTextureWalls: { least: 0.443, q1: 0.577, median: 0.679, q3: 0.843, most: 0.929 },
    joinHeight: { least: 56, q1: 128, median: 160, q3: 256, most: 527 },
    lampFaces: { least: 0, q1: 3.154, median: 5, q3: 17.167, most: 101.143 },
    nonAxial: { least: 0.072, q1: 0.122, median: 0.215, q3: 0.404, most: 0.598 },
    detail: { least: 2.33, q1: 5.96, median: 10.657, q3: 15.011, most: 23.045 },
    darkFloor: { least: 0.061, q1: 0.128, median: 0.211, q3: 0.317, most: 0.601 },
    contrast: { least: 3.582, q1: 6.179, median: 12.917, q3: 55.667, most: 152 },
    panels: { least: 0.285, median: 0.39, most: 0.499 },
    strips: { least: 0.113, median: 0.153, most: 0.194 },
    litBrushes: { least: 0.107, median: 0.154, most: 0.206 },
    angled: { least: 0.034, median: 0.059, most: 0.09 },
    // form: the furniture's bands are MAP_FORM's (check/form.mjs), from the 96 campaign maps' brush-entity models
    ...Object.fromEntries(Object.entries(MAP_FORM).map(([k, v]) => [k, v.band])),
    // six views aimed (viewsOf with aim, 320 x 240, no labels or boxes) a map, with the game's textures
    edges: { least: 0.016, q1: 0.032, median: 0.049, q3: 0.072, most: 0.151 },
    compression: { least: 0.196, q1: 0.279, median: 0.335, q3: 0.38, most: 0.468 },
  },
};

/** What each measure is, how it is said, and which way a map off Valve's goes to come nearer. */
const MEASURES = {
  scaleOne: { words: "faces at texture scale 1", share: true, under: "lay textures at scale 1 (a stretched texture reads blurred)", over: null },
  shifted: { words: "faces shifted off the world's texture grid", share: true, under: "shift textures so a band's edge falls on the brush's edge, as Valve's hand does", over: null },
  bandedWalls: { words: "tall walls (128 or more) with a texture join up them", share: true, under: "band tall walls: a base texture, a field, a strip (frame, or a room's own bands)", over: "fewer joins up the walls" },
  oneTextureWalls: { words: "tall walls of one texture only", share: true, under: null, over: "break tall walls with a second texture up them" },
  joinHeight: { words: "median height of a wall's texture join over its foot", share: false, under: "set the band higher, near a door's head", over: "set the band lower" },
  lampFaces: { words: "lamp faces a light entity", share: false, under: "light by lamps built into the walls and ceilings (fixtures, texture lights), not lights hanging in the air", over: "more lights of their own beside the lamps" },
  nonAxial: { words: "of the world's face area off the axes", share: true, under: "break the boxes: cut corners, angled panels, slopes, pillars (a map spec's `frame` with its 45-degree chamfer and `breaks` with round pillars, coves and pipes; chamfered, prism, wedge, turned, bend)", over: null },
  ...Object.fromEntries(Object.entries(MAP_FORM).map(([k, v]) => [k, { words: v.words, share: true, under: null, over: v.over }])),
  detail: { words: "world planes a 256 x 256 of floor", share: false, under: "more detail: trim, ribs, beams, panels, fixtures (frame), props", over: "less clutter" },
  darkFloor: { words: "of the floor under the dark limit (24 of 255)", share: true, under: "keep dark spots on purpose: not every lamp on, a corridor sloping into dark", over: "light the dark floor: lamps where a player walks" },
  contrast: { words: "floor light's contrast (its brightest tenth over its darkest)", share: false, under: "compose the light: the goal brightest, pools under lamps, dark between", over: "soften the light: a weak fill, or fewer hard pools" },
  panels: { words: "of the brushes are panels (thin, wide)", share: true, under: "build walls of thin panels with trim between, not of solid blocks", over: null },
  strips: { words: "of the brushes are strips (trim, ribs, beams)", share: true, under: "add strips: bands, ribs, beams, frames", over: "fewer strips" },
  litBrushes: { words: "of the brushes wear a lamp's texture", share: true, under: "build lamps as brushes wearing a light texture", over: null },
  angled: { words: "of the brushes are not six-sided boxes", share: true, under: "cut and angle brushes: chamfers, wedges, slopes", over: null },
  edges: { words: "of the views' pixels on an edge", share: true, under: "more to see: detail, contrast of texture and light", over: null },
  compression: { words: "of a view's raw size its picture compresses to", share: true, under: "more variety in what a view shows", over: null },
};

const r2 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const TOOLS = /^(sky|clip|null|aaatrigger|origin|hint|skip|bevel|solidhint|noclip|nullnoclip|black_hidden)$/i;
const LAMP_NAMES = new Set(TEXLIGHTS.map((t) => t.name.toLowerCase()));

/** A texture that lights or shows as a lamp: one of the game's texture lights, a `~` name, or a lamp's word. */
export function isLampTexture(name) {
  const n = String(name).toLowerCase();
  return LAMP_NAMES.has(n) || /^[+-]?[0-9a-j]?~/.test(n) || /light|lgt|lite|lamp/.test(n);
}

/**
 * A map's own test for a lamp's texture: the names above, and every texture its `info_texlights` names (the
 * texture lights it was compiled with: a map spec's glowing fixtures among them).
 */
export function lampsOf(bsp) {
  const listed = new Set();
  for (const pairs of bsp.entities ?? []) {
    const keys = Object.fromEntries(pairs);
    if (keys.classname !== "info_texlights") continue;
    for (const key of Object.keys(keys)) if (!["classname", "origin", "angles"].includes(key)) listed.add(key.toLowerCase());
  }
  return (name) => isLampTexture(name) || listed.has(String(name).toLowerCase());
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => a.map((v, k) => v - b[k]);
/** A polygon's area. */
function areaOf(polygon) {
  let n = [0, 0, 0];
  for (let i = 1; i + 1 < polygon.length; i++) n = n.map((v, k) => v + cross(sub(polygon[i], polygon[0]), sub(polygon[i + 1], polygon[0]))[k]);
  return Math.hypot(...n) / 2;
}
const median = (v) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) / 2)] : null);
/** An area-weighted quantile of [[value, area]]. */
function weighted(pairs, q) {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((s, [, a]) => s + a, 0);
  let acc = 0;
  for (const [v, a] of sorted) {
    acc += a;
    if (acc >= q * total) return v;
  }
  return sorted.at(-1)?.[0] ?? null;
}

/**
 * Walls grouped by the plane they lie on (level normals only), each a list of its faces' texture and extent:
 * up the wall (z) and along it. Faces under 64 square units are left out.
 */
function wallPlanes(faces) {
  const planes = new Map();
  for (const f of faces) {
    const n = f.normal;
    if (Math.abs(n[2]) > 0.05 || f.area < 64) continue;
    const d = n[0] * f.polygon[0][0] + n[1] * f.polygon[0][1] + n[2] * f.polygon[0][2];
    const key = `${n.map((v) => Math.round(v * 20)).join(",")}|${Math.round(d / 2)}`;
    const zs = f.polygon.map((p) => p[2]);
    const along = f.polygon.map((p) => n[1] * p[0] - n[0] * p[1]);
    const list = planes.get(key) ?? planes.set(key, []).get(key);
    list.push({ texture: f.texture.toLowerCase(), z0: Math.min(...zs), z1: Math.max(...zs), s0: Math.min(...along), s1: Math.max(...along) });
  }
  return [...planes.values()];
}

/** Tall walls: how many have a texture join up them, how many wear one texture, and where the joins sit. */
function banding(faces) {
  let tall = 0;
  let banded = 0;
  let one = 0;
  const joins = [];
  for (const plane of wallPlanes(faces)) {
    const foot = Math.min(...plane.map((f) => f.z0));
    const head = Math.max(...plane.map((f) => f.z1));
    if (head - foot < 128) continue;
    tall++;
    if (new Set(plane.map((f) => f.texture)).size === 1) one++;
    let joined = false;
    for (const a of plane)
      for (const b of plane) {
        if (a.texture === b.texture || Math.abs(a.z1 - b.z0) > 1) continue;
        if (Math.min(a.s1, b.s1) - Math.max(a.s0, b.s0) < 1) continue;
        joined = true;
        joins.push(a.z1 - foot);
      }
    if (joined) banded++;
  }
  return { tall, banded: tall ? banded / tall : null, one: tall ? one / tall : null, joinHeight: median(joins) };
}

/** A compiled map's world faces: polygon, normal, area, texture and its laying. Tool, sky and liquid faces left out. */
function facesOfBsp(bsp) {
  const out = [];
  for (const face of modelFaces(bsp, 0)) {
    const t = faceTexture(bsp, face);
    if (!t?.name || TOOLS.test(t.name) || t.name.startsWith("!") || t.name.toLowerCase().startsWith("sky")) continue;
    const polygon = facePolygon(bsp, face);
    const axes = faceTextureAxes(bsp, face);
    out.push({ face, polygon, normal: faceNormal(bsp, face), area: areaOf(polygon), texture: t.name, width: t.width, height: t.height, axes, plane: face.plane });
  }
  return out;
}

/**
 * A face's steady light sample by sample: [[brightness 0 to 255, area]], each sample its share of the face's area.
 * By sample, not by face: a large floor face's mean evened out the pools under its lamps and the dark between
 * them, so a map of few large faces read as evenly lit however its lamps were composed (2026-10-17).
 */
function samplesOf(bsp, face, area) {
  const light = faceLightmap(bsp, face);
  const steady = light?.styles.find((s) => s.style === 0) ?? light?.styles[0];
  if (!steady) return [];
  const n = steady.rgb.length / 3;
  const out = [];
  for (let i = 0; i < n; i++) out.push([(steady.rgb[i * 3] + steady.rgb[i * 3 + 1] + steady.rgb[i * 3 + 2]) / 3, area / n]);
  return out;
}

/**
 * One brush's role, as Valve's c1a0 sources are read (research/level-dressing.md, 2.3): `lit` when it wears a
 * lamp's texture and its long side is 128 or less; else a `strip` when its two thinner sides are 16 and 24 or
 * less and its long side three times the middle; else a `panel` when its thinnest side is 16 or less and the
 * next 32 or more; else a `block`. `angled`: it has other than six faces. `shape`: { min, max, faces: [{ texture }] }.
 */
export function brushRole(shape) {
  const [a, b, c] = [0, 1, 2].map((k) => shape.max[k] - shape.min[k]).sort((x, y) => x - y);
  const lit = shape.faces.some((f) => isLampTexture(f.texture)) && c <= 128;
  const role = lit ? "lit" : a <= 16 && b <= 24 && c >= 3 * b ? "strip" : a <= 16 && b >= 32 ? "panel" : "block";
  return { role, angled: shape.faces.length !== 6 };
}

/** The world brushes of a map's source (and func_detail's), their roles counted: shares of the brushes. */
export function dressingOfSource(map) {
  const brushes = [...(map.brushes ?? []).flat(), ...(map.entities ?? []).filter((e) => /^func_detail$/.test(e.classname ?? "")).flatMap((e) => e.brushes ?? [])];
  const counts = { lit: 0, strip: 0, panel: 0, block: 0, angled: 0, all: 0 };
  for (const brush of brushes) {
    if (!brush?.faces?.length || brush.faces.every((f) => TOOLS.test(f.texture ?? "") || /^sky/i.test(f.texture ?? ""))) continue;
    const shape = shapeOf(brush);
    if (!(shape.volume > 0)) continue;
    const faces = shape.faces.filter((f) => f.area > 0);
    const { role, angled } = brushRole({ min: shape.min, max: shape.max, faces });
    counts[role]++;
    if (angled) counts.angled++;
    counts.all++;
  }
  const share = (n) => (counts.all ? n / counts.all : null);
  return { brushes: counts.all, panels: share(counts.panel), strips: share(counts.strip), litBrushes: share(counts.lit), angled: share(counts.angled) };
}

/**
 * A map's source held to Valve's before it is compiled: ["form: ..."] WARNING sentences. Its world's face area off
 * the axes under Valve's 5th in 100 (`nonAxial`'s band: a map of boxes; the map spec's `frame` and `breaks` cut
 * corners, add pillars and coves, and `chamfered`, `prism`, `wedge`, `turned` and `bend` make the rest), and its
 * detail and entity brushes that are bare boxes or all bare edges (`bareBoxes`, `squareEdges`: box's `bevel`,
 * `extrudeProfile`, `sweepProfile`, `roundedBox`). A source with no world brush says nothing of the first.
 */
export function judgeSourceForm(map, against = VALVE_DRESSING) {
  const out = [];
  const measures = { nonAxial: nonAxialOfSource(map), ...formOfSource(map).measures };
  const brushes = formOfSource(map).brushes;
  for (const [key, value] of Object.entries(measures)) {
    const band = against.measures?.[key] ?? VALVE_DRESSING.measures[key];
    if (value === null || !band) continue;
    const off = value < band.least ? "under" : value > band.most ? "over" : null;
    const way = off && MEASURES[key][off];
    if (way) out.push(`form: ${MEASURES[key].words}: ${said(key, value)} (${against.name ?? "Valve's"}: ${said(key, band.least)} to ${said(key, band.most)}, median ${said(key, band.median)}${key === "nonAxial" ? "" : `; ${brushes} brushes`}); ${way}`);
  }
  return out;
}

/** A picture's edge density (pixels whose brightness steps by more than 24 to a neighbour) and compression. */
export function pictureComplexity(picture) {
  const { width, height, rgba } = picture;
  const lum = (i) => 0.3 * rgba[i * 4] + 0.59 * rgba[i * 4 + 1] + 0.11 * rgba[i * 4 + 2];
  let edges = 0;
  for (let y = 0; y + 1 < height; y++)
    for (let x = 0; x + 1 < width; x++) {
      const i = y * width + x;
      if (Math.abs(lum(i) - lum(i + 1)) + Math.abs(lum(i) - lum(i + width)) > 24) edges++;
    }
  return { edges: edges / ((width - 1) * (height - 1)), compression: png(width, height, rgba).length / (width * height * 3) };
}

/** A compiled map's measures (and its source's roles, and its views', when given). */
export function measureDressing(bsp, { source = null, views = null } = {}) {
  const faces = facesOfBsp(bsp);
  const textured = faces.filter((f) => f.width && f.height);
  const scaleOf = (axis) => 1 / Math.hypot(axis[0], axis[1], axis[2]);
  const atOne = textured.filter((f) => Math.abs(scaleOf(f.axes.s) - 1) < 0.02 && Math.abs(scaleOf(f.axes.t) - 1) < 0.02);
  const shifted = textured.filter((f) => Math.round(((f.axes.s[3] % f.width) + f.width) % f.width) % f.width !== 0 || Math.round(((f.axes.t[3] % f.height) + f.height) % f.height) % f.height !== 0);
  const band = banding(faces);
  const total = faces.reduce((s, f) => s + f.area, 0);
  const offAxes = faces.filter((f) => Math.max(...f.normal.map(Math.abs)) < 0.999).reduce((s, f) => s + f.area, 0);
  const floors = faces.filter((f) => f.normal[2] >= 0.7);
  const floorArea = floors.reduce((s, f) => s + f.area, 0);
  const planes = new Set(faces.map((f) => f.plane)).size;
  // lamps: every model's faces wearing a lamp's texture, against the light entities
  const isLamp = lampsOf(bsp);
  let lampFaces = 0;
  for (let m = 0; m < bsp.models.length; m++) for (const face of modelFaces(bsp, m)) if (isLamp(faceTexture(bsp, face)?.name ?? "")) lampFaces++;
  const lights = bsp.entities.filter((e) => /^light(_spot)?$/.test(Object.fromEntries(e).classname ?? "")).length;
  // floor light, sample by sample, each by its area
  const lit = bsp.lumps.lighting.length > 0;
  const bright = lit ? floors.flatMap((f) => samplesOf(bsp, f.face, f.area)) : [];
  const lightArea = bright.reduce((s, [, a]) => s + a, 0);
  const measures = {
    scaleOne: textured.length ? atOne.length / textured.length : null,
    shifted: textured.length ? shifted.length / textured.length : null,
    bandedWalls: band.banded,
    oneTextureWalls: band.one,
    joinHeight: band.joinHeight,
    lampFaces: lights ? lampFaces / lights : null,
    nonAxial: total ? offAxes / total : null,
    detail: floorArea ? planes / (floorArea / 65536) : null,
    darkFloor: lightArea ? bright.filter(([b]) => b < 24).reduce((s, [, a]) => s + a, 0) / lightArea : null,
    contrast: lightArea ? weighted(bright, 0.9) / Math.max(1, weighted(bright, 0.1)) : null,
    ...formOfBsp(bsp).measures,
  };
  if (source) Object.assign(measures, formOfSource(source).measures);
  if (source) Object.assign(measures, (({ panels, strips, litBrushes, angled }) => ({ panels, strips, litBrushes, angled }))(dressingOfSource(source)));
  if (views?.length) {
    const each = views.map(pictureComplexity);
    measures.edges = median(each.map((v) => v.edges));
    measures.compression = median(each.map((v) => v.compression));
  }
  return { measures, counts: { faces: faces.length, tallWalls: band.tall, lampFaces, lights, floorArea: Math.round(floorArea), planes } };
}

/** A measure as words: a share as a per cent, else to two places. */
const said = (key, v) => (v === null ? "not measured" : MEASURES[key]?.share ? `${Math.round(v * 100)}%` : `${r2(v)}`);

/**
 * A map's dressing beside Valve's: `rows` one a measure ({ key, value, valve, off }), `facts` a line each,
 * `warnings` for a measure outside Valve's least to most, saying which way to go. `against`: other bands (a
 * profile's `dressing`, `learnDressing`'s), `{ name, of, measures }`; a measure they have no band for is held
 * against Valve's. Each row's `valve` is the band it was held to, `by` whose.
 */
export function dressingOf(bsp, { source = null, views = null, against = VALVE_DRESSING, landmark = null } = {}) {
  const { measures, counts } = measureDressing(bsp, { source, views });
  against ??= VALVE_DRESSING;
  const rows = [];
  const facts = [];
  const warnings = [];
  for (const [key, value] of Object.entries(measures)) {
    const own = against.measures?.[key] ?? null;
    const by = own ? against : VALVE_DRESSING;
    const valve = own ?? VALVE_DRESSING.measures[key] ?? null;
    const off = value === null || !valve ? null : value < valve.least ? "under" : value > valve.most ? "over" : null;
    rows.push({ key, value: r2(value), valve, off, by: by.name ?? "the reference's" });
    const range = valve ? ` (${by.name ?? "the reference's"}: ${said(key, valve.least)} to ${said(key, valve.most)}, median ${said(key, valve.median)})` : "";
    const line = `dressing: ${MEASURES[key].words}: ${said(key, value)}${range}`;
    facts.push(line);
    const way = off && MEASURES[key][off];
    if (way) warnings.push(`${line}: ${off === "under" ? "under the 5th" : "over the 95th"} in 100 of ${by.of ?? "the reference's maps"}; ${way}`);
  }
  // the map's one main area and its landmark (a map spec's focus), seen from the ways into its room or not
  if (landmark) {
    facts.push(`dressing: landmark ${landmark.name} in ${landmark.room}, seen from ${landmark.seen} of ${landmark.of} ways into its room`);
    if (landmark.seen < landmark.of) warnings.push(`dressing: the landmark ${landmark.name} is hidden from ${landmark.of - landmark.seen} of the ${landmark.of} ways into ${landmark.room}: Valve's main areas show their centre from each entrance`);
  }
  facts.push(`dressing counts: ${counts.faces} world faces, ${counts.tallWalls} tall walls, ${counts.lampFaces} lamp faces, ${counts.lights} light entities, ${counts.planes} planes over ${counts.floorArea} square units of floor`);
  return { measures, counts, rows, facts, warnings };
}

/** The measures `learnDressing` bands: those of a compiled map alone (no source, no views). */
export const DRESSING_LEARNED = ["scaleOne", "shifted", "bandedWalls", "oneTextureWalls", "joinHeight", "lampFaces", "nonAxial", "bareProps", "squareProps", "propAxisAligned", "detail", "darkFloor", "contrast"];

/**
 * The bands of many maps' dressing, in VALVE_DRESSING's shape: `{ name, of, maps, measures: { key: { least, q1,
 * median, q3, most } } }`, least and most the 5th and the 95th in 100 (as Valve's are), each the value that share
 * of the way up the sorted list. `list` is `[{ name, measures }]`, `measureDressing`'s for each map; a map with no
 * value for a measure (no light, no tall walls, no light entity) is left out of that measure's band. `name` is
 * how the lines say whose ("The Specialists'"), `of` the maps in words ("The Specialists' 29 maps").
 */
export function learnDressing(list, { name, of } = {}) {
  const measures = {};
  for (const key of DRESSING_LEARNED) {
    const values = list.map((each) => each.measures?.[key]).filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
    if (!values.length) continue;
    const at = (share) => Math.round(values[Math.min(values.length - 1, Math.floor(share * values.length))] * 1000) / 1000;
    measures[key] = { least: at(0.05), q1: at(0.25), median: at(0.5), q3: at(0.75), most: at(0.95) };
  }
  return { name: name ?? `${list.length} maps'`, of: of ?? `${list.length} maps`, maps: list.map((each) => each.name), measures };
}
