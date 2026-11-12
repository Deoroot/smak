# The command line

Every command is `node bin/smak.mjs <command> ...` from the kit's folder (`smak <command>` where the kit is
installed as a package); `node bin/smak.mjs help` prints each with its lines. This page has them by use, and
the options the drawing commands share. What each does in a script is in `docs/API.md`; how to use them for a
task is in the guide for that task (`AGENTS.md` has the table).

## Answers in text first

Every command that checks something ends with one line, `PASS: ...` or `FAIL: ...`, with its reasons on it:
`check`, `motion`, `map-check` and `play`. A pass prints five
lines or fewer: its first warnings, the file the detail went to (`the detail: ...`),
and the PASS line. A fail prints every error and warning, or every finding, above its FAIL line. The detail is
what these commands printed before 0.27 (a model's facts, a map's counts, each step of a run):

- `check` and `map-check` write it to `--report <file>`, or unless told to
  `<the system's temp folder>/smak/<command>-<file>.txt`, never beside the game's files.
- `play` writes it to `told.txt` in the run's folder, beside `log.txt` (what the game said).
- `--verbose` prints it as before, and the PASS or FAIL line after it.

| Command | It passes when | Exit code |
| --- | --- | --- |
| `check` | no error for the engine (`--engine`, goldsrc unless told); a form boxier than 19 of 20 of Half-Life's models of its kind is a `WARN: form:` line, not a fail; a hard fault in an animation's motion is a `WARN: motion:` line, grouped by fault, not a fail | 1 on a fail |
| `motion` | no hard fault in the animations measured (a pop, jitter, a flip, a joint past its range, lockstep, a stall, a tail still moving, a loop that does not close, foot slide, parts through each other, a forearm no shoulder holds or aimed at the eye, a held blade that leads its blow with the flat); the class's bands are facts; a view model's screen (too much covered, a mesh seen into) is a `WARN  screen:` line, not a fail | 1 on a fail |
| `map-check` | no error for the engine, or for the compile of a `.map`; with `--mod`, none of the mod's; with `--game`, a warning for each glow sprite whose corners are not black (a faint square) | 1 on a fail |
| `play` | every expectation held and the run was not stopped; a run that expected nothing passes when it gets to its end, and says its pictures are the test | 1 on a fail |

A line `look at <picture>` says which picture answers what the text cannot (a run's `sheet.png` when it failed or expected nothing);
`no picture to look at` says the text decided.
Pictures are written at the size that answers the question: `play` writes each picture a third of the page
each way (341 by 256 for a page of 1024 by 768; its `sheet.png` keeps the size it had).
`--full-pictures` writes them
at the full size.

## The commands

```
node bin/smak.mjs info <mdl> [--json] [--hitboxes] [--boxes]   bones, bodyparts with their body numbers, textures, animations
                                                   (activity, travel and speed), events, attachments, hit boxes
node bin/smak.mjs check <mdl> [--engine xash|source]   errors and warnings; exit code 1 on an error
                                                   (--source original.mdl: what the original has too is marked "inherited")
node bin/smak.mjs check --publish <folder> [--game <Half-Life folder>] [--ours ts/maps/mymap.bsp ...]
                                                   before a folder is shared: FAIL on a file that is the game's byte for byte, one
                                                   of the game's textures inside a .wad or .bsp of it, a path into the person's own
                                                   folder (text, a map's entities), a key or a token; WARN on another absolute path,
                                                   an archive over 50 MB, no readme. The game is the Half-Life folder Steam has
                                                   unless told; --ours: a file of the person's installed in it (a map of theirs)
node bin/smak.mjs sheet <mdl> -o s.png             six views in one picture
node bin/smak.mjs render <mdl> -o r.png --yaw 30 --pitch 15 [--view first|side|front|top] [--ground]
node bin/smak.mjs strip <mdl> -o a.png --seq reload --count 12 [--view first]   (a walk: --view side --ground)
node bin/smak.mjs strip <mdl> -o a.png --seq 2 --view first --screen 16:9 --every [--beside game.mdl [--beside-seq n]]
                                                   the game's eye: the player's screen (16:9, 4:3, 16:10, w:h; --fov 90 on a 4:3 base
                                                   widened Hor+, 106.26 across 16:9; the near plane at 4), every frame with its time, the
                                                   other model's same frames under each row
node bin/smak.mjs strip <mdl> -o o.png --seq 2 --view first --screen 16:9 --onion [--bones Bone23,Bone01] [--mark f]
                                                   an onion skin: the bones' (and those under them) outlines at every frame, blue first to
                                                   red last, over the first drawn solid; a jump, an arm aimed at the eye, a fan show at once
node bin/smak.mjs gif <mdl> -o a.gif --seq reload   an animation as a looping GIF, each frame labelled (--seq all: every one, -o a folder);
                                                   at the sequence's own rate; --view first --screen 16:9, --beside other.mdl as strip
node bin/smak.mjs textures <mdl> -o dir [--bmp]    every texture as a file
node bin/smak.mjs uv <mdl> -o dir                  every texture with the triangles that wear it drawn over it
node bin/smak.mjs islands <mdl> [-o dir] [--body n]  the islands each picture is cut into, listed; with -o, drawn tinted and numbered
node bin/smak.mjs layers <mdl> [layers.mjs] ["name=expression" ...] --texture t [--body n] [-o l.png]
                                                   layers of a texture (what is mail, what is strap): their regions listed; with -o, drawn tinted
node bin/smak.mjs retexture <mdl> <texture> <picture> -o out.mdl
node bin/smak.mjs sequence <mdl> <anim> -o a.json  /  sequence-set  /  sequence-add
node bin/smak.mjs sequence-add <mdl> --from sitstand --frames 80-57 --name kneel_down -o out.mdl [--loop] [--fps 25]
                                                   a new animation of frames of one it has ("80-57": backwards; "57,58,57")
node bin/smak.mjs reskin <mdl> rules.mjs -o out.mdl [--body n] [--pictures dir]   a game's model re-skinned by rules
node bin/smak.mjs reproportion <mdl> "Bip01 L Thigh=1.2" "Bip01 L Clavicle=0.8" -o out.mdl   bones longer or shorter, every
                                                   animation kept, the feet on the ground (docs/API.md, "A skeleton's proportions")
node bin/smak.mjs inline <mdl> -o out.mdl          put the textures of <name>t.mdl inside the model
node bin/smak.mjs obj <file.obj> -o out.mdl [--scale n] [--up y|z] [--turn deg] [--ground] [--centre] [--name x.mdl]
                                                   a model from a Wavefront .obj, its .mtl and pictures found beside it
node bin/smak.mjs pieces <mdl> [--body n]          its loose pieces, each with its number, place and size (--body: that body's only)
node bin/smak.mjs view <folder|mdl> [more ...]     the viewer, for the person: two models side by side in the browser;
                                                   "game's eye" shows a view model as the player does (fov on a 4:3 base,
                                                   Hor+, the screen's shape; ?eye=1&fov=80&screen=16:9 in the address), ← → a frame
node bin/smak.mjs mcp --work <dir> [--models <dir>]  the kit as an MCP server, for a client with no shell (cli/mcp/README.md)
```

For maps (their recipes are in docs/MAPS-LOOKING.md, docs/MAPS-CHECKS.md and docs/MAPS-MAKING.md):

```
node bin/smak.mjs map-info <bsp> [--json]          size, lumps, entities by class, textures and which are wanted from .wad files, light
node bin/smak.mjs map-check <bsp> [--engine xash] [--game <folder> ...]   errors and warnings; exit code 1 on an error
node bin/smak.mjs map-check <bsp|map> --mod <profile.mjs|.json|goldsrc> [--fgd <file.fgd>] [--learned <file>] [--game <folder> ...]
                                                   its entities against the mod: classes, keys, values, names, the mod's rules, files
node bin/smak.mjs map-learn <folder of .bsp> -o learned.json [--class name]   what a mod's own maps say of its entities
node bin/smak.mjs map-entities <bsp> [--class x] [--json]   every entity with its number, class, place and keys
node bin/smak.mjs map-set <bsp> -o out.bsp --entity <n|class> key=value ... [--move x,y,z] [--unset key]
node bin/smak.mjs map-set <bsp> -o out.bsp --add <class> [--at x,y,z] key=value ...   /   --remove <n|class>
node bin/smak.mjs map-plan <bsp|map> -o p.png [--z height] [--area x0,y0,x1,y1] [--scale px] [--list]   from above, entities marked
node bin/smak.mjs map-view <bsp|map> -o v.png [--from x,y,z | --at <entity n|class>] [--yaw 90] [--pitch 0]   from inside
node bin/smak.mjs map-views <bsp> -o v.png [--count 8]   from the places to start and the largest rooms, in one picture
                                                   --each-door [n|name,...]: each door from both its sides at the eye, in sheets
node bin/smak.mjs map-doors <bsp|map> [--game <folder>] [--no-props]   room for a standing player before each door, both
                                                   sides; a prop (by its model's box) or a wall before one is named; exit code 1
node bin/smak.mjs map-reach <bsp|map> [-o walked.png] [--goal <n|class>] [--jump] [--doors closed] [--open <name>] [--shut <name>]
                                                   the walk test: what is not reached and why, what stands in solid, the openings,
                                                   the one-way places (--exit <name>: a way out of the map); exit code 1 on a fault.
                                                   --jump: with jumps, up 45 and across gaps (--speed 320 --gravity 800); --no-slopes
node bin/smak.mjs map-battery <bsp> [--map m.map] [--rooms rooms.json] [--log compile.log] [--game <folder>] [-o dir]
                                                   every player-facing check over a compiled map, hand-made or not, a line each (PASS,
                                                   WARN or FAIL with its first reason): reach, light, door and opening fronts, spawn
                                                   looks, sky gaps, coplanar faces (with --map), PVS, budget, sweep, the compile's log;
                                                   the detail in <dir>/battery.txt, the pictures named; the last line PASS, WARN or FAIL
                                                   with the counts, exit code 1 on FAIL (docs/MAPS-CHECKS.md, "The battery over a built map")
node bin/smak.mjs check-pvs <map.bsp> [--budget-median 25000] [--budget-p90 36000] [--regions r.json] [--points p.json] [--step 128] [--no-walk] [-o heat.png] [--verbose]
                                                   how many faces the engine draws from the spawns, the walked floor and the points
                                                   given, by the compiled visibility, against a budget; a heat map; exit code 1 over it,
                                                   or for a map compiled without vis (docs/MAPS-CHECKS.md, "How much the engine draws")
node bin/smak.mjs map-skygaps <bsp> [--step 128] [--rays 2000] [--roof any|under] [--thin 24] [--eyes p.json] [--windows w.json] [--verbose]
                                                   sky seen through a gap: rays from every eye at the spawns and over the walked floor,
                                                   under a roof or in the open (--roof under: those under a roof only); an opening under
                                                   24 units is a gap, told with the eye, the way it looked and where it is; a window is
                                                   wider and no gap, --windows names places meant; WARN and exit code 1 on a gap
                                                   (docs/MAPS-CHECKS.md, "Sky through a gap")
                                                   from the walk test (starts, ladders, jumps, stairs, openings, corners, crouching
                                                   passages; paths where a body walks or drops the straight line), written as the bot's
                                                   .rcw at waypoints/<mod>/<map>.rcw (docs/MAPS.md, "Waypoints for bots")
node bin/smak.mjs map-section <bsp|map> -o s.png --from x,y --to x,y   a side section along that line, floors with their heights
node bin/smak.mjs map-storeys <bsp|map> -o s.png [--z a,b,c] [--reach]   one plan for each storey, side by side
node bin/smak.mjs map-openings <bsp|map> -o o.png [--both]   a view through each gate and doorway the walk test finds
node bin/smak.mjs map-textures <bsp> -o dir        every texture of a map as a PNG
node bin/smak.mjs wad <file.wad> [-o dir]          a .wad's textures listed; with -o, each as a PNG
node bin/smak.mjs wad-make <pictures...> -o out.wad   a .wad from PNG or BMP pictures, each named after its file
node bin/smak.mjs map-compile <file.map> -o out.bsp --wad a.wad [--wadinclude] [--fast] [--vhlt <folder>]
node bin/smak.mjs map-compile <file.map> ... [--timeout 600 | --timeout hlvis=600,hlrad=1200] [--progress]   a stage seen and stopped
node bin/smak.mjs map-light <bsp> [--rooms rooms.json] [--switched start|off|on]   the light on the floors, room by room: what
                                                   the game lights a figure by; switched lights as the map starts (on unless made
                                                   to start dark) unless told
node bin/smak.mjs map-wiring <bsp|map> [--list]   what the entities are wired to do, as a role-play map is judged: properties
                                                   (doors by name), switches and what each works through relays, lifts, places that
                                                   heal or hurt, names said from many speakers, what comes back; slips warned of
node bin/smak.mjs map-spawns <bsp|map> --mod <profile> [-o plan.png]   how each spawn area's monsters come, and by what; those
                                                   seen appearing from the trigger that brings them (SEEN), back soon at their own
                                                   spot (QUICK), races that attack each other on one spawn (FIGHT), a reward far
                                                   from the death that brings it; exit code 1 on SEEN or FIGHT (docs/MAPS-DESIGN.md)
node bin/smak.mjs map-character <bsp> [more maps or folders] [--mod <profile>]   its ground, textures, props, sounds and light in numbers,
                                                   held against the mod's own maps: PLAIN figures, and a warning on five or more
                                                   (--mod ts --kind compact: The Specialists' eight compact arenas; lamp faces beside lights)
node bin/smak.mjs map-dressing <bsp> [--mod ts] [--against <bsp|bands.json>]   walls, textures, lamps, detail and floor light beside
                                                   Valve's campaign, or the mod's own bands (--mod: its profile's `dressing`);
                                                   --learn -o bands.json over a folder of maps makes such bands
node bin/smak.mjs form <mdl|bsp|map> [--form props|vehicles|creatures]   how much of it is a pile of boxes: of a model the surface on the axes, bare 80-degree
                                                   edges, silhouette corners and a boxiness 0 to 1 beside Half-Life's own models of its kind; of a
                                                   bsp or map its furniture's bare boxes and edges (and a map's world off the axes). WARN, never FAIL,
                                                   with what to do; `check <mdl>` says the same among its warnings (`--form off` leaves it out)
node bin/smak.mjs motion <mdl> [--seq <name|n|all>] [--kind figure|melee|firearm|none] [--draw out.png]   one animation's motion (every one unless
                                                   told) in numbers, bone by bone, and its hard faults: pops, jitter, flips, a joint past its range,
                                                   lockstep, a stall, a tail still moving, a loop that does not close, foot slide, parts through each
                                                   other; FAIL on one. The class's bands (figure: Half-Life's own figures; told by the feet and the
                                                   file's name unless given) are facts, never faults. --draw: each bone's turn a frame over the
                                                   animation with the faults marked in red, the strip under it (first person for a v_ model, --view);
                                                   `check <mdl>` says the faults grouped among its warnings (`--motion off` leaves them out).
                                                   A view model's arms (Biped's on a v_ file, or --arms fore:hand[:held],... by name or number)
                                                   against a body where seen on --eye fov:aspect (90:16/9): a forearm's root no upper arm reaches,
                                                   an elbow over its shoulder, a forearm end-on, one arm through the other; the hand's arc,
                                                   spacing, anticipation and the tip's lag as facts. A held blade (the :held of --arms, its
                                                   edge and flat from its mesh) in a blow (an animation named slash, attack, swing, stab, hit ...):
                                                   FAIL where its tip moves over 35 degrees off the edge on average over the cut (it hits with the
                                                   flat); else a fact. The forearms' sweep (the share of the screen they cover over the hand's
                                                   fastest stretch, the fan) is a fact in the detail; --fov follows --eye's. --json: each animation's measures
                                                   A view model (v_, or --view first) is seen by the game's eye too (--screen 16:9 unless told):
                                                   WARN where the mesh covers more of the screen than Half-Life's own ever do (35%), or the player
                                                   sees into a mesh through its open end (0.3%) or a cut of the near plane (1.2%), with the frames,
                                                   the bone and where; [--bones a,b] measures those, [--weapon b] leaves the weapon out; --json
node bin/smak.mjs map-teams <bsp|map> --mod ts [--goal x,y,z|<entity>] [--cfg f.cfg] [--each] [--write-cfg [dir]]
                                                   two teams as the ts_matchmode plugin splits the spawns (or its spawn file's): the
                                                   nearest across (FAIL under 512, WARN under 1400), spawns in sight of the other
                                                   side's (FAIL), the walks to a goal and their balance (WARN over 10%, FAIL over
                                                   25%); --write-cfg: tsm_spawns_<map>.cfg in the plugin's format; exit 1 on a FAIL
node bin/smak.mjs map-props <bsp|map> [--mod <profile>] [--game ...] [--views dir]   each prop, NPC, monster, chest and start
                                                   held against the world: WARN stuck or buried in solid, a prop floating; NOTE partly
                                                   in a wall, its nose to a wall (turned the wrong way?), standing on another model.
                                                   --views: a picture of each, from the side with room. Look at the NOTEs' pictures
node bin/smak.mjs map-viewer <bsp|map|svg|png> [--mod <profile>] [--game ...]   the map in 3D in the person's browser, its
                                                   entities as their models with the way each faces, what map-props says marked;
                                                   reloads as the file changes. For the person: you look with map-view and map-props
node bin/smak.mjs sketch <svg|png> -o out.map [--legend legend.json]   a map from a person's drawing (docs/MAPS-SKETCH.md)
node bin/smak.mjs scripts <script folders, maps...> --mod <profile> [--shipped <folder>]
                                                   each script of one's own: replaces a game's, is named, or is named by nothing
node bin/smak.mjs item <piece.mjs> --mod <profile> --game <mod> --family <name> --name <word> -o dir [--pictures]
                                                   a new weapon, shield or bow in the game's own model files, and its script's numbers (docs/ITEMS.md)
node bin/smak.mjs play <url> --map <name> [--steps steps.json] -o dir [--mod <profile>] --playwright <folder>
                                                   the map in the game itself, where the person has a browser build of it and Playwright:
                                                   entered, walked, spoken in, pictures taken, and every line the game says written down;
                                                   steps wait for a line (until) and a run passes or fails by lines (expect): docs/PLAY.md.
                                                   --serve keeps the game up and --attach runs in it: seconds a run, not a minute
node bin/smak.mjs play native --map <name> --mod ts [--steps steps.json] -o dir
                                                   the same in the game Steam installed, by its console alone (no keys, no mouse):
                                                   its lines and its own screenshots; nothing but Node (docs/PLAY.md)
```

The three that draw take `--width`, `--height`, `--game <folder>` (the mod's folder, then `valve`: where the map's
`.wad` files are; the map's own folder is always looked in), `--wad <file.wad>`, `--no-light`, `--light steady|all`,
`--brightness n` and `--entities all|models|game|none`. `map-plan` also takes `--heights` (each floor's height
written on it), `--legend` (the entities listed beside it) and `--reach` (the walk test tinted on it). An
entity that stands is drawn as the box it moves with: `--body <class|targetname>=large` says which box;
`--models` draws the models that are named, from the `--game` folders, and `--model <class|targetname|scriptfile>=models/x.mdl`
names one. With `--game` the sky is its own picture and each sprite its first frame (`--no-sky`, `--sky r,g,b`,
`--no-sprites` say otherwise); `--no-model-scale` draws models at their own size. Every one of these commands
takes `--mod <profile>` as `map-check` does (with `--game`, and `--scripts <folder>` for scripts not in the
game yet; `--mod ts` or `--mod msc` names one of the kit's profiles, and without `--game` the installed Half-Life
is found: `SMAK_HALF_LIFE`, or Steam's libraries): the mod's folders, the box each of its classes moves with, its ways out for the walk test and, with
`--models`, the model the mod gives an entity that names none: a monster is then drawn as the model its
script picks, with nothing named by hand.

`view` keeps running until stopped: start it in the background, give the person the address it prints, and stop
it when they are done. It is for them to look and compare; your own checking is still `render`, `sheet` and
`strip`, whose pictures you can read.

`render`, `sheet` and `strip` take `--seq <name|number|rest>`, `--frame`, `--body`, `--skin`, `--width`,
`--height`, `--no-light` (the texture as it is) and `--no-cull` (both sides of every triangle); an animation kept
in `<name>01.mdl` is read from beside the model (with `gif` too). `--view side`,
`front` and `top` look from there with no perspective (`side` is the left side: the front is to the picture's
left), and with `side` or `front`, `--ground` draws the floor (z = 0) as a line across the picture. `--yaw`
and `--pitch` with one of them turn the camera on from there: `--view front --yaw 205` looks from 205,
`--view side --yaw 30` from 120.

**If a picture comes out empty**, the body number shows an empty submodel. Many models keep a blank submodel at
body 0. `info` lists the body number of each submodel; pass it with `--body`.

**Which way is the front depends on the pose.** Yaw 0 looks at `+x`, and a model faces `+x` *as its animations
stand it*. Its rest pose (`--seq rest`, `seq: null`) can be turned from that: one armour's bones rest a quarter
turn from frame 0 of its animation, so that "front" at rest showed its side, and a point measured at rest was
not where the animated model had it. Draw, measure and paint in a pose the game shows (`--seq 0`, or
`{ seq: "idle", frame: 0 }`), use the same pose for every step of a job, and compare one picture at rest with
one animated before trusting either.
