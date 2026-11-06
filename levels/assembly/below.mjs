// levels/assembly: the level below the streets (`below` in a smak-site/1: a spec with a `below`;
// README, "Below the streets"). Its parts (tunnels, a hall, rooms) are rectangles of the site's cells at a depth under
// the street; the ways down (a stair in a public place, ladders from a street's manhole or drain, a den's trapdoor) are
// cells of them opened up to the floor over them. Every cell of it is a column of air from a floor to a ceiling; the
// pieces close it: a floor slab under each cell, a vault over each (none over a shaft), and a wall on every edge where
// the air on its two sides differs (the ground beside a tunnel, a kerb over a channel, the step from a tunnel's vault
// up to a hall's, a shaft's walls over the vault). Nothing is filled round it: what the walls close is the map, and
// what is outside them is outside the map, as the void beyond the sky is (VHLT takes away every face that looks out).
//
//   readBelow(site)                   -> failures: the description's sentences
//   planBelow(site, cells, layouts)   -> { floor, cells: Map "x,y" -> cell, parts, ways, doors, joins, failures, warnings }
//   checkBelow(plan, style?)          -> { failures, warnings, measures }: the level's rules (ways down, every part
//                                        reached, no endless corridor, its looks), as checkSite holds the street's
//   assembleBelow(plan, library, put, options) -> { report }: the pieces put through the site's `put`
//
// Cells of 64, y north; z of the world (the street's top is 0).
import { box, pointEntity, planeOf } from "../../src/maps/source.mjs";
import { pieceFor, placed } from "./library.mjs";
import { edgeFrame, swapped, apartEntities } from "./assemble.mjs";

const GRID = 64;
const STOREY = 192;

/**
 * A secret door in the wall two parts share, each of its faces in the wall's texture of the part it looks into
 * (`doorSwap(d, part)`): the leaf hides from both sides, not only from the side it is found from. A face that looks
 * along the wall (the leaf's edges) takes the far part's.
 */
function facing(got, d, doorSwap) {
  if (!doorSwap) return got;
  const axis = d.line === "v" ? 0 : 1;
  // the part on the line's north or east side (1) and on its south or west side (0)
  const swing = d.swing;
  const other = d.between.find((p) => p !== swing);
  const partOn = (sign) => ((sign > 0) === (d.side === 1) ? swing : other);
  const tables = { [swing]: doorSwap(d, swing) ?? {}, [other]: doorSwap(d, other) ?? {} };
  const faces = (b) => ({
    ...b,
    faces: b.faces.map((f) => {
      const n = planeOf(f.points)?.normal ?? [0, 0, 0];
      const part = Math.abs(n[axis]) > 0.5 ? partOn(n[axis]) : other;
      const to = tables[part][f.texture];
      return to ? { ...f, texture: to } : f;
    }),
  });
  return { ...got, brushes: got.brushes.map(faces), entities: got.entities.map((e) => (e.brushes ? { ...e, brushes: e.brushes.map(faces) } : e)) }; // prettier-ignore
}
/** The kinds of a part, and of a way down. */
export const PART_KINDS = ["tunnel", "hall", "room"];
export const WAY_KINDS = ["stair", "manhole", "drain", "trapdoor"];
/** A part's clear height over its walkway: a tunnel's vault (the sewer-vault piece's underside), the cistern's (its plinth and the portico's column), a room's (a storey's). */
export const VAULT = { tunnel: 208, hall: 288, room: 176 };
/** The channel's bed under the walkway (the sewer-channel piece). */
const BED = -32;
/** A slab's thickness: the floor's under a cell, the vault's over it. */
const SLAB = 16;
/** The ground the street stands on that the sewer leaves whole: the paving's slab (-16..0) and the sky's floor under it (-32..-16). */
const GROUND = -32;
/** The ways down a level wants (the person's "3 to 5"), the longest straight run of a tunnel (notes-h9.md section 5: "sprawling hallways that go on forever"), the looks it wants at least. */
export const BELOW_RULES = { ways: [3, 5], longest: 24, looks: 2, source: "the person, 2026-11-04: a first level below, 3 to 5 ways down, not one endless corridor; levels/notes-h9.md section 5" }; // prettier-ignore
/** The parapet round a stair's opening in the street, over the street's top (in place of a railing: 3 brushes, not 90). */
const PARAPET = 40;
/** Where each way's ladder stands, by the wall it is on. */
const SIDES = { north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0] };

const isInt = (v) => Number.isInteger(v);
const pair = (v) => Array.isArray(v) && v.length === 2 && v.every(isInt);
const key = (x, y) => `${x},${y}`;
const unkey = (k) => k.split(",").map(Number);
/** An edge's key: "h x y" for the edge along x from (x, y) to (x + 1, y); "v x y" for the one along y from (x, y). */
const edgeKey = (dir, x, y) => `${dir} ${x} ${y}`;
/** The edge between two cells side by side. */
const edgeBetween = ([ax, ay], [bx, by]) => (ax === bx ? edgeKey("h", ax, Math.max(ay, by)) : edgeKey("v", Math.max(ax, bx), ay));

/** A stair way's two wells (turn 0, the foot south): the upper (from the street to half way) and the lower, east of it, each 2 x 4 cells. */
const wellsOf = (w) => ({ upper: [w.at[0], w.at[1]], lower: [w.at[0] + 2, w.at[1]] });

/** Reads a site's `below`, in sentences. Never throws. */
export function readBelow(site) {
  const failures = [];
  const b = site.below;
  if (b === undefined) return failures;
  const fail = (s) => failures.push(`below: ${s}`);
  if (!b || typeof b !== "object") return [`below: it wants { floor, parts, ways }`];
  if (!isInt(b.floor) || b.floor % 16) fail(`its floor is ${JSON.stringify(b.floor)}; it wants the walkway's top, a whole z under the street in 16s`);
  const ids = new Set();
  for (const [k, p] of (b.parts ?? []).entries()) {
    const name = p.name ?? p.id ?? `part ${k + 1}`;
    if (!p.id) fail(`${name} has no id`);
    if (ids.has(p.id)) fail(`the part ${p.id} is named twice`);
    ids.add(p.id);
    if (!PART_KINDS.includes(p.kind)) fail(`${name}: its kind is ${JSON.stringify(p.kind)}; it wants one of ${PART_KINDS.join(", ")}`);
    if (!pair(p.from) || !pair(p.to) || p.to[0] <= p.from[0] || p.to[1] <= p.from[1]) {
      fail(`${name}: it wants from [x, y] and to [x, y], to past from`);
      continue;
    }
    if (pair(site.size) && (p.from[0] < 0 || p.from[1] < 0 || p.to[0] > site.size[0] || p.to[1] > site.size[1])) fail(`${name} reaches outside the site's ${site.size.join(" x ")}`); // prettier-ignore
    const across = Math.min(p.to[0] - p.from[0], p.to[1] - p.from[1]);
    if (p.channel && (across !== 3)) fail(`${name}: a tunnel with a channel is 3 cells across (a walkway, the channel, a walkway), not ${across}`);
    if (p.basin && (!pair(p.basin.from) || !pair(p.basin.to) || p.basin.from[0] <= p.from[0] || p.basin.from[1] <= p.from[1] || p.basin.to[0] >= p.to[0] || p.basin.to[1] >= p.to[1])) fail(`${name}: its basin wants from and to inside the hall, a walkway of a cell at least round it`); // prettier-ignore
    if (isInt(b.floor) && b.floor + (VAULT[p.kind] ?? 0) + SLAB > GROUND) fail(`${name}: its vault's top at ${b.floor + VAULT[p.kind] + SLAB} is over ${GROUND}, the ground the street stands on; a floor at ${GROUND - SLAB - VAULT[p.kind]} at the highest`); // prettier-ignore
  }
  if (!(b.parts ?? []).length) fail("it has no parts");
  for (const [k, w] of (b.ways ?? []).entries()) {
    const name = w.name ?? `way ${k + 1}`;
    if (!WAY_KINDS.includes(w.kind)) fail(`${name}: its kind is ${JSON.stringify(w.kind)}; it wants one of ${WAY_KINDS.join(", ")}`);
    if (!pair(w.at)) fail(`${name}: it wants at [x, y], a cell`);
    if (w.kind === "stair") {
      if ((w.foot ?? "south") !== "south") fail(`${name}: only a foot to the south is made (the wells run north of it, the lower east of the upper)`);
      if (b.floor !== -2 * STOREY) fail(`${name}: a stair is two stair-u, ${2 * STOREY} down: it wants the floor at ${-2 * STOREY}, not ${b.floor}`);
    } else if (!SIDES[w.wall]) fail(`${name}: its ladder's wall is ${JSON.stringify(w.wall)}; it wants north, south, east or west`);
    if (w.kind === "trapdoor" && (!w.building || !w.room)) fail(`${name}: a trapdoor names its building and its room`);
  }
  for (const [k, d] of (b.doors ?? []).entries()) {
    const name = d.name ?? `door ${k + 1}`;
    if (!Array.isArray(d.between) || d.between.length !== 2 || !d.between.every((id) => ids.has(id))) fail(`${name}: it wants between [part, part], two of the parts`); // prettier-ignore
    if (!pair(d.at)) fail(`${name}: it wants at [x, y], the vertex at its middle`);
    if (!d.between?.includes(d.swing)) fail(`${name}: its swing is ${JSON.stringify(d.swing)}; it wants one of the parts it joins`);
  }
  return failures;
}

/**
 * The level planned: each cell's part, kind (walk, channel, basin, well) and air (`[[floor, top]]`, z of the world; a
 * top of 0 is open to the floor over it), the ways with their cells, the edges where two parts meet that are open
 * (`joins`), and the failures of what was asked (a way off its part, a door on no shared wall).
 */
export function planBelow(site, cells, layouts = new Map()) {
  const failures = [];
  const warnings = [];
  const b = site.below;
  const F = b.floor;
  const out = { floor: F, cells: new Map(), parts: b.parts, ways: [], doors: [], joins: new Set(), props: b.props ?? [], sounds: b.sounds ?? [], bars: b.bars ?? [], failures, warnings }; // prettier-ignore
  const fail = (s) => failures.push(`below: ${s}`);
  const look = (p) => p.look ?? b.look ?? "sewer";
  for (const p of b.parts) {
    const vault = F + VAULT[p.kind];
    const long = p.to[0] - p.from[0] >= p.to[1] - p.from[1] ? 0 : 1;
    for (let y = p.from[1]; y < p.to[1]; y++)
      for (let x = p.from[0]; x < p.to[0]; x++) {
        const k = key(x, y);
        if (out.cells.has(k)) {
          fail(`${p.id} and ${out.cells.get(k).part} both take the cell ${k}`);
          continue;
        }
        let kind = "walk";
        if (p.channel) kind = (long === 0 ? y : x) === (long === 0 ? p.from[1] : p.from[0]) + 1 ? "channel" : "walk";
        if (p.basin && x >= p.basin.from[0] && x < p.basin.to[0] && y >= p.basin.from[1] && y < p.basin.to[1]) kind = "basin";
        const lo = kind === "walk" ? F : F + BED;
        out.cells.set(k, { part: p.id, partKind: p.kind, kind, look: look(p), air: [[lo, vault]], floor: kind === "walk" ? "sewer-walk" : "sewer-channel", vault }); // prettier-ignore
      }
  }
  // the doors between parts: two edges round their vertex on the line the parts share
  for (const d of b.doors ?? []) {
    const [px, py] = d.at;
    const ways = [
      { along: 1, edges: [[px, py - 1], [px, py]], sides: (t) => [[px - 1, t], [px, t]] }, // a vertical line x = px
      { along: 0, edges: [[px - 1, py], [px, py]], sides: (t) => [[t, py - 1], [t, py]] }, // a horizontal line y = py
    ];
    const fit = ways.find((w) => w.edges.every(([ex, ey]) => {
      const [a, c] = w.sides(w.along === 1 ? ey : ex).map(([cx, cy]) => out.cells.get(key(cx, cy))?.part);
      return a && c && a !== c && d.between.includes(a) && d.between.includes(c);
    })); // prettier-ignore
    if (!fit) {
      fail(`${d.name ?? "a door"} at ${d.at.join(",")}: its two edges are not on a wall ${d.between.join(" and ")} share`);
      continue;
    }
    const edges = fit.edges.map(([ex, ey]) => (fit.along === 1 ? edgeKey("v", ex, ey) : edgeKey("h", ex, ey)));
    for (const e of edges) out.joins.add(e);
    // the side of the line the leaf swings to: 1 (north or east) when the swing part is there
    const [, far] = fit.sides(fit.along === 1 ? py : px).map(([cx, cy]) => out.cells.get(key(cx, cy))?.part);
    out.doors.push({ ...d, line: fit.along === 1 ? "v" : "h", edges, side: far === d.swing ? 1 : 0, span: fit.along === 1 ? { from: [px, py - 1], to: [px, py + 1] } : { from: [px - 1, py], to: [px + 1, py] } }); // prettier-ignore
  }
  // the ways down
  for (const [n, w] of b.ways.entries()) {
    const name = w.name ?? `the ${w.kind} at ${w.at.join(",")}`;
    const way = { ...w, name, index: n, cells: [], opens: [] };
    if (w.kind === "stair") {
      const { upper, lower } = wellsOf(w);
      for (const [well, [x0, y0]] of [["upper", upper], ["lower", lower]])
        for (let j = 0; j < 4; j++)
          for (let i = 0; i < 2; i++) {
            const k = key(x0 + i, y0 + j);
            if (out.cells.has(k)) {
              fail(`${name}: its ${well} well and ${out.cells.get(k).part} both take the cell ${k}`);
              continue;
            }
            // the upper well from half way to the street (its landing the stair's own, at the street, over its first
            // row; open to the sky over the flights); the lower from the sewer's floor to under the street's ground,
            // the upper landing of its stair (half way) over its first row
            const air = well === "upper" ? [[F + STOREY, 0]] : j === 0 ? [[F, F + STOREY - SLAB], [F + STOREY, GROUND - SLAB]] : [[F, GROUND - SLAB]]; // prettier-ignore
            out.cells.set(k, { part: `${name}:${well}`, partKind: "well", kind: "well", well, row: j, way: n, parapet: well === "upper" && j > 0 ? PARAPET : 0, look: w.look ?? "stairs", air, floor: "sewer-walk", vault: well === "lower" ? GROUND - SLAB : null }); // prettier-ignore
            way.cells.push(k);
            if (well === "upper") way.opens.push(k);
          }
      // half way, from the upper's foot to the lower's upper landing; and the lower's foot to the sewer south of it
      for (let j = 0; j < 1; j++) out.joins.add(edgeBetween([upper[0] + 1, upper[1] + j], [lower[0], lower[1] + j]));
      const foot = [lower[0], lower[1] - 1];
      const under = out.cells.get(key(...foot));
      if (!under || under.kind !== "walk") fail(`${name}: the foot of its lower flight opens onto ${under ? `a ${under.kind}` : "no part"} at ${key(...foot)}; it wants a walkway of a tunnel`); // prettier-ignore
      else out.joins.add(edgeBetween(foot, lower));
      way.foot = foot;
    } else {
      const k = key(...w.at);
      const c = out.cells.get(k);
      if (!c) fail(`${name} stands over no part of the level at ${k}`);
      else if (c.kind !== "walk") fail(`${name} stands over a ${c.kind} at ${k}; its ladder wants a walkway at its foot`);
      else {
        c.air = [[c.air[0][0], 0]];
        c.shaft = n;
        way.cells.push(k);
        way.opens.push(k);
        // its ladder's wall: the ground or a room's wall, not open to another cell of the level
        const [dx, dy] = SIDES[w.wall];
        if (out.cells.has(key(w.at[0] + dx, w.at[1] + dy))) fail(`${name}: its ladder's wall (${w.wall}) has the level beyond it at ${key(w.at[0] + dx, w.at[1] + dy)}; a ladder wants a wall the whole way up`); // prettier-ignore
      }
      if (w.kind === "trapdoor") {
        const bd = site.buildings?.find((q) => q.id === w.building);
        const l = layouts.get(w.building);
        const room = bd && l?.storeyPlans?.[0]?.cells[w.at[1] - bd.at[1]]?.[w.at[0] - bd.at[0]];
        if (!bd) fail(`${name}: there is no building ${w.building}`);
        else if (l && room !== w.room) fail(`${name}: the cell ${k} of building ${w.building} is ${room ?? "outside it"}, not its ${w.room}`);
        way.local = bd ? [w.at[0] - bd.at[0], w.at[1] - bd.at[1]] : null;
      } else if (cells?.[w.at[1]]?.[w.at[0]] && !["street", "plaza", "square", "alley", "paving", "portico"].includes(cells[w.at[1]][w.at[0]])) fail(`${name} opens onto ${cells[w.at[1]][w.at[0]]} at ${k}; a street's manhole or drain opens onto public floor`); // prettier-ignore
    }
    out.ways.push(way);
  }
  // the parts that meet are open to each other (a tunnel into the hall, a branch off the main), and a part's cells
  // to each other; a room is entered by its doors and a stair's well by its foot and its landing (above)
  for (const [k, c] of out.cells) {
    const [x, y] = unkey(k);
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const n = out.cells.get(key(x + dx, y + dy));
      if (!n) continue;
      const free = (q) => q.partKind === "tunnel" || q.partKind === "hall";
      if (n.part === c.part || (free(c) && free(n))) out.joins.add(edgeBetween([x, y], [x + dx, y + dy]));
    }
  }
  return out;
}

/** The z ranges where exactly one of two lists of air has air, each with the side that has it. */
function differences(a, b) {
  const cuts = [...new Set([...a, ...b].flat())].sort((p, q) => p - q);
  const inside = (list, z) => list.some(([lo, hi]) => z > lo && z < hi);
  const out = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const m = (cuts[i] + cuts[i + 1]) / 2;
    const [x, y] = [inside(a, m), inside(b, m)];
    if (x === y) continue;
    const side = x ? 0 : 1;
    const last = out.at(-1);
    if (last && last.side === side && last.hi === cuts[i]) last.hi = cuts[i + 1];
    else out.push({ lo: cuts[i], hi: cuts[i + 1], side });
  }
  return out;
}

/**
 * The walls of the level: for every edge with a cell of it on one side at least, the z ranges a wall stands over:
 * where the air on its sides differs (an edge between cells that are open to each other), or all of either's air (an
 * edge with the ground beyond, or between parts that are not open to each other). Each range reaches into the slab
 * under the air it closes, and into the vault over it (not into a shaft's open top). `[{ dir, x, y, lo, hi, look, piece }]`.
 */
function wallsOf(below) {
  const walls = [];
  const seen = new Set();
  const air = (c) => c?.air ?? [];
  const reach = (c, lo, hi) => {
    // a range reaches into the slab under it, and the vault over it, where it is the cell's own floor and top
    const own = air(c);
    const a = own.some(([l]) => l === lo) ? lo - SLAB : lo;
    const z = own.some(([, h]) => h === hi && h !== 0) ? hi + SLAB : hi === 0 && c.parapet ? c.parapet : hi;
    return [a, z];
  };
  for (const [k] of below.cells) {
    const [x, y] = unkey(k);
    for (const [e, p, q] of [
      [edgeKey("h", x, y), [x, y - 1], [x, y]],
      [edgeKey("h", x, y + 1), [x, y], [x, y + 1]],
      [edgeKey("v", x, y), [x - 1, y], [x, y]],
      [edgeKey("v", x + 1, y), [x, y], [x + 1, y]],
    ]) {
      if (seen.has(e)) continue;
      seen.add(e);
      const [dir, ex, ey] = e.split(" ").map((v, i) => (i ? Number(v) : v));
      const cells = [below.cells.get(key(...p)), below.cells.get(key(...q))];
      const open = cells[0] && cells[1] && below.joins.has(e);
      const ranges = [];
      if (open) for (const r of differences(air(cells[0]), air(cells[1]))) ranges.push({ ...r, cell: cells[r.side] });
      else
        // between two parts not open to each other, each side its own half of the wall in its own look
        for (const [i, c] of cells.entries())
          if (c) for (const [lo, hi] of air(c)) ranges.push({ lo, hi, cell: c, half: cells[0] && cells[1] && cells[0].look !== cells[1].look ? i : null }); // prettier-ignore
      // the ranges of one side's air joined where they meet (a wall between two parts not open to each other)
      ranges.sort((r, s) => r.lo - s.lo);
      for (const r of ranges) {
        const [lo, hi] = reach(r.cell, r.lo, r.hi);
        const step = open && hi <= below.floor + 0.5 && r.cell.kind !== "walk"; // the walkway's edge over the channel
        walls.push({ dir, x: ex, y: ey, lo, hi, look: r.cell.look, piece: step ? "kerb" : "sewer", half: r.half ?? null });
      }
    }
  }
  return walls;
}

/** A brush whose faces at its least and greatest `axis` (0 x, 1 y, 2 z) are moved to `lo` and `hi`: a box's run set. */
function spanned(brush, axis, lo, hi) {
  const flat = (f) => f.points.every((p) => Math.abs(p[axis] - f.points[0][axis]) < 1e-6);
  const at = brush.faces.filter(flat).map((f) => f.points[0][axis]);
  const [min, max] = [Math.min(...at), Math.max(...at)];
  return {
    ...brush,
    faces: brush.faces.map((f) => {
      if (!flat(f)) return f;
      const to = Math.abs(f.points[0][axis] - min) < 1e-6 ? lo : Math.abs(f.points[0][axis] - max) < 1e-6 ? hi : null;
      return to === null ? f : { ...f, points: f.points.map((p) => p.map((v, i) => (i === axis ? to : v))) };
    }),
  };
}
const spannedAll = (got, axis, lo, hi) => ({ brushes: got.brushes.map((b) => spanned(b, axis, lo, hi)), entities: got.entities.map((e) => (e.brushes ? { ...e, brushes: e.brushes.map((b) => spanned(b, axis, lo, hi)) } : e)) }); // prettier-ignore
/** The cells of a set joined into rectangles [x, y, w, h], rows first (assemble.mjs's rectanglesOf, its keys "x,y"). */
function rectangles(set) {
  const left = new Set(set);
  const out = [];
  for (const k of [...set].map(unkey).sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([x, y]) => key(x, y))) {
    if (!left.has(k)) continue;
    const [i, j] = unkey(k);
    let w = 1;
    while (left.has(key(i + w, j))) w++;
    let h = 1;
    while ([...Array(w).keys()].every((d) => left.has(key(i + d, j + h)))) h++;
    for (let y = j; y < j + h; y++) for (let x = i; x < i + w; x++) left.delete(key(x, y));
    out.push([i, j, w, h]);
  }
  return out;
}

/** The level's rules: the ways down, every part reached from one, no tunnel run longer than the rule, its looks. */
export function checkBelow(plan, rules = BELOW_RULES, spawns = []) {
  const failures = [];
  const warnings = [];
  const below = plan.below;
  const measures = { ways: 0, kinds: {}, parts: 0, longest: 0, looks: [], cells: 0, reached: 0 };
  if (!below) return { failures, warnings, measures };
  const cite = ` (${rules.source})`;
  const ways = below.ways;
  measures.ways = ways.length;
  for (const w of ways) measures.kinds[w.kind] = (measures.kinds[w.kind] ?? 0) + 1;
  const [least, most] = rules.ways;
  if (ways.length < least || ways.length > most) failures.push(`the level below has ${ways.length} ${ways.length === 1 ? "way" : "ways"} down; it wants ${least} to ${most}${cite}`); // prettier-ignore
  if (!measures.kinds.stair) failures.push(`the level below has no stair down; it wants one in a public place, the way everyone finds${cite}`);
  if (!measures.kinds.manhole && !measures.kinds.drain) failures.push(`the level below has no ladder from a street; it wants a manhole or a drain${cite}`); // prettier-ignore
  const dens = plan.site.buildings.filter((b) => plan.layouts?.get(b.id)?.rooms?.some((r) => r.kind === "den"));
  for (const d of dens) if (!ways.some((w) => w.kind === "trapdoor" && w.building === d.id)) failures.push(`building ${d.id} has a den and no way from it down to the level below; a hideout wants its own way in${cite}`); // prettier-ignore
  // a way's opening where a player starts, or where a door's leaf swings
  const starts = new Set(spawns.map((s) => key(Math.floor(s.at[0]), Math.floor(s.at[1]))));
  for (const w of ways) for (const k of w.opens) if (starts.has(k)) failures.push(`${w.name} opens at ${k}, where a player starts${cite}`);
  // every part reached from a way, through the cells open to each other
  const opened = new Set(ways.flatMap((w) => w.cells));
  const seen = new Set(opened);
  const todo = [...opened];
  while (todo.length) {
    const [x, y] = unkey(todo.pop());
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = key(x + dx, y + dy);
      if (seen.has(n) || !below.cells.has(n)) continue;
      if (!below.joins.has(edgeBetween([x, y], [x + dx, y + dy]))) continue;
      seen.add(n);
      todo.push(n);
    }
  }
  measures.cells = below.cells.size;
  measures.reached = seen.size;
  for (const p of below.parts) {
    measures.parts++;
    let any = false;
    for (let y = p.from[1]; y < p.to[1] && !any; y++) for (let x = p.from[0]; x < p.to[0] && !any; x++) any = seen.has(key(x, y));
    if (!any) failures.push(`the part ${p.id} of the level below is reached from no way down${cite}`);
    if (p.kind === "tunnel") {
      const run = Math.max(p.to[0] - p.from[0], p.to[1] - p.from[1]);
      measures.longest = Math.max(measures.longest, run);
      if (run > rules.longest) failures.push(`the tunnel ${p.id} runs ${run} cells (${Math.round(run * GRID * 0.0254)} m) straight; a tunnel wants ${rules.longest} at the most, then a turn, a hall or an end${cite}`); // prettier-ignore
    }
  }
  measures.looks = [...new Set([...below.cells.values()].map((c) => c.look))].sort();
  if (measures.looks.length < rules.looks) failures.push(`the level below wears ${measures.looks.length} ${measures.looks.length === 1 ? "look" : "looks"} (${measures.looks.join(", ")}); it wants ${rules.looks} at least${cite}`); // prettier-ignore
  if (!below.parts.some((p) => p.kind === "hall")) warnings.push(`the level below has no hall; a junction or a cistern breaks the tunnels${cite}`);
  return { failures, warnings, measures };
}

/**
 * The level assembled from the library through the site's `put(piece, at, turn, swap, stretch)` (site.mjs: its pieces
 * into the world, or apart as the slot says) and `entities` (the list the site's entities go into). `swapOf(look)`: a
 * look's texture swaps (the theme's); `streetSwap(cell)`: the swaps of the district over a cell (a stair's own
 * pieces); `doorSwap(door)`: a door's (a secret one in its wall's texture); `name`: the site's.
 * The report: `{ ways, holes, floorHoles, keepClear, lamps, ladders, counts, failures }`.
 */
export function assembleBelow(plan, library, { put, entities, swapOf, streetSwap, doorSwap, name, open = false }) {
  const below = plan.below;
  const F = below.floor;
  const failures = [];
  const counts = {};
  const count = (k, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
  const need = (slot, which) => {
    const p = pieceFor(library, slot, which);
    if (!p) failures.push(`the library has no ${slot} piece for ${JSON.stringify(which)}; the level below needs one`);
    return p;
  };
  const world = (x, y, z) => [x * GRID, y * GRID, z];
  const pieces = {
    walk: need("floor", "sewer-walk"), channel: need("floor", "sewer-channel"), vault: need("ceiling", "sewer"),
    sewer: need("edge", "sewer"), kerb: need("edge", "kerb"), lamp: need("lamp", "sewer"), ladder: need("ladder", "rungs"),
    hatch: need("hatch", "manhole"), drain: need("hatch", "drain"), bars: need("edge", "bars"), pier: need("column", "pier"),
    stair: need("stair", "u-turn"), door: need("edge", "door"), // prettier-ignore
  };
  if (failures.length) return { report: { failures, counts } };
  const vaultAt = pieces.vault.bounds[0][2]; // the piece's underside over its walkway
  /** A piece placed and its brushes reshaped, through the site's put (its slot says world or apart). */
  const putShaped = (piece, at, turn, swap, shape) => {
    const got = swapped(placed(piece, { at, turn }), swap);
    let done = got;
    for (const [axis, lo, hi] of shape) done = spannedAll(done, axis, lo, hi);
    return done;
  };
  const keep = { brushes: [], ents: [] };

  // the floors and the vaults, joined into rectangles by piece, height and look
  const groups = new Map();
  const group = (piece, z, look, k) => {
    const g = `${piece.id}|${z}|${look}`;
    if (!groups.has(g)) groups.set(g, { piece, z, look, cells: new Set() });
    groups.get(g).cells.add(k);
  };
  for (const [k, c] of below.cells) {
    const lo = c.air[0][0];
    group(c.floor === "sewer-walk" ? pieces.walk : pieces.channel, c.floor === "sewer-walk" ? lo : lo - BED, c.look, k);
    const top = c.air.at(-1)[1];
    if (c.shaft === undefined && !(c.well === "upper") && top !== 0) group(pieces.vault, top - vaultAt, c.look, k);
  }
  for (const g of groups.values())
    for (const [x, y, w, h] of rectangles(g.cells)) {
      put(g.piece, world(x, y, g.z), 0, swapOf(g.look), [w, h]);
      count(g.piece.id);
    }

  // the walls, each straight run of edges with the same range and look one brush, 8 past each end (a corner closed)
  const runs = new Map();
  for (const w of wallsOf(below)) {
    const line = `${w.dir} ${w.dir === "h" ? w.y : w.x} ${w.lo} ${w.hi} ${w.look} ${w.piece} ${w.half}`;
    if (!runs.has(line)) runs.set(line, { ...w, at: [] });
    runs.get(line).at.push(w.dir === "h" ? w.x : w.y);
  }
  for (const r of runs.values()) {
    const ts = r.at.sort((a, b) => a - b);
    let start = ts[0];
    for (let i = 0; i < ts.length; i++) {
      if (i + 1 < ts.length && ts[i + 1] === ts[i] + 1) continue;
      const [t0, t1] = [start, ts[i] + 1];
      const edge = r.dir === "h" ? { from: [t0, r.y], to: [t0 + 1, r.y] } : { from: [r.x, t0], to: [r.x, t0 + 1] };
      const f = edgeFrame(edge, 1);
      const axis = r.dir === "h" ? 0 : 1;
      const across = (r.dir === "h" ? r.y : r.x) * GRID;
      const half = r.half === null ? [] : [[1 - axis, r.half ? across : across - 8, r.half ? across + 8 : across]];
      // a wall with air on one side (a half wall, or one against the ground) stops at the line where its side meets
      // another part's cell: 8 past it would stand in that part's own wall there, its face on that part's face in the
      // other look (the cellar's brick in the smugglers' way)
      const line = r.dir === "h" ? r.y : r.x;
      const has = (t, row) => below.cells.has(r.dir === "h" ? key(t, row) : key(row, t));
      const sides = [line - 1, line].filter((row) => has(t0, row));
      const row = r.half !== null ? line - (r.half ? 0 : 1) : sides.length === 1 ? sides[0] : null;
      const other = (t) => row !== null && has(t, row);
      const got = putShaped(pieces[r.piece], world(...f.at, F), f.turn, swapOf(r.look), [[axis, t0 * GRID - (other(t0 - 1) ? 0 : 8), t1 * GRID + (other(t1) ? 0 : 8)], [2, r.lo, r.hi], ...half]); // prettier-ignore
      keep.brushes.push(...got.brushes);
      count(`${pieces[r.piece].id}`);
      if (i + 1 < ts.length) start = ts[i + 1];
    }
  }

  // the doors between parts (a hideout's secret door into its cellar)
  const doors = [];
  for (const d of below.doors) {
    const f = edgeFrame(d.span, d.side, 2);
    const leaf = placed(pieces.door, { at: world(...f.at, F), turn: f.turn, open });
    const got = d.secret ? facing(leaf, d, doorSwap) : swapped(leaf, doorSwap?.(d) ?? null);
    const targetname = d.building ? `${name}_${d.building}_${d.name ?? "door"}` : `${name}_below_${d.name ?? "door"}`;
    for (const e of got.entities) if (/^func_door/.test(e.classname)) e.targetname = targetname;
    keep.brushes.push(...got.brushes);
    keep.ents.push(...got.entities);
    doors.push({ between: d.between, at: d.at, targetname, secret: !!d.secret });
    count("door-below");
  }

  // the ways down
  const holes = [];
  const floorHoles = [];
  const keepClear = new Set();
  const ladders = [];
  const rungs = [];
  const ways = [];
  for (const w of below.ways) {
    if (w.kind === "stair") {
      // the two stair-u, the upper from half way to the street, the lower from the sewer to half way, in the look of
      // the district over them; round the upper's flights at the street its walls stand on as a parapet (wallsOf)
      const { upper, lower } = wellsOf(w);
      const swap = streetSwap(upper);
      put(pieces.stair, world(...upper, F + STOREY), 0, swap);
      put(pieces.stair, world(...lower, F), 0, swap);
      count("stair-u", 2);
      const [x0, y0] = upper;
      for (const k of w.opens) holes.push(unkey(k));
      for (let j = -1; j <= 4; j++) for (let i = -1; i <= 2; i++) keepClear.add(key(x0 + i, y0 + j));
      ways.push({ kind: w.kind, name: w.name, at: w.at, top: [(x0 + 0.5) * GRID, (y0 + 0.5) * GRID, 0], foot: [(w.foot[0] + 0.5) * GRID, (w.foot[1] + 0.5) * GRID, F] }); // prettier-ignore
      continue;
    }
    const [x, y] = w.at;
    const cell = below.cells.get(key(x, y));
    if (!cell) continue;
    // the ladder on its wall, from the walkway to the floor over it (the func_ladder 16 over, to step off)
    const [dx, dy] = SIDES[w.wall];
    const edge = dx ? { from: [x + (dx > 0 ? 1 : 0), y], to: [x + (dx > 0 ? 1 : 0), y + 1] } : { from: [x, y + (dy > 0 ? 1 : 0)], to: [x + 1, y + (dy > 0 ? 1 : 0)] }; // prettier-ignore
    // the rungs face into the shaft: away from the wall's side
    const f = edgeFrame(edge, dx > 0 || dy > 0 ? 0 : 1);
    const got = swapped(placed(pieces.ladder, { at: world(...f.at, F), turn: f.turn }), swapOf(cell.look));
    keep.brushes.push(...got.brushes.map((b) => spanned(b, 2, F, 0)));
    for (const e of got.entities) {
      if (e.classname === "func_ladder") keep.ents.push({ ...e, brushes: e.brushes.map((b) => spanned(b, 2, F, SLAB)) });
      else rungs.push(...e.brushes.map((b) => spanned(b, 2, F, 0)));
    }
    ladders.push({ way: w.name, wall: w.wall, foot: F, top: 0 });
    count("ladder");
    // the lid over it: a grate slid by use on a street, a grate that breaks on a drain, a den's trapdoor in its floor
    if (!open) {
      const piece = w.kind === "drain" ? pieces.drain : pieces.hatch;
      let lid = placed(piece, { at: world(x, y, 0), turn: 0 });
      if (w.kind === "trapdoor") {
        lid = swapped(lid, { [piece.map.entities[0].brushes[0].faces.find((q) => q.texture.startsWith("{"))?.texture]: w.floorTexture ?? "grey_creteflr" }); // prettier-ignore
        for (const e of lid.entities) Object.assign(e, { targetname: `${name}_${w.building}_${w.door ?? "hideout"}`, rendermode: "0" });
      }
      keep.ents.push(...lid.entities);
      count(piece.id);
    }
    if (w.kind === "trapdoor") floorHoles.push({ building: w.building, cell: w.local, at: [x, y] });
    else holes.push([x, y]);
    for (let i = -1; i <= 2; i++) for (let j = -1; j <= 1; j++) keepClear.add(key(x + i, y + j));
    ways.push({ kind: w.kind, name: w.name, at: w.at, top: [(x + 0.5) * GRID, (y + 0.5) * GRID, 0], foot: [(x + 0.5) * GRID, (y + 0.5) * GRID, F], building: w.building ?? null }); // prettier-ignore
  }

  // the bars across a dead end (one func_wall with the rungs: masked, lit as the world)
  for (const bar of below.bars) {
    const horizontal = bar.from[1] === bar.to[1];
    const [t0, t1] = horizontal ? [Math.min(bar.from[0], bar.to[0]), Math.max(bar.from[0], bar.to[0])] : [Math.min(bar.from[1], bar.to[1]), Math.max(bar.from[1], bar.to[1])]; // prettier-ignore
    const edge = horizontal ? { from: [t0, bar.from[1]], to: [t0 + 1, bar.from[1]] } : { from: [bar.from[0], t0], to: [bar.from[0], t0 + 1] }; // prettier-ignore
    const f = edgeFrame(edge, 1);
    const top = below.cells.get(key(...(horizontal ? [t0, bar.from[1]] : [bar.from[0], t0])))?.air[0][1] ?? F + vaultAt;
    const got = spannedAll(swapped(placed(pieces.bars, { at: world(...f.at, F), turn: f.turn }), null), horizontal ? 0 : 1, t0 * GRID, t1 * GRID);
    for (const e of got.entities) rungs.push(...e.brushes.map((b) => spanned(b, 2, F + BED, top)));
    count("bars");
  }
  if (rungs.length) keep.ents.push(...apartEntities("func_wall", rungs, { rendermode: 4, renderamt: 255, zhlt_lightflags: 2 }));

  // the cistern's piers, from the basin's bed to its vault
  for (const p of below.parts.filter((q) => q.columns))
    for (const [x, y] of p.columns) {
      put(pieces.pier, world(x, y, F), 0, swapOf(p.look ?? "sewer"));
      count("cistern-pier");
    }

  // the lamps: on a tunnel's long walls every `lampEvery` cells (4), sides taken in turn; along a hall's and a room's
  // walls every 4 from each wall's middle; one in each well of a stair
  const lamps = [];
  const lampOn = (edge, side, look, z = F) => {
    const f = edgeFrame(edge, side);
    put(pieces.lamp, world(...f.at, z), f.turn, swapOf(look));
    lamps.push(edge);
    count("lamp-sewer");
  };
  const wallAt = (x, y, d) => !below.cells.has(key(x + d[0], y + d[1]));
  for (const p of below.parts) {
    const [w, h] = [p.to[0] - p.from[0], p.to[1] - p.from[1]];
    const every = p.lampEvery ?? 4;
    if (p.kind === "tunnel") {
      const alongX = w >= h;
      const n = alongX ? w : h;
      for (let t = Math.floor(every / 2), i = 0; t < n; t += every, i++) {
        // the near or the far long side, each where the ground is beyond it (a branch's mouth passed over)
        for (const s of i % 2 ? [1, 0] : [0, 1]) {
          const [x, y] = alongX ? [p.from[0] + t, s ? p.to[1] - 1 : p.from[1]] : [s ? p.to[0] - 1 : p.from[0], p.from[1] + t];
          const d = alongX ? [0, s ? 1 : -1] : [s ? 1 : -1, 0];
          if (!wallAt(x, y, d) || below.cells.get(key(x, y))?.shaft !== undefined) continue;
          const edge = alongX ? { from: [x, y + (s ? 1 : 0)], to: [x + 1, y + (s ? 1 : 0)] } : { from: [x + (s ? 1 : 0), y], to: [x + (s ? 1 : 0), y + 1] }; // prettier-ignore
          lampOn(edge, s ? 0 : 1, p.look ?? "sewer");
          break;
        }
      }
    } else {
      // a hall's or a room's walls, a lamp every `step` cells along each (4 unless told), from the middle out
      const step = p.lampEvery ?? 4;
      const along = (n) => {
        const out = [];
        const m = Math.floor(n / 2);
        for (let d = 0; m - d >= 0 || m + d < n; d += step) for (const t of d ? [m - d, m + d] : [m]) if (t >= 0 && t < n) out.push(t);
        return out;
      };
      const sides = [
        ...along(w).map((i) => [p.from[0] + i, p.from[1], [0, -1], { from: [p.from[0] + i, p.from[1]], to: [p.from[0] + i + 1, p.from[1]] }, 1]),
        ...along(w).map((i) => [p.from[0] + i, p.to[1] - 1, [0, 1], { from: [p.from[0] + i, p.to[1]], to: [p.from[0] + i + 1, p.to[1]] }, 0]),
        ...along(h).map((j) => [p.from[0], p.from[1] + j, [-1, 0], { from: [p.from[0], p.from[1] + j], to: [p.from[0], p.from[1] + j + 1] }, 1]),
        ...along(h).map((j) => [p.to[0] - 1, p.from[1] + j, [1, 0], { from: [p.to[0], p.from[1] + j], to: [p.to[0], p.from[1] + j + 1] }, 0]),
      ];
      for (const [x, y, d, edge, side] of sides)
        if (wallAt(x, y, d) && below.cells.get(key(x, y))?.shaft === undefined && !below.doors.some((q) => q.edges.includes(d[0] ? edgeKey("v", edge.from[0], edge.from[1]) : edgeKey("h", edge.from[0], edge.from[1])))) lampOn(edge, side, p.look ?? "sewer"); // prettier-ignore
    }
  }
  for (const w of below.ways.filter((q) => q.kind === "stair")) {
    const { lower } = wellsOf(w);
    // over the lower's landing half way up its flights (96), and in the upper's nook under the street's landing
    lampOn({ from: [lower[0], lower[1] + 4], to: [lower[0] + 1, lower[1] + 4] }, 0, w.look ?? "stairs", F + STOREY / 2);
    const { upper } = wellsOf(w);
    lampOn({ from: [upper[0], upper[1]], to: [upper[0], upper[1] + 1] }, 1, w.look ?? "stairs", F + STOREY);
  }

  // the sounds
  for (const s of below.sounds) {
    const c = below.cells.get(key(...s.at));
    entities.push(pointEntity("ambient_generic", [(s.at[0] + 0.5) * GRID, (s.at[1] + 0.5) * GRID, (c?.air[0][0] ?? F) + 96], { message: s.file, health: s.volume ?? 5, spawnflags: s.spawnflags ?? 2, pitch: 100, pitchstart: 100 })); // prettier-ignore
    count("sound-below");
  }
  return { brushes: keep.brushes, entities: keep.ents, report: { ways, doors, holes, floorHoles, keepClear: [...keepClear], lamps: lamps.length, ladders, counts, failures } };
}
