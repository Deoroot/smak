// The solid space of a map, asked along upright lines: at a place (x, y), the heights at which a body cannot
// be. It is one thing for brush source (what `writeMap` takes) and for a compiled map (what `readBsp` gave),
// so that the walk test (reach.mjs), the side section and the true sizes of entities (draw.mjs) are worked
// out once for both.
//
// A BODY is the box a thing moves with, told about the point its FEET are at: half its width each way, and
// its height. The engine has four (`HULLS` of bsp.mjs, told about their middles): a point, a standing
// player, a large monster, a crouching player.
//
//   source     every solid brush is grown by the body, the way the compilers make their clip hulls: each of
//              its planes moved out by the body's reach along it, and the brush's own box grown by the body.
//              Where planes meet at a slant the grown brush is a little larger than the true one (the
//              compilers bevel those edges too, and not in the same way): a body is never let through a
//              place it does not fit, and may be kept out of one it would only just fit, at a slant
//   compiled   the map's own clip hull of that body is walked, so `clip` brushes count as the game counts
//              them; a point asks the drawn world
//
// A point ON a solid's face is not in it: a body 32 wide passes a gap 32 wide, and stands in a room exactly
// 72 high. The game is less sure of such a fit; `reachOf` warns of openings that are only just wide enough.
import { dot } from "../../core/vec.mjs";
import { CONTENTS, HULLS, worldBounds } from "../../core/maps/bsp.mjs";
import { valueOf, originOf, brushModelOf } from "../../core/maps/entities.mjs";
import { shapeOf, planesOf } from "./source.mjs";

// ── constants ───────────────────────────────────────────────────────────────
/**
 * The boxes things move with, each about the point its feet are at: `half` its width each way, `height`
 * upwards, and `hull`, the number of the compiled map's hull that is this box. The "point" is a probe 2
 * across and 2 high, not nothing at all: a true point would slip along the seam where two brushes touch.
 */
export const BODIES = {
  point: { name: "point", half: 1, height: 2, hull: 0, words: "a point" },
  standing: { name: "standing", half: 16, height: 72, hull: 1, words: "a standing player (32 x 32 x 72)" },
  large: { name: "large", half: 32, height: 64, hull: 2, words: "a large monster (64 x 64 x 64)" },
  crouching: { name: "crouching", half: 16, height: 36, hull: 3, words: "a crouching player (32 x 32 x 36)" },
};
/**
 * The classes that are a place to start: Half-Life's own, and the mods' the kit knows (Master Sword's
 * `ms_player_begin`, where a new character begins, and `ms_player_spawn`, where one arrives from another
 * map). `checkPlan` and `reachOf` count them without being asked.
 */
export const START_CLASSES = [
  "info_player_start",
  "info_player_deathmatch",
  "ms_player_begin",
  "ms_player_spawn",
];
/** What tells a place to start, and a thing that walks (a monster, an NPC), by classname. */
export const STARTS = /^(info_player_(start|deathmatch|coop)|ms_player_(begin|spawn))$/;
export const WALKERS = /^(monster_|msmonster_|ms_npc$|msnpc_|npc_)/;
/** Brush entities that never stop a body, whatever they are made of. */
const NEVER_SOLID =
  /^(trigger_|msarea_|mstrig_|func_illusionary$|func_ladder$|func_water$|func_monsterclip$|func_buyzone$|func_bomb_target$|func_friction$|func_mortar_field$|env_)/;
/** Brush entities that open: taken as open unless told. */
export const DOORS = /^(func_door|func_door_rotating|momentary_door)$/;
/**
 * Brush entities that are a wall until the game takes them away: one that breaks, one that is switched on
 * and off by name, one that is pushed aside (the Half-Life SDK's dlls/func_break.cpp and bmodels.cpp). They
 * are walls unless told (`walls: "gone"`, or `open` by name).
 */
export const GIVES_WAY = /^(func_breakable|func_wall_toggle|func_pushable)$/;
/**
 * A `func_wall_toggle` whose spawnflags have this bit is not there when the map begins (the SDK's
 * dlls/bmodels.cpp: SF_WALL_START_OFF is 1, and CFuncWallToggle::Spawn turns such a wall off).
 */
const TOGGLE = "func_wall_toggle";
const STARTS_OFF = 1;

/**
 * Whether a classname is one of a list of names, each the whole name or with `*` for any letters; and, when
 * it is, what stood where the first `*` is (the name itself for one with no `*`). Null when it is none.
 * A mod's way of switching an entity off is such a name: `disabled_*` makes of an `msarea_transition` a
 * `disabled_msarea_transition`, a class the game does not have, and what stands for the `*` is the class it
 * would be.
 */
export function classUnder(list, classname) {
  for (const each of list ?? []) {
    if (typeof each !== "string") continue;
    if (!each.includes("*")) {
      if (each === classname) return classname;
      continue;
    }
    const parts = each.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
    const found = new RegExp(`^${parts.join("(.*)")}$`).exec(classname);
    if (found) return found[1];
  }
  return null;
}
/** Brush entities a body climbs or swims up through: a ladder, and water that is an entity. */
const LADDERS = /^func_ladder$/;
/**
 * A lift: a body rides it between its two ends, so the walk takes it as a ladder in its shaft, its brush not a
 * wall (it moves). Its other end is `height` under where it is built, or with none its own height less 8 (the
 * Half-Life SDK's dlls/plats.cpp, CFuncPlat::Setup); a height under 0 is over it: a lift built at the bottom
 * that rides up.
 */
const LIFTS = /^func_plat$/;
const liftOf = (number, min, max, height) => {
  const other = max[2] - (Number(height) || max[2] - min[2] - 8);
  return { number, lift: true, ends: [max[2], other], min: [min[0], min[1], Math.min(max[2], other) - 1], max: [max[0], max[1], Math.max(max[2], other)] }; // prettier-ignore
};
const WATERS = /^func_water$/;
/**
 * Textures that make a brush nothing to a body; `clip` stops every body but the point. Measured in the clip hulls
 * of maps compiled with VHLT and SDHLT 1.3.1: NOCLIP, NULLNOCLIP, SKIP and SPLITFACE let a body through;
 * SOLIDHINT and BEVELHINT are solid to it, as a wall is.
 */
const NOTHING_TO_A_BODY =
  /^(origin|hint|skip|splitface|aaatrigger|contentwater|contentempty|boundingbox|noclip|nullnoclip)$/i;
const CLIP = /^clip/i;
const LIQUID = /^(!|\*|water)/i;
const SKY = /^sky/i;
/** What a cut finds, in the order it is painted: the last wins where two are in one place. */
const CUT_ORDER = { liquid: 0, sky: 1, solid: 2 };
/** A height this far inside a solid is in it; nearer its face, it is on the face (units). */
const ON_FACE = 1 / 64;
/** The side of the squares the source's brushes are sorted into, so that a place asks only those near it. */
const BUCKET = 256;
/** A straight line through a compiled map is looked at every this many units. */
const SIGHT_STEP = 4;
/** The furthest a compiled map's tree is walked down before it is taken to loop (a broken file). */
const DEEPEST = 4096;

// ── small tools ─────────────────────────────────────────────────────────────
/** Three numbers from a value of a map: `[x, y, z]`, `"x y z"`, or null. */
export function pointOf(value) {
  if (Array.isArray(value)) return value.length === 3 && value.every(Number.isFinite) ? [...value] : null;
  if (typeof value !== "string") return null;
  const numbers = value.trim().split(/\s+/).map(Number);
  return numbers.length === 3 && numbers.every(Number.isFinite) ? numbers : null;
}
/** Whether this is a compiled map (what `readBsp` gives) and not brush source. */
export const isCompiled = (map) => Array.isArray(map?.faces) && Array.isArray(map?.leaves);

/**
 * A list of stretches `[from, to, slant]` put in order and joined where they overlap; those that only touch
 * are joined when `touching` (two brushes one on the other leave no height between them). `slant` is how
 * the face at a stretch's top lies (1: level), and a joined stretch keeps that of its highest.
 */
function joined(stretches, touching) {
  if (stretches.length < 2) return stretches;
  stretches.sort((a, b) => a[0] - b[0]);
  const out = [stretches[0]];
  for (let index = 1; index < stretches.length; index++) {
    const last = out[out.length - 1];
    const next = stretches[index];
    if (next[0] < last[1] - ON_FACE || (touching && next[0] <= last[1] + ON_FACE)) {
      if (next[1] > last[1]) {
        last[1] = next[1];
        last[2] = next[2];
      }
    } else out.push(next);
  }
  return out;
}

// ── a body as it is asked for ───────────────────────────────────────────────
/**
 * The body a caller means: one of `BODIES`, the name of one ("point", "standing", "large", "crouching"),
 * or a box of its own `{ half, height }` (one of exactly a hull's size is that hull). Anything else is
 * refused in a sentence. `what` names the asker in that sentence.
 */
export function bodyOf(body = BODIES.standing, what = "body") {
  if (typeof body === "string" && Object.hasOwn(BODIES, body)) return BODIES[body];
  if (body && typeof body === "object" && body.half > 0 && body.height > 0) {
    if (Number.isInteger(body.hull) || body.hull === null) return body;
    return (
      Object.values(BODIES).find((each) => each.half === body.half && each.height === body.height) ?? {
        name: "own",
        words: "a box of its own",
        ...body,
        hull: null,
      }
    );
  }
  throw new Error(
    `${what}: one of maps.BODIES, its name (${Object.keys(BODIES)
      .map((name) => `"${name}"`)
      .join(", ")}) or a box { half, height }, not ${JSON.stringify(body) ?? String(body)}`,
  );
}

// ── which body a thing has ──────────────────────────────────────────────────
/**
 * The box an entity stands in, from its class: `{ body, feet, mins, maxs }`, or null for a thing with no
 * body the kit knows of (a light, a sound, an item). `feet` is how far under its origin its feet are, `mins`
 * and `maxs` the box about its origin.
 *
 * A place to start has its origin at the middle of a standing player: its feet are 36 under it. A monster
 * or an NPC is taken to have its origin at its FEET, as Half-Life's monsters have. Master Sword's own maps
 * put their people 16 to 60 over the floor (measured on edana), which fits an origin at the feet and a drop
 * to the floor as they appear; the kit has not seen it in the game.
 *
 *   bodies   `{ name: "standing" | "large" | "crouching" | { half, height, feet } }`, the name a classname
 *            or a targetname: says which box a thing moves with when its class does not (a large monster),
 *            and with `feet`, how far under its origin its feet are
 */
export function bodyFor(classname, targetname, bodies = {}) {
  const asked = bodies[targetname] ?? bodies[classname];
  const walks = STARTS.test(classname) || WALKERS.test(classname);
  if (!asked && !walks) return null;
  let body = BODIES.standing;
  if (typeof asked === "string") {
    body = BODIES[asked];
    if (!body) throw new Error(`bodies: "standing", "large", "crouching" or { half, height }, not ${asked}`);
  } else if (asked) {
    if (!(asked.half > 0 && asked.height > 0))
      throw new Error(`bodies: a box of its own is { half, height }, both over 0, for ${classname}`);
    // a box of exactly a hull's size is that hull (a profile gives every class its box in numbers)
    body = Object.values(BODIES).find((each) => each.half === asked.half && each.height === asked.height) ?? {
      name: "own",
      half: asked.half,
      height: asked.height,
      hull: null,
      words: "a box of its own",
    };
  }
  const feet = asked?.feet ?? (STARTS.test(classname) ? body.height / 2 : 0);
  return {
    body,
    feet,
    mins: [-body.half, -body.half, -feet],
    maxs: [body.half, body.half, body.height - feet],
  };
}

// ── brush source ────────────────────────────────────────────────────────────
/** What a brush is to a body, by what it wears: "solid", "sky", "clip", "liquid" or "nothing". */
function matterOf(brush) {
  const names = brush.faces.map((face) => face.texture);
  if (names.some((name) => NOTHING_TO_A_BODY.test(name))) return "nothing";
  if (names.some((name) => LIQUID.test(name))) return "liquid";
  if (names.some((name) => CLIP.test(name))) return "clip";
  // sky on every face: a brush of the sky. On some faces only (a carved room's ceiling), it is rock with
  // the sky painted on it
  return names.every((name) => SKY.test(name)) ? "sky" : "solid";
}

/** A brush as the space keeps it: its planes, its box, and what it is; null for one that is no sound solid. */
function solidOf(brush, matter) {
  const shape = shapeOf(brush);
  if (shape.faults.length || !shape.corners.length) return null;
  return { planes: planesOf(brush), min: shape.min, max: shape.max, matter };
}

/**
 * The stretch of heights at (x, y) at which a body's feet are inside a solid grown by the body: `[from, to,
 * slant]`, or null when the upright line misses it. `slant` is the z of the normal of the face the stretch
 * ends at, its top: 1 for a level floor, less as it slopes (the engine lets nobody stand under 0.7).
 */
function stretchIn(solid, x, y, half, height) {
  if (
    x <= solid.min[0] - half + ON_FACE ||
    x >= solid.max[0] + half - ON_FACE ||
    y <= solid.min[1] - half + ON_FACE ||
    y >= solid.max[1] + half - ON_FACE
  )
    return null;
  let from = solid.min[2] - height;
  let to = solid.max[2];
  let slant = 1;
  for (const { normal, dist } of solid.planes) {
    // the plane moved out by the body's reach along it: the feet are under the box, so it reaches up by
    // nothing and down by its height
    const reach =
      half * (Math.abs(normal[0]) + Math.abs(normal[1])) + (normal[2] < 0 ? -normal[2] * height : 0);
    const left = dist + reach - normal[0] * x - normal[1] * y;
    if (Math.abs(normal[2]) < 1e-9) {
      if (left <= ON_FACE) return null;
    } else if (normal[2] > 0) {
      if (left / normal[2] < to) {
        to = left / normal[2];
        slant = normal[2];
      }
    } else from = Math.max(from, left / normal[2]);
    if (to - from <= ON_FACE) return null;
  }
  return [from, to, slant];
}

/** Whether the straight line from `from` to `to` passes through the inside of a solid. */
function lineCrosses(solid, from, to) {
  let enters = 0;
  let leaves = 1;
  for (const plane of solid.planes) {
    const here = dot(plane.normal, from) - plane.dist;
    const there = dot(plane.normal, to) - plane.dist;
    if (here >= -ON_FACE && there >= -ON_FACE) return false;
    if (here < -ON_FACE && there < -ON_FACE) continue;
    const share = here / (here - there);
    if (here >= -ON_FACE) enters = Math.max(enters, share);
    else leaves = Math.min(leaves, share);
    if (enters >= leaves) return false;
  }
  return true;
}

/** The space of brush source. */
function sourceSpace(map, { doors, walls, open, shut, off }) {
  if (!Array.isArray(map?.brushes))
    throw new Error(
      "the map's source is { worldspawn, brushes, entities }: what `writeMap` takes and `readMap` gives",
    );
  const solids = [];
  const climbs = [];
  const ladders = [];
  const doorList = [];
  const areas = [];
  const keep = (brush, matter) => {
    const solid = brush?.faces ? solidOf(brush, matter ?? matterOf(brush)) : null;
    if (!solid || solid.matter === "nothing") return;
    if (solid.matter === "liquid") climbs.push({ ...solid, kind: "liquid" });
    else solids.push(solid);
  };
  for (const brush of map.brushes.flat()) keep(brush);
  (map.entities ?? []).forEach((entity, index) => {
    if (!entity.brushes?.length) return;
    const number = index + 1;
    const classname = String(entity.classname ?? "");
    const shapes = entity.brushes.map((brush) => solidOf(brush, matterOf(brush))).filter(Boolean);
    if (!shapes.length) return;
    const real = shapes.filter((shape) => shape.matter !== "nothing");
    const boxed = real.length ? real : shapes;
    const min = [0, 1, 2].map((axis) => Math.min(...boxed.map((shape) => shape.min[axis])));
    const max = [0, 1, 2].map((axis) => Math.max(...boxed.map((shape) => shape.max[axis])));
    const named = [number, classname, entity.targetname].filter((name) => name !== undefined);
    // a class the game does not have is never made: its brushes are not there, whatever they would be
    if (classUnder(off, classname) !== null) {
      areas.push({ number, classname, targetname: entity.targetname, min, max, door: false, open: true, off: true }); // prettier-ignore
      return;
    }
    const isDoor = DOORS.test(classname);
    const gives = givesWay(classname, entity.spawnflags, walls);
    const held = gives.gone || named.some((name) => open.includes(name));
    const kept = named.some((name) => shut.includes(name));
    const isOpen = !kept && (held || (isDoor && doors !== "closed"));
    const solid = !NEVER_SOLID.test(classname) && !LADDERS.test(classname) && !LIFTS.test(classname) && !WATERS.test(classname); // prettier-ignore
    areas.push({
      ...{ number, classname, targetname: entity.targetname, min, max, door: isDoor, open: isOpen },
      ...{ solid, gives: gives.class },
    });
    if (isDoor || held)
      doorList.push({ number, classname, targetname: entity.targetname, min, max, open: isOpen });
    if (LADDERS.test(classname) || LIFTS.test(classname)) {
      const way = LIFTS.test(classname) ? liftOf(number, min, max, entity.height) : { number, min, max };
      climbs.push({ kind: "ladder", min: way.min, max: way.max });
      ladders.push(way);
    } else if (WATERS.test(classname)) for (const shape of real) climbs.push({ ...shape, kind: "liquid" });
    else if (solid && !isOpen) for (const shape of real) if (shape.matter !== "liquid") solids.push(shape);
  });
  const world = map.brushes.flat().map((brush) => (brush?.faces ? shapeOf(brush) : null));
  const sound = world.filter((shape) => shape && shape.corners.length && Number.isFinite(shape.volume));
  if (!sound.length) throw new Error("the map has no brush of the world: there is no space to ask about");
  const min = [0, 1, 2].map((axis) => Math.min(...sound.map((shape) => shape.min[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...sound.map((shape) => shape.max[axis])));

  // the brushes sorted into squares, each with those whose box, grown by the largest body, touches it
  const buckets = new Map();
  const reachMost = BODIES.large.half + 1;
  const bucketOf = (value) => Math.floor(value / BUCKET);
  solids.forEach((solid) => {
    for (let i = bucketOf(solid.min[0] - reachMost); i <= bucketOf(solid.max[0] + reachMost); i++)
      for (let j = bucketOf(solid.min[1] - reachMost); j <= bucketOf(solid.max[1] + reachMost); j++) {
        const key = `${i} ${j}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(solid);
      }
  });
  const near = (x, y) => buckets.get(`${bucketOf(x)} ${bucketOf(y)}`) ?? [];
  return {
    compiled: false,
    min,
    max,
    doors: doorList,
    areas,
    ladders,
    blocked(x, y, body) {
      body = bodyOf(body, "blocked");
      const stretches = [];
      for (const solid of near(x, y)) {
        if (solid.matter === "clip" && body.hull === 0) continue;
        const stretch = stretchIn(solid, x, y, body.half, body.height);
        if (stretch) stretches.push(stretch);
      }
      return joined(stretches, false);
    },
    climbs(x, y, body) {
      body = bodyOf(body, "climbs");
      const stretches = [];
      for (const climb of climbs) {
        if (climb.kind === "liquid") {
          const stretch = stretchIn(climb, x, y, 0, 0);
          if (stretch) stretches.push(stretch);
        } else if (
          x > climb.min[0] - body.half - 1 &&
          x < climb.max[0] + body.half + 1 &&
          y > climb.min[1] - body.half - 1 &&
          y < climb.max[1] + body.half + 1
        )
          stretches.push([climb.min[2], climb.max[2]]);
      }
      return joined(stretches, true);
    },
    hasClimbs: climbs.length > 0,
    cut(x, y) {
      const pieces = [];
      for (const climb of climbs) {
        const stretch = climb.kind === "liquid" ? stretchIn(climb, x, y, 0, 0) : null;
        if (stretch) pieces.push([stretch[0], stretch[1], "liquid"]);
      }
      for (const solid of near(x, y)) {
        const stretch = solid.matter === "clip" ? null : stretchIn(solid, x, y, 0, 0);
        if (stretch) pieces.push([stretch[0], stretch[1], solid.matter === "sky" ? "sky" : "solid"]);
      }
      return pieces.sort((a, b) => CUT_ORDER[a[2]] - CUT_ORDER[b[2]]);
    },
    sees(from, to) {
      const low = [Math.min(from[0], to[0]), Math.min(from[1], to[1])];
      const high = [Math.max(from[0], to[0]), Math.max(from[1], to[1])];
      const tried = new Set();
      for (let i = bucketOf(low[0]); i <= bucketOf(high[0]); i++)
        for (let j = bucketOf(low[1]); j <= bucketOf(high[1]); j++)
          for (const solid of buckets.get(`${i} ${j}`) ?? []) {
            if (tried.has(solid) || solid.matter === "clip") continue;
            tried.add(solid);
            if (lineCrosses(solid, from, to)) return false;
          }
      return true;
    },
  };
}

// ── a compiled map ──────────────────────────────────────────────────────────
/** Whether a place of a hull stops a body: solid, and the sky, which is a wall to everything. */
const stops = (contents) =>
  contents === CONTENTS.SOLID || contents === CONTENTS.SKY || contents === CONTENTS.CLIP;
/** Whether a place is a liquid. */
const isLiquid = (contents) => contents <= CONTENTS.WATER && contents >= CONTENTS.LAVA;

/**
 * The upright line at (x, y) from `low` to `high`, cut by a tree of the map into pieces of one kind each:
 * `[[from, to, contents, slant]]`, upwards; `slant` is the z of the normal of the plane a piece ends at, its
 * top (undefined where the line's own end, or a plane it lies in, ends it). `nodes` is the map's nodes (a child under 0 is a leaf) or its clipnodes
 * (a child under 0 is the contents itself). A line that lies IN a plane is asked of both sides, and what
 * stops a body counts only where both do: a point on a wall's face is not in the wall. With `strict` it
 * counts where either does: the point is then a probe with some width, which a thin wall whose two faces
 * both lie on the grid does not let through.
 */
function cutUpright(bsp, nodes, head, x, y, low, high, leaves, strict = false) {
  const contentsOf = (child) => (leaves ? (bsp.leaves[-1 - child]?.contents ?? CONTENTS.SOLID) : child);
  const walk = (at, from, to, depth) => {
    if (at < 0) return [[from, to, contentsOf(at)]];
    if (depth > DEEPEST) throw new Error("the map's tree never ends: it loops (a broken file)");
    const node = nodes[at];
    const plane = node && bsp.planes[node.plane];
    if (!plane) throw new RangeError(`the map's tree points outside the file (at ${at})`);
    const flat = plane.normal[0] * x + plane.normal[1] * y - plane.dist;
    const under = flat + plane.normal[2] * from;
    const over = flat + plane.normal[2] * to;
    if (Math.abs(under) <= ON_FACE && Math.abs(over) <= ON_FACE)
      return eitherSide(
        walk(node.children[0], from, to, depth + 1),
        walk(node.children[1], from, to, depth + 1),
        strict,
      );
    if (under >= -ON_FACE && over >= -ON_FACE) return walk(node.children[0], from, to, depth + 1);
    if (under <= ON_FACE && over <= ON_FACE) return walk(node.children[1], from, to, depth + 1);
    const cut = from + ((to - from) * under) / (under - over);
    const lower = walk(node.children[under >= 0 ? 0 : 1], from, cut, depth + 1);
    // the piece that ends at this cut ends on this plane
    if (lower.length) lower[lower.length - 1][3] = Math.abs(plane.normal[2]);
    return [...lower, ...walk(node.children[over >= 0 ? 0 : 1], cut, to, depth + 1)];
  };
  return walk(head, low, high, 0);
}

/**
 * Two cuts of one line, as one: at each height, what does not stop a body where either does not; with
 * `strict`, what stops it where either does.
 */
function eitherSide(front, back, strict) {
  const marks = [...new Set([...front, ...back].flatMap((piece) => [piece[0], piece[1]]))].sort(
    (a, b) => a - b,
  );
  const at = (pieces, height) => pieces.find((piece) => height >= piece[0] && height <= piece[1])?.[2];
  const out = [];
  for (let index = 0; index + 1 < marks.length; index++) {
    const middle = (marks[index] + marks[index + 1]) / 2;
    const a = at(front, middle) ?? CONTENTS.SOLID;
    const b = at(back, middle) ?? CONTENTS.SOLID;
    out.push([marks[index], marks[index + 1], stops(a) === strict ? a : b]);
  }
  return out;
}

/** The space of a compiled map. */
function compiledSpace(bsp, { doors, walls, open, shut, off }) {
  const { mins, maxs } = worldBounds(bsp);
  const low = mins[2] - 128;
  const high = maxs[2] + 128;
  const others = [];
  const ladders = [];
  const waters = [];
  const doorList = [];
  const areas = [];
  bsp.entities.forEach((entity, number) => {
    const model = number === 0 ? null : brushModelOf(entity);
    if (model === null || !bsp.models[model]) return;
    const classname = valueOf(entity, "classname") ?? "";
    const targetname = valueOf(entity, "targetname");
    const origin = originOf(entity) ?? [0, 0, 0];
    const min = bsp.models[model].mins.map((value, axis) => value + origin[axis]);
    const max = bsp.models[model].maxs.map((value, axis) => value + origin[axis]);
    const named = [number, classname, targetname].filter((name) => name !== undefined);
    // a class the game does not have is never made: its brushes are not there, whatever they would be
    if (classUnder(off, classname) !== null) {
      areas.push({ number, classname, targetname, min, max, door: false, open: true, off: true });
      return;
    }
    const isDoor = DOORS.test(classname);
    const gives = givesWay(classname, valueOf(entity, "spawnflags"), walls);
    const held = gives.gone || named.some((name) => open.includes(name));
    const kept = named.some((name) => shut.includes(name));
    const isOpen = !kept && (held || (isDoor && doors !== "closed"));
    const solid = !NEVER_SOLID.test(classname) && !LADDERS.test(classname) && !LIFTS.test(classname) && !WATERS.test(classname); // prettier-ignore
    areas.push({ number, classname, targetname, min, max, door: isDoor, open: isOpen, solid, gives: gives.class }); // prettier-ignore
    if (isDoor || held) doorList.push({ number, classname, targetname, min, max, open: isOpen });
    if (LADDERS.test(classname)) ladders.push({ number, min, max });
    else if (LIFTS.test(classname)) ladders.push(liftOf(number, min, max, valueOf(entity, "height")));
    else if (WATERS.test(classname)) waters.push({ min, max });
    else if (solid && !isOpen) others.push({ model: bsp.models[model], origin, min, max });
  });
  const worldLiquid = bsp.leaves.some((leaf) => isLiquid(leaf.contents));
  const world = bsp.models[0];
  // the solid brush entities sorted into squares, each with those whose box, grown by the largest body,
  // touches it: a place asks only those near it (a map may have hundreds)
  const buckets = new Map();
  const reachMost = BODIES.large.half + 1;
  const bucketOf = (value) => Math.floor(value / BUCKET);
  for (const other of others)
    for (let i = bucketOf(other.min[0] - reachMost); i <= bucketOf(other.max[0] + reachMost); i++)
      for (let j = bucketOf(other.min[1] - reachMost); j <= bucketOf(other.max[1] + reachMost); j++) {
        const key = i * 65536 + j;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(other);
      }
  const none = [];
  const near = (x, y) => buckets.get(bucketOf(x) * 65536 + bucketOf(y)) ?? none;
  /** The stretches a tree stops a body in, over a list of pieces. */
  const stopped = (pieces, shift) =>
    pieces
      .filter((piece) => stops(piece[2]))
      .map((piece) => [piece[0] + shift, piece[1] + shift, piece[3] ?? 1]);
  /** Whether a point is in what stops a line of sight: the world's tree, walked down to its leaf. */
  const pointStops = (point) => {
    let at = world.headNodes[0];
    while (at >= 0) {
      const node = bsp.nodes[at];
      const plane = bsp.planes[node.plane];
      at = node.children[dot(plane.normal, point) - plane.dist >= 0 ? 0 : 1];
    }
    return stops(bsp.leaves[-1 - at]?.contents ?? CONTENTS.SOLID);
  };
  return {
    compiled: true,
    min: [...mins],
    max: [...maxs],
    doors: doorList,
    areas,
    ladders,
    blocked(x, y, body) {
      body = bodyOf(body, "blocked");
      if (body.hull === null)
        throw new Error(
          "a compiled map holds only its four hulls: a body of its own size cannot be asked of it",
        );
      const hull = body.hull;
      // a hull is told about the body's middle: its feet are that far under
      const feet = hull === 0 ? 0 : HULLS[hull].mins[2];
      const nodes = hull === 0 ? bsp.nodes : bsp.clipnodes;
      // the point is a probe 2 across, as in source: a face it lies on stops it
      const point = hull === 0;
      const stretches = stopped(
        cutUpright(bsp, nodes, world.headNodes[hull], x, y, low, high, point, point),
        feet,
      );
      for (const other of near(x, y)) {
        if (
          x < other.min[0] - body.half ||
          x > other.max[0] + body.half ||
          y < other.min[1] - body.half ||
          y > other.max[1] + body.half
        )
          continue;
        const pieces = cutUpright(
          bsp,
          nodes,
          other.model.headNodes[hull],
          x - other.origin[0],
          y - other.origin[1],
          low - other.origin[2],
          high - other.origin[2],
          point,
          point,
        );
        stretches.push(...stopped(pieces, feet + other.origin[2]));
      }
      return joined(stretches, true);
    },
    climbs(x, y, body) {
      body = bodyOf(body, "climbs");
      const stretches = [];
      for (const ladder of ladders)
        if (
          x > ladder.min[0] - body.half - 1 &&
          x < ladder.max[0] + body.half + 1 &&
          y > ladder.min[1] - body.half - 1 &&
          y < ladder.max[1] + body.half + 1
        )
          stretches.push([ladder.min[2], ladder.max[2]]);
      for (const water of waters)
        if (x > water.min[0] && x < water.max[0] && y > water.min[1] && y < water.max[1])
          stretches.push([water.min[2], water.max[2]]);
      if (worldLiquid)
        for (const piece of cutUpright(bsp, bsp.nodes, world.headNodes[0], x, y, low, high, true))
          if (isLiquid(piece[2])) stretches.push([piece[0], piece[1]]);
      return joined(stretches, true);
    },
    hasClimbs: ladders.length > 0 || waters.length > 0 || worldLiquid,
    cut(x, y) {
      const pieces = [];
      for (const [from, to, contents] of cutUpright(
        bsp,
        bsp.nodes,
        world.headNodes[0],
        x,
        y,
        low,
        high,
        true,
      )) {
        const kind =
          contents === CONTENTS.SOLID
            ? "solid"
            : contents === CONTENTS.SKY
              ? "sky"
              : isLiquid(contents)
                ? "liquid"
                : null;
        if (kind) pieces.push([from, to, kind]);
      }
      return pieces.sort((a, b) => CUT_ORDER[a[2]] - CUT_ORDER[b[2]]);
    },
    sees(from, to) {
      const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
      const steps = Math.max(1, Math.ceil(length / SIGHT_STEP));
      for (let step = 1; step < steps; step++) {
        const share = step / steps;
        const point = [0, 1, 2].map((axis) => from[axis] + (to[axis] - from[axis]) * share);
        if (pointStops(point)) return false;
      }
      return true;
    },
    firstStop(from, to, precision = 1) {
      // one walk along the line in steps of SIGHT_STEP, then the step that stopped cut in halves: what
      // `sees` asked of every length at once
      const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
      if (!(length > 0)) return null;
      const along = (distance) => [0, 1, 2].map((axis) => from[axis] + ((to[axis] - from[axis]) * distance) / length);
      for (let distance = SIGHT_STEP; distance < length; distance += SIGHT_STEP) {
        if (!pointStops(along(distance))) continue;
        let near = distance - SIGHT_STEP;
        let beyond = distance;
        while (beyond - near > precision) {
          const middle = (near + beyond) / 2;
          if (pointStops(along(middle))) beyond = middle;
          else near = middle;
        }
        return near;
      }
      return null;
    },
  };
}

// ── the space ───────────────────────────────────────────────────────────────
/** A list of names as an option gives it: one, or several. */
const listOf = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

/**
 * Whether a brush entity is of a class that gives way (`class`), and whether it is taken as gone without
 * being named (`gone`): with `walls: "gone"`, every one; and always a `func_wall_toggle` that starts off,
 * which is not there when the map begins.
 */
function givesWay(classname, spawnflags, walls) {
  const ofClass = GIVES_WAY.test(classname);
  const startsOff = classname === TOGGLE && (Number(spawnflags) & STARTS_OFF) === STARTS_OFF;
  return { class: ofClass, gone: ofClass && (walls === "gone" || startsOff) };
}

/**
 * The solid space of a map: brush source or a compiled map.
 *
 *   doors     "open" (unless told): a brush entity that opens (`func_door`, `func_door_rotating`,
 *             `momentary_door`) stops nothing. "closed": it is a wall where it stands
 *   open      more brush entities to take as not there, by number, classname or targetname (a wall that
 *             breaks, a gate a script lifts)
 *   shut      doors to take as closed all the same, named the same way (a door that needs a key)
 *   walls     "standing" (unless told): a brush entity that gives way in the game (`GIVES_WAY`: a
 *             `func_breakable`, a `func_wall_toggle`, a `func_pushable`) is a wall where it stands.
 *             "gone": each is taken as not there, as a door is taken as open; `shut` names those to
 *             keep. A `func_wall_toggle` that starts off (spawnflag 1) is not there either way: it is
 *             not there when the map begins
 *   mod       a mod's profile (mod.mjs): its `off` and the classes of its `doors` are taken with what is
 *             given here by name
 *   off       classnames that are an entity switched off, each a name or with `*` for any letters (a mod's
 *             `disabled_*`): the engine makes no entity of a class the game does not have, so a brush
 *             entity of such a class stops nothing. Its box is still among `areas`, with `off: true`
 *
 * It returns
 *   { compiled, min, max, doors: [{ number, classname, targetname, min, max, open }],
 *     areas: [{ number, classname, targetname, min, max, door, open, off, solid, gives }]   every brush
 *                           entity's box; `solid`: its class stops a body when it is not open; `gives`:
 *                           its class is one that gives way,
 *     ladders: [{ number, min, max }]   the boxes of the ladders,
 *     blocked(x, y, body)   the stretches of height `[[from, to, slant]]`, upwards, at which the body's
 *                           FEET cannot be at (x, y): inside the floor, and so near under a ceiling that its
 *                           head is in it. Between two stretches it fits; it stands on the top of one, and
 *                           `slant` says how that top lies: the z of its normal, 1 for a level floor,
 *     climbs(x, y, body)    the stretches a body climbs or swims up through there: ladders and liquids,
 *     cut(x, y)             what an upright line there passes through: `[[from, to, kind]]`, the kind
 *                           "solid", "sky" or "liquid" (the world only: for a side section),
 *     sees(from, to)        whether the straight line between two points touches nothing solid,
 *     firstStop(from, to, precision)   a compiled map's only: how far along that line it first meets
 *                           something solid, to within `precision` (1), or null when it meets nothing }
 *
 * `body` is one of `BODIES` or its name, "point", "standing", "large" or "crouching" (the standing player
 * unless told); anything else is refused in a sentence (`bodyOf`). What stops a body: the world's brushes
 * (`clip` too, but for the point; liquids and the compilers' marks do not), and every brush entity but
 * triggers, ladders, water, `func_illusionary` and the like, and but the doors that are open.
 */
export function spaceOf(map, { doors = "open", walls = "standing", open, shut, off, mod } = {}) {
  if (doors !== "open" && doors !== "closed") throw new Error(`doors: "open" or "closed", not ${doors}`);
  if (walls !== "standing" && walls !== "gone")
    throw new Error(`walls: "standing" or "gone", not ${JSON.stringify(walls) ?? String(walls)}`);
  const options = { doors, walls, open: listOf(open), shut: listOf(shut), off: listOf(off) };
  // a profile's part, for a caller that hands it over as it is (the walk test and the pictures have taken
  // theirs out already, with `withMod`): its switched-off names, and the classes of its own that open
  if (mod && typeof mod === "object") {
    options.off = [...listOf(mod.off), ...options.off];
    if (doors !== "closed")
      options.open = [...listOf(mod.doors).filter((name) => !DOORS.test(name)), ...options.open];
  }
  return isCompiled(map) ? compiledSpace(map, options) : sourceSpace(map, options);
}

/**
 * Where a body rests at a place, and whether it fits there: `{ fits, floor, hang, stretch }`. `feet` is the
 * point its feet are at. `fits` is false when its box is in something solid, and `stretch` is then the
 * `[from, to]` of heights it is stopped in (it fits again with its feet at `to`). `floor` is the height it
 * would come to rest at if it fell (null: nothing under it), `hang` how far over that its feet are.
 */
export function restOf(space, feet, body) {
  body = bodyOf(body, "restOf");
  const stretches = space.blocked(feet[0], feet[1], body);
  const inside = stretches.find(
    (stretch) => feet[2] > stretch[0] + ON_FACE && feet[2] < stretch[1] - ON_FACE,
  );
  if (inside) return { fits: false, floor: inside[1], hang: feet[2] - inside[1], stretch: inside };
  const under = stretches.filter((stretch) => stretch[1] <= feet[2] + ON_FACE).at(-1);
  if (!under) return { fits: true, floor: null, hang: null, stretch: null };
  return { fits: true, floor: under[1], hang: Math.max(0, feet[2] - under[1]), stretch: null };
}
