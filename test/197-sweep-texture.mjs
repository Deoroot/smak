// A texture along a sweep (make/maps/profiles.mjs alongAxes, sweepProfile's and loftBrush's `along`) and the point hull
// (compileMap's `hulls`). On the .map's own faces: a curved strip, the texture coordinate of the edge two sections share
// is the same from both sides, and v advances by the arc length. With the compilers (VHLT_DIR), a room compiled both
// ways: hull 1 is open 2 units off a wall only with `hulls: "point"`.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../check/maps/index.mjs";
import { sweepProfile, loftBrush } from "../make/maps/profiles.mjs";
import { shapeOf } from "../make/maps/source.mjs";
import { compileMap, hullFileIn } from "../make/maps/compile.mjs";
import { contentsAt } from "../core/maps/bsp.mjs";
import { test, sure, tmp } from "./helper.mjs";

const ROAD = [[-48, -6], [48, -6], [48, 0], [-48, 0]]; // prettier-ignore
const R = 400;
const PATH = Array.from({ length: 9 }, (_, i) => [R * Math.sin(i * 0.18), R * (1 - Math.cos(i * 0.18)), i * 3]); // a bend climbing 3 a point
const arc = (i) => PATH.slice(1, i + 1).reduce((t, p, k) => t + Math.hypot(...p.map((v, c) => v - PATH[k][c])), 0);
/** The texture coordinate of a point on a face, as the compilers read it: (point . axis) / scale + offset. */
const coord = (face, axis, p) => (p[0] * face[axis][0] + p[1] * face[axis][1] + p[2] * face[axis][2]) / face.scale[axis === "u" ? 0 : 1] + face[axis][3];
const top = (brush) => {
  const shape = shapeOf(brush);
  const i = shape.faces.findIndex((f) => f.normal && f.normal[2] > 0.9);
  return { face: brush.faces[i], polygon: shape.faces[i].polygon };
};
const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1; // the sweep's rings meet to within a unit on a climbing bend (core/solids.mjs sweepRings)
const shared = (a, b) => a.polygon.filter((p) => b.polygon.some((q) => near(p, q)));
const mid = (ps) => [0, 1, 2].map((i) => ps.reduce((t, p) => t + p[i], 0) / ps.length);
/** The brushes as the .map holds them: written and read back. */
const viaMap = (brushes) => maps.readMap(maps.writeMap({ brushes })).brushes;

test("a curved sweep with `along`: the shared edge reads the same from both sections, v advances by the arc length", () => {
  const brushes = sweepProfile(ROAD, PATH, "ruts", { along: { start: 10 } });
  sure(brushes.length === PATH.length - 1, `${brushes.length} sections`);
  const read = viaMap(brushes);
  sure(read.length === brushes.length, `${read.length} brushes read back`);
  let worst = 0;
  for (let k = 0; k + 1 < read.length; k++) {
    const a = top(read[k]);
    const b = top(read[k + 1]);
    const edge = shared(a, b);
    sure(edge.length === 2, `sections ${k} and ${k + 1} share ${edge.length} corners`);
    const m = mid(edge);
    worst = Math.max(worst, Math.abs(coord(a.face, "v", m) - coord(b.face, "v", m)), Math.abs(coord(a.face, "u", m) - coord(b.face, "u", m)));
    sure(Math.abs(coord(a.face, "v", m) - (10 + arc(k + 1))) < 0.05, `v at the edge ${k + 1} is ${coord(a.face, "v", m)}, not ${10 + arc(k + 1)}`);
  }
  sure(worst < 0.05, `the shared edges differ by ${worst}`);
});

test("without `along` v is not the arc length, with `scale` it is in texels", () => {
  const read = viaMap(sweepProfile(ROAD, PATH, "ruts"));
  const at = (k) => mid(shared(top(read[k]), top(read[k + 1])));
  const jump = Math.max(...[0, 1, 2, 3].map((k) => Math.abs(coord(top(read[k]).face, "v", at(k)) - coord(top(read[k + 1]).face, "v", at(k))))); // prettier-ignore
  // the world's axes agree on a join, but the offset is not the arc length: v at the second ring is not the path's length
  sure(Math.abs(coord(top(read[1]).face, "v", at(1)) - arc(2)) > 1, `without along v happens to be the arc length (${jump})`);
  const scaled = viaMap(sweepProfile(ROAD, PATH, "ruts", { along: { scale: 2 } }));
  const a = top(scaled[0]);
  const b = top(scaled[1]);
  const m = mid(shared(a, b));
  sure(a.face.scale.join() === "2,2" && Math.abs(coord(a.face, "v", m) - arc(1) / 2) < 0.05 && Math.abs(coord(b.face, "v", m) - arc(1) / 2) < 0.05, `scale 2: v ${coord(a.face, "v", m)}`); // prettier-ignore
});

test("the shoulder and bank faces follow the path too: every long face is worth the arc length on its shared edge", () => {
  const BANK = [[-48, 0], [48, 0], [80, -20], [-80, -20]]; // prettier-ignore
  const read = viaMap(sweepProfile(BANK, PATH, "ruts", { along: true }));
  for (let k = 0; k + 1 < read.length; k++) {
    const a = shapeOf(read[k]);
    const b = shapeOf(read[k + 1]);
    let faces = 0;
    a.faces.forEach((fa, i) =>
      b.faces.forEach((fb, j) => {
        if (!fa.normal || !fb.normal || fa.normal[0] * fb.normal[0] + fa.normal[1] * fb.normal[1] + fa.normal[2] * fb.normal[2] < 0.95) return;
        const edge = fa.polygon.filter((p) => fb.polygon.some((q) => near(p, q)));
        if (edge.length !== 2) return;
        faces++;
        const m = mid(edge);
        sure(Math.abs(coord(read[k].faces[i], "v", m) - coord(read[k + 1].faces[j], "v", m)) < 0.05, `section ${k} face ${i}`);
      }),
    );
    sure(faces >= 3, `section ${k}: ${faces} faces meet the next`);
  }
});

test("loftBrush's `along`: v is the two arc lengths on the two rings", () => {
  const ring = (z, r) => [[-r, -r, z], [r, -r, z], [r, r, z], [-r, r, z]]; // prettier-ignore
  const brush = loftBrush(ring(0, 20), ring(40, 30), "post", { along: { from: 100, to: 140 } });
  const shape = shapeOf(brush);
  const t = shape.faces.findIndex((f) => f.normal && f.normal[0] > 0.9);
  const lowEdge = mid(shape.faces[t].polygon.filter((q) => Math.abs(q[2]) < 1e-6));
  const highEdge = mid(shape.faces[t].polygon.filter((q) => Math.abs(q[2] - 40) < 1e-6));
  const side = brush.faces[t];
  sure(Math.abs(coord(side, "v", lowEdge) - 100) < 1e-6 && Math.abs(coord(side, "v", highEdge) - 140) < 1e-6, `${coord(side, "v", lowEdge)} to ${coord(side, "v", highEdge)}`);
});

test("compileMap's `hulls`: the file written (three lines), and a bad value refused in words", () => {
  const point = readFileSync(hullFileIn(tmp, "point"), "utf8");
  sure(point === "0 0 0 0 0 0\n0 0 0 0 0 0\n0 0 0 0 0 0\n", JSON.stringify(point));
  const sizes = [[[-16, -16, -36], [16, 16, 36]], [[-32, -32, -32], [32, 32, 32]], [[-16, -16, -18], [16, 16, 18]]]; // prettier-ignore
  sure(readFileSync(hullFileIn(tmp, sizes), "utf8").split("\n")[1] === "-32 -32 -32 32 32 32", "the sizes");
  const file = join(tmp, "x.map");
  writeFileSync(file, "");
  const bad = compileMap(file, { hulls: "small", compilers: { found: true, tools: {} } });
  sure(/hulls is "point" or three \[mins, maxs\] pairs/.test(bad.errors[0]), bad.errors.join());
});

const compilers = process.env[maps.COMPILERS_VARIABLE] ? maps.findCompilers() : { found: false };
if (!compilers.found) console.log(`skip  a room compiled with the standard hulls and with point hulls\n      skipped: no compilers (name the folder of VHLT in ${maps.COMPILERS_VARIABLE} to run it)`); // prettier-ignore
else
  test('compiled both ways: hull 1 is open 2 units off a wall only with `hulls: "point"`', () => {
    const folder = join(tmp, "point-hull");
    mkdirSync(folder, { recursive: true });
    const wad = join(folder, "hull.wad");
    writeFileSync(wad, maps.writeWad([{ name: "WALL", image: { width: 16, height: 16, rgb: new Uint8Array(16 * 16 * 3).fill(120) } }]));
    const file = join(folder, "room.map");
    writeFileSync(file, maps.writeMap({ worldspawn: { wad: [wad] }, brushes: maps.hollow([0, 0, 0], [512, 256, 256], 32, "WALL"), entities: [maps.playerStart([256, 128, 40], 0), maps.light([256, 128, 200], { brightness: 300 })] })); // prettier-ignore
    const open = {};
    for (const [name, hulls] of [["standard", undefined], ["point", "point"]]) {
      const made = compileMap(file, { fast: true, vis: false, light: false, compilers, wads: [wad], engine: "xash", out: join(folder, `${name}.bsp`), hulls });
      sure(made.bsp, made.errors.join("; "));
      const bsp = maps.readBsp(readFileSync(made.bsp));
      open[name] = contentsAt(bsp, [2, 128, 100], { hull: 1 }) !== -2; // 2 units off the inside of the west wall (x 0)
      sure(contentsAt(bsp, [256, 128, 100], { hull: 1 }) !== -2, `${name}: hull 1 open in the middle`);
    }
    sure(open.standard === false && open.point === true, `standard ${open.standard}, point ${open.point}`);
  });
