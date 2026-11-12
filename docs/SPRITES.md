# Sprites: the .spr file read and written

A sprite (`.spr`) is the flat picture the game turns to the eye: a torch's flame, a glow, an explosion, sparks,
a beam. The kit reads and writes the file; it does not make sprites (the sprite spec and its effects by rule left in
0.39, with the generators). Its map pictures draw the sprites a map names (`smak map-view --game`), and
`smak map-check --game` warns of a glow sprite whose border is not black (it draws a faint square).

```js
import * as smak from "file:///C:/path/to/smak/src/index.mjs";
const sprite = smak.maps.readSpr(readFileSync("glow.spr"));   // { type, format, palette, frames, groups, radius, ... }
writeFileSync("glow2.spr", smak.maps.writeSpr(sprite));       // the same bytes back
```

- `readSpr(bytes)` (`make/maps/sprites.mjs`) → `{ type, format, radius, beam, sync, palette, frames: [{ left, up,
  width, height, pixels }], groups }`; `spriteFrameRgba(sprite, n)` a frame as a picture, by its format.
- `writeSpr({ type, format, palette, frames, groups, radius, beam, sync, colours })` (`make/sprite/spr.mjs`): the
  file, as the engine reads it. `type`: `parallel` (faces the eye, the default), `upright`, `oriented` and the rest;
  `format`: `additive` (a glow, fire: black is nothing), `alpha test` (the last colour is a hole), `normal`,
  `index alpha`. A frame's `pixels` are indices into the palette of 256 colours (768 bytes). Half-Life's own
  sprites, read and written, come back byte for byte (62-sprites.mjs, where the game is installed).
