# Level measures of GoldSrc games: Half-Life, The Specialists, Master Sword Rebirth

What Phase 3's level checks are held against (PLAN.md, "Phase 3"): numbers taken from the games' own
compiled maps, banded per game. Made by `levels/tools/survey-goldsrc.mjs`, with the measuring in
`levels/lib/goldsrc-level-measures.mjs`. The corpora are `levels/corpus/levels-hl.json`, `levels-ts.json`
and `levels-msr.json`.

**Measures and bands only.** The maps are read where the games have them. Nothing of a map is copied: the
corpus holds each map's name and its numbers, no geometry, entity, texture or file.

```
node levels/tools/survey-goldsrc.mjs --game hl|ts|msr [--root <folder>] [--jobs 4] [--most 120] [--only a,b] [--out file]
```

## Units and bands

- Lengths are in Hammer units. The corpus gives each length band three ways: `units`, `m` (1 unit =
  0.0254 m) and `ph`, player heights (a standing player is 72 units, 1.83 m). Areas are in m².
- A band is `n, median, q1, q3, p5, p95` (linear interpolation between ranks). **A map is one vote.**
  - `ofMaps` bands each map's own median, or its single value: "the middling map's corridors are this wide".
  - `pooled` (width, sight, headroom only) bands every measured place of every map, each place weighted
    1 / (that map's places), so each map adds up to one. Its p5 and p95 are the narrowest and widest floor
    the game builds, without the big maps outvoting the small ones.
- `bands` at the top of a corpus is the headline set of groups (`headline`). `groups` bands each group
  alone. `maps` holds every map's own record.

## The walk everything stands on

Every measure is of the floor **a player walks to**, not of every space in the file. The kit's walk test
(`reachOf`, src/maps/reach.mjs) floods the map from its places to start (`info_player_start`,
`info_player_deathmatch`, Master Sword's `ms_player_begin` and `ms_player_spawn`) on a grid of 8 units
(coarser for a very large map: the record's `walkCell`). A campaign level with no place to start (it is
entered only by a changelevel) is walked from its `info_landmark` points instead (`walkFrom:
"landmarks"`); one with neither, from the floor under the middle of each way out (`walkFrom: "ways out"`:
MSR's nightmare_thornlands). The walk goes up steps of 18, down any drop, through teleports
and up ladders, doors taken as open, breakables as walls, no jumping.

**Lifts are ridden** (`liftsOf`, the record's `lifts`). The kit's walk rides a `func_plat` as a ladder in
its shaft. Besides it, the survey hands the walk as lifts: `func_platrot`; a `func_door` that moves straight
up or down (pitch -90/90 or angle -1/-2) whose panel is a floor (48 or more wide both ways, no taller than
its lesser side), travelling its height less 2 and its lip; and a `func_train` whose path_corners differ in
height and stay within 16 across, its brush a floor the same way, taken as built at its first corner and
moved by the corners' differences. A door or train is given as a plat over the whole height its brush
sweeps, and only when it **serves floors at both ends**: at its lowest and highest, its top (or, for a car,
its bottom) has a standing player's room over its middle and a floor within a step beside it (the map's
own player hull, 24 out). Scripted scenery that moves up and down (c1a3c's falling blades and slab, c3a1's
dropping blocks, the crushers) fails that and stays as it was. The crossing and span floods ride the lifts
too (a lift's ways at the height ridden plus a cell); they still ride no teleport or ladder. Floor not walked to (a room behind a
scripted door, a lift's top) is not measured; `reachedShare` is the share of the floor a standing player
fits on that the walk reached (the tops of walls and crates count as floor there, so a map walked whole
still comes under 1).

## The measures, exactly

From the kit's `measure` (src/maps/measure.mjs), on a grid of 32 over the walked floor; at each place,
sixteen level lines 60 units over the floor:

- **width**: the narrowest of the eight lines through the place (a run one way plus the run the opposite
  way). In a corridor 128 wide it is 128 everywhere in it; in a room, its lesser side. Room corners read
  narrow (the line cutting the corner is short), the same in every map. Record: `width` {median, q1, q3,
  p5, p95} of the map's places.
- **narrowShare**: the share of the places under 144 wide (two player heights): corridor-like floor.
  `wideShare`: 288 and over (four player heights). `kitNarrowShare`: under 176, the kit's own corridor
  line (measure.mjs), for comparison with `map-character` and MAPS-DESIGN.md.
- **sight**: the longest of the sixteen lines, at most 3000. `sightBeyond700`: the share of places that see
  farther than 700.
- **headroom**: from the floor up to the first solid over the place's point (measure.mjs). The kit stops
  at the sky brush as at any solid, so here each place is also asked what lies just over where its
  headroom ends (`contentsAt`, 1, 4 and 12 units up): the sky's contents there means **open sky**. Those
  places are left out of the headroom bands; `openSky` is their share and `skyHeight` the floor-to-sky
  height (how high the sky box is built over the ground). `headroomNarrow` and `headroomOpen` part the
  roofed headroom by width (under 144 / 144 and over).
- **passages**: the walk test's own `openings`, narrow places with a wall on both sides and room on either
  side (no wider than 256): their widths. A doorway without a door, a gap, a hatch.

Added here, from the walk's graph (`graph: true`):

- **area**: the walked floor in square units, the walk's own count (spots x cell²). In m² in the bands.
  A floor over another counts twice.
- **steps** (`stepRise`, `stepRiseCommon`): a riser is a rise of 4 to 18 units between two places 8 apart,
  both on level floor (normal z 0.99 or more), with level floor before it and after it along the same
  axis. That last test throws out ramps, and the floor of a body's box sliding over a slope's edge.
  Per map: `rise` (median and quartiles of all risers) and `commonRise` (the most frequent). A tread under
  8 deep (two risers within one step of the grid) is missed.
- **stair flights** (`stairFlights`, `stairFlightRise`): the places that touch a riser, joined where they
  are level neighbours; a group rising 32 or more in all is a flight, and its rise is its top less its
  bottom. A landing with a step on it joins two flights into one.
- **floor levels** (`floorLevels`): heights of 32 units (rounded) holding 2% of the walked floor or more:
  map-character's rule (src/maps/character.mjs), here on walked floor instead of floor faces. `floorRange`:
  highest walked floor less the lowest; `floorRange90`: the 95th less the 5th hundredth, which drops a pit
  or a tower top. `storeys`: the most floors one over another at one place (measure.mjs).
- **doors** (`doorOpenings`, `doorWidth`, `doorHeight`): every `func_door` / `func_door_rotating`, sized
  from its brush model's box (made absolute by the entity's origin). A panel counts as a doorway's when it
  stands 64 or more high, is 24 or more wide and is no thicker than a third of its width or 32: lifts,
  platforms, crushers and hatches in a floor fail. Panels touching side by side (within 8, the same height
  band, thin along the same axis) are joined: a double door is one opening. The width is the panel's long
  side, so it includes the part hidden in the frame: the gap a player passes is that or a little less.
- **crossing**: the walked path through the level, by single-start floods on foot (the kit's own flood,
  no teleports or ladder shafts). The ways out are `trigger_changelevel` and, for Master Sword,
  `msarea_transition`, one per destination (`map` / `destmap`; where a destination has several triggers,
  the one nearest the start). Which crossing a map gets is in `crossing.to`:
  - `exit-to-exit`: two or more ways out reached: the **longest walk between two of them**. A campaign
    level is entered by one changelevel and left by another, and a Master Sword map puts a place to start
    beside every arrival, so "from the start" there would be zero.
  - `exit-to-farthest`: one way out reached (the others behind a lift, a train or a teleport): the walk
    from it to the farthest walked floor. The level is entered or left there; a start is often put right
    beside the changelevel the player arrives by, so "start to exit" would be near zero.
  - `farthest`: no way out reached (arenas): the walk from the chosen start (`info_player_start`, else
    `ms_player_begin`, else the first) to the farthest walked floor.
  `crossingExitToExit` bands only the maps whose crossing is exit-to-exit; `crossingFromExit` those whose
  crossing begins at a way out (either of the first two). `crossing.straight` is the
  straight line between the two ends; `crossingRatio` = walk / straight (1 is a straight run, 2 a walk
  twice the distance).
- **span**: the longest walk across the walked floor, by two sweeps: a flood from the first start finds the
  farthest floor A, a flood from A finds the farthest floor B, and the walk A to B is the span. It ignores
  where the starts and exits are, so arenas and campaign maps can be set side by side. These floods are on
  foot only (no teleports, no ladder shafts), so a map whose halves are joined only by those has a span of
  its larger half.
- **loops** (`loops256`, `loops512`, `mapsWithLoop512`): the walked floor is cut into square tiles (256 or
  512 units); in each tile the parts joined by level steps are regions; regions joined across a tile's
  edge are linked. The independent cycles of that graph (links - regions + parts) less the trivial ones
  (four regions joined in a ring round one corner of four tiles: filled floor) count the ways round
  something at least about a tile across: a block, a courtyard, a stair up and a bridge over. Pillars and
  furniture smaller than a tile do not count. Drops, ladders, teleports and jumps are left out: a loop
  here can be walked both ways. It is a count of cycles, not a judgement that they matter in play; 512 is
  the one to read for "has alternative routes", 256 also counts ways round a large room's central block.

## What was read, and how long it took

| corpus | maps measured | failed | skipped | run (wall clock, 4 jobs) |
| --- | --- | --- | --- | --- |
| `levels-hl.json` | 235 (valve 115: 103 campaign + 12 deathmatch; cstrike 25; msc 95) | 1 | 4 | 18 min (3 jobs) |
| `levels-ts.json` | 29 | 0 | 0 | 5.5 min (8 maps with lifts re-measured, `--merge`) |
| `levels-msr.json` | 86 | 0 | 8 | 16 min (10 maps re-measured, `--merge`) |
| `levels-tsrp.json` | 3 (The Specialists' role-play cities, `--game tsrp`, with `--city`: see notes-rp-city.md) | 0 | 0 | 70 s (2 jobs) |

- No game had more than `--most` (120) maps in a group, so **nothing was sampled**: every map was read.
- **No pak held a map.** Steam's Half-Life ships loose `.bsp` files; MSR's `scripts.pak` holds scripts and
  `extras.pk3` no map. The tool lists any `maps/*.bsp` in a `.pak` beside a game (`pakMaps`) but does not
  read from it.
- The headline of `levels-hl.json` is Half-Life itself (valve: campaign and deathmatch). cstrike (Counter-
  Strike 1.6) and msc (Master Sword Classic) are groups beside it. Not read: `msr/` and `ts/` under
  Half-Life (the same games, surveyed from their own installs), `czero_downloads/` and `ts_downloads/`
  (maps fetched from servers, not the games' own), czero (no loose maps).
- Skipped by name: old copies kept beside the new (`*_old`, `old_helena`) and `test_scripts`.
- **Failed, then fixed**: `ms_underworldv2` (msc and msr): six brush models' clip hulls point one past the
  last clip node (the compiler left those hulls out). `repairedOf` takes such a hull as empty, as a model
  compiled with no clip hull is (`clipHullsRepaired` in the record), and the map measures (reached 0.45,
  width 383). `nightmare_thornlands` (msr) has no start and no landmark; it is now walked from its one way
  out (an `msarea_transition`): reached 0.79, width 729, crossing 11 128.
- **Still failed**: msc's older `nightmare_thornlands` has no start, no landmark and no way out at all: there
  is nowhere to begin the walk.
- Per map: 1 to 20 s for most; the largest outdoor maps take 2 to 5 minutes (MSR's idemarks_tower 289 s,
  oceancrossing 270 s). The default limit is 240 s a map (`--timeout`); the corpora were made with 900.

## Headline medians (of maps)

Each cell is the median map's own median (or value): units / metres / player heights.

| set | floor width | headroom (roofed) | sight | crossing | walked area | narrow share | open sky share |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Half-Life (valve, 115) | 285 / 7.24 m / 3.96 | 232 / 5.89 m / 3.22 | 876 / 22.3 m / 12.2 | 3414 / 87 m / 47 | 1697 m² | 8% | 0 |
| - campaign (103) | 285 / 7.24 m / 3.96 | 240 / 6.10 m / 3.33 | 876 / 22.3 m / 12.2 | 3239 / 82 m / 45 | 1467 m² | 7% | 0 |
| - deathmatch (12) | 283 / 7.19 m / 3.93 | 192 / 4.88 m / 2.67 | 878 / 22.3 m / 12.2 | 4159 / 106 m / 58 | 3204 m² | 14% | 10% |
| Counter-Strike (25) | 337 / 8.56 m / 4.68 | 176 / 4.47 m / 2.44 | 1108 / 28.1 m / 15.4 | 6625 / 168 m / 92 | 5012 m² | 11% | 53% |
| Master Sword Classic (95) | 481 / 12.2 m / 6.68 | 256 / 6.50 m / 3.56 | 1321 / 33.6 m / 18.3 | 5851 / 149 m / 81 | 4638 m² | 4% | 45% |
| The Specialists (29) | 338 / 8.59 m / 4.69 | 208 / 5.28 m / 2.89 | 1143 / 29.0 m / 15.9 | 6275 / 159 m / 87 | 5467 m² | 6% | 20% |
| Master Sword Rebirth (84) | 444 / 11.3 m / 6.17 | 256 / 6.50 m / 3.56 | 1281 / 32.5 m / 17.8 | 6237 / 158 m / 87 | 5136 m² | 5% | 46% |

More, from the same bands (the median map, in units):

| set | step rise (commonest) | floor levels | floor range | door w x h | passage width | loops (512) | maps with a loop | crossing / straight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Half-Life | 8 | 5 | 608 | 96 x 108 | 96 | 0 | 35% | 1.71 |
| - deathmatch | 8 | 9 | 600 | 128 x 120 | 100 | 2 | 83% | 2.46 |
| Counter-Strike | 16 | 7 | 500 | 64 x 96 | 112 | 5 | 96% | 1.78 |
| The Specialists | 16 | 6 | 525 | 96 x 96 | 128 | 4 | 93% | 2.41 |
| Master Sword Rebirth | 16 | 6 | 1084 | 100 x 128 | 108 | 0 | 45% | 1.58 |

The pooled bands (every place, each map one vote) give the extremes a builder works within. Width p5 to
p95: Half-Life 118 to 1615, The Specialists 141 to 1698, MSR 127 to 1401. Roofed headroom p5: 108 to 128 in
every game: the low corridor a game builds (1.5 to 1.8 player heights).

## Surprises, and what to watch when reading these numbers

- **Corridors are rarer than they feel.** Under 144 wide is only 4 to 14% of the walked floor in every game
  (the median map). The places a player remembers as corridors are mostly 144 to 288 wide. Half-Life's
  narrowest common floor (pooled p5) is 118: a corridor of 1.6 player heights. The walk test's `passages`
  (true gaps between walls) are 96 to 128 wide in every game.
- **Half-Life's campaign is small, low and linear by these measures.** A median level has 1467 m² of
  walked floor (a third of the multiplayer games'), a crossing of about 80 m, no loop at 512 in 71% of
  levels, and 4 floor levels. It is cut into short pieces joined by changelevels.
- **Only 56% of campaign levels reach any way out on foot**, and only 15 reach two. Breakables are walls.
  So `reachedShare` is low (median 0.61) and many campaign crossings are `exit-to-farthest` or `farthest`.
  The crossing is a floor, not the level's whole length. **Riding the lifts changed this little**: of
  Half-Life's 33 up/down doors and 30 elevator-like trains, 2 and 2 serve floors at both ends; the rest are
  scenery or crushers, or a lift whose other end is in the next map (c1a3a's lift rides up to a
  changelevel: its top has no floor in this map, so it is not taken). Six maps of the 235 changed: c1a0b
  (its platrot: reached 0.22 to 0.49, crossing 2002 exit-to-farthest to 3447 exit-to-exit), c1a3a (0.66 to
  0.68), msc/fmines (0.615 to 0.626), and the crossings of c1a3d, stalkyard and as_oilrig, which a lift
  shortens (as_oilrig's farthest walk 9362 to 7700). MSR: undermines (0.778 to 0.780); TS: ts_dietrich's
  crossing (7779 to 7589). No band's median moved by more than 1% (valve_sp crossing 3221 to 3239, msc
  5888 to 5851).
- **Counter-Strike and The Specialists are loop machines.** 96% and 93% of maps have a cycle at 512 (a
  median of 5 and 4). Half-Life deathmatch: 83%. Master Sword is the other way: under half its maps have
  one, and its crossings are near straight (ratio 1.56 to 1.58): long roads.
- **Master Sword is wide and tall.** Median floor width is 444 to 481 against Half-Life's 285, and floor
  range is about 1000 (terrain, cliffs). Its roofed headroom (256) is no higher than Half-Life's; the
  tall feel is the sky, 800 up.
- **Sky height is generous.** Where a place is under open sky, the sky brush is 600 (CS) to 800 (MSR)
  units up at the median, and 1650 in Half-Life's outdoor campaign levels. Counter-Strike's roofed
  headroom (176, 2.4 player heights) is the lowest of all: its interiors are tight, its streets open.
- **Steps are 8 or 16 high.** Half-Life's commonest riser is 8; Counter-Strike's, TS's and Master
  Sword's are 16. Stair flights rise 32 to 56 at the median: short flights of 2 to 6 steps. Long flights
  are rare, and a long ramp counts as no step.
- **Doors are 64 to 128 wide and 96 to 128 high.** That is 1.3 to 1.8 player heights tall, and the panel
  includes what sits in the frame. Many maps have no door entity at all (CS median 0, TS median 0):
  doorways are open gaps (the `passages`).
- **Room corners count as narrow** in `width` (the kit's measure), and pillars narrow the floor only where
  a line meets them. Read the narrow share as "floor near walls", next to the other games, not as "corridor
  area".
- **A start placed in a box**: a few arena maps (ts_neobaroque, ts_fall) start the walk in a spawn room
  left by teleport. The single-start floods (crossing, span) do not ride teleports, so their crossing is
  a few hundred units. The bands' p5 carries them; read a map's own record before trusting its crossing.

## Measures skipped, or taken with limits

- **Stair rise from walkable height changes**: done, but a tread under 8 deep (two risers in one step of
  the grid) is missed, and so are steps on sloped floor. A step of 2 to 3 (noise of the floor under a
  body's 32-unit box) is ignored.
- **Loops by drops, ladders, teleports and jumps**: left out on purpose. Only routes walked both ways
  count, so a one-way drop that closes a circuit is not a loop here.
- **Crossing for levels whose ways out are behind lifts or trains**: lifts that serve a floor at both ends
  are ridden now. Not ridden: a lift whose far end is in the next map (no floor at its top in this one), a
  train that moves across (`trainsAcross`: a ride over a gap, Xen's floating platforms), `func_tracktrain`
  and teleports in the crossing floods. Such maps still get `exit-to-farthest` or `farthest`.
- **Cover spacing and sightlines against encounter slots** (PLAN.md's style metrics): not taken. Cover
  needs knowing what a body hides behind at crouch and stand height, place by place, which is a new
  measure for the kit. The sixteen-line `sight` is the only sightline measure here.
- **Room sizes as rooms**: not taken. There is no robust room segmentation of a compiled map: the kit has
  `storeyCuts`, but no room partition. Width bands, area, the passages and the loop regions stand in for
  it.
- **Brush entities that move** (lifts, trains, platforms, rotating bridges) are not measured as doors.
  Doors that open up or down (portcullises) are counted when their panel stands; a hatch in a floor is
  not.
- **`--merge`** (re-measure some maps into a corpus already made) needs the per-place values of the
  earlier run for the pooled bands; they are kept outside the repository, in the system's temp folder
  (`smak-levels-pool-<game>.json`), and lost with it.
