# Sprites: glows, flames, explosions and beams made by rule

A sprite (`.spr`) is the flat picture the game turns to the eye: a torch's flame, a glow, an explosion, sparks,
a beam. `smak sprite` builds one from a spec in JSON, or a set of them. Each is made of layers of effects by
rule, cut down to the one palette its format needs, and written. It is then read back, measured against
Half-Life's own of its kind, and drawn as a sheet of its frames and an animated picture.

```
smak sprite torch.json                  each .spr under the spec's folder, at its own name (sprites/torch.spr)
smak sprite torch.json -o <mod folder>  under the mod's folder: <mod>/sprites/torch.spr
```

Beside each `.spr` it writes `<name>-sheet.png` (its frames numbered) and `<name>-animated.png` (an APNG that a
browser plays). The report follows: `ERROR` for a spec that cannot be built, `FAULT` for a check that fails,
`WARN`, then the notes (the render mode to place it with) and the facts (its colours, its border, how it
starts and ends, against Half-Life's own of its class). The exit code is 1 when it is not OK. In a script:
`buildSpriteSpec(spec, { readPicture })` and `validateSpriteSpec(spec)` in `src/sprite/spec.mjs`, and
`writeSpr` in `src/sprite/spr.mjs`, which writes a sprite read by `maps.readSpr` back to the same bytes.

A `reference` picture is read from beside the spec.

## The spec

```json
{
  "spec": "smak.sprite/1",
  "sprites": [
    { "name": "sprites/torch.spr", "class": "fire loop", "size": [32, 64], "frames": 16, "loop": true, "fps": 10,
      "origin": "bottom", "layers": [{ "kind": "fire" }, { "kind": "glow", "at": [0, -0.3], "radius": 0.6, "gain": 0.3 }] },
    { "name": "sprites/blast.spr", "class": "explosion", "use": "tempent", "size": [64, 64], "frames": 16,
      "layers": [{ "kind": "explosion", "env": { "attack": 0.05 } }] }
  ]
}
```

| Field | |
| --- | --- |
| `name` | Its path under the mod, `sprites/...spr`. A sprite the game loads by name keeps that name to replace it |
| `use` | `env_sprite` (unless told), `env_glow`, `tempent` (a muzzle flash, an explosion), `beam`, `hud`. A beam may be lit to its ends (it tiles along its length); anything else keeps its border dark |
| `class` | What it is held against: `explosion`, `fire loop`, `smoke loop`, `smoke puff`, `sparks`, `glow`, `flare`, `muzzle flash` (each frame a flash of its own, all bright: the engine shows one, at random, for one frame), `ring`, `beam` |
| `size` | `[w, h]`, multiples of 8, 256 at most to be drawn as made (512 at most) |
| `frames`, `loop`, `fps` | A loop of `frames` is written with its first frame again at the end, as the engine wraps; an `env_sprite` changes frame at most 10 times a second |
| `type`, `format` | `parallel` (unless told: faces the camera), `upright`, `facing upright`, `oriented`, `parallel oriented`; `additive` (unless told: black is clear), `index alpha` (coverage, tinted by `colour`), `alpha test` (holes), `normal` |
| `origin` | `centre` (unless told), `bottom` (a flame on its base), or `[x, y]` pixels |
| `layers` | Each `{ kind, gain, env: { attack, decay, start }, mask, ... }`, summed: the kinds below. `env`'s shares of the play: `attack` to its peak, `decay` from it, `start` its level at the first frame (0: an explosion that opens on a small flash wants 0.1 or so). Coordinates run -1 to 1 across the longer side; `v` is up. `mask: "reference"` (with a `reference`) keeps a layer inside the reference's lit area, frame by frame: its outline, eased in from 4% to 30% of each frame's brightest (`{ from: "reference", low, high }`), never its colours. A broad layer masked so takes the reference's shape (a cloud that rises off to one side, a flame's tongues) where layers alone do not reach it; the light inside it is still the layer's |
| `finish` | `edge`: pixels faded at the border (2) |
| `reference` | A contact sheet of the sprite this one reproduces (the picture given as input), `"pictures/frames.png"` or `{ picture, cell, cols }` as it was drawn (128 and 8): the report measures this sprite against it. Measures only: nothing of it goes into a frame |

| Layer | Its own fields |
| --- | --- |
| `glow` | `radius`, `core`, `colour`, `at`; `falloff`: `smooth` (unless told: cut to nothing between 0.55 and 1 of `radius`) or `power` (`1 / (1 + (r / core)^power)`, `power` 2, eased to nothing only at `reach`, 1.5: past a square frame's corner, so a lens's glow fills its frame) |
| `flare` | `core`, `colour`, `at`, `streaks: [{ angle, length, width, half, gain, taper, blur, haze }]` (`half`: out from the core along `angle` only); for every streak unless it says, `taper` (that many times its width wider toward its middle: a wedge), `blur` (a Gaussian across, the light spread and not lost), `haze` (a faint glow four times as wide under the arm); `rays: { count (48), length (0.9), jitter (0.5), width (0.012), gain (0.5) }`: many thin half streaks round it of seeded lengths, a lens flare's fine rays |
| `fire` | `ramp`, `width`, `rise`, `turbulence`, `height`; `taper` (0.65: how much narrower at its top; 0 no cone), `tongues` (0 to 1: noise four times as tall as wide, rising with the flame and cut at a level that climbs with height, so it parts into licks with dark between) |
| `smoke` | `density`, `spread`, `colour`, `rise` |
| `explosion` | `ramp`, `growth`, `cool`, `turbulence`: a ball, unlit |
| `billow` | A lit cloud: `count` (24) spheres in a disc of `spread` (0.5) about `at`, each `size` (0.3) or so, carried out as it grows (`growth`), rising (`rise` 0.25) and drifting (`drift` 0.12); their front joined smoothly (`blend` 0.4; 0 a crease), its edge lumpy (`lumps` 0.4), lit from the top left (`light`), coloured by heat times light through `ramp` (`blast`), a white middle early (`hot`: 0.4 of its life), cooling (`cool`); `dissolve` (0.7) breaks it into wisps as it ages; `debris: { count, speed, gravity, trail }` throws flecks. Under `index alpha` its light is in its coverage (a puff keeps its shading) |
| `blobs` | `count` (9) soft discs placed afresh every frame round a core (`radius` 0.32, `spread` 0.6, `core` 0.4, `soft` 0.5): sparks' flicker, nothing to follow from frame to frame |
| `sparks` | `count`, `speed`, `gravity`, `trail`, `colour` |
| `ring` | `from`, `to`, `width`, `colour` |
| `beam` | `core`, `noise`, `colour`; `profile`: `round` (unless told) or `flat` (full across `core` of the width, then soft shoulders `shoulder`, 0.3, wide); `streaks` (0 to 1: mottling that changes across the beam and hardly along it, still tiling end to end) |

`ramp` (on `fire`, `explosion` and `billow`; on `glow`, `flare`, `beam` and `blobs` it colours the light by its
own brightness, a white middle to a dark rim, in place of `colour`): `fire`, `blue`, `green`, `blast` (white,
cream, tan, brown: an explosion's smoke) and `muzzle` (white, peach, tan), or a list of `[heat, [r, g, b]]`
stops. `blast` and `muzzle` are the mean colours of Half-Life's own explosion and muzzle flash at each tenth of
brightness. With a `reference`, `"ramp": "reference"` is the reference's own colour at each brightness, read off its
sheet, frame by frame where it has several (an explosion white at its height and orange as it cools, at one
brightness): give it whenever the sprite copies a picture of one, so that a halo is the original's peach and not a
violet read from a description.

The report gives each sprite's colours, the border's light, how it starts and ends, how smoothly a loop wraps
and how much it flickers, each against Half-Life's own of its class, and the render mode to place it with.
With a `reference`, it gives the judge's measures of both, each read off a sheet of the same drawing: mean
colour (delta E; 15 or under is near), the share that is dark (within 0.05 is near), the border's light and the
frame count, its shape frame by frame (the share of lit pixels both have) and its hot middle (its brightest, and
the pixels over 0.7), with a warning for each that is off: a colour over 15, a shape under 0.8 (where the judges
stop giving a shape full marks), a middle half again as large as the reference's or 0.15 brighter (a glow's core
too large reads at once to the eye), or under two thirds its size (a flare's core half as wide, which the shape's
mean over its levels did not see), its brightest frame more than 0.08 of its play from the reference's or its first
frame 0.2 brighter or fainter, its light frame by frame (over its brightest) more than 0.08 from the reference's on
average or 0.25 at any frame (a puff that grows three frames slower to the same peak, a flame that holds its light
where the reference's sinks), naming the frames, and its light at the border 0.08 short of or past the reference's (a halo that falls
off too soon, or spills). A loop with a reference starts at the frame where its light over the loop follows the
reference's, and of the starts that follow it nearly as well, the one that puts its brightest frame where the
reference's is: a loop has no first frame of its own. An additive sprite made a one-shot against a reference still lit
at its last frame (a one-shot ends dark) is told to loop, and a loop against one that starts and ends dark, not to. Build until they are gone, not only until `OK`. A light of one colour (a
white glow) is written as 255 steps of that colour, so its falloff shows no bands.
FAULTs: a loop that jumps at its wrap, a one-shot that does not end dark, light at the border.

**A sprite someone else made.** A glow added to the world (an `env_glow`, an entity in render mode 3 or 5, a
sprite whose own format is additive) must be black outside the circle inscribed in its frame: a stock sprite's
"black" corners are often 1 to 7 of 255, which Xash's texture gamma and a dark night lift into a faint square round
the glow. `smak map-check <bsp> --game <folder>` measures each such sprite's corners (`maps.spriteBorder(sprite)`:
`{ corners, lit, share, max }`) and warns when 2% or more are lit, up to 2 or more of 255. `smak sprite` builds a
glow whose border is 0 by itself; use one of those (colour from the entity's `rendercolor`) in its place.

**An additive glow sprite on Xash can come out as a saturated square.** Seen in a game built on Xash3D: `env_glow`
entities in additive mode (rendermode 5) with an otherwise correct sprite (black corners, a radial falloff) were drawn as
big rounded squares, and the entity's `rendercolor` was ignored, so a red pulse showed white. Prefer a light that needs
no sprite: a texture light (a fullbright lens in the model or the brush), or a `light` entity for the light on the floor.
For a halo, try `kRenderGlow` (rendermode 3, renderfx 14) and test it in the game; that mode has not been tested here. A
map's dress can turn the sprites off (`glows: false` in the dress file) while its lights stay.
