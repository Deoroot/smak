// The builders of the make layer that give a hand-written map its forms (ARCHITECTURE 2.4): a sloped face wears its
// picture along the face by default, `turned` snaps to whole units, `frame` places a composition, `roof`, `dome` and
// `arcade`. Each case builds with the builder and checks the brushes; the picture of the form cases is
// drawn into a temp folder (the path is printed).
import { createHash } from "node:crypto";
import { test, sure, near, tmp } from "./helper.mjs";
import * as S from "../src/maps/source.mjs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { frame } from "../src/maps/frame.mjs";
import { roof, dome, arcade } from "../src/maps/forms.mjs";
import { checkPlan } from "../src/maps/plan.mjs";
import { drawSource } from "../src/maps/draw.mjs";
import { png } from "../src/image.mjs";
import { formOfBrushes } from "../src/form.mjs";


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

test("frame: a door's origin and angles after a 90-degree frame, its leaf turned and moved, a point mapped", () => {
  const leaf = S.box([40, -4, 0], [72, 4, 96], "DOOR");
  const door = S.brushEntity("func_door", [leaf], { origin: [56, 0, 48], angles: "0 30 0", angle: 90, targetname: "d1" });
  const lamp = S.pointEntity("light", [10, 20, 80], { _light: "255 255 255 200" });
  const f = frame({ at: [1000, 200, 16], yaw: 90 });
  const placed = f.place({ brushes: [S.box([0, 0, 0], [64, 16, 64], "WALL")], entities: [door, lamp] });
  const d = placed.entities[0];
  sure(d.origin === "1000 256 64", `door origin ${d.origin}`);
  sure(d.angles === "0 120 0", `door angles ${d.angles}`);
  sure(d.angle === "180", `door angle ${d.angle}`);
  sure(d.targetname === "d1" && d.classname === "func_door", "the other keys stay");
  const leafShape = S.shapeOf(d.brushes[0]);
  sure(leafShape.min.join() === "996,240,16" && leafShape.max.join() === "1004,272,112", `leaf ${leafShape.min} to ${leafShape.max}`);
  sure(placed.entities[1].origin === "980 210 96", `lamp origin ${placed.entities[1].origin}`);
  sure(f.point([10, 20, 80]).join() === "980,210,96", `point ${f.point([10, 20, 80])}`);
  const wall = S.shapeOf(placed.brushes[0]);
  sure(wall.min.join() === "984,200,16" && wall.max.join() === "1000,264,80", `wall ${wall.min} to ${wall.max}`);
  // an angle of -1 (up) and a yaw past 360 are left alone or wrapped
  const up = frame({ yaw: 300 }).place({ entities: [S.pointEntity("func_button", [0, 0, 0], { angle: -1, angles: "0 100 0" })] }).entities[0];
  sure(up.angle === "-1" && up.angles === "0 40 0", `${up.angle} / ${up.angles}`);
  // at another angle the building's corners are whole units and it keeps its volume
  const turned = frame({ at: [0, 0, 0], yaw: 37 }).place({ brushes: [S.box([0, 0, 0], [128, 96, 64], "WALL")] }).brushes[0];
  sure(S.offGrid(turned).length === 0 && S.shapeOf(turned).faults.length === 0, "a turned frame snaps");
});

const sound = (brushes, what) => {
  sure(brushes.length > 0, `${what}: no brushes`);
  for (const b of brushes) {
    const shape = S.shapeOf(b);
    sure(shape.faults.length === 0 && shape.volume > 0 && Number.isFinite(shape.volume), `${what}: ${shape.faults.join("; ")}`);
  }
};
const slopeFaces = (brush) => brush.faces.filter((f) => Math.max(...S.planeOf(f.points).normal.map(Math.abs)) < 0.99);

test("roof: gable, hip, shed and flat are sound convex solids over the outline, the slopes face-aligned", () => {
  const rect = [[0, 0], [256, 0], [256, 160], [0, 160]];
  for (const kind of ["gable", "hip", "shed", "flat"]) {
    for (const overhang of [0, 24, { eaves: 24, gable: 16 }]) {
      const brushes = roof(rect, { kind, overhang, z: 128, texture: "ROOF", pitch: 35 });
      sound(brushes, `${kind} ${JSON.stringify(overhang)}`);
      const reach = typeof overhang === "number" ? [overhang, overhang] : [overhang.eaves, overhang.gable];
      const min = [0, 1, 2].map((i) => Math.min(...brushes.map((b) => S.shapeOf(b).min[i])));
      const max = [0, 1, 2].map((i) => Math.max(...brushes.map((b) => S.shapeOf(b).max[i])));
      sure(min[0] <= -Math.min(...reach) + 1 && max[0] >= 256 + Math.min(...reach) - 1 && max[1] >= 160, `${kind}: the roof covers the outline: ${min} to ${max}`);
      if (kind !== "flat") for (const b of brushes) for (const f of slopeFaces(b)) {
        const n = S.planeOf(f.points).normal;
        near(dot(f.u.slice(0, 3), n), 0, 1e-6, `${kind}: a slope's u lies in the slope`);
      }
    }
  }
  // a gable's ridge is where the pitch puts it: 35 degrees over half of 160
  const ridge = Math.max(...roof(rect, { kind: "gable", z: 100, texture: "R" }).map((b) => S.shapeOf(b).max[2]));
  near(ridge, 100 + 80 * Math.tan((35 * Math.PI) / 180) + 8 / Math.cos((35 * Math.PI) / 180), 1, "the ridge's top");
  // turned outline: a roof over a rectangle at 30 degrees
  const f = frame({ at: [100, 100, 0], yaw: 30 });
  const turnedRect = [[0, 0], [256, 0], [256, 160], [0, 160]].map((p) => f.point([...p, 0]));
  sound(roof(turnedRect, { kind: "hip", z: 128, texture: "R" }), "a hip over a turned rectangle");
  sound(roof([[0, 0], [200, 0], [260, 90], [100, 160], [-40, 80]], { kind: "flat", texture: "R" }), "a flat roof over a pentagon");
  let said = "";
  try { roof([[0, 0], [200, 0], [260, 90], [100, 160]], { kind: "gable", texture: "R" }); } catch (e) { said = e.message; }
  sure(/rectangle/.test(said), `a gable over a quadrilateral that is no rectangle is refused in words: ${said}`);
  try { roof(rect, { kind: "dormer", texture: "R" }); said = ""; } catch (e) { said = e.message; }
  sure(/gable, hip, shed or flat/.test(said), "an unknown kind is refused");
});

test("dome and arcade: sound convex brushes, no face under 2 square units, the plan check's errors none", () => {
  const d = dome([0, 0, 0], 256, { texture: "DOME" });
  sure(d.length === 48, `4 rings of 12 tiles: ${d.length}`);
  sound(d, "dome");
  const eye = dome([0, 0, 0], 256, { texture: "DOME", open: 64, rings: 5, segments: 16 });
  sure(eye.length === 80, `5 rings of 16: ${eye.length}`);
  sound(eye, "dome with an eye");
  const top = Math.max(...eye.map((b) => S.shapeOf(b).max[2]));
  sure(top < 256 && top > 240, `the open dome stops under its crown, at the eye's rim: ${top}`);
  sure(S.shapeOf(eye[0]).min[2] === 0, "it stands on its centre's height");
  const a = arcade([0, 0, 0], [400, 0, 0], { bays: 3, texture: "ARCADE" });
  sound(a, "arcade");
  const turnedRow = arcade([0, 0, 0], [300, 300, 0], { bays: 4, texture: "ARCADE" });
  sound(turnedRow, "a turned arcade");
  const smallest = Math.min(...[...d, ...eye, ...a, ...turnedRow].flatMap((b) => S.shapeOf(b).faces.map((f) => f.area)));
  sure(smallest >= 2, `the smallest face of the dome and the arcades: ${smallest}`);
  // the opening under an arch is clear: a box of the bay's width and the springing's height meets no brush
  const bay = S.box([40, -10, 1], [100, 10, 60], "T");
  const hits = a.filter((b) => { const s = S.shapeOf(b); return s.min[0] < 100 && s.max[0] > 40 && s.min[2] < 60 && s.max[2] > 1 && s.min[1] < 10 && s.max[1] > -10; });
  sure(hits.length === 0, `${hits.length} brushes in the first opening`);
  let said = "";
  try { arcade([0, 0, 0], [100, 0, 0], { bays: 4, texture: "A" }); } catch (e) { said = e.message; }
  sure(/fewer bays/.test(said), `too many bays for the length: ${said}`);
  try { dome([0, 0, 0], 100, { texture: "D", open: 90 }); said = ""; } catch (e) { said = e.message; }
  sure(/eye/.test(said), "an eye wider than the inner radius is refused");
});

test("the make layer's forms drawn: a gable, a hip, a shed, a dome with an eye and two arcades; the plan check and the form measure", () => {
  const rooftex = (n) => (n[2] > 0.2 ? "ROOF" : "WALL");
  const world = [S.box([-600, -500, -8], [600, 600, 0], "FLOOR")];
  const house = (min, max, kind, pitch) => {
    world.push(S.box([min[0], min[1], 0], [max[0], max[1], 128], "WALL"));
    world.push(...roof([[min[0], min[1]], [max[0], min[1]], [max[0], max[1]], [min[0], max[1]]], { kind, pitch, overhang: 16, z: 128, texture: rooftex }));
  };
  house([200, -300], [456, -140], "gable", 35);
  house([200, -60], [456, 100], "hip", 30);
  house([-420, 200], [-100, 360], "shed", 12);
  world.push(S.cylinder("z", [-250, -200], 128, 0, 112, "WALL", { sides: 16, snap: 1 }), ...dome([-250, -200, 112], 128, { segments: 16, open: 40, texture: "DOME" }));
  world.push(...arcade([-380, 60, 0], [-80, 60, 0], { bays: 3, height: 112, texture: "ARCADE" }), ...arcade([40, 330, 0], [300, 470, 0], { bays: 3, height: 112, texture: "ARCADE" }));
  const map = { worldspawn: { wad: "x.wad" }, brushes: world, entities: [S.playerStart([0, -400, 0], 90), S.light([0, 0, 400], { brightness: 200 })] };
  const report = checkPlan(map, { leak: false });
  sure(report.errors.length === 0, `plan errors: ${report.errors.join("; ")}`);
  console.log(`      plan warnings: ${report.warnings.length ? report.warnings.join(" | ") : "none"}`);
  const form = formOfBrushes(world);
  sure(form.axisAligned < 0.9, `the share of the faces on the axes: ${form.axisAligned}`);
  const picture = drawSource(map, { from: [-150, -480, 330], yaw: 25, pitch: -22, width: 800, height: 520 });
  const file = join(tmp, "forms-make-layer.png");
  writeFileSync(file, png(picture.width, picture.height, picture.rgba));
  console.log(`      picture: ${file}`);
  writeFileSync(join(tmp, "forms-make-layer.map"), S.writeMap(map));
});
