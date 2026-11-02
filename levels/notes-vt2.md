# Vermintide 2's levels, measured (2026-11-01)

Warhammer: Vermintide 2 (Stingray engine), the install on this machine, read-only. Its 34 campaign levels in
numbers beside GoldSrc's and Source's, for Phase 3 (levels laid out from a description, checked by measures).
The measures and bands are in `levels/corpus/levels-vt2.json`. Everything read from the game (Lua, `.level`,
`.navdata`, the decoded navmeshes, the main paths) stays in `levels/vt2/out/`, which is not committed.

## What level data the game has

| data | resource | form | decoded |
| --- | --- | --- | --- |
| navmesh | `.navdata`, one per level (508) | Autodesk Gameware Navigation `BlobAggFile`: cells of floors of triangles (u8 pixel vertices in the cell, f32 altitudes, u32 half-edges with a kind: paired, obstacle, cell border). 2.17.3 little-endian; 30 levels still carry 2016.1.14's, big-endian | **yes, whole**: `survey-vt2-nav.py`. Checked: every level's triangle count equals the director's spawn-point count, and the triangles' centres coincide with the spawn points (0.0 m, 5 levels sampled) |
| main path, zones, pacing | Lua (bytecode), `levels/<l>/world_spawn_zones.lua` | the AI director's baked data: the main path in segments (nodes, lengths), a zone every 10 m of it with its floor area, "island" zones off the path (and on roofs), path markers (breaks, roaming sets), crossroads (alternative routes), cover points, a spawn point per navmesh triangle | **yes** (anim/vt2's `luajit.py` runs the main chunk for its tables) |
| routes | Lua, `world_patrol_waypoints.lua` | boss, patrol and event routes, each with its distance along the main path | yes |
| ledges, jumps | Lua, `world_smartobjects.lua` | the AI's off-mesh links: ledges (top and bottom), jumps (flat distance). No doors, no ladders in these files | yes |
| scripted events | Lua, `scripts/settings/terror_events/terror_events_<l>.lua` | each event's steps (hordes, boss spawns, pacing on and off) | yes: names and step kinds; their triggers' places are in the level's flow and volumes, not read |
| nav tag volumes | Lua, `world_nav_tag_volumes.lua` | no-spawn and tag volumes (outline, heights) | seen, not used |
| level settings | Lua, `scripts/settings/level_settings*.lua` | the levels, their acts, boss levels | yes: the corpus |
| level units | `.level` (680, sub-levels included) | header, then 80-byte unit records: id, unit type hash, position, rotation, scale (24 857 units of 1 064 types in Karak Azgaraz's interior); then flow, sounds, volumes | header and unit records read (scoping only); the rest not |
| solid geometry / collision | inside each `.unit` resource | PhysX 3 cooked shapes (`NXS` + `CVXM` convex hulls, `MESH` triangle meshes) per actor | **no** (see below) |
| player size | Lua, `SPProfiles` | first-person eye heights standing: 1.7 (Saltzpyre), 1.55 (Sienna), 1.3 (Bardin), 1.5 (Kerillian), 1.65 (Kruber); move speed 4 m/s, walk 1.9, crouch 1.4 | yes: the measures use 1.8 m for a player height (ph), as asked; the navmesh's AI is 1.6 m tall, 0.38-0.4 m round, steps 0.5-0.6 m, slopes to 50-60 degrees |

Best sources: walkable floor, the navmesh (exact, the game's own); the main path, `world_spawn_zones`
(the director's own path, segment by segment); pacing, the zones' floor along the path, the routes, the
events and the path markers; solid geometry, the units' PhysX shapes placed by the `.level` records (not
decoded).

## The corpus

Every `LevelSettings` entry with an act, but Versus, Weaves (`act_scorpion`), the prologue (a tutorial) and the
hubs; Chaos Wastes (morris: generated paths) has no act. 34 levels: Helmgart's 13, Back to Ubersreik's 4
(Plaza, its short finale: 231 m of path, one vote like the rest), Bogenhafen's 2, Karak Azgaraz's 4,
Drachenfels' 3, Wizard's Tower 2, the termite trilogy 3, A Quiet Drink, Dwarf Fest, the Reikwald river.
All 34 measured.

## How it is measured, and how that differs from measure.mjs

No solid geometry, so the floor is the navmesh, rastered at 0.2 m (every floor of a place where several lie one
over another), walked from every node of the main path over neighbouring samples within 0.5 m of height. Places
on a grid of 0.8 m (measure.mjs's 32 units, a player's width, scaled by player heights: 32/72 of 1.8 m); from
each, sixteen lines walked along the floor, 75 m at the most (3000 units, scaled).

- **width**: the narrowest of the eight lines through the place, plus the navmesh's radius at each end (the
  navmesh stops that short of every wall). measure.mjs's is between solids at eye height; this one also ends
  at a drop, a ledge, or a crate or low wall a player looks over. So it reads narrower in places with low
  obstacles and open edges, about the same between walls. Lengths are good to about 0.2 m.
- **floorRun** (in place of sight): the longest line, how far the floor runs. Sight crosses gaps and looks over
  walls: this is a floor under sight, not sight.
- **headroom**: not measured. The navmesh only says 1.6 m are clear over it.
- **walked floor**: the main path's segments are joined by one-way drops ("breaks", 7.5 a km), so the walked
  floor is several parts, each walked both ways; drops, ledges and jumps are not walked (as the GoldSrc survey).
  `reachedShare` is of the whole navmesh, which also holds floor only the AI uses (roofs, ledges' tops).
- **openings**: there are no door entities to size. On the main path, sampled every metre, a place narrower than
  its neighbours within 2 m with floor twice as wide within 15 m both ways (a pinch between two wider spaces)
  is an opening. Widths only; no heights.
- **path**: the director's main path, summed over its segments (gaps at breaks not counted). Its ratio to the
  straight line start to end is ill-conditioned where a level comes back near its start (Skaven Stronghold
  29.7, Plaza 11.4): `pathExtentRatio` (length over the path's widest span) and `pathWinding100` (every 100 m
  of path against the straight line over it) say it better.
- **loops**: as the GoldSrc survey (tiles of 256 and 512 units, scaled: 6.4 and 12.8 m; cycles of the regions'
  graph less the trivial rings), on four ways of the 0.8 m grid. Crossroads are the director's own alternative
  routes.
- **pacing**: the floor the director zones along the path per metre (`bandWidth`, m2 of zone per m of path);
  open spaces (a run of zones twice the level's median band or more) and their spacing; boss and patrol
  routes; scripted events and those with hordes; ledges, jumps and cover points per 100 m.
- **vertical**: the walked places' heights: range, range90 (p95-p5), levels (bands of 32 units scaled, 0.8 m,
  holding 2% of the floor: on levels that slope all the way this counts slope, not storeys), the stacked share.

## Headline (34 levels, a level one vote: medians, quartiles in brackets)

| measure | m | ph (1.8 m) |
| --- | --- | --- |
| floor width, of levels' medians | 5.8 (5.2-6.2) | 3.2 (2.9-3.4) |
| floor width, pooled places | 5.8 (3.6-8.8), p5 1.8, p95 16.6 | 3.2 (2.0-4.9) |
| narrow share (under 2 ph, 3.6 m) | 25% (20-29%) | |
| wide share (4 ph, 7.2 m, and over) | 35% (28-41%) | |
| floorRun (not sight) | 18.8 (17.5-21.3) | 10.4 (9.7-11.8) |
| walkable area, whole navmesh | 29 400 m2 (23 000-38 200) | |
| walked from the main path | 21 100 m2 (15 500-29 000), 72% of the navmesh | |
| vertical range90 | 54 (32-77) | 30 (18-43) |
| stacked floor share | 3.1% (1.7-4.6%) | |
| width on the main path | 5.0 (4.2-5.8) | 2.8 (2.3-3.2) |
| openings on the path | 2.2 (2.0-2.4), 3.5 a 100 m | 1.2 (1.1-1.4) |
| main path length | 1 264 (1 116-1 467) | 702 |
| straight start to end | 550 (304-635); ratio 2.4 (1.9-4.7) | |
| path over its widest span | 2.2 (1.8-3.0) | |
| winding, per 100 m of path | 1.52 (1.37-1.75) | |
| path segments (breaks + 1) | 10.5 (9-14) | |
| loops, 256 / 512-unit tiles | 21.5 / 6 (14.5-30 / 3-12); 4.7 at 512 a km | |
| crossroads | 0 in 28 levels; 1-3 in 6 (Karak Azgaraz interior 3, Fort 2) | |
| floor off the path (island zones) | 30% of the zoned floor (23-34%) | |
| floor along the path per metre | 11.8 (9.9-17.6) | 6.6 |
| open spaces | 9.2 a km, 83 m apart (72-112) | |
| scripted events / with hordes | 15 / 9 per level | |
| ledge drop (AI links) | 3.6 (2.9-4.0) | 2.0 |

## What is missing, and what it would take

- **Solid geometry, hence true sight and headroom, and widths at eye height.** Each level is ~25 000 placed units
  (the `.level` records, already read: type, position, rotation, scale) whose collision is PhysX 3 cooked
  shapes inside the unit resources (convex hulls `CVXM`, triangle meshes `MESH`, behind `NXS` headers). PhysX's
  cooked formats are public in its open source (Gu ConvexMesh, TriangleMesh serialisation); the unit
  resource's actor and shape tables around them need reading first (anim/vt2's `weapons.py` already walks a
  unit's scene graph for its render meshes, which would do for sight as a fallback). Then a ray caster over
  the placed shapes. Some days' work; then measure.mjs's own width, sight and headroom could run on it.

  **Looked at again (2026-11-01), not implemented.** Ten unit resources sampled from the index: the
  collision sits inline in the unit resource, one cooked PhysX 3 stream per shape, each beginning `NXS\x01`:
  - **convex hulls**: `NXS\x01` `CVXM`, version 13, then `ICE\x01` `CLHL`, version 9 (PhysX 3.3/3.4's
    ConvexHullData). The hull's polygons carry their own planes (HullPolygonData: a plane of four floats, a
    u16 index into the vertex refs, a u8 vertex count, a u8 min index; 20 bytes each). A reader for these is
    small, and the planes go straight into the convex-hull ray test `solidOf` now has for L4D2's props.
  - **triangle meshes**: `NXS\x01` `MESH`, version 15 (PhysX 3.4), then a midphase id (1 here: BV4), the
    serial flags (index width), the vertex and triangle counts (1 133 and 2 176 in one sample), the vertices
    as float triples, the indices, then the midphase tree (skippable). Also small.
  - A 1.5 MB unit (a level's chunk) held 50 such streams: 48 hulls and 1 mesh. Small props hold 1 to 4.
  What makes it days, not hours: the unit resource's actor and shape tables (which node each shape hangs
  from, its local pose, its filter: player-blocking or not), the unit's scene graph, and matching each of a
  level's ~25 000 `.level` records (type hash, position, rotation, scale) to its unit resource and placing
  its shapes; then a ray caster over hundreds of thousands of placed shapes per level, within this machine's
  RAM. Feasible, but not "clearly within reach" in this pass, so sight and headroom stay unmeasured.
- **Door and opening heights**: with the geometry above. Doors are units (and flow), not entities with sizes.
- **Event places along the path**: the terror events' triggers are flow nodes and volumes in the `.level`
  (its later sections, not decoded), so events are counted per level, not placed along the path. Boss routes
  are placed (`bossAt`, a share of the path).
- **The director's live pacing** (intensity, peaks and rests, horde timers) is run-time, from conflict
  settings, not level data.
- Chaos Wastes, Versus and Weaves levels decode the same way (their navmeshes and spawn zones are extracted)
  but are left out of the corpus.

## Running it

```
anim/vt2/env/Scripts/python.exe levels/tools/survey-vt2-extract.py all   # Lua, .level, .navdata into out/ (~15 min)
anim/vt2/env/Scripts/python.exe levels/tools/survey-vt2-nav.py           # navmeshes into out/nav/ (~1.5 min)
anim/vt2/env/Scripts/python.exe levels/tools/survey-vt2.py               # paths, zones, routes into out/levels/
node levels/tools/survey-vt2-measure.mjs                                  # measures into levels/corpus/levels-vt2.json (~1 min)
```
