// A Source engine map (`.bsp`, VBSP version 19 to 21), read only as far as a survey needs to ask what is
// solid: the planes, the node tree, the leaves with the brushes in them, the brushes and their sides, the
// models (the world and the brush entities), the displacements (Source's terrain, which is not brushes), the
// texture flags and the entities. Written from the Source SDK 2013's bspfile.h; the lump header in Left 4
// Dead 2's maps puts the version first ({ version, offset, length, fourCC }), the other games' last, and
// which it is is told from the numbers. Nothing of a map is written anywhere by this module.
//
// LZMA: a lump whose fourCC (its uncompressed size) is not 0 is compressed ("LZMA" at its head). This kit has
// no LZMA decoder and takes no dependency, so such a map is refused with that said (`readSourceBsp` throws
// "compressed"). None of Left 4 Dead 2's own maps is.
//
// LUMP FILES: `map_l_N.lmp` beside a map replaces one of its lumps (the game's updates ship entity fixes so);
// `withLumpFiles` applies them, by the lump number each one names in its header.
//
//   readSourceBsp(buffer, { lumpFiles })   the map: see `readSourceBsp`
//   solidOf(bsp, { models })               the questions: firstStop(from, to), up(from, most)
//   parseEntities(text)                    [{ key: value }] in the file's order
import fs from "node:fs";

// ── the lumps used ──────────────────────────────────────────────────────────
export const LUMP = {
  ENTITIES: 0, PLANES: 1, VERTEXES: 3, NODES: 5, TEXINFO: 6, FACES: 7, LEAFS: 10, EDGES: 12, SURFEDGES: 13,
  MODELS: 14, LEAFBRUSHES: 17, BRUSHES: 18, BRUSHSIDES: 19, DISPINFO: 26, DISP_VERTS: 33,
};
/** Brush contents (bspflags.h). */
export const CONTENTS = {
  SOLID: 0x1, WINDOW: 0x2, AUX: 0x4, GRATE: 0x8, SLIME: 0x10, WATER: 0x20, BLOCKLOS: 0x40, OPAQUE: 0x80,
  MOVEABLE: 0x4000, PLAYERCLIP: 0x10000, MONSTERCLIP: 0x20000, DETAIL: 0x8000000,
};
/** Texture flags (bspflags.h). */
export const SURF = { LIGHT: 0x1, SKY2D: 0x2, SKY: 0x4, WARP: 0x8, TRANS: 0x10, NODRAW: 0x80, HINT: 0x100, SKIP: 0x200 };

const HEADER_LUMPS = 64;

/** The lump directory, in whichever of the two orders the numbers say. */
function lumpsOf(b) {
  const ident = b.toString("latin1", 0, 4);
  if (ident !== "VBSP") throw new Error(`source bsp: not a Source map (begins "${ident}")`);
  const version = b.readInt32LE(4);
  if (version < 19 || version > 21) throw new Error(`source bsp: version ${version}; 19 to 21 are read`);
  const read = (versionFirst) => {
    const lumps = [];
    for (let nth = 0; nth < HEADER_LUMPS; nth++) {
      const at = 8 + nth * 16;
      const a = b.readInt32LE(at);
      const c = b.readInt32LE(at + 4);
      const d = b.readInt32LE(at + 8);
      lumps.push(
        versionFirst
          ? { version: a, offset: c, length: d, fourCC: b.readInt32LE(at + 12) }
          : { offset: a, length: c, version: d, fourCC: b.readInt32LE(at + 12) },
      );
    }
    return lumps;
  };
  const fits = (lumps) =>
    lumps.every((lump) => lump.length === 0 || (lump.offset >= 8 + HEADER_LUMPS * 16 && lump.offset + lump.length <= b.length && lump.length > 0));
  const plain = read(false);
  const versionFirst = read(true);
  // Left 4 Dead 2 writes version 21 with the version first; tell by which reading fits the file
  const lumps = fits(versionFirst) && !fits(plain) ? versionFirst : fits(plain) ? plain : versionFirst;
  return { version, lumps, revision: b.readInt32LE(8 + HEADER_LUMPS * 16) };
}

/** The lumps a map's lump files (`_l_N.lmp`) replace: `[{ id, version, data }]`. */
export function readLumpFiles(paths) {
  return paths.map((path) => {
    const b = fs.readFileSync(path);
    const offset = b.readInt32LE(0);
    const id = b.readInt32LE(4);
    const version = b.readInt32LE(8);
    const length = b.readInt32LE(12);
    return { id, version, data: b.subarray(offset, offset + length), path };
  });
}

/**
 * The map in a buffer: { version, revision, planes, nodes, leafs, leafBrushes, brushes, sides, texinfo,
 * models, displacements: [{ points: Float32Array, size, contents }], entities, compressed: [lump numbers] }.
 * `lumpFiles`: what `readLumpFiles` gave, applied over the map's own lumps.
 */
export function readSourceBsp(b, { lumpFiles = [] } = {}) {
  const { version, lumps, revision } = lumpsOf(b);
  const patched = new Map(lumpFiles.map((file) => [file.id, file]));
  const dataOf = (id) => {
    if (patched.has(id)) return patched.get(id).data;
    const lump = lumps[id];
    if (lump.fourCC !== 0 || (lump.length >= 4 && b.toString("latin1", lump.offset, lump.offset + 4) === "LZMA"))
      throw new Error(`source bsp: lump ${id} is LZMA-compressed; this kit has no LZMA decoder (compressed)`);
    return b.subarray(lump.offset, lump.offset + lump.length);
  };
  const versionOf = (id) => (patched.has(id) ? patched.get(id).version : lumps[id].version);

  const planesData = dataOf(LUMP.PLANES);
  const planeCount = planesData.length / 20;
  const planes = new Float32Array(planeCount * 4);
  const planeType = new Int32Array(planeCount);
  for (let i = 0; i < planeCount; i++) {
    for (let k = 0; k < 4; k++) planes[i * 4 + k] = planesData.readFloatLE(i * 20 + k * 4);
    planeType[i] = planesData.readInt32LE(i * 20 + 16);
  }

  const nodesData = dataOf(LUMP.NODES);
  const nodeCount = nodesData.length / 32;
  const nodes = new Int32Array(nodeCount * 3); // plane, front, back
  for (let i = 0; i < nodeCount; i++) {
    nodes[i * 3] = nodesData.readInt32LE(i * 32);
    nodes[i * 3 + 1] = nodesData.readInt32LE(i * 32 + 4);
    nodes[i * 3 + 2] = nodesData.readInt32LE(i * 32 + 8);
  }

  const leafsData = dataOf(LUMP.LEAFS);
  const leafSize = versionOf(LUMP.LEAFS) === 0 ? 56 : 32;
  const leafCount = Math.floor(leafsData.length / leafSize);
  const leafs = new Int32Array(leafCount * 3); // contents, first leaf brush, leaf brush count
  for (let i = 0; i < leafCount; i++) {
    leafs[i * 3] = leafsData.readInt32LE(i * leafSize);
    leafs[i * 3 + 1] = leafsData.readUInt16LE(i * leafSize + 24);
    leafs[i * 3 + 2] = leafsData.readUInt16LE(i * leafSize + 26);
  }

  const lbData = dataOf(LUMP.LEAFBRUSHES);
  const leafBrushes = new Uint16Array(lbData.length / 2);
  for (let i = 0; i < leafBrushes.length; i++) leafBrushes[i] = lbData.readUInt16LE(i * 2);

  const texData = dataOf(LUMP.TEXINFO);
  const texinfo = new Int32Array(texData.length / 72);
  for (let i = 0; i < texinfo.length; i++) texinfo[i] = texData.readInt32LE(i * 72 + 64);

  const brushData = dataOf(LUMP.BRUSHES);
  const brushCount = brushData.length / 12;
  const brushes = new Int32Array(brushCount * 3); // first side, side count, contents
  for (let i = 0; i < brushCount * 3; i++) brushes[i] = brushData.readInt32LE(i * 4);
  const sideData = dataOf(LUMP.BRUSHSIDES);
  const sideCount = sideData.length / 8;
  const sidePlane = new Uint16Array(sideCount);
  const sideTex = new Int16Array(sideCount);
  for (let i = 0; i < sideCount; i++) {
    sidePlane[i] = sideData.readUInt16LE(i * 8);
    sideTex[i] = sideData.readInt16LE(i * 8 + 2);
  }
  // a brush of the sky: one with a side that wears the sky
  const brushSky = new Uint8Array(brushCount);
  for (let i = 0; i < brushCount; i++)
    for (let s = brushes[i * 3]; s < brushes[i * 3] + brushes[i * 3 + 1]; s++) {
      const tex = sideTex[s];
      if (tex >= 0 && tex < texinfo.length && texinfo[tex] & (SURF.SKY | SURF.SKY2D)) brushSky[i] = 1;
    }

  const modelData = dataOf(LUMP.MODELS);
  const models = [];
  for (let i = 0; i < modelData.length / 48; i++) {
    const f = (k) => modelData.readFloatLE(i * 48 + k * 4);
    models.push({ min: [f(0), f(1), f(2)], max: [f(3), f(4), f(5)], origin: [f(6), f(7), f(8)], head: modelData.readInt32LE(i * 48 + 36) });
  }

  // ── displacements: the terrain, as a grid of points each ──
  const displacements = [];
  const dispData = dataOf(LUMP.DISPINFO);
  if (dispData.length) {
    const vData = dataOf(LUMP.VERTEXES);
    const eData = dataOf(LUMP.EDGES);
    const seData = dataOf(LUMP.SURFEDGES);
    const fData = dataOf(LUMP.FACES);
    const dvData = dataOf(LUMP.DISP_VERTS);
    const vertex = (n) => [vData.readFloatLE(n * 12), vData.readFloatLE(n * 12 + 4), vData.readFloatLE(n * 12 + 8)];
    for (let i = 0; i < dispData.length / 176; i++) {
      const at = i * 176;
      const start = [dispData.readFloatLE(at), dispData.readFloatLE(at + 4), dispData.readFloatLE(at + 8)];
      const firstVert = dispData.readInt32LE(at + 12);
      const power = dispData.readInt32LE(at + 20);
      const contents = dispData.readInt32LE(at + 32);
      const face = dispData.readUInt16LE(at + 36);
      const fa = face * 56;
      const firstEdge = fData.readInt32LE(fa + 4);
      const edgeCount = fData.readInt16LE(fa + 8);
      if (edgeCount !== 4) continue;
      const corners = [];
      for (let e = 0; e < 4; e++) {
        const se = seData.readInt32LE((firstEdge + e) * 4);
        const edge = Math.abs(se);
        corners.push(vertex(eData.readUInt16LE(edge * 4 + (se < 0 ? 2 : 0))));
      }
      // the corner the displacement begins at is the one nearest its start position
      let first = 0;
      let nearest = Infinity;
      corners.forEach((c, k) => {
        const d = (c[0] - start[0]) ** 2 + (c[1] - start[1]) ** 2 + (c[2] - start[2]) ** 2;
        if (d < nearest) (nearest = d), (first = k);
      });
      const c = [0, 1, 2, 3].map((k) => corners[(first + k) % 4]);
      const size = (1 << power) + 1;
      const points = new Float32Array(size * size * 3);
      for (let row = 0; row < size; row++) {
        const ty = row / (size - 1);
        const left = [0, 1, 2].map((k) => c[0][k] + (c[1][k] - c[0][k]) * ty);
        const right = [0, 1, 2].map((k) => c[3][k] + (c[2][k] - c[3][k]) * ty);
        for (let col = 0; col < size; col++) {
          const tx = col / (size - 1);
          const n = row * size + col;
          const dv = (firstVert + n) * 20;
          const dist = dvData.readFloatLE(dv + 12);
          for (let k = 0; k < 3; k++)
            points[n * 3 + k] = left[k] + (right[k] - left[k]) * tx + dvData.readFloatLE(dv + k * 4) * dist;
        }
      }
      displacements.push({ points, size, contents });
    }
  }

  const entities = parseEntities(dataOf(LUMP.ENTITIES).toString("latin1"));
  return {
    version, revision, planes, planeType, nodes, leafs, leafBrushes, brushes, sidePlane, brushSky, texinfo,
    models, displacements, entities,
  };
}

/**
 * The static props (the game lump's `sprp`): `[{ model, origin, angles, solid }]`, `solid` the engine's
 * (0 none, 2 its box, 6 its physics mesh). The record's size is told from the lump's own length.
 */
export function readStaticProps(b) {
  const { lumps } = lumpsOf(b);
  const lump = lumps[35];
  if (!lump.length) return [];
  let o = lump.offset;
  const count = b.readInt32LE(o);
  o += 4;
  for (let nth = 0; nth < count; nth++) {
    const id = b.toString("latin1", o, o + 4);
    const offset = b.readInt32LE(o + 8);
    const length = b.readInt32LE(o + 12);
    o += 16;
    if (id !== "prps") continue; // "sprp" as a little-endian int
    let p = offset;
    const names = [];
    const dict = b.readInt32LE(p);
    p += 4;
    for (let k = 0; k < dict; k++, p += 128) names.push(b.toString("latin1", p, p + 128).replace(/\0[\s\S]*$/, ""));
    const leaves = b.readInt32LE(p);
    p += 4 + leaves * 2;
    const props = b.readInt32LE(p);
    p += 4;
    if (!props) return [];
    const size = Math.floor((offset + length - p) / props);
    const list = [];
    for (let k = 0; k < props; k++, p += size) {
      const f = (at) => b.readFloatLE(p + at);
      list.push({
        model: names[b.readUInt16LE(p + 24)],
        origin: [f(0), f(4), f(8)],
        angles: [f(12), f(16), f(20)],
        solid: b[p + 30],
      });
    }
    return list;
  }
  return [];
}

/** The entity lump's text as a list of `{ key: value }`; a key given twice keeps every value in `__all`. */
export function parseEntities(text) {
  const list = [];
  let current = null;
  const pattern = /"([^"]*)"\s+"([^"]*)"|(\{)|(\})/g;
  let match;
  while ((match = pattern.exec(text))) {
    if (match[3]) current = { __all: [] };
    else if (match[4]) {
      if (current) list.push(current);
      current = null;
    } else if (current) {
      const [key, value] = [match[1], match[2]];
      current.__all.push([key, value]);
      if (!(key in current)) current[key] = value;
    }
  }
  return list;
}

// ── the questions: where a line first meets something solid ─────────────────

/** Source's AngleMatrix: an object's own axes (forward, left, up) in the world, from its pitch, yaw, roll. */
export function axesOf(angles) {
  const [pitch, yaw, roll] = angles.map((a) => (a * Math.PI) / 180);
  const [sp, cp, sy, cy, sr, cr] = [Math.sin(pitch), Math.cos(pitch), Math.sin(yaw), Math.cos(yaw), Math.sin(roll), Math.cos(roll)];
  const forward = [cp * cy, cp * sy, -sp];
  const left = [sr * sp * cy - cr * sy, sr * sp * sy + cr * cy, sr * cp];
  const up = [cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp];
  return [forward, left, up];
}

/** The buckets (BUCKET square, seen from above) a line passes over, in order: `visit(i, j, entered)` for
 *  each, `entered` the fraction of the line at which it came in, until `visit` says false or the line ends. */
function gridWalk(start, end, visit) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  let i = Math.floor(start[0] / BUCKET);
  let j = Math.floor(start[1] / BUCKET);
  const iEnd = Math.floor(end[0] / BUCKET);
  const jEnd = Math.floor(end[1] / BUCKET);
  const si = dx > 0 ? 1 : -1;
  const sj = dy > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(BUCKET / dx) : Infinity;
  const tdy = dy !== 0 ? Math.abs(BUCKET / dy) : Infinity;
  let tx = dx !== 0 ? ((dx > 0 ? (i + 1) * BUCKET : i * BUCKET) - start[0]) / dx : Infinity;
  let ty = dy !== 0 ? ((dy > 0 ? (j + 1) * BUCKET : j * BUCKET) - start[1]) / dy : Infinity;
  let entered = 0;
  for (let guard = 0; guard < 10000; guard++) {
    if (!visit(i, j, entered)) return;
    if (i === iEnd && j === jEnd) return;
    if (tx < ty) {
      entered = tx;
      tx += tdx;
      i += si;
    } else {
      entered = ty;
      ty += tdy;
      j += sj;
    }
    if (entered > 1) return;
  }
}

const SOLID_MASK = CONTENTS.SOLID | CONTENTS.WINDOW;
const BUCKET = 256;
const EPSILON = 1 / 32;

/**
 * Questions of what is solid in a map: brushes that are solid or a window (not clip, not water, not a grate)
 * in the world and in the brush entities `models` names (`[{ model, origin }]`), and the displacements;
 * and `boxes` (`[{ origin, angles, min, max }]`: static props as their models' boxes, when asked), and
 * `hulls` (`[{ origin, angles, hulls: [{ planes, min, max }] }]`: static props as their collision's convex
 * hulls, from `readPhy`, in the model's own axes; `planes` (nx, ny, nz, d) outward).
 *
 *   firstStop(from, to)  the distance along the line to the first solid, or null when it reaches `to`
 *   upward(from, most)   { distance, sky }: how far straight up to the first solid (Infinity when none within
 *                        `most`), and whether what it meets is a brush of the sky
 * A brush the line begins inside is not one it meets (a point on a floor, a hair inside a step).
 */
export function solidOf(bsp, { models = [], boxes = [], hulls = [], mask = SOLID_MASK, displacements = true } = {}) {
  const { planes, planeType, nodes, leafs, leafBrushes, brushes, sidePlane, brushSky } = bsp;
  const brushCount = brushes.length / 3;
  const stamp = new Uint32Array(brushCount);
  let tick = 0;
  const trees = [{ head: bsp.models[0].head, origin: [0, 0, 0], min: null, max: null }];
  for (const { model, origin = [0, 0, 0] } of models) {
    const m = bsp.models[model];
    if (!m) continue;
    trees.push({
      head: m.head,
      origin,
      min: m.min.map((v, k) => v + origin[k] - 1),
      max: m.max.map((v, k) => v + origin[k] + 1),
    });
  }

  // displacement triangles, in buckets seen from above
  const tris = [];
  for (const disp of bsp.displacements) {
    if (!displacements) break;
    if (!(disp.contents & SOLID_MASK) && disp.contents !== 0) continue;
    const { points, size } = disp;
    for (let row = 0; row + 1 < size; row++)
      for (let col = 0; col + 1 < size; col++) {
        const a = row * size + col;
        const b = a + 1;
        const c = a + size;
        const d = c + 1;
        tris.push([a, b, d].map((n) => [points[n * 3], points[n * 3 + 1], points[n * 3 + 2]]));
        tris.push([a, d, c].map((n) => [points[n * 3], points[n * 3 + 1], points[n * 3 + 2]]));
      }
  }
  const buckets = new Map();
  tris.forEach((tri, n) => {
    const lo = [Math.min(tri[0][0], tri[1][0], tri[2][0]), Math.min(tri[0][1], tri[1][1], tri[2][1])];
    const hi = [Math.max(tri[0][0], tri[1][0], tri[2][0]), Math.max(tri[0][1], tri[1][1], tri[2][1])];
    for (let i = Math.floor(lo[0] / BUCKET); i <= Math.floor(hi[0] / BUCKET); i++)
      for (let j = Math.floor(lo[1] / BUCKET); j <= Math.floor(hi[1] / BUCKET); j++) {
        const key = i * 100003 + j;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(n);
      }
  });
  const triStamp = new Uint32Array(tris.length);

  let best;
  let bestSky;
  let start;
  let end;

  /** The fraction of the line at which it enters a brush, or 2 when it does not (or begins inside). */
  const brushHit = (brush, offset) => {
    const first = brushes[brush * 3];
    const count = brushes[brush * 3 + 1];
    let enter = -Infinity;
    let leave = Infinity;
    for (let s = first; s < first + count; s++) {
      const p = sidePlane[s] * 4;
      const dist = planes[p + 3] + planes[p] * offset[0] + planes[p + 1] * offset[1] + planes[p + 2] * offset[2];
      const d1 = planes[p] * start[0] + planes[p + 1] * start[1] + planes[p + 2] * start[2] - dist;
      const d2 = planes[p] * end[0] + planes[p + 1] * end[1] + planes[p + 2] * end[2] - dist;
      if (d1 > 0 && d2 > 0) return 2;
      if (d1 <= 0 && d2 <= 0) continue;
      const f = d1 / (d1 - d2);
      if (d1 > d2) {
        if (f > enter) enter = f;
      } else if (f < leave) leave = f;
      if (enter > leave) return 2;
    }
    if (enter === -Infinity) return 2; // the line begins inside
    return enter <= leave ? enter : 2;
  };

  const leafTest = (leaf, offset) => {
    const firstBrush = leafs[leaf * 3 + 1];
    const count = leafs[leaf * 3 + 2];
    for (let k = firstBrush; k < firstBrush + count; k++) {
      const brush = leafBrushes[k];
      if (stamp[brush] === tick) continue;
      stamp[brush] = tick;
      if (!(brushes[brush * 3 + 2] & mask)) continue;
      const f = brushHit(brush, offset);
      if (f < best) {
        best = f;
        bestSky = brushSky[brush] === 1;
      }
    }
  };

  const walk = (node, f0, f1, offset) => {
    for (;;) {
      if (best <= f0) return;
      if (node < 0) return leafTest(-1 - node, offset);
      const p = nodes[node * 3] * 4;
      const nx = planes[p];
      const ny = planes[p + 1];
      const nz = planes[p + 2];
      const dist = planes[p + 3] + nx * offset[0] + ny * offset[1] + nz * offset[2];
      // the plane's distance is linear along the line: at fractions f0 and f1
      const ds = nx * start[0] + ny * start[1] + nz * start[2] - dist;
      const de = nx * end[0] + ny * end[1] + nz * end[2] - dist;
      const d0 = ds + (de - ds) * f0;
      const d1 = ds + (de - ds) * f1;
      if (d0 >= EPSILON && d1 >= EPSILON) {
        node = nodes[node * 3 + 1];
        continue;
      }
      if (d0 < -EPSILON && d1 < -EPSILON) {
        node = nodes[node * 3 + 2];
        continue;
      }
      // the line crosses the plane (or runs along it): the near side first, then the far side
      const nearFront = d0 >= d1 ? d0 >= 0 : d0 > 0;
      let fm = d0 === d1 ? f1 : f0 + ((f1 - f0) * d0) / (d0 - d1);
      fm = Math.min(f1, Math.max(f0, fm));
      const near = nodes[node * 3 + (nearFront ? 1 : 2)];
      const far = nodes[node * 3 + (nearFront ? 2 : 1)];
      if (d0 === d1) {
        walk(near, f0, f1, offset);
        node = far;
        continue;
      }
      walk(near, f0, Math.min(f1, fm + 0.001), offset);
      f0 = Math.max(f0, fm - 0.001);
      node = far;
    }
  };

  const triHit = (tri) => {
    // Moller-Trumbore, both faces
    const [p0, p1, p2] = tri;
    const dir = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const h = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]];
    const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
    if (Math.abs(det) < 1e-9) return 2;
    const inv = 1 / det;
    const s = [start[0] - p0[0], start[1] - p0[1], start[2] - p0[2]];
    const u = inv * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
    if (u < 0 || u > 1) return 2;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = inv * (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]);
    if (v < 0 || u + v > 1) return 2;
    const t = inv * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]);
    return t > 1e-4 ? t : 2;
  };

  const trianglesOn = () => {
    if (!tris.length) return;
    // the buckets the line passes over, in order (a grid walk), until past the nearest hit
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    let i = Math.floor(start[0] / BUCKET);
    let j = Math.floor(start[1] / BUCKET);
    const iEnd = Math.floor(end[0] / BUCKET);
    const jEnd = Math.floor(end[1] / BUCKET);
    const si = dx > 0 ? 1 : -1;
    const sj = dy > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(BUCKET / dx) : Infinity;
    const tdy = dy !== 0 ? Math.abs(BUCKET / dy) : Infinity;
    let tx = dx !== 0 ? ((dx > 0 ? (i + 1) * BUCKET : i * BUCKET) - start[0]) / dx : Infinity;
    let ty = dy !== 0 ? ((dy > 0 ? (j + 1) * BUCKET : j * BUCKET) - start[1]) / dy : Infinity;
    let entered = 0;
    for (let guard = 0; guard < 10000; guard++) {
      if (best < entered) return;
      for (const n of buckets.get(i * 100003 + j) ?? []) {
        if (triStamp[n] === tick) continue;
        triStamp[n] = tick;
        const f = triHit(tris[n]);
        if (f < best) {
          best = f;
          bestSky = false;
        }
      }
      if (i === iEnd && j === jEnd) return;
      if (tx < ty) {
        entered = tx;
        tx += tdx;
        i += si;
      } else {
        entered = ty;
        ty += tdy;
        j += sj;
      }
      if (entered > 1) return;
    }
  };

  // boxes (static props, as their models' boxes), turned by their angles: in buckets as the triangles
  const boxList = boxes.map(({ origin, angles = [0, 0, 0], min, max }) => {
    const axes = axesOf(angles);
    let reach = 0;
    for (let k = 0; k < 3; k++) reach = Math.max(reach, Math.abs(min[k]), Math.abs(max[k]));
    return { origin, axes, min, max, reach: reach * Math.sqrt(3) };
  });
  const boxBuckets = new Map();
  boxList.forEach((box, n) => {
    for (let i = Math.floor((box.origin[0] - box.reach) / BUCKET); i <= Math.floor((box.origin[0] + box.reach) / BUCKET); i++)
      for (let j = Math.floor((box.origin[1] - box.reach) / BUCKET); j <= Math.floor((box.origin[1] + box.reach) / BUCKET); j++) {
        const key = i * 100003 + j;
        if (!boxBuckets.has(key)) boxBuckets.set(key, []);
        boxBuckets.get(key).push(n);
      }
  });
  const boxStamp = new Uint32Array(boxList.length);
  const boxHit = (box) => {
    let enter = -Infinity;
    let leave = Infinity;
    const rel = [start[0] - box.origin[0], start[1] - box.origin[1], start[2] - box.origin[2]];
    const dir = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
    for (let k = 0; k < 3; k++) {
      const a = box.axes[k];
      const s = rel[0] * a[0] + rel[1] * a[1] + rel[2] * a[2];
      const d = dir[0] * a[0] + dir[1] * a[1] + dir[2] * a[2];
      if (Math.abs(d) < 1e-9) {
        if (s < box.min[k] || s > box.max[k]) return 2;
        continue;
      }
      let t1 = (box.min[k] - s) / d;
      let t2 = (box.max[k] - s) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > enter) enter = t1;
      if (t2 < leave) leave = t2;
      if (enter > leave) return 2;
    }
    return enter > 0 && enter <= leave ? enter : 2; // a line that begins inside does not meet it
  };
  const boxesOn = () => {
    if (!boxList.length) return;
    const lo = [Math.min(start[0], end[0]), Math.min(start[1], end[1])];
    const hi = [Math.max(start[0], end[0]), Math.max(start[1], end[1])];
    for (let i = Math.floor(lo[0] / BUCKET); i <= Math.floor(hi[0] / BUCKET); i++)
      for (let j = Math.floor(lo[1] / BUCKET); j <= Math.floor(hi[1] / BUCKET); j++)
        for (const n of boxBuckets.get(i * 100003 + j) ?? []) {
          if (boxStamp[n] === tick) continue;
          boxStamp[n] = tick;
          const f = boxHit(boxList[n]);
          if (f < best) {
            best = f;
            bestSky = false;
          }
        }
  };

  // props as their convex hulls: the line taken into the prop's own axes, tried against its box, each
  // hull's box, then the hull's planes (as a brush's sides)
  const hullList = hulls.map(({ origin, angles = [0, 0, 0], hulls: parts }) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const part of parts) for (let k = 0; k < 3; k++) (min[k] = Math.min(min[k], part.min[k])), (max[k] = Math.max(max[k], part.max[k]));
    let reach = 0;
    for (let k = 0; k < 3; k++) reach = Math.max(reach, Math.abs(min[k]), Math.abs(max[k]));
    return { origin, axes: axesOf(angles), parts, min, max, reach: reach * Math.sqrt(3) };
  });
  const hullBuckets = new Map();
  hullList.forEach((prop, n) => {
    if (!prop.parts.length) return;
    for (let i = Math.floor((prop.origin[0] - prop.reach) / BUCKET); i <= Math.floor((prop.origin[0] + prop.reach) / BUCKET); i++)
      for (let j = Math.floor((prop.origin[1] - prop.reach) / BUCKET); j <= Math.floor((prop.origin[1] + prop.reach) / BUCKET); j++) {
        const key = i * 100003 + j;
        if (!hullBuckets.has(key)) hullBuckets.set(key, []);
        hullBuckets.get(key).push(n);
      }
  });
  const hullStamp = new Uint32Array(hullList.length);
  /** The fraction at which a line (s + t d, in a prop's axes) comes into a box (0 when it begins inside), or 2. */
  const slab = (s, d, min, max) => {
    let enter = -Infinity;
    let leave = Infinity;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-12) {
        if (s[k] < min[k] || s[k] > max[k]) return 2;
        continue;
      }
      let t1 = (min[k] - s[k]) / d[k];
      let t2 = (max[k] - s[k]) / d[k];
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > enter) enter = t1;
      if (t2 < leave) leave = t2;
      if (enter > leave || leave < 0 || enter > 1) return 2;
    }
    return Math.max(enter, 0);
  };
  const hullHit = (prop) => {
    const rel = [start[0] - prop.origin[0], start[1] - prop.origin[1], start[2] - prop.origin[2]];
    const dir = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
    const ax = prop.axes;
    const s = [0, 1, 2].map((k) => rel[0] * ax[k][0] + rel[1] * ax[k][1] + rel[2] * ax[k][2]);
    const d = [0, 1, 2].map((k) => dir[0] * ax[k][0] + dir[1] * ax[k][1] + dir[2] * ax[k][2]);
    if (slab(s, d, prop.min, prop.max) >= best) return 2;
    let found = 2;
    for (const part of prop.parts) {
      if (slab(s, d, part.min, part.max) >= Math.min(best, found)) continue;
      const planes = part.planes;
      let enter = -Infinity;
      let leave = Infinity;
      let missed = false;
      for (let p = 0; p < planes.length; p += 4) {
        const d1 = planes[p] * s[0] + planes[p + 1] * s[1] + planes[p + 2] * s[2] - planes[p + 3];
        const d2 = d1 + planes[p] * d[0] + planes[p + 1] * d[1] + planes[p + 2] * d[2];
        if (d1 > 0 && d2 > 0) {
          missed = true;
          break;
        }
        if (d1 <= 0 && d2 <= 0) continue;
        const f = d1 / (d1 - d2);
        if (d1 > d2) {
          if (f > enter) enter = f;
        } else if (f < leave) leave = f;
        if (enter > leave) {
          missed = true;
          break;
        }
      }
      // a line that begins inside a hull does not meet it (as a brush)
      if (missed || enter === -Infinity || enter > leave) continue;
      if (enter < found) found = enter;
    }
    return found;
  };
  const hullsOn = () => {
    if (!hullList.length) return;
    const visit = (i, j) => {
      for (const n of hullBuckets.get(i * 100003 + j) ?? []) {
        if (hullStamp[n] === tick) continue;
        hullStamp[n] = tick;
        const f = hullHit(hullList[n]);
        if (f < best) {
          best = f;
          bestSky = false;
        }
      }
    };
    // the buckets along the line, nearest first, until past the nearest hit
    gridWalk(start, end, (i, j, entered) => {
      if (best < entered) return false;
      visit(i, j);
      return true;
    });
  };

  const trace = (from, to) => {
    start = from;
    end = to;
    best = 2;
    bestSky = false;
    tick++;
    boxesOn();
    hullsOn();
    const lo = [Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.min(from[2], to[2])];
    const hi = [Math.max(from[0], to[0]), Math.max(from[1], to[1]), Math.max(from[2], to[2])];
    if (mask) for (const tree of trees) {
      if (tree.min && [0, 1, 2].some((k) => hi[k] < tree.min[k] || lo[k] > tree.max[k])) continue;
      walk(tree.head, 0, 1, tree.origin);
    }
    trianglesOn();
    return best <= 1 ? best : null;
  };

  return {
    triangles: tris.length,
    hulls: hullList.reduce((sum, prop) => sum + prop.parts.length, 0),
    firstStop(from, to) {
      const f = trace(from, to);
      return f === null ? null : f * Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    },
    upward(from, most = 16384) {
      const f = trace(from, [from[0], from[1], from[2] + most]);
      return f === null ? { distance: Infinity, sky: false } : { distance: f * most, sky: bestSky };
    },
    downward(from, most = 256) {
      const f = trace(from, [from[0], from[1], from[2] - most]);
      return f === null ? null : f * most;
    },
  };
}
