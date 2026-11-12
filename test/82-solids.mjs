// Convex solids made in plain JavaScript (core/solids.mjs): each kind, square and slanted, closed with every edge
// met once each way, its faces looking out, convex (every point behind every face's plane), and costing the
// points it says.
import { solids as S } from "../src/index.mjs";
import { test, sure, near } from "./helper.mjs";

const slanted = S.place([3, -2, 5], [0.3, 0.5, 0.8], [1, 0, 0]);
const square = S.place([0, 0, 0], [0, 0, 1]);
const kinds = {
  box: S.box(slanted, 4, 3, 2),
  "box cut and bevelled": S.box(slanted, 4, 3, 2, { cut: 0.6, bevel: 0.4, bevelFoot: 0.3, taper: 0.7 }),
  plate: S.plate(square, S.rect(5, 3, 0.8), 0.4, { bevel: 0.2 }),
  "plate of an outline": S.plate(
    slanted,
    S.outline([
      [0, 0],
      [3, 0],
      [3.5, 2],
      [-1, 1.5],
    ]),
    0.5,
  ),
  prism: S.prism(slanted, S.ngon(5, 2), -1, 3, { top: 0.6 }),
  cylinder: S.cyl(slanted, 1.2, 0, 4, { n: 8, bevel: 0.3 }),
  "thin rod": S.cyl(square, 0.2, 0, 3),
  beam: S.beam([0, 0, 0], [6, 2, 1], 1, 0.8, [0, 0, 1], { bevel: 0.2 }),
  tube: S.tube([1, 1, 1], [1, 5, 2], 0.5, { n: 6 }),
  ball: S.ball([2, 2, 2], 1.5, [0, 1, 0], { n: 8 }),
  loft: S.loft(slanted, [
    { z: 0, poly: S.rect(4, 3) },
    { z: 1, poly: S.rect(4.4, 3.4) },
    { z: 2.5, poly: S.inset(S.rect(4.4, 3.4), 0.6) },
  ]),
};

test("solids: every kind closed, every edge met once each way round", () => {
  for (const [name, solid] of Object.entries(kinds)) {
    const c = S.closed(S.trisOf(solid));
    sure(c.closed, `${name}: ${c.open} open edges, ${c.doubled} doubled`);
  }
});

test("solids: faces look out, and the volume they close is the solid's", () => {
  for (const [name, solid] of Object.entries(kinds)) {
    const tris = S.trisOf(solid).map((t) => t.map((c) => c.p));
    const pts = tris.flat();
    const mid = S.mul(pts.reduce(S.add, [0, 0, 0]), 1 / pts.length);
    // the signed volume of the tetrahedra from the middle: over 0 when every face looks out
    let volume = 0;
    for (const [a, b, c] of tris) {
      const n = S.cross(S.sub(b, a), S.sub(c, a));
      sure(S.dot(n, S.sub(a, mid)) > -1e-9, `${name}: a face looks in`);
      volume += S.dot(S.sub(a, mid), S.cross(S.sub(b, mid), S.sub(c, mid))) / 6;
    }
    sure(volume > 0, `${name}: volume ${volume}`);
  }
  // a plain box's volume is its size
  near(
    S.trisOf(S.box(slanted, 4, 3, 2))
      .map((t) => t.map((c) => c.p))
      .reduce((v, [a, b, c]) => v + S.dot(a, S.cross(b, c)) / 6, 0),
    24,
    1e-6,
    "a 4 by 3 by 2 box",
  );
});

test("solids: convex, every point behind every face's plane", () => {
  for (const [name, solid] of Object.entries(kinds)) {
    const tris = S.trisOf(solid);
    const planes = S.planesOf(tris);
    sure(planes.length >= 4, `${name}: ${planes.length} planes`);
    for (const t of tris)
      for (const c of t)
        for (const pl of planes)
          sure(
            S.dot(pl.n, c.p) <= pl.d + 1e-6,
            `${name}: a point before a plane by ${S.dot(pl.n, c.p) - pl.d}`,
          );
  }
  sure(S.planesOf(S.trisOf(S.box(square, 1, 1, 1))).length === 6, "a box has six planes");
});

test("solids: the points a solid costs are its corners, each once", () => {
  for (const [name, solid] of Object.entries(kinds)) {
    const seen = new Set(S.trisOf(solid).flatMap((t) => t.map((c) => c.p.map((v) => v.toFixed(5)).join())));
    sure(
      seen.size === S.pointsOf([solid]),
      `${name}: ${seen.size} points drawn, ${S.pointsOf([solid])} counted`,
    );
  }
  sure(
    S.pointsOf([S.box(square, 1, 1, 1), S.cyl(square, 1, 0, 1, { n: 8 })]) === 8 + 16,
    "a box and an eight-sided cylinder",
  );
  sure(S.pointsOf([S.cyl(square, 0.2, 0, 1, { n: 8 })]) === 8, "a thin rod is four-sided");
});

test("solids: places, outlines and insets", () => {
  const pl = S.place([1, 2, 3], [0, 0, 2], [1, 1, 0]);
  near(S.len(pl.X), 1, 1e-9, "X of length 1");
  near(S.dot(pl.X, pl.Z), 0, 1e-9, "X across Z");
  near(S.dot(S.cross(pl.X, pl.Y), pl.Z), 1, 1e-9, "X, Y, Z right-handed");
  const p = S.at(S.along(pl, "X"), 0, 0, 2);
  near(S.len(S.sub(p, S.at(pl, 2, 0, 0))), 0, 1e-9, "along X: its Z is the place's X");
  const o = S.outline([
    [1, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
  ]);
  sure(S.area2(o) > 0, "outline: counter-clockwise");
  const r = S.rect(4, 2);
  near(S.area2(S.inset(r, 0.5)), 3 * 1, 1e-9, "a 4 by 2 rectangle in by 0.5 is 3 by 1");
  near(S.area2(S.inset(r, 5)), 2, 1e-9, "inset past its middle: half its size about the middle");
  sure(S.rect(4, 2, 0.5).length === 8 && S.ngon(6, 1).length === 6, "corners cut, a hexagon");
});
