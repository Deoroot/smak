// The street lamp of the H9 maps (levels/assembly/dress.mjs, `streetLight.spot`) as a studio model made by SMAK: nothing of any
// game's is in it, the textures are painted here.
//
//   node levels/art/h9-street-lamp.mjs [out folder, default levels/art/h9/models] [--sheet <folder>]
//
// writes street_lamp.mdl; install as <H9>/ts/models/h9/street_lamp.mdl (a ts_model names it: the dress file's `street_lamp`).
//
// THE REFERENCE FORM (a period street lamp, in the city's "Byzantine regal" look: levels/notes-h9.md, section 6)
//   foot     a dark marble plinth turned in eight sides, stepped, with a gold collar where the iron stands on it.
//   shaft    dark bronze-iron, turned: a slender taper with two gold-ringed nodes (swellings) and a capital, a gold cup
//            at the top where the arms spring from.
//   arms     a crook: the shaft goes on over and bends down in a half circle to 18 units out, and a thinner gold brace
//            springs from the capital in a quarter of an ellipse and joins the rod the lantern hangs from.
//   lantern  six sides, narrow at the foot and flaring up, six iron ribs round panes of warm glass (fullbright: it
//            glows by itself), a bulb-shaped bottom ending in a gold point, an ogee roof and a gold finial.
// Size: 177 high, the shaft on the model's origin (the floor at z 0), the lantern 18 out along +x, its lamp at z 130 (the dress
// puts the downward light_spot there).
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildMdl, indexed, check, png, render, workshop } from "../../src/index.mjs";

const { fbm, noise, mix, times } = workshop;
const OUT = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "levels/art/h9/models";
const SHEET = process.argv.includes("--sheet") ? process.argv[process.argv.indexOf("--sheet") + 1] : null;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => a.map((v) => v / (Math.hypot(...a) || 1));

// ── the textures (painted here) ────────────────────────────────────────────
const canvas = (W, H, fn) => {
  const rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = fn(x, y);
      for (let k = 0; k < 3; k++) rgb[(y * W + x) * 3 + k] = Math.max(0, Math.min(255, Math.round(c[k] * 255)));
    }
  return { width: W, height: H, rgb };
};
const GOLD = [0.8, 0.6, 0.2];
// u (x) goes round a turned part: a highlight at one side, as light from a street's one side
const turn = (px, W) => 0.7 + 0.5 * Math.pow(Math.max(0, Math.sin(Math.PI * (((px / W) * 2) % 1))), 1.6);
const ironPaint = (px, py) => times([0.085, 0.07, 0.06], turn(px, 64) * (0.85 + 0.5 * (fbm(px * 0.15, py * 0.15, 3) - 0.5)) + 0.36 * Math.max(0, noise(px * 0.9, py * 0.9, 4) - 0.8));
const goldPaint = (px, py) => times(GOLD, 0.6 + 0.6 * turn(px, 64) * (0.9 + 0.2 * noise(px * 0.5, py * 0.5, 9)));
const stonePaint = (px, py) => {
  const vein = Math.abs(Math.sin((px * 0.07 + py * 0.045 + 6 * fbm(px * 0.03, py * 0.03, 4)) * 3));
  const v = Math.pow(1 - Math.min(1, vein * 4), 3);
  return mix(times([0.06, 0.065, 0.085], 0.8 + 0.3 * turn(px, 128) + 0.3 * fbm(px * 0.08, py * 0.08, 4)), [0.5, 0.4, 0.22], v * 0.55);
};
const glassPaint = (px, py) => {
  // fullbright: a warm lamp seen through panes, brighter at the middle of each; the ribs cover the seams
  const d = Math.abs((((px / 64) * 6) % 1) - 0.5) * 2;
  const k = 1 - 0.35 * d * d - 0.18 * (py / 64);
  return mix([1, 0.7, 0.34], [1, 0.93, 0.7], Math.max(0, k) ** 1.4);
};
const TEX = {
  iron: indexed(canvas(64, 64, ironPaint), "sl_iron.bmp"),
  gold: indexed(canvas(64, 64, goldPaint), "sl_gold.bmp"),
  stone: indexed(canvas(128, 128, stonePaint), "sl_stone.bmp"),
  glass: { ...indexed(canvas(64, 64, glassPaint), "sl_glass.bmp"), flags: 4 },
};

// ── the mesh builder ───────────────────────────────────────────────────────
const tris = {};
function tri(tex, pts, uvs, out) {
  const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
  if (Math.hypot(...n) < 1e-7) return;
  const { width: W, height: H } = TEX[tex];
  const order = dot(n, out) < 0 ? [0, 2, 1] : [0, 1, 2];
  (tris[tex] ??= []).push(order.map((k) => ({ p: pts[k], uv: [uvs[k][0] / W, uvs[k][1] / H] })));
}
const quad = (tex, pts, uvs, out) => (tri(tex, [pts[0], pts[1], pts[2]], [uvs[0], uvs[1], uvs[2]], out), tri(tex, [pts[0], pts[2], pts[3]], [uvs[0], uvs[2], uvs[3]], out));
const px = (tex, a, b) => [0.5 + a * (TEX[tex].width - 1), 0.5 + b * (TEX[tex].height - 1)];

/** A ring-section sweep: `rings` is a list of { c: centre, r, T: tangent }; quads between successive rings, n sides, a frame carried along. */
function sweep(tex, rings, n) {
  let prev;
  const frames = rings.map((q) => {
    const T = unit(q.T);
    const E1 = prev ? unit(sub(prev, T.map((v) => v * dot(prev, T)))) : unit(cross(T, Math.abs(T[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
    prev = E1;
    return { T, E1, E2: cross(T, E1) };
  });
  const at = (i, k) => {
    const a = (2 * Math.PI * k) / n;
    const { E1, E2 } = frames[i];
    return [0, 1, 2].map((c) => rings[i].c[c] + rings[i].r * (E1[c] * Math.cos(a) + E2[c] * Math.sin(a)));
  };
  let run = 0;
  const seg = (i) => Math.hypot(...sub(rings[i + 1].c, rings[i].c)) + Math.abs(rings[i + 1].r - rings[i].r);
  const total = rings.slice(1).reduce((s, _, i) => s + seg(i), 0) || 1;
  for (let i = 0; i + 1 < rings.length; i++) {
    const d = seg(i);
    for (let k = 0; k < n; k++) {
      const pts = [at(i, k), at(i, k + 1), at(i + 1, k + 1), at(i + 1, k)];
      const mid = [0, 1, 2].map((c) => (pts[0][c] + pts[1][c] + pts[2][c] + pts[3][c]) / 4);
      const mc = [0, 1, 2].map((c) => (rings[i].c[c] + rings[i + 1].c[c]) / 2);
      const uv = [px(tex, k / n, run / total), px(tex, (k + 1) / n, run / total), px(tex, (k + 1) / n, (run + d) / total), px(tex, k / n, (run + d) / total)];
      quad(tex, pts, uv, sub(mid, mc));
    }
    run += d;
  }
  for (const [i, s] of [[0, -1], [rings.length - 1, 1]]) {
    if (rings[i].r <= 0.01) continue;
    const ring = Array.from({ length: n }, (_, k) => at(i, k));
    const uv = px(tex, 0.5, 0.5);
    for (let k = 1; k + 1 < n; k++) tri(tex, [ring[0], ring[k], ring[k + 1]], [uv, uv, uv], frames[i].T.map((v) => v * s));
  }
}
/** A surface of revolution about the vertical line through (x, y): profile [[z, r]]. */
const lathe = (tex, x, y, profile, n) => sweep(tex, profile.map(([z, r]) => ({ c: [x, y, z], r, T: [0, 0, 1] })), n);
/** A tube along a list of points. */
function tube(tex, pts, r, n = 6) {
  sweep(tex, pts.map((p, i) => ({ c: p, r, T: sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]) })), n);
}

// ── the lamp ───────────────────────────────────────────────────────────────
const LX = 18; // the lantern's distance from the shaft
// the foot: eight-sided dark marble, stepped; a gold collar
lathe("stone", 0, 0, [[0, 7.5], [2, 7.5], [3.2, 6.3], [5, 6.3], [6.2, 5.5], [22, 4.9], [24, 5.7], [27, 5.7], [27, 4.6]], 8);
lathe("gold", 0, 0, [[26, 4.3], [27.2, 5.9], [29, 6.1], [30.4, 4.6], [31, 4]], 12);
// the shaft: a taper with two nodes and a capital, ten sides
lathe("iron", 0, 0, [[30, 4], [33, 3.6], [52, 3.1], [54, 4.4], [57, 4.9], [60, 4.4], [62, 3.1], [96, 2.8], [98, 4.2], [101, 4.7], [104, 4.2], [106, 2.8], [140, 2.5], [144, 3.2], [147, 3.2], [150, 2.8], [162, 2.4], [168, 2.2]], 10);
for (const z of [57, 101]) lathe("gold", 0, 0, [[z - 5.2, 4.1], [z - 4, 5.4], [z - 2, 5.9], [z, 6.1], [z + 2, 5.9], [z + 4, 5.4], [z + 5.2, 4.1]], 12);
// the capital: a gold cup the arms spring from
lathe("gold", 0, 0, [[141, 2.9], [144, 4.4], [148, 5.7], [152, 5.8], [154, 4.8], [156, 3.4], [158, 3.0]], 12);
// the crook: up, over in a half circle, down to the lantern's rod
const crook = [];
for (let z = 160; z < 168; z += 2) crook.push([0, 0, z]);
for (let i = 0; i <= 14; i++) {
  const a = Math.PI - (Math.PI * i) / 14;
  crook.push([LX / 2 + (LX / 2) * Math.cos(a), 0, 168 + (LX / 2) * Math.sin(a)]);
}
for (let z = 166; z >= 160; z -= 2) crook.push([LX, 0, z]);
tube("iron", crook, 2, 8);
// a ring where the lantern hangs, and the brace: a quarter of an ellipse from the capital to the rod
lathe("gold", LX, 0, [[158.5, 1.6], [160, 2.9], [162, 3.1], [163.5, 1.6]], 10);
const brace = [];
for (let i = 0; i <= 12; i++) {
  const t = (Math.PI / 2) * (i / 12);
  brace.push([LX * Math.sin(t), 0, 150 + 16 * (1 - Math.cos(t))]);
}
tube("gold", brace, 1.15, 6);
// the lantern: a bulb-shaped foot to a gold point, six panes flaring up between six ribs, an ogee roof, a finial
lathe("iron", LX, 0, [[117, 0.1], [118.5, 1.4], [120.5, 4], [123, 6.2], [124.5, 6.9]], 6);
lathe("gold", LX, 0, [[113.5, 0.1], [115, 1.2], [117.5, 1.5], [119, 0.1]], 8);
lathe("glass", LX, 0, [[124, 6.4], [140, 8.2]], 6);
for (let k = 0; k < 6; k++) {
  const a = (2 * Math.PI * k) / 6;
  const at = (z, r) => [LX + r * Math.cos(a), r * Math.sin(a), z];
  tube("iron", [at(123.5, 6.6), at(140.5, 8.4)], 0.85, 5);
}
lathe("iron", LX, 0, [[139.5, 8.7], [141, 9.4], [143, 9.0], [145, 7.4], [148, 5], [151, 2.9], [153, 1.9], [154, 1.4]], 6);
lathe("gold", LX, 0, [[153.5, 1.2], [155, 2.5], [157, 2.7], [158.5, 1.3], [160, 0.1]], 8);
// the rod
tube("gold", [[LX, 0, 158], [LX, 0, 163]], 0.8, 5);

const bodyparts = [{ name: "lamp", models: [{ name: "lamp", meshes: Object.entries(tris).map(([t, list]) => ({ tris: list, texture: TEX[t] })) }] }];
const BB = { bbmin: [-12, -12, 0], bbmax: [LX + 14, 12, 177], min: [-12, -12, 0], max: [LX + 14, 12, 177] };
const mdl = buildMdl({ name: "street_lamp.mdl", bodyparts, ...BB });

mkdirSync(OUT, { recursive: true });
const report = check(mdl, "goldsrc");
console.log(`street_lamp.mdl: ${mdl.length} bytes; triangles ${Object.values(tris).reduce((s, l) => s + l.length, 0)}`);
for (const line of report.facts) console.log(`  ${line}`);
for (const w of report.warnings) console.log(`  WARN ${w}`);
for (const e of report.errors) console.log(`  ERROR ${e}`);
writeFileSync(join(OUT, "street_lamp.mdl"), mdl);
if (SHEET) {
  mkdirSync(SHEET, { recursive: true });
  const shots = { side: { yaw: 90, pitch: 4 }, front: { yaw: 0, pitch: 4 }, three: { yaw: 40, pitch: 15 }, below: { yaw: 60, pitch: -25 } };
  for (const [k, v] of Object.entries(shots)) {
    const img = render(mdl, { ...v, width: 600, height: 800, zoom: 1.0 });
    writeFileSync(join(SHEET, `${k}.png`), png(img.width, img.height, img.rgba));
  }
  const top = render(mdl, { target: [LX, 0, 135], yaw: 40, pitch: 10, dist: 45, width: 800, height: 600, fov: 60 });
  writeFileSync(join(SHEET, "lantern.png"), png(top.width, top.height, top.rgba));
}
if (report.errors.length) process.exit(1);
console.log("PASS: the lamp is written");
