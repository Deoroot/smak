# More checks of a map, with no game running

Beside `docs/MAPS.md` and `docs/MAPS-MAKING.md`: what was added after agents built two maps of a series and
met these faults. Each is a function of `maps` and, where it says so, a command.

## The walk test: running it

```
smak map-reach <bsp|map> [-o walked.png] [--goal <n|class>] [--jump] [--doors closed] [--open <name>] [--shut <name>] [--exit <name>]
```

In a script, `maps.reachOf(map)` (`{ warnings, facts, entities, openings ... }`; `{ jump: true }` for jumps), and
`planOfSource(map, { reach, heights: true })` for its plan. Exit code 1 on a fault. Every option is in
`docs/COMMANDS.md` (`--speed`, `--gravity`, `--no-slopes` ...), every function in `docs/MAPS.md`, "The walk test".

**`map-reach` walks the map** from its places to start, as the box of a standing player: steps of 18, any
drop, doors open, ladders climbed, a slope too steep to stand on (over 45.6 degrees) slid down and never
walked up. It lists the entities that are not reached, each with what it would take (a jump, a crouch, an
opening that is not there), those that stand in something solid, every opening with its width and height,
and the **one-way places**: floor a player gets into and finds no way out of, by a step, a jump or a
crouch (a pit, the foot of a steep slope, a room a teleport leads into). Mend each or mean it; `--exit
<class|name>` names a way out of the map that is no fault. `--jump` walks with jumps (up 45, and across a
gap as far as a run carries: 215 for the body's middle) and tells apart what only a jump reaches: a roof
a player was not meant to stand on shows there. `-o` draws the plan with the walked floor green, the rest
red, floor only a jump reaches blue and one-way places amber. It is geometry, not the game: say so when
you report it. `map-openings` looks through each opening it found.

## The walk test: what a class is

`reachOf` counts "the entities a player goes to". Three lists say what the classes alone do not, each by
number, classname (`*` for any letters) or targetname, and a mod's profile may carry them (`exits`,
`markers`, `wiring`, `off`):

| option | what it names | and then |
| --- | --- | --- |
| `exits` | a way out of the map (`msarea_transition`) | counted, and floor it is reached from is no one-way place |
| `markers` | a point a player is to get to though its class is wiring's (an `info_target` a script puts a chest at) | counted |
| `wiring` | what is fired by name and works wherever it stands (a line of text, a counter, a spawn area's own origin) | never counted, wherever it is |
| `off` | classnames that are an entity switched off (`disabled_*`: a class the game does not have) | no wall; one whose class would be a way out is looked for and told apart |

An entity of a class the game does not have is never made by the engine, so a brush entity so named stops
nothing (`spaceOf` takes `off` too). A switched-off way out is the way on that is not opened yet: it is in
`entities` with `off: true`, a fact says whether it is reached, and it is neither a way out nor, when it is
not reached, a warning.

The triggers that are only fired (`trigger_counter`, `trigger_relay`, `trigger_auto`,
`trigger_changetarget`, `trigger_camera`, `trigger_transition`) are left out by themselves, made of a brush
or not: nobody walks to a counter. And a `trigger_counter` with no brush is not said to have "no shape": its
code never asks for one.

`reach.walked(x, y, under)` is a **height**, and a floor at 0 is 0: compare with `null`, or ask
`reach.on(x, y, under)`, which gives `{ floor, stands, walked, jumped, trapped }` as yes and no.

**With `mod`, the profile's four lists are used without being given again** (`reachOf`, `spaceOf` for `off`,
`smak map-reach --mod`, `openingViews` with `mod`): a list given by name is added to the
profile's, never put in its place, so naming `wiring: ["ms_text"]` beside a profile that has it changes
nothing. To walk without one of the profile's, hand over the profile without it (`mod: { ...profile, wiring:
[] }`). The Barrow Road's walk gave its wiring again; the fourteen walks of its script come out the same
without it.

## The walk test: what carries it on, and why a part is not walked to

What an agent rebuilding a map met: a body asked for by its name threw a TypeError; a temple walked "a
third" with nothing to say why; a ladder in a shaft 3 wide was never climbed. Now (docs/MAPS.md, the walk
test):

- **A body by its name**: `space.blocked(x, y, "point")`, `restOf(space, feet, "crouching")`, `climbs` the
  same; anything else is refused in a sentence that says what is wanted and what was given (`bodyOf`).
- **What carries the walk on**: teleports (for every way tried, not the walk alone; the landing is no place
  to go to; one that leads nowhere is a warning), ladders off the grid (asked along lines a unit apart), the
  doors of every kind open unless told, and what breaks or is switched off (`func_breakable`,
  `func_wall_toggle`, `func_pushable`) a wall unless `walls: "gone"`; a toggled wall that starts off is not
  there.
- **How much and why**: `share` and `standable` (the floor a standing player fits on, and the part walked),
  and `parts`, each part of the floor not walked to with `how` (`jump`, `crouch-jump`, `crouch`, `wall`,
  `air`, `none`), `why` (where the way leaves the walked floor, or the brush entities in the way, by name),
  `nearest` and `behind`. A fact says when a map is meant to be jumped through. `parts: false` skips it.

The share is counted on the walk's own grid: each place and each stretch of heights a standing player fits in
there, over a floor not too steep to stand on. On Master Sword's maps, on foot with the profile: demontemple
27.3 in 100 (62.3 with `jump: true`, 99.1 with `walls: "gone"` as well), edanasewers 52.9 before the ladders'
shafts and 55.5 after (84.2 with jumps), cleicert_old 5.8 (92.4 with its toggled walls gone: the walk named
them, "behind 72 func_wall_toggle "mainorb1" ..., then 74 func_wall_toggle "freetogo"").

## How much the engine draws: the PVS budget

```
smak check-pvs <map.bsp> [--budget-median 25000] [--budget-p90 36000] [--regions regions.json] [--points points.json] [--step 128] [--no-walk] [-o heat.png] [--verbose]
```

In a script, `maps.checkPvs(bsp, { budget, step, walk, points, regions })` and `maps.pvsPicture(bsp, report)` for
the heat map. Exit code 1 over the budget, and for a map compiled without vis.

**What it measures.** The engine draws every face of every leaf the player's leaf can see (its PVS row, which hlvis
wrote), then clips them to the view. `check-pvs` takes the places players stand, reads each one's row, and adds the
faces of the leaves in it, each face once however many leaves hold it, and the faces of the `func_*` brush entities
whose box touches one of those leaves. The places: the `info_player_*` spawns; the floor of a grid (`--step`, 128)
at the eye (64 over the floor) where the walk test says a player walks (`reachOf`; `--no-walk` takes every floor
with room to stand, quick, and counts rooftops and the tops of walls too); and `--points` (a json list of
`[x, y, z]` or `{ "name": ..., "origin": [x, y, z] }`, such as a mod's NPC nodes: each a player's origin, 28 up to the
eye). It reports the median, the p90 and the max faces, overall and by region (`--regions`: `[{ "name", "min": [x, y],
"max": [x, y] }]`, a z too if wanted; else cells of 1024), the three worst spots (not neighbours) with their
coordinates, and the share of the faces drawn that lie more than 200 units over the spot: open air over roofs is what
connects a city. The picture is the plan with each spot tinted (green, yellow at the median's budget, red at the
p90's, violet over it), the worst spots crossed. A map with no vis is a FAIL by its own sentence: the engine then draws
everything from everywhere. Version 30 and Xash's BSP2 are read alike.

**What it does not measure.** Faces before the view clips them: the engine draws about the part in front of the player
(on a city map a 90 degree cone held about a sixth of it), so the budget is a size of the problem and not
frames. The default budget (median 25000, p90 36000 faces) is a city map of 45500 faces (14000 of them func_wall entities) that its owner measured at 200 fps, 140 at its worst: it draws median 23400, p90 33300, max 34500. A smaller city map that plays well draws median 11500, p90 13800, max 15000; a new map that aims lower gives its own budget. Take a budget from the maps a game has run well on the machines it is played on, not from these two.
What to do with a FAIL is in `docs/TROUBLE.md`.

## Room before a door

`doorClearance(map, { props })` (and `smak map-doors`) asks, of every door, whether a standing player fits on each
side of it: just past its leaf, and a step of 32 further on, at one place at least along its width, on a floor
within a step of its foot. A door thin across z (a hatch, a lift) is passed over. The walk test does not ask this: it
starts on one side, and a door it walks through from the other side's room is reached all the same.

A prop (a point entity with a model) stops nothing in the hull unless a CLIP brush was laid with it, and a player
sees a bench before a door as a door shut either way: `props` (`propsOf(map).props`, which `map-doors` gives from
the `--game` folders' models) are counted by their boxes, and the sentence names the one that stands there. A side
with no room may also be a door that only shows a face: the person says which it is.

It was made after smak_byz01 was walked in H9: benches, flowers and a sentry stood before six street doors, and
neither the walk test nor the plan's own check had said so. On that build `map-doors` names the six, each with its
model; on the build after the fix it passes.

`doorViews(map)` gives, for `viewsOf`'s `at`, each door from both its sides at a standing player's eye, two steps
back or nearer where a wall is closer, from where the door is seen (not from the next room); a side with no place
to stand is looked at from the eye alone. `smak map-views <bsp> -o doors.png --each-door` draws them in sheets of 24
(`--each-door 4,smak_byz01_m1_hall`: those doors only): what stands before a door, as a player meets it.

## Scripts of one's own against the game's

For a mod whose maps and scripts name scripts by path, and which lays one's scripts over its own pack: a
file at a path the pack has takes that script's place; one at a new path does something only if something
names it. `scriptsPlaced` tells the three apart:

```
smak scripts content/scripts maps/yard.bsp --mod profile.mjs --game <mod folder> [--shipped <the pack unpacked>]

replaces  monsters/wolf
new       yard/keeper: named by the map yard (entity 161 ms_npc "keeper")
new       yard/map_startup: named by the game itself, when the map yard starts
UNNAMED   world/server/maps
WARN  1 scripts are new (the game ships none of that name) and nothing names them: ...
```

A new script is live when a map's entity names it, when the game runs or lists it by itself, or when a live
script's text names it (the game's own scripts, ours in their place, and every new one made live in turn).
How scripts are named is the profile's `scriptPack` (`shipped`, `loose`, `ofEntity`, `aliases`, `started`:
`src/maps/scripts.mjs`). `map-check --scripts <folder>` says the same of that map's folders, and warns of a
script named by nothing only when it is that map's own (under a folder of the map's name, or as the
profile's `mapOf` says) or named only by one of its own: another map's script is named by that map, which
is not looked at, and is counted in a fact instead. `--all` warns of every one, as `smak scripts` does
(`scriptsPlaced({ ..., only: ["yard"] })` in a script). What it cannot see is a name put together while the
game runs: a script reached only so is "named by nothing", a warning.

**What the game would cut.** A profile's `lint(name, text)` gives warnings of a script's own lines, under its
name. Master Sword's warns of an entity's `desc` over 72 characters and a `name` with a prefix (`the|Warden's
Bow`) over 29, prefix and name together: the game cuts both there (shared/ms/scriptcmds.cpp, ScriptCmd_Desc and
ScriptCmd_Name) and says only "Description too long" in a developer's console. A name with no `|` is not cut
there. The words of a line are joined by one space each, as the game joins them:

```
WARN  items/armor_reaver (content/scripts/items/armor_reaver.script): line 26: its desc is 123 characters, and
      the game keeps 72 of it (...): "Dark hides sewn into a sleeveless jerkin, a wolf's fur over the shoulder"
      (cut: "s: what a raider of the northern coast wears ashore")
```

## A compile that is seen, and stopped

`compileMap` always had a time for each program (2 minutes for hlcsg and hlbsp, 15 for hlvis and hlrad;
`timeout: { hlvis: ms }`); a program that passes it is stopped, the error says so, and no `.bsp` is written.
New:

- `progress: true` hands on what the compilers print as they work (to standard error; a file descriptor
  will do). `smak map-compile` does it by itself on a terminal, `--progress` / `--no-progress` say otherwise,
  and `--timeout 600` or `--timeout hlvis=600,hlrad=1200` sets the times in seconds.
- `result.portals`: `{ leaves, portals, seconds }`, read from the `.prt` hlbsp leaves. The portals are
  hlvis's work. Measured: 5088 portals, 219 seconds of full hlvis on 12 threads; 269 portals, 0.01. The
  time is taken to grow with the square of the count, so `seconds` is a GUESS from one map, and no floor:
  595 portals were guessed at 3 seconds and took a tenth of one. The summary says what a full hlvis took
  once it has run, and a guess only from 60 seconds on, called a guess (`portalsLine(result)`); under that
  it counts the portals and foretells nothing. From 4000 portals, or when the guess passes hlvis's time, a
  warning says so **before** hlvis begins.
- `result.facts`: a draft (`fast`) says what it is: hlrad bounced no light (its own log: `bounces 0` where
  the full compile has 8), so what no lamp sees directly is black.
- the summary and the command print each program's seconds, "stopped" for one that was, and the portals.

## The light on the floor

A view's `brightness` is the mean of one picture: walls, ceiling and floor together. A lamp high in a room
makes a bright picture of a room whose floor is dim, and the game lights whatever stands in a room (a
monster, a chest) by the light of the floor under it. `lightReport` reads the lightmaps of the floors:

```js
const light = maps.lightReport(bsp, { rooms: { hall: { min, max }, tomb: { min, max } } });
// light.floor { area, mean, least, most, darkShare }, light.rooms [{ name, mean, dark, dim }], light.patches
```

```
smak map-light map.bsp [--rooms rooms.json] [--dark 24] [--walked] [--switched start|off|on]
```

**Switched lights count as the map starts.** hlcsg gives every light that has a name a style of 32 or more,
for a switch to turn it on and off. Half-Life's CLight::Spawn (dlls/lights.cpp) sets such a style ON when the
map starts, unless the light's spawnflags have 1 ("initially dark"). `stylesAtStart(bsp)` reads which start
dark; `lightReport` (`switched: "start"`, the default), the views (`light: true`) and `map-character` count
the rest as on. Before 0.18.0 they counted every switched light off, and a role-play map, where nearly
every room's lamp has a switch, read black. `switched: "off"` (`--switched off`, `--light off`) is that
old count; `"on"` (`--light all`) every switch on.

A room is **dark** when its floor's samples average under 24 of 255 (this kit's own line), and **dim** when
it has under 0.6 of the light of the map's middling room: the eye settles to the rooms it came through.
Without rooms, the dark of the floor is gathered into stretches and listed with their places. With
`reach` (`--walked`), only floor a player walks is counted.

The numbers are the bytes hlrad stored. The engine (Xash's GL renderer, its defaults) shows texture x
sample x 2; this kit's views use 1.55. Both are a straight multiply, so a view is as true as the lightmaps
are: of a draft it shows the draft's light.

## The battery after the compile

`levels/tools/build-site.mjs` runs `siteBattery` (levels/assembly/views.mjs) on the `.bsp` and the `.map` it wrote, and any FAIL is the build's. Each answer is one line, `name PASS|FAIL: numbers (detail: file)`, its detail in `<name>.<check>.txt` beside the map: **reach** (`reachOf` from each group of spawns to the front of every street door and every public cell of the plan, the unreached listed; not asked: the ground a roof way's crate climb or stair stands on and the open trench of a stair down, `publicCells`, byz02's 18 misses), **doors** (`doorClearance`: room to stand before the brush-entity doors, the props with no CLIP counted as solid), **fronts** (`checkDoorFronts`, `levels/assembly/fronts.mjs`: every street door, shop front and mover from its middle at 40 over the floor: FAIL under 72 to anything solid, the world, a brush entity's own model, a CLIP or a prop's box; solid at 10, 40 and 70 within 112 of a street door, a wall or column that fills the view of a player stepping out, 112 because the narrowest street, 2 cells, puts the facing wall 120 off; or no place to stand 36 out; the `doors` answer above measures the `func_door`s only, and the 14 street doors of byz02 are teleports, so four of them faced a column 84 away and passed), **spawns** (`checkSpawnViews`: from each spawn at eye height along its own `angles` yaw, FAIL under 128 to the first solid, a WARN when the entity has no angle and the open side is elsewhere; the placer turns a spawn that would face a wall, `openYaw`), **props** (every solid prop of the dressing has a CLIP brush on its box in the `.map`), **clips** (a CLIP brush that stands on no prop and no piece, or in a door's front: `blockageProblems` over the `.map`'s own brushes), **light** (public floor a player walks whose lightmap samples average under `DARK_FLOOR`, the cells listed), **pvs** (`checkPvs`, as `smak check-pvs`), and the budget line that was already there. Then the eye-height views (64 over the floor): one sheet of six from the spawns and the plazas' middles, and sheets of the street doors as a player steps out (72 off, looking away), and `<name>.report.md` lists every line and every picture by its path. `--battery-only <folder>` runs it over a folder built earlier (its `.bsp`, `.map` and `dress-report.json`) into `--out`, without dressing or compiling. It was made after the owner's walk of byz02 (2026-11-08): street lamps on stairs and roof ways, props with no collision, props before doors, and a build that said PASS.

## A band left empty on purpose

A spawn area's place has one template for each strength of party (`reqhp` "0;150", "150;500", "500" in
Master Sword), and the profile's `bands` rule warns when the ranges at a place do not meet: "nothing has 150
to 500, between 0;150 and 500". A map may leave a place empty in one band on purpose (the Barrow Road keeps
some of its places for the weak and the strong only), and then the warning hid the true faults among 18 that
were meant.

The rule's `open` names a key by which the map says so, on the place's templates: Master Sword's profile reads
`reqhp_none`, the ranges left empty there parted by commas.

```
msmonster_skeleton  spawnarea road1_spawn  reqhp "0;150"  reqhp_none "150;500"   (and the one of "500" the same)
```

- A range said to be empty fills the gap: the place's ranges meet, and nothing is said.
- A gap the key does not cover is still told ("nothing has 500 to 600, between 150;500 (left empty) and
  600"), and so is a range said to be empty that a template has ("150;500 (left empty) and 150;500
  overlap"), and a value that is no range.
- The game reads no such key: it is a note for the check, and the check of keys a class does not define
  passes over a key a rule of the profile names as its `open`. A profile without `open` reads none (the key
  is then a key its class does not define, and the gap a gap).

Measured: maps/barrowroad (msr-web) had 18 such warnings, each a place meant to be empty in the middle band;
with `reqhp_none` on its templates (its monsters the same) its `checkPlan` and `checkBsp` say 0 warnings.

## How the monsters come, and how the map looks

Added after a player walked the first two maps of a series made with this kit (2026-10-16): monsters
appeared in front of him, wolves and boars of one terrace fought each other, the reward appeared back at the
start, and one of the maps was "all straight lines". `docs/MAPS-DESIGN.md` has what the game's own maps do
instead; these are its two checks.

**`spawnsOf(map, { mod })`** (`smak map-spawns`, and among `map-check --mod`'s warnings) reads a mod's spawn
areas by the profile's `spawns` (encounters.mjs has each field; Master Sword's profile has them all): how each
area comes (`start`, `arrival`, `fired`) and the first things that fire it (`touch`, `use`, `break`, `start`,
`death`, `cleared`, `script`, `arrival`, `nothing`), followed back through relays, counters and
multi_managers. It warns of:

| | what | told when |
| --- | --- | --- |
| SEEN | monsters a player standing in the trigger that brings them could see appear | a clear line from eyes on a grid over the trigger's floor to the monster's chest, within `sight` (3000); through the world, closed doors and the brush entities that hide |
| QUICK | monsters back at their own spot soon after they die | more than one life, back under `quick` (60) s |
| FIGHT | races that attack each other on one spawn | two templates of one area, of bands that can be there together, within `near` (1024), one's race attacking the other's (the profile's `relation`) |
| far reward | a reward far from the death that brings it | over `far` (1024) units from the dying monster's spot |

Measured on Master Sword's 100 maps: 1597 of the 3533 monsters fired by a trigger can be seen appearing
(45%), 51 areas hold races at war; nine seconds for all hundred. On the Old Orchard (msr-web): 87 of 87 on its
terraces seen, from 333 units; 85 back after 8-20 s; three terraces of four or five races, wolves (`rogue`)
attacking everything; the chest 1854 units from the warden.

**`characterOf(bsp, { mod })`** (`smak map-character`) measures walls off the grid, floor that slopes,
floor levels, the spread of the floor's height, textures, props, sounds, music, lights (and beside them
`lampFaces`, the faces wearing a lamp's texture: a map lit by its texture lights, as ts_trident is with one light
entity and 58 lamp faces, reads as lit), and the floor's light
(mean, shadow, brightest); `characterAgainst(figures, reference)` tells each figure on the plain side of the
mod's middle half (`plain`) and warns when five or more are. Master Sword's figures (94 maps) are in its
profile; `learnCharacter` (`map-character --learn`) makes them from any folder of maps. The Specialists' profile
has three sets, by `kind` (`--kind`): `arena` (its 29 maps), `compact` (its eight compact arenas, the maps a small
team map is laid beside) and `roleplay` (Havoc9's cities). The Barrow Road had 8
plain figures and the Old Orchard 6; of the game's maps players come back to, none has more than 3.

## A glow's faint square

With `--game`, `smak map-check` reads the sprites the map's glows name (`env_glow`; render mode 3 or 5; a sprite
whose own format is additive) and counts the lit pixels outside the circle inscribed in the frame. Where 2% or more
are lit, up to 2 or more of 255, it warns that the sprite "draws a faint square around the glow, worse in the dark
and under Xash's gamma". The fix is a sprite with a black border (docs/SPRITES.md), not a smaller scale.
