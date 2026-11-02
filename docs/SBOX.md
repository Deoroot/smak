# s&box (Source 2): a GoldSrc model, and a map, in s&box

A GoldSrc model (`.mdl`, version 10) is ported to s&box in one command:

```
node bin/smak.mjs sbox-port <model.mdl> -o <project>/Assets
```

The kit reads the model itself and writes what s&box's model compiler reads: a DMX for each submodel and each
animation, a `.vmdl` (ModelDoc's document) that says how they go together, and a PNG and a `.vmat` for each
texture. s&box's own `resourcecompiler` compiles them. The command ends in `PASS` with what it made, or stops
with what the compiler said.

## What it needs

- **s&box, on Windows.** Its compiler is `sbox/bin/win64/resourcecompiler.exe`, an outside program that comes
  with s&box. It is found in Steam's libraries, or by `FACEPUNCH_ENGINE` (which s&box's launcher sets). Otherwise
  name its folder with `--sbox <folder>` or `SMAK_SBOX`.
- **The model's own files**: `<name>t.mdl` and `<name>01.mdl` ... beside it, as for GMod.
- **An s&box project's `Assets` folder** for `-o`, or any folder laid out as one. The editor picks the files up
  as they are; `sbox-cli --new "Title" --template addon.minimal` makes a project.
- `--no-compile` writes the files with no compiler.

The compiler runs without its renderer, so nothing is written into s&box's folder. It writes each file's compiled
form beside it (`.vmdl_c`, `.vmat_c`, the textures' `.vtex_c`).

## What it makes

Under `-o <Assets>`:

| | |
| --- | --- |
| `models/smak/<name>.vmdl` | the model's document; `<name>.vmdl_c` beside it, compiled |
| `models/smak/<name>.vanmgrph` | its animation graph, when an animation blends (compiled beside it too) |
| `models/smak/<name>/<submodel>.dmx`, `anims/*.dmx` | its meshes and animations |
| `materials/models/smak/<name>/<texture>.png`, `.vmat` | its textures and materials; `<texture>_mask.png`, a masked one's holes |
| `sounds/smak/<its path>.wav`, `.sound` | the sounds its events play (`.wav.meta` a loop's); the `.wav` compiled beside it (`.vsnd_c`), the `.sound` by the editor |

In the editor or a game's code, the model is `models/smak/<name>.vmdl`. `--folder` puts it under another folder
than `smak`.

## Why DMX, not SMD

s&box reads no SMD. Its resourcecompiler refuses an SMD as an animation ("unrecognized file type"), fails one
as a mesh with no reason given, and none of its libraries names the format; `dmxconvert` knows no SMD either.
Source 2's own format is DMX, and s&box ships some (`addons/citizen/.../citizen_head.dmx`). A port's DMX is that
file's kind: keyvalues2 text, format `model 22`.

## What is kept, and how

The port is Source's port (`docs/SOURCE.md`) written for s&box: `portToSource` works the model out once and hands
its parts as data, and `src/sbox/` writes them as s&box reads them. So everything that page says is kept is
kept here too (the bones, every frame, the bodygroups in their order, the skins, attachments and hit boxes, an
animation's fps, looping and activity, a loop's travel, chrome worked out once), and:

- **Bodygroups** as ModelDoc's `BodyGroup`s, a submodel each `BodyGroupChoice`, a blank one with no meshes. Two
  of one name (`v_9mmhandgun.mdl`'s two `studio`) are `<name>`, `<name>_2`: s&box finds a bodygroup by its name.
  A name ending in a number after a letter gets an underscore before it (loader.mdl's `leg2` is `leg_2`): ModelDoc
  renumbers such a group (`leg1` to `leg4` came out `leg1`, `leg3`, `leg5`, `leg7`). A model of one submodel has
  none to choose.
- **Skins** as material groups: the first is the default, each after it a `MaterialGroup` `skin1`, `skin2`...
  that changes the materials it changes. A renderer picks one by its `MaterialGroup`.
- **A loop's travel** taken out by the compiler as root motion (`ExtractMotion` on the root bone, along the axes
  GoldSrc's was, LX LY LZ): the walk plays in place and the game moves the model by it, as GoldSrc's did.
- **Events that play a sound** (1004 a step, 1008 a voice, 5004 a view model's clip) as s&box's that play one,
  `AE_CL_PLAYSOUND` naming a `.sound` (5004's `AE_CL_PLAYSOUND_ATTACHMENT`, at the model's first attachment, where
  GoldSrc's client played it): `SkinnedModelRenderer` plays it, with no code of the game's. See "Its sounds" below.
- **Every other event**, and one whose sound is not found, as s&box's generic event, `AE_GENERIC_EVENT`, at its
  frame: the event's number as `Int`, its options (a sound's file, moved under the port's folder; a sentence; a
  script's words) as `StringData`, and `TypeName` `goldsrc`. A game's code hears them through
  `SkinnedModelRenderer.OnGenericEvent`.
- **Hit boxes** as one `HitboxSet`, each box on its bone, its GoldSrc hit group as the tag `hitgroup_<n>`.
- **Attachments** on their bones; a view model's first, unnamed, `muzzle`.
- **Textures** as `complex.shader`'s materials: the picture as the colour, no shine (GoldSrc lit a model by its
  normals alone), and the texture's flags as its features. Masked (64) is alpha-tested on a mask of its holes,
  additive (32) is added to what is behind it, and fullbright (4) lights itself (its self-illumination mask a white
  picture: given as a colour, `complex.shader` makes it a texture s&box does not have, and draws it red). A masked
  texture is made a power of two each way, its picture opaque and a hole its neighbours' colour: s&box's texture
  compiler makes no mipmaps of a mask whose sides are not, and the material fails while the model compiles
  (Counter-Strike's four trees, Master Sword's two; none of Half-Life's has holes).

## Lit as GoldSrc lights a model (`--lighting goldsrc`)

GoldSrc lights a model with no light entity at all (Xash3D's `R_EntityDynamicLight`, `R_StudioLighting`;
`src/maps/model-light.mjs`). Once a frame it takes one light at the model's origin:

- **the sky's** (`sv_skycolor`, which TS's game sets from the map's light_environment: (c x brightness / 255 / 114)^0.6
  x 264), shining along the sun's way, when a line from 8 units above the origin toward the sun comes to sky first;
- **else the floor's**: the baked light of the first lit face straight under that point (2048 units down, each style
  at its level), shining down, leant by how the floor's light changes 16 units off on the four diagonals.

Of the light's brightest channel, `v_direct` (0.9) shades by facing and the rest is ambient (128 at most, the two 255
at most); each point gets the ambient, plus the shade by how it faces (`SHADE_LAMBERT` 1.495's modified hemisphere:
all facing the light, about 0.67 side-on, none facing away), times the light's colour.

`--lighting goldsrc` (`lighting: "goldsrc"`) puts a model's textures on SMAK's shader for it
(`shaders/smak_studio.shader`, written into the project; `src/sbox/studio.mjs`). The game hands each renderer its
light as render attributes (`Renderer.Attributes`): `SmakModelLight` (0 to 255 a channel), `SmakModelLightWay`, and
`SmakModelLit` 1. A renderer not handed one is drawn as GoldSrc draws a model out of any world: ambient 192, no
shade. The colour is the engine's (engine/client/gamma.c, gl_studio.c): the texture as the screen shows it through
texgamma (each colour to the power texgamma / gamma, 2.0 / 2.5, `g_flTexGamma`: dark colours lifted most), times the
light's colour times illum / 255 (lightgamma's table, a straight line at gamma and lightgamma 2.5 and brightness 0),
times `g_flLightScale`, 1.5. That last is measured, not the engine's code: TS on Steam (2026-10-28, ts_lobby's
hallway, TS's agent seen from the camera a demo of it recorded, beside s&box drawn from the same camera; the world
there 1.07 times as bright as TS draws it) drew agent's suit 1.5 times what the formula gives, 1.51, 1.49 and 1.49
by channel; at 1.5 the suit is within 0.2 of TS's in each. One measurement: whether it is a constant of Steam's
engine or its shading by facing differs is not told apart yet. Two guesses before it were too dark: half the map's
scale (an overbright TS does not use: `gl_overbright 0` in TS's config.cfg and Half-Life's), and the map's scale
with no texgamma (a near-black suit two thirds as bright as TS's). Fullbright (4) is the texture as it is, flat shade (1) the ambient and 0.8 of the shade, masked (64) its
holes; an additive texture (32) stays `complex.shader`'s, which needs a pass of its own. s&box's lights put nothing
on it.

Where the light comes from is the game's to work out: a map ported with lightmaps carries what GoldSrc reads
(`lighttree.bin`, below), and the walks to port are `lightAt`, `lightAlong` and `meetsSky`. Momentum Break's C#
port of them agrees with SMAK's at every one of ts_lobby's 17 starts and 300 spots round them, to the sample.

## Blends, in an animation graph

GoldSrc's game code chose an animation by its number (`pev->sequence`) and said how far along its blends it was
(`SetBlending`, Half-Life's aiming up and down: a value between the blends' start and end). s&box blends only in an
animation graph, so a model one of whose animations blends gets one (`<name>.vanmgrph`, named by the `.vmdl`) that
does what GoldSrc's game code did:

```
var r = go.Components.Create<SkinnedModelRenderer>();
r.Model = Model.Load( "models/smak/barney.vmdl" );
r.Set( "sequence", "shootgun" );   // the animation, by its name
r.Set( "blend_xr", 20f );          // where along its blends: barney's gun from -50 (down) to 50 (up)
```

- **`sequence`**, an enum: an option each animation, in the model's order. A selector on it plays one; a new one
  starts at its first frame (as GoldSrc's `ResetSequenceInfo`) and fades in over 0.2 seconds (a view model's at
  once, as its fades).
- **An axis a float**, named as the GMod port's pose parameter (`blend_xr` a pitch, `blend_x`, `blend` where GoldSrc
  names no motion), ranging over every animation that blends on it, starting at 0 (level) or the nearest end. An
  animation that blends on one axis is a blend node over its two at the values they stand for; one past its range
  is held at its end, as `SetBlending` holds it. One on two axes is a 2D blend of its four.
- **Each blend an animation of its own** too (`shootgun_blend1`), after all the model's own, so that those keep
  GoldSrc's numbers. With `UseAnimGraph` off, `Sequence.Name` plays any of them, as before.

Measured in the editor: s&box's blend is GoldSrc's. Barney's `shootgun` played by the graph at -50, -25, 0, 25 and
50 is within 0.008 units of where GoldSrc's renderer puts every bone (`StudioSlerpBones`: each bone's turn slerped,
its place mixed). A graph at a playback rate of 0 is not played at all; and told its parameters after it starts, it
fades from the first animation, so the check tells a new renderer before it starts.

The seven of Half-Life's models that blend get a graph: agrunt, barney, hassassin, hgrunt, icky, player (52
animations that aim) and tentacle2 (its taps by height, `blend_x` 86 to 376).

## Its sounds

The sounds a model's events play are looked for where GoldSrc looked: the `sound/` folder of the mod the model is
in, then valve's (`sounds` in the API, as `gmod-port`). Each found is written under `sounds/<folder>/`, at the path
the event named:
- **the `.wav`, as it is.** s&box's compiler takes GoldSrc's files (8-bit at 11025, 22050 and 44100 Hz, 16-bit
  stereo) and compiles them as Opus at 48000 Hz, of the same length, or a small one as 16-bit PCM at its own rate;
- **its loop, in a `.meta` beside it** (`{ loop, start }`, the cue's time). GoldSrc loops a file from its cue point
  to its end; s&box's compiler does not read the cue chunk (measured: `weapons/rocket1.wav` compiled with no loop),
  it reads the `.meta`;
- **a `.sound` that plays it as GoldSrc's mixer did.** GoldSrc's gain falls in a straight line from 1 where the
  sound is to 0 at 1000 units over its attenuation (Xash3D's `S_SpatializeChannel`, as Quake's); a monster's events
  play at `ATTN_IDLE` (500 units), a view model's at `ATTN_NORM` (1250). The `.sound`'s `Distance` is that, its
  `Falloff` a line from 1 to 0 (s&box's mixer gains a sound by its falloff at its distance over its `Distance`),
  with no occlusion, reverb or air absorption, which GoldSrc's mixer had not.

`resourcecompiler` compiles the `.wav` (`compileSounds`, one run for all of a model's); a `.sound` only the editor
compiles, which it does on opening the project, and `sbox-check` asks it to. A sound the game has not
(Half-Life's `holo.mdl` names 18 that Steam's Half-Life leaves out) is said, and its event kept generic.

## What it collides as

As the GMod port does, made by the same code (`--collision auto`, the default): a model of one bone collides as
its convex hull, a figure with hit boxes as a ragdoll, a view model and a held one as nothing, and a model of many
bones with no hit boxes as nothing (`--collision hull` or `box` makes one; `ragdoll`, `none`). Gibs are no ragdoll
either: a body part whose choices are each on bones of their own, the model as first drawn on one bone with hit
boxes at most (hgibs.mdl, woodgibs.mdl, mil_crate.mdl), is shown one choice at a time, its pieces never one body;
said, and nothing made unless told. `--surfaceprop` and `--mass` as gmod-port's. `src/sbox/physics.mjs` writes it
as ModelDoc's physics nodes:

- **A hull a piece, on its bone**: a `PhysicsHullFile` of its own DMX (`models/<folder>/<name>/physics/`), on its
  bone. s&box reads the file in the model's space at rest and puts the hull in the bone's frame, a body each bone.
  A skinned file on no bone is one body on no bone whatever its vertices are on, so a ragdoll is a file a piece.
- **A joint a piece** but the first. A bone its animations turn about one axis only (a knee, an elbow) has a
  revolute joint (a hinge) about it, from its least to its most; one they turn about more a conical joint, twisting
  about the bone (its x, along it to its child) and swinging as far as the widest of its other two. The anchor is
  the child's place at rest, turned so its z is that axis: s&box turns a joint about its frame's z (citizen's elbows,
  its cones along its limbs). Tried on barney's poses inside his limits, cones about the frames' z held 93 of 95,
  about their x 68. A cone is round, where Source's limits are a box an axis: a pose near two limits at once is
  outside it (barney's upper arm in shootgun, 87 degrees of swing against 86). A cone holds 90 degrees of swing at
  most: at 100 or more s&box's flips the piece over; a wider one is held to 90, said.
- **A hull of 44 corners at most**, made exactly (`optimization_algorithm "Exact"`). s&box drops a hull of more than
  255 half-edges ("Hull Too Complex for Runtime"), and the compiler's own simplifying (QEM) left hulls 0.5 to 14
  units off theirs (nihilanth's head), so the port simplifies each itself, said when one is cut in more than 0.5.
- **Weight**: a ragdoll a person's 90 kg unless told, shared among its pieces by their volume (`mass_override` a
  body), as Source's compiler shares it; a prop what s&box's surface makes of its volume (its density) unless told.
  Then evened out, said: no piece weighs less than 1% of the whole, nor a tenth of one joined to it. s&box's joints
  give between pieces of weights far apart (loader thrown thousands of units, with 31 to 1366 times across a joint),
  and the rest dropped on a light piece presses it through the floor (archer's fin, 0.2% of it, 1.1 units through;
  big_mom's Bone26, 0.08%, its joint 3.4 apart).
- **Its inertia and damping** as the GMod port's QC has them (`$inertia 10`, `$damping 0.01`, `$rotdamping 1.5`):
  `inertia_scale`, `linear_damping`, `angular_damping`.
- **Surface**: GMod's surfaceprop as the s&box surface it starts with or is kin to (`metal_box` metal, `alienflesh`
  flesh, `porcelain` ceramic); none like it is `default`, said. s&box has 13: cardboard, ceramic, default, dirt,
  fabric, flesh, glass, grass, metal, plastic, rubber, water, wood.
- **Pieces that meet at rest are trimmed apart.** Source's physics let a ragdoll's pieces start inside each other;
  s&box's pushes them apart: barney's arms out of his chest, his hands 13 units off, 10 to 44 units a piece as a
  game's ragdoll (`ModelPhysics`). A joint keeps its two pieces from colliding, so two that are not joined and meet
  (within 0.1) are cut along the plane across which they reach into each other least, each kept on its side, 0.1
  apart; said, with how far they reached (barney's chest and arms 1 to 5 units; loader's cockpit and neck 26, its
  meshes through each other). A `PhysicsJointNull` would keep them from colliding as they are, but s&box's own code
  cannot read a model that has one ("Unhandled joint type: NULL_JOINT").
- **A flat hull** (a model whose triangles lie in one plane) is made 0.5 thick, as the GMod port's pieces are.

Measured in a running game (the editor's play mode): barney as a game makes a ragdoll (`ModelPhysics`) dropped onto a
floor falls whole, its 19 pieces together, crumples, and is still in 3 seconds, nothing through the floor.

All 210 of Half-Life's models pass `sbox-check` with their physics (2026-10-26): 60 ragdolls, 55 hulls, the rest
nothing (view models, `p_` models, gibs, many bones and no hit boxes). Dropped, every ragdoll comes to rest, none
0.4 units through the floor; most within 4 seconds, the biggest slower (tentacle2 7.7, rengine 11.2, nihilanth
13.3). The runs before found the cone that flipped, the hulls s&box dropped,
the pieces too light for their joints and the floor, and gibs made one ragdoll.

## What changes, and why

Measured on Half-Life's barney in s&box's editor, its bones read back while it played (2026-10-26):

- **No turn.** GMod's QC turns the model back with `$origin`; s&box's compiler turns nothing. The DMX says
  its axes are z up, `forwardParity 1`, which s&box reads as its own. `-2`, the parity s&box's citizen uses,
  turns meshes and animations alike a quarter round. A model at rest may still face another way: barney's
  root bone rests turned -90 degrees and his animations turn it back. GoldSrc drew a model only through an
  animation, and so does a port, so judge its facing by one.
- **Bones named as s&box keeps them**: anything but a letter, a digit or an underscore as an underscore
  (`Bip01 Pelvis` is `Bip01_Pelvis`, stealth.mdl's `Stealth.` is `Stealth_`). s&box renames the mesh's bones so, and
  an animation's channel on `Bip01 Pelvis` then moves nothing, a hit box on `Stealth.` finds no bone. Two names
  that come out one are kept apart (`Bip01_L`, `Bip01_L_2`).
- **A `p_` model keeps its bones' names.** GMod's port gives a held weapon Valve's biped's names so GMod finds its
  hand; s&box looks for no such hand. `--kind held` still asks for them. A `v_` model is a view model, as for GMod:
  its animations start outright and its first attachment is its `muzzle`.
- **No bone dropped** (`bone_cull_type "None"`). The compiler drops a bone no vertex is on: barney's root `Bip01`,
  and with it the turn it rests in and a walk's travel.
- **A mesh's node named with no hyphen.** `barney-x_template` fails the compile as `Node ... resolve failure`,
  with nothing else said. Its file keeps its name. An animation's node is named so too, said in a warning.

## What is left behind, and said

- **A sound that follows the model.** s&box plays an event's sound where the model (or its attachment) was when
  the event fired, and leaves it there; GoldSrc's followed the entity. A step is over before it shows.
- **Sentences** (`!HG_ALERT`), which an event may name in GoldSrc: kept in the generic event's options.
- **Bone controllers**, as for GMod.

## How a port is checked

The compile is the first check: it ends in an error, or in a `.vmdl_c` with nothing it could not resolve and
every material compiled. The compiler is given each material by name with the model: it compiles the first skin's
with the model and another skin's not at all (s&box compiles it when it is first worn), and a material that fails
leaves the model compiled and says so only in a texture's line. A compiled file counts only when this run wrote
it. Where a project's folder is deep, the compiler's names for a material's generated textures run past Windows'
260 characters ("Path Overflow", "Failed to write"), and the error says so: a project in a shorter folder compiles
them. A model can still compile wrong (turned, its animations moving nothing, a texture lost), so the port is then
held to its original in s&box's own editor:

```
node bin/smak.mjs sbox-check <model.mdl> --project <project folder> [-o shot.png]
```

`sbox-check` makes the port again as `sbox-port` made it (give it the same `--name`, `--folder`, `--kind`), reads the
compiled model back in the editor and holds it to what the original says:

- every bone of the port, under its parent;
- every animation, of its length ((frames - 1) / fps);
- every bodygroup with its choices, a material group a skin, every attachment and hit box;
- **each animation's poses**: it is stopped at its first frame and its middle one (`--frames` more), and every
  bone's place in the model's space is read and set beside where GoldSrc's frame puts it (`poseAt`), within
  `--tolerance` units (0.1) and 0.0005 of the bone's chain (its links to the root, end to end): s&box compresses
  rotations, which moves the end of a long chain farther (a turn of 0.03 degrees; a model turned one degree is 35
  times that). A turned model, a misnamed bone (its channel then moves nothing), a dropped bone, a
  walk whose travel was not taken out all show here as bones off their place. Each blend after an animation's first
  is held so too, as the animation of its own it is;
- **its graph's blends**, when it has one: the graph there, with `sequence` and each axis's parameter, and each
  animation that blends played by it at its first frame at its blends' start, middle and end (one on two axes at its
  four corners), every bone where GoldSrc's renderer puts it, within the same tolerance;
- **what it collides as**: a body on each piece's bone, its hull's corners within 0.5 units of the port's, its mass
  and surface, and each joint between its pieces, of its kind and limits, at the
  child's place, about its axis. Then tried in physics worlds of its own (made and deleted; nothing in the scene):
  held at rest with its pieces colliding (none may move 0.1: none pushes another); held in each pose the check
  samples that is 5 degrees inside every joint's limits and moves no bone 0.5 off the piece above, its collisions
  off (none may move 1: the joints hold what the animation does; GoldSrc's animations move bones as well as turn
  them, barney's head 2 units off his neck in smlflinch, which no joint holds); dropped from 20 units onto a floor
  with s&box's gravity until it is still (no piece moved 1 unit in the last second), 15 seconds at most: it comes
  to rest, nothing through the floor, its joints together, within 1 unit or 1% of its size, whichever is more;
- **its sounds**, when its events play any: each `.sound` as the editor compiled it, playing its file, as long as the
  original (within 0.005 s), heard to GoldSrc's distance in a line, with no occlusion or reverb, and as loud as the
  original 10 ms by 10 ms (correlated 0.99 or more; Half-Life's are 0.998 or more). Then each played far below the
  scene, where no one hears it: one that loops still playing after its length, one that does not stopped. And each
  animation with sound events played through by a renderer of its own: the sounds it is heard to fire
  (`OnSoundEvent`) must be its events', as many of each. A loop is played looping, each of its sounds heard and no
  other: s&box fires an event at the last frame of an animation held at its end not at all, and a looping one's each
  time round, as GoldSrc did.

- **its materials**, each compiled by the editor (its `asset_compile` asked for every one): s&box draws one that did
  not compile red, and says so nowhere else;
- **how it looks** (`--no-look` leaves it out): drawn by s&box in a scene of its own (no light but a white ambient
  one, so a texture shows as it is; ticked by the check, or the model stays in its rest pose), in its first
  animation's first frame, from four views round it (its front, left and back, and its right from above, 256 pixels
  square, 60 degrees across), and by the kit's own renderer (`render.mjs`, its texture as it is) from the same eyes.
  Its silhouette must be the original's (95% of the model's pixels in either picture in the other, a pixel apart
  at most) and its colours too, region by region in 16 by 16 (no more than 12% of the regions more than 80 apart, a
  channel's mean). A chrome texture's pixels are left out of the colours: the kit draws chrome as GoldSrc does, from
  where the eye is, and the port has it worked out once. A material not compiled, a texture lost or wrong, holes
  filled, a large part missing or one too many, a model turned: none of these moves a bone, and each shows here.
  Measured on Half-Life's 205 models: the least silhouette 97.6% (uplant2, a blade of grass), the most regions
  apart 8.7% (ventgibs, a fine black and white texture seen edge on, which s&box's mipmaps make grey). Each of
  their materials drawn red by the kit, as s&box draws one not compiled: 349 of the 480 that are a twentieth of the
  model or more are caught, 213 of 241 of a fifth or more; an orange or red one drawn red (the HEV suit's
  sleeves, flesh, blood) is the most often missed, and the editor's compile answer says it all the same.

It talks to the editor through `sbox-cli` (which comes with s&box: `sbox/bin/managed/sbox-cli.exe`), over a local
pipe, never the network. It uses the editor open on the project, or opens one and closes it after (a minute). Its
probe object is made in the scene being edited, far below it, and removed before the check ends; nothing is saved.
`-o`: the kit's four pictures of the original above s&box's of the port. Ends in `PASS` or `FAIL`.

Measured so: barney, houndeye, scientist and hgrunt (918 poses) are within 0.025 units of GoldSrc's places at every
bone, walks and runs included (their travel taken out by s&box gives GoldSrc's pose exactly). s&box wraps a looping
animation's very end to its start; the check plays it not looping, so its last frame is held. Before the check,
a port of Half-Life's barney, houndeye, can, w_crowbar, v_9mmhandgun, hgrunt, scientist and Counter-Strike's
bigtree was looked at in the editor: a view model's muzzle 20 units ahead of the eye, bigtree's leaves cut out.

All 210 of Half-Life's models port and compile with nothing the compiler could not resolve, in 3.5 minutes
together (2026-10-26). The 211th, doctor.mdl, is a version 9 file, which the kit does not read. All 210 pass
`sbox-check` in one editor, in 8 minutes. Most bones are within 0.03 units; the farthest is 0.19, the end of
tentacle2's tentacle 650 units along its chain (nihilanth's arm, the osprey's prop and the loader's legs 0.10 to
0.16). The run found loader's renumbered bodygroups, and one call (of thousands) that found no running editor, which
a call now tries once more.

With their graphs (2026-10-26), the seven that blend pass too: 207 blends played by their graphs, every bone
within 0.023 units of GoldSrc's but tentacle2's tentacle (0.19 at its end, as its animations). 210 of 210 compile.

With their sounds (2026-10-26): the 13 of Half-Life's models whose events play sounds pass, 69 sounds and 185 sound
events (agrunt, barney, bullsquid, garg, gman, hgrunt, islave, loader, scientist, v_357, v_9mmar, v_9mmhandgun,
zombie); every sound as loud as its original 10 ms by 10 ms correlated 0.993 or more (all but v_357 0.998 or more), every event
heard. holo.mdl's sounds are not in Steam's Half-Life, and its events stay generic.

## A glTF model (`.glb`, `.gltf`)

`smak sbox-port model.glb -o <Assets> [--name n] [--folder smak]` takes a bought or downloaded model (Blender's
export, Quaternius's, Mixamo's after Blender) straight to s&box, with no `.mdl` on the way: none of GoldSrc's limits
(a bone a vertex, 2048 points a submodel) are put on it (`src/sbox/glb.mjs`).

- **Bones**: the nodes its skins hang from, every node above them, and each node an unskinned mesh hangs from (a
  hat on a head), by their names as s&box keeps them. A node's scale is taken into the places below it.
- **Skin**: each vertex's weights as the file has them, four bones at most (the heaviest, made to weigh one).
- **Animations**: each once (Blender's "Armature|Idle" beside "Idle" is one), sampled at 30 a second from its first
  moment to its last; one named idle, walk, run, cycle or loop loops.
- **Materials**: each its PNG picture where it has one, else a picture of its colour (sRGB).
- **Units**: the file's metres in s&box's inches (39.37 a metre), +x forward and +z up.

`smak sbox-check model.glb --project <folder> [--frames 5] [-o shot.png]` reads it back in the editor and holds it to
the file: every bone under its parent, every animation of its length, and each animation at `--frames` frames with
every bone where the file's own nodes put it (not where the frames written say: the whole port is held). How it looks
is not held to anything, the kit drawing GoldSrc's models only; `-o` saves s&box's own pictures of it, to look at.

Measured (2026-11-01) on Quaternius's "Character Animated" (CC0): 32 bones, 6,050 triangles, 12 animations, compiled
in 2.3 s; 60 poses held, the farthest bone 0.022 units off.

## A map, as a scene

A GoldSrc map (`.bsp`, version 30) is made an s&box scene in one command, and held to the original in the editor in
another:

```
node bin/smak.mjs sbox-map <map.bsp> -o <project>/Assets [--mod msc]
node bin/smak.mjs sbox-map-check <map.bsp> --project <project folder> [--mod msc] [-o shot.png]
```

A scene, not a Hammer map (`.vmap`): a `.vmap` is Hammer's own DMX (half a megabyte for s&box's flat test map), lit
by s&box's compiler, and would look like an s&box map; a loader that reads the BSP when it loads, as s&box's Quake
mount does, is engine code that reaches others only by a pull request to Facepunch. A scene is JSON that the kit
writes, the editor opens and edits, and a game loads.

What it makes, under `-o`:

| | |
| --- | --- |
| `scenes/smak/<map>.scene` | the map: a game object for the world, one for each brush entity, the clip brushes, each start and light, the sky |
| `materials/smak/<wad>/<texture>.png`, `.vmat` | a wad's textures, shared by the maps that wear them (a holed one's holes in `_mask.png`) |
| `materials/smak/maps/<map>/<texture>.png`, `.vmat` | a texture the map carries inside itself |
| `materials/smak/sky/<skyname>.png`, `.vmat` | its sky: the six sides one picture round the world (s&box's `sky.shader` reads it so) |
| `materials/smak/tools/` | the clip brushes' material; a white picture, a self-lit texture's mask |
| `materials/smak/maps/<map>/lighttree.bin` | with lightmaps: what a game lights a model by as GoldSrc does (below) |
| `surfaces/goldsrc_<type>.surface` | a surface for each texture type the map's textures have (below) |

- **Its faces** as the scene editor's own meshes (`MeshComponent`): drawn, collided with, and editable as a mapper
  edits s&box's meshes. Each face of the BSP, as compiled, is a polygon of its own: the world's in one mesh, each
  brush entity's (`model` `*N`) in its own at its `origin`, solid with every one of its brushes, faces never drawn
  too (MSC's test_scripts has a shield round its start, a cage whose lid is never drawn), as hidden solids under it
  tagged `brush`; one in render mode 5 drawn additive at its `renderamt` (that share to the power 2.2: GoldSrc adds on
  the screen's colours, s&box in linear light). The kit writes the mesh as s&box saves it (a half-edge
  mesh in a blob: `PolygonMesh.Serialize.cs`): each side of a polygon an edge inside it and its twin outside, each
  half-edge with the texture coordinate of the corner it points to. No corner is shared, so no edge is shared by three
  faces, which a BSP's T-junctions would make (stalkyard's 2502 faces, none refused). GoldSrc walks a face clockwise,
  s&box anticlockwise: the corners are turned round. Units and axes are the same in both. Sky faces and the
  compilers' tool textures (clip, origin, null, hint, skip, aaatrigger) are not drawn; `func_illusionary` collides
  with nothing.
- **What its faces are made of**: GoldSrc gives a texture a type in the game's `sound/materials.txt` (`M` metal, `V`
  vent, `G` grate and so on; concrete when not listed, read as the engine reads it: `textureTypes`), which picks its
  steps' and bullets' sounds and, in TS, an impact's particles. Each material names its type's surface
  (`PhysicsSurfaceProperties` under `SystemAttributes`), one of the kit's own, `goldsrc_concrete`, `goldsrc_vent`...
  (`SURFACE_OF_TYPE`, `surfaceOfType`), each made on the nearest of s&box's (a vent on `metal.sheet`): s&box's own
  surfaces have no vent, grate, tile, computer or slosh. A trace that hits a face reports it (`SceneTraceResult.Surface`,
  measured on ts_lobby), so a game tells the type by the surface's name.
- **Decals** (a bullet's hole, blood): `sboxDecal(texture, { picture })` makes a decals.wad texture an s&box decal
  definition (`.decal`) and its picture, read as the engine reads it (`maps.decalRgba`: masked when the palette's last
  colour is pure blue, each pixel its colour and 255 a hole; else every pixel that colour with its index as alpha),
  at its texture's size in units, a pixel a unit. The lightmapped shader lays s&box's decals on the texture before
  its light, as GoldSrc lights a decal by its face's lightmap. A game lays one with a `Decal` component: leave its
  `Size` at 1 (it multiplies the definition's) and set its `Rotation` (a Decal turns itself at random by default).
- **Its clip brushes**, rebuilt from the player's hulls as `gmod-map` rebuilds them (`clipBrushesOf`): GoldSrc keeps
  no clip brush but in the hulls. Each a mesh of its own that collides as its hull (solid all through: a mesh
  collides only at its faces) and is seen in the editor only (`HideInGame`), under a game object `clip`. With them,
  `sky clip`: the world's sky faces, never drawn, colliding as a mesh, as GoldSrc's player hulls have the sky solid.
  A sky face that closes the map has the void behind it, and the hull's region there runs out into the void, where
  `clipBrushesOf`'s samples miss its growth in front of the face (ts_parking: 93 spots of 5000 by its sky blocked only
  in GoldSrc; with the sky's faces, 6).
- **Its textures** as PNG and `.vmat`, as a model's. A holed one (`{`) is alpha-tested on a mask, its picture
  opaque and both made a power of two each way: s&box's texture compiler makes no mipmaps of a mask whose sides are
  not, and the material fails (stalkyard's `{duct_vnt2`, 64 by 48). A texture drawn translucent (render mode 1 to 3
  or 5) wears a copy made a power of two each way when its sides are not (`<texture>_pot.png`): complex.shader's
  translucent mipmaps fail on it the same way (ts_parking's `ts_wall19`, 96 by 128, added).
- **Its starts** (`info_player_start`, `info_player_deathmatch`, or a mod's: `--mod msc` reads Master Sword's
  `ms_player_begin` and `ms_player_spawn`) as `SpawnPoint`s, at their feet (GoldSrc's player
  origin is the middle of its box, 36 above them), turned their way.
- **Its light**, GoldSrc's own (`lighting: "lightmaps"`, the default; `src/sbox/lightmap.mjs`), as the GMod port
  keeps it: every face's lightmap in one picture of the map's (`materials/<folder>/maps/<map>/lightmap.png`, 1024
  samples across), each face's samples with a border of its edge's round them. A PolygonMesh has one set of texture coordinates, the texture's: the face's place in the picture
  rides in its corners' vertex colour (two numbers of 16 bits, the same at every corner), and SMAK's shader
  (`shaders/smak_lightmapped.shader`, written into the project) finds a point's sample from its texture pixel / 16
  plus that place, mixed between samples as GoldSrc mixes them. Each texture gets a material of the map's own
  (`maps/<map>/lit/`) on that shader. The colour is GoldSrc's: the texture as the screen shows it times sample / 255
  times 1.55, cut off at white (`drawMap`'s `BRIGHTNESS`), the sRGB curve undone round it, drawn as emission and
  nothing else: s&box's lights put no shine on it (ts_parking's 131 lights had, with the standard shading, made
  patches of gloss). A liquid's face (no lightmap) is at full light, a face the compiler left unlit dark; a brush
  entity in render mode 1 to 3 or 5 has no lightmap in GoldSrc and is drawn lit by itself. The light entities are
  s&box's lights as below (for what moves), the shining textures make none, and there is no indirect light to bake.
  **Its styles**: each style a pattern of letters the game plays at ten a second (`stylePatterns`: Half-Life's
  `GOLDSRC_STYLES` under 32, a switched light's as `CLight::Spawn` sets it: "a" when every light of it starts dark,
  else its `pattern` or "m"). A style whose pattern is one letter is added into the picture at that letter's share
  ("m" whole, "a" not at all). One that changes (Half-Life's flickers, a light's own pattern) is kept apart, in a
  layer of the picture below the faces (`g_flFirstLayer` down, then `g_flLayerHeight` apart; the faces whose styles
  change are packed first, so a layer is only as tall as their shelves), its alpha the style's row in
  `lightstyles.png` (its letters in red, (letter - "a") x 10, its length in green), and the shader plays it by its
  clock (`g_flTime`), in the editor too. Of TS's 29 maps, four have one: ts_heresy, ts_parking and ts_urbannights
  Half-Life's flickers on 3 to 109 faces, ts_supertimor a light flashing once in two seconds (`aaaaaaaaaaaaaaaaaaaz`)
  over 4110. A light switched by its name stays as the map starts it: no entity of any stock TS map switches one,
  and a switch needs code of the game's. In play s&box streams textures in, coarse mipmaps first, and a coarse
  mipmap of the picture mixes neighbouring faces' light: for the first frames after a place comes into view its
  light can be patchy (`sbox-map-check` pictures each start twice for it). ts_lobby (2026-10-28): a 1024 by 512 picture, 340 KB, its 17 starts 1.00 to
  1.04 times as bright as GoldSrc draws them, correlated 1.00; s&box's lights and a baked indirect light had it 0.12
  times as bright (TS's own lamps are in no lights.rad) after a bake of one to three hours.
  **Its models' light**: with lightmaps the port writes `lighttree.bin` (`lightTree`, `lightTreeBytes`), what GoldSrc
  reads to light a model ("Lit as GoldSrc lights a model"): the world's planes, nodes and leaves' contents, its faces'
  places and lightmaps (each face's styles added up at their levels as the map starts, so a model under a flicker
  does not flicker), the sky's light and way. A game walks it as the engine does: ts_lobby's is 1.25 MB, ts_parking's
  2 MB. A grid of floors was tried first and was off by up to 86 of 255 at a ledge, where a column's middle stood over
  another floor than the model.
- **Or s&box's lights** (`lighting: "lights"`, `--lighting lights`): `light`
  a `PointLight`, `light_spot` a `SpotLight` (`_cone` and `_cone2` its inner and outer half angles), `light_environment`
  a `DirectionalLight`, its colour also the sky's light (`SkyColor`). A light's colour is its `_light` in linear light
  times brightness / 255, as the GMod port's world lights; it reaches 32 units per the root of its brightness. A face
  whose texture shines (Valve's maps were lit by a lights.rad that never shipped; `texlights.mjs` has it as
  stevenlafl calibrated it; a map's `info_texlights` says which of its own textures shine, and how) is drawn lit by
  itself and has a `SpotLight` before it, as strong as hlrad made it: its value times its colour, its area and its
  texture's reflectivity (0.7 of its mean colour) over pi, as SDHLT counts it, `TEXLIGHT_SCALE` times that to the
  power 1.21 (hlrad stores light to the power 0.55, s&box shows it to the power 1 / 2.2), reaching where hlrad's light
  falls to one level in 255. A map's own `info_texlights` is counted as the compilers before VHLT did, without the
  reflectivity and pi: Valve's list was calibrated under SDHLT, an `info_texlights` belongs to the ZHLT years. The sun is 4 times its colour and the sky's light 0.75 of it: GoldSrc's light compiler bounced light and
  spread the sky's, s&box's lights do neither, and these two were fitted so that stalkyard looks as bright as GoldSrc
  draws it (below).
  With them, the bounced light: GoldSrc's light compiler bounced every light round the map into its lightmaps, and
  s&box's lights are direct only. An `IndirectLightVolume` (s&box's DDGI: a grid of probes, 4 per 1024 units, half
  s&box's default: ts_lobby's 66096 probes at 8 baked at 6 to 26 a second) over the world, 16 units past it each way,
  the clip brushes left out of it, bounces them; it lights moving models too. It is baked in the editor (its button,
  or `sbox-map-check`), into `scenes/<folder>/<map>_scene_data/ddgi/`, and recorded beside it
  (`smak_bake.json`: a hash of every file the port wrote, and the bake's three textures): a port that writes the same
  again keeps the bake, and the files of the bakes before it are removed.
- **A self-lit texture** (a model's fullbright one too) has a white picture as its self-illumination mask: given as
  a colour, `complex.shader` makes it a texture s&box does not have, and the face is drawn red.

Not yet: doors, buttons, trains and other brushes that move (drawn and solid where they start), triggers and
ladders (not drawn, so not there), items and weapons, `ambient_generic` and the other sounds a map plays, water,
animated and scrolling textures, a brush entity's render modes other than 5, decals.

### How a map's port is checked

`sbox-map-check` ports the map into the project and opens the scene in the project's editor (a tab already open on
it closed first: a tab shows the scene as it was when opened), then holds it to the GoldSrc map:

- **its meshes**: every one the port wrote, with its faces (none refused as bad), its materials, each compiled (the
  editor's `asset_compile` asked for every one: a failure is a fault), and what it collides as; the sky, the starts
  and the lights where they were put, each light shining its way;
- **where a player is blocked**, as `gmod-collision` holds a GMod port (`source/collision.mjs`): `--count` spots inside
  the map (5000, the same each run for a `--seed`), each asked of GoldSrc's hull 1 (standing) and hull 3 (ducked)
  and of s&box's physics: the player's box (32 by 32 by 72, 36 ducked) traced where it stands, against the world, its clip
  brushes and the solid brush entities (tagged `world` and `brush`; GoldSrc's side counts a brush entity's brushes as
  blocking too). A spot blocked only in s&box where the drawn world is inside the box is
  GoldSrc's compiled hull being loose, and not counted. PASS when the rest disagree on no more than `--allow` (0.5) in a
  hundred, standing and ducked;
- **each start's floor**: a ray down from where GoldSrc's player stands, meeting the floor where GoldSrc's hull 0 has
  it, within half a unit, and the player's box standing on it not stuck;
- **its light** (`--no-light` leaves it out): with s&box's lights, its indirect light baked unless the port kept its
  bake (the scene saved, as s&box bakes only a saved scene; the editor's minimized windows shown meanwhile, without
  the focus), and with lightmaps SMAK's shader compiled first; then from each start's eye (64 above its feet), a
  picture of s&box's, by a
  camera of the check's own with no tonemapping (the clip brushes hidden; each start pictured twice, the first only
  to stream its textures in: with one, ts_parking's coarse mipmaps put three starts 1.14 to 1.18 and its likeness at
  0.96), beside GoldSrc's, drawn with its
  lightmaps as the game draws them (`drawMap`), the same size and field of view (640 by 360, 80 degrees). Each cut in
  16 by 9 regions: the whole as bright as GoldSrc's (the views' ratios' geometric mean 0.8 to 1.25), and lit in the
  same places (each view's regions correlated with GoldSrc's, 0.7 or more on average). `-o`: the first start's two
  pictures side by side.

Measured (2026-10-27), Half-Life's stalkyard: 52 meshes (the world, 20 brush entities and 31 clip brushes), 2687
faces, 78 materials, its night sky, 21 starts and 86 lights (44 of the map's, 42 of its shining faces). Where a player
is blocked: 0.20 in a hundred disagree standing, 0.22 ducked (its GMod port, 0.10 and 0.18); without the clip
brushes, 2.90 and 1.96, nearly all spots high over the walls, where clip keeps players in. Every start's floor where
GoldSrc's is. Its light 1.04 times as bright as GoldSrc's, 17 of 21 starts within a third either way, lit in the same
places correlated 0.85. The light's two fitted numbers come from this one map; another map may want them otherwise.

Again with the brush entities' every brush and the indirect light (0.35.0): 71 meshes, 2800 faces; 0.16 and 0.18 in
a hundred disagree; its light 0.97 times as bright, 9 of 21 starts within a third either way, correlated 0.82. MSC's
test_scripts (a closed room lit by its glowing crystals alone, `--mod msc`): 0.32 and 0.24 in a hundred; its light
0.13 times as bright without the indirect light and 0.23 with it, correlated 0.99: a FAIL. The bounce is there, the
crystals' own light is too weak; a shining texture's light has no fitted number yet, as the sun has.

The shining textures as hlrad counts them (0.36.0): the shield added in linear light (its purple had covered s&box's
view, and passed for light), each face's light reaching as far as hlrad's, a map's own `info_texlights` in the older
compilers' measure. `TEXLIGHT_SCALE` fitted on stalkyard alone (8e-8: 0.96 times as bright, 9 of 21 starts within
a third) had test_scripts 0.73 times as bright, where it had been 0.38 with the shield fixed; 1e-7, the number
kept, has both through: test_scripts 0.82 (all 3 starts within a third), stalkyard 1.02 (5 of 21 within a third: its
starts by its lamps brighter, from 1.2 to 1.5). test_scripts' likeness (0.99) is mostly its crystals' frame, in
front of every view; its floor is darker than GoldSrc's, lit by the bounce alone.

## Not yet

- A map's moving brushes, items and sounds (above).
