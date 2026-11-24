# A shipped map remastered by zones

How to give a map the game already ships a new look, place by place, without touching its layout: the same brushes,
the same entities (so its doors, spawns, scripts and plugins still work), new textures, light and dressing. It is the
way the Hive City remaster was made (2026-11-18 to 11-24): 22 places changed by parallel agents, merged in one build,
no place touching another's faces, tested round by round in the game. The code is the pack `packs/remaster`.

Read first `docs/MAPS-LOOKING.md` (a view against its reference, and "The kit's picture and the game's") and, for the
textures, `docs/MATERIALS.md`.

## The method

1. **The shipped map as source.** Decompile it once (`docs/MAPS.md`, "decompiling") and keep the `.map` untouched:
   every build starts from it. Its own `.wad` files stay as they are.
2. **A target for each place.** An in-game shot of the place, and the picture it should become (a repaint, a photo,
   a concept). Each place is a **zone**.
3. **A zone is a box and a script** that only its owner writes (`zones/<id>/zone.mjs`):
   ```js
   export const ID = "c04";
   export const BOX = { min: [x, y, z], max: [x, y, z] };   // the only volume it changes
   export const WADS = ["out/hr_c04.wad"];                    // its own textures (paths from its folder)
   export async function apply(map, { src, prof, K }) {
     // retexture or realign faces whose CENTRE is in BOX; never move, add or remove a brush of the shipped map
     return { brushes, entities };  // entities: lights, models, a func_detail holding the brushes it made;
   }                                // brushes: those brushes again, to be checked. Never push into map.entities.
   ```
   `src` and `prof` are the kit's `maps` (box, prism, cylinder, shapeOf, textureAxes, fitted ...), `K` a scale for
   light levels the build is given (`--k`).
4. **Build all the zones in one map**, checked:
   ```
   node packs/remaster/bin.mjs build shipped.map --zone zones/c01 --zone zones/c04 ... -o out/name.map [--wad hr_name]
   ```
   It FAILS when two boxes overlap, when a zone changed a face (or moved a brush) whose centre is outside its box, when
   a brush or an entity it adds is outside its box, and when a zone pushed entities into the map itself. `--wad` puts
   every zone's textures in one `.wad` beside the map (installed in the mod's folder) instead of inside the `.bsp`: the
   Hive's 216 textures in 37 MB, and a .bsp of 62 MB instead of 84. Two zones may not ship two pictures under one name.
   `wads.txt` lists the zones' `.wad` files for the compile, with the shipped map's own (carried in with `wadinclude`).
5. **Compile** (`smak map-compile`, or `compileMap`): the shipped map's `.wad` files carried in, the zones' shared
   `.wad` named. `-texdata` is given by itself when the carried textures pass 32 MB. A full hlvis of a large map is
   long: the Hive's 52 679 portals took 35 minutes on 8 threads (the compile says its guess before hlvis starts).
6. **Look at each place in the kit** (`map-view --as-game`, `map-look --ref target.png`), then **in the game** from
   the same eye. Repeat for the zones that are not there yet: a round rebuilds every zone from the shipped map.

Several agents can work at once: each builds only its zone (`--zone zones/<id>`, few threads, `fastVis`) and looks
at it; the lead merges. A zone's folder is its own: models, textures, materials and renders live there.

## Which faces a zone owns: their centres

A face is a zone's when its **centre** is in the box. A big shipped brush can have its centre outside a box that
covers everything the eye sees: the Hive's courtyard floor was one brush 800 units across whose top face had its
centre at x 1008, outside a box that ended at 1000, so a whole round kept the old floor in front of the camera.
Before building, ray-cast from the zone's camera:

```
node packs/remaster/bin.mjs pick shipped.map --zone zones/c16 --eye 804,2576,-2504 --yaw 202.5 [--pitch 0] [--fov 96.5]
```

It lists every face seen whose centre is outside the box, with its texture, its brush and where it was seen, and
ends `PASS` when there is none. Widen the box to take those centres (without meeting another zone's), or leave them
if they are far and the target does not care (sky, distant walls).

## Cameras

The game's camera and the kit's view must frame the same: the same eye, yaw, pitch and field of view (the Hive's
`smak_cam` plugin put the player's eye exactly at the kit's). An old shot taken at a lagged angle frames otherwise:
when the target frames differently from the camera, add a second camera at the target's yaw, and judge each zone
from both. The kit's view at 1280x720 matches the game at fov 96.5.

## Light

- The kit's view is darker than the game: x1.26 with PrimeXT and x1.38 with the engine's renderer at the default
  brightness. Draw with `--as-game primext|engine` and aim at the target's own brightness (MAPS-LOOKING.md). At
  `brightness 1` the old rule was "half the target".
- Few strong coloured sources the target shows (signs, lamps), no flat fill. A sign glows by its own texture (a
  texture light, or an additive func_illusionary), never by a light of its colour aimed at its wall: that drowns it.
- A coloured sky light (`light_environment`) tints every open place in the game more than in the kit's view; the
  views say so. Counter it with warm local light where the target is not that colour.
- PrimeXT's normal and gloss maps are not drawn by the kit: a smooth gloss reads as polished metal or wet in the game.
  `materials primext` warns of glosses under roughness 0.45; a fine grain in a normal map that a large texture scale
  magnifies reads as blobs: `--flatten name=0.22` (MATERIALS.md).

## What the game taught the Hive (read before choosing a box)

- **Every model a zone places must be in the zone's own folder**, and installed. A model the game cannot find makes
  the server reject the whole map: `smak map-check --game <mod> --game valve` fails on it before the game does.
- **Signs**: redraw the shipped map's own signs and logos crisply at a larger size; never reletter them with new
  words. Upscaled old pictures look pixelated in the game. A sign's backing panel is dark and unlit, or the sign
  reads as a pale box.
- **Do not add what the target does not show** (sconces, props). The target is the brief, not a mood.
- **No floor reflections** unless the person asks: the floors read as too wet.
- **A renamed map renames its per-map files** too: spawns, plugin configs and databases keyed by the map's name, map
  configs, bot waypoints, and any plugin that checks the name. Without them the map loads and players stick at spawn.
- **A file copied out of git LFS** without `git lfs pull` is a 132-byte pointer: the kit's readers say so.

## What it cannot do

Judge the look (that is the person in the game, against the target); move or remove a brush of the shipped map (the
layout is kept on purpose: a new layout is a new map, `docs/MAPS-MAKING.md`); draw PrimeXT's normal, gloss and
dynamic light in the kit's view; compile (the build writes a `.map` and `wads.txt`; the compile is the kit's).
