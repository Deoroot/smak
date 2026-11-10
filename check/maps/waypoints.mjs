// Waypoints for a bot, from the walk test: where a bot may stand and which way it may go from each, laid over
// the floor a player walks, for RCBot's .rcw file (rcbot.mjs). A bot plays a map by its waypoints alone: it
// walks a straight line from one to the next along the paths, and where none is near it does not move.
//
// HOW. The map is walked as `reachOf` walks it (reach.mjs: a standing player, steps of 18, any drop, ladders,
// jumps up 45 and across gaps), on a grid of 8; floor that nothing is seen to make (the top of the sky, a clip
// over it) is left out. On that walked floor:
//   1. the places a waypoint has to be come first: each place to start; the foot and the top of each ladder
//      climbed (LADDER), as RCBot's own guide has them (rcbot/waypoints/waypointingladders.htm); for each
//      piece of floor only a jump reaches, where the jump is made from (JUMP) and where it lands; the two ends
//      of each flight of stairs or ramp; the middle of each opening (a doorway, a gate, a gap between crates)
//   2. then the rest of the floor, from the roomiest places down (the middle of a room before its walls), a
//      waypoint wherever no waypoint is within `spacing` units of walk (160): no point of the walked floor
//      is farther than that from one, and two are never nearer, but for those of step 1
//   3. each piece of floor is given to its nearest waypoint (by walk); two waypoints whose pieces touch are
//      joined both ways when a body walks the straight line between them on the level (a step at most up or
//      down at each place of the grid) with room beside it (ROOM: never brushing a wall, a prop's clip or
//      an edge where the floor has more room), one way when the line drops (250 at the most); when it is not
//      walked both ways (a corner between them) and no third waypoint joins them, a waypoint is put at the
//      place farthest off the line of a walk between them that keeps off the walls, moved into more room if
//      it can be; where the walk got into a piece only by a drop no path takes, one at the top of that drop
//      and one where it lands; and the pieces are given out again, eight times at most, and once more taking
//      the lines a body only just fits along
//   4. then any two within 1.5 x `spacing` whose straight line is walked with room are joined, the nearest
//      first, up to `paths` paths (16) out of one waypoint, but not where two shorter paths it has go
//      nearly the same way; no drops here
//   5. floor where only a crouching player fits and that is much the shorter way (or the only one) between
//      two places a standing one walks (a vent, a low passage; not the nook under a table or a stair) gets
//      waypoints of its own, CROUCH, 18 over the floor, joined along the crouching body's walk
//   6. where the paths still do not join what the walk does: a jump up out of a place a path gets into and
//      has no way back from, a drop into a place no path gets to; and the pieces given out again. Then where
//      the nearest waypoint a place sees (the one a bot that has lost its way makes for) is on another floor
//      and not walked to, a waypoint on that place's own floor ("near")
//   7. drops where a walk of about the same length goes to the same waypoint are taken out, and the top of a
//      crate a jump gets onto is a side trip (down only to where the jump was made); no waypoint is put on the
//      top of what gives way (a crate that breaks)
//   8. only the waypoints a path from a place to start gets to, and that have a path back to one, are kept;
//      and the first 50 of the file, where RCBot's bots roam to, are places in room spread over the map
// A waypoint's origin is a player's there: 36 over the floor standing, 18 crouching.
//
// WHAT IT IS WORTH. It is the walk test's geometry with the engine's numbers, not the game: a line a body fits
// along is no proof that the bot's steering keeps to it, a jump found is the arc of reach.mjs, and doors are
// taken as open. Teleports and lifts are not waypointed. Look at the plan it draws, and play the map with bots.
//
//   waypointsOf(map, options)   { waypoints: [{ origin, flags, paths, ways, kind }], facts, warnings, ... }
import { reachOf, JUMP_HEIGHT } from "./reach.mjs";
import { BODIES } from "../../make/maps/space.mjs";
import { RCW_FLAGS, RCBOT_MOST_WAYPOINTS } from "../../make/maps/rcbot.mjs";

// ── constants ───────────────────────────────────────────────────────────────
/** How far apart waypoints are on open floor, by walk (units), unless told. */
const SPACING = 160;
/** The grid the floor is walked on (units). */
const CELL = 8;
/** The most paths out of one waypoint, unless told (the bot keeps any number, in lists of 4). */
const MOST_PATHS = 16;
/**
 * The highest drop a path goes down (units). Half-Life hurts a fall faster than 580 units a second, a drop of
 * 210 (pm_shared.c, PLAYER_MAX_SAFE_FALL_SPEED; map-sweep); one of 250 lands at 632 and costs about 11 health
 * (the SDK's player.cpp, PLAYER_FALL_PUNCH_THRESHHOLD aside): a bot takes it as a player would.
 */
const MOST_DROP = 250;
/** A waypoint of step 1 is not put within this of one there already (units); its flags are given to that one. */
const SAME_PLACE = 40;
/** A piece of floor only a jump reaches is waypointed when it is this large at least (square units). */
const JUMP_AREA = 4096;
/** How far from a ladder's box the floor at its foot and top is looked for (units). */
const LADDER_NEAR = 48;
/** A jump is made from this far back along the walk (units), and lands this far onto its piece. */
const RUN_UP = 32;
const ONTO = 64;
/** How far under a body's floor the solid that makes it may be at its middle (a stair's tread; units). */
const UNSEEN_STEP = 24;
/** Floor a crouching body only fits is a passage when the standing floor at its ends is this far apart. */
const PASSAGE = 96;
/** Crouching waypoints are this far apart along a passage at the most (units). */
const CROUCH_SPACING = 96;
/** A flight of stairs or a ramp has its ends waypointed when it rises this much (units). */
const FLIGHT_RISE = 40;
/** How many rounds of waypoints are put where the nearest waypoint misleads a bot (step 6b). */
const NEAREST_ROUNDS = 3;
/** How many times corners are mended (step 3) before the paths are made all the same. */
const MENDS = 8;
/** How many rounds of jumps and drops are added where the paths do not yet join what the walk does (step 6). */
const REPAIRS = 6;
/**
 * The room a path keeps (units): the body walking the straight line between two waypoints has this much
 * floor beside it, either side, at every place of the grid along it, besides its own half width (16), where
 * the floor has it: the line stands 24 off a wall, so that between the places of the grid, where the walk
 * is not asked, the body still clears it. A bot does not keep to the line: RCBot heads for the next
 * waypoint as soon as the distance to the one it is making for stops falling, which is short of it, and is
 * pushed by others, so that a line that only just clears a corner is a corner the bot walks into. Near a
 * waypoint that stands in less room (a doorway, the top of a stair, a ledge) the line is asked for no more
 * than that and as much again as it has gone from it: it leaves a narrow place as a cone, not along a wall.
 * Twice as much (16) was tried: on The Specialists' maps it put two waypoints for one at the corners.
 */
const ROOM = 8;
/** How far a waypoint at a corner, or on floor by a wall, may be moved to stand in more room (units, by walk). */
const CORNER_SHIFT = 48;
/**
 * A drop is a path one way, which RCBot weighs by its length alone, as it weighs any path: a bot takes a
 * drop wherever it is the shorter way, and finds itself below with the long way back. A drop is offered only
 * where the paths that are walked do not go to the same waypoint within this many times its length (and
 * `DROP_SLACK` units): where a walk of about the same length goes there, the walk is the way.
 */
const DROP_DETOUR = 1.5;
const DROP_SLACK = 64;
/**
 * A path from a waypoint is not made where two it has already go nearly the same way, through a waypoint
 * nearer than either end: their two lengths together no more than this many times its length. The bot has
 * fewer long lines to follow that skim what the shorter ones go round.
 */
const ROUNDABOUT = 1.1;
/**
 * RCBot's bots roam to a goal chosen at random among the FIRST 50 waypoints of the file (dlls/waypoint.cpp,
 * WaypointFindRandomGoal: `indexes[50]`, `if (count < 50)`). The order of the file is the bot's plan: the
 * first 50 are places spread over the map where a player stands in room (never the top of a crate a jump gets
 * onto, a corner, a ledge or a narrow lane).
 */
const RCBOT_GOALS = 50;
/** A player's origin over his floor, standing and crouching. */
const STANDING_MIDDLE = 36;
const CROUCHING_MIDDLE = 18;
/** The four straight ways of the grid, as reach.mjs numbers them (its links are kept in this order). */
const STRAIGHT = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// ── small tools ─────────────────────────────────────────────────────────────
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
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const place = (point) => point.map((value) => Math.round(value)).join(" ");

/**
 * A walk's floor as a net of spots: `{ layer, links, ok(spot), passes(spot, other), grid }`, and what is
 * asked of it: the spots beside a spot on the level (`around`), a spot's point (`pointOf`), the straight line
 * between two spots walked (`march`).
 */
function netOf(grid, layer, flood, ok = (spot) => spot >= 0 && flood.far[spot] !== undefined) {
  const { links } = flood;
  const net = {
    grid,
    layer,
    links,
    ok,
    passes: flood.passes,
    /** Calls `visit(other, length)` for each spot beside `spot` on the level: four straight, four across corners. */
    around(spot, visit) {
      const straight = [-1, -1, -1, -1];
      for (let way = 0; way < 4; way++) {
        const other = links[spot * 4 + way];
        if (other >= 0 && ok(other)) {
          straight[way] = other;
          visit(other, grid.cell);
        }
      }
      for (const [wi, wj] of [
        [0, 2],
        [0, 3],
        [1, 2],
        [1, 3],
      ]) {
        const viaI = straight[wi];
        const viaJ = straight[wj];
        if (viaI < 0 || viaJ < 0) continue;
        const other = links[viaI * 4 + wj];
        if (other >= 0 && ok(other) && links[viaJ * 4 + wi] === other) visit(other, grid.cell * Math.SQRT2);
      }
    },
    /** A spot's place and floor: `[x, y, floor]`. */
    pointOf: (spot) => [grid.x(layer.place[spot]), grid.y(layer.place[spot]), layer.floor[spot]],
    /**
     * Whether a body walks the straight line from spot `a` to spot `b`, place by place of the grid (each a
     * step to one straight beside the last, as a line crosses the grid). On the level a step is a link (no
     * more than a step up or down); with `drop`, a step may also go down as far as that. `room(trail,
     * length)`, when given, is asked of the line once it is walked: `trail` holds each place it came to after
     * `a`, `{ spot, at, down }` (`at`: how many places along the line from `a`; `down`: the body dropped to
     * it), and `length` is the line's in places; false, and the line is not taken. Returns null, or
     * `{ dropped }`: the deepest drop taken.
     */
    march(a, b, drop = 0, room = null) {
      const columns = grid.counts[0];
      const i0 = layer.place[a] % columns;
      const j0 = Math.floor(layer.place[a] / columns);
      const i1 = layer.place[b] % columns;
      const j1 = Math.floor(layer.place[b] / columns);
      const across = Math.abs(i1 - i0);
      const along = Math.abs(j1 - j0);
      const wayI = i1 > i0 ? 0 : 1;
      const wayJ = j1 > j0 ? 2 : 3;
      let spot = a;
      let i = 0;
      let j = 0;
      let dropped = 0;
      const trail = room ? [] : null;
      // how far a place of the grid stands off the line, in places: a step that takes the body more than
      // one place off it is not taken
      const length = Math.hypot(across, along) || 1;
      const off = (ni, nj) => Math.abs(ni * along - nj * across) / length;
      /** The spot a level step takes the body to along one axis (true: across), or -1. */
      const stepTo = (alongI) => {
        if (alongI ? i >= across : j >= along) return -1;
        if (off(alongI ? i + 1 : i, alongI ? j : j + 1) > 1) return -1;
        const next = links[spot * 4 + (alongI ? wayI : wayJ)];
        return next >= 0 && ok(next) ? next : -1;
      };
      while (i < across || j < along) {
        const ti = i < across ? (i + 0.5) / across : Infinity;
        const tj = j < along ? (j + 0.5) / along : Infinity;
        const first = ti <= tj;
        // the step the line asks for, or the other way round a corner of the grid it passes near
        let alongI = first;
        let next = stepTo(alongI);
        let fell = false;
        if (next < 0) {
          alongI = !first;
          next = stepTo(alongI);
        }
        if (next < 0) {
          if (!drop) return null;
          // down off an edge, the way the line asks for: the spot of the place beside nearest under this
          // floor that the body falls to
          alongI = first;
          const [di, dj] = STRAIGHT[alongI ? wayI : wayJ];
          const placeNumber = layer.place[spot] + di + dj * columns;
          const start = layer.spots(placeNumber);
          if (start >= 0)
            for (let other = start; other < start + layer.count[placeNumber]; other++) {
              const down = layer.floor[spot] - layer.floor[other];
              if (!ok(other) || down <= 0 || down > drop || !flood.passes(spot, other)) continue;
              if (next < 0 || layer.floor[other] > layer.floor[next]) next = other;
            }
          if (next < 0) return null;
          fell = true;
          dropped = Math.max(dropped, layer.floor[spot] - layer.floor[next]);
        }
        if (alongI) i++;
        else j++;
        spot = next;
        if (trail) trail.push({ spot, at: Math.hypot(i, j), down: fell });
      }
      if (spot !== b) return null;
      if (trail && !room(trail, Math.hypot(across, along))) return null;
      return { dropped };
    },
  };
  return net;
}

/**
 * From the spots `seeds`, the walk over a net's level floor to every spot within `radius` (Infinity: all):
 * `{ far: Map(spot -> units), from: Map(spot -> spot), owner: Map(spot -> seed index) }`. `within(spot)`
 * keeps the walk to some spots; `weight(spot)` is what each unit of the walk onto a spot costs (1 unless
 * told), and `far` is then that cost.
 */
function spread(net, seeds, radius = Infinity, within = null, weight = null) {
  const far = new Map();
  const from = new Map();
  const owner = new Map();
  const heap = heapOf();
  seeds.forEach((spot, index) => {
    if (spot < 0 || (far.has(spot) && far.get(spot) <= 0)) return;
    far.set(spot, 0);
    from.set(spot, -1);
    owner.set(spot, index);
    heap.push(0, spot);
  });
  const done = new Set();
  while (heap.size) {
    const [length, spot] = heap.pop();
    if (done.has(spot) || length > far.get(spot)) continue;
    done.add(spot);
    net.around(spot, (other, step) => {
      const next = length + (weight ? step * weight(other) : step);
      if (next > radius || (within && !within(other))) return;
      if (far.has(other) && far.get(other) <= next) return;
      far.set(other, next);
      from.set(other, spot);
      owner.set(other, owner.get(spot));
      heap.push(next, other);
    });
  }
  return { far, from, owner };
}

/**
 * Each spot of a net's level floor given to its nearest seed by walk: `{ owner }`, which answers `get(spot)`
 * (the seed's index, or undefined) and is walked over as `[spot, index]` pairs. The whole floor at once, in
 * typed arrays: what `spread` does for a few hundred spots, this does for a million.
 */
function ownersOf(net, seeds) {
  const count = net.layer.floor.length;
  const far = new Float64Array(count).fill(Infinity);
  const owners = new Int32Array(count).fill(-1);
  const done = new Uint8Array(count);
  const heap = heapOf();
  seeds.forEach((spot, index) => {
    if (spot < 0 || far[spot] === 0) return;
    far[spot] = 0;
    owners[spot] = index;
    heap.push(0, spot);
  });
  while (heap.size) {
    const [length, spot] = heap.pop();
    if (done[spot] || length > far[spot]) continue;
    done[spot] = 1;
    net.around(spot, (other, step) => {
      const next = length + step;
      if (other >= count || next >= far[other]) return;
      far[other] = next;
      owners[other] = owners[spot];
      heap.push(next, other);
    });
  }
  return {
    owner: {
      get: (spot) => (spot >= 0 && spot < count && owners[spot] >= 0 ? owners[spot] : undefined),
      *[Symbol.iterator]() {
        for (let spot = 0; spot < count; spot++) if (owners[spot] >= 0) yield [spot, owners[spot]];
      },
    },
  };
}

/** How far each spot of a net is from the edge of its floor, in places of the grid (0: at the edge). */
function clearanceOf(net, spots) {
  const clear = new Map();
  let ring = [];
  for (const spot of spots) {
    let inner = 0;
    net.around(spot, () => inner++);
    if (inner < 8) {
      clear.set(spot, 0);
      ring.push(spot);
    }
  }
  for (let depth = 1; ring.length; depth++) {
    const next = [];
    for (const spot of ring)
      for (let way = 0; way < 4; way++) {
        const other = net.links[spot * 4 + way];
        if (other >= 0 && net.ok(other) && !clear.has(other)) {
          clear.set(other, depth);
          next.push(other);
        }
      }
    ring = next;
  }
  return clear;
}

/** The pieces of a set of spots that touch on the level: a Map(spot -> piece number), and the pieces' spots. */
function piecesOf(net, spots, inside) {
  const pieceOf = new Map();
  const pieces = [];
  for (const spot of spots) {
    if (pieceOf.has(spot)) continue;
    const piece = [spot];
    pieceOf.set(spot, pieces.length);
    for (let at = 0; at < piece.length; at++)
      net.around(piece[at], (other) => {
        if (!pieceOf.has(other) && inside(other)) {
          pieceOf.set(other, pieces.length);
          piece.push(other);
        }
      });
    pieces.push(piece);
  }
  return { pieceOf, pieces };
}

/**
 * Waypoints for a bot on a map's walked floor (the head of this file). `map`: brush source or a compiled
 * map, as `reachOf` takes it, with what it takes (`mod`, `doors`, `open`, `shut`, `walls`, `from`, `bodies`,
 * `exits`). And:
 *   spacing   how far apart waypoints are by walk on open floor (160 units)
 *   cell      the grid the floor is walked on (8)
 *   jump      false: no jumps (unless told, a jump up 45 and across a gap, as `reachOf` with `jump: true`)
 *   crouch    false: no crouching passages
 *   paths     the most paths out of one waypoint (16)
 *   drop      the highest drop a path goes down (250)
 *   most      the most waypoints (RCBot's 1024): over it, `spacing` is made wider until they fit, and said
 * It returns `{ waypoints: [{ origin, flags, paths, ways, tight, kind }], facts, warnings, spacing, cell,
 * reach }`: `paths` are the numbers of the waypoints a bot goes on to, `ways` what each path is ("walk",
 * "drop", "ladder", "jump"), `tight` whether a body only just fits along it (less than ROOM beside it),
 * `kind` why the waypoint is there ("start", "ladder", "jump", "landing", "flight", "opening", "floor",
 * "corner", "ledge" and "drop" (the top of a drop and where it lands), "near" (where the nearest waypoint
 * was on another floor), "crouch"); `reach`, the walk test it was laid on. The first 50 (RCBot's goals)
 * are open floor and places to start, spread over the map.
 */
export function waypointsOf(map, options = {}) {
  const most = options.most ?? RCBOT_MOST_WAYPOINTS;
  let spacing = options.spacing ?? SPACING;
  if (!(spacing >= 16)) throw new Error(`spacing: units between waypoints, 16 at the least, not ${spacing}`);
  // the walk once: only the laying is done again at a wider spacing
  const reach = reachOf(map, {
    ...options,
    cell: options.cell ?? CELL,
    jump: options.jump === false ? false : JUMP_HEIGHT,
    parts: false,
    graph: true,
  });
  const tried = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const made = waypointsAt(reach, { ...options, spacing });
    if (made.waypoints.length <= most) {
      if (tried.length)
        made.warnings.push(
          `${tried.map((each) => `${each.waypoints} waypoints at a spacing of ${each.spacing}`).join(", ")}: over the ${most} the bot has room for, so the spacing was made ${Math.round(spacing)}`,
        );
      return made;
    }
    tried.push({ spacing: Math.round(spacing), waypoints: made.waypoints.length });
    spacing *= 1.25;
  }
  throw new Error(
    `${tried.at(-1).waypoints} waypoints at a spacing of ${tried.at(-1).spacing}: still over ${most}`,
  );
}

function waypointsAt(reach, options) {
  const { spacing, jump = true, crouch = true, paths: mostPaths = MOST_PATHS, drop = MOST_DROP } = options;
  const reachAt = options.reachAt ?? spacing * 1.5;
  const { grid, layer, flood, onFoot, step, starts, space } = reach.graph;
  const warnings = [];
  const facts = [];
  // The floor a bot uses. Not floor that nothing is seen to make: the clip hulls take a sky brush as solid,
  // and a map on an island in the sky (ts_dojo) has its sky's top walked, or a player clip laid over it; no
  // player is meant to be there. A floor is seen when the upright line at its place (or, where it finds
  // none, a few units about it: a line on the face between two brushes may pass through neither) meets the
  // top of something not sky at it or a stair's height under it (the body's box stands on the highest
  // tread under it); and the edge of a seen floor, a body's middle out over a drop, is seen with it
  const spotCount = layer.floor.length;
  const cuts = new Map();
  const madeBy = (x, y, floor, keep) => {
    let cut = keep ? cuts.get(keep) : undefined;
    if (!cut) {
      cut = space.cut(x, y);
      if (keep) cuts.set(keep, cut);
    }
    let found = 0;
    for (const [, top, kind] of cut)
      if (top <= floor + 2 && top >= floor - UNSEEN_STEP)
        found = kind === "sky" ? Math.min(found, -1) || -1 : 1;
    return found;
  };
  const seenMask = new Uint8Array(spotCount);
  for (let spot = 0; spot < spotCount; spot++) {
    if (flood.far[spot] === undefined) continue;
    const placeNumber = layer.place[spot];
    const x = grid.x(placeNumber);
    const y = grid.y(placeNumber);
    const floor = layer.floor[spot];
    const here = madeBy(x, y, floor, placeNumber + 1);
    if (here > 0) seenMask[spot] = 1;
    else if (here === 0)
      for (const [dx, dy] of [
        [3, 3],
        [-3, -3],
        [3, -3],
        [-3, 3],
      ])
        if (madeBy(x + dx, y + dy, floor) > 0) {
          seenMask[spot] = 1;
          break;
        }
  }
  const anyWalk = netOf(grid, layer, flood);
  const nearSeen = (spot) => {
    if (seenMask[spot]) return true;
    let found = false;
    anyWalk.around(spot, (other) => {
      if (found || seenMask[other]) return void (found = true);
      anyWalk.around(other, (further) => {
        if (seenMask[further]) found = true;
      });
    });
    return found;
  };
  const seen = new Uint8Array(spotCount);
  let unseen = 0;
  for (let spot = 0; spot < spotCount; spot++)
    if (flood.far[spot] !== undefined) {
      if (nearSeen(spot)) seen[spot] = 1;
      else unseen++;
    }
  if (unseen)
    facts.push(
      `${Math.round(unseen * grid.cell * grid.cell)} square units of floor walked are the top of the sky, or of a clip nothing is seen under: left out`,
    );
  // what is walked to on foot (ladders too), and each piece only a jump reaches that is large enough to be
  // waypointed (the tops of crates and walls are left out)
  const onFootSeen = (spot) => spot >= 0 && seen[spot] === 1 && onFoot.far[spot] !== undefined;
  const jumpOnly = (spot) => anyWalk.ok(spot) && seen[spot] === 1 && onFoot.far[spot] === undefined;
  const jumpSpots = [];
  if (jump) for (let spot = 0; spot < spotCount; spot++) if (jumpOnly(spot)) jumpSpots.push(spot);
  const jumped = piecesOf(anyWalk, jumpSpots, jumpOnly);
  const jumpsTaken = [];
  const takenPieces = new Set();
  // the top of what gives way (a crate that breaks, a wall switched off) is no place to send a bot: broken,
  // it is not there, and the bot jumps at nothing, or into the next crate
  const giving = (space.areas ?? []).filter((area) => area.gives && !area.open);
  const onWhatGives = (spot) => {
    const [x, y, floor] = anyWalk.pointOf(spot);
    const half = BODIES.standing.half;
    return giving.some(
      (area) =>
        Math.abs(floor - area.max[2]) <= 2 &&
        x > area.min[0] - half &&
        x < area.max[0] + half &&
        y > area.min[1] - half &&
        y < area.max[1] + half,
    );
  };
  let onGiving = 0;
  for (const [number, piece] of jumped.pieces.entries()) {
    if (piece.length * grid.cell * grid.cell < JUMP_AREA) continue;
    if (giving.length && piece.filter(onWhatGives).length * 2 > piece.length) {
      onGiving++;
      continue;
    }
    let best = -1;
    for (const spot of piece) {
      if (!onFootSeen(flood.from[spot])) continue;
      if (best < 0 || flood.far[spot] < flood.far[best]) best = spot;
    }
    if (best < 0) continue;
    takenPieces.add(number);
    jumpsTaken.push({ from: flood.from[best], to: best, piece: number });
  }
  const usableMask = new Uint8Array(spotCount);
  for (let spot = 0; spot < spotCount; spot++)
    if (onFootSeen(spot) || takenPieces.has(jumped.pieceOf.get(spot))) usableMask[spot] = 1;
  const usable = (spot) => spot >= 0 && spot < spotCount && usableMask[spot] === 1;
  const stand = netOf(grid, layer, flood, usable);
  const walked = [];
  for (let spot = 0; spot < spotCount; spot++) if (usableMask[spot]) walked.push(spot);
  if (!walked.length) {
    warnings.push("no floor is walked (no place to start, or none with room): no waypoints");
    return { waypoints: [], facts, warnings, spacing, cell: grid.cell, reach };
  }
  const clear = clearanceOf(stand, walked);
  const clearOf = (spot) => clear.get(spot) ?? 0;
  // the room a path keeps (ROOM), in places of the grid: at each place of the line, as much room as ROOM
  // asks, or as the floor across the line there has (the most room a place has within ROOM of it, square
  // to the line: through a doorway or a corridor only a little wider than the body, its middle, and no
  // more), or as the nearest end has and the places since it, whichever is least. A line that drops has two
  // ends more, the edge it goes over and the place it lands: no room is asked there, and from them the
  // cone opens again
  const roomPlaces = Math.max(1, Math.round(ROOM / grid.cell));
  const columns = grid.counts[0];
  const roomFor = (a, b) => (trail, length) => {
    const ends = [
      [0, clearOf(a)],
      [length, clearOf(b)],
    ];
    trail.forEach((place, index) => {
      if (place.down) ends.push([index ? trail[index - 1].at : 0, 0], [place.at, 0]);
    });
    const [ax, ay] = stand.pointOf(a);
    const [bx, by] = stand.pointOf(b);
    const across = Math.hypot(bx - ax, by - ay) || 1;
    const side = [-(by - ay) / across, (bx - ax) / across];
    return trail.every(({ spot, at }) => {
      const has = clearOf(spot);
      let need = roomPlaces;
      for (const [where, room] of ends) need = Math.min(need, room + Math.abs(at - where));
      if (has >= need) return true;
      // the most room across the line here: the floor beside, at about this height
      const placeNumber = layer.place[spot];
      const i = placeNumber % columns;
      const j = Math.floor(placeNumber / columns);
      let most = has;
      for (let away = 1; away <= roomPlaces && most < need; away++)
        for (const sign of [1, -1]) {
          const oi = i + Math.round(side[0] * away * sign);
          const oj = j + Math.round(side[1] * away * sign);
          if (oi < 0 || oj < 0 || oi >= columns || oj >= grid.counts[1]) continue;
          const other = layer.spotAt(oi + oj * columns, layer.floor[spot], step);
          if (other >= 0 && usable(other) && Math.abs(layer.floor[other] - layer.floor[spot]) <= step)
            most = Math.max(most, clearOf(other));
        }
      return has >= Math.min(need, most);
    });
  };
  /** Whether a body walks the line between two spots on the level (with `drop`, down too), with room. */
  const walks = (a, b, drop = 0) => stand.march(a, b, drop, roomFor(a, b));

  // ── the waypoints: each on a spot of the standing walk, or of the crouching one ──
  const points = [];
  /** A waypoint at a spot, unless one is there already (then that one takes the flags too). */
  const put = (spot, kind, flags = 0, net = stand, middle = STANDING_MIDDLE, alone = false) => {
    const [x, y, floor] = net.pointOf(spot);
    const origin = [x, y, floor + middle];
    // never two on the very same spot, though one stand alone (but a jump's own: a bot jumps at it)
    const same = kind !== "jump" && points.find((point) => point.net === net && point.spot === spot && point.kind !== "jump"); // prettier-ignore
    if (same) {
      same.flags |= flags;
      return same;
    }
    const near =
      !alone &&
      points.find(
        (point) => point.net === net && !point.alone && distance(point.origin, origin) < SAME_PLACE,
      );
    if (near) {
      near.flags |= flags;
      return near;
    }
    const point = { origin, flags, kind, spot, net, alone, out: new Map() };
    points.push(point);
    return point;
  };
  /**
   * A path from one waypoint to another: `why` ("walk", "drop", "ladder", "jump"), forced or not, and
   * `tight` where a body only just fits along it (less than ROOM beside it).
   */
  const join = (from, to, why, forced = false, tight = false) => {
    if (from === to) return;
    if (!from.out.has(to)) from.out.set(to, { why, forced, tight, length: distance(from.origin, to.origin) });
  };

  // 1. the places a waypoint has to be
  for (const start of starts) if (usable(start.spot)) put(start.spot, "start");
  const startCount = points.length;
  // ladders: the foot (the lowest floor beside it) and the top (the highest, no higher than a step over its
  // top), each the walked spot nearest the ladder
  let laddersWaypointed = 0;
  const lifts = (space.ladders ?? []).filter((ladder) => ladder.lift).length;
  for (const ladder of space.ladders ?? []) {
    if (ladder.lift) continue;
    const offOf = (spot) => {
      const [x, y] = stand.pointOf(spot);
      return Math.hypot(
        Math.max(ladder.min[0] - x, 0, x - ladder.max[0]),
        Math.max(ladder.min[1] - y, 0, y - ladder.max[1]),
      );
    };
    const about = [];
    for (
      let y = Math.floor((ladder.min[1] - LADDER_NEAR) / grid.cell) * grid.cell;
      y <= ladder.max[1] + LADDER_NEAR;
      y += grid.cell
    )
      for (
        let x = Math.floor((ladder.min[0] - LADDER_NEAR) / grid.cell) * grid.cell;
        x <= ladder.max[0] + LADDER_NEAR;
        x += grid.cell
      ) {
        const placeNumber = grid.at(x, y);
        const first = placeNumber < 0 ? -1 : layer.first[placeNumber];
        if (first < 0) continue;
        for (let spot = first; spot < first + layer.count[placeNumber]; spot++) {
          const floor = layer.floor[spot];
          if (
            usable(spot) &&
            offOf(spot) <= LADDER_NEAR &&
            floor >= ladder.min[2] - LADDER_NEAR &&
            floor <= ladder.max[2] + step
          )
            about.push(spot);
        }
      }
    if (about.length < 2) continue;
    const low = Math.min(...about.map((spot) => layer.floor[spot]));
    const high = Math.max(...about.map((spot) => layer.floor[spot]));
    if (high - low <= step * 2) continue;
    // the foot touching the ladder; the top on the ledge, half a body in from its edge if it can be
    const nearest = (floor, inward = 0) => {
      const level = about.filter((spot) => Math.abs(layer.floor[spot] - floor) <= step);
      const inside = level.filter((spot) => (clear.get(spot) ?? 0) * grid.cell >= inward);
      return (inside.length ? inside : level).sort((a, b) => offOf(a) - offOf(b))[0];
    };
    const foot = put(nearest(low), "ladder", RCW_FLAGS.LADDER);
    const top = put(nearest(high, BODIES.standing.half), "ladder", RCW_FLAGS.LADDER);
    join(foot, top, "ladder", true);
    join(top, foot, "ladder", true);
    laddersWaypointed++;
  }
  // jumps: for each piece of floor only a jump reaches, the jump to it that the walk found first
  const jumpPairs = [];
  for (const { from, to, piece } of jumpsTaken) {
    // the jump made from a few places back along the walk, onto the roomiest place a little way into the piece
    let runUp = from;
    for (let back = 0; back < RUN_UP / grid.cell; back++) {
      const before = flood.from[runUp];
      if (!usable(before) || onFoot.far[before] === undefined) break;
      runUp = before;
    }
    let onto = to;
    for (const [spot, far] of spread(stand, [to], ONTO, (spot) => jumped.pieceOf.get(spot) === piece).far)
      if (far >= ONTO / 2 && (onto === to || (clear.get(spot) ?? 0) > (clear.get(onto) ?? 0))) onto = spot;
    // the two are a jump's own: no other waypoint takes their place, and they take no other's
    const takeoff = put(runUp, "jump", RCW_FLAGS.JUMP, stand, STANDING_MIDDLE, true);
    const landing = put(onto, "landing", 0, stand, STANDING_MIDDLE, true);
    join(takeoff, landing, "jump", true);
    jumpPairs.push({ takeoff, landing, piece });
  }
  // flights of stairs and ramps: the floor that is not level with all about it, in pieces
  const sloped = (spot) => {
    if (layer.slant[spot] < 0.98) return true;
    let rises = false;
    for (let way = 0; way < 4 && !rises; way++) {
      const other = stand.links[spot * 4 + way];
      if (other >= 0 && stand.ok(other) && Math.abs(layer.floor[other] - layer.floor[spot]) >= 2)
        rises = true;
    }
    return rises;
  };
  const flights = piecesOf(stand, walked.filter(sloped), sloped);
  let flightCount = 0;
  for (const piece of flights.pieces) {
    const floors = piece.map((spot) => layer.floor[spot]);
    const low = Math.min(...floors);
    const high = Math.max(...floors);
    if (high - low < FLIGHT_RISE || piece.length > 4000) continue;
    // each end: the level floor beside the flight's lowest (highest) spot, the roomiest such
    for (const end of [low, high]) {
      const ends = piece.filter((spot) => Math.abs(layer.floor[spot] - end) < 1);
      let chosen = -1;
      for (const spot of ends)
        stand.around(spot, (other) => {
          if (sloped(other) || Math.abs(layer.floor[other] - end) > step) return;
          if (chosen < 0 || (clear.get(other) ?? 0) > (clear.get(chosen) ?? 0)) chosen = other;
        });
      if (chosen < 0) chosen = ends.sort((a, b) => (clear.get(b) ?? 0) - (clear.get(a) ?? 0))[0];
      put(chosen, "flight");
    }
    flightCount++;
  }
  // openings: the middle of each
  let openingCount = 0;
  for (const opening of reach.openings) {
    const spot = layer.spotAt(grid.at(opening.at[0], opening.at[1]), opening.at[2], step);
    if (!stand.ok(spot)) continue;
    put(spot, "opening");
    openingCount++;
  }

  // 2. the rest of the floor, the roomiest places first
  const covered = new Set();
  const cover = (point) => {
    if (point.net !== stand) return;
    for (const spot of spread(stand, [point.spot], spacing).far.keys()) covered.add(spot);
  };
  for (const point of points) cover(point);
  const byRoom = [...walked].sort((a, b) => (clear.get(b) ?? 0) - (clear.get(a) ?? 0) || a - b);
  // the floor left over is by the walls (a room's far corner, the end of a corridor): its waypoint is put
  // where a body has room, twice ROOM if it can, within CORNER_SHIFT of it, not against the wall
  const offTheWall = (spot) => {
    let best = spot;
    let bestRoom = Math.min(clearOf(spot), roomPlaces * 2);
    for (const [other] of spread(stand, [spot], CORNER_SHIFT).far) {
      const room = Math.min(clearOf(other), roomPlaces * 2);
      if (room > bestRoom) (bestRoom = room), (best = other);
    }
    return best;
  };
  for (const spot of byRoom) {
    if (covered.has(spot)) continue;
    cover(put(offTheWall(spot), "floor"));
  }

  // 3. each piece of floor given to its nearest waypoint; every two whose pieces touch joined
  // Two whose pieces touch are walked between both ways (the pieces meet on the level): joined both ways
  // when the straight line is walked with room (ROOM), and otherwise mended with a waypoint at the corner
  // between them. A line that drops is joined one way meanwhile. The last round (`tight`) takes a line the
  // body only fits along, as it is, where the paths do not already go round from one to the other: two
  // waypoints the walk joins are never left apart for want of room
  /** Whether the paths that are not drops lead from one waypoint to another within `most` units. */
  const walkedWithin = (from, to, most) => {
    const far = new Map([[from, 0]]);
    const heap = heapOf();
    heap.push(0, from);
    while (heap.size) {
      const [length, point] = heap.pop();
      if (point === to) return true;
      if (length > far.get(point)) continue;
      for (const [next, path] of point.out) {
        if (path.why === "drop") continue;
        const further = length + path.length;
        if (further > most || (far.has(next) && far.get(next) <= further)) continue;
        far.set(next, further);
        heap.push(further, next);
      }
    }
    return false;
  };
  const tryJoin = (a, b, tight = false) => {
    if (a.out.has(b) && b.out.has(a)) return true;
    const roomy = walks(a.spot, b.spot);
    // a line with no room is the last resort: not where the paths already go round, both ways, within
    // twice its length and a spacing
    const roundAbout = (from, to) => walkedWithin(from, to, distance(a.origin, b.origin) * 2 + spacing);
    if (!roomy && tight && roundAbout(a, b) && roundAbout(b, a)) return true;
    if (roomy || (tight && stand.march(a.spot, b.spot))) {
      join(a, b, "walk", true, !roomy);
      join(b, a, "walk", true, !roomy);
      return true;
    }
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      if (from.out.has(to)) continue;
      const down = walks(from.spot, to.spot, drop);
      if (down || (tight && stand.march(from.spot, to.spot, drop))) join(from, to, "drop", true, !down);
    }
    return false;
  };
  /** What a place of less room than ROOM costs to walk, for each unit, against 1 in the open. */
  const keepOff = (spot) => 1 + 2 * Math.max(0, roomPlaces - clearOf(spot));
  /** Whether two waypoints are walked between, both ways, through one other. */
  const throughOne = (a, b) => {
    for (const [c, path] of a.out)
      if (
        path.why === "walk" &&
        c.out.get(b)?.why === "walk" &&
        b.out.get(c)?.why === "walk" &&
        c.out.get(a)?.why === "walk"
      )
        return true;
    return false;
  };
  /**
   * Where a waypoint put at a corner between `a` and `b` stands: of the places within CORNER_SHIFT of the
   * walk's corner, one from which both lines are walked with room, then one from which both are walked at
   * all, the roomiest such; the corner itself when none is. The walk's own corner is where it brushes the
   * wall it turns round: a waypoint there has the bot turn with its shoulder against the wall.
   */
  const roomiest = (spot, a, b) => {
    let best = spot;
    let bestRank = -Infinity;
    for (const [other, far] of spread(stand, [spot], CORNER_SHIFT).far) {
      const roomy = walks(a.spot, other) && walks(other, b.spot);
      const fits = roomy || (stand.march(a.spot, other) && stand.march(other, b.spot));
      const rank = (roomy ? 2000 : fits ? 1000 : 0) + Math.min(clearOf(other), 50) * 10 - far / CORNER_SHIFT;
      if (rank > bestRank) (bestRank = rank), (best = other);
    }
    return bestRank >= 1000 ? best : spot;
  };
  // the drops the walk took (off a ledge, down a hole): a waypoint's piece may be got to by nothing else
  const drops = [];
  for (const spot of walked) {
    const from = flood.from[spot];
    if (!(from >= 0) || flood.leapt[spot] || flood.climbed[spot] || !usable(from)) continue;
    const down = layer.floor[from] - layer.floor[spot];
    if (down > step && down <= drop) drops.push(spot);
  }
  /** Whether the paths so far lead from one waypoint to another. */
  const leads = (a, b) => {
    const seen = new Set([a]);
    const list = [a];
    for (let at = 0; at < list.length; at++)
      for (const to of list[at].out.keys()) {
        if (to === b) return true;
        if (!seen.has(to)) seen.add(to), list.push(to);
      }
    return false;
  };
  let corners = 0;
  let dropsWaypointed = 0;
  const mendAll = () => {
    for (let mend = 0; mend <= MENDS; mend++) {
      const standing = points.filter((point) => point.net === stand);
      const given = ownersOf(
        stand,
        standing.map((point) => point.spot),
      );
      const touching = new Map();
      for (const [spot, index] of given.owner)
        stand.around(spot, (other) => {
          const otherIndex = given.owner.get(other);
          if (otherIndex === undefined || otherIndex === index) return;
          const key = index < otherIndex ? `${index} ${otherIndex}` : `${otherIndex} ${index}`;
          if (!touching.has(key)) touching.set(key, [index, otherIndex]);
        });
      const added = [];
      for (const [first, second] of touching.values()) {
        const a = standing[first];
        const b = standing[second];
        if (tryJoin(a, b, mend === MENDS) !== false) continue;
        // two already joined both ways through a third need no corner of their own
        if (throughOne(a, b)) continue;
        if (mend === MENDS) continue;
        // the walk from one to the other through their two pieces, and its place farthest off their line
        // (a walk that keeps off the walls where it can: a place with less room than ROOM costs more to
        // walk, so that the walk turns its corner in the open and the waypoint put there stands in room)
        let walk = spread(
          stand,
          [a.spot],
          Infinity,
          (spot) => {
            const owner = given.owner.get(spot);
            return owner === first || owner === second;
          },
          keepOff,
        );
        if (!walk.far.has(b.spot)) walk = spread(stand, [a.spot], spacing * 8, null, keepOff);
        if (!walk.far.has(b.spot)) continue;
        const [ax, ay] = stand.pointOf(a.spot);
        const [bx, by] = stand.pointOf(b.spot);
        const length = Math.hypot(bx - ax, by - ay) || 1;
        // and the place half way along the walk, for when that one is a waypoint already
        let farthest = -1;
        let off = -1;
        let middle = -1;
        const half = walk.far.get(b.spot) / 2;
        for (let at = walk.from.get(b.spot); at >= 0 && at !== a.spot; at = walk.from.get(at)) {
          const [x, y] = stand.pointOf(at);
          const away = Math.abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / length;
          if (away > off) (off = away), (farthest = at);
          if (middle < 0 || Math.abs(walk.far.get(at) - half) < Math.abs(walk.far.get(middle) - half))
            middle = at;
        }
        if (farthest >= 0) added.push({ farthest, middle, a, b });
      }
      // a drop from one waypoint's piece into another's that no path takes yet: down the line between them,
      // or from where the walk dropped, to where it landed
      const dropPairs = new Map();
      for (const spot of drops) {
        const above = given.owner.get(flood.from[spot]);
        const below = given.owner.get(spot);
        if (above === undefined || below === undefined || above === below) continue;
        const key = `${above} ${below}`;
        if (!dropPairs.has(key) || flood.far[spot] < flood.far[dropPairs.get(key)]) dropPairs.set(key, spot);
      }
      const ledges = [];
      for (const [key, spot] of dropPairs) {
        const [a, b] = key.split(" ").map((number) => standing[Number(number)]);
        if (a.out.has(b)) continue;
        const down = walks(a.spot, b.spot, drop);
        if (down || (mend === MENDS && stand.march(a.spot, b.spot, drop))) join(a, b, "drop", true, !down);
        else if (mend < MENDS && !leads(a, b)) ledges.push(spot);
      }
      const before = points.length;
      for (const { farthest, middle, a, b } of added) {
        // the corner a waypoint of its own; or one there already, which helps when the line to it from each
        // of the two is walked; if not, the place half way along the walk is one of its own
        const count = points.length;
        const corner = put(roomiest(farthest, a, b), "corner");
        if (points.length > count) continue;
        if (corner !== a && corner !== b && tryJoin(a, corner) === true && tryJoin(corner, b) === true)
          continue;
        const halfway = roomiest(middle, a, b);
        const [x, y, floor] = stand.pointOf(halfway);
        const at = [x, y, floor + STANDING_MIDDLE];
        if (!points.some((point) => point.net === stand && distance(point.origin, at) < SAME_PLACE / 2))
          put(halfway, "corner", 0, stand, STANDING_MIDDLE, true);
      }
      corners += points.length - before;
      for (const spot of ledges) {
        const edge = put(flood.from[spot], "ledge");
        const landing = put(
          spot,
          "drop",
          0,
          stand,
          STANDING_MIDDLE,
          edge.spot === flood.from[spot] ? false : true,
        );
        if (edge === landing) continue;
        join(edge, landing, "drop", true);
        dropsWaypointed++;
      }
      // nothing more to mend: one round more takes the lines a body only just fits along, and ends
      if (points.length === before) {
        if (mend >= MENDS) break;
        mend = MENDS - 1;
      }
    }
  };
  mendAll();

  // 5. crouching passages
  let passages = 0;
  if (crouch) {
    const low = reach.graph.layerOf(BODIES.crouching);
    const crawl = reach.graph.floodOf(low, { step, up: step, links: true, slopes: true });
    const standsAt = (lowSpot) => {
      const placeNumber = low.place[lowSpot];
      const first = layer.first[placeNumber];
      if (first < 0) return -1;
      for (let spot = first; spot < first + layer.count[placeNumber]; spot++)
        if (Math.abs(layer.floor[spot] - low.floor[lowSpot]) <= 1) return spot;
      return -1;
    };
    for (const spot of walked) crawl.seed(low.spotAt(layer.place[spot], layer.floor[spot], step));
    crawl.run();
    const creep = netOf(grid, low, crawl);
    const crouchOnly = (lowSpot) => creep.ok(lowSpot) && standsAt(lowSpot) < 0;
    const lowSpots = [];
    for (let spot = 0; spot < low.floor.length; spot++) if (crouchOnly(spot)) lowSpots.push(spot);
    const { pieces } = piecesOf(creep, lowSpots, crouchOnly);
    for (const piece of pieces) {
      // where the passage meets the standing walk: its ends
      const mouths = [];
      for (const spot of piece)
        creep.around(spot, (other) => {
          if (crouchOnly(other)) return;
          const standing = standsAt(other);
          if (stand.ok(standing)) mouths.push({ inside: spot, outside: standing });
        });
      // its ends: the mouths a passage's width apart. It is a passage when crawling from one end to another
      // is much the shorter way, or the only one: not the nook under a table or a stair, open along its side
      const ends = [];
      for (const mouth of mouths)
        if (
          !ends.some((end) => distance(creep.pointOf(end.inside), creep.pointOf(mouth.inside)) < PASSAGE / 2)
        )
          ends.push(mouth);
      if (ends.length < 2) continue;
      const linked = new Set();
      for (const [number, end] of ends.entries()) {
        const crawled = spread(creep, [end.inside], Infinity, crouchOnly).far;
        const others = ends.slice(number + 1).filter((other) => crawled.has(other.inside));
        if (!others.length) continue;
        const longest = Math.max(...others.map((other) => crawled.get(other.inside)));
        const walked = spread(stand, [end.outside], longest * 2 + PASSAGE * 2).far;
        for (const other of others) {
          const crawl = crawled.get(other.inside);
          const walk = walked.get(other.outside);
          if (walk !== undefined && walk <= crawl * 2 + PASSAGE) continue;
          linked.add(end);
          linked.add(other);
        }
      }
      if (!linked.size) continue;
      passages++;
      // a crouching waypoint inside each of those ends, then along the passage
      const inPassage = [];
      for (const end of linked)
        inPassage.push(put(end.inside, "crouch", RCW_FLAGS.CROUCH, creep, CROUCHING_MIDDLE));
      const lowCovered = new Set();
      for (const point of inPassage)
        for (const spot of spread(creep, [point.spot], CROUCH_SPACING, crouchOnly).far.keys())
          lowCovered.add(spot);
      for (const spot of piece) {
        if (lowCovered.has(spot)) continue;
        const point = put(spot, "crouch", RCW_FLAGS.CROUCH, creep, CROUCHING_MIDDLE);
        inPassage.push(point);
        for (const near of spread(creep, [spot], CROUCH_SPACING, crouchOnly).far.keys()) lowCovered.add(near);
      }
      // joined along the crouching walk; and each end to the standing waypoints near its mouth
      const lowOf = (point) =>
        point.net === creep ? point.spot : low.spotAt(layer.place[point.spot], layer.floor[point.spot], 1);
      const others = points.filter(
        (point) =>
          point.net === stand &&
          [...linked].some((end) => distance(point.origin, creep.pointOf(end.inside)) < reachAt),
      );
      for (const a of inPassage)
        for (const b of [...inPassage, ...others]) {
          if (a === b || distance(a.origin, b.origin) > reachAt) continue;
          const from = lowOf(a);
          const to = lowOf(b);
          if (!creep.ok(from) || !creep.ok(to)) continue;
          if (creep.march(from, to)) {
            join(a, b, "walk", true);
            join(b, a, "walk", true);
          } else if (creep.march(from, to, drop)) join(a, b, "drop", true);
        }
    }
  }

  // 4. any two near enough whose line is walked with room, the nearest first; not where two paths the
  // waypoint has already go nearly the same way (ROUNDABOUT). No drop is added here: the drops are those of
  // steps 3 and 6, where the floor of one waypoint meets another's over an edge or the walk needs one. A drop
  // offered between any two near enough is a short cut a bot takes off every ledge
  const roundabout = (a, b) => {
    const whole = distance(a.origin, b.origin);
    for (const [c, path] of a.out) {
      if (path.why !== "walk" || c.out.get(b)?.why !== "walk") continue;
      const first = distance(a.origin, c.origin);
      const second = distance(c.origin, b.origin);
      if (first < whole && second < whole && first + second <= whole * ROUNDABOUT) return true;
    }
    return false;
  };
  const joinNear = () => {
    const standing = points.filter((point) => point.net === stand);
    for (const a of standing) {
      const near = standing
        .filter((b) => b !== a && !a.out.has(b) && distance(a.origin, b.origin) <= reachAt)
        .sort((p, q) => distance(a.origin, p.origin) - distance(a.origin, q.origin));
      for (const b of near) {
        if (a.out.size >= mostPaths) break;
        if (roundabout(a, b)) continue;
        if (walks(a.spot, b.spot)) {
          join(a, b, "walk");
          if (b.out.size < mostPaths) join(b, a, "walk");
        }
      }
    }
    // a piece only a jump reaches has a way back down, where its line drops: to where the jump was made
    // from, or else to the nearest waypoint off it that a drop gets to
    for (const { takeoff, landing, piece } of jumpPairs) {
      if ([...landing.out.keys()].some((to) => to.net !== stand || jumped.pieceOf.get(to.spot) !== piece))
        continue;
      if (stand.march(landing.spot, takeoff.spot, drop)) {
        join(landing, takeoff, "drop", true);
        continue;
      }
      const off = (b) =>
        b !== landing &&
        jumped.pieceOf.get(b.spot) !== piece &&
        distance(landing.origin, b.origin) <= reachAt;
      const below = standing
        .filter(off)
        .sort((p, q) => distance(landing.origin, p.origin) - distance(landing.origin, q.origin))
        .find((b) => stand.march(landing.spot, b.spot, drop));
      if (below) join(landing, below, "drop", true);
    }
  };
  joinNear();

  // 6. what the walk joins and the paths do not yet: out of a place a path gets into and finds no way back
  // from, a jump up (a ledge of 45 at most) to floor that leads back; into a place no path gets to, a drop.
  // One for each such place a round, the lowest jump or drop; then the pieces are given out again
  /** The waypoints the paths lead to from `from`, or (`backwards`) that lead to it. */
  const reachedFrom = (from, backwards = false) => {
    const into = new Map(points.map((point) => [point, []]));
    if (backwards) for (const point of points) for (const to of point.out.keys()) into.get(to).push(point);
    const seen = new Set(from);
    const list = [...from];
    for (let at = 0; at < list.length; at++)
      for (const to of backwards ? into.get(list[at]) : list[at].out.keys())
        if (!seen.has(to)) seen.add(to), list.push(to);
    return seen;
  };
  let mended = 0;
  for (let round = 0; round < REPAIRS; round++) {
    const begin = points.filter((point) => point.kind === "start");
    if (!begin.length) begin.push(points[0]);
    const forth = reachedFrom(begin);
    const back = reachedFrom(begin, true);
    const standing = points.filter((point) => point.net === stand);
    if (standing.every((point) => forth.has(point) && back.has(point))) break;
    const given = ownersOf(
      stand,
      standing.map((point) => point.spot),
    );
    const found = [];
    const columns = grid.counts[0];
    for (const [spot, index] of given.owner) {
      const here = standing[index];
      const stuck = forth.has(here) && !back.has(here);
      const good = forth.has(here) && back.has(here);
      if (!stuck && !good) continue;
      for (const [di, dj] of STRAIGHT) {
        const beside = layer.place[spot] + di + dj * columns;
        const first = layer.spots(beside);
        if (first < 0) continue;
        for (let other = first; other < first + layer.count[beside]; other++) {
          const thereIndex = given.owner.get(other);
          if (thereIndex === undefined || !usable(other)) continue;
          const there = standing[thereIndex];
          const rise = layer.floor[other] - layer.floor[spot];
          if (!flood.passes(spot, other)) continue;
          if (jump && stuck && back.has(there) && rise > step && rise <= JUMP_HEIGHT)
            found.push({ how: "jump", from: spot, to: other, place: here, height: rise });
          else if (good && !forth.has(there) && -rise > step && -rise <= drop)
            found.push({ how: "drop", from: spot, to: other, place: there, height: -rise });
        }
      }
    }
    found.sort((a, b) => a.height - b.height);
    // one for each place (the waypoints a path from the chosen one's place gets to are that place)
    const done = new Set();
    let added = 0;
    for (const way of found) {
      if (done.has(way.place)) continue;
      for (const point of reachedFrom([way.place])) done.add(point);
      if (way.how === "jump") {
        let onto = way.to;
        for (const [spot, far] of spread(stand, [way.to], ONTO).far)
          if (far >= ONTO / 2 && (onto === way.to || (clear.get(spot) ?? 0) > (clear.get(onto) ?? 0)))
            onto = spot;
        const takeoff = put(way.from, "jump", RCW_FLAGS.JUMP, stand, STANDING_MIDDLE, true);
        const landing = put(onto, "landing", 0, stand, STANDING_MIDDLE, true);
        join(takeoff, landing, "jump", true);
      } else {
        const edge = put(way.from, "ledge");
        const landing = put(way.to, "drop", 0, stand, STANDING_MIDDLE, true);
        if (edge === landing) continue;
        join(edge, landing, "drop", true);
        dropsWaypointed++;
      }
      added++;
    }
    if (!added) break;
    mended += added;
    mendAll();
    joinNear();
  }

  // 6b. the waypoint nearest a place is one a bot there walks to. A bot that has lost its way (it spawned,
  // fought, was pushed, or has not seen its next waypoint for two seconds) takes the nearest waypoint it
  // sees, by straight distance, whatever floor it is on (dlls/waypoint.cpp, NearestWaypoint), and walks at
  // it: beside a pit that is one at the pit's bottom, under a balcony one on the balcony. Where the nearest
  // waypoint a place sees is on another floor, higher or lower than a jump, and is not walked to from it in
  // a straight line, a waypoint is put on the place's own floor, the roomiest place of those so misled about
  // each waypoint, and the pieces are given out again; three rounds at most
  const sight = typeof space.sees === "function";
  const BUCKET_SIZE = 128;
  for (let round = 0; sight && round < NEAREST_ROUNDS; round++) {
    const standing = points.filter((point) => point.net === stand);
    const given = ownersOf(
      stand,
      standing.map((point) => point.spot),
    );
    const buckets = new Map();
    const keyOf = (x, y) => `${Math.floor(x / BUCKET_SIZE)} ${Math.floor(y / BUCKET_SIZE)}`;
    for (const point of points) {
      const key = keyOf(point.origin[0], point.origin[1]);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(point);
    }
    const misled = new Map();
    for (const [spot, number] of given.owner) {
      const owner = standing[number];
      const [x, y, floor] = stand.pointOf(spot);
      const eye = [x, y, floor + STANDING_MIDDLE];
      const reach = distance(eye, owner.origin);
      if (reach <= grid.cell) continue;
      const nearer = [];
      const reachCells = Math.ceil(reach / BUCKET_SIZE);
      const [ci, cj] = [Math.floor(x / BUCKET_SIZE), Math.floor(y / BUCKET_SIZE)];
      for (let i = ci - reachCells; i <= ci + reachCells; i++)
        for (let j = cj - reachCells; j <= cj + reachCells; j++)
          for (const point of buckets.get(`${i} ${j}`) ?? []) {
            const away = distance(eye, point.origin);
            if (point !== owner && away < reach) nearer.push([away, point]);
          }
      nearer.sort((p, q) => p[0] - q[0]);
      for (const [, point] of nearer) {
        if (!space.sees(eye, point.origin)) continue;
        const otherFloor = Math.abs(point.origin[2] - eye[2]) > JUMP_HEIGHT;
        if (otherFloor && point.net === stand && !stand.march(spot, point.spot)) {
          const was = misled.get(owner);
          if (!was || clearOf(spot) > clearOf(was)) misled.set(owner, spot);
        }
        break;
      }
    }
    const before = points.length;
    for (const spot of misled.values()) put(spot, "near");
    if (points.length === before) break;
    mendAll();
    joinNear();
  }

  // 7. the drops. RCBot weighs a path by its length and nothing else, a drop as a walk: offered a drop, a bot
  // takes it wherever it is the shorter way, and is then below with the long way back (a truck pit by the
  // spawn, open on its sides, its one stair at the far end). A drop is kept where the walk does not go to the
  // same waypoint at about its length (DROP_DETOUR): what is taken out is never the only way, since the walk
  // that stands for it is kept. And the top of a crate or a sill a jump gets onto (a piece smaller than two
  // spacings square) is a side trip: down from it only to where the jump was made from, or beside it, never
  // on across, so that a bot never jumps a crate as a short cut
  let dropsWalked = 0;
  for (const point of points)
    for (const [to, path] of [...point.out])
      if (path.why === "drop" && walkedWithin(point, to, path.length * DROP_DETOUR + DROP_SLACK)) {
        point.out.delete(to);
        dropsWalked++;
      }
  let sideTrips = 0;
  for (const { takeoff, piece } of jumpPairs) {
    if (jumped.pieces[piece].length * grid.cell * grid.cell >= (spacing * 2) ** 2) continue;
    const onIt = points.filter((point) => point.net === stand && jumped.pieceOf.get(point.spot) === piece);
    const beside = new Set([takeoff, ...[...takeoff.out].filter(([, path]) => path.why === "walk").map(([to]) => to)]); // prettier-ignore
    const across = onIt.flatMap((point) =>
      [...point.out]
        .filter(([to, path]) => path.why === "drop" && !beside.has(to))
        .map(([to]) => [point, to]),
    );
    const goesBack = onIt.some((point) =>
      [...point.out].some(([to, path]) => path.why === "drop" && beside.has(to)),
    );
    if (!goesBack || !across.length) continue;
    for (const [point, to] of across) point.out.delete(to);
    sideTrips++;
  }

  // the paths kept: the forced and those of step 3 first, then the nearest, up to `paths`
  const kept = new Map();
  for (const point of points)
    kept.set(
      point,
      [...point.out]
        .sort(([, p], [, q]) => Number(q.forced) - Number(p.forced) || p.length - q.length)
        .slice(0, Math.max(mostPaths, [...point.out.values()].filter((path) => path.forced).length)),
    );
  // only the waypoints got to from a place to start that have a way back to one: a bot sent anywhere else
  // would never arrive, or never leave
  const into = new Map(points.map((point) => [point, []]));
  for (const [point, out] of kept) for (const [to] of out) into.get(to).push(point);
  const begin = points.filter((point) => point.kind === "start");
  if (!begin.length && points.length) begin.push(points[0]);
  const reached = (next) => {
    const seen = new Set(begin);
    const list = [...begin];
    for (let at = 0; at < list.length; at++)
      for (const to of next(list[at])) if (!seen.has(to)) seen.add(to), list.push(to);
    return seen;
  };
  const forth = reached((point) => kept.get(point).map(([to]) => to));
  const back = reached((point) => into.get(point));
  const astray = points.filter((point) => !forth.has(point));
  const stuck = points.filter((point) => forth.has(point) && !back.has(point));
  const said = (list) =>
    `${list
      .slice(0, 6)
      .map((point) => `${point.kind} at ${place(point.origin)}`)
      .join("; ")}${list.length > 6 ? "; ..." : ""}`;
  if (astray.length)
    warnings.push(
      `${astray.length} waypoints were left out: no path from a place to start gets to them (${said(astray)})`,
    );
  if (stuck.length)
    warnings.push(
      `${stuck.length} waypoints were left out: no path from them gets back to a place to start, a pit or a one-way place (${said(stuck)})`,
    );
  const onTheWay = points.filter((point) => forth.has(point) && back.has(point));
  // the bot's goals first: RCBot roams to one of the first RCBOT_GOALS waypoints of the file, at random. The
  // waypoints of open floor and the places to start where a player has twice ROOM about him, spread over
  // the map, the farthest from those chosen next (not a doorway, a stair's end or a corner, where a bot that
  // has arrived stands in the way); then the rest, the jumps, ledges, landings, ladders and crouching places
  // last
  const goalKinds = new Set(["floor", "start", "opening", "flight", "corner"]);
  const goalFirst = new Set(["floor", "start"]);
  const worthy = (point) =>
    point.net === stand &&
    goalKinds.has(point.kind) &&
    !(point.flags & (RCW_FLAGS.JUMP | RCW_FLAGS.LADDER)) &&
    jumped.pieceOf.get(point.spot) === undefined;
  const candidates = onTheWay.filter(
    (point) => worthy(point) && goalFirst.has(point.kind) && clearOf(point.spot) >= roomPlaces * 2,
  );
  const goals = [];
  if (candidates.length) {
    const middle = [0, 1, 2].map(
      (axis) => candidates.reduce((sum, point) => sum + point.origin[axis], 0) / candidates.length,
    );
    let next = candidates.reduce((best, point) =>
      distance(point.origin, middle) < distance(best.origin, middle) ? point : best,
    );
    const nearest = new Map(candidates.map((point) => [point, Infinity]));
    while (next && goals.length < RCBOT_GOALS) {
      goals.push(next);
      nearest.delete(next);
      let farthest = null;
      let far = -1;
      for (const [point, was] of nearest) {
        const now = Math.min(was, distance(point.origin, next.origin));
        nearest.set(point, now);
        if (now > far) (far = now), (farthest = point);
      }
      next = farthest;
    }
  }
  const chosen = new Set(goals);
  const final = [
    ...goals,
    ...onTheWay.filter((point) => !chosen.has(point) && worthy(point)),
    ...onTheWay.filter((point) => !chosen.has(point) && !worthy(point)),
  ];
  const index = new Map(final.map((point, number) => [point, number]));
  const waypoints = final.map((point) => {
    const out = kept.get(point).filter(([to]) => index.has(to));
    const ways = out.map(([, path]) => path.why);
    return {
      origin: point.origin,
      // a jump's flag only where a jump is still taken from it
      flags: ways.includes("jump") ? point.flags : point.flags & ~RCW_FLAGS.JUMP,
      kind: point.kind,
      paths: out.map(([to]) => index.get(to)),
      ways,
      tight: out.map(([, path]) => path.tight),
    };
  });

  // ── what was made ──
  const count = (kind) => waypoints.filter((waypoint) => waypoint.kind === kind).length;
  const pathCount = waypoints.reduce((sum, waypoint) => sum + waypoint.paths.length, 0);
  const oneWay = waypoints.reduce(
    (sum, waypoint, number) =>
      sum + waypoint.paths.filter((to) => !waypoints[to].paths.includes(number)).length,
    0,
  );
  const lengths = waypoints.flatMap((waypoint) =>
    waypoint.paths.map((to) => distance(waypoint.origin, waypoints[to].origin)),
  );
  const flagged = (flag) => waypoints.filter((waypoint) => waypoint.flags & flag).length;
  const tight = waypoints.reduce((sum, waypoint) => sum + waypoint.tight.filter(Boolean).length, 0);
  facts.push(
    `${waypoints.length} waypoints on ${Math.round(walked.length * grid.cell * grid.cell)} square units of walked floor, a spacing of ${Math.round(spacing)}: ${count("start")} at places to start, ${flagged(RCW_FLAGS.LADDER)} at ${laddersWaypointed} ladders, ${flagged(RCW_FLAGS.JUMP)} to jump from, ${count("flight")} at the ends of ${flightCount} flights and ramps, ${count("opening")} in ${openingCount} openings, ${count("floor")} on open floor, ${count("corner")} at corners, ${count("ledge")} at the top of ${dropsWaypointed} drops (${mended} jumps and drops added where the paths did not join what the walk does), ${flagged(RCW_FLAGS.CROUCH)} crouching in ${passages} passages, ${count("near")} where the nearest waypoint a bot sees was on another floor`,
  );
  facts.push(
    `${pathCount} paths (${oneWay} one way), ${lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0} units long on the average, at most ${Math.max(0, ...waypoints.map((waypoint) => waypoint.paths.length))} out of one waypoint; ${tight} along which a body only just fits (less than ${ROOM} beside it: no other way joins the two), ${dropsWalked} drops left out where a walk of about their length goes there, ${sideTrips} tops of crates or sills a jump gets onto made side trips${onGiving ? `, ${onGiving} tops of what gives way (a crate that breaks) not waypointed` : ""}`,
  );
  if (goals.length)
    facts.push(
      `the first ${goals.length} waypoints are where the bot roams to (RCBot picks a goal among the first ${RCBOT_GOALS} of the file): places a player stands in room, spread over the map`,
    );
  const outside = waypoints.filter((waypoint) => waypoint.origin.some((value) => value > 4096));
  if (outside.length)
    warnings.push(
      `${outside.length} waypoints are over 4096 on an axis: RCBot takes them as deleted when it loads them`,
    );
  if (lifts)
    warnings.push(
      `${lifts} lifts (func_plat) carry the walk: they are not waypointed, and what only a lift reaches is left out`,
    );
  if (reach.graph.hops.length)
    warnings.push(`${reach.graph.hops.length} teleports are walked into: they are not waypointed`);
  const leftOut = [...astray, ...stuck].map((point) => ({
    origin: point.origin,
    kind: point.kind,
    why: forth.has(point) ? "no way back" : "not got to",
  }));
  return { waypoints, leftOut, facts, warnings, spacing, cell: grid.cell, reach };
}
