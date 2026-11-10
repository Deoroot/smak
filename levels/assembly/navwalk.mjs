// Part N of levels/assembly: a second walk test, on a navmesh (Recast & Detour, the npm package
// `recast-navigation`), that shares no walking code with SMAK's own (`reachOf`, src/maps/reach.mjs). A floating
// step shows as an island of its own, and a room no way reaches as a target on another island, found by a method
// that is not SMAK's.
//
//   navWalk(bsp, { from, targets, agent, doors, islands, minIsland }) -> Promise<report>
//   navAvailable()                                                  -> Promise<boolean>
//
// THE GEOMETRY. The world's collision shape, as closed solids, not its drawn faces: every solid (and sky) leaf of
// the drawn tree (hull 0) rebuilt as the convex region its planes cut out (src/mapbrushes.mjs,
// brushesOfTree); the CLIP brushes rebuilt from hulls 1 and 3 (clipBrushesOf); and each brush entity that stops a
// player (func_wall, func_breakable, a door when `doors: "closed"` ...) from its standing hull (entityBrushesOf),
// moved to its origin. Water, slime and lava are not solid: the floor under them is walked. Illusionary and
// trigger entities, func_ladder, and a func_wall_toggle that starts off are left out. Doors are left out with
// `doors: "open"` (the default, as `reachOf` walks): a door open is taken as a door gone. Only the reading of the
// map's trees is shared with SMAK; the walk is Recast's voxels and Detour's polygons.
//
// THE AGENT: Half-Life's player, radius 16, height 72, a step of 18, a slope up to 45.57 degrees (a floor's normal
// of 0.7 up), on voxels 4 wide and 2 high unless told. A navmesh has no drops: a ledge over 18 is no link either
// way, where GoldSrc lets a player drop. Ladders are not climbed, nor gaps jumped.
//
// THE REPORT: `{ ok, failures: [sentence], islands: [{ island, area, at, polygons, start }], targets: [{ name, at,
// floor, reached, island, pathLength, nearest }], starts: [{ classname, at, floor, island }], geometry, agent,
// navmesh: { polygons, cells, seconds } }`. Points are Hammer's (x y z, z up); `area` in square units.

import { readBsp, contentsAt, floorUnder, CONTENTS } from "../../src/maps/bsp.mjs";
import { brushesOfTree, regionOf, clipBrushesOf, entityBrushesOf } from "../../src/mapbrushes.mjs";

/** Half-Life's standing player, as Recast is told of it. */
export const HL_AGENT = { radius: 16, height: 72, climb: 18, slope: 45.57, cs: 4, ch: 2 };

/** Brush entities that never stop a player. */
const NOT_SOLID = new Set([
  "func_illusionary",
  "func_ladder",
  "func_water",
  "func_monsterclip",
  "func_friction",
  "func_buyzone",
  "func_bomb_target",
  "func_hostage_rescue",
  "func_escapezone",
  "func_vip_safetyzone",
  "func_mortar_field",
  "env_bubbles",
]);
const DOORS = new Set(["func_door", "func_door_rotating", "momentary_door"]);

let recast = null;
/** Loads and starts the navmesh library once: `{ core, generators }`, or null when it is not installed. */
async function loadRecast() {
  if (recast) return recast;
  try {
    const core = await import("recast-navigation");
    const generators = await import("recast-navigation/generators");
    await core.init();
    recast = { core, generators };
  } catch {
    recast = null;
  }
  return recast;
}

/** Whether the navmesh library (`recast-navigation`) is installed and starts in this Node. */
export const navAvailable = async () => (await loadRecast()) !== null;

// Hammer (x, y, z up) to Recast (x, y up, z) and back: a turn about x, so a winding keeps its sense
const toNav = (p) => ({ x: p[0], y: p[2], z: -p[1] });
const fromNav = (v) => [v.x, -v.z, v.y];
const round = (x) => Math.round(x * 10) / 10 + 0;
const pt = (p) => p.map((x) => round(x));
const say = (p) => pt(p).join(" ");
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const keysOf = (pairs) => {
  const keys = {};
  for (const [k, v] of Array.isArray(pairs) ? pairs : Object.entries(pairs)) if (!(k in keys)) keys[k] = v;
  return keys;
};
const vec = (text) => (text ? String(text).trim().split(/\s+/).map(Number) : null);

/**
 * The triangles of the world's collision shape (see the head of the file), in Recast's axes: `{ positions,
 * indices, counts, geometry }`.
 */
function collisionTriangles(bsp, { doors, clips: withClips = true }) {
  const positions = [];
  const indices = [];
  const add = (planes, offset = [0, 0, 0]) => {
    const region = regionOf(planes);
    if (!region) return false;
    region.sides.forEach((side, k) => {
      const w = region.windings[k];
      const n = planes[side].normal;
      // the winding faces out of the solid, along its plane's normal: Recast reads a floor by its normal
      const turn = dot(cross(sub(w[1], w[0]), sub(w[2], w[0])), n) < 0;
      const base = positions.length / 3;
      for (const p of w) {
        const v = toNav([p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]]);
        positions.push(v.x, v.y, v.z);
      }
      for (let i = 1; i + 1 < w.length; i++)
        if (turn) indices.push(base, base + i + 1, base + i);
        else indices.push(base, base + i, base + i + 1);
    });
    return true;
  };
  const world = bsp.models[0];
  const solidLeaf = (leaf) => {
    const c = bsp.leaves[leaf]?.contents;
    return c === CONTENTS.SOLID || c === CONTENTS.SKY ? c : null;
  };
  let leaves = 0;
  for (const b of brushesOfTree(bsp, world.headNodes[0], solidLeaf, world.mins, world.maxs))
    if (add(b.planes)) leaves++;
  let clips = 0;
  if (withClips) for (const b of clipBrushesOf(bsp)) if (add(b.planes)) clips++;
  const solidEntities = [];
  const leftOut = {};
  for (const pairs of bsp.entities) {
    const e = keysOf(pairs);
    const m = /^\*(\d+)$/.exec(e.model ?? "");
    if (!m) continue;
    const cls = e.classname ?? "";
    const off =
      cls.startsWith("trigger_") ||
      NOT_SOLID.has(cls) ||
      (cls === "func_wall_toggle" && Number(e.spawnflags ?? 0) & 1) ||
      (DOORS.has(cls) && doors === "open");
    if (off) {
      leftOut[cls] = (leftOut[cls] ?? 0) + 1;
      continue;
    }
    const model = Number(m[1]);
    if (!bsp.models[model]) continue;
    // a model with no player hull (hulls 1 and 3 empty: zhlt_noclip, a lamp's fitting) stops no one in the game
    const hulls = bsp.models[model].headNodes ?? [];
    if (hulls[1] === -1 && hulls[3] === -1) {
      leftOut[`${cls} with no player hull`] = (leftOut[`${cls} with no player hull`] ?? 0) + 1;
      continue;
    }
    const origin = vec(e.origin) ?? [0, 0, 0];
    let n = 0;
    for (const b of entityBrushesOf(bsp, model)) if (add(b.planes, origin)) n++;
    if (n) solidEntities.push(`${cls} *${model}`);
  }
  const outs = Object.entries(leftOut)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([c, n]) => `${n} ${c}`);
  const geometry =
    `the world's collision shape as closed solids: ${leaves} solid or sky leaves of the drawn tree (hull 0), ` +
    `${withClips ? `${clips} CLIP brushes rebuilt from hulls 1 and 3` : "the CLIP brushes left out"}, ` +
    `${solidEntities.length} solid brush entities${solidEntities.length ? ` (${solidEntities.join(", ")})` : ""}` +
    `; left out: water, slime and lava${outs.length ? `, ${outs.join(", ")}` : ""}` +
    `; doors ${doors}${doors === "open" ? " (left out)" : " (solid where they stand)"}` +
    `; ladders not climbed, drops and jumps not walked (a navmesh has no one-way links)`;
  return { positions, indices, geometry, counts: { leaves, clips, entities: solidEntities.length, triangles: indices.length / 3 } }; // prettier-ignore
}

/** The polygons of a solo navmesh: `[{ ref, verts: [[x,y,z] Hammer], centre, area, links: [ref] }]`. */
function polygonsOf(core, navMesh) {
  const NULL_LINK = core.Detour.DT_NULL_LINK;
  const out = [];
  for (let t = 0; t < navMesh.getMaxTiles(); t++) {
    const tile = navMesh.getTile(t);
    const header = tile && tile.header();
    if (!header) continue;
    const base = navMesh.getPolyRefBase(tile);
    for (let i = 0; i < header.polyCount(); i++) {
      const poly = tile.polys(i);
      const verts = [];
      for (let j = 0; j < poly.vertCount(); j++) {
        const v = poly.verts(j);
        verts.push(fromNav({ x: tile.verts(v * 3), y: tile.verts(v * 3 + 1), z: tile.verts(v * 3 + 2) }));
      }
      let area = 0;
      for (let j = 0; j < verts.length; j++) {
        const a = verts[j];
        const b = verts[(j + 1) % verts.length];
        area += a[0] * b[1] - b[0] * a[1];
      }
      const centre = [0, 1, 2].map((k) => verts.reduce((s, v) => s + v[k], 0) / verts.length);
      const links = [];
      for (let l = poly.firstLink(); l !== NULL_LINK; l = tile.links(l).next()) {
        const ref = tile.links(l).ref();
        if (ref) links.push(ref);
      }
      out.push({ ref: base | i, verts, centre, area: Math.abs(area) / 2, links });
    }
  }
  return out;
}

/**
 * Walks a compiled map on a navmesh. `bsp`: what `readBsp` returns, or the file's bytes.
 *   from      the places to start, `[[x, y, z]]`; unless given, every info_player_start and info_player_deathmatch
 *   targets   `[{ name, at: [x, y, z] }]`: each is dropped to the floor under it and asked whether the walk reaches it
 *   agent     what to change of HL_AGENT (`{ radius, height, climb, slope, cs, ch }`)
 *   doors     "open" (left out, the default) or "closed" (solid where they stand)
 *   islands   "fail" to fail on every island not joined to a start (the default when no targets are given) or
 *             "report" (the default with targets)
 *   minIsland the least island, in square units, that "fail" counts (4096: one cell of 64)
 *   clips     false leaves the CLIP brushes rebuilt from hulls 1 and 3 out (true, the default, has them). The rebuild
 *             can keep a piece of a wall's growth as a clip: over a doorway 108 clear it made a box from 72 up across
 *             the doorway's line, which closed it to a player 72 tall (the assembler's house-01, seed 1). A map
 *             whose clips only smooth stairs and cap rails loses nothing a navmesh walks without them
 */
export async function navWalk(
  bsp,
  { from, targets = [], agent = {}, doors = "open", islands, minIsland = 4096, clips = true } = {},
) {
  if (!(bsp && bsp.models)) bsp = readBsp(bsp);
  if (doors !== "open" && doors !== "closed") throw new Error(`navWalk: doors is "open" or "closed", not ${JSON.stringify(doors)}`); // prettier-ignore
  const lib = await loadRecast();
  if (!lib)
    throw new Error(
      "navWalk: the npm package recast-navigation is not installed (npm install, in the kit's folder)",
    );
  const { core, generators } = lib;
  const a = { ...HL_AGENT, ...agent };
  islands ??= targets.length ? "report" : "fail";
  const started = process.hrtime.bigint();

  const tris = collisionTriangles(bsp, { doors, clips });
  const { mins, maxs } = bsp.models[0];
  // the bounds are the world's own: what the rebuilt solids have outside it (the void, closed by a box) is cut off
  const lo = toNav([mins[0], maxs[1], mins[2]]);
  const hi = toNav([maxs[0], mins[1], maxs[2]]);
  const config = {
    cs: a.cs,
    ch: a.ch,
    walkableSlopeAngle: a.slope,
    walkableHeight: Math.ceil(a.height / a.ch),
    walkableClimb: Math.floor(a.climb / a.ch),
    walkableRadius: Math.ceil(a.radius / a.cs),
    maxEdgeLen: Math.round(48 / a.cs),
    maxSimplificationError: 1.3,
    minRegionArea: 2, // squared by the generator: 4 cells
    mergeRegionArea: 10,
    maxVertsPerPoly: 6,
    detailSampleDist: 6,
    detailSampleMaxError: 1,
    bounds: [
      [lo.x, lo.y, lo.z],
      [hi.x, hi.y, hi.z],
    ],
  };
  const made = generators.generateSoloNavMesh(tris.positions, tris.indices, config);
  const failures = [];
  const report = {
    ok: false,
    failures,
    islands: [],
    targets: [],
    starts: [],
    geometry: tris.geometry,
    agent: { radius: a.radius, height: a.height, climb: a.climb, slope: a.slope, cs: a.cs, ch: a.ch },
    navmesh: null,
  };
  if (!made.success) {
    failures.push(`no navmesh was made of the map: ${made.error}`);
    return report;
  }
  const { navMesh } = made;
  const query = new core.NavMeshQuery(navMesh);
  try {
    // the islands: polygons joined by Detour's links
    const all = polygonsOf(core, navMesh);
    const byRef = new Map(all.map((p) => [p.ref, p]));
    const islandOf = new Map();
    let groups = [];
    for (const p of all) {
      if (islandOf.has(p.ref)) continue;
      const group = [];
      const open = [p.ref];
      islandOf.set(p.ref, -1);
      while (open.length) {
        const ref = open.pop();
        group.push(byRef.get(ref));
        for (const n of byRef.get(ref).links)
          if (!islandOf.has(n) && byRef.has(n)) {
            islandOf.set(n, -1);
            open.push(n);
          }
      }
      groups.push(group);
    }
    // an island outside the world (on the solid that closes the void) is in solid where a player's middle would be
    const inWorld = (g) => {
      const big = g.reduce((m, p) => (p.area > m.area ? p : m), g[0]);
      return contentsAt(bsp, [big.centre[0], big.centre[1], big.centre[2] + 36]) !== CONTENTS.SOLID;
    };
    const outside = groups.filter((g) => !inWorld(g)).length;
    groups = groups.filter(inWorld);
    const area = (g) => g.reduce((s, p) => s + p.area, 0);
    const where = (g) => g.reduce((m, p) => (p.area > m.area ? p : m), g[0]).centre;
    // largest first; ties by where they are, so the numbering is the same every run
    groups.sort((x, y) => area(y) - area(x) || where(x)[0] - where(y)[0] || where(x)[1] - where(y)[1] || where(x)[2] - where(y)[2]); // prettier-ignore
    for (const p of all) islandOf.set(p.ref, null);
    groups.forEach((g, k) => g.forEach((p) => islandOf.set(p.ref, k + 1)));

    // a point dropped to the floor and put on the navmesh: { floor, ref, on }
    const place = (at) => {
      let floor = null;
      for (const lift of [1, 8, 36])
        if (contentsAt(bsp, [at[0], at[1], at[2] + lift]) !== CONTENTS.SOLID) {
          floor = floorUnder(bsp, [at[0], at[1], at[2] + lift]);
          break;
        }
      const ground = [at[0], at[1], floor ?? at[2]];
      const found = query.findNearestPoly(toNav(ground), {
        halfExtents: { x: a.radius + 8, y: 24, z: a.radius + 8 },
      });
      const ok = found.success && found.nearestRef && islandOf.get(found.nearestRef);
      return { floor: floor === null ? null : round(floor), ground, ref: ok ? found.nearestRef : 0, on: ok ? fromNav(found.nearestPoint) : null }; // prettier-ignore
    };
    // the nearest point of an island (or of any, with null) to a point
    const nearestOn = (island, p) => {
      let best = null;
      for (const poly of all) {
        const k = islandOf.get(poly.ref);
        if (!k || (island !== null && !island.includes(k))) continue;
        const c = query.closestPointOnPoly(poly.ref, toNav(p));
        if (!c.success) continue;
        const q = fromNav(c.closestPoint);
        const d = dist(p, q);
        if (!best || d < best.distance) best = { distance: d, at: q, island: k };
      }
      return best;
    };

    // the places to start
    const starts = from
      ? from.map((at) => ({ classname: "given", origin: at }))
      : bsp.entities
          .map(keysOf)
          .filter((e) => e.classname === "info_player_start" || e.classname === "info_player_deathmatch")
          .map((e) => ({ classname: e.classname, origin: vec(e.origin) }))
          .filter((s) => s.origin);
    for (const s of starts) {
      const placed = place(s.origin);
      const island = placed.ref ? islandOf.get(placed.ref) : null;
      report.starts.push({ classname: s.classname, at: pt(s.origin), floor: placed.floor, island, ref: placed.ref, on: placed.on }); // prettier-ignore
      if (!island)
        failures.push(`the ${s.classname} at (${say(s.origin)}) is on no navmesh: no floor a standing player fits on within ${a.radius + 8} units of ${say(placed.ground)}`); // prettier-ignore
    }
    if (!starts.length)
      failures.push(
        "the map has no info_player_start or info_player_deathmatch: there is nowhere to walk from",
      );
    const startIslands = [...new Set(report.starts.map((s) => s.island).filter(Boolean))].sort(
      (x, y) => x - y,
    );
    const fromWord = startIslands.length > 1 ? "any start" : "the start";

    report.islands = groups.map((g, k) => ({
      island: k + 1,
      area: Math.round(area(g)),
      at: pt(where(g)),
      polygons: g.length,
      start: startIslands.includes(k + 1),
    }));

    for (const t of targets) {
      const name = t.name ?? `target ${report.targets.length + 1}`;
      const placed = place(t.at);
      const island = placed.ref ? islandOf.get(placed.ref) : null;
      const entry = {
        name,
        at: pt(t.at),
        floor: placed.floor,
        reached: false,
        island,
        pathLength: null,
        nearest: null,
      };
      if (island && startIslands.includes(island)) {
        entry.reached = true;
        const s = report.starts.find((x) => x.island === island);
        const path = query.computePath(toNav(s.on), toNav(placed.on), { halfExtents: { x: 4, y: 4, z: 4 }, maxPathPolys: 4096, maxStraightPathPoints: 4096 }); // prettier-ignore
        if (path.success && path.path.length) {
          let len = 0;
          for (let i = 1; i < path.path.length; i++)
            len += dist(fromNav(path.path[i - 1]), fromNav(path.path[i]));
          entry.pathLength = round(len);
        }
      } else {
        const near = startIslands.length ? nearestOn(startIslands, placed.ground) : null;
        if (near) entry.nearest = { distance: round(near.distance), at: pt(near.at), island: near.island };
        const nearText = near ? `the walked navmesh comes nearest ${round(near.distance)} units away, at (${say(near.at)})` : "nothing is walked"; // prettier-ignore
        if (island) {
          const info = report.islands[island - 1];
          failures.push(`${name} (${say(t.at)}) is not reached from ${fromWord}: its floor is on another island, ${island} (${info.area} square units about ${say(info.at)}), that no walk joins to ${fromWord}'s; ${nearText}`); // prettier-ignore
        } else {
          const any = nearestOn(null, placed.ground);
          const anyText = any ? `the nearest navmesh is ${round(any.distance)} units away, at (${say(any.at)}), on ${startIslands.includes(any.island) ? `${fromWord}'s island` : `another island, ${any.island}`}` : "the map has no navmesh"; // prettier-ignore
          failures.push(`${name} (${say(t.at)}) is not reached from ${fromWord}: there is no floor a standing player fits on under it (${placed.floor === null ? "no floor found" : `floor at z ${placed.floor}`}); ${anyText}`); // prettier-ignore
        }
      }
      report.targets.push(entry);
    }

    if (islands === "fail" && startIslands.length)
      for (const i of report.islands)
        if (!i.start && i.area >= minIsland)
          failures.push(`a floor of ${i.area} square units about (${say(i.at)}) is not reached from ${fromWord}: navmesh island ${i.island} of ${report.islands.length}, joined to no start`); // prettier-ignore

    const cells = Math.ceil((hi.x - lo.x) / a.cs) * Math.ceil((hi.z - lo.z) / a.cs);
    report.navmesh = {
      polygons: all.length,
      islands: groups.length,
      outside,
      triangles: tris.counts.triangles,
      cells,
      seconds: round(Number(process.hrtime.bigint() - started) / 1e9),
    };
    report.ok = failures.length === 0;
    for (const s of report.starts) delete s.ref;
    return report;
  } finally {
    query.destroy?.();
    navMesh.destroy();
  }
}
