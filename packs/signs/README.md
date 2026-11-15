# packs/signs: a sign drawn by a program onto a texture

An optional pack (ARCHITECTURE.md 2.6), over `packs/materials`. Words in a stroke font of its own and plain shapes
(lines, rectangles, arcs, polygons, arrows), in the sign's own units, with one of four finishes: **neon** (a glow
round the strokes on a dark ground), **lit** (a bright panel, as a backlit poster), **paint** (laid over a material
of `packs/materials`, worn, the material's set carried over) and **plate** (a board with a frame). Out comes what
`packs/materials` writes, into the same folder: the 8-bit texture as `<name>.png` at a legal size, and a set where
there is one.

```
node packs/signs/bin.mjs sign <spec.json> -o <folder>
node packs/signs/bin.mjs sheet <spec.json ...> -o <x.sheet.png> [--against <folder>]
node packs/materials/bin.mjs wad <folder> -o x.wad
```

```js
import { makeSign, writeSign } from "file:///C:/path/to/smak/packs/signs/sign.mjs";
const made = makeSign({ name: "~exit", size: [96, 32], texels: 2, finish: "neon", items: [{ text: "EXIT", box: [8, 6, 88, 26] }] });
writeSign(made, "work/tex"); // .errors, .warnings, .lines, .texture ({ name, width, height, pixels, palette })
```

`smak` has neither command: the kit never imports a pack. The guide is `docs/SIGNS.md`: the spec, each finish, the
warnings, how a sign goes on a map.

**Budget: 560 lines**, every `.mjs` under this folder (layers.json `packs`; test 00 prints it; 504 now). Its tests
are `test/209-pack-signs.mjs` (no network; its material is made by `packs/materials` from a set written by
`test/fixture-materials.mjs`) and the broken cases in `test/broken/packs.mjs`.

| File | What |
| --- | --- |
| `font.mjs` | The font: 26 capitals, 10 digits, `. , : ! ? ' " - + / ( ) = < > %` and four arrows, each a few strokes on a grid 8 by 12, drawn here from no font file; rounded corners by cutting them twice; `textPaths`, `textWidth` |
| `sign.mjs` | `makeSign` (the items as distance fields, the finishes, the wear, the set, the warnings, 256 colours by `packs/materials`' `quantise`), `writeSign`, `signSheet`, `pictureOf`, `FINISHES` and the three limits with their reasons |
| `bin.mjs` | The two commands |

It imports `packs/materials/material.mjs` (`quantise`, `resample`, `readPicture`) and changes nothing there, nor in
`packs/gltf`.

## What a sign is made of

- `<name>.png`: the texture, its own 256 colours (what `packs/materials`' `wad` puts in the .wad, colour for colour).
- **paint**: `<name>.set/` with the material's `color`, `normal`, `roughness`, `metalness`, `occlusion` cut to where
  the sign lies on it, at up to 1024 a side, the paint on the colour and (a little smoother) on the roughness, and
  `material.json`, which is what `packs/gltf`'s lit way looks for: the painted pier has the relief of the wall round
  it. `<name>.credit.txt`: the material's credit, carried.
- **neon**, **lit**: `<name>.set/emissive.png` (what gives light: neon's tubes and glow without the ground; a lit
  panel whole, its frame dark) and `sign.json`. No `material.json`, so `packs/gltf` claims no relief for it.
  `packs/gltf`'s lit way makes a texture emissive when the map names it in `info_texlights`, with the texture itself
  as the emissive picture: on a dark ground that is already the tubes. `sign` prints the line to give
  `textureLights`. `emissive.png` is for an engine set up by hand.
- **plate**: the texture alone.

## How it is drawn

Every item becomes lines (a letter's strokes, a circle as 48 sides, a rounded corner as arcs); for each pixel the
distance to the nearest is kept, negative inside a filled shape. A stroke covers where that is under half its width,
with half a pixel of soft edge; neon adds, per item and not per segment, a near glow and a wide faint one from the
same distance (so a joint is no brighter than a run) and a white-hot middle. Paint is one coat over the material's
texture: it stays where two noises (2.5 and 20 texels) and the material's own light and dark say so, chipped first in
the material's dark pits, a ghost of it left where it chipped, and takes the material's shade. The same coat is
drawn again at the set's size, with the same chips.

## Verified with

A district's seven hand-drawn signs (the owner's map project, its `district/KIT-FAULTS.md` D1 and D6) remade from
specs, 2026-11-15, Node 20; kept outside the repository (C:/tmp/smak-v14/signs: `specs/`, `out/`,
`proof.sheet.png`, `signs.wad`):

| Sign | Finish | Texture | Spec's lines | The hand script's |
| --- | --- | --- | --- | --- |
| a noodle bar's neon: a bowl, two lines of words | neon | 384x112 | 9 | 12 |
| a hanging board: three rows, five arrows | plate | 384x144 | 11 | 16 |
| a number on a concrete pier | paint on polyhaven:concrete_wall_006 | 288x256 | 3 | 10 |
| a worn yellow line on floor tiles | paint on polyhaven:large_floor_tiles_02 | 384x16 | 3 | 8 |
| a poster: a skyline, three words | lit | 128x224 | 9 | 16 |
| a banner: cloth in folds, a mark, a name | lit | 96x256 | 9 | 11 |
| a menu | lit | 64x96 | 6 | 8 |

and the hand script's 71 lines of font, canvas and strokes are the pack. The .wad of the seven: 314 KB,
`smak check` PASS. Both painted signs carry their set (576x512 and 768x32: color, normal, roughness, occlusion).

Not verified: any of them in the game or in another engine (only as pictures here, and the set's format by
`packs/gltf` reading one back in the tests); a painted sign's set in a lit `.glb` of a real map.
