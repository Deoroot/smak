# packs/godot: a compiled map as a Godot 4 project that walks

An optional pack (ARCHITECTURE.md 2.6), over `packs/gltf`. It writes a folder Godot 4 opens and walks with nothing
edited by hand: the map's two `.glb` (baked and lit), a first-person walker, and the scripts that run it.

```
node packs/godot/bin.mjs project <map.bsp> -o <folder> [--game <folder> ...] [--sets <folder> ...] [--start x,y,z[,yaw]]
     [--shot name=x,y,z,yaw,pitch[,fov] ...] [--tonemap linear|filmic|aces] [--probe x,y,z,sx,sy,sz]
     [--ambient r,g,b] [--background r,g,b] [--name <words>] [--godot <program>]
<folder>\run.bat                walk it: WASD, mouse, Space, Shift; 1 baked, 2 lit, H the lamps' shadows
<folder>\run.bat -- --shots     shot-<name>-baked.png and shot-<name>-lit.png from each --shot, then quits
```

```js
import { godotProject, writeProject } from "file:///C:/path/to/smak/packs/godot/godot.mjs";
writeProject(folder, godotProject(readFileSync("map.bsp"), { folders: [mod, valve], sets: [materials] }));
```

The guide is `docs/GODOT.md`: every option, what the walker sets in each way, `own.gd` (what is one map's own, kept
when the project is written again), what joining rooms taught, what it does not do.

**Budget: 400 lines**, every `.mjs` under this folder (layers.json `packs`; test 00 prints it and fails it over). It
is not counted in the kit's budget or ratchet. The walker is not `.mjs`: it is data, `template/main.gd`, the same for
every map but ten values at its top (`{{start}}`, `{{ambient}}` ...), with `template/project.godot`, `main.tscn`,
`run.bat` and `run.sh`.

## How it is made

| What | Where from |
| --- | --- |
| `baked.glb`, `lit.glb` | `mapGlb` of `packs/gltf`, imported, called twice; no line of it copied |
| The start | The lit file's `info_player_start` node: its `extras.origin` less 36 (the feet), its `angles`' yaw |
| The lit way's ambient | The lit file's root, `extras.ambient` |
| The probe's box | The `POSITION` bounds of the world's mesh in the lit file (the sky and the tools' faces are not in it); looked at from the start's eye, since a box's middle may be in rock |
| The walls stood on | The lit scene's meshes (`create_trimesh_collision`): the same geometry as the baked in far fewer triangles |
| The lamps' shadows | Turned on by the walker; Godot imports every light with none |
| `own.gd` | The author's; loaded when there, never written |

Written again over a folder: the seven files replaced, `.godot` (Godot's import) removed when a `.glb` is not the one
there (Godot runs what it imported, not the file), everything else left.

`WARN` (printed by `project`, in `facts.notes`): more than 64 lamps in the lit way, the most Godot's default shadow
atlas holds in its largest quadrant: some lamps get no shadow and shine through walls (seen on a room of 82).

## Verified with

`test/208-pack-godot.mjs` (in `npm test`; no Godot needed) and `test/check.mjs` here (`checkProject`: a folder read
back, its values as numbers); the broken cases in `test/broken/packs.mjs`.

Godot 4.7.2, 2026-11-15, two of the owner's maps against the approved shots of their hand-written projects, the same
camera, mean difference of a channel of 255 (a run repeated: 0.000): a mess hall baked 0.12, lit 0.82 with the
world's box for the probe and 0.20 with the hall's; a lounge baked 0.00, lit 8.2 with nothing of its author's, 2.5
with its author's ambient, probe and finish in `own.gd`, and 0.00 with those on the `.glb` its approved shot was made
with. docs/GODOT.md, "Tried with", says what each remainder is.

Not tried: Godot before 4.7.2, the Mobile and Compatibility renderers, `run.sh` on Linux or macOS, a map with no
compiled light, a map with its start under the open sky.
