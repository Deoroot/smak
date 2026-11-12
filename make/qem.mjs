// A shape made of fewer triangles: the quadric error metric reducer of Garland and Heckbert ("Surface
// Simplification Using Quadric Error Metrics", SIGGRAPH 1997). Every triangle's plane is kept as a quadric at
// its corners, and the edge whose two ends can be joined with the least error is joined first, the joined point
// put where it is nearest all the planes the two ends stood on. Used to bring a dense shape (a carved hull, a
// bought model) down to what a GoldSrc model can carry.
//
//   reduce(tris, { target, keepBoundary, creaseAngle, stages, keep })  ->  { tris, report }
//
// `tris`: [[corner, corner, corner], ...], each corner { p: [x, y, z] } with anything else it carries (uv, bone,
// a part's name). Corners at the same point are one vertex. A vertex that survives keeps, in every triangle,
// the corner that triangle had; a triangle whose corner was joined into another vertex takes that vertex's
// corner from a face between the two whose corner there had the same place in the picture (`uv`), so that a
// triangle stays on its own chart. A normal carried along is the old one: work it out again after.
//
// Options:
//   target        the triangles wanted (at most); the reducer stops sooner when no join is safe
//   keepBoundary  an open border stays where it is (true): a plane upright on each border edge holds it
//   creaseAngle   in degrees: an edge whose two faces turn more than this is held the same way (a box's edges)
//   stages        join in rounds that each halve the count, the planes measured again from the shape each
//                 round begins with (true), or in one round from the first shape (false)
//   keep          (p) => true for a point that stays where it is, neither moved nor joined away: where this
//                 shape meets another reduced apart (two materials of one mesh), so that both keep the same
//                 points along the line they share and no crack opens between them
//
// A join is refused when it would change what the shape is: two ends that share more neighbours than the
// faces between them (the link condition: it would pinch the surface into a non-manifold edge), a face that
// would turn over, a closed piece that would fall flat (a tetrahedron is the least), an edge across an open
// border whose two ends are both on it, and a join that would leave a triangle with no corner of its own chart
// (`seam`: where two charts of a picture meet at one point).

/** How much more a border's or a crease's plane weighs than a face's, area for area. */
const HOLD = 1000;
/** A face turned so that its new facing has less than this cosine with its old one is refused. */
const LEAST_TURN = 0.2;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The quadric of the plane n.x + d = 0, weighed by w: its ten numbers (a2 ab ac ad b2 bc bd c2 cd d2). */
function planeQuadric([a, b, c], d, w) {
  return [
    a * a * w,
    a * b * w,
    a * c * w,
    a * d * w,
    b * b * w,
    b * c * w,
    b * d * w,
    c * c * w,
    c * d * w,
    d * d * w,
  ];
}

/** The error of a point under a quadric: the weighed sum of its squared distances from the planes. */
function errorAt(q, [x, y, z]) {
  const e =
    q[0] * x * x +
    2 * q[1] * x * y +
    2 * q[2] * x * z +
    2 * q[3] * x +
    q[4] * y * y +
    2 * q[5] * y * z +
    2 * q[6] * y +
    q[7] * z * z +
    2 * q[8] * z +
    q[9];
  return Math.max(0, e);
}

/** The point of least error under a quadric, or null when its planes do not fix one (they are parallel). */
function bestPoint(q) {
  const [a, b, c, d, e, f, g, h, i] = [q[0], q[1], q[2], q[1], q[4], q[5], q[2], q[5], q[7]];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const size = Math.abs(a) + Math.abs(e) + Math.abs(i);
  if (!(Math.abs(det) > 1e-9 * size * size * size) || !size) return null;
  const r = [-q[3], -q[6], -q[8]];
  return [
    (r[0] * (e * i - f * h) - b * (r[1] * i - f * r[2]) + c * (r[1] * h - e * r[2])) / det,
    (a * (r[1] * i - f * r[2]) - r[0] * (d * i - f * g) + c * (d * r[2] - r[1] * g)) / det,
    (a * (e * r[2] - r[1] * h) - b * (d * r[2] - r[1] * g) + r[0] * (d * h - e * g)) / det,
  ];
}

/** A heap of the joins, cheapest on top. Each entry: [cost, u, v, u's stamp, v's stamp, x, y, z]. */
class Heap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (a[up][0] <= a[i][0]) break;
      [a[up], a[i]] = [a[i], a[up]];
      i = up;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Corners at one point made one vertex: { pos: [[x, y, z]], faces: [[a, b, c]], corners: [[c0, c1, c2]] }. */
function weld(tris) {
  const index = new Map();
  const pos = [];
  const faces = [];
  const corners = [];
  for (const tri of tris) {
    const f = tri.map((c) => {
      const key = `${c.p[0]},${c.p[1]},${c.p[2]}`;
      let k = index.get(key);
      if (k === undefined) {
        k = pos.push([c.p[0], c.p[1], c.p[2]]) - 1;
        index.set(key, k);
      }
      return k;
    });
    // a triangle with two corners at one point has no face: it is left out
    if (f[0] === f[1] || f[1] === f[2] || f[0] === f[2]) continue;
    faces.push(f);
    corners.push(tri);
  }
  return { pos, faces, corners };
}

/**
 * Fewer triangles, the shape kept. Returns { tris, report: { from, to, stages, border, creases, refused } }:
 * `refused` counts the joins turned down, by why.
 */
export function reduce(tris, { target, keepBoundary = true, creaseAngle, stages = true, keep } = {}) {
  const { pos, faces, corners } = weld(tris);
  const kept = keep ? pos.map((p) => Boolean(keep(p))) : null;
  const from = faces.length;
  const goal = Math.max(1, Math.floor(target ?? from / 2));
  const refused = { link: 0, flat: 0, turned: 0, border: 0, seam: 0 };
  const creaseCos = creaseAngle === undefined ? null : Math.cos((creaseAngle * Math.PI) / 180);
  const alive = faces.map(() => true);
  const dead = pos.map(() => false);
  // each vertex's faces
  const around = pos.map(() => []);
  faces.forEach((f, i) => f.forEach((v) => around[v].push(i)));
  const stamp = pos.map(() => 0);
  let count = from;
  let rounds = 0;
  let border = 0;
  let creases = 0;

  const normalOf = (f, at = (v) => pos[v]) => cross(sub(at(f[1]), at(f[0])), sub(at(f[2]), at(f[0])));
  const neighbours = (v) => {
    const out = new Set();
    for (const i of around[v]) for (const w of faces[i]) if (w !== v) out.add(w);
    return out;
  };

  while (count > goal) {
    rounds++;
    const stageGoal = stages ? Math.max(goal, Math.floor(count / 2)) : goal;
    // the planes, measured from the shape as it stands
    const quadric = pos.map(() => new Array(10).fill(0));
    const add = (v, q) => {
      for (let k = 0; k < 10; k++) quadric[v][k] += q[k];
    };
    const edges = new Map();
    // vertices on an edge of more than two faces are left where they are: joining there tears the shape
    const pinned = new Set();
    if (kept) kept.forEach((held, v) => held && pinned.add(v));
    faces.forEach((f, i) => {
      if (!alive[i]) return;
      const n = normalOf(f);
      const area2 = Math.hypot(...n);
      if (area2 > 0) {
        const u = n.map((x) => x / area2);
        const q = planeQuadric(u, -dot(u, pos[f[0]]), area2 / 2);
        for (const v of f) add(v, q);
      }
      for (let k = 0; k < 3; k++) {
        const a = f[k];
        const b = f[(k + 1) % 3];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        const e = edges.get(key);
        if (e) e.faces.push(i);
        else edges.set(key, { a: Math.min(a, b), b: Math.max(a, b), faces: [i] });
      }
    });
    const onBorder = new Set();
    // a plane upright on an edge, through it, along the face beside it: what holds a border or a crease
    const holdEdge = (e, i) => {
      const n = normalOf(faces[i]);
      const along = sub(pos[e.b], pos[e.a]);
      const length = Math.hypot(...along);
      const side = cross(along, n);
      const l = Math.hypot(...side);
      if (!l || !length) return;
      const u = side.map((x) => x / l);
      const q = planeQuadric(u, -dot(u, pos[e.a]), HOLD * length * length);
      add(e.a, q);
      add(e.b, q);
    };
    for (const e of edges.values()) {
      if (e.faces.length > 2) {
        pinned.add(e.a);
        pinned.add(e.b);
      } else if (e.faces.length === 1) {
        onBorder.add(e.a);
        onBorder.add(e.b);
        if (keepBoundary) holdEdge(e, e.faces[0]);
        if (rounds === 1) border++;
      } else if (creaseCos !== null) {
        const [n0, n1] = e.faces.map((i) => normalOf(faces[i]));
        const c = dot(n0, n1) / (Math.hypot(...n0) * Math.hypot(...n1) || 1);
        if (c < creaseCos) {
          holdEdge(e, e.faces[0]);
          holdEdge(e, e.faces[1]);
          if (rounds === 1) creases++;
        }
      }
    }

    const heap = new Heap();
    const offer = (u, v) => {
      const q = quadric[u].map((x, k) => x + quadric[v][k]);
      const mid = [0, 1, 2].map((k) => (pos[u][k] + pos[v][k]) / 2);
      const length = Math.hypot(...sub(pos[u], pos[v]));
      let best = null;
      const solved = bestPoint(q);
      // the point the planes give, unless it runs far off the edge (planes nearly parallel), else the better
      // of the two ends and the middle
      const choices = [pos[u], pos[v], mid];
      if (solved && Math.hypot(...sub(solved, mid)) < 2 * length + 1e-9) choices.unshift(solved);
      for (const p of choices) {
        const cost = errorAt(q, p);
        if (!best || cost < best[0] - 1e-12 * (1 + best[0])) best = [cost, p];
      }
      heap.push([best[0], u, v, stamp[u], stamp[v], best[1][0], best[1][1], best[1][2]]);
    };
    for (const e of edges.values()) if (!pinned.has(e.a) && !pinned.has(e.b)) offer(e.a, e.b);

    while (count > stageGoal && heap.size) {
      const [, a, b, sa, sb, x, y, z] = heap.pop();
      if (dead[a] || dead[b] || stamp[a] !== sa || stamp[b] !== sb) continue;
      const to = [x, y, z];
      // the end nearer the joined point is the one that survives, with its corners
      const nearer = Math.hypot(...sub(pos[b], to)) < Math.hypot(...sub(pos[a], to));
      const [u, v] = nearer ? [b, a] : [a, b];
      const shared = around[u].filter((i) => faces[i].includes(v));
      if (!shared.length) continue;
      // the link condition: the ends share no neighbour but the third corners of the faces between them
      const nu = neighbours(u);
      const nv = neighbours(v);
      const common = [...nu].filter((w) => nv.has(w));
      if (common.length !== shared.length) {
        refused.link++;
        continue;
      }
      // a closed piece of four corners is the least there is
      if (shared.length === 2 && new Set([...nu, ...nv]).size <= 4) {
        refused.flat++;
        continue;
      }
      if (onBorder.has(u) && onBorder.has(v) && shared.length !== 1) {
        refused.border++;
        continue;
      }
      // no face may turn over, or fall to nothing
      let turned = false;
      for (const i of [...around[u], ...around[v]]) {
        if (shared.includes(i)) continue;
        const f = faces[i];
        const before = normalOf(f);
        const after = normalOf(f, (w) => (w === u || w === v ? to : pos[w]));
        const lb = Math.hypot(...before);
        const la = Math.hypot(...after);
        if (!(la > 1e-12 * (lb + 1e-30)) || dot(before, after) < LEAST_TURN * lb * la) {
          turned = true;
          break;
        }
      }
      if (turned) {
        refused.turned++;
        continue;
      }
      // each face of v takes u's corner from a face between the two that wore v's place in the picture the same:
      // where two charts of a picture meet (a gun's side and its rim) a vertex has a corner in each, and a face
      // given the other chart's stretches across the picture (the held shotgun's streaked rim, 2026-10-17). A
      // face with no such partner would be so: the join is refused
      const uvOf = (c) => (c?.uv ? `${c.uv[0]},${c.uv[1]}` : "");
      const takes = new Map();
      let seam = false;
      for (const i of around[v]) {
        if (!alive[i] || shared.includes(i)) continue;
        const at = uvOf(corners[i][faces[i].indexOf(v)]);
        const partner = shared.find((j) => uvOf(corners[j][faces[j].indexOf(v)]) === at);
        if (partner === undefined) {
          seam = true;
          break;
        }
        takes.set(i, corners[partner][faces[partner].indexOf(u)]);
      }
      if (seam) {
        refused.seam++;
        continue;
      }
      // join v into u
      for (const i of shared) {
        alive[i] = false;
        count--;
        for (const w of faces[i]) if (w !== u && w !== v) around[w] = around[w].filter((j) => j !== i);
      }
      for (const i of around[v]) {
        if (!alive[i]) continue;
        const f = faces[i];
        const k = f.indexOf(v);
        f[k] = u;
        corners[i] = corners[i].map((c, j) => (j === k ? takes.get(i) : c));
        around[u].push(i);
      }
      around[u] = around[u].filter((i) => alive[i]);
      around[v] = [];
      dead[v] = true;
      pos[u] = to;
      for (let k = 0; k < 10; k++) quadric[u][k] += quadric[v][k];
      if (onBorder.has(v)) onBorder.add(u);
      stamp[u]++;
      for (const w of neighbours(u)) if (!pinned.has(w)) offer(u, w);
    }
    if (count > stageGoal) break; // no join left that is safe
  }
  for (const k of Object.keys(refused)) if (!refused[k]) delete refused[k];
  const out = [];
  faces.forEach((f, i) => {
    if (alive[i]) out.push(f.map((v, k) => ({ ...corners[i][k], p: [...pos[v]] })));
  });
  return { tris: out, report: { from, to: out.length, stages: rounds, border, creases, refused } };
}
