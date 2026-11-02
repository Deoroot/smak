// Checks on a city description (levels/lib/city-description.mjs) with no geometry. The walk graph is walked as a
// citizen (public ways, no secrets), as a vehicle (vehicle streets and ramps), and as the MSR (its service
// hallways and lifts); the rest are counts and sums held to the description's own `rules` and `engine.limits`,
// whole-city and tile by tile, and the measures a bands object names (an rp-city style, or the provisional
// fixture below). Every failure is a sentence naming the thing and the number it wanted.
import { measureCity, validateCity, ROOM_SIZES, CONNECTOR_TYPES, SILHOUETTES } from "./city-description.mjs";
import { holdToBand } from "./description-checks.mjs";
import { loadRules } from "./architecture-rules.mjs";

/** The architecture rulebook (levels/rules/architecture.json), read once; null when it cannot be read. */
let rulebookRead;
const rulebook = () => {
  if (rulebookRead === undefined) {
    try {
      rulebookRead = loadRules();
    } catch {
      rulebookRead = null;
    }
  }
  return rulebookRead;
};
/** The rulebook's stair pitch: a city may not climb steeper. */
const stairPitch = () => rulebook()?.dimensions.stairs.maxPitch ?? null;
/** How far stage 4 lets a stair's exit stand from its stop (levels/gen/stage4-network.mjs NEAR), cells. */
const EXIT_REACH = 6;

/**
 * PROVISIONAL bands for a Specialists roleplay city, until levels/styles/rp-city.json is measured. From the
 * three cities H9 plays (Alexandria, Paradise City, Xenon City), as measured in the New Byzantium study
 * (smak map-character and map-wiring): doors 94-111, lifts 6-9, faces 16,659-28,442, extent 4,673-7,560 units,
 * height spread 418-1,163, ways 228-303 units wide at the median. A city meant to be bigger than all three is
 * held to their low ends only (min), and to the H9 group's own cap on enterable buildings.
 */
export const RP_CITY_PROVISIONAL = {
  name: "rp-city (provisional)",
  kind: "rp-city",
  provisional: true,
  metrics: {
    doors: { min: 90, source: "measured", note: "the three cities' doors 94-111" },
    lifts: { min: 6, source: "measured", note: "the three cities' lifts and trains 6-9" },
    faces: { min: 16000, source: "measured", note: "the three cities' faces 16,659-28,442; the engine's limit above" }, // prettier-ignore
    extentUnits: { min: 4600, source: "measured", note: "the three cities' extents 4,673-7,560 units" },
    heightSpreadUnits: { min: 418, source: "measured", note: "the three cities' height spread 418-1,163 units" },
    wayWidthMedianUnits: { min: 200, max: 640, source: "measured", note: "ways 228-303 units at the median; avenues for vehicles widen it" }, // prettier-ignore
    enterableMaxPerLayer: { max: 10, source: "judged", note: "the H9 group: no more than about 10 enterable buildings a layer" }, // prettier-ignore
  },
};

/**
 * City measures a style's band may hold, by the style's measure name. SCALE measures (counts and areas) come from
 * the corpus's cities, which are smaller than a city built for 64 players: they are held as a floor only (at least
 * the source cities' p10). SHAPE measures (a median room, an alley's width) are held to the whole band.
 */
const SCALE_NAMES = {
  doors: "doors", doorsPerMap: "doors", walkedArea: "walkedAreaM2", cityPublicArea: "walkedAreaM2",
  cityPlazas: "plazas", cityPlazaArea: "medianPlazaAreaM2", cityBuildings: "enterable", cityHomes: "homes",
  cityShops: "shops", lifts: "lifts", faces: "faces", extent: "extentUnits", extentUnits: "extentUnits",
  heightSpreadUnits: "heightSpreadUnits", homes: "homes", enterable: "enterable", secrets: "secrets",
  districts: "districts", plazas: "plazas", checkpoints: "checkpoints", cityLifts: "lifts", cityDistricts: "districts",
  cityHidden: "secrets", citySpawns: "spawns", cityNamedDoors: "doorNames", cityConnectors: "connectors",
  cityCells: "cells", citySwitches: "switches",
}; // prettier-ignore
const SHAPE_NAMES = { cityRoomArea: "medianRoomAreaM2", cityPublicNarrowWidth: "alleyWidthM", wayWidthMedianUnits: "wayWidthMedianUnits" }; // prettier-ignore

/**
 * Bands from an rp-city style file (levels/styles/rp-city.json: `bands` of { measure: { unit, band: { median,
 * p10, p90 } } }), or a bands object as it is ({ metrics }). Scale measures become a floor (min = p10), shape
 * measures keep their band; measures a city description does not estimate are listed in `unheld`.
 */
export function bandsFromCityStyle(style, { name = style?.style ?? style?.kind ?? "rp-city" } = {}) {
  if (style?.metrics) return style;
  const metrics = {};
  const unheld = [];
  for (const [measure, entry] of Object.entries(style?.bands ?? {})) {
    const band = entry?.band;
    if (band && SCALE_NAMES[measure]) metrics[SCALE_NAMES[measure]] = { min: band.p10 ?? band.median, median: band.median, unit: entry.unit, source: `style ${name}: ${measure}`, note: `at least the source cities' p10 (${band.p10 ?? band.median}); they are smaller cities` }; // prettier-ignore
    else if (band && SHAPE_NAMES[measure]) metrics[SHAPE_NAMES[measure]] = { ...band, unit: entry.unit, source: `style ${name}: ${measure}` }; // prettier-ignore
    else unheld.push(measure);
  }
  return { name: `style ${name}`, kind: style?.kind, metrics, unheld };
}

/**
 * Estimate coefficients (a description's `engine.estimate` overrides any): faces, brushes, entities and brush
 * models per element; surface for the lightmap. Rough on purpose: a generator's real counts replace them once a
 * tile is built (then set the coefficients from the measured tile).
 */
export const ESTIMATE = {
  // a box, its door frame, a little dressing: of the 8 brushes about 4 are its share of partitions and slabs, 2 its
  // door frame (jambs and header) and `dressingBrushes` "a little dressing", which stage 8 replaces by the props it
  // places in the room (dressing.mjs, brushBudgetOf) so that the furniture is not counted twice; the split is a
  // reading of the 8, uncalibrated like it until the Core tile is compiled
  room: { faces: 30, brushes: 8, dressingBrushes: 2 },
  door: { faces: 6, entities: 1, brushModels: 1 },
  facadePerCellStorey: { faces: 4, brushes: 1 },
  streetPerCell: { faces: 12, brushes: 3, lightEvery: 6 },
  plazaPerCell2: { faces: 0.6, brushes: 0.15, lightEvery: 24 },
  connector: {
    "grand-stair": { faces: 300, brushes: 80, entities: 0, brushModels: 0 },
    stair: { faces: 150, brushes: 40, entities: 0, brushModels: 0 },
    ramp: { facesPerCell: 8, brushesPerCell: 2, entities: 0, brushModels: 0 },
    lift: { faces: 40, brushes: 12, entities: 1, entitiesPerStop: 2, brushModels: 1 },
    "ladder-shaft": { faces: 30, brushes: 10, entities: 1, brushModels: 1 },
    secret: { faces: 60, brushes: 15, entities: 1, brushModels: 1 },
  },
  checkpoint: { faces: 220, brushes: 60, entities: 4, brushModels: 3 },
  // a tower's shell (SILHOUETTES: a prism of that many sides): one solid shaft, a cornice a storey, a crown and a
  // cap, each one convex brush with its sides and two ends as faces; a square's portico: a column a pitch (one
  // brush), its vault one slab a side and one more at each way's mouth; a way's porticoes the same, each side of
  // each run (wayPorticoCost); a monument: a plinth, a shaft and a top
  tower: { brushesFixed: 3, brushesPerStorey: 1 },
  portico: { brushesPerColumn: 1, facesPerColumn: 6, roofBrushesPerSide: 1, roofBrushesPerMouth: 1, facesPerRoofBrush: 6, seamClearM: 3 },
  monument: { brushes: 3, faces: 22 },
  secretDoor: { faces: 40, brushes: 10, entities: 1, brushModels: 1 },
  secretPassagePerCell: { faces: 10, brushes: 3 },
  soundsPerDistrict: 3,
  soundsPerType: { bar: 2, factory: 3, workshop: 1, msr: 1 },
  /**
   * Structural carved rock (PLAN.md, "Brush economy"), PROVISIONAL until the first compiled tile sets it: the carve
   * of each tile and layer is sliced at every distinct floor and ceiling height on the half-storey grid, and each
   * band costs about `perCornerBand` brushes for every corner of the outlines cut in it: public ways and service
   * hallways (`wayCorners`, a winding way `jogCorners` more every `windingJogCells` of its length), plazas, building
   * shells (one outline each; the rooms are detail inside), connector wells at each stop, secret passages, the
   * tile's own frame, and `seamCorners` on each side of every seam a way crosses. A building of more than
   * `wallEveryM2` a floor keeps a structural wall per such area (`wallBrushesPerStorey` a storey) for vis.
   */
  rock: { perCornerBand: 1, wayCorners: 4, windingJogCells: 8, jogCorners: 4, plazaCorners: 4, shellCorners: 4, connectorCorners: 4, seamCorners: 2, frameCorners: 4, wallEveryM2: 150, wallBrushesPerStorey: 1, provisional: true }, // prettier-ignore
  clipnodesPerBrush: 2.2,
  leavesPerStructural: 2.2, // the old New Byzantium: 37,863 leaves for ~17,200 structural brushes; detail cuts none
  leavesPerBrush: 1.5, // the old New Byzantium: 24,910 brushes, 37,863 leaves (BSP2 read back)
  leavesCalibrated: false, // until the Core tile is compiled: the leaves are the larger of the two terms
  luxelUnits: 16,
  bytesPerLuxel: 3,
  texturesPerRole: 2,
  textureBytes: 88149, // 256 x 256 at 8 bits with mips and palette
};

const round = (v, places = 2) => Math.round(v * 10 ** places) / 10 ** places;
const angle = (v) => Math.atan2(v[1], v[0]);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

function adjacency(edges, keep) {
  const adj = new Map();
  const add = (a, b, e) => (adj.get(a) ?? adj.set(a, []).get(a)).push([b, e]);
  for (const e of edges) if (keep(e)) add(e.a, e.b, e), add(e.b, e.a, e);
  return adj;
}
function reach(adj, starts) {
  const seen = new Set(starts);
  const queue = [...starts];
  while (queue.length) for (const [n] of adj.get(queue.shift()) ?? []) if (!seen.has(n)) seen.add(n), queue.push(n);
  return seen;
}
function dijkstra(adj, starts) {
  const dist = new Map(starts.map((s) => [s, 0]));
  const open = new Set(starts);
  while (open.size) {
    let best = null;
    for (const v of open) if (best === null || dist.get(v) < dist.get(best)) best = v;
    open.delete(best);
    for (const [n, e] of adj.get(best) ?? []) {
      const d = dist.get(best) + e.length;
      if (!dist.has(n) || d < dist.get(n) - 1e-9) dist.set(n, d), open.add(n);
    }
  }
  return dist;
}

const publicEdge = (e) => !e.secret && e.access === "public";

/**
 * The walk from public floor to the nearest public connector on one layer, as samples [walk, area, way or plaza
 * id]: every public way (not service) at each cell of its length, weighted by its walked width (a canal by its two
 * quays), the walk along it from its ends or its middle (where its buildings open), the part inside a plaza left to
 * the plaza; every plaza cell not under a building walked straight to where a way leaves the plaza (or to a connector standing on it),
 * then along that way. `d` is the walk graph's distance from the layer's public connector stops. The measure is
 * the rp-city corpus's `toConnector` (levels/notes-rp-city.md) taken on the description.
 */
function floorWalkSamples(m, layerId, d) {
  const samples = [];
  const at = (v) => d.get(v) ?? Infinity;
  const inPlaza = (n, p) => n.kind === "plaza" && Math.abs(p[0] - n.at[0]) < n.size[0] / 2 && Math.abs(p[1] - n.at[1]) < n.size[1] / 2; // prettier-ignore
  /** How far along a segment from node `n` its way leaves n's plaza (0 for a junction). */
  const exitOf = (n, other) => {
    if (n.kind !== "plaza") return 0;
    const [ux, uy] = [other.at[0] - n.at[0], other.at[1] - n.at[1]];
    const len = Math.hypot(ux, uy) || 1;
    return Math.min(Math.abs(ux) > 1e-9 ? n.size[0] / 2 / (Math.abs(ux) / len) : Infinity, Math.abs(uy) > 1e-9 ? n.size[1] / 2 / (Math.abs(uy) / len) : Infinity); // prettier-ignore
  };
  /** The walk from a point at distance `x` along segment s (from its `from` end), by its ends or its middle. */
  const along = (s, x) => {
    const L = s.length;
    const [da, dm, db] = [at(`n:${s.from}`), at(`s:${s.id}`), at(`n:${s.to}`)];
    return Math.min(da + x, db + (L - x), dm + Math.abs(L / 2 - x));
  };
  const ways = [...m.segments.values()].filter((s) => s.layer === layerId && s.access === "public" && s.class !== "service"); // prettier-ignore
  for (const s of ways) {
    const [a, b] = [m.nodes.get(s.from), m.nodes.get(s.to)];
    const n = Math.max(1, Math.round(s.length));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const p = [a.at[0] + (b.at[0] - a.at[0]) * t, a.at[1] + (b.at[1] - a.at[1]) * t];
      if (inPlaza(a, p) || inPlaza(b, p)) continue; // that floor is the plaza's, counted below
      samples.push([along(s, t * s.length), s.class === "canal" ? 2 * s.sidewalk : s.width, s.id]); // a canal: its two quays
    }
  }
  const standing = [...m.buildings.values()].filter((b) => b.layer === layerId);
  for (const n of m.nodes.values()) {
    if (n.layer !== layerId || n.kind !== "plaza") continue;
    // a plaza is open floor: each cell walks straight to where a way leaves the plaza, then along it
    const exits = [];
    if (at(`n:${n.id}`) === 0) exits.push([n.at, 0]); // a connector stands on the plaza
    for (const s of ways) {
      if (s.from !== n.id && s.to !== n.id) continue;
      const other = m.nodes.get(s.from === n.id ? s.to : s.from);
      const e = Math.min(exitOf(n, other), s.straight);
      const k = s.straight ? e / s.straight : 0;
      const point = [n.at[0] + (other.at[0] - n.at[0]) * k, n.at[1] + (other.at[1] - n.at[1]) * k];
      const x = s.straight ? (e / s.straight) * s.length : 0;
      exits.push([point, along(s, s.from === n.id ? x : s.length - x)]);
    }
    if (!exits.length) exits.push([n.at, at(`n:${n.id}`)]);
    const [w, h] = n.size;
    for (let x = 0; x < Math.ceil(w); x++)
      for (let y = 0; y < Math.ceil(h); y++) {
        const p = [n.at[0] - w / 2 + x + 0.5, n.at[1] - h / 2 + y + 0.5];
        if (standing.some((b) => Math.abs(p[0] - b.at[0]) < b.footprint[0] / 2 && Math.abs(p[1] - b.at[1]) < b.footprint[1] / 2)) continue; // a building on the plaza
        samples.push([Math.min(...exits.map(([q, dq]) => Math.hypot(p[0] - q[0], p[1] - q[1]) + dq)), 1, n.id]);
      }
  }
  return samples;
}

/** The area-weighted p90 of floor walk samples, and the ways and plazas holding most of the floor past it. */
function walkP90(samples) {
  if (!samples.length) return { p90: 0, far: [] };
  samples = [...samples].sort((p, q) => p[0] - q[0]);
  const total = samples.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  let p90 = samples[samples.length - 1][0];
  for (const [v, w] of samples) if ((acc += w) >= 0.9 * total - 1e-9) {
    p90 = v;
    break;
  }
  // the floor past the p90, by how much of it each way or plaza holds (where a connector would help most)
  const farArea = new Map();
  for (const [v, w, id] of samples) if (v > p90) farArea.set(id, (farArea.get(id) ?? 0) + w);
  const far = [...farArea].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([id]) => id);
  return { p90, far };
}

// ── plan geometry (cells), as levels/lib/plan-picture.mjs draws it ──
const gDist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rectOf = (at, [w, d]) => [at[0] - w / 2, at[1] - d / 2, at[0] + w / 2, at[1] + d / 2];
const overlapDepth = (a, b) => Math.min(a[2] - b[0], b[2] - a[0], a[3] - b[1], b[3] - a[1]);
const pointRectDist = (p, r) => Math.hypot(Math.max(r[0] - p[0], 0, p[0] - r[2]), Math.max(r[1] - p[1], 0, p[1] - r[3])); // prettier-ignore
const rectRectDist = (a, b) => Math.hypot(Math.max(0, b[0] - a[2], a[0] - b[2]), Math.max(0, b[1] - a[3], a[1] - b[3])); // prettier-ignore
const nearestOnSeg = (p, a, b) => {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const L = dx * dx + dy * dy;
  const t = L ? clampTo(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L, 0, 1) : 0;
  return [a[0] + dx * t, a[1] + dy * t];
};
const segSegDist = (a, b, c, d) => {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const [d1, d2, d3, d4] = [cross(c, d, a), cross(c, d, b), cross(a, b, c), cross(a, b, d)];
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(gDist(a, nearestOnSeg(a, c, d)), gDist(b, nearestOnSeg(b, c, d)), gDist(c, nearestOnSeg(c, a, b)), gDist(d, nearestOnSeg(d, a, b))); // prettier-ignore
};
const segRectDist = (a, b, r) => {
  if (pointRectDist(a, r) === 0 || pointRectDist(b, r) === 0) return 0;
  const cs = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
  return Math.min(...cs.map((c, i) => segSegDist(a, b, c, cs[(i + 1) % 4])));
};
/** Where the way from `p` (inside `r`) toward `q` leaves the rectangle `r`. */
const exitPoint = (p, q, r) => {
  let t = 1;
  const [dx, dy] = [q[0] - p[0], q[1] - p[1]];
  if (dx > 0) t = Math.min(t, (r[2] - p[0]) / dx);
  else if (dx < 0) t = Math.min(t, (r[0] - p[0]) / dx);
  if (dy > 0) t = Math.min(t, (r[3] - p[1]) / dy);
  else if (dy < 0) t = Math.min(t, (r[1] - p[1]) / dy);
  return [p[0] + dx * t, p[1] + dy * t];
};
const fmt1 = (v) => Math.round(v * 10) / 10;

/**
 * Placement faults on the plan: a building outside its district; a building standing into a way, a plaza (or a
 * sized gate) or a junction; a door more than `maxDoorGap` cells from its frontage way's edge; two ways overlapping
 * away from a node they share (a road inside a canal); two buildings of a layer overlapping. `m` is measureCity's. Winding ways (drawn schematically) and service hallways
 * (behind the fronts) are left out of the overlap tests. Each fault names the things and the depth or gap.
 */
export function placementFaults(m, { maxDoorGap = 1, overlap = 0.25 } = {}) {
  const out = [];
  const box = (n) => (n.size ? rectOf(n.at, n.size) : null);
  const line = new Map();
  for (const s of m.segments.values()) {
    const [A, B] = [m.nodes.get(s.from), m.nodes.get(s.to)];
    const a = box(A) ? exitPoint(A.at, B.at, box(A)) : A.at;
    const b = box(B) ? exitPoint(B.at, A.at, box(B)) : B.at;
    line.set(s.id, [a, b]);
  }
  const halfAt = new Map();
  for (const s of m.segments.values()) if (s.class !== "service") for (const id of [s.from, s.to]) halfAt.set(id, Math.max(halfAt.get(id) ?? 0, s.width / 2)); // prettier-ignore
  const solid = (s) => s.class !== "service" && !(s.winding || s.length > s.straight * 1.01);
  for (const b of m.buildings.values()) {
    const fp = rectOf(b.at, b.footprint);
    const d = m.districts.get(b.district);
    const outside = Math.max(d.area[0] - fp[0], d.area[1] - fp[1], fp[2] - d.area[2], fp[3] - d.area[3]);
    if (outside > 0.01) out.push(`placement: ${b.id} reaches ${fmt1(outside)} cells outside its district ${d.id}`);
    for (const s of m.segments.values()) {
      if (s.layer !== b.layer || !solid(s)) continue;
      const depth = s.width / 2 - segRectDist(...line.get(s.id), fp);
      if (depth > overlap) out.push(`placement: ${b.id} stands ${fmt1(depth)} cells into ${s.class} ${s.id}`);
    }
    for (const n of m.nodes.values()) {
      if (n.layer !== b.layer || n.id === b.frontage || n.kind === "service") continue;
      const r = box(n);
      const depth = r ? overlapDepth(fp, r) : (halfAt.get(n.id) ?? 0) - pointRectDist(n.at, fp);
      if (r ? depth > overlap && rectRectDist(fp, r) === 0 : depth > overlap) out.push(`placement: ${b.id} stands ${fmt1(depth)} cells into ${n.kind} ${n.id}`); // prettier-ignore
    }
    // the door: the frontage way's edge (a plaza's rectangle, a junction's widest way) within maxDoorGap
    const s = m.segments.get(b.frontage);
    const n = m.nodes.get(b.frontage);
    const gap = s ? segRectDist(...line.get(s.id), fp) - s.width / 2 : box(n) ? rectRectDist(fp, box(n)) : pointRectDist(n.at, fp) - (halfAt.get(n.id) ?? 0); // prettier-ignore
    if (gap > maxDoorGap) out.push(`placement: ${b.id}'s door is ${fmt1(gap)} cells from its frontage ${b.frontage}, at most ${maxDoorGap}`); // prettier-ignore
  }
  const bs = [...m.buildings.values()];
  for (let i = 0; i < bs.length; i++)
    for (let j = i + 1; j < bs.length; j++) {
      if (bs[i].layer !== bs[j].layer) continue;
      const depth = overlapDepth(rectOf(bs[i].at, bs[i].footprint), rectOf(bs[j].at, bs[j].footprint));
      if (depth > 0.01) out.push(`placement: ${bs[i].id} and ${bs[j].id} overlap by ${fmt1(depth)} cells`);
    }
  // ways over ways: sampled along each, away from the nodes they share and their own ends' plazas
  const ways = [...m.segments.values()].filter(solid);
  for (let i = 0; i < ways.length; i++)
    for (let j = i + 1; j < ways.length; j++) {
      const [p, q] = [ways[i], ways[j]];
      if (p.layer !== q.layer) continue;
      const shared = [p.from, p.to].filter((id) => id === q.from || id === q.to).map((id) => m.nodes.get(id));
      const reach = (p.width + q.width) / 2;
      const [a, b] = line.get(p.id);
      const [c, d] = line.get(q.id);
      const L = gDist(a, b);
      // two bands leaving a node at an angle part after reach / sin(angle); nearly parallel ones never part
      const skipOf = (n) => {
        const away = (s, [e0, e1]) => (s.from === n.id ? [e1[0] - e0[0], e1[1] - e0[1]] : [e0[0] - e1[0], e0[1] - e1[1]]);
        const [u, v] = [away(p, line.get(p.id)), away(q, line.get(q.id))];
        const sin = Math.abs(u[0] * v[1] - u[1] * v[0]) / ((Math.hypot(...u) * Math.hypot(...v)) || 1);
        const cos = (u[0] * v[0] + u[1] * v[1]) / ((Math.hypot(...u) * Math.hypot(...v)) || 1);
        const plaza = n.size ? Math.max(...n.size) / 2 : 0;
        return plaza + (cos < 0 ? reach : sin < 0.17 ? reach : reach / sin);
      };
      let worst = 0;
      for (let k = 0; k <= Math.ceil(L * 2); k++) {
        const t = L ? k / Math.ceil(L * 2) : 0;
        const pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        // near a shared node the two bands meet by design: skip where the other way's band could still be the junction
        if (shared.some((n) => gDist(pt, n.at) < skipOf(n))) continue;
        worst = Math.max(worst, reach - gDist(pt, nearestOnSeg(pt, c, d)));
      }
      if (worst > overlap) out.push(`placement: ways ${p.id} (${p.class}) and ${q.id} (${q.class}) overlap by ${fmt1(worst)} cells${shared.length ? ` away from their shared node${shared.length > 1 ? "s" : ""} ${shared.map((n) => n.id).join(", ")}` : ""}`); // prettier-ignore
    }
  return out;
}

/** The tile a point stands in, as "cCOL_rROW" (col from x, row from y), and its tile rectangle. */
function tiler(desc) {
  const t = desc.tiles;
  const [ox, oy] = t.origin ?? [0, 0];
  const [w, d] = t.size;
  const of = ([x, y]) => {
    const c = Math.floor((x - ox) / w);
    const r = Math.floor((y - oy) / d);
    return c < 0 || r < 0 || c >= t.cols || r >= t.rows ? null : `c${c}_r${r}`;
  };
  const rect = (id) => {
    const [c, r] = id.slice(1).split("_r").map(Number);
    return [ox + c * w, oy + r * d, ox + (c + 1) * w, oy + (r + 1) * d];
  };
  const all = [];
  for (let r = 0; r < t.rows; r++) for (let c = 0; c < t.cols; c++) all.push(`c${c}_r${r}`);
  /** Where a straight line from a to b crosses tile borders: [{ at, from, to }]. */
  const crossings = (a, b) => {
    const ts = [];
    for (let c = 1; c < t.cols; c++) {
      const x = ox + c * w;
      if ((a[0] - x) * (b[0] - x) < 0) ts.push((x - a[0]) / (b[0] - a[0]));
    }
    for (let r = 1; r < t.rows; r++) {
      const y = oy + r * d;
      if ((a[1] - y) * (b[1] - y) < 0) ts.push((y - a[1]) / (b[1] - a[1]));
    }
    ts.sort((p, q) => p - q);
    return ts.map((k) => {
      const at = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      const before = [a[0] + (b[0] - a[0]) * (k - 1e-6), a[1] + (b[1] - a[1]) * (k - 1e-6)];
      const after = [a[0] + (b[0] - a[0]) * (k + 1e-6), a[1] + (b[1] - a[1]) * (k + 1e-6)];
      return { at, from: of(before), to: of(after) };
    });
  };
  const seamDistance = ([x, y]) => {
    let best = Infinity;
    for (let c = 1; c < t.cols; c++) best = Math.min(best, Math.abs(x - (ox + c * w)));
    for (let r = 1; r < t.rows; r++) best = Math.min(best, Math.abs(y - (oy + r * d)));
    return best;
  };
  return { of, rect, all, crossings, seamDistance };
}

/**
 * A layer's sky lid, z in cells: its `sky` (decided 2026-11-02: about z 28 over L3 and L2's open ring, so domes,
 * spires, the wall's towers and the backdrop rise over the old lid), else its top, the lid the format assumed before.
 */
export const skyOf = (L) => L.sky ?? L.z[1];
/** Whether a point of a layer is roofed: a vault or slab everywhere, a deck under the layer above's bounds, the sky nowhere. */
export function roofedAt(m, L, pos) {
  if (L.ceiling === "sky") return false;
  if (L.ceiling !== "deck") return true;
  const up = m.byLevel.get(L.level + 1);
  return Boolean(up) && pos[0] >= up.bounds[0] && pos[0] <= up.bounds[2] && pos[1] >= up.bounds[1] && pos[1] <= up.bounds[3]; // prettier-ignore
}
/** The lid over a point of a layer, z in cells: its top where it is roofed, its sky where it is open. */
export const lidAt = (m, L, pos) => (roofedAt(m, L, pos) ? L.z[1] : skyOf(L));

/** A tower's crown, z in cells: its building's storeys and its own over the layer's floor. */
export const towerTop = (b, m) => m.layers.get(b.layer).z[0] + (b.storeys + b.tower.storeys) * m.desc.grid.storey;

/** A tower's shell in brushes and faces (ESTIMATE.tower): a solid shaft, a cornice a storey, a crown and a cap. */
export function towerCost(b, E = ESTIMATE) {
  const brushes = E.tower.brushesFixed + E.tower.brushesPerStorey * b.tower.storeys;
  return { brushes, faces: brushes * ((SILHOUETTES[b.tower.silhouette] ?? 16) + 2) };
}

/** A square's colonnade (ESTIMATE.portico): its columns along the inner line less the ways' mouths, its vault. */
export function porticoCost(n, m, E = ESTIMATE) {
  if (!(n.portico > 0)) return { columns: 0, brushes: 0, faces: 0, mouths: 0 };
  const pitch = rulebook() ? rulebook().dimensions.porticoes.maxColumnPitch / m.desc.grid.cell : 1;
  const [w, d] = n.size;
  const ways = [...m.segments.values()].filter((s) => (s.from === n.id || s.to === n.id) && s.class !== "service");
  const line = 2 * (w - 2 * n.portico) + 2 * (d - 2 * n.portico);
  const open = Math.max(0, line - ways.reduce((t, s) => t + Math.max(0, s.width - 2 * s.portico), 0));
  const columns = Math.ceil(open / pitch - 1e-9);
  const roof = 4 * E.portico.roofBrushesPerSide + ways.length * E.portico.roofBrushesPerMouth;
  return { columns, mouths: ways.length, brushes: columns * E.portico.brushesPerColumn + roof, faces: columns * E.portico.facesPerColumn + roof * E.portico.facesPerRoofBrush }; // prettier-ignore
}

/**
 * A way's porticoes (ESTIMATE.portico, as a square's; the Mese's): a column line each side along the way (straight,
 * node to node, cut at its end plazas' boxes and at every seam, each run half a shaft short of a plaza and clear of
 * a portal's mouth, `seamClearM` (stage 8's PORTAL_DEPTH), and half a shaft more at a seam: stage 1's wayColonnadeOf), a column every pitch from each end of a run less a side way's mouth at a junction end
 * (its width less its own porticoes, on its side; a way running straight on is none), and its vault one slab a side
 * a run and one more at each mouth. `byTile`: [{ tile, at (the piece's middle), columns, brushes, faces }].
 */
export function wayPorticoCost(s, m, E = ESTIMATE, tiles = tiler(m.desc)) {
  const out = { columns: 0, brushes: 0, faces: 0, mouths: 0, byTile: [] };
  if (!(s.portico > 0) || s.class === "canal" || s.class === "service") return out;
  const cell = m.desc.grid.cell;
  const P = rulebook()?.dimensions.porticoes;
  const pitch = P ? P.maxColumnPitch / cell : 1;
  const col = P ? P.column.width.typical / cell : 0.3;
  const A = m.nodes.get(s.from);
  const B = m.nodes.get(s.to);
  const L0 = Math.hypot(B.at[0] - A.at[0], B.at[1] - A.at[1]);
  if (L0 < 1e-9) return out;
  const u = [(B.at[0] - A.at[0]) / L0, (B.at[1] - A.at[1]) / L0];
  // the line out of the end plazas' boxes
  const outOf = (n) => (n.size ? Math.min(...[0, 1].map((k) => (Math.abs(u[k]) > 1e-9 ? n.size[k] / 2 / Math.abs(u[k]) : Infinity))) : 0);
  const [ta, tb] = [outOf(A), L0 - outOf(B)];
  if (tb - ta < 1e-6) return out;
  const pt = (t) => [A.at[0] + u[0] * t, A.at[1] + u[1] * t];
  // the mouths at the junction ends: [t of the end, side (+1 left, -1 right), half its width less its porticoes]
  const mouths = [];
  for (const [n, t, dir] of [[A, ta, 1], [B, tb, -1]]) {
    if (n.size) continue;
    for (const o of m.segments.values()) {
      if (o.id === s.id || o.class === "service" || o.layer !== s.layer || (o.from !== n.id && o.to !== n.id)) continue;
      const far = m.nodes.get(o.from === n.id ? o.to : o.from).at;
      const v = [far[0] - n.at[0], far[1] - n.at[1]];
      const vl = Math.hypot(...v) || 1;
      if ((v[0] * u[0] + v[1] * u[1]) * dir / vl < -Math.cos(Math.PI / 6)) continue; // straight on
      mouths.push({ t, side: Math.sign(u[0] * v[1] - u[1] * v[0]) || 1, half: Math.max(0, o.width / 2 - o.portico) + col / 2 });
    }
  }
  out.mouths = mouths.length;
  const cuts = [ta, ...tiles.crossings(pt(ta), pt(tb)).map((c) => ta + (tb - ta) * (Math.hypot(c.at[0] - pt(ta)[0], c.at[1] - pt(ta)[1]) / (tb - ta))), tb]; // prettier-ignore
  for (let i = 1; i < cuts.length; i++) {
    const seam = (E.portico.seamClearM ?? 3) / cell + col / 2;
    const [t0, t1] = [cuts[i - 1] + (i > 1 ? seam : A.size ? col / 2 : 0), cuts[i] - (i < cuts.length - 1 ? seam : B.size ? col / 2 : 0)];
    if (t1 - t0 < 0) continue;
    let columns = 0;
    for (const side of [1, -1]) {
      // a mouth at a run's end takes its half from that side's run
      const lost = mouths.filter((x) => x.side === side && x.t >= t0 - 1e-6 && x.t <= t1 + 1e-6).reduce((a, x) => a + x.half, 0);
      const len = t1 - t0 - lost;
      if (len >= -1e-9) columns += Math.ceil(Math.max(0, len) / pitch - 1e-9) + 1;
    }
    const mouthsHere = mouths.filter((x) => x.t >= t0 - 1e-6 && x.t <= t1 + 1e-6).length;
    const roof = 2 * E.portico.roofBrushesPerSide + mouthsHere * E.portico.roofBrushesPerMouth;
    const part = { tile: tiles.of(pt((t0 + t1) / 2)), at: pt((t0 + t1) / 2), columns, brushes: columns * E.portico.brushesPerColumn + roof, faces: columns * E.portico.facesPerColumn + roof * E.portico.facesPerRoofBrush }; // prettier-ignore
    out.byTile.push(part);
    out.columns += part.columns;
    out.brushes += part.brushes;
    out.faces += part.faces;
  }
  return out;
}

/** The structural walls a big building keeps inside its shell, for vis: one per `wallEveryM2` of a floor past the first, per storey. */
function shellWallsOf(b, desc, R) {
  const m2 = b.footprint[0] * b.footprint[1] * desc.grid.cell * desc.grid.cell;
  return Math.max(0, Math.ceil(m2 / R.wallEveryM2) - 1) * b.storeys * R.wallBrushesPerStorey;
}

/**
 * The carve of each tile and layer (PLAN.md, "Brush economy"): its distinct floor and ceiling heights snapped to
 * the half-storey grid from the layer's floor (the layer's floor and top; each way's ceiling where it is roofed:
 * a vault or slab everywhere, a deck under the layer above's bounds, the sky nowhere; each building shell's top),
 * the corners of the outlines it cuts, and its rock: corners x bands x `perCornerBand`. Returns
 * [{ tile, layer, heights, corners, rock }] in tile then level order.
 */
function rockCuts(m, tiles, E) {
  const R = E.rock;
  const desc = m.desc;
  const half = desc.grid.storey / 2;
  const cuts = new Map();
  const cutAt = (pos, layerId) => {
    const t = tiles.of(pos);
    if (!t) return null;
    const key = `${t}|${layerId}`;
    if (!cuts.has(key)) {
      const L = m.layers.get(layerId);
      // the layer's floor and its lid: a sky layer's sky (its top is then no carve height, only what stands under it)
      cuts.set(key, { tile: t, layer: layerId, level: L.level, heights: new Set([L.z[0], L.ceiling === "sky" ? skyOf(L) : L.z[1]]), corners: R.frameCorners }); // prettier-ignore
    }
    return cuts.get(key);
  };
  const height = (layerId, z) => {
    const L = m.layers.get(layerId);
    return Math.min(L.z[1], L.z[0] + Math.round((z - L.z[0]) / half) * half);
  };
  const roofed = (L, pos) => roofedAt(m, L, pos);
  // a deck layer's open ring is carved up to its sky: one more height for each tile and layer that has some of it
  const ring = (c, L, pos) => {
    if (c && L.ceiling === "deck" && !roofed(L, pos)) c.heights.add(skyOf(L));
  };
  const corners = (pos, layerId, n) => {
    const c = cutAt(pos, layerId);
    if (c) c.corners += n;
    return c;
  };
  for (const s of m.segments.values()) {
    const [a, b] = [m.nodes.get(s.from).at, m.nodes.get(s.to).at];
    const L = m.layers.get(s.layer);
    const jogs = s.winding ? Math.floor(s.length / R.windingJogCells) * R.jogCorners : 0;
    for (const p of [a, b]) {
      const c = corners(p, s.layer, (R.wayCorners + jogs) / 2);
      if (c && roofed(L, p)) c.heights.add(height(s.layer, L.z[0] + s.clearance));
      ring(c, L, p);
    }
    for (const x of tiles.crossings(a, b)) {
      for (const t of [x.from, x.to]) if (t) corners(tiles.rect(t).slice(0, 2).map((v) => v + 1e-6), s.layer, R.seamCorners);
    }
  }
  for (const n of m.nodes.values()) if (n.kind === "plaza") ring(corners(n.at, n.layer, R.plazaCorners), m.layers.get(n.layer), n.at);
  for (const b of m.buildings.values()) {
    const c = corners(b.at, b.layer, R.shellCorners);
    if (c) c.heights.add(height(b.layer, m.layers.get(b.layer).z[0] + b.storeys * desc.grid.storey));
    // a tower is carved round only under a roof: under the sky it stands in the open and cuts no rock
    if (c && b.tower && roofed(m.layers.get(b.layer), b.at)) c.heights.add(height(b.layer, towerTop(b, m)));
  }
  for (const c of m.connectors) for (const s of c.stops) corners(m.posOf(s), m.layerOf(s), R.connectorCorners);
  for (const s of m.secrets) if (s.kind === "passage") for (const e of [s.from, s.to]) corners(m.posOf(e), s.layer, R.wayCorners / 2);
  const out = [...cuts.values()].map((c) => {
    const bands = Math.max(1, c.heights.size - 1);
    return { tile: c.tile, layer: c.layer, level: c.level, heights: c.heights.size, corners: round(c.corners, 1), rock: Math.round(c.corners * bands * R.perCornerBand) }; // prettier-ignore
  });
  const order = new Map(tiles.all.map((t, i) => [t, i]));
  return out.sort((p, q) => order.get(p.tile) - order.get(q.tile) || p.level - q.level);
}

/** The engine-budget estimate, whole city and by tile. */
function estimateBudget(m, tiles) {
  const desc = m.desc;
  const E = { ...ESTIMATE, ...(desc.engine.estimate ?? {}) };
  E.rock = { ...ESTIMATE.rock, ...(desc.engine.estimate?.rock ?? {}) };
  E.room = { ...ESTIMATE.room, ...(desc.engine.estimate?.room ?? {}) };
  const cu = desc.grid.cellUnits;
  const storey = desc.grid.storey;
  const zero = () => ({ faces: 0, brushes: 0, entities: 0, brushModels: 0, lights: 0, doors: 0, surfaceUnits2: 0, loopingSounds: 0, rock: 0, shellWalls: 0, structural: 0, rooms: 0, roomDressing: 0, towers: 0, squares: 0, porticoes: 0 }); // prettier-ignore
  const byTile = new Map(tiles.all.map((t) => [t, zero()]));
  const total = zero();
  const add = (pos, part) => {
    const keys = [total, byTile.get(tiles.of(pos))].filter(Boolean);
    for (const k of keys) for (const [f, v] of Object.entries(part)) k[f] += v;
  };
  const roomPart = (w, d, h = storey) => ({
    faces: E.room.faces + E.door.faces,
    brushes: E.room.brushes,
    rooms: 1,
    roomDressing: E.room.dressingBrushes ?? 0, // inside `brushes`, kept apart for stage 8 (it places the real props)
    entities: E.door.entities,
    brushModels: E.door.brushModels,
    doors: 1,
    lights: 1,
    surfaceUnits2: (2 * w * d + 2 * (w + d) * h) * cu * cu,
  });
  for (const b of m.buildings.values()) {
    const [w, d] = b.footprint;
    const perim = 2 * (w + d);
    add(b.at, {
      faces: perim * b.storeys * E.facadePerCellStorey.faces,
      brushes: perim * b.storeys * E.facadePerCellStorey.brushes,
      surfaceUnits2: perim * b.storeys * storey * cu * cu,
      loopingSounds: E.soundsPerType[b.type] ?? 0,
    });
    if (b.tower) {
      // a solid shell over the roof: world brushes (it hides what stands behind it), no room, no door
      const t = towerCost(b, E);
      const across = b.tower.across;
      const h = b.tower.storeys * storey;
      add(b.tower.at ?? b.at, { faces: t.faces, brushes: t.brushes, structural: t.brushes, towers: t.brushes, surfaceUnits2: (Math.PI * across * h + (Math.PI * across * across) / 4) * cu * cu }); // prettier-ignore
    }
    if (!b.interior) continue;
    for (const [kind, count] of Object.entries(b.program)) {
      const [rw, rd] = desc.roomSizes?.[kind] ?? ROOM_SIZES[kind] ?? [2, 3];
      const r = roomPart(rw, rd);
      for (let i = 0; i < count; i++) add(b.at, r);
    }
    for (const [cls, count] of Object.entries(b.homes)) {
      const uc = m.unitClasses[cls];
      const area = uc.cells[0] * uc.cells[1];
      const side = Math.sqrt(area / uc.rooms);
      for (let i = 0; i < count * uc.rooms; i++) add(b.at, roomPart(side, side));
    }
  }
  for (const s of m.segments.values()) {
    const a = m.nodes.get(s.from).at;
    const bb = m.nodes.get(s.to).at;
    const half = (pos) => add(pos, {
      faces: (s.length / 2) * E.streetPerCell.faces,
      brushes: (s.length / 2) * E.streetPerCell.brushes,
      lights: s.length / 2 / E.streetPerCell.lightEvery,
      surfaceUnits2: (s.length / 2) * (s.width + 2 * s.clearance) * cu * cu,
    }); // prettier-ignore
    half(a), half(bb);
    // its porticoes' colonnades (the Mese's): detail, in the brushes, where each run stands
    for (const p of wayPorticoCost(s, m, E, tiles).byTile) add(p.at, { faces: p.faces, brushes: p.brushes, porticoes: p.brushes, surfaceUnits2: p.columns * 4 * 2 * cu * cu }); // prettier-ignore
  }
  for (const n of m.nodes.values()) {
    if (n.kind !== "plaza") continue;
    const area = n.size[0] * n.size[1];
    add(n.at, { faces: area * E.plazaPerCell2.faces, brushes: area * E.plazaPerCell2.brushes, lights: area / E.plazaPerCell2.lightEvery, surfaceUnits2: area * 1.5 * cu * cu }); // prettier-ignore
    // its colonnade and its monuments: detail (they cut no leaf), in the brushes
    const pc = porticoCost(n, m, E);
    if (pc.brushes) add(n.at, { faces: pc.faces, brushes: pc.brushes, squares: pc.brushes, surfaceUnits2: pc.columns * 4 * 2 * cu * cu }); // prettier-ignore
    for (const mo of n.monuments ?? []) add(mo.at, { faces: E.monument.faces, brushes: E.monument.brushes, squares: E.monument.brushes, surfaceUnits2: (2 * (mo.base[0] + mo.base[1]) + 4 * (mo.across ?? 1) * mo.height) * cu * cu }); // prettier-ignore
  }
  for (const c of m.connectors) {
    const k = E.connector[c.type];
    const pos = m.posOf(c.stops[0]);
    const len = c.links.reduce((s, l) => s + l.length, 0);
    add(pos, {
      faces: k.faces ?? (k.facesPerCell ?? 0) * len,
      brushes: k.brushes ?? (k.brushesPerCell ?? 0) * len,
      entities: (k.entities ?? 0) + (k.entitiesPerStop ?? 0) * c.stops.length,
      brushModels: k.brushModels ?? 0,
      surfaceUnits2: len * 4 * 3 * cu * cu,
    });
  }
  for (const cp of m.checkpoints) {
    const cells = Object.entries(cp.program ?? {}).reduce((s, [k, v]) => s + (k.includes("cell") ? v : 0), 0);
    add(m.nodes.get(cp.node).at, { faces: E.checkpoint.faces, brushes: E.checkpoint.brushes, entities: E.checkpoint.entities + cells, brushModels: E.checkpoint.brushModels + cells, doors: 1 + cells }); // prettier-ignore
  }
  for (const s of m.secrets) {
    if (s.kind === "door") add(m.buildings.get(s.in).at, { ...E.secretDoor, ...roomPart(2, 3), faces: E.secretDoor.faces + E.room.faces, brushModels: E.secretDoor.brushModels + 1, entities: E.secretDoor.entities + 1 }); // prettier-ignore
    else add(m.posOf(s.from), { faces: s.length * E.secretPassagePerCell.faces, brushes: s.length * E.secretPassagePerCell.brushes, entities: 2, brushModels: 2 }); // prettier-ignore
  }
  for (const d of m.districts.values()) {
    const [x0, y0, x1, y1] = d.area;
    add([(x0 + x1) / 2, (y0 + y1) / 2], { loopingSounds: E.soundsPerDistrict, entities: E.soundsPerDistrict });
  }
  const cuts = rockCuts(m, tiles, E);
  for (const c of cuts) add(tiles.rect(c.tile).slice(0, 2).map((v) => v + 1e-6), { rock: c.rock, structural: c.rock, brushes: c.rock });
  for (const b of m.buildings.values()) {
    const walls = shellWallsOf(b, desc, E.rock);
    if (walls) add(b.at, { shellWalls: walls, structural: walls, brushes: walls });
  }
  const spawns = desc.players.target;
  const wired = (desc.wiring?.switches ?? 0) + (desc.wiring?.switchableLights ?? 0);
  total.entities += spawns + total.loopingSounds + wired;
  const finish = (part) => {
    // counts rounded first, so the terms below are what a reader recomputes from the totals
    for (const k of ["brushes", "structural"]) part[k] = Math.round(part[k]);
    part.clipnodes = Math.round(part.brushes * E.clipnodesPerBrush);
    // UNCALIBRATED: the larger of the old whole-brush term and the structural one, until the Core tile is compiled
    const byStructural = part.structural * E.leavesPerStructural;
    // the old term counted every brush the old estimate had, which carried no rock term: it is applied to those
    const byBrush = (part.brushes - part.structural) * E.leavesPerBrush;
    part.leaves = Math.round(E.leavesCalibrated ? byStructural : Math.max(byStructural, byBrush));
    part.lightdataBytes = Math.round((part.surfaceUnits2 / (E.luxelUnits * E.luxelUnits)) * E.bytesPerLuxel);
    for (const k of ["faces", "brushes", "entities", "brushModels", "lights", "doors", "surfaceUnits2", "loopingSounds", "rock", "shellWalls", "structural", "rooms", "roomDressing", "towers", "squares", "porticoes"]) part[k] = Math.round(part[k]); // prettier-ignore
    return part;
  };
  finish(total);
  for (const p of byTile.values()) finish(p);
  const roles = new Set();
  for (const d of m.districts.values()) for (const [slot, rs] of Object.entries(d.palette)) if (slot !== "light" && slot !== "sound") rs.forEach((r) => roles.add(r)); // prettier-ignore
  for (const rs of Object.values(desc.sharedPalette ?? {})) rs.forEach((r) => roles.add(r));
  for (const f of Object.values(desc.factionPalettes ?? {})) for (const rs of Object.values(f)) rs.forEach((r) => roles.add(r));
  total.textures = roles.size * E.texturesPerRole;
  total.textureBytes = total.textures * E.textureBytes;
  const xs = [...m.layers.values()].flatMap((L) => [L.bounds[0], L.bounds[2]]);
  const ys = [...m.layers.values()].flatMap((L) => [L.bounds[1], L.bounds[3]]);
  const zs = [...m.layers.values()].flatMap((L) => [...L.z, skyOf(L)]);
  total.extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * cu;
  total.height = (Math.max(...zs) - Math.min(...zs)) * cu;
  return { total, byTile, spawns, cuts };
}

/**
 * A tile's estimate in counts, not shares: its brushes, structural and rock brushes, and the description's rooms in it
 * with the brushes of their dressing allowance (`rooms`, `roomDressing`, inside `brushes`). Stage 8 reads it to put
 * the props it places in place of that allowance. Null for a tile the description does not hold.
 */
export function tileEstimateOf(desc, tile) {
  const budget = estimateBudget(measureCity(desc), tiler(desc));
  const p = budget.byTile.get(tile);
  return p ? { brushes: p.brushes, structural: p.structural, rock: p.rock, shellWalls: p.shellWalls, rooms: p.rooms, roomDressing: p.roomDressing, leaves: p.leaves, faces: p.faces, entities: p.entities, brushModels: p.brushModels, squares: p.squares, porticoes: p.porticoes } : null; // prettier-ignore
}

/** Everything measured on a valid city description, and every rule's findings (failures and notes). */
export function analyseCity(desc) {
  const m = measureCity(desc);
  const R = desc.rules;
  const fail = [];
  const note = [];
  const tiles = tiler(desc);
  const levelOf = (lid) => m.layers.get(lid).level;
  const layersByLevel = [...m.layers.values()].sort((a, b) => a.level - b.level);
  const gates = [...m.nodes.values()].filter((n) => n.kind === "gate");
  const start = desc.start ?? gates[0]?.id;
  if (!start || !m.nodes.has(start)) fail.push("start: no gate node and no `start` node to walk from");
  if (!gates.some((g) => g.outside)) fail.push("gate: no gate node leads outside (`outside: true`)");

  // 1. a citizen's walk: public ways, no secrets
  const pub = adjacency(m.edges, publicEdge);
  const reached = reach(pub, start ? [`n:${start}`] : []);
  const unreached = [];
  for (const n of m.nodes.values()) if (n.kind !== "service" && !reached.has(`n:${n.id}`)) unreached.push(n.id);
  for (const s of m.segments.values()) if (s.access === "public" && !reached.has(`s:${s.id}`)) unreached.push(s.id);
  for (const b of m.buildings.values()) if (!reached.has(`b:${b.id}`)) unreached.push(b.id);
  if (unreached.length) fail.push(`reach: ${unreached.join(", ")} cannot be reached on foot from ${start} by public ways`); // prettier-ignore
  const districtHas = new Map([...m.districts.keys()].map((d) => [d, { things: 0, reached: 0 }]));
  const count = (d, v) => {
    if (!d) return;
    const e = districtHas.get(d);
    e.things++;
    if (reached.has(v)) e.reached++;
  };
  for (const n of m.nodes.values()) count(n.district, `n:${n.id}`);
  for (const s of m.segments.values()) count(s.district, `s:${s.id}`);
  for (const b of m.buildings.values()) count(b.district, `b:${b.id}`);
  for (const [d, e] of districtHas) {
    if (!e.things) fail.push(`districts: ${d} has no street, node or building`);
    else if (!e.reached) fail.push(`districts: ${d} cannot be reached on foot`);
  }
  for (const n of m.nodes.values())
    if (n.kind === "service" && reached.has(`n:${n.id}`)) note.push(`service: ${n.id} is a service node the public reaches (through a public way)`); // prettier-ignore

  // 2. vehicles
  const V = desc.vehicle;
  const vehicleSegs = [...m.segments.values()].filter((s) => s.vehicle);
  let vehicle = null;
  if (V) {
    const margin = V.margin ?? 0.125;
    const veh = adjacency(m.edges, (e) => e.vehicle && !e.secret);
    const vReached = reach(veh, start ? [`n:${start}`] : []);
    const cut = vehicleSegs.filter((s) => !vReached.has(`s:${s.id}`)).map((s) => s.id);
    if (!vehicleSegs.some((s) => s.from === start || s.to === start)) fail.push(`vehicles: the gate ${start} is on no vehicle street`); // prettier-ignore
    if (cut.length) fail.push(`vehicles: ${cut.join(", ")} cannot be driven to from the gate ${start}`);
    const lane = V.width + 2 * margin;
    for (const s of vehicleSegs) {
      const carriage = s.width - 2 * Math.max(s.sidewalk, s.portico);
      if (carriage < s.lanes * lane) fail.push(`vehicles: ${s.id} carriageway ${round(carriage)} cells is narrower than ${s.lanes} lane(s) of ${round(lane)}`); // prettier-ignore
      if (s.clearance < V.height + margin) fail.push(`vehicles: ${s.id} clearance ${s.clearance} is under the vehicle's ${V.height} + ${margin}`); // prettier-ignore
    }
    for (const s of m.segments.values()) {
      const L = m.layers.get(s.layer);
      if (s.clearance > L.z[1] - L.z[0]) fail.push(`clearance: ${s.id} wants ${s.clearance} cells of headroom, its layer ${L.id} has ${L.z[1] - L.z[0]}`); // prettier-ignore
    }
    const turns = [];
    for (const n of m.nodes.values()) {
      const here = vehicleSegs.filter((s) => s.from === n.id || s.to === n.id);
      for (let i = 0; i < here.length; i++)
        for (let j = i + 1; j < here.length; j++) {
          const dirOut = (s) => {
            const o = m.nodes.get(s.from === n.id ? s.to : s.from).at;
            return [o[0] - n.at[0], o[1] - n.at[1]];
          };
          let dev = Math.abs(angle(dirOut(here[i])) - angle(dirOut(here[j])));
          if (dev > Math.PI) dev = 2 * Math.PI - dev;
          const turn = 180 - (dev * 180) / Math.PI; // 0 = straight on
          if (turn <= (R.vehicles?.straightUnder ?? 20)) continue;
          const corner = n.cornerRadius ?? (n.kind === "plaza" ? Math.min(...n.size) / 2 : 0);
          const carriage = Math.min(...[here[i], here[j]].map((s) => s.width - 2 * Math.max(s.sidewalk, s.portico)));
          const ok = corner + carriage >= V.turningRadius;
          turns.push({ node: n.id, a: here[i].id, b: here[j].id, turn: round(turn, 0), corner, carriage, ok });
          if (!ok) fail.push(`vehicles: at ${n.id} the turn ${here[i].id} -> ${here[j].id} (${round(turn, 0)} deg) has corner radius ${corner} + carriageway ${round(carriage)} under the turning radius ${V.turningRadius}`); // prettier-ignore
        }
    }
    for (const c of m.connectors.filter((c) => c.type === "ramp")) {
      const w = c.width ?? 4;
      if (w < lane) fail.push(`vehicles: ramp ${c.id} is ${w} cells wide, under one lane of ${round(lane)}`);
    }
    const layersDriven = new Set(vehicleSegs.filter((s) => vReached.has(`s:${s.id}`)).map((s) => s.layer));
    vehicle = { segments: vehicleSegs.length, unreached: cut, turns, layers: [...layersDriven] };
    for (const lid of R.vehicles?.layers ?? []) if (!layersDriven.has(lid)) fail.push(`vehicles: layer ${lid} wants a road the gate drives to`); // prettier-ignore
    if (V.optional) note.push(`vehicles: optional and ${V.status ?? "unbuilt"}: the roads reserve room for a car; nothing depends on one`); // prettier-ignore
  } else if (vehicleSegs.length) note.push("vehicles: vehicle streets but no `vehicle` to hold them to");

  // 3. connectors between layers
  const RC = R.connectors ?? {};
  const pairs = [];
  for (let i = 1; i < layersByLevel.length; i++) {
    const [lo, hi] = [layersByLevel[i - 1], layersByLevel[i]];
    const links = m.connectors.flatMap((c) => c.links.filter((l) => l.loLevel === lo.level).map((l) => ({ c, l })));
    const pubLinks = links.filter(({ c }) => c.type !== "secret" && c.access === "public");
    const types = new Set(pubLinks.map(({ c }) => c.type));
    const pair = { pair: `${lo.id}-${hi.id}`, public: pubLinks.length, msr: links.filter(({ c }) => c.access === "msr").length, secret: links.filter(({ c }) => c.type === "secret").length, types: [...types] }; // prettier-ignore
    pairs.push(pair);
    if (pubLinks.length < (RC.minPerPair ?? 1)) fail.push(`connectors: ${pair.pair} has ${pubLinks.length} public connectors, wanted ${RC.minPerPair}`); // prettier-ignore
    if (types.size < (RC.minTypesPerPair ?? 1)) fail.push(`connectors: ${pair.pair} has ${types.size} kinds of public connector (${[...types].join(", ")}), wanted ${RC.minTypesPerPair}`); // prettier-ignore
    if (RC.rampPerPair && !types.has("ramp")) fail.push(`connectors: ${pair.pair} has no vehicle ramp`);
    const onFoot = pubLinks.filter(({ c }) => c.type !== "ramp").length;
    if (onFoot < (RC.minPerPair ?? 1)) fail.push(`connectors: ${pair.pair} has ${onFoot} public connectors besides ramps, wanted ${RC.minPerPair}: nothing may depend on vehicles`); // prettier-ignore
  }
  for (const c of m.connectors) {
    const T = CONNECTOR_TYPES[c.type];
    const isStair = c.type === "stair" || c.type === "grand-stair";
    const maxGrade = isStair && stairPitch() ? Math.min(T.maxGrade, stairPitch()) : T.maxGrade;
    // a stair through several stops: its whole rise over its whole length, landings included (the rulebook's pitch)
    if (isStair && c.length && c.links.length > 1) {
      const rise = c.links.reduce((s, l) => s + l.rise, 0);
      if (rise / c.length > maxGrade + 1e-9) fail.push(`connectors: ${c.id} climbs ${rise} cells through its ${c.stops.length} stops in ${c.length} (grade ${round(rise / c.length)}), a ${c.type} at most ${maxGrade}`); // prettier-ignore
    }
    for (const l of c.links) {
      const slack = Math.max(...[l.lo, l.hi].map((id) => (m.buildings.has(id) ? Math.max(...m.buildings.get(id).footprint) / 2 : 0))); // prettier-ignore
      if (T.vertical && l.horizontal > (RC.verticalTolerance ?? 2) + slack) fail.push(`connectors: ${c.id} is a ${c.type}, its stops ${l.lo} and ${l.hi} stand ${round(l.horizontal)} cells apart (a shaft goes straight up)`); // prettier-ignore
      if (!T.vertical && maxGrade && l.rise / l.length > maxGrade + 1e-9) fail.push(`connectors: ${c.id} climbs ${l.rise} cells in ${l.length} (grade ${round(l.rise / l.length)}), a ${c.type} at most ${maxGrade}`); // prettier-ignore
      if (!T.vertical && c.type !== "secret" && l.length < l.horizontal - 0.01) fail.push(`connectors: ${c.id} is ${l.length} cells long but its stops stand ${round(l.horizontal)} apart`); // prettier-ignore
    }
  }
  // the walk to the nearest public connector, layer by layer
  const walkAdj = adjacency(m.edges, (e) => publicEdge(e) && e.kind !== "connector");
  const walk = [];
  const floorAll = [];
  for (const L of layersByLevel) {
    const starts = new Set();
    for (const c of m.connectors) if (c.type !== "secret" && c.access === "public") for (const l of c.links) for (const s of [l.lo, l.hi]) if (m.layerOf(s) === L.id) starts.add(m.vertexOf(s)); // prettier-ignore
    const d = dijkstra(walkAdj, [...starts]);
    let worst = { id: null, d: 0 };
    const over = [];
    const things = [
      ...[...m.nodes.values()].filter((n) => n.layer === L.id && n.kind !== "service").map((n) => [n.id, `n:${n.id}`]), // prettier-ignore
      ...[...m.buildings.values()].filter((b) => b.layer === L.id).map((b) => [b.id, `b:${b.id}`]),
    ];
    for (const [id, v] of things) {
      const dv = d.get(v) ?? Infinity;
      if (dv > worst.d) worst = { id, d: dv };
      if (dv > (RC.maxWalk ?? Infinity)) over.push(`${id} ${dv === Infinity ? "none" : round(dv, 1)}`);
    }
    const floor = floorWalkSamples(m, L.id, d);
    floorAll.push(...floor);
    const { p90, far } = walkP90(floor);
    walk.push({ layer: L.id, worst: worst.id, distance: round(worst.d, 1), p90: p90 === Infinity ? null : round(p90, 1), far: far.slice(0, 5) }); // prettier-ignore
    if (over.length) fail.push(`connectors: on ${L.id} the walk to a public connector is over ${RC.maxWalk} cells from ${over.join(", ")}`); // prettier-ignore
  }
  const cityWalk = walkP90(floorAll);
  const walkP90Cells = cityWalk.p90 === Infinity ? null : round(cityWalk.p90, 1);
  if (RC.p90Walk !== undefined && cityWalk.p90 > RC.p90Walk) fail.push(`connectors: the p90 walk from public floor to the nearest public connector is ${walkP90Cells === null ? "unbounded (floor with no way to one)" : `${walkP90Cells} cells`}, at most ${RC.p90Walk} (the farthest floor: ${cityWalk.far.slice(0, 3).join(", ")})`); // prettier-ignore

  // 4. housing
  const RH = R.housing ?? {};
  const supply = {};
  for (const L of m.layers.keys()) supply[L] = {};
  let homes = 0;
  for (const b of m.buildings.values()) {
    let area = 0;
    for (const [cls, n] of Object.entries(b.homes)) {
      const uc = m.unitClasses[cls];
      supply[b.layer][cls] = (supply[b.layer][cls] ?? 0) + n;
      homes += n;
      area += uc.cells[0] * uc.cells[1] * n;
      if (uc.levels && !uc.levels.includes(levelOf(b.layer))) fail.push(`housing: ${b.id} has ${cls} homes on level ${levelOf(b.layer)}, the class stands on ${uc.levels.join(", ")}`); // prettier-ignore
    }
    const room = b.footprint[0] * b.footprint[1] * b.storeys * (RH.fill ?? 0.75);
    if (area > room) fail.push(`housing: ${b.id}'s homes take ${area} cells, its ${b.footprint.join("x")} x ${b.storeys} storeys hold ${round(room)} at ${RH.fill ?? 0.75} fill`); // prettier-ignore
    if (b.residential && !Object.keys(b.homes).length && b.interior) fail.push(`housing: ${b.id} is a ${b.type} with no homes`); // prettier-ignore
  }
  for (const [lid, row] of Object.entries(desc.housing.target))
    for (const [cls, want] of Object.entries(row)) {
      const got = supply[lid]?.[cls] ?? 0;
      if (got < want) fail.push(`housing: ${lid} has ${got} ${cls} homes, the table wants ${want}`);
      else if (got > want) note.push(`housing: ${lid} has ${got} ${cls} homes, ${got - want} over the table`);
    }
  if (homes < desc.players.target) fail.push(`housing: ${homes} homes for a player target of ${desc.players.target}`); // prettier-ignore

  // 5. buildings per layer, blocks
  const RB = R.buildings ?? {};
  const enterable = {};
  for (const L of m.layers.keys()) enterable[L] = 0;
  for (const b of m.buildings.values()) if (b.interior) enterable[b.layer]++;
  for (const [L, n] of Object.entries(enterable)) if (n > (RB.maxEnterablePerLayer ?? Infinity)) fail.push(`buildings: ${L} has ${n} enterable buildings, at most ${RB.maxEnterablePerLayer}`); // prettier-ignore
  for (const bl of desc.blocks ?? []) {
    const inside = [...m.buildings.values()].filter((b) => b.block === bl.id);
    const area = inside.reduce((s, b) => s + b.footprint[0] * b.footprint[1], 0);
    if (inside.length > bl.lots) fail.push(`blocks: ${bl.id} holds ${inside.length} buildings on ${bl.lots} lots`);
    if (area > bl.size[0] * bl.size[1] * (RB.blockFill ?? 0.85)) fail.push(`blocks: ${bl.id}'s buildings cover ${area} cells of its ${bl.size.join("x")} (at most ${RB.blockFill ?? 0.85})`); // prettier-ignore
    const tileSet = new Set(inside.map((b) => tiles.of(b.at)));
    if (tileSet.size > 1) fail.push(`blocks: ${bl.id}'s buildings stand in ${tileSet.size} tiles (${[...tileSet].join(", ")}); a block is one tile's`); // prettier-ignore
    for (const b of inside) if (bl.edges?.length && !bl.edges.includes(b.frontage)) fail.push(`blocks: ${b.id} fronts ${b.frontage}, not an edge of its block ${bl.id}`); // prettier-ignore
  }
  for (const b of m.buildings.values()) if (b.block === undefined && RB.blockRequired) fail.push(`blocks: ${b.id} is in no block`); // prettier-ignore

  // 6. variety
  const RV = R.variety ?? {};
  const variants = new Map();
  const signs = new Map();
  for (const b of m.buildings.values()) {
    variants.set(b.variant, (variants.get(b.variant) ?? 0) + 1);
    if (b.sign) signs.set(b.sign, (signs.get(b.sign) ?? 0) + 1);
    if ((RV.signedTypes ?? []).includes(b.type) && !b.sign) fail.push(`variety: ${b.id} is a ${b.type} with no sign`);
  }
  for (const [v, n] of variants) if (n > (RV.maxVariantRepeats ?? Infinity)) fail.push(`variety: variant ${v} is used ${n} times, at most ${RV.maxVariantRepeats}`); // prettier-ignore
  for (const [s, n] of signs) if (n > (RV.maxSignRepeats ?? Infinity)) fail.push(`variety: sign ${s} is used ${n} times, at most ${RV.maxSignRepeats}`); // prettier-ignore

  // 7. palette discipline and the decay going down
  const RP = R.palette ?? {};
  const shared = desc.sharedPalette ?? {};
  const textureOwner = new Map();
  for (const [role, mat] of Object.entries(desc.materials))
    for (const tex of mat.textures ?? []) {
      if (textureOwner.has(tex)) fail.push(`palette: texture ${tex} is under two roles (${textureOwner.get(tex)}, ${role})`); // prettier-ignore
      else textureOwner.set(tex, role);
    }
  const used = new Set([...Object.values(shared).flat(), ...Object.values(desc.factionPalettes ?? {}).flatMap((f) => Object.values(f).flat())]); // prettier-ignore
  for (const [f, pal] of Object.entries(desc.factionPalettes ?? {}))
    for (const [slot, roles] of Object.entries(pal))
      for (const r of roles) if (!desc.materials[r]) fail.push(`palette: factionPalettes.${f}.${slot} names ${r}, no material's role`); // prettier-ignore
  for (const d of m.districts.values()) {
    const roles = new Set();
    for (const slot of Object.keys(d.palette)) {
      if (slot === "light" || slot === "sound") continue;
      if (d.palette[slot].length > (RP.maxPerSlot ?? Infinity)) fail.push(`palette: ${d.id}.${slot} has ${d.palette[slot].length} roles, at most ${RP.maxPerSlot}`); // prettier-ignore
      d.palette[slot].forEach((r) => (roles.add(r), used.add(r)));
    }
    if (roles.size > (RP.maxRolesPerDistrict ?? Infinity)) fail.push(`palette: ${d.id} uses ${roles.size} roles, at most ${RP.maxRolesPerDistrict}`); // prettier-ignore
  }
  for (const r of Object.keys(desc.materials)) if (!used.has(r)) note.push(`palette: material ${r} is in no palette`);
  for (const b of m.buildings.values())
    for (const [slot, roles] of Object.entries(b.palette ?? {}))
      for (const r of [roles].flat()) {
        const own = m.districts.get(b.district).palette[slot] ?? [];
        const faction = desc.factionPalettes?.[b.owner]?.[slot] ?? [];
        if (!own.includes(r) && !(shared[slot] ?? []).includes(r) && !faction.includes(r)) fail.push(`palette: ${b.id}.${slot} uses ${r}, outside ${b.district}'s ${slot} palette (${own.join(", ")}) and its owner's`); // prettier-ignore
      }
  for (const s of m.segments.values())
    for (const [slot, roles] of Object.entries(s.palette ?? {}))
      for (const r of [roles].flat()) {
        const own = s.district ? (m.districts.get(s.district).palette[slot] ?? []) : [];
        if (!own.includes(r) && !(shared[slot] ?? []).includes(r)) fail.push(`palette: ${s.id}.${slot} uses ${r}, outside its district's and the shared palette`); // prettier-ignore
      }
  const overlap = [];
  for (const L of m.layers.keys()) {
    const ds = [...m.districts.values()].filter((d) => d.layer === L);
    for (let i = 0; i < ds.length; i++)
      for (let j = i + 1; j < ds.length; j++) {
        const A = new Set([...ds[i].palette.wall, ...ds[i].palette.floor]);
        const B = new Set([...ds[j].palette.wall, ...ds[j].palette.floor]);
        const inter = [...A].filter((r) => B.has(r)).length;
        const share = inter / new Set([...A, ...B]).size;
        overlap.push({ a: ds[i].id, b: ds[j].id, share: round(share) });
        if (share > (RP.maxSharedWallFloor ?? 1)) fail.push(`palette: ${ds[i].id} and ${ds[j].id} share ${round(share * 100, 0)} % of their walls and floors, at most ${round((RP.maxSharedWallFloor ?? 1) * 100, 0)} %: two districts of a layer should read apart`); // prettier-ignore
      }
  }
  const WEALTH_RANK = { slum: 0, low: 1, mid: 2, high: 3, elite: 4 };
  const meanWear = layersByLevel.map((L) => {
    const ds = [...m.districts.values()].filter((d) => d.layer === L.id);
    return ds.reduce((s, d) => s + d.wear, 0) / Math.max(1, ds.length);
  });
  if (RP.decayDownward)
    for (let i = 1; i < layersByLevel.length; i++) {
      if (!(meanWear[i] < meanWear[i - 1])) fail.push(`palette: ${layersByLevel[i].id} (mean wear ${round(meanWear[i])}) is not less worn than ${layersByLevel[i - 1].id} (${round(meanWear[i - 1])}): the city degrades going down`); // prettier-ignore
      if (!(WEALTH_RANK[layersByLevel[i].wealth] > WEALTH_RANK[layersByLevel[i - 1].wealth])) fail.push(`layers: ${layersByLevel[i].id} (${layersByLevel[i].wealth}) is not richer than ${layersByLevel[i - 1].id} (${layersByLevel[i - 1].wealth})`); // prettier-ignore
    }

  // 8. density and space for roleplay
  const RD = R.density ?? {};
  for (const L of m.layers.keys()) {
    const ds = [...m.districts.values()].filter((d) => d.layer === L);
    const areaOf = (d) => (d.area[2] - d.area[0]) * (d.area[3] - d.area[1]);
    const all = ds.reduce((s, d) => s + areaOf(d), 0);
    const dense = ds.filter((d) => d.density === "dense").reduce((s, d) => s + areaOf(d), 0);
    if (all && dense / all > (RD.maxDenseShare ?? 1)) fail.push(`density: ${round((dense / all) * 100, 0)} % of ${L}'s districts are dense, at most ${round(RD.maxDenseShare * 100, 0)} %`); // prettier-ignore
    const plazas = [...m.nodes.values()].filter((n) => n.layer === L && n.kind === "plaza").length;
    if (plazas < (R.space?.minPlazasPerLayer ?? 0)) fail.push(`space: ${L} has ${plazas} plazas, wanted ${R.space.minPlazasPerLayer}`); // prettier-ignore
  }
  // the grand avenue (New Byzantium's Mese): its ways at their width with porticoes, and no other way widened
  const GA = R.space?.grandAvenue;
  if (GA) {
    const mine = [...m.segments.values()].filter((s) => s.name === GA.name);
    if (!mine.length) fail.push(`space: no way is named ${GA.name}, the grand avenue`);
    for (const s of mine) {
      if (s.width < (GA.minWidth ?? 0)) fail.push(`space: ${s.id} (${GA.name}) is ${s.width} cells wide, wanted ${GA.minWidth}`); // prettier-ignore
      if (s.portico < (GA.minPortico ?? 0)) fail.push(`space: ${s.id} (${GA.name}) has ${s.portico ? `porticoes of ${s.portico} cells` : "no porticoes"}, wanted ${GA.minPortico} each side`); // prettier-ignore
    }
    for (const s of m.segments.values())
      if (s.name !== GA.name && s.width > m.classes[s.class].width) fail.push(`space: ${s.id} is ${s.width} cells wide, over its class's ${m.classes[s.class].width}: ${GA.name} alone is widened`); // prettier-ignore
  }
  // squares (the rulebook's dimensions.squares, porticoes, monuments): no square so wide it reads empty, a wide one
  // framed by a colonnade and a monument, its monuments clear of what stands round them
  const AR = rulebook();
  const cellM = desc.grid.cell;
  if (AR?.dimensions.squares) {
    const SQ = AR.dimensions.squares;
    const PO = AR.dimensions.porticoes;
    const MO = AR.dimensions.monuments;
    for (const n of m.nodes.values()) {
      if (n.kind !== "plaza") continue;
      const p = n.portico ?? 0;
      const span = (Math.max(...n.size) - 2 * p) * cellM;
      if (span > SQ.maxOpenSpan + 1e-6) fail.push(`space: plaza ${n.id} is ${round(span, 1)} m across inside its porticoes, at most ${SQ.maxOpenSpan} m (dimensions.squares.maxOpenSpan, the games' p90 sight): shrink it or frame it with porticoes`); // prettier-ignore
      if (n.size[0] * n.size[1] * cellM * cellM < SQ.minArea - 1e-6) fail.push(`space: plaza ${n.id} is ${round(n.size[0] * n.size[1] * cellM * cellM, 0)} m2, at least ${SQ.minArea} m2 (dimensions.squares.minArea)`); // prettier-ignore
      if (Math.max(...n.size) * cellM > SQ.maxUnframedSpan + 1e-6) {
        if (!(p > 0)) fail.push(`space: plaza ${n.id} is ${round(Math.max(...n.size) * cellM, 1)} m across, past ${SQ.maxUnframedSpan} m (dimensions.squares.maxUnframedSpan): it wants a portico along its edges`); // prettier-ignore
        if (!(n.monuments ?? []).length) fail.push(`space: plaza ${n.id} is ${round(Math.max(...n.size) * cellM, 1)} m across, past ${SQ.maxUnframedSpan} m (dimensions.squares.maxUnframedSpan): it wants a monument`); // prettier-ignore
      }
      if (p > 0 && p * cellM < PO.depth.min - 1e-6) fail.push(`space: plaza ${n.id}'s portico is ${round(p * cellM, 2)} m deep, at least ${PO.depth.min} m (dimensions.porticoes.depth)`); // prettier-ignore
      const openArea = (n.size[0] - 2 * p) * (n.size[1] - 2 * p);
      const standing = [...m.buildings.values()].filter((b) => b.layer === n.layer).map((b) => [b.id, rectOf(b.at, b.footprint)]);
      const L = m.layers.get(n.layer);
      const clear = MO.clearAround.min / cellM;
      for (const mo of n.monuments ?? []) {
        const base = rectOf(mo.at, mo.base);
        if (mo.base[0] * mo.base[1] > (MO.maxBaseShare ?? 1) * openArea + 1e-9) fail.push(`space: monument ${mo.id} on ${n.id} stands on ${mo.base[0] * mo.base[1]} cells2, at most ${round((MO.maxBaseShare ?? 1) * openArea, 1)} (dimensions.monuments.maxBaseShare of its square's open floor)`); // prettier-ignore
        if (L.z[0] + mo.height > L.z[1] + 1e-9) fail.push(`space: monument ${mo.id} rises to z ${L.z[0] + mo.height}, over ${L.id}'s top ${L.z[1]}`);
        for (const [id, r] of standing) if (rectRectDist(base, r) < clear - 1e-6) fail.push(`space: monument ${mo.id} on ${n.id} stands ${round(rectRectDist(base, r) * cellM, 2)} m from ${id}, at least ${MO.clearAround.min} m of open floor round it (dimensions.monuments.clearAround)`); // prettier-ignore
        const inner = rectOf(n.at, [n.size[0] - 2 * p, n.size[1] - 2 * p]);
        const edge = Math.min(base[0] - inner[0], base[1] - inner[1], inner[2] - base[2], inner[3] - base[3]);
        if (p > 0 && edge < clear - 1e-6) fail.push(`space: monument ${mo.id} on ${n.id} stands ${round(edge * cellM, 2)} m from its portico, at least ${MO.clearAround.min} m (dimensions.monuments.clearAround)`); // prettier-ignore
      }
    }
  }
  // towers (the rulebook's dimensions.towers): a shell over its building, under its layer's top, inside its bounds,
  // cheap in brushes; never enterable (it holds no room, no home and no door: the counts above never see it)
  if (AR?.dimensions.towers) {
    const TW = AR.dimensions.towers;
    for (const b of m.buildings.values()) {
      if (!b.tower) continue;
      const L = m.layers.get(b.layer);
      const top = towerTop(b, m);
      // under the sky a tower rises to the sky lid (the layer's `sky`), under a roof to the layer's top
      const lid = lidAt(m, L, b.tower.at ?? b.at);
      const room = lid - TW.topClearance.min / cellM;
      if (top > room + 1e-9) fail.push(`towers: ${b.id}'s tower rises to z ${round(top, 2)}, at most ${round(room, 2)} (${L.id}'s ${roofedAt(m, L, b.tower.at ?? b.at) ? "top" : "sky"} ${lid} less dimensions.towers.topClearance ${TW.topClearance.min} m)`); // prettier-ignore
      const at = b.tower.at ?? b.at;
      const r = rectOf(at, [b.tower.across, b.tower.across]);
      const fp = rectOf(b.at, b.footprint);
      if (r[0] < fp[0] - 1e-9 || r[1] < fp[1] - 1e-9 || r[2] > fp[2] + 1e-9 || r[3] > fp[3] + 1e-9) fail.push(`towers: ${b.id}'s tower (${b.tower.across} across at [${at}]) stands past its building's footprint`); // prettier-ignore
      if (r[0] < L.bounds[0] || r[1] < L.bounds[1] || r[2] > L.bounds[2] || r[3] > L.bounds[3]) fail.push(`towers: ${b.id}'s tower stands past ${L.id}'s bounds [${L.bounds}]`); // prettier-ignore
      const cost = towerCost(b, { ...ESTIMATE, ...(desc.engine.estimate ?? {}) });
      if (cost.brushes > TW.maxBrushes) fail.push(`towers: ${b.id}'s tower costs ${cost.brushes} brushes, at most ${TW.maxBrushes} (dimensions.towers.maxBrushes: a shell, not rooms)`); // prettier-ignore
    }
  }
  // stairs on the axes (the rulebook's circulation.axial): a stair between stops on neither axis is built as an L of
  // two axial legs turning at a landing, whose arms are the stops' offsets: its length, with an exit's reach at
  // each end, must hold them
  if (AR?.circulation.axial) {
    const AX = AR.circulation.axial;
    for (const c of m.connectors) {
      if (!AX.kinds.includes(c.type) || AX.exempt.includes(c.type)) continue;
      for (const l of c.links) {
        const [a, b] = [m.posOf(l.lo), m.posOf(l.hi)];
        const [dx, dy] = [Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])];
        if (dx < 1e-6 || dy < 1e-6) continue;
        if (dx + dy > l.length + 2 * EXIT_REACH + 1e-6) fail.push(`axial: ${c.id} joins ${l.lo} and ${l.hi}, ${round(dx, 1)} and ${round(dy, 1)} cells apart on the two axes: an L along them is ${round(dx + dy, 1)} cells, more than its ${l.length} and an exit's reach (${EXIT_REACH}) at each end (circulation.axial: no diagonal run)`); // prettier-ignore
      }
    }
  }
  const aptDistricts = new Set([...m.buildings.values()].filter((b) => b.type === "apartment").map((b) => b.district));
  if (aptDistricts.size / m.districts.size > (RD.maxApartmentDistrictShare ?? 1)) fail.push(`density: apartment blocks stand in ${aptDistricts.size} of ${m.districts.size} districts, at most ${round(RD.maxApartmentDistrictShare * 100, 0)} %`); // prettier-ignore

  // 9. the MSR's network: service hallways, its lifts, its buildings' passages
  const msr = adjacency(m.edges, (e) => !e.secret && e.access === "msr");
  const nexusId = R.msr?.nexus;
  const msrReached = nexusId ? reach(msr, [`b:${nexusId}`]) : new Set();
  for (const s of m.segments.values())
    if (s.class === "service" && s.access !== "msr") fail.push(`service: ${s.id} is a service hallway open to the ${s.access}`); // prettier-ignore

  // 10. checkpoints and cells
  const RK = R.checkpoints ?? {};
  const controlled = new Set(m.checkpoints.flatMap((k) => k.controls));
  for (const k of m.checkpoints) {
    for (const [kind, want] of Object.entries(RK.program ?? {}))
      if ((k.program?.[kind] ?? 0) < want) fail.push(`checkpoints: ${k.id} has ${k.program?.[kind] ?? 0} ${kind}, wanted ${want}`); // prettier-ignore
    if (nexusId && !msrReached.has(`n:${k.node}`)) fail.push(`checkpoints: ${k.id} at ${k.node} is not on the MSR's service network from ${nexusId}`); // prettier-ignore
    for (const c of k.controls) {
      const conn = m.connectors.find((x) => x.id === c);
      if (conn && !conn.stops.includes(k.node)) fail.push(`checkpoints: ${k.id} stands at ${k.node}, not at a stop of ${c}`); // prettier-ignore
    }
  }
  for (const p of pairs) {
    const [loId] = p.pair.split("-");
    const n = m.connectors.filter((c) => c.access === "public" && c.type !== "secret" && controlled.has(c.id) && c.links.some((l) => m.layerOf(l.lo) === loId)).length; // prettier-ignore
    p.checkpointed = n;
    if (n < (RK.minPerPair ?? 0)) fail.push(`checkpoints: ${p.pair} has ${n} connectors under a checkpoint, wanted ${RK.minPerPair}`); // prettier-ignore
  }
  for (const g of gates) if (RK.gate && !controlled.has(g.id)) fail.push(`checkpoints: the gate ${g.id} has no checkpoint`);
  // a gated layer (the upper city): every public way arriving on it is under a checkpoint
  for (const L of layersByLevel.filter((x) => x.gated))
    for (const c of m.connectors) {
      if (c.access !== "public" || c.type === "secret" || controlled.has(c.id)) continue;
      const arrives = c.links.find((l) => m.layerOf(l.hi) === L.id || m.layerOf(l.lo) === L.id);
      if (arrives) fail.push(`checkpoints: ${c.id} is a public way onto the gated layer ${L.id} (at ${m.layerOf(arrives.hi) === L.id ? arrives.hi : arrives.lo}) that no checkpoint controls`); // prettier-ignore
    }
  if (nexusId) {
    const nexus = m.buildings.get(nexusId);
    if (!nexus) fail.push(`msr: the nexus ${nexusId} is no building`);
    else {
      const cells = nexus.program.cell ?? 0;
      if (cells < (R.msr?.nexusCells ?? 0)) fail.push(`msr: the Nexus holds ${cells} cells, wanted ${R.msr.nexusCells} (the main jail)`); // prettier-ignore
      const levels = new Set([...msrReached].map((v) => m.vertexLayer(v)).filter(Boolean));
      for (const L of R.msr?.reachesLayers ?? []) if (!levels.has(L)) fail.push(`msr: the Nexus does not reach ${L} by its own lifts and hallways`); // prettier-ignore
      for (const b of R.msr?.reachesBuildings ?? []) if (!msrReached.has(`b:${b}`)) fail.push(`msr: the Nexus does not lead to ${b} by the MSR's own ways`); // prettier-ignore
    }
  }
  const holding = m.checkpoints.reduce((s, k) => s + Object.entries(k.program ?? {}).reduce((t, [kind, v]) => t + (kind === "holding-cell" ? v : 0), 0), 0); // prettier-ignore

  // 11. required places
  for (const r of desc.required ?? []) {
    let program = null;
    if (r.building) program = m.buildings.get(r.building).program;
    if (r.node) {
      const cp = m.checkpoints.filter((k) => k.node === r.node);
      program = {};
      for (const k of cp) for (const [kind, v] of Object.entries(k.program ?? {})) program[kind] = (program[kind] ?? 0) + v;
      for (const [kind, v] of Object.entries(m.nodes.get(r.node).program ?? {})) program[kind] = (program[kind] ?? 0) + v;
      if (r.outside && !m.nodes.get(r.node).outside) fail.push(`required: ${r.id} (${r.node}) does not lead outside`);
    }
    if (r.type) {
      const bs = [...m.buildings.values()].filter((b) => b.type === r.type && (!r.district || b.district === r.district));
      if (bs.length < (r.min ?? 1)) fail.push(`required: ${r.id} wants ${r.min ?? 1} ${r.type} building(s)${r.district ? ` in ${r.district}` : ""}, found ${bs.length}`); // prettier-ignore
      for (const [cls, want] of Object.entries(r.units ?? {})) {
        const got = bs.reduce((s, b) => s + (b.homes[cls] ?? 0), 0);
        if (got < want) fail.push(`required: ${r.id} wants ${want} ${cls} homes, found ${got}`);
      }
    } else
      for (const [cls, want] of Object.entries(r.units ?? {})) {
        const got = m.buildings.get(r.building)?.homes[cls] ?? 0;
        if (got < want) fail.push(`required: ${r.id} wants ${want} ${cls} homes, found ${got}`);
      }
    for (const [kind, want] of Object.entries(r.program ?? {}))
      if ((program?.[kind] ?? 0) < want) fail.push(`required: ${r.id} wants ${want} ${kind}, has ${program?.[kind] ?? 0}`); // prettier-ignore
    for (const id of r.reaches ?? []) {
      const from = r.building ? `b:${r.building}` : `n:${r.node}`;
      const all = adjacency(m.edges, (e) => !e.secret);
      if (!reach(all, [from]).has(m.vertexOf(id))) fail.push(`required: ${r.id} does not lead to ${id}`);
    }
  }

  // 12. secrets
  const RS = R.secrets ?? {};
  const doors = m.secrets.filter((s) => s.kind === "door");
  const passages = m.secrets.filter((s) => s.kind === "passage");
  const secretConnectors = m.connectors.filter((c) => c.type === "secret");
  if (doors.length < (RS.minDoors ?? 0)) fail.push(`secrets: ${doors.length} secret doors, wanted ${RS.minDoors}`);
  if (passages.length + secretConnectors.length < (RS.minPassages ?? 0)) fail.push(`secrets: ${passages.length + secretConnectors.length} secret passages (and secret connectors), wanted ${RS.minPassages}`); // prettier-ignore
  for (const L of m.layers.keys()) {
    const n = m.secrets.filter((s) => s.layer === L).length + secretConnectors.filter((c) => c.stops.some((s) => m.layerOf(s) === L)).length; // prettier-ignore
    if (n < (RS.minPerLayer ?? 0)) fail.push(`secrets: ${L} has ${n} secrets, wanted ${RS.minPerLayer}`);
  }
  if (RS.minInNexus && nexusId) {
    const n = doors.filter((s) => s.in === nexusId).length;
    if (n < RS.minInNexus) fail.push(`secrets: the Nexus has ${n} secret doors, wanted ${RS.minInNexus} (its upper hallways)`); // prettier-ignore
  }
  const homesShops = doors.filter((s) => ["house", "apartment", "manor", "huts", "shop", "double-shop", "bar"].includes(m.buildings.get(s.in).type)).length; // prettier-ignore
  if (homesShops < (RS.minInHomesAndShops ?? 0)) fail.push(`secrets: ${homesShops} secret doors in homes and shops, wanted ${RS.minInHomesAndShops}`); // prettier-ignore
  for (const s of passages) if (!reached.has(m.vertexOf(s.from)) && !reached.has(m.vertexOf(s.to))) fail.push(`secrets: neither end of ${s.id} is reached by public ways (nobody can find it)`); // prettier-ignore
  for (const c of secretConnectors) if (!c.stops.some((s) => reached.has(m.vertexOf(s)))) fail.push(`secrets: no stop of ${c.id} is reached by public ways`); // prettier-ignore
  const all = adjacency(m.edges, (e) => e.access === "public" || e.secret);
  const withSecrets = reach(all, start ? [`n:${start}`] : []);
  for (const s of doors) if (!withSecrets.has(`h:${s.id}`)) fail.push(`secrets: the room behind ${s.id} cannot be reached`);

  // 12b. what roleplay needs and the old build's root causes (levels/notes-h9.md section 5)
  const sizes = { ...ROOM_SIZES, ...(desc.roomSizes ?? {}) };
  const RR = R.rooms ?? {};
  const roomSides = [];
  const roomAreas = [];
  for (const b of m.buildings.values()) {
    if (!b.interior) continue;
    for (const [kind, n] of Object.entries(b.program)) {
      const [w, d] = sizes[kind] ?? [2, 3];
      const small = (RR.small ?? []).includes(kind);
      const minSide = small ? (RR.minSideSmall ?? 0) : (RR.minSide ?? 0);
      if (Math.min(w, d) < minSide) fail.push(`rooms: ${b.id}'s ${kind} is ${w}x${d} cells, its narrow side under ${minSide}`); // prettier-ignore
      for (let i = 0; i < n; i++) roomSides.push(Math.sqrt(w * d)), roomAreas.push(w * d);
    }
  }
  const medianRoomSide = median(roomSides) ?? 0;
  if (medianRoomSide * desc.grid.cellUnits < (RR.medianSideUnits ?? 0)) fail.push(`rooms: the median room is ${round(medianRoomSide * desc.grid.cellUnits, 0)} units across, wanted ${RR.medianSideUnits} (the source cities' rooms are 200-600)`); // prettier-ignore
  // enterable fronts: a share of the lots, never every front
  const lots = (desc.blocks ?? []).reduce((s, bl) => s + bl.lots, 0);
  const enterableCount = [...m.buildings.values()].filter((b) => b.interior).length;
  const lotShare = lots ? enterableCount / lots : 1;
  if (RB.maxEnterableLotShare !== undefined && lotShare > RB.maxEnterableLotShare) fail.push(`buildings: ${enterableCount} of ${lots} lots are enterable (${round(lotShare * 100, 0)} %), at most ${round(RB.maxEnterableLotShare * 100, 0)} %: the rest are facades`); // prettier-ignore
  // homes over businesses
  const BUSINESS = R.housing?.businessTypes ?? ["shop", "double-shop", "workshop", "bar", "factory"];
  const businesses = [...m.buildings.values()].filter((b) => b.interior && BUSINESS.includes(b.type)).reduce((s, b) => s + (b.type === "double-shop" ? 2 : 1), 0); // prettier-ignore
  const homeShare = homes / Math.max(1, homes + businesses);
  if (homeShare < (RH.minHomeShare ?? 0)) fail.push(`housing: homes are ${round(homeShare * 100, 0)} % of the properties (${homes} homes, ${businesses} businesses), wanted ${round(RH.minHomeShare * 100, 0)} %`); // prettier-ignore
  // every property door named once (the key an RP plugin hands out)
  const naming = desc.housing.doorNaming ?? {};
  const doorNames = [];
  const fill = (pattern, vars) => pattern.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
  for (const b of m.buildings.values()) {
    if (!b.interior) continue;
    let unit = 0;
    for (const [cls, n] of Object.entries(b.homes)) for (let i = 0; i < n; i++) doorNames.push(fill(naming.home ?? "", { building: b.id, unit: ++unit, class: cls })); // prettier-ignore
    if (!b.residential) doorNames.push(fill(naming.business ?? "", { building: b.id }));
    for (let i = 1; i <= (b.program.cell ?? 0); i++) doorNames.push(fill(naming.cell ?? "", { place: b.id, n: i }));
  }
  for (const k of m.checkpoints) for (let i = 1; i <= (k.program?.["holding-cell"] ?? 0); i++) doorNames.push(fill(naming.cell ?? "", { place: k.id, n: i })); // prettier-ignore
  const nameSeen = new Map();
  for (const n of doorNames) nameSeen.set(n, (nameSeen.get(n) ?? 0) + 1);
  const twice = [...nameSeen].filter(([, c]) => c > 1).map(([n]) => n);
  if (!naming.home || !naming.home.includes("{building}") || !naming.home.includes("{unit}")) fail.push("doors: housing.doorNaming.home wants a pattern with {building} and {unit}"); // prettier-ignore
  if (!naming.business || !naming.business.includes("{building}")) fail.push("doors: housing.doorNaming.business wants a pattern with {building}"); // prettier-ignore
  if (!naming.cell || !naming.cell.includes("{place}") || !naming.cell.includes("{n}")) fail.push("doors: housing.doorNaming.cell wants a pattern with {place} and {n}"); // prettier-ignore
  if (twice.length) fail.push(`doors: door names given twice: ${twice.slice(0, 8).join(", ")}${twice.length > 8 ? ` and ${twice.length - 8} more` : ""}`); // prettier-ignore
  const longNames = doorNames.filter((n) => n.length > (R.doors?.maxNameLength ?? Infinity));
  if (longNames.length) fail.push(`doors: ${longNames.length} door names are over ${R.doors.maxNameLength} characters (${longNames[0]})`); // prettier-ignore
  // spawns and wiring
  const spawns = desc.spawns?.count ?? 0;
  if (spawns < (R.spawns?.min ?? 0)) fail.push(`spawns: ${spawns} spawn points, wanted ${R.spawns.min} (32 a side; TS reads the first 32 it finds)`); // prettier-ignore
  for (const [k, band] of Object.entries(R.wiring ?? {})) {
    const v = desc.wiring?.[k] ?? 0;
    if (band.min !== undefined && v < band.min) fail.push(`wiring: ${k} ${v}, wanted at least ${band.min}`);
    if (band.max !== undefined && v > band.max) fail.push(`wiring: ${k} ${v}, at most ${band.max}`);
  }
  const liftCount = m.connectors.filter((c) => c.type === "lift").length;
  if (liftCount < (R.lifts?.min ?? 0)) fail.push(`lifts: ${liftCount} lifts, wanted ${R.lifts.min}`);
  if (R.lifts?.multiStop && !m.connectors.some((c) => c.type === "lift" && c.stops.length > 2)) fail.push("lifts: no lift with more than two stops"); // prettier-ignore
  // the MSR's hallways: short runs with something off them, never 58,000 units of one corridor
  const RM = R.msr ?? {};
  const service = [...m.segments.values()].filter((s) => s.class === "service");
  const serviceTotal = service.reduce((s, x) => s + x.length, 0);
  for (const s of service) if (s.length > (RM.maxServiceRun ?? Infinity)) fail.push(`msr: service hallway ${s.id} runs ${round(s.length, 1)} cells with nothing off it, at most ${RM.maxServiceRun} (break it with a room, a post or a stair)`); // prettier-ignore
  if (serviceTotal > (RM.maxServiceTotal ?? Infinity)) fail.push(`msr: ${round(serviceTotal, 0)} cells of service hallway, at most ${RM.maxServiceTotal}`); // prettier-ignore
  // checkpoints placed by need: each says why, and controls a connector, the gate or a district border
  for (const k of m.checkpoints) {
    if (typeof k.reason !== "string" || !k.reason) fail.push(`checkpoints: ${k.id} gives no reason (placed by policing need, not by geometry)`); // prettier-ignore
    for (const c of k.controls) {
      const seg = m.segments.get(c);
      if (seg) {
        const [da, db] = [m.nodes.get(seg.from).district, m.nodes.get(seg.to).district];
        if (!da || !db || da === db) fail.push(`checkpoints: ${k.id} controls ${c}, which crosses no district border`); // prettier-ignore
      }
    }
  }
  if (m.checkpoints.length > (RK.max ?? Infinity)) fail.push(`checkpoints: ${m.checkpoints.length}, at most ${RK.max}`); // prettier-ignore

  // 13. tiles: placement, seams and portals, each tile walked on its own
  const RT = R.tiles ?? {};
  const tileOf = new Map();
  for (const n of m.nodes.values()) {
    const t = tiles.of(n.at);
    if (!t) fail.push(`tiles: node ${n.id} at [${n.at}] is outside every tile`);
    tileOf.set(`n:${n.id}`, t);
    if (tiles.seamDistance(n.at) < (RT.seamMargin ?? 0)) fail.push(`tiles: node ${n.id} stands ${round(tiles.seamDistance(n.at))} cells from a seam, at least ${RT.seamMargin}`); // prettier-ignore
  }
  for (const b of m.buildings.values()) {
    const [w, d] = b.footprint;
    const [hw, hd] = [w / 2, d / 2]; // the footprint as drawn: w along x, d along y
    const corners = [[b.at[0] - hw, b.at[1] - hd], [b.at[0] + hw - 1e-6, b.at[1] + hd - 1e-6], [b.at[0] - hw, b.at[1] + hd - 1e-6], [b.at[0] + hw - 1e-6, b.at[1] - hd]]; // prettier-ignore
    const ts = new Set(corners.map((c) => tiles.of(c)));
    if (ts.size > 1 || ts.has(null)) fail.push(`tiles: ${b.id} (${w}x${d} at [${b.at}]) crosses a seam (${[...ts].join(", ")}); a building is one tile's`); // prettier-ignore
    tileOf.set(`b:${b.id}`, tiles.of(b.at));
  }
  for (const s of m.secrets) if (s.kind === "door") tileOf.set(`h:${s.id}`, tiles.of(m.buildings.get(s.in).at));
  const portals = desc.tiles.portals ?? [];
  const usedPortals = new Set();
  const crossingsAll = [];
  const tol = RT.portalTolerance ?? 1.5;
  for (const s of m.segments.values()) {
    const a = m.nodes.get(s.from).at;
    const b = m.nodes.get(s.to).at;
    tileOf.set(`s:${s.id}`, tiles.of(s.mid));
    for (const x of tiles.crossings(a, b)) {
      crossingsAll.push({ segment: s.id, ...x });
      const p = portals.findIndex((p) => p.segment === s.id && Math.hypot(p.at[0] - x.at[0], p.at[1] - x.at[1]) <= tol);
      if (p < 0) fail.push(`tiles: ${s.id} crosses the seam ${x.from}|${x.to} at [${x.at.map((v) => round(v, 1))}] with no portal`); // prettier-ignore
      else usedPortals.add(p);
    }
  }
  for (const c of m.connectors) {
    const ts = new Set(c.stops.map((s) => tiles.of(m.posOf(s))));
    if (ts.size > 1) {
      const ps = portals.map((p, i) => (p.connector === c.id ? i : -1)).filter((i) => i >= 0);
      if (!ps.length) fail.push(`tiles: connector ${c.id} joins tiles ${[...ts].join(", ")} with no portal`);
      else ps.forEach((i) => usedPortals.add(i));
    }
  }
  for (const s of passages) {
    const ts = new Set([s.from, s.to].map((e) => tiles.of(m.posOf(e))));
    if (ts.size > 1) {
      const ps = portals.map((p, i) => (p.secret === s.id ? i : -1)).filter((i) => i >= 0);
      if (!ps.length) fail.push(`tiles: secret passage ${s.id} joins tiles ${[...ts].join(", ")} with no portal`);
      else ps.forEach((i) => usedPortals.add(i));
    }
  }
  for (const b of m.buildings.values())
    for (const ps of b.passages ?? []) {
      const ts = new Set([b.at, m.posOf(ps.to)].map((p) => tiles.of(p)));
      if (ts.size > 1) {
        const pp = portals.map((p, i) => (p.passage === `${b.id}>${ps.to}` ? i : -1)).filter((i) => i >= 0);
        if (!pp.length) fail.push(`tiles: passage ${b.id} > ${ps.to} joins tiles ${[...ts].join(", ")} with no portal`);
        else pp.forEach((i) => usedPortals.add(i));
      }
    }
  portals.forEach((p, i) => usedPortals.has(i) || fail.push(`tiles: portal ${p.id ?? i} matches no crossing (stale: move it or drop it)`)); // prettier-ignore
  // each tile alone: every place in it reaches one of its portals (or the gate) inside the tile
  const tileReport = [];
  for (const t of tiles.all) {
    const inTile = [...tileOf].filter(([, tt]) => tt === t).map(([v]) => v).filter((v) => !v.startsWith("h:"));
    if (!inTile.length) {
      tileReport.push({ tile: t, things: 0 });
      continue;
    }
    const set = new Set(inTile);
    const adj = new Map();
    const seeds = new Set();
    const addE = (a, b) => ((adj.get(a) ?? adj.set(a, []).get(a)).push(b), (adj.get(b) ?? adj.set(b, []).get(b)).push(a)); // prettier-ignore
    for (const e of m.edges) {
      if (e.secret) continue;
      const [ia, ib] = [set.has(e.a), set.has(e.b)];
      if (ia && ib) addE(e.a, e.b);
      else if (ia || ib) seeds.add(ia ? e.a : e.b); // the edge leaves the tile: a portal (or a connector's stop)
    }
    if (start && set.has(`n:${start}`)) seeds.add(`n:${start}`);
    const got = new Set(seeds);
    const q = [...seeds];
    while (q.length) for (const n of adj.get(q.shift()) ?? []) if (!got.has(n)) got.add(n), q.push(n);
    const lost = inTile.filter((v) => !got.has(v));
    if (lost.length && seeds.size) fail.push(`tiles: in ${t}, ${lost.map((v) => v.slice(2)).join(", ")} reach none of the tile's portals`); // prettier-ignore
    tileReport.push({ tile: t, things: inTile.length, portals: seeds.size, cutOff: lost.length });
  }

  // 13b. placement on the plan (the same positions the plan pictures draw: a footprint centred on `at`, w along x;
  // a way a straight band of its width from node to node, cut at a plaza's edge; a sized node a rectangle)
  const RPL = { maxDoorGap: 1, overlap: 0.25, ...(R.placement ?? {}) };
  const placement = placementFaults(m, RPL);
  fail.push(...placement);

  // 14. the engine's budget, whole city and by tile
  const budget = estimateBudget(m, tiles);
  const limits = desc.engine.limits ?? {};
  const budgetRows = [];
  const RE = R.engine ?? {};
  for (const [k, lim] of Object.entries(limits)) {
    const value = budget.total[k];
    if (value === undefined || !(lim?.value > 0)) continue;
    const share = value / lim.value;
    budgetRows.push({ limit: k, estimate: value, max: lim.value, share: round(share), provisional: Boolean(lim.provisional) }); // prettier-ignore
    if (share > 1) fail.push(`engine: ${k} estimated ${value}, over the ${lim.target ? "target" : "limit"} ${lim.value}${lim.provisional ? " (a provisional limit)" : ""}`); // prettier-ignore
    else if (share > (RE.warnShare ?? 0.8)) note.push(`engine: ${k} estimated ${value} is ${round(share * 100, 0)} % of the limit ${lim.value}`); // prettier-ignore
  }
  for (const [t, part] of budget.byTile) {
    const row = tileReport.find((r) => r.tile === t);
    row.budget = {};
    for (const k of RT.budgeted ?? ["faces", "brushes", "leaves", "entities", "clipnodes", "brushModels", "lightdataBytes", "structural", "rock"]) {
      const lim = limits[k]?.value;
      if (!(lim > 0) || part[k] === undefined) continue;
      const share = part[k] / lim;
      row.budget[k] = round(share, 3);
      if (share > (RT.maxShare ?? 1)) fail.push(`tiles: ${t} takes ${round(share * 100, 0)} % of the ${k} limit (${part[k]} of ${lim}), a tile at most ${round(RT.maxShare * 100, 0)} %`); // prettier-ignore
    }
  }

  // 14b. the carve: distinct heights per tile and layer (the rock grows with them)
  const maxHeights = R.rock?.maxHeights ?? {};
  for (const c of budget.cuts) {
    const max = maxHeights[c.layer];
    if (max !== undefined && c.heights > max) fail.push(`rock: ${c.tile} on ${c.layer} is carved at ${c.heights} distinct floor and ceiling heights (on the half-storey grid), at most ${max}`); // prettier-ignore
  }
  // the sky lid inside the engine's extent (z from the world's origin at z 0)
  for (const L of m.layers.values()) {
    const lid = skyOf(L) * desc.grid.cellUnits;
    if (limits.extent?.value > 0 && lid > limits.extent.value) fail.push(`sky: ${L.id}'s sky at z ${skyOf(L)} (${lid} units) is past engine.limits.extent ${limits.extent.value}`); // prettier-ignore
  }
  const coreTile = Object.entries(desc.tiles.names ?? {}).find(([, n]) => /core/i.test(n))?.[0] ?? null;
  const rock = {
    provisional: Boolean({ ...ESTIMATE.rock, ...(desc.engine.estimate?.rock ?? {}) }.provisional),
    total: budget.total.rock,
    shellWalls: budget.total.shellWalls,
    towers: budget.total.towers, // a tower's shell: structural too (it hides what stands behind it)
    structural: budget.total.structural,
    byTile: Object.fromEntries([...budget.byTile].map(([tl, p]) => [tl, { rock: p.rock, structural: p.structural }])),
    core: coreTile ? { tile: coreTile, rock: budget.byTile.get(coreTile).rock, structural: budget.byTile.get(coreTile).structural } : null, // prettier-ignore
    cuts: budget.cuts,
  };

  // 15. measures (for bands and the report)
  const lifts = m.connectors.filter((c) => c.type === "lift").length;
  const widths = [];
  for (const s of m.segments.values()) if (s.class !== "service") for (let i = 0; i < Math.round(s.length); i++) widths.push(s.width); // prettier-ignore
  const gateDist = dijkstra(adjacency(m.edges, publicEdge), start ? [`n:${start}`] : []);
  const farthest = Math.max(0, ...[...m.buildings.keys()].map((b) => gateDist.get(`b:${b}`) ?? 0));
  const cu = desc.grid.cellUnits;
  const walkedCells = [...m.segments.values()].filter((s) => s.class !== "service").reduce((s, x) => s + x.length * x.width, 0) + [...m.nodes.values()].filter((n) => n.kind === "plaza").reduce((s, n) => s + n.size[0] * n.size[1], 0); // prettier-ignore
  const metrics = {
    layers: m.layers.size,
    districts: m.districts.size,
    buildings: m.buildings.size,
    enterable: Object.values(enterable).reduce((s, n) => s + n, 0),
    enterableMaxPerLayer: Math.max(...Object.values(enterable)),
    homes,
    segments: m.segments.size,
    plazas: [...m.nodes.values()].filter((n) => n.kind === "plaza").length,
    connectors: m.connectors.length,
    lifts,
    checkpoints: m.checkpoints.length,
    holdingCells: holding,
    secrets: m.secrets.length + secretConnectors.length,
    doors: budget.total.doors,
    faces: budget.total.faces,
    entities: budget.total.entities,
    extentUnits: budget.total.extent,
    heightSpreadUnits: budget.total.height,
    wayWidthMedianUnits: median(widths) * cu,
    walkedAreaM2: round(walkedCells * desc.grid.cell * desc.grid.cell, 0),
    gateToFarthestCells: round(farthest, 1),
    walkP90Cells,
    rockBrushes: budget.total.rock,
    structuralBrushes: budget.total.structural,
    medianRoomSideUnits: round(medianRoomSide * cu, 0),
    enterableLotShare: round(lotShare),
    homeShare: round(homeShare),
    doorNames: doorNames.length,
    spawns,
    serviceHallwayCells: round(serviceTotal, 0),
    cells: holding + [...m.buildings.values()].reduce((s, b) => s + (b.program.cell ?? 0), 0),
    switches: desc.wiring?.switches ?? 0,
    shops: [...m.buildings.values()].filter((b) => b.interior && ["shop", "double-shop", "bar"].includes(b.type)).length, // prettier-ignore
    medianRoomAreaM2: round(median(roomAreas) * desc.grid.cell * desc.grid.cell, 1),
    medianPlazaAreaM2: round((median([...m.nodes.values()].filter((n) => n.kind === "plaza").map((n) => n.size[0] * n.size[1])) ?? 0) * desc.grid.cell * desc.grid.cell, 0), // prettier-ignore
    alleyWidthM: round((median([...m.segments.values()].filter((s) => s.class === "alley").map((s) => s.width)) ?? 0) * desc.grid.cell, 2), // prettier-ignore
  };
  return {
    metrics,
    failures: fail,
    notes: note,
    reach: { start, unreached },
    vehicle,
    pairs,
    walk,
    supply,
    enterable,
    overlap,
    meanWear: Object.fromEntries(layersByLevel.map((L, i) => [L.id, round(meanWear[i])])),
    tiles: tileReport,
    crossings: crossingsAll.length,
    portals: portals.length,
    budget: { total: budget.total, rows: budgetRows, leavesCalibrated: Boolean({ ...ESTIMATE, ...(desc.engine.estimate ?? {}) }.leavesCalibrated) },
    rock,
    walkP90Cells,
  };
}

/**
 * The seam portals of a valid city description, from its streets and its tile grid (levels/tools/city-portals.mjs
 * writes them into `tiles.portals`): every place a segment's straight line crosses a seam, at the crossing
 * (rounded to 0.1 cell), id `p_<segment>` (`_1`, `_2` ... in order along it when it crosses more than one);
 * every connector, secret passage and building passage (the MSR's and the others) whose ends stand in two
 * tiles, id `p_<connector or secret>` or `p_<building>_<to>`. Each carries `seam: "<tile>|<tile>"`. In the order
 * of the description (segments, connectors, secret passages, buildings' passages), so the same description gives
 * the same list, byte for byte. Throws if the description is not valid.
 */
export function cityPortals(desc) {
  const m = measureCity(desc);
  const tiles = tiler(desc);
  const r1 = (v) => Math.round(v * 10) / 10;
  const portals = [];
  for (const s of m.segments.values()) {
    const xs = tiles.crossings(m.nodes.get(s.from).at, m.nodes.get(s.to).at);
    xs.forEach((x, i) => portals.push({ id: `p_${s.id}${xs.length > 1 ? `_${i + 1}` : ""}`, segment: s.id, at: x.at.map(r1), seam: `${x.from}|${x.to}` })); // prettier-ignore
  }
  // a connector, secret passage or building passage whose ends stand in two tiles: a portal at each seam the
  // straight line between its stops crosses, named by the two tiles that seam parts (a corner crossed: two portals)
  const across = (key, id, points) => {
    if (new Set(points.map((p) => tiles.of(p))).size < 2) return;
    const xs = [];
    for (let i = 1; i < points.length; i++) xs.push(...tiles.crossings(points[i - 1], points[i]));
    xs.forEach((x, i) => portals.push({ id: `p_${id}${xs.length > 1 ? `_${i + 1}` : ""}`, [key]: id, seam: `${x.from}|${x.to}`, at: x.at.map(r1) })); // prettier-ignore
  };
  for (const c of m.connectors) across("connector", c.id, c.stops.map((s) => m.posOf(s)));
  for (const s of m.secrets) if (s.kind === "passage") across("secret", s.id, [m.posOf(s.from), m.posOf(s.to)]);
  for (const b of m.buildings.values())
    for (const ps of b.passages ?? []) {
      const pts = [b.at, m.posOf(ps.to)];
      if (new Set(pts.map((p) => tiles.of(p))).size < 2) continue;
      const xs = tiles.crossings(pts[0], pts[1]);
      xs.forEach((x, i) => portals.push({ id: `p_${b.id}_${ps.to}${xs.length > 1 ? `_${i + 1}` : ""}`, passage: `${b.id}>${ps.to}`, seam: `${x.from}|${x.to}`, at: x.at.map(r1) })); // prettier-ignore
    }
  return portals;
}

/**
 * What changes between two portal lists, matched by id: { added, removed, changed: [{ id, from, to }], same }
 * (`same` a count). A portal is changed when anything in it differs (its position, its seam, what crosses).
 */
export function diffPortals(before = [], after = []) {
  const key = (p) => JSON.stringify(Object.keys(p).sort().map((k) => [k, p[k]]));
  const old = new Map(before.map((p) => [p.id, p]));
  const now = new Map(after.map((p) => [p.id, p]));
  const added = after.filter((p) => !old.has(p.id));
  const removed = before.filter((p) => !now.has(p.id));
  const changed = after.filter((p) => old.has(p.id) && key(old.get(p.id)) !== key(p)).map((p) => ({ id: p.id, from: old.get(p.id), to: p })); // prettier-ignore
  return { added, removed, changed, same: after.length - added.length - changed.length };
}

/**
 * Checks a city description: valid, then every rule, then each metric `bands` names. Returns { pass, failures,
 * notes, results, analysis }.
 */
export function checkCity(desc, bands = null) {
  const { errors, warnings } = validateCity(desc);
  if (errors.length) return { pass: false, failures: errors.map((e) => `invalid: ${e}`), notes: warnings, results: [], analysis: null }; // prettier-ignore
  const a = analyseCity(desc);
  const failures = [...a.failures];
  const notes = [...warnings, ...a.notes];
  const results = [];
  for (const [metric, band] of Object.entries(bands?.metrics ?? {})) {
    const value = a.metrics[metric];
    const held = holdToBand(value ?? null, band);
    results.push({ metric, value: value ?? null, band, ...held });
    if (held.verdict === "fail") failures.push(`band: ${metric} ${held.say}${band.note ? ` (${band.note})` : ""}`);
    else if (held.verdict === "edge") notes.push(`band: ${metric} ${held.say}`);
  }
  return { pass: failures.length === 0, failures, notes, results, analysis: a };
}

/** The check in a few lines: PASS or FAIL, the headline numbers, the failures, the notes when asked. */
export function describeCityCheck(result, { name = "city", bandsName = null, verbose = false } = {}) {
  const lines = [];
  const a = result.analysis;
  lines.push(`${result.pass ? "PASS" : "FAIL"}  ${name}${bandsName ? `  (bands: ${bandsName})` : ""}`);
  if (a) {
    const mm = a.metrics;
    lines.push(`  ${mm.layers} layers, ${mm.districts} districts, ${mm.enterable} enterable buildings (most on a layer ${mm.enterableMaxPerLayer}), ${mm.homes} homes, ${mm.plazas} plazas, ${mm.connectors} connectors (${mm.lifts} lifts), ${mm.checkpoints} checkpoints, ${mm.secrets} secrets`); // prettier-ignore
    lines.push(`  between layers: ${a.pairs.map((p) => `${p.pair} ${p.public} public (${p.types.join(", ")}), ${p.checkpointed} checkpointed, ${p.msr} MSR, ${p.secret} secret`).join("; ")}`); // prettier-ignore
    lines.push(`  farthest walk to a connector: ${a.walk.map((w) => `${w.layer} ${w.distance} (${w.worst})`).join(", ")}; p90 from public floor ${a.walkP90Cells ?? "unbounded"} (${a.walk.map((w) => `${w.layer} ${w.p90 ?? "unbounded"}`).join(", ")})`); // prettier-ignore
    if (a.vehicle) lines.push(`  vehicles: ${a.vehicle.segments} road segments over ${a.vehicle.layers.join(", ")}, ${a.vehicle.turns.length} turns held`); // prettier-ignore
    lines.push(`  budget: ${a.budget.rows.map((r) => `${r.limit} ${r.estimate}/${r.max} (${Math.round(r.share * 100)} %${r.provisional ? ", provisional" : ""}${r.limit === "leaves" && !a.budget.leavesCalibrated ? ", UNCALIBRATED: the larger of 1.5 a brush besides the rock and 2.2 a structural brush, until the Core tile is compiled" : ""})`).join(", ")}`); // prettier-ignore
    const rk = a.rock;
    lines.push(`  rock${rk.provisional ? " (provisional coefficients)" : ""}: ${rk.total} carved, structural ${rk.structural} (with ${rk.shellWalls} shell walls); by tile ${Object.entries(rk.byTile).map(([tl, p]) => `${tl} ${p.rock}`).join(", ")}${rk.core ? `; the Core (${rk.core.tile}) rock ${rk.core.rock}, structural ${rk.core.structural}` : ""}`); // prettier-ignore
    lines.push(`  tiles: ${a.tiles.filter((t) => t.things).length} used, ${a.portals} portals for ${a.crossings} street crossings; ${a.tiles.filter((t) => t.things).map((t) => `${t.tile} faces ${Math.round((t.budget?.faces ?? 0) * 100)} %`).join(", ")}`); // prettier-ignore
  }
  for (const f of result.failures) lines.push(`  FAIL  ${f}`);
  if (verbose || !result.pass) for (const n of result.notes) lines.push(`  note  ${n}`);
  return lines.join("\n");
}
