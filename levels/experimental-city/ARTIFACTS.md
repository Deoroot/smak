# The map generator's artifacts

PLAN.md Phase 3, "The map generator". Each stage reads saved files, writes one artifact and runs its gate; the first
failing gate stops the run with a sentence naming the thing and the number it wanted.

```
node levels/tools/generate.mjs <description.json> [--tile c1_r1] [--until N] [--from N] [--seed S] --out <dir>
```

Code: `levels/experimental-city/` (`runner.mjs`, `registry.mjs`, `artifact.mjs`, one `stageN-<name>.mjs` a stage, and the shared
`geom.mjs`, `raster.mjs`, `site.mjs`, `connectors.mjs`, `heap.mjs`). Tests: `test/126-gen-site.mjs`; stages 6 and 7: `test/128-gen-palette-wiring.mjs`; stage 9: `test/134-gen-forms.mjs`; stage 10: `test/140-gen-geometry.mjs`.

## Every artifact

`<out>/NN-<stage>.json`, written with one space of indent, keys in the order the stage builds them, every number
rounded to a thousandth of a cell (so the same inputs give the same bytes):

```
{ "format": "smak-gen/1", "stage": "<name>", "n": N,
  "inputs": { "<name>": "<sha256>" },     // "description" and "rulebook" (canonical JSON hash), or an artifact's file name (hash of its bytes)
  "params": { "tile": "c1_r1", "seed": 1 },
  ...the stage's body...,
  "gate": { "pass": true, "failures": ["sentence", ...], "notes": ["sentence", ...] } }
```

**Fresh or stale.** An artifact is fresh when every input it names still hashes to what it recorded (a source, or an
artifact that is fresh in turn), its params are the run's, and its gate passed. `--from N` reads stages before N
back and refuses a stale one with the reason (`00-description.json is stale: it was made from description d1e4…,
description is now 8310…`; `02-lots.json is stale: its input 01-site.json changed after it was made`). A stage
reading an artifact the run did not make refuses it the same way.

**Determinism.** No clock, no `Math.random`: each choice the description leaves is seeded by `params.seed` mixed with
the name of the thing chosen for (`seedOf`, mulberry32 as SMAK's `seeded`), so adding a thing does not reshuffle
the others.

**Units.** x, y in cells (`grid.cell` metres, `grid.cellUnits` engine units), z in cells; `_m` fields in metres.
A rect is `{ x, y, w, d }` (least corner, w along x, d along y); a box `[x0, y0, x1, y1]`; a poly a convex list of
`[x, y]`; a z range `[z0, z1]`.

## Adding a stage

A stage is `{ n, name, reads: [file names, or "description" | "rulebook"], run(ctx) -> body, gate(artifact, ctx)
-> { failures, notes } }`, exported as `stage` from any `levels/experimental-city/stage*.mjs`; the runner imports them all, so a
stage plugs in by its file alone. `ctx = { description, rulebook, params, inputs: { "<file>": artifact } }`. `run`
is pure; `gate` reads only the artifact and `ctx`, so a test can break a copy and gate it again (`regate` in
runner.mjs). Write its body's schema below.

**The run's order.** The runner takes the stages each after every stage whose artifact it reads, ties by number
(registry.mjs `ordered`; a cycle is refused by name): today 0, 1, 2, 4, 3, 5, 6, 7, 8, 9, since stage 3 reads
`04-network.json` and stage 4 reads nothing of 3 or 5. `--until N` stops after stage N in that order (`--until 4` runs
0, 1, 2, 4; `--until 3` runs those and 3); `--from N` reads back the stages before N in that order.

## 0 `00-description.json` (stage `description`)

Reads the description and the rulebook (levels/rules/architecture.json).

| field | what |
| --- | --- |
| `description` | the description as given |
| `rulebook` | the rulebook tightened by the description's `architecture` (if any), in the engine's units (`rulesFor("goldsrc")`: lengths in units, `units.metresPerUnit`, `hullNow`) |
| `check` | `{ valid: [errors], pass, failures, metrics, rulebookErrors }`: validateCity, then checkCity with the city kind's bands (levels/styles/rp-city.json, as check-city holds by default) |

Gate: check-city PASS; the rulebook valid and not loosened; every `engine.limits` entry with a `source`; the tile an
id of the grid.

## 1 `01-site.json` (stage `site`)

The tile, a margin round it (`params.margin`, default `rules.tiles.seamMargin`), and what stands on it before lots.

| field | what |
| --- | --- |
| `tile` | `{ id, name, box, window, margin }`: the tile's box and the window (the box grown by the margin) |
| `grid` | `{ cell, cellUnits, storey }` |
| `layers[]` | `{ id, level, name, z, floor, top, sky, frame, ceiling, wealth, gated, bounds }`: each layer whose bounds meet the tile, lowest first; `top` the top of what is built and walked on it, `sky` its sky lid where it is open (a sky layer everywhere, a deck layer outside the layer above's bounds; null under a vault or slab; New Byzantium's L2 and L3 at z 28 since 2026-11-02), `frame` the role the mega-structure's frame wears on it (stage 9, M20) |
| `nodes[]` | `{ id, layer, z, kind, at, district, name, size, cornerRadius, program, tile, inTile, seamDistance }`: nodes in the window or ending a way that reaches it |
| `plazas[]` | `{ id, layer, z, kind, name, box, tile, portico?, monuments? }`: sized nodes (plazas, sized gates) meeting the window. `portico` (a square's colonnade): `{ depth, height (the rulebook's typical porticoes.height on the half-storey grid), line (the inner box its columns stand on), pitch (porticoes.maxColumnPitch in cells), column (its width, cells), mouths: [{ way, side, from, to }] (each way's carriageway across the line: no column there; a way's own porticoes meet the square's), columns: [{ at, side }] (from each corner, at most a pitch apart) }`; `monuments[]`: `{ id, kind, name, at, base, across (its shaft), height, z: [floor, top] }` |
| `ways[]` | below |
| `portals[]` | `{ id, kind: segment / connector / secret / passage, of, seam, at, layer, z, width }`: the description's portals on this tile's seams (a connector's or passage's `at` is where the straight line between its ends leaves the tile) |
| `measures.layers.<L>` | `{ ways, service, nodesInTile, wayAreaInTile, plazaAreaInTile, longestStraightRun: { way, cells } }` |

A way: `{ id, layer, z, class, district, name, from, to, access, vehicle, width, sidewalk, portico, quay, carriageway,
water, clearance, winding, length, lengthInTile, parts, caps, lanes, colonnade? }`. `parts` is its centre line clipped to the
window (a list of polylines, usually one): straight node to node, or for a winding way a zigzag of its described
`length` (pieces of about 8 cells, seeded side) that still crosses each seam at its portal; cut where it enters a
plaza at either end (a way wholly inside a plaza is left out). `carriageway` = width − 2 × max(sidewalk, portico)
(null for a canal); a canal's `quay` (each side) and `water`. `caps[]` `{ at, edge, seam, portal }`: where the centre
line leaves the tile box, the seam there (null at the city's edge) and the portal matched within
`portalTolerance`. A way with a `portico` (not a canal) carries `colonnade` (stage 1's `wayColonnadeOf`): `{ depth,
height (the vault, as a square's), offset (the column line from the centre line: carriageway / 2 + stage 8's KERB +
half a column, the shaft clear of the carriageway and its kerb), band: [inner, outer] (the portico, from the centre
line), pitch, column, mouths: [{ way, node, half }] (a side way's mouth at a junction end: none of its columns within
`half` of that way's centre line; a way running straight on is no mouth), columns: [{ at, side }] (this tile's: the
compass side of the way), gaps: [{ at, side, why }] (a column left out in a mouth) }`: laid along the way's whole line
(city-wide, so two tiles agree), a column every `pitch` or closer from each end of a run; a run cut at a seam (each
tile's columns clear of the portal's mouth, stage 8's PORTAL_DEPTH, and half a shaft off the seam) and half a shaft
short of a plaza it meets; a column two ways running straight on would both stand is the first's.

Gate: no two ways of a layer cross but at a node (centre lines; service hallways are stage 4's); every node in the
tile ≥ `seamMargin` from a seam; the portal tool's output (`cityPortals`) unchanged on this tile's seams; every way
leaving the tile at a portal; no plaza reaching across the tile's edge (a plaza is one tile's); a way's colonnade
with every column on its portico (past its carriageway and kerb, within its width), none in a side way's mouth, and
along each side no bay wider than `pitch` but where the tile's edge or a mouth breaks the line; inside the tile every
public node reaching a portal, a connector stop or the gate by public ways; the longest straight public run held to
`rules.space.maxStraightRun` when the description gives one as a number (given as `{ value, provisional: true }`, or
not at all, it is measured and noted).

## 2 `02-lots.json` (stage `lots`)

| field | what |
| --- | --- |
| `tile` | as 01 |
| `rules` | the written rules used: `LOT` (frontage width and depth by density), `MIN_LOT`, `STOREYS` by density, `FACADE_KINDS` by wealth, `VARIANTS`, `doorKinds` by owner |
| `blocks[]` | `{ id, layer, district, area, box, rows: [boxes, one a half-cell row run], scrap, blankFrontage, lots: [ids] }`: what the ways and plazas leave on the half-cell grid, 4-connected, cut at district borders (a point's district: the smallest district area holding it); `scrap` under 4 cells², no lots; `blankFrontage` cells of frontage left a plain wall |
| `lots[]` | below |
| `measures` | `{ layers: { <L>: { blocks, scraps, lots, enterable, facades, blankFrontage } }, lots, enterable, facades, enterableShare }` |

**An enterable lot** (the interface stages 3 and 5 build on; fields are only ever added):

```
{ id: "lot_<building>", building, tile, layer,
  rect: { x, y, w, d },                     // cells, whole or half: the footprint at the description's `at`
  frontage: { way,                          // the description's frontage (a segment or a node id)
              side: "n" | "s" | "e" | "w",  // the side of the rect facing it
              door: { at,                   // cells along that side from the rect's left (n, s) or bottom (e, w) corner
                      width_m,              // the rulebook's typical door width for its owner
                      kind } },             // the rulebook's door kind: house (residents, huts), shop (business), public
  zBase,                                    // cells: its layer's floor
  storeys, storeyHeight_m,
  kind: "enterable", type, owner, district,
  block,                                    // the block holding most of it, or null (standing on a plaza)
  standsOn,                                 // the plaza it stands on (its frontage), or null
  doorGap,                                  // cells from the door's opening to its frontage's edge
  tower? }                                  // { at, across, silhouette, storeys, z: [roof, crown], enterable: false }: a shell over the roof
```

The side faces most of its frontage (each quarter cell of a side counts when the point a quarter cell outside it is
within `maxDoorGap` of the frontage's edge); ties: the nearer, then the side facing the city's gate, then s, e, n, w.
The door sits on quarter-cell steps where its opening is nearest the frontage, then nearest the middle of the facing
stretch. A building the description marks `interior: false` gets a lot of kind `facade` at its footprint.

**A facade lot**: `{ id: "f_<tile>_<layer>_<nnn>", kind: "facade", tile, layer, district, block, rect, frontage:
{ way, side }, zBase, facade: { kind, palette (its district), variant (0..3, not its block's last one), storeys,
height (cells), storeyHeight_m } }`. Cut along each block's frontage, sides in the order s, e, n, w, each from its
least corner: `LOT[density]` wide (a seeded step of −1 to +1 cell) and deep, at least `MIN_LOT`; storeys seeded in
`STOREYS[density]`, never above the layer's height.

Gate: each enterable lot named enterable by the description, inside its district, inside the tile, not more than
`placement.overlap` into a way or a plaza other than its frontage, its door within `placement.maxDoorGap` of its
frontage; no facade into a way; no two lots overlapping; ≤ `maxEnterablePerLayer` enterable a layer in the tile and
in the city; ≤ `maxEnterableLotShare` of the tile's lots enterable; every enterable building of the description in
the tile with its lot. (`blockFill` is a note: a building may stand on its plaza, outside any block.)

## 4 `04-network.json` (stage `network`)

| field | what |
| --- | --- |
| `tile` | as 01 |
| `connectors[]` | below |
| `checkpoints[]` | `{ id, node, layer, controls, reason, program, rooms: [{ kind: gate / guard-post / holding-cell / ..., rect, poly? (a gate's own outline), fronts? (the connector or gate node a gate covers), z }], unplaced? }` |
| `posts[]` | `{ id, node (null for a post added on a run), kind, layer, z, rect, offset (cells from its node), reason }` |
| `hallways[]` | below |
| `colonnades[]` | `{ plaza, way, ref (the plaza's or the way's id), layer, z: [floor, the vault], depth, column, columns: [{ at, side }] (01's columns nothing of this stage stands on), dropped: [{ at, side, why }] (a column a piece, an exit's approach, a gate, a room, a post, a hallway on the ground or a door's way across the portico stands on: a wider bay there), line (a square's), offset, band (a way's) }`: a square's colonnade (plaza, way null) or a way's porticoes (way, plaza null). A door's way across the portico: `doorApproach`, keepClear's band of an enterable lot fronting the square or way, carried out past the column line |
| `spawns[]` | `{ id, layer, district, group ("<layer>:<district>"), at, z, on (the way or plaza) }`, interleaved by group (TS reads the first 32) |
| `notes` | what a stage noticed and did not fail |
| `measures` | `walk`, `spawns`, `service`, `connectors` (below) |

**A connector**: `{ id, type, access, name, stops, inTile (its stops in the tile), lengthDescribed, lengthBuilt (its
walked path, cells), dims, form, pieces, exits, facadesTaken, facing?, offset?, crossesSeam?, portal?, stub?,
unplaced? }`.
- `dims`: a stair `{ form, kind (grand / public / service / domestic), risers, riser_m, tread_m, pitch, flights,
  perFlight, width_m, landing_m, path, width, landing, flightRuns, well: { across, deep }, headroom, approach, fits
  (stairFits' failures), links (one per pair of stops) }`; a lift `{ shaft, car_m, carHeight, landing }`; a ladder
  shaft `{ shaft, landing, top }`; a ramp `{ form, width, grade, path, legs, well }`.
- `form`: `straight` (a run on the axes between its stops, when they stand at least its length at the steepest
  tread apart; treads up to the typical: one leg on the line when the stops share an axis, else an L of two axial
  legs turning at a square landing, `legs: 2`; a secret stair keeps its line), `switchback` (a well at its stops,
  or at the description's `site` for it: two lanes of its width, its longest flight and a landing each end; also
  a straight stair for which no run or L on the axes fits, noted), `shaft` (a lift or ladder), `helix` (a vehicle
  ramp that cannot run straight: a square well round its turns, `dims.radius` and `dims.turns`; its piece a `well`).
- `pieces[]`: `{ kind: well / shaft / car / flight / landing / stub, poly, z, risers? }`. A well or shaft is the
  column through all its stops; its flights and landings inside are for the stages after. A straight run is its
  flights in pieces of about a cell (each with its own z range, so it passes over a way above the way's clearance)
  and its landings. A `stub`: a connector whose far stop is in another tile, from its stop to the seam, at its
  stop's floor (a secret one in the slab under it, hidden from the public floor it passes under). One with portals
  follows its seam chain (seamChain): on the axes, square to each seam at the portal's point, level at its lower
  end's floor through every portal and climbing (`flight`s with their own `floor: [low, high]`, `landing`s at the
  turns) only toward its higher end in that end's tile; `seams: [{ portal, at, z, width }]` the height it meets each
  portal at, the same from both tiles (the join reads it); `through` when it only passes through the tile;
  `noSeamWay` when no way stood (then the stub as before, its portal without a height).
- `passages[]` (beside `connectors`): the description's secret passages crossing a seam, `{ id, kind: secret, stops,
  inTile, width, headroom, pieces, seams, ends: [{ id, at }] (where the tunnel starts: its hatch, stage 7), length,
  noSeamWay? }`, a tunnel along their seam chain in the slab under their ends' floor.
- `exits[]`: `{ stop, layer, z, side (a well's or shaft's) | dir (a run's), at, approach (poly) }`: the approach is
  the keep-clear floor in front of the exit (a stair's `max(minApproach, width)`, a lift's landing), on its stop's
  public floor (the node, its ways, a plaza it stands on the edge of), inside its stop building, or at its post.
- `facadesTaken`: facade lots a piece stands in below their height (stage 8 leaves them undressed there).

**A hallway** (a service segment or an MSR building passage with an end in the tile): `{ id, kind: service /
passage, layer, from, to, width, z, path (corners), legs: [{ from, to, z }] (straight stretches at one height),
length, bridges: [{ over: [way and plaza ids], from, to, z }], pierced (facade lots it passes through), runs
(cells between posts), posts (ids added), seam? (where it leaves the tile), seams? (both, through a tile), offSeam?,
unrouted? }`. Routed on the half-cell grid between its ends' rooms (a service node's post, a checkpoint's guard post,
an MSR building, or the seam at its portal: the half cells on the tile's edge within half a cell of the portal's
point, a last `seam: true` leg carrying it square onto the seam at that point; a hallway through a tile, from the
portal on one seam to the one on the other), 1.5 cells wide, off every building but the MSR's, every piece and room; over public floor it is a bridge at
the highest clearance under it. Orthogonal steps only (the rulebook's `circulation.axial`), each turn charged two
steps so a leg runs straight and turns once; stepping into an end's room keeps the hallway's width beside it clear
of every piece; a bridge ends at a turn (each bridge straight); `length` and `runs` are the lengths walked.

**measures**: `walk: { byLayer: { <L>: { farthest, distance, p90, floorCells, cutOffCells } }, p90, maxWalk: { id,
layer, distance }, unreached, samples }`; `spawns: { target, placed, share, tileFloor, cityFloor, groups }`;
`service: { hallways, total, described (the description's straight lengths in the tile), longestRun, bridges,
postsAdded }`; `connectors: { placed, unplaced, facadesTaken }`.

Written rules (the stage's header lists them): a well or shaft stands on rock, a block's back, a facade lot, its own
stop's plaza or inside its own stop building, never in a way, its exits within 6 cells of its node; a straight run
passes over a way only above its clearance and over a building only above its roof, its head opening in its upper
stop's own floor; a gate covers each exit its checkpoint controls at its node (widened to the gate room where it can
be, else the approach's width); the guard post within 4 cells of a gate off the public floor (2 on its own plaza),
the holding cells touching the post or each other, outside every building lot first (in an MSR building's lot only
when nothing else is near: stage 3 then makes them rooms of that building); a service node's post off public floor
nearest its node; no flight or landing under a way's clearance reaches into the way's band (the gate's own test, so
the half-cell raster cannot miss an edge); a post
added before a run passes `maxServiceRun`; spawns: the tile's share of `spawns.count` by its share of the
spawnable floor (public ways and plazas of layers not gated), on public floor, clear of every door's approach and
swing, exit approach, lift landing and gate, `spawns.minSpacing` apart.

Gate: every connector with a stop in the tile placed, each stop with its exit, each stair within the rulebook
(`stairFits`); every checkpoint's rooms placed and every hallway routed; the walk re-measured on the real
footprints (each layer's public floor less what stands on it, walked 8-ways from every public connector's exit and
from each way's portal at the description's walk to a connector outside the tile): every node and enterable door
reached, the farthest ≤ `connectors.maxWalk`, the tile's p90 ≤ `connectors.p90Walk`; every public connector
arriving on a gated layer controlled by a checkpoint whose gate room covers its exit at that stop (or controlled in
another tile, noted); every run ≤ `msr.maxServiceRun`; the city's service hallways ≤ `msr.maxServiceTotal`, counted on the routed lengths in
this tile and the described lengths in the tiles not built yet; no connector built more than a cell longer than its
described `length`; every hallway leg, bridge, flight and landing on the axes (`circulation.axial`, within
`maxSkewDeg`; a secret stair exempt); no column a colonnade (a square's, a way's) keeps standing in a piece, an exit, a gate, a
room, a post, a hallway or a door's way across its portico; the spawns at least the tile's share, on public floor of a
layer not gated, clear of the keep-clear volumes, apart; nothing overlapping (connector pieces, exit approaches,
checkpoint rooms, posts, hallway legs, enterable buildings, ways to their clearance, plazas, monuments, spawns), but for the
pairs placed together on purpose (a piece in its own stop building or on its stop's own floor, a building on its
plaza and what stands inside it, a gate on its exit's approach, an MSR room or hallway in an MSR building, a
hallway coming down into its room, a monument on its own square).

## 3 `03-programs.json` (stage `programs`)

Reads the description, the rulebook (in metres, tightened by the description's `architecture`), `02-lots.json` and
`04-network.json` (so it runs after stage 4). Code: `programs.mjs` (`programsOf`, `checkPrograms`, `hallwayEnds`,
`partyOf`), plugged in by `stage3-programs.mjs`. Lengths here are metres and areas m² (the rulebook's units), not
cells, but for what stage 4 placed (cells); positions come at stage 5. Tests: `test/127-gen-buildings.mjs`.

| field | what |
| --- | --- |
| `tile`, `scope` | the lots' tile; `"city"` when every enterable building has a lot, else `"tile"` (the housing table is then held city-wide only, a note) |
| `rules` | `TYPICAL` (a room's typical area over its rulebook minimum, 1.45), `GROW_MAX` (2.2), `COURT_MIN_SHARE`, `WALL_m` |
| `buildings[]` | below |

A building: `{ id, type, variant, sign, name, owner, district, layer, lot: { id, rect, frontage, zBase, storeyHeight_m,
tile, party: [{ side, a, b (cells along that side from its west or south end), lot }] (its sides shared with a
neighbouring lot of 02: no window opens there), partyFrom ("02-lots" | "stub") }, storeys, footprint_m, inner_m2,
layout ("stack" | "columns": a terrace's houses or huts side by side, each its
own street door), stair (null or { kind, width, rise, run, risers, perFlight, flightRun, entryLanding, halfLanding,
clear: [w, l] (the dog-leg stairwell's clear size), perUnit, count }), corridor: { allowed, class, width_m }, entrance
(the program's entrance kinds), court (null or { area_m2, open }), voids: [{ storey, kind: "terrace", area_m2 }],
reserved: [{ connector, type, area_m2, storeys }] (floor kept for connectors stopping here: the wells and shafts 04
stood in the lot, or estimated from the description without 04), units[], rooms[], storeyInfo: [{ storey, usable_m2,
target_m2, min_m2 }], doors[] (the named property doors: { name, kind: home / business / cell / secret, unit | room }),
passages, hallways: [{ hallway, kind (passage | service), to, side, at (cells along it), width, storey, gate (the gate
room at its end, or null) }] (04's hallways ending at the lot: where each meets the wall; two at one place one),
decisions[] ({ rule, what }) }`.

A unit: `{ id ("<building>.u<n>" for homes, numbered as check-city numbers them; "<building>.business" / .msr /
.public / .insurgent), kind, class?, number?, door (its name by housing.doorNaming), entry ("street" | "common"),
column?, storey?, rooms: [ids] }`.

A room: `{ id, kind, unit?, storey, target_m2, minArea_m2, maxArea_m2? (the rulebook's roomKinds.<kind>.maxArea, where it has one: the target and the planned room held under it), minSide_m, zone, rank, ceiling, needs: { street, window,
noWindow }, next: [[kinds]] (any of each group: the program's adjacency; every home's kitchen on its living room),
notNext, hidden? + secret + host (a secret door's room), gate? { passage, side, hallway?, at?, width? } (at the end of
04's hallway when routed), lift? { connectors, side } (a lift lobby against that shaft's exit), fixed? { x, y, w, d }
(cells: a room stage 4 stood in the lot, kept there) + checkpoint | post (its owner) + towards? (a checkpoint guard
post's gate), doubleHeight?, fill?, entranceHall?, door? (a cell's or secret's name; a checkpoint's cell keeps
`{checkpoint}_cell{n}`) }`.

Written rules: the rulebook's required rooms added; a manor or house holds its home class's rooms (homes.byRooms); a
home of flat-s or larger takes a toilet (an en suite) where its class's area allows; homes over a business get a
common entrance hall and stair (they never pass through the business), the business keeps the street storey; storeys
by policy (the street storey for the street rooms and halls, upper storeys for bedrooms, the MSR's offices and the
like, the top for upper halls and lookouts; cells a storey at most the rulebook's programs.msr.cellsPerStorey); with
04: each gate room at the end of one of the building's passages, each lift stopping at the building a lift lobby on
its storey (lifts side by side share one), each checkpoint room or post standing half or more in the lot a room of
the building, its unit the building's own; a room whose `next` kinds are on no room of
its storey moves beside one; a storey whose rooms would grow past `GROW_MAX` x typical takes its type's fill rooms
(at most 10 rooms a storey), then a court through every storey, then terraces on upper storeys; an upper storey past
the one-stair area (circulation.stairs.maxAreaOnOneStair) leaves a loggia unbuilt as circulation.stairs.loggia says,
else gets a second stair; a secret door's room opens from a room of rank 1 or less (never only through a private
room). Every generator rule a rule of the rulebook names (cellsPerStorey, loggia, noPassThrough,
privateThroughNotGenerated, roomNeeds.anyOutsideWall, programs.huts.entranceRank, programs.double-shop.homesOver).

Gate (`checkPrograms`): homes per layer and class at least the table (city scope); variant and sign once;
`roomProgramOk` (required, oneOf, nothing outside the program: a business's flats over it by its program's
`homesOver`; the homes held to their class too); every
target at least the kind's minimum; storeys in range; each storey's rooms at their minima within its floor; homes fit
at `housing.fill`; every home holds its class's rooms; the description's required programs; every secret door its
room; door names unique and at most 31 characters.

## 5 `05-plans.json` (stage `plans`)

Reads the description, the rulebook, `03-programs.json` and `04-network.json`. Code: `plans.mjs` (`plansOf`,
`planBuilding`, `checkPlans`, `reservedIn`), `layout.mjs` (the slicing search for one zone), `plan-svg.mjs` (a
building's storeys drawn), plugged in by `stage5-plans.mjs`. Metres in the lot's frame (origin at the lot rect's
least corner, x east, y north), cells for positions in the city; partitions on a grid of 8 units (0.2032 m).

| field | what |
| --- | --- |
| `tile` | as 03 |
| `buildings[]` | below |
| `stats` | `{ buildings, rooms, roomsPerBuilding: { median, min, max }, medianRoom_m2, roomRepeat: { share, grid_m, corpusShare, corpusGrid_m (32 units), withCirculation, target 0.1, gate 0.1 }, planVariety: { distinct, buildings }, doors, namedDoors, windows, stairs }` |

A plan: `{ id, type, variant, layer, lot, frame: { origin_cells, size_m, exteriorWall_m, interiorWall_m,
storeyHeight_m, slab_m, clearHeight_m, front }, storeys: [{ storey, z_m, score, why }], shells: [{ id, rect, front }],
court, reserved: [{ connector ("a+b" when touching pieces are merged into one column), kind: well / shaft / column,
rect_m, cells, storeys, exits: [{ storey, side, door, room }] }], rooms[], voids: [{ storey, kind: court / terrace /
open-to-below / open-garden / well / shaft / column / unused, of, rects, cells }], units: [{ id, kind, class, door,
rooms }], shared: [room ids], doors[], windows[], stairs[], walls[], parapets: [{ storey, of (a terrace), a, b,
height_m, thickness_m }] (dimensions.parapets: every edge of a terrace not against a room), decisions[], signature
(sha256 of the rooms' kinds and rects), attempt }`; a terrace void carries `parapet: true`. Spare floor (a pocket
past its room's cap, R2): the room takes a part under its roomKinds maxArea behind a straight wall and the rest goes to
a neighbour with room under its own cap, else becomes a corridor bay (an `inserted` corridor of its own, as wide as a
corridor of its class, off circulation and against a room), else stays a void: `terrace` where nothing stands above it
on any storey and an edge is open (its parapet), else `unused` (closed, walled, never entered).

- A room: `{ id, kind, unit, storey, rects (partition, to wall centres; an L is two), cells, clear (inside the
  walls), area_m2, narrow_m, height_m, exterior (has a window), hidden?, secret?, doubleHeight?, gate?, inserted?,
  checkpoint? | post? (a room stage 4 stood in the lot, planned as the building's) }`.
- A door: `{ id, name (property doors by housing.doorNaming, a second door of one property _b, _c; cells and holding
  cells {place}_cell{n}; secret doors the secret's id; else null), kind (rulebook door kind), storey, from (a room,
  "street", "outside", "connector <id>"), to, at (centre of the hole at the floor, metres), cells, facing (the side
  the leaf swings to), swing ("front" | "none"), swingInto, hinge ("low" | "high" along the wall), width, height, wall
  (its thickness), street?, passage?, hallway? (the 04 hallway it opens on) }`.
- A window: `{ room, storey, at, facing (into the room), width, sill, head, wall, street, court }`.
- A stair (one a storey pair, in its stairwell): `{ id, kind, from, to, storey, z_m, rise, run, risers, width,
  landing, entryLanding, headroom, flights: [{ at (foot of the first riser, centre), facing (up), width, run, rise,
  risers, z }], halfLanding: { at, size, z } }`.
- A wall: `{ storey, a, b, kind: interior (centred on its line) / exterior (outside the room's face) / court,
  thickness_m, rooms, holes: [{ kind: door | window, along_m, width, ... }] }`.

Written rules (plans.mjs's and layout.mjs's headers): shells; the stair tried along the side and back walls both ways
round, the court in the middle, against the back or in a back corner; strategies a storey (free slicing with
corridor insertion, spines, the court's gallery or part of it, a landing corridor at each stair); storeys of several
units laid out as blocks round shared circulation, then each unit from its own door; rooms stage 4 stood in the lot
fixed at their place, the stairs and court kept off them; a gate room covering the end of its hallway, a lift lobby
against its shaft's exit side, a hallway's end without a gate room taken by a room a door may open into (none
private, secure, hidden or in circulation.noPassThrough); a connector's exit into its lift lobby, else circulation, a
public or staff room, never a cell; windows and outside doors only on the lot's outer walls less its party walls; a
shop's street door to one side of its display window; a checkpoint's guard post with its own door on the wall facing
its gate; a room never weighed under its minimum and a margin for walls; huts each of their own depth; a footprint the
city or the building's other shells already have penalised, and walls moved a step or more to break repeats;
corridors leading nowhere removed; a building failing its own gate laid out again from the next sub-seed, at most 12
times, more trees each time.

Gate (`checkPlans`), each failure a sentence: the program's rooms planned on their storeys, a stairwell on every
storey; `roomProgramOk`; areas and narrow sides at the rulebook's minima, no part of a room under 1.44 m;
`circulationOk` per program part (every room reached from a street door, none only through a private room unless
allowed, no link between homes, the entrance's kind and rank, adjacency, street / window / no-window needs, corridor
runs and dead ends, stairs between storeys and two past the area rule, nothing reached only through a room of
circulation.noPassThrough; a hut's bedsit its entrance by programs.huts.entranceRank); doors between units only
through shared circulation; no two doors overlapping in one wall; a cell or holding cell opened only by a cell door
and only on what the program's adjacency names; every room stage 4 stood in the lot planned within 0.2 cells of its
place; every hallway end with its door on its storey; a lift lobby taking its lift's door; no window on a party wall;
every terrace with its parapets; with 04, every checkpoint room or post standing in the lot a room of the plan, and
none outside in a street door's approach; `doorFits` in metres and in
goldsrc units; door heads under both rooms' ceilings; `stairFits` and each stair rising its storey; corridor widths
by class and their ceilings; `ceilingFits` for every room; keep-clear (each door's opening, approaches and swing
clear of every wall; each stair's flights, landings and approaches clear of every wall; no leaf swinging into another
or over a flight); rooms inside the lot and not overlapping each other or a void; every reserved well or shaft kept
clear on its storeys and opened onto at each exit; door names unique, at most 31 characters, each program door name
on a door; no two buildings with one plan, each variant once; room footprints repeated at most 10 % (PLAN.md's
stage-5 target, held since the plans reach it: the whole city 5.8 to 9.5 % over three seeds, the Core 3.5 %).

## 6 `06-palette.json` (stage `palette`)

Reads the description, the rulebook, `01-site.json`, `02-lots.json`, `04-network.json`, `05-plans.json`. Code:
`stage6-palette.mjs` (its header lists the written rules; `allowedRoles`, `hueOf`, `tileBudget` exported for stage 7
and the tests). Tests: `test/128-gen-palette-wiring.mjs`.

| field | what |
| --- | --- |
| `tile` | as 05 |
| `rules` | the light and sound constants used: `ROOM_TARGET` 72, `PUBLIC_TARGET` 52, `RATIO_TARGET` 1.25 (the corpus's rooms 70.6 over public floor 56.3), `AMBIENT` by layer ceiling, `LAMP` (m² a room lamp lights, by the rulebook's ceiling class), `SPACING` (cells between street lamps by way class), `PLAZA_AREA`, `SOUND_AREA`, `SWITCH_KINDS`, `ROOM_SOUND` |
| `budget` | `tileBudget`: `{ share (the tile's enterable buildings over the city's), maxShare, switchable: { target, limit, styles: [first, last], cityStyles }, sounds: { limit }, switches: { target, min, max }, entities: { limit }, textures: { limit, bytesEach } }` |
| `things[]` | `{ id ("way:<id>", "plaza:<id>", "facade:<lot>", "building:<id>", "room:<id>", "door:<id>", "connector:<id>@<stop>", "checkpoint:<id>.<room index>", "post:<id>", "colonnade:<plaza>", "monument:<id>", "tower:<building>"), kind (way / hallway / plaza / facade / building / room / door / connector / checkpoint / post / colonnade / monument / tower), layer, district, faction (msr / insurgents / null), wear, ref, building?, roomKind?, storey?, sign?, secret?, slots: { "<slot>[.<part>]": { role, texture } } }`: a slot key is a palette slot, with a part for the shared palette's (`floor.road`, `trim.curb`, `sign.street`); `role` is null only when the owner's palette has none (the gate stops); `texture` is null when the role names no textures (left to the geometry's audit, stage 10). A secret door's slot is `wall`: it wears the wall's own texture |
| `lamps[]` | `{ id ("lamp_<tile>_nnn"), space (a thing id), at, z (cells, the fitting), power (light value x m²), colour (the district's light), hue (warm / cool / white), kind (street / plaza / room), switchable?, style? (32-63) }`; a street or plaza lamp also `mount` (post / bracket / hung, from dressing.mjs's `lampMounts`: a post where stage 8 allows one within LAMP_MOVE, else a wall bracket on the nearest wall within BRACKET_REACH, else a post within LAMP_SLIDE, else hung under a portico's vault; a lamp stage 6 put under a square's portico, `portico: true`, is hung from its vault first), `facing` (a bracket's, into the street), `moved_m`, `why` (not for a post); a plaza's lamps stand on its floor clear of the lots on it |
| `spaces[]` | `{ id, kind (public / room), layer, district, building?, roomKind?, area_m2, lamps, estimate (ambient + power / floor, 0-255) }`: every public way, plaza and room of the tile |
| `sounds[]` | `{ id ("snd_<tile>_nnn"), space, name (the district's sound; "city-alarm" for the alarm's speakers), at, z, kind (street / room / alarm), switchable? }` |
| `measures` | `{ things, textures, rolesWithoutTextures, texturesByOwner (a district, or "<faction> (faction)": its distinct textures, a role naming none counted by its name in brackets), lamps, roomLamps, publicLamps, light: { roomMedian, publicMedian (area-weighted), ratio, target, darkShare, warmShare }, switchable, sounds: { total, street, room, alarm, droppedRooms } }` |

Gate: every slot of every thing has a role (`<thing> has no <slot> role: <owner>'s palette names none ... no
fallback`); every role inside its owner's closed palette (the faction's slot when the faction has it, else the
district's; the shared palette only for the shared parts) and every texture one of its role's (null only for a role
naming none); each texture used under one role; neighbouring districts (one layer, areas touching) share at most
`palette.maxSharedWallFloor` of the wall and floor textures their own things use (faction and shared surfaces
aside); each layer's mean surface wear above that of the layer over it (`palette.decayDownward`); every space with a
lamp, the rooms' planned light at least `RATIO_TARGET` times the public floor's; the tile's switchable lights within
its share and each with its own style in 32-63; looping sounds within the tile's share of
`engine.limits.loopingSounds`; textures within its share of `engine.limits.textureBytes`. The planned dark share
(under 24) is a note.

## 7 `07-wiring.json` (stage `wiring`)

Reads the description, the rulebook, `01-site.json`, `02-lots.json`, `03-programs.json`, `04-network.json`,
`05-plans.json`, `06-palette.json`. Code: `stage7-wiring.mjs` (written rules in its header); the Apollo-RP adapter
`wiring-apollo.mjs`. PLAN.md's neutral RP contract ("The RP wiring contract"): names, groups and targets, in no
plugin's format.

| field | what |
| --- | --- |
| `tile` | as 05 |
| `grid` | `{ cell, cellUnits, origin }`: positions are cells; engine units = (x − origin) × cellUnits, z × cellUnits |
| `naming` | `{ doorNaming, maxNameLength, groups }` |
| `doors[]` | `{ name, id (05's door id, or "<checkpoint>.<room index>", "<secret>@<end>"), source (05-plans / 04-checkpoint / 04-connector / description-secret), kind (05's door kind; gate / post / cell for a checkpoint's; hatch), building, checkpoint?, unit, unitClass, room, zone, owner (a housing group), key (the property name whose key opens it), property, use (true: spawnflag 256), lockable, at: [x, y, z] cells, storey, width_m, texture }` |
| `openings[]` | `{ id, building, from, to, storey }`: 05's doors of kind opening without a name (no leaf, no entity) |
| `zones[]` | `{ id ("z_<ref>"), kind (district / way / plaza / building / msr), ref, layer, box, owner, name?, district?, of? (service hallway / checkpoint / post), z: [z0, z1] }` |
| `spawns` | `{ order: [04's spawn ids in entity order], groups: [{ id, spawns }], first32Groups }` |
| `cells[]` | `{ name, place (building or checkpoint), room, door, at }` |
| `lights[]` | `{ name ("lt_<tile>_nn"), lamp (06's), space, style, at, colour }` |
| `sounds[]` | `{ name (null when nothing targets it; "alarm_city" for every alarm speaker), sound (06's), kind, space, sample, at, looping }` |
| `switches[]` | `{ name ("sw_<tile>_nn"), kind (lamp / sound / gate / alarm), at (cells, on the wall face at the rulebook's typical height), facing (into the room), space, building, room, door (the entrance door it stands beside: dressing.mjs's switchSpots, the spot stage 8 keeps clear; a lone checkpoint post's: its wall facing the gate), checkpoint?, targets: [names] }` |
| `lifts[]` | `{ id, name, title, access, owner, stops: [{ stop, n, name ("<lift>_s<n>"), layer, z, at, inTile, call ("<lift>_call<n>", null outside the tile) }], car }` |
| `secrets[]` | `{ id, kind (door / passage / connector), building? / from, to? / stops, inTile?, doors: [names] }` |
| `entities` | `{ doors, buttons, lifts (train + stops), lights (switchable only), sounds, spawns, signs, props (the model props reserved for stage 8: dressing.mjs's modelPropCap), total, limit }` |
| `measures` | `{ doors, namedDoors, propertyDoors, lockable, byOwner, keys, zones, cells, switches, switchableLights, lifts, secrets, spawns, entities }` |

Gate: every door, light, switch, targeted sound, lift, stop and call button named, at most `doors.maxNameLength`
characters of letters, digits and `_`, no name twice; every door of 05 in `doors` or `openings`, a named one under
its 05 name; every owner group one of `housing.groups`; every door's zone in `zones`, every building with its zone,
every door use-only; each checkpoint's cell doors and holding cells as its program asks, each building's cells as
many as its cell rooms; switches within the tile's share of `wiring.switches` (min and max), switchable lights
within its share and each with its own style, every switch target a door, light or sound of the tile, every light on
a switch; every lift with two stops or more, each stop in the tile with a call button; every secret door of the
tile's buildings with its door; every spawn group among the first 32 spawns (TS reads only those); the entities
that stay within the tile's share of `engine.limits.entities`.

**Apollo-RP** (`node levels/experimental-city/wiring-apollo.mjs <07-wiring.json> --map <name> [--out dir]`, `apolloSeed`): the
per-map seed Apollo-RP ships (github.com/DouglasSherk/Apollo-RP, `configs/arp/maps/<map>/`): `<map>.sql` with
`arp_doors (targetname, internalname)` rows `('t|<door name>', '<key>')`, one for every lockable door that is not
secret, and `arp_properties` rows one a key (price, locked, access); `jailmod.ini` one section a cell; `zones.ini`
one entry a zone. Guesses, labelled in the file: the property table's name (the seeds' `arp_properties` against
ARP_Core's default `arp_property`), the prices and the access letters; no jobs are written.

## 8 `08-dressing.json` (stage `dressing`)

Reads the description, the rulebook, `01-site.json`, `02-lots.json`, `03-programs.json`, `04-network.json`,
`05-plans.json`, and 06's and 07's artifacts when their stage files exist (`06-palette.json`: room, street and plaza
lamps; `07-wiring.json`: switches in rooms). Code: `dressing.mjs` (its header lists the written rules;
`dressingOf`, `checkDressing`, `CATALOGUE`, `FURNISH`), `dressing-svg.mjs` (a building's storeys with its props and
keep-clear volumes; a layer's streets), plugged in by `stage8-dressing.mjs`. Greybox: a prop is an abstract box with
a `model` key (`prop/<kind>`) a later adapter maps to its kit. Tests: `test/129-gen-dressing.mjs`.

| field | what |
| --- | --- |
| `tile` | as 05 |
| `rules` | `catalogue` (kind -> `{ w (along the wall), d (out from it), h, wall (needs a wall at its back), collision, use: { depth, sides } \| null, cls (its class in placement.freestanding.kinds, or null), build: brush \| model, model, street }`, metres on the 8 unit grid), `furnish` (room kind -> `[{ kind, n, per (one more each this many m2 x density), max, near (by a door) }]`), `keptClear` (circulation kinds), `density`, `wearJunk`, `street` (`KERB`, `KERB_STRIP`, `EDGE_STRIP`, `MOUTH`, `PORTAL_DEPTH`, `LAMP_SPACING`, `STREET_CAP`, `WEAR_CAP`, `MARKET_CAP`) |
| `props[]` | below |
| `rooms[]` | `{ building, room, kind, storey, district, clutter (the kind's class), cap (placement.maxCoveredShare), walk_m (the corridor width its walk is held to), dressed, why?, area_m2, covered (share of the floor), doors, walkPairs: [[door, door, "walk" \| "hull"]] (the pairs the empty room joins and at which probe), props: [ids], unplaced: [{ kind, why }], allowance?: { max, placed, kept } and trimmed?: [{ id, kind, brushes, rank }] (a kind with an allowance in placement.dressing.maxBrushesBy: its prop brushes as placed and as kept, the props taken out after placing, by rank scatter / decor / duplicate / other; the rest stand where they were placed) }`: every room of 05 in the tile. The gate fails a dressed room without its kind's placement.requiredProps and one past its allowance by a prop it need not hold |
| `streets[]` | `{ layer, district, floor_m2 (its public floor in the tile), props (lamp posts aside), per100, cap, covered }` |
| `hungLamps[]` | `{ layer, lamp, why, deliberate }`: 06's lamps hung under a portico on purpose (deliberate, a note), or a post-mounted one with no legal spot within `LAMP_MOVE` (a gate failure: 06 should have mounted it) |
| `wallLamps[]` | `{ layer, lamp, facing }`: 06's lamps on wall brackets (no post, no floor footprint) |
| `reserved` | spots for the stages after: `lights` (a light spot under each dressed room's ceiling, only when 06 is absent), `switches` (`{ building, storey, kind: "switch", id, room, door, at (lot frame, m), facing, size, placeholder }`: by each room's entrance door, latch side, at the rulebook's typical height), `signs` (`{ layer, kind: "sign", id, building, door, at (world m), facing (the street), size, placeholder }`: over each shop's and public building's street door) |
| `measures` | `{ props, inRooms, inStreets, models, brushes, byKind, rooms, roomsDressed, roomsKeptClear, roomsEmpty, unplaced, trimmed: { rooms, props, brushes, note }, coveredShare: { median, max }, streetAreas, modelProps: { cap, byCity, entityRoom, limit, wiringEntities, placed, dropped }, brushBudget: { described, allowance: { rooms, perRoom, brushes, replaced, kept, roomsDressed }, props, roomProps, streetProps, total, limit, target, note } }`. Brush or model: the rulebook's `placement.props` (a prop is brushes unless its kind is in `modelKinds`; the tile's models at most `modelsPerCity` x maxShare and what its entity share leaves after 07's entities and `entityHeadroom`; past the cap `MODEL_DROP`'s kinds go first); a catalogue kind's `brushes` (BRUSHES) count in `brushBudget` against the description's estimate for the tile (city-checks.mjs `tileEstimateOf`), whose rooms' dressing allowance (`ESTIMATE.room.dressingBrushes`, 2 of a room's 8 brushes) is taken out for each described room dressed here: total = described − allowance.replaced + props, the furniture counted once |

**A prop** (the R1 review reads `id`, `kind`, `layer`, `rect`): `{ id ("<room>.<kind>-<n>" or "<layer>.<way or
plaza>.<kind>-<n>"), kind, model, build, place: "room" | "street", layer, rule (against-wall / freestanding;
kerb-lamp / plaza-lamp / plaza-edge / beside-bench / kerb-bench / stall-row / debris), size_m: [x, y, h] (world
axes), facing (into the room, or the side it is used from), wall, collision, use, rect: { x, y, w, d } (its
footprint in city cells, 02's frame) }`, and for a room's: `building, room, storey, at_m: [x, y, 0]` (its foot's
centre in 05's lot frame, metres above the storey's floor), `cells` (that centre in city cells), `z` (the storey's
floor, cells); for a street's: `district, on (the way or plaza), at` (cells), `at_m: [x, y, z]` (world metres),
`z` (the layer's floor, cells), and a lamp post's `lamp` + `moved_m` (06's lamp it carries) or `placeholder`.

Written rules: a room's kind's set, counted by area x the district's density, worn districts adding junk;
circulation kept clear; each prop against a wall (its back on the face, facing in) or freestanding only of the
rulebook's freestanding classes in a room whose narrow side is at least `minRoomSide` (a table stands free where it
may); never in a keep-clear volume (`keepClearOf`: every door's opening, approach both sides and swing; openings;
windows' fronts sill to head, so only a prop under the sill stands before a window; stair flights, landings,
approaches and headroom, from the storey below too; lift landings; the switch spots; 06's lamps or the light
spots; a column `SWITCH_RADIUS` round each of 07's room switches, which carry no facing) nor across an opening; the
walk: each pair of a room's doors the empty room joins with a walk of the rulebook's corridor width (public rooms
`corridors.public`, else `domestic`; on the plan grid within 2 cm) stays joined at that width, else with the 32 x 72
unit hull, and each prop's use strip free of props and reached by the hull, flooded on the 8 unit plan grid;
`placement.maxCoveredShare` by the kind's clutter class. Streets: never on a carriageway (and `KERB` of it), a
portico's or sidewalk's walking lane (only the kerb strip, where the sidewalk keeps `minWalkWidth`), the middle
lane of a way with no carriageway (a public corridor's width), a way's mouth into a plaza, a portal's mouth, a
connector exit's approach, a gate, a street door's approach or swing, a spawn, a sign's reading space, a lamp's
fitting; a post under each of 06's lamps (else placeholders by `LAMP_SPACING`); stalls in rows in a market
district's plaza; benches with a bin on plaza edges and wide kerbs; debris by wear; every street door, exit and
portal pair joined as before (public corridor width, else the hull), a prop that cuts it taken out again; clutter
per 100 m2 by district within `STREET_CAP` + `WEAR_CAP` (+ `MARKET_CAP`), the wear part the debris's own.

Gate (`checkDressing`), each failure naming the prop, the thing and the distance: a kind no rule places; a prop
outside its room's floor or off the public floor; in a keep-clear volume (`enters door X's swing (front) by 0.42
m`); across an opening (`crosses door X's opening by`); off the wall behind it when it is not freestanding, or
freestanding against the rule; overlapping another prop; a room's doors no longer joined after dressing (`room R:
doors A and B are no longer joined by a 1.42 m walk ... cut by prop P (table)`, the props named by taking each out
again); a use side covered or unreached; a room past its covered share; a street prop in a carriageway, lane,
mouth, portal, exit approach, gate or door approach; a street walk cut; a district's street clutter past its cap
or past the outdoor covered share. The prop count against the RP cities' 70-214 prop entities, 06's lamps left
hanging, and the placeholders reserved are notes.

## 9 `09-forms.json` (stage `forms`)

The mega-structure's forms (levels/notes-megastructure.md: the vocabulary F1-F27, the checks M1-M21), placed between
the dressing and the geometry, so the adapter only builds them. Reads the description, the rulebook (its `forms`
section, in metres, converted to cells on the 16-unit grid), `01-site.json`, `02-lots.json`, `04-network.json`,
`05-plans.json`, `06-palette.json`, `07-wiring.json`, `08-dressing.json`. Code: `stage9-forms.mjs` (the stage),
`forms.mjs` (the context, the parts, the common checks and the budget; its header lists the written rules every form
keeps), one module a family: `forms-deck.mjs` (its header lists the deck family's rules). Tests:
`test/134-gen-forms.mjs`.

| field | what |
| --- | --- |
| `tile` | as 05 |
| `rules` | `{ units, forms }`: the rulebook's `forms` section in cells, as used |
| `deck` | `{ layer, over, box, soffit, top }`: the layer roofed by a deck, the layer above, the deck's extent (the upper layer's bounds), the soffit (the deck layer's top) and the deck's top (the upper floor); null without a deck |
| `families[]` | `{ id, file, order, forms (the vocabulary ids it places), placed, brushes }`, in their run order |
| `forms[]` | the instances, below |
| `placing` | `{ notes, failures }`: what the families said while placing (a station that slid, a pier that gave way, a form left out and why) |
| `measures` | `{ forms, byForm, byFamily, byKind: { <key>: { instances, brushes, rock, entities } }, brushes: { detail, world, entity, rock, total }, entities, brushModels, budget }`; `budget`: `brushes { before (08's brushBudget.total), forms, total, limit, target }`, `entities { before (07's that stay and 08's model props), forms, total, limit }`, `leaves { before, total, structural }` (the description's two terms, UNCALIBRATED) |

**An instance**: `{ id ("<family>.<kind>.<where>"), family, form ("F1" ...), kind (pier, pier-foot, rib, truss, coffers,
services, fusion, deck-edge, parapet, oculus, core ...), layer, build (detail unless a part says otherwise), frame
(true: it wears its layer's frame role, M20), role, on (the way, plaza, edge or building it serves), at (its centre,
cells), parts: [part], brushes, rock, entities, brushModels, ...its kind's fields }`. **A part**: one convex brush,
`{ shape (prism, box, frustum, wedge, diagonal, octagon-run), poly (its outline in plan, convex, cells), z: [z0, z1],
top? (a frustum's outline at z1), edge? (a wedge's full-height edge; it falls to nothing at the opposite side), what?,
embeds? (it may enter a facade lot's rock), build? (cut: rock carved, counted in rock; entity: a brush entity, one
entity and brush model), rock?, entity?, texture? }`.

The deck family's kinds: `pier` (F1: `onKind` way | plaza, `leg`, `station`, `side` l | r or `edge`, `t` along its
line, `width`, `projection`, `embed`, `capTop`, `landing` { kind: rock | hall, plaza }), `pier-foot` (F2: `carries`),
`rib` (F3: `span`, `depth`, `soffit`, `clearanceTop`, `bears` (piers), `bearsOnWall`), `coffers` (F4: `pitch`),
`truss` (F5: `axis`, `span`, `depth`, `panels`, `bears`), `services` (F6: `hungFrom`), `fusion` (F7: `lot`, `mode`
full | partial | gap, `fused`, `band` [top, soffit], `palette`: it wears its district's palette, not the frame's),
`deck-edge` (F8: `side`, `bay`, `t`, `pier`, `brackets`, `fasciaHeight`), `parapet` (F8, on the upper layer:
`height`), `oculus` (F9: `hole`, `guard` parapet | grate, `opensOn`), `core` (F26: `around` (its connectors),
`radius`).

Gate: the families' placing failures; every instance with a unique id, a loaded family, a layer of the tile, its
vocabulary id, convex parts with a z range; M18 (brushes at most `forms.maxBrushesBy[kind]`); M20 (a frame form in its
layer's `frame` role, a material no district's palette holds); no part entering what the stages before placed
(connector pieces, hallway legs, checkpoint rooms, posts, enterable buildings and towers, monuments, colonnade
columns, street props; a facade only for a part that `embeds`), nor below its layer's zone head a carriageway, a
way's mouth, a portal, an exit's approach or a gate, nor any door, spawn, sign or lamp keep-clear box; every street
walk the empty floor joined still joined with stage 8's props and the forms standing; M19 (a cut only through the
deck's band, the forms' rock within `forms.maxRockShare` of the rock target in the tile's share); each family's own
checks (the deck's: M1 pier pitch, M2 girders, M3 pier width, M4 landing, M5 the frame along every way under the deck,
M6 two scales, M7 the deck's edge, M16 oculi; a truss span/10 deep, every girder and truss on placed bearings); the
tile's brushes (08's total and the forms') within its share of `engine.limits.brushes`, its entities within its share
of `engine.limits.entities`. The budget sentence, the target and the leaves are notes.

**A forms family** (the contract; a family plugs in by its file alone, `levels/experimental-city/forms-<family>.mjs`):

```js
export const family = {
  id: "deck",              // lower-case, unique; its instances' ids start with it
  order: 10,               // the run order: a family placed later sees the forms placed before (fx.placed)
  forms: ["F1", "F2"],     // the vocabulary ids it places (levels/notes-megastructure.md)
  place(fx) { return { forms: [instance, ...], failures: ["sentence"], notes: ["sentence"] }; },
  check(forms, fx) { return { failures: [], notes: [] }; },   // optional: its own checks, on its forms as the artifact holds them
};
```

`place` and `check` are pure: the same `fx` gives the same result (no clock, no `Math.random`; a choice is seeded by
`fx.seed` and the thing's name). `fx` (forms.mjs `formsContext`): `desc`, `rules` (the rulebook in metres, tightened
by the description), `R` (its `forms` section in cells), `cell`, `cu`, `storey`, `inputs`, `site`, `lots`, `net`,
`dressing`, `tile`, `layers`, `layerOf(id)`, `deck`, `world(layer)` (stage 8's street world, zones and entries for that
layer, cached), `solids` (what the stages before placed, 3D, cells), `keep(layer)` (its zones and keep-clear boxes in
cells), `seed`, `placed`. The helpers a family builds with: `part`, `instance` (counts its brushes, rock and
entities), `partFaults(fx, part, { layers, ignore })` (what a part enters, by the common rules), `walkBreaks(fx,
layer, instances)` (the walks they cut), `boxPoly`, `underDeck`. A family's instance keeps every part it builds
inside the common rules (the gate holds them whatever the family) and adds its kind to `forms.maxBrushesBy` in the
rulebook with its source; its own rules go into the rulebook's `forms` section, each entry with its `source` and
`note`.

**The contract's later additions (the edges family, 2026-11-02).** `place` may also return `world: { <key>: value }`,
what the family hands the geometry for the whole map; stage 9 merges every family's into the artifact's `world` (a
key given by two families is a failure) and passes it to `check(forms, fx, world)` at the gate. `instance()` counts
entity parts sharing a part's `group` as one brush entity (a fan's hub and blades: one `func_rotating`, five brushes)
and takes `points: [{ classname, at: [x, y, z] (cells), keys, what, top? }]`, point entities (a sound loop, a sprite, a
train's `path_corner`, a backdrop model): one entity each and no brush; an instance of points alone has no parts.
Each instance carries `entityBrushes` (the brushes inside its brush entities); `measures.brushes.entity` counts those,
`measures.budget.entities.forms` the entities. A vocabulary id may also be one of section 7's means, `S1`-`S8`. A part
may be `build: "cut"` with `shaft: true`: a shaft carved down from the lowest layer's floor (its `z[1]` that floor),
the only cut besides the deck's band (M19). A new shape, `voussoir`: one segment of an arch, its outline in plan, a
flat top at `z[1]` and a sloping soffit `soffit: { from, to, z: [za, zb] }` (the soffit's height za along the line
through `from` square to `from`-`to`, zb through `to`, linear between; `z[0]` the lower of the two).

`world` (the edges family): `worldspawn: { MaxRange, skyname, note }` (V4: the engine's extent, at least the longest
line from public floor to the backdrop and `forms.backdrop.farClipMargin` more; the sky rendered by
`levels/tools/sky.mjs`), `edge: { layer (the walled layer), wallTop, sky, depth (the pockets'), longest, longestUnits,
sides: [{ side, len, pitch, towers (the rhythm's t, cells along the side, the whole city's), gates: [{ id, outside,
span }] }], tileSides (the sides this tile reaches), pockets: [{ id, side, box, z: [wallTop, sky], depth, rockEstimate,
cards, models, motion }], roads: [{ id, gate, side, box, z, length, rockEstimate, cards, lamps }], loops: { count, what }
}`. The pockets and roads are carved air outside the city's bounds: their rock is the map's, not the tile's share.

The edges family (`forms-edges.mjs`, order 20, its header lists its rules; tests: `test/137-gen-forms-edges.mjs`).
Kinds: `vault` (F11: `leg`, `t` [from, to], `ceiling`, `chamfer`; two wedges), `vault-rib` (F11: `station`, `t`,
`legLength`; haunches and a crown band, or haunches alone over a vehicle way whose carriageway is kept clear past its
ceiling), `canal-arch` (F11: `rise`, `span`; 4 voussoirs), `cistern-column` (F12: `pitch`, `grid` [nx, ny], `height`),
`architrave` (F12: `axis`), `arch` (F10: `side`, `station`, `span`, `clear`, `springing`, `end`), `gantry` (F19:
`walkable` false, `underside`, `clearanceTop`, `rail`), `dais` (F25: `size`, `rise`), `wall-tower` (F20: `side`, `t`,
`rhythm`, `gate`, `across`, `projection`, `top`, `wallTop`; a door at its foot and a strobing sprite), `wall-face`
(F20: `t`, `pilasters`), `card` (F21: `depth`), `backdrop` (S2, S6: the pocket's model, a train or an airship),
`gate-road` (S7: lamps, fog cards, the end card), `fan` (S5: `across`, `blades`, `pair` (the human-sized thing by it)),
`light-shaft` (S5: `under`), `searchlight` (S5), `shaft` (S4: `hole`, `bottom`, `guard`), `sounds` (S6: points only).
Its gate checks: M17 (a rib or arch at most `vault.rib.every.max` apart along each leg's walled stretches, the halls'
columns at `cistern.pitch`, the hall's full height, at least `cistern.minShare` of the grid standing, every hall
plaza with its columns), M14 (towers at most `wall.tower.pitch.max` apart and from the tile's ends, projecting and
rising enough, the wall's top), V3 (no public floor at the wall farther than half a pilaster pitch from a tower, a
pilaster or a gate), M21 (the wall's top over every open layer's eye; a gate road ending in a card past the eye), V4
(worldspawn's MaxRange and sky name, every card, tower and model under the sky lid, every point inside the extent),
V7 (a shaft under a grate or a parapet ring; a gantry out of reach, railed), F25 (raised, never sunk; a step without
a flight), V8 (a fan with a door, lamp or sign within `scaleIllusion.human.reach`; a tower with its door), M15 (no
stretch of a public way in the tile longer than `scaleIllusion.view.every.max` without a view event within
`view.reach`: a plaza, an oculus, the deck's edge, a landmark tower, an arcade, a hall, a fan, a wall tower), S6 (the
city's sound loops at most `scaleIllusion.sounds.maxPerCity`).

The facade and skyline family (`forms-facade.mjs`, order 30, its header lists its rules; tests:
`test/134-gen-forms-facade.mjs`). It reads every form placed before (a deck pier in a front is that front's relief,
the fusion band its roofline, a fused lot caged by the deck gets no cage here) and keeps clear of them. Every instance
carries `palette` (its lot's district) and `role` (its lot's trim or wall role from 06, the capitals the district's
gold trim; never a layer's frame role), `on` (the lot, building or colonnade), `face` and `side` where it stands on a
street face. Kinds: `pilaster` (F13: `width`, `depth`, `pattern` pier | lesene: a giant pilaster or a lesene),
`buttress` (F13: on an msr building's public faces, a foot and a slope), `balcony` (F14: a loggia, `storey`),
`gallery` (F14: round a poor dense district's court, `storey`), `bay` (F15: `storeys`), `cage` (F15: cage or box,
`storey`), `setback` (F16, world: `tier`, `top`, `inset`), `corner` (F17: `node`, `corner`, `treatment` turret | drum |
pier | quoin | buttress, `variant` full | raised | ground storey), `pipe` (F18: a drop pipe, a wall-run pipe, a band pipe
in the fusion band; `runs`, `drops`), `dome` (F22: `over` (the room), `overKind`, `across`, `top`), `tower-crown`
(F23: `silhouette`, `top`), `roofline` (F24: `roofForm`, `top`), `capital` (F27: `side`, `around` (its colonnade)). A
form may carry `raised: true` (its standing parts lifted over the hull's head where they cut a walk). **Allowances**
(the notes' trade 3, 2026-11-02): an instance may carry `allowance` (its brushes already in the description's
estimate) and `allowanceOf: { building, kind: facade | tower }`: a form on an enterable building is paid from that
building's facade allowance (`ESTIMATE.facadePerCellStorey`: a brush a cell of perimeter a storey; the adapter then
draws its windows as texture), a tower's crown from the crown and cap of `ESTIMATE.tower`. `measures.budget.brushes`
adds `allowance` (the brushes taken back) and counts the forms less it; the common gate holds every claim within its
instance's brushes and each building's claims within what the estimate gives it (`allowanceFaults`). Its gate checks:
the palette (a district's role, never the frame's), every part clear of every other form (a drop pipe may tee into a
run), M8 (no stretch of a street face unbroken in one material past `facade.unbroken.ground` in the ground storey,
`facade.unbroken.upper` above), M9 (relief at least `facade.trim` deep; every storey of a lot's front with an element
`facade.bandRelief` deep; every front at least `facade.major` long with an element that wide or deep; a front or band
half masked by what the stages before placed or keep clear before it is a note), M10 (every convex block corner at a
node with a corner piece or an entrance; no two lots' corners at one junction, or flanking one mouth of a plaza,
alike; a corner masked by a hallway or another family's form is a note), M11 (neighbours differ in
`massing.minDiffer` traits; a massing at most `massing.maxRepeatShare` of the tile's lots), M12 (every face under the
sky: `skyline.minHeights` roof heights a `skyline.window`, at most `skyline.maxRun` in a row), M19 (a tier only to a
carve height of the tile-layer), F16 (a tier `setback.inset` in from every street face), F22 (a dome under the sky over
a room of `dome.over`), F27 (a capital in its column's top), M13 (each top-layer district centred in the tile with a
landmark `landmark.minStoreysOver` storeys over its median roof; a silhouette kind once a layer). Budget: the forms no
check holds (the capitals, all of a colonnade or none; the wall-run pipes) only within what the tile has left under
its limit; the rest past it is the family's failure.

**For the measure stages on the compiled map (12 and 13), the sight-ray checks of section 7 not judged here:**
- V1, every long sight line ends in depth: of the level rays `measure.mjs` casts from each public place (16 a place,
  at eye height, 64 units over the floor), each longer than 11 cells (1,408 units) must end in the sky, inside a
  backdrop pocket or road of 09's `world.edge` (it leaves the city's bounds into their carved air; models are not in
  the BSP, so the pocket is the test), on a face of a `card` or `gate-road` part's brush, or on a facade or frame
  face with relief (a face of a form's brush, or a world face within 4 cells of one); never on the outer rock's bare
  face. A failure names the place, the ray's bearing, its length and the face it ended on.
- V2, never the whole: from each public place the share of its layer's public floor (the walk's cells) in direct
  sight (the rays above plus a 64-ray fan, the visible floor cells) at most 20 %, named views excepted.
- V5, the backdrop drawn: each `card`, `backdrop` model, train and fog card's leaf in the PVS of some public leaf;
  every brush entity of the forms (cards, fans, grates, light shafts, searchlights, trains) touching at most 24
  leaves (BSP2); the leaves counted from the compiled tree.
- V6, life: from each district's main plaza at least one moving or blinking thing (a `fan`, a train's
  `path_corner` line, an `env_sprite` with a `renderfx`, an airship model) with an unblocked ray from eye height to
  its origin.
- M21 on the map: from every public place under the sky, no level ray toward the city's edge reaches the sky before
  the wall, a tower or a card (the description-level part is held here).

## 10 `10-geometry.json` and `<tile>.map` (stage `geometry`, the Xash adapter)

Reads the description, the rulebook, `01-site.json`, `02-lots.json`, `04-network.json`, `05-plans.json`,
`06-palette.json`, `07-wiring.json`, `08-dressing.json`, `09-forms.json`. Code: `stage10-geometry.mjs` (the stage,
`sourceChecks`, `tileLimits`), `geometry-xash.mjs` (`buildTile`: its header lists the written rules),
`geometry-textures.mjs` (the roles to on-client textures and the audit; the record `levels/art/client-textures.json`),
`geometry-pictures.mjs` (the R2 pictures; `node levels/tools/geometry-review.mjs <out> [--png dir]`). Built on SMAK's
GoldSrc side: `carvePlan` (src/maps/ground.mjs), the brush and entity builders and `writeMap` (source.mjs),
`checkPlan` (plan.mjs), `planOfSource` and `sectionOf` (draw.mjs). Tests: `test/140-gen-geometry.mjs`.

Beside the artifact it writes `<tile>.map` (Valve 220), the tile capped at its seams so it compiles alone. A stage's
body may hand the runner such files (`body[FILES]`, artifact.mjs); the artifact records each in `files` with its
sha256, and an artifact whose file changed or went missing is stale. `generate.mjs --kit` wears the kit's textures
(`newbyzantium.wad`, listed last); `--wads <dir>` reads the clients' WAD directories for the audit; both are
`ctx.options`, recorded in the body's `options`, not in `params` (the stages before stay fresh).

| field | what |
| --- | --- |
| `tile`, `units` | the tile; `{ cell, cellUnits, origin }`: engine units x = (cells − origin) × cellUnits, z = cells × cellUnits |
| `options` | `{ kit, wads }` |
| `world` | `{ worldspawn: { skyname, MaxRange, wad } }`: 09's sky and range; the WADs the audit found the names in, on-client first |
| `files` | `[{ file, sha256, bytes, what }]` |
| `whole` | `{ written, why }`: the whole map (the nine tiles without their caps) waits for every tile's stage 10 |
| `counts` | `{ brushes, world (= structural), rock (the carve's), detail, entityBrushes, brushModels, entities, staying, worldByKind, detailByKind, entitiesByKind, entitiesByClass }`; `staying`: the entities left in the game (not func_detail, not an untargeted light) |
| `limits` | `tileLimits`: the tile's share (`tiles.maxShare`) of engine.limits' brushes, structural, rock, brushModels, entities; `detail` PLAN.md's target for a tile (10,000 × share) |
| `heights`, `maxHeights` | per layer the carve's distinct floor and ceiling heights (cells), and rock.maxHeights |
| `seams` | `{ box (units), cap, portals }`: every space clipped to the tile's box, the outer rock `cap` units thick closing each portal |
| `contract` | `{ doors, buttons, lifts: [{ name, stops }], lights, sounds, spawns (07's order), managers, cells: [{ name, bars, gap_m, front_m } | { name, fallback: "masked" }] }` |
| `targetnames` | every targetname in the map |
| `textures` | the audit: `{ record, kit, wads, textures: [{ name, wad, roles, uses }], unresolved, tooLong, standIns: [{ role, wanted, used, why, uses }] }` |
| `checks` | checkPlan's `{ errors, warnings, facts, leak }` (range engine.limits.extent, starts info_player_deathmatch) |
| `sourceNotes`, `sourceFailures` | `sourceChecks`' sentences |
| `notes`, `dropped` | what the build noticed; things outside the tile's box left out |

Gate: checkPlan's errors (a brush no sound convex solid, a key or value the formats cannot hold, a point entity with no
place or past the extent, no spawn) and its leak hint; brushes, structural (world) brushes, carved rock, brush models
and entities that stay within the tile's share; the carve's heights per layer within rock.maxHeights; every texture in
a WAD the clients have (or the kit's, with `--kit`), at most 15 characters; every name of 07 (doors, switches,
switchable lights, named sounds, lifts with their stops and call buttons) in the map and 07's spawns placed; every
targetname at most `wiring.maxNameLength` (31) of letters, digits and `_`, on one entity (lights and sounds that answer
one name aside), every target answered. Notes: detail past PLAN.md's target, the stand-ins, brushes off the grid,
func_detail hanging, the faces the facades re-wear, the spaces moved onto a layer's heights.
