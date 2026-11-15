# A place from a reference picture

The person gives a picture (a photo, a screenshot, an image from a generator) and wants that place to walk in. Two
rooms were built this way, a mess hall and a lounge, each from one picture, then joined by a lift, and their owner
judged them very good. This guide is the method that got there. It adds no command: it says in what order to use
`docs/MAPS-MAKING.md` (brushes, the compile), `docs/MATERIALS.md` (textures), `docs/MODELS.md`, "Form", and
`docs/SOLID.md` (props), `docs/MAPS-CHECKS.md` (the battery) and `docs/GLTF.md` (another engine), and what to look at
between them.

The order is fixed: **the plan, the owner's answer, the cameras, then rounds**. Each round ends in one sheet of
pictures looked at beside the reference. Nothing is built before the plan is approved.

## 1. Read the picture into a plan

Write `PLAN.md` beside the map's script, in the map's own folder (outside this kit). It holds six things.

**The place, as a table.** One unit is one inch; a player is 72 tall, the eye at 64, a door 64 wide, a step 18 at
most. Size everything from that: find in the picture something whose real size is known (a seat is 16 to 18 high, a
table 30, a door 80, a room's ceiling 120 to 200) and work outwards.

| what | in the picture | in the map (units) |
| --- | --- | --- |
| the hall | a long room seen from one end, the window wall at the far end | 640 wide x 896 deep x 176 high |
| the tables | three rows down the middle, a bench each side | table 72 x 36 x 30, bench 72 x 14 x 18, rows 150 apart |
| the window | two rows of four panes with rounded corners in a riveted frame | each 112 x 72, members 24, sill at 40 |

One row for each thing a player will look at, the far things too (what is beyond the glass, the skyline). Where the
picture's viewpoint stands goes under the table ("just inside the door, looking at the window wall"): it is the first
camera. Add the numbers up before sending the plan: a window wall of two rows of 72 with members of 24 over a sill of
40 is 232 high and does not fit a hall of 176, and such a fault costs a round.

**The light, in words a picture can be held to.** What is the brightest thing and what colour it is; how dark the
rest is; where the pools are and what makes each; which lights are coloured. "Dark overall; the window wall the
brightest thing, and teal; pools under each tube and on the table tops; one purple strip top right." Not "moody".

**Where each thing comes from.** Three sources, said for each thing:
- *Materials* from the photographed libraries (`packs/materials`, `docs/MATERIALS.md`): walls, floors, wood, cloth,
  metal. A surface that gives light, or a sign, is a texture of your own with a lit part.
- *Made with the kit's solids* (profiles swept, lathes, lofts, `packs/solid` for cuts): everything shaped that the
  libraries lack. Assume most of the furniture is this.
- *Scanned props* (`packs/assets`, `docs/ASSETS.md`): small real things (a crate, an extinguisher, a barrel). Search
  before promising one: the library had no fridge, no locker and no modern sofa.

**What will not be reached, said before the owner finds it**: reflections on a wet floor, a painted poster, haze.

**How it is judged**: the cameras (section 3), the checks, and where the owner walks it (their game, or another
engine from the `.glb`).

**What the owner is asked**: two or three questions that change the build, each with its sides stated. Its own map
or joined to another? Judged in the game or in another engine? Still things or moving? The answer is copied into the
plan in the owner's words, with the date, and the plan's status line says "approved". Until then: no brush, no model.

## 2. Several pictures of a style, not one picture of one place

One picture of one closed room fixes the room's size, its things and its light. Four screenshots of a city do not:
they show different corners and most of what is in them is skyline. The plan then has to do what the pictures do
not, and **say where the place ends**.

- **Give each picture a job**, in a table: one is *the place itself* (its viewpoint becomes the `ref` camera and
  `map-look` is run against it); the others *give pieces* (a second corner, a tower's face, how decks and stairs
  stack, the palette of the lamps). A picture that gives pieces gets a camera only if the plan builds its corner.
- **Draw the edge.** The walked area in units, beside a known one (a room is 480 to 900 across), and on how many
  levels. Then how each side is closed (a gate, a tunnel mouth, a building's face) and what is seen beyond and never
  reached (a ring of plain tower shapes, a far deck). `smak map-compare` lays the plan beside a map of the game's at
  one scale once there is a first build.
- **What is behind the camera is yours to invent**, and so is everything between the pictures' corners. Say in the
  plan what was invented, so the owner can refuse it there and not after the walk.
- **A style is a palette and a set of shapes.** Read off the pictures the few things that repeat (thin saturated
  strips, orange first and green second; dark faces; posters the brightest things) and hold every corner to them,
  the invented ones above all.
- **Copy nothing.** No mesh, no texture and no poster art of the reference's: a poster is your own picture, and the
  plan says it will read plainer than the reference's up close.
- **A thing repeated is one model** (a lamp post, a barrier, a marker lamp) placed many times: compare it with its
  crop once, then look at the row of them from a camera, where spacing and rhythm show.
- **Open air** has its own costs: line the far sides and the top with `sky` (`docs/MAPS-MAKING.md`), give the battery
  a `--seen` box for what is seen and never walked, and read `smak check-pvs` each round, since an open square draws
  everything round it at once.

## 3. Fixed cameras, from the first build

Write the cameras down once, in the script, before the first compile, and never move them: a round can only be laid
beside the one before if both were drawn from the same places.

```js
// [name, from, yaw, pitch, fov, the reference's piece it answers (x0, y0, x1, y1 in its pixels; null: all of it)]
export const CAMERAS = [
  ["ref", "40,-196,80", 109, -6, 90, null],              // the reference's own viewpoint
  ["sofa", "-150,-40,64", 200, -12, 80, [20, 180, 470, 560]],
  ["table", "60,-110,64", 120, -30, 80, [300, 300, 760, 560]],
];
```

- **Five or six**: the reference's viewpoint; one square on to a wall from 64 away (texture and texel density show
  there); the floor at the feet; one close on the main prop; one of the far side the reference does not show. For
  several references, one for each picture whose corner is built, and one from above.
- **The `ref` camera is fitted, not guessed**: on the first build move it until the room's edges fall where the
  reference's do, then fix it. A generator's or a photographer's camera often stands higher than a player's eye (the
  lounge's was at 80), and its field of view is its own (74 fitted one room, 90 the other). The others stand at a
  player's 64.
- Draw each with `smak map-view <bsp> -o <tag>-<name>.png --from x,y,z --yaw n --pitch n --fov n --width 960
  --height 540 --entities game --no-labels --game <folder holding models/> --game <mod> --game <valve>`. `--entities
  game` and `--no-labels` leave only what the game shows; the first `--game` is where your own models are.
- Run `smak map-look <bsp> --ref reference.png -o <tag>-look.png` with the `ref` camera's place (`--from --yaw
  --pitch --fov`, the same `--game`): the two side by side, and brightness, contrast, coloured, warmth and the main
  colours of each (`docs/MAPS-LOOKING.md`, "A view against its reference"). Keep its text beside the picture.

### The sheet of a round

One picture: a row a camera; across, **the reference's piece, the round before, this round**. `map-look` lays only the
`ref` view beside the reference; the kit has no command that crops a picture or lays pictures of different sizes
together, and `tile` takes pictures of one size (it garbles others, silently). So a round's script carries this:

```js
import { readFileSync, writeFileSync } from "node:fs";
import { unpng, unjpeg, png, tile } from "file:///C:/path/to/smak/src/index.mjs";
const W = 480, H = 270;
/** A piece of a picture ([x0, y0, x1, y1] in its pixels; null: all of it) fitted into W x H, the rest dark. */
function crop(im, box) {
  const [x0, y0, x1, y1] = box ?? [0, 0, im.width, im.height];
  const k = Math.min(W / (x1 - x0), H / (y1 - y0)), ox = (W - (x1 - x0) * k) / 2, oy = (H - (y1 - y0) * k) / 2;
  const out = { width: W, height: H, rgba: new Uint8Array(W * H * 4) };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = Math.floor(x0 + (x - ox) / k), sy = Math.floor(y0 + (y - oy) / k), s = (sy * im.width + sx) * 4;
    const inside = sx >= x0 && sx < x1 && sy >= y0 && sy < y1;
    out.rgba.set(inside ? [im.rgba[s], im.rgba[s + 1], im.rgba[s + 2], 255] : [24, 24, 28, 255], (y * W + x) * 4);
  }
  return out;
}
/** The mean colour of a box of a picture: a tone read off the reference (section 4). */
const meanOf = (im, [x0, y0, x1, y1]) => {
  const m = [0, 0, 0];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) m[c] += im.rgba[(y * im.width + x) * 4 + c];
  return m.map((v) => Math.round(v / ((x1 - x0) * (y1 - y0))));
};
const ref = unpng(readFileSync("references/place.png")); // a JPEG: unjpeg gives { width, height, rgb }, no alpha
const tiles = [], names = [];
for (const [cam, , , , , box] of CAMERAS) {
  tiles.push(crop(ref, box), crop(unpng(readFileSync(`out/${before}-${cam}.png`)), null), crop(unpng(readFileSync(`out/${tag}-${cam}.png`)), null));
  names.push(`reference: ${cam}`, `${before}: ${cam}`, `${tag}: ${cam}`);
}
const sheet = tile(tiles, 3, names);
writeFileSync(`out/round-${tag}.png`, png(sheet.width, sheet.height, sheet.rgba));
```

A sheet holds the reference: keep it in `out/`, with `references/` and `out/` in the folder's `.gitignore`. The
reference is not yours to share, and it is never copied into this kit (AGENTS.md rule 7).

**Every prop beside its own crop.** A model is judged before it stands in the map: `smak sheet <mdl>` or `render
--yaw --pitch` from about the angle the reference shows it, laid beside the reference's piece by the same `crop` and
`tile`. A sofa that is right as "a sofa" and wrong as *that* sofa is the commonest miss, and the room's cameras are
too far away to show it.

### What to look at, in this order

1. **Silhouette and size before anything.** Squint: do the big shapes fall where the reference's do, at its sizes
   against the player? A table twice the reference's, a window that reads small from the viewpoint, a ceiling too
   low: fix these first, and correct the plan's table when its number was the fault. Texture work on a wrong
   silhouette is thrown away.
2. **The brightest thing.** Is it the same thing as in the reference, in the same colour? Then the pools: where,
   and how dark between them. `map-look`'s brightness and contrast lines say how far off.
3. **The palette.** `map-look`'s colours line names the two hues that differ most ("the reference is 46% teal, the
   view 24%"). A hue the reference has not (a blue wall in a teal room) is a material to tone (section 4).
4. **Marks and detail last**: seams, rivets, grime, small props, and each material up close from the wall camera.

`map-look`'s numbers are facts, never a verdict: "close" on every line with a wrong silhouette is a wrong room. And
`smak form <bsp>` and `smak form <mdl>` say how much of the furniture and of each model is a pile of boxes; a `WARN:
form:` is acted on (section 5).

## 4. Materials, toned to the picture

Choose by looking, never by a search's words: `node packs/materials/bin.mjs search <words> --sheet candidates.png`
draws the candidates flat with their mean colour; take photographed ones near the picture's palette already.

**The trap, learned once: do not leave a material its own colour and expect the light to bring the room's.** The
mess hall tried "own colour, teal from the light" and lost its palette (teal from 49% of the view to 24%, the pillars
orange). What works is to **measure tones off the picture** and tone to them:

1. Read the mean colour of each surface's patch of the reference (`meanOf` above): the wall, the floor in a pool and
   out of one, the upholstery, the wood. Write them in the plan, by name.
2. `material <id> --name <tex> --size 512 -o tex --tone r,g,b --final`: with `--final` the tone is the texture's mean
   *after* the marks; without it grime and streaks leave it 10 to 15% darker than asked.
3. `--chroma 0.6`: a tone is a gain on each channel and keeps a paint's saturation, so a pale green paint toned teal
   comes out a loud blue. Chroma keeps that share of each texel's colour round its own grey.
4. `--shift dx,dy` and `--mirror`: the material's own seams put on the room's lines (a panel's frame on a bay line);
   a mirrored copy is the variant for the next bay.
5. The patch you measured is texture times light. Start from it, build, and let the round's `map-look` say which way
   to move: a room that reads too dark with the lamps right wants lighter tones, not more lamps.

A `WARN` on mean brightness (under 31, over 161) is real for a wall and meant for a lamp's face (`~name`) or a dark
lining: say which in the report.

**Texels to the unit** (`docs/MATERIALS.md` has the measure): `scale: 0.5` (two texels a unit) for what a player
stands next to (floors, walls to 2 m up, a counter's front); `scale: 1` for ceilings and what is far. 256 the rule,
512 for floors and walls. A 512 at scale 1 is no sharper than a 128. A model's skin comes from the same sets, so the
sofa's cloth and the wall's wood are of one family and the lit `.glb` finds a set for each.

## 5. Form

AGENTS.md rule 9 holds here more than anywhere: a reference is full of curves and a box in it shows at once.

| The thing | Made with |
| --- | --- |
| A long thing with a section: a rail, a pipe on hangers, a cornice, a window's frame, a canopy's edge | `maps.sweepProfile`, `maps.extrudeProfile` (brushes); `solids.sweepTris`, `extrudeTris` (a model) |
| A turned thing: a lamp post, a bollard, a stool, a ring sign | `solids.lathe` |
| A shell whose section changes: a curved sofa, a tub chair, a machine's rounded front | `solids.sweepTris` with `profile` a function `(i, u, s, total)`; `solids.loft` for stacked rings |
| A box people look at | `maps.box(..., { bevel, edges })`, `maps.roundedBox`; `solids.box(..., { bevel, cut, taper })` |
| A hole, a slot, a window with rounded corners, a pocket | `packs/solid` (`minus`, `roundedRect`); the cutter wears the texture the cut shows |

- **A curved thing or a vehicle is a model, not brushes**, placed as an entity. Brushes are for the room: walls,
  floors, steps, frames, a counter's body.
- A prop not yet made leaves its place **empty**, not filled with a box: an empty place is seen as missing, a box
  is taken for the answer.
- `smak form` warns on things flat by nature too (a table top, a cabinet, a thin leaf). Answer the WARN where a
  change helps (tapered legs, slanted slots, a bevel); where the real thing is a slab, say so in the report and
  judge it against its crop by eye. Do not hide the line.
- Limits that cost a compile or a round: a brush face of more than 28 points (`checkPlan` says it; build a round
  floor as quarters); a model over 12000 triangles is not drawn as itself in the kit's views (they say so); a model
  whose origin is inside a brush may not be drawn; GoldSrc lights a whole model from one sample under its origin, so
  a long wall of slats is several models, each lit at its own foot.

## 6. Baked and lit, and the other engine

```
node packs/gltf/bin.mjs map-gltf out/place.bsp -o godot/place.glb --game out --game <mod> --game <valve>
node packs/gltf/bin.mjs map-gltf out/place.bsp -o godot/place_lit.glb --light lit --sets out/tex --game out --game <mod> --game <valve>
```

**Baked** (`--light baked`, the default) is the game's light as compiled: on import it looks as the kit's views do,
with no hand work. **Lit** leaves the lightmaps out for the engine's lamps and, with `--sets <the folder
packs/materials wrote>`, gives each surface its relief and shine: varnish, gold and a wet floor read only this way.
Write both and keep the printed answer of each. What the lit way needs **set by hand in the engine**, since glTF
carries none of it (`docs/GLTF.md`, `packs/gltf/README.md`):

- **Ambient**: the file's root node has `extras.ambient`; set the environment's ambient colour to it, else shadows
  are black.
- **A reflection probe** a room (a box the room's size, interior): without one metal and varnish reflect an empty
  background.
- **The tonemap**, chosen once for the place and written down (linear or filmic change the look more than a round).
- **Shadows on**: lamps import with none and then shine **through solid walls and floors**. An engine's shadow atlas
  holds only so many: with more lamps than it holds, which ones cast depends on the scene.
- **Emission** of large glowing faces (water behind glass, a wall of signs) usually wants turning down: they wash out.
- The lit way makes lamps of a map's **32 brightest texture-light cells, for the whole file**; the rest only glow. A
  place lit by hundreds of strips will not get a lamp a strip: plan for it (point lights in the map where a pool is
  wanted, since the map's own `light` entities all become lamps) and say what was lost.

Take shots in the engine from the same `CAMERAS` (the map's `(x, y, z)` is glTF's `(x, z, -y)`, 39.37 units a metre)
and put them on the sheet as a fourth column.

**The lesson of the joined map.** When rooms are joined into one file, the kit's views of each room matched the
room alone and the checks passed; in the other engine the hall's floor reflected purple where its own scene's is
teal, and both rooms' shots were 12 to 15 of 255 a channel off their own. The lit way's 32 lamps were now shared by
two rooms, the shadow atlas chose other lamps, and lamps shone through the rock between the decks. So: **lay each room's shot in the joined scene beside that room's own shot in that engine**
(the one the owner approved), from the same camera, and measure the difference; the kit's views cannot show it. What
mended it: each room's lamps taken from its own map alone, each part showing only its own lamps, and each room keeping
its own ambient, probe and tonemap.

## 7. Rounds

- **A budget of builds, stated at the start and reported at the end**: "round 1, six builds" in the plan or the
  task; the report says how many were used and on what. A first round of a room took 6; a round of form on a room of
  curves took 18, nine of them chasing one warning, which is what a budget is there to stop. Over budget, stop and
  say what is left.
- **A round has one aim** (the shell and light; the props' form; the materials) and changes nothing else, so the
  sheet shows that aim alone. Geometry before materials: a retexture round keeps every brush and camera.
- **Each build**: the script from nothing (never from the last output), `checkPlan`, the compile with its log kept,
  `smak map-battery <bsp> --map <map> --log compile.log --game ... -o out` (`--seen x0,y0,z0,x1,y1,z1` for space behind
  glass or beyond the edge), the cameras, `map-look`, `smak form`, the sheet. A draft compile (`--fast`) is for
  shape; light is judged on a full one.
- **One author to a map**, start to end. A worker takes a piece whose result fits in one picture: a model beside its
  crop, a material's sheet. Joining two authors' rooms means copying their lines: check that each copy still writes
  its room's own `.map` byte for byte before changing anything.
- **The manager looks at the pictures**, against the reference, not at the worker's account of them.
- **A worker's report quotes every `WARN` as the kit gave it**, with what was done or why it stands, the builds used
  of the budget, each check's last line, and the files: the sheet first.
- **A fault of the kit goes into the map's own `KIT-FAULTS.md`**, not round it in silence: a table of *what was
  asked, what was got, what was done instead*, numbered. A helper written because the kit lacks something is a fault
  to write down. The plan's own faults (a wrong size) are listed apart: they are not the kit's.

## 8. What the method does not give

- **The kit's pictures are not the game.** They draw no fog and no reflections, and glass at a low render amount
  barely shows. Haze, a wet floor and how bright a model sits beside a wall are judged in the game or the
  other engine, by the person. Say what was not seen there.
- **What is behind the reference's camera is invented**, and with several pictures so is most of the place. It can
  be coherent with the style; it cannot be checked against anything. The plan says which parts.
- **The stock GoldSrc and Xash renderers show only the baked way**: no relief, no roughness, no real-time lamps. If
  the owner's verdict was given on the lit `.glb` in another engine, the game will not look like that.
- **A generated picture is not a buildable place**: its perspective bends, its counts do not add up, things merge.
  The plan's table is the place; the picture is what it is held to.
- **`map-look` measures light and colour, `smak form` boxiness, the battery walkability. None measures likeness.**
  That is the sheet, and the eye of whoever looks at it; the last word is the owner's walk.
- **Painted art** (a poster, a mural, a logo) is not made here: materials come from photographs, and a picture drawn
  by a program reads as one.
