# packs/gltf: a compiled map as one .glb

The kit's first optional pack (ARCHITECTURE.md 2.6). It writes a compiled GoldSrc map (`.bsp`, version 30 or BSP2)
and the studio models its entities place as **one glTF 2.0 binary file** that Godot 4, Blender and three.js open.

```
node packs/gltf/bin.mjs map-gltf <map.bsp> -o scene.glb [--game <mod folder> --game <valve folder>]
```

```js
import { mapGlb } from "file:///C:/path/to/smak/packs/gltf/gltf.mjs";
const { glb, facts } = mapGlb(readFileSync("map.bsp"), { folders: [modFolder, valveFolder] });
```

`smak` has no `map-gltf`: the kit never imports a pack, so the pack has its own entry. Only a `.glb` is written (no
`.gltf` with a `.bin`). `--game` is where the `.wad` files and the models are, as for `smak map-view`.

**Budget: 1 200 lines**, every `.mjs` under this folder (layers.json `packs`; test 00 prints it and fails it
over). It is not counted in the kit's budget or ratchet.

## What the file holds

| What | How |
| --- | --- |
| The world and each brush entity | A node and a mesh each, one primitive per material. One material per texture and per way it is drawn (opaque; `{name masked` on an entity in render mode 4, as the game; faded by `renderamt`). Textures inside as PNG, sampled LINEAR with mipmaps, REPEAT. |
| Left out | Sky and the tools' textures (clip, origin, null, hint, skip, aaatrigger, bevel, contentwater). An entity the game never draws (a trigger, `zhlt_invisible`) keeps its node, with no mesh. A `{` texture on the world or an entity not in render mode 4 is opaque, as in the game. |
| The baked light | `COLOR_0` on the world's corners, each face cut on its lightmap's grid so that a corner stands on every sample; the world's materials `KHR_materials_unlit`. Below, why. |
| The lights | `light`, `light_spot`, `light_environment` as `KHR_lights_punctual` (point, spot, directional) on their entity's node. |
| The props | Every point entity the kit draws as a model (`figuresOf`: a `model` key naming a `.mdl`, whatever its class), as a node at its origin and `angles` (and `scale`), the mesh shared by every entity showing the same model in the same body, skin, sequence and frame. The pose is that frame (the first of the entity's `sequence`), as map-view draws it. **No skeleton and no animation**; a chrome texture is its mean colour; an additive one is drawn opaque, unlit. Lit materials: the engine's lights light them. |
| Extras | On each entity's node: `number`, `classname`, `targetname`, `origin` (the map's units) and `keys` (every key). |
| Axes, units | GoldSrc `(x, y, z)`, +z up, is written glTF `(x, z, -y)`: a turn, not a mirror, so windings stay anticlockwise from the front. **39.37 units a metre** (the kit's importer's figure, core/import-shape.mjs). Blender's importer turns it back: Blender's coordinates are the map's divided by 39.37. |

Not written: sprites (`env_sprite`, `env_glow`), decals, the sky's pictures, a brush entity's movement, light styles
that flicker (the light is the map as it starts), models with more than one frame of animation.

## The baked light: COLOR_0, cut on the lightmap's grid, unlit materials

Chosen by what is seen on import, in Godot 4.7.2 and Blender 5.2, on this machine (2026-11-14):

| Way | What an engine shows on import | Verdict |
| --- | --- | --- |
| `COLOR_0` at the faces' corners only | Both multiply it into the base colour (Godot sets "vertex colour as albedo", Blender a Multiply node). But a face up to 256 units across gets four samples: the column's shadow and the lamps' pools on the plaza's floor are gone (picture difference to map-view 16.7 against 12.3 with the grid, camera 3). | No |
| `COLOR_0` on the lightmap's grid | The same, with the light's detail: the pack's own drawing within 6 to 12 levels of 255 of map-view on 9 views, Godot's within 7 to 15. Triangles 16 to 60 times the faces' (plaza: 28 212 fanned, 461 772 cut); 18.3 MB. | **Chosen** |
| A second UV set (`TEXCOORD_1`) with the lightmaps as one atlas | Godot imports it as UV2 and Blender as a second UV map, but nothing draws it: as `occlusionTexture` Godot makes it ambient occlusion (it darkens ambient light only, never an unlit albedo) and Blender keeps occlusion in its "glTF Material Output" group, which rendering ignores; as emission it adds light, not multiplies it. Hand work in both. | No (from the importers' sources and Blender's manual, not tried) |
| The light baked into the base colour, a picture a face | Shows on import everywhere, but the plaza's 23 114 m² at the textures' density (a texel a unit) is 36 million texels before any repeat: well past 50 MB. | No (measured, not tried) |

The materials are **unlit** so that the picture is texture x lightmap and nothing else, as the game draws it; the
punctual lights are there for an engine to light the scene in real time **instead**: in Godot set the world's
materials to Per-Pixel shading and untick Vertex Color > Use as Albedo (or strip `COLOR_0`); in Blender the importer
made an emission set-up for the unlit materials, to be replaced by a Principled BSDF.

A light sample `s` becomes `COLOR_0 = linear(min(1, s x 1.55 / 255))`: map-view's brightness (check/maps/draw.mjs
BRIGHTNESS), linear because glTF multiplies linear colours. Over 164 a sample is cut at 1 (about 1 sample in 10 on the
plaza): the brightest floors are a little darker than in the game. A face of a lit map with no light is black (as in
the game); a liquid is drawn as it is.

## The lights' intensity

hlrad (sdHLRAD lightmap.cpp) makes `_light "r g b brightness"` an intensity I = r/255 x brightness, multiplies a point
or a spot by max(I)²/10, and a sample at d units is that x cos / d², scaled by 2, where 256 is white. The pack writes
**candela so that the light at d metres, in lux, is that share of white**: `I x max(I)²/10 x 2 / 256 / 39.37²` (a
`_light "255 255 255 200"` is 4.0 cd: white at 2 m). The sun (`light_environment`) is not over d²: `2 x max(I) / 256`
lux. Colour: I over its largest channel. `range`: where the light falls under 1/256 of white. Spots: `_cone` and
`_cone2` (half-angles, degrees) are the inner and outer cone; aimed by `target`, else `angle` (-1 up, -2 down) or
`angles`' yaw, and `pitch` or `angles`' pitch, as hlrad reads them. `_diffuse_light` (the sky's ambient) is not written.

What the engines make of it: Godot sets a light's energy to the intensity as it is (energy 4 for the 4.0 cd above),
range clamped to 4096; Blender's default ("Standard" lighting mode) converts at 683 lm/W, so the same light is 0.07 W
there and looks dim: import with Lighting Mode "Unitless" to see them.

## Verified with

`test/200-pack-gltf.mjs` (in `npm test`), on the kit's two rooms: the file against the glTF 2.0 points the pack
relies on (`test/validate.mjs`: the container, views aligned to 4, accessors in their views, POSITION's min and max
its true bounds, indices in range, normals of length 1, COLOR_0 in 0..1, materials, each PNG decoded, the node tree,
the lights); each texture's area against the faces' own; every face of room A facing into it; the grate where the
map has it; a view of the file (`test/draw.mjs`, which reads it with the validator and culls back faces) against
map-view's; a `{` texture masked; a tool's texture and the sky left out; a model placed twice sharing one mesh.

On two of the owner's maps (not in the kit), 2026-11-14:

| Map | Faces, fanned / written | Area m², bsp / glb | Props | .glb | Time |
| --- | --- | --- | --- | --- | --- |
| smak_rp_plaza01 (a town square) | 9 604, 28 212 / 461 772 + 53 576 props | 23 113.99 (+ 39.67 props) / 23 153.66 | 31 placed, 7 meshes | 18.3 MB | 2.0 s |
| smak_neonbench_tex (BSP2, a street corner) | 2 577, 7 382 / 444 573 | 33 159.23 / 33 159.23 | 0 | 13.3 MB | 1.5 s |

Read back by **Godot 4.7.2** (headless import, a scene loaded from GDScript, and shots from map-view's cameras): the
same triangles (515 348 plaza, 444 573 street), 33 mesh instances, 126 omni, 28 spot and 1 directional light, 39
materials and textures, 226 nodes with their extras as metadata, the bounds the faces' own; pictures within 7 to 15
of 255 of map-view's. **Blender 5.2**: the same objects, lights, materials and images, the bounds equal to the faces'
to the millimetre; 29 of 461 724 world triangles fewer (the map has 46 triangles at the same place as another, which
its importer drops as duplicates).

| Feature | Godot 4.7.2 |
| --- | --- |
| `COLOR_0` as the albedo's multiplier | **Tried.** Godot reads a primitive's material before its attributes and flags it only when an earlier primitive of the mesh had COLOR_0 (gltf_document.cpp, `has_vertex_color`), so a mesh's first material was left unflagged; the pack writes that material's first triangle as a primitive of its own ahead of the rest, and every material is flagged. |
| `KHR_materials_unlit` | **Tried**: Unshaded. |
| `alphaMode MASK` | **Tried**: Alpha Scissor at 0.5. |
| `KHR_lights_punctual` | **Tried**: the nodes and their counts; their brightness on a lit scene was not judged. Energy is the intensity (gltf_light.cpp, 4.3 source). |
| `extras` | **Tried**: node metadata `extras` (since 4.4). |
| A second UV set | Not written. From the source (4.3, 4.7): imported as UV2, used by LightmapGI, not tried. |
