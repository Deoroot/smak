# Models: how one is put together, and a new one made

How a studio model (`.mdl`) is put together, the rules that keep one working in the game in full
(`AGENTS.md` has them short), and the recipes for a new model: from triangles, from an `.obj`, its
animations, a monster, a body composed on a bought rig. A re-skin is `docs/RESKIN.md`; a new shape in a
model that is there (a weapon's mesh, a helmet, a pack) `docs/SHAPES.md`; a bought model `docs/IMPORT.md`. Each recipe that has a runnable example in `examples/` names it. Read the example first; it is the template.

## How a studio model is put together

You need this model in your head; the API mirrors it exactly.

- **Bones.** A tree. Each has a rest position and rotation relative to its parent. Hand and weapon bones of
  first-person models are usually named `Bip01 R Hand` and the like; check with `info`.
- **Bodyparts → submodels → meshes.** A model has bodyparts (`weapons`, `arms`). Each bodypart holds submodels,
  of which the game shows one, chosen by a **body number**. Each submodel holds meshes, one per texture.
  A file like `v_knife.mdl` may hold several weapons as submodels of one bodypart.
- **Vertices live in the space of one bone.** Each vertex belongs to exactly one bone and is stored relative to
  it. To get a point in model space, multiply by that bone's matrix: `apply34(pose[bone], p)`.
- **Textures** are inside the file: 8 bits a pixel with a 256-colour palette each. Texture coordinates are stored
  in **pixels** of that texture, from its top left.
- **Animations (sequences)** hold, for each frame and each bone, six numbers: position x, y, z from the parent and
  rotation about x, y, z in radians. Events (a sound, a muzzle flash) are fastened to frames.
- **Attachments** are named points on bones: where a muzzle flash or a shell appears.
- **Hit boxes** are boxes on bones, each in its bone's space and each with a **group** (head, chest, a leg):
  what a shot or a blow is traced against, and by the group, how much it hurts. A model with none is traced
  as its entity's one box.
- **An animation also says** an **activity** (the number a monster's code asks for "a walk" by, whatever
  the animation is called), **how far the model travels** in one play of it (`movement`; the frames
  themselves stay on the spot, and the game moves the monster at the speed that makes), and a **box** about
  the model through its frames, by which the engine decides whether it is in view.
- **Bone controllers** are bones the game's code turns by itself: a head that follows, a mouth that talks.

### Conventions

| | |
| --- | --- |
| Axes | `+x` forward, `+y` left, `+z` up. A model faces `+x` as its animations stand it; its rest pose may be turned from that (docs/COMMANDS.md, "Which way is the front depends on the pose"). |
| Units | About an inch. A player is 72 tall; a pistol about 8 long. |
| First-person models | The eye is at the model's origin looking along `+x`. |
| Matrices | 3 rows of 4 (`[[r r r t] ×3]`), taking a bone's space to the model's. `mul34`, `apply34`, `inverse34`. |
| A piece's own axes | `+x` its length (grip or butt at low x, tip at high x), `+y` its width, `+z` its thickness. |
| A triangle (in the kit) | Three corners `{ p: [x, y, z], uv: [u, v] }`, `uv` from 0 to 1 from the picture's top left. |
| An image | `{ width, height, rgb }`, three bytes a pixel. |
| A texture | `{ name, width, height, pixels, palette, flags }`: one palette index a pixel, 768 bytes of palette. |
| Texture flags | 1 flat shaded, 2 chrome, 4 full bright (unlit: Xash draws it so; Steam's GoldSrc is not known to), 32 additive (a glow), 64 masked (palette index 255 is a hole). Added together; docs/API.md, "Changing textures". |
| Which way triangles go | Decided for you by `meshOf` / `buildMdl` / `swapMesh`. `check` reports triangles that face inwards. |

## Rules that keep a model working in the game, in full

1. **Never reorder or remove animations.** Game code plays a weapon's animations by number (`info` lists them in
   order). Replace one where it stands (`replaceSequence`) or add after the last (`addSequence`).
2. **Never renumber submodels, bones or attachments** of a model the game already uses. Everything in this kit
   that adds, adds at the end, so numbers stay. Do not work round that.
3. **Keep an animation's frame count and rate close to the original** when the game times something by it (a
   reload that fills the magazine when the animation ends). If you change its length, tell the person.
4. **Keep to the engine's limits.** Run `check` for `goldsrc` unless told the target is Xash only. The ones you
   will meet: 2048 vertices and 2048 normals a submodel, and 128 bones (errors). A texture may be of any size,
   and the games' own files have sizes like 488x498: GoldSrc stretches a side that is not a power of two to one
   when it loads the model, a little softer (`check` only notes it), and draws a side over 512 shrunk (a
   warning). So a texture you replace keeps the size it had, whatever that is; for a new one, 256x256 and
   512x256 are the sizes drawn exactly as painted.
5. **Keep texture names unique** inside one file, and end them in `.bmp` as the format expects. `retexture`,
   `replaceMesh` and `putBody` wear the file's own texture when given one of a name it has. On a model with
   several skins, give a replaced texture the size it had, or replace every texture a mesh wears across its
   skins at the same new size: `replaceTexture` says on the console when they are left apart.
6. **Never write over the mod's original files.** Write to a working folder; the person installs the result.
7. **Do not copy a game's models or textures into this kit** or into anything that is shared: they belong to the
   game's authors.
8. **A new model file has to be named when the map starts.** The engine loads (precaches) models as a map
   begins, and refuses one asked for later. Tried in Master Sword: a new `.mdl` showed only once a script that
   runs at map start named it; a script that first named it during play did not get it loaded. So a model
   under a **new file name** needs the mod's code or scripts to name it at map start; a model that **replaces**
   a file the game already loads needs nothing. Ask the person which it is before choosing a file name.

## Form: not a pile of boxes

Every check in this kit measures validity, budget and walkability; none measured shape, and an axis-aligned box
always compiles and always passes. An agent left to itself makes boxes, and a person sees at once that a program
made it. So form is measured (`src/form.mjs`; `smak form <mdl>`; `check` warns) and there are tools so that the easy
path is not a box.

**What is measured** (of the surface, never the textures): `axisAligned`, the share of the surface area whose normal is
within 5 degrees of an axis; `sharpEdges`, of the creases (turns of 20 degrees or more), the share that are 80 or more
with no chamfer or round between; `outline`, the corners of the silhouette (outer contour, simplified to 1.5% of the
model's longest side) in the front, side and top views, a box being 4; `boxiness`, 0 to 1, their mean (the outline term
is 1 at 4 corners and 0 at 24). **The bands** are Half-Life's own models, measured at rest (`FORM_BANDS`, with the corpus
in its comment): props and items (49: the `w_` models, the crate, the filing cabinet, the barrel ...) boxiness median
0.44, 95th in 100 0.85; vehicles and machines (9: Apache, Osprey, forklift, loader, the turrets ...) median 0.34, 95th
0.46, silhouette median 24 corners; monsters and players (31) median 0.12, 95th 0.26. Valve's own crates are boxes (the
filing cabinet is boxiness 1.0), so a prop's band is wide; a vehicle's is not, and a train or a car is judged as a
vehicle (by its file name: train, tram, metro, car, bus, truck ...; or `--form vehicles`). `check` makes a form over the
95th in 100 of its kind a `WARN: form: ...`, never a FAIL, and says what to do.

**What to do.** Start from a reference (a photo, a section, a silhouette) and compare your picture with that.
- **A turned thing** (a post, a bollard, a vase, a lamp): `solids.lathe(place, [[radius, z], ...], { n })`, the
  profile of its section turned. Ten sides read round.
- **A long thing with a section** (a car's body, a rail, a moulding, a roof): `solids.sweepTris(profile, path)` or
  `extrudeTris(profile, p0, p1)`, a closed 2-D profile (any outline, concave too) swept along a path, mitred at the
  bends; a tram's body is one section (floor, waist, curved roof) along its length, its ends the same section
  scaled in and drawn forward. Returns `[[{ p, k }]]`, as `trisOf` does: give the corners a `uv` and a `bone` and it is a
  mesh.
- **A box people look at**: `solids.box(..., { bevel, bevelFoot, cut, taper })`, its edges cut. A skirt, a lamp pod, a
  step with its edges cut is no longer a crate.
- **Smoothing**: `meshOf(original, tris, tex, bone, smooth = 40)` shares a normal between faces that meet at less than
  `smooth` degrees (a turned post's facets light as a curve); a larger angle (60) smooths a coarser round, 0 leaves every
  facet flat (a crate's edges). A corner's `group` marks a crease (faces of different groups never share a normal).

`examples/08-form.mjs` makes a park bench, a lamp post and a tram car both ways, prints each one's numbers and draws
both. Measured (boxes, then a profile): bench boxiness 0.90, then 0.60; lamp post 0.96, then 0.32; tram car (judged as a
vehicle) 0.90, then 0.41.

## A whole new model: `examples/01-new-model.mjs`

For a prop, a pickup, a thrown thing, something worn. `buildMdl` takes bones, triangles, textures and
animations and returns the file. Unless told (see "A monster from nothing") it has no hit boxes or
attachments. For a first-person weapon, whose animations and attachments the game's code knows by number,
swap a mesh in an existing one instead.

## From an .obj file: `examples/06-from-obj.mjs`

For a shape made elsewhere: Blender, a script, any tool that writes Wavefront .obj. One line when the .obj has
its .mtl and its pictures (PNG or BMP) beside it:

```
node bin/smak.mjs obj hut.obj -o hut.mdl --scale 39.37 --ground
```

or in a script, where the pictures are yours to read:

```js
import { readObj, objModel, check, sheet, png } from "./smak/src/index.mjs";

const obj = readObj(readFileSync("hut.obj", "utf8"), { mtl: readFileSync("hut.mtl", "utf8") });
const textures = { planks: readFileSync("hut_planks.png") };          // by material: a PNG or BMP file, a texture or an image
const { mdl, warnings, report } = objModel(obj, { name: "hut.mdl", textures, scale: 39.37, up: "y", ground: true });
console.log(warnings, report.textures, check(mdl).errors);            // then draw it: sheet(mdl, { seq: "idle" })
```

- **Which way is up, and which is the front.** An .obj is usually `+y` up with its front towards `+z` (what
  Blender writes unless told otherwise: "Forward -Z, Up Y"); `up: "y"`, the default, stands it up with that
  front towards `+x`. A file already in GoldSrc's axes takes `up: "z"`. If the drawing shows it facing the
  wrong way, `turn: 90` (or 180, 270) turns it about its upright axis. Look at the `sheet`: "front" must be
  the front.
- **Size.** An .obj has no units and a unit of the game is about an inch: `scale: 39.37` for a file in metres,
  `0.3937` for centimetres. The command prints the model's size in units; a player is 72 tall.
- **Where the origin goes.** As in the file, unless `ground: true` (its lowest point at z = 0: a thing that
  stands on the floor) or `centre: true` (its middle at the origin: a thing that is thrown or carried).
- **Materials.** One mesh and one texture a material, named after it. A material with `map_Kd` wears the
  picture you hand over under its name; one with `Kd` alone, or whose picture is missing, a small flat
  picture of that colour. A picture over 512 a side is made smaller (`maxTextureSize`).
- **Smooth and sharp.** Where the file has normals (`vn`) they are kept, so the model is lit as the tool that
  made it lit it: faces that give a point the same normal are smooth across it and the others meet in a crease
  (triangles whose normals look the other way from their faces have theirs worked out, with a warning). To
  `putBody`, say `ownNormals: true` to keep them. Without normals its
  smoothing groups (`s`) say it; without either, faces that meet at less than 40 degrees are smooth.
- **Read `warnings`** (the command prints them): triangles of no area left out, a picture made smaller or not
  given, texture coordinates that repeat the picture (it is then laid side by side in a larger texture, since a
  studio model's picture is not trusted to repeat), and a model of more points than a submodel holds (2048), which
  is shared out over several bodyparts, all shown by body 0 (with a faint line in the light where two meet on a
  smooth surface, when the file has no normals of its own): a shape for GoldSrc is better made with fewer.
- It has one bone, `root`, at the origin and one still animation, `idle`: a prop, a pickup, scenery. No hit
  boxes or attachments.
- **As a new body of a model that is there** (a pack on a back, a helmet): `objMeshes(obj, { up: "y", scale })`
  gives the triangles stood up, one list a material, and `putBody` takes a list as it is:
  `putBody(src, { name: "pack", tris: objMeshes(obj).meshes[0].tris, texture, bone: "Bip01 Spine2", pose: { seq: 0, frame: 0 } })`.
  A body wears one picture, so make such a piece with one material. See docs/SHAPES.md, "A new body from triangles".
- A face of more than three corners that bends inwards (concave) is cut wrongly: triangulate in the tool
  (Blender: "Triangulated Mesh" in the export).

## Animations: `examples/04-animate.mjs`

```js
import { readSequence, replaceSequence, addSequence, bones, events, setEvents } from "./smak/src/index.mjs";

const reload = readSequence(src, "reload");        // .frames[frame][bone] = [x, y, z, rx, ry, rz]
const b = bones(src).findIndex((x) => x.name === "Bip01 R Hand");
const frames = reload.frames.map((f, t) => f.map((v, i) => (i === b ? [v[0], v[1], v[2] - 2 * Math.sin(Math.PI * t / (reload.frames.length - 1)), v[3], v[4], v[5]] : v)));
let mdl = replaceSequence(src, "reload", { frames });                       // same place in the list
mdl = addSequence(mdl, { name: "inspect", fps: 30, frames, events: [{ frame: 10, event: 5004, options: "weapons/slide.wav" }] });
```

- A bone's numbers are **relative to its parent**. Moving the hand moves the fingers and whatever it holds.
- Rotations are Euler angles applied about x, then y, then z. Small edits to existing frames are safe; building
  a large rotation from nothing is easier by starting from a frame that already has the bone near where you want.
- To see a pose before writing it: `render(src, { pose: poseOf(src, frame), view: "first" })`.
- `strip` draws an animation frame by frame. Look at it: a wrist bent backwards is obvious in the picture and
  invisible in the numbers.
- Event 5004 plays a sound on the client; 5001 is the first muzzle flash. Read the mod's existing events with
  `info` and follow what it already does.
- A bone that has to move further than the file's scale for it allows is given a wider scale automatically, and
  the model's other animations are rewritten to match (same motion, very slightly coarser for that bone).

## A monster from nothing

A thing that walks, is hit and dies needs more of the format than a prop: `buildMdl` takes it all, and the
setters give it to a model that is there.

```js
import { buildMdl, HITGROUP, MOTION, check, strip, png } from "./smak/src/index.mjs";

const mdl = buildMdl({
  name: "beast.mdl", bones, bodyparts,                // as for any model; corners say their `bone`
  sequences: [
    { name: "idle", fps: 15, loops: true, frames: idle, activity: 1 },                       // ACT_IDLE
    { name: "walk", fps: 20, loops: true, frames: walk, activity: 3, movement: [48, 0, 0],   // ACT_WALK
      events: [{ frame: 4, event: 1004, options: "common/npc_step1.wav" }] },
    { name: "bite", fps: 20, frames: bite, activity: 30 },                                   // ACT_MELEE_ATTACK1
  ],
  hitboxes: { groups: { head: HITGROUP.head, spine: HITGROUP.chest } },   // or "auto", or your own list
  attachments: [{ name: "mouth", bone: "head", pos: [6, 0, -1] }],
  controllers: [{ bone: "head", type: MOTION.ZR, start: -60, end: 60 }],
  eyes: [0, 0, 30],
});
```

- **A walk is given walking on the spot**, and `movement` says how far one play of it carries the model:
  measure it off your own frames (how far a planted foot slides back is how far the body goes forward).
  `info` prints the speed it makes, `distance * fps / (frames - 1)`, in units a second: that is the speed the
  game moves the monster at while it plays, so a wrong `movement` is feet that slide. Half-Life's zombie walks
  at 72, its grunt runs at 304.
- **A looping animation's last frame is its first again.** The engine plays from the first frame up to the
  last and starts over at the first, taking the two for one moment: a walk of 20 steps has 21 frames, the
  21st a copy of the 1st. Every looping animation in the games' own files is made so; `check` warns of one
  that is not, naming the bone.
- **Write the animations as poses, not as numbers** (`src/animate.mjs`, exported as `animate`). A frame is
  six numbers a bone in the bone's own axes, which is no way to make a walk. Say the pose in the MODEL's axes
  and let the kit work the numbers out:

  ```js
  import { animate as A } from "./smak/src/index.mjs";
  const rig = A.rigOf(bones);                                              // a model's bytes, or a bone list
  const stand = A.poseOf(rig, { spine: { turn: { y: 8 } }, "arm.L": { turn: { x: -25 } } });
  const step = A.reach(rig, stand, { bones: ["thigh.L", "calf.L", "foot.L"], to: [10, 5, 2], level: true });
  const frames = A.animate(rig, { frames: 25, loops: true, keys: [{ at: 0, pose: stand }],
    each: (pose, frame, part) => /* the pose of this frame: put the feet with reach */ pose });
  const { speed, slide } = A.stride(rig, frames, { feet: ["foot.L", "foot.R"], fps: 20 });
  ```

  A `turn` is in degrees about the model's `x`, `y`, `z` (for a limb that hangs: `y` over 0 swings it back,
  `x` over 0 out to the left, `z` turns it about the upright), from where the bone rests and carried by its
  parent, whatever the bone's own axes are. `reach` bends a limb of two bones so that its end is at a place
  (a foot on the ground, by arithmetic). `mirror` changes left and right over. `animate` joins key poses by
  the shortest turn, eased, and closes a loop; `each` makes every frame from a formula, which is how a cycle
  is made to close by itself. Then MEASURE: `stride` gives the speed the planted feet ask for (set the
  sequence's `movement` to `speed * (frames - 1) / fps`) and how much they slide; `seam` a loop's gap;
  `track` where a joint goes. And LOOK: `strip(mdl, { seq, view: "side", ground: true })`, the feet against
  the line. Make the skeleton with every bone unturned at rest when it is yours to make: the numbers in the
  file are then the model's axes too. A stand-in body of a box a bone is enough to judge motion by, before
  the real body exists.
- **Hit boxes.** `"auto"` makes the ones studiomdl makes for a model whose source names none: for each bone a
  box about what it carries, reaching to the bones that hang from it. Give `groups` by bone (the bones under
  one take its group), or a list of your own boxes, each in its bone's space. `autoHitboxes(mdl)` returns
  the list without writing it; `setHitboxes(mdl, list)` writes one into a model that is there.
  `smak info --hitboxes` lists them with their sizes.
- **Activities** are the game's own numbers (`ACTIVITY` names the ones this kit knows; `info` on a monster of
  the game shows what its animations use). Several animations may share one, picked by `actweight`. A mod
  that plays animations by name (as Master Sword's scripts do) needs none: look at how its own monsters'
  files are made, and follow them.
- **Each animation's box** is measured for you from the model's points through its frames, as studiomdl does:
  nothing to do, unless you change frames by some way of your own.
- **Look at it from the side**: `strip(mdl, { seq: "walk", view: "side", ground: true })` (`smak strip ...
  --view side --ground`) draws every frame by one camera with the floor as a line: feet that sink, float or
  slide show there. It is still only a picture: how it moves in the game shows in the game.
- What the game does with all this is the mod's: its code or scripts name the model (rule 8), choose its
  size and its hull, and decide what a hit group or an attachment means. Ask the person, and read one of the
  mod's own monsters with `info` first.

## Composing on a bought rig, holding things, keeping on the ground

`importRigged` gives back `parts`, what the model was built from: add a bone and a mesh on it, then
`buildMdl(parts)` (docs/IMPORT.md). In the animations, `animate.reach(rig, pose, { bones, to, aim: { axis, dir,
edge, edgeDir }, grip })` turns the hand so that what it holds points along `dir` with its grip at `to`;
`animate.hold(rig, pose, "lantern")` keeps a bone at its own turn in the model whatever its parents do (call it in
`each`); `animate.grounded(mdl, { seqs: ["diesimple"] })` lifts every frame whose lowest point went under the
floor. The quaternion helpers (`qmul`, `qturn`, `qframes`, `turnOf` ...) are exported from `animate` for the rest.
A body built limb by limb from nothing has `workshop.skinned()` (tubes, lofts and cards, each corner on its bone).
