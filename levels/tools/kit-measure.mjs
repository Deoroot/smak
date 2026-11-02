#!/usr/bin/env node
// kit-measure: measures a modular art kit (a folder of .glb pieces) so a level builder can snap its pieces on a
// grid. Generic: it knows no kit by name; the roles come from common words in piece names and from shape.
//
//   node levels/tools/kit-measure.mjs --glb <dir> [--root <kit dir>] [--manifest prefabs.json] [--materials materials.json]
//        [--layout a.layout.json ...] [--module <m>] --out kit.json
//
//   --glb        a folder searched for .glb files (each one piece, its transform baked, glTF metres +y up)
//   --root       the kit folder that the manifest's paths start from (needed to read collision meshes)
//   --manifest   optional: prefabs.json of a "portable Unity export" (nodes, colliders, materials per prefab;
//                Unity axes); joined to a .glb by its path with the extension changed, else by its name
//   --materials  optional: materials.json of the same export (pbr.alpha, pbr.doubleSided)
//   --layout     optional, repeatable: a scene's layout.json (instances: prefab, position, rotation, scale in
//                Unity axes) whose snapping is studied
//   --module     force the grid module in metres instead of finding it
//
// Axes written: s&box's, Z up. +X forward = glTF +Z = Unity +Z; +Y left = glTF +X = Unity -X; +Z up = glTF +Y =
// Unity +Y (Unity is left-handed, so this is a mirror of Unity and a turn of glTF). A Unity yaw of a degrees
// about +Y is an s&box yaw of -a about +Z. Inches = metres x 39.3701.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { readGlb } = await import(pathToFileURL(path.resolve(here, "../../src/glb.mjs")).href);
const { readFbx } = await import(pathToFileURL(path.resolve(here, "../../src/fbx.mjs")).href);

const IN = 39.3701;
const r3 = (x) => Math.round(x * 1000) / 1000;
const r2 = (x) => Math.round(x * 100) / 100;
const inch = (x) => Math.round(x * IN * 10) / 10;

// ── arguments
const args = { layout: [] };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const key = a.slice(2);
  const value = process.argv[++i];
  if (key === "layout") args.layout.push(value);
  else args[key] = value;
}
if (!args.glb || !args.out) {
  console.error("usage: kit-measure --glb <dir> [--manifest prefabs.json] [--materials materials.json] [--layout x.layout.json ...] [--module m] --out kit.json");
  process.exit(2);
}
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const manifest = args.manifest ? readJson(args.manifest).prefabs ?? {} : {};
const materialsInfo = args.materials ? readJson(args.materials).materials ?? {} : {};

// ── Unity <-> s&box
/** A Unity vector in s&box axes. */
const fromUnity = ([x, y, z]) => [z, -x, y];
function quatRotate([qx, qy, qz, qw], [x, y, z]) {
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}
const quatMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const quatInv = ([x, y, z, w]) => [-x, -y, -z, w];
/** Yaw in Unity degrees about +Y if the turn is about the vertical only, else null. */
function unityYaw(q) {
  const up = quatRotate(q, [0, 1, 0]);
  if (up[1] < 0.999) return null;
  const f = quatRotate(q, [0, 0, 1]);
  return (Math.atan2(f[0], f[2]) * 180) / Math.PI;
}

// ── files
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.glb$/i.test(e.name)) out.push(p);
  }
  return out;
}
/** The JSON chunk of a .glb, for what readGlb leaves out (alphaMode, doubleSided). */
function glbJson(buf) {
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString("utf8"));
}
const manifestKeys = Object.keys(manifest);
const manifestByBase = new Map();
for (const k of manifestKeys) manifestByBase.set(path.basename(k).replace(/\.[^.]+$/, "").toLowerCase(), k);
function manifestOf(rel) {
  const noExt = rel.replace(/\\/g, "/").replace(/\.glb$/i, "").toLowerCase();
  const exact = manifestKeys.find((k) => noExt.endsWith(k.replace(/\.[^.]+$/, "").toLowerCase()));
  return exact ?? manifestByBase.get(path.basename(noExt)) ?? null;
}

// ── geometry helpers
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

/** Every triangle as { a, b, c, n (unit), area, see (false for see-through) }. */
function trianglesOf(read, seeThrough) {
  const tris = [];
  for (const g of read.groups) {
    const see = !seeThrough.has(g.material);
    for (const t of g.tris) {
      const [a, b, c] = t.map((k) => k.p);
      const cr = cross(sub(b, a), sub(c, a));
      const l = len(cr);
      if (l < 1e-12) continue;
      tris.push({ a, b, c, n: [cr[0] / l, cr[1] / l, cr[2] / l], area: l / 2, see, node: t[0].node });
    }
  }
  return tris;
}
function boundsOf(tris, filter = () => true) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) if (filter(t)) for (const p of [t.a, t.b, t.c]) for (let k = 0; k < 3; k++) {
    if (p[k] < mn[k]) mn[k] = p[k];
    if (p[k] > mx[k]) mx[k] = p[k];
  }
  return { mn, mx };
}
const dot2 = (p, d) => p[0] * d[0] + p[1] * d[1];
/**
 * The way a wall faces: the horizontal direction most of its upright faces point along (area-weighted, folded
 * to 0..180 degrees). Snapped to the axes when within 2 degrees. { angle, normal: [x, y], along: [x, y], share }.
 */
function facingOf(tris) {
  const bins = new Float64Array(180);
  let total = 0;
  for (const t of tris) {
    if (!t.see || Math.abs(t.n[2]) > 0.3) continue;
    let a = (Math.atan2(t.n[1], t.n[0]) * 180) / Math.PI;
    a = ((Math.round(a) % 180) + 180) % 180;
    bins[a] += t.area;
    total += t.area;
  }
  let best = 0, bestV = -1;
  for (let a = 0; a < 180; a++) {
    const v = bins[(a + 179) % 180] + bins[a] + bins[(a + 1) % 180];
    if (v > bestV) { bestV = v; best = a; }
  }
  if (best <= 2 || best >= 178) best = 0;
  else if (Math.abs(best - 90) <= 2) best = 90;
  const r = (best * Math.PI) / 180;
  const normal = [Math.cos(r), Math.sin(r)].map((v) => (Math.abs(v) < 1e-9 ? 0 : v));
  return { angle: best, normal, along: [-normal[1], normal[0]], share: total ? bestV / total : 0 };
}
/** Area of faces facing +d and -d (a horizontal direction), by their place along d (binned to `bin` metres). */
function planes(tris, d, bin = 0.005) {
  const pos = new Map(), neg = new Map();
  for (const t of tris) {
    if (!t.see) continue;
    const c = dot2(t.n, d);
    if (Math.abs(c) < 0.95) continue;
    const at = Math.round(((dot2(t.a, d) + dot2(t.b, d) + dot2(t.c, d)) / 3) / bin) * bin;
    const m = c > 0 ? pos : neg;
    m.set(at, (m.get(at) ?? 0) + t.area);
  }
  const best = (m) => [...m.entries()].sort((x, y) => y[1] - x[1]);
  return { pos: best(pos), neg: best(neg) };
}
function rangeAlong(tris, d, filter = () => true) {
  let mn = Infinity, mx = -Infinity;
  for (const t of tris) if (filter(t)) for (const p of [t.a, t.b, t.c]) { const v = dot2(p, d); if (v < mn) mn = v; if (v > mx) mx = v; }
  return [mn, mx];
}

/** The middle of a hole, in the piece's axes. */
function centreOf(h, face, depth) {
  const u = (h.from + h.to) / 2, z = (h.sill + h.top) / 2;
  return [face.along[0] * u + face.normal[0] * depth, face.along[1] * u + face.normal[1] * depth, z].map(r3);
}
/** Is a point inside a convex hull given as triangles (any winding)? */
function insideHull(tris, p) {
  if (!tris.length) return false;
  let c = [0, 0, 0], n = 0;
  for (const t of tris) for (const q of t) { c[0] += q[0]; c[1] += q[1]; c[2] += q[2]; n++; }
  c = c.map((v) => v / n);
  for (const [a, b, d] of tris) {
    let nn = cross(sub(b, a), sub(d, a));
    const l = len(nn);
    if (l < 1e-12) continue;
    nn = nn.map((v) => v / l);
    const side = (q) => (q[0] - a[0]) * nn[0] + (q[1] - a[1]) * nn[1] + (q[2] - a[2]) * nn[2];
    const sc = side(c), sp = side(p);
    if (Math.abs(sc) < 1e-9) continue;
    if (Math.sign(sp) !== Math.sign(sc) && Math.abs(sp) > 0.01) return false;
  }
  return true;
}
const hullCache = new Map();
/** A collision mesh file's triangles in metres, s&box axes (as readFbx turns them); null if it cannot be read. */
function hullOf(file) {
  if (hullCache.has(file)) return hullCache.get(file);
  let out = null;
  try {
    const r = readFbx(fs.readFileSync(file));
    const m = r.unit?.metres ?? 1;
    out = r.groups.flatMap((g) => g.tris.map((t) => t.map((k) => k.p.map((v) => v * m))));
  } catch { out = null; }
  hullCache.set(file, out);
  return out;
}

/** Holes in a wall: the triangles laid flat on the wall's face (u along `along`, z up), empty cells joined. */
function openings(tris, along, box, cell = 0.05) {
  const [u0, u1] = rangeAlong(tris, along);
  const z0 = box.mn[2];
  const W = Math.max(1, Math.ceil((u1 - u0) / cell)), H = Math.max(1, Math.ceil((box.mx[2] - z0) / cell));
  if (W * H > 4e6) return [];
  const full = new Uint8Array(W * H);
  for (const t of tris) {
    if (!t.see) continue;
    const P = [t.a, t.b, t.c].map((p) => [(dot2(p, along) - u0) / cell, (p[2] - z0) / cell]);
    const area2 = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
    if (Math.abs(area2) < 1e-6) continue;
    const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      let inside = true, sign = 0;
      for (let k = 0; k < 3; k++) {
        const A = P[k], B = P[(k + 1) % 3];
        const s = (B[0] - A[0]) * (py - A[1]) - (B[1] - A[1]) * (px - A[0]);
        if (Math.abs(s) < 1e-9) continue;
        if (sign === 0) sign = Math.sign(s);
        else if (Math.sign(s) !== sign) { inside = false; break; }
      }
      if (inside) full[y * W + x] = 1;
    }
  }
  const seen = new Uint8Array(W * H), found = [];
  for (let s = 0; s < W * H; s++) {
    if (full[s] || seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    let n = 0, xa = W, xb = -1, ya = H, yb = -1;
    while (stack.length) {
      const c = stack.pop(), x = c % W, y = (c / W) | 0;
      n++;
      xa = Math.min(xa, x); xb = Math.max(xb, x); ya = Math.min(ya, y); yb = Math.max(yb, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nc = ny * W + nx;
        if (!full[nc] && !seen[nc]) { seen[nc] = 1; stack.push(nc); }
      }
    }
    const touchesSide = xa === 0 || xb === W - 1, touchesTop = yb === H - 1;
    const areaM = n * cell * cell;
    if (touchesSide || touchesTop || areaM < 0.08) continue;
    const width = (xb - xa + 1) * cell, height = (yb - ya + 1) * cell;
    if (width < 0.4 || height < 0.7) continue;
    found.push({
      width: r2(width), height: r2(height), sill: r2(ya * cell), top: r2((yb + 1) * cell),
      from: r2(u0 + xa * cell), to: r2(u0 + (xb + 1) * cell),
      fill: r2(n / ((xb - xa + 1) * (yb - ya + 1))),
      kind: ya === 0 ? "door" : "window",
    });
  }
  return found.sort((a, b) => b.width * b.height - a.width * a.height);
}

/** Stair treads: up-facing area by height (levels closer than 5 cm joined); every level from the foot up is a step. */
function stairOf(tris, box) {
  const by = new Map();
  for (const t of tris) {
    if (!t.see || t.n[2] < 0.95) continue;
    const z = Math.round(((t.a[2] + t.b[2] + t.c[2]) / 3) / 0.01) * 0.01;
    const e = by.get(z) ?? { area: 0, tris: [] };
    e.area += t.area; e.tris.push(t);
    by.set(z, e);
  }
  const total = [...by.values()].reduce((s, e) => s + e.area, 0);
  let levels = [...by.entries()].filter(([z, e]) => e.area > total * 0.005 && z > box.mn[2] + 0.05).map(([z, e]) => ({ z, area: e.area, tris: e.tris })).sort((a, b) => a.z - b.z);
  const joined = [];
  for (const l of levels) {
    const last = joined[joined.length - 1];
    if (last && l.z - last.z < 0.05) { last.tris.push(...l.tris); last.z = Math.max(last.z, l.z); last.area += l.area; }
    else joined.push({ ...l, tris: [...l.tris] });
  }
  levels = joined;
  if (levels.length < 3) return { treads: levels.length, levels: levels.map((l) => r3(l.z)), note: "too few treads found" };
  // the foot: one middle rise below the lowest tread (a stair may reach down below its floor, through the slab)
  const gaps = levels.slice(1).map((l, i) => l.z - levels[i].z).sort((a, b) => a - b);
  const foot = Math.max(box.mn[2], levels[0].z - gaps[gaps.length >> 1]);
  const zs = [foot, ...levels.map((l) => l.z)];
  const rises = zs.slice(1).map((z, i) => z - zs[i]);
  const top = levels[levels.length - 1].z;
  const meanRise = (top - foot) / levels.length;
  const mid = (l) => { let x = 0, y = 0, a = 0; for (const t of l.tris) { const w = t.area; x += ((t.a[0] + t.b[0] + t.c[0]) / 3) * w; y += ((t.a[1] + t.b[1] + t.c[1]) / 3) * w; a += w; } return [x / a, y / a]; };
  const mids = levels.map(mid);
  const runs = mids.slice(1).map((m, i) => Math.hypot(m[0] - mids[i][0], m[1] - mids[i][1])).sort((a, b) => a - b);
  const run = runs[runs.length >> 1];
  const span = [mids[mids.length - 1][0] - mids[0][0], mids[mids.length - 1][1] - mids[0][1]];
  const axis = Math.abs(span[0]) >= Math.abs(span[1]) ? 0 : 1;
  const straightRun = Math.abs(span[axis]) / (levels.length - 1);
  const turns = straightRun < run * 0.6;
  const widths = levels.map((l) => {
    const e = [0, 1].map((k) => { let mn = Infinity, mx = -Infinity; for (const t of l.tris) for (const p of [t.a, t.b, t.c]) { mn = Math.min(mn, p[k]); mx = Math.max(mx, p[k]); } return mx - mn; });
    return Math.max(...e);
  }).sort((a, b) => a - b);
  const sortedR = [...rises].sort((a, b) => a - b);
  return {
    steps: levels.length,
    risePerStep: r3(meanRise),
    risePerStepIn: inch(meanRise),
    riseRange: [r3(sortedR[0]), r3(sortedR[sortedR.length - 1])],
    regular: sortedR[sortedR.length - 1] - sortedR[0] <= 0.02,
    runPerStep: r3(run),
    runPerStepIn: inch(run),
    pitchDegrees: Math.round((Math.atan2(meanRise, run || 1e-9) * 180) / Math.PI),
    treadWidth: r3(widths[widths.length >> 1]),
    flightRise: r3(top - foot),
    flightRiseIn: inch(top - foot),
    foot: r3(foot),
    belowFoot: r3(foot - box.mn[2]),
    aboveTopTread: r3(box.mx[2] - top),
    climbs: turns ? "turns (more than one flight, or a winding stair)" : (span[axis] > 0 ? "+" : "-") + "XY"[axis],
    levels: levels.map((l) => r3(l.z)),
  };
}

// ── roles from names and shape
// A name is cut into words (at _, -, spaces and CamelCase; numbers dropped) and each rule names words that must
// all be there (any one of each list). First match wins, so the order matters.
const ROLE_WORDS = [
  ["decal", [["decal", "tyremarks", "splatter", "stain", "crack", "puddle", "graffiti"]]],
  ["fx", [["fx", "particle", "lightray", "spark"]]],
  ["character", [["chr", "character"]]],
  ["weapon", [["wep", "weapon"]]],
  ["skybox", [["sky", "skydome", "skyline", "cloud", "clouds"]]],
  ["wall-door", [["wall", "walls", "facade", "rockwall"], ["door", "doorway", "archway", "arch"]]],
  ["wall-gate", [["wall", "walls", "rockwall"], ["gate", "gateway"]]],
  ["wall-window", [["wall", "walls", "facade"], ["window", "slit"]]],
  ["stair", [["stair", "stairs", "steps", "step", "staircase", "ladder", "stairwell"]]],
  ["roof", [["roof", "spire", "thatch"]]],
  ["ceiling", [["ceiling"]]],
  ["foundation", [["foundation", "plinth"]]],
  ["pillar", [["pillar", "column", "post", "pole", "flagpole"]]],
  ["beam", [["beam", "rafter", "beams"]]],
  ["gate", [["gate", "portcullis"]]],
  ["door", [["door", "trapdoor", "doors"]]],
  ["window", [["window", "arrowslit", "slit", "shutter"]]],
  ["battlement", [["battlement", "crenel", "merlon", "parapet"]]],
  ["tower", [["tower", "turret", "towerbase"]]],
  ["chimney", [["chimney"]]],
  ["room", [["room", "roomtall", "roomtop", "house", "hut", "extension", "leanto", "tent", "building", "shack", "cabin"]]],
  ["bridge", [["bridge"]]],
  ["pipe", [["pipe"]]],
  ["rock", [["rock", "rocks", "cliff", "mountain", "mountains", "boulder", "pebbles", "pebble", "rockpile", "mountaingrass", "mountainsnow", "hill"]]],
  ["ground", [["ground", "terrain", "path", "road", "dirt", "mud", "cobble", "sidewalk", "tile", "water", "river", "lake", "canal"]]],
  ["floor", [["floor", "platform", "deck"]]],
  ["corner", [["corner"]]],
  ["wall", [["wall", "fence", "railing", "barrier", "palisade", "rockwall"]]],
  ["nature", [["tree", "bush", "grass", "plant", "flower", "flowers", "fern", "mushroom", "vine", "ivy", "log", "stump", "leaf", "leaves", "hedge", "reed", "reeds", "crop", "crops", "branch", "shrub", "cactus", "pine", "lilypads", "lilypad"]]],
];
/** Roles a piece in a props folder may still take from its name; others become "prop". */
const PROP_FOLDER_KEEPS = new Set(["wall", "door", "gate", "stair", "bridge", "fx", "decal", "nature", "rock"]);
const STRUCTURAL = new Set(["wall", "wall-door", "wall-window", "wall-gate", "corner", "floor", "ceiling", "foundation", "stair", "roof", "pillar", "beam", "battlement", "tower", "room", "gate", "door", "window"]);
function wordsOf(name) {
  return name
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[_\-\s.]+/)
    .filter((w) => w && !/^\d+$/.test(w));
}
function roleOf(name, category, size) {
  const words = new Set([...wordsOf(name), ...name.toLowerCase().split(/[_\-\s.]+/)]);
  const cat = category.toLowerCase();
  let role = null, from = null;
  if (/character/.test(cat)) { role = "character"; from = "folder"; }
  else if (/weapon/.test(cat)) { role = "weapon"; from = "folder"; }
  else if (/(^|\/)fx$/.test(cat)) { role = "fx"; from = "folder"; }
  if (!role) for (const [r, lists] of ROLE_WORDS) if (lists.every((l) => l.some((w) => words.has(w)))) { role = r; from = "name"; break; }
  if (role && /(^|\/)props?(\/|$)/.test(cat) && !PROP_FOLDER_KEEPS.has(role)) { role = "prop"; from = "folder"; }
  if (!role && /prop/.test(cat)) { role = "prop"; from = "folder"; }
  if (!role && /environment/.test(cat)) { role = "nature"; from = "folder"; }
  const [sx, sy, sz] = size;
  const thin = Math.min(sx, sy), long = Math.max(sx, sy);
  const shape = {
    wallish: thin < 0.6 && long > 0.9 && sz > 1.5 && long / thin > 3,
    flat: sz < 0.35 && long > 0.9,
    tall: sz > 2.5 * Math.max(long, 0.1) && long < 2.5,
    big: long > 6 || sz > 6,
  };
  if (!role) {
    if (shape.wallish) { role = "wall"; from = "shape"; }
    else if (shape.flat) { role = "floor"; from = "shape"; }
    else { role = "prop"; from = "shape"; }
  }
  // confidence: the name and the shape agree (high), only a name (medium), only a folder or a shape (low)
  let confidence = from === "name" ? "medium" : from === "folder" ? "medium" : "low";
  const agrees = {
    wall: shape.wallish, "wall-door": shape.wallish, "wall-window": shape.wallish, "wall-gate": long > 2,
    floor: shape.flat, ceiling: shape.flat, pillar: shape.tall, door: thin < 0.5 && sz > 1.5,
    stair: true, roof: true, tower: sz > 4, character: true, weapon: true,
  };
  if (from === "name" && agrees[role] === true) confidence = "high";
  if (from === "name" && agrees[role] === false) confidence = "low";
  if (from === "folder" && ["character", "weapon", "fx"].includes(role)) confidence = "high";
  if (role === "floor" && from === "name" && shape.flat) confidence = "high";
  let note;
  if ((role === "door" || role === "window") && (thin > 0.5 || long > 1.8) && sz > 1.8) {
    confidence = "low";
    note = "bigger than a leaf or a frame: probably a facade or room section carrying the opening";
  }
  if (role === "room" && from === "name") note = "a whole building block, not a modular wall set";
  return { role, confidence, from, shape, note };
}

/** Where the origin lies in the box, per axis: 0 = min, 0.5 = centre, 1 = max (within 6 % or 3 cm). */
function pivotOf(box) {
  const size = [0, 1, 2].map((k) => box.mx[k] - box.mn[k]);
  const f = [0, 1, 2].map((k) => (size[k] < 1e-6 ? 0.5 : (0 - box.mn[k]) / size[k]));
  const word = (k, lo, mid, hi) => {
    const tol = Math.max(0.06, size[k] > 1e-6 ? 0.03 / size[k] : 1);
    const v = f[k];
    return Math.abs(v) <= tol ? lo : Math.abs(v - 0.5) <= tol ? mid : Math.abs(v - 1) <= tol ? hi : v < 0 ? `beyond-${lo}` : v > 1 ? `beyond-${hi}` : "off";
  };
  const wx = word(0, "back", "mid", "front"), wy = word(1, "right", "mid", "left"), wz = word(2, "bottom", "middle", "top");
  const ok = (w) => ["back", "front", "right", "left", "mid"].includes(w);
  let horiz;
  if (wx === "mid" && wy === "mid") horiz = "centre";
  else if (ok(wx) && ok(wy) && wx !== "mid" && wy !== "mid") horiz = `corner ${wx}-${wy}`;
  else if (ok(wx) && ok(wy)) horiz = `edge-middle ${wx === "mid" ? wy : wx}`;
  else horiz = "off-box";
  return { label: `${horiz}, ${wz}`, horizontal: horiz, vertical: wz, frac: f.map(r2) };
}

// ── measure every piece
const files = walk(path.resolve(args.glb)).sort();
const pieces = [];
let failed = 0;
for (const file of files) {
  const rel = path.relative(path.resolve(args.glb), file).replace(/\\/g, "/");
  const name = path.basename(file, path.extname(file));
  const category = path.dirname(rel);
  const buf = fs.readFileSync(file);
  let read, json;
  try { read = readGlb(buf); json = glbJson(buf); } catch (e) { failed++; pieces.push({ id: name, file: rel, error: String(e.message ?? e) }); continue; }
  const seeThrough = new Set();
  for (const m of json.materials ?? []) {
    const mi = materialsInfo[m.name];
    if (m.alphaMode === "BLEND" || mi?.pbr?.alpha === "blend" || /glass/i.test(m.name ?? "")) seeThrough.add(m.name);
  }
  const doubleSidedMats = (json.materials ?? []).filter((m) => m.doubleSided || materialsInfo[m.name]?.pbr?.doubleSided).map((m) => m.name);
  const tris = trianglesOf(read, seeThrough);
  if (!tris.length) { pieces.push({ id: name, file: rel, category, empty: true, role: "empty", confidence: "high" }); continue; }
  const box = boundsOf(tris);
  const size = [0, 1, 2].map((k) => box.mx[k] - box.mn[k]);
  const pivot = pivotOf(box);
  const guess = roleOf(name, category, size);
  const piece = {
    id: name,
    file: rel,
    category,
    role: guess.role,
    confidence: guess.confidence,
    roleFrom: guess.from,
    ...(guess.note ? { roleNote: guess.note } : {}),
    triangles: tris.length,
    nodes: read.nodes.length,
    bounds: { min: box.mn.map(r3), max: box.mx.map(r3), size: size.map(r3), sizeIn: size.map(inch) },
    pivot,
    footprint: { x: r3(size[0]), y: r3(size[1]), area: r2(size[0] * size[1]), xIn: inch(size[0]), yIn: inch(size[1]) },
  };
  if (doubleSidedMats.length) piece.doubleSidedMaterials = doubleSidedMats;
  if (seeThrough.size) piece.seeThroughMaterials = [...seeThrough];

  // walls: the face planes give length, thickness and whether it is a single sheet
  const wallLike = ["wall", "wall-door", "wall-window", "wall-gate", "battlement"].includes(piece.role) || (guess.shape.wallish && STRUCTURAL.has(piece.role));
  // a flat sheet (a floor or ceiling plane with no thickness): which way it can be seen from
  if (size[2] < 0.02) {
    let up = 0, down = 0;
    for (const t of tris) { if (t.n[2] > 0.9) up += t.area; else if (t.n[2] < -0.9) down += t.area; }
    piece.sheet = { seenFrom: up && down ? "both sides" : up ? "above only" : down ? "below only" : "edge", upArea: r2(up), downArea: r2(down) };
  }
  let face_ = null;
  if (wallLike) {
    const face = facingOf(tris);
    const pl = planes(tris, face.normal);
    const front = pl.pos[0], back = pl.neg[0];
    let thickness = null;
    if (front && back) thickness = Math.abs(front[0] - back[0]);
    const sides = front && back ? (thickness < 0.01 ? "sheet, faces both ways" : "two faces") : front || back ? "one face only (a single sheet seen from one side)" : "no flat faces";
    // length: the extent of the faces in the two main planes, without trims that stick out
    const onFace = (t) => t.see && Math.abs(dot2(t.n, face.normal)) > 0.95 && [front?.[0], back?.[0]].some((v) => v !== undefined && Math.abs((dot2(t.a, face.normal) + dot2(t.b, face.normal) + dot2(t.c, face.normal)) / 3 - v) < 0.01);
    let [f0, f1] = rangeAlong(tris, face.along, onFace);
    if (!Number.isFinite(f0)) [f0, f1] = rangeAlong(tris, face.along);
    const [b0, b1] = rangeAlong(tris, face.along);
    const [t0, t1] = rangeAlong(tris, face.normal);
    const axisName = face.angle === 0 ? "Y" : face.angle === 90 ? "X" : `${(face.angle + 90) % 180} deg from +X`;
    piece.wall = {
      runs: axisName,
      facing: face.angle === 0 ? "X" : face.angle === 90 ? "Y" : `${face.angle} deg from +X`,
      facingShare: r2(face.share),
      straight: face.share > 0.5,
      length: r3(f1 - f0),
      lengthIn: inch(f1 - f0),
      lengthBounds: r3(b1 - b0),
      from: r3(f0),
      to: r3(f1),
      height: r3(size[2]),
      heightIn: inch(size[2]),
      thickness: thickness === null ? null : r3(thickness),
      thicknessIn: thickness === null ? null : inch(thickness),
      thicknessBounds: r3(t1 - t0),
      faces: { front: front ? r3(front[0]) : null, back: back ? r3(back[0]) : null },
      sides,
    };
    if (piece.role !== "battlement") {
      const holes = openings(tris, face.along, box);
      if (holes.length) { piece.openings = holes.map((h) => ({ ...h, centre: centreOf(h, face, (t0 + t1) / 2) })); face_ = face; }
    }
  }
  if (!piece.openings && (["door", "gate", "window", "tower", "wall-door", "wall-gate", "wall-window"].includes(piece.role) || /arch/i.test(name))) {
    let face = facingOf(tris);
    let holes = openings(tris, face.along, box);
    if (!holes.length) {
      // the other way: rough pieces (rock, timber) may face mostly sideways
      const turned = { angle: (face.angle + 90) % 180, normal: face.along.map((v) => -v), along: face.normal, share: 0 };
      turned.normal = [-face.along[0], -face.along[1]];
      turned.along = [-turned.normal[1], turned.normal[0]];
      const other = openings(tris, turned.along, box);
      if (other.length) { face = turned; holes = other; }
    }
    if (holes.length) face_ = face;
    const [t0, t1] = rangeAlong(tris, face.normal);
    if (holes.length) piece.openings = holes.map((h) => ({ ...h, centre: centreOf(h, face, (t0 + t1) / 2), along: face.angle === 0 ? "Y" : face.angle === 90 ? "X" : `${(face.angle + 90) % 180} deg` }));
  }
  if (piece.role === "stair" || /stair|steps/i.test(name)) piece.stair = stairOf(tris, box);

  // the manifest: colliders, materials, child nodes
  const mk = manifestOf(rel);
  if (mk) {
    const pf = manifest[mk];
    piece.prefab = mk;
    const cols = [];
    // world transform of each node, by path
    const world = new Map();
    for (const n of pf.nodes) {
      const parentPath = n.path.includes("/") ? n.path.slice(0, n.path.lastIndexOf("/")) : n.path === "" ? null : "";
      const parent = parentPath === null ? { p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } : world.get(parentPath) ?? { p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
      const lp = n.position.map((v, k) => v * parent.s[k]);
      const p = quatRotate(parent.q, lp).map((v, k) => v + parent.p[k]);
      world.set(n.path, { p, q: quatMul(parent.q, n.rotation), s: n.scale.map((v, k) => v * parent.s[k]) });
    }
    for (const n of pf.nodes) for (const c of n.colliders ?? []) {
      const w = world.get(n.path);
      const e = { type: c.type, node: n.path || "(root)" };
      if (c.convex !== undefined) e.convex = c.convex;
      if (c.trigger) e.trigger = true;
      if (c.type === "box") {
        const centre = quatRotate(w.q, c.center.map((v, k) => v * w.s[k])).map((v, k) => v + w.p[k]);
        const half = c.size.map((v, k) => (v * w.s[k]) / 2);
        const ext = [0, 1, 2].map((k) => {
          const ax = [0, 0, 0]; ax[k] = 1;
          const d = quatRotate(w.q, ax);
          return d;
        });
        const he = [0, 1, 2].map((j) => Math.abs(ext[0][j]) * half[0] + Math.abs(ext[1][j]) * half[1] + Math.abs(ext[2][j]) * half[2]);
        const sc = fromUnity(centre), ss = fromUnity(he).map((v) => Math.abs(v) * 2);
        e.center = sc.map(r3); e.size = ss.map(r3); e.sizeIn = ss.map(inch);
      }
      if (c.type === "mesh") e.mesh = c.mesh?.name;
      if (c.type === "sphere") e.radius = c.radius;
      if (c.type === "capsule") { e.radius = c.radius; e.height = c.height; }
      cols.push(e);
    }
    piece.colliders = cols;
    if (!cols.length) piece.noCollider = true;
    const comps = pf.nodes.flatMap((n) => n.components ?? []);
    if (comps.length) piece.components = [...new Set(comps.map((c) => (typeof c === "string" ? c : c.type)))];
    piece.materials = [...new Set(pf.nodes.flatMap((n) => n.materials ?? []))];
    // does a collider fill a hole? boxes are tested directly; mesh colliders by reading their collision files
    // (several colliders that name the same file are taken to be that file and its numbered siblings: "X", "X 1", ...)
    if (piece.openings?.length && cols.length) {
      const kitRoot = args.root ? path.resolve(args.root) : null;
      const meshCols = pf.nodes.flatMap((n) => (n.colliders ?? []).filter((c) => c.type === "mesh" && c.mesh?.file));
      const convexFiles = [], solidFiles = [];
      if (kitRoot && meshCols.length) {
        const named = meshCols.map((c) => c.mesh.file);
        const distinct = [...new Set(named)];
        if (distinct.length < named.length) piece.colliderManifestRepeats = true;
        for (const d of distinct) {
          const convex = meshCols.find((c) => c.mesh.file === d).convex;
          const list = convex ? convexFiles : solidFiles;
          if (!piece.colliderManifestRepeats) { list.push(path.join(kitRoot, d)); continue; }
          const dir = path.join(kitRoot, path.dirname(d));
          const stem = path.basename(d).replace(/.[^.]+$/, "").replace(/ d+$/, "");
          if (fs.existsSync(dir)) for (const e of fs.readdirSync(dir)) {
            const st = e.replace(/.[^.]+$/, "");
            const numbered = st.startsWith(stem + " ") && /^d+$/.test(st.slice(stem.length + 1));
            if (st === stem || numbered) list.push(path.join(dir, e));
          }
        }
      }
      for (const o of piece.openings) {
        const boxes = cols.filter((c) => c.type === "box");
        const byBox = boxes.some((c) => [0, 1, 2].every((k) => Math.abs(o.centre[k] - c.center[k]) <= c.size[k] / 2 + 0.01));
        const hullsIn = [];
        for (const mf of [...new Set(convexFiles)]) { const h = hullOf(mf); if (h && insideHull(h, o.centre)) hullsIn.push(path.basename(mf)); }
        // a non-convex collision mesh: does any of its triangles, seen along the wall's normal, cover the middle?
        let solidCovers = null;
        if (solidFiles.length && face_) {
          solidCovers = false;
          const u = dot2(o.centre, face_.along), z = o.centre[2];
          for (const mf of solidFiles) {
            const h = hullOf(mf);
            if (!h) { solidCovers = null; break; }
            for (const t of h) {
              const P = t.map((p) => [dot2(p, face_.along), p[2]]);
              const d1 = (P[1][0] - P[0][0]) * (z - P[0][1]) - (P[1][1] - P[0][1]) * (u - P[0][0]);
              const d2 = (P[2][0] - P[1][0]) * (z - P[1][1]) - (P[2][1] - P[1][1]) * (u - P[1][0]);
              const d3 = (P[0][0] - P[2][0]) * (z - P[2][1]) - (P[0][1] - P[2][1]) * (u - P[2][0]);
              const area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
              if (Math.abs(area) < 1e-8) continue;
              if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) { solidCovers = true; break; }
            }
            if (solidCovers) break;
          }
        }
        const meshKnown = convexFiles.length + solidFiles.length > 0;
        o.collider = byBox ? "closed by a box collider"
          : hullsIn.length && piece.colliderManifestRepeats ? `maybe closed: hull ${hullsIn.join(", ")} covers it, but the manifest names one file for several colliders, so which hulls the prefab uses is not known`
          : hullsIn.length ? `closed by convex hull ${hullsIn.join(", ")}`
          : solidCovers === true ? "closed by the collision mesh"
          : solidCovers === false && !convexFiles.length ? "open (the collision mesh has the hole)"
          : !meshCols.length && boxes.length ? "open (no box covers it)"
          : meshKnown && solidCovers !== null ? "open (no collider covers it)"
          : meshKnown && !solidFiles.length ? "open (no hull covers it)"
          : "unknown";
        if (/^closed|^maybe/.test(o.collider)) piece.colliderClosesOpening = o.collider.startsWith("maybe") ? "maybe" : true;
      }
    }
  }
  pieces.push(piece);
}

// ── variants: a piece whose name is another's with a word added (_Snow, _Lite, ...)
const byId = new Map(pieces.map((p) => [p.id, p]));
const suffixes = {};
for (const p of pieces) {
  const m = /^(.*)_([A-Za-z]+)$/.exec(p.id);
  if (m && byId.has(m[1]) && !/^\d+$/.test(m[2])) { p.variantOf = m[1]; p.variant = m[2]; suffixes[m[2]] = (suffixes[m[2]] ?? 0) + 1; }
}

// ── the grid module: cluster the lengths
function clusters(values, tol = 0.03) {
  const v = values.filter((x) => x > 0.05).sort((a, b) => a - b);
  const out = [];
  for (const x of v) {
    const last = out[out.length - 1];
    if (last && (x - last.max) <= Math.max(0.02, last.min * tol)) { last.items.push(x); last.max = x; }
    else out.push({ min: x, max: x, items: [x] });
  }
  return out.map((c) => ({ value: r3(c.items[c.items.length >> 1]), count: c.items.length, min: r3(c.min), max: r3(c.max) })).sort((a, b) => b.count - a.count);
}
const structural = pieces.filter((p) => !p.error && !p.empty && STRUCTURAL.has(p.role) && !p.variantOf);
const walls = structural.filter((p) => p.wall && p.role !== "battlement");
const floors = structural.filter((p) => ["floor", "ceiling", "foundation"].includes(p.role));
const wallLengths = walls.map((p) => p.wall.length);
const wallHeights = walls.map((p) => p.wall.height);
const floorSizes = floors.flatMap((p) => [p.footprint.x, p.footprint.y]);
const thicknesses = walls.map((p) => p.wall.thickness).filter((x) => x);

function moduleScore(m, values) {
  // how many values are a whole number of quarter modules, within 3 cm or 2 %
  let hit = 0;
  for (const v of values) {
    const q = v / (m / 4);
    const near = Math.round(q) * (m / 4);
    if (Math.round(q) >= 1 && Math.abs(v - near) <= Math.max(0.03, v * 0.02)) hit++;
  }
  return values.length ? hit / values.length : 0;
}
const lengthsForModule = [...wallLengths, ...floorSizes];
const candidates = [];
for (let m = 1; m <= 8.0001; m += 0.25) candidates.push({ module: r2(m), wholeOrHalf: 0, quarter: r2(moduleScore(m, lengthsForModule)) });
for (const c of candidates) {
  let hit = 0;
  for (const v of lengthsForModule) { const q = v / (c.module / 2); if (Math.round(q) >= 1 && Math.abs(v - Math.round(q) * (c.module / 2)) <= Math.max(0.03, v * 0.02)) hit++; }
  c.wholeOrHalf = r2(lengthsForModule.length ? hit / lengthsForModule.length : 0);
}
// the module: the largest whose halves cover at least 60 % of the lengths, else the best by halves
const lc = clusters(wallLengths);
let module = Number(args.module) || null;
if (!module) {
  // the largest module whose whole and half steps explain nearly as many lengths as the best one does
  const bestScore = Math.max(...candidates.map((c) => c.wholeOrHalf));
  module = candidates.filter((c) => c.wholeOrHalf >= bestScore - 0.08).sort((a, b) => b.module - a.module)[0]?.module ?? 1;
}

// snapping: a piece snaps if its footprint is whole quarter modules and its pivot is a corner, edge or centre
for (const p of pieces) {
  if (p.error || p.empty) continue;
  const q = module / 4;
  const fits = (v) => v < 0.6 || Math.abs(v - Math.round(v / q) * q) <= Math.max(0.04, v * 0.02);
  const diagonal = p.wall && !["X", "Y"].includes(p.wall.runs);
  const dims = p.wall && !diagonal ? [p.wall.length] : [p.footprint.x, p.footprint.y];
  const pivotOk = p.pivot.horizontal !== "off-box";
  const onGrid = diagonal ? dims.every((v) => Math.abs(v - Math.round(v / module) * module) < 0.3 && v > module / 2) : dims.every(fits);
  p.grid = {
    snaps: onGrid && pivotOk,
    cells: dims.map((v) => r2(v / module)),
    why: !onGrid ? "size is not whole quarter modules" : !pivotOk ? "pivot is not at a corner, edge or centre of its box" : "ok",
  };
}

// ── families: pieces whose names begin with the same three words; each may keep its own module
const families = {};
for (const p of pieces) {
  if (p.error || p.empty || p.variantOf || !(STRUCTURAL.has(p.role) || p.role === "ground")) continue;
  const fam = p.id.split("_").slice(0, 3).join("_");
  (families[fam] ??= []).push(p);
}
const familyModules = [];
for (const [fam, list] of Object.entries(families)) {
  if (list.length < 3) continue;
  const dims = list.flatMap((p) => (p.wall && ["X", "Y"].includes(p.wall.runs) ? [p.wall.length] : [p.footprint.x, p.footprint.y])).filter((v) => v > 0.6);
  if (dims.length < 3) continue;
  // the module: the commonest size (1 m or more) that, with its halves, explains at least half the sizes
  const cl = clusters(dims);
  const share = (m) => dims.filter((v) => { const q = v / (m / 2); return Math.round(q) >= 1 && Math.abs(v - Math.round(q) * (m / 2)) <= Math.max(0.03, v * 0.015); }).length / dims.length;
  const cand = cl.filter((c) => c.value >= 1 && c.count >= 2).slice(0, 3).map((c) => ({ m: c.value, share: share(c.value) }));
  const pick = cand.find((c) => c.share >= 0.5);
  familyModules.push({ family: fam, pieces: list.length, module: pick ? pick.m : null, share: pick ? r2(pick.share) : null, note: pick ? undefined : "free-form: no size repeats enough to be a grid", sizes: cl.slice(0, 6).map((c) => `${c.value} x${c.count}`) });
}
familyModules.sort((a, b) => b.pieces - a.pieces);

// ── openings, stairs, thickness summaries
const openingList = pieces.filter((p) => p.openings?.length).map((p) => ({ id: p.id, role: p.role, ...p.openings[0], more: p.openings.length - 1, colliderClosesOpening: !!p.colliderClosesOpening }));
const stairList = pieces.filter((p) => p.stair).map((p) => ({ id: p.id, ...p.stair, size: p.bounds.size }));

// ── layouts: how the scene's maker snapped pieces
const layouts = [];
const idOfPrefab = new Map(pieces.filter((p) => p.prefab).map((p) => [p.prefab, p.id]));
for (const lf of args.layout) {
  const L = readJson(lf);
  const inst = (L.instances ?? []).filter((i) => i.prefab).map((i) => {
    const id = idOfPrefab.get(i.prefab) ?? path.basename(i.prefab).replace(/\.[^.]+$/, "");
    const piece = byId.get(id);
    return { id, role: piece?.role ?? "?", structural: piece ? STRUCTURAL.has(piece.role) : false, p: i.position, q: i.rotation, s: i.scale, yaw: unityYaw(i.rotation) };
  });
  const yawHist = {};
  let tilted = 0, scaled = 0, nonUniform = 0;
  const steps = { "90": 0, "45": 0, "15": 0, other: 0 };
  for (const i of inst) {
    if (i.s.some((v) => Math.abs(v - 1) > 1e-3)) { scaled++; if (Math.abs(i.s[0] - i.s[1]) > 1e-3 || Math.abs(i.s[0] - i.s[2]) > 1e-3) nonUniform++; }
    if (i.yaw === null) { tilted++; continue; }
    const y = ((Math.round(i.yaw) % 360) + 360) % 360;
    if (i.structural) yawHist[y] = (yawHist[y] ?? 0) + 1;
    const near = (st) => Math.abs(i.yaw / st - Math.round(i.yaw / st)) * st < 0.5;
    if (near(90)) steps["90"]++; else if (near(45)) steps["45"]++; else if (near(15)) steps["15"]++; else steps.other++;
  }
  const st = inst.filter((i) => i.structural);
  const stSteps = { "90": 0, "45": 0, "15": 0, other: 0, tilted: 0 };
  for (const i of st) {
    if (i.yaw === null) { stSteps.tilted++; continue; }
    const near = (s) => Math.abs(i.yaw / s - Math.round(i.yaw / s)) * s < 0.5;
    if (near(90)) stSteps["90"]++; else if (near(45)) stSteps["45"]++; else if (near(15)) stSteps["15"]++; else stSteps.other++;
  }
  // positions against candidate modules (structural pieces, ground plane = Unity x and z)
  const posFit = {};
  for (const m of [0.25, 0.5, 1, 1.25, 2, 2.5, 3, 4, 5]) {
    // the grid may be shifted: try every offset in 1 cm steps, for the two ground axes apart
    const best = [0, 2].map((k) => {
      let top = { off: 0, share: 0 };
      for (let off = 0; off < m; off += 0.01) {
        let hit = 0;
        for (const i of st) { const r = (((i.p[k] - off) % m) + m) % m; if (r < 0.03 || m - r < 0.03) hit++; }
        if (hit > top.share * st.length) top = { off: r2(off), share: hit / st.length };
      }
      return { offset: top.off, share: r2(top.share) };
    });
    posFit[m] = { unityX: best[0], unityZ: best[1] };
  }
  const scales = {};
  for (const i of st) { const k = i.s.map((v) => r2(v)).join(" x "); scales[k] = (scales[k] ?? 0) + 1; }
  const heights = clusters(st.map((i) => i.p[1]).filter((v) => v > 0.05), 0.01).slice(0, 12);
  // neighbours: for each structural piece, the structural pieces within reach, in its own frame (s&box axes)
  const pairs = new Map();
  for (const a of st) {
    if (a.yaw === null) continue;
    let best = [];
    for (const b of st) {
      if (a === b) continue;
      const d = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]];
      const dist = Math.hypot(d[0], d[2]);
      if (dist > 12 || Math.abs(d[1]) > 12) continue;
      best.push({ b, d, dist });
    }
    best.sort((x, y) => x.dist - y.dist);
    for (const { b, d } of best.slice(0, 3)) {
      const local = fromUnity(quatRotate(quatInv(a.q), d)).map((v) => Math.round(v * 20) / 20);
      const relYaw = b.yaw === null ? "tilted" : String(((Math.round(-(b.yaw - a.yaw)) % 360) + 360) % 360);
      const key = `${a.id} -> ${b.id} @ [${local.join(", ")}] yaw ${relYaw}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
  }
  const sameIdSteps = new Map();
  for (const a of st) for (const b of st) {
    if (a === b || a.id !== b.id || a.yaw === null || b.yaw === null) continue;
    if (Math.abs(((a.yaw - b.yaw) % 360 + 360) % 360) > 0.5) continue;
    const d = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]];
    const local = fromUnity(quatRotate(quatInv(a.q), d));
    if (Math.abs(local[2]) > 0.05 || Math.hypot(local[0], local[1]) > 12) continue;
    const step = r2(Math.hypot(local[0], local[1]));
    if (step < 0.3) continue;
    const k = `${a.id} ${step}`;
    sameIdSteps.set(k, (sameIdSteps.get(k) ?? 0) + 1);
  }
  const usage = {};
  for (const i of inst) usage[i.id] = (usage[i.id] ?? 0) + 1;
  layouts.push({
    file: path.basename(lf),
    instances: inst.length,
    structural: st.length,
    rotation: { all: { ...steps, tilted }, structural: stSteps, structuralYawDegreesUnity: yawHist, note: "Unity yaw about +Y; s&box yaw is the negative" },
    scaled, nonUniformScale: nonUniform,
    structuralScales: Object.entries(scales).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, n]) => ({ scale: k, n })),
    positionOnGrid: { note: "per module m and ground axis: the best grid offset and the share of structural pieces whose position lies on that grid within 3 cm (chance alone gives about 6 cm / m)", ...posFit },
    structuralHeights: heights,
    repeatSteps: [...sameIdSteps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => ({ step: k, count: n })),
    neighbours: [...pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k, n]) => ({ pair: k, count: n })),
    usage: Object.entries(usage).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, n })),
  });
}

// ── write
const roleCounts = {};
const roleConf = {};
for (const p of pieces) {
  roleCounts[p.role] = (roleCounts[p.role] ?? 0) + 1;
  roleConf[p.confidence] = (roleConf[p.confidence] ?? 0) + 1;
}
const out = {
  kit: { glb: path.resolve(args.glb), manifest: args.manifest ?? null, layouts: args.layout, measured: new Date().toISOString(), pieces: pieces.length, failed },
  axes: {
    system: "s&box: +X forward, +Y left, +Z up; metres, with inches beside (x 39.3701)",
    fromGltf: "X = glTF +Z, Y = glTF +X, Z = glTF +Y",
    fromUnity: "X = Unity +Z, Y = -Unity X, Z = Unity +Y (Unity is left-handed: this mirrors); Unity yaw a = s&box yaw -a",
    pivot: "frac per axis: 0 = min of the box, 0.5 = centre, 1 = max; words: X back/front, Y right/left, Z bottom/top",
  },
  module: {
    chosen: module,
    chosenIn: inch(module),
    candidates: candidates.filter((c) => c.wholeOrHalf >= 0.3).sort((a, b) => b.wholeOrHalf - a.wholeOrHalf).slice(0, 12),
    wallLengths: lc.slice(0, 15),
    wallHeights: clusters(wallHeights).slice(0, 12),
    floorSizes: clusters(floorSizes).slice(0, 12),
    wallThickness: clusters(thicknesses, 0.1).slice(0, 8),
    note: "lengths from base pieces with structural roles (variants left out); a wall's length is its face planes' extent, without trims that stick out",
  },
  families: familyModules,
  roles: roleCounts,
  confidence: roleConf,
  variants: suffixes,
  snapping: {
    snaps: pieces.filter((p) => p.grid?.snaps && STRUCTURAL.has(p.role)).map((p) => p.id),
    breaks: pieces.filter((p) => p.grid && !p.grid.snaps && STRUCTURAL.has(p.role)).map((p) => ({ id: p.id, role: p.role, why: p.grid.why, cells: p.grid.cells, pivot: p.pivot.label })),
  },
  openings: openingList,
  stairs: stairList,
  layouts,
  pieces,
};
fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
fs.writeFileSync(args.out, JSON.stringify(out, null, 1));
console.log(`${pieces.length} pieces (${failed} failed) -> ${args.out}; module ${module} m; roles ${JSON.stringify(roleCounts)}`);
