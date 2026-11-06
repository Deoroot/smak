// levels/assembly, part L: the building description (building.mjs) and its layout by constrained growth
// (layout.mjs), with the layout's pictures (layout-picture.mjs) and its command (levels/tools/layout.mjs).
// house-01 is checked and laid out with no failure, in the contract's form (the stairwell on the same cells of both
// storeys, its foot open onto stairFrom and its top onto stairTo, a rail over the void, doors between the rooms
// they join, one entrance, windows on outside walls); every doorway (the doors and the entrance) spans 2 collinear
// edges whose middle vertex no other wall meets, with the room it swings into 2 cells deep in front of it; the same
// seed gives the same JSON, three seeds all pass with no door at a wall's corners; and each broken case gives its
// sentence: a room that cannot fit, a room no door reaches, a stair that joins storeys 0 and 2, two rooms that can
// share only 1 edge of wall, and a layout spoiled after it was made (a room in two pieces, a door moved, a wall at a
// door's middle, a door swinging into a room too shallow or not its own, the stair's foot taken).
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { test, sure, tmp, HERE } from "./helper.mjs";
import { checkBuilding } from "../levels/assembly/building.mjs";
import { layoutOf, checkLayout, layoutJson, cellsAcross, edgeKey } from "../levels/assembly/layout.mjs";
import { layoutText, layoutPng } from "../levels/assembly/layout-picture.mjs";

const SPEC = join(HERE, "../levels/specs/house-01.json");
const house = () => JSON.parse(readFileSync(SPEC, "utf8"));
const copy = (v) => JSON.parse(JSON.stringify(v));
const has = (list, ...words) => list.some((f) => words.every((w) => f.includes(w)));
const say = (r) => (r.failures ?? []).slice(0, 4).join(" | ") || "nothing (it passed)";
const isRoom = (v) => typeof v === "string" && v !== "stair" && v !== "void";
const KINDS = new Set(["exterior", "interior", "door", "entrance", "window", "rail"]);
const flat = (e) => e.from[1] === e.to[1];
const same = (u, v) => u[0] === v[0] && u[1] === v[1];

/**
 * What every doorway of a layout must be (README, "Units and the grid"), as a list of what is wrong: 2 edges of its
 * kind on one line meeting at `at`, its rooms either side, no other wall at `at`, its swing room 2 cells deep in
 * front of both edges.
 */
function doorwayFaults(l) {
  const out = [];
  const ways = [...l.doors.map((d) => ({ ...d, kind: "door", name: `door ${d.rooms.join("-")}` })), { ...l.entrance, rooms: [l.entrance.room, null], kind: "entrance", name: "the entrance" }]; // prettier-ignore
  for (const d of ways) {
    const p = l.storeyPlans[d.storey];
    const cell = ([x, y]) => p.cells[y]?.[x] ?? null;
    if (!Array.isArray(d.edges) || d.edges.length !== 2) {
      out.push(`${d.name}: ${d.edges?.length} edges`);
      continue;
    }
    const [e, f] = d.edges;
    if (flat(e) !== flat(f)) out.push(`${d.name}: its edges are not on one line`);
    if (!([e.from, e.to].some((v) => same(v, d.at)) && [f.from, f.to].some((v) => same(v, d.at)))) out.push(`${d.name}: its edges do not meet at ${d.at}`); // prettier-ignore
    for (const x of d.edges) {
      const on = p.edges.find((y) => edgeKey(y) === edgeKey(x));
      if (on?.kind !== d.kind) out.push(`${d.name}: its edge ${edgeKey(x)} is ${on?.kind}`);
      const sides = cellsAcross(x).map(cell);
      if (!d.rooms.every((r) => sides.includes(r))) out.push(`${d.name}: ${sides} either side of ${edgeKey(x)}`);
    }
    const meeting = p.edges.filter((y) => [y.from, y.to].some((v) => same(v, d.at)));
    if (meeting.length !== 2) out.push(`${d.name}: ${meeting.length} walls meet its middle ${d.at}`);
    // the swing: 2 rows of its room in front of both edges
    if (!d.rooms.includes(d.swing) || d.swing === null) out.push(`${d.name}: swings into ${d.swing}`);
    else
      for (const x of d.edges) {
        const [lo, hi] = cellsAcross(x);
        const s = cell(hi) === d.swing ? 1 : -1;
        const [cx, cy] = s > 0 ? hi : lo;
        const [dx, dy] = flat(x) ? [0, s] : [s, 0];
        if (cell([cx, cy]) !== d.swing || cell([cx + dx, cy + dy]) !== d.swing) out.push(`${d.name}: ${d.swing} is not 2 deep in front of ${edgeKey(x)}`); // prettier-ignore
      }
  }
  return out;
}
const atCorner = (l) => l.warnings.filter((w) => /corner/.test(w));

const laid = layoutOf(house());

test("assembly layout: house-01 is a good description and lays out with no failure", () => {
  const c = checkBuilding(house());
  sure(!c.failures.length, say(c));
  sure(!laid.failures.length, say(laid));
  sure(laid.format === "smak-layout/1" && laid.building === "house-01" && laid.seed === 1, JSON.stringify([laid.format, laid.building, laid.seed])); // prettier-ignore
  sure(laid.grid === 64 && laid.storeyHeight === 192 && laid.size.join() === "10,8" && laid.storeys === 2, "grid, height, size"); // prettier-ignore
  sure(laid.storeyPlans.length === 2, `${laid.storeyPlans.length} storey plans`);
  for (const p of laid.storeyPlans) {
    sure(p.cells.length === 8 && p.cells.every((row) => row.length === 10), `storey ${p.storey}: cells not 8 rows of 10`);
    sure(p.cells.flat().every((v) => v !== null), `storey ${p.storey}: a cell of the footprint is left outside`);
    sure(p.edges.every((e) => KINDS.has(e.kind)), `storey ${p.storey}: an edge of an unknown kind`);
  }
  // every room in its area, the storey's rooms covering what the stairwell leaves
  for (const r of laid.rooms) {
    const want = house().rooms.find((q) => q.id === r.id).area;
    sure(r.cells >= want[0] && r.cells <= want[1], `room ${r.id}: ${r.cells} cells, wants ${want.join("-")}`);
  }
  for (const s of [0, 1]) {
    const n = laid.rooms.filter((r) => r.storey === s).reduce((a, r) => a + r.cells, 0);
    sure(n === 72, `storey ${s}: the rooms hold ${n} cells, the footprint leaves 72`);
  }
  sure(!checkLayout(laid, house()).failures.length, say(checkLayout(laid, house())));
});

test("assembly layout: the stairwell is the same 2 x 4 cells on both storeys, open at its foot and its top", () => {
  const w = laid.stairwell;
  sure(w && w.cells.length === 8 && w.from === 0 && w.to === 1, JSON.stringify(w));
  sure(["south", "north", "east", "west"].includes(w.foot), `foot ${w.foot}`);
  const xs = w.cells.map((c) => c[0]);
  const ys = w.cells.map((c) => c[1]);
  const [a, b] = [Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1];
  sure((a === 2 && b === 4) || (a === 4 && b === 2), `the stairwell is ${a} x ${b}`);
  const [lo, up] = laid.storeyPlans;
  sure(w.cells.every(([x, y]) => lo.cells[y][x] === "stair"), "storey 0: a stairwell cell is not stair");
  const upper = w.cells.map(([x, y]) => up.cells[y][x]);
  sure(upper.filter((v) => v === "stair").length === 2 && upper.filter((v) => v === "void").length === 6, `storey 1 stairwell: ${upper}`); // prettier-ignore
  sure(up.cells[w.top[1]][w.top[0]] === "stair" && up.cells[w.bottom[1]][w.bottom[0]] === "stair", "the top landing is not floor");
  // nothing else of the grid is stair or void
  for (const p of laid.storeyPlans) sure(p.cells.flat().filter((v) => !isRoom(v)).length === 8, `storey ${p.storey}: stair cells outside the stairwell`); // prettier-ignore
  // a rail around the void, no rail on the ground storey
  sure(up.edges.some((e) => e.kind === "rail") && !lo.edges.some((e) => e.kind === "rail"), "the rail");
  sure(up.edges.filter((e) => e.kind === "rail").every((e) => e.rooms.includes("void")), "a rail not beside the void");
});

test("assembly layout: each doorway spans 2 collinear edges, its middle free of walls, its swing room 2 deep; windows on outside walls", () => {
  sure(laid.doors.length === house().doors.length, `${laid.doors.length} doors for ${house().doors.length} pairs`);
  const faults = doorwayFaults(laid);
  sure(!faults.length, faults.join(" | "));
  // a door swings into the room that is not the hall where that one has the depth
  for (const d of laid.doors) sure(d.swing !== "hall" && d.swing !== "landing", `door ${d.rooms.join("-")} swings into ${d.swing}`); // prettier-ignore
  const entrances = laid.storeyPlans.flatMap((p) => p.edges.filter((e) => e.kind === "entrance").map((e) => [p.storey, e]));
  sure(entrances.length === 2 && entrances.every(([s, e]) => s === 0 && e.rooms.includes("hall") && e.rooms.includes(null)), "the entrance: 2 edges of hall's outside wall"); // prettier-ignore
  sure(laid.entrance.room === "hall" && laid.entrance.swing === "hall", JSON.stringify(laid.entrance));
  // the entrance clear of the building's corners
  const [w, h] = laid.size;
  const ends = laid.entrance.edges.flatMap((e) => [e.from, e.to]);
  sure(!ends.some(([x, y]) => (x === 0 || x === w) && (y === 0 || y === h)), `the entrance touches a corner of the building: ${JSON.stringify(ends)}`); // prettier-ignore
  const windows = laid.storeyPlans.flatMap((p) => p.edges.filter((e) => e.kind === "window").map((e) => [p.storey, e]));
  sure(windows.length >= 8, `${windows.length} windows`);
  sure(windows.every(([, e]) => e.rooms.includes(null) && e.rooms.some(isRoom)), "a window not on a room's outside wall");
  // no window touches a doorway's middle vertex
  const mids = [...laid.doors, laid.entrance].map((d) => [d.storey, d.at]);
  sure(!windows.some(([s, e]) => mids.some(([t, v]) => s === t && (same(e.from, v) || same(e.to, v)))), "a window touches a doorway's middle"); // prettier-ignore
});

test("assembly layout: the same seed gives the same JSON; seeds 1, 2 and 3 lay out with no failure and no door at a corner", () => {
  sure(layoutJson(layoutOf(house())) === layoutJson(laid), "seed 1 twice gave two layouts");
  const jsons = [1, 2, 3].map((seed) => {
    const l = seed === 1 ? laid : layoutOf(house(), { seed });
    sure(!l.failures.length && l.seed === seed, `seed ${seed}: ${say(l)}`);
    sure(!atCorner(l).length, `seed ${seed}: ${atCorner(l).join(" | ")}`);
    const faults = doorwayFaults(l);
    sure(!faults.length, `seed ${seed}: ${faults.join(" | ")}`);
    sure(JSON.stringify(JSON.parse(layoutJson(l))) === JSON.stringify(l), `seed ${seed}: layoutJson is not the layout`);
    return layoutJson(l);
  });
  sure(new Set(jsons).size >= 2, "three seeds gave one layout");
});

test("assembly layout: a room that cannot fit gives its sentence", () => {
  const d = house();
  d.rooms.find((r) => r.id === "kitchen").area = [60, 70];
  const c = checkBuilding(d);
  sure(has(c.failures, "room kitchen: wants 60-70 cells, the footprint left 38"), say(c));
  sure(has(c.failures, "storey 0: its rooms want at least 94 cells, the footprint leaves 72"), say(c));
  const l = layoutOf(d);
  sure(has(l.failures, "room kitchen: wants 60-70 cells") && !l.storeyPlans.length, say(l));
});

test("assembly layout: a room no door reaches gives its sentence", () => {
  const d = house();
  d.doors = d.doors.filter((p) => !p.includes("bath"));
  const c = checkBuilding(d);
  sure(has(c.failures, "room bath (storey 1) is not reached from the entrance hall through the doors and the stair: no door names it"), say(c)); // prettier-ignore
  d.doors.push(["bath", "bed1"]);
  d.doors = d.doors.filter((p) => !(p.includes("landing") && p.includes("bed1")));
  const c2 = checkBuilding(d);
  sure(has(c2.failures, "room bath (storey 1) is not reached", "its doors join only bed1"), say(c2));
  sure(has(c2.failures, "room bed1 (storey 1) is not reached"), say(c2));
});

test("assembly layout: two rooms that can share only 1 edge of wall fail the door by its sentence", () => {
  // a closet of 1 cell meets its neighbour on 1 edge of any one line: no doorway of 128 fits
  const d = {
    format: "smak-building/1",
    name: "closet",
    seed: 1,
    footprint: { cells: [4, 3] },
    storeys: 1,
    rooms: [
      { id: "room", storey: 0, kind: "living", area: [11, 11], entrance: true },
      { id: "closet", storey: 0, kind: "room", area: [1, 1] },
    ],
    doors: [["room", "closet"]],
  };
  sure(!checkBuilding(d).failures.length, say(checkBuilding(d)));
  const l = layoutOf(d, { tries: 8 });
  sure(has(l.failures, "door room-closet: room and closet share a straight wall of 1 edge on storey 0; a door wants 2 with no wall meeting its middle (64 clear needs 128 of wall)"), say(l)); // prettier-ignore
  sure(!l.doors.length, `${l.doors.length} doors laid`);
});

test("assembly layout: a stair that joins storeys 0 and 2 gives its sentence", () => {
  const d = house();
  d.storeys = 3;
  for (const r of d.rooms) if (r.storey === 1) r.storey = 2;
  d.rooms.push({ id: "attic", storey: 1, kind: "room", area: [60, 72] });
  const c = checkBuilding(d);
  sure(has(c.failures, "stair: stairFrom hall is on storey 0 and stairTo landing on storey 2; a stair climbs 1 storey"), say(c)); // prettier-ignore
  sure(has(layoutOf(d).failures, "a stair climbs 1 storey"), "layoutOf did not refuse it");
});

test("assembly layout: a spoiled layout fails checkLayout by its sentence", () => {
  // a room split in two: one of its cells far from it given its name
  let l = copy(laid);
  const p = l.storeyPlans[1];
  const bath = [];
  p.cells.forEach((row, y) => row.forEach((v, x) => v === "bath" && bath.push([x, y])));
  const far = [];
  p.cells.forEach((row, y) => row.forEach((v, x) => isRoom(v) && v !== "bath" && far.push([x, y, Math.min(...bath.map(([bx, by]) => Math.abs(bx - x) + Math.abs(by - y)))]))); // prettier-ignore
  const [fx, fy] = far.sort((a, b) => b[2] - a[2])[0];
  p.cells[fy][fx] = "bath";
  let v = checkLayout(l);
  sure(has(v.failures, "room bath (storey 1): its", "cells fall apart"), say(v));
  // a door moved onto an edge of another kind
  l = copy(laid);
  const d = l.doors[0];
  const other = l.storeyPlans[d.storey].edges.find((e) => e.kind === "exterior");
  d.edges[0] = { from: other.from, to: other.to };
  v = checkLayout(l);
  sure(has(v.failures, `door ${d.rooms.join("-")}: the edge`, "it wants kind door"), say(v));
  // a wall standing at a door's middle vertex (a corner post in the opening)
  l = copy(laid);
  const m = l.doors[0];
  const [mx, my] = m.at;
  const across = flat(m.edges[0]) ? { from: [mx, my], to: [mx, my + 1] } : { from: [mx, my], to: [mx + 1, my] };
  l.storeyPlans[m.storey].edges.push({ ...across, kind: "interior", rooms: m.rooms });
  v = checkLayout(l);
  sure(has(v.failures, `door ${m.rooms.join("-")}: another wall meets its middle vertex (${mx} ${my})`), say(v));
  // a door swinging into a room 1 cell deep: the second row in front of it given to the other room
  l = copy(laid);
  const sw = l.doors[0];
  const p0 = l.storeyPlans[sw.storey];
  const [lo, hi] = cellsAcross(sw.edges[0]);
  const side = p0.cells[hi[1]][hi[0]] === sw.swing ? 1 : -1;
  const [cx, cy] = side > 0 ? hi : lo;
  const [dx, dy] = flat(sw.edges[0]) ? [0, side] : [side, 0];
  p0.cells[cy + dy][cx + dx] = sw.rooms.find((r) => r !== sw.swing);
  v = checkLayout(l);
  sure(has(v.failures, `door ${sw.rooms.join("-")}: it swings into ${sw.swing}, which is 1 cell deep in front of it`, "it wants 2 rows"), say(v)); // prettier-ignore
  // a door swinging into a room it does not join
  l = copy(laid);
  l.doors[0].swing = "bath";
  v = checkLayout(l);
  sure(has(v.failures, `door ${l.doors[0].rooms.join("-")}: it swings into bath; it wants one of`), say(v));
  // the stair's foot given to another room
  l = copy(laid);
  const w = l.stairwell;
  const step = { south: [0, -1], north: [0, 1], east: [1, 0], west: [-1, 0] }[w.foot];
  const [x, y] = [w.bottom[0] + step[0], w.bottom[1] + step[1]];
  l.storeyPlans[0].cells[y][x] = "kitchen";
  v = checkLayout(l);
  sure(has(v.failures, "stair: its foot on storey 0 opens onto", "it wants hall on both of its 2 cells"), say(v));
});

test("assembly layout: the text map and the plan of each storey", () => {
  for (const s of [0, 1]) {
    const t = layoutText(laid, s).trimEnd().split("\n");
    sure(t.length === 1 + 17 + 1, `storey ${s}: ${t.length} lines`);
    sure(t.slice(1, 18).every((line) => line.length <= 21), `storey ${s}: a row wider than 21`);
    sure(t[0].includes("house-01 storey " + s), t[0]);
    const bytes = layoutPng(laid, s, join(tmp, `house-01-storey-${s}.png`));
    sure(bytes.subarray(1, 4).toString() === "PNG" && existsSync(join(tmp, `house-01-storey-${s}.png`)), "no PNG");
  }
  const t0 = layoutText(laid, 0);
  sure(t0.includes("E") && t0.includes("D") && t0.includes("^"), "the ground storey's map lacks an entrance, a door or the stair"); // prettier-ignore
  // a doorway reads as one mark across its two edges and its middle: EEE along a row, or three down a column
  const rows = t0.split("\n").slice(1, 18);
  const three = (c) => rows.some((r) => r.includes(c + c + c)) || rows.some((r, i) => i + 2 < rows.length && [...r].some((ch, j) => ch === c && rows[i + 1][j] === c && rows[i + 2][j] === c)); // prettier-ignore
  sure(three("E") && three("D"), "a doorway is not drawn across its two edges");
  sure(layoutText(laid, 1).includes("R") && layoutText(laid, 1).includes("."), "the upper storey's map lacks the rail or the void"); // prettier-ignore
});

test("assembly layout: the command writes the layout and its pictures and ends PASS", () => {
  const out = join(tmp, "layout-house-01");
  const said = execFileSync(process.execPath, [join(HERE, "../levels/tools/layout.mjs"), SPEC, "--out", out, "--seed", "3"], { encoding: "utf8" }); // prettier-ignore
  const last = said.trimEnd().split("\n").pop();
  sure(last.startsWith("PASS: house-01 seed 3"), last);
  for (const f of ["layout.json", "storey-0.txt", "storey-1.txt", "storey-0.png", "storey-1.png"]) sure(existsSync(join(out, f)), `no ${f}`); // prettier-ignore
  sure(JSON.parse(readFileSync(join(out, "layout.json"), "utf8")).seed === 3, "layout.json is not seed 3");
});
