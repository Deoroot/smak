# packs/godot: a compiled map as a Godot 4 project that walks

An optional pack (ARCHITECTURE.md 2.6), over `packs/gltf`. It writes a folder Godot 4 opens and walks with nothing
edited by hand: the map's two `.glb` (baked and lit), a first-person walker, and the scripts that run it.

```
node packs/godot/bin.mjs project <map.bsp> -o <folder> [--game <folder> ...] [--sets <folder> ...] [--start x,y,z[,yaw]]
     [--shot name=x,y,z,yaw,pitch[,fov] ...] [--size WxH] [--tonemap linear|filmic|aces] [--probe x,y,z,sx,sy,sz]
     [--ambient r,g,b] [--background r,g,b] [--lamps <factor>] [--cells <factor>] [--role <name>=<factor> ...]
     [--finish <name>=<tone>[,<roughness>] ...] [--ssr] [--fog density,r,g,b[,x,y,z,sx,sy,sz]] [--name <words>]
     [--godot <program>] [--list] [--shots]
node packs/godot/bin.mjs shots <folder> [--godot <program>] [--size WxH]
                                Godot run from any shell: shot-<name>-baked.png and shot-<name>-lit.png from each --shot
node packs/godot/bin.mjs list <folder>      the lamps (number, _role, place, candela, factor) and the materials by name
<folder>\run.bat                walk it: WASD, mouse, Space, Shift; 1 baked, 2 lit, H the lamps' shadows
```

```js
import { godotProject, writeProject, takeShots, reachOf } from "file:///C:/path/to/smak/packs/godot/godot.mjs";
writeProject(folder, godotProject(readFileSync("map.bsp"), { folders: [mod, valve], sets: [materials] }));
const { files, said } = takeShots(folder);   // Godot run; the pictures, and Godot's ERROR and WARNING lines
```

The guide is `docs/GODOT.md`: every option, what the walker sets in each way, a dark place lit in pools (the lamps
scaled, `_role`, the ambient, a wet floor, fog), `own.gd` (what is one map's own, kept when the project is written
again) and what it reaches by name, what joining rooms taught, what it does not do.

**Budget: 400 lines**, every `.mjs` under this folder (layers.json `packs`; test 00 prints it and fails it over). It
is not counted in the kit's budget or ratchet. The walker is not `.mjs`: it is data, `template/main.gd`, the same for
every map but the values at its top (`{{start}}`, `{{ambient}}`, `{{lamps}}` ...), with `template/project.godot`,
`main.tscn`, `run.bat` and `run.sh`.

## How it is made

| What | Where from |
| --- | --- |
| `baked.glb`, `lit.glb` | `mapGlb` of `packs/gltf`, imported, called twice; no line of it copied |
| The start | The lit file's `info_player_start` node: its `extras.origin` less 36 (the feet), its `angles`' yaw |
| The lit way's ambient | The lit file's root, `extras.ambient` |
| The probe's box | The `POSITION` bounds of the world's mesh in the lit file (the sky and the tools' faces are not in it); looked at from the start's eye, since a box's middle may be in rock |
| The walls stood on | The lit scene's meshes (`create_trimesh_collision`): the same geometry as the baked in far fewer triangles |
| The lamps' shadows | Turned on by the walker; Godot imports every light with none |
| The lit way's look | Constants of `main.gd` (`LAMPS`, `CELLS`, `ROLES`, `FINISH`, `SSR`, `FOG`), applied by the walker when it starts: no `.glb` changes with them, so nothing is imported again. A lamp's role is its entity's `_role` key, read from the node's extras; a lamp with no extras is a texture light's cell. `ROLES` starts as `fill: 0` |
| The shots | `takeShots`: Godot's `--import` (headless) when the folder has no `.godot`, then the project with `-- --shots`; the program is the `GODOT` variable, else the one in `run.bat`; an earlier run's pictures removed first, a picture not written an error with Godot's own lines; 900 s for each of the two |
| `own.gd` | The author's; loaded when there, never written |

Written again over a folder: the seven files replaced, `.godot` (Godot's import) removed when a `.glb` is not the one
there (Godot runs what it imported, not the file), everything else left.

`WARN` (printed by `project`, in `facts.notes`): more than 64 lamps on in the lit way, the most Godot's default shadow
atlas holds in its largest quadrant: some lamps get no shadow and shine through walls (seen on a room of 82); a role
asked that no light of the map has; a finish whose name no material holds; a `--sets` set left out by the lit file
(not of the map's texture: a material remade and the map not compiled again; packs/gltf/README.md). A line that
is not a `WARN`: the export's ambient under 0.01, as good as black.

## Verified with

`test/208-pack-godot.mjs` (in `npm test`; no Godot needed) and `test/check.mjs` here (`checkProject`: a folder read
back, its values as numbers); the broken cases in `test/broken/packs.mjs`.

Godot 4.7.2, 2026-11-15, two of the owner's maps against the approved shots of their hand-written projects, the same
camera, mean difference of a channel of 255 (a run repeated: 0.000): a mess hall baked 0.12, lit 0.82 with the
world's box for the probe and 0.20 with the hall's; a lounge baked 0.00, lit 8.2 with nothing of its author's, 2.5
with its author's ambient, probe and finish in `own.gd`, and 0.00 with those on the `.glb` its approved shot was made
with. docs/GODOT.md, "Tried with", says what each remainder is.

The lit way's look as options, 2026-11-15: those four projects written again, the same eight pictures (0.000); a
dark district lit in pools against its author's shots (90 lines of `own.gd`), six cameras, the lit way: 35 to 46 before
the options, 1.9 to 8.5 with every option and no `own.gd`, 0.26 to 0.60 with 26 lines of `own.gd` besides (a stall's
lamps by their place, a glow, the floor's specular). `shots` run from Git Bash and from Node; `run.sh` from Git Bash.

Also run once each: `shots` on a `main.gd` that does not load (ended at its timeout with Godot's own error, no Godot
left running), `--size 960x540`, `--role fill=1`, fog with no box (drawn; the look not judged).

Not tried: Godot before 4.7.2, the Mobile and Compatibility renderers, `run.sh` on Linux or macOS, a map with no
compiled light, a map with its start under the open sky.
