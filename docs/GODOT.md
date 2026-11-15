# A map walked in Godot: one command

A compiled map can be walked in Godot 4 in first person, in the game's baked light and lit by its lamps in real time,
and photographed from cameras you name with nobody at the keyboard. This is an optional pack, `packs/godot/`, over
`packs/gltf` (docs/GLTF.md): `smak` does not have the command (the kit never imports a pack); the pack has its own.

```
node packs/godot/bin.mjs project maps/street.bsp -o street-godot --game <mod folder> --game <valve folder>
     [--sets <materials folder> ...] [--shot door=586,-1835,64,12,0 ...] [--tonemap linear|filmic|aces]
     [--godot <Godot's program>]
```

It writes the folder and prints what went in: the two files' sizes and triangles, the lamps, the textures with a set,
where the feet start, the lit way's ambient, the reflection probe's box, the shots, every note of `packs/gltf` (a set
left out, a texture found nowhere) and its own `WARN` lines. Then:

```
street-godot\run.bat                 walk it (run.sh elsewhere)
street-godot\run.bat -- --shots      a picture of each way from each --shot, then it quits
```

The first run imports the two `.glb` (the longest wait); later ones start in seconds. Godot is the `GODOT`
variable when set, else what `--godot` said, else `godot` on the PATH. Godot 4.4 or later (tried: 4.7.2).

In a script:

```js
import { readFileSync } from "node:fs";
import { godotProject, writeProject } from "file:///C:/path/to/smak/packs/godot/godot.mjs";
const made = godotProject(readFileSync("street.bsp"), { folders: [mod, valve], sets: [materials], tonemap: "filmic",
  shots: [{ name: "door", from: [586, -1835, 64], yaw: 12, pitch: 0, fov: 90 }] });
writeProject("street-godot", made);   // made.facts: start, yaw, ambient, bounds, probe, shots, notes, baked, lit
```

## What is in the folder

| File | What |
| --- | --- |
| `baked.glb`, `lit.glb` | `packs/gltf`'s two ways of the map, to the byte what `map-gltf` and `map-gltf --light lit --sets` write |
| `main.gd` | The walker: the pack's template with the map's values filled in at its top. The same for every map below them |
| `project.godot`, `main.tscn` | The project (1280 x 720) and its one scene, which runs `main.gd` |
| `run.bat`, `run.sh` | Import when there is no `.godot` folder, then run; what follows is passed on (`-- --shots`) |

The walker: **WASD** to walk, the mouse to look, **Space** to jump, **Shift** to run, **Esc** frees the mouse, **F8**
quits. **1** the baked way, **2** the lit way (it starts there), **H** the lamps' shadows on and off; a label says
which. The map's units are inches (39.37 to the metre); the player is 72 tall and 32 wide with the eye at 64, walks at
190 and runs at 320, jumps 45 high, as in the game. The walls stood on are the lit file's meshes (the two files have
the same geometry, the lit one in fewer triangles: no face is cut on its lightmap's grid).

| The way | What the walker sets |
| --- | --- |
| Baked | No ambient, no probe: texture x lightmap, as the file is |
| Lit | The ambient the lit file says (`extras.ambient` of its root: docs/GLTF.md), a ReflectionProbe (interior, box projection, updated once) for what metal and varnish reflect, every lamp's shadow on (Godot imports them off, and a lamp with no shadow shines through walls) |
| Both | The tonemap asked, the background colour (seen where the map draws nothing: the sky) |

## The options

| Option | What | With none |
| --- | --- | --- |
| `--game <folder>` | The game's folders, the mod's own first, as for `map-gltf` | Grey walls where the textures are in `.wad` files, no props |
| `--sets <folder>` | `packs/materials`' folders, for the lit way's relief and roughness | Lit materials plain |
| `--start x,y,z[,yaw]` | Where the feet stand, and the yaw looked along (degrees from +x towards +y) | The map's `info_player_start`, the feet 36 under its origin, its `angles`; a map with none is refused with a sentence |
| `--shot name=x,y,z,yaw,pitch[,fov]` | A camera of `--shots`: the eye, the yaw, the pitch (up is positive), the angle seen across (90). Once for each | One, `start`: the start's eye |
| `--tonemap linear\|filmic\|aces` | Godot's tone mapper, for both ways | `linear` |
| `--probe x,y,z,sx,sy,sz` | The reflection probe's box: its middle and its size, the map's axes | The box of the world's faces, looked at from the start's eye |
| `--ambient r,g,b` | The lit way's ambient, linear | The lit file's |
| `--background r,g,b` | The colour behind everything, linear | Black |
| `--name <words>` | The project's name | The `.bsp`'s |
| `--godot <program>` | Written into `run.bat` and `run.sh` | `godot` |

A shot's `fov` is across the picture (the game's sense); the walker's own camera is Godot's default sense, 75 up and
down, which is 107.5 across at 16:9.

## Look at it with no person

`run.bat -- --shots` writes `shot-<name>-baked.png` and `shot-<name>-lit.png` into the folder for each `--shot`, the
label off, the body still, 40 frames after each change of way, and quits. Look at them; lay them beside
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
`Own`) after the scenes, the probe and the player exist, and calls its `shown(way)` at each change of way.

```gdscript
extends Node
# the lamps past the glass at half, the brass shinier than its set
func _ready() -> void:
	var main := get_parent()                       # main.gd: scenes, env, probe, body, head, label, LIT, UNIT
	for light in main.scenes[main.LIT].find_children("*", "Light3D", true, false):
		if light.global_position.z < -290.0 * main.UNIT:   # the map's y over 290 (the map's x, y, z is Godot's x, z, -y)
			light.light_energy *= 0.5
func shown(way: int) -> void:                      # 0 baked, 1 lit
	get_parent().env.tonemap_mode = Environment.TONE_MAPPER_FILMIC if way == 1 else Environment.TONE_MAPPER_LINEAR
```

What three hand-written projects had that the pack leaves to `own.gd`, because it is one map's:

- **A finish by a texture's name**: a model's material made metallic, varnished or soft, a glow turned down, a pale
  colour toned. Since 1.4 the lit file gives a model's texture its set, which does much of it; the rest is taste.
- **Lamps dimmed, moved or taken out**: lamps past a window, a room's texture lamps.
- **Anything that moves**: a lift, doors, a train. The entities' keys are on their nodes (`get_meta("extras")`:
  `classname`, `targetname`, `origin`, `keys`), so a script finds the car's `height` and `speed` there.
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

- It does not run Godot: `run.bat` does. Nothing is checked of what Godot draws; the pictures are for you to look at.
- No sky, sprites, decals, animation or moving brush: what `packs/gltf` does not write (docs/GLTF.md).
- No LightmapGI, no SDFGI, no fog: the lit way is lamps, an ambient colour and one probe.
- The walker is not the game's movement: no crouch, no ladder, no water, no stepping up a stair's rise
  as the game does (not tried on a stair), no trigger fires.
- `project.godot` is written over each time: settings changed in Godot's editor there are lost; `own.gd` is not.
- A map with no compiled light has no ambient in its lit file: the lit way's ambient is black, and said.

## Tried with

`test/208-pack-godot.mjs` (in `npm test`, no Godot): the kit's two rooms as a project, the files read back by
`checkProject`: the two `.glb` `packs/gltf`'s own to the byte, the feet under `info_player_start`, the ambient the lit
file's, the probe's box held against the `.bsp`'s own faces, each option, the refusals, `own.gd` kept, the command.

In Godot 4.7.2 (Forward+, 1280 x 720), on two of the owner's maps (not in the kit) whose hand-written projects' shots
the owner had approved, 2026-11-15; the mean difference of a channel, of 255, against the approved shot from the same
camera (a run repeated: 0.000):

| Map, way | The command with only its `--shot` (and the room's `--tonemap`) | With the room's `--probe`, and for the lounge its `--ambient` and `own.gd` |
| --- | --- | --- |
| A mess hall, baked (linear) | 0.12 | 0.12 |
| A mess hall, lit | 0.82 | 0.20 |
| A lounge, baked (filmic) | 0.00 | 0.00 |
| A lounge, lit | 8.2 | 2.5; 0.00 with the lit `.glb` the approved shot was made with |

The mess hall's 0.12 and 0.20 are the eye: the hand-written project shot from its walker at rest, a hundredth of a
unit over 64 (a shot from 64.01: 0.05 baked, 0.11 lit; the fine grate shimmers). Its 0.82 is the probe: the world's
box holds the sea round the hall, so the metal floor's reflections shift. The lounge's 8.2 is what its author wrote by
hand: an ambient several times the export's, the sea's lamps at half and its glow at a third, a finish for each model's
texture; with those in `own.gd` the pack's project gives the approved picture to the pixel from the same `.glb`. The
2.5 left on today's `.glb` is 1.4's export, not the project: a model's texture now wears its set (the sofas' cloth,
the slats' wood, the brass), under a finish written for plain materials.
