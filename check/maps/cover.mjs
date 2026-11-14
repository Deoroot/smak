// The floor's faces: where a trace down stops on solid and no face lies there, the game draws a hole. Made after a vehicle map's first build
// (2026-11-14): hlbsp dropped the floor faces of a field of turned prisms compiled as world brushes, the solid stayed, and the game and the
// kit's viewer (blamed) drew black wedges in the road; func_detail and -noinsidefill cured it. Hull 0 only: CLIP and playerclip are no floor.
import { readBsp, CONTENTS, contentsAt } from "../../core/maps/bsp.mjs";
import { valueOf } from "../../core/maps/entities.mjs";
import { reachOf } from "./reach.mjs";
/** The grid (units), how far a face may lie from the stop, the air over a floor, how near a face's edge a point is on it. */
const [STEP, TOLERANCE, ROOM, EDGE, BUCKET] = [16, 2, 32, 0.5, 128];
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
        if (contentsAt(bsp, [x, y, z + 37], { hull: 1 }) === CONTENTS.SOLID && contentsAt(bsp, [x, y, z + 19], { hull: 3 }) === CONTENTS.SOLID) continue;
        const walked = reach?.walked(gx, gy, z + 32);
        all.push({ i: gx / step, j: gy / step, z, walked: walked !== null && walked !== undefined && walked >= z - 32, bare: !covered(x, y, z) && !buried([x, y, z + 1]) }); // prettier-ignore
      }
    }
  let asked = reach ? all.filter((s) => s.walked) : all;
  if (reach && asked.length < WALKED_LEAST * all.length) {
    facts.push(`the walk reaches ${asked.length} of the ${all.length} samples a body fits on, under ${WALKED_LEAST * 100}%: every floor of the grid is asked, roofs and floor nobody walks to included`); // prettier-ignore
    [asked, reach] = [all, null];
  }
  const missing = asked.filter((s) => s.bare);
  // the places: uncovered samples next to each other on the grid, within 32 in height
  const at = new Map();
  for (const m of missing) (at.get(`${m.i},${m.j}`) ?? at.set(`${m.i},${m.j}`, []).get(`${m.i},${m.j}`)).push(m);
  const places = [];
  for (const start of missing) {
    if (start.done) continue;
    const group = [Object.assign(start, { done: true })];
    for (let g = 0; g < group.length; g++)
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const other of at.get(`${group[g].i + di},${group[g].j + dj}`) ?? []) if (!other.done && Math.abs(other.z - group[g].z) <= 32) group.push(Object.assign(other, { done: true })); // prettier-ignore
    const [is, js] = ["i", "j"].map((key) => group.reduce(([lo, hi], m) => [Math.min(lo, m[key]), Math.max(hi, m[key])], [Infinity, -Infinity]));
    places.push({ at: [((is[0] + is[1]) / 2) * step, ((js[0] + js[1]) / 2) * step, group.reduce((sum, m) => sum + m.z, 0) / group.length], size: [(is[1] - is[0] + 1) * step, (js[1] - js[0] + 1) * step], samples: group.length, area: group.length * step * step }); // prettier-ignore
  }
  places.sort((a, b) => b.samples - a.samples);
  const share = asked.length ? missing.length / asked.length : 0;
  const [percent, counted] = [`${Math.round(share * 1000) / 10}%`, `${asked.length} samples of the ${reach ? "walked" : "standable"} floor every ${step} units`];
  facts.push(`${counted}; ${missing.length} have solid under them and no face of the map within ${tolerance} of it (${percent}), in ${places.length} places`); // prettier-ignore
  const warnings = places.map((p) => `floor with no face at ${place(p.at)}: ${p.samples} samples over ${p.size[0]} x ${p.size[1]} units (solid under a trace and no face on it: the game draws a hole there, a black wedge)`); // prettier-ignore
  const cure = "hlbsp drops faces of non-axial brushes it cannot cut cleanly: put a field of such prisms (terrain) in func_detail, give hlbsp -noinsidefill, and read the compile's log for the faces it dropped (Ambiguous leafnode, Illegal Brush, tiny face); a floor meant to have no face (NULL under an entity): ignore it"; // prettier-ignore
  const level = !missing.length ? "PASS" : reach && share > COVER_FAIL ? "FAIL" : "WARN";
  const said = missing.length ? `${missing.length} of ${counted} (${percent}) have solid under them and no face, in ${places.length} places, the largest ${places[0].samples} samples at ${place(places[0].at)}: ${cure}` : `every floor sample has its face (${counted})`; // prettier-ignore
  return { passed: !missing.length, level, said, failures: level === "FAIL" ? [said] : [], warnings, facts, samples: asked.length, uncovered: missing.length, share, places }; // prettier-ignore
}
