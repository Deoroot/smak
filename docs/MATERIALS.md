# A photographed material as a map's texture: ambientCG and Poly Haven

A texture drawn by a program reads as a program's (the owner turned such down as "AI textures"). ambientCG and Poly
Haven hold thousands of photographed and scanned materials under CC0, each a set of maps (colour, normal, roughness,
...), with public APIs and no key. The optional pack `packs/materials/` searches both and fits one to GoldSrc: the
colour map shrunk well, made to tile, cut to 256 colours, measured, and the whole set kept beside it for an engine
that lights relief. `smak` has no such command (the kit never imports a pack).

```
node packs/materials/bin.mjs search riveted metal
node packs/materials/bin.mjs material polyhaven:rusty_metal_grid --name mh_wall --size 512 -o work/tex --scale 0.5 --against old.wad:mh_wall
node packs/materials/bin.mjs wad work/tex -o work/hall.wad
```

## Search, and choose by looking

Each line: `library:id`, the name, how ambientCG says it was made, the tags, the real size a tile covers (when the
library gives it), the maps. **Take a photographed one**: on ambientCG `made by surface-photogrammetry` or
`surface-approximated`; `surface-fully-procedural` is drawn by a program, and `material` warns of it. Most of
ambientCG's metals are drawn (209 of 214); Poly Haven's textures are all scanned. Then make two or three and look at
their sheets against the picture the person gave: a search's words do not say what a material looks like.
`--sheet x.png` draws the candidates flat at 256, each with its mean colour and how it was made; give the ids
(`search polyhaven:rusty_metal_grid ambientcg:Metal063 ... --sheet x.png`) to draw exactly those.

## material

- `--name`: the name the faces wear (15 letters). `{name`: a texture with holes, from `--holes mask.png` (dark a
  hole), else a `bars` mark (a bar grating), else the set's opacity map.
- `--size 256 | 512 | WxH`: multiples of 16. The owner's rule: 256, 512 for floors and walls.
- `--scale u`: the units a texel the sheet draws it at (what the map's faces will wear; see "Texels to the unit").
  The answer says the scale at which a tile is its real size, when the library gives that size (`--metres m` when
  it does not).
- `--against x.wad:name[@scale]`: the texture it replaces, drawn on the same wall in the sheet.
- `--part x0,y0,x1,y1` (0 to 1): a piece of the picture; it never tiles, so it is mended (blended at its edges with
  itself shifted half a tile).
- `--even`: takes the light's variation larger than an eighth of the tile out, when it shouts its repeat.
- `--tone r,g,b[,amount]`: moves its colour; without it the material keeps its own (the owner: the room's colour
  comes from its light). With `--final` it is the texture's mean after the marks (grime and streaks darken it).
- `--chroma k`: keeps k of each texel's colour round its grey: the tone keeps a paint's saturation, this brings it
  into a palette (0.6 to 0.65).
- `--shift dx,dy` (whole texels), `--mirror`: the material and its marks rolled and mirrored, so its own seams lie on
  the room's lines; a mirrored copy is a variant with the same lines. The band, the bars and a function are laid
  after, where the face is.
- `--marks`: below; also `band:height=44` (a kick plate at the foot), `ring:x,y,radius,step` (rivets round an
  opening), `bars:pitch,bar,cross,rod` (packs/materials/README.md, "Into a room"). `--dither`: carries the palette's error on (off: unneeded on the materials tried).

It writes `<name>.png` (the texture, its own 256 colours), `<name>.set/` (color, normal, roughness, metalness,
occlusion at the library's 1K, and `material.json`), `<name>.credit.txt` and `<name>.sheet.png`.

## Read the answer, then the sheet

It ends in `PASS:` or `FAIL:`. FAIL: the seam after mending over 2.5 times the steps inside the tile.

| WARN | What to do |
| --- | --- |
| `the tile's seam is ... over 1.5` | Look at the 3 x 3: a line at the joins is a seam; a groove of the material that lies on the edge measures so too |
| `does not tile ... mended` | Look near the edges for a ghost of the picture shifted half a tile |
| `it shouts its repeat` | `--even`, or `--part` a calmer piece, or another material: a bright blotch tiled is a grid |
| `mean brightness ... under 31` / `over 161` | GoldSrc draws texture times light: a dark one stays black, a bright one washes out. `--tone` |
| `was drawn by a program` | Take a photographed one |
| `its mean after the marks is ..., not the ...` | `--final` could not reach the tone: texels clip at 255 or are black. A darker tone, or less grime |
| `has no normal map` | The set has no relief for another engine; the GoldSrc texture is the same |

The sheet: the source | the tile 3 x 3 | on a wall 512 wide at `--scale` beside a player 72 high | the texture it
replaces. Look for: a line or a step in brightness at the joins; one feature repeated in a grid; detail lost at
256 (a tread plate's diamonds are mush at 256: take 512 or a `--part`); its size against the player.

## Texels to the unit (measured 2026-11-14)

A face's scale is its texels to the unit; the texture's size only says how far it goes before it repeats. Half-Life's
own maps lay their textures at 1 texel a unit (median), and so does the mess hall: a 512 laid at scale 1 is no
sharper than a 128, it only repeats less. Sharper is more texels to the unit (scale 0.5: two). In GoldSrc the
lightmap follows: a luxel is 16 texels (sdHLT's `TEXTURE_STEP`, src/sdhlt/common/bspfile.h, a constant; its
`-chop` and `-notexscale` change only the radiosity patches, `sdHLRAD` help), so scale 0.5 is four times the light
samples and hlbsp cuts faces at 240 texels. Measured in a test room (three bays, sdHLT -engine xash -format bsp2):
the 512s at scale 1 cost nothing but the .wad (115 faces, 52 KB light, as the 128s); at scale 0.5, 208 faces and
101 KB. The mess hall with floor, walls, ceiling and pillars at 0.5 and pipes and grate at 0.25: 8726 faces to 9307,
0.7 MB light to 0.9. Seen from 64 to 96 away, a 512 at scale 1 shows its texels as blocks; at 0.5 it is sharp. So:
**scale 0.5 for what a player stands next to (walls to 2 m up, floors); scale 1 for ceilings and what is far.**

## How many slabs a tile holds (measured 2026-11-15)

The library says the real size a tile covers, not what it shows: Poly Haven's large_floor_tiles_02 covers 3 x 3 m and
holds 3 x 3 slabs. `material` counts the lines that cross the whole tile, each way, in the set's occlusion (else its
colour), and says it: `lines cross the tile 3 x 3 times ..., one every 128 x 128 texels (39 x 39 units at its real
size): for one every u units, scale u x 3 / 384 (64 units: 0.5)`; `search --sheet` draws the count in each band.
On 53 sets of both libraries, looked at with the count drawn as a grid, it was right on 30 axes of 21 sets (slabs,
planks, courses, slats, formwork panels) and found nothing on the 25 with no such lines. What it counts is lines, so:
a running bond's vertical joints give **half bricks** (blue_floor_tiles_01: 12 across, 6 bricks); a checker gives two
slabs (floor_tiles_06: 2 where there are 4); diagonal joints give their crossings (interior_tiles: 6 one way, none
the other); staggered joints that do not cross the tile give nothing that way; a tread plate or a grating gives its
pattern (metal_plate 13 x 11); 2 to 16 a side only (painted_metal_shutter's many slats: nothing); unevenly spaced
boards give nothing (concrete_slab_wall: a miss). One doubtful: 16 across
rusty_painted_metal, which has no clear lines. Look at the sheet's 3 x 3 before sizing by it.

## Marks

What the mess hall's helper drew over its photographs, made general, laid on the colour, the normal (OpenGL) and
the roughness at once, in the texture's texels: `--marks "seams:every=64;rivets:step=8,inset=4;grime:amount=0.4,low=0.6"`.

| Mark | Options (default) | Colour / normal / roughness |
| --- | --- | --- |
| `seams` | `every` (64), `x`, `y` (one way only), `dark` (0.45), `lit` (1.25), `width` (1) | a dark groove with a lit lip / sunk / rougher |
| `rivets` | `every` (64), `step` (8), `inset` (4), `r` (1.5), `rows` (x, y, both) | lit up-left, shadow down-right / raised dome / smoother |
| `grime` | `amount` (0.4), `cell` (32), `low` (0: more towards the bottom), `edges` (0: near the seams), `seed` | darker / - / rougher |
| `streaks` | `count` (8), `amount` (0.3), `length` (0.5), `width` (2), `colour` (70/46/30), `seed` | rust run down / - / rougher |
| `wet` | `amount` (0.25), `count` (3), `colour` (200/225/235), `seed` | lighter bands down: water run down a wall / - / smoother |
| `puddles` | `amount` (0.5), `cover` (0.25 of the tile), `cell` (48 texels), `seed` | a floor's wet: darker irregular patches, a damp rim / flat (water fills the relief) / near mirror-smooth |

A floor takes `puddles`, not `wet`: `wet`'s bands run one way and repeat with the tile, stripes on a floor (the
district's dd_floor, fault D7). Puddles are a tiling noise over `cover` of the tile, so they are seamless; they still
repeat with it, less plainly the smaller `cell` is. Their roughness (to 0 at a puddle's heart) is what the lit
glTF way shows; the GoldSrc texture only darkens. `low` grime repeats with the tile: on a wall, lay it on a texture that spans the wall's height. In a script:
`layMarks({ color, normal, roughness }, parseMarks(text), { width, height })` (packs/materials/marks.mjs).

## In a map's script

```js
import { downloadSet } from "file:///C:/path/to/smak/packs/materials/libraries.mjs";
import { makeMaterial, writeMaterial, wadOfFolder } from "file:///C:/path/to/smak/packs/materials/material.mjs";
const set = await downloadSet("polyhaven", "metal_plate_02");
const made = makeMaterial(set, { name: "mh_floor", size: [512, 512] });   // .errors, .warnings, .lines, .texture
writeMaterial(made, "work/tex", set);
writeFileSync("work/hall.wad", wadOfFolder("work/tex").bytes);
// faces: { name: "mh_floor", scale: 0.5 }
```

`makeMaterial`'s `texture` is `{ name, width, height, pixels, palette }`, what `writeWad` takes as it is.

## What it cannot do

Paint (no texture is made from nothing); tell a photographed Poly Haven texture from a drawn one (it says none is
drawn); make a material sharper than its 1K source (2K and over are not downloaded); judge colour against the room
(that is `map-look` and the person's walk). Nothing was run in the game.
