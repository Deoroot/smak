// levels/assembly, the Kowloon facade: a building's outside made unlike from bay to bay, as the Walled City's towers
// are (windows in frames of different sizes, caged balconies and add-on rooms bolted on, air-conditioner boxes, pipes,
// signs, patches of other wall, and on the roof shacks, tanks and masts at different heights). All of it WORLD brushes:
// no entity is added. Switched on a building by `"kowloon": true` (or `{ "seed": n, "density": 0..1 }`) in the site
// spec, or for a district by `kowloon.districts` in the dress file; the palette (texture names only) is the dress
// file's `kowloon` block. Every choice comes from a hash of (seed, building, side, bay, storey), so a build is the same
// every time and a change to one building moves nothing in another.
//
// The rules (checked by kowloonProblems, whose sentences fail the build):
//   - nothing stands out of a wall more than SKIN (2) lower than CLEARANCE (100, about 2.5 m) over the ground;
//   - nothing stands out further than the open width beside it allows (24 into a street of 2 cells, 48 into wider);
//   - nothing is in a window's opening, or in front of a doorway's, whatever its height.
//
//   kowloonFacade(building, layout, { seed, palette, clearOf }) -> { brushes, items, openings, report }
import { box, prism, fitted } from "../../src/maps/source.mjs";
import { cellsAcross } from "./layout.mjs";

const GRID = 64;
const STOREY = 192;
export const KOWLOON_RULES = {
  skin: 2, // what may stand out of a wall below the clearance: a plate
  clearance: 100, // 2.5 m in units, the lowest anything bigger hangs over the ground
  glowTop: 140, // the ground storey's lights and glow sprites sit under this: no add-on below it
  jut: [
    [256, 48],
    [128, 24],
    [0, 0],
  ], // [open width at least, furthest out]
};
const HALF_WALL = 8;

/** A 32-bit hash of its parts. */
const hash = (...parts) => {
  let h = 2166136261;
  for (const p of parts) {
    for (const ch of String(p)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    h = Math.imul(h ^ 0x9e37, 16777619);
  }
  return h >>> 0;
};
const rng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const jutFor = (open) => KOWLOON_RULES.jut.find(([w]) => open >= w)[1];

/** Is this building to be dressed so: its own `kowloon` (false turns a district's off), or its district's. */
export function kowloonOf(b, district, K) {
  if (!K) return null;
  if (b.kowloon === false) return null;
  const on = b.kowloon || (K.districts ?? []).includes(district);
  if (!on) return null;
  const o = typeof b.kowloon === "object" ? b.kowloon : {};
  return { seed: o.seed ?? K.seed ?? 1, density: o.density ?? K.density ?? 1 };
}

/**
 * The facade of one building. `clearOf(cell, d)`: the open width, in units, outward from a site cell in direction d
 * (how many public cells in a row), which limits how far anything stands out.
 */
export function kowloonFacade(b, layout, { seed = 1, density = 1, palette, clearOf }) {
  if (!palette) throw new Error("kowloonFacade: the dress file has no `kowloon` palette");
  const P = palette;
  const brushes = [];
  const items = [];
  const openings = [];
  const counts = {};
  const R = KOWLOON_RULES;
  const at = b.at;
  const base = b.base?.[2] ?? 0;
  const pick = (r, list) => list[Math.floor(r() * list.length)];

  const add = (kind, lo, hi, texture, meta) => {
    if (!(hi[0] > lo[0] && hi[1] > lo[1] && hi[2] > lo[2])) return;
    for (let i = 0; i < 3; i++) if (!(hi[i] > lo[i])) return;
    brushes.push(box(lo, hi, texture));
    items.push({ kind, lo, hi, ...meta });
    counts[kind] = (counts[kind] ?? 0) + 1;
  };

  add.raw = (brush, kind, lo, hi) => {
    brushes.push(brush);
    items.push({ kind, lo, hi, side: "roof", jut: 0 });
    counts[kind] = (counts[kind] ?? 0) + 1;
  };
  // ── the bays of each storey's outside ──
  for (let s = 0; s < layout.storeys; s++) {
    const zf = base + s * STOREY;
    for (const [i, e] of layout.storeyPlans[s].edges.filter((q) => (q.rooms ?? []).includes(null)).entries()) {
      const [c0, c1] = cellsAcross(e);
      const inside = (c) => c[0] >= 0 && c[1] >= 0 && c[0] < b.size[0] && c[1] < b.size[1];
      const [out, inn] = inside(c1) ? [c0, c1] : [c1, c0];
      const d = [out[0] - inn[0], out[1] - inn[1]];
      const horizontal = e.from[1] === e.to[1];
      const u = horizontal ? [1, 0] : [0, 1];
      const mid = [((e.from[0] + e.to[0]) / 2 + at[0]) * GRID, ((e.from[1] + e.to[1]) / 2 + at[1]) * GRID];
      const open = clearOf([out[0] + at[0], out[1] + at[1]], d);
      const J = jutFor(open);
      const side = d[0] === 1 ? "east" : d[0] === -1 ? "west" : d[1] === 1 ? "north" : "south";
      const alongIdx = horizontal ? e.from[0] : e.from[1];
      const r = rng(hash(seed, b.id, side, alongIdx, s));
      // a box in the bay's own frame: t along the edge from its middle, n out from its line, z over the storey's floor
      const place = (kind, [t0, t1], [n0, n1], [z0, z1], texture, extra = {}) => {
        const a = [mid[0] + u[0] * t0 + d[0] * n0, mid[1] + u[1] * t0 + d[1] * n0];
        const c = [mid[0] + u[0] * t1 + d[0] * n1, mid[1] + u[1] * t1 + d[1] * n1];
        const lo = [Math.min(a[0], c[0]), Math.min(a[1], c[1]), zf + z0];
        const hi = [Math.max(a[0], c[0]), Math.max(a[1], c[1]), zf + z1];
        const jut = Math.max(0, n1 - HALF_WALL);
        const tex = typeof texture === "function" ? texture(lo, hi, side) : texture;
        add(kind, lo, hi, tex, { side, jut, open, J, building: b.id, ...extra });
      };
      const kind = e.kind;
      const lowest = s === 0 ? R.glowTop : 0;
      const o = (n) => (n === 0 ? HALF_WALL - 2 : HALF_WALL + n); // 0: a box's inner face, 2 inside the wall; n: its outer face n out of the wall's face

      if (kind === "window") {
        openings.push({ kind: "window", lo: lo3(mid, u, d, -24, 24, HALF_WALL - 4, HALF_WALL + 80, zf + 40, zf + 120), side });
        const ch = r();
        if (ch < 0.28) {
          const w = 5 + Math.floor(r() * 3);
          const tex = pick(r, P.frames);
          place("frame", [-24 - w, -24], [o(0), o(R.skin)], [30, 128], tex);
          place("frame", [24, 24 + w], [o(0), o(R.skin)], [30, 128], tex);
          place("frame", [-24 - w, 24 + w], [o(0), o(R.skin)], [120, 120 + w + 2], tex);
          place("frame", [-24 - w, 24 + w], [o(0), o(R.skin)], [38 - w - 2, 38], tex);
        } else if (ch < 0.5) place("lintel", [-30, 30], [o(0), o(Math.min(J, 8))], [120, 128], pick(r, P.trim));
        else if (ch < 0.72 && J >= 14) place("awning", [-31, 31], [o(0), o(Math.min(J, 14 + Math.floor(r() * 8)))], [126, 131], pick(r, P.metal));
        else if (ch < 0.86 && s === 1) place("planter", [-26, 26], [o(0), o(Math.min(J, 12))], [34, 40], pick(r, P.metal));
        else if (ch < 0.95 && lowest <= 134) place("ac", [-14, 14], [o(0), o(Math.min(J, 16))], [138, 160], acTexture(P, r), {});
      } else if (kind === "entrance" || kind === "door") {
        if (s === 0) {
          openings.push({ kind: "door", lo: lo3(mid, u, d, -32, 32, HALF_WALL - 4, HALF_WALL + 72, zf, zf + 112), side });
          place("board", [-30, 30], [o(0), o(Math.min(J, 5))], [128, 150], (lo, hi) => fittedFace(pick(r, P.signs), lo, hi, d));
        }
      } else {
        // a blank bay: one of the features, by weight
      for (let pass = 0; pass < 2; pass++) {
        const w = (pass ? 0.46 + r() * 0.53 : r()) * (pass ? 1 : density);
        if (pass && r() > 0.7 * density) break;
        const column = { t: -20 + Math.floor(r() * 5) * 10 };
        const zr = (a, b2) => Math.max(lowest, a) + Math.floor(r() * Math.max(1, b2 - Math.max(lowest, a)));
        if (w < 0.18 && J >= 14) {
          const cw = 26 + Math.floor(r() * 10);
          const z0 = s === 0 ? zr(142, 170) : zr(50, 130);
          place("ac", [column.t - cw / 2, column.t + cw / 2], [o(0), o(Math.min(J, 14 + Math.floor(r() * 5)))], [z0, z0 + 18 + Math.floor(r() * 8)], acTexture(P, r));
        } else if (w < 0.34 && s === 1 && J >= 20) {
          cage(place, r, P, J);
        } else if (w < 0.46 && s === 1 && J >= 20) {
          addRoom(place, r, P, J);
        } else if (w < 0.6) {
          const w0 = 24 + Math.floor(r() * 34);
          const t0 = -30 + Math.floor(r() * (60 - w0));
          const h = 30 + Math.floor(r() * 70);
          const z0 = Math.floor(r() * (170 - h)) + 8;
          const j = z0 >= R.clearance ? 3 : R.skin;
          place("patch", [t0, t0 + w0], [o(0), o(j)], [z0, z0 + h], pick(r, P.patches));
        } else if (w < 0.74) {
          // a window drawn on the wall: its frame and its pane, of a size of its own
          const fw = 22 + Math.floor(r() * 18);
          const fh = 30 + Math.floor(r() * 36);
          const t0 = -28 + Math.floor(r() * (56 - fw));
          const z0 = 24 + Math.floor(r() * (140 - fh));
          const ground = zf + z0 < R.clearance;
          const j = ground ? R.skin : 4;
          if (!ground) place("fakeframe", [t0 - 3, t0 + fw + 3], [o(0), o(j - 2)], [z0 - 3, z0 + fh + 3], pick(r, P.frames));
          place("fakewindow", [t0, t0 + fw], [o(0), o(j)], [z0, z0 + fh], (lo, hi) => fittedFace(pick(r, P.windows), lo, hi, d));
        } else if (w < 0.84 && J >= 18) {
          const sh = 56 + Math.floor(r() * 20);
          const z0 = s === 0 ? 140 + Math.floor(r() * 10) : 40 + Math.floor(r() * 90);
          const t0 = pick(r, [-26, 22]);
          place("sign", [t0, t0 + 4], [o(0), o(Math.min(J, 18 + Math.floor(r() * 6)))], [z0, z0 + sh], (lo, hi) => fittedSign(pick(r, P.signs), lo, hi, u));
        } else if (w < 0.92 && s === 0) {
          const t0 = -28 + Math.floor(r() * 12);
          place("board", [t0, t0 + 40 + Math.floor(r() * 16)], [o(0), o(4)], [142 + Math.floor(r() * 12), 170], (lo, hi) => fittedFace(pick(r, P.signs), lo, hi, d));
        } else if (w < 0.99 && J >= 12) {
          // a pipe up the bay, from a junction box over the clearance
          const t0 = pick(r, [-24, 16]);
          place("pipe", [t0, t0 + 6], [o(0), o(6)], [118 - (s === 1 ? STOREY : 0), STOREY - 14], pick(r, P.pipes));
          if (s === 0) place("pipebox", [t0 - 3, t0 + 9], [o(0), o(9)], [118, 126], pick(r, P.metal));
        }
      }
      }
    }
  }

  roof(b, layout, { r: rng(hash(seed, b.id, "roof")), P, add, base, density, hashSeed: seed });

  const jutMax = items.reduce((m, i) => Math.max(m, i.jut), 0);
  const lowestJut = items.filter((i) => i.jut > R.skin).reduce((m, i) => Math.min(m, i.lo[2] - base), Infinity);
  return { brushes, items, openings, report: { counts, brushes: brushes.length, jutMax, lowestJut: Number.isFinite(lowestJut) ? lowestJut : null } };
}

const acTexture = (P, r) => {
  const metal = P.metal[Math.floor(r() * P.metal.length)];
  return (lo, hi, side) => ({ sides: metal, top: metal, bottom: metal, [side]: P.vents[Math.floor(r() * P.vents.length)] });
};
/** The texture of a plate whose big face (the one looking `d`) wears a picture whole. */
function fittedFace(name, lo, hi, d) {
  return fitted(name.name, name.size, lo, hi, { whole: true, faces: [d[0] === 1 ? "east" : d[0] === -1 ? "west" : d[1] === 1 ? "north" : "south"], rest: "sinbrickwall" });
}
/** A hanging sign's: its two big faces (across the edge's direction u) wear the picture. */
function fittedSign(name, lo, hi, u) {
  const faces = u[0] === 1 ? ["north", "south"] : ["east", "west"];
  return fitted(name.name, name.size, lo, hi, { whole: true, faces, rest: "metal2" });
}
function lo3(mid, u, d, t0, t1, n0, n1, z0, z1) {
  const a = [mid[0] + u[0] * t0 + d[0] * n0, mid[1] + u[1] * t0 + d[1] * n0];
  const c = [mid[0] + u[0] * t1 + d[0] * n1, mid[1] + u[1] * t1 + d[1] * n1];
  return { lo: [Math.min(a[0], c[0]), Math.min(a[1], c[1]), z0], hi: [Math.max(a[0], c[0]), Math.max(a[1], c[1]), z1] };
}

/** A caged balcony: a slab, a cage of mesh (masked texture) round it, a roof on it, a box inside. */
function cage(place, r, P, J) {
  const j = Math.min(J - 2, 20 + Math.floor(r() * 12));
  const zb = [0, 14, 30][Math.floor(r() * 3)];
  const H = [56, 72, 88][Math.floor(r() * 3)];
  const mesh = P.mesh[Math.floor(r() * P.mesh.length)];
  const metal = P.metal[Math.floor(r() * P.metal.length)];
  place("cage-floor", [-30, 30], [6, 8 + j], [zb, zb + 4], metal);
  place("cage-front", [-30, 30], [8 + j - 2, 8 + j], [zb + 4, zb + 4 + H], mesh);
  place("cage-side", [-30, -28], [8, 8 + j - 2], [zb + 4, zb + 4 + H], mesh);
  place("cage-side", [28, 30], [8, 8 + j - 2], [zb + 4, zb + 4 + H], mesh);
  place("cage-roof", [-31, 31], [6, 8 + j + 2], [zb + 4 + H, zb + 8 + H], metal);
  if (r() < 0.7) {
    const t0 = -22 + Math.floor(r() * 20);
    place("cage-box", [t0, t0 + 18], [10, 8 + Math.min(j - 4, 16)], [zb + 4, zb + 22 + Math.floor(r() * 14)], P.patches[Math.floor(r() * P.patches.length)]);
  }
}
/** An add-on room bolted to the wall, with a lit window in its face and a roof of other metal. */
function addRoom(place, r, P, J) {
  const j = Math.min(J - 3, 24 + Math.floor(r() * 6));
  const zb = [4, 20, 40][Math.floor(r() * 3)];
  const H = 60 + Math.floor(r() * 30);
  const wall = P.patches[Math.floor(r() * P.patches.length)];
  const win = P.windows[Math.floor(r() * P.windows.length)];
  place("room", [-30, 30], [6, 8 + j], [zb, zb + H], (lo, hi, side) => {
    const f = fitted(win.name, win.size, [lo[0] + 8, lo[1] + 8, lo[2] + 18], [hi[0] - 8, hi[1] - 8, hi[2] - 10], { whole: true, faces: [side], rest: wall });
    return { ...f, sides: wall, top: wall, bottom: wall };
  });
  place("room-roof", [-32, 32], [6, 8 + j + 3], [zb + H, zb + H + 4], P.metal[Math.floor(r() * P.metal.length)]);
}

/** The roof: shacks, tanks, masts and raised rooms at different heights, inside the parapet. */
function roof(b, layout, { r, P, add, base, density }) {
  const top = base + layout.storeys * STOREY;
  const [x0, y0] = [b.at[0] * GRID, b.at[1] * GRID];
  const [W, H] = [b.size[0], b.size[1]];
  const inset = 24;
  for (let cy = 0; cy < H; cy++)
    for (let cx = 0; cx < W; cx++) {
      if (r() > 0.42 * density) continue;
      const lo = [x0 + cx * GRID + (cx === 0 ? inset : 8), y0 + cy * GRID + (cy === 0 ? inset : 8)];
      const hi = [x0 + (cx + 1) * GRID - (cx === W - 1 ? inset : 8), y0 + (cy + 1) * GRID - (cy === H - 1 ? inset : 8)];
      const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
      const w = Math.min(hi[0] - lo[0], hi[1] - lo[1]);
      const kind = r();
      const wall = P.patches[Math.floor(r() * P.patches.length)];
      const metal = P.metal[Math.floor(r() * P.metal.length)];
      if (kind < 0.35) {
        const h = 48 + Math.floor(r() * 48);
        add("shack", [lo[0], lo[1], top], [hi[0], hi[1], top + h], { sides: wall, top: metal, [["east", "west", "north", "south"][Math.floor(r() * 4)]]: P.doors[Math.floor(r() * P.doors.length)] }, { side: "roof", jut: 0 });
        add("shack-roof", [lo[0] - 3, lo[1] - 3, top + h], [hi[0] + 3, hi[1] + 3, top + h + 4], metal, { side: "roof", jut: 0 });
      } else if (kind < 0.55) {
        const rad = Math.min(26, w / 2 - 2);
        const poly = Array.from({ length: 8 }, (_, i) => [mid[0] + Math.cos((i * Math.PI) / 4 + 0.39) * rad, mid[1] + Math.sin((i * Math.PI) / 4 + 0.39) * rad]);
        const legs = 18 + Math.floor(r() * 14);
        const hh = 34 + Math.floor(r() * 22);
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
          add("tank-leg", [mid[0] + sx * (rad - 4) - 2, mid[1] + sy * (rad - 4) - 2, top], [mid[0] + sx * (rad - 4) + 2, mid[1] + sy * (rad - 4) + 2, top + legs], metal, { side: "roof", jut: 0 });
        const tank = prism("z", poly.map(([x, y]) => [x, y]), top + legs, top + legs + hh, { sides: metal, top: metal, bottom: metal });
        add.raw(tank, "tank", [mid[0] - rad, mid[1] - rad, top + legs], [mid[0] + rad, mid[1] + rad, top + legs + hh]);
      } else if (kind < 0.75) {
        const h = 90 + Math.floor(r() * 140);
        add("mast", [mid[0] - 2, mid[1] - 2, top], [mid[0] + 2, mid[1] + 2, top + h], metal, { side: "roof", jut: 0 });
        add("mast-arm", [mid[0] - 16, mid[1] - 1, top + h - 24], [mid[0] + 16, mid[1] + 1, top + h - 22], metal, { side: "roof", jut: 0 });
        add("mast-arm", [mid[0] - 1, mid[1] - 10, top + h - 44], [mid[0] + 1, mid[1] + 10, top + h - 42], metal, { side: "roof", jut: 0 });
      } else {
        for (let k = 0; k < 3; k++) {
          const ox = lo[0] + 3 + k * ((hi[0] - lo[0] - 6) / 3);
          add("roof-ac", [ox, lo[1] + 6, top], [ox + (hi[0] - lo[0] - 6) / 3 - 4, lo[1] + 6 + 22, top + 14 + Math.floor(r() * 10)], { sides: metal, top: metal, north: P.vents[0], south: P.vents[0] }, { side: "roof", jut: 0 });
        }
      }
    }
}

/**
 * The rules, held to what was made. Returns a sentence for each thing standing out below the clearance, out further
 * than its street allows, or in a window's or a doorway's opening.
 */
export function kowloonProblems(items, openings, rules = KOWLOON_RULES, ground = 0) {
  const out = [];
  const where = (i) => `${i.kind} of ${i.building ?? "?"} at ${i.lo.map(Math.round)} to ${i.hi.map(Math.round)}`;
  for (const i of items) {
    if (i.side === "roof") continue;
    if (i.jut > rules.skin && i.lo[2] - ground < rules.clearance)
      out.push(`${where(i)} stands out ${i.jut} into the street at ${Math.round(i.lo[2] - ground)} over the ground; nothing bigger than ${rules.skin} hangs lower than ${rules.clearance} (2.5 m)`);
    if (i.jut > i.J) out.push(`${where(i)} stands out ${i.jut} into a street ${i.open} wide; it allows ${i.J}`);
  }
  for (const o of openings)
    for (const i of items) {
      if (i.side === "roof") continue;
      const meets = [0, 1, 2].every((a) => i.lo[a] < o.lo.hi[a] && i.hi[a] > o.lo.lo[a]);
      if (meets) out.push(`${where(i)} is in the opening of a ${o.kind}`);
    }
  return out;
}
