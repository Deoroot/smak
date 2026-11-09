# The art kit (`smak-art-kit/1`)

(Models made by SMAK for the maps, not textures: `h9-street-lamp.mjs`, `h9-metro-car.mjs` and `h9-interiors.mjs` write studio models to `levels/art/h9/models/`, which the dress file names (`models/h9/<name>.mdl`) and the person installs in the game. `h9-interiors.mjs` is the shops' shelves with goods, display tables, crates, sacks, barrel and low cupboard, and the flats' beds, wardrobe, sideboard, stove, chairs, pedestal table and rugs; it also writes `interiors.json`, each model's box, which the dress file's `models` entries copy; the form of each is under Half-Life's own props' 95th in 100 (`node bin/smak.mjs form`), `test/186-interiors-models.mjs` holds it.)

New Byzantium's own textures: what to make, from what, and how the WAD is built. The survey behind it is
`levels/notes-art-kit.md`. Code: `src/maps/texture-recipe.mjs` (general: recipes, relief, weathering, baked light, 256 colours, the
programmer-art measure; any SMAK texture can use it), `levels/lib/art-kit.mjs` (the manifest, the WAD, the sheet,
ambientCG's zips; no network), `levels/tools/art-kit.mjs` (the command line). Tests: `test/133-art-kit.mjs`.

```
node levels/tools/art-kit.mjs check                       # the manifest against GoldSrc's rules
node levels/tools/art-kit.mjs fetch --batch 1             # the CC0 bases into levels/art/cache/ (gitignored)
node levels/tools/art-kit.mjs build --batch 1 [--out dir] [--msr-hue 215] [--offline]
node levels/tools/art-kit.mjs paint                       # the paint list
```

`build` prints each texture's measures and flags, and writes `newbyzantium.wad`, `newbyzantium-sheet.png` (the contact sheet: each texture tiled over 384 x 384
units at scale 1, holes over a teal checker, a 32 x 72 player for scale), `report.json` (brightness, palette error,
how each photo landed, every source with its sha256), `lights.rad` and `png/`. Default `--out` is
`levels/art/out/` (gitignored). The same manifest, bases and parameters give the same bytes.

**Delivery.** `newbyzantium.wad` is a separate file, listed in the map's `.res` and offered to H9 for its client
package; not embedded with `-wadinclude`. Other games' textures (TS, HL, H9's AX/XC/MR, `majestic.wad`) are
named in the map only and never enter this WAD.

## The manifest (`newbyzantium-kit.json`)

```jsonc
{
  "format": "smak-art-kit/1",
  "params": { "msrHue": 270,              // `$msrHue` in a recipe; 270 purple today, ~215 for H9's MSR blue
              "wearMsr": 0.3, "wearMega": 0.65, "wearL3": 0.2, "wearL2": 0.55, "wearL1": 0.85 },  // weather's wear by theme
  "themes": { "msr": "...", ... },        // every texture's theme is one of these
  "bases": {                              // the CC0 photos, by key
    "Marble016": { "provider": "ambientCG", "id": "Marble016", "url": "https://ambientcg.com/view?id=Marble016",
                   "licence": "CC0-1.0", "resolution": "1K", "metres": [2, 2], "note": "...",
                   "maps": ["NormalGL", "Displacement", "AmbientOcclusion"] }   // read too, by the same zip ranges (and Opacity)
  },
  "textures": [
    { "name": "nbm_wall1", "size": [256, 256], "theme": "msr",
      "serves": ["msr-wall"],             // spec materials; role:x (no spec material yet), sign:x, prop:x, decal:x, water:x
      "brief": "...",                     // from the material's look
      "source": { "kind": "cc0", "bases": ["Marble016", "Metal042B"] },
      //   or   { "kind": "cc0", "families": ["Bricks"], "note": "..." }   planned, base still to choose
      //   or   { "kind": "paint", "brief": "for the painter", "bases": [...]? }
      "status": "planned | built | approved | dropped", "batch": 1,
      "recipe": [ { "op": "photo", ... }, ... ],   // only for what the tool makes
      "light": [255, 179, 71, 600],       // a ~ texture's lights.rad line
      "accept": { "repeats": "six equal bars by design" }   // a measured flag this texture means to have, with why
    }
  ]
}
```

**Names** (checked): at most 15 characters, lower case, `[a-z0-9_-]` after one prefix: `{` masked (index 255 is a
hole, pure blue 0,0,255), `~` self-lit, `+0`..`+9` / `+a`..`+j` an animation frame, `!` a liquid. Sides are
multiples of 16, at most 512 (over 256 is warned). Prefixes by theme: `nbm_` MSR set, `nbi_` MSR identity, `nb3_`,
`nb2_`, `nb1_` the layers, `nbp_` props, `nbx_` mega-structure, `nbr_` insurgents, `nbs_` signs, `nbd_` decals,
`!nb_` liquid.

**Density.** One texel is one unit (2.54 cm) at texture scale 1 unless a recipe says `texelUnits`. A base photo
covers `metres` in the world: it is laid as whole repeats when the texture holds at least three quarters of it, else a
seamless crop (the photo's continuation cross-faded over the crop's first 15 %). The report gives each texture's
true metres a texel.

**Recipes** draw at 4x and box down in linear light. Besides colour the canvas keeps a height field (texels), a
detail normal and an occlusion, so the light can be baked the way GoldSrc textures were painted. Ops
(`src/maps/texture-recipe.mjs`, `composeTexture`; full parameters in its header):

| op | what it does |
|---|---|
| `photo` | a base at the texture's density; `detail` takes its normal map into the light, `relief` its displacement into the height, `aoMap` its AO; `stretch` [kx, ky] reads it drawn out (0.1 on y turns its runs into streaks) |
| `fill` | a flat colour (a base under drawn shapes) |
| `panels` | raised (`relief` > 0) or sunk panels with bevel and groove; `vary` { tone, hue, scale, seam, chips }: each panel its own tone, hue, photo scale and place, seams that wander and corners chipped where the photo's own dark falls |
| `lines`, `beams` | strips in relief (inlay, bars); `vary.seam` lets a strip wander off its ruled line by the photo's light and dark; beams make a masked texture solid and wrap so trusses tile |
| `rivets` | domes (or holes, with a negative `height`) along rects' sides |
| `cylinder` | a pipe in a rect: a half-round height across it, lit by the bake |
| `moulding` | a run of moulding from its section (`profile` [[across, height]]), `bands` of other materials (a gold ovolo over a sunk purple fillet) |
| `gradient`, `glow` | a value ramp; a lit lens the bake leaves alone |
| `clear` | a masked texture: all holes until beams and cylinders fill it |
| `alpha` | a masked texture's solid part from a photo (its `Opacity` map, or its luminance): `threshold`, `invert`, `normalise` (the photo's mean set to 0.5 so a faint stain still gives a stain), `shape` { radial, fade } to keep a decal off its edges or fade a plume |
| `weather` | driven by the relief, scaled by `wear` 0-1: `grime` in cavities and at recess bottoms, `streaks` running down from every drawn edge that drops (never from a photo's own grain; `streakWidth`, `streakLength` in texels), `dust` on upward faces, `rust` (`rustPhoto`) in joints and round bolts, worn convex `edges`; where each lands follows the luminance of a photo (`noise`), not made-up noise |
| `bake` | the height and the photos' normals lit by a fixed key from the top left (`key`, `ambient`, `ao`); a flat face keeps its colour |
| `grade` | the whole picture: `saturation`, `maxSaturation`, `harmony` { hue, amount } (every colour pulled toward the theme's), `gain`, `contrast` |

Layer grades: `levels`, `gamma`, `gain`, `saturation`, `colorize {hue, sat}`, `tint`, `mean` (the layer's mean
brightness, 0-1, measured before a panel's own tone so the variation stays). The usual order: photos and shapes,
`weather`, `bake`, `grade`, then lenses. Painted detail is drawn shapes over CC0 photos, never noise.

**The programmer-art measure** (`textureMeasures`, on what the WAD holds; `PROGRAMMER_ART` holds the limits):
`flatShare` (pixels in smooth fields once the photo's grain is blurred away, > 0.3 flags *flat*), `straightEdges` (of
the strong edges, the share on ruler-straight runs of 8 texels, > 0.6 *ruled*), `repeat` (likeness to itself shifted by
a half or quarter side, > 0.8 *repeats*), `saturation` (brightness-weighed, > 0.45 *loud*). A texture's `accept` names
a flag it means to have (bars repeat, a door is ruled) with the reason; `build` lists the rest.

**Colours.** Median cut over the colours at 6 bits a channel, refined by k-means, an optional 4x4 ordered dither
(`dither` 0-1); masked textures keep index 255 for holes. Mips by SMAK's `mipsOf` (a hole where 40 % or less of a
block is solid). The WAD is written by SMAK's `writeWad` and read back with `readWad` before it is kept.

**Sources.** Only CC0 (ambientCG, Poly Haven). The cache keeps each base's colour map as given, and `ledger.json`
(provider, id, licence, page, download, sha256, bytes). Nothing in the cache is tracked.
