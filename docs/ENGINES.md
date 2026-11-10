# GoldSrc and Xash

A studio model, version 10, is one file format. Half-Life's own engine (GoldSrc, the one on Steam) and Xash3D
FWGS both load it, so a model made for one loads in the other. They differ in how much they hold and in a few
details of drawing. SMAK writes only what both understand.

**For a mod that runs on GoldSrc today and may move to Xash later: build for GoldSrc.** Everything that passes
`check(mdl, "goldsrc")` passes for Xash. The reverse is not true.

## Limits

`check` enforces the first column unless told `--engine xash`.

| | GoldSrc | Xash3D FWGS | If it is passed |
| --- | --- | --- | --- |
| Vertices in one submodel | 2048 | 16384 | Crash or garbage: the engine's tables are that long |
| Normals in one submodel | 2048 | 16384 | The same |
| Bones | 128 | 128 | Refused or crash |
| Texture side | 512 drawn (`gl_max_size`) | What the graphics card takes (4096 or more) | GoldSrc shrinks it when loading: blurry, never sharper than 512 |
| Texture side not a power of two | Stretched to one when loading | Kept as it is on any recent graphics card | A little softer in GoldSrc |
| Textures in one file | 100 in the compiler | 256 in its header, not enforced | Reported as a warning: files in use pass it |
| Submodels in one bodypart | 32 in the compiler | 32 in its header, not enforced | Reported as a fact: files in use pass it |
| Bodyparts | 32 | 32 | |

Where these numbers come from: the GoldSrc ones are `MAXSTUDIO…` in the Half-Life SDK's `studio.h`; the Xash ones
are the same names in Xash3D FWGS's `engine/studio.h`. The checker was calibrated on 707 models shipped by a
GoldSrc mod: none of them raises an error.

`gl_max_size` is 512 by default in Steam builds since the 2023 anniversary update and was 256 before; a player
on an old build sees a 512 texture at 256. If the mod supports old builds, 256 is the safe side.

## Sizes that are always safe

- Textures: 64, 128, 256 or 512 on each side. 512x512 for a first-person weapon at most; 256x256 or smaller for
  world and player-held models.
- A submodel under 2048 vertices. A new mesh written by SMAK shares points between triangles, so this is about
  1000 to 3000 triangles depending on how many hard edges it has. `check` gives the real count.

## Drawing differences

| Texture flag | Value | GoldSrc | Xash |
| --- | --- | --- | --- |
| Flat shaded | 1 | Yes | Yes |
| Chrome | 2 | Yes; old builds draw it right only at 64x64 | Yes, any size |
| Full bright | 4 | Not reliably: test it in the game | Yes |
| Additive (a glow) | 32 | Yes | Yes |
| Masked (holes; palette index 255) | 64 | Yes | Yes |

A masked texture needs its hole colour at palette index 255. `masked()` and `textureFrom(…, { holes: true })`
arrange that. Recolouring a masked texture by its palette must leave the last three palette bytes alone.

Xash can also do things the format's version 10 did not have (several bones a vertex, among others). SMAK
neither reads nor writes those, so a model that uses them should not be edited with it.

## The same file, appended to

SMAK changes a model by writing new data at the end of the file and pointing the file's tables at it. Both
engines read by those tables, so both are indifferent to the unused bytes left behind. Two consequences:

- Files grow with every change. Start each run from the original.
- A tool that rebuilds the file from a decompile (Crowbar, then studiomdl) drops the unused bytes and may
  renumber things. Do not mix the two routes on one file without checking it again.

One part of the file is not read by its tables alone. A dedicated server (HLDS, ReHLDS) loads a model by copying
the file up to where the textures begin, then reading the textures one after another to the file's end, in the
order of their table. It expects the table, and everything that is not a texture, before them. A file with
textures or anything else appended after the first textures is read wrongly there: nothing shows on the first
map, and the server dies on a change of level. The clients (GoldSrc's and Xash's) draw such a file without
complaint, so it is found late. Every function here that changes a model therefore returns it with its textures
moved to the end, in their table's order (`engineLayout`, `core/layout.mjs`), and `check` refuses a file that is
not laid out so. A model made by SMAK 0.2.0 or by another tool can be mended by passing it through `engineLayout`:
its submodels, bones, animations and textures keep their numbers and their bytes.

## Moving a mod to Xash later

Nothing made with SMAK for GoldSrc needs redoing. What opens up is room: more vertices in a submodel and larger
textures. Raise them only for models that will never be loaded by GoldSrc, and check those with `--engine xash`.

## What was and was not tested

| | Checked how |
| --- | --- |
| Reading, checking, drawing | Against 707 models shipped by a GoldSrc mod |
| Replacing meshes, adding submodels and bones, writing whole models | In a running game on Xash3D FWGS (the msr-web project), and read back |
| Replacing textures, replacing and adding animations, events | New in 0.1.0: read back and drawn on 255 models, **not yet loaded by any engine** |
| Anything in Steam GoldSrc | Not yet |
| Working by place: `paint`, `pieces`, `dropTriangles`, `graft` | New in 0.2.0: read back, checked and drawn on 13 player models of The Specialists, **not yet loaded by any engine** |
| Models from The Specialists | 13 player models read, checked and drawn; 20 variants made from them. A modder of that game reports the variants load and are in use (which of them, and whether on a dedicated server, was not recorded) |
| Islands, `paint` in passes and with `soft`, `edge`, `blur`; `copyBody` | New in 0.4.0: the same calls of `paint` as 0.3.0 give the same bytes on 13 models of Master Sword Classic (168 calls); the new ones were read back, checked and drawn on one of its armours. **Nothing made with them has been loaded by any engine yet** |
| Layers of a picture in `paint` (`layers`, `dist`, `region`, `busy`, `orig`, a blur within a layer), `layersOf`, `layerMap` | New in 0.5.0: the same calls as 0.4.0 give the same bytes on 14 models of Master Sword Classic (618 calls of `paint`, `uvIslands`, `islandMap`, `pieces`, `dropTriangles`, `copyBody`, `surface`, `check`, `render`), about a tenth slower in `paint`; an armour painted with a mask module of its own was painted again on layers, to the same picture within a pixel or two at its rims. **Nothing made with them has been loaded by any engine yet** |
| A copy of a body storing fewer normals than its original (`copyBody` stores each pair of bone and normal once: 282 normals of 0, 0, 0 come out as 1) | Read in Xash3D FWGS's `ref/gl/gl_studio.c`, not seen in a game: a mesh's stored normals are lit one by one from the normal's bone and its three numbers (`R_StudioLighting`), chrome likewise, and a corner takes its light by its normal's number, so two stored normals that are alike in both are lit alike and one serves for both. GoldSrc's own source was not read |

So treat the first model you install in a GoldSrc game as the test of the route, start with a reskin because it
changes least, and try one changed animation in the game before making many.
