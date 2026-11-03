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
pairs the style lists (the kitchen and the living room). `footprint.cells` is the building's rectangle (later: any outline of cells).
Every room is reached from the entrance through `doors` and the stair; the check says which is not, in a sentence.

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

## Styles (`smak-style/1`, `styles/<name>.json`, read by `style.mjs`)

A style is the few rules a kind of building keeps beyond this contract, each with a source: a published one, or a
fault the person found walking a map in the game. No rule goes in without one. Sizes are not written in the style:
each of its kinds names a kind of `levels/rules/architecture.json`, whose metres `loadStyle` turns into cells of 64
(least sizes rounded up, greatest down, and never under 2 across, the depth a leaf swings into). The house style
(`styles/house.json`): each room's area within its kind's; its largest rectangle at least the kind's `minSide`
across; that rectangle at least 0.75 of the room (not halls); a window for living rooms, bedrooms, studies and
kitchens, and the living room's on two sides; every room reached without passing through a private room or a
bathroom; the entrance into a hall, living room or kitchen, on the front wall; the kitchen deeper from the front
than the living room. `checkStyle(layout, description, style)` gives each broken rule's sentence with its source;
`layoutOf` puts the rules in its search and its polish, and their sentences in the layout's failures and warnings.

## The rules every part keeps

- Deterministic: the same description and seed give the same files, byte for byte.
- Every check ends in a sentence naming the thing and the number it wanted, as SMAK's checks do.
- Nothing of a game's files is copied into the kit (AGENTS.md rule 7): pieces name textures, they hold no pictures.
- Pictures are for the person; a check measures. Views are made at every step and looked at.
