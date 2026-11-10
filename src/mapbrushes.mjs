// Collision brushes rebuilt from a GoldSrc map's trees, for its Source port (src/source/map.mjs). GoldSrc keeps no
// brushes; Source traces against them. Ported from stevenlafl's tools/map/brushes.mjs.
//
//   regionOf(planes)                                   the convex region behind every plane, or null
//   brushesOfTree(bsp, head, isBrush, mins, maxs)      one brush for each solid or liquid leaf of the drawn tree
//   brushesOfClipHull(bsp, head, half, mins, maxs)     the brushes of a clip hull, shrunk back to the drawn shape
//   clipContents(bsp, head, point)                     GoldSrc's contents at a point of a clip hull
//   clipOutsideHull(bsp, brush, head, half)            how much of a rebuilt clip brush, grown, leaves a hull
//   clipBrushesOf(bsp, { skySolid })                   the world's clip brushes: those of hulls 1 and 3 open in hull 0
//
// THE DRAWN TREE (hull 0). Each of its solid or liquid leaves is the convex region the planes on the way down to it
// cut out, so each becomes one brush: those planes facing out of it, less the ones that do not touch it, plus
// bevels, axial and on slanted edges, as vbsp adds them (so that a box trace does not catch on a slanted brush's
// edges and corners). A region open to the void is closed by a box a little outside the map.
//
// THE CLIP HULLS (1 to 3). GoldSrc's CLIP brushes block players and monsters but not bullets or sight: qcsg builds
// them into the player's hulls only, each brush first grown by the player's box. Each solid region of a hull, its
// sides that face open space moved back in by the box's reach along them, is the brush again.

import { leafAt } from "./maps/bsp.mjs";

const ON_EPSILON = 0.01;
const BIG = 65536;
const BOUNDS_MARGIN = 64;
const GS_SOLID = -2;
// GoldSrc's contents (bspfile.h) a drawn leaf has, other than open
const GS_FILLED = new Set([-2, -3, -4, -5, -6]);
const GS_SKY = -6;
// half the player's standing and ducked boxes, which qcsg grew hulls 1 and 3's brushes by
const PLAYER_HALF = [16, 16, 36];
const DUCKED_HALF = [16, 16, 18];

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

// a square on the plane, far bigger than any map (Quake's BaseWindingForPlane)
function baseWinding(n, d) {
  let axis = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(n[i]) > Math.abs(n[axis])) axis = i;
  let up = axis === 2 ? [1, 0, 0] : [0, 0, 1];
  const along = dot(up, n);
  up = unit([up[0] - n[0] * along, up[1] - n[1] * along, up[2] - n[2] * along]);
  const right = cross(up, n);
  const o = [n[0] * d, n[1] * d, n[2] * d];
  const u = up.map((x) => x * BIG);
  const r = right.map((x) => x * BIG);
  return [
    [o[0] - r[0] + u[0], o[1] - r[1] + u[1], o[2] - r[2] + u[2]],
    [o[0] + r[0] + u[0], o[1] + r[1] + u[1], o[2] + r[2] + u[2]],
    [o[0] + r[0] - u[0], o[1] + r[1] - u[1], o[2] + r[2] - u[2]],
    [o[0] - r[0] - u[0], o[1] - r[1] - u[1], o[2] - r[2] - u[2]],
  ];
}

// the part of a winding behind the plane (dot(n, x) <= d)
function clipBehind(w, n, d) {
  const dists = w.map((p) => dot(n, p) - d);
  if (dists.every((x) => x <= ON_EPSILON)) return w;
  if (dists.every((x) => x >= -ON_EPSILON)) return null;
  const out = [];
  for (let i = 0; i < w.length; i++) {
    const p = w[i];
    const q = w[(i + 1) % w.length];
    const dp = dists[i];
    const dq = dists[(i + 1) % w.length];
    if (dp <= ON_EPSILON) out.push(p);
    if ((dp > ON_EPSILON && dq < -ON_EPSILON) || (dp < -ON_EPSILON && dq > ON_EPSILON)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
    }
  }
  return out.length >= 3 ? out : null;
}

/**
 * The convex region bounded by `planes` (each { normal, dist }, the region behind all of them):
 * `{ sides: [index into planes], windings, mins, maxs }`, only the planes that bound it (each side's face in
 * `windings`), or null when it has no volume.
 */
export function regionOf(planes) {
  const sides = [];
  const windings = [];
  const mins = [Infinity, Infinity, Infinity];
  const maxs = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < planes.length; i++) {
    let w = baseWinding(planes[i].normal, planes[i].dist);
    for (let j = 0; j < planes.length && w; j++) if (j !== i) w = clipBehind(w, planes[j].normal, planes[j].dist);
    if (!w) continue;
    sides.push(i);
    windings.push(w);
    for (const p of w)
      for (let k = 0; k < 3; k++) {
        if (p[k] < mins[k]) mins[k] = p[k];
        if (p[k] > maxs[k]) maxs[k] = p[k];
      }
  }
  if (sides.length < 4) return null;
  for (let k = 0; k < 3; k++) if (maxs[k] - mins[k] < ON_EPSILON * 10) return null;
  return { sides, windings, mins, maxs };
}

// the box a little outside the map that closes a region open to the void
function boundsBox(worldMins, worldMaxs) {
  const box = [];
  for (let k = 0; k < 3; k++) {
    const n = [0, 0, 0];
    n[k] = 1;
    box.push({ normal: n, dist: worldMaxs[k] + BOUNDS_MARGIN, box: true });
    const m = [0, 0, 0];
    m[k] = -1;
    box.push({ normal: m, dist: -(worldMins[k] - BOUNDS_MARGIN), box: true });
  }
  return box;
}

/**
 * Every brush of one model's drawn tree, walked from node `head`. `isBrush(leaf)` says what a leaf makes: null for
 * none, or the brush's Source contents. Returns `[{ node, side, leafChild, contents, planes: [{ normal, dist,
 * bevel }], mins, maxs }]`, one for each place the tree reaches such a leaf, in walk order; `leafChild` is the
 * node's child (under 0) that reached it, and `node` and `side` where it hangs.
 */
export function brushesOfTree(bsp, head, isBrush, worldMins, worldMaxs) {
  const box = boundsBox(worldMins, worldMaxs);
  const found = [];
  const path = [];
  const walk = (node) => {
    const { plane, children } = bsp.nodes[node];
    const p = bsp.planes[plane];
    for (let side = 0; side < 2; side++) {
      // the front: the region is in front of the plane, so its side faces the other way
      path.push(side === 0 ? { normal: p.normal.map((x) => -x), dist: -p.dist } : { normal: p.normal, dist: p.dist });
      const child = children[side];
      if (child >= 0) walk(child);
      else {
        const contents = isBrush(-1 - child);
        if (contents !== null) {
          const planes = [...path, ...box];
          const region = regionOf(planes);
          if (region)
            found.push({
              node,
              side,
              leafChild: child,
              contents,
              planes: withBevels(region.sides.map((i) => planes[i]), region.mins, region.maxs, region.windings),
              mins: region.mins,
              maxs: region.maxs,
            });
        }
      }
      path.pop();
    }
  };
  walk(head);
  return found;
}

/** The contents (GoldSrc's, under 0) at point `p` of a model's clip hull, walked from clipnode `head`. */
export function clipContents(bsp, head, p) {
  let n = head;
  while (n >= 0) {
    const { plane, children } = bsp.clipnodes[n];
    const pl = bsp.planes[plane];
    n = children[dot(pl.normal, p) - pl.dist >= 0 ? 0 : 1];
  }
  return n;
}

/**
 * The brushes of a clip hull (hull 1, the standing player's; 3, the ducked one's), as the shape the mapper drew:
 * each solid region of the hull, its sides moved back in by the reach of the box (`half`, its half size) the
 * brushes were grown by, a side against more solid less so. Returns `[{ planes: [{ normal, dist, bevel }], points
 * (its corners), mins, maxs }]`, the drawn world's own brushes among them.
 */
export function brushesOfClipHull(bsp, head, half, worldMins, worldMaxs) {
  const box = boundsBox(worldMins, worldMaxs);
  const found = [];
  const path = [];
  const walk = (node) => {
    const { plane, children } = bsp.clipnodes[node];
    const p = bsp.planes[plane];
    for (let side = 0; side < 2; side++) {
      path.push(side === 0 ? { normal: p.normal.map((x) => -x), dist: -p.dist } : { normal: p.normal, dist: p.dist });
      const child = children[side];
      if (child >= 0) walk(child);
      else if (child === GS_SOLID) {
        const planes = [...path, ...box];
        const grown = regionOf(planes);
        if (grown) {
          const sidePlanes = grown.sides.map((i) => planes[i]);
          const reachOf = (pl) => (pl.box ? 0 : Math.abs(pl.normal[0]) * half[0] + Math.abs(pl.normal[1]) * half[1] + Math.abs(pl.normal[2]) * half[2]); // prettier-ignore
          // how deep solid runs beyond side k, up to the box's reach, sampled across the side as wide as the box
          // reaches past it (each other side pushed out by `out[j]`): a side wholly against more solid (where the
          // tree split one solid apart) stays, one facing open space moves in the whole reach, and one against a
          // layer thinner than the reach, or only partly against solid (an umbrella's canopy over its pole), by
          // what is missing
          const moveIn = (k, out) => {
            const pl = sidePlanes[k];
            if (pl.box) return 0;
            const reach = reachOf(pl);
            const wide = regionOf(sidePlanes.map((o, j) => (j === k ? o : { normal: o.normal, dist: o.dist + out[j] })));
            const at = wide?.sides.indexOf(k) ?? -1;
            const w = at >= 0 ? wide.windings[at] : grown.windings[k];
            const mid = [0, 1, 2].map((c) => w.reduce((sum, v) => sum + v[c], 0) / w.length);
            // a grid across the side too: an opening in a long side (datacore's window in a wall 900 high) fell
            // between the few probes at its middle, corners and edges, and the wall's growth came back as clip
            const probes = [mid, ...facePoints(w, pl.normal, mid)];
            for (let v = 0; v < w.length; v++) {
              const a = w[v].map((x, c) => mid[c] + (x - mid[c]) * 0.98);
              const b = w[(v + 1) % w.length].map((x, c) => mid[c] + (x - mid[c]) * 0.98);
              probes.push(a, a.map((x, c) => (x + b[c]) / 2), a.map((x, c) => (x + mid[c]) / 2));
            }
            let depth = reach;
            for (const q of probes) {
              for (let t = 0.5; t < depth; t += 1)
                if (clipContents(bsp, head, q.map((v, c) => v + pl.normal[c] * t)) !== GS_SOLID) {
                  depth = Math.max(0, t - 1);
                  break;
                }
              if (depth === 0) break;
            }
            return reach - depth;
          };
          // first each side over itself, then as wide as the others reach once they have moved in (a side the tree
          // split a thin brush along kept the brush; widened by every side's whole reach, it looked out past the
          // brush's top and moved in, and the fence clip along a balcony was lost)
          const first = sidePlanes.map((_, k) => moveIn(k, sidePlanes.map(() => 0)));
          const out = sidePlanes.map((pl, j) => reachOf(pl) - first[j]);
          const shrunk = sidePlanes.map((pl, k) => {
            const by = Math.max(first[k], moveIn(k, out));
            return by > 0 ? { normal: pl.normal, dist: pl.dist - by } : pl;
          });
          const region = regionOf(shrunk);
          // one against the box round the map holds the void outside it too (hlbsp splits no solid from solid, so
          // a clip brush on the map's edge can share its region with the void): harmless as clip
          if (region)
            found.push({
              planes: withBevels(region.sides.map((i) => shrunk[i]), region.mins, region.maxs, region.windings),
              points: region.windings.flat(),
              mins: region.mins,
              maxs: region.maxs,
            });
        }
      }
      path.pop();
    }
  };
  walk(head);
  return found;
}

/**
 * How much of a rebuilt clip brush, grown by a player's box (`half`), falls outside that player's hull (`head`)
 * where it should be solid: the share of points, in a grid across each of its faces pushed out to a unit short of
 * the box's reach, that the hull has open. GoldSrc compiles a clip brush into every hull, so a true one grown by
 * the ducked box lies inside hull 3 as it does by the standing one inside hull 1; a sliver of a wall's growth
 * that one hull's rebuild kept (datacore: a 2 unit plate 36 high under a ledge, from hull 1) does not.
 */
export function clipOutsideHull(bsp, brush, head, half) {
  const region = regionOf(brush.planes.filter((p) => !p.bevel));
  if (!region) return 1;
  let open = 0;
  let all = 0;
  region.sides.forEach((i, k) => {
    const { normal } = brush.planes.filter((p) => !p.bevel)[i];
    const w = region.windings[k];
    const mid = [0, 1, 2].map((c) => w.reduce((sum, v) => sum + v[c], 0) / w.length);
    const out =
      Math.abs(normal[0]) * half[0] + Math.abs(normal[1]) * half[1] + Math.abs(normal[2]) * half[2] - 1;
    for (const q of [mid, ...facePoints(w, normal, mid)]) {
      all++;
      if (
        clipContents(
          bsp,
          head,
          q.map((v, c) => v + normal[c] * out),
        ) !== GS_SOLID
      )
        open++;
    }
  });
  return all ? open / all : 1;
}

/**
 * Points in a grid across a convex face (`w`, its plane's normal `n`, its middle `mid`), drawn 2% in from its
 * edges: about 24 a side across the longer way, none closer than 4 units.
 */
function facePoints(w, n, mid) {
  const u = unit(cross(n, Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  const v = cross(n, u);
  const flat = w.map((p) => {
    const d = [p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]];
    return [dot(d, u) * 0.98, dot(d, v) * 0.98];
  });
  const lo = [Math.min(...flat.map((p) => p[0])), Math.min(...flat.map((p) => p[1]))];
  const hi = [Math.max(...flat.map((p) => p[0])), Math.max(...flat.map((p) => p[1]))];
  const step = Math.max(4, Math.max(hi[0] - lo[0], hi[1] - lo[1]) / 24);
  // inside when on the same side of every edge as the middle (0, 0)
  const sides = flat.map((a, i) => {
    const b = flat[(i + 1) % flat.length];
    return (q) => (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
  });
  const inward = sides.map((s) => Math.sign(s([0, 0])) || 1);
  const out = [];
  for (let a = lo[0] + step / 2; a < hi[0]; a += step)
    for (let b = lo[1] + step / 2; b < hi[1]; b += step)
      if (sides.every((s, i) => s([a, b]) * inward[i] >= 0))
        out.push([0, 1, 2].map((c) => mid[c] + u[c] * a + v[c] * b));
  return out;
}

/**
 * A brush's bevels, as vbsp's AddBrushBevels adds them: axial planes at the region's bounds where it has none of
 * its own, then edge bevels: for each slanted edge of a side, the plane through it at right angles to an axis
 * that the whole brush is behind. Source tests a box against a brush's planes only, so without them a box near
 * a slanted edge is caught where it is clear (stalkyard, 2026-10-25: a player blocked up to 8 units short of
 * where GoldSrc's hull 1 stops it, by the beams under its ceilings).
 */
function withBevels(sides, mins, maxs, windings = []) {
  const out = [...sides];
  for (let k = 0; k < 3; k++)
    for (const sign of [1, -1]) {
      if (sides.some((s) => Math.abs(s.normal[k] - sign) < 1e-5)) continue;
      const n = [0, 0, 0];
      n[k] = sign;
      out.push({ normal: n, dist: sign > 0 ? maxs[k] : -mins[k], bevel: true });
    }
  const points = windings.flat();
  const has = (n, d) => out.some((p) => Math.abs(dot(p.normal, n) - 1) < 1e-5 && Math.abs(p.dist - d) < 0.01);
  for (const w of windings)
    for (let j = 0; j < w.length; j++) {
      const a = w[j];
      const b = w[(j + 1) % w.length];
      const edge = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      if (Math.hypot(...edge) < 0.5) continue;
      const along = unit(edge);
      // an axial edge has its bevels among the axial planes already
      if (along.some((x) => Math.abs(Math.abs(x) - 1) < 1e-5)) continue;
      for (let k = 0; k < 3; k++)
        for (const sign of [1, -1]) {
          const axis = [0, 0, 0];
          axis[k] = sign;
          const c = cross(along, axis);
          if (Math.hypot(...c) < 0.5) continue;
          const n = unit(c);
          const d = dot(a, n);
          if (has(n, d)) continue;
          if (points.every((p) => dot(p, n) - d <= 0.1)) out.push({ normal: n, dist: d, bevel: true });
        }
    }
  return out;
}

/**
 * The clip brushes of a map's world, rebuilt from hulls 1 and 3 (brushesOfClipHull): those open in hull 0, where
 * the drawn world is not; the rest are the world's own, already solid. Returns brushesOfClipHull's. `skySolid`: the
 * sky's brushes rebuilt too, for a port where the sky is a picture, not solid (s&box: TS's ts_lobby let a player
 * through its sky walls, 222 of 229 spots blocked only in GoldSrc, 2026-10-28); Source's sky brushes are solid.
 */
/**
 * A brush entity's solids (model `model`, 1 and up) as the mapper drew them, from its standing hull: every one,
 * the faces it never draws too (a NULL-textured lid on a cage, solid in GoldSrc whatever is drawn). Returns
 * `[{ planes, points, mins, maxs }]` as `brushesOfClipHull`, in the model's own space.
 */
export function entityBrushesOf(bsp, model) {
  const { headNodes, mins, maxs } = bsp.models[model];
  return headNodes[1] >= 0 ? brushesOfClipHull(bsp, headNodes[1], PLAYER_HALF, mins, maxs) : [];
}

export function clipBrushesOf(bsp, { skySolid = false } = {}) {
  const world = bsp.models[0];
  const openInDrawn = (p) => {
    const leaf = leafAt(bsp, p);
    const contents = bsp.leaves[leaf].contents;
    return leaf !== 0 && (!GS_FILLED.has(contents) || (skySolid && contents === GS_SKY));
  };
  const SAMPLES = [0.1, 0.3, 0.5, 0.7, 0.9];
  // from both the standing and the ducked hull: a clip brush on the floor merges into the floor's growth in hull 1
  // for 36 units up, where hull 3 loses only 18 (a balcony's fence came out of hull 1 a 4 unit sliver a ducked
  // player passed under)
  return [
    ...brushesOfClipHull(bsp, world.headNodes[1], PLAYER_HALF, world.mins, world.maxs),
    ...brushesOfClipHull(bsp, world.headNodes[3], DUCKED_HALF, world.mins, world.maxs),
  ].filter((b) => {
    for (const x of SAMPLES)
      for (const y of SAMPLES)
        for (const z of SAMPLES) {
          const p = [x, y, z].map((f, k) => b.mins[k] + (b.maxs[k] - b.mins[k]) * f);
          if (b.planes.every((pl) => dot(pl.normal, p) - pl.dist < -0.25) && openInDrawn(p)) return true;
        }
    return false;
  })
    // a true clip brush grown by either player's box lies inside that player's hull; a piece of a wall's growth
    // that one hull's rebuild kept does not. 10% let by, for the trees' rounding: at 2% clip of TS's bikini was
    // lost (32 spots blocked only in GoldSrc where no filter leaves 24), at none one of c1a0's; at 10% none
    // measured on Half-Life's eight maps or bikini
    .filter((b) => clipOutsideHull(bsp, b, world.headNodes[1], PLAYER_HALF) <= 0.1 && clipOutsideHull(bsp, b, world.headNodes[3], DUCKED_HALF) <= 0.1); // prettier-ignore
}
