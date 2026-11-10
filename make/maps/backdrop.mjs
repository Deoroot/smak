// A map's backdrop: the country round it, as a studio model seen over its walls.
//
// An outdoor map closed in by cliffs reads as a pit when nothing is seen beyond them. Master Sword Rebirth's
// Thornlands puts the land round it in the map as models (`models/terrain/`, env_model): hills far off, seen
// over the cliffs' tops against the sky. The engine draws a model over the sky's faces (they do not hide
// what is behind them), so a model standing outside the walls shows wherever the walls are lower than it.
// What this makes is one model: a ring of hills from just outside the map out to the far distance, rising as
// it goes, its picture fields and woods near and blue with haze far off.
//
// The entity that shows it has to stand INSIDE the map (an entity in the void is not drawn), and the map's
// worldspawn `MaxRange` has to reach the ring's far edge (the engine draws nothing further off).
import { buildMdl } from "../build.mjs";
import { indexed } from "../../core/image.mjs";
import { sheet, fbm, mix } from "../workshop.mjs";

/** A seeded number of 0 to 1 for whole numbers. */
function hashed(i, j, seed) {
  let h = (i * 374761393 + j * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
/** Smooth noise round a circle: `count` knots, eased between. */
function round1(t, count, seed) {
  const x = ((t % 1) + 1) % 1 * count;
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  return hashed(i % count, 0, seed) * (1 - s) + hashed((i + 1) % count, 0, seed) * s;
}

/**
 * The backdrop's model: `{ mdl, origin, far, facts }`. `bounds` the map's box in plan `{ min: [x, y], max:
 * [x, y] }` (what the walls close in); `origin` [x, y, z] where its entity will stand, inside the map (the
 * model is made round it); `gap` how far outside the box the ring begins (unless told: 256); `far` its far
 * edge's distance from the box's middle (16000); `near` [low, high], the heights of its inner edge (the hills
 * just over the walls; unless told 320 to 640) and `high` [low, high] the far ridge's (2000 to 4200); `base`
 * the ground's height (0). `seed` changes the hills; `name` the model's file name. `texture` a size [w, h]
 * of its picture ([512, 512]). `haze` the colour far hills fade to, 0 to 1 (the sky's own near the horizon:
 * unless told a pale blue).
 *
 * The entity: `pointEntity("env_model", origin, { model: "models/.../name.mdl", ... })`, and the worldspawn's
 * `MaxRange` at least `far` (facts says how much).
 */
export function backdropModel({
  bounds,
  origin,
  gap = 256,
  far = 16000,
  near = [320, 640],
  high = [2000, 4200],
  base = 0,
  seed = 1,
  name = "backdrop.mdl",
  texture: size = [512, 512],
  haze = [0.55, 0.62, 0.72],
} = {}) {
  if (!bounds?.min || !bounds?.max) throw new Error("backdropModel: the map's box in plan, { min: [x, y], max: [x, y] }");
  if (!Array.isArray(origin) || origin.length < 2) throw new Error("backdropModel: origin [x, y, z], where its entity stands, inside the map");
  const middle = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2];
  const halfW = (bounds.max[0] - bounds.min[0]) / 2;
  const halfH = (bounds.max[1] - bounds.min[1]) / 2;
  /** How far the box's edge is from its middle, along the way at angle a. */
  const edge = (a) => Math.min(halfW / Math.max(1e-6, Math.abs(Math.cos(a))), halfH / Math.max(1e-6, Math.abs(Math.sin(a))));
  const ANGLES = 128;
  // rings closer together near the walls, where the land is seen close
  const RINGS = [0, 0.02, 0.05, 0.09, 0.14, 0.21, 0.3, 0.41, 0.54, 0.69, 0.85, 1];
  const height = (t, s) => {
    // t round the ring (0 to 1), s out across it (0 at the inner edge, 1 at the far one)
    const lowRidge = 0.55 * round1(t, 11, seed) + 0.3 * round1(t, 29, seed + 1) + 0.15 * round1(t, 61, seed + 2);
    const farRidge = 0.6 * round1(t, 7, seed + 3) + 0.4 * round1(t, 19, seed + 4);
    const inner = near[0] + (near[1] - near[0]) * lowRidge;
    const outer = high[0] + (high[1] - high[0]) * farRidge;
    // hills of their own between: noise over the ground itself (polar, so the ring closes), stronger
    // between the near edge and the far ridge, with dips that let the far hills show through
    const a = t * 2 * Math.PI;
    const [px, py] = [Math.cos(a) * (2 + s * 6), Math.sin(a) * (2 + s * 6)];
    const knolls = fbm(px * 1.7 + 9, py * 1.7 + 3, seed + 21, 4) - 0.5;
    const k = s ** 1.6;
    return base + inner * (0.75 + 0.5 * (knolls + 0.5)) + (outer - inner) * k + 900 * knolls * Math.sin(Math.PI * Math.min(1, s * 1.4));
  };
  // the picture: across it (v) from the inner edge (top) to the far one (bottom); along it (u) repeats
  const [W, H] = size;
  const S = sheet(W, H);
  S.zone({ x: 0, y: 0, w: W, h: H }, (u, v) => {
    const s = v / H;
    const n = fbm(u / 14, v / 14, seed, 4);
    // a patchwork of fields, hedged: cells of their own colour, a dark line where two meet
    const cell = 26 + 30 * s;
    const [cx, cy] = [Math.floor((u + 7 * Math.sin(v / 19)) / cell), Math.floor((v + 7 * Math.sin(u / 23)) / (cell * 0.7))];
    const kind = hashed(cx, cy, seed + 5);
    const hedge = Math.min(((u + 7 * Math.sin(v / 19)) % cell + cell) % cell, ((v + 7 * Math.sin(u / 23)) % (cell * 0.7) + cell) % (cell * 0.7)) < 1.6; // prettier-ignore
    const fields = [
      [0.36, 0.47, 0.17], [0.44, 0.5, 0.2], [0.55, 0.52, 0.26], [0.3, 0.42, 0.15], [0.5, 0.45, 0.28],
    ][Math.floor(kind * 5)].map((c) => c * (0.88 + 0.24 * n));
    const woods = fbm(u / 26 + 13, v / 26, seed + 9, 4) > 0.56 - 0.1 * s;
    const forest = [0.11 + 0.05 * n, 0.19 + 0.06 * n, 0.08 + 0.03 * n];
    const rock = [0.42 + 0.1 * n, 0.4 + 0.1 * n, 0.36 + 0.08 * n];
    let c = woods ? forest : hedge ? [0.14, 0.22, 0.09] : fields;
    if (s > 0.6) c = mix(c, rock, Math.min(1, (s - 0.6) * 2.5) * (n > 0.48 ? 1 : 0.35));
    // haze: far off the land is the sky's colour
    return mix(c, haze, Math.min(0.88, s * s * 1.05 + s * 0.12));
  });
  const REPEAT = 12; // the picture laid round the ring this many times
  const corner = (i, j) => {
    const a = (i / ANGLES) * 2 * Math.PI;
    const r0 = edge(a) + gap;
    const r = r0 + (far - r0) * RINGS[j];
    // the inner edge starts under the ground, so the land runs on from the foot of the walls: no sky between
    const z = j === 0 ? base - 96 : height(i / ANGLES, RINGS[j]);
    return [middle[0] + r * Math.cos(a) - origin[0], middle[1] + r * Math.sin(a) - origin[1], z - (origin[2] ?? 0)].map((v) => Math.round(v));
  };
  // two halves of the ring, each a bodypart of its own: a submodel holds 2048 points and normals in GoldSrc
  const halves = [[], []];
  for (let i = 0; i < ANGLES; i++)
    for (let j = 0; j + 1 < RINGS.length; j++) {
      // each quad has its own run of u, so that the picture's repeat has no seam across a quad
      const u0 = ((i * REPEAT) % ANGLES) / ANGLES;
      const u1 = u0 + REPEAT / ANGLES;
      const [v0, v1] = [RINGS[j], RINGS[j + 1]];
      const c = (ii, jj, u, v) => ({ p: corner(ii, jj), uv: [u, v], bone: "root" });
      const [a, b, cc, d] = [c(i, j, u0, v0), c(i + 1, j, u1, v0), c(i + 1, j + 1, u1, v1), c(i, j + 1, u0, v1)];
      halves[i < ANGLES / 2 ? 0 : 1].push([a, cc, b], [a, d, cc]);
    }
  const picture = indexed(S.image(), "land.bmp");
  const tris = halves.flat();
  const mdl = buildMdl({
    name,
    bones: [{ name: "root", parent: -1 }],
    bodyparts: halves.map((tris, n) => ({ name: `land${n}`, models: [{ name: `land${n}`, meshes: [{ tris, texture: picture }] }] })),
    sequences: [{ name: "idle", fps: 1, loops: true, frames: [[[0, 0, 0, 0, 0, 0]]] }],
  });
  const reach = Math.ceil(Math.hypot(far + Math.abs(middle[0] - origin[0]), far + Math.abs(middle[1] - origin[1])));
  return {
    mdl,
    origin: [Math.round(origin[0]), Math.round(origin[1]), Math.round(origin[2] ?? 0)],
    far: reach,
    facts: [`a ring of hills from ${gap} outside the map's box to ${far} from its middle, ${tris.length} triangles; the worldspawn's MaxRange wants ${reach} at least`],
  };
}
