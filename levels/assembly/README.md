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
- **What it does not do**: a site with a `below` and a ground that varies fails (below.mjs stands under z 0); the dressing (dress.mjs) still assumes the ground is 0. The RP contract's places,
  roaming spots and walking graph (levels/rp, `groundOf` in paths.mjs) follow it: nodes stand on the floor of their cell (a ramp's
  along its run, a stair's at its tread, a bridge's deck), a ramp's or stair's links are `stair` links, a retaining wall's drop and
  the water are no route, a culvert (its mouth is the canal's wall) is none.

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
