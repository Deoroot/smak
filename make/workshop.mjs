// The workshop: what every new piece shares. Seeded noise, painted materials, a sheet to
// paint the texture on and a shape builder that turns its own triangles to face outwards.
//
// A piece's axes: +x along its length (from the grip to the tip or the head), +y its width,
// +z its thickness. Units are the game's. The volume is painted into the texture; the
// engine adds only a soft light of its own.
//
// Plain arrays, no browser and no library.
import { sub, dot, cross, unit } from "../core/vec.mjs";
// a body built limb by limb, each corner on its own bone (skinned.mjs): lofts, tubes and cards
export { skinned, zoneOn, span } from "./skinned.mjs";

/** A triangle of less than this (twice its area, in units) is no triangle, and is left out. */
const NO_AREA = 1e-9;
/** Points nearer than this are one point: a ring drawn in to a point is a pole. */
const SAME_POINT = 1e-9;
/** Two rings are the same ring when their `s` agree to this. */
const SAME_RING = 1e-6;
/** Along a path, a cut nearer than this to an end of its stretch (as a share of it) is that end. */
const AT_AN_END = 1e-9;
/** Two places along a path nearer than this are one. */
const SAME_PLACE = 1e-6;
/** A ridge's end grows to its section over its length; a place within this share of that is close enough. */
const NEAR_GROW = 0.15;
/** The step, as a share of a surface's length and in radians, by which its slope at a point is measured. */
const SLOPE_STEP = 1e-4;
/** A surface whose two slopes at a point span less than this has no way of stepping over it there. */
const NO_SLOPE = 1e-12;
/**
 * A stretch of a path of bosses, or of a band on a surface that does not say where its faces are, is cut in
 * this many.
 */
const FINE_STEPS = 16;
/**
 * A tube whose path sets out this nearly along `up` (a cosine) takes another direction for its first corner.
 */
const NEARLY_ALONG = 0.999;
/** A boss on a surface that looks less than this much up or down takes "up" for its second direction. */
const MOSTLY_UP = 0.9;
/** A band's flat top is this share of its width. */
const BAND_TOP = 0.6;
/** A cap drawn as a point of the strip (the old lathe) puts that point this many pixels past the end ring. */
const LATHE_CAP_PIXELS = 5;

/** `a + b * k`, for points. */
const plus = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
/** How far two points are from each other. */
const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/**
 * Where a point of a zone is: `U` along it and `V` across, both 0 to 1. Laid "along", the length runs left to
 * right; "across", it stands: the turn runs left to right and the first end is at the bottom.
 */
const lay = (zone, U, V, lie) =>
  lie === "across"
    ? [zone.x + V * zone.w, zone.y + (1 - U) * zone.h]
    : [zone.x + U * zone.w, zone.y + V * zone.h];
/** The middle of a zone, in pixels. */
const centreOf = (zone) => [zone.x + zone.w / 2, zone.y + zone.h / 2];
/**
 * Where a point of a disc is in its zone: `angle` round it and `r` from its middle (0) to its edge (1). The
 * angle runs anticlockwise on the picture, whose y grows downwards.
 */
const onDisc = (zone, angle, r) => [
  zone.x + zone.w / 2 + (Math.cos(angle) * r * zone.w) / 2,
  zone.y + zone.h / 2 - (Math.sin(angle) * r * zone.h) / 2,
];
/** The same place in the disc's own measure, 0 to 1 each way: what a disc's corners carry as `q`. */
const inDisc = (angle, r) => [0.5 + 0.5 * r * Math.cos(angle), 0.5 - 0.5 * r * Math.sin(angle)];

// Smoothing groups: faces share a normal at a point only within one (mesh.mjs). Counted over every shape, so
// that two shapes put in one mesh do not meet.
let GROUPS = 0;

// ── noise ──────────────────────────────────────────────────────────────────
/** A number from 0 to 1 that looks random and is always the same for the same x, y and seed. */
export const rand = (x, y, s = 0) => {
  const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return n - Math.floor(n);
};
/** 0 to 1 eased at both ends. */
export const smooth = (t) => t * t * (3 - 2 * t);
/** Smooth noise, 0 to 1: one lump a unit. */
export const noise = (x, y, s = 0) => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  // the four corners of the cell the point is in
  const a = rand(xi, yi, s);
  const b = rand(xi + 1, yi, s);
  const c = rand(xi, yi + 1, s);
  const d = rand(xi + 1, yi + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
};
/** Noise of `n` layers, each about twice as fine and half as strong as the one before: 0 to 1. */
export const fbm = (x, y, s = 0, n = 4) => {
  let sum = 0;
  let strength = 0.5;
  let total = 0;
  for (let i = 0; i < n; i++) {
    sum += strength * noise(x, y, s + i * 7);
    total += strength;
    x *= 2.03;
    y *= 2.03;
    strength *= 0.5;
  }
  return sum / total;
};
/**
 * Noise in space, 0 to 1, for painting by place (make/place.mjs): three flat ones crossed. `k`: how many lumps
 * a unit.
 */
export const fbm3 = (p, k = 1, s = 0, n = 4) =>
  (fbm(p[0] * k, p[1] * k, s, n) +
    fbm(p[1] * k + 31, p[2] * k, s + 3, n) +
    fbm(p[2] * k + 57, p[0] * k, s + 5, n)) /
  3;
/** A random number maker that gives the same numbers every run: `const r = seeded(7); r()` is 0 to 1. */
export const seeded = (a) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
/** 0 below `a`, 1 above `b`, smooth in between (`a` may be the larger: then it falls). */
export const step = (a, b, x) => smooth(Math.min(1, Math.max(0, (x - a) / (b - a))));
/** The colour `t` of the way from `a` to `b`. */
export const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
/** A colour made `k` times as bright. */
export const times = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
/** 1 at `d` 0, falling away over `width`. */
export const bell = (d, width) => Math.exp(-((d / width) ** 2));

// ── painted materials ──────────────────────────────────────────────────────
// Each is a recipe: the numbers in it (how fine each noise, where each stain begins) were tuned by eye and
// mean nothing beyond that.
const RUST_DARK = [0.2, 0.11, 0.07];
const RUST = [0.38, 0.21, 0.11];
const RUST_BRIGHT = [0.52, 0.3, 0.13];
const WOOD_TONE = [
  [0.3, 0.2, 0.12],
  [0.46, 0.33, 0.2],
];
const LEATHER = [0.25, 0.15, 0.09];

/** Rust: dark and mid brown in patches, with bright flecks and dark pits. */
export function rust(x, y, s) {
  let c = mix(RUST_DARK, RUST, step(0.3, 0.7, fbm(x * 2.2, y * 2.2, s + 40, 4)));
  c = mix(c, RUST_BRIGHT, step(0.58, 0.78, fbm(x * 6, y * 6, s + 60, 3)) * 0.7);
  return times(c, 1 - 0.45 * step(0.6, 0.74, fbm(x * 24, y * 24, s + 80, 2)));
}
/**
 * Blade steel: light, scratched along x, with stains of rust. `much` (-1..1) raises or lowers the rust; -1 is
 * a clean blade.
 */
export function steel(x, y, light, s, much = 0) {
  let v =
    (0.57 + 0.1 * (fbm(x * 0.7, y * 2.5, s) - 0.5) + 0.05 * (fbm(x * 6, y * 6, s + 5, 2) - 0.5)) * light;
  // scratches, light and dark
  if (noise(x * 1.3, y * 75, s + 9) > 0.8) v += 0.045;
  if (noise(x * 0.8 + 30, y * 110, s + 11) > 0.86) v -= 0.05;
  let c = [v * 0.96, v * 0.98, v * 1.02];
  const rusted = fbm(x * 0.42, y * 1.3, s + 20) + much + 0.1 * (fbm(x * 3, y * 3, s + 25, 2) - 0.5);
  const crust = step(0.46, 0.66, rusted);
  c = mix(c, times(RUST, 0.9), 0.28 * step(0.32, 0.52, rusted));
  c = mix(c, times(rust(x, y, s), Math.min(1.1, light)), crust * 0.92);
  return times(c, 1 - 0.18 * step(0.38, 0.46, rusted) * (1 - crust));
}
/** Forged iron, dark and pitted. */
export function iron(a, b, light, s, much = 0) {
  const v =
    (0.26 + 0.09 * (fbm(a * 1.4, b * 1.4, s) - 0.5) + 0.05 * (fbm(a * 7, b * 7, s + 3, 2) - 0.5)) * light;
  let c = [v, v * 0.98, v * 0.97];
  const rusted = fbm(a * 0.9, b * 0.9, s + 20) + much + 0.08 * (fbm(a * 4, b * 4, s + 22, 2) - 0.5);
  c = mix(c, times(rust(a, b, s), 0.75 * light), step(0.5, 0.64, rusted) * 0.9);
  return times(c, 1 - 0.3 * step(0.62, 0.74, fbm(a * 22, b * 22, s + 31, 2)));
}
/** Wood with the grain along `x`. `tone`: [dark, light]. */
export function wood(x, y, light, s, tone = WOOD_TONE) {
  const wave = fbm(x * 0.16, y * 0.9, s, 3);
  const grain = 0.5 + 0.5 * Math.sin((y * 3.4 + wave * 9) * 2.2);
  let v =
    0.82 +
    0.22 * (grain - 0.5) * (0.5 + fbm(x * 0.3, y * 2, s + 9, 2)) +
    0.1 * (fbm(x * 2.5, y * 9, s + 4, 2) - 0.5);
  if (noise(x * 0.9, y * 55, s + 11) > 0.83) v -= 0.1;
  return times(mix(tone[0], tone[1], fbm(x * 0.25, y * 0.6, s + 17, 3)), v * light);
}
/** Leather wound in a spiral. `u` along (units), `v` around (0..1). */
export function leatherWrap(u, v, s = 51, base = LEATHER) {
  // how far across its strip of leather the point is, 0 to 1
  const turn = u * 1.35 + v;
  const across = turn - Math.floor(turn);
  let k = 0.62 + 0.42 * Math.sin(Math.PI * across) ** 0.7;
  // the dark gap between two turns
  if (across < 0.07 || across > 0.96) k *= 0.45;
  k *= 0.9 + 0.2 * (fbm(u * 5, v * 14, s, 3) - 0.5) * 2;
  if (noise(u * 3, v * 90, s + 10) > 0.84) k *= 0.85;
  const worn = step(0.52, 0.7, fbm(u * 0.9, v * 3, s + 6)) * step(0.2, 0.6, Math.sin(Math.PI * across));
  return times(mix(base, [base[0] * 1.7, base[1] * 1.9, base[2] * 2.0], worn), k);
}
/**
 * The painted light of a cylinder: `v` around (0..1). Soft on purpose: the piece is seen from
 * any side (in the hand, on the back, on the floor) and with much painted shadow the dark side,
 * when it is the one in view, leaves the piece almost black.
 */
export const cylinderLight = (v, strength = 0.34) =>
  0.84 + strength * 0.65 * Math.cos(2 * Math.PI * (v - 0.22));
/** A rivet at (cx, cy) of radius `rad`: `{light}` inside, `{shadow}` in the ring round it, `null` outside. */
export function rivet(x, y, cx, cy, rad) {
  const dx = (x - cx) / rad;
  const dy = (y - cy) / rad;
  const d = Math.hypot(dx, dy);
  if (d > 1.5) return null;
  if (d > 1) return { shadow: 0.35 * (1 - (d - 1) / 0.5) * Math.max(0, 0.3 + (dx - dy) * 0.7) };
  return { light: 0.85 + 0.75 * Math.max(0, (-dx + dy) * 0.7) * (1 - d * 0.4) - 0.25 * d };
}

// ── the sheet: the texture being painted ───────────────────────────────────
/** A picture of `width` by `height` to paint zone by zone, all `ground` (a colour, 0 to 1) to begin with. */
export function sheet(width, height, ground = [0.2, 0.18, 0.17]) {
  const rgb = new Uint8Array(width * height * 3);
  const put = (x, y, c) => {
    // a whole pixel: a zone whose corner is not on one (a third of another) would write a channel off
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const i = (py * width + px) * 3;
    for (let k = 0; k < 3; k++) rgb[i + k] = Math.max(0, Math.min(255, c[k] * 255));
  };
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) put(px, py, ground);
  return {
    width,
    height,
    /**
     * Paints a zone `{x, y, w, h}` (and `bleed` pixels round it) by calling `fn(u, v)` with `u`, `v` in
     * pixels inside it.
     */
    zone(z, fn, bleed = 4) {
      for (let py = z.y - bleed; py < z.y + z.h + bleed; py++)
        for (let px = z.x - bleed; px < z.x + z.w + bleed; px++) {
          const c = fn(px - z.x, py - z.y);
          if (c) put(px, py, c);
        }
    },
    image() {
      return { width, height, rgb };
    },
  };
}

// ── the shape: the mesh being built ────────────────────────────────────────

/** A ring of a turned surface as it is given ([s, r] or an object), as an object. */
const ringOf = (given) => (Array.isArray(given) ? { s: given[0], r: given[1] } : given);

/**
 * The point of a ring at an angle, as [s, a, b]: along the axis and the two ways across it, before it is
 * placed.
 */
function ringPoint(ring, angle) {
  const r = typeof ring.r === "function" ? ring.r(angle) : ring.r;
  const [ra, rb] = Array.isArray(r) ? r : [r, r];
  const a = (ring.off?.[0] ?? 0) + ra * Math.cos(angle);
  const b = (ring.off?.[1] ?? 0) + rb * Math.sin(angle);
  return [
    ring.s + (ring.ds ? ring.ds(angle) : 0) + (ring.tilt ? ring.tilt[0] * a + ring.tilt[1] * b : 0),
    a,
    b,
  ];
}

/**
 * A cap of a turned surface as it is given, as { dome, rings, profile, zone, crease, w }; null for an open
 * end.
 */
const capOf = (given) =>
  !given
    ? null
    : given === true || given === "flat"
      ? { dome: 0 }
      : typeof given === "number"
        ? { dome: given }
        : given.x !== undefined && given.w !== undefined && given.zone === undefined
          ? { dome: 0, zone: given }
          : given;

/** The middle of a ring's points (the last, which is the first again, left out). */
const middleOf = (points, sides) =>
  [0, 1, 2].map((axis) => points.slice(0, sides).reduce((sum, p) => sum + p[axis], 0) / sides);

/**
 * The rings of a cap: the end ring drawn in about its middle, the last a point. `way`: +1 or -1, which way
 * along the axis the cap rises. From the end ring outwards.
 */
function capRings(cap, end, sides, way) {
  const mid = middleOf(end.pts, sides);
  const count = cap.rings ?? (cap.dome ? 3 : 1);
  // [rise, scale] for each ring: a quarter circle, unless the cap brings a profile of its own
  const profile = cap.profile
    ? cap.profile.map((q) => [...q])
    : Array.from({ length: count }, (_, j) => {
        const t = ((Math.PI / 2) * (j + 1)) / count;
        return [(cap.dome ?? 0) * Math.sin(t), j + 1 === count ? 0 : Math.cos(t)];
      });
  if (profile.at(-1)[1] !== 0) profile.push([profile.at(-1)[0], 0]);
  return profile.map(([rise, scale]) => ({
    s: end.s + way * rise,
    w: cap.w ?? 1,
    pts: end.pts.map((p) => [
      mid[0] + (p[0] - mid[0]) * scale + way * rise,
      mid[1] + (p[1] - mid[1]) * scale,
      mid[2] + (p[2] - mid[2]) * scale,
    ]),
  }));
}

/**
 * A place on a surface, and how to step over it: `off(v, out)` is the surface's point `v` (a short vector
 * along it) away, `out` units off it. Also `alongS`, how the place moves for a unit of `s`.
 */
function onto(surface, s, angle) {
  const here = surface.at(s, angle);
  const stepS = SLOPE_STEP * (Math.abs((surface.spans?.at(-1) ?? 1) - (surface.spans?.[0] ?? 0)) || 1);
  const stepAngle = SLOPE_STEP;
  // how the surface's point moves for a unit of `s`, and for a radian of the angle
  const alongS = sub(surface.at(s + stepS, angle).p, surface.at(s - stepS, angle).p).map(
    (v) => v / (2 * stepS),
  );
  const alongAngle = sub(surface.at(s, angle + stepAngle).p, surface.at(s, angle - stepAngle).p).map(
    (v) => v / (2 * stepAngle),
  );
  const ss = dot(alongS, alongS);
  const sa = dot(alongS, alongAngle);
  const aa = dot(alongAngle, alongAngle);
  const det = ss * aa - sa * sa;
  const off = (v, out = 0) => {
    const want = plus(plus(here.p, v), here.n, out);
    const size = Math.hypot(...v);
    if (!(det > NO_SLOPE)) return want;
    // the change of `s` and of the angle that moves the point by `v`
    const vs = dot(alongS, v);
    const va = dot(alongAngle, v);
    const found = surface.at(s + (aa * vs - sa * va) / det, angle + (ss * va - sa * vs) / det, out).p;
    // past an end of the surface: straight on from its edge
    return apart(found, want) <= 0.5 * size + 1e-6 ? found : want;
  };
  return { ...here, alongS, off };
}

/** A builder of triangles for a picture of `width` by `height`: its tools are documented one by one below. */
export function shape(width, height) {
  const tris = [];
  /**
   * a corner: position, texture pixel and, when the piece moves in parts, which bone it goes on (0 = the main
   * one)
   */
  const V = (p, t, part = 0) => ({ p, t, part });
  /** a triangle; `inside` is a point within the piece, so that it faces outwards */
  const tri = (a, b, c, inside) => {
    const ab = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]];
    const ac = [c.p[0] - a.p[0], c.p[1] - a.p[1], c.p[2] - a.p[2]];
    const normal = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    if (Math.hypot(...normal) < NO_AREA) return;
    const fromInside = [0, 1, 2].map((k) => (a.p[k] + b.p[k] + c.p[k]) / 3 - inside[k]);
    const outwards = normal[0] * fromInside[0] + normal[1] * fromInside[1] + normal[2] * fromInside[2] >= 0;
    tris.push(
      (outwards ? [a, b, c] : [a, c, b]).map((corner) => ({
        p: [...corner.p],
        uv: [corner.t[0] / width, corner.t[1] / height],
        part: corner.part ?? 0,
      })),
    );
  };
  const quad = (a, b, c, d, inside) => {
    tri(a, b, c, inside);
    tri(a, c, d, inside);
  };
  /**
   * A lathe. `profile`: [[s, radius], ...] along the axis; `zone` {x, y, w, h}: `s` runs left to
   * right (`px` pixels a unit, from the first point) and the turn runs top to bottom.
   * `at(s, a, b)` places the point: the axis is x unless told. `flatten` squashes it in z.
   * `caps`: [start, end], each `true` or a zone `{x, y, w, h}` where it is drawn flat.
   * Returns the length of the profile.
   */
  const lathe = (
    profile,
    zone,
    {
      sides = 10,
      flatten = 1,
      px = 48,
      at = (s, a, b) => [s, a, b],
      caps = [false, false],
      twist = 0,
      part = 0,
    } = {},
  ) => {
    // how far along the profile's own line each of its points is
    let length = 0;
    const along = profile.map(([s, r], i) =>
      i ? (length += Math.hypot(s - profile[i - 1][0], r - profile[i - 1][1])) : 0,
    );
    const angleOf = (k) => (2 * Math.PI * k) / sides + twist;
    const rings = profile.map(([s, r], i) =>
      Array.from({ length: sides + 1 }, (_, k) => {
        const angle = angleOf(k);
        return V(
          at(s, r * Math.cos(angle), r * flatten * Math.sin(angle)),
          [zone.x + along[i] * px, zone.y + (zone.h * k) / sides],
          part,
        );
      }),
    );
    for (let i = 0; i + 1 < rings.length; i++)
      for (let k = 0; k < sides; k++)
        quad(
          rings[i][k],
          rings[i + 1][k],
          rings[i + 1][k + 1],
          rings[i][k + 1],
          at((profile[i][0] + profile[i + 1][0]) / 2, 0, 0),
        );
    caps.forEach((cap, which) => {
      if (!cap) return;
      const i = which ? profile.length - 1 : 0;
      const end = rings[i];
      const s = profile[i][0];
      // a point half a unit inside the end, whichever way the profile runs
      const inside = at(
        s + (which ? -1 : 1) * 0.5 * Math.sign(profile[profile.length - 1][0] - profile[0][0]),
        0,
        0,
      );
      // a cap with a zone of its own is laid flat (a disc); otherwise it is a point of the strip
      const flat = (k) => {
        const angle = angleOf(k);
        return [
          cap.x + cap.w / 2 + (Math.cos(angle) * cap.w) / 2,
          cap.y + cap.h / 2 - (Math.sin(angle) * cap.h) / 2,
        ];
      };
      for (let k = 0; k < sides; k++) {
        if (cap.w)
          tri(
            V(end[k].p, flat(k), part),
            V(end[k + 1].p, flat(k + 1), part),
            V(at(s, 0, 0), [cap.x + cap.w / 2, cap.y + cap.h / 2], part),
            inside,
          );
        else
          tri(
            end[k],
            end[k + 1],
            V(
              at(s, 0, 0),
              [
                end[k].t[0] + (which ? LATHE_CAP_PIXELS : -LATHE_CAP_PIXELS),
                (end[k].t[1] + end[k + 1].t[1]) / 2,
              ],
              part,
            ),
            inside,
          );
      }
    });
    return length;
  };
  /**
   * A plate: stations along `s`, each with its half section `[[t, g], ...]` (from one edge to the
   * other, `g` >= 0 the half thickness). Side A (g) goes in `zoneA` and side B (-g) in `zoneB`,
   * laid flat: `u = zone.x + (s - s0) * px`, `v = zone.yc - t * px`.
   * `at(s, t, g)` places the point (x, y, z unless told).
   * `ends`: true closes the first and the last section, where they have a size (a bar's two tips, a blade's
   * base): left open, an end that does not come to a point is a slot into the plate.
   */
  const plate = (
    stations,
    zoneA,
    zoneB,
    { px = 48, s0 = stations[0].s, at = (s, t, g) => [s, t, g], part = 0, ends = false } = {},
  ) => {
    const pixelOf = (zone, s, t) => [zone.x + (s - s0) * px, zone.yc - t * px];
    const faceOf = (zone, sign) =>
      stations.map((station) =>
        station.pts.map(([t, g]) => V(at(station.s, t, sign * g), pixelOf(zone, station.s, t), part)),
      );
    for (const [zone, sign] of [
      [zoneA, 1],
      [zoneB, -1],
    ]) {
      const corners = faceOf(zone, sign);
      for (let i = 0; i + 1 < corners.length; i++) {
        // a point inside the plate between two stations: mid way across, at no thickness
        const acrossMiddle =
          (stations[i].pts[0][0] +
            stations[i].pts.at(-1)[0] +
            stations[i + 1].pts[0][0] +
            stations[i + 1].pts.at(-1)[0]) /
          4;
        const inside = at((stations[i].s + stations[i + 1].s) / 2, acrossMiddle, 0);
        for (let k = 0; k + 1 < corners[i].length; k++)
          quad(corners[i][k], corners[i + 1][k], corners[i + 1][k + 1], corners[i][k + 1], inside);
      }
    }
    if (!ends) return;
    for (const which of [0, stations.length - 1]) {
      const station = stations[which];
      // the section's outline: side A along it, then side B back, without the points where the two meet
      const front = station.pts.map(([t, g]) => V(at(station.s, t, g), pixelOf(zoneA, station.s, t), part));
      const back = station.pts
        .map(([t, g]) => V(at(station.s, t, -g), pixelOf(zoneB, station.s, t), part))
        .filter((_, k) => station.pts[k][1] !== 0)
        .reverse();
      const outline = [...front, ...back];
      // a point inside the plate, a little in from this end
      const next = stations[which ? which - 1 : 1];
      const middleT = (station.pts[0][0] + station.pts.at(-1)[0]) / 2;
      const inside = at(station.s + (next.s - station.s) * 0.01, middleT, 0);
      const centre = V(at(station.s, middleT, 0), pixelOf(zoneA, station.s, middleT), part);
      for (let k = 0; k < outline.length; k++) tri(outline[k], outline[(k + 1) % outline.length], centre, inside);
    }
  };
  // ── since 0.6.0: surfaces that know where they are, and what is built on them ──
  // What these make is turned the right way by how it is built, not by a point inside it, and each corner
  // says what it is part of: `of` (the part's name), `q` (where in the part, along it and round it: what
  // carryPicture goes by), `group` (faces share a normal at a point only within a group: a crease) and, when
  // told, `smooth` (the part's own angle).
  let made = 0;
  /**
   * a corner of those: position, texture pixel, what it is part of ({ part, group, of, smooth }) and where in
   * it
   */
  const C = (p, t, belongs, q) => {
    const corner = { p, t, part: belongs.part ?? 0, group: belongs.group, of: belongs.of, q };
    if (belongs.smooth !== undefined) corner.smooth = belongs.smooth;
    return corner;
  };
  /** a triangle as it is given, counter-clockwise seen from outside (`flip`: the other way) */
  const put = (a, b, c, flip = false) => {
    if (Math.hypot(...cross(sub(b.p, a.p), sub(c.p, a.p))) < NO_AREA) return;
    tris.push(
      (flip ? [a, c, b] : [a, b, c]).map((corner) => {
        const out = {
          p: [...corner.p],
          uv: [corner.t[0] / width, corner.t[1] / height],
          part: corner.part ?? 0,
        };
        for (const k of ["group", "smooth", "of", "q"]) if (corner[k] !== undefined) out[k] = corner[k];
        return out;
      }),
    );
  };
  /** two triangles for the four corners a, b, c, d given round the face */
  const putQuad = (a, b, c, d, flip) => {
    put(a, b, c, flip);
    put(a, c, d, flip);
  };
  /** true when the triangle a, b, c looks away from `n`: it is then put the other way round */
  const wrong = (a, b, c, n) => dot(cross(sub(b.p, a.p), sub(c.p, a.p)), n) < 0;
  /**
   * A turned surface: the lathe's successor. `rings`: [[s, r], ...] or
   * [{ s, r, ds, off, tilt, crease, w }, ...] along the axis:
   *   s       where the ring is along the axis; r: its radius, or [ra, rb] (an oval), or (angle) => either
   *           (any outline)
   *   ds      (angle) => how far the ring's point at that angle is moved along the axis (a rim that dips at
   *           the front)
   *   off     [a, b]: its centre moved off the axis; tilt: [ta, tb]: it leans, `s` growing by ta a unit of a
   *           and tb a unit of b
   *   crease  true: a hard edge here, however gentle the bend (elsewhere two bands share their normals where
   *           they meet at less than the mesh's angle, or this part's own `smooth`: 180 makes it smooth all
   *           over)
   *   w       the weight of the band that ends at this ring in the picture (1; 2 gives it twice the pixels
   *           its size asks)
   * `zone` {x, y, w, h}: the surface fills it, each band as long in it as it is on the real surface (measured
   * after `at`).
   * Options:
   *   sides (12), at(s, a, b) (where a point goes: x, y, z unless told), part, name, smooth (this part's
   *           own angle)
   *   seam    the angle (radians) the first corner is at, where the picture's two edges meet (0)
   *   lie     "along" (the length left to right, the turn top to bottom, as the lathe) or "across" (the turn
   *           left to right, the first ring at the bottom: a barrel standing in its picture)
   *   px      pixels a unit along it, in place of filling the zone's length
   *   places  { rings: [[s, u], ...], round: [v, ...] }: where rings of those `s` lie along the zone and the
   *           corners round it, 0 to 1: what an earlier build returned as `places`. They stay there, and a
   *           ring added between two lies between them, so nothing painted moves (a ring added past the last
   *           runs out of the zone: leave it room)
   *   caps    [start, end], each false (open), true (flat), a height (a dome that high; under 0 it is sunk),
   *           a zone (flat, laid as a disc there) or { dome, rings (3), profile: [[rise, scale], ...], zone,
   *           crease, w }
   *   lining  { inset, zone, from, to, cap, rim }: the inside, facing inwards, `inset` units in from the
   *           surface, from ring `from` (0) to ring `to` (the last) in a zone of its own; `cap`: true closes
   *           its far end flat, a number with a cone that deep; `rim` (when inset): the edge between the two
   *           at ring `from`
   *   face    "in": the whole surface faces inwards
   * Returns the surface: { name, sides, seam, length, girth, reach: [start, end] (units: its rings' length,
   * the way round them, and how far each cap's point is from its ring over the cap), rings, places,
   * ends: [{ p, n }, { p, n }], at(s, angle, out) }.
   * `at` gives { p, n, uv } on the built faces themselves (`uv` in pixels), `out` units off them: for
   * anything that sits on it.
   */
  const turn = (rings, zone, o = {}) => {
    const {
      sides = 12,
      at = (s, a, b) => [s, a, b],
      seam = 0,
      caps = [false, false],
      lining = null,
      lie = "along",
      px = null,
      places = null,
      part = 0,
      face = "out",
      smooth,
    } = o;
    const name = o.name ?? `turn${++made}`;
    const given = rings.map(ringOf);
    // +1 when `s` grows from the first ring to the last, -1 when it falls
    const direction = Math.sign(given.at(-1).s - given[0].s) || 1;
    /** the angle of corner `k` round a ring: corner `sides` is corner 0 again */
    const angleOf = (k) => seam + (2 * Math.PI * (k % sides)) / sides;

    // every ring of the surface, the caps' included: where it is along the axis and its points, not yet
    // placed
    const all = given.map((ring) => ({
      s: ring.s,
      crease: ring.crease,
      w: ring.w ?? 1,
      pts: Array.from({ length: sides + 1 }, (_, k) => ringPoint(ring, angleOf(k))),
    }));
    // the caps: more rings, each the end ring drawn in about its middle, the last a point
    const capsGiven = caps.map(capOf);
    const capCount = [0, 0];
    capsGiven.forEach((cap, which) => {
      if (!cap) return;
      const end = which ? all.at(-1) : all[0];
      const more = capRings(cap, end, sides, which ? direction : -direction);
      end.crease = end.crease ?? cap.crease ?? !(cap.dome || cap.profile);
      capCount[which] = more.length;
      if (which) all.push(...more);
      else all.unshift(...more.reverse());
    });
    const count = all.length;
    const points = all.map((ring) => ring.pts.map((p) => at(...p)));
    // the first and the last of the rings given, among them all; and the rings the strip in the zone runs
    // between (a cap with a zone of its own is laid there as a disc, the others are part of the strip)
    const first = capCount[0];
    const last = count - 1 - capCount[1];
    const stripFrom = capsGiven[0]?.zone ? first : 0;
    const stripTo = capsGiven[1]?.zone ? last : count - 1;
    const isPole = points.map((ring) => ring.every((p) => apart(p, ring[0]) < SAME_POINT));
    const middles = points.map((ring) => middleOf(ring, sides));

    // the real surface: how far each ring is from the next, and each corner from the next round the rings
    const gaps = Array.from(
      { length: count - 1 },
      (_, i) => points[i].slice(0, sides).reduce((sum, p, k) => sum + apart(p, points[i + 1][k]), 0) / sides,
    );
    const girths = Array.from(
      { length: sides },
      (_, k) =>
        points.slice(first, last + 1).reduce((sum, ring) => sum + apart(ring[k], ring[k + 1]), 0) /
        (last - first + 1),
    );
    const girth = girths.reduce((a, b) => a + b, 0);
    // round the zone: each corner's place, 0 to 1, by the real distances or as `places` has them
    const round = places?.round?.length === sides + 1 ? [...places.round] : [0];
    if (round.length === 1) {
      for (const g of girths) round.push(round.at(-1) + g / (girth || 1));
      round[sides] = 1;
    }
    // along the zone: by the real distances (and the weights), or as `places` pins them
    const run = [];
    for (let i = stripFrom; i <= stripTo; i++)
      run[i] = i === stripFrom ? 0 : run[i - 1] + gaps[i - 1] * (i - 1 < first ? all[i - 1].w : all[i].w);
    const share = run.map((v) => v / (run[stripTo] || 1));
    const along = px ? run.map((v) => (v * px) / (lie === "across" ? zone.h : zone.w)) : [...share];
    if (places) {
      const pins = [];
      for (let i = first; i <= last; i++) {
        const pinned = (places.rings ?? []).find(([s]) => Math.abs(s - all[i].s) < SAME_RING);
        if (pinned) pins.push([i, pinned[1]]);
      }
      // between two pinned rings the others keep their natural proportions; past the last pin, their natural
      // size
      const natural = [...along];
      const slope = (a, b) => (b[1] - a[1]) / (natural[b[0]] - natural[a[0]] || 1);
      if (pins.length)
        for (let i = stripFrom; i <= stripTo; i++) {
          const next = pins.findIndex((pin) => pin[0] >= i);
          const j = Math.max(0, Math.min(pins.length - 2, next < 0 ? pins.length : next - 1));
          const a = pins[j];
          const b = pins[j + 1];
          along[i] = a[1] + (natural[i] - natural[a[0]]) * (b ? slope(a, b) : 1);
        }
    }
    // over each cap: how far each of its rings is from its point, over the surface
    const reach = [0, 1].map((which) => {
      const fromPoint = [];
      if (which)
        for (let i = count - 1; i >= last; i--)
          fromPoint[i] = i === count - 1 ? 0 : fromPoint[i + 1] + gaps[i];
      else for (let i = 0; i <= first; i++) fromPoint[i] = i ? fromPoint[i - 1] + gaps[i - 1] : 0;
      return fromPoint;
    });
    /** how far out ring `i` is in the disc of cap `which`: 0 at its point, 1 at the end ring */
    const radiusIn = (which, i) => reach[which][i] / (reach[which][which ? last : first] || 1);
    /** where a corner is on the picture: in the strip, or in a cap's disc */
    const inStrip = (i, k, v = round[k]) => lay(zone, along[i], v, lie);
    const inCapDisc = (which, i, k) => onDisc(capsGiven[which].zone, angleOf(k), radiusIn(which, i));
    /** which cap's disc the band from ring `i` to the next is in (0 or 1), or -1 for the strip */
    const discOf = (i) => (i < stripFrom ? 0 : i >= stripTo ? 1 : -1);
    // each ring's mark along the surface, for carrying a picture: its own `s`; a cap's rings go on from the
    // end ring's by their real distance
    const mark = all.map((ring, i) =>
      i < first
        ? all[first].s - direction * (reach[0][first] - reach[0][i])
        : i > last
          ? all[last].s + direction * (reach[1][last] - reach[1][i])
          : ring.s,
    );

    // which way round: the faces look away from the line through the rings' middles
    let volume = 0;
    for (let i = 0; i + 1 < count; i++)
      for (let k = 0; k < sides; k++) {
        const A = points[i][k];
        const B = points[i + 1][k];
        const E = points[i + 1][k + 1];
        const D = points[i][k + 1];
        volume += dot(
          cross(sub(E, A), sub(D, B)),
          sub(
            [0, 1, 2].map((a) => (A[a] + B[a] + E[a] + D[a]) / 4),
            [0, 1, 2].map((a) => (middles[i][a] + middles[i + 1][a]) / 2),
          ),
        );
      }
    const outward = volume < 0 ? -1 : 1;
    const flip = volume < 0 !== (face === "in");
    // each corner's normal: the sum of the faces that meet there (a pole's corners all share one)
    const summed = points.map(() => Array.from({ length: sides }, () => [0, 0, 0]));
    for (let i = 0; i + 1 < count; i++)
      for (let k = 0; k < sides; k++) {
        const A = points[i][k];
        const B = points[i + 1][k];
        const E = points[i + 1][k + 1];
        const D = points[i][k + 1];
        for (const [faceNormal, corners] of [
          [
            cross(sub(B, A), sub(E, A)),
            [
              [i, k],
              [i + 1, k],
              [i + 1, k + 1],
            ],
          ],
          [
            cross(sub(E, A), sub(D, A)),
            [
              [i, k],
              [i + 1, k + 1],
              [i, k + 1],
            ],
          ],
        ])
          for (const [ring, corner] of corners) {
            const sum = summed[ring][isPole[ring] ? 0 : corner % sides];
            for (let axis = 0; axis < 3; axis++) sum[axis] += faceNormal[axis] * outward;
          }
      }
    const normals = summed.map((ring, i) =>
      Array.from({ length: sides + 1 }, (_, k) => unit(ring[isPole[i] ? 0 : k % sides])),
    );

    // the faces
    let group = ++GROUPS;
    for (let i = 0; i + 1 < count; i++) {
      if (i > 0 && all[i].crease) group = ++GROUPS;
      const disc = discOf(i);
      const of = disc < 0 ? name : `${name}.cap${disc}`;
      const corner = (j, k, v) =>
        C(
          points[j][k],
          disc < 0 ? inStrip(j, k, v) : inCapDisc(disc, j, k),
          { part, group, of, smooth },
          disc < 0 ? [mark[j], v ?? round[k]] : inDisc(angleOf(k), radiusIn(disc, j)),
        );
      for (let k = 0; k < sides; k++) {
        // a point in the strip: one triangle a side, its tip half way between the two corners
        if (disc < 0 && (isPole[i] || isPole[i + 1])) {
          const halfWay = (round[k] + round[k + 1]) / 2;
          if (isPole[i]) put(corner(i, k, halfWay), corner(i + 1, k), corner(i + 1, k + 1), flip);
          else put(corner(i, k), corner(i + 1, k, halfWay), corner(i, k + 1), flip);
          continue;
        }
        putQuad(corner(i, k), corner(i + 1, k), corner(i + 1, k + 1), corner(i, k + 1), flip);
      }
    }

    if (lining) {
      const {
        inset = 0,
        zone: liningZone = zone,
        from = 0,
        to = given.length - 1,
        cap = false,
        rim = inset > 0,
      } = lining;
      // the rings it runs over, from `from` to `to` (either way), as numbers among all the rings
      const way = Math.sign(to - from) || 1;
      const lined = [];
      for (let j = from; ; j += way) {
        lined.push(first + j);
        if (j === to) break;
      }
      const inner = lined.map((i) => points[i].map((p, k) => plus(p, normals[i][k], -inset)));
      const liningGroup = ++GROUPS;
      const rimGroup = liningGroup + 1;
      const liningName = `${name}.lining`;
      // how far along the lining each of its rings is (the rim's width first, when it has one), then its
      // cap's tip
      const liningRun = [rim ? inset : 0];
      for (let j = 1; j < lined.length; j++)
        liningRun.push(liningRun.at(-1) + gaps[Math.min(lined[j], lined[j - 1])]);
      let tip = null;
      if (cap !== false) {
        const mid = middleOf(all[lined.at(-1)].pts, sides);
        tip = at(mid[0] + (cap === true ? 0 : cap) * direction * way, mid[1], mid[2]);
        liningRun.push(
          liningRun.at(-1) +
            inner
              .at(-1)
              .slice(0, sides)
              .reduce((sum, p) => sum + apart(p, tip), 0) /
              sides,
        );
      }
      const total = liningRun.at(-1) || 1;
      /**
       * a corner of the lining: ring `j` of it (-1: on the outer surface, for the rim; one past the last: the
       * tip)
       */
      const corner = (j, k, v = round[k]) =>
        C(
          j < 0 ? points[lined[0]][k] : j === lined.length ? tip : inner[j][k],
          lay(liningZone, j < 0 ? 0 : liningRun[j] / total, v, lie),
          { part, group: j < 0 ? rimGroup : liningGroup, of: j < 0 ? `${name}.rim` : liningName, smooth },
          [
            j < 0
              ? 0
              : j === lined.length
                ? mark[lined.at(-1)] + direction * way * (liningRun[j] - liningRun[j - 1])
                : mark[lined[j]],
            v,
          ],
        );
      const inward = way > 0 ? !flip : flip;
      for (let j = 0; j + 1 < lined.length; j++)
        for (let k = 0; k < sides; k++)
          putQuad(corner(j, k), corner(j + 1, k), corner(j + 1, k + 1), corner(j, k + 1), inward);
      if (tip)
        for (let k = 0; k < sides; k++)
          put(
            corner(lined.length - 1, k),
            corner(lined.length, k, (round[k] + round[k + 1]) / 2),
            corner(lined.length - 1, k + 1),
            inward,
          );
      if (rim) {
        // the edge between outside and inside, a group of its own
        GROUPS++;
        const onRim = (k) => ({ ...corner(0, k), group: rimGroup, of: `${name}.rim`, q: [1, round[k]] });
        for (let k = 0; k < sides; k++) {
          const a = onRim(k);
          const b = corner(-1, k);
          const c = corner(-1, k + 1);
          const e = onRim(k + 1);
          putQuad(a, b, c, e, !inward);
        }
      }
    }

    const spans = all.map((ring) => ring.s);
    const rising = spans.at(-1) >= spans[0];
    /** an end of the surface: its middle, and the way it looks */
    const endOf = (i, next) => ({
      p: middles[i],
      n: isPole[i] ? normals[i][0] : unit(sub(middles[i], middles[next])),
    });
    return {
      name,
      sides,
      seam,
      zone,
      rings: given.map((ring) => ring.s),
      spans,
      length: gaps.slice(first, last).reduce((a, b) => a + b, 0),
      girth,
      reach: [reach[0][first], reach[1][last]],
      places: {
        rings: all.slice(first, last + 1).map((ring, j) => [ring.s, along[first + j]]),
        round: [...round],
      },
      ends: [endOf(0, 1), endOf(count - 1, count - 2)],
      at(s, angle, out = 0) {
        s = rising
          ? Math.max(spans[0], Math.min(spans.at(-1), s))
          : Math.min(spans[0], Math.max(spans.at(-1), s));
        // the band and the side the point is in, and how far across each: `t` along, `w` round
        let i = 0;
        while (i + 2 < count && (rising ? s > spans[i + 1] : s < spans[i + 1])) i++;
        const t = spans[i + 1] === spans[i] ? 0 : (s - spans[i]) / (spans[i + 1] - spans[i]);
        const turns = (((((angle - seam) / (2 * Math.PI)) % 1) + 1) % 1) * sides;
        const k = Math.min(sides - 1, Math.floor(turns));
        const w = turns - k;
        const disc = discOf(i);
        // on the very triangle of the two that holds the point
        const mixed = (valueAt) => {
          const A = valueAt(i, k);
          const B = valueAt(i + 1, k);
          const E = valueAt(i + 1, k + 1);
          const D = valueAt(i, k + 1);
          return A.map((v, x) =>
            t >= w ? v + t * (B[x] - v) + w * (E[x] - B[x]) : v + w * (D[x] - v) + t * (E[x] - D[x]),
          );
        };
        const normal = unit(mixed((ring, corner) => normals[ring][corner]));
        return {
          p: plus(
            mixed((ring, corner) => points[ring][corner]),
            normal,
            out,
          ),
          n: normal,
          uv: mixed((ring, corner) => (disc < 0 ? inStrip(ring, corner) : inCapDisc(disc, ring, corner))),
        };
      },
    };
  };
  /**
   * A tube or a tail along a path: a turned surface whose axis is a curve. `path`: [[x, y, z, r], ...] or
   * [{ p, r }, ...], `r` a radius or [up, sideways]; 0 at an end makes a point. `up` ([0, 0, 1]): which way a
   * ring's first corner looks at the start; it is carried along the path without twisting. The other options,
   * and what it returns, are `turn`'s.
   */
  const tube = (path, zone, o = {}) => {
    const stations = path.map((q) => (Array.isArray(q) ? { p: q.slice(0, 3), r: q[3] } : q));
    const count = stations.length;
    // how far along the path each station is
    const lengths = [0];
    for (let i = 1; i < count; i++) lengths.push(lengths[i - 1] + apart(stations[i].p, stations[i - 1].p));
    // at each station: the way the path runs, and two directions across it (`up` carried along, and the
    // third)
    const tangents = stations.map((_, i) =>
      unit(sub(stations[Math.min(count - 1, i + 1)].p, stations[Math.max(0, i - 1)].p)),
    );
    /** `v` with what it has along `tangent` taken out */
    const across = (v, tangent) =>
      unit(
        sub(
          v,
          tangent.map((x) => x * dot(v, tangent)),
        ),
      );
    const up = o.up ?? [0, 0, 1];
    const ups = [across(Math.abs(dot(up, tangents[0])) > NEARLY_ALONG ? [1, 0, 0] : up, tangents[0])];
    for (let i = 1; i < count; i++) ups.push(across(ups[i - 1], tangents[i]));
    const sideways = ups.map((a, i) => cross(tangents[i], a));
    const at = (s, a, b) => {
      // past an end: straight on from it
      if (s <= 0 || s >= lengths[count - 1]) {
        const i = s <= 0 ? 0 : count - 1;
        return [0, 1, 2].map(
          (x) => stations[i].p[x] + tangents[i][x] * (s - lengths[i]) + ups[i][x] * a + sideways[i][x] * b,
        );
      }
      let i = 0;
      while (i + 2 < count && s > lengths[i + 1]) i++;
      const t = (s - lengths[i]) / (lengths[i + 1] - lengths[i]);
      return [0, 1, 2].map(
        (x) =>
          stations[i].p[x] +
          (stations[i + 1].p[x] - stations[i].p[x]) * t +
          (ups[i][x] + (ups[i + 1][x] - ups[i][x]) * t) * a +
          (sideways[i][x] + (sideways[i + 1][x] - sideways[i][x]) * t) * b,
      );
    };
    return turn(
      stations.map((station, i) => ({ ...station, s: lengths[i], r: station.r })),
      zone,
      { sides: 6, name: `tube${++made}`, ...o, at },
    );
  };
  /**
   * A ridge or a bar along a path on a surface (what `turn` or `tube` returned, or anything with
   * at(s, angle, out) -> { p, n }). `path`: [[s, angle], ...]; it is cut wherever it crosses from one face of
   * the surface to the next, so it follows them. `zone` {x, y, w, h}: its length along the zone, its section
   * across it.
   *   width (0.5), height (0.2)   of its section, in units; top: the width of a flat top (0: a ridge with one
   *                               edge)
   *   sink (0.05)                 how far its feet go under the surface, so that no gap shows
   *   ends                        [start, end], each "point" (it narrows and falls to a point), "run" (it
   *                               falls into the surface at its full width), "cut" (its section, closed) or
   *                               "open" (its section, left open)
   *   over                        the length an end takes to grow to the full section (the width), or
   *                               [start, end]
   *   steps                       each stretch of the path cut in so many more (1), for a surface that does
   *                               not say where its faces are
   * Returns { name, length }.
   */
  const ridge = (surface, path, zone, o = {}) => {
    const {
      width: wide = 0.5,
      height: high = 0.2,
      top = 0,
      sink = 0.05,
      ends = ["point", "point"],
      lie = "along",
      part = 0,
      smooth,
      steps = 1,
    } = o;
    const name = o.name ?? `ridge${++made}`;
    const group = ++GROUPS;
    const over = [o.over ?? wide].flat();

    // the path, cut wherever it crosses from one face of the surface to the next
    const places = [];
    path.forEach((to, j) => {
      if (!j) return void places.push(to);
      const from = path[j - 1];
      // where along this stretch (0 to 1) it is cut: by `steps`, at the surface's sides, and at its rings
      const cuts = [];
      for (let q = 1; q < steps; q++) cuts.push(q / steps);
      if (surface.sides) {
        const sideAt = (angle) => ((angle - (surface.seam ?? 0)) / (2 * Math.PI)) * surface.sides;
        const sideFrom = sideAt(from[1]);
        const sideTo = sideAt(to[1]);
        for (
          let q = Math.ceil(Math.min(sideFrom, sideTo) + AT_AN_END);
          q < Math.max(sideFrom, sideTo) - AT_AN_END;
          q++
        )
          cuts.push((q - sideFrom) / (sideTo - sideFrom));
      }
      for (const s of surface.spans ?? []) {
        const t = (s - from[0]) / (to[0] - from[0]);
        if (t > AT_AN_END && t < 1 - AT_AN_END) cuts.push(t);
      }
      let lastCut = 0;
      for (const t of cuts.sort((x, y) => x - y))
        if (t - lastCut > SAME_PLACE) {
          places.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
          lastCut = t;
        }
      places.push(to);
    });
    /** how far along the ridge each of its places is, in units */
    const measure = () => {
      const lengths = [0];
      for (let j = 1; j < places.length; j++)
        lengths.push(lengths[j - 1] + apart(surface.at(...places[j - 1]).p, surface.at(...places[j]).p));
      return lengths;
    };
    let lengths = measure();
    // the length each end takes to grow to its full section: never more than half the ridge
    const grow = [0, 1].map((end) =>
      ends[end] === "point" || ends[end] === "run" ? Math.min(over[end] ?? over[0], lengths.at(-1) / 2) : 0,
    );
    // a point of the path where each end has grown to its full section
    for (const end of [0, 1]) {
      const want = end ? lengths.at(-1) - grow[1] : grow[0];
      const j = lengths.findIndex((v) => v > want - SAME_PLACE);
      // a place already near it (a ring's cut) serves: one put a hair from it makes a sliver that folds over
      // where the surface bends at that ring
      const near = lengths.findIndex((v) => Math.abs(v - want) < Math.max(SAME_PLACE, NEAR_GROW * grow[end]));
      if (!grow[end] || j < 1 || near >= 0) continue;
      const t = (want - lengths[j - 1]) / (lengths[j] - lengths[j - 1]);
      places.splice(j, 0, [
        places[j - 1][0] + (places[j][0] - places[j - 1][0]) * t,
        places[j - 1][1] + (places[j][1] - places[j - 1][1]) * t,
      ]);
      lengths = measure();
    }

    // its section: [across (-1 to 1), up (0 to 1)], with a flat top or one edge; and how far round it each
    // point is
    const total = lengths.at(-1) || 1;
    const half = wide / 2;
    const section =
      top > 0
        ? [
            [-1, 0],
            [-top / wide, 1],
            [top / wide, 1],
            [1, 0],
          ]
        : [
            [-1, 0],
            [0, 1],
            [1, 0],
          ];
    const roundSection = [0];
    for (let c = 1; c < section.length; c++)
      roundSection.push(
        roundSection[c - 1] +
          Math.hypot((section[c][0] - section[c - 1][0]) * half, (section[c][1] - section[c - 1][1]) * high),
      );

    // the section stood on the surface at every place of the path
    const onSurface = places.map((place) => surface.at(...place).p);
    // a path that comes back to where it began (a band once round) is one loop: its ends are one section
    const loop = places.length > 2 && apart(onSurface[0], onSurface.at(-1)) < SAME_PLACE;
    const before = (j) => (j > 0 ? j - 1 : loop ? places.length - 2 : 0);
    const after = (j) => (j < places.length - 1 ? j + 1 : loop ? 1 : places.length - 1);
    const surfaceNormals = [];
    const sections = places.map(([s, angle], j) => {
      const here = onto(surface, s, angle);
      const tangent = unit(sub(onSurface[after(j)], onSurface[before(j)]));
      const side = unit(cross(here.n, tangent));
      // how much of its full section it has here, by each end: 0 at the end itself, 1 once it has grown
      const grown = [0, 1].map((end) =>
        grow[end] ? Math.min(1, (end ? total - lengths[j] : lengths[j]) / grow[end]) : 1,
      );
      const heightShare = Math.min(grown[0], grown[1]);
      const widthShare = Math.min(ends[0] === "run" ? 1 : grown[0], ends[1] === "run" ? 1 : grown[1]);
      surfaceNormals.push(here.n);
      return section.map(([x, y], c) => {
        const across = 0.5 + (roundSection[c] / roundSection.at(-1) - 0.5) * widthShare;
        return C(
          here.off(
            side.map((v) => v * x * half * widthShare),
            -sink + y * (high + sink) * heightShare,
          ),
          lay(zone, lengths[j] / total, across, lie),
          { part, group, of: name, smooth },
          [lengths[j] / total, across],
        );
      });
    });
    if (loop) sections.at(-1).forEach((corner, c) => (corner.p = [...sections[0][c].p]));
    for (let j = 0; j + 1 < sections.length; j++)
      for (let c = 0; c + 1 < section.length; c++) {
        const a = sections[j][c];
        const b = sections[j + 1][c];
        const e = sections[j + 1][c + 1];
        const f = sections[j][c + 1];
        const out = plus(surfaceNormals[j], surfaceNormals[j + 1]);
        // one turn for the whole quad, from its diagonals: two triangles of one quad asked apart can come
        // out turned apart where the surface bends sharply under them
        const flip = dot(cross(sub(e.p, a.p), sub(f.p, b.p)), out) < 0;
        put(a, b, e, flip);
        put(a, e, f, flip);
      }
    // an end that is cut: its section closed, facing away from the ridge
    for (const end of [0, 1])
      if (ends[end] === "cut") {
        const corners = sections[end ? sections.length - 1 : 0];
        const away = sub(
          onSurface[end ? onSurface.length - 1 : 0],
          onSurface[end ? onSurface.length - 2 : 1],
        );
        for (let c = 1; c + 1 < corners.length; c++)
          put(corners[0], corners[c], corners[c + 1], wrong(corners[0], corners[c], corners[c + 1], away));
      }
    return { name, length: lengths.at(-1) };
  };
  /**
   * A band round a surface at `s`: a bar with a flat top, from the angle `from` (the seam) to `to` (once
   * round). The options are `ridge`'s.
   */
  const band = (surface, s, zone, o = {}) => {
    const from = o.from ?? surface.seam ?? 0;
    const wide = o.width ?? 0.5;
    return ridge(
      surface,
      [
        [s, from],
        [s, o.to ?? from + 2 * Math.PI],
      ],
      zone,
      {
        top: wide * BAND_TOP,
        ends: ["open", "open"],
        name: `band${++made}`,
        steps: surface.sides ? 1 : FINE_STEPS,
        ...o,
        width: wide,
      },
    );
  };
  /**
   * A boss: a round stud on a surface at [s, angle], `radius` (0.3) wide and `height` (0.15) high, of `sides`
   * (8), as a low cone or, with `rings` 2 or more, a dome. `zone`: it is laid there as a disc. `sink` (0.03):
   * its foot under the surface.
   */
  const boss = (surface, [s, angle], zone, o = {}) => {
    const {
      radius = 0.3,
      height: high = 0.15,
      sides = 8,
      rings = 1,
      sink = 0.03,
      part = 0,
      smooth,
      spin = 0,
    } = o;
    const name = o.name ?? `boss${++made}`;
    const group = ++GROUPS;
    const here = onto(surface, s, angle);
    // two directions along the surface there: the way `s` grows (or any, where that is straight out), and
    // across it
    const flat = sub(
      here.alongS,
      here.n.map((v) => v * dot(here.alongS, here.n)),
    );
    const along = unit(
      Math.hypot(...flat) > SAME_POINT
        ? flat
        : cross(here.n, Math.abs(here.n[2]) < MOSTLY_UP ? [0, 0, 1] : [1, 0, 0]),
    );
    const across = cross(here.n, along);
    const belongs = { part, group, of: name, smooth };
    /** ring `j` of the dome: 0 its foot, under the surface; the others a quarter circle up to the tip */
    const ringOfBoss = (j) => {
      const t = ((Math.PI / 2) * j) / rings;
      const drawnIn = Math.cos(t);
      return Array.from({ length: sides + 1 }, (_, k) => {
        const round = spin + (2 * Math.PI * (k % sides)) / sides;
        return C(
          here.off(
            plus(
              along.map((v) => v * radius * drawnIn * Math.cos(round)),
              across,
              radius * drawnIn * Math.sin(round),
            ),
            j ? high * Math.sin(t) : -sink,
          ),
          onDisc(zone, round, drawnIn),
          belongs,
          inDisc(round, drawnIn),
        );
      });
    };
    const ringsOfBoss = Array.from({ length: rings }, (_, j) => ringOfBoss(j));
    const tip = C(surface.at(s, angle, high).p, centreOf(zone), belongs, [0.5, 0.5]);
    for (let j = 0; j < rings; j++)
      for (let k = 0; k < sides; k++) {
        const p = ringsOfBoss[j][k];
        const q = ringsOfBoss[j][k + 1];
        // the last ring closes on the tip
        if (j + 1 === rings) {
          put(p, q, tip, wrong(p, q, tip, here.n));
          continue;
        }
        const e = ringsOfBoss[j + 1][k + 1];
        const f = ringsOfBoss[j + 1][k];
        put(p, q, e, wrong(p, q, e, here.n));
        put(p, e, f, wrong(p, e, f, here.n));
      }
    return { name, p: here.p, n: here.n };
  };
  /**
   * A row of bosses along a path on a surface ([[s, angle], ...]), `count` of them evenly from its first
   * point to its last (`closed`: round a ring, the last left out). They share the zone: one picture for all.
   * The other options are `boss`'s. Returns their places.
   */
  const studs = (surface, path, zone, o = {}) => {
    // the path cut fine, and how far along it each cut is on the real surface
    const fine = path.flatMap((to, j) =>
      j
        ? Array.from({ length: FINE_STEPS }, (_, q) => [
            path[j - 1][0] + ((to[0] - path[j - 1][0]) * (q + 1)) / FINE_STEPS,
            path[j - 1][1] + ((to[1] - path[j - 1][1]) * (q + 1)) / FINE_STEPS,
          ])
        : [to],
    );
    const lengths = [0];
    for (let j = 1; j < fine.length; j++)
      lengths.push(lengths[j - 1] + apart(surface.at(...fine[j - 1]).p, surface.at(...fine[j]).p));
    const count = o.count ?? 2;
    const name = o.name ?? `studs${++made}`;
    const places = Array.from({ length: count }, (_, q) => {
      const want = (lengths.at(-1) * q) / (o.closed ? count : Math.max(1, count - 1));
      const j = Math.max(
        1,
        lengths.findIndex((v) => v >= want),
      );
      const t = (want - lengths[j - 1]) / (lengths[j] - lengths[j - 1] || 1);
      return [
        fine[j - 1][0] + (fine[j][0] - fine[j - 1][0]) * t,
        fine[j - 1][1] + (fine[j][1] - fine[j - 1][1]) * t,
      ];
    });
    places.forEach((place, i) => boss(surface, place, zone, { ...o, name: `${name}.${i}` }));
    return places;
  };
  /**
   * A thin sheet seen from both sides: a leaf, a feather, a cloth flap. `rows`: [[p, p, ...], ...], a grid of
   * points (rows of one length; two rows of two make a single quad, a row of one point repeated a tip). Each
   * side has its own faces and its own normals, so each is lit as it faces. `zone`: the front's picture;
   * `back`: the back's (the same unless told).
   */
  const leaf = (rows, zone, o = {}) => {
    const { back = zone, lie = "along", part = 0, smooth } = o;
    const name = o.name ?? `leaf${++made}`;
    const groups = [++GROUPS, ++GROUPS];
    const rowCount = rows.length;
    const columnCount = rows[0].length;
    // how far each row is from the first, and each column, on the real sheet
    const alongRows = [0];
    const alongColumns = [0];
    for (let i = 1; i < rowCount; i++)
      alongRows.push(
        alongRows[i - 1] + rows[i].reduce((sum, p, j) => sum + apart(p, rows[i - 1][j]), 0) / columnCount,
      );
    for (let j = 1; j < columnCount; j++)
      alongColumns.push(
        alongColumns[j - 1] + rows.reduce((sum, row) => sum + apart(row[j], row[j - 1]), 0) / rowCount,
      );
    /** the corner at row `i`, column `j` of the front (side 0) or the back (side 1) */
    const corner = (i, j, side) => {
      const u = alongRows[i] / (alongRows.at(-1) || 1);
      const v = alongColumns[j] / (alongColumns.at(-1) || 1);
      return C(
        rows[i][j],
        lay(side ? back : zone, u, v, lie),
        { part, group: groups[side], of: side ? `${name}.back` : name, smooth },
        [u, v],
      );
    };
    for (let i = 0; i + 1 < rowCount; i++)
      for (let j = 0; j + 1 < columnCount; j++)
        for (const side of [0, 1]) {
          const a = corner(i, j, side);
          const b = corner(i + 1, j, side);
          const e = corner(i + 1, j + 1, side);
          const h = corner(i, j + 1, side);
          put(a, b, e, !!side);
          put(a, e, h, !!side);
        }
    return { name };
  };
  return { V, tri, quad, lathe, plate, turn, tube, ridge, band, boss, studs, leaf, tris };
}

/**
 * Zones for a picture, each part getting pixels in proportion to its size: `parts` is { NAME: [long, wide] }
 * in units (or [long, wide, weight]: 2 gives it twice the area its size asks). They are laid in rows in the
 * order given, at the largest scale at which all fit. Returns { NAME: { x, y, w, h } } and `px`, the pixels a
 * unit. Do it once and keep the zones in the script: a part made larger later would move the others.
 */
export function allot(width, height, parts, { gap = 6 } = {}) {
  // laid tallest first, row by row (shelf packing): a row is as high as its first zone, and the short zones
  // after it fill rows of their own height instead of each standing in a tall one's row
  const list = Object.entries(parts)
    .map(([name, [long, wide, weight = 1]]) => ({ name, w: long * Math.sqrt(weight), h: wide * Math.sqrt(weight) }))
    .sort((a, b) => b.h - a.h);
  /** the zones at `px` pixels a unit, laid in rows; null when they do not all fit */
  const placeAt = (px) => {
    const out = { px };
    let x = gap;
    let y = gap;
    let rowHigh = 0;
    for (const part of list) {
      const w = Math.max(1, Math.floor(part.w * px));
      const h = Math.max(1, Math.floor(part.h * px));
      if (x + w + gap > width && x > gap) {
        x = gap;
        y += rowHigh + gap;
        rowHigh = 0;
      }
      if (x + w + gap > width || y + h + gap > height) return null;
      out[part.name] = { x, y, w, h };
      x += w + gap;
      rowHigh = Math.max(rowHigh, h);
    }
    return out;
  };
  // the largest scale that fits, by halving the range it can be in
  let fits = 0;
  let tooLarge = Math.max(width, height);
  for (let i = 0; i < 40; i++) {
    const middle = (fits + tooLarge) / 2;
    if (placeAt(middle)) fits = middle;
    else tooLarge = middle;
  }
  const out = placeAt(fits);
  if (!out) throw new Error(`allot: ${list.length} parts do not fit ${width}x${height}`);
  return out;
}

// ── outlines ───────────────────────────────────────────────────────────────
/** How far (x, y) is from the edge of a polygon [[x, y], ...]: positive inside, negative outside. */
export function polyDist(x, y, poly) {
  let nearest = Infinity;
  let inside = false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    // the point of this edge nearest (x, y): how far along it, 0 to 1
    const t = Math.min(1, Math.max(0, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    nearest = Math.min(nearest, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy));
    // a line from the point to the right crosses this edge: inside after an odd number of them
    if (a[1] > y !== b[1] > y && x < a[0] + ((y - a[1]) / (b[1] - a[1])) * dx) inside = !inside;
  }
  return inside ? nearest : -nearest;
}
