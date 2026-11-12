# A map from a drawing

A person draws the plan of a place, and the kit makes the map's brushes from it. The drawing says the shapes,
and the person makes them as they want: a square that is not square, a street that bends, a hall that is an
L, a yard with a well in it. The kit makes the walls follow them at any angle, seals the map, and writes a
`.map` that compiles, opens in J.A.C.K. and is walked by `map-reach`. It is the first draft, not the last:
the person or an agent dresses it afterwards (stairs, doors, props, light, the touch of its own).

It came from the study of the game's maps (`docs/MAPS-DESIGN.md`): their walls run off the grid and their
ground bends, and boxes carved from a script read as rooms. A drawing is the quickest way a person has to say
"this shape".

## The way

```
smak sketch village.svg -o village.map --legend legend.json --wad halflife.wad --plan village.png
smak map-compile village.map -o village.bsp --wad halflife.wad
smak map-reach village.bsp
```

`--plan` draws the map from above before any compile: look at it next to the drawing. `map-reach` says what
cannot be walked to (two shapes that were meant to meet and did not, a step too high between two floors).
`smak sketch` prints its warnings and one line of what it made; `--verbose` prints each space's floor and
ceiling as well.

## Drawing in Inkscape (recommended)

Inkscape is free (inkscape.org) and saves SVG, which the kit reads exactly: straight lines, curves and
circles as drawn, every shape with a name.

- **One unit of the drawing is one unit of the map.** Set the page in px (File → Document Properties) and draw
  at the map's size: a street 128 wide is 128 px. `--scale 2` makes the map twice the drawing.
- **The map's +y is up the page, and its y is minus the page's.** A point drawn at (x, y) of the page, after the
  transforms of the groups it is in, is (x, -y) of the map (times `--scale`). The page's top edge is the map's
  y = 0 and the drawing lies at negative y. It is not `height - y`: a script that places things by the page's
  height lands them a page's height off. A turned drawing's frame is `sketchFrame` (below).
- **A filled shape is a space.** Its fill colour may say what it is (the legend, below), or its label.
- **A line with a stroke and no fill is a corridor** as wide as its stroke: draw a street with the pen
  (Bezier) tool, set its stroke width to the street's width, and remove the fill.
- **A shape with a hole is a space round the hole**: select both, Path → Combine (Ctrl+K): a yard round a
  well, a road round a block.
- **The label says what it is.** Object → Object Properties → Label: `hall floor=0 ceiling=256 light=200`.
  The first word is its name; the others are keys.
- **A layer is a storey.** Name a layer `floor=128 height=192` and every shape in it stands at that height
  unless its own label says otherwise. Hide a layer (or label a shape `kind=skip`) to leave it out.
- Text is never read: write notes on the drawing as you like.

## Drawing in Paint

Any program that saves a PNG (Paint, Krita, Aseprite). Fill each kind of place with a flat colour; the
legend says what each colour is. White, black and any colour the legend does not name is rock, so **a black
line between two rooms is a wall**, and a gap in it is a door. One pixel is 8 units unless `--scale` says (a
picture 512 wide is a map 4096 wide). Draw without smoothing (Paint's fill and pencil do not smooth; a
brush with soft edges leaves colours the legend does not know, which are rock). Diagonal edges are
straightened; two colours painted side by side join.

## The keys

| Key | | |
| --- | --- | --- |
| `floor` | a height | The floor's height |
| `ceiling` | a height, or `sky` | The ceiling's height; `sky`: open to the sky (over every height in the drawing, with the sun) |
| `height` | units | The ceiling over the floor, in place of `ceiling` |
| `texture` | `NAME`, or `FLOOR,CEILING,WALL` | What its floor, ceiling and walls wear; what it does not name wears the map's (`--texture`) |
| `light` | brightness | A lamp in its middle, a little under its ceiling |
| `slope` | units | Its floor a ramp that climbs this much across it, from `floor` on its lowest side (keep it under 45 degrees to walk it) |
| `toward` | `east`, `north`, `west`, `south` or degrees | The way the slope climbs (0 east, 90 north) |
| `horizon` | units | The rock round the space stands this high over its floor, and over it the air is empty. Outdoors (`ceiling=sky`) so the place looks out over a land beyond and not up a cliff to the sky's height; on a room (a `height`) the rock over its ceiling is a roof of stone, `wall` thick at least, to the horizon, and air over that, so the massing seen from outside is roofs at the horizon and not a column to the sky plane. The sky is only the outer box: a slab over the whole drawing (128 over the highest roof, ceiling or `sky`) and four walls round it, so a thing standing on one roof is seen from another place; a room without `horizon` keeps its rock to the slab (give a door `horizon` too, or it stands as a column). One open volume over the whole site makes hlvis see across all the roofs: the visibility sets grow, and a big site may compile slower and draw more. Put it on the outdoor layer: `outdoors ceiling=sky horizon=320`. Where two spaces' horizons differ, the higher wins: a piece of rock goes only where it stands over the horizon of every space it faces, so the wall between a yard at `horizon=200` and a square at `horizon=352` stands 352 over the square's floor, seen from both. Rock that faces no space (the block behind the walls) goes over the lowest horizon of the drawing, and rock under a roof or a floor stays |
| `rough` | units | Its walls lined with rough rock standing out up to this much, where rock is behind them (not in its openings): a cave, a cliff. `cell` (48) is the size of the bumps |
| `cliff` | units | Outdoors: its rock made cliffs (`cliffWall`): leaning faceted pieces from the floor to the horizon and up to this much over it, the skyline uneven, where rock is behind them (not in its openings). `foot` (96) is how far out their feet stand at most. `cliff=0` on a narrow space (a lane, a ramp) leaves it without. `sketchMap`'s `clear` boxes keep the feet off houses and doorways |
| `sky` | units | Outdoors: room under the sky this high over the floor at least, for what stands tall (trees on cards, a tower). The sky is put over every height the sketch gives, the cliffs' tops among them, and 128 over that |
| `relief` | units | Its floor made ground that rises and falls (`reliefOf`): hummocks up to this high, a few men across (`bumps`, 640). It comes down level where the space opens into another and in `sketchMap`'s `clear` boxes. On a sloped space it makes the ramp a bank, not one flat sheet |
| `bank` | units | Its ground climbing this high towards the foot of its rock (a cliff's scree, a hollow's sides), three times as wide as high at least |
| `patch` | textures | Patches of another ground on its floor (one texture or several, `a,b`): triangles of its ground painted where a noise is highest, `patchShare` (0.15) of the floor in all, the way the game's maps break one ground with another. Gives the space a ground of triangles like `relief` |
| `color` | `r,g,b` | The lamp's colour |
| `kind` | `space`, `start`, `light`, `spiral`, `bridge`, `pool`, `skip` | `start`: a place for players to start at its middle (with `floor`, `yaw`); `light`: a lamp at its middle at `z`; `spiral`: a round shaft with a spiral stair from `floor` to `to` (`steps`: the steps' texture, `inner`, `rise` 16, `start` degrees, `turn` -1 for clockwise): wedges one rise thick round a column, reaching the shaft's wall; where a `door_` or a floor at `to` stands beside the shaft (within 64), the stair is turned to end facing it and a bridge 64 wide lands on its edge; where the storey over it has the same outline, the shaft opens into its floor; `bridge`: a line with a stroke, a bridge of the stroke's width with its deck's top at `z` (`piers`, `ground`); `pool`: a basin sunk in the floor of the space it is drawn in, with water (below); `skip`: left out |
| `depth` | units | A `pool`'s bottom this far under its space's floor (48); the rock under it follows |
| `water` | `!NAME` | A `pool`'s water: a `func_water` filling it to 8 under the floor, wearing this (a water texture starts with `!`; the legend's `water`, or `!water1`) |
| `rim` | units | A `pool`'s kerb, this high astride its edge, 16 wide (none unless told) |
| `dead` | `ok` | On a street (a space under the sky three times as long as wide, or a corridor): its blind end is meant. Otherwise the sketch warns of a street that ends in rock: a player walks down it to a wall |

A pool's `texture` (one name) is its walls' and its bottom's; the space's floor texture unless told. Its `floor=`
names the storey it is sunk in where storeys are stacked (the lowest otherwise).

The same keys come from three places, the later winning: the legend's `colours` (by the shape's fill, or a
corridor's stroke), the legend's `names` (by the first word of its label), and its label and its layers'.

## The legend

A JSON file, all of it optional for an SVG whose labels say everything, and needed for a PNG:

```json
{
  "scale": 8,
  "texture": { "floor": "OUT_GRND1", "ceiling": "sky", "wall": "OUT_WALL5" },
  "wall": 16,
  "wad": ["C:/Games/Half-Life/valve/halflife.wad"],
  "sun": { "yaw": 45, "pitch": -50, "brightness": 220 },
  "colours": {
    "#c8c8c8": { "name": "plaza", "floor": 0, "ceiling": "sky", "texture": "OUT_PAVE1,sky,OUT_WALL5" },
    "#8a6a40": { "name": "street", "floor": 0, "ceiling": "sky" },
    "#d06040": { "name": "house", "floor": 16, "height": 160, "light": 200 },
    "#00ff00": { "kind": "start", "floor": 0 }
  },
  "names": {
    "tavern": { "texture": "WOOD_FLR,WOOD_CEIL,WOOD_WALL", "light": 180 }
  }
}
```

## What it makes, and what it does not

- **The ground**: every space carved from one block of rock (`carvePlan`, `docs/MAPS-MAKING.md`), so the map
  cannot leak; walls along the outlines as drawn; spaces that overlap or touch join, and between two floors
  the step is whatever their heights differ by (16 a step, 18 the most a player walks up). Two spaces drawn
  touching are open to each other along the whole edge they share, as high as the lower of their ceilings (a
  portico open to its plaza, a gate hall open to its court). For a door between two rooms, draw them `wall` apart
  (the wall between them) and a `door_` shape across the gap, as wide and as high as the door.
- **A start** (each `kind=start`, or one in the first space), **lamps**, and **the sun** when a space is open
  to the sky.
- **Ramps, spiral stairs, bridges, pools and rough rock** where the keys ask (the rock in a `func_detail`, which
  does not cut the world for hlvis).
- **A warning** for what is drawn but will not play: a street that ends in a blind wall (`smak sketch` prints
  them as `WARN`; `sketchSpaces` gives them as `warnings`).
- **Not** straight stairs, doors, props or the map's other entities: put them in afterwards, by hand in
  J.A.C.K. (below) or from a script over the `.map` (`readMap`, then the kit's builders). A difference in
  height of more than 18 between two spaces that meet is a wall a player cannot climb: draw a ramp between
  them (`slope`), or give the spaces heights a step apart.

## Adding to it by hand, and drawing again

Open the `.map` in J.A.C.K., add what you like (doors, props, lights, details, whole rooms), and save it as a
`.map` (Valve 220) over the same file. Then change the drawing and run `smak sketch` again with the same
`-o`: what you added is kept. The kit keeps its own copy of what it wrote last (`<name>.smak.map`, beside
it) and keeps whatever is in your file and not in its copy, so a brush you added is kept whatever the editor
did to its numbers. What you took away or changed of the kit's own brushes comes back as the drawing says:
change those in the drawing. `--no-keep` starts afresh.
- Two outlines drawn almost touching (less than a unit apart) are taken as touching; a corner that turns less
  than a degree is made straight. The drawing is the plan, the kit tidies it as a mapper would.
- An edge whose ends lie within a unit of another space's longer edge, and that runs within 3 degrees of its
  way, is put on that edge's line (`carvePlan` welds them). A turned drawing needs it: each corner is turned and
  rounded to whole units on its own, so a door's end drawn on a room's wall lands a few tenths off it, and the
  walls of a row of rooms drawn on one line become planes a hair apart. Unwelded, the carve left a wedge of rock
  0.4 thick across a door (a lit line down its jamb), a wall 0.6 thick between two spaces drawn touching, and
  hlbsp's "Ambiguous leafnode content" where planes nearly met.

## A script over the drawing

A script that adds forms to a turned drawing (columns along a wall, a dome on a room) places them in the
drawing's own coordinates with the drawing's frame:

```js
const svg = readFileSync("plaza.svg", "utf8");
const f = maps.sketchFrame(svg); // a group rotate(-12 2200 1500): frame({ at: [2200, -1500, 0], yaw: 12 })
const { brushes } = f.place({ brushes: columns }); // columns drawn at page (x, y) as [x - 2200, -(y - 1500), z]
```

`sketchFrame(svgText, { scale })` reads the transforms of the groups round the drawing's first shape. A group
`rotate(a cx cy)` is `frame({ at: [cx, -cy, 0], yaw: -a })`, and a point drawn at (x, y) of the page before the
turn is `[x - cx, -(y - cy), z]` of the frame. Any other transform (a translate, a matrix, groups inside groups)
has its `at` where the page's (0, 0) lands, and the point (x, y) is `[x, -y, z]`. A transform that stretches or
skews is refused: a frame only turns and moves.
