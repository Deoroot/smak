// Example 1: a model made from nothing. A banded wooden crate with a lid that opens, written as a .mdl,
// checked and drawn. It needs no game files:
//
//   node examples/01-new-model.mjs [output folder, default out]
//
// It writes crate.mdl (the model), crate_sheet.png (six views of the crate, lid open) and
// crate_open.png (four moments of the lid opening) into the output folder.
//
// The pattern is the one every new model follows:
//   1. a sheet to paint the texture on and a shape to build the triangles with (make/workshop.mjs)
//   2. the picture cut to 256 colours (indexed)
//   3. buildMdl: bones, bodyparts, animations
//   4. check, then look at it (sheet, strip) before it goes near a game
//
// Words used below. A "zone" is a rectangle of the texture: { x, y, w, h } in pixels. Inside a painter,
// `u` and `v` are the pixel's place in its zone, and a colour is [r, g, b] from 0 to 1.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildMdl, indexed, check, sheet, strip, png, workshop } from "../src/index.mjs";

const OUT = process.argv[2] ?? "out";
try {
  mkdirSync(OUT, { recursive: true });
} catch (error) {
  // a file of that name is in the way, or the place cannot be written to
  console.error(`the output folder ${OUT} cannot be made (${error.code})`);
  process.exit(1);
}
// the workshop's paints (wood, iron), a rivet's light and shadow, and two helpers: `times` makes a colour
// brighter or darker, `bell` is 1 at 0 and falls off to nothing about `width` away
const { wood, iron, rivet, times, bell } = workshop;

// ── the picture: 128x64, a plank face on the left, the banded edge of the lid at the top right ──
// (the rest of the right half stays empty: nothing wears it. A texture's sides are powers of two, so there
// is often room left over.)
const canvas = workshop.sheet(128, 64);
const mesh = workshop.shape(128, 64);
const FACE = { x: 0, y: 0, w: 64, h: 64 };
const RIM = { x: 64, y: 0, w: 64, h: 16 };
canvas.zone(
  FACE,
  (u, v) => {
    // four planks, darker in the gaps between them, an iron band round the edge with a rivet in each corner
    const plank = Math.floor(v / 16);
    const gap = bell((v % 16) - 0.5, 1.2);
    const fromEdge = Math.min(u, v, 63 - u, 63 - v);
    let colour = times(wood(u / 6, v / 6 + plank * 3, 1, 7 + plank), 1 - 0.55 * gap);
    if (fromEdge < 7) colour = iron(u / 8, v / 8, 1.1 - 0.25 * bell(fromEdge - 6.5, 1), 3);
    for (const [centreX, centreY] of [
      [4, 4],
      [59, 4],
      [4, 59],
      [59, 59],
    ]) {
      // on the rivet's head: bright iron; just beside it: its shadow on what is under it
      const mark = rivet(u, v, centreX, centreY, 2.2);
      if (mark?.light) colour = times(iron(u, v, 1, 5), 1.6 * mark.light);
      else if (mark?.shadow) colour = times(colour, 1 - mark.shadow);
    }
    return colour;
  },
  0,
);
canvas.zone(RIM, (u, v) => iron(u / 8, v / 4, 1.15 - 0.3 * bell(v - 8, 6), 9), 0);

// ── the shape: a box of 24 units, its lid a part of its own (part 1) so that it can go on its own bone ──
const SIZE = 24; // the crate's width and depth
const BODY_HEIGHT = 18; // how tall it is under the lid
const LID_HEIGHT = 3;
const half = SIZE / 2;
/**
 * A flat face from four points given clockwise or not: the shape builder turns it to face away from
 * `inside`. Its four corners take the four corners of `zone`. `mesh.V` makes a corner of the shape from
 * where it is ([x, y, z]), its pixel in the texture ([px, py]) and its part.
 */
const face = (points, zone, inside, part = 0) =>
  mesh.quad(
    ...points.map((point, i) =>
      mesh.V(point, [zone.x + [0, zone.w, zone.w, 0][i], zone.y + [0, 0, zone.h, zone.h][i]], part),
    ),
    inside,
  );
/** A box from height `bottom` to `top`: four sides that wear `sideZone`, then a top and a bottom of planks */
const box = (bottom, top, sideZone, part) => {
  const middle = [0, 0, (bottom + top) / 2];
  // the four sides, each from one corner of the square to the next
  for (const [from, to] of [
    [
      [-half, -half],
      [half, -half],
    ],
    [
      [half, -half],
      [half, half],
    ],
    [
      [half, half],
      [-half, half],
    ],
    [
      [-half, half],
      [-half, -half],
    ],
  ])
    face(
      [
        [...from, top],
        [...to, top],
        [...to, bottom],
        [...from, bottom],
      ],
      sideZone,
      middle,
      part,
    );
  // the top
  face(
    [
      [-half, -half, top],
      [half, -half, top],
      [half, half, top],
      [-half, half, top],
    ],
    FACE,
    middle,
    part,
  );
  // the bottom
  face(
    [
      [-half, -half, bottom],
      [half, -half, bottom],
      [half, half, bottom],
      [-half, half, bottom],
    ],
    FACE,
    middle,
    part,
  );
};
box(0, BODY_HEIGHT, FACE, 0);
box(BODY_HEIGHT, BODY_HEIGHT + LID_HEIGHT, RIM, 1);

// ── the model: two bones (the lid hinges on the back edge, +x being the front) and two animations ──
const bones = [
  { name: "crate", parent: -1 },
  { name: "lid", parent: 0, pos: [-half, 0, BODY_HEIGHT] },
];
// every corner is told which bone moves it: the lid's corners (part 1) the lid, the rest the crate
const tris = mesh.tris.map((triangle) =>
  triangle.map((point) => ({ ...point, bone: point.part ? "lid" : "crate" })),
);
/** One frame: for each bone x y z, then the turn about x y z (radians). Here the lid turned by `angle`. */
const lidAt = (angle) => [
  [0, 0, 0, 0, 0, 0],
  [-half, 0, BODY_HEIGHT, 0, angle, 0],
];
// sixteen frames in which the lid swings open to 1.9 radians, starting and stopping gently
const open = Array.from({ length: 16 }, (_, frame) =>
  lidAt(-1.9 * (0.5 - 0.5 * Math.cos((Math.PI * frame) / 15))),
);
const mdl = buildMdl({
  name: "crate.mdl",
  bones,
  bodyparts: [
    {
      name: "body",
      models: [{ name: "crate", meshes: [{ tris, texture: indexed(canvas.image(), "crate.bmp") }] }],
    },
  ],
  sequences: [
    { name: "idle", fps: 10, loops: true, frames: [lidAt(0)] },
    { name: "open", fps: 20, loops: false, frames: open },
  ],
});

// ── check it against what the engine takes, and stop before writing a model that would not load ──
const report = check(mdl, "goldsrc");
for (const line of [
  ...report.facts,
  ...report.warnings.map((warning) => `WARN ${warning}`),
  ...report.errors.map((error) => `ERROR ${error}`),
])
  console.log(line);
if (report.errors.length) process.exit(1);
writeFileSync(join(OUT, "crate.mdl"), mdl);

// ── look at it: six views with the lid open, and four moments of it opening ──
const views = sheet(mdl, { seq: "open", frame: 15 });
const opening = strip(mdl, { seq: "open", count: 4, yaw: 60, pitch: 25 });
writeFileSync(join(OUT, "crate_sheet.png"), png(views.width, views.height, views.rgba));
writeFileSync(join(OUT, "crate_open.png"), png(opening.width, opening.height, opening.rgba));
console.log(`${join(OUT, "crate.mdl")} (${mdl.length} bytes), crate_sheet.png, crate_open.png`);
