// levels/assembly, the dressing of a site: what an assembled site is dressed with in its game, from a dress file
// (levels/assembly/dress/<name>.json, format smak-dress/1): accent glows on its roofs, gates and fronts, looped ambient
// sounds by district and room, and props (ts_model) in its rooms and along its streets, each big piece of furniture
// with a CLIP brush under it as H9's makers do. Every placement is on the plan's grid: a prop stands against a wall
// with its back to it, in cells of its room that no doorway, leaf's swing, stair or start needs, and never so that
// the cells of its room left free fall apart; a glow stands within 32 units of a surface. Rooms are dressed by kind, by district, by the one
// building (`byBuilding`: a pawn shop, a grocer) and, for a flat, by one of the kind's furniture `sets` its own dice choose (the building,
// the room, the seed); a model placed `island` stands free in the middle of a room (32 clear of the walls), one placed `rug` lies on the
// floor under the rest and takes none of it; a counter's back shelves are models of the shop's kind (`counters.shelfModels`). The dress file names only
// files the game has; nothing of the game's is in it.
//
//   dressSite(plan, built, dress, { seed })  ->  { brushes, entities, report: { counts, skipped, failures, warnings } }
//   loadDress(name)
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { box, pointEntity, brushEntity } from "../../src/maps/source.mjs";
import { sweptBy, cellsAcross } from "./layout.mjs";
import { entrancesOf } from "./layout.mjs";
import { PUBLIC } from "./site.mjs";
import { kowloonFacade, kowloonOf, kowloonProblems } from "./kowloon.mjs";
import { towerOf, towerLayout } from "./tower.mjs";
import { wallGround } from "./terrain.mjs";
import { placeCounter, COUNTER_RULE } from "./counter.mjs";
import { roofFootprints } from "./roofs.mjs";

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
/** A prop stands this far from a lamp post's footprint (the model's own box). */
const LAMP_CLEAR = 12;
/** The air a prop leaves between itself and a wall. */
const GAP = 2;
/** A free-standing piece (a table in the middle of a room) keeps this far from a cell's edge: the half wall and a player's 24 and more. */
const ISLAND_CLEAR = HALF_WALL + 28;
/** A rug lies this far over the floor: a unit under it z-fights. */
const RUG_LIFT = 0.3;
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
  const counters = [];
  const count = (k, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
  const skip = (k) => (skipped[k] = (skipped[k] ?? 0) + 1);
  const districtAt = (x, y) => plan.districts?.[y]?.[x] ?? null;
  // the ground (terrain.mjs): everything stands at the z of its cell, not at 0; a ramp's floor is sloped along its run, a stair's treads are steps
  const T = plan.terrain;
  const gz = (x, y) => T?.ground[y]?.[x] ?? 0;
  const gzw = (wx, wy) => gz(Math.floor(wx / GRID), Math.floor(wy / GRID));
  const slopeAt = (cx, cy) => T?.joinCell.get(`${cx},${cy}`) ?? null;
  /** The highest the floor is under a box [x0, y0, x1, y1] of the world (a ramp's high side: a prop sinks into the slope rather than hangs over it). */
  const floorUnder = (x0, y0, x1, y1) => {
    let z = -Infinity;
    for (const [wx, wy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      const [cx, cy] = [Math.floor(Math.min(Math.max(wx, x0 + 0.01), x1 - 0.01) / GRID), Math.floor(Math.min(Math.max(wy, y0 + 0.01), y1 - 0.01) / GRID)];
      const j = slopeAt(cx, cy);
      if (!j || j.join.kind !== "ramp") {
        z = Math.max(z, gz(cx, cy));
        continue;
      }
      const [dx, dy] = j.dir;
      const fx = Math.min(Math.max(wx / GRID - cx, 0), 1);
      const fy = Math.min(Math.max(wy / GRID - cy, 0), 1);
      const u = dx > 0 ? fx : dx < 0 ? 1 - fx : dy > 0 ? fy : 1 - fy;
      z = Math.max(z, j.low + (j.high - j.low) * u);
    }
    return z;
  };
  const isPublic = (x, y) => x >= 0 && y >= 0 && x < W && y < H && PUBLIC.has(cells[y][x]) && !plan.shapes?.partial.has(`${x},${y}`); // (a shaped area's cell its floor does not fill is no prop's)

  // the lamp posts' footprints ([x, y] corners), which a prop keeps its distance from (LAMP_CLEAR)
  const lampPosts = [];
  // every prop placed, for blockageProblems below: { id, file, mode, label, lo, hi, clip, floor, open } (lo, hi: its CLIP box when it has one, else its model's bounds)
  const propLog = [];
  const logProp = (id, mode, label, lo, hi, clip, floor) => propLog.push({ id, file: dress.models?.[id]?.file ?? id, mode, label, lo: lo.map((v) => Math.round(v * 10) / 10), hi: hi.map((v) => Math.round(v * 10) / 10), clip, floor, open: mode === "lamp" || label.startsWith("public") }); // prettier-ignore
  // ── the accents ──
  const A = dress.accents ?? {};
  let glows = 0;
  // (the dress file's `glows: false` places none: Xash draws an additive sprite as a saturated square and loses its colour; the lights stay)
  const glow = (r, at, i = glows, color) => {
    if (dress.glows === false) return;
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
        return { e, d, mid, outCell: [out[0] + b.at[0], out[1] + b.at[1]], gz: b.groundZ ?? 0 };
      });
  const outAt = (p, z, out = GLOW_OUT) => [p.mid[0] * GRID + p.d[0] * out, p.mid[1] * GRID + p.d[1] * out, z + p.gz];

  for (const b of site.buildings) {
    const l = plan.layouts.get(b.id);
    if (!l?.storeyPlans?.length) continue;
    const district = b.district ?? districtAt(...b.at);
    const per = perimeterOf(b, l);
    const top = (l.storeys + towerOf(b)) * STOREY + (b.groundZ ?? 0);
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
  // what the open floor keeps clear, known before the first post or prop: a way down's cells, the checkpoints', the doors' fronts, the starts, the
  // joins (ramps and stairs) and the footprints of the roofs' ways (the owner's walk of byz02, 2026-11-08: posts on stairs and roof ways, props on ramps and before doors)
  // the cells a way down to the level below keeps clear (its opening, the lid's slide, a step round it: below.mjs)
  const clear = new Set([...(built.report.below?.keepClear ?? []), ...(built.report.roofs?.keepClear ?? [])]); // (and where a roof's stair, crates or ladder stand: roofs.mjs)
  const spawnCells = new Set((built.report.spawns ?? []).map((s) => key(Math.floor(s.at[0]), Math.floor(s.at[1]))));
  // the checkpoints: amber at both jambs on both faces, a red stop-lamp over the middle
  const gateCells = new Set();
  if (A.gate)
    for (const w of site.walls ?? []) {
      const along = w.from[1] === w.to[1] ? 0 : 1;
      const wz = wallGround(T?.ground ?? null, w); // (the gate stands on the wall's highest ground: site.mjs)
      for (const g of w.gates ?? []) {
        for (let t = -2; t <= 1; t++)
          for (const s of [-1, 0]) gateCells.add(along === 0 ? key(g[0] + t, g[1] + s) : key(g[0] + s, g[1] + t));
        for (const side of [-1, 1]) {
          const at = (t, z) => (along === 0 ? [(g[0] + t) * GRID, g[1] * GRID + side * GLOW_OUT, z + wz] : [g[0] * GRID + side * GLOW_OUT, (g[1] + t) * GRID, z + wz]); // prettier-ignore
          const [ax, ay] = at(0, 0);
          if (ax < 0 || ay < 0 || ax > W * GRID || ay > H * GRID) continue; // (a gate in the site's edge wall has its street on one side only)
          glow(A.gate, at(-1, 160));
          glow(A.gate, at(1, 160));
          glow({ ...A.gate, ...A.gate.stop }, at(0, 200));
          lightBy(A.gate.light, at(0, 150).map((v, i) => (i === 1 - along ? v + side * 16 : v)));
        }
        count("gate-accents");
      }
    }

  // the public floor's off-limits cells: the doors' outsides, the landmark's, the gates', the starts', a way down's, and every ramp and stair cell
  const doorOut = new Set();
  for (const d of built.report.doorways ?? []) if (d.building != null) for (const [x, y] of outsideOf(d)) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) doorOut.add(key(x + dx, y + dy)); // prettier-ignore
  const landmarkCells = new Set();
  for (const a of site.areas ?? [])
    if (a.landmark)
      for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) landmarkCells.add(key(a.landmark[0] + dx, a.landmark[1] + dy)); // prettier-ignore
  const blockedPublic = new Set([...doorOut, ...landmarkCells, ...gateCells, ...clear, ...(T?.joinCell.keys() ?? [])]); // (a ramp's or stair's cell is no prop's)
  for (const k of spawnCells) {
    const [x, y] = k.split(",").map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) blockedPublic.add(key(x + dx, y + dy));
  }
  const doorsOf = (built.report.doorways ?? []).filter((d) => d.middle && d.into && d.along);

  const openObstacles = [];
  for (const j of site.joins ?? []) {
    if (j.kind !== "ramp" && j.kind !== "stair") continue;
    const zs = [];
    for (let y = j.from[1]; y < j.to[1]; y++) for (let x = j.from[0]; x < j.to[0]; x++) zs.push(gz(x, y));
    openObstacles.push({ for: "open", what: `the ${j.kind} "${j.name}"`, lo: [j.from[0] * GRID, j.from[1] * GRID, Math.min(...zs)], hi: [j.to[0] * GRID, j.to[1] * GRID, Math.max(...zs) + 72] });
  }
  for (const f of roofFootprints(plan)) openObstacles.push({ for: "open", what: `the roof ${f.kind} ${f.name}`, lo: f.lo, hi: f.hi });

  // the street light (the site's `streetLight`: { every, z, color, brightness: { district: i } }): a plain light over the open floor
  // on a lattice of `every` cells, so that streets read as lit and not as a dusk with nothing in it; a district with no brightness
  // gets none. Under a portico's roof the light hangs lower (`portico: { z, brightness: { district: n } }`, the gold lamps between the
  // columns); on no stair.
  /** Why a lamp post of footprint [x0, y0] to [x1, y1] may not stand there, or null: a way's clear cell, a ramp or stair, a blocked cell (all the cells the footprint touches), a door's front within a cell, or a stair, ramp or roof way within the margin. */
  const lampBlock = ([x0, y0], [x1, y1], floor) => {
    for (let gx = Math.floor(x0 / GRID); gx <= Math.floor((x1 - 0.01) / GRID); gx++)
      for (let gy = Math.floor(y0 / GRID); gy <= Math.floor((y1 - 0.01) / GRID); gy++) {
        const k = key(gx, gy);
        if (clear.has(k)) return "a cell a way down or a roof way keeps clear";
        if (T?.joinCell.has(k)) return "a ramp or stair";
        if (blockedPublic.has(k)) return "a blocked cell (a door's outside, the landmark, a gate, a start)";
      }
    for (const d of doorsOf) {
      const [lo, hi] = doorFrontBox(d, GRID);
      if (x0 < hi[0] && x1 > lo[0] && y0 < hi[1] && y1 > lo[1]) return "within a cell of a door's front";
    }
    const near = blockageProblems({ props: [{ id: "street_lamp", file: "a lamp post", mode: "lamp", lo: [x0, y0, floor], hi: [x1, y1, floor + 177], clip: true, floor, open: true }], obstacles: openObstacles, doors: doorsOf }).find((b) => b.kind !== "clip");
    return near ? "within the margin of a ramp, stair or roof way, or on a door's leaf or spot" : null;
  };
  const SL = site.streetLight;
  if (SL) {
    const E = SL.every ?? 4;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const kind = cells[y][x];
        if (x % E !== Math.floor(E / 2) || y % E !== Math.floor(E / 2) || !isPublic(x, y)) continue;
        const under = kind === "portico";
        if (!under && !["street", "plaza", "alley", "paving", "square"].includes(kind)) continue;
        const i = (under ? SL.portico?.brightness : SL.brightness)?.[districtAt(x, y)];
        if (!i) continue;
        const at = [(x + 0.5) * GRID, (y + 0.5) * GRID, gz(x, y) + (under ? SL.portico.z ?? 104 : SL.z ?? 136)];
        const rgbi = [...(SL.color ?? [255, 205, 140]), i];
        if (under || !SL.spot) {
          lightBy(rgbi, at);
          count(under ? "portico-light" : "street-light");
          continue;
        }
        // a lamp post (`streetLight.spot: { cone, cone2, fade }`): a studio model (the dress file's `street_lamp`: a turned foot and shaft, a
        // crook, a lantern 18 out along +x with its lamp at 130 over the floor) and a thin CLIP for the shaft; the lamp is the light_spot
        // pointing straight down in a cone (a pool of light with dim floor between pools), inside the lantern, off the shaft's axis
        const lampModel = dress.models?.street_lamp;
        const floor = at[2] - (SL.z ?? 136);
        // (off the cell's middle by 22 each way: the walking graph's nodes and links run through the middles, a post there would cut them)
        const [cx, cy] = [at[0] + 22, at[1] + 22];
        const why = lampBlock(lampModel ? [cx + lampModel.min[0], cy + lampModel.min[1]] : [cx - 14, cy - 14], lampModel ? [cx + lampModel.max[0], cy + lampModel.max[1]] : [cx + 14, cy + 14], floor);
        if (why) {
          count("street-lamp-skipped");
          skip(`street lamp: ${why}`);
          continue;
        }
        const top = floor + 144;
        if (lampModel) {
          entities.push(pointEntity("ts_model", [cx, cy, floor].map(Math.round), { model: lampModel.file, angles: [0, 0, 0], rendercolor: "0 0 0", ...(lampModel.keys ?? {}) })); // prettier-ignore
          brushes.push(box([cx - 5, cy - 5, floor], [cx + 5, cy + 5, floor + lampModel.max[2]], "CLIP"));
          logProp("street_lamp", "lamp", "street light", [cx - 5, cy - 5, floor], [cx + 5, cy + 5, floor + lampModel.max[2]], true, floor);
          lampPosts.push({ lo: [cx + lampModel.min[0], cy + lampModel.min[1]], hi: [cx + lampModel.max[0], cy + lampModel.max[1]] });
        } else {
          const F = SL.fixture ?? {};
          const post = box([cx - 3, cy - 3, floor], [cx + 3, cy + 3, top - 12], F.post ?? "pv_genmtlgrey");
          const head = box([cx - 14, cy - 14, top - 12], [cx + 14, cy + 14, top - 4], F.head ?? "metal2");
          entities.push(brushEntity("func_detail", [post, head], { zhlt_detaillevel: 1 }));
          lampPosts.push({ lo: [cx - 14, cy - 14], hi: [cx + 14, cy + 14] });
        }
        const lampX = lampModel ? cx + 18 : cx + 10;
        entities.push(pointEntity("light_spot", [lampX, cy, top - 14].map(Math.round), { _light: rgbi.join(" "), pitch: -90, _cone: SL.spot.cone ?? 35, _cone2: SL.spot.cone2 ?? 70, _fade: SL.spot.fade ?? 1 })); // prettier-ignore
        if (A.streetLamp) glow(A.streetLamp, [lampX, cy, top - 16]);
        count("street-light");
        count("street-lamp-post");
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
      glow(A.backdrop, [mid[0] * GRID + inward[0] * GLOW_OUT, mid[1] * GRID + inward[1] * GLOW_OUT, tops + gz(x, y)]);
    }
  }

  // ── the Kowloon facades: the buildings that ask for them (spec `kowloon`, or their district in the dress file) ──
  for (const b of site.buildings) {
    const l = plan.layouts.get(b.id);
    const k = l?.storeyPlans?.length ? kowloonOf(b, b.district ?? districtAt(...b.at), dress.kowloon) : null;
    if (!k) continue;
    const clearOf = ([x, y], [dx, dy]) => {
      let n = 0;
      while (isPublic(x + dx * n, y + dy * n)) n++;
      return n * GRID;
    };
    const made = kowloonFacade({ ...b, base: [b.at[0] * GRID, b.at[1] * GRID, b.groundZ ?? 0] }, towerLayout(b, l), { ...k, palette: dress.kowloon, clearOf });
    // func_detail by default: the compiler folds it into the world (no entity in the .bsp) but its faces cut no leaves
    // (as world brush the block's 200 took hlvis past 900 s); `kowloon.brushes: "world"` in the dress file keeps them world
    if (dress.kowloon.brushes === "world") brushes.push(...made.brushes);
    else if (made.brushes.length) entities.push(brushEntity("func_detail", made.brushes, { zhlt_detaillevel: dress.kowloon.detaillevel ?? 1 }));
    for (const [kind, n] of Object.entries(made.report.counts)) count(`kowloon:${kind}`, n);
    count("kowloon-brush", made.brushes.length);
    failures.push(...kowloonProblems(made.items, made.openings).map((p) => `kowloon ${b.id}: ${p}`));
  }

  // ── the props ──
  const models = dress.models ?? {};
  const unclipped = dressClipProblems(models);
  if (unclipped) failures.push(unclipped);
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
  /** Whether a prop about to be placed would be found by blockageProblems: a door's front, leaf or spot (a room's), and with the open floor's also a ramp, stair or roof way. */
  const blocksWay = (prop) => blockageProblems({ props: [prop], obstacles: openObstacles, doors: doorsOf }).some((b) => b.kind !== "clip");
  const place = (id, room, label) => {
    const m = models[id];
    if (!m) return (failures.push(`the dress names a model ${id} it has no entry for`), false);
    if (m.place === "on") return (skip(`${label}: on a table (${id})`), false);
    if (room.open && (m.place === "hung" || m.place === "ceiling")) return (skip(`${label}: nothing hangs in the open (${id})`), false);
    if (m.place === "rug") return placeRug(id, room, label);
    if (m.place === "island" && !room.open && placeIsland(id, room, label)) return true; // (else it stands against a wall like the rest)
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
      // (a public floor of a varied site: the floor under the box, a ramp's high side; the rooms' is their storey's)
      const floor = room.floorUnder ? room.floorUnder(ox + t.min[0], oy + t.min[1], ox + t.max[0], oy + t.max[1]) : room.floor;
      let oz = floor - m.min[2];
      if (hung) oz = floor + PICTURE;
      if (ceiling) oz = floor + CEILING - m.max[2];
      const lo = [ox + t.min[0], oy + t.min[1], oz + m.min[2]];
      const hi = [ox + t.max[0], oy + t.max[1], oz + m.max[2]];
      if (hi[2] > floor + (room.top ?? CEILING - 1)) continue;
      if (!hung && !ceiling && lampPosts.some((q) => lo[0] < q.hi[0] + LAMP_CLEAR && hi[0] > q.lo[0] - LAMP_CLEAR && lo[1] < q.hi[1] + LAMP_CLEAR && hi[1] > q.lo[1] - LAMP_CLEAR)) continue; // (never over a lamp post)
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
      // the open floor: no ramp, stair or roof way within the margin, nothing in a door's front, its leaf or on its spots (what blockageProblems measures afterwards)
      if (blocksWay({ id, file: m.file, mode: hung ? "hung" : ceiling ? "ceiling" : "wall", lo, hi, clip: Boolean(m.clip), floor, open: Boolean(room.open) })) continue;
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
      logProp(id, hung ? "hung" : ceiling ? "ceiling" : "wall", label, solid ? [Math.floor(lo[0]), Math.floor(lo[1]), floor] : lo, solid ? [Math.ceil(hi[0]), Math.ceil(hi[1]), Math.ceil(Math.max(hi[2], floor + 16))] : hi, Boolean(solid), floor); // prettier-ignore
      count("prop");
      count(`prop:${label}`);
      return true;
    }
    skip(`${label}: no room for ${id}`);
    return false;
  };
  /**
   * The spots a piece can be put down on in a room's floor, away from the walls: on a 16-unit grid across its cells, turned
   * 0 and 90 degrees. `ok(lo, hi, covered)` says whether one fits; each is { ox, oy, yaw, t, lo, hi, covered, d } (d: how far
   * from the room's middle), nearest first.
   */
  const floorSpots = (m, room, ok, wallClear) => {
    const cellList = [...room.cells].map((k) => k.split(",").map(Number));
    const mid = [cellList.reduce((a, c) => a + c[0] + 0.5, 0) / cellList.length * GRID, cellList.reduce((a, c) => a + c[1] + 0.5, 0) / cellList.length * GRID]; // prettier-ignore
    const spots = [];
    for (const [cx, cy] of cellList)
      for (let u = 0; u < GRID; u += 16)
        for (let v = 0; v < GRID; v += 16)
          for (const yaw of [0, 90]) {
            const [ox, oy] = [cx * GRID + u + 8, cy * GRID + v + 8];
            const t = turned(m.min, m.max, yaw);
            const lo = [ox + t.min[0], oy + t.min[1]];
            const hi = [ox + t.max[0], oy + t.max[1]];
            const covered = [];
            for (let gx = Math.floor((lo[0] + 1) / GRID); gx <= Math.floor((hi[0] - 1) / GRID); gx++)
              for (let gy = Math.floor((lo[1] + 1) / GRID); gy <= Math.floor((hi[1] - 1) / GRID); gy++) covered.push([gx, gy]);
            let fits = covered.length > 0;
            for (const [gx, gy] of covered) {
              if (!room.cells.has(key(gx, gy))) fits = false;
              if (!fits) break;
              for (const d of DIRS) {
                if (room.cells.has(key(gx + d[0], gy + d[1]))) continue;
                const bound = d[0] ? (gx + (d[0] > 0 ? 1 : 0)) * GRID - d[0] * wallClear : (gy + (d[1] > 0 ? 1 : 0)) * GRID - d[1] * wallClear;
                const reach = d[0] > 0 ? hi[0] : d[0] < 0 ? lo[0] : d[1] > 0 ? hi[1] : lo[1];
                if ((d[0] || d[1]) > 0 ? reach > bound + 0.01 : reach < bound - 0.01) fits = false;
              }
              if (!fits) break;
            }
            if (!fits || !ok({ lo, hi, covered })) continue;
            spots.push({ ox, oy, yaw, t, lo, hi, covered, d: Math.hypot(ox - mid[0], oy - mid[1]) + rnd() * 20 });
          }
    return spots.sort((a, b) => a.d - b.d);
  };
  /** A table or the like standing free in the middle of a room: 32 clear of every wall, no doorway's cell, the room kept in one piece. */
  const placeIsland = (id, room, label) => {
    const m = models[id];
    const floor0 = room.floor;
    const oz = floor0 - m.min[2];
    if (m.max[2] + oz > floor0 + (room.top ?? CEILING - 1)) return false;
    const free = (cells) => cells.every(([gx, gy]) => !room.blocked.has(key(gx, gy)) && !room.reserved.has(key(gx, gy)) && !(room.lamp(gx, gy) === "ceiling" && m.max[2] + oz > floor0 + UNDER_LAMP));
    const onWay = ({ lo, hi }) => blocksWay({ id, file: m.file, mode: "island", lo: [lo[0], lo[1], oz + m.min[2]], hi: [hi[0], hi[1], oz + m.max[2]], clip: Boolean(m.clip), floor: floor0, open: false });
    for (const sp of floorSpots(m, room, (spot) => free(spot.covered) && !onWay(spot), ISLAND_CLEAR)) {
      const takes = sp.covered.map(([gx, gy]) => key(gx, gy));
      const near = [];
      for (const k of room.cells) {
        const [gx, gy] = k.split(",").map(Number);
        const [px, py] = [(gx + 0.5) * GRID, (gy + 0.5) * GRID];
        if (px > sp.lo[0] - HULL && px < sp.hi[0] + HULL && py > sp.lo[1] - HULL && py < sp.hi[1] + HULL && !takes.includes(k)) near.push(k);
      }
      if (m.clip && !room.connected([...takes, ...near])) continue;
      if (m.clip) for (const k of [...takes, ...near]) room.unwalk.add(k);
      for (const k of takes) room.reserved.add(k);
      entities.push(pointEntity("ts_model", [sp.ox, sp.oy, oz].map((v) => Math.round(v)), { model: m.file, angles: [0, sp.yaw, 0], rendercolor: "0 0 0", ...(m.keys ?? {}) })); // prettier-ignore
      if (m.clip) {
        const [lo, hi] = [[Math.floor(sp.lo[0]), Math.floor(sp.lo[1]), floor0], [Math.ceil(sp.hi[0]), Math.ceil(sp.hi[1]), Math.ceil(Math.max(m.max[2] + oz, floor0 + 16))]];
        clipLog.push({ lo, hi });
        brushes.push(box(lo, hi, "CLIP"));
        count("prop-clip");
      }
      logProp(id, "island", label, m.clip ? [Math.floor(sp.lo[0]), Math.floor(sp.lo[1]), floor0] : [sp.lo[0], sp.lo[1], oz + m.min[2]], m.clip ? [Math.ceil(sp.hi[0]), Math.ceil(sp.hi[1]), Math.ceil(Math.max(m.max[2] + oz, floor0 + 16))] : [sp.hi[0], sp.hi[1], oz + m.max[2]], Boolean(m.clip), floor0); // prettier-ignore
      count("prop");
      count(`prop:${label}`);
      count("prop-island");
      return true;
    }
    return false;
  };
  /** A rug on the floor of a room, near its middle, in cells no doorway, leaf's swing or other piece has: it takes no floor (a bed stands on it) and no clip. */
  const placeRug = (id, room, label) => {
    const m = models[id];
    const free = (cells) => cells.every(([gx, gy]) => !room.blocked.has(key(gx, gy)) && !room.reserved.has(key(gx, gy)));
    const spots = floorSpots(m, room, ({ covered }) => free(covered), HALF_WALL + 6);
    if (!spots.length) return (skip(`${label}: no room for ${id}`), false);
    const sp = spots[0];
    entities.push(pointEntity("ts_model", [sp.ox, sp.oy, room.floor + RUG_LIFT - m.min[2]].map((v) => Math.round(v * 10) / 10), { model: m.file, angles: [0, sp.yaw, 0], rendercolor: "0 0 0", ...(m.keys ?? {}) })); // prettier-ignore
    logProp(id, "rug", label, [sp.lo[0], sp.lo[1], room.floor], [sp.hi[0], sp.hi[1], room.floor + RUG_LIFT + m.max[2] - m.min[2]], false, room.floor);
    count("prop");
    count(`prop:${label}`);
    count("prop-rug");
    return true;
  };
  /** A stable number from a string: a room's own dice, so what a flat holds does not depend on the order the rooms are dressed in. */
  const hashOf = (text) => {
    let h = 2166136261;
    for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
  };
  // the rooms
  let laneChecks = 0;
  for (const b of site.buildings) {
    const l = plan.layouts.get(b.id);
    if (!l?.storeyPlans?.length) continue;
    const district = b.district ?? districtAt(...b.at);
    const ways = [...(l.doors ?? []), ...entrancesOf(l).map((e) => ({ ...e, storey: e.storey ?? 0 }))];
    const entranceEdges = new Set(entrancesOf(l).flatMap((e) => e.edges.map(edgeKey)));
    for (const r of l.rooms) {
      const list = dress.rooms?.[r.kind];
      const counterOn = dress.counters?.kinds?.includes(r.kind);
      if (!list && !counterOn) continue;
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
        floor: r.storey * STOREY + (b.groundZ ?? 0),
        lamp: (x, y) => lampCells.get(`${b.id}|${r.storey}|${key(x, y)}`) ?? null,
      };
      // world cells: the room's cells are the building's; shift once to the site
      const shifted = shiftRoom(room, b.at);
      for (const k of clear) if (shifted.cells.has(k)) shifted.blocked.add(k);
      // the counter of a shop, bar or clinic, and the keeper's post behind it (counter.mjs): first, so the props go round it
      let counterClip = null;
      if (counterOn) {
        const floorZ = r.storey * STOREY + (b.groundZ ?? 0);
        const doors = [];
        for (const w of ways.filter((q) => q.storey === r.storey))
          for (const e of w.edges.slice(0, 1)) {
            const horizontal = e.from[1] === e.to[1];
            const [ex, ey] = [Math.min(e.from[0], e.to[0]), Math.min(e.from[1], e.to[1])];
            const sides = horizontal ? [{ cell: [ex, ey - 1], n: [0, -1] }, { cell: [ex, ey], n: [0, 1] }] : [{ cell: [ex - 1, ey], n: [-1, 0] }, { cell: [ex, ey], n: [1, 0] }]; // prettier-ignore
            const inside = sides.find((q) => inRoom(...q.cell));
            if (!inside) continue;
            const mid = horizontal ? [(ex + 0.5 + b.at[0]) * GRID, (ey + b.at[1]) * GRID] : [(ex + b.at[0]) * GRID, (ey + 0.5 + b.at[1]) * GRID];
            doors.push({ mid, at: [mid[0] + inside.n[0] * LANE_IN, mid[1] + inside.n[1] * LANE_IN], entrance: entranceEdges.has(edgeKey(e)) });
          }
        const got = placeCounter({ cells: shifted.cells, doors, blocked: shifted.blocked, rule: { ...COUNTER_RULE, ...(dress.counters.rule ?? {}) } });
        const C = dress.counters;
        if (got.why) failures.push(`building ${b.id}, ${r.kind}: no counter: ${got.why}`);
        else {
          const [lx, ly] = got.counter.lo;
          const [hx, hy] = got.counter.hi;
          const sides = C.sides?.[district] ?? C.sides?.default ?? "cd_woodwall";
          const topTex = C.top?.[district] ?? C.top?.default ?? "cd_mrbblack";
          const h = C.height ?? COUNTER_RULE.height;
          const parts = [box([lx, ly, floorZ], [hx, hy, floorZ + h], { top: topTex, bottom: sides, sides })];
          // a shelf or two on the wall behind the keeper, when the wall is near enough (12 deep: the post keeps 20 clear of it)
          const back = [-got.dir[0], -got.dir[1]];
          const faceT = got.back; // the wall's inner face behind the post, from it
          // shelves on a blind wall; on a wall with a window along them (the board would hang in the glass) a low cabinet under its sill
          const across = [-got.dir[1], got.dir[0]];
          const windowed = [-48, 0, 48].some((t) => {
            const wx = got.post[0] + back[0] * (faceT + 4) + across[0] * t;
            const wy = got.post[1] + back[1] * (faceT + 4) + across[1] * t;
            return shifted.sides(Math.floor((wx - back[0] * 8) / GRID), Math.floor((wy - back[1] * 8) / GRID), back) === "window";
          });
          const [cx, cy] = [got.post[0] + back[0] * faceT, got.post[1] + back[1] * faceT]; // (the wall's face on the post's line)
          const slab = (len, z0, z1, depth) => {
            const p0 = [cx - across[0] * (len / 2), cy - across[1] * (len / 2)];
            const p1 = [cx + across[0] * (len / 2) + got.dir[0] * depth, cy + across[1] * (len / 2) + got.dir[1] * depth];
            return box([Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), floorZ + z0], [Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1]), floorZ + z1], { top: topTex, bottom: sides, sides }); // prettier-ignore
          };
          const shelves = [];
          let shelfModel = null;
          if (C.shelf !== false && faceT >= 32 && faceT <= 128) {
            const SM = C.shelfModels;
            shelfModel = SM ? (windowed ? SM.low : (SM.byBuilding?.[b.id] ?? SM.byKind?.[r.kind] ?? SM.default)) ?? null : null;
            if (shelfModel && !models[shelfModel]) (failures.push(`the dress names a shelf model ${shelfModel} it has no entry for`), (shelfModel = null));
            if (shelfModel) {
              // two units side by side along the wall behind the keeper, goods turned to the room; a CLIP brush so nobody walks into them
              const sm = models[shelfModel];
              const unit = sm.max[1] - sm.min[1];
              for (const t of [-0.5, 0.5]) {
                const at = [cx + across[0] * t * unit + got.dir[0] * GAP, cy + across[1] * t * unit + got.dir[1] * GAP];
                entities.push(pointEntity("ts_model", [at[0], at[1], floorZ].map((v) => Math.round(v)), { model: sm.file, angles: [0, yawOf(got.dir), 0], rendercolor: "0 0 0", ...(sm.keys ?? {}) })); // prettier-ignore
                count("counter-shelf-model");
              }
              const [p0, p1] = [[cx - across[0] * unit, cy - across[1] * unit], [cx + across[0] * unit + got.dir[0] * 13, cy + across[1] * unit + got.dir[1] * 13]];
              brushes.push(box([Math.floor(Math.min(p0[0], p1[0])), Math.floor(Math.min(p0[1], p1[1])), floorZ], [Math.ceil(Math.max(p0[0], p1[0])), Math.ceil(Math.max(p0[1], p1[1])), floorZ + Math.ceil(sm.max[2])], "CLIP")); // prettier-ignore
              count("prop-clip");
              logProp(shelfModel, "shelf", r.kind, [Math.floor(Math.min(p0[0], p1[0])), Math.floor(Math.min(p0[1], p1[1])), floorZ], [Math.ceil(Math.max(p0[0], p1[0])), Math.ceil(Math.max(p0[1], p1[1])), floorZ + Math.ceil(sm.max[2])], true, floorZ); // prettier-ignore
            } else if (windowed) shelves.push(slab(96, 0, 34, 12));
            else for (const z of C.shelfZ ?? [56, 92]) shelves.push(slab(96, z, z + 6, 12));
          }
          entities.push(brushEntity("func_detail", [...parts, ...shelves], { zhlt_detaillevel: 1 }));
          count("counter");
          if (shelves.length) count("counter-shelves", shelves.length);
          // clips for the lane rule below (the counter is a solid), and the cells the props go round
          counterClip = { lo: [lx, ly, floorZ], hi: [hx, hy, floorZ + h] };
          const keep = [got.counter.lo, got.counter.hi];
          const rect = (x0, y0, x1, y1) => {
            for (let gx = Math.floor(x0 / GRID); gx <= Math.floor((x1 - 0.01) / GRID); gx++)
              for (let gy = Math.floor(y0 / GRID); gy <= Math.floor((y1 - 0.01) / GRID); gy++) shifted.reserved.add(key(gx, gy));
          };
          rect(keep[0][0], keep[0][1], keep[1][0], keep[1][1]);
          rect(got.post[0] - 32, got.post[1] - 32, got.post[0] + 32, got.post[1] + 32);
          rect(got.front[0] - 40, got.front[1] - 40, got.front[0] + 40, got.front[1] + 40);
          for (const q of got.pass) rect(q[0] - 24, q[1] - 24, q[0] + 24, q[1] + 24); // (and the way round the counter's open end)
          counters.push({
            building: b.id,
            room: r.id,
            place: `${b.id}_${r.id}`,
            kind: r.kind,
            counter: { lo: [lx, ly, floorZ], hi: [hx, hy, floorZ + h] },
            post: [got.post[0], got.post[1], floorZ],
            front: [got.front[0], got.front[1], floorZ],
            pass: got.pass.map((q) => [q[0], q[1], floorZ]),
            yaw: got.yaw,
            doorClear: got.doorClear,
            clear: got.clear,
            frontFree: got.frontFree,
            shelves: shelves.length,
            ...(shelfModel ? { shelfModel } : {}),
          });
          if (got.doorClear < COUNTER_RULE.doorClears[0]) warnings.push(`building ${b.id}, ${r.kind}: the keeper's post is ${got.doorClear} units from a doorway (the room is too small for ${COUNTER_RULE.doorClears[0]})`);
        }
      }
      // what the room holds: its kind's base, its district's, the one building's own (`byBuilding`: a pawn shop is not a grocer's), and one of
      // the kind's furniture `sets` chosen by the room's own dice (the building and room, and the seed), so no two flats read the same
      let entries = [...(list?.base ?? []), ...(list?.variants?.[district] ?? []), ...(list?.byBuilding?.[b.id] ?? [])];
      const sets = (list?.sets ?? []).filter((q) => !q.districts || q.districts.includes(district));
      if (sets.length) {
        const chosen = sets[Math.floor(random(hashOf(`${b.id}|${r.id}|${seed}`))() * sets.length)];
        entries.push(...chosen.items);
        count(`set:${r.kind}:${chosen.name}`);
      }
      // the rug first (it lies under the rest), then the pieces that stand free (they need the middle), then those against walls
      const rank = (e) => (models[e.id]?.place === "rug" ? 0 : models[e.id]?.place === "island" ? 1 : 2);
      entries = entries.map((e, i) => [e, i]).sort((p, q) => rank(p[0]) - rank(q[0]) || p[1] - q[1]).map((p) => p[0]);
      const first = clipLog.length;
      if (counterClip) clipLog.push({ lo: counterClip.lo, hi: counterClip.hi });
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
      for (const why of laneProblems(shifted.cells, doorPoints, clips, r.storey * STOREY + (b.groundZ ?? 0))) failures.push(`building ${b.id}, ${r.kind} (storey ${r.storey}): ${why}`);
    }
  }

  // the public floor: along the buildings' walls and the site's ends, out of the doorways, the starts and the gates
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
      // a varied site: a prop stands on one height, so a zone is a height too (a ramp's cells a zone of their own: the floor is sloped); a stair's treads are no prop's
      if (cells[y][x] === "stair") continue;
      const z = `${districtAt(x, y)}|${zoneOf(x, y)}${T?.varied ? `|${cells[y][x] === "ramp" ? "ramp" : gz(x, y)}` : ""}`;
      if (!zones.has(z)) zones.set(z, new Set());
      zones.get(z).add(key(x, y));
    }
  const allPublic = new Set();
  for (const set of zones.values()) for (const k of set) allPublic.add(k);
  const reservedPublic = new Set();
  for (const [z, set] of zones) {
    const [district, kind, level] = z.split("|");
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
      floor: level === undefined ? 0 : level === "ramp" ? 0 : Number(level),
      ...(level === "ramp" ? { floorUnder } : {}),
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
    logProp(p.id, "below", "below", [o[0] + t.min[0], o[1] + t.min[1], floor], [o[0] + t.max[0], o[1] + t.max[1], floor + Math.max(m.max[2] - m.min[2], m.clip ? 16 : 0)], Boolean(m.clip), floor); // prettier-ignore
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
        out.push([(b.at[0] + x + 0.5) * GRID, (b.at[1] + y + 0.5) * GRID, r.storey * STOREY + 96 + (b.groundZ ?? 0)]);
      }
    }
    return out;
  };
  const gates = (site.walls ?? []).flatMap((w) => (w.gates ?? []).map((g) => [g[0] * GRID, g[1] * GRID, wallGround(T?.ground ?? null, w)]));
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
      // (a side of the gate that is outside the site is not used: a gate in the site's edge wall has the street on one side only)
      gates.slice(0, s.count).forEach(([x, y, z]) => {
        const toward = n % 2 ? 32 : -32;
        soundAt(s, [x, y + (y + toward > H * GRID || y + toward < 0 ? -toward : toward), 96 + z]);
      });
      continue;
    }
    if (s.where === "alarm") {
      const avenue = publicOf("nexus", ["street"]);
      const [c] = spread(avenue, 1);
      if (c) soundAt(s, [c[0] * GRID, c[1] * GRID, 160 + gzw(c[0] * GRID, c[1] * GRID)], `${site.name}_alarm`);
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
    for (const c of spread(list, s.count)) soundAt(s, [c[0] * GRID, c[1] * GRID, 96 + gzw(c[0] * GRID, c[1] * GRID)]);
  }
  count("lane-checks", laneChecks);

  // ── what the props block: a stair or ramp, a roof way, a door's front; and the solid ones with no CLIP (blockageProblems) ──
  const obstacles = [...openObstacles];
  for (const b of site.buildings) {
    const l = plan.layouts.get(b.id);
    (l?.storeyPlans ?? []).forEach((sp, st) =>
      sp.cells.forEach((row, y) =>
        row.forEach((v, x) => {
          if (v !== "stair") return;
          const z0 = st * STOREY + (b.groundZ ?? 0);
          obstacles.push({ for: "room", margin: 0, what: `the stair of building ${b.id} (storey ${st}) at cell ${b.at[0] + x},${b.at[1] + y}`, lo: [(b.at[0] + x) * GRID, (b.at[1] + y) * GRID, z0], hi: [(b.at[0] + x + 1) * GRID, (b.at[1] + y + 1) * GRID, z0 + STOREY] });
        }),
      ),
    );
  }
  const blocked = blockageProblems({ props: propLog, obstacles, doors: doorsOf });
  for (const b of blocked) failures.push(b.say);
  count("blockage-stair", blocked.filter((b) => b.kind === "stair").length);
  count("blockage-door", blocked.filter((b) => b.kind === "door").length);
  count("prop-no-clip", blocked.filter((b) => b.kind === "clip").reduce((n, b) => n + b.count, 0));
  return { brushes, entities, report: { counts, skipped, failures, warnings, counters, props: propLog, blockage: blocked } };
}

/** A prop keeps this far off the footprint of a stair, a ramp or a roof way: a player's hull (16 each side) to go round it. */
export const BLOCK_MARGIN = 16;
/** The door's front, each side of its line: the spots stand 48 off it (assemble.mjs TELE_SPOT_OFFSET) and a player is 16 to a side. */
export const DOOR_FRONT = 48 + 16;
/** A doorway's front as a box [lo, hi] of x and y: its opening and a hull each side, DOOR_FRONT across, and `extra` more all round. */
export const doorFrontBox = (d, extra = 0) => [0, 1].map((s) => [0, 1].map((k) => d.middle[k] + (s ? 1 : -1) * (Math.abs(d.along[k]) * (GRID / 2 + 16) + Math.abs(d.into[k]) * DOOR_FRONT + extra)));
/** A prop within this of a door's spot (a player's 16 and as much again) is on it. */
export const DOOR_SPOT_CLEAR = 32;
/** What a player steps over (the engine's 18), and what he bumps into up to his head (72): a prop without a CLIP is walked through above the one and below the other. */
const STEPS = 18;
const HEAD = 72;
/** The modes of prop that take no CLIP by their nature: a rug lies on the floor, a picture hangs on a wall (96 up), a lantern hangs from the ceiling. */
const NO_BODY = new Set(["rug", "hung", "ceiling"]);
/**
 * What the dressing's props block, and what they leave a player to walk through. `props`: [{ id, file, mode, lo, hi, clip, floor }] (the CLIP box when
 * it has one, else the model's bounds); `obstacles`: [{ what, lo, hi }] (x, y and, when given, z: a stair or ramp, a roof's ladder, stair, crates, plank or
 * bridge); `doors`: the site's doorways ({ name, targetname, middle, into, along, floor, leaf, spots }). Returns [{ kind, say, count? }]:
 *   "stair"  a prop within BLOCK_MARGIN of an obstacle's footprint;
 *   "door"   a prop in a door's front (its opening and a hull each side, DOOR_FRONT across), in its open leaf's swing, or on one of its spots;
 *   "clip"   the props a player walks into that have no CLIP, but a rug, a picture or a lantern: one sentence with the count and the first ten.
 */
export function blockageProblems({ props, obstacles = [], doors = [], margin = BLOCK_MARGIN }) {
  const out = [];
  const at = (p) => `${p.id} (${p.file}) at ${p.lo.map(Math.round)} to ${p.hi.map(Math.round)}`;
  // a thing a player meets: any with a CLIP, else a model he cannot step over (over 18) and bumps at his height (under 72)
  const meets = (p) => !NO_BODY.has(p.mode) && (p.clip || (p.hi[2] - p.floor > STEPS && p.lo[2] < p.floor + HEAD));
  const over = (p, lo, hi, m) => p.lo[0] < hi[0] + m && p.hi[0] > lo[0] - m && p.lo[1] < hi[1] + m && p.hi[1] > lo[1] - m && (lo[2] == null || (p.lo[2] < hi[2] && p.hi[2] > lo[2])); // prettier-ignore
  for (const p of props) {
    if (!meets(p)) continue;
    for (const o of obstacles) if (Boolean(p.open) === (o.for === "open") && over(p, o.lo, o.hi, o.margin ?? margin)) out.push({ kind: "stair", say: `prop ${at(p)} stands in ${o.what} (within ${o.margin ?? margin} of its footprint ${o.lo.slice(0, 2).map(Math.round)} to ${o.hi.slice(0, 2).map(Math.round)}): it blocks it` });
    for (const d of doors) {
      const [lo, hi] = doorFrontBox(d);
      const z = [d.floor ?? d.middle[2] ?? 0, (d.floor ?? 0) + HEAD];
      if (p.lo[2] >= z[1] || p.hi[2] <= z[0]) continue;
      const name = `the door ${d.targetname ?? d.name}${d.spots ? ` (${d.spots.n})` : ""} at ${d.middle.map(Math.round)}`;
      let why = null;
      if (over(p, lo, hi, 0)) why = `stands in the front of ${name} (${DOOR_FRONT} each side of its line)`;
      else if (d.leaf && over(p, d.leaf[0], d.leaf[1], 0)) why = `stands in the open leaf of ${name}`;
      else for (const sp of d.spots ? [d.spots.a, d.spots.b] : []) if (over(p, [sp.at[0], sp.at[1]], [sp.at[0], sp.at[1]], DOOR_SPOT_CLEAR)) why = `stands on ${sp.name}, a spot of ${name}`;
      if (why) out.push({ kind: "door", say: `prop ${at(p)} ${why}: it blocks the door` });
    }
  }
  const bare = props.filter((p) => !p.clip && meets(p));
  if (bare.length)
    out.push({
      kind: "clip",
      count: bare.length,
      say: `${bare.length} prop${bare.length === 1 ? "" : "s"} a player walks into (over ${STEPS} high, not a rug, a picture or a lantern) ${bare.length === 1 ? "has" : "have"} no CLIP brush; the first ${Math.min(10, bare.length)}: ${bare.slice(0, 10).map((p) => `${p.id} (${p.file}) at ${p.lo.map(Math.round)}, ${Math.round(p.hi[2] - p.floor)} high`).join("; ")} (a player walks through a studio model: owner's walk of byz02, 2026-11-08)`,
    });
  return out;
}

/** Where a model stands on a floor a player walks: not on a table, hung, on the ceiling or a rug lying flat; the street lamp has its own thin CLIP (dressSite's lamp loop). */
const NOT_STANDING = new Set(["on", "hung", "ceiling", "rug", "street"]);
/**
 * The dress file's models a player walks through: each that stands on a floor and is over a step high (STEPS, the engine's 18) must say
 * `clip: true`. One sentence with the count and the first ten ids, or null. The limit's source is the owner's walk of byz02.
 */
export function dressClipProblems(models) {
  const bare = Object.entries(models).filter(([, m]) => !NOT_STANDING.has(m.place) && m.max[2] - m.min[2] > STEPS && !m.clip).map(([id]) => id);
  if (!bare.length) return null;
  return `${bare.length} dress model${bare.length === 1 ? "" : "s"} over ${STEPS} high that stand on a floor ha${bare.length === 1 ? "s" : "ve"} no clip: true (the first ${Math.min(10, bare.length)}: ${bare.slice(0, 10).join(", ")}); the limit is ${STEPS} units, a step the engine lets a player climb; a player walks through a studio model, and H9's own maps put a CLIP brush under every prop a player can reach: owner's walk of byz02, 2026-11-08`;
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
