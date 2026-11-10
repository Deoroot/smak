// Pieces laid out on one picture: each piece's faces opened out flat about their edges, as a paper model's net,
// at their true size (`density` texels a unit, the same everywhere: the pixel-art look), and the islands packed
// by their shapes, not their boxes, each at the first place where its texels and a ring about them touch no
// other's. Corners land on whole texels, as GoldSrc keeps them. Pieces of one `share` wear one set of texels (a
// left arm's plate and its right's); a piece with a `mirror` plane is laid out by its one half, the other half
// wearing the same texels mirrored. Pieces of one `net` are laid together: their islands touching at corners, as
// one shape on the picture, packed as one (a limb's plates side by side, where a painter looks for them).
//
//   unwrap(pieces, { density, width, fold, margin, rows, pow2, nets }) -> layout
//   withUV(pieces, layout) -> the pieces, each corner with its `uv` (0 to 1), for `putRigid` or `buildMdl`
//
// Plain ESM, no dependencies.
import { add, sub, mul, dot, cross, len, unit } from "../core/solids.mjs";

const key3 = (p) => p.map((v) => Math.round(v * 1000)).join(",");
const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
/** A face with less area than this is no face: it is laid with a neighbour, or alone. */
const NO_AREA = 1e-9;
/** A face whose normal is nearer a piece's axis than this (as a cosine) is one of its ends. */
const END_FACING = 0.8;
/** Below this, a direction laid on a face is too short to orient its island by: the next is tried. */
const SHORT = 0.35;

/** The points of a triangle given as corners ({ p }) or as points. */
const pointsOfTri = (t) => t.map((c) => c.p ?? c);

/** The weights of a point in a triangle's plane, by its corners (outside it too). */
function bary(T, p) {
  const v0 = sub(T[1], T[0]);
  const v1 = sub(T[2], T[0]);
  const v2 = sub(p, T[0]);
  const d00 = dot(v0, v0);
  const d01 = dot(v0, v1);
  const d11 = dot(v1, v1);
  const d20 = dot(v2, v0);
  const d21 = dot(v2, v1);
  const den = d00 * d11 - d01 * d01 || 1e-12;
  const b = (d11 * d20 - d01 * d21) / den;
  const c = (d00 * d21 - d01 * d20) / den;
  return [1 - b - c, b, c];
}

/** Two triangles in the plane overlap (more than touching: each is shrunk a little first). */
function overlaps2(a, b) {
  const shrink = (t) => {
    const c = [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3];
    return t.map((p) => [c[0] + (p[0] - c[0]) * 0.97, c[1] + (p[1] - c[1]) * 0.97]);
  };
  a = shrink(a);
  b = shrink(b);
  const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const inside = (t, p) => {
    const s0 = side(t[0], t[1], p);
    const s1 = side(t[1], t[2], p);
    const s2 = side(t[2], t[0], p);
    return (s0 > 0 && s1 > 0 && s2 > 0) || (s0 < 0 && s1 < 0 && s2 < 0);
  };
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const p = a[i];
      const q = a[(i + 1) % 3];
      const r = b[j];
      const u = b[(j + 1) % 3];
      const d1 = side(p, q, r);
      const d2 = side(p, q, u);
      const d3 = side(r, u, p);
      const d4 = side(r, u, q);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
        return true;
    }
  return inside(a, b[0]) || inside(b, a[0]);
}

/**
 * Faces opened out into islands: from the largest face not yet laid (square on, `up` up as seen from outside),
 * its neighbours are unfolded about their shared edge one by one, the flattest folds first, each at its true
 * size; a face that would land on the island already laid, or folds more than `fold` degrees, or is an end of
 * the piece (facing along `axis`) where the island is its side (or the other way round), waits for an island of
 * its own. Returns [{ faces: [index], flat: Map(index -> [[x, y] x3] in units) }].
 */
export function unfold(
  tris,
  {
    up = [0, 0, 1],
    alt = [
      [1, 0, 0],
      [0, 1, 0],
    ],
    fold = 100,
    axis = null,
  } = {},
) {
  const normals = tris.map((t) => cross(sub(t[1], t[0]), sub(t[2], t[0])));
  const areas = normals.map((v) => len(v) / 2);
  const ns = normals.map(unit);
  const byEdge = new Map();
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const e = edgeKey(key3(t[k]), key3(t[(k + 1) % 3]));
      if (!byEdge.has(e)) byEdge.set(e, []);
      byEdge.get(e).push(i);
    }
  });
  const cosFold = Math.cos((fold * Math.PI) / 180);
  const laid = new Array(tris.length).fill(null);
  const islands = [];
  const order = tris.map((_, i) => i).sort((a, b) => areas[b] - areas[a]);
  for (const seed of order) {
    if (laid[seed]) continue;
    const N = ns[seed];
    let v = sub(up, mul(N, dot(up, N)));
    for (const w of alt) if (len(v) < SHORT) v = sub(w, mul(N, dot(w, N)));
    v = unit(v);
    const r = unit(cross(v, N));
    const flat = new Map();
    const put = (i, t2) => {
      laid[i] = t2;
      flat.set(i, t2);
    };
    put(
      seed,
      tris[seed].map((p) => [dot(p, r), -dot(p, v)]),
    );
    const faces = [seed];
    const queue = [];
    const offer = (i) => {
      for (let k = 0; k < 3; k++)
        for (const j of byEdge.get(edgeKey(key3(tris[i][k]), key3(tris[i][(k + 1) % 3])))) {
          if (j === i || laid[j] || areas[j] < NO_AREA) continue;
          const c = dot(ns[i], ns[j]);
          if (c < cosFold) continue;
          if (axis && Math.abs(dot(ns[i], axis)) > END_FACING !== Math.abs(dot(ns[j], axis)) > END_FACING)
            continue;
          queue.push({ from: i, k, to: j, c });
        }
    };
    offer(seed);
    while (queue.length) {
      // the flattest fold first
      let best = 0;
      for (let q = 1; q < queue.length; q++) if (queue[q].c > queue[best].c) best = q;
      const { from, k, to } = queue.splice(best, 1)[0];
      if (laid[to]) continue;
      // the shared edge: corners k and k+1 of `from`; the new corner goes across it from `from`'s third
      const A2 = laid[from][k];
      const B2 = laid[from][(k + 1) % 3];
      const P3 = tris[to];
      const ia = P3.findIndex((p) => key3(p) === key3(tris[from][k]));
      const ib = P3.findIndex((p) => key3(p) === key3(tris[from][(k + 1) % 3]));
      if (ia < 0 || ib < 0 || ia === ib) continue;
      const ic = 3 - ia - ib;
      const e3 = sub(P3[ib], P3[ia]);
      const el = len(e3);
      if (el < 1e-9) continue;
      const along = dot(sub(P3[ic], P3[ia]), e3) / el;
      const off = len(sub(sub(P3[ic], P3[ia]), mul(e3, along / el)));
      const e2 = [(B2[0] - A2[0]) / el, (B2[1] - A2[1]) / el];
      let n2 = [-e2[1], e2[0]];
      const C2f = laid[from][(k + 2) % 3];
      if ((C2f[0] - A2[0]) * n2[0] + (C2f[1] - A2[1]) * n2[1] > 0) n2 = [-n2[0], -n2[1]];
      const t2 = [];
      t2[ia] = A2;
      t2[ib] = B2;
      t2[ic] = [A2[0] + e2[0] * along + n2[0] * off, A2[1] + e2[1] * along + n2[1] * off];
      if (faces.some((f) => overlaps2(flat.get(f), t2))) continue;
      put(to, t2);
      faces.push(to);
      offer(to);
    }
    islands.push({ faces, flat });
  }
  return islands;
}

/**
 * The texels an island covers (its corners rounded as they will be), grown by `margin` all round, as offsets
 * from its box's corner less the margin.
 */
function maskOf(isl, margin) {
  const w = isl.w + 2 * margin + 2;
  const h = isl.h + 2 * margin + 2;
  const grid = new Uint8Array(w * h);
  const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  for (const i of isl.tris) {
    const T = [0, 1, 2].map((k) => {
      const [u, v] = isl.uvOf(i, k);
      return [Math.round(u - isl.u0) + margin, Math.round(v - isl.v0) + margin];
    });
    const x0 = Math.min(...T.map((t) => t[0]));
    const x1 = Math.max(...T.map((t) => t[0]));
    const y0 = Math.min(...T.map((t) => t[1]));
    const y1 = Math.max(...T.map((t) => t[1]));
    const area = side(T[0], T[1], T[2]);
    for (let y = y0; y < y1 || y === y0; y++)
      for (let x = x0; x < x1 || x === x0; x++) {
        // the texel is the island's when any of its corners or its middle is in the triangle
        let hit = false;
        for (const p of [
          [x + 0.5, y + 0.5],
          [x, y],
          [x + 1, y],
          [x, y + 1],
          [x + 1, y + 1],
        ]) {
          // prettier-ignore
          const a = side(T[0], T[1], p);
          const b = side(T[1], T[2], p);
          const c = side(T[2], T[0], p);
          if (area >= 0 ? a >= -1e-6 && b >= -1e-6 && c >= -1e-6 : a <= 1e-6 && b <= 1e-6 && c <= 1e-6) {
            hit = true;
            break;
          }
        }
        if (hit && x >= 0 && y >= 0 && x < w && y < h) grid[y * w + x] = 1;
      }
  }
  const out = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let near = false;
      for (let dy = -margin; dy <= margin && !near; dy++)
        for (let dx = -margin; dx <= margin && !near; dx++) {
          const X = x + dx;
          const Y = y + dy;
          if (X >= 0 && Y >= 0 && X < w && Y < h && grid[Y * w + X]) near = true;
        }
      if (near) out.push([x, y]);
    }
  return out;
}

/** The texels whose middles an island's triangles cover (its corners rounded as they will be), as "x,y" keys. */
function coreOf(isl) {
  const out = new Set();
  const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  for (const i of isl.tris) {
    const T = isl.tri(i);
    const area = side(T[0], T[1], T[2]);
    if (Math.abs(area) < 1e-9) continue;
    const x0 = Math.min(...T.map((t) => t[0]));
    const x1 = Math.max(...T.map((t) => t[0]));
    const y0 = Math.min(...T.map((t) => t[1]));
    const y1 = Math.max(...T.map((t) => t[1]));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const p = [x + 0.5, y + 0.5];
        const a = side(T[0], T[1], p);
        const b = side(T[1], T[2], p);
        const c = side(T[2], T[0], p);
        if (area > 0 ? a > 0 && b > 0 && c > 0 : a < 0 && b < 0 && c < 0) out.add(`${x},${y}`);
      }
  }
  return out;
}

/**
 * The islands as units to pack: each alone, or those of one net key laid together, the largest first, then each
 * where one of its corners lands on a corner of the net already laid, its texels on none of the net's, the net's
 * box kept smallest (and no wider than the picture). An island that cannot touch the net without lying on it is
 * a unit alone. `islands` carry `tri(i)`: a triangle's corners in whole texels from the island's box's corner.
 * Returns [{ w, h, mask?, members: [{ isl, dx, dy }], name }].
 */
function netUnits(islands, keyOf, margin, width) {
  const groups = new Map();
  const units = [];
  const alone = (isl) => ({ w: isl.w, h: isl.h, members: [{ isl, dx: 0, dy: 0 }], name: `an island of piece ${isl.piece}` }); // prettier-ignore
  for (const isl of islands) {
    const key = keyOf(isl);
    if (key === undefined || key === null) {
      units.push(alone(isl));
      continue;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(isl);
  }
  for (const [key, list] of groups) {
    list.sort((a, b) => b.w * b.h - a.w * a.h);
    const taken = new Set();
    const corners = new Set();
    const members = [];
    let box = null;
    for (const isl of list) {
      const core = [...coreOf(isl)].map((c) => c.split(",").map(Number));
      const mine = [...new Set(isl.tris.flatMap((i) => isl.tri(i).map(([u, v]) => `${u},${v}`)))].map((c) => c.split(",").map(Number)); // prettier-ignore
      let best = null;
      if (!members.length) best = { dx: 0, dy: 0, cost: 0 };
      else {
        const tried = new Set();
        for (const c of corners) {
          const [cx, cy] = c.split(",").map(Number);
          for (const [mx, my] of mine) {
            const dx = cx - mx;
            const dy = cy - my;
            if (tried.has(`${dx},${dy}`)) continue;
            tried.add(`${dx},${dy}`);
            const x0 = Math.min(box.x0, dx);
            const y0 = Math.min(box.y0, dy);
            const x1 = Math.max(box.x1, dx + isl.w);
            const y1 = Math.max(box.y1, dy + isl.h);
            if (x1 - x0 + 2 * margin > width) continue;
            const cost = (x1 - x0) * (y1 - y0) + 0.5 * Math.max(x1 - x0, y1 - y0) ** 2;
            if (best && cost >= best.cost) continue;
            if (core.some(([x, y]) => taken.has(`${x + dx},${y + dy}`))) continue;
            best = { dx, dy, cost };
          }
        }
      }
      if (!best) {
        units.push(alone(isl));
        continue;
      }
      for (const [x, y] of core) taken.add(`${x + best.dx},${y + best.dy}`);
      for (const [x, y] of mine) corners.add(`${x + best.dx},${y + best.dy}`);
      members.push({ isl, dx: best.dx, dy: best.dy });
      box = box
        ? { x0: Math.min(box.x0, best.dx), y0: Math.min(box.y0, best.dy), x1: Math.max(box.x1, best.dx + isl.w), y1: Math.max(box.y1, best.dy + isl.h) } // prettier-ignore
        : { x0: 0, y0: 0, x1: isl.w, y1: isl.h };
    }
    if (!members.length) continue;
    for (const m of members) {
      m.dx -= box.x0;
      m.dy -= box.y0;
    }
    const mask = new Map();
    for (const m of members)
      for (const [x, y] of maskOf(m.isl, margin)) mask.set(`${x + m.dx},${y + m.dy}`, [x + m.dx, y + m.dy]);
    units.push({ w: box.x1 - box.x0, h: box.y1 - box.y0, mask: [...mask.values()], members, name: `the net ${key}` }); // prettier-ignore
  }
  return units;
}

/**
 * Pieces unfolded and packed on one picture.
 *   pieces   [{ tris, up?, axis?, alt?, share?, mirror? }]: `tris` [[{ p } x3]] or triangles of points, each
 *            piece in a space of its own (a bone's, or the model's at rest). `up`: the way that is up on the
 *            picture where a face allows ([0, 0, 1]); `alt`: the ways tried after it, for a face that looks up.
 *            `axis`: a piece's length, whose ends get islands of their own. `share`: pieces of one share wear
 *            the first one's texels, triangle by triangle (they must be built alike: as many triangles, in the
 *            same order). `mirror`: { n, at }, a plane through `at` with normal `n`: the half on n's side is
 *            laid out, the other half wears its mirror's texels
 *   density  texels a unit (3)
 *   width    the picture's width (256); its height is what the islands need, a multiple of 8 (a power of two
 *            with `pow2`, the default), at most `rows` (512)
 *   fold     the most two faces may fold about their edge and stay in one island, in degrees (100)
 *   margin   texels kept free about each island (1)
 *   nets     (piece, n) -> a key (null for none), or each piece's own `net` when not given: the islands of the
 *            pieces of one key laid together into one net, each touching one laid before it at a corner, and the
 *            net packed as one
 * Returns { width, height, density, islands: [{ id, piece, tris, x, y, w, h }], pieces: [{ uv, islandOf,
 * primary }] }: for each piece and each of its triangles, the three corners' places on the picture in whole
 * texels ([u, v], 0 to width and height), and the island each lies in. An island wider than the picture is
 * turned a quarter. It throws when an island will not fit.
 */
export function unwrap(
  pieces,
  { density = 3, width = 256, fold = 100, margin = 1, rows = 512, pow2 = true, nets } = {},
) {
  const D = density;
  const islands = [];
  const entries = [];
  const primaryOf = new Map();
  pieces.forEach((piece, n) => {
    const P = piece.tris.map(pointsOfTri);
    if (piece.share !== undefined && primaryOf.has(piece.share)) {
      entries.push({ piece: n, primary: primaryOf.get(piece.share), P });
      return;
    }
    if (piece.share !== undefined) primaryOf.set(piece.share, n);
    const mirror = piece.mirror ? { n: unit(piece.mirror.n), at: piece.mirror.at ?? [0, 0, 0] } : null;
    // the half that is laid out: all of it, or the side of the mirror's plane its normal looks to
    const half = P.map((_, i) => i).filter((i) => {
      if (!mirror) return true;
      const c = mul(add(add(P[i][0], P[i][1]), P[i][2]), 1 / 3);
      return dot(sub(c, mirror.at), mirror.n) > -1e-4;
    });
    const entry = {
      piece: n,
      primary: n,
      P,
      mirror,
      half,
      uv: P.map(() => null),
      islandOf: new Int32Array(P.length).fill(-1),
    };
    entries.push(entry);
    const net = unfold(
      half.map((i) => P[i]),
      {
        up: piece.up ?? [0, 0, 1],
        alt: piece.alt ?? [
          [1, 0, 0],
          [0, 1, 0],
        ],
        fold,
        axis: piece.axis ? unit(piece.axis) : null,
      },
    );
    for (const g of net) {
      const faces = g.faces.map((j) => half[j]);
      const flatOf = new Map(g.faces.map((j) => [half[j], g.flat.get(j)]));
      const uvOf = (i, k) => flatOf.get(i)[k].map((v) => v * D);
      const pts = faces.flatMap((i) => [0, 1, 2].map((k) => uvOf(i, k)));
      const u0 = Math.min(...pts.map((p) => p[0]));
      const v0 = Math.min(...pts.map((p) => p[1]));
      const u1 = Math.max(...pts.map((p) => p[0]));
      const v1 = Math.max(...pts.map((p) => p[1]));
      islands.push({
        id: islands.length,
        piece: n,
        tris: faces,
        uvOf,
        u0,
        v0,
        w: Math.max(1, Math.ceil(u1 - u0 - 1e-6)),
        h: Math.max(1, Math.ceil(v1 - v0 - 1e-6)),
      });
    }
  });

  // an island wider than the picture is turned a quarter
  for (const isl of islands) {
    if (isl.w + 2 * margin <= width) continue;
    const f = isl.uvOf;
    isl.uvOf = (i, k) => {
      const [u, v] = f(i, k);
      return [-v, u];
    };
    const pts = isl.tris.flatMap((i) => [0, 1, 2].map((k) => isl.uvOf(i, k)));
    isl.u0 = Math.min(...pts.map((q) => q[0]));
    isl.v0 = Math.min(...pts.map((q) => q[1]));
    [isl.w, isl.h] = [isl.h, isl.w];
  }
  // packed by their shapes: the largest first, each at the first place (top down, left to right) where its
  // texels and a ring of `margin` about them touch no other island's; the islands of one net as one
  const netOf = (n) => (typeof nets === "function" ? nets(pieces[n], n) : pieces[n].net);
  const units = islands.some((isl) => netOf(isl.piece) != null)
    ? netUnits(
        islands.map((isl) => ({
          ...isl,
          of: isl,
          tri: (i) => [0, 1, 2].map((k) => isl.uvOf(i, k)).map(([u, v]) => [Math.round(u - isl.u0), Math.round(v - isl.v0)]), // prettier-ignore
        })),
        (isl) => netOf(isl.piece),
        margin,
        width,
      )
    : islands.map((isl) => ({ w: isl.w, h: isl.h, members: [{ isl, dx: 0, dy: 0 }], name: `an island of piece ${isl.piece}` })); // prettier-ignore
  const taken = new Uint8Array(width * rows);
  let bottom = 0;
  for (const unit of [...units].sort((a, b) => b.w * b.h - a.w * a.h)) {
    if (unit.w + 2 * margin > width)
      throw new Error(`unwrap: ${unit.name} is ${unit.w} texels both ways, more than ${width}`);
    const mask = unit.mask ?? maskOf(unit.members[0].isl, margin);
    let placed = false;
    for (let y = 0; y + unit.h + margin <= rows && !placed; y++)
      for (let x = 0; x + unit.w + 2 * margin <= width && !placed; x++) {
        let free = true;
        for (const [mx, my] of mask) {
          const X = x + mx;
          const Y = y + my;
          if (X >= 0 && Y >= 0 && X < width && Y < rows && taken[Y * width + X]) {
            free = false;
            break;
          }
        }
        if (!free) continue;
        for (const [mx, my] of mask) {
          const X = x + mx;
          const Y = y + my;
          if (X >= 0 && Y >= 0 && X < width && Y < rows) taken[Y * width + X] = 1;
        }
        for (const m of unit.members) {
          const isl = m.isl.of ?? m.isl;
          isl.x = x + m.dx + margin;
          isl.y = y + m.dy + margin;
        }
        bottom = Math.max(bottom, y + margin + unit.h);
        placed = true;
      }
    if (!placed) throw new Error(`unwrap: no room for ${unit.name} in ${width} by ${rows}: lower the density`);
  }
  let height = Math.max(8, Math.ceil((bottom + margin) / 8) * 8);
  if (pow2) height = 2 ** Math.ceil(Math.log2(height));
  if (height > rows) throw new Error(`unwrap: the islands need ${height} rows, more than ${rows}`);

  // whole texels, for the pieces laid out
  const byPiece = new Map(entries.map((e) => [e.piece, e]));
  for (const isl of islands) {
    const e = byPiece.get(isl.piece);
    for (const i of isl.tris) {
      e.uv[i] = [0, 1, 2].map((k) => {
        const [u, v] = isl.uvOf(i, k);
        return [Math.round(u - isl.u0) + isl.x, Math.round(v - isl.v0) + isl.y];
      });
      e.islandOf[i] = isl.id;
    }
  }
  // the mirrored half: each triangle wears its mirror's place in the half laid out, corner by corner through the
  // mirror triangle's flat place
  const normal = (t) => unit(cross(sub(t[1], t[0]), sub(t[2], t[0])));
  const centre = (t) => mul(add(add(t[0], t[1]), t[2]), 1 / 3);
  for (const e of entries) {
    if (!e.mirror) continue;
    const { n, at } = e.mirror;
    const flip = (p) => sub(p, mul(n, 2 * dot(sub(p, at), n)));
    const flipDir = (v) => sub(v, mul(n, 2 * dot(v, n)));
    const laidOut = e.half.map((j) => ({ j, n: normal(e.P[j]), c: centre(e.P[j]) }));
    e.P.forEach((t, i) => {
      if (e.uv[i]) return;
      const mt = t.map(flip);
      const mn = flipDir(normal(t));
      const mc = centre(mt);
      let best = null;
      let bd = Infinity;
      for (const l of laidOut) {
        if (dot(l.n, mn) < 0.98) continue;
        const d = len(sub(l.c, mc));
        if (d < bd) {
          bd = d;
          best = l;
        }
      }
      if (!best) throw new Error(`unwrap: piece ${e.piece} has a triangle with no mirror in its other half`);
      const isl = islands[e.islandOf[best.j]];
      const T = e.P[best.j];
      const flat = [0, 1, 2].map((k) => isl.uvOf(best.j, k));
      e.islandOf[i] = isl.id;
      e.uv[i] = mt.map((p) => {
        const w = bary(T, p);
        const u = w[0] * flat[0][0] + w[1] * flat[1][0] + w[2] * flat[2][0];
        const v = w[0] * flat[0][1] + w[1] * flat[1][1] + w[2] * flat[2][1];
        return [Math.round(u - isl.u0) + isl.x, Math.round(v - isl.v0) + isl.y];
      });
    });
  }
  // a piece of a share already laid out wears the first one's, triangle by triangle
  const out = entries.map((e) => {
    if (e.primary === e.piece) return { uv: e.uv, islandOf: e.islandOf, primary: true };
    const first = byPiece.get(e.primary);
    if (e.P.length !== first.P.length)
      throw new Error(
        `unwrap: piece ${e.piece} has ${e.P.length} triangles, and piece ${e.primary} of its share ${first.P.length}`,
      );
    return { uv: first.uv, islandOf: first.islandOf, primary: false };
  });
  return {
    width,
    height,
    density: D,
    islands: islands.map(({ id, piece, tris, x, y, w, h }) => ({ id, piece, tris, x, y, w, h })),
    pieces: out,
  };
}

/** The pieces again, each corner with its `uv` on the layout's picture, 0 to 1: as `putRigid` and `buildMdl` take. */
export const withUV = (pieces, layout) =>
  pieces.map((piece, n) => ({
    ...piece,
    tris: piece.tris.map((t, i) =>
      t.map((c, k) => ({
        ...(c.p ? c : { p: c }),
        uv: [layout.pieces[n].uv[i][k][0] / layout.width, layout.pieces[n].uv[i][k][1] / layout.height],
      })),
    ),
  }));
