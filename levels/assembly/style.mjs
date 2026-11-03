// A building's style (`smak-style/1`, levels/assembly/styles/<name>.json): the few rules a kind of building keeps
// beyond the contract, each with its source. A description names it (`"style": "house"`); the layout then grows
// with these rules in its cost and is checked by them (checkStyle), and `"doors": "auto"` takes its doors from the
// style (doorsFor). Sizes come from levels/rules/architecture.json, the kind each style kind is measured as, its
// metres turned into cells of 64 by the GoldSrc hull: least sizes rounded up, greatest down.
//
// The checks measure the layout as cells; each ends in a sentence naming the room, what it measured and what the
// rule wants, with the rule's source.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ARCHITECTURE = join(HERE, "../rules/architecture.json");
export const STYLE_FORMAT = "smak-style/1";
/** Hammer units to the metre's 0.0254 (architecture.json, hull.engines.goldsrc.unitM); a cell is 64 of them. */
const CELL_M = 64 * 0.0254;
/** The least width of any room a door opens into: the leaf swings 2 cells deep (README, "Units and the grid"). */
const SWING_CELLS = 2;

const cite = (rule) => (rule.source ?? []).join(", ");

/** Reads styles/<name>.json and fills each kind's sizes in cells from architecture.json. Throws on a name it has not. */
export function loadStyle(name) {
  const file = join(HERE, "styles", `${name}.json`);
  if (!existsSync(file)) throw new Error(`style ${name}: there is no levels/assembly/styles/${name}.json`);
  const style = JSON.parse(readFileSync(file, "utf8"));
  const arch = JSON.parse(readFileSync(ARCHITECTURE, "utf8"));
  for (const [kind, k] of Object.entries(style.kinds)) {
    const a = arch.roomKinds[k.as];
    if (!a) throw new Error(`style ${name}: kind ${kind} is measured as ${k.as}, which architecture.json has no room kind of`); // prettier-ignore
    k.minArea = Math.ceil(a.minArea / CELL_M ** 2 - 1e-9);
    k.maxArea = a.maxArea ? Math.floor(a.maxArea / CELL_M ** 2 + 1e-9) : Infinity;
    k.minSide = Math.max(SWING_CELLS, Math.ceil(a.minSide / CELL_M - 1e-9));
    k.metres = { minArea: a.minArea, maxArea: a.maxArea ?? null, minSide: a.minSide };
  }
  return style;
}

/** The style a description names, or null. */
export const styleOf = (d) => (typeof d?.style === "string" ? loadStyle(d.style) : null);

/**
 * The doors of a description that says `"doors": "auto"`: every room of a storey opens off that storey's room of
 * zone circulation (the first; none, the entrance room), then the style's pairs (kitchen and living) where both are
 * on one storey. Returns a list of [room, room].
 */
export function doorsFor(d, style) {
  const zone = (r) => style.kinds[r.kind]?.zone;
  const out = [];
  const has = (a, b) => out.some(([p, q]) => (p === a && q === b) || (p === b && q === a));
  const storeys = [...new Set(d.rooms.map((r) => r.storey))].sort((a, b) => a - b);
  for (const s of storeys) {
    const rooms = d.rooms.filter((r) => r.storey === s);
    const hub = rooms.find((r) => zone(r) === "circulation") ?? rooms.find((r) => r.entrance) ?? rooms[0];
    for (const r of rooms) if (r !== hub) out.push([hub.id, r.id]);
    for (const [ka, kb] of style.rules.doors?.pairs ?? []) {
      const a = rooms.find((r) => r.kind === ka);
      const b = rooms.find((r) => r.kind === kb);
      if (a && b && !has(a.id, b.id)) out.push([a.id, b.id]);
    }
  }
  return out;
}

/** Checks the description's rooms against the style before a layout: every kind known, every area band reachable. */
export function checkStyleBuilding(d, style) {
  const failures = [];
  const warnings = [];
  for (const r of d.rooms ?? []) {
    const k = style.kinds[r.kind];
    if (!k) {
      failures.push(`room ${r.id}: its kind ${r.kind} is not one of style ${style.style}'s (${Object.keys(style.kinds).join(", ")})`); // prettier-ignore
      continue;
    }
    const [least, most] = r.area ?? [];
    if (most < k.minArea || least > k.maxArea)
      failures.push(`room ${r.id}: wants ${least}-${most} cells; a ${r.kind} of style ${style.style} is ${band(k)} cells (${k.as}, ${bandM(k)}; ${cite(style.rules.area)})`); // prettier-ignore
  }
  return { failures, warnings };
}

/** The largest rectangle of a room's cells: [x0, y0, x1, y1], its cells and its sides (short first). */
export function largestRectangle(cells, id) {
  const h = cells.length;
  const w = cells[0].length;
  let best = null;
  for (let y0 = 0; y0 < h; y0++)
    for (let x0 = 0; x0 < w; x0++) {
      if (cells[y0][x0] !== id) continue;
      let xMax = w - 1;
      for (let y1 = y0; y1 < h && cells[y1][x0] === id; y1++) {
        let x = x0;
        while (x + 1 <= xMax && cells[y1][x + 1] === id) x++;
        xMax = x;
        const a = xMax - x0 + 1;
        const b = y1 - y0 + 1;
        const n = a * b;
        if (!best || n > best.n || (n === best.n && Math.min(a, b) > best.sides[0])) best = { box: [x0, y0, xMax, y1], n, sides: [Math.min(a, b), Math.max(a, b)] }; // prettier-ignore
      }
    }
  return best;
}

/** A kind's area band in cells, and in square metres, as a sentence says them. */
const band = (k) => (k.maxArea === Infinity ? `${k.minArea} or more` : `${k.minArea}-${k.maxArea}`);
const bandM = (k) => (k.metres.maxArea === null ? `${k.metres.minArea} m2 or more` : `${k.metres.minArea}-${k.metres.maxArea} m2`);

/** What each rule costs the layout's search, by how far it is off: shared by checkStyle and storeyCost. */
const WEIGHT = {
  area: (off) => 300 + off * 60,
  minSide: (short) => 400 * short,
  compact: (gap) => Math.round(gap * 600),
  window: 500,
  lightTwoSides: 120,
  gradient: 2000,
  entranceRoom: 2000,
  entranceFront: 800,
  kitchenDepth: (gap) => Math.round(150 + gap * 60),
};

/**
 * What a storey's cells cost by the style's rules of shape (minSide, compact) and of depth from the front (the
 * kitchen behind the living room), for the polish of one storey (layout.mjs, polishStorey). `kinds`: room id to kind.
 */
export function storeyCost(cells, kinds, style, front) {
  const R = style.rules;
  let cost = 0;
  const [w, h] = [cells[0].length, cells.length];
  const depth = new Map();
  for (const [id, kind] of kinds) {
    const k = style.kinds[kind];
    if (!k) continue;
    let n = 0;
    let deep = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (cells[y][x] === id) n++, (deep += front ? depthOf([x, y], front, w, h) : 0);
    if (!n) continue;
    depth.set(id, deep / n);
    const rect = largestRectangle(cells, id);
    if (R.minSide && rect.sides[0] < k.minSide) cost += WEIGHT.minSide(k.minSide - rect.sides[0]);
    if (R.compact && k.zone !== "circulation" && rect.n / n < R.compact.value) cost += WEIGHT.compact(R.compact.value - rect.n / n);
  }
  if (R.front && front)
    for (const [kid, kk] of kinds)
      for (const [lid, lk] of kinds)
        if (kk === "kitchen" && lk === "living" && depth.has(kid) && depth.has(lid) && depth.get(kid) < depth.get(lid))
          cost += WEIGHT.kitchenDepth(depth.get(lid) - depth.get(kid));
  return cost;
}

/** The building wall an outside edge stands on: south (y 0), north (y h), west (x 0), east (x w). */
const sideOf = (e, w, h) =>
  e.from[1] === e.to[1] ? (e.from[1] === 0 ? "south" : e.from[1] === h ? "north" : null) : e.from[0] === 0 ? "west" : e.from[0] === w ? "east" : null; // prettier-ignore
/** How deep a cell's middle stands from the front wall, in cells. */
const depthOf = ([x, y], front, w, h) => ({ south: y + 0.5, north: h - y - 0.5, west: x + 0.5, east: w - x - 0.5 })[front]; // prettier-ignore

/**
 * Measures a layout against its style. Returns { failures, warnings, cost, rooms }: the sentences of the rules
 * at level fail and warn, the cost the layout's search adds for them (lower is better), and each room's measures
 * (cells, its largest rectangle, the share it holds, its window sides, its depth from the front).
 */
export function checkStyle(layout, d, style) {
  const failures = [];
  const warnings = [];
  let cost = 0;
  const R = style.rules;
  const say = (rule, s, weight) => {
    (rule.level === "fail" ? failures : warnings).push(`${s} (${cite(rule)})`);
    cost += weight;
  };
  const [w, h] = layout.size;
  const kindOf = new Map(d.rooms.map((r) => [r.id, r.kind]));
  const measures = {};

  for (const r of layout.rooms) {
    const p = layout.storeyPlans[r.storey];
    const k = style.kinds[r.kind];
    if (!p || !k) continue;
    const mine = [];
    p.cells.forEach((row, y) => row.forEach((v, x) => v === r.id && mine.push([x, y])));
    if (!mine.length) continue;
    const rect = largestRectangle(p.cells, r.id);
    const sides = new Set(p.edges.filter((e) => e.kind === "window" && e.rooms.includes(r.id)).map((e) => sideOf(e, w, h)));
    const m = (measures[r.id] = { kind: r.kind, cells: mine.length, rectangle: rect.sides, share: +(rect.n / mine.length).toFixed(2), windows: [...sides].sort() }); // prettier-ignore
    const name = `room ${r.id} (storey ${r.storey}, ${r.kind})`;

    if (R.area && (m.cells < k.minArea || m.cells > k.maxArea)) {
      const off = m.cells < k.minArea ? k.minArea - m.cells : m.cells - k.maxArea;
      say(R.area, `${name}: ${m.cells} cells; a ${r.kind} is ${band(k)} (${k.as}, ${bandM(k)})`, WEIGHT.area(off)); // prettier-ignore
    }
    if (R.minSide && rect.sides[0] < k.minSide)
      say(R.minSide, `${name}: its largest rectangle is ${rect.sides[0]} x ${rect.sides[1]} cells; a ${r.kind} wants ${k.minSide} across at least (${k.as} ${k.metres.minSide} m)`, WEIGHT.minSide(k.minSide - rect.sides[0])); // prettier-ignore
    if (R.compact && k.zone !== "circulation" && m.share < R.compact.value)
      say(R.compact, `${name}: its largest rectangle (${rect.sides[0]} x ${rect.sides[1]}) holds ${rect.n} of its ${m.cells} cells (${m.share}); a room wants ${R.compact.value} at least in one rectangle`, WEIGHT.compact(R.compact.value - rect.n / m.cells)); // prettier-ignore
    if (R.window?.kinds.includes(r.kind) && !sides.size)
      say(R.window, `${name}: it has no window; a ${r.kind} wants one on an outside wall`, WEIGHT.window);
    if (R.lightTwoSides?.kinds.includes(r.kind) && sides.size === 1)
      say(R.lightTwoSides, `${name}: its windows are all on the ${[...sides][0]} wall; a ${r.kind} wants light from two sides`, WEIGHT.lightTwoSides); // prettier-ignore
  }

  // the gradient: every room reached from the entrance with no private room or end crossed, but the pairs allowed
  const start = layout.entrance?.room;
  if (R.gradient && start) {
    const links = new Map(layout.rooms.map((r) => [r.id, new Set()]));
    for (const door of layout.doors) links.get(door.rooms[0])?.add(door.rooms[1]), links.get(door.rooms[1])?.add(door.rooms[0]); // prettier-ignore
    const well = layout.stairwell;
    if (well?.rooms) links.get(well.rooms[0])?.add(well.rooms[1]), links.get(well.rooms[1])?.add(well.rooms[0]);
    const closed = (id) => {
      const k = style.kinds[kindOf.get(id)];
      return !!k && (k.zone === "private" || !!k.end);
    };
    const allowed = (from, to) => R.gradient.throughAllowed.some(([a, b]) => a === kindOf.get(from) && b === kindOf.get(to));
    const seen = new Map([[start, null]]);
    const queue = [start];
    while (queue.length) {
      const id = queue.shift();
      for (const n of links.get(id) ?? []) {
        if (seen.has(n) || (closed(id) && !allowed(id, n))) continue;
        seen.set(n, id), queue.push(n);
      }
    }
    for (const r of layout.rooms) {
      if (seen.has(r.id)) continue;
      const via = [...(links.get(r.id) ?? [])].filter((n) => seen.has(n));
      if (via.length) say(R.gradient, `room ${r.id} (storey ${r.storey}, ${r.kind}) is reached only through ${via.map((n) => `${n} (${kindOf.get(n)})`).join(" or ")}; a room is not reached through a private room or an end`, WEIGHT.gradient); // prettier-ignore
    }
  }

  // the entrance's room, and the front
  if (start && R.entranceRoom && !R.entranceRoom.kinds.includes(kindOf.get(start)))
    say(R.entranceRoom, `the entrance opens into ${start} (${kindOf.get(start)}); it wants one of ${R.entranceRoom.kinds.join(", ")}`, WEIGHT.entranceRoom); // prettier-ignore
  const entranceSide = layout.entrance ? sideOf(layout.entrance.edges[0], w, h) : null;
  const front = d.front ?? entranceSide;
  if (R.front && front) {
    if (entranceSide && entranceSide !== front)
      say(R.front, `the entrance stands on the ${entranceSide} wall; the front is ${front}`, WEIGHT.entranceFront);
    const meanDepth = (id, s) => {
      const p = layout.storeyPlans[s];
      const mine = [];
      p.cells.forEach((row, y) => row.forEach((v, x) => v === id && mine.push([x, y])));
      return mine.reduce((n, c) => n + depthOf(c, front, w, h), 0) / mine.length;
    };
    for (const kitchen of layout.rooms.filter((r) => r.kind === "kitchen"))
      for (const living of layout.rooms.filter((r) => r.kind === "living" && r.storey === kitchen.storey)) {
        const [dk, dl] = [meanDepth(kitchen.id, kitchen.storey), meanDepth(living.id, living.storey)];
        if (measures[kitchen.id]) measures[kitchen.id].depth = +dk.toFixed(2);
        if (measures[living.id]) measures[living.id].depth = +dl.toFixed(2);
        if (dk < dl)
          say(R.front, `${kitchen.id} stands ${dk.toFixed(1)} cells from the ${front} front on average, ${living.id} ${dl.toFixed(1)}; the kitchen wants to stand deeper than the living room`, WEIGHT.kitchenDepth(dl - dk)); // prettier-ignore
      }
  }
  return { failures, warnings, cost, rooms: measures, front };
}

