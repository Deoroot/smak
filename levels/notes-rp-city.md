# Level measures of role-play cities: The Specialists' RP cities (kind `rp-city`)

What a role-play city is held against: the three cities H9 plays, measured as a fifth kind of level beside
coop-campaign, linear, arena and exploration. Made by `levels/tools/survey-goldsrc.mjs --game tsrp` (the
general GoldSrc measures of `levels/notes-goldsrc.md`, plus the city measures of
`levels/lib/city-measures.mjs`); banded by `levels/tools/styles.mjs` into `levels/styles/rp-city.json` and the
"Role-play cities" section of `levels/styles/README.md`. The corpus is `levels/corpus/levels-tsrp.json`.

**Measures and bands only.** No geometry, entity, texture or name of a map is in the repository; door names are
only counted by the kind they say (home, shop, cell ...).

```
node levels/tools/survey-goldsrc.mjs --game tsrp --root <folder holding maps/> --jobs 2 --timeout 900
node levels/tools/survey-goldsrc.mjs --game ts --city ...     # the city measures on any game's maps
node levels/tools/styles.mjs
```

## The maps

| city | file measured | where it was found | note |
| --- | --- | --- | --- |
| Alexandria | `alexandria_msr_b5.bsp` | `Downloads/H9XASH.zip` (`H9XASH/ts/maps`) | STUDY.md names b4v3; only b5 (newer) is on disk as a compiled map (b4v3 exists as a `.map` source only) |
| Paradise City | `paradisecity_revival_final.bsp` | `Downloads/H9XASH.zip` | the file STUDY.md names |
| Xenon City | `xenoncity_final.bsp` | `Downloads/H9XASH.zip` | STUDY.md names `xenoncity_true_b3v2` (The-Specialists-Archive); that archive is not on this disk, only its `.map` source |

Searched for more cities and found none to add: `C:/Juegos/TS30-clean/maps` holds the game's own arena maps;
Steam's `ts_downloads/maps` holds only `h9_te_neuropolis` (a team map, not a city);
`Downloads/TEMP/havoc-nine-src` holds Git LFS pointers, not maps. Left out on purpose: `h9_tsrp_hive` (the
three cities merged, BSP2: it would vote three times) and `h9_tsrp_newbyzantium` (the city being redesigned;
measured apart below, never banded). **Three maps is a thin sample**: every band's p10 and p90 are the three
cities' own extremes. Read a band as "what these three do", not as a spread.

Alexandria's spawns stand in a core left by a `trigger_push` up into three teleports, which the walk does not
ride: from its starts it reached 1 % of its floor. For a city (`city: true`) whose walk reaches under a tenth,
the walk is begun again from its starts **and its teleport destinations** (`walkFrom: "starts and teleport
destinations"`): 63 %. Its and Xenon's `crossing` (start to farthest, on foot) still start in a spawn box (752
and 512 units); Paradise's is 14 424. Read `span` and the city measures, not the crossing, for these two.

## The city measures, exactly

All on the walked floor (measure's places, a grid of 32 units, each with its width, headroom and open sky).
Lengths in metres (72 units = 1.83 m = one player height), areas in m².

- **Doors cut the floor.** Every doorway panel (func_door, func_door_rotating, momentary_door that stands,
  thin, 64+ high; doors the walk rides as lifts left out) claims the places within 20 units of its box at its
  foot. The floor left falls into parts (four-way neighbours on one floor: within 56 units of height). The
  largest part is the city's **public floor**; any part beside a door, half roofed or more and no larger than
  2 500 m², is a **room**; slivers under 4 places are the doorway's own floor. Rooms joined by a door that no
  public floor touches are one **building**; it is **entered** when one of its doors touches public floor.
  Apartment-sized: a building of 15 to 150 m². Its **kind** comes from its doors' names, first match wins:
  jail (cell, jail, prison), hideout (hideout, stash, secret), home (resident, apt, flat, citizen, lux,
  estate, suite ...), shop (shop, bar, club, cafe, gun, gear, noodle, storage ...), public (office, lab, bank,
  police, cp_, hq, armoury, clinic ...), other, unnamed.
- **Streets.** Each part of a set of places is rasterised in plan, thinned to its middle lines (Zhang-Suen),
  spurs shorter than half the street's width pruned. A **plaza** is a patch of places 12 m wide or more (the
  narrowest line through each) of 150 m² or more, its box no longer than 3 to 1: one node. A **junction** is a
  middle-line node of 3 ways or more; two nodes joined by a line shorter than the street is wide are one
  crossing; a two-way node is no junction. **Streets** are the lines between nodes, each with its length and
  its median width; between junctions (both ends a junction or plaza), dead ends (one free end).
  Vehicle-wide: 4 m (157 units) or more. Done twice: `streets` = public floor under open sky (what was asked),
  `publicWays` = all public floor, roofed or not (these cities' streets are mostly roofed corridors).
- **Layers.** Floor heights in bins of 32 units holding 1 % of the places, neighbouring bins merged, kept when
  the layer holds 2 %. The street layer: the one with the most public floor under the sky. **Connectors**:
  stairs and ramps (places between two layers, or stepping from one layer to another, touching two), lifts
  (what the walk rides: liftsOf's func_plat, doors and trains), ladders, teleports (their places within 48
  units of the box). **toConnector**: the walk (8 ways over the places, doors open) from each public place to
  the nearest connector.
- **Variety.** A room's footprint: its box in places (sides sorted) and its place count, halved; a building's,
  its own and its rooms'. `repeatedShare`: the share whose footprint another has. Brush models (func_wall,
  illusionary, breakable, doors) by size (2 units) and texture set. **Districts**: the plan in tiles of 512
  units (13 m) with walked floor; each tile's palette is the textures covering 70 % of its world faces' area
  (8 at most); tiles beside one another whose palettes share 30 % (Jaccard) are joined; a district has 3
  tiles or more.
- **Light.** Each place gets the lightmap samples of the floor under it (within 24 units, by area; switched
  styles as the map starts). Bands of all floor, public floor and rooms; dark under 24, bright 128 or more of
  255. The light entities' `_light` colour by hue: white (saturation under 0.2), red, orange, yellow
  (warm), green, cyan, blue, purple (cool); the sky's light_environment apart.
- **Furniture.** Counts of classes and names: doors (named), switches (func_button, rot, momentary), spawns,
  cell doors, lifts ridden, trains, teleports, ladders; hidden ways = doors whose every texture is worn by the
  world's walls and none door-like + func_wall_toggle + names saying secret, hidden, hideout, stash;
  func_illusionary apart (cities use it for dressing more than for secrets).

## Per map

General measures (units / metres):

| | Alexandria | Paradise City | Xenon City |
| --- | --- | --- | --- |
| walked floor | 12 539 m² | 9 447 m² | 7 970 m² |
| reached | 0.63 (from teleports too) | 0.80 | 0.60 |
| floor width (median) | 290 / 7.37 m | 230 / 5.84 m | 246 / 6.25 m |
| headroom (roofed) | 160 / 4.06 m | 167 / 4.24 m | 172 / 4.37 m |
| sight (median) | 1120 / 28.4 m | 756 / 19.2 m | 894 / 22.7 m |
| open sky | 23 % | 14 % | 24 % |
| floor levels / range (p5-p95) / most stacked | 14 / 35 m / 3 | 12 / 34 m / 3 | 7 / 57 m / 5 |
| door w x h | 1.42 x 2.51 m | 1.80 x 2.74 m | 1.47 x 2.39 m |
| loops (512) | 4 | 6 | 5 |

City measures (each city's own; the band is their median, p10 and p90 their extremes):

| | Alexandria | Paradise | Xenon | rp-city band (median) |
| --- | --- | --- | --- | --- |
| street floor under sky | 2 828 m² | 1 331 m² | 1 862 m² | 1 862 m² |
| street width under sky | 15.2 m | 10.2 m | 7.4 m | 10.2 m (5.6 ph) |
| public floor / roofed | 8 960 m² / 68 % | 6 270 m² / 79 % | 3 006 m² / 38 % | 6 270 m² / 68 % |
| public way width median / p10 | 8.8 / 4.0 m | 6.4 / 3.8 m | 8.2 / 4.2 m | 8.2 / 4.0 m |
| public floor 4 m+ (vehicles) | 91 % | 80 % | 96 % | 91 % |
| plazas / median plaza | 5 / 296 m² | 1 / 229 m² | 4 / 215 m² | 4 / 229 m² |
| junctions (per ha of public floor) | 25 (28) | 37 (59) | 3 (10) | 25 (28) |
| street between junctions | 8.9 m | 11.1 m | 8.9 m | 8.9 m |
| dead-end ways | 28 | 16 | 2 | 16 |
| buildings behind doors (entered) | 22 (19) | 33 (29) | 21 (12) | 22 |
| rooms per building / median room | 1 / 64 m² | 2 / 32 m² | 2 / 25 m² | 2 / 32 m² |
| median building / apartment-sized | 133 m² / 12 | 64 m² / 24 | 73 m² / 9 | 73 m² / 12 |
| homes / shops / public (by door names) | 7 / 4 / 2 | 16 / 4 / 8 | 9 / 3 / 5 | 9 / 4 / 5 |
| floor behind doors | 27 % | 33 % | 60 % | 33 % |
| layers / span | 9 / 34 m | 10 / 34 m | 6 / 72 m | 9 / 34 m |
| connectors (per ha) | 20 (16) | 34 (36) | 20 (25) | 20 (25) |
| walk to nearest connector median / p90 | 19.1 / 45.3 m | 12.3 / 27.3 m | 17.0 / 33.5 m | 17.0 / 33.5 m |
| rooms / buildings / brush models repeated | 5 % / 0 / 31 % | 5 % / 0 / 35 % | 20 % / 0 / 62 % | 5 % / 0 / 35 % |
| world textures / per 13 m tile / districts | 444 / 13 / 13 | 236 / 12 / 13 | 64 / 13 / 3 | 236 / 13 / 13 |
| floor light median (dark / bright share) | 55.5 (11 % / 10 %) | 60.4 (8 % / 4 %) | 94.3 (5 % / 24 %) | 60.4 (8 % / 10 %) |
| public / room floor light | 52.6 / 67.8 | 56.3 / 70.6 | 94.3 / 93.2 | 56.3 / 70.6 |
| lights per ha; warm / cool / white | 83; 77 / 16 / 7 % | 56; 21 / 55 / 25 % | 118; 37 / 23 / 41 % | 83; 37 / 23 / 25 % |
| doors (named) / switches / spawns | 111 (109) / 53 / 15 | 99 (99) / 46 / 19 | 98 (98) / 38 / 9 | 99 / 46 / 15 |
| cell doors / lifts ridden / trains / teleports / ladders | 18 / 2 / 8 / 3 / 6 | 4 / 6 / 6 / 0 / 8 | 7 / 1 / 6 / 13 / 8 | 7 / 2 / 6 / 3 / 8 |
| hidden ways / illusionary / props / sounds | 5 / 44 / 101 / 94 | 15 / 48 / 214 / 47 | 6 / 57 / 70 / 38 | 6 / 48 / 101 / 47 |

## What the numbers say

- **The cities are interiors with streets as corridors.** Only 14 to 24 % of the walked floor is under open
  sky; 68 to 79 % of Alexandria's and Paradise's public floor is roofed. Their public ways are 6.4 to 8.8 m
  wide at the median and 3.8 to 4.2 m at the narrow end (p10): 80 to 96 % of public floor would take a
  vehicle, but the junctions are close (a street runs 9 to 11 m between them) and there are few squares
  (1 to 5 plazas, 215 to 296 m² each). Dense, short-blocked, mostly roofed.
- **A building is small: one or two rooms, 64 to 133 m².** Rooms are 25 to 64 m² at the median; 9 to 24
  apartment-sized buildings a city. Only 22 to 33 parts of each city are cut off by doors although each has
  about 100 doors: many doors stand inside public floor (gates across corridors, doors of rooms with a second,
  open way in), and a room open to a street is street here.
- **Nothing repeats.** No building footprint repeats in any of the three; 5 to 20 % of rooms share a shape.
  Even the brush models (doors and fittings) repeat only 31 to 62 %.
- **Shade, and rooms brighter than streets.** Alexandria and Paradise light their floor at 55 to 60 of 255
  (median), 8 to 11 % of it under 24, and their rooms brighter than their streets (68 to 71 against 53 to
  56). Xenon is evenly bright (94 everywhere, a quarter of its floor 128 or more).
- **Every door has a name** (98 to 109 named of 98 to 111): the RP plugin owns them all.

### What each city does well, in numbers

- **Alexandria: the richest, and the most to discover.** 444 world textures in 13 districts, 94 sounds, 53
  switches, 18 cell doors, the widest streets under sky (15.2 m) and the most plazas (5); 77 % of its lamps
  warm. Its weakness in these numbers: the longest walk to a stair or lift (p90 45 m) and its buildings are
  single large rooms (133 m²).
- **Paradise City: the lived-in street city.** The most buildings (33, 29 entered from the street), the most
  homes by name (16), the most apartment-sized units (24), the most props (214), the densest junctions
  (59 per ha of public floor) and the most connectors (34, 36 per ha): no public place is more than 27 m
  (p90) from a way up. Cool light (55 % of lamps), its rooms lit above its streets.
- **Xenon City: the vertical city.** The tallest stack (5 floors over one another, layers spanning 72 m),
  13 teleports, 60 % of its floor behind doors (its towers are gated floors). It repeats the most (20 % of
  rooms, 62 % of brush models) and uses the fewest textures (64, 3 districts), and is lit evenly bright.

## New Byzantium, current state (not banded)

`out/h9_tsrp_newbyzantium.bsp` is BSP2 (Xash). Measured from a scratch reader that lays BSP2's six wider lumps
into readBsp's shape (the city's own `bsp2.mjs` layout) and hands it to `measureLevel` (`read`); 188 s, walk
grid 16 (the city is too large for 8). Reached 82 %.

| | New Byzantium | rp-city band (p10-p90) | |
| --- | --- | --- | --- |
| walked floor | 96 620 m² | 7 970-12 539 m² | 8 to 12 times a city |
| floor width / headroom / sight (median) | 6.30 / 4.88 / 57.8 m | 5.84-7.37 / 4.06-4.37 / 19-28 m | sight twice as long |
| street floor under sky | 18 413 m², 78 % of it plazas | 1 331-2 828 m² | 17 plazas under sky |
| public way width median / p10 | 6.9 / 3.2 m | 6.4-8.8 / 3.8-4.2 m | in band; alleys a little narrower |
| junctions per ha / between junctions | 34.5 / 12.2 m | 10-59 / 8.9-11.1 m | in band; blocks a little long |
| buildings / rooms per building / median room | 640 / 1 / 24 m² | 21-33 / 1-2 / 25-64 m² | single rooms at the small end |
| building / room / brush model repeated | 76 % / 81 % / 97 % | 0 / 5-20 % / 31-62 % | **far outside: rooms and buildings repeat** |
| world textures (per ha) | 114 (12) | 64-444 (~250) | thin per area |
| layers / span / connectors | 7 / 49 m / 162 (17 per ha) | 6-10 / 34-72 m / 16-36 per ha | in band |
| walk to connector median / p90 | 16.3 / 93.7 m | 12.3-19.1 / 27-45 m | **p90 twice the cities'** |
| floor light median; dark / bright | 51.8; 19 % / 1 % | 55-94; 5-11 % / 4-24 % | darker, as asked; no bright pools |
| public / room light | 54.5 / 35.6 | 53-94 / 68-93 | **rooms darker than streets: the cities do the opposite** |
| lights per ha; warm | 278; 61 % | 56-118; 21-77 % | three times the lamps |
| doors (named) / switches / lifts / teleports | 841 (102) / 8 / 0 / 0 | ~100 (all) / 38-53 / 1-6 / 0-13 | doors unnamed; few switches; no lift |
| cell doors / hidden ways / props / sounds | 49 / 0 / 584 / 138 | 4-18 / 5-15 / 70-214 / 38-94 | no hidden way |

## Gaps and limits

- **Open-front rooms are street.** Without a door there is no cut: a shop open to its street, a room with a
  second open way in, a balcony, all count as public floor. Buildings are undercounted against doors (22 to
  33 against ~100 doors), and `roomsPerBuilding` is a floor.
- **A gated public area counts as a building** when it is roofed and under 2 500 m² (Xenon's tower floors
  behind gates: 60 % of its floor behind doors).
- **Streets in plan**: where a public part lies over itself (a bridge over a street), the lower floor is
  rasterised; stairs between layers split street parts. Junctions and short streets are sensitive to the
  thinning on a 32-unit grid: read counts and medians, not single streets.
- **Stairs and ramps are one class** (the places carry no slope); ladders and teleports are taken from their
  boxes. A layer is a height band, not a storey of one building.
- **Kinds by name** need the RP plugin's names; New Byzantium's unnamed doors come out `unnamed`.
- **Not measured**: cover, the vehicle routes as such (only width), sound coverage, signage. Each property's
  rooms, doors, windows, furniture, jail cells and spawns by kind: levels/notes-rp-rooms.md
  (`levels/tools/survey-rp-rooms.mjs`). Branches, floor off the route and drop height are the
  kind's gaps as for the other GoldSrc kinds.
- **Three cities**: the bands are thin; add any TS RP city found later (`tsrp_*`, `rp_*`, `*city*` in
  ts_downloads/maps) and run the survey and styles again.
