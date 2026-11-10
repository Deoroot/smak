// A camera's path for a video (research/directed-video.md, 3.1): a curve through key points that never loops
// or overshoots at a sharp corner (centripetal Catmull-Rom), walked at an even speed (by its length, not its
// parameter), eased at its ends, looking ahead along it with the turn smoothed.
//
//   simplify(points, tolerance)            a route's points, fewer: Ramer-Douglas-Peucker
//   curveOf(points)                        { at(s) (0 to 1 of its length), length }
//   walkPath(points, { speed, fps, ease }) the eye at each frame, evenly spaced: [[x, y, z], ...]
//   lookAhead(eyes, { ahead, smooth })     each frame's yaw and pitch (degrees), looking `ahead` frames on,
//                                          the yaw averaged over `smooth` frames each side

const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const times = (a, k) => a.map((v) => v * k);
const length = (a) => Math.hypot(...a);

/** A route's points kept where they turn: Ramer-Douglas-Peucker, within `tolerance` units. */
export function simplify(points, tolerance = 24) {
  if (points.length < 3) return points.slice();
  const far = (a, b, p) => {
    const ab = sub(b, a);
    const t = Math.max(0, Math.min(1, ab.reduce((s, v, i) => s + v * (p[i] - a[i]), 0) / (ab.reduce((s, v) => s + v * v, 0) || 1)));
    return length(sub(p, add(a, times(ab, t))));
  };
  let worst = 0;
  let at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = far(points[0], points.at(-1), points[i]);
    if (d > worst) [worst, at] = [d, i];
  }
  if (worst <= tolerance) return [points[0], points.at(-1)];
  return [...simplify(points.slice(0, at + 1), tolerance).slice(0, -1), ...simplify(points.slice(at), tolerance)];
}

/** One centripetal Catmull-Rom segment from p1 to p2 (alpha 0.5), at t from 0 to 1. */
function segment(p0, p1, p2, p3, t) {
  const knot = (a, b) => Math.sqrt(Math.max(length(sub(b, a)), 1e-6));
  const t1 = knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const lerp = (a, b, ta, tb) => add(times(a, (tb - u) / (tb - ta)), times(b, (u - ta) / (tb - ta)));
  const a1 = lerp(p0, p1, 0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, 0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/** The curve through `points`, measured: at(s) for s 0 to 1 of its length. */
export function curveOf(points) {
  if (points.length === 1) return { at: () => points[0].slice(), length: 0 };
  // the ends extended, so the curve passes through the first and last points
  const ends = [sub(times(points[0], 2), points[1]), ...points, sub(times(points.at(-1), 2), points.at(-2))];
  const samples = [];
  for (let i = 0; i < points.length - 1; i++)
    for (let k = 0; k < 32; k++) samples.push(segment(ends[i], ends[i + 1], ends[i + 2], ends[i + 3], k / 32));
  samples.push(points.at(-1).slice());
  const along = [0];
  for (let i = 1; i < samples.length; i++) along.push(along[i - 1] + length(sub(samples[i], samples[i - 1])));
  const total = along.at(-1);
  const at = (s) => {
    const want = Math.max(0, Math.min(1, s)) * total;
    let lo = 0;
    let hi = along.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (along[mid] < want) lo = mid;
      else hi = mid;
    }
    const k = along[hi] === along[lo] ? 0 : (want - along[lo]) / (along[hi] - along[lo]);
    return add(samples[lo], times(sub(samples[hi], samples[lo]), k));
  };
  return { at, length: total };
}

/** Ease of a share of the way: none, in, out or both (smoothstep). */
export const ease = (kind, s) =>
  kind === "both" ? s * s * (3 - 2 * s) : kind === "in" ? s * s : kind === "out" ? 1 - (1 - s) ** 2 : s;

/** The eye at each frame along `points`, at `speed` units a second (or over `seconds`), eased at its ends. */
export function walkPath(points, { speed, seconds, fps = 30, easing = "both" }) {
  const curve = curveOf(points);
  const duration = seconds ?? curve.length / Math.max(speed ?? 160, 1);
  const count = Math.max(2, Math.round(duration * fps) + 1);
  return Array.from({ length: count }, (_, n) => curve.at(ease(easing, n / (count - 1))));
}

/** Degrees round a circle, the jumps at 360 taken out so that an average is right. */
function unwrap(angles) {
  const out = [angles[0]];
  for (let i = 1; i < angles.length; i++) {
    let a = angles[i];
    while (a - out[i - 1] > 180) a -= 360;
    while (a - out[i - 1] < -180) a += 360;
    out.push(a);
  }
  return out;
}

/** Each frame's look: toward the eye `ahead` frames on, the yaw averaged over `smooth` frames each side. */
export function lookAhead(eyes, { ahead = 15, smooth = 15 } = {}) {
  const raw = eyes.map((eye, i) => {
    const to = eyes[Math.min(eyes.length - 1, i + ahead)];
    const d = sub(to, eye);
    const flat = Math.hypot(d[0], d[1]);
    return flat < 1e-3 ? null : { yaw: (Math.atan2(d[1], d[0]) * 180) / Math.PI, pitch: (Math.atan2(d[2], flat) * 180) / Math.PI };
  });
  // where the eye stops (the end), keep the last way it looked
  for (let i = raw.length - 1; i >= 0; i--) raw[i] ??= raw[i + 1] ?? { yaw: 0, pitch: 0 };
  for (let i = 0; i < raw.length; i++) raw[i] ??= raw[i - 1];
  const yaw = unwrap(raw.map((r) => r.yaw));
  return yaw.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - smooth); k <= Math.min(yaw.length - 1, i + smooth); k++) {
      sum += yaw[k];
      n++;
    }
    return { yaw: sum / n, pitch: raw[i].pitch * 0.5 };
  });
}
