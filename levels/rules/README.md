# The architecture rulebook (`smak-architecture-rules/1`)

There is no architect on the project. A generator left to itself puts a crate across a doorway, a lamp in a
stair's headroom, a bedroom you reach only through another. `architecture.json` writes down the rules an architect
carries in their head, so a layout is sound without one. PLAN.md, Phase 3, "The architecture rulebook".

One rulebook serves both description formats (the city, `smak-city-description/1`, and the dungeon,
`smak-level-description/1`) and every adapter. The generator reads it at stage 3 (building programs), stage 5
(floor plans), stage 8 (dressing) and stage 9 (forms: its `forms` section). The built checks of stage 12 use the same
helpers on the compiled level.

```js
import { loadRules, rulesFor, tighten, doorFits, stairFits, ceilingFits, keepClearOf, overlapsKeepClear,
  roomProgramOk, circulationOk } from "./levels/lib/architecture-rules.mjs";
const rules = loadRules();                 // validated; throws listing every error by field
const goldsrc = rulesFor("goldsrc", rules); // lengths in units, areas in square units, grades unchanged
const { rules: mine, errors } = tighten(rules, description.architecture ?? {});
doorFits({ id: "d1", kind: "shop", width: 1.5, height: 2.5 }, rules); // { ok, failures: [sentences] }
```

Tests: `test/123-architecture-rules.mjs`.

## What it holds

| section | what |
| --- | --- |
| `scale` | the game-scale factors and why: widths x1.6, opening heights x1.2, ceilings x1.5, areas x2.56 |
| `hull` | each engine's player hull in its units and its metres a unit; the clearance every passable minimum keeps |
| `dimensions` | doors by kind (house, interior, shop, public, cell, gate, secret, crawl, opening, lift), corridors (domestic, public, service, dungeon, coop, alley, catwalk), stairs (rise, run, pitch, width by kind, headroom, risers and rise a flight, landings), ramps (walk, vehicle), ceilings by class, windows, lift cars and landings, walls, balconies, parapets round terraces; squares (the widest open span, the span past which a square is framed, the smallest floor), porticoes (depth, height, column, pitch), monuments (the floor kept round them, their share of a square), towers (the crown's clearance under its layer's top, the most brushes a shell takes). Each with min and typical, and its source |
| `zones` | how private a room is (public 0, staff, home and circulation 1, private 2, secure 3) |
| `roomKinds` | every room kind the city uses: zone, ceiling class, the smallest area and narrow side, clutter class, the real size it scales from |
| `roomNeeds` | rooms that need a street door, a window, or no window at all; `anyOutsideWall`: a street room whose door may stand on any outside wall (a loading bay's vehicle gate) |
| `homes` | the room kinds of a home of 1, 2, 3, 4 or 10 rooms |
| `programs` | per building type (the city's 12, plus `dungeon`): required rooms and counts, `oneOf` groups, optional rooms, waivers (a terrace needs no lobby), entrance rooms, adjacency (`next`, `notNext`), Alexander's patterns; and the generator's rules a type carries, each with its reason: `entranceRank` (a hut's one room is its entrance), `homesOver` (a double-shop's flats over it), `cellsPerStorey` (the MSR's cell blocks) |
| `spaceKinds` | the dungeon's space types (room, corridor, hall, cave, yard, stair): ceilings and sizes, and the door kind each link type takes |
| `circulation` | every room reached; private rooms passed through only for listed pairs (an en suite), and the pairs a generator never lays itself (`privateThroughNotGenerated`); rooms nobody passes through (`noPassThrough`); entrance rank; corridor runs and dead ends; stairs a storey, and the loggia that keeps a storey on one (`stairs.loggia`); `axial`: stairs, grand stairs, bridges and hallways along the streets' and plazas' axes, turning at a landing or a corner, never a diagonal leg over a street or plaza (a secret way exempt); a dungeon's dead ends rewarded |
| `keepClear` | the volumes nothing may enter: a door's opening, its approach both sides and its swing; openings; windows; a stair's flight, landings, headroom and approaches; round and under lights; in front of switches and signs; lift cars and landings; spawn points |
| `forms` | the mega-structure's forms of stage 9 (levels/notes-megastructure.md): deck piers (pitch, width by ACI 318's short column, projection, capital), their feet in the layer below, girders (span/12 in game height by ACI 318's beam depths, the clearance under them, haunches), the frame's cover of the ways under the deck, two scales, trusses (span/10), coffers, hung services, the fusion band by wealth (full, partial, gap) and density, the deck's edge (fascia, brackets, edge piers), oculi (size, guards, at most 6 in a city), the spine's drum; the facade family's (forms-facade.mjs): `facade` (M8 a front unbroken at most 4 cells in the ground storey and 8 above, by Gehl x1.6; M9 relief: trims 16 units, 48 a storey, a major element 2.9 m a lot), `facadeThemes` (patterns, rooflines by ceiling and corner pieces by wealth), `pilaster`, `buttress`, `balcony`, `gallery`, `bay`, `cage`, `setback` (tiers on one rock base, carve heights only), `corner` (M10), `wallServices`, `dome` (over a named room, Hagia Sophia), `towerCrown`, `roofline`, `capital` (gold, no bases), `massing` (M11), `skyline` (M12), `landmark` (M13); `maxBrushesBy` (M18) and `maxRockShare` (M19). Each entry with its source and note; lengths in metres, ratios, counts and shares as they are |
| `placement` | props against walls facing in, freestanding only by kind in big rooms, a clear walk between doors, never across an opening, the floor share props may cover by room class. A prop no rule places is not placed |

## The scale, and why

Game scale is larger than real. The hull is 0.81 m wide (32 units) where a person is about 0.50 m across the
shoulders, and a 90-degree camera makes real rooms read cramped. So widths and plans take the hull's ratio, **1.6**.
The measured games agree: their doors are 1.42 to 1.80 m wide (the three RP cities; L4D2 1.40 to 1.52 m), 1.63 times
a real 0.90 m door at the median. Heights grow less, because the hull is only a little taller than a person (1.83 m
against about 1.75 m). Openings take **1.2** (the games' doors are 2.39 to 2.84 m high against a real 2.10 m), and
ceilings take **1.5** (the RP cities' roofed headroom is 4.06 to 4.37 m against a real 2.6 to 2.7 m). Areas take
1.6 squared, 2.56. Where a code and a game disagree, the game's number wins and the code stays as the ratio. A stair
keeps the code's 0.20 m rise (also the games' commonest riser), and its pitch is no steeper than 0.75.

## The hull per engine

| engine | unit | standing | ducked | step | source |
| --- | --- | --- | --- | --- | --- |
| goldsrc (and Xash) | 0.0254 m (SMAK's `UNIT_M`) | 32 x 32 x 72 | 36 | 18 | Half-Life SDK |
| sbox | 0.0254 m (s&box lengths are inches) | radius 16, height 72 | 36 | 18 | rpg_sbox's scenes: PlayerController, MoveModeWalk, NavMesh |

The s&box hull was read from rpg_sbox's scene files, not from the citizen controller's code. Confirm it at the
dungeon's first build. Its +use reach is a TODO.

Every passable minimum is at least the hull plus 0.1 m a side and 0.15 m overhead. The validator enforces this for
every engine listed, so a new engine with a bigger hull makes the rulebook fail until its minima are raised.

## Sources

Real references set the proportions and keep the numbers sane:

- Neufert, *Architects' Data*: room, furniture and circulation sizes.
- The IBC and IRC 2021: doors, stairs, headroom, landings, ramps, corridors, dead ends.
- UK Approved Document K: stair pitch, 2R + G, 16 risers a flight.
- Blondel's step rule.
- The ADA Standards: door manoeuvring space, reach.
- EN 81-20/70: lift cars and landings.
- ASR A1.2: office floor area.
- The CPT: cell sizes.
- Zeno's law: street width.
- Vitruvius, *De architectura*: the eustyle (a column's spacing) and a forum's colonnades.
- The Forum of Constantine: a round colonnaded forum on the Mese with its porphyry column, the reference for New
  Byzantium's Nexus Forum.

Alexander's *A Pattern Language* supplies the programs and adjacency, cited by number:

- 127, intimacy gradient
- 119, arcades
- 132, short passages
- 139, farmhouse kitchen
- 159, light on two sides
- 165, opening to the street
- 167, six-foot balcony
- 190, ceiling height variety
- 196, corner doors

The game numbers come from SMAK's own measures: `levels/notes-rp-city.md` and `levels/styles/*.json`. Each entry's
`source` names its sources; `"judged"` marks a judgement with no written source, which the first build's walk test
should revise.

## How a description tightens it

A description may tighten a rule; it can never loosen one. `tighten(rules, override)` lays an object of the same
shape over the rulebook:

- a key named `min` or `min…` may only go up;
- a key named `max` or `max…` may only go down, and so may every number under such a key, such as the shares
  under `maxCoveredShare`;
- `typical…` may move freely within its range;
- counts under `required` may only go up;
- allowance lists (`privateThroughAllowed`, `optional`, `entrance`, `kinds`, `waive`) may only get shorter;
- demand lists (`adjacency`, `oneOf`, `street`, `window`, `noWindow`, `neverAcross`) may only get longer;
- `true` stays true;
- new keys (a room kind, a door kind, a program) may be added;
- notes and sources are free;
- every other number or string is fixed.

Each refusal is a sentence naming the field. The merged rulebook is validated again. For example:

```json
{ "dimensions": { "doors": { "house": { "width": { "min": 1.42 } } } },
  "circulation": { "corridor": { "maxRun": 20 } },
  "programs": { "shop": { "required": { "shop-floor": 1, "backroom": 1, "storeroom": 1 } } } }
```

## The checks

Every check returns `{ ok, failures }`. Each failure is a sentence that names the thing and the number it wanted, in
the rules' units: metres, or engine units after `rulesFor`.

| helper | holds |
| --- | --- |
| `doorFits(door)` | clear width and height against the kind's minima |
| `stairFits(stair)` | rise range, the hull's step, run, pitch, width by kind, headroom, risers and rise a flight, landing depth |
| `ceilingFits(room)` | clear height against the room or space kind's ceiling class |
| `keepClearOf(item)` | the keep-clear boxes of a door, opening, window, stair, light, switch, sign, lift or spawn |
| `overlapsKeepClear(prop, items)` | a prop's box against all of them (touching is allowed) |
| `roomProgramOk(building, rooms)` | required rooms and `oneOf`, no kind outside the program, waivers, each sized room's area and side, rooms within footprint x storeys, homes against their rooms' minima |
| `circulationOk(graph)` | reach (drops one way); no room only through a private one unless the pair is allowed; no link between homes; the entrance's zone and kind; adjacency; street, window and no-window needs; corridor runs and dead ends; a dungeon's dead ends rewarded; stairs between storeys, two past the area rule |
