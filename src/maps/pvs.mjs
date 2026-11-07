// How much of a compiled map the engine draws from the places players stand, worked out from the visibility
// (the PVS) the compiler left in the file: `checkPvs` answers PASS or FAIL against a budget of faces, and
// `pvsPicture` draws it as a heat map on the plan. The measuring half of "optimise the visleafs": it says where
// a map draws too much, and the cure is in the layout (docs/TROUBLE.md), not a switch.
//
// The engine draws every face of every leaf the player's leaf can see (the PVS row), then clips them to the
// view; so the faces of the visible leaves, once each, is the load before the view cuts it down. Brush entities
// (doors, walls, lifts) are drawn when their box touches a visible leaf.
import { readBsp, leafAt, visibleFrom, facePolygon, worldBounds, CONTENTS } from "./bsp.mjs";
import { valueOf, brushModelOf } from "./entities.mjs";
import { reachOf } from "./reach.mjs";
import { planOf } from "./draw.mjs";

/** The faces a median spot may draw, and a spot in ten at most: a city map held to 200 fps on a mid machine. */
export const PVS_BUDGET = { median: 12000, p90: 20000 };
/** The grid of floor samples (units), the height of the eye over the floor, and over a spawn's origin. */
export const PVS_STEP = 128;
export const EYE_OVER_FLOOR = 64;
export const EYE_OVER_ORIGIN = 28;
/** A face is "up in the air" when its middle is this much over the spot's eye. */
export const ABOVE = 200;
/** The side of the cells a map is grouped by when no regions are given (units). */
export const REGION_CELL = 1024;
/** The most floors one column of the grid may hold (a tower of storeys). */
const MOST_FLOORS = 8;

const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);
const statsOf = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, median: quantile(sorted, 0.5), p90: quantile(sorted, 0.9), max: sorted.at(-1) ?? 0 };
};
const at3 = (p) => p.map((v) => Math.round(v)).join(" ");

/**
 * Regions as boxes: `[{ name, min: [x, y(, z)], max: [x, y(, z)] }]` (or `mins`/`maxs`), or `{ name: [x0, y0, x1, y1] }`
 * or `{ name: { min, max } }`. Throws, in words, for one that is none of these.
 */
export function regionsFrom(given) {
  const list = Array.isArray(given) ? given : Object.entries(given ?? {}).map(([name, box]) => ({ name, ...(Array.isArray(box) ? { box } : box) })); // prettier-ignore
  return list.map((region, number) => {
    const name = String(region.name ?? `region ${number + 1}`);
    let min = region.min ?? region.mins;
    let max = region.max ?? region.maxs;
    if (region.box?.length === 4) [min, max] = [region.box.slice(0, 2), region.box.slice(2)];
    if (region.box?.length === 6) [min, max] = [region.box.slice(0, 3), region.box.slice(3)];
    const ok = (p) => Array.isArray(p) && (p.length === 2 || p.length === 3) && p.every(Number.isFinite);
    if (!ok(min) || !ok(max)) throw new Error(`regions: "${name}" needs a box: min and max as [x, y] or [x, y, z] (or box: [x0, y0, x1, y1])`); // prettier-ignore
    return { name, min: [Math.min(min[0], max[0]), Math.min(min[1], max[1]), min[2] === undefined || max[2] === undefined ? -Infinity : Math.min(min[2], max[2])], max: [Math.max(min[0], max[0]), Math.max(min[1], max[1]), min[2] === undefined || max[2] === undefined ? Infinity : Math.max(min[2], max[2])] }; // prettier-ignore
  });
}

/**
 * Points given by a file: a list of `[x, y, z]`, of `{ origin: [x, y, z] }`, `{ x, y, z }` or `{ pos: [...] }`
 * (optionally with a `name`), or an object with such a list under `points` (or `nodes`). Each is where a
 * player's origin is.
 */
export function pointsFrom(given) {
  const list = Array.isArray(given) ? given : (given?.points ?? given?.nodes);
  if (!Array.isArray(list)) throw new Error("points: a list of [x, y, z] or { origin: [x, y, z] } (or an object with it under `points`)"); // prettier-ignore
  return list.map((item, number) => {
    const origin = Array.isArray(item) ? item : (item.origin ?? item.pos ?? item.position ?? [item.x, item.y, item.z]);
    if (!Array.isArray(origin) || origin.length < 3 || !origin.slice(0, 3).every(Number.isFinite))
      throw new Error(`points: item ${number + 1} has no place: [x, y, z] or { origin: [x, y, z] }`);
    return { name: item.name === undefined ? `point ${number + 1}` : String(item.name), origin: origin.slice(0, 3).map(Number) };
  });
}

/** The leaves a box touches in the world, by walking the nodes. */
function boxLeaves(bsp, mins, maxs) {
  const found = new Set();
  const leafCount = bsp.models[0].visLeaves;
  const stack = [bsp.models[0].headNodes[0]];
  while (stack.length) {
    const node = stack.pop();
    if (node < 0) {
      const leaf = -1 - node;
      if (leaf > 0 && leaf <= leafCount) found.add(leaf);
      continue;
    }
    const { plane, children } = bsp.nodes[node];
    const { normal, dist } = bsp.planes[plane];
    let low = -dist;
    let high = -dist;
    for (let k = 0; k < 3; k++) {
      const a = normal[k] * mins[k];
      const b = normal[k] * maxs[k];
      low += Math.min(a, b);
      high += Math.max(a, b);
    }
    if (high >= 0) stack.push(children[0]);
    if (low < 0) stack.push(children[1]);
  }
  return found;
}

/** Every function the checker needs about a map that does not change from one spot to the next. */
function prepare(bsp) {
  const world = bsp.models[0];
  const leafCount = world.visLeaves;
  const middle = (face) => {
    const polygon = facePolygon(bsp, face);
    let z = 0;
    for (const p of polygon) z += p[2];
    return polygon.length ? z / polygon.length : 0;
  };
  const faceZ = new Float32Array(bsp.faces.length);
  for (let face = 0; face < faceZ.length; face++) faceZ[face] = middle(face);
  // the brush entities that draw: func_* with faces
  const brushes = [];
  for (const entity of bsp.entities) {
    const number = brushModelOf(entity);
    const classname = valueOf(entity, "classname") ?? "";
    if (number === null || number === 0 || !/^func_/.test(classname)) continue;
    const model = bsp.models[number];
    if (!model?.faceCount) continue;
    const origin = (valueOf(entity, "origin") ?? "0 0 0").split(/\s+/).map(Number);
    const shift = origin.length === 3 && origin.every(Number.isFinite) ? origin : [0, 0, 0];
    const leaves = boxLeaves(bsp, model.mins.map((v, k) => v + shift[k]), model.maxs.map((v, k) => v + shift[k])); // prettier-ignore
    brushes.push({ model, shift, leaves: [...leaves] });
  }
  return { world, leafCount, faceZ, brushes };
}

/**
 * How many faces the engine draws from a leaf: `{ faces: [face numbers], entityFaces, entityZ: [z of their middles] }`.
 * Null when the leaf keeps no visibility row. Kept by leaf: many spots stand in one.
 */
function drawnFrom(bsp, prep, leaf, stamp) {
  const seen = visibleFrom(bsp, leaf);
  if (seen === null) return null;
  const mask = new Uint8Array(prep.leafCount + 1);
  mask[leaf] = 1;
  for (const other of seen) mask[other] = 1;
  const faces = [];
  for (let l = 1; l <= prep.leafCount; l++) {
    if (!mask[l]) continue;
    const { firstMarkSurface: first, markSurfaceCount: count } = bsp.leaves[l];
    for (let k = first; k < first + count; k++) {
      const face = bsp.marksurfaces[k];
      if (stamp.at[face] === stamp.now) continue;
      stamp.at[face] = stamp.now;
      faces.push(face);
    }
  }
  stamp.now++;
  const entityZ = [];
  for (const { model, shift, leaves } of prep.brushes) {
    if (!leaves.some((l) => mask[l])) continue;
    for (let face = model.firstFace; face < model.firstFace + model.faceCount; face++) entityZ.push(prep.faceZ[face] + shift[2]); // prettier-ignore
  }
  return { faces, entityZ };
}

/**
 * The places to stand: the floor of a grid over the map (`step` units apart) that a player walks to (from
 * `reachOf`), at the eye; or, without the walk (`walk: false`, or a map with nowhere to start), every floor a
 * column of the grid holds that has room for a standing player.
 */
function floorSpots(bsp, { step, walk, eye, notes }) {
  const bounds = worldBounds(bsp);
  const spots = [];
  let reach = null;
  if (walk) {
    try {
      reach = reachOf(bsp, {});
      if (!(reach.area > 0)) {
        notes.push("the walk test found no floor to walk from the places to start: the floor samples are every floor with room to stand, rooftops and the tops of walls included"); // prettier-ignore
        reach = null;
      }
    } catch (error) {
      notes.push(`the walk test could not run (${error.message}): the floor samples are every floor with room to stand`);
    }
  }
  const empty = (p) => {
    const leaf = leafAt(bsp, p);
    return leaf > 0 && bsp.leaves[leaf].contents !== CONTENTS.SOLID && bsp.leaves[leaf].contents !== CONTENTS.SKY;
  };
  const x0 = Math.ceil(bounds.mins[0] / step) * step;
  const y0 = Math.ceil(bounds.mins[1] / step) * step;
  for (let x = x0; x <= bounds.maxs[0]; x += step)
    for (let y = y0; y <= bounds.maxs[1]; y += step) {
      const floors = [];
      if (reach) {
        let under;
        for (let k = 0; k < MOST_FLOORS; k++) {
          const floor = reach.walked(x, y, under);
          if (floor === null || floor === undefined) break;
          floors.push(floor);
          under = floor - 1;
        }
      } else {
        // a vertical scan: empty over solid, with room for a standing player (72) above
        let prior = false;
        for (let z = Math.floor(bounds.maxs[2]); z >= bounds.mins[2]; z -= 8) {
          const open = empty([x, y, z]);
          if (prior && !open && floors.length < MOST_FLOORS) {
            const floor = z + 8;
            if (empty([x, y, floor + 8]) && empty([x, y, floor + 72])) floors.push(floor);
          }
          prior = open;
        }
      }
      for (const floor of floors) spots.push({ name: "floor", kind: "floor", origin: [x, y, floor], eye: [x, y, floor + eye] });
    }
  return { spots, walked: Boolean(reach) };
}

/** The spawns of a map: what a player starts at (info_player_*), whose origin is the player's middle. */
const spawnsOf = (bsp) =>
  bsp.entities
    .filter((entity) => /^info_player_/.test(valueOf(entity, "classname") ?? ""))
    .map((entity, number) => {
      const origin = (valueOf(entity, "origin") ?? "").split(/\s+/).map(Number);
      return origin.length === 3 && origin.every(Number.isFinite) ? { name: `${valueOf(entity, "classname")} ${number + 1}`, kind: "spawn", origin } : null; // prettier-ignore
    })
    .filter(Boolean);

/**
 * How much of a compiled map the engine draws from the places a player stands, against a budget.
 *
 * `bsp` is a read map (`readBsp`) or its bytes. The spots are: the map's `info_player_*` spawns; the floor of a
 * grid over the map (`step`, 128), at the eye (64 over the floor), where the walk test (`reachOf`) says a player
 * walks (`walk: false`: every floor with room to stand, rooftops too); and `points` given (a list as
 * `pointsFrom` takes, each a player's origin: 28 up to the eye). For each spot: the faces of the world in the
 * leaves its leaf sees (once each, however many leaves hold one) plus those of the func_* brush entities whose box
 * touches one of them.
 *
 * options: step, walk, points, regions (named boxes as `regionsFrom` takes; else a grid of `regionCell`, 1024),
 * budget `{ median, p90 }` (12000, 20000), spawns/floor (false: leave that kind out), maxSpots (20000: a coarser
 * grid is taken above it, and said).
 *
 * Returns `{ passed, errors, warnings, facts, said, noVis, overall, spawns, regions, worst, above, spots, walked, budget }`:
 * `overall` and each region `{ name, count, median, p90, max }` in faces; `worst` the three worst spots
 * `{ name, kind, origin, faces, entityFaces, above }`; `above` the share of the faces drawn that are more than
 * 200 over the spot; `spots` every spot with its `faces`, for `pvsPicture`.
 */
export function checkPvs(input, options = {}) {
  const bsp = input?.leaves ? input : readBsp(input);
  const budget = { ...PVS_BUDGET, ...(options.budget ?? {}) };
  const step = options.step ?? PVS_STEP;
  const errors = [];
  const warnings = [];
  const facts = [];
  const notes = [];
  const result = { passed: false, errors, warnings, facts, budget, noVis: false, spots: [], regions: [], worst: [], walked: false, step };
  const world = bsp.models[0];
  const leafCount = world.visLeaves;
  const total = bsp.faces.length;
  // a map compiled without hlvis keeps no row for any leaf: the engine draws everything from everywhere
  const open = [];
  for (let l = 1; l <= leafCount; l++) if (bsp.leaves[l].contents !== CONTENTS.SOLID) open.push(l);
  const withRow = open.filter((l) => bsp.leaves[l].visOffset >= 0).length;
  if (!bsp.lumps.visibility?.length || !withRow) {
    result.noVis = true;
    errors.push(`the map was compiled without vis (hlvis was not run): the engine draws all of its ${total} faces from everywhere (the budget is ${budget.median} a spot); compile it with hlvis`); // prettier-ignore
    result.said = errors[0];
    return result;
  }
  if (withRow < open.length)
    warnings.push(`${open.length - withRow} of the ${open.length} open leaves keep no visibility row: the engine draws everything from them`); // prettier-ignore
  const prep = prepare(bsp);
  const stamp = { at: new Uint32Array(bsp.faces.length), now: 1 };

  // the spots
  const spots = [];
  if (options.spawns !== false) for (const s of spawnsOf(bsp)) spots.push({ ...s, eye: [s.origin[0], s.origin[1], s.origin[2] + EYE_OVER_ORIGIN] }); // prettier-ignore
  for (const p of options.points ? pointsFrom(options.points) : [])
    spots.push({ name: p.name, kind: "point", origin: p.origin, eye: [p.origin[0], p.origin[1], p.origin[2] + EYE_OVER_ORIGIN] });
  if (options.floor !== false) {
    let used = step;
    let floors = floorSpots(bsp, { step: used, walk: options.walk !== false, eye: EYE_OVER_FLOOR, notes });
    const most = options.maxSpots ?? 20000;
    while (floors.spots.length > most) {
      used *= 2;
      floors = floorSpots(bsp, { step: used, walk: options.walk !== false, eye: EYE_OVER_FLOOR, notes: [] });
    }
    if (used !== step) notes.push(`the grid was ${step} units and gave more than ${most} floor samples: ${used} was taken`);
    result.step = used;
    result.walked = floors.walked;
    spots.push(...floors.spots);
  }
  warnings.push(...notes.map((note) => note));

  // faces drawn from each spot; one count for each leaf
  const byLeaf = new Map();
  const kept = [];
  let skipped = 0;
  for (const spot of spots) {
    const leaf = leafAt(bsp, spot.eye);
    if (leaf <= 0 || bsp.leaves[leaf].contents === CONTENTS.SOLID) {
      skipped++;
      continue;
    }
    if (!byLeaf.has(leaf)) byLeaf.set(leaf, drawnFrom(bsp, prep, leaf, stamp));
    const drawn = byLeaf.get(leaf);
    if (drawn === null) {
      skipped++;
      continue;
    }
    const cut = spot.eye[2] + ABOVE;
    let above = 0;
    for (const face of drawn.faces) if (prep.faceZ[face] > cut) above++;
    for (const z of drawn.entityZ) if (z > cut) above++;
    kept.push({ ...spot, leaf, worldFaces: drawn.faces.length, entityFaces: drawn.entityZ.length, faces: drawn.faces.length + drawn.entityZ.length, above }); // prettier-ignore
  }
  if (skipped) warnings.push(`${skipped} of ${spots.length} spots were left out: inside something solid, or in a leaf with no visibility row`); // prettier-ignore
  result.spots = kept;
  if (!kept.length) {
    errors.push("no spot to measure: the map has no info_player_* spawn, no floor with room to stand, and no points were given");
    result.said = errors[0];
    return result;
  }

  // the numbers
  const faces = kept.map((s) => s.faces);
  result.overall = statsOf(faces);
  result.spawns = statsOf(kept.filter((s) => s.kind === "spawn").map((s) => s.faces));
  const drawnAll = faces.reduce((a, b) => a + b, 0);
  result.above = drawnAll ? kept.reduce((a, s) => a + s.above, 0) / drawnAll : 0;
  // the worst three that are not neighbours (512 units apart at the least)
  for (const spot of [...kept].sort((a, b) => b.faces - a.faces)) {
    if (result.worst.length === 3) break;
    const near = result.worst.some((w) => Math.hypot(w.origin[0] - spot.origin[0], w.origin[1] - spot.origin[1]) < 512 && Math.abs(w.origin[2] - spot.origin[2]) < 128); // prettier-ignore
    if (near) continue;
    const { name, kind, origin, faces: n, entityFaces, above } = spot;
    result.worst.push({ name, kind, origin, faces: n, entityFaces, above });
  }
  const named = options.regions ? regionsFrom(options.regions) : null;
  const groups = new Map();
  const inBox = (r, p) => p[0] >= r.min[0] && p[0] <= r.max[0] && p[1] >= r.min[1] && p[1] <= r.max[1] && p[2] >= r.min[2] && p[2] <= r.max[2]; // prettier-ignore
  for (const spot of kept) {
    const names = named
      ? named.filter((r) => inBox(r, spot.origin)).map((r) => r.name)
      : [`${Math.floor(spot.origin[0] / REGION_CELL) * REGION_CELL},${Math.floor(spot.origin[1] / REGION_CELL) * REGION_CELL}`];
    for (const name of names) {
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(spot.faces);
    }
  }
  if (named) for (const r of named) if (!groups.has(r.name)) groups.set(r.name, []);
  result.regions = [...groups].map(([name, values]) => ({ name, ...statsOf(values) })).sort((a, b) => b.median - a.median);
  if (named) {
    const empty = result.regions.filter((r) => !r.count).map((r) => r.name);
    if (empty.length) warnings.push(`no spot fell in ${empty.length} regions: ${empty.join(", ")}`);
  }

  // the answer
  const o = result.overall;
  const over = (n, b) => `${Math.round(n)} faces, ${Math.round(((n - b) / b) * 100)}% over the budget of ${b}`;
  if (o.median > budget.median) errors.push(`the median spot draws ${over(o.median, budget.median)} (p90 ${o.p90}, max ${o.max}; worst at ${at3(result.worst[0].origin)})`); // prettier-ignore
  if (o.p90 > budget.p90) errors.push(`the p90 spot draws ${over(o.p90, budget.p90)} (median ${o.median}, max ${o.max}; worst at ${at3(result.worst[0].origin)})`); // prettier-ignore
  result.passed = !errors.length;
  facts.push(`${kept.length} spots (${kept.filter((s) => s.kind === "spawn").length} spawns, ${kept.filter((s) => s.kind === "point").length} points, ${kept.filter((s) => s.kind === "floor").length} floor samples every ${result.step} units${result.walked ? ", where the walk test walks" : ", every floor with room to stand"}); the map has ${total} faces in ${leafCount} leaves`); // prettier-ignore
  facts.push(`faces drawn, overall: median ${o.median}, p90 ${o.p90}, max ${o.max} (budget: median ${budget.median}, p90 ${budget.p90})`);
  if (result.spawns.count) facts.push(`from the spawns alone: median ${result.spawns.median}, p90 ${result.spawns.p90}, max ${result.spawns.max}`);
  facts.push(`${Math.round(result.above * 100)}% of the faces drawn are more than ${ABOVE} units over the spot that draws them (open air over roofs connects far places)`); // prettier-ignore
  for (const [number, w] of result.worst.entries())
    facts.push(`worst ${number + 1}: ${w.faces} faces from ${at3(w.origin)} (${w.name}${w.entityFaces ? `, ${w.entityFaces} of them brush entities` : ""}), ${Math.round((w.above / w.faces) * 100)}% far above`); // prettier-ignore
  facts.push(`${named ? "regions" : `regions (cells of ${REGION_CELL}, by their low corner)`}, worst median first: name, spots, median / p90 / max`); // prettier-ignore
  for (const r of result.regions) facts.push(`  ${r.name}: ${r.count} spots, ${r.median} / ${r.p90} / ${r.max}${r.count && r.p90 > budget.p90 ? "  (p90 over budget)" : ""}`); // prettier-ignore
  result.said = errors.length
    ? `${errors.length === 2 ? "median and p90 are" : errors[0].startsWith("the median") ? "median is" : "p90 is"} over the budget: median ${o.median} (${budget.median}), p90 ${o.p90} (${budget.p90}), max ${o.max}, from ${kept.length} spots; worst at ${at3(result.worst[0].origin)}` // prettier-ignore
    : `median ${o.median} faces drawn (budget ${budget.median}), p90 ${o.p90} (${budget.p90}), max ${o.max}, from ${kept.length} spots`;
  return result;
}

/** The heat of a count of faces as a colour: green to yellow at the median budget, to red at the p90's, to violet over it. */
function heat(faces, budget) {
  const mix = (a, b, t) => a.map((v, k) => Math.round(v + (b[k] - v) * Math.min(1, Math.max(0, t))));
  const green = [60, 190, 90];
  const yellow = [240, 210, 40];
  const red = [230, 50, 40];
  const violet = [170, 40, 220];
  if (faces <= budget.median) return mix(green, yellow, faces / budget.median);
  if (faces <= budget.p90) return mix(yellow, red, (faces - budget.median) / (budget.p90 - budget.median));
  return mix(red, violet, (faces - budget.p90) / budget.p90);
}

/**
 * The plan of the map with the spots tinted by the faces drawn from each (green: little; yellow: the median budget;
 * red: the p90's; violet: over it), the worst spots marked by a white cross, the colours' ramp in the corner.
 * Returns `{ width, height, rgba, facts }` as `planOf` does.
 */
export function pvsPicture(bsp, report, options = {}) {
  const plan = planOf(bsp, { entities: false, width: 1400, height: 1400, ...options });
  const { scale, x0, y0 } = plan.facts;
  const { width, height, rgba } = plan;
  // the plan is dimmed so the heat reads
  for (let i = 0; i < rgba.length; i += 4) for (let k = 0; k < 3; k++) rgba[i + k] = Math.round(rgba[i + k] * 0.45 + 18);
  const put = (px, py, colour) => {
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const at = (py * width + px) * 4;
    rgba[at] = colour[0];
    rgba[at + 1] = colour[1];
    rgba[at + 2] = colour[2];
    rgba[at + 3] = 255;
  };
  const half = Math.max(1, Math.round((report.step * scale) / 2) - 1);
  const ordered = [...report.spots].sort((a, b) => a.origin[2] - b.origin[2]); // upper floors over lower
  for (const s of ordered) {
    const cx = Math.round((s.origin[0] - x0) * scale);
    const cy = Math.round((y0 - s.origin[1]) * scale);
    const colour = heat(s.faces, report.budget);
    const r = s.kind === "floor" ? half : 3;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) put(cx + dx, cy + dy, colour);
  }
  for (const [rank, w] of report.worst.entries()) {
    const cx = Math.round((w.origin[0] - x0) * scale);
    const cy = Math.round((y0 - w.origin[1]) * scale);
    const arm = rank === 0 ? 14 : 8;
    for (let d = -arm; d <= arm; d++) {
      put(cx + d, cy, [255, 255, 255]);
      put(cx, cy + d, [255, 255, 255]);
      if (Math.abs(d) > 2) {
        put(cx + d, cy + 1, [0, 0, 0]);
        put(cx + 1, cy + d, [0, 0, 0]);
      }
    }
  }
  // the ramp: 0 to twice the p90 budget, with ticks at the two budgets
  const top = report.budget.p90 * 2;
  const barW = Math.min(240, width - 24);
  for (let i = 0; i < barW; i++)
    for (let j = 0; j < 10; j++) put(12 + i, 24 + j, heat((i / (barW - 1)) * top, report.budget));
  for (const budget of [report.budget.median, report.budget.p90])
    for (let j = -4; j < 14; j++) put(12 + Math.round((budget / top) * (barW - 1)), 24 + j, [255, 255, 255]);
  return { width, height, rgba, facts: { ...plan.facts, ramp: `0 to ${top} faces; ticks at the median budget ${report.budget.median} and the p90's ${report.budget.p90}` } }; // prettier-ignore
}
