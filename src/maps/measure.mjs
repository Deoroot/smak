// A map in numbers, to lay beside another's: how wide its floor is, how high its rooms, how far one sees,
// how much of its footprint is floor. A new map is judged against one the game already has by these, before
// anyone plays it: a map whose middling place is half as wide as the game's own, or whose corridors are
// lower, reads cramped in the game however well it compiles.
//
// HOW A PLACE IS MEASURED. The floor is looked over on a grid (32 units unless told), and at each place of
// it sixteen straight lines are sent out level, 60 over the floor (a little under a standing player's eyes,
// which are at 64), one every 22.5 degrees, each as far as it goes before something solid (`space.sees`,
// found by halving to within a unit; 3000 at the most).
//   width      the narrowest of the eight lines THROUGH the place: a line's run one way and the run the
//              opposite way, added. In a corridor 128 wide it is 128 wherever one stands in it; in a
//              room, its lesser side. It is measured at that height: a low wall a player looks over does
//              not narrow a place, and a pillar does only where a line meets it. In the corner of a room
//              the line that cuts the corner off is short: a room's corners count as narrow floor (on a
//              grid of 32 some seven places a square corner are under 176 wide), the same in every map
//   sight      the longest of the sixteen runs: how far one sees from there, level
//   headroom   from the floor to the first thing solid over it (asked of a point: what a body's head meets)
// Lines sixteen ways miss what lies between them: a width is never under the true one by this, and may be
// over it in a place whose narrowest way lies at a slant between two lines; a sight is never over the true
// longest. The numbers are for one map beside another, measured the same way, more than each for itself.
//
// WHICH FLOOR. Unless told, the floor a player WALKS: what the walk test (reach.mjs) gets to from the places
// to start, every walked floor of a place where several lie one over another. With `every`, every place a
// player fits whether walked to or not: at each place of the grid, each gap between two solids that is a
// body's height or more (72), on a floor that can be stood on (its slant 0.7 or more), and not taller than
// `tallest` (1200: the open shafts about a map are not rooms). That is the measure of the BUILDING, and is
// what to use when the walk test gets to only part of a map (a teleport, a lift, a door a script opens);
// it counts rooms no player enters, and the top of a wall under a ceiling, when such there are.
//
//   measure(map, options)    the numbers of one map: brush source or a compiled map
//   measureTable(list)       several maps' numbers side by side, as lines of text
import { spaceOf, BODIES, isCompiled } from "./space.mjs";
import { reachOf, STEEP } from "./reach.mjs";
import { withMod } from "./mod.mjs";

// ── constants ───────────────────────────────────────────────────────────────
/** The grid the floor is looked over on, in units: a player's own width. */
const GRID = 32;
/**
 * The widths that part the floor into bands, in units: under the first is a corridor, from the last up a
 * hall. 176 and 352 are this kit's own lines and no engine's: five and a half and eleven of a player's
 * widths (32), which on the maps measured so far told the passages from the rooms and the rooms from the
 * halls. A map's own lines may be given.
 */
const BANDS = [176, 352];
/** The length of sight a place is asked whether it sees beyond, in units. */
const SIGHT = 700;
/**
 * The lines are sent out this far over the floor: a little under a standing player's eyes (64: the engine's
 * view offset, 28 over an origin 36 over the floor), and off the heights maps are built at. A line at 64
 * runs along the top of everything 64 high, a height much is built to, and a point on a solid's face is not
 * in it: on one of the game's maps the middling width was 256 measured at 60 and 323 at 64, for benches 64
 * high that a player neither walks through nor, to speak of, sees over.
 */
const EYE = 60;
/** A line is followed this far at the most, and its end is found to within this, in units. */
const FAR = 3000;
const PRECISION = 1;
/** With `every`: a gap taller than this is not a room (the open shaft about a map, a sky box's well). */
const TALLEST = 1200;
/** The ways a line is sent out from a place: sixteen, so eight lines through it. */
const WAYS = 16;
/** A floor is found again this far over itself at the least: what begins nearer is the floor itself. */
const OVER_FLOOR = 8;
/**
 * The lines begin this far off the grid's place, east and north. Maps are built on a grid, and a place of
 * ours lies as often as not in the very plane of a wall's face: a line in that plane touches nothing (a
 * point on a solid's face is not in it), and in brush source it then runs on along the seam between two
 * brushes, out of the map. A fraction of a unit to the side, it meets what a player's eye would.
 */
const OFF_GRID = [0.3, 0.1];
/** A map is not looked over at more places than this: a finer grid would take minutes. */
const PLACES_MOST = 400000;
/** Floors of one place are looked for this many deep at the most. */
const FLOORS_MOST = 64;
/** A height that holds this share of the floor or more is one of the map's levels; so many are listed. */
const LEVEL_SHARE = 0.05;
const LEVELS_MOST = 8;

// ── small arithmetic ────────────────────────────────────────────────────────
/**
 * The value a share of the way up a list: 0.5 is the median. The list as it comes; an empty one gives null.
 * The value at the place `share` of the list's length, counted from 0 and cut down to a whole number.
 */
function partOf(list, share) {
  if (!list.length) return null;
  const sorted = list.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
}
const whole = (value) => (value === null || !Number.isFinite(value) ? null : Math.round(value));
/**
 * The least and the most of a list, one by one: a city's 150,000 places passed as arguments to Math.min
 * overflow the stack.
 */
const leastOf = (list) => list.reduce((least, value) => (value < least ? value : least), Infinity);
const mostOf = (list) => list.reduce((most, value) => (value > most ? value : most), -Infinity);
/** A share to a thousandth. */
const shareOf = (part, all) => (all ? Math.round((part / all) * 1000) / 1000 : 0);
/** The median, the quartiles, the ninth tenth, the least and the most of a list, in whole units. */
const spreadOf = (list) => ({
  median: whole(partOf(list, 0.5)),
  quartiles: [whole(partOf(list, 0.25)), whole(partOf(list, 0.75))],
  p90: whole(partOf(list, 0.9)),
  least: list.length ? whole(leastOf(list)) : null,
  most: list.length ? whole(mostOf(list)) : null,
});
const percent = (share) => `${Math.round(share * 100)} in 100`;
const range = (pair) => `${pair[0]} to ${pair[1]}`;

/** The bands a list of widths parts the floor into: `[{ from, to }]`, the last open above (`to: null`). */
const bandsOf = (limits) =>
  [0, ...limits].map((from, index) => ({ from, to: index < limits.length ? limits[index] : null }));
/** A band as words: "under 176", "176 to 352", "352 and over". */
const bandName = ({ from, to }) =>
  to === null ? `${from} and over` : from === 0 ? `under ${to}` : `${from} to ${to}`;

// ── the places ──────────────────────────────────────────────────────────────
/** The floors of the walk at a place of the grid, the highest first: each walked floor, one under another. */
function walkedFloors(reach, x, y) {
  const floors = [];
  let floor = reach.walked(x, y);
  while (floor !== null && floor !== undefined && floors.length < FLOORS_MOST) {
    floors.push(floor);
    const next = reach.walked(x, y, floor - 1);
    if (next === null || next === undefined || next >= floor) break;
    floor = next;
  }
  return floors;
}

/**
 * The floors a player fits on at a place of the grid, walked to or not, from the solid stretches a point
 * meets there: the top of each stretch that can be stood on, with a body's height or more of air over it
 * and something solid over that, no farther than `tallest`. `probe`: how far under a ceiling the point's
 * stretch begins (see `measure`).
 */
function fittingFloors(stretches, tallest, probe) {
  const floors = [];
  for (let nth = 0; nth + 1 < stretches.length; nth++) {
    const gap = stretches[nth + 1][0] - stretches[nth][1] + probe;
    if (gap >= BODIES.standing.height && gap < tallest && (stretches[nth][2] ?? 1) >= STEEP)
      floors.push(stretches[nth][1]);
  }
  return floors;
}

// ── the measures ────────────────────────────────────────────────────────────
/**
 * The numbers of a map: brush source (`{ worldspawn, brushes, entities }`) or a compiled map (`readBsp`).
 *
 *   every      false (unless told): the floor the walk test gets to. true: every place a player fits,
 *              walked to or not (see above)
 *   grid       the grid the floor is looked over on, in units (32)
 *   bands      the widths that part the floor into bands, rising (`[176, 352]`: under 176, 176 to 352, 352
 *              and over). The first is also what tells a corridor from a room, for the headroom of each
 *   sight      the length a place is asked whether it sees beyond (700)
 *   eye        how far over the floor the lines are sent out (60); `far`: a line is followed this far at the most (3000);
 *              `precision`: and its end found to within this (1)
 *   tallest    with `every`: a gap taller than this is no room (1200)
 *   reach      what `reachOf` gave for this map, when it has been run already. Without it the walk test is
 *              run here, with what it takes: `mod` (a profile), `from`, `exits`, `off`, `open`, `shut`,
 *              `doors`, `jump`, `bodies`, `cell`, `widest` (`reachOf`). `open`, `shut`, `doors` and `off`
 *              are the space's too: a wall taken as not there is none for a line of sight either
 *   places     true: every place measured is handed back too, as `cells: [{ at: [x, y, floor], width, sight,
 *              headroom }]`
 *   name       a name for the map, kept in what comes back (a table's column)
 *
 * It returns {
 *   name, every, grid
 *   world      { min, max, size }: the box of everything solid
 *   places     how many places were measured (a floor of a place of the grid; two floors one over another
 *              are two); `area`: the floor they stand for, in square units (places x grid x grid)
 *   walk       { places, fitting, area }: how many places of the grid the walk test got to, how many a
 *              player fits on walked to or not, and the walk test's own count of the floor it walked
 *   footprint  { min, max, size: [x, y], area, share }: the box about the floor measured, seen from above,
 *              and the share of that box that has floor in it
 *   floors     { lowest, highest, levels: [{ z, share }], stacked: { most, share } }: the heights of the
 *              floor; the heights that each hold a twentieth of it or more, the fullest first; and how
 *              many floors lie one over another at the most (a map's storeys), with the share of the
 *              footprint's places that have more than one
 *   width      { median, quartiles: [low, high], p90, least, most, bands: [{ from, to, name, share }] }
 *   headroom   { median, quartiles, p90, least, most, open (the share of the floor with nothing over it),
 *              corridors: { share, median, quartiles }, rooms: { share, median, quartiles } }: a corridor is
 *              floor narrower than the first of `bands`, a room the rest
 *   sight      { median, quartiles, p90, least, longest, beyond: { length, share } }
 *   openings   { count, widths: [each, rising], median, quartiles, least, heights: { median, quartiles } }:
 *              the narrow places with a wall on both sides that the walk test found (its `openings`: no
 *              wider than its `widest`, 256). They are the walk's, whatever `every` says
 *   warnings, facts   sentences
 * }
 * Lengths are in whole units, shares from 0 to 1.
 */
export function measure(map, options = {}) {
  if (!map || (!isCompiled(map) && !Array.isArray(map.brushes)))
    throw new Error("measure: a compiled map (what `readBsp` gives) or brush source (what `writeMap` takes)");
  // a mod's profile gives its start classes, its ways out and the classes that are switched off (mod.mjs)
  options = withMod(options, map);
  const {
    every = false,
    grid = GRID,
    bands = BANDS,
    sight = SIGHT,
    eye = EYE,
    far = FAR,
    precision = PRECISION,
    tallest = TALLEST,
    reach: given,
    places: wantPlaces = false,
    name,
    ...walk
  } = options;
  if (!(grid >= 1)) throw new Error(`grid: the grid in units, 1 at the least, not ${grid}`);
  if (!Array.isArray(bands) || !bands.length || !bands.every((each, nth) => each > (bands[nth - 1] ?? 0)))
    throw new Error(
      `bands: the widths that part the floor, each over the one before and over 0 ([176, 352]), not ${JSON.stringify(bands)}`,
    );
  for (const [word, value] of Object.entries({ sight, eye, far, precision, tallest }))
    if (!(value > 0)) throw new Error(`${word}: a length in units, over 0, not ${value}`);

  const space = spaceOf(map, {
    ...(walk.doors === undefined ? {} : { doors: walk.doors }),
    open: walk.open,
    shut: walk.shut,
    off: walk.off,
  });
  const columns =
    (Math.floor((space.max[0] - space.min[0]) / grid) + 1) *
    (Math.floor((space.max[1] - space.min[1]) / grid) + 1);
  if (!(columns <= PLACES_MOST))
    throw new Error(
      `grid: ${grid} units over a map ${Math.round(space.max[0] - space.min[0])} by ${Math.round(space.max[1] - space.min[1])} is ${columns} places, and ${PLACES_MOST} is the most: a coarser grid`,
    );
  // the stretches are of where a point's FEET cannot be. In a compiled map the point is a true one; in
  // source it is a probe 2 high (space.mjs), whose feet are stopped that far under a ceiling
  const probe = space.compiled ? 0 : BODIES.point.height;
  const reach = given ?? reachOf(map, walk);
  if (typeof reach?.walked !== "function" || !Array.isArray(reach.openings))
    throw new Error("reach: what `reachOf` gave for this map");
  const warnings = [];
  const facts = [];

  // ── the places: each floor of each place of the grid ──
  const cells = [];
  let walkedPlaces = 0;
  let fittingPlaces = 0;
  for (let x = Math.ceil(space.min[0] / grid) * grid; x <= space.max[0]; x += grid)
    for (let y = Math.ceil(space.min[1] / grid) * grid; y <= space.max[1]; y += grid) {
      const walked = walkedFloors(reach, x, y);
      const stretches = space
        .blocked(x, y, BODIES.point)
        .slice()
        .sort((a, b) => a[0] - b[0]);
      const fitting = fittingFloors(stretches, tallest, probe);
      walkedPlaces += walked.length;
      fittingPlaces += fitting.length;
      for (const floor of every ? fitting : walked) cells.push({ x, y, floor, stretches });
    }
  if (!cells.length)
    throw new Error(
      every
        ? `measure: no place a player fits was found on a grid of ${grid}: the map has no room ${BODIES.standing.height} high between a floor and a ceiling`
        : `measure: the walk test got to no floor${reach.starts?.length ? "" : " (the map has no place to start: `from` says where the walk begins)"}: \`every: true\` measures every place a player fits, walked to or not`,
    );

  // ── each place: its lines, its width, its sight, its headroom ──
  const ways = Array.from({ length: WAYS }, (_, nth) => [
    Math.cos((nth * 2 * Math.PI) / WAYS),
    Math.sin((nth * 2 * Math.PI) / WAYS),
  ]);
  /** How far a level line runs from the eye one way before something solid. */
  const runOf = (from, [dx, dy]) => {
    const at = (length) => [from[0] + dx * length, from[1] + dy * length, from[2]];
    // a compiled map's space finds where the line stops in one walk; brush source's, by halves
    if (space.firstStop) return space.firstStop(from, at(far), precision) ?? far;
    if (space.sees(from, at(far))) return far;
    let near = 0;
    let beyond = far;
    while (beyond - near > precision) {
      const middle = (near + beyond) / 2;
      if (space.sees(from, at(middle))) near = middle;
      else beyond = middle;
    }
    return near;
  };
  for (const cell of cells) {
    const from = [cell.x + OFF_GRID[0], cell.y + OFF_GRID[1], cell.floor + eye];
    const runs = ways.map((way) => runOf(from, way));
    cell.width = Infinity;
    for (let nth = 0; nth < WAYS / 2; nth++)
      cell.width = Math.min(cell.width, runs[nth] + runs[nth + WAYS / 2]);
    cell.sight = Math.max(...runs);
    let ceiling = Infinity;
    for (const [begins] of cell.stretches)
      if (begins > cell.floor + OVER_FLOOR && begins < ceiling) ceiling = begins;
    cell.headroom = ceiling - cell.floor + probe;
    delete cell.stretches;
  }

  // ── the numbers ──
  const widths = cells.map((cell) => cell.width);
  const sights = cells.map((cell) => cell.sight);
  const roofed = cells.filter((cell) => Number.isFinite(cell.headroom));
  const corridors = roofed.filter((cell) => cell.width < bands[0]);
  const rooms = roofed.filter((cell) => cell.width >= bands[0]);
  const heads = (list) => list.map((cell) => cell.headroom);
  const partHeadroom = (list) => ({
    share: shareOf(list.length, roofed.length),
    median: whole(partOf(heads(list), 0.5)),
    quartiles: [whole(partOf(heads(list), 0.25)), whole(partOf(heads(list), 0.75))],
  });
  const xs = cells.map((cell) => cell.x);
  const ys = cells.map((cell) => cell.y);
  const low = [leastOf(xs), leastOf(ys)];
  const high = [mostOf(xs), mostOf(ys)];
  // a place stands for a square of the grid about it: the box about the floor is half a square wider each way
  const size = [high[0] - low[0] + grid, high[1] - low[1] + grid];
  const stacks = new Map();
  for (const cell of cells) stacks.set(`${cell.x} ${cell.y}`, (stacks.get(`${cell.x} ${cell.y}`) ?? 0) + 1);
  const byHeight = new Map();
  for (const cell of cells)
    byHeight.set(Math.round(cell.floor), (byHeight.get(Math.round(cell.floor)) ?? 0) + 1);
  const levels = [...byHeight]
    .filter(([, count]) => count / cells.length >= LEVEL_SHARE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, LEVELS_MOST)
    .map(([z, count]) => ({ z, share: shareOf(count, cells.length) }));
  const openingWidths = reach.openings.map((opening) => opening.width).sort((a, b) => a - b);
  const openingHeights = reach.openings.map((opening) => opening.height).filter(Number.isFinite);

  const result = {
    ...(name === undefined ? {} : { name }),
    every: Boolean(every),
    grid,
    world: {
      min: space.min.map(Math.round),
      max: space.max.map(Math.round),
      size: space.max.map((value, axis) => Math.round(value - space.min[axis])),
    },
    places: cells.length,
    area: cells.length * grid * grid,
    walk: { places: walkedPlaces, fitting: fittingPlaces, area: reach.area ?? null },
    footprint: {
      min: low.map((value) => value - grid / 2),
      max: high.map((value) => value + grid / 2),
      size,
      area: size[0] * size[1],
      share: shareOf(stacks.size * grid * grid, size[0] * size[1]),
    },
    floors: {
      lowest: whole(leastOf(cells.map((cell) => cell.floor))),
      highest: whole(mostOf(cells.map((cell) => cell.floor))),
      levels,
      stacked: {
        most: mostOf([...stacks.values()]),
        share: shareOf([...stacks.values()].filter((count) => count > 1).length, stacks.size),
      },
    },
    width: {
      ...spreadOf(widths),
      bands: bandsOf(bands).map((band) => ({
        ...band,
        name: bandName(band),
        share: shareOf(
          widths.filter((width) => width >= band.from && (band.to === null || width < band.to)).length,
          widths.length,
        ),
      })),
    },
    headroom: {
      ...spreadOf(heads(roofed)),
      open: shareOf(cells.length - roofed.length, cells.length),
      corridors: partHeadroom(corridors),
      rooms: partHeadroom(rooms),
    },
    sight: (({ most, ...spread }) => ({
      ...spread,
      longest: most,
      beyond: { length: sight, share: shareOf(sights.filter((each) => each > sight).length, sights.length) },
    }))(spreadOf(sights)),
    openings: {
      count: openingWidths.length,
      widths: openingWidths,
      median: whole(partOf(openingWidths, 0.5)),
      quartiles: [whole(partOf(openingWidths, 0.25)), whole(partOf(openingWidths, 0.75))],
      least: openingWidths.length ? openingWidths[0] : null,
      heights: {
        median: whole(partOf(openingHeights, 0.5)),
        quartiles: [whole(partOf(openingHeights, 0.25)), whole(partOf(openingHeights, 0.75))],
      },
    },
    ...(wantPlaces
      ? {
          cells: cells.map((cell) => ({
            at: [cell.x, cell.y, cell.floor],
            width: whole(cell.width),
            sight: whole(cell.sight),
            headroom: whole(cell.headroom),
          })),
        }
      : {}),
    warnings,
    facts,
  };

  // ── in sentences ──
  const { footprint, floors, width, headroom, openings } = result;
  facts.push(
    every
      ? `${result.places} places measured on a grid of ${grid}: every place a player fits, walked to or not (${result.area} square units of floor); the walk test got to ${walkedPlaces} places`
      : `${result.places} places measured on a grid of ${grid}: the floor the walk test got to (${result.area} square units); a player fits on ${fittingPlaces} places, walked to or not`,
  );
  facts.push(
    `the world is ${result.world.size.join(" x ")}; the floor measured lies in a box ${size.join(" x ")} seen from above, and ${percent(footprint.share)} of that box has floor in it`,
  );
  facts.push(
    `floors from ${floors.lowest} to ${floors.highest}${levels.length ? `; the fullest heights: ${levels.map((level) => `${level.z} (${percent(level.share)})`).join(", ")}` : ""}; ${floors.stacked.most === 1 ? "no floor lies over another" : `${floors.stacked.most} floors lie one over another at the most, and ${percent(floors.stacked.share)} of the places have more than one`}`,
  );
  facts.push(
    `width (the narrowest of ${WAYS / 2} lines through a place, ${eye} over its floor): median ${width.median}, quartiles ${range(width.quartiles)}, nine tenths under ${width.p90}; ${width.bands.map((band) => `${band.name} wide ${percent(band.share)}`).join(", ")}`,
  );
  facts.push(
    `headroom: median ${headroom.median}, quartiles ${range(headroom.quartiles)}, most ${headroom.most}${headroom.open ? `; ${percent(headroom.open)} of the floor has nothing over it` : ""}${corridors.length ? `; in corridors (under ${bands[0]} wide) median ${headroom.corridors.median}, ${range(headroom.corridors.quartiles)}` : ""}${rooms.length ? `; in rooms (${bands[0]} wide or more) median ${headroom.rooms.median}, ${range(headroom.rooms.quartiles)}` : ""}`,
  );
  facts.push(
    `sight (the longest of ${WAYS} level lines from a place): median ${result.sight.median}, quartiles ${range(result.sight.quartiles)}, nine tenths under ${result.sight.p90}, the longest ${result.sight.longest}${result.sight.longest >= far ? ` (no line is followed farther: \`far\`)` : ""}; ${percent(result.sight.beyond.share)} of the places see beyond ${sight}`,
  );
  facts.push(
    openings.count
      ? `${openings.count} openings (narrow places with a wall on both sides, of the walked floor): widths ${openings.widths.join(" ")}; median ${openings.median}, the least ${openings.least}${openings.heights.median === null ? "" : `; heights median ${openings.heights.median}, ${range(openings.heights.quartiles)}`}`
      : "the walk test found no opening (a narrow place with a wall on both sides)",
  );
  if (!every && fittingPlaces > 0 && walkedPlaces < fittingPlaces / 2)
    warnings.push(
      `the walk test got to ${walkedPlaces} of the ${fittingPlaces} places a player fits on: these are the numbers of that part of the map only. \`every\` (--every) measures all of it; the walk test (\`reachOf\`, map-reach) says what it did not get to and why`,
    );
  return result;
}

// ── several maps side by side ───────────────────────────────────────────────
/**
 * Several maps' numbers side by side: `list` is what `measure` gave for each (its `name` heads its column),
 * and what comes back is lines of text, a measure a line, a map a column. Lengths in units, shares in 100.
 * Maps measured with different `bands` have the bands of the first; one measured on another floor (`every`)
 * or another grid says so in its own lines.
 */
export function measureTable(list) {
  if (!Array.isArray(list) || !list.length || !list.every((each) => each?.width?.bands && each.sight))
    throw new Error("measureTable: a list of what `measure` gave, one for each map");
  const share = (value) => `${Math.round(value * 100)}%`;
  const pair = (values) => (values[0] === null ? "-" : `${values[0]}..${values[1]}`);
  const or = (value) => (value === null || value === undefined ? "-" : String(value));
  const first = list[0];
  const rows = [
    ["", (each, nth) => each.name ?? `map ${nth + 1}`],
    ["floor measured", (each) => (each.every ? "every place" : "walked")],
    ["places (grid)", (each) => `${each.places} (${each.grid})`],
    ["floor, square units", (each) => or(each.area)],
    ["world", (each) => each.world.size.join(" x ")],
    ["footprint of the floor", (each) => each.footprint.size.join(" x ")],
    ["floor's share of it", (each) => share(each.footprint.share)],
    ["floors from..to", (each) => `${each.floors.lowest}..${each.floors.highest}`],
    ["floors one over another", (each) => or(each.floors.stacked.most)],
    ["width, median", (each) => or(each.width.median)],
    ["width, quartiles", (each) => pair(each.width.quartiles)],
    ...first.width.bands.map((band, nth) => [
      `${band.name} wide`,
      (each) => (each.width.bands[nth] ? share(each.width.bands[nth].share) : "-"),
    ]),
    ["headroom, median", (each) => or(each.headroom.median)],
    ["headroom, quartiles", (each) => pair(each.headroom.quartiles)],
    ["headroom in corridors", (each) => or(each.headroom.corridors.median)],
    ["headroom in rooms", (each) => or(each.headroom.rooms.median)],
    ["sight, median", (each) => or(each.sight.median)],
    ["sight, nine tenths under", (each) => or(each.sight.p90)],
    ["sight, longest", (each) => or(each.sight.longest)],
    [`seeing beyond ${first.sight.beyond.length}`, (each) => share(each.sight.beyond.share)],
    ["openings", (each) => or(each.openings.count)],
    ["openings' width, median", (each) => or(each.openings.median)],
    ["openings' width, least", (each) => or(each.openings.least)],
    ["openings' height, median", (each) => or(each.openings.heights.median)],
  ];
  const told = rows.map(([words, of]) => [words, ...list.map((each, nth) => of(each, nth))]);
  const wide = told[0].map((_, column) => Math.max(...told.map((row) => row[column].length)));
  return told.map((row) =>
    row
      .map((word, column) => (column === 0 ? word.padEnd(wide[0]) : word.padStart(wide[column])))
      .join("  ")
      .trimEnd(),
  );
}
