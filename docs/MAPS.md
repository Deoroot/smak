# SMAK and maps: reading a compiled map

Everything here is exported from `src/maps/index.mjs`. A map is a Node `Buffer` holding the whole `.bsp` file;
`readBsp` gives a plain object over it, and the functions below take that object. A function that changes a map
returns a **new** buffer. Apart from `wadsFor` and `texturesFor` (and the pictures and `decompile`, when they
are given `folders`), which look for files in folders you name, nothing here touches the disk.

```js
import { readFileSync, writeFileSync } from "node:fs";
import * as maps from "./smak/src/maps/index.mjs";

const bytes = readFileSync("gatecity.bsp");
const bsp = maps.readBsp(bytes);
const start = maps.byClass(bsp.entities, "info_player_start")[0];
console.log(maps.contentsName(maps.contentsAt(bsp, maps.originOf(start))));   // "empty"

const moved = maps.moveEntity(bsp.entities, start, [96, 96, 40]);
writeFileSync("gatecity_moved.bsp", maps.withEntities(bytes, moved));          // never over the original
```

This page covers reading a compiled map, its textures and `.wad` files, changing its entities, and drawing
it ("Pictures", which also draws brush source). Writing brush source (`.map`) and compiling it are the other
half of `src/maps/`, in `docs/MAPS-MAKING.md`. The command line has a command for most of this: `smak map-info`,
`map-check`, `map-entities`, `map-set`, `map-plan`, `map-view`, `map-views`, `map-compare`, `map-reach`, `map-section`,
`map-storeys`, `map-openings`, `map-measure`, `map-waypoints`, `map-textures`, `wad`, `wad-make`, `map-compile` and `map-decompile` (`node bin/smak.mjs help`;
`docs/COMMANDS.md` has them all, and `docs/MAPS-LOOKING.md` the recipes for looking at a map and changing it).

## What a compiled map is

A `.bsp` of GoldSrc is version 30: four bytes that say so, then a table of fifteen **lumps** (where each
begins and how long it is), then the lumps. Quake 1's maps are version 29 and Quake 3's begin with the letters
`IBSP`: other formats, refused in words. The engine finds every lump through the table alone; the lumps may lie
in any order.

| Lump | What it holds | In `readBsp`'s result |
| --- | --- | --- |
| `entities` | Text: every entity as `{ "key" "value" ... }`, the world itself first | `entities` |
| `planes` | The planes the world is cut by | `planes` |
| `textures` | The names and sizes of the textures, and the pixels of those kept inside the map | `textures` (the directory) |
| `vertices`, `edges`, `surfedges` | The corners of the faces: a face walks a run of surfedges, each an edge, each two vertices | `vertices`, `edges`, `surfedges` |
| `faces` | The polygons that are drawn | `faces` |
| `texinfo` | How a texture lies on a face: two axes and two offsets | `texinfo` |
| `lighting` | The baked light, three bytes a sample | read by `faceLightmap` |
| `nodes`, `leaves` | The tree the drawn world is cut into: a node is a plane with a child on each side, a leaf is a convex room of space with one **contents** | `nodes`, `leaves` |
| `marksurfaces` | For each leaf, the faces that touch it | `marksurfaces` |
| `visibility` | For each leaf, the leaves that can be seen from it, packed | read by `visibleFrom` |
| `clipnodes` | Three more trees, for what a moving box bumps into | `clipnodes` |
| `models` | Model 0 is the world; each of the others is the brushes of one entity (a door is `"model" "*7"`) | `models` |

**Units and axes.** A unit is about an inch; `+z` is up. A player is 72 tall and 32 wide.

**Contents.** What a leaf holds, in `CONTENTS`: `EMPTY` -1, `SOLID` -2, `WATER` -3, `SLIME` -4, `LAVA` -5,
`SKY` -6, then the water currents (-9 to -14), `TRANSLUCENT` -15 and `LADDER` -16. `ORIGIN` -7 and `CLIP` -8
are used up by the compiler and are not in a compiled map. `contentsName(n)` puts a number in words. Everything
outside the map is solid, and every solid place is the one leaf 0.

**Hulls.** The engine does not move a box through the world: it moves a point through a copy of the world in
which every wall was grown by half the box. A map carries four such copies, `HULLS`:

| Hull | For | The box |
| --- | --- | --- |
| 0 | a point: a bullet, a line of sight, the drawn world itself (the nodes and leaves) | none |
| 1 | a standing player | 32 x 32 x 72 |
| 2 | a large monster | 64 x 64 x 64 |
| 3 | a crouching player | 32 x 32 x 36 |

So "can a player stand here" is `contentsAt(bsp, middleOfThePlayer, { hull: 1 }) !== CONTENTS.SOLID`, with the
middle 36 units over the feet. Hulls 1 to 3 know only solid and not solid as a rule, and they hold what the
mapper's invisible `clip` brushes block, which hull 0 does not.

**Brush entities.** A door, a grate, a `func_wall` has its own model, with its own little tree, in the model's
own space. It is **not** in the world's tree: `contentsAt` over the world says a doorway is empty though a
closed door stands in it. Ask the model (`{ model: n }`), taking the entity's `origin` from the point first.

**How textures are found.** The map's texture directory names every texture and gives its size. For each, the
pixels are either inside the map (`embedded`: four sizes of palette indices and a palette of 256 colours) or
left out, and then the engine looks for the name, whatever its case, in the `.wad` files that the worldspawn's
`wad` key lists. That key holds paths from the mapper's machine, joined by `;`: only the file names count, and
they are looked for in the mod's folder and then in `valve`. GoldSrc opens **every** listed file when a map
wants even one texture from outside, and stops with an error when one is not there; it never looks in
`pldecal.wad` or `tempdecal.wad`. A texture's name says what it is (`{` holes, `!` a liquid, `sky`, `+0` an
animation...): the table is in `docs/MAPS-MAKING.md`, "Textures", and `textureKind(name)` reads a name. Both
sides of a texture are multiples of 16.

**Light.** Each lit face has a small picture of light, one sample for every 16 units along its texture's axes.
Its size is nowhere in the file: it is worked out from the face's corners (`lightmapSize`). A face can be lit
by up to four **light styles**, and keeps one such picture for each, one after another. Style 0 is the light
that is always on. Styles 1 to 11 are the game's patterns that flicker and pulse (a `light` entity's `style`
key); from 32 up, the compiler gives a number to each group of lights that carry a `targetname`, so that a
switch can turn them on and off. The game multiplies each style's picture by how bright that style is at the
moment and adds them up. 255 in a face's list means "no style here". The samples are what the compiler wrote,
before the engine's gamma: what the game shows is brighter than these bytes read as plain colours.

**Visibility.** For each leaf the compiler (hlvis) works out which other leaves could possibly be seen from
anywhere inside it; the engine draws only those. A map compiled without it, or with a leak, has none, and the
whole map is drawn from everywhere.

## Reading (`src/maps/bsp.mjs`)

| Function | Gives |
| --- | --- |
| `readBsp(bytes)` | `{ bytes, version, blueShift, lumps, entities, planes, vertices, edges, surfedges, faces, texinfo, textures, models, nodes, leaves, marksurfaces, clipnodes }`. Throws, in words, unless the file is a whole GoldSrc map. The shapes are below. |
| `contentsAt(bsp, point, { hull = 0, model = 0 })` | The contents at `[x, y, z]`: a number of `CONTENTS`. `hull` 0 to 3; `model` the map's model to ask. |
| `contentsName(n)` | `"empty"`, `"solid"`, `"water"` ...; `"unknown (n)"` for a number the format does not name. |
| `leafAt(bsp, point, model = 0)` | The number of the leaf a point is in. 0: solid. |
| `floorUnder(bsp, point, { hull = 0, model = 0, reach = 4096 })` | The `z` at which solid begins straight under the point, to a 64th of a unit; `null` when the point is in solid or nothing is found within `reach`. With hull 1 it is where a standing player's middle rests: his feet are 36 lower. It does not know of brush entities (a crate, a bridge that is a `func_wall`): ask their models too. |
| `worldBounds(bsp)` | `{ mins, maxs }` of the world. |
| `modelFaces(bsp, model = 0)` | The faces of one model: the world's, or a brush entity's. |
| `facePolygon(bsp, face)` | A face's corners `[[x, y, z]]`, clockwise as seen from the side it looks to. `face` is one of `bsp.faces` or its number. Three corners in a row can lie on one line (the compiler adds corners where a neighbour's edge ends). |
| `faceNormal(bsp, face)` | The way it looks: its plane's normal, turned about when `face.side` is not 0. |
| `faceTexture(bsp, face)` | The directory entry of its texture. |
| `faceTexels(bsp, face)` | Each corner's place on the texture in pixels from its top left, `[[s, t]]`; past the picture's sides where it repeats. |
| `faceUvs(bsp, face)` | The same as the kit's `uv`: `[[u, v]]`, 1 for one turn of the texture. |
| `hasLightmap(bsp, face)` | Whether it has baked light. Sky and liquids have none; nor has a face whose styles are all 255, even where its `lightOffset` looks good (the compiler leaves a stale one). |
| `lightmapSize(bsp, face)` | `{ width, height, originS, originT }`: samples across and down, and the texture pixel the first stands on. |
| `faceLightmap(bsp, face)` | `{ width, height, originS, originT, styles: [{ style, rgb }] }`, or `null`. `rgb`: `width * height` samples of three bytes, a view of the map. The sample for texture pixel `(s, t)` is at `((s - originS) / 16, (t - originT) / 16)`. |
| `visibleFrom(bsp, leaf)` | The numbers of the leaves seen from a leaf, itself among them; `null` when the map keeps none for it (then everything is drawn). |
| `sees(bsp, from, to)` | Whether one leaf is seen from another. |
| `embeddedTexture(bsp, which)` | A texture whose pixels are in the map (see "A map texture"), or `null` when it is wanted from a `.wad` or the map has no texture of that name. `which`: its number or its name (a number it has none for is refused). |
| `wantedTextures(bsp)` | `{ wads, textures }`: the `.wad` file names the worldspawn lists, as the engine looks for them, and the names of the textures left to them. |

What `readBsp` gives, entry by entry:

| | |
| --- | --- |
| `lumps` | `{ entities: { name, slot, offset, length, inside }, ... }` for all fifteen |
| `entities` | A list; each entity is a list of `[key, value]` pairs in the file's order (see "Entities") |
| `planes` | `[{ normal, dist, type }]`: the points `p` with `normal . p = dist` |
| `vertices`, `edges`, `surfedges` | `[[x, y, z]]`, `[[vertex, vertex]]`, `[edge, or minus an edge walked backwards]` |
| `faces` | `[{ plane, side, firstEdge, edgeCount, texinfo, styles: [4], lightOffset }]` |
| `texinfo` | `[{ s: [x, y, z, offset], t: [x, y, z, offset], texture, flags }]`; flag 1: sky or liquid, not lit |
| `textures` | `[{ index, name, width, height, embedded, absent, at }]`. `absent`: the map leaves the entry empty |
| `models` | `[{ mins, maxs, origin, headNodes: [4], visLeaves, firstFace, faceCount }]` |
| `nodes` | `[{ plane, children: [front, back], mins, maxs, firstFace, faceCount }]`; a child under 0 is leaf `-1 - child` |
| `leaves` | `[{ contents, visOffset, mins, maxs, firstMarkSurface, markSurfaceCount, ambient: [4] }]` |
| `marksurfaces` | `[face]` |
| `clipnodes` | `[{ plane, children: [front, back] }]`; a child under 0 is a contents |

`blueShift` is true for a map laid out as those of Half-Life: Blue Shift, whose header has the entities and the
planes changed over. It is read like any other, and `withEntities` writes into the right place.

Also exported: `CONTENTS`, `HULLS`, `LUXEL` (16), `ENTRY_SIZES` (the bytes of one entry of each lump),
`LUMP_NAMES`, and from `lumps.mjs` `locateLumps(bytes)` (the table alone; a lump outside the file is marked
`inside: false` and not thrown for) and `lumpBytes(bytes, lump)` (a lump's bytes, for what the kit does not
read).

## A map texture (`src/maps/miptex.mjs`)

`{ name, width, height, pixels, palette, mips, holes }`: `pixels` is one palette index a pixel at full size,
`palette` 768 bytes, `mips` the four sizes (`mips[0]` is `pixels`; then a half, a quarter, an eighth), `holes`
whether index 255 is see-through. It is the kit's texture with the smaller sizes added, so `rgbaOf` and `bmp`
of `image.mjs` take it as it is.

| Function | Gives |
| --- | --- |
| `textureRgba(texture, level = 0)` | `{ width, height, rgba }` of one of its sizes; a hole has alpha 0. `png(width, height, rgba)` writes it. |
| `textureKind(name)` | `{ holes, sky, water, animated, frame, random, lit, tool }`, from the name. |
| `mapTexture(source)` | A map texture from `{ name, image }` (an image `{ width, height, rgb }` or `{ width, height, rgba }`, cut down to 256 colours; to 255 and holes for a `{` name) or from `{ name, width, height, pixels, palette }`, kept index for index. Makes the smaller sizes. Throws for a side that is not a multiple of 16 and for a name over 15 letters. |
| `mipsOf(texture, holes?)` | The four sizes, shrunk from the full one: each smaller pixel is the palette's nearest colour to the mean of its block. With holes, a block in which 40% or less is solid is a hole. This is not the games' tool to the pixel: against their own `.wad` files it picks the same index for a third of the pixels and is within about 4 levels in 255 a channel on average. |
| `readMiptex(bytes, at)`, `writeMiptex(texture)`, `miptexHeader(bytes, at)`, `miptexSize(width, height)` | The texture's bytes as a map or a `.wad` keeps them, read and written. |

## Texture files (`src/maps/wad.mjs`)

| Function | Does |
| --- | --- |
| `readWad(bytes)` | `{ textures, others }`: every map texture of a WAD3 file, in its order, and what else it holds (`[{ name, kind }]`: menu pictures, fonts, sprays; not read). The pixels are views of `bytes`. Throws for Quake's WAD2 and for anything else. |
| `textureFromWad(wad, name)` | One texture by name, whatever its case, or `undefined`. `wad`: the file's bytes, or what `readWad` gave. |
| `writeWad(textures)` | A `.wad` file's bytes from `[{ name, image }]` or `[{ name, width, height, pixels, palette }]` (what `mapTexture` takes). A name given twice is refused. |
| `listedWads(value)` | The file names in a worldspawn's `wad` value, as the engine looks for them: lower case, no path, `.wad` put on, the two decal files left out. |
| `mapOwnFolders(file)` | The folders a map's own path says to look in for its `.wad` files: its folder, and for a map in a mod's `maps/`, the mod's folder over it, where the game looks. The command line and the MCP server add them after the game's folders. |
| `wadsFor(bsp, folders)` | `{ found: [{ name, path }], missing: [name] }`: where the map's listed `.wad` files are, in the folders given, in that order (the mod's own, then `valve`). |
| `texturesFor(bsp, folders, { pixels = false })` | `{ wads, textures: [{ name, wad, path, texture? }], missing: [name], unreadable }`: every texture the map wants from outside, in the first listed file that has it. With `pixels`, each brings its `texture`. |

To give a map textures made with the kit: `writeFileSync("mine.wad", writeWad([{ name: "mywall", image }]))`,
name `mine.wad` in the `.map`'s `wad` key, and compile.

## Entities (`src/maps/entities.mjs`)

An entity is a list of pairs, `[["classname", "light"], ["origin", "96 96 104"]]`, in the file's order: a map
may give a key twice, and the game reads both. `bsp.entities[0]` is the worldspawn. The compilers write an
entity's `classname` last.

An entity that was read and not changed is written back as the very text it was read from. So a map whose
entities are read and written with nothing changed is the same file, byte for byte (held on 466 maps of the
games). A changed or new entity is written in the compilers' own form, one pair a line.

| Function | Gives |
| --- | --- |
| `parseEntities(text or bytes)` | The list. What follows the first zero byte is not read. `readBsp` has done this: use `bsp.entities`. |
| `writeEntities(entities)` | The text, with no zero byte after it. |
| `entityLump(entities, terminator = "\0")` | The lump's bytes. |
| `valueOf(entity, key)` | Its value, the first when given twice; `undefined` when not given. |
| `valuesOf(entity, key)` | Every value it gives for the key. |
| `numberOf(entity, key, otherwise?)` | The value as a number. |
| `vectorOf(entity, key)` | `"96 96 40"` as `[96, 96, 40]`, or `null`. |
| `originOf(entity)` | Where a point entity is. For a brush entity: how far it is shifted from where it was compiled, or `null`. |
| `anglesOf(entity)` | `[pitch, yaw, roll]` in degrees, from `angles` or the older `angle` (-1 up, -2 down). |
| `brushModelOf(entity)` | The number of its model (`"*7"`: 7), or `null` for a point entity. |
| `isBrushEntity(entity)` | Whether it is made of brushes: the worldspawn, or one with a `*N` model. |
| `asObject(entity)` | `{ key: value }`, for reading; of a key given twice, the first. |
| `byClass(entities, classname)` | The entities of a class: the whole name, or a RegExp. |
| `byKey(entities, key, value?)` | Those that have the key, or give it that value. |
| `byModel(entities, n)` | Those made of the map's model `n`. |
| `worldspawn(entities)` | The map's own entity. |

Changing. Each returns a **new list** and leaves the one given alone; `which` is an entity of the list or its
number. After a change, take entities from the new list.

| Function | Does |
| --- | --- |
| `setKey(entities, which, key, value)` | Sets a key: the first pair of that key where it stands, or a new pair at the end. `value`: text, a number, or `[x, y, z]`. A quote in a key or a value is refused (the text cannot hold one), and so is a value over 1023 letters. |
| `removeKey(entities, which, key)` | Takes out every pair of that key. |
| `moveEntity(entities, which, [x, y, z])` | Puts a **point** entity elsewhere. A brush entity is refused: `setKey(..., "origin", ...)` shifts one from where it was compiled, with the light it was compiled in. |
| `addEntity(entities, classname, origin, keys?)` | One more point entity at the end. `origin` may be `null`; `keys` an object or a list of pairs. It may be given the `*N` model of a brush entity that is in the map (the same brushes shown twice), not one the map does not have. |
| `removeEntity(entities, which)` | Takes a **point** entity out. A brush entity is refused, with the reason: its model would stay in the file, faces, collision and light, with nothing to show or move it. To hide one, set `rendermode` 2 and `renderamt` 0: it still blocks the way, and that is hiding, not removing. |
| `withEntities(bytes, entities)` | The map with these entities: new bytes. |

**What `withEntities` writes.** Only the entity lump and the two numbers of the header that say where it is and
how long. Text no longer than the old goes in the old one's place, and what is left over of that place is
zeroed. Longer text goes to the end of the file, on a multiple of four bytes, and the old place is zeroed
(unless the entity lump was already the last thing in the file: then it grows where it is). No other lump
moves or changes by a byte. Both engines find lumps by the header alone, so this is safe; the checksum by which
a server tells that a player has the same map leaves the entity lump out in both, so a map with changed
entities still matches the original. Because longer text leaves a zeroed gap behind, start each change from
the original file, as with models, not from your last output.

One thing is refused: a map that carries a block of extra lumps after its own (`BSPX`, written by a few newer
compilers) cannot take longer entity text, because Xash finds that block by where the last lump ends.

A changed map is not a recompiled one. Lights are baked: moving or adding a `light` entity changes nothing that
is seen. Visibility and collision are baked too. What does take effect is everything the game reads at run
time: where things and monsters stand, what they are, their keys, targets and scripts.

## Pictures (`src/maps/draw.mjs`)

A map that reads and checks can still be dark, or have a door in the wrong wall. These draw it, with the kit's
own arithmetic (no browser, no GPU; a 640 x 480 view of a map of 15000 faces takes about a tenth of a second).
Each returns `{ width, height, rgba, facts }`: a picture as `render` gives one of a model
(`png(width, height, rgba)` writes it), and `facts`, what was drawn in numbers and sentences. **Look at the
picture**, and read `facts.notes`.

```js
import { readFileSync, writeFileSync } from "node:fs";
import { maps, png } from "./smak/src/index.mjs";

const bsp = maps.readBsp(readFileSync("gatecity.bsp"));
const game = { folders: ["C:/games/Half-Life/msc", "C:/games/Half-Life/valve"] };   // where its .wad files are
const plan = maps.planOf(bsp, game);                                               // from above: where everything is
writeFileSync("plan.png", png(plan.width, plan.height, plan.rgba));
const view = maps.drawMap(bsp, { ...game, from: [-191, -802, -433], yaw: 90 });     // from inside, as the game lights it
console.log(view.facts.notes, view.facts.missing, view.facts.brightness);
```

| Function | Draws |
| --- | --- |
| `drawMap(bsp, { from, to | yaw, pitch, fov, width, height, light, brightness, textures, folders, entities, labels, bodies, models, modelScale, sprites, sky })` |\| yaw, pitch, fov, width, height, light, brightness, textures, folders, entities, labels, bodies, models, sky })` | A view from a point inside the map, 640 x 480: textured, lit by the map's own lightmaps, `{` textures with their holes where the game gives them, liquids of the world letting the bottom show, brush entities where their `origin` puts them, and what stands (a start, a monster, an NPC) as the box it moves with, at its true size. With `folders`: the sky as its own picture and each sprite as its first frame; with `models` too, each named model with its textures. Without `from`: from the first place to start, at eye height, the way it faces. |
| `planOf(bsp, { z, slice, scale, width, height, area, entities, labels, legend, heights, reach, only, ... })` | The map from straight above, `+y` up the picture and `+x` to its right: floors (their texture's mean colour under the map's light), walls as lines, every point entity a dot in the colour of its kind (with the outline of its box, when it stands), every brush entity outlined, a scale bar and a north arrow. With `z`: a cut at that height, what is solid there filled in one colour (a storey's floor plan, doorways open). `heights`: each floor's height written on it. `legend`: the entities listed beside it. `reach`: the walk test tinted on it. |
| `viewsOf(bsp, { count, at, aim, landmark, width, height, cols, ... })` | Several views in one picture, each named in its corner: from the places to start, and from the middle of the largest rooms looking four ways. An overview in one call. `aim`: views aimed at what the map has come next (`aimedStands`), and the rooms' level views the most open first, one facing a wall within 256 only when no other is left; `landmark` (an entity's number, targetname or class) is among them. Places to start that stand together (each within 256 units of another: a row of them for many players, one for each map a player arrives from) are one group and get ONE view, from the first, named `1 ms_player_spawn +5`, with the others' boxes left out of it (`facts.starts`). A view that is nearly one colour (nine tenths of it, and not for want of light) is left out and the next largest room shown in its place (`facts.dropped`, and a note); with no room left, it stays and is said. `at`: views of your own, drawn as asked. |
| `aimedStands(bsp, { landmark })` | Places to look from at what a map has, each `{ from, to, name }`: the landmark asked for (unless told, an entity named `landmark`, the `info_target` a map spec's `focus` leaves over its landmark; a landmark's view also needs a clear line to its body, 48 lower, so a rail before it does not hide it), its largest water, its largest brush entity that stands, its largest cluster of lamps (faces wearing a lamp's texture, `lampsOf`), its largest cluster of monsters and items, and a room on each storey but the lowest. Each from a player's eye over a floor 192 to 512 away with a clear line to it. The views a judge and a maker see of a map (the original mod's judging, the MCP's map `views`, a map spec's `features` picture) are aimed so: a judged pump hall had its water, catwalks and bridge in none of its level views |
| `texturePlaces(bsp)`, `placeView(bsp, place, { textures, folders, brightness })` | Each texture of the world at its largest face lit in every colour (else its largest lit, else its largest), with a camera square in front of it that stays inside the room: `{ name, width, height, from, yaw, pitch, area, lit, light: [r, g, b], across, up, turned, wall }`. `light` is the face's mean steady light as a view at `PLACE_BRIGHTNESS` (4.5) lays it on a texel; `across` the texels a view spans; `turned` the picture's top against up (a wall) or north. `placeView` draws one: what the reproduction test's judge, and the wad spec's `preview.each`, look at |
| `matchTextures(picture, rect, textures, { count })` | The textures of a .wad (`readWad(...).textures`) most like a patch `[x, y, w, h]` of a picture, by their colours with the brightness divided out: `[{ name, width, height, distance }]`, nearest first. Candidates to look at, not a verdict (`src/maps/match.mjs` gives what it finds and what it cannot) |
| `faceTextureAxes(bsp, face)` | `{ s, t }`: how a face lays its texture, each `[x, y, z, offset]` |
| `compareOf([{ map, name, z, ... }], { scale, cols, width, height, entities, ... })` | Several maps from above in ONE picture at ONE scale, each under its name and the size of its world (`3424 x 1760 x 384  cut at z 100`), with one scale bar under them all: is the new map the size of the game's? Each entry is a compiled map or source, or an object with what its own plan takes (`z`: the height ITS plan is cut at, unset for one seen from above; `slice`, `area`, `heights`, `reach`). Without `scale`: the largest at which all fit 1920 x 1080. No entity is marked unless `entities` says. `facts.maps`: each plan's `left`, `top`, `x0`, `y0`, so that a point is at pixel `(left + (x - x0) * scale, top + (y0 - y) * scale)`. |
| `drawSource(map, { from, to \| yaw, pitch, ... })` | A view of brush source (what `writeMap` takes and `readMap` gives), with no compile: each face one flat colour by its texture's name, shaded by the way it looks, its edges drawn. |
| `planOfSource(map, { z, scale, area, entities, labels })` | The plan of brush source: a cut through its brushes at `z` (the first start's height unless told), entities marked as on `planOf`. |
| `viewFrom(bspOrMap, which)` | `{ from, yaw, pitch, name }` for a view from an entity: its number, or a classname. A place to start is looked from 28 over its origin, a player's eyes. |
| `sectionOf(bspOrMap, { from, to, z, scale, width, near, labels, heights, bodies })` | A side section: an upright cut along the line from `[x, y]` to `[x, y]`. Solid in one colour, open space dark, a light line on every floor with its height under it (`z 64`), the heights ticked down the left edge, the brush entities the line passes through, the point entities within `near` (64) of it, those that stand as their box. |
| `storeysOf(bspOrMap, { z, width, height, cols, reach, ... })` | The storeys side by side: one plan for each, cut at its own height, every floor's height written on it, each marking the entities of its own storey. The cuts are found (`storeyCuts`) unless `z` lists them. |
| `openingViews(bspOrMap, { reach, count, both, width, height, cols, ... })` | A view through each gate and doorway the walk test found, from the floor before it at a player's eyes. |
| `figuresOf(things, { bodies, models, folders, modelScale })` | What each point entity is drawn as: its box, and with `models` its model's triangles, each a surface with its texture. The pictures call it; it is there for a picture of your own. |
| `spritesOf(things, { folders })`, `boardOf(sprite, view)`, `readSpr(bytes)` | The sprites of a map's entities, a sprite's board for one view, and a `.spr` file read (`src/maps/sprites.mjs`). |
| `skyOf(name, folders)`, `skyColour(sky, x, y, z)`, `readTga(bytes)` | The six sides of a sky, its colour along a way out of the eye, and a Targa picture read (`src/maps/sky.mjs`). |
**Angles.** `yaw` 0 looks along `+x` (east) and turns anticlockwise seen from above: 90 looks along `+y` (north).
`pitch` over 0 looks up, under 0 down. `to: [x, y, z]` looks at a point instead. `fov` is degrees across (90; a
game at 16:9 shows about 106).

**Where a point is on a plan.** `facts.scale` is pixels a unit, `facts.x0` the world's x at the picture's left
edge and `facts.y0` its y at the top: a point `(x, y)` is at pixel `((x - x0) * scale, (y0 - y) * scale)`.
`facts.marks` lists every entity that was marked with its number, class, kind, origin and pixel (`at`). A map
with more than 60 marks labels only its places to start: `area: { min: [x, y], max: [x, y] }` draws a part of
it closer, `labels: true` labels all that fit.

**True sizes.** A dot says where a thing is, and nothing of whether it fits there. A place to start, a
monster and an NPC are drawn as the box they move with: 32 x 32 x 72, the standing player's, unless `bodies`
says otherwise (`bodies: { msmonster_troll: "large" }`: 64 x 64 x 64; by classname or targetname; `"crouching"`,
or `{ half, height, feet }` for a box of its own). In a view it is a box that stands on the floor, hangs over
it or goes into it; on a plan and on a section, its outline. `facts.marked` (a view) and `facts.marks` (a
plan) give each one's `size`. A place to start has its origin at the middle of its box; a monster or an NPC is
taken to have it at its **feet**, as Half-Life's monsters have. Master Sword's own maps put their people 16 to
60 over the floor (measured on `edana`), which fits an origin at the feet and a drop to the floor as they
appear: the kit has not seen that in the game, and `bodies: { ms_npc: { half: 16, height: 72, feet: 36 } }`
says otherwise where you know better.

**Models.** `models: true` with `folders` (the game's: the mod's own, then `valve`) draws an entity whose
`model` key names a `.mdl` as that model: read from the folders (with its `t.mdl` when its textures are kept
apart) and stood at the entity's feet as the entity's own keys say: turned by its `angles` (all three: the
engine's own arithmetic, in which a pitch over 0 lifts a model's front), in its `body` and `skin`, in the
first frame of its `sequence` (the first animation unless told; `frame` names another), at its `scale`.
Each triangle wears its texture, the nearest pixel of it, and is seen from its front only, as the game draws
it. A **masked** texture (the model's flag for it: its last palette colour is a hole) has its holes: a tree's
crown is leaves and air, and what stands behind it shows through. An **additive** texture is added to what
is behind it and hides nothing; a chrome one is drawn in its mean colour. An entity's own `rendermode` and
`renderamt` fade the whole model as they fade a brush entity. `models: { keeper: "models/npc/human1.mdl" }`
names a model for an entity that names none (a monster's comes from its script), by targetname, `scriptfile`
or classname. A model of more than 12000 triangles is drawn as the box about it. A model is read once (a few
hundredths of a second) and kept: twelve views of a map with sixty-five models take under a second together.

In a lit map a model takes the light of the floor under it, as the game's does (the lightmap sample straight
under its origin), and is shaded plainly by the way each triangle looks; with `light: false`, and in brush
source, it is shaded plainly alone. `entities: "game"` draws only what the game shows (models and sprites;
no box stands in for a monster or a start), which with `labels: false` is the picture to lay beside a
screenshot.

**What a model's keys are worth.** `scale`: the engine's own drawing (GoldSrc's and Xash's) does not scale a
model; a mod's may. Master Sword's does, about the model's origin, which is why `scale` is honoured unless
told: `modelScale: false` draws each at its own size. Pitch and roll are the engine's arithmetic and were
not looked at in a game; yaw, scale, body and the masked textures were, on one map (below). Where the game
stands a model (it may drop it to the floor), and what a script makes of it afterwards (another body,
another animation), are the game's to say.

**Sprites.** With `folders`, an entity whose `model` key names a `.spr` (`env_sprite`, `env_glow`, any
point entity) is drawn as that sprite's first frame (`frame` names another), at its `scale`, on a board set
up as the sprite's own kind says: turned to the eye ("parallel"), upright, or lying as the entity's `angles`
say ("oriented"). It is blended as the engine blends it, by the entity's render mode: whole in the normal
mode (an additive sprite left in it is a black box in the game, and here); with holes where an "alpha test"
sprite's index is 255; added to what is behind it in mode 5, by as much as `renderamt` says; a **glow**
(mode 3) grows with its distance and dims with its square, is drawn over everything, and is hidden when
something stands before its middle. `rendercolor` tints it (`0 0 0` is no colour). A sprite is not lit. An
`env_sprite` with a targetname and without its `Start on` flag is off when the game starts: it is drawn all
the same, and `facts.notes` says how many are. `sprites: false` leaves them as small boxes. On a plan, an
entity that names a sprite has a small cross through its dot, and `facts.marks` gives its `sprite` and,
where the file was read, its `size`. The arithmetic is Xash3D FWGS's own drawing of a sprite; an animation
is not played.

**The sky.** With `folders`, the faces that wear `sky` show the picture the worldspawn's `skyname` names:
the six files `gfx/env/<name>rt`, `bk`, `lf`, `ft`, `up` and `dn`, each a `.tga` or a `.bmp`, asked by the
way each pixel looks and laid out as the engine lays them (`rt` is seen looking along +x, `lf` along -x,
`bk` along +y, `ft` along -y). `facts.sky` is its name. Where a side is not found the sky is a flat colour
and `facts.notes` names the file that was wanted; `sky: [r, g, b]` asks for a flat colour, `sky: false` for
the kit's own. A plan does not draw the sky.

**Heights and storeys.** A plan is one cut at one height. `heights: true` writes each floor's height on it
(`z 64`), where the floor is large enough to hold the words; `storeysOf` lays one plan for each storey side by
side; `sectionOf` cuts the map upright along a line, which is the picture that shows a cellar under a terrace,
a step, a ceiling's height and an entity sunk in the floor. A point `along` a section's line at height `z` is
at pixel `(left + along * scale, top + (zTop - z) * scale)`, all four in its `facts`.

**Labels.** A label is an entity's number and class. Where it would lie over another it is tried on the other
sides of its dot, then as the number alone, and only then left out; `facts.notes` says how many were. `legend:
true` writes the list of the entities beside the plan (300 pixels wider): each class once, with the numbers of
its entities, and `12=keeper` for one with a targetname.

**Light.** `light: true` (unless told) adds up the light that is always on (style 0) and the game's flickering
styles (1 to 31: torches; a cave city can be lit by nothing else) at their full; `"steady"` is style 0 alone;
`"all"` adds the switched lights (32 and up) as if each were on; `false` draws the textures as they are. A
sample multiplies the texture by `sample / 255 * brightness`, and `brightness` is 1.55 unless told: measured
against the game's own screenshots of one map (Xash in the browser, its defaults), where it came within 10
levels in 255 a channel; a gamma curve fitted worse. `facts.brightness` is the picture's mean (0 to 255),
and a view under 24 carries a note that says it is dark: so is the map there. `brightness: 4` looks into a
dark place; it is then no longer what the game shows. A map with no light data is shaded plainly by the way
each face looks, and `facts.notes` says so.

**Textures.** Those inside the map; then `textures` (map textures by name, `readWad(bytes).textures`); then
the `.wad` files the worldspawn lists, looked for in `folders` (the mod's folder, then `valve`). One found
nowhere is drawn in one flat colour of its own and named in `facts.missing`. A `{` texture has its holes
where the game gives them: on a brush entity in render mode 4 ("Solid"). On the world itself and on an
entity in any other mode the game draws the holes filled with the texture's last colour (blue as a rule;
the kit draws that colour as the palette has it), and so does a view, which then says how many faces: a
fence that is a wall of blue is an entity with no `rendermode`.

**What is not drawn.** The models nothing names, and those not asked for: an entity that names a `.mdl` is
a small box with its number and class unless `models` draws it, and so is one that names a `.spr` the
folders do not have (`entities: "all"` marks every point entity, `false` none). Brush entities the game
never shows are
left out: triggers, ladders, `zhlt_invisible`, a `rendermode` faded to `renderamt` 0, and faces wearing
`aaatrigger`, `clip`, `null`, `origin`, `hint`, `skip` (a plan outlines triggers too, in a colour of their own).
Also not drawn: decals, a brush entity's turn (`angles`: a door is drawn closed), a model's or a sprite's
animation (one frame is), a model's own shadow and the game's light on it beyond the floor's sample, dynamic
lights, fog, and anything a script does when the game runs. The pictures are an honest stand-in, not the
game.

**Against the game.** One map made with the kit (an orchard: sixty-five models, twenty-five sprites, a sky)
was drawn from two places and laid beside the game's own screenshots from about the same places (Master
Sword Classic on Xash3D FWGS in the browser). The same: where each model stands and how it is turned and
scaled, the crowns' holes and what shows through them, the cart, the barrel and the trees against the wall
behind, and the sky, side for side and the right way up. Different: the game smooths a texture seen from
near, the kit shows its pixels; the game lights a model by its own rules (the trunks and the barrel are a
little lighter there, the leaves a little brighter); a monster whose model is its script's is a box here;
the player's own body and the game's panels are not there. A sprite was not looked at beside the game.

## The walk test (`src/maps/reach.mjs`, `src/maps/space.mjs`)

Whether a player can get from the places to start to each place, worked out with no game running. It reads
brush source and compiled maps alike.

```js
const reach = maps.reachOf(map, { to: ["keeper"], bodies: { msmonster_warden: "large" } });
console.log(reach.warnings, reach.facts, reach.openings);
const plan = maps.planOfSource(map, { reach, heights: true, legend: true });     // green: walked; red: not
```

| Function | Gives |
| --- | --- |
| `reachOf(bspOrMap, { from, mod, step, jump, speed, gravity, slopes, exits, markers, wiring, off, doors, walls, open, shut, bodies, to, cell, touch, hang, widest, parts })` | `{ warnings, facts, starts, entities, unreached, stuck, hanging, oneWay, leaps, steep, openings, routes, doors, cell, area, share, standable, parts, patches, walked(x, y, under), on(x, y, under), stands(x, y, under), jumped(x, y, under), trapped(x, y, under) }` |
| `storeyCuts(bspOrMap, { cell, over, least })` | `[{ z, floors: [lowest, highest], area }]`: the heights to cut a map at so that every floor a player fits on is seen in one of the cuts, the highest first |
| `wiringOf(bspOrMap, { mod })` | What the entities are wired to do (src/maps/wiring.mjs, `smak map-wiring`): `{ properties, families, unnamedDoors, switches, works, lifts, zones, broadcasts, teleports, comesBack, warnings, facts }`. A property is a name doors answer to; a switch is followed through multi_managers and relays to what it works (`light`, `sound`, `lift`, `door`, `heal`, `hurt` ...); a train's stops are its corners that wait to be fired again. `doorFamilyOf(name)`: `resident7` is of `resident` |
| `spaceOf(bspOrMap, { doors, walls, open, shut, off, mod })` | `{ min, max, doors, areas, ladders, blocked(x, y, body), climbs(x, y, body), cut(x, y), sees(from, to), firstStop(from, to, precision) }`: the solid space, asked along upright lines. `firstStop` (a compiled map's only) is how far along a line it first meets something solid, or null: one walk, where `sees` would be asked of every length. `blocked` gives `[[from, to, slant]]`: `slant` is how the top of each stretch lies, the z of its normal (1 for a level floor). `body` is one of `BODIES` or its name (`"point"`, `"standing"`, `"large"`, `"crouching"`); anything else is refused in a sentence. `areas` has every brush entity's box with `solid` (its class stops a body) and `gives` (its class gives way) |
| `restOf(space, feet, body)` | `{ fits, floor, hang, stretch }`: whether a body fits with its feet at a point, the floor it would rest on and how far over it it hangs |
| `bodyFor(classname, targetname, bodies)` | `{ body, feet, mins, maxs }`: the box an entity stands in, or null |
| `bodyOf(body, what)` | the body a caller means: one of `BODIES`, its name, or `{ half, height }` (one of a hull's size is that hull); anything else is refused in a sentence that begins with `what` |
| `BODIES`, `START_CLASSES`, `EXIT_CLASSES`, `GIVES_WAY`, `JUMP_HEIGHT` (45), `CROUCH_JUMP_HEIGHT` (63), `JUMP_REACH` (215), `RUN_SPEED` (320), `GRAVITY` (800), `STEEP` (0.7) | The four boxes (`point`, `standing`, `large`, `crouching`), told about the feet; the classes that are a place to start, a way out of a map, and a wall that gives way (`func_breakable`, `func_wall_toggle`, `func_pushable`); the engine's numbers for a jump, a run and a slope |

**How.** The map is laid under a grid of 8 units. At each place of it, the heights at which a standing player
fits are worked out: in source, every solid brush grown by the player's box, as the compilers grow their clip
hulls; in a compiled map, its own clip hull, so that `clip` brushes count as the game counts them. From the
places to start (`info_player_start`, `info_player_deathmatch`, Master Sword's `ms_player_begin` and
`ms_player_spawn`; or `from`) a flood spreads from place to place: up a step of 18 at the most, down any drop,
down a slope too steep to stand on and never up one, with room for the whole body on the way. A ladder (`func_ladder`) and a liquid carry it up,
and so does a lift (`func_plat`), taken as a ladder in its shaft: from where it is built down by its `height`
(its own height less 8 when it gives none, as the SDK's plats.cpp has it; under 0, up), its brush no wall since
it moves. A fact says where each lift rides, and for one with no name (the lift a player steps on) a warning
names an end with no floor within a step of it (beside it or under it) or no room for a player on it: a lift
that rides up into the air instead of down. One with a name is ridden when something names it, as scenery
is moved, and is only said; a
`trigger_teleport` it walks into carries it to where its `target` is. Doors (`func_door`,
`func_door_rotating`, `momentary_door`) are open unless `doors: "closed"`; `open` names more brush entities to
take as not there (a wall that breaks), `shut` doors to take as closed (one that wants a key), each by number,
classname or targetname. What breaks, is switched on and off by name, or is pushed aside (`func_breakable`,
`func_wall_toggle`, `func_pushable`: `GIVES_WAY`) is a wall unless `walls: "gone"`, which takes them all away
(`shut` keeps those it names); a `func_wall_toggle` whose spawnflag 1 is set starts off (the SDK's
SF_WALL_START_OFF) and is not there either way. Every other brush entity that is solid in the game is a wall.

**Ladders off the grid.** A ladder is often a brush 2 thick with a solid brush of rungs before it, in a shaft
a body fits in over a few units only (one in Master Sword's edanasewers is 3 wide), and no place of a grid of 8
is in it. So a ladder is also asked along upright lines a unit apart all about it: each stretch a body's feet
may be at there while its box touches the ladder is a shaft, from its floor to the ladder's top or the
ceiling, and a body gets on it from the places of the grid about it and off onto any floor there a step over
its top at the most. A hatch over the shaft closes it. A fact counts the ladders whose shafts led to floor
walked to no other way, and the one-way places know them: a pit left by such a ladder is none.

**Teleports.** A `trigger_teleport` that is walked into carries the walk, and every other way it tries (a
jump, crouching, open air), to the entity its `target` names. Where a teleport puts a player is not counted
among the entities a player goes to (unless `markers` names it). One that leads nowhere (no entity of that
name, or no room for a standing player there) is a warning. A teleport with a `master` is taken as working,
as a door is taken as open.

**What it says**, in `warnings`:

- **Entities that are not reached**, each with what it would take, found by trying again: `only by a jump`
  (45), `only by a jump with the legs drawn up` (63), `only crouching` (with where the way is too low and how
  high it is there), `by no way on foot, though open air leads to it` (with how near the walked floor comes: a
  gap too narrow, a ledge too high, a counter), `no opening leads to it`, `it is inside something solid`.
  Counted are the point entities a player goes to (not lights, sounds and the game's wiring) and the brush
  entities that are walked into or used: triggers, `msarea_` areas, doors, buttons, ladders. A point entity is
  reached when a player stands within 32 of it (`touch`) with nothing solid between.
- **Entities that stand in something solid**: the box each moves with does not fit where it is. For one sunk
  in its floor, how far, and that it fits that much higher.
- **Entities that hang** more than 64 over their floor (`hang`). Half-Life drops a monster to the floor as it
  appears; whether a mod does is for the game to show.
- **Openings only just wide enough** for a player (32 to 47), and, when `bodies` names a large monster, the
  openings its box does not pass (under 64 wide or high).
- **One-way places**: floor a player gets to from the places to start and from which there is no way back to
  one: a pit, a room a teleport leads into and nothing leads out of, the foot of a slope too steep to climb.
  Each with about how large it is, about where, its floor's height, the way in (`entered by a drop of 64 at
  ...`, `down a slope too steep to climb`, `through a teleport`, `by a jump`) and the entities in it;
  `oneWay` has them as data and `trapped(x, y)` their floor. The way back is looked for with everything a
  player does: steps, a jump up to 63 with the legs drawn up, a jump across a gap, crouching, teleports. A
  place a player is meant to leave by is no fault: `trigger_changelevel` is taken as a way out, and `exits`
  names a mod's own (`exits: ["msarea_transition"]`). A pit that is meant to kill is one you mean: the
  warning says "mean it, or give a way out". With no such place, a fact says so.

And in `facts`: where it walked from, the openings (the narrow places of the walked floor with a wall on both
sides: a gate, a doorway, a gap between two trunks), the floor walked in square units, how much of it is too
steep to stand on, the longest walk, the walk to each entity of `to` (with its `routes`: the way as points,
which a plan with `reach` draws), and which doors were taken as open.

**How much of the floor is walked, and why the rest is not.** Every place of the grid is asked, and each
stretch of heights a standing player fits in there over a floor not too steep to stand on is a `cell` x
`cell` of floor: `standable` is all of it in square units and `share` the part the walk reaches (a fact says
it: "the walk reaches 27.3 in 100 of the floor a standing player fits on"). The tops of walls and crates are
floor too: a map walked whole comes to a little less than 1. What is not walked to is put in parts, floor a
body steps about in: those under 4096 square units are counted (`patches`), the larger told (`parts`, the
largest first, 40 at the most), each with `at`, `area`, `floors`, `nearest` (the walked floor nearest it,
within 384) and `how`, what it takes, found by trying in turn:

| `how` | | `why` says |
| --- | --- | --- |
| `jump` | a jump of 45 gets there | where the way leaves the walked floor: "at -208 -1816 64 the floor rises 32", or the jump across a gap |
| `crouch-jump` | a jump with the legs drawn up (63) | the same |
| `crouch` | only a crouching body fits | where the way is too low, and how high it is there |
| `wall` | brush entities are in the way (`behind`: their numbers) | each by name and where it is, and what takes it away: `walls: "gone"` or `open` for what gives way, `open` for any other, "a door taken as closed" |
| `air` | open air leads to it and no floor does (a ledge too high, a gap too narrow) | how near the walked floor comes |
| `none` | walled off | "no opening leads to it", and how near the walked floor comes |

The ways through brush entities are tried first with only what the game takes away gone (the doors taken as
closed and `GIVES_WAY`), then with every brush entity gone; the way named is the one through the fewest of
them (a step into one costs more than any walk is long), and it may pass through one a longer way goes round.
An entity that is not reached and is behind brush entities has them in `behind` too, named after its reason
("no opening leads to it: behind 74 func_wall_toggle "freetogo" at ..."). When the parts a jump reaches come to
a tenth of the floor, a fact says the map is meant to be jumped through and that `jump: true` walks it so;
when brush entities stand before a twentieth, a fact says `open` and `walls: "gone"` take them away.
`parts: false` looks at none of it, and is a little quicker. On Master Sword's demontemple the walk on foot
reaches 27.3 in 100 of the floor: the largest part (994496 square units) is "only by a jump: at -208 -1816 64
the floor rises 32", the temple's great steps; with `jump: true` it reaches 62.3, and with `walls: "gone"` as
well, 99.1. Its seals and keys (`func_breakable`, `func_wall_toggle`) are named before the boss's room.

**A profile's lists.** With `mod`, the profile's `exits`, `markers`, `wiring` and `off` (and the classes of
its `doors`) are used as if given; a list given by name is ADDED to the profile's and never takes from it. To
walk without one of the profile's, hand over the profile without it: `mod: { ...profile, wiring: [] }`.
`spaceOf` takes `mod` too, for its `off` and `doors`.

**Jumps.** `jump: true` makes jumps part of the walk: up a ledge of 45 (`jump: 63`: with the legs drawn up
too), and across a gap, as one arc at a run. What only a jump reaches is told apart: an entity's `how` is
`"jump"` (it is `reached`), `leaps` lists the jumps that led to floor not walked to (`{ from, to, run,
rise }`, the longest first), `jumped(x, y)` is that floor, the facts count it, and a plan with `reach` tints
it blue. Without `jump` the walk is on foot, and an entity only a jump reaches is not reached: its reason
says which jump (`a jump of 144 across a gap, from ... to ...`).

**The engine's numbers**, which the walk goes by, and where each is from: Half-Life's own movement code
(`pm_shared.c`, compiled into every mod's game) and the server's settings.

| | | From |
| --- | --- | --- |
| A step | 18 | `sv_stepsize` |
| A jump | 45 | `PM_Jump` throws a player up at `sqrt(2 * 800 * 45)` = 268.3 units a second; at the gravity of 800 (`sv_gravity`) that is as high as 45 |
| With the legs drawn up | 63 | crouching in the air lifts the feet by half of what the body loses (72 to 36): 18 more |
| A run | 320 | `sv_maxspeed`: the most a player's own legs give, on the ground and in the air |
| A running jump | 215 | the time in the air of a jump that lands as high as it began, `2 * 268.3 / 800` = 0.671 seconds, at 320: so far the body's middle goes |
| A slope | 0.7 | `PM_CategorizePosition`: on a face whose normal has a z under 0.7 (steeper than 45.6 degrees) a player is not on the ground, and slides |

A body stands with its middle up to 16 past an edge, so the two edges of a gap may be up to 246 apart; the
grid finds a little less (on a grid of 8, edges 224 apart are jumped and 232 are not). A landing lower than
the take-off is reached farther out, one higher nearer, as the arc has it; a ceiling too low for the jump's
top cuts it short. `speed`, `gravity`, `jump` and `step` say otherwise for a game that differs (Master
Sword gives a longer jump to those who earn it; a slower game runs at less than 320).

**Slopes.** How each floor lies is read from the map: in source, the plane a brush's top is; in a compiled
map, the plane of its clip hull the body rests on. A floor steeper than the engine's 0.7 is slid down and
never walked up, nor jumped up (a jump lands on it and slides back). A face steeper than 75 degrees is a
wall with a batter: where it is no taller than a step it is stepped over as a kerb is. `slopes: false`
walks every floor that rises no more than a step in a cell, as 0.9.0 did. `entities` has every counted entity with `reached`, `how` and `far`;
`openings` each with `at`, `width`, `height`, `across` and `fits.large`.

**What it is worth.** A way it finds is a way the box of a player fits along. The game's own movement is not
played: friction, the push of a door, the speed a player gains by turning in the air, a run-up too short to
reach full speed. A jump across a gap is one arc with nothing in its way, tried along sixteen ways of the
grid, to a landing no more than 256 under the take-off. Not finding a way is a strong hint and no proof: an
opening narrower than 40 that is off the grid can fall between two places of it (`cell: 4` looks closer). A
one-way place is found with no way back by the same arithmetic: a way out that a script opens, or a ladder
that is a model, is not seen. On the kit's own two rooms the source and the compiled map give the same
walked floor to the unit. On Master Sword's `edana` (a town of 477 entities, walked in about 6 seconds) it
reaches 82 of the 97 entities a player goes to, on foot. Of the other 15, open air leads to 8 and no floor
does (four NPCs and two items the walked floor comes within 90 units of, and two hawks placed 700 over the
ground), 2 take a jump, 2 a crouch, 2 a jump with the legs drawn up, and 1 has no opening to it. It finds no
one-way place there on foot, and 4.5 in 100 of the walked floor too steep to stand on. With `jump: true` it
reaches 4 more entities and 13 in 100 more floor (roofs, banks, the tops of walls), and finds 7 places a
jumping player gets into and not out of. Nobody looked at any of these in the game: some are surely as the
map means them, and some may be the test's own misses. **None of it was measured against the game**: it is
geometry, with the engine's numbers.

## In 3D, and the things in it (`src/maps/scene3d.mjs`, `viewer/map-serve.mjs`)

`sceneOf3d(map, { folders, mod })` makes a map a scene for a page that draws in 3D: the world's faces as
triangles grouped by texture (each wound so that its normal is its face's), a compiled map's lightmaps packed
into one picture with each corner's place on it, brush source's textures from the .wad files its worldspawn
lists or the game's folders hold, tools' faces (clip, origin, trigger) and brush entities' faces apart, and
each point entity as its model (posed by its `angles`, `body`, `skin`, `sequence`, `scale`, as the pictures
draw it: `figuresOf`) or its box. `smak map-viewer` serves it to the browser: walked through with the mouse
and the keys, floors coloured by height, ceilings and clips shown or hidden, an arrow the way each entity
faces, a click on a thing says what it is; it loads again as its file changes (a sketch, a .map saved from an
editor, a .bsp compiled again). It is for the person; an agent looks with `map-view` and `map-props`.

`propsOf(map, options)` holds each point entity that has a model or a body against the world: the share of
its box in solid (looked into 4 units from its sides), the gap under its foot, and how far a wall is in
front, behind, left and right by the way it faces. A **warning** is wrong wherever it is: a thing that walks
(an NPC, a monster, a start) stuck in solid, a prop buried (over half its box; a thin one, a vest on a rack,
is laid against a wall), a prop that floats with no side on a wall and nothing under it. A **note** is what a
mapper may mean and a look tells: a prop partly in a wall (a sword stuck in a rack), its nose to a wall with
room behind it (turned the wrong way, when its model's front is +x, as most are: the check found the
dumpsters of a city built with the kit turned to the wall, as a player had seen), a thing that walks placed
over the floor (most games drop it), a prop standing on another model (a candle on a table). On the game's
own gatecity: 3 warnings and 116 notes in 182 things, which is why notes are to be looked at, not mended
blindly. `smak map-props --views <folder>` draws each from the side with the most room.

## A map against pictures of it (`src/maps/overlay.mjs`)

A picture of a place (a screenshot, a render, a photograph) and the map that is to be it: find the camera of
the picture against the map as built, see where the map and the picture part, move the wall that is off, look
again. As a model's pictures are fitted by its outline (`project`, `pose.fit`), a room seen from inside is
fitted by its edges. `smak map-overlay <map|bsp> <picture> --from x,y,z --yaw n [--pitch n] [--fov 90]
[--locate] -o over.png` does it from the command line.

| Function | Gives |
| --- | --- |
| `overlayOf(map, picture, camera, { width, height, offsets })` | The map's edges (creases, depth steps; texture joins in blue) drawn over the picture from `camera` (`{ from, yaw, pitch, fov }`, fov 90 unless told), green within 2 pixels of the picture's own long straight edges, red with a picture line 2 to 10 pixels off (a line is there and the edge is not on it), amber with none within 10 (nothing to compare: a soft line the detector missed, or a camera so far off nothing is near): `{ width, height, rgba, score, toPicture, fromPicture, faces }`. `score` in pixels (lower is better). `faces`: each face whose edges the view shows, how far it would move along its normal (`move`, units) to lie on the picture's edges, the largest first. A reading of edges: on a picture of flat colours it is sharp, on a textured one the texture's own lines pull it |
| `fitCamera(map, picture, { from, yaw, pitch, fov, fitFov })` | The camera that best lays the map's edges on the picture's, searched from a guess (or, with none, from places over the map's floor at eye height): `{ camera, score }` (`--locate`) |
| `geometryOf(map)`, `rasterOf(geometry, camera, width, height)` | The faces a view draws (`plane` keys coplanar faces alike), and which face each pixel shows and the point of the map there (`point(i)`) |

In the fork the camera is also found by features matched against a render of the map and by structure from
motion (its `photo.mjs`, in Python venvs of OpenCV, pycolmap, LightGlue and VGGT); that is not taken here, and a
camera is fitted by the edges alone. A room of walls without lines (flat-lit, plain) says little of where it is,
and so does a dark one of laid stone: on a view of a Master Sword tavern at its own camera most of the map's
edges came amber (no line of the picture near them), and `--locate` from a guess 25 units and 8 degrees off
settled 140 units away at a lower score than the true camera's. Trust it on lit rooms of plain lines.

## A map's dressing (`src/maps/dressing.mjs`)

How a map is dressed, in numbers, beside Valve's own: the facts a maker revising a map is told, measured
(the fork's research/level-dressing.md: checks by rule agree with people where a picture judge does near chance). `smak
map-dressing <bsp> [--source <map>] [--against <bsp>]` prints it.

**Against the mod's own maps.** Valve's campaign is no measure of every mod: The Specialists' 29 maps are lit
brighter and flatter (the floor under 24 a median 10%, Valve's 21%; the light's contrast a median 3.9, Valve's 12.9),
so a map made in their manner was told to darken and compose its light. A profile's **`dressing`** gives the mod's
own bands, in `VALVE_DRESSING`'s shape (`{ name, of, measures }`), and `smak map-dressing <bsp> --mod ts` (or
`dressingOf(bsp, { against: profile.dressing })`) holds a map to them; a
measure the bands lack (the brush roles, the views') is held to Valve's, and each line says whose.
`learnDressing(list)` makes such bands from `[{ name, measures }]` (`measureDressing`'s), the 5th and 95th in 100
with the quartiles; `smak map-dressing <folders or maps> --learn -o bands.json [--as "whose"]` from a folder, for
`--against bands.json` or a profile. A spec's composed light (`lighting`) still aims at Valve's figures.

The Specialists' own (`profiles/specialists.mjs`, `DRESSING`, measured 2026-10-21 over ts/maps):

```
Measure            The Specialists' 5th to 95th (median)    Valve's
scaleOne           18% to 96% (72%)                         26% to 97% (79%)
shifted            49% to 98% (84%)                         28% to 98% (71%)
bandedWalls        4% to 47% (21%)                          1% to 41% (13%)
oneTextureWalls    30% to 78% (44%)                         44% to 93% (68%)
joinHeight         128 to 352 (176)                         56 to 527 (160)
lampFaces          0.56 to 289 (3.3)                        0 to 101 (5)
nonAxial           3% to 45% (9%)                           7% to 60% (22%)
detail             1.8 to 14.8 (5.2)                        2.3 to 23 (10.7)
darkFloor          1% to 56% (10%)                          6% to 60% (21%)
contrast           2.2 to 10.7 (3.9)                        3.6 to 152 (12.9)
```

| Function | Gives |
| --- | --- |
| `dressingOf(bsp, { source, views, against, landmark })` | `{ measures, counts, rows, facts, warnings }`: each measure beside `VALVE_DRESSING`, a line each (`dressing: tall walls of one texture only: 100% (Valve's: 44% to 93%, median 68%)`), and a warning, with which way to go, for one outside Valve's band. `source`: the map's brush source, for its brushes' roles; `views`: pictures of it, for their complexity; `landmark`: `{ name, room, seen, of }`, a map spec's focus, named with how many of the ways into its room see it (a warning when one does not) |
| `measureDressing(bsp, { source, views })` | The measures alone |
| `dressingOfSource(map)` | The brush roles of a source: shares of its world (and `func_detail`) brushes that are panels, strips, lamps, angled |
| `brushRole({ min, max, faces })` | One brush's role as Valve's c1a0 sources are read: `lit` (a lamp's texture, its long side 128 or less), `strip` (two thin sides of 16 and 24 or less, its long side three times the middle), `panel` (its thinnest 16 or less, the next 32 or more), else `block`; `angled` when it has other than six faces |
| `lampsOf(bsp)`, `isLampTexture(name)` | Whether a texture is a lamp: the game's texture lights, a `~` name, a lamp's word, and every texture a map's `info_texlights` names (a map spec's glowing fixtures) |
| `pictureComplexity(picture)` | `{ edges, compression }`: the share of pixels whose brightness steps over 24 to a neighbour, and its PNG's bytes over its raw size (Machado et al. 2015: such measures follow people's ratings of complexity) |
| `learnDressing(list, { name, of })` | The bands of many maps' measures (`[{ name, measures }]`): `{ name, of, maps, measures: { key: { least, q1, median, q3, most } } }`, least and most the 5th and 95th in 100; a map with no value for a measure is left out of its band |
| `VALVE_DRESSING` | Valve's own: each measure's 5th, 25th, 50th, 75th and 95th in 100 over the campaign's 96 maps, the roles over the SDK's c1a0 and c1a0d sources (widened a quarter each way, two being few). the fork's `research/valve-dressing.mjs` measures it again |

The measures, of the world's faces (tool, sky and liquid faces left out):

```
Measure            What it is                                                       Valve's 5th to 95th (median)
scaleOne           faces at texture scale 1                                         26% to 97% (79%)
shifted            faces shifted off the world's texture grid                       28% to 98% (71%)
bandedWalls        tall walls (128 or more, faces grouped by plane) with a texture   1% to 41% (13%)
                   join up them: two textures meeting on the one plane
oneTextureWalls    tall walls of one texture only                                    44% to 93% (68%)
joinHeight         median height of a join over its wall's foot                      56 to 527 (160)
lampFaces          lamp faces a light entity (light, light_spot)                      0 to 101 (5)
nonAxial           world face area off the axes                                       7% to 60% (22%)
detail             world planes a 256 x 256 of floor (up-facing face area)             2.3 to 23 (10.7)
darkFloor          floor area whose steady light is under 24 of 255, sample by         6% to 60% (21%)
                   sample (a face's mean evens out the pools under its lamps)
contrast           the floor light's brightest tenth over its darkest, by sample       3.6 to 152 (12.9)
panels, strips,    the brush roles, of source                                        about 39%, 15%, 15%, 6%
litBrushes, angled
edges              of views' pixels on an edge (six views aimed, 320 x 240)           1.6% to 15% (4.9%)
compression        a view's PNG bytes over its raw size                               0.20 to 0.47 (0.34)
```

What it is worth: each measure is of the faces as the compiler left them, Valve's measured the same way from
their compiled maps; a band at the 5th to 95th says where most of Valve's own lie, not what is good. `WALL_FAMILIES` (`src/maps/families.mjs`, `familyOf(name)`) is what Valve stacks under and over each of its wall
textures, and at what height, over the 96 campaign maps (measured by the fork's research/valve-wall-families.mjs). The original mod's
maps measure outside Valve's band on banding, one-texture walls, the share off the axes, the dark floor and the
light's contrast; Valve's c1a0 only on the share off the axes, being among its boxiest. The views' edges and
compression put the mod's three maps inside Valve's band (0.04 to 0.13, 0.28 to 0.40): photographic textures
are busy enough, and these two tell little apart here.


## A map in numbers (`src/maps/measure.mjs`)

A new map is judged against one the game already has before anyone plays it: a map whose middling place is
half as wide as the game's, or whose corridors are lower, reads cramped in the game however well it compiles.
`measure(map, options)` gives those numbers for brush source or a compiled map; `measureTable(list)` lays
several maps' side by side, a measure a line and a map a column. `smak map-measure a.bsp [b.bsp ...]` prints
the one or the other (`--json`: the numbers themselves); `smak map-compare a.bsp b.bsp -o same.png` draws them
at one scale (`compareOf`, above). So a new map is set beside the game's with `smak map-measure new.bsp
game.bsp --every --mod <profile>` and `smak map-compare new.bsp game.bsp -o same.png --z 100,-`.

```js
const game = maps.measure(maps.readBsp(readFileSync("demontemple.bsp")), { mod, every: true, name: "demontemple" });
const ours = maps.measure(maps.readBsp(readFileSync("barrowroad.bsp")), { mod, every: true, name: "barrow road" });
console.log(maps.measureTable([game, ours]).join("\n"));
```

**How a place is measured.** The floor is looked over on a grid (`grid`, 32). At each place sixteen level
lines go out, one every 22.5 degrees, 60 over the floor (a little under a player's eyes, at 64, and off the
heights maps are built at: a line at 64 runs along the top of every bench 64 high), each as far as it goes
before something solid (found to within a unit, 3000 at the most).
- **width**: the narrowest of the eight lines THROUGH the place (one way and the opposite, added): 128
  anywhere in a corridor 128 wide, and in a room its lesser side.
- **sight**: the longest of the sixteen.
- **headroom**: from the floor to the first thing solid over it.

**Which floor.** Unless told, the floor the walk test gets to from the places to start (with what `reachOf`
takes: `mod`, `exits`, `off`, `open`, `shut`, `doors`, `from`, `jump`, `cell`; `open`, `shut`, `doors` and `off`
are the lines' too), every walked floor where several lie one over another. `every: true` (`--every`) takes
every place a player fits whether walked to or not: each gap of 72 or more between two solids, on a floor that
can be stood on, under 1200 high (`tallest`). That is the measure of the building, for a map the walk test
gets to only part of (a teleport, a train, a door a script opens); a warning says when the walk got to under
half of what fits.

**What comes back**: `places` and `area`; `footprint` (the box about the floor seen from above, and the
share of it that has floor); `floors` (`lowest`, `highest`, the fullest heights, and `stacked.most`: how many
floors lie one over another at the most); `width` (median, quartiles, nine tenths, and the share of the floor
in each band of `bands`: under 176, 176 to 352, 352 and over); `headroom` (the same, and in corridors, under
the first band, and in rooms); `sight` (the same, and the share of places that see beyond `sight`, 700);
`openings` (the walk test's narrow places: their count and widths); `facts` and `warnings` as sentences.
`places: true` hands back every place with its numbers.

**What it is worth.** Lines sixteen ways miss what lies between them: a width may be a little over the true one
where a place's narrowest way lies at a slant between two lines, and a sight is never over the true longest.
In the corner of a room the line that cuts the corner off is short, so a room's corners count as narrow floor
(about seven places a square corner on a grid of 32): the bands are for one map beside another, measured the
same way, more than for each by itself. 176 and 352 are this kit's own lines, no engine's. Measured on three
maps (two drafts of one new map for Master Sword, and the game's own `demontemple`), the same
settings as an agent's one-off sampler (lines 60 over the floor, found to within 16, one floor a place) gave
its numbers to the place and the unit; to within a unit the widths come out some 10 wider (the sampler's
coarser search reads a 352 hall as 340), which on the old Barrow Road moves 8 in 100 of the floor into the band
of 352 and over. demontemple measured whole (`every`): 5893 places, width median 256, headroom 192, sight
median 708; the walk test reaches 1523 of them.

## Two teams (`src/maps/teams.mjs`)

The Specialists is a deathmatch game: its maps have one pool of spawns and no teams. The **ts_matchmode** plugin
plays rounds of two teams on them (team 1 "msr", team 2 "insurgents", sides never swapped), and puts each player at
a spawn of his team's at the round's start. Where those spawns are is the plugin's, and `teamsOf(map, options)`
(`smak map-teams <bsp|map> --mod ts`) replays it from its source (ts_matchmode.sma: collect_spawns,
partition_spawns, srv_spawn, cmd_spawn_save):

- **A spawn file first.** `addons/amxmodx/configs/tsm_spawns_<map>.cfg`, lines `tsm_spawn <team 1|2> <x> <y> <z>
  [pitch] [yaw]` (`readSpawnCfg`: a team other than 1 or 2 refused, 64 a team, a word that is no number read as 0).
  When it gives any spawn the map's own are not used; a team it gives none borrows the other's. Its z is the
  player's origin, 36 over the floor; the facing comes from this file alone.
- **Else the map's own, split** (`collectSpawns`, `partitionSpawns`): every `info_player_deathmatch` in the order of
  the map's entities, then every `info_player_start`, 64 in all at the most; the two farthest apart in 3D (the first
  such pair) are the anchors, and each spawn goes with the nearer, a tie with team 1; distances in single
  precision, as Pawn's.

What it tells, by the profile's `teams` (`TEAMS` in profiles/specialists.mjs; `TEAM_PLAY` for what one leaves out):

| | FAIL | WARN |
| --- | --- | --- |
| The nearest spawns of the two teams (in 3D, where each stands) | under `cross.fail` (512): a fight at the spawn | under `cross.warn` (1400) |
| A spawn of one team in sight of one of the other's (eyes to eyes or to the body; `sightTest`, `map-spawns`' test: the world and the brush entities that hide, doors closed; the dark not counted) | `sight: "fail"` | `sight: "warn"` |
| The walks to a goal (`goal`, `--goal x,y,z` or an entity's number, classname or targetname, set on the floor under it): each team's from its nearest spawn, or with `each` (`--each`) the median of each spawn's own walk; the balance in per cent of the shorter | over `balance.fail` (25) | over `balance.warn` (10) |
| A spawn in something solid, or with no floor under it; a team a spawn file gives none; no walk between the sides | always | |
| Fewer than five spawns a team (the plugin picks one at random, with no look at who stands there) | | always |

and as facts: how many of each class, the anchors, each team's spread and heights, the walk from team 1's spawns to
within 64 of team 2's nearest (`contact`: how soon the sides meet, at a run of 320). `cfg` is the spawn file for
these spawns (`spawnCfgText`; `--write-cfg [folder|file]`, named `spawnCfgName(map)`): the two lines of header
amx_tsm_spawn_save writes, then `tsm_spawn <team> x y z pitch yaw` to two places, each spawn at its floor (z = floor
+ 36) and turned to the goal, or to the middle of the map; a spawn file's own facing is kept. It goes in the
server's `addons/amxmodx/configs/`. The game's own maps, split by the plugin, have their teams' nearest spawns 300
to 700 apart and in sight of each other: none was laid out for two teams.

```
smak map-teams te_neuropolis.bsp --mod ts --goal 1200,0,40 --write-cfg cfgs/
smak map-teams te_neuropolis.bsp --mod ts --cfg cfgs/tsm_spawns_te_neuropolis.cfg --each
```

The walks are the walk test's (`reachOf`, whose `to` now takes points `[x, y, z]` as well as entities): `doors`,
`jump` and `cell` as it takes them; `walk: false` (`--no-walk`) skips them, the slow part (seconds a walk on a large
map; `each` walks once a spawn). Not played: the plugin's random choice of a spawn, two players on one, the dead
parked 900 over where they fell, the squad warp, the freeze.

## A mod's profile by name, and the game found (`src/maps/games.mjs`)

`--mod` takes one of the kit's profiles by name (`MAP_PROFILES`: `ts` or `specialists`, `ts-roleplay`, `msc` or
`mastersword`; `mapProfileOf(name)` gives its file and the mod's folder) as well as a profile's file. With no
`--game`, a profile made from the installed game is handed the Half-Life folder found on this machine
(`findHalfLife({ mod })`): `SMAK_HALF_LIFE` when it is set (`none`: no game looked for), else
`steamapps/common/Half-Life` in a Steam library (`steamLibraries`: the Steam folder the registry or the usual places
give, and those its `libraryfolders.vdf` names) that holds the mod's folder. So `smak map-measure x.bsp --mod ts`
and `smak map-character x.bsp --mod ts --kind compact` need no `--game`. `--kind` is handed to the profile (The
Specialists': `arena`, `compact`, `roleplay`).
## Waypoints for bots (`src/maps/waypoints.mjs`, `src/maps/rcbot.mjs`)

A bot plays a map by its waypoints alone: it walks a straight line from one to the next along their paths, and
where none is near it stands still. `waypointsOf(map, options)` lays them over the floor the walk test walks,
for brush source or a compiled map; `writeRcw` writes them as RCBot's file, and `readRcw` reads one.
`smak map-waypoints te_meridian.bsp --mod ts --out <Half-Life>/rcbot` does both and puts the file where the
bot looks for it (`--plan p.png`: drawn on the plan).

```js
const made = maps.waypointsOf(maps.readBsp(readFileSync("te_meridian.bsp")), { spacing: 160 });
console.log(made.facts, made.warnings);
writeFileSync("te_meridian.rcw", maps.writeRcw(made.waypoints, { mapName: "te_meridian" }));
```

**RCBot's file.** RCBot (Paul Murphy's, "Cheeseh", for Half-Life 1 and its mods; The Specialists 3.0 is one)
reads `<Half-Life>/rcbot/waypoints/<mod folder>/<map>.rcw`, `ts` for The Specialists. Read from its own code,
`WaypointLoad` and `WaypointSave` in `dlls/waypoint.cpp` and the structures in `dlls/waypoint.h` of
github.com/APGRoboCop/rcbotold, the same at tag v1.51b13 (what a community's servers run) as at its master of
2026; checked by reading and writing back, byte for byte, 1112 files the bot wrote (44 of The Specialists'
maps, the rest other mods'). Little-endian, nothing between the parts:

```
header     52 bytes   char filetype[8] "RCBot\0" (strcmp: the two bytes after the 0 are anything);
                      int version 4; int flags (bit 0: the visibility table is to be worked out again);
                      int count (the bot has room for 1024); char mapname[32] (the map's, exactly, or no load)
waypoints  16 each    int flags; float origin[3]: a player's origin there, 36 over the floor (18 crouching).
                      One over 4096 on an axis is taken as deleted
paths      per point  short count; short to[count]: one way each (both ways is two paths), any number
```

The flags this kit writes: `CROUCH` (bit 3: the bot crouches on its way to it), `LADDER` (bit 4: the foot and the
top of a ladder, as the bot's own guide places them), `JUMP` (bit 19: on touching it the bot jumps, legs drawn
up, towards the next; the path from it goes to where the jump lands). `RCW_FLAGS` names the rest. A new file
has the visibility bit set: the bot then works the table out as the map loads (a line between every two
waypoints), writes `rcbot/visibility/<mod>/<map>.rcv` and writes the `.rcw` again with the bit cleared, so no
`.rcv` is written here. `readRcw(bytes)` gives `{ filetype, version, fileFlags, mapName, waypoints: [{ flags,
origin, paths }] }`; `writeRcw(waypoints, { mapName, fileFlags, filetype, loose })` the file (`loose`: a path to a
waypoint the file does not have, which old files hold, written as it is); `waypointFlagNames(flags)` the names.

**How they are laid.** The map is walked as `reachOf` walks it (with jumps), on a grid of 8. Floor that nothing
is seen to make is left out: the clip hulls take a sky brush as solid, so a map on an island in the sky
(`ts_dojo`) has the top of its sky walked, or a player clip laid over it, and no player is meant there (a floor
is seen when the upright line at its place meets the top of something not sky at it or a stair under it; the
edge of a seen floor counts with it). First the places a
waypoint has to be: each start; each ladder's foot and top; for each piece of floor of 4096 square units or
more that only a jump reaches, where the jump is made from (a little way back) and where it lands (a little
way in); the two ends of each flight of stairs or ramp rising 40 or more; the middle of each opening. Then the
rest of the floor, the roomiest places first: a waypoint wherever none is within `spacing` units of walk (160),
the last of them, by the walls, moved within 48 to where a body has room.
Each piece of floor is then given to its nearest waypoint by walk, and two whose pieces touch are joined both
ways when a body walks the straight line between them, place by place, never more than a step up or down, with
room beside it: at each place of the grid 8 units of floor either side of the body (`ROOM`), past what a
wall, a prop's clip or an edge leaves, wherever the floor across the line has that much (through a doorway
only a little wider than the body, its middle line), and opening out from a waypoint that stands in less room
as a cone. A line that drops is joined one way (`drop`, 250 at the most: a fall of 250 costs about 11 health).
Where two do not see their way (a corner) and no third waypoint joins them, a waypoint goes at the place
farthest off their line of a walk between them that keeps off the walls (a place with less room costs more to
walk), moved within 48 into more room; where the walk got into a piece only by dropping, one at the top of
that drop and one where it lands; the pieces are given out again, eight times at the most, and a last time
taking a line the body only just fits along, where the paths do not already go round (`tight` on the path).
Then any two within 1.5 x `spacing` whose line is walked with room are joined, the nearest first, to `paths`
(16) out of one, but not where two shorter paths it has go nearly the same way (within 10%), and no drop
here. Floor where only a crouching body fits and
that is the shorter way between two places a standing one walks (by more than twice, or the only way: a vent,
a low passage; not the nook under a table or a stair) gets crouching waypoints, 96 apart, joined along the
crawl. Where the paths still do not join what the walk does, a jump up (45 at most) out of a place a path gets
into with no way back, and a drop into a place no path gets to, are added, the lowest first, and the pieces given
out again (six rounds at most). Where the nearest waypoint a place sees is on another floor (higher or lower
than a jump) and is not walked to, a waypoint (`near`) goes on the place's own floor, three rounds at most: a
bot that has lost its way takes the nearest waypoint it sees, by straight distance (`NearestWaypoint`), and
beside a pit that would be one at its bottom. A drop is then taken out where the walk goes to the same
waypoint within 1.5 times its length and 64: RCBot weighs a path by its length alone, so it takes any drop
that is shorter, and finds itself below with the long way back. The top of a crate or a sill a jump gets onto
is a side trip, down only to where the jump was made or beside it; the top of what gives way (a crate that
breaks) is not waypointed. Last, only the waypoints that a path from a start gets to and that lead back to
one are kept: a bot sent anywhere else would never arrive or never leave (the warnings name those left out,
`leftOut` lists them). And the order of the file is the bot's plan: RCBot's bots roam to a goal picked at random among
the FIRST 50 waypoints of the file (`WaypointFindRandomGoal`: `indexes[50]`), so the first 50 are open floor
and places to start with 16 of room about them, spread over the map, the farthest from those taken first; the
jumps, ledges, landings and crouching places come last. Over `most` (1024) the
spacing is made wider until they fit, and that is said.

| Option | |
| --- | --- |
| `spacing` (160), `cell` (8) | how far apart by walk, and the grid the walk is on |
| `jump`, `crouch` | false: no jumps, no crouching passages |
| `paths` (16), `drop` (250), `most` (1024) | paths out of one waypoint; the highest drop a path goes down; the most waypoints |
| `mod`, `doors`, `open`, `shut`, `walls`, `from`, `bodies`, `exits` | as `reachOf` takes them |

It returns `{ waypoints: [{ origin, flags, paths, ways, tight, kind }], leftOut, facts, warnings, spacing, cell,
reach }`: `ways` says what each path is (`walk`, `drop`, `ladder`, `jump`), `tight` whether a body only just fits
along it, `kind` why the waypoint is there (`start`, `ladder`, `jump`, `landing`, `flight`, `opening`, `floor`,
`corner`, `ledge`, `drop`, `near`, `crouch`).

**What it is worth.** It is the walk test's geometry, not the bot: a line with room beside it is no proof that
the bot's steering keeps to it, a jump is the arc of `reachOf` with the engine's numbers, and doors are open.
Lifts (`func_plat`) and teleports are not waypointed (warnings say so), and what only a lift reaches is left
out; nor are the bot's other kinds (cover, sniping, health, team). Held against the waypoints people made by
hand for four of The Specialists' maps (a community's files, 2026-10-21) and against this kit's before 2026-10-22
(0.25.0), each path walked on the level measured on the compiled map, the standing body moved along its line
every 6 units and to either side:

```
map            waypoints              paths          one way down     body does not fit    under 8 beside it
               hand   0.25.0  now     0.25.0  now    hand 0.25.0 now  hand 0.25.0 now      hand 0.25.0 now
ts_hammertime   162    354    371     2148   1582     36   186   22    82   139   13       133   455   44
ts_dojo         154    341    335     2296   1668     28   186   62    75    85   19        97   237   27
ts_bikini       215    852    967     5401   5228    109   520  304   186   227   94       206   765  210
ts_lobby        251    365    407     2263   1976     54   109   25    77    64    5        94   192   25
```

(The lines are counted once for both ways; a hand-made line measured so is often a waypoint a person dropped
an inch inside a wall's clip.) 0.25.0 also put the bots' goals on the tops of crates: its first 50 waypoints
were the starts and then the jumps and their landings, in the order it laid them. They are still denser than a
person's and reach every place a person's do but those of lifts. Play the map with bots and watch where one
stands still or runs into a wall (`rcbot waypoint on` shows them).

## Decompiling (`src/maps/decompile.mjs`, `fidelity.mjs`, `texlights.mjs`)

A compiled map made back into brush source, so that a map whose source was never released (Half-Life's own)
can be opened in an editor, changed and compiled again. It is a port of `bsp2map.py` from Steven Linn's
goldsrc.net project (`godot/tools/bsp2map`, whose README tells every rule below with the map that taught it),
and writes the same text, number for number: on all 126 maps of Half-Life's `valve` folder the two outputs are
the same but for their first line, and so are the `.wad` files of the textures the maps carry inside them. The
port takes about a second a map (rocket_frenzy, 14171 brushes, 11 seconds), the Python ten to twenty times that.

```js
const { map, facts, warnings, wad } = maps.decompile(readFileSync("crossfire.bsp"), { name: "crossfire", folders: [valve] });
writeFileSync("crossfire.map", map);
if (wad) writeFileSync(wad.name, wad.bytes);                       // the textures only the .bsp had
console.log(maps.decompileSummary({ facts }), warnings);
```

**The method.** Each model's tree (hull 0) is walked, and every leaf that is not empty (solid, water, slime,
lava, sky) is the convex region the planes on its path cut out of the model's box: one brush, built by
clipping. So the solids are watertight and exact, split along the tree's planes; cells whose union is convex
are merged again. A brush face that lies on a node's plane wears the texinfo of the face of the same model on
that plane, facing the same way, that overlaps it most, written as Valve 220 axes, scales and offsets with
nothing lost; a brush face that spans faces of several textures is cut along their edges. A face no face
covers is `NULL` (the compilers drop it), or `sky` in a sky leaf. What a compiler refuses is mended on the way:
near-coplanar planes are unified first, no face under half a square unit, no acute wedge (snapped against its
neighbour, capped, or its tip cut), no face of over 24 corners, one content a brush, thin empty seams and the
void's pockets filled, a brush model clipped to its own box. Entities are carried over as they are, but that a
brush entity compiled round an ORIGIN brush is put back in world space with an ORIGIN brush and no `origin`
key, the worldspawn's `wad` list becomes the bare names of the files found in `folders`, and
`func_illusionary` and `env_bubbles` get `zhlt_noclip`.

| Function | Gives |
| --- | --- |
| `decompile(bytes, { name, folders, canon, tips, cuts, merge })` | `{ map, facts, warnings, wad }`. `map`: the `.map`'s text. `facts`: what was done, in counts (`brushes`, `cuts`, `merged`, `snapped`, `filled` ... and the world's `box`). `wad`: null, or `{ name, bytes, textures }`, the textures the map carries that none of its `.wad` files has, as a WAD3 named `<name>_dc.wad` and already in the `wad` key (a map with no `wad` key, compiled with its textures inside, gets one). Without `folders` every listed `.wad` name is kept and every texture inside goes into the own `.wad`. `canon`, `tips`, `cuts`, `merge`: `false` turns one rule off, to see what it does (bsp2map's `BSP2MAP_NO_*`) |
| `decompileSummary(result)` | bsp2map's line of counts |
| `textureFidelity(original, recompiled)` | In per cent of the seen original face area: `matched` (a recompiled face at the same spot), `same` (of that, wearing the original's texture), `texinfo` (of that, laid as the original's), `covered` (solid in the recompile before it), `unseen`; and `boxmove` (the largest shift of a brush entity's box), `lostModels`, `lost` (textures worn nowhere). texcheck.py's measure; `fidelityLine(r)` its summary column |
| `lightParity(original, recompiled)` | `{ all, up, side }`, each `{ faces, retail, ours, ratio }`: the mean style-0 light at the centres of the original's world faces, in both maps. lightcheck.py's measure |
| `TEXLIGHTS`, `TEXLIGHTS_BY_MAP`, `NOT_EMITTERS`, `texlightsFor(map)`, `texlightsRad(map)`, `texlightsEntity(map)`, `TEXLIGHT_RAD_ARGS` | The texture lights of Half-Life's maps, calibrated against the retail lightmaps by goldsrc.net: the list, each map's own values over it, as a `lights.rad` (`compileMap(file, { args: { hlrad: ["-lights", rad, ...TEXLIGHT_RAD_ARGS] } })`) or as the keys of an `info_texlights` |

**Measured** (2026-10-14, SDHLT, hlvis `-fast`, hlrad with the texture lights): frenzy, crossfire and c1a0 decompiled
and recompiled come back 100.0 matched, 100.0 the same texture, 100.0 the same texinfo, nothing covered, every
brush entity there (crossfire: 1232 brushes, 4067 faces looked at), the same numbers texcheck.py gives for the
same pair. Their light, ours over retail: frenzy 0.91, crossfire 1.19 (sunlit), c1a0 0.93.

**What is lost by construction**: brushes of clip only (hulls 1 to 3 carry no textures, and the compilers make
them again from the solids), the mapper's own split of the brushes, and the light, which the compile works out
again from the light entities and the texture lights. A map's brushes are many more than its mapper drew
(the tree cuts every solid along planes from elsewhere). And a decompiled game map is still the game's: rule 7
of `AGENTS.md` holds for it as for the `.bsp`.

## Checking (`src/maps/check.mjs`)

`checkBsp(bytes, { engine = "goldsrc", folders })` gives `{ errors, warnings, facts, counts, resources }`, the
first three lists of sentences as `check` gives for a model. Nothing is thrown for what is wrong with the map:
a file that is cut short, or is not a GoldSrc map, is reported as an error.

- **Errors**: a lump outside the file, or not a whole number of entries ("funny lump size"); a count over what
  the engine holds; a number that names something the map does not have; a face's light past the end of the
  light; a lit face too wide for GoldSrc; a texture whose side is not a multiple of 16; a value too long; an
  entity on a model that is not there; with `folders`, for GoldSrc, a listed `.wad` that is not found.
- **Warnings**: a count over three quarters of a limit; no light or no visibility; textures wanted and not
  found; models that belong to no entity; entities with no classname; the Blue Shift layout.
- **Facts**: the counts, the world's bounds, the light and its styles, the textures inside and those wanted
  from `.wad` files with the files listed, the entities by class, and the models, sprites and sounds the
  entities name (also in `resources`: `{ models, sprites, sounds }`).

`folders`: the game's folders, the mod's own and then `valve`. With them, the `.wad` files and the textures are
looked for; without, the map's wants are only listed.

`checkBsp(bytes, { mod, definitions })` also holds the map's entities against the game that will read them: see
the next section. `mod` is the mod's profile, which gives the folders too; `definitions` are entity definitions
with no profile, or beside its own.

## Entities against a mod (`fgd.mjs`, `learn.mjs`, `dll.mjs`, `mod.mjs`, `rules.mjs`)

An entity is text, and the game takes from it only what its code asks for. A class it does not have is
dropped, a key it never reads does nothing, a name nothing answers to fires nothing, and none of it is said
where anyone looks. `checkPlan` (brush source) and `checkBsp` (a compiled map) look, when they are given
**`mod`** (a profile) or **`definitions`**; `checkEntities(map, { mod, definitions, folders })` is that part by
itself, for a plan or for what `readBsp` gave, and returns `{ errors, warnings, facts }`. Entities are numbered
as everywhere else: the world is 0.

**Where the definitions come from.** Three sources, each plain data, used alone or side by side
(`joinDefinitions`, or a list given as `definitions`):

| | | What it knows | What it is worth |
| --- | --- | --- | --- |
| `definitionsOf(file.fgd, ...)` | The FGD an editor is told the game's entities by. `readFgd(text)` reads one file's classes as they stand, `loadFgd(file)` follows its `@include`s (found whatever their capitals; those not found are in `missing`) | Classes, point or brush, each key with its type, choices, flags and default, a class's `size(...)` and `studio(...)` | What its author wrote down. FGDs forget classes and keys, and give a key a type its values never have |
| `learnEntities(folder, { cache, except })` | A mod's own maps: `<mod>/maps`, or a list of `.bsp` files. Only each map's header and entity text are read: a hundred maps in under a second. `cache` names a file to keep the answer in, read again until a map of the folder changes | Each class with how often and in how many maps, how many times a point and how many of brushes; each key with how often, how many of its values are numbers, and its six commonest values; `always` (the keys every entity of the class gives) and `together` (keys the very same entities give) | What the mod's authors really wrote, mistakes and all: a class one map misspells is learned too. "Never seen in any of the mod's 100 maps" is a reason to look, not a proof |
| `definitionsOfDll(file.dll)`, `classesOfDll(bytes)` | The game's own program, `<mod>/dlls/*.dll` (the `gamedll` line of its `liblist.gam`). The engine makes an entity by calling the function of that library that bears the classname, so its exported names are the classes that exist | Which classes exist, and nothing of their keys | Certain, for classes. A Windows `.dll` only; a Linux `.so` is refused |

`entitiesOfFile(file)` is the fast reader by itself (one map's entities, or null), for asking a folder of maps a
question of your own.

**What is told**, with definitions:

- **A class that is not defined**: an error with an FGD; a warning when the definitions are only learned,
  with the count; a warning too for a class no FGD has and only one of the mod's maps. With the game's program
  among the definitions, the program alone decides: a class it does not export is an error whatever an FGD
  says, and a class it exports is no fault though no FGD and no map has it (its keys are then not looked up,
  and a fact says so). A class or a key written in other capitals than the definitions is told as that.
- **A point class given brushes, a brush class given none**: warnings.
- **A key the class does not define**: a warning, in one sentence for all of them, each `key on class` with
  how many entities. A key the mod's maps give that class is not told, whatever the FGD lacks; nor are the
  keys the engine reads for every entity (`origin`, `angles`, `rendermode`, `health`...: the profile's
  `engineKeys`), the compilers' own (`zhlt_*`, `_light`, `light_origin`) and a `multi_manager`'s, which are
  the names it fires.
- **A value that is not of its key's type**: not a whole number, not a number, none of its choices, a flag the
  class does not define, not a colour, not three numbers. Not told when the mod's own maps do the same (more
  than 1 in 20 of their values, or one of the six commonest): the FGD is then the one that is wrong.

and always, with a profile or with definitions:

- **A name nothing answers to**: a `target`, `killtarget` or `master` (and any key of the type
  `target_destination`, and the profile's `targets.keys`) that is no entity's `targetname`. A warning. The
  targetnames that nothing in the map names are listed as a fact, not a warning: the game's code or a script
  may fire them.
- **The profile's rules** (below).
- **The files**, when the game's `folders` are known: every model, sprite and sound an entity names, the six
  pictures of the worldspawn's `skyname` (`gfx/env/<name>up.tga` or `.bmp`...), for brush source the `.wad`
  files, and what the profile's `files` adds. A file that is in none of the folders is a warning; so is one
  that is found only in other capitals than the map writes, which Windows finds and a server on Linux does
  not. `fileFinder(folders).find("models/x.mdl")` is the lookup by itself: `{ found, exact, as }`.

**A profile** is one plain object for a mod, so that `checkPlan`, `checkBsp`, `reachOf` and the pictures are
told it once (`mod:`) and not option by option. The kit ships one, `GOLDSRC`: Half-Life's own, with nothing
of any mod in it. A mod's profile is data you pass, or load from a file with `await loadMod(file, { folders,
cache })` (a `.json` file, or a module whose default is the profile or a function that makes it); a field it
leaves out is `GOLDSRC`'s. `profiles/mastersword.mjs` is one mod's, as an example beside the kit's code.

| | |
| --- | --- |
| `folders` | The game's folders, the mod's own first and `valve` last: where its files are looked for, and its textures |
| `wads` | `.wad` files whose textures a map of the mod wears: `checkPlan` looks the texture names up in them |
| `dlls`, `fgd`, `learned`, `definitions`, `classes` | Where the definitions come from: the program's library, `.fgd` files, `{ maps, cache, except }` to learn from the mod's maps, definitions that are already data, and classes written by hand (`{ name: { kind, size, keys: { key: { type } } } }`), which stand over the FGD's where the FGD is wrong |
| `starts` | The classes that are a place to start: what `checkPlan` asks for and `reachOf` walks from |
| `walkers`, `origin`, `hulls`, `bodies` | The classes that walk (`"monster_*"`); where a thing's origin is in its box (`{ starts: "middle", walkers: "feet" }`); the engine's boxes; and a class's box where its size does not say (`{ monster_bigmomma: "large" }`). A class's FGD `size(...)` is its box: `bodiesOf(mod, classnames)` gives `{ classname: { half, height, feet } }`, and a box of exactly a hull's size is walked as that hull |
| `doors` | The brush classes that open: the walk test takes them as open |
| `exits` | The classes a player leaves the map by, besides `trigger_changelevel` (Master Sword's `msarea_transition`): the walk test takes each for a way out, so floor one is reached from is no one-way place. What the caller names with `exits` is added to them |
| `modelOf` | `(keys) => "models/x.mdl"` or null: the model the game gives an entity that names none in its own keys, from whatever the mod keeps it in (Master Sword: the `setmodel` of the monster's script, `scriptModel` in its profile). Asked only when a picture is drawn with `models`; `modelsOf(mod, map)` gives `{ number: model }` for a map |
| `off` | Classnames that switch an entity off on purpose (`"disabled_*"`): counted in a fact, not looked up |
| `targets`, `named` | `{ keys, others }`: the keys that name another entity, and the classes whose every other key is a name they fire; the names the game itself fires |
| `files` | More keys that name a file: `{ classes, key, keys, folders, unless, what }` (`keys: "*.mp3"` for a class whose keys are themselves file names) |
| `rules` | The mod's own rules |

`withMod(options, map)` is what the walk test and the pictures do with `mod`: the profile's `starts`,
`folders`, each class's box (under the caller's own `bodies`), its doors (as `open`), its `exits` and, when
`models` is asked for, the models its `modelOf` gives (as `modelsBy`, under any the caller names). `definitionsFor(mod)`
gives the definitions a profile comes to; `modOf(mod)` the profile made whole.

**Rules** are a mod's quirks as data, each with `why`, which is put into its sentence, `classes` and `level`:

| | |
| --- | --- |
| `{ rule: "limit", key, most, of, to }` | No more than `most` entities (of the classes `of`) may name one other (of the classes `to`) by `key`: monsters in a spawn area. An error |
| `{ rule: "beside", key, needs, unless }` | `key` does something only beside the key `needs`; a value of `unless` (`["", "0"]`) is no use of it |
| `{ rule: "bands", key, among, whole, separator, words, open }` | The ranges `key` holds (`"0;150"`, `"150;500"`, `"500"`) among the entities that share the keys of `among` (`["spawnarea", "origin"]`: one place of one area) must meet and not overlap. `whole`: of whole numbers, `1;200` meets `201`. `open`: the name of a key by which a map says a range is left empty at that place on purpose (`docs/MAPS-CHECKS.md`) |
| `{ rule: "finite", classes, when, counted, count }` | An entity of `classes` that gives the key `when` counts the entities that name it by `counted`: each must give `count` as a number over 0 |
| `{ rule: "names", classes, key, required, of, among, what }` | The value of `key` is the name of something that exists: the `targetname` of an entity of `of.classes` in this map, or a name the function `among(name, entity)` knows (true, false, or a sentence on why not). This is where a mod says how a script's or an item's name is resolved. `required`: an entity without the key is told too |
| a function `(entities, tools) => [{ level, text }]` | For what no kind covers. `entities`: `[{ number, classname, brush, pairs, get(key), named }]` (`entitiesOf(map)`) |

## Limits

`MAP_LIMITS` holds them; the comment over it in `check.mjs` says where each number is from.

| | GoldSrc | Xash3D FWGS | Why |
| --- | --- | --- | --- |
| planes | 32767 | 131072 | GoldSrc reads a face's plane as a signed 16 bit number |
| nodes | 32767 | 32767 | a node's child is a signed 16 bit number, and under 0 is a leaf |
| clipnodes | 32767 | 32767 | the same, and under 0 is a contents |
| leaves | 32767 | 32768 | GoldSrc's visibility row; the compilers of the SDK stopped at 8192 |
| vertices | 65535 | 65535 | an edge names them with 16 bits |
| faces | 65535 | 65535 | a node names them with 16 bits. GoldSrc reads the faces of a leaf as signed: in the world, in practice 32768 |
| marksurfaces | 65535 | 65535 | a leaf names its first with 16 bits |
| texinfo | 32767 | 65535 | GoldSrc reads a face's as signed |
| edges, surfedges | not bounded | 1048576, 2097152 | |
| models | 512 | 2048 | in GoldSrc the brush models share 512 slots with every `.mdl` and `.spr` the game loads on the map |
| textures | not bounded | 2048 | |
| entities | not checked | 8192 | GoldSrc's own bound is how many the game has alive at once, which the file does not tell |
| entity text | not bounded | 2 MB, and 32 bytes at the least | |
| texture, light, visibility bytes | not bounded | 32 MB, 32 MB, 16 MB | |
| a lit face's width | 512 texture pixels (256 for the software renderer) | not bounded | 33 samples of light a side |
| a texture's sides | multiples of 16 | | |
| a key, a value | 31 letters (the compilers), 1023 (the engine) | the same | |

Valve's SDK lists smaller numbers for some of these (8192 leaves, 400 models, 512 textures, 2 MB of light):
they bound its old compilers, not the engine, and today's maps pass them.

## What is not read

- **BSP30ext and BSPX**: Xash's block of extra lumps after the header (`XASH`) and other tools' after the
  lumps (`BSPX`): coloured or directional light, per-face light scale, clipnodes of 32 bits. `checkBsp` says
  when a map has them; nothing reads them.
- **Quake 1 (29), BSP2, Quake 3 and Source maps**: refused.
- **Decals, sprays, menu pictures and fonts** in `.wad` files: listed in `others`, not decoded.
- **The engine's gamma** over the light, and the brightness of each light style over time: `faceLightmap` gives
  the samples as stored.
- **Traces**: there is no "what does a line from here to there hit", only what is at a point, the floor
  under one, and whether a straight line is clear (`spaceOf(map).sees(from, to)`).
- **The sprites and sounds** an entity names are listed, and looked for on the disk only with a `mod` or
  `definitions` and the game's folders ("Entities against a mod"); none of them is opened, but a sprite
  by the pictures, which draw it when they are given `folders`.
- **What the game's code does with a key**: the definitions say which keys a class has, not what each does.
  A mod's quirk is checked only where its profile has a rule for it.
- **A Linux game library** (`.so`): the classes a game has are read from its Windows `.dll`.
- **Brush entities in the world's answers**: `contentsAt`, `floorUnder` and `leafAt` ask one model at a time.
