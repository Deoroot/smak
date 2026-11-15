// A picture fitted to a brush, as a mapper fits one by hand: on each face its corner on the face's corner, one
// picture across when asked (a sign, a vault's door), words that read on every side, the rest of a box left alone.
import * as smak from "../src/index.mjs";
import { test, sure } from "./helper.mjs";

const { box, fitted, writeMap, readMap } = smak.maps;
/** The texel [s, t] a face of a brush puts at a point, from its axes and offsets as the compiler reads them. */
const texel = (face, p) => [0, 1].map((k) => {
  const axis = k ? face.v : face.u;
  return (p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2]) / face.scale[k] + axis[3];
});
const normalOf = (face) => {
  const [a, b, c] = face.points;
  const u = a.map((v, i) => v - b[i]);
  const w = c.map((v, i) => v - b[i]);
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const l = Math.hypot(...n);
  return n.map((v) => Math.round(v / l));
};
const near = (a, b) => Math.abs(a - b) < 1e-6;

test("fitted: one picture across each face of a sign, its top left at the face's top left as seen, on every side", () => {
  const min = [100, 200, 40];
  const max = [292, 216, 72];
  const brush = box(min, max, fitted("SIGN", [128, 32], min, max, { whole: true, readable: true }));
  for (const face of brush.faces) {
    const n = normalOf(face);
    if (n[2]) continue;
    // as seen from outside: right = view direction x up
    const right = [-n[1], n[0], 0];
    const corners = [[min[0], min[1]], [max[0], min[1]], [min[0], max[1]], [max[0], max[1]]].filter(([x, y]) => (n[0] ? (n[0] > 0 ? x === max[0] : x === min[0]) : n[1] > 0 ? y === max[1] : y === min[1]));
    // the corner seen top left: least along `right`, at the top
    const [tl] = corners.sort((p, q) => p[0] * right[0] + p[1] * right[1] - (q[0] * right[0] + q[1] * right[1]));
    const [br] = corners.slice(-1);
    const st = texel(face, [tl[0], tl[1], max[2]]);
    const end = texel(face, [br[0], br[1], min[2]]);
    sure(near(st[0], 0) && near(st[1], 0), `${n}: top left at ${st}`);
    sure(near(end[0], 128) && near(end[1], 32), `${n}: bottom right at ${end}`);
  }
  // the floor and ceiling: top to the north, left to the west
  const top = brush.faces.find((f) => normalOf(f)[2] === 1);
  const nw = texel(top, [min[0], max[1], max[2]]);
  sure(near(nw[0], 0) && near(nw[1], 0), `top: ${nw}`);
});

test("fitted: tiling at a scale, anchored on the brush; repeats; faces chosen, the rest as told; written and read back", () => {
  const min = [8, 8, 0];
  const max = [264, 24, 48];
  const band = fitted("TRIM", [64, 16], min, max, { whole: "v" });
  // across, a texel a unit from its corner; up, one picture over the 48
  const south = box(min, max, band).faces.find((f) => normalOf(f)[1] === -1);
  sure(near(texel(south, [8, 8, 48])[0], 0) && near(texel(south, [72, 8, 48])[0], 64), JSON.stringify(south));
  sure(near(texel(south, [8, 8, 0])[1], 16), JSON.stringify(texel(south, [8, 8, 0])));
  const three = fitted("TRIM", [64, 16], min, max, { repeat: [4, 3] }).south;
  sure(near(three.scale[0], 1) && near(three.scale[1], 1), JSON.stringify(three));
  const some = fitted("SIGN", [64, 16], min, max, { whole: true, faces: ["south"], rest: "WALL" });
  sure(some.north === "WALL" && some.top === "WALL" && some.south.name === "SIGN", JSON.stringify(some));
  // a chamfered plate: the picture on its one face, `rest` on the chamfers (an east sign took both vertical ones)
  const plate = [[0, 0, 0], [4, 64, 32]], east = fitted("SIGN", [64, 32], ...plate, { whole: true, faces: ["east"], rest: "WALL" });
  const worn = box(...plate, east, { bevel: 1, edges: "all" }).faces.filter((f) => f.texture === "SIGN");
  sure(worn.length === 1 && normalOf(worn[0])[0] === 1, `${worn.length} faces wear the sign`);
  // by direction with no `slanted`, the tie rule stands: the vertical chamfers of an east face go east
  sure(box(...plate, { east: "SIGN", sides: "WALL" }, { bevel: 1, edges: "vertical" }).faces.filter((f) => f.texture === "SIGN").length === 3);
  // a flipped face is a negative scale, and the .map keeps it
  const flipped = fitted("SIGN", [64, 16], min, max, { whole: true, readable: true }).north;
  sure(flipped.scale[0] < 0, JSON.stringify(flipped));
  // readable unless told: a sign fitted to a north face does not read backwards (Meridian's RECORDS did)
  sure(fitted("SIGN", [64, 16], min, max, { whole: true }).north.scale[0] < 0);
  sure(fitted("SIGN", [64, 16], min, max, { whole: true, readable: false }).north.scale[0] > 0);
  const back = readMap(writeMap({ brushes: [box(min, max, fitted("SIGN", [64, 16], min, max, { whole: true, readable: true }))] }));
  const read = back.brushes[0].faces.find((f) => normalOf(f)[1] === 1);
  sure(read.scale[0] < 0 && near(texel(read, [264, 24, 48])[0], 0), JSON.stringify(read));
  let refused = "";
  try {
    fitted("X", [64], min, max);
  } catch (e) {
    refused = e.message;
  }
  sure(/\[width, height\]/.test(refused), refused);
});
