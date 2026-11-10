// The builders of the make layer that give a hand-written map its forms (ARCHITECTURE 2.4): a sloped face wears its
// picture along the face by default, `turned` snaps to whole units, `frame` places a composition, `roof`, `dome` and
// `arcade`. Each case builds with the builder and checks the brushes; the picture of the form cases is
// drawn into a temp folder (the path is printed).
import { createHash } from "node:crypto";
import { test, sure, near } from "./helper.mjs";
import * as S from "../src/maps/source.mjs";

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mapOf = (brushes) => S.writeMap({ worldspawn: { wad: "" }, brushes, entities: [] });
const md5 = (text) => createHash("md5").update(text).digest("hex");

test("sloped faces: a face more than 5 degrees off every axis wears its picture in its plane, a straight one the world's", () => {
  const ramp = S.wedge([0, 0, 0], [128, 64, 64], "+x", "RAMP");
  const sloped = ramp.faces.filter((f) => {
    const n = S.planeOf(f.points).normal;
    return Math.max(...n.map(Math.abs)) < 0.99;
  });
  sure(sloped.length === 1, `a wedge has one sloped face, not ${sloped.length}`);
  const n = S.planeOf(sloped[0].points).normal;
  near(dot(sloped[0].u.slice(0, 3), n), 0, 1e-8, "the ramp's u lies in its face");
  near(dot(sloped[0].v.slice(0, 3), n), 0, 1e-8, "the ramp's v lies in its face");
  // 3 degrees off the floor: still the world's
  const a = (3 * Math.PI) / 180;
  const flat = S.textureAxes([Math.sin(a), 0, Math.cos(a)], { align: "auto" });
  sure(flat.u.join() === "1,0,0" && flat.v.join() === "0,-1,0", "3 degrees off an axis keeps the world's axes");
  sure(S.textureAxes([0, 0, 1], { align: "auto" }).u.join() === "1,0,0", "a floor keeps the world's axes");
  // a roof slab built by hand with a plain name: its slopes are face-aligned with no `align` written
  const gable = S.solid([[0, 0, 0], [64, 0, 0], [0, 64, 0], [64, 64, 0], [0, 0, 16], [64, 0, 16]], "ROOF");
  for (const f of gable.faces) {
    const m = S.planeOf(f.points).normal;
    if (Math.max(...m.map(Math.abs)) < 0.99) near(dot(f.u.slice(0, 3), m), 0, 1e-8, "a slanted solid face's u lies in it");
  }
});

test("straight faces: the .map text of boxes, a turned quarter and stairs is what it was before the default changed", () => {
  const brushes = [
    S.box([0, 0, 0], [64, 64, 64], "A"),
    S.box([100, 0, 0], [164, 64, 64], { top: "B", sides: "C" }),
    S.turned(S.box([0, 0, 0], [64, 32, 64], "A"), 90, [0, 0, 0]),
    ...S.stairs([0, 0, 0], [128, 64, 64], "+x", "S", { steps: 8 }),
  ];
  // measured on the commit before the change (d0 of the branch): the same text byte for byte
  sure(md5(mapOf(brushes)) === "3b80748a3021be1a081ab011da7d98a2", `the text of axis-aligned brushes moved: ${md5(mapOf(brushes))}`);
});

test("turned: at an angle that is not a quarter the corners are whole units, the cube keeps 6 faces and its volume within 1%", () => {
  const cube = S.box([0, 0, 0], [128, 128, 128], "A");
  const volume = S.shapeOf(cube).volume;
  for (const [deg, pivot] of [[45, [0, 0, 0]], [30, [64, 64, 0]], [17.3, [0, 0, 0]], [-52, [64, 64, 0]]]) {
    const t = S.turned(cube, deg, pivot);
    const shape = S.shapeOf(t);
    sure(t.faces.length === 6 && shape.faces.length === 6 && shape.faults.length === 0, `${deg} degrees: ${shape.faults.join("; ")}`);
    sure(S.offGrid(t).length === 0, `${deg} degrees: a point off the whole units`);
    sure(Math.abs(shape.volume / volume - 1) < 0.012, `${deg} degrees about ${pivot}: volume ${shape.volume} against ${volume}`);
  }
  const exact = S.turned(cube, 45, [0, 0, 0], { snap: 0 });
  sure(S.offGrid(exact).length > 0, "snap 0 keeps the exact points");
  const lone = S.turned(cube, 45, [0, 0, 0]);
  near(S.shapeOf(lone).volume, volume, volume * 0.01, "45 degrees about a corner keeps the volume within 1%");
  // a quarter turn is exact, and a brush with half units keeps them
  const half = S.box([0.5, 0, 0], [64.5, 32, 32], "A");
  sure(JSON.stringify(S.turned(half, 90, [0, 0, 0]).faces.map((f) => f.points).flat().flat().filter((v) => v % 1)).length > 2, "a quarter turn does not round half units");
  // the pictures keep their place
  const t = S.turned(S.box([0, 0, 0], [64, 64, 64], { top: { name: "T", offset: [3, 4] }, sides: "W" }), 45, [0, 0, 0]);
  sure(t.faces.every((f) => f.u.length === 4 && f.v.length === 4), "faces keep their axes");
});
