// Surveillance drone for smak_rp_byz01. node make_drone.mjs [out folder]
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const K = new URL("../../../src/index.mjs", import.meta.url).href;
const { buildMdl, indexed, check, workshop } = await import(K);
const { fbm, mix, times, bell } = workshop;
const OUT = process.argv[2] ?? ".";
mkdirSync(OUT, { recursive: true });

// ── palettes: the bronze livery and the police one ──
const LIVERIES = {
  bronze: { enamel: [0.3, 0.06, 0.1], metal: [0.55, 0.37, 0.15], gold: [0.95, 0.74, 0.25], dark: [0.2, 0.14, 0.08], eye: [1.0, 0.85, 0.5], light: [1.0, 0.1, 0.06] },
  police: { enamel: [0.05, 0.09, 0.22], metal: [0.1, 0.16, 0.38], gold: [0.95, 0.76, 0.28], dark: [0.85, 0.87, 0.92], eye: [0.85, 0.95, 1.0], light: [0.1, 0.3, 1.0] },
};
const W = 256, H = 256;
const HULL = { x: 0, y: 0, w: 256, h: 64 };
const DUCT = { x: 0, y: 64, w: 256, h: 24 };
const DARK = { x: 0, y: 88, w: 128, h: 32 };
const BLADE = { x: 128, y: 88, w: 128, h: 32 };
const CAP = { x: 0, y: 128, w: 64, h: 64 };
const GW = 64, GH = 32;
const GLOW_L = { x: 0, y: 0, w: 32, h: 32 }; // top light
const GLOW_E = { x: 32, y: 0, w: 32, h: 32 }; // eye lens

const cross = (u, v) => {
  const a = Math.abs(u - 8), b = Math.abs(v - 8);
  return (a < 1.6 && b < 6) || (b < 1.6 && a < 6);
};
const enamel = (L, u, v, s) => times(L.enamel, 0.85 + 0.3 * fbm(u / 9, v / 9, s, 3));
const metal = (L, u, v, s) => times(L.metal, 0.7 + 0.5 * fbm(u / 7, v / 5, s, 4));

function paint(L) {
  const c = workshop.sheet(W, H, L.enamel);
  c.zone(HULL, (u, v) => {
    const band = (a, b) => u >= a && u < b;
    if (band(0, 50)) return times(metal(L, u, v, 1), 1 - 0.5 * (u % 25 < 1.2 ? 1 : 0));
    if (band(50, 56) || band(100, 106)) return times(L.gold, 0.8 + 0.3 * fbm(u / 3, v / 3, 2));
    if (band(56, 100)) { // filigree band: dark enamel with gold crosses and scrolls
      const cu = (u - 56) % 16, cv = v % 16;
      if (u - 56 < 32 && cross(cu, cv)) return times(L.gold, 1.05);
      const scroll = Math.abs(Math.sin(u / 3.2) * 4 + 8 - cv) < 0.9 && u - 56 >= 32;
      return scroll ? times(L.gold, 0.8) : enamel(L, u, v, 3);
    }
    const rib = bell((v % 8) - 4, 0.7);
    return times(metal(L, u, v, 4), 1 - 0.35 * rib + (u > 190 ? 0.1 : 0));
  }, 0);
  c.zone(DUCT, (u, v) => (v > 10 && v < 13 ? times(L.gold, 0.9) : u % 32 < 2 ? times(L.dark, 0.7) : metal(L, u, v, 6)), 0);
  c.zone(DARK, (u, v) => (Math.abs(v - 16) < 1.5 ? times(L.gold, 0.8) : enamel(L, u, v, 7)), 0);
  c.zone(BLADE, (u, v) => times(mix(L.metal, L.dark, 0.5), 0.8 + 0.4 * fbm(u / 12, v / 3, 8)), 0);
  c.zone(CAP, (u, v) => {
    const d = Math.hypot(u - 32, v - 32);
    return (d < 28 && d > 25) || d < 6 ? L.gold : enamel(L, u, v, 9);
  }, 0);
  return c.image();
}
function paintGlow(L) {
  const c = workshop.sheet(GW, GH, [0, 0, 0]);
  c.zone(GLOW_L, (u, v) => times(L.light, 0.75 + 0.35 * bell(v - 16, 12)), 0);
  c.zone(GLOW_E, (u, v) => mix(L.eye, [1, 1, 1], 0.4 * bell(v - 16, 10)), 0);
  return c.image();
}
const mainTex = (L, name) => indexed(paint(L), name);
const glowTex = (L, name) => ({ ...indexed(paintGlow(L), name), flags: 4 }); // 4 = full bright (unlit)

// ── geometry ──
const main = workshop.shape(W, H);
const glow = workshop.shape(GW, GH);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];

/** Oriented box: centre c, unit axes ax,ay,az, half sizes h. Every face wears the whole zone. */
function obox(m, c, ax, ay, az, h, zone, part) {
  const P = (i, j, k) => add(add(add(c, scl(ax, i * h[0])), scl(ay, j * h[1])), scl(az, k * h[2]));
  const corner = (p, n) => m.V(p, [zone.x + [0, zone.w, zone.w, 0][n], zone.y + [0, 0, zone.h, zone.h][n]], part);
  const faces = [
    [P(1, -1, 1), P(1, 1, 1), P(1, 1, -1), P(1, -1, -1)], [P(-1, 1, 1), P(-1, -1, 1), P(-1, -1, -1), P(-1, 1, -1)],
    [P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1)], [P(1, -1, 1), P(-1, -1, 1), P(-1, -1, -1), P(1, -1, -1)],
    [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)], [P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1), P(-1, -1, -1)],
  ];
  for (const f of faces) m.quad(...f.map(corner), c);
}
/** A torus about the z axis at centre c: major radius R, tube radius r. */
function torus(m, c, R, r, zone, part, segs = 18, sides = 6) {
  const pt = (i, j) => {
    const a = (2 * Math.PI * i) / segs, b = (2 * Math.PI * j) / sides;
    const rho = R + r * Math.cos(b);
    return m.V([c[0] + rho * Math.cos(a), c[1] + rho * Math.sin(a), c[2] + r * Math.sin(b)],
      [zone.x + (zone.w * i) / segs, zone.y + (zone.h * j) / sides], part);
  };
  for (let i = 0; i < segs; i++) for (let j = 0; j < sides; j++) {
    const a = (2 * Math.PI * (i + 0.5)) / segs;
    m.quad(pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1), [c[0] + R * Math.cos(a), c[1] + R * Math.sin(a), c[2]]);
  }
}

// hull: lathe about z. profile [z, radius]
const HULL_PROFILE = [[-5, 3.5], [-4.2, 7], [-2, 9.5], [0.5, 10.2], [2, 9.8], [3.5, 8], [5.5, 5.5], [7, 2.8], [8, 0]];
main.lathe(HULL_PROFILE, HULL, { sides: 16, px: 4.6, at: (s, a, b) => [a, b, s], caps: [CAP, false], part: 0 });

const ROT = { FL: [14, 14], FR: [14, -14], BL: [-14, 14], BR: [-14, -14] };
const ROTZ = 4.5;
const names = ["body", "rotor_fl", "rotor_fr", "rotor_bl", "rotor_br", "eye"];
Object.entries(ROT).forEach(([k, [x, y]], idx) => {
  const part = idx + 1;
  const len = Math.hypot(x, y), dir = [x / len, y / len, 0], side = [-dir[1], dir[0], 0];
  const inner = 7, outer = len - 6.5; // arm runs from the hull to the duct
  const mid = scl(dir, (inner + outer) / 2);
  obox(main, [mid[0], mid[1], 1.8], dir, side, Z, [(outer - inner) / 2 + 0.5, 1.4, 1.3], DARK, 0);
  torus(main, [x, y, ROTZ], 7, 1.3, DUCT, 0);
  obox(main, [x, y, ROTZ], X, Y, Z, [1.4, 1.4, 1.8], DARK, part);
  for (let b = 0; b < 3; b++) {
    const a = (2 * Math.PI * b) / 3 + 0.3, d = [Math.cos(a), Math.sin(a), 0], sd = [-d[1], d[0], 0];
    obox(main, [x + d[0] * 3.9, y + d[1] * 3.9, ROTZ + 0.2], d, sd, Z, [3.4, 1.1, 0.2], BLADE, part);
  }
  // struts holding the duct to the arm
  void k;
});
// eye housing + neck (eye bone), antenna (body)
const EYE = [9, 0, -4.2];
const eyeAt = (s, a, b) => [EYE[0] + s, EYE[1] + a, EYE[2] + b];
main.lathe([[0, 2.6], [2, 3.4], [4.5, 3.4], [5.2, 2.6]], DARK, { sides: 12, px: 8, at: eyeAt, caps: [DARK, false], part: 5 });
obox(main, [7, 0, -2.2], X, Y, Z, [1.6, 1, 1.4], DARK, 0);
obox(main, [-8.5, 0, -7.6], X, Y, Z, [0.35, 0.35, 3], DARK, 0); // antenna
obox(main, [-8.5, 0, -10.8], X, Y, Z, [0.9, 0.9, 0.6], DARK, 0); // bead
obox(main, [-2.5, 0, 7.2], X, Y, Z, [2.4, 2.4, 0.9], DARK, 0); // base of the top light
// glowing parts (full bright texture)
glow.lathe([[5.2, 2.5], [5.9, 1.9], [6.6, 0]], GLOW_E, { sides: 12, px: 1, at: eyeAt, part: 5 });
glow.lathe([[8, 1.8], [9.6, 1.9], [11.2, 1.2], [12.2, 0]], GLOW_L, { sides: 10, px: 1, at: (s, a, b) => [-2.5 + a, b, s], part: 0 });

const toTris = (m) => m.tris.map((t) => t.map((c) => ({ ...c, bone: names[c.part] })));

// ── bones, attachments ──
const bones = [
  { name: "root", parent: -1 },
  { name: "body", parent: 0 },
  { name: "rotor_fl", parent: 1, pos: [ROT.FL[0], ROT.FL[1], ROTZ] },
  { name: "rotor_fr", parent: 1, pos: [ROT.FR[0], ROT.FR[1], ROTZ] },
  { name: "rotor_bl", parent: 1, pos: [ROT.BL[0], ROT.BL[1], ROTZ] },
  { name: "rotor_br", parent: 1, pos: [ROT.BR[0], ROT.BR[1], ROTZ] },
  { name: "eye", parent: 1, pos: EYE },
];
const attachments = [
  { name: "eye", bone: "eye", pos: [6.8, 0, 0] },
  { name: "top_light", bone: "body", pos: [-2.5, 0, 11.5] },
];

// ── animation ──
const DIR = [1, -1, -1, 1]; // opposite rotors turn opposite ways
const KEYS = ["FL", "FR", "BL", "BR"];
const frame = ({ z = 0, pitch = 0, roll = 0, yaw = 0, spin = 0, eyeTilt = 0, eyeYaw = 0 }) => [
  [0, 0, 0, 0, 0, 0],
  [0, 0, z, roll, pitch, yaw],
  ...KEYS.map((k, i) => [ROT[k][0], ROT[k][1], ROTZ, 0, 0, DIR[i] * spin]),
  [EYE[0], EYE[1], EYE[2], 0, eyeTilt, eyeYaw],
];
const range = (n, f) => Array.from({ length: n + 1 }, (_, i) => f(i, i / n));
const TAU = 2 * Math.PI;
const D = Math.PI / 180;
const idle = range(30, (i, t) => frame({ z: 1.2 * Math.sin(TAU * t), roll: 0.03 * Math.sin(TAU * t + 1), pitch: 0.02 * Math.sin(TAU * t + 2), spin: i * 24 * D, eyeTilt: 0.1 * Math.sin(TAU * t) }));
const move = range(20, (i, t) => frame({ z: 0.6 * Math.sin(TAU * t), pitch: 0.32 + 0.02 * Math.sin(TAU * t), roll: 0.025 * Math.sin(TAU * t), spin: i * 54 * D, eyeTilt: -0.25 }));
const alert = range(40, (i, t) => frame({ z: 0.9 * Math.sin(TAU * t), yaw: 0.18 * Math.sin(TAU * t), roll: 0.04 * Math.sin(TAU * t), spin: i * 27 * D, eyeYaw: 0.9 * Math.sin(TAU * t), eyeTilt: 0.2 + 0.1 * Math.sin(2 * TAU * t) }));
let sp = 0;
const die = Array.from({ length: 45 }, (_, i) => { const t = i / 44;
  const e = t * t;
  sp += 24 * D * 1.3 * (1 - t) ** 1.5;
  return frame({ z: -14 * e, pitch: 0.9 * Math.min(1, t * 2), roll: 0.7 * e, yaw: 7 * e, spin: sp, eyeTilt: 0.7 * Math.min(1, t * 2) });
});
const sequences = [
  { name: "idle", fps: 30, loops: true, frames: idle },
  { name: "move", fps: 30, loops: true, frames: move },
  { name: "alert", fps: 30, loops: true, frames: alert },
  { name: "die", fps: 30, loops: false, frames: die },
];

const B = LIVERIES.bronze, P = LIVERIES.police;
const mdl = buildMdl({
  name: "drone.mdl",
  bones,
  attachments,
  bodyparts: [{ name: "body", models: [{ name: "drone", meshes: [
    { tris: toTris(main), texture: mainTex(B, "drone_body.bmp") },
    { tris: toTris(glow), texture: glowTex(B, "drone_glow.bmp") },
  ] }] }],
  sequences,
  skins: [{ "drone_body.bmp": mainTex(P, "drone_police.bmp"), "drone_glow.bmp": glowTex(P, "drone_pglow.bmp") }],
});
const rep = check(mdl, "goldsrc");
for (const l of [...rep.facts, ...rep.warnings.map((w) => "WARN " + w), ...rep.errors.map((e) => "ERROR " + e)]) console.log(l);
if (rep.errors.length) process.exit(1);
writeFileSync(join(OUT, "drone.mdl"), mdl);
console.log("drone.mdl", mdl.length, "bytes");
