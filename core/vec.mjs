// Vectors, boxes and frames: the small arithmetic every other module shares.

// ── vectors ────────────────────────────────────────────────────────────────
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
/** The vector at length 1 (a vector of no length is left as it is). */
export const unit = (a) => {
  const length = Math.hypot(...a) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

/** Further out than any point of a model: where a box starts before any point is put in it. */
const FAR = 1e9;
/** The box round a list of points: { mn, mx }, its least and greatest corner. */
export const box = (points) => {
  const mn = [FAR, FAR, FAR];
  const mx = [-FAR, -FAR, -FAR];
  for (const p of points)
    for (let a = 0; a < 3; a++) {
      mn[a] = Math.min(mn[a], p[a]);
      mx[a] = Math.max(mx[a], p[a]);
    }
  return { mn, mx };
};
/**
 * A frame { X, Y, Z, o }: a piece's own axes (+x its length, +y its width, +z its thickness) in some other
 * space. `out` takes a point from the frame to that space, `into` from that space to the frame.
 */
export const out = (f, p) => [0, 1, 2].map((a) => f.o[a] + f.X[a] * p[0] + f.Y[a] * p[1] + f.Z[a] * p[2]);
export const into = (f, p) => {
  const d = sub(p, f.o);
  return [dot(d, f.X), dot(d, f.Y), dot(d, f.Z)];
};
/** The points of a list of triangles, each once. */
export const uniq = (tris) => [...new Map(tris.flat().map((c) => [c.p.join(), c.p])).values()];

/** How many times the power method below is turned: far more than it takes to settle. */
const POWER_STEPS = 400;
/** Where it starts from: a direction that is along no axis, so that none is missed. */
const POWER_START = [0.31, 0.57, 0.76];

/** The two main directions of a cloud of weighted points [x, y, z, weight], and its centre. */
export function mainAxes(samples) {
  const total = samples.reduce((sum, sample) => sum + sample[3], 0);
  const o = [0, 1, 2].map((a) => samples.reduce((sum, p) => sum + p[a] * p[3], 0) / total);
  // how the cloud spreads about its centre: its covariance, each point by its weight
  const spread = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of samples) {
    const d = sub(p, o);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) spread[a][b] += p[3] * d[a] * d[b];
  }
  const times = (matrix, v) => matrix.map((row) => dot(row, v));
  // the direction a matrix stretches most (its main eigenvector), by multiplying a vector by it over and over
  const mainDirection = (matrix) => {
    let v = POWER_START;
    for (let k = 0; k < POWER_STEPS; k++) v = unit(times(matrix, v));
    return v;
  };
  const X = mainDirection(spread);
  // the second: the main direction of what is left of the spread with the first taken out of it
  const stretchAlongX = dot(X, times(spread, X));
  const second = mainDirection(spread.map((row, a) => row.map((t, b) => t - stretchAlongX * X[a] * X[b])));
  return {
    X,
    // squared off against X
    Y: unit(
      sub(
        second,
        X.map((t) => t * dot(second, X)),
      ),
    ),
    o,
  };
}
