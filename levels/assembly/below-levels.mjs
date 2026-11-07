// levels/assembly: the sewers on several levels, drawn free of the 64-unit cells (`below.levels` in a site; below.mjs
// calls this for them, README.md "Sewers on several levels"). The cell grammar of below.mjs is one floor of
// rectangles; what Master Sword Rebirth's Deralia and Edana sewers do (nothing straight for long, bends at 45 degrees,
// low arched tunnels into halls of other shapes, columns, pipes, water, coloured light) cannot be said in it.
//
// The description (units of the world, y north; a level's `floor` is its walkway's top, a whole z in 16s):
//   levels: [{ id, floor, look?, light?, lights?: { zone: { color, brightness, every } },
//              tunnels: [{ id, points: [[x, y(, z)], ...], width?, height?, profile?: "arch"|"box", water?: { depth, strip },
//                          pipes?: 0|1|2, look?, light? }],
//              halls:   [{ id, shape: "rect"|"octagon"|"poly", center, size | radius | points, rotate?, height?,
//                          ceiling?: "flat"|"cove"|"arch", cove?, columns?: { every, radius }, pool?: { depth, inset },
//                          look?, light? }] }]
//   links:   [{ id, kind: "stair", points: [[x, y, z], ...], width?, height? }          a tunnel that drops between levels
//             { id, kind: "ladder", cell: [cx, cy], size?: [2, 2], from, to, ladder: { wall, at? }, look? }  a shaft]
//   surface: [{ id, hall, cell: [cx, cy], wall }]     a ladder from a street cell down into a hall (the way down)
// A tunnel is a chain of straight segments, mitred at its points; a point on a hall's wall (to 3/4 of a unit) is a
// mouth in that wall (the tunnel starts at the wall's inner face, whatever the angle); an end on nothing is closed.
// Where a tunnel meets another, a hall (a small junction hall) stands between: nothing else is open to anything.
//
//   readLevels(b)               -> failures: the description's sentences
//   planLevels(b, site, cells)  -> { levels, halls, chains, ports, ways, links, failures, warnings }
//   checkLevels(deep, rules)    -> { failures, warnings, measures }
//   assembleLevels(deep, ctx)   -> { brushes, entities, rungs, ways, ... }
import { solid, prism, cylinder, pointEntity, brushEntity, light } from "../../src/maps/source.mjs";

/** The shell's thickness: a floor, a vault, a wall. */
export const SHELL = 16;
/** The ground the street stands on, as below.mjs holds it: a vault's top stays under it. */
const GROUND = -32;
/** A step's rise (the engine climbs 18). */
const RISE = 16;
const GRID = 64;
/** The rules of a level on several levels (a description's own `rules` go over these). */
export const LEVEL_RULES = {
  straight: 768, // the longest straight run of a tunnel, units (design byzantium-02 3.4)
  clear: 72, // the least clear height a player walks under
  narrow: 64, // the least width a player walks through
  stair: 96, // the narrowest stair
  loops: 2, // loops a chase can circle, on each level
  bend45: 0.4, // the share of bends that are 45 degrees (the MSC sewers' look), warned under it
  source: "design byzantium-02, section 3.4 (the sewers) after the person's walk, 2026-11-06; levels/assembly/README.md, 'Sewers on several levels'",
};
const TEX = { floor: "po_sewerfloor", wall: "po_sewerwall", ceil: "crete3_ceil03c", ledge: "po_slsidewlkg", water: "!gwater3", metal: "po_rustmetalblu" };
const ZONES = { default: { color: [255, 200, 140], brightness: 130, every: 192 } };

// ── a little plane geometry ──────────────────────────────────────────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => mul(a, 1 / len(a));
const leftOf = (u) => [-u[1], u[0]];
const r3 = (v) => Math.round(v * 1000) / 1000;
const rp = (p) => [r3(p[0]), r3(p[1])];
const isNum = Number.isFinite;
const isPt = (p) => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(isNum);
const isInt16 = (v) => Number.isInteger(v) && v % 16 === 0;
/** The point where the line p + d s meets q + e r, or null for lines side by side. */
function meet(p, d, q, e) {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-9) return null;
  return add(p, mul(d, cross(sub(q, p), e) / den));
}
/** A convex polygon's lines moved inwards by `o[i]` each (outwards where negative), its corners where they meet. */
function offsetPoly(poly, o) {
  const n = poly.length;
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n];
    const u = unit(sub(q, p));
    return { p: add(p, mul(leftOf(u), o[i])), u };
  });
  return poly.map((_, i) => {
    const a = lines[(i + n - 1) % n];
    const b = lines[i];
    return meet(a.p, a.u, b.p, b.u) ?? add(poly[i], mul(leftOf(b.u), o[i]));
  });
}
const signedArea = (poly) => poly.reduce((s, p, i) => s + cross(p, poly[(i + 1) % poly.length]), 0) / 2;
function inside(poly, p, margin = 0) {
  return poly.every((a, i) => {
    const b = poly[(i + 1) % poly.length];
    return cross(sub(b, a), sub(p, a)) / len(sub(b, a)) >= margin;
  });
}
/** Whether two convex polygons overlap by more than `eps` along every one of their edges' normals. */
function overlaps(A, B, eps = 1) {
  for (const P of [A, B])
    for (let i = 0; i < P.length; i++) {
      const e = sub(P[(i + 1) % P.length], P[i]);
      if (len(e) < 1e-9) continue;
      const nrm = unit(leftOf(e));
      const ra = A.map((p) => dot(p, nrm));
      const rb = B.map((p) => dot(p, nrm));
      if (Math.max(...ra) <= Math.min(...rb) + eps || Math.max(...rb) <= Math.min(...ra) + eps) return false;
    }
  return true;
}
const segDistance = (p, a, b) => {
  const e = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), e) / dot(e, e)));
  return len(sub(p, add(a, mul(e, t))));
};

// ── the frames brushes are swept along ───────────────────────────────────────
// A seg is a line (p0, u, n = its left); a cut is a line across it ({ p, c }). The point at lateral offset d (left
// positive) of the seg on a cut is where the offset line meets the cut: every brush of a tunnel is the profile
// swept between two cuts, so the pieces of two segments meet on the one mitre line and nothing between them is left.
const at = (seg, cut, d) => meet(add(seg.p0, mul(seg.n, d)), seg.u, cut.p, cut.c);

/** The brush that is `poly` ([[d, z], ...], convex) at the cut A, at height `zA`, swept to the cut B, at `zB`. Null when it has no volume. */
function sweep(seg, cutA, cutB, poly, zA, zB, texture) {
  const p = poly.filter((q, i) => i === 0 || Math.hypot(q[0] - poly[i - 1][0], q[1] - poly[i - 1][1]) > 1e-6);
  if (p.length > 1 && Math.hypot(p[0][0] - p.at(-1)[0], p[0][1] - p.at(-1)[1]) < 1e-6) p.pop();
  if (p.length < 3) return null;
  const k = p.length;
  const points = [];
  for (const [cut, z0] of [[cutA, zA], [cutB, zB]])
    for (const [d, z] of p) {
      const q = at(seg, cut, d);
      if (!q) throw new Error("sweep: a cut along its own line");
      points.push([q[0], q[1], z0 + z]);
    }
  // the caps: the three corners of the polygon that span the most
  let best = [0, 1, 2];
  let area = 0;
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) for (let l = j + 1; l < k; l++) {
    const a = Math.abs(cross(sub(p[j], p[i]), sub(p[l], p[i])));
    if (a > area) (area = a, (best = [i, j, l]));
  }
  if (area < 1e-6) return null;
  const faces = [best, best.map((i) => i + k), ...p.map((_, i) => [i, (i + 1) % k, k + i])];
  try {
    return solid(points, texture, { faces });
  } catch (error) {
    throw new Error(`a brush of ${texture} is not convex or has no volume (${error.message.slice(0, 160)})`);
  }
}
/** The profile [[d, z]] of a tunnel's air, counter-clockwise from the floor's left, its floor z = 0. */
function airProfile({ width, height, profile, water }) {
  const a = width / 2;
  const top = (() => {
    if (profile === "box") return [[a, height], [-a, height]];
    const c = Math.min(a * 0.6, height * 0.35);
    return [[a, height - c], [a - c, height], [-(a - c), height], [-a, height - c]];
  })();
  let floor = [[-a, 0], [a, 0]];
  if (water) {
    const s = water.strip >= 1 ? a : a * water.strip;
    floor = water.strip >= 1 ? [[-a, -water.depth], [a, -water.depth]] : [[-a, 0], [-s, 0], [-s, -water.depth], [s, -water.depth], [s, 0], [a, 0]];
  }
  return [...floor, ...top];
}
/** The ring round a profile, thickness t: the quads, each with the role of its inner edge (floor, ceiling, wall). */
function ringOf(inner, t) {
  const n = inner.length;
  const out = inner.map((p, i) => {
    const prev = inner[(i + n - 1) % n];
    const next = inner[(i + 1) % n];
    const e0 = unit(sub(p, prev));
    const e1 = unit(sub(next, p));
    const [n0, n1] = [[e0[1], -e0[0]], [e1[1], -e1[0]]];
    return meet(add(p, mul(n0, t)), e0, add(p, mul(n1, t)), e1) ?? add(p, mul(n0, t));
  });
  return inner.map((p, i) => {
    const j = (i + 1) % n;
    const e = unit(sub(inner[j], p));
    const up = e[0]; // the inner normal's z: (-e.z, e.x)
    return { quad: [p, inner[j], out[j], out[i]], role: up > 0.7 ? "floor" : up < -0.7 ? "ceil" : "wall", i };
  });
}
const outerOf = (inner, t) => ringOf(inner, t).map((q) => q.quad[3]);

// ── reading ──────────────────────────────────────────────────────────────────
export const LINK_KINDS = ["stair", "ladder"];
export const HALL_SHAPES = ["rect", "octagon", "poly"];
export const CEILINGS = ["flat", "cove", "arch"];

/** Reads `below.levels` (and links, surface), in sentences. Never throws. */
export function readLevels(b) {
  const failures = [];
  const fail = (s) => failures.push(`below: ${s}`);
  if (!Array.isArray(b.levels) || !b.levels.length) return ["below: levels wants a list of levels"];
  const ids = new Set();
  const named = (kind, id) => {
    if (!id) fail(`a ${kind} has no id`);
    else if (ids.has(id)) fail(`${id} is named twice`);
    ids.add(id);
  };
  const levelIds = new Set();
  for (const l of b.levels) {
    if (!l.id) fail("a level has no id");
    if (levelIds.has(l.id)) fail(`the level ${l.id} is named twice`);
    levelIds.add(l.id);
    if (!isInt16(l.floor)) fail(`the level ${l.id}: its floor is ${JSON.stringify(l.floor)}; it wants the walkway's top, a whole z in 16s`);
    for (const t of l.tunnels ?? []) {
      named("tunnel", t.id);
      if (!Array.isArray(t.points) || t.points.length < 2 || !t.points.every(isPt)) fail(`${t.id}: it wants points [[x, y], ...], two at least`);
      if (t.profile !== undefined && !["arch", "box"].includes(t.profile)) fail(`${t.id}: its profile is ${JSON.stringify(t.profile)}; it wants arch or box`);
      if (t.water !== undefined && !(t.water?.depth > 0 && t.water.depth <= 128)) fail(`${t.id}: its water wants a depth over 0 and to 128`);
    }
    for (const h of l.halls ?? []) {
      named("hall", h.id);
      if (!HALL_SHAPES.includes(h.shape)) fail(`${h.id}: its shape is ${JSON.stringify(h.shape)}; it wants one of ${HALL_SHAPES.join(", ")}`);
      else if (h.shape === "rect" && !(isPt(h.center) && isPt(h.size))) fail(`${h.id}: a rect hall wants center [x, y] and size [w, h]`);
      else if (h.shape === "octagon" && !(isPt(h.center) && h.radius > 0)) fail(`${h.id}: an octagon hall wants center [x, y] and radius`);
      else if (h.shape === "poly" && !(Array.isArray(h.points) && h.points.length >= 3 && h.points.every(isPt))) fail(`${h.id}: a poly hall wants points, three at least`);
      if (h.ceiling !== undefined && !CEILINGS.includes(h.ceiling)) fail(`${h.id}: its ceiling is ${JSON.stringify(h.ceiling)}; it wants one of ${CEILINGS.join(", ")}`);
    }
  }
  for (const k of b.links ?? []) {
    named("link", k.id);
    if (!LINK_KINDS.includes(k.kind)) fail(`${k.id}: its kind is ${JSON.stringify(k.kind)}; it wants one of ${LINK_KINDS.join(", ")}`);
    if (k.kind === "stair" && (!Array.isArray(k.points) || k.points.length < 2 || !k.points.every((p) => isPt(p) && isNum(p[2])))) fail(`${k.id}: a stair wants points [[x, y, z], ...], each with its z`);
    if (k.kind === "ladder") {
      if (!isPt(k.cell)) fail(`${k.id}: a ladder shaft wants cell [cx, cy]`);
      if (!levelIds.has(k.from) || !levelIds.has(k.to)) fail(`${k.id}: from and to name two of the levels`);
      if (!["north", "south", "east", "west"].includes(k.ladder?.wall)) fail(`${k.id}: its ladder's wall is ${JSON.stringify(k.ladder?.wall)}; it wants north, south, east or west`);
    }
  }
  for (const s of b.surface ?? []) {
    named("way", s.id);
    if (!s.hall || !isPt(s.cell) || !["north", "south", "east", "west"].includes(s.wall)) fail(`${s.id}: a way from the street wants hall, cell [cx, cy] and wall`);
  }
  return failures;
}

// ── planning ─────────────────────────────────────────────────────────────────
const SIDES = { north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0] };
const hallPoly = (h) => {
  let poly;
  if (h.shape === "rect") {
    const [w, d] = h.size;
    poly = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  } else if (h.shape === "octagon") {
    const R = h.radius / Math.cos(Math.PI / 8);
    poly = Array.from({ length: 8 }, (_, i) => [R * Math.cos(Math.PI / 8 + (i * Math.PI) / 4), R * Math.sin(Math.PI / 8 + (i * Math.PI) / 4)]);
  } else poly = h.points.map((p) => [p[0] - (h.center?.[0] ?? 0), p[1] - (h.center?.[1] ?? 0)]);
  const a = ((h.rotate ?? 0) * Math.PI) / 180;
  const c = h.center ?? [0, 0];
  poly = poly.map(([x, y]) => rp([c[0] + x * Math.cos(a) - y * Math.sin(a), c[1] + x * Math.sin(a) + y * Math.cos(a)]));
  return signedArea(poly) < 0 ? poly.reverse() : poly;
};

/**
 * The level planned: every hall's polygon and walls (with the mouths tunnels make in them), every tunnel's segments
 * and mitre cuts, the ways down from the street. Each failure is a sentence; the rules are checkLevels'.
 */
export function planLevels(b, site, cells) {
  const failures = [];
  const warnings = [];
  const fail = (s) => failures.push(`below: ${s}`);
  const levels = b.levels.map((l) => ({ ...l, look: l.look ?? b.look ?? "sewer", zones: { ...ZONES, ...(l.lights ?? {}) } }));
  const levelOf = (id) => levels.find((l) => l.id === id);
  const halls = [];
  const chains = [];
  const ways = [];

  // ─ the halls (a ladder shaft is one: a tall one, its mouths at two heights)
  const addHall = (h, level, extra = {}) => {
    const poly = hallPoly(h);
    const n = poly.length;
    const short = Math.min(...poly.map((p, i) => len(sub(poly[(i + 1) % n], p))));
    const edges = poly.map((p, i) => {
      const q = poly[(i + 1) % n];
      const u = unit(sub(q, p));
      return { a: p, b: q, u, n: leftOf(u), L: len(sub(q, p)), ports: [] };
    });
    const floor = h.floor ?? level.floor;
    const height = h.height ?? 240;
    let ceiling = h.ceiling ?? "flat";
    if (ceiling === "arch" && h.shape !== "rect") ceiling = "cove";
    const maxSide = Math.max(...edges.map((e) => e.L));
    const cove = ceiling === "flat" ? 0 : Math.min(h.cove ?? (ceiling === "arch" ? 80 : 32), (ceiling === "arch" ? short : short) / 3);
    // the edges the cove runs on: all of a cove's, the long sides of an arch
    edges.forEach((e, i) => { e.cove = ceiling === "cove" || (ceiling === "arch" && e.L > short * 1.25 && e.L > maxSide * 0.6) ? cove : 0; e.i = i; });
    halls.push({ id: h.id, level: level.id, look: h.look ?? level.look, light: h.light, shape: h.shape, poly, edges, floor, height, ceiling, cove, columns: h.columns, pool: h.pool, raw: h, ...extra });
  };
  for (const l of levels) for (const h of l.halls ?? []) addHall(h, l);
  const links = [];
  for (const k of b.links ?? []) {
    if (k.kind === "ladder") {
      const from = levelOf(k.from);
      const to = levelOf(k.to);
      if (!from || !to) continue;
      const [cx, cy] = k.cell;
      const size = k.size ?? [2, 2];
      const top = from.floor + (k.clear ?? 144);
      addHall({ id: k.id, shape: "rect", center: [(cx + size[0] / 2) * GRID, (cy + size[1] / 2) * GRID], size: [size[0] * GRID, size[1] * GRID], floor: to.floor, height: top - to.floor, look: k.look ?? to.look }, to, { shaft: { ...k, upper: from.floor, lower: to.floor }, level: "link" });
      links.push({ id: k.id, kind: "ladder", from: k.from, to: k.to, at: [(cx + size[0] / 2) * GRID, (cy + size[1] / 2) * GRID], upper: from.floor, lower: to.floor });
    }
  }
  // ─ the tunnels
  const addChain = (t, level, kind) => {
    const floor = level?.floor ?? 0;
    const pts = t.points.map((p) => ({ x: p[0], y: p[1], z: isNum(p[2]) ? p[2] : floor }));
    const water = t.water ? { depth: t.water.depth, strip: t.water.strip ?? 0.5 } : null;
    const c = { id: t.id, level: level?.id ?? "link", kind, pts, width: t.width ?? 128, height: t.height ?? 144, profile: t.profile ?? "arch", water, pipes: t.pipes ?? 0, look: t.look ?? level?.look ?? b.look ?? "sewer", light: t.light, ends: [null, null], raw: t };
    chains.push(c);
  };
  for (const l of levels) for (const t of l.tunnels ?? []) addChain(t, l, "tunnel");
  for (const k of b.links ?? []) if (k.kind === "stair") addChain({ ...k, height: k.height ?? 160, width: k.width ?? 128, water: undefined }, null, "stair");

  const ports = [];
  for (const c of chains) {
    const a = c.width / 2;
    c.segs = [];
    for (let i = 0; i + 1 < c.pts.length; i++) {
      const [p, q] = [c.pts[i], c.pts[i + 1]];
      const d = [q.x - p.x, q.y - p.y];
      if (len(d) < 8) {
        fail(`${c.id}: its points ${i + 1} and ${i + 2} are ${r3(len(d))} apart`);
        continue;
      }
      const u = unit(d);
      c.segs.push({ p0: [p.x, p.y], p1: [q.x, q.y], u, n: leftOf(u), L: len(d), z0: p.z, z1: q.z, stair: Math.abs(q.z - p.z) > 0.5 });
    }
    if (c.segs.length !== c.pts.length - 1) continue;
    // an end on a hall's wall is a mouth: its cut is the wall's face
    c.ends = [0, 1].map((which) => {
      const pt = which ? c.pts.at(-1) : c.pts[0];
      const seg = which ? c.segs.at(-1) : c.segs[0];
      for (const h of halls) {
        if (pt.z < h.floor - 0.5 || pt.z > h.floor + h.height) continue;
        for (const e of h.edges) {
          const s = dot(sub([pt.x, pt.y], e.a), e.u);
          if (s < -0.75 || s > e.L + 0.75) continue;
          if (Math.abs(dot(sub([pt.x, pt.y], e.a), e.n)) > 0.75) continue;
          return { hall: h, edge: e, pt, seg, which };
        }
      }
      return null;
    });
    c.cuts = c.pts.map((p, i) => {
      if (i === 0 || i === c.pts.length - 1) {
        const end = c.ends[i ? 1 : 0];
        const seg = i ? c.segs.at(-1) : c.segs[0];
        return end ? { p: [p.x, p.y], c: end.edge.u } : { p: [p.x, p.y], c: seg.n };
      }
      const [s0, s1] = [c.segs[i - 1], c.segs[i]];
      const turn = (Math.atan2(cross(s0.u, s1.u), dot(s0.u, s1.u)) * 180) / Math.PI;
      if (Math.abs(turn) > 100) fail(`${c.id}: it bends ${Math.round(Math.abs(turn))} degrees at its point ${i + 1}; a bend is 100 degrees at the most (a hall makes a sharper turn)`);
      const sum = add(s0.n, s1.n);
      return len(sum) < 1e-6 ? { p: [p.x, p.y], c: s0.n } : { p: [p.x, p.y], c: unit(sum) };
    });
    c.turns = c.pts.slice(1, -1).map((_, i) => (Math.atan2(cross(c.segs[i].u, c.segs[i + 1].u), dot(c.segs[i].u, c.segs[i + 1].u)) * 180) / Math.PI);
    // every segment long enough for its mitres
    c.segs.forEach((s, i) => {
      for (const d of [-(a + SHELL), a + SHELL]) {
        const ta = dot(sub(at(s, c.cuts[i], d) ?? s.p0, s.p0), s.u);
        const tb = dot(sub(at(s, c.cuts[i + 1], d) ?? s.p1, s.p0), s.u);
        if (!(tb - ta >= 4)) {
          fail(`${c.id}: its segment ${i + 1} is ${r3(s.L)} long, too short for its bends at ${r3(Math.abs(d))} from its middle`);
          break;
        }
      }
    });
    // the mouths
    for (const end of c.ends) {
      if (!end) continue;
      const { hall, edge, seg, which } = end;
      const cosA = Math.abs(dot(seg.u, edge.n));
      if (cosA < 0.5) fail(`${c.id}: it meets ${hall.id}'s wall at ${Math.round((Math.asin(cosA) * 180) / Math.PI)} degrees; a tunnel meets a wall at 30 degrees or more`);
      const cut = c.cuts[which ? c.pts.length - 1 : 0];
      const ss = [-(a + SHELL), a + SHELL].map((d) => dot(sub(at(seg, cut, d), edge.a), edge.u));
      const s0 = Math.min(...ss);
      const s1 = Math.max(...ss);
      if (s0 < 1 || s1 > edge.L - 1) fail(`${c.id}: its mouth in ${hall.id}'s wall runs ${r3(s0)} to ${r3(s1)} of the wall's ${r3(edge.L)}; it wants the wall's whole width round it`);
      const z = which ? c.pts.at(-1).z : c.pts[0].z;
      const outer = outerOf(airProfile(c), SHELL);
      const port = { chain: c.id, which, edge: edge.i, s0, s1, z, bottom: z - SHELL - (c.water ? c.water.depth : 0), top: z + Math.max(...outer.map((q) => q[1])), lintel: z + Math.max(...outer.filter((q) => Math.abs(q[0]) >= a + SHELL - 0.01).map((q) => q[1])), hall: hall.id, u: seg.u, p: [(which ? c.pts.at(-1) : c.pts[0]).x, (which ? c.pts.at(-1) : c.pts[0]).y] };
      if (z < hall.floor - 0.5) fail(`${c.id}: its mouth in ${hall.id} is at ${z}, under the hall's floor ${hall.floor}`);
      if (port.top > hall.floor + hall.height - (edge.cove || 0) + 0.5) fail(`${c.id}: its mouth in ${hall.id} reaches ${port.top - hall.floor} over the floor; the wall there is ${hall.height - (edge.cove || 0)} high`);
      edge.ports.push(port);
      ports.push(port);
    }
  }
  for (const h of halls) for (const e of h.edges) e.ports.sort((p, q) => p.s0 - q.s0);
  for (const h of halls) for (const e of h.edges) for (let i = 0; i + 1 < e.ports.length; i++) if (e.ports[i].s1 > e.ports[i + 1].s0 - 1) fail(`${h.id}: the mouths of ${e.ports[i].chain} and ${e.ports[i + 1].chain} in one wall touch`);

  // ─ the ways from the street
  for (const s of b.surface ?? []) {
    const h = halls.find((q) => q.id === s.hall);
    if (!h) {
      fail(`${s.id}: there is no hall ${s.hall}`);
      continue;
    }
    const [cx, cy] = s.cell;
    const [dx, dy] = SIDES[s.wall];
    const box = [cx * GRID, cy * GRID, (cx + 1) * GRID, (cy + 1) * GRID];
    const corners = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]];
    if (!corners.every((p) => inside(h.poly, p, -0.01))) fail(`${s.id}: its cell ${cx},${cy} is not inside ${h.id}`);
    // the ladder's wall: the hall's wall on that side, along the cell's whole edge
    const edge = h.edges.find((e) => Math.abs(e.n[0] + dx) < 1e-6 && Math.abs(e.n[1] + dy) < 1e-6 && Math.abs(dot(sub([(box[0] + box[2]) / 2 + dx * 32, (box[1] + box[3]) / 2 + dy * 32], e.a), e.n)) < 0.5 && dot(sub(corners[0], e.a), e.u) > -0.5);
    if (!edge) fail(`${s.id}: ${h.id} has no wall on the ${s.wall} side of the cell ${cx},${cy}; a ladder wants a wall the whole way up`);
    if (h.ceiling !== "flat") fail(`${s.id}: ${h.id} is not flat-ceilinged; a way up through it wants a flat vault`);
    if (h.floor + h.height + SHELL > GROUND) fail(`${s.id}: ${h.id}'s vault at ${h.floor + h.height + SHELL} is over ${GROUND}, the ground the street stands on`);
    const here = cells?.[cy]?.[cx];
    const beyond = cells?.[cy + dy]?.[cx + dx];
    const PUBLIC = ["street", "plaza", "square", "alley", "paving", "portico"];
    if (cells && !PUBLIC.includes(here)) fail(`${s.id} opens onto ${here ?? "the edge of the site"} at ${cx},${cy}; a manhole opens onto public floor`);
    else if (cells && !PUBLIC.includes(beyond)) fail(`${s.id}: its ladder steps off onto ${beyond ?? "the edge of the site"} at ${cx + dx},${cy + dy}; the cell past its wall (${s.wall}) wants public floor`);
    ways.push({ ...s, hallRef: h.id, box, edgeRef: edge ? edge.i : null, floor: h.floor });
  }
  const pending = new Set();
  // a way's cell must not be taken by two ways
  for (const w of ways) {
    const k = `${w.cell}`;
    if (pending.has(k)) fail(`${w.id}: the cell ${k} is taken by another way`);
    pending.add(k);
  }
  const deep = { levels, halls, chains, ports, ways, links, failures, warnings };
  checkFit(deep, fail);
  return deep;
}

/** Each element's plan cells and heights, for what overlaps what. */
export function cellsOf(deep) {
  const out = [];
  for (const c of deep.chains) {
    if (!c.segs || c.segs.length !== c.pts.length - 1) continue;
    const a = c.width / 2;
    const prof = airProfile(c);
    const topZ = Math.max(...prof.map((p) => p[1]));
    const botZ = Math.min(...prof.map((p) => p[1]));
    c.segs.forEach((s, i) => {
      // a slope in pieces of 96, each with its own heights
      const n = s.stair ? Math.ceil(s.L / 96) : 1;
      for (let k = 0; k < n; k++) {
        const cutA = k === 0 ? c.cuts[i] : { p: add(s.p0, mul(s.u, (s.L * k) / n)), c: s.n };
        const cutB = k === n - 1 ? c.cuts[i + 1] : { p: add(s.p0, mul(s.u, (s.L * (k + 1)) / n)), c: s.n };
        const poly = (d) => [at(s, cutA, -d), at(s, cutB, -d), at(s, cutB, d), at(s, cutA, d)];
        const za = s.z0 + ((s.z1 - s.z0) * k) / n;
        const zb = s.z0 + ((s.z1 - s.z0) * (k + 1)) / n;
        out.push({ id: c.id, kind: "chain", seg: i, last: c.segs.length - 1, air: poly(a), shell: poly(a + SHELL), zair: [Math.min(za, zb) + botZ, Math.max(za, zb) + topZ], zshell: [Math.min(za, zb) + botZ - SHELL, Math.max(za, zb) + topZ + SHELL] });
      }
    });
  }
  for (const h of deep.halls) {
    const D = h.pool?.depth ?? 0;
    out.push({ id: h.id, kind: "hall", air: h.poly, shell: offsetPoly(h.poly, h.poly.map(() => -SHELL)), zair: [h.floor - D, h.floor + h.height], zshell: [h.floor - D - SHELL, h.floor + h.height + SHELL] });
  }
  return out;
}
/** What of the level does not fit: a shell through another's air, a vault into the street's ground. */
function checkFit(deep, fail) {
  const cells = cellsOf(deep);
  const joined = (A, B) => {
    const [c, h] = A.kind === "chain" ? [A, B] : [B, A];
    if (c.kind !== "chain" || h.kind !== "hall") return false;
    return deep.ports.some((p) => p.chain === c.id && p.hall === h.id && (p.which ? c.seg === c.last : c.seg === 0));
  };
  const said = new Set();
  for (let i = 0; i < cells.length; i++)
    for (let j = i + 1; j < cells.length; j++) {
      const [A, B] = [cells[i], cells[j]];
      if (A.id === B.id && (A.kind === "hall" || Math.abs(A.seg - B.seg) <= 1)) continue;
      if (joined(A, B)) continue;
      if (A.zshell[1] <= B.zair[0] && B.zshell[1] <= A.zair[0]) continue;
      if (A.zshell[0] >= B.zair[1] && B.zshell[0] >= A.zair[1]) continue;
      const hit = (overlaps(A.shell, B.air) && A.zshell[1] > B.zair[0] && A.zshell[0] < B.zair[1]) || (overlaps(B.shell, A.air) && B.zshell[1] > A.zair[0] && B.zshell[0] < A.zair[1]);
      const key = [A.id, B.id].sort().join("|");
      if (hit && !said.has(key)) {
        said.add(key);
        fail(`${A.id} and ${B.id} run into each other: the walls of one are through the air of the other`);
      }
    }
  for (const h of deep.halls) if (!h.shaft && h.floor + h.height + SHELL > GROUND) fail(`${h.id}: its vault's top at ${h.floor + h.height + SHELL} is over ${GROUND}, the ground the street stands on`);
  for (const c of deep.chains) {
    if (!c.segs || c.segs.length !== c.pts.length - 1) continue;
    const top = Math.max(...c.pts.map((p) => p.z)) + c.height + SHELL;
    if (top > GROUND) fail(`${c.id}: its vault's top at ${top} is over ${GROUND}, the ground the street stands on`);
  }
}

// ── the rules ────────────────────────────────────────────────────────────────
/** The level's rules: a tunnel a player walks under and through, no run too straight, stairs wide, a loop or two a level. */
export function checkLevels(deep, base = LEVEL_RULES) {
  const failures = [];
  const warnings = [];
  const rules = { ...LEVEL_RULES, ...base };
  const cite = ` (${rules.source})`;
  const measures = { levels: [], links: deep.links.length, stairs: 0, ways: deep.ways.length, reached: 0, elements: deep.halls.length + deep.chains.length, longest: 0, bends: 0, bends45: 0, zones: [] };
  const flat = (c) => c.segs && c.segs.length === c.pts.length - 1;
  for (const c of deep.chains) {
    if (!flat(c)) continue;
    const kind = c.kind === "stair" ? "stair" : "tunnel";
    if (c.height < rules.clear) failures.push(`the ${kind} ${c.id} is ${c.height} high; a player walks under ${rules.clear} at the least${cite}`);
    if (c.width < rules.narrow) failures.push(`the ${kind} ${c.id} is ${c.width} wide; a player walks through ${rules.narrow} at the least${cite}`);
    if (c.segs.some((s) => s.stair)) {
      measures.stairs++;
      if (c.width < rules.stair) failures.push(`the stair ${c.id} is ${c.width} wide; a stair is ${rules.stair} wide at the least${cite}`);
      for (const [i, s] of c.segs.entries()) {
        if (!s.stair) continue;
        const rise = Math.abs(s.z1 - s.z0);
        const steps = Math.ceil(rise / RISE);
        if (s.L / steps < 24) failures.push(`the stair ${c.id} drops ${rise} in ${r3(s.L)}; its steps are ${r3(s.L / steps)} deep and want 24 at the least${cite}`);
        if (c.water) failures.push(`the stair ${c.id} has water on it`);
        if (i > 0 && c.segs[i - 1].stair === false && false) failures.push("");
      }
    }
    // straight runs: segments that go on within 20 degrees, added
    let run = 0;
    let worst = 0;
    c.segs.forEach((s, i) => {
      run = i > 0 && Math.abs(c.turns[i - 1]) < 20 ? run + s.L : s.L;
      worst = Math.max(worst, run);
    });
    measures.longest = Math.max(measures.longest, Math.round(worst));
    if (worst > rules.straight + 0.5) failures.push(`the ${kind} ${c.id} runs ${Math.round(worst)} units straight; a tunnel wants ${rules.straight} at the most, then a bend, a hall or an end${cite}`);
    for (const t of c.turns) {
      const a = Math.abs(t);
      if (a >= 20) {
        measures.bends++;
        if (Math.abs(a - 45) <= 12) measures.bends45++;
      }
    }
  }
  // what each level is: loops (cycles of its own tunnels and halls: E - V + pieces), the zones of light
  const byId = new Map([...deep.chains.map((c) => [c.id, c]), ...deep.halls.map((h) => [h.id, h])]);
  for (const l of deep.levels) {
    const nodes = [...byId.values()].filter((e) => e.level === l.id).map((e) => e.id);
    const set = new Set(nodes);
    const edges = deep.ports.filter((p) => set.has(p.chain) && set.has(p.hall));
    const parent = new Map(nodes.map((n) => [n, n]));
    const find = (n) => (parent.get(n) === n ? n : (parent.set(n, find(parent.get(n))), parent.get(n)));
    for (const e of edges) parent.set(find(e.chain), find(e.hall));
    const pieces = new Set(nodes.map(find)).size;
    const loops = edges.length - nodes.length + pieces;
    const own = [...byId.values()].filter((e) => e.level === l.id);
    const zones = [...new Set(own.map((e) => e.light ?? "default"))].map((z) => `${z}:${(l.zones[z] ?? ZONES.default).color.join(",")}`);
    const tunnels = own.filter((e) => e.pts);
    const bends = tunnels.flatMap((c) => c.turns ?? []).filter((t) => Math.abs(t) >= 20);
    const n45 = bends.filter((t) => Math.abs(Math.abs(t) - 45) <= 12).length;
    measures.levels.push({ id: l.id, floor: l.floor, tunnels: tunnels.length, halls: own.length - tunnels.length, loops, bends: bends.length, bends45: n45, zones, length: Math.round(tunnels.reduce((s, c) => s + (c.segs ?? []).reduce((q, x) => q + x.L, 0), 0)) });
    if (loops < rules.loops) warnings.push(`the level ${l.id} has ${loops} ${loops === 1 ? "loop" : "loops"} a chase can circle; it wants ${rules.loops} at least${cite}`);
    if (bends.length >= 5 && n45 / bends.length < rules.bend45) warnings.push(`the level ${l.id} has ${n45} of its ${bends.length} bends at 45 degrees; it wants ${Math.round(rules.bend45 * 100)} in 100 at the least${cite}`);
  }
  measures.zones = [...new Set(measures.levels.flatMap((l) => l.zones))];
  // every element reached from a way down (a street ladder; or, with none, from the first hall)
  const adj = new Map([...byId.keys()].map((k) => [k, []]));
  for (const p of deep.ports) (adj.get(p.chain)?.push(p.hall), adj.get(p.hall)?.push(p.chain));
  const start = deep.ways.length ? deep.ways.map((w) => w.hallRef) : deep.halls.slice(0, 1).map((h) => h.id);
  const seen = new Set(start);
  const todo = [...start];
  while (todo.length) for (const n of adj.get(todo.pop()) ?? []) if (!seen.has(n)) (seen.add(n), todo.push(n));
  measures.reached = seen.size;
  for (const id of byId.keys()) if (!seen.has(id)) failures.push(`${id} of the levels below is reached from no way down${cite}`);
  return { failures, warnings, measures };
}

// ── drawing ──────────────────────────────────────────────────────────────────
/**
 * The brushes of the levels, in the world: `swapOf(look)` the look's texture swaps; `ctx.ladder({ cell, wall, foot, top })`
 * (the library's ladder on a cell's edge) and `ctx.lid(cell, kind)` come from below.mjs, which owns the pieces.
 * `{ brushes, entities (func_detail, lights, ladders), rungs, ways, holes, keepClear, counts, failures }`.
 */
export function assembleLevels(deep, ctx) {
  const { swapOf, swapped } = ctx;
  const brushes = [];
  const entities = [];
  const rungs = [];
  const counts = {};
  const failures = [];
  const count = (k, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
  /** Brushes made for one element: `world` the sealing ones, `detail` the ones that seal nothing. */
  const made = (look) => {
    const world = [];
    const detail = [];
    const put = (list, brush, name) => {
      if (brush) (list.push(brush), count(name));
    };
    return {
      world: (b, name) => put(world, b, name),
      detail: (b, name) => put(detail, b, name),
      flush(id) {
        const got = swapped({ brushes: world, entities: detail.length ? [{ brushes: detail }] : [] }, swapOf(look));
        brushes.push(...got.brushes);
        if (detail.length) entities.push(brushEntity("func_detail", got.entities[0].brushes, { zhlt_detaillevel: 1 }));
        void id;
      },
    };
  };
  const zoneOf = (level, el) => level.zones[el.light ?? el.raw?.light ?? level.light ?? "default"] ?? level.zones.default ?? ZONES.default;
  const levelOf = (id) => deep.levels.find((l) => l.id === id);
  const lamp = (origin, zone) => {
    entities.push(light(origin, { color: zone.color, brightness: zone.brightness }));
    count("light");
  };

  // ─ the tunnels
  for (const c of deep.chains) {
    if (!c.segs || c.segs.length !== c.pts.length - 1) continue;
    const m = made(c.look);
    const level = levelOf(c.level) ?? deep.levels[0];
    const zone = zoneOf(level, c);
    const T = SHELL;
    const a = c.width / 2;
    const inner = airProfile(c);
    const ring = ringOf(inner, T);
    c.segs.forEach((s, i) => {
      const [cutA, cutB] = [c.cuts[i], c.cuts[i + 1]];
      for (const q of ring) {
        const tex = q.role === "floor" ? TEX.floor : q.role === "ceil" ? TEX.ceil : TEX.wall;
        if (q.role === "floor" && s.stair) continue;
        m.world(sweep(s, cutA, cutB, q.quad, s.z0, s.z1, tex), `tunnel-${q.role}`);
      }
      if (s.stair) {
        // the steps: each a block from a flat top, between two cuts across the segment
        const rise = Math.abs(s.z1 - s.z0);
        const N = Math.ceil(rise / RISE);
        for (let k = 1; k <= N; k++) {
          const top = s.z0 + ((s.z1 - s.z0) * k) / N;
          const A = k === 1 ? cutA : { p: add(s.p0, mul(s.u, (s.L * (k - 1)) / N)), c: s.n };
          const B = k === N ? cutB : { p: add(s.p0, mul(s.u, (s.L * k) / N)), c: s.n };
          const lowest = Math.min(s.z0, s.z1) - T;
          const block = [[-(a + T), lowest - top], [a + T, lowest - top], [a + T, 0], [-(a + T), 0]];
          m.world(sweep(s, A, B, block, top, top, TEX.floor), "stair-step");
        }
      }
      // the pipes: along the walls, an 8-gon each, func_detail
      if (c.pipes > 0) {
        const r = 6;
        const h1 = c.height * 0.55;
        for (const side of c.pipes > 1 ? [-1, 1] : [(i + c.pts.length) % 2 ? 1 : -1]) {
          const d0 = side * (a - r - 3);
          const oct = Array.from({ length: 8 }, (_, j) => [d0 + r * Math.cos(Math.PI / 8 + (j * Math.PI) / 4), h1 + r * Math.sin(Math.PI / 8 + (j * Math.PI) / 4)]);
          m.detail(sweep(s, cutA, cutB, oct, s.z0, s.z1, TEX.metal), "pipe");
        }
      }
      // the water of a channel
      if (c.water) {
        const w = c.water;
        const sx = w.strip >= 1 ? a : a * w.strip;
        m.world(sweep(s, cutA, cutB, [[-sx, -w.depth], [sx, -w.depth], [sx, -4], [-sx, -4]], s.z0, s.z1, TEX.water), "water");
      }
      // the lights: down the middle, every `every`
      const every = zone.every ?? 192;
      const n = Math.max(1, Math.floor(s.L / every));
      for (let k = 0; k < n; k++) {
        const t = (s.L * (k + 0.5)) / n;
        const z = s.z0 + ((s.z1 - s.z0) * t) / s.L;
        const p = add(s.p0, mul(s.u, t));
        lamp([r3(p[0]), r3(p[1]), r3(z + c.height - 24)], zone);
        const fix = [[-8, -2], [8, -2], [8, 4], [-8, 4]].map(([d, z2]) => [d, c.height - 12 + z2]);
        const slab = sweep({ p0: s.p0, u: s.u, n: s.n }, { p: add(p, mul(s.u, -8)), c: s.n }, { p: add(p, mul(s.u, 8)), c: s.n }, fix, z, z, TEX.metal);
        m.detail(slab, "lamp");
      }
    });
    // the ends: a wall across an end that opens on nothing; a water channel's plug where it meets a hall
    c.ends.forEach((end, which) => {
      const s = which ? c.segs.at(-1) : c.segs[0];
      const cut = c.cuts[which ? c.pts.length - 1 : 0];
      const z = which ? s.z1 : s.z0;
      const out = which ? s.u : mul(s.u, -1);
      const D = c.water ? c.water.depth : 0;
      if (!end) {
        const outer = outerOf(inner, T);
        const pts = [];
        for (const [d, zz] of outer) {
          const q = at(s, cut, d);
          pts.push([r3(q[0]), r3(q[1]), r3(z + zz)], [r3(q[0] + out[0] * T), r3(q[1] + out[1] * T), r3(z + zz)]);
        }
        m.world(solid(pts, TEX.wall), "tunnel-end");
      } else if (c.water) {
        // the channel stops at the hall's floor: a block of its width under the hall's edge
        const into = mul(out, T);
        const pts = [];
        for (const d of [-(a + T), a + T]) {
          const q = at(s, cut, d);
          for (const zz of [-D - T, 0]) pts.push([r3(q[0]), r3(q[1]), r3(z + zz)], [r3(q[0] + into[0]), r3(q[1] + into[1]), r3(z + zz)]);
        }
        m.world(solid(pts, TEX.floor), "channel-plug");
      }
    });
    m.flush(c.id);
  }

  // ─ the halls
  for (const h of deep.halls) {
    const m = made(h.look);
    const level = levelOf(h.level) ?? deep.levels.find((l) => l.floor === h.floor) ?? deep.levels[0];
    const zone = zoneOf(level, h);
    const T = SHELL;
    const D = h.pool?.depth ?? 0;
    const F = h.floor;
    const n = h.edges.length;
    const bottom = F - D - T;
    const bis = h.poly.map((p, i) => {
      const [e0, e1] = [h.edges[(i + n - 1) % n], h.edges[i]];
      return { p, c: unit(add(e0.n, e1.n)) };
    });
    // the floor: where a mouth is, no thicker than the hall's inner face
    const portEdge = h.edges.map((e) => e.ports.length > 0);
    const slabs = h.edges.map((e, i) => (portEdge[i] ? 0 : -T));
    const plan = (poly) => poly.map(rp);
    if (!h.pool) m.world(prism("z", plan(offsetPoly(h.poly, slabs)), F - T, F, TEX.floor), "hall-floor");
    else {
      // an axis-aligned rect: the walkway round the basin in four boxes, the bed, the water
      const xs = h.poly.map((p) => p[0]);
      const ys = h.poly.map((p) => p[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const k = h.pool.inset ?? 64;
      const bx = (lo, hi, zlo, zhi, tex) => solid([[lo[0], lo[1], zlo], [hi[0], lo[1], zlo], [hi[0], hi[1], zlo], [lo[0], hi[1], zlo], [lo[0], lo[1], zhi], [hi[0], lo[1], zhi], [hi[0], hi[1], zhi], [lo[0], hi[1], zhi]], tex);
      for (const [lo, hi] of [[[x0, y0], [x1, y0 + k]], [[x0, y1 - k], [x1, y1]], [[x0, y0 + k], [x0 + k, y1 - k]], [[x1 - k, y0 + k], [x1, y1 - k]]]) m.world(bx(lo, hi, bottom, F, TEX.ledge), "hall-walk");
      m.world(bx([x0 + k, y0 + k], [x1 - k, y1 - k], bottom, F - D, TEX.floor), "hall-bed");
      m.world(bx([x0 + k, y0 + k], [x1 - k, y1 - k], F - D, F - 4, TEX.water), "water");
    }
    // the walls, a mouth cut in each: below its sill, above its lintel, beside it
    h.edges.forEach((e, i) => {
      const topOf = h.height - e.cove;
      const seg = { p0: e.a, u: e.u, n: e.n };
      const cutAt = (s, which) => (s <= 0.001 ? bis[i] : s >= e.L - 0.001 ? bis[(i + 1) % n] : { p: add(e.a, mul(e.u, s)), c: e.n });
      const rect = (zlo, zhi) => [[-T, zlo], [0, zlo], [0, zhi], [-T, zhi]];
      const piece = (s0, s1, zlo, zhi, tex = TEX.wall) => {
        if (s1 - s0 < 0.5 || zhi - zlo < 0.5) return;
        m.world(sweep(seg, cutAt(s0), cutAt(s1), rect(zlo, zhi), 0, 0, tex), "hall-wall");
      };
      let s = 0;
      for (const p of e.ports) {
        // the walls beside a mouth run 8 into it, under the tunnel's own wall, so no sliver is left where the mouth is cut slantwise
        piece(s, p.s0 + 8, bottom, F + topOf + T);
        piece(p.s0, p.s1, bottom, p.bottom);
        piece(p.s0, p.s1, p.lintel, F + topOf + T);
        s = p.s1;
      }
      piece(s, e.L, bottom, F + topOf + T);
      for (const p of e.ports) piece(p.s1 - 8, p.s1 + 1, bottom, F + topOf + T);
      if (e.cove) {
        const c = e.cove;
        const z1 = F + h.height - c;
        // against an uncoved wall the cove runs to that wall's face (a bisector would leave the corner open above the wall's top)
        const [prev, next] = [h.edges[(i + n - 1) % n], h.edges[(i + 1) % n]];
        const cutA = prev.cove ? cutAt(0) : { p: e.a, c: prev.u };
        const cutB = next.cove ? cutAt(e.L) : { p: e.b, c: next.u };
        m.world(sweep(seg, cutA, cutB, [[-T, z1], [0, z1], [c, F + h.height], [c, F + h.height + T], [-T, F + h.height + T]], 0, 0, TEX.ceil), "hall-cove");
      }
    });
    // the vault over the middle
    const plate = offsetPoly(h.poly, h.edges.map((e) => e.cove));
    const chimneys = deep.ways.filter((w) => w.hallRef === h.id).map((w) => w.box);
    if (chimneys.length) for (const b of holedVault(plate, chimneys, F + h.height, T)) m.world(b, "hall-vault");
    else m.world(prism("z", plan(plate), F + h.height, F + h.height + T, TEX.ceil), "hall-vault");
    // the ledge of a ladder shaft under a mouth above its floor
    if (h.shaft) {
      for (const e of h.edges)
        for (const p of e.ports) {
          if (p.z < F + 8) continue;
          const dep = 48;
          const A = add(e.a, mul(e.u, p.s0 - 8));
          const B = add(e.a, mul(e.u, p.s1 + 8));
          const quad = [A, B, add(B, mul(e.n, dep)), add(A, mul(e.n, dep))].map(rp);
          m.world(prism("z", quad, p.z - T, p.z, TEX.ledge), "ledge");
        }
    }
    // the columns: a grid in the hall's own frame, off the mouths' lines
    if (h.columns) {
      const every = h.columns.every ?? 128;
      const r = h.columns.radius ?? 18;
      const margin = h.columns.margin ?? 96;
      const inner = offsetPoly(h.poly, h.poly.map(() => margin));
      const e0 = h.edges[0];
      const origin = [(Math.min(...h.poly.map((p) => dot(p, e0.u)))), Math.min(...h.poly.map((p) => dot(p, e0.n)))];
      const hi = [Math.max(...h.poly.map((p) => dot(p, e0.u))), Math.max(...h.poly.map((p) => dot(p, e0.n)))];
      const mouths = h.edges.flatMap((e) => e.ports);
      const skip = h.shaft ? [] : mouths;
      const cx = h.poly.reduce((s2, p) => s2 + p[0], 0) / n;
      const cy = h.poly.reduce((s2, p) => s2 + p[1], 0) / n;
      const centre = [dot([cx, cy], e0.u), dot([cx, cy], e0.n)];
      const steps = (c0) => {
        const out = [];
        for (let v = centre[c0]; v >= [origin, origin][0][c0] - every; v -= every) out.push(v);
        for (let v = centre[c0] + every; v <= hi[c0] + every; v += every) out.push(v);
        return out;
      };
      for (const u of steps(0))
        for (const v of steps(1)) {
          const p = add(mul(e0.u, u), mul(e0.n, v));
          if (!inside(inner, p, 0)) continue;
          if (skip.some((q) => segDistance(p, q.p, add(q.p, mul(q.u, 224))) < 60 + r)) continue;
          m.detail(cylinder("z", rp(p), r, F - D, F + h.height - (h.edges[0].cove ? 0 : 0), TEX.wall, { sides: 8, turn: 22.5 }), "column");
        }
    }
    // the lights: a grid of them under the vault
    const every = zone.every ?? 192;
    const inner2 = offsetPoly(h.poly, h.poly.map(() => 40));
    const xs = h.poly.map((p) => p[0]);
    const ys = h.poly.map((p) => p[1]);
    const lamps = [];
    const [lx, ly] = [(Math.max(...xs) - Math.min(...xs)) / every, (Math.max(...ys) - Math.min(...ys)) / every];
    const [nx, ny] = [Math.max(1, Math.round(lx)), Math.max(1, Math.round(ly))];
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        const p = [Math.min(...xs) + ((i + 0.5) * (Math.max(...xs) - Math.min(...xs))) / nx, Math.min(...ys) + ((j + 0.5) * (Math.max(...ys) - Math.min(...ys))) / ny];
        if (inside(inner2, p, 0)) lamps.push(p);
      }
    if (!lamps.length) lamps.push([xs.reduce((a, b) => a + b, 0) / n, ys.reduce((a, b) => a + b, 0) / n]);
    for (const p of lamps) lamp([r3(p[0]), r3(p[1]), F + h.height - 24], zone);
    m.flush(h.id);
  }

  // ─ the ladders of the shafts, and the ways from the street
  const ways = [];
  const holes = [];
  const keepClear = new Set();
  for (const h of deep.halls.filter((q) => q.shaft)) {
    const k = h.shaft;
    const [dx, dy] = SIDES[k.ladder.wall];
    const xs = h.poly.map((p) => p[0]);
    const ys = h.poly.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    // the cell on the wall, `at` along it (the first from the south or the west)
    const along = k.ladder.at ?? 0;
    const cell = dx ? [(dx > 0 ? x1 : x0) / GRID - (dx > 0 ? 1 : 0), y0 / GRID + along] : [x0 / GRID + along, (dy > 0 ? y1 : y0) / GRID - (dy > 0 ? 1 : 0)];
    const got = ctx.ladder({ cell, wall: k.ladder.wall, foot: k.lower, top: k.upper, look: h.look });
    brushes.push(...got.brushes);
    entities.push(...got.entities);
    rungs.push(...got.rungs);
    count("ladder-shaft");
  }
  for (const w of deep.ways) {
    const h = deep.halls.find((q) => q.id === w.hall);
    const [cx, cy] = w.cell;
    const look = h.look;
    const got = ctx.ladder({ cell: [cx, cy], wall: w.wall, foot: h.floor, top: 0, look });
    brushes.push(...got.brushes);
    entities.push(...got.entities);
    rungs.push(...got.rungs);
    // the chimney: four walls from the vault to the street, the hole's own cell
    const m = made(look);
    const [x0, y0, x1, y1] = w.box;
    const z0 = h.floor + h.height;
    const zt = 0;
    const T = SHELL;
    const bx = (lo, hi) => solid([[lo[0], lo[1], z0], [hi[0], lo[1], z0], [hi[0], hi[1], z0], [lo[0], hi[1], z0], [lo[0], lo[1], zt], [hi[0], lo[1], zt], [hi[0], hi[1], zt], [lo[0], hi[1], zt]], TEX.wall);
    for (const b of [bx([x0 - T, y0 - T], [x0, y1 + T]), bx([x1, y0 - T], [x1 + T, y1 + T]), bx([x0, y0 - T], [x1, y0]), bx([x0, y1], [x1, y1 + T])]) m.world(b, "chimney");
    m.flush(w.id);
    if (!ctx.open) entities.push(...ctx.lid(w.cell, "manhole"));
    holes.push([cx, cy]);
    for (let i = -1; i <= 2; i++) for (let j = -1; j <= 1; j++) keepClear.add(`${cx + i},${cy + j}`);
    ways.push({ kind: "manhole", name: w.id, at: [cx, cy], top: [(cx + 0.5) * GRID, (cy + 0.5) * GRID, 0], foot: [(cx + 0.5) * GRID, (cy + 0.5) * GRID, h.floor], building: null, deep: true });
  }
  return { brushes, entities, rungs, ways, holes, keepClear: [...keepClear], counts, failures };
}

/**
 * The vault of a hall with ways up through it, cut round each chimney's cell (`boxes`: [x0, y0, x1, y1]): the polygon
 * `poly` in convex pieces west, east, south and north of each hole.
 */
export function holedVault(poly, boxes, z0, thick = SHELL, texture = TEX.ceil) {
  const clip = (P, nrm, d) => {
    // the part of P with dot(p, nrm) <= d
    const out = [];
    P.forEach((p, i) => {
      const q = P[(i + 1) % P.length];
      const [sp, sq] = [dot(p, nrm) - d, dot(q, nrm) - d];
      if (sp <= 0) out.push(p);
      if (sp * sq < 0) out.push(add(p, mul(sub(q, p), sp / (sp - sq))));
    });
    return out;
  };
  let pieces = [poly];
  for (const [x0, y0, x1, y1] of boxes) {
    const next = [];
    for (const P of pieces) {
      const mid = clip(clip(P, [-1, 0], -x0), [1, 0], x1);
      for (const part of [clip(P, [1, 0], x0), clip(P, [-1, 0], -x1), clip(mid, [0, 1], y0), clip(mid, [0, -1], -y1)]) if (part.length >= 3 && Math.abs(signedArea(part)) > 1) next.push(part);
    }
    pieces = next;
  }
  return pieces.map((P) => prism("z", P.map(rp), z0, z0 + thick, texture));
}
