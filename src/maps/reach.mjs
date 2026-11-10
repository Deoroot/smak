// The walk test: where a player can get to on foot from the places to start, with no game running. It says
// which entities cannot be reached, which stand in something solid or hang over their floor, where the
// openings are and how wide and high, and how far the walk is. It reads brush source (what `writeMap` takes)
// and compiled maps (what `readBsp` gave) alike, through space.mjs.
//
// HOW. The map is laid under a grid in plan (8 units unless told). At each place of the grid the heights at
// which a standing player fits are worked out (space.mjs): each stretch of them is a SPOT, with the floor it
// stands on, how that floor lies, and how high its feet may rise. From the spots at the places to start a
// flood spreads to the spots beside: up a step of 18 at most, down any drop, never up a slope too steep to
// stand on, and with room for the whole body on the way. Each spot keeps how far the walk to it was. Then
// the flood is run backwards from the places to start: floor that was walked to and has no way back is a
// ONE-WAY place, a pit a player cannot leave.
//
// THE ENGINE'S NUMBERS, and where each is from (Half-Life's own movement code, `pm_shared.c`, which a mod
// compiles into its game; and the server's settings):
//   a step            18      `sv_stepsize`: what a walk goes up without a jump
//   a jump            45      `PM_Jump` throws a player up at sqrt(2 * 800 * 45) = 268.3 units a second; at
//                             the gravity of 800 (`sv_gravity`) that is as high as 45
//   legs drawn up     63      crouching in the air lifts the feet by half of what the body loses (72 to 36):
//                             18 more
//   a run             320     `sv_maxspeed`: the most a player's own legs give, on the ground and in the air
//   a running jump    215     the time in the air of a jump that lands as high as it began, 2 * 268.3 / 800
//                             = 0.671 seconds, at 320: so far the body's middle goes. A body stands with its
//                             middle up to 16 past an edge, so the two edges may be up to 246 apart; the
//                             grid finds a little less (the last place before an edge and the first after
//                             the other: on a grid of 8, edges 224 apart are jumped and 232 are not)
//   a slope           0.7     `PM_CategorizePosition`: on a face whose normal has a z under 0.7 (steeper
//                             than 45.6 degrees) a player is not on the ground: he slides
// A mod may change them (Master Sword has a longer jump for those who earn it; another game runs slower):
// `jump`, `speed`, `gravity` and `step` say otherwise.
//
// WHAT IT IS WORTH. A way it finds is a way the box of a player fits along, by the kit's arithmetic; the
// game's own movement (friction, the push of a door, speed gained by turning in the air) is not played. Not
// finding a way is a strong hint and no proof: an opening narrower than 32 and a cell together can fall
// between two places of the grid when it is off the grid. A jump across a gap is tried along sixteen ways
// only, and as one arc with nothing in its way. Nothing here was measured against the game: it is geometry.
//
// WHAT CARRIES THE WALK ON, besides steps. A `trigger_teleport` walked into, to where its `target` is. A
// liquid, swum up through. A ladder: at the places of the grid (the flood's own `risen`), and, because a
// ladder is often climbed in a shaft a few units wide that no place of the grid is in, along upright lines
// a unit apart all about it (`shaftsOf`). Doors are open unless told; what breaks or is switched off is a
// wall unless told (`walls: "gone"`).
//
// WHY A PART IS NOT WALKED TO. The floor a standing player fits on and the walk did not get to is put in
// parts, and each is tried the ways an entity is: a jump, a jump with the legs drawn up, crouching, then
// with every brush entity taken away (the ones in the way are named), then through open air. Each part says
// which of these it takes, where that way leaves the walked floor, and how near the walked floor comes.
import {
  BODIES,
  START_CLASSES,
  spaceOf,
  restOf,
  bodyFor,
  pointOf,
  isCompiled,
  classUnder,
} from "./space.mjs";
import { valueOf, originOf, brushModelOf, asObject } from "./entities.mjs";
import { STEP_HEIGHT } from "./source.mjs";
import { withMod } from "./mod.mjs";

// ── constants ───────────────────────────────────────────────────────────────
/** The side of a cell of the grid, in units, unless told. */
const CELL = 8;
/** The most places the grid may have; a larger map is walked on a coarser grid, and that is said. */
const MOST_PLACES = 1_200_000;
/** What a jump clears, and a jump with the legs drawn up (units): the engine's (the head of this file). */
export const JUMP_HEIGHT = 45;
export const CROUCH_JUMP_HEIGHT = 63;
/** The engine's gravity and the most a player runs at (units a second), unless told. */
export const GRAVITY = 800;
export const RUN_SPEED = 320;
/**
 * A jump's speed upwards is worked out by the engine for a gravity of 800 whatever the server's is: with
 * another gravity the same throw goes higher or lower.
 */
const JUMP_GRAVITY = 800;
/** How far the body's middle goes in a running jump that lands as high as it began: 215 units. */
export const JUMP_REACH = Math.round((2 * Math.sqrt(2 * JUMP_GRAVITY * JUMP_HEIGHT) * RUN_SPEED) / GRAVITY);
/**
 * A floor whose normal has a z under this cannot be stood on: a player slides down it (the engine's 0.7:
 * steeper than 45.6 degrees). One steeper than `SHEER` (75 degrees) is a wall with a batter: where it is no
 * taller than a step it is stepped over, as a kerb is, and is not taken as a slope.
 */
export const STEEP = 0.7;
const SHEER = 0.26;
/**
 * A floor this little higher than a step or a jump reaches is reached all the same (units): a jump's height
 * is worked out from a square root, and comes out a hair under 45.
 */
const HAIR = 1 / 64;
/** A jump's way is counted this much longer than a walk's: of two ways as long, the one walked is taken. */
const LEAP_COST = 1.001;
/** A landing more than this under where a jump began is not tried (units). */
const LEAP_DROP_MOST = 256;
/**
 * The ways a jump across a gap is tried along, in places of the grid: the eight of the compass and the
 * eight between them.
 */
const LEAP_WAYS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
  [2, 1],
  [2, -1],
  [-2, 1],
  [-2, -1],
  [1, 2],
  [1, -2],
  [-1, 2],
  [-1, -2],
];
/** Jumps that begin and land nearer one another than this are told as one (units); no more are kept. */
const SAME_LEAP = 96;
const MOST_LEAPS = 2000;
/**
 * The classes that are a way out of a map: a player who gets to one has left. Half-Life's own; a mod's are
 * named with `exits` (Master Sword's `msarea_transition`). Floor from which one is reached is no one-way
 * place.
 */
export const EXIT_CLASSES = ["trigger_changelevel"];
/** An entity is got to when a player stands within this of it (units), with nothing solid between. */
const TOUCH = 32;
/**
 * A body whose feet are more than this over its floor is said to hang. The game's own maps put their places
 * to start up to 20 over the floor and their people and walking monsters up to 64 (measured on Master
 * Sword's edana), and let them drop.
 */
const HANG_MOST = 64;
/** How far about an entity that is not reached the nearest walked floor is looked for (units). */
const NEAREST_WITHIN = 384;
/** An opening wider than this is no opening: it is a room (units). */
const WIDEST_OPENING = 256;
/**
 * On both sides of an opening the space is roomier than the opening itself: by this many times, and by this
 * many cells of the grid, at the least. A doorway 64 wide off a corridor 96 wide is one.
 */
const ROOMIER = 1.5;
const ROOMIER_CELLS = 2;
/** Openings nearer one another than this are one (units), and no more than this many are kept. */
const SAME_OPENING = 64;
const MOST_OPENINGS = 200;
/** How far before and behind an opening its two sides are looked for (units). */
const OPENING_SIDES = 128;
/** How many of one kind of fault are listed before the rest are counted. */
const LISTED = 12;
/**
 * A part of the floor that is not walked to is told when it is this large at the least (square units: a
 * square of 64); the smaller ones, the tops of crates and of walls, are counted. No more than this many are
 * told.
 */
const PART_LEAST = 4096;
const MOST_PARTS = 40;
/** How many places of a part the nearest walked floor is looked for from. */
const PART_SAMPLES = 12;
/**
 * A part of the floor not walked to that is the size of a room (square units), at a height a player stands at (its
 * floor no more than ROOM_OVER over the highest floor walked), is a warning, not a fact: a gallery reached only by a
 * jump, a court behind a wall, a lobby with a bench across its door (the plaza's walk, 2026-11-10). A part over the
 * highest floor walked with the open sky over it is a roof, and stays a fact.
 */
const ROOM_PART = 16384;
const ROOM_OVER = 320;
/** How many of the brush entities in a way are named. */
const BEHIND_LISTED = 4;
/**
 * What a walk through brush entities pays to step into one, in units of way: more than any walk is long, so
 * that of two ways the one through fewer of them is taken, however much longer it is.
 */
const TOLL = 1e7;
/**
 * A ladder is asked along upright lines a unit apart, all about it; one so large that this would be more
 * lines than this is asked along lines farther apart.
 */
const LADDER_LINES_MOST = 2500;
/** The eight ways a flood steps in plan: the four straight ones first. */
const WAYS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const DIAGONAL = Math.SQRT2;
/** Point entities nobody walks to: lights, sounds, the game's own wiring. */
const NOT_GONE_TO =
  /^(light|info_texlights$|info_null$|info_target$|info_landmark$|infodecal$|info_node|info_intermission$|env_|ambient_|multi_|multisource$|path_|trigger_|mstrig_|ms_npcscript$|ms_player_spec$|game_|target_|scripted_|aiscripted_|momentary_|disabled_|cycler_sprite$)/;
/** Brush entities a player goes to: what is walked into, opened, pressed or climbed. */
const GONE_TO = /^(trigger_|msarea_|func_door|momentary_door$|func_button$|func_rot_button$|func_ladder$)/;
/**
 * The triggers that are fired by name and never touched, whether a map makes them of a brush or not: nobody
 * has to get to one. The Half-Life SDK's dlls/triggers.cpp: a `trigger_counter`'s Spawn sets a Use and no
 * Touch, and never asks for its model (so one with no brush counts as well as one with); `trigger_relay`,
 * `trigger_auto`, `trigger_changetarget` and `trigger_camera` are point entities there; a
 * `trigger_transition` is a volume the engine asks about, solid to nothing.
 */
const FIRED_NOT_TOUCHED =
  /^(trigger_counter|trigger_relay|trigger_auto|trigger_changetarget|trigger_camera|trigger_transition)$/;
/** A brush entity that is touched by walking into it, not by reaching for it. */
const WALKED_INTO = /^(trigger_|msarea_)/;
/** The trigger that takes a player elsewhere in the map, to the entity its `target` names. */
const TELEPORT = "trigger_teleport";

// ── small tools ─────────────────────────────────────────────────────────────
/** The first few of a list, and how many more there are. */
const some = (list, most = LISTED) =>
  `${list.slice(0, most).join("; ")}${list.length > most ? `; and ${list.length - most} more` : ""}`;
/** A point as a sentence has it: whole numbers. */
const place = (point) => point.map((value) => Math.round(value)).join(" ");
/** An entity as a sentence names it. */
const named = (thing) =>
  `${thing.number} ${thing.classname}${thing.targetname ? ` "${thing.targetname}"` : ""}`;

/** The entities of a map, source or compiled, in one form. The world is 0; source counts on from 1. */
function thingsOf(map) {
  if (isCompiled(map))
    return map.entities.map((entity, number) => ({
      number,
      classname: valueOf(entity, "classname") ?? "",
      targetname: valueOf(entity, "targetname"),
      origin: originOf(entity),
      brush: number === 0 || brushModelOf(entity) !== null,
      keys: asObject(entity),
    }));
  return (map.entities ?? []).map((entity, index) => ({
    number: index + 1,
    classname: String(entity.classname ?? ""),
    targetname: entity.targetname,
    origin: pointOf(entity.origin),
    brush: Boolean(entity.brushes?.length),
    keys: entity,
  }));
}

/** A heap of numbers, each with its key: the least key comes out first. */
function heapOf() {
  const keys = [];
  const items = [];
  return {
    get size() {
      return keys.length;
    },
    push(key, item) {
      let at = keys.length;
      keys.push(key);
      items.push(item);
      while (at > 0) {
        const up = (at - 1) >> 1;
        if (keys[up] <= key) break;
        keys[at] = keys[up];
        items[at] = items[up];
        at = up;
      }
      keys[at] = key;
      items[at] = item;
    },
    pop() {
      const top = [keys[0], items[0]];
      const key = keys.pop();
      const item = items.pop();
      const count = keys.length;
      if (count) {
        let at = 0;
        for (;;) {
          let down = at * 2 + 1;
          if (down >= count) break;
          if (down + 1 < count && keys[down + 1] < keys[down]) down++;
          if (keys[down] >= key) break;
          keys[at] = keys[down];
          items[at] = items[down];
          at = down;
        }
        keys[at] = key;
        items[at] = item;
      }
      return top;
    },
  };
}

// ── the grid, and the spots of one body on it ───────────────────────────────
/** The grid a map is walked on: its places are at whole multiples of the cell, as the editors' grid is. */
function gridOf(space, cell) {
  let side = cell;
  let counts;
  let first;
  for (;;) {
    first = [Math.floor(space.min[0] / side) - 2, Math.floor(space.min[1] / side) - 2];
    counts = [
      Math.ceil(space.max[0] / side) + 2 - first[0] + 1,
      Math.ceil(space.max[1] / side) + 2 - first[1] + 1,
    ];
    if (counts[0] * counts[1] <= MOST_PLACES) break;
    side *= 2;
  }
  return {
    cell: side,
    asked: cell,
    first,
    counts,
    places: counts[0] * counts[1],
    /** The place nearest a point, as its number; -1 when the point is off the grid. */
    at(x, y) {
      const i = Math.round(x / side) - first[0];
      const j = Math.round(y / side) - first[1];
      return i < 0 || j < 0 || i >= counts[0] || j >= counts[1] ? -1 : i + counts[0] * j;
    },
    x: (placeNumber) => ((placeNumber % counts[0]) + first[0]) * side,
    y: (placeNumber) => (Math.floor(placeNumber / counts[0]) + first[1]) * side,
  };
}

/**
 * The spots of one body on the grid, worked out place by place as they are asked for. A spot is a stretch
 * of heights the body's feet may be at: `floor[spot]` (what it stands on) to `ceil[spot]` (as high as its
 * feet rise before its head is in the ceiling); `slant[spot]` is how its floor lies (the z of its normal:
 * 1 is level). `first[place]` is the first spot of a place and `count[place]` how many it has, upwards.
 *
 * `like`: `{ layer, differs }`, for the layer of a space that is another's but for some brush entities:
 * `layer` is that other's, of the same body, and `differs[place]` is 1 where the two may differ. Elsewhere
 * the other's spots are taken as they are, and the space is not asked again.
 */
function layerOf(space, grid, body, like = null) {
  const first = new Int32Array(grid.places).fill(-1);
  const count = new Uint8Array(grid.places);
  const layer = { body, first, count, floor: [], ceil: [], place: [], slant: [] };
  const climbsKept = [];
  /**
   * What a body climbs or swims up through at a place (`space.climbs`), asked once for every flood of the
   * layer: ladders and liquids are what they are whatever brush entities are taken away.
   */
  layer.climbsOf = (placeNumber) =>
    (climbsKept[placeNumber] ??= like
      ? like.layer.climbsOf(placeNumber)
      : space.climbs(grid.x(placeNumber), grid.y(placeNumber), body));
  /** The spots of a place: its first, after working them out if need be; -1 for a place off the grid. */
  layer.spots = (placeNumber) => {
    if (placeNumber < 0) return -1;
    if (first[placeNumber] >= 0) return first[placeNumber];
    if (like && !like.differs[placeNumber]) {
      const from = like.layer.spots(placeNumber);
      first[placeNumber] = layer.floor.length;
      count[placeNumber] = like.layer.count[placeNumber];
      for (let spot = from; spot < from + count[placeNumber]; spot++) {
        layer.floor.push(like.layer.floor[spot]);
        layer.slant.push(like.layer.slant[spot]);
        layer.ceil.push(like.layer.ceil[spot]);
        layer.place.push(placeNumber);
      }
      return first[placeNumber];
    }
    const stretches = space.blocked(grid.x(placeNumber), grid.y(placeNumber), body);
    first[placeNumber] = layer.floor.length;
    let made = 0;
    for (let index = 0; index < stretches.length && made < 255; index++) {
      // over the last of them is the open top of the world: no place to stand
      const above = stretches[index + 1];
      if (!above) break;
      layer.floor.push(stretches[index][1]);
      layer.slant.push(stretches[index][2] ?? 1);
      layer.ceil.push(above[0]);
      layer.place.push(placeNumber);
      made++;
    }
    count[placeNumber] = made;
    return first[placeNumber];
  };
  /** The spot of a place whose stretch holds a height, or the one a body there would fall to; -1: none. */
  layer.spotAt = (placeNumber, height, slack = 0) => {
    const from = layer.spots(placeNumber);
    if (from < 0) return -1;
    let under = -1;
    for (let spot = from; spot < from + count[placeNumber]; spot++) {
      if (layer.floor[spot] <= height + slack && height <= layer.ceil[spot] + slack) return spot;
      if (layer.floor[spot] <= height + slack) under = spot;
    }
    return under >= 0 && height <= layer.ceil[under] + slack ? under : -1;
  };
  return layer;
}

// ── the flood ───────────────────────────────────────────────────────────────
/**
 * A flood over one body's spots. `walk`: `{ step, up (the most a step or a jump rises), fly (true: any
 * height, for the point: open air), links (true: each spot's four level neighbours are kept), slopes
 * (false: a floor too steep to stand on is walked like any other), leap (`{ launch, speed, gravity }`:
 * jumps across gaps are tried, `leaps()`), toll (`(spot, other) => units`: what a step from one spot to
 * the next costs over its length) }`. It gives `{ far, from, links, leapt, climbed, seed(spot,
 * far), run(until), passes(spot, other), slides(spot), leaps(accept) }`: `far[spot]` is how far the walk to
 * a spot is (undefined: not reached), `from[spot]` the spot before it, `leapt[spot]` true for a spot got
 * to by a jump across and `climbed[spot]` for one got to by a ladder's shaft. `run` stops at the first
 * spot `until` takes, and `stopped` is then that spot.
 */
function floodOf(space, grid, layer, walk) {
  const { cell, counts } = grid;
  const { floor, ceil, slant } = layer;
  const slopes = walk.slopes !== false && !walk.fly;
  const toll = walk.toll ?? (() => 0);
  const far = [];
  const from = [];
  const leapt = [];
  const climbed = [];
  const links = walk.links ? [] : null;
  const heap = heapOf();
  const done = [];
  const tried = [];
  const mosts = [];
  /** As high as a body at a spot gets its feet by a ladder or a liquid there. */
  const risen = (spot) => {
    if (!space.hasClimbs) return floor[spot];
    let height = floor[spot];
    for (const stretch of layer.climbsOf(layer.place[spot]))
      if (stretch[0] <= height + walk.step && stretch[1] > height) height = Math.min(stretch[1], ceil[spot]);
    return height;
  };
  /** Whether a spot's floor is too steep to stand on: a body there slides. */
  const slides = (spot) => slopes && slant[spot] < STEEP && slant[spot] >= SHEER;
  /**
   * As high as a body at a spot gets its feet onto a floor beside it: by a step or a jump, or from as high
   * as a ladder or a liquid lifts it. On a slope it slides: it goes no higher than it is.
   */
  const mostOf = (spot) => {
    if (mosts[spot] === undefined) {
      const climbed = risen(spot);
      mosts[spot] =
        slides(spot) && climbed === floor[spot]
          ? floor[spot]
          : Math.max(floor[spot] + walk.up, climbed + walk.step);
    }
    return mosts[spot];
  };
  /** Whether a body at `spot` gets to `other`, a spot of a place straight beside it. */
  const passes = (spot, other) => {
    const here = floor[spot];
    if (walk.fly) return Math.max(floor[other], here) <= Math.min(ceil[other], ceil[spot]);
    if (floor[other] > mostOf(spot) + HAIR) return false;
    // nobody steps up onto a slope too steep to stand on (a batter no taller than a step is a kerb)
    if (floor[other] > here && slides(other)) return false;
    // the feet cross at the higher of the two floors: they have to get that high here, and fit there
    const crossing = Math.max(floor[other], here);
    return crossing <= ceil[spot] && crossing <= ceil[other];
  };
  /** The spot of a place beside that a body at `spot` steps level to, there and back; -1: none. */
  const level = (spot, beside) => {
    const start = layer.spots(beside);
    for (let other = start; other < start + layer.count[beside]; other++) {
      if (Math.abs(floor[other] - floor[spot]) > walk.step) continue;
      if (Math.max(floor[other], floor[spot]) <= Math.min(ceil[other], ceil[spot])) return other;
    }
    return -1;
  };
  const flood = {
    far,
    from,
    links,
    leapt,
    climbed,
    passes,
    slides,
    seed(spot, distance = 0, before = -1, byLeap = false, byLadder = false) {
      if (spot < 0 || (far[spot] !== undefined && far[spot] <= distance)) return;
      far[spot] = distance;
      from[spot] = before;
      leapt[spot] = byLeap;
      climbed[spot] = byLadder;
      heap.push(distance, spot);
    },
    run(until) {
      flood.stopped = -1;
      while (heap.size) {
        const [distance, spot] = heap.pop();
        if (done[spot] || distance > far[spot]) continue;
        done[spot] = true;
        if (until?.(spot)) {
          flood.stopped = spot;
          return flood;
        }
        const placeNumber = layer.place[spot];
        const i = placeNumber % counts[0];
        const j = Math.floor(placeNumber / counts[0]);
        const most = walk.fly ? Infinity : mostOf(spot);
        const levels = [-1, -1, -1, -1];
        for (let way = 0; way < WAYS.length; way++) {
          const [di, dj] = WAYS[way];
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= counts[0] || nj >= counts[1]) continue;
          const beside = ni + counts[0] * nj;
          if (way < 4) {
            levels[way] = level(spot, beside);
            if (links) links[spot * 4 + way] = levels[way];
          } else {
            // across a corner only on the level, and only when both straight ways round it are open
            const viaI = levels[di > 0 ? 0 : 1];
            const viaJ = levels[dj > 0 ? 2 : 3];
            if (walk.fly || viaI < 0 || viaJ < 0 || slides(spot)) continue;
            const other = level(spot, beside);
            if (
              other >= 0 &&
              !slides(other) &&
              level(viaI, beside) === other &&
              level(viaJ, beside) === other
            )
              flood.seed(other, distance + cell * DIAGONAL + toll(spot, other), spot);
            continue;
          }
          const start = layer.spots(beside);
          for (let other = start; other < start + layer.count[beside]; other++) {
            if (floor[other] > most + HAIR) break;
            if (passes(spot, other)) flood.seed(other, distance + cell + toll(spot, other), spot);
          }
        }
      }
      return flood;
    },
    /**
     * The jumps across a gap from the spots reached so far that have not been tried: each from a spot at
     * an edge (one of its four ways has no level floor), along `LEAP_WAYS`, as one arc with the whole body
     * clear all the way, to a spot `accept` takes. A landing is seeded and marked `leapt`. Returns how
     * many landings were new; `run()` then carries the walk on from them.
     */
    leaps(accept = (spot) => far[spot] === undefined) {
      if (!walk.leap || !links) return 0;
      let found = 0;
      for (let spot = 0; spot < far.length; spot++) {
        if (far[spot] === undefined || tried[spot] || !done[spot]) continue;
        tried[spot] = true;
        if (slides(spot)) continue;
        const open = [0, 1, 2, 3].filter((way) => !(links[spot * 4 + way] >= 0));
        if (!open.length) continue;
        for (const [di, dj] of LEAP_WAYS) {
          if (!open.some((way) => WAYS[way][0] * di + WAYS[way][1] * dj > 0)) continue;
          for (const landing of landingsOf(grid, layer, spot, di, dj, walk.leap, accept)) {
            if (far[landing.spot] !== undefined) continue;
            flood.seed(landing.spot, far[spot] + landing.run * LEAP_COST, spot, true);
            found++;
          }
        }
      }
      return found;
    },
  };
  return flood;
}

/**
 * Where a jump from a spot comes down, along one way of the grid: `[{ spot, run }]`, each a spot `accept`
 * takes and how far the body's middle goes to it. `leap`: `{ launch (the speed upwards), speed (the most
 * along the ground), gravity }`. The jump is one arc: up at `launch`, along at whatever speed up to
 * `speed` brings it down on the landing as it falls; at every place of the grid it passes over, the feet
 * have to be at a height the body fits at.
 */
function landingsOf(grid, layer, spot, di, dj, leap, accept) {
  const { counts, cell } = grid;
  const { floor, ceil } = layer;
  const { launch, speed, gravity } = leap;
  const apex = (launch * launch) / (2 * gravity);
  const placeNumber = layer.place[spot];
  const i = placeNumber % counts[0];
  const j = Math.floor(placeNumber / counts[0]);
  const here = floor[spot];
  const stride = Math.hypot(di, dj) * cell;
  /** How long a jump is in the air that comes down `rise` over where it began. */
  const airTime = (rise) => (launch + Math.sqrt(Math.max(0, launch * launch - 2 * gravity * rise))) / gravity;
  const furthest = speed * airTime(-LEAP_DROP_MOST);
  const found = [];
  const over = [];
  for (let step = 1; step * stride <= furthest; step++) {
    const ni = i + di * step;
    const nj = j + dj * step;
    if (ni < 0 || nj < 0 || ni >= counts[0] || nj >= counts[1]) break;
    const beside = ni + counts[0] * nj;
    const start = layer.spots(beside);
    const count = layer.count[beside];
    over.push([start, count]);
    const run = step * stride;
    for (let other = start; other < start + count; other++) {
      const rise = floor[other] - here;
      if (rise > apex + HAIR || rise < -LEAP_DROP_MOST || !accept(other)) continue;
      const time = airTime(rise);
      if (run > speed * time) continue;
      // the arc to it: over each place on the way, the feet are where the body fits
      let clear = true;
      for (let before = 1; before < step && clear; before++) {
        const moment = (time * before) / step;
        const feet = here + launch * moment - (gravity / 2) * moment * moment;
        const [first, some] = over[before - 1];
        clear = false;
        for (let each = first; each < first + some && !clear; each++)
          clear = floor[each] <= feet && feet <= ceil[each];
      }
      // and the jump rises to its top where it begins: a low ceiling cuts it short
      if (clear && ceil[spot] + HAIR >= here + apex) found.push({ spot: other, run });
    }
    // a place the body fits at nowhere is a wall: nothing is jumped through it
    if (!count) break;
  }
  return found;
}

/**
 * The shafts of a ladder, for one body: `[{ foot, top, places }]`. A shaft is a stretch of heights the
 * body's feet may be at while its box touches the ladder: from the floor under it (`foot`) to the ladder's
 * top or the ceiling (`top`), whichever is lower; `places` are the places of the grid within a cell of it,
 * where a body gets on and off.
 *
 * The space is asked along upright lines a unit apart, all about the ladder, and not at the places of the
 * grid alone: a ladder is often a brush 2 thick with a solid brush of rungs before it, in a shaft the body
 * fits in over a width of a few units only (Master Sword's edanasewers has one of 3), and no place of a grid
 * of 8 is in such a shaft. Lines that find the same stretch are one shaft.
 */
function shaftsOf(space, grid, layer, ladder) {
  const { half, height } = layer.body;
  const { cell } = grid;
  // a box touches the ladder's when its middle is within its half and a unit of it, as `climbs` has it
  const low = [0, 1].map((axis) => Math.floor(ladder.min[axis] - half - 1) + 1);
  const high = [0, 1].map((axis) => Math.ceil(ladder.max[axis] + half + 1) - 1);
  let apart = 1;
  while (((high[0] - low[0]) / apart + 1) * ((high[1] - low[1]) / apart + 1) > LADDER_LINES_MOST) apart *= 2;
  const shafts = new Map();
  for (let y = low[1]; y <= high[1]; y += apart)
    for (let x = low[0]; x <= high[0]; x += apart) {
      const stretches = space.blocked(x, y, layer.body);
      for (let index = 0; index < stretches.length; index++) {
        const foot = stretches[index][1];
        const ceiling = stretches[index + 1]?.[0] ?? Infinity;
        // the body touches the ladder somewhere in this stretch, with its feet no higher than its top
        if (foot >= ladder.max[2] || ceiling <= ladder.min[2] - height) continue;
        const top = Math.min(ceiling, ladder.max[2]);
        const key = `${Math.round(foot)} ${Math.round(top)}`;
        if (!shafts.has(key)) shafts.set(key, { foot, top, places: new Set() });
        const shaft = shafts.get(key);
        for (const px of new Set([Math.floor(x / cell) * cell, Math.ceil(x / cell) * cell]))
          for (const py of new Set([Math.floor(y / cell) * cell, Math.ceil(y / cell) * cell])) {
            const placeNumber = grid.at(px, py);
            if (placeNumber >= 0) shaft.places.add(placeNumber);
          }
      }
    }
  return [...shafts.values()];
}

/** The way to a spot, from where the flood began: `[[x, y, z]]`, the points in a line left out. */
function routeTo(grid, layer, flood, spot) {
  const points = [];
  for (let at = spot; at >= 0 && at !== undefined; at = flood.from[at])
    points.push([grid.x(layer.place[at]), grid.y(layer.place[at]), layer.floor[at]]);
  points.reverse();
  return points.filter((point, index) => {
    const before = points[index - 1];
    const after = points[index + 1];
    if (!before || !after) return true;
    const turn =
      (point[0] - before[0]) * (after[1] - point[1]) - (point[1] - before[1]) * (after[0] - point[0]);
    return turn !== 0 || point[2] - before[2] !== after[2] - point[2];
  });
}

// ── what is got to ──────────────────────────────────────────────────────────
/**
 * The reached spot from which an entity is got to, or -1. A point entity: a spot whose body, standing,
 * comes within `touch` of its origin with nothing solid between. A brush entity: a spot whose body is in its
 * box (a trigger) or within `touch` of it (a door, a button).
 */
function spotFor(space, grid, layer, flood, thing, touch, area, fly = false) {
  const { half, height } = layer.body;
  const grown = area && WALKED_INTO.test(thing.classname) ? 0 : touch;
  const min = area ? area.min : thing.origin;
  const max = area ? area.max : thing.origin;
  const reach = half + grown;
  let best = -1;
  for (let y = Math.ceil((min[1] - reach) / grid.cell) * grid.cell; y <= max[1] + reach; y += grid.cell)
    for (let x = Math.ceil((min[0] - reach) / grid.cell) * grid.cell; x <= max[0] + reach; x += grid.cell) {
      const placeNumber = grid.at(x, y);
      if (placeNumber < 0 || layer.first[placeNumber] < 0) continue;
      const start = layer.first[placeNumber];
      for (let spot = start; spot < start + layer.count[placeNumber]; spot++) {
        if (flood.far[spot] === undefined) continue;
        const feet = layer.floor[spot];
        // on foot the body is on its floor; in the air it is anywhere in the spot
        const head = fly ? layer.ceil[spot] + height : feet + height;
        if (feet - grown > max[2] || head + grown < min[2]) continue;
        if (!area) {
          const middle = [
            x,
            y,
            Math.min(fly ? head : feet + height / 2, Math.max(feet + 1, thing.origin[2])),
          ];
          if (!space.sees(middle, thing.origin)) continue;
        }
        if (best < 0 || flood.far[spot] < flood.far[best]) best = spot;
      }
    }
  return best;
}

/**
 * The openings of the floor that was walked: the narrow places between two roomier ones, with a wall on
 * both sides (a ledge and a flight of stairs in the open are narrow too, and are not listed). Each spot gets how
 * far it is from the edge of the walked floor; the spots are then taken from the roomiest down and joined
 * to their neighbours, and where two roomy places first join through a narrower one, there is an opening.
 */
function openingsOf(grid, layer, flood, widest) {
  const { cell } = grid;
  const { links, far } = flood;
  const spots = [];
  for (let spot = 0; spot < far.length; spot++) if (far[spot] !== undefined) spots.push(spot);
  /** The eight spots about a spot: the four beside it, and the four across its corners (-1: none). */
  const about = (spot) => {
    const beside = [0, 1, 2, 3].map((way) => links[spot * 4 + way] ?? -1);
    const corner = (first, second) => {
      const viaFirst = beside[first] >= 0 ? (links[beside[first] * 4 + second] ?? -1) : -1;
      const viaSecond = beside[second] >= 0 ? (links[beside[second] * 4 + first] ?? -1) : -1;
      return viaFirst === viaSecond ? viaFirst : -1;
    };
    return [...beside, corner(0, 2), corner(0, 3), corner(1, 2), corner(1, 3)];
  };
  // how far from the edge, counted in squares (a room is a box as a rule): a spot with one of its eight
  // neighbours missing is 1, the ones about it 2 ...
  const room = new Int32Array(far.length);
  let ring = spots.filter((spot) => about(spot).some((other) => other < 0));
  for (const spot of ring) room[spot] = 1;
  const byRoom = [[], ring];
  while (ring.length) {
    const next = [];
    for (const spot of ring)
      for (const other of about(spot))
        if (other >= 0 && !room[other] && far[other] !== undefined) {
          room[other] = room[spot] + 1;
          next.push(other);
        }
    if (next.length) byRoom.push(next);
    ring = next;
  }
  /**
   * The spots in a row a body walks through `spot` along one axis. `row.walled`: whether the row ends at a
   * wall both ways, and not at an edge a body steps off (a ledge, the side of a flight of stairs).
   */
  const run = (spot, axis, most) => {
    const row = [spot];
    row.walled = true;
    for (const way of axis === 0 ? [0, 1] : [2, 3]) {
      let end = spot;
      for (let at = links[spot * 4 + way]; at >= 0 && row.length <= most; at = links[at * 4 + way]) {
        row.push(at);
        end = at;
      }
      const beside = layer.place[end] + WAYS[way][0] + grid.counts[0] * WAYS[way][1];
      const start = layer.first[beside] ?? -1;
      for (let other = start; start >= 0 && other < start + layer.count[beside]; other++)
        if (layer.floor[other] < layer.floor[end] && layer.floor[end] <= layer.ceil[other])
          row.walled = false;
    }
    return row;
  };
  const group = new Int32Array(far.length).fill(-1);
  const peak = [];
  const find = (spot) => {
    let root = spot;
    while (group[root] !== root) root = group[root];
    while (group[spot] !== root) [group[spot], spot] = [root, group[spot]];
    return root;
  };
  const found = [];
  const most = Math.ceil(widest / cell) + 2;
  for (let level = byRoom.length - 1; level >= 1; level--)
    for (const spot of byRoom[level]) {
      group[spot] = spot;
      peak[spot] = level;
      for (let way = 0; way < 4; way++) {
        const other = links[spot * 4 + way];
        if (!(other >= 0) || group[other] < 0) continue;
        const mine = find(spot);
        const theirs = find(other);
        if (mine === theirs) continue;
        const roomy = Math.min(peak[mine], peak[theirs]);
        if (roomy >= level * ROOMIER && roomy >= level + ROOMIER_CELLS && found.length < MOST_OPENINGS * 8)
          found.push(spot);
        group[theirs] = mine;
        peak[mine] = Math.max(peak[mine], peak[theirs]);
      }
    }
  /**
   * The narrowest place near where two rooms were found to join: the join is somewhere along the ridge of
   * spots that are as far from the edge as it is, and the opening is where that ridge is narrowest.
   */
  const narrowest = (joinedAt) => {
    const level = room[joinedAt];
    const seen = new Set([joinedAt]);
    let ridge = [joinedAt];
    const rowsOf = (spot) => [run(spot, 0, most), run(spot, 1, most)];
    const widthOf = (rows) => Math.min(...rows.map((row) => (row.walled ? row.length : Infinity)));
    let least = [{ spot: joinedAt, rows: rowsOf(joinedAt) }];
    for (let steps = 0; steps < (2 * OPENING_SIDES) / cell && ridge.length; steps++) {
      const next = [];
      for (const spot of ridge)
        for (const other of about(spot)) {
          if (other < 0 || seen.has(other) || room[other] !== level) continue;
          seen.add(other);
          next.push(other);
          const rows = rowsOf(other);
          if (widthOf(rows) < widthOf(least[0].rows)) least = [{ spot: other, rows }];
          else if (widthOf(rows) === widthOf(least[0].rows)) least.push({ spot: other, rows });
        }
      ridge = next;
    }
    // of the stretch that is as narrow, its middle: a doorway is named by the middle of its wall
    const along = (each) => grid.x(layer.place[each.spot]) + grid.y(layer.place[each.spot]);
    least.sort((a, b) => along(a) - along(b));
    return least[Math.floor((least.length - 1) / 2)];
  };
  const openings = [];
  for (const joinedAt of found) {
    const { spot, rows } = narrowest(joinedAt);
    const across =
      (rows[0].walled ? rows[0].length : Infinity) <= (rows[1].walled ? rows[1].length : Infinity) ? 0 : 1;
    const row = rows[across];
    // between an edge and a wall is a ledge, not an opening
    if (!row.walled) continue;
    const width = (row.length - 1) * cell + 2 * layer.body.half;
    if (width > widest) continue;
    const xs = row.map((each) => grid.x(layer.place[each]));
    const ys = row.map((each) => grid.y(layer.place[each]));
    const at = [
      (Math.min(...xs) + Math.max(...xs)) / 2,
      (Math.min(...ys) + Math.max(...ys)) / 2,
      Math.round(Math.min(...row.map((each) => layer.floor[each]))),
    ];
    const headroom = Math.min(...row.map((each) => layer.ceil[each] - layer.floor[each]));
    const height = Number.isFinite(headroom) ? Math.round(headroom + layer.body.height) : null;
    if (
      openings.some(
        (other) =>
          Math.hypot(other.at[0] - at[0], other.at[1] - at[1]) < Math.max(SAME_OPENING, width) &&
          Math.abs(other.at[2] - at[2]) < SAME_OPENING,
      )
    )
      continue;
    // its two sides: as far along the way through it as the floor goes, each way
    const sides = (across === 0 ? [2, 3] : [0, 1])
      .map((way) => {
        let side = spot;
        for (let steps = 0; steps < OPENING_SIDES / cell && links[side * 4 + way] >= 0; steps++)
          side = links[side * 4 + way];
        return side;
      })
      .sort((a, b) => far[a] - far[b])
      .map((side) => [grid.x(layer.place[side]), grid.y(layer.place[side]), Math.round(layer.floor[side])]);
    openings.push({
      at,
      width,
      height,
      across: across === 0 ? "x" : "y",
      sides,
      far: Math.round(far[spot]),
      fits: {
        standing: true,
        large: width >= 2 * BODIES.large.half && (height === null || height >= BODIES.large.height),
      },
    });
    if (openings.length >= MOST_OPENINGS) break;
  }
  return openings.sort((a, b) => a.far - b.far).map((opening, index) => ({ number: index + 1, ...opening }));
}

// ── why a thing is not got to ───────────────────────────────────────────────
/** The ways tried, in turn, for what a walk does not reach: each a body and what it may do. */
const OTHER_WAYS = [
  {
    name: "jump",
    body: "standing",
    up: JUMP_HEIGHT,
    leap: true,
    words: `only by a jump (up to ${JUMP_HEIGHT} units; a step is ${STEP_HEIGHT})`,
  },
  {
    name: "crouch-jump",
    body: "standing",
    up: CROUCH_JUMP_HEIGHT,
    words: `only by a jump with the legs drawn up (up to ${CROUCH_JUMP_HEIGHT} units)`,
  },
  { name: "crouch", body: "crouching", up: CROUCH_JUMP_HEIGHT, words: "only crouching (and jumping)" },
  { name: "air", body: "point", up: 0, fly: true, words: "by no way on foot, though open air leads to it" },
];
/**
 * The ways through: the walk with brush entities that stop a body taken away, and everything a player does
 * (a jump with the legs drawn up, a jump across). First with those gone that the game itself takes away
 * (the doors taken as closed, and what breaks or is switched off); then with every one gone. What such a
 * walk reaches and the walk does not is behind a brush entity, and the ones its way passes through are
 * named.
 */
const THROUGH = [
  { name: "wall", key: "gives", body: "standing", up: CROUCH_JUMP_HEIGHT, leap: true, gone: "gives" },
  { name: "wall", key: "all", body: "standing", up: CROUCH_JUMP_HEIGHT, leap: true, gone: "all" },
];

// ── the walk test ───────────────────────────────────────────────────────────
/**
 * The walk test of a map: brush source (`{ worldspawn, brushes, entities }`) or a compiled map (`readBsp`).
 *
 *   from      where the walk begins: a list of entity numbers, classnames, targetnames or points `[x, y, z]`
 *             (where the FEET are; a point goes in the list: `from: [[96, 96, 0]]`). Without it: every place
 *             to start the map has (`START_CLASSES`, or the profile's)
 *   mod       the mod's profile (mod.mjs): its start classes, the box each of its classes moves with (from
 *             its FGD's `size(...)`, its `bodies`, its `origin`), the classes that open, and its `exits`,
 *             `markers`, `wiring` and `off`. A box given here by name stands over the profile's
 *             (`bodies`); a list given here is ADDED to the profile's (`open`, `exits`, `markers`,
 *             `wiring`, `off`) and never takes from it: to walk without one of the profile's, hand over
 *             the profile without it (`mod: { ...profile, wiring: [] }`)
 *   step      the tallest step walked up (18)
 *   jump      false (unless told): no jump. true or 45: jumps are part of the walk, up a ledge of 45 and
 *             across a gap as far as a run carries one (215 for the body's middle, landing level); 63: up
 *             with the legs drawn up too. What only a jump reaches is told apart (`how: "jump"`, `leaps`,
 *             `jumped`). What a walk does not reach is tried with jumps all the same
 *   speed     the most a player runs at, units a second (320); `gravity` (800): a jump's reach follows
 *   slopes    false: a floor too steep to stand on is walked like any other. Unless told, a floor whose
 *             normal has a z under 0.7 is slid down and never walked up, as the engine has it
 *   exits     the ways out of the map, by number, classname or targetname, besides `EXIT_CLASSES`: floor a
 *             player reaches one from is no one-way place
 *   markers   more entities a player goes to, by number, classname or targetname, which their class alone
 *             would leave out: an `info_target` that marks where a script puts a chest
 *   wiring    entities nobody has to get to, named the same way (a classname may have `*` for any letters):
 *             what is fired by name and does its work wherever it stands (a line of text, a counter, a
 *             spawn area's own origin). They are left out whatever else they are. The lights, the sounds,
 *             the `env_` and the triggers that are only fired are left out without being named
 *   off       classnames that are an entity switched off (a mod's `disabled_*`: a class the game does not
 *             have, so the engine makes nothing of it). Such a brush entity is no wall (`spaceOf`). One
 *             whose class would be a way out (`disabled_msarea_transition`, with `exits` naming
 *             `msarea_transition`) is still looked for, as the way on that is not opened yet: it is among
 *             `entities` with `off: true`, a fact says whether it is reached, and it is neither a way
 *             out nor, unreached, a warning
 *   doors     "open" (unless told) or "closed"; `open` and `shut`: brush entities taken as not there, and
 *             doors taken as closed, by number, classname or targetname (`spaceOf`)
 *   walls     "standing" (unless told) or "gone": what breaks, is switched off by name or is pushed aside
 *             (`GIVES_WAY` of space.mjs: `func_breakable`, `func_wall_toggle`, `func_pushable`) is a
 *             wall where it stands, or is taken as not there (`spaceOf`). The walk with them gone is where
 *             a player gets in the end; with them standing, where one gets before anything is broken
 *   parts     false: the floor that is not walked to is not looked at (`share` is null, `parts` empty)
 *   bodies    `{ name: "large" | "standing" | "crouching" | { half, height, feet } }`: the box a thing moves
 *             with, by classname or targetname, where its class does not say (`bodyFor`)
 *   to        entities to tell the walk to, by number or classname, or points `[x, y, z]` (a goal of no
 *             entity: the walked spot nearest it whose body comes within `touch` of it): each gets a sentence and a
 *             `route` (a point's with `at`, and number null)
 *   cell      the grid, in units (8). A map too large for it is walked on a coarser one, and that is said
 *   touch     how near a player has to come to an entity to have got to it (32)
 *   hang      a body's feet may be this far over its floor before it is said to hang (64)
 *   widest    an opening wider than this is not listed (256)
 *   graph     true: the result also has `graph` (not enumerable: JSON leaves it out), the walk itself for
 *             what is built on it: `{ space, grid, layer, onFoot, flood, step, up, hops, starts, ladders
 *             ([[from, to, ladder]] spots), layerOf(body), floodOf(layer, walk) }` (waypoints.mjs)
 *
 * It returns
 *   { warnings, facts            sentences: what is wrong, and what was found
 *     starts                     [{ number, classname, origin, floor }]: where the walk began
 *     entities                   [{ number, classname, targetname, origin, reached, how, far, why, off,
 *                                behind }] for every entity a player goes to. `behind`: the numbers of the
 *                                brush entities in the way to one that is not reached (`why` names them). `how`: "walk", or what else it takes:
 *                                "jump", "crouch-jump", "crouch", "air" (open air leads to it, no way on
 *                                foot), "none" (walled off); `far`: the walk to it in units. With `jump`,
 *                                one that only a jump reaches is `reached` and its `how` is "jump"
 *     unreached, stuck, hanging  the entities of the three kinds of fault
 *     oneWay                     [{ at, area, floors: [lowest, highest], entry: { from, to, drop },
 *                                entities }]: the places a player gets into and cannot leave
 *     leaps                      [{ from, to, run, rise }]: with `jump`, the jumps across a gap (or up
 *                                onto a ledge not straight beside, or out and down) that led to floor not
 *                                walked to, the longest first
 *     steep                      the floor walked that is too steep to stand on, in square units
 *     openings                   [{ number, at, width, height, across, sides, far, fits }]: the narrow
 *                                places of the walked floor. `at` is the middle of its floor, `across` the
 *                                axis it is measured along ("x": the way through it runs along y), `sides`
 *                                a point of the floor before it (on the side nearer the places to start) and one behind it, `height` null under an
 *                                open sky, `fits.large` whether a large monster's box passes
 *     routes                     [{ number, classname, far, points }] for the entities of `to`
 *     doors                      the doors, each with whether it was taken as open
 *     cell, area                 the grid walked on, and the floor walked in square units
 *     share, standable           the part of the floor a standing player fits on that the walk reaches, 0
 *                                to 1, and all that floor in square units. Counted on the grid: a place of
 *                                it and a stretch of heights the body fits in there, over a floor that is
 *                                not too steep to stand on, is one `cell` x `cell` of floor. The tops of
 *                                walls and of crates are floor too: a map walked whole comes to less than 1
 *     parts                      [{ at, area, floors: [lowest, highest], how, why, nearest: { at, away },
 *                                behind }]: the floor that is not walked to, in parts of 4096 square units
 *                                and more, the largest first. `how` is what it takes: "jump",
 *                                "crouch-jump", "crouch", "wall" (brush entities are in the way: `behind`
 *                                has their numbers), "air" or "none"; `why` says it in words, with where
 *                                the way leaves the walked floor; `nearest` is the walked floor nearest
 *                                the part (null: none within 384) and how far from it
 *     patches                    { count, area }: the parts smaller than that, counted
 *     walked(x, y, under)        the floor a player walks at a place: the highest at or under the height
 *                                `under` (any, without it); null where none is walked. It is a HEIGHT, and a
 *                                floor at 0 is 0: ask `=== null`, or ask `on`
 *     on(x, y, under)            the same place as yes and no: { floor (the height a player stands at
 *                                there, or null), stands, walked, jumped, trapped }, each true or false
 *     stands(x, y, under)        the same for where a player would fit at all, walked or not
 *     jumped(x, y, under)        the same for floor that only a jump reaches (with `jump`)
 *     trapped(x, y, under) }     the same for the floor of the one-way places
 *
 * The warnings: no place to start; entities that are not reached, each with what it would take; one-way
 * places; bodies that stand in something solid or hang over their floor; openings a player only just fits,
 * and (when a `bodies` entry is "large") those a large monster does not pass.
 */
export function reachOf(map, options = {}) {
  // a mod's profile gives its start classes, each class's box and the classes that open (mod.mjs)
  options = withMod(options, map);
  const {
    from,
    starts: startClasses = START_CLASSES,
    step = STEP_HEIGHT,
    doors = "open",
    walls = "standing",
    open,
    shut,
    bodies = {},
    to = [],
    cell = CELL,
    touch = TOUCH,
    hang = HANG_MOST,
    widest = WIDEST_OPENING,
    speed = RUN_SPEED,
    gravity = GRAVITY,
    slopes = true,
    exits = [],
    markers = [],
    wiring = [],
    off = [],
  } = options;
  const jump = options.jump === true ? JUMP_HEIGHT : options.jump || 0;
  if (!(cell >= 1)) throw new Error(`cell: the grid in units, 1 at the least, not ${cell}`);
  if (!(step >= 0)) throw new Error(`step: the tallest step in units, not ${step}`);
  if (!(jump >= 0)) throw new Error(`jump: true, false or a height in units, not ${options.jump}`);
  if (!(speed > 0)) throw new Error(`speed: units a second, over 0, not ${speed}`);
  if (!(gravity > 0)) throw new Error(`gravity: units a second each second, over 0, not ${gravity}`);
  /**
   * What a jump of a height is, with this speed and gravity: `up`, the ledge it clears, and `leap`, its
   * arc. A height of 63 and more is a jump with the legs drawn up: its arc is the lower jump's, and it
   * clears 18 more.
   */
  const jumpOf = (height) => {
    const drawnUp = height >= CROUCH_JUMP_HEIGHT ? CROUCH_JUMP_HEIGHT - JUMP_HEIGHT : 0;
    const launch = Math.sqrt(2 * JUMP_GRAVITY * (height - drawnUp));
    return { up: (launch * launch) / (2 * gravity) + drawnUp, leap: { launch, speed, gravity } };
  };
  const space = spaceOf(map, { doors, walls, open, shut, off });
  const grid = gridOf(space, cell);
  const things = thingsOf(map);
  const warnings = [];
  const facts = [];
  const body = BODIES.standing;
  const layers = { standing: layerOf(space, grid, body) };
  const layer = layers.standing;
  const up = jump ? Math.max(step, jumpOf(jump).up) : step;
  // the walk on foot; and, when jumps are part of the walk, the walk with them: `flood` is the one told of
  const onFoot = floodOf(space, grid, layer, { step, up: step, links: true, slopes });
  const flood = jump
    ? floodOf(space, grid, layer, { step, up, links: true, slopes, leap: jumpOf(jump).leap })
    : onFoot;
  const seedBoth = (spot) => {
    onFoot.seed(spot);
    if (flood !== onFoot) flood.seed(spot);
  };

  // ── where the walk begins ──
  const asked = from === undefined ? null : Array.isArray(from) ? from : [from];
  const starts = [];
  /** The spot a body with its feet at a point stands on, or falls to; the places about it are tried too. */
  const spotUnder = (ofLayer, feet) => {
    for (const [di, dj] of [[0, 0], ...WAYS]) {
      const spot = ofLayer.spotAt(grid.at(feet[0] + di * grid.cell, feet[1] + dj * grid.cell), feet[2], step);
      if (spot >= 0) return spot;
    }
    return -1;
  };
  for (const thing of things) {
    if (thing.brush || !thing.origin) continue;
    const chosen = asked
      ? asked.some((each) => each === thing.number || each === thing.classname || each === thing.targetname)
      : startClasses.includes(thing.classname);
    if (!chosen) continue;
    const stands = bodyFor(thing.classname, thing.targetname, bodies) ?? { feet: 0 };
    const feet = [thing.origin[0], thing.origin[1], thing.origin[2] - stands.feet];
    const spot = spotUnder(layer, feet);
    starts.push({
      number: thing.number,
      classname: thing.classname,
      origin: thing.origin,
      floor: spot < 0 ? null : layer.floor[spot],
      spot,
    });
    seedBoth(spot);
  }
  for (const point of (asked ?? []).filter((each) => Array.isArray(each))) {
    if (point.length !== 3 || !point.every(Number.isFinite))
      throw new Error(`from: a point is [x, y, z], where the feet are, not ${JSON.stringify(point)}`);
    const spot = spotUnder(layer, point);
    starts.push({
      number: null,
      classname: "a point",
      origin: point,
      floor: spot < 0 ? null : layer.floor[spot],
      spot,
    });
    seedBoth(spot);
  }
  const begun = starts.filter((start) => start.floor !== null);
  if (!starts.length)
    warnings.push(
      asked
        ? `no entity of ${asked.join(", ")} to start the walk from`
        : `no place to start (${startClasses.join(", ")}): nothing was walked. Give \`from\``,
    );
  else if (!begun.length)
    warnings.push(
      `none of the ${starts.length} places to start has room for a standing player: nothing was walked`,
    );
  const counted = new Map();
  for (const start of begun) counted.set(start.classname, (counted.get(start.classname) ?? 0) + 1);
  if (begun.length)
    facts.push(
      `walked from ${begun.length} places to start: ${[...counted].map(([classname, count]) => `${count} ${classname}`).join(", ")}`,
    );

  // ── the walk, on through every teleport and up every ladder it comes to, and (with jumps) across gaps ──
  const areaOf = new Map(space.areas.map((area) => [area.number, area]));
  const teleports = things.filter((thing) => thing.classname === TELEPORT && areaOf.has(thing.number));
  /** Where a teleport puts a player: the first entity its `target` names. */
  const targetOf = (thing) =>
    things.find((other) => other.targetname && other.targetname === thing.keys.target);
  /**
   * A teleport door (levels/assembly/assemble.mjs teleportDoors; the RP plugin smak_doors carries a player who uses it): a shut wall
   * named X and two info_targets `X_<n>_a` and `X_<n>_b` on its two sides (n counts the doors that share the name). A body that gets to one spot gets to the other.
   */
  const named_ = new Map();
  for (const thing of things) if (thing.targetname) named_.set(thing.targetname, [...(named_.get(thing.targetname) ?? []), thing]);
  const doorPairs = [];
  for (const [name, list] of named_) {
    const m = /^(.*)_\d+(?=_a$)/.exec(name);
    if (!m) continue;
    const base = m[1];
    const a = list.find((thing) => thing.classname === "info_target" && thing.origin);
    const b = (named_.get(`${name.slice(0, -2)}_b`) ?? []).find((thing) => thing.classname === "info_target" && thing.origin);
    if (a && b && (named_.get(base) ?? []).some((thing) => /^func_(wall|door)/.test(thing.classname))) doorPairs.push({ name: base, a, b });
  }
  const shaftsKept = new Map();
  /** The shafts of every ladder of a space, for a layer of it: worked out once. */
  const shaftsFor = (ofSpace, ofLayer) => {
    if (!shaftsKept.has(ofLayer))
      shaftsKept.set(
        ofLayer,
        (ofSpace.ladders ?? []).flatMap((ladder) =>
          shaftsOf(ofSpace, grid, ofLayer, ladder).map((shaft) => ({ ...shaft, ladder })),
        ),
      );
    return shaftsKept.get(ofLayer);
  };
  /**
   * The ways the ladders' shafts give: `[[from, to, ladder]]`. A body gets ON a shaft from a spot `reached`
   * takes, at a place about it, whose floor is no more than a step under the shaft's own and no higher than
   * its top, and from which the ladder is taken hold of (`rise`: as high as the feet get there). It gets
   * OFF onto any spot about the shaft whose floor is between a step under its foot and a step over its top.
   */
  const rungsOf = (ofSpace, ofLayer, reached, rise) => {
    const found = [];
    for (const shaft of shaftsFor(ofSpace, ofLayer)) {
      const about = [];
      for (const placeNumber of shaft.places) {
        const start = ofLayer.spots(placeNumber);
        for (let spot = start; spot < start + ofLayer.count[placeNumber]; spot++) about.push(spot);
      }
      const on = about.filter(
        (spot) =>
          reached(spot) &&
          shaft.foot <= ofLayer.floor[spot] + step + HAIR &&
          ofLayer.floor[spot] <= shaft.top &&
          ofLayer.floor[spot] + rise + ofLayer.body.height > shaft.ladder.min[2],
      );
      if (!on.length) continue;
      const onto = about.filter(
        (spot) =>
          ofLayer.floor[spot] <= shaft.top + step + HAIR && ofLayer.floor[spot] >= shaft.foot - step - HAIR,
      );
      for (const from of on) for (const to of onto) if (to !== from) found.push([from, to, shaft.ladder]);
    }
    return found;
  };
  /**
   * Runs a flood to its end: through the teleports it comes to, up the ladders' shafts, across the gaps it
   * jumps. `ofLayer` and `ofSpace` are the flood's own; `fly`: the flood is of open air (no ladder is
   * wanted); `rise`: as high as its body gets its feet from a floor. It returns `{ hops, taken, ladders,
   * dead }`: the teleports it took (`[{ number, area, landing }]`), their numbers, the numbers of the
   * ladders whose shafts led to floor not got to before, and the teleports that lead nowhere.
   */
  const carry = (which, ofLayer = layer, ofSpace = space, { fly = false, rise = step } = {}) => {
    const hops = [];
    const taken = new Set();
    const tried = new Set();
    const ladders = new Set();
    const dead = [];
    which.run();
    for (let again = true; again; ) {
      again = false;
      for (const thing of teleports) {
        if (tried.has(thing.number)) continue;
        const area = areaOf.get(thing.number);
        const spot = spotFor(ofSpace, grid, ofLayer, which, thing, touch, area, fly);
        if (spot < 0) continue;
        tried.add(thing.number);
        const target = targetOf(thing);
        if (!target?.origin) {
          dead.push(`${named(thing)}: no entity with an origin is named ${JSON.stringify(thing.keys.target ?? "")}, its target`); // prettier-ignore
          continue;
        }
        taken.add(thing.number);
        const stands = bodyFor(target.classname, target.targetname, bodies) ?? { feet: 0 };
        const landing = spotUnder(ofLayer, [
          target.origin[0],
          target.origin[1],
          target.origin[2] - stands.feet,
        ]);
        if (landing < 0) {
          dead.push(`${named(thing)}: at ${named(target)}, ${place(target.origin)}, ${ofLayer.body.words} has no room`); // prettier-ignore
          continue;
        }
        hops.push({ number: thing.number, area, landing });
        if (which.far[landing] !== undefined) continue;
        which.seed(landing, which.far[spot], spot);
        again = true;
      }
      // the teleport doors: from the spot a body has got to, to the one on the other side
      for (const door of doorPairs) {
        for (const [one, other] of [[door.a, door.b], [door.b, door.a]]) {
          const feet = (bodyFor(one.classname, one.targetname, bodies) ?? { feet: 0 }).feet;
          const here = spotUnder(ofLayer, [one.origin[0], one.origin[1], one.origin[2] - feet]);
          if (here < 0 || which.far[here] === undefined) continue;
          const there = spotUnder(ofLayer, [other.origin[0], other.origin[1], other.origin[2] - feet]);
          if (there < 0) continue;
          // (a door is walked back through too: each way is a hop, its source a spot, not an area)
          if (!hops.some((hop) => hop.spot === here && hop.landing === there)) hops.push({ number: door.name, spot: here, landing: there });
          if (which.far[there] !== undefined) continue;
          which.seed(there, which.far[here], here);
          again = true;
        }
      }
      if (!fly && ofSpace.ladders?.length) {
        // of the ways onto one spot, the shortest
        const best = new Map();
        for (const [from, to, ladder] of rungsOf(
          ofSpace,
          ofLayer,
          (spot) => which.far[spot] !== undefined,
          rise,
        )) {
          if (which.far[to] !== undefined) continue;
          const far = which.far[from] + Math.abs(ofLayer.floor[to] - ofLayer.floor[from]) + grid.cell;
          if (!best.has(to) || far < best.get(to).far) best.set(to, { from, far, ladder });
        }
        for (const [to, { from, far, ladder }] of best) {
          which.seed(to, far, from, false, true);
          ladders.add(ladder.number);
          again = true;
        }
      }
      if (which.leaps()) again = true;
      if (again) which.run();
    }
    return { hops, taken, ladders, dead };
  };
  const carried = carry(flood, layer, space, { rise: up });
  const { hops, taken } = carried;
  if (flood !== onFoot) carry(onFoot, layer, space, { rise: step });
  if (taken.size) facts.push(`${taken.size} teleports were walked into and followed to where they lead`);
  if (carried.ladders.size)
    facts.push(
      `${carried.ladders.size} ladders were climbed to floor that is walked to no other way: ${some(
        things.filter((thing) => carried.ladders.has(thing.number)).map(named),
        6,
      )}`,
    );
  if (carried.dead.length)
    warnings.push(`${carried.dead.length} teleports a player walks into lead nowhere: ${some(carried.dead)}`);
  // each lift's two ends: a player stands on it at both, or it rides into a ceiling or the rock. A lift built
  // level with a floor with a height under 0 rides up into the ceiling, never down to the pit it was for
  for (const lift of (space.ladders ?? []).filter((way) => way.lift)) {
    const middle = [(lift.min[0] + lift.max[0]) / 2, (lift.min[1] + lift.max[1]) / 2];
    const [built, other] = lift.ends.map(Math.round);
    const thing = things.find((each) => each.number === lift.number);
    const said = `${thing ? named(thing) : `lift ${lift.number}`} rides from z ${built}, where it is built, ${other < built ? "down" : "up"} to z ${other}`;
    // an end is of use where floor lies within a step of it: beside the lift to step off onto, or under it (a
    // lift that fills its pit rests on the pit's floor)
    const out = BODIES.standing.half + 8;
    const around = [middle, [lift.min[0] - out, middle[1]], [lift.max[0] + out, middle[1]], [middle[0], lift.min[1] - out], [middle[0], lift.max[1] + out]];
    const floorNear = (z) => around.some(([x, y]) => space.blocked(x, y, BODIES.standing).some(([, top]) => Math.abs(top - z) <= step));
    const stuck = lift.ends.filter((z) => !restOf(space, [...middle, z + 1], BODIES.standing).fits).map(Math.round);
    const nowhere = lift.ends.filter((z) => !floorNear(z)).map(Math.round);
    // a lift with a name is ridden when something names it (a button, a script), as scenery is moved: its ends
    // are said, not judged. Master Sword's own maps have three such (foutpost's falling tower, phobia's
    // pillar, the_wall2's exit), none of them a lift a player steps on
    if (thing?.targetname) facts.push(`${said} when named (it is not ridden by stepping on it)`);
    else if (stuck.length || nowhere.length)
      warnings.push(`${said}: ${[stuck.length ? `at z ${stuck.join(" and ")} a standing player does not fit on it (a ceiling, a wall or the rock is there)` : null, nowhere.length ? `at z ${nowhere.join(" and ")} no floor lies within a step of it, beside it or under it, to step off onto` : null].filter(Boolean).join("; ")}. A func_plat's height is how far it rides DOWN from where it is built; one under 0 rides up`);
    else facts.push(said);
  }
  // where a teleport puts a player is no place one goes to: it is not counted, unless a marker names it
  const landings = new Set(teleports.map((thing) => targetOf(thing)?.number));

  // ── the entities a player goes to ──
  // a way out is one of them whatever its class: a mod's own (a profile's `exits`) is no trigger_ by name
  const exitNames = [...EXIT_CLASSES, ...(Array.isArray(exits) ? exits : [exits])];
  const isExit = (thing) =>
    [thing.number, thing.classname, thing.targetname].some((name) => exitNames.includes(name));
  /** Whether a thing is one of a list of numbers, classnames (`*` for any letters) and targetnames. */
  const oneOf = (list, thing) =>
    [list].flat().some(
      (each) =>
        each === thing.number ||
        (typeof each === "string" && (each === thing.targetname || classUnder([each], thing.classname) !== null)), // prettier-ignore
    );
  const offNames = [off].flat();
  const entities = [];
  for (const thing of things) {
    if (thing.number === 0 && isCompiled(map)) continue;
    if (oneOf(wiring, thing)) continue;
    const area = thing.brush ? areaOf.get(thing.number) : null;
    // switched off: the class it would be. Of those, only what would be a way out is looked for
    const under = classUnder(offNames, thing.classname);
    const marked = oneOf(markers, thing);
    const goneTo =
      under !== null
        ? thing.brush && exitNames.includes(under)
        : thing.brush
          ? (GONE_TO.test(thing.classname) && !FIRED_NOT_TOUCHED.test(thing.classname)) || isExit(thing)
          : !NOT_GONE_TO.test(thing.classname);
    if ((thing.brush ? !area : !thing.origin) || !(goneTo || marked)) continue;
    if (landings.has(thing.number) && !marked) continue;
    // it is got to as its own class is: a trigger by walking into it
    const sought = under === null ? thing : { ...thing, classname: under };
    const spot = begun.length ? spotFor(space, grid, layer, flood, sought, touch, area) : -1;
    const middle = area ? area.min.map((value, axis) => (value + area.max[axis]) / 2) : thing.origin;
    const byJump =
      spot >= 0 && flood !== onFoot && spotFor(space, grid, layer, onFoot, sought, touch, area) < 0;
    entities.push({
      number: thing.number,
      classname: thing.classname,
      targetname: thing.targetname,
      origin: middle,
      brush: thing.brush,
      reached: spot >= 0,
      how: spot < 0 ? "none" : byJump ? "jump" : "walk",
      far: spot >= 0 ? Math.round(flood.far[spot]) : null,
      why: null,
      off: under !== null,
      behind: [],
      spot,
      thing: sought,
      area,
    });
  }

  // ── what is not reached, tried by other ways ──
  const waysTried = new Map();
  /**
   * The walk by another way, made once: `{ way, layer, flood, space }`, or null for a way the walk itself
   * has already (a jump, when jumps are part of it) and for one there is nothing to try (no brush entity
   * to take away).
   */
  const tryWay = (way) => {
    const name = way.key ?? way.name;
    if (waysTried.has(name)) return waysTried.get(name);
    let tried = null;
    const wanted = way.fly || way.gone || way.body !== "standing" || way.up > up;
    // the brush entities taken away: those that open, break or are switched off, or all that stop a body
    const inTheWay = way.gone
      ? space.areas.filter(
          (each) => each.solid && !each.open && !each.off && (way.gone === "all" || each.door || each.gives),
        )
      : [];
    if (begun.length && wanted && (!way.gone || inTheWay.length)) {
      const waySpace = way.gone ? spaceOf(map, { off, open: inTheWay.map((each) => each.number) }) : space;
      const key = way.gone ? `gone ${way.gone}` : way.body;
      // with brush entities gone the space is as it was but about them: only there is it asked again
      let like = null;
      if (way.gone && !layers[key]) {
        like = { layer, differs: new Uint8Array(grid.places) };
        const wide = body.half + grid.cell;
        for (const area of inTheWay)
          for (
            let y = Math.floor((area.min[1] - wide) / grid.cell) * grid.cell;
            y <= area.max[1] + wide;
            y += grid.cell // prettier-ignore
          )
            for (
              let x = Math.floor((area.min[0] - wide) / grid.cell) * grid.cell;
              x <= area.max[0] + wide;
              x += grid.cell
            ) {
              // prettier-ignore
              const placeNumber = grid.at(x, y);
              if (placeNumber >= 0) like.differs[placeNumber] = 1;
            }
      }
      layers[key] ??= layerOf(waySpace, grid, BODIES[way.body], like);
      const wayLayer = layers[key];
      const rise = Math.max(jumpOf(way.up || JUMP_HEIGHT).up, up);
      // a spot of the way through at which the body does not fit as the map stands: it is in a brush entity
      const stoppedAt = [];
      const stopped = (spot) => {
        stoppedAt[spot] ??= layer.spotAt(wayLayer.place[spot], wayLayer.floor[spot] + 2 * HAIR) < 0;
        return stoppedAt[spot];
      };
      const wayFlood = floodOf(waySpace, grid, wayLayer, {
        step,
        up: rise,
        fly: way.fly,
        slopes,
        links: Boolean(way.leap),
        leap: way.leap ? jumpOf(JUMP_HEIGHT).leap : undefined,
        toll: way.gone ? (spot, other) => (stopped(other) && !stopped(spot) ? TOLL : 0) : undefined,
      });
      for (const start of begun) {
        const feet = [start.origin[0], start.origin[1], start.floor + (way.fly ? body.height / 2 : 0)];
        wayFlood.seed(spotUnder(wayLayer, feet));
      }
      carry(wayFlood, wayLayer, waySpace, { fly: way.fly, rise });
      tried = { way, layer: wayLayer, flood: wayFlood, space: waySpace, gone: inTheWay, stopped };
    }
    waysTried.set(name, tried);
    return tried;
  };
  /**
   * The brush entities the way to a spot of a walk through them passes through, the first met first:
   * `{ areas, jumps }`; `jumps`: the way takes a jump too. Of the entities that were taken away, those
   * whose box a spot of the way is in where the body does not fit as the map stands; and, where the way
   * goes by a ladder, those in the ladder's shaft between the two floors.
   */
  const inTheWayTo = (tried, spot) => {
    const chain = [];
    for (let at = spot; at >= 0 && at !== undefined; at = tried.flood.from[at]) chain.push(at);
    chain.reverse();
    const areas = [];
    let jumps = false;
    chain.forEach((each, index) => {
      const x = grid.x(tried.layer.place[each]);
      const y = grid.y(tried.layer.place[each]);
      const feet = tried.layer.floor[each];
      const before = chain[index - 1];
      if (before !== undefined && !tried.flood.climbed[each]) {
        const stride = Math.hypot(
          x - grid.x(tried.layer.place[before]),
          y - grid.y(tried.layer.place[before]),
        );
        if (
          tried.flood.leapt[each] ||
          (stride <= grid.cell * 2 && feet - tried.layer.floor[before] > up + HAIR)
        )
          jumps = true;
      }
      const byLadder = before !== undefined && tried.flood.climbed[each];
      if (!byLadder && !tried.stopped(each)) return;
      // the box the body is in here; by a ladder, all it passes through from the spot before
      const low = byLadder ? Math.min(feet, tried.layer.floor[before]) : feet;
      const wide = body.half + (byLadder ? grid.cell : 0);
      for (const area of tried.gone) {
        if (areas.includes(area)) continue;
        if (
          x > area.min[0] - wide &&
          x < area.max[0] + wide &&
          y > area.min[1] - wide &&
          y < area.max[1] + wide &&
          low < area.max[2] &&
          feet + body.height > area.min[2]
        )
          areas.push(area);
      }
    });
    return { areas, jumps };
  };
  /**
   * The brush entities in a way, in words: each with where it is, and what would take them away. The way is
   * the shortest with them gone: it may pass through one that a longer way goes round.
   */
  const behindWords = ({ areas, jumps }) => {
    const told = areas.slice(0, BEHIND_LISTED).map((area) => {
      const middle = area.min.map((value, axis) => (value + area.max[axis]) / 2);
      return `${named(area)} at ${place(middle)}${area.door ? " (a door taken as closed)" : ""}`;
    });
    const more = areas.length > BEHIND_LISTED ? `, and ${areas.length - BEHIND_LISTED} more` : "";
    const walls = areas.filter((area) => !area.door);
    const taken = !walls.length
      ? ""
      : walls.every((area) => area.gives)
        ? ' (what breaks or is switched off is a wall unless told: `walls: "gone"`, or `open` by name)'
        : " (a brush entity is a wall where it stands: `open` takes away those it names)";
    return `behind ${told.join(", then ")}${more}${taken}${jumps ? "; and the way takes a jump" : ""}`;
  };
  /**
   * What a walk through brush entities finds in the way to a thing: `find(tried)` gives the spot of that
   * walk the thing is got to at, or -1. The ways through are tried in turn; null when none passes through
   * any brush entity to get there.
   */
  const behindOf = (find) => {
    for (const way of THROUGH) {
      const tried = tryWay(way);
      const spot = tried ? find(tried) : -1;
      const found = spot >= 0 ? inTheWayTo(tried, spot) : null;
      if (found?.areas.length) return found;
    }
    return null;
  };

  let left = begun.length ? entities.filter((entity) => !entity.reached) : [];
  for (const way of OTHER_WAYS) {
    if (!left.length) break;
    const tried = tryWay(way);
    if (!tried) continue;
    for (const entity of left) {
      const spot = spotFor(tried.space, grid, tried.layer, tried.flood, entity.thing, touch, entity.area, way.fly); // prettier-ignore
      if (spot < 0) continue;
      entity.how = way.name;
      const where = way.fly
        ? nearWords(nearestWalked(grid, layer, flood, entity.origin), entity.origin)
        : leavesWalk(grid, layer, flood, tried.layer, tried.flood, spot, way, step);
      entity.why = `${way.words}${where}`;
    }
    left = left.filter((entity) => entity.how === "none");
  }
  for (const entity of left) {
    const inSolid = !entity.brush && !restOf(space, entity.origin, BODIES.point).fits;
    entity.why = inSolid
      ? "it is inside something solid"
      : `no opening leads to it${space.doors.some((door) => !door.open) ? " (with the doors that are taken as closed)" : ""}`;
  }
  // what no floor leads to may be behind a brush entity: the walk with all of them gone says which
  const walledOff = begun.length
    ? entities.filter((entity) => !entity.reached && (entity.how === "none" || entity.how === "air"))
    : [];
  for (const entity of walledOff) {
    const found = behindOf((tried) =>
      spotFor(tried.space, grid, tried.layer, tried.flood, entity.thing, touch, entity.area),
    );
    if (!found) continue;
    entity.behind = found.areas.map((area) => area.number);
    entity.why = `${entity.why}: ${behindWords(found)}`;
  }
  // what is switched off is told apart: it is looked for, and its not being reached is no fault yet
  const switchedOff = entities.filter((entity) => entity.off);
  const unreached = entities.filter((entity) => !entity.reached && !entity.off);
  const onlyByJump = entities.filter((entity) => entity.reached && entity.how === "jump");
  const afoot = jump ? "on foot or by a jump" : "on foot";
  const live = entities.length - switchedOff.length;
  if (unreached.length)
    warnings.push(
      `${unreached.length} of the ${live} entities a player goes to are not reached ${afoot} from the places to start: ${some(unreached.map((entity) => `${named(entity)} at ${place(entity.origin)}: ${entity.why}`))}`,
    );
  else if (live && begun.length) facts.push(`all ${live} entities a player goes to are reached ${afoot}`);
  if (switchedOff.length && begun.length)
    facts.push(
      `${switchedOff.length} ways out are switched off (a class the game does not have: no wall, and no way out until it is given its class): ${some(switchedOff.map((entity) => `${named(entity)} ${entity.reached ? "is reached" : `is NOT reached (${entity.why})`}`))}`,
    );

  // ── what only a jump reaches ──
  const leaps = flood === onFoot ? [] : leapsOf(grid, layer, flood, onFoot);
  if (jump && begun.length) {
    const more = flood.far.reduce(
      (sum, value, spot) => sum + (value !== undefined && onFoot.far[spot] === undefined ? 1 : 0),
      0,
    );
    facts.push(
      `jumps are part of the walk: up a ledge of ${Math.round(up)}, and across a gap as far as ${Math.round((jumpOf(jump).leap.launch * 2 * speed) / gravity)} for the body's middle (a run of ${speed} units a second, landing level)`,
    );
    facts.push(
      more
        ? `about ${more * grid.cell * grid.cell} square units of floor are reached only by jumping`
        : "no floor is reached only by jumping: all of it is walked to on foot",
    );
    if (leaps.length)
      facts.push(
        `${leaps.length} jumps across a gap, up onto a ledge or out and down lead to floor not walked to, the longest first: ${some(leaps.map((leap) => leapWords(leap.from, leap.to)))}`,
      );
    if (onlyByJump.length)
      facts.push(
        `${onlyByJump.length} entities are reached only by jumping: ${some(onlyByJump.map((entity) => `${named(entity)} at ${place(entity.origin)}`))}`,
      );
  }

  // ── one-way places: floor that is walked to and has no way back ──
  const ways = entities.filter((entity) => entity.reached && isExit(entity));
  const trap = begun.length
    ? oneWayOf({
        space,
        grid,
        layers,
        flood,
        hops,
        rungs: rungsOf(space, layer, (spot) => flood.far[spot] !== undefined, Math.max(up, jumpOf(CROUCH_JUMP_HEIGHT).up)), // prettier-ignore
        seeds: [
          ...begun.map((start) => start.spot),
          ...ways.flatMap((entity) =>
            entity.area ? spotsAbout(grid, layer, flood, entity.area, touch) : [entity.spot],
          ),
        ],
        // the most a player does to get out: a jump with the legs drawn up, and one across a gap
        rule: { step, up: Math.max(up, jumpOf(CROUCH_JUMP_HEIGHT).up), slopes },
        leap: jumpOf(JUMP_HEIGHT).leap,
        entities,
      })
    : { places: [], inside: null };
  if (trap.places.length)
    warnings.push(
      `${trap.places.length} places are one-way: a player gets into each from the places to start and finds no way back to one${ways.length ? ", nor to a way out of the map" : ""}, on foot, by a jump or crouching (mean it, or give a way out): ${some(trap.places.map((each) => each.words))}`,
    );
  else if (begun.length)
    facts.push(
      `no one-way place: from all the floor walked there is a way back to a place to start${ways.length ? ` or to a way out (${some(ways.map(named), 4)})` : ""}`,
    );
  const steepSpots = slopes
    ? flood.far.reduce((sum, value, spot) => sum + (value !== undefined && flood.slides(spot) ? 1 : 0), 0)
    : 0;
  if (steepSpots)
    facts.push(
      `about ${steepSpots * grid.cell * grid.cell} square units of the floor walked are too steep to stand on (a normal's z under ${STEEP}: steeper than 45.6 degrees): a player slides down them, and they are not walked up`,
    );

  // ── the floor that is not walked to: how much, in which parts, and why each ──
  let share = null;
  let standable = null;
  const parts = [];
  const patches = { count: 0, area: 0 };
  if (options.parts !== false && begun.length) {
    const { counts } = grid;
    const square = grid.cell * grid.cell;
    // every place of the grid is asked now: the flood asked only those it came to
    for (let placeNumber = 0; placeNumber < grid.places; placeNumber++) layer.spots(placeNumber);
    const all = layer.floor.length;
    const partOf = new Int32Array(all).fill(-1);
    const found = [];
    let stood = 0;
    let got = 0;
    let highest = -Infinity;
    for (let begin = 0; begin < all; begin++) {
      // floor too steep to stand on is no floor to get to
      if (flood.slides(begin)) continue;
      stood++;
      if (flood.far[begin] !== undefined) (got++, (highest = Math.max(highest, layer.floor[begin])));
      if (flood.far[begin] !== undefined || partOf[begin] >= 0) continue;
      // a part: the spots a body steps between, level or a step apart
      const spots = [begin];
      partOf[begin] = found.length;
      for (let at = 0; at < spots.length; at++) {
        const spot = spots[at];
        const placeNumber = layer.place[spot];
        const i = placeNumber % counts[0];
        const j = Math.floor(placeNumber / counts[0]);
        for (let way = 0; way < 4; way++) {
          const ni = i + WAYS[way][0];
          const nj = j + WAYS[way][1];
          if (ni < 0 || nj < 0 || ni >= counts[0] || nj >= counts[1]) continue;
          const beside = ni + counts[0] * nj;
          const start = layer.first[beside];
          for (let other = start; other < start + layer.count[beside]; other++) {
            if (partOf[other] >= 0 || flood.far[other] !== undefined || flood.slides(other)) continue;
            if (Math.abs(layer.floor[other] - layer.floor[spot]) > step + HAIR) continue;
            if (
              Math.max(layer.floor[other], layer.floor[spot]) > Math.min(layer.ceil[other], layer.ceil[spot])
            )
              continue;
            partOf[other] = found.length;
            spots.push(other);
          }
        }
      }
      found.push(spots);
    }
    standable = stood * square;
    share = stood ? got / stood : null;
    found.sort((a, b) => b.length - a.length);
    const least = Math.max(1, PART_LEAST / square);
    const large = found.filter((spots) => spots.length >= least);
    for (const spots of found) {
      if (spots.length >= least) continue;
      patches.count++;
      patches.area += spots.length * square;
    }
    /**
     * Of the spots of a part, the one another way gets to first: a spot of that way's own layer, or -1.
     * `lift`: how far over the part's floor the way's body is looked for (open air: a body's middle).
     */
    const firstBy = (tried, spots, lift = 0) => {
      let best = -1;
      for (const spot of spots) {
        let other = spot;
        if (tried.layer !== layer) {
          other = tried.layer.spotAt(layer.place[spot], layer.floor[spot] + lift, lift ? 0 : step);
          if (other < 0) continue;
          if (!lift && Math.abs(tried.layer.floor[other] - layer.floor[spot]) > step + HAIR) continue;
        }
        if (tried.flood.far[other] === undefined) continue;
        if (best < 0 || tried.flood.far[other] < tried.flood.far[best]) best = other;
      }
      return best;
    };
    const air = OTHER_WAYS.find((way) => way.fly);
    const shutDoors = space.doors.some((door) => !door.open);
    /** What it takes to get to a part: `{ how, why, behind }`, by the ways an entity is tried, in turn. */
    const whyOf = (spots) => {
      for (const way of OTHER_WAYS) {
        const tried = way.fly ? null : tryWay(way);
        const first = tried ? firstBy(tried, spots) : -1;
        if (first < 0) continue;
        const where = leavesWalk(grid, layer, flood, tried.layer, tried.flood, first, way, step);
        return { how: way.name, why: `${way.words}${where}`, behind: [] };
      }
      const between = behindOf((tried) => firstBy(tried, spots));
      if (between)
        return { how: "wall", why: behindWords(between), behind: between.areas.map((each) => each.number) };
      const flown = tryWay(air);
      if (flown && firstBy(flown, spots, body.height / 2) >= 0)
        return { how: air.name, why: air.words, behind: [] };
      return {
        how: "none",
        why: `no opening leads to it${shutDoors ? " (with the doors that are taken as closed)" : ""}`,
        behind: [],
      };
    };
    for (const spots of large.slice(0, MOST_PARTS)) {
      const points = spots.map((spot) => pointOfSpot(grid, layer, spot));
      const mean = [0, 1].map((axis) => points.reduce((sum, point) => sum + point[axis], 0) / points.length);
      const at = points.reduce((best, point) =>
        Math.hypot(point[0] - mean[0], point[1] - mean[1]) < Math.hypot(best[0] - mean[0], best[1] - mean[1])
          ? point
          : best,
      );
      const heights = points.map((point) => point[2]);
      const floors = [heights.reduce((a, b) => Math.min(a, b)), heights.reduce((a, b) => Math.max(a, b))];
      // the walked floor nearest it, looked for from some of its places
      let nearest = null;
      let nearestFrom = null;
      const every = Math.max(1, Math.floor(points.length / PART_SAMPLES));
      for (let index = 0; index < points.length; index += every) {
        const near = nearestWalked(grid, layer, flood, points[index]);
        if (near && (!nearest || near.away < nearest.away)) [nearest, nearestFrom] = [near, points[index]];
      }
      const told = whyOf(spots);
      // where a way leaves the walked floor is said already; of the others, how near the walked floor comes
      const near = told.how === "air" || told.how === "none" ? nearWords(nearest, nearestFrom ?? at) : "";
      const area = spots.length * square;
      parts.push({
        at,
        area,
        floors,
        how: told.how,
        why: `${told.why}${near}`,
        nearest: nearest && { at: nearest.at.map(Math.round), away: Math.round(nearest.away) },
        behind: told.behind,
        words: `about ${area} square units about ${place(at)} (floor z ${floors[0]}${floors[1] === floors[0] ? "" : ` to ${floors[1]}`}): ${told.why}${near}`,
      });
    }
    /** A share as a sentence has it: so many in 100, to a tenth. */
    const in100 = (value) => Math.round(value * 1000) / 10;
    facts.push(
      `the walk reaches ${in100(share ?? 0)} in 100 of the floor a standing player fits on (${got * square} of ${standable} square units, on the grid of ${grid.cell})`,
    );
    const smaller = patches.count
      ? `${patches.count} patches under ${PART_LEAST} square units (${patches.area} in all: the tops of things, as a rule)`
      : "";
    if (large.length)
      facts.push(
        `${large.length} parts of that floor are not walked to${smaller ? `, and ${smaller}` : ""}; the largest first: ${some(
          parts.map((part) => part.words),
          6,
        )}`,
      );
    else if (smaller) facts.push(`the floor that is not walked to is ${smaller}`);
    // what the whole map is short of, said once: a map made to be jumped through, a map of walls that break
    const areaBy = (...hows) =>
      parts.reduce((sum, part) => sum + (hows.includes(part.how) ? part.area : 0), 0);
    const byJump = areaBy("jump", "crouch-jump");
    if (!jump && byJump >= standable / 10)
      facts.push(
        `about ${byJump} square units of it (${in100(byJump / standable)} in 100 of all the floor) are reached only by a jump: a player is meant to jump there, and \`jump: true\` makes jumps part of the walk`,
      );
    // the parts the size of a room at a room's height: a warning each (a roof over the walked floor, open to the sky, is not)
    const skyOver = (at) => space.cut(at[0], at[1]).filter(([, to, kind]) => kind !== "liquid" && to > at[2] + 1).reduce((a, b) => (!a || b[0] < a[0] ? b : a), null)?.[2] === "sky"; // prettier-ignore
    const rooms = parts.filter((part) => part.area >= ROOM_PART && part.floors[0] <= highest + ROOM_OVER && !(part.floors[0] > highest && skyOver(part.at))); // prettier-ignore
    if (rooms.length)
      warnings.push(
        `${rooms.length} parts of the floor the size of a room (${ROOM_PART} square units or more, at most ${ROOM_OVER} over the highest floor walked, ${highest}) are reached only by a jump or not at all, the largest first: ${some(rooms.map((part) => part.words), 8)}`,
      );
    const byWall = areaBy("wall");
    if (byWall >= standable / 20)
      facts.push(
        `about ${byWall} square units of it (${in100(byWall / standable)} in 100 of all the floor) are behind brush entities: \`open\` takes away those it names, \`walls: "gone"\` all that break or are switched off`,
      );
  }

  // ── bodies that do not fit where they stand, or hang ──
  const stuck = [];
  const hanging = [];
  for (const thing of things) {
    if (thing.brush || !thing.origin) continue;
    const stands = bodyFor(thing.classname, thing.targetname, bodies);
    if (!stands || (space.compiled && stands.body.hull === null)) continue;
    const feet = [thing.origin[0], thing.origin[1], thing.origin[2] - stands.feet];
    const rest = restOf(space, feet, stands.body);
    const entry = {
      number: thing.number,
      classname: thing.classname,
      targetname: thing.targetname,
      origin: thing.origin,
    };
    if (!rest.fits) {
      const lift = rest.stretch[1] - feet[2];
      const sunk = lift <= stands.body.height;
      stuck.push({
        ...entry,
        lift: sunk ? lift : null,
        words: `${named(thing)} at ${place(thing.origin)} (${sunk ? `its feet are ${Math.round(lift * 10) / 10} under the floor at z ${Math.round(rest.stretch[1])}: it fits ${Math.round(lift * 10) / 10} higher` : "a wall, a ceiling or a piece of the map is in its box"})`,
      });
    } else if (rest.floor === null || rest.hang > hang) {
      hanging.push({
        ...entry,
        hang: rest.hang,
        words: `${named(thing)} at ${place(thing.origin)} (${rest.floor === null ? "nothing under it" : `${Math.round(rest.hang)} over the floor at z ${Math.round(rest.floor)}`})`,
      });
    }
  }
  if (stuck.length)
    warnings.push(
      `${stuck.length} entities stand in something solid: the box each moves with does not fit where it is: ${some(stuck.map((each) => each.words))}`,
    );
  if (hanging.length)
    warnings.push(
      `${hanging.length} entities hang more than ${hang} units over their floor (a monster of the game drops to it as it appears; whether a mod's does is for the game to show): ${some(hanging.map((each) => each.words))}`,
    );

  // ── the openings ──
  const openings = begun.length ? openingsOf(grid, layer, flood, widest) : [];
  const said = (opening) =>
    `${opening.number} at ${place(opening.at)}: ${opening.width} wide${opening.height === null ? ", open above" : `, ${Math.round(opening.height)} high`}`;
  if (openings.length) {
    const narrowest = openings.reduce((a, b) => (b.width < a.width ? b : a));
    facts.push(
      `${openings.length} openings on the walked floor, the narrowest ${narrowest.width} wide (${said(narrowest)}); sizes are to the grid of ${grid.cell}`,
    );
  }
  const tight = openings.filter((opening) => opening.width < 2 * body.half + 2 * grid.cell);
  if (tight.length)
    warnings.push(
      `${tight.length} openings are only just wide enough for a player (32): the game may not let one through; 48 or more is safe: ${some(tight.map(said))}`,
    );
  const wantsLarge = Object.values(bodies).some((each) => each === "large") || options.large === true;
  const small = openings.filter((opening) => !opening.fits.large);
  if (small.length)
    (wantsLarge ? warnings : facts).push(
      `${small.length} openings a player walks through are under 64 wide or 64 high: a large monster's box does not pass them: ${some(small.map(said))}`,
    );

  // ── how far, and the ways asked for ──
  const walkedSpots = flood.far.reduce((sum, value) => sum + (value === undefined ? 0 : 1), 0);
  const area = walkedSpots * grid.cell * grid.cell;
  if (begun.length) facts.push(`the floor walked is about ${area} square units, on a grid of ${grid.cell}`);
  if (grid.cell !== grid.asked)
    facts.push(`the map is large: walked on a grid of ${grid.cell}, not ${grid.asked}`);
  const farthest = entities.filter((entity) => entity.reached).sort((a, b) => b.far - a.far)[0];
  if (farthest) facts.push(`the longest walk to an entity is ${farthest.far} units, to ${named(farthest)}`);
  const routes = [];
  for (const which of Array.isArray(to) ? to : [to]) {
    // a point: the walk to the nearest walked spot whose body comes within `touch` of it, in sight of it
    if (Array.isArray(which)) {
      if (which.length !== 3 || !which.every(Number.isFinite))
        throw new Error(`to: a point is [x, y, z], not ${JSON.stringify(which)}`);
      const spot = begun.length ? spotFor(space, grid, layer, flood, { origin: which, classname: "a point" }, touch, null) : -1; // prettier-ignore
      if (spot < 0) {
        warnings.push(`to: the point ${place(which)} is not reached (no walked spot within ${touch} of it, in sight of it)${begun.length ? nearWords(nearestWalked(grid, layer, flood, which), which) : ""}`); // prettier-ignore
        continue;
      }
      routes.push({ number: null, classname: "a point", at: which, far: Math.round(flood.far[spot]), points: routeTo(grid, layer, flood, spot) }); // prettier-ignore
      facts.push(`the walk to the point ${place(which)} is ${Math.round(flood.far[spot])} units`);
      continue;
    }
    const wanted = entities.filter(
      (entity) => entity.number === which || entity.classname === which || entity.targetname === which,
    );
    if (!wanted.length) warnings.push(`to: no entity ${which} among those a player goes to`);
    for (const entity of wanted) {
      if (!entity.reached) continue;
      routes.push({
        number: entity.number,
        classname: entity.classname,
        far: entity.far,
        points: routeTo(grid, layer, flood, entity.spot),
      });
      facts.push(`the walk to ${named(entity)} is ${entity.far} units`);
    }
  }
  const openDoors = space.doors.filter((door) => door.open);
  const shutDoors = space.doors.filter((door) => !door.open);
  if (openDoors.length)
    facts.push(`${openDoors.length} doors were taken as open: ${some(openDoors.map(named), 6)}`);
  if (shutDoors.length)
    facts.push(`${shutDoors.length} doors were taken as closed: ${some(shutDoors.map(named), 6)}`);

  /** The floor of a spot of a place: the highest at or under a height, among those that pass `counts`. */
  const floorAt = (ofLayer, x, y, under, counts) => {
    const placeNumber = grid.at(x, y);
    if (placeNumber < 0) return null;
    const start = counts ? ofLayer.first[placeNumber] : ofLayer.spots(placeNumber);
    if (start < 0) return null;
    let found = null;
    for (let spot = start; spot < start + ofLayer.count[placeNumber]; spot++)
      if ((!counts || counts(spot)) && (under === undefined || ofLayer.floor[spot] <= under))
        found = ofLayer.floor[spot];
    return found;
  };
  const isWalked = (spot) => flood.far[spot] !== undefined;
  const isJumped = (spot) => flood.far[spot] !== undefined && onFoot.far[spot] === undefined;
  const isTrapped = (spot) => Boolean(trap.inside?.[spot]);
  const result = {
    warnings,
    facts,
    starts: starts.map(({ spot: _spot, ...start }) => start),
    entities: entities.map(({ spot: _spot, thing: _thing, area: _area, brush: _brush, ...entity }) => entity),
    unreached: unreached.map((entity) => entity.number),
    stuck,
    hanging,
    oneWay: trap.places.map(({ words: _words, ...each }) => each),
    leaps,
    steep: steepSpots * grid.cell * grid.cell,
    openings,
    routes,
    doors: space.doors,
    cell: grid.cell,
    area,
    share,
    standable,
    parts: parts.map(({ words: _words, ...part }) => part),
    patches,
    walked: (x, y, under) => floorAt(layer, x, y, under, isWalked),
    stands: (x, y, under) => floorAt(layer, x, y, under, null),
    jumped: (x, y, under) => floorAt(layer, x, y, under, isJumped),
    trapped: (x, y, under) => floorAt(layer, x, y, under, isTrapped),
    on: (x, y, under) => {
      const stood = floorAt(layer, x, y, under, null);
      const walkedAt = floorAt(layer, x, y, under, isWalked);
      return {
        floor: walkedAt ?? stood,
        stands: stood !== null,
        walked: walkedAt !== null,
        jumped: floorAt(layer, x, y, under, isJumped) !== null,
        trapped: floorAt(layer, x, y, under, isTrapped) !== null,
      };
    },
  };
  // the walk itself, for what is built on it (waypoints.mjs): kept out of what is printed or turned to JSON
  if (options.graph)
    Object.defineProperty(result, "graph", {
      enumerable: false,
      value: {
        space,
        grid,
        layer,
        onFoot,
        flood,
        step,
        up,
        hops,
        starts: starts.filter((start) => start.spot >= 0),
        ladders: (space.ladders ?? []).length
          ? rungsOf(space, layer, (spot) => flood.far[spot] !== undefined, up)
          : [],
        layerOf: (ofBody) => layerOf(space, grid, ofBody),
        floodOf: (ofLayer, walk) => floodOf(space, grid, ofLayer, walk),
      },
    });
  return result;
}

/** A spot as a point: its place, and its floor. */
const pointOfSpot = (grid, layer, spot) => [
  grid.x(layer.place[spot]),
  grid.y(layer.place[spot]),
  Math.round(layer.floor[spot]),
];

/** The reached spots from which a body touches a brush entity's box: in it, or within `touch` of it. */
function spotsAbout(grid, layer, flood, area, touch) {
  const reach = layer.body.half + touch;
  const found = [];
  for (
    let y = Math.ceil((area.min[1] - reach) / grid.cell) * grid.cell;
    y <= area.max[1] + reach;
    y += grid.cell
  )
    for (
      let x = Math.ceil((area.min[0] - reach) / grid.cell) * grid.cell;
      x <= area.max[0] + reach;
      x += grid.cell
    ) {
      const placeNumber = grid.at(x, y);
      const start = placeNumber < 0 ? -1 : layer.first[placeNumber];
      for (let spot = start; start >= 0 && spot < start + layer.count[placeNumber]; spot++)
        if (
          flood.far[spot] !== undefined &&
          layer.floor[spot] - touch <= area.max[2] &&
          layer.floor[spot] + layer.body.height + touch >= area.min[2]
        )
          found.push(spot);
    }
  return found;
}

/**
 * The jumps across a gap that led to floor the walk on foot does not get to: `[{ from, to, run, rise }]`,
 * the longest first. A gap is jumped from every place along its edge: jumps that begin near one another
 * and land near one another are one, told by the shortest of them.
 */
function leapsOf(grid, layer, flood, onFoot) {
  // the shortest jump of each neighbourhood it begins in and lands in
  const shortest = new Map();
  const cellOf = (point) => point.map((value) => Math.round(value / (SAME_LEAP / 2))).join(" ");
  flood.leapt.forEach((leapt, spot) => {
    const off = flood.from[spot];
    if (!leapt || !(off >= 0) || onFoot.far[spot] !== undefined) return;
    const from = pointOfSpot(grid, layer, off);
    const to = pointOfSpot(grid, layer, spot);
    const run = Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]));
    // to the place straight beside is a jump up, not one across
    if (run < grid.cell * 2) return;
    const key = `${cellOf(from)} ${cellOf(to)}`;
    if (!shortest.has(key) || run < shortest.get(key).run)
      shortest.set(key, { from, to, run, rise: to[2] - from[2] });
  });
  // neighbourhoods that touch are one gap
  const all = [...shortest.values()].sort((a, b) => a.run - b.run).slice(0, MOST_LEAPS);
  const group = all.map((_, index) => index);
  const find = (index) => {
    while (group[index] !== index) index = group[index] = group[group[index]];
    return index;
  };
  const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (let one = 0; one < all.length; one++)
    for (let other = one + 1; other < all.length; other++)
      if (apart(all[one].from, all[other].from) < SAME_LEAP && apart(all[one].to, all[other].to) < SAME_LEAP)
        group[find(other)] = find(one);
  // the list is in order of length: the first of each group is its shortest
  const told = new Set();
  const kept = all.filter((_, index) => {
    const root = find(index);
    if (told.has(root)) return false;
    told.add(root);
    return true;
  });
  return kept.sort((a, b) => b.run - a.run);
}

/**
 * The one-way places of a walk: the floor that was reached and from which no seed (a place to start, a way
 * out) is reached back. The flood is run backwards from the seeds over the reached spots, by `rule` (the
 * most a player does to get out: steps, jumps up, slides), through the teleports that were taken (`hops`),
 * by the ladders' shafts (`rungs`) and across the gaps a jump clears (`leap`). What is left is tried once more by a crouching body, which
 * gets out by ways a standing one does not fit. It returns `{ places, inside }`: `places` is `[{ at, area,
 * floors, entry, entities, words }]`, the largest first; `inside[spot]` is 1 for a spot of one.
 */
function oneWayOf({ space, grid, layers, flood, hops, rungs = [], seeds, rule, leap, entities }) {
  const layer = layers.standing;
  const { counts, cell } = grid;
  const out = floodOf(space, grid, layer, { ...rule, links: false });
  const back = new Uint8Array(layer.floor.length);
  const stack = [];
  const push = (spot) => {
    if (!(spot >= 0) || back[spot] || flood.far[spot] === undefined) return false;
    back[spot] = 1;
    stack.push(spot);
    return true;
  };
  /** Marks every reached spot that gets to a marked one, straight beside it. */
  const drain = () => {
    while (stack.length) {
      const spot = stack.pop();
      const placeNumber = layer.place[spot];
      const i = placeNumber % counts[0];
      const j = Math.floor(placeNumber / counts[0]);
      for (let way = 0; way < 4; way++) {
        const ni = i + WAYS[way][0];
        const nj = j + WAYS[way][1];
        if (ni < 0 || nj < 0 || ni >= counts[0] || nj >= counts[1]) continue;
        const beside = ni + counts[0] * nj;
        const start = layer.first[beside];
        for (let other = start; start >= 0 && other < start + layer.count[beside]; other++)
          if (!back[other] && flood.far[other] !== undefined && out.passes(other, spot)) push(other);
      }
    }
  };
  for (const seed of seeds) push(seed);
  const reached = [];
  flood.far.forEach((value, spot) => {
    if (value !== undefined) reached.push(spot);
  });
  for (let again = true; again; ) {
    again = false;
    drain();
    for (const hop of hops)
      if (back[hop.landing])
        for (const spot of hop.spot !== undefined ? [hop.spot] : spotsAbout(grid, layer, flood, hop.area, 0)) if (push(spot)) again = true;
    // up or down a ladder's shaft to floor that has a way back
    for (const [from, to] of rungs) if (back[to] && push(from)) again = true;
    if (again) continue;
    // what is left: a jump across a gap to floor that has a way back
    for (const spot of reached) {
      if (back[spot] || out.slides(spot)) continue;
      const open = [0, 1, 2, 3].some((way) => !(flood.links[spot * 4 + way] >= 0));
      if (!open) continue;
      if (
        LEAP_WAYS.some(
          ([di, dj]) => landingsOf(grid, layer, spot, di, dj, leap, (other) => back[other]).length,
        )
      )
        if (push(spot)) again = true;
    }
  }
  const left = reached.filter((spot) => !back[spot]);
  if (!left.length) return { places: [], inside: null };

  // the patches of what is left: spots a body gets between, one way or the other (a pit with a ledge in it
  // is one place)
  const patchOf = new Int32Array(layer.floor.length).fill(-1);
  const patches = [];
  for (const begin of left) {
    if (patchOf[begin] >= 0) continue;
    const spots = [begin];
    patchOf[begin] = patches.length;
    for (let at = 0; at < spots.length; at++) {
      const spot = spots[at];
      const placeNumber = layer.place[spot];
      const i = placeNumber % counts[0];
      const j = Math.floor(placeNumber / counts[0]);
      for (let way = 0; way < 4; way++) {
        const ni = i + WAYS[way][0];
        const nj = j + WAYS[way][1];
        if (ni < 0 || nj < 0 || ni >= counts[0] || nj >= counts[1]) continue;
        const beside = ni + counts[0] * nj;
        const start = layer.first[beside];
        for (let other = start; start >= 0 && other < start + layer.count[beside]; other++) {
          if (back[other] || patchOf[other] >= 0 || flood.far[other] === undefined) continue;
          if (!out.passes(spot, other) && !out.passes(other, spot)) continue;
          patchOf[other] = patches.length;
          spots.push(other);
        }
      }
    }
    patches.push(spots);
  }
  // a crouching body may yet get out: it is walked from each patch, and jumped across the gaps it comes to,
  // until it stands where there is a way back
  const crouching = (layers.crouching ??= layerOf(space, grid, BODIES.crouching));
  const escapes = (spots) => {
    const crawl = floodOf(space, grid, crouching, { ...rule, links: true, leap });
    for (const spot of spots) {
      const placeNumber = layer.place[spot];
      crawl.seed(crouching.spotAt(placeNumber, layer.floor[spot], rule.step));
    }
    const isOut = (spot) => {
      const placeNumber = crouching.place[spot];
      const start = layer.first[placeNumber];
      for (let other = start; start >= 0 && other < start + layer.count[placeNumber]; other++)
        if (back[other] && Math.abs(layer.floor[other] - crouching.floor[spot]) <= rule.step) return true;
      return false;
    };
    do crawl.run(isOut);
    while (crawl.stopped < 0 && crawl.leaps());
    return crawl.stopped >= 0;
  };
  const inside = new Uint8Array(layer.floor.length);
  const places = [];
  for (const spots of patches) {
    if (escapes(spots)) continue;
    for (const spot of spots) inside[spot] = 1;
    const points = spots.map((spot) => pointOfSpot(grid, layer, spot));
    const mean = [0, 1].map((axis) => points.reduce((sum, point) => sum + point[axis], 0) / points.length);
    const at = points.reduce((best, point) =>
      Math.hypot(point[0] - mean[0], point[1] - mean[1]) < Math.hypot(best[0] - mean[0], best[1] - mean[1])
        ? point
        : best,
    );
    const heights = points.map((point) => point[2]);
    const floors = [heights.reduce((a, b) => Math.min(a, b)), heights.reduce((a, b) => Math.max(a, b))];
    // the way in: the spot of it the walk came to first, and the spot before that
    const first = spots.reduce((best, spot) => (flood.far[spot] < flood.far[best] ? spot : best));
    const before = flood.from[first];
    let entry = null;
    let how = "";
    if (before >= 0) {
      const from = pointOfSpot(grid, layer, before);
      const to = pointOfSpot(grid, layer, first);
      const stride = Math.hypot(to[0] - from[0], to[1] - from[1]);
      entry = { from, to, drop: from[2] - to[2] };
      if (flood.leapt[first]) how = `, entered by a jump from ${place(from)}`;
      else if (flood.climbed[first]) how = `, entered by a ladder at ${place(from)}`;
      else if (stride > cell * 2) how = `, entered through a teleport at ${place(from)}`;
      else if (out.slides(first)) how = `, entered down a slope too steep to climb at ${place(to)}`;
      else if (entry.drop > 0) how = `, entered by a drop of ${entry.drop} at ${place(to)}`;
      else how = `, entered at ${place(to)}`;
    }
    const held = entities.filter(
      (entity) => entity.spot >= 0 && inside[entity.spot] && patchOf[entity.spot] === patchOf[spots[0]],
    );
    const area = spots.length * cell * cell;
    places.push({
      at,
      area,
      floors,
      entry,
      entities: held.map((entity) => entity.number),
      words: `about ${area} square units about ${place(at)} (floor z ${floors[0]}${floors[1] === floors[0] ? "" : ` to ${floors[1]}`})${how}${held.length ? `; in it: ${some(held.map(named), 4)}` : ""}`,
    });
  }
  places.sort((a, b) => b.area - a.area);
  return { places, inside };
}

/**
 * Where another way to a spot leaves the floor that was walked, in words: the first point of that way no
 * walked spot is at, and what is in the way there.
 */
function leavesWalk(grid, walkLayer, walkFlood, wayLayer, wayFlood, spot, way, step) {
  const chain = [];
  for (let at = spot; at >= 0 && at !== undefined; at = wayFlood.from[at]) chain.push(at);
  chain.reverse();
  /** Whether a walked spot is at a place, about a height. */
  const walkedAt = (placeNumber, height) => {
    const start = walkLayer.first[placeNumber];
    for (let other = start; start >= 0 && other < start + walkLayer.count[placeNumber]; other++)
      if (
        walkFlood.far[other] !== undefined &&
        walkLayer.floor[other] <= height + step &&
        height <= walkLayer.ceil[other] + walkLayer.body.height
      )
        return true;
    return false;
  };
  const leaves = chain.findIndex((each) => !walkedAt(wayLayer.place[each], wayLayer.floor[each]));
  if (leaves < 0) return "";
  const at = chain[leaves];
  const point = [grid.x(wayLayer.place[at]), grid.y(wayLayer.place[at]), wayLayer.floor[at]];
  const before = chain[Math.max(0, leaves - 1)];
  const rise = wayLayer.floor[at] - wayLayer.floor[before];
  if (way.name === "crouch") {
    const headroom = wayLayer.ceil[at] - wayLayer.floor[at] + wayLayer.body.height;
    return `: at ${place(point)} the way is ${Math.round(headroom)} high, under the 72 a standing player needs`;
  }
  const leap = chain.slice(leaves).find((each) => wayFlood.leapt[each]);
  if (leap !== undefined) {
    const off = wayFlood.from[leap];
    const begins = [grid.x(wayLayer.place[off]), grid.y(wayLayer.place[off]), wayLayer.floor[off]];
    const lands = [grid.x(wayLayer.place[leap]), grid.y(wayLayer.place[leap]), wayLayer.floor[leap]];
    return `: ${leapWords(begins, lands)}`;
  }
  return `: at ${place(point)} the floor rises ${Math.round(rise)}`;
}

/**
 * A jump in words: how far the body's middle goes, from where to where, and how it lands. One that lands
 * about as high as it began is a jump across a gap; one that lands higher, a jump up onto a ledge that is
 * not straight beside; one that lands lower, a jump out and down.
 */
function leapWords(begins, lands) {
  const run = Math.round(Math.hypot(lands[0] - begins[0], lands[1] - begins[1]));
  const rise = Math.round(lands[2] - begins[2]);
  const ends = `from ${place(begins)} to ${place(lands)}`;
  if (rise > STEP_HEIGHT) return `a jump of ${run} along and ${rise} up, ${ends}`;
  if (rise < -STEP_HEIGHT) return `a jump of ${run} out and ${-rise} down, ${ends}`;
  const landing = rise === 0 ? "level" : `${Math.abs(rise)} ${rise > 0 ? "higher" : "lower"}`;
  return `a jump of ${run} across a gap, ${ends} (${landing})`;
}

/** The walked floor nearest a point: `{ away, at }`, or null when none is within `NEAREST_WITHIN`. */
function nearestWalked(grid, layer, flood, point) {
  let best = null;
  const rings = Math.ceil(NEAREST_WITHIN / grid.cell);
  for (let dj = -rings; dj <= rings; dj++)
    for (let di = -rings; di <= rings; di++) {
      const x = (Math.round(point[0] / grid.cell) + di) * grid.cell;
      const y = (Math.round(point[1] / grid.cell) + dj) * grid.cell;
      const placeNumber = grid.at(x, y);
      const start = placeNumber < 0 ? -1 : layer.first[placeNumber];
      for (let spot = start; start >= 0 && spot < start + layer.count[placeNumber]; spot++) {
        if (flood.far[spot] === undefined) continue;
        const away = Math.hypot(x - point[0], y - point[1], layer.floor[spot] - point[2]);
        if (!best || away < best.away) best = { away, at: [x, y, layer.floor[spot]] };
      }
    }
  return best;
}

/** The walked floor nearest a point, in words: how far it is and where. */
function nearWords(best, point) {
  if (!best) return `: no walked floor is within ${NEAREST_WITHIN} of it`;
  const rise = Math.round(point[2] - best.at[2]);
  return `: the walked floor comes within ${Math.round(best.away)} of it, at ${place(best.at)}, ${Math.abs(rise)} ${rise < 0 ? "over" : "under"} it`;
}

/**
 * What stands where on the map's floors, for a picture that lays the storeys side by side: the heights to
 * cut at so that every floor a player fits on is seen in one of the cuts, the highest first. A floor is seen
 * in a cut that passes through the air over it. `[{ z, floors: [lowest, highest], area }]`.
 *
 *   cell      the grid the floors are looked for on, in units (32)
 *   over      a cut is made this far over the highest floor it is made for (36: a player's middle, so that
 *             doorways are open and steps are not walls)
 *   least     a storey of less than this share of all the floor is left out (0.01)
 */
export function storeyCuts(map, { cell = 32, over = 36, least = 0.01, doors } = {}) {
  const space = spaceOf(map, { doors });
  const grid = gridOf(space, cell);
  const layer = layerOf(space, grid, BODIES.standing);
  const floors = [];
  for (let placeNumber = 0; placeNumber < grid.places; placeNumber++) {
    const start = layer.spots(placeNumber);
    for (let spot = start; spot < start + layer.count[placeNumber]; spot++)
      floors.push([layer.floor[spot], layer.ceil[spot] + BODIES.standing.height]);
  }
  floors.sort((a, b) => b[0] - a[0]);
  const whole = floors.length * grid.cell * grid.cell;
  const storeys = [];
  let left = floors;
  while (left.length) {
    // the highest floor that is a storey: with its like (a step under it at the most) it is no small part
    // of all the floor. A tree's top and a crate's are passed over
    const few = Math.max(1, least * floors.length);
    const top = left.find((floor, index) => {
      let like = 0;
      for (let other = index; other < left.length && left[other][0] >= floor[0] - STEP_HEIGHT; other++)
        like++;
      return like >= few;
    });
    if (!top) break;
    const z = top[0] + over;
    const seen = left.filter((floor) => floor[0] < z && z <= floor[1]);
    // a floor with no room for the cut over it is seen from the middle of its own height
    const here = new Set(seen.length ? seen : [top]);
    const heights = [...here].map((floor) => floor[0]);
    storeys.push({
      z: Math.round(seen.length ? z : (top[0] + top[1]) / 2),
      floors: [heights.reduce((a, b) => Math.min(a, b)), heights.reduce((a, b) => Math.max(a, b))].map(
        Math.round,
      ),
      area: here.size * grid.cell * grid.cell,
    });
    left = left.filter((floor) => !here.has(floor));
  }
  return storeys.filter((storey) => storey.area >= whole * least);
}
