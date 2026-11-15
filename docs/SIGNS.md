# A sign drawn by a program: words, arrows, a number painted on a wall

A map wants signs: a shop's neon, a board with arrows, a poster's three words, a bay's number on a concrete pier, a
yellow line on a floor. They are the one kind of texture a program draws well (letters, arrows and plain shapes;
not a figure, not a mural). The optional pack `packs/signs/` draws them from a small spec and writes them as
`packs/materials` writes a material, into the same folder, so one `.wad` holds both. `smak` has no such command (the
kit never imports a pack).

```
node packs/signs/bin.mjs sign work/signs.json -o work/tex
node packs/signs/bin.mjs sheet work/signs.json -o work/signs.sheet.png --against old/tex
node packs/materials/bin.mjs wad work/tex -o work/hall.wad
```

## The spec

One sign, or a list of them, in a `.json`:

```json
{ "name": "~exit", "size": [96, 32], "texels": 2, "finish": "neon", "frame": 1, "items": [
  { "text": "EXIT", "box": [30, 6, 90, 26] },
  { "arrow": [16, 16, 8], "dir": 180, "colour": [120, 255, 160], "width": 2 }
] }
```

- `name`: the texture's name, 15 letters at most (FAIL over that). `~name` for one that gives light: Xash draws a
  `~` texture at full light; GoldSrc lights it as a wall unless the map makes it a texture light.
- `size`: `[w, h]` in the sign's own units, which are the map's: the plate it goes on is that size. `texels`: the
  texels to the unit (1). The texture is `size x texels` and both sides must be multiples of 16 (FAIL, and it says
  the next size). Lay it at scale `1 / texels`: 2 texels a unit is scale 0.5, as a wall a player stands next to
  (`docs/MATERIALS.md`, "Texels to the unit").
- `finish`: `neon`, `lit`, `paint` or `plate`, below.
- `ground`: a colour, or `{ "from": c, "to": c, "folds": [amount, every] }`: from top to bottom, and in vertical
  folds `every` units apart (a cloth banner). `frame`: a width in units, or `{ "width", "colour" }`.
- `colour`, `width`: what an item takes when it gives none. A colour is `[r, g, b]` or `"#rrggbb"`.
- `items`: drawn in order. x runs right and **y runs down**, from the sign's top left corner.

| Item | What |
| --- | --- |
| `{ "text": "WORDS" }` or `["LINE", "LINE"]` | With `box: [x0, y0, x1, y1]`: centred up and down in it, `align` `left`, `centre` (the default in a box) or `right`; with no `height`, the largest that fits. With `at: [x, y]` and `height`: the first capital's top, and its left, middle or right by `align`. `width`: the stroke (an eighth of the height); `gap`: between letters, a share of the height (0.2); `leading`: line to line, in capitals (1.5) |
| `{ "line": [[x, y], ...] }` | A stroke through the points; `closed` joins the last to the first |
| `{ "rect": [x0, y0, x1, y1] }` | Its outline; `radius` rounds the corners; `fill: true` fills it |
| `{ "circle": [x, y, r] }` | Its outline, or an arc `from` and `to` in degrees, 0 to the right, 90 **down**; `fill: true` |
| `{ "polygon": [[x, y], ...] }` | Filled: a skyline, a pennant's cut, a pictogram's body |
| `{ "arrow": [x, y, size] }` | A shaft and a head, `dir` 0 right, 90 up, 180 left, 270 down |

Every item takes `colour`, `width`, `opacity`, and:
- `repeat: [nx, ny, dx, dy]`: copies in a grid (stripes, a board's rules, windows); `some: 0.3` keeps that share of
  them, the same ones each run (`seed` in the sign changes which).
- `within: n`: only where item `n` (counted from 0, an earlier one) is: windows inside a tower, stripes in a disc.
- `glow` (neon): the halo's reach in units (the stroke's width, 1.5 at least).

The font is the pack's own: capitals (a small letter is drawn as its capital), digits, `. , : ! ? ' " - + / ( ) = <
> %` and the arrows `← → ↑ ↓` as letters. Anything else is left out with a WARN. One weight, one style: a sign that
needs a typeface is a picture the person gives you.

## The finishes

- **neon**: a dark ground (`[14, 8, 20]` unless `ground`), each stroke a tube: its colour, white-hot along its
  middle, a glow round it. Colours of tubes: pink `[255, 120, 235]` (the default), violet `[215, 130, 255]`, cyan
  `[110, 235, 255]`, amber `[255, 190, 90]`. Keep tubes a glow apart or their halos join.
- **lit**: a bright ground, the items flat on it, a little darker towards the edges as a lamp box is (`"flat":
  true` for none: a cloth banner, a screen). The default ink is near black; on a dark `ground` give a pale `colour`.
- **paint**: over a material `packs/materials` made. `on`: the material's place and name with no `.png`
  (`"tex/hall_conc"`), from the spec's folder; `at: [x, y]`: the texel of the material the sign's corner lies on,
  so the wall's own picture runs on round the paint. `wear` (0.35): 0 fresh, 0.6 mostly gone; the paint chips first
  where the material is dark (its pits and cracks) and takes the material's shade. `fade` (0): how thin what is left
  is. `texels` must be the wall's own (1 over its scale), or the sign's concrete is not the wall's.
- **plate**: a board in its `ground` colour with a little grain and a frame, 2 units unless `frame` says (0: none),
  lit on its top and left edge. Not a light: name it without `~`.

## What it writes

`<name>.png` in the folder, its own 256 colours: what `wad` puts in the `.wad`. Beside it:
- **paint**: `<name>.set/` (the material's colour, normal, roughness, metalness and occlusion cut to where the sign
  lies, the paint on the colour and a little smoother on the roughness, and `material.json`) and
  `<name>.credit.txt`, the material's credit carried. `packs/gltf`'s lit way and `packs/godot` take the set as they
  take the wall's (`--sets <folder>`): the pier with the number has the wall's relief.
- **neon**, **lit**: `<name>.set/emissive.png` and `sign.json`. In the lit `.glb` a sign shines when the map makes
  it a texture light: `sign` prints the line, `"~exit" "255 82 237 <brightness>"`, the colour of its light, for
  `textureLights` (`docs/MAPS-REFERENCE.md`, the table of lights: 500 to 1400 for a sign that lights a street, 30
  to 60 for one that only glows). `packs/gltf` then uses the texture itself as the emissive picture.
- `<spec>.sheet.png`: each sign at its size and at a quarter.

## Read the answer, then the sheet

`sign` ends in `PASS:` or `FAIL:`. FAIL: a texture not in 16s; a name over 15 letters.

| WARN | What to do |
| --- | --- |
| `its capitals are N texels high, under 7` | The strokes of an E, a B, an 8 run together. A larger `height`, more `texels`, or fewer words |
| `its strokes are ... of a texel wide, under 1` | They break up. A wider `width` |
| `its strokes are ... over 0.25 of them: the letters fill in` | A thinner `width` (an eighth to a sixth reads best), or taller letters |
| `a contrast of N to 1, under 2` | The words are lost in what is under them: 1.3 is not found, 2 is read. Another `colour`. On paint, wear takes more |
| `it is cut by the sign's edge` | Move it in, or make it smaller; a `box` keeps it in |
| `it does not fit its box` | Give no `height` (it is fitted), or the height it names |
| `the font has no "É"` | Spell it with what the font has |
| `has no set beside it` / `is a part of its source` | The painted sign gets no set, and in a lit engine a flat patch on a wall with relief. Make the material whole (no `--part`) with its set kept |

Then look. The sheet draws each sign twice: at its size (a player beside it) and at a quarter (four times as far:
across a hall). **Read the words in both.** At a quarter, capitals under 28 texels are under 7: a street sign wants
them 14 units high at 2 texels a unit; a menu's small print is read only from close, and that is right for a menu.
`sheet --against <folder>` draws, before each sign, the `<name>.png` of that folder: what it replaces, or the
reference's crop saved under the sign's name.

Look for: tubes of a neon whose halos run together into a blot; words that touch the frame; a painted number so
worn that it is not read at a quarter (less `wear`); a paint brighter than anything round it; a sign that is a rectangle of text and nothing else (a
pictogram, a rule, an arrow make it a sign).

## On a map

A sign goes whole on a thin plate of its own size, in a frame: `box(min, max, fitted("~exit", [192, 64], min, max,
{ whole: true, faces: ["east"], rest: "hall_steel" }))` for the spec above (192 x 64 texels on 96 x 32 units), and
its name in `textureLights` if it shines. A painted number goes on the wall's own face: a brush face of the sign's
size wearing it at the wall's scale, its `at` chosen so the concrete runs on (the face's texture offset), or simply
on a pier of its own, where no one sees the join. A line on a floor is a strip: `size: [192, 8]`, a filled `rect`
across it, the face repeating it along the floor.

## In a script

```js
import { makeSign, writeSign, signSheet, pictureOf } from "file:///C:/path/to/smak/packs/signs/sign.mjs";
import { wadOfFolder } from "file:///C:/path/to/smak/packs/materials/material.mjs";
const made = makeSign({ name: "hall_d3", size: [144, 128], texels: 2, finish: "paint", on: "hall_conc", wear: 0.4,
  items: [{ text: "D3", box: [0, 14, 144, 114], height: 80, width: 14, colour: [150, 34, 28] }] }, { base: "work/tex" });
for (const line of [...made.errors, ...made.warnings]) console.log(line);   // report each
writeSign(made, "work/tex");
writeFileSync("work/hall.wad", wadOfFolder("work/tex").bytes);
```

`makeSign` returns `{ texture, picture, layers, emissive, lines, warnings, errors }`; `texture` is `{ name, width,
height, pixels, palette }`, what `writeWad` takes as it is. `textPaths(text, x, y, height)` (`font.mjs`) gives the
strokes alone, for a script that draws them elsewhere.

## What it cannot do

A typeface, small letters, accents, another script; a logo or a figure (a picture the person gives is laid with
`packs/materials`' own tools, not here); an animated sign (`+0name` frames are yours to name: make each frame a
sign); relief of its own (a plate's bolts, embossed letters: the set is the material's, or none); judge what the
words say or whether the sign suits the place. Nothing was run in the game: how bright a `~` texture is there, and
how a texture light of its colour fills the street, only show there.
