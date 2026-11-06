// What the building stages (3 programs, 5 floor plans) share: the plan grid, a seeded random source, the city's
// units, the lots read from stage 2's artifact or, until it lands, stubbed from the description's footprints.
//
// The plan grid. Floor plans are laid on a grid of 8 engine units (0.2032 m): every partition line, wall and door
// edge falls on it, so the adapter's brushes are whole units. A city cell (128 units, 3.25 m) is 16 steps, a storey
// (192 units) 24. Lengths in the artifacts are metres; the grid is internal.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const CITY_PATH = join(HERE, "../specs/newbyzantium.json");

/** One step of the plan grid in metres (8 units of 0.0254 m). */
export const G = 0.2032;
export const UNIT_M = 0.0254;
export const round3 = (v) => Math.round(v * 1000) / 1000;
export const round2 = (v) => Math.round(v * 100) / 100;
export const round4 = (v) => Math.round(v * 10000) / 10000;
/** Grid steps to metres: exact at four decimals (G is 0.2032). */
export const gToM = (g) => round4(g * G);

/** FNV-1a over a string: the seed of a building is its id hashed with the run's seed. */
export function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A seeded source of numbers in [0, 1) (mulberry32), with the helpers the stages use. */
export function rngOf(seedText) {
  let a = hash32(String(seedText)) || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    int: (n) => Math.floor(next() * n), // 0 .. n-1
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    range: (lo, hi) => lo + next() * (hi - lo),
    shuffle: (list) => {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
  return r;
}

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** JSON with sorted keys, so a hash does not depend on the order a file wrote its keys in. */
export const canonical = (v) =>
  v === null || typeof v !== "object"
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? `[${v.map(canonical).join(",")}]`
      : `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(",")}}`;

export const loadCity = (file = CITY_PATH) => JSON.parse(readFileSync(file, "utf8"));

// ── lots ──

const SIDE_OF = (dx, dy) => (Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "e" : "w") : dy >= 0 ? "n" : "s");

/** The nearest point of segment a-b to p (cells). */
const nearestOnSegment = (p, a, b) => {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const L2 = vx * vx + vy * vy;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2)) : 0;
  return [a[0] + t * vx, a[1] + t * vy];
};

/**
 * Stage 2's enterable lots, stubbed from the description until `02-lots.json` lands: each enterable building's
 * footprint centred on its `at`, its frontage side the side of the footprint facing the frontage way (the nearest
 * point of a segment, or a node's centre; a node at the building's own centre is faced through its first way), the
 * door where that point projects on the face. Same interface as stage 2's:
 * `{ id, building, tile, layer, rect: {x, y, w, d} (cells), frontage: { way, side, door: { at, width_m } }, zBase,
 * storeys, storeyHeight_m }`; `door.at` is cells along the frontage face from its west or south end.
 */
export function stubLots(desc) {
  const nodes = new Map(desc.streets.nodes.map((n) => [n.id, n]));
  const segs = new Map(desc.streets.segments.map((s) => [s.id, s]));
  const layers = new Map(desc.layers.map((l) => [l.id, l]));
  const districts = new Map(desc.districts.map((d) => [d.id, d]));
  const cell = desc.grid.cell;
  const lots = [];
  for (const b of desc.buildings) {
    if (!b.interior) continue;
    const layer = districts.get(b.district)?.layer;
    const [w, d] = b.footprint;
    const rect = { x: b.at[0] - w / 2, y: b.at[1] - d / 2, w, d };
    let target;
    const s = segs.get(b.frontage);
    const n = nodes.get(b.frontage);
    if (s) target = nearestOnSegment(b.at, nodes.get(s.from).at, nodes.get(s.to).at);
    else if (n) {
      target = n.at;
      if (Math.hypot(n.at[0] - b.at[0], n.at[1] - b.at[1]) < 0.5) {
        const way = desc.streets.segments.find((x) => x.from === n.id || x.to === n.id);
        const other = way ? nodes.get(way.from === n.id ? way.to : way.from) : null;
        target = other ? other.at : [b.at[0], b.at[1] + 1];
      }
    } else target = [b.at[0], b.at[1] + 1];
    const side = SIDE_OF(target[0] - b.at[0], target[1] - b.at[1]);
    const along = side === "n" || side === "s" ? target[0] - rect.x : target[1] - rect.y;
    const faceLen = side === "n" || side === "s" ? w : d;
    const at = Math.max(1, Math.min(faceLen - 1, Math.round(along * 2) / 2));
    const tc = desc.tiles.size;
    const tile = `c${Math.floor((b.at[0] - desc.tiles.origin[0]) / tc[0])}_r${Math.floor((b.at[1] - desc.tiles.origin[1]) / tc[1])}`;
    lots.push({
      id: `lot_${b.id}`,
      building: b.id,
      tile,
      layer,
      rect,
      frontage: { way: b.frontage, side, door: { at, width_m: null } },
      zBase: layers.get(layer)?.z?.[0] ?? 0,
      storeys: b.storeys,
      storeyHeight_m: round3(desc.grid.storey * cell),
      stub: true,
    });
  }
  return { format: "smak-gen-lots/stub", description: desc.name, lots };
}

/** Stage 2's lots from `<dir>/02-lots.json` when it is there and lists every enterable building, else the stub. */
export function lotsFor(desc, dir = null) {
  if (dir) {
    const f = join(dir, "02-lots.json");
    if (existsSync(f)) {
      const doc = JSON.parse(readFileSync(f, "utf8"));
      const list = (doc.lots ?? []).filter((l) => l.building);
      const want = desc.buildings.filter((b) => b.interior).map((b) => b.id);
      if (want.every((id) => list.some((l) => l.building === id))) return { ...doc, lots: list, from: f };
    }
  }
  return stubLots(desc);
}
