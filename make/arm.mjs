// The body behind a view model's arms. A first-person model has forearms and hands and often no upper arm, so
// where an elbow goes is the author's guess, and a guess can put a forearm where no shoulder can hold it (the
// katana remade on 2026-11-11: forearms huge on the screen, roots that no upper arm reaches). This is the body,
// measured from games whose view models have whole arms, and the two-bone IK that puts the elbow where it would
// be (ARCHITECTURE.md 8.5). Eye space is the view model's own: the eye at the origin, +x ahead, +y left, +z up.
//
//   VIEW_BODY                                         the first-person body, each number with its source
//   shoulderFor({ elbow, fore, side, ratio })         a shoulder for an elbow the game ships: VIEW_BODY's lateral
//                                                     and height, scaled by the forearm, set back so the upper arm reaches it
//   solveArm({ shoulder, upper, fore, hand, pole })   -> { elbow, reached, short }: where the elbow is, on the pole's side
//   placeForearm(bones, values, { fore, hand, elbow, target })   a frame's values with the forearm's root at the elbow,
//                                                     pointing at the hand, and the hand's world matrix the target
import { boneMatrices, mul34, inverse34 } from "../core/mdl.mjs";
import { qofMatrix, anglesOf, qarc, qturn } from "./animate.mjs";

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => scale(a, 1 / (len(a) || 1));

/**
 * The first-person body. Measured by node on Half-Life's 16 view models (valve/models/v_*.mdl, 2026-11-11): the
 * 23 arms with Biped's clavicle, upper arm, forearm and hand, every frame of every animation (9157 arm-frames).
 */
export const VIEW_BODY = {
  /**
   * The shoulder (the upper arm's root, Bip01 L Arm1) from the eye, the left one (the right's y is the opposite):
   * the medians of the 9157; x from -11.72 to 2.13 (5th to 95th in 100: the 357's sits farthest back, the
   * crossbow's farthest ahead), |y| 3.31 to 9.28, z -5.55 to 0.74.
   */
  shoulder: [-3.47, 6.72, -4.55],
  /** The forearm (Arm2 to Hand) the shoulder goes with: 11.37 in 20 of the 23 arms (11.20 the rpg's, 11.85 and 12.57 the shotgun's). */
  forearm: 11.37,
  /**
   * The forearm's length over the upper arm's: Half-Life's is 1.0 (20 of 23 arms; 0.88 to 0.99 the others).
   * Vermintide 2's four heroes' first-person arms are 0.94 (dormant/0.38 anim/corpus/arms-vt2.json), The
   * Specialists' 8 arms 0.909, from 0.665 to 1.089 (arms-ts.json).
   */
  foreOverUpper: 1,
  /**
   * The side an elbow bends to, for a pole: down, and out by half as much. Half-Life's elbows sit 9.94 below
   * their shoulders (6.38 to 11.31) and its view models hold them out from the body.
   */
  pole: [0, 0.5, -1],
};

/**
 * A shoulder for an elbow the game ships (a forearm's root in a pose that is right: its idle): at VIEW_BODY's
 * lateral and height scaled by the forearm against VIEW_BODY.forearm, on the elbow's side (`side` "L" or "R"),
 * and set back from the elbow (behind it, the way Half-Life's half of its elbows ahead of their shoulders are) so
 * that an upper arm of `fore / ratio` reaches it. Returns { shoulder, upper, fitted }: `fitted` false when no
 * point at that lateral and height reaches the elbow (VIEW_BODY's own x is used, and the elbow is off by the rest).
 */
export function shoulderFor({ elbow, fore, side, ratio = VIEW_BODY.foreOverUpper }) {
  const k = fore / VIEW_BODY.forearm;
  const upper = fore / ratio;
  const y = (side === "R" ? -1 : 1) * VIEW_BODY.shoulder[1] * k;
  const z = VIEW_BODY.shoulder[2] * k;
  const left = upper ** 2 - (elbow[1] - y) ** 2 - (elbow[2] - z) ** 2;
  if (left < 0) return { shoulder: [VIEW_BODY.shoulder[0] * k, y, z], upper, fitted: false };
  return { shoulder: [elbow[0] - Math.sqrt(left), y, z], upper, fitted: true };
}

/**
 * Two-bone IK: the elbow of an arm from `shoulder` (upper arm `upper` long) whose hand, `fore` from the elbow, is
 * at `hand`; on the side `pole` points (a direction; VIEW_BODY.pole with its y turned for a right arm is a view
 * model's). A hand out of reach leaves the arm straight towards it: `reached` false, `short` by how much.
 */
export function solveArm({ shoulder, upper, fore, hand, pole = VIEW_BODY.pole }) {
  for (const [what, v] of [["shoulder", shoulder], ["hand", hand], ["pole", pole]])
    if (!(Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))) throw new Error(`solveArm: ${what} is [x, y, z], not ${JSON.stringify(v)}`);
  if (!(upper > 0 && fore > 0)) throw new Error(`solveArm: upper and fore are lengths over 0, not ${upper} and ${fore}`);
  const span = sub(hand, shoulder);
  const far = len(span);
  const within = Math.max(Math.abs(upper - fore) + 1e-6, Math.min(upper + fore - 1e-6, far));
  const along = far > 1e-9 ? scale(span, 1 / far) : [1, 0, 0];
  const toJoint = (upper * upper - fore * fore + within * within) / (2 * within);
  const out = Math.sqrt(Math.max(0, upper * upper - toJoint * toJoint));
  let side = sub(pole, scale(along, dot(pole, along)));
  if (len(side) < 1e-6) side = [0, 0, -1];
  const elbow = add(add(shoulder, scale(along, toJoint)), scale(unit(side), out));
  const reached = far <= upper + fore + 1e-6 && far >= Math.abs(upper - fore) - 1e-6;
  return { elbow, reached, short: reached ? 0 : Math.abs(far - within) };
}

/** The six values of a bone from its matrix in its parent's space. */
const sixOf = (m) => [m[0][3], m[1][3], m[2][3], ...anglesOf(qofMatrix(m))];

/**
 * One frame's values (for each bone [x, y, z, about x, y, z], as frameValues gives them) with a forearm put at an
 * elbow: its root at `elbow` (eye space), turned the shortest way from where it was to point at the target's
 * place, and the hand's turn set so that the hand's world matrix turns as `target` (a 3 by 4, as poseAt gives)
 * does. The hand keeps its place in the forearm (no bone is stretched), so it lands on the target's place when
 * the elbow is a forearm's length from it (solveArm's). `bones`: [{ parent }] (bones(mdl)); `fore`, `hand`: numbers.
 * Returns a new list of values; the forearm's children other than the hand ride along with it.
 */
export function placeForearm(bones, values, { fore, hand, elbow, target }) {
  if (bones[hand]?.parent !== fore) throw new Error(`placeForearm: bone ${hand} is to be the child of bone ${fore}`);
  const world = boneMatrices(bones, values);
  const parent = bones[fore].parent < 0 ? null : world[bones[fore].parent];
  const was = world[fore];
  const axis = values[hand].slice(0, 3);
  const columns = [0, 1, 2].map((c) => [was[0][c], was[1][c], was[2][c]]);
  const pointing = add(add(scale(columns[0], axis[0]), scale(columns[1], axis[1])), scale(columns[2], axis[2]));
  const turn = qarc(pointing, sub([target[0][3], target[1][3], target[2][3]], elbow));
  const turned = columns.map((c) => qturn(turn, c));
  const placed = [0, 1, 2].map((r) => [turned[0][r], turned[1][r], turned[2][r], elbow[r]]);
  const out = values.map((six) => [...six]);
  out[fore] = sixOf(parent ? mul34(inverse34(parent), placed) : placed);
  const own = mul34(inverse34(placed), target);
  out[hand] = [...values[hand].slice(0, 3), ...sixOf(own).slice(3)];
  return out;
}
