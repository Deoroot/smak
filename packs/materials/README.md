# packs/materials: a photographed material as a GoldSrc texture

An optional pack (ARCHITECTURE.md 2.6). The kit does not paint: this pack takes a material people photographed or
scanned, from [ambientCG](https://ambientcg.com) or [Poly Haven](https://polyhaven.com) (both CC0, both open with no
key), and fits it to the engine: shrunk by a box filter, made to tile where it does not, cut to 256 colours, measured
(the seam, the palette's error, the brightness against Valve's own textures, how much it shouts its repeat), with
its whole set kept beside it for other engines. The ceiling of quality is the source's.

```
node packs/materials/bin.mjs search <words> [--source ambientcg|polyhaven] [--limit n] [--cache <folder>]
node packs/materials/bin.mjs material <id> --name <texture> --size 256|512|WxH -o <folder> [--tone r,g,b[,amount]]
     [--part x0,y0,x1,y1] [--marks spec] [--metres m] [--even] [--dither] [--against x.wad:name[@scale]] [--scale u]
node packs/materials/bin.mjs wad <folder> -o x.wad
```

`smak` has neither command: the kit never imports a pack. The guide is `docs/MATERIALS.md`.

**Budget: 900 lines**, every `.mjs` under this folder (layers.json `packs`; test 00 prints it). Its tests are
`test/206-pack-materials.mjs` (no network: a stand-in for it and small sets written by `test/fixture-materials.mjs`)
and the broken cases in `test/broken/packs.mjs`.

| File | What |
| --- | --- |
| `libraries.mjs` | Both APIs: the lists (kept a week), the search over both, a set downloaded at 1K; a zip reader (stored and deflated entries, all ambientCG ships) |
| `material.mjs` | `makeMaterial` (resample, seam, mend, even, tone, quantise, brightness, PASS/FAIL), `writeMaterial`, `wadOfFolder`, `wallSheet` |
| `marks.mjs` | Seams, rivets, grime, rust streaks, wet: on the colour, the normal and the roughness alike |
| `bin.mjs` | The three commands |

Shared with packs/assets: its Poly Haven client (`askNetwork` now takes the User-Agent, `assetList` a `kind`,
`searchAssets` a `type`: three lines changed there, its tests unchanged).

## The terms, and how the pack keeps them

- **ambientCG** (docs.ambientcg.com/license): CC0 1.0, credit not required but asked for gladly, in the words
  `Created using <asset> from ambientCG.com, licensed under the Creative Commons CC0 1.0 Universal License.`: the
  credit file says exactly that. Its API (docs.ambientcg.com/api: v2 "does not receive updates anymore. New projects
  should use v3"): the pack uses v3 `/api/v3/assets`, asks the list once a week (500 a page, 5 pages), and downloads
  through the `downloadLink` (`/get?file=`), which the docs encourage because it counts the download. The site is one
  person's; nothing is asked twice.
- **Poly Haven** (github.com/Poly-Haven/Public-API, ToS.md): CC0; every call carries a unique User-Agent,
  `SMAK-materials-pack/1.3 (+https://github.com/Deoroot/smak)`; every `search` and `material` that shows its content
  prints `Powered by Poly Haven (polyhaven.com)`; the list is asked once a week, a file in the cache at its size never.
- **Never in a repository.** The cache is `<temp>/smak/materials` unless `--cache` says otherwise.

## What a material is made of

- `<name>.png`: the GoldSrc texture, its own 256 colours (what `wad` puts in the .wad, colour for colour).
- `<name>.set/`: `color.png`, `normal.png`, `roughness.png`, `metalness.png` and `occlusion.png` where the set has
  them, at the library's 1K, untouched but for the normal's convention and the marks; `material.json`.
- `<name>.credit.txt`, and `<name>.sheet.png`: the source | the tile 3 x 3 | on a wall 512 wide beside a player 72
  high at `--scale` | `--against`'s texture (the one it replaces) on the same wall.

**Normals.** Both libraries ship both conventions (ambientCG `NormalGL` and `NormalDX` in the zip, Poly Haven
`nor_gl` and `nor_dx`); the pack takes OpenGL's (+Y up, glTF's and Godot's) and turns DirectX's (green inverted)
only when it is alone. Seen in Godot 4.7.2 on a plane lit from the top of the picture: MetalWalkway014's holes and
rusty_metal_grid's frames read sunk and raised as written, inverted with the green flipped.

**How it was made.** ambientCG says, per material, whether it was photographed (`surface-photogrammetry`,
`surface-approximated`) or drawn by a program (`surface-fully-procedural`): 1365 of its 2041 materials are drawn, and
of its 214 metals only 5 are photographed. `search` prints it; `material` warns of a drawn one (the owner turned
those down as "AI textures"). The mess hall's own sources were four of them (Metal038, PaintedMetal012,
CorrugatedSteel005, Rock035).

## PASS and FAIL

`material` ends in one line. **FAIL**: the tile's seam over 2.5 times the steps inside it after mending. **WARN**,
each printed: a seam over 1.5 (look at the 3 x 3), a source or a part mended, brightness out of Valve's 5th to 95th
(31 to 161; halflife.wad's 2245 plain textures, median 87), a repeat that shouts (over 0.08), a drawn material, a set
with no normal or roughness. `wad` ends in checkWad's answer for goldsrc.

## Verified with

Six materials for the mess hall (and a wet variant of the floor by `--marks`), 2026-11-14, Node 20; the pictures and
the sets are kept outside the repository (C:/tmp/smak-v13/materials/six):

| Texture | Source | Size | Seam source / after | Palette error mean / worst | Brightness (now) | Repeat |
| --- | --- | --- | --- | --- | --- | --- |
| mh_floor | polyhaven:metal_plate_02 | 512 | 0.98 / 0.98 | 1.5 / 4.7 | 74.8 (52.6) | 0.010 |
| mh_wall | polyhaven:rusty_metal_grid | 512 | 0.95 / 0.95 | 3.0 / 12.1 | 121.6 (61.0) | 0.014 |
| mh_ceil | polyhaven:blue_metal_plate `--even` | 256 | 1.0 / 1.0 | 1.4 / 3.4 | 57.5 (66.1) | 0.09 to 0.012 |
| mh_pipe | polyhaven:green_metal_rust | 256 | 1.14 / 1.14 | 1.28 / 5.4 | 69.7 (91.3) | 0.031 |
| {mh_grate | ambientcg:MetalWalkway014 (its opacity) | 256 | 1.01 / 1.01 | 4.16 / 23.3 | 94.3 (53.7) | 0.041 |
| mh_pillar | polyhaven:rust_coarse_01 `--even`, seams, rivets | 256 | 0.99 / 0.99 | 1.96 / 6.6 | 66.2 (51.1) | 0.121 to 0.022 |

The .wad of the seven: 1366 KB (the mess hall's 28 textures: 385 KB); `smak check` PASS. Not done: dithering was not
needed (the per-block error is under 1.6 of 441 on all six), so `--dither` is off unless asked; 2K sets.
