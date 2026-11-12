// Fewer triangles: the quadric reducer (make/qem.mjs, from stevenlafl/smak).
//   a sphere of 2000 brought to 200 keeps its volume and stays closed; a box cut fine comes back to its 12
//   triangles and its 8 corners; an open sheet keeps its border; a corner keeps what it carries; where two charts
//   of a picture meet, every triangle keeps corners of its own chart; a bought model's runs of two materials
//   brought down each by its share, meeting where they met, each corner on the bone it hung from
import { reduce } from "../make/qem.mjs";
import { fewerTriangles } from "../check/import-model.mjs";
import { test, sure, near } from "./helper.mjs";

/** The lowest and highest of some points along an axis. */
const spanOf = (ps, a) => ps.reduce(([lo, hi], p) => [Math.min(lo, p[a]), Math.max(hi, p[a])], [Infinity, -Infinity]);

/** The volume a closed list of triangles holds (over 0 when they face out). */
const volumeOf = (tris) =>
  tris.reduce((s, t) => {
    const [a, b, c] = t.map((x) => x.p);
    return s + (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }, 0);

/** Every edge between two faces, once each way: closed, and every face turned the same way as its neighbours. */
const closed = (tris) => {
  const edges = new Map();
  for (const t of tris)
    for (let k = 0; k < 3; k++) {
      const key = `${t[k].p.join()}|${t[(k + 1) % 3].p.join()}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  for (const [key, count] of edges) {
    const [a, b] = key.split("|");
    if (count !== 1 || edges.get(`${b}|${a}`) !== 1) return false;
  }
  return true;
};

function sphere(round, high, r) {
  const at = (i, j) => {
    const t = (Math.PI * j) / high;
    const f = (2 * Math.PI * (i % round)) / round;
    const v = [r * Math.sin(t) * Math.cos(f), r * Math.sin(t) * Math.sin(f), r * Math.cos(t)];
    return v.map((x) => (Math.abs(x) < 1e-12 ? 0 : Math.round(x * 1e9) / 1e9));
  };
  const tris = [];
  for (let j = 0; j < high; j++)
    for (let i = 0; i < round; i++) {
      const [a, b, c, d] = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      if (j > 0) tris.push([a, c, b].map((p) => ({ p })));
      if (j < high - 1) tris.push([a, d, c].map((p) => ({ p })));
    }
  return tris;
}

/** A box [X, Y, Z] from the origin, each face cut n by n, facing out. */
function box(n, [X, Y, Z]) {
  const tris = [];
  const face = (o, u, v) => {
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const P = (a, b) => ({ p: [0, 1, 2].map((k) => o[k] + (u[k] * a) / n + (v[k] * b) / n), uv: [a / n, b / n] });
        tris.push([P(i, j), P(i + 1, j), P(i + 1, j + 1)], [P(i, j), P(i + 1, j + 1), P(i, j + 1)]);
      }
  };
  face([0, 0, 0], [0, Y, 0], [X, 0, 0]);
  face([0, 0, Z], [X, 0, 0], [0, Y, 0]);
  face([0, 0, 0], [X, 0, 0], [0, 0, Z]);
  face([0, Y, 0], [0, 0, Z], [X, 0, 0]);
  face([0, 0, 0], [0, 0, Z], [0, Y, 0]);
  face([X, 0, 0], [0, Y, 0], [0, 0, Z]);
  return tris;
}

test("reduce: a sphere of 2000 triangles to 200 keeps its volume within 3 in 100, closed and facing out", () => {
  const s = sphere(40, 26, 10);
  sure(s.length === 2000, `${s.length}`);
  const { tris, report } = reduce(s, { target: 200 });
  sure(tris.length <= 200 && tris.length >= 190, `${tris.length} triangles`);
  sure(closed(tris), "the reduced sphere is closed, each edge between two faces turned alike");
  near(volumeOf(tris) / volumeOf(s), 1, 0.03, "volume kept");
  sure(report.from === 2000 && report.to === tris.length && report.stages >= 3, JSON.stringify(report));
});

test("reduce: a box cut fine comes back to 12 triangles on its 8 corners; a box of 12 asked for 12 is as it was", () => {
  const fine = box(4, [3, 5, 7]);
  const { tris } = reduce(fine, { target: 12 });
  sure(tris.length === 12, `${tris.length} triangles`);
  const corners = new Set(tris.flat().map((c) => c.p.join()));
  sure(corners.size === 8, [...corners].join(" "));
  for (const c of corners) sure(c.split(",").every((v, a) => Number(v) === 0 || Number(v) === [3, 5, 7][a]), `${c} is a corner of the box`);
  near(volumeOf(tris), 105, 1e-9, "the box's volume");
  sure(closed(tris), "closed");
  const plain = box(1, [3, 5, 7]);
  const same = reduce(plain, { target: 12 });
  sure(same.tris.length === 12 && same.report.stages === 0, JSON.stringify(same.report));
});

test("reduce: an open sheet keeps its border; a corner that stays keeps what it carries", () => {
  // a 10 by 10 sheet with a bump in the middle: the border's square stays, its area with it
  const tris = [];
  const P = (i, j) => ({ p: [i, j, i > 3 && i < 7 && j > 3 && j < 7 ? 0.5 : 0], uv: [i / 10, j / 10], bone: "root" });
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) tris.push([P(i, j), P(i + 1, j), P(i + 1, j + 1)], [P(i, j), P(i + 1, j + 1), P(i, j + 1)]);
  const { tris: out, report } = reduce(tris, { target: 40 });
  sure(out.length <= 40 && report.border === 40, JSON.stringify(report));
  const flatArea = out.reduce((s, t) => {
    const [a, b, c] = t.map((x) => x.p);
    return s + ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  }, 0);
  near(flatArea, 100, 1e-6, "the sheet's area seen from above");
  for (const corner of out.flat()) {
    sure(corner.bone === "root" && corner.uv.length === 2, JSON.stringify(corner));
    sure(corner.p[0] >= 0 && corner.p[0] <= 10 && corner.p[1] >= 0 && corner.p[1] <= 10, `${corner.p} inside the sheet`);
  }
  // the four corners of the sheet are there, each with its own place on the picture
  for (const [x, y] of [[0, 0], [10, 0], [10, 10], [0, 10]]) {
    const at = out.flat().find((c) => c.p[0] === x && c.p[1] === y);
    sure(at && at.uv[0] === x / 10 && at.uv[1] === y / 10, `corner ${x},${y}: ${JSON.stringify(at)}`);
  }
});

test("reduce: where two charts of the picture meet, every triangle keeps corners of its own chart", () => {
  // a sheet bent along x = 5: its flat half on the left of the picture (u under 0.5), its upright half on the right
  const tris = [];
  const P = (i, j) => (i <= 5 ? { p: [i, j, 0], uv: [i / 20, j / 10] } : { p: [5, j, i - 5], uv: [0.5 + (i - 5) / 20, j / 10] });
  const Q = (i, j, side) => (i === 5 ? (side ? { p: [5, j, 0], uv: [0.5, j / 10] } : P(i, j)) : P(i, j));
  for (let i = 0; i < 10; i++)
    for (let j = 0; j < 10; j++) {
      const side = i >= 5;
      tris.push([Q(i, j, side), Q(i + 1, j, side), Q(i + 1, j + 1, side)], [Q(i, j, side), Q(i + 1, j + 1, side), Q(i, j + 1, side)]);
    }
  const { tris: out } = reduce(tris, { target: 40 });
  sure(out.length < tris.length, `reduced: ${out.length}`);
  const stretched = out.filter((t) => t.some((c) => c.uv[0] < 0.5) && t.some((c) => c.uv[0] > 0.5));
  sure(!stretched.length, `${stretched.length} triangles reach across both charts: ${JSON.stringify(stretched[0]?.map((c) => c.uv))}`);
});

/** A drawn mask: `fill(x, y)` for each dot of a width x height picture, the thing's box at rect. */
const drawnMask = (width, height, fill) => {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = fill(x + 0.5, y + 0.5) ? 1 : 0;
  return { width, height, data };
};

test("fewerTriangles: two materials of one box, each by its share, meeting where they met, on the bones they hung from", () => {
  // a box cut 8 by 8 a face, its triangles west of x = 32 one material and on bone 1, the rest another on bone 2
  const tris = box(8, [64, 32, 16]);
  const west = (tri) => tri.reduce((sum, corner) => sum + corner.p[0], 0) / 3 < 32;
  const runOf = (material, node, list) => ({ object: "box", group: material, material, tris: list.map((tri) => tri.map((corner) => ({ ...corner, n: [0, 0, 1], node, weights: [[node, 1]] }))) }); // prettier-ignore
  const scene = { format: "obj", groups: [runOf("stone", 1, tris.filter(west)), runOf("wood", 2, tris.filter((tri) => !west(tri)))] }; // prettier-ignore
  const { imported, said } = fewerTriangles(scene, 60);
  const [stone, wood] = imported.groups;
  // each brought down by its share; the points on the line they share are kept, so it stops a little over 60
  sure(stone.tris.length + wood.tris.length < 768 / 8 && wood.tris.length < scene.groups[1].tris.length / 4, said);
  // where the two meet (x = 32) each has the very points the other has: no crack opens between them
  const onSeam = (group) => new Set(group.tris.flat().filter((corner) => corner.p[0] === 32).map((corner) => corner.p.join()));
  const [a, b] = [onSeam(stone), onSeam(wood)];
  sure(a.size > 0 && a.size === b.size && [...a].every((key) => b.has(key)), `${[...a].sort()} | ${[...b].sort()}`);
  // every corner on its own run's bone, its normal dropped to be worked out again
  sure(stone.tris.flat().every((corner) => corner.node === 1 && corner.weights[0][0] === 1 && corner.n === null), "stone's corners");
  sure(wood.tris.flat().every((corner) => corner.node === 2 && corner.n === null), "wood's corners");
  sure(fewerTriangles(scene, 10000).imported === scene, "asked for more than it has, the scene as it was");
});
