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
  (learnt in a built site: a tenement's hall went on beside its entrance one row deep, and its two rooms
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

## Kits of other looks (`pieces/<name>/`)

`pieces/hl/` is the house kit. A kit of another look is another folder with its `library.json` (made by a script like
`pieces/make-hl.mjs`) on the same grid, storey, walls, doorways and stair as above, so the layout and the assembler
read it unchanged. It may add slots and edge or floor kinds that a site (below) uses: `column` (a grid vertex),
`architrave` (an edge) and `portico` (a cell) for a colonnade along a street; edge kinds `shopfront` (a shop's street
door, with a sign) and `shop-window` (a large breakable glass), `facade` (an exterior wall facing the street); floor
kinds `paving` (public floor) and `home`; `landmark` (3 x 3 cells) for a column or monument in a square. A door of
such a kit is a `func_door_rotating` opened by use (spawnflags 256) with a `targetname` the assembler fills (one name
a property). The kit names textures only (AGENTS.md rule 7); its pictures are gitignored. No such kit is in this
folder: the site and the dressing below are tested here on the house's pieces where they can be (README of the kit
that has them says the rest).

## The site (`smak-site/1`, `site.mjs`)

Several buildings along a street, as one map. In this first version the street, its porticoes, the lanes and the square
stand where the site says (cells of 64, y north); what is generated, and measured, is each building: its program (a
shop with its back room and a stair hall on the ground storey, a landing and two flats above: `buildingOf`) laid out
by `layoutOf` with its sides blind (the neighbours stand against them) and its back open to the lane behind.

- `planSite` labels every cell (street, portico, square, landmark, paving, a building) and lays out every building;
  `checkSite` holds the style's `site` block (properties, portico depth, street width, the square, footprints not
  repeated, the homes' share); `checkSpawns` the spawns (enough, apart, on public floor, out of every leaf's swing);
  `siteLight` a compiled site's rooms against its public floor.
- **A property** is a room entered from the street or a stair hall, with the rooms behind it through doors that pass no
  hall (the shop's back room is the shop's); every leaf is named `<site>_<building>_<property>` (a game's plugin can hand
  the name out as a key); a door joining two properties fails.
- `assembleSite` assembles each building with `assemble(..., { site: false, edgeKind, floorKind, doorName })` (the
  front's walls a `facade`, a shop's entrance a `shopfront` and its front window a `shop-window`, a flat's floor
  `home`), then the street: `paving` under every public cell, a `column` every 2 cells on a portico's column line,
  the `architrave` over it, the `portico` ceiling and a lamp under every third cell, the `landmark`, the spawns
  (`info_player_deathmatch`, and one `info_player_start` on the first: a game of one player, the console's `map` with
  `maxplayers 1`, looks for no other), the site's own `sun` and the sky round all of it.
- **The site's ends**: wherever public floor meets the site's edge, a blind front 3 storeys high (`BACKDROP`: the
  `wall-exterior` piece, the `facade` on its top storey) in that district's look, its outer face to the street, so a
  street ends in the city and not in the sky (a site's street ends showed the skybox in the game).
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
  practice (Xash3D reads 65 535). The first skyline of a built site, a parapet and merlon brush every edge, took it from
  some 27 900 faces to 34 545 and out of GoldSrc; by runs, without the unseen faces, it is 32 280 faces and 48 437
  vertices of 65 535: fit for both engines, with some 490 faces left. More of it costs faces somewhere else.
- **Lamps and columns stand apart from the world** (one `func_wall` a building and a portico): in the world, even as
  `func_detail`, a ceiling lamp splits VHLT's world into some 46 leaves. one built site came to 6 164 world leaves of
  GoldSrc's 8 192 with them in it, 929 without; and to 26 735 clipnodes of 32 767 until the lamps took `zhlt_noclip`
  (9 412 after). navwalk.mjs passes a model with no player hull, as the game does.
- **An evening** (`sun` in the site): role-play cities' public floor is lit 53 to 56 of 255 at the median and their
  rooms 68 to 71; under a noon sun one site's street was 181 and its rooms 66. At `brightness` 28 the street is 58 and
  the rooms 66. The rule holds only for a full compile: a draft has no bounces, and its rooms fall under its street.
- **The walk leaves the rebuilt CLIP brushes out** (`clips: false`): their rebuild from hull 1 closed every stair's
  second flight in a built site, where a trace of hull 1 itself stands on every tread from 96 to 192 (the rebuild's known
  fault, src/source/mapbrushes.mjs).

## The dressing (`smak-dress/1`, `dress.mjs`, `dress/<name>.json`)

What an assembled site wears in its game: `dressSite(plan, built, dress)` gives back the entities and CLIP brushes to
add, and a report of what was placed and what found no room (nothing of `built` is changed). The dress file names
only files the game has (checked against the game's folder when the dress is made) with each model's box,
facing, kind of place and whether it is solid; nothing of the game's is in it.

- **Glows** (`env_glow`, rendermode 3, as the stock TS maps make theirs, 100 to 150 a map): red on two opposite
  corners of each roof and every 8 cells along the blind fronts' tops, amber along the Nexus's fronts and at each
  checkpoint's jambs (a red stop-lamp over its middle), coloured at the Market's doors and windows, a few flickering in
  the Hollow; one in about three with a small `light`, since a glow lights nothing. Each within 32 of a surface.
- **Sounds** (`ambient_generic`, every file looped: a file with no cue plays once): by district on its public
  floor, spread farthest-first, and in rooms of a kind (the bar, the cells, the den); the regime's alarm silent until
  fired (`<site>_alarm`). The game's own maps carry 1.5 to 3.6 a 1000 m2.
- **Props** (`ts_model`; to a player a point, so the big furniture has a CLIP brush under it as the game's map makers do): each room's list (its kind's, and its district's), each prop against a wall with
  its back to it, kept off the wall's half and under the ceiling (under 105 beneath a hanging lamp, under the sill
  before a window), on cells no doorway, leaf's swing, stair or start needs. A solid one takes too the cells whose
  middle stands nearer it than half a player (17), and is set only where its room's free cells stay in one piece. On
  the public floor, against fronts with 3 cells of floor before them, 16 off the front's line (its sills and
  cornices). Not placed yet: things on a table, and anything free in a room's middle.
- **Measured on a built site** (compiled, hull 1): every room's door cells reached and its free cells in one piece, 19
  cells left as pockets between furniture; the public floor in the same pieces as undressed, 45 cells fewer.

## Styles (`smak-style/1`, `styles/<name>.json`, read by `style.mjs`)

A style is the few rules a kind of building keeps beyond this contract, each with a source: a published one, or a
fault the person found walking a map in the game. No rule goes in without one. Sizes are not written in the style:
each of its kinds names a kind of `levels/rules/architecture.json`, whose metres `loadStyle` turns into cells of 64
(least sizes rounded up, greatest down, and never under 2 across, the depth a leaf swings into). The house style
(`styles/house.json`): each room's area within its kind's; its largest rectangle at least the kind's `minSide`
across; that rectangle at least 0.75 of the room (not halls); a window for living rooms, bedrooms, studies and
kitchens, and the living room's on two sides; every room reached without passing through a private room or a
bathroom; the entrance into a hall, living room or kitchen, on the front wall; the kitchen deeper from the front
than the living room. A shopping street's style: shops, back rooms, stair halls and flats; every entrance on the
front, a shop's window on the front beside its door (`frontWindow`; the layout puts one there when its runs leave none);
and a `site` block of the street's rules (properties, portico depth, street width, the square, footprints not
repeated, light, spawns), which a site check is to measure. `checkStyle(layout, description, style)` gives each broken rule's sentence with its source;
`layoutOf` puts the rules in its search and its polish, and their sentences in the layout's failures and warnings.

## The rules every part keeps

- Deterministic: the same description and seed give the same files, byte for byte.
- Every check ends in a sentence naming the thing and the number it wanted, as SMAK's checks do.
- Nothing of a game's files is copied into the kit (AGENTS.md rule 7): pieces name textures, they hold no pictures.
- Pictures are for the person; a check measures. Views are made at every step and looked at.
