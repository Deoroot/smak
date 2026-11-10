// A compiled map (.bsp, version 30) made back into brush source (.map, Valve 220): the retail maps ship
// compiled, and their sources were never released. This is a port of bsp2map.py from Steven Linn's
// goldsrc.net project (godot/tools/bsp2map), which decompiles and recompiles all 127 of Half-Life's maps
// with SDHLT; its README holds the full account of each rule below and the map that taught it. The port
// writes the same text, number for number.
//
// THE METHOD, in short:
//   solids from the tree   each model's hull-0 tree is walked; every leaf that is not empty (solid, water,
//                          slime, lava, sky) is the convex region the planes on its path cut out of the
//                          model's box, built by clipping (`polytope`). One brush a region: watertight and
//                          exact, split along the tree's planes. Cells whose union is convex are merged.
//   textures from faces    a brush face on a node's plane wears the texinfo of the face of the same model on
//                          that plane, facing the same way, that overlaps it most, written as Valve 220 axes
//                          (lossless). A brush face that spans faces of several texinfos is cut along their
//                          edges. A face no face covers is NULL (the compilers drop it), or sky in a sky leaf.
//   what a compiler takes  near-coplanar planes unified first; no face under half a square unit; no acute
//                          wedge (snapped, capped, or its tip cut); no face of over 24 corners; one content a
//                          brush; thin empty seams and the void's pockets filled; a brush model clipped to
//                          its own box; a hollow brush entity filled.
//   entities               verbatim, but for what the compiler wants otherwise: a brush entity compiled
//                          round an ORIGIN brush is put back in world space with its ORIGIN brush again and
//                          no `origin` key; the worldspawn's `wad` list is bare names of files that exist;
//                          `zhlt_noclip` on the brush entities that never collide.
//
//   decompile(bspBytes, options) -> { map, facts, warnings, wad }
//
// Lost by construction: brushes of clip only (hulls 1 to 3 carry no textures), the mapper's own split of
// the brushes, and the light, which the compile works out again (texlights.mjs holds the texture lights).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readBsp, CONTENTS } from "../../core/maps/bsp.mjs";
import { lumpBytes } from "../../core/maps/lumps.mjs";

// ── the numbers the rules were found at ────────────────────────────────────
/** A point this near a plane is on it (units). */
const EPS = 0.01;
/** A face under this many square units is dropped by hlcsg, and the brush runs to the world's edge. */
const MIN_FACE = 0.5;
/** hlbsp takes a face of 28 corners at most; this leaves room for those CSG adds. */
const MAX_VERTS = 24;
/** Distinct cut lines a brush face is cut along at most. */
const MAX_CUTS = 256;
/** How far past its box a model is walked (units). */
const PAD = 64;
/** How far past the world's box the first, measuring walk goes: air out there is the void. */
const WIDE = 4096;
const radians = (degrees) => degrees * (Math.PI / 180);
/** Two planes within half a degree are near coincident. */
const COS_HALF_DEG = Math.cos(radians(0.5));
/** A pair of faces within 3 degrees of opposite, crossing, is an acute wedge. */
const COS_ACUTE = Math.cos(radians(3.0));
const { EMPTY, SOLID, WATER, SLIME, LAVA, SKY } = CONTENTS;
const LIQUID = [WATER, SLIME, LAVA];
/** SOLID_NOT in the SDK: their clip hulls are never used. */
const NOCLIP_CLASSES = ["func_illusionary", "env_bubbles"];

// ── small arithmetic, in the same order of operations as the Python ───────
// (the same order gives the same doubles, and so the same text)
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const length = (a) => Math.sqrt(dot(a, a));
const norm = (a) => {
  const l = length(a);
  return l > 0 ? mul(a, 1.0 / l) : a;
};
const neg = (a) => [-a[0], -a[1], -a[2]];
const sumPts = (pts) => {
  let s = [0.0, 0.0, 0.0];
  for (const p of pts) s = add(s, p);
  return s;
};

/**
 * A number rounded to `digits` decimals as Python's round() does it, as text: correctly rounded from the
 * double's exact value, a tie to the even digit, and "-0" written "0". Two numbers round to one double in
 * Python exactly when their texts here are the same, so the text serves as a key too.
 */
export function roundText(x, digits) {
  if (Number.isInteger(x)) return String(x + 0);
  const scaled = Math.abs(x) * 10 ** digits;
  let text;
  if (Math.abs((scaled % 1) - 0.5) > 1e-6) text = x.toFixed(digits);
  else {
    // near a tie: decided on the exact decimal expansion of the double
    const exact = Math.abs(x).toFixed(100);
    const [whole, fraction] = exact.split(".");
    const rest = fraction.slice(digits);
    let n = BigInt(whole + fraction.slice(0, digits));
    const tie = rest[0] === "5" && !/[1-9]/.test(rest.slice(1));
    if (rest[0] > "5" || (rest[0] === "5" && !tie) || (tie && n % 2n === 1n)) n += 1n;
    const s = n.toString().padStart(digits + 1, "0");
    text = `${x < 0 && n !== 0n ? "-" : ""}${s.slice(0, s.length - digits)}${digits ? `.${s.slice(-digits)}` : ""}`;
  }
  if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
  return text === "-0" ? "0" : text;
}
/** A number as the .map gets it: five decimals at most, no trailing zeros. */
const g = (x) => roundText(x, 5);
const pt = (p) => `( ${g(p[0])} ${g(p[1])} ${g(p[2])} )`;

// ── tags: what plane a face is on ──────────────────────────────────────────
// A face on a tree plane is tagged "T<plane key>#<side>"; a side of the walk's box "B<axis>:<sign>"; a plane
// made here (a cut, a snap, a cap, a tip, a shell face) "G<kind><n>", unique, so one can be replaced by name.
const treeTag = (key, side) => `T${key}#${side}`;
const isTreeTag = (tag) => tag !== null && tag[0] === "T";
const isBoxTag = (tag) => tag !== null && tag[0] === "B";
const boxTag = (axis, sign) => `B${axis}:${sign}`;
const keyOfTag = (tag) => tag.slice(1, tag.lastIndexOf("#"));
const boxSideOf = (tag) => tag.slice(1).split(":").map(Number);

// ── a convex solid from half-spaces, by clipping ───────────────────────────
/** The part of a polygon with n . p - d <= 0. */
function clipPoly(poly, n, d) {
  const out = [];
  const m = poly.length;
  for (let i = 0; i < m; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % m];
    const da = dot(n, a) - d;
    const db = dot(n, b) - d;
    if (da <= EPS) out.push(a);
    if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)) {
      const t = da / (da - db);
      out.push(add(a, mul(sub(b, a), t)));
    }
  }
  return out;
}

/** The new face on plane (n, d) that closes a solid after a clip: the cut's segments, put in order. */
function capPoly(faces, n, d) {
  const near = (p, q) => length(sub(p, q)) < EPS * 10;
  const segs = [];
  for (const f of faces) {
    const pts = f.poly;
    const m = pts.length;
    const onplane = [];
    for (let i = 0; i < m; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % m];
      const da = dot(n, a) - d;
      const db = dot(n, b) - d;
      if (Math.abs(da) <= EPS) onplane.push(a);
      if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)) {
        const t = da / (da - db);
        onplane.push(add(a, mul(sub(b, a), t)));
      }
    }
    const uniq = [];
    for (const p of onplane) if (!uniq.some((q) => near(p, q))) uniq.push(p);
    if (uniq.length >= 2) segs.push([uniq[0], uniq[1]]);
  }
  if (segs.length < 3) return [];
  const pts = [];
  for (const s of segs) for (const p of s) if (!pts.some((q) => near(p, q))) pts.push(p);
  if (pts.length < 3) return [];
  const c = mul(sumPts(pts), 1.0 / pts.length);
  const ax = norm(sub(pts[0], c));
  const ay = cross(n, ax);
  const angle = (p) => Math.atan2(dot(sub(p, c), ay), dot(sub(p, c), ax));
  const keyed = pts.map((p) => [angle(p), p]);
  keyed.sort((a, b) => a[0] - b[0]);
  return keyed.map((k) => k[1]);
}

/**
 * The convex solid behind every plane of `planes` ([n, d, tag], inside where n . p - d <= 0), cut out of the
 * box `bounds` ([mins, maxs]): its faces `{ n, d, tag, poly }`, or [] when nothing is left.
 */
function polytope(planes, bounds) {
  const [[x0, y0, z0], [x1, y1, z1]] = bounds;
  let faces = [
    {
      n: [-1, 0, 0],
      d: -x0,
      tag: boxTag(0, -1),
      poly: [
        [x0, y0, z0],
        [x0, y0, z1],
        [x0, y1, z1],
        [x0, y1, z0],
      ],
    },
    {
      n: [1, 0, 0],
      d: x1,
      tag: boxTag(0, 1),
      poly: [
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x1, y0, z1],
      ],
    },
    {
      n: [0, -1, 0],
      d: -y0,
      tag: boxTag(1, -1),
      poly: [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [x0, y0, z1],
      ],
    },
    {
      n: [0, 1, 0],
      d: y1,
      tag: boxTag(1, 1),
      poly: [
        [x0, y1, z0],
        [x0, y1, z1],
        [x1, y1, z1],
        [x1, y1, z0],
      ],
    },
    {
      n: [0, 0, -1],
      d: -z0,
      tag: boxTag(2, -1),
      poly: [
        [x0, y0, z0],
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y0, z0],
      ],
    },
    {
      n: [0, 0, 1],
      d: z1,
      tag: boxTag(2, 1),
      poly: [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
    },
  ];
  for (const [n, d, tag] of planes) {
    // a plane that cuts nothing is passed over
    if (faces.every((f) => f.poly.every((p) => dot(n, p) - d <= EPS))) continue;
    const next = [];
    for (const f of faces) {
      const poly = clipPoly(f.poly, n, d);
      if (poly.length >= 3) next.push({ n: f.n, d: f.d, tag: f.tag, poly });
    }
    const cap = capPoly(faces, n, d);
    faces = next;
    if (cap.length >= 3) faces.push({ n, d, tag, poly: cap });
    if (faces.length < 4) return [];
  }
  return faces;
}

function polyArea(poly, n) {
  let a = [0.0, 0.0, 0.0];
  for (let i = 0; i < poly.length; i++) a = add(a, cross(poly[i], poly[(i + 1) % poly.length]));
  return Math.abs(dot(a, n)) * 0.5;
}
/** A closed convex solid's volume: each face's area times its distance from the origin, over three. */
function brushVolume(faces) {
  let v = 0.0;
  for (const f of faces) if (f.poly.length) v += (polyArea(f.poly, f.n) * f.d) / 3.0;
  return v;
}
const minFaceArea = (faces) => (faces.length ? Math.min(...faces.map((f) => polyArea(f.poly, f.n))) : 0.0);

/** The area of `poly` inside the convex polygon `clip`, both on the plane of normal n. */
function overlapArea(poly, clip, n) {
  const m = clip.length;
  for (let i = 0; i < m; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % m];
    const inward = cross(n, sub(b, a));
    if (length(inward) < 1e-6) continue;
    const outward = mul(inward, -1.0);
    poly = clipPoly(poly, outward, dot(outward, a));
    if (poly.length < 3) return 0.0;
  }
  return polyArea(poly, n);
}

// ── the shapes a compiler refuses ──────────────────────────────────────────
function nearCoincident(n1, d1, n2, d2, dist = 1.0) {
  const c = dot(n1, n2);
  if (c > COS_HALF_DEG) return Math.abs(d1 - d2) < dist;
  if (c < -COS_HALF_DEG) return Math.abs(d1 + d2) < dist;
  return false;
}

/**
 * For the most acute crossing pair of faces, the plane that keeps only where the wedge is at least
 * `minThickness` thick: [plane, i, j, thin], or null. A pair parallel within 0.03 degrees is a slab, and a
 * thickness is compared with a thousandth of tolerance.
 */
function acuteTipPlane(faces, minThickness = 1.0) {
  let best = null;
  for (let i = 0; i < faces.length; i++)
    for (let j = i + 1; j < faces.length; j++) {
      const { n: n1, d: d1 } = faces[i];
      const { n: n2, d: d2 } = faces[j];
      const c = dot(n1, n2);
      if (c > -COS_ACUTE || c < -(1.0 - 1e-7)) continue;
      const m = add(n1, n2);
      const lm = length(m);
      if (lm < 1e-9) continue;
      const thin = [faces[i], faces[j]].some((f) =>
        f.poly.some((p) => d1 + d2 - dot(m, p) < minThickness - 1e-3),
      );
      if (best === null || c < best[0])
        best = [c, [[mul(m, 1.0 / lm), (d1 + d2 - minThickness) / lm, null], i, j, thin]];
    }
  return best ? best[1] : null;
}

/** Is the region a slab or wedge under `maxThickness` everywhere, or no region at all? */
function thinRegion(planes, bounds, maxThickness = 1.0) {
  const faces = polytope(planes, bounds);
  if (faces.length < 4 || brushVolume(faces) < 0.5) return true;
  for (let i = 0; i < faces.length; i++)
    for (let j = i + 1; j < faces.length; j++) {
      const { n: n1, d: d1 } = faces[i];
      const { n: n2, d: d2 } = faces[j];
      if (dot(n1, n2) > -0.999) continue;
      const m = add(n1, n2);
      if (faces.every((f) => f.poly.every((p) => d1 + d2 - dot(m, p) < maxThickness - 1e-3))) return true;
    }
  return false;
}

/** Does any acute pair of faces thin below `minThickness` inside the brush? (a cut that makes one is refused) */
function hasThinAcute(faces, minThickness = 1.0) {
  for (let i = 0; i < faces.length; i++)
    for (let j = i + 1; j < faces.length; j++) {
      const { n: n1, d: d1 } = faces[i];
      const { n: n2, d: d2 } = faces[j];
      const c = dot(n1, n2);
      if (c > -COS_ACUTE || c < -(1.0 - 1e-7)) continue;
      const m = add(n1, n2);
      if ([faces[i], faces[j]].some((f) => f.poly.some((p) => d1 + d2 - dot(m, p) < minThickness - 1e-3)))
        return true;
    }
  return false;
}

/** Two big faces within about 0.05 degrees of parallel without being parallel: a wedge hlcsg cannot wind. */
function isWedge(faces) {
  for (let i = 0; i < faces.length; i++)
    for (let j = i + 1; j < faces.length; j++) {
      const d = dot(faces[i].n, faces[j].n);
      if (d < -0.9999996 && d > -0.9999999999) return true;
    }
  return false;
}

/** A brush's corner clips under MIN_FACE taken off, while the brush stays bounded and grows by under 8. */
function pruneTinyFaces(planes, bounds, faces, maxRounds = 8) {
  let pruned = 0;
  for (let round = 0; round < maxRounds; round++) {
    const tiny = faces.filter(
      (f) => f.poly.length && polyArea(f.poly, f.n) < MIN_FACE && f.tag !== null && !isBoxTag(f.tag),
    );
    if (!tiny.length) break;
    let f = tiny[0];
    for (const t of tiny) if (polyArea(t.poly, t.n) < polyArea(f.poly, f.n)) f = t;
    const newPlanes = planes.filter((pl) => pl[2] !== f.tag);
    const nf = polytope(newPlanes, bounds);
    const boxesBefore = faces.filter((h) => isBoxTag(h.tag)).length;
    const boxesAfter = nf.filter((h) => isBoxTag(h.tag)).length;
    if (nf.length >= 4 && boxesAfter <= boxesBefore && brushVolume(nf) <= brushVolume(faces) + 8.0) {
      planes = newPlanes;
      faces = nf;
      pruned++;
    } else break;
  }
  return [planes, faces, pruned];
}

/**
 * Near-coincident planes made one, up front: [n, d] for each plane number. Same orientation within 0.25
 * degrees and 2 units (exactly parallel ones only within half a unit: the two sides of a slab); flipped
 * pairs within half a unit. With `weights`, the plane carrying the most face area represents its group.
 */
function canonicalPlanes(planes, weights, angleDeg = 0.25, dist = 2.0, flipDist = 0.5) {
  const cosMin = Math.cos(radians(angleDeg));
  const out = new Array(planes.length).fill(null);
  const buckets = new Map();
  const keyOf = (n, d) => `${roundText(n[0], 1)},${roundText(n[1], 1)},${roundText(n[2], 1)}`;
  const slab = (d) => Math.floor(d / 8);
  let order = [...planes.keys()];
  if (weights?.length) order = order.sort((i, j) => -weights[i] - -weights[j] || i - j);
  for (const pn of order) {
    const { normal, dist: d } = planes[pn];
    const n = norm(normal);
    let rep = null;
    for (const [cn, cd, flip, tol] of [
      [n, d, false, dist],
      [neg(n), -d, true, flipDist],
    ]) {
      const key = keyOf(cn, cd);
      const s = slab(cd);
      for (const k2 of [s, s - 1, s + 1]) {
        for (const [rn, rd] of buckets.get(`${key},${k2}`) ?? []) {
          const c = dot(rn, cn);
          if (c > cosMin && Math.abs(rd - cd) < (flip || c < 1.0 - 1e-9 ? tol : flipDist)) {
            rep = flip ? [neg(rn), -rd] : [rn, rd];
            break;
          }
        }
        if (rep) break;
      }
      if (rep) break;
    }
    if (rep === null) {
      rep = [n, d];
      const k = `${keyOf(n, d)},${slab(d)}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(rep);
    }
    out[pn] = rep;
  }
  return out;
}

/** Three points for a face's plane: its centroid, and 128 units along two axes in it; normal along n. */
function pickPoints(poly, n, d) {
  let c = poly.length ? mul(sumPts(poly), 1.0 / poly.length) : mul(n, d);
  c = sub(c, mul(n, dot(n, c) - d));
  const ref = Math.abs(n[0]) < 0.9 ? [1.0, 0.0, 0.0] : [0.0, 1.0, 0.0];
  const ax = norm(cross(n, ref));
  const ay = cross(n, ax);
  let p0 = c;
  const p1 = add(c, mul(ax, 128.0));
  let p2 = add(c, mul(ay, 128.0));
  if (dot(cross(sub(p0, p1), sub(p2, p1)), n) < 0) [p0, p2] = [p2, p0];
  return [p0, p1, p2];
}

/** The texture axes an editor gives a face by the axis its normal looks along most. */
function axesFor(n) {
  let axis = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(n[i]) > Math.abs(n[axis])) axis = i;
  return [
    [
      [0, 1, 0],
      [0, 0, -1],
    ],
    [
      [1, 0, 0],
      [0, 0, -1],
    ],
    [
      [1, 0, 0],
      [0, -1, 0],
    ],
  ][axis];
}

/** A 16-unit ORIGIN brush about a point. */
function originBrush(o, h = 8.0) {
  const [x0, y0, z0] = [o[0] - h, o[1] - h, o[2] - h];
  const [x1, y1, z1] = [o[0] + h, o[1] + h, o[2] + h];
  const faces = [
    [
      [x0, y0, z0],
      [x0, y1, z0],
      [x0, y0, z1],
      [-1, 0, 0],
    ],
    [
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y0, z1],
      [1, 0, 0],
    ],
    [
      [x0, y0, z0],
      [x1, y0, z0],
      [x0, y0, z1],
      [0, -1, 0],
    ],
    [
      [x0, y1, z0],
      [x1, y1, z0],
      [x0, y1, z1],
      [0, 1, 0],
    ],
    [
      [x0, y0, z0],
      [x1, y0, z0],
      [x0, y1, z0],
      [0, 0, -1],
    ],
    [
      [x0, y0, z1],
      [x1, y0, z1],
      [x0, y1, z1],
      [0, 0, 1],
    ],
  ];
  const lines = ["{"];
  for (let [p0, p1, p2, nrm] of faces) {
    if (dot(cross(sub(p0, p1), sub(p2, p1)), nrm) < 0) [p0, p2] = [p2, p0];
    const [u, v] = axesFor(nrm);
    lines.push(`${pt(p0)} ${pt(p1)} ${pt(p2)} ORIGIN [ ${g(u[0])} ${g(u[1])} ${g(u[2])} 0 ] [ ${g(v[0])} ${g(v[1])} ${g(v[2])} 0 ] 0 1 1`); // prettier-ignore
  }
  lines.push("}");
  return lines.join("\n");
}

// ── the map, read for the decompile ────────────────────────────────────────
/** What the decompile needs of a map, on top of `readBsp`: the unified planes and each model's faces by plane. */
function prepare(bsp, canon) {
  const polys = bsp.faces.map((f) => {
    const pts = [];
    for (let k = 0; k < f.edgeCount; k++) {
      const e = bsp.surfedges[f.firstEdge + k];
      pts.push(bsp.vertices[bsp.edges[Math.abs(e)][e >= 0 ? 0 : 1]]);
    }
    return pts;
  });
  const texnames = bsp.textures.map((t) => (t.absent ? "NULL" : t.name));
  // the plane carrying the most face area represents a group of near-coplanar planes: what is seen stays
  const weight = new Array(bsp.planes.length).fill(0.0);
  bsp.faces.forEach((f, i) => {
    if (polys[i].length >= 3) weight[f.plane] += polyArea(polys[i], norm(bsp.planes[f.plane].normal));
  });
  const planes = canon
    ? canonicalPlanes(bsp.planes, weight)
    : bsp.planes.map((p) => [norm(p.normal), p.dist]);
  const keys = planes.map(([n, d]) => `${roundText(n[0], 5)},${roundText(n[1], 5)},${roundText(n[2], 5)},${roundText(d, 3)}`); // prettier-ignore
  // for each model, its faces by plane key: a brush entity's face is never matched against the world's
  const modelFaces = bsp.models.map((m) => {
    const byKey = new Map();
    for (let i = m.firstFace; i < m.firstFace + m.faceCount; i++) {
      const key = keys[bsp.faces[i].plane];
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(i);
    }
    return byKey;
  });
  return { bsp, polys, texnames, canon: planes, keys, modelFaces };
}

/** The textures whose pixels are in the map: [{ name, bytes }], each the miptex as stored (a WAD3 lump). */
function embeddedMiptex(bsp) {
  const tx = lumpBytes(bsp.bytes, bsp.lumps.textures);
  if (tx.length < 4) return [];
  const out = [];
  const count = tx.readInt32LE(0);
  for (let i = 0; i < count; i++) {
    const o = tx.readInt32LE(4 + i * 4);
    if (o < 0) continue;
    const name = bsp.textures[i].name;
    const w = tx.readUInt32LE(o + 16);
    const h = tx.readUInt32LE(o + 20);
    const mip0 = tx.readUInt32LE(o + 24);
    const mip3 = tx.readUInt32LE(o + 36);
    if (mip0 === 0) continue; // the header only: the pixels are in a .wad
    // four mip levels, then the 256-colour palette with its count
    const size = mip3 + Math.floor(w / 8) * Math.floor(h / 8) + 2 + 768;
    out.push({ name, bytes: tx.subarray(o, Math.min(o + size, tx.length)) });
  }
  return out;
}

/** A WAD3 of miptex lumps as they are, byte for byte (no texture is decoded or remade). */
export function wadOfMiptex(lumps) {
  const header = Buffer.alloc(12);
  const table = Buffer.alloc(lumps.length * 32);
  let pos = 12;
  lumps.forEach(({ name, bytes }, i) => {
    table.writeInt32LE(pos, i * 32);
    table.writeInt32LE(bytes.length, i * 32 + 4);
    table.writeInt32LE(bytes.length, i * 32 + 8);
    table[i * 32 + 12] = 0x43; // a miptex
    Buffer.from(name, "latin1")
      .subarray(0, 15)
      .copy(table, i * 32 + 16);
    pos += bytes.length;
  });
  header.write("WAD3", 0, "latin1");
  header.writeInt32LE(lumps.length, 4);
  header.writeInt32LE(pos, 8);
  return Buffer.concat([header, ...lumps.map((l) => l.bytes), table]);
}

/** The lump names of a .wad file, in lower case; none for a file that is not one. */
function wadNames(path) {
  let d;
  try {
    d = readFileSync(path);
  } catch {
    return new Set();
  }
  if (d.length < 12 || d.toString("latin1", 0, 4) !== "WAD3") return new Set();
  const n = d.readInt32LE(4);
  const ofs = d.readInt32LE(8);
  const names = new Set();
  for (let i = 0; i < n; i++) {
    const at = ofs + i * 32 + 16;
    const end = d.indexOf(0, at);
    names.add(d.toString("latin1", at, end < 0 || end > at + 16 ? at + 16 : end).toLowerCase());
  }
  return names;
}

// ── the decompiler ─────────────────────────────────────────────────────────
class Decompiler {
  constructor(map, { tips, cuts, merge }) {
    this.m = map;
    this.bsp = map.bsp;
    this.switches = { tips, cuts, merge };
    this.stats = { leaves: 0, brushes: 0, faces: 0, textured: 0, null: 0 };
    this.void = new Set();
    this.world = false;
    this.generated = 0;
  }
  count(name) {
    this.stats[name] = (this.stats[name] ?? 0) + 1;
  }
  genTag(kind) {
    this.generated++;
    return `G${kind}${this.generated}`;
  }

  /** The brushes of a model: [contents, faces]. */
  modelBrushes(mi) {
    const m = this.bsp.models[mi];
    this.nodeFaces = this.m.modelFaces[mi];
    this.world = mi === 0;
    let mins = [m.mins[0] - PAD, m.mins[1] - PAD, m.mins[2] - PAD];
    let maxs = [m.maxs[0] + PAD, m.maxs[1] + PAD, m.maxs[2] + PAD];
    this.geom = [mins, maxs];
    const head = m.headNodes[0];
    if (mi === 0) {
      // the world's box encloses every region the tree calls air, not just the geometry: a first walk with
      // a wide box measures them, and the box is their extent plus 64 (c1a2b closes a pocket 65 units out)
      const ext = [[...mins], [...maxs]];
      this.void = new Set();
      const wide = [
        [m.mins[0] - WIDE, m.mins[1] - WIDE, m.mins[2] - WIDE],
        [m.maxs[0] + WIDE, m.maxs[1] + WIDE, m.maxs[2] + WIDE],
      ];
      this.walk(head, [], [], wide, null, ext);
      mins = [0, 1, 2].map((k) => ext[0][k] - PAD);
      maxs = [0, 1, 2].map((k) => ext[1][k] + PAD);
      this.stats.box = [mins.map(Math.round), maxs.map(Math.round)];
    }
    let cells = [];
    this.walk(head, [], [], [mins, maxs], cells, null);
    if (this.switches.merge) cells = this.mergeCells(cells, [mins, maxs]);
    const own = [m.mins, m.maxs];
    const brushes = [];
    for (let [contents, planes] of cells) {
      if (mi !== 0) {
        const faces = this.clipToModelBox(polytope(planes, [mins, maxs]), own, [mins, maxs]);
        if (faces === null) {
          this.count("phantom");
          continue;
        }
        planes = faces.map((f) => [f.n, f.d, f.tag]);
      }
      for (let faces of this.splitForTextures(planes, [mins, maxs])) {
        if (mi !== 0) {
          // again after the texture pass: a snapped slab can overreach the box by its thickness
          faces = this.clipToModelBox(faces, own, [mins, maxs]);
          if (faces === null) continue;
        }
        brushes.push([contents, faces]);
      }
    }
    return brushes;
  }

  /**
   * A brush model's solid never reaches past its own box (every outward face of an entity brush is a face of
   * the map): a cell is clipped to it, a face parallel to a side within 2.5 units moved onto it, and a cell
   * with nothing left is a phantom (null).
   */
  clipToModelBox(faces, box, bounds) {
    const [[bx0, by0, bz0], [bx1, by1, bz1]] = box;
    const sides = [
      [[-1.0, 0.0, 0.0], -bx0, boxTag(0, -1)],
      [[1.0, 0.0, 0.0], bx1, boxTag(0, 1)],
      [[0.0, -1.0, 0.0], -by0, boxTag(1, -1)],
      [[0.0, 1.0, 0.0], by1, boxTag(1, 1)],
      [[0.0, 0.0, -1.0], -bz0, boxTag(2, -1)],
      [[0.0, 0.0, 1.0], bz1, boxTag(2, 1)],
    ];
    let planes = faces.map((f) => [f.n, f.d, f.tag]);
    let changed = false;
    for (const [bn, bd, btag] of sides) {
      if (faces.every((f) => f.poly.every((p) => dot(bn, p) - bd <= 0.5))) continue;
      changed = true;
      const j = planes.findIndex(([n, d]) => dot(n, bn) > 0.999 && Math.abs(d - bd) < 2.5);
      if (j >= 0) planes[j] = [bn, bd, planes[j][2]];
      else planes.push([bn, bd, btag]);
    }
    if (!changed) return faces;
    let fc = polytope(planes, bounds);
    // a box side that only clipped a corner off is dropped again when the brush stays inside the box
    for (const f of fc.filter((h) => isBoxTag(h.tag) && polyArea(h.poly, h.n) < MIN_FACE)) {
      const without = planes.filter((pl) => pl[2] !== f.tag);
      const fp = polytope(without, bounds);
      if (
        fp.length >= 4 &&
        brushVolume(fp) <= brushVolume(fc) + 8.0 &&
        fp.every((h) => h.poly.every((p) => dot(f.n, p) - f.d <= 2.5))
      ) {
        planes = without;
        fc = fp;
      }
    }
    return fc.length >= 4 && brushVolume(fc) >= 0.5 ? fc : null;
  }

  /** Cells of one content that share a seam plane and whose union is convex, made one, until none merge. */
  mergeCells(cellList, bounds) {
    let cells = cellList.map(([c, planes]) => [c, planes, polytope(planes, bounds)]).filter((cell) => cell[2].length >= 4); // prettier-ignore
    const inside = (faces, planes, skip) => {
      for (const [n, d, tag] of planes) {
        if (tag === skip) continue;
        for (const f of faces) for (const p of f.poly) if (!(dot(n, p) - d <= 0.05)) return false;
      }
      return true;
    };
    let mergedTotal = 0;
    for (;;) {
      const index = new Map();
      cells.forEach(([c, , faces], i) => {
        for (const f of faces) {
          if (!isTreeTag(f.tag)) continue;
          const k = `${keyOfTag(f.tag)}|${c}`;
          if (!index.has(k)) index.set(k, { key: keyOfTag(f.tag), sides: new Map() });
          const sides = index.get(k).sides;
          const side = f.tag.slice(f.tag.lastIndexOf("#") + 1);
          if (!sides.has(side)) sides.set(side, []);
          sides.get(side).push(i);
        }
      });
      const dead = new Set();
      let merged = 0;
      for (const { key, sides } of index.values()) {
        if (!sides.has("0") || !sides.has("1")) continue;
        const t0 = treeTag(key, 0);
        const t1 = treeTag(key, 1);
        for (const i of sides.get("0")) {
          if (dead.has(i)) continue;
          for (const j of sides.get("1")) {
            if (dead.has(j) || dead.has(i)) continue;
            const [ci, pi, fi] = cells[i];
            const [, pj, fj] = cells[j];
            if (!(inside(fj, pi, t0) && inside(fi, pj, t1))) continue;
            const seen = new Set();
            const planes = [];
            for (const pl of [...pi, ...pj]) {
              if (pl[2] === t0 || pl[2] === t1 || seen.has(pl[2])) continue;
              seen.add(pl[2]);
              planes.push(pl);
            }
            const faces = polytope(planes, bounds);
            if (
              faces.length < 4 ||
              Math.abs(brushVolume(faces) - brushVolume(fi) - brushVolume(fj)) >
                0.5 + 1e-4 * brushVolume(faces)
            )
              continue;
            cells[i] = [ci, planes, faces];
            dead.add(j);
            merged++;
          }
        }
      }
      if (!merged) break;
      mergedTotal += merged;
      cells = cells.filter((_, k) => !dead.has(k));
    }
    this.stats.merged = (this.stats.merged ?? 0) + mergedTotal;
    return cells.map(([c, planes]) => [c, planes]);
  }

  /**
   * The tree walked. `planes`: the path's outward half-spaces on the unified planes (what is written);
   * `raw`: the same on the planes as stored. With `extent`, only measures the air (the first walk).
   */
  walk(nodenum, planes, raw, bounds, out, extent) {
    if (nodenum < 0) {
      const leafIndex = -(nodenum + 1);
      let contents = this.bsp.leaves[leafIndex].contents;
      if (contents === EMPTY || contents >= 0) {
        // an empty leaf under a unit thick (on the planes as stored, inside the geometry's box) is the seam
        // between two touching brushes: filled, or unified planes could widen it into air through a wall
        const thin = this.world && thinRegion(raw, this.geom);
        if (extent !== null) {
          if (!thin) {
            const faces = polytope(planes, bounds);
            // air that reaches the wide box is the void the original left unbounded: filled below
            if (faces.some((f) => isBoxTag(f.tag))) {
              this.void.add(leafIndex);
              return;
            }
            for (const f of faces)
              for (const p of f.poly)
                for (let k = 0; k < 3; k++) {
                  extent[0][k] = Math.min(extent[0][k], p[k]);
                  extent[1][k] = Math.max(extent[1][k], p[k]);
                }
          }
          return;
        }
        if (thin) this.count("filled");
        else if (this.world && this.void.has(leafIndex)) this.count("void");
        else if (!this.world && this.insideFaces(planes, bounds)) this.count("hollow");
        else return;
        contents = SOLID;
      }
      if (extent !== null) return;
      this.stats.leaves++;
      // a thin solid whose unified planes meet or cross has vanished: kept on the planes as stored, unless
      // that region is itself a sliver the unification was meant to remove
      const fc = polytope(planes, bounds);
      if (fc.length < 4 || brushVolume(fc) < 0.5) {
        const fr = polytope(raw, bounds);
        if (
          fr.length >= 4 &&
          brushVolume(fr) >= 8.0 &&
          !thinRegion(raw, bounds, 0.5) &&
          !hasThinAcute(fr, 0.5) &&
          minFaceArea(fr) >= MIN_FACE
        ) {
          planes = raw;
          this.count("uncollapsed");
        }
      }
      out.push([contents, planes]);
      return;
    }
    const node = this.bsp.nodes[nodenum];
    const pn = node.plane;
    const [n, d] = this.m.canon[pn];
    const rp = this.bsp.planes[pn];
    const rn = norm(rp.normal);
    const rd = rp.dist;
    const key = this.m.keys[pn];
    // in front: n . p - d >= 0, the outward plane (-n, -d); behind: (n, d)
    this.walk(node.children[0], [...planes, [neg(n), -d, treeTag(key, 0)]], [...raw, [neg(rn), -rd, treeTag(key, 0)]], bounds, out, extent); // prettier-ignore
    this.walk(node.children[1], [...planes, [n, d, treeTag(key, 1)]], [...raw, [rn, rd, treeTag(key, 1)]], bounds, out, extent); // prettier-ignore
  }

  /** Is this empty leaf of a brush model the inside of a brush: faces on its planes facing away, none in? */
  insideFaces(planes, bounds) {
    const faces = polytope(planes, bounds);
    let backs = 0;
    let fronts = 0;
    for (const f of faces) {
      if (!isTreeTag(f.tag)) continue;
      if (this.overlaps(f).length) backs++;
      if (this.overlaps({ tag: f.tag, n: neg(f.n), poly: f.poly }).length) fronts++;
    }
    return backs > 0 && fronts === 0;
  }

  /** The faces on a brush face's node plane, same side, overlapping it: [area, face, texinfo], largest first. */
  overlaps(face) {
    const { tag } = face;
    if (!isTreeTag(tag) || !face.poly.length) return [];
    const n = face.n;
    const hits = [];
    for (const fi of this.nodeFaces.get(keyOfTag(tag)) ?? []) {
      const f = this.bsp.faces[fi];
      const pl = this.m.canon[f.plane][0];
      const fn = f.side ? neg(pl) : pl;
      if (dot(fn, n) < 0.5) continue;
      const a = overlapArea(this.m.polys[fi], face.poly, n);
      if (a > 1.0) hits.push([a, fi, f.texinfo]);
    }
    hits.sort((x, y) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2]);
    return hits;
  }

  /**
   * The region as one brush, or cut where a brush face spans faces of different texinfo (along the edges
   * of the others) so that every brush face keeps one texture. Wedges, needles and big faces are mended
   * on the way.
   */
  splitForTextures(planes, bounds, depth = 0) {
    let faces = polytope(planes, bounds);
    if (faces.length < 4) return [];
    let pruned;
    [planes, faces, pruned] = pruneTinyFaces(planes, bounds, faces);
    if (pruned) this.stats.pruned = (this.stats.pruned ?? 0) + pruned;
    if (faces.length < 4) return [];
    if (minFaceArea(faces) < MIN_FACE) {
      // a needle: sub-unit faces that cannot be pruned without unbounding the brush
      this.count("needles");
      return [];
    }
    // an acute wedge cannot be compiled: the offset apex lands beyond the world (a brush model's tips are
    // its own, so there only a razor tip is cut)
    const tip = this.switches.tips ? acuteTipPlane(faces, this.world ? 0.5 : 0.1) : null;
    if (tip !== null && depth < 40) {
      const [plane, fi, fj, thin] = tip;
      const shellIndex = isBoxTag(faces[fi].tag) ? fi : isBoxTag(faces[fj].tag) ? fj : -1;
      if (shellIndex >= 0 && isTreeTag(faces[shellIndex === fi ? fj : fi].tag)) {
        // a wedge against the bounding box: cutting its tip would open the inside to the void, so the
        // region gets a face parallel to the tree plane 64 units out, and the box is let out on that side
        const t = faces[shellIndex === fi ? fj : fi];
        const [axis, sign] = boxSideOf(faces[shellIndex].tag);
        const mins = [...bounds[0]];
        const maxs = [...bounds[1]];
        if (sign > 0) maxs[axis] += WIDE;
        else mins[axis] -= WIDE;
        this.count("shell");
        return this.splitForTextures([...planes, [neg(t.n), -t.d + 64.0, this.genTag("shell")]], [mins, maxs], depth + 1); // prettier-ignore
      }
      // an interior wedge with a face against solid (no face on it): that face snapped parallel to the other
      // at the wedge's full thickness, and capped by a plane through the apex; a wedge textured on both
      // sides keeps the tip cut. Only a tree face is ever snapped
      const a = faces[fi];
      const b = faces[fj];
      const ta = this.overlaps(a).length > 0;
      const tb = this.overlaps(b).length > 0;
      const bothTree = isTreeTag(a.tag) && isTreeTag(b.tag);
      if (bothTree && !(ta && tb)) {
        const [nullf, other] =
          !ta && (tb || polyArea(a.poly, a.n) <= polyArea(b.poly, b.n)) ? [a, b] : [b, a];
        const m = add(a.n, b.n);
        const dsum = a.d + b.d;
        const lm = length(m);
        const tmax = Math.max(...[a, b].flatMap((f) => f.poly.map((p) => dsum - dot(m, p))), 1.0);
        const snapped = [neg(other.n), -other.d + Math.max(1.0, tmax), this.genTag("snap")];
        const cap = [mul(m, 1.0 / lm), dsum / lm, this.genTag("cap")];
        const next = [...planes.filter((pl) => pl[2] !== nullf.tag), snapped, cap];
        this.count("snapped");
        return this.splitForTextures(next, bounds, depth + 1);
      } else if (thin && !(ta && tb && !bothTree)) {
        this.count("tips");
        return this.splitForTextures(
          [...planes, [plane[0], plane[1], this.genTag("tip")]],
          bounds,
          depth + 1,
        );
      }
      // else a wedge seen on both sides and never thin, or a made plane at a small angle: the compiler takes it
    }
    if (brushVolume(faces) < 0.5) {
      // a sliver the tree's epsilons left behind
      this.count("slivers");
      return [];
    }
    if (depth >= 24) return [faces];
    let big = faces[0];
    for (const f of faces) if (f.poly.length > big.poly.length) big = f;
    if (big.poly.length > MAX_VERTS) {
      // hlbsp refuses a face of over 28 corners: the brush is cut in two through the face's centroid
      const c = mul(sumPts(big.poly), 1.0 / big.poly.length);
      const n = big.n;
      let far = big.poly[0];
      for (const p of big.poly) if (length(sub(p, c)) > length(sub(far, c))) far = p;
      const axis = norm(sub(far, c));
      for (const m of [norm(cross(n, axis)), axis]) {
        const dd = dot(m, c);
        const tg = this.genTag("cut");
        const pa = polytope([...planes, [m, dd, tg]], bounds);
        const pb = polytope([...planes, [neg(m), -dd, tg]], bounds);
        if (
          pa.length >= 4 &&
          pb.length >= 4 &&
          brushVolume(pa) >= 8.0 &&
          brushVolume(pb) >= 8.0 &&
          minFaceArea(pa) >= MIN_FACE &&
          minFaceArea(pb) >= MIN_FACE &&
          !hasThinAcute(pa) &&
          !hasThinAcute(pb)
        ) {
          this.count("bisected");
          return [
            ...this.splitForTextures([...planes, [m, dd, tg]], bounds, depth + 1),
            ...this.splitForTextures([...planes, [neg(m), -dd, this.genTag("cut")]], bounds, depth + 1),
          ];
        }
      }
    }
    if (!this.switches.cuts) return [faces];
    for (const face of faces) {
      const hits = this.overlaps(face);
      if (new Set(hits.map((h) => h[2])).size < 2) continue;
      const n = face.n;
      const dominant = hits[0][2];
      const cuts = [];
      for (const [, fi, ti] of hits.slice(1)) {
        if (ti === dominant) continue;
        const poly = this.m.polys[fi];
        for (let i = 0; i < poly.length; i++) {
          const e = sub(poly[(i + 1) % poly.length], poly[i]);
          if (length(e) < EPS) continue;
          const m = norm(cross(e, n));
          const dd = dot(m, poly[i]);
          // an edge plane that does not cut this face, or nearly one the brush has, or a line already had
          const ds = face.poly.map((p) => dot(m, p) - dd);
          if (Math.max(...ds) <= EPS * 10 || Math.min(...ds) >= -EPS * 10) continue;
          if (faces.some((f2) => nearCoincident(m, dd, f2.n, f2.d))) continue;
          if (cuts.some(([m2, d2]) => nearCoincident(m, dd, m2, d2, 0.5))) continue;
          cuts.push([m, dd, this.genTag("cut")]);
        }
      }
      if (!cuts.length) continue;
      if (cuts.length > MAX_CUTS) {
        this.count("uncut");
        continue;
      }
      // a cut whose piece would be a sliver hlcsg cannot wind is passed over
      let chosen = null;
      for (const [m, dd, tg] of cuts) {
        const pa = polytope([...planes, [m, dd, tg]], bounds);
        const pb = polytope([...planes, [neg(m), -dd, tg]], bounds);
        if (
          pa.length >= 4 &&
          pb.length >= 4 &&
          brushVolume(pa) >= 8.0 &&
          brushVolume(pb) >= 8.0 &&
          !isWedge(pa) &&
          !isWedge(pb) &&
          minFaceArea(pa) >= MIN_FACE &&
          minFaceArea(pb) >= MIN_FACE &&
          !hasThinAcute(pa) &&
          !hasThinAcute(pb)
        ) {
          chosen = [m, dd, tg];
          break;
        }
      }
      if (chosen === null) {
        this.count("uncut");
        continue;
      }
      const [m, dd, tg] = chosen;
      this.count("cuts");
      return [
        ...this.splitForTextures([...planes, [m, dd, tg]], bounds, depth + 1),
        ...this.splitForTextures([...planes, [neg(m), -dd, this.genTag("cut")]], bounds, depth + 1),
      ];
    }
    return [faces];
  }

  /** The texture of a brush face: [name, texinfo] of the face that overlaps it most; NULL or sky without. */
  textureFor(face, contents) {
    const hits = this.overlaps(face);
    if (hits.length) {
      const ti = this.bsp.texinfo[hits[0][2]];
      return [this.m.texnames[ti.texture] ?? "NULL", ti];
    }
    if (contents === SKY) return ["sky", null];
    return ["NULL", null];
  }

  /** One brush as text; textures looked up in the model's own space, the points written at +offset. */
  brushText(contents, faces, offset = [0.0, 0.0, 0.0]) {
    const lines = ["{"];
    let looked = faces.map((f) => this.textureFor(f, contents));
    // one content a brush: a liquid wears its texture on every face, sky is sky all over, a solid never
    // takes a liquid or sky face it borders
    if (LIQUID.includes(contents)) {
      const byArea = new Map();
      faces.forEach((f, i) => {
        const nm = looked[i][0];
        if (nm.startsWith("!")) byArea.set(nm, (byArea.get(nm) ?? 0.0) + polyArea(f.poly, f.n));
      });
      let liquid = null;
      for (const [nm, area] of byArea) if (liquid === null || area > byArea.get(liquid)) liquid = nm;
      liquid =
        liquid ??
        this.m.texnames.find((nm) => nm.startsWith("!")) ??
        looked.find(([nm]) => nm !== "NULL")?.[0] ??
        "NULL";
      looked = looked.map(([nm, ti]) => (nm === liquid ? [nm, ti] : [liquid, null]));
    } else if (contents === SKY) {
      looked = looked.map(() => ["sky", null]);
    } else {
      looked = looked.map(([nm, ti]) => (nm.startsWith("!") || nm.toLowerCase() === "sky" ? ["NULL", null] : [nm, ti])); // prettier-ignore
    }
    const moved = offset[0] !== 0 || offset[1] !== 0 || offset[2] !== 0;
    faces.forEach((f, i) => {
      const [name, ti] = looked[i];
      const poly = moved ? f.poly.map((p) => add(p, offset)) : f.poly;
      this.stats.faces++;
      let u, v, uo, vo, su, sv;
      if (ti === null) {
        this.stats.null++;
        [u, v] = axesFor(f.n);
        uo = vo = 0.0;
        su = sv = 1.0;
      } else {
        this.stats.textured++;
        const vu = ti.s.slice(0, 3);
        const vv = ti.t.slice(0, 3);
        const lu = length(vu);
        const lv = length(vv);
        u = lu > 0 ? norm(vu) : axesFor(f.n)[0];
        v = lv > 0 ? norm(vv) : axesFor(f.n)[1];
        su = lu > 0 ? 1.0 / lu : 1.0;
        sv = lv > 0 ? 1.0 / lv : 1.0;
        // hlcsg added origin . vecs to every offset of an entity compiled round an ORIGIN brush: taken off
        uo = ti.s[3] - dot(vu, offset);
        vo = ti.t[3] - dot(vv, offset);
      }
      const [p0, p1, p2] = pickPoints(poly, f.n, f.d + dot(f.n, offset));
      lines.push(`${pt(p0)} ${pt(p1)} ${pt(p2)} ${name} [ ${g(u[0])} ${g(u[1])} ${g(u[2])} ${g(uo)} ] [ ${g(v[0])} ${g(v[1])} ${g(v[2])} ${g(vo)} ] 0 ${g(su)} ${g(sv)}`); // prettier-ignore
    });
    lines.push("}");
    this.stats.brushes++;
    return lines.join("\n");
  }
}

/** An entity's keys as Python's dict() of its pairs: the last of a key given twice wins. */
const lastWins = (pairs) => {
  const d = new Map();
  for (const [k, v] of pairs) d.set(k, v);
  return d;
};

/**
 * A compiled map made back into brush source. `bspBytes` is the .bsp file. Options:
 *   name       the map's name: said in the first line, and the own .wad is `<name>_dc.wad`
 *   folders    where the worldspawn's .wad files are looked for (the game's folder, as `valve`): the `wad` key
 *              keeps the bare names of those that are there. Without, every listed name is kept
 *   canon, tips, cuts, merge   false turns one rule off, for finding what a rule does (bsp2map's
 *              BSP2MAP_NO_CANON, _NO_TIPS, _NO_CUTS, _NO_MERGE): near-coplanar planes unified, acute
 *              wedges mended, brushes cut along texture boundaries, cells merged
 * It returns `{ map, facts, warnings, wad }`. `map` is the text of the .map (Valve 220). `facts` counts what
 * was done: `{ entities, models, leaves, brushes, faces, textured, null, cuts, merged ... box }`. `wad` is
 * null, or `{ name, bytes, textures }`: the textures the map carries inside it that none of its .wad files
 * has (hlcsg wants every texture from a .wad), as a WAD3 to write beside the .map; its name is already in
 * the `wad` key. Throws, in words, for a file that is not a GoldSrc map.
 */
export function decompile(bspBytes, options = {}) {
  const { name = "decompiled", folders, canon = true, tips = true, cuts = true, merge = true } = options;
  const bytes = Buffer.isBuffer(bspBytes) ? bspBytes : Buffer.from(bspBytes);
  const bsp = readBsp(bytes);
  const prepared = prepare(bsp, canon);
  const dc = new Decompiler(prepared, { tips, cuts, merge });
  const warnings = [];
  let wad = null;
  const out = [`// decompiled by smak (make/maps/decompile.mjs, after goldsrc.net's bsp2map) from ${name}`];
  for (const kvs of bsp.entities) {
    const d = lastWins(kvs);
    const model = d.get("model") ?? "";
    let keys = kvs.filter(([k]) => !(k === "model" && model.startsWith("*")));
    let mi = null;
    if (d.get("classname") === "worldspawn") {
      // the retail maps carry Valve's build paths (\quiver\valve\halflife.wad): bare names of files there are
      const wads = (value) => {
        const names = value
          .split(";")
          .filter(Boolean)
          .map((w) => w.replace(/\\/g, "/").split("/").pop());
        const kept = folders ? names.filter((w) => folders.some((f) => existsSync(join(f, w)))) : [...names];
        if (folders) {
          const gone = names.filter((w) => !kept.includes(w));
          if (gone.length) warnings.push(`the worldspawn lists ${gone.join(", ")}, in none of the folders given: left out`); // prettier-ignore
        }
        // the textures inside the map that none of those .wad files has go into a .wad of their own
        const have = new Set();
        for (const w of folders ? kept : [])
          for (const f of folders)
            if (existsSync(join(f, w))) for (const t of wadNames(join(f, w))) have.add(t);
        const own = embeddedMiptex(bsp).filter((t) => !have.has(t.name.toLowerCase()) && t.name.toLowerCase() !== "sky"); // prettier-ignore
        if (own.length) {
          const wadName = `${name}_dc.wad`;
          wad = { name: wadName, bytes: wadOfMiptex(own), textures: own.map((t) => t.name) };
          kept.push(wadName);
          dc.stats.wad = [wadName, own.length];
        }
        return (kept.length ? kept : names).join(";");
      };
      keys = keys.map(([k, v]) => [k, k === "wad" ? wads(v) : v]);
      // a map compiled with its textures inside and no `wad` key (hlcsg -wadinclude) gets one: its own .wad
      // (bsp2map left such a map with none; Valve's all have the key, so their text is the same)
      if (!d.has("wad")) {
        const own = wads("");
        if (own) keys.push(["wad", own]);
      }
      if (!d.has("mapversion")) keys.push(["mapversion", "220"]);
      mi = 0;
    } else if (model.startsWith("*")) {
      mi = Number.parseInt(model.slice(1), 10);
      if (!(mi >= 0 && mi < bsp.models.length)) {
        warnings.push(`an entity ${d.get("classname")} names the model ${model}, which the map does not have: written without brushes`); // prettier-ignore
        mi = null;
      }
    }
    let origin = [0.0, 0.0, 0.0];
    const originText = (d.get("origin") ?? "").trim();
    if (mi !== null && mi > 0 && originText) {
      const numbers = originText.split(/\s+/).slice(0, 3).map(Number);
      if (numbers.length === 3 && numbers.every(Number.isFinite)) origin = numbers;
    }
    // a brush entity's origin key is hlcsg's, from its ORIGIN brush: the brushes go back to world space with
    // an ORIGIN brush again, and the key goes (a zero one too: hlbsp places a leak's start at any origin)
    if (mi !== null) keys = keys.filter(([k]) => k !== "origin");
    if (mi !== null && mi > 0 && NOCLIP_CLASSES.includes(d.get("classname")) && !d.has("zhlt_noclip"))
      keys.push(["zhlt_noclip", "1"]);
    const body = keys.map(([k, v]) => `"${k}" "${v}"`);
    if (mi !== null) {
      for (const [contents, faces] of dc.modelBrushes(mi)) body.push(dc.brushText(contents, faces, origin));
      if (origin[0] !== 0 || origin[1] !== 0 || origin[2] !== 0) body.push(originBrush(origin));
    }
    out.push(`{\n${body.join("\n")}\n}`);
  }
  const s = dc.stats;
  const facts = {
    entities: bsp.entities.length,
    models: bsp.models.length,
    ...s,
  };
  for (const kind of ["cuts", "uncut", "slivers", "tips", "snapped", "shell", "pruned", "needles", "filled", "void", "bisected", "merged", "uncollapsed", "phantom", "hollow"]) // prettier-ignore
    facts[kind] ??= 0;
  return { map: `${out.join("\n")}\n`, facts, warnings, wad };
}

/** What a decompile did, in one line, as bsp2map prints it. */
export function decompileSummary({ facts: s }) {
  return `${s.entities} entities, ${s.models} models, ${s.leaves} non-empty leaves -> ${s.brushes} brushes (${s.cuts} texture cuts, ${s.uncut} uncut, ${s.slivers} slivers dropped, ${s.tips} tips cut, ${s.snapped} wedges snapped, ${s.shell} shell wedges, ${s.pruned} tiny faces pruned, ${s.needles} needles dropped, ${s.filled} thin empty leaves filled, ${s.void} void leaves filled, ${s.bisected} bisected, ${s.merged} cells merged, ${s.uncollapsed} collapsed solids kept raw, ${s.phantom} phantoms clipped, ${s.hollow} hollow brushes filled), ${s.faces} faces (${s.textured} textured, ${s.null} NULL/sky); world box ${s.box ? `(${s.box[0].join(", ")}) (${s.box[1].join(", ")})` : "none"}; own wad ${s.wad ? `${s.wad[0]} (${s.wad[1]} ${s.wad[1] === 1 ? "texture" : "textures"})` : "-"}`; // prettier-ignore
}
