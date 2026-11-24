# SMAK 1.5: what the Hive remaster taught the kit

Source: the Hive City remaster for H9 (2026-11-18 to 2026-11-24), in a work folder of its own (not shared).
In that project 22 agents each changed one zone of a shipped map, the result was compiled for PrimeXT, and every
round was checked in the game. Every item below comes from something that went wrong or cost a round there.

Base: branch `v142-kitfix` (main 1.4.1 + 3 unpublished fixes). Budget: 62 660 of 62 800 lines, ratchet 62 660.
So the kit can barely grow. New features go into a pack, which has its own budget, and checks pay for themselves
by trimming code elsewhere. Each change below says where it goes.

## 0. Publish what is already done (1.4.2)

`v142-kitfix` has 3 commits:
- `smak check` on a .bsp/.map runs map-check (it crashed on BSP2);
- `materials search --sheet` with 0 results;
- the `materials primext` command.

Merge them, tag 1.4.2, and publish when the owner says.

## 1. A map that will not load: catch it before the game (check, ~60 lines)

These happened in the game:
- **r11:** a `ts_model` named a .mdl that was not installed. The server rejected the map, and the client looped
  "map did not load" with CL_GetLocalPlayer spam.
- **Install:** 4 maps were copied out of git as Git LFS pointers (132-byte text files). The game named them as
  maps but could not read them.

What to build:
- `map-check --game <mod folder>` lists every model, sprite, sound and wad that the entities and worldspawn name
  and that neither the game folder nor the files given alongside contain. A missing model is a FAIL, because the
  server rejects the map; a missing sound or sprite is a WARN.
- Any reader (bsp, mdl, wad) given a file that starts with `version https://git-lfs` says "a Git LFS pointer, not
  the file: run git lfs pull" instead of a format error. This goes in core's file open, about 5 lines.
- Broken cases: a map naming a missing model; a 132-byte LFS pointer.

## 2. Compile: texture data and the vis time (make, about 0 net lines)

- **MAX_MAP_MIPTEX.** With 9 zones the textures passed 32 MB and hlcsg stopped. `compileMap` should add
  `-texdata` sized to the embedded textures when it is needed, to all four tools, and say so. Today the caller
  has to know.
- **The vis estimate.** VIS_MEASURED extrapolates with the square of the portal count from one map, and it
  guessed 23 476 s for the hive. The measured times grow almost linearly:

  | Map | Portals | hlvis | Threads |
  | --- | --- | --- | --- |
  | One map | 5 088 | 219 s | |
  | Plaza | 2 971 | 48 s | |
  | Hive | 52 679 | 2 087 s | 8 |

  Fitted exponent: about 0.96. Fix: fit to the three measured maps, scale by threads, and say the range ("about
  30–60 min"). A wrong 6.5 h made us plan an overnight compile that took 50 min.

## 3. `smak play native` start-up (cli, ~25 lines)

- The driver starts its console loop with `+exec smak_run.cfg` on the command line.
- In H9 as shipped, `ts/autoexec.cfg` has `wait 2` and `exec userconfig.cfg`. These push the engine's
  `stuffcmds` past its single call, so a `+exec` never runs (the cause was found 2026-11-22 and is fixed in
  HAVOC-NINE's review branch).
- The kit then just waits 90 s and says the game did not start.

What to build:
- When SMAK_UP does not come, look for `wait` in the mod's autoexec.cfg / userconfig.cfg and say so.
- On an FWGS engine, start the loop from `<mod>/userconfig.d/smak.cfg`, which runs after config.cfg whatever the
  waits do, and remove that file afterwards.
- Broken case: an autoexec with `wait`.

## 4. PrimeXT materials: wrong sources and magnified grain (pack materials, ~40 lines)

These happened in the game:
- **c27:** the wall's gloss map was taken from another material, a diamond tread plate, and read as wavy
  reflections.
- **c27:** the wall's normal map kept a stucco grain that, at texture scale 2 on a big wall, read as blobs.

What to build:
- `materials primext` takes the normal and gloss maps from the same set as the colour and says which set each came
  from. A gloss whose pattern does not correlate with the colour's (a high-pass correlation under a threshold) is a
  WARN.
- An option `--relief fine|full`. `fine` removes the low frequencies of the normal map, the way the c27 fix did.
  It also warns when the world scale at which a texture is used (given or measured from the map) magnifies the
  normal map's grain past about 8 px per world unit.

## 5. The kit's picture against the game (make/render or map-look, ~30 lines)

The game read 1.2–1.8 times brighter than the kit's render. The kit's render also hid a teal sky light that the
game showed (c24), and it draws no normal, gloss or lit models. Over the remaster, 28 cameras have a kit render
and a game shot of the same view. Use them:
- fit an exposure and a gamma that map the kit's lightmap view to the game's (PrimeXT and the engine renderer
  separately);
- add `--as-game` to the render and map-look;
- write the numbers into MAPS-LOOKING.md. Today the rule "aim at 0.4–0.5 of the target" lives only in
  hive-remaster/ZONES.md.

Also show the sky light's colour (light_environment) in the summary line when its saturation is high: "the sky
light is teal (1 35 52): open rooms will lean teal in the game".

## 6. A pack for remastering a shipped map by zones (packs/remaster, own budget ~600)

The method worked: 22 zones by parallel agents, merged in one build, with no overlaps and no stray change.
`build-hive.mjs` (130 lines) and ZONES.md become:
- `packs/remaster`: `zone.mjs` (the contract: BOX, WADS, apply returning brushes/entities), `build` (boxes
  overlap → FAIL; a face changed outside its box → FAIL; brushes or entities outside → FAIL; the shared wad
  `--wad`), `pick` (ray-cast from a camera, listing the faces it sees and whether their centres are inside the
  box: the c16 lesson), and target cameras (a second camera at the target's yaw).
- `docs/MAPS-REMASTER.md`, under 300 lines: the contract and the lessons, which are the centre-in-box rule, signs
  drawn by their own texture, dark backing panels, not adding what the target lacks, never relettering a sign,
  models living in the zone's out/, renaming a map means renaming its per-map configs, and the light rule from
  item 5.
- An example with two zones on a small shipped-like map, in the self-test.

## Order, tests, release

| Release | Contents |
| --- | --- |
| 1.4.2 | Item 0 |
| 1.5.0 | Items 1, 2, 3 (checks and start-up: they save rounds), then 4, then 5 (needs the 28 pairs, measured), then 6 |

- Each item comes with its tests. Checkers come with broken cases in test/broken.
- The self-test must pass and the budget must hold (items 1–5 trim elsewhere; 6 is in a pack).
- Each item is checked against the Hive's own files, the real cases that went wrong.
- Nothing is published without the owner's word.

## What was done (1.5.0, 2026-11-24)

All six, each tested on the Hive's own files. Where the plan was wrong, what was found instead:

- **1.** As planned. The files the entities name were already looked for, but only with a profile or an FGD; now
  with `--game` alone. A missing sprite is an error too (the engine stops on it as on a model).
- **2.** As planned: `visGuess` fits a power of about 1.06; the Hive guessed at 38 minutes (19 to 77), took 35.
- **3.** More than planned. On Xash3D FWGS the driver did not start at all: `-h` is that engine's help, and without
  `-console` it writes no log. Now: `-width -height -console -log`, `engine.log`, the loop from `userconfig.d`
  (verified past H9's `wait 2`), `screenshot <name>.png`, and `--exe`. Measured in the H9 test copy.
- **4.** The c27 gloss was not from another material: it was its own set's, too smooth (roughness 0.34 on a wall).
  The correlation measure did not tell the bad set from 30 good ones, so it is not shipped; a warning of smooth
  glosses is. The fix judged in the game flattened the grain under a slope of 0.22 (`--flatten`), not a frequency
  filter: `--flatten 0.22` gives that map within 1 of 255.
- **5.** The 28 pairs measured anew with the map's textures: the kit at 1.55 is x1.26 darker than PrimeXT and x1.38
  than the engine's renderer; a single factor fits as well as a gamma. `--as-game primext|engine` (1.89, 2.23).
- **6.** `packs/remaster`, 224 lines: the Hive's 22 zones rebuilt by it give its .map and .wad byte for byte.
