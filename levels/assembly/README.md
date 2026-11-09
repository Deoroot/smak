# levels/assembly: buildings assembled from authored pieces

SMAK 1.0's second way of making maps (PLAN.md, Phase 3, "What the next attempt uses"; the survey behind it in
`levels/notes-prior-art.md`). The first way, `levels/experimental-city`, computed every brush and was paused. This one:

- **the generator decides the topology, authored pieces give the shape**: a building is a room graph per storey;
  a layout method lays it on a grid; each wall edge, corner, floor and stair is a piece from a library, each piece
  made once, looked at and approved by the person;
- **joins are typed connectors**: a doorway joins only its match, an unused one is capped; a stair is one piece
  with a landing on each of its two storeys, so loose steps and doors in the air cannot be written;
- **every piece is placed relative to what it stands on** (a storey's floor), never at a computed height;
- **each step is checked as it is made**, and every iteration is walked in the game by the person.

The first target is **one building of two storeys with a stair, in Half-Life on Steam** (GoldSrc, BSP v30, the
textures of `valve/halflife.wad`, compiled with VHLT, the folder in `VHLT_DIR`, the wad in `HL_WAD`). Larger things come after it works.

**The RP maps for H9 are BSP2 from 2026-11-05** (the person's word): `levels/tools/build-site.mjs` compiles with
`-engine xash -format bsp2` unless told `--engine goldsrc` or `--format smallest`, which wants SDHLT's goldsrc fork
(`github.com/2cwldys/sdhlt`, branch `goldsrc`, built from its source; on this machine in
`C:/Herramientas/sdhlt-xash/tools`) in `VHLT_DIR`. VHLT and stock SDHLT refuse both switches. A BSP2 map loads in
Xash (H9) only, not in Steam's Half-Life.

**build-site's loop tools (Phase 0 of byzantium-02)**: `--only market,hollow` builds a slice (districts, buildings or
areas by id; the cut is filled solid, no leak; `slice.mjs`); `--detail auto|crown|off` (off unless told) is the rule that turns static
decorative func_wall into func_detail and keeps wall-like masses and the skyline's crowns in the world (`detail.mjs`;
SDHLT folds func_detail into the world entity and reads `zhlt_noclip` per brush before it does); hlvis is always the
full one, `--no-vis` leaves it out; after a compile a BUDGET (leaves, faces, static edicts, PHS MB, time per tool,
reach: WARN past 4096, FAIL past 8000) is one PASS/FAIL line with `<name>.budget.txt` beside the map. A spec may carry
`"budget": { "leaves", "staticEdicts", "faces", "range": { "warn", "fail" } }`.

## The parts and who owns them

| Part | Files | Reads | Writes |
| --- | --- | --- | --- |
| L: description and layout | `building.mjs`, `layout.mjs` | a building description (below) | a layout (below) |
| P: the piece library | `pieces/`, `library.mjs` | nothing | `pieces/hl/*.map` + `pieces/hl/library.json` |
| V: diagnostic views | `views.mjs` | a `.map` or `.bsp`, a layout (optional) | PNGs and text maps |
| N: the navmesh walk | `navwalk.mjs` | a compiled `.bsp` | a walk report |
| A: the assembler | `assemble.mjs` | a layout + the library | a `.map`, compiled `.bsp`, reports |

Each part has a `test/15x-assembly-*.mjs` of its own; `test/selftest.mjs` lists them.

## Units and the grid

- Hammer units. A standing player is 72 tall and 32 wide; a step at most 18.
- **The plan grid is 64 units.** Rooms are unions of whole cells. Walls stand **on cell edges**, 16 thick (8 each
  side of the edge line). Corners are the grid's vertices.
- **A storey is 192 from floor to floor**: storey `k`'s floor top is at `z = k * 192` (plus the building's base
  `z`); its slab is 16 thick under that; its ceiling is the next slab's underside, `176` clear.
- **A doorway spans two collinear edges (128)**, centred on the vertex between them, which has no corner post: a
  clear opening **64 wide, 112 high** from the floor top, *measured with the leaf open* (a leaf swung 90° into the room
  stands beside the opening, not in it). The entrance is the same size. (Learnt in game, 2026-11-02: a one-edge door
  left 36 between its posts and frame, and with its leaf open nobody could pass; the walk tests had passed it because
  they removed the leaf instead of opening it.) A door therefore needs a shared wall of at least two edges whose middle
  vertex no other wall meets.
- A window is centred on one 64 edge: opening 48 wide, sill at 40, head at 120. Its glass is a `func_breakable`
  (material glass): it can be broken and climbed through.
- **A doorway's open leaf cuts the first row on its hinge side.** Every door piece hangs its leaf on the left of one
  walking into the room it swings into (`open.hinge` at x 32 of the piece's 128), and the leaf, open, reaches 74 in,
  past the first row: along the wall beyond that end of the doorway the room is reached only round the leaf's tip,
  through the second row. `leafCut` names the cells of the swing room it cuts off, and `checkLayout` fails them
  (learnt in smak_byz01, 2026-11-03: a tenement's hall went on beside its entrance one row deep, and its two rooms
  were behind the open leaf).
- **No two doorways sweep a cell in common**: a leaf sweeps the 2 rows of its swing room in front of its 2 edges;
  two doorways that share such a cell stand in each other's way (learnt from house-02 seed 16, a kitchen's two doors
  at one corner), and `checkLayout` fails them.
- **Every passage is measured as the game will have it**: the walk tests run on a variant of the map in which every
  door leaf is world brush at its open position, and each doorway's clear width with its leaf open is at least 48.
- Stairs: rise 16, tread 24, 12 risers a storey. The stair piece (`stair-u`) fills a **stairwell of 2 x 4 cells
  (128 x 256)**, a U-turn: flight 1 up the left lane (x 0..64 in the piece's frame) to a landing at 96 across the far
  end, flight 2 back down the right lane (x 64..128) to the upper landing at 192, which **the piece itself carries**
  (the near row of cells, y 0..64, both lanes), with its own rail over flight 1. Both connectors are at the near short
  end, y = 0, facing -y: `stair-foot` at [32, 0, 0], `stair-top` at [96, 0, 192]. Foot south is turn 0, east 90,
  north 180, west 270. Only this hand is made: the layout puts flight 1 in the lane this hand gives. **The edges
  inside the stairwell belong to the piece**: the assembler draws no wall or rail there. Floor cells go under all of
  the stairwell on its lower storey and nowhere in it on its upper storey.

## The building description (`smak-building/1`)

```json
{
  "format": "smak-building/1",
  "name": "two-storey-house",
  "seed": 1,
  "footprint": { "cells": [10, 8] },
  "storeys": 2,
  "stair": { "at": "auto" },
  "rooms": [
    { "id": "hall", "storey": 0, "kind": "hall", "area": [6, 10], "entrance": true },
    { "id": "kitchen", "storey": 0, "kind": "kitchen", "area": [8, 14] },
    { "id": "landing", "storey": 1, "kind": "hall", "area": [4, 8] },
    { "id": "bed1", "storey": 1, "kind": "bedroom", "area": [8, 14] }
  ],
  "doors": [["hall", "kitchen"], ["landing", "bed1"]],
  "stairFrom": "hall",
  "stairTo": "landing"
}
```

`area` is in cells, `[least, most]`. Optional: `"style": "house"` (below), `"front": "south"` (the wall the entrance
stands on), and with a style `"doors": "auto"`, which opens every room off its storey's hall or landing and joins the
pairs the style lists (the kitchen and the living room); `"blind": ["east", "west"]`, the walls a neighbour stands against
(a building in a row), which get no window and no entrance. `footprint.cells` is the building's rectangle (later: any outline of cells).
**More than one room may be an entrance** (all on storey 0): each gets its own entrance on the outside wall, as a shop's
street door and its stair hall's beside it, two properties no one passes through the other to reach. Every room is
reached from an entrance through `doors` and the stair; the check says which is not, in a sentence.

## The layout (what L writes and A reads)

```js
{
  format: "smak-layout/1",
  building, seed, grid: 64, storeyHeight: 192, base: [x, y, z],   // the footprint's least corner
  size: [cellsX, cellsY], storeys: 2,
  stairwell: { cells: [[x, y], ...], from: 0, to: 1, foot: "south"|"north"|"east"|"west" },  // the same cells on both storeys
  storeyPlans: [                                           // one per storey
    {
      cells: [[roomId | "stair" | "void" | null, ...], ...],      // [y][x]; null: outside the building
      edges: [ { from: [x, y], to: [x, y], kind, rooms: [a, b] } ],  // every cell edge with a wall on it
      //   kind: "exterior" | "interior" | "door" | "entrance" | "window" | "rail"
      //   from/to: grid vertices (an edge is one 64 segment); rooms: the room on each side (null outside)
    }
  ],
  rooms: [ { id, storey, kind, cells: n } ],
  doors: [ { rooms: [a, b], storey, edges: [{ from, to }, { from, to }], at: [x, y], swing: roomId } ],
  entrances: [ { room, storey: 0, edges, at, swing } ],   // one for each entrance room; `entrance`: the first (entrancesOf)
  //   two collinear edges, `at` their middle vertex; `swing` the room the leaf opens into, 2 cells deep in front
  //   of both edges (the open leaf reaches 74 into it); `entrance` has the same edges, at and swing
  // both edges of a door (and of the entrance) are in `edges` with kind "door" ("entrance"); no corner post at `at`
  failures: [], warnings: []
}
```

On the upper storey the stairwell's cells over the flights are `"void"` (the floor is open there and a `rail`
edge closes it); the landing at the top of the second flight is floor (`"stair"`).

## A piece (what P writes and A reads)

A piece is a small `.map` (Valve 220), authored **at the origin in its own frame**: its connector at a known point,
facing a known way. `library.json` names each piece:

```json
{
  "id": "wall-door",
  "file": "wall-door.map",
  "slot": "edge",
  "kinds": ["door"],
  "size": [128, 16, 176],
  "frame": "the two edges run along +x from (0,0) to (128,0), the middle vertex at (64,0); the wall is centred on y = 0; inside is +y; z = 0 is the floor top",
  "connectors": [ { "type": "doorway-64x112", "at": [64, 0, 0], "facing": [0, 1, 0] } ],
  "entities": true,
  "approved": false
}
```

Slots: `edge` (one 64 wall segment, by edge kind), `corner` (a grid vertex, chosen by which of its four edges have
walls: the dual-grid mask, 4 bits N E S W), `floor` (one cell of slab), `ceiling` (one cell, top storey only),
`stair` (the whole stairwell for one storey), `rail` (an edge over a void), `lamp` (a fitting with its light).
A piece's brushes are world brushes unless the piece says an entity (a door is a `func_door_rotating`, trim a
`func_detail`). Textures are names from `halflife.wad`, checked to be in it. `approved` turns true only when the
person has seen the piece's picture and said so: `approvals.json` keeps each approval with the sha1 of the piece's
`.map` as it was seen, so a piece whose shape or textures change is unapproved until it is looked at again.

## The second kit: the Mese, for The Specialists (`pieces/mese/`)

A small section of a Byzantine role-play city, after the RP cities of TS (`levels/notes-rp-city.md`) and the look the
person kept from New Byzantium (`levels/notes-h9.md`, "Worth keeping": marble, stone and gold, dark wood, "the
pillars with the stone and gold"): a stretch of the Mese, Constantinople's colonnaded main street, about 2048 x 2048,
with one small square, 5 or 6 small buildings (shops below, homes above), every door named. First target: **TS 3.0 on
Steam** (`Half-Life/ts`), BSP v30, inside +/-4096.

- **The same grid, storey, walls, doorways and stair as above** (64, 192, 16 on cell edges, 2-edge doorways 64 x 112
  clear with the leaf open, `stair-u`), so the layout and the assembler read it unchanged. A door of this kit is a
  `func_door_rotating` **opened by use, not touch** (spawnflags 256) with a `targetname` the assembler fills (one
  name a property: the RP plugin hands it out as a key).
- **Textures** from three wads: `specialists.wad` and `halflife.wad` (TS on Steam has both) and H9's
  `alexandria_msr_b4v3_generated.wad` (in H9's `ts` folder, named in `MESE_WAD`: marble, gold, fine wood), which classic TS has not: a map
  of this kit is compiled with `wadinclude` of that wad, so its textures travel inside the `.bsp` and nothing is copied
  into the game's folders. The kit names textures only (rule 7); its pictures are gitignored.
- **The new slots and kinds**, beside the house's (each in its frame as the house's pieces are):
  - `column` (a grid vertex): a column of the portico, base, shaft and gilded capital, floor to 176;
  - `architrave` (an edge): the beam over a portico's street side, column to column, 176..192;
  - `portico` (a cell): the portico's ceiling and roof over one cell, 176..192;
  - edge kinds `shopfront` (2 edges: a shop's street door, a wider frame, a sign board above it) and `shop-window`
    (1 edge: a large glass of `func_breakable`, sill 32, head 144); `facade` (an exterior wall facing the street,
    its outer face Byzantine brick and stone);
  - `floor` kinds `paving` (the street and the square) besides the rooms' floors;
  - `landmark` (3 x 3 cells): an honorific column on a plinth, as Constantine's stood in his forum on the Mese.

## The site (`smak-site/1`, `site.mjs`, `levels/specs/mese-01.json`)

Several buildings along a street, as one map. In this first version the street, its porticoes, the lanes and the square
stand where the site says (cells of 64, y north); what is generated, and measured, is each building: its program (a
shop with its back room and a stair hall on the ground storey, a landing and two flats above: `buildingOf`) laid out
by `layoutOf` with its sides blind (the neighbours stand against them) and its back open to the lane behind.

- `planSite` labels every cell (street, portico, square, landmark, paving, a building) and lays out every building;
  `checkSite` holds the style's `site` block (properties, portico depth, street width, the square, footprints not
  repeated, the homes' share); `checkSpawns` the spawns (enough, apart, on public floor, out of every leaf's swing);
  `siteLight` a compiled site's rooms against its public floor.
- **A property** is a room entered from the street or a stair hall, with the rooms behind it through doors that pass no
  hall (the shop's back room is the shop's); every leaf is named `<site>_<building>_<property>` (the RP plugin hands
  the name out as a key); a door joining two properties fails.
- `assembleSite` assembles each building with `assemble(..., { site: false, edgeKind, floorKind, doorName })` (the
  front's walls a `facade`, a shop's entrance a `shopfront` and its front window a `shop-window`, a flat's floor
  `home`), then the street: `paving` under every public cell, a `column` every 2 cells on a portico's column line,
  the `architrave` over it, the `portico` ceiling and a lamp under every third cell, the `landmark`, the spawns
  (`info_player_deathmatch`, and one `info_player_start` on the first: a game of one player, the console's `map` with
  `maxplayers 1`, looks for no other), the site's own `sun` and the sky round all of it.
- **The site's ends**: wherever public floor meets the site's edge, a blind front 3 storeys high (`BACKDROP`: the
  `wall-exterior` piece, the `facade` on its top storey) in that district's look, its outer face to the street, so a
  street ends in the city and not in the sky (smak_byz01's four street ends showed the desert skybox in the game).
- **The skyline** (slots `crown` and `front`), so a block is not a box: battlements on every roof edge over the site's
  own floor (none where two roofs meet, none over the site's edge, where nobody stands), on the walls between districts
  and their gates, and on the site's ends: the `parapet`'s wall one brush a straight run (stretched; split where the
  district changes) and a `merlon` on each edge (`merlon-both` on a wall with a street on each side: the roofs'
  merlons have no inner face); a `crown-corner` turret on each roof corner where two parapets meet; a `dome`
  (`"dome": "small"` or `"large"` on a building) on a tall drum a cell behind its front's parapet: in a block's middle
  the front's own parapet hides it from anyone close enough to see it. On the fronts over public floor (not under a
  portico's slab), a `balcony` under every other upper window and a `hood` over each home's street door, in the
  entrance's own frame (a shop's door has its sign there, and the street's glows stand at 150). The crown is one
  `func_wall` a building with `zhlt_noclip` (nobody walks the roofs; no clipnodes) and `zhlt_lightflags 2` (it casts
  its shadow); the fronts are solid. Faces nobody sees are NULL (a parapet's underside on its wall, a balcony's back).
- **The skyline's cost, and GoldSrc's faces**: GoldSrc reads a leaf's faces as signed, so a map's faces stop at 32 767 in
  practice (Xash3D reads 65 535). The first skyline of smak_byz01, a parapet and merlon brush every edge, took it from
  some 27 900 faces to 34 545 and out of GoldSrc; by runs, without the unseen faces, it is 32 280 faces and 48 437
  vertices of 65 535: fit for both engines, with some 490 faces left. More of it costs faces somewhere else.
- **Lamps and columns stand apart from the world** (one `func_wall` a building and a portico): in the world, even as
  `func_detail`, a ceiling lamp splits VHLT's world into some 46 leaves. mese-01 came to 6 164 world leaves of
  GoldSrc's 8 192 with them in it, 929 without; and to 26 735 clipnodes of 32 767 until the lamps took `zhlt_noclip`
  (9 412 after). navwalk.mjs passes a model with no player hull, as the game does.
- **An evening** (`sun` in the site): the RP cities' public floor is lit 53 to 56 of 255 at the median and their
  rooms 68 to 71; under a noon sun mese-01's street was 181 and its rooms 66. At `brightness` 28 the street is 58 and
  the rooms 66. The rule holds only for a full compile: a draft has no bounces, and its rooms fall under its street.
- **Street light** (`streetLight` in the site: `{ every, z, color, brightness: { district: n } }`, byzantium-02-spine): a plain `light` entity
  `z` over the ground of every `every`-th cell of the open public floor (street, plaza, alley, paving, square; not a portico or a
  stair), of the brightness its district says, none for a district not named. The evening's sun alone left the Spine's streets
  dark in the game (2026-11-08); the lights are small enough that a street stays dusk.
  With `spot: { cone, cone2, fade }` in `streetLight` each is a lamp post instead: a pole and flat head (func_detail brushes, 22 off the
  cell's middle so the walking graph's links stay clear) with a `light_spot` pointing straight down under the head (a pool of light with dimmer
  floor between pools: the floor's contrast was 4.5 flat-lit, 11 with pools; Valve's median 13) and, when the dress has `accents.streetLamp`,
  a glow sprite at the head so no lamp floats. `fixture: { post, head }` names the textures. Portico lamps stay plain lights.
- **Recentring** (`recentre: [dx, dy]` in the site, units, multiples of 256; `recentre.mjs`): the map is planned, assembled, dressed
  and checked in the site's own frame (cells of 64 from the south-west corner), and only written, compiled and read back moved: the
  brushes, the entities, and the RP contract (places, spawns, npcs, arenas, roaming spots, roofs, the walking graph; the graph is
  held against the compiled map in the site's frame by `unshiftBsp`). byzantium-02-spine is 4608 wide, so its far corner stood at
  4624 and the budget warned past +-4096; recentred by [-2304, -1280] its reach is the sewer arenas' z (-3200). A file the build does not write
  (a spec's shops, jobs) moves its own points by the same numbers (gen-byzantium-02-spine-files.mjs).
- **Flats over a shop** (`flats: 2..4`, `flatArea: [least, most]` on a shop-flats building): how many flats, and the size of
  each, in place of the 2 or 3 the footprint gives and 8..28 cells; for a city that wants more homes in the same footprints, and
  flats of sizes that differ from one building to the next (rooms alike in shape are limited to 20 %).
- **The walk leaves the rebuilt CLIP brushes out** (`clips: false`): their rebuild from hull 1 closed every stair's
  second flight in mese-01, where a trace of hull 1 itself stands on every tread from 96 to 192 (the rebuild's known
  fault, src/source/mapbrushes.mjs).

## The ground's heights, water and bridges (`terrain.mjs`, `levels/specs/terrain-test.json`)

A site's ground is one height unless it says otherwise (2026-11-07, Phase 0 of byzantium-02). All of it is optional, and a
site that says none of it is built byte for byte as before (byzantium-01's .map has the same md5).

- **Heights.** `z` on a district, an area, a portico or a building: that cell's ground (an area's overrides its district's;
  a building stands at one height, its district's at its first cell unless it has its own `z`). Each cell is filled with
  solid from the sky box's floor up to the underside of its paving (z - 16), so a terrace is a block with a sheer wall.
- **Joins** (`joins`): `ramp` and `stair` take their own cells (`from`, `to`, `up`: the side it rises to, `z: [foot, head]`,
  `rank: "main"` for 128 wide, else 96); a ramp is a wedge, 1:8 is the city's slope (a warning over it, a failure over 45
  degrees, where the engine slides off); a stair is treads of 16 (`landings`: flat cells shared evenly in the run, a flight
  over 8 steps wants one, a tread is 16 deep at the least, so 4 steps in a 64 cell at the most); neither is wider than the
  street it meets. `wall` (`from`, `to`: grid vertices on one line) is a retaining wall between two heights, a parapet on
  the higher side where the drop is 64 or more (`parapet: false` for none). **Two public cells at heights more than 16 apart
  with none of the three between them is a failure**: nothing joins them.
- **Water**: an area `{ "kind": "water", "surface": z, "depth": 96 }` (surface default 96 under the ground of its first cell;
  under 64 deep is a failure, a swimmer's depth, under 96 a warning): the channel is cut down, a world brush of `!gwater3`
  (the texture of the Mese's wad) fills it from the bed to the surface, and a canal with no bank, ramp or stair within 40 of
  its surface warns that a swimmer cannot climb out.
- **Bridges**: `{ "name", "from", "to", "z", "width" }` over a water area: the rectangle covers the water (the cells past
  both ends must be land at the deck's z within 16: shorter than the canal, or landing on the wrong height, fails), a deck
  16 thick under its top `z`, 96 wide at least, with parapets of 40; its underside 48 over the water at the least.
- **Culverts**: `{ "name", "from", "to", "floor", "height" }` an opening in a canal wall: a tunnel under a street (the
  rectangle's short end on the water), its floor the bed unless `floor` says (it floods), 72 high at least, the ceiling 32
  under the street at the most; a lamp every two cells.
- **With everything else** (2026-11-07, "heights": `levels/specs/heights-test.json`, test/179-assembly-heights.mjs). Every
  part of a site stands at the ground of its own cell, not at 0:
  - *The level below* (`below.mjs`, `below-levels.mjs`): a manhole, a drain, a trapdoor or a `surface` chimney is as long as its
    ground asks, the ladder, the func_ladder, the lid and the walls of the shaft running from the level's floor to the ground of
    the cell (a ladder of 512 under a district at 128); the level's depth stays absolute (S1 at -384). A stair from the street
    (`links[].street`) starts at the ground of its trench's cells (its first point's z must be it, and the trench's cells one
    height); on a varied site it goes under the paving: the fill and the sky box's floor are cut under its covered cells
    (`report.below.roofed`) and the paving is its roof (its underside, ground - 16); the open trench must have 80 of headroom
    where it ends (`street.open`, 3 to 6 cells, more for a gentler slope), its parapet stands 40 over the ground. On a site of
    one height all of it is as it was (the sky box's floor its roof, -32). *Not enough rock* is a failure with a sentence: a
    vault (a hall, a tunnel, a part of the cells) keeps 32 under the lowest ground over it and under the sky box's floor (a
    ground sunk to z -200 over a hall whose vault's top is -144 fails, a canal's bed too). A cell sewer's `stair` way (two stair-u, 384 down
    from z 0) wants its ground at 0: on another a stair from the street is a link.
  - *The dressing* (`dress.mjs`): a room's props stand on its building's floor (`groundZ`, and the second storey over it),
    glows, the rim and the backdrop's lights, the gates' accents and the sounds at the ground of their cell (a gate's the
    wall's highest, `wallGround`), a Kowloon facade at its building's base; the public floor's zones are split by height on
    a varied site, a prop on a ramp stands on the slope's high side under its box (it sinks a little rather than hangs), and
    nothing stands on a stair's treads.
  - *The site* (`site.mjs`): buildings, shells, porticoes, shaped areas (their floors 16 under their `z`), walls between
    districts, the ends' backdrop, the spawns and the light's storeys count from the ground of their cell; the fill under the
    ground is left out under a way down and under a trapdoor's cell.
  - *The RP contract* (`levels/rp`): the places, the roaming spots, the nodes, the doors, the ways down and the guards' places
    stand at the ground of their cell (`groundOf`): nodes on the floor of their cell (a ramp's along its run, a stair's at its
    tread, a bridge's deck), a ramp's or stair's links are `stair` links, a retaining wall's drop and the water are no route, a
    culvert (its mouth is the canal's wall) is none. heights-test's contract is `check rp` PASS and `npc-sim` PASS.
- **What it does not do**: a level under a canal or any ground that drops to within 32 of its vaults (the sky box's floor goes down with the
  lowest ground, and the level must stay under it); a stair from the street whose trench crosses two heights; a cell sewer's stair way on ground that is not at
  0; a prop on a stair's treads; arenas (they stand beside the city, at 0, as ever).

## Shells: a building that is its facade only (`program: "shell"`, `shell.mjs`, `levels/specs/shells-test.json`)

2026-11-07, Phase 0 of byzantium-02: some 110 of its buildings have interiors and some 60 are shells, which fill the
city's blocks cheaply in brushes, visleafs, faces and edicts. A building of the site says `"program": "shell"` (the
default is a program with an interior, `"interior"`, or any of PROGRAMS: `shop-flats` unless told):

```json
{ "id": "b", "at": [10, 19], "size": [9, 7], "front": "south", "program": "shell", "roof": "walk", "facade": "shop-flats", "seed": 1 }
```

- `facade` (a program name, default `shop-flats`): the building whose outside the shell wears. It is laid out as that
  building, with the same seed, so its walls, windows, entrance, shopfront, cornice, balconies, hood, wall lamps and roof
  stand where that building's do, in the same pieces (the shell's `blind` and `blindBelow` sides are the same too).
  `roof`: `"closed"` (the default) or `"walk"`.
- **What is left out is behind the wall.** The footprint is one solid mass (a world brush, no entity, from -16 to the roof's
  underside) that cuts visibility like a block of stone; no room, stair, floor slab or lamp. A window is a recess 8 deep
  with `GLASS_DARK` at its back (the pane and its `func_breakable` are gone); the entrance is a locked door, the real
  leaf as a world brush set back 12 out of the mass (no `func_door`, no targetname, no key). Nothing stands in a shell that
  is an entity but the crown and the facade's street lamps, which are the real building's.
- **The roof** is the real roof slab, a clean flat top, with the parapet and merlons of the skyline (a `func_wall` nobody
  collides with). `roof: "walk"` adds CLIP brushes on every open edge of the roof (`ROOF_RAIL`: 64 high, a jump of 45
  cannot clear it, 10 past the edge line and 4 within), so that a route may run over the shells; a dome on a walked roof,
  a `tower` on a shell, and a roof setting on a building that is not a shell are failures. How a player gets up there
  (a ladder, a neighbour's roof, a stair) is the site's to give; the shell does not.
- **The RP layer does not see it**: `plan.layouts.get(id)` of a shell holds no room, door, entrance, stair or storey plan
  (`plan.shells` keeps the facade for the assembler), so no property, home, door entry, place, NPC spot or walking-graph node
  is made, and the dressing and the site's checks pass it over. `checkShells(plan, contract)` (build-site runs it, with the
  contract) fails a shell that has a property or place in the contract, a node in the graph, a way down from the level below,
  an arena, or the fields `property`, `home`, `key`, `places`, `npcs`.
- **What it saves** (shells-test: one street, six buildings, 3 shells and 3 with interiors, against the same street all
  interior; build-site `--mode fast`, hlvis full; the faces drawn from 42 spots in the street, checkPvs): brushes
  5 938 to 5 373, entities 668 to 550, leaves 5 607 to 4 699, faces 16 024 to 13 736, static edicts 207 to 138, the
  PHS 7.9 to 5.5 MB, the street's median 15 480 to 13 423 faces and its p90 15 624 to 13 428. A shell is some 190 world
  leaves, 760 faces and 23 edicts cheaper than the building it stands for, and no door, home or key.
- Not yet: the dressing (`dress.mjs`) skips a shell, so a Kowloon facade is not put on one, and a shell has no tower.
## Roofs: routes over a district (`roofs.mjs`, `roofs` in a site, `levels/specs/roofs-test.json`, 2026-11-07)

A building with `roof: "walk"` is a flat roof a player may stand on, fenced in CLIP rails (a shell, as above, or a building with an
interior, with or without a `tower`; not a dome). `roofs.mjs` is what joins those roofs to the street and to each other, for the
flow design's roof layer (byzantium-02: ladders up, planks and jumps across, the drone sees it all, the guards do not follow).

```json
"roofs": {
  "ways":  [ { "id": "L1", "kind": "ladder", "building": "s1", "side": "south", "at": 3 },
             { "id": "S1", "kind": "stair",  "building": "s3", "side": "south", "at": 0, "run": 1 },
             { "id": "C1", "kind": "crates", "building": "n3", "side": "north", "at": 0, "run": 1 },
             { "id": "D1", "kind": "drop",   "building": "n2", "side": "north", "at": 4 } ],
  "links": [ { "id": "J1", "kind": "jump",   "from": "s1", "to": "s2", "at": 11 },
             { "id": "P1", "kind": "plank",  "from": "s2", "to": "s3", "at": 11, "width": 40 },
             { "id": "B1", "kind": "bridge", "from": "n2", "to": "s2", "at": 13, "span": 2 } ] }
```

`side` is the wall of the building the way stands on, `at` the cell along it (from its least end), `run` the way a stair or a
crate climb runs from its top along the wall (1 or -1). A link goes from one roof to the roof that faces it across whole cells
of air (nothing between: a building in the gap is a failure); `at` is the site's cell along the gap (the same on both roofs),
`span` the cells the opening is wide (a plank 1, a jump 1 to 4, a bridge 2).

| kind | what it is | the rules (`ROOF` in the module; the sentences are `checkRoofs`') |
| --- | --- | --- |
| ladder | the library's ladder piece on the wall, street (or terrace) to roof, a func_ladder 16 over the roof | any rise; the wall plain (no window or entrance on any storey, no street lamp), the cell outside open ground |
| stair | an outside stair of risers 16, treads 16, along the wall, a landing flush with the roof | level open ground the length of it; a step within a jump (144) of a closed roof at that roof's height is refused |
| crates | boxes 32 to 48 apart in height (40 at most) side by side along the wall; the roof is the last step | needs a rise of 64; level open ground |
| drop | the rail opened over a fall; down only | at most 192 over the ground outside (a fall hurts from 580; 192 is 554) |
| plank | a plank 32 to 48 wide across the gap (36 / 40) | at most 512 of air; roofs within a step (16); required for every gap from 160 |
| jump | the rails opened, nothing else | a gap of at most 144 (the run carries 215 for the player's middle); the far roof at most 16 higher, at most 192 lower; a run-up of 128 on the roof it leaves |
| bridge | a deck 128 wide (two cells) with a clip rail each side and a visible rail | gap 64 to 512; roofs within 16 |

**Where a way or a link meets a roof's rail, the rail and its parapet are open** for the width of the cell(s). **Heights**: a link
joins roofs within a step (plank, bridge, equal-height jump) or down a fall (a jump); a bigger climb wants a ladder, stair or
crates. `checkRoofs(plan)` (build-site runs it) also fails a walked roof nothing reaches (from the street, by the ways and
links) and a roof a player reaches and no way takes down. A site without `roofs` is built as it was.

- **The RP layer** (`contract.roofs`, `roofsContract`; `checkRoofsRp`): the roofs are for players. They are not in `paths`
  (the NPCs' walking graph holds no node on a roof and no link over one; `checkRoofsRp` fails one that does). Each way says
  `npc`: false, or `"chase"` for the outside stair, which the guards of a chase may climb; a ladder, jump, plank, bridge, crate
  climb or drop is never an NPC's. The cells a stair, climb or ladder stands on are kept clear of props and roaming spots
  (`built.report.roofs.keepClear`, read by `dress.mjs` through the same set as the level below's ways). The drone's sight is not
  touched: the roofs are open sky.
- **Proof**: `roofs-test.json` (eight buildings round a street, a terrace behind one: three ladders, a crate climb, a stair, a
  drop, three jumps, two planks, a bridge); `test/180-assembly-roofs.mjs` walks each link alone with `reachOf` over the source
  map, and, compiled, holds the rails open at the ways and links and the gaps within the run's reach.
  `roofsPicture(plan)` draws the roof level (heights tinted, the route drawn).
- **Not supported**: a stair or ladder on a wall with a window, entrance or lamp on any storey (the wall wants a plain cell), a
  link between roofs that touch or do not face each other, a link that crosses a corner, cables and zip lines, a drop onto a lower
  roof (a jump down does that), a plank or bridge between roofs that differ by more than a step, a stair or crate climb on
  sloped ground, a roof of a building with a `dome`.

## Shaped areas (`shapes.mjs`, `specs/shapes-test.json`)

An area of a site (`areas[]`) may be more than a rectangle of cells: `shape` makes it a **polygon**, an **oval** or a street
along a **diagonal**. The cell grid stays the ownership model: the area claims the cells of its bounds (`from`, `to`, as any
area; worked out from the shape when left out), and inside them the real shape is cut by angled brushes. Its points are in
**units**, whole numbers (every plane is then written with whole-number points; nothing is left for the compiler to round).

```json
{ "kind": "plaza",  "name": "octagon", "shape": "poly", "from": [35, 13], "to": [47, 25], "points": [[2465, 832], [2783, 832], ...] }
{ "kind": "plaza",  "name": "hippodrome", "shape": "oval", "from": [2, 32], "to": [26, 46], "center": [896, 2496], "radii": [736, 490],
  "turn": 0, "sides": 40, "spine": { "length": 768, "width": 128 } }
{ "kind": "street", "name": "diagonal 24", "shape": "diagonal", "line": [[1152, 988], [2176, 1444]], "width": 384, "from": [18, 12], "to": [34, 26] }
```

- **poly**: any simple polygon, convex or not, inside its cells. **oval**: `center`, `radii` [rx, ry], `turn` degrees, `sides` (even,
  8 to 64; by default edges of about 96, 2 units off the curve); larger than its cells it is cut by them, flattened where a
  street passes. `spine`: a solid island of the same kind along the long axis (the Hippodrome's), the floor the track round it.
  **diagonal**: the street's axis `line` and `width`, cut by its cells at both ends (they are its openings to the streets
  beyond), so a street at 45, 24 or any degrees runs from one street to another across a block.
- The **floor** is the shape itself (a prism 16 under the area's ground, `z` as any area's, terrain.mjs); the rest of the
  cells is a **solid mass**, `wall` high (192 unless told), whose faces are the walls facing the floor. A cell the floor
  does not touch is labelled `solid` (no public floor, no node, no start, no prop); where the shape reaches the edge of its
  cells it is open to the cell beyond. Floor, walls and spine are cut from the same whole-number corners and tile the cells
  exactly (the check measures it), so nothing leaks; no piece has more than 12 corners (hlbsp holds 28 to a face: "ReadSurfs:
  44 > MAXPOINTS" before the cut) and none is thinner than 2 units.
- `checkShapes(plan)` gives the sentences: a shape that is none of the three, fewer than three points or a corner off the
  whole numbers, an outline of points on one line or one that crosses itself, a corner outside its cells, a floor narrower
  than 96 anywhere a body fits (the widest circle), a track round a spine narrower than 96, a spine outside its oval, angled
  walls that do not seal (a brush under 2 units thick, a polygon that touches the edge of its cells at one corner only),
  and two areas on the same cells.
- **The ground**: a shaped area at a `z` meets lower ground like any: a ramp or stair at its opening (terrain.mjs asks only
  where the floor crosses the edge of the cells, not for the whole edge). **The RP layer** (levels/rp, `groundOf`): a point
  is floor only on the shape's floor, a body's half width off every wall; nodes, routes, roaming spots and the guards'
  places stand on it (a route steps only through cells whose middle is floor); the starts of a shaped street run along its axis.
- It does not do: a shape across the edge of a district (its theme is the district of its first cell), two shapes crossing
  (one area's cells are its own), curved walls taller than a storey with a roof.

## The dressing (`smak-dress/1`, `dress.mjs`, `dress/h9-byzantium.json`)

What an assembled site wears in its game: `dressSite(plan, built, dress)` gives back the entities and CLIP brushes to
add, and a report of what was placed and what found no room (nothing of `built` is changed). The dress file names
only files the game has (h9-byzantium: the H9 client's, checked when it was made, 2026-11-03) with each model's box,
facing, kind of place and whether it is solid; nothing of the game's is in it.

- **Glows** (`env_glow`, rendermode 3, as the stock TS maps make theirs, 100 to 150 a map): red on two opposite
  corners of each roof and every 8 cells along the blind fronts' tops, amber along the Nexus's fronts and at each
  checkpoint's jambs (a red stop-lamp over its middle), coloured at the Market's doors and windows, a few flickering in
  the Hollow; one in about three with a small `light`, since a glow lights nothing. Each within 32 of a surface.
- **Sounds** (`ambient_generic`, every file looped: a file with no cue plays once): by district on its public
  floor, spread farthest-first, and in rooms of a kind (the bar, the cells, the den); the regime's alarm silent until
  fired (`<site>_alarm`). H9's maps carry 1.5 to 3.6 a 1000 m2; smak_byz01 has 40.
- **Props** (`ts_model`; to a player a point, so the big furniture has a CLIP brush under it as H9's makers do, 358
  of their 1 021 props at least): each room's list (its kind's, and its district's), each prop against a wall with
  its back to it, kept off the wall's half and under the ceiling (under 105 beneath a hanging lamp, under the sill
  before a window), on cells no doorway, leaf's swing, stair or start needs. A solid one takes too the cells whose
  middle stands nearer it than half a player (17), and is set only where its room's free cells stay in one piece. On
  the public floor, against fronts with 3 cells of floor before them, 16 off the front's line (its sills and
  cornices). Not placed yet: things on a table, and anything free in a room's middle.
- **Measured on smak_byz01** (compiled, hull 1): every room's door cells reached and its free cells in one piece, 19
  cells left as pockets between furniture; the public floor in the same pieces as undressed, 45 cells fewer.

## Switches and the jail (`site.mjs`, the `switch` piece)

The first things a role-play map's players work (`levels/notes-h9.md`, "Switches that make a room live", "Jail").

- **A room's lamps on a switch.** A light with a name is switched: hlcsg gives each name a style of 32 to 63, and a map
  holds 32 of them (`map-check` refuses a 33rd); the site takes **24 at the most** (`SWITCHES_MOST`), the rest kept
  for the city's own (an alarm, a club). One name a property, `<site>_<building>_<property>_light`, over all its rooms'
  lamps (a shop's back room is the shop's); `switchesOf` chooses them: every shop first (a shop, a bar, a clinic, a
  workshop), then the homes building by building in the site's order, a building's homes all or none (a landing where
  one flat has a switch and the next has none reads as a fault). byzantium-01: 8 shops and 16 homes; the flats of
  `works` and `ms1` and the tenements' rooms go without (`report.unswitched`).
- **What goes off with the switch**: the lamps' light entities (named); the glass's texture light, by a VHLT
  `light_surface` of the same name filtered to the lamps' own entity (`_fname`), which takes its faces from
  `info_texlights` (byzantium-01, a draft, `map-light --switched off`: a flat's floor from 61..76 to 11..19 of 255, the clinic from
  95 to 3; a shop with its street windows from 105 to 63); and the glass itself, the lamps being one `func_wall` of that name a property, which when fired shows
  its textures' `+A` frame (`+A~LIGHT4A`, `+A~GENERIC86`, dark). Dress models (`lamp_chateau`) have no light and stay as
  they are.
- **The switch** (`switch`, slot `switch`): a `func_button` plate 2 proud on the wall, centred at hand height 48, inside the
  property's door from its hall, landing or street, at x 112 of the doorway piece's frame (the latch side: the leaf
  hangs at 32). Used, never touched; spawnflags 33 (it does not move, it toggles: it fires its target pressed and again
  released, and its face, H9's lever `+0SW3S`, shows the lever thrown while the lamps are off); sounds 14.
- **The jail.** The Nexus's program names its `control` room (the guard room). Its cells' doors keep their names but
  lose "use only": GoldSrc's `CBaseDoor` gives a player no use of a door without spawnflag 256 and locks the touch of
  one with a name, so a prisoner opens nothing; they take toggle (32: open until fired again). One switch on the
  guard room's wall by its door (the same piece, its face swapped to `+0SW2S`, sounds 3) fires a `multi_manager`
  `<site>_nexus_jail` that fires every cell's door: all open, and again all shut. A plugin may still fire one cell by
  its name.

## A city for chases (2026-11-06: the audit of smak_rp_byz01, its rebuild)

What a map wants when guards chase wanted players through it (`levels/rp/CONTRACT.md`, the properties and the doors' keys). Each of
these is general and opt-in: a site that does not name it is built as before.

- **A second way through a shop** (`extraDoors`, building description; `backDoor: true` on a shop-flats or venue-flats building of a
  site): a door between two rooms of one storey that `doors` does not join (the back room and the stair hall: street, shop, back room,
  hall, street is a loop). The rooms are grown side by side; the door is put after the entrances and where a doorway stands whose leaf crosses
  no other's and cuts nothing off (corners at one end at most), else none is made and the layout says so (a warning, not a failure: smak_rp_byz01
  got it in 5 of its 8 shop buildings: m1, m2, m4, the clinic, the workshop). The door is marked `extra`: it makes neither room a property of its own (the back room stays the shop's,
  its leaf named for it, `propertiesOf`); a switch goes by the street door.
- **A plain passage in a wall** (`gaps: [[x, y]]` beside `gates` in a wall of the site): the gate's frame with no leaf, nothing to name or to
  lock, joined in the walking graph (`paths.mjs` leaves its edges out of the wall).
- **Glass that does not break at street level** (`"groundGlass": "sealed"` in the site, or the assemble option): the ground storey's panes
  (func_breakable of glass) get spawnflags 1 (only trigger), so a locked door is not got round through a window; the upper storeys' stay glass.
- **Stair halls and landings 2 across** (style rule `landingWidth`, level warn, byzantium): a cell of a hall or landing in no 2 x 2 block
  of the room's own cells (the stairwell's upper landing counts as the room's) is a stretch one cell wide, 48 clear between walls and less at a
  rail's newel: where two characters in a chase meet and stop. The rule is in the layout's polish cost (150 a cell) and its sentence
  (`narrowCells`).
- **A police post** (program `post`): a counter hall (kind `counter`, circulation, the street door and the stair), a guard room (the jail's control:
  its switch frees the cell), a holding cell, and above a landing and a vault (an armory). The guard room and the cell open off the circulation
  room, so they are properties of their own (`police`, `jail`). The contract's `spawns` (`role: "guard"`) give 3 cells of a control room and 2
  outside its door.
- **Mission arenas** (`arenas` in the site, `arena.mjs`): a sealed room beside the city with the contract's targets (spawns, goal, button, crate,
  reset) and its entry in the contract's `arenas`; the missions and their giver are the site's `rp`.
- **Doors' keys by property kind** (`DOOR_KEYS`, `propertyKindOf`): a home's leaf is use-only and toggle, `wait` -1; the others use-only and back
  after 4 s; one-way (16) stays on a jail cell and a checkpoint; `dmg` 0 on every leaf. A checkpoint is a property of kind `gate`.

## Below the streets (`below` in a site, `below.mjs`, the sewer pieces)

The first level under the street (byzantium-01's sewer): measured against H9's RP cities (median 9 layers, 34 m of
height, 8 ladders) the site had 2 layers and no ladder, and the person asked for "el nivel inferior" (notes-h9.md section 5:
"can't reach lower levels", "sprawling hallways that go on forever").

- **The description** (`below` in the site): `floor`, the walkways' top (-384: two storeys, so a stair is two `stair-u`);
  `parts`, rectangles of the site's cells: `tunnel` (with `channel`, 3 across: a walkway, the channel, a walkway), `hall`
  (a `basin` of water inside a walkway's ring, `columns` at vertices), `room` (entered by its `doors` only); `ways` down:
  `stair` (2 x 4 cells from the street to half way, the lower well east of it to the floor, its foot south onto a walkway),
  `manhole` and `drain` (a shaft over a walkway, its ladder on `wall`, a lid on the street), `trapdoor` (a shaft up into a
  building's room: a den's own way down); `doors` between a part and a room (`secret`: the door piece in the tunnel's wall
  texture, named `<site>_<building>_<name>`, the hideout's key); `bars` across a dead end; `props` (the dress's ids) and
  `sounds`. Each part wears a `look`, a district of the theme (`sewer`, `cistern`, `service`, `smugglers`, `stairs`),
  may say its own `vault` (the clear height over its walkway, a whole z in 16s, 96 to 336; else its kind's 208, 288, 176)
  and its `place` (a kind the RP contract writes as the place `below_<part id>`: `den`, `fence`, `pump`, `cache`, `shrine`,
  `cistern` in byzantium-01; the plugin ignores a kind it has no role for). A level's own `rules` (below) go over the kit's.
- **Each cell a column of air** from its floor to its vault (a tunnel's 208, a hall's 288, a room's 176), a shaft's to the
  street. A floor slab under each cell, a vault over each but a shaft and the stair's upper well, both joined into
  rectangles; a wall on every edge where the air on its two sides differs: the ground beside a tunnel, the kerb over the
  channel, the step from a tunnel's vault up to the hall's, a shaft's walls over the vault; one brush a straight run, 8
  past each end so that runs close their corners; between two parts not open to each other each side its own half in its
  own look. Nothing fills the ground round it: the walls close the map and VHLT drops every face that looks out. The
  street's paving and the sky's floor under it are left out over every opening (the den's floor too, `assemble`'s
  `holes`); round the stair's opening the wells' walls stand 40 over the street as a parapet (3 brushes where the rail
  piece came to some 90).
- **The water** is a world brush of `!gwater3` 16 deep (its surface 16 under the walkway): no entity, no model; a player
  wades the channel and jumps the 32 out. `func_water` would add a brush entity a stretch for waves nobody sees.
- **A ladder** is a steel plate on its wall (its face at 12, off the grid of 8: map-reach's body at the ladder's top then
  stands on the plate's top beside its place; on the grid, with the plate's face at 8, the walk test never climbed out of
  a 48-wide shaft), the rungs (`{po_laddrust` masked, all the level's in one func_wall) and a func_ladder 16 over the top.
  It stands on a wall the ground is beyond, so that at its top the player steps forward onto the street (or the den's
  floor), not into a wall: the den's trapdoor is on the cellar's south wall, the den's floor south of it.
- **The lids**: the manhole's a func_door grate (`{grate1` masked), used, slid +x over the paving and back after 4 s; the
  drain's a func_breakable grate; the den's trapdoor the manhole's lid in the den's floor texture, named as the hideout's
  doors (the RP plugin's key opens both).
- **Light**: a caged lamp every 4 cells along a tunnel's walls, every 4 along a hall's and a room's, one in each well
  (brightness 85 and the lamp's texture light). byzantium-01, full compile: the sewer's floors 26 to 38 of 255 at the
  median (the cellar 49), the stair's wells 19, the street 52.
- **`checkBelow`**: 3 to 5 ways down, a stair, a ladder from a street, a way from each den; no opening where a player
  starts; every part reached from a way through the cells open to each other; no tunnel straighter than 24 cells
  (39 m), counted along a part and, across collinear parts that continue one another, along the row of tunnel cells open
  to each other (a hall, a turn or the side of a junction breaks it); 2 looks at least; a warning without a hall. A site's
  `below.rules` override these and may add: `ways: [least, most]`, `longest`, `loops` (cycles of the graph of parts, E - V +
  pieces: a chase can circle), `perDistrict` (a way down in every district of the site), `tunnelVault: [least, most]`,
  `vaults` (distinct ceiling heights at least), `looks`, `source`. byzantium-01 asks 6 to 12 ways, 12 cells, 2 loops, a way
  in every district, tunnels 128 to 192 high, 5 heights, 4 looks. Its broken cases are in test/broken/levels.mjs; build-site prints
  its measures. `planSite` refuses a way off its part, a manhole off public floor, a trapdoor outside its room, a ladder
  on a wall with the level beyond it, a ladder that would step off onto anything but public floor (2026-11-06: the cell
  past its wall is the one the player steps onto).
- **What it costs** (byzantium-01, full compile): faces 32 609 to 33 829 (past GoldSrc's 32 767, inside Xash's 65 535),
  vertices 48 889 to 50 622, clipnodes 20 803 to 21 852, leaves 10 679 to 11 122, brush entities 301 to 311 of 512,
  entities 1 282 to 1 338. The first sewer's portico column on a plinth in the cistern and a railing round the stair cost
  some 900 faces more; they became the stone pier and the parapet.

## Sewers on several levels (`below.levels`, `below-levels.mjs`; 2026-11-07, byzantium-02 phase 0)

The cell grammar above is one floor of rectangles. Master Sword Rebirth's sewers (and the person's word on byzantium-01:
"ninguna de las 2 tiene tantas lineas rectas") are not: tunnels bend at 45 degrees, rooms are octagons and long
cisterns of columns, there are several floors. `below.levels` draws that, in world units, beside (or instead of) the
cells; a byzantium-01 `below` with no `levels` builds as before. Nothing of MSC's geometry or textures is in the kit.

```json
"below": { "look": "sewer", "rules": { "ways": [2, 6], "stair": false },
  "levels": [{ "id": "S1", "floor": -384, "look": "sewer",
     "lights": { "amber": { "color": [255,170,80], "brightness": 150, "every": 192 } },
     "halls":   [{ "id": "weir", "shape": "octagon", "center": [320,832], "radius": 256, "height": 224, "light": "teal" },
                 { "id": "spina", "shape": "rect", "center": [1088,896], "size": [512,288], "rotate": 0, "height": 256,
                   "ceiling": "arch", "pool": { "depth": 24, "inset": 64 }, "columns": { "every": 128, "radius": 16 } }],
     "tunnels": [{ "id": "t1", "points": [[576,832],[640,832],[704,896],[832,896]], "width": 112, "height": 144,
                   "profile": "arch", "water": { "depth": 24, "strip": 0.5 }, "pipes": 1, "light": "amber" }] }],
  "links":   [{ "id": "stair-1", "kind": "stair", "points": [[1000,1040,-384],[1000,1420,-576]], "width": 128 },
              { "id": "ladder-1", "kind": "ladder", "cell": [8,3], "size": [2,2], "from": "S1", "to": "S2", "ladder": { "wall": "north" } }],
  "surface": [{ "id": "weir-manhole", "hall": "weir", "cell": [5,16], "wall": "north" }] }
```

- **A tunnel** is a chain of straight segments (`points`, each `[x, y]` or `[x, y, z]`), mitred at every point, so a bend
  of any angle to 100 degrees seals; its profile is an arched vault (a 3-segment crown) or a box; a `water` channel is a
  trench `depth` deep (ankle 16-24, knee 36-48, 96 to swim with `strip: 1`) along `strip` of its width. A point on a hall's
  wall is a mouth in it (the tunnel starts at the wall's inner face, at any angle from 30 degrees; the wall is cut round
  the tunnel's shell and gets a lintel over it); an end on nothing is walled. Where tunnels meet, a hall stands between.
  A segment whose two points differ in z is a stair: steps of 16, a sloped vault, the width of the tunnel (96 least).
- **A hall** is a convex polygon: `rect` (turned by `rotate`), `octagon` (`radius` to its walls), `poly`. Ceilings:
  `flat`, `cove` (a 45 degree cove all round) or `arch` (a rect's long sides coved: a barrel vault); a `pool` lowers
  the floor inside a walkway of `inset` (axis-aligned rects); `columns` is a grid of 8-gon piers (func_detail) kept off
  the mouths. A **ladder shaft** link is a tall 2 x 2 cell hall from the lower level's floor to the upper one's, with the
  library's ladder, a ledge under the upper mouth and a mouth at each height; a **surface** way is a chimney from a flat
  hall's vault to the street's cell (which opens the paving) with the ladder and the lid: it joins `ways` as a manhole.
- **Light zones**: a level's `lights` name zones (colour, brightness, spacing); a tunnel or hall says which it is in.
  Lamps are `light` entities with a small housing; pipes are 8-gon func_detail prisms along the walls.
- **Rules** (`checkLevels`, from `LEVEL_RULES`; a spec's `below.rules` override: `straight`, `clear`, `narrow`, `stair`,
  `loops`, `bend45`): a tunnel runs 768 units straight at the most (segments within 20 degrees added); 72 clear under the
  vault and 64 wide to walk; a stair 96 wide and its steps 24 deep; every element reached from a way down; no wall
  through another's air (a layout that crowds fails with both names); a vault's top under the street's ground (-32).
  Warnings: a level with fewer than 2 loops (cycles of its own tunnels and halls), fewer than 40 in 100 bends at 45
  degrees. With `levels` the cell rules for a stair down and the cell parts' loops do not apply (`stair: false`).
- **NPCs** (levels/rp/deep.mjs, 2026-11-07): the surface ladders are `ways` entries (kind `manhole`, `deep: true`, at the
  street cell, with `wall`), as the cell sewer's. The RP contract's walking graph has the deep levels: `sewer` nodes
  (`level`: the level's id; a stair's landings carry the stair's id) down every tunnel (a node by every point, mitred, 24
  from an end, about 112 apart) and across every hall (a grid, a ring on a pool's rim), on each level's floor + 36; a link
  only where a 32-square hull walks the straight line clear of every wall (more toward a 45-degree one), column and the
  slabs of a shaft's ledges, every 8 units, so no corner is cut through a wall and a column is walked round. Water is
  never a route: a channel with a ledge is walked on its ledge (a hull's half on a ledge of 16 is enough; a narrower one,
  or a floor all water, is a WARN naming the tunnel), a pool on its rim. A stair is `stair` links (treads, a node about
  every 96); a shaft's ladder is a `ladder` link (`way`: its id) that no NPC takes, its foot and top (`ladder`, `hatch`)
  on the two levels. `checkDeepPaths` (behind `checkPaths` and npc-sim.mjs): every node reached from the first level over
  walk and stair links, each stair of the description joining its two levels in the graph (FAIL), a level reached only by
  ladder (WARN: a guard on a chase cannot follow), the longest route in nodes under the plugin's ROUTE_LEN (320). The
  street does not reach the sewers on foot: the manholes are ladders under a lid, so no NPC walks down (the cell sewer's
  stair is a `way` too, taken by a hunting guard only). `below.places` (`[{ id, kind, hall | level + at: [x, y] }]`, the
  kind one of the contract's place kinds) and `below.roam` (`[{ hall | level + at }]`) put places (`below_<id>`) and
  roaming spots on a floor (the nearest a hull stands, within 96, 160 for a hall's middle; none is a FAIL); a spot is also
  picked in every hall and every 384 units along a walked tunnel, 256 apart, 96 off a way down. A place of a kind that
  makes a role (`shop`, `bar`, `clinic`, `workshop`: a keeper, workers) would have its people walk from the street, which
  they cannot: use an inert kind (`den`, `office`) for what is only a place below. The picture, one a level:
  `deepGraphPng(deep, paths, "S1", path)` in levels/rp/deep-picture.mjs.
- A test site: `levels/specs/below-levels-01.json` (mese-01's street over two levels: 12 tunnels and a stair, 8 halls, 2
  loops a level, a stair and a shaft between them, two manholes). Its broken cases: test/broken/levels.mjs.

## A metro under the streets (`metro.mjs`, `levels/specs/metro-test.json`, 2026-11-08)

The person, after playing the Spine: the sewers "todavia no se ven como tal ... en lugar de alcantarillas deberian convertirse en
un subsuelo o un metro". A level of `below.levels` can be a metro: the same halls, tunnels and stairs, three more words and a look.

```json
"halls":   [{ "id": "conc", "shape": "rect", "center": [928,864], "size": [320,544], "height": 192, "role": "concourse", "look": "metro", "light": "concourse" },
            { "id": "st-a", "shape": "rect", "center": [1472,864], "size": [576,544], "height": 256, "ceiling": "cove", "look": "metro", "light": "station",
              "trench": { "width": 192, "depth": 40, "crossings": [128], "benches": { "every": 160 } }, "columns": { "every": 192, "half": 24 } }],
"tunnels": [{ "id": "line", "points": [[1760,864],[2048,864]], "width": 192, "height": 176, "profile": "house",
              "trench": { "depth": 40, "ledge": 44 }, "look": "metro-line", "light": "line" },
            { "id": "pass-s", "points": [[1088,680],[1184,680]], "width": 112, "height": 144, "look": "metro", "light": "concourse" }],
"links":   [{ "id": "entrance", "kind": "stair", "points": [[192,864,0],[768,864,-384]], "width": 160, "height": 160,
              "look": "metro-stair", "metro": true, "street": { "open": 3, "arch": true } }]
```

- **A station** is a rect hall (axis-aligned) with a `trench`: the platforms at the level's floor, one each side, and between them the
  trench (192 wide, 40 deep: over a step, a drop a player takes) from end to end: a bed, two tracks (rails 4 wide on sleepers), a strip
  of yellow and black along each platform's edge, steps up out of it at each end against each platform (three treads of 13), boards
  across it at each `crossings` offset (so the two platforms are one place), benches against the back walls, square columns (48) just
  behind the edge strip, beams across the ceiling, cream lamps over the platforms and warm lamps on the back walls 150 up, a dark band
  48 high along them. The trench is a wall of the walking graph (a blocker, as a pool's bed is): NPCs walk the platforms and cross by
  the boards. Under 192 high, a trench outside 32 to 64 deep or under 160 wide, a platform under 96, a station under 384 long, none
  with a crossing, are failures (`checkMetro`, from `METRO`).
- **A line** is a tunnel with a `trench`: its floor is the bed between two walkways (`ledge`, 44) at the platforms' level, a railing on
  each, its walls vertical under a pitched roof (`profile: "house"`); it meets a station's trench at the end wall, one trench (the same
  width and depth: a failure if not), and its walkways end in a block there. Players walk it and drop into the station's trench;
  nobody else does: it is no route in the graph (`walkLine`: `none`). A line may end on nothing (the wall closes it).
- **A parked train** (second version, 2026-11-08, the person: "el metro si parece estar a medias ... el tren podria ser parecido [al vehiculo del primer
  nivel de Half-Life]"): a station's `trench.train: { side: 0 or 1, cars: 1 to 3, from }` stands cars of 384 by 120 on the track beside
  that platform, floor at the platforms' level, 10 off the edge: a floor, an undercarriage down to the rails, a roof, two ends, two doorways on the
  platform side (52 wide, a func_door leaf each: starts open, toggle, named so no player moves it; one name per train, `<site>_<hall>_doors`) and windows, benches,
  two lamps (a housing with a lens: only the lens's underside wears the lamp texture, never a box lit on every face), textures of the first level's
  tram (halflife.wad SUBWAY_*). A station also gets posters (halflife.wad POSTERn) and ticket machines on its back walls and two name boards over each
  platform (the Mese wad's PUMP STATION boards: there is no text of our own). A station of 1088 (the Spine's) holds two cars with the crossing at one end
  (`checkMetro`: the train keeps 72 from the end walls and off the crossing).
  **Third version (the cars as models, 2026-11-08, the person: the brush cars were "extremadamente cuadrados ... delata que esta hecho por ia"):** a car is a
  `ts_model` (`carModels`, `trainProps`): `models/h9/metro_cab.mdl` (and `_m`, the platform on the other hand), `metro_mid` for a car of a train of three, made by
  `levels/art/h9-metro-car.mjs` (the reference form is written at its head; textures painted there, nothing of any game's), built to `levels/art/h9/models/`
  and installed as `<H9>/ts/models/h9/`. It is 384 long, 114 wide, 100 high at the crown (an arc of 12 segments), with a cab at the train's ends (it stands 22 past
  the car's end: the 72 clear of the hall's end walls hold it). What the brushes draw now is collision only, all CLIP (floor, undercarriage, roof, ends, walls,
  benches; no light blocked); the door leaves are still brushes (textured from halflife.wad, a grey brushed metal as the model's) and the ride car's doorways have one shut.
- **A fake ride** (`ride.mjs`, `below.rides`): the parked train never moves. A func_button in a car fires a multi_manager: doors shut, then a
  window of 0.6 s in which a multisource (the manager is its only input; it toggles it on and off) lets the trigger_teleports that fill the cars
  work (they have it as `master`), carrying whoever is inside, slice by slice (3 x 2 a car, a destination each: several players do not pile on one
  point), to the same place in a ride room out in the map's volume: the same car with its doorways shut in a tunnel whose lining (walls, ceiling, pillars
  and lamps every 256, rails, sleepers) is ONE func_train at 450 between two path_corners 1280 apart, the FIRST one with spawnflags 2 (the corner a
  train goes to is the one that teleports it, so the loop is seamless: everything repeats every 256), plus an env_shake. After `time` seconds an arrival
  manager opens two windows (a second for a straggler) of the zones that fill the ride car, to the other station's parked car; a button in the ride car
  runs it at once (no one is stranded); the doors open again two seconds later. Each direction has its own room (`reverse`).
  `checkRides`: both stations have a train of the same length, a time of 8 to 40 s, rooms inside +-4096 and apart, no name twice.
- **The car doorways as Cry of Fear's `inter_door`** (2026-11-08, the person: "las puertas del tren seran como las de cof? te teletransportan afuera con un guarda para no
  quedarte stuck con otros jugadores"). The sliding leaves stay (the manager still shuts them from the countdown to the end of the ride, so nobody is half in, half out), and
  each doorway also has two `info_target`s at the floor, `smak_cd_<name>_<n>_in` (24 inside the platform-side wall) and `smak_cd_<name>_<n>_out` (36 past the platform's edge)
  (`trainDoors`, `DOORWAY`). `levels/rp/plugin/smak_tpguard.sma` reads them: the use key near a doorway, facing it, with its leaf open, fades the screen of that player (0.15 s out,
  0.3 s in, a ScreenFade to him alone, what an env_fade with "activator only" sends) and carries him to the other spot; shut, it says "Las puertas estan cerradas". Walking
  through an open doorway still works. The same plugin guards every teleport (the ride's zones, the exit, manholes): if the hull at the landing point is inside a player or
  the world, the player is moved to the nearest free spot of the same floor (rings of 40, 80, 120), or is not solid to the others until they part (`smak_tpguard 0` is off).
  Only the game can show the feel of the fade and of the ghost.
- **An entrance** is a stair from the street 160 wide (three cells across: it starts at the middle of a cell) with `metro: true`; its
  `street.arch` puts two pillars on the parapet and a lintel with a lit sign over its head. It ends in a hall with `role: "concourse"`
  (a stair that opens straight onto platforms is a failure), and from the concourse passages (tunnels of 112, `look: "metro"`) lead to
  the platforms. Guards follow it as any street stair (`links[].street`, the way's `stair` links).
- **Looks and light**: `metro` (a station and a concourse: pale grey concrete walls, speckled floor, a dark vault), `metro-line`,
  `metro-stair`, `metro-old` (a disused hall) are in `METRO_LOOKS`, used where the theme names none; the zones `station` (cream, 210 195
  175), `wall` and `line` (warm, 180 110 90), `concourse` and `old` in `METRO_ZONES`. A station's light is cream or white and never
  pink, a line's warm, a platform read at 150 or more (warnings). A zone with `power: "name"` gives its lamps that `targetname`, for a
  trigger to switch a station's power (not played).
- A test site: `levels/specs/metro-test.json` (test/181-below-metro.mjs): mese-01's street, an entrance, a concourse, two stations, a
  line, a back passage; compiled and walked from the street down to the platform, across, along the line and out of the trench. Its
  broken cases: test/broken/levels.mjs (`checkMetro`).

## The level below: a design note (2026-11-06, after the person's walk of byzantium-01)

The person: the sewers "son demasiado altas, rectas, no tienen ningun proposito o npcs"; he named Master Sword Rebirth's
`deraliasewers` and `edanasewers` (C:/hlds/msr/maps) and left the design to us. Studied only (nothing of theirs is in the
kit): the BSPs sampled on a 32-unit grid, every column's open spans (a standing body's 56 or more) kept, each span's
width across and straight length along taken from the neighbouring columns it joins (floors within 18).

| | Deralia | Edana |
| --- | --- | --- |
| world | 7904 x 7520 x 1632 | 4764 x 5504 x 1424 |
| clear height over the floor | 128: 27 % of the floor, 256: 28 %, 160-192: 19 %, 224-288: 15 % | 128: 20 %, 64-96: 19 %, 224-288: 13 %, 320-416: 34 % |
| corridors (cross width 320 or less) | 766 runs; most 128 across, 64 to 256 the bulk | 807 runs; 32 to 160 across (the narrow ones 2 cells), a few 256 to 320 |
| straight length of a corridor | median 288 (4.5 cells of 64), 3 in 4 under 544, 9 in 10 under 928 (14.5), 7 % over 1024 | median 224 (3.5 cells), 3 in 4 under 416, 9 in 10 under 672 (10.5), 3 % over 1024 |
| ladders, water | 7 ladders, 30 `func_water` | 7 ladders, 9 `func_water`, 16 conveyors |
| people, sound, light | about 190 monsters from 34 spawns, 46 `env_sound`, 37 lights | about 43 monsters, 25 spawns, 55 ambient sounds, 32 sprites, 21 lights |

What the plans and the numbers say makes them work:

- **A hub and rings.** Edana is one great hall with four piers (the landmark: the player knows where he is by seeing
  it) and four tunnels out of it, with the other halls strung on rings (four cycles or more in 5500 units); Deralia is
  three quarters, each a net of halls, joined by single corridors that bend. A corridor is 128 to 192 wide and 128 to
  192 high: a tunnel is a place one walks through, a hall (256 to 416 high) a place one stops in. The ceiling is the
  difference.
- **Nothing runs straight for long.** Half the stretches are under 4 cells; nine in ten under 10 to 14; the longest
  (27 to 32 cells) are along the walls of a hall. A turn, a door, a step or a junction every 4 to 10 cells.
- **Rooms off the tunnels, each for something**: a room with a spawner and a chest, a dead end with a lever, a pump
  and its pipe, a shrine, a collapsed stretch with rubble; most are one door off a corridor and a few have two ways in.
- **Water** as a channel with ledges either side and as pools in halls, seldom a flooded hall one must swim.
- **Dark with pools of light**: the six views of Edana average under 24 of 255; light is at the lamps, the halls and the
  water, so a lit hall draws the eye from a long way off.
- **Little vertical**: 7 ladders in 7000 to 8000 units; levels change by a ladder, a stair or a drop between regions, and
  ceilings do the rest.

What byzantium-01's sewer takes from it (levels/specs/byzantium-01.json, `below`; the person's complaint is a rule of
the spec's own, `rules`):

- **Low and varied.** Tunnels 144 (service passages, riser, alleys), 160 (branches) and 176 (the main, 3 across with its
  channel) high, 128 to 192 by rule; halls 192 (collapse, market corner), 224 (weir, shrine, sluice), 256 (pump room)
  and the cistern's 288 (the street is 384 over the floor: 336 is the most a hall can be). Seven heights, 144 to 288;
  it was 208 and 288.
- **Broken up.** The longest straight run is 12 cells (20 m; the avenue's main was 17 cells in one part). Every tunnel
  ends in a hall, a turn, a junction or an end with a purpose (a ladder, bars).
- **Three loops** (a chase circles; checked, `loops: 2`): cistern, Descent, pump room, market's tunnel, the collapse,
  the weir and back by the main; the east branch, the sluice, the court's tunnel, the pump room and back to the
  cistern; the sluice's alley, the market corner, the smugglers' way and back to the sluice.
- **Landmarks** in each quarter: the cistern (the lit great hall, its basin and four piers); the weir (a pool hall on
  the main, stone); the pump room (service steel, 256 high: where a sewer worker's job will stand); the collapse
  (a bricked, rubbled hall, a cache); the shrine (stone, under the Mese's street); the smugglers' market corner (brick,
  a table, crates: where a fence will stand) with its passage to the den's cellar behind the secret door.
- **Purpose, as places of the RP contract** (`place` on a part: `below_cistern` `cistern`, `below_shrine` `shrine`,
  `below_collapse` and `below_stash` `cache`, `below_pump` `pump`, `below_market-corner` `fence`, `below_cellar` `den`),
  and the roaming spots of the walkways (contract.mjs, one every 4 cells or more) for the NPCs that will live there.
- **Ten ways down**, one or more in each district (the rule `perDistrict`) and one at each Hollow tower: the market's
  stair (plaza); manholes on the avenue, the Descent's south end, the Mese's street (the shrine), the Nexus plaza, the
  court by t1 and by t2, the paving between t3 and t4; the sluice's drain (a grate that breaks, at the court's south
  edge by the towers' alley); the den's trapdoor. Each ladder steps off onto public floor beside its shaft (checked).
- **The den**: the cellar behind its secret door, under t4. A player coming up its trapdoor stands in the den and goes
  out by the secret door into the flat that hides it (t4's room1). That flat's door was a `home` property (smak_doors
  locks it to all but an owner), so the player could not leave. The front flat is now the hideout's own property
  (`doorNameOf` and `frontOf`, site.mjs: its doors are named `<site>_t4_hideout`, kind `hideout`, open to everybody, as
  the secret door's and the trapdoor's). The chairs of the flats and the den (`chair_*` in dress/h9-byzantium.json) are
  solid now: a small clip under each, like the tables.

## Styles (`smak-style/1`, `styles/<name>.json`, read by `style.mjs`)

A style is the few rules a kind of building keeps beyond this contract, each with a source: a published one, or a
fault the person found walking a map in the game. No rule goes in without one. Sizes are not written in the style:
each of its kinds names a kind of `levels/rules/architecture.json`, whose metres `loadStyle` turns into cells of 64
(least sizes rounded up, greatest down, and never under 2 across, the depth a leaf swings into). The house style
(`styles/house.json`): each room's area within its kind's; its largest rectangle at least the kind's `minSide`
across; that rectangle at least 0.75 of the room (not halls); a window for living rooms, bedrooms, studies and
kitchens, and the living room's on two sides; every room reached without passing through a private room or a
bathroom; the entrance into a hall, living room or kitchen, on the front wall; the kitchen deeper from the front
than the living room. The Mese's (`styles/mese.json`): shops, back rooms, stair halls and flats; every entrance on the
front, a shop's window on the front beside its door (`frontWindow`; the layout puts one there when its runs leave none);
and a `site` block of the street's rules (properties, portico depth, street width, the square, footprints not
repeated, light, spawns), which a site check is to measure. `checkStyle(layout, description, style)` gives each broken rule's sentence with its source;
`layoutOf` puts the rules in its search and its polish, and their sentences in the layout's failures and warnings.

## The rules every part keeps

- Deterministic: the same description and seed give the same files, byte for byte.
- Every check ends in a sentence naming the thing and the number it wanted, as SMAK's checks do.
- Nothing of a game's files is copied into the kit (AGENTS.md rule 7): pieces name textures, they hold no pictures.
- Pictures are for the person; a check measures. Views are made at every step and looked at.

## Towers and the Kowloon facade

`"tower": n` on a site building (`tower.mjs`) raises it n storeys over its two real ones. **The extra storeys are a sealed
shell**: one solid mass a storey, its outside the building's brick and bands, nothing inside, so no room, door, home or key
is added and `properties`, `places`, `paths` and the `.rcw` are those of the two-storey building. The layout has one stair,
which joins two storeys (`building.mjs`); a second stairwell, over another part of the plan, is what a real third storey
would want (its stair piece is solid up to the next storey: the same cells would crush the first flight's headroom).
`"kowloon": true` (`kowloon.mjs`) dresses the shell's bays as it does the real ones: a window is a plate of the picture
(some lit: the palette's `lit`, texture lights), with frames, cages, add-on rooms, clothes rails, pipes, and on the roof
shacks, tanks and masts. The cage's mesh is no `{` texture: on the world it is drawn with its holes filled (blue).
A building with `kowloon` or `tower` puts its crown and front pieces in `func_detail` (no entity: the map stands at
H9's 1200 edicts, and a `func_wall` there overlaps more than hlvis's 48 leaves), its wall lamps split shorter.
