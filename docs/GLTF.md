# A map for another engine: one .glb

A compiled map and the models it places can be opened in Godot 4, Blender or three.js as one glTF 2.0 file (`.glb`)
with its textures and its baked light inside. This is an optional pack, `packs/gltf/`, beside the kit: `smak` does
not have the command (the kit never imports a pack); the pack has its own entry.

```
node packs/gltf/bin.mjs map-gltf maps/street.bsp -o street.glb --game <mod folder> --game <valve folder>
```

It prints what went in: faces, triangles, area in m², props placed and the meshes they share, materials, pictures,
lights, nodes, and the textures found nowhere (drawn grey: give `--game` the mod's folder and `valve`, as for
`map-view`). Without `--game` a map whose textures are in `.wad` files is grey and has no props.

In a script:

```js
import { readFileSync, writeFileSync } from "node:fs";
import { mapGlb } from "file:///C:/path/to/smak/packs/gltf/gltf.mjs";
const { glb, facts } = mapGlb(readFileSync("street.bsp"), { folders: [mod, valve] });
writeFileSync("street.glb", glb);
```

## What is in the file

- **The world and every brush entity**, a node and a mesh each, one material per texture; sky and tools' textures
  (clip, origin, null, hint, skip, aaatrigger) left out; a trigger keeps its node with no mesh.
- **The baked light** as vertex colours (`COLOR_0`), each face cut on its lightmap's grid; the world's materials
  unlit. On import Godot and Blender both show texture x lightmap, as the game does, with no hand work.
- **The lights** (`light`, `light_spot`, `light_environment`) as `KHR_lights_punctual`, for an engine to light the
  scene in real time instead (README.md says how to switch, and how the intensity is worked out).
- **The props**: every entity the kit draws as a model (`model` naming a `.mdl`), at its origin and angles, one mesh
  shared by each entity that shows the same model in the same pose and light. One frame: no skeleton, no animation.
  Lit as the game lights a model (from Xash's source, and held against the game's screenshot of one room): the
  floor's light under it, from above, baked as vertex colours on unlit materials like the world's, so a prop sits in
  its room on import (tried in Godot 4.7.2). The game draws a model darker beside the walls than `map-view` does.
- **Masked textures** (`{` names on an entity in render mode 4, a model's masked ones) cut where the game cuts them
  (0.25 and 0.5) and sampled with no mipmaps: a grate stays a grate into the distance (tried in Godot 4.7.2: with
  mipmaps it vanished from about 250 units on).
- **Extras** on each entity's node: `classname`, `targetname`, `origin` (the map's units), `keys`: an engine's script
  finds the starts and the doors by them.
- **Axes**: the map's `(x, y, z)` is glTF's `(x, z, -y)`, 39.37 units to a metre. Blender gives back the map's
  coordinates divided by 39.37.

## Look at it

Every check of the pack's own is in its test; to see the file, draw it from a map-view camera beside map-view's own:

```js
import { drawGlb, difference } from "file:///C:/path/to/smak/packs/gltf/test/draw.mjs";
import { validateGlb } from "file:///C:/path/to/smak/packs/gltf/test/validate.mjs";
validateGlb(glb).errors;                                     // [] when the file is whole by the specification
const ours = drawGlb(glb, { from: [586, -1835, 64], yaw: 12 }); // map-view's from, to, yaw, pitch, fov
```

`drawGlb` reads the file back by the specification alone and culls faces from behind: a mirrored or inside-out file
draws holes, and text on a texture reads backwards. Lay it beside `smak map-view` with the same camera and look: a
wall with the wrong texture, a prop on its side or at the wrong height is a fault. A difference of under about 15
levels of 255 a channel is texture filtering and the light's last bright levels.

## What it does not do

- No sprites, decals or sky pictures; a light that flickers or is switched is as the map starts.
- Props have no skeleton or animation; a chrome texture is a flat colour; an additive one is drawn opaque. A prop
  under the open sky takes the floor's light, where the game gives it the sun's colour (from the documentation: Xash's
  source, not tried).
- A masked texture with no mipmaps shimmers where its bars are finer than a pixel (tried in Godot 4.7.2).
- A light sample over 164 is cut at white (glTF's vertex colours stop at 1): the brightest floors are a little
  darker than in the game.
- The file is big: every lightmap sample is a corner (a town square of 9 600 faces: 460 000 triangles, 18 MB).
- Godot was tried (4.7.2: import, the counts, pictures); its LightmapGI, real-time lights' brightness and
  performance were not judged. README.md lists each feature as tried or read from the source.
