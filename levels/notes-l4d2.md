# Left 4 Dead 2: level measures

Measures for Phase 3 (a level laid out from a description, checked by measures), taken from Left 4 Dead 2's
own campaign maps by `levels/tools/survey-source.mjs --game l4d2`. They are in `levels/corpus/levels-l4d2.json`.
That file holds numbers and map names only. No geometry, nav mesh, entities or map file is copied.

**57 maps** were measured: every campaign map from c1m1 to c14m2, 14 of them finales. None failed. A full run
takes 5 to 15 minutes on this machine, depending on load; the last run (with `--props`: props as their
collision hulls and as boxes) took 809 s, beside a GoldSrc survey running on three workers. Most of the time goes on
c14m1 (87,000 places) and the maps with heavy terrain (c13m2).

## The bands (one map, one vote)

Each row gives the spread over the 57 maps of each map's own median. A player height (PH) is 72 units, and
one unit is 0.0254 m. The full numbers are in `bands` and, for each map, in `maps[]`. They include each
map's q1, q3, p5 and p95, the headroom of corridors against rooms, the width bands, the nav marks one by one
and the histograms.

| measure (per-map medians, one map one vote) | n | median (units) | metres | player heights | q1–q3 (units) | q1–q3 (m) | p5–p95 (units) |
|---|---|---|---|---|---|---|---|
| **floor width, props as they collide** | 57 | **491** | 12.47 m | 6.82 | 424–622 | 10.77–15.8 m | 287–745 |
| **sight, props as they collide** | 57 | **1995** | 50.67 m | 27.71 | 1556–2695 | 39.52–68.45 m | 1056–3000 |
| headroom, corridor floor (<176 wide, props as they collide) | 57 | 427 | 10.85 m | 5.93 | 192–1112 | | 128–1856 |
| headroom under 600, props as they collide | 57 | 167 | 4.24 m | 2.32 | 144–235 | 3.66–5.97 m | 128–411 |
| floor width, world only (old upper bound) | 57 | 902 | 22.91 m | 12.53 | 704–1192 | 17.88–30.28 m | 315–1894 |
| floor width, props as boxes (old lower bound) | 57 | 336 | 8.53 m | 4.67 | 302–378 | 7.67–9.6 m | 200–494 |
| sight, world only (old upper bound) | 57 | 3000 | 76.2 m | 41.67 | 2556–3000 | 64.92–76.2 m | 1438–3000 |
| sight, props as boxes (old lower bound) | 57 | 1143 | 29.03 m | 15.88 | 948–1376 | 24.08–34.95 m | 659–3000 |
| headroom (to first solid; sky lid counts) | 57 | 1147 | 29.13 m | 15.93 | 768–1611 | 19.51–40.92 m | 192–2456 |
| headroom, corridor floor (<176 wide) | 57 | 160 | 4.06 m | 2.22 | 145–184 | 3.68–4.67 m | 128–512 |
| headroom, places under 600 | 57 | 165 | 4.19 m | 2.29 | 144–224 | 3.66–5.69 m | 127–426 |
| share under sky | 57 | 0.834 | | | 0.677–0.895 | | 0.037–0.96 |
| **narrow share (<144 = 2 PH), props as they collide** | 57 | **0.05** | | | 0.037–0.083 | | 0.019–0.142 |
| **share under 176, props as they collide** | 57 | **0.084** | | | 0.061–0.123 | | 0.031–0.217 |
| share 352 and wider, props as they collide | 57 | 0.668 | | | 0.587–0.765 | | 0.339–0.836 |
| floor under a prop (props as they collide) | 57 | 0.02 | | | 0.012–0.029 | | 0.003–0.087 |
| narrow share (<144 = 2 PH), world only | 57 | 0.025 | | | 0.012–0.047 | | 0.002–0.1 |
| narrow share, props as boxes | 57 | 0.13 | | | 0.108–0.168 | | 0.064–0.301 |
| share under 176, world only | 57 | 0.04 | | | 0.017–0.072 | | 0.005–0.182 |
| share under 176, props as boxes | 57 | 0.185 | | | 0.159–0.236 | | 0.096–0.42 |
| walkable area | 57 | 25333021 u² | 16344 m² | 4887 PH² | | 9162–22815 m² | |
| vertical spread p5–p95 of floor | 57 | 565 | 14.35 m | 7.85 | 384–774 | 9.75–19.66 m | 203–1372 |
| vertical range | 57 | 825 | 20.96 m | 11.46 | 608–1126 | 15.44–28.6 m | 431–1780 |
| step rise at nav edges (4–18) | 57 | 6.1 | 0.15 m | 0.08 | 5.8–7.8 | 0.15–0.2 m | 5.5–11.8 |
| stair riser (from brushes) | 54 | 8 | 0.2 m | 0.11 | 8–8 | 0.2–0.2 m | 5–8 |
| stair tread | 54 | 12 | 0.3 m | 0.17 | 12–12 | 0.3–0.3 m | 3–16 |
| stair flight rise (one sloped area) | 54 | 63 | 1.6 m | 0.88 | 44–80 | 1.12–2.03 m | 29–121 |
| drop height (links falling >18) | 57 | 95 | 2.41 m | 1.32 | 74–113 | 1.88–2.87 m | 40–133 |
| door leaf width (prop_door_rotating) | 57 | 56 | 1.42 m | 0.78 | 56–59 | 1.42–1.5 m | 55–60 |
| door leaf height | 57 | 107 | 2.72 m | 1.49 | 107–112 | 2.72–2.84 m | 105–112 |
| door opening width (pairs summed) | 57 | 58 | 1.47 m | 0.81 | 56–59 | 1.42–1.5 m | 55–68 |
| saferoom door leaf width | 57 | 68 | 1.73 m | 0.94 | 68–68 | 1.73–1.73 m | 58–68 |
| func_door width | 25 | 48 | 1.22 m | 0.67 | 31–48 | 0.79–1.22 m | 11–124 |
| func_door height | 25 | 72 | 1.83 m | 1 | 43–96 | 1.09–2.44 m | 11–144 |
| doors per map | 57 | 13 | | | 8–26 | | 3–45 |
| crossing walked (all) | 57 | 14967 | 380.16 m | 207.88 | 10974–17838 | 278.74–453.09 m | 4583–26924 |
| crossing walked (not finales) | 43 | 16288 | 413.72 m | 226.22 | 13247–19041 | 336.47–483.64 m | 6194–26924 |
| crossing straight | 57 | 8832 | 224.33 m | 122.67 | 4473–11571 | 113.61–293.9 m | 2544–19579 |
| walked / straight (all) | 57 | 1.6 | | | 1.3–2.11 | | 1.16–3.37 |
| walked / straight (not finales) | 43 | 1.67 | | | 1.32–2.31 | | 1.22–2.84 |
| route share bypassable (39 m block) | 56 | 0.596 | | | 0.452–0.838 | | 0.123–1 |
| alternative-route stretches per map | 57 | 2 | | | 1–3 | | 1–6 |
| alternative stretches per km | 57 | 6.46 | | | 4.52–8.72 | | 2.54–12.89 |
| coarse cycles (E-V+C, 512 cells) | 57 | 212 | | | 136–342 | | 52–574 |
| first crescendo (fraction of crossing; scripts read) | 49 | 0.625 | | | 0.422–0.8 | | 0.217–0.998 |
| rescue closets per map | 57 | 3 | | | 1–5 | | 0–6 |
| finale trigger at (fraction) | 14 | 0.867 | | | 0.627–0.922 | | 0.026–1.209 |

## How to read it

- **Width and sight are now one number each** (they were a bracket). With the static props as the engine
  collides with them (their `.phy` hulls), the median place is **491 units wide (12.5 m, 6.8 PH)** and sees
  **1995 units (50.7 m)**. That sits inside the old bracket, nearer the boxes for width (world only 902,
  boxes 336) and halfway for sight (3000 cap, boxes 1143): a box fills a tree's crown, a fence's mesh, the
  air under a truck, and the hulls do not. The game still closes its spaces with props: they take the
  bare brushwork's 23 m down to 12.5 m.
- **Narrow floor is rare.** Under two player heights (144 units, 3.7 m) is 5% of the floor with props as
  they collide (2.5% without props, 13% with boxes). Corridor-like floor (under 176) is 8.4%. Two thirds of
  the floor is 352 and wider. The co-op horde game keeps its floor wide. The narrow maps are the indoor
  ones: c8m4 (24% with collision), c8m2, c10m2, c1m1 and c11m4.
- **Sight counts what blocks a player, not only what blocks the eye.** Collision hulls stop the line where
  a player is stopped; a chain-link fence or a grate prop is solid to them though it is seen through. So
  sight here is a little short of what the eye gets on maps fenced with props.
- **Headroom:** the overall median mostly measures the skybox lid, since 83% of the floor is under sky. For
  roofed places, use the under-600 figure (165 units, 4.2 m; 167 with props). The corridor figure (160 world
  only) rises to 427 with props because the floor narrowed by props (between cars, by a fence) is mostly
  outdoors; read it as such. Props roof 2% of the floor (an awning, a truck bed, scaffolding).
- **Steps** are Source's own: risers of 8 and treads of 12 on almost every stair. Curbs and single steps at
  nav edges are 6 units. A stair run inside one nav area rises about 63 units, close to one storey's half
  flight.
- **Drops** taken by the nav are typically 95 units (1.3 PH, 2.4 m).
- **Doors:** a leaf is 56 x 107 (1.42 m x 2.72 m, 0.78 x 1.49 PH), and a saferoom door is 68 wide. Pairs are
  rare, so a typical map has single-leaf openings of 56 to 59.
- **Crossing:** a non-finale map is walked in about 16,300 units (414 m, 226 PH), at 1.67 times the straight
  line (q1 to q3: 1.32 to 2.31).
- **Loops:** at a 39 m scale, about 60% of the walked way has another way round, in about 2 separate stretches
  per map (6.5 per km). The coarse cyclomatic number (212) counts open floor as loops and is no measure of
  routes.
- **Pacing:**
  - The first crescendo comes at a median of 0.63 of the crossing (q1 to q3: 0.42 to 0.80). Reading the
    game's own director scripts (below) changed this not at all; it added seven crescendo places on c14m1. Crescendos thin
    out sharply in the first fifth. Of the per-map vote, 4% falls in tenths 1 to 2 and 90% in tenths 4 to 10.
  - Rescue closets begin at about 0.3 and spread through the middle.
  - THREAT marks (where a boss may be placed) begin at about 0.32.
  - Saferooms sit at 0 and 1 by construction.
  - A finale's trigger is at about 0.87 of the way to the rescue vehicle.
  - FINALE areas cover 86% of a finale map's floor.
  - BATTLEFIELD areas, in the 16 maps that have them, cover 19% of the floor and begin at about 0.32.

## How it was measured

**Files.** The loose `.bsp` and `.nav` files of the 14 campaigns (c1 to c14), read in the game's own search
order: `update/` first, then `left4dead2_dlc3`, `_dlc2`, `_dlc1`, and then `left4dead2/`. Every BSP's size
matches the `bspSize` its `.nav` was built for. The `update/maps/<map>_l_N.lmp` lump files (entity fixes, and
one brush-lump fix in c11m3) are applied. The `_h_`/`_s_` lump files are also entity lumps (lump 0), probably
for other game modes. They are not applied. `c5m1_waterfront_sndscape`, the tutorials and `curling_stadium` are left out (they are not
campaign maps, or their `.nav` is another subversion). No map is in a `.vpk`. The packs are read for the door
and prop models' boxes, the props' `.phy` collision and the director scripts (`levels/lib/vpk.mjs`).

**Readers.** `levels/lib/source-bsp.mjs` reads VBSP 19 to 21: planes, nodes, leafs (lump version 0 or 1),
leaf brushes, brushes, brush sides, texinfo flags, models, displacements (rebuilt from dispinfo, faces and
disp verts), entities and the static-prop game lump. Left 4 Dead 2 writes the lump header with the version
first (`{version, offset, length, fourCC}`); the reader tells which order a file uses from its numbers. **LZMA:**
a lump whose fourCC is not zero is compressed. The reader refuses it and says so, because the kit has no LZMA
decoder and takes no dependency. None of Left 4 Dead 2's maps has one. `levels/lib/nav.mjs` reads `.nav`
versions 13 to 16, including what Left 4 Dead 2 adds at subversion 14:
- in the header, a NUL-ended mission name and a u16;
- in each area, after the light intensities, a u32 of spawn attributes (TerrorNavArea: CHECKPOINT, FINALE,
  BATTLEFIELD, ...) and a u16.

The layout was worked out from the bytes and checked against every campaign `.nav`: all of them parse to their
last 4 bytes. **Flow distance is not stored in the `.nav`.** The game computes it at load time, so the survey
computes it the same way: the distance walked from the start areas.

**Solid.** World brushes that are SOLID or WINDOW. Brush entities `func_brush` (unless Solidity is "never"),
`func_wall`, `func_breakable` and `func_breakable_surf`. Displacements, as triangles. Doors count as open, as
in measure.mjs. Clips, grates and water are not solid. A line's first hit is found exactly: by walking the BSP
tree and clipping against each brush's planes, and by a ray-triangle test for the terrain. There is no
bisection.

**Walkable floor.** The nav areas reached from the start, following links one way and ladders both ways. An
area also has to be one from which the end can still be reached. (Without that test, c1m1 picked up 9.3
million square units of infected-only rooftops and street.) Three more rules:
- A nav link that drops or climbs more than 18 is left out when a level line 40 above the higher floor meets a
  PLAYERCLIP brush or an unnamed `env_player_blocker` that blocks survivors.
- The areas inside a `func_elevator` shaft are joined, because the nav has no link for the ride (c8m4).
- The grid is 32 units. A grid point inside an area takes the area's height there, from its four corners.

**A place.** As in `src/maps/measure.mjs`:
- 16 level lines go out 60 units above the floor, starting 0.3/0.1 units off the grid point, out to 3000 at most.
- **Width** is the narrowest of the 8 lines through the place.
- **Sight** is the longest run.
- **Headroom** is from the floor to the first solid straight up, looked for from 8 units above the floor.

Sky brushes are solid here, as in GoldSrc, so headroom outdoors is the distance to the skybox lid. `underSky`
is the share of floor whose ceiling is a sky brush. The width bands are measure.mjs's own: under 176, 176 to
352, and 352 and over. **Narrow** means under 144 (two player heights).

**Static props, as the engine collides with them** (`withPropCollision`, the headline). Each static prop of
the `sprp` game lump (version 9 in L4D2: origin, angles, model, solid; no scale) is placed by its origin and
angles, and stands as:
- `solid 6` (82% of the solid ones): the convex hulls of its model's `.phy`, read from the packs by
  `levels/lib/phy.mjs`. The `.phy` holds solids (one for a prop; ragdolls have more), each an IVP compact
  surface whose ledge tree's leaves are convex hulls; each hull's triangles give its planes, faced outward.
  IVP's axes and metres are turned back (`(x, z, -y) / 0.0254`). The engine gives a static prop its first
  solid, and so does the survey (no L4D2 static prop used a model of more than one). A line meets a hull
  as it meets a brush: clipped by its planes, not met when it begins inside. All 4362 `.phy` files of the
  packs parse; their bounds match the models' hull boxes within a few units.
- `solid 2`: its model's box (17 props in all).
- `solid 0` (26 744 of 82 341 props) and `solid 6` with no `.phy` (4055: bushes, grass, wires, some
  signs): nothing. The engine has no collision model for these.
In all, 51 525 props as 231 366 hulls over the 57 maps. Headroom is also taken with them.

The older two runs are kept beside it, for comparison: **without props** (the world alone, the bands
without a prefix) and **with every solid static prop as its model's box** (`withPropBoxes`: the `.mdl`
header's hull, turned by its angles). On c1m2 the median width is 1404 without props, 435 with boxes and
647 with collision.

**Units.** 1 unit = 0.0254 m. A player height is 72 units.

**Statistics.** For each map: n, median, q1, q3, p5 and p95 of its places. For the game: the same statistics
over the maps' values, one map one vote. The quantile is measure.mjs's: the value at floor(share x n) of the
sorted list.

## The other measures

- **Walkable area**: the sum of the reached nav areas' rectangles.
- **Steps**: the rise at each nav link's shared edge, between 4 and 18 units. These are mostly curbs and
  single steps.
- **Stair risers and treads**: measured from the brushes. Each nav area sloped 20 to 50 degrees is profiled one
  unit at a time down its slope. It counts as a stair when it has 3 or more risers of the same height (within
  6 units) and their median is 18 or less. **Flight rise** is the height an area like that spans.
- **Climbs and drops**: nav links rising or falling more than 18 units. A drop is one-way when there is no
  link back.
- **Doors**:
  - `prop_door_rotating` and `_checkpoint` give the leaf width (the larger horizontal side of the model's hull)
    and height. A double door (`slavename`) counts as one opening of two leaves.
  - `func_door` and `func_door_rotating` give their brush model's size. Many of these are not doors a player
    walks through: lifts, shutters, hatches.
- **Crossing**:
  - The start is the nav's PLAYER_START areas. Without those, it is the saferoom behind the door named
    `checkpoint_exit`, then the one at `info_player_start`.
  - The end is the RESCUE_VEHICLE areas in a finale. Otherwise it is the saferoom behind the door named
    `checkpoint_entrance`, and failing that the CHECKPOINT group farthest along.
  - **Walked** is the shortest path along the nav (Dijkstra; each step is costed from an area's middle to the
    middle of the shared edge and on to the next area's middle). It equals the flow distance at the end.
  - **Straight** is the 3D distance from the first area of that path to its last. A finale's ratio says little,
    since the rescue vehicle is often near the start, so the bands also give the ratio without finales.
- **Loops**:
  - The reached areas are grouped into coarse cells of 512 x 512 x 192 units.
  - **cyclomatic** is E - V + C over the cells joined both ways. Open floor counts as loops here, so treat it as
    a measure of how open the map is, not of its routes.
  - **routeBypassable** is the share of the walked path's cells whose 3 x 3 x 3 block of cells (about 39 m
    across) can be taken out while the start still reaches the end, following links one way.
  - **alternatives** is the number of separate stretches of the path that have another way round.
- **Pacing**, as fractions of the crossing's flow, where 0 is the start and 1 the end:
  - **Crescendos** are entities (a button, a trigger, a use-target) whose outputs reach a director
    PanicEvent, ForcePanicEvent or ScriptedPanicEvent input, or start a director script that is an event,
    directly or through up to 4 relays. Each is placed at its nearest walkable area.
  - **A director script is an event** when its name says so (onslaught, panic, crescendo, gauntlet, horde,
    minifinale, event, ambush, alarm, church), or when **its own text** does. The game ships its VScripts
    as `.nuc`: the `.nut` text under Valve's ICE cipher (Thin-ICE, key "SDhfi878"), which
    `levels/lib/ice.mjs` decrypts (checked against Kwan's published vectors, and on every `.nuc` of the
    packs). By its text (`levels/lib/director-script.mjs`), a script is an event when it asks for a panic
    (PanicForever, STAGE_PANIC, ScriptedPanic, PanicEvent), spawns a mob itself (ZSpawn of type 10), or
    sets mobs coming every 10 seconds or less (MobSpawnMinTime; the crescendo scripts set 1 to 8, the
    ambient and cooldown ones 20 to 90, the mood scripts none). Scripts are started by BeginScript, and by
    RunScriptFile on the director or a `logic_script`; RunScriptCode counts when its code asks for a panic
    or a mob. `pacing.directorScripts` gives per map how many scripts were read and which were events.
  - **trigger_finale** gives where the finale starts.
  - **Nav marks** (BATTLEFIELD, BATTLESTATION, FINALE, THREAT, RESCUE_CLOSET, NO_MOBS, EMPTY, OBSCURED) are
    given as spans along the flow and as their share of the floor.
  - **Tenths** histograms: each map's events share one vote.

## What was skipped, and what to distrust

- **Static props' collision is read; dynamic props and brush props are not.** `prop_dynamic`,
  `prop_physics` (cars that can be pushed) and the entity props are not placed: only the static prop lump.
  A `solid 6` prop with no `.phy` is taken as not solid, as the engine has it. A see-through prop (a fence,
  a grate) stops sight as it stops a player.
- **Measure.mjs's own walk test.** It is not run here. The floor is the nav mesh, filtered as described. The
  nav includes areas only the infected use, and areas reached over ledges the clip test does not catch. The
  forward-and-back filter removes the stranded ones, but a ledge that connects both ways stays.
- **Openings** (measure.mjs's narrow places with a wall on both sides, found by its walk test) are not
  measured. Doors stand in for them.
- **Flow distance from the game.** It is not stored in the `.nav` (L4D2 computes it at map load), so it is
  computed here as walked distance. This may differ from the game's own flow by the cost model: the game
  uses its own area-to-area distances and ignores some one-way links.
- **Pacing is approximate.**
  - **Crescendos** are found through entity I/O: a panic-event input on `info_director`, or a `BeginScript`
    whose script name says onslaught, panic, crescendo, gauntlet, horde, minifinale, event, ambush, alarm or
    church. The search follows up to 4 relays back to a button, trigger, door or prop, which is then placed
    on its nearest walkable area.
  - Eight maps show none (c5m3, c8m1, c10m1, c10m5, c11m1, c11m5, c12m1, c13m4), **and now that their
    scripts are read, that stands**: every script those maps start was decrypted and is a mood script
    (c10m1/c11m1/c12m1_no_bosses, c8m1_apartment: no tanks, c5m2_mob_from_front: mobs come from ahead,
    reserved_wanderers, c13m4_tankdistance). Three are finales (their event is the finale) and the rest are
    first maps or a crossing with no crescendo. Only c14m1 gained crescendos from the scripts (its crane
    script and the RunScriptFile of `c14m1_mob`: from 2 places to 9).
  - A few early hits (c4m1 at 0.04) may be ambient panic relays, not crescendos.
  - Tanks and witches are placed by the director at run time and are not measured. The nav's THREAT marks
    are the nearest proxy.
- **Finale ratios.** The walked/straight ratio of a finale (rescue vehicle often next to the start, as in
  c2m5 at 11.4) is not a crossing. Use `ratioNotFinale`.
- **func_door sizes** mix doors with lifts, hatches and gates (25 maps have any). The prop doors are the
  measure of a door.
- **Survival and versus maps, tutorials and `curling_stadium`.** They were left out. Their `.nav` files are
  another subversion (the tutorials'), or they are not campaign maps.
- **LZMA.** No L4D2 lump is compressed. The reader refuses compressed lumps rather than decode them, so it
  would refuse the maps of other Source games that ship compressed ones.
- **Water.** Floor under water and swimming are not treated specially: a nav area under shallow water counts
  as floor.
