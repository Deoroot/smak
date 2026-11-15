# A map walked in Godot: one command

A compiled map can be walked in Godot 4 in first person, in the game's baked light and lit by its lamps in real time,
and photographed from cameras you name with nobody at the keyboard. This is an optional pack, `packs/godot/`, over
`packs/gltf` (docs/GLTF.md): `smak` does not have the command (the kit never imports a pack); the pack has its own.

```
node packs/godot/bin.mjs project maps/street.bsp -o street-godot --game <mod folder> --game <valve folder>
     [--sets <materials folder> ...] [--shot door=586,-1835,64,12,0 ...] [--tonemap linear|filmic|aces]
     [--godot <Godot's program>] [--shots] [--list]         (every option: the table below)
node packs/godot/bin.mjs shots street-godot      Godot run: a picture of each way from each --shot, then it quits
node packs/godot/bin.mjs list street-godot       the lamps and the materials a script reaches, by their names
```

`project` writes the folder and prints what went in: the two files' sizes and triangles, the lamps and how many are
on, the textures with a set, where the feet start, the lit way's ambient, the reflection probe's box, the shots, every
note of `packs/gltf` (a set left out, a texture found nowhere) and its own `WARN` lines. `shots` (or `--shots` on
`project`) runs Godot itself, from any shell and from Node, and says where the pictures are and every `ERROR` and
`WARNING` line Godot printed (a mistake in `own.gd` shows there). To walk it: `street-godot\run.bat` (`run.sh`
elsewhere).

The first run imports the two `.glb` (the longest wait); later ones start in seconds. Godot is the `GODOT`
variable when set, else what `--godot` said, else `godot` on the PATH. Godot 4.4 or later (tried: 4.7.2).

`run.bat -- --shots` takes the pictures too, from `cmd`. From Git Bash write `./run.sh -- --shots`, or
`cmd //c ".\\run.bat -- --shots"`: a shell that sets `NoDefaultCurrentDirectoryInExePath` (an agent's often does) makes
`cmd` answer "run.bat is not recognised" to the bare name, and Node's `execFile` wants the batch file's whole path.

In a script:

```js
import { readFileSync } from "node:fs";
import { godotProject, writeProject, takeShots } from "file:///C:/path/to/smak/packs/godot/godot.mjs";
const made = godotProject(readFileSync("street.bsp"), { folders: [mod, valve], sets: [materials], tonemap: "filmic",
  shots: [{ name: "door", from: [586, -1835, 64], yaw: 12, pitch: 0, fov: 90 }] });
writeProject("street-godot", made);   // made.facts: start, yaw, ambient, bounds, probe, shots, notes, baked, lit, reach
const { files, said } = takeShots("street-godot");   // the pictures' paths; Godot's ERROR and WARNING lines
```

## What is in the folder

| File | What |
| --- | --- |
| `baked.glb`, `lit.glb` | `packs/gltf`'s two ways of the map, to the byte what `map-gltf` and `map-gltf --light lit --sets` write |
| `main.gd` | The walker: the pack's template with the map's values filled in at its top. The same for every map below them |
| `project.godot`, `main.tscn` | The project (the window and the shots at `--size`) and its one scene, which runs `main.gd` |
| `run.bat`, `run.sh` | Import when there is no `.godot` folder, then run; what follows is passed on (`-- --shots`) |

The walker: **WASD** to walk, the mouse to look, **Space** to jump, **Shift** to run, **Esc** frees the mouse, **F8**
quits. **1** the baked way, **2** the lit way (it starts there), **H** the lamps' shadows on and off; a label says
which. The map's units are inches (39.37 to the metre); the player is 72 tall and 32 wide with the eye at 64, walks at
190 and runs at 320, jumps 45 high, as in the game. The walls stood on are the lit file's meshes (the two files have
the same geometry, the lit one in fewer triangles: no face is cut on its lightmap's grid).

| The way | What the walker sets |
| --- | --- |
| Baked | No ambient, no probe: texture x lightmap, as the file is |
| Lit | The ambient the lit file says (`extras.ambient` of its root: docs/GLTF.md), a ReflectionProbe (interior, box projection, updated once) for what metal and varnish reflect, every lamp's shadow on (Godot imports them off, and a lamp with no shadow shines through walls); the lamps scaled, the finish, the reflections and the fog asked (below) |
| Both | The tonemap asked, the background colour (seen where the map draws nothing: the sky) |

## The options

| Option | What | With none |
| --- | --- | --- |
| `--game <folder>` | The game's folders, the mod's own first, as for `map-gltf` | Grey walls where the textures are in `.wad` files, no props |
| `--sets <folder>` | `packs/materials`' folders, for the lit way's relief and roughness | Lit materials plain |
| `--start x,y,z[,yaw]` | Where the feet stand, and the yaw looked along (degrees from +x towards +y) | The map's `info_player_start`, the feet 36 under its origin, its `angles`; a map with none is refused with a sentence |
| `--shot name=x,y,z,yaw,pitch[,fov]` | A camera of the shots: the eye, the yaw, the pitch (up is positive), the angle seen across (90). Once for each | One, `start`: the start's eye |
| `--size WxH` | The window's and the shots' size (`960x540` lays beside `smak map-view`'s). `shots --size` is for one run | 1280 x 720 |
| `--tonemap linear\|filmic\|aces` | Godot's tone mapper, for both ways | `linear` |
| `--probe x,y,z,sx,sy,sz` | The reflection probe's box: its middle and its size, the map's axes | The box of the world's faces, looked at from the start's eye |
| `--ambient r,g,b` | The lit way's ambient, linear | The lit file's: the darkest tenth of the lightmaps, which in a place lit in pools is black (said in a line when under 0.01) |
| `--lamps <factor>` | Every lamp of the lit way: its energy times this | 1: the map's brightness |
| `--cells <factor>` | The texture lights' cell lamps, times this besides | 1 |
| `--role <name>=<factor>` | The lamps whose `light` has the key `_role` `<name>` (below), times this besides; 0 is off. Once for each | `fill=0`; any other role 1 |
| `--finish <name>=<tone>[,<roughness>]` | The lit materials whose name holds `<name>`: the colour times tone, the roughness set (times its set's map where it has one). Once for each | As the file is |
| `--ssr` | Screen-space reflections in the lit way | None |
| `--fog density,r,g,b[,x,y,z,sx,sy,sz]` | Volumetric fog in the lit way; with a box (its middle and size, the map's axes), in that space only | None |
| `--background r,g,b` | The colour behind everything, linear | Black |
| `--name <words>` | The project's name | The `.bsp`'s |
| `--godot <program>` | Written into `run.bat` and `run.sh`; what `shots` runs | `godot` |
| `--shots`, `--list` | After writing: take the shots; print what a script reaches | Neither |

A shot's `fov` is across the picture (the game's sense); the walker's own camera is Godot's default sense, 75 up and
down, which is 107.5 across at 16:9.

A `WARN` says a `--role` no light has (with the roles the map does have) and a `--finish` no material's name holds:
a misspelt name would otherwise change nothing in silence. None of these options changes a `.glb`: Godot does not
import again, so a number tried is a few seconds.

## A dark place lit in pools

The lit way is the map's lamps at the map's brightness with none of the baked way's losses, on clean materials. A
bright room arrives near enough; a dark place lit in pools arrives far too bright and too clean (a district's six
shots: 35 to 46 of 255 from what its author wanted). What mended it there, as options (the same six: 1.9 to 8.5):

```
--lamps 0.8 --cells 0.375 --role pool=0 --role well=0.5 --ambient 0.03,0.04,0.055
--finish dd_floor=0.45,0.16 --finish dd_conc=0.8 --finish dd_steel=0.6 --ssr
--fog 0.022,0.35,0.62,0.72,240,852,210,560,520,420
```

- **Say what each light is, in the map**: a `light` with the key **`_role`**. hlrad and the game drop a key they do
  not know (tried: sdHLRAD, a `light`, which the game never spawns), and it reaches the lit file as
  `extras.keys._role`. **`fill`** is the stated one: a light that stands in for the bounce in the baked way, with no
  lamp seen where it is. The lit way turns it off unless `--role fill=1` says otherwise. Any other word is yours
  (`pool`: a light low over the floor to make a lamp's pool; `well`: a great space's light from above) and is
  scaled by `--role`. A lamp with no `_role` is a lamp: `--lamps` alone.
- **The texture lights' cells are the brightest surprise**: 28 more lamps, one before each lit sign. `--cells` 0.3
  to 0.4 of the others.
- **The ambient**: the export's is black there, and with the fills off a wall no lamp reaches is black. Lift it by
  eye (0.03 0.04 0.055 there), a blue or the place's own colour; black is right only where the walls should go.
- **A wet floor** is its texture's `--finish` with a low roughness (0.16; the set's own is near 1, a dry tile) and a
  darker tone, with `--ssr`: the probe alone gives no image of a sign in the floor. The reflections show only what
  is on the screen: a sign's image goes when the sign leaves the view.
- **Pale materials**: `--finish <name>=<tone>` for each that reads too clean (concrete 0.8, steel 0.6). A model's
  texture with no set (drawn, not photographed) is plain and goes white under a near lamp: tone it, or scale that
  lamp.
- **Fog** hides what is far: the first density there (0.055) hid a hall from its mezzanine; 0.022 stayed.

What the options do not reach there, and `own.gd` does: two lamps of one stall scaled by their place (they have
no `_role`; in the map they could), a glow, a material's specular. They are recipes below.

## Look at it with no person

`shots` writes `shot-<name>-baked.png` and `shot-<name>-lit.png` into the folder for each `--shot`, the
label off, the body still, 40 frames after each change of way, and quits; a picture of an earlier run is removed
first, and a picture Godot did not write is an error with what Godot said. Look at them; lay them beside
`smak map-view`'s from the same camera (the same `from`, yaw, pitch and fov), or beside the reference. The pictures
are the same to the pixel from one run to the next (tried: two runs each of two maps, difference 0), so a difference
between two builds is the build's.

With no Godot at all, the folder can still be held:

```js
import { checkProject } from "file:///C:/path/to/smak/packs/godot/test/check.mjs";
const { errors, values } = checkProject("street-godot");   // errors: [] when whole; values.START, .AMBIENT, .SHOTS ...
```

It says a file missing, a `.glb` cut short, a value of `main.gd` not filled in or gone. It says nothing of what Godot
draws.

## What stays yours: own.gd

Run the command again whenever the map is compiled again: it writes the seven files over, removes the old import
(`.godot`) when a `.glb` changed, and touches nothing else. So what is one map's own does not go in `main.gd`. Write
it in **`own.gd`** in the folder: when it is there, `main.gd` makes one of it, adds it as its last child (named
`Own`) after the scenes, the probe and the player exist and the lamps and the finish asked are applied, and calls
its `shown(way)` last at each change of way: `main.gd` sets the ambient, the reflections and the fog for the way,
then `shown` has the last word.

```gdscript
extends Node
# the lamps past the glass at half, the brass shinier than its set
func _ready() -> void:
	var main := get_parent()                       # main.gd: scenes, env, probe, body, head, label, LIT, UNIT
	for light in main.scenes[main.LIT].find_children("*", "Light3D", true, false):
		if light.global_position.z < -290.0 * main.UNIT:   # the map's y over 290 (the map's x, y, z is Godot's x, z, -y)
			light.light_energy *= 0.5
	main.set_ambient(Color(0.03, 0.04, 0.055))     # the lit way's ambient: the environment's and the probe's, kept
func shown(way: int) -> void:                      # 0 baked, 1 lit
	var env: Environment = get_parent().env
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC if way == 1 else Environment.TONE_MAPPER_LINEAR
	env.glow_enabled = way == 1                    # a little glow round the signs
	env.glow_intensity = 0.5
	env.glow_hdr_threshold = 0.9
```

What it reaches, with no debug print (`list` prints the map's own, a line each):

| What | By |
| --- | --- |
| A lamp of a `light` entity | A `Light3D` named `<number> <classname>` (`28 light`); `main.role_of(light)` is its `_role` (`""` with none); `light.get_meta("extras")` is `{ number, classname, origin, keys }`, on the light itself; `light_energy` is the `.glb`'s candela times the factors asked |
| A texture light's cell lamp | `texture light <texture>` (Godot numbers a name's repeats: `~dd_red2`); no extras; `main.role_of` says `"cell"` |
| A lamp turned off by a factor of 0 | `visible` false (it takes no place in the shadow atlas) |
| A world material | `resource_name` is the texture's name (`dd_floor`; a masked one `{dd_grate masked`) |
| A model's material | `<model's path>/<its texture>`: `district/stool.mdl/dd_steel.bmp`, so `contains("dd_steel")` takes both |
| A material's finish | `roughness` and `metallic` multiply its set's maps; `albedo_color` its picture; one material is shared by every mesh that wears it |
| An entity | A node with `get_meta("extras")`: `classname`, `targetname`, `origin`, `keys` (every key, as text) |
| The ambient | `main.set_ambient(color)`, at any time. `env.ambient_light_color` set by hand is written over at the next change of way unless set in `shown`, and is not the probe's (a picture differs by 0.2 to 0.3 of 255) |

What three hand-written projects had that the pack leaves to `own.gd`, because it is one map's:

- **A finish by a texture's name**: a model's material made metallic, varnished or soft, a glow turned down, a pale
  colour toned. Since 1.4 the lit file gives a model's texture its set, which does much of it; the rest is taste.
- **Lamps by their place, moved or taken out**: lamps past a window, one stall's (by a `_role` when the map can say
  it: `--role`).
- **Fog in a second space, a glow, a material's specular or metal.**
- **Anything that moves**: a lift, doors, a train. A script finds the car's `height` and `speed` in its node's keys.
- **A tonemap or an ambient for each room** of a map made of several: `shown(way)` and the player's place.
- **More than two ways** (an earlier round beside this one): load the other `.glb` yourself and show it.

## What joining rooms taught

- **A real-time lamp passes through solid geometry** unless it casts a shadow. The walker turns every lamp's shadow
  on, but Godot's default shadow atlas has a fixed number of places (64 in its largest quadrant): past that, some
  lamps get none, shine through walls, and *which* depends on the scene, so the same room joined to another is lit
  otherwise. The command says `WARN: <n> lamps in the lit way ...` over 64. Raise
  `rendering/lights_and_shadows/positional_shadow/atlas_size` and the `atlas_quadrant_*_subdiv` settings in
  `project.godot` (the command writes that file over: keep the lines to add again), or set them from `own.gd`
  (`get_viewport().positional_shadow_atlas_size = 8192`, `.positional_shadow_atlas_quad_0 =
  Viewport.SHADOW_ATLAS_QUADRANT_SUBDIV_64`: accepted by 4.7.2, the look not judged), or turn far lamps off. A room
  approved with the default atlas looks otherwise with a larger one.
- **The tonemap is a room's**: a dark steel hall was approved linear, a warm lounge filmic. One map, one `--tonemap`;
  two rooms in one map are `own.gd`'s.
- **The lit file's texture lamps are the map's 32 brightest cells**, not each room's: joined rooms share them
  (docs/GLTF.md). Nothing here changes that.
- **The probe is one box.** The world's box is right for one room and loose for a map with a sea round it or several
  rooms: a metal floor then reflects a little otherwise (below). Give `--probe` the room's box, or add probes in
  `own.gd` and hide `main.probe`.

## What it does not do

- Nothing is checked of what Godot draws; the pictures are for you to look at.
- `WARNING: 7 RIDs of type "Texture" were leaked` at the end of every `--shots` run is Godot's own at exit: the same
  7 on every map and any number of shots, with the scenes freed before quitting too; nothing is wrong in the pictures.
  `shots` leaves that one line out of what it reports.
- No sky, sprites, decals, animation or moving brush: what `packs/gltf` does not write (docs/GLTF.md).
- No LightmapGI, no SDFGI: the lit way is lamps, an ambient colour and one probe (reflections and fog when asked).
- The lit way's lamps have none of the bounce and none of the losses of the baked way: its brightness is by eye.
- The walker is not the game's movement: no crouch, no ladder, no water, no stepping up a stair's rise
  as the game does (not tried on a stair), no trigger fires.
- `project.godot` is written over each time: settings changed in Godot's editor there are lost; `own.gd` is not.
- A map with no compiled light has no ambient in its lit file: the lit way's ambient is black, and said.

## Tried with

`test/208-pack-godot.mjs` (in `npm test`, no Godot): the kit's two rooms as a project, the files read back by
`checkProject`: the two `.glb` `packs/gltf`'s own to the byte, the feet under `info_player_start`, the ambient the lit
file's, the probe's box held against the `.bsp`'s own faces, each option, the refusals, `own.gd` kept, the lit way's
look as constants with `lit.glb` unchanged, what a script reaches, `takeShots` with a Godot that is not one, the
commands.

In Godot 4.7.2 (Forward+, 1280 x 720), on two of the owner's maps (not in the kit) whose hand-written projects' shots
the owner had approved, 2026-11-15; the mean difference of a channel, of 255, against the approved shot from the same
camera (a run repeated: 0.000):

| Map, way | The command with only its `--shot` (and the room's `--tonemap`) | With the room's `--probe`, and for the lounge its `--ambient` and `own.gd` |
| --- | --- | --- |
| A mess hall, baked (linear) | 0.12 | 0.12 |
| A mess hall, lit | 0.82 | 0.20 |
| A lounge, baked (filmic) | 0.00 | 0.00 |
| A lounge, lit | 8.2 | 2.5; 0.00 with the lit `.glb` the approved shot was made with |

With the lit way's look as options (the same day), the four projects above written again give the same eight
pictures (difference 0.000 each): nothing asked changes nothing. A third map of the owner's, a dark district lit in
pools (55 lamps: 5 `fill`, 3 `pool`, 4 `well`, 28 cells), six cameras, the lit way against its author's shots, which
took 90 lines of `own.gd`; no `own.gd` here but in the last row (baked: 0.000 in every row):

| The command | ref | stall | pillar | atrium | mezzanine | corridor |
| --- | --- | --- | --- | --- | --- | --- |
| Before the options | 41.9 | 46.1 | 38.2 | 35.0 | 44.1 | 37.9 |
| No option (a `fill` is off) | 40.5 | 45.6 | 38.0 | 35.0 | 44.0 | 37.9 |
| `--lamps --cells --role` | 22.3 | 23.6 | 16.9 | 11.4 | 15.6 | 13.2 |
| and `--ambient` | 22.4 | 23.8 | 17.0 | 11.4 | 15.6 | 13.5 |
| and ten `--finish` | 9.2 | 8.9 | 10.2 | 15.8 | 15.5 | 3.0 |
| and `--ssr --fog` (every option) | 6.3 | 8.5 | 7.2 | 1.9 | 2.8 | 2.3 |
| and 26 lines of `own.gd`: one stall's two lamps by their place, a glow, the floor's specular | 0.31 | 0.34 | 0.31 | 0.36 | 0.60 | 0.26 |

Looked at beside each other, the options alone give the place its author made: dark, lit in pools, the signs in a wet
floor, the atrium in haze. What they leave is the stall, whose goods are pale under its two lamps (its author dimmed
those by their place), and the signs' glow. The last row's remainder is the ambient set on the environment alone
there (0.2 to 0.3, measured apart) and, not measured, the fog's length.

The mess hall's 0.12 and 0.20 are the eye: the hand-written project shot from its walker at rest, a hundredth of a
unit over 64 (a shot from 64.01: 0.05 baked, 0.11 lit; the fine grate shimmers). Its 0.82 is the probe: the world's
box holds the sea round the hall, so the metal floor's reflections shift. The lounge's 8.2 is what its author wrote by
hand: an ambient several times the export's, the sea's lamps at half and its glow at a third, a finish for each model's
texture; with those in `own.gd` the pack's project gives the approved picture to the pixel from the same `.glb`. The
2.5 left on today's `.glb` is 1.4's export, not the project: a model's texture now wears its set (the sofas' cloth,
the slats' wood, the brass), under a finish written for plain materials.
