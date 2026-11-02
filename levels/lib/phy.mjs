// A Source model's collision (`.phy`, beside its `.mdl`), read as far as a survey needs to ask what a static
// prop stops: its solids, each a set of convex hulls, each hull as the planes that bound it. Written from the
// layout Valve's vphysics and the IVP library give it (and that Crowbar and SourceIO read the same way):
//
//   file     { int headerSize (16), int id, int solidCount, int checksum }, then solidCount solids
//   solid    { int size } then, when it begins "VPHY", { short version, short modelType, int surfaceSize,
//            float dragAxisAreas[3], int axisMapSize } and the compact surface; an older file has the
//            compact surface straight after the size
//   surface  IVP_Compact_Surface, 48 bytes: mass centre, inertia, radius, flags and byte size, the offset of
//            the ledge tree's root (at 32), three ints (the middle one "IVPS")
//   tree     IVP_Compact_Ledgetree_Node, 28 bytes: { int offsetRight, int offsetLedge, float centre[3],
//            float radius, uchar boxSizes[3], uchar free }; the left child follows the node, the right is at
//            offsetRight; a node with offsetRight 0 is a leaf, and its ledge is one convex hull
//   ledge    IVP_Compact_Ledge, 16 bytes: { int pointOffset, int clientData, uint flags, short triangles,
//            short spare }, then its triangles of 16 bytes: { uint index bits } and three edges
//            { uint startPoint:16, opposite:15, virtual:1 }; points at ledge + pointOffset, 16 bytes each
//            (x, y, z, spare) in metres
// IVP's axes are not the engine's: a point (x, y, z) in a .phy is (x, z, -y) / 0.0254 in a model's units.
// Only modelType 0 (polygons) is read; MOPP (1) is refused. Nothing of a file is written anywhere.
//
//   readPhy(buffer)   { solids: [{ hulls: [{ planes: Float64Array(n*4), points: Float64Array, min, max }] }],
//                       min, max }   planes as (nx, ny, nz, d), outward, a point inside when n.p < d
const INCH = 0.0254;

/** The convex hulls of a ledge tree, leaves only (a node with children holds their hull, not a part). */
function hullsOf(b, surface, end) {
  const root = surface + b.readInt32LE(surface + 32);
  const hulls = [];
  const stack = [root];
  let guard = 0;
  while (stack.length) {
    const node = stack.pop();
    if (node < surface || node + 28 > end || ++guard > 100000) throw new Error("phy: a ledge tree out of its solid");
    const right = b.readInt32LE(node);
    if (right !== 0) {
      stack.push(node + right, node + 28);
      continue;
    }
    const ledge = node + b.readInt32LE(node + 4);
    if (ledge < surface || ledge + 16 > end) throw new Error("phy: a ledge out of its solid");
    hulls.push(hullOf(b, ledge, end));
  }
  return hulls;
}

/** One convex hull: its points in the model's units and its planes, faced outward. */
function hullOf(b, ledge, end) {
  const pointsAt = ledge + b.readInt32LE(ledge);
  const count = b.readInt16LE(ledge + 12);
  const tris = [];
  let most = -1;
  for (let t = 0; t < count; t++) {
    const at = ledge + 16 + t * 16;
    if (at + 16 > end) throw new Error("phy: triangles out of their solid");
    const corner = [0, 1, 2].map((k) => b.readUInt32LE(at + 4 + k * 4) & 0xffff);
    tris.push(corner);
    most = Math.max(most, ...corner);
  }
  if (pointsAt < 0 || pointsAt + (most + 1) * 16 > end) throw new Error("phy: points out of their solid");
  const points = new Float64Array((most + 1) * 3);
  for (let n = 0; n <= most; n++) {
    const x = b.readFloatLE(pointsAt + n * 16);
    const y = b.readFloatLE(pointsAt + n * 16 + 4);
    const z = b.readFloatLE(pointsAt + n * 16 + 8);
    points[n * 3] = x / INCH;
    points[n * 3 + 1] = z / INCH;
    points[n * 3 + 2] = -y / INCH;
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const used = new Set(tris.flat());
  const middle = [0, 0, 0];
  for (const n of used)
    for (let k = 0; k < 3; k++) {
      const v = points[n * 3 + k];
      middle[k] += v / used.size;
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  const planes = [];
  for (const [a, c, d] of tris) {
    const p = (n) => [points[n * 3], points[n * 3 + 1], points[n * 3 + 2]];
    const [p0, p1, p2] = [p(a), p(c), p(d)];
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const length = Math.hypot(...n);
    if (length < 1e-9) continue;
    n = n.map((v) => v / length);
    let dist = n[0] * p0[0] + n[1] * p0[1] + n[2] * p0[2];
    // outward: the hull's middle behind the plane, whatever the triangle's winding
    if (n[0] * middle[0] + n[1] * middle[1] + n[2] * middle[2] > dist) (n = n.map((v) => -v)), (dist = -dist);
    // a plane already had (two triangles of one face) is kept once
    if (planes.some((q) => Math.abs(q[0] - n[0]) < 1e-5 && Math.abs(q[1] - n[1]) < 1e-5 && Math.abs(q[2] - n[2]) < 1e-5 && Math.abs(q[3] - dist) < 1e-3)) continue; // prettier-ignore
    planes.push([n[0], n[1], n[2], dist]);
  }
  return { planes: Float64Array.from(planes.flat()), points, min, max };
}

export function readPhy(b) {
  if (b.length < 16) throw new Error("phy: shorter than its header");
  const headerSize = b.readInt32LE(0);
  const solidCount = b.readInt32LE(8);
  if (headerSize < 16 || solidCount < 0 || solidCount > 1024) throw new Error("phy: not a collision file");
  let o = headerSize;
  const solids = [];
  for (let s = 0; s < solidCount; s++) {
    if (o + 4 > b.length) throw new Error("phy: cut short");
    const size = b.readInt32LE(o);
    const end = o + 4 + size;
    if (size <= 0 || end > b.length) throw new Error("phy: a solid out of the file");
    let surface = o + 4;
    if (b.toString("latin1", surface, surface + 4) === "VPHY") {
      const modelType = b.readInt16LE(surface + 6);
      if (modelType !== 0) throw new Error(`phy: model type ${modelType} (only polygons, 0, are read)`);
      surface += 28;
    }
    solids.push({ hulls: hullsOf(b, surface, end) });
    o = end;
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const solid of solids)
    for (const hull of solid.hulls)
      for (let k = 0; k < 3; k++) (min[k] = Math.min(min[k], hull.min[k])), (max[k] = Math.max(max[k], hull.max[k]));
  return { solids, min, max };
}

// ── written: a .phy of convex hulls, for the tests (no game file is needed to check the reader) ──
/** A `.phy` of one solid per list of hulls, each hull `{ points: [[x, y, z]...] (model units), triangles:
 *  [[a, b, c]...] }`; `vphy` false writes the older layout. The ledge tree is a chain of leaves. */
export function writePhy(solids, { vphy = true } = {}) {
  const parts = [];
  const header = Buffer.alloc(16);
  header.writeInt32LE(16, 0);
  header.writeInt32LE(solids.length, 8);
  parts.push(header);
  for (const hulls of solids) {
    // ledges first, each with its points after its triangles, then the tree
    const ledges = hulls.map(({ points, triangles }) => {
      const b = Buffer.alloc(16 + triangles.length * 16 + points.length * 16);
      b.writeInt32LE(16 + triangles.length * 16, 0);
      b.writeInt16LE(triangles.length, 12);
      triangles.forEach((tri, t) => tri.forEach((n, k) => b.writeUInt32LE(n & 0xffff, 16 + t * 16 + 4 + k * 4)));
      points.forEach(([x, y, z], n) => {
        const at = 16 + triangles.length * 16 + n * 16;
        b.writeFloatLE(x * INCH, at);
        b.writeFloatLE(-z * INCH, at + 4);
        b.writeFloatLE(y * INCH, at + 8);
      });
      return b;
    });
    const ledgeBytes = ledges.reduce((sum, l) => sum + l.length, 0);
    // tree: for hulls h0..hn-1, internal node k has left = leaf k (next node) and right = node k+1's chain
    const nodes = [];
    const chain = (k) => {
      if (k === hulls.length - 1) return [{ leaf: k }];
      const left = [{ leaf: k }];
      return [{ inner: true, left, rightAt: 1 + left.length }, ...left, ...chain(k + 1)];
    };
    nodes.push(...chain(0));
    const surface = Buffer.alloc(48);
    const treeAt = 48 + ledgeBytes;
    surface.writeInt32LE(treeAt, 32);
    surface.write("IVPS", 40, "latin1");
    const tree = Buffer.alloc(nodes.length * 28);
    const ledgeAt = [];
    let at = 48;
    for (const l of ledges) ledgeAt.push(at), (at += l.length);
    nodes.forEach((node, n) => {
      const here = treeAt + n * 28;
      if (node.inner) tree.writeInt32LE(node.rightAt * 28, n * 28);
      else tree.writeInt32LE(ledgeAt[node.leaf] - here, n * 28 + 4);
    });
    const body = Buffer.concat([surface, ...ledges, tree]);
    const pre = Buffer.alloc(vphy ? 32 : 4);
    if (vphy) {
      pre.write("VPHY", 4, "latin1");
      pre.writeInt16LE(0x100, 8);
      pre.writeInt32LE(body.length, 12);
    }
    pre.writeInt32LE(pre.length - 4 + body.length, 0);
    parts.push(pre, body);
  }
  return Buffer.concat(parts);
}
