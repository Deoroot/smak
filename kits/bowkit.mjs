// bowkit: a bow made from a description: a stave bent along a line, its string, and whatever is tied to it.
// You give the line and the stave's thickness as functions, and the kit builds the triangles and paints
// the texture.
//
//   import { bow, through } from "../kits/bowkit.mjs";
//   const piece = bow({ seed, L, centre, thick, wide, sides, stations, paint, string, extra });
//                                                                  // -> { tris, image, rig: "nearest" }
//
// What comes back is a "piece": `tris` (the triangles), `image` (the texture) and `rig` (below). Hand it to
// swapMesh or buildMdl (src/index.mjs), as examples/02-swap-mesh.mjs does with a sword. There is nothing
// to run in this file itself.
//
// x runs from tip to tip (-L to L); the back of the bow looks to +y and the string is on -y.
//   L:         half the bow's length
//   centre(x): where the middle of the stave is (y). `through` below makes one from a few points.
//   thick(x):  its half thickness in the plane of the bow
//   wide(x):   its half width across it (z)
//   sides:     how many sides the stave has (8 unless told)
//   stations:  the x of each ring of the stave (0..L; they are mirrored to the other limb)
//   paint(q):  the stave's colour. q = { x, d (|x|), q (round the stave, 0..1: 0 its back, 0.5 its belly,
//              which the archer sees), light, seed }
//   string:    { x (where it is tied, from the middle), drop (how far under the stave there), colour,
//                r (its half thickness: 0.07 unless told),
//                mid (the y of its middle, where the fingers draw it: level with its ends unless told) }
//   extra({ M, S, zone, seed, centre }): parts of its own, in what is left of the texture (1008 x 62).
//              M: the shape being built, S: the sheet being painted.
// The texture is 1024x256.
//
// `rig: "nearest"`: in the game a bow is not one rigid thing. The middle of the string hangs from the bone
// that draws it and, in the finer originals, each limb from bones that bend it. Every corner of the new
// bow takes the bone of the original's nearest corner (as make/build.mjs does with `rig: "nearest"`), so it
// is drawn and bends as the original did.
// The corners of the string's middle, where the fingers draw it, are also marked `part: 1` (every other
// corner is part 0): whoever places the bow as a NEW thing, with no original of its own to go by, sends
// them to the bone that draws the string with `bones: [, "its name"]` (`addFitted`, make/items.mjs).
//
// Words used below. A "zone" is a rectangle of the texture; `u`, `v` are pixels inside one.
import { sheet, shape, cylinderLight, times } from "../make/workshop.mjs";

const WIDTH = 1024;
const HEIGHT = 256;
/** The `part` of the corners of the string's middle. */
const STRING_MIDDLE = 1;

export function bow(spec) {
  const canvas = sheet(WIDTH, HEIGHT);
  const mesh = shape(WIDTH, HEIGHT);
  const seed = spec.seed ?? 1;
  const halfLength = spec.L;
  // where each part is painted in the texture (the string's strip is 1000 wide where the others are 1008:
  // it only means a very long string's strip stops 8 pixels sooner, and it is kept, since bows were made
  // with it)
  const zones = {
    stave: { x: 8, y: 8, w: 1008, h: 150 },
    string: { x: 8, y: 168, w: 1000, h: 8 },
    extra: { x: 8, y: 186, w: 1008, h: 62 },
  };

  // ── the stave ──
  const pixelsPerUnit = (zones.stave.w - 4) / (2 * halfLength);
  /** How steeply the stave's line climbs at x. */
  const slope = (x) => (spec.centre(x + 0.05) - spec.centre(x - 0.05)) / 0.1;
  // Where its rings are: those asked for (or 14, evenly) on one limb, without repeats, in order...
  const oneLimb = [
    ...new Set(
      (spec.stations ?? Array.from({ length: 14 }, (_, i) => (halfLength * i) / 13)).map(
        (x) => +Math.min(halfLength, Math.abs(x)).toFixed(3),
      ),
    ),
  ].sort((first, second) => first - second);
  // ... and the same mirrored on the other, from tip to tip
  const ringXs = [
    ...oneLimb
      .filter((x) => x > 0)
      .map((x) => -x)
      .reverse(),
    ...oneLimb,
  ];
  // A tube of radius 1 along x, which `at` bends and squashes into the stave. The section leans with the
  // stave: without it the bow thins where it slopes most.
  mesh.lathe(
    ringXs.map((x) => [x, 1]),
    zones.stave,
    {
      sides: spec.sides ?? 8,
      px: pixelsPerUnit,
      caps: [true, true],
      at: (s, inPlane, acrossPlane) => [
        s,
        spec.centre(s) + inPlane * spec.thick(s) * Math.min(1.6, Math.hypot(1, slope(s))),
        acrossPlane * spec.wide(s),
      ],
    },
  );
  // all of its colour is the caller's `paint`, told where each pixel is along the stave and round it
  canvas.zone(zones.stave, (u, v) => {
    const x = Math.min(halfLength, Math.max(-halfLength, -halfLength + u / pixelsPerUnit));
    const around = Math.min(1, Math.max(0, v / zones.stave.h));
    return spec.paint({ x, d: Math.abs(x), q: around, light: cylinderLight(around, 0.36), seed });
  });

  // ── the string: from each tip to its middle ──
  // Two thin four-sided bars. The middle is level with the ends unless `string.mid` says where it is (y).
  const string = spec.string;
  const radius = string.r ?? 0.07;
  const yEnd = spec.centre(string.x) - string.drop;
  const yMid = string.mid ?? yEnd;
  /**
   * One of the four corners (0..3) of the string's square section at x, y. Its place in the texture is
   * not known yet: each face gives its corners theirs, below. `part`: 1 for the string's middle.
   */
  const corner = (x, y, cornerIndex, part = 0) =>
    mesh.V(
      [
        x + (cornerIndex === 0 || cornerIndex === 3 ? -radius : radius) * 0.3,
        y + (cornerIndex < 2 ? radius : -radius),
        cornerIndex === 1 || cornerIndex === 2 ? radius : -radius,
      ],
      [0, 0],
      part,
    );
  for (const side of [-1, 1]) {
    const xEnd = side * string.x;
    // how many pixels of the string's strip this half takes: 40 a unit, as far as the strip goes
    const run = Math.min(zones.string.w, Math.hypot(xEnd, yEnd - yMid) * 40);
    const endCorners = [0, 1, 2, 3].map((cornerIndex) => corner(xEnd, yEnd, cornerIndex));
    const midCorners = [0, 1, 2, 3].map((cornerIndex) => corner(0, yMid, cornerIndex, STRING_MIDDLE));
    // its four faces; every other one takes the strip upside down, so that neighbours meet on a row
    for (let cornerIndex = 0; cornerIndex < 4; cornerIndex++) {
      const nextCorner = (cornerIndex + 1) % 4;
      const rowHere = zones.string.y + (cornerIndex % 2 ? 1 : 5);
      const rowNext = zones.string.y + (cornerIndex % 2 ? 5 : 1);
      mesh.quad(
        { ...endCorners[cornerIndex], t: [zones.string.x, rowHere] },
        { ...midCorners[cornerIndex], t: [zones.string.x + run, rowHere] },
        { ...midCorners[nextCorner], t: [zones.string.x + run, rowNext] },
        { ...endCorners[nextCorner], t: [zones.string.x, rowNext] },
        [xEnd / 2, (yEnd + yMid) / 2, 0], // a point inside it: the face is turned to look away from it
      );
    }
  }
  // twisted thread: a ripple along it, and its upper half lighter
  canvas.zone(
    zones.string,
    (u, v) =>
      times(
        string.colour ?? [0.62, 0.57, 0.46],
        0.75 + 0.15 * Math.sin(u * 0.9 + v) + 0.25 * (v < 4 ? 1 : 0),
      ),
    2,
  );

  // whatever the caller adds of its own
  if (spec.extra) spec.extra({ M: mesh, S: canvas, zone: zones.extra, seed, centre: spec.centre });
  return { tris: mesh.tris, image: canvas.image(), rig: "nearest" };
}

/**
 * A line through points [[x, y], ...] (x rising), smooth between them, for a bow's `centre`, `thick` or
 * `wide`. It is the same on both limbs (it goes by |x|); `x` beyond the ends keeps the end's value.
 */
export function through(points) {
  return (x) => {
    // the two points this x is between, and how far from the first to the second (0..1)
    const distance = Math.abs(x);
    let i = 1;
    while (i < points.length - 1 && points[i][0] < distance) i++;
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const share = Math.min(1, Math.max(0, (distance - x0) / (x1 - x0)));
    // the slope at each point: that of its two neighbours (a Catmull-Rom spline)
    const slopeAt = (index) => {
      const before = points[Math.max(0, index - 1)];
      const after = points[Math.min(points.length - 1, index + 1)];
      return (after[1] - before[1]) / (after[0] - before[0] || 1);
    };
    // a cubic between the two points that leaves each with its slope (Hermite's)
    const width = x1 - x0;
    const share2 = share * share;
    const share3 = share2 * share;
    return (
      (2 * share3 - 3 * share2 + 1) * y0 +
      (share3 - 2 * share2 + share) * width * slopeAt(i - 1) +
      (-2 * share3 + 3 * share2) * y1 +
      (share3 - share2) * width * slopeAt(i)
    );
  };
}
