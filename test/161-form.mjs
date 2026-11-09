// Form (src/form.mjs, src/solids.mjs lathe/sweepTris, src/maps/profiles.mjs, box's bevel): a pile of boxes measured
// against a round thing, the tools that make the round thing, and the limits that keep a brush the compilers take.
import { test, sure } from "./helper.mjs";
import * as smak from "../src/index.mjs";
import * as maps from "../src/maps/index.mjs";

const S = smak.solids;
const FLOOR = S.place([0, 0, 0], [0, 0, 1], [1, 0, 0]);
const points = (tris) => tris.map((t) => t.map((c) => c.p));

test("form: a cube is all axes, all bare edges, four corners; a turned post is none of those", () => {
  const cube = smak.formOfTriangles(points(S.trisOf(S.box(FLOOR, 20, 20, 20))));
  sure(cube.measures.axisAligned === 1 && cube.measures.sharpEdges === 1, JSON.stringify(cube.measures));
  sure(cube.measures.outline === 4 && cube.measures.boxiness > 0.95, JSON.stringify(cube.measures));
  const post = smak.formOfTriangles(points(S.trisOf(S.lathe(FLOOR, [[6, 0], [6, 3], [3, 8], [2.5, 40], [4, 46]], { n: 12 }))));
  sure(post.measures.axisAligned < 0.35 && post.measures.sharpEdges < 0.5 && post.measures.boxiness < 0.5, JSON.stringify(post.measures));
});

test("form: a chamfer takes the sharp edges off a box (45 degrees each), and the form is less boxy", () => {
  const plain = smak.formOfTriangles(points(S.trisOf(S.box(FLOOR, 30, 20, 20)))).measures;
  const cut = smak.formOfTriangles(points(S.trisOf(S.box(FLOOR, 30, 20, 20, { bevel: 3, bevelFoot: 3, cut: 3 })))).measures;
  sure(cut.sharpEdges < plain.sharpEdges && cut.axisAligned < plain.axisAligned, `${JSON.stringify(plain)} ${JSON.stringify(cut)}`);
});

test("sweepTris and lathe: a concave profile along a bent path is a closed surface facing out", () => {
  const L = [[0, 0], [10, 0], [10, 3], [3, 3], [3, 10], [0, 10]];
  for (const [path, opts] of [[[[0, 0, 0], [50, 0, 0]], {}], [[[0, 0, 0], [50, 0, 0], [50, 40, 0]], {}], [[[0, 0, 0], [50, 0, 0], [50, 40, 0], [0, 40, 0]], { closed: true }]]) {
    const tris = S.sweepTris(L, path, opts);
    const shut = S.closed(tris);
    sure(shut.closed, `${path.length} points: ${JSON.stringify(shut)}`);
  }
  sure(S.closed(S.trisOf(S.lathe(FLOOR, [[4, 0], [5, 4], [2, 9]]))).closed, "a lathe is closed");
});

test("map box: a bevel gives a convex brush the compilers take, on the edges asked for", () => {
  const counts = { all: 18, vertical: 10, top: 10, "top+vertical": 14, bottom: 10 };
  for (const [edges, faces] of Object.entries(counts)) {
    const brush = maps.box([0, 0, 0], [64, 32, 48], "T", { bevel: 4, edges });
    const shape = maps.shapeOf(brush);
    sure(!shape.faults.length && brush.faces.length === faces, `${edges}: ${brush.faces.length} faces, ${shape.faults.join("; ")}`);
    sure(maps.brushFaults(brush).length === 0, `${edges}: ${maps.brushFaults(brush)[0]}`);
    sure(maps.offGrid(brush).length === 0, `${edges} is off the grid with a whole bevel`);
  }
  let said = "";
  try { maps.box([0, 0, 0], [64, 32, 48], "T", { bevel: 20 }); } catch (e) { said = e.message; }
  sure(/a bevel is 1 to 14.4/.test(said), said);
});

test("map profiles: an L is two convex brushes, a sweep follows the path, a rounded box is one brush", () => {
  const L = [[0, 0], [24, 0], [24, 8], [8, 8], [8, 24], [0, 24]];
  sure(maps.convexParts(L).length === 2, "an L is two convex parts");
  sure(maps.convexParts([[0, 0], [8, 0], [8, 8], [0, 8]]).length === 1, "a square is one");
  const made = maps.extrudeProfile(L, 0, 40, "T", { axis: "x" });
  sure(made.length === 2 && made.every((b) => !maps.shapeOf(b).faults.length), "extruded L");
  const swept = maps.sweepProfile(L, [[0, 0, 0], [64, 0, 0], [64, 64, 0]], "T");
  sure(swept.length === 4 && swept.every((b) => !maps.brushFaults(b).length), `swept: ${swept.length}`);
  const line = maps.extrudeProfile(L, [0, 0, 0], [30, 30, 10], "T");
  sure(line.length === 2 && line.every((b) => !maps.brushFaults(b).length), "along a slanted line");
  const round = maps.roundedBox([0, 0, 0], [40, 40, 30], "T", { radius: 8, steps: 3, snap: 1 });
  sure(round.faces.length >= 12 && round.faces.length <= 4 * 4 + 2 && !maps.brushFaults(round).length && maps.offGrid(round).length === 0, `${round.faces.length} faces`);
  const ring = [[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0]];
  sure(!maps.shapeOf(maps.loftBrush(ring, ring.map(([x, y]) => [x * 0.5 + 5, y * 0.5 + 5, 30]), "T")).faults.length, "a tapering post");
});

test("map profiles: the limits are said in words", () => {
  const tiny = [[0, 0], [2, 0], [2, 1], [0, 1]];
  let said = "";
  try { maps.extrudeProfile(tiny, 0, 2, "T"); } catch (e) { said = e.message; }
  sure(/microface|under/.test(said), said);
  try { maps.roundedBox([0, 0, 0], [10, 10, 10], "T", { radius: 8 }); said = ""; } catch (e) { said = e.message; }
  sure(/the radius is 1 to 5/.test(said), said);
});

test("form of a map's source: bare boxes against a profile, and the judgement of them", () => {
  const boxes = [0, 1, 2, 3].map((i) => maps.box([i * 40, 0, 0], [i * 40 + 30, 20, 16], "T"));
  const cut = [0, 1, 2, 3].map((i) => maps.box([i * 40, 0, 0], [i * 40 + 30, 20, 16], "T", { bevel: 3 }));
  const source = (list) => ({ brushes: [], entities: [{ classname: "func_detail", brushes: list }] });
  const a = smak.formOfSource(source(boxes));
  const b = smak.formOfSource(source(cut));
  sure(a.measures.bareBoxes === 1 && b.measures.bareBoxes === 0, JSON.stringify([a.measures, b.measures]));
  sure(maps.judgeSourceForm(source(boxes)).length === 2 && maps.judgeSourceForm(source(cut)).length === 0, "judged");
});

test("check: a model that is one cube is warned of its form, a turned one is not; the kind comes from the name", () => {
  const tex = { name: "a.bmp", width: 16, height: 16, pixels: new Uint8Array(256), palette: new Uint8Array(768).fill(120), flags: 0 };
  const build = (solid, name) =>
    smak.buildMdl({
      name,
      bones: [{ name: "root", parent: -1, pos: [0, 0, 0] }],
      bodyparts: [{ name: "body", models: [{ name: "m", meshes: [{ texture: tex, tris: S.trisOf(solid).map((t) => t.map(({ p, k }) => ({ p, uv: [k % 2 ? 15 : 0, k % 3 ? 15 : 0], bone: "root" }))) }] }] }],
      sequences: [{ name: "idle", fps: 10, loops: true, frames: [[[0, 0, 0, 0, 0, 0]]] }],
    });
  const cube = smak.check(build(S.box(FLOOR, 20, 20, 20), "cube.mdl"), "goldsrc", { name: "crate.mdl" });
  sure(cube.warnings.some((w) => /^form: boxiness/.test(w)), cube.warnings.join(" | "));
  sure(cube.facts.some((f) => /^form: 100% of the surface on the axes/.test(f)), "the fact");
  const off = smak.check(build(S.box(FLOOR, 20, 20, 20), "cube.mdl"), "goldsrc", { kind: false });
  sure(!off.warnings.some((w) => /^form:/.test(w)), "kind false: no form");
  const post = smak.check(build(S.lathe(FLOOR, [[6, 0], [6, 3], [3, 8], [2.5, 40], [4, 46]], { n: 12 }), "post.mdl"), "goldsrc");
  sure(!post.warnings.some((w) => /^form:/.test(w)), post.warnings.join(" | "));
  sure(smak.kindOfName("metro_train.mdl") === "vehicles" && smak.kindOfName("crate.mdl") === "props", "kindOfName");
});
