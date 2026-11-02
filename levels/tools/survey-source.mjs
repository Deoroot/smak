#!/usr/bin/env node
// A Source game's own campaign maps, measured for SMAK's Phase 3 (a level laid out from a description and
// checked by measures): floor width, sight and headroom taken the way src/maps/measure.mjs takes them on a
// GoldSrc map, so the games line up; and what the Source games' navigation meshes add (the walked way, its
// loops, steps and drops, where the game marks its events along the way). Measures and bands only: nothing
// of a map (geometry, nav mesh, entities) is written, only numbers about it and its name.
//
//   node levels/tools/survey-source.mjs --game l4d2 [--root <game folder>] [--maps c1m1_hotel,c2m1_highway]
//        [--props] [--out levels/corpus/levels-l4d2.json] [--quiet]
//
// HOW A PLACE IS MEASURED (as measure.mjs): the walkable floor is looked over on a grid of 32 units (x and y
// multiples of 32, a fraction of a unit off it); at each place sixteen level lines go out 60 over the floor,
// one every 22.5 degrees, each until something solid (3000 at the most).
//   width     the narrowest of the eight lines through the place (a run one way plus the run the other)
//   sight     the longest of the sixteen runs
//   headroom  from the floor to the first solid straight over it (looked for from 8 over the floor)
// WHICH FLOOR: the nav mesh's areas that the walk from the start reaches (its links followed one way, as a
// bot would, and its ladders; drops and climbs over a player clip left out; a func_elevator's shaft joined)
// and from which the end can still be reached, every place of the grid inside one, at the area's own height
// there (from its four corners). measure.mjs's floor is what its walk test reaches; this is the game's own
// idea of the same.
// WHAT IS SOLID: the world's brushes that are solid or a window, the brush entities that stand in the way
// (func_brush unless never solid, func_wall, func_breakable, func_breakable_surf), and the displacements
// (terrain). Not: clip brushes, grates, water, doors (open, as measure.mjs takes them), and the static
// props, which are models with their own collision. With --props they are taken twice more:
//   withPropCollision  width, sight and headroom with each solid static prop as the engine collides with it:
//                      `solid 6` as the convex hulls of its model's .phy (its first solid, as the engine
//                      takes it), `solid 2` as its model's box, `solid 0` and a `solid 6` with no .phy not
//                      at all; placed by its origin and angles (L4D2's static prop lump, version 9, has no
//                      scale). The measure of the game's spaces.
//   withPropBoxes      width and sight with every solid prop as its model's box: the older upper bound,
//                      kept so earlier numbers can be compared.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSourceBsp, readLumpFiles, readStaticProps, solidOf, CONTENTS } from "../lib/source-bsp.mjs";
import { readNav, heightAt, centreOf, areaOf, meetingOf, TERROR, NAV } from "../lib/nav.mjs";
import { openVpks } from "../lib/vpk.mjs";
import { readPhy } from "../lib/phy.mjs";
import { iceDecrypt, NUC_KEY } from "../lib/ice.mjs";
import { scriptSays, EVENT_CODE } from "../lib/director-script.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── the games ───────────────────────────────────────────────────────────────
const GAMES = {
  l4d2: {
    name: "Left 4 Dead 2",
    root: "C:/Juegos/Steam/steamapps/common/Left 4 Dead 2",
    // the search order of the game's own gameinfo: the update first, then the DLC, then the base game
    folders: ["update", "left4dead2_dlc3", "left4dead2_dlc2", "left4dead2_dlc1", "left4dead2"],
    maps: /^c\d+m\d+_[a-z_]+$/,
    skip: /_sndscape$/,
  },
};

// ── the measuring, as measure.mjs ──────────────────────────────────────────
const UNIT_M = 0.0254;
const PLAYER = 72; // a player's height in units (a standing hull, Source and GoldSrc alike)
const GRID = 32;
const EYE = 60;
const FAR = 3000;
const WAYS = 16;
const OVER_FLOOR = 8;
const OFF_GRID = [0.3, 0.1];
const BANDS = [176, 352];
const NARROW = 2 * PLAYER; // under two player heights wide: corridor-like
const SIGHT = 700;
const STEP = 18; // Source's step height
const COARSE = 512; // the cell of the coarse graph for loops, in x and y
const COARSE_Z = 192; // and in height
const STAIR_SLOPE = [0.36, 1.2]; // a nav area sloped 20 to 50 degrees is looked at as a stair

// ── small arithmetic ────────────────────────────────────────────────────────
const sorted = (list) => list.slice().sort((a, b) => a - b);
/** The value a share of the way up a list (measure.mjs's way: the place share x length, cut down). */
function partOf(list, share) {
  if (!list.length) return null;
  const s = sorted(list);
  return s[Math.min(s.length - 1, Math.floor(share * s.length))];
}
const round = (v, places = 0) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** places) / 10 ** places);
/** n, median, q1, q3, p5, p95 of a list, rounded. */
function spread(list, places = 0) {
  const l = list.filter((v) => v !== null && Number.isFinite(v));
  return {
    n: l.length,
    median: round(partOf(l, 0.5), places),
    q1: round(partOf(l, 0.25), places),
    q3: round(partOf(l, 0.75), places),
    p5: round(partOf(l, 0.05), places),
    p95: round(partOf(l, 0.95), places),
  };
}
const share = (part, all) => (all ? round(part / all, 3) : null);
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ── the files ───────────────────────────────────────────────────────────────
function mapFiles(game, root) {
  const found = new Map();
  for (const folder of game.folders) {
    const dir = path.join(root, folder, "maps");
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      const match = /^(.*)\.(bsp|nav)$/.exec(file);
      if (!match) continue;
      const [, name, ext] = match;
      if (!game.maps.test(name) || game.skip.test(name)) continue;
      const entry = found.get(name) ?? { name };
      if (!entry[ext]) entry[ext] = path.join(dir, file);
      if (!entry.lumps) {
        const lumps = fs.readdirSync(dir).filter((f) => new RegExp(`^${name}_l_\\d+\\.lmp$`).test(f));
        if (lumps.length) entry.lumps = lumps.map((f) => path.join(dir, f));
      }
      found.set(name, entry);
    }
  }
  const order = (name) => name.match(/^c(\d+)m(\d+)/).slice(1).map(Number);
  return [...found.values()].sort((a, b) => {
    const [ca, ma] = order(a.name);
    const [cb, mb] = order(b.name);
    return ca - cb || ma - mb;
  });
}

// ── what stands in the way, from the entities ──────────────────────────────
const SOLID_ENTITIES = /^(func_brush|func_wall|func_breakable|func_breakable_surf)$/;
const vector = (text) => (text ?? "0 0 0").trim().split(/\s+/).map(Number);
function solidModels(entities) {
  const list = [];
  for (const e of entities) {
    if (!SOLID_ENTITIES.test(e.classname ?? "") || !/^\*\d+$/.test(e.model ?? "")) continue;
    if (e.classname === "func_brush" && e.Solidity === "1") continue; // never solid
    list.push({ model: Number(e.model.slice(1)), origin: vector(e.origin) });
  }
  return list;
}
/** Where an entity stands: its origin, or the middle of its brush model. */
function placeOf(e, bsp) {
  if (/^\*\d+$/.test(e.model ?? "")) {
    const m = bsp.models[Number(e.model.slice(1))];
    if (m) {
      const o = vector(e.origin);
      return [0, 1, 2].map((k) => (m.min[k] + m.max[k]) / 2 + o[k]);
    }
  }
  return e.origin ? vector(e.origin) : null;
}

// ── a model's box, from its header (studiohdr_t: hull_min at 104, hull_max at 116; view box at 128) ──
function modelBox(vpk, cache, name) {
  const key = name.toLowerCase().replace(/\\/g, "/");
  if (cache.has(key)) return cache.get(key);
  let box = null;
  const b = vpk.read(key);
  if (b && b.length > 152 && b.toString("latin1", 0, 4) === "IDST") {
    const f = (o) => [b.readFloatLE(o), b.readFloatLE(o + 4), b.readFloatLE(o + 8)];
    let [min, max] = [f(104), f(116)];
    if (max.every((v, k) => v - min[k] < 0.5)) [min, max] = [f(128), f(140)];
    if (!max.every((v, k) => v - min[k] < 0.5)) box = { min, max };
  }
  cache.set(key, box);
  return box;
}

// ── a model's collision: the convex hulls of its .phy's first solid (the one the engine gives a static
// prop), or null when it has none ──
function modelHulls(vpk, cache, name) {
  const key = name.toLowerCase().replace(/\\/g, "/").replace(/\.mdl$/, ".phy");
  if (cache.has(key)) return cache.get(key);
  let hulls = null;
  const b = vpk.read(key);
  if (b) {
    try {
      const phy = readPhy(b);
      if (phy.solids.length) hulls = { hulls: phy.solids[0].hulls, solids: phy.solids.length };
    } catch (error) {
      hulls = { failed: error.message, hulls: [] };
    }
  }
  cache.set(key, hulls);
  return hulls;
}

// ── a director script, by what it says: the game's VScripts are `.nuc` (the `.nut` under ICE, see
// lib/ice.mjs), read from the packs or loose. An event (a crescendo, an onslaught, a gauntlet) when the
// script asks for a panic (PanicForever, STAGE_PANIC, ScriptedPanic, PanicEvent), spawns a mob itself
// (ZSpawn of type 10), or sets mobs coming at 10 seconds or less (MobSpawnMinTime): lib/director-script.mjs ──
function directorScript(vpk, cache, roots, name) {
  const key = name.toLowerCase().replace(/\\/g, "/").replace(/\.nu[tc]$/, "");
  if (cache.has(key)) return cache.get(key);
  let text = null;
  for (const ext of ["nut", "nuc"]) {
    const file = `scripts/vscripts/${key}.${ext}`;
    let b = null;
    for (const root of roots) if (!b && fs.existsSync(path.join(root, file))) b = fs.readFileSync(path.join(root, file));
    b ??= vpk.read(file);
    if (b) {
      text = (ext === "nuc" ? iceDecrypt(b, NUC_KEY) : b).toString("latin1");
      break;
    }
  }
  const said = text === null ? null : scriptSays(text);
  cache.set(key, said);
  return said;
}

// ── one map ─────────────────────────────────────────────────────────────────
function surveyMap(entry, { vpk, boxCache, phyCache, scriptCache, scriptRoots = [], props }) {
  const t0 = Date.now();
  const nav = readNav(fs.readFileSync(entry.nav));
  const buffer = fs.readFileSync(entry.bsp);
  const lumpFiles = entry.lumps ? readLumpFiles(entry.lumps) : [];
  const bsp = readSourceBsp(buffer, { lumpFiles });
  const entities = bsp.entities;
  let boxes = [];
  // the props as the engine collides with them: hulls (solid 6, from the .phy), boxes (solid 2)
  const collide = { hulls: [], boxes: [] };
  const propCount = { all: 0, solidNone: 0, hulls: 0, boxes: 0, noPhy: 0, phyFailed: 0, manySolids: 0, hullCount: 0 };
  if (props) {
    for (const prop of readStaticProps(buffer)) {
      propCount.all++;
      if (!prop.solid) {
        propCount.solidNone++;
        continue;
      }
      const box = modelBox(vpk, boxCache, prop.model);
      if (box) boxes.push({ origin: prop.origin, angles: prop.angles, ...box });
      if (prop.solid === 2) {
        if (box) collide.boxes.push({ origin: prop.origin, angles: prop.angles, ...box }), propCount.boxes++;
        continue;
      }
      const model = modelHulls(vpk, phyCache, prop.model);
      if (!model) {
        propCount.noPhy++;
        continue;
      }
      if (model.failed) {
        propCount.phyFailed++;
        continue;
      }
      if (model.solids > 1) propCount.manySolids++;
      propCount.hulls++;
      propCount.hullCount += model.hulls.length;
      collide.hulls.push({ origin: prop.origin, angles: prop.angles, hulls: model.hulls });
    }
  }
  const solid = solidOf(bsp, { models: solidModels(entities) });
  const propSolid = boxes.length ? solidOf(bsp, { mask: 0, displacements: false, boxes }) : null;
  const propCollide = props ? solidOf(bsp, { mask: 0, displacements: false, ...collide }) : null;
  const { areas, byId } = nav;
  const index = new Map(areas.map((a, n) => [a.id, n]));

  // ── what stops a survivor and not a line of sight: player clips, and the env_player_blocker boxes that
  // block survivors (BlockType 0 everyone, 1 survivors, 3 all players) and are not named (a named one is
  // switched on and off by the map's events) ──
  const blockers = entities
    .filter((e) => e.classname === "env_player_blocker" && !e.targetname && ["0", "1", "3", undefined].includes(e.BlockType) && e.mins && e.maxs)
    .map((e) => ({ origin: vector(e.origin), angles: [0, 0, 0], min: vector(e.mins), max: vector(e.maxs) }));
  const clip = solidOf(bsp, { mask: CONTENTS.PLAYERCLIP, displacements: false, boxes: blockers });

  // ── the graph: links (one way) and ladders (both ways) ──
  // a drop or a climb a survivor cannot take (the nav's generator jumps and drops over a player clip) is
  // left out: a level line, 40 over the higher of the two floors, from just inside the one area to just
  // inside the other, that meets a clip or a blocker. Links that step (18 or less) are the generator's own
  // walk, which a clip already stopped; and a clip ramp over a stair would cut them wrongly
  const out = areas.map(() => []); // [to, cost, rise at the edge]
  let clipped = 0;
  const clamp = (a, x, y) => [Math.min(a.se[0], Math.max(a.nw[0], x)), Math.min(a.se[1], Math.max(a.nw[1], y))];
  for (const [n, a] of areas.entries())
    for (const list of a.links)
      for (const id of list) {
        const m = index.get(id);
        if (m === undefined || m === n) continue;
        const b = areas[m];
        const meet = meetingOf(a, b);
        const ca = centreOf(a);
        const cb = centreOf(b);
        const len = Math.hypot(cb[0] - ca[0], cb[1] - ca[1]) || 1;
        const ux = (cb[0] - ca[0]) / len;
        const uy = (cb[1] - ca[1]) / len;
        const [ax, ay] = clamp(a, meet[0] - ux * 12, meet[1] - uy * 12);
        const [bx, by] = clamp(b, meet[0] + ux * 12, meet[1] + uy * 12);
        const za = heightAt(a, ax, ay);
        const zb = heightAt(b, bx, by);
        if (Math.abs(meet[3] - meet[2]) > STEP) {
          const z = Math.max(za, zb) + 40;
          if (clip.firstStop([ax, ay, z], [bx, by, z]) !== null) {
            clipped++;
            continue;
          }
        }
        const cost = dist3(ca, [meet[0], meet[1], meet[2]]) + dist3([meet[0], meet[1], meet[3]], cb);
        out[n].push([m, cost, meet[3] - meet[2]]);
      }
  for (const ladder of nav.ladders) {
    const bottom = index.get(ladder.bottomArea);
    for (const id of ladder.topAreas) {
      const top = index.get(id);
      if (bottom === undefined || top === undefined) continue;
      out[bottom].push([top, ladder.length, null]);
      out[top].push([bottom, ladder.length, null]);
    }
  }

  // lifts: the areas inside a func_elevator's shaft, seen from above, are joined both ways (the nav has no
  // link for the ride)
  let lifts = 0;
  for (const e of entities) {
    if (e.classname !== "func_elevator" || !/^\*\d+$/.test(e.model ?? "")) continue;
    const m = bsp.models[Number(e.model.slice(1))];
    const o = vector(e.origin);
    if (!m) continue;
    const lo = [m.min[0] + o[0], m.min[1] + o[1]];
    const hi = [m.max[0] + o[0], m.max[1] + o[1]];
    const inside = areas
      .map((a, n) => [a, n])
      .filter(([a]) => {
        const c = centreOf(a);
        return c[0] > lo[0] && c[0] < hi[0] && c[1] > lo[1] && c[1] < hi[1];
      })
      .map(([, n]) => n);
    for (const n of inside)
      for (const k of inside) {
        const dz = Math.abs(centreOf(areas[n])[2] - centreOf(areas[k])[2]);
        if (n !== k && dz > STEP) out[n].push([k, dz, null]);
      }
    if (inside.length > 1) lifts++;
  }

  // ── the start and the end ──
  const has = (a, flag) => (a.spawn & flag) !== 0;
  const nearestArea = (p, pool = areas.map((_, n) => n)) => {
    let best = null;
    let bestD = Infinity;
    for (const n of pool) {
      const a = areas[n];
      const x = Math.min(a.se[0], Math.max(a.nw[0], p[0]));
      const y = Math.min(a.se[1], Math.max(a.nw[1], p[1]));
      const d = Math.hypot(x - p[0], y - p[1]) + Math.abs(heightAt(a, x, y) - p[2]) * 2;
      if (d < bestD) (bestD = d), (best = n);
    }
    return best;
  };
  /** The groups of areas with a flag that touch (links either way). */
  const groupsOf = (flag) => {
    const inFlag = new Set(areas.map((a, n) => (has(a, flag) ? n : -1)).filter((n) => n >= 0));
    const undirected = new Map([...inFlag].map((n) => [n, new Set()]));
    for (const n of inFlag)
      for (const [m] of out[n])
        if (inFlag.has(m)) undirected.get(n).add(m), undirected.get(m).add(n);
    const seen = new Set();
    const groups = [];
    for (const n of inFlag) {
      if (seen.has(n)) continue;
      const group = [];
      const stack = [n];
      seen.add(n);
      while (stack.length) {
        const k = stack.pop();
        group.push(k);
        for (const m of undirected.get(k)) if (!seen.has(m)) seen.add(m), stack.push(m);
      }
      groups.push(group);
    }
    return groups;
  };
  const startEntity =
    entities.find((e) => e.classname === "info_player_start") ?? entities.find((e) => e.classname === "info_survivor_position");
  const checkpoints = groupsOf(TERROR.CHECKPOINT).filter((g) => g.length);
  const checkpointAreas = checkpoints.flat();
  /** The saferoom a saferoom door (by its name: the game's own checkpoint_exit, checkpoint_entrance) opens. */
  const saferoomAt = (name) => {
    const door = entities.find((e) => /^prop_door_rotating_checkpoint$/.test(e.classname ?? "") && e.targetname === name);
    if (!door || !checkpointAreas.length) return null;
    const near = nearestArea(placeOf(door, bsp), checkpointAreas);
    return checkpoints.find((g) => g.includes(near)) ?? null;
  };
  let startSet;
  let startHow;
  const playerStart = areas.map((a, n) => (has(a, TERROR.PLAYER_START) ? n : -1)).filter((n) => n >= 0);
  const exitRoom = saferoomAt("checkpoint_exit");
  if (playerStart.length) {
    startSet = playerStart;
    startHow = "the nav's PLAYER_START areas";
  } else if (exitRoom) {
    startSet = exitRoom;
    startHow = "the saferoom (CHECKPOINT areas) behind the door checkpoint_exit";
  } else if (startEntity) {
    const near = nearestArea(placeOf(startEntity, bsp));
    const group = checkpoints.find((g) => g.includes(near));
    startSet = group ?? [near];
    startHow = group ? "the saferoom (CHECKPOINT areas) at info_player_start" : "the area at info_player_start";
  } else throw new Error("no start: no PLAYER_START areas and no info_player_start");
  const startSetOf = new Set(startSet);

  // flow: the walked distance from the start (Dijkstra, from every start area at 0)
  const flow = new Float64Array(areas.length).fill(Infinity);
  const from = new Int32Array(areas.length).fill(-1);
  {
    const heap = [];
    const push = (n, d) => {
      heap.push([d, n]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    for (const n of startSet) (flow[n] = 0), push(n, 0);
    while (heap.length) {
      const [d, n] = pop();
      if (d > flow[n]) continue;
      for (const [m, cost] of out[n])
        if (d + cost < flow[m]) {
          flow[m] = d + cost;
          from[m] = n;
          push(m, flow[m]);
        }
    }
  }
  const forwardSet = new Set(areas.map((_, n) => n).filter((n) => Number.isFinite(flow[n])));

  // the end: a finale's rescue vehicle, or the saferoom at the far end
  const startGroup = checkpoints.find((g) => g.some((n) => startSetOf.has(n)));
  const rescue = groupsOf(TERROR.RESCUE_VEHICLE).filter((g) => g.some((n) => forwardSet.has(n)));
  const others = checkpoints.filter((g) => g !== startGroup && !g.some((n) => startSetOf.has(n)) && g.some((n) => forwardSet.has(n)));
  let endSet = null;
  let endHow = null;
  const nearestOf = (g) => Math.min(...g.map((n) => flow[n]));
  const entranceRoom = saferoomAt("checkpoint_entrance");
  if (rescue.length) {
    endSet = rescue.sort((a, b) => nearestOf(b) - nearestOf(a))[0];
    endHow = "the rescue vehicle (RESCUE_VEHICLE areas)";
  } else if (entranceRoom && entranceRoom.some((n) => forwardSet.has(n)) && !entranceRoom.some((n) => startSetOf.has(n))) {
    endSet = entranceRoom;
    endHow = "the end saferoom (CHECKPOINT areas) behind the door checkpoint_entrance";
  } else if (others.length) {
    // the saferoom farthest along (a map's other CHECKPOINT groups are small marks inside it, or the start's)
    endSet = others.sort((a, b) => nearestOf(b) - nearestOf(a))[0];
    endHow = "the end saferoom (CHECKPOINT areas)";
  }

  // the walkable floor: what the start reaches AND from where the end can still be reached. A place one
  // drops into and cannot leave for the end is no survivor's (the infected's roofs, the ground beyond a
  // ledge the nav's generator dropped from): in the game a survivor there would be stuck
  let reachable = [...forwardSet];
  let strandedArea = 0;
  if (endSet) {
    const into = areas.map(() => []);
    for (const [n, list] of out.entries()) for (const [m] of list) into[m].push(n);
    const back = new Set(endSet);
    const stack = [...endSet];
    while (stack.length) for (const k of into[stack.pop()]) if (!back.has(k)) back.add(k), stack.push(k);
    const kept = reachable.filter((n) => back.has(n));
    for (const n of reachable) if (!back.has(n)) strandedArea += areaOf(areas[n]);
    reachable = kept;
  }
  const reachSet = new Set(reachable);

  // ── the crossing ──
  let crossing = null;
  let crossFlow = null;
  if (endSet) {
    let end = endSet[0];
    for (const n of endSet) if (flow[n] < flow[end]) end = n;
    crossFlow = flow[end];
    let first = end;
    while (from[first] >= 0) first = from[first];
    const straight = dist3(centreOf(areas[first]), centreOf(areas[end]));
    const pathAreas = [];
    for (let n = end; n >= 0; n = from[n]) pathAreas.push(n);
    crossing = {
      walked: round(crossFlow),
      straight: round(straight),
      ratio: round(crossFlow / straight, 2),
      rise: round(centreOf(areas[end])[2] - centreOf(areas[first])[2]),
      areas: pathAreas.length,
      start: startHow,
      finale: endHow.startsWith("the rescue"),
      end: endHow,
      pathAreas: pathAreas.reverse(),
    };
  }

  // ── the floor: the grid inside the reached areas ──
  const cells = [];
  let walkableArea = 0;
  for (const n of reachable) {
    const a = areas[n];
    walkableArea += areaOf(a);
    for (let x = Math.ceil(a.nw[0] / GRID) * GRID; x < a.se[0]; x += GRID)
      for (let y = Math.ceil(a.nw[1] / GRID) * GRID; y < a.se[1]; y += GRID)
        cells.push({ x, y, floor: heightAt(a, x, y), area: n });
  }
  const ways = Array.from({ length: WAYS }, (_, k) => [Math.cos((k * 2 * Math.PI) / WAYS), Math.sin((k * 2 * Math.PI) / WAYS)]);
  let sky = 0;
  let roofed = 0;
  for (const cell of cells) {
    const eye = [cell.x + OFF_GRID[0], cell.y + OFF_GRID[1], cell.floor + EYE];
    const runs = ways.map(([dx, dy]) => solid.firstStop(eye, [eye[0] + dx * FAR, eye[1] + dy * FAR, eye[2]]) ?? FAR);
    cell.width = Infinity;
    for (let k = 0; k < WAYS / 2; k++) cell.width = Math.min(cell.width, runs[k] + runs[k + WAYS / 2]);
    cell.sight = Math.max(...runs);
    if (propSolid) {
      // the same lines stopped also by the props' boxes (each only as far as it went already)
      const withProps = ways.map(([dx, dy], k) => {
        const hit = propSolid.firstStop(eye, [eye[0] + dx * runs[k], eye[1] + dy * runs[k], eye[2]]);
        return hit === null ? runs[k] : hit;
      });
      cell.widthP = Infinity;
      for (let k = 0; k < WAYS / 2; k++) cell.widthP = Math.min(cell.widthP, withProps[k] + withProps[k + WAYS / 2]);
      cell.sightP = Math.max(...withProps);
    }
    const up = solid.upward([cell.x + OFF_GRID[0], cell.y + OFF_GRID[1], cell.floor + OVER_FLOOR]);
    cell.headroom = up.distance + OVER_FLOOR;
    if (propCollide) {
      // the same lines stopped also by the props as the engine collides with them
      const withProps = ways.map(([dx, dy], k) => {
        const hit = propCollide.firstStop(eye, [eye[0] + dx * runs[k], eye[1] + dy * runs[k], eye[2]]);
        return hit === null ? runs[k] : hit;
      });
      cell.widthC = Infinity;
      for (let k = 0; k < WAYS / 2; k++) cell.widthC = Math.min(cell.widthC, withProps[k] + withProps[k + WAYS / 2]);
      cell.sightC = Math.max(...withProps);
      const most = Number.isFinite(up.distance) ? up.distance : 16384;
      const over = propCollide.firstStop([cell.x + OFF_GRID[0], cell.y + OFF_GRID[1], cell.floor + OVER_FLOOR], [cell.x + OFF_GRID[0], cell.y + OFF_GRID[1], cell.floor + OVER_FLOOR + most]);
      cell.headroomC = over === null ? cell.headroom : over + OVER_FLOOR;
      cell.propRoof = over !== null;
    }
    if (Number.isFinite(up.distance)) {
      roofed++;
      if (up.sky) sky++;
    }
  }
  const widths = cells.map((c) => c.width);
  const sights = cells.map((c) => c.sight);
  const heads = cells.filter((c) => Number.isFinite(c.headroom));
  const zs = cells.map((c) => c.floor);

  // ── steps, drops and stairs ──
  const rises = [];
  const drops = [];
  const climbs = [];
  let oneWay = 0;
  for (const n of reachable)
    for (const [m, , dz] of out[n]) {
      if (dz === null || !reachSet.has(m)) continue;
      if (dz > 4 && dz <= STEP) rises.push(dz);
      else if (dz > STEP) climbs.push(dz);
      else if (dz < -STEP) {
        drops.push(-dz);
        if (!out[m].some(([k]) => k === n)) oneWay++;
      }
    }
  const risers = [];
  const treads = [];
  const flights = [];
  for (const n of reachable) {
    const a = areas[n];
    const w = a.se[0] - a.nw[0];
    const d = a.se[1] - a.nw[1];
    if (w < 8 || d < 8) continue;
    const gx = (a.neZ - a.nw[2] + (a.se[2] - a.swZ)) / 2 / w;
    const gy = (a.swZ - a.nw[2] + (a.se[2] - a.neZ)) / 2 / d;
    const slope = Math.hypot(gx, gy);
    if (slope < STAIR_SLOPE[0] || slope > STAIR_SLOPE[1]) continue;
    // a profile of the floor down the slope through the middle, from the brushes, a unit at a time
    const [cx, cy] = centreOf(a);
    const ux = gx / slope;
    const uy = gy / slope;
    const half = Math.abs(ux) * w / 2 + Math.abs(uy) * d / 2;
    if (half * 2 < 48) continue;
    const profile = [];
    for (let s = -half + 2; s <= half - 2; s += 1) {
      const x = cx + ux * s + 0.3;
      const y = cy + uy * s + 0.1;
      const z = heightAt(a, x, y);
      const down = solid.downward([x, y, z + 24], 64);
      profile.push(down === null ? null : z + 24 - down);
    }
    const steps = [];
    let last = null;
    let lastAt = null;
    for (let k = 0; k < profile.length; k++) {
      const z = profile[k];
      if (z === null) continue;
      if (last !== null && z - last > 1.5) {
        if (steps.length && k - steps[steps.length - 1].at <= 2) steps[steps.length - 1].rise += z - last;
        else steps.push({ at: k, rise: z - last });
      }
      last = z;
      lastAt = k;
    }
    void lastAt;
    if (steps.length >= 3) {
      const r = steps.map((s) => s.rise);
      const med = partOf(r, 0.5);
      if (med > 2 && med <= STEP + 2 && r.every((v) => Math.abs(v - med) < 6)) {
        risers.push(...r);
        for (let k = 1; k < steps.length; k++) treads.push(steps[k].at - steps[k - 1].at);
        flights.push(Math.abs(slope * half * 2));
      }
    }
  }

  // ── doors ──
  const doorLeaves = [];
  const doorOpenings = [];
  const brushDoors = [];
  const named = new Map();
  for (const e of entities) if (e.targetname) named.set(e.targetname, e);
  for (const e of entities) {
    const cls = e.classname ?? "";
    if (/^prop_door_rotating/.test(cls) && e.model) {
      const box = modelBox(vpk, boxCache, e.model);
      if (!box) continue;
      const width = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1]);
      const height = box.max[2] - box.min[2];
      doorLeaves.push({ width, height, checkpoint: /checkpoint/.test(cls) });
      // a pair (one names the other its slave): the opening is both leaves
      const paired = e.slavename && e.slavename !== e.targetname && named.has(e.slavename);
      if (!(e.targetname && entities.some((o) => o !== e && o.slavename === e.targetname && /^prop_door/.test(o.classname ?? ""))))
        doorOpenings.push({ width: paired ? width * 2 : width, height });
    } else if (/^(func_door|func_door_rotating)$/.test(cls) && /^\*\d+$/.test(e.model ?? "")) {
      const m = bsp.models[Number(e.model.slice(1))];
      if (!m) continue;
      brushDoors.push({ width: Math.max(m.max[0] - m.min[0], m.max[1] - m.min[1]), height: m.max[2] - m.min[2] });
    }
  }

  // ── loops: the coarse graph ──
  const coarseKey = (n) => {
    const [x, y, z] = centreOf(areas[n]);
    return `${Math.floor(x / COARSE)} ${Math.floor(y / COARSE)} ${Math.floor(z / COARSE_Z)}`;
  };
  const cellOf = new Map();
  for (const n of reachable) cellOf.set(n, coarseKey(n));
  const both = new Map(); // undirected, links both ways
  const forward = new Map(); // directed, every link
  for (const key of new Set(cellOf.values())) both.set(key, new Set()), forward.set(key, new Set());
  for (const n of reachable)
    for (const [m, , dz] of out[n]) {
      if (!reachSet.has(m)) continue;
      const a = cellOf.get(n);
      const b = cellOf.get(m);
      if (a === b) continue;
      forward.get(a).add(b);
      if (dz === null || out[m].some(([k]) => k === n)) both.get(a).add(b), both.get(b).add(a);
    }
  let edges = 0;
  for (const set of both.values()) edges += set.size;
  edges /= 2;
  let components = 0;
  {
    const seen = new Set();
    for (const key of both.keys()) {
      if (seen.has(key)) continue;
      components++;
      const stack = [key];
      seen.add(key);
      while (stack.length) for (const m of both.get(stack.pop())) if (!seen.has(m)) seen.add(m), stack.push(m);
    }
  }
  const cyclomatic = edges - both.size + components;
  let bypass = null;
  let routeCells = null;
  let alternatives = null;
  if (crossing) {
    // the cells the walked way passes, and for each whether the end is still reached without it
    const route = [];
    for (const n of crossing.pathAreas) {
      const key = cellOf.get(n);
      if (route[route.length - 1] !== key) route.push(key);
    }
    const first = route[0];
    const last = route[route.length - 1];
    const startCells = new Set(startSet.filter((n) => cellOf.has(n)).map((n) => cellOf.get(n)));
    const endCells = new Set(endSet.filter((n) => cellOf.has(n)).map((n) => cellOf.get(n)));
    // a cell of the way is BYPASSED when the end is still reached with a block of 3 x 3 cells about it taken
    // away (1536 units, some 39 m, across; a storey up and down too): another way round at that scale, a
    // parallel street or a second stair, not just the other side of a wide room
    const blockOf = (key) => {
      const [i, j, z] = key.split(" ").map(Number);
      const block = new Set();
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++) for (let dz = -1; dz <= 1; dz++) block.add(`${i + di} ${j + dj} ${z + dz}`);
      return block;
    };
    const reaches = (without) => {
      const seen = new Set([...startCells].filter((k) => !without.has(k)));
      const stack = [...seen];
      while (stack.length) {
        const k = stack.pop();
        if (endCells.has(k)) return true;
        for (const m of forward.get(k)) if (!without.has(m) && !seen.has(m)) seen.add(m), stack.push(m);
      }
      return false;
    };
    const tested = [];
    for (const k of new Set(route)) {
      const block = blockOf(k);
      if ([...startCells, ...endCells].some((c) => block.has(c)) || k === first || k === last) continue;
      tested.push([k, reaches(block)]);
    }
    routeCells = tested.length;
    bypass = share(tested.filter(([, ok]) => ok).length, tested.length);
    // the stretches of the way with another way round: runs of bypassed cells, in the way's order
    const ok = new Map(tested);
    let inRun = false;
    alternatives = 0;
    for (const k of route) {
      if (!ok.has(k)) continue;
      if (ok.get(k) && !inRun) alternatives++;
      inRun = ok.get(k);
    }
  }

  // ── pacing: the game's marks along the flow ──
  const fractionOf = (n) => (crossFlow ? flow[n] / crossFlow : null);
  const marks = {};
  const MARKS = ["BATTLEFIELD", "BATTLESTATION", "FINALE", "THREAT", "RESCUE_CLOSET", "NO_MOBS", "EMPTY", "OBSCURED"];
  for (const word of MARKS) {
    const list = reachable.filter((n) => has(areas[n], TERROR[word]));
    if (!list.length || !crossFlow) continue;
    const fractions = sorted(list.map(fractionOf).filter(Number.isFinite));
    // spans: fractions that follow on within a fiftieth of the crossing
    const spans = [];
    for (const f of fractions) {
      const s = spans[spans.length - 1];
      if (s && f - s[1] <= 0.02) s[1] = f;
      else spans.push([f, f]);
    }
    const areaShare = list.reduce((sum, n) => sum + areaOf(areas[n]), 0) / walkableArea;
    marks[word] = {
      areas: list.length,
      floorShare: round(areaShare, 3),
      spans: spans.filter((s) => word === "THREAT" || word === "RESCUE_CLOSET" || s[1] - s[0] >= 0.005 || spans.length < 12).map((s) => [round(s[0], 3), round(s[1], 3)]),
    };
  }
  // crescendos: the places that set off a panic event of the director (directly or through relays)
  // an output's fields are parted by commas, or (in newer maps) by the ESC character
  const OUTPUT_SEPARATOR = new RegExp("[,\u001b]");
  const directorNames = new Set(entities.filter((e) => e.classname === "info_director").map((e) => e.targetname).filter(Boolean));
  if (directorNames.size) directorNames.add("@director"); // the name the game gives the director whatever it is called
  const scriptNames = new Set(entities.filter((e) => e.classname === "logic_script" || e.vscripts).map((e) => e.targetname).filter(Boolean));
  const scriptsRead = new Map(); // a script's name -> what it says (null: not found)
  const readScript = (name) => {
    const said = directorScript(vpk, scriptCache, scriptRoots, name);
    scriptsRead.set(name.toLowerCase().replace(/\.nu[tc]$/, ""), said);
    return said;
  };
  const outputsOf = (e) =>
    e.__all
      .filter(([k, v]) => /^On|^Out/.test(k) && /[,\x1b]/.test(v))
      .map(([k, v]) => {
        const [target, input, param] = v.split(OUTPUT_SEPARATOR);
        return { output: k, target, input, param };
      });
  // a panic event; or a director script whose name says it is one (an onslaught, a gauntlet, a crescendo):
  // the other scripts a map begins (wanderers, fog, no bosses) set the mood, not an event
  // A director script is also an event when its own text says so (`directorScript`), and so is one run on
  // the director or a script entity with RunScriptFile, and code run with RunScriptCode that asks for a
  // panic or a mob
  const PANIC_NAME = /onslaught|panic|crescendo|gauntlet|horde|minifinale|event|ambush|alarm|church/i;
  const isPanic = (o) => {
    const input = o.input ?? "";
    const param = (o.param ?? "").trim();
    if (directorNames.has(o.target)) {
      if (/PanicEvent/i.test(input)) return true;
      if (/^BeginScript$/i.test(input) && param) return PANIC_NAME.test(param) || readScript(param)?.event === true;
    }
    if (directorNames.has(o.target) || scriptNames.has(o.target)) {
      if (/^RunScriptFile$/i.test(input) && param) return PANIC_NAME.test(param) || readScript(param)?.event === true;
      if (/^RunScriptCode$/i.test(input)) return EVENT_CODE.test(param);
    }
    return false;
  };
  const firesPanic = new Map();
  const panics = (e, depth = 0, seen = new Set()) => {
    if (seen.has(e)) return false;
    seen.add(e);
    for (const o of outputsOf(e)) {
      if (isPanic(o)) return true;
      if (depth < 4)
        for (const next of entities.filter((x) => x.targetname === o.target)) if (panics(next, depth + 1, seen)) return true;
    }
    return false;
  };
  // every script the map starts is read, so the list of event scripts is whole (the search stops at the
  // first panic it finds)
  for (const e of entities)
    for (const o of outputsOf(e))
      if ((directorNames.has(o.target) || scriptNames.has(o.target)) && /^(BeginScript|RunScriptFile)$/i.test(o.input ?? "") && o.param?.trim())
        readScript(o.param.trim());
  const crescendos = [];
  // what a player does or walks into (a button, a trigger, a door, a prop): not the logic, whose place in
  // the map is wherever its maker left it
  const unplaced = /^(logic_|info_|point_template|point_script|env_|ambient_|math_|filter_|game_|worldspawn$)/;
  for (const e of entities) {
    if (unplaced.test(e.classname ?? "") || !outputsOf(e).length) continue;
    if (!firesPanic.has(e)) firesPanic.set(e, panics(e));
    if (!firesPanic.get(e)) continue;
    const p = placeOf(e, bsp);
    if (!p || !crossFlow) continue;
    const n = nearestArea(p, reachable);
    if (n === null) continue;
    crescendos.push({ classname: e.classname, at: round(fractionOf(n), 3) });
  }
  const finales = entities
    .filter((e) => e.classname === "trigger_finale")
    .map((e) => placeOf(e, bsp))
    .filter(Boolean)
    .map((p) => round(fractionOf(nearestArea(p, reachable)), 3));
  const closets = (marks.RESCUE_CLOSET?.spans ?? []).map((s) => s[0]);

  // ── the numbers ──
  const cellsWide = (lo, hi) => widths.filter((w) => w >= lo && (hi === null || w < hi)).length;
  const result = {
    name: entry.name,
    files: { bsp: path.basename(entry.bsp), nav: path.basename(entry.nav), lumpFiles: (entry.lumps ?? []).map((p) => path.basename(p)) },
    nav: { version: nav.version, subversion: nav.subversion, areas: areas.length, reached: reachable.length, ladders: nav.ladders.length, linksClipped: clipped, playerBlockers: blockers.length, lifts },
    solids: { brushEntities: solidModels(entities).length, displacements: bsp.displacements.length, staticPropBoxes: boxes.length, staticProps: props ? propCount : null },
    places: cells.length,
    walkable: { area: round(walkableArea), navAreasReached: reachable.length, strandedArea: round(strandedArea) },
    width: spread(widths),
    sight: { ...spread(sights), beyond700: share(sights.filter((s) => s > SIGHT).length, sights.length) },
    headroom: {
      ...spread(heads.map((c) => c.headroom)),
      open: share(cells.length - heads.length, cells.length),
      underSky: share(sky, cells.length),
      corridors: spread(heads.filter((c) => c.width < BANDS[0]).map((c) => c.headroom)),
      rooms: spread(heads.filter((c) => c.width >= BANDS[0]).map((c) => c.headroom)),
      under600: spread(heads.map((c) => c.headroom).filter((h) => h < 600)),
    },
    withPropCollision: propCollide
      ? {
          props: propCount.hulls + propCount.boxes,
          hulls: propCount.hullCount,
          width: spread(cells.map((c) => c.widthC)),
          sight: { ...spread(cells.map((c) => c.sightC)), beyond700: share(cells.filter((c) => c.sightC > SIGHT).length, cells.length) },
          headroom: {
            ...spread(cells.filter((c) => Number.isFinite(c.headroomC)).map((c) => c.headroomC)),
            corridors: spread(cells.filter((c) => Number.isFinite(c.headroomC) && c.widthC < BANDS[0]).map((c) => c.headroomC)),
            under600: spread(cells.map((c) => c.headroomC).filter((h) => h < 600)),
            underProp: share(cells.filter((c) => c.propRoof).length, cells.length),
          },
          narrow: share(cells.filter((c) => c.widthC < NARROW).length, cells.length),
          under176: share(cells.filter((c) => c.widthC < BANDS[0]).length, cells.length),
          from176to352: share(cells.filter((c) => c.widthC >= BANDS[0] && c.widthC < BANDS[1]).length, cells.length),
          over352: share(cells.filter((c) => c.widthC >= BANDS[1]).length, cells.length),
        }
      : null,
    withPropBoxes: propSolid
      ? {
          boxes: boxes.length,
          width: spread(cells.map((c) => c.widthP)),
          sight: spread(cells.map((c) => c.sightP)),
          narrow: share(cells.filter((c) => c.widthP < NARROW).length, cells.length),
          under176: share(cells.filter((c) => c.widthP < BANDS[0]).length, cells.length),
        }
      : null,
    bands: {
      narrow: share(cellsWide(0, NARROW), widths.length),
      under176: share(cellsWide(0, BANDS[0]), widths.length),
      from176to352: share(cellsWide(BANDS[0], BANDS[1]), widths.length),
      over352: share(cellsWide(BANDS[1], null), widths.length),
    },
    vertical: {
      lowest: round(Math.min(...zs)),
      highest: round(Math.max(...zs)),
      range: round(Math.max(...zs) - Math.min(...zs)),
      p5p95: round(partOf(zs, 0.95) - partOf(zs, 0.05)),
    },
    steps: {
      rises: spread(rises, 1),
      climbs: spread(climbs),
      drops: { ...spread(drops), count: drops.length, oneWay },
      stairRisers: spread(risers, 1),
      stairTreads: spread(treads),
      stairFlights: { count: flights.length, rise: spread(flights) },
    },
    doors: {
      leaves: doorLeaves.length,
      leafWidth: spread(doorLeaves.map((d) => d.width)),
      leafHeight: spread(doorLeaves.map((d) => d.height)),
      openingWidth: spread(doorOpenings.map((d) => d.width)),
      checkpointWidth: spread(doorLeaves.filter((d) => d.checkpoint).map((d) => d.width)),
      brushDoors: { count: brushDoors.length, width: spread(brushDoors.map((d) => d.width)), height: spread(brushDoors.map((d) => d.height)) },
    },
    crossing: crossing && (({ pathAreas, ...rest }) => ({ ...rest, flowStored: false }))(crossing),
    loops: {
      coarseCells: both.size,
      coarseEdges: edges,
      cyclomatic,
      perKm: crossing ? round(cyclomatic / ((crossing.walked * UNIT_M) / 1000), 1) : null,
      routeCells,
      routeBypassable: bypass,
      alternatives,
    },
    pacing: crossFlow
      ? {
          crescendos: sorted(crescendos.map((c) => c.at)),
          crescendoClasses: [...new Set(crescendos.map((c) => c.classname))],
          directorScripts: {
            read: [...scriptsRead.values()].filter(Boolean).length,
            notFound: [...scriptsRead.values()].filter((v) => v === null).length,
            events: [...scriptsRead].filter(([, v]) => v?.event).map(([k]) => k).sort(),
          },
          finale: finales,
          rescueClosets: closets,
          marks,
        }
      : null,
    seconds: round((Date.now() - t0) / 1000, 1),
  };
  return result;
}

// ── the game's bands: one map, one vote ─────────────────────────────────────
function inUnits(stats, kind) {
  if (kind === "length") {
    const conv = (f) => Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, k === "n" || v === null ? v : round(f(v), 2)]));
    return { units: stats, metres: conv((v) => v * UNIT_M), playerHeights: conv((v) => v / PLAYER) };
  }
  if (kind === "area") {
    const conv = (f) => Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, k === "n" || v === null ? v : round(f(v), 0)]));
    return { squareUnits: stats, squareMetres: conv((v) => v * UNIT_M * UNIT_M), squarePlayerHeights: conv((v) => v / PLAYER / PLAYER) };
  }
  return stats;
}
function bandsOf(maps) {
  const pick = (f) => maps.map(f).filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  const L = (f) => inUnits(spread(pick(f), 1), "length");
  const S = (f) => spread(pick(f), 3);
  const per = (f) => spread(pick(f), 2);
  // every mark, where it begins along the crossing (its first span), and how much of the floor it holds
  const markWords = [...new Set(maps.flatMap((m) => Object.keys(m.pacing?.marks ?? {})))];
  const histogram = (lists) => {
    // each map's events share one vote among them; tenths of the crossing
    const bins = Array(10).fill(0);
    let voters = 0;
    for (const list of lists) {
      const l = list.filter((f) => f !== null && f >= 0 && f <= 1.05);
      if (!l.length) continue;
      voters++;
      for (const f of l) bins[Math.min(9, Math.floor(Math.min(f, 0.9999) * 10))] += 1 / l.length;
    }
    return { maps: voters, tenths: bins.map((b) => round(voters ? b / voters : 0, 3)) };
  };
  return {
    width: { median: L((m) => m.width.median), q1: L((m) => m.width.q1), q3: L((m) => m.width.q3), p5: L((m) => m.width.p5), p95: L((m) => m.width.p95) },
    sight: { median: L((m) => m.sight.median), q1: L((m) => m.sight.q1), q3: L((m) => m.sight.q3), beyond700: S((m) => m.sight.beyond700) },
    headroom: {
      median: L((m) => m.headroom.median),
      q1: L((m) => m.headroom.q1),
      q3: L((m) => m.headroom.q3),
      corridors: L((m) => m.headroom.corridors.median),
      rooms: L((m) => m.headroom.rooms.median),
      under600: L((m) => m.headroom.under600.median),
      underSky: S((m) => m.headroom.underSky),
      open: S((m) => m.headroom.open),
    },
    walkableArea: inUnits(spread(pick((m) => m.walkable.area), 0), "area"),
    narrowShare: S((m) => m.bands.narrow),
    withPropCollision: maps.some((m) => m.withPropCollision)
      ? {
          width: L((m) => m.withPropCollision?.width.median),
          widthQ1: L((m) => m.withPropCollision?.width.q1),
          widthQ3: L((m) => m.withPropCollision?.width.q3),
          sight: L((m) => m.withPropCollision?.sight.median),
          sightQ1: L((m) => m.withPropCollision?.sight.q1),
          sightQ3: L((m) => m.withPropCollision?.sight.q3),
          beyond700: S((m) => m.withPropCollision?.sight.beyond700),
          headroom: L((m) => m.withPropCollision?.headroom.median),
          headroomCorridors: L((m) => m.withPropCollision?.headroom.corridors.median),
          headroomUnder600: L((m) => m.withPropCollision?.headroom.under600.median),
          underProp: S((m) => m.withPropCollision?.headroom.underProp),
          narrowShare: S((m) => m.withPropCollision?.narrow),
          under176: S((m) => m.withPropCollision?.under176),
          from176to352: S((m) => m.withPropCollision?.from176to352),
          over352: S((m) => m.withPropCollision?.over352),
        }
      : null,
    withPropBoxes: maps.some((m) => m.withPropBoxes)
      ? {
          width: L((m) => m.withPropBoxes?.width.median),
          sight: L((m) => m.withPropBoxes?.sight.median),
          narrowShare: S((m) => m.withPropBoxes?.narrow),
          under176: S((m) => m.withPropBoxes?.under176),
        }
      : null,
    widthBands: { under176: S((m) => m.bands.under176), from176to352: S((m) => m.bands.from176to352), over352: S((m) => m.bands.over352) },
    vertical: { range: L((m) => m.vertical.range), p5p95: L((m) => m.vertical.p5p95) },
    steps: {
      linkRise: L((m) => m.steps.rises.median),
      stairRiser: L((m) => m.steps.stairRisers.median),
      stairTread: L((m) => m.steps.stairTreads.median),
      stairFlightRise: L((m) => m.steps.stairFlights.rise.median),
      stairFlightsPerMap: per((m) => m.steps.stairFlights.count),
      drop: L((m) => m.steps.drops.median),
      dropsPerMap: per((m) => m.steps.drops.count),
      oneWayDropsPerMap: per((m) => m.steps.drops.oneWay),
    },
    doors: {
      leafWidth: L((m) => m.doors.leafWidth.median),
      leafHeight: L((m) => m.doors.leafHeight.median),
      openingWidth: L((m) => m.doors.openingWidth.median),
      checkpointWidth: L((m) => m.doors.checkpointWidth.median),
      perMap: per((m) => m.doors.leaves),
      brushDoorWidth: L((m) => m.doors.brushDoors.width.median),
      brushDoorHeight: L((m) => m.doors.brushDoors.height.median),
    },
    crossing: {
      walked: L((m) => m.crossing?.walked),
      straight: L((m) => m.crossing?.straight),
      ratio: per((m) => m.crossing?.ratio),
      ratioNotFinale: per((m) => (m.crossing && !m.crossing.finale ? m.crossing.ratio : null)),
      walkedNotFinale: L((m) => (m.crossing && !m.crossing.finale ? m.crossing.walked : null)),
      rise: L((m) => m.crossing?.rise),
    },
    loops: {
      cyclomatic: per((m) => m.loops.cyclomatic),
      perKm: per((m) => m.loops.perKm),
      routeBypassable: S((m) => m.loops.routeBypassable),
      alternatives: per((m) => m.loops.alternatives),
      alternativesPerKm: per((m) => (m.crossing && m.loops.alternatives !== null ? m.loops.alternatives / ((m.crossing.walked * UNIT_M) / 1000) : null)),
    },
    pacing: {
      mapsWithCrescendo: maps.filter((m) => m.pacing?.crescendos.length).length,
      firstCrescendo: S((m) => (m.pacing?.crescendos.length ? m.pacing.crescendos[0] : null)),
      crescendoTenths: histogram(maps.map((m) => m.pacing?.crescendos ?? [])),
      rescueClosetsPerMap: per((m) => (m.pacing ? m.pacing.rescueClosets.length : null)),
      rescueClosetTenths: histogram(maps.map((m) => m.pacing?.rescueClosets ?? [])),
      finaleAt: S((m) => (m.pacing?.finale.length ? m.pacing.finale[0] : null)),
      marks: Object.fromEntries(
        markWords.map((word) => [
          word,
          {
            maps: maps.filter((m) => m.pacing?.marks[word]).length,
            firstAt: S((m) => m.pacing?.marks[word]?.spans[0]?.[0] ?? null),
            floorShare: S((m) => m.pacing?.marks[word]?.floorShare ?? null),
            tenths: histogram(maps.map((m) => (m.pacing?.marks[word]?.spans ?? []).map((s) => (s[0] + s[1]) / 2))),
          },
        ]),
      ),
    },
  };
}

// ── the command ─────────────────────────────────────────────────────────────
function argsOf(argv) {
  const args = { props: false, quiet: false };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === "--game") args.game = argv[++k];
    else if (a === "--root") args.root = argv[++k];
    else if (a === "--maps") args.maps = argv[++k].split(",");
    else if (a === "--out") args.out = argv[++k];
    else if (a === "--props") args.props = true;
    else if (a === "--quiet") args.quiet = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

function main() {
  const args = argsOf(process.argv.slice(2));
  const game = GAMES[args.game];
  if (!game) throw new Error(`--game: one of ${Object.keys(GAMES).join(", ")}`);
  const root = args.root ?? process.env.L4D2_DIR ?? game.root;
  const out = args.out ?? path.join(HERE, "..", "corpus", `levels-${args.game}.json`);
  const vpk = openVpks(game.folders.map((f) => path.join(root, f, "pak01_dir.vpk")));
  const boxCache = new Map();
  const phyCache = new Map();
  const scriptCache = new Map();
  const scriptRoots = game.folders.map((f) => path.join(root, f));
  let entries = mapFiles(game, root);
  if (args.maps) entries = entries.filter((e) => args.maps.includes(e.name));
  const t0 = Date.now();
  const maps = [];
  const failed = [];
  for (const entry of entries) {
    if (!entry.bsp || !entry.nav) {
      failed.push({ name: entry.name, why: `no ${entry.bsp ? ".nav" : ".bsp"}` });
      continue;
    }
    try {
      const m = surveyMap(entry, { vpk, boxCache, phyCache, scriptCache, scriptRoots, props: args.props });
      maps.push(m);
      if (!args.quiet)
        console.log(
          `${m.name.padEnd(24)} places ${String(m.places).padStart(6)}  width ${m.width.median}${m.withPropCollision ? `/${m.withPropCollision.width.median}` : ""}  sight ${m.sight.median}${m.withPropCollision ? `/${m.withPropCollision.sight.median}` : ""}  head ${m.headroom.median}  narrow ${m.bands.narrow}  walk ${m.crossing?.walked ?? "-"} x${m.crossing?.ratio ?? "-"}  loops ${m.loops.cyclomatic}  ${m.seconds}s`,
        );
    } catch (error) {
      failed.push({ name: entry.name, why: error.message });
      if (!args.quiet) console.log(`${entry.name}: FAILED ${error.message}`);
    }
  }
  const seconds = round((Date.now() - t0) / 1000, 1);
  const corpus = {
    game: game.name,
    engine: "Source (VBSP 21, nav 16/14)",
    tool: "levels/tools/survey-source.mjs",
    made: new Date().toISOString().slice(0, 10),
    method: {
      unit: { metres: UNIT_M, playerHeight: PLAYER },
      grid: GRID, eye: EYE, far: FAR, ways: WAYS, overFloor: OVER_FLOOR, bands: BANDS, narrow: NARROW, sight: SIGHT,
      floor: "the nav areas reached from the start (links one way, ladders both), each place of the 32 grid inside one, at its height from the four corners",
      solid: `world brushes solid or window; func_brush (unless never solid), func_wall, func_breakable, func_breakable_surf; displacements. Doors open; clips, grates, water not solid. Static props are not solid in width, sight and headroom (they are models; their collision is not read)${args.props ? "; withPropCollision repeats width, sight and headroom with the static props as the engine collides with them (solid 6: the convex hulls of the model's .phy, first solid; solid 2: the model's box; solid 0 and solid 6 without a .phy: not solid), placed by origin and angles; withPropBoxes repeats width and sight with every solid static prop as its model's box (an upper bound)" : ""}`,
      flow: "not stored in the .nav: the walked distance from the start areas along the nav links (Dijkstra, area middles through the edges' middles), as the game itself works it out at load",
      stats: "per map: median, q1, q3, p5, p95 of its places; per game: n, median, q1, q3, p5, p95 of the maps' values (one map, one vote)",
    },
    seconds,
    measured: maps.length,
    failed,
    bands: maps.length ? bandsOf(maps) : null,
    maps,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(corpus, null, 1)}\n`);
  console.log(`${failed.length ? "WARN" : "PASS"}: ${maps.length} maps measured in ${seconds} s, ${failed.length} failed; ${path.relative(process.cwd(), out)}`);
}

main();
