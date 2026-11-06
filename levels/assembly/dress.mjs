// levels/assembly, the dressing of a site: what an assembled site is dressed with in its game, from a dress file
// (levels/assembly/dress/<name>.json, format smak-dress/1): accent glows on its roofs, gates and fronts, looped ambient
// sounds by district and room, and props (ts_model) in its rooms and along its streets, each big piece of furniture
// with a CLIP brush under it as the game's map makers do. Every placement is on the plan's grid: a prop stands against a wall
// with its back to it, in cells of its room that no doorway, leaf's swing, stair or start needs, and never so that
// the cells of its room left free fall apart; a glow stands within 32 units of a surface. The dress file names only
// files the game has; nothing of the game's is in it.
//
//   dressSite(plan, built, dress, { seed })  ->  { brushes, entities, report: { counts, skipped, failures, warnings } }
//   loadDress(name)
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { box, pointEntity } from "../../src/maps/source.mjs";
import { sweptBy, cellsAcross } from "./layout.mjs";
import { entrancesOf } from "./layout.mjs";
import { PUBLIC } from "./site.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GRID = 64;
const STOREY = 192;
/** A storey's clear height: its ceiling is the slab over it, z 176..192. */
const CEILING = 176;
/** Half a wall: walls are 16 thick, centred on the cell's edge. */
const HALF_WALL = 8;
/** A window's sill over its floor: a prop before a window stays under it. */
const SILL = 40;
/** The lowest a hanging lamp's fitting comes (lamp-ceiling: z 109..176); a prop under one stays below. */
const UNDER_LAMP = 105;
/** A painting's middle over its floor. */
const PICTURE = 96;
/** Half a standing player and a unit: a cell whose middle is nearer a solid prop than this cannot be stood in. */
const HULL = 17;
/** A prop on the public floor keeps this far off a front's line: the half wall and a sill's or a cornice's 6. */
const OFF_FRONT = 16;
/** The tallest thing on the open public floor (a lamp post, a tree), under the blind fronts' lights. */
const OPEN_TOP = 380;
/** The air a prop leaves between itself and a wall. */
const GAP = 2;
/** A glow stands this far out of a wall's line (8 out of its face). */
const GLOW_OUT = 16;
const SQ_M_PER_CELL = (GRID * 0.0254) ** 2;
const M_PER_CELL = GRID * 0.0254;
const DIRS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const key = (x, y) => `${x},${y}`;
const edgeKey = (e) => {
  const [a, b] = [e.from, e.to].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return `${a[0]},${a[1]}-${b[0]},${b[1]}`;
};
/** The edge between cell (x, y) and its neighbour in direction d, in the layout's vertices. */
const sideEdge = (x, y, [dx, dy]) =>
  dx === 1 ? { from: [x + 1, y], to: [x + 1, y + 1] } : dx === -1 ? { from: [x, y], to: [x, y + 1] } : dy === 1 ? { from: [x, y + 1], to: [x + 1, y + 1] } : { from: [x, y], to: [x + 1, y] }; // prettier-ignore
const yawOf = ([dx, dy]) => (dx === 1 ? 0 : dy === 1 ? 90 : dx === -1 ? 180 : 270);
/**
 * The two site cells just outside a doorway of the site's report (its `middle` on the wall's line, `into` the building,
 * `along` the wall): the opening is 64 wide round the middle, so a cell each side of it.
 */
export const outsideOf = (d) =>
  [-1, 1].map((s) => [0, 1].map((k) => Math.floor((d.middle[k] - (d.into[k] * GRID) / 2 + (d.along[k] * s * GRID) / 2) / GRID)));

/** A dress file of levels/assembly/dress by its name. */
export function loadDress(name) {
  const file = join(HERE, "dress", `${name}.json`);
  if (!existsSync(file)) throw new Error(`there is no levels/assembly/dress/${name}.json`);
  const dress = JSON.parse(readFileSync(file, "utf8"));
  if (dress.format !== "smak-dress/1") throw new Error(`${name}: format ${dress.format}, not smak-dress/1`);
  return dress;
}

function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A model's box turned by a yaw of a quarter's multiple. */
function turned(min, max, yaw) {
  const q = ((Math.round(yaw / 90) % 4) + 4) % 4;
  const xs = [min[0], max[0]];
  const ys = [min[1], max[1]];
  const pts = xs.flatMap((x) => ys.map((y) => [[x, y], [-y, x], [-x, -y], [y, -x]][q]));
  return {
    min: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), min[2]],
    max: [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])), max[2]],
  };
}

const glowKeys = (r, i, color = r.rendercolor) => ({
  model: r.model,
  rendermode: r.rendermode,
  renderamt: r.renderamt,
  rendercolor: color.join(" "),
  renderfx: r.renderfx[i % r.renderfx.length],
  scale: r.scale,
});

/**
 * Dresses an assembled site. `plan` is planSite's, `built` assembleSite's; nothing of either is changed: the brushes
 * (CLIP) and entities to add come back with a report of what was placed, what found no room, and why.
 */
export function dressSite(plan, built, dress, { seed = 1 } = {}) {
  const { site, cells } = plan;
  const [W, H] = site.size;
  const rnd = random(seed);
  const brushes = [];
  const entities = [];
  const counts = {};
  const skipped = {};
  const failures = [];
  const warnings = [];
  const count = (k, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
  const skip = (k) => (skipped[k] = (skipped[k] ?? 0) + 1);
  const districtAt = (x, y) => plan.districts?.[y]?.[x] ?? null;
  const isPublic = (x, y) => x >= 0 && y >= 0 && x < W && y < H && PUBLIC.has(cells[y][x]);

  // ── the accents ──
  const A = dress.accents ?? {};
  let glows = 0;
  const glow = (r, at, i = glows, color) => {
    entities.push(pointEntity("env_glow", at.map((v) => Math.round(v)), glowKeys(r, i, color)));
    glows++;
    count(`glow`);
  };
  const lightBy = (rgbi, at) => {
    if (!rgbi) return;
    entities.push(pointEntity("light", at.map((v) => Math.round(v)), { _light: rgbi.join(" ") }));
    count("accent-light");
  };
  /** A building's perimeter: its storey-0 edges with the outside on one side, each with its outward step. */
  const perimeterOf = (b, l) =>
    l.storeyPlans[0].edges
      .filter((e) => (e.rooms ?? []).includes(null))
      .map((e) => {
        const [c0, c1] = cellsAcross(e);
        const inside = (c) => c[0] >= 0 && c[1] >= 0 && c[0] < b.size[0] && c[1] < b.size[1];
        const out = inside(c1) ? c0 : c1;
        const inn = inside(c1) ? c1 : c0;
        const d = [out[0] - inn[0], out[1] - inn[1]];
        const mid = [(e.from[0] + e.to[0]) / 2 + b.at[0], (e.from[1] + e.to[1]) / 2 + b.at[1]];
        return { e, d, mid, outCell: [out[0] + b.at[0], out[1] + b.at[1]] };
      });
  const outAt = (p, z, out = GLOW_OUT) => [p.mid[0] * GRID + p.d[0] * out, p.mid[1] * GRID + p.d[1] * out, z];

  for (const b of site.buildings) {
    const l = plan.layouts.get(b.id);
    if (!l?.storeyPlans?.length) continue;
    const district = b.district ?? districtAt(...b.at);
    const per = perimeterOf(b, l);
    const top = l.storeys * STOREY;
    // red lights on two opposite corners of the roof, as aviation lights (`over` the roof, `out` from the corner: on
    // the tip of the skyline's turret there)
    if (A.rim) {
      const [x0, y0, x1, y1] = [b.at[0], b.at[1], b.at[0] + b.size[0], b.at[1] + b.size[1]].map((v) => v * GRID);
      const o = A.rim.out ?? 12;
      const corners = [
        [x0 - o, y0 - o],
        [x1 + o, y1 + o],
      ];
      corners.forEach(([x, y], i) => {
        glow(A.rim, [x, y, top + (A.rim.over ?? 8)], i);
        if (i === 0) lightBy(A.rim.light, [x, y, top + (A.rim.over ?? 8) + 16]);
      });
    }
    const facing = per.filter((p) => isPublic(...p.outCell));
    if (A.nexus && district === "nexus")
      facing.forEach((p, i) => {
        if (i % A.nexus.every !== 1) return;
        glow(A.nexus, outAt(p, A.nexus.z));
        if (i % (A.nexus.every * 3) === 1) lightBy(A.nexus.light, outAt(p, A.nexus.z, 32));
      });
    if (A.neon && district === "market")
      facing
        .filter((p) => p.e.kind === "entrance" || p.e.kind === "window")
        .forEach((p, i) => {
          if ((counts.neon ?? 0) >= A.neon.cap) return;
          const color = A.neon.colors[(counts.neon ?? 0) % A.neon.colors.length];
          glow(A.neon, outAt(p, A.neon.z), i, color);
          if ((counts.neon ?? 0) % 3 === 0 && A.neon.light) lightBy([...color, 50], outAt(p, A.neon.z, 32));
          count("neon");
        });
    if (A.hollow && district === "hollow") {
      facing.forEach((p, i) => {
        if (i % A.hollow.every !== 3) return;
        glow(A.hollow, outAt(p, A.hollow.z));
        lightBy(A.hollow.light, outAt(p, A.hollow.z, 32));
      });
      facing
        .filter((p) => p.e.kind === "entrance")
        .forEach((p, i) => {
          if (i % A.hollow.red.every) return;
          glow({ ...A.hollow, ...A.hollow.red }, outAt(p, A.hollow.red.z));
        });
    }
  }
  // the site's ends: a red light every so often along the blind fronts' tops
  if (A.backdrop) {
    let n = 0;
    const tops = 3 * STOREY + 8;
    const along = [];
    for (let x = 0; x < W; x++) along.push([x, 0, [x + 0.5, 0], [0, 1]], [x, H - 1, [x + 0.5, H], [0, -1]]);
    for (let y = 0; y < H; y++) along.push([0, y, [0, y + 0.5], [1, 0]], [W - 1, y, [W, y + 0.5], [-1, 0]]);
    for (const [x, y, mid, inward] of along) {
      if (!isPublic(x, y)) continue;
      if (n++ % A.backdrop.every !== Math.floor(A.backdrop.every / 2)) continue;
      glow(A.backdrop, [mid[0] * GRID + inward[0] * GLOW_OUT, mid[1] * GRID + inward[1] * GLOW_OUT, tops]);
    }
  }
  // the checkpoints: amber at both jambs on both faces, a red stop-lamp over the middle
  const gateCells = new Set();
  if (A.gate)
    for (const w of site.walls ?? []) {
      const along = w.from[1] === w.to[1] ? 0 : 1;
      for (const g of w.gates ?? []) {
        for (let t = -2; t <= 1; t++)
          for (const s of [-1, 0]) gateCells.add(along === 0 ? key(g[0] + t, g[1] + s) : key(g[0] + s, g[1] + t));
        for (const side of [-1, 1]) {
          const at = (t, z) => (along === 0 ? [(g[0] + t) * GRID, g[1] * GRID + side * GLOW_OUT, z] : [g[0] * GRID + side * GLOW_OUT, (g[1] + t) * GRID, z]); // prettier-ignore
          glow(A.gate, at(-1, 160));
          glow(A.gate, at(1, 160));
          glow({ ...A.gate, ...A.gate.stop }, at(0, 200));
          lightBy(A.gate.light, at(0, 150).map((v, i) => (i === 1 - along ? v + side * 16 : v)));
        }
        count("gate-accents");
      }
    }

  // ── the props ──
  const models = dress.models ?? {};
  // the cells a way down to the level below keeps clear (its opening, the lid's slide, a step round it: below.mjs)
  const clear = new Set(built.report.below?.keepClear ?? []);
  const spawnCells = new Set((built.report.spawns ?? []).map((s) => key(Math.floor(s.at[0]), Math.floor(s.at[1]))));
  const lampCells = new Map();
  for (const lamp of built.report.lamps ?? [])
    if (lamp.cell) lampCells.set(`${lamp.building}|${lamp.storey}|${key(...lamp.cell)}`, lamp.kind);
  const pick = (entry) => {
    if (Array.isArray(entry.n)) return entry.n[0] + Math.floor(rnd() * (entry.n[1] - entry.n[0] + 1));
    return null;
  };
  /**
   * One prop against a wall: tried at each free wall side of `room`'s cells (corners first for "corner"), its box
   * turned to face into the room, kept off the walls and under the ceiling (or a lamp, or a sill), in free cells.
   * `room`: { cells: Set, sides(x, y, d) -> "solid" | "window" | null, blocked: Set, reserved: Set, floor, toWorld,
   * lamp(x, y), connected(extra) }
   */
  const clipLog = [];
  const place = (id, room, label) => {
    const m = models[id];
    if (!m) return (failures.push(`the dress names a model ${id} it has no entry for`), false);
    if (m.place === "on") return (skip(`${label}: on a table (${id})`), false);
    if (room.open && (m.place === "hung" || m.place === "ceiling")) return (skip(`${label}: nothing hangs in the open (${id})`), false);
    const cand = [];
    for (const k of room.cells) {
      const [x, y] = k.split(",").map(Number);
      if (room.blocked.has(k) || room.reserved.has(k)) continue;
      const walls = DIRS.filter((d) => room.sides(x, y, d));
      for (const d of walls) cand.push({ x, y, d, corner: walls.length > 1, r: rnd() });
    }
    const order = m.place === "corner" ? (a, b) => b.corner - a.corner || a.r - b.r : (a, b) => a.r - b.r;
    for (const c of cand.sort(order)) {
      const inward = [-c.d[0], -c.d[1]];
      const hung = m.place === "hung";
      const ceiling = m.place === "ceiling";
      const yaw = (((m.yaw + yawOf(inward)) % 360) + 360) % 360;
      const t = turned(m.min, m.max, yaw);
      // the wall's face, and the box's back put against it
      const [cx, cy] = [(c.x + 0.5) * GRID, (c.y + 0.5) * GRID];
      const clear = room.clear ?? HALF_WALL;
      const face = [cx + c.d[0] * (GRID / 2 - clear), cy + c.d[1] * (GRID / 2 - clear)];
      let ox = cx;
      let oy = cy;
      if (c.d[0]) ox = c.d[0] > 0 ? face[0] - GAP - t.max[0] : face[0] + GAP - t.min[0];
      else oy = c.d[1] > 0 ? face[1] - GAP - t.max[1] : face[1] + GAP - t.min[1];
      if (!c.d[0]) ox = cx - (t.min[0] + t.max[0]) / 2;
      else oy = cy - (t.min[1] + t.max[1]) / 2;
      const kind = room.sides(c.x, c.y, c.d);
      const floor = room.floor;
      let oz = floor - m.min[2];
      if (hung) oz = floor + PICTURE;
      if (ceiling) oz = floor + CEILING - m.max[2];
      const lo = [ox + t.min[0], oy + t.min[1], oz + m.min[2]];
      const hi = [ox + t.max[0], oy + t.max[1], oz + m.max[2]];
      if (hi[2] > floor + (room.top ?? CEILING - 1)) continue;
      if (kind === "window" && !ceiling && lo[2] < floor + 120 && hi[2] > floor + SILL) continue;
      // the cells it stands over: all the room's, free, each wall it nears kept 8 off
      const covered = [];
      for (let gx = Math.floor((lo[0] + 1) / GRID); gx <= Math.floor((hi[0] - 1) / GRID); gx++)
        for (let gy = Math.floor((lo[1] + 1) / GRID); gy <= Math.floor((hi[1] - 1) / GRID); gy++) covered.push([gx, gy]);
      let fits = covered.length > 0;
      for (const [gx, gy] of covered) {
        const k = key(gx, gy);
        if (!room.cells.has(k) || room.reserved.has(k) || (!hung && !ceiling && room.blocked.has(k))) fits = false;
        if (!fits) break;
        if (ceiling && room.lamp(gx, gy)) fits = false;
        if (!hung && !ceiling && room.lamp(gx, gy) === "ceiling" && hi[2] > floor + UNDER_LAMP) fits = false;
        for (const d of DIRS) {
          if (!room.sides(gx, gy, d) && room.cells.has(key(gx + d[0], gy + d[1]))) continue;
          const bound = d[0] ? (gx + (d[0] > 0 ? 1 : 0)) * GRID - d[0] * clear : (gy + (d[1] > 0 ? 1 : 0)) * GRID - d[1] * clear; // prettier-ignore
          const reach = d[0] > 0 ? hi[0] : d[0] < 0 ? lo[0] : d[1] > 0 ? hi[1] : lo[1];
          if ((d[0] || d[1]) > 0 ? reach > bound + 0.01 : reach < bound - 0.01) fits = false;
        }
        if (!fits) break;
      }
      if (!fits) continue;
      // hung and ceiling things take no floor; the rest take theirs from other props; a solid one keeps its room in
      // one piece, the cells it stands over and those a standing player (32 wide) can no longer stand in beside it gone
      const takes = hung || ceiling ? [] : covered.map(([gx, gy]) => key(gx, gy));
      const solid = m.clip && !hung && !ceiling;
      const near = [];
      if (solid)
        for (const k of room.cells) {
          const [gx, gy] = k.split(",").map(Number);
          const [px, py] = [(gx + 0.5) * GRID, (gy + 0.5) * GRID];
          if (px > lo[0] - HULL && px < hi[0] + HULL && py > lo[1] - HULL && py < hi[1] + HULL && !takes.includes(k)) near.push(k);
        }
      if (solid && !room.connected([...takes, ...near])) continue;
      if (solid) for (const k of [...takes, ...near]) room.unwalk.add(k);
      for (const k of takes) room.reserved.add(k);
      entities.push(pointEntity("ts_model", [ox, oy, oz].map((v) => Math.round(v)), { model: m.file, angles: [0, yaw, 0], rendercolor: "0 0 0", ...(m.keys ?? {}) })); // prettier-ignore
      if (solid) {
        clipLog.push({ lo: [Math.floor(lo[0]), Math.floor(lo[1]), floor], hi: [Math.ceil(hi[0]), Math.ceil(hi[1]), Math.ceil(Math.max(hi[2], floor + 16))] });
        brushes.push(box([Math.floor(lo[0]), Math.floor(lo[1]), floor], [Math.ceil(hi[0]), Math.ceil(hi[1]), Math.ceil(Math.max(hi[2], floor + 16))], "CLIP")); // prettier-ignore
        count("prop-clip");
      }
      count("prop");
      count(`prop:${label}`);
      return true;
    }
    skip(`${label}: no room for ${id}`);
    return false;
  };
  // the rooms
  let laneChecks = 0;
  for (const b of site.buildings) {
    const l = plan.layouts.get(b.id);
    if (!l?.storeyPlans?.length) continue;
    const district = b.district ?? districtAt(...b.at);
    const ways = [...(l.doors ?? []), ...entrancesOf(l).map((e) => ({ ...e, storey: e.storey ?? 0 }))];
    for (const r of l.rooms) {
      const list = dress.rooms?.[r.kind];
      if (!list) continue;
      const plan_ = l.storeyPlans[r.storey];
      const edges = new Map(plan_.edges.map((e) => [edgeKey(e), e]));
      const inRoom = (x, y) => plan_.cells[y]?.[x] === r.id;
      const cellsSet = new Set();
      plan_.cells.forEach((row, y) => row.forEach((v, x) => v === r.id && cellsSet.add(key(x, y))));
      // the cells no prop takes: beside a doorway, in a leaf's swing, beside the stair
      const blocked = new Set();
      for (const w of ways.filter((w) => w.storey === r.storey)) {
        for (const e of w.edges) for (const c of cellsAcross(e)) blocked.add(key(...c));
        for (const k of sweptBy(plan_.cells, w)) blocked.add(k);
      }
      for (const k of cellsSet) {
        const [x, y] = k.split(",").map(Number);
        if (DIRS.some(([dx, dy]) => plan_.cells[y + dy]?.[x + dx] === "stair")) blocked.add(k);
      }
      const sides = (x, y, d) => {
        if (inRoom(x + d[0], y + d[1])) return null;
        const e = edges.get(edgeKey(sideEdge(x, y, d)));
        if (!e) return null;
        if (e.kind === "window") return "window";
        return e.kind === "exterior" || e.kind === "wall" || e.kind === "facade" ? "solid" : null;
      };
      const reserved = new Set();
      const room = {
        cells: cellsSet,
        sides,
        blocked,
        reserved,
        floor: r.storey * STOREY,
        lamp: (x, y) => lampCells.get(`${b.id}|${r.storey}|${key(x, y)}`) ?? null,
      };
      // world cells: the room's cells are the building's; shift once to the site
      const shifted = shiftRoom(room, b.at);
      for (const k of clear) if (shifted.cells.has(k)) shifted.blocked.add(k);
      const entries = [...(list.base ?? []), ...(list.variants?.[district] ?? [])];
      const first = clipLog.length;
      for (const entry of entries) {
        const n = pick(entry);
        for (let i = 0; i < (n ?? 0); i++) place(entry.id, shifted, r.kind);
      }
      // the rule: the doorways of this room stay open to each other past what the room's props are clipped with
      const doorPoints = [];
      for (const w of ways.filter((q) => q.storey === r.storey))
        for (const e of w.edges.slice(0, 1)) {
          const horizontal = e.from[1] === e.to[1];
          const [ex, ey] = [Math.min(e.from[0], e.to[0]), Math.min(e.from[1], e.to[1])];
          const sides = horizontal ? [{ cell: [ex, ey - 1], n: [0, -1] }, { cell: [ex, ey], n: [0, 1] }] : [{ cell: [ex - 1, ey], n: [-1, 0] }, { cell: [ex, ey], n: [1, 0] }]; // prettier-ignore
          const inside = sides.find((q) => inRoom(...q.cell));
          if (!inside) continue;
          const mid = horizontal ? [(ex + 0.5 + b.at[0]) * GRID, (ey + b.at[1]) * GRID] : [(ex + b.at[0]) * GRID, (ey + 0.5 + b.at[1]) * GRID];
          doorPoints.push({ at: [mid[0] + inside.n[0] * LANE_IN, mid[1] + inside.n[1] * LANE_IN], label: `the doorway at ${mid.join(",")}` });
        }
      const clips = clipLog.slice(first);
      laneChecks += doorPoints.length;
      for (const why of laneProblems(shifted.cells, doorPoints, clips, r.storey * STOREY)) failures.push(`building ${b.id}, ${r.kind} (storey ${r.storey}): ${why}`);
    }
  }

  // the public floor: along the buildings' walls and the site's ends, out of the doorways, the starts and the gates
  const doorOut = new Set();
  for (const d of built.report.doorways ?? []) if (d.building != null) for (const [x, y] of outsideOf(d)) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) doorOut.add(key(x + dx, y + dy)); // prettier-ignore
  const landmarkCells = new Set();
  for (const a of site.areas ?? [])
    if (a.landmark)
      for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) landmarkCells.add(key(a.landmark[0] + dx, a.landmark[1] + dy)); // prettier-ignore
  const zoneOf = (x, y) => {
    const c = cells[y][x];
    const d = districtAt(x, y);
    if (c === "portico") return d === "mese" ? "mese_portico" : "street";
    if (c === "alley") return "alley";
    if (c === "plaza" || c === "square") return d === "nexus" ? "nexus_forecourt" : d === "hollow" ? "hollow_court" : "plaza";
    return "street";
  };
  const zones = new Map();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!isPublic(x, y) || cells[y][x] === "landmark") continue;
      const z = `${districtAt(x, y)}|${zoneOf(x, y)}`;
      if (!zones.has(z)) zones.set(z, new Set());
      zones.get(z).add(key(x, y));
    }
  const allPublic = new Set();
  for (const set of zones.values()) for (const k of set) allPublic.add(k);
  const reservedPublic = new Set();
  const blockedPublic = new Set([...doorOut, ...landmarkCells, ...gateCells, ...clear]);
  for (const k of spawnCells) {
    const [x, y] = k.split(",").map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) blockedPublic.add(key(x + dx, y + dy));
  }
  for (const [z, set] of zones) {
    const [district, kind] = z.split("|");
    const list = dress.publicFloor?.[kind];
    if (!list) continue;
    // a wall side: a building, or the site's end; a prop stands there only where the floor is 3 cells deep before it
    const sides = (x, y, d) => {
      const [nx, ny] = [x + d[0], y + d[1]];
      const off = nx < 0 || ny < 0 || nx >= W || ny >= H;
      if (!off && !String(cells[ny][nx]).startsWith("building ")) return null;
      for (let k = 1; k <= 3; k++) if (!isPublic(x - d[0] * k, y - d[1] * k)) return null;
      return "solid";
    };
    const room = {
      cells: set,
      sides,
      blocked: blockedPublic,
      reserved: reservedPublic,
      floor: 0,
      lamp: () => null,
      unwalk: new Set(),
      connected: () => true,
      open: true,
      // off a front by its sills and cornices (6 proud) as well as its half; under a portico's roof, or a lamp post's height
      clear: OFF_FRONT,
      top: kind === "mese_portico" ? CEILING - 1 : OPEN_TOP,
    };
    const area = set.size * SQ_M_PER_CELL;
    let kerb = 0;
    for (const k of set) {
      const [x, y] = k.split(",").map(Number);
      if (DIRS.some((d) => sides(x, y, d))) kerb += M_PER_CELL;
    }
    for (const entry of [...(list.base ?? []), ...(list.variants?.[district] ?? [])]) {
      let n = pick(entry);
      if (n === null) {
        const rate = entry.n.per100m2 != null ? (entry.n.per100m2 * area) / 100 : (entry.n.perKerbM ?? entry.n.perBayM ?? entry.n.perLengthM ?? 0) * kerb; // prettier-ignore
        n = Math.floor(rate) + (rnd() < rate - Math.floor(rate) ? 1 : 0);
      }
      for (let i = 0; i < n; i++) place(entry.id, room, `public ${kind}`);
    }
  }

  // ── below the streets: the props the level's description places (its dead ends' stashes, the den's cellar), on
  // their cell's floor, turned as told, a solid one clipped as the rooms' are
  for (const p of plan.below?.props ?? []) {
    const m = models[p.id];
    const c = plan.below.cells.get(key(...p.at));
    if (!m) failures.push(`the level below names a model ${p.id} the dress has no entry for`);
    else if (!c) failures.push(`the level below puts ${p.id} at ${p.at.join(",")}, on no cell of it`);
    if (!m || !c) continue;
    const yaw = (((m.yaw ?? 0) + (p.yaw ?? 0)) % 360 + 360) % 360;
    const t = turned(m.min, m.max, yaw);
    const floor = c.air[0][0];
    const o = [(p.at[0] + 0.5) * GRID - (t.min[0] + t.max[0]) / 2, (p.at[1] + 0.5) * GRID - (t.min[1] + t.max[1]) / 2, floor - m.min[2]];
    entities.push(pointEntity("ts_model", o.map((v) => Math.round(v)), { model: m.file, angles: [0, yaw, 0], rendercolor: "0 0 0", ...(m.keys ?? {}) })); // prettier-ignore
    if (m.clip) {
      brushes.push(box([Math.floor(o[0] + t.min[0]), Math.floor(o[1] + t.min[1]), floor], [Math.ceil(o[0] + t.max[0]), Math.ceil(o[1] + t.max[1]), Math.ceil(Math.max(floor + m.max[2] - m.min[2], floor + 16))], "CLIP")); // prettier-ignore
      count("prop-clip");
    }
    count("prop");
    count("prop:below");
  }

  // ── the sounds ──
  const soundAt = (s, at, name) => {
    entities.push(pointEntity("ambient_generic", at.map((v) => Math.round(v)), { message: s.file, health: s.volume, spawnflags: s.spawnflags, pitch: 100, pitchstart: 100, ...(name ? { targetname: name } : {}) })); // prettier-ignore
    count("sound");
  };
  const spread = (list, n) => {
    // farthest-point: the first nearest the cells' middle, then each the farthest from those taken
    if (!list.length) return [];
    const mid = [list.reduce((a, c) => a + c[0], 0) / list.length, list.reduce((a, c) => a + c[1], 0) / list.length];
    const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
    const out = [list.reduce((best, c) => (d2(c, mid) < d2(best, mid) ? c : best))];
    while (out.length < Math.min(n, list.length)) out.push(list.reduce((best, c) => (Math.min(...out.map((o) => d2(o, c))) > Math.min(...out.map((o) => d2(o, best))) ? c : best))); // prettier-ignore
    return out;
  };
  const roomsOfKind = (kind, district) => {
    const out = [];
    for (const b of site.buildings) {
      const l = plan.layouts.get(b.id);
      if (!l?.storeyPlans?.length || (district !== "any" && (b.district ?? districtAt(...b.at)) !== district)) continue;
      for (const r of l.rooms.filter((q) => q.kind === kind)) {
        const list = [];
        l.storeyPlans[r.storey].cells.forEach((row, y) => row.forEach((v, x) => v === r.id && list.push([x, y])));
        const [x, y] = list[Math.floor(list.length / 2)];
        out.push([(b.at[0] + x + 0.5) * GRID, (b.at[1] + y + 0.5) * GRID, r.storey * STOREY + 96]);
      }
    }
    return out;
  };
  const gates = (site.walls ?? []).flatMap((w) => (w.gates ?? []).map((g) => [g[0] * GRID, g[1] * GRID]));
  const publicOf = (district, kinds) => {
    const out = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (isPublic(x, y) && (district === "global" || districtAt(x, y) === district) && (!kinds || kinds.includes(cells[y][x]))) out.push([x + 0.5, y + 0.5]); // prettier-ignore
    return out;
  };
  const used = new Map();
  for (const [n, s] of (dress.sounds ?? []).entries()) {
    if (s.where === "gate") {
      gates.slice(0, s.count).forEach(([x, y]) => soundAt(s, [x, y + (n % 2 ? 32 : -32), 96]));
      continue;
    }
    if (s.where === "alarm") {
      const avenue = publicOf("nexus", ["street"]);
      const [c] = spread(avenue, 1);
      if (c) soundAt(s, [c[0] * GRID, c[1] * GRID, 160], `${site.name}_alarm`);
      continue;
    }
    if (s.where.startsWith("room:")) {
      const k = s.where.slice(5);
      const list = roomsOfKind(k, s.district);
      const u = used.get(k) ?? 0;
      if (!list.length) skip(`sound ${s.file}: no ${k} in ${s.district}`);
      for (let i = 0; i < s.count && list.length; i++) soundAt(s, list[(u + i) % list.length]);
      used.set(k, u + s.count);
      continue;
    }
    const kinds = s.where === "square" ? ["square"] : s.where === "avenue" ? ["street"] : null;
    const district = s.district;
    const list = s.where === "avenue" ? publicOf(district, kinds).filter(([, y]) => y >= 24 && y <= 30) : publicOf(district, kinds); // prettier-ignore
    for (const c of spread(list, s.count)) soundAt(s, [c[0] * GRID, c[1] * GRID, 96]);
  }
  count("lane-checks", laneChecks);
  return { brushes, entities, report: { counts, skipped, failures, warnings } };
}

/** How far into a room, from a doorway's line, the lane's end is: where a player standing in the doorway steps to. */
const LANE_IN = 40;
/**
 * The rule a room's props keep: from the spot in front of each doorway (a player 48 across fits there) every other
 * doorway's spot is walked to by a player 32 across, over the room's floor (its cells, kept 8 off the outer walls)
 * and clear of the CLIP boxes of its props (those higher than a step: 18). Returns a sentence for each doorway a
 * prop blocks and each one the others cannot walk to. `cells` are the room's, as "x,y" keys; `clips` { lo, hi }.
 */
export function laneProblems(cells, doorPoints, clips, floor) {
  const out = [];
  const tall = clips.filter((c) => c.hi[2] - floor > 18 && c.lo[2] < floor + 72);
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
  const free = (x, y, half) => {
    for (const c of tall) if (x + half > c.lo[0] && x - half < c.hi[0] && y + half > c.lo[1] && y - half < c.hi[1]) return false;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) if (!inRoom(x + dx * half, y + dy * half)) return false;
    return true;
  };
  const STEP = 8;
  const snap = (v) => Math.round(v / STEP) * STEP;
  const spots = [];
  for (const d of doorPoints) {
    const p = [snap(d.at[0]), snap(d.at[1])];
    if (!free(p[0], p[1], 24)) {
      const hit = tall.find((c) => p[0] + 24 > c.lo[0] && p[0] - 24 < c.hi[0] && p[1] + 24 > c.lo[1] && p[1] - 24 < c.hi[1]);
      if (hit) out.push(`${d.label} has no lane 48 across in front of it: a prop's clip at ${hit.lo.map(Math.round)} to ${hit.hi.map(Math.round)} is in it`);
      continue; // a doorway whose spot is off the room's floor (a stair, a corner) is not this rule's
    }
    spots.push({ ...d, p });
  }
  if (spots.length < 2) return out;
  const seen = new Set([`${spots[0].p}`]);
  const todo = [spots[0].p];
  while (todo.length) {
    const [x, y] = todo.pop();
    for (const [dx, dy] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) {
      const n = [x + dx, y + dy];
      if (seen.has(`${n}`) || !free(n[0], n[1], 16)) continue;
      seen.add(`${n}`);
      todo.push(n);
    }
  }
  for (const d of spots.slice(1)) if (!seen.has(`${d.p}`)) out.push(`${d.label} cannot be walked to from ${spots[0].label} past the props' clips`);
  return out;
}

/** A room of a building's own cells, turned into the site's cells (its lookups shifted by the building's place). */
function shiftRoom(room, at) {
  const [ax, ay] = at;
  const to = (k) => {
    const [x, y] = k.split(",").map(Number);
    return key(x + ax, y + ay);
  };
  const back = (x, y) => [x - ax, y - ay];
  const cells = new Set([...room.cells].map(to));
  const blocked = new Set([...room.blocked].map(to));
  const reserved = new Set();
  const unwalk = new Set();
  const shifted = {
    cells,
    blocked,
    reserved,
    unwalk,
    floor: room.floor,
    sides: (x, y, d) => room.sides(...back(x, y), d),
    lamp: (x, y) => room.lamp(...back(x, y)),
  };
  shifted.connected = (extra) => {
    const free = [...cells].filter((k) => !unwalk.has(k) && !extra.includes(k));
    if (!free.length || extra.some((k) => blocked.has(k))) return false;
    const freeSet = new Set(free);
    const seen = new Set([free[0]]);
    const todo = [free[0]];
    while (todo.length) {
      const [x, y] = todo.pop().split(",").map(Number);
      for (const [dx, dy] of DIRS) {
        const n = key(x + dx, y + dy);
        if (freeSet.has(n) && !seen.has(n)) (seen.add(n), todo.push(n));
      }
    }
    return seen.size === free.length;
  };
  return shifted;
}
