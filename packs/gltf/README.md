# packs/gltf: a compiled map as one .glb

The kit's first optional pack (ARCHITECTURE.md 2.6). It writes a compiled GoldSrc map (`.bsp`, version 30 or BSP2)
and the studio models its entities place as **one glTF 2.0 binary file** that Godot 4, Blender and three.js open.

```
node packs/gltf/bin.mjs map-gltf <map.bsp> -o scene.glb [--game <mod folder> --game <valve folder>] [--light baked|lit] [--sets <folder>]
```

```js
import { mapGlb } from "file:///C:/path/to/smak/packs/gltf/gltf.mjs";
const { glb, facts } = mapGlb(readFileSync("map.bsp"), { folders: [modFolder, valveFolder] }); // light: "lit", sets: [...]
```

`smak` has no `map-gltf`: the kit never imports a pack, so the pack has its own entry. Only a `.glb` is written (no
`.gltf` with a `.bin`). `--game` is where the `.wad` files and the models are, as for `smak map-view`.

**Budget: 1 200 lines**, every `.mjs` under this folder (layers.json `packs`; test 00 prints it and fails it
over). It is not counted in the kit's budget or ratchet.

## What the file holds

| What | How |
| --- | --- |
| The world and each brush entity | A node and a mesh each, one primitive per material. One material per texture and per way it is drawn (opaque; `{name masked` on an entity in render mode 4, as the game; faded by `renderamt`). Textures inside as PNG, sampled LINEAR with mipmaps, REPEAT; a masked one with no mipmaps (below). |
| Left out | Sky and the tools' textures (clip, origin, null, hint, skip, aaatrigger, bevel, contentwater). An entity the game never draws (a trigger, `zhlt_invisible`) keeps its node, with no mesh. A `{` texture on the world or an entity not in render mode 4 is opaque, as in the game. |
| The baked light | `COLOR_0` on the world's corners, each face cut on its lightmap's grid so that a corner stands on every sample; the world's materials `KHR_materials_unlit`. Below, why. |
| The lights | `light`, `light_spot`, `light_environment` as `KHR_lights_punctual` (point, spot, directional) on their entity's node. |
| The props | Every point entity the kit draws as a model (`figuresOf`: a `model` key naming a `.mdl`, whatever its class), as a node at its origin and `angles` (and `scale`), the mesh shared by every entity showing the same model in the same body, skin, sequence and frame. The pose is that frame (the first of the entity's `sequence`), as map-view draws it. **No skeleton and no animation**; a chrome texture is its mean colour; an additive one is drawn opaque, unlit. In a lit map **lit as the game lights a model** (below): `COLOR_0` on unlit materials, as the world, so one mesh is shared by the entities in the same light too; in a map with no lightmaps, lit materials for the engine's lights. |
| Extras | On each entity's node: `number`, `classname`, `targetname`, `origin` (the map's units) and `keys` (every key). |
| Axes, units | GoldSrc `(x, y, z)`, +z up, is written glTF `(x, z, -y)`: a turn, not a mirror, so windings stay anticlockwise from the front. **39.37 units a metre** (the kit's importer's figure, core/import-shape.mjs). Blender's importer turns it back: Blender's coordinates are the map's divided by 39.37. |

Not written: sprites (`env_sprite`, `env_glow`), decals, the sky's pictures, a brush entity's movement, light styles
that flicker (the light is the map as it starts), models with more than one frame of animation.

## Two ways: baked and lit

`--light baked` (the default; `light: "baked"`) is everything above and below: the game's light as hlrad compiled it,
on unlit materials. `--light lit` (`light: "lit"`) writes the same map for an engine that lights it in real time:

```
node packs/gltf/bin.mjs map-gltf map.bsp -o lit.glb --light lit --sets <folder of packs/materials' output> --game ...
```

| What | Baked | Lit |
| --- | --- | --- |
| The world's materials | Unlit, `COLOR_0` the lightmap, each face cut on its grid | Lit PBR, no `COLOR_0`, each face fanned (the mess hall: 22 549 triangles where baked has 446 385) |
| A texture with a set (`<name>.set/` in a `--sets` folder, packs/materials) | Its GoldSrc picture | The GoldSrc picture as base colour; the set's `normal.png` as it is (OpenGL's sense, +Y up, which is glTF's); roughness in G, metalness in B, occlusion in R of one picture (`metallicRoughnessTexture` and `occlusionTexture`); `TANGENT` on its faces |
| A texture with no set | | Lit, roughness 1, metalness 0 (GoldSrc draws no highlight) |
| The lamps (`light`, `light_spot`, `light_environment`) | hlrad's intensity (below) | The same x 2.62: the game's brightness, 1.55 on a colour, is 1.55^2.2 on linear light |
| A texture light (`info_texlights`) | In the lightmap | Emissive (its picture, `emissiveFactor` its colour); its faces gathered by texture in cells 256 units wide, the 32 brightest cells a lamp each (a spot of 90 degrees facing out, a point where its faces disagree), by hlrad's arithmetic: light x area x the texture's reflectivity (mean of (c/255)^1.76 x 0.7) / pi, falling as cos x cos / d², x 2 / 256, x 2.62 |
| The props | `COLOR_0` from the floor's light, unlit | Lit like the world, one mesh a model and pose (the mess hall's 76: 27 meshes) |
| Masked textures | Cut at 0.25 and 0.5, no mipmaps | The same |
| The ambient | | No bounce light: the root's `extras.ambient` is the colour of the world's lightmap sample darker than nine tenths of the rest, linear, for the engine's ambient (the mess hall: 0.014 0.023 0.025) |

A set is used only when the `<name>.png` the materials pack wrote beside it is the map's texture, colour for colour
(within 2 of 255), and was not cut from a part of its source (`--part`: the set is of the whole source and would not
lie on it); otherwise it is left out and said (round 2 of the mess hall, whose textures share the sets' names and not
their pictures: seven sets left out). The baked way never reads `--sets`: its bytes are as before (the mess hall's
round 2 and the trial, the same SHA-256 before and after, 2026-11-14).

**What the lit way loses**: the bounce (shadows black but for the ambient the engine is given); the light of the
texture lights' other cells (the mess hall: 32 of 371; the sea and the windows' backdrops are dim and wide) and their
emission's cosine (a spot is even across its half-sphere); hlrad's gamma of 0.55 (near a lamp the lit way is brighter
than the game, far from it darker); `_diffuse_light` and the sun's sky; the game's darker model light (a fridge the
game draws near black is lit from the front). Shadows are the engine's: glTF has no flag, and Godot imports every
light with shadows off, through walls; turn them on. **What it gains**: lamps that move or switch, relief and
roughness where a set exists, and a file a quarter of the size before the sets' pictures (the mess hall 7.3 MB, with
the seven sets 27.8 MB, against 24.0 MB baked, the same inputs).

Tried on the trial retexture of the mess hall (seven sets of packs/materials), Godot 4.7.2, 2026-11-14:

- **Import** (Godot and Blender 5.2.1 alike): 82 lights (46 spots, 36 points: the map's 50 and the 32 texture
  lamps), 96 materials, none unlit, 7 with a normal map and ORM, 9 emissive, 2 cut out, 68 103 triangles.
- **The normal's sense and TANGENT**: domes raised in OpenGL's sense on the two rooms' wall, lit by one directional
  light from above and from the right: each dome bright on the side towards the light, raised; Godot's own tangents
  (TANGENT taken out of the file) give the same picture to the byte; the file with every w turned shows them sunk, so
  Godot reads the file's TANGENT.
- **Brightness**: Godot draws albedo x energy x cos / d² (measured: energy 1 at 1 m, a white plane, linear 1.00;
  0.25 gives 0.25), so the candela written land as the share of white hlrad meant. Lit over baked, linear, the brighter
  half of the pixels, five views: without the gain 0.12 to 0.36; with it and the texture lamps 0.52 to 1.09, the
  reference view 1.09, a wall a lamp's width away 1.77. Near-black pixels with the ambient above 1.3 to 6.2% (baked
  0.1 to 9.7%; without the ambient 2.5 to 11.4%).
- **Looks worse than baked**: the metal floor greys where its metalness map says metal (it reflects the empty black
  background: an engine needs a sky or a reflection probe); the warm tint of the floor's pools is gone; the purple
  strips' lamps spread purple up the wall more than hlrad did; the wall beside a lamp washes out.

## The baked light: COLOR_0, cut on the lightmap's grid, unlit materials

Chosen by what is seen on import, in Godot 4.7.2 and Blender 5.2, on this machine (2026-11-14):

| Way | What an engine shows on import | Verdict |
| --- | --- | --- |
| `COLOR_0` at the faces' corners only | Both multiply it into the base colour (Godot sets "vertex colour as albedo", Blender a Multiply node). But a face up to 256 units across gets four samples: the column's shadow and the lamps' pools on the plaza's floor are gone (picture difference to map-view 16.7 against 12.3 with the grid, camera 3). | No |
| `COLOR_0` on the lightmap's grid | The same, with the light's detail: the pack's own drawing within 6 to 12 levels of 255 of map-view on 9 views, Godot's within 7 to 15. Triangles 16 to 60 times the faces' (plaza: 28 212 fanned, 461 772 cut); 18.3 MB. | **Chosen** |
| A second UV set (`TEXCOORD_1`) with the lightmaps as one atlas | Godot imports it as UV2 and Blender as a second UV map, but nothing draws it: as `occlusionTexture` Godot makes it ambient occlusion (it darkens ambient light only, never an unlit albedo) and Blender keeps occlusion in its "glTF Material Output" group, which rendering ignores; as emission it adds light, not multiplies it. Hand work in both. | No (from the importers' sources and Blender's manual, not tried) |
| The light baked into the base colour, a picture a face | Shows on import everywhere, but the plaza's 23 114 m² at the textures' density (a texel a unit) is 36 million texels before any repeat: well past 50 MB. | No (measured, not tried) |

The materials are **unlit** so that the picture is texture x lightmap and nothing else, as the game draws it; the
punctual lights are there for an engine to light the scene in real time **instead** (the lit way above does it in the file): in Godot set the world's and the props'
materials to Per-Pixel shading and untick Vertex Color > Use as Albedo (or strip `COLOR_0`); in Blender the importer
made an emission set-up for the unlit materials, to be replaced by a Principled BSDF.

A light sample `s` becomes `COLOR_0 = linear(min(1, s x 1.55 / 255))`: map-view's brightness (check/maps/draw.mjs
BRIGHTNESS), linear because glTF multiplies linear colours. Over 164 a sample is cut at 1 (about 1 sample in 10 on the
plaza): the brightest floors are a little darker than in the game. A face of a lit map with no light is black (as in
the game); a liquid is drawn as it is.

## The props' light: as the game lights a studio model

Xash (ref/gl/gl_studio.c, R_StudioDynamicLight and R_StudioLighting; read in its source) gives a model one light: the
sample of the first lit face of the world on the line from 8 units over the entity's origin straight down. 0.9 of it
(the cvar `direct`) falls from above and the rest everywhere: a corner keeps `1 - 0.9 x max(0, (0.495 - nz) / 1.495)`
of it, nz the upright part of its normal (looking up 1, sideways 0.70, down 0.10). The pack writes that as `COLOR_0` on
**unlit** materials, as the world's, at `0.745` of what the same sample gives a face: the game takes a model's sample x
264/256 and lays a face's lightmap x 264/256 x 171/256 x 2 (gl_rsurf.c, gl_overbright, drawn from vertex buffers;
without them 256/256, and a model would be 0.5 of a face). The game's own screenshot of the
mess hall, one of the owner's maps (Xash, 2026-11-14), agrees: with the textures' texgamma taken into account,
its walls show 1.27 to 1.45 of their sample and the utility box's side 0.73 to 0.87, the game's figure for a side 0.72
(a trash can's side 1.06 to 1.18: one box, one can, so a check, not a fit). map-view lights a model brighter
(`MODEL_AMBIENT` 0.6 + 0.4 towards its lamp, at a face's 1.55): the game is darker.

Not done as the game does: the light's lean towards the brighter side of the floor (the game samples 16 units round
the origin); a model under the open sky, which the game lights by `light_environment`'s colour (here the floor's);
the floors of brush entities (the game asks them too); `STUDIO_AMBIENT_LIGHT`. The mesh is one a model, pose, light
and tilt: the mess hall's 76 props are 72 meshes where they were 27 (15.5 MB to 18.3 MB); the plaza's 31 are 19 (18.3
to 20.8 MB).

Tried in Godot 4.7.2 and from the same cameras as map-view, the mess hall (2026-11-14; the brightness of a prop's
pixels over that of the world's in a ring round it, map-view / before / after): the white case 1.71 / 0.63 / 1.84,
the crate stack 0.89 / 0.33 / 0.69, a table 0.91 / 0.60 / 0.97, the window frames' plate 1.25 / 0.47 / 1.32 (before
near black: no punctual light reached it), the fridge 0.61 / 1.01 / 0.43, the wall cabinet 0.45 / 1.05 / 0.29, the
utility box 1.85 / 1.69 / 1.52. Before, a prop was as light as the punctual lights near it made it.

## Masked textures: the game's cut-off, no mipmaps

Xash draws a brush entity in render mode 4 with the alpha test GL_GREATER 0.25 (gl_rsurf.c), a model's masked texture
with 0.5 (gl_studio.c); the pack writes those as `alphaCutoff`. Godot 4.7.2 imports an embedded texture with mipmaps
and the material as Alpha Scissor (tried). The mess hall's grate is a third metal: from its fourth level (8 x 8) every
texel's alpha is 0.25 to 0.44, so at 0.5 the grate vanished from about 250 units on (tried); at 0.25 alone it turned
into an opaque light plate there (tried). The pack gives a masked texture a sampler with `minFilter` LINEAR (no
mipmaps), which Godot reads into the material's filter (Linear, tried): the grate reads as a grate to the far wall, as
in the game, at the cost of shimmer where the bars are finer than a pixel. Alpha to coverage and Godot's import
settings are not in the file; a change there is hand work in the engine.

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

`test/202-pack-gltf.mjs` (in `npm test`), on the kit's two rooms: the file against the glTF 2.0 points the pack
relies on (`test/validate.mjs`: the container, views aligned to 4, accessors in their views, POSITION's min and max
its true bounds, indices in range, normals of length 1, COLOR_0 in 0..1, materials, each PNG decoded, the node tree,
the lights); each texture's area against the faces' own; every face of room A facing into it; the grate where the
map has it; a view of the file (`test/draw.mjs`, which reads it with the validator and culls back faces) against
map-view's; a `{` texture masked at 0.25 and sampled with no mipmaps; a tool's texture and the sky left out; a model
placed three times, the two in one light sharing a mesh, each corner's `COLOR_0` the floor's sample under it (read from
the faces' polygons, not the pack's walk) x 1.55 x 0.745 x 0.70.

On two of the owner's maps (not in the kit), 2026-11-14:

| Map | Faces, fanned / written | Area m², bsp / glb | Props | .glb | Time |
| --- | --- | --- | --- | --- | --- |
| smak_rp_plaza01 (a town square) | 9 604, 28 212 / 461 772 + 53 576 props | 23 113.99 (+ 39.67 props) / 23 153.66 | 31 placed, 19 meshes (7 before the props' light) | 20.8 MB | 2.0 s |
| smak_neonbench_tex (BSP2, a street corner) | 2 577, 7 382 / 444 573 | 33 159.23 / 33 159.23 | 0 | 13.3 MB | 1.5 s |

Read back by **Godot 4.7.2** (headless import, a scene loaded from GDScript, and shots from map-view's cameras): the
same triangles (515 348 plaza, 444 573 street), 33 mesh instances, 126 omni, 28 spot and 1 directional light, 39
materials and textures, 226 nodes with their extras as metadata, the bounds the faces' own; pictures within 7 to 15
of 255 of map-view's. **Blender 5.2**: the same objects, lights, materials and images, the bounds equal to the faces'
to the millimetre; 29 of 461 724 world triangles fewer (the map has 46 triangles at the same place as another, which
its importer drops as duplicates). After the props' light and the masked textures' sampler (2026-11-14), from the
same six cameras of the plaza and the street in Godot: the pictures differ from those before by 0.00 to 0.22 of 255
(the handcart's camera 0.22), and from map-view's as they did (7.1 to 13.1).

| Feature | Godot 4.7.2 |
| --- | --- |
| `COLOR_0` as the albedo's multiplier | **Tried.** Godot reads a primitive's material before its attributes and flags it only when an earlier primitive of the mesh had COLOR_0 (gltf_document.cpp, `has_vertex_color`), so a mesh's first material was left unflagged; the pack writes that material's first triangle as a primitive of its own ahead of the rest, and every material is flagged. |
| `KHR_materials_unlit` | **Tried**: Unshaded. |
| `alphaMode MASK` | **Tried**: Alpha Scissor at the `alphaCutoff` (0.25, 0.5). |
| A sampler's `minFilter` | **Tried**: LINEAR gives the material Filter Linear (no mipmaps used); LINEAR_MIPMAP_LINEAR Linear Mipmaps. The texture is imported with mipmaps either way. |
| `COLOR_0` on a prop | **Tried**: every one of the mess hall's 96 materials Unshaded with Vertex Color as Albedo, 350 of 350 surfaces with colours (before: 29 materials, 61 of 274). Blender 5.2: the same objects, triangles (370 593), lights and box; a vertex colour node in 96 materials (before 29). |
| `KHR_lights_punctual` | **Tried**: the nodes and their counts; energy is the intensity, attenuation 2 (inverse square), shadows off; the lit way's brightness judged against baked (above). |
| `normalTexture`, `TANGENT`, `metallicRoughnessTexture`, `occlusionTexture`, `emissiveTexture` | **Tried** (the lit way): normal map on with the file's tangents, roughness and metallic from G and B, AO from R, emission on. |
| `extras` | **Tried**: node metadata `extras` (since 4.4). |
| A second UV set | Not written. From the source (4.3, 4.7): imported as UV2, used by LightmapGI, not tried. |
