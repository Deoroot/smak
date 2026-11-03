# Rooms of role-play cities, by property kind

How the three cities H9 plays (Alexandria, Paradise City, Xenon City; levels/notes-rp-city.md) size, door,
glaze and furnish each kind of property, so a generator can do the same for a new small RP map. Made by
`levels/tools/survey-rp-rooms.mjs`; the data is `levels/corpus/rp-rooms.json`.

```
node levels/tools/survey-rp-rooms.mjs [--root <folder holding maps/>] [--maps a,b,c] [--jobs 3]
```

**Measures, counts and model file names only.** No geometry, entity, texture or name of a map is in the
repository. The run takes about a minute and gives the same file every time.

## What is measured, exactly

The rooms and properties are those of the city measures (`cityOf` in levels/lib/city-measures.mjs, asked with
`detail: true` for the cut itself). The doors cut the walked floor (32-unit places) into parts. A part beside a
door, half roofed, up to 2 500 m², is a **room**. Rooms joined by doors that no public floor touches are one
**property** (cityOf's building). The property's **kind** comes from its doors' names (jail, hideout, home,
shop, public, other). Lengths are in metres (1 unit = 0.0254 m), areas in m². Each band is median (p10-p90)
over every room or property of the kind in the three cities. Each city weighs 1 in all, so Paradise's 16 homes
count no more than Alexandria's 7.

- **Room**: its floor is the places it holds. Its sides are the box of those places, short and long, and
  `fill` is the floor over that box. Its ceiling is the median headroom of its roofed places. Its floor light
  is the median lightmap value on its places (0-255).
- **Doors**: a door node is the floor that one doorway's panels claim (a double door is one node). Doorways per
  property count the nodes that touch its rooms. Entrances are the nodes that also touch public floor.
  - What an entrance opens on, read from the public places beside it: **plaza** (median free width 12 m or
    more), **street** (half or more under open sky), **corridor** (roofed, on the street layer), **landing**
    (roofed, on another layer: a gallery, an upper walkway, a stair landing).
  - Door width x height is the box of the node's panels.
- **Glass**: a brush entity (func_breakable, func_wall, func_illusionary, func_wall_toggle) is glass when one of
  its textures is named as glass or a window, or when it is thin (16 units or less) and either a glass
  func_breakable (material 0) or translucent. It is counted for each room whose floor lies within 48 units of it,
  so a window counts for the rooms on both sides. World faces with a glass texture are counted as area. Cheap,
  and only as good as the texture names: the three cities glaze almost entirely with brush entities (35 to 46
  each), and only Xenon has world glass (22 faces).
- **Furnishing**: each point entity stands on the walked place under its origin (a brush entity: its box's
  middle), searched up to two places round. That place belongs to a room, to public floor, to a doorway, or to
  no walked floor. The classname and model file are counted per room. Props are ts_model, cycler,
  cycler_sprite, env_model, monster_furniture and monster_generic. Items are item_, weapon_, ammo_ and
  ts_groundweapon. Lights are `light` and `light_spot`; switches are func_button and the rotating buttons.
  `inGameFolders` says whether the file is in H9XASH/ts or Steam's Half-Life/ts models.
- **Jail cells, two ways.** (a) From the cut: the rooms behind doors named as cells. (b) Traced from the doors,
  because the cut loses cells: cells under 4 places (2.7 m²) are given to the doorway, and cell doors side by
  side run their pads together.
  - From each cell door's middle, 40 units over its foot, the world is traced both ways across the door until
    solid. The shorter run is the cell's depth, the longer the floor in front.
  - The cell's width is traced along the door from a point inside the cell. In a row it is capped by the pitch
    between doors, because bars and walls that are brush entities let the trace run on.
  - Doors less than 64 high or 24 wide are hatches, not cells. A door with no wall within 8 m is a jail's way
    in, not a cell.
  - Doors in one plane and at one height, 8 m apart at most, are a **row**. Rows whose cells open toward each
    other **face** across a corridor, whose width is then door to door.
- **Spawns**: each info_player_deathmatch's place (public floor or a room of some kind), the nearest other spawn
  (straight line), all pairs, groups (spawns within 4 m, chained), and the straight distance to the nearest door
  brush.

## Per property kind (three cities)

| | home | shop | jail | public | hideout | other |
| --- | --- | --- | --- | --- | --- | --- |
| properties / rooms | 32 / 56 | 11 / 42 | 3 / 10 | 15 / 36 | 3 / 5 | 12 / 17 |
| properties per city: Alexandria / Paradise / Xenon | 7 / 16 / 9 | 4 / 4 / 3 | 2 / 0 / 1 | 2 / 8 / 5 | 1 / 2 / 0 | 6 / 3 / 3 |
| room floor m² | 42.3 (5.3-152) | 27.7 (9.5-146) | 33.7 (4-163) | 21.6 (5.3-80.6) | 120.5 (22-167) | 47.4 (9.9-154) |
| room box, short side m | 8.13 (2.44-14.6) | 4.88 (2.44-12.2) | 5.69 (1.63-15.4) | 4.88 (2.44-8.94) | 8.78 (2.68-11.4) | 8.13 (0.81-14.8) |
| room box, long side m | 12.4 (3.25-19.5) | 7.32 (4.06-22.2) | 8.13 (2.44-22.0) | 7.32 (2.44-15.4) | 30.9 (7.0-44.7) | 10.6 (3.25-22.9) |
| fill (floor / box) | 0.55 (0.40-0.86) | 0.82 (0.51-1) | 1.0 (0.51-1) | 0.64 (0.50-1) | 0.56 (0.40-1) | 0.85 (0.43-1) |
| ceiling m | 3.28 (3.25-4.09) | 3.81 (3.25-5.10) | 3.86 (3.29-4.86) | 3.99 (3.17-7.77) | 3.31 (2.42-3.45) | 3.72 (3.25-5.71) |
| rooms per property | 1 (1-3) | 2 (1-19) | 4 (2-4) | 2 (1-9) | 1.7 (1-2) | 1 (1-2) |
| property floor m² | 86.5 (35.7-222) | 125 (27.7-1978) | 229 (184-256) | 61.4 (5.9-315) | 158 (59.5-167) | 66 (5.5-203) |
| doorways per property | 1 (1-3) | 2 (1-19) | 5 (2-7) | 1 (1-8) | 2 (1-2) | 1 (1-3) |
| entrances per property | 1 (0-1) | 1 (0-1.4) | 1 | 1 (0-1) | 1.3 (0-2) | 1 (0.5-1) |
| entrance opens on | landing 61 %, street 18 %, corridor 18 %, plaza 4 % | landing 56 %, corridor 22 %, plaza 22 % | landing 67 %, corridor 33 % | landing 44 %, street 22 %, plaza 22 %, corridor 11 % | corridor 100 % | landing 55 %, street 18 %, plaza 18 %, corridor 9 % |
| entrance door w x h m (n) | 1.83 x 2.64 (28) | 3.17 x 2.63 (9) | 3.25 x 2.46 (3) | 3.25 x 2.46 (9) | 1.83 x 2.74 (3) | 3.44 x 2.84 (11) |
| inner door w x h m (n) | 1.42 x 2.51 (24) | 1.47 x 2.55 (33) | 2.06 x 2.67 (10) | 1.48 x 2.44 (24) | 2.64 x 2.58 (2) | 1.58 x 2.74 (6) |
| rooms with glass | 36 % | 14 % | 20 % | 53 % | 0 | 6 % |
| glass panels per room | 0 (0-1.3) | 0 (0-1) | 0 (0-2) | 1 (0-1) | 0 | 0 (0-0.2) |
| props per room | 1 (0-4.1) | 0 (0-3) | 0 (0-1) | 0 (0-1.4) | 1 (0-5) | 0 (0-6) |
| props per 10 m² | 0.25 (0-1.89) | 0 (0-0.39) | 0 (0-0.07) | 0 (0-0.52) | 0.06 (0-1.07) | 0 (0-0.65) |
| rooms with a prop | 75 % | 17 % | 10 % | 25 % | 60 % | 35 % |
| light entities per room | 1 (0-3.4) | 0 (0-1) | 0 (0-1.4) | 0 (0-5.9) | 0 (0-2) | 0 (0-1) |
| switches per room / property | 0 (0-2) / 1 (0-2) | 0 (0-3.2) / 0 (0-6) | 0 / 0 | 0 (0-2) / 0 (0-6) | 1 (0-1) / 1 (0-1) | 0 (0-2) / 1 (0-3) |
| floor light (0-255) | 114 (47-169) | 70 (38-178) | 142 (70-220) | 121 (59-217) | 55 (35-99) | 48 (21-189) |

Classes per room (mean): homes ts_model 2.18, light 0.95, func_button 0.59, ambient_generic 0.13; shops light
0.64, ts_model 0.64, ambient_generic 0.62, func_button 0.48, func_water 0.10; public light 1.11, ts_model 0.81,
func_button 0.36, ambient_generic 0.28, light_spot 0.19; hideouts ts_model 1.4, func_button 0.4, light 0.4.
**No item, weapon or ammo entity stands in any room**: the RP plugin supplies them.

### The models most placed, per kind (file, count; cities where more than one)

All in the game's folders unless marked *not in folders*.

- **home**: `mecklenburg/seat1.mdl` 13 (2), `h9/matsalsstol.mdl` 10 (2), `h9/vts_kitchen_plates.mdl` 8 (2),
  `h9/3d_paradisepc2.mdl` 7 (2), `h9/couch_leather-black.mdl` 7 (2), `simivalley/furniture/bed2.mdl` 7 (2),
  `mecklenburg/toilette.mdl` 6 (2), `clankill3r/couch1.mdl` 5, `h9/scr_stol_1.mdl` 5 (2),
  `mecklenburg/couch1.mdl` 5, `mecklenburg/refr2.mdl` 5, `estate/tablechairdining.mdl` 4 (2), `sg_table2.mdl` 4
- **shop**: `h9/couch_leather-black.mdl` 7 (2), `h9/barstool.mdl` 3, `estate/tablechairdining.mdl` 2,
  `h9/3d_paradisepc2.mdl` 2, `mecklenburg/bier.mdl` 2, `mecklenburg/couch1.mdl` 2, `h9/chair_leather.mdl` 2
  (not in folders), `alex-hlru/s_leather_chair.mdl` 1, `h9/desk.mdl` 1 (not in folders)
- **public**: `h9/sg_chair.mdl` 7, `h9/xen_plant6.mdl` 7 (not in folders), `player/heavytengu/heavytengu.mdl` 4,
  `3dm_chair.mdl` 2 (2), `h9/desk02.mdl` 2 (not in folders), `h9/operation_table.mdl` 2 (not in folders),
  `h9/3d_paradisepc.mdl`, `h9/blackmesachair.mdl`, `h9/d3_maincontrol.mdl` 1 each
- **hideout**: `h9/chair3.mdl` 2 (not in folders), `h9/couch_leather-black.mdl` 2, `alex-hlru/f3_crate.mdl` 1,
  `h9/af_wooden_table.mdl` 1 (not in folders), `h9/vts_kitchen_plates.mdl` 1
- **jail**: `mecklenburg/refr2.mdl` 1, and nothing else (cells are bare)
- **other**: `h9/barstool.mdl` 6, `simivalley/furniture/chair1.mdl` 4, `alex-hlru/cc_pr_libbookshelf_1.mdl` 2,
  `alex-hlru/s_leather_chair.mdl` 2, `mecklenburg/seat1.mdl` 2, `sg_table2.mdl` 2
- **public floor** (streets, corridors, squares; 3 006 / 6 270 / 8 960 m²): `h9/arc_flower.mdl` 20 (2),
  `h9/re_dirt.mdl` 12, `schmung/bench3.mdl` 10 (2), `h9/qk_trash.mdl` 9, `h9/3d_paradisepc2.mdl` 5 (2),
  `h9/gpc_envtrash2.mdl` 5, `h9/matsalsstol.mdl` 5, `h9/cemtree1.mdl` 4 (2), `h9/e4g1e_stul.mdl` 4,
  `h9/chair_office.mdl` 3 (not in folders). Per 100 m² of public floor: props 0.39 (0.13-1.04), light entities
  0.20 (0.06-0.33), switches 0.13 (0.04-0.14).

Where the props, lights and switches stand (rooms / public floor / doorway / off the walked floor):

| | props | lights | switches |
| --- | --- | --- | --- |
| Alexandria (walk reaches 63 %) | 38 / 35 / 3 / 25 | 40 / 30 / 0 / 34 | 25 / 4 / 3 / 21 |
| Paradise City (80 %) | 130 / 65 / 8 / 11 | 41 / 4 / 0 / 8 | 34 / 9 / 1 / 2 |
| Xenon City (60 %) | 42 / 4 / 0 / 24 | 57 / 6 / 1 / 29 | 21 / 4 / 9 / 4 |

## Jails

Cell doors are named in all three cities. Every one is a `func_door`: Alexandria 18, Paradise 4, Xenon 7.

Traced from the doors: 20 cells in 13 rows. Four of Alexandria's cell doors are hatches (0.41 m), and one is
the jail's way in.

| | median (p10-p90) |
| --- | --- |
| cells per row | 2 (1-2); 69 % of rows face another across a corridor |
| pitch between cell doors | 5.69 m (1.52-6.50) |
| cell depth x width | 3.66 (1.69-5.04) x 4.39 (1.52-13.1) m |
| cell floor | 15.5 m² (2.6-54.8) |
| corridor in front (door to door when facing) | 5.72 m (3.89-8.08) |
| cell door w x h | 1.27 (1.22-3.25) x 2.72 (2.06-8.13) m |
| nearest switch from a row | 9.6 m (3.6-21.2) |
| light entities within 8 m of a row | 0 (cells are lit by texture lights: floor light 142) |
| nearest door that is no cell's | 8.0 m (0.5-12.7) |

Per city:

- **Paradise** has two pairs of cells, 3.66 x 3.66 m each, facing across a 3.89 m corridor. Its cell doors
  stand on no walked floor, so the cut sees no jail property in Paradise.
- **Xenon** has two pairs of small cells: 1.74 m deep, 1.52 m pitch (about 2.6 m²), facing across 6.0 m. They
  open off a 34 m² block room of a 184 m² jail property (4 rooms, 7 doorways). It also has three single larger
  holding rooms.
- **Alexandria** has rows of two at a 6.5 m pitch, cells 3.3 to 4.9 m deep, across 6.5 to 8.1 m. Its two jail
  properties are 147 and 201 m² rooms with the cells off them.

From the cut, the jail property is 229 m² (184-256), 4 rooms, 5 doorways, one entrance, which opens on a
landing or corridor, never a street. The traced cells are the truer cell size; the cut's "cells" are mostly
the block rooms.

## Spawns

| | Alexandria | Paradise City | Xenon City |
| --- | --- | --- | --- |
| info_player_deathmatch | 15 | 19 | 9 |
| where they stand | public floor, all in one group (the spawn core) | public floor, 19 apart; 5 under sky, on the street layer | all in one room behind doors (named as a shop's) |
| nearest other spawn | 2.3 m | 19.0 m (7.9-28.6) | 1.5 m |
| all pairs | 5.1 m (2.3-11.5) | 66 m (27-134) | 3.1 m (1.5-6.2) |
| to the nearest door | 100 m (the core leads out by teleports) | 9.0 m (2.0-17.5) | 7.1 m (5.2-8.4) |

The cities do it two ways. Two pack every spawn into one closed spawn room or core: spawns 1.5 to 2.3 m apart,
and the way out a door or a teleport. Paradise scatters single spawns over its public floor, 19 m from one
another and 2 to 18 m from a door. None spawns a player in a home or a jail. Xenon's spawn room is cut as a
property, and its door's name makes it a shop; it is a spawn room, not a shop.

## What a generator should take from these (rules)

Areas are walked floor (wall to wall, near enough on a 32-unit grid). Read the medians as the target and p10-p90
as the range. Three cities is a thin sample.

- **Home**: one room, sometimes two or three, of 40 m² (20-150), a property of 85 m² (35-220).
  - Not a box: the floor fills about half its box (0.55), so make homes L-shaped or with a bath or kitchen
    alcove.
  - Ceiling 3.3 m (3.25-4.1).
  - One entrance, 1.8 x 2.6 m, opening on a roofed landing or upper walkway (61 %) more than on a street or
    corridor (18 % each), hardly ever on a square. Inner doors 1.4 x 2.5 m.
  - A third have a window panel.
  - Furnished: 3 rooms in 4 hold a prop, 1 (0-4) a room, about 1 per 40 m². Seats, a couch, a bed, a table and
    a toilet: `mecklenburg/seat1`, `h9/matsalsstol`, `h9/couch_leather-black`, `simivalley/furniture/bed2`,
    `mecklenburg/toilette`, `mecklenburg/refr2`, `h9/vts_kitchen_plates`, `h9/3d_paradisepc2`.
  - One light entity a room, one switch a property (the door's or the light's). Floor light about 114: brighter
    than the street.
- **Shop**: rooms of 28 m² (10-146), more box-like (fill 0.82, aspect 1.5), 4.9 x 7.3 m, ceiling 3.8 m. Usually
  a front room and a back room (2 rooms, 2 doorways).
  - The entrance is wide: 3.2 x 2.6 m (shutters and double doors; up to 9.5 m). It opens on a landing (56 %),
    a corridor or a square (22 % each), never straight off an open street.
  - Bare in the map (17 % of rooms hold a prop: a couch, bar stools, a table): stock and counters come from the
    plugin.
  - Floor light about 70 (dimmer than homes); one ambient_generic in every other room.
- **Public** (office, police, clinic, lab): rooms of 22 m² (5-80), 4.9 x 7.3 m, the highest ceilings (4.0 m, up
  to 7.8 m), 2 rooms a property.
  - The entrance is wide (3.25 x 2.5 m) and opens on any public floor: landing 44 %, street and square 22 %
    each.
  - The most glazed: half the rooms have a window panel. The most lights (1.1 a room, light_spot too).
  - Desks, chairs, consoles: `h9/sg_chair`, `3dm_chair`, `h9/d3_maincontrol`, `h9/operation_table`.
  - Bright: 121.
- **Jail**: a property of about 230 m², 4 rooms, one entrance off a corridor or landing.
  - Cells come in pairs facing across a corridor 4 to 8 m wide (69 % of rows face): 2 cells a row, at a 5.7 m
    pitch.
  - A cell is 3.7 x 4.4 m (15 m²), or small ones 1.7 x 1.5 m.
  - Cell doors are named func_door, 1.27 x 2.7 m.
  - A switch about 10 m from the cells (3.6-21), and another door within 8 m (the block's way in or a guard
    room).
  - No props; texture-lit (floor light 142, the brightest kind).
- **Hideout**: one long room or two (120 m², aspect 2.7: a tunnel, a back room), ceiling 3.3 m.
  - Entered off a corridor only, 1.8 x 2.7 m. No glass.
  - A switch (a hidden door's). A few props (a chair, a crate, a couch).
  - Dark: floor light 55, the darkest kind.
- **Public floor**: furnish sparsely: 0.4 props per 100 m² (flower pots, benches, trash, trees: `h9/arc_flower`,
  `schmung/bench3`, `h9/qk_trash`, `h9/cemtree1`), 0.2 light entities per 100 m².
- **Spawns**: either one closed spawn room with every spawn 1.5 to 2.3 m apart and a door out within 5 to 8 m,
  or single spawns over the public floor about 20 m apart and within 2 to 18 m of a door. Never in a home or a
  jail.

## Gaps and limits

- **Open-front properties are street** (as in the city measures): a shop open to its corridor has no room here.
  The kinds are those whose doors are named; `unnamed` has none in these cities.
- **Large gated floors count as properties**: Xenon's tower floors make a shop of 19 rooms (1 978 m², the shop
  p90) and homes up to 1 148 m². Use the medians.
- **Unwalked furniture is not counted**: the walk reaches 60 to 80 % of each city. A quarter of Alexandria's
  props and a third of its lights stand on no walked floor, and so do a third of Xenon's props. Rooms in parts
  the walk does not reach are not rooms.
- **Light entities undercount light**: these cities light rooms with texture lights (lights.rad) as much as with
  `light` entities. The floor light is the true measure.
- **Windows** are only those named or built as glass. An open window (a hole) or a glass texture not named so is
  not seen; a window counts for the rooms on both its sides.
- **Entrance kinds** read the public places beside the door. "Landing" is any roofed public floor off the street
  layer: it does not tell a gallery from a stair landing.
- **Distances are straight**, not walked (spawns to doors, cells to switches).
- **The traced cells** assume a cell door stands in its cell's front wall. A door into a corridor of cells reads
  as a cell when a wall stands within 8 m.
