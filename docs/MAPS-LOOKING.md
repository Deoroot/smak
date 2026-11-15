# Looking at a map, and changing its entities

A compiled map read, checked and drawn, and its entities changed with no compile. The walk test is
`docs/MAPS-CHECKS.md`; a new map `docs/MAPS-MAKING.md`; every function that reads a compiled map, and every
option of its pictures, `docs/MAPS.md`.

## What a map is

A map is three kinds of file. Its **source** (`.map`) is text: brushes (convex solids) and entities (a light, a
door, a place to start). The **compiled map** (`.bsp`) is what the game loads: the brushes cut into faces, with
the light baked onto them and what is seen from where worked out, and the entities as text inside it. Its
**textures** are named in both and kept in `.wad` files, unless they were put inside the `.bsp`. Units are the
models': about an inch, `+z` up; on a plan `+x` is east and `+y` north. `docs/MAPS.md` and `docs/MAPS-MAKING.md`
hold the vocabulary; in a script, `import { maps, png } from "./smak/src/index.mjs"`.

The loop is the models' loop: look at what is there, change it in a script or with a command, check it, **draw
it and look at the picture**. Never write over a map of the game's: write a new file.

## Looking at a map

```
node bin/smak.mjs map-info gatecity.bsp                          what is in it
node bin/smak.mjs map-check gatecity.bsp --game <mod> --game <valve>   would the engine take it; are its .wad files there
node bin/smak.mjs map-check gatecity.bsp --mod <profile> --game <mod> --game <valve>   and would the mod: its entities, names, rules, files
node bin/smak.mjs map-plan gatecity.bsp -o plan.png              from above: where everything IS
node bin/smak.mjs map-views gatecity.bsp -o views.png            from each start and the largest rooms
node bin/smak.mjs map-view gatecity.bsp -o v.png --from -191,-802,-433 --yaw 90
```

- **The plan is the picture to find things by.** `+y` is up it and `+x` to its right. Every point entity is a
  dot (places to start, lights, monsters and the rest each in a colour), every brush entity an outline, each
  with its number, the one `map-entities` and `map-set` go by. The command prints each mark's pixel (`--list`
  for a big map). A big map labels only its starts: `--area x0,y0,x1,y1` draws a part closer.
- **A view is taken from a point inside** (`--from`, with `--yaw` 0 along `+x`, 90 along `+y`), or from an entity
  (`--at 12`, `--at info_player_start`). A start is looked from at a player's eye height. Read what the command
  prints under the picture's line: an eye "in solid" is inside a wall or outside the map.
- **The light is the map's own**, baked by its compiler, at about the brightness the game shows. A dark picture
  is a dark place (the line says so): `--brightness 4` looks into it, `--no-light` shows the textures alone.
- **What stands is drawn at its true size.** A place to start, a monster and an NPC are the box they move
  with (32 x 32 x 72; `--body name=large` for 64 x 64 x 64): in a view a box that stands on the floor, hangs
  over it or goes into it; on a plan its outline. `--models` (with `--game`) draws a prop that names its
  `.mdl` as that model, with its textures, in the `body`, `skin`, `sequence`, `scale` and `angles` its
  entity gives; a masked texture's holes are open, so a tree's crown hides what the game's hides and no
  more. A monster's own comes from its script: `--mod <profile>` with `--models` draws it where the
  profile can read it (`modelOf`), and `--model name=models/x.mdl` names one by hand. A door is
  drawn shut.
- **With `--game`, the sky is the map's own** (`skyname`: the six pictures of `gfx/env`) **and a sprite is
  drawn** (`env_sprite`, `env_glow`: its first frame at its `scale`, blended by its render mode; a small
  cross on a plan). `--entities game --no-labels` draws only what the game shows, with no boxes: the picture
  to lay beside a screenshot. A `{` texture has its holes only on an entity in render mode 4, as in the game:
  a view that says `N faces wear a \`{\` texture ... the game draws their holes filled` has found a fence
  with no `rendermode`.
- **One plan is one height.** `map-plan --heights` writes each floor's height on it; `map-storeys` lays a
  plan for each storey side by side; `map-section --from x,y --to x,y` cuts the map upright along a line: the
  picture for a cellar under a terrace, a stair, a ceiling's height, a thing sunk in the floor.
- **`map-reach` walks the map**, the walk test: `docs/MAPS-CHECKS.md`, "The walk test: running it".
- **A crowded plan** writes an entity's number alone where its label has no room: `--legend` lists every
  number with its class beside the plan.
- A face in one flat colour is a texture that was not found: `--game` the mod's folder and `valve`, or `--wad`.
- In a script: `maps.planOf(bsp, { z, area })`, `maps.drawMap(bsp, { from, yaw })`, `maps.viewsOf(bsp)`,
  `maps.sectionOf(bsp, { from, to })`, `maps.storeysOf(bsp)`, `maps.openingViews(bsp)`, each giving `{ width,
  height, rgba, facts }`, and `maps.reachOf(bsp)` (`{ warnings, facts, entities, openings ... }`);
  `maps.contentsAt(bsp, point)`, `maps.floorUnder` and `maps.restOf(maps.spaceOf(bsp), feet)` answer "is this
  spot open, and does a body fit" before you put something there (`docs/MAPS.md`).

## A view against its reference

When a scene is built from a picture (a photo, an image from a generator), lay the map's view beside it:

```
node bin/smak.mjs map-look plaza.bsp --ref messhall.png -o look.png --from 1613,-1625,64 --yaw 12 --game <mod> --game <valve> --ignore 410,0,615,85
```

The sheet has the reference (its `--ignore` boxes dimmed) and the view at one size (the view drawn at the
reference's shape, 640 wide unless `--width`; only what the game shows, no entity labels), each one's main
colours as a bar and its numbers under it, and one line a measure under both, which the command also prints:

- **brightness**: the mean luma, 0 to 1, with the share near black (under 0.1) and near white (over 0.9).
- **contrast**: (p90 - p10) / (p90 + p10) of the mean light of the picture's regions (16 across): 0 is evenly lit,
  near 1 pools of light in the dark.
- **coloured**: the share that is not grey (HSV saturation a quarter or more); **colours**: each hue's share
  (red, orange, yellow, green, teal, blue, purple, pink; and black, grey, white), the two that differ most said
  ("the reference is 46% teal, the view 0%").
- **warmth**: (red - blue) / (red + blue) over the picture: + warm, - cool.

Contrast, colour and warmth are ratios: a darker copy of a picture differs from it in brightness alone. A gap
under `LOOK_CLOSE` is said "close". **These are facts, never a verdict**: a style is chosen. What they rest on
(2026-11-14):

- The light bench's two lightings of one street (point lights, texture lights), which the owner called "both fine,
  little difference", from four matching cameras, differ by up to: brightness 0.05, contrast 0.12, coloured 0.17,
  a hue 0.17, warmth 0.09, and near black 15 to 20 points (the bench's floors sit at that line, so near black is a
  number in the brightness line, not a gap of its own). `LOOK_CLOSE` is set just over these: the bench reads close
  by construction.
- The plaza's two variants, from seven matching cameras (the square three ways, a street, a court and two
  rooms): the hand-made one, whose ambience the owner found a little better, is darker on six and
  more contrasted (pools of light) on four, the other three close; never less contrasted. Warmth parts on four
  cameras, coloured and colours on two, the kit's variant the warmer and more coloured: no verdict of the owner's
  speaks of colour, so those lines are not validated, only measured. This is thin evidence: two maps, one person.
- The kit's view against the game's own screenshot from the same place was **not measured**: a gap near
  `LOOK_CLOSE` may be the kit's renderer and not the map.

In a script: `maps.lookOf(picture, { ignore })`, `maps.lookAgainst(viewLook, referenceLook)` (`{ said, gaps,
measures }`), `maps.lookSheet(view, reference, { ignore })`, `maps.pictureOf(bytes)` for a PNG or JPEG.

**A picture that is not the kit's** (another engine's shot, the game's screenshot) goes in the map's place:
`smak map-look shot.png --ref reference.png -o look.png` measures it as a view.

**Pictures side by side, a piece of one, one over another.** `maps.pictureSheet(items, { cols, width, height })` lays
pictures of any sizes in one sheet, each fitted whole into a cell (480 x 270 unless told) with its name. An item is a
picture (`{ width, height, rgba }`, or a PNG's or JPEG's bytes), `null` (a dark cell: no reference, no build before),
or `{ picture, crop: [x0, y0, x1, y1], over, opacity, name }`: `crop` a piece of it in its pixels, `over` another item
laid over it at `opacity` (0.5). A round's sheet is a row a camera (the reference's piece, the round before, this
round), `cols: 3`; a camera is fitted with one item, the view with the reference `over` it, `cols: 1`. The command:
`smak pictures view.png --over reference.png --opacity 0.6 --cols 1 -o fit.png`, `smak pictures a.png b.jpg -o
sheet.png --crop all --crop 20,180,470,560`.

## Changing what is in a compiled map

Entities are read by the game when the map starts, so they can be changed with no compile:

```
node bin/smak.mjs map-entities gatecity.bsp --class ms_player_spawn        their numbers and keys
node bin/smak.mjs map-set gatecity.bsp -o work/gatecity.bsp --entity 266 --move -688,-3300,-330 "angles=0 90 0"
node bin/smak.mjs map-set gatecity.bsp -o work/gatecity.bsp --add monster_zombie --at 96,300,36 "angles=0 180 0"
node bin/smak.mjs map-set gatecity.bsp -o work/gatecity.bsp --entity 24 speed=40      a door's speed
node bin/smak.mjs map-plan work/gatecity.bsp -o plan.png                              the dot has moved: look
```

- One change a command, each from the file the last one wrote when several are wanted; in a script
  (`maps.moveEntity`, `setKey`, `addEntity`, `removeEntity`, then `maps.withEntities(bytes, entities)`) any
  number at once, from the original.
- **What takes effect**: where things and monsters stand and face, what they are, their keys, targets and
  scripts. A point entity's origin is its middle: a player's or a monster's is 36 over the floor for a
  standing one (`maps.floorUnder(bsp, point, { hull: 1 })`).
- **What does not, without a recompile from the source**: light (a `light` entity added or moved lights
  nothing: the light is baked into the faces), the brushes (a wall, a door's shape), what is seen from where,
  and collision. A brush entity cannot be added or taken out; it can be shifted (`origin`), hidden
  (`rendermode=2 renderamt=0`) or have its keys changed. The command says so in its last line every time.
- A new class the mod does not know does nothing; a monster whose model the game has not loaded on that map
  may be refused (AGENTS.md, rule 8). Look at how the map's own entities of that kind are written, and copy their keys.
