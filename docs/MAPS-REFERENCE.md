# A place from a reference picture

The person gives a picture (a photo, a screenshot, a generator's image) and wants that place to walk in. This is the
method three places built so taught. It adds no command: it says in what order to use `docs/MAPS-MAKING.md` (read it
first: the builders' signatures, the compile), `docs/MATERIALS.md`, `docs/MODELS.md`, "Form", and `docs/SOLID.md`
(props), `docs/MAPS-CHECKS.md` (the battery), `docs/GODOT.md` (another engine), and what to look at between them.

The order is fixed: **the plan, the owner's answer, the fit on the source, the cameras, then rounds**. Each round ends
in one sheet of pictures looked at beside the reference. Nothing is built before the plan is approved.

## 1. Read the picture into a plan

Write `PLAN.md` beside the map's script, in the map's own folder (outside this kit). It holds six things.

**The place, as a table.** One unit is one inch; a player is 72 tall, the eye at 64, a door 64 wide, a step 18 at
most. Find in the picture something whose real size is known (a seat is 16 to 18 high, a table 30, a door 80, a
ceiling 120 to 200) and work outwards **by ratios inside one plane**: a pillar's height over its width, an opening's
width over its height. A size carried across depth (by the floor line) differs each way it is taken.

| what | in the picture | in the map (units) |
| --- | --- | --- |
| the hall | a long room seen from one end, the window wall at the far end | 640 wide x 896 deep x 176 high |
| the window | two rows of four panes with rounded corners in a riveted frame | each 112 x 72, members 24, sill at 40 |

One row for each thing a player will look at, the far things too (what is beyond the glass, the skyline). Where the
picture's viewpoint stands goes under the table: it is the first camera. **Add the numbers up: the writer before
sending the plan, the builder again before the first brush** (two rows of 72 with members of 24 over a sill of 40
are 232 and do not fit a hall of 176). An approved plan can still hold such a sum: the builder mends it in the plan
(a dated list at its end: the plan's number, the built one, why), not silently in the script.

**Spaces seen through one another** (a hall, an atrium through its opening, a corridor's mouth beside it): the wall
they are seen through is the ruler. Its landmarks' places across the picture (a pillar's sides, a pier, each mouth)
give its widths by their ratios; what shows through each opening (a stair's foot, a banner, a balcony's edge) says
where the next space lies behind it and how deep. The fit (section 3) proves these or mends them.

**The light, in words a picture can be held to.** What is the brightest thing and what colour it is; how dark the
rest is; where the pools are and what makes each; which lights are coloured. "Dark overall; the window wall the
brightest thing, and teal; pools under each tube and on the table tops; one purple strip top right." Not "moody".

**Where each thing comes from**, said for each: *materials* from the photographed libraries (`packs/materials`; a
sign or a surface that gives light is a picture of your own, section 4); *made with the kit's solids* (profiles
swept, lathes, lofts, `packs/solid` for cuts: most of the furniture); *scanned props* (`packs/assets`: small real
things; search before promising one, the library had no fridge, no locker and no modern sofa).

**What will not be reached, said before the owner finds it**: reflections on a wet floor, a painted poster, haze.
**How it is judged**: the cameras, the checks, and where the owner walks it (their game, or another engine).

**What the owner is asked**: two or three questions that change the build, each with its sides stated. Its own map
or joined to another? Judged in the game or in another engine? Still things or moving? The answer is copied into the
plan in the owner's words, with the date, and the plan's status line says "approved". Until then: no brush, no model.

## 2. Several pictures of a style, not one picture of one place

Four screenshots of a city show different corners and mostly skyline: the plan must **say where the place ends**.

- **Give each picture a job**, in a table: one is *the place itself* (its viewpoint is the `ref` camera, `map-look`
  is run against it); the others *give pieces* (a corner, a tower's face, the lamps' palette) and get a camera only
  if the plan builds their corner.
- **Draw the edge**: the walked area in units (a room is 480 to 900 across) and its levels; how each side is closed
  (a gate, a tunnel mouth); what is seen beyond and never reached. `smak map-compare` lays the source beside a map
  of the game's at one scale. Open air: `sky` on the far sides and the top, a `--seen` box for the battery, and
  `smak check-pvs` each round.
- **What is behind the camera and between the pictures' corners is yours to invent.** It cannot be checked against
  anything: say in the plan what was invented, so the owner refuses it there and not after the walk.
- **A style is a palette and a set of shapes**: read off the few things that repeat (thin saturated strips, dark
  faces, posters the brightest things) and hold every corner to them. **Copy nothing** of the reference's: no mesh,
  texture or poster art. **A thing repeated is one model**: compare it with its crop once, then look at the row.

## 3. The fit on the source, then fixed cameras

`map-view`, `map-look` and `maps.drawSource` take a `.map` as they take a `.bsp`: flat colours, no light, **no
compile**. So write the shell first (rooms, openings, the big things) and fit the `ref` camera on it. `smak map-look
out/place.map --ref reference.png -o out/fit.png --from x,y,z --yaw n --pitch n --fov n` lays the two side by side;
one over the other shows the edges better (`crop`, `ref`, `W`, `H`: the sheet's, below; `W` by `H` in the reference's shape):

```js
const view = maps.drawSource(map, { from: [208, 84, 50], yaw: 91, pitch: 9, fov: 96, width: W, height: H }), over = crop(ref, null);
for (let i = 0; i < view.rgba.length; i++) view.rgba[i] = i % 4 === 3 ? 255 : Math.min(255, over.rgba[i] * 0.9 + view.rgba[i] * 0.45);
writeFileSync("out/fit.png", png(W, H, view.rgba));
```

- **Move the camera until the room's edges fall where the reference's do.** A generator's or a photographer's camera
  is seldom a player's: eyes at 50 and 80 and fields of 74, 90 and 96 were fitted. The other cameras stand at 64.
- **The fit corrects the plan as much as the camera.** When no camera puts every edge right, a number is wrong (an
  opening too wide, a thing too far from its neighbour): mend it in the plan and fit again; one place took seven
  tries and no build. Where the picture fits no single camera (section 9), fit the far wall and the floor line.
- **Then write every camera down once, in the script, and never move them**: after the fit, since mending the plan
  moves what the others look at; before the first compile, since rounds are laid side by side from the same places.

```js
// [name, from, yaw, pitch, fov, the reference's piece it answers (x0, y0, x1, y1 in its pixels; null: all of it; false: none)]
export const CAMERAS = [
  ["ref", "40,-196,80", 109, -6, 90, null],              // the reference's own viewpoint, as fitted
  ["sofa", "-150,-40,64", 200, -12, 80, [20, 180, 470, 560]],
  ["back", "60,-110,64", 300, -10, 80, false],           // what the reference does not show: invented, no piece
];
```

- **Five or six**: the reference's viewpoint; one square on to a wall from 64 away (texel density shows only
  there); the floor at the feet; one close on the main prop; one of the far side; with several references, one a
  picture whose corner is built. Cameras the plan names are the owner's and stay: add the wall camera to them.
- Draw each with `smak map-view <bsp> -o out/<tag>-<name>.png --from x,y,z --yaw n --pitch n --fov n --width 960
  --height 540 --entities game --no-labels --game <folder of your .wad and models/> --game <mod> --game <valve>`.
- Run `smak map-look <bsp> --ref reference.png -o out/<tag>-look.png` from the `ref` camera with the same `--game`
  (`--ignore x0,y0,x1,y1`: a HUD in the reference) and keep its text (`docs/MAPS-LOOKING.md` says what it measures).

### The sheet of a round

One picture: a row a camera; across, **the reference's piece, the round before, this round**. The kit has no command
that crops a picture, and `tile` garbles pictures of different sizes, silently. So a round's script (`node round.mjs
b2 b1`; a first build has none before it) carries this:

```js
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { unpng, png, tile, maps } from "file:///C:/path/to/smak/src/index.mjs";
import { CAMERAS, map } from "./place.mjs";
const W = 480, H = 270, [tag, before] = process.argv.slice(2);
/** A piece of a picture ([x0, y0, x1, y1]; null: all of it) fitted into W x H, averaged where it shrinks; no picture: a dark tile. */
function crop(im, box) {
  const [x0, y0, x1, y1] = box ?? [0, 0, im?.width ?? W, im?.height ?? H], out = { width: W, height: H, rgba: new Uint8Array(W * H * 4) };
  const k = Math.min(W / (x1 - x0), H / (y1 - y0)), ox = (W - (x1 - x0) * k) / 2, oy = (H - (y1 - y0) * k) / 2, n = Math.max(1, Math.round(1 / k));
  const at = (fx, fy, q) => im.rgba[(Math.min(im.height - 1, Math.floor(fy)) * im.width + Math.min(im.width - 1, Math.floor(fx))) * 4 + q];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const fx = x0 + (x - ox) / k, fy = y0 + (y - oy) / k, inside = im && fx >= x0 && fx < x1 && fy >= y0 && fy < y1, c = inside ? [0, 0, 0, 255] : [24, 24, 28, 255];
    if (inside) for (let q = 0; q < 3; q++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) c[q] += at(fx + i / k / n, fy + j / k / n, q) / (n * n);
    out.rgba.set(c, (y * W + x) * 4);
  }
  return out;
}
/** The mean colour of a box of a picture: a tone read off the reference (section 4). */
const meanOf = (im, [x0, y0, x1, y1], m = [0, 0, 0]) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) m[c] += im.rgba[(y * im.width + x) * 4 + c];
  return m.map((v) => Math.round(v / ((x1 - x0) * (y1 - y0))));
};
const shot = (file) => (existsSync(file) ? unpng(readFileSync(file)) : null);
const ref = shot("references/place.png"), tiles = [], names = []; // a JPEG: unjpeg gives { width, height, rgb }, no alpha
for (const [cam, , , , , box] of CAMERAS) {
  tiles.push(crop(box === false ? null : ref, box || null), crop(shot(`out/${before}-${cam}.png`), null), crop(shot(`out/${tag}-${cam}.png`), null));
  names.push(box === false ? `no reference: ${cam} is invented` : `reference: ${cam}`, before ? `${before}: ${cam}` : "no build before", `${tag}: ${cam}`);
}
const sheet = tile(tiles, 3, names);
writeFileSync(`out/round-${tag}.png`, png(sheet.width, sheet.height, sheet.rgba));
```

A sheet holds the reference, which is not yours to share: keep it in `out/`, with `references/` and `out/` in the
folder's `.gitignore`, and never in this kit (AGENTS.md rule 7).

**Every prop beside its own crop**, before it stands in the map: `smak sheet <mdl>` or `render --yaw --pitch` from
about the reference's angle, laid beside the reference's piece by the same `crop` and `tile`. A sofa right as "a
sofa" and wrong as *that* sofa is the commonest miss, and the room's cameras are too far away to show it.

### What to look at, in this order

1. **Silhouette and size before anything.** Squint: do the big shapes fall where the reference's do, at its sizes
   against the player? Fix these first, and the plan's table when its number was the fault: texture work on a wrong
   silhouette is thrown away, and `map-look` saying "close" on every line of one is still a wrong room.
2. **The brightest thing.** Is it the same thing as in the reference, in the same colour? Then the pools: where,
   and how dark between them. `map-look`'s brightness and contrast lines say how far off (section 6).
3. **The palette.** `map-look`'s colours line names the two hues that differ most. A hue the reference has not (a
   blue wall in a teal room) is a material to tone (section 4).
4. **Marks and detail last**: seams, rivets, grime, small props, and each material up close from the wall camera.

## 4. Materials, toned to the picture

Choose by looking, never by a search's words: `node packs/materials/bin.mjs search <words> --sheet candidates.png`
draws the candidates flat with their mean colour; take photographed ones near the picture's palette already.

**Paint or lamps?** Decide first what gives the picture its colour. Where it is paint (a teal room under white
tubes), do not leave a material its own colour and expect the light to bring the room's: a room that tried lost its
palette (teal from 49% of the view to 24%). **Measure tones off the picture** and tone to them, as below. Where it is
coloured lamps on grey (a concrete hall under neon), toning each wall to its patch paints a magenta pillar: read each
patch where the light is most neutral, keep the textures near grey, and let the lamps carry the colour (section 6).

1. Read the mean colour of each surface's patch of the reference (`meanOf` above): the wall, the floor in a pool and
   out of one, the upholstery, the wood. Write them in the plan, by name.
2. `material <id> --name <tex> --size 512 -o tex --tone r,g,b --final --chroma 0.6` (`docs/MATERIALS.md`). Without
   `--final` grime and streaks leave the texture 10 to 15% darker than asked; without `--chroma` a pale green paint
   toned teal comes out a loud blue. `--shift dx,dy` and `--mirror` put the material's seams on the room's lines.
3. The patch is texture times light, so the texture is lighter than it: in a dark picture start at about twice the
   patch (a patch of 45,47,44, a concrete of 88,88,84) and let `map-look` say which way to move. A room that reads
   too dark with the lamps right wants lighter tones, not more lamps.

A `WARN` on mean brightness (under 31, over 161) is real for a wall and meant for a lamp's face (`~name`) or a dark
lining: say which. **Texels to the unit** (`docs/MATERIALS.md`): `scale: 0.5` for what a player stands next to
(floors, walls to 2 m up), `scale: 1` for ceilings and what is far; 512 for floors and walls, 256 the rest. Before
sizing a tiled floor look at its sheet: `search` gives the tile's metres, not how many slabs it holds.

**A sign, a lit panel, a painted number** is a picture your script draws (the kit draws no text but `label`'s 5 x 7
blocks: a stroke font is a helper for KIT-FAULTS) and saves as `<name>.png` **in the folder `material` wrote to**:
`wadOfFolder` (`docs/MATERIALS.md`, "In a map's script") puts every PNG there in the `.wad`. Both sides multiples of
16, a name of at most 15 letters, `~name` for one that gives light (`docs/MAPS-MAKING.md`, "A .wad of your own"). It
goes whole on a thin plate of its own shape, `box(min, max, fitted("~pl_sign", [384, 144], min, max, { whole: true,
faces: ["east"], rest: "pl_steel" }))` (384 x 144 texels on 192 x 72 units), in a frame; `textureLights` makes it
shine. Its words are your own; with no `.set` it has no relief in the lit `.glb`.

## 5. Form

AGENTS.md rule 9 holds here more than anywhere: a reference is full of curves and a box in it shows at once.

| The thing | Made with |
| --- | --- |
| A long thing with a section: a rail, a pipe on hangers, a cornice, a window's frame, a canopy's edge | `maps.sweepProfile`, `maps.extrudeProfile` (brushes); `solids.sweepTris`, `extrudeTris` (a model) |
| A turned thing: a lamp post, a bollard, a stool, a ring sign | `solids.lathe` |
| A shell whose section changes: a curved sofa, a tub chair, a machine's rounded front | `solids.sweepTris` with `profile` a function `(i, u, s, total)`; `solids.loft` for stacked rings |
| A box people look at | `maps.box(..., { bevel, edges })`, `maps.roundedBox`; `solids.box(..., { bevel, cut, taper })` |
| A hole, a slot, a window with rounded corners, a pocket | `packs/solid` (`minus`, `roundedRect`); the cutter wears the texture the cut shows |

**Measure it where it is.** Furniture in a `func_detail` is world in a `.bsp`, so each measure has its file:

| Asked of | It measures | Mind |
| --- | --- | --- |
| `smak form out/place.map` | the detail and entity brushes: bare boxes, square edges; the world's face area off the axes | That last counts every face of `carve`'s rock, the hidden ones too: on a carved map it reads near 0% whatever is built. Quote it with the compiled figure beside it |
| `smak map-dressing <bsp> --game ...` | the compiled world beside Valve's own: faces off the axes, and the dressing | Its `faces at texture scale 1` WARN stands on a map laid at 0.5 on purpose; its `world planes a 256 x 256 of floor` rises with the chamfers `form` asks for. Quote both, with why they stand |
| `smak form <bsp>` | brush entities alone (a grating, a door) | One slab there reads 100% and warns three times: say what it is |
| `smak form <mdl>` | each model | Flat by nature (a table top, a thin leaf): answer the WARN where a change helps (tapered legs, a bevel), else say it is a slab and judge it against its crop. Do not hide the line |

- **A curved thing or a vehicle is a model, not brushes**: brushes are for the room and its frames and counters.
- A prop not yet made leaves its place **empty**, not filled with a box: an empty place is seen as missing, a box
  is taken for the answer. A space that is all props (a stall's room seen through its windows) is a lit box when
  empty: line it in a plain material (planks lit warm read as a boarded window) and report it as unfinished.
- Limits that cost a compile or a round: a brush face of more than 28 points (`checkPlan` says it; build a round
  floor as quarters); a model over 12000 triangles is not drawn as itself in the kit's views (they say so); a model
  whose origin is inside a brush may not be drawn; GoldSrc lights a whole model from one sample under its origin, so
  a long wall of slats is several models, each lit at its own foot.

## 6. The baked light

`docs/MAPS-MAKING.md`, "Light", has the entities and no word on how bright. These are **one map's numbers** (three
spaces, ceilings of 140 to 420, textures of a mean of 60 to 100, sdHLRAD), found in three of its six builds: start
from them and let `map-look` move them.

| The light | Made with | Brightness that held |
| --- | --- | --- |
| A room's fill, where the picture is dim and not black | `light`s in mid-air, in the picture's ambient colour | 130 to 300 each where little else lights the room; 35 to 60 where signs and pools already do |
| A lamp that is seen: a tube, a strip, a warm fitting | its face (`~name`) in `textureLights`, and a `light` 20 to 35 under it for its pool | the face 2500 to 6000 (faces of 700 to 2000 square units); the `light` 110 to 300 |
| A sign, a poster, a lit window | its face in `textureLights` | 500 to 1400 (faces of 1500 to 14000 square units); 30 to 60 for one that only glows |
| A pool of colour on the floor, where the picture has a reflection | a `light` of the sign's colour before it, 32 to 48 over the floor | 125 to 200 |

- **A baked floor reflects nothing**: the low coloured `light` stands in for a wet floor's reflection (the lit
  `.glb` may want it out). **Read `map-look`'s brightness line first**: "near black 61% against the reference's
  30%" on a first build was fill missing, not textures too dark; fills and pools brought it to 34%.
- **The full compile**: `compileMap(file, { wads, args: { hlrad: ["-extra", "-bounce", 8] } })`, and for a map of
  Xash's alone `engine: "xash", format: "bsp2"` beside them (`docs/MAPS-MAKING.md`, "What it needs"). A draft
  (`fast: true`) bounces no light and reads darker: it is for shape. Where the full compile takes seconds, skip it.
- **The log** is not a file: `compileMap` returns `logs`. Write it for the battery's `--log`:
  `writeFileSync("out/compile.log", result.logs.map((l) => l.tool + " " + l.args.join(" ") + "\n" + l.text).join("\n"))`.
- **The light check wants rooms**: `--rooms rooms.json`, `{ "hall": { "min": [x, y, z], "max": [x, y, z] } }`, written
  by the script from its own spaces, each from its floor - 8 to its floor + 80 (`docs/MAPS-CHECKS.md`); without it
  the check is of dark patches. Floor in no box is `elsewhere`, with no place given: if it still warns, quote it.

## 7. The other engine

`node packs/godot/bin.mjs project <bsp> -o godot --game out --game <mod> --game <valve> --sets out/tex --shot
name=x,y,z,yaw,pitch` writes the map as two `.glb` and a Godot project that walks and takes shots from the same
`CAMERAS`: the sheet's fourth column (`docs/GODOT.md`; the files alone: `packs/gltf`'s `map-gltf`, `docs/GLTF.md`).
The first `--game` is the folder your `.wad` lies in, with `models/` under it; `--sets` the one `material -o` wrote.
**Baked** is the game's light as compiled. **Lit** leaves the lightmaps out for the engine's lamps and gives each
surface its set's relief and shine: varnish, gold and a wet floor read only this way.

- glTF carries none of what the lit way needs **set in the engine** (the project sets the first four): the ambient,
  a reflection probe a room, the tonemap (chosen once and written down), every lamp's shadow on (else lamps shine
  through walls), large glowing faces turned down.
- It makes lamps of a map's **32 brightest texture-light cells, for the whole file**; the rest only glow. Put a
  `light` in the map where a pool is wanted (every `light` becomes a lamp), and say what was lost.
- **Rooms joined into one file** share those lamps, the shadow atlas and one ambient, and the kit's views cannot
  show it: lay each room's shot in the joined scene beside its own approved shot in that engine, from the same
  camera (`docs/GODOT.md`, "What joining rooms taught", has what mended it).

## 8. Rounds

- **A budget of builds, stated at the start and reported at the end**: "round 1, six builds" in the plan or the
  task. A build is a compile whose pictures are looked at, a draft too; a view of the source is none. A first round
  took 6; a round of form took 18, nine of them chasing one warning. Over budget, stop and say what is left.
- **A round has one aim** (the shell and light; the props' form; the materials) and changes nothing else, so the
  sheet shows that aim alone. Geometry before materials: a retexture round keeps every brush and camera.
- **Each build**: the script from nothing (never from the last output), `checkPlan`, the compile and its log
  (section 6), `smak map-battery <bsp> --map <map> --rooms rooms.json --log compile.log --game ... -o out` (`--seen
  x0,y0,z0,x1,y1,z1` for space behind glass or beyond the edge), the cameras, `map-look`, section 5's measures, the
  sheet. The battery takes a handrail's top for floor reached only by a jump: quote it and say what it is.
- **One author to a map**, start to end. A worker takes a piece whose result fits in one picture: a model beside its
  crop, a material's sheet. Before joining two authors' rooms, check each copy still writes its own `.map` to the byte.
- **The manager looks at the pictures; the worker's report quotes every `WARN`** as the kit gave it, with what was
  done or why it stands (AGENTS.md, "Handing work to another agent"), the builds used, and the sheet first.
- **A fault of the kit goes into the map's own `KIT-FAULTS.md`**, not round it in silence: a numbered table of *what
  was asked, what was got, what was done instead*; a helper written because the kit lacks something is one.

## 9. What the method does not give

- **The kit's pictures are not the game.** They draw no fog and no reflections, and glass at a low render amount
  barely shows: haze, a wet floor and how bright a model sits beside a wall are judged in the game or the other
  engine, by the person. Say what was not seen there. And the stock GoldSrc and Xash renderers show only the baked
  way: a verdict given on the lit `.glb` in another engine is not one on the game.
- **A generated picture is not a buildable place**: its perspective bends (one thing may fit no camera that fits
  the rest: say which), its counts do not add up, things merge. The plan's table is the place.
- **`map-look` measures light and colour, `form` and `map-dressing` boxiness, the battery walkability. None measures
  likeness.** That is the sheet, and the eye of whoever looks at it; the last word is the owner's walk.
- **Painted art** (a poster's figure, a mural) is not made here: a picture drawn by a program reads as one. Letters,
  arrows and plain shapes on a lit sign do hold (section 4).
