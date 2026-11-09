// levels/assembly/counter.mjs: a counter in a shop room, and the keeper's post behind it.
//
//   placeCounter({ cells, doors, blocked })  ->  { counter: { lo: [x, y], hi: [x, y] }, post: [x, y], front: [x, y], yaw, dir, doorClear, ... }
//                                                  or { why } when the room holds none
//
// Everything is in the site's units on the floor plan (z is the caller's). `cells`: the room's cells as "x,y" keys of the site's grid
// (64); `doors`: the room's doorways, `{ at: [x, y] (the lane 40 inside the room), mid: [x, y] (the doorway's middle), entrance: bool }`;
// `blocked`: the cells no prop takes (beside a doorway, in a leaf's swing). The room is held as dress.mjs holds it: its cells, kept 8
// off every wall that is not a doorway.
//
// The rule: the counter is a box 40 deep and 128 or 160 long across the room, its near face 32 from the keeper's post and facing the
// way to the street door (the customers' side); 96 of free floor in front of it; each end flush with a wall (within 8) or 40 off
// one (a gap a player 32 across walks through); no cell of a doorway's lane or swing under it; and every doorway of the room still
// walks to every other past it. The post is 96 from every doorway's middle where the room allows (80, then 64 where it does not,
// and the answer says so in `doorClear`), with 32 clear to its back and sides (a keeper 32 across).
const GRID = 64;
const HALF_WALL = 8;
const STEP = 8;
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const key = (x, y) => `${x},${y}`;
export const COUNTER_RULE = { depth: 40, lengths: [128, 160], height: 40, behind: 32, front: 96, side: 32, doorClears: [96, 80, 64], gapMin: 40, flush: 8 };

/** The yaw of a unit direction (0 east, 90 north). */
export const yawOfDir = ([dx, dy]) => (dx === 1 ? 0 : dy === 1 ? 90 : dx === -1 ? 180 : 270);

export function placeCounter({ cells, doors, blocked = new Set(), rule = COUNTER_RULE }) {
  const inCell = (x, y) => cells.has(key(Math.floor(x / GRID), Math.floor(y / GRID)));
  const inRoom = (x, y) => {
    const [cx, cy] = [Math.floor(x / GRID), Math.floor(y / GRID)];
    if (!cells.has(key(cx, cy))) return false;
    for (const [dx, dy] of DIRS) {
      if (cells.has(key(cx + dx, cy + dy))) continue;
      if (dx > 0 && (cx + 1) * GRID - x < HALF_WALL - 0.01) return false;
      if (dx < 0 && x - cx * GRID < HALF_WALL - 0.01) return false;
      if (dy > 0 && (cy + 1) * GRID - y < HALF_WALL - 0.01) return false;
      if (dy < 0 && y - cy * GRID < HALF_WALL - 0.01) return false;
    }
    return true;
  };
  /** A square of half-width `half` about (x, y) wholly on the room's floor. */
  const square = (x, y, half) => {
    for (let u = -half; u <= half; u += Math.min(STEP, half || STEP))
      for (const [px, py] of [[x + u, y - half], [x + u, y + half], [x - half, y + u], [x + half, y + u]]) if (!inRoom(px, py)) return false;
    return inRoom(x, y);
  };
  const xs = [...cells].map((k) => +k.split(",")[0]);
  const ys = [...cells].map((k) => +k.split(",")[1]);
  if (!xs.length) return { why: "the room has no cells" };
  const box = { x0: Math.min(...xs) * GRID, x1: (Math.max(...xs) + 1) * GRID, y0: Math.min(...ys) * GRID, y1: (Math.max(...ys) + 1) * GRID };
  const centre = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
  const entrance = doors.find((d) => d.entrance) ?? doors[0];
  const wallsClear = (p, k) => [-16, 0, 16].every((s) => inRoom(p[0] + k[0] * rule.side - k[1] * s, p[1] + k[1] * rule.side + k[0] * s));
  const blockedHit = (lo, hi) => {
    for (let gx = Math.floor((lo[0] - 4) / GRID); gx <= Math.floor((hi[0] + 4) / GRID); gx++)
      for (let gy = Math.floor((lo[1] - 4) / GRID); gy <= Math.floor((hi[1] + 4) / GRID); gy++) if (blocked.has(key(gx, gy))) return true;
    return false;
  };
  /** How far the room's floor goes from (x, y) along k before a wall's margin (up to `max`). */
  const reach = (x, y, k, max, step = STEP) => {
    let n = 0;
    while (n < max && inRoom(x + k[0] * (n + step), y + k[1] * (n + step))) n += step;
    return n;
  };
  // doorway lanes walk to each other (the dress's lane rule, with the counter as the one clip)
  const walkable = (lo, hi, must = []) => {
    const spots = doors.map((d) => [Math.round(d.at[0] / STEP) * STEP, Math.round(d.at[1] / STEP) * STEP]);
    const hit = (x, y, half) => x + half > lo[0] && x - half < hi[0] && y + half > lo[1] && y - half < hi[1];
    const free = (x, y, half) => !hit(x, y, half) && square(x, y, half);
    const live = spots.filter((p) => free(p[0], p[1], 24));
    if (live.length < 1) return true;
    const seen = new Set([`${live[0]}`]);
    const todo = [live[0]];
    while (todo.length) {
      const [x, y] = todo.pop();
      for (const [dx, dy] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) {
        const n = [x + dx, y + dy];
        if (!seen.has(`${n}`) && free(n[0], n[1], 16)) (seen.add(`${n}`), todo.push(n));
      }
    }
    // and the keeper's post, past the counter's open end, is walked to as well
    return live.every((p) => seen.has(`${p}`)) && must.every((m) => [[0, 0], [STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]].some(([dx, dy]) => seen.has(`${Math.round(m[0] / STEP) * STEP + dx},${Math.round(m[1] / STEP) * STEP + dy}`)));
  };

  for (const doorClear of rule.doorClears) {
    for (const minDot of [0.35, -1]) {
      const found = [];
      for (let px = box.x0 + STEP; px < box.x1; px += STEP)
        for (let py = box.y0 + STEP; py < box.y1; py += STEP) {
          if (!square(px, py, 16)) continue;
          const away = Math.min(Infinity, ...doors.map((d) => Math.hypot(px - d.mid[0], py - d.mid[1])));
          if (away < doorClear) continue;
          for (const d of DIRS) {
            // the post's back and sides: 32 clear (the counter's side is the counter's)
            if (!DIRS.every((k) => (k[0] === d[0] && k[1] === d[1]) || wallsClear([px, py], k))) continue;
            const toE = entrance ? [entrance.at[0] - px, entrance.at[1] - py] : d;
            const dot = (d[0] * toE[0] + d[1] * toE[1]) / (Math.hypot(...toE) || 1);
            if (dot < minDot) continue;
            const a = [-d[1], d[0]]; // across the counter
            const near = rule.behind;
            const far = rule.behind + rule.depth;
            for (const L of rule.lengths)
              for (const off of [0, -16, 16, -32, 32, -48, 48, -64, 64]) {
                // the counter's two ends along a, measured from the post's line
                let e0 = off - L / 2;
                let e1 = off + L / 2;
                const at = (along, deep) => [px + d[0] * deep + a[0] * along, py + d[1] * deep + a[1] * along];
                let ok = true;
                const opens = []; // the ends left open: a gap a player walks round by, to the keeper's side
                for (const [side, e] of [[-1, e0], [1, e1]]) {
                  // the wall's distance past this end, over the counter's whole depth
                  let gap = Infinity;
                  for (const deep of [near, (near + far) / 2, far]) {
                    const [sx, sy] = at(e, deep);
                    gap = Math.min(gap, reach(sx, sy, [a[0] * side, a[1] * side], rule.gapMin + STEP * 2));
                  }
                  if (gap <= rule.flush) {
                    // flush: the end runs on to the wall's face (found to the unit)
                    const [sx, sy] = at(e, (near + far) / 2);
                    const full = reach(sx, sy, [a[0] * side, a[1] * side], 2 * STEP, 1);
                    if (side < 0) e0 -= full;
                    else e1 += full;
                  } else if (gap < rule.gapMin) ok = false;
                  else opens.push({ side, e, gap });
                }
                if (!ok || !opens.length) continue; // (a counter closed at both ends would shut the keeper's post off from the room's graph)
                // the box
                const c0 = at(e0, near);
                const c1 = at(e1, far);
                const lo = [Math.min(c0[0], c1[0]), Math.min(c0[1], c1[1])];
                const hi = [Math.max(c0[0], c1[0]), Math.max(c0[1], c1[1])];
                // all of it on the room's floor (a flush end may reach the wall's margin)
                for (let u = lo[0]; ok && u <= hi[0] + STEP; u += STEP) for (let v = lo[1]; ok && v <= hi[1] + STEP; v += STEP) if (!inRoom(Math.min(u, hi[0]), Math.min(v, hi[1]))) ok = false; // prettier-ignore
                if (!ok || blockedHit(lo, hi)) continue;
                // the customers' side: 96 of floor in front, across the counter's length
                for (let deep = far + STEP; ok && deep <= far + rule.front; deep += STEP)
                  for (let along = e0; along <= e1; along += STEP) {
                    const [sx, sy] = at(Math.min(Math.max(along, e0 + 12), e1 - 12), deep);
                    if (!inRoom(sx, sy)) { ok = false; break; } // prettier-ignore
                  }
                if (!ok) continue;
                const front = at((e0 + e1) / 2, far + 40);
                const open = opens.sort((p, q) => q.gap - p.gap || q.side - p.side)[0];
                const gapAt = open.e + (open.side * Math.min(open.gap, rule.gapMin + 2 * STEP)) / 2;
                const pass = [at(gapAt, far + 24), at(gapAt, 8)]; // the middle of the gap beside the counter's end: on the customers' side, then on the keeper's
                const score =
                  120 * dot + Math.min(Math.hypot(px - (entrance?.at[0] ?? px), py - (entrance?.at[1] ?? py)), 320) / 4 + Math.min(away, 160) / 4 - Math.abs(off) * 0.4 - Math.hypot(front[0] - centre[0], front[1] - centre[1]) * 0.05 + (L === 128 ? 5 : 0); // prettier-ignore
                found.push({ score, pass, d, back: reach(px, py, [-d[0], -d[1]], 200, 1), post: [px, py], lo, hi, front, doorClear: Math.round(away), L: Math.round(Math.hypot(hi[0] - lo[0], hi[1] - lo[1]) > 0 ? Math.max(hi[0] - lo[0], hi[1] - lo[1]) : 0) });
              }
          }
        }
      found.sort((p, q) => q.score - p.score);
      for (const f of found.slice(0, 400)) {
        if (!walkable(f.lo, f.hi, [f.post, ...f.pass])) continue;
        // what the check holds it to: the floor in front of the counter (from its far face) and the post's nearest wall (back and sides)
        const faceAt = (t) => (f.d[0] ? [f.d[0] > 0 ? f.hi[0] : f.lo[0], f.lo[1] + (f.hi[1] - f.lo[1]) * t] : [f.lo[0] + (f.hi[0] - f.lo[0]) * t, f.d[1] > 0 ? f.hi[1] : f.lo[1]]);
        const frontFree = Math.min(...[0.2, 0.5, 0.8].map((t) => { const [x, y] = faceAt(t); return reach(x, y, f.d, 200, 1); })); // prettier-ignore
        const clear = Math.min(...DIRS.filter((k) => !(k[0] === f.d[0] && k[1] === f.d[1])).map((k) => reach(f.post[0], f.post[1], k, 200, 1) + HALF_WALL * 0));
        return { frontFree, clear, pass: f.pass, counter: { lo: f.lo, hi: f.hi }, post: f.post, front: f.front, yaw: yawOfDir(f.d), dir: f.d, back: f.back, doorClear: f.doorClear, length: f.L, tier: doorClear };
      }
    }
  }
  return { why: "no spot in the room holds a counter 40 deep and 128 long with its keeper 32 behind it, 96 of floor in front and the doorways still walking to each other" };
}
