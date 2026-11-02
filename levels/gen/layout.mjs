// The floor-plan layout engine of stage 5: a zone (a storey, or one unit inside it) cut into rooms by a seeded
// search over slicing trees.
//
// A slicing tree cuts a rectangle in two by a straight line, again and again, until each piece holds one room
// (Marson and Musse 2010, "Automatic real-time generation of floor plans based on squarified treemaps"). The
// rooms are kept in an order (the entrance and the public rooms first, the private ones last, rooms that must
// meet kept together: Alexander's intimacy gradient) and each cut parts that order in two where the areas match
// the line's position. Three things go beyond a plain treemap:
// - fixed rectangles (a stair stacked on every storey, a court, a hall rising from below) are cut round first,
//   along their own edges, so the rest of the storey is sliced about them;
// - a cut may leave a corridor between its two sides (corridor insertion), when circulation asks for one: a
//   room no public or shared room can reach, a bedroom that would be a passage;
// - a strip of rooms that each need the same neighbour is cut across its length, so each keeps a wall on it.
// Every tree is scored: rooms under their minima, areas off their targets, slivers, street and window needs, the
// program's adjacency, every room reached from the entrance through doors that fit, none only through a private
// room, corridors leading somewhere. The best of a few hundred trees per zone wins; the seed makes it the same
// every time. Lengths here are steps of the plan grid (common.mjs `G`, 8 units).

import { G } from "./common.mjs";

const PRIVATE_FROM = 2;
/** A room whose footprint the city or the plan has already (the variety gate counts it): rooms held near their caps
 * cluster in size, so a repeat costs about as much as a room past its share by half. */
const REPEAT_PENALTY = 700;
/** How far past its use a service room (a soft cap) grows before its floor is left spare. */
export const SOFT_GIVE = 1.4;
/** The narrowest spare piece a pocket leaves beside its room (grid steps, 2 m): narrower, the room keeps it. */
const SPARE_MIN = 10;
const NONE = new Set();

/** Door needs in grid steps: the clear width plus the keep-clear side margin (0.3 m) each side, plus the end walls. */
export const doorNeed = (width) => Math.ceil((width + 0.6) / G) + 2;

export const rectArea = (r) => r.w * r.d;
const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.d <= b.y + b.d;
export const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d;

/**
 * Shared wall segments of two rectangles (touching edges): [{ o: "v" (a line x = c) | "h" (y = c), c, a, b }],
 * `a`..`b` along the line, grid steps.
 */
export function sharedSegments(r1, r2) {
  const out = [];
  if (r1.x + r1.w === r2.x || r2.x + r2.w === r1.x) {
    const c = r1.x + r1.w === r2.x ? r2.x : r1.x;
    const a = Math.max(r1.y, r2.y);
    const b = Math.min(r1.y + r1.d, r2.y + r2.d);
    if (b > a) out.push({ o: "v", c, a, b });
  }
  if (r1.y + r1.d === r2.y || r2.y + r2.d === r1.y) {
    const c = r1.y + r1.d === r2.y ? r2.y : r1.y;
    const a = Math.max(r1.x, r2.x);
    const b = Math.min(r1.x + r1.w, r2.x + r2.w);
    if (b > a) out.push({ o: "h", c, a, b });
  }
  return out;
}

/** The edges of a rectangle as segments, tagged by side. */
export const edgesOf = (r) => [
  { side: "s", o: "h", c: r.y, a: r.x, b: r.x + r.w },
  { side: "n", o: "h", c: r.y + r.d, a: r.x, b: r.x + r.w },
  { side: "w", o: "v", c: r.x, a: r.y, b: r.y + r.d },
  { side: "e", o: "v", c: r.x + r.w, a: r.y, b: r.y + r.d },
];

/** Overlap length of a rectangle's edges with a list of boundary segments `{ o, c, a, b }`. */
const touchLength = (rects, segs) => {
  let best = 0;
  for (const r of rects)
    for (const e of edgesOf(r))
      for (const s of segs) {
        if (s.o !== e.o || s.c !== e.c) continue;
        const L = Math.min(e.b, s.b) - Math.max(e.a, s.a);
        if (L > best) best = L;
      }
  return best;
};

// ── the slicing tree ──

/**
 * One slicing tree over `region` with `fixed` leaves inside it and `items` to place. Returns leaves:
 * `{ item, rects: [rect] }` (an item), `{ fixed, rects }`, `{ corridor: true, rects }`, `{ orphan: true, rects }`.
 */
function sliceOnce(region, items, fixed, rng, ctx) {
  const leaves = [];
  let corridors = 0;
  const pullScore = (group, rect) => {
    // how well a group fits a side: front and exterior needs met by that side touching the zone's boundary
    let s = 0;
    for (const it of group) {
      if (it.front && ctx.front && touchLength([rect], [ctx.front]) > 0) s += 3;
      if (it.exterior && touchLength([rect], ctx.exterior) > 0) s += 1;
      if (it.entry && ctx.entry && touchLength([rect], [ctx.entry]) > 0) s += 4;
      if (it.side && touchLength([rect], ctx.exterior.filter((e) => e.side === it.side)) > 0) s += 4;
    }
    return s;
  };
  const areaOf = (list) => list.reduce((s, it) => s + it.weight, 0);
  const minSideOf = (list) => list.reduce((m, it) => Math.max(m, it.minSideG), 0);

  const rec = (R, list, fx, depth) => {
    if (R.w <= 0 || R.d <= 0) return;
    if (!fx.length) {
      if (!list.length) return void leaves.push({ orphan: true, rects: [R] });
      if (list.length === 1) return void leaves.push({ item: list[0], rects: [R] });
    } else if (fx.length === 1 && !list.length && fx[0].rect.x === R.x && fx[0].rect.y === R.y && fx[0].rect.w === R.w && fx[0].rect.d === R.d) {
      return void leaves.push({ fixed: fx[0], rects: [R] });
    }
    if (fx.length) {
      // cut along an edge of a fixed rectangle that crosses none of them
      const cuts = [];
      for (const f of fx) {
        const r = f.rect;
        for (const [o, c] of [["v", r.x], ["v", r.x + r.w], ["h", r.y], ["h", r.y + r.d]]) {
          if (o === "v" && (c <= R.x || c >= R.x + R.w)) continue;
          if (o === "h" && (c <= R.y || c >= R.y + R.d)) continue;
          if (fx.some((g) => (o === "v" ? g.rect.x < c && c < g.rect.x + g.rect.w : g.rect.y < c && c < g.rect.y + g.rect.d))) continue;
          cuts.push({ o, c });
        }
      }
      if (!cuts.length) return void leaves.push({ orphan: true, rects: [R], broken: true });
      const cut = rng.pick(cuts);
      const [A, B] = cut.o === "v" ? [{ x: R.x, y: R.y, w: cut.c - R.x, d: R.d }, { x: cut.c, y: R.y, w: R.x + R.w - cut.c, d: R.d }] : [{ x: R.x, y: R.y, w: R.w, d: cut.c - R.y }, { x: R.x, y: cut.c, w: R.w, d: R.y + R.d - cut.c }]; // prettier-ignore
      const fa = fx.filter((f) => inside(f.rect, A));
      const fb = fx.filter((f) => inside(f.rect, B));
      const freeA = rectArea(A) - fa.reduce((s, f) => s + rectArea(f.rect), 0);
      const freeB = rectArea(B) - fb.reduce((s, f) => s + rectArea(f.rect), 0);
      const [la, lb] = partition(list, freeA, freeB, A, B);
      rec(A, la, fa, depth + 1);
      rec(B, lb, fb, depth + 1);
      return;
    }
    // a free cut: across the longer side mostly
    let vertical = R.w >= R.d ? rng.chance(0.86) : rng.chance(0.14);
    const strip = list.length >= 3 && list.every((it) => it.stripKey && it.stripKey === list[0].stripKey);
    if (strip) vertical = R.w >= R.d; // a strip of like rooms: across its length, each keeps the long wall
    // a pocket open on one side only (or two facing ones), the others the zone's wall or what no door crosses (a
    // connector's well or column, a stair's flank, a court): cut so each part keeps the open side, a row of rooms
    // along it, never one behind another with no way in (where the open side is long enough for the row)
    const open = openSides(R);
    const row = list.length * (minSideOf(list) + 1);
    if (open.length && open.every((x) => x === "w" || x === "e") && R.d >= row) vertical = false;
    else if (open.length && open.every((x) => x === "s" || x === "n") && R.w >= row) vertical = true;
    const L = vertical ? R.w : R.d;
    const cross = vertical ? R.d : R.w;
    const cw = ctx.corridor?.widthG ?? 0;
    const wantCorridor =
      ctx.corridor?.allowed &&
      corridors < (ctx.corridor.max ?? 2) &&
      list.length >= 3 &&
      !strip &&
      cross >= 3 * cw &&
      L >= cw + 2 * minSideOf(list) * 0.6 &&
      rng.chance(depth <= 1 ? ctx.corridor.p ?? 0.3 : (ctx.corridor.p ?? 0.3) * 0.5);
    const [la, lb] = partition(list, null, null, null, null);
    const usable = L - (wantCorridor ? cw : 0);
    const aA = areaOf(la);
    const aB = areaOf(lb);
    let t = Math.round((usable * aA) / (aA + aB));
    // no sliver: each side at least its group's narrowest allowed side (clear, plus a wall) where the length allows
    const needA = minSideOf(la) + 1;
    const needB = minSideOf(lb) + 1;
    if (needA + needB <= usable) t = Math.max(needA, Math.min(usable - needB, t));
    t = Math.max(1, Math.min(usable - 1, t));
    const lo = vertical ? R.x : R.y;
    const mk = (s, e) => (vertical ? { x: s, y: R.y, w: e - s, d: R.d } : { x: R.x, y: s, w: R.w, d: e - s });
    let A = mk(lo, lo + t);
    let B = mk(lo + t + (wantCorridor ? cw : 0), lo + L);
    // which group goes on which side: the one whose needs the side meets
    const keep = pullScore(la, A) + pullScore(lb, B);
    const swap = pullScore(la, B) + pullScore(lb, A);
    let ga = la;
    let gb = lb;
    if (swap > keep || (swap === keep && rng.chance(0.5))) {
      const tt = usable - t;
      A = mk(lo, lo + tt);
      B = mk(lo + tt + (wantCorridor ? cw : 0), lo + L);
      ga = lb;
      gb = la;
    }
    if (wantCorridor) {
      corridors++;
      const endA = vertical ? A.x + A.w : A.y + A.d;
      leaves.push({ corridor: true, rects: [mk(endA, endA + cw)] });
    }
    rec(A, ga, [], depth + 1);
    rec(B, gb, [], depth + 1);
  };

  /** The sides of a piece a door may open through: not on the zone's own edge, not wholly against a closed fixed rectangle. */
  function openSides(R) {
    const Z = ctx.rect;
    if (!Z) return [];
    const closed = (ctx.fixed ?? []).filter((f) => f.item?.void || f.item?.kind === "stairwell").map((f) => f.rect);
    const out = [];
    for (const e of edgesOf(R)) {
      const onZone = (e.side === "w" && e.c === Z.x) || (e.side === "e" && e.c === Z.x + Z.w) || (e.side === "s" && e.c === Z.y) || (e.side === "n" && e.c === Z.y + Z.d); // prettier-ignore
      if (onZone) continue;
      let covered = 0;
      for (const q of closed)
        for (const f of edgesOf(q)) if (f.o === e.o && f.c === e.c) covered += Math.max(0, Math.min(e.b, f.b) - Math.max(e.a, f.a));
      if (covered < e.b - e.a - 2) out.push(e.side);
    }
    return out;
  }

  /** Parts the ordered list in two, contiguous, where the areas match (free areas when given), a little at random. */
  function partition(list, freeA, freeB) {
    if (list.length === 0) return [[], []];
    if (freeA !== null) {
      if (freeA <= 0) return [[], list];
      if (freeB <= 0) return [list, []];
    }
    const total = areaOf(list);
    const want = freeA !== null ? freeA / (freeA + freeB) : 0.5;
    let best = [];
    let acc = 0;
    for (let k = 0; k <= list.length; k++) {
      if (k > 0) acc += list[k - 1].weight;
      if (freeA === null && (k === 0 || k === list.length)) continue;
      // round a fixed rectangle: a side with real floor gets rooms (an empty side is only for a sliver)
      if (freeA !== null && k === 0 && freeA > 0.04 * (freeA + freeB) && list.length) continue;
      if (freeA !== null && k === list.length && freeB > 0.04 * (freeA + freeB) && list.length) continue;
      const ratio = acc / total;
      // round a fixed rectangle each side takes rooms enough to fill its floor under their caps where the order allows:
      // a pocket the fixed rectangles cut is not left to one room
      const short = freeA !== null ? (Math.max(0, freeA - capacityOf(list.slice(0, k))) + Math.max(0, freeB - capacityOf(list.slice(k)))) / (freeA + freeB) : 0; // prettier-ignore
      best.push({ k, err: Math.abs(ratio - want) + short });
    }
    if (!best.length) best.push({ k: freeA >= freeB ? list.length : 0, err: 0 });
    best.sort((a, b) => a.err - b.err);
    const choice = best.length > 1 && rng.chance(0.3) ? best[1] : best[0];
    return [list.slice(0, choice.k), list.slice(choice.k)];
  }

  rec(region, items, fixed, 0);
  return leaves;
}

/**
 * Merges orphan pieces into a neighbour whose union stays a rectangle, else into one making an L (two rectangles):
 * never past the neighbour's cap (the rulebook's, a corridor's area), never a corridor made wider than its class allows
 * nor given a bay narrower than itself. An orphan none may take stays: floor left unbuilt.
 */
function mergeOrphans(leaves, ctx) {
  const orphans = leaves.filter((l) => l.orphan);
  const isCorridor = (l) => l.corridor || l.item?.kind === "corridor";
  const fits = (l, add) => {
    const a = l.rects.reduce((s, x) => s + rectArea(x), 0) + add;
    const cap = l.item ? (l.item.hardCapG ?? (l.item.maxAreaG ? l.item.maxAreaG * SOFT_GIVE : null)) : null;
    if (cap && a > cap) return false;
    if (isCorridor(l) && ctx.corridorCapG && a > ctx.corridorCapG) return false;
    return true;
  };
  // a bay beside a corridor is no narrower than the corridor (its class's least width)
  const wideEnough = (l, r) => !isCorridor(l) || Math.min(r.w, r.d) >= Math.min(...l.rects.map((x) => Math.min(x.w, x.d)));
  for (const o of orphans) {
    const r = o.rects[0];
    let done = false;
    // a neighbour sharing a whole edge of the orphan, same extent: the union is one rectangle
    for (const l of leaves) {
      if (l === o || l.orphan || l.fixed || l.rects.length !== 1) continue;
      if (l.item?.locked || !fits(l, rectArea(r))) continue;
      const q = l.rects[0];
      const sameY = q.y === r.y && q.d === r.d && (q.x + q.w === r.x || r.x + r.w === q.x);
      const sameX = q.x === r.x && q.w === r.w && (q.y + q.d === r.y || r.y + r.d === q.y);
      // a corridor widened no wider than its class allows (roomKinds.corridor.maxWidthOfTypical)
      if ((sameY || sameX) && isCorridor(l) && ctx.corridorWideG && Math.min(sameY ? q.w + r.w : q.w, sameX ? q.d + r.d : q.d) > ctx.corridorWideG) continue; // prettier-ignore
      if (sameY || sameX) {
        l.rects = [{ x: Math.min(q.x, r.x), y: Math.min(q.y, r.y), w: sameY ? q.w + r.w : q.w, d: sameX ? q.d + r.d : q.d }];
        o.merged = true;
        done = true;
        break;
      }
    }
    if (done) continue;
    // an L: a circulation leaf or the longest shared edge
    let best = null;
    for (const l of leaves) {
      if (l === o || l.orphan || l.fixed || l.rects.length !== 1 || l.item?.locked || !fits(l, rectArea(r)) || !wideEnough(l, r)) continue;
      if (ctx.noL && !l.corridor && !l.item?.circ) continue;
      const segs = sharedSegments(l.rects[0], r);
      const len = segs.reduce((s, x) => s + x.b - x.a, 0);
      // the orphan's whole edge must lie along the neighbour (a clean L, no notch)
      const whole = segs.some((x) => x.b - x.a === (x.o === "v" ? r.d : r.w));
      // an L's arm wide enough that its clear part is no sliver (half a wall off each side: 1.44 m and more)
      if (!whole || !len || Math.min(r.w, r.d) < 9) continue;
      const score = len + (l.corridor || l.item?.circ ? 1000 : 0);
      if (!best || score > best.score) best = { l, score };
    }
    if (best) {
      best.l.rects = [...best.l.rects, r];
      o.merged = true;
      continue;
    }
    // none may take it: a corridor bay of its own where it is as wide as a corridor (and no wider than its class
    // allows), off circulation and against a room it may lead to, so it opens a way instead of closing one
    const cw = ctx.corridor?.allowed ? ctx.corridor.widthG : 0;
    const narrow = Math.min(r.w, r.d);
    if (!cw || narrow < cw || (ctx.corridorWideG && narrow > ctx.corridorWideG) || (ctx.corridorCapG && rectArea(r) > ctx.corridorCapG)) continue;
    const touches = (l, need) => l !== o && !l.orphan && sharedSegments(l.rects[0], r).concat(...l.rects.slice(1).map((q) => sharedSegments(q, r))).some((x) => x.b - x.a >= need); // prettier-ignore
    // off circulation: a corridor, a gate room or a lift lobby, the zone's hub (a lobby)
    const offCorridor = leaves.some((l) => (l.corridor || l.item?.circ || l.item?.hub || (l.fixed && l.fixed.item?.kind === "corridor")) && !l.item?.void && touches(l, 9)); // prettier-ignore
    const toRoom = leaves.some((l) => l.item && !l.item.void && !l.item.circ && touches(l, 9));
    if (offCorridor && toRoom) {
      o.orphan = false;
      o.corridor = true;
      o.bay = true;
      o.unit = ctx.corridorUnit ?? null; // the zone's corridors' unit (searchZone sets it on the others)
    }
  }
  return leaves.filter((l) => !(l.orphan && l.merged));
}

/** Corridors longer than the rulebook's run are cut into pieces joined by an opening (a widening or a turn). */
function splitCorridors(leaves, maxRunG) {
  const out = [];
  for (const l of leaves) {
    if (!(l.corridor || l.item?.kind === "corridor") || l.rects.length !== 1) {
      out.push(l);
      continue;
    }
    const r = l.rects[0];
    const long = Math.max(r.w, r.d);
    if (long <= maxRunG) {
      out.push(l);
      continue;
    }
    const n = Math.ceil(long / maxRunG);
    const along = r.w >= r.d;
    let s = along ? r.x : r.y;
    const end = along ? r.x + r.w : r.y + r.d;
    for (let i = 0; i < n; i++) {
      const e = i === n - 1 ? end : s + Math.round(long / n);
      const rect = along ? { x: s, y: r.y, w: e - s, d: r.d } : { x: r.x, y: s, w: r.w, d: e - s };
      out.push(l.item ? { ...l, rects: [rect], piece: i } : { corridor: true, rects: [rect], piece: i });
      s = e;
    }
  }
  return out;
}

/**
 * A room's footprint key as the stats count it: its clear rectangles (half a wall in where a rectangle meets
 * another room, none on the shell's own face), sides sorted, on the plan grid.
 */
export function shapeKey(rects, shell) {
  const one = (r) => {
    // a side on the shell's own face loses no half wall
    const w = r.w - (shell && r.x === shell.x ? 0 : 0.5) - (shell && r.x + r.w === shell.x + shell.w ? 0 : 0.5);
    const d = r.d - (shell && r.y === shell.y ? 0 : 0.5) - (shell && r.y + r.d === shell.y + shell.d ? 0 : 0.5);
    const a = Math.round(w);
    const b = Math.round(d);
    return a <= b ? `${a}x${b}` : `${b}x${a}`;
  };
  return rects.length === 1 ? one(rects[0]) : rects.map(one).sort().join("+");
}
/** Voids a window may look onto: open to the sky (a leftover piece, a shaft or a hall's void are not). */
export const LIGHT = new Set(["court", "terrace", "open-garden"]);
const NOT_COUNTED = new Set(["corridor", "stairwell", "lift-lobby", "gate", "upper-hall", "catwalk"]);

// ── evaluation: adjacency, doors, score ──

/** Builds the leaves' adjacency: for each pair, the shared segments (grid steps, partition lines). */
export function adjacencyOf(leaves) {
  const adj = new Map();
  for (let i = 0; i < leaves.length; i++)
    for (let j = i + 1; j < leaves.length; j++) {
      const segs = [];
      for (const a of leaves[i].rects) for (const b of leaves[j].rects) segs.push(...sharedSegments(a, b));
      if (segs.length) adj.set(`${i}:${j}`, segs);
    }
  return adj;
}
const segsBetween = (adj, i, j) => adj.get(i < j ? `${i}:${j}` : `${j}:${i}`) ?? [];

/**
 * A segment's part a door can use, for a door into or out of `leaf`: a stairwell only along its entry landing.
 * Returns segments clipped (grid steps).
 */
const usable = (segs, leaf) => {
  const z = leaf?.entryZone;
  if (!z) return segs;
  const out = [];
  for (const s of segs) {
    const c = clipToRect(s, z);
    if (c) out.push(c);
  }
  return out;
};
/** A segment clipped to a rectangle (its line within the rectangle's closed extent). */
export function clipToRect(s, r) {
  if (s.o === "v") {
    if (s.c < r.x || s.c > r.x + r.w) return null;
    const a = Math.max(s.a, r.y);
    const b = Math.min(s.b, r.y + r.d);
    return b > a ? { ...s, a, b } : null;
  }
  if (s.c < r.y || s.c > r.y + r.d) return null;
  const a = Math.max(s.a, r.x);
  const b = Math.min(s.b, r.x + r.w);
  return b > a ? { ...s, a, b } : null;
}
const longest = (segs) => segs.reduce((m, s) => (s.b - s.a > (m ? m.b - m.a : -1) ? s : m), null);

/** A leaf's description for the door rules. */
export const leafInfo = (l) => {
  if (l.fixed) return { kind: l.fixed.item.kind, rank: l.fixed.item.rank ?? 1, circ: Boolean(l.fixed.item.circ), void: Boolean(l.fixed.item.void), unit: l.fixed.item.unit ?? null, item: l.fixed.item }; // prettier-ignore
  if (l.corridor) return { kind: "corridor", rank: 1, circ: true, void: false, unit: l.unit ?? null };
  if (l.orphan) return { kind: "void", rank: 0, circ: false, void: true, unit: null };
  return { kind: l.item.kind, rank: l.item.rank ?? 0, circ: Boolean(l.item.circ), void: Boolean(l.item.void), unit: l.item.unit ?? null, item: l.item }; // prettier-ignore
};

/**
 * Chooses doors: a tree grown from the entrances, each room joined to the best room already reached (the program's
 * `next` kinds first, then circulation, then the zone's hub, never through a private room unless the pair is an en
 * suite the rulebook lists, never between two units, never a `notNext` pair), then the doors adjacency still asks.
 * Returns `{ doors: [{ i, j, seg, kind }], reached, unreached: [i], nextMissing: [{ i, group }] }`.
 */
export function assignDoors(leaves, adj, ctx) {
  const info = leaves.map(leafInfo);
  const n = leaves.length;
  const doors = [];
  const reached = new Set();
  const allowedPairs = ctx.privateThrough ?? new Set();
  const kindOfDoor = ctx.doorKind;
  const linkOk = (u, v) => {
    const a = info[u];
    const b = info[v];
    if (a.void || b.void) return false;
    if (a.item?.notNext?.includes(b.kind) || b.item?.notNext?.includes(a.kind)) return false;
    if (b.item?.onlyFrom && !b.item.onlyFrom.includes(a.kind)) return false;
    if (a.item?.onlyFrom && !a.item.onlyFrom.includes(b.kind)) return false;
    if (a.item?.hidden && !b.item?.hiddenHost) return false;
    if (b.item?.hidden && !(a.item && b.item.host?.includes(a.kind))) return false;
    if ((a.unit ?? null) !== (b.unit ?? null)) {
      // between units only through shared circulation, and only into the unit's own entry room
      const common = a.unit === null ? a : b.unit === null ? b : null;
      const other = common === a ? b : a;
      if (!common || !common.circ || !other.item?.unitEntry) return false;
    }
    return true;
  };
  const passFrom = (u, v) => {
    const a = info[u];
    if (a.item?.blob) return false; // a unit at the storey level: entered, never passed through
    if (a.item?.hidden) return false;
    // service rooms are ends, never passages (the rulebook's circulation.noPassThrough), but a hidden room may open off them
    if ((ctx.noPass ?? NONE).has(a.kind) && !info[v].item?.hidden) return false;
    if (a.rank >= PRIVATE_FROM && !ctx.entrances.includes(u) && !allowedPairs.has(`${a.kind}>${info[v].kind}`)) return false;
    return true;
  };
  const doorFor = (u, v) => {
    const kind = kindOfDoor(info[u], info[v]);
    const segs = usable(usable(segsBetween(adj, u, v), leaves[u]), leaves[v]);
    const need = doorNeed(ctx.doorWidth(kind));
    const seg = longest(segs);
    if (!seg || seg.b - seg.a < need) return null;
    return { kind, seg };
  };
  for (const e of ctx.entrances) reached.add(e);
  const pref = (u, v) => {
    const a = info[u];
    const b = info[v];
    let s = 0;
    if (b.item?.next?.some((g) => g.includes(a.kind))) s += 100;
    if (b.item?.prefer?.includes(a.kind)) s += 70;
    if (a.circ) s += 60;
    if (a.item?.hub) s += 40;
    s -= a.rank * 15;
    if (!a.circ && !a.item?.hub) s -= 20;
    return s;
  };
  for (;;) {
    let best = null;
    for (const u of reached)
      for (let v = 0; v < n; v++) {
        if (reached.has(v) || info[v].void) continue;
        if (!segsBetween(adj, u, v).length || !linkOk(u, v) || !passFrom(u, v)) continue;
        const s = pref(u, v);
        if (best && s <= best.s) continue;
        const d = doorFor(u, v);
        if (!d) continue;
        best = { u, v, s, d };
      }
    if (!best) break;
    doors.push({ i: best.u, j: best.v, seg: best.d.seg, kind: best.d.kind });
    reached.add(best.v);
  }
  // doors the program's adjacency still asks for
  const nextMissing = [];
  const linked = (i, j) => doors.some((d) => (d.i === i && d.j === j) || (d.i === j && d.j === i));
  for (let i = 0; i < n; i++) {
    const it = info[i].item;
    if (!it?.next?.length || info[i].void) continue;
    for (const group of it.next) {
      const has = doors.some((d) => (d.i === i && group.includes(info[d.j].kind)) || (d.j === i && group.includes(info[d.i].kind)));
      if (has) continue;
      let added = false;
      for (let j = 0; j < n && !added; j++) {
        if (j === i || !group.includes(info[j].kind) || linked(i, j) || !linkOk(i, j)) continue;
        if (!reached.has(j)) continue; // the partner already reached: an adjacency door never opens a new way in
        // never a new way through a private room
        if (info[i].rank >= PRIVATE_FROM && info[j].rank >= PRIVATE_FROM && !allowedPairs.has(`${info[i].kind}>${info[j].kind}`) && !allowedPairs.has(`${info[j].kind}>${info[i].kind}`)) continue; // prettier-ignore
        const d = doorFor(j, i);
        if (!d) continue;
        doors.push({ i: j, j: i, seg: d.seg, kind: d.kind, extra: true });
        added = true;
      }
      if (!added) nextMissing.push({ i, group });
    }
  }
  const unreached = [];
  for (let v = 0; v < n; v++) if (!reached.has(v) && !info[v].void) unreached.push(v);
  return { doors, reached, unreached, nextMissing, info };
}

/** Scores one candidate (lower is better) and says why, for the report. */
function scoreOf(leaves, adj, dres, ctx) {
  let score = 0;
  const why = [];
  const info = dres.info;
  const totalW = ctx.items.reduce((s, it) => s + it.weight, 0) || 1;
  const freeArea = ctx.freeArea;
  for (let i = 0; i < leaves.length; i++) {
    const l = leaves[i];
    const it = l.item;
    if (l.orphan) {
      const a = l.rects.reduce((s, r) => s + rectArea(r), 0);
      score += a * 1.2 + 500;
      why.push(`orphan ${a}`);
      continue;
    }
    if (info[i].kind === "corridor") {
      const dn = dres.doors.filter((d) => d.i === i || d.j === i).length;
      const a = l.rects.reduce((s, r) => s + rectArea(r), 0);
      score += a * 0.12;
      if (dn < 2) {
        score += 1500;
        why.push("corridor to nowhere");
      }
      // a corridor that only leads to other corridors
      const toRooms = dres.doors.filter((d) => (d.i === i && info[d.j].kind !== "corridor") || (d.j === i && info[d.i].kind !== "corridor")).length; // prettier-ignore
      if (toRooms === 0) score += 900;
      // a dead end longer than the rulebook's (circulation.deadEnd.maxLength)
      const long = Math.max(...l.rects.map((r) => Math.max(r.w, r.d)));
      if (dn === 1 && long > (ctx.deadEndG ?? 48)) score += 1500;
      const narrow = Math.min(...l.rects.map((r) => Math.min(r.w, r.d)));
      if (it && narrow < it.minSideG) score += (it.minSideG - narrow) * 300;
      // a program corridor (a house's hall) grown past its kind's caps: wider than its class allows, or past maxArea
      const wide = narrow - 1; // clear: half a wall each side
      if (it?.maxWidthG && wide > it.maxWidthG) {
        score += 1500 + (wide - it.maxWidthG) * 200;
        why.push(`${it.id} wide`);
      }
      if (it?.maxAreaG && a > it.maxAreaG) score += 300 + ((a - it.maxAreaG) / it.maxAreaG) * 600;
      continue;
    }
    if (!it) continue;
    const main = l.rects.reduce((m, r) => (rectArea(r) > rectArea(m) ? r : m), l.rects[0]);
    const area = l.rects.reduce((s, r) => s + rectArea(r), 0);
    const narrow = Math.min(main.w, main.d) - 1; // clear: half a wall each side
    const narrowAll = Math.min(...l.rects.map((r) => Math.min(r.w, r.d))) - 1;
    // under its least side or area the gate fails the plan: as dear as a room with no window (a capped room's floor
    // is held near its target, so a slender cut is no longer the price of a large room)
    if (narrow < it.minSideG) {
      score += (it.minSideG - narrow) * 400 + 1500;
      why.push(`${it.id} narrow`);
    }
    if (l.rects.length > 1 && narrowAll < Math.min(it.minSideG, 8)) score += 600;
    const clearArea = area - (main.w + main.d); // about half a wall all round
    if (clearArea < it.minAreaG) {
      score += (it.minAreaG - clearArea) * 2 + 1500;
      why.push(`${it.id} small`);
    }
    if (!it.void) {
      const target = (it.weight / totalW) * freeArea;
      const ratio = area / target;
      score += Math.abs(ratio - 1) * 40 * (it.areaWeight ?? 1);
      if (ratio > 2.2) score += (ratio - 2.2) * 120 * (it.areaWeight ?? 1);
      if (it.maxAreaG && area > it.maxAreaG) score += 300 + ((area - it.maxAreaG) / it.maxAreaG) * 600; // a service room grown far past its use
      // past the rulebook's cap: in the search as a service room past its use (the polish splits the pocket), in
      // the polish dearer than any floor left unbuilt (an orphan's 500 + 1.2 a step), for the gate fails the plan
      // a service room far past its use (SOFT_GIVE times it): in the polish dearer than the floor it would leave spare
      if (ctx.strictCaps && !it.hardCapG && !it.blob && it.maxAreaG && area > it.maxAreaG * SOFT_GIVE) {
        score += 1000 + (area - it.maxAreaG * SOFT_GIVE) * 1.5;
        why.push(`${it.id} past its use`);
      }
      if (it.hardCapG && area > it.hardCapG) {
        score += ctx.strictCaps ? 2500 + (area - it.hardCapG) * 3 : 300 + ((area - it.hardCapG) / it.hardCapG) * 600;
        why.push(`${it.id} past its cap`);
      }
      const aspect = Math.max(main.w, main.d) / Math.max(1, Math.min(main.w, main.d));
      const maxAspect = it.maxAspect ?? 2.2;
      if (aspect > maxAspect) score += (aspect - maxAspect) * 90;
    }
    if (it.front && ctx.front && touchLength(l.rects, [ctx.front]) < doorNeed(it.frontDoorWidth ?? 1.6)) {
      score += 2500;
      why.push(`${it.id} off the street`);
    }
    if (it.anyOutside && touchLength(l.rects, ctx.exterior) < doorNeed(2.44)) {
      score += 2500;
      why.push(`${it.id} on no outside wall`);
    } else if (it.anyOutside && ctx.front && touchLength(l.rects, [ctx.front]) < doorNeed(2.44)) score += 200;
    if (it.side) {
      // a gate to a hallway: on an outside wall (2500), on the side its hallway leaves by if it can (300)
      if (touchLength(l.rects, ctx.exterior) < doorNeed(2.44)) {
        score += 2500;
        why.push(`${it.id} on no outside wall`);
      } else if (touchLength(l.rects, ctx.exterior.filter((e) => e.side === it.side)) < doorNeed(2.44)) score += 300;
    }
    if (it.exterior) {
      const ext = touchLength(l.rects, ctx.exterior);
      let viaVoid = 0;
      for (let j = 0; j < leaves.length; j++) if (info[j].void && LIGHT.has(info[j].kind)) viaVoid = Math.max(viaVoid, segsBetween(adj, i, j).reduce((m, s) => Math.max(m, s.b - s.a), 0)); // prettier-ignore
      if (Math.max(ext, viaVoid) < 9) {
        score += it.void ? 2500 : 1500;
        why.push(`${it.id} no window`);
      }
    }
    if (it.entry && ctx.entry) {
      // the unit's entry door must open into this room
      if (touchLength(l.rects, [ctx.entry]) < ctx.entry.b - ctx.entry.a) {
        score += 2500;
        why.push(`${it.id} misses the entry`);
      }
    }
    if (it.notEntry && ctx.entry && touchLength(l.rects, [ctx.entry]) >= ctx.entry.b - ctx.entry.a) score += 2500;
    // a stretch of wall stage 4 ties the room to (a gate at its hallway's end, a lift lobby at its shaft)
    for (const m of it.mustTouch ?? [])
      if (touchLength(l.rects, [m.seg]) < m.need) {
        score += 2500;
        why.push(`${it.id} off ${m.why}`);
      }
  }
  // fixed rooms tied to the wall too (a checkpoint's guard post at a hallway's end is held by its own place)
  for (let i = 0; i < leaves.length; i++) {
    const it = leaves[i].fixed?.item;
    for (const m of it?.mustTouch ?? []) if (touchLength(leaves[i].rects, [m.seg]) < m.need) score += 2500;
  }
  // a hallway's end with no gate room: the room there takes its door, so it is one a door may open into
  for (const h of ctx.hallAt ?? []) {
    let ok = false;
    for (let i = 0; i < leaves.length && !ok; i++) {
      const inf = info[i];
      if (inf.void || inf.item?.hidden || inf.rank >= PRIVATE_FROM || (ctx.noPass ?? NONE).has(inf.kind)) continue;
      if (touchLength(leaves[i].rects, [h.seg]) >= h.need) ok = true;
    }
    if (!ok) {
      score += 1500;
      why.push(`hallway ${h.hallway}'s end blocked`);
    }
  }
  // footprints the city (or this candidate) already has: a room the same shape as another is a repeat
  if (ctx.used) {
    const mine = new Map();
    for (const l of leaves) {
      const it = l.item;
      // a unit's block counts when it is one room (a bedsit flat): its room's footprint is the block's
      if (!it || it.void || (it.blob && !it.oneRoom) || NOT_COUNTED.has(it.kind)) continue;
      const key = shapeKey(l.rects, ctx.shellRect);
      if (ctx.used.has(key) || mine.has(key)) score += ctx.repeatPenalty ?? REPEAT_PENALTY;
      mine.set(key, true);
    }
  }
  // a storey on one stair keeps its rooms under the rulebook's area for one (circulation.stairs.maxAreaOnOneStair)
  if (ctx.maxRoomAreaG) {
    let built = 0;
    for (let i = 0; i < leaves.length; i++) if (!info[i].void) built += leaves[i].rects.reduce((s, r) => s + rectArea(r), 0);
    if (built > ctx.maxRoomAreaG) score += 4000 + (built - ctx.maxRoomAreaG) * 3;
  }
  // a well or shaft a connector stops at: a room against its exit side, wide enough for its door
  for (let i = 0; i < leaves.length; i++) {
    const it = leaves[i].fixed?.item;
    if (!it?.exitSide) continue;
    const e = edgesOf(leaves[i].rects[0]).find((x) => x.side === it.exitSide);
    let best = 0;
    // only a room a connector may open into: not a cell, a private room, a hidden one or a room nobody passes through
    const takes = (j) => !info[j].void && !info[j].item?.hidden && info[j].rank < PRIVATE_FROM && (!(ctx.noPass ?? NONE).has(info[j].kind) || info[j].kind === ctx.liftLobby); // prettier-ignore
    for (let j = 0; j < leaves.length; j++) if (j !== i && takes(j)) best = Math.max(best, touchLength(leaves[j].rects, [e]));
    if (best < doorNeed(1.63)) {
      score += 2500;
      why.push(`${it.id} exit blocked`);
    }
  }
  for (const v of dres.unreached) {
    score += 3000;
    why.push(`${info[v].item?.id ?? info[v].kind} unreached`);
  }
  for (const m of dres.nextMissing) {
    score += info[m.i].kind === "stairwell" ? 2500 : 1500;
    why.push(`${info[m.i].item?.id} not next to ${m.group.join("/")}`);
  }
  // rooms used as passages (doors through a room that is neither circulation nor the hub)
  const through = new Map();
  for (const d of dres.doors) through.set(d.i, (through.get(d.i) ?? 0) + 1);
  for (const [i, k] of through) if (!info[i].circ && !info[i].item?.hub && k > 1) score += 25 * (k - 1);
  if (ctx.mainDoor) {
    // the street door near where stage 2 put it
    const e = leaves.findIndex((l) => l.item?.hub && ctx.front);
    if (e >= 0) {
      const covers = (leaves[e].rects ?? []).some((r) => edgesOf(r).some((x) => x.o === ctx.front.o && x.c === ctx.front.c && x.a <= ctx.mainDoor - 4 && x.b >= ctx.mainDoor + 4)); // prettier-ignore
      if (!covers) score += 60;
    }
  }
  return { score, why };
}

/**
 * The items' weights with their caps kept: a room whose share of the zone's free floor would pass its maxAreaG (a
 * kind's maxArea, or a service room's use) is weighed down to just under it, and the floor it leaves goes to the
 * others by their weights, so the slicer and the score aim every room under its cap instead of the score fighting
 * shares the slicer cut. Copies; when every room is capped the shares stay as they were (the gate says so).
 */
export function cappedWeights(items, freeArea) {
  // each room held at its own share of its cap (0.8 to 0.96, by its id), so rooms of one kind held at the cap
  // still differ in size (the weights' jitter would otherwise be lost and their footprints repeat)
  const hold = (it) => 0.8 + 0.16 * ([...String(it.id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 1000) / 999;
  // every cap first; when every room would pass its cap, the service rooms (a soft cap, their use, the score's) take
  // up to SOFT_GIVE times it before a kind the rulebook caps (hardCapG, the gate's) is weighed down; when even so
  // every room would pass its cap each is weighed by its cap, so all pass theirs by one share and the polish's
  // pockets (splitPockets) leave the rest spare, a little beside each room, not one room's worth beside one
  const capOf = (it, soft) => (soft ? it.maxAreaG : it.hardCapG !== undefined ? (it.hardCapG ?? (it.maxAreaG ? it.maxAreaG * SOFT_GIVE : null)) : it.maxAreaG); // prettier-ignore
  for (const soft of [true, false]) {
    const out = items.map((it) => ({ ...it }));
    let stuck = false;
    for (let pass = 0; pass < 12 && !stuck; pass++) {
      const total = out.reduce((s, it) => s + it.weight, 0) || 1;
      const over = out.filter((it) => capOf(it, soft) && !it.void && (it.weight / total) * freeArea > capOf(it, soft) * hold(it) + 1e-9);
      if (!over.length) return out;
      if (over.length === out.filter((it) => !it.void).length) stuck = true;
      else for (const it of over) it.weight *= (capOf(it, soft) * hold(it)) / ((it.weight / total) * freeArea);
    }
    if (!stuck) return out;
  }
  return items.map((it) => (it.void || !capOf(it, false) ? { ...it } : { ...it, weight: capOf(it, false) * hold(it) }));
}

/** The floor a list of items may take under their caps (the rulebook's and a service room's use); Infinity when one has none. */
export const capacityOf = (list) => list.reduce((s, it) => s + (it.void ? Infinity : (it.hardCapG ?? (it.maxAreaG ? it.maxAreaG * SOFT_GIVE : Infinity))), 0); // prettier-ignore

/**
 * Searches slicing trees for one zone. `zone`: `{ rect, fixed: [{ item, rect }], items, front?, exterior: [segments],
 * entry?, corridor: { allowed, widthG, max, p, kind }, mainDoor?, entranceOf(leaves) -> [index], doorKind(a, b),
 * doorWidth(kind), privateThrough, maxRunG, trials, seedText }`. Items: `{ id, kind, weight, minSideG, minAreaG,
 * rank, circ?, front?, exterior?, entry?, next?, notNext?, unit?, void?, hub?, stripKey? }`, in intimacy order.
 * Returns the best `{ leaves, doors, score, why }`.
 */
export function searchZone(zone, rng) {
  const fixedArea = zone.fixed.reduce((s, f) => s + rectArea(f.rect), 0);
  const freeArea = rectArea(zone.rect) - fixedArea;
  zone = { ...zone, items: cappedWeights(zone.items, freeArea) };
  const ctx = { ...zone, freeArea };
  let best = null;
  // more trees for a zone of many rooms: the space of slicings grows with them
  const trials = Math.round((zone.trials ?? 300) * Math.max(1, zone.items.length / 9));
  for (let t = 0; t < trials; t++) {
    const order = perturb(zone.items, rng);
    let leaves = sliceOnce(zone.rect, order, zone.fixed, rng, ctx);
    leaves = mergeOrphans(leaves, ctx);
    leaves = splitCorridors(leaves, zone.maxRunG ?? 123);
    for (const l of leaves) {
      if (l.corridor) l.unit = zone.corridorUnit ?? null;
      const it = l.fixed?.item ?? l.item;
      if (it?.entryZone) l.entryZone = it.entryZone;
    }
    const adj = adjacencyOf(leaves);
    const entrances = zone.entranceOf(leaves, adj);
    const dres = assignDoors(leaves, adj, { ...ctx, entrances });
    const sc = scoreOf(leaves, adj, dres, ctx);
    if (!entrances.length) {
      sc.score += 5000;
      sc.why.push("no entrance");
    }
    if (!best || sc.score < best.score) best = { leaves, adj, doors: dres.doors, entrances, score: sc.score, why: sc.why, trial: t };
    if (best.score < (zone.goodEnough ?? -1)) break;
  }
  if (best) polish(best, zone, ctx);
  return best;
}

/**
 * Moves walls of the best plan by a step or three where a room repeats a footprint the city already has (or another
 * room of the plan): only a wall between exactly two rooms of the same extent (moving it changes just those two),
 * kept when the zone, its doors assigned again, scores better.
 */
function polish(best, zone, ctx0) {
  const ctx = { ...ctx0, strictCaps: true };
  const evalLeaves = (leaves) => {
    const adj = adjacencyOf(leaves);
    const entrances = zone.entranceOf(leaves, adj);
    const dres = assignDoors(leaves, adj, { ...ctx, entrances });
    const sc = scoreOf(leaves, adj, dres, ctx);
    if (!entrances.length) sc.score += 5000;
    return { leaves, adj, doors: dres.doors, entrances, score: sc.score, why: sc.why };
  };
  Object.assign(best, evalLeaves(best.leaves));
  swapRooms(best, evalLeaves, ctx);
  splitPockets(best, ctx, evalLeaves);
  // corridors that lead to no room (only to another piece of corridor, or nowhere) or end blind after one door:
  // their floor goes to a neighbour
  const tried = new Set();
  for (let pass = 0; pass < 3; pass++) {
    const info = best.leaves.map(leafInfo);
    const dead = best.leaves.findIndex((l, i) => {
      if (info[i].kind !== "corridor") return false;
      const ds = best.doors.filter((d) => d.i === i || d.j === i);
      return ds.length <= 1 || !ds.some((d) => info[d.i === i ? d.j : d.i].kind !== "corridor");
    });
    if (dead < 0 || tried.has(dead)) break;
    tried.add(dead);
    const leaves = best.leaves.map((l, i) => (i === dead ? { orphan: true, rects: l.rects } : { ...l })); // copies: mergeOrphans moves walls
    const cand = evalLeaves(mergeOrphans(leaves, ctx));
    if (cand.score < best.score) Object.assign(best, cand);
    else break;
  }
  const keyOf = (l) => shapeKey(l.rects, ctx.shellRect);
  const counted = (l) => l.item && !l.item.void && (!l.item.blob || l.item.oneRoom) && !NOT_COUNTED.has(l.item.kind) && l.rects.length === 1;
  for (let round = 0; round < 4; round++) {
    let changed = false;
    for (let i = 0; i < best.leaves.length; i++) {
      const l = best.leaves[i];
      if (!counted(l)) continue;
      const k = keyOf(l);
      const repeats = ctx.used?.has(k) || best.leaves.some((m, j) => j !== i && counted(m) && keyOf(m) === k);
      if (!repeats) continue;
      const r = l.rects[0];
      for (let j = 0; j < best.leaves.length && !changed; j++) {
        const m = best.leaves[j];
        // a neighbour room, or spare floor beside it (an orphan left unbuilt, its size no one's)
        if (j === i || m.fixed || m.corridor || m.rects.length !== 1 || m.item?.kind === "corridor") continue;
        const q = m.rects[0];
        const sideBySideX = r.y === q.y && r.d === q.d && (r.x + r.w === q.x || q.x + q.w === r.x);
        const sideBySideY = r.x === q.x && r.w === q.w && (r.y + r.d === q.y || q.y + q.d === r.y);
        if (!sideBySideX && !sideBySideY) continue;
        for (const step of [1, -1, 2, -2, 3, -3, 4, -4, 5, -5]) {
          const nr = { ...r };
          const nq = { ...q };
          if (sideBySideX) {
            if (r.x < q.x) { nr.w += step; nq.x += step; nq.w -= step; } else { nq.w += step; nr.x += step; nr.w -= step; } // prettier-ignore
          } else if (r.y < q.y) { nr.d += step; nq.y += step; nq.d -= step; } else { nq.d += step; nr.y += step; nr.d -= step; } // prettier-ignore
          if (nr.w < 4 || nr.d < 4 || nq.w < 4 || nq.d < 4) continue;
          const leaves = best.leaves.map((x, t) => (t === i ? { ...x, rects: [nr] } : t === j ? { ...x, rects: [nq] } : x));
          const cand = evalLeaves(leaves);
          if (cand.score < best.score - 1) {
            Object.assign(best, cand);
            changed = true;
            break;
          }
        }
      }
    }
    if (!changed) break;
  }
}

/**
 * Pockets: a room larger than its cap (the rulebook's maxArea, or SOFT_GIVE times a service room's use), most often
 * alone in a piece of floor the fixed rectangles cut (a stair, a connector's column, a hall from below), takes a part
 * under its cap behind a straight wall across the piece, at either end and a few depths (a footprint the city has
 * passed over), and the rest is spare floor: the neighbours take it where their caps leave them room (mergeOrphans: a
 * room, a corridor as a bay no narrower than itself), else it stays unbuilt (plans.mjs: a terrace where nothing
 * stands above and an edge is open, else a closed void). Each cut is scored with its doors assigned again; the best
 * that scores better is kept, room by room.
 */
function splitPockets(best, ctx, evalLeaves) {
  const capOf = (it) => (!it || it.void || it.blob ? null : it.hardCapG ?? (it.maxAreaG && it.hardCapG === null ? it.maxAreaG * SOFT_GIVE : null)); // prettier-ignore
  const areaOf = (l) => l.rects.reduce((s, r) => s + rectArea(r), 0);
  const done = new Set();
  for (let guard = 0; guard < 24; guard++) {
    const i = best.leaves.findIndex((l) => !l.fixed && capOf(l.item) && areaOf(l) > capOf(l.item) && !done.has(l.item.id));
    if (i < 0) return;
    const l = best.leaves[i];
    const it = l.item;
    done.add(it.id);
    const cap = capOf(it);
    const others = new Set(best.leaves.filter((m, j) => j !== i && m.item && !m.item.void).map((m) => shapeKey(m.rects, ctx.shellRect)));
    const taken = (rects) => ctx.used?.has(shapeKey(rects, ctx.shellRect)) || others.has(shapeKey(rects, ctx.shellRect));
    const cands = [];
    // an L's arm left spare whole
    if (l.rects.length > 1) l.rects.forEach((r, q) => cands.push({ rects: l.rects.filter((_, t) => t !== q), rest: r }));
    // a rectangle of it (an L's main one, or the room) cut across: the room keeps a part, the rest is spare
    l.rects.forEach((R, q) => {
      const keepOthers = areaOf(l) - rectArea(R);
      const room = cap - keepOthers;
      for (const vertical of [true, false]) {
        const L = vertical ? R.w : R.d;
        const cross = vertical ? R.d : R.w;
        const ok = (k) => k >= (it.minSideG ?? 0) + 1 && L - k >= SPARE_MIN && k * cross <= room;
        const ks = [];
        for (const share of [0.93, 0.83]) {
          let k = Math.floor((room * share) / cross);
          const at = (kk) => l.rects.map((x, t) => (t !== q ? x : vertical ? { ...R, w: kk } : { ...R, d: kk }));
          for (let t = 0; t < 4 && ok(k) && taken(at(k)); t++) k--;
          if (ok(k) && !ks.includes(k)) ks.push(k);
        }
        for (const k of ks)
          for (const low of [true, false]) {
            const part = vertical ? { x: low ? R.x : R.x + R.w - k, y: R.y, w: k, d: R.d } : { x: R.x, y: low ? R.y : R.y + R.d - k, w: R.w, d: k }; // prettier-ignore
            const rest = vertical ? { x: low ? R.x + k : R.x, y: R.y, w: R.w - k, d: R.d } : { x: R.x, y: low ? R.y + k : R.y, w: R.w, d: R.d - k }; // prettier-ignore
            cands.push({ rects: l.rects.map((x, t) => (t === q ? part : x)), rest });
          }
      }
    });
    // a cut is taken only where it leaves no other fault the gate fails (a room cut off, a window lost, a door
    // the rulebook asks for gone): a room past its cap is one fault, never traded for another
    const faults = (why) => why.filter((w) => !/past its cap|past its use|^orphan/.test(w)).length;
    const before = faults(best.why);
    let pick = null;
    for (const c of cands) {
      const leaves = best.leaves.map((x, j) => (j === i ? { ...x, rects: c.rects } : { ...x })); // copies: mergeOrphans moves walls
      leaves.push({ orphan: true, spare: true, rects: [c.rest] });
      const cand = evalLeaves(mergeOrphans(leaves, ctx));
      if (faults(cand.why) > before) continue;
      if (!pick || cand.score < pick.score) pick = cand;
    }
    if (pick && pick.score < best.score) Object.assign(best, pick);
  }
}

/**
 * Rooms swapped between two places of the plan where a room named in a fault (off its hallway's end or its lift,
 * cut off, not beside the room it needs, past its cap, too narrow) fits the other's place better: the walls stay,
 * the doors are assigned again, a swap kept when the zone scores better.
 */
function swapRooms(best, evalLeaves, ctx) {
  const movable = (l) => l.item && !l.item.void && !l.item.blob && !l.item.hidden && !l.fixed;
  // spare floor a room may move into: a bay or a piece left unbuilt; the room's old place is spare floor then
  const spare = (l) => (l.bay || l.orphan) && l.rects.length === 1;
  const faults = (why) => why.filter((w) => !/^orphan/.test(w)).length;
  for (let round = 0; round < 3; round++) {
    const named = new Set();
    for (const w of best.why) for (const l of best.leaves) if (movable(l) && w.startsWith(`${l.item.id} `)) named.add(l.item.id);
    if (!named.size) return;
    let changed = false;
    for (let i = 0; i < best.leaves.length && !changed; i++) {
      const a = best.leaves[i];
      if (!movable(a) || !named.has(a.item.id)) continue;
      let pick = null;
      for (let j = 0; j < best.leaves.length; j++) {
        const b = best.leaves[j];
        let leaves;
        if (j !== i && movable(b) && (b.item.unit ?? null) === (a.item.unit ?? null)) leaves = best.leaves.map((x, t) => (t === i ? { ...x, item: b.item } : t === j ? { ...x, item: a.item } : x)); // prettier-ignore
        else if (j !== i && spare(b) && a.rects.length === 1) {
          leaves = best.leaves.map((x, t) => (t === i ? { orphan: true, spare: true, rects: a.rects } : t === j ? { item: a.item, rects: b.rects } : { ...x })); // prettier-ignore
          leaves = mergeOrphans(leaves, ctx);
        } else continue;
        const cand = evalLeaves(leaves);
        // fewer faults, or as many and a better score: a fault is never traded for another
        const f = faults(cand.why);
        const ref = pick ?? { f: faults(best.why), score: best.score - 1 };
        if (f < ref.f || (f === ref.f && cand.score < ref.score)) pick = { ...cand, f };
      }
      if (pick) {
        delete pick.f;
        Object.assign(best, pick);
        changed = true;
      }
    }
    if (!changed) return;
  }
}

/** The item order with a few swaps: kept groups (same `group`) stay together, the hub may move along. */
function perturb(items, rng) {
  const out = [...items];
  const swaps = rng.int(Math.max(1, Math.ceil(out.length / 2)));
  for (let s = 0; s < swaps; s++) {
    const i = rng.int(out.length);
    const j = Math.min(out.length - 1, Math.max(0, i + (rng.chance(0.5) ? 1 : -1) * (1 + rng.int(2))));
    if (i === j) continue;
    if (out[i].pin || out[j].pin) continue;
    [out[i], out[j]] = [out[j], out[i]];
  }
  // groups back together, in the order their first member now has
  const firstAt = new Map();
  out.forEach((it, k) => {
    const g = it.group ?? it.id;
    if (!firstAt.has(g)) firstAt.set(g, k);
  });
  return out
    .map((it, k) => ({ it, k, g: firstAt.get(it.group ?? it.id) }))
    .sort((a, b) => a.g - b.g || a.k - b.k)
    .map((x) => x.it);
}
