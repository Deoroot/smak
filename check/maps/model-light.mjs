// How GoldSrc lights a model (Xash3D FWGS ref/common/ref_light.c R_EntityDynamicLight, R_LightVec,
// R_RecursiveLightPoint; ref/gl/gl_studio.c R_StudioLighting). No light entity reaches a model: once a frame the
// engine takes one light at the model's origin and shades every vertex by its normal against that light's way.
//
// THE LIGHT. A line from 8 units above the origin toward the sun (sv_skyvec, 8192 units): when what it meets first
// is sky, the light is the sky's (sv_skycolor), shining along the sun's way. Otherwise it is the baked light of the
// first lit face straight under that point (2048 units down: every style at its level, as the lightmaps), and its
// way is down, leant by how the light changes round it: the floor's light 16 units off on the four diagonals (the
// light's gradient, R_EntityDynamicLight; GoldSrc's maps have no deluxemaps to give a way).
//
// THE SHADE (R_EntityDynamicLight's end, R_StudioLighting). Of the light's brightest channel, v_direct (0.9) shades
// by facing and the rest is ambient (128 at most; the two 255 at most): a vertex facing the light gets both, one
// side-on about 0.7 of the shade, one facing away the ambient alone (SHADE_LAMBERT 1.495's modified hemisphere).
// The vertex's colour is the light's colour (its channels over the brightest) times lightgamma(illum) / 255, which
// with the engine's defaults is illum / 255; unlike the world's lightmaps, no overbright doubles it.
//
// THE MAP'S LIGHT TREE (`lightTree`), for an engine that lights models as it goes (s&box): what those walks read and
// nothing else. The world's planes, nodes and leaves' contents, and its faces' lightmaps, each face's styles added up
// at their levels as the map starts. A game walks it as the engine does (the walks here are the ones to port), so a
// model's light is the engine's to the sample: a table of floors on a grid was tried first and was off by up to 86 of
// 255 at a ledge, where a column's middle stands over another floor than the model.
//
// Credit: stevenlafl's TS port to GMod (tools/map/model-light.mjs) worked this out first; skyLight is theirs.
import { faceLightmap, CONTENTS } from "../../core/maps/bsp.mjs";
import { valueOf } from "../../core/maps/entities.mjs";
import { stylePatterns } from "./light.mjs";

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const numbers = (text) => (text ?? "").trim().split(/\s+/).filter(Boolean).map(Number);
/** Half-Life's SHADE_LAMBERT. */
export const SHADE_LAMBERT = 1.495;
/** v_direct's default: the share of the light that shades by facing. */
export const DIRECT = 0.9;
/** The most ambient light a model gets. */
const AMBIENT_MOST = 128;
/** How far above the origin the light is looked for from, and how far down the floor is looked for. */
export const LIGHT_ABOVE = 8;
export const FLOOR_REACH = 2048;
/** How far toward the sun the sky is looked for. */
export const SKY_REACH = 8192;
/** How far off, on each diagonal, the floor's light is read for its gradient. */
export const GRADIENT_STEP = 16;
/** A style's level at a letter (g_lightstylevalue: "m" 264, the light as baked a little over 256). */
const LEVEL_STEP = 22;
/** A face's place in the tree's samples: one the walk passes through (a special texture: sky, liquid, a trigger),
 * and one that stops it dark (lit, but the compiler gave it no light). */
export const PASSED = -1;
export const DARK = -2;
const TEX_SPECIAL = 1;

/**
 * The sky's light, from the map's light_environment as TS's game sets sv_skycolor and sv_skyvec (reTS
 * dlls/lights.cpp CEnvLight: r g b times brightness / 255, then (c / 114)^0.6 x 264; the way it shines from its
 * angles and `pitch`): `{ rgb, vec }`, or null when the map has none. stevenlafl's.
 */
export function skyLight(bsp) {
  for (const entity of bsp.entities ?? []) {
    if (valueOf(entity, "classname") !== "light_environment") continue;
    const v = numbers(valueOf(entity, "_light"));
    let rgb = v.length === 1 ? [v[0], v[0], v[0]] : v.slice(0, 3);
    if (v.length >= 4) rgb = rgb.map((c) => Math.trunc(c * (v[3] / 255)));
    rgb = rgb.map((c) => Math.trunc((c / 114) ** 0.6 * 264));
    const angles = numbers(valueOf(entity, "angles"));
    // the keys are the game's in their order: `pitch` sets the angles' pitch (CLight::KeyValue), and an `angles` after
    // it sets it again (ts_lobby's sun is level so, though its lightmaps were baked 30 down)
    const keys = entity.map(([key]) => key);
    const pitch =
      keys.lastIndexOf("pitch") > keys.lastIndexOf("angles")
        ? Number(valueOf(entity, "pitch"))
        : (angles[0] ?? 0);
    const yaw = angles[1] ?? Number(valueOf(entity, "angle") ?? 0);
    // UTIL_MakeAimVectors turns the pitch round: -80 aims 80 down
    const p = (-pitch * Math.PI) / 180;
    const y = (yaw * Math.PI) / 180;
    const vec = [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), -Math.sin(p)];
    if (rgb.some((c) => c > 0)) return { rgb, vec };
  }
  return null;
}

/** Each style's level as the map starts (its pattern's first letter x 22: "m" 264, "a" 0). */
export function styleLevels(bsp) {
  const levels = new Map();
  for (const [style, pattern] of stylePatterns(bsp))
    levels.set(style, (pattern.charCodeAt(0) - 97) * LEVEL_STEP);
  return levels;
}

/**
 * The map's light tree (above): `{ head, planes, nodes, leaves, faces, samples, sky }`. `planes` [{ normal, dist }];
 * `nodes` [{ plane, children, firstFace, faceCount }] (a child below 0 a leaf, -1 - child); `leaves` their contents;
 * `faces` [{ s, t, originS, originT, width, height, at }], `at` the face's first sample in `samples` (r g b, its
 * styles added up: each sample times its style's level / 256, 255 at most), or PASSED, or DARK; `sky` skyLight's.
 */
export function lightTree(bsp, levels = styleLevels(bsp)) {
  const samples = [];
  const faces = bsp.faces.map((face, i) => {
    const ti = bsp.texinfo[face.texinfo];
    const lm = faceLightmap(bsp, i);
    const place = { s: ti.s.slice(0, 4), t: ti.t.slice(0, 4), originS: 0, originT: 0, width: 0, height: 0 };
    if (ti.flags & TEX_SPECIAL) return { ...place, at: PASSED };
    if (!lm) return { ...place, at: DARK };
    const at = samples.length;
    for (let k = 0; k < lm.width * lm.height * 3; k++) {
      let sum = 0;
      for (const style of lm.styles) sum += style.rgb[k] * (levels.get(style.style) ?? 12 * LEVEL_STEP);
      samples.push(Math.min(sum >> 8, 255));
    }
    return { ...place, originS: lm.originS, originT: lm.originT, width: lm.width, height: lm.height, at };
  });
  return {
    head: bsp.models[0].headNodes[0],
    planes: bsp.planes.map((p) => ({ normal: p.normal, dist: p.dist })),
    nodes: bsp.nodes.map((n) => ({ plane: n.plane, children: n.children, firstFace: n.firstFace, faceCount: n.faceCount })), // prettier-ignore
    leaves: bsp.leaves.map((l) => l.contents),
    faces,
    samples: Uint8Array.from(samples),
    sky: skyLight(bsp),
  };
}

/**
 * The light of the first face a line from `start` to `end` meets in the tree (R_RecursiveLightPoint): `{ at, rgb }`,
 * where it met it and its light, or null when it meets none. The walk a game ports.
 */
export function lightAlong(tree, start, end) {
  const walk = (node, from, to) => {
    if (node < 0) return null;
    const n = tree.nodes[node];
    const plane = tree.planes[n.plane];
    const front = dot(plane.normal, from) - plane.dist;
    const back = dot(plane.normal, to) - plane.dist;
    const side = front < 0 ? 1 : 0;
    if ((back < 0 ? 1 : 0) === side) return walk(n.children[side], from, to);
    const frac = front / (front - back);
    const mid = from.map((x, k) => x + (to[k] - x) * frac);
    const near = walk(n.children[side], from, mid);
    if (near) return near;
    for (let i = n.firstFace; i < n.firstFace + n.faceCount; i++) {
      const f = tree.faces[i];
      if (f.at === PASSED) continue;
      const ds = dot(mid, f.s) + f.s[3] - f.originS;
      const dt = dot(mid, f.t) + f.t[3] - f.originT;
      if (ds < 0 || dt < 0 || ds > (f.width - 1) * 16 || dt > (f.height - 1) * 16) continue;
      if (f.at === DARK) return { at: mid, rgb: [0, 0, 0] };
      // the nearest sample (Q_rint)
      const k = f.at + (Math.round(dt / 16) * f.width + Math.round(ds / 16)) * 3;
      return { at: mid, rgb: [tree.samples[k], tree.samples[k + 1], tree.samples[k + 2]] };
    }
    return walk(n.children[1 - side], mid, to);
  };
  return walk(tree.head, start, end);
}

/** The floor's light under a point (R_LightVec from it 2048 units down): [r, g, b], black when there is none. */
export function floorLight(tree, point) {
  return lightAlong(tree, point, [point[0], point[1], point[2] - FLOOR_REACH])?.rgb ?? [0, 0, 0];
}

/** Whether a line from `start` to `end` comes to sky before anything solid (the trace toward the sun). */
export function meetsSky(tree, start, end) {
  const walk = (node, from, to) => {
    if (node < 0) {
      const contents = tree.leaves[-1 - node];
      return contents === CONTENTS.SOLID || contents === CONTENTS.SKY ? contents : null;
    }
    const n = tree.nodes[node];
    const plane = tree.planes[n.plane];
    const front = dot(plane.normal, from) - plane.dist;
    const back = dot(plane.normal, to) - plane.dist;
    if (front >= 0 && back >= 0) return walk(n.children[0], from, to);
    if (front < 0 && back < 0) return walk(n.children[1], from, to);
    const side = front < 0 ? 1 : 0;
    const mid = from.map((x, k) => x + ((to[k] - x) * front) / (front - back));
    return walk(n.children[side], from, mid) ?? walk(n.children[1 - side], mid, to);
  };
  return walk(tree.head, start, end) === CONTENTS.SKY;
}

/**
 * A model's light at its origin (R_EntityDynamicLight): `{ rgb, way, sky }`: the sky's when a line toward the sun
 * comes to sky first, else the floor's, leant by its gradient.
 */
export function lightAt(tree, origin) {
  const from = [origin[0], origin[1], origin[2] + LIGHT_ABOVE];
  const sky = tree.sky;
  if (
    sky &&
    sky.rgb.some((c) => c > 0) &&
    meetsSky(
      tree,
      from,
      origin.map((x, k) => x - sky.vec[k] * SKY_REACH),
    )
  )
    return { rgb: sky.rgb, way: sky.vec, sky: true };
  const rgb = floorLight(tree, from);
  const g = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([gx, gy]) => {
    const near = floorLight(tree, [from[0] + gx * GRADIENT_STEP, from[1] + gy * GRADIENT_STEP, from[2]]);
    return (near[0] + near[1] + near[2]) / 768;
  });
  const way = [g[0] - g[1] - g[2] + g[3], g[1] + g[0] - g[2] - g[3], -1];
  const length = Math.hypot(...way);
  return { rgb, way: way.map((v) => v / length), sky: false };
}

/**
 * How a model is shaded under a light (R_EntityDynamicLight's end): `{ color, ambient, shade, way }`: the light's
 * colour (over its brightest channel), its ambient and its shade (0 to 255), and its way.
 */
export function modelShade({ rgb, way }, { direct = DIRECT } = {}) {
  const total = Math.max(...rgb) || 1;
  let shade = total * direct;
  const ambient = Math.min(total - shade, AMBIENT_MOST);
  if (ambient + shade > 255) shade = 255 - ambient;
  const most = Math.max(...rgb);
  const color = most > 0 ? rgb.map((c) => c / most) : [1, 1, 1];
  return { color, ambient, shade, way };
}

/** A vertex's light, 0 to 1 a channel, by its normal (R_StudioLighting, lightgamma at the engine's defaults). */
export function vertexLight({ color, ambient, shade, way }, normal) {
  const lightcos = Math.min(dot(normal, way), 1);
  let illum = ambient + shade;
  const cos = (lightcos + (SHADE_LAMBERT - 1)) / SHADE_LAMBERT;
  if (cos > 0) illum -= shade * cos;
  illum = Math.min(Math.max(illum, 0), 255);
  return color.map((c) => (c * illum) / 255);
}

/**
 * A light tree as bytes, little-endian: "SMLT", version 1; the head node and the counts of planes, nodes, leaves,
 * faces and sample bytes (ints); the sky's r g b and way x y z (floats, all 0 with no sky light); then each plane (its
 * normal and dist, 4 floats), each node (plane, front, back, first face, face count: 5 ints), each leaf's contents (an
 * int), each face (s and t, 4 floats each, originS, originT as floats, width, height and its first sample, ints), and
 * the samples.
 */
export function lightTreeBytes(tree) {
  const size = 4 + 4 * 7 + 4 * 6 + tree.planes.length * 16 + tree.nodes.length * 20 + tree.leaves.length * 4 + tree.faces.length * 52 + tree.samples.length; // prettier-ignore
  const out = Buffer.alloc(size);
  out.write("SMLT", 0, "latin1");
  let at = 4;
  const int = (v) => (out.writeInt32LE(v, at), (at += 4));
  const float = (v) => (out.writeFloatLE(v, at), (at += 4));
  int(1);
  int(tree.head);
  int(tree.planes.length);
  int(tree.nodes.length);
  int(tree.leaves.length);
  int(tree.faces.length);
  int(tree.samples.length);
  for (const v of tree.sky?.rgb ?? [0, 0, 0]) float(v);
  for (const v of tree.sky?.vec ?? [0, 0, 0]) float(v);
  for (const p of tree.planes) [...p.normal, p.dist].forEach(float);
  for (const n of tree.nodes) [n.plane, ...n.children, n.firstFace, n.faceCount].forEach(int);
  for (const c of tree.leaves) int(c);
  for (const f of tree.faces) {
    [...f.s, ...f.t, f.originS, f.originT].forEach(float);
    [f.width, f.height, f.at].forEach(int);
  }
  out.set(tree.samples, at);
  return out;
}
