// Level-design measures of one compiled GoldSrc map, and the bands of many: what survey-goldsrc.mjs runs on
// each map of a game. MEASURES ONLY: nothing of the map (geometry, entities, textures) is kept, only
// numbers and the map's name.
//
// It builds on the kit and changes none of it: `readBsp` (src/maps/bsp.mjs) reads the map, `reachOf`
// (src/maps/reach.mjs) walks it from its places to start (graph kept), `measure` (src/maps/measure.mjs)
// measures the walked floor on a grid of 32. What is added here, from the walk's own graph:
//   steps      the rise between two level floors side by side on the walk's grid (8 units), both flat
//   flights    stairs: groups of such steps joined by walked floor, rising 32 or more in all
//   levels     heights of 32 units holding 2% of the walked floor or more (map-character's rule)
//   doors      func_door / func_door_rotating panels, double doors joined, sized from their brush model
//   crossing   the walk from the nearest place to start to the farthest way out (trigger_changelevel, a
//              mod's exit), else to the farthest floor walked; and its ratio to the straight line
//   span       the longest walk across the walked floor (two sweeps of a single-start flood)
//   loops      independent cycles of a coarse region graph (tiles of 256 and 512 units)
// The notes (levels/notes-goldsrc.md) say what each means exactly.
//
//   measureLevel(bytes, { exits, name, city, read })   one map's record; `city: true` adds `city`, a
//                                          role-play city's measures (city-measures.mjs: streets, buildings,
//                                          layers, ...); `read` a map already read (readBsp's shape);
//                                          `cityDetail: true` hangs the cut on `city._detail` (not enumerable)
//   bandOf(values, weights?)               { n, median, q1, q3, p5, p95 } of a list
//   UNIT_M, PLAYER_HEIGHT                  0.0254 m a unit; a standing player is 72 units
import { readBsp, contentsAt, floorUnder, CONTENTS } from "../../src/maps/bsp.mjs";
import { reachOf } from "../../src/maps/reach.mjs";
import { measure } from "../../src/maps/measure.mjs";
import { valueOf, brushModelOf, originOf, vectorOf, numberOf } from "../../src/maps/entities.mjs";
import { cityOf, cityInputOf } from "./city-measures.mjs";

export const UNIT_M = 0.0254;
export const PLAYER_HEIGHT = 72;
/** Floor narrower than this is corridor-like: two player heights. */
export const NARROW = 2 * PLAYER_HEIGHT;
/** The kit's own corridor line (measure.mjs BANDS[0]), kept beside ours. */
const KIT_NARROW = 176;
const STEP_MOST = 18;
/** A floor this flat or flatter (normal z) is level: a step between two such is a riser, not a slope. */
const FLAT = 0.99;
/** A rise this small between two level floors is a kerb or noise of the floor under a body's box, not a step. */
const STEP_LEAST = 4;
/** A flight of stairs rises this much at the least, in all. */
const FLIGHT_LEAST = 32;
const LEVEL_BIN = 32;
const LEVEL_SHARE = 0.02;
const LOOP_TILES = [256, 512];
const SIGHT_LINE = 700;
/** A city whose walk from its starts reaches less of its floor than this is walked from its teleports' ends too. */
const CITY_BOXED = 0.1;

// ── small arithmetic ────────────────────────────────────────────────────────
/** The value a share of the way up, weighted (each value its weight; all 1 when none given), linear. */
function quantile(sorted, share) {
  if (!sorted.length) return null;
  const at = share * (sorted.length - 1);
  const low = Math.floor(at);
  const high = Math.min(sorted.length - 1, low + 1);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}
function weightedQuantile(pairs, share) {
  // pairs sorted by value: [value, weight]
  const total = pairs.reduce((sum, [, w]) => sum + w, 0);
  if (!total) return null;
  let run = 0;
  for (const [value, weight] of pairs) {
    run += weight;
    if (run >= share * total - 1e-12) return value;
  }
  return pairs[pairs.length - 1][0];
}
const round = (value, places = 0) =>
  value === null || value === undefined || !Number.isFinite(value) ? null : Number(value.toFixed(places));

/**
 * The band of a list: n, median, quartiles, the fifth and ninety-fifth hundredths. With `weights`, each
 * value counts by its weight (pooled cells, each map's summing to one: a map, a vote).
 */
export function bandOf(values, weights = null, places = 0) {
  const kept = [];
  values.forEach((value, nth) => {
    if (value !== null && value !== undefined && Number.isFinite(value)) kept.push([value, weights ? weights[nth] : 1]);
  });
  kept.sort((a, b) => a[0] - b[0]);
  const at = weights
    ? (share) => weightedQuantile(kept, share)
    : (share) => quantile(kept.map(([v]) => v), share);
  return {
    n: kept.length,
    median: round(at(0.5), places),
    q1: round(at(0.25), places),
    q3: round(at(0.75), places),
    p5: round(at(0.05), places),
    p95: round(at(0.95), places),
  };
}
/** The same band in metres and in player heights. */
export function inLengths(band) {
  const scaled = (factor, places) =>
    Object.fromEntries(
      ["median", "q1", "q3", "p5", "p95"].map((key) => [key, band[key] === null ? null : round(band[key] * factor, places)]),
    );
  return { n: band.n, units: band, m: scaled(UNIT_M, 2), ph: scaled(1 / PLAYER_HEIGHT, 2) };
}
export function inAreas(band) {
  const scaled = Object.fromEntries(
    ["median", "q1", "q3", "p5", "p95"].map((key) => [key, band[key] === null ? null : round(band[key] * UNIT_M * UNIT_M, 0)]),
  );
  return { n: band.n, m2: scaled };
}
const summary = (list) => {
  const band = bandOf(list);
  return { median: band.median, q1: band.q1, q3: band.q3, p5: band.p5, p95: band.p95 };
};

// ── doors ───────────────────────────────────────────────────────────────────
const DOOR = /^(func_door|func_door_rotating)$/;
/**
 * The doors of a map: each func_door / func_door_rotating brush model's box, made absolute by the entity's
 * origin (a rotating door's model is built about its origin brush). A panel is a doorway's when it stands
 * (64 high or more) and is thin across (no thicker than a third of its width, or 32): lifts, platforms and
 * crushers fail that. Panels side by side (touching within 8, the same height band, thin the same way) are
 * joined: a double door is one opening.
 */
function doorsOf(bsp) {
  const panels = [];
  let all = 0;
  for (const entity of bsp.entities) {
    const classname = valueOf(entity, "classname") ?? "";
    if (!DOOR.test(classname)) continue;
    const number = brushModelOf(entity);
    const model = number === null ? null : bsp.models[number];
    if (!model) continue;
    all++;
    const origin = originOf(entity) ?? [0, 0, 0];
    const min = model.mins.map((value, axis) => value + origin[axis]);
    const max = model.maxs.map((value, axis) => value + origin[axis]);
    const size = max.map((value, axis) => value - min[axis]);
    const thinAxis = size[0] <= size[1] ? 0 : 1;
    const width = Math.max(size[0], size[1]);
    const thickness = Math.min(size[0], size[1]);
    const height = size[2];
    const doorway = height >= 64 && width >= 24 && thickness <= Math.max(32, width / 3);
    if (doorway) panels.push({ min, max, thinAxis, rotating: classname === "func_door_rotating" });
  }
  // join panels that touch along their long axis
  const parent = panels.map((_, nth) => nth);
  const find = (nth) => (parent[nth] === nth ? nth : (parent[nth] = find(parent[nth])));
  const NEAR = 8;
  for (let a = 0; a < panels.length; a++)
    for (let b = a + 1; b < panels.length; b++) {
      const p = panels[a];
      const q = panels[b];
      if (p.thinAxis !== q.thinAxis) continue;
      const long = 1 - p.thinAxis;
      const touches = [0, 1, 2].every((axis) => p.min[axis] - NEAR <= q.max[axis] && q.min[axis] - NEAR <= p.max[axis]);
      const sameBand = Math.abs(p.min[2] - q.min[2]) <= NEAR && Math.abs(p.max[2] - q.max[2]) <= NEAR;
      const side = p.max[long] <= q.min[long] + NEAR || q.max[long] <= p.min[long] + NEAR;
      if (touches && sameBand && side) parent[find(a)] = find(b);
    }
  const groups = new Map();
  panels.forEach((panel, nth) => {
    const root = find(nth);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(panel);
  });
  const openings = [...groups.values()].map((list) => {
    const min = [0, 1, 2].map((axis) => Math.min(...list.map((p) => p.min[axis])));
    const max = [0, 1, 2].map((axis) => Math.max(...list.map((p) => p.max[axis])));
    const size = max.map((value, axis) => value - min[axis]);
    return {
      width: Math.max(size[0], size[1]),
      height: size[2],
      panels: list.length,
      rotating: list.some((p) => p.rotating),
    };
  });
  return { all, panels: panels.length, openings };
}

// ── a map's brush models whose clip hulls point past the file ────────────────
/**
 * The map with each brush model's head in a clip hull that points past the clip nodes (the compiler left
 * that hull out: Master Sword's ms_underworldv2) taken as empty, as a model compiled with no clip hull is
 * (head -1). `repairs` counts them; the map given is not changed.
 */
export function repairedOf(bsp) {
  let repairs = 0;
  const models = bsp.models.map((model) => {
    const heads = model.headNodes.map((head, hull) => {
      if (hull === 0 || head < bsp.clipnodes.length) return head;
      repairs++;
      return -1;
    });
    return heads.some((head, hull) => head !== model.headNodes[hull]) ? { ...model, headNodes: heads } : model;
  });
  return repairs ? Object.assign({ ...bsp, models }, { repairs }) : bsp;
}

// ── lifts ───────────────────────────────────────────────────────────────────
/** A lift's rise a step or less is no ride. A lift's floor is this wide both ways at the least. */
const LIFT_LEAST_RISE = 18;
const LIFT_LEAST_SIDE = 48;
/** A train whose corners stray more than this across is a ride across, not up: not taken as a lift. */
const TRAIN_ACROSS_MOST = 16;
/**
 * The map with the brush entities that carry a player up or down given to the walk as lifts it rides.
 * space.mjs takes a `func_plat` as a ladder in its shaft: its brush is no wall, and a body in the column it
 * rides in climbs between its two ends (`height` under the top it is built at). Besides `func_plat` itself:
 *   func_platrot   a func_plat that turns as it rides (the same `height`)
 *   func_door      one that moves straight up or down (`angles` pitch -90 / 90, or `angle` -1 / -2) whose
 *                  panel is a floor (48 or more wide both ways, no taller than its lesser side): it travels
 *                  its own height less 2 and its `lip` (the Half-Life SDK's doors.cpp)
 *   func_train     one whose path_corners (from its `target`, along each corner's `target`) differ in height
 *                  and keep within 16 across, and whose brush is a floor as a door's: an elevator. It is
 *                  taken as built at its first corner and moved by the corners' differences (so the way
 *                  the game puts a train on a corner, by its middle or its origin, does not matter); one
 *                  built away from its corners is put there by its middle (plats.cpp, CFuncTrain::Activate)
 * A door or a train is given as a func_plat over the whole height it sweeps (its brush at the bottom to its
 * brush at the top), so a car with a floor inside it is ridden from where its floor is as well as its roof.
 * It is a lift only when it serves floors at both ends: at its lowest and at its highest, its top (or, for a
 * car, its bottom) has a standing player's room over its middle and a floor within a step of it beside it
 * (the map's own player hull, 24 out from each side). A train that sweeps scenery about (blades, a falling
 * slab) fails that.
 * A door or train that moves across, not up, is left as it was (a door open, a train a wall where built).
 * `{ bsp, lifts: { plats, platrots, doors, trains, trainsAcross, doorsRefused, trainsRefused } }`; the map given is not changed.
 */
export function liftsOf(bsp) {
  const lifts = { plats: 0, platrots: 0, doors: 0, trains: 0, trainsAcross: 0, doorsRefused: 0, trainsRefused: 0 };
  const byName = new Map();
  for (const entity of bsp.entities) {
    const name = valueOf(entity, "targetname");
    if (name && !byName.has(name)) byName.set(name, entity);
  }
  /** Whether a lift's floor at height z, over [min, max] across, is one a player gets on and off at. */
  const STAND = 36; // a standing player's origin over its feet (hull 1)
  const roomAt = (point) => {
    try {
      return contentsAt(bsp, point, { hull: 1 }) !== CONTENTS.SOLID;
    } catch {
      return false;
    }
  };
  const serves = (min, max, z) => {
    const middle = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
    const out = 24;
    const beside = [[min[0] - out, middle[1]], [max[0] + out, middle[1]], [middle[0], min[1] - out], [middle[0], max[1] + out]];
    for (let dz = -STEP_MOST; dz <= STEP_MOST; dz += 2) {
      const feet = z + dz;
      if (!roomAt([middle[0], middle[1], z + STAND + 1])) continue;
      if (beside.some(([x, y]) => roomAt([x, y, feet + STAND + 1]) && !roomAt([x, y, feet + STAND - 3]))) return true;
    }
    return false;
  };
  /** Whether a lift whose brush sweeps from [min, max] at its lowest up by `rise` serves floors at both ends. */
  const servesBoth = (min, max, rise) =>
    [max[2], min[2] + 1].some((z) => serves(min, max, z) && serves(min, max, z + rise));
  const refused = { doors: 0, trains: 0 };
  /** The entity as a func_plat whose top is at `high` and which rides down to `low`. */
  const plat = (entity, model, low, high) => {
    const origin = originOf(entity) ?? [0, 0, 0];
    const changes = { classname: "func_plat", origin: [origin[0], origin[1], high - model.maxs[2]].join(" "), height: String(high - low) };
    return [...entity.filter(([key]) => !(key in changes)), ...Object.entries(changes)];
  };
  const entities = bsp.entities.map((entity) => {
    const classname = valueOf(entity, "classname") ?? "";
    const number = brushModelOf(entity);
    const model = number === null ? null : bsp.models[number];
    if (classname === "func_plat") lifts.plats++;
    if (!model) return entity;
    const origin = originOf(entity) ?? [0, 0, 0];
    const min = model.mins.map((value, axis) => value + origin[axis]);
    const max = model.maxs.map((value, axis) => value + origin[axis]);
    const size = max.map((value, axis) => value - min[axis]);
    const floor = Math.min(size[0], size[1]) >= LIFT_LEAST_SIDE && size[2] <= Math.min(size[0], size[1]);
    if (classname === "func_platrot") {
      lifts.platrots++;
      return [...entity.filter(([key]) => key !== "classname"), ["classname", "func_plat"]];
    }
    if (classname === "func_door") {
      const angles = vectorOf(entity, "angles");
      const angle = numberOf(entity, "angle");
      const up = angles ? angles[0] === -90 || (angles[0] === 0 && angles[1] === -1 && angles[2] === 0) : angle === -1;
      const down = angles ? angles[0] === 90 || (angles[0] === 0 && angles[1] === -2 && angles[2] === 0) : angle === -2;
      if (!up && !down) return entity;
      const travel = size[2] - 2 - (numberOf(entity, "lip") ?? 0);
      if (!floor || travel <= LIFT_LEAST_RISE) return entity;
      const lowMin = up ? min : [min[0], min[1], min[2] - travel];
      const lowMax = up ? max : [max[0], max[1], max[2] - travel];
      if (!servesBoth(lowMin, lowMax, travel)) return refused.doors++, entity;
      lifts.doors++;
      return up ? plat(entity, model, min[2], max[2] + travel) : plat(entity, model, min[2] - travel, max[2]);
    }
    if (classname === "func_train") {
      const corners = [];
      const seen = new Set();
      for (let name = valueOf(entity, "target"); name && !seen.has(name) && corners.length < 64; ) {
        seen.add(name);
        const corner = byName.get(name);
        const at = corner ? originOf(corner) : null;
        if (!at) break;
        corners.push(at);
        name = valueOf(corner, "target");
      }
      if (corners.length < 2) return entity;
      const span = [0, 1, 2].map((axis) => Math.max(...corners.map((c) => c[axis])) - Math.min(...corners.map((c) => c[axis])));
      if (span[2] <= LIFT_LEAST_RISE) return entity;
      if (Math.max(span[0], span[1]) > TRAIN_ACROSS_MOST) {
        lifts.trainsAcross++;
        return entity;
      }
      if (!floor) return entity;
      const lowest = Math.min(...corners.map((c) => c[2]));
      const highest = Math.max(...corners.map((c) => c[2]));
      const middle = min.map((value, axis) => (value + max[axis]) / 2);
      const builtThere = [0, 1].every((axis) => Math.abs(middle[axis] - corners[0][axis]) <= size[axis] / 2 + TRAIN_ACROSS_MOST);
      // the brush's bottom and top when its first corner is where it was built; else its middle on a corner
      const [bottom, top] = builtThere ? [min[2] - corners[0][2], max[2] - corners[0][2]] : [-size[2] / 2, size[2] / 2];
      const across = builtThere ? [0, 0] : [0, 1].map((axis) => corners[0][axis] - middle[axis]);
      const lowMin = [min[0] + across[0], min[1] + across[1], lowest + bottom];
      const lowMax = [max[0] + across[0], max[1] + across[1], lowest + top];
      if (!servesBoth(lowMin, lowMax, highest - lowest)) return refused.trains++, entity;
      let lifted = plat(entity, model, lowest + bottom, highest + top);
      if (!builtThere) {
        // across, its middle over the corners
        const shift = [0, 1].map((axis) => corners[0][axis] - middle[axis]);
        lifted = lifted.map(([key, value]) => {
          if (key !== "origin") return [key, value];
          const at = value.split(" ").map(Number);
          return [key, [at[0] + shift[0], at[1] + shift[1], at[2]].join(" ")];
        });
      }
      lifts.trains++;
      return lifted;
    }
    return entity;
  });
  lifts.doorsRefused = refused.doors;
  lifts.trainsRefused = refused.trains;
  return { bsp: { ...bsp, entities }, lifts };
}

// ── the walk's graph ────────────────────────────────────────────────────────
/** Every walked spot of the graph, with the level spots beside it (both walked, the body passing). */
function walkedGraph(graph) {
  const { grid, layer, flood } = graph;
  const walked = [];
  for (let spot = 0; spot < layer.floor.length; spot++) if (flood.far[spot] !== undefined) walked.push(spot);
  /** The walked level neighbours of a spot, east and north only (each pair once). */
  const besideOnce = (spot) => {
    const out = [];
    for (const way of [0, 2]) {
      const other = flood.links?.[spot * 4 + way];
      if (other === undefined || other < 0 || flood.far[other] === undefined) continue;
      out.push(other);
    }
    // the links are kept from the spot that was expanded; a pair is also found from its other end
    for (const way of [1, 3]) {
      const other = flood.links?.[spot * 4 + way];
      if (other === undefined || other < 0 || flood.far[other] === undefined) continue;
      const back = flood.links?.[other * 4 + (way === 1 ? 0 : 2)];
      if (back !== spot) out.push(other); // the other end never saw it: count it from here
    }
    return out;
  };
  const xOf = (spot) => grid.x(layer.place[spot]);
  const yOf = (spot) => grid.y(layer.place[spot]);
  return { walked, besideOnce, xOf, yOf, cell: grid.cell };
}

/** Steps and flights of stairs. */
function stepsOf(graph, g) {
  const { layer } = graph;
  const rises = [];
  const stepSpots = new Set();
  const edges = [];
  const { links, far } = graph.flood;
  const walkedLink = (spot, way) => {
    const other = links?.[spot * 4 + way];
    return other !== undefined && other >= 0 && far[other] !== undefined ? other : -1;
  };
  const level = (a, b) => b >= 0 && Math.abs(layer.floor[a] - layer.floor[b]) < 0.5;
  for (const spot of g.walked) {
    for (const other of g.besideOnce(spot)) edges.push([spot, other]);
    // a riser: level floor, then a rise, then level floor again, along one way (east or north)
    for (const way of [0, 2]) {
      const other = walkedLink(spot, way);
      if (other < 0) continue;
      const rise = Math.abs(layer.floor[other] - layer.floor[spot]);
      if (rise < STEP_LEAST || rise > STEP_MOST) continue;
      if (!(layer.slant[spot] >= FLAT && layer.slant[other] >= FLAT)) continue;
      if (!level(spot, walkedLink(spot, way + 1)) || !level(other, walkedLink(other, way))) continue;
      rises.push(Math.round(rise));
      stepSpots.add(spot);
      stepSpots.add(other);
    }
  }
  // flights: the spots touching a riser, joined where they are level neighbours
  const parent = new Map();
  const find = (s) => {
    let root = s;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(s) !== root) {
      const next = parent.get(s);
      parent.set(s, root);
      s = next;
    }
    return root;
  };
  for (const s of stepSpots) parent.set(s, s);
  for (const [a, b] of edges) if (stepSpots.has(a) && stepSpots.has(b)) parent.set(find(a), find(b));
  const spans = new Map();
  for (const s of stepSpots) {
    const root = find(s);
    const z = layer.floor[s];
    const span = spans.get(root) ?? [z, z];
    spans.set(root, [Math.min(span[0], z), Math.max(span[1], z)]);
  }
  const flights = [...spans.values()].map(([low, high]) => Math.round(high - low)).filter((rise) => rise >= FLIGHT_LEAST);
  return {
    risers: rises.length,
    rise: rises.length ? summary(rises) : null,
    commonRise: rises.length ? modeOf(rises) : null,
    flights: flights.length,
    flightRise: flights.length ? summary(flights) : null,
  };
}
function modeOf(list) {
  const counts = new Map();
  for (const value of list) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/** Floor heights of the walk: distinct levels and the spread. */
function verticalOf(graph, g) {
  const { layer } = graph;
  const heights = g.walked.map((spot) => layer.floor[spot]).sort((a, b) => a - b);
  const bins = new Map();
  for (const z of heights) bins.set(Math.round(z / LEVEL_BIN), (bins.get(Math.round(z / LEVEL_BIN)) ?? 0) + 1);
  const levels = [...bins.values()].filter((count) => count / heights.length >= LEVEL_SHARE).length;
  return {
    levels,
    range: Math.round(heights[heights.length - 1] - heights[0]),
    range90: Math.round(quantile(heights, 0.95) - quantile(heights, 0.05)),
  };
}

/**
 * Loops: the walked floor in tiles of `tile` units; in each tile its parts joined by level steps are the
 * regions; regions beside one another across a tile's edge are joined. The independent cycles of that
 * graph (edges - regions + parts) less the trivial ones (four regions round one corner of four tiles,
 * joined in a ring: floor that fills the corner) is the number of ways round something at least about a
 * tile across: a block, a courtyard, a stair up and a bridge over. Drops, ladders, teleports and jumps are
 * left out: a loop here is one walked both ways.
 */
function loopsOf(g, tile) {
  const tileOf = (spot) => `${Math.floor(g.xOf(spot) / tile)},${Math.floor(g.yOf(spot) / tile)}`;
  const parent = new Map();
  const find = (s) => {
    let root = s;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(s) !== root) {
      const next = parent.get(s);
      parent.set(s, root);
      s = next;
    }
    return root;
  };
  for (const s of g.walked) parent.set(s, s);
  const crossing = [];
  const tiles = new Map();
  for (const s of g.walked) tiles.set(s, tileOf(s));
  for (const s of g.walked)
    for (const o of g.besideOnce(s)) {
      if (tiles.get(s) === tiles.get(o)) parent.set(find(s), find(o));
      else crossing.push([s, o]);
    }
  const regionOf = (s) => find(s);
  const regions = new Set(g.walked.map(regionOf));
  const edges = new Set();
  const adjacency = new Map();
  for (const [s, o] of crossing) {
    const a = regionOf(s);
    const b = regionOf(o);
    if (a === b) continue;
    const key = a < b ? `${a} ${b}` : `${b} ${a}`;
    if (edges.has(key)) continue;
    edges.add(key);
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
  }
  // parts of the region graph
  const seen = new Set();
  let parts = 0;
  for (const r of regions) {
    if (seen.has(r)) continue;
    parts++;
    const stack = [r];
    seen.add(r);
    while (stack.length) {
      const at = stack.pop();
      for (const next of adjacency.get(at) ?? []) if (!seen.has(next)) (seen.add(next), stack.push(next));
    }
  }
  // the trivial rings: a region in tile (i,j), one in (i+1,j), (i+1,j+1), (i,j+1), joined round
  const regionTile = new Map();
  for (const s of g.walked) regionTile.set(regionOf(s), tiles.get(s));
  const tileKey = (r) => regionTile.get(r).split(",").map(Number);
  let faces = 0;
  for (const a of regions) {
    const [i, j] = tileKey(a);
    const near = adjacency.get(a);
    if (!near) continue;
    const east = [...near].filter((r) => { const [x, y] = tileKey(r); return x === i + 1 && y === j; });
    const north = [...near].filter((r) => { const [x, y] = tileKey(r); return x === i && y === j + 1; });
    for (const b of east)
      for (const d of north)
        for (const c of adjacency.get(b) ?? []) {
          const [x, y] = tileKey(c);
          if (x === i + 1 && y === j + 1 && adjacency.get(d)?.has(c)) faces++;
        }
  }
  const cycles = Math.max(0, edges.size - regions.size + parts - faces);
  return { tile, regions: regions.size, joins: edges.size, cycles };
}

/**
 * A single-start flood over the walk's layer, on foot, and riding the lifts (`liftsOf`): a lift's ways
 * (`graph.ladders` whose ladder is a lift) are taken as the walk takes them, at the height ridden plus a
 * cell. Teleports and ladder shafts are not carried.
 */
function farthestFrom(graph, spot) {
  const flood = graph.floodOf(graph.layer, { step: graph.step, up: graph.step, links: false, slopes: true });
  flood.seed(spot);
  flood.run();
  const rides = graph.ladders.filter(([, , ladder]) => ladder.lift);
  for (let again = rides.length > 0; again; ) {
    again = false;
    for (const [from, to] of rides) {
      if (flood.far[from] === undefined) continue;
      const far = flood.far[from] + Math.abs(graph.layer.floor[to] - graph.layer.floor[from]) + graph.grid.cell;
      if (flood.far[to] !== undefined && flood.far[to] <= far) continue;
      flood.seed(to, far, from, false, true);
      again = true;
    }
    if (again) flood.run();
  }
  let best = -1;
  let far = -1;
  for (let s = 0; s < graph.layer.floor.length; s++) {
    const value = flood.far[s];
    if (value !== undefined && value > far) (far = value), (best = s);
  }
  return { spot: best, far, flood };
}
/** The start a crossing is walked from: a single-player start first, then where a new character begins. */
const START_ORDER = ["info_player_start", "ms_player_begin", "info_player_deathmatch", "ms_player_spawn"];
function chosenStart(graph) {
  const rank = (s) => {
    const at = START_ORDER.indexOf(s.classname);
    return at < 0 ? START_ORDER.length : at;
  };
  return graph.starts.slice().sort((a, b) => rank(a) - rank(b))[0];
}
/** The spot of the walk's layer at a point [x, y, floor] (a route's point), or -1. */
function spotAtPoint(graph, point) {
  const place = graph.grid.at(point[0], point[1]);
  const first = graph.layer.spots(place);
  if (first < 0) return -1;
  for (let s = first; s < first + graph.layer.count[place]; s++)
    if (Math.abs(graph.layer.floor[s] - point[2]) < 0.5) return s;
  return -1;
}
/** Ways out tried pairwise at the most (a flood each). */
const EXITS_MOST = 8;
const pointOfSpot = (graph, spot) => [
  graph.grid.x(graph.layer.place[spot]),
  graph.grid.y(graph.layer.place[spot]),
  graph.layer.floor[spot],
];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ── one map ─────────────────────────────────────────────────────────────────
/**
 * One map's record. `exits`: the classes that are a way out (Half-Life's trigger_changelevel always; a
 * mod's besides). Throws when the map cannot be walked (no place to start, nothing walked).
 */
export function measureLevel(bytes, { exits = [], name, city: cityWanted = false, read = null, cityDetail = false } = {}) {
  const times = {};
  let t = Date.now();
  // `read`: the map already read, in readBsp's shape (readBsp reads Xash's BSP2 itself: kept for a map read once)
  const built = repairedOf(read ?? readBsp(bytes));
  // the walk rides the lifts: doors and trains that carry a player up or down are given to it as func_plat
  const { bsp, lifts } = liftsOf(built);
  const exitClasses = ["trigger_changelevel", ...exits];
  let reach = reachOf(bsp, { graph: true, exits, to: exitClasses });
  let startedAt = "starts";
  if (!reach.graph.starts.length) {
    // a campaign level entered only through a changelevel has no place to start: the walk begins at its
    // landmarks instead (the point the arriving player is placed against), falling to the floor under each
    const landmarks = bsp.entities
      .filter((entity) => valueOf(entity, "classname") === "info_landmark")
      .map((entity) => originOf(entity))
      .filter(Boolean);
    if (landmarks.length) {
      reach = reachOf(bsp, { graph: true, exits, to: exitClasses, from: landmarks });
      startedAt = "landmarks";
    }
  }
  if (!reach.graph.starts.length) {
    // nor a landmark (a level entered by a way of the mod's own, Master Sword's nightmare_thornlands): the
    // walk begins on the floor under the middle of each way out, where the arriving player stands
    const ways = [];
    bsp.entities.forEach((entity) => {
      if (!exitClasses.includes(valueOf(entity, "classname"))) return;
      const number = brushModelOf(entity);
      const model = number === null ? null : bsp.models[number];
      const origin = originOf(entity) ?? [0, 0, 0];
      if (model) ways.push([0, 1, 2].map((axis) => (model.mins[axis] + model.maxs[axis]) / 2 + origin[axis]));
      else if (originOf(entity)) ways.push(origin);
    });
    for (const point of ways) {
      const floor = floorUnder(bsp, point);
      if (floor !== null) point[2] = floor;
    }
    if (ways.length) {
      reach = reachOf(bsp, { graph: true, exits, to: exitClasses, from: ways });
      startedAt = "ways out";
    }
  }
  if (cityWanted && reach.graph.starts.length && reach.share < CITY_BOXED) {
    // a role-play city whose spawns are boxed in (Alexandria's spawn core: a push up into teleports, which
    // the walk does not ride) is walked from its starts and from where its teleports put a player too
    const from = [...START_ORDER, "info_teleport_destination"];
    const again = reachOf(bsp, { graph: true, exits, to: exitClasses, from });
    if (again.share > reach.share) (reach = again), (startedAt = "starts and teleport destinations");
  }
  times.walk = Date.now() - t;
  t = Date.now();
  const graph = reach.graph;
  if (!graph.starts.length) throw new Error("no place to start on a floor (nor a landmark or a way out over one)");
  const m = measure(bsp, { reach, places: true });
  times.measure = Date.now() - t;
  t = Date.now();

  // per place of measure's grid (32)
  const cells = m.cells;
  const widths = cells.map((c) => c.width);
  const sights = cells.map((c) => c.sight);
  // what is over a place: a roof, or the sky. The kit's headroom stops at the sky brush as at any solid;
  // a place whose headroom ends in the sky's contents is under open sky, and its "headroom" is the sky's
  // height, kept apart (skyHeight)
  const underSky = (c) => {
    if (c.headroom === null) return true;
    for (const over of [1, 4, 12]) {
      try {
        if (contentsAt(bsp, [c.at[0] + 0.3, c.at[1] + 0.1, c.at[2] + c.headroom + over]) === CONTENTS.SKY) return true;
      } catch {
        return false;
      }
    }
    return false;
  };
  for (const c of cells) c.sky = underSky(c);
  const roofed = cells.filter((c) => !c.sky && c.headroom !== null);
  const skyHeights = cells.filter((c) => c.sky && c.headroom !== null).map((c) => c.headroom);
  const heads = roofed.map((c) => c.headroom);
  const narrow = widths.filter((w) => w < NARROW).length;
  const kitNarrow = widths.filter((w) => w < KIT_NARROW).length;
  const wide = widths.filter((w) => w >= 4 * PLAYER_HEIGHT).length;

  const g = walkedGraph(graph);
  const steps = stepsOf(graph, g);
  const vertical = verticalOf(graph, g);
  const loops = LOOP_TILES.map((tile) => loopsOf(g, tile));
  const doors = doorsOf(built);

  // crossing. The ways out the walk reached, one per destination (the nearest to the start where a
  // destination has several triggers). Two or more: the longest walk between two of them (a level is
  // entered by one and left by another: Half-Life's campaign, Master Sword's hubs, whose every arrival
  // has its own place to start beside it). One: the walk from the chosen start to it. None: the walk from
  // the chosen start to the farthest floor. All by single-start floods on foot.
  const exitEntities = reach.entities.filter((e) => exitClasses.includes(e.classname));
  const startSpot = chosenStart(graph);
  const fromStart = farthestFrom(graph, startSpot.spot);
  const exitsAt = [];
  for (const route of reach.routes) {
    if (!route.points?.length) continue;
    const point = route.points[route.points.length - 1];
    const spot = spotAtPoint(graph, point);
    if (spot < 0) continue;
    const entity = bsp.entities[route.number] ?? [];
    const destination = valueOf(entity, "map") ?? valueOf(entity, "destmap") ?? `#${route.number}`;
    exitsAt.push({ spot, point, destination: destination.toLowerCase(), classname: route.classname });
  }
  const byDestination = new Map();
  for (const exit of exitsAt) {
    const fromIt = fromStart.flood.far[exit.spot];
    const kept = byDestination.get(exit.destination);
    const keptFar = kept ? fromStart.flood.far[kept.spot] : undefined;
    if (!kept || (fromIt !== undefined && (keptFar === undefined || fromIt < keptFar))) byDestination.set(exit.destination, exit);
  }
  const ways = [...byDestination.values()].slice(0, EXITS_MOST);
  let crossing = null;
  if (ways.length >= 2) {
    let best = null;
    for (let i = 0; i < ways.length; i++) {
      const flood = farthestFrom(graph, ways[i].spot).flood;
      for (let j = i + 1; j < ways.length; j++) {
        const walk = flood.far[ways[j].spot];
        if (walk !== undefined && (!best || walk > best.walk)) best = { walk, a: ways[i], b: ways[j] };
      }
    }
    if (best)
      crossing = { to: "exit-to-exit", walk: Math.round(best.walk), straight: Math.round(distance(best.a.point, best.b.point)) };
  }
  if (!crossing) {
    const reachable = ways.filter((w) => fromStart.flood.far[w.spot] !== undefined);
    if (reachable.length) {
      // one way out: the level is entered or left there, so the crossing is from it to the farthest floor
      // walked (a start is often put right beside the changelevel a player arrives by)
      const way = reachable.sort((a, b) => fromStart.flood.far[b.spot] - fromStart.flood.far[a.spot])[0];
      const fromWay = farthestFrom(graph, way.spot);
      crossing = { to: "exit-to-farthest", walk: Math.round(fromWay.far), straight: Math.round(distance(way.point, pointOfSpot(graph, fromWay.spot))) };
    } else
      crossing = { to: "farthest", walk: Math.round(fromStart.far), straight: Math.round(distance(pointOfSpot(graph, startSpot.spot), pointOfSpot(graph, fromStart.spot))) };
  }
  crossing.ratio = crossing.straight > 0 ? round(crossing.walk / crossing.straight, 2) : null;
  crossing.start = startSpot.classname;
  crossing.waysOutReached = byDestination.size;
  crossing.exitsInMap = exitEntities.length;

  // span: two sweeps of a single-start flood from the first start
  const a = farthestFrom(graph, graph.starts[0].spot);
  const b = a.spot >= 0 ? farthestFrom(graph, a.spot) : { spot: -1, far: -1 };
  const span =
    b.spot >= 0
      ? {
          walk: Math.round(b.far),
          straight: Math.round(distance(pointOfSpot(graph, a.spot), pointOfSpot(graph, b.spot))),
        }
      : null;
  if (span) span.ratio = span.straight > 0 ? round(span.walk / span.straight, 2) : null;
  times.extra = Date.now() - t;
  let city = null;
  if (cityWanted) {
    t = Date.now();
    const input = cityInputOf(built, bsp, cells, { lifts });
    if (cityDetail) input.detail = true;
    city = cityOf(input);
    times.city = Date.now() - t;
    // asked with `cityDetail`: the map as read, the city's input and its cut, kept out of the record's own
    // keys (a per-room survey reads them in the same process; levels/tools/survey-rp-rooms.mjs)
    if (cityDetail) {
      Object.defineProperty(city, "_detail", { value: { built, input, detail: city.detail }, enumerable: false });
      delete city.detail;
    }
  }

  const share = (part, all) => (all ? round(part / all, 3) : null);
  return {
    name,
    walkCell: reach.cell,
    starts: reach.starts.length,
    walkFrom: startedAt, // "starts", or "landmarks" for a level with no place to start
    area: reach.area, // square units, the walk's own count on its grid
    reachedShare: round(reach.share, 3), // of the floor a standing player fits on
    clipHullsRepaired: built.repairs ?? 0, // brush models' clip hulls pointing past the file, taken as empty (repairedOf)
    lifts: { ...lifts, ways: graph.ladders.filter(([, , ladder]) => ladder.lift).length }, // ridden by the walk (liftsOf)
    places: cells.length, // measure's places (grid 32)
    width: summary(widths),
    narrowShare: share(narrow, widths.length), // under 144 (two player heights)
    kitNarrowShare: share(kitNarrow, widths.length), // under 176 (the kit's band)
    wideShare: share(wide, widths.length), // 288 and over (four player heights)
    sight: summary(sights),
    sightBeyond700: share(sights.filter((s) => s > SIGHT_LINE).length, sights.length),
    headroom: heads.length ? summary(heads) : null,
    openSky: share(cells.length - roofed.length, cells.length), // the share of places under open sky
    skyHeight: skyHeights.length ? summary(skyHeights) : null, // floor to the sky brush, where open
    headroomNarrow: summary(roofed.filter((c) => c.width < NARROW).map((c) => c.headroom)),
    headroomOpen: summary(roofed.filter((c) => c.width >= NARROW).map((c) => c.headroom)),
    steps,
    vertical: { ...vertical, stacked: m.floors.stacked.most, stackedShare: m.floors.stacked.share },
    doors: {
      entities: doors.all,
      doorwayPanels: doors.panels,
      openings: doors.openings.length,
      doubles: doors.openings.filter((o) => o.panels > 1).length,
      width: doors.openings.length ? summary(doors.openings.map((o) => o.width)) : null,
      height: doors.openings.length ? summary(doors.openings.map((o) => o.height)) : null,
    },
    passages: {
      count: m.openings.count,
      width: m.openings.count ? summary(m.openings.widths) : null,
      height: m.openings.heights.median === null ? null : { median: m.openings.heights.median },
    },
    crossing,
    span,
    loops: Object.fromEntries(loops.map((l) => [`tile${l.tile}`, { regions: l.regions, joins: l.joins, cycles: l.cycles }])),
    ...(city ? { city } : {}), // a role-play city's measures (city-measures.mjs), asked with `city: true`
    times,
    // kept out of the record written: the per-place values, for the pooled bands
    _pool: { widths, sights, heads },
  };
}
