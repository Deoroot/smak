# The command line

Every command is `node bin/smak.mjs <command> ...` from the kit's folder (`smak <command>` where the kit is
installed as a package); `node bin/smak.mjs help` prints each with its lines. This page has them by use, and
the options the drawing commands share. What each does in a script is in `docs/API.md`; how to use them for a
task is in the guide for that task (`AGENTS.md` has the table).

## Answers in text first

Every command that checks something ends with one line, `PASS: ...` or `FAIL: ...`, with its reasons on it:
`check`, `map-check`, `figure-judge`, `figure-texture`, `figure-shape` and `play`. A pass prints five
lines or fewer: its first warnings (or the judge's score), the file the detail went to (`the detail: ...`),
and the PASS line. A fail prints every error and warning, or every finding, above its FAIL line. The detail is
what these commands printed before 0.27 (a model's facts, a map's counts, each step of a run):

- `check`, `map-check` and the judges write it to `--report <file>`, or unless told to
  `<the system's temp folder>/smak/<command>-<file>.txt`, never beside the game's files.
- `play` writes it to `told.txt` in the run's folder, beside `log.txt` (what the game said).
- `--verbose` prints it as before, and the PASS or FAIL line after it.

| Command | It passes when | Exit code |
| --- | --- | --- |
| `check` | no error for the engine (`--engine`, goldsrc unless told) | 1 on a fail |
| `map-check` | no error for the engine, or for the compile of a `.map`; with `--mod`, none of the mod's; with `--game`, a warning for each glow sprite whose corners are not black (a faint square) | 1 on a fail |
| `figure-judge` | its score is at or over the lower quarter of the scores of the game's own figures, each judged against the rest | 0 either way: a judgement, not a fault |
| `figure-texture`, `figure-shape` | no measure is far out of the corpus' middle half (1.5 middle halves or more) | 0 either way |
| `play` | every expectation held and the run was not stopped; a run that expected nothing passes when it gets to its end, and says its pictures are the test | 1 on a fail |

A line `look at <picture>` says which picture answers what the text cannot (the judges' `--sheet` on a fail,
a run's `sheet.png` when it failed or expected nothing); `no picture to look at` says the text decided.
Pictures are written at the size that answers the question: `play` writes each picture a third of the page
each way (341 by 256 for a page of 1024 by 768; its `sheet.png` keeps the size it had), and the judges'
sheets draw atlases at two pixels a texel and silhouettes at half their size. `--full-pictures` writes them
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
node bin/smak.mjs gif <mdl> -o a.gif --seq reload   an animation as a looping GIF, each frame labelled (--seq all: every one, -o a folder)
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
node bin/smak.mjs figure-survey <Half-Life folder> --mod <msc|ts|halflife> [--library f.json]   the game's own figures
                                                   measured into a library of yours (~/.smak/figures.json): the figure judges' corpus
node bin/smak.mjs figure-judge <mdl> --mod <profile> [--all] [--json]   the style judge: a score 0 to 100, what is out, what to do
node bin/smak.mjs figure-texture <mdl|atlas.png> --mod <profile> [--reference atlas.png --reference-scale 4] [--sheet s.png]
node bin/smak.mjs figure-shape <mdl|pic.png --mask m.png> --mod <profile> [--reference front=mask.png ...] [--pose pose.mjs]
node bin/smak.mjs figure-validate <library.json> [--judge style|texture|shape]   does a judge tell the corpora apart (AUC)
node bin/smak.mjs inline <mdl> -o out.mdl          put the textures of <name>t.mdl inside the model
node bin/smak.mjs obj <file.obj> -o out.mdl [--scale n] [--up y|z] [--turn deg] [--ground] [--centre] [--name x.mdl]
                                                   a model from a Wavefront .obj, its .mtl and pictures found beside it
node bin/smak.mjs pieces <mdl> [--body n]          its loose pieces, each with its number, place and size (--body: that body's only)
node bin/smak.mjs view <folder|mdl> [more ...]     the viewer, for the person: two models side by side in the browser
node bin/smak.mjs mcp --work <dir> [--models <dir>]  the kit as an MCP server, for a client with no shell (mcp/README.md)
node bin/smak.mjs edit <folder|mdl>                the editor, for the person: animations, events and textures by hand
node bin/smak.mjs build <spec.json> [-o dir] [--game <folder> ...] [--mod <profile>]   a spec built by its kind (docs/SPEC.md; a map docs/SPEC-MAPS.md):
                                                   a map of rooms placed by words, a model of parts, textures, sounds, a sprite
node bin/smak.mjs build <model spec> --engine source   the model made for Source: held to Half-Life 2's, compiled for GMod (docs/SOURCE.md)
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
node bin/smak.mjs check-pvs <map.bsp> [--budget-median 25000] [--budget-p90 36000] [--regions r.json] [--points p.json] [--step 128] [--no-walk] [-o heat.png] [--verbose]
                                                   how many faces the engine draws from the spawns, the walked floor and the points
                                                   given, by the compiled visibility, against a budget; a heat map; exit code 1 over it,
                                                   or for a map compiled without vis (docs/MAPS-CHECKS.md, "How much the engine draws")
node bin/smak.mjs map-waypoints <bsp|map> --mod ts [--out <Half-Life>/rcbot] [--plan p.png] [--spacing 160]   RCBot's waypoints
                                                   from the walk test (starts, ladders, jumps, stairs, openings, corners, crouching
                                                   passages; paths where a body walks or drops the straight line), written as the bot's
                                                   .rcw at waypoints/<mod>/<map>.rcw (docs/MAPS.md, "Waypoints for bots")
node bin/smak.mjs map-section <bsp|map> -o s.png --from x,y --to x,y   a side section along that line, floors with their heights
node bin/smak.mjs map-storeys <bsp|map> -o s.png [--z a,b,c] [--reach]   one plan for each storey, side by side
node bin/smak.mjs map-openings <bsp|map> -o o.png [--both]   a view through each gate and doorway the walk test finds
node bin/smak.mjs map-overlay <bsp|map> shot.png --from x,y,z --yaw n [--locate] -o o.png   the map's edges over a picture of it:
                                                   where the map and the picture part, and the faces that are off by how much
node bin/smak.mjs map-textures <bsp> -o dir        every texture of a map as a PNG
node bin/smak.mjs wad <file.wad> [-o dir]          a .wad's textures listed; with -o, each as a PNG
node bin/smak.mjs wad-make <pictures...> -o out.wad   a .wad from PNG or BMP pictures, each named after its file
node bin/smak.mjs map-compile <file.map> -o out.bsp --wad a.wad [--wadinclude] [--fast] [--vhlt <folder>]
node bin/smak.mjs map-compile <file.map> ... [--timeout 600 | --timeout hlvis=600,hlrad=1200] [--progress]   a stage seen and stopped
node bin/smak.mjs map-decompile <bsp> -o out.map [--game <folder> ...]   a compiled map back into brush source, its own .wad beside it (docs/MAPS.md, "Decompiling")
node bin/smak.mjs gmod-port <mdl> -o <folder> [--name n] [--folder smak] [--collision auto|hull|box|ragdoll|none] [--surfaceprop wood] [--mass kg]
                              [--kind thing|view|held|player] [--upper] [--hand-roll degrees] [--studiomdl <exe>] [--no-compile]
                                                   a GoldSrc model ported to Garry's Mod: the compiler's files (src/), the addon (addon/),
                                                   compiled by GMod's studiomdl, held to the original corner by corner, its travel,
                                                   blends and fades, drawn (sheet.png) (docs/SOURCE.md); exit code 1 when the compiled
                                                   model lost anything. --kind: a v_ model is a view model, a p_ one held, one under
                                                   models/player/ a player (Valve's bone names and hands); --upper: a player's
                                                   animations copied from the spine up. The sounds its events play go into the addon
node bin/smak.mjs gmod-map <bsp> -o <folder> [--name n] [--game <mod folder>] [--valve <folder>|none] [--no-physics]
                                                   a GoldSrc map rewritten as a Source map for Garry's Mod (docs/SOURCE.md, "A GoldSrc
                                                   map in GMod"); <folder>/addon goes into garrysmod/addons/<name>/
node bin/smak.mjs gmod-rcon <command> [...] [--password p] [--port 27015]   console commands to a running GMod over RCON
node bin/smak.mjs gmod-probe <file.lua | map> [--client] [--wait ms] [--game <folder>] [--port p]
                                                   Lua run inside the game, PASS or FAIL from its check() lines; built in: map
node bin/smak.mjs gmod-shoot <x> <y> <z> [pitch yaw] -o shot.jpg   a screenshot from GMod's client, HUD and view model hidden
node bin/smak.mjs gmod-server <folder> --map <name> [--port 27016] [--password p]   a dedicated server from SteamCMD
node bin/smak.mjs gmod-collision <GoldSrc bsp> [--count 5000] [--ducked] [--noclip] [--game <folder>] [--port p]
                                                   where a player is blocked in the GoldSrc map and in its port, spot by spot
node bin/smak.mjs sbox-port <mdl> -o <Assets folder> [--name n] [--folder smak] [--kind thing|view|held|player] [--sbox <folder>] [--no-compile]
                                                   a GoldSrc model ported to s&box: DMX meshes and animations, a .vmdl, PNG and .vmat
                                                   under an s&box project's Assets, compiled by s&box's resourcecompiler (docs/SBOX.md)
node bin/smak.mjs sbox-check <mdl> --project <folder> [-o shot.png] [--frames 2] [--tolerance 0.1]
                                                   the port read back in s&box's editor and held to the original: bones, animations,
                                                   parts, skins, attachments, hit boxes, and every bone of each animation's poses
node bin/smak.mjs source-info <mdl | models/...mdl> [--json] [--gmod <folder>] [--addon <folder>]
                                                   what a Source model holds; a path under the game is read from GMod's folders and packs
node bin/smak.mjs source-sheet <mdl | models/...mdl> -o s.png   /   source-render ... -o r.png [--yaw] [--pitch] [--body] [--skin]
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
node bin/smak.mjs map-teams <bsp|map> --mod ts [--goal x,y,z|<entity>] [--cfg f.cfg] [--each] [--write-cfg [dir]]
                                                   two teams as Havoc9's ts_matchmode splits the spawns (or its spawn file's): the
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
