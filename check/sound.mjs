// Whether a model's shape is whole: no holes, no faces turned inside out, no part left floating apart from
// the rest. `check` says whether the engine takes a file; this says whether the shape in it is what was meant,
// and it is the test every model made from a description (a spec) is held to before anyone looks at it.
//
//   soundness(src, options)  the shape, edge by edge and piece by piece  -> { faults, notes, pieces, ... }
//   seeThrough(src, options) the same asked of pictures: where a view shows the far side of the model through
//                            its near side                                   -> { views, dots, faults }
//
// What is counted, as the model stands in a pose, one body at a time:
//   open edges     an edge that only one triangle has: a hole, or a shape left open on purpose (a cup with no
//                  inside: from below it shows nothing, since the game draws a face from its front only)
//   crowded edges  an edge that three triangles or more share: two parts that meet edge to edge, or a face
//                  given twice
//   flipped edges  an edge whose two triangles go round it the same way: one of them is turned the wrong way
//   inside out     a closed piece whose volume, by its faces, is under 0: every face of it looks inwards
//   floating       a piece further than `gap` from every other piece: a part that should touch and does not
// Points nearer than `weld` are one point. A thin sheet made of two faces back to back (workshop's `leaf`) is
// closed and of no volume, and is said to be one, not a fault.
import { posed, render } from "../make/render.mjs";
import { FRONT } from "../make/mesh.mjs";
import { sub, dot, cross } from "../core/vec.mjs";

/**
 * Points nearer than this (units) are one point: far over the noise of a model's numbers (a millionth of a
 * unit), and under the narrowest a part is made (a blade's tip: there, a weld of 0.01 joined points that
 * were apart and made edges of three triangles that are not).
 */
const WELD = 0.002;
/** A piece further than this (units) from every other piece is floating. */
const GAP = 0.25;
/** A closed piece whose volume is under this share of its box's is a sheet of two faces back to back. */
const SHEET_SHARE = 1e-3;
/** A triangle of less area than this (square units) has none. */
const NO_AREA = 1e-6;
/** The pieces listed by name in a fault, at most. */
const NAMED_MOST = 6;

/** How far a point is from a triangle [a, b, c] (the nearest point of it, edges and corners included). */
function toTriangle(p, [a, b, c]) {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return Math.hypot(...ap);
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return Math.hypot(...bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    return Math.hypot(...sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]));
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return Math.hypot(...cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    return Math.hypot(...sub(p, [a[0] + ac[0] * t, a[1] + ac[1] * t, a[2] + ac[2] * t]));
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
    const bc = sub(c, b);
    return Math.hypot(...sub(p, [b[0] + bc[0] * t, b[1] + bc[1] * t, b[2] + bc[2] * t]));
  }
  const n = cross(ab, ac);
  return Math.abs(dot(ap, n)) / (Math.hypot(...n) || 1);
}

/** The way a ray is cast to tell inside from outside: off every axis, so that it meets no edge squarely. */
const RAY = [0.5773, 0.5779, 0.5765];

/** Whether a point is inside a closed shell ({ members, bounds }): a ray from it crosses its faces an odd number of times. */
function inside(point, shell, tris) {
  const { mn, mx } = shell.bounds;
  for (let k = 0; k < 3; k++) if (point[k] < mn[k] || point[k] > mx[k]) return false;
  let crossings = 0;
  for (const i of shell.members) {
    const [a, b, c] = tris[i].p;
    const e1 = sub(b, a);
    const e2 = sub(c, a);
    const h = cross(RAY, e2);
    const det = dot(e1, h);
    if (Math.abs(det) < 1e-12) continue;
    const s = sub(point, a);
    const u = dot(s, h) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1);
    const v = dot(RAY, q) / det;
    if (v < 0 || u + v > 1) continue;
    if (dot(e2, q) / det > 1e-9) crossings++;
  }
  return crossings % 2 === 1;
}

/**
 * An open edge whose middle has at least this winding number about the other shells is inside them; one
 * over FLUSH_WINDING and within FLUSH of another shell's face lies on that face.
 */
/** Two parts this close (units) that do not touch may have been meant to: a note, past the weld's tolerance (`gap`). */
const NEAR_MISS = 0.6;
const BURIED_WINDING = 0.6;
const FLUSH_WINDING = 0.4;
const FLUSH = 0.01;

/**
 * The generalised winding number of a point about some shells' triangles (Jacobson and others, 2013): the
 * solid angle they cover seen from it, over the whole sphere's. 1 deep inside a closed shell, 0 outside, and
 * between for shells that are open: a point inside a tube near one of its open ends has about a half.
 */
function winding(point, shells, tris) {
  let total = 0;
  for (const shell of shells) {
    const { mn, mx } = shell.bounds;
    // a shell whose box is far from the point covers little of its sky: it is still counted, cheaply enough
    for (const i of shell.members) {
      const [a, b, c] = tris[i].p.map((q) => sub(q, point));
      const la = Math.hypot(...a);
      const lb = Math.hypot(...b);
      const lc = Math.hypot(...c);
      const det = dot(a, cross(b, c));
      const div = la * lb * lc + dot(a, b) * lc + dot(b, c) * la + dot(c, a) * lb;
      total += 2 * Math.atan2(det, div);
    }
    void mn;
    void mx;
  }
  return total / (4 * Math.PI);
}

/** Whether the segment from `a` to `b` passes through the triangle [p, q, r]. */
function segmentCrosses(a, b, [p, q, r]) {
  const d = sub(b, a);
  const e1 = sub(q, p);
  const e2 = sub(r, p);
  const h = cross(d, e2);
  const det = dot(e1, h);
  if (Math.abs(det) < 1e-12) return false;
  const s = sub(a, p);
  const u = dot(s, h) / det;
  if (u < 0 || u > 1) return false;
  const k = cross(s, e1);
  const v = dot(d, k) / det;
  if (v < 0 || u + v > 1) return false;
  const t = dot(e2, k) / det;
  return t >= 0 && t <= 1;
}
/** Whether two triangles cut through each other: an edge of one through the other. */
const trianglesCross = (A, B) =>
  [0, 1, 2].some((k) => segmentCrosses(A[k], A[(k + 1) % 3], B) || segmentCrosses(B[k], B[(k + 1) % 3], A));

/** How far apart two boxes are (0 when they touch or overlap). */
const boxGap = (a, b) =>
  Math.hypot(...[0, 1, 2].map((k) => Math.max(0, a.mn[k] - b.mx[k], b.mn[k] - a.mx[k])));

/** The box about some points: { mn, mx }. */
function boxOf(points) {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const p of points)
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], p[k]);
      mx[k] = Math.max(mx[k], p[k]);
    }
  return { mn, mx };
}

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * How whole a model's shape is, as it stands in `pose` ({ seq, frame, body }: the body that is drawn; seq 0
 * unless told). Options: `weld` (0.01) and `gap` (0.25), in units; `names(tri)`, a name for a triangle's piece
 * in the sentences (otherwise its mesh's texture). Returns
 *   { faults, notes, triangles, edges: { open, crowded, flipped, touching, buried }, pieces: [{ id, name,
 *     tris, shells, closed, sheet, open, flipped, insideOut, volume, mn, mx, apart }], box: { mn, mx } }
 * `faults` are sentences of what is wrong (an empty list: nothing found); `notes` what was found and is not
 * wrong (a sheet seen from both sides, open edges buried in another part, where the shape lies).
 */
export function soundness(src, { seq = 0, frame = 0, body = 0, names, ...options } = {}) {
  const list = posed(src, { seq, frame, body }).tris.map((t) => ({
    p: t.c.map((c) => c.p),
    name: names ? names(t) : (t.tex?.name ?? "untextured"),
  }));
  return shapeSoundness(list, { ...options, front: FRONT });
}

/**
 * The same of plain triangles: `list` is [{ p: [a, b, c], name }], `front` which way round a triangle goes
 * seen from outside: 1 counter-clockwise (the workshop's triangles, a spec's parts before they are written),
 * -1 clockwise (a compiled model's, FRONT). `allow`: names of pieces that may be open or float apart (a
 * spec's parts said to be so on purpose); their faults become notes.
 */
export function shapeSoundness(list, { weld = WELD, gap = GAP, front = 1, allow = [] } = {}) {
  const tris = list
    .map((t) => ({ t, p: t.p }))
    .filter(({ p }) => Math.hypot(...cross(sub(p[1], p[0]), sub(p[2], p[0]))) / 2 > NO_AREA);
  // the points welded: each corner's number among the welded points. A point joins one already met within
  // `weld` of it, looked for in its cell of the grid and the cells round it.
  const cells = new Map();
  let welded = 0;
  const weldOf = (point) => {
    const cell = point.map((v) => Math.floor(v / weld));
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const known of cells.get(`${cell[0] + dx},${cell[1] + dy},${cell[2] + dz}`) ?? [])
            if (Math.hypot(...sub(known.p, point)) <= weld) return known.n;
    const key = cell.join();
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push({ p: point, n: welded });
    return welded++;
  };
  const corners = tris.map(({ p }) => p.map(weldOf));
  // every edge, with each triangle that has it: which way it goes round it, and which side of it is solid
  const at = [];
  tris.forEach(({ p }, i) => corners[i].forEach((v, k) => (at[v] = at[v] ?? p[k])));
  const outward = tris.map(({ p }) => cross(sub(p[1], p[0]), sub(p[2], p[0])).map((v) => v * front));
  const edges = new Map();
  corners.forEach((c, i) => {
    for (let k = 0; k < 3; k++) {
      const a = c[k];
      const b = c[(k + 1) % 3];
      if (a === b) continue;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!edges.has(key)) edges.set(key, { a: Math.min(a, b), b: Math.max(a, b), uses: [] });
      edges.get(key).uses.push({ tri: i, third: c[(k + 2) % 3] });
    }
  });
  // Round an edge the triangles that have it are sorted by angle; two that follow each other with the solid
  // between them belong together. Two closed parts that touch along an edge are then two shells that meet
  // there, and not a fault; triangles that cannot be paired so are.
  const parent = corners.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (i, j) => (parent[find(i)] = find(j));
  const count = { open: 0, crowded: 0, flipped: 0, touching: 0 };
  const loose = [];
  for (const edge of edges.values()) {
    if (edge.uses.length === 1) {
      const ends = [at[edge.a], at[edge.b]];
      loose.push({ kind: "open", tri: edge.uses[0].tri, mid: ends[0].map((v, k) => (v + ends[1][k]) / 2) });
      continue;
    }
    const a = at[edge.a];
    const axis = sub(at[edge.b], a);
    const length = Math.hypot(...axis) || 1;
    const u = axis.map((v) => v / length);
    const w1 = Math.abs(u[0]) < 0.9 ? cross(u, [1, 0, 0]) : cross(u, [0, 1, 0]);
    const w1n = Math.hypot(...w1);
    const x = w1.map((v) => v / w1n);
    const y = cross(u, x);
    const round = edge.uses.map(({ tri, third }) => {
      const d = sub(at[third], a);
      const along = dot(d, u);
      const v = [d[0] - u[0] * along, d[1] - u[1] * along, d[2] - u[2] * along];
      const angle = Math.atan2(dot(v, y), dot(v, x));
      // the way round that leads from this triangle into the solid behind it: + or -
      const side = dot(outward[tri], cross(u, v)) < 0 ? 1 : -1;
      return { tri, angle, side };
    });
    const pairs = (offset) => {
      const list = [];
      for (let i = 0; i < round.length; i += 2) {
        const first = round[(i + offset) % round.length];
        const next = round[(i + offset + 1) % round.length];
        if (first.side !== 1 || next.side !== -1) return null;
        list.push([first.tri, next.tri]);
      }
      return list;
    };
    // two faces back to back lie at one angle: which comes first decides the pairing, so both are tried
    let paired = null;
    for (const tie of [-1, 1]) {
      if (paired || round.length % 2) break;
      round.sort((p, q) => p.angle - q.angle || tie * (q.side - p.side));
      paired = pairs(0) ?? pairs(1);
    }
    if (paired) {
      for (const [i, j] of paired) join(i, j);
      if (round.length > 2) count.touching++;
    } else if (round.length === 2) loose.push({ kind: "flipped", tri: round[0].tri, with: round[1].tri });
    else loose.push({ kind: "crowded", tri: round[0].tri, all: round.map((r) => r.tri) });
  }
  for (const fault of loose) if (fault.kind === "flipped") join(fault.tri, fault.with);
  const tallies = { open: new Map(), crowded: new Map(), flipped: new Map() };
  for (const fault of loose) {
    count[fault.kind]++;
    const tally = tallies[fault.kind];
    tally.set(find(fault.tri), (tally.get(find(fault.tri)) ?? 0) + 1);
  }
  const { open: openOf, flipped: flippedOf, crowded: crowdedOf } = tallies;
  const unpaired = new Set(loose.filter((fault) => fault.kind === "crowded").flatMap((fault) => fault.all.map(find)));
  // the shells: triangles joined across the edges they pair at, each closed or not, with its volume
  const shellOf = new Map();
  tris.forEach((_, i) => {
    const root = find(i);
    if (!shellOf.has(root)) shellOf.set(root, []);
    shellOf.get(root).push(i);
  });
  const shells = [...shellOf.entries()].map(([root, members]) => {
    const bounds = boxOf(members.flatMap((i) => tris[i].p));
    // the volume the faces close in, outwards positive
    const volume =
      (front * members.reduce((sum, i) => sum + dot(tris[i].p[0], cross(tris[i].p[1], tris[i].p[2])), 0)) / 6;
    const size = bounds.mx.map((v, k) => Math.max(v - bounds.mn[k], weld));
    // a shell cut off along an edge whose triangles did not pair is no closed solid, whatever its volume
    const closed = !openOf.get(root) && !unpaired.has(root);
    return {
      members,
      closed,
      sheet: closed && Math.abs(volume) < SHEET_SHARE * size[0] * size[1] * size[2],
      open: openOf.get(root) ?? 0,
      flipped: flippedOf.get(root) ?? 0,
      crowded: crowdedOf.get(root) ?? 0,
      volume,
    };
  });
  // An open edge inside another closed shell is buried: a ridge's or a band's feet, sunk into the surface
  // they stand on, show nowhere. Only the open edges that are out in the open count.
  const solids = shells.filter((shell) => shell.closed && !shell.sheet && shell.volume > 0);
  for (const solid of solids) solid.bounds = boxOf(solid.members.flatMap((i) => tris[i].p));
  const shellIndex = new Map();
  shells.forEach((shell) => shell.members.forEach((i) => shellIndex.set(i, shell)));
  count.buried = 0;
  // the shapes an open edge may be buried in when no closed solid holds it: open shells too (a grip turned
  // with no ends, whose ends go into a pommel and a guard), asked by their winding number
  for (const shell of shells) shell.bounds ??= boxOf(shell.members.flatMap((i) => tris[i].p));
  for (const fault of loose) {
    if (fault.kind !== "open") continue;
    const own = shellIndex.get(fault.tri);
    const around = winding(fault.mid, shells.filter((shell) => shell !== own), tris);
    // inside a closed solid; inside open ones; or lying on another part's face (a blade butted flush against
    // its guard: the edge is covered by that face, and its winding is a half)
    const held =
      solids.some((solid) => solid !== own && inside(fault.mid, solid, tris)) ||
      around > BURIED_WINDING ||
      (around > FLUSH_WINDING &&
        shells.some((shell) => shell !== own && shell.members.some((i) => toTriangle(fault.mid, tris[i].p) <= FLUSH)));
    if (!held) own.firstOpen = own.firstOpen ?? fault.mid;
    if (!held && process.env.SMAK_SOUND_DEBUG) {
      const away = Math.min(...shells.filter((shell) => shell !== own).flatMap((shell) => shell.members.map((i) => toTriangle(fault.mid, tris[i].p))));
      console.error("open", fault.mid.map(round2).join(" "), "winding", around.toFixed(3), "nearest face", away.toFixed(4), tris[fault.tri].t.name);
    }
    if (held) {
      own.open--;
      count.open--;
      count.buried++;
    }
  }

  // the pieces: shells that share a point are one piece (a part, as it was made)
  const pieceParent = shells.map((_, i) => i);
  const findPiece = (i) => (pieceParent[i] === i ? i : (pieceParent[i] = findPiece(pieceParent[i])));
  const shellAtPoint = new Map();
  shells.forEach((shell, k) => {
    for (const i of shell.members)
      for (const v of corners[i]) {
        if (!shellAtPoint.has(v)) shellAtPoint.set(v, k);
        else pieceParent[findPiece(k)] = findPiece(shellAtPoint.get(v));
      }
  });
  const pieceOf = new Map();
  shells.forEach((shell, k) => {
    const root = findPiece(k);
    if (!pieceOf.has(root)) pieceOf.set(root, []);
    pieceOf.get(root).push(shell);
  });
  const pieces = [...pieceOf.values()].map((list, id) => {
    const members = list.flatMap((shell) => shell.members);
    const bounds = boxOf(members.flatMap((i) => tris[i].p));
    const first = tris[members[0]].t;
    return {
      id,
      name: first.name,
      tris: members.length,
      shells: list.length,
      closed: list.every((shell) => shell.closed),
      sheet: list.every((shell) => shell.sheet),
      open: list.reduce((n, shell) => n + shell.open, 0),
      crowded: list.reduce((n, shell) => n + shell.crowded, 0),
      openAt: list.find((shell) => shell.firstOpen)?.firstOpen?.map(round2),
      flipped: list.reduce((n, shell) => n + shell.flipped, 0),
      insideOut: list.filter((shell) => shell.closed && !shell.sheet && shell.volume < 0).length,
      volume: round2(list.reduce((v, shell) => v + shell.volume, 0)),
      mn: bounds.mn.map(round2),
      mx: bounds.mx.map(round2),
      members,
      bounds,
      solids: list.filter((shell) => shell.closed && !shell.sheet && shell.volume > 0),
    };
  });

  // how far each piece is from the nearest other: by their boxes, then point to triangle where the boxes are near
  const pointsOf = (piece) => piece.members.flatMap((i) => tris[i].p);
  const trianglesOf = (piece) => piece.members.map((i) => tris[i].p);
  // two parts closer than NEAR_MISS that do not touch: a joint that was meant to close and did not (a stock
  // ending short of its receiver), which the floating check passes when each touches something else
  const reach = Math.max(gap, NEAR_MISS);
  const nearMisses = [];
  for (const piece of pieces) {
    let nearest = Infinity;
    for (const other of pieces) {
      if (other === piece) continue;
      const apart = boxGap(piece.bounds, other.bounds);
      if (apart > reach) {
        nearest = Math.min(nearest, apart);
        continue;
      }
      // a point of one inside a closed part of the other: they are sunk into each other, and touch
      const sunk = (from, to) =>
        pointsOf(from).some((point) => to.solids.some((solid) => inside(point, solid, tris)));
      if (sunk(piece, other) || sunk(other, piece)) {
        nearest = 0;
        continue;
      }
      // two surfaces that cut through each other touch, though no corner of either is near the other's faces
      const near = (from, to) => trianglesOf(from).filter((t) => boxGap(boxOf(t), to.bounds) <= gap);
      const mine = near(piece, other);
      const theirs = near(other, piece);
      if (mine.some((A) => theirs.some((B) => boxGap(boxOf(A), boxOf(B)) === 0 && trianglesCross(A, B)))) {
        nearest = 0;
        continue;
      }
      let least = Infinity;
      let leastAt = null;
      for (const [from, to] of [
        [piece, other],
        [other, piece],
      ]) {
        const near = trianglesOf(to).filter((t) => boxGap(boxOf(t), from.bounds) <= reach);
        for (const point of pointsOf(from)) {
          for (const t of near) {
            const d = toTriangle(point, t);
            if (d < least) [least, leastAt] = [d, point];
          }
          if (least <= gap) break;
        }
        if (least <= gap) break;
      }
      nearest = Math.min(nearest, least);
      if (least > gap && least <= NEAR_MISS && piece.name !== other.name && piece.name < other.name)
        nearMisses.push({ a: piece.name, b: other.name, d: round2(least), at: leastAt.map(round2) });
    }
    piece.apart = pieces.length > 1 ? round2(nearest) : 0;
  }

  const faults = [];
  const notes = [];
  const named = (list) =>
    list
      .slice(0, NAMED_MOST)
      .map((p) => p.name)
      .join(", ") + (list.length > NAMED_MOST ? ` and ${list.length - NAMED_MOST} more` : "");
  const allowed = (piece) => allow.includes(piece.name);
  const meant = pieces.filter((p) => allowed(p) && (p.open || p.apart > gap));
  if (meant.length) notes.push(`${named(meant)}: open or apart, as the spec allows`);
  const openPieces = pieces.filter((p) => p.open && !allowed(p));
  if (openPieces.length)
    faults.push(
      `${openPieces.reduce((n, p) => n + p.open, 0)} open edges, in ${openPieces.length} pieces (${named(openPieces)}; the first at ${openPieces[0].openAt?.join(" ")}): holes, or a shape left open with no inside, which shows nothing from where it is open`,
    );
  const crowded = pieces.filter((p) => p.crowded);
  if (count.crowded)
    faults.push(`${count.crowded} edges are shared by three triangles or more that do not pair into closed shells, in ${named(crowded)}: faces given twice, or copies of a part that begin at one point (move each copy's start off the others')`);
  const flipped = pieces.filter((p) => p.flipped);
  if (flipped.length)
    faults.push(`${count.flipped} edges have both their triangles going round them the same way, in ${named(flipped)}: some faces are turned the wrong way`);
  const insideOut = pieces.filter((p) => p.insideOut);
  if (insideOut.length)
    faults.push(`${insideOut.reduce((n, p) => n + p.insideOut, 0)} closed shells are inside out, in ${named(insideOut)}: their faces look inwards, and the game draws only their far side`);
  const largest = pieces.reduce((a, b) => (b && (!a || b.tris > a.tris) ? b : a), null);
  const floating = pieces.filter((p) => p.apart > gap && p !== largest && !allowed(p));
  if (floating.length)
    faults.push(
      `${floating.length} pieces float apart from the rest: ${floating
        .slice(0, NAMED_MOST)
        .map((p) => `${p.name} ${p.apart} units away`)
        .join(", ")}`,
    );
  const misses = nearMisses.filter((m) => !allow.includes(m.a) && !allow.includes(m.b));
  // a note, not a fault: parts set side by side on purpose (teeth, nails, an eye by a nose) are as near; only
  // a picture tells a joint left open from a row of things. The report names them to be looked at close.
  if (misses.length)
    notes.push(
      `${misses.length} pairs of parts nearly touch and do not: ${misses
        .slice(0, NAMED_MOST)
        .map((m) => `${m.a} and ${m.b} ${m.d} apart at ${m.at.join(" ")}`)
        .join(", ")}${misses.length > NAMED_MOST ? ` and ${misses.length - NAMED_MOST} more` : ""}: where one was meant to meet the other, the joint is open by a sliver (look close: focus on them); sink one into the other`,
    );
  const sheets = pieces.filter((p) => p.sheet);
  if (count.buried) notes.push(`${count.buried} open edges are buried inside another closed part (a ridge's or a band's feet): not seen`);
  if (sheets.length) notes.push(`${sheets.length} pieces are thin sheets seen from both sides (${named(sheets)})`);
  const whole = boxOf(pieces.flatMap((p) => [p.bounds.mn, p.bounds.mx]));
  if (pieces.length)
    notes.push(
      `${tris.length} triangles in ${pieces.length} pieces; the shape runs from ${whole.mn.map(round2).join(" ")} to ${whole.mx.map(round2).join(" ")} (+z up), its lowest point at z ${round2(whole.mn[2])}`,
    );
  return {
    faults,
    notes,
    triangles: tris.length,
    edges: count,
    pieces: pieces.map(({ members, bounds, solids, ...rest }) => rest),
    box: { mn: whole.mn.map(round2), mx: whole.mx.map(round2) },
  };
}

/** The colour the pictures of `seeThrough` start as: what no model is painted. */
const KEY = [255, 0, 255];
/** A dot is the key colour when every channel is this near it, and is not when one is further than FAR. */
const NEAR_KEY = 8;
const FAR_KEY = 60;
/** The six sides `seeThrough` looks from, as [yaw, pitch]. */
const SIDES = [
  [0, 0],
  [90, 0],
  [180, 0],
  [270, 0],
  [0, 89],
  [0, -89],
];

/**
 * The same question asked of pictures: from six sides, the model drawn as the game draws it (faces seen from
 * behind left out) and with both sides of every face. A dot that is empty in the first and not in the second
 * is where a view looks through the near side of the model to faces it should not see: a hole, or a face
 * turned away. Returns { views: [{ yaw, pitch, dots }], dots, share, faults }; `share` is of the model's dots.
 */
export function seeThrough(src, { seq = 0, frame = 0, body = 0, size = 160, least = 0.002 } = {}) {
  const views = [];
  let through = 0;
  let filled = 0;
  for (const [yaw, pitch] of SIDES) {
    const options = { seq, frame, body, yaw, pitch, width: size, height: size, background: KEY, light: false };
    const front = render(src, options).rgba;
    // a masked texture's holes (a net's) show its far side on purpose: only other faces are asked of
    const both = render(src, { ...options, cull: "solid" }).rgba;
    let dots = 0;
    for (let i = 0; i < front.length; i += 4) {
      const empty = (rgba) =>
        Math.abs(rgba[i] - KEY[0]) <= NEAR_KEY &&
        Math.abs(rgba[i + 1] - KEY[1]) <= NEAR_KEY &&
        Math.abs(rgba[i + 2] - KEY[2]) <= NEAR_KEY;
      const full = (rgba) =>
        Math.abs(rgba[i] - KEY[0]) > FAR_KEY ||
        Math.abs(rgba[i + 1] - KEY[1]) > FAR_KEY ||
        Math.abs(rgba[i + 2] - KEY[2]) > FAR_KEY;
      if (full(both)) filled++;
      if (empty(front) && full(both)) dots++;
    }
    through += dots;
    views.push({ yaw, pitch, dots });
  }
  const share = filled ? through / filled : 0;
  const faults = [];
  if (share > least) {
    const worst = views.reduce((a, b) => (b.dots > a.dots ? b : a));
    faults.push(
      `the pictures look through the model at ${(share * 100).toFixed(1)}% of its dots (most from yaw ${worst.yaw}, pitch ${worst.pitch}): a hole, or faces turned away`,
    );
  }
  return { views, dots: through, share, faults };
}
