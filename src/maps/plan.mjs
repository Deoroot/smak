// A map's plan looked over BEFORE it is compiled: what the compilers would refuse or mend without a word
// (errors), what they will put up with but should be known (warnings), and what the map is (facts). The
// plan is what `writeMap` takes: `{ worldspawn, brushes, entities }` (source.mjs). Run this on every map
// before `compileMap`: it takes a moment, a compile takes minutes, and its sentences say where to look.
//
// It also gives a HINT about leaks, by a flood of its own on a coarse grid. A leak it reports is a real
// opening; finding none proves nothing about gaps finer than the grid. The compiler's word is final.
import { readFileSync } from "node:fs";
import { dot, cross, sub } from "../vec.mjs";
import { shapeOf, planesOf, offGrid, mapNumber } from "./source.mjs";
import { START_CLASSES } from "./space.mjs";
import { modelless } from "./entities.mjs";
import { modOf } from "./mod.mjs";
import { checkEntities as checkAgainstMod } from "./rules.mjs";

/**
 * What a map's source may hold (the limits of a compiled map are in check.mjs).
 *   range         how far from the origin anything may be, on each axis. GoldSrc sends an entity's place over
 *                 the network in 16 bits at eighths of a unit (the `origin` lines of its delta.lst), which
 *                 reaches 4096, and the editors' grid ends there. Newer builds and Xash3D hold more: pass
 *                 `range` to `checkPlan` when you know the target does
 *   textureName   letters in a texture's name: a .wad and a .bsp keep it in 16 bytes, the last a zero
 *   key, value    letters in an entity's key and in its value, as hlcsg and the engine read them
 *   brushes       brushes in one map, as hlcsg counts them
 */
export const SOURCE_LIMITS = { range: 4096, textureName: 15, key: 31, value: 1023, brushes: 32768, switchedLights: 32 };
/**
 * The range by engine, for `checkPlan({ engine })`: GoldSrc's 4096 (the default), and Xash3D FWGS builds such as H9's,
 * which hold 8000 (verified in game: collision breaks past 12000, so 8000 keeps clear of it).
 */
export const ENGINE_RANGE = { goldsrc: 4096, xash: 8000 };

/**
 * The compilers' own textures (VHLT's zhlt.wad, SDHLT's sdhlt.wad, which compileMap adds itself): never looked
 * for in the given list. BEVELHINT, SPLITFACE and the !CUR_ currents are SDHLT's alone.
 */
const TOOL_TEXTURES = [
  "AAATRIGGER", "BEVEL", "BEVELHINT", "BLACK_HIDDEN", "BOUNDINGBOX", "CLIP", "CLIPBEVEL", "CLIPBEVELBRUSH",
  "CLIPHULL1", "CLIPHULL2", "CLIPHULL3", "CONTENTEMPTY", "CONTENTWATER", "HINT", "NOCLIP", "NULL", "NULLNOCLIP", "ORIGIN",
  "SKIP", "SKY", "SOLIDHINT", "SPLITFACE", "!CUR_0", "!CUR_90", "!CUR_180", "!CUR_270", "!CUR_UP", "!CUR_DWN",
]; // prettier-ignore
/**
 * A brush that wears one of these is no wall against the void: water and other liquids (`!`, `*`), and the
 * compilers' marks for an origin, a clip, a hint and the like. Measured with VHLT and SDHLT 1.3.1 alike (a room
 * whose one wall wears it, compiled): SKIP and SPLITFACE leak in every hull, CLIP in hull 0; NOCLIP and
 * NULLNOCLIP seal hull 0 but leak in hulls 1 to 3, so a player walks out through them, which the compile
 * reports as a leak; SOLIDHINT, BEVELHINT and NULL seal.
 */
const SEALS_NOTHING =
  /^(!|\*|origin$|clip|hint$|skip$|splitface$|boundingbox$|contentempty$|contentwater$|noclip$|nullnoclip$)/i;
/** The entities that light a map. */
const LIGHTS = ["light", "light_spot", "light_environment", "info_texlights"];
/** How many of one kind of fault are listed before the rest are counted. */
const LISTED = 8;
/** A face whose texture axes span less than this of its plane has its picture drawn edge-on. */
const EDGE_ON = 1e-6;

// ── the leak hint's grid ────────────────────────────────────────────────────
/** The side of a cell of the flood's grid, in units, unless told: half a player's width. */
const CELL = 16;
/** The most cells the grid may have; a larger map is flooded on a coarser grid, and that is said. */
const MOST_CELLS = 600_000;
/** How many cells of void the grid has round the world: reaching its outermost layer is being outside. */
const VOID_CELLS = 2;
/**
 * The grid is moved off the round numbers by this share of a cell, so that no cell's middle lies exactly on
 * a wall's face (walls are at round numbers).
 */
const OFF_ROUND = 0.3713;
/** A point this near a plane is on it. */
const ON_PLANE = 1e-6;
/** The three ways a flood steps forwards, with the bit that marks that step as shut. */
const STEPS = [
  { by: [1, 0, 0], bit: 1 },
  { by: [0, 1, 0], bit: 2 },
  { by: [0, 0, 1], bit: 4 },
];

/** The names of a .wad file's textures, from its bytes (a WAD3's directory): what `textures` wants. */
export function wadTextureNames(buffer) {
  const ENTRY = 32;
  const NAME_AT = 16;
  const NAME_LENGTH = 16;
  if (!buffer || buffer.length < 12 || !/^WAD[23]$/.test(buffer.subarray(0, 4).toString("latin1")))
    throw new Error("wadTextureNames: not a .wad file (it does not begin with WAD3)");
  const count = buffer.readInt32LE(4);
  const directory = buffer.readInt32LE(8);
  if (count < 0 || directory < 0 || directory + count * ENTRY > buffer.length)
    throw new Error("wadTextureNames: the .wad is cut short: its directory runs past its end");
  const names = [];
  for (let entry = 0; entry < count; entry++) {
    const at = directory + entry * ENTRY + NAME_AT;
    const raw = buffer.subarray(at, at + NAME_LENGTH);
    const end = raw.indexOf(0);
    names.push(raw.subarray(0, end < 0 ? NAME_LENGTH : end).toString("latin1"));
  }
  return names;
}

/** The first few of a list, and how many more there are. */
const some = (list) =>
  `${list.slice(0, LISTED).join("; ")}${list.length > LISTED ? `; and ${list.length - LISTED} more` : ""}`;
/** A point as a sentence has it. */
const place = (point) => point.map((value) => mapNumber(Math.round(value * 100) / 100)).join(" ");
/** An entity's origin as three numbers, or null when it has none that can be read. */
const originOf = (entity) => {
  if (typeof entity.origin !== "string" && !Array.isArray(entity.origin)) return null;
  const numbers = Array.isArray(entity.origin)
    ? entity.origin
    : entity.origin.trim().split(/\s+/).map(Number);
  return numbers.length === 3 && numbers.every(Number.isFinite) ? numbers : null;
};
/** Whether a brush is a wall against the void. */
const seals = (brush) => !brush.faces.some((face) => SEALS_NOTHING.test(face.texture));

/** Whether the straight line from `from` to `to` touches the convex solid behind `planes`. */
function crosses(planes, from, to) {
  let enters = 0;
  let leaves = 1;
  for (const plane of planes) {
    const here = dot(plane.normal, from) - plane.dist;
    const there = dot(plane.normal, to) - plane.dist;
    if (here > ON_PLANE && there > ON_PLANE) return false;
    if (here <= ON_PLANE && there <= ON_PLANE) continue;
    const share = here / (here - there);
    if (here > ON_PLANE) enters = Math.max(enters, share);
    else leaves = Math.min(leaves, share);
    if (enters > leaves) return false;
  }
  return true;
}

/**
 * A hint about leaks, before any compiler runs. The space round the world's brushes is cut into a grid of
 * cells; from every point entity a flood spreads from cell to cell wherever the straight step between two
 * cells' middles touches no world brush. If it reaches the void beyond the world, the map is open.
 *
 *   map        `{ brushes, entities }`: only the world's brushes are walls (a brush entity seals nothing,
 *              nor does water)
 *   cell       the grid's cell, in units (16 unless told). An opening narrower than a cell can be missed
 *
 * It returns `{ leak, cell, cells, from, note }`. `leak` is null when no way out was found, else
 * `{ entity: { classname, origin }, at, points }`: the entity the way out starts from, the last point of the
 * way that is still within the box of the world (at the hole, or a cell from it) and the whole way, from
 * the entity to the void. `from` is how many entities were flooded from.
 *
 * WHAT IT IS WORTH: a way out it finds is real, since every step of it is a straight line that touches no
 * brush. Finding none is no proof: a crack finer than the grid, or one no step happens to pass through,
 * is not seen. The compiler's leak test is the final word.
 */
export function leakHint(map, { cell = CELL, shapes } = {}) {
  const world = (map.brushes ?? []).flat().filter((brush) => brush?.faces && seals(brush));
  const solids = [];
  for (const brush of world) {
    const shape = shapes?.get(brush) ?? shapeOf(brush);
    if (shape.faults.length || !shape.corners.length) continue;
    solids.push({ planes: planesOf(brush), min: shape.min, max: shape.max });
  }
  const starts = [];
  for (const entity of map.entities ?? []) {
    const origin = entity.brushes?.length ? null : originOf(entity);
    if (origin) starts.push({ classname: entity.classname, origin });
  }
  const none = (note) => ({ leak: null, cell, cells: 0, from: 0, note });
  if (!solids.length) return none("no world brush to be a wall");
  if (!starts.length) return none("no point entity to flood from");

  const min = [0, 1, 2].map((i) => Math.min(...solids.map((solid) => solid.min[i])));
  const max = [0, 1, 2].map((i) => Math.max(...solids.map((solid) => solid.max[i])));
  // the grid: the world's box and a margin of void round it; coarser when it would have too many cells
  let side = cell;
  let counts;
  for (;;) {
    counts = [0, 1, 2].map((i) => Math.ceil((max[i] - min[i]) / side) + 2 * VOID_CELLS + 1);
    if (counts[0] * counts[1] * counts[2] <= MOST_CELLS) break;
    side *= 2;
  }
  const first = min.map((value) => value - (VOID_CELLS + OFF_ROUND) * side);
  const middle = (x, y, z) => [first[0] + x * side, first[1] + y * side, first[2] + z * side];
  const index = (x, y, z) => x + counts[0] * (y + counts[1] * z);
  const total = counts[0] * counts[1] * counts[2];

  // which steps are shut: for each brush, the steps that set out from the cells near it
  const shut = new Uint8Array(total);
  for (const solid of solids) {
    const low = [0, 1, 2].map((i) => Math.max(0, Math.floor((solid.min[i] - first[i]) / side) - 1));
    const high = [0, 1, 2].map((i) =>
      Math.min(counts[i] - 1, Math.ceil((solid.max[i] - first[i]) / side) + 1),
    );
    for (let z = low[2]; z <= high[2]; z++)
      for (let y = low[1]; y <= high[1]; y++)
        for (let x = low[0]; x <= high[0]; x++) {
          const from = middle(x, y, z);
          for (const step of STEPS) {
            const to = [
              from[0] + step.by[0] * side,
              from[1] + step.by[1] * side,
              from[2] + step.by[2] * side,
            ];
            if (crosses(solid.planes, from, to)) shut[index(x, y, z)] |= step.bit;
          }
        }
  }

  // the flood, from every entity at once: `cameFrom` is the cell before, `source` the entity it began at
  const cameFrom = new Int32Array(total).fill(-2);
  const source = new Int32Array(total).fill(-1);
  const queue = new Int32Array(total);
  let queued = 0;
  let flooded = 0;
  starts.forEach((start, number) => {
    if (
      solids.some((solid) => solid.planes.every((plane) => dot(plane.normal, start.origin) - plane.dist <= 0))
    )
      return;
    flooded++;
    // the cells round the entity that it can reach in a straight line
    const cellOf = [0, 1, 2].map((i) => Math.floor((start.origin[i] - first[i]) / side));
    for (let corner = 0; corner < 8; corner++) {
      const [x, y, z] = [
        cellOf[0] + (corner & 1),
        cellOf[1] + ((corner >> 1) & 1),
        cellOf[2] + ((corner >> 2) & 1),
      ];
      if (x < 0 || y < 0 || z < 0 || x >= counts[0] || y >= counts[1] || z >= counts[2]) continue;
      const at = index(x, y, z);
      if (cameFrom[at] !== -2) continue;
      if (solids.some((solid) => crosses(solid.planes, start.origin, middle(x, y, z)))) continue;
      cameFrom[at] = -1;
      source[at] = number;
      queue[queued++] = at;
    }
  });
  const result = { leak: null, cell: side, cells: total, from: flooded, note: "" };
  if (side !== cell) result.note = `the map is large: flooded on a grid of ${side}, not ${cell}`;
  // an entity beyond the world's box altogether is in the void already
  const beyond = starts.find((start) =>
    start.origin.some((value, i) => value < min[i] - side || value > max[i] + side),
  );
  if (beyond) {
    result.leak = { entity: beyond, at: [...beyond.origin], points: [[...beyond.origin]] };
    return result;
  }
  for (let head = 0; head < queued; head++) {
    const at = queue[head];
    const x = at % counts[0];
    const y = Math.floor(at / counts[0]) % counts[1];
    const z = Math.floor(at / (counts[0] * counts[1]));
    const onEdge =
      x === 0 || y === 0 || z === 0 || x === counts[0] - 1 || y === counts[1] - 1 || z === counts[2] - 1;
    if (onEdge) {
      // outside: the way back to the entity, then turned round
      const points = [];
      for (let back = at; back >= 0; back = cameFrom[back])
        points.push(
          middle(
            back % counts[0],
            Math.floor(back / counts[0]) % counts[1],
            Math.floor(back / (counts[0] * counts[1])),
          ),
        );
      const start = starts[source[at]];
      points.push([...start.origin]);
      points.reverse();
      const within = (point) => [0, 1, 2].every((i) => point[i] >= min[i] && point[i] <= max[i]);
      const firstOut = points.findIndex((point) => !within(point));
      result.leak = { entity: start, at: points[Math.max(0, firstOut - 1)], points };
      return result;
    }
    for (const step of STEPS) {
      // forwards: this cell's own step; backwards: the step of the cell behind
      const ahead = index(x + step.by[0], y + step.by[1], z + step.by[2]);
      if (!(shut[at] & step.bit) && cameFrom[ahead] === -2) {
        cameFrom[ahead] = at;
        source[ahead] = source[at];
        queue[queued++] = ahead;
      }
      const behind = index(x - step.by[0], y - step.by[1], z - step.by[2]);
      if (!(shut[behind] & step.bit) && cameFrom[behind] === -2) {
        cameFrom[behind] = at;
        source[behind] = source[at];
        queue[queued++] = behind;
      }
    }
  }
  return result;
}

/**
 * The brushes of a plan, each with the words that say which it is. An entity is numbered as the pictures,
 * `smak info` and `viewFrom` number it: the world is 0, the first of `entities` is 1.
 */
function brushesOf(map) {
  const listed = (map.brushes ?? [])
    .flat()
    .map((brush, number) => ({ brush, named: `world brush ${number}`, world: true }));
  (map.entities ?? []).forEach((entity, index) => {
    for (const [own, brush] of (entity.brushes ?? []).entries())
      listed.push({
        brush,
        named: `brush ${own} of entity ${index + 1} (${entity.classname})`,
        world: false,
        classname: entity.classname,
      });
  });
  return listed;
}

/** A brush all of whose faces wear these is not seen: nothing hangs on it. */
const UNSEEN = /^(clip|origin|hint$|skip$|null|aaatrigger$|bevel|solidhint$|splitface$|boundingbox$|noclip$)/i;
/** Boxes this near each other touch (units). */
const TOUCH = 0.5;

/**
 * The func_detail that hangs in the air: the pieces (detail brushes that touch one another, by their boxes) of
 * which no brush touches a seen brush of the world or of another entity. Each is told by where its box is and
 * what it wears. Touching is by boxes, so a slanted brush may be taken to touch what it misses: a piece told is
 * loose, one not told may still be.
 */
function looseDetail(listed, shapes) {
  const boxOf = (brush) => {
    const corners = shapes.get(brush)?.corners;
    if (!corners?.length) return null;
    return [0, 1, 2].map((i) => [Math.min(...corners.map((c) => c[i])), Math.max(...corners.map((c) => c[i]))]);
  };
  const touch = (a, b) => a.every(([lo, hi], i) => lo <= b[i][1] + TOUCH && hi >= b[i][0] - TOUCH);
  const seen = (brush) => brush.faces.some((face) => !UNSEEN.test(String(face.texture ?? "")));
  const detail = [];
  const anchors = [];
  for (const one of listed) {
    if (!Array.isArray(one.brush?.faces)) continue;
    const box = boxOf(one.brush);
    if (!box || !seen(one.brush)) continue;
    (one.classname === "func_detail" ? detail : anchors).push({ ...one, box });
  }
  // the pieces: detail brushes joined by touching
  const piece = detail.map((_, i) => i);
  const root = (i) => (piece[i] === i ? i : (piece[i] = root(piece[i])));
  const order = detail.map((_, i) => i).sort((a, b) => detail[a].box[0][0] - detail[b].box[0][0]);
  for (let k = 0; k < order.length; k++)
    for (let m = k + 1; m < order.length; m++) {
      const a = detail[order[k]];
      const b = detail[order[m]];
      if (b.box[0][0] > a.box[0][1] + TOUCH) break;
      if (touch(a.box, b.box)) piece[root(order[k])] = root(order[m]);
    }
  const held = new Set();
  for (const [i, one] of detail.entries()) if (anchors.some((anchor) => touch(one.box, anchor.box))) held.add(root(i));
  const pieces = new Map();
  for (const [i, one] of detail.entries()) {
    const r = root(i);
    if (held.has(r)) continue;
    if (!pieces.has(r)) pieces.set(r, []);
    pieces.get(r).push(one);
  }
  return [...pieces.values()].map((brushes) => {
    const min = [0, 1, 2].map((i) => Math.min(...brushes.map((one) => one.box[i][0])));
    const max = [0, 1, 2].map((i) => Math.max(...brushes.map((one) => one.box[i][1])));
    const textures = [...new Set(brushes.flatMap((one) => one.brush.faces.map((face) => face.texture)))].slice(0, 3);
    return `${brushes.length} brushes from ${place(min)} to ${place(max)} (${textures.join(", ")})`;
  });
}

/** The brushes: each a sound solid, inside the engine's range, its planes on the grid, its pictures laid flat. */
function checkBrushes(listed, { range, grid, tolerance }, { errors, warnings }, shapes) {
  const broken = [];
  const outside = [];
  const edgeOn = [];
  const offGridBrushes = [];
  for (const { brush, named } of listed) {
    if (!Array.isArray(brush?.faces)) {
      broken.push(`${named} is not a brush: it has no faces (was a list of brushes not spread?)`);
      continue;
    }
    const shape = shapeOf(brush);
    shapes.set(brush, shape);
    for (const fault of shape.faults) broken.push(`${named}: ${fault}`);
    if (shape.faults.length) continue;
    const far = shape.corners.find((corner) => corner.some((value) => Math.abs(value) > range));
    if (far) outside.push(`${named} reaches ${place(far)}`);
    shape.faces.forEach((face, number) => {
      const source = brush.faces[number];
      const across = cross(source.u.slice(0, 3), source.v.slice(0, 3));
      if (Math.abs(dot(across, face.normal)) < EDGE_ON)
        edgeOn.push(`${named} face ${number} (${source.texture})`);
    });
    const off = offGrid(brush, grid, tolerance);
    if (off.length) offGridBrushes.push(`${named} at ${place(off[0])}`);
  }
  if (broken.length) errors.push(`${broken.length} brushes that are no sound convex solid: ${some(broken)}`);
  if (outside.length)
    errors.push(
      `${outside.length} brushes reach further than ${range} from the origin, where the engine cannot place anything: ${some(outside)}`,
    );
  if (edgeOn.length)
    errors.push(
      `${edgeOn.length} faces have texture axes that lie across the face, so the picture is seen edge-on and the compiler stops: ${some(edgeOn)}`,
    );
  if (offGridBrushes.length)
    warnings.push(
      `${offGridBrushes.length} brushes have planes written with points off the grid of ${grid}: where two such brushes should share a plane a crack can open, and the compiler may complain. Round them (a builder's snap option, or snapped) where they have to meet others: ${some(offGridBrushes)}`,
    );
}

/** The textures: names the formats can hold, and names the .wad files have. */
function checkTextures(listed, textures, { errors, facts }) {
  const used = new Map();
  for (const { brush } of listed)
    for (const face of brush?.faces ?? []) used.set(face.texture, (used.get(face.texture) ?? 0) + 1);
  const names = [...used.keys()];
  const long = names.filter((name) => name.length > SOURCE_LIMITS.textureName);
  if (long.length)
    errors.push(
      `${long.length} texture names are longer than ${SOURCE_LIMITS.textureName} letters, which is all a .wad and a .bsp hold: ${some(long)}`,
    );
  if (textures) {
    const known = new Set([...textures].map((name) => name.toUpperCase()));
    const lost = names.filter(
      (name) => !known.has(name.toUpperCase()) && !TOOL_TEXTURES.includes(name.toUpperCase()),
    );
    if (lost.length)
      errors.push(
        `${lost.length} textures are in none of the .wad files given: ${some(lost.map((name) => `${name} (${used.get(name)} faces)`))}`,
      );
  }
  facts.push(`${names.length} textures: ${some(names.sort())}`);
  return used;
}

/** The entities: each with a classname, point entities with a place inside the range, keys the formats hold. */
function checkEntities(map, { range, starts }, { errors, warnings, facts }, used) {
  const entities = map.entities ?? [];
  const empty = modelless(entities, (entity, key) => entity[key]);
  if (empty.length)
    errors.push(
      `${empty.length} entities precache a model they do not name, and the map would stop on load ("PF_precache_model_I: Bad string ''"): ${empty.slice(0, 8).map(({ entity, index }) => `entity ${index + 1} ${entity.classname}`).join(", ")}: give each its model (a sprite for env_sprite and env_glow)`,
    );
  const noPlace = [];
  const outside = [];
  const badKeys = [];
  entities.forEach((entity, index) => {
    const number = index + 1;
    const named = `entity ${number} (${entity.classname ?? "no classname"})`;
    if (typeof entity.classname !== "string" || !entity.classname)
      errors.push(`entity ${number} has no classname`);
    for (const [key, value] of Object.entries(entity)) {
      if (key === "brushes") continue;
      if (key.length > SOURCE_LIMITS.key)
        badKeys.push(`${named}: the key ${key} is longer than ${SOURCE_LIMITS.key} letters`);
      const text = Array.isArray(value) ? value.join(" ") : String(value);
      if (/["\r\n]/.test(text)) badKeys.push(`${named}: the value of ${key} holds a quote or a line break`);
      if (text.length > SOURCE_LIMITS.value)
        badKeys.push(`${named}: the value of ${key} is longer than ${SOURCE_LIMITS.value} letters`);
    }
    if (entity.brushes?.length) return;
    const origin = originOf(entity);
    if (!origin) noPlace.push(named);
    else if (origin.some((value) => Math.abs(value) > range)) outside.push(`${named} at ${place(origin)}`);
  });
  if (noPlace.length)
    errors.push(
      `${noPlace.length} point entities have no origin ("x y z"): the game puts them at 0 0 0, wherever that is: ${some(noPlace)}`,
    );
  if (outside.length)
    errors.push(`${outside.length} entities are further than ${range} from the origin: ${some(outside)}`);
  if (badKeys.length) errors.push(`${badKeys.length} keys or values a map cannot hold: ${some(badKeys)}`);
  const found = new Map();
  for (const entity of entities)
    if (starts.includes(entity.classname))
      found.set(entity.classname, (found.get(entity.classname) ?? 0) + 1);
  if (starts.length && !found.size)
    errors.push(
      `no ${starts.join(" or ")}: the player would start at 0 0 0, wherever that is. Add one (playerStart), or give the mod's profile (the mod option) or its own start classes (the starts option)`,
    );
  if (found.size)
    facts.push(
      `places to start: ${[...found].map(([classname, count]) => `${count} ${classname}`).join(", ")}`,
    );
  if (!entities.some((entity) => LIGHTS.includes(entity.classname)))
    warnings.push(
      "nothing lights it (no light, light_spot, light_environment or info_texlights): hlrad will leave it black",
    );
  // a light with a name is switched: hlcsg gives each name a style of its own from 32 to 63 (the engine has
  // 64 styles, MAX_LIGHTSTYLES; the first 32 are the game's patterns) and stops with "Exceeded
  // MAX_SWITCHED_LIGHTS" past 32 names
  const switched = new Set(
    entities.filter((entity) => /^light/.test(entity.classname ?? "") && entity.targetname).map((entity) => String(entity.targetname)),
  );
  if (switched.size > SOURCE_LIMITS.switchedLights)
    errors.push(
      `${switched.size} names of lights: a light with a name is switched, and a map holds ${SOURCE_LIMITS.switchedLights} switched names at the most (hlcsg: "Exceeded MAX_SWITCHED_LIGHTS"). Give lights that switch together one name, or leave some lamps always on`,
    );
  else if (switched.size)
    facts.push(`${switched.size} of the ${SOURCE_LIMITS.switchedLights} names a map may give its switched lights`);
  for (const entity of entities.filter((one) => one.classname === "info_texlights"))
    for (const key of Object.keys(entity)) {
      if (["classname", "origin", "brushes"].includes(key)) continue;
      const worn = [...used.keys()].some((name) => name.toUpperCase() === key.toUpperCase());
      if (!worn)
        warnings.push(`info_texlights names the texture ${key}, which no face wears: it lights nothing`);
    }
}

/**
 * A map's plan looked over before it is compiled. `map` is what `writeMap` takes: `{ worldspawn, brushes,
 * entities }`. It returns `{ errors, warnings, facts, leak }`, each of the first three a list of sentences;
 * nothing is thrown for what is wrong with the map.
 *
 *   range       how far from the origin a map may reach (4096: see SOURCE_LIMITS)
 *   engine      "goldsrc" (4096, the default) or "xash" (8000: ENGINE_RANGE), when no `range` is given
 *   textures    the names the .wad files have (a list; `wadTextureNames` reads them from a .wad's bytes).
 *               With it, a texture that is in none is an error; without it, names are not looked up
 *   grid, tolerance   planes written with points further than `tolerance` (0.01) from the grid (1) are told
 *   mod         the mod's profile (mod.mjs: `GOLDSRC`, or a mod's own, passed as data or read with
 *               `loadMod`). It gives the start classes, the textures (its `wads`), the game's folders and
 *               the entity definitions, and has the entities checked against them and against the mod's
 *               rules (`checkEntities` of rules.mjs says what is told)
 *   definitions entity definitions beside the profile's, or with no profile: what `definitionsOf` (an FGD)
 *               or `learnEntities` (a mod's own maps) gave, an .fgd file's path, or a list of these
 *   folders     the game's folders (the mod's own, then `valve`): the models, sprites, sounds, sky and
 *               .wad files the entities name are looked for there. Unless told, the profile's
 *   starts      the classnames that count as a place to start; [] to not ask for one. Unless told, the
 *               profile's; and with no profile `START_CLASSES`, as before there were profiles: Half-Life's
 *               two and Master Sword's `ms_player_begin` and `ms_player_spawn`. `facts` says which were
 *               found, and how many of each
 *   leak        false leaves the leak hint out; `cell` is its grid (see `leakHint`)
 *
 * Errors: a brush that is no sound convex solid (a face with no area, no volume, planes that do not close,
 * a plane given twice), a brush or an entity outside the range, a face whose texture axes lie across it, a
 * texture name over 15 letters or in none of the .wad files, a point entity with no origin, an entity with
 * no classname, a key or value the formats cannot hold, no place to start.
 * Warnings: planes off the grid, no `wad` key, nothing that lights the map, a texture light no face wears,
 * an entity inside a brush, func_detail that touches nothing else seen (it hangs in the air), and the leak
 * hint: a way out to the void, with where it gets out.
 * With `mod` or `definitions`, also what `checkEntities` finds: a class that does not exist (an error), a
 * key its class does not have, a value of the wrong kind, a name nothing answers to, a broken rule of the
 * mod, a file the game does not have.
 * `leak` is what `leakHint` found: null, or `{ entity, at, points }`.
 */
export function checkPlan(map, options = {}) {
  const mod = modOf(options.mod);
  const {
    engine,
    range = ENGINE_RANGE[engine] ?? SOURCE_LIMITS.range,
    textures = mod?.wads.length ? mod.wads.flatMap((wad) => wadTextureNames(readFileSync(wad))) : undefined,
    grid = 1,
    tolerance = 0.01,
    starts = mod?.starts ?? START_CLASSES,
    leak = true,
    cell,
  } = options;
  const errors = [];
  const warnings = [];
  const facts = [];
  const report = { errors, warnings, facts };
  if (!map || typeof map !== "object")
    return { errors: ["not a map: { worldspawn, brushes, entities }"], warnings, facts, leak: null };
  const listed = brushesOf(map);
  const shapes = new Map();
  checkBrushes(listed, { range, grid, tolerance }, report, shapes);
  const used = checkTextures(listed, textures, report);
  checkEntities(map, { range, starts }, report, used);

  const world = listed.filter((one) => one.world);
  if (!world.length) errors.push("no world brush: a map is at least a sealed room");
  if (world.length > SOURCE_LIMITS.brushes)
    errors.push(`${world.length} world brushes: the compiler holds ${SOURCE_LIMITS.brushes}`);
  if (!map.worldspawn?.wad)
    warnings.push(
      "worldspawn has no wad key: the compiler will find no texture unless compileMap is given the wads",
    );

  // entities that sit inside a world brush: a light there lights nothing, a monster there is stuck
  const sound = world.filter(
    (one) => shapes.get(one.brush) && !shapes.get(one.brush).faults.length && seals(one.brush),
  );
  const buried = [];
  (map.entities ?? []).forEach((entity, index) => {
    const origin = entity.brushes?.length ? null : originOf(entity);
    if (!origin) return;
    const inside = sound.find((one) =>
      planesOf(one.brush).every((plane) => dot(plane.normal, origin) - plane.dist < -ON_PLANE),
    );
    if (inside)
      buried.push(`entity ${index + 1} (${entity.classname}) at ${place(origin)} is inside ${inside.named}`);
  });
  if (buried.length) warnings.push(`${buried.length} entities are inside a world brush: ${some(buried)}`);

  const loose = looseDetail(listed, shapes);
  if (loose.length)
    warnings.push(
      `${loose.length} pieces of func_detail touch nothing else solid: they hang in the air (a lamp or a sign in a doorway, a bracket off its wall): ${some(loose)}`,
    );

  let hint = null;
  if (leak && world.length) {
    const found = leakHint(map, { cell, shapes });
    hint = found.leak;
    const basis = `a hint from a flood on a grid of ${found.cell}; the compiler's word is final`;
    if (found.leak) {
      const from = found.leak.entity;
      const gap = sub(found.leak.at, from.origin).map(Math.round);
      warnings.push(
        `the map looks OPEN to the void: from the ${from.classname} at ${place(from.origin)} there is a way out that leaves the world near ${place(found.leak.at)} (${gap.join(" ")} from it). Look for a missing or short wall there; only world brushes seal (${basis})`,
      );
    } else if (found.from) {
      facts.push(`no way out to the void found from ${found.from} entities (${basis})`);
    }
    if (found.note) facts.push(found.note);
  }

  // the entities against the mod: its classes and keys, the names, its rules, its files
  if (mod || options.definitions) {
    const found = checkAgainstMod(map, {
      mod: options.mod,
      definitions: options.definitions,
      folders: options.folders,
    });
    errors.push(...found.errors);
    warnings.push(...found.warnings);
    facts.push(...found.facts);
  }

  const faces = listed.reduce((sum, one) => sum + (one.brush?.faces?.length ?? 0), 0);
  const entities = map.entities ?? [];
  const brushEntities = entities.filter((entity) => entity.brushes?.length).length;
  facts.unshift(
    `${world.length} world brushes, ${listed.length - world.length} brushes in ${brushEntities} brush entities, ${faces} faces, ${entities.length - brushEntities} point entities`,
  );
  const corners = world.flatMap((one) => shapes.get(one.brush)?.corners ?? []);
  if (corners.length) {
    const min = [0, 1, 2].map((i) => Math.min(...corners.map((corner) => corner[i])));
    const max = [0, 1, 2].map((i) => Math.max(...corners.map((corner) => corner[i])));
    facts.splice(1, 0, `the world runs from ${place(min)} to ${place(max)}: ${place(sub(max, min))} units`);
  }
  return { errors, warnings, facts, leak: hint };
}
