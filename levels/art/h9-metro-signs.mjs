// The station name boards of the H9 metro, painted by SMAK: a bottle-green lacquered plate with a double gold frame, an eight-pointed
// star in an oxblood disc at each end and the station's name in gold letters (a stroke alphabet drawn here, no font and nothing of any
// game's). Each station has its own texture, `h9sign_<id>`, 384 x 128, in a wad the build writes and includes in the .bsp, so the
// player's game needs no file for them.
//
//   node levels/art/h9-metro-signs.mjs [out folder, default levels/art/h9]
//
// writes h9_metro_signs.wad and, beside it, h9_metro_signs.png (the boards in a column). The build (levels/tools/build-site.mjs) calls
// `signsWad()` itself and compiles the wad into the map (wadinclude), so the wad is only for looking at, or for a mapper's editor.
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeWad } from "../../src/maps/wad.mjs";
import { png, workshop } from "../../src/index.mjs";
import { STATION_NAMES, SIGN_FALLBACK, signTextureName } from "../assembly/metro.mjs";
export { signTextureName };

const { fbm, noise, mix, times, step } = workshop;
export const SIGN_SIZE = [384, 128];

const LACQ = [0.04, 0.14, 0.095];
const OXB = [0.2, 0.035, 0.05];
const GOLD = [0.82, 0.62, 0.22];

// ── the alphabet: strokes on a grid 6 high (y down), each letter its own width ──
const arc = (cx, cy, rx, ry, a0, a1, n = 14) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });
const GLYPHS = {
  A: [4, [[[0, 6], [2, 0], [4, 6]], [[0.8, 4], [3.2, 4]]]],
  B: [4, [[[0, 0], [0, 6]], [[0, 0], [2.4, 0], ...arc(2.4, 1.5, 1.4, 1.5, -90, 90), [0, 3]], [[0, 3], [2.8, 3], ...arc(2.8, 4.5, 1.2, 1.5, -90, 90), [0, 6]]]],
  C: [4, [arc(2.2, 3, 2, 3, -40, -320)]],
  D: [4, [[[0, 0], [0, 6]], [[0, 0], [1.6, 0], ...arc(1.6, 3, 2.4, 3, -90, 90), [0, 6]]]],
  E: [4, [[[4, 0], [0, 0], [0, 6], [4, 6]], [[0, 3], [3, 3]]]],
  F: [4, [[[4, 0], [0, 0], [0, 6]], [[0, 3], [3, 3]]]],
  G: [4, [arc(2.2, 3, 2, 3, -40, -330), [[2.4, 3.4], [4.2, 3.4], [4.2, 4.8]]]],
  H: [4, [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]]],
  I: [2, [[[1, 0], [1, 6]], [[0.1, 0], [1.9, 0]], [[0.1, 6], [1.9, 6]]]],
  J: [3, [[[3, 0], [3, 4.2], ...arc(1.5, 4.2, 1.5, 1.8, 0, 180)]]],
  K: [4, [[[0, 0], [0, 6]], [[4, 0], [0, 3.4]], [[1.3, 2.4], [4, 6]]]],
  L: [4, [[[0, 0], [0, 6], [3.8, 6]]]],
  M: [5, [[[0, 6], [0, 0], [2.5, 3.8], [5, 0], [5, 6]]]],
  N: [4, [[[0, 6], [0, 0], [4, 6], [4, 0]]]],
  O: [4, [arc(2, 3, 2, 3, 0, 360, 24)]],
  P: [4, [[[0, 6], [0, 0]], [[0, 0], [2.2, 0], ...arc(2.2, 1.75, 1.8, 1.75, -90, 90), [0, 3.5]]]],
  Q: [4, [arc(2, 3, 2, 3, 0, 360, 24), [[2.6, 4.4], [4.2, 6.4]]]],
  R: [4, [[[0, 6], [0, 0]], [[0, 0], [2.2, 0], ...arc(2.2, 1.75, 1.8, 1.75, -90, 90), [0, 3.5]], [[1.8, 3.5], [4, 6]]]],
  S: [4, [[...arc(2, 1.5, 1.9, 1.5, -30, -270), ...arc(2, 4.5, 1.9, 1.5, -90, 150)]]],
  T: [4, [[[0, 0], [4, 0]], [[2, 0], [2, 6]]]],
  U: [4, [[[0, 0], [0, 4], ...arc(2, 4, 2, 2, 180, 0), [4, 0]]]],
  V: [4, [[[0, 0], [2, 6], [4, 0]]]],
  W: [6, [[[0, 0], [1.5, 6], [3, 1.6], [4.5, 6], [6, 0]]]],
  X: [4, [[[0, 0], [4, 6]], [[4, 0], [0, 6]]]],
  Y: [4, [[[0, 0], [2, 3]], [[4, 0], [2, 3], [2, 6]]]],
  Z: [4, [[[0, 0], [4, 0], [0, 6], [4, 6]]]],
  " ": [2.4, []],
  "-": [3, [[[0.5, 3], [2.5, 3]]]],
};
const GAP = 1.1;

/** The segments of a text laid out at scale `s` pixels a unit, its top left at (x, y): { segs: [[x0, y0, x1, y1]], width }. */
function layout(text, s, x, y) {
  const segs = [];
  let at = 0;
  for (const ch of String(text).toUpperCase()) {
    const [w, strokes] = GLYPHS[ch] ?? GLYPHS[" "];
    for (const line of strokes) for (let i = 0; i + 1 < line.length; i++) segs.push([x + (at + line[i][0]) * s, y + line[i][1] * s, x + (at + line[i + 1][0]) * s, y + line[i + 1][1] * s]);
    at += w + GAP;
  }
  return { segs, width: (at - GAP) * s };
}
const textWidth = (text) => [...String(text).toUpperCase()].reduce((n, ch) => n + (GLYPHS[ch] ?? GLYPHS[" "])[0] + GAP, -GAP);
/** The distance from a point to the nearest of the segments. */
function distTo(segs, px, py) {
  let best = 1e9;
  for (const [x0, y0, x1, y1] of segs) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
    if (d < best) best = d;
  }
  return best;
}

/** The emblem: a gold ring, an oxblood disc, an eight-pointed star; null outside it. */
function emblem(dx, dz, R) {
  const d = Math.hypot(dx, dz);
  if (d > R + 1) return null;
  const a = Math.atan2(dz, dx);
  if (d > R) return times(GOLD, 0.55);
  if (d > R - 2.4) return times(GOLD, 0.8 + 0.3 * Math.cos(a - 0.8));
  if (d > R - 4) return times(LACQ, 0.8);
  const k = 0.5 + 0.5 * Math.cos(4 * a);
  const reach = (R - 6) * (0.45 + 0.55 * Math.pow(k, 1.3));
  if (d < reach && d > 2.4) return mix(GOLD, times(GOLD, 0.75), d / reach);
  return d <= 2.4 ? times(OXB, 1.6) : OXB;
}

/** One board: { width, height, rgb } with `name` in large gold letters and `sub` under it, small. */
export function signImage(name, sub = "ESTACION DEL METRO") {
  const [W, H] = SIGN_SIZE;
  const rgb = new Uint8Array(W * H * 3);
  // the name: as large as fits between the two emblems, up to 5.6 pixels a unit
  const room = W - 2 * 76;
  const s1 = Math.min(5.6, room / textWidth(name));
  const big = layout(name, s1, W / 2 - (textWidth(name) * s1) / 2, 52 - 3 * s1);
  const s2 = 2.1;
  const small = layout(sub, s2, W / 2 - (textWidth(sub) * s2) / 2, 96 - 3 * s2);
  const hw1 = 0.46 * s1;
  const hw2 = 0.5 * s2;
  const SS = 2;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let acc = [0, 0, 0];
      for (let j = 0; j < SS; j++)
        for (let i = 0; i < SS; i++) {
          const px = x + (i + 0.5) / SS;
          const py = y + (j + 0.5) / SS;
          // the lacquer
          const sheen = 0.035 * Math.max(0, 1 - Math.abs(py - 40) / 60);
          let c = times(LACQ, 1 + 5 * (0.02 * (fbm(px * 0.06, py * 0.25, 4) - 0.5) + 0.012 * (noise(px * 0.3, py * 1.1, 2) - 0.5)));
          c = [c[0] + sheen * 0.5, c[1] + sheen * 1.2, c[2] + sheen];
          // the frame: a gold band at the edge (chamfered corners), a thin line inside it
          const ex = Math.min(px, W - px);
          const ey = Math.min(py, H - py);
          const cut = Math.max(0, 14 - ex - ey); // the corners cut
          const edge = Math.min(ex, ey) - cut / 1.4;
          if (edge < 0) c = [0.03, 0.03, 0.03];
          else if (edge < 3.4) c = times(GOLD, 0.7 + 0.45 * (1 - Math.abs(edge - 1.7) / 1.7));
          else if (edge < 6) c = times(c, 0.7);
          else if (edge > 9 && edge < 10.6) c = times(GOLD, 0.85);
          // an oxblood band under the name and over it
          if (edge > 12 && (Math.abs(py - 76) < 1.1)) c = times(GOLD, 0.8);
          // the emblems
          for (const cx of [34, W - 34]) {
            const e = emblem(px - cx, py - 64, 22);
            if (e) c = e;
          }
          // the letters: a shadow below and to the right, then the gold, brighter at the stroke's core
          const dShadow = distTo(big.segs, px - 1.4, py - 1.6);
          if (dShadow < hw1 + 0.5) c = times(c, 0.35);
          const d1 = distTo(big.segs, px, py);
          if (d1 < hw1 + 0.5) {
            const cover = Math.max(0, Math.min(1, hw1 + 0.5 - d1));
            const shade = 0.78 + 0.5 * (1 - d1 / hw1) - 0.12 * (py - 52) / (3 * s1);
            c = mix(c, times(GOLD, shade), cover);
          }
          const d2 = distTo(small.segs, px, py);
          if (d2 < hw2 + 0.5) c = mix(c, times(GOLD, 0.85), Math.max(0, Math.min(1, hw2 + 0.5 - d2)));
          acc = [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]];
        }
      for (let k = 0; k < 3; k++) rgb[(y * W + x) * 3 + k] = Math.max(0, Math.min(255, Math.round((acc[k] / (SS * SS)) * 255)));
    }
  return { width: W, height: H, rgb };
}


/** The wad of the boards: `stations` is { hallId: "NAME" }; every texture of a name once. Returns { bytes, names }. */
export function signsWad(stations) {
  const textures = Object.entries(stations).map(([id, name]) => ({ name: signTextureName(id), image: signImage(name) }));
  return { bytes: writeWad(textures), names: textures.map((t) => t.name), images: textures };
}

if (process.argv[1]?.split("\\").join("/").endsWith("art/h9-metro-signs.mjs")) {
  const out = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "h9");
  mkdirSync(out, { recursive: true });
  const { bytes, names, images } = signsWad({ ...STATION_NAMES, [SIGN_FALLBACK]: "STATION" });
  writeFileSync(join(out, "h9_metro_signs.wad"), bytes);
  const H = images.length * 136;
  const img = { width: 392, height: H, rgba: new Uint8Array(392 * H * 4).fill(60) };
  images.forEach(({ image }, n) => {
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) for (let k = 0; k < 3; k++) img.rgba[(((n * 136 + 4 + y) * 392) + 4 + x) * 4 + k] = image.rgb[(y * image.width + x) * 3 + k];
  });
  for (let i = 3; i < img.rgba.length; i += 4) img.rgba[i] = 255;
  writeFileSync(join(out, "h9_metro_signs.png"), png(img.width, img.height, img.rgba));
  console.log(`h9_metro_signs.wad: ${names.join(", ")} (${bytes.length} bytes)`);
  void step;
}
