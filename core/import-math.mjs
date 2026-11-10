// The arithmetic the readers of other tools' files share (fbx.mjs, glb.mjs, import-*.mjs): a node's place as a
// matrix, with the scales and shears a modelling tool allows and a studio model does not.
//
// A matrix here is three rows of four numbers, as the kit's own (`mul34`, `apply34`): what it does to a point
// is turn, stretch and then move it. Unlike the kit's, these may stretch, so they have an inverse of their own.

/** A matrix that changes nothing. */
export const IDENTITY = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
];
const RADIANS = Math.PI / 180;

/** `a` after `b`: what `b` does to a point, then what `a` does. */
export const mul = (a, b) =>
  a.map((r) =>
    [0, 1, 2, 3].map((c) => r[0] * b[0][c] + r[1] * b[1][c] + r[2] * b[2][c] + (c === 3 ? r[3] : 0)),
  );
/** Several matrices as one, the last done first. */
export const mulAll = (...list) => list.reduce(mul);
/** A point moved by a matrix, and a direction turned by it (not moved). */
export const apply = (m, p) => m.map((r) => r[0] * p[0] + r[1] * p[1] + r[2] * p[2] + r[3]);
export const applyDir = (m, d) => m.map((r) => r[0] * d[0] + r[1] * d[1] + r[2] * d[2]);
/** How much a matrix swells a volume; under 0 for one that mirrors, which turns every face inside out. */
export const det = (m) =>
  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
  m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
  m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

/** A matrix that flattens (a scale of 0) has no inverse: its volume is under this. */
const FLAT = 1e-30;
/** The inverse of a matrix that may stretch. One that flattens everything gives the identity's turn. */
export function inverse(m) {
  const d = det(m);
  if (!(Math.abs(d) > FLAT)) return [...IDENTITY.map((row) => [...row])];
  const c = (r1, c1, r2, c2) => m[r1][c1] * m[r2][c2] - m[r1][c2] * m[r2][c1];
  const turn = [
    [c(1, 1, 2, 2) / d, -c(0, 1, 2, 2) / d, c(0, 1, 1, 2) / d],
    [-c(1, 0, 2, 2) / d, c(0, 0, 2, 2) / d, -c(0, 0, 1, 2) / d],
    [c(1, 0, 2, 1) / d, -c(0, 0, 2, 1) / d, c(0, 0, 1, 1) / d],
  ];
  const moved = [m[0][3], m[1][3], m[2][3]];
  return turn.map((row) => [...row, -(row[0] * moved[0] + row[1] * moved[1] + row[2] * moved[2])]);
}
/**
 * The matrix that turns a surface's normals as `m` moves its points: the inverse's turn, rows for columns. A
 * stretch along one axis leans a normal the other way from the points.
 */
export function normalsOf(m) {
  const back = inverse(m);
  return [0, 1, 2].map((r) => [back[0][r], back[1][r], back[2][r], 0]);
}

/** A move, a stretch and a turn about one axis (degrees), each as a matrix. */
export const moved = ([x, y, z]) => [
  [1, 0, 0, x],
  [0, 1, 0, y],
  [0, 0, 1, z],
];
export const stretched = ([x, y, z]) => [
  [x, 0, 0, 0],
  [0, y, 0, 0],
  [0, 0, z, 0],
];
function about(axis, degrees) {
  const c = Math.cos(degrees * RADIANS);
  const s = Math.sin(degrees * RADIANS);
  if (axis === 0)
    return [
      [1, 0, 0, 0],
      [0, c, -s, 0],
      [0, s, c, 0],
    ];
  if (axis === 1)
    return [
      [c, 0, s, 0],
      [0, 1, 0, 0],
      [-s, 0, c, 0],
    ];
  return [
    [c, -s, 0, 0],
    [s, c, 0, 0],
    [0, 0, 1, 0],
  ];
}
/**
 * Three angles (degrees, about x, y and z) as one turn. `order` names the axes in the order the turns are
 * done ("xyz": about x first, then y, then z, which is the matrix Rz Ry Rx).
 */
export function turned([x, y, z], order = "xyz") {
  const each = { x: about(0, x), y: about(1, y), z: about(2, z) };
  return [...order].map((axis) => each[axis]).reduce((done, next) => mul(next, done));
}
/** A quaternion [x, y, z, w] as a turn. */
export function turnOfQuaternion([x, y, z, w]) {
  const n = Math.hypot(x, y, z, w) || 1;
  const [a, b, c, d] = [x / n, y / n, z / n, w / n];
  return [
    [1 - 2 * (b * b + c * c), 2 * (a * b - c * d), 2 * (a * c + b * d), 0],
    [2 * (a * b + c * d), 1 - 2 * (a * a + c * c), 2 * (b * c - a * d), 0],
    [2 * (a * c - b * d), 2 * (b * c + a * d), 1 - 2 * (a * a + b * b), 0],
  ];
}
/** Sixteen numbers, column after column (as glTF and OpenGL write a matrix), as the kit's three rows. */
export const ofColumns = (v) => [0, 1, 2].map((r) => [v[r], v[4 + r], v[8 + r], v[12 + r]]);
/** Sixteen numbers as FBX writes a matrix (row after row, the move in the last row), as the kit's rows. */
export const ofRowsMovedLast = ofColumns;

// ── what a studio model keeps of a matrix ──────────────────────────────────
/** An axis shorter than this has been flattened: the turn cannot be read off it. */
const NO_LENGTH = 1e-12;
/**
 * A matrix with its stretch taken out: the turn nearest its own axes (its x kept, its y squared off against
 * it, its z at right angles to both, the way round it had) and its move. A bone of a studio model is this.
 */
export function rigid(m) {
  const column = (c) => [m[0][c], m[1][c], m[2][c]];
  const unit = (v) => {
    const length = Math.hypot(...v);
    return length > NO_LENGTH ? v.map((t) => t / length) : null;
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const X = unit(column(0)) ?? [1, 0, 0];
  const y = column(1);
  const Y = unit(y.map((t, i) => t - X[i] * dot(y, X))) ?? unit(cross([0, 0, 1], X)) ?? [0, 1, 0];
  // a mirrored matrix keeps its mirror in z, so the other two axes stay the bone's own
  const Z = cross(X, Y);
  return [0, 1, 2].map((r) => [X[r], Y[r], Z[r], m[r][3]]);
}
/**
 * A rigid matrix as a bone's six values: [x, y, z, about x, about y, about z] (radians), the turns done about
 * x, then y, then z, as the engine reads them (`boneMatrices` makes the same matrix of them).
 */
export function sixOf(m) {
  const sinY = Math.min(1, Math.max(-1, -m[2][0]));
  // looking straight up or down the turn about x and the one about z are one: all of it is given to z
  const level = Math.abs(sinY) < 0.999999;
  return [
    m[0][3],
    m[1][3],
    m[2][3],
    level ? Math.atan2(m[2][1], m[2][2]) : 0,
    Math.asin(sinY),
    level ? Math.atan2(m[1][0], m[0][0]) : Math.atan2(-m[0][1], m[1][1]),
  ];
}

// ── axes ───────────────────────────────────────────────────────────────────
/**
 * The matrix that stands a file's scene up as GoldSrc has a model (+x forward, +y left, +z up), from which of
 * the file's axes is up and which its front, each [axis (0, 1, 2), sign (1, -1)]. The third axis follows from
 * the two (the model's left is its up crossed with its front), so the result is a turn and never a mirror.
 */
export function standingUp(up, front) {
  const axis = ([which, sign]) => [0, 1, 2].map((a) => (a === which ? sign : 0));
  const U = axis(up);
  const F = axis(front);
  const L = [U[1] * F[2] - U[2] * F[1], U[2] * F[0] - U[0] * F[2], U[0] * F[1] - U[1] * F[0]];
  return [
    [...F, 0],
    [...L, 0],
    [...U, 0],
  ];
}
