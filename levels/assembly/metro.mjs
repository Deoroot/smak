// levels/assembly: the metro, a kind of level below the street (README.md, "A metro under the streets"). below-levels.mjs draws the
// halls and tunnels of `below.levels`; a hall with a `trench` is a STATION and a tunnel with a `trench` is the LINE between them:
//
//   station   a rect hall (axis-aligned) whose floor is the platforms', one each side of a trench that runs its whole length: two
//             tracks of rails on sleepers on the trench's bed, a safety strip along each platform's edge, benches against the
//             back walls, a row of square columns along each edge, ceiling beams across, steps up out of the trench at each end,
//             boards across it where a crossing is (the two platforms are one place for a citizen).
//   line      a tunnel whose floor is the trench's bed between two walkways at the platforms' level ("ledge", with a railing), its
//             walls vertical under a pitched roof ("house"), its width the trench's; rails on sleepers, a lamp on a wall every so
//             often. It meets a station's trench at the end wall, at the same width.
//   entrance  a stair from the street (`links[].street`, `width` 160, three cells across, `metro: true`) with an arch over its head
//             (`street.arch`), down to a hall of its own, the concourse (`role: "concourse"`), and from it passages to the platforms.
//
//   halls: [{ id, shape: "rect", center, size, height (192 at the least), ceiling: "cove", look: "metro", light: "station",
//             trench: { width?: 192, depth?: 40, crossings?: [offset along the hall from its middle], steps?: true,
//                       benches?: { every?: 256 } }, columns?: { every?: 192, half?: 24 }, role?: "concourse" }]
//   tunnels: [{ id, points, width: 192, height: 176, profile: "house", trench: { depth: 40, ledge?: 44 }, look: "metro-line", light: "line" }]
//
//   readMetro(b)              -> failures: the description's sentences
//   trenchOf(poly, raw, fail) -> the trench of a hall planned (below-levels.mjs planLevels)
//   checkMetro(deep, rules)   -> { failures, warnings, measures }: the stations, lines and entrances held to METRO
//   columnsOf / benchesOf / trenchBlockers   where things stand, for the drawing and for the NPCs' graph (levels/rp/deep.mjs)
//   stationBrushes, lineBrushes, archBrushes the drawing
import { box } from "../../src/maps/source.mjs";

/** The metro's rules, held by checkMetro. */
export const METRO = {
  depth: [32, 64], // the trench's depth under the platforms: more than a step (18), a drop a player takes, steps to climb out of
  trench: 160, // the trench's least width: two tracks
  platform: 96, // the narrowest platform a player and a citizen walk, each side
  ceiling: 192, // the least height of a station and a concourse: a hall, not a corridor
  length: 384, // the shortest station
  entrance: 128, // the narrowest entrance stair
  cream: 80, // the most the channels of a station's light differ: cream or white, never the pink of the person's screenshot (the magenta hall)
  bright: 150, // the least brightness of a station's or a concourse's light, so a platform reads in its pools of light
  source: "levels/assembly/README.md, 'A metro under the streets'; the person's word, 2026-11-08 (a subway in place of the sewers)",
};
export const GAUGE = 32; // the distance between a track's rails (a rail is 4 wide)
export const TRACK = 26; // a track's middle from the trench's, each side: the rails are at 10 and 42
export const EDGE = 24; // the safety strip along a platform's edge
export const BENCH = { depth: 22, length: 56, height: 18 };
export const LEDGE = 44; // the walkway each side of a line's trench: with its railing a player (32) walks it
const GRID = 64;

/** The textures of the metro, from the wads a client has (specialists.wad, halflife.wad, the H9 wad). */
export const METRO_TEX = {
  strip: "STRIPES2", // the platform's edge: yellow and black
  trench: "po_concretwall", // the trench's walls
  bed: "Pavement001", // the trench's bed
  wood: "sinwoodenfloor2", // sleepers, crossing boards, benches
  rail: "metal_rusty5ccc",
  lamp: "SUBWAY_LIGHTS", // the fixtures under a ceiling and on a wall, the arch's sign
  pillar: "crete36",
  wainscot: "po_concretwall", // the dark band along a concourse's walls and the platforms' back walls, 48 up
};
export const WAINSCOT = 48;
/**
 * The looks the metro wears where the theme gives none (a theme's own `districts[look].swap` goes first): swaps of the sewer's
 * textures, as the theme's looks are. `metro` the station and the concourse, `metro-line` the line, `metro-stair` an entrance's
 * stair, `metro-old` a disused hall.
 */
export const METRO_LOOKS = {
  // grey-brown concrete throughout: the halls' walls the palest surface, the vault dark, the platforms' floor speckled
  metro: { po_sewerwall: "crete28", po_sewerfloor: "crete33", crete3_ceil03c: "bigcrete2", po_slsidewlkg: "grey_creteflr", po_rustmetalblu: "metal_rusty5ccc" },
  "metro-line": { po_sewerwall: "po_concretwall", po_sewerfloor: "Pavement001", crete3_ceil03c: "bigcrete2", po_slsidewlkg: "grey_creteflr2", po_rustmetalblu: "metal_rusty5ccc" },
  "metro-stair": { po_sewerwall: "crete36", po_sewerfloor: "grey_creteflr2", crete3_ceil03c: "bigcrete2", po_slsidewlkg: "grey_creteflr" },
  "metro-old": { po_sewerwall: "crete42a", po_sewerfloor: "crete41", crete3_ceil03c: "bigcrete2", po_slsidewlkg: "Pavement001", po_rustmetalblu: "metal_rusty5ccc" },
};
/** The zones of light a metro level gives, where its description names none: cream fluorescents on platforms, warm dim lamps on the line's walls. */
export const METRO_ZONES = {
  station: { color: [210, 195, 175], brightness: 150, every: 192 }, // cream, over the platforms
  wall: { color: [180, 110, 90], brightness: 170, every: 192 }, // on the platforms' back walls, 150 up
  concourse: { color: [210, 195, 175], brightness: 170, every: 128 },
  line: { color: [180, 110, 90], brightness: 150, every: 192 },
  old: { color: [235, 210, 170], brightness: 130, every: 160 },
};

const isNum = Number.isFinite;
const r3 = (v) => Math.round(v * 1000) / 1000;

// ── reading ──────────────────────────────────────────────────────────────────
/** The sentences a level's metro description is not in. Never throws. */
export function readMetro(b) {
  const failures = [];
  const fail = (s) => failures.push(`below: ${s}`);
  for (const l of b.levels ?? []) {
    for (const h of l.halls ?? []) {
      if (h.trench !== undefined) {
        if (h.shape !== "rect") fail(`${h.id}: a hall with a trench is a rect hall (a station runs straight)`);
        const t = h.trench;
        if (!t || typeof t !== "object") fail(`${h.id}: its trench wants { width, depth }`);
        else {
          if (t.width !== undefined && !(t.width >= 64 && t.width <= 320)) fail(`${h.id}: its trench is ${JSON.stringify(t.width)} wide; it wants 64 to 320`);
          if (t.depth !== undefined && !(t.depth > 0 && t.depth <= 128 && t.depth % 2 === 0)) fail(`${h.id}: its trench is ${JSON.stringify(t.depth)} deep; it wants an even number over 0 to 128`);
          if (t.crossings !== undefined && !(Array.isArray(t.crossings) && t.crossings.every(isNum))) fail(`${h.id}: its crossings want a list of offsets along the hall from its middle`);
        }
      }
      if (h.role !== undefined && h.role !== "concourse") fail(`${h.id}: its role is ${JSON.stringify(h.role)}; it wants concourse`);
    }
    for (const t of l.tunnels ?? [])
      if (t.trench !== undefined) {
        if (!(t.trench?.depth > 0 && t.trench.depth <= 128 && t.trench.depth % 2 === 0)) fail(`${t.id}: its trench wants a depth, an even number over 0 to 128`);
        if (t.trench?.ledge !== undefined && !(t.trench.ledge >= 0 && t.trench.ledge < (t.width ?? 128) / 2 - 24)) fail(`${t.id}: its ledge is ${JSON.stringify(t.trench.ledge)}; it wants 0 up to a little under half its width`);
        if (t.water !== undefined) fail(`${t.id}: a line has a trench or water, not both`);
      }
  }
  return failures;
}

// ── planning ─────────────────────────────────────────────────────────────────
/**
 * The trench of a station: `poly` the hall's polygon (counter-clockwise), `raw` its description. `{ axis (0: the hall runs along
 * x, 1: along y), depth, width, mid (the trench's middle across), v: [low, high] across, a: [from, to] along, across: the hall's
 * across range, sides: [the low platform's v range, the high platform's], crossings: [[from, to]], steps, benches }`, or null with
 * `fail` told why.
 */
export function trenchOf(poly, raw, fail, id) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const area = Math.abs(poly.reduce((s, p, i) => s + (p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1]), 0)) / 2;
  if (poly.length !== 4 || Math.abs(area - (x1 - x0) * (y1 - y0)) > 1) return void fail(`${id}: a station's walls run along x and y (a rect hall turned a quarter turn at the most)`);
  const axis = x1 - x0 >= y1 - y0 ? 0 : 1;
  const [a0, a1, c0, c1] = axis === 0 ? [x0, x1, y0, y1] : [y0, y1, x0, x1];
  const t = raw ?? {};
  const width = t.width ?? 192;
  const depth = t.depth ?? 40;
  const mid = (c0 + c1) / 2 + (t.offset ?? 0);
  const v = [mid - width / 2, mid + width / 2];
  const crossings = (t.crossings ?? []).map((u) => [(a0 + a1) / 2 + u - 48, (a0 + a1) / 2 + u + 48]);
  return { axis, depth, width, mid, v, a: [a0, a1], across: [c0, c1], sides: [[c0, v[0]], [v[1], c1]], crossings, steps: t.steps !== false, benches: t.benches === false ? null : { every: t.benches?.every ?? 256 } };
}

const along = (T, u, w) => (T.axis === 0 ? [u, w] : [w, u]);
/** A brush from ranges along the hall and across it, and z. */
const slab = (T, [u0, u1], [w0, w1], z0, z1, texture) => {
  const [p0, p1] = [along(T, u0, w0), along(T, u1, w1)];
  const lo = [Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1])];
  const hi = [Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1])];
  return box([r3(lo[0]), r3(lo[1]), r3(z0)], [r3(hi[0]), r3(hi[1]), r3(z1)], texture);
};
const polyOf = (T, [u0, u1], [w0, w1]) => [along(T, u0, w0), along(T, u1, w0), along(T, u1, w1), along(T, u0, w1)].map((p) => [r3(p[0]), r3(p[1])]);
/** The ranges [from, to] of [a, b] left when `cuts` are taken out. */
const without = ([a, b], cuts) => {
  let parts = [[a, b]];
  for (const [c0, c1] of cuts) parts = parts.flatMap(([p, q]) => (c1 <= p || c0 >= q ? [[p, q]] : [[p, Math.min(q, c0)], [Math.max(p, c1), q]].filter(([m, n]) => n - m > 0.5)));
  return parts;
};
/** The mouths in a hall's side walls (the platforms' back walls) as ranges along the hall: [low side's, high side's]. */
const mouthsOn = (h) => {
  const T = h.trench;
  const out = [[], []];
  for (const e of h.edges) {
    const normal = T.axis === 0 ? e.n[1] : e.n[0]; // +1: the low side's wall (the hall is on its + side)
    if (Math.abs(normal) < 0.99) continue;
    const [a, u] = T.axis === 0 ? [e.a[0], e.u[0]] : [e.a[1], e.u[1]];
    for (const p of e.ports) {
      const [lo, hi] = [a + u * p.s0, a + u * p.s1];
      out[normal > 0 ? 0 : 1].push([Math.min(lo, hi), Math.max(lo, hi)]);
    }
  }
  return out;
};

/** The columns of a station: square, a row down each platform just behind its edge strip, `every` apart, off the crossings and the mouths in its back walls: [{ p, r, half }] (r: what a hull keeps clear, the square's corner). */
export function columnsOf(h) {
  const T = h.trench;
  if (!T || !h.columns) return [];
  const every = h.columns.every ?? 192;
  const half = h.columns.half ?? 24;
  const mouths = mouthsOn(h);
  const crossing = T.crossings.map(([c0, c1]) => [c0 - 48, c1 + 48]);
  const out = [];
  const n = Math.max(1, Math.floor((T.a[1] - T.a[0] - 128) / every) + 1);
  const start = (T.a[0] + T.a[1]) / 2 - ((n - 1) * every) / 2;
  for (let k = 0; k < n; k++) {
    const u = start + k * every;
    if (crossing.some(([c0, c1]) => u > c0 && u < c1)) continue;
    [T.v[0] - (half + EDGE + 8), T.v[1] + (half + EDGE + 8)].forEach((w, side) => {
      if (mouths[side].some(([m0, m1]) => u > m0 - 40 - half && u < m1 + 40 + half)) return;
      out.push({ p: along(T, u, w), r: Math.ceil(half * 1.42), half });
    });
  }
  return out;
}
/** The benches of a station: against each platform's back wall, `every` apart, off the crossings and the mouths (the columns stand nearer the edge): [{ poly, range, w, side }]. */
export function benchesOf(h) {
  const T = h.trench;
  if (!T?.benches) return [];
  const mouths = mouthsOn(h);
  const crossing = T.crossings.map(([c0, c1]) => [c0 - 24, c1 + 24]);
  const out = [];
  const every = T.benches.every;
  const n = Math.max(1, Math.floor((T.a[1] - T.a[0] - 96) / every));
  const start = (T.a[0] + T.a[1]) / 2 - ((n - 1) * every) / 2;
  for (let k = 0; k < n; k++) {
    const u = start + k * every + (n % 2 ? 0 : 0);
    const range = [u - BENCH.length / 2, u + BENCH.length / 2];
    if (crossing.some(([c0, c1]) => range[1] > c0 && range[0] < c1)) continue;
    [0, 1].forEach((side) => {
      if (mouths[side].some(([m0, m1]) => range[1] > m0 - 24 && range[0] < m1 + 24)) return;
      const w = side === 0 ? [T.across[0], T.across[0] + BENCH.depth] : [T.across[1] - BENCH.depth, T.across[1]];
      out.push({ poly: polyOf(T, range, w), range, w, side });
    });
  }
  return out;
}
/** What of a station's floor a player or a citizen does not stand on: the trench, less its crossings, as polygons; and the benches'. */
export function trenchBlockers(h) {
  const T = h.trench;
  if (!T) return [];
  return [...without(T.a, T.crossings).map((r) => ({ poly: polyOf(T, r, T.v) })), ...benchesOf(h).map((b) => ({ poly: b.poly }))];
}

// ── the rules ────────────────────────────────────────────────────────────────
const spread = (c) => Math.max(...c) - Math.min(...c);
/** A colour that is pink or magenta: its green under both its red and its blue by 30. */
const pink = (c) => c[1] < Math.min(c[0], c[2]) - 30;
/** The stations, lines and entrances of a planned level held to METRO. `{ failures, warnings, measures }`. */
export function checkMetro(deep, base = {}) {
  const rules = { ...METRO, ...(base.metro ?? {}) };
  const cite = ` (${rules.source})`;
  const failures = [];
  const warnings = [];
  const stations = deep.halls.filter((h) => h.trench);
  const concourses = deep.halls.filter((h) => h.role === "concourse");
  const lines = deep.chains.filter((c) => c.trench);
  const measures = { stations: stations.length, concourses: concourses.length, lines: lines.length, entrances: 0, crossings: 0 };
  const level = (id) => deep.levels.find((l) => l.id === id);
  const zoneOf = (e) => {
    const l = level(e.level) ?? deep.levels[0];
    return l?.zones?.[e.light ?? e.raw?.light ?? l.light ?? "default"] ?? l?.zones?.default;
  };
  for (const h of stations) {
    const T = h.trench;
    const length = T.a[1] - T.a[0];
    const platform = Math.min(T.sides[0][1] - T.sides[0][0], T.sides[1][1] - T.sides[1][0]);
    if (h.height < rules.ceiling) failures.push(`the station ${h.id} is ${h.height} high; a station is ${rules.ceiling} at the least, a hall and not a corridor${cite}`);
    if (T.depth < rules.depth[0] || T.depth > rules.depth[1]) failures.push(`the station ${h.id}'s trench is ${T.depth} deep; it wants ${rules.depth[0]} to ${rules.depth[1]} (over a step, a drop a player takes)${cite}`);
    if (T.width < rules.trench) failures.push(`the station ${h.id}'s trench is ${T.width} wide; two tracks want ${rules.trench} at the least${cite}`);
    if (platform < rules.platform) failures.push(`the station ${h.id}'s platform is ${Math.round(platform)} wide on one side; a platform is ${rules.platform} at the least, on both sides of the trench${cite}`);
    if (length < rules.length) failures.push(`the station ${h.id} is ${Math.round(length)} long; a station is ${rules.length} at the least${cite}`);
    if (!T.crossings.length) failures.push(`the station ${h.id} has no crossing over its trench; its two platforms would be two places a citizen cannot go between${cite}`);
    measures.crossings += T.crossings.length;
    // the trench's two ends: a wall, or a line of the same width at the same depth
    for (const e of h.edges) {
      const normal = T.axis === 0 ? e.n[0] : e.n[1];
      if (Math.abs(normal) < 0.99) continue;
      for (const p of e.ports) {
        const c = deep.chains.find((q) => q.id === p.chain);
        const mid = T.axis === 0 ? p.p[1] : p.p[0];
        if (Math.abs(mid - T.mid) > T.width / 2 - 1) continue; // a passage onto a platform, not a line
        if (!c.trench) failures.push(`the station ${h.id}: ${c.id} meets its trench at the end wall but has no trench: the rails would stop at its mouth${cite}`);
        else if (c.width !== T.width || c.trench.depth !== T.depth) failures.push(`the line ${c.id} is ${c.width} wide and ${c.trench.depth} deep where it meets the station ${h.id}, whose trench is ${T.width} wide and ${T.depth} deep; they are one trench${cite}`);
      }
    }
    const z = zoneOf(h);
    if (z) {
      if (pink(z.color) || spread(z.color) > rules.cream) warnings.push(`the station ${h.id}'s light is ${z.color.join(",")}; a station is lit cream or white (the channels within ${rules.cream}, never pink)${cite}`);
      if (z.brightness < rules.bright) warnings.push(`the station ${h.id}'s light is ${z.brightness} bright; a platform reads at ${rules.bright} at the least${cite}`);
    }
  }
  for (const c of lines) {
    for (const end of c.ends) {
      if (!end) continue;
      if (!end.hall.trench) failures.push(`the line ${c.id} meets ${end.hall.id}, a hall with no trench: a line runs from station to station${cite}`);
    }
    const z = zoneOf(c);
    if (z && (pink(z.color) || z.color[0] < z.color[2])) warnings.push(`the line ${c.id}'s lamps are ${z.color.join(",")}; a line is lit warm (more red than blue, never pink)${cite}`);
  }
  for (const h of concourses) {
    const z = zoneOf(h);
    if (h.height < rules.ceiling) failures.push(`the concourse ${h.id} is ${h.height} high; a concourse is ${rules.ceiling} at the least${cite}`);
    if (z && (pink(z.color) || spread(z.color) > rules.cream)) warnings.push(`the concourse ${h.id}'s light is ${z.color.join(",")}; it is cream or white (the channels within ${rules.cream}, never pink)${cite}`);
    if (z && z.brightness < rules.bright) warnings.push(`the concourse ${h.id}'s light is ${z.brightness} bright; ${rules.bright} at the least${cite}`);
  }
  // the entrances: a street stair into a concourse (not onto a platform), wide, and the concourse leads to a station
  const reaches = (from, to, seen = new Set()) => {
    if (from === to) return true;
    seen.add(from);
    for (const p of deep.ports) {
      const [a, b] = [p.chain, p.hall];
      if (a === from && !seen.has(b) && reaches(b, to, seen)) return true;
      if (b === from && !seen.has(a) && reaches(a, to, seen)) return true;
    }
    return false;
  };
  for (const s of deep.stairs ?? []) {
    if (!s.raw?.metro) continue;
    measures.entrances++;
    if (s.width < rules.entrance) failures.push(`the entrance ${s.id} is ${s.width} wide; a metro entrance is ${rules.entrance} at the least${cite}`);
    for (const e of s.ends) {
      if (!e) continue;
      if (e.hall.trench) failures.push(`the entrance ${s.id} opens straight onto the platforms of ${e.hall.id}; a concourse stands between a stair and the platforms${cite}`);
      else if (e.hall.role !== "concourse") failures.push(`the entrance ${s.id} opens into ${e.hall.id}, which is no concourse (role: "concourse")${cite}`);
      else if (!stations.some((st) => reaches(e.hall.id, st.id))) failures.push(`the concourse ${e.hall.id} of the entrance ${s.id} leads to no station${cite}`);
    }
  }
  return { failures, warnings, measures };
}

// ── drawing ──────────────────────────────────────────────────────────────────
/**
 * The floor of a station and what stands on it. `m` is the element's `{ world, detail }`, `F` the platforms' z, `bottom` the
 * underside of the deepest slab, `insets` how far under each end wall and side wall the floor runs ([low end, high end, low
 * side, high side]; 0 where a mouth is), `top` the ceiling's z.
 */
export function stationBrushes(h, m, { F, bottom, insets, top }) {
  const T = h.trench;
  const D = T.depth;
  const [i0, i1, s0, s1] = insets;
  const U = [T.a[0] - i0, T.a[1] + i1];
  const bed = F - D;
  const concrete = { top: METRO_TEX.bed, sides: METRO_TEX.trench, bottom: METRO_TEX.trench };
  m.world(slab(T, U, T.v, bottom, bed, concrete), "trench-bed");
  [0, 1].forEach((side) => {
    const [lo, hi] = T.sides[side];
    const reach = side === 0 ? [lo - s0, hi] : [lo, hi + s1];
    const edge = side === 0 ? [hi - EDGE, hi] : [lo, lo + EDGE];
    const main = side === 0 ? [reach[0], edge[0]] : [edge[1], reach[1]];
    m.world(slab(T, U, main, bottom, F, { top: "po_sewerfloor", sides: "po_sewerwall", bottom: "po_sewerwall" }), "platform");
    // the edge: the concrete of the trench's wall, its top a strip of yellow and black; the plain floor where a crossing is
    for (const r of without(U, T.crossings)) {
      m.world(slab(T, r, edge, bottom, F - 8, METRO_TEX.trench), "platform-edge");
      m.world(slab(T, r, edge, F - 8, F, { top: METRO_TEX.strip, sides: METRO_TEX.trench, bottom: METRO_TEX.trench }), "platform-strip");
    }
    for (const [c0, c1] of T.crossings) m.world(slab(T, [c0, c1], edge, bottom, F, { top: "po_sewerfloor", sides: METRO_TEX.trench, bottom: METRO_TEX.trench }), "platform-crossing");
  });
  // the crossings: boards across the trench, at the platforms' level, the rails under them
  for (const [c0, c1] of T.crossings) m.world(slab(T, [c0, c1], T.v, F - 12, F, { top: METRO_TEX.wood, sides: METRO_TEX.trench, bottom: METRO_TEX.trench }), "crossing");
  // the rails: two tracks, each two rails 4 wide, from end to end, over sleepers
  for (const side of [-1, 1])
    for (const rail of [-1, 1]) {
      const w = T.mid + side * TRACK + (rail * GAUGE) / 2;
      m.detail(slab(T, T.a, [w - 2, w + 2], bed, bed + 6, METRO_TEX.rail), "rail");
    }
  for (let u = T.a[0] + 24; u < T.a[1] - 8; u += 48) {
    if (T.crossings.some(([c0, c1]) => u + 3 > c0 && u - 3 < c1)) continue;
    m.detail(slab(T, [u - 3, u + 3], [T.mid - TRACK - 22, T.mid + TRACK + 22], bed, bed + 3, METRO_TEX.wood), "sleeper");
  }
  // the steps up out of the trench at each end, against each platform's wall: three treads
  if (T.steps)
    for (const end of [0, 1])
      for (const side of [0, 1]) {
        const at = end === 0 ? [T.a[0] + 24, T.a[0] + 72] : [T.a[1] - 72, T.a[1] - 24];
        const wall = side === 0 ? T.v[0] : T.v[1];
        for (let k = 1; k <= 3; k++) {
          const across = side === 0 ? [wall, wall + 16 * (4 - k)] : [wall - 16 * (4 - k), wall];
          m.world(slab(T, at, across, bed, bed + Math.round((D * k) / 3), { top: "po_sewerfloor", sides: METRO_TEX.trench, bottom: METRO_TEX.trench }), "trench-step");
        }
      }
  // the benches against the back walls; the columns (square, concrete) from the floor to the ceiling
  for (const b of benchesOf(h)) m.detail(slab(T, b.range, b.w, F, F + BENCH.height, { top: METRO_TEX.wood, sides: METRO_TEX.rail, bottom: METRO_TEX.rail }), "bench");
  for (const c of columnsOf(h)) m.detail(slab(T, [(T.axis === 0 ? c.p[0] : c.p[1]) - c.half, (T.axis === 0 ? c.p[0] : c.p[1]) + c.half], [(T.axis === 0 ? c.p[1] : c.p[0]) - c.half, (T.axis === 0 ? c.p[1] : c.p[0]) + c.half], F, top, METRO_TEX.pillar), "column");
  // the ceiling's beams across the hall, stepped: a beam every 128 along, 20 wide, 16 deep
  for (let u = T.a[0] + 64; u < T.a[1] - 32; u += 128) m.detail(slab(T, [u - 10, u + 10], T.across, top - 16, top, METRO_TEX.pillar), "beam");
}

/** The rails, sleepers and railings along a segment of a line, and its wall lamps; `kit` has below-levels.mjs's `sweep`, `add`, `mul`. Returns the lamps: [{ at: [x, y], z, side }]. */
export function lineBrushes(c, s, { m, cutA, cutB, kit }) {
  const { sweep, add, mul } = kit;
  const D = c.trench.depth;
  const w = c.width;
  const ledge = c.trench.ledge ?? LEDGE;
  const inner = w / 2 - ledge; // the trench's half width between the walkways
  for (const side of [-1, 1])
    for (const rail of [-1, 1]) {
      const d = side * TRACK + (rail * GAUGE) / 2;
      m.detail(sweep(s, cutA, cutB, [[d - 2, -D], [d + 2, -D], [d + 2, 6 - D], [d - 2, 6 - D]], s.z0, s.z1, METRO_TEX.rail), "rail");
    }
  for (let t = 24; t < s.L - 8; t += 48) {
    const p = add(s.p0, mul(s.u, t));
    const z = s.z0 + ((s.z1 - s.z0) * t) / s.L;
    m.detail(sweep({ p0: s.p0, u: s.u, n: s.n }, { p: add(p, mul(s.u, -3)), c: s.n }, { p: add(p, mul(s.u, 3)), c: s.n }, [[-(TRACK + 22), -D], [TRACK + 22, -D], [TRACK + 22, 3 - D], [-(TRACK + 22), 3 - D]], z, z, METRO_TEX.wood), "sleeper");
  }
  // the railing along each walkway's inner edge: a top rail and a post every 96
  if (ledge > 0)
    for (const side of [-1, 1]) {
      const d = side * (inner + 2);
      m.detail(sweep(s, cutA, cutB, [[d - 1.5, 36], [d + 1.5, 36], [d + 1.5, 40], [d - 1.5, 40]], s.z0, s.z1, METRO_TEX.rail), "railing");
      for (let t = 12; t < s.L - 8; t += 96) {
        const p = add(s.p0, mul(s.u, t));
        const z = s.z0 + ((s.z1 - s.z0) * t) / s.L;
        m.detail(sweep({ p0: s.p0, u: s.u, n: s.n }, { p: add(p, mul(s.u, -2)), c: s.n }, { p: add(p, mul(s.u, 2)), c: s.n }, [[d - 2, 0], [d + 2, 0], [d + 2, 40], [d - 2, 40]], z, z, METRO_TEX.rail), "railing-post");
      }
    }
}

/**
 * The lamps of a station: cream fluorescents over the middle of each platform and warm lamps on the back walls, 150 up, every `every`:
 * [{ p: [x, y], z, wall }] (`wall`: the way a wall lamp faces, [nx, ny]). Off the mouths in the back walls.
 */
export function stationLamps(h, F, every = 192) {
  const T = h.trench;
  const mouths = mouthsOn(h);
  const out = [];
  const n = Math.max(1, Math.round((T.a[1] - T.a[0]) / every));
  for (let k = 0; k < n; k++) {
    const u = T.a[0] + ((k + 0.5) * (T.a[1] - T.a[0])) / n;
    [0, 1].forEach((side) => {
      const mid = (T.sides[side][0] + T.sides[side][1]) / 2;
      out.push({ p: along(T, u, mid), z: F + h.height - 24 });
      if (mouths[side].some(([m0, m1]) => u > m0 - 32 && u < m1 + 32)) return;
      const w = side === 0 ? T.across[0] + 10 : T.across[1] - 10;
      const into = side === 0 ? 1 : -1;
      out.push({ p: along(T, u, w), z: F + 150, wall: T.axis === 0 ? [0, into] : [into, 0] });
    });
  }
  return out;
}
/**
 * The dark band along the walls of a concourse and the platforms' back walls, 48 up and 4 thick, in pieces off the mouths: `m.detail`
 * boxes. `kit` has below-levels.mjs's `sweep`, `add`, `mul`. A station's end walls are left bare (the trench is there).
 */
export function wainscotBrushes(h, m, F, kit) {
  const { sweep, add, mul } = kit;
  h.edges.forEach((e) => {
    if (h.trench) {
      const normal = h.trench.axis === 0 ? e.n[1] : e.n[0];
      if (Math.abs(normal) < 0.99) return;
    }
    let s = 0;
    const cut = (t) => ({ p: add(e.a, mul(e.u, t)), c: e.n });
    const piece = (t0, t1) => {
      if (t1 - t0 < 8) return;
      m.detail(sweep({ p0: e.a, u: e.u, n: e.n }, cut(t0), cut(t1), [[0, F], [4, F], [4, F + WAINSCOT], [0, F + WAINSCOT]], 0, 0, METRO_TEX.wainscot), "wainscot");
    };
    for (const p of e.ports) {
      piece(s, p.s0);
      s = p.s1;
    }
    piece(s, e.L);
  });
}

/**
 * The arch over the head of an entrance stair: two pillars on the parapet's walls, a lintel across and a lit sign on it.
 * `frame` is the stair's first segment (p0, u, n), `a` half its width, `T` the walls' thickness, `top` the parapet's top.
 */
export function archBrushes(frame, a, T, top, { sweep, add, mul }, m) {
  const cut = (s) => ({ p: add(frame.p0, mul(frame.u, s)), c: frame.n });
  const [A, B] = [cut(0), cut(24)];
  const high = top + 72;
  for (const [d0, d1] of [[-(a + T), -a], [a, a + T]]) m.world(sweep(frame, A, B, [[d0, top], [d1, top], [d1, high], [d0, high]], 0, 0, METRO_TEX.pillar), "arch-pillar");
  m.world(sweep(frame, A, B, [[-(a + T), high], [a + T, high], [a + T, high + 16], [-(a + T), high + 16]], 0, 0, METRO_TEX.pillar), "arch-lintel");
  m.world(sweep(frame, cut(-3), A, [[-(a - 12), high + 2], [a - 12, high + 2], [a - 12, high + 14], [-(a - 12), high + 14]], 0, 0, METRO_TEX.lamp), "arch-sign");
}
export { GRID };
