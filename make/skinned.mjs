// A body built limb by limb, each corner on its own bone: the lofts, tubes and cards the Master Sword monsters
// made from nothing were built of (the scarecrow, the first Barrow Guard), where the workshop's `shape` builds a
// rigid piece. Handed out by workshop.mjs: `workshop.skinned()`, `workshop.zoneOn`, `workshop.span`.
//
//   const Z = { TUNIC: zoneOn("body", 256, 256, 0, 0, 192, 128) };          // a zone of a picture
//   const B = skinned();
//   B.tube(Z.TUNIC, [{ c: [0, 0, 28], rx: 6, ry: 9, v: 1, bone: "pelvis" }, { c: [0, 0, 64], rx: 0, ry: 0, v: 0, bone: "chest" }], { sides: 10 });
//   buildMdl({ name, bones, ownNormals: true, bodyparts: [{ name: "body", models: [{ name: "it", meshes: [{ tris: B.meshes.body, texture }] }] }] });
//
// Corners are { p, uv, n, bone } in the model at rest: pass `ownNormals: true` to buildMdl to keep the normals.
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const sum = (...v) => v.reduce(add);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const TAU = 2 * Math.PI;
/** A face of no area (twice its area under this) is not made. */
const NO_AREA = 1e-6;
/** How steep a tube's normals lean with its narrowing, at the most, each way. */
const SLOPE_MOST = 2;

/**
 * A zone of a picture: the rectangle (x, y, w, h) in pixels of a picture of W by H, of the texture called
 * `tex` (the key `meshes` keeps its triangles under). `uv(u, v)`: a place in it, u and v 0 to 1 across and down
 * it, as a corner's `uv` (0 to 1 of the whole picture; v kept half a pixel from the zone's top and bottom).
 */
export const zoneOn = (tex, W, H, x, y, w, h) => ({
  tex,
  x,
  y,
  w,
  h,
  uv: (u, v) => [(x + u * w) / W, (y + 0.5 + v * (h - 1)) / H],
});

/**
 * A stretch of a part's length laid down a zone: `v(s)` the place down the zone (v0 to v1) of the point at `s`
 * (s0 to s1) along the part, and `s(v)` back.
 */
export const span = (s0, s1, v0 = 0, v1 = 1) => ({
  v: (s) => v0 + ((v1 - v0) * (s - s0)) / (s1 - s0),
  s: (v) => s0 + ((s1 - s0) * (v - v0)) / (v1 - v0),
});

/**
 * A body being built: `meshes` ({ texture key: [triangles] }), and the ways to add to it.
 *   put(tex, a, b, c, out)   one triangle of corners { p, uv, n, bone }, turned to face `out` when given
 *   loft(zone, sections)     a skin over sections [{ pts, ns, centre, v, bones, point }], each with as many points
 *                            (`ns` their normals, `bones` their bones; `point: true`, all one point: an end
 *                            closed). The picture goes once round the zone, from the first point back to it
 *   tube(zone, rings, { sides, e1, e2, phase, bone })   a limb or a trunk: rings [{ c (its middle), rx, ry
 *                            (0, 0: a point that closes the end), v, bone, rf(k, angle) (a corner swollen or
 *                            shrunk), off(k, angle) (moved), boneAt(k, angle) }] of `sides` corners in the plane
 *                            of e1 and e2. A corner's angle runs from -180 degrees (opposite e1) through e1 (the
 *                            middle of the zone, less `phase` corners) back to it: e1 is the part's front
 *   card(zone, base, d, r, L, W, { bone, n, flip })     a card seen from both sides: from `base` along `d`, `L`
 *                            long and `W` wide across `r`; the zone's bottom edge at its base; one normal `n`
 */
export function skinned() {
  const meshes = {};
  const put = (tex, a, b, c, out) => {
    const fn = cross(sub(b.p, a.p), sub(c.p, a.p));
    if (Math.hypot(...fn) < NO_AREA) return;
    (meshes[tex] ??= []).push(out && dot(fn, out) < 0 ? [a, c, b] : [a, b, c]);
  };
  const loft = (zn, secs) => {
    const sides = secs[0].pts.length;
    const rows = secs.map((q) =>
      Array.from({ length: sides + 1 }, (_, k) => ({
        p: q.pts[k % sides],
        uv: zn.uv(k / sides, q.v),
        n: q.ns[k % sides],
        bone: q.bones[k % sides],
      })),
    );
    for (let i = 0; i + 1 < secs.length; i++) {
      const A0 = secs[i];
      const B0 = secs[i + 1];
      let inside = mul(add(A0.centre, B0.centre), 0.5);
      // an end's fan: a point further in than its ring
      if (A0.point) inside = add(B0.centre, sub(B0.centre, A0.centre));
      else if (B0.point) inside = add(A0.centre, sub(A0.centre, B0.centre));
      for (let k = 0; k < sides; k++) {
        const a = rows[i][k];
        const b = rows[i][k + 1];
        const c = rows[i + 1][k + 1];
        const d = rows[i + 1][k];
        const out = sub(mul(sum(a.p, b.p, c.p, d.p), 0.25), inside);
        put(zn.tex, a, b, c, out);
        put(zn.tex, a, c, d, out);
      }
    }
  };
  return {
    meshes,
    put,
    loft,
    tube(zn, rings, { sides, e1 = [1, 0, 0], e2 = [0, 1, 0], phase = 0, bone }) {
      const n = rings.length;
      const R = (q) => (q.rx + q.ry) / 2;
      loft(
        zn,
        rings.map((q, i) => {
          const prev = rings[Math.max(0, i - 1)];
          const next = rings[Math.min(n - 1, i + 1)];
          const T = norm(sub(next.c, prev.c));
          const slope = clamp((R(prev) - R(next)) / (Math.hypot(...sub(next.c, prev.c)) || 1), -SLOPE_MOST, SLOPE_MOST);
          const point = R(q) === 0;
          const pts = [];
          const ns = [];
          const bones = [];
          for (let k = 0; k < sides; k++) {
            const a = -Math.PI + (TAU * (k + phase)) / sides;
            const f = q.rf ? q.rf(k, a) : 1;
            let p = sum(q.c, mul(e1, q.rx * f * Math.cos(a)), mul(e2, q.ry * f * Math.sin(a)));
            if (q.off) p = add(p, q.off(k, a));
            pts.push(p);
            ns.push(
              point
                ? mul(T, i === 0 ? -1 : 1)
                : norm(add(norm(add(mul(e1, Math.cos(a) / q.rx), mul(e2, Math.sin(a) / q.ry))), mul(T, slope))),
            );
            bones.push(q.boneAt ? q.boneAt(k, a) : (q.bone ?? bone));
          }
          return { pts, ns, bones, centre: q.c, v: q.v, point };
        }),
      );
    },
    card(zn, base, d, r, L, W, { bone, n, flip = false }) {
      d = norm(d);
      r = norm(sub(r, mul(d, dot(r, d))));
      const h = mul(r, W / 2);
      const at = (p, u, v) => ({ p, uv: zn.uv(flip ? 1 - u : u, v), n, bone });
      const bl = at(sub(base, h), 0, 1);
      const br = at(add(base, h), 1, 1);
      const tr = at(sum(base, h, mul(d, L)), 1, 0);
      const tl = at(add(sub(base, h), mul(d, L)), 0, 0);
      put(zn.tex, bl, br, tr);
      put(zn.tex, bl, tr, tl);
      put(zn.tex, bl, tr, br);
      put(zn.tex, bl, tl, tr);
    },
  };
}
