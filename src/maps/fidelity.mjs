// How near a recompiled map is to the map it was decompiled from, in numbers and with no engine: whether
// its faces wear the original's textures where the original has them (textureFidelity), and whether its
// baked light is as bright (lightParity). Ports of texcheck.py and lightcheck.py from Steven Linn's
// goldsrc.net project (godot/tools/bsp2map), which measured the whole retail set with them; the numbers
// come out the same.
//
//   textureFidelity(original, recompiled) -> { faces, matched, same, texinfo, covered, unseen, boxmove,
//                                             lostModels, lost }
//   lightParity(original, recompiled)     -> { all, up, side }, each { faces, retail, ours, ratio }
//
// Both take a map's bytes or what `readBsp` made of them. The recompile's entities must be in the
// original's order (decompile.mjs writes them so): brush models are paired through them.
import { readBsp, CONTENTS, leafAt } from "./bsp.mjs";
import { parseEntities } from "./entities.mjs";
import { lumpBytes } from "./lumps.mjs";
import { roundText } from "./decompile.mjs";

const { SOLID, SKY } = CONTENTS;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const neg = (a) => [-a[0], -a[1], -a[2]];

/** A map read, from its bytes or as `readBsp` gave it. */
const mapOf = (map) =>
  map?.planes && map?.faces ? map : readBsp(Buffer.isBuffer(map) ? map : Buffer.from(map));

/** A face's corners, in the file's order. */
function facePoly(bsp, fi) {
  const f = bsp.faces[fi];
  const pts = [];
  for (let k = 0; k < f.edgeCount; k++) {
    const e = bsp.surfedges[f.firstEdge + k];
    pts.push(bsp.vertices[bsp.edges[Math.abs(e)][e >= 0 ? 0 : 1]]);
  }
  return pts;
}
const centroid = (poly) => {
  let s = [0.0, 0.0, 0.0];
  for (const p of poly) s = [s[0] + p[0], s[1] + p[1], s[2] + p[2]];
  const k = 1.0 / poly.length;
  return [s[0] * k, s[1] * k, s[2] * k];
};
/** A face's outward normal and distance: its plane's, turned about for a face on the plane's back. */
function facing(bsp, fi) {
  const f = bsp.faces[fi];
  const pl = bsp.planes[f.plane];
  return f.side ? [neg(pl.normal), -pl.dist] : [pl.normal, pl.dist];
}

/** Is c inside the convex polygon (both on the plane of normal n), with a little tolerance? */
function pointInPoly(c, poly, n) {
  const m = poly.length;
  if (m < 3) return false;
  let sign = 0;
  for (let i = 0; i < m; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % m];
    const s = dot(cross(sub(b, a), sub(c, a)), n);
    if (Math.abs(s) < 1e-3) continue;
    if (sign === 0) sign = s > 0 ? 1 : -1;
    else if (s > 0 !== sign > 0) return false;
  }
  return true;
}

/** The leaves seen from a leaf (its row of the visibility, unpacked), or null without one. */
function pvs(bsp, li) {
  const off = bsp.leaves[li].visOffset;
  if (off < 0) return null;
  const v = lumpBytes(bsp.bytes, bsp.lumps.visibility);
  const row = Math.floor((bsp.models[0].visLeaves + 8) / 8);
  const out = new Set();
  let c = 0;
  let i = off;
  while (c < row && i < v.length) {
    if (v[i] === 0) {
      c += v[i + 1];
      i += 2;
      continue;
    }
    const byte = v[i];
    for (let k = 0; k < 8; k++) if ((byte >> k) & 1) out.add(c * 8 + k + 1);
    c++;
    i++;
  }
  return out;
}

/** An entity's keys, the last of a key given twice winning. */
const keysOf = (pairs) => new Map(pairs);

/**
 * The leaves a portal path joins to the first place to start: a flood through the visibility (it flows
 * through portals only, so a sealed pocket never shows in a joined leaf's row). Null without visibility.
 */
function connectedLeaves(bsp) {
  let spawn = null;
  for (const e of bsp.entities) {
    const d = keysOf(e);
    if (["info_player_start", "info_player_deathmatch"].includes(d.get("classname")) && d.has("origin")) {
      spawn = d.get("origin").trim().split(/\s+/).map(Number);
      break;
    }
  }
  if (spawn === null || !bsp.lumps.visibility.length) return null;
  const start = leafAt(bsp, spawn);
  const seen = new Set([start]);
  const todo = [start];
  while (todo.length) {
    const row = pvs(bsp, todo.pop());
    if (row === null) continue;
    for (const q of row)
      if (!seen.has(q) && q < bsp.leaves.length) {
        seen.add(q);
        todo.push(q);
      }
  }
  return seen;
}

/** One model's faces by their normal rounded, for "the face on this plane at this point". */
function faceIndex(bsp, mi) {
  const idx = new Map();
  const m = bsp.models[mi];
  for (let fi = m.firstFace; fi < m.firstFace + m.faceCount; fi++) {
    const [n, d] = facing(bsp, fi);
    const key = n.map((x) => roundText(x, 1)).join();
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push([fi, n, d, facePoly(bsp, fi)]);
  }
  return {
    /** The face on plane (n, d) under point p, the nearest within `tol`; with `either`, facing either way. */
    at(n, d, p, tol = 2.5, either = false) {
      let best = null;
      for (const sign of either ? [1.0, -1.0] : [1.0]) {
        const sn = n.map((x) => sign * x);
        const keys = new Set([
          sn.map((x) => roundText(x, 1)).join(),
          sn.map((x) => roundText(x + 1e-9, 1)).join(),
        ]);
        for (const key of keys)
          for (const [fi, fn, fd, poly] of idx.get(key) ?? []) {
            if (dot(fn, sn) < 0.999) continue;
            const off = Math.abs(dot(fn, p) - fd);
            if (off < tol && pointInPoly(p, poly, fn) && (best === null || off < best[0])) best = [off, fi];
          }
      }
      return best === null ? null : best[1];
    },
  };
}

/** Do two texinfos match: their axes within 1e-3, their offsets the same modulo the texture's size? */
function sameTexinfo(ta, tb, dims) {
  const va = [...ta.s.slice(0, 3), ...ta.t.slice(0, 3)];
  const vb = [...tb.s.slice(0, 3), ...tb.t.slice(0, 3)];
  if (va.some((x, i) => Math.abs(x - vb[i]) > 1e-3)) return false;
  const [w, h] = dims.get(ta.texture) ?? [0, 0];
  const ds = ta.s[3] - tb.s[3];
  const dt = ta.t[3] - tb.t[3];
  const wraps = (delta, size) => Math.abs(delta) < 0.05 || (size && Math.abs(delta / size - roundEven(delta / size)) * size < 0.05); // prettier-ignore
  return Boolean(wraps(ds, w) && wraps(dt, h));
}
/** A number to the nearest whole one, a half to the even one, as Python's round(). */
const roundEven = (x) => {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

/** [original model, recompiled model or null], through the entity lists, the world first. */
function modelPairs(o, d) {
  const brushModel = (e) => {
    const model = keysOf(e).get("model") ?? "";
    return model.startsWith("*") ? Number.parseInt(model.slice(1), 10) : null;
  };
  const pairs = [[0, 0]];
  o.entities.forEach((e, i) => {
    const mi = brushModel(e);
    if (mi === null) return;
    pairs.push([mi, i < d.entities.length ? brushModel(d.entities[i]) : null]);
  });
  return pairs;
}

const polyArea = (poly, n) => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += dot(n, cross(poly[i], poly[(i + 1) % poly.length]));
  return Math.abs(s) * 0.5;
};

/**
 * Texture fidelity of a recompile against its original: for every face of the original (every model), the
 * recompile's face on the same plane at that face's centre, area-weighted. In per cent:
 *   matched   of the seen original face area, what has a recompiled face at the same spot (the rest is air
 *             in the recompile where the original shows a face)
 *   same      of the matched area, the share wearing the original's texture
 *   texinfo   of that, the share whose texinfo is the original's (axes within 1e-3, offsets modulo the
 *             texture's size)
 *   covered   seen original face area the recompile is SOLID in front of: a room walled off
 *   unseen    original face area nobody sees, left out of the rest: faces against sky or solid, and those
 *             of a pocket no portal joins to the place to start
 * and `boxmove`, the largest shift of a brush entity's box (units), `lostModels`, the original's brush
 * entities with no model in the recompile, `lost`, the textures the recompile wears on no face at all with
 * their original area ([{ name, area }], most first), `faces`, the faces looked at. AAATRIGGER and sky
 * faces are left out (hlcsg strips the one, and the other is no surface). A liquid face matches the face on
 * either side of its plane: Valve's compiler wrote each liquid face twice, SDHLT once.
 */
export function textureFidelity(original, recompiled) {
  const o = mapOf(original);
  const d = mapOf(recompiled);
  const oname = (ti) => (o.textures[ti.texture]?.absent ? "NULL" : (o.textures[ti.texture]?.name ?? "")).toLowerCase(); // prettier-ignore
  const dname = (ti) => (d.textures[ti.texture]?.absent ? "NULL" : (d.textures[ti.texture]?.name ?? "")).toLowerCase(); // prettier-ignore
  const dims = new Map(o.textures.filter((t) => !t.absent).map((t) => [t.index, [t.width, t.height]]));
  const usedDc = new Set(d.faces.map((f) => dname(d.texinfo[f.texinfo])));
  const conn = connectedLeaves(o);
  let boxmove = 0.0;
  let lostModels = 0;
  let faces = 0;
  const lost = new Map();
  let area = 0.0;
  let matched = 0.0;
  let same = 0.0;
  let exact = 0.0;
  let covered = 0.0;
  let unseen = 0.0;
  for (const [mi, di] of modelPairs(o, d)) {
    const m = o.models[mi];
    if (di === null || !d.models[di] || !m) {
      lostModels++;
      continue;
    }
    if (mi > 0) {
      const dm = d.models[di];
      const shift = Math.max(...[0, 1, 2].flatMap((i) => [Math.abs(m.mins[i] - dm.mins[i]), Math.abs(m.maxs[i] - dm.maxs[i])])); // prettier-ignore
      boxmove = Math.max(boxmove, shift);
    }
    const df = faceIndex(d, di);
    for (let fi = m.firstFace; fi < m.firstFace + m.faceCount; fi++) {
      const f = o.faces[fi];
      const ti = o.texinfo[f.texinfo];
      const name = oname(ti);
      const poly = facePoly(o, fi);
      if (poly.length < 3 || name === "aaatrigger" || name === "sky") continue;
      const [n, dd] = facing(o, fi);
      const a = polyArea(poly, n);
      const c = centroid(poly);
      faces++;
      const front = [c[0] + n[0] * 1.0, c[1] + n[1] * 1.0, c[2] + n[2] * 1.0];
      const ol = leafAt(o, front);
      if ([SOLID, SKY].includes(o.leaves[ol].contents) || (conn !== null && !conn.has(ol))) {
        unseen += a;
        continue;
      }
      area += a;
      if (!usedDc.has(name)) lost.set(name, (lost.get(name) ?? 0) + a);
      const gi = df.at(n, dd, c, 2.5, name.startsWith("!"));
      if (gi === null) {
        if (d.leaves[leafAt(d, front)].contents === SOLID) covered += a;
        continue;
      }
      matched += a;
      const tj = d.texinfo[d.faces[gi].texinfo];
      if (dname(tj) !== name) continue;
      same += a;
      if (sameTexinfo(ti, tj, dims)) exact += a;
    }
  }
  const pct = (x, y) => (y ? (100.0 * x) / y : 0.0);
  return {
    faces,
    matched: pct(matched, area),
    same: pct(same, matched),
    texinfo: pct(exact, same),
    covered: pct(covered, area),
    unseen: pct(unseen, area + unseen),
    boxmove,
    lostModels,
    lost: [...lost].sort((x, y) => y[1] - x[1]).map(([name, a]) => ({ name, area: a })),
  };
}

/** The style-0 light at point p of a face (the mean of its sample's three bytes), or null where it has none. */
function lumAt(bsp, fi, p) {
  const f = bsp.faces[fi];
  if (f.lightOffset < 0 || f.styles[0] === 255) return null;
  const ti = bsp.texinfo[f.texinfo];
  const poly = facePoly(bsp, fi);
  const ss = poly.map((q) => dot(q, ti.s) + ti.s[3]);
  const tt = poly.map((q) => dot(q, ti.t) + ti.t[3]);
  const s0 = Math.floor(Math.min(...ss) / 16);
  const t0 = Math.floor(Math.min(...tt) / 16);
  const w = Math.ceil(Math.max(...ss) / 16) - s0 + 1;
  const h = Math.ceil(Math.max(...tt) / 16) - t0 + 1;
  const s = dot(p, ti.s) + ti.s[3];
  const t = dot(p, ti.t) + ti.t[3];
  const u = Math.min(w - 1, Math.max(0, roundEven(s / 16 - s0)));
  const v = Math.min(h - 1, Math.max(0, roundEven(t / 16 - t0)));
  const ld = lumpBytes(bsp.bytes, bsp.lumps.lighting);
  const off = f.lightOffset + (v * w + u) * 3;
  return off + 3 <= ld.length ? (ld[off] + ld[off + 1] + ld[off + 2]) / 3.0 : null;
}

/**
 * Light parity of a recompile against its original: the mean style-0 lightmap value at the centre of each
 * of the original's world faces, in the original and in the recompile's face there, over all faces, the
 * upward ones (floors, sunlit tops) and the upright ones (walls, lit by bounce). Each class is `{ faces,
 * retail, ours, ratio }`: how many faces were measured, the two means (0 to 255) and ours over retail.
 * Faces darker than 4 in the original, or with no face of the recompile at their centre, are left out.
 */
export function lightParity(original, recompiled) {
  const o = mapOf(original);
  const d = mapOf(recompiled);
  // the recompile's world faces by their plane's normal, rounded
  const idx = new Map();
  const w = d.models[0];
  for (let fi = w.firstFace; fi < w.firstFace + w.faceCount; fi++) {
    const key = d.planes[d.faces[fi].plane].normal.map((x) => roundText(x, 2)).join();
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push(fi);
  }
  const findFace = (n, p) => {
    const near = [...(idx.get(n.map((x) => roundText(x, 2)).join()) ?? []), ...(idx.get(n.map((x) => roundText(-x, 2)).join()) ?? [])]; // prettier-ignore
    for (const fi of near) {
      const pl = d.planes[d.faces[fi].plane];
      if (Math.abs(dot(pl.normal, p) - pl.dist) < 1.0 && pointInPoly(p, facePoly(d, fi), pl.normal))
        return fi;
    }
    return null;
  };
  const acc = { all: [0, 0.0, 0.0], up: [0, 0.0, 0.0], side: [0, 0.0, 0.0] };
  const w0 = o.models[0];
  for (let fi = w0.firstFace; fi < w0.firstFace + w0.faceCount; fi++) {
    const poly = facePoly(o, fi);
    if (poly.length < 3) continue;
    const c = centroid(poly);
    const [n] = facing(o, fi);
    const lr = lumAt(o, fi, c);
    const dfi = findFace(n, c);
    if (lr === null || lr < 4 || dfi === null) continue;
    const lc = lumAt(d, dfi, c);
    if (lc === null) continue;
    for (const k of ["all", n[2] > 0.9 ? "up" : Math.abs(n[2]) < 0.1 ? "side" : null]) {
      if (!k) continue;
      acc[k][0]++;
      acc[k][1] += lr;
      acc[k][2] += lc;
    }
  }
  const out = {};
  for (const [k, [count, retail, ours]] of Object.entries(acc))
    out[k] = {
      faces: count,
      retail: count ? retail / count : null,
      ours: count ? ours / count : null,
      ratio: count && retail ? ours / retail : null,
    };
  return out;
}

/** A fidelity as texcheck.py's summary column: matched/same/texinfo/covered/boxmove, lost models and textures. */
export function fidelityLine(r) {
  const lost = r.lost.map(({ name, area }) => `${name}(${Math.trunc(area)})`).join(" ");
  return `${r.matched.toFixed(1)}/${r.same.toFixed(1)}/${r.texinfo.toFixed(1)}/${r.covered.toFixed(1)}/${r.boxmove.toFixed(1)}${r.lostModels ? ` lost:${r.lostModels}` : ""}${lost ? ` ${lost}` : ""}`; // prettier-ignore
}
