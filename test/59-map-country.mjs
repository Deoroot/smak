// The country of an outdoor map: cliffs that lean along its rock (pieces.mjs `cliffWall`, the sketch's `cliff`
// key), ground that rises and falls (relief.mjs) and a path worn into it (trail.mjs).
import * as maps from "../check/maps/index.mjs";
import { test, sure } from "./helper.mjs";

test("cliffWall: leaning pieces along the line, none under the top, uneven tops, feet kept off the clear boxes", () => {
  const line = {
    from: [0, 0],
    to: [1200, 0],
    bottom: 0,
    top: 160,
    rise: 160,
    foot: 96,
    seed: 3,
    texture: "rock",
  };
  const brushes = maps.cliffWall(line);
  sure(brushes.length >= 10, `pieces along 1200 units (${brushes.length})`);
  const points = (brush) => brush.faces.flatMap((face) => face.points);
  // every piece stands to the LEFT of the line (+y here) and reaches the top at least where it meets the line
  sure(
    brushes.every((brush) => points(brush).every((p) => p[1] >= -0.5)),
    "every piece on the space's side",
  );
  // the faces (a scree at a foot is low, and stands off the line)
  const faces = brushes.filter((brush) => points(brush).some((p) => Math.abs(p[1]) < 1 && p[2] > 0));
  const tops = faces.map((brush) => Math.max(...points(brush).map((p) => p[2])));
  // the skyline along the line: at every place the rock stands to the top (160) at least, hiding a plumb wall
  const skyline = [];
  for (let u = 40; u <= 1160; u += 40) {
    const here = faces.filter((brush) => { const xs = points(brush).map((p) => p[0]); return Math.min(...xs) <= u && Math.max(...xs) >= u; }); // prettier-ignore
    skyline.push(Math.max(...here.map((brush) => Math.max(...points(brush).map((p) => p[2])))));
  }
  sure(Math.min(...skyline) >= 160, `the rock stands to its top all along (lowest ${Math.min(...skyline)})`);
  sure(
    new Set(tops.map((z) => Math.round(z / 16))).size >= 4,
    `the skyline is not one line (${[...new Set(tops)].length} heights)`,
  );
  // a face that leans: points of one piece out from the line at the foot and near it at the top
  const leans = brushes.filter((brush) => {
    const ps = points(brush);
    const foot = Math.max(...ps.filter((p) => p[2] <= 0).map((p) => p[1]));
    const high = Math.max(...ps.filter((p) => p[2] >= 150).map((p) => p[1]), 0);
    return foot > high + 10;
  });
  sure(leans.length >= brushes.length / 3, "the faces lean back");
  // a house by the wall: no foot comes into its box
  const clear = [{ min: [400, 20], max: [700, 400] }];
  const kept = maps.cliffWall({ ...line, clear });
  const inside = kept.filter((brush) =>
    points(brush).some((p) => p[2] <= 0 && p[0] > 400 && p[0] < 700 && p[1] > 20),
  );
  sure(inside.length === 0, "the feet keep out of the clear box");
  // a sketch's `cliff` key makes them along its rock, not along the edge where it opens into another space
  const yard = {
    outline: [
      [0, 0],
      [1000, 0],
      [1000, 800],
      [0, 800],
    ],
    floor: 0,
    ceiling: 600,
    horizon: 160,
    name: "yard",
  };
  const lane = {
    outline: [
      [1000, 300],
      [1400, 300],
      [1400, 500],
      [1000, 500],
    ],
    floor: 0,
    ceiling: 600,
    horizon: 160,
    name: "lane",
  };
  const sketch = { spaces: [maps.planSpace(yard), maps.planSpace(lane)] };
  sketch.spaces[0].cliff = { rise: 120, foot: 80, seed: 1 };
  const made = maps.sketchMap(sketch, { texture: "rock" });
  const cliffs = made.entities
    .filter((each) => each.classname === "func_detail")
    .flatMap((each) => each.brushes);
  sure(cliffs.length > 8, "the yard has cliffs");
  const mouth = cliffs.filter((brush) =>
    points(brush).some((p) => p[0] > 990 && p[1] > 310 && p[1] < 490 && p[2] < 100),
  );
  sure(mouth.length === 0, "none across the lane's mouth");
});

test("reliefOf: hummocks and banks over a space, level where it opens, walkable", () => {
  const meadow = maps.planSpace({
    outline: [
      [0, 0],
      [1600, 0],
      [1600, 1200],
      [0, 1200],
    ],
    floor: 0,
    ceiling: 600,
    name: "meadow",
  });
  const lane = maps.planSpace(
    {
      outline: [
        [1600, 500],
        [2200, 500],
        [2200, 700],
        [1600, 700],
      ],
      floor: 0,
      ceiling: 600,
      name: "lane",
    },
    1,
  );
  const sides = [
    { from: [0, 0], to: [1600, 0] },
    { from: [0, 1200], to: [0, 0] },
  ];
  const made = maps.reliefOf({
    space: meadow,
    others: [lane],
    sides,
    amp: 24,
    bank: 48,
    texture: "grass",
    seed: 2,
  });
  sure(made.brushes.length > 50, `a field of triangles (${made.brushes.length})`);
  sure(made.steep === 0, "none steeper than a player walks");
  // the bank stands up by the rock, the ground is level where the lane comes in
  sure(
    made.heightAt(800, 20) > made.heightAt(800, 600) + 10,
    `a bank by the rock (${made.heightAt(800, 20)} by it, ${made.heightAt(800, 600)} in the middle)`,
  );
  sure(
    made.heightAt(1590, 600) <= 8,
    `level at the lane's mouth, under a step (${made.heightAt(1590, 600)})`,
  );
});

test(":reliefOf patches, trail:: painted ground, a path along a line", () => {
  const meadow = maps.planSpace({
    outline: [
      [0, 0],
      [1600, 0],
      [1600, 1200],
      [0, 1200],
    ],
    floor: 0,
    ceiling: 600,
    name: "meadow",
  });
  const sides = [{ from: [0, 0], to: [1600, 0] }];
  // patches: about the share asked of the triangles wear the other ground, and stand over the floor to wear it
  const made = maps.reliefOf({ space: meadow, sides, amp: 0, bank: 0, texture: "grass", patches: [{ texture: "earth", share: 0.2 }], seed: 2 }); // prettier-ignore
  const tops = made.brushes.map((brush) => brush.faces.find((face) => face.points.every((p) => p[2] > -1)));
  const earth = tops.filter((face) => face?.texture === "earth");
  sure(
    made.painted > 0 && Math.abs(made.painted / ((1600 / 96) * (1200 / 96) * 2) - 0.2) < 0.08,
    `a fifth painted (${made.painted})`,
  );
  sure(earth.length === made.painted, `each painted triangle a brush wearing it on top (${earth.length})`);
  sure(
    earth.every((face) => face.points.some((p) => p[2] >= 2)),
    "lifted over the floor",
  );
  // a trail: its middle over the ground, its edges under it, its picture's columns across the way it runs
  const way = maps.trail({ points: [[100, 600], [800, 600], [1500, 900]], width: 192, groundAt: () => 10, texture: { name: "path", size: [256, 256] } }); // prettier-ignore
  sure(way.brushes.length > 40, `a ribbon (${way.brushes.length} pieces)`);
  const zs = way.brushes.flatMap((brush) => brush.faces.flatMap((face) => face.points.map((p) => p[2])));
  sure(Math.max(...zs) === 13 && zs.includes(8), "its middle 3 over the ground, its edges 2 under");
  const first = way.brushes[0].faces.find((face) => face.texture === "path");
  sure(
    Math.abs(first.u[1]) > 0.99 && Math.abs(first.scale[0] - 0.75) < 1e-6,
    `the columns run across a path going east (u ${first.u.slice(0, 3)})`,
  );
  // the corners cut: the line through the middle bends smoothly (no two pieces turn by more than 25 degrees)
  const turns = way.along.slice(2).map((p, i) => { const [a, b] = [way.along[i], way.along[i + 1]]; const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]), t2 = Math.atan2(p[1] - b[1], p[0] - b[0]); return Math.abs(t2 - t1) * 57.3; }); // prettier-ignore
  sure(Math.max(...turns) < 25, `smooth bends (${Math.max(...turns).toFixed(1)} degrees)`);
});

test("brokenWall on a slant: its sloped tops stay in one plane", () => {
  // a slanted broken wall's sloped tops stay in one plane (its corners were once rounded alone)
  sure(
    maps.brokenWall({
      from: [-201, 71],
      to: [-136, -108],
      thick: 16,
      bottom: -8,
      top: 166,
      low: 32,
      pieces: 3,
      seed: 7,
      texture: "s",
    }).length === 3,
    "a slanted wall",
  );
});

