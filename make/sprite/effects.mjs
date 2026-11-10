// The pictures of a sprite, made by rule: layers, each a function of a pixel and the moment (the phase, 0 to 1
// over the sprite's frames), summed (additive) or laid over each other (coverage). The noise is periodic in
// time and along the way a flame rises, so a loop of P frames closes on itself exactly
// (research/sprite-generation.md, 5.1 to 5.3).
//
//   framesOf({ size, frames, loop, layers, seed, edge, use }) -> [{ width, height, rgb, a }]
//
// Coordinates: u across (-1 left to 1 right), v up (-1 bottom to 1 top), in the frame's longer side's half
// (a 32x64 frame runs u -0.5 to 0.5 and v -1 to 1).

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const mod = (a, n) => ((a % n) + n) % n;

/** A number from 0 to 1 that a lattice point and a seed always give. */
function hash(x, y, z, seed) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144665) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Value noise in x, y and t, smooth, periodic: in t with period `pt` and in y with period `py` (lattice cells;
 * 0: not periodic in y).
 */
export function noise3(x, y, t, { pt, py = 0, seed = 1 }) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const it = Math.floor(t);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const ft = smooth(t - it);
  const at = (dx, dy, dz) => hash(ix + dx, py ? mod(iy + dy, py) : iy + dy, mod(it + dz, pt), seed);
  const lerp = (a, b, k) => a + (b - a) * k;
  const plane = (dz) => lerp(lerp(at(0, 0, dz), at(1, 0, dz), fx), lerp(at(0, 1, dz), at(1, 1, dz), fx), fy);
  return lerp(plane(0), plane(1), ft);
}

/** Octaves of noise3, each twice as fine and half as strong, each still periodic. 0 to 1. */
export function fbm3(x, y, t, { pt, py = 0, seed = 1, octaves = 4 }) {
  let sum = 0;
  let weight = 0;
  for (let k = 0; k < octaves; k++) {
    const f = 2 ** k;
    sum += noise3(x * f, y * f, t * f, { pt: pt * f, py: py * f, seed: seed + k * 17 }) / f;
    weight += 1 / f;
  }
  return sum / weight;
}

/**
 * Colours by heat (0 to 1). `fire`: black, deep red, orange, pale yellow, near white. `blast` (white, cream,
 * tan, brown) and `muzzle` (white, peach, tan) are the mean colours of Half-Life's zerogxplode and muzzleflash1
 * at each tenth of brightness, a stop at the brightness of its colour (numbers only, measured with readSpr).
 */
const RAMPS = {
  fire: [[0, [0, 0, 0]], [0.25, [0.45, 0.04, 0]], [0.5, [0.95, 0.35, 0.02]], [0.75, [1, 0.75, 0.25]], [1, [1, 0.97, 0.85]]],
  blue: [[0, [0, 0, 0]], [0.3, [0.02, 0.08, 0.45]], [0.6, [0.15, 0.45, 1]], [1, [0.85, 0.95, 1]]],
  green: [[0, [0, 0, 0]], [0.3, [0.02, 0.3, 0.05]], [0.6, [0.3, 0.95, 0.2]], [1, [0.9, 1, 0.8]]],
  blast: [[0, [0, 0, 0]], [0.06, [0.15, 0.02, 0.01]], [0.15, [0.27, 0.11, 0.03]], [0.25, [0.41, 0.2, 0.05]], [0.45, [0.61, 0.42, 0.15]], [0.6, [0.72, 0.56, 0.23]], [0.75, [0.86, 0.76, 0.46]], [0.85, [0.94, 0.85, 0.61]], [0.96, [0.99, 0.97, 0.85]], [1, [1, 1, 0.95]]],
  muzzle: [[0, [0, 0, 0]], [0.06, [0.09, 0.05, 0.02]], [0.15, [0.21, 0.13, 0.06]], [0.35, [0.48, 0.31, 0.18]], [0.55, [0.72, 0.5, 0.31]], [0.75, [0.91, 0.72, 0.51]], [0.86, [0.96, 0.83, 0.65]], [0.96, [0.98, 0.96, 0.87]], [1, [1, 1, 0.95]]],
};
export const RAMP_NAMES = Object.keys(RAMPS);
function ramp(name, heat) {
  // stops in any order: a laser beam's maker listed its from bright to dark, and read in that order its colours
  // came out wrong (delta E 43.7, scored 0)
  const stops = Array.isArray(name) ? [...name].sort((a, b) => a[0] - b[0]) : RAMPS[name] ?? RAMPS.fire;
  const h = clamp01(heat);
  for (let i = 1; i < stops.length; i++)
    if (h <= stops[i][0]) {
      const k = (h - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0] || 1);
      return stops[i - 1][1].map((c, j) => c + (stops[i][1][j] - c) * k);
    }
  return stops.at(-1)[1];
}

/** An envelope over the phase: { attack, decay } as shares of the length (0 none): 0 to 1 to 0. */
function envelopeOf(env) {
  if (!env) return () => 1;
  // `start`: the level at the first frame (0 unless told), so that an explosion opens on a small flash and still
  // peaks at its attack
  const { attack = 0, decay = 0, start = 0 } = env;
  return (p) => Math.min(attack ? start + (1 - start) * clamp01(p / attack) : 1, decay ? clamp01((1 - p) / decay) : 1);
}

/** Particles that a seed always places the same: [{ angle, speed, delay }]. */
function particles(count, seed) {
  return Array.from({ length: count }, (_, i) => ({ angle: hash(i, 1, 0, seed) * 2 * Math.PI, speed: 0.4 + 0.6 * hash(i, 2, 0, seed), delay: 0.25 * hash(i, 3, 0, seed) }));
}

/**
 * A layer's light as it is coloured: by `colour`, or with `ramp` by its own brightness through the ramp (a
 * glow white at its middle and tan at its rim), its coverage the brightness.
 */
const lit = (e, colour, name) => (name ? { e: 1, rgb: ramp(name, e), a: clamp01(e) } : { e, rgb: colour });

/** The rays of a flare: `count` thin half streaks round it, each of a seeded length and a little off even. */
function raysOf({ count = 48, length = 0.9, jitter = 0.5, width = 0.012, gain = 0.5 } = {}, seed) {
  return Array.from({ length: count }, (_, i) => ({
    angle: ((i + jitter * (hash(i, 4, 0, seed) - 0.5)) * 360) / count,
    length: length * (1 - jitter * hash(i, 5, 0, seed)),
    width,
    gain: gain * (0.5 + 0.5 * hash(i, 6, 0, seed)),
    half: true,
  }));
}

/** Distance from a point to a segment. */
function toSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

/**
 * A layer's energy and colour at (u, v) and phase p: { e (0 to 1 or so), rgb }. `loop`: the phase is a loop's
 * (p 1 is p 0 again); `cells`: the lattice cells the frame's longer side spans, for the noise.
 */
const KINDS = {
  glow({ radius = 0.8, core = 0.18, colour = [1, 0.85, 0.6], at = [0, 0], falloff = "smooth", power = 2, reach = 1.5, ramp: name }, u, v) {
    const r = Math.hypot(u - at[0], v - at[1]);
    // smooth: cut to nothing between 0.55 and 1 of `radius`; power: 1 / (1 + (r / core)^power), eased to
    // nothing only at `reach` (past the corner of a square frame), so a glow fills its frame as a lens's does
    const e =
      falloff === "power"
        ? (1 / (1 + (r / core) ** power)) * clamp01(1 - (r / reach) ** 2) ** 2
        : ((core * core) / (r * r + core * core)) * (1 - smooth(clamp01((r / radius - 0.55) / 0.45)));
    return lit(e, colour, name);
  },
  flare({ core = 0.12, colour = [1, 0.9, 0.7], streaks = [{ angle: 0, length: 0.95, width: 0.03 }, { angle: 90, length: 0.6, width: 0.025 }], at = [0, 0], taper = 0, blur = 0, haze = 0, rays, ramp: name }, u, v, p, { seed }) {
    const x = u - at[0];
    const y = v - at[1];
    const r = Math.hypot(x, y);
    let e = (core * core) / (r * r + core * core) * (1 - smooth(clamp01((r - 0.5) / 0.45)));
    for (const s of rays ? [...streaks, ...raysOf(rays, seed)] : streaks) {
      const a = (s.angle * Math.PI) / 180;
      const along = x * Math.cos(a) + y * Math.sin(a);
      const across = -x * Math.sin(a) + y * Math.cos(a);
      // a half streak goes out from the core along its angle only, rounded off behind it
      let t = clamp01(1 - Math.abs(along) / s.length);
      // `taper`: wider toward the core (1 + taper times its width there); `blur`: a Gaussian across of its own,
      // the light spread and not lost; `haze`: a faint glow four times as wide under the arm
      const width = s.width * (1 + (s.taper ?? taper) * t);
      const spread = Math.hypot(width, s.blur ?? blur);
      if (s.half && along < 0) t *= Math.exp(-((along / spread) ** 2));
      e += (s.gain ?? 1) * (width / spread) * Math.exp(-((across / spread) ** 2)) * t ** 1.5;
      const h = s.haze ?? haze;
      if (h) e += (s.gain ?? 1) * h * Math.exp(-((across / (4 * spread)) ** 2)) * t;
    }
    return lit(Math.min(1.5, e), colour, name);
  },
  fire({ ramp: name = "fire", width = 0.6, rise = 1, turbulence = 0.8, height = 1.7, taper = 0.65, tongues = 0 }, u, v, p, { cells, seed, aspect }) {
    // the base a little up from the frame's foot, so the border stays dark
    const base = -aspect[1] * 0.88;
    const h = v < base ? 1 : clamp01((v - base) / height);
    // `taper`: how much narrower it is at its top (0: as wide as at its foot, no cone)
    const half = width * aspect[0] * (1 - taper * h);
    const across = Math.exp(-((u / Math.max(half, 0.02)) ** 2) * 2);
    // rising noise: the lattice periodic up the frame, scrolled one whole period a loop (`rise` of them)
    const py = cells;
    const lift = Math.max(1, Math.round(rise));
    const n = fbm3((u + 2) * cells * 0.5, (v + 1) * cells * 0.5 - p * py * lift, p * 4, { pt: 4, py, seed });
    let heat = across * (1 - h) ** 1.2 * (1 - turbulence * 0.6 + turbulence * 1.2 * n) - 0.25 * h;
    if (tongues) {
      // tongues: noise four times as long as it is wide, rising at the same speed, cut at a level that climbs
      // with height, so that the flame parts into licks with dark between them and thins toward its top
      const t = fbm3((u + 2) * cells * 0.5, (v + 1) * cells * 0.125 - p * (py / 4) * lift, p * 4, { pt: 4, py: py / 4, seed: seed + 3 });
      const mask = smooth(clamp01((t - 0.42 - 0.18 * h) / 0.16 + 0.5));
      heat *= 1 - tongues + tongues * mask;
    }
    return { e: 1, rgb: ramp(name, heat * 1.15) };
  },
  smoke({ density = 0.8, spread = 0.6, colour = [0.55, 0.55, 0.55], rise = 1 }, u, v, p, { cells, seed, aspect }) {
    const h = clamp01((v + aspect[1]) / (2 * aspect[1]));
    const half = spread * aspect[0] * (0.35 + 0.65 * h);
    const across = Math.exp(-((u / Math.max(half, 0.02)) ** 2) * 1.6);
    const n = fbm3((u + 2) * cells * 0.4, (v + 1) * cells * 0.4 - p * cells * Math.max(1, Math.round(rise)), p * 3, { pt: 3, py: cells, seed, octaves: 5 });
    const a = clamp01(across * density * (n * 1.6 - 0.35) * (1 - h * 0.7));
    return { e: a, rgb: colour, a };
  },
  explosion({ ramp: name = "fire", growth = 0.9, cool = 1.6, turbulence = 0.9 }, u, v, p, { cells, seed }) {
    // one-shot: a ball that grows fast and slows, burns from its middle out, and cools
    const R = 0.15 + growth * (1 - (1 - p) ** 2.5);
    // its edge broken up by noise, so it is a billow and not a disc
    const lobes = fbm3((u + 3) * cells * 0.25, (v + 3) * cells * 0.25, p * 3, { pt: 3, seed: seed + 7, octaves: 2 });
    const r = (Math.hypot(u, v) / R) * (0.75 + 0.5 * lobes);
    if (r > 1.25) return { e: 0, rgb: [0, 0, 0] };
    const n = fbm3((u + 2) * cells * 0.7, (v + 2) * cells * 0.7, p * 10, { pt: 10, seed, octaves: 4 });
    const heat = (1 - r ** 2) * (1 - turbulence * 0.5 + turbulence * n) * (1 - p) ** cool * 1.6;
    return { e: 1, rgb: ramp(name, heat) };
  },
  sparks({ count = 24, speed = 1, gravity = 1.2, trail = 0.12, colour = [1, 0.8, 0.4] }, u, v, p, { seed }) {
    let e = 0;
    for (const s of particles(count, seed)) {
      const t = p - s.delay;
      if (t <= 0) continue;
      const at = (tt) => [Math.cos(s.angle) * s.speed * speed * tt * 1.6, Math.sin(s.angle) * s.speed * speed * tt * 1.6 - gravity * tt * tt];
      const [ax, ay] = at(t);
      const [bx, by] = at(Math.max(0, t - trail));
      const d = toSegment(u, v, ax, ay, bx, by);
      e += Math.exp(-((d / 0.025) ** 2)) * (1 - t / (1 - s.delay)) ** 1.5;
    }
    return { e: Math.min(1.4, e), rgb: colour };
  },
  ring({ from = 0.1, to = 0.9, width = 0.08, colour = [0.6, 0.85, 1] }, u, v, p) {
    const r = Math.hypot(u, v);
    const at = from + (to - from) * (1 - (1 - p) ** 2);
    return { e: Math.exp(-(((r - at) / width) ** 2)) * (1 - p), rgb: colour };
  },
  beam({ core = 0.35, noise = 0.5, colour = [0.5, 0.75, 1], profile = "round", shoulder = 0.3, streaks = 0, ramp: name }, u, v, p, { cells, seed, aspect }) {
    // a cross-section across u, noise that tiles along v (the beam's length) and scrolls a whole period a loop
    const py = cells;
    const n = fbm3((u + 2) * cells * 0.5, (v + aspect[1]) * cells * 0.5 / aspect[1] * 0.5 + p * py, p * 2, { pt: 2, py, seed });
    // round: exp(-(u / core)^2); flat: full across `core` of the width, then soft shoulders `shoulder` wide
    const half = core * aspect[0];
    const off = Math.abs(u) - half;
    const across = profile === "flat" ? (off <= 0 ? 1 : Math.exp(-((off / (shoulder * aspect[0])) ** 2))) : Math.exp(-((u / half) ** 2));
    let e = across * (1 - noise + noise * 1.4 * n);
    if (streaks) {
      // streaks: noise that changes across the beam (eight cells over its width) and hardly along it (two
      // cells over its length, so that the frame still tiles end to end), as a beam's mottling runs with it
      const m = fbm3((u / aspect[0] + 2) * 4, (v / aspect[1] + 1), p * 2, { pt: 2, py: 2, seed: seed + 5, octaves: 3 });
      e *= Math.max(0, 1 + streaks * 3 * (m - 0.5));
    }
    return lit(e, colour, name);
  },
  billow(layer, u, v, p, context) {
    const { ramp: name = "blast", colour, size = 0.3, growth = 0.9, lumps = 0.4, blend = 0.4, light = [-0.55, 0.6, 0.6], hot = 0.4, cool = 0.8, dissolve = 0.7, at = [0, 0], debris } = layer;
    const { cells, seed } = context;
    const spheres = billowOf(layer, seed, p);
    // the surface seen at (x, y): the front of the spheres, joined smoothly where they meet (`blend`, a share of
    // `size`; 0: the front-most sphere alone, with a crease), and how much of the pixel it covers. The radius of
    // every sphere is moved by one field of noise, so that its edge is lumpy and the lumps run on from one
    // sphere into the next
    const k = blend ? 1 / (blend * size) : 0;
    const surface = (x, y) => {
      const lump = 1 + lumps * 2 * (fbm3((x + 3) * cells * 0.35, (y + 3) * cells * 0.35, p * 3, { pt: 3, seed: seed + 11, octaves: 3 }) - 0.5);
      let front = -Infinity;
      let sum = 0;
      let cover = 0;
      for (const s of spheres) {
        const r = s.r * lump;
        const d2 = (x - s.x) ** 2 + (y - s.y) ** 2;
        if (d2 >= r * r) continue;
        const h = s.z + Math.sqrt(r * r - d2);
        // a soft rim a pixel or two wide
        cover = Math.max(cover, clamp01((r - Math.sqrt(d2)) / (0.035 + 0.1 * r)));
        if (k) sum += Math.exp(k * (h - 2));
        front = Math.max(front, h);
      }
      return { h: k && sum ? 2 + Math.log(sum) / k : front, cover };
    };
    const here = surface(u, v);
    let normal = null;
    const { cover: covered } = here;
    let cover = covered;
    if (here.h > -Infinity) {
      // the normal from the surface's slope, a third of a pixel either way
      const d = 0.01;
      const dx = surface(u + d, v).h;
      const dy = surface(u, v + d).h;
      const gx = dx > -Infinity ? (dx - here.h) / d : 0;
      const gy = dy > -Infinity ? (dy - here.h) / d : 0;
      const n = Math.hypot(gx, gy, 1);
      normal = [-gx / n, -gy / n, 1 / n];
    }
    let e = 0;
    let rgb = [0, 0, 0];
    let a = 0;
    if (normal) {
      const L = Math.hypot(...light) || 1;
      const shade = clamp01(0.4 + 0.9 * (normal[0] * light[0] + normal[1] * light[1] + normal[2] * light[2]) / L);
      // `dissolve`: noise cut at a level that climbs with age, so that late the cloud breaks into wisps (the
      // noise turned off the grid, so that no edge of it runs straight across)
      const wisp = dissolve ? smooth(clamp01((fbm3((0.8 * u + 0.6 * v + 5) * cells * 0.5, (0.8 * v - 0.6 * u + 5) * cells * 0.5, p * 4, { pt: 4, seed: seed + 13 }) - dissolve * p ** 2.5) / 0.12)) : 1;
      cover *= wisp;
      // heat: the whole cloud cools with age; early a white core burns at its middle (`hot`: how long, a share
      // of its life)
      const R = (layer.spread ?? 0.5) * grown(p, growth) + size;
      const middle = hot ? Math.exp(-((Math.hypot(u - at[0], v - at[1]) / (0.7 * R)) ** 2)) * clamp01(1 - p / hot) : 0;
      const heat = shade * (0.25 + 0.95 * (1 - p) ** cool) + middle;
      rgb = colour && !layer.ramp ? colour.map((c) => c * shade) : ramp(name, heat);
      e = cover;
      // under index alpha the puff keeps its inner shading in its coverage
      a = cover * (0.6 + 0.4 * shade);
    }
    if (debris) {
      // flecks thrown out of it: a few sparks with short trails, added to its light
      const flecks = KINDS.sparks({ count: 10, speed: 0.8, gravity: 0.3, trail: 0.05, colour: [1, 0.9, 0.75], ...debris }, u, v, p, { seed: seed + 17 });
      rgb = rgb.map((c, j) => c * e + flecks.rgb[j] * flecks.e);
      e = 1;
      a = Math.max(a, clamp01(flecks.e));
    }
    return { e, rgb, a };
  },
  blobs({ count = 9, radius = 0.32, spread = 0.6, core = 0.4, soft = 0.5, colour = [0.4, 0.9, 1], ramp: name, at = [0, 0] }, u, v, p, { seed, frame }) {
    // soft discs placed afresh every frame from the seed, round a core: sparks' flicker, no motion to follow
    // the core: a white middle that falls to nothing, so that past the discs the frame is dark
    let e = core ? 1.2 * Math.exp(-((u - at[0]) ** 2 + (v - at[1]) ** 2) / (core * core)) : 0;
    for (let i = 0; i < count; i++) {
      const angle = hash(i, frame, 7, seed) * 2 * Math.PI;
      const far = spread * Math.sqrt(hash(i, frame, 8, seed));
      const r = radius * (0.6 + 0.8 * hash(i, frame, 9, seed));
      const d = Math.hypot(u - at[0] - far * Math.cos(angle), v - at[1] - far * Math.sin(angle)) / r;
      e += (0.15 + 0.35 * hash(i, frame, 10, seed)) * (1 - smooth(clamp01((d - (1 - soft)) / soft)));
    }
    return lit(Math.min(1.5, e), colour, name);
  },
};
export const LAYER_KINDS = Object.keys(KINDS);

/** How far a billow has grown at phase p: three quarters of the way by a third of its life, from 0.15 (`growth` of the way). */
const grown = (p, growth) => 0.15 + growth * (1 - (1 - p) ** 4);

/**
 * The spheres of a billow at phase p: { x, y, z, r }, each placed by the seed in a disc about `at`, sunk or
 * raised in depth, carried out as the cloud grows, rising and drifting, each with a radius of its own.
 */
const billows = new WeakMap();
function billowOf(layer, seed, p) {
  const kept = billows.get(layer);
  if (kept?.seed === seed && kept.p === p) return kept.spheres;
  const { count = 24, size = 0.3, spread = 0.5, growth = 0.9, rise = 0.25, drift = 0.12, at = [0, 0] } = layer;
  const g = grown(p, growth);
  const spheres = Array.from({ length: count }, (_, i) => {
    const angle = hash(i, 11, 0, seed) * 2 * Math.PI;
    const far = Math.sqrt(hash(i, 12, 0, seed)) * spread * g;
    return {
      x: at[0] + far * Math.cos(angle) + drift * 2 * (hash(i, 13, 0, seed) - 0.5) * p,
      y: at[1] + far * Math.sin(angle) + rise * (0.5 + hash(i, 14, 0, seed)) * p,
      z: (hash(i, 15, 0, seed) - 0.5) * spread * g,
      r: size * (0.5 + hash(i, 16, 0, seed)) * (0.4 + 0.6 * g),
    };
  });
  billows.set(layer, { seed, p, spheres });
  return spheres;
}

/**
 * The frames of a sprite, in full colour and coverage, before any palette. `size` [w, h]; `frames` (distinct
 * frames; a loop gets one more, the first again); `loop`; `layers` [{ kind, gain, env, ...its own }]; `edge`
 * (pixels faded at the border; a beam's only at its sides).
 */
export function framesOf({ size: [width, height], frames: count, loop = false, layers, seed = 1, edge = 2, use, masks = null }) {
  const longer = Math.max(width, height);
  const aspect = [width / longer, height / longer];
  const cells = 8;
  const distinct = Math.max(1, count);
  const out = [];
  for (let n = 0; n < distinct; n++) {
    const p = loop ? n / distinct : distinct > 1 ? n / (distinct - 1) : 0;
    // a ramp given frame by frame ({ frames: [stops, ...] }, as ramp "reference" reads an explosion that cools from
    // white to orange at one brightness): this frame's, at the same point of its play
    const layersNow = layers.map((layer) =>
      layer.ramp?.frames ? { ...layer, ramp: layer.ramp.frames[Math.min(layer.ramp.frames.length - 1, Math.round(p * (layer.ramp.frames.length - 1)))] } : layer,
    );
    // a masked layer's outline this frame: the reference's frame at the same point of its play
    const mask = masks?.length ? masks[Math.min(masks.length - 1, Math.round(p * (masks.length - 1)))] : null;
    const rgb = new Float32Array(width * height * 3);
    const a = new Float32Array(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const u = (((x + 0.5) / width) * 2 - 1) * aspect[0];
        const v = (1 - ((y + 0.5) / height) * 2) * aspect[1];
        // the border faded, so the frame's square never shows (a beam tiles along its length: its ends stay lit)
        const fromSide = Math.min(x + 0.5, width - x - 0.5);
        const fromEnd = Math.min(y + 0.5, height - y - 0.5);
        const fade = edge ? clamp01(fromSide / edge) * (use === "beam" ? 1 : clamp01(fromEnd / edge)) : 1;
        let sum = [0, 0, 0];
        let cover = 0;
        for (const [k, layer] of layersNow.entries()) {
          const make = KINDS[layer.kind];
          if (!make) continue;
          const { e, rgb: c, a: layerA } = make(layer, u, v, p, { cells, seed: seed + k * 101, aspect, frame: n });
          const g = (layer.gain ?? 1) * envelopeOf(layer.env)(p) * fade * (layer.mask && mask ? mask[y * width + x] : 1);
          sum = sum.map((s, j) => s + c[j] * e * g);
          const la = clamp01((layerA ?? e) * g);
          cover = cover + la * (1 - cover);
        }
        const i = y * width + x;
        rgb.set(sum.map((s) => Math.min(1, s)), i * 3);
        a[i] = cover;
      }
    out.push({ width, height, rgb, a });
  }
  // a loop's last frame is its first again: the engine shows frames 0 to frames - 2 and wraps (3.4)
  if (loop && distinct > 1) out.push(out[0]);
  return out;
}
