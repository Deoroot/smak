#!/usr/bin/env node
// Each property of a role-play city measured by its kind (home, shop, jail, hideout, public, other): its rooms'
// floor, sides and ceiling, its doors and what floor they open on, its windows, what stands in its rooms (props
// and items by class and by model file, switches, lights, the floor's light); a jail's cells; where the spawns
// stand. Banded across the cities, a city one vote. The data a generator sizes and furnishes an RP map's
// properties by (levels/notes-rp-rooms.md).
//
//   node levels/tools/survey-rp-rooms.mjs [--root C:/Juegos/H9XASH/ts] [--maps a,b,c] [--jobs 1]
//                                         [--models <folder>;<folder>] [--out levels/corpus/rp-rooms.json]
//
// It stands on the city measures (levels/lib/city-measures.mjs): measureLevel's walked places, cut at the doors
// by cityOf, asked with `cityDetail` for the cut itself. Rooms, buildings (a property) and their kinds are
// cityOf's, exactly as levels/notes-rp-city.md says. MEASURES ONLY: numbers, counts of classnames, and the file
// names of the models the maps place (which the game's own folders hold); no geometry, entity, texture or name
// of a map. Deterministic: the same maps give the same file.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { measureLevel } from "../lib/goldsrc-level-measures.mjs";
import { kindOfName, CITY } from "../lib/city-measures.mjs";
import { modelFaces, facePolygon, faceNormal, faceTexture, contentsAt, CONTENTS } from "../../src/maps/bsp.mjs";
import { valueOf, originOf, brushModelOf, numberOf } from "../../src/maps/entities.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(HERE, "../..");
const UNIT_M = 0.0254;
const M2 = UNIT_M * UNIT_M;
const MAPS = ["alexandria_msr_b5", "paradisecity_revival_final", "xenoncity_final"];
const ROOT = "C:/Juegos/H9XASH/ts";
const MODEL_FOLDERS = ["C:/Juegos/H9XASH/ts", "C:/Juegos/Steam/steamapps/common/Half-Life/ts"];
export const KINDS = ["home", "shop", "jail", "public", "hideout", "other", "unnamed"];

const DOOR = /^(func_door|func_door_rotating|momentary_door)$/;
const SWITCH = /^(func_button|func_rot_button|momentary_rot_button)$/;
const LIGHT = /^(light|light_spot)$/;
const PROP = /^(ts_model|cycler|cycler_sprite|cycler_wreckage|env_model|monster_furniture|monster_generic)$/;
const ITEM = /^(item_|weapon_|ammo_|ts_groundweapon|ts_powerup)/;
/** what is not furniture: the world, doors, triggers and logic */
const NOT_FURNITURE = /^(worldspawn|func_door|func_door_rotating|momentary_door|trigger_|multi_manager|multisource|info_|path_|env_global|game_|func_plat|func_train|func_tracktrain|func_ladder|light_environment|infodecal)/;
/** a glass texture, by its name */
const GLASS = /glass|window|wndw|^win_|^\{?win|pane\b/i;
/** brush entities that may be a window */
const PANEL = /^(func_breakable|func_wall|func_illusionary|func_wall_toggle|func_pushable)$/;
/** the floor a door opens on is a plaza this wide (CITY.plazaWidth: 12 m) */
const PLAZA_WIDE = CITY.plazaWidth;

// ── small arithmetic ────────────────────────────────────────────────────────
const round = (v, places = 2) => (v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(places)));
/** a weighted quantile of [value, weight] pairs sorted by value */
function weightedAt(pairs, q) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  if (!total) return null;
  const target = q * total;
  let run = 0;
  for (let k = 0; k < pairs.length; k++) {
    const [v, w] = pairs[k];
    if (run + w >= target) {
      // between this value and the next, as far as the target lies into this weight's half
      const next = pairs[k + 1];
      if (!next || run + w / 2 >= target) return v;
      const t = (target - (run + w / 2)) / ((w + next[1]) / 2);
      return v + (next[0] - v) * Math.max(0, Math.min(1, t));
    }
    run += w;
  }
  return pairs[pairs.length - 1][0];
}
/** n, median, p10, p90 of a list (each value its weight, 1 when none) */
export function bandOf(values, weights = null, places = 2) {
  const pairs = values
    .map((v, k) => [v, weights ? weights[k] : 1])
    .filter(([v, w]) => Number.isFinite(v) && w > 0)
    .sort((a, b) => a[0] - b[0]);
  if (!pairs.length) return null;
  return {
    n: pairs.length,
    median: round(weightedAt(pairs, 0.5), places),
    p10: round(weightedAt(pairs, 0.1), places),
    p90: round(weightedAt(pairs, 0.9), places),
  };
}
const median = (list) => bandOf(list)?.median ?? null;
const add = (map, key, n = 1) => (map[key] = (map[key] ?? 0) + n);

// ── one map ─────────────────────────────────────────────────────────────────
/** The box of a brush entity in the map (its model moved by its origin), or null. */
function boxOf(bsp, entity) {
  const number = brushModelOf(entity);
  const model = number === null ? null : bsp.models[number];
  if (!model) return null;
  const origin = originOf(entity) ?? [0, 0, 0];
  return { number, min: model.mins.map((v, a) => v + origin[a]), max: model.maxs.map((v, a) => v + origin[a]) };
}
const centreOf = (box) => box.min.map((v, a) => (v + box.max[a]) / 2);
/** the straight distance from a point to a box */
const toBox = (p, box) => Math.hypot(...[0, 1, 2].map((a) => Math.max(box.min[a] - p[a], 0, p[a] - box.max[a])));
/** a model file's name, as the game's folders hold it (lower case, forward slashes) */
const modelFile = (value) => (value && /\.mdl$/i.test(value) ? value.replace(/\\/g, "/").toLowerCase().replace(/^\.?\//, "") : null);

/**
 * One city's properties, rooms, cells and spawns, from measureLevel's record asked with `city` and `cityDetail`.
 * Every number in units is turned to metres (areas m2); nothing of the map's own but counts and model files.
 */
export function roomsOfCity(record) {
  const { built, input, detail } = record.city._detail;
  const cells = input.cells;
  const grid = CITY.grid;
  const pxM2 = (grid * UNIT_M) ** 2;
  const { part, parts, isRoom, publicPart, doorNode, doorNodes, buildings, layerOf, streetLayer } = detail;
  const doors = input.doors;

  // the places by column, to find the place under a point
  const mod = (v) => ((v % grid) + grid) % grid;
  const ox = mod(cells[0].at[0]);
  const oy = mod(cells[0].at[1]);
  const byColumn = new Map();
  cells.forEach((c, i) => {
    const key = `${c.at[0]},${c.at[1]}`;
    (byColumn.get(key) ?? byColumn.set(key, []).get(key)).push(i);
  });
  const reachOver = (c) => (c.sky || !Number.isFinite(c.headroom) ? 4096 : c.headroom + 16);
  /** the walked place a point stands over (its own column, else one or two columns round): -1 when none */
  const placeOf = ([x, y, z], most = 2) => {
    const cx = Math.round((x - ox) / grid) * grid + ox;
    const cy = Math.round((y - oy) / grid) * grid + oy;
    for (let r = 0; r <= most; r++) {
      let best = -1;
      let bestScore = Infinity;
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          for (const i of byColumn.get(`${cx + dx * grid},${cy + dy * grid}`) ?? []) {
            const c = cells[i];
            if (c.at[2] > z + 24 || z > c.at[2] + reachOver(c)) continue;
            const score = (z - c.at[2]) + 0.5 * Math.hypot(c.at[0] - x, c.at[1] - y);
            if (score < bestScore) (best = i), (bestScore = score);
          }
        }
      if (best >= 0) return best;
    }
    return -1;
  };
  /** the parts whose floor lies round a box (a window's two sides): places within `pad` of it, floor under its top */
  const partsRound = (box, pad = 48) => {
    const found = new Set();
    for (let x = Math.ceil((box.min[0] - pad - ox) / grid) * grid + ox; x <= box.max[0] + pad; x += grid)
      for (let y = Math.ceil((box.min[1] - pad - oy) / grid) * grid + oy; y <= box.max[1] + pad; y += grid)
        for (const i of byColumn.get(`${x},${y}`) ?? [])
          if (cells[i].at[2] >= box.min[2] - 128 && cells[i].at[2] <= box.max[2] && part[i] >= 0) found.add(part[i]);
    return found;
  };

  // ── each room ──
  const roomOfPart = new Map(); // part -> row
  const buildingOfPart = new Map();
  buildings.forEach((b, k) => b.rooms.forEach((p) => buildingOfPart.set(p, k)));
  const rows = [];
  for (const [p, list] of parts.entries()) {
    if (!isRoom[p]) continue;
    const xs = list.map((i) => cells[i].at[0]);
    const ys = list.map((i) => cells[i].at[1]);
    const sides = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)].map((s) => (s + grid) * UNIT_M).sort((a, b) => a - b); // prettier-ignore
    const heads = list.filter((i) => !cells[i].sky && Number.isFinite(cells[i].headroom)).map((i) => cells[i].headroom * UNIT_M);
    const light = list.map((i) => cells[i].light).filter(Number.isFinite);
    const k = buildingOfPart.get(p);
    const row = {
      property: k,
      kind: buildings[k].kind,
      areaM2: round(list.length * pxM2, 1),
      shortM: round(sides[0]),
      longM: round(sides[1]),
      ceilingM: round(median(heads)),
      floorLight: round(median(light), 1),
      doorways: 0, // the door nodes it touches, counted below
      lights: 0,
      switches: 0,
      props: 0,
      items: 0,
      glass: { panels: 0, breakable: 0, faces: 0, faceM2: 0 },
      byClass: {},
      models: {},
    };
    roomOfPart.set(p, row);
    rows.push(row);
  }
  doorNodes.forEach((d) => d.touches.forEach((p) => roomOfPart.has(p) && roomOfPart.get(p).doorways++));

  // ── the public floor's own furniture (what stands in the streets, corridors and squares) ──
  const publicPlaces = cells.reduce((n, _, i) => n + (part[i] >= 0 && !isRoom[part[i]] ? 1 : 0), 0);
  const street = { areaM2: Math.round(publicPlaces * pxM2), lights: 0, switches: 0, props: 0, items: 0, byClass: {}, models: {} };

  // ── what stands where: point entities by their origin, brush entities by their box's middle ──
  const cellDoorClasses = {};
  const spawnsAt = [];
  const doorBoxes = [];
  const glassBrushes = [];
  const placed = {}; // props, lights and switches by where they stand
  const cellDoorBoxes = [];
  const switchesAt = [];
  const lightsAt = [];
  built.entities.forEach((entity) => {
    const classname = valueOf(entity, "classname") ?? "";
    const box = boxOf(built, entity);
    const name = valueOf(entity, "targetname") ?? null;
    if (DOOR.test(classname)) {
      if (box) doorBoxes.push(box);
      if (name && kindOfName(name) === "jail") {
        add(cellDoorClasses, classname);
        if (box) cellDoorBoxes.push(box);
      }
    }
    if (SWITCH.test(classname) && box) switchesAt.push(centreOf(box));
    if (LIGHT.test(classname) && originOf(entity)) lightsAt.push(originOf(entity));
    if (/^info_player_(deathmatch|start)$/.test(classname) && originOf(entity)) spawnsAt.push({ classname, at: originOf(entity) });
    if (box && PANEL.test(classname)) {
      const textures = modelFaces(built, box.number).map((f) => (faceTexture(built, f)?.name ?? "").toLowerCase());
      const size = box.max.map((v, a) => v - box.min[a]);
      const thin = Math.min(size[0], size[1]) <= 16 && Math.max(size[0], size[1]) >= 16 && size[2] >= 16;
      const translucent = [2, 4].includes(numberOf(entity, "rendermode") ?? 0) && (numberOf(entity, "renderamt") ?? 255) < 255;
      const glassBreakable = classname === "func_breakable" && (numberOf(entity, "material") ?? 0) === 0;
      const glassTexture = textures.some((t) => GLASS.test(t));
      if (glassTexture || (thin && (glassBreakable || translucent))) glassBrushes.push({ box, breakable: classname === "func_breakable" });
    }
    if (NOT_FURNITURE.test(classname)) return;
    const at = box ? centreOf(box) : originOf(entity);
    if (!at) return;
    if (PANEL.test(classname) && box) return; // scenery brushes: windows are counted apart, walls are no furniture
    const i = placeOf(at);
    const counted = PROP.test(classname) ? "props" : LIGHT.test(classname) ? "lights" : SWITCH.test(classname) ? "switches" : null;
    const tally = (where) => counted && add((placed[counted] ??= {}), where);
    if (i < 0) return void tally("off the walked floor");
    if (part[i] < 0) return void tally("a doorway");
    const target = isRoom[part[i]] ? roomOfPart.get(part[i]) : street;
    if (!target) return;
    tally(target === street ? "public floor" : "rooms");
    add(target.byClass, classname);
    if (LIGHT.test(classname)) target.lights++;
    if (SWITCH.test(classname)) target.switches++;
    if (PROP.test(classname)) target.props++;
    if (ITEM.test(classname)) target.items++;
    const file = PROP.test(classname) || ITEM.test(classname) ? modelFile(valueOf(entity, "model")) : null;
    if (file) add(target.models, file);
  });
  // windows: glass brushes, by the rooms on either side; the world's glass faces (walls), by area
  for (const g of glassBrushes)
    for (const p of partsRound(g.box)) {
      const row = roomOfPart.get(p);
      if (!row) continue;
      row.glass.panels++;
      if (g.breakable) row.glass.breakable++;
    }
  let glassFaces = 0;
  for (const face of modelFaces(built, 0)) {
    const t = (faceTexture(built, face)?.name ?? "").toLowerCase();
    if (!GLASS.test(t) || Math.abs(faceNormal(built, face)[2]) >= 0.3) continue;
    glassFaces++;
    const points = facePolygon(built, face);
    const min = [0, 1, 2].map((a) => Math.min(...points.map((q) => q[a])));
    const max = [0, 1, 2].map((a) => Math.max(...points.map((q) => q[a])));
    const area = areaOf(points) * M2;
    for (const p of partsRound({ min, max }, 40)) {
      const row = roomOfPart.get(p);
      if (!row) continue;
      row.glass.faces++;
      row.glass.faceM2 = round(row.glass.faceM2 + area, 2);
    }
  }

  // ── each property (a building of cityOf's) ──
  const offOf = (n) => {
    // the public places a door node touches, read for where it opens: plaza (12 m wide or more), street (under
    // sky), corridor (roofed, on the street layer) or landing (roofed, on another layer)
    const touching = [];
    for (const i of doorNodes[n].places) for (const j of nbrs(i)) if (part[j] >= 0 && !isRoom[part[j]]) touching.push(j);
    if (!touching.length) return null;
    const wide = median(touching.map((j) => cells[j].width));
    if (wide >= PLAZA_WIDE) return "plaza";
    const sky = touching.filter((j) => cells[j].sky).length / touching.length;
    if (sky >= 0.5) return "street";
    const layers = touching.map((j) => layerOf[j]);
    const onStreet = layers.filter((k) => k === streetLayer).length / layers.length;
    return onStreet >= 0.5 ? "corridor" : "landing";
  };
  // the four neighbours on one floor (cityOf's graph is not kept: rebuilt for the door's own places)
  const nbrs = (i) => {
    const c = cells[i];
    const out = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let best = -1;
      let bestDz = Infinity;
      for (const j of byColumn.get(`${c.at[0] + dx * grid},${c.at[1] + dy * grid}`) ?? []) {
        const dz = Math.abs(cells[j].at[2] - c.at[2]);
        if (dz <= CITY.sameFloor && dz < bestDz) (best = j), (bestDz = dz);
      }
      if (best >= 0) out.push(best);
    }
    return out;
  };
  const sizeOfNode = (n) => {
    const panels = doorNodes[n].panels.map((k) => doors[k]);
    if (!panels.length) return null;
    const min = [0, 1, 2].map((a) => Math.min(...panels.map((d) => d.min[a])));
    const max = [0, 1, 2].map((a) => Math.max(...panels.map((d) => d.max[a])));
    return { widthM: round(Math.max(max[0] - min[0], max[1] - min[1]) * UNIT_M), heightM: round((max[2] - min[2]) * UNIT_M) };
  };
  const properties = buildings.map((b, k) => {
    const entrances = b.doorNodes.filter((n) => doorNodes[n].touches.some((p) => !isRoom[p]));
    const own = rows.filter((r) => r.property === k);
    return {
      kind: b.kind,
      layer: b.layer,
      rooms: b.rooms.length,
      areaM2: round(own.reduce((s, r) => s + r.areaM2, 0), 1),
      doorways: b.doorNodes.length,
      doorPanels: new Set(b.doorNodes.flatMap((n) => doorNodes[n].panels)).size,
      entrances: entrances.length,
      off: entrances.map(offOf).filter(Boolean),
      doorSizes: entrances.map(sizeOfNode).filter(Boolean),
      innerDoorSizes: b.doorNodes.filter((n) => !entrances.includes(n)).map(sizeOfNode).filter(Boolean),
      props: own.reduce((s, r) => s + r.props, 0),
      lights: own.reduce((s, r) => s + r.lights, 0),
      switches: own.reduce((s, r) => s + r.switches, 0),
    };
  });

  // ── jail: cells behind cell doors ──
  const cellNodes = doorNodes
    .map((d, n) => ({ n, d }))
    .filter(({ d }) => d.panels.some((k) => doors[k].name && kindOfName(doors[k].name) === "jail"));
  const cellRows = [];
  const blocks = new Map(); // the part cells open on -> cells (a part, or `small:<node>` for a small cell)
  const toBlock = (onto, cell) => (blocks.get(onto) ?? blocks.set(onto, []).get(onto)).push(cell);
  // a small cell: a cell door whose floor beyond touches no part (the cell is under 4 places, 2.7 m2 of walked
  // floor, and cityOf gives it to the doorway); its door node's own floor is the most its cell can be
  const smallCells = cellNodes.filter(({ d }) => d.touches.length === 1).map(({ n, d }) => ({ n, onto: d.touches[0], nodeM2: d.places.length * pxM2, door: sizeOfNode(n) })); // prettier-ignore
  const blockParts = new Set(smallCells.map((c) => c.onto));
  for (const c of smallCells) toBlock(c.onto, `small:${c.n}`);
  for (const { n, d } of cellNodes) {
    if (d.touches.length < 2) continue;
    // the cell: the smallest room the door touches that is no cell block itself
    const rooms = d.touches.filter((p) => isRoom[p] && !blockParts.has(p)).sort((a, b) => parts[a].length - parts[b].length);
    if (!rooms.length) continue;
    const cell = rooms[0];
    const onto = d.touches.filter((p) => p !== cell).sort((a, b) => parts[b].length - parts[a].length)[0] ?? -1;
    if (cellRows.some((c) => c.part === cell)) continue;
    cellRows.push({ part: cell, onto, row: roomOfPart.get(cell), door: sizeOfNode(n) });
    toBlock(onto, cell);
  }
  const jail = {
    traced: tracedCells(built, cellDoorBoxes, switchesAt, lightsAt, doorBoxes),
    cellDoorPanels: doors.filter((d) => d.name && kindOfName(d.name) === "jail").length,
    cellDoorEntities: Object.values(cellDoorClasses).reduce((s, n) => s + n, 0),
    cellDoorClasses,
    cellDoorways: cellNodes.length,
    cells: cellRows.length + smallCells.length,
    cutCells: cellRows.length,
    smallCells: smallCells.length,
    smallCellNodeM2: bandOf(smallCells.map((c) => c.nodeM2)),
    smallCellDoor: { widthM: bandOf(smallCells.map((c) => c.door?.widthM)), heightM: bandOf(smallCells.map((c) => c.door?.heightM)) },
    cellM2: bandOf(cellRows.map((c) => c.row.areaM2)),
    cellShortM: bandOf(cellRows.map((c) => c.row.shortM)),
    cellLongM: bandOf(cellRows.map((c) => c.row.longM)),
    cellCeilingM: bandOf(cellRows.map((c) => c.row.ceilingM)),
    cellDoor: { widthM: bandOf(cellRows.map((c) => c.door?.widthM)), heightM: bandOf(cellRows.map((c) => c.door?.heightM)) },
    cellProps: bandOf(cellRows.map((c) => c.row.props)),
    cellLights: bandOf(cellRows.map((c) => c.row.lights)),
    cellModels: sumModels(cellRows.map((c) => c.row)),
    cellList: cellRows.map((c) => ({ ...c.row, doorWidthM: c.door?.widthM ?? null, doorHeightM: c.door?.heightM ?? null })),
    blocks: [...blocks].map(([onto, list]) => {
      const row = roomOfPart.get(onto);
      // the property: the cells' own (a cut cell), else the block's (a small cell opens on a room of it)
      const k = buildingOfPart.get(list.find((c) => typeof c === "number")) ?? buildingOfPart.get(onto);
      const others = k === undefined ? [] : buildings[k].rooms.filter((p) => !list.includes(p) && p !== onto).map((p) => roomOfPart.get(p));
      return {
        cells: list.length,
        smallCells: list.filter((c) => typeof c === "string").length,
        onto: onto < 0 ? "none" : onto === publicPart || !isRoom[onto] ? "public floor" : `a room of the ${buildingOfPart.has(onto) ? buildings[buildingOfPart.get(onto)].kind : "?"} property`,
        ontoM2: onto < 0 ? null : round(parts[onto].length * pxM2, 1),
        ontoShortM: row ? row.shortM : null,
        ontoSwitches: row ? row.switches : null,
        ontoLights: row ? row.lights : null,
        // a guard post: another room of the jail's property beside the cells and their corridor
        otherRooms: others.length,
        otherRoomM2: others.map((r) => r.areaM2).sort((a, b) => a - b),
        otherSwitches: others.reduce((s, r) => s + r.switches, 0),
        propertySwitches: k === undefined ? null : buildings[k].rooms.map((p) => roomOfPart.get(p)).reduce((s, r) => s + r.switches, 0),
        propertyKind: k === undefined ? null : buildings[k].kind,
      };
    }),
  };

  // ── spawns ──
  const spawns = spawnsAt
    .filter((s) => s.classname === "info_player_deathmatch")
    .map((s) => {
      const i = placeOf([s.at[0], s.at[1], s.at[2] - 36], 2);
      const p = i >= 0 ? part[i] : -2;
      const where = i < 0 ? "off the walked floor" : p < 0 ? "a doorway" : isRoom[p] ? `a ${roomOfPart.get(p).kind} room` : "public floor";
      const toDoor = doorBoxes.length ? Math.min(...doorBoxes.map((b) => toBox(s.at, b))) * UNIT_M : null;
      return { at: s.at, where, toDoorM: toDoor, sky: i >= 0 ? cells[i].sky : null, layer: i >= 0 ? layerOf[i] - streetLayer : null };
    });
  const nearest = spawns.map((s, k) => {
    let best = Infinity;
    spawns.forEach((t, j) => j !== k && (best = Math.min(best, Math.hypot(...s.at.map((v, a) => v - t.at[a])))));
    return Number.isFinite(best) ? best * UNIT_M : null;
  });
  const pairs = [];
  for (let a = 0; a < spawns.length; a++)
    for (let b = a + 1; b < spawns.length; b++) pairs.push(Math.hypot(...spawns[a].at.map((v, x) => v - spawns[b].at[x])) * UNIT_M);
  // groups of spawns: within 4 m of one another, chained
  const group = spawns.map((_, k) => k);
  const top = (k) => (group[k] === k ? k : (group[k] = top(group[k])));
  spawns.forEach((s, a) => spawns.forEach((t, b) => b > a && Math.hypot(...s.at.map((v, x) => v - t.at[x])) * UNIT_M <= 4 && (group[top(a)] = top(b))));
  const groups = {};
  spawns.forEach((_, k) => add(groups, top(k)));
  const whereCount = {};
  for (const s of spawns) add(whereCount, s.where);
  const spawn = {
    count: spawns.length,
    others: spawnsAt.filter((s) => s.classname !== "info_player_deathmatch").length,
    where: whereCount,
    underSky: spawns.filter((s) => s.sky).length,
    onStreetLayer: spawns.filter((s) => s.layer === 0).length,
    groups: Object.keys(groups).length,
    perGroup: bandOf(Object.values(groups)),
    nearestM: bandOf(nearest),
    betweenM: bandOf(pairs),
    toDoorM: bandOf(spawns.map((s) => s.toDoorM)),
  };

  return {
    name: record.name,
    walkFrom: record.walkFrom,
    reachedShare: record.reachedShare,
    walkedM2: record.city.walkedM2,
    glassFacesInWorld: glassFaces,
    glassBrushes: glassBrushes.length,
    placed,
    rooms: rows,
    properties,
    street,
    jail,
    spawn,
  };
}

function areaOf(points) {
  const sum = [0, 0, 0];
  for (let k = 0; k < points.length; k++) {
    const a = points[k];
    const b = points[(k + 1) % points.length];
    sum[0] += a[1] * b[2] - a[2] * b[1];
    sum[1] += a[2] * b[0] - a[0] * b[2];
    sum[2] += a[0] * b[1] - a[1] * b[0];
  }
  return Math.hypot(...sum) / 2;
}

/**
 * A jail's cells read from their doors, not from the cut (cells smaller than four places, or doors whose pads
 * run together along a row, are lost to the cut): from each cell door's middle, 40 units over its foot, the
 * world is traced both ways across the door until solid. The shorter run is the cell's depth, the longer the
 * floor in front of it (a corridor's width, up to 1536); from a point inside the cell, the run each way along
 * the door is its width. A door with no wall within 8 m on either side is a jail's door, not a cell's. Doors
 * in one plane (24 units), at one height (32) and in sequence (pitch 8 m or under) are a row of cells; each row
 * has its nearest switch, its lights within 8 m and the nearest door that is no cell's (the block's way in).
 */
export function tracedCells(bsp, boxes, switchesAt, lightsAt, allDoors) {
  const solid = (p) => {
    try {
      return contentsAt(bsp, p) === CONTENTS.SOLID;
    } catch {
      return true;
    }
  };
  const run = (from, axis, sign, most = 1536) => {
    for (let t = 0; t <= most; t += 4) {
      const p = from.slice();
      p[axis] += sign * t;
      if (solid(p)) return t;
    }
    return Infinity;
  };
  // one door a cell: panels whose middles lie within 24 units are one doorway (double doors, bars and a door)
  const doorways = [];
  for (const box of boxes) {
    const c = centreOf(box);
    const same = doorways.find((d) => Math.hypot(d.c[0] - c[0], d.c[1] - c[1]) <= 24 && Math.abs(d.min[2] - box.min[2]) <= 32);
    if (same) {
      same.min = same.min.map((v, a) => Math.min(v, box.min[a]));
      same.max = same.max.map((v, a) => Math.max(v, box.max[a]));
      same.c = centreOf(same);
    } else doorways.push({ min: box.min.slice(), max: box.max.slice(), c });
  }
  const cells = [];
  const notCells = [];
  let hatches = 0;
  for (const d of doorways) {
    const size = d.max.map((v, a) => v - d.min[a]);
    const across = size[0] <= size[1] ? 0 : 1;
    const along = 1 - across;
    // a doorway as the cut takes it: 64 high, 24 wide or more (a hatch or a food slot is not a cell's door)
    if (size[2] < 64 || size[along] < 24) {
      hatches++;
      continue;
    }
    const z = d.min[2] + 40;
    const front = (sign) => {
      const p = [d.c[0], d.c[1], z];
      p[across] += sign * (size[across] / 2 + 2);
      return p;
    };
    const plus = run(front(1), across, 1);
    const minus = run(front(-1), across, -1);
    const depth = Math.min(plus, minus);
    const corridor = Math.max(plus, minus);
    if (!Number.isFinite(depth) || depth > 8 / UNIT_M) {
      notCells.push(d);
      continue;
    }
    const sign = plus <= minus ? 1 : -1;
    const inside = front(sign);
    inside[across] += sign * Math.min(depth / 2, 48);
    const sideA = run(inside, along, 1, 1024);
    const sideB = run(inside, along, -1, 1024);
    // nothing free at the start: the point is in a wall, the width is not read
    const width = sideA === 0 || sideB === 0 ? NaN : sideA + sideB;
    cells.push({
      door: d,
      across,
      side: sign, // the cell lies this way across its door

      plane: d.c[across],
      at: d.c[along],
      z: d.min[2],
      depthM: round((depth + size[across] / 2) * UNIT_M),
      widthM: Number.isFinite(width) ? round(width * UNIT_M) : null,
      frontM: Number.isFinite(corridor) ? round(corridor * UNIT_M) : null,
      doorWidthM: round(size[along] * UNIT_M),
      doorHeightM: round(size[2] * UNIT_M),
    });
  }
  // rows: one plane, one height, in sequence along the door
  const rows = [];
  for (const c of cells.slice().sort((a, b) => a.across - b.across || a.plane - b.plane || a.z - b.z || a.at - b.at)) {
    const row = rows.find((r) => r.across === c.across && r.side === c.side && Math.abs(r.plane - c.plane) <= 24 && Math.abs(r.z - c.z) <= 32 && Math.abs(c.at - r.cells[r.cells.length - 1].at) <= 8 / UNIT_M); // prettier-ignore
    if (row) row.cells.push(c);
    else rows.push({ across: c.across, side: c.side, plane: c.plane, z: c.z, cells: [c] });
  }
  const others = allDoors.filter((b) => !doorways.some((d) => Math.hypot(...centreOf(b).map((v, a) => v - d.c[a])) <= 32));
  const rowRecords = rows.map((r) => {
    const mid = [0, 1, 2].map((a) => r.cells.reduce((s, c) => s + c.door.c[a], 0) / r.cells.length);
    const near = (list) => (list.length ? Math.min(...list.map((p) => Math.hypot(...p.map((v, a) => v - mid[a])))) * UNIT_M : null);
    const pitch = r.cells.slice(1).map((c, k) => (c.at - r.cells[k].at) * UNIT_M);
    // walls between cells that are brush entities (bars, func_wall) let the trace run on to the next world wall:
    // a cell in a row is no wider than the pitch beside it
    r.cells.forEach((c, k) => {
      const beside = [pitch[k - 1], pitch[k]].filter(Number.isFinite);
      if (beside.length && Number.isFinite(c.widthM)) c.widthM = round(Math.min(c.widthM, Math.min(...beside)));
    });
    // a row facing it across the corridor: one plane, one height, overlapping along the doors
    const span = (q) => [Math.min(...q.cells.map((c) => c.at)) - 64, Math.max(...q.cells.map((c) => c.at)) + 64];
    const facing = rows.find((q) => q !== r && q.across === r.across && q.side === -r.side && (q.plane - r.plane) * r.side < 0 && Math.abs(q.z - r.z) <= 32 && Math.abs(q.plane - r.plane) >= 48 && Math.abs(q.plane - r.plane) <= 1536 && span(q)[0] <= span(r)[1] && span(r)[0] <= span(q)[1]); // prettier-ignore
    return {
      cells: r.cells.length,
      pitchM: bandOf(pitch),
      frontM: median(r.cells.map((c) => c.frontM)),
      facing: Boolean(facing),
      corridorM: facing ? round(Math.abs(facing.plane - r.plane) * UNIT_M) : median(r.cells.map((c) => c.frontM)),
      switchM: round(near(switchesAt), 1),
      lightsWithin8M: lightsAt.filter((p) => Math.hypot(...p.map((v, a) => v - mid[a])) * UNIT_M <= 8).length,
      otherDoorM: others.length ? round(Math.min(...others.map((b) => toBox(mid, b))) * UNIT_M, 1) : null,
    };
  });
  return {
    doorways: doorways.length,
    cells: cells.length,
    jailDoors: notCells.length,
    hatches,
    rows: rowRecords.sort((a, b) => b.cells - a.cells),
    list: cells.map(({ depthM, widthM, frontM, doorWidthM, doorHeightM }) => ({ depthM, widthM, frontM, doorWidthM, doorHeightM, areaM2: depthM && widthM ? round(depthM * widthM, 1) : null })), // prettier-ignore
  };
}

/** the model files of some rows, summed: [{ file, count, rooms }] most used first, then by name */
function sumModels(rows) {
  const count = {};
  const rooms = {};
  for (const r of rows)
    for (const [file, n] of Object.entries(r.models)) {
      add(count, file, n);
      add(rooms, file);
    }
  return Object.keys(count)
    .sort((a, b) => count[b] - count[a] || a.localeCompare(b))
    .map((file) => ({ file, count: count[file], rooms: rooms[file] }));
}

// ── the bands across the cities ─────────────────────────────────────────────
/** a band of one number over items of several cities, each city weighing 1 in all */
function acrossCities(cities, itemsOf, get, places = 2) {
  const values = [];
  const weights = [];
  for (const c of cities) {
    const items = itemsOf(c);
    const own = items.map(get).filter(Number.isFinite);
    for (const v of own) values.push(v), weights.push(1 / own.length);
  }
  return bandOf(values, weights, places);
}
const shareOf = (part, all) => (all ? round(part / all, 3) : null);

function kindBands(cities, kind, modelFolders) {
  const roomsOf = (c) => c.rooms.filter((r) => r.kind === kind);
  const propsOf = (c) => c.properties.filter((p) => p.kind === kind);
  const all = cities.flatMap(roomsOf);
  const allProps = cities.flatMap(propsOf);
  if (!all.length) return null;
  const perMap = Object.fromEntries(
    cities.map((c) => [
      c.name,
      {
        properties: propsOf(c).length,
        rooms: roomsOf(c).length,
        roomM2: median(roomsOf(c).map((r) => r.areaM2)),
        propertyM2: median(propsOf(c).map((p) => p.areaM2)),
        ceilingM: median(roomsOf(c).map((r) => r.ceilingM).filter(Number.isFinite)),
        propsPerRoom: median(roomsOf(c).map((r) => r.props)),
      },
    ]),
  );
  const off = {};
  for (const p of allProps) for (const o of p.off) add(off, o);
  const offTotal = Object.values(off).reduce((s, n) => s + n, 0);
  const classes = {};
  for (const r of all) for (const [k, n] of Object.entries(r.byClass)) add(classes, k, n);
  const models = sumModels(all).slice(0, 15).map((m) => ({
    ...m,
    cities: cities.filter((c) => roomsOf(c).some((r) => r.models[m.file])).length,
    inGameFolders: modelFolders.length ? modelFolders.some((f) => existsSync(join(f, m.file))) : null,
  }));
  return {
    properties: allProps.length,
    rooms: all.length,
    perMap,
    roomM2: acrossCities(cities, roomsOf, (r) => r.areaM2, 1),
    roomShortM: acrossCities(cities, roomsOf, (r) => r.shortM),
    roomLongM: acrossCities(cities, roomsOf, (r) => r.longM),
    ceilingM: acrossCities(cities, roomsOf, (r) => r.ceilingM),
    // the floor over its box (1: a rectangle; an L or a room round a core is less) and the box's long over short
    fill: acrossCities(cities, roomsOf, (r) => (r.shortM && r.longM ? r.areaM2 / (r.shortM * r.longM) : null)),
    aspect: acrossCities(cities, roomsOf, (r) => (r.shortM ? r.longM / r.shortM : null)),
    roomsPerProperty: acrossCities(cities, propsOf, (p) => p.rooms, 1),
    propertyM2: acrossCities(cities, propsOf, (p) => p.areaM2, 1),
    doorwaysPerProperty: acrossCities(cities, propsOf, (p) => p.doorways, 1),
    entrancesPerProperty: acrossCities(cities, propsOf, (p) => p.entrances, 1),
    entranceOff: Object.fromEntries(Object.entries(off).sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, shareOf(n, offTotal)])),
    entranceDoor: {
      widthM: acrossCities(cities, (c) => propsOf(c).flatMap((p) => p.doorSizes), (d) => d.widthM),
      heightM: acrossCities(cities, (c) => propsOf(c).flatMap((p) => p.doorSizes), (d) => d.heightM),
    },
    innerDoor: {
      widthM: acrossCities(cities, (c) => propsOf(c).flatMap((p) => p.innerDoorSizes), (d) => d.widthM),
      heightM: acrossCities(cities, (c) => propsOf(c).flatMap((p) => p.innerDoorSizes), (d) => d.heightM),
    },
    glass: {
      roomsWithGlass: shareOf(all.filter((r) => r.glass.panels || r.glass.faces).length, all.length),
      panelsPerRoom: acrossCities(cities, roomsOf, (r) => r.glass.panels, 1),
      faceM2PerRoom: acrossCities(cities, roomsOf, (r) => r.glass.faceM2, 1),
    },
    propsPerRoom: acrossCities(cities, roomsOf, (r) => r.props, 1),
    propsPer10M2: acrossCities(cities, roomsOf, (r) => (r.areaM2 ? (10 * r.props) / r.areaM2 : null)),
    roomsWithProps: shareOf(all.filter((r) => r.props).length, all.length),
    itemsPerRoom: acrossCities(cities, roomsOf, (r) => r.items, 1),
    lightsPerRoom: acrossCities(cities, roomsOf, (r) => r.lights, 1),
    lightsPer10M2: acrossCities(cities, roomsOf, (r) => (r.areaM2 ? (10 * r.lights) / r.areaM2 : null)),
    switchesPerRoom: acrossCities(cities, roomsOf, (r) => r.switches, 1),
    switchesPerProperty: acrossCities(cities, propsOf, (p) => p.switches, 1),
    floorLight: acrossCities(cities, roomsOf, (r) => r.floorLight, 1),
    classesPerRoom: Object.fromEntries(Object.entries(classes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => [k, round(n / all.length)])),
    models,
  };
}

function streetBands(cities, modelFolders) {
  const per = (get) => cities.map((c) => get(c.street));
  const models = sumModels(cities.map((c) => c.street)).slice(0, 15).map((m) => ({
    ...m,
    cities: cities.filter((c) => c.street.models[m.file]).length,
    inGameFolders: modelFolders.length ? modelFolders.some((f) => existsSync(join(f, m.file))) : null,
  }));
  return {
    areaM2: bandOf(per((s) => s.areaM2), null, 0),
    propsPer100M2: bandOf(per((s) => (100 * s.props) / s.areaM2)),
    lightsPer100M2: bandOf(per((s) => (100 * s.lights) / s.areaM2)),
    switchesPer100M2: bandOf(per((s) => (100 * s.switches) / s.areaM2)),
    itemsPer100M2: bandOf(per((s) => (100 * s.items) / s.areaM2)),
    models,
  };
}

// ── a child: one map ────────────────────────────────────────────────────────
function child() {
  process.on("disconnect", () => process.exit(0));
  process.on("message", ({ file, name }) => {
    try {
      const record = measureLevel(readFileSync(file), { name, city: true, cityDetail: true });
      process.send({ ok: true, city: roomsOfCity(record) });
    } catch (error) {
      process.send({ ok: false, why: String(error?.stack ?? error).split("\n").slice(0, 3).join(" | ").slice(0, 400) });
    }
  });
}

function argsOf(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[argv[i].slice(2)] = true;
    else (out[argv[i].slice(2)] = next), i++;
  }
  return out;
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  const root = args.root ?? ROOT;
  const names = args.maps ? String(args.maps).split(",") : MAPS;
  const jobs = Math.max(1, Number(args.jobs ?? 1));
  const out = args.out ?? join(KIT, "levels/corpus/rp-rooms.json");
  const modelFolders = (args.models ? String(args.models).split(";") : MODEL_FOLDERS).filter((f) => existsSync(f));
  const work = names.map((name) => ({ name, file: join(root, "maps", `${name}.bsp`) }));
  for (const w of work) if (!existsSync(w.file)) throw new Error(`no map ${w.file}`);
  const results = new Map();
  const failed = [];
  let next = 0;
  await new Promise((done) => {
    let running = 0;
    const startOne = () => {
      if (next >= work.length) return void (!running && done());
      const item = work[next++];
      running++;
      const worker = fork(fileURLToPath(import.meta.url), ["--child"], { execArgv: ["--max-old-space-size=6144"], stdio: ["ignore", "inherit", "inherit", "ipc"] });
      let finished = false;
      const finish = (message) => {
        if (finished) return;
        finished = true;
        worker.kill();
        running--;
        if (message?.ok) {
          results.set(item.name, message.city);
          console.log(`  ${item.name}: ${message.city.rooms.length} rooms, ${message.city.properties.length} properties`);
        } else {
          failed.push({ map: item.name, why: message?.why ?? "the child ended" });
          console.log(`  ${item.name}: FAILED ${message?.why ?? ""}`);
        }
        startOne();
      };
      worker.on("message", finish);
      worker.on("exit", (code) => finish({ ok: false, why: `the child ended (${code})` }));
      worker.send(item);
    };
    for (let k = 0; k < jobs; k++) startOne();
  });
  // in the order asked, whatever order they ended in
  const cities = names.filter((n) => results.has(n)).map((n) => results.get(n));
  const kinds = {};
  for (const kind of KINDS) {
    const band = kindBands(cities, kind, modelFolders);
    if (band) kinds[kind] = band;
  }
  // a jail's cells, banded over the cities' cells (each city 1 in all)
  const cellsOf = (c) => c.jail.cellList;
  const jailCells = {
    cells: cities.reduce((s, c) => s + c.jail.cells, 0),
    cutCells: cities.reduce((s, c) => s + c.jail.cutCells, 0),
    smallCells: cities.reduce((s, c) => s + c.jail.smallCells, 0),
    cellM2: acrossCities(cities, cellsOf, (r) => r.areaM2, 1),
    cellShortM: acrossCities(cities, cellsOf, (r) => r.shortM),
    cellLongM: acrossCities(cities, cellsOf, (r) => r.longM),
    cellCeilingM: acrossCities(cities, cellsOf, (r) => r.ceilingM),
    cellDoorWidthM: acrossCities(cities, cellsOf, (r) => r.doorWidthM),
    cellDoorHeightM: acrossCities(cities, cellsOf, (r) => r.doorHeightM),
    cellsPerBlock: acrossCities(cities, (c) => c.jail.blocks, (b) => b.cells, 1),
    models: sumModels(cities.flatMap(cellsOf)).slice(0, 10),
  };
  // the cells read from their doors (tracedCells), each city 1 in all
  const traced = (c) => c.jail.traced.list;
  const tracedRows = (c) => c.jail.traced.rows;
  jailCells.traced = {
    cells: cities.reduce((s, c) => s + c.jail.traced.cells, 0),
    jailDoors: cities.reduce((s, c) => s + c.jail.traced.jailDoors, 0),
    rows: cities.reduce((s, c) => s + c.jail.traced.rows.length, 0),
    cellsPerRow: acrossCities(cities, tracedRows, (r) => r.cells, 1),
    pitchM: acrossCities(cities, tracedRows, (r) => r.pitchM?.median),
    depthM: acrossCities(cities, traced, (r) => r.depthM),
    widthM: acrossCities(cities, traced, (r) => r.widthM),
    areaM2: acrossCities(cities, traced, (r) => r.areaM2, 1),
    frontM: acrossCities(cities, traced, (r) => r.frontM),
    corridorM: acrossCities(cities, tracedRows, (r) => r.corridorM),
    facingRows: shareOf(cities.reduce((s, c) => s + c.jail.traced.rows.filter((r) => r.facing).length, 0), cities.reduce((s, c) => s + c.jail.traced.rows.length, 0)),
    doorWidthM: acrossCities(cities, traced, (r) => r.doorWidthM),
    doorHeightM: acrossCities(cities, traced, (r) => r.doorHeightM),
    switchM: acrossCities(cities, tracedRows, (r) => r.switchM, 1),
    lightsWithin8M: acrossCities(cities, tracedRows, (r) => r.lightsWithin8M, 1),
    otherDoorM: acrossCities(cities, tracedRows, (r) => r.otherDoorM, 1),
  };
  const corpus = {
    tool: "levels/tools/survey-rp-rooms.mjs (levels/lib/city-measures.mjs, cityOf with detail)",
    what: "Measures, counts of classnames and the file names of the models the maps place: no geometry, entity, texture or name of a map.",
    units: "lengths in metres (1 unit = 0.0254 m), areas in m2, light 0-255 (the floor's lightmap)",
    banding:
      "Each band is n (rooms or properties counted), median, p10, p90 over every room (or property) of the kind in all the cities, each city weighing 1 in all (its items 1/n each). perMap gives each city's own medians.",
    kinds: "a property is cityOf's building (rooms joined by doors no public floor touches); its kind from its doors' names (levels/notes-rp-city.md)",
    maps: names,
    failed,
    modelFolders: modelFolders.map((f) => (f.includes("H9XASH") ? "H9XASH/ts" : f.includes("Steam") ? "Steam Half-Life/ts" : "given")),
    byKind: kinds,
    street: streetBands(cities, modelFolders),
    jail: { ...jailCells, perMap: Object.fromEntries(cities.map((c) => [c.name, (({ cellList: _c, ...j }) => j)(c.jail)])) },
    spawns: Object.fromEntries(cities.map((c) => [c.name, c.spawn])),
    cities: cities.map(({ rooms, properties, street, jail: _j, spawn: _s, ...rest }) => ({
      ...rest,
      byKind: Object.fromEntries(KINDS.map((k) => [k, properties.filter((p) => p.kind === k).length]).filter(([, n]) => n)),
      rooms: rooms.map(({ property, byClass: _b, models: _m, doorways, ...r }) => ({ property, ...r, doorways })),
      properties: properties.map(({ doorSizes: _d, innerDoorSizes: _i, ...p }) => p),
      street: { areaM2: street.areaM2, lights: street.lights, switches: street.switches, props: street.props, items: street.items },
    })),
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(corpus, null, 1) + "\n");
  console.log(`${out}: ${cities.length} cities, ${failed.length} failed`);
  if (failed.length) process.exitCode = 1;
}

if (process.argv.includes("--child")) child();
else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
