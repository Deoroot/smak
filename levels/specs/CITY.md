# City descriptions (`smak-city-description/1`)

A large roleplay city written as numbers and closed rules a generator follows exactly, and checked with no
geometry. The room-graph format (`smak-level-description/1`, README.md) describes one level's spaces; this one
describes a city of layers, districts, streets, buildings and homes, and is built tile by tile.

```
node levels/tools/check-city.mjs levels/specs/newbyzantium.json [--bands file.json|rp-provisional|none] [--json out.json] [--verbose]
```

```
node levels/tools/city-portals.mjs levels/specs/newbyzantium.json [--write] [--list]
```

Code: `levels/lib/city-description.mjs` (format, defaults, validation, the walk graph), `levels/lib/city-checks.mjs`
(the rules, the budget estimate with its rock term, bands, `RP_CITY_PROVISIONAL`, `cityPortals`). Tests:
`test/121-city-description.mjs`, `test/122-city-prep.mjs`.

## Units

Every length and height is in **cells**: `grid.cell` metres = `grid.cellUnits` engine units (New Byzantium: 1 cell
= 128 units = 3.25 m). `grid.storey` is a storey floor to floor in cells (1.5 = 192 units). `grid.origin` is the
cell at the world's origin. Halves are allowed everywhere.

## The hierarchy

```
city ── tiles (coarse grid: built, budgeted, rebuilt alone; seams crossed only at portals)
     └─ layers (level 1 = lowest; z range, ceiling, wealth, bounds)
         └─ districts (theme, palette, wealth, wear, density, area)
             ├─ streets: nodes (junction, plaza, gate, service, end) + segments (avenue … service)
             ├─ blocks (lots; the lots without an enterable building are facades)
             │   └─ buildings (type, variant, footprint, storeys, homes, rooms, owner, sign, palette)
             │       └─ rooms (kind: count; sizes from the room table)
             └─ connectors between layers (stairs, ramps, lifts, shafts, secrets), checkpoints on them,
                secrets, required places, the housing table, rules, the engine's limits
```

### Top level

| field | what |
| --- | --- |
| `format`, `name`, `title`, `for`, `style: { kind: "rp-city", theme }` | identity; `kind` picks the default bands |
| `grid: { cell, cellUnits, storey, origin }` | the units above |
| `extent: { x, y }` | the city's square, cells |
| `players: { target, min }` | the homes table must sum to `target` |
| `spawns: { count, minSpacing, where }` | spawn points (public ways only) |
| `wiring: { switches, switchableLights, … }` | counts the generator must place |
| `vehicle: { optional, status, width, length, height, turningRadius, margin, system }` | the design vehicle, cells: an **optional reservation** (see Vehicles) |
| `tiles: { size, origin, cols, rows, names, portals }` | the coarse grid; tile ids `c<col>_r<row>` (x, y) |
| `materials: { role: { look, textures? } }` | every surface role; a texture name under one role only |
| `sharedPalette`, `factionPalettes: { owner: {slot: roles} }` | roles allowed city-wide (roads, street names) or to one owner group's buildings anywhere (the MSR) |
| `layers`, `districts`, `streets`, `blocks`, `buildings`, `connectors`, `checkpoints`, `secrets` | below |
| `housing: { groups, doorNaming, target, price }` | owner groups, door names, homes per layer and class |
| `required: [ … ]` | places that must exist with their programs |
| `roomSizes: { kind: [w, d] }` | override the room table |
| `buildingTypes`, `housing.classes`, `streets.classes` | override the default tables |
| `rules`, `engine` | below |

### Layers
`{ id, level, name, z: [floor, top], ceiling: sky|slab|vault|deck, wealth: slum|low|mid|high|elite, bounds:
[x0, y0, x1, y1], gated?, sky?, frame? }`. Levels consecutive from 1; a layer's floor at or above the top of the one
below. `deck`: roofed by the layer above where it covers, sky elsewhere. `sky`: the sky lid's height (cells) where the
layer is open (a `sky` layer everywhere, a `deck` layer outside the layer above's bounds), at or above its top; the top
stays the top of what is built and walked on it (storeys, monuments), the lid is where towers, domes and the backdrop may
rise; a deck layer's ring and the layer above share their air over the deck's edge, so where its lid rises past the
upper floor the two lids are one. Default: the top. `frame`: the material role the mega-structure's frame wears on the
layer (stage 9's piers, girders, deck edge: M20), one of `materials` and no district's. `gated: true`: every public connector arriving on the layer
is in some checkpoint's `controls` (a private, keyed way is not public and is not asked for; it does not count for
the public walk either).

### Districts
`{ id, name, layer, theme, wealth, wear: 0..3, density: sparse|medium|dense, area: [x0, y0, x1, y1], palette }`.
`palette` has every slot: `wall, floor, ceiling, trim, door, window, sign` (material roles), `light` (colours in
words or hex), `sound` (sound names). **Closed set**: a building or street uses its district's palette, the shared
palette, or its owner's faction palette, nothing else.

### Streets
Nodes `{ id, layer, at: [x, y], kind, district, size? (plaza), cornerRadius?, name?, program?, outside? (gate),
portico? (plaza), monuments? (plaza) }`. A plaza's `portico`: a colonnade of that depth (cells) along its edges, its
columns on the inner line at the rulebook's pitch, none across a way's mouth (a way's own porticoes meet it); its
`monuments`: `[{ id, kind: column|statue|obelisk|fountain, name?, at, base: [w, d], across? (the shaft), height }]`,
each on the open floor inside the porticoes.
Segments `{ id, class, from, to, district, name?, length?, width?, sidewalk?, portico?, lanes?, clearance?,
vehicle?, access?, winding? }`, one layer each; `length` (a winding way) at least the straight line. `portico`: a
colonnaded covered walk of that depth (cells) along each side, inside the width and fronted by the shops; the
carriageway is the width less twice the larger of the sidewalk and the portico (two porticoes must leave some).
Its columns stand on the portico's inner line each side (set back by the kerb), at the rulebook's pitch, none across
a side way's mouth, clear of the portals' mouths at the seams and of the doors under it (the generator's stages 1
and 4); the estimate counts them and their vault where they stand.
Segments sharing a `name` are one way (the grand avenue rule reads it).

| class | width | sidewalk each side | vehicle | lanes | clearance | access |
| --- | --- | --- | --- | --- | --- | --- |
| avenue | 6 | 1 | yes | 2 | 3 | public |
| street | 4 | 0.5 | yes | 2 | 2.5 | public |
| alley | 2 (New Byzantium: 1.25) | 0 | no | 0 | 1.5 | public |
| canal | 8 (water between two quays) | 1.5 | no | 0 | 2 | public |
| catwalk | 1 | 0 | no | 0 | 1.5 | public |
| service | 1.5 | 0 | no | 0 | 1.5 | msr (the MSR's hallways) |

### Blocks and buildings
Block `{ id, district, size: [w, d], lots, edges: [segment or node ids], fill: facade }`. Building `{ id, type,
variant, district, block, frontage (its door's street: a segment or node), at (footprint centre), footprint: [w, d],
storeys, interior (enterable), owner, sign?, units?: { class: count }, rooms?: { kind: count }, palette?: { slot:
role }, passages?: [{ to, access, length, type }], tower? }`. `tower: { storeys, silhouette: round|octagon|square,
across, at? }`: a shell over the building's roof, its storeys not enterable (no rooms, homes or doors: no count of
enterable buildings sees it), no wider than the footprint; a round one built as a sixteen-sided prism.

| type | footprint (cells, min – max) | storeys | homes by default | room program by default |
| --- | --- | --- | --- | --- |
| manor | 8x8 – 16x16 | 2–3 | 1 manor | great-hall, kitchen, study, cellar, garden |
| house | 3x4 – 6x8 | 1–3 | 1 house | — (give it) |
| apartment | 4x6 – 16x20 | 2–6 | its `units` | lobby, stairwell (+ each home's rooms) |
| huts | 4x4 – 20x12 | 1–2 | its `units` (hut) | — |
| shop | 2x3 – 5x6 | 1–2 | | shop-floor, backroom |
| double-shop | 4x4 – 10x8 | 1–3 | (flats over it if given) | shop-floor 2, backroom, storeroom |
| factory | 8x10 – 20x24 | 1–3 | | factory-floor, office, storeroom 2, loading-bay, catwalk |
| workshop | 3x4 – 8x10 | 1–2 | | workshop, storeroom |
| bar | 4x5 – 10x12 | 1–3 | | barroom, backroom, toilet, cellar |
| public | 5x5 – 16x16 | 1–3 | | hall, office |
| msr | 6x6 – 24x24 | 1–6 | | lobby, office 2, guard-post |
| insurgent | 6x6 – 16x16 | 1–2 | | bunkroom, armory, war-room |

Home classes (cells, rooms): hut 1x2, 1 (level 1 only); slum 1x2, 1; flat-s 2x2, 1; flat-m 2x3, 2; flat-l 3x4,
4; house 3x4, 4; manor 8x8, 10 (level 3 only). Room sizes for rules and estimates: `ROOM_SIZES` in
city-description.mjs (a cell 1.5x2 = 192x256 units, an office 3x3, a lobby 4x4; anything unnamed 2x3).

### Connectors, checkpoints, secrets
Connector `{ id, type, stops: [lowest, …, highest], length?, width?, access?, name?, site? }`, stops node or
building ids one level apart each (a lift of three stops is one connector, two links). `site: [x, y]`: where its
well or shaft is wanted (the generator looks there first). A stair runs on the axes (`circulation.axial`): one
straight leg when its stops share an axis, else an L of two legs turning at a landing, else a switchback well.

| type | rule | vehicle |
| --- | --- | --- |
| grand-stair | rise / length ≤ 0.75 | no |
| stair | ≤ 0.75 (the architecture rulebook's pitch, `levels/rules/architecture.json`, read by the checks: neither stair kind may be steeper; a stair through several stops is held whole, its rise over its `length`) | no |
| ramp | ≤ 0.15, width ≥ one lane | yes |
| lift, ladder-shaft | stops one over the other (within the tolerance, + half a building's footprint) | no |
| secret | a hidden stair or tunnel; not counted as a way between layers | no |

Checkpoint `{ id, node, controls: [connector, gate node or border segment ids], program: { gate, guard-post,
holding-cell, vehicle-gate? }, reason }`: stands at a stop of what it controls, says why (policing need), and is
reached from the Nexus by the MSR's own network. Secret `{ kind: door, in: building }` (a hidden room behind a
door in the wall's own texture) or `{ kind: passage, from, to, length }` (one layer; between layers use a secret
connector).

### Housing, door names, required places
`housing.target: { layer: { class: count } }` sums to `players.target`. `doorNaming: { home: "{building}_{unit}",
business: "{building}", cell: "{place}_cell{n}" }`: every home, business and cell door gets one name, which is the
key an RP plugin hands out. `required: [{ id, building | node | type (+ district, min), program: { kind: min },
units: { class: min }, reaches: [ids], outside? }]`.

## The rules (`rules`) and the checks

Each check FAILs with a sentence naming the thing and the number it wanted.

| check | rule keys |
| --- | --- |
| valid, field by field | — |
| every node, public segment, building and district reached on foot from the gate, public ways, no secrets | — |
| vehicles: every vehicle segment driven to from the gate; the gate on a road; carriageway (width − 2 sidewalks) ≥ lanes × (vehicle width + 2 margin); clearance ≥ vehicle height + margin and ≤ the layer's height; at each turn over `straightUnder` degrees, corner radius + the narrower carriageway ≥ turning radius (a plaza's corner is half its size); ramps one lane wide; a road on every listed layer | `vehicles.{straightUnder, layers}` |
| layers: per adjacent pair ≥ `minPerPair` public connectors of ≥ `minTypesPerPair` kinds, and ≥ `minPerPair` besides ramps (nothing depends on vehicles), a ramp if `rampPerPair`; grades; shafts vertical; every node and building ≤ `maxWalk` cells (public ways) from a public connector; the p90 walk from public floor to the nearest public connector ≤ `p90Walk` (below) | `connectors.*` |
| homes: supply per layer and class ≥ the table; classes on their levels; homes fit at `fill` of footprint × storeys; homes ≥ players; homes ≥ `minHomeShare` of properties (a double-shop counts two) | `housing.{fill, minHomeShare, businessTypes}` |
| buildings: enterable per layer ≤ cap; enterable ≤ `maxEnterableLotShare` of all lots (the rest facades); a block's buildings ≤ its lots, ≤ `blockFill` of its area, in one tile, fronting its edges | `buildings.*` |
| variety: a variant used ≤ `maxVariantRepeats`, a sign ≤ `maxSignRepeats`; signed types carry a sign | `variety.*` |
| palette: roles per slot ≤ `maxPerSlot`, per district ≤ `maxRolesPerDistrict`; no surface outside its closed set; a texture under one role; two districts of a layer share ≤ `maxSharedWallFloor` of walls and floors; wear falls and wealth rises going up (`decayDownward`) | `palette.*` |
| density: dense districts ≤ `maxDenseShare` of a layer; apartment blocks in ≤ `maxApartmentDistrictShare` of districts; plazas per layer ≥ `minPlazasPerLayer` | `density.*`, `space.*` |
| squares (the rulebook's `dimensions.squares`, `porticoes`, `monuments`): a plaza's open span inside its porticoes ≤ `maxOpenSpan` (68.45 m, L4D2's p90 sight); a plaza wider than `maxUnframedSpan` (50.67 m, the median sight) has a portico and a monument; its floor ≥ `minArea`; a portico ≥ `porticoes.depth.min` deep; a monument's base ≤ `maxBaseShare` of the open floor, under its layer's top, `clearAround` from every building and from the portico | the rulebook |
| towers (`dimensions.towers`): the crown ≤ the lid over it less `topClearance` (the layer's `sky` where it stands under the sky, its top under a roof); inside its building's footprint and its layer's bounds; its shell ≤ `maxBrushes` | the rulebook |
| axial (`circulation.axial`): a stair or grand stair between stops on neither axis is built as an L along them: the L (the stops' offsets) ≤ its length and an exit's reach (6 cells) at each end | the rulebook |
| the grand avenue: some way carries its `name`; each of its segments ≥ `minWidth` wide with porticoes ≥ `minPortico`; no other way wider than its class (it alone is widened) | `space.grandAvenue: { name, minWidth, minPortico }` |
| the MSR: the Nexus holds ≥ `nexusCells` cells; its own lifts and hallways reach every listed layer and building and every checkpoint; a service hallway ≤ `maxServiceRun` between nodes (a post, office or room at each), ≤ `maxServiceTotal` in all; service ways closed to the public | `msr.*` |
| checkpoints: each with its program, a reason, at a stop of what it controls; per layer pair ≥ `minPerPair` connectors under a checkpoint; the gate under one; ≤ `max`; on a `gated` layer every public connector arriving there under one (the failure names the connector and its stop) | `checkpoints.*`, `layers[].gated` |
| placement on the plan (as the plan pictures draw it: a footprint `[w, d]` centred on `at`, w along x; a way a straight band of its width node to node, cut at a plaza's edge; a plaza or sized gate a rectangle; a junction its widest way): a building inside its district; not more than `overlap` cells into a way, a plaza, a gate or a junction other than its frontage; its door ≤ `maxDoorGap` cells from its frontage's edge; no two buildings of a layer overlapping; no two ways overlapping away from the nodes they share (two bands leaving a node part after reach / sin of their angle; nearly parallel ones never part: a road inside a canal), winding ways and service hallways left out. Each failure names the building or ways and the cells | `placement.{maxDoorGap 1, overlap 0.25}` |
| required places: present, with their programs, homes and reaches | `required` |
| secrets: doors ≥ `minDoors`, passages and secret connectors ≥ `minPassages`, ≥ `minPerLayer`, ≥ `minInNexus` doors in the Nexus, ≥ `minInHomesAndShops`; each found from a public way; each hidden room reachable | `secrets.*` |
| rooms: narrow side ≥ `minSide` (`minSideSmall` for the `small` kinds); median room ≥ `medianSideUnits` across | `rooms.*` |
| doors: name patterns complete, no name twice, ≤ `maxNameLength` | `doors.*` |
| spawns ≥ `min`; wiring counts in their bands; lifts ≥ `min`, one with more than two stops | `spawns`, `wiring`, `lifts` |
| tiles: nodes ≥ `seamMargin` from a seam; a building in one tile (its footprint as drawn); every seam crossing (segment, connector, secret passage, MSR passage) has its portal (within `portalTolerance`); no stale portal; inside each tile everything reaches one of its portals; each tile ≤ `maxShare` of every budgeted limit (faces, brushes, leaves, entities, clipnodes, brush models, light data, structural, rock) | `tiles.*` |
| rock: each tile's carve, layer by layer, cut at ≤ `maxHeights[layer]` distinct floor and ceiling heights on the half-storey grid | `rock.maxHeights` |
| engine: each estimate ≤ its limit or target (a note past `warnShare`) | `engine.warnShare`, `engine.limits` |
| bands (`--bands`): each metric a bands object names | — |

**The walk to a connector.** `maxWalk` holds the farthest node or building; `p90Walk` holds the floor, as the
rp-city corpus measures it (`toConnector`, levels/notes-rp-city.md): the walk from every cell of public floor to the
nearest public connector (not secret, not the MSR's), pooled over the layers, area-weighted, its p90. Every public
way except service hallways is sampled at each cell of its length, weighted by its walked width (a canal by its two
quays), the walk along it from its ends or its middle (where its buildings open); the part of a way inside a plaza
is the plaza's. Each plaza cell not under a building walks straight to where a way leaves the plaza (or to a
connector standing on it), then along that way. A failure names the ways and plazas holding most of the floor past
the p90, where a connector helps most.

**Seam portals: `city-portals`.** `levels/tools/city-portals.mjs` regenerates `tiles.portals` from the streets and
the tile grid (`cityPortals`): every seam a segment's straight line crosses, at the crossing rounded to 0.1 cell, id
`p_<segment>` (`_1`, `_2` along it for more than one); every connector, secret passage and building passage whose
ends stand in two tiles, a portal at each seam the straight line between its stops crosses (`p_<id>` or
`p_<building>_<to>`, `_1`, `_2` when it crosses more than one, as at a tile's corner), at the crossing; each with
`seam: "<tile>|<tile>"` naming the two tiles that seam parts, in the description's order. It prints IN STEP or STALE with each portal added (+), removed (-) or moved (~), exit 1 when stale;
`--write` rewrites only the `portals` list in the file (one portal a line, the file's own indentation and line
ends), the rest byte for byte. Run it after moving a node or adding a crossing; `check-city` fails what it would fix.

## Vehicles: an optional, unbuilt dependency

A city may reserve car-capable roads: widths, grades, turning room, clearances, garages, held by the vehicle
checks when `vehicle` is given. Cars themselves are not assumed: for H9 there is no car model and no driving code
(both would be built game-side, outside SMAK; reTS's only drivable entity is `func_tracktrain`). So `vehicle.optional:
true, status: "unbuilt"` and two rules keep the city whole without them: every place is reached on foot (ramps are
walkable), and every layer pair has `minPerPair` public connectors besides its ramps. Drop `vehicle` and the road
checks are skipped; nothing else changes.

## The engine budget

`engine.limits: { name: { value, source } }`, held whole-city and per tile. The estimate (`ESTIMATE` in
city-checks.mjs, overridable in `engine.estimate`) is coefficients per element: a room 30 faces + 6 for its door, 8
brushes (about 4 its share of partitions and slabs, 2 its door frame, `room.dressingBrushes` 2 "a little dressing",
which stage 8 replaces by the brush props it places: dressing.mjs `brushBudgetOf`), 1 door entity and brush model; facades 4 faces and 1 brush per cell of perimeter per storey; streets 12
faces, 3 brushes per cell of length; plazas 0.6 faces per cell², a square's colonnade a brush a column (one a
pitch along its inner line, none in the ways' mouths) and its vault a slab a side and one a mouth, a monument 3; a
tower's shell 3 brushes and one a storey (structural: it hides what stands behind it; under the sky it cuts no rock); stairs, ramps, lifts, shafts by type; a
checkpoint 220 faces, 60 brushes, 4 entities plus a door per cell; clipnodes 2.2 per brush; lightmap 3 bytes per
16x16-unit luxel of surface; textures 2 per role at 88 KB; entities add spawns, looping sounds and the wiring.
**Rough on purpose**: set the coefficients from the first tile built and compiled.

**The rock term** (PLAN.md, "Brush economy"; `ESTIMATE.rock`, **provisional**: every coefficient is to be fitted to
the first compiled tile, the Core). The carve of each tile and layer is sliced at each distinct floor and ceiling
height, snapped to the half-storey grid (`grid.storey / 2`) from the layer's floor: the layer's floor and its lid (its top; a sky layer's `sky`; a deck layer's `sky` too in a tile holding some of its open ring), each
way's ceiling (its clearance) where it is roofed (a vault or slab everywhere, a deck under the layer above's bounds,
the sky nowhere), each building shell's top (its storeys; the floors inside are detail slabs). Each band costs
`perCornerBand` (1) brush per corner of the outlines cut in that tile and layer: a way 4 (half at each end's tile;
a winding way 4 more every 8 cells of its length), a plaza 4, a building shell 4, a connector's well 4 at each stop,
a secret passage 2 at each end, the tile's own frame 4, and 2 on each side of every seam a way crosses. **Rock** =
corners x (heights − 1) x `perCornerBand`. A building of more than 150 m² a floor keeps a structural wall for each
150 m² past the first, one brush a storey (`shellWalls`). **Structural** = rock + shell walls; it is added to the
brushes. **The leaves are UNCALIBRATED** (`ESTIMATE.leavesCalibrated: false`, said in the check's budget line):
until the Core tile is compiled they are the larger of the old term, 1.5 for every brush besides the new rock term
(the brushes the old estimate counted; the old New Byzantium BSP2 read back has 37,863 leaves for 24,910 brushes),
and the structural term, 2.2 a structural brush (detail cuts no leaf: 37,863 for about 17,200 structural brushes).
Once calibrated (`engine.estimate.leavesCalibrated: true`) the structural term alone counts. The old term applied to
every brush, rock included, would give about 25,200 for New Byzantium today, past the 25,000 limit: the Core's
compile settles which is nearer. The targets ride as `engine.limits` with `target: true`:
`structural` 8,000 and `rock` 6,000 for the city, so `tiles.maxShare` (25 %) holds a tile to 2,000 and 1,500, the
Core's caps. `check-city` prints the rock per tile and the Core's figure.

H9's limits (levels/notes-h9.md section 3, Xash FWGS + H9 patches, BSP2): extent 32,768 (±16,384 for the roam
bots' waypoints; user messages only ±4,096), brushes 25,000 of 32,768, leaves 25,000 with a full vis (or the PHS
is skipped or the load freezes), faces 262,144, clipnodes 524,288, brush models 2,048, entities 1,650 (reTS
sends indices under 2,048, less 3 a player at 64 and headroom), light data 32 MB (warns past 32 of 48), texture
data 32 MB, looping sounds 240, switchable lights 32. Brush entities in BSP2 touch only 24 leaves: doors and
gates kept compact (a gate across an avenue in two leaves). One BSP2 map holds about one New Byzantium; the
tiles divide the work and the budget, not the map.

## Bands

`--bands`: a bands object `{ metrics }`, or an rp-city style file (`levels/styles/rp-city.json`, `bands` of
`{ measure: { unit, band: { median, p10, p90 } } }`, measured from Alexandria, Paradise City and Xenon City).
The source cities are smaller than a city built for 64 players (9 homes and about 22 buildings each), so:

- **scale** measures (counts and areas: doors, walked and public floor, plazas, plaza area, buildings, homes,
  shops, lifts, connectors, districts, hidden places, spawns, named doors, cells, switches) are held as a floor,
  at least the source cities' p10;
- **shape** measures (the median room's floor, `cityRoomArea`; the alleys' width, `cityPublicNarrowWidth`) are
  held to the whole p10..p90 band;
- the rest (widths, light, junction density, repeats ...) are listed as unheld until a description can estimate
  them.

Default: `levels/styles/rp-city.json` when it exists, else `RP_CITY_PROVISIONAL` (doors >= 90, lifts >= 6, faces
>= 16,000, extent >= 4,600, height spread >= 418, ways 200-640 units at the median, enterable <= 10 a layer).

## What the generator does with it

- Places every node at `at × cellUnits − origin × cellUnits` (x, y) on its layer's floor `z[0] × cellUnits`;
  carves each segment at its class's width and clearance; a winding segment its `length`, bends between its
  nodes; plazas at `size`.
- Fills each block's lots: the enterable building at its `at` and footprint facing its frontage, the other lots as
  facades of the district (windows, a door that does not open, no interior).
- Builds each building from its type, `variant` (a facade and plan used once), rooms and homes, every room with a
  door; names doors by `housing.doorNaming`; signs by `sign`.
- Takes every surface from the closed palette (district, shared, owner's faction), the texture names under each
  role when given, never a city-wide list.
- Puts connectors at their stops, checkpoints at their nodes with their programs, the service hallways behind the
  public streets (each run broken by its node's post or office), secrets in the wall's own texture.
- Builds tile by tile; a seam is crossed only at a portal, at its position and the crossing thing's width, so a
  tile can be rebuilt without its neighbours. Each tile's compile is held to its share of the budget.

## New Byzantium (`newbyzantium.json`)

H9's roleplay city. 120 x 120 cells (15,360 units square, inside the bots' ±16,384), nine tiles of 40 (the Core,
c1_r1, holds the Nexus). Layers: **L1 The Undercity** z 0–4, vaulted, slum (the Drains, the Canal, the Hollow);
**L2 The Common City** z 5–11, deck over the middle, mid (Gate Ward with the front gate, the Bazaar, the Stacks,
Hearth Ward, the Foundry, Lantern Row); **L3 The Upper City** z 12–20 under a sky lid at z 28 (L2's open ring too), elite (the Mese and the Nexus,
Spire Heights, Palace Row, Ministry Court). Wear 2.67 / 1.5 / 0.25 bottom to top.

- Homes, 64 in the table (L1 hut 12, slum 10, house 1; L2 flat-s 16, flat-m 8, house 4; L3 flat-l 6, house 4, manor
  3), 65 built: the Bazaar emporium holds a flat-m over its shops beside its two flat-s, so its upper storey is lived in.
- Enterable buildings 10 / 10 / 9 (a third of the lots; the rest facades); every variant and sign used once.
- Streets: avenues 6 cells (768 u), streets 4, alleys 1.25 (160 u, the source cities' 4 m), canals 8, catwalks 1,
  service 1.5; **the Mese** alone 8 cells (25 m, 1,024 u) with porticoes of 2 cells (6.5 m) each side, from Ministry
  Court through the Nexus Forum to the North Terrace (`space.grandAvenue`). Roads reserved for cars (optional,
  unbuilt: nothing depends on them) on all three layers, joined by the Helix (76-cell ramp, L2–L3) and the Canal Ramp
  (40, L1–L2), every turn fitting a 512-unit turning radius. On L1 the canal leaves Smugglers' Road at the East
  Basin and runs up its own East Cut (x 113), crossed by two footbridges, so no road runs inside it.
- Connectors: L2–L3 eleven public (West and East Ascents, Bazaar Ascent, the Helix, Forum, Spire and Ministry Lifts,
  the Palace and Arcade Stairs to Palace Row, the Forum Stairs west and east, both from the Forum Gate square at the Forum Lift's foot, `n2_lift_n`, a 10 x 10
  plaza since 2026-11-01 so the two straight runs and the lift stand in one guarded square), L1–L2
  sixteen (Stacks, Cistern, Hollow, Pump, Basin, West Basin, Court and Cut Stairs, the Bazaar Steps under the
  Ministry Lift, the Canal Ramp, Freight and Drain Lifts, four manhole shafts); the Nexus's spine (a lift and a stair
  of 25 cells, as the generator builds it by the rulebook, through the Hearth precinct to the Cistern). Every stair's
  `length` is at least what the generator builds (`levels/gen/`, stage 4 fails a run more than a cell longer than
  described): the West and East Ascents, the Bazaar Ascent and the Arcade Stair 20, the Stacks and Cistern Stairs
  and the Bazaar Steps 12 and its prisoner lift; three secret
  connectors. Every place within 20 cells of a public connector (`maxWalk`; the farthest drains_house, 20), the p90
  from public floor 13.5 cells, 44 m (`p90Walk` 14).
- The Nexus Forum (R1 review 2026-11-02): 24 x 24 cells (78 m, was 28, 91 m: it read empty) at [60, 60.5], its open
  floor 65 m inside a portico of 2 cells (the Mese's) along its edges, 64 columns of which stage 4 leaves out those
  the stair wells and exits stand on; the four Mese junctions on its edges; the Column of the Republic on the Mese's
  axis north of the Nexus (2 x 2 plinth, a shaft of a cell, 6 cells high). The Nexus a round tower: 7 cells across
  on its roof at [60, 58.5], 7 storeys over its 3 enterable ones, crown at z 27 (the sky lid at 28 since 2026-11-02),
  10 brushes. The
  Forum Stairs arrive in the Forum (`n3_nexus`): switchback wells at their `site`s in its north portico either side
  of the Mese, both exits facing the axis under cp2_forum's gate on L2, 19.13 cells as built (length 19.5); the Forum
  Lift beside them, the Bazaar Ascent's well in the south portico west of the Mese. Hallways and bridges routed on
  the axes: the Core's service hallways 179.5 cells routed, the city's 273.95 of 280 counted on them, with `v2_mid`
  moved to [75, 43] (its hallway's turn east of the Bazaar Hall).
- The MSR: the Nexus (12 cells, booking, interrogation, offices, briefing, armory, lockers, evidence, three lift
  lobbies, three gates, two upper halls with three secret doors). **The upper city is gated** (`L3.gated`): all 11
  public ways up are under a checkpoint. 12 checkpoints (the `max`): on L3 the West, East and Bazaar Ascents, the
  Helix, the Ministry Lift, Palace Row's stair and the Spire Lift; on L2 the Forum gate (the Forum Lift and both
  Forum Stairs under one), the Stacks' stair with the Arcade Stair (one gate), the front gate, the Canal Ramp;
  on L1 the Cistern. The ways between L1 and L2 stay open but for those. 26 holding cells; 271 cells of service
  hallway in runs under 24 (the MSR's service nodes stand where the generator's posts do, off the public floor) (`maxServiceTotal` raised from 260 to 280 for the gates' hallways).
- Secrets 27: 18 secret doors (11 in homes and shops), 6 passages, 3 secret connectors.
- Placement: every building inside its district, clear of the ways and plazas, its door within a cell of its street
  (several moved, turned or resized: the MSR barracks and ministry beside a Helix moved to [88,38], the Hearth precinct
  on the Hearth avenue, Palace Row's townhouses on the West street, Spire manor B, the Stacks blocks, the foundry, the
  garage out of Gate Square, the Drains' warren, pawn shop, den and house); every room program fits its footprint.
- Sized to their programs (2026-11-01): the room table (`roomSizes`) brought to the architecture rulebook's typical
  areas (the defaults ran 2 to 8 times larger), and the buildings' footprints and storeys to their rooms at about 1.3
  to 1.9 times typical, so a plan leaves at most a tenth of its floor unbuilt (no courts, few terraces): the Nexus
  11 x 9 x 3 at [61.5, 58.5] over the Hearth precinct (8 x 8, one storey) for the spine, its south hall node
  `v3_hall_s` at [62, 54] so its post stands clear of the spine; the barracks 8 x 6 x 2, the ministry 10 x 6 x 2; the
  manors 8-9 x 8-9 x 2 with more rooms (bedrooms 4, studies, livings, toilets); the bars, the arcade, the clinic, the
  market, the foundry, the garage, the club, the insurgents' base and the pump house of one storey; the Stacks 6 x 7
  and 7 x 6 of three, the Palace residence 10 x 6 x 3; the Hearth terrace 13 x 6 so its houses differ from Palace
  Row's. The MSR's routed hallways then come to 279.96 cells of the 280.
- Estimate (provisional coefficients): brushes 16,054 (64 %), of them structural 3,661 (46 % of the 8,000 target):
  carved rock 3,504 (58 % of 6,000) and 157 shell walls; leaves 18,590 (74 %, UNCALIBRATED, the old term the larger);
  faces 50,599, brush models 447, entities 715, light data 6.6 MB, textures 19.4 MB (58 %). Rock by tile: c0_r0 326,
  c1_r0 416, c2_r0 310, c0_r1 582, **the Core c1_r1 888** (structural 937, against its caps 1,500 and 2,000), c2_r1 376,
  c0_r2 184, c1_r2 180, c2_r2 242. 59 portals from `city-portals` (the salon's and the clinic's secret stairs cross a tile's corner: two
  each). The Bazaar Square stands at [60, 47] so its 14 x 14 floor ends on the c1_r1|c1_r0 seam. The sight target
  `space.maxStraightRun` (11 cells, 35 m) is provisional: the generator measures and notes it, holds nothing yet.
