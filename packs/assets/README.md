# packs/assets: a Poly Haven model as a GoldSrc prop

An optional pack (ARCHITECTURE.md 2.6). It searches [Poly Haven](https://polyhaven.com)'s scanned models (522 on
2026-11-14, every one CC0) through its public API, with no key, and makes one a GoldSrc prop through the kit's own
import door (`readModelFile`, `importModel` with `triangles`: the quadric reducer, make/qem.mjs), then checks it
(`check` for goldsrc, `smak form`'s measures) and draws it beside the source from the same cameras.

```
node packs/assets/bin.mjs search <words> [--limit n]
node packs/assets/bin.mjs prop <id> -o out/<name>.mdl --height <units> | --scale <n> [--triangles n] [--texture 256|512] [--cache <folder>]
```

`smak` has neither command: the kit never imports a pack. The guide is `docs/ASSETS.md`.

**Budget: 700 lines**, every `.mjs` under this folder (layers.json `packs`; test 00 prints it). Its tests are
`test/203-pack-assets.mjs` (no network) and the broken cases in `test/broken/packs.mjs`.

| File | What |
| --- | --- |
| `polyhaven.mjs` | The API: the list of models (kept a week in the cache), the search, `/info`, `/files`, the glTF at 1k downloaded |
| `prop.mjs` | The prop: the budget, `makeProp` (with its PASS/FAIL errors), `propSheet`, `creditText` |
| `bin.mjs` | The two commands |

## The terms, and how the pack keeps them

- **The models are CC0** (public domain): no credit is required, ever. The pack writes `<name>.credit.txt` beside
  each `.mdl` all the same (name, id, URL, authors as `/info` gives them, licence, the files' hash): keep it with the
  model, and credit the authors where a mod lists its sources.
- **The live API** has its own terms (github.com/Poly-Haven/Public-API, ToS.md): free for any use, but every call
  must carry a **unique User-Agent** naming the software (2.4): the pack sends
  `SMAK-assets-pack/1.2 (+https://github.com/Deoroot/smak)` on every request, the downloads too. Software that shows
  content from the live API must say where it comes from (2.5): every `search` and `prop` prints
  `Powered by Poly Haven (polyhaven.com)`. No disruption (2.6): the list is asked once a week, a file already in the
  cache at its size is not asked again, and only the base colour (and an opacity map) is downloaded, not the normal,
  roughness, metal or ambient maps.
- **Never in a repository.** The cache is `<the system's temp folder>/smak/assets` unless `--cache` says otherwise;
  write the `.mdl` to a working folder. The kit's tests download nothing.

## What a prop is made of

- **The glTF at 1k** (the `.gltf`, its `.bin`, the base colour pictures: JPEG). A material whose picture has an
  opacity map on Poly Haven (`<map>_opacity`, a label, a glass) gets it as alpha: a texture with holes (flag 64)
  where the opacity is under half. Normal, roughness and metal maps are left out: a studio model has none.
- **Size**: `--scale 1` is its true size, 39.37 units a metre (the kit's figure); `--height` makes it that many units
  high. Its height is held against Poly Haven's `dimensions` (millimetres, z up): 10 % off is a FAIL, a file on its
  side.
- **Place**: `importModel`'s `origin: "base"`: the middle of its box on the floor, its lowest point on z = 0; facing
  as the importer turns glTF's front (+z) to the game's +x. One bone, one still animation.
- **Textures**: one a material, made a whole number of times smaller to 512 (or `--texture 256`), 8-bit by the kit's
  palette; materials that show one picture share one texture.
- **The budget** (unless `--triangles`): 40 a unit of its longest side, between 1000 and 2000. Half-Life's own 49
  props and items carry 14 to 720 triangles (about 100 at the median, 3 a unit of their longest side), measured on
  valve/models; a scan brought that low is a lump. Drawn at budgets (`budgets-*.png` below): the extinguisher, 26
  units high, is a wedge at 300 (the reducer stopped at 489), warped at 800 (its label rippled, its yellow band
  jagged), itself at 1200 and 2000; the pair of dustbins, 70 long, is broken at 460, tapered at 820, itself at 1500.
  The reducer stops short where a join would turn a face over or smear across two charts of the picture: then the
  prop has more than asked, and says so.

## PASS and FAIL

`prop` ends in one line. **FAIL**: an error of `check` for goldsrc; the foot not on z = 0 at the middle; a height
not Poly Haven's; more than one submodel holds (2048 points: GoldSrc would draw it as several bodyparts). **WARN**,
each printed, none hidden on a pass: check's warnings (a `form:` one among them), the reducer stopping short, heavy
(over 2500 triangles), the file holding several objects side by side (all in the prop), a see-through (BLEND)
material drawn solid or with holes. The detail goes to `<temp>/smak/assets-prop-<name>.txt`; the sheet is
`<name>.png`: six views, each the source (left) and the prop (right) from the same camera, the last two from a
player's eye 64 over the floor, 96 and 256 away, as many pixels as the middle of a 1280-wide screen at fov 90.

## Verified with

Five models for a mess hall, 2026-11-14, `--scale 1`, the default budget, Node 20 (the pictures and the models
are kept outside the repository: they are the assets' own):

| Id | Source | Prop | Box, units (source's) | Answer |
| --- | --- | --- | --- | --- |
| korean_fire_extinguisher_01 | 9913 tris, 3 x 1024² | 1037 tris, 650 points, 3 x 512², 817 KB | 14.5 x 11 x 25.9 (14.5 x 11 x 26) | PASS, 2 WARN (two BLEND materials, holes from their opacity maps) |
| metal_tool_chest | 13 360, 1024² | 1872 (1079 asked), 982, 512², 339 KB | 16.8 x 27 x 25.7 (16 x 27 x 25.7) | PASS, WARN the reducer stopped short (a face would turn) |
| old_military_crate | 20 952, 1024² | 2868 (2000 asked), 1700, 512², 376 KB | 38.9 x 71.5 x 10.8 (38.4 x 71.5 x 11.8) | PASS, WARN stopped short (seams), heavy, two crates side by side |
| metal_trash_can | 13 960, 3 x 1024² | 1998, 1039, 2 x 512², 597 KB | 21.7 x 70.1 x 35.7 (21.9 x 70 x 35.7) | PASS, WARN two cans side by side |
| modular_airduct_rectangular_01 | 45 090, 2 x 1024² | 9240 (2000 asked), 7123, 5 bodyparts | 104.5 x 301.7 x 49.5 | FAIL: more than one submodel; 17 pieces of a kit side by side |

Not one `WARN  form:` (boxiness 0.36 to 0.74, Half-Life's props 95th 0.85). Placed as `cycler_sprite`s with a CLIP
box each in a room carved as example 07's, beside Half-Life's player, and drawn by `map-view` from a player's eye:
each stands on the floor at its size; compiled with sdHLT, `map-battery`'s props: `PASS: 7 entities with a model or
a body, none over the floor`. Nothing was run in the game.

Not done: a part of a file chosen (one crate of the two, one duct of the kit): the whole file is the prop, and the
warning names its objects; FBX or the `.blend`; resolutions over 1k; a normal map baked into the colour.
