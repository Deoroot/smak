# Bought models: FBX, glTF and OBJ into a studio model

A low-poly model bought in a pack comes as `.fbx`, `.glb`/`.gltf` or `.obj`, with its pictures beside it or
inside it. SMAK reads all three into one shape and makes of it a **prop** (a whole `.mdl`), a **piece** for
`smak item` (a new weapon, shield or bow in a game's own files, docs/ITEMS.md), or a **model with the file's
skeleton and animations**. Pure JavaScript, no dependencies: zlib for FBX's packed arrays, a PNG and a
JPEG reader of the kit's own.

```
smak import mace.fbx                                   what is in it
smak import mace.fbx -o mace.mdl --fit 40 --origin base --pictures      a prop, and six views of it
smak import <pack folder> -o <folder> [--only fbx]     every model a prop, sheet.png, import.json
smak item mace.fbx --mod profiles/x.mjs --game <mod> --family blunt1h --name mace -o out --pictures
smak import zombie.fbx -o zombie.mdl --anim --origin base    its bones and animations
```

`smak import <file>` first: it says the axes, units, size at its true scale, meshes, materials and which
picture it found for each. Then fit its size (packs are not to scale), look at the pictures, and correct what
it assumed ("Recipes").

## What is read

| | FBX (`readFbx`) | glTF (`readGlb`) | OBJ (`readObj`, `importedObj`) |
| --- | --- | --- | --- |
| versions | binary 7.0 to 7.7 (32 bit records, 64 bit from 7.5; zlib arrays), and the text form | 2.0: `.glb`, `.gltf` with its `.bin` and `data:` addresses | any |
| meshes | every `Geometry` Mesh under a `Model`; polygons cut into fans (the end marker -(n)-1); one mesh under several nodes read for each | every primitive of the default scene: triangles, strips, fans, indexed or not, any number kind, `normalized`, sparse | faces as fans |
| texture coordinates | the first `LayerElementUV`, by corner, point, polygon or one for all, direct or through an index | `TEXCOORD_0` | `vt` |
| normals | `LayerElementNormal`, the same ways | `NORMAL` | `vn` |
| materials | per polygon (`LayerElementMaterial`); name, `DiffuseColor`, the picture joined to the colour (`RelativeFilename`, `FileName`), a picture inside the file (`Video` `Content`) | `baseColorFactor`, `baseColorTexture` (or the older specular-glossiness `diffuseTexture`); pictures inside (`bufferView`, `data:`) or named | `.mtl`: `Kd`, `map_Kd` |
| places | `Lcl Translation`, `Lcl Rotation` in its `RotationOrder`, `Lcl Scaling`, `PreRotation`, `PostRotation`, pivots and offsets, through the parents; `Geometric*` on the mesh | `matrix` or translation, rotation, scale, through the parents | none |
| axes, units | `GlobalSettings`: `UpAxis`, `FrontAxis` with signs, `UnitScaleFactor` | glTF's: +y up, front +z, metres | told: `--up y\|z` (y), metres |
| skins | `Deformer` Skin and Cluster: `Indexes`, `Weights`, `Transform` | `JOINTS_0`, `WEIGHTS_0`, `inverseBindMatrices` | none |
| animations | `AnimationStack` > first `AnimationLayer` > `AnimationCurveNode` (`Lcl Translation`, `Rotation`, `Scaling`) > `AnimationCurve` `KeyTime`, `KeyValueFloat` | samplers on translation, rotation, scale: LINEAR, STEP (CUBICSPLINE through its keys) | none |

Not read, and said where it matters: cameras, lights, shape keys and morph targets, NURBS, a second set of
texture coordinates, vertex colours, `InheritType` (every node passes all its scale on), more than the first
animation layer, constraints, curves' tangents (keys are joined by straight lines; a tool that bakes a key a
frame, as Blender does on export, loses nothing), Draco and meshopt packing (refused, saying so), points and
lines, `KHR_texture_transform` (warned of). Pictures: PNG (8 bits a channel, not interlaced), BMP and
JPEG (baseline and progressive); a lossless or arithmetic coded JPEG is named and its material wears its flat colour (`--save-pictures` writes
the pictures inside a file out, to be saved again).

## The conventions

Everything a reader gives is in **GoldSrc's axes**: +x forward, +y left, +z up. The file's up becomes +z and
its front +x, which is a turn and never a mirror (the third axis follows from the two). Points stay in the
**file's units**; `unit.metres` says what one is (an FBX `UnitScaleFactor` of 1 is a centimetre).

- **Size.** A prop is made at its true size unless told: one metre is **39.37 units** (a unit is about an
  inch). `--scale 2` is twice that, `--fit 40` makes the longest side 40 units whatever the file says. Packs
  differ wildly (one pack's mace is 2.2 m long, its crossbow 8 m): look at `smak import <file>`'s
  "at its true size" line, and fit. A piece for `smak item` is not sized: it is laid as long as the game's
  own weapon.
- **Pictures.** The kit counts a picture's coordinates from its **top left**; FBX and OBJ count from the
  bottom left, so their v is turned over (`1 - v`); glTF counts from the top and is kept.
- **Winding.** Triangles face out counter-clockwise, as the kit's generators make them; a node that mirrors
  (a scale under 0) has its faces turned back.
- **Origin.** `--origin keep` (unless told: the file's own), `base` (the middle of the box on the floor:
  centred across and along, its lowest point at z = 0), `centre`.

## The common shape

`readFbx`, `readGlb` and `importedObj` give what `readObj` gives (`groups`, `materials`, `libraries`), so
`objModel` takes it as it is (with `up: "z"`), and more: `images` (pictures inside the file), `meshes` (a
table), `nodes` (the tree, each with its own rest matrix), `joints`, `animations` (each with `at(seconds)`),
`stand`, `axes`, `unit`, `box`, `warnings`. A corner is `{ p, uv, n, group, smooth, node, weights }`. See
`src/import-shape.mjs`.

## Recipes

**A prop.** `smak import crate.fbx -o crate.mdl --fit 32 --origin base --pictures`, then `smak check
crate.mdl` and look at `crate.png`. Its pictures are found beside it: the one the material names (any
ending; in `textures/`, `maps/` and the like; or in such a folder up to four folders above, where a pack keeps
all its pictures together), one called after the material (`Material` -> `Material_Base_color.png`, never
its normal or roughness map), or the one picture of a colour in the folder. `--texture pic.png` gives one for
every material. A PNG with see-through parts becomes a texture with holes (flag 64). Pictures over 512 are
made smaller; a model of more than one submodel holds is shared out over bodyparts.

```js
const read = smak.readModelFile("crate.fbx");                         // or readFbx(bytes), readGlb(bytes)
const { pictures } = smak.picturesOf("crate.fbx", read);
const { mdl, report } = smak.importModel(read, { name: "crate.mdl", pictures, fit: 32, origin: "base" });
```

**A weapon in the game's files.** `smak item mace_01.fbx --mod profiles/mastersword.mjs --game <Half-Life>/msc
--family blunt1h --name puckmace -o out --pictures` (`--texture` is the picture's FILE here; it is found
beside the model unless told). `importPiece` turns the model to the axes a piece is drawn in and prints what
it assumed:

- `--as haft` (a handle with a head: laid on the game's weapon's handle), `plain` (by its outline: a sword,
  a bow), `shield` (+x along it, +z out of its face, z = 0 its back). Unless told: `shield` for a family laid
  as a shield, else `haft` when one end is 1.5 times as wide as the other, else `plain`.
- `--axis x|y|z` (the length; unless told, the longest side of the box), with a sign (`-z`) to say which way
  it runs from the butt; `--grip low|high` (the end of that axis the hand holds; unless told, the slimmer);
  `--flip` the other end (a shield: its other face; unless told, the face is away from the loose pieces that
  stand off its back, the straps).
- Several materials are laid side by side on one picture. In each file the picture is made no larger than
  1024 / the placement's `shrink` (and 512): a bought picture of 2048 is 512 in the hands and 256 in the world.

**A batch.** `smak import <folder> -o <folder> [--only fbx,glb] [--fit 48] [--origin base]`: every model as a
prop by the same paths, `sheet.png` (48 a sheet, each drawn from three quarters with its textures),
`import.json` (triangles, points, meshes, pictures found, size, bones, warnings, errors), and HEAVY for one
with more than 2500 triangles or more points than one submodel holds.

**A rigged character.** `smak import zombie.fbx -o zombie.mdl --anim [Walk,Attack] [--fps 30] --origin base`,
then `smak strip zombie.mdl --seq walk -o walk.png`. `importRigged` keeps the nodes that carry a point and
every node above them (a rig's handles are left out), binds each point to the bone that weighs most on it,
reads each animation at `fps` poses a second, names it by what follows its last `|` in small letters, and
gives the model hit boxes about its bones. It is not yet a monster: activities, events, eyes and a walk
that travels are added as for any monster (docs/MODELS.md, "A monster from nothing").

It says where the feet stand as the first animation begins (`report.feet`) and warns when they are more than 6
units off z 0. A monster's origin is on the floor, and Master Sword's own stand there. A file whose origin is its
hips stands sunk: a bought troll and a zombie kept their files' origins and stood 37 and 33 under the floor until
`--origin base`. A player's model is the exception, at -36, the middle of the player's box. It also gives the
triangles of Master Sword's own monsters and people of its size (`report.kin`: a person's size has 927 at the
median, three quarters under 1607) and warns past the three quarters: right for one boss, heavy for a pack.

**Something added to a rigged character before it is built** (a lantern in a hand, a pack on a back).
`importRigged` gives back `parts`, what it built the model from, as `buildMdl` takes it: the bones, each mesh's
triangles in the model at rest (corners `{ p, uv, n, bone }`, `bone` a number) with its texture, the
sequences. Add a bone after the others, its value in every frame, and a mesh on it; then build again:

```js
const zombie = importRigged(read, { name: "bearer.mdl", pictures, origin: "base", animations: [] });
const { parts } = zombie, hand = parts.bones.findIndex((b) => b.name === "Hand_l");
parts.bones.push({ name: "lantern", parent: hand, pos: [0, 5.5, 0], rot: [0, 0, 0] });
for (const s of parts.sequences) for (const frame of s.frames) frame.push([0, 5.5, 0, 0, 0, 0]);
const at = animate.worldOf(animate.rigOf(parts.bones), animate.rigOf(parts.bones).rest).at(-1).p;   // the new bone at rest
parts.bodyparts[0].models[0].meshes.push({ texture: lampTexture, tris: lampTris.map((t) => t.map((c) => ({ ...c, p: add(c.p, at), bone: parts.bones.length - 1 }))) });
const mdl = buildMdl(parts);
```

A prop to hang there comes the same way: `importRigged` of a file with no skin gives its one mesh in `parts` too
(`fit` and `origin` as for a prop). Then animate with `animate.hold(rig, pose, "lantern")` in `each` (it hangs
straight whatever the fist does) and `animate.grounded(mdl, { seqs: ["die"] })` (a fall lies on the floor, not
in it). `buildMdl(zombie.parts)` with nothing added gives the same bytes as `zombie.mdl`.

**A model made for a newer engine, with too many triangles.** `--triangles <n>` (`triangles: n` to
`importModel`, `importPiece` and `importRigged`) brings the shape down first, with `fewerTriangles`: each mesh
and material by its share of `n`, by the quadric reducer (`reduce`, src/qem.mjs, from Steven Linn's fork of the
kit). The points where two materials meet stay as they are in both, so no crack opens between them; a corner
that stays keeps its place in the picture and the bones it hangs from; the normals are worked out again. The
report says how far it got (`report.fewer`): it stops short of `n` where no join is left that keeps the shape
and its picture, and says why. Measured on bought models: a spear of 11430 triangles to 1216 (16 bodyparts to
one), a rigged archer of 1080 to 618 that walks as before; a sculpted armour of 389212 stopped at 30326, its
picture cut into thousands of small charts that a join would smear across, and is still more than a model
holds.

## Art from a generator

A picture or a mesh made by a generator comes into the kit as a bought one does, by the same doors; from there
the kit's own fitting, checks and pictures take over. The kit calls no generator and holds nothing of one: the
person runs it (a ComfyUI of their own on their graphics card, free; Blender's generator; any service they pay
for), or lets you run it, and saves what it makes in the work folder.

Before you run one for them:
- **Ask first** when it costs anything (a service's credit, Blender's `generate_3d` may) or sends anything off the
  machine. What is sent to a service has left: never a game's file, nor a picture of one, as its input.
- **Whether they may use what it makes** is theirs to know, as for a bought pack. The kit only checks what a
  folder holds before it is shared (`smak check --publish`).
- A generator guesses what it is not shown, and its guesses pass every check. **Look at every side** of what it
  made; a check says only that the game can load it.

**A map's texture.** Ask for the material seen straight on, evenly lit, as a photograph, and tiling:

- *a seamless tileable texture of poured concrete, flat even lighting, orthographic, no shadows, no perspective*

Save it as a PNG and make a `.wad` of it with `smak wad-make` (docs/COMMANDS.md). A generator's picture is more
even and more coloured than a photograph: look at the texture beside Valve's own in the map before it stays.

**A model's texture.** Make it the size of the one it replaces (rule 4), ask for the layout `smak uv` shows,
and bring it in with `textureFrom` and `replaceTexture` (docs/RESKIN.md). A generator does not keep to the UV
layout, so a whole skin painted at once seldom lands: paint by place instead (docs/RESKIN.md). A
generated front and back rarely agree on the thing's sides: look at the sides.

**A mesh.** Ask for a `.glb` (most generators give one; `.fbx` and `.gltf` are read too), then:

```
smak import chair_gen.glb                                              its size, meshes, pictures
smak import chair_gen.glb -o chair.mdl --triangles 800 --fit 40 --origin base --pictures
smak item mace_gen.glb --mod profiles/x.mjs --game <mod> --family blunt1h --name mace -o out --pictures
```

- **`--triangles`** first: a generator's mesh is tens or hundreds of thousands of triangles, where a Half-Life
  prop is hundreds. The report says how far it got and why it stopped.
- **`--fit` and `--origin base`**: a generated mesh has no scale and no floor. Its size is what the person asked
  for; its origin, its foot.
- **One picture a mesh**: a generator bakes its colour into one picture inside the `.glb`, which `picturesOf`
  finds. Its light is often baked in too: a top lit bright and a foot dark, which the game's own light then
  doubles.
- **A character from a generator** has no skeleton the game knows: re-skin one of the game's (docs/RESKIN.md). It is rarely worth rigging a generated one.

**Running ComfyUI from a script.** ComfyUI listens on `http://127.0.0.1:8188`: a workflow saved from it "for the
API" is `POST`ed to `/prompt` as `{ "prompt": <the workflow> }`, which answers with a `prompt_id`; `/history/<id>`
says when it is done and the names of its pictures, and `/view?filename=<name>&type=output` gives each one.
Change only the workflow's prompt text and its seed between runs, and keep the seed of a picture the person
liked: the same seed and prompt give the same picture.

## Limits

- **One bone a point.** GoldSrc holds each point on one bone: where the file shares a point between bones
  (an elbow) the skin creases instead of bending. A bone's stretch that changes while it plays is lost (said).
- **More than 128 bones** are refused; fingers and faces are the usual cause.
- **Repeating pictures** are laid side by side in the texture (up to 8 each way), as `objModel` does.
- **One picture a piece**: a piece's materials share one sheet; a prop keeps one texture a material.
- **A bow as an item is rigid**: no string is drawn (no corner of a bought bow is marked as the string's
  middle); and the turn chosen by its outline may put its belly the wrong way in some placements: look at
  the pictures, and give `--axis`/`--flip`.
- **Sizes in a pack** vary from model to model: fit them.
- **Never copy a bought file into a repository**: its licence almost always forbids it.
- **Fewer triangles keeps the shape, not the picture's detail**: the reducer weighs how far the surface moves,
  not how the picture stretches over it, so a reduced model's picture can smear where large triangles now
  cross it (a spear's blade at a tenth of its triangles). Look at `--pictures` and ask for fewer by less.
