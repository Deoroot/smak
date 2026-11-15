# packs/materials: a photographed material as a GoldSrc texture

An optional pack (ARCHITECTURE.md 2.6). The kit does not paint: this pack takes a material people photographed or
scanned, from [ambientCG](https://ambientcg.com) or [Poly Haven](https://polyhaven.com) (both CC0, both open with no
key), and fits it to the engine: shrunk by a box filter, made to tile where it does not, cut to 256 colours, measured
(the seam, the palette's error, the brightness against Valve's own textures, how much it shouts its repeat), with
its whole set kept beside it for other engines. The ceiling of quality is the source's.

```
node packs/materials/bin.mjs search <words | source:id ...> [--source ambientcg|polyhaven] [--limit n] [--sheet x.png]
     [--cache <folder>]
node packs/materials/bin.mjs material <id> --name <texture> --size 256|512|WxH -o <folder> [--tone r,g,b[,amount]]
     [--final] [--chroma k] [--shift dx,dy] [--mirror] [--holes mask.png] [--part x0,y0,x1,y1] [--marks spec]
     [--metres m] [--even] [--dither] [--against x.wad:name[@scale]] [--scale u]
node packs/materials/bin.mjs wad <folder> -o x.wad
```

`smak` has neither command: the kit never imports a pack. The guide is `docs/MATERIALS.md`.

**Budget: 900 lines**, every `.mjs` under this folder (layers.json `packs`; test 00 prints it). Its tests are
`test/206-pack-materials.mjs` (no network: a stand-in for it and small sets written by `test/fixture-materials.mjs`)
and the broken cases in `test/broken/packs.mjs`.

| File | What |
| --- | --- |
| `libraries.mjs` | Both APIs: the lists (kept a week), the search over both, a set downloaded at 1K; a zip reader (stored and deflated entries, all ambientCG ships) |
| `material.mjs` | `makeMaterial` (resample, seam, mend, even, tone, marks, shift and mirror, chroma, holes, the final mean, quantise, brightness, PASS/FAIL), `writeMaterial`, `wadOfFolder`, `wallSheet` |
| `marks.mjs` | Seams, rivets (in rows, or round a ring), grime, rust streaks, wet, a band at the foot, a grating's bars, a caller's function: on the colour, the normal and the roughness alike |
| `bin.mjs` | The three commands; `search --sheet`, the candidates flat |

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

## Into a room: its palette, its lines, its holes

What the mess hall's round 3 had to write round the pack (the owner's map project, its `messhall/KIT-FAULTS.md` M22 to M30), now
options of `material` (and of `makeMaterial`, named the same). In the order they are laid: resample, mend, `--even`,
`--tone`, the material's marks, `--shift` and `--mirror`, the face's marks, `--chroma`, the holes, `--final`, the 256
colours.

- **`--final`** (M27): the tone is the texture's mean after the marks, the band and the chroma, not before them
  (grime and streaks took the mess hall's walls from the 60/76/75 asked to 52/61/60). The marks are laid on the tone,
  then one gain a channel brings the mean back to it; the mean is measured on the texture's 256 colours, holes left
  out, and printed (`mean r/g/b`). Off by more than 1.5 a channel (texels clipped at 255, or black where no gain
  lifts them): a WARN. With an amount under 1, what is final is what that amount gives.
- **`--chroma k`** (M22): each texel's colour kept at k of its distance from its own grey (luma). The tone is a gain
  a channel: it sets the mean and keeps a paint's saturation, so a pale cyan-green toned to a grey-teal came out a
  saturated blue-cyan; 0.6 to 0.65 brought the walls into the reference's palette.
- **`--shift dx,dy`** and **`--mirror`** (M24): the material rolled by whole texels of the texture (its set by as
  many of its own pixels), wrapping, then mirrored left to right (the normal's red turned), so its own seams lie on a
  room's lines; a mirrored copy keeps the same lines and makes a variant. The material's marks (seams, rivets, grime,
  streaks, wet) move with it; the face's marks (band, bars, a function) are laid after, where the face is.
- **`band`** (M25), a mark: a kick plate `height` texels at the texture's foot, `dark`, a groove `groove` texels deep
  on its top (`deep`, sunk in the normal) and its lit lip (`lit`): `band:height=44` is 22 units at scale 0.5.
  **`ring`**: rivets every `step` round a circle (`x`, `y`, `radius`), a plate round an opening. One line of rivets
  needs nothing new: `rivets:every=<the texture's side>,inset=<where>,rows=x` (or `y`).
- **Holes** (M26): a `{` texture takes its holes from `holes` (a function (x, y, w, h), true at a hole; `--holes
  mask.png`, dark a hole, at any size), else from a **`bars`** mark (bearing bars every `pitch` texels, `bar` wide,
  lit on one side; cross rods every `cross`, `rod` wide; `under` the shade between), else from the set's opacity map
  as before. Holes given or from bars are written into the set as its `opacity.png`, so another engine sees the same
  holes. A photographed steel becomes a bar grating: the libraries' gratings with an opacity are perforated plates.
- **`search <source:id ...> --sheet x.png`** (M30): the candidates (found by words, or named) made 256 with no tone,
  flat, 5 a row, each named, with a band of its mean colour at its foot that says the colour, the brightness and how
  it was made (scanned: Poly Haven; photo: ambientCG's photogrammetry or approximated; PROCEDURAL). Each set is
  downloaded as `material` would, into the cache: a sheet of 25 is 25 sets.
- In code, `marks` may also be an array of texts and functions `(u, v, T, H) => { mul, add, tint, t, height, rough }`
  (u, v in the texture's texels): the mess hall's grille louvres are one.

**A tile is the whole 1K source** (M23, not changed). At d texels a unit a tile of m metres is shown at its real size
when the texture is m x 39.37 x d texels a side: rusty_metal_grid (1.8 m) at 2 texels a unit is 142 texels, so
`--size 144 --scale 0.5` draws it at its size, repeating every 72 units; a 512 at scale 0.5 draws it 3.6 times its
size (the mess hall took that: its frames read as large hull panels). `--part` does not answer it: a part is less of
the picture on as many texels, larger still. Sharp at its real size the 1K source gives 1024 / (m x 39.37) texels a
unit (14 for that grid): a larger tile at its size needs a 2K or 4K set, which the pack does not download.

## PASS and FAIL

`material` ends in one line. **FAIL**: the tile's seam over 2.5 times the steps inside it after mending. **WARN**,
each printed: a seam over 1.5 (look at the 3 x 3), a source or a part mended, a `--final` mean off by more than 1.5, brightness out of Valve's 5th to 95th
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
| {mh_grate | ambientcg:MetalWalkway014 (its opacity) | 256 | 1.01 / 1.01 | 4.16 / 23.3 | 94.3\* (53.7) | 0.041 |
| mh_pillar | polyhaven:rust_coarse_01 `--even`, seams, rivets | 256 | 0.99 / 0.99 | 1.96 / 6.6 | 66.2 (51.1) | 0.121 to 0.022 |

The .wad of the seven: 1366 KB (the mess hall's 28 textures: 385 KB); `smak check` PASS. Not done: dithering was not
needed (the per-block error is under 1.6 of 441 on all six), so `--dither` is off unless asked; 2K sets.
\* Counted with its holes; the brightness leaves them out since the round below (101.1 now, the same texture).

**Into a room**, 2026-11-15 (Node 20): the mess hall's `materials.mjs` (the owner's map project, round 3, as the owner accepted it
in Godot) copied and run against the pack before these options and after (C:/tmp/smak-v13/matfix):
- Before: its 33 textures the same bytes as the accepted ones. The seven above, made again with the options as they
  were: the same bytes (7 textures, 31 maps of their sets; material.json but for its date).
- Its own drawing (the roll, the mirror, `kickBand`, the grating's bars and holes, `chroma`, its re-quantising and
  its means) replaced by the options: 245 lines to 146. With round 3's tones and no `--final` all 33 come out the
  same bytes. Their sets: the walls' differ in the band's rows only (the room drew it on the 1K set a pixel of the
  set high, its groove half the texture's; the pack draws it in the texture's texels on both, sinks the groove in the
  normal and roughens the plate); the grating's set has its opacity.png; the other 132 maps the same bytes.
- With `--final` and each tone the mean that texture had: 4 the same bytes (those with no marks), 29 differ by at
  most 4 to 11 of 255 a channel, 0.25 to 0.86 on the mean (before-after.png: before | after | the difference x 8,
  looked at: the same pictures). Their means are within 0.25 of the tone asked, where round 3's were within 0.56 of
  those same numbers (asked other numbers, 60/76/75 for 52/61/60).
- The 25 candidates of its `r3-candidates.mjs` (30 lines) are one `search ... --sheet` (candidates.png), the same
  sets made the same way, with how each was made said.

Not verified: the after textures in Godot or in the game (only as pictures here); `ring` and `--holes mask.png` on a
room (only in the tests).
