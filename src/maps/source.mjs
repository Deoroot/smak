// Map source: the text of a `.map` file, built from code. A map's source is a list of entities; the first,
// `worldspawn`, holds the brushes the world is made of, and the others are things in it (a light, a door, a
// place to start). A brush is a convex solid, written as the planes that bound it. The compilers (compile.mjs)
// turn this text into the `.bsp` the game loads.
//
// Here a brush is plain data, `{ faces }`, and each face is
//   { points: [p0, p1, p2], texture, u: [x, y, z, offset], v: [x, y, z, offset], rotation, scale: [x, y] }
// so that a map can be built, looked over (plan.mjs), changed and written, or read from a file and changed.
//
// THE FORMAT is "Valve 220" (`"mapversion" "220"` in worldspawn), what J.A.C.K., Hammer and TrenchBroom write
// for GoldSrc. A face is one line:
//
//   ( x y z ) ( x y z ) ( x y z ) TEXTURE [ ux uy uz offset ] [ vx vy vz offset ] rotation scaleX scaleY
//
// THE ONE THING THAT CAN GO WRONG is the order of the three points. The compiler takes the face's normal as
// cross(p0 - p1, p2 - p1) (Quake's qbsp, which hlcsg inherited) and the brush is what lies BEHIND all its
// planes. With the points the other way round the normal looks inwards and the brush has no volume. Every
// builder here turns its planes outwards itself; `shapeOf` works a brush out from its planes the way the
// compiler does, and says what is wrong with it.
//
// Axes and units are the game's: +x east, +y north, +z up; a unit is about an inch (a player is 72 tall).
// A texture is named, never held: the names are looked up in the .wad files worldspawn's `wad` key lists.
import { sub, dot, cross, unit } from "../vec.mjs";
import { modelless } from "./entities.mjs";

// ── constants ───────────────────────────────────────────────────────────────
/** The format written and read: worldspawn's `mapversion`. */
export const MAP_VERSION = "220";
/** A box's plane is written as a corner and two points this far from it along the face. */
const BOX_SPAN = 64;
/**
 * Decimals a number is written with. Six, as some editors write, are too few: a picture fitted exactly to
 * its face (a window in its opening, at a scale of 2/3) lands on whole texels, and a scale cut to 0.666667
 * moves it off them by a hair, which changed the size of a face's lightmap in a compiled map. Ten keep such
 * a fit, and the compilers read any number of them.
 */
const DECIMALS = 10;
/** A point this near a plane is on it (units). */
const ON_PLANE = 1e-6;
/** Three points whose cross product is shorter than this are in a line: they give no plane. */
const NO_PLANE = 1e-9;
/** A face of less area than this (square units) is no face. */
const NO_AREA = 1e-6;
/** Two unit normals whose dot product is over this point the same way. */
const SAME_WAY = 1 - 1e-9;
/** Half the side of the sheet a face is cut from when a brush is worked out: far larger than any map. */
const HUGE = 1 << 20;
/** A worked-out corner further out than this means the planes do not close the brush. */
const OPEN = 1 << 18;
/** Corners of a worked-out brush nearer than this are one corner. */
const SAME_CORNER = 1e-4;
/** A number is tidied to this many decimals where arithmetic leaves dust (6.1e-17 for 0). */
const DUST = 1e9;
/** The tallest step a player walks up without jumping (the engine's sv_stepsize). */
export const STEP_HEIGHT = 18;
/** A player's origin is the middle of its 72 tall box: this far above the floor it stands on. */
export const PLAYER_ORIGIN_HEIGHT = 36;
/** The texture that marks an ORIGIN brush: the compiler takes its middle for the entity's origin. */
const ORIGIN_TEXTURE = "ORIGIN";

const AXIS_NAMES = ["x", "y", "z"];
/** The texture axes the editors give a face, by the axis its normal looks along most: "align to world". */
const WORLD_AXES = [
  { u: [0, 1, 0], v: [0, 0, -1] },
  { u: [1, 0, 0], v: [0, 0, -1] },
  { u: [1, 0, 0], v: [0, -1, 0] },
];
/** A box's six faces: the outward normal and two directions along the face, with along x across = normal. */
const BOX_FACES = [
  { normal: [0, 0, 1], along: [1, 0, 0], across: [0, 1, 0] },
  { normal: [0, 0, -1], along: [0, 1, 0], across: [1, 0, 0] },
  { normal: [1, 0, 0], along: [0, 1, 0], across: [0, 0, 1] },
  { normal: [-1, 0, 0], along: [0, 0, 1], across: [0, 1, 0] },
  { normal: [0, 1, 0], along: [0, 0, 1], across: [1, 0, 0] },
  { normal: [0, -1, 0], along: [1, 0, 0], across: [0, 0, 1] },
];
/** The sides a wedge or a flight of stairs may rise towards: the axis, and which way along it. */
const SIDES = {
  "+x": { axis: 0, sign: 1 },
  "-x": { axis: 0, sign: -1 },
  "+y": { axis: 1, sign: 1 },
  "-y": { axis: 1, sign: -1 },
};

// ── small arithmetic ────────────────────────────────────────────────────────
/** `a + b * k`, for points. */
const plus = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
/** A number with the dust of arithmetic taken off, and never -0. */
const tidy = (value) => Math.round(value * DUST) / DUST + 0;
/** A vector turned about a unit axis by an angle in radians (right-handed). */
const turnAbout = (vector, axis, angle) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const side = cross(axis, vector);
  const lift = dot(axis, vector) * (1 - cos);
  return [0, 1, 2].map((i) => vector[i] * cos + side[i] * sin + axis[i] * lift);
};
/** Which axis a normal looks along most (0, 1 or 2); on a tie z, then x, as the editors choose. */
const dominant = (normal) => {
  const size = normal.map(Math.abs);
  if (size[2] >= size[0] && size[2] >= size[1]) return 2;
  return size[0] >= size[1] ? 0 : 1;
};
/** An axis given as "x", "y", "z" or 0, 1, 2, as its number. */
const axisIndex = (axis, who) => {
  const index = typeof axis === "string" ? AXIS_NAMES.indexOf(axis) : axis;
  if (![0, 1, 2].includes(index)) throw new Error(`${who}: the axis is "x", "y" or "z", not ${axis}`);
  return index;
};
/**
 * A point from its place along an axis and its two other coordinates, in their order: (y, z) for the x axis,
 * (x, z) for y, (x, y) for z.
 */
const placed = (axis, along, [first, second]) => {
  if (axis === 0) return [along, first, second];
  if (axis === 1) return [first, along, second];
  return [first, second, along];
};
/** A value rounded to a grid; left as it is when there is none. */
const toGrid = (value, grid) => (grid ? Math.round(value / grid) * grid + 0 : value);
/** A list of 2D points with those that repeat the one before (or, at the end, the first) left out. */
const withoutRepeats = (outline) =>
  outline.filter((point, index) => {
    const previous = outline[(index + outline.length - 1) % outline.length];
    return Math.hypot(point[0] - previous[0], point[1] - previous[1]) > SAME_CORNER;
  });

// ── numbers and values as text ──────────────────────────────────────────────
/**
 * A number as a map holds it: whole numbers with no point, others with at most ten decimals, never an
 * exponent and never "-0". It throws for what is not a number.
 */
export function mapNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`a number in a map cannot be ${value}`);
  const text = value.toFixed(DECIMALS).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
}

/**
 * A key's value as text: a string as it is, a number as `mapNumber` writes it, a list with spaces between
 * (an origin `[0, 0, 36]`, a colour and brightness `[255, 255, 128, 100]`). A value with a quote or a line
 * break in it would break the file, and is refused.
 */
export function valueText(value) {
  if (Array.isArray(value)) return value.map(valueText).join(" ");
  if (typeof value === "number") return mapNumber(value);
  if (typeof value !== "string")
    throw new Error(`a value in a map is text, a number or a list, not ${value}`);
  if (/["\r\n]/.test(value))
    throw new Error(`a value in a map cannot hold a quote or a line break: ${value}`);
  return value;
}

// ── a face's texture ────────────────────────────────────────────────────────
/** Whether a face looks more than 5 degrees off every axis: what a builder's face wears face-aligned by default. */
const SLOPE_LIMIT = Math.cos((5 * Math.PI) / 180);
function isSloped(normal) {
  const length = Math.hypot(...normal);
  return length > 0 && Math.max(...normal.map(Math.abs)) / length < SLOPE_LIMIT;
}

/**
 * The two texture axes of a face that looks along `normal`: `{ u, v, about }`. `u` is the way the picture's
 * columns run across the surface, `v` the way its rows run (downwards), and `about` the axis a rotation
 * turns them round.
 *
 *   align: "world"  (the default) as the editors' "align to world": the axes are the world's own, chosen by
 *                   the axis the face looks along most. Pictures on faces that share a plane line up across
 *                   brushes, which is what walls and floors want. On a slanted face the picture is stretched
 *                   down the slope (by 1.41 at 45 degrees).
 *   align: "face"   the axes lie in the face itself: nothing is stretched on a slope (a ramp, a roof, a
 *                   chamfer). Pictures no longer line up with the neighbours'.
 *   align: "auto"   what a builder's face gets when it is not told: "face" where the normal is more than 5 degrees
 *                   off every axis (a ramp, a gable, a turned building's slanted face), "world" otherwise, so a
 *                   straight wall keeps lining up with its neighbours.
 *   rotation        degrees, turning the picture anticlockwise as seen from outside the face.
 */
export function textureAxes(normal, { align = "world", rotation = 0 } = {}) {
  const axis = dominant(normal);
  if (align === "auto") align = isSloped(normal) ? "face" : "world";
  let { u, v } = WORLD_AXES[axis];
  let about = [0, 0, 0];
  about[axis] = normal[axis] < 0 ? -1 : 1;
  if (align === "face") {
    about = unit(normal);
    const worldV = v;
    u = unit(plus(u, about, -dot(u, about)));
    v = unit(cross(about, u));
    if (dot(v, worldV) < 0) v = v.map((value) => -value);
  } else if (align !== "world") {
    throw new Error(`a texture is aligned to the "world" or to the "face", not ${align}`);
  }
  if (rotation) {
    const angle = (rotation * Math.PI) / 180;
    u = turnAbout(u, about, angle);
    v = turnAbout(v, about, angle);
  }
  return { u: u.map(tidy), v: v.map(tidy), about };
}

/**
 * What the face of normal `normal` wears, from what a builder was given as its `texture`:
 *   "NAME"                                     every face the same
 *   { name, scale, offset, rotation, align }   the same, with its fit: `scale` a number or [x, y] (units a
 *                                              texel: 0.5 draws it twice as fine), `offset` [u, v] in texels,
 *                                              `rotation` in degrees, `align` "world" or "face"
 *   { top, bottom, sides, east, west, north, south }   by the way the face looks (+z, -z, +x, -x, +y, -y),
 *                                              each a name or a fit as above; a way not named wears `sides`
 *   (normal) => any of those                   by a rule of your own
 * It returns the fit, `{ name, ... }`.
 */
export function textureFor(texture, normal) {
  if (typeof texture === "string") return { name: texture };
  if (typeof texture === "function") return textureFor(texture(normal), normal);
  if (!texture || typeof texture !== "object")
    throw new Error(`a face with no texture (it looks along ${normal.map(tidy).join(" ")})`);
  if (texture.name) return texture;
  const axis = dominant(normal);
  const positive = normal[axis] > 0;
  let chosen;
  if (axis === 2) chosen = positive ? texture.top : texture.bottom;
  else if (axis === 0) chosen = positive ? texture.east : texture.west;
  else chosen = positive ? texture.north : texture.south;
  chosen ??= texture.sides;
  if (!chosen) throw new Error(`a face with no texture (it looks along ${normal.map(tidy).join(" ")})`);
  return textureFor(chosen, normal);
}

/**
 * What a builder was given as its `texture`, with `scale` (a number, or [x, y]: units a texel) set on every face
 * it will give: a name becomes a fit, a fit's scale is replaced, a texture by direction or by rule has it set
 * on each of its answers. The builders' `scale` option is this; `undefined` leaves the texture as it is. A
 * `fitted` picture's offsets were worked out for its own scale, so give a fit its scale, not this.
 */
export function withScale(texture, scale) {
  if (scale === undefined) return texture;
  const pair = Array.isArray(scale) ? scale : [scale, scale];
  if (pair.length !== 2 || !pair.every((v) => Number.isFinite(v) && v !== 0))
    throw new Error(`a texture's scale is a number other than 0, or [x, y], not ${JSON.stringify(scale)}`);
  if (typeof texture === "string") return { name: texture, scale: pair };
  if (typeof texture === "function") return (normal) => withScale(texture(normal), scale);
  if (!texture || typeof texture !== "object") return texture;
  if (texture.name) return { ...texture, scale: pair };
  return Object.fromEntries(Object.entries(texture).map(([side, each]) => [side, withScale(each, scale)]));
}

/**
 * A picture fitted to a box, as a mapper fits one by hand ("fit", then shifts): on each of its six faces the
 * picture's corner stands on the face's corner, so a band's edge falls on the brush's edge, a sign is whole on
 * its plate and a door's picture fills its leaf. `size` is the picture's [width, height] in texels. On an upright
 * face the picture's top is at the face's top and its left at the face's left as seen from outside; on a floor
 * or a ceiling its top is to the north and its left to the west.
 *   whole      true: one picture across each face, stretched to it both ways; "u" across only (its height
 *              tiles at the scale given), "v" up only
 *   repeat     [across, up]: so many pictures across and up each face, in place of one (`whole` true)
 *   scale      the scale where a way is not fitted (1: a texel a unit)
 *   readable   true (the default): the north and west faces, where the world's grid runs the picture right to
 *              left as seen, are flipped, so words read and a picture is not mirrored on any side; false lays
 *              them on the grid as it runs (a sign on a north face then reads backwards, as one in Meridian did)
 *   faces      the faces that wear it ("top", "bottom", "north", "south", "east", "west"); the others wear
 *              `rest` (the picture laid on the world's grid unless told)
 * It returns `{ top, bottom, north, south, east, west }` for `box` and any builder that takes a texture.
 */
export function fitted(name, size, min, max, { whole = false, repeat, scale = 1, readable = true, faces, rest } = {}) {
  if (typeof name !== "string" || !name) throw new Error("fitted: the texture's name");
  if (!(Array.isArray(size) && size.length === 2 && size.every((v) => v > 0))) throw new Error(`fitted: the picture's size is [width, height] in texels, not ${JSON.stringify(size)}`);
  for (let i = 0; i < 3; i++) if (!(max[i] > min[i])) throw new Error(`fitted: the box has no size along ${AXIS_NAMES[i]}`);
  const [tw, th] = size;
  const [nu, nv] = repeat ?? [1, 1];
  const fitU = whole === true || whole === "u" || repeat !== undefined;
  const fitV = whole === true || whole === "v" || repeat !== undefined;
  const [s0, s1] = Array.isArray(scale) ? scale : [scale, scale];
  // one face: `along` the axis its picture runs across (u), `lo`/`hi` its extent, `flip` when the world's u runs
  // right to left as the face is seen; `up` the axis the picture's rows run down (v), its top at `top`
  const face = (along, flip, up, top, extentV) => {
    const extentU = max[along] - min[along];
    let su = fitU ? extentU / (nu * tw) : s0;
    const sv = fitV ? extentV / (nv * th) : s1;
    if (flip) su = -su;
    const left = flip ? max[along] : min[along];
    return { name, scale: [su, sv], offset: [-left / su, top / sv] };
  };
  const all = {
    top: face(0, false, 1, max[1], max[1] - min[1]),
    bottom: face(0, false, 1, max[1], max[1] - min[1]),
    east: face(1, false, 2, max[2], max[2] - min[2]),
    west: face(1, readable, 2, max[2], max[2] - min[2]),
    north: face(0, readable, 2, max[2], max[2] - min[2]),
    south: face(0, false, 2, max[2], max[2] - min[2]),
  };
  if (!faces) return all;
  const kept = Object.fromEntries(faces.map((f) => {
    if (!(f in all)) throw new Error(`fitted: a face is top, bottom, north, south, east or west, not ${f}`);
    return [f, all[f]];
  }));
  return { ...Object.fromEntries(Object.keys(all).map((f) => [f, rest ?? name])), ...kept };
}

/** One face: its three points (already in the compiler's order), and the texture its normal picks. */
function faceOf(points, normal, texture) {
  const fit = textureFor(texture, normal);
  if (typeof fit.name !== "string" || !fit.name || /\s/.test(fit.name))
    throw new Error(`a texture's name is one word, not "${fit.name}"`);
  const scale = Array.isArray(fit.scale) ? fit.scale : [fit.scale ?? 1, fit.scale ?? 1];
  if (!(scale[0] && scale[1])) throw new Error(`the texture ${fit.name} has a scale of 0`);
  const offset = fit.offset ?? [0, 0];
  const rotation = fit.rotation ?? 0;
  const axes = textureAxes(normal, { align: fit.align ?? "auto", rotation });
  return {
    points: points.map((point) => [...point]),
    texture: fit.name,
    u: [...axes.u, offset[0]],
    v: [...axes.v, offset[1]],
    rotation,
    scale: [...scale],
  };
}

// ── planes ──────────────────────────────────────────────────────────────────
/**
 * The plane three points give, by the compiler's own sum: `{ normal, dist }`, the normal of length 1 and
 * looking OUT of the brush, with `dot(normal, p) = dist` on the plane. Null when the points are in a line.
 */
export function planeOf([p0, p1, p2]) {
  const normal = cross(sub(p0, p1), sub(p2, p1));
  const length = Math.hypot(...normal);
  if (!(length > NO_PLANE)) return null;
  const outward = normal.map((value) => value / length);
  return { normal: outward, dist: dot(outward, p1) };
}

/**
 * The six planes of the box from `min` to `max`: for each, the outward `normal` and its three `points` in
 * the compiler's order.
 */
export function boxPlanes(min, max) {
  return BOX_FACES.map(({ normal, along, across }) => {
    // a point of the plane: the corner at `max` where the normal is positive, at `min` elsewhere
    const corner = [0, 1, 2].map((i) => (normal[i] > 0 ? max[i] : min[i]));
    return { normal, points: [plus(corner, along, BOX_SPAN), corner, plus(corner, across, BOX_SPAN)] };
  });
}

/**
 * The planes of a convex solid whose corners are `points`, each face given as three indices into them (in
 * any order): for each, the outward `normal` and the three `points` in the compiler's order. The planes are
 * turned outwards by looking where the solid's middle is.
 *
 * It throws, in words, for a face whose three points are in a line and for a corner that lies in FRONT of
 * a face: that is a solid that is not convex, which the compiler would cut down without a word.
 */
export function solidPlanes(points, faces) {
  const centre = [0, 1, 2].map((i) => points.reduce((sum, point) => sum + point[i], 0) / points.length);
  return faces.map((indices) => {
    let [p0, p1, p2] = indices.map((index) => points[index]);
    let plane = planeOf([p0, p1, p2]);
    if (!plane)
      throw new Error(`a face with no area: its points ${JSON.stringify([p0, p1, p2])} are in a line`);
    if (dot(plane.normal, centre) - plane.dist > 0) {
      [p0, p2] = [p2, p0];
      plane = planeOf([p0, p1, p2]);
    }
    for (const point of points)
      if (dot(plane.normal, point) - plane.dist > ON_PLANE)
        throw new Error(
          `the solid is not convex: the corner ${point.join(" ")} is in front of the face through ${JSON.stringify([p0, p1, p2])}. A brush is convex: make the shape of several`,
        );
    return { normal: plane.normal, points: [p0, p1, p2] };
  });
}

/**
 * The faces of the convex solid that has `points` for corners, found from the points alone: one entry a
 * face, `{ normal, points }` as `solidPlanes` gives. It throws, in words, when the points lie in one plane
 * (no volume) and when one of them is inside the solid the others make (they are then not the corners of a
 * convex solid).
 */
/** Two faces whose normals agree this closely (cosine; within about a degree) are one plane to the compiler. */
const NEAR_ONE = 0.9998;

function hullPlanes(points) {
  const found = new Map();
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      for (let k = j + 1; k < points.length; k++) {
        let plane = planeOf([points[i], points[j], points[k]]);
        if (!plane) continue;
        const sides = points.map((point) => dot(plane.normal, point) - plane.dist);
        // a face of the solid has every corner on it or behind it; one way round or the other
        if (Math.min(...sides) >= -ON_PLANE)
          plane = { normal: plane.normal.map((value) => -value), dist: -plane.dist };
        else if (Math.max(...sides) > ON_PLANE) continue;
        const key = [...plane.normal, plane.dist].map((value) => value.toFixed(5)).join();
        if (found.has(key)) continue;
        const onIt = points.filter((point) => Math.abs(dot(plane.normal, point) - plane.dist) <= ON_PLANE);
        found.set(key, { normal: plane.normal, onIt });
      }
  if (found.size < 4)
    throw new Error(
      `solid: its ${points.length} points lie in one plane or one line: a solid with no volume`,
    );
  // two faces all but in one plane (corners rounded to whole units make a crease of a hundredth of a degree)
  // are one to the compiler, which refuses the brush: the one with fewer corners goes, its corners kept on
  // the other's face (they are within a unit of it)
  const faces = [];
  for (const face of [...found.values()].sort((a, b) => b.onIt.length - a.onIt.length)) {
    const dist = dot(face.normal, face.onIt[0]);
    const twin = faces.find((kept) => dot(kept.normal, face.normal) > NEAR_ONE && Math.abs(dot(kept.normal, face.onIt[0]) - dot(kept.normal, kept.onIt[0])) < 1 && Math.abs(dist - dot(face.normal, kept.onIt[0])) < 1); // prettier-ignore
    if (twin) twin.onIt = [...new Set([...twin.onIt, ...face.onIt])];
    else faces.push(face);
  }
  const inside = points.find((point) => !faces.some((face) => face.onIt.includes(point)));
  if (inside)
    throw new Error(
      `solid: the point ${inside.join(" ")} is inside the solid the other points make, so these are not the corners of a convex solid. A brush is convex: make the shape of several`,
    );
  return faces.map(({ normal, onIt }) => {
    // three of the face's corners, spread as widely as they come, in the compiler's order
    const first = onIt[0];
    const farthest = (score) => onIt.reduce((best, point) => (score(point) > score(best) ? point : best));
    const second = farthest((point) => Math.hypot(...sub(point, first)));
    const third = farthest((point) => Math.hypot(...cross(sub(second, first), sub(point, first))));
    const outward = dot(cross(sub(second, first), sub(third, first)), normal) > 0;
    return { normal, points: outward ? [second, first, third] : [third, first, second] };
  });
}

/** The planes of a brush as the compiler works them out: `[{ normal, dist }]`, null for a face in a line. */
export const planesOf = (brush) => brush.faces.map((face) => planeOf(face.points));

/** Whether a point is inside a brush, or within `margin` of being so. */
export function holds(brush, point, margin = 0) {
  return planesOf(brush).every((plane) => plane && dot(plane.normal, point) - plane.dist <= margin);
}

/** A huge square on a plane, to be cut down to the face. */
function sheetOn(plane) {
  const helper = Math.abs(plane.normal[2]) > 0.7 ? [1, 0, 0] : [0, 0, 1];
  const along = unit(cross(plane.normal, helper));
  const across = cross(plane.normal, along);
  const middle = plane.normal.map((value) => value * plane.dist);
  return [
    plus(plus(middle, along, HUGE), across, HUGE),
    plus(plus(middle, along, -HUGE), across, HUGE),
    plus(plus(middle, along, -HUGE), across, -HUGE),
    plus(plus(middle, along, HUGE), across, -HUGE),
  ];
}

/** What is left of a polygon behind a plane. */
function cutBehind(polygon, plane) {
  const kept = [];
  polygon.forEach((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const here = dot(plane.normal, point) - plane.dist;
    const there = dot(plane.normal, next) - plane.dist;
    if (here <= ON_PLANE) kept.push(point);
    const crosses = (here > ON_PLANE && there < -ON_PLANE) || (here < -ON_PLANE && there > ON_PLANE);
    if (crosses) kept.push(plus(point, sub(next, point), here / (here - there)));
  });
  return kept;
}

/** The area of a flat polygon in space. */
function areaOf(polygon) {
  let sum = [0, 0, 0];
  for (let index = 1; index + 1 < polygon.length; index++)
    sum = plus(sum, cross(sub(polygon[index], polygon[0]), sub(polygon[index + 1], polygon[0])));
  return Math.hypot(...sum) / 2;
}

/**
 * A brush worked out from its planes, as the compiler does it: each face is a huge sheet on its plane, cut
 * by every other plane. It returns
 *   { faces: [{ normal, dist, polygon, area, texture }], corners, min, max, volume, faults }
 * `faults` is a list of sentences, empty for a sound brush: a face whose points are in a line, a plane given
 * twice, a face the others cut away (it has no area), planes that do not close the brush, no volume. A set
 * of planes can only ever bound a convex solid, so a brush "that is not convex" shows here as faces with no
 * area or as no volume at all.
 */
export function shapeOf(brush) {
  const planes = planesOf(brush);
  const faults = [];
  const faces = brush.faces.map((face, index) => {
    const plane = planes[index];
    const named = `face ${index} (${face.texture})`;
    if (!plane) {
      faults.push(`${named} has its three points in a line: they give no plane`);
      return { normal: null, dist: 0, polygon: [], area: 0, texture: face.texture };
    }
    let polygon = sheetOn(plane);
    planes.forEach((other, otherIndex) => {
      if (!other || otherIndex === index) return;
      const sameWay = dot(other.normal, plane.normal) > SAME_WAY;
      if (sameWay && Math.abs(other.dist - plane.dist) <= ON_PLANE) {
        if (otherIndex < index) faults.push(`${named} is the same plane as face ${otherIndex}`);
        return;
      }
      polygon = cutBehind(polygon, other);
    });
    // the dust the cutting leaves (24.000000000000007) is taken off
    polygon = polygon.map((point) => point.map(tidy));
    const area = polygon.length >= 3 ? areaOf(polygon) : 0;
    return { normal: plane.normal, dist: plane.dist, polygon, area, texture: face.texture };
  });
  const corners = [];
  for (const face of faces)
    for (const point of face.polygon)
      if (!corners.some((corner) => Math.hypot(...sub(corner, point)) < SAME_CORNER)) corners.push(point);
  const open = corners.some((corner) => corner.some((value) => Math.abs(value) > OPEN));
  const min = [0, 1, 2].map((i) => Math.min(...corners.map((corner) => corner[i])));
  const max = [0, 1, 2].map((i) => Math.max(...corners.map((corner) => corner[i])));
  // the volume: a third of each face's area times its plane's distance, summed (the divergence theorem)
  const volume = open ? Infinity : faces.reduce((sum, face) => sum + (face.area * face.dist) / 3, 0);
  if (brush.faces.length < 4) faults.push(`it has ${brush.faces.length} faces: a solid has four at least`);
  else if (!corners.length || !(volume > NO_AREA))
    faults.push("it has no volume: its planes leave nothing behind them all (its faces are turned inwards)");
  else if (open)
    faults.push(
      "its planes do not close it: it runs on without end (a face is missing, or one is turned inwards)",
    );
  else
    faces.forEach((face, index) => {
      if (face.normal && !(face.area > NO_AREA))
        faults.push(`face ${index} (${face.texture}) has no area: the other faces cut it away`);
    });
  return { faces, corners, min, max, volume, faults };
}

// ── brushes ─────────────────────────────────────────────────────────────────
/**
 * A brush in the shape of a box, from its least corner to its greatest. `texture`: see `textureFor` (a
 * name, or `{ top, bottom, sides }` for a floor of one and walls of another, with `east`, `west`, `north`,
 * `south` for a single face: a door's picture is ONE face of its box). `scale` (a number or [x, y]) sets the
 * picture's scale on every face (`withScale`).
 */
export function box(min, max, texture, { bevel = 0, edges = "all", scale } = {}) {
  for (let i = 0; i < 3; i++)
    if (!(max[i] > min[i]))
      throw new Error(`box: no size along ${AXIS_NAMES[i]}: from ${min.join(" ")} to ${max.join(" ")}`);
  texture = withScale(texture, scale);
  if (bevel) return chamferedBox(min, max, texture, bevel, edges);
  return { faces: boxPlanes(min, max).map(({ normal, points }) => faceOf(points, normal, texture)) };
}

/** The least a chamfer is cut, and the most of the smallest side of the box it may take. */
export const BEVEL_LEAST = 1;
export const BEVEL_MOST = 0.45;

/**
 * A box with its edges cut at 45 degrees by `bevel` units (a chamfer): `edges` names which, "all" (twelve),
 * "vertical" (the four upright ones: a pillar, a post), "top" (the four of its top face), "bottom", or those
 * joined by "+" ("top+vertical"). The bevel is least 1 and at most 0.45 of the box's smallest side; a whole
 * number keeps every corner on the grid. The brush has up to 26 faces (a plain chamfer of all twelve edges:
 * 26): convex, and the compilers take it.
 */
function chamferedBox(min, max, texture, bevel, edges) {
  const size = [0, 1, 2].map((i) => max[i] - min[i]);
  const limit = Math.min(...size) * BEVEL_MOST;
  if (!(bevel >= BEVEL_LEAST) || bevel > limit)
    throw new Error(`box: a bevel is ${BEVEL_LEAST} to ${Math.floor(limit * 100) / 100} for this box (0.45 of its smallest side, ${Math.min(...size)}), not ${bevel}`);
  const words = String(edges).split("+");
  // an edge runs along the axis that is neither i nor j; (i, j) = (0, 1) are the upright ones, j = 2 top or bottom
  const want = (i, j, _si, sj) =>
    words.includes("all") || (words.includes("vertical") && j === 1) || (words.includes("top") && j === 2 && sj > 0) || (words.includes("bottom") && j === 2 && sj < 0); // prettier-ignore
  for (const word of words)
    if (!["all", "vertical", "top", "bottom"].includes(word))
      throw new Error(`box: edges are "all", "vertical", "top" or "bottom" (joined by "+"), not ${edges}`);
  // the six faces, and a plane across every edge asked for
  const planes = [];
  for (let i = 0; i < 3; i++) {
    for (const sign of [-1, 1]) {
      const normal = [0, 0, 0];
      normal[i] = sign;
      planes.push({ normal, dist: sign > 0 ? max[i] : -min[i] });
    }
  }
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]])
    for (const si of [-1, 1])
      for (const sj of [-1, 1]) {
        if (!want(i, j, si, sj)) continue;
        const normal = [0, 0, 0];
        normal[i] = si / Math.SQRT2;
        normal[j] = sj / Math.SQRT2;
        const corner = (si > 0 ? max[i] : min[i]) * si + (sj > 0 ? max[j] : min[j]) * sj;
        planes.push({ normal, dist: (corner - bevel) / Math.SQRT2 });
      }
  // its corners: where three planes meet, inside all the others
  const points = [];
  for (let a = 0; a < planes.length; a++)
    for (let b = a + 1; b < planes.length; b++)
      for (let c = b + 1; c < planes.length; c++) {
        const [p, q, r] = [planes[a], planes[b], planes[c]];
        const det = dot(p.normal, cross(q.normal, r.normal));
        if (Math.abs(det) < 1e-9) continue;
        const sum = [0, 1, 2].map(
          (k) => (p.dist * cross(q.normal, r.normal)[k] + q.dist * cross(r.normal, p.normal)[k] + r.dist * cross(p.normal, q.normal)[k]) / det,
        );
        const point = sum.map(tidy);
        if (planes.some((plane) => dot(plane.normal, point) > plane.dist + 1e-6)) continue;
        if (!points.some((other) => Math.hypot(...sub(other, point)) < 1e-6)) points.push(point);
      }
  return solid(points, texture);
}

/**
 * A convex solid from its faces' planes, each given by three points that lie on it (the points need not be
 * the solid's corners, and a fourth corner of a face may lie a little off the plane the three give: that is
 * the point of it, for corners rounded to whole units). `inside` is a point within the solid, to turn each
 * plane outwards by. Two solids that give a face the same three points have the same plane there, so they
 * meet without a crack. It throws, in words, when the planes do not close into a sound solid (`shapeOf`).
 */
export function solidOfPlanes(threes, inside, texture) {
  const faces = threes.map((three) => {
    let [p0, p1, p2] = three;
    let plane = planeOf([p0, p1, p2]);
    if (!plane) throw new Error(`solidOfPlanes: a face with no area: its points ${JSON.stringify(three)} are in a line`);
    if (dot(plane.normal, inside) - plane.dist > 0) {
      [p0, p2] = [p2, p0];
      plane = planeOf([p0, p1, p2]);
    }
    return faceOf([p0, p1, p2], plane.normal, texture);
  });
  const brush = { faces };
  const { faults } = shapeOf(brush);
  if (faults.length) throw new Error(`solidOfPlanes: the planes do not make a sound solid: ${faults[0]}`);
  return brush;
}

/**
 * Any convex solid, from its corners. With the points alone its faces are found for you; `faces` (a list of
 * index triples, one a face, in any order) names them yourself, which is faster for many points. Either way
 * the planes are turned outwards for you, and a set of points that is not the corners of a convex solid is
 * refused in words: a brush is convex, and a shape that is not has to be made of several.
 */
export function solid(points, texture, { faces } = {}) {
  if (!Array.isArray(points) || points.length < 4)
    throw new Error(`solid: a solid has four corners at least, not ${points?.length}`);
  for (const point of points)
    if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite))
      throw new Error(`solid: a corner is [x, y, z], not ${JSON.stringify(point)}`);
  const planes = faces ? solidPlanes(points, faces) : hullPlanes(points);
  return { faces: planes.map(({ normal, points: three }) => faceOf(three, normal, texture)) };
}

/**
 * A prism: the convex outline `outline` (2D points, either way round) drawn out along `axis` ("x", "y" or
 * "z") from `from` to `to`. The outline's two coordinates are those of the other two axes, in their order:
 * (y, z) along x, (x, z) along y, (x, y) along z. A tunnel's chamfer is a three-sided one along the tunnel;
 * a room's corner cut at 45 degrees is one along z; a beam at a slant is a four-sided one.
 */
export function prism(axis, outline, from, to, texture) {
  const along = axisIndex(axis, "prism");
  if (!(to > from)) throw new Error(`prism: no length: from ${from} to ${to}`);
  if (!Array.isArray(outline) || outline.length < 3)
    throw new Error("prism: an outline has three points at least");
  const count = outline.length;
  const points = [
    ...outline.map((point) => placed(along, from, point)),
    ...outline.map((point) => placed(along, to, point)),
  ];
  // the two ends, then one side for each edge of the outline
  const faces = [
    [0, 1, 2],
    [count, count + 1, count + 2],
    ...outline.map((_, i) => [i, (i + 1) % count, count + i]),
  ];
  return solid(points, texture, { faces });
}

/**
 * A wedge: the box from `min` to `max` cut from one bottom edge to the opposite top edge, a ramp. `high` is
 * the side its top is at: "+x", "-x", "+y" or "-y". With `{ under: true }` it hangs instead: the slope looks
 * down, for a sloped ceiling. Its sloped face wears its picture along the slope, not stretched.
 */
export function wedge(min, max, high, texture, { under = false } = {}) {
  const side = SIDES[high];
  if (!side) throw new Error(`wedge: the high side is "+x", "-x", "+y" or "-y", not ${high}`);
  const tall = side.sign > 0 ? max[side.axis] : min[side.axis];
  const low = side.sign > 0 ? min[side.axis] : max[side.axis];
  const outline = under
    ? [
        [low, max[2]],
        [tall, max[2]],
        [tall, min[2]],
      ]
    : [
        [low, min[2]],
        [tall, min[2]],
        [tall, max[2]],
      ];
  const across = side.axis === 0 ? 1 : 0;
  return prism(across, outline, min[across], max[across], texture);
}

/** The corners of a regular outline of `sides` round `centre`, turned by `turn` degrees, snapped to `snap`. */
function ring(centre, radius, sides, turn, snap) {
  const [radiusA, radiusB] = Array.isArray(radius) ? radius : [radius, radius];
  return Array.from({ length: sides }, (_, index) => {
    const angle = ((turn + (360 * index) / sides) * Math.PI) / 180;
    return [
      toGrid(centre[0] + radiusA * Math.cos(angle), snap),
      toGrid(centre[1] + radiusB * Math.sin(angle), snap),
    ];
  });
}

/**
 * A cylinder, as near as flat sides come: a prism of `sides` sides (12 unless told) round `centre` (its two
 * coordinates across `axis`, as a prism's), from `from` to `to` along the axis. `radius` is a number, or
 * [a, b] for an oval. `turn` (degrees) turns it about its axis: a corner is at angle 0 unless turned.
 * `snap: 1` rounds its corners to whole units, which keeps every plane on the grid (see `offGrid`). `scale`
 * as `box`'s.
 */
export function cylinder(axis, centre, radius, from, to, texture, { sides = 12, turn = 0, snap = 0, scale } = {}) {
  if (!(sides >= 3)) throw new Error(`cylinder: three sides at least, not ${sides}`);
  return prism(axis, withoutRepeats(ring(centre, radius, sides, turn, snap)), from, to, withScale(texture, scale));
}

/**
 * A cone: `sides` sides from a ring of `radius` at `from` to a point at `to` (which may be below `from`:
 * it then points down). `top` is the radius it is cut off at instead of coming to a point (a tapering
 * post, a lamp shade). `turn` and `snap` as a cylinder's; with `top`, only the wide ring is snapped.
 */
export function cone(
  axis,
  centre,
  radius,
  from,
  to,
  texture,
  { sides = 12, turn = 0, snap = 0, top = 0 } = {},
) {
  const along = axisIndex(axis, "cone");
  if (!(sides >= 3)) throw new Error(`cone: three sides at least, not ${sides}`);
  if (from === to) throw new Error(`cone: no height: from ${from} to ${to}`);
  const wide = withoutRepeats(ring(centre, radius, sides, turn, snap));
  const count = wide.length;
  const widest = Math.max(...(Array.isArray(radius) ? radius : [radius]));
  const points = wide.map((point) => placed(along, from, point));
  const faces = [[0, 1, 2]];
  if (top > 0) {
    // the narrow ring is the wide one drawn in towards the axis, so that every side stays flat
    const share = top / widest;
    for (const point of wide)
      points.push(
        placed(along, to, [
          centre[0] + (point[0] - centre[0]) * share,
          centre[1] + (point[1] - centre[1]) * share,
        ]),
      );
    faces.push([count, count + 1, count + 2]);
    for (let i = 0; i < count; i++) faces.push([i, (i + 1) % count, count + i]);
  } else {
    points.push(placed(along, to, centre));
    for (let i = 0; i < count; i++) faces.push([i, (i + 1) % count, count]);
  }
  return solid(points, texture, { faces });
}

/** The point at `angle` (degrees) and `radius` from a 2D centre, snapped. */
const onCircle = (centre, radius, angle, snap) => {
  const radians = (angle * Math.PI) / 180;
  return [
    toGrid(centre[0] + radius * Math.cos(radians), snap),
    toGrid(centre[1] + radius * Math.sin(radians), snap),
  ];
};

/** Where the ray from `centre` at `angle` (degrees) leaves the rectangle `min`..`max`. */
function leavesAt(centre, angle, min, max) {
  const radians = (angle * Math.PI) / 180;
  const way = [tidy(Math.cos(radians)), tidy(Math.sin(radians))];
  let reach = Infinity;
  for (let i = 0; i < 2; i++) {
    if (way[i] > 0) reach = Math.min(reach, (max[i] - centre[i]) / way[i]);
    if (way[i] < 0) reach = Math.min(reach, (min[i] - centre[i]) / way[i]);
  }
  return [tidy(centre[0] + way[0] * reach), tidy(centre[1] + way[1] * reach)];
}

/**
 * An arch: a curve made of straight convex pieces, one brush each. Seen along `axis`, the pieces lie between
 * the circle of `radius` round `centre` and an outer bound, from angle `angles[0]` to `angles[1]` (degrees,
 * anticlockwise from the first of the two coordinates across the axis; 0 to 180 unless told), and each is
 * drawn out from `from` to `to` as a prism is.
 *
 *   outer: a number          a ring of that outer radius: a vault's stones, a curved wall, a round window's rim
 *   outer: { min, max }      a rectangle (2D): what is left of it outside the curve. This is the masonry
 *                            round an arched doorway: set it in a wall's opening of the rectangle's size
 *   pieces                   how many brushes the curve is made of (8 unless told); the opening is the polygon
 *                            of their chords, not a true circle
 *   snap: 1                  rounds every corner to whole units
 *
 * The centre has to be inside the rectangle or on its edge. It returns the list of brushes.
 */
export function arch(
  axis,
  { centre, radius, outer, angles = [0, 180], pieces = 8, snap = 0 },
  from,
  to,
  texture,
) {
  const along = axisIndex(axis, "arch");
  const [start, end] = angles;
  if (!(pieces >= 1)) throw new Error(`arch: one piece at least, not ${pieces}`);
  if (!(end > start) || end - start > 360)
    throw new Error(`arch: angles run upwards, 360 at most: ${angles}`);
  if ((end - start) / pieces >= 180) throw new Error("arch: a piece cannot span half a turn: more pieces");
  const ringOuter = typeof outer === "number";
  if (ringOuter && !(outer > radius))
    throw new Error(`arch: the outer radius ${outer} is not beyond ${radius}`);
  if (!ringOuter && !(outer?.min && outer?.max)) throw new Error("arch: outer is a radius or { min, max }");
  if (!ringOuter && [0, 1].some((i) => centre[i] < outer.min[i] || centre[i] > outer.max[i]))
    throw new Error("arch: the centre is outside the rectangle");
  const corners = ringOuter
    ? []
    : [
        [outer.max[0], outer.max[1]],
        [outer.min[0], outer.max[1]],
        [outer.min[0], outer.min[1]],
        [outer.max[0], outer.min[1]],
      ];
  /** A corner's angle from the centre, counted on from `after`. */
  const angleFrom = (corner, after) => {
    const angle = (Math.atan2(corner[1] - centre[1], corner[0] - centre[0]) * 180) / Math.PI;
    return after + ((((angle - after) % 360) + 360) % 360);
  };
  const brushes = [];
  for (let piece = 0; piece < pieces; piece++) {
    const first = start + ((end - start) * piece) / pieces;
    const second = start + ((end - start) * (piece + 1)) / pieces;
    const outline = [onCircle(centre, radius, first, snap), onCircle(centre, radius, second, snap)];
    if (ringOuter) {
      outline.push(onCircle(centre, outer, second, snap), onCircle(centre, outer, first, snap));
    } else {
      // round the rectangle from the second ray back to the first, by way of the corners between them
      const between = corners
        .map((corner) => ({ corner, angle: angleFrom(corner, first) }))
        .filter(({ angle }) => angle > first + ON_PLANE && angle < second - ON_PLANE)
        .sort((a, b) => b.angle - a.angle);
      const leaves = (angle) => leavesAt(centre, angle, outer.min, outer.max).map((value) => (snap ? toGrid(value, snap) : value));
      outline.push(leaves(second));
      for (const { corner } of between) outline.push(corner);
      outline.push(leaves(first));
    }
    const clean = withoutRepeats(outline);
    // a piece the curve leaves nothing of (the circle touches the rectangle there) is left out
    if (clean.length >= 3) brushes.push(prism(along, clean, from, to, texture));
  }
  return brushes;
}

/**
 * A passage that turns: the shell of a corridor bent round `centre` ([x, y]) in plan, as floor, ceiling and
 * two walls of `pieces` straight pieces each. The walkable space is between the radii `inner` and `outer`,
 * from `floor` to `ceiling`, over `angles` (degrees, anticlockwise from +x). `wall` is how thick the shell
 * is (16 unless told). `texture` is `{ floor, ceiling, wall }` or anything a builder takes.
 *
 * Its two ends are open and flat: at angles that are multiples of 90 they are square to the axes and meet a
 * box-shaped room or passage without a gap. `snap: 1` rounds the corners to whole units.
 * It returns the list of brushes.
 */
export function bend(
  { centre, inner, outer, floor, ceiling, wall = 16, angles, pieces = 6, snap = 0 },
  texture,
) {
  if (!(outer > inner && inner >= 0))
    throw new Error(`bend: radii ${inner} to ${outer}: outer beyond inner, neither under 0`);
  if (!(ceiling > floor)) throw new Error(`bend: no height: floor ${floor}, ceiling ${ceiling}`);
  if (!Array.isArray(angles) || !(angles[1] > angles[0]))
    throw new Error("bend: angles: [from, to], upwards");
  const wears = roomTextures(texture);
  const shell = { centre, angles, pieces, snap };
  const everywhere = { top: wears.floor, bottom: wears.ceiling, sides: wears.wall };
  const slab = { ...shell, radius: Math.max(0, inner - wall), outer: outer + wall };
  const brushes = [
    ...ringPieces(slab, floor - wall, floor, everywhere),
    ...ringPieces(slab, ceiling, ceiling + wall, everywhere),
    ...ringPieces({ ...shell, radius: outer, outer: outer + wall }, floor, ceiling, everywhere),
  ];
  if (inner > 0)
    brushes.push(
      ...ringPieces(
        { ...shell, radius: Math.max(0, inner - wall), outer: inner },
        floor,
        ceiling,
        everywhere,
      ),
    );
  return brushes;
}

/** A ring's pieces along z; one whose inner radius is 0 is a run of three-sided pieces round the centre. */
function ringPieces({ centre, radius, outer, angles, pieces, snap }, from, to, texture) {
  if (radius > 0) return arch(2, { centre, radius, outer, angles, pieces, snap }, from, to, texture);
  const brushes = [];
  for (let piece = 0; piece < pieces; piece++) {
    const first = angles[0] + ((angles[1] - angles[0]) * piece) / pieces;
    const second = angles[0] + ((angles[1] - angles[0]) * (piece + 1)) / pieces;
    const outline = [
      [...centre],
      onCircle(centre, outer, first, snap),
      onCircle(centre, outer, second, snap),
    ];
    brushes.push(prism(2, outline, from, to, texture));
  }
  return brushes;
}

/**
 * Stairs: the box from `min` to `max` filled with steps that climb towards the side `high` ("+x", "-x",
 * "+y", "-y"), each a box that stands on the floor of the flight. `steps` is how many; without it there are
 * as many as keep each no taller than `rise` (16 unless told). A step taller than 18 is refused: a player
 * walks up 18 at most. It returns the list of brushes.
 *
 * As it always was, the highest step is level with the top of the box: where the upper floor goes on from
 * the box's high side, that step is only more floor, and the run is shared among all the steps, so that a
 * run that is no multiple of their number puts their edges off the grid. Two options change that, and only
 * a flight that asks is changed:
 *   top: false   no step level with the top: the last riser climbs onto the upper floor at the box's high
 *                side, and each step is a slab of its own tread (it does not run on under the next)
 *   tread        how deep each step is, in units: the steps are laid from the high side down, each that
 *                deep, so that they stay on the grid whatever the box's run; what the box has over is
 *                floor. A run too short for them is refused. With `top: false` and no tread, the run is
 *                shared among the steps there are. A slab of `top: false` stands on the box's floor
 * With `top: false` the highest step comes first in the list.
 *
 * `open: 8` makes each step a tread that thick with nothing under it (a fire escape, an open-riser stair).
 * `ramp: "CLIP"` (or any texture) adds, last in the list, a wedge laid on the steps' nosings, from the floor
 * one step's depth before the first riser to the top: a player walks up it smoothly instead of climbing
 * each step (what boxy stairs "feel wrong" for), while shots and grenades, which a CLIP brush does not
 * stop, still meet the steps. Where the box has no room before the first riser, the foot of the ramp is
 * the box's low side, and the ramp a little steeper.
 */
export function stairs(min, max, high, texture, { steps, rise = 16, top = true, tread, ramp, open } = {}) {
  if (ramp !== undefined) {
    const flight = stairs(min, max, high, texture, { steps, rise, top, tread, open });
    return [...flight, stairRamp(min, max, high, ramp, { steps, rise, top, tread })];
  }
  if (open !== undefined) return openFlight(min, max, high, texture, { steps, rise, top, tread, open });
  const side = SIDES[high];
  if (!side) throw new Error(`stairs: the high side is "+x", "-x", "+y" or "-y", not ${high}`);
  for (let i = 0; i < 3; i++)
    if (!(max[i] > min[i])) throw new Error(`stairs: no size along ${AXIS_NAMES[i]}`);
  if (typeof top !== "boolean") throw new Error(`stairs: top is true or false, not ${JSON.stringify(top)}`);
  if (tread !== undefined && !(typeof tread === "number" && tread > 0))
    throw new Error(`stairs: tread is how deep a step is, in units over 0, not ${JSON.stringify(tread)}`);
  const height = max[2] - min[2];
  const count = steps ?? Math.ceil(height / rise);
  if (!(count >= 1) || !Number.isInteger(count))
    throw new Error(`stairs: a whole number of steps, not ${count}`);
  if (height / count > STEP_HEIGHT)
    throw new Error(
      `stairs: ${count} steps of ${mapNumber(height / count)} each: a player walks up ${STEP_HEIGHT} at most, so ${Math.ceil(height / STEP_HEIGHT)} steps or more`,
    );
  // the steps there are: one fewer where the upper floor is the last of them
  const made = top ? count : count - 1;
  const length = max[side.axis] - min[side.axis];
  if (tread !== undefined && tread * made > length)
    throw new Error(
      `stairs: ${made} steps of ${mapNumber(tread)} are ${mapNumber(tread * made)} long, and the box runs ${mapNumber(length)} towards ${high}`,
    );
  if (!top || tread !== undefined) {
    const deep = tread ?? length / made;
    const edge = side.sign > 0 ? max[side.axis] : min[side.axis];
    const brushes = [];
    // from the high side down: the step under the upper floor's edge first
    for (let step = made; step >= 1; step--) {
      const low = [...min];
      const upper = [...max];
      upper[2] = min[2] + (height * step) / count;
      // as ever, a flight with its top step is stacked, each on the one under it; a slab stands on the floor
      if (top) low[2] = min[2] + (height * (step - 1)) / count;
      // without its top step a step is a slab of its own tread; with it, as ever, it runs on to the high side
      const front = edge - side.sign * (made - step + 1) * deep;
      const back = top ? edge : edge - side.sign * (made - step) * deep;
      low[side.axis] = Math.min(front, back);
      upper[side.axis] = Math.max(front, back);
      brushes.push(box(low, upper, texture));
    }
    return top ? brushes.reverse() : brushes;
  }
  const run = length / count;
  const brushes = [];
  for (let step = 0; step < count; step++) {
    const low = [...min];
    const top = [...max];
    low[2] = min[2] + (height * step) / count;
    top[2] = min[2] + (height * (step + 1)) / count;
    // each step runs from its own front edge to the high end of the flight
    if (side.sign > 0) low[side.axis] = min[side.axis] + run * step;
    else top[side.axis] = max[side.axis] - run * step;
    brushes.push(box(low, top, texture));
  }
  return brushes;
}

/**
 * The flight `stairs` makes with `open`: each step a tread `open` thick with nothing under it, as a fire escape's,
 * a gallery's or an open-riser stair's are; laid as the solid flight would lay them (the same heights and depths).
 */
function openFlight(min, max, high, texture, { steps, rise, top, tread, open }) {
  if (!(typeof open === "number" && open > 0)) throw new Error(`stairs: open is a tread's thickness, over 0, not ${JSON.stringify(open)}`);
  const solidSteps = stairs(min, max, high, texture, { steps, rise, top, tread });
  const side = SIDES[high];
  return solidSteps.map((brush, n) => {
    const shape = shapeOf(brush);
    const lo = [...shape.min];
    const hi = [...shape.max];
    // a step of a flight with its top step reaches on to the high side: its own tread is its front's depth
    const deep = tread ?? (max[side.axis] - min[side.axis]) / solidSteps.length;
    if (top) {
      if (side.sign > 0) hi[side.axis] = Math.min(hi[side.axis], lo[side.axis] + deep);
      else lo[side.axis] = Math.max(lo[side.axis], hi[side.axis] - deep);
    }
    lo[2] = Math.max(lo[2], hi[2] - open);
    return box(lo.map(tidy), hi.map(tidy), texture);
  });
}

/** The ramp `stairs` lays on its steps with `ramp`: from one step's depth before the first riser to the top. */
function stairRamp(min, max, high, texture, { steps, rise = 16, top = true, tread }) {
  const side = SIDES[high];
  const count = steps ?? Math.ceil((max[2] - min[2]) / rise);
  const length = max[side.axis] - min[side.axis];
  const deep = tread ?? (top ? length / count : length / (count - 1));
  const edge = side.sign > 0 ? max[side.axis] : min[side.axis];
  const lowSide = side.sign > 0 ? min[side.axis] : max[side.axis];
  // the nosings lie on one line: it is at the top where the highest step's front is (the box's high side,
  // where the upper floor is the last step), and at the floor `count` steps' depth before that
  const head = top ? edge - side.sign * deep : edge;
  const foot = head - side.sign * count * deep;
  if (side.sign * (foot - lowSide) >= 0) {
    const low = [...min];
    const upper = [...max];
    low[side.axis] = Math.min(foot, head);
    upper[side.axis] = Math.max(foot, head);
    return wedge(low, upper, high, texture);
  }
  // no room before the first riser: the ramp stays on the nosings and stands on a lip at the box's low side
  const lip = min[2] + ((max[2] - min[2]) * side.sign * (lowSide - foot)) / (count * deep);
  const outline = [
    [lowSide, min[2]],
    [head, min[2]],
    [head, max[2]],
    [lowSide, lip],
  ];
  const across = side.axis === 0 ? 1 : 0;
  return prism(across, outline, min[across], max[across], texture);
}

/**
 * Carved rock: a ceiling or a floor that is not flat, the way terrain is made in GoldSrc. A grid of `step`
 * ([x, y] units) over `min`..`max` (2D, in plan) is cut in triangles, and each triangle is one brush that
 * runs from the flat `base` to `height(x, y)` at its three corners. With `base` ABOVE the heights it hangs
 * from a ceiling; below them it is ground.
 *
 * The care it takes: every height is rounded to `grid` (1 unless told), so that neighbours share their
 * corners exactly and no crack opens between them; the diagonal alternates from cell to cell, so that the
 * rock has no grain; and a height that meets the base, or lies on the other side of it from the rest, is
 * refused in words, since the brush there would have no thickness. It returns the list of brushes.
 *
 * `axis: "x"` or `"y"` stands it up: the heights run along that axis and `min`, `max`, `step` and
 * `height(a, b)` are in the other two, in their order as a prism's ((y, z) along x, (x, z) along y). A
 * cliff's face, a cave's rough wall, a bank of rock beside a path.
 */
export function terrain({ min, max, step, base, height, texture, grid = 1, axis = "z" }) {
  const along = axisIndex(axis, "terrain");
  if (!(step?.[0] > 0 && step?.[1] > 0)) throw new Error(`terrain: step is [x, y], both over 0, not ${step}`);
  if (!(max[0] > min[0] && max[1] > min[1])) throw new Error("terrain: no size: max is not beyond min");
  const marks = [0, 1].map((i) => {
    const list = [];
    // counted, not added up step by step: the sum's error would leave a last column a hair wide
    const count = Math.max(1, Math.ceil((max[i] - min[i]) / step[i] - 1e-6));
    for (let k = 0; k < count; k++) list.push(min[i] + k * step[i]);
    list.push(max[i]);
    return list;
  });
  const [xs, ys] = marks;
  let above;
  const brushes = [];
  for (let i = 0; i + 1 < xs.length; i++)
    for (let j = 0; j + 1 < ys.length; j++) {
      const cell = [
        [xs[i], ys[j]],
        [xs[i + 1], ys[j]],
        [xs[i + 1], ys[j + 1]],
        [xs[i], ys[j + 1]],
      ];
      const triangles =
        (i + j) % 2
          ? [
              [cell[0], cell[1], cell[2]],
              [cell[0], cell[2], cell[3]],
            ]
          : [
              [cell[0], cell[1], cell[3]],
              [cell[1], cell[2], cell[3]],
            ];
      for (const triangle of triangles) {
        const heights = triangle.map(([x, y]) => toGrid(height(x, y), grid));
        for (const [corner, value] of heights.entries()) {
          const where = `at ${triangle[corner].join(" ")}`;
          if (!Number.isFinite(value)) throw new Error(`terrain: the height ${where} is ${value}`);
          if (value === base)
            throw new Error(
              `terrain: the height ${where} meets the base ${base}: the rock would have no thickness there`,
            );
          above ??= value > base;
          if (value > base !== above)
            throw new Error(
              `terrain: the height ${where} (${value}) is on the other side of the base ${base} from the rest`,
            );
        }
        const points = [
          ...triangle.map((point) => placed(along, base, point)),
          ...triangle.map((point, corner) => placed(along, heights[corner], point)),
        ];
        const faces = [
          [0, 1, 2],
          [3, 4, 5],
          [0, 1, 3],
          [1, 2, 4],
          [2, 0, 5],
        ];
        brushes.push(solid(points, texture, { faces }));
      }
    }
  return brushes;
}

// ── rooms ───────────────────────────────────────────────────────────────────
/** A room's three textures from what was given: `{ floor, ceiling, wall }`, or one thing for all three. */
function roomTextures(texture) {
  const named = texture && typeof texture === "object" && !texture.name;
  if (named && (texture.floor || texture.ceiling || texture.wall)) {
    const any = texture.wall ?? texture.floor ?? texture.ceiling;
    return { floor: texture.floor ?? any, ceiling: texture.ceiling ?? any, wall: texture.wall ?? any };
  }
  return { floor: texture, ceiling: texture, wall: texture };
}

/**
 * A sealed room of six walls: floor, ceiling and four walls of thickness `wall` AROUND the space from `min`
 * to `max`, so that the space is exactly what was asked for. The walls overlap at the corners on purpose: no
 * gap is left for the void to get in by (a leak). `texture`: `{ floor, ceiling, wall }`, or one for all.
 * It returns the six brushes, in that order: floor, ceiling, west, east, south, north.
 */
export function hollow(min, max, wall, texture) {
  if (!(wall > 0)) throw new Error(`hollow: the walls need a thickness, not ${wall}`);
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const wears = roomTextures(texture);
  return [
    box([x0 - wall, y0 - wall, z0 - wall], [x1 + wall, y1 + wall, z0], wears.floor),
    box([x0 - wall, y0 - wall, z1], [x1 + wall, y1 + wall, z1 + wall], wears.ceiling),
    box([x0 - wall, y0 - wall, z0], [x0, y1 + wall, z1], wears.wall),
    box([x1, y0 - wall, z0], [x1 + wall, y1 + wall, z1], wears.wall),
    box([x0, y0 - wall, z0], [x1, y0, z1], wears.wall),
    box([x0, y1, z0], [x1, y1 + wall, z1], wears.wall),
  ];
}

/**
 * What is left of the box `solidBox` (`{ min, max }`) with the box `hole` taken out: up to six boxes that do
 * not overlap. It is cut along x, then y, then z, each time within what the cut before left touching the
 * hole. A hole that does not touch the box leaves the box as it was.
 */
export function subtract(solidBox, hole) {
  const touches = [0, 1, 2].every((i) => solidBox.min[i] < hole.max[i] && hole.min[i] < solidBox.max[i]);
  if (!touches) return [solidBox];
  const left = [];
  const min = [...solidBox.min];
  const max = [...solidBox.max];
  for (let i = 0; i < 3; i++) {
    if (min[i] < hole.min[i]) {
      const upTo = [...max];
      upTo[i] = hole.min[i];
      left.push({ min: [...min], max: upTo });
      min[i] = hole.min[i];
    }
    if (max[i] > hole.max[i]) {
      const from = [...min];
      from[i] = hole.max[i];
      left.push({ min: from, max: [...max] });
      max[i] = hole.max[i];
    }
  }
  return left;
}

/**
 * An interior, carved: one solid block that wraps every room of `rooms` (boxes `{ min, max }`) with `wall`
 * units to spare, and the rooms taken out of it. Rooms that touch or overlap join into one space; a doorway
 * or a window is one more small room through the rock between two. Nothing has to be thought out about
 * where each wall goes and no gap can be left: what is not a room is rock, so the map cannot leak.
 *
 * `texture`: `{ floor, ceiling, wall }` (or one for all): every piece of rock wears the floor on its top,
 * the ceiling on its underside and the wall on its sides, which is what is seen from inside a room.
 * A room may bring its own, `{ min, max, texture }`: the rock it is seen from wears that instead (a shop's
 * tiles behind a street's brick front, through one wall 16 thick). A piece of rock that faces two rooms
 * of different textures on one side (the slab under two rooms side by side) is cut where they meet.
 * A room may carry `bands`, `[{ z0, z1, wall }]` (heights in the world, foot to head): the rock beside it is cut
 * at their edges, and each slice's face to the room wears the band it is in, its picture standing on the band's
 * foot, so a wall's texture joins fall on brush edges as Valve's do (src/maps/families.mjs). A room's `wears`,
 * `{ floor, ceiling, wall }`, is its `texture` with what it does not name the carve's (a floor plan's areas).
 * It returns the list of brushes.
 */
export function carve(rooms, wall, texture) {
  if (!Array.isArray(rooms) || !rooms.length) throw new Error("carve: a list of rooms, each { min, max }");
  if (!(wall > 0)) throw new Error(`carve: the rock round the rooms needs a thickness, not ${wall}`);
  rooms.forEach((room, index) => {
    for (let i = 0; i < 3; i++)
      if (!(room.max?.[i] > room.min?.[i]))
        throw new Error(`carve: room ${index} has no size along ${AXIS_NAMES[i]}`);
  });
  const min = [0, 1, 2].map((i) => Math.min(...rooms.map((room) => room.min[i])) - wall);
  const max = [0, 1, 2].map((i) => Math.max(...rooms.map((room) => room.max[i])) + wall);
  let rock = [{ min, max }];
  for (const room of rooms) rock = rock.flatMap((piece) => subtract(piece, room));
  // a banded room's walls: each piece of rock beside it cut at its bands' edges, so that each slice's face to
  // the room is one band
  const beside = (piece, room) =>
    [0, 1].some((axis) => (Math.abs(piece.max[axis] - room.min[axis]) < 1e-6 || Math.abs(piece.min[axis] - room.max[axis]) < 1e-6) && [0, 1, 2].filter((k) => k !== axis).every((k) => Math.min(piece.max[k], room.max[k]) - Math.max(piece.min[k], room.min[k]) > 0));
  if (rooms.some((room) => room.bands?.length))
    rock = rock.flatMap((piece) => {
      const cuts = [...new Set(rooms.filter((room) => room.bands?.length && beside(piece, room)).flatMap((room) => room.bands.slice(1).map((band) => band.z0)))].filter((z) => z > piece.min[2] + 1e-6 && z < piece.max[2] - 1e-6).sort((a, b) => a - b);
      const edges = [piece.min[2], ...cuts, piece.max[2]];
      return edges.slice(1).map((z1, k) => ({ min: [piece.min[0], piece.min[1], edges[k]], max: [piece.max[0], piece.max[1], z1] }));
    });
  const wears = roomTextures(texture);
  // each room's own, or the carve's; then each face of each piece by the room it is seen from
  const own = rooms.map((room) =>
    room.texture !== undefined ? roomTextures(room.texture) : room.wears ? { ...wears, ...room.wears } : wears,
  );
  const pieces = rooms.some((room) => room.texture !== undefined || room.wears)
    ? rock.flatMap((piece) => cutForRooms(piece, rooms, own))
    : rock;
  return pieces.map((piece) => {
    const sides = {};
    for (const side of CARVE_SIDES) {
      const seen = mostFacing(piece, side, rooms);
      const of = seen === undefined ? wears : own[seen];
      if (side.axis === 2) sides[side.name] = side.least ? of.ceiling : of.floor;
      // a wall's picture stands on the floor of the room it faces and starts at its corner, as a mapper lines
      // it up: its bands, its skirting and its seams fall where they were painted to, whatever the room's height
      // (from stevenlafl/smak: Steven's play-test, "texture alignment is off")
      else if (seen === undefined) sides[side.name] = of.wall;
      else {
        // a banded room's slice wears its band, standing on the band's foot
        const middle = (piece.min[2] + piece.max[2]) / 2;
        const band = rooms[seen].bands?.find((b) => middle >= b.z0 && middle <= b.z1);
        const wall = band?.wall ?? of.wall;
        sides[side.name] = onFloor(wall, band ? band.z0 : rooms[seen].min[2], rooms[seen].min[side.axis === 0 ? 1 : 0]);
      }
    }
    return box(piece.min, piece.max, sides);
  });
}

/**
 * A wall's texture lined up so that its bottom edge stands on a floor at `z` and its left edge on the room's
 * corner at `corner` along the wall (a wall's picture runs along +x or +y, and down -z): its offsets moved to
 * them in its own scale. A texture given by direction or by rule, turned, or aligned its own way is left as it is.
 */
export function onFloor(texture, z, corner = 0) {
  const fit = typeof texture === "string" ? { name: texture } : texture;
  if (!fit || typeof fit !== "object" || typeof fit.name !== "string" || fit.rotation || fit.align) return texture;
  const [su, sv] = Array.isArray(fit.scale) ? fit.scale : [fit.scale ?? 1, fit.scale ?? 1];
  const offset = fit.offset ?? [0, 0];
  return { ...fit, offset: [offset[0] - corner / su, offset[1] + z / sv] };
}

/** The room a side of a piece of rock is seen from the most of (its number), or undefined when none sees it. */
function mostFacing(piece, side, rooms) {
  let best;
  let most = 0;
  for (const nth of facingRooms(piece, side, rooms)) {
    const room = rooms[nth];
    const shared = [0, 1, 2]
      .filter((i) => i !== side.axis)
      .reduce((area, i) => area * (Math.min(piece.max[i], room.max[i]) - Math.max(piece.min[i], room.min[i])), 1);
    if (shared > most) [best, most] = [nth, shared];
  }
  return best;
}

/** The six sides of a box of rock, as `box` names them: the axis, and whether it is the box's least end. */
const CARVE_SIDES = [
  { name: "west", axis: 0, least: true },
  { name: "east", axis: 0, least: false },
  { name: "south", axis: 1, least: true },
  { name: "north", axis: 1, least: false },
  { name: "bottom", axis: 2, least: true },
  { name: "top", axis: 2, least: false },
];

/** The rooms (their numbers) a side of a piece of rock is seen from: a room whose opposite face lies on it. */
function facingRooms(piece, side, rooms) {
  const plane = side.least ? piece.min[side.axis] : piece.max[side.axis];
  const found = [];
  rooms.forEach((room, nth) => {
    if ((side.least ? room.max : room.min)[side.axis] !== plane) return;
    for (let i = 0; i < 3; i++)
      if (i !== side.axis && !(room.min[i] < piece.max[i] && piece.min[i] < room.max[i])) return;
    found.push(nth);
  });
  return found;
}

/** A piece of rock cut until no side of it is seen from two rooms that wear different textures. */
function cutForRooms(piece, rooms, own) {
  for (const side of CARVE_SIDES) {
    const seen = facingRooms(piece, side, rooms);
    if (new Set(seen.map((nth) => JSON.stringify(own[nth]))).size < 2) continue;
    // cut along the side, where the first of those rooms ends inside the piece
    for (const i of [0, 1, 2]) {
      if (i === side.axis) continue;
      const room = rooms[seen[0]];
      for (const at of [room.min[i], room.max[i]]) {
        if (!(at > piece.min[i] && at < piece.max[i])) continue;
        const low = { min: [...piece.min], max: [...piece.max] };
        const high = { min: [...piece.min], max: [...piece.max] };
        low.max[i] = at;
        high.min[i] = at;
        return [...cutForRooms(low, rooms, own), ...cutForRooms(high, rooms, own)];
      }
    }
  }
  return [piece];
}

// ── brushes changed ─────────────────────────────────────────────────────────
/**
 * A brush, or a list of them, moved by `by` ([x, y, z]). The pictures move with their faces (the offsets
 * are shifted to keep them where they were on the surface) unless `lock` is false, which leaves them where
 * they were in the world.
 */
export function moved(brushes, by, { lock = true } = {}) {
  if (Array.isArray(brushes)) return brushes.map((brush) => moved(brush, by, { lock }));
  const shifted = (axis, scale) => {
    const offset = lock ? axis[3] - dot(axis, by) / scale : axis[3];
    return [axis[0], axis[1], axis[2], tidy(offset)];
  };
  return {
    faces: brushes.faces.map((face) => ({
      ...face,
      points: face.points.map((point) => plus(point, by)),
      u: shifted(face.u, face.scale[0]),
      v: shifted(face.v, face.scale[1]),
      scale: [...face.scale],
    })),
  };
}

/**
 * A brush, or a list of them, with every face's picture at `scale` (a number, or [x, y]: units a texel), the rest
 * of each face as it was: `scaled(sweepProfile(...), 0.5)` draws a cornice's moulding twice as fine. A face whose
 * offset is not 0 keeps its offset in texels, so its picture slides; a `fitted` picture is better given its scale.
 */
export function scaled(brushes, scale) {
  if (Array.isArray(brushes)) return brushes.map((brush) => scaled(brush, scale));
  const pair = Array.isArray(scale) ? scale : [scale, scale];
  if (pair.length !== 2 || !pair.every((v) => Number.isFinite(v) && v !== 0))
    throw new Error(`scaled: a scale is a number other than 0, or [x, y], not ${JSON.stringify(scale)}`);
  return { faces: brushes.faces.map((face) => ({ ...face, scale: [...pair] })) };
}

/**
 * A brush with each face's plane taken through three of its corners rounded to `grid`: the three that make the
 * widest triangle, in the order that keeps the face looking out. The pictures are not touched.
 */
function snapCorners(brush, grid) {
  const shape = shapeOf(brush);
  return {
    faces: brush.faces.map((face, index) => {
      const { polygon, normal } = shape.faces[index];
      let wide = null;
      for (let i = 0; i < polygon.length; i++)
        for (let j = i + 1; j < polygon.length; j++)
          for (let k = j + 1; k < polygon.length; k++) {
            const area = triangleArea(polygon[i], polygon[j], polygon[k]);
            if (!wide || area > wide.area) wide = { area, points: [polygon[i], polygon[j], polygon[k]] };
          }
      if (!wide || !(wide.area > 0)) return face;
      // each of the three corners goes to the grid point under it or over it on each axis: of the 512 planes
      // those make, the one the face's corners lie nearest
      const options = wide.points.map((point) => {
        let list = [[]];
        for (const value of point) {
          const low = Math.floor(value / grid + 1e-9) * grid;
          const high = Math.ceil(value / grid - 1e-9) * grid;
          list = list.flatMap((rest) => (low === high ? [[...rest, low]] : [[...rest, low], [...rest, high]]));
        }
        return list;
      });
      let best = null;
      for (const a of options[0])
        for (const b of options[1])
          for (const c of options[2]) {
            const plane = planeOf([a, b, c]);
            if (!plane || Math.abs(dot(plane.normal, normal)) < 0.9) continue;
            const error = polygon.reduce((sum, point) => sum + (dot(plane.normal, point) - plane.dist) ** 2, 0);
            if (!best || error < best.error)
              best = { error, points: dot(plane.normal, normal) > 0 ? [a, b, c] : [c, b, a] };
          }
      return best ? { ...face, points: best.points } : face;
    }),
  };
}
const triangleArea = (a, b, c) => Math.hypot(...cross(sub(b, a), sub(c, a))) / 2;

/**
 * A brush, or a list of them, turned `degrees` anticlockwise (seen from above, for the default axis "z")
 * about `pivot` ([x, y, z]; only the two coordinates across the axis matter). A house set at an angle to
 * its street, a wall that follows a hill, a whole part of a map turned. The pictures turn with their faces
 * (texture lock) unless `lock` is false: then each face wears the world's axes again, as a new brush would.
 * Turned at other than a quarter turn, the brush's points are rounded to whole units (`snap` 1, the default;
 * the planes are worked out again from the rounded points, so the compilers get no slivers; a brush the
 * rounding would break, or cut a sliver of a face into, is left unrounded). `snap: 0` keeps the exact points; a number rounds to that grid. A
 * quarter turn is exact and is rounded only when `snap` is given.
 */
export function turned(brushes, degrees, pivot = [0, 0, 0], { axis = "z", lock = true, snap } = {}) {
  if (Array.isArray(brushes) && !brushes.faces)
    return brushes.map((brush) => turned(brush, degrees, pivot, { axis, lock, snap }));
  if (!Number.isFinite(degrees)) throw new Error(`turned: an angle in degrees, not ${degrees}`);
  const about = [0, 0, 0];
  about[axisIndex(axis, "turned")] = 1;
  const angle = (degrees * Math.PI) / 180;
  const centre = [0, 1, 2].map((i) => pivot[i] ?? 0);
  const quarter = Math.abs(degrees / 90 - Math.round(degrees / 90)) < 1e-12;
  const exact = (value) => (quarter ? (Math.round(value) === value ? value : tidy(value)) : tidy(value));
  const rounds = snap ?? (quarter ? 0 : 1);
  if (rounds && snap === undefined) {
    // the default: turned exactly, then each face's plane taken through its corners rounded to the grid
    const exactly = turned(brushes, degrees, pivot, { axis, lock, snap: 0 });
    const tight = snapCorners(exactly, rounds);
    const [rounded, kept] = [shapeOf(tight), shapeOf(exactly)];
    // not where the rounding breaks the brush, or cuts a sliver (a face under 1 square unit) the exact one has not
    const least = (shape) => Math.min(...shape.faces.map((face) => face.area));
    return rounded.faults.length || (least(rounded) < 1 && least(kept) >= 1) ? exactly : tight;
  }
  const turn = (vector) => turnAbout(vector, about, angle);
  const place = (point) => {
    const moved = plus(turn(sub(point, centre)), centre);
    return moved.map((value) => (snap ? toGrid(value, snap) : exact(value)));
  };
  return {
    faces: brushes.faces.map((face) => {
      const points = face.points.map(place);
      if (!lock) {
        const plane = planeOf(points);
        const axes = textureAxes(plane.normal, { align: "auto", rotation: face.rotation ?? 0 });
        return {
          ...face,
          points,
          u: [...axes.u, face.u[3]],
          v: [...axes.v, face.v[3]],
          scale: [...face.scale],
        };
      }
      // the picture at a turned point is the one at the point before: s = p.u / scale + offset
      const keep = (axisOf, scale) => {
        const direction = turn(axisOf.slice(0, 3)).map(tidy);
        const offset = axisOf[3] + (dot(centre, axisOf.slice(0, 3)) - dot(centre, direction)) / scale;
        return [...direction, tidy(offset)];
      };
      return {
        ...face,
        points,
        u: keep(face.u, face.scale[0]),
        v: keep(face.v, face.scale[1]),
        scale: [...face.scale],
      };
    }),
  };
}

/**
 * The points of a brush's planes that are off the grid: those with a coordinate more than `tolerance` from a
 * multiple of `grid`. Planes written with such points are where compile errors come from: a map holds
 * decimals, not the number itself, so two brushes that should share a plane may get planes a hair apart.
 */
export function offGrid(brush, grid = 1, tolerance = 0.01) {
  const off = (value) => Math.abs(value - Math.round(value / grid) * grid) > tolerance;
  return brush.faces.flatMap((face) => face.points.filter((point) => point.some(off)));
}

/**
 * A brush with every point of its planes rounded to `grid`. Rounding moves a plane a little, so the result
 * is worked out again and refused in words if it is no longer a sound brush.
 */
export function snapped(brush, grid = 1) {
  const result = {
    faces: brush.faces.map((face) => ({
      ...face,
      points: face.points.map((point) => point.map((value) => toGrid(value, grid))),
    })),
  };
  const faults = shapeOf(result).faults;
  if (faults.length)
    throw new Error(`snapped: rounded to ${grid}, the brush is broken: ${faults.join("; ")}`);
  return result;
}

// ── entities ────────────────────────────────────────────────────────────────
/**
 * An entity: `{ classname, ...keys }`, with its `brushes` when it is made of some. Every value is turned to
 * text as a map holds it (`valueText`), so an origin may be given as [x, y, z].
 */
export function entity(classname, keys = {}, brushes) {
  if (typeof classname !== "string" || !classname) throw new Error("entity: it needs a classname");
  const made = { classname };
  for (const [key, value] of Object.entries(keys)) {
    if (key === "brushes" || value === undefined) continue;
    made[key] = valueText(value);
  }
  if (brushes?.length) made.brushes = [...brushes];
  return made;
}

/** A point entity: a thing with a place and no shape (a light, a monster, a sound, a place to start). */
export function pointEntity(classname, origin, keys = {}) {
  if (!Array.isArray(origin) || origin.length !== 3) throw new Error(`${classname}: its origin is [x, y, z]`);
  return entity(classname, { origin, ...keys });
}

/**
 * A brush entity: a thing made of brushes (func_wall, func_door, func_illusionary, trigger_once...). Its
 * brushes are no part of the world: they seal nothing, so never close a room with one. One that turns
 * (func_door_rotating, func_rotating) needs an `originBrush` among them, at its hinge.
 */
export function brushEntity(classname, brushes, keys = {}) {
  const list = Array.isArray(brushes) ? brushes.flat() : [brushes];
  if (!list.length || !list.every((brush) => brush?.faces))
    throw new Error(`${classname}: a brush entity needs a brush at least`);
  // a func_detail says its level: SDHLT takes one without the key as world, which cuts the map's leaves (a framed
  // pump hall's 448 leaves became 629, its portals 1802 became 2432, hlvis 43 seconds became 262). The FGD's
  // default of 1 is only what an editor writes for it
  if (classname === "func_detail" && keys.zhlt_detaillevel === undefined) keys = { zhlt_detaillevel: 1, ...keys };
  return entity(classname, keys, list);
}

/** The brush that says where a turning entity's hinge is: a small box round `centre` wearing ORIGIN. */
export function originBrush(centre, size = 8) {
  const half = size / 2;
  return box(plus(centre, [1, 1, 1], -half), plus(centre, [1, 1, 1], half), ORIGIN_TEXTURE);
}

/**
 * A light that shines every way from a point. `color` is [r, g, b] of 0 to 255 (white unless told),
 * `brightness` about 200 for a room's lamp. Other keys go as they are (`_fade`, `style`, `targetname`).
 */
export function light(origin, { color = [255, 255, 255], brightness = 200, ...keys } = {}) {
  return pointEntity("light", origin, { _light: [...color, brightness], ...keys });
}

/** The yaw and pitch (degrees; pitch under 0 looks down) of the way from one point to another. */
const aimOf = (from, at) => {
  const way = unit(sub(at, from));
  const yaw = (Math.atan2(way[1], way[0]) * 180) / Math.PI;
  const pitch = (Math.asin(Math.max(-1, Math.min(1, way[2]))) * 180) / Math.PI;
  return { yaw: tidy(yaw), pitch: tidy(pitch) };
};

/**
 * A spot light: a cone of light from a point. Aim it `at` a point ([x, y, z]), or give `yaw` and `pitch`
 * in degrees (pitch -90 is straight down, the default). `cone` is the cone's half angle (45 unless told),
 * `inner` the half angle of its bright middle.
 */
export function spotLight(
  origin,
  { color = [255, 255, 255], brightness = 300, at, yaw = 0, pitch = -90, cone = 45, inner, ...keys } = {},
) {
  const aim = at ? aimOf(origin, at) : { yaw, pitch };
  return pointEntity("light_spot", origin, {
    _light: [...color, brightness],
    angles: [0, aim.yaw, 0],
    pitch: aim.pitch,
    _cone: cone,
    _cone2: inner,
    ...keys,
  });
}

/**
 * The sun: light that falls from every face that wears the `sky` texture, all one way. `pitch` is how
 * steeply it comes down (-90 straight down, -60 unless told), `yaw` the way it travels in plan. A map needs
 * one at most, anywhere inside it; with no sky faces it lights nothing.
 */
export function sunLight(
  origin,
  { color = [255, 255, 255], brightness = 200, yaw = 0, pitch = -60, ...keys } = {},
) {
  return pointEntity("light_environment", origin, {
    _light: [...color, brightness],
    angles: [0, yaw, 0],
    pitch,
    ...keys,
  });
}

/**
 * Texture lights: every face that wears one of the named textures shines. `lights` is
 * `{ TEXTURE: [r, g, b, brightness] }`. It is an `info_texlights` entity, which Vluzacn's compilers read
 * from the map itself; the older way is a `lights.rad` file beside the compiler.
 */
export function textureLights(origin, lights) {
  return pointEntity("info_texlights", origin, lights);
}

/**
 * Where a player starts: `floorPoint` is the point of the floor to stand on, and the entity's origin is
 * written 36 above it (a player's origin is the middle of its body). `yaw` is the way it faces, in degrees
 * anticlockwise from +x. `classname` for a mod that names its starts otherwise.
 */
export function playerStart(floorPoint, yaw = 0, classname = "info_player_start") {
  const origin = plus(floorPoint, [0, 0, 1], PLAYER_ORIGIN_HEIGHT);
  return pointEntity(classname, origin, { angles: [0, yaw, 0] });
}

// ── the file ────────────────────────────────────────────────────────────────
const quoted = (text) => `"${text}"`;
const pointText = (point) => `( ${point.map(mapNumber).join(" ")} )`;
const axisText = (axis) => `[ ${axis.map(mapNumber).join(" ")} ]`;

/** One face as its line of the file. */
function faceLine(face) {
  const numbers = [face.rotation, ...face.scale].map(mapNumber).join(" ");
  return `${face.points.map(pointText).join(" ")} ${face.texture} ${axisText(face.u)} ${axisText(face.v)} ${numbers}`;
}

/** One entity as its block of the file: its keys, then its brushes. */
function entityBlock(keys, brushes = []) {
  const lines = ["{"];
  for (const [key, value] of Object.entries(keys)) {
    if (value === undefined) continue;
    if (/["\r\n]/.test(key)) throw new Error(`a key in a map cannot hold a quote or a line break: ${key}`);
    lines.push(`${quoted(key)} ${quoted(valueText(value))}`);
  }
  for (const brush of brushes) {
    if (!brush?.faces)
      throw new Error(`a brush is { faces }, not ${typeof brush}: was a list of brushes not spread?`);
    lines.push("{", ...brush.faces.map(faceLine), "}");
  }
  lines.push("}");
  return lines.join("\n");
}

/**
 * The whole `.map` as text, in Valve 220: worldspawn with the world's brushes first, as the editors write
 * it, then the entities.
 *   worldspawn   its keys: `wad` (the .wad files the textures are in: a list, or text with `;` between),
 *                `skyname`, `MaxRange` (how far the game draws, 4096 unless told), `light`, a `message`...
 *   brushes      the world: only these seal the map
 *   entities     each `{ classname, ...keys }`, with its own `brushes` when it is made of some
 */
export function writeMap({ worldspawn = {}, brushes = [], entities = [] }) {
  const { classname: _ignored, ...keys } = worldspawn;
  if (Array.isArray(keys.wad)) keys.wad = keys.wad.join(";");
  const world = entityBlock({ classname: "worldspawn", mapversion: MAP_VERSION, ...keys }, brushes.flat());
  // a class that precaches its model, with none named, stops the map on load: no map is written with one
  const empty = modelless(entities, (entity, key) => entity[key]);
  if (empty.length)
    throw new Error(`writeMap: ${empty.map(({ entity, index }) => `entity ${index + 1} (${entity.classname})`).join(", ")} precache a model and name none: the map would stop on load ("PF_precache_model_I: Bad string ''"). Give each its model (a sprite for env_sprite and env_glow)`);
  const others = entities.map(({ brushes: own, ...entityKeys }) => {
    if (!entityKeys.classname) throw new Error("writeMap: an entity with no classname");
    return entityBlock(entityKeys, own);
  });
  return [world, ...others].join("\n") + "\n";
}

/** How many words a face's line has in Valve 220, and in the older format that has no texture axes. */
const FACE_WORDS = 31;
const OLD_FACE_WORDS = 21;

/** A face from its line's words. */
function faceFromWords(words, where) {
  const numbers = (from, count) =>
    words.slice(from, from + count).map((word) => {
      const value = Number(word);
      if (word === "" || !Number.isFinite(value)) throw new Error(`${where}: "${word}" is not a number`);
      return value;
    });
  const brackets = [0, 4, 5, 9, 10, 14].map((at) => words[at]).join("");
  if (
    brackets !== "()()()" ||
    words[16] !== "[" ||
    words[21] !== "]" ||
    words[22] !== "[" ||
    words[27] !== "]"
  )
    throw new Error(`${where}: not a face of a Valve 220 map`);
  return {
    points: [numbers(1, 3), numbers(6, 3), numbers(11, 3)],
    texture: words[15],
    u: numbers(17, 4),
    v: numbers(23, 4),
    rotation: numbers(28, 1)[0],
    scale: numbers(29, 2),
  };
}

/**
 * A `.map`'s text read back into what `writeMap` takes: `{ worldspawn, brushes, entities }`. Change it and
 * write it again; what `writeMap` wrote comes back from `writeMap(readMap(text))` letter for letter. The
 * comments an editor leaves (`// entity 3`) are passed over. It reads Valve 220 only, and says so, with the
 * line, for a file in the older format or one that is broken.
 */
export function readMap(text) {
  if (typeof text !== "string")
    throw new Error('readMap: the text of a .map file (readFileSync(file, "utf8"))');
  const entities = [];
  let current = null;
  let brush = null;
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    const where = `readMap: line ${index + 1}`;
    if (!line || line.startsWith("//")) continue;
    if (line === "{") {
      if (brush) throw new Error(`${where}: a { inside a brush`);
      if (current) {
        brush = { faces: [] };
        current.brushes.push(brush);
      } else {
        current = { keys: {}, brushes: [] };
        entities.push(current);
      }
    } else if (line === "}") {
      if (brush) brush = null;
      else if (current) current = null;
      else throw new Error(`${where}: a } that closes nothing`);
    } else if (brush) {
      const words = line.split(/\s+/);
      if (words.length === OLD_FACE_WORDS)
        throw new Error(
          `${where}: this face has no texture axes: the file is in the older format. Open it in an editor and save it as Valve 220`,
        );
      if (words.length !== FACE_WORDS) throw new Error(`${where}: not a face of a Valve 220 map`);
      brush.faces.push(faceFromWords(words, where));
    } else if (current) {
      const pair = /^"([^"]*)"\s+"([^"]*)"$/.exec(line);
      if (!pair) throw new Error(`${where}: neither a "key" "value" nor a brace: ${line.slice(0, 60)}`);
      current.keys[pair[1]] = pair[2];
    } else {
      throw new Error(`${where}: text outside any entity: ${line.slice(0, 60)}`);
    }
  }
  if (current) throw new Error("readMap: the file ends inside an entity: it is cut short");
  if (!entities.length) throw new Error("readMap: no entity in it: not a .map file");
  const [world, ...others] = entities;
  if (world.keys.classname !== "worldspawn")
    throw new Error(`readMap: the first entity is ${world.keys.classname}, not worldspawn`);
  if (world.keys.mapversion !== MAP_VERSION)
    throw new Error(
      `readMap: mapversion ${world.keys.mapversion ?? "missing"}: only Valve 220 is read. Open it in an editor and save it as Valve 220`,
    );
  const { classname: _classname, mapversion: _mapversion, ...worldspawn } = world.keys;
  return {
    worldspawn,
    brushes: world.brushes,
    entities: others.map((one) =>
      one.brushes.length ? { ...one.keys, brushes: one.brushes } : { ...one.keys },
    ),
  };
}/** How near a point must be to a plane for the compiler to take it as on it (sdHLCSG's ON_EPSILON). */
const CSG_EPSILON = 0.04;
/** The furthest from the origin a brush may reach: sdHLCSG refuses one that goes outside +/-32768. */
export const CSG_WORLD = 32768;

/** A polygon cut to what is behind a plane the way sdHLCSG chops a winding: points within epsilon are on it. */
function chopLikeCsg(polygon, plane) {
  const dists = polygon.map((point) => dot(plane.normal, point) - plane.dist);
  if (!dists.some((d) => d > CSG_EPSILON)) return polygon;
  if (!dists.some((d) => d < -CSG_EPSILON)) return [];
  const kept = [];
  polygon.forEach((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const here = dists[index];
    const there = dists[(index + 1) % polygon.length];
    if (here <= CSG_EPSILON) kept.push(point);
    if ((here > CSG_EPSILON && there < -CSG_EPSILON) || (here < -CSG_EPSILON && there > CSG_EPSILON))
      kept.push(plus(point, sub(next, point), here / (here - there)));
  });
  return kept;
}

/**
 * What sdHLCSG would refuse in a brush, in words: the faces worked out as it works them (a point within
 * 0.04 of a plane is ON it, so two planes a hair apart do not cut each other), then a face edge no other
 * face shares ("Illegal Brush: edge without opposite face") and a corner past +/-32768 ("outside world").
 * `shapeOf` works the brush out exactly and so finds neither: a wedge a hundredth of a unit thick is a
 * sound solid to it. Returns `{ open: [sentence], outside: [sentence] }`; both empty for a brush CSG takes.
 */
export function csgFaults(brush) {
  const planes = planesOf(brush);
  const open = [];
  const outside = [];
  if (planes.some((plane) => !plane)) return { open, outside };
  const polygons = planes.map((plane, index) => {
    let polygon = sheetOn(plane);
    planes.forEach((other, otherIndex) => {
      if (otherIndex === index || !polygon.length) return;
      if (dot(other.normal, plane.normal) > SAME_WAY && Math.abs(other.dist - plane.dist) <= ON_PLANE) return;
      polygon = chopLikeCsg(polygon, other);
    });
    return polygon.map((point) => point.map(tidy));
  });
  const flat = polygons.flat();
  if (flat.some((point) => point.some((value) => Math.abs(value) > CSG_WORLD))) {
    const lo = [0, 1, 2].map((i) => Math.round(Math.min(...flat.map((p) => p[i]))));
    const hi = [0, 1, 2].map((i) => Math.round(Math.max(...flat.map((p) => p[i]))));
    outside.push(`reaches (${lo.join(" ")})-(${hi.join(" ")}), past +/-${CSG_WORLD}`);
    return { open, outside };
  }
  // a wedge a hundredth of a unit thick: its two long faces are "on" each other's plane to the compiler, and
  // the faces cut each other away
  const left = polygons.filter((polygon) => polygon.length >= 3).length;
  if (left < 4)
    open.push(`is left with ${left} faces: planes within ${CSG_EPSILON} of each other cut each other away`);
  // every edge of a face must be an edge of exactly one other face, run the other way
  const near = (a, b) => Math.hypot(...sub(a, b)) <= CSG_EPSILON;
  polygons.forEach((polygon, index) => {
    if (polygon.length < 3) return;
    polygon.forEach((a, i) => {
      const b = polygon[(i + 1) % polygon.length];
      if (near(a, b)) return;
      const shared = polygons.filter(
        (other, k) => k !== index && other.some((c, j) => near(c, b) && near(other[(j + 1) % other.length], a)),
      ).length;
      if (shared !== 1)
        open.push(
          `face ${index} has its edge (${a.map(Math.round).join(" ")})-(${b.map(Math.round).join(" ")}) shared by ${shared} faces, not one`,
        );
    });
  });
  return { open, outside };
}


