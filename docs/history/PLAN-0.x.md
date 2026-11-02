# SMAK: the next plan (fewer errors, easier tests, fewer tokens)

Started 2026-10-24, after reading [universal-modder](https://github.com/rehan-remade/universal-modder) (MIT;
read, not installed). What it does better than SMAK is taken here as ideas, written SMAK's way: Node, no
dependencies, tested. Its fal (paid) generation, its Python CLI and its playbooks for other engines are not
taken.

Each phase says what it is for, what it delivers, and how we know it worked. The measures in "Now" were taken
on 0.26.0.

## Now (0.26.0)

| Measure | Value |
| --- | --- |
| What an agent reads before a task: `AGENTS.md` | 112 KB, about 28,000 tokens, every task |
| The other guides (`docs/*.md`), read as needed | 530 KB; `API.md` 120 KB, `SPEC.md` 111 KB, `MAPS.md` 107 KB |
| Tests | 755 passing, in 116 files; none checks that a checker fails on a broken input |
| Where a test runs in the game | only a browser build of Xash3D (`smak play`); never the Steam game |
| Before sharing a map or model | nothing checks that it carries none of the game's files |

## Phase 1: fewer tokens (first, because every later phase pays for it)

**1a. `AGENTS.md` becomes an index.** About 6 KB holds the loop, the rules that keep a model working, how to
report, and a table "task → the one guide to read". The recipes, the command line and the long sections move
into the guides they belong to (most of them are there already, twice). Measure: under 8,000 tokens read at
the start of a task, and a sample of five usual tasks (re-skin, item from a kit, map from a spec, walk test,
play a map) each needing one guide at most.

**1b. Answers in text first.** Every command that checks something ends with one line, `PASS`/`FAIL`, and the
reasons, and writes the detail to a file instead of the terminal. `check`, `maps check`, the judges and
`play` say which picture to look at when one is needed, and none when the text decides. Measure: a passing
run of each prints 5 lines or fewer.

**1c. Pictures cheap by default.** Contact sheets and pictures at the size that answers the question (the
judges' crops, a third of the screen for `play`), the full size only when asked for.

## Phase 2: fewer errors (checks that are known to fail when they should)

**2a. A broken case for every checker.** `test/broken/` holds inputs with exactly one defect each, and the
message each must give. To begin with:

- a model over the engine's limits (vertices, bones, textures over 100);
- a texture off its palette;
- a sequence with a missing event;
- a map with a leak, an entity the mod lacks, or a spawn in a wall;
- a figure in another game's style, for the judges.

A test fails when a checker passes any of them, or fails for another reason. The rule goes in `AGENTS.md`: a
new checker comes with its broken cases. This is the rule NEXT.md already keeps for map comparisons, made a
test. Measure: every command that says PASS/FAIL has at least one broken case.

**2b. Evidence in every report.** Each claim an agent hands over says how it is known:

| Label | Means |
| --- | --- |
| read | read in the code or the files |
| drawn | in the kit's pictures |
| checked | by a SMAK check |
| played | in the game, and which game: browser Xash or Steam |

Only "played" may say "works in the game". This goes in `AGENTS.md` ("Reporting to the person").

**2c. Stop after three.** After the same failure three times, the agent writes down what it knows and changes
approach, or asks. One line in `AGENTS.md`.

## Phase 3: easier tests (the real game, without the mouse)

**3a. `smak play --native` for the Steam game, by its console.** GoldSrc reads commands from its command line
and from a `.cfg`, and `-condebug` writes its console to a file. So a run needs no input at all:

1. write the steps that are console commands into a `.cfg`;
2. start `hl.exe -game <mod> -insecure -windowed -w 1024 -h 768 -condebug +map <map> +exec smak_run.cfg`;
3. wait for the lines the steps expect in the console file;
4. pass or fail as `smak play` does today, and close the game.

`-insecure` keeps it off VAC; it only ever starts a local game, never joins a server. The same steps file
should run in the browser and in Steam.

First targets:
- a map of ours for The Specialists, then Half-Life;
- `msc` is installed in the Steam folder too.

Found by hand, 2026-10-24 (TS, `h9_te_neuropolis`, build 8684, Steam running):
- the console file is `qconsole.log` in the Half-Life folder, not the mod's, and each run **adds** to it: a run
  reads only what follows its own start;
- `+exec` runs while the map is still loading (the player not in yet), so a step that needs the player waits
  first: 1,500 `wait` lines brought the player in (`status` showed them at 1616 1056 38, 14 s in). Frames, not
  seconds: the run should wait on a line in the log instead where it can;
- `screenshot` writes `HalfLife00.tga` (1024×768, 24-bit, bottom-up) in the mod's folder: a picture of the real
  game with no window capture, so 3b may not be needed;
- `quit` at the end closes it cleanly (18 s for the whole run);
- the log already tells faults: Neuropolis lacks `sound/callhascome.wav` and its sky `gfx/env/neurort.tga`;
- with Steam running it starts with no prompt; without Steam was not tried.

Measure: a map that passes `maps check` is played in TS from Steam by one command, and its log decides.

**Done 2026-10-24**: `smak play native --map h9_te_neuropolis --mod ts --expect-not "Couldn't load gfx/env"`
ran in 4.0 s and failed by the log, as it should: Neuropolis lacks its sky. Commands are not put in a `.cfg`
once: the start `.cfg` keeps a loop that reads a file every 5 frames, and each command is a file of its own that
runs once and answers (`SMAK_ACK n`) in 0.1 to 0.2 s, so a run is driven step by step like the browser's.
A map is in when `status` names the player. Test 108 holds the protocol against a fake engine. TS cannot be
entered by the console: after `slot7` (Random) its client lets the player in only on the key bound to `+attack`
(it prints "MOUSE1 is unbound" for the console's `+attack`), so a TS run is a spectator's; walking it needs 3c's
real input. A step's `bind` was found saved into the person's config.cfg: the driver now puts the file back.

**3b. Pictures of the native game** (only after 3a works). A picture of the game's window through Windows'
own capture (`Windows.Graphics.Capture`; ordinary capture comes out black for GPU games), with a PowerShell
helper called from Node.

**3c. Input to the native game, last and only if needed** (walking a route, a fight). Rules taken from
universal-modder:
- input only while the game's window is in front;
- not while the person is using the machine (check idle time; ask first);
- exact process ids, never killing by name.

Most of what a test needs is a console command (`setpos`, `give`, `impulse`, the mod's own), so this may
never be needed.

**3b and 3c done 2026-10-25**, in one helper (`src/play-window.mjs`): C# compiled by PowerShell, so nothing is
installed, reaching only the windows of the `hl.exe` the run started (by its id: the window is that process's,
not a launcher's). Measured on TS, `h9_te_neuropolis`:
- **3b.** PrintWindow with PW_RENDERFULLCONTENT draws the game's window as the person sees it, the same
  picture as the console's `screenshot` (Steam's overlay in both), in 36 ms (the first, with the helper
  compiled, 0.5 s). So `screenshot` stays the default and `--window-pictures` is there for what the console
  cannot take: a game that stopped answering, whose sentence now says what its windows show (a box's words).
- **3c.** `--input`: a real left click let the player past "Press Fire To Play!", which the console's
  `+attack` never did (3a), and W and D moved the free-look camera. The guard held: the first input waited for
  5 s of hands off, and the game's own cursor recentring does not count as the person's input. The first try
  did nothing, and the reason was not the kit: TS's `config.cfg` had been `unbindall` and three binds since
  before 3a, so W was bound to nothing (the person bound the keys again). Asked of the person before each live
  run, and their `config.cfg` came back byte for byte.
- TS wants a second click to put the player in (the person's, by hand): `tap` with `times: 2`.
- Not done: a run walked as the player from start to end, the mouse moved to look (`look` stays the
  browser's), a fight.

## Phase 4: before sharing

**`smak check --publish <folder> --game <game folder>`** fails on:
- a file byte for byte one of the game's;
- a texture of the game's `.wad` inside a map's own `.wad`;
- an absolute path of the user's;
- a key or token.

It warns on large archives and on a missing readme. Measure: it fails on a broken folder made for it (see 2a)
and passes a map we have released.

**Done 2026-10-24.** Four broken cases (a game's sound copied, a game's texture in one's own `.wad`, a path into
the home folder, a GitHub token) fail for their reason, and their twin passes. The released map did not pass,
and was right not to: `h9_te_neuropolis.bsp`, as handed to Havoc9, carries 11 of `valve/halflife.wad`'s
textures inside it (`C1A3FLOOR02`, `CRATE05`, ...), which TS players have already, being Half-Life's. Its
plugin's `ts_matchmode.cfg` names `D:\Downloads\TSM` in a comment (theirs): a warning. A map of one's own
installed in the game's folder is said `--ours`, or it is the game's file byte for byte.

## Phase 5: art from a generator (a recipe, not code)

`docs/IMPORT.md` gets a section on bringing generated art in:
- images for textures from a local ComfyUI (free, on the GPU);
- meshes as `.glb` from Blender's generator or any service.

From there SMAK's own import, fit and checks take over. Nothing of a paid service goes into the kit.

**Done 2026-10-25**: `docs/IMPORT.md`, "Art from a generator" (and its row in `AGENTS.md`). Every door it names
was already in the kit: a picture as a material's `picture`, a `.glb` through `smak import` and `smak item` with
`--triangles`, an `.obj` as a spec's `mesh`. It adds when to ask the person first (a cost, anything sent off the
machine), what a generator gets wrong (unseen sides, baked light, no UV layout, no scale), and ComfyUI's own API
for a script. No generator is on this machine, so it was tried on a stand-in: a 512 picture of grit and blotches,
too warm and lit from one corner, given to a `stone` material, came out a grey 128 texture that tiles with the
light divided out, and the report warned of too little grain (0.016, Valve's concrete 0.123), the line the recipe
says to read. Writing it found the guide's example wrong first (there is no `concrete` base). Not yet tried: a
real generator's picture or mesh.

## Phase 6: the Source engine (Garry's Mod), models first

Started 2026-10-25. What is out there was read first. There are converters that call the same outside programs:
- [G2SConverter](https://github.com/mrglaster/G2SConverter), 2022, with mdldec, VTFCmd and studiomdl, plus AI
  upscaling;
- the decompile-then-compile guides (Valve's wiki, the Steam guides);
- for maps, [goldsrctosource](https://github.com/GameChaos/goldsrctosource), unfinished.

Nothing writes Source models without Valve's compiler, and every source found only reads them. SMAK's way: it
reads the GoldSrc model itself and writes the compiler's input. The compiler is GMod's own studiomdl, an
outside program the person has with the game, the way the map compilers are VHLT.

Measured by hand first (2026-10-25):
- GMod's `bin/win64/studiomdl.exe` compiles a QC from the command line. With `-game` pointed at a folder that
  holds a `gameinfo.txt`, it writes `models/` there and nothing into GMod.
- It writes MDL 48, VVD 4 and VTX 7.
- A missing file is an `ERROR:` line and a nonzero exit.
- The same `bin/` has vtex, vbsp, vvis, vrad, hlmv and hammer.

**6a. A GoldSrc model ported to GMod.**
- Bones, rest pose and every animation go out as SMD, each frame's six values as the GoldSrc file holds them.
- Each bodypart and submodel becomes a `$bodygroup` (an empty submodel `blank`), skin families a
  `$texturegroup`.
- Attachments and hit boxes are carried over.
- An animation's travel taken out of its frames (LX LY) is put back and taken out again by Source's own
  `LX LY`. Activities and events keep their numbers.
- Each texture becomes a VTF, written by the kit (power of two, mipmapped; the masked colour as one-bit alpha),
  and a VMT: VertexLitGeneric, alpha-tested, additive or unlit by the GoldSrc texture's flags.
- A model with one bone gets a box to collide with, so it can be a physics prop.
- The result is an addon folder (`models/`, `materials/`) beside the sources, compiled in a folder of its own.
- What Source has no place for is warned of, one line each: bone controllers (a pose parameter in Source),
  a second blend, chrome.
- Measure: Half-Life's own models (a scientist, a monster with animations in another file, a weapon's v_ and
  w_, a prop) compile with no error, and the compiled file holds the bones, animations, materials and
  bodygroups the original had.

**6a done 2026-10-25**: `smak gmod-port`, `source.portToGmod`, `docs/SOURCE.md`. All 210 of Half-Life's models
compile and hold every bone, animation, material, bodygroup, skin, attachment and hit box. They also hold
every corner, within 0.05 units and on the same place of its picture.

What the 210 found:
- `$origin 0 0 0 -90`: Source's compiler turns what it reads by 90 degrees, as GoldSrc's did. Measured on a
  test triangle.
- The corners written the other way round: GoldSrc's files keep them clockwise against their normals.
- After the compile they wind as Valve's own do. Kleiner, the oil drum and the crate in GMod's packs:
  6498 of 6520, 252 of 252, 200 of 200.
- Source refuses, where GoldSrc took:
  - bones with no name (31 models);
  - two animations of one name (houndeye's `run`, the scientist's `crouch_idle3`);
  - fps 0 (shotgunshell);
  - activity weight 0 (hgrunt).
- Source merges two bones of one name in any case. Chumtoad's `Bone10`, and its unnamed bone 10 named
  `bone10`, lost a bone.
- Source drops triangles of no area (128 of osprey_tailgibs' 230).
- The garg's toes, a quarter turn about y, come out 0.01 units off. Hence the 0.05 tolerance.
- `ACTIVITY` had 47 wrong. The table was filled from `activity.h`'s order and held to the 301 files'
  sequence names.

**Seen in GMod by the person, 2026-10-25 (6c by hand).** Two Sonnet workers made the models with
`AGENTS.md`'s brief, and the orchestrator looked at their pictures and put the addons in `garrysmod/addons/`:
- **The barrel, made from scratch:** built from a spec, then `--collision box`. It spawns as a physics prop
  with collisions and looks right, "not far off a low-poly Source prop".
  - It is heavy: `$automass` of a box at the `default` surfaceprop.
  - The worker found that a model with no hit boxes failed the check, because Source's compiler makes one
    itself. Fixed: only fewer hit boxes is a fault.
- **The grunt, ported:** it spawns and is drawn right.
  - With `gm_spawneffect` it stands still in one pose, with no collisions and no AI.
  - What it needs is a ragdoll, and an entity that plays its animations or an NPC that asks for them by activity.

Next, in order:
1. ragdolls for ported figures (6e's `$collisionjoints`, from the hit boxes);
2. a surfaceprop and mass (the spec's material when the kit built it);
3. a hull to collide with in place of the box;
4. then 6d.

**1 to 3 done 2026-10-25:**
- `--collision hull` (the kit's own convex hull) and `ragdoll` (a box a bone from its hit boxes, joints ±40°).
- `--surfaceprop`, from a built model's record.
- `--mass`, or the hull's volume at GMod's own density. GMod's studiomdl weighs everything as `default`,
  measured: 671 kg as wood and as metal.
- The grunt: 22 pieces, 21 joints, 90 kg. The barrel: one hull that follows its bulge; 235 kg as solid wood,
  given 40 for GMod.

Seen in GMod (0.29.0): the barrel rolls as wood, the grunt falls as a body.

**After 0.29.0:** the ragdoll's pieces fitted to the body, and its joints measured on its animations.
- Each piece is the hull of its bone's corners, the sides between pieces shared out among them. The grunt:
  22 pieces that follow its body, where its hit boxes would weigh 855 kg as flesh.
- Each joint's limits are how far the animations turn it, an axis it never turns about held. The grunt's knees
  and elbows are hinges about z. Valve's convention measured on a citizen: +z bends its knee, as its `.phy` says.
- A ragdoll weighs 90 kg, as Valve's do.

Next: seen in GMod, then 6d. After Source, s&box (Source 2). Its models are of a finer make by default, but a
low-poly look is a choice it allows: the kit's models for it are not to be pushed finer than asked.

**6b. Source models read and drawn.** Begun with 6a, to check it:
- `readSourceMdl`, `readVvd`, `readVtx`, `sourceTriangles`;
- VTF read (DXT1, DXT3, DXT5);
- VMT read, and `openVpk`;
- `render` taking another kind of model's triangles;
- `smak source-info`, `source-render`, `source-sheet`.

A port drawn from its compiled files matches the original's picture, but for chrome. Kleiner draws from
Half-Life 2's packs. Left: animations (the .ani and the animation data), and the judges calibrated on Half-Life
2's models.
- MDL, VVD and VTX read, VTF read, and GMod's VPKs read for its own models.
- The port is drawn beside its original and they match.
- The loop holds for Source as it does for GoldSrc: look, change, check, draw.

**6c. Seen in GMod.** The model spawned in the game by its console, with a picture of it, as `play native`
does for Half-Life.

**6d. New models made for Source.** Its limits are not GoldSrc's:
- more triangles and bones a submodel;
- larger textures, with normal maps and the other material parameters;
- a collision model, and a ragdoll for a figure;
- pose parameters and blends.

`check` gets a `source` profile, and the spec builder writes SMD and QC for a Source target. Its judges are
calibrated on Half-Life 2's own models, read from GMod's VPKs.

**6d begun 2026-10-25:** a spec's `engine: "source"` (or `--engine source`).
- Held to Half-Life 2's props and people (`scripts/source-budgets.mjs`, 2170 props and 88 characters from GMod's
  packs): two to six times Half-Life's triangles. Painted on 512 (1024 a character), kept in full colour.
- `check`'s `source` profile; the build ported by `builtToGmod`, compiled, held to itself, drawn, with a hull.
- A spec's `budget` and `texture` still bind: a low-poly look stays the spec's choice.
- Left: weapons, normal maps, more than one bone a vertex, pose parameters; and seen in GMod.

**From stevenlafl's port of The Specialists to GMod (2026-10-25)**, their findings brought into the port, each
measured on Half-Life's models:
- travel as GoldSrc's (`$motionrollback 0`, one-shots in place), held by the check: walk1 112.19, run 172.27;
- blends on pose parameters (`blend_xr`), held by the check;
- view models: no fades, activities by their names, a `muzzle`, no physics; only the `.dx90.vtx`;
- the sounds events play, copied under `sound/smak/`;
- players and held `p_` models as Valve's biped: names, hands turned (180 degrees, by the thumb), GMod's hand
  attachments, a player lifted onto its feet, `--upper` copies. All ten of Half-Life's players compile.

Left from their work, bigger, after these: maps (GoldSrc BSP 30 rewritten as Source's BSP 20), probes in the
game (Lua over rcon on a dedicated GMod server: PASS or FAIL from inside), the TS profile's entity keys. And of
our own: a port's skeleton rebuilt as Valve's, so that GMod's own player animations (`m_anm.mdl`) play on it.

**6f. Maps: a GoldSrc BSP 30 rewritten as Source's BSP 20** (planned 2026-10-25). Ported from stevenlafl's
converter (`tools/convert-map.mjs`, `tools/map/`, `docs/bsp-goldsrc-to-source.md` in their TS port), read in
full first. Every SMAK reader it calls (`readBsp`, `faceLightmap`, `visibleFrom`, `leafAt`, `texturesFor`,
`skyOf`, `readSpr`...) is already ours. No decompile, no Valve compiler: the compiled geometry, baked light and
visibility are kept, lump by lump. Each step keeps their rule and the reason they found for it:
1. **The writer** (`source/bsp.mjs`): the header and lump versions, a packer, ColorRGBExp32, visibility rows
   (Quake's run-length), a stored zip for the PAKFILE. Tested by reading back what it writes.
2. **The world:**
   - planes, with the turned-round plane for a face on the back of its node's plane;
   - texinfo scaled to the power-of-two picture, and luxels at 16;
   - faces, edges, vertex normals by face;
   - light re-curved, `2 (sample/255)^2.2`;
   - clusters as the open leaves numbered with no gaps;
   - each leaf its own run of faces, in leaf order;
   - node areas, models, one ambient sample a leaf at a third of its faces' light.
3. **Textures:** VTF and VMT by the texture's kind (masked, liquid unlit and drifting, sky's six sides
   clamped). A wad's textures are shared files in the addon; a map's own go in its PAKFILE. Unlit copies for
   brush entities in render modes 1, 2, 3 and 5.
4. **Collision brushes:** one a solid or liquid leaf of hull 0, with bevels. Clip brushes come from hulls 1
   and 3, shrunk back by the player's box and carved into the tree. A brush entity's `skin` under 0 sets its
   contents; `func_ladder` becomes ladder and player clip.
5. **Entities:**
   - player starts lowered 36;
   - `renderamt` 0 where GoldSrc left it out;
   - `rendercolor` only where GoldSrc tints;
   - movers' `angles` as `movedir` (`pushdir`);
   - `func_ladder` as a `func_brush`, drawn nothing;
   - sprites as `env_sprite` on a Sprite material, every frame kept;
   - a `cycler_sprite`'s model ported by `portToGmod` as a `prop_dynamic`, not solid;
   - lights as WORLDLIGHTS, for models.
6. **PHYSCOLLIDE**, with GMod's own physics, as vbsp does and as Steven does. A small C++ helper calls
   `bin/win64/vphysics.dll`'s `ConvexFromPlanes` and `CollideWrite`. It is built with Visual Studio, whose
   vtables match Valve's build of the DLL, then laid out as `ivp.cpp` does. GMod's DLL is the person's, like
   its studiomdl. Without it, the map is written without the lump, with a warning: traces and props then fall
   through. Ideally, later, SMAK writes the format itself.
7. **In the game:**
   - `rcon` over Source's protocol;
   - `shoot`: GMod with `-usercon` as a listen server, the camera set by Lua, a screenshot. Allowed by the
     person, 2026-10-25;
   - probes and `check-collision` on a dedicated GMod server from SteamCMD (also allowed). A spot's hull 1 in
     GoldSrc is held against a player-sized trace in Source;
   - a twin map, the same brushes compiled by SDHLT and converted, and compiled by GMod's own vbsp, vvis and
     vrad, to read side by side.

Measure: Half-Life's deathmatch maps and a few of the campaign's load in GMod with nothing in the console.
Their screenshots match SMAK's render of the GoldSrc map from the same spot. `check-collision` agrees on the
spots of every map.

**Steps 1 to 6 done 2026-10-25** (`smak gmod-map`, `src/source/map.mjs`, `bsp.mjs`, `mapbrushes.mjs`, `vcollide.*`):
- All 115 of Half-Life's maps port with physics, in 1 to 6 s each.
- Stalkyard was loaded in GMod: no console errors, drawn and lit right, walked on; traces hit the world and a
  crate lands.
- Found on the way, beyond Steven's converter:
  - GMod's 64-bit vphysics on Windows hangs on drag areas and crashes on an outer hull;
  - a convex's own number as its game data killed vphysics past 126 pieces. (That the game reads it as the
    surfaceprop's index was wrong; corrected in 0.30.1 from stevenlafl's finding: each world triangle's
    material, and a materialtable);
  - `$surfaceprop` comes from `materials.txt`;
  - a VTF needs its thumbnail: the engine colours a bullet's chips from it. Without one, stalkyard's concrete
    threw yellow "antlion blood" (seen by the person, measured in game: the bullets' traces were concrete).
- Left of step 7: `rcon` and the probes in SMAK itself. Rcon answers on the LAN address. Several commands in a
  row trip GMod's guard, so the Lua goes in a file run by `lua_openscript`.

**Step 7's first half done 2026-10-25:** `gmod-rcon`, `gmod-probe` (the built-in `map` probe), `gmod-shoot`
(`src/source/game.mjs`). On stalkyard, in the person's game with `-usercon`: the map probe passed 7 of 7,
a probe's error and a probe that never ends both FAIL, and a screenshot came clean. Found: a second RCON session
straight after the first is dropped without a word; the client's Lua may not run `jpeg`; GMod blocks
`fov_desired` from the server. Left: `check-collision` on a SteamCMD dedicated server, and the twin map.

**check-collision done 2026-10-25:** `gmod-server` (SteamCMD's app 4020, in `C:/Herramientas/gmod-ds` here) and
`gmod-collision`. Seven of eight maps PASS standing and ducked (`docs/SOURCE.md`). Found: spots on whole units
sat on planes; GoldSrc's hull 1 is looser than its geometry at slanted beams; brushes now carry vbsp's edge
bevels too (no change measured). Left: datacore's clip brushes, rebuilt 8 to 16 units too big at 43 spots.
Then fixed the same day (`docs/SOURCE.md`, "Clip brushes"): each side of a hull's region sampled in a grid, and a
rebuilt clip brush that does not lie inside both players' hulls when grown is left out. All eight maps PASS,
datacore at 0.16 and 0.34 in a hundred. Found with an offline twin of Source's box test (each brush's planes
against the box's reach), which agreed with the server within a few spots and took seconds a map.

Their converter does not do, and nor will this at first: outputs (GoldSrc's targets as Source's I/O), water
surfaces, animated textures, decals.

**6e. What a port leaves behind.** Ragdolls (`$collisionjoints`), blended animations as pose parameters, bone
controllers as pose parameters, NPC activities as Source names them, eyes and flexes.

## Phase 7: s&box (Source 2), models first

Started 2026-10-26, once GMod had a decent base. s&box was released 2026-04-28 and changes weekly (its managed
engine and editor are open, Facepunch/sbox-public, often 100 commits a week): every fact here was measured on
the engine of that day (26.10.13c) and may need measuring again. A low-definition style stays a valid choice
there: a port is not pushed toward high-poly.

**7a. Models: done 2026-10-26** (`smak sbox-port`, `docs/SBOX.md`). s&box reads no SMD, so the port writes DMX
from Source's port's parts (`portToSource` hands them as data), a `.vmdl`, PNG and `.vmat`, and compiles with s&box's
own resourcecompiler. Found by playing barney in the editor and reading his bones back (`sbox-cli`'s
`run_csharp`): no turn (`forwardParity 1`), bones named with underscores, no bone culled, no hyphen in a mesh's
node. Barney, houndeye (3 skins), can (6), w_crowbar, v_9mmhandgun, hgrunt, scientist and Counter-Strike's
masked bigtree compile and read back whole; all 210 of Half-Life's models compile.

**7b. sbox-check: done 2026-10-26.** The compiled model read back and posed in the editor through `sbox-cli`,
every bone of each animation's sampled frames held to GoldSrc's `poseAt` within 0.1 units and 0.0005 of its chain
(measured: 0.025 at most on barney, houndeye, scientist, hgrunt; 0.19 at the end of tentacle2's tentacle). The
editor open on the project is used, else one is opened and closed. All 210 of Half-Life's models pass in 8 minutes.

**7c. Next, in order.** Collision: done (a hull, a ragdoll as s&box's physics
shapes and joints, held in its physics by sbox-check, `docs/SBOX.md`); blends as an animation graph: done (a
selector on `sequence`, a blend node on `blend_xr` and the like, held to GoldSrc's slerped blends by sbox-check);
sounds as `.sound` assets: done (a model's event sounds,
heard as GoldSrc heard them, their loops in a `.meta`; read back, played and heard by sbox-check); a whole map, as the
test (the person's choice, before the kit's own models): started 2026-10-27 with stalkyard, as a scene the kit writes
(the person chose it over a `.vmap` and over a runtime mount like s&box's Quake one): `sbox-map`, its faces as
MeshComponents, its clip, textures, sky, starts and lights; `sbox-map-check`, collision at 5000 spots, floors, light
pictured beside GoldSrc's. Next its doors and buttons, items, sounds; then crossfire; then the kit's own models built
for s&box.

**7d. What the first map taught (2026-10-27), for SMAK as a whole.** Two faults had shipped since 0.31.0 with every
check passing, found only when the map's light was pictured; the rest is cost:
- *Error detection.* (1) A material can fail to compile with nothing said: a holed texture whose sides are not powers
  of two (s&box makes no mipmaps of its mask), and `sbox-check` never asked; the model port should make them powers
  of two as the map port does, and the check should ask the editor which materials compiled (`compileFailures`), not
  trust `Material.IsError`. (2) Nothing checked how a port looks: a fullbright texture drew red from 0.31.0 to 0.34.0.
  The map check's way (a picture in s&box beside the kit's own GoldSrc renderer, region by region) should hold every
  model too. (3) The same picture held to `drawMap` would check the GMod map port's light.
- *Fidelity.* The two light numbers (SUN_SCALE, SKY_LIGHT_SHARE) are fitted on stalkyard alone: crossfire and datacore
  next. GoldSrc's own lightmaps are possible (the world as a model with a second coordinate and a shader of the
  kit's, as s&box's Quake mount draws Quake's), the meshes kept for collision and editing. stalkyard's 7 spots
  blocked only in s&box with no reason found (0.20 in a hundred to GMod's 0.10).
- *Speed.* Every `run_csharp` compiles (1 to 2 s) and every `sbox-cli` call starts a process: batch them (the light
  check takes its 21 pictures in one `call_tools`; the model check's 210 still call per model, 90 minutes). Change a
  value live in the open editor rather than port again (the light's calibration did); a general sweep tool. One
  editor kept open across checks.
- *Tokens.* Inline scripts with backslashes and quotes broke three times in one session: a `smak sbox-cs <file.cs>`
  that runs a C# file in the editor. The editor's console filtered to its errors, its known noise left out.
- *Playing a port.* `sbox-map --player`: the editor's Player Controller and a camera at the first start, facing its
  way. Objects made by code do not mark a scene changed, so Play loads the file on disk (a black screen): such a
  helper saves, and removes its own earlier objects first.

Done (2026-10-27): (1) and (2), unreleased. The model port makes holed textures powers of two; its compile names
every material and fails, saying which, when one is not compiled (that found two more: another skin's materials
never compiled, Half-Life's can, chumtoad, hgrunt, houndeye, icky, scientist and bullsquid, and a deep project
folder running the textures' paths past 260 characters). `sbox-check` asks the editor which materials compiled and
pictures the model beside the kit's renderer; its limits measured on Half-Life's 205 models, all passing. Left: (3);
a hue-aware colour check would catch an orange material drawn red, which the regions' distance misses.

## Which model does the work (measured 2026-10-25)

Three of 1a's usual tasks, each given to Haiku, Sonnet and Opus as subagents with the same prompt and only
`AGENTS.md` to start from: Barney's shirt made dark olive (re-skin), a flanged mace in Master Sword's
one-handed blunt family (item from a kit), and a corridor, hall, raised gallery by stairs and storeroom behind
a door, compiled with SDHLT (map from a spec). Every run passed its checks; the pictures were judged by Opus.

| Task | Model | Tokens | Tools | Time | Runs | The pictures |
| --- | --- | --- | --- | --- | --- | --- |
| re-skin | Haiku | 90,700 | 24 | 106 s | 1 | right; green lighter than asked. Alone with Opus in naming the `barney01`-`03` files a renamed model needs |
| re-skin | Sonnet | 66,900 | 15 | 70 s | 1 | right; passed the same warning without a word |
| re-skin | Opus | 84,000 | 24 | 171 s | 3 | right; recoloured the palette, so the textures' unused margins cannot bleed blue at seams |
| item | Haiku | 93,300 | 23 | 113 s | 2 | **wrong**: a ball with six spikes, not flanges, and it described the spikes without seeing it |
| item | Sonnet | 60,000 | 13 | 61 s | 1 | right, the best of the three |
| item | Opus | 66,500 | 19 | 116 s | 1 | right; head broader than the game's, said so |
| map | Haiku | 101,400 | 27 | 118 s | 2 | right, and the closest to the brief (concrete floors, pale walls) |
| map | Sonnet | 70,300 | 18 | 84 s | 3 | layout right; materials off the brief (busy lab panels), said so |
| map | Opus | 79,500 | 16 | 112 s | 3 | right; two floors tile where metal was asked, said so |

What it says:
- **Haiku is not cheaper here.** It took the most tokens on every task (about 1.4 times Sonnet's), in more
  rounds of small helper scripts. The checks kept every run sound; Haiku's one miss is the kind only a
  picture shows, and it looked at the picture and did not see it.
- **Sonnet is the cheapest and fastest**, and was right on shape; it was the least careful with what the
  person asked of the look, and with a warning it should have passed on.
- **Opus found the most about the kit itself** (below), and the subtlest risk (the margins).
- So: Sonnet for work a check and one look decide; Opus to judge the pictures, to talk to the person, and for
  anything that touches their machine (3c). Haiku is not given SMAK's work.

What the runs found wrong with the kit (all fixed the same day; CHANGELOG "Unreleased"):
- 4 of 9 runs first imported the kit by a bare `C:/` path; Node on Windows needs a `file://` URL, and no
  guide says so.
- All 3 map runs first set `VHLT_DIR` to SDHLT's folder; the programs are in `tools/Win64`. The build should
  look there itself.
- `smak item` ends with no `PASS`/`FAIL` line (1b missed it).
- A room's own floor texture is reported as `fact [object Object]: ...`.
- No Half-Life `.fgd` is found on a machine without one; one map run took Master Sword's and got a false fault.
- The sequence-group warning on a model with `01`-`03` files does not say that a renamed model needs them
  renamed too.

## Order and size

| Phase | For | Size |
| --- | --- | --- |
| 1a, 1b, 1c | tokens | small to medium: mostly moving text, then a pass over the commands' output |
| 2a, 2b, 2c | errors | medium: the broken cases are the work; the rules are lines |
| 3a | testing | medium: one new mode of `play`; the open questions first, by hand |
| 4 | errors | small |
| 3b, 3c, 5 | testing | after the rest, if still wanted |

1 and 2a can go to separate agents at the same time (one moves text, the other writes test inputs). 3a needs
the person once, to say the Steam game may be started.

Each phase ends with its measure taken and written here.
