# SMAK API

Everything is exported from `src/index.mjs`. A model is a Node `Buffer` holding the whole `.mdl` file. Functions
that change a model return a **new** buffer and leave the one they were given alone. Nothing here touches the
disk: read with `readFileSync`, write with `writeFileSync`.

```js
import { readFileSync, writeFileSync } from "node:fs";
import { readMdl, swapMesh, check, sheet, png, workshop } from "./smak/src/index.mjs";
```

Words used below: `which` is a texture's or an animation's number or its name. `where` is
`{ bodypart, model, mesh }`, three numbers. A matrix is 3 rows of 4 and takes a bone's space to model space.

## Reading a model (`core/mdl.mjs`)

| Function | Gives |
| --- | --- |
| `readMdl(b)` | `{ bones: [name], textures: [{ name, flags, width, height, index }], bodyparts: [{ name, base, models: [{ name, numverts, numnorms, meshes: [{ numtris, skinref, texture }] }] }] }`. Throws unless the file is a studio model, version 10. |
| `readMesh(b, model, mesh)` | The mesh's triangles: `[[{ p, n, bone, s, t } ×3]]`. `p` and `n` are in the space of `bone` (a number); `s`, `t` are pixels of the mesh's texture. `model` and `mesh` are the objects from `readMdl`. |
| `bones(b)` | `[{ name, parent, pos, rot, scale }]` as they rest. |
| `boneParents(b)` | `[parent]`, -1 for a root. |
| `bodyOf(b, body)` | For a body number, the submodel shown of each bodypart: `[index]`. The body number of submodel `k` of a bodypart is `k * base`; add one from each bodypart. |
| `skinFamilies(b)` | `[[texture number for each skinref]]`, one list a family. A model shown with skin `n` wears family `n`. |
| `textureOf(b, which)` | `{ name, flags, width, height, pixels, palette }`, copied out. |
| `sequences(b)` | `[{ name, fps, frames, loops, flags, activity, actweight, movement, motiontype, speed, bbmin, bbmax, blends, blendtype, blendstart, blendend, group }]`. `blends`: how many animations it blends between; `blendtype`, `blendstart`, `blendend`: for each of two axes, the `MOTION` bit the game's value turns (`XR` on Half-Life's aiming) and the values its first and last blend stand for. `activity`: what a monster's code asks for it as (`ACTIVITY[n]` is its name, for those known), `actweight` how often it is picked among its activity's. `movement` `[x, y, z]`: how far the model travels in one play of it (the frames stay in place); `speed`: that in units a second, `distance * fps / (frames - 1)`; `motiontype`: the `MOTION` bits (`LX` 64, `LY` 128, `LZ` 256 for the axes of the travel). `bbmin`, `bbmax`: the box about the model through the animation, which the engine culls by. `group` is not 0 for an animation kept in another file. (`move` and `motion` are `movement` and `motiontype` under their older names.) |
| `sequenceAt(b, which)` | The animation's number, or -1. |
| `readSequence(b, which, blend = 0, groups)` | What `sequences` tells, plus `index` and `frames[frame][bone] = [x, y, z, rx, ry, rz]`. |
| `frameValues(b, seq, frame, blend = 0, groups)` | One frame of that. Throws, naming the bone, when the file's values for a bone end before that frame (a broken file). An animation kept in another file (`group` not 0) is read from `groups[group]`, that file's bytes (`sequenceFilesOf`); without it, it throws "an animation kept in another file". |
| `sequenceGroups(b)` | `[{ label, name }]`: the first (`default`) the model's own file, each after it a file of animations, `name` as the model says it (`models\hgrunt01.mdl`). The engine loads them by that name, so a copy of the model under a new name still plays the original's. |
| `sequenceFilesOf(file, b)` | The files of animations beside `file`, one for each group: `[undefined, <name>01.mdl's bytes, ...]`, undefined where one is not there (`core/studio-file.mjs`; `sequenceFileOf(file, n)` is the path). |
| `modelBoxes(b)` | The header's `{ eyes, min, max, bbmin, bbmax }`. |
| `events(b, which)` | `[{ frame, event, type, options }]` of one animation. |
| `attachments(b)` | `[{ name, bone, pos }]`: `bone` a number, `pos` in that bone's space. |
| `hitboxes(b)` | `[{ bone, group, min, max }]`: `bone` a number, the box in that bone's space, `group` what was hit (`HITGROUP`: generic 0, head 1, chest 2, stomach 3, leftArm 4, rightArm 5, leftLeg 6, rightLeg 7; a mod may have more). |
| `boneControllers(b)` | `[{ bone, type, start, end, rest, index }]`: the bones the game's code turns itself (a head that follows). `type`: which of the bone's six values (`MOTION.X` ... `MOTION.ZR`, with `MOTION.RLOOP`); `start`, `end`: its range, degrees for an angle; `index`: which of the entity's controllers (0 to 3; 4 the mouth). |
| `drawnCorners(b)` | `[{ name, corners }]` for each submodel: how many corners the engine draws for it. |

## Poses

| Function | Gives |
| --- | --- |
| `restPose(b)` | Every bone's matrix with the bones at rest. |
| `poseOfValues(values, parents)` | Every bone's matrix for a frame of six numbers a bone, each bone's parent given: `poseOf` for a skeleton that is not the file's (bones added). |
| `poseAt(b, seq, frame, blend = 0, groups)` | The same at one frame of an animation (`seq` is a number). Throws as `frameValues` does when a bone's values end before that frame, or the animation is in a file not given. |
| `poseBetween(b, seq, at, loop = true, groups)` | At a moment between two frames (`at` may be fractional). An animation kept in another file is read from `groups`, as `poseAt` reads it. |
| `poseOf(b, values)` | For a frame given as numbers (`[bone][6]`), not yet in the file. |
| `boneMatrices(list, values?)` | The same for a list of bones `[{ parent, pos, rot }]` that is not in a file. |
| `mul34(a, b)`, `apply34(m, p)`, `inverse34(m)` | Matrix times matrix, matrix times point, inverse of a rigid matrix. |

A point of a mesh in model space, in some pose: `apply34(pose[corner.bone], corner.p)`.

## Changing meshes

| Function | Does |
| --- | --- |
| `replaceMesh(src, where, mesh, texture)` | Replaces one mesh. `mesh`: `{ bone, verts, norms, tris: [[[vert, norm, s, t] ×3]], vertBones?, normBones? }` (what `meshOf` returns). `texture` is added to the file unless one of that name is there. |
| `addMesh(src, { bodypart, model })` | One more mesh in a submodel, empty; `replaceMesh` fills it. For a part that needs a texture of its own. |
| `addModel(src, bodypart, name)` | One more submodel in a bodypart, with one empty mesh. Its number is the old count. |
| `addBodypart(src, name, models = [name])` | One more bodypart after the others, a submodel (with one empty mesh) for each name in `models`. Its base is the product of the counts before it, so every body number the file had shows what it showed and the new bodypart's first submodel. The engine draws a submodel of every bodypart: one of a single submodel is always shown. |
| `removeBodypart(src, which, { renumber, keep })` | A bodypart taken out (`which`: its number or name), the counterpart of `addBodypart`: those after it move up one, and every one left gets the base a compiler writes, so the body numbers are counted again. → `{ mdl, removed: { name, models: [{ name, tris }] }, bases, bodies: [{ was, now }], changed }`: `bodies` maps every body number the file had to the one that shows the same submodels now. Where the new bases would make a number the file had show another submodel of a bodypart that stays (the one taken out had several, and one after it has several too), it throws naming them, unless `renumber: true` (take the new numbers; `changed` lists the old ones that now show something else) or `keep: true` (keep the other bodyparts' bases: every number shows what it showed of them). Throws for a bodypart it has not, or its only one. |
| `emptyMesh(src, where)` | Leaves a mesh without triangles. |
| `filterMesh(src, where, keep)` | Keeps the triangles for which `keep([bone, bone, bone])` is true. |
| `addBones(src, [{ name, parent, pos, rot }])` | More bones after the ones it has, at rest in every animation. Old bones keep their numbers. |
| `insertBones(src, [{ name, parent, pos, rot, at, adopt }])` | New bones put among the old ones, at rest in every animation. `at`: its number in the new list (the places left go to the old bones in order, then to new bones without `at`). `parent`: a number is an old bone by its number in the file as given, a name one of the new bones; it has to come first. `adopt`: old bones (by their old numbers) that hang from the new bone instead, only from their own parent and with `rot` [0, 0, 0]: their rest moves by `pos`, so every frame keeps them where they were. Parents, corners' and normals' bones, attachments, hit boxes, bone controllers, motionbone and animation tables are renumbered. |

For a whole body made from triangles, `putBody` (under "Working by place") does `addModel`, `meshOf` and
`replaceMesh` in one call, and warns when the body it replaces was painted for another layout.

## Changing textures

| Function | Does |
| --- | --- |
| `replaceTexture(src, which, texture, { quiet }?)` | Another picture on an existing texture: `{ width, height, pixels, palette, name?, flags? }`. Of the same size it is written in place; of another size, the corners that wear it are moved to match. With several skin families: a mesh has one set of corners, in pixels of the texture it wears in the **first** family, so those are the meshes whose corners move, and the textures a mesh wears in the other families have to be of the same size. A new size that leaves a mesh with pictures of different sizes in different skins is told on the console (unless `quiet`): replace the others at that size too, in any order. |
| `retexture(src, where, texture, uvOf?)` | Gives **one mesh** another texture; the others that wore the old one keep it. `texture` is added to the file unless one of that name is there, as in `replaceMesh`: the file's own is then worn as it is, at its own size, so calling it twice adds nothing twice. `uvOf(triangle, corner)` returns `[u, v]` (0 to 1) to lay it out again. |
| `withTextures(src, tfile)` | For a model whose textures are in `<name>t.mdl`: a copy with them inside. |
| `ownPixels(src, { islands, body, mesh, tex, name, most = 512, pad = 2 })` | Some triangles given a picture of their own (`check/reskin.mjs`): moved into a new mesh of their submodel (one for each mesh they were in), wearing a new texture that begins as a copy of the box of pixels they lay on, `pad` pixels about it. For one plate of an armour whose one rust is laid over every plate, one body of several that share a picture. `islands`: an id or a list (`uvIslands`); `body`: a body number; `mesh`: `{ bodypart, model, mesh }`; `tex`: only what wears that texture. What is given is asked for together, and must come to one texture. A box that runs past the picture's edge (a picture laid over and over) goes on from its other side. At its own size the palette's numbers are copied as they are; a box with a side over `most` is made smaller to fit (cut to 256 colours again; a masked one keeps its holes) and the corners follow. The new texture keeps the old one's flags; `name` unless told is the old one's with `_own`. Every mesh, submodel and body keeps its number; the islands are numbered again, the moved ones last. → `{ mdl, texture, width, height, scale, box, moved, meshes, islands (their new ids), warnings }`. Throws when nothing, or more than one texture, is asked for, and when the result has a `check` error the original had not. Several skin families: the moved triangles wear the copy in each. |
| `moveTriangles(src, where, pick, texture, uvOf?)` | What `ownPixels` is made of: the triangles `pick(i)` accepts of one mesh moved into a new mesh after the others of its submodel, wearing `texture` (added unless the file has one of that name), their points and normals copied into it (the engine lights normals mesh by mesh). `uvOf(i, corner, [s, t])`: the corner's place in the new picture, in its pixels. → `{ mdl, mesh, moved }`. |

Texture `flags` (studio.h's `STUDIO_NF_` bits, added together; `TEXTURE` names the ones the kit draws): 1 flat
shaded, 2 chrome (the picture from the way the surface faces the eye; older GoldSrc right only at 64x64), 4 **full
bright** (drawn unlit at its own colours: lit panes, eyes that glow; Xash's gl_studio.c does it, and Steam's
GoldSrc, whose client is closed, is not known to: try it in the game), 8 no mipmaps and 16 alpha (not drawn by the
kit), 32 additive (a glow added over what is behind), 64 masked (palette index 255 a hole). `buildMdl`,
`replaceTexture`, `putBody` and the rest write what a texture's `flags` say.

## Changing animations

| Function | Does |
| --- | --- |
| `replaceSequence(src, which, { frames, blends, fps, loops, activity, actweight, movement, motiontype, bbmin, bbmax })` | Other frames for an animation, in the place it had. What is not given stays (its events too). `frames[frame][bone][6]`; every frame lists every bone. `movement: [x, y, z]` says how far the model travels in one play (the frames are given in place) and sets the motion type's `LX`, `LY`, `LZ` for the axes it is not zero on (`motiontype` says the whole of it instead). With new frames the animation's box is measured again about the model's points through them, as studiomdl does, unless `bbmin` and `bbmax` say it. |
| `addSequence(src, { name, fps = 30, loops = false, frames, activity = 0, actweight, movement, motiontype, events, bbmin, bbmax, like })` | A new animation after the others. Its box is measured from its frames; with `like` (an animation's number) it is that animation's. |
| `setEvents(src, which, [{ frame, event, options, type }])` | Replaces an animation's events. |
| `addSequenceFrom(src, { from, frames, name, fps, loops = false, activity = 0, actweight, events = false, movement, like })` | A new animation after the others made of frames of one the model has, in the order `frames` gives: a kneel out of a sit-and-stand played backwards (`"80-57"`), a held pose (`"57,58,57"`). `fps` unless told is `from`'s; `events: true` carries `from`'s events on the frames taken, each to its frame's first place; `like` as `addSequence` (`true`: `from`'s box). `smak sequence-add <mdl> --from <name> --frames 80-57 --name x [--loop] [--fps n] [--events]`. |
| `frameNumbers(spec, count)` | The frames such a `spec` names, as a list: `"80-57"`, `"57-80"`, `"57,58,57"`, `"80-57,57"`, or a list of numbers. Throws, saying which, on one past the last frame. |

A bone whose new motion goes beyond what the file's 16-bit scale for it can hold gets a wider scale, and every
animation of the file is written again by it. Animations kept in other files (`group` not 0) make that fail.

## A skeleton's proportions (`make/reproportion.mjs`)

`reproportion(src, factors, { mirror = true, ground, stride, body = 0, groups, fit = true, hitboxes = "along" })` →
`{ mdl, factors, mirrored, stride, lift, ground, boxes, along }`

Bones made longer or shorter, every animation kept: a tall, thin robot on a soldier's skeleton.

```js
const groups = sequenceFilesOf(file, src);          // hgrunt01.mdl ...: read for the boxes, never changed
const { mdl } = reproportion(src, { "Bip01 L Thigh": 1.2, "Bip01 L Calf": 1.2, "Bip01 L Clavicle": 0.8,
  "Bip01 Spine": [1, 1, 1.05] }, { groups });
```

| Option | Meaning |
| --- | --- |
| `factors` | `{ bone: factor }`. **A factor is the bone's length**: it multiplies the place of every bone that hangs from it, in the bone's own axes; the bone itself stays where its parent has it (`"Bip01 L Thigh": 1.2` puts the knee 1.2 times as far down). A number for all three axes, `[x, y, z]` for each (a Biped bone's x runs down its length). A bone by its name, or a Biped bone in any of its names (`boneIn`: `"Bip01 L Thigh"` is hgrunt's `"Bip01 L Leg"`, `"Bip01 L Calf"` its `"Bip01 L Leg1"`, `"Bip01 L Clavicle"` its `"Bip01 L Arm"`). |
| `mirror` | The other side's bone (`otherSideOf`) gets the same factor unless it is given its own. |
| `stride` | What the roots' x and y and every animation's travel (`movement`) are multiplied by. Unless told, measured: how much longer the leg is from the highest bone above the foot whose length changed (the hip) to the foot, in the reference pose. |
| `ground` | The reference pose: `{ seq, frame }`, `{ seq: null }` for the bones at rest; unless told, the first idle (activity 1), frame 0. Its lowest point is the ground. `false`: the roots' height is left as it was (the feet sink). |
| `fit` | The roots' height becomes `slope * z + lift`, fitted by least squares over every frame of every animation that can be read whose lowest point stands on the ground (within 1 unit): standing, walking, crouching and lying keep their lowest point where it was. `false`, or too few frames standing: the slope is the stride's and the lift puts the reference pose's foot back. |
| `body` | The body number whose points the ground is measured on. |
| `groups` | The files of animations (`sequenceFilesOf`): their animations' boxes are measured through them, and the ground fitted over them too. |
| `hitboxes` | `"along"`: a hit box on a bone that changed is longer or shorter along the bone by the factor on that axis, and as thick across it as it was (a shorter spine is not a thinner target). The axis along a bone is the one its children stand out along most (for a bone of no side, its children of no side: a neck's head, not its clavicles; x, as Biped's, for a bone with none); `along` says it for each such bone (`{ "Bip01 L Thigh": "x" }`). `"all"`: every axis times the factor, as before 0.23. |

How it works: a frame's value is the bone's rest plus a stored step times the bone's scale, so the rest
position and the position scale of a bone multiplied together multiply that position in every frame of every
animation, those in `<name>01.mdl` files too, with no animation written again and no step rounded. The three
angles of every bone in every frame are what they were, to the bit.

- **Points stay in their bone's space**: they move with their bone and keep their shape (rigid pieces are not
  stretched; a skinned body whose thigh grows opens a gap at the knee).
- **Hit boxes** on a bone that grows grow along it (a thigh's box reaches the new knee) and keep their thickness
  across it (`hitboxes`); **attachments** are multiplied by its factor. The eye goes with the bone nearest it in
  the reference pose.
- **Boxes**: each animation's measured again through its frames, as studiomdl does, where they can be read
  (`boxes.measured`); the others' (`boxes.carried`, names), and the header's, carried axis by axis from the
  reference pose's box before onto after. A header box of zeros stays zeros.
- Returns `factors` (`{ bone: [x, y, z] }` of those not 1, by the model's names), `mirrored` (the bones given
  their other side's), `stride`, `lift`, `ground` (`{ seq, frame, bone, low, frames, slope }`: the reference, the
  bone its lowest point is on, how many frames the line was fitted over), `boxes`. Every factor 1 and no stride:
  the file back as it was, byte for byte.
- Not done: a position turned by a bone controller (none of Half-Life's monsters has one); blends are posed by
  their first for the ground.

`footSlide(src, seq, { feet, body = 0, parts, groups, contact = 0.5 })` → `{ seq, frames, movement, planted, mean,
most, lows, ground }`: how a walk's feet meet the floor, to hold a figure against the model it is built on, or a
skeleton before and after. Each frame, where each foot touches (the middle of its points within `contact` of its
lowest), the animation's travel added as the game moves the model; the lower foot bears the weight, and `mean`
and `most` are how far its touch moves across the floor from one frame to the next while the same foot is down
(`planted` such steps). `lows`: the lowest point of the feet each frame; `ground` the least and most of those.
`feet`: a pattern on bone names (Biped's Foot and Toe, in English or Italian) or a list of names or numbers, each
the left's or the right's by its name (L or SX, R or DX); `body` and `parts` (bodyparts' numbers) which points
count: leave out a weapon held low.

`setBoneValues(src, [{ pos, rot, scale }])` (by bone number, an entry undefined for a bone left alone) writes
bones' rest values and scales in place, nothing else touched: what `reproportion` is made of.
`setModelBoxes(src, { eyes, min, max, bbmin, bbmax })` writes the header's eye and boxes that are given.

`smak reproportion <mdl> "Bip01 L Thigh=1.2" "Bip01 Spine=1,1,1.05" -o out.mdl [--no-mirror] [--stride n]
[--reference <seq>[:frame] | rest] [--no-ground] [--body n] [--hitboxes all]` does it on the command line,
reading the files of animations beside the model.

## A monster's parts

| Function | Does |
| --- | --- |
| `setHitboxes(src, [{ bone, group = 0, min, max }])` | These hit boxes and no others. `bone`: a number or a name; `min`, `max` in the bone's space. Throws on a bone the model has not. |
| `autoHitboxes(what, { groups = {}, least = 0, thin = 1 })` | The boxes studiomdl makes by itself, as a list for `setHitboxes`: for each bone, a box about its own origin, every point it carries in any submodel, and the origins of the bones that hang from it; one no thicker than `thin` on some axis is left out. `groups`: `{ "Bip01 Head": HITGROUP.head }`, a bone's group and that of the bones under it that say none. `least`: the fewest points a bone must carry (studiomdl counts none). `what`: a file, or what `writeMdl` takes. Changes nothing. |
| `setAttachments(src, [{ name, bone, pos }])` | These attachments and no others. Game code knows them by number: keep the ones a model has, in order, and add after. |
| `setBoneControllers(src, [{ bone, type, start, end, rest = 0, index = 0 }])` | These bone controllers and no others; the bones' own note of which controller turns them is rewritten to match. |

Each returns a new file in which nothing else has changed. `MOTION`, `HITGROUP` and `ACTIVITY` hold the
format's numbers by name (`ACTIVITY` only those read off Half-Life's own models: 1 `ACT_IDLE`, 3 `ACT_WALK`,
4 `ACT_RUN`, 30 `ACT_MELEE_ATTACK1`, 36 `ACT_DIESIMPLE`...).

## A model's contract with a mod (`check/contract.mjs`, `make/biped.mjs`)

| Function | Gives |
| --- | --- |
| `contractOf(b)` | What a mod's code may ask of the model by name or number: `{ bones, sequences: [{ name, activity }], attachments: [{ bone }], bodyparts: [{ name, bodies }], hitgroups, controllers }` |
| `compareContract(reference, made)` | `{ faults, notes }`: what `made` breaks of `reference`'s contract (a bone, an animation or its number or activity, an attachment's bone, a bodypart's bodies), and what it has beyond it. `smak contract <mdl> --against ref.mdl` prints it |
| `boneIn(name, names)` | The name among `names` that is the 3ds Max Biped bone `name` stands for, in English, Italian (`Bip01 Testa`, `Bip01 SX Mano`) or the older limb names (`Bip01 L Arm1`); null when none is |
| `otherSideOf(name)` | The bone on the other side: `L` and `R`, `SX` and `DX` |

`smak contract <mdl> [--json] [--against reference.mdl]` prints it, or what the model breaks (exit code 1).

## Before sharing (`check/publish.mjs`)

`publishCheck(folder, { game, ours = [], home })` → `{ errors, warnings, facts }`, each a sentence naming the
file. Errors: a file that is one of `game`'s byte for byte (found by size, then hashed), one of the game's
textures (the same pixels and palette, whatever its name) inside a `.wad` or a `.bsp` of the folder, a path into
`home` or any person's folder (`C:\Users\<name>`, `/home/<name>`) in a text or a map's entities, a key or a
token. Warnings: another absolute path in a text or a map, an archive over 50 MB, no readme. `ours`: paths in
the game's folder that are the person's own and not held against. `smak check --publish <folder>`.

## Animations written as poses (`make/animate.mjs`, exported as `animate`)

A pose is `{ q, p }`: for each bone a turn and a place, plain data that no call changes.

| Function | Does |
| --- | --- |
| `rigOf(bones)` | A skeleton ready to be posed, from a model's bytes or a bone list: `{ bones, names, index(name), rest }` |
| `poseOf(rig, { bone: { turn, move } }, base = rig.rest)` | A pose from another. `turn`: `{ x, y, z }` in degrees about the MODEL's axes (applied x, y, z), or a list `[[axis, degrees]]` in the order written; from where the bone is in `base`, carried by its parent. `move`: `[x, y, z]` in the model's axes |
| `reach(rig, pose, { bones: [upper, lower, end], to, bend = [1, 0, 0], level, aim, grip })` | The limb bent so that `end` is at `to` (a place in the model). `bend`: where the middle joint points. `level`: true keeps the end bone's turn of rest, a `turn` gives it that one. `aim: { axis, dir, edge, edgeDir }`: the end bone turned so that what it holds points along `dir` in the model; `axis` is the held thing's direction as it lies with the skeleton AT REST, and `edge` with `edgeDir` (together) turns it about that axis too (a blade's edge); without them, the shortest turn from how the hand carries it. `grip`: a point of the model at rest (the middle of a sword's grip): the limb is bent so that the grip, not the joint, is at `to`. The pose comes back with `reached` and `short` |
| `hold(rig, pose, bone, turn)` | The bone turned so that it stands at a turn of its own in the MODEL whatever its parents do: a lantern hanging straight from a swinging fist. `turn`: from how it stands at rest, in the model's axes (as `poseOf`'s; none: as at rest), or `{ q }`, its whole turn. Put it in `animate`'s `each`: between keys the shortest turns would let it drift |
| `grounded(mdl, { seqs, body = 0, ground = 0, touch = false })` | A built model's animations kept on the ground: every frame of `seqs` (names or numbers; all unless told) whose lowest point of `body` is under `ground` has its root bones lifted by that much (`touch`: one that floats is lowered too). → `{ mdl, frames: { name: frames }, lifted: { name: [the lift of each frame] } }`: `frames` for a builder that makes the model again with `buildMdl` |
| `mirror(rig, pose, { pairs })` | Left and right changed over, by the bones' names (` L `/` R `, `.L`/`.R`, `Left`/`Right`) or `pairs` |
| `between(a, b, t)` | The pose a part of the way from one to another, each bone by its shortest turn |
| `animate(rig, { frames, loops, keys: [{ at, pose, ease }], each })` | Frames for `addSequence`, `replaceSequence`, `writeMdl`. `ease`: `smooth`, `linear`, `in`, `out`, how a key is arrived at. `loops`: the last frame is the first again. `each(pose, frame, part)` returns the frame's pose |
| `valuesOf(rig, pose)` | One frame: `[x, y, z, about x, about y, about z]` a bone |
| `worldOf(rig, pose)` | Each bone's turn and place in the model |
| `matricesOf(rig, pose)` | The pose as bone matrices: `render(mdl, { pose: matricesOf(rig, pose) })` draws it |
| `track(rig, frames, bone, at)` | Where a point of a bone is, frame by frame |
| `seam(rig, frames)` | `{ degrees, units, bone }`: how far the last frame is from the first |
| `stride(rig, frames, { feet, fps, ground = 1 })` | `{ speed, slide, low, feet }`: the speed the planted feet ask for (units a second), how far off it they are at the worst, the lowest a foot goes |

The turns themselves, quaternions `[w, x, y, z]`, for a script that turns things on its own: `qmul(a, b)` (b, then
a), `qconj`, `qunit`, `qturn(q, v)` (a direction turned), `qabout(axis, radians)`, `qofAngles([rx, ry, rz])` and
`anglesOf(q)` (the engine's three angles, about x then y then z), `qslerp(a, b, t)`, `qarc(from, to)` (the shortest
turn of one direction onto another), `qframes(d, e, D, E)` (a pair of directions onto another: `d` onto `D`, `e` as
near `E` as it goes), `degreesOf(q)`, `turnOf(turn)` (a `turn` as `poseOf` takes it, as one quaternion). A bone's
whole turn in the model in a pose is `worldOf(rig, pose)[i].q`; at rest, `rig.world[i]`.

## Whole models

`writeMdl({ name, bones, sequences, textures, skins, bodyparts, hitboxes, attachments, controllers, eyes, min, max, bbmin, bbmax })`
writes a file from tables that are already in the format's own terms (points in bone space, normals indexed per
mesh). Prefer `buildMdl`, which takes triangles and passes the rest on.
A bodypart needs one submodel at least (the engine divides a body number by how many it has): one with none is
refused. A submodel with no meshes is what shows nothing.

`modelName(b)` reads the name in the header (studiomdl writes the file's path there:
`D:\half-life\TS\models\player\merc\merc.mdl`); `setModelName(src, name)` writes another, 1 to 63 Latin-1
letters, nothing else changed: a model made from another says that one's name inside until told.

`buildMdl({ name, bones, bodyparts, sequences, smooth = 40, ownNormals = false, hitboxes, attachments, controllers, eyes, min, max, bbmin, bbmax })`
(`make/build.mjs`):

```js
buildMdl({
  name: "crate.mdl",
  bones: [{ name: "crate", parent: -1 }, { name: "lid", parent: 0, pos: [-12, 0, 18] }],
  bodyparts: [{ name: "body", models: [{ name: "crate", meshes: [{ tris, texture }] }] }],
  sequences: [{ name: "idle", fps: 10, loops: true, frames: [ /* [bone][6] */ ] }],
});
```

- `tris`: `[[{ p, uv, bone } ×3]]`. `p` in model space with the bones at rest; `uv` 0 to 1; `bone` a name or a
  number (the first bone when left out).
- Meshes that give a texture of the same name share it.
- With no `bones`: one, called `root`. With no `sequences`: one, `idle`, holding the rest pose.
- A sequence may also say `activity`, `actweight`, `movement: [x, y, z]` (how far the model travels in one play,
  its frames given in place; sets the motion type as `replaceSequence` does), `motiontype`, `flags`,
  `events: [{ frame, event, options, type }]`, and `bbmin` and `bbmax`. Its box, when not told, is measured about
  the model's points through its frames, as studiomdl does.
- `hitboxes`: `[{ bone, group, min, max }]` (in the bone's space), or `"auto"`, or `autoHitboxes`' options.
  `attachments`: `[{ name, bone, pos }]`. `controllers`: as `setBoneControllers`. A bone is a name or a number.
- `eyes: [x, y, z]`: where it sees from (the header's `eyeposition`). `min`, `max` (the box it moves with) and
  `bbmin`, `bbmax` (the box it is clipped by): the header's four; each is the model's own box through its
  animations unless told (studiomdl leaves them at zero unless the QC says: pass zeros for that).
- Without those: no hit boxes, attachments or bone controllers. One blend an animation, unless it gives
  `blendFrames` (each further blend's frames, as many as `frames`) with `blendtype`, `blendstart` and
  `blendend`, as `sequences` reads them.

## From an .obj file (`check/obj.mjs`)

A Wavefront .obj (Blender, a script, any tool) read as text and made into a model. Nothing here reads the disk:
hand over the text of the .obj and of its .mtl, and the pictures by material. `smak obj` does that for files
that lie together.

| Function | Gives |
| --- | --- |
| `readMtl(text)` | `[{ name, colour, picture }]`: each material's `Kd` as `[r, g, b]` from 0 to 1 (or null) and the file name its `map_Kd` gives (or null). |
| `readObj(text, { mtl })` | `{ groups: [{ object, group, material, tris }], materials, libraries }`. `tris` are the kit's triangles, `[[{ p, uv, n, group, smooth } ×3]]`: `p` in the file's own axes and units, `uv` from the picture's top left (the file's `vt` turned over; `uv.given` false for a corner without one), `n` its `vn` as the file has it (its own axes, any length) or null. `mtl`: the .mtl's text, or what `readMtl` gave. `libraries`: the names on its `mtllib` lines. Reads `v vt vn f o g usemtl mtllib s`, the four forms of a corner, numbers under 0; fans faces of more than three corners; passes over the rest. Throws, naming the line, on a broken file. |
| `objMeshes(obj, { scale = 1, up = "y", turn = 0, centre, ground, tiling = "repeat" })` | `{ meshes: [{ material, tris, repeat }], warnings, box }`: the triangles in GoldSrc's axes and units, one list a material, ready for `buildMdl` or `putBody`. A corner's `n` is the file's normal there, stood up as its point is (null where the file has none, or one that looks the other way from its face: that is warned of), which those two keep with `ownNormals: true`. `repeat`: how many copies of the picture its texture must hold side by side. |
| `objModel(obj, options)` | `{ mdl, warnings, report }`: a whole model through `buildMdl`, checked for both engines. `report`: `{ name, triangles, points, bodyparts, box, textures: [{ name, material, width, height, from }] }`. |
| `objToMdl(obj, options)` | The model's bytes alone; the warnings go to the console unless `quiet`. |

Options of `objModel` and `objToMdl`:

| Option | Default | |
| --- | --- | --- |
| `name` | `"model.mdl"` | What the file calls itself. |
| `textures` | `{}` | `{ material: picture }`: a PNG or BMP file's bytes, a texture, or an image. A material without one wears 16x16 of its `Kd` colour (grey when it has none). |
| `scale` | 1 | Units for one of the file's: 39.37 for metres. |
| `up` | `"y"` | `"y"`: the file's `+y` becomes `+z`, its `+z` (its front) `+x`, its `+x` the model's left (`+y`); a turn, not a mirror. `"z"`: as it is. |
| `turn` | 0 | Degrees about the upright axis, anticlockwise seen from above. |
| `centre`, `ground` | false | The box's middle at the origin; the lowest point at z = 0. Both: centred across and along, standing on the ground. |
| `maxTextureSize` | 512 | A picture with a longer side is made a whole number of times smaller. |
| `tiling` | `"repeat"` | Coordinates that run over several copies of the picture: `"repeat"` lays the picture that many times in its texture (up to 8 each way), `"refuse"` throws, `"keep"` leaves them. A triangle that lies whole in another copy is moved back in every case. |
| `smooth` | 40 | The angle under which faces share a normal where the file has neither `vn` nor `s`. |
| `quiet` | false | `objToMdl`: no warnings on the console. |

- **Normals.** The file's `vn` are kept: `objMeshes` stands each up with its point and `objModel` stores it
  as that corner's normal, so the model is lit as the tool that made it meant. (`putBody` and `buildMdl` keep
  them when given `ownNormals: true`; otherwise they work normals out, and the `vn` only decide the creases: at
  a point, faces that name the same normal share one.) A corner without a `vn`, and a triangle whose normals
  look the other way from its face (warned of), get theirs worked out by `meshOf`. Without `vn`, `s 1` smooths
  its faces and `s off` leaves each flat; with neither, `smooth` decides.
- **Limits met.** More than 2048 points or normals, or 5461 triangles, in a submodel: shared out over bodyparts
  that body 0 shows together (over 32: refused). With the file's own normals the light is the same on both
  sides of where two bodyparts meet; without them a faint line may show there on a smooth surface. A picture over `maxTextureSize`: made smaller. Names: a
  texture is its material's name, cut, unique, ending `.bmp`. Materials with the same picture share a texture.
- **Refused**, in words: a face that names a point the file has not, a face of fewer than three corners, a
  number that is none, a file without faces or with none of any area, coordinates over more than 8 copies of a
  picture, a picture that is neither PNG nor BMP nor a texture, and whatever `check` would call an error.
- **Not read.** Curves and surfaces, lines and points, colours on points, an .mtl's other maps and its
  transparency, and a PNG's see-through parts as holes (pass a texture from `masked`). A concave face of more
  than three corners is fanned wrongly: triangulate it in the tool.

As a new body of a model that is there: `putBody(src, { name, tris: objMeshes(obj, options).meshes[0].tris,
texture, bone, pose })`.

## Putting a piece into a model (`make/build.mjs`, `make/fit.mjs`, `make/mesh.mjs`)

`swapMesh(src, { body, pick, piece, texture, place = "fit", size = "old", name })` → `{ mdl, report }`

| Option | Meaning |
| --- | --- |
| `body` | The body number that shows the submodel (of the first bodypart). |
| `pick(mesh)` | True for the meshes that are the old piece. Default: all whose texture name does not match `HANDS` (`/hands|arms|body/i`). |
| `piece` | `{ tris, haft?, rig?, bones? }`. `haft: true`: it is laid along the old one's handle. `rig: "nearest"`: each corner takes the bone of the old piece's nearest corner. `bones: [, "name"]`: corners with `part: n` go to that bone. |
| `texture` | The piece's texture. |
| `place` | `"fit"`: laid over the old piece's outline. `"bone"`: its points are already in the carrying bone's space. |
| `size` | `"old"`: stretched to the old length. `"own"`: keeps its drawn size, its low-x end held where the old one's was. |

`report`: `{ model, bone, bones, was, now, verts, scale, turn, left, boxOff, textures }`.

The parts it is made of, for when you need them separately:

| Function | Gives |
| --- | --- |
| `measure(src, body, pick, what)` | `{ info, j, model, meshes, rest, bone, original }`: the picked meshes, the bone that carries most of them, and their triangles in that bone's space. |
| `frameOf(tris)` | A frame `{ X, Y, Z, o }`: the piece's own axes (principal axes by area) and its middle. |
| `bestTurn(pieceTris, originalInItsAxes, haft)` | `{ k, name, left, at(p) }`: the scale, which of four turns fits best, what is left over, and the function that places a point. |
| `shieldFit(original)` | For a thing with straps on its back: its frame and measures. |
| `into(frame, p)`, `out(frame, p)` | A point into a frame's axes and back. |
| `meshOf(original, tris, texture, bone, smooth = 40)` | Triangles as `replaceMesh` takes them: shared points, smoothed normals, winding as the original's (pass `null` for the format's usual). A corner may carry `bone` and `to` (the matrix taking `p` into that bone's space), for creases `group` and `smooth`, and a normal of its own, `n`: see below. |
| `FRONT` | -1: the sign of `(b - a) × (c - a)` against the outward normal in a compiled model. |

**Creases.** Faces that meet at a point share a normal there when they meet at less than `smooth` degrees: one
angle for the whole mesh. Two fields on a corner refine that, and `buildMdl`, `swapMesh` and `putBody` pass them on:
`group` (any number): faces share a normal only with faces of the same group, so the line between two groups is a
hard edge however gentle the bend; and `smooth`: that corner's own angle in place of the mesh's (180: smooth
whatever the bend). The workshop's `turn` gives each side of a ring marked `crease: true` a group of its own, and
every part it makes (a ridge, a boss, each side of a leaf) one too; a part's `smooth` option sets the angle.
Corners without either behave as they always did.

**A corner's own normal.** A corner may carry `n`, in the space `p` is in and looking out of the surface (any
length over nothing): `meshOf` stores it as it is, in place of the one it would work out. It is for normals that
come with a shape, as an .obj's `vn` do: a surface cut over two submodels is then lit alike on both sides of the
cut. `buildMdl` and `putBody` read `n` only with `ownNormals: true`, so that triangles which happen to carry one
(a point from a workshop surface's `at`) are built as they always were; `swapMesh` never does.

## Working by place (`make/place.mjs`)

`pose` below is what `posed` takes: `{ seq, frame, body, skin }`. Points are in model space as the model stands in it.

| Function | Gives |
| --- | --- |
| `surface(src, pose)` | `[{ p, n, tex }]`, one a triangle: its middle, the way it faces, its texture's name. |
| `spot(surface, near, facing?, on?)` | The place of the surface nearest `near` that looks towards `facing` and wears one of the textures `on`; or null. |
| `paint(src, fn, { pose, only, islands, layers, soft = 1, apart = 3 })` | `{ mdl, shared }`. `fn(place)` returns the new colour (0 to 1) of the pixel that colours the point `place.p`, or nothing to leave it. `only`: texture names; `islands`: island ids (see `uvIslands`); `soft`: see below. `shared[name]`: the share of that texture's painted pixels worn by two places more than `apart` units from each other. `layers`: `{ name: declaration }`, see "Layers" below. A list in place of `fn` paints several passes: see below. |
| `uvIslands(src, pose)` | `{ list, of(t) }`: the islands of the model's pictures, each the triangles of one texture joined through the edges they share in it. `list[id]`: `{ id, tex, tris, box: [x0, y0, x1, y1], uses: [{ bodypart, model, mesh, body, part, name, tris }], bones: [names], mn, mx, mid, n, border, open, bodies: [{ body, tris }] }`. `border` (the length of its edge, in pixels) and `open` (how much of that is a hem) are measured mesh by mesh and are the longest of the meshes in `uses`, not their sum: two bodies laid on the same pixels give one border, not two. `of(t)`: the id for anything with `where` and `tri` (a triangle of `posed`, what `dropTriangles` and `paint` hand over). |
| `islandMap(src, which, { scale, body })` | A picture, as `uvMap`: the texture greyed, each island tinted and numbered, open borders white and seams in the island's colour. Also returns `scale`, `texture`, `islands` (the ids drawn). `body`: only what that body number's submodels use. |
| `layersOf(src, layers, { pose, tex })` | `{ name: layer }`: the layers of one texture, made on their own. See "Layers" below. |
| `layerMap(src, which, layers, { scale, pose, body, min = 30 })` | A picture, as `islandMap`: the texture greyed, each layer tinted in a colour of its own and named in the corner, each region of `min` pixels or more numbered. `layers`: declarations, or what `layersOf` returned. Also returns `scale`, `texture`, `layers` (`{ name: { pixels, regions } }`). |
| `pieces(src, pose)` | `{ list: [{ id, tex, part, model, where, tris, mn, mx, mid }], of(t) }`: the groups of triangles that touch, mesh by mesh, of every submodel. `of` takes what `dropTriangles` hands its rule. |
| `dropTriangles(src, drop, pose)` | `{ mdl, gone }`: without the triangles `drop({ p, mid, tex, part, model, where, tri })` accepts. |
| `graft(to, from, pick, where = { bodypart: 0, model: 0 }, move?, { missing }?)` | `to` with the meshes of `from` that `pick(mesh, model, bodypart)` accepts added to the submodel `where`, their textures with them. Bones are matched by name; a bone `to` lacks throws, unless `missing: "ancestor"`: its corners then hang on the nearest bone above it (in `from`'s skeleton) that `to` has, where they stand with `from` at rest (a jaw goes on the head). |
| `together([model or { mdl, body, pick, move }, ...])` | Several models on one skeleton as one model to draw: see "Several models as one" below. |
| `putBody(src, { name or body, tris, texture, bone, pose, bodypart = 0, smooth = 40, ownNormals, quiet })` | `{ mdl, body, warnings, report }`: a body made from triangles, as a new body or in the place of one: see "A body from triangles" below. |
| `layoutMoved(old, now, { body, from = body, tex, pose, tol = 2 })` | `{ name: { pixels, kept, moved, fresh, bare, share, warning } }`: how much of a body's picture is laid out otherwise than it was. |
| `carryPicture(old, now, { body, from = body, tex, fromTex, was, is, picture, moved, reach, pose, soft = 1 })` | `{ mdl, report }`: the painted picture of the old body carried to the new shape: see "A picture carried to a changed shape" below. |
| `copyBody(src, body, name, texture, { instead, bodypart = 0 })` | The model with one body again as a new submodel called `name`, after the others of its bodypart, wearing `texture`: the same points on the same bones. `body`: a submodel's name, or a body number (of `bodypart`). `texture`: the name of one in the file, a texture, or an image with a `name` (cut to 256 colours; of another size, the corners follow). `instead`: which of the old body's textures it takes the place of, when the body wears several. The new body's number is the bodypart's old count of submodels times its `base`. |

What `paint` hands its function, one object a call:

| Field | |
| --- | --- |
| `p`, `n` | The point of the body the pixel colours, in model space as the model stands in `pose`, and the way the surface faces there. |
| `rgb` | The colour there now, 0 to 1. In a later pass: as the passes before left it. |
| `tex`, `u`, `v` | The texture's name and the place in it, in pixels from its top left: the middle of the pixel (`x + 0.5`), or with `soft` the point inside it that is asked about. Not wrapped: a corner laid outside the picture gives a `u` outside it. |
| `bone`, `boneIndex` | The bone the point follows, by name and by number: that of the nearest of the triangle's corners. |
| `where`, `body`, `tri` | Its mesh `{ bodypart, model, mesh }`, the body number that shows that submodel, and the triangle's number in the mesh (the order of `readMesh`). |
| `island` | The id of the island of the picture the triangle is in (`uvIslands`). |
| `edge` | How far the pixel is from its island's border, in pixels: 0 on it, growing inwards. The border is that of the island within the triangle's own mesh. |
| `open` | The same to the nearest *open* stretch of the border: an edge that no triangle of the submodel goes on across in space (a hem, an armhole). The rest of a border is seams, where the surface goes on in another island or on the far side of this one. `Infinity` when the island has no open border. |
| `per` | Units of the model that a pixel covers in this triangle: `edge * per` and `open * per` are those distances in units, near enough (the scale is this triangle's, not that of every triangle on the way). |
| `at(u, v)` | The colour (0 to 1) of this texture at another pixel, as it stood before this pass. |
| `blur(r)` | That picture smoothed about this pixel with a bell `r` pixels wide each way, over the pixels this island lies on (those of the pass's triangles) and no others. A hole of a masked texture is left out. |
| `blur(r, { within, not, orig })` | The same, keeping to a layer: `within: "plate"` takes only pixels in that layer, `not: "mail"` leaves that layer's out (a name or a list of names; each pixel is weighed by the layer's value, or by one less it). `orig: true` smooths the picture as it was before the first pass. Still within the island. Where no such pixel is in reach, it is the island's plain blur. |
| `orig(u, v)` | The colour of this texture at a pixel as it was before the first pass. `orig()`: at this pixel. (`at` and `blur(r)` see what the pass before left.) |
| `busy(r = 3)` | How busy the picture was about this pixel before the first pass: how far each pixel's brightness is from the mean of the 5 by 5 about it, as a share of that mean, averaged over `r` pixels each way, within the island. On one armour: about 0.03 on smooth plate, 0.1 on ridged plate, 0.35 on mail's chequer. |
| `layer` | The layers of the call's options at this point, each 0 to 1: `layer.mail`. Read between the middles of the pixels about the point, so with `soft` a layer's edge comes out soft. Empty when the call has no layers. |
| `dist` | `dist.mail`: how far this point is from that layer's edge, in pixels. **Over 0 inside the layer, under 0 outside it**, 0 on the edge. |
| `region` | `region.mail`: the id of the layer's region this pixel is in (see `layersOf`), or -1. |
| `layerAt(name, u, v)`, `distAt(name, u, v)` | A layer's value and its distance at another point of the texture. |
| `distSmooth(name, r = 3)` | The layer's distance averaged over `r` pixels each way, at this point (`distSmooth(name, r, u, v)`: at another): for a line that does not step with the layer's noise. A layer declared with `smooth` has that in its `dist` already. |

`edge`, `open`, `at`, `blur`, `busy` and the layers' distances and regions cost nothing unless the function reads them.
`layer`, `dist`, `region`, `layerAt`, `distAt`, `distSmooth`, `orig` and `busy` answer for the point of the call in hand: use them inside it, not after it returns.

`soft: n` (2, 3, 4...) asks the function at `n` by `n` points inside each pixel, each with its own `p`, `n`, `u`,
`v`, `edge` and `open`, and writes the average; a point for which it returns nothing counts with the colour the
pixel had. So the edge of any shape comes out soft instead of as a staircase. It multiplies the calls by `n * n`.

Several passes: `paint(src, [pass, pass, ...], options)`. A pass is a function, or `{ fn, only, islands, pose,
soft, apart }`: what it leaves out is taken from `options`. Every pass sees the picture as the one before left
it, in full colour (8 bits a channel), in `rgb`, `at` and `blur`; each texture is cut to 256 colours once, after
the last. Painting in two calls instead cuts twice, and the second call sees no more than 256 colours.

```js
const ids = uvIslands(src, pose).list.filter((e) => e.tex === "coat.bmp" && e.n[0] > 0.5).map((e) => e.id);
const { mdl } = paint(src, [({ blur }) => blur(4), { soft: 3, fn: ({ p, rgb, edge }) => (edge < 2 ? [0, 0, 0] : p[2] > 50 ? [0.6, 0.1, 0.1] : rgb) }], { pose, islands: ids });
```

### Layers

A layer is a number from 0 to 1 for every pixel of one texture: what a picture says about itself (this is mail,
this a strap, this a rim line), made **once, from the picture as it was before the first pass**, and readable in
every pass. Declare them in `paint`'s options, in the order they build on one another:

```js
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const layers = {
  mail: { fn: ({ busy }) => busy(3) > 0.25, drop: 90, smooth: 3 },                     // told by its texture; specks off; an even edge
  plate: ({ rgb, dist }) => dist.mail < -1.5 && lum(rgb) > 0.2,                        // a later layer reads an earlier one
};
const { mdl } = paint(src, [
  ({ rgb, blur, layer }) => (layer.mail > 0.5 ? W.times(PLUM, 2 * lum(blur(5))) : copper(lum(blur(5, { within: "plate", orig: true })))),
  { soft: 3, fn: ({ dist, rgb }) => (dist.mail > -2 && dist.mail < 0 ? TAN : dist.mail > -3 && dist.mail <= -2 ? LINE : undefined) },    // a rim beside the mail, and its dark line
], { pose, only: ["armour.bmp"], layers });
```

A declaration is a function, or an object with any of:

| | |
| --- | --- |
| `fn(place)` | Returns 0 to 1, or true or false. It is handed what `paint` hands its function, of the picture as it is in `src`: `p`, `n`, `rgb`, `tex`, `u`, `v`, `bone`, `boneIndex`, `where`, `body`, `tri`, `island`, `edge`, `open`, `per`, `at`, `blur`, `orig`, `busy`, and `layer`, `dist`, `region`, `layerAt`, `distAt`, `distSmooth` for the layers declared before it. It is asked of every pixel that a triangle of the pose wears, whatever `islands` the passes keep to, and of a pixel past each border (as `paint` paints one); every other pixel is 0. |
| `image` | In place of `fn`: `{ width, height, rgb }` or `{ width, height, rgba }`. Its brightness (times its alpha) is the layer, stretched to the texture's size: a mask painted by hand, or `unpng(readFileSync(file))`. |
| `soft` | 2, 3...: `fn` is asked at that many points each way inside every pixel and the answers averaged. |
| `blur` | Softened: each pixel becomes the mean of the layer over that many pixels each way. With `over: "lit"`, the name of an earlier layer, only the pixels in that layer are counted: a soft layer that does not fade into a black shadow beside it. An `over` that names no layer declared before this one is refused at once, with the names there are. |
| `drop` | Regions of fewer pixels than this are taken out (a belt hole or a rivet's shadow is not mail). |
| `fill` | Holes of fewer pixels than this are closed. |
| `smooth` | Its boundary straightened: the distance to it is averaged over that many pixels each way and the layer made again from that, so that the layer, its regions and its `dist` all go by one even line. |
| `tex` | The one texture it is for (every painted one unless told). |

They are applied in that order: `blur`, `drop`, `fill`, `smooth`. A pixel is **in** a layer where its value is 0.5
or more: regions, holes and distances go by that. Layers are made for each texture the call paints, when the first
pass comes to it, with the model standing in the pose of the call's options (a pass's own `pose` does not move them).

`dist` is over 0 inside a layer (how far the nearest pixel that is out of it and worn by a triangle) and under 0
outside (how far the nearest pixel in it), so one number draws a rim on either side of an edge: `0 < d && d < 2`
is a band two pixels wide just inside, `-2 < d && d < 0` one just outside. The border of an island is not an edge
of a layer (the bare ground about an island counts as neither side): `edge` and `open` measure to that.

`layersOf(src, layers, { pose, tex })` makes the layers of one texture without painting: to look at them, to find
things by their regions, and to hand to `paint` as its `layers` afterwards so that they are not made twice.
`tex`: the texture's name (the first the pose shows unless told). It returns `{ name: layer }`, a layer being:

| | |
| --- | --- |
| `name`, `tex`, `width`, `height` | |
| `value` | A `Float32Array`, one number a pixel, row by row. |
| `dist` | The same of the distance to its edge. |
| `regions` | `[{ id, size, box: [x0, y0, x1, y1], centre: [u, v], mn, mx, mid, islands }]`: its connected regions (pixels in it that touch side to side), in the order their first pixel comes, row by row. `size` in pixels; `box` and `centre` in pixels of the texture; `mn`, `mx`, `mid`: the range in x, y, z of the body's points that wear the region, in model space as the model stands in `pose` (over both places where two share the pixels, as a left and a right leg; null for a region of an image that no triangle wears); `islands`: the ids of the islands it lies on. |
| `at(u, v)`, `distAt(u, v)`, `regionAt(u, v)` | The value and the distance at a point, and the id of the region there (-1 outside every one). |
| `distSmooth(r = 3)` | `dist` averaged over `r` pixels each way, as a `Float32Array`. |

```js
// three straps behind the legs and their buckles, found by rule: each buckle, and the dark regions at its height
const L = layersOf(src, { strap: ({ rgb, island, v }) => island === LEGS && v > 400 && lum(rgb) < 0.12, buckle: ({ rgb, island, v }) => island === LEGS && v > 400 && rgb[0] > rgb[2] + 0.08 && lum(rgb) > 0.2 }, { pose, tex: "armour.bmp" });
const straps = L.buckle.regions.filter((b) => b.size >= 60).map((b) => { const parts = L.strap.regions.filter((r) => r.size >= 100 && b.mid[2] > r.mn[2] && b.mid[2] < r.mx[2]); return { z0: Math.min(...parts.map((r) => r.mn[2])), z1: Math.max(...parts.map((r) => r.mx[2])), buckle: b.centre }; });
```

The command line draws and lists them: `smak layers <mdl> [layers.mjs] [name=expression ...] [--texture t] [--body n]
[--seq n] [--min 30] [-o out.png]`. `layers.mjs` is a module that exports `layers` (and `pose`, `tex` if it
likes): keep the declarations in a file of their own and the command and the painting script read the same ones.
`name=expression` declares a layer in one line, over what `fn` is handed, with `lum` and `sat` (the brightness
and the saturation of `rgb`) and `W` (the workshop): `smak layers m.mdl "mail=busy(3)>0.25" "dark=lum<0.12&&!layer.mail" -o l.png`.

Islands are numbered through the whole model, texture after texture, in the order their first triangle comes in
the file, and by the textures of the first skin family. Two submodels that lay the same triangles on a picture
share an island (`uses` lists both); `mn`, `mx`, `mid` and `n` are taken over all of them. `border` and `open`
are lengths in pixels. `tris` counts an island's triangles over every mesh that uses it, so an island that two
bodies lay on the same pixels has twice a body's own: `bodies` gives the count for each body number. The command
line draws them (with `--body n`, listing that body's own triangles): `smak islands <mdl> [-o dir] [--texture t] [--body n]`.

`copyBody`, like `addModel`, adds to one bodypart's count of submodels. The body numbers of the bodyparts after it
are counted from that, so in a model of several bodyparts add to the last one only.

### A body from triangles

`putBody(src, { name, body, bodypart = 0, tris, texture, bone = 0, pose, smooth = 40, ownNormals = false, quiet })` → `{ mdl, body, warnings, report }`

| Option | Meaning |
| --- | --- |
| `name` | A **new** body of that name, after the others of its bodypart (as `addModel`: mind the note above). |
| `body` | Instead: the body it takes the **place** of, by its number or its submodel's name. Its first mesh takes the triangles, its others are left empty; its number stays. |
| `tris` | `[[{ p, uv, bone? } ×3]]`, what the workshop makes. `p` is in the space of the bone the corner hangs on; `uv` 0 to 1; `bone` (a name or a number) where a corner hangs on another than `bone`. Corners may carry `group` and `smooth`. |
| `bone` | The bone the body hangs on, by name or number (the first unless told). One bone a corner: a worn piece does not bend. |
| `pose` | `{ seq, frame }`: `p` is in model space, as the model stands in that pose, and is taken into its bone's space for you. |
| `texture` | A texture, an image with a `name` (cut to 256 colours), or the name of a texture the file has. |
| `ownNormals` | true: a corner that carries `n` keeps it as its normal (see "A corner's own normal"): for `objMeshes`' triangles of a file with `vn`. |

`body` in the result is the number that shows it; `report` is `{ model, tris, verts, norms }`. `warnings` is a list
of sentences, each also written to the console unless `quiet`:

- a body **replaced** by one whose corners lie elsewhere on a picture the old one wore: what was painted there no
  longer fits (the sentence gives the share of pixels, from `layoutMoved`, and names `carryPicture`);
- a `texture` given under a name the file has already with another picture: the body wears the file's, as
  `replaceMesh` does (`replaceTexture` changes it).

`layoutMoved(old, now, { body, from = body, tex, pose, tol = 2, bodypart })` is that measure on its own, between two
files or two bodies of one. A pixel the new body wears is **kept** when its triangle lies on the picture exactly
where one of the old body lay (a part that only moved keeps its paint), or when it colours a place of the body
within `tol` pixels' worth of where the old one did; else it is **moved**, or **fresh** when the old body wore
nothing there. `share` is moved and fresh over the pixels worn; `bare` the pixels only the old one wore; `warning`
a sentence when `share` passes 0.02, else null.

### Rigid pieces in bodyparts of their own

`putRigid(src, { pieces, texture, space = "bone", budget = 2048, name = "rigid", smooth = 30 })` → `{ mdl, bodyparts, report }`

Pieces each wholly on one bone (a robot's plates, rods and fittings on a game's skeleton) put into new bodyparts
of one submodel each (`addBodypart`), so every body shows them, the model's own bodies keep their numbers, and
nothing stretches as the game's animations play. As many bodyparts as the points and normals need, `budget` each
(GoldSrc holds 2048 a submodel).

| Option | Meaning |
| --- | --- |
| `pieces` | `[{ bone, tris, name? }]`: `bone` a name or a number; `tris` `[[{ p, uv } ×3]]`, `uv` 0 to 1, corners may carry `group` and `smooth`. A piece's faces share normals among themselves only. |
| `space` | `"bone"`: `p` in the space of the piece's bone. `"rest"`: in model space with the bones at rest (what `solids` and the kitbash kit make). |
| `budget` | The most points, and the most normals, one bodypart's submodel is given. The pieces go in the order given, a new bodypart begun when the next would pass it. |
| `name` | The bodyparts are `name`, `name2`, `name3`... |

`bodyparts` are their numbers; `report` one `{ bodypart, name, pieces, tris, verts, norms }` each. It throws for a
piece that alone passes the budget, and when the bodyparts would pass the engine's 32.

### A picture carried to a changed shape

`carryPicture(old, now, options)` → `{ mdl, report }`. Every pixel that the body `body` of `now` wears is painted
again from the picture the body `from` of `old` wore, read at the same place of the shape. Three ways of knowing
the same place, tried in this order for each pixel:

1. **The same triangle.** A triangle that lies on the picture exactly where one of the old body lay keeps its
   pixels as they are, wherever it now stands: a finial that went up with the crown.
2. **The same part**, with `was` and `is`: the old and the new shape's triangles as the workshop made them (their
   corners say which part they are of and where in it: `of`, `q`). Round a turned part, the same share of the way
   round. Along it, a ring both shapes have (the same `s`) is the same place, the two ends are the ends, and
   between two such the paint is stretched in proportion: a rim stays on its rim, what was painted beside a ring
   that did not move stays beside it, and only the bands that changed are stretched. A cap laid as a disc, a
   ridge, a boss and a leaf go in proportion. This is right however the new shape is laid on its picture.
3. **By place**: the nearest point of the old body that faces the same way, within `reach` units. `moved(p, place)`
   may say where the point `p` of the new body was on the old one. This needs nothing but the two models: it is
   how the paint of a shape made otherwise (or by hand) is put on a new one, and it is right where the shape did not move.

| Option | Meaning |
| --- | --- |
| `body`, `from` | The new body's number and the old one's (the same unless told). `old` and `now` may be one file. |
| `tex`, `fromTex` | The texture's name, or several (every one both wear unless told); the old body's, when it goes by another name. |
| `was`, `is` | The two shapes' triangles from the workshop, for way 2. Run the old script and the new one. |
| `picture` | The old picture when it is not the one in `old`: `{ width, height, rgba }` (or `rgb`), or a texture. What was painted in the editor's project, say. |
| `pose`, `soft` | As `paint` takes them. `soft: 2` where a part was stretched. |

`report[name]` is `{ pixels, same, part, place, lost, far }`: how many pixels each way carried; `lost` found no place
and are left as `now` has them; `far` is the farthest a pixel carried by place was from where it was read, in units.
The picture is cut to 256 colours once, as `paint` does. A part with a ring added or moved keeps the places of the
rings that stayed: to keep its *pixels* too, without carrying, give `turn` the old build's `places`.

### Several models as one

`together(list)` → a model with one body: several files that hang from one skeleton, to draw or measure as one.
`list` holds models, or `{ mdl, body, pick(mesh, model, bodypart), move }`: of each, the submodels its `body`
number shows (0), and of those the meshes `pick` accepts (all). The first gives the bones and the animations; the
others are hung on them by their bones' names, a corner on a bone the first lacks going on the nearest above it
that it has. A texture whose name is taken, with another picture, comes under a name of its own.

```js
const worn = together([{ mdl: armour, body: 40 }, { mdl: reference, body: 3, pick: (mesh, model) => model.name === "head_visible" }, { mdl: helmets, body: 34 }]);
const six = sheet(worn, { seq: 0 }), sides = lineup([["bare", together([armour, head])], ["helmed", worn]], { yaws: [0, 90, 180, 270], seq: 0, target: [1.5, 0.5, 67], zoom: 2.7 });
```

`render`, `sheet`, `strip`, `lineup`, `paint` and the measures take it as it is. It is for pictures, not for the
game: its other bodies are gone and it may pass the engine's limits. `together([{ mdl, body }])` is also the way to
hand one body of a file to anything that takes a model.

## Measuring what is worn (`make/wear.mjs`)

A worn piece (a helmet, a pauldron, a pack) hangs on one bone and is made in that bone's space, so that is where
it is measured. Two files on one skeleton give the same space for a bone of the same name.

| Function | Gives |
| --- | --- |
| `bodyIn(src, body, bone, { pose, bodypart, only, pick })` | A body's triangles in a bone's own space: `[[{ p, n, bone, on } ×3]]`; `on`: the corner hangs on that bone; `n`: its normal (the face's own where the file keeps none). `only: true`: only the triangles wholly on the bone (a head out of a whole body). `bodypart`: one bodypart's submodel. `pose`: where the model stands, for corners on other bones. |
| `boxIn(src, body, bone, options)` | Its box there: `{ mn, mx, mid, size, tris, corners, off }` (`off`: corners on another bone). |
| `facingOf(tris)` | The way triangles face on the whole (a unit vector): of a helmet's top triangles, how its crown is tilted. |
| `fitBetween(from, to, { uniform, points, boxes })` | The fit `p * k + t`, each axis its own, that takes one piece to another: `{ k, t, scale, worst, by, at(p), back(p) }`. From two lists of the same points in the same order when they are that (`by: "points"`, `worst` the farthest a point is left), else from their boxes (`by: "boxes"`). A game's woman's helmet from the man's: about 0.84 and a shift. |
| `clearance(inner, shell, { centre, sides })` | Is this inside that: `{ inside, outside, open, tightest: { gap, at, on }, worst: { out, at, on }, fits }`. Counts of the inner points that the shell covers, that poke through it, and that it does not reach (below a helmet's rim); the inside point nearest the wall and its gap in units; the outside point farthest out. |
| `bodyCounts(src, bodypart = 0)` | `[{ body, name, tris, verts, norms, textures }]` for every body, and `.median`: a new body's weight against the file's own. |
| `motionOverlaps(src, pieces, seqs, { step = 2, tol = 0.25, still, space = "bone", groups })` | Rigid convex pieces driven into each other by the animations: `{ built, sequences: [{ name, frames, pairs: [{ a, b, deep, frame, near }] }], worst, skipped }`. See below. |

`clearance` looks from the middle of the inner points through each of them: a point is **inside** when the line
leaves the shell beyond it, **outside** when it has left the shell before reaching it, **open** when it never
leaves it. The line leaves through a face it meets from behind, so a lining, or a cone that closes a helmet's
inside, is not counted: the gap is to the wall. `inner` is points or triangles; `shell` triangles from `bodyIn`
or from the workshop, in the same space. It is right for a shell that its wearer's middle sees all of.

`motionOverlaps` is for pieces each on one bone, each convex (as `solids` makes them), given as `[{ bone, tris,
name? }]` with `tris` in the bone's space (or in model space at rest, `space: "rest"`). For each pair on two bones,
frame by frame (every `step`th of each animation of `seqs`, all the file keeps unless told), it measures how deep
the corners of one go inside the other, past how deep they are as built (the rest pose, or `still: { seq, frame
}`), and tells the pairs deeper than `tol`. Only pairs whose spheres (a piece's middle and its farthest corner)
meet are measured. `built`: the pairs already in each other as built; `near`: the bones are next to each other
(the same parent, or one the other's parent or grandparent), where a joint's own parts sit in each other by
design, against pairs on bones apart, which are faults. Only corners are tested: two blocks crossing edge to edge
with no corner inside are not seen. Animations kept in other files are posed from `groups` (`sequenceFilesOf`,
and `still` may be one of them); without their file they are named in `skipped`.

```js
const helm = bodyIn(helmets, 2, "Bip01 Head"), where = boxIn(helmets, 2, "Bip01 Head");          // the game's own, to sit a new one by
const crown = facingOf(helm.filter((t) => t.every((c) => c.p[0] > where.mx[0] - 1.6)));           // how it is tilted on the head
const woman = fitBetween(helm, bodyIn(helmets, 16, "Bip01 Head"));                                 // the woman's from the man's
const head = bodyIn(reference, 3, "Bip01 Head", { only: true, bodypart: 1 }), fit = clearance(head, mine);
```

## Pictures and files (`core/image.mjs`)

| Function | Gives |
| --- | --- |
| `indexed(image, name, most = 256)` | An image cut down to a texture (median cut). |
| `masked({ width, height, rgba }, name)` | A texture with holes where alpha is under 128: 255 colours, index 255 the hole, `flags: 64`. |
| `shrink(image, k)` | The image `k` times smaller each way, averaged. |
| `textureFrom(fileBuffer, name, { holes })` | A PNG or BMP file as a texture. An 8-bit BMP keeps its palette exactly. |
| `rgbaOf(texture, masked = false)` | A texture as RGBA bytes. |
| `rgbOf({ width, height, rgba })` | RGBA as an image. |
| `png(width, height, rgba)` | A PNG file (a Buffer). |
| `unpng(buffer)` | `{ width, height, rgba }`. 8 bits a channel, not interlaced: grey, RGB or a palette, with or without alpha. Anything else (16 bits, interlaced, a colour type that is none of those) is refused, saying what is read. |
| `bmp(texture)` | An 8-bit BMP file with the texture's palette as it is. |
| `unbmp(buffer)` | 8-bit: a texture without a name; 24 or 32-bit: an image. |

## A re-skin by rules (`check/reskin.mjs`)

`reskin(src, rules, { body = 0, pose, own = [] })` → `{ mdl, changed, pictures, shared, owned }`: a game's model
recoloured, weathered by place and painted over, all but its pictures as it was; each texture at its own size, cut
to 256 colours once. `rules` apply in order, each a pass of `paint` seeing what the ones before left. A rule does
ONE of:

| Action | |
| --- | --- |
| `recolour: [r, g, b]` | The pixels it takes become that colour, their light and shade kept: the mean brightness of what the rule takes in the picture becomes the colour, a lighter pixel lighter (`keep: false`: flat). A function of the pixel instead, in a script. |
| `darken: k`, `tint: [[r, g, b], t]` | That much darker (0 to 1); mixed `t` of the way to a colour. |
| `rust: a`, `moss: a`, `dirt: a`, `verdigris: a` | Weathered by place, `a` from 0 to 1: rust in patches with streaks run down and pits; moss on what faces up (`up`, its weight, 0.3) and below `low` (12); dirt rising from the ground to `height` (30); green in brass's hollows. `scale` (1), `seed`, `colours` (`{ dark, mid, light }` or `{ colour }`; `WEATHER` holds those used unless told). The Barrow Road's re-skins' own weathering, as rules. |
| `paint: [r, g, b]` | That colour; or a function `(q) => colour` of what `paint` hands its own, in a script. |

and is kept to some pixels by any of these, all of which must hold: `only` (texture names), `islands` (ids);
`hue: [from, to]` (degrees; `[330, 20]` goes round through red), `sat: [low, high]`, `light: [low, high]`, of the
colour the picture HAD there (`colourOf(c)` measures one); `box: [u0, v0, u1, v1]` (pixels); `near: [x, y, z, r]`,
`above: z`, `below: z` (the place of the body as it stands in `pose`); `facing: [x, y, z]` or `{ dir, least: 0.5 }`;
`when: (q) => true`; and `soft: n`. A word a rule may not have, two actions or none, a range of one number: refused
in words before anything is painted. A function in place of a rule is a pass of `paint` as it is.

`body`: the body number whose triangles are painted (a texture other bodies share changes for them too). `own`:
`[ownPixels' options]`, applied first, so that a rule can keep to one part (`owned[n].texture` is its name).
`pictures`: `[{ name, image }]`, each changed texture before and after, side by side (`beforeAfter(was, now,
names)` makes them for any two files). `rulesOf(value)` reads what a rules file holds (a list, or `{ rules, own,
body, pose }`). `smak reskin <mdl> <rules.json|rules.mjs> -o out.mdl [--body n] [--pictures dir]` runs one, writes
the pictures and checks the result against the original (`check`'s `source`).

## Drawing (`make/render.mjs`)

All return `{ width, height, rgba }`; write with `png(img.width, img.height, img.rgba)`.

| Function | Draws |
| --- | --- |
| `render(src, options)` | One view. |
| `sheet(src, options)` | Six views: front, left side, back, right side, top, three quarter. `size` (384) is each one's side. |
| `strip(src, { seq, count = 12, cols = 4, from, to, groups, ... })` | An animation (the first unless told), `count` frames from first to last, each numbered, all by one camera at one scale. Throws when the model has no animation, or none of that name, or it is kept in another file and `groups` (`sequenceFilesOf`) does not hold it. A walk: `{ view: "side", ground: true }`. |
| `uvMap(src, which, { scale })` | A texture enlarged with the triangles that wear it drawn over it. Also returns `scale`, `meshes`, `triangles`. |
| `tile(images, cols, names)` | Pictures of one size side by side, named. For before and after. |
| `lineup([[name, model], ...], { yaws = [20, 200], pitch, zoom, width, height, cols, target, seq, frame })` | Several models to one scale, each from the same sides. |
| `together([...])` (`make/place.mjs`) | Not a picture: several models on one skeleton as one model, for any of these to draw (a helmet on a head with an armour). |
| `label(img, text, x, y)` | Writes on a picture. |
| `posed(src, options)` | No picture: the triangles in model space as shown, `{ info, tris, pose }`. A triangle: `{ tex, where, tri, c: [{ p, n, u, v, bone } ×3] }` (`where`: its mesh; `tri`: its number in it; `u`, `v` in pixels; `bone` a number). `groups` (`sequenceFilesOf`) poses an animation kept in another file; without it such an animation is shown at rest. |
| `framing(src, [options])` | `{ mid, far }` over several poses, for `within`. |

Options of `render` (and the others pass them on):

| Option | Default | |
| --- | --- | --- |
| `view` | `"orbit"` | `"orbit"`: from outside, no perspective. `"first"`: the eye at the origin looking along +x. `"side"` (the left side: the front is to the picture's left), `"front"`, `"top"`: orbit from there (`NAMED_VIEWS`); a `yaw` or `pitch` given with one turns the camera on from there (`"front"` with yaw 205 looks from 205, `"side"` with yaw 30 from 120). |
| `ground` | false | A line across the picture where z = 0 is, over the model: the floor. Only in a level orbit view (`pitch: 0`, `"side"`, `"front"`); any other throws. |
| `yaw`, `pitch` | 30, 15 | Degrees. Yaw 0 looks at the front, 90 at the left side, 180 at the back. Pitch 90 looks down. |
| `zoom`, `target`, `within` | 1 | Closer or farther; the point looked at; a shared framing. |
| `fov` | 90 | First person: degrees across. |
| `dist` | | Orbit with perspective: the eye this many units from `target` (the model's middle unless told), `fov` degrees across; `zoom` and `within` then say nothing. How the editor's page looks at a model. |
| `seq`, `frame` | 0, 0 | The animation (a name, a number, `null` for the rest pose) and the frame. The rest pose may be turned from the animated one (a quarter turn in some models): yaw 0 is the front of the model as it is animated. |
| `pose` | | Matrices of your own instead (from `poseOf`). |
| `body`, `skin` | 0, 0 | Which submodels and which skin family. |
| `width`, `height` | 512² (640×480 first person) | |
| `light` | true | False: textures at full brightness. |
| `cull` | true | False: both sides of every triangle. |
| `background` | `[58, 62, 70]` | |

`TEXTURE` names the texture flags: `{ flat: 1, chrome: 2, fullbright: 4, additive: 32, masked: 64 }`.

## Checking (`check/check.mjs`)

`check(src, engine = "goldsrc", { source })` → `{ errors, warnings, facts }`, lists of sentences. With `source`
(the file this one was made from: the game's own, for a re-skin) a warning the source has too begins with
`INHERITED` ("inherited from the source: "), textures it has at the same name and size are said apart from the
file's own, and `inherited` counts those warnings (`smak check <mdl> --source <original.mdl>`). `engine` is `"goldsrc"`
or `"xash"`. `LIMITS` holds the numbers. An error is something that crashes the engine or cannot be drawn; a
warning is something it will put up with. See `docs/ENGINES.md`. It throws for nothing that is wrong with the
file: one that is cut short or broken comes back with that as an error, and a bodypart with no submodel is one too.
Of a monster's parts: a hit box, an attachment or a bone controller on a bone the model has not is an error; an
animation whose box has no size is a warning (the engine culls by it); a looping animation whose last frame is
not its first again, by more than 1 unit or 2 degrees on some bone, is a warning naming the bone (the engine
takes the two frames for one moment: a jerk every time round); a model with animations that travel and no hit
boxes is a fact.

Form: `check` also puts one fact (`form: ...`) and, for a form boxier than 19 of 20 of Half-Life's models of its kind, `form: ...`
warnings among `warnings`; `check(src, engine, { name, kind })`: `kind` "props", "vehicles", "creatures" or `false` (none), else from `name`
(`kindOfName`). The measures, from `check/form.mjs` (exported from the root): `formOfTriangles(tris)` (`[[p, p, p]]`), `formOfMdl(src)`,
`formOfBrushes(brushes)`, `formOfSource(map)`, `formOfBsp(bsp)`, `nonAxialOfSource(map)`, `judgeForm(measures, kind)` →
`{ rows, warnings, boxy }`, `FORM_BANDS`, `FORM_SAID`, `MAP_FORM`, `kindOfName(name)`; `maps.judgeSourceForm(map)` the source's
sentences. docs/MODELS.md, "Form".

`engineLayout(src)` → the same model with its textures at the file's end in their table's order, as a dedicated
server reads them (`core/layout.mjs`); `isEngineLayout(src)` says whether it is so already. The functions that
change a model call it themselves: use it on files that came from elsewhere.

## Maps (`core/maps/`, `make/maps/`, `check/maps/`, exported as `maps`)

`import { maps } from "smak"` (or `"smak/maps"`, or `./smak/check/maps/index.mjs`). Their functions are listed in
two documents of their own: `docs/MAPS.md` (a compiled map read and checked, its entities, textures and `.wad`
files, its pictures: `drawMap`, `planOf`, `viewsOf`, `compareOf`, `drawSource`, `planOfSource`, `sectionOf`, `storeysOf`,
`openingViews`, what they draw of the game's files: `figuresOf`, `spritesOf`, `readSpr`, `spriteFrameRgba(sprite, n)` (a frame as a picture, by its format), `skyOf`, `readTga`,
how much of a map the engine draws from where players stand, against a budget: `checkPvs` (`{ passed, errors, overall, regions, worst, above, spots }`), `pvsPicture` (its heat map), `pointsFrom`, `regionsFrom`, `PVS_BUDGET`; the walk test: `reachOf`, `spaceOf`, `restOf`, `storeyCuts`, room before each door and its views: `doorClearance`, `doorViews`, waypoints for bots and RCBot's file: `waypointsOf`,
`readRcw`, `writeRcw`, `waypointFlagNames`, `RCW_FLAGS`, a map in numbers: `measure`, `measureTable`, a
map's two teams as a team plugin plays it: `teamsOf`, `collectSpawns`, `partitionSpawns`, `readSpawnCfg`,
`spawnCfgText`, `spawnCfgName`, the sight test `sightTest`, a map's dressing against a mod's own bands:
`dressingOf`, `learnDressing`, the kit's profiles by name and the game found: `mapProfileOf`, `findHalfLife`,
`steamLibraries`, a
compiled map decompiled into a `.map` and its recompile measured against it: `decompile(bytes, { name, folders })`
→ `{ map, facts, warnings, wad }`, `textureFidelity(original, recompiled)`, `lightParity(original, recompiled)`,
Half-Life's texture lights `TEXLIGHTS`, `texlightsFor`, `texlightsRad`, `texlightsEntity`, and a map's entities against its
mod: `checkEntities`, `definitionsOf`, `learnEntities`, `classesOfDll`, `GOLDSRC`, `loadMod`),
`docs/MAPS-MAKING.md` (brushes, entities, the `.map` file, the plan check, a mod's profile and the compile)
and `docs/MAPS-DESIGN.md` (what makes a map good to look at and to play, as rules of thumb and recipes; how a
map's monsters come: `spawnsOf`, `spawnsTable`; its character in numbers: `characterOf`, `characterAgainst`,
`learnCharacter`).

### Builders of form (`make/maps/source.mjs`, `profiles.mjs`, `shapes.mjs`)

Pure functions that return brushes (and entities where they must). A brush face whose normal is more than 5 degrees
off every axis wears its picture in its own plane (`align: "auto"`, the builders' default; `"world"` and `"face"`
still force one way); axis-aligned faces are laid on the world's grid as before.

`turned(brushes, degrees, pivot, { snap })` turns the points exactly at any angle (0.39: pieces that shared a corner
keep sharing it, so their planes stay one plane to the compiler; rounding them one by one gave hlbsp 553 ambiguous
leaves on a plaza turned 12 degrees); `snap: n` rounds the corners to that grid on request, each face's plane the
nearest fit through grid points. `frame({ at, yaw })` (`make/maps/frame.mjs`) places a composition written in its own
coordinates: `.place({ brushes, entities, snap })` returns the brushes turned by `yaw` and moved to `at`, and the entities
with their `origin` turned and moved, their `angles` (`"pitch yaw roll"`) and `angle` yaw turned, and the brushes of
brush entities (a door's leaf) placed; `.point([x, y, z])` maps one point, `.angle(degrees)` one yaw.

`roof(outline, { kind, pitch, overhang, thick, z, ridge, snap, texture })` (`make/maps/forms.mjs`) is the one roof
builder: over a convex outline of [x, y] points (a rectangle for `gable` and `hip`), `kind` `"gable"` (two slabs
meeting at a ridge along the longer side or the edge `ridge` names; the attic under them is empty), `"hip"` (one solid
sloped on all four sides), `"shed"` (one slab rising away from the outline's first edge) or `"flat"`; `pitch` in
degrees (35), `overhang` in units or `{ eaves, gable }`, `z` the walls' top where the underside crosses the wall line.
It returns a list of `solid`s whose slopes wear `texture` along the face; corners whole units (`snap: 0`: exact).

`dome(center, radius, { rings, segments, thick, open, texture, snap })`: the upper half of a sphere of `radius` over
`center` (the middle of its base) as a shell `thick` thick (16) of `rings` bands (4) of `segments` convex tiles (12),
closed at the top by pointed tiles or, with `open` the radius of an eye, left open there; corners whole units. A tile
is the polygon through its corners, not the sphere; each face is the plane through three of the rounded corners, the same three for the two tiles that share it, so a tile closes (is a sound solid to sdHLCSG) at any radius and `snap: 0` stays exact (`solidOfPlanes(threes, inside, texture)` makes a solid from planes so given). `arcade(from, to, { bays, width, pier, height, cap, depth,
texture, pieces })`: a row of `bays` round arches (`arch`'s wedges) along the line from `from` to `to` with piers
between, the floor at `from[2]`, any direction (the row is built along x and placed by `frame`); `width` the bay's
clear width and `pier` the pier's, one of them or neither (then 32); `height` the opening's, floor to crown; `cap` the
masonry over the crowns; `depth` its thickness across the line, centred on it. Both return a list of brushes.

`tree(at, { height, trunk, crown, kind, bark, leaves, snap, scale })` (`make/maps/forms.mjs`): a tree of brushes at the
foot `at` ([x, y, z]), `height` to its top (256), `trunk` the trunk's radius at the foot (12), `crown` the foliage's
widest radius (96; a cypress's 40). `kind` `"round"`: an 8-sided trunk tapering up, and three lobes of leaves stacked
and set a little off the axis, the middle one the widest, each two frusta meeting at its widest ring (7 brushes);
`"cypress"`: a short trunk and a tall pointed spindle of two frusta meeting a third of the way up (3); `"palm"`: the
trunk in two pieces leaning out a quarter of `crown`, and seven fronds radiating from its head, thin wedges that rise
and droop, alternate ones shorter (9). `bark` and `leaves` are its two textures, anything a builder takes. `snap` 1
rounds heights, centres and radii to whole units; a ring's corners stay exact, so every side is one flat face and
every brush closes for sdHLCSG. It returns the list of brushes, for a `func_detail`.

`railing(points, { z, height, thick, kind, rail, bar, post, spacing, gap, texture, scale })` (`make/maps/pieces.mjs`)
has three kinds: `"slab"` (the default, a bar `thick` wide and `height` high a stretch, a post at each bend), `"bars"`
(a handrail `rail` square (6) on top, a bottom rail 4 over the floor, posts `post` square (`rail` + 2) at the ends, the
bends and every `spacing` (96), balusters `bar` square (3) every `gap` (16) between the rails, corners whole units) and
`"panel"` (the handrail and posts, and a slab `thick` thick from the bottom rail's height to under the handrail). A bars
railing 256 long is 18 brushes and one of 1536 some 90: a `func_detail` or `func_wall`, not world brushes.

**Scale.** Every builder of form takes `scale`, a number or `[x, y]` (units a texel), the picture's scale on every
face it makes: `box`, `cylinder`, `extrudeProfile`, `sweepProfile`, `roof`, `dome`, `arcade`, `railing`, `tree`. It is
`withScale(texture, scale)` applied to the texture given (a name becomes a fit; a texture by direction or by rule has
it set on each answer; a fit's own scale is replaced). `scaled(brushes, scale)` sets it on a brush or a list already
made, the rest of each face as it was (a face with an offset keeps it in texels, so its picture slides; a `fitted`
picture is better given its scale). `writeMap` writes the scale as the last two numbers of the face's line; `moved`,
`turned` and `onFloor` keep it.

## Playing a map in the game (`cli/play.mjs`, exported as `play`)

`import { play } from "smak"` (or `"smak/play"`). What it needs and the steps' format: `docs/MAPS-MAKING.md`,
"Seeing it in the game".

`play.playOf(steps, { mod, pause = 1000 })` → the steps checked and made plain actions, each `{ kind, wait,
shot, step }` with its own fields: `"command"` `commands`; `"button"` `button`, `ms` (a `walk`, a `turn` and a
`button` step); `"hold"` `key`, `ms`; `"press"` `key`; `"click"` `x`, `y`; `"wait"`. A wrong step throws a
sentence that names it. A step is `{ command }`, `{ say }`, `{ walk, to }`, `{ turn }`, `{ button, ms }`,
`{ hold, ms }`, `{ press }` or `{ click: [x, y] }`, each with `wait` and `shot` if it likes, or those two alone.

`await play.play({ driver, map, steps, out, mod, loads, pause, tell })` → `{ map, out, pictures, steps, log,
logFile }`: the engine waited for, `map <name>`, the profile's steps to enter, then yours. `pictures` are the
PNG files in the order taken (`00_loaded.png`, `01_entered.png` when the profile has steps to enter, then
each `shot`); `steps` is what was done, each `{ part: "load" | "enter" | "steps", index, kind, step, at, took,
picture }` with its times in milliseconds; `log` is the game's console as lines, also written to
`<out>/log.txt`. `tell` is handed a line as each thing is done. Everything is checked before the driver is
touched; when a driver fails, it is closed, the log is written, and the error carries `pictures` and `logFile`.

A **driver** is a plain object, `{ ready(), command(text), keyDown(key), keyUp(key), press(key), click(x, y),
wait(ms), shot(file), log(), close() }`, each of which may be async: write one to play the game another way
(a native engine, a test's fake).

`play.browserDriver({ url, playwright, width = 1024, height = 768, readyWithin = 120000, engine = "xash",
readyFlag = "xashReady", args = play.SOFTWARE_GL })` → the kit's own driver: a headless Chromium on the page
that runs a browser build of Xash3D. `playwright` is the Playwright module (`{ chromium }`) or a folder that
holds its `node_modules`; `engine` and `readyFlag` are the page's names for the engine's Emscripten module and
for the flag it sets when the engine takes commands. Nothing is opened before `ready()`.

`play.nativeDriver({ halfLife, mod = "valve", exe = "hl.exe", width = 1024, height = 768, args = [],
readyWithin = 90000, enterWithin = 120000, answerWithin = 20000, input = false, quiet = 5000, quietWithin = 60000,
pictures = "console", spawn, windows })` → a driver for the person's own game from Steam, by its console
(`smak play native`; cli/play-native.mjs says how). `halfLife` is the
Half-Life folder (unless told, `findHalfLife`'s), `mod` the game's folder in it. `command(text)` resolves when
the game has run it, a `map` once the player is in (the driver then says `SMAK entered <map>`, its `loaded`,
which a session waits for in place of the profile's line); `shot(file)` is the game's own screenshot as a PNG;
`windowShot(file)` is its window as the person sees it (every `shot`, with `pictures: "window"`); keys and
the mouse are real ones only with `input: true` (the person asked first), sent while its window is in front
once the hands have been off `quiet` ms, and the run stopped when they touch the machine; without it a key
throws and there is no `mouseDown`; `close()` quits the game, or ends it by its process id, and takes its `smak_*.cfg`
files out of the mod's folder. `spawn` is how the program is started (a test's fake engine), `windows` how the
window helper is made (cli/play-window.mjs's `windowHelper`; a test's fake).
`play.pngOfTga(bytes)` → a TGA screenshot (24 or 32 bits, raw or run-length) as a PNG's bytes.

`play.playwrightFrom(folder)` → the Playwright module of that folder's `node_modules`, looked for there and
nowhere else; it throws a sentence when it is not there. `play.playPartOf(mod)` → the profile's `play` field
made whole from `GOLDSRC`'s: `{ enter, say, loads, yawspeed, screen }`.

A session (`docs/PLAY.md` has the whole of it): `play.playSession({ driver, mod, pause, tell, over })` →
`{ ready(), run(run), close(), state }`. `over: [{ path: "msc", folder }]`: folders laid over the game's files,
marked as the session begins; a `run({ ..., over })` that names one puts every file in it new or changed since
(size or time) and moves the mark on; a `run({ ..., shrink: 3 })` writes each picture that many times smaller each way
(`play.smallerPng(bytes, k)`; `smak play` asks 3 unless `--full-pictures`). `play.serveSession({ session, port = 8098, host, tell, beat = 30000 })`
serves it: a run's answer is a line of JSON a thing done, with `{ beat }` every `beat` ms while the run is quiet.
`play.attachSession(address, run, { tell })` does a run there and reads its answer with `node:http`, with no
time limit (a fight of fifteen minutes reports its result). A fight's `prefer`, `sidestep` and `dodge`, and the
profile's `play.target.prefer` / `unprefer`: `docs/PLAY.md`, "A fight"; `play.fightLine(fight)` is its line.

## The viewer (`cli/viewer/serve.mjs`)

`view(roots, port = 8098)` starts it over folders or single files and resolves to the Node server (`.close()` stops
it). From the command line: `smak view <folder|mdl> ... [--port n]`. It listens on this machine only.

## Vectors (`core/vec.mjs`)

`sub`, `dot`, `cross`, `unit`, `box(points)` → `{ mn, mx }`, `uniq(tris)` (distinct points), `mainAxes(samples)`
(principal axes of weighted points `[x, y, z, weight]`), `into`, `out`.

## Convex solids (`core/solids.mjs`, exported as `solids`)

Hard-surface pieces in plain JavaScript: each solid a stack of convex rings along a place's Z, its sides quads, its
ends capped, made into triangles that face out. A piece of these is all planes: `motionOverlaps` measures one inside
another by them. A **place** is `{ at, X, Y, Z }` (a point and three axes at right angles); a **solid** is
`{ place, rings: [{ z, poly: [[x, y]] }], mat }`, every ring of as many corners, convex and counter-clockwise.
`import { solids as S } from "./smak/src/index.mjs"`.

| | |
| --- | --- |
| `place(at, z, xHint = [0, 0, 1])` | A place with Z along `z`, X as near `xHint` as Z lets it. |
| `at(pl, x, y, z)`, `shift(pl, x, y, z)`, `quarter(pl)`, `flip(pl)`, `along(pl, "X" | "Y")` | A point of a place; the place moved in its own axes, turned a quarter about Z, upside down, or with its Z along its X or Y. |
| `rect(sx, sy, cut = 0, cx = 0, cy = 0)`, `ngon(n, rx, ry = rx, turn)`, `outline(points)`, `inset(poly, d)`, `area2(poly)` | Outlines: a rectangle (its corners cut: an octagon), a regular polygon, corners in any order put counter-clockwise, an outline moved in by `d` (shrunk to half about its middle when `d` would fold it), its area. |
| `box(pl, sx, sy, sz, { cut, bevel, bevelFoot, taper, taperY, foot, mat })` | A box about the place (its foot at 0 with `foot`), its upright edges `cut`, its top's and foot's edges bevelled, its top `taper` times the foot. Cuts under 0.15 are left off. |
| `plate(pl, poly, t, { bevel, z0, top, mat })`, `prism(pl, poly, z0, z1, { top, mat })` | An outline `t` thick from `z0` along Z, its top's edges bevelled; an outline from z0 to z1, its top `top` times its foot. |
| `cyl(pl, r, z0, z1, { n = 6, r1, bevel, mat })`, `tube(p0, p1, r, options)`, `beam(p0, p1, w, d, up, options)`, `ball(c, r, axis, { n })`, `loft(pl, rings, mat)` | A cylinder along Z (four-sided under 0.3 across), a rod and a box between two points, a faceted ball of three rings, any stack of rings. |
| `lathe(pl, [[radius, z], ...], { n, mat })` | A solid of revolution: a profile turned n-sided (a lamp post, a bollard, a vase). |
| `sweepTris(profile, path, { up, closed, caps })`, `extrudeTris(profile, p0, p1, opts)`, `sweepRings(profile, path, opts)`, `earClip(poly)` | A closed 2-D profile (concave too) swept along a path of points, mitred at the bends, as triangles `[[{ p, k }]]` facing out; the sections of a sweep; the triangles of a polygon by ear clipping. |
| `trisOf(solid)` | Its triangles, counter-clockwise seen from outside: `[[{ p, k }]]` (`k` the corner's number as built). |
| `pointsOf(solids)` | The points they cost, each corner once (GoldSrc holds 2048 a submodel). |
| `planesOf(tris)` | A convex piece's planes, `[{ n, d }]`, `n` outward: a point is inside when `n.p < d` for every one. |
| `closed(tris)` | `{ closed, open, doubled }`: every edge met by two faces, once each way round. |
| `add`, `sub`, `mul`, `dot`, `cross`, `len`, `unit`, `orth`, `lerp3` | The vector arithmetic they use. |

## Linkages across a joint (`make/linkage.mjs`)

Two halves of a part rigid on two bones, which the animations must not pull apart: a telescopic piston, its
cylinder on one bone and its rod on the other. Neither half can turn about its anchor, so the rod stays in the
cylinder only where the anchors keep their bearing to each other (a hinge's own axis is such a place).

`findPiston(src, { boneA, boneB, candidatesA, candidatesB, seqs, step = 2, r = 0.4, clearance = 0.5, groups })` →
`{ found, cylinder, rod, report, skipped }`

| Option | Meaning |
| --- | --- |
| `boneA`, `boneB` | The cylinder's bone and the rod's, by name or number. |
| `candidatesA`, `candidatesB` | Points where each end may be anchored, in model space with the bones at rest. Every pair is tried. |
| `seqs` | The animations it must work through, by name or number: all the file keeps unless told. Every `step`th frame is posed. |
| `r`, `clearance` | The cylinder's radius (the rod's is half); how far short of the rod's eye the cylinder stops at the joint's narrowest. |
| `groups` | The files of animations kept beside the model (`sequenceFilesOf`): their animations are posed too. |

The pair kept is the one whose rod strays least off the cylinder's axis (a longer one a little preferred); each half
is aimed at the other's mean bearing in its own bone and sized so that the rod is in the cylinder at the joint's
widest and short of its floor at its narrowest. `cylinder` and `rod` are lists of `solids` in model space at rest
(for `putRigid` with `space: "rest"`). `report`: `{ anchorA, anchorB, axisA, axisB, dmin, dmax, cylinder, rod,
stray, angleA, angleB, bore, frames, sequences }` (`stray` in units, the angles the most each half's bearing turns
in its bone, in degrees). `found` is false and the rest null when no pair leaves a cylinder of 1.5 and a rod of 1.
**Animations kept in other files** (`group` not 0) are posed from `groups`; one whose file is not given is left
out and listed in `skipped` (`[{ name, why }]`), with names the model has not.

`posesFor(src, { seqs, step = 2, groups })` → `{ poses, used, skipped }`: the poses it tries, what `motionOverlaps`
poses too.

## Pieces laid out on a picture (`make/unwrap.mjs`)

`unwrap(pieces, { density = 3, width = 256, fold = 100, margin = 1, rows = 512, pow2 = true, nets })` → layout

Each piece's faces are opened out flat about their edges, as a paper model's net, at their true size (`density`
texels a unit everywhere: the pixel-art look), the flattest folds first; a face that would land on the net, or
folds more than `fold` degrees, starts an island of its own. The islands are packed by their shapes, not their
boxes: the largest first, each at the first place where its texels and `margin` about them touch no other's.
Corners land on whole texels, as GoldSrc keeps them. The height is what the islands need, a power of two (or a
multiple of 8 without `pow2`), at most `rows`; an island wider than the picture is turned a quarter.

| A piece | |
| --- | --- |
| `tris` | `[[{ p } ×3]]` or triangles of points, in a space of its own (its bone's, or the model's at rest). |
| `up`, `alt` | The way that is up on the picture ([0, 0, 1]) and the ways tried after it, for a face that looks up. |
| `axis` | Its length: faces across it (its ends) get islands of their own. |
| `share` | Pieces of one share wear the first one's texels triangle by triangle (a left plate and its right: built alike). |
| `mirror` | `{ n, at }`, a plane: the half on `n`'s side is laid out, the other half wears its mirror's texels. |
| `net` | A key: the islands of the pieces of one key are laid together as one net and packed as one (or the option `nets: (piece, n) => key`, which a piece's own `net` gives way to). |

**Nets**: the islands of one key are laid the largest first, then each where one of its corners lands on a corner
of the net laid so far, none of its texels on the net's, the net's box kept smallest and no wider than the
picture; one that cannot touch the net without lying on it is packed alone. A limb's plates side by side on the
picture, where a painter looks for them, instead of scattered among the rest.

The layout: `{ width, height, density, islands: [{ id, piece, tris, x, y, w, h }], pieces: [{ uv, islandOf,
primary }] }`, `uv` for each triangle of each piece its three corners in texels. `withUV(pieces, layout)` gives the
pieces back with each corner's `uv` 0 to 1, as `putRigid` and `buildMdl` take it. `unfold(tris, { up, alt, fold,
axis })` is the net of one list of triangles: `[{ faces, flat }]`, `flat` each face's corners in units.

## Fewer triangles for rigid pieces (`make/cull.mjs`)

A figure of rigid pieces (plates over a cage, parts set into each other) is mostly faces never seen: buried in
another piece, shut inside a cage, pressed against a neighbour. GoldSrc draws them all. Two passes take them away,
for any model and any pieces, the same pieces giving the same answer every time.

`cullHidden(src, pieces, options)` → `{ pieces, before, after, gone, poses, share }`: the pieces posed on their
bones in many poses of the animations and drawn from many sides at a fixed size of pixel, front faces only, with a
depth test; a triangle that shows less than `keep` of what it could (the area of the pixels it wins over the area
it would cover with nothing in front, summed over every view of every pose) goes, and a piece left with none is
dropped (`gone`, its name or number). `pieces` as `motionOverlaps` takes them (`[{ bone, tris }]`, in the bone's
space or `space: "rest"`); every other key of a piece is kept, and its corners are the ones given.

| Option | Default | |
| --- | --- | --- |
| `keep` | 0.04 | The share a triangle must show to stay: under it, it is hidden nearly always. |
| `first`, `firstViews`, `firstPx` | the first idle, 80, 0.15 | The pose seen closest: that animation's first frame (else the first, else the bones at rest), from that many directions at that many units a pixel. |
| `seqs`, `at`, `views`, `px`, `weight` | every one it can read, `[0.3, 0.7]`, 14, 0.2, 1 | The other poses: each animation at those shares of its frames, from `views` directions (a number spread over the sphere, or unit vectors) at `px`, each pose's areas times `weight`. |
| `poses` | | Instead of the two above: `[{ seq, frame, views, px, weight }]` (`seq` null for the bones at rest), measured together; the close pose and the others are otherwise measured apart and their areas summed. |
| `together` | `(piece) => piece.share` | Pieces of one key and as many triangles (a left plate and its right, on one set of texels) keep a triangle any of them shows. |
| `groups`, `space` | | The files of animations kept beside the model (`sequenceFilesOf`); `"rest"` for pieces in model space at rest. |

Its cost is the poses times their views times the triangles: 6,000 triangles over a hundred poses take some
seconds. `triangleVisibility(src, pieces, { poses, views = 14, px = 0.2, groups, space })` → `{ seen, could, sign
}` is the measure under it, each piece's triangles' areas won and possible in square units (`sign`: the winding
taken as the front, by most of the triangles; a triangle too small to win a pixel counts one, once in a measure,
the first time its middle is seen); `sphereViews(n)` the `n` directions spread over the sphere.

`reduceWithin(tris, { tol = 0.12, shares = [0.35 ... 0.85], creaseAngle = 60 })`: one piece's triangles brought
down by `reduce` to each share in turn, the fewest first, and the first whose shape is within `tol` of the
original taken (no corner or middle of a triangle of either shape further than `tol` from the other:
`shapeDeviation(a, b)`); the triangles as given when no share is (the same array). The corners come back as `{ p }`:
a reduced piece is laid out again. `reducePieces(pieces, options)` → `{ pieces, before, after, reduced }` does
every piece, `reduced` the numbers of those made lighter. A texel at 3 a unit is 0.33: a `tol` under half of it
does not show.

## The workshop (`make/workshop.mjs`, exported as `workshop`)

| | |
| --- | --- |
| `sheet(width, height, ground?)` | A picture to paint: `.zone({ x, y, w, h }, (u, v) => [r, g, b], bleed = 4)`, `.image()`. `u`, `v` are pixels inside the zone; colours 0 to 1. |
| `shape(width, height)` | A mesh to build: `.turn`, `.tube`, `.ridge`, `.band`, `.boss`, `.studs`, `.leaf` (below), `.lathe(profile, zone, options)`, `.plate(stations, zoneA, zoneB, options)`, `.V(p, [px, py], part?)`, `.tri(a, b, c, inside)`, `.quad(a, b, c, d, inside)`, `.tris`. |
| `allot(width, height, { NAME: [long, wide, weight?] }, { gap = 6 })` | Zones for a picture, each part in proportion to its real size in units (times its weight): `{ NAME: { x, y, w, h }, px }`. Do it once and keep the zones in the script. |
| `lathe` options | The first turned solid, kept as it was: `sides = 10`, `flatten = 1` (squash in z), `px = 48` (pixels a unit along it), `at(s, a, b)` (placing; along x unless told), `caps: [start, end]` (`true` or a zone), `twist`, `part`. `profile`: `[[s, radius], ...]`. Returns its length. Its picture goes by the profile, not by what `at` makes of it: use `turn` for anything new. |
| `plate` options | `px`, `s0`, `at(s, t, g)`, `part`. `stations`: `[{ s, pts: [[t, g], ...] }]`, `g` the half thickness. Zones are `{ x, yc }`. A plate with no thickness shows from one side only: a thin sheet is `leaf`. |
| Noise | `rand(x, y, seed)`, `noise`, `fbm(x, y, seed, octaves)`, all 0 to 1. `fbm3(p, lumps a unit, seed, octaves)`: the same in space, for `paint`. `seeded(n)`: a random number maker that repeats. These and the blending ones (not `smooth`) are exported by name from `src/index.mjs` too, beside `paint`: `import { paint, fbm3, step, mix } from "./smak/src/index.mjs"`. |
| Blending | `step(a, b, x)`, `mix(c1, c2, t)`, `times(c, k)`, `bell(d, width)`, `smooth(t)`. |
| Materials | `steel(x, y, light, seed, rust)`, `iron(a, b, light, seed, rust)`, `wood(x, y, light, seed, tone)`, `leatherWrap(u, v, seed, base)`, `rust(x, y, seed)`. |
| Shading | `cylinderLight(v, strength)`, `rivet(x, y, cx, cy, radius)`, `polyDist(x, y, polygon)`. |
| `skinned()` | A body built limb by limb, each corner on its own bone (`make/skinned.mjs`; the scarecrow's and the first Barrow Guard's way): `{ meshes, put, loft, tube, card }`. `meshes`: `{ texture key: [triangles] }`, corners `{ p, uv, n, bone }` in the model at rest (`buildMdl` with `ownNormals: true`). `put(tex, a, b, c, out)`: a triangle, turned to face `out`. `loft(zone, [{ pts, ns, centre, v, bones, point }])`: a skin over sections of as many points, once round the zone. `tube(zone, [{ c, rx, ry, v, bone, rf(k, a), off(k, a), boneAt(k, a) }], { sides, e1, e2, phase, bone })`: rings about middles `c` in the plane of `e1` (its front) and `e2`; a ring of no size closes an end. `card(zone, base, d, r, L, W, { bone, n, flip })`: a card seen from both sides. |
| `zoneOn(tex, W, H, x, y, w, h)`, `span(s0, s1, v0, v1)` | A zone of a picture of the texture `tex` (`uv(u, v)`: 0 to 1 across and down it), and a stretch of a part's length laid down a zone (`v(s)`, `s(v)`), as `skinned`'s parts take them. |

### Surfaces, and what is built on them

`M.turn(rings, zone, options)` is the turned surface: rings along an axis, joined. It returns the **surface**,
which says where its own points are, so that other parts can be built on it.

A ring is `[s, r]` or an object:

| | |
| --- | --- |
| `s` | Where it is along the axis. |
| `r` | Its radius; `[ra, rb]`, an oval; or `(angle) => radius or [ra, rb]`, any outline. |
| `ds` | `(angle) => units`: how far the ring's point at that angle is moved along the axis. A rim that dips at the front: `ds: (a) => -2 * Math.max(0, Math.cos(a)) ** 3`. |
| `off`, `tilt` | `[a, b]`: its centre off the axis. `[ta, tb]`: it leans, `s` growing by that much a unit across. |
| `crease` | `true`: a hard edge here, however gentle the bend. |
| `w` | The weight in the picture of the band that ends at this ring (1). |

| Option | Default | |
| --- | --- | --- |
| `sides` | 12 | |
| `at(s, a, b)` | `[s, a, b]` | Where a point goes: `a` and `b` are across the axis, angle 0 along `+a`. |
| `seam` | 0 | The angle (radians) of the first corner, where the picture's two edges meet. Put it where it shows least. |
| `lie` | `"along"` | `"along"`: the length runs left to right in the zone and the turn top to bottom. `"across"`: the turn left to right, the first ring at the bottom: a barrel standing in its picture. |
| `px` | | Pixels a unit along it. Without it the surface fills the zone's length. |
| `places` | | `{ rings: [[s, u], ...], round: [v, ...] }`, what an earlier build returned as `places`: rings of those `s` stay where they were in the zone, and a ring added between two lies between them. |
| `caps` | `[false, false]` | Each end: `false` open; `true` flat; a number, a dome that high (under 0: sunk, a dimple); a zone, flat and laid there as a disc; or `{ dome, rings = 3, profile: [[rise, scale], ...], zone, crease, w }`. With a `zone` the cap is laid as a disc there, by its real length from rim to point; without, it goes on in the strip. |
| `lining` | | `{ inset, zone, from = 0, to = the last ring, cap, rim }`: the inside, facing inwards, `inset` units in, from ring `from` to ring `to`, in a zone of its own. `cap`: `true` closes its far end flat, a number with a cone that deep. `rim` (when `inset`): the edge between outside and inside. |
| `face` | `"out"` | `"in"`: the whole surface faces inwards. |
| `name`, `part`, `smooth` | | The part's name (in each corner's `of`); the bone part, as the lathe's; the part's own smoothing angle. |

**The picture follows the real surface.** Each band is as long in the zone as it is on the shape after `at`
(the lathe went by the profile's numbers, so a short steep shoulder made wide by `at` got a few pixels), and the
corners round a ring are spaced as they are in space. `w` on a ring weighs its band; `allot` shares a picture
between parts by their sizes, which the surface reports.

The surface: `{ name, sides, seam, zone, rings, length, girth, reach: [start, end], places, ends: [{ p, n }, { p, n }], at(s, angle, out = 0) }`.
`length` is over its rings, `girth` round them, `reach` from each cap's rim to its point, all in units. `ends`
are the middles of its two ends (a dome's point) and the way each looks. **`at(s, angle, out)`** gives
`{ p, n, uv }`: the point of the built faces themselves at `s` along (the rings' own `s`; a cap goes on past the
last ring by its rise) and `angle` round, moved `out` units off the surface; the normal there; and its place in
the picture, in pixels. Nothing has to reproduce the surface to stand on it.

| Call | Makes |
| --- | --- |
| `M.tube(path, zone, options)` | A tube or a tail along a curve: `path` is `[[x, y, z, r], ...]`, `r` a radius or `[up, sideways]`; 0 at an end makes a point. `up` (`[0, 0, 1]`): which way a ring's first corner looks at the start; it is carried along without twisting. `sides` 6. Otherwise as `turn`, and it returns a surface: `s` is the length along the path. |
| `M.ridge(surface, path, zone, options)` | A ridge or a bar along `path` (`[[s, angle], ...]`) on a surface. `width` 0.5, `height` 0.2, `top` (the width of a flat top; 0: one edge), `sink` 0.05 (its feet under the surface), `ends: [start, end]`, each `"point"` (it narrows and falls to a point), `"run"` (it falls into the surface at full width), `"cut"` (closed) or `"open"`; `over`: the length an end takes to grow (the width), or `[start, end]`. It is cut wherever it crosses from one face of the surface to the next, so it follows them. Its length lies along the zone. Returns `{ name, length }`. |
| `M.band(surface, s, zone, options)` | A flat-topped bar round the surface at `s`, from the angle `from` (the seam) to `to` (once round). Options as `ridge`. |
| `M.boss(surface, [s, angle], zone, options)` | A round stud: `radius` 0.3, `height` 0.15, `sides` 8, `rings` 1 (a low cone; 2 or more: a dome), `sink` 0.03. Laid as a disc in the zone. |
| `M.studs(surface, path, zone, { count, closed, ... })` | A row of `count` bosses evenly along a path (`closed`: round a ring, the last left out), all in one zone: one picture for every rivet. Returns their places. |
| `M.leaf(rows, zone, { back })` | A thin sheet seen from both sides: `rows` is a grid of points `[[p, p, ...], ...]` (two rows of two: one quad; a row of one point repeated: a tip). Each side has its own faces and normals, so each is lit as it faces and neither is missing. `back`: a zone of its own for the back. |

`ridge`, `band`, `boss` and `studs` take anything with `at(s, angle, out) -> { p, n }` as their surface (`steps`
then says how finely to follow it). What all these make is turned the right way by how it is built: there is no
`inside` point to give. Every corner carries `of` (its part's name: `"wall"`, `"wall.cap1"`, `"wall.lining"`,
`"wall.rim"`; a leaf's back is `"name.back"`), `q` (where in the part it is: `carryPicture` goes by it), and
`group` (see "Creases"). They are plain fields: map a shape's triangles to another place with
`tris.map((t) => t.map((c) => ({ ...c, p: move(c.p) })))` and they go along.

```js
const M = workshop.shape(512, 512), Z = workshop.allot(512, 512, { WALL: [31, 12.6], CAP: [12.4, 12.4], IN: [31, 6, 0.12], BAR: [8, 1.1, 5] });
const dip = (a) => -2.2 * Math.max(0, Math.cos(a)) ** 3;                                 // the chin: the base ring drops at the front (angle 0)
const wall = M.turn([{ s: 0.3, r: [5.25, 4.3], ds: dip }, [3.4, [5.5, 4.5]], { s: 9.9, r: [5.4, 4.4], crease: true }], Z.WALL,
  { name: "wall", sides: 16, seam: Math.PI, lie: "across", caps: [false, { dome: 3.1, zone: Z.CAP }], lining: { inset: 0.12, zone: Z.IN, cap: 2.5 } });
M.ridge(wall, [[0.9, 0], [7, 0]], Z.BAR, { width: 0.9, height: 0.21 });                    // a bar down the face
const top = wall.ends[1];                                                                // the dome's point, and the way it looks
```

## The kits (`kits/`)

Each takes a description and returns `{ tris, image }`. Their file headers list every option.

| Import | Makes |
| --- | --- |
| `sword(spec)`, `taper`, `METALS`, `carved` from `kits/swordkit.mjs` | Any blade with a grip: pommel, grip, guard, blade (`section: "diamond" | "single" | "fuller"`, `curve`). Texture 1024x256. |
| `axe(spec)`, `crescent`, `flared`, `wrap`, `bolts` from `kits/axekit.mjs` | A haft with one or more bits. `haft: true`. Texture 1024x512. |
| `blunt(spec)`, `toward` from `kits/bluntkit.mjs` | A haft with turned parts on it: clubs, bats, hammers, maces. `haft: true`. |
| `bow(spec)`, `through` from `kits/bowkit.mjs` | A bent stave and its string. `rig: "nearest"`. Texture 1024x256. |
| `firearm(spec)`, `FIREARM_PRESETS`, `FINISHES` from `kits/firearmkit.mjs` | A gun: receiver, barrel, grip, guard and trigger, magazine, stock, forend, sights (pistol, shotgun, submachine gun, rifle). Texture 1024x512, and `parts`. |
| `PARTS`, `SETS`, `kitbash(name, place, size, seed)`, `seeded`, `REACH` from `kits/kitbash.mjs` | Not a picture: 45 small hard-surface parts (bolts, brackets, clevises, hinges, vents, grilles, actuators, lamps, sensor pods, canisters, motors, tanks, conduits...), each `(place, size, rnd) -> [solid]` of `solids`, set on a surface by a place (its Z out of it, its X along it), the same for the same seed. `SETS` groups them by what they suit (fitting, mechanism, gear, sensor, armour); each solid's `mat` names its paint. A part lies within `REACH` of its place for its size. It re-exports `solids`. |
| `kits/furniture/*.json` | Not code: 30 model specs (bed, sofa, stove, fridge, bench, trees...), a map spec's props as `"kit:<name>"`. |
| `recipesOf(mod)` from `kits/encounterkit.mjs` | Not a model: a map's encounters wired, as entities for `writeMap` (`area`, `monster`, `trigger`, `line`, `fillAhead`, `onArrival`, `surprise`, `waves`, `counted`, `rewardOnDeath`, `chance`, `oneOf`). `docs/MAPS-DESIGN.md`. |

The kits paint large. Bring a picture down with `shrink(image, 2)` or `4` before `indexed` for GoldSrc.
