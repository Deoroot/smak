// A submodel drawn as an icon's tile: one thing alone on black, filling a square, for a game's sheet of item
// pictures. What comes back is the drawing before any palette: floats, to be reduced and taken to whatever
// colours and frame the game's sheet has (that part is the game's, and no part of the kit).
//
// Two ways of standing the thing in the square:
//   as it stands   the camera is told where to be (`view`): a helmet, a body armour, seen a little from one
//                  side and from above
//   "diagonal"     the thing's own long axis is laid from the lower left corner to the upper right, whatever
//                  way it lies in its file: a weapon, a staff, a key. A long thin thing seen level is a line
//                  across a square that is mostly empty; on the diagonal it is 1.4 times as long and the
//                  square is used
import { posed, render } from "./render.mjs";
import { mul34 } from "../core/mdl.mjs";
import { frameOf } from "./fit.mjs";
import { into, cross, box } from "../core/vec.mjs";

const DEGREES = Math.PI / 180;
/** The share of a long thing's length at each end that is looked at to tell its heavy end. */
const END_SHARE = 0.3;
/** How many times the camera's distance is worked out again from what the thing then covers. */
const FIT_TURNS = 4;
/** A drawn pixel as dark as this (the sum of its three channels) is the ground. */
const GROUND = 0;

/**
 * The levels of a drawing: `gain`, then a `gamma` on the brightness alone (under 1 raises what is dark and
 * keeps its hue, so that a dark part does not sink into the ground), then `colour`, how much more or less
 * colour. `rgba`: what `render` drew on black. Returns floats 0..255 (r, g, b a pixel); the ground stays 0.
 */
function levelled(img, side, { gain = 1, gamma = 1, colour = 1 } = {}) {
  const rgb = new Float64Array(side * side * 3);
  for (let i = 0; i < side * side; i++) {
    if (img.rgba[i * 4] + img.rgba[i * 4 + 1] + img.rgba[i * 4 + 2] === GROUND) continue;
    const raw = [0, 1, 2].map((k) => (img.rgba[i * 4 + k] / 255) * gain);
    const y = Math.min(1, 0.299 * raw[0] + 0.587 * raw[1] + 0.114 * raw[2]) || 1e-6;
    const k = Math.pow(y, gamma) / y;
    const grey = 255 * y * k;
    for (let n = 0; n < 3; n++)
      rgb[i * 3 + n] = Math.max(0, Math.min(255, grey + (255 * raw[n] * k - grey) * colour));
  }
  return rgb;
}

/** The triangles a picture shows: those of `parts` (bodyparts by number) when told, else all. */
const shownTris = (stand, parts) =>
  parts ? stand.tris.filter((t) => parts.includes(t.where.bodypart)) : stand.tris;

/**
 * The turn that lays a thing on the picture's diagonal: a 3 by 4 matrix for its points as they stand in the
 * model's space. Seen from the front (the camera on +x, the picture's right +y, its top +z) the thing's long
 * axis then runs from the lower left to the upper right, its width lies in the picture and its thickness
 * looks at the camera; `roll` turns it about its own length, `lean` brings its upper end towards the eye.
 * The upper end is its heavy one (the head of a mace, of an axe: the end where it reaches farther from its
 * own axis), unless `flip`.
 */
function diagonalTurn(tris, { roll = 0, lean = 0, flip = false }) {
  const frame = frameOf(tris.map((t) => t.c));
  const points = tris.flatMap((t) => t.c.map((corner) => into(frame, corner.p)));
  const { mn, mx } = box(points);
  const reachAt = (low) => {
    const cut = low ? mn[0] + (mx[0] - mn[0]) * END_SHARE : mx[0] - (mx[0] - mn[0]) * END_SHARE;
    return points
      .filter((p) => (low ? p[0] <= cut : p[0] >= cut))
      .reduce((most, p) => Math.max(most, Math.hypot(p[1], p[2])), 0);
  };
  // its own axes, the long one towards the end that goes up
  const up = reachAt(false) >= reachAt(true) !== flip ? 1 : -1;
  const X = frame.X.map((v) => v * up);
  const Y = frame.Y.map((v) => v * up);
  const Z = frame.Z;
  // where each goes: the long one up the diagonal and `lean` out of the picture, the wide one across it
  const half = Math.SQRT1_2;
  const cosLean = Math.cos(lean * DEGREES);
  const toX = [Math.sin(lean * DEGREES), cosLean * half, cosLean * half];
  const across = [0, -half, half];
  const out = cross(toX, across);
  const toY = across.map((v, a) => v * Math.cos(roll * DEGREES) + out[a] * Math.sin(roll * DEGREES));
  const toZ = cross(toX, toY);
  const turn = [0, 1, 2].map((i) => [0, 1, 2].map((j) => toX[i] * X[j] + toY[i] * Y[j] + toZ[i] * Z[j]));
  return turn.map((row) => [...row, -(row[0] * frame.o[0] + row[1] * frame.o[1] + row[2] * frame.o[2])]);
}

/**
 * One body of a model drawn as an icon's tile, on black.
 *   body, skin, seq, frame   what is shown, as `render` takes them (the first animation's first frame
 *                            unless told)
 *   parts      only these bodyparts (their numbers): a weapon of a first-person file without the arms
 *   side       the drawing's side in pixels (640): draw it several times the tile and reduce it
 *              (`reducedPicture`), since a reduction is what makes an icon's edges
 *   lie        "diagonal": the thing's long axis from the lower left to the upper right (see above), with
 *                roll      degrees about its own length (0)
 *                lean      degrees its upper end comes towards the eye (0)
 *                flip      true: the other end up
 *                margin    the share of the side left free at each edge (0.1)
 *                fov       degrees across (30): a little perspective, as a game's own icons have
 *              unless told, as it stands, seen by
 *   view       { yaw, pitch, fov, dist, at }: where the camera stands (yaw 0 is the model's front, more is
 *              to its left), `at` the point looked at as shares of the body's box (x, y, z from its least to
 *              its most), `dist` how far in units
 *   levels     { gain, gamma, colour }: see `levelled` (1, 1, 1)
 * Returns { side, rgb }: floats 0..255, three a pixel; what is not the body is 0, 0, 0.
 */
export function iconPicture(
  mdl,
  {
    body = 0,
    skin = 0,
    seq = 0,
    frame = 0,
    parts = null,
    side = 640,
    lie = null,
    roll = 0,
    lean = 0,
    flip = false,
    margin = 0.1,
    fov = 30,
    view = {},
    levels = {},
  } = {},
) {
  const stand = posed(mdl, { seq, frame, body, skin });
  const tris = shownTris(stand, parts);
  if (!tris.length) throw new Error(`iconPicture: body ${body} shows no triangle to draw`);
  const common = { body, skin, parts, width: side, height: side, background: [0, 0, 0] };
  if (lie === null) {
    const lo = [1e9, 1e9, 1e9];
    const hi = [-1e9, -1e9, -1e9];
    for (const t of tris)
      for (const c of t.c)
        for (let a = 0; a < 3; a++) {
          lo[a] = Math.min(lo[a], c.p[a]);
          hi[a] = Math.max(hi[a], c.p[a]);
        }
    const { yaw, pitch, dist, at = [0.5, 0.5, 0.5] } = view;
    const target = at.map((s, a) => lo[a] + (hi[a] - lo[a]) * s);
    const img = render(mdl, { ...common, seq, frame, yaw, pitch, fov: view.fov, dist, target });
    return { side, rgb: levelled(img, side, levels) };
  }
  if (lie !== "diagonal") throw new Error(`iconPicture: lie is "diagonal" or left out, not ${lie}`);

  // the thing turned onto the diagonal: every bone's matrix with the turn before it
  const turn = diagonalTurn(tris, { roll, lean, flip });
  const pose = stand.pose.map((matrix) => mul34(turn, matrix));
  const turned = shownTris(posed(mdl, { pose, body, skin }), parts).flatMap((t) => t.c.map((c) => c.p));
  // the camera on +x looking back at it: how far it must stand for the thing to fill the square. With
  // perspective a point nearer the eye is drawn larger, so the distance is worked out again from what it
  // then covers
  const tangent = Math.tan((fov * DEGREES) / 2);
  const wanted = 1 - 2 * margin;
  let target = [0, 0, 0];
  let dist = 1;
  for (let k = 0; k < FIT_TURNS; k++) {
    // each point on the picture, as shares of its half side, from the camera at `dist` looking at `target`
    const seen = turned.map((p) => {
      const depth = Math.max(1e-6, dist - (p[0] - target[0]));
      return [(p[1] - target[1]) / depth / tangent, (p[2] - target[2]) / depth / tangent, depth];
    });
    if (k === 0) {
      // first without perspective: the middle of what it covers, and a distance that holds its reach
      const flat = box(turned);
      target = [0, (flat.mn[1] + flat.mx[1]) / 2, (flat.mn[2] + flat.mx[2]) / 2];
      const reach = Math.max(flat.mx[1] - flat.mn[1], flat.mx[2] - flat.mn[2]) / 2;
      dist = reach / tangent / wanted + (flat.mx[0] - flat.mn[0]) / 2;
      continue;
    }
    const covered = box(seen);
    const middle = [(covered.mn[0] + covered.mx[0]) / 2, (covered.mn[1] + covered.mx[1]) / 2];
    const reach = Math.max(covered.mx[0] - covered.mn[0], covered.mx[1] - covered.mn[1]) / 2;
    target = [0, target[1] + middle[0] * dist * tangent, target[2] + middle[1] * dist * tangent];
    dist *= reach / wanted;
  }
  const img = render(mdl, { ...common, pose, yaw: 0, pitch: 0, fov, dist, target });
  return { side, rgb: levelled(img, side, levels) };
}

/** A square picture of floats reduced `k` times, each pixel the mean of the k by k it covers. */
export function reducedPicture(rgb, side, k) {
  const to = side / k;
  const out = new Float64Array(to * to * 3);
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++)
      for (let c = 0; c < 3; c++)
        out[(((y / k) | 0) * to + ((x / k) | 0)) * 3 + c] += rgb[(y * side + x) * 3 + c];
  return out.map((v) => v / (k * k));
}
