// The furniture and goods of the H9 maps' interiors (levels/assembly/dress.mjs, dress/h9-byzantium.json) as studio models made by
// SMAK: nothing of any game's is in them, the textures are painted here. Shop shelves with their goods, display tables,
// crates, sacks and barrels for the shops and backrooms; beds, a wardrobe, a sideboard, a stove, a turned chair, a pedestal
// table and rugs for the flats.
//
//   node levels/art/h9-interiors.mjs [out folder, default levels/art/h9/models] [--sheet <folder>] [--only name,name]
//
// writes <name>.mdl for each model and interiors.json (each one's box, which the dress file's `models` entries copy);
// install as <H9>/ts/models/h9/<name>.mdl. Every model faces +x with its back plane on x = 0 (a wall piece) or is
// centred (a table, a rug); z = 0 is the floor.
//
// THE FORMS (the city's "Byzantine regal" look, levels/notes-h9.md, but lived in: worn oak and walnut, brass, burlap). None is a
// box: each is held under Half-Life's own props' 95th in 100 for faces on the axes (`smak form`), by what real furniture does:
//   shelves   splayed in plan (wider at the front, as a stepped shop shelf is), beaded planks at the back, a stepped cornice,
//             goods turned (jars, bottles, tins, vases), parcels and books set at a slant as they are left.
//   tables    a cloth thrown over the top and hanging in a flared skirt; a pedestal table on a tripod.
//   crates    slatted pine on skids with the sides splayed as a fruit crate's are, full of apples or bottle necks; a tea chest
//             with its lid ajar.
//   sacks     burlap, bulging, tied at the neck; barrels with iron hoops and a brass tap.
//   beds      iron and brass frames of turned posts and spindles, a puffed quilt in three palettes.
//   others    a wardrobe bowed at the front with a cove cornice and bun feet, a sideboard on splayed legs, a pot-bellied stove
//             with a pipe to the wall, a turned chair with a leaning back, rugs of three palettes laid in waves.
// The backs that stand against a wall are shallow V's (the wall never shows them), which is also what keeps a back off the axes.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildMdl, indexed, check, png, sheet, formOfMdl, judgeForm, kindOfName, solids as S, workshop } from "../../src/index.mjs";

const { fbm, noise, mix, times, rand } = workshop;
const OUT = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "levels/art/h9/models";
const SHEET = process.argv.includes("--sheet") ? process.argv[process.argv.indexOf("--sheet") + 1] : null;
const ONLY = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1].split(",") : null;

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
const wood = (base, dark, grain = 0.5) => (x, y) => {
  const g = fbm(x * 0.05, y * 0.9, 3, 3);
  const ring = 0.5 + 0.5 * Math.sin(y * 0.55 + 6 * fbm(x * 0.03, y * 0.1, 8, 3));
  return times(mix(base, dark, Math.min(1, grain * (0.6 * g + 0.5 * ring))), 0.85 + 0.3 * noise(x * 0.4, y * 0.4, 2));
};
const metal = (c, wear = 0.25) => (x, y) => times(c, 0.8 + 0.4 * fbm(x * 0.2, y * 0.2, 4, 3) - wear * Math.max(0, noise(x * 0.8, y * 0.8, 6) - 0.75));
const burlap = (x, y) => times([0.62, 0.5, 0.31], 0.7 + 0.5 * (0.5 + 0.25 * Math.sin(x * 1.6) * Math.sin(y * 1.6) + 0.25 * noise(x * 0.5, y * 0.5, 5)));
const glass = (c) => (x, y) => times(c, 0.55 + 0.7 * Math.pow(Math.max(0, Math.sin(Math.PI * (((x / 32) * 2) % 1))), 1.4) * (1 - 0.3 * (y / 32)));
const tinLabel = (body, band) => (x, y) => (y > 7 && y < 25 ? times(mix(band, [0.92, 0.88, 0.75], y > 11 && y < 21 ? 0.7 : 0), 0.9 + 0.2 * noise(x, y, 1)) : times(body, 0.85 + 0.3 * Math.pow(Math.max(0, Math.sin(Math.PI * (((x / 32) * 2) % 1))), 1.5)));
const cardboard = (c, band) => (x, y) => (Math.abs(y - 16) < 5 ? times(band, 0.9 + 0.2 * noise(x, y, 7)) : times(c, 0.8 + 0.4 * fbm(x * 0.4, y * 0.4, 9, 3)));
const spines = (x, y) => {
  const i = Math.floor(x / 5);
  const pal = [[0.5, 0.1, 0.1], [0.12, 0.25, 0.4], [0.16, 0.34, 0.2], [0.45, 0.3, 0.1], [0.3, 0.12, 0.3], [0.55, 0.48, 0.3], [0.18, 0.18, 0.2]];
  const c = pal[Math.floor(rand(i, 3, 1) * pal.length)];
  const band = Math.abs(y - 8 - rand(i, 4, 2) * 12) < 1.2 || y < 2 || y > 29;
  return times(band ? [0.85, 0.7, 0.35] : c, 0.8 + 0.3 * rand(i, y * 0.2, 3));
};
const quilt = (a, b) => (x, y) => {
  const chk = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? a : b;
  const stitch = Math.min(x % 8, y % 8) < 0.9 ? 0.78 : 1;
  return times(chk, stitch * (0.88 + 0.2 * noise(x * 0.7, y * 0.7, 4)));
};
const rugPaint = (main, accent, trim) => (x, y) => {
  const [W, H] = [128, 80];
  const d = Math.min(x, W - 1 - x, y, H - 1 - y);
  if (d < 3) return times([0.85, 0.8, 0.65], 0.8 + 0.2 * noise(x * 2, y * 2, 1));
  const weave = 0.88 + 0.16 * noise(x * 0.9, y * 0.9, 5);
  if (d < 6 || (d > 15 && d < 17)) return times(trim, weave);
  if (d <= 15) return times((Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? accent : main, weave * (0.9 + 0.15 * Math.sin(d * 1.1)));
  const dia = Math.abs((x - W / 2) / 24) + Math.abs((y - H / 2) / 14);
  if (dia < 1.0) return times(dia > 0.82 ? trim : accent, weave);
  if (dia > 1.25 && dia < 1.45) return times(trim, weave);
  return times(main, weave * (0.95 + 0.1 * Math.sin((x + y) * 0.7)));
};
const stone = (x, y) => {
  const vein = Math.abs(Math.sin((x * 0.09 + y * 0.05 + 6 * fbm(x * 0.03, y * 0.03, 4)) * 3));
  return mix(times([0.78, 0.76, 0.72], 0.8 + 0.3 * fbm(x * 0.08, y * 0.08, 4)), [0.35, 0.33, 0.33], Math.pow(1 - Math.min(1, vein * 4), 3) * 0.5);
};
const fruit = (a, b) => (x, y) => mix(a, b, 0.5 + 0.5 * Math.sin(x * 0.5 + 3 * noise(x * 0.2, y * 0.2, 2)));
const cloth = (c) => (x, y) => times(c, 0.82 + 0.2 * Math.sin(x * 1.2) * Math.sin(y * 1.2) + 0.15 * noise(x * 0.3, y * 0.3, 8));
const throwCloth = (c, trim) => (x, y) => (y < 5 || y > 58 ? times(trim, 0.9 + 0.15 * noise(x * 0.5, y * 0.5, 3)) : times(c, (0.95 + 0.15 * Math.sin(x * 0.8)) * (0.9 + 0.2 * noise(x * 0.3, y * 0.3, 8))));
const enamel = (c) => (x, y) => times(c, 0.85 + 0.25 * fbm(x * 0.1, y * 0.1, 3, 3) - 0.3 * Math.max(0, noise(x * 0.7, y * 0.7, 9) - 0.82));

const PAINT = {
  oak: [64, 64, wood([0.5, 0.36, 0.2], [0.3, 0.19, 0.09])],
  walnut: [64, 64, wood([0.34, 0.21, 0.12], [0.16, 0.09, 0.05], 0.8)],
  pine: [64, 64, wood([0.62, 0.5, 0.31], [0.4, 0.29, 0.15], 0.7)],
  iron: [32, 32, metal([0.12, 0.11, 0.1])],
  brass: [32, 32, metal([0.78, 0.58, 0.2], 0.1)],
  steel: [32, 32, metal([0.5, 0.5, 0.52], 0.3)],
  burlap: [64, 64, burlap],
  jar: [32, 32, glass([0.55, 0.62, 0.45])],
  amber: [32, 32, glass([0.62, 0.34, 0.1])],
  green: [32, 32, glass([0.15, 0.4, 0.2])],
  clear: [32, 32, glass([0.55, 0.7, 0.8])],
  wine: [32, 32, glass([0.35, 0.05, 0.1])],
  tin_r: [32, 32, tinLabel([0.7, 0.7, 0.72], [0.65, 0.12, 0.1])],
  tin_g: [32, 32, tinLabel([0.7, 0.7, 0.72], [0.2, 0.45, 0.2])],
  tin_y: [32, 32, tinLabel([0.7, 0.7, 0.72], [0.8, 0.62, 0.15])],
  card: [32, 32, cardboard([0.55, 0.42, 0.26], [0.7, 0.18, 0.12])],
  cardg: [32, 32, cardboard([0.5, 0.4, 0.27], [0.15, 0.3, 0.2])],
  cardw: [32, 32, cardboard([0.8, 0.75, 0.62], [0.12, 0.25, 0.45])],
  books: [32, 32, spines],
  ledger: [32, 32, cloth([0.22, 0.1, 0.1])],
  stone: [64, 64, stone],
  apple: [32, 32, fruit([0.7, 0.12, 0.08], [0.85, 0.5, 0.12])],
  lemon: [32, 32, fruit([0.85, 0.75, 0.15], [0.7, 0.6, 0.1])],
  c_red: [32, 64, throwCloth([0.55, 0.1, 0.12], [0.85, 0.7, 0.35])],
  c_blue: [32, 64, throwCloth([0.14, 0.22, 0.45], [0.85, 0.8, 0.6])],
  c_cream: [32, 32, cloth([0.8, 0.74, 0.58])],
  porcelain: [32, 32, enamel([0.85, 0.85, 0.82])],
  quilt_a: [64, 64, quilt([0.5, 0.12, 0.14], [0.8, 0.7, 0.5])],
  quilt_b: [64, 64, quilt([0.14, 0.24, 0.44], [0.75, 0.75, 0.7])],
  quilt_c: [64, 64, quilt([0.2, 0.38, 0.24], [0.7, 0.62, 0.4])],
  rug_a: [128, 80, rugPaint([0.45, 0.08, 0.1], [0.14, 0.18, 0.36], [0.85, 0.7, 0.4])],
  rug_b: [128, 80, rugPaint([0.12, 0.22, 0.4], [0.5, 0.2, 0.12], [0.85, 0.8, 0.6])],
  rug_c: [128, 80, rugPaint([0.2, 0.34, 0.22], [0.45, 0.3, 0.1], [0.8, 0.72, 0.45])],
};
const TEXTURES = {};
const texture = (key) => (TEXTURES[key] ??= (([w, h, fn]) => indexed(canvas(w, h, fn), `${key}.bmp`))(PAINT[key]));

// ── the mesh builder ───────────────────────────────────────────────────────
const sub = S.sub;
const RAD = Math.PI / 180;
const PL = () => S.place([0, 0, 0], [0, 0, 1], [1, 0, 0]);
const rounded = (v) => Math.round(v * 10) / 10;
function Model(name) {
  const parts = { case: {} };
  let cur = "case";
  /** Triangles `tris` ([[{ p }]]) with the planar texture coordinates of their solid's box. */
  const add = (mat, tris) => {
    const flat = tris.flat();
    if (!flat.length) return;
    const lo = [0, 1, 2].map((a) => Math.min(...flat.map((c) => c.p[a])));
    const hi = [0, 1, 2].map((a) => Math.max(...flat.map((c) => c.p[a])));
    texture(mat);
    for (const tri of tris) {
      const n = S.cross(sub(tri[1].p, tri[0].p), sub(tri[2].p, tri[0].p));
      const ax = [0, 1, 2].map((a) => Math.abs(n[a]));
      const major = ax.indexOf(Math.max(...ax));
      const [u, v] = major === 0 ? [1, 2] : major === 1 ? [0, 2] : [0, 1];
      ((parts[cur] ??= {})[mat] ??= []).push(
        tri.map(({ p }) => ({ p, uv: [0.02 + 0.96 * ((p[u] - lo[u]) / (hi[u] - lo[u] || 1)), 0.02 + 0.96 * (1 - (p[v] - lo[v]) / (hi[v] - lo[v] || 1))] })),
      );
    }
  };
  const solid = (mat, s) => add(mat, S.trisOf(s));
  /** An axis box from (x0, y0, z0) to (x1, y1, z1); `o`: cut, bevel, taper ... (solids.box). */
  const bx = (mat, [x0, x1], [y0, y1], [z0, z1], o = {}) => solid(mat, S.box(S.place([(x0 + x1) / 2, (y0 + y1) / 2, z0], [0, 0, 1], [1, 0, 0]), x1 - x0, y1 - y0, z1 - z0, { foot: true, ...o }));
  /** A box centred on (x, y), turned `yaw` degrees about z. */
  const bxr = (mat, x, y, z0, sx, sy, sz, yaw, o = {}) => solid(mat, S.box(S.place([x, y, z0], [0, 0, 1], [Math.cos(yaw * RAD), Math.sin(yaw * RAD), 0]), sx, sy, sz, { foot: true, ...o }));
  /** A box that leans: the top's rectangle moved (dx, dy) from the foot's, the sides slanting. */
  const lean = (mat, [x0, x1], [y0, y1], [z0, z1], dx, dy) => {
    const r = (ox, oy) => [[x0 + ox, y0 + oy], [x1 + ox, y0 + oy], [x1 + ox, y1 + oy], [x0 + ox, y1 + oy]];
    solid(mat, S.loft(PL(), [{ z: z0, poly: r(0, 0) }, { z: z1, poly: r(dx, dy) }], mat));
  };
  /** A convex outline in plan, a prism from z0 to z1 (its top `top` times the foot). */
  const prism = (mat, poly, z0, z1, top = 1) => solid(mat, S.prism(PL(), S.outline(poly), z0, z1, { top }));
  /** The same, a plate with its top's edge bevelled. */
  const slab = (mat, poly, z0, t, bevel = 0.6, top = 1) => solid(mat, S.plate(PL(), S.outline(poly), t, { z0, bevel, top }));
  /** Convex rings stacked: [{ z, poly }]. */
  const loft = (mat, rings) => solid(mat, S.loft(PL(), rings, mat));
  /** A turned thing on (x, y) from z0: profile [[radius, z above z0]]. */
  const turn = (mat, x, y, z0, profile, n = 10) => solid(mat, S.lathe(S.place([x, y, z0], [0, 0, 1], [1, 0, 0]), profile, { n }));
  /** A closed (x, z) profile swept along y. */
  const alongY = (mat, profile, y0, y1) => add(mat, S.sweepTris(profile, [[0, y0, 0], [0, y1, 0]], { up: [0, 0, 1] }));
  /** A closed plan profile [[y, x]] swept up along z. */
  const alongZ = (mat, profile, z0, z1) => add(mat, S.sweepTris(profile, [[0, 0, z0], [0, 0, z1]], { up: [1, 0, 0] }));
  const rod = (mat, p0, p1, r, o = {}) => solid(mat, S.tube(p0, p1, r, { n: 8, ...o }));
  const beam = (mat, p0, p1, w, d, up, o = {}) => solid(mat, S.beam(p0, p1, w, d, up, o));
  const part = (p) => (cur = p);
  const finish = () => {
    const all = [];
    const bodyparts = Object.entries(parts)
      .filter(([, mats]) => Object.keys(mats).length)
      .map(([pn, mats]) => {
        const meshes = Object.entries(mats).map(([mat, tris]) => {
          for (const t of tris) for (const c of t) all.push(c.p);
          return { tris, texture: texture(mat) };
        });
        return { name: pn, models: [{ name: `${name}_${pn}`, meshes }] };
      });
    return boxed(name, bodyparts, all);
  };
  return { add, solid, bx, bxr, lean, prism, slab, loft, turn, alongY, alongZ, rod, beam, part, finish };
}
/** The model of `bodyparts` with its box from the points `all`. */
function boxed(name, bodyparts, all) {
  const lo = [0, 1, 2].map((a) => Math.min(...all.map((p) => p[a])));
  const hi = [0, 1, 2].map((a) => Math.max(...all.map((p) => p[a])));
  const mdl = buildMdl({ name: `${name}.mdl`, bodyparts, bbmin: lo, bbmax: hi, min: lo, max: hi });
  const tris = bodyparts.reduce((s, b) => s + b.models[0].meshes.reduce((q, mesh) => q + mesh.tris.length, 0), 0);
  return { mdl, lo: lo.map(rounded), hi: hi.map(rounded), tris };
}
const seeded = (seed) => {
  let i = 0;
  return () => rand(seed, i++, 11);
};
const rr = (r, a, b) => a + (b - a) * r();
const pick = (r, list) => list[Math.floor(r() * list.length)];

// ── goods ──────────────────────────────────────────────────────────────────
const goods = {
  jar(m, x, y, z, r, h, glass = "jar") {
    m.turn(glass, x, y, z, [[r * 0.7, 0], [r, 0.8], [r, h * 0.72], [r * 0.62, h * 0.86], [r * 0.5, h * 0.9]], 8);
    m.turn("brass", x, y, z, [[r * 0.52, h * 0.9], [r * 0.58, h * 0.93], [r * 0.58, h], [r * 0.3, h * 1.02]], 8);
  },
  tin(m, x, y, z, r, h, mat) {
    m.turn(mat, x, y, z, [[r - 0.4, 0], [r, 0.4], [r, h - 0.4], [r - 0.4, h]], 8);
  },
  bottle(m, x, y, z, r, h, mat, n = 8) {
    m.turn(mat, x, y, z, [[r * 0.8, 0], [r, 0.6], [r, h * 0.52], [r * 0.7, h * 0.64], [r * 0.34, h * 0.76], [r * 0.32, h * 0.95], [r * 0.4, h]], n);
  },
  /** A parcel set at a slant on its board. */
  parcel(m, x, y, z, w, d, h, mat, yaw = 0) {
    m.bxr(mat, x, y, z, d, w, h, yaw, { bevel: Math.min(0.5, h / 4) });
  },
  vase(m, x, y, z, r, h, mat = "porcelain") {
    m.turn(mat, x, y, z, [[r * 0.5, 0], [r * 0.7, 0.5], [r, h * 0.35], [r * 0.9, h * 0.55], [r * 0.45, h * 0.8], [r * 0.5, h * 0.92], [r * 0.7, h]], 8);
  },
  clock(m, x, y, z, r) {
    m.turn("brass", x, y, z, [[r * 0.7, 0], [r * 0.8, 1], [r * 0.5, r * 0.8], [r * 0.6, r * 1.4], [r * 0.5, r * 2]], 8);
  },
  chest(m, x, y, z, w, d, h, yaw = 0) {
    m.bxr("walnut", x, y, z, d, w, h, yaw, { bevel: 0.8, taper: 0.9 });
    m.bxr("brass", x + Math.cos(yaw * RAD) * (d / 2), y + Math.sin(yaw * RAD) * (d / 2), z + h * 0.5, 0.8, 1.6, h * 0.3, yaw, { bevel: 0.2 });
  },
  lantern(m, x, y, z, r) {
    m.turn("iron", x, y, z, [[r * 0.6, 0], [r, 0.8], [r * 0.9, 1.5]], 6);
    m.turn("amber", x, y, z + 1.5, [[r * 0.9, 0], [r * 1.1, r * 1.4], [r * 0.8, r * 2.6]], 6);
    m.turn("iron", x, y, z + 1.5 + r * 2.6, [[r * 0.9, 0], [r * 0.4, r * 0.8], [r * 0.2, r * 1.2]], 6);
  },
  basket(m, x, y, z, r, h) {
    m.turn("pine", x, y, z, [[r * 0.6, 0], [r, h], [r * 1.05, h * 1.1], [r * 0.95, h * 1.1]], 10);
  },
  apple(m, x, y, z, r, mat = "apple") {
    m.solid(mat, S.ball([x, y, z + r * 0.8], r, [0, 0, 1], { n: 8 }));
  },
};

// ── a shelving unit: splayed in plan, 12 deep, 48 across at the front, 90 high ──
const D = 12;
const H = 90;
const HB = 18.8; // half the back's width
const HF = 23.2; // half the front's
const halfAt = (x) => HB + ((HF - HB) * x) / D;
const BOARDS = [7, 28, 49, 70];
const GY = 16; // the goods' half span across
/** `fill(m, r, board, z)`: puts goods on one board of the unit, in y -GY..GY, x 3..11. */
function shelf(name, fill, wood = "oak", seed = 1) {
  const m = Model(name);
  const r = seeded(seed);
  const side = (s) => [[0, s * HB], [D, s * HF], [D, s * (HF - 2.8)], [0, s * (HB - 2.8)]];
  const board = (e = 0) => [[1.6, -(halfAt(1.6) - 2.8) - e], [D - 0.4, -(HF - 2.8) - e], [D - 0.4, HF - 2.8 + e], [1.6, halfAt(1.6) - 2.8 + e]];
  // uprights (the plan's sides slant out), a plinth, a back of beaded planks, the boards, and a stepped cornice
  for (const s of [-1, 1]) m.prism(wood, side(s), 0, H - 5, 1);
  m.prism(wood, board(-0.6), 0, 5);
  const planks = 8;
  const pw = (2 * (HB - 2.8)) / planks;
  for (let k = 0; k < planks; k++) {
    const c = -(HB - 2.8) + (k + 0.5) * pw;
    const h = pw / 2;
    m.alongZ(wood, [[c - h + 0.2, 0.9], [c, 0], [c + h - 0.2, 0.9], [c + h, 1.6], [c + h - 0.9, 2.1], [c - h + 0.9, 2.1], [c - h, 1.6]], 4, H - 4);
  }
  BOARDS.forEach((z) => m.slab(wood, board(), z, 1.8, 0.5));
  m.slab(wood, board(1.6).map(([x, y]) => [x + (x > 5 ? 1.2 : -0.2), y]), H - 6, 2.6, 0.4);
  m.slab(wood, board(2.8).map(([x, y]) => [x + (x > 5 ? 2.2 : -0.2), y]), H - 3.4, 3.4, 1.2);
  m.part("goods");
  BOARDS.forEach((z, i) => fill(m, r, i, z + 1.8));
  return m;
}
/** Walks goods across a board: `make(y, end)` places one and returns its width, or 0 when it will not fit. */
const across = (y0, y1, make, gap = 0.7) => {
  let y = y0;
  for (let guard = 0; y < y1 - 2 && guard < 60; guard++) {
    const used = make(y, y1);
    if (!used) break;
    y += used + gap;
  }
};
function fillGrocery(m, r, i, z) {
  const kind = i % 4;
  across(-GY, GY, (y, end) => {
    if (kind === 0) {
      const rad = rr(r, 2.2, 3.2);
      if (y + rad * 2 > end) return 0;
      goods.jar(m, 6.2, y + rad, z, rad, rr(r, 8, 12), r() < 0.5 ? "jar" : "amber");
      return rad * 2;
    }
    if (kind === 1) {
      const rad = rr(r, 1.8, 2.4);
      if (y + rad * 2 > end) return 0;
      for (const dx of [4, 8.4]) goods.tin(m, dx, y + rad, z, rad, rr(r, 5, 7.5), pick(r, ["tin_r", "tin_g", "tin_y"]));
      return rad * 2;
    }
    if (kind === 2) {
      const w = rr(r, 5, 7);
      if (y + w > end) return 0;
      goods.parcel(m, 6.4, y + w / 2, z, w, 7, rr(r, 8, 13), pick(r, ["card", "cardw", "cardg"]), rr(r, -25, 25));
      return w + 1;
    }
    const rad = rr(r, 2, 2.8);
    if (y + rad * 2 > end) return 0;
    goods.bottle(m, 6.2, y + rad, z, rad, rr(r, 12, 16), r() < 0.5 ? "green" : "clear", 6);
    return rad * 2;
  });
}
function fillPawn(m, r, i, z) {
  across(-GY, GY, (y, end) => {
    const p = r();
    const rad = rr(r, 2.4, 3.4);
    if (y + rad * 2 > end) return 0;
    if (p < 0.3) goods.clock(m, 6.3, y + rad, z, rad);
    else if (p < 0.55) goods.vase(m, 6.3, y + rad, z, rad, rr(r, 8, 13), r() < 0.5 ? "porcelain" : "brass");
    else if (p < 0.8) {
      goods.chest(m, 6.4, y + rad + 1, z, rad * 2.8, 7, rr(r, 4, 7), rr(r, -20, 20));
      return rad * 2.8 + 0.6;
    } else goods.lantern(m, 6.3, y + rad, z, rad * 0.8);
    return rad * 2;
  });
}
function fillApothecary(m, r, i, z) {
  across(-GY, GY, (y, end) => {
    const rad = rr(r, 1.8, 2.8);
    if (i % 2 === 0 || r() < 0.3) {
      if (y + rad * 2 > end) return 0;
      goods.bottle(m, 6.2, y + rad, z, rad, rr(r, 8, 14), pick(r, ["amber", "green", "clear"]), 6);
      return rad * 2;
    }
    const w = rr(r, 4, 7);
    if (y + w > end) return 0;
    goods.parcel(m, 6.4, y + w / 2, z, w, 6, rr(r, 5, 9), r() < 0.6 ? "cardw" : "card", rr(r, -30, 30));
    return w + 0.8;
  });
}
function fillBottles(m, r, i, z) {
  across(-GY, GY, (y, end) => {
    const rad = rr(r, 2, 2.8);
    if (y + rad * 2 > end) return 0;
    const mat = pick(r, ["wine", "green", "amber", "clear"]);
    goods.bottle(m, 4.4, y + rad, z, rad, rr(r, 14, 19), mat, 5);
    if (i % 2 === 0) goods.bottle(m, 9.2, y + rad, z, rad * 0.95, rr(r, 14, 19), mat, 5);
    return rad * 2;
  }, 0.5);
}
function fillBooks(m, r, i, z, mat = "books") {
  let y = -GY;
  let k = 0;
  while (y < GY - 2 && k++ < 40) {
    const t = rr(r, 1.8, 3);
    const h = rr(r, 11, 17);
    if (y + t > GY) break;
    // a run of upright books; some lean on the next
    if (r() < 0.45 && y + h * 0.4 < GY) {
      const lx = h * Math.tan(rr(r, 9, 16) * RAD);
      m.lean(mat, [3, 10.4], [y, y + t], [z, z + h], 0, lx);
      y += t + lx * 0.7;
    } else {
      m.bx(mat, [3, 10.4], [y, y + t], [z, z + h], { bevel: 0.35, cut: 0.4 });
      y += t + 0.15;
    }
  }
}
function fillBoxes(m, r, i, z) {
  across(-GY, GY, (y, end) => {
    const w = rr(r, 7, 11);
    if (y + w > end) return 0;
    const h = rr(r, 8, 14);
    const yaw = rr(r, 12, 32) * (r() < 0.5 ? -1 : 1);
    goods.parcel(m, 6.5, y + w / 2, z, w, 8, h, pick(r, ["card", "cardg", "cardw"]), yaw);
    if (r() < 0.35) goods.parcel(m, 6.5, y + w / 2, z + h, w * 0.7, 6, rr(r, 4, 6), "card", yaw + 25);
    return w * 0.9;
  }, 0.4);
}

// ── the models ─────────────────────────────────────────────────────────────
const MODELS = {};
const def = (name, fn) => (MODELS[name] = fn);
def("shelf_grocery", () => shelf("shelf_grocery", fillGrocery, "oak", 3));
def("shelf_pawn", () => shelf("shelf_pawn", fillPawn, "walnut", 5));
def("shelf_apoth", () => shelf("shelf_apoth", fillApothecary, "walnut", 7));
def("shelf_bottles", () => shelf("shelf_bottles", fillBottles, "walnut", 9));
def("shelf_ledger", () => shelf("shelf_ledger", (m, r, i, z) => fillBooks(m, r, i, z, i % 2 ? "ledger" : "books"), "oak", 11));
def("shelf_boxes", () => shelf("shelf_boxes", fillBoxes, "pine", 13));
def("shelf_books", () => shelf("shelf_books", fillBooks, "oak", 17));

/** A rounded rectangle outline: corners cut in `n` steps. */
const roundRect = (sx, sy, rad, n = 3) => {
  const pts = [];
  const cs = [[sx / 2 - rad, sy / 2 - rad, 0], [-sx / 2 + rad, sy / 2 - rad, Math.PI / 2], [-sx / 2 + rad, -sy / 2 + rad, Math.PI], [sx / 2 - rad, -sy / 2 + rad, (3 * Math.PI) / 2]];
  for (const [cx, cy, a0] of cs) for (let k = 0; k <= n; k++) pts.push([cx + rad * Math.cos(a0 + ((Math.PI / 2) * k) / n), cy + rad * Math.sin(a0 + ((Math.PI / 2) * k) / n)]);
  return pts;
};
const scaleOutline = (poly, sx, sy = sx) => poly.map(([x, y]) => [x * sx, y * sy]);

/** A display table: a cloth thrown over it, flared to a hem, goods on top. */
function displayTable(name, clothMat, seed) {
  const m = Model(name);
  const r = seeded(seed);
  const [L, Wd] = [66, 36];
  const top = roundRect(Wd, L, 4.5, 3);
  const hem = roundRect(Wd + 11, L + 11, 7, 3);
  // (the drape: the top at 30, the hem at 6; and under it a cone, so the underside slopes too)
  m.loft(clothMat, [
    { z: 2, poly: scaleOutline(hem, 0.3) },
    { z: 6, poly: hem },
    { z: 7.4, poly: scaleOutline(hem, 0.985) },
    { z: 22, poly: scaleOutline(hem, 0.93, 0.95) },
    { z: 28.2, poly: scaleOutline(top, 1.03) },
    { z: 29.4, poly: scaleOutline(top, 0.95) },
    { z: 30, poly: scaleOutline(top, 0.8) },
  ]);
  m.part("goods");
  goods.basket(m, -6, -21, 30, 6.2, 4);
  for (let k = 0; k < 7; k++) goods.apple(m, -6 + rr(r, -3.5, 3.5), -21 + rr(r, -3.5, 3.5), 33.4, 2.1, r() < 0.5 ? "apple" : "lemon");
  goods.jar(m, 3, -6, 30, 2.8, 10, "amber");
  goods.jar(m, -3, 2, 30, 2.4, 9, "jar");
  goods.vase(m, 4, 14, 30, 3.4, 12);
  goods.parcel(m, -2, 24, 30, 12, 9, 3, "c_cream", 14);
  goods.parcel(m, -2, 24, 33, 11, 8, 3, "card", -10);
  goods.tin(m, 6, 24, 30, 2.2, 6, "tin_r");
  return m;
}
def("table_display", () => displayTable("table_display", "c_red", 21));
def("table_display_b", () => displayTable("table_display_b", "c_blue", 23));

/** A fruit crate on skids: the sides splayed 8 degrees, slatted; `top`: what shows over its rim. */
function crate(name, top, seed = 1) {
  const m = Model(name);
  const r = seeded(seed);
  const [w0, d0, h] = [34, 26, 24]; // the foot's span (y, x) and the height
  const k = Math.tan(8 * RAD);
  const ex = (z) => (z - 3.6) * k; // the splay at z
  const hw = (z) => w0 / 2 + ex(z);
  const hd = (z) => d0 / 2 + ex(z);
  for (const sy of [-1, 1]) m.bx("pine", [-d0 / 2 - 1, d0 / 2 + 1], sy < 0 ? [-w0 / 2 - 1, -w0 / 2 + 3] : [w0 / 2 - 3, w0 / 2 + 1], [0, 3.6], { bevel: 0.6 });
  const slat = 5.4;
  const rows = Math.floor((h - 3.6) / (slat + 0.8));
  for (let i = 0; i < rows; i++) {
    const z0 = 3.6 + 0.4 + i * (slat + 0.8);
    const z1 = z0 + slat;
    const grow = ex(z1) - ex(z0);
    for (const s of [-1, 1]) {
      // the sides (along x) at y = s * hw: their outer face leans out; the ends likewise
      m.lean("pine", [-hd(z0) + 0.5, hd(z0) - 0.5], s < 0 ? [-hw(z0), -hw(z0) + 1.3] : [hw(z0) - 1.3, hw(z0)], [z0, z1], 0, s * grow);
      m.lean("pine", s < 0 ? [-hd(z0), -hd(z0) + 1.3] : [hd(z0) - 1.3, hd(z0)], [-hw(z0) + 1.3, hw(z0) - 1.3], [z0, z1], s * grow, 0);
    }
  }
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const [z0, z1] = [3.6, h];
      const grow = ex(z1) - ex(z0);
      m.lean("oak", sx < 0 ? [-hd(z0), -hd(z0) + 3] : [hd(z0) - 3, hd(z0)], sy < 0 ? [-hw(z0), -hw(z0) + 3] : [hw(z0) - 3, hw(z0)], [z0, z1], sx * grow, sy * grow);
    }
  m.bx("iron", [-d0 / 2 + 2, d0 / 2 - 2], [-w0 / 2 + 2, w0 / 2 - 2], [3.6, 5]);
  m.part("goods");
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 5; j++) {
      const x = -d0 / 2 + 5 + i * 5.6 + rr(r, -0.8, 0.8);
      const y = -w0 / 2 + 5 + j * 6 + rr(r, -0.8, 0.8);
      if (top === "apples") goods.apple(m, x, y, h - 6, 2.8, r() < 0.7 ? "apple" : "lemon");
      else goods.bottle(m, x, y, h - 9, 2.4, 12.5, ["wine", "green", "amber"][(i + j) % 3], 6);
    }
  return m;
}
def("crate_apples", () => crate("crate_apples", "apples", 2));
def("crate_bottles", () => crate("crate_bottles", "bottles", 4));

/** A tea chest: tapered, bound with iron, its lid slid half off. */
def("crate_closed", () => {
  const m = Model("crate_closed");
  const [wb, wt, h] = [34, 42, 36];
  const sq = (half, z) => ({ z, poly: [[-half, -half], [half, -half], [half, half], [-half, half]] });
  m.loft("pine", [sq(wb / 2 - 2, 0), sq(wb / 2, 1.2), sq(wt / 2, h)]);
  const half = (zz) => wb / 2 + ((wt - wb) / 2) * (zz / h);
  for (const z of [5, 17, 30]) m.loft("iron", [sq(half(z) + 0.4, z), sq(half(z + 2.4) + 0.4, z + 2.4)]);
  // the lid, tilted and pushed to one side on the rim, and a batten under it
  m.beam("pine", [-6, -15, h + 1.5], [6, 15, h + 8.5], 38, 3, [30, -12, 0], { bevel: 0.6 });
  m.beam("pine", [-14, -4, h + 3], [-12, 8, h + 6.4], 6, 2.4, [12, -2, 0], { bevel: 0.4 });
  m.part("goods");
  m.turn("burlap", 0, 6, h - 6, [[0.1, 0], [10, 2], [13, 7], [8, 9], [0.1, 10]], 8);
  return m;
});

function sack(m, x, y, z, k = 1) {
  const prof = [[0.1, 0], [8.5, 0.4], [11.5, 4], [12.8, 10], [12, 17], [9.5, 23], [5.5, 27], [3.2, 29.5], [4.6, 31.5], [3.4, 34], [1.8, 36]].map(([rad, zz]) => [rad * k, zz * k]);
  m.turn("burlap", x, y, z, prof, 10);
  m.turn("brass", x, y, z + 29.2 * k, [[3.6 * k, 0], [3.9 * k, 0.6], [3.6 * k, 1.2]], 8);
}
def("sacks", () => {
  const m = Model("sacks");
  sack(m, -9, -6, 0, 1);
  sack(m, -9, 15, 0, 0.92);
  sack(m, 12, 4, 0, 0.85);
  m.solid("burlap", S.lathe(S.place([-9, -4, 20], [0, 1, 0], [0, 0, 1]), [[0.1, 0], [6.5, 0.6], [9, 4], [10, 10], [9.5, 16], [6.5, 21], [0.1, 22]], { n: 10 }));
  return m;
});
def("barrel", () => {
  const m = Model("barrel");
  const prof = [[8.3, 0], [9.4, 1.5], [11, 8], [12, 15], [12.4, 20], [12, 25], [11, 32], [9.4, 38.5], [8.3, 40]];
  const rad = (zz) => {
    for (let i = 0; i + 1 < prof.length; i++) if (zz >= prof[i][1] && zz <= prof[i + 1][1]) return prof[i][0] + ((prof[i + 1][0] - prof[i][0]) * (zz - prof[i][1])) / (prof[i + 1][1] - prof[i][1]);
    return 8.3;
  };
  m.turn("oak", 0, 0, 0, prof, 12);
  m.turn("oak", 0, 0, 39.6, [[8.2, 0], [7.6, 0.6], [0.1, 1.4]], 12);
  for (const z of [4, 12, 28, 36]) m.turn("iron", 0, 0, z - 1, [[rad(z - 1) + 0.2, 0], [rad(z) + 0.7, 1], [rad(z + 1) + 0.7, 1.4], [rad(z + 1) + 0.2, 2]], 12);
  m.rod("brass", [12, 0, 10], [16, 0, 10], 1.1);
  m.rod("brass", [16, 0, 10], [16, 0, 7], 0.9);
  return m;
});

/** A bed of turned posts and spindles, head at x = 0; `frame`: its metal or wood, `trim` the brass or iron on it. */
function bed(name, quiltMat, frame, trim) {
  const m = Model(name);
  const L = 78;
  const hw = 21;
  for (const [x0, h] of [[1.7, 52], [L - 1.7, 34]])
    for (const sy of [-1, 1]) {
      const y = sy * (hw - 1.4);
      m.turn(frame, x0, y, 0, [[1.3, 0], [2, 2], [1.4, 6], [2.2, 10], [1.5, 15], [1.8, h - 8], [2.2, h - 6], [1.4, h - 4], [2.4, h - 2.6], [1.3, h - 1.2]], 8);
      m.turn(trim, x0, y, h - 1.4, [[1.4, 0], [2.2, 1.2], [2.6, 2.6], [1.8, 4], [0.1, 5]], 8);
    }
  // head and foot frames: a top and a lower rail, spindles between, an arch of tube over the head
  for (const [x0, top, low] of [[1.7, 44, 16], [L - 1.7, 28, 14]]) {
    const y = hw - 1.4;
    m.rod(frame, [x0, -y, top], [x0, y, top], 1.3, { n: 8 });
    m.rod(frame, [x0, -y, low], [x0, y, low], 1.1, { n: 8 });
    for (let i = -4; i <= 4; i++) m.turn(i % 2 ? frame : trim, x0, (i * (y - 1.6)) / 4.4, low, [[0.6, 0], [0.9, 2], [0.5, 5], [0.7, (top - low) / 2], [0.5, top - low - 3], [0.9, top - low - 0.5]], 6);
    if (x0 < 10) {
      const arch = [];
      for (let k = 0; k <= 10; k++) {
        const a = (k / 10) * Math.PI;
        arch.push([x0, -y * Math.cos(a), top + 6 * Math.sin(a)]);
      }
      for (let k = 0; k < 10; k++) m.rod(trim, arch[k], arch[k + 1], 1, { n: 6 });
    }
  }
  for (const sy of [-1, 1]) m.rod(frame, [1.7, sy * (hw - 1.4), 13], [L - 1.7, sy * (hw - 1.4), 13], 1.3, { n: 8 });
  m.part("goods");
  // the quilt over the mattress, puffed in the middle
  const cx = L / 2 + 1.5;
  const q = (z, hl, hy) => ({ z, poly: [[cx - hl, -hy], [cx + hl, -hy], [cx + hl, hy], [cx - hl, hy]] });
  m.loft(quiltMat, [q(13, 24, 6), q(16, 35, 17.5), q(20, 36, 19.5), q(24, 36, 19), q(26.4, 35, 16), q(28, 33, 11), q(28.8, 30, 6), q(29, 24, 0.5)]);
  for (const s of [-1, 1]) {
    const cy = s * 9.2;
    const rc = (z, hx, hy) => ({ z, poly: [[12.5 - hx, cy - hy], [12.5 + hx, cy - hy], [12.5 + hx, cy + hy], [12.5 - hx, cy + hy]] });
    m.loft("c_cream", [rc(23, 7, 8), rc(27, 8, 9), rc(31, 5.5, 6), rc(32, 2, 2)]);
  }
  return m;
}
def("bed_a", () => bed("bed_a", "quilt_a", "iron", "brass"));
def("bed_b", () => bed("bed_b", "quilt_b", "walnut", "brass"));
def("bed_c", () => bed("bed_c", "quilt_c", "brass", "iron"));

def("wardrobe", () => {
  const m = Model("wardrobe");
  const h = 82;
  const front = (y, grow = 0) => 14 + (6 + grow * 0.2) * Math.sqrt(Math.max(0, 1 - (y / (26 + grow)) ** 2));
  // a plan bowed at the front, sides splayed to it, the back a shallow V: swept up (y, x)
  const bow = (grow) => {
    const pts = [[-22 - grow, 0], [0, 3.2], [22 + grow, 0], [26 + grow, 14]];
    for (let k = 1; k < 8; k++) {
      const y = (26 + grow) * Math.cos((k / 8) * Math.PI);
      pts.push([y, front(y, grow)]);
    }
    pts.push([-26 - grow, 14]);
    return pts;
  };
  m.alongZ("walnut", bow(0), 7, h - 7);
  // doors: a raised panel on each half of the bowed front, a groove between
  for (const s of [-1, 1]) {
    const [y0, y1] = s < 0 ? [-21, -3] : [3, 21];
    const pts = [];
    for (let k = 0; k <= 5; k++) pts.push([y0 + ((y1 - y0) * k) / 5, front(y0 + ((y1 - y0) * k) / 5) + 0.6]);
    for (let k = 5; k >= 0; k--) pts.push([y0 + ((y1 - y0) * k) / 5, front(y0 + ((y1 - y0) * k) / 5) - 0.5]);
    m.alongZ("oak", pts, 14, h - 14);
    m.solid("brass", S.ball([front(s * 3.4) + 1.6, s * 3.4, h * 0.5], 1.4, [1, 0, 0], { n: 6 }));
  }
  m.alongZ("walnut", bow(2.2), h - 7, h - 3.6);
  m.alongZ("walnut", bow(3.4), h - 3.6, h);
  m.alongZ("walnut", bow(1.6), 3.6, 7);
  for (const [x, y] of [[4, -21], [4, 21], [17, -23], [17, 23]]) m.turn("walnut", x, y, 0, [[1.8, 0], [2.4, 1.2], [3, 3], [2.6, 5.4], [3.2, 6.1]], 8);
  return m;
});

def("sideboard", () => {
  const m = Model("sideboard");
  const h = 36;
  const bowed = (y, grow = 0) => 16 + grow + 1.8 * Math.sin((y / 28) * Math.PI * 1.5);
  // a serpentine front: the plan swept up, the stone top over it, splayed legs
  const plan = (grow) => {
    const pts = [[-28 - grow, 0], [0, 2.6], [28 + grow, 0]];
    for (let k = 0; k <= 12; k++) {
      const y = 28 + grow - (k / 12) * 2 * (28 + grow);
      pts.push([y, bowed(y, grow)]);
    }
    return pts;
  };
  m.alongZ("walnut", plan(0), 12, h - 3);
  for (const s of [-1, 1]) {
    const [y0, y1] = s < 0 ? [-26, -9.5] : [9.5, 26];
    const pts = [];
    for (let k = 0; k <= 5; k++) pts.push([y0 + ((y1 - y0) * k) / 5, bowed(y0 + ((y1 - y0) * k) / 5) + 0.6]);
    for (let k = 5; k >= 0; k--) pts.push([y0 + ((y1 - y0) * k) / 5, bowed(y0 + ((y1 - y0) * k) / 5) - 0.4]);
    m.alongZ("oak", pts, 15, h - 6);
    m.solid("brass", S.ball([bowed(s * 12) + 1.4, s * 12, 24], 1.2, [1, 0, 0], { n: 6 }));
  }
  m.alongZ("walnut", plan(1.2), h - 3, h - 0.4);
  m.alongZ("stone", plan(1.9), h - 0.4, h + 2.4);
  for (const [x, y, dx, dy] of [[3, -25, -2.4, -2.4], [3, 25, -2.4, 2.4], [14, -25, 2.4, -2.4], [14, 25, 2.4, 2.4]]) {
    m.rod("walnut", [x, y, 12], [x + dx, y + dy, 0.4], 1.9, { n: 8, r1: 1.2 });
    m.turn("walnut", x + dx, y + dy, 0, [[1.3, 0], [1.8, 0.6], [1.2, 2]], 8);
  }
  m.alongZ("walnut", plan(0.6), 10, 12.4);
  return m;
});

def("stove", () => {
  const m = Model("stove");
  m.slab("iron", roundRect(32, 32, 7, 3).map(([x, y]) => [x + 17, y]), 0, 1.2, 0.4);
  m.turn("iron", 17, 0, 6, [[0.1, 0], [5.5, 0], [8, 2], [10.8, 9], [11.8, 17], [10.2, 25], [7.2, 29], [4, 31.5], [3.8, 33]], 12);
  for (let k = 0; k < 4; k++) {
    const a = (Math.PI / 2) * k + Math.PI / 4;
    m.rod("iron", [17 + 8 * Math.cos(a), 8 * Math.sin(a), 5], [17 + 9.5 * Math.cos(a), 9.5 * Math.sin(a), 1.2], 1.2, { n: 6 });
  }
  m.turn("steel", 17, 0, 38.5, [[3.8, -0.5], [4.4, 0.4], [3.6, 1.2]], 10);
  m.turn("brass", 17, 0, 6, [[11.9, 14], [12.3, 15], [12.3, 16], [11.9, 17]], 12);
  m.lean("steel", [27.6, 29.2], [-4.5, 4.5], [14, 24], 0.8, 0);
  m.turn("brass", 29.2, 0, 19, [[0.1, 0], [1.2, 0.2], [0.9, 1.2], [1.6, 2], [0.1, 2.4]], 8);
  m.rod("iron", [17, 0, 38.5], [17, 0, 84], 2.3, { n: 10 });
  m.turn("iron", 17, 0, 60, [[2.3, 0], [3, 0.8], [3, 2], [2.3, 2.8]], 10);
  m.rod("iron", [17, 0, 84], [13.5, 0, 91], 2.3, { n: 10 });
  m.rod("iron", [13.5, 0, 91], [1.5, 0, 91], 2.3, { n: 10 });
  m.turn("iron", 0.8, 0, 87, [[0.1, 0], [3.6, 0], [3.6, 0.7], [0.1, 0.7]], 10);
  return m;
});

def("chair_turned", () => {
  const m = Model("chair_turned");
  m.slab("oak", roundRect(18, 18, 4, 3), 18, 2, 0.7, 0.96);
  for (const [x, y] of [[7, 7], [7, -7], [-7, 7], [-7, -7]]) m.turn("walnut", x, y, 0, [[0.9, 0], [1.1, 4], [0.9, 8], [1.4, 12], [1.2, 17]], 6);
  for (const y of [-7, 7]) {
    m.rod("walnut", [-6.5, y, 20], [-10.5, y, 41], 1.15, { n: 6 });
    m.rod("walnut", [-5, y, 8], [5, y, 8], 0.55, { n: 4 });
  }
  m.rod("walnut", [-6.2, -7, 9], [-6.2, 7, 9], 0.55, { n: 4 });
  m.beam("oak", [-10.2, -8, 40.5], [-10.2, 8, 40.5], 2, 3.8, [1, 0, 0], { bevel: 0.5 });
  for (const y of [-2.6, 2.6]) m.beam("oak", [-7.5, y, 22], [-10, y, 38], 3.2, 0.9, [1, 0, 0], { bevel: 0.2 });
  return m;
});

def("table_pedestal", () => {
  const m = Model("table_pedestal");
  m.turn("walnut", 0, 0, 27, [[0.1, 0], [17, 0], [21, 0.8], [21.6, 2], [20.4, 3], [14, 3.6], [0.1, 3.8]], 14);
  m.turn("walnut", 0, 0, 0, [[4.6, 0], [4, 2], [2.6, 6], [3.4, 10], [2.2, 14], [2.8, 20], [4.8, 24], [6, 27.4]], 10);
  for (let k = 0; k < 3; k++) {
    const a = (2 * Math.PI * k) / 3 + Math.PI / 2;
    m.rod("walnut", [3 * Math.cos(a), 3 * Math.sin(a), 8], [17 * Math.cos(a), 17 * Math.sin(a), 1.2], 2, { n: 6, r1: 1.4 });
    m.turn("walnut", 17 * Math.cos(a), 17 * Math.sin(a), 0, [[1.1, 0], [2, 0.8], [1.8, 1.8], [0.1, 2.4]], 6);
  }
  m.turn("c_cream", 0, 0, 30.6, [[0.1, 0], [10, 0.1], [11, 0.4], [10, 0.7], [0.1, 0.7]], 14);
  m.part("goods");
  goods.vase(m, 0, 0, 31.3, 3.4, 11, "porcelain");
  return m;
});

/** A rug (78 by 50) laid in gentle waves, its edge rolled down: an open surface with no underside. */
function rug(name, mat) {
  const [L, Wd] = [78, 50];
  const [nx, ny] = [13, 9];
  const rise = (u, v) => 0.5 + 0.55 * Math.min(1, (1 - Math.abs(u)) * 8, (1 - Math.abs(v)) * 8) + 0.45 * Math.sin(u * 7.1 + 1.3) * Math.sin(v * 5.4 + 0.4);
  const P = (i, j) => {
    const [u, v] = [(i / nx) * 2 - 1, (j / ny) * 2 - 1];
    return { p: [(u * L) / 2, (v * Wd) / 2, rise(u, v)], uv: [0.02 + 0.96 * (i / nx), 0.02 + 0.96 * (1 - j / ny)] };
  };
  const tris = [];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const [a, b, c, d] = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
      tris.push([a, b, c], [a, c, d]);
    }
  const up = tris.map((t) => (S.cross(sub(t[1].p, t[0].p), sub(t[2].p, t[0].p))[2] < 0 ? [t[0], t[2], t[1]] : t));
  return {
    finish: () => boxed(name, [{ name, models: [{ name, meshes: [{ tris: up, texture: texture(mat) }] }] }], up.flat().map((c) => c.p)),
  };
}
def("rug_a", () => rug("rug_a", "rug_a"));
def("rug_b", () => rug("rug_b", "rug_b"));
def("rug_c", () => rug("rug_c", "rug_c"));

// ── write them ─────────────────────────────────────────────────────────────
mkdirSync(OUT, { recursive: true });
const manifest = {};
let failed = false;
for (const [name, fn] of Object.entries(MODELS)) {
  if (ONLY && !ONLY.includes(name)) continue;
  const built = fn().finish();
  const report = check(built.mdl, "goldsrc", { name: `${name}.mdl` });
  const form = formOfMdl(built.mdl).measures;
  const said = judgeForm(form, kindOfName(name)).warnings;
  console.log(`${name}.mdl: ${built.mdl.length} bytes, ${built.tris} triangles, box ${built.lo.join(",")} .. ${built.hi.join(",")}, boxiness ${form.boxiness} (axes ${form.axisAligned}, bare edges ${form.sharpEdges}, corners ${form.outline}) ${said.length ? "FORM WARN" : "form ok"}`);
  for (const w of report.warnings) console.log(`  WARN ${name}: ${w}`);
  for (const e of report.errors) {
    console.log(`  ERROR ${name}: ${e}`);
    failed = true;
  }
  writeFileSync(join(OUT, `${name}.mdl`), built.mdl);
  manifest[name] = { file: `models/h9/${name}.mdl`, min: built.lo, max: built.hi, boxiness: form.boxiness, axes: form.axisAligned, tris: built.tris };
  if (SHEET) {
    mkdirSync(SHEET, { recursive: true });
    const view = sheet(built.mdl, { size: 256 });
    writeFileSync(join(SHEET, `${name}.png`), png(view.width, view.height, view.rgba));
  }
}
if (!ONLY) writeFileSync(join(OUT, "interiors.json"), JSON.stringify(manifest, null, 1) + "\n");
if (failed) process.exit(1);
console.log("PASS: the interiors' models are written");
