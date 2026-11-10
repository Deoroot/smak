// A path worn into the ground: a ribbon laid over the ground along a line, wearing a picture of a path (a
// band of dirt with grass at both its edges, as the game's `Path3` and `ms_grass01path`), the picture turned
// to run along it. The game's maps paint their paths on the ground's triangles, which needs pictures that
// blend in every direction; a ribbon needs one picture whose edges are the ground's own, and its line stays
// smooth however the ground is cut.
//
// The ribbon's middle stands `lift` units over the ground and its edges `sink` under it: the ground closes
// over its edges, where the picture is grass on grass, and a player walks on its middle. Its ends sink too.
// What it gives: `{ brushes, along }`, the brushes (for a func_detail) and the line it took (smoothed).
import { solid } from "./source.mjs";

/** The line `points` [[x, y]] with its corners cut `times` times (Chaikin's): a curve through the same places. */
export function smoothLine(points, times = 2) {
  let line = points;
  for (let n = 0; n < times; n++) {
    const next = [line[0]];
    for (let i = 0; i + 1 < line.length; i++) {
      const [a, b] = [line[i], line[i + 1]];
      next.push(
        [a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25],
        [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75],
      );
    }
    next.push(line.at(-1));
    line = next;
  }
  return line;
}

/** Points along a line every `step` units, the last one its end: `[{ at: [x, y], arc }]`. */
function along(line, step) {
  const out = [{ at: line[0], arc: 0 }];
  let arc = 0,
    carry = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const [a, b] = [line[i], line[i + 1]];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = step - carry;
    while (t < length) {
      out.push({
        at: [a[0] + ((b[0] - a[0]) * t) / length, a[1] + ((b[1] - a[1]) * t) / length],
        arc: arc + t,
      });
      t += step;
    }
    carry = length - (t - step);
    arc += length;
  }
  if (Math.hypot(out.at(-1).at[0] - line.at(-1)[0], out.at(-1).at[1] - line.at(-1)[1]) > step / 3)
    out.push({ at: line.at(-1), arc });
  else out[out.length - 1] = { at: line.at(-1), arc };
  return out;
}

/**
 * A path along `points` [[x, y]], `width` units across (the picture's whole width: its band of dirt is what
 * part of that the picture gives), over the ground `groundAt(x, y)` (null where there is none: the height
 * before is kept). `texture` `{ name, size: [w, h] }`, the band running down the picture (its rows); `step`
 * the ribbon's length between turns; `smooth` how many times its corners are cut.
 */
export function trail({ points, width = 192, groundAt, texture, step = 48, lift = 3, sink = 2, smooth = 2 }) {
  if (!texture?.size) throw new Error("trail: the texture is { name, size: [w, h] }");
  const line = smoothLine(points, smooth);
  const marks = along(line, step);
  const scale = width / texture.size[0];
  // the way across at each mark: the mean of its two pieces' ways across
  const across = marks.map((m, i) => {
    const a = marks[Math.max(0, i - 1)].at,
      b = marks[Math.min(marks.length - 1, i + 1)].at;
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  });
  let last = 0;
  const heightAt = (x, y) => {
    const h = groundAt(x, y);
    if (h !== null && h !== undefined) last = h;
    return last;
  };
  // five rows across: the edges under the ground, the middle three over it
  const rows = [-1, -0.5, 0, 0.5, 1];
  const grid = marks.map((m, i) =>
    rows.map((r) => {
      const p = [m.at[0] + across[i][0] * r * (width / 2), m.at[1] + across[i][1] * r * (width / 2)];
      const end = i === 0 || i === marks.length - 1;
      return [...p, Math.round(heightAt(...p) + (Math.abs(r) === 1 || end ? -sink : lift))];
    }),
  );
  const brushes = [];
  for (let i = 0; i + 1 < marks.length; i++) {
    // the picture for this piece: its columns across the path, its middle on the line, its rows along it
    const [ux, uy] = across[i];
    const rotation = (Math.atan2(uy, ux) * 180) / Math.PI;
    const [vx, vy] = [uy, -ux]; // the rows' way, as textureAxes turns it
    const c = marks[i].at;
    const d = [marks[i + 1].at[0] - c[0], marks[i + 1].at[1] - c[1]];
    const sign = Math.sign(vx * d[0] + vy * d[1]) || 1;
    const fit = {
      name: texture.name,
      scale,
      rotation,
      offset: [
        texture.size[0] / 2 - (c[0] * ux + c[1] * uy) / scale,
        (sign * marks[i].arc - (c[0] * vx + c[1] * vy)) / scale,
      ],
    };
    for (let k = 0; k + 1 < rows.length; k++) {
      const [a, b, cc, dd] = [grid[i][k], grid[i][k + 1], grid[i + 1][k + 1], grid[i + 1][k]];
      for (const tri of [
        [a, b, cc],
        [a, cc, dd],
      ]) {
        const area =
          (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) -
          (tri[2][0] - tri[0][0]) * (tri[1][1] - tri[0][1]);
        if (Math.abs(area) < 64) continue; // a bend too tight for the width: the piece is left out
        const under = Math.min(...tri.map((p) => p[2])) - 16;
        const pts = [...tri.map(([x, y]) => [x, y, under]), ...tri];
        try {
          brushes.push(
            solid(pts, fit, {
              faces: [
                [0, 1, 2],
                [3, 4, 5],
                [0, 1, 3],
                [1, 2, 4],
                [2, 0, 5],
              ],
            }),
          );
        } catch {}
      }
    }
  }
  return { brushes, along: line };
}
