// The floor's faces: where a trace down stops on solid and no face lies there, the game draws a hole. Made after a vehicle map's first build
// (2026-11-14): hlbsp dropped the floor faces of a field of turned prisms compiled as world brushes, the solid stayed, and the game and the
// kit's viewer (blamed) drew black wedges in the road; func_detail and -noinsidefill cured it. Hull 0 only: CLIP and playerclip are no floor.
// `hulls`: the same samples asked of hull 1 (KIT-FAULTS R12 of the rally map, 2026-11-14: sdhlt lost brushes of the clip hulls, the
// drawn road whole and the car's floor 36 under it). Hull 1 is the world grown by the body, so it rests on or over the drawn floor at
// a CLIP, a stair's nosing, a ledge, a slope; never under it unless a brush is missing from the clip hull. Measured on the walked floor:
// the plaza, race01 and neonbench, 0 samples under by more than 0.5; the bad rally build's 496 under by more than 6, the pit at the start among them.
import { readBsp, CONTENTS, HULLS, contentsAt, floorUnder } from "../../core/maps/bsp.mjs";
import { valueOf } from "../../core/maps/entities.mjs";
import { reachOf } from "./reach.mjs";
import { planesOf } from "../../make/maps/source.mjs";
/** The grid (units), how far a face may lie from the stop, the air over a floor, how near a face's edge a point is on it. */
const [STEP, TOLERANCE, ROOM, EDGE, BUCKET] = [16, 2, 32, 0.5, 128];
/** Hull 1 under the drawn floor by more than PIT_DEEP is a pit: road-fix.mjs's own bound (the rally's verify), over the 2.5 the fixed road's CLIP net leaves; looked for PIT_REACH down. */
export const PIT_DEEP = 6;
const [PIT_REACH, PIT_STEP] = [256, 18];
/** Uncovered walked floor over this share is a FAIL: the walked floor of the hand-made Half-Life and mod maps measured, the kit's fixtures and the rebuilt vehicle map has none, its bad build 0.4%. On the whole grid old maps leave up to 37% bare, roofs nobody sees: a warning there. */
export const COVER_FAIL = 0.001;
/** The columns go this far off the grid, so that none runs down a wall's plane; under WALKED_LEAST of the floor walked, the whole is asked. */
const [OFF, WALKED_LEAST] = [[0.37, 0.29], 0.1];
const place = (p) => p.map((v) => Math.round(v)).join(" ");

/** The contents down a vertical line at x, y from `top` to `bottom` in a tree: `[{ contents, top, bottom }]`, top first. */
function column(bsp, node, x, y, top, bottom, out = []) {
  if (node < 0) {
    const { contents } = bsp.leaves[-1 - node];
    if (out.at(-1)?.contents === contents) out.at(-1).bottom = bottom;
    else out.push({ contents, top, bottom });
    return out;
  }
  const { normal: n, dist } = bsp.planes[bsp.nodes[node].plane];
  const [front, back] = bsp.nodes[node].children;
  const [da, db] = [top, bottom].map((z) => n[0] * x + n[1] * y + n[2] * z - dist);
  if ((da >= 0) === (db >= 0)) return column(bsp, da >= 0 ? front : back, x, y, top, bottom, out);
  const mid = top + (bottom - top) * (da / (da - db));
  column(bsp, da >= 0 ? front : back, x, y, top, mid, out);
  return column(bsp, da >= 0 ? back : front, x, y, mid, bottom, out);
}

/** Whether x, y is inside a convex polygon of the plan, or within EDGE of its sides. */
function within(corners, x, y) {
  let sign = 0;
  for (let k = 0; k < corners.length; k++) {
    const [[ax, ay], [bx, by]] = [corners[k], corners[(k + 1) % corners.length]];
    const length = Math.hypot(bx - ax, by - ay);
    const c = length < 1e-6 ? 0 : ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / length;
    if (Math.abs(c) <= EDGE) continue;
    if (sign && Math.sign(c) !== sign) return false;
    sign = Math.sign(c);
  }
  return true;
}

/**
 * Whether the floor of a compiled map (`bsp`: `readBsp`'s result or the bytes) has its faces. A column every `step` (16)
 * units of the plan goes down the world's tree; each place where 32 of open air lie on solid and a body fits (hull 1, or
 * a crouching hull 3) is a sample: with `walk` (the default) those the walk test walks (`reachOf`, or `reach` given), the
 * whole grid when the walk reaches under a tenth of it (a vehicle map with a point hull) or with `walk: false`. A sample
 * is covered by a face looking up, of the world or of a drawn brush entity (not a trigger), over it within `tolerance`
 * (2) of the stop, or by being inside such an entity (a func_water down past the floor). `ignore` (`[{ min, max }]`)
 * names floors meant to have no face. Uncovered floor WARNs, over COVER_FAIL of the walked samples FAILs. Returns `{ passed,
 * level, said, failures, warnings, facts, samples, uncovered, share, places }`, `places` `[{ at, size: [x, y], samples, area }]`.
 */
export function floorCover(input, options = {}) {
  const { step = STEP, tolerance = TOLERANCE, walk = true, ignore = [] } = options;
  const bsp = Buffer.isBuffer(input) || input instanceof Uint8Array ? readBsp(input) : input;
  const facts = [];
  let reach = walk ? options.reach ?? reachOf(bsp) : null;
  if (reach && !(reach.area > 0)) [reach] = [null, facts.push("the walk test found no floor to walk: every floor of the grid is asked")]; // prettier-ignore
  // the world and every drawn brush entity, moved by its origin; their faces that look up, in buckets of the plan
  const models = [{ m: 0, shift: [0, 0, 0] }];
  for (const entity of bsp.entities) {
    const model = /^\*(\d+)$/.exec(valueOf(entity, "model") ?? "");
    if (model && bsp.models[model[1]] && !/^trigger_/.test(valueOf(entity, "classname") ?? "")) models.push({ m: Number(model[1]), shift: (valueOf(entity, "origin") ?? "0 0 0").split(/\s+/).map((v) => Number(v) || 0) }); // prettier-ignore
  }
  const buckets = new Map();
  for (const { m, shift } of models)
    for (let f = bsp.models[m].firstFace; f < bsp.models[m].firstFace + bsp.models[m].faceCount; f++) {
      const face = bsp.faces[f];
      const { normal, dist } = bsp.planes[face.plane];
      if (normal[2] * (face.side ? -1 : 1) <= 0.01 || !face.edgeCount) continue;
      const corners = Array.from({ length: face.edgeCount }, (_, k) => {
        const surfedge = bsp.surfedges[face.firstEdge + k];
        const v = bsp.vertices[bsp.edges[Math.abs(surfedge)][surfedge >= 0 ? 0 : 1]];
        return [v[0] + shift[0], v[1] + shift[1]];
      });
      const up = { normal, d: dist + normal[0] * shift[0] + normal[1] * shift[1] + normal[2] * shift[2], corners };
      const [xs, ys] = [0, 1].map((a) => corners.map((c) => Math.floor(c[a] / BUCKET)));
      for (let i = Math.min(...xs); i <= Math.max(...xs); i++) for (let j = Math.min(...ys); j <= Math.max(...ys); j++) (buckets.get(`${i},${j}`) ?? buckets.set(`${i},${j}`, []).get(`${i},${j}`)).push(up); // prettier-ignore
    }
  const covered = (x, y, z) => (buckets.get(`${Math.floor(x / BUCKET)},${Math.floor(y / BUCKET)}`) ?? []).some(({ normal: n, d, corners }) => Math.abs((d - n[0] * x - n[1] * y) / n[2] - z) <= tolerance && within(corners, x, y)); // prettier-ignore
  const buried = (p) => models.some(({ m, shift }, _, __, q = p.map((v, i) => v - shift[i])) => m > 0 && [0, 1, 2].every((i) => q[i] >= bsp.models[m].mins[i] && q[i] <= bsp.models[m].maxs[i]) && contentsAt(bsp, q, { model: m }) !== CONTENTS.EMPTY); // prettier-ignore
  const inside = (p) => ignore.some((box) => [0, 1, 2].every((i) => p[i] >= box.min[i] && p[i] <= box.max[i]));
  const { mins, maxs, headNodes } = bsp.models[0];
  const all = [];
  for (let gx = Math.ceil(mins[0] / step) * step; gx <= maxs[0]; gx += step)
    for (let gy = Math.ceil(mins[1] / step) * step; gy <= maxs[1]; gy += step) {
      const [x, y] = [gx + OFF[0], gy + OFF[1]];
      const line = column(bsp, headNodes[0], x, y, maxs[2] + 1, mins[2] - 1);
      for (let k = 1; k < line.length; k++) {
        const [air, solid] = [line[k - 1], line[k]];
        const z = air.bottom;
        if (air.contents !== CONTENTS.EMPTY || solid.contents !== CONTENTS.SOLID || air.top - z < ROOM || inside([x, y, z])) continue;
        const stands = contentsAt(bsp, [x, y, z + 37], { hull: 1 }) !== CONTENTS.SOLID;
        if (!stands && contentsAt(bsp, [x, y, z + 19], { hull: 3 }) === CONTENTS.SOLID) continue;
        const walked = reach?.walked(gx, gy, z + 32);
        const rest = options.hulls && stands && (!reach || reach.walked(gx, gy, z + 1) !== null) ? floorUnder(bsp, [x, y, z + 37], { hull: 1, reach: PIT_REACH }) : null; // prettier-ignore
        all.push({ i: gx / step, j: gy / step, z, rest, walked: walked !== null && walked !== undefined && walked >= z - 32, bare: !covered(x, y, z) && !buried([x, y, z + 1]) }); // prettier-ignore
      }
    }
  const walked0 = reach;
  let asked = reach ? all.filter((s) => s.walked) : all;
  if (reach && asked.length < WALKED_LEAST * all.length) {
    facts.push(`the walk reaches ${asked.length} of the ${all.length} samples a body fits on, under ${WALKED_LEAST * 100}%: every floor of the grid is asked, roofs and floor nobody walks to included`); // prettier-ignore
    [asked, reach] = [all, null];
  }
  const missing = asked.filter((s) => s.bare);
  // the places: samples next to each other on the grid, within 32 in height; each with its deepest
  const placesOf = (list) => {
    const at = new Map();
    for (const m of list) (at.get(`${m.i},${m.j}`) ?? at.set(`${m.i},${m.j}`, []).get(`${m.i},${m.j}`)).push(m);
    const found = [];
    for (const start of list) {
      if (start.done) continue;
      const group = [Object.assign(start, { done: true })];
      for (let g = 0; g < group.length; g++)
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const other of at.get(`${group[g].i + di},${group[g].j + dj}`) ?? []) if (!other.done && Math.abs(other.z - group[g].z) <= 32) group.push(Object.assign(other, { done: true })); // prettier-ignore
      const [is, js] = ["i", "j"].map((key) => group.reduce(([lo, hi], m) => [Math.min(lo, m[key]), Math.max(hi, m[key])], [Infinity, -Infinity]));
      const deepest = group.reduce((a, b) => ((b.deep ?? 0) > (a.deep ?? 0) ? b : a));
      found.push({ at: [((is[0] + is[1]) / 2) * step, ((js[0] + js[1]) / 2) * step, group.reduce((sum, m) => sum + m.z, 0) / group.length], size: [(is[1] - is[0] + 1) * step, (js[1] - js[0] + 1) * step], samples: group.length, area: group.length * step * step, deep: deepest.deep, deepest: [deepest.i * step + OFF[0], deepest.j * step + OFF[1], deepest.z] }); // prettier-ignore
    }
    return found.sort((a, b) => b.samples - a.samples);
  };
  const places = placesOf(missing);
  const share = asked.length ? missing.length / asked.length : 0;
  const [percent, counted] = [`${Math.round(share * 1000) / 10}%`, `${asked.length} samples of the ${reach ? "walked" : "standable"} floor every ${step} units`];
  facts.push(`${counted}; ${missing.length} have solid under them and no face of the map within ${tolerance} of it (${percent}), in ${places.length} places`); // prettier-ignore
  const warnings = places.map((p) => `floor with no face at ${place(p.at)}: ${p.samples} samples over ${p.size[0]} x ${p.size[1]} units (solid under a trace and no face on it: the game draws a hole there, a black wedge)`); // prettier-ignore
  const cure = "hlbsp drops faces of non-axial brushes it cannot cut cleanly: put a field of such prisms (terrain) in func_detail, give hlbsp -noinsidefill, and read the compile's log for the faces it dropped (Ambiguous leafnode, Illegal Brush, tiny face); a floor meant to have no face (NULL under an entity): ignore it"; // prettier-ignore
  const level = !missing.length ? "PASS" : reach && share > COVER_FAIL ? "FAIL" : "WARN";
  const said = missing.length ? `${missing.length} of ${counted} (${percent}) have solid under them and no face, in ${places.length} places, the largest ${places[0].samples} samples at ${place(places[0].at)}: ${cure}` : `every floor sample has its face (${counted})`; // prettier-ignore
  return { passed: !missing.length, level, said, failures: level === "FAIL" ? [said] : [], warnings, facts, samples: asked.length, uncovered: missing.length, share, places, ...(options.hulls ? { hulls: hullPits(all, walked0, placesOf, step, options.map) } : {}) }; // prettier-ignore
}

/** The samples where hull 1 comes to rest more than PIT_DEEP under the drawn floor, where the walk (hull 1 too) has its feet, or anywhere with no walk: `{ passed, said, warnings, facts, rise, pits, places }`. */
function hullPits(all, reach, placesOf, step, map) {
  const feet = (s) => s.rest + HULLS[1].mins[2]; // where the walk test (hull 1 too) has the feet; walked: within a step of them
  const rested = all.filter((s) => s.rest !== null && (!reach || (reach.walked(s.i * step, s.j * step, feet(s) + 1) ?? -Infinity) >= feet(s) - PIT_STEP)); // prettier-ignore
  // the hull's own height over the floor, measured, not assumed: the median rest is 36 over it for the standing hull, 0 for a point hull (compileMap's hulls: "point")
  const rise = rested.map((s) => s.rest - s.z).sort((a, b) => a - b)[Math.floor(rested.length / 2)] ?? -HULLS[1].mins[2];
  // a brush set out of the clip hulls on purpose (zhlt_noclip, in the .map when it is given) is drawn and not in hull 1: no pit
  const noclip = (map?.entities ?? []).filter((e) => String(e.zhlt_noclip ?? "0") !== "0").flatMap((e) => e.brushes ?? []).map(planesOf);
  const under = rested.filter((s) => s.z - (s.rest - rise) > PIT_DEEP);
  const meant = (s, q = [s.i * step + OFF[0], s.j * step + OFF[1], s.z - 0.5]) => noclip.some((planes) => planes.every((p) => p && p.normal[0] * q[0] + p.normal[1] * q[1] + p.normal[2] * q[2] - p.dist <= 0.5)); // prettier-ignore
  const pits = under.filter((s) => !meant(s));
  for (const s of pits) [s.deep, s.done] = [Math.round((s.z - (s.rest - rise)) * 10) / 10, false];
  const places = placesOf(pits).sort((a, b) => b.deep - a.deep);
  const warnings = places.map((p) => `hull 1 under the drawn floor at ${place(p.deepest)}: ${p.deep} deep, ${p.samples} samples over ${p.size[0]} x ${p.size[1]} units (a player's box, or a car's in a point hull, sinks into the floor the game draws: the compiler lost a brush of the clip hull there)`); // prettier-ignore
  const cure = "the clip hulls lose brushes where CLIP and props' boxes cut a field of prisms (KIT-FAULTS R12): compile with -threads 1 to have the same result each run, take the drawn field out of the clip hulls (zhlt_noclip) and give the floor its own CLIP"; // prettier-ignore
  const facts = [`hull 1 rests ${Math.round(rise * 10) / 10} over the drawn floor at the median of ${rested.length} samples of the ${reach ? "walked" : "standable"} floor every ${step} units; ${pits.length} under it by more than ${PIT_DEEP}, in ${places.length} places${noclip.length ? `; ${under.length - pits.length} more under brushes of the .map set out of the clip hulls (zhlt_noclip), meant` : ""}`]; // prettier-ignore
  const said = pits.length ? `hull 1 comes to rest more than ${PIT_DEEP} under the drawn floor at ${pits.length} samples in ${places.length} places, the deepest ${places[0].deep} at ${place(places[0].deepest)}: ${cure}` : `hull 1 rests on or over the drawn floor everywhere (${rested.length} samples of the ${reach ? "walked" : "standable"} floor every ${step} units; none more than ${PIT_DEEP} under it)`; // prettier-ignore
  return { passed: !pits.length, said, warnings, facts, rise, pits: pits.length, places };
}
