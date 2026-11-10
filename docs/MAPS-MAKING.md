# Making a map

A GoldSrc map starts as text: a `.map` file that lists brushes (convex solids, each written as the planes that
bound it) and entities (a light, a door, a place to start). Four outside programs, the compilers, turn that
text into the `.bsp` the game loads. This part of the kit writes the text from a script, looks it over before
any compile, runs the compilers when they are on the machine, and reads what they say.

You do not place brushes by hand. You describe rooms as boxes of empty space and the kit carves them out of
rock; you add what stands in them from a small vocabulary; you check, compile and look.

- `src/maps/source.mjs`: brushes, entities, the file written and read
- `src/maps/plan.mjs`: the check before compiling, and the leak hint
- `src/maps/mod.mjs`, `rules.mjs`, `fgd.mjs`, `learn.mjs`, `dll.mjs`: the mod the map is for: its profile, its
  entity definitions and its rules, which the check holds the entities against ("A mod's profile", below)
- `src/maps/reach.mjs`: the walk test: what a player reaches on foot, what stands in something solid, the openings
- `src/maps/compile.mjs`: finding and running the compilers
- `src/maps/draw.mjs`: pictures of the source before a compile, and of the result (`docs/MAPS.md`, "Pictures")
- `examples/07-a-small-map.mjs`: two rooms, a doorway with a step, a window, lights, a start, in a hundred lines

## What it needs

- **Node 18 or later** for everything but the compile itself.
- **A `.wad` file** with the textures the map names. A map only names its textures; the pictures are in a .wad
  (Half-Life's `valve/halflife.wad`, a mod's own, or one made with this kit: `writeWad` in `src/maps/wad.mjs`).
- **The compilers, to compile**: VHLT, also known as Vluzacn's ZHLT v34 (`hlcsg`, `hlbsp`, `hlvis`, `hlrad` and
  their `zhlt.wad`), or SDHLT, seedee's fork of them that builds on Linux with CMake (`sdHLCSG`... and
  `sdhlt.wad`, found under either name). They are an outside program and no part of this kit. The person installs them once and
  names their folder in the `VHLT_DIR` environment variable (or puts them on the PATH, or you pass
  `findCompilers({ folder })`, or `--vhlt <folder>`). SDHLT's own folder may be named as it unpacks: its programs are
  found under `tools/Win64` (`tools/Linux`) by themselves. Without them the map is still written, read and checked; `compileMap` says in
  one sentence that it needs them. Ask the person where they are before assuming there are none.
- **A map for Xash alone (BSP2)**: SDHLT's goldsrc fork, `github.com/2cwldys/sdhlt` (branch `goldsrc`; no
  release, built with CMake: `cmake -B build -DSDHLT_64BIT=ON`, `cmake --build build --config Release`, the programs
  in its `tools/`). It alone takes `compileMap({ engine: "xash", format: "bsp2" })`: Xash3D FWGS's limits instead of
  GoldSrc's (524,288 vertexes, 262,144 faces, 2,048 brush models), in a file GoldSrc cannot load.

## The loop

1. **Describe.** Rooms as `{ min, max }` boxes of empty space; pieces that stand in them; entities.
2. **Write.** `writeMap({ worldspawn, brushes, entities })` gives the text; write it to `name.map` in a working
   folder of your own.
3. **Check the plan, and look at the source.** `checkPlan(map, { textures })`: fix every error (each is
   something the compilers refuse or mend without a word) and read the warnings; one of them is the leak
   hint. For a mod, `checkPlan(map, { mod })` with the mod's profile: the entities are then held against the
   game that will read them (a class it does not have, a key it never reads, a name nothing answers to, the
   mod's own rules, a file it lacks), none of which a compiler or a picture shows ("A mod's profile"). Then
   draw it: `planOfSource(map)` (a cut through the brushes, every entity marked) and
   `drawSource(map, { from, yaw })` (a view in flat colours). They need no compilers and take a tenth of a
   second: stairs that stand in front of a doorway, a window in the wrong wall and a start outside its room
   show here, before the minutes of a compile.
4. **Walk it, and cut it.** `reachOf(map)` says which entities a player cannot reach on foot from the places
   to start and what it would take, which stand in something solid, how wide and high each gate and
   doorway is, and where a player gets in and not out again (a pit, the foot of a slope too steep to climb);
   `planOfSource(map, { reach, heights: true })` tints the walked floor green, the rest red and such a place
   amber. `reachOf(map, { jump: true })` walks it with jumps, and tells what only a jump reaches: a roof, a
   wall's top, the far side of a gap.
   `sectionOf(map, { from, to })` cuts the map upright along a line, and `storeysOf(map)` lays its storeys
   side by side: a room filled by another room's rock, a stair that ends in a ceiling and a monster sunk in
   its floor show there and on no single plan (`docs/MAPS.md`, "The walk test" and "Pictures").
5. **Compile.** `compileMap("name.map", { wads })`. Seconds for a few rooms, minutes for a large open map.
6. **Read what came back.** `result.errors` (sentences), `result.leak` (where), `result.warnings`. `result.bsp`
   is null unless all four programs went well, and nothing is written where the .bsp goes on a failure.
7. **Look at the result.** A map that compiles can still be dark. `planOf(bsp)`, `viewsOf(bsp)` and
   `drawMap(bsp, { from, yaw })` draw it with its textures and its own baked light (`docs/MAPS.md`,
   "Pictures"): a lamp's colour, a room left black and a grate's holes show; with the game's `folders`, the
   sky's own picture and the sprites, and with `models: true` the models, each with its textures, where and
   how its entity's keys put it: what a tree's crown hides is seen. `reachOf(bsp)` walks it again by
   its own clip hulls, which hold the `clip` brushes too. Then the game is the real test: `map name` in its
   console.

```js
import { writeFileSync, readFileSync } from "node:fs";
import { carve, box, light, playerStart, writeMap } from "./smak/src/maps/source.mjs";
import { checkPlan, wadTextureNames } from "./smak/src/maps/plan.mjs";
import { compileMap } from "./smak/src/maps/compile.mjs";

const WAD = "C:/games/Half-Life/valve/halflife.wad";
const wears = { floor: "C1A0_LABFLR", ceiling: "C1A0_C1", wall: "C1A0_LABW4" };
const HALL = { min: [0, 0, 0], max: [320, 256, 160] };
const STUDY = { min: [352, 0, 16], max: [608, 256, 144] };                 // its floor is 16 higher: a step up
const DOORWAY = { min: [320, 96, 16], max: [352, 160, 112] };              // 64 wide, 96 tall, through 32 of rock
const map = {
  worldspawn: { wad: [WAD] },
  brushes: [...carve([HALL, STUDY, DOORWAY], 16, wears), box([296, 96, 0], [320, 160, 8], wears.floor)],
  entities: [playerStart([96, 128, 0], 0), light([160, 128, 136]), light([480, 128, 120], { color: [255, 214, 170] })],
};
writeFileSync("work/small.map", writeMap(map));
const plan = checkPlan(map, { textures: wadTextureNames(readFileSync(WAD)) });
console.log(plan.errors, plan.warnings, plan.facts);                       // fix every error before compiling
const result = compileMap("work/small.map", { wads: [WAD] });
console.log(result.errors, result.leak?.at, result.warnings, result.bsp);
```

The same from the command line, for a `.map` that is written: `smak map-plan small.map -o plan.png`,
`smak map-view small.map -o view.png --from 96,128,64 --yaw 0`, `smak map-reach small.map -o walked.png`,
`smak map-section small.map -o cut.png --from 0,128 --to 608,128`, `smak map-storeys small.map -o storeys.png`,
`smak map-openings small.map -o doors.png`, `smak map-compile small.map -o small.bsp --wad halflife.wad`, then
`smak map-plan small.bsp -o plan.png` and `smak map-views small.bsp -o views.png`.

### What each step asks of you

`examples/07-a-small-map.mjs` is the template. Never write over a map of the game's: write a new file.

- **Before the first brush, read `docs/MAPS-DESIGN.md`**: a map that parses, compiles and is walked end to end
  can still be one a player calls "all straight lines" and leaves. It has the rules of thumb (shape, height,
  landmarks, light, sound, monsters, rewards), read from a game's own maps, and the recipes
  (`kits/encounterkit.mjs`) that bring monsters in out of sight.
- **Describe.** A room may bring its own textures, `{ min, max, texture: { floor, ceiling, wall } }`: one carve
  then makes a street of brick and asphalt with a shop of tiles behind one wall 16 thick.
- **Check the plan for a mod, with its profile**: `checkPlan(map, { mod })` (`smak map-check x.map --mod
  <profile>`). A map's entities are text that only the game's code reads, and what that code does not know it
  drops without a word: a class the mod does not have, a key on an entity where the game never reads it, a name
  nothing answers to, more monsters than an area holds. Neither a compiler nor a picture shows any of it. With a
  profile the check does: against the mod's FGD, its own maps (`smak map-learn <mod>/maps -o learned.json
  --class <name>` shows how the mod's authors write a class: copy that, do not guess), the classes its program
  has, and its rules. The kit ships Half-Life's profile (`maps.GOLDSRC`) and no mod's own: "A mod's profile",
  below, is how to get from nothing to a checked one, and `profiles/mastersword.mjs` is one mod's, as the
  example (`profiles/specialists.mjs` a second: The Specialists, its arenas and, as `specialists-roleplay.mjs`,
  the role-play cities). **Never write an entity for a mod from memory.**
- **Walk it**: fix every entity that is not reached or stands in something solid, mend or mean every one-way
  place, and read each opening's width and height against what has to pass it (a player 32 x 72, a large
  monster 64 x 64). Walk it once more with `{ jump: true }` (`--jump`) and read what only a jump reaches. Cut a
  section through every stair and every place where one room lies over another: rooms carved in separate
  `carve` calls fill each other with rock where their blocks overlap, and only a section or the walk test
  shows it.
- **Compile**: it needs VHLT; ask the person where it is. A **leak** names the entity it was found from and
  where the trail leaves the world: look at the wall there.
- **Look at the result**: `smak map-plan`, `map-views`, `map-view` on the `.bsp`; with `--game` and `--models`,
  the sky, the sprites and the models as the game will show them. `smak map-check` and `smak map-reach` too:
  the compiled map is walked by its own clip hulls. For a mod with spawn areas, `smak map-spawns --mod` (no
  monster seen appearing, no races at war on one spawn, the reward where the fight was won) and `smak
  map-character --mod` (no five figures on the plain side of the mod's own maps). For a role-play map, `smak
  map-wiring`: every door a property by its name, switches at what they mean to work, no switch at a name
  nothing answers to, lifts that stop where they are called.
- **The game is the real test.** Tell the person the file, where it goes (`<mod>/maps/`, its `.wad` beside the
  mod's unless the compile was `--wadinclude`), and `map <name>` in the console. A mod may want its own
  entities to start a player (Master Sword: `ms_player_begin` and `ms_player_spawn`): its profile's `starts`
  say which, and with no profile the plan check and the walk test count Half-Life's two and those two, as they
  did before there were profiles. Say what the entity check went by (an FGD, the mod's maps, its program, which
  rules), and what the walk test could not tell: whether a monster is dropped to its floor, whether a jump it
  found is one a player makes in the game, anything a script does.

## Units and sizes

Axes: `+x` east, `+y` north, `+z` up. A unit is about an inch. Keep to whole numbers, and to multiples of 8 or
16 where you can: it is what the editors' grid does, and what keeps planes exact.

| | |
| --- | --- |
| A player, standing | 32 wide, 72 tall. Its origin is the middle of that box: 36 above the floor. Eyes at 64 |
| A player, crouching | 32 wide, 36 tall |
| A doorway | about 64 wide and 96 tall. A standing player needs 32 by 72 and not a unit less; make it roomy |
| A step | 18 at most is walked up without a jump. Stairs: 8 to 16 high, 16 to 32 deep |
| A jump | clears 45; with the legs drawn up, 63. At a run it carries the body's middle 215 along, landing level: a gap of up to about 240 between its two edges is jumped (`docs/MAPS.md`, "The engine's numbers") |
| A corridor | 96 to 128 wide, 112 to 128 high |
| A room's ceiling | 128 low, 160 to 192 usual, 256 a hall |
| A wall | 8 to 32 thick. Carved rooms need at least a few units of rock between them |
| A slope | walked while its normal's z is 0.7 or more: up to 45.6 degrees, a rise of 98 in 100 along. Steeper, a player slides down it and cannot walk up |
| A texture | drawn 1 texel a unit at scale 1. A 128 wide picture repeats every 128 units |
| The light | worked out once every 16 units of a face: nothing finer than that shows in a shadow |
| The world | everything within 4096 of the origin on each axis (`SOURCE_LIMITS.range`, and why) |

**Hulls.** The engine collides by moving one of four boxes through the map (`docs/MAPS.md` has the table: a
point, a standing player, a large monster, a crouching player). A gap a box does not fit through is closed to
whatever moves with it: a 48 wide gap lets bullets and light through and no monster of the large kind; a 40
high duct lets a crouching player through.

## The vocabulary

Every builder takes a `texture` last (see "Textures") and returns a brush `{ faces }`, or a list of brushes
where it says so. Spread lists into the map: `brushes: [...carve(...), box(...)]`.

### Brushes

| | |
| --- | --- |
| `box(min, max, texture)` | A box from its least corner to its greatest |
| `box(min, max, texture, { bevel, edges })` | With `bevel`, its edges cut at 45 degrees by that many units (1 to 0.45 of the box's smallest side; a whole number keeps the corners on the grid): `edges` "all" (12), "vertical" (a post), "top", "bottom", or joined by "+". 6 faces and one for each edge cut |
| `extrudeProfile(profile, from, to, texture, { axis, up, snap })` | A 2-D outline of any shape (an L, a cove, a section) drawn out: `from` and `to` numbers, along `axis` as `prism`; or points, along that line. A concave outline is cut into convex parts (`convexParts`): a list of brushes |
| `sweepProfile(profile, path, texture, { up, closed, snap })` | The outline along a path of points, one brush a part and segment, mitred at the bends: a cornice, a rail, a rounded roof. `closed`: a loop |
| `roundedBox(min, max, texture, { radius, steps, axis, snap })` | A box whose edges along `axis` (the upright ones) are rounded, `steps` sides to a corner (1 is a 45-degree cut) |
| `loftBrush(ringA, ringB, texture)` | One convex brush through two rings of 3-D points (a tapering post, a flared base) |
| `brushFaults(brush, { minEdge, minArea, maxFaces })` | Sentences for a brush the compilers cut down: a face under 4 square units (`MIN_AREA`), an edge under 1 (`MIN_EDGE`), over 32 faces (`MAX_FACES`: a shape with more curves is a model). The builders above throw on these, so a profile needs features of 2 units or more |
| `solid(points, texture)` | Any convex solid from its corners; the faces are found, and turned outwards, for you. Points that are not the corners of a convex solid are refused in words |
| `prism(axis, outline, from, to, texture)` | A convex 2D outline drawn out along `"x"`, `"y"` or `"z"`: a chamfer, a beam at a slant, a corner cut at 45 degrees. The outline's two numbers are the other two axes in order: (y, z) along x, (x, z) along y, (x, y) along z |
| `fitted(name, [w, h], min, max, { whole, repeat, scale, readable, faces, rest })` | A picture fitted to a box as a mapper fits one by hand, for `box`'s texture: on each face its corner on the face's corner (top left as seen; on a floor, north west), so a band's edge falls on the brush's edge. `whole: true` one picture across each face (a sign, a door, a vault's door), `"u"` or `"v"` one way only, `repeat: [across, up]` so many; `readable` flips the north and west faces, where the world's grid runs a picture right to left, so words read on every side; `faces` the faces that wear it, `rest` the others. Stock maps have 50 to 95 in 100 of their faces shifted off the world's grid so; a box laid on it, none |
| `wedge(min, max, high, texture)` | A ramp: the box cut from one bottom edge to the opposite top edge, rising towards `"+x"`, `"-x"`, `"+y"` or `"-y"`. `{ under: true }` hangs it: a sloped ceiling |
| `cylinder(axis, centre, radius, from, to, texture, { sides, turn, snap })` | A column of `sides` flat sides (12). `radius` may be `[a, b]`, an oval |
| `cone(axis, centre, radius, from, to, texture, { sides, top })` | To a point at `to` (below `from`: it points down), or cut off at radius `top` |
| `arch(axis, { centre, radius, outer, angles, pieces }, from, to, texture)` | A curve of straight convex pieces, one brush each. `outer` a number: a ring (a vault, a curved wall). `outer: { min, max }`: what is left of that rectangle outside the curve, the masonry round an arched opening. `centre`, `min` and `max` are two numbers each, the other two axes in order as for `prism`: through a wall along x, `(y, z)`. An arch over a doorway 64 wide from y 128 to 192, springing at z 80: `arch("x", { centre: [160, 80], radius: 32, outer: { min: [128, 80], max: [192, 112] } }, 384, 416, texture)`, with the doorway carved 112 high. Returns a list |
| `bend({ centre, inner, outer, floor, ceiling, wall, angles, pieces }, texture)` | The shell of a passage that turns in plan: floor, ceiling, two walls. Its ends are open and flat; at multiples of 90 degrees they meet a box-shaped room exactly. Returns a list |
| `stairs(min, max, high, texture, { steps, rise, top, tread, ramp })` | The box filled with steps climbing towards `high`. A step over 18 is refused. Returns a list. As it always was, the highest step is level with the top of the box (where the upper floor goes on, it is only more floor) and the run is shared among the steps (off the grid when it does not divide). `top: false`: no such step, the last riser climbs onto the upper floor, each step a slab of its own tread; `tread: 24`: each step that deep, laid from the high side, so that the steps stay on the grid (the box's run over them is floor); `ramp: "CLIP"`: a CLIP wedge on the nosings, last in the list, so that the flight is walked up smoothly (shots still meet the steps); `open: 8`: each step a tread that thick with nothing under it (a fire escape, an open-riser stair) |
| `terrain({ min, max, step, base, height, texture, axis })` | Carved rock: a grid in plan, two triangles a cell, one brush a triangle from the flat `base` to `height(x, y)`. `base` above the heights hangs it from a ceiling; below, it is ground. `axis: "x"` or `"y"` stands it up: a cliff's face, a cave's rough wall (`min`, `max`, `step` and `height(a, b)` then in the other two axes, as a prism's). Returns a list |

### Rooms

| | |
| --- | --- |
| `carve(rooms, wall, texture)` | One block of rock round all the rooms (`{ min, max }` each), with the rooms taken out. Rooms that touch or overlap join; a doorway or a window is one more small room through the rock. **It cannot leak.** `texture`: `{ floor, ceiling, wall }`. A room may bring its own, `{ min, max, texture }`: the rock it is seen from wears it (a street's brick front, a shop's tiles behind it); a slab seen from two rooms of different textures is cut where they meet. Returns a list |
| `carvePlan(spaces, wall, texture)` | `carve` for spaces of any outline: each `{ outline, floor, ceiling, texture }` (or `outlines`: several that join; `rings`: one with holes, a yard round a well). The walls follow the outlines at any angle; what is not a space is rock, so **it cannot leak**. A space whose ceiling wears `sky` is open to it (the rock over it is sky all round, as the compilers want). Overlapping and touching spaces join; a corner that turns less than a degree is made straight. An outdoor space's `horizon` (units over its floor): the rock round it stands that high, sky over it, as the game's outdoor maps have it. Returns a list of upright convex prisms |
| `path(points, width, { ends, mitre })` | A street, a tunnel, a track: the outline `width` wide along a line of points, mitred at each corner, to be a space's `outlines` |
| `curve(points, { pieces, closed })` | A smooth line through points (a track that bends, a river's bank); `closed`: an outline |
| `circle(centre, radius, { sides })` | A round outline (a plaza, a well, a tower) |
| `readSvgSketch`, `readPngSketch`, `sketchSpaces`, `sketchMap` | A map from a drawing: `docs/MAPS-SKETCH.md` (and `smak sketch`) |
| `convexPieces(space)` | A space's ground cut in convex outlines: a brush that fills its shape (water, a trigger, a floor of its own) |
| `slope: { rise, toward }` on a space | Its floor a ramp across it (`slopePlane(space)` gives its height at a point) |

### Pieces made to measure

Each returns brushes; each refuses, in words, what a player could not walk.

| | |
| --- | --- |
| `spiralStairs({ centre, inner, outer, from, to, start, turn, rise, tread, thick, column, texture })` | Steps round a column, each at most `rise` (16) up, `tread` (32) deep at their middle; refused when the turn above leaves less than a player's height. → `{ brushes, top }` |
| `bridge({ from, to, z, width, thick, rails, piers, ground, texture })` | A deck at any angle with railings, and piers down to `ground` |
| `sconce({ at, facing, width, height, depth, glass, metal, shape, plate })` | A wall lamp: a shade of glass on a plate (`plate: false`: the shade alone, fewer faces where many are seen at once), standing out of the wall at `at` (the shade's foot on the wall's face) the way `facing` says (degrees, any angle), `shape` "fan" (faceted, opening upward), "drum" or "box". Its glass is a light's texture: name it in the map's texture lights (`textureLights`, a mod's lamps) and the lamp is seen and lights, as the game's makers light their rooms. → `{ brushes, light }` (`light`: where a light entity of its own goes, if one is wanted) |
| `chandelier({ centre, top, drop, radius, tiers, tier, sides, glass, metal })` | A lamp hung from a ceiling at `top`: a canopy, a rod `drop` long, tiers of glass narrowing down to a glass point. → `{ brushes, light, low }`: keep `low`, its lowest point, over a head where a player walks |
| `railing(points, { z, height, thick, texture })` | A rail along a line, a post at each corner |
| `balcony({ wall: [a, b], depth, z, rails, texture })` | A floor standing out to the left of the wall's line a → b, railed round |
| `brokenWall({ from, to, thick, bottom, top, low, pieces, gaps, seed, texture })` | A ruin's wall: a jagged top, `gaps` of it fallen |
| `rockWall({ from, to, bottom, top, depth, cell, seed, texture })` | Rough rock standing out to the left of a line: a straight wall made a cave's or a cliff's (in a `func_detail`) |
| `cliffWall({ from, to, bottom, top, rise, foot, seed, texture, clear })` | A cliff along a line: pieces 96 to 224 along, each two facets meeting in a ridge and leaning back from a foot up to `foot` out, some bent half way up, some with a scree; tops from `top` to `top + rise`, uneven. Never under `top`: stood before a plumb wall, it hides it. Feet keep out of the `clear` boxes (in a `func_detail`) |
| `backdropModel({ bounds, origin, gap, far, near, high, base, seed, name, texture, haze })` | The land round an outdoor map as one studio model: a ring of hills from `gap` outside the map's box out to `far`, fields and hedges near, woods, hazed to `haze` far off. The engine draws a model over the sky's faces, so it is seen over the walls (Master Sword Rebirth's Thornlands does this). Its `env_model` stands INSIDE the map, at `origin`; the worldspawn's `MaxRange` must reach `far` (the result's `far` says how much). → `{ mdl, origin, far, facts }` |
| `reliefOf({ space, others, sides, amp, bank, bankWide, wide, step, fade, seed, texture, clear, patches, lift })` | A space's floor as a field of triangles (one brush each, for a `func_detail`): hummocks `amp` high, banks `bank` high towards the rock `sides`, level at its openings and in the `clear` boxes. `patches` `[{ texture, share, wide }]` paint triangles with another ground where a noise is highest (lifted `lift` units where the ground is level). → `{ brushes, heightAt(x, y), steep, painted }` (the sketch's `relief`, `bank`, `patch` keys) |
| `scatter({ places, palette, density, clear, avoid, fringe, seed })` | Grass and flowers on cards, models, stones strewn over spaces as the game's makers strew them: in clumps, thicker by the rock (`STREWN` holds what the game's maps of each kind give). `fringe`: grass along the foot of the rock, half sunk; or several rows (a forest's edge: single trees flat and overlapping, lines of trees before them). `places` is what `sketchMap`'s result holds as `places` (each space, its rock, its ground). → `{ entities, facts }` |
| `boulder(at, ground, size, texture, seed)`, `card(at, ground, size, texture, turn, { crossed, tile })` | A stone (a convex lump sunk in the ground) and a card (two pictures crossed, fitted once to the card; `tile`: kept in shape and repeated along it) |
| `trail({ points, width, groundAt, texture, step, lift, sink, smooth })`, `smoothLine(points, times)` | A path worn into the ground along a line: a ribbon `width` wide over the ground, its middle `lift` over it and its edges `sink` under, wearing a picture of a path (`{ name, size }`: a band of dirt down it, the ground's grass at its edges) turned to run along it. Give its `func_detail` `zhlt_noclip` 1: the player walks the ground under it. → `{ brushes, along }` |
| `ambience({ places, sounds, density, seed })` | Looping sounds (ambient_generic) over spaces: `sounds` `[{ file, weight, volume: [low, high], heard: "small" \| "medium" \| "large" \| "everywhere", byWall, spacing, least }]`, `density` to each 1000 player-heights squared of floor (the game's wild maps: 0.65 to 11.55). → `{ entities, facts }` |
| `SIZES`, `ruin({ at, size, turn, groundAt, texture, kind, seed, thick })` | The sizes of the game's pieces by the kind of map (door, step, roof, ceiling, way: [lower quartile, median, upper quartile]); a ruined house of broken walls sized by them, its door's gap facing `turn`. → `{ brushes, box }` (the box to keep clear) |
| `house({ at, size, turn, groundAt, storeys, kind, jetty, eaves, pitch, chimney, set, seed })`, `HOUSE_SET` | A town's house as the game's are built: a stone footing, a ground storey of brick, an upper storey of timber and plaster jutting out, windows painted on the walls' pictures (fitted so none is cut: sizes in bays of 128), a roof of the kind's slope with eaves, gable and ridge, sometimes a chimney, a door of the kind's size with its frame and steps down to the ground. `storeys: 1` a cottage. → `{ brushes, box, door, floor, spots, lamp }`: `spots` places by its walls for barrels and carts, `lamp` where a light over its door goes |
| `fence({ points, height, post, groundAt, texture, seed })` | A fence of wood along a line: posts every `post`, two rails following the ground |
| `dressRoom({ place, use, set, base, trim, beams, torches, torchHeight, glow, vault, inlay, dais, clear, doors, gallery, spots, seed })` | A carved room (one of `sketchMap`'s `places`) dressed as the game's interiors are: a battered base and a moulding along its walls, beams across its short way on corbels (pilasters and free columns in a hall), a pitched ceiling with tie beams (`vault`), the floor's middle laid in another stone (`inlay`), a dais, torches with their fire and light, webs across cut corners, moss and chains hanging, and the things of its `use` (hall, store, bedroom, kitchen, library, crypt, passage: `ROOM_USES`, `ROOM_THINGS`), kept off the doorways (`clear`); the base stops at the doorways (`doors`) and no torch or pilaster stands before one; the torches are MSC's `TORCH` (`props/torch_med.mdl`) at `TORCH_SCALE`; a `gallery`: a ledge up a wall on posts, railed, and a stair along the wall up to it (`loose`: its steps given back a brush each, for a builder to make them rise); `spots`: places by the walls kept free for the builder (a chest that breaks, a monster's place). → `{ brushes, cards, entities, things, spots, gallery }` |
| `INTERIOR_SETS`, `pickSet(set, seed)`, `chamfered(outline, cut)` | Interiors' textures from MSC's ms_generic.wad (keep, cellar, house: lists a room picks one of each from); an outline with its corners cut back (walls that face many ways) |
| `learnDetails(texts)`, `detailText(names, table, { fallback })` | The detail texture the game's own `_detail.txt` files give each texture (the most used), and the `<map>_detail.txt` for the textures a map uses. → `Map`; `{ text, given, left }` |
| `additions(edited, made)`, `mergeMaps(...maps)` | What a person added to a map the kit made (by the brushes' planes, however the editor wrote them), and maps as one |
| `standingIn(map, { min, max }, { by, starts })` | What stands in a box of a map, moved by `by`: a building made apart, stood in its yard, without the yard's rock, its starts and its sun, to be put in another map with `mergeMaps` |
| `hollow(min, max, wall, texture)` | A single sealed room: six walls around the space asked for. Returns the six, in order: floor, ceiling, west, east, south, north |
| `subtract(box, hole)` | What is left of one `{ min, max }` box with another taken out: up to six boxes (data, not brushes) |

### Brushes changed and measured

| | |
| --- | --- |
| `moved(brushes, [x, y, z])` | A brush or a list, moved; the pictures move with their faces |
| `turned(brushes, degrees, pivot, { axis, lock, snap })` | A brush or a list turned anticlockwise (seen from above) about `pivot`: a house at an angle to its street, a part of a map turned. The pictures turn with their faces unless `lock: false`. At other than a quarter turn the corners are rounded to whole units (`snap: 1`, the default; the planes are worked out again from them, the nearest fit; `snap: 0` keeps them exact) |
| `frame({ at, yaw }).place({ brushes, entities })`, `.point(p)` | A composition made in its own coordinates dropped on the map turned `yaw` and moved to `at`: brushes (as `turned`), entities (origin turned and moved, `angles`/`angle` yaw added, brush entities' brushes placed). A whole building with its doors and lights |
| `roof(outline, { kind, pitch, overhang, thick, z, ridge, texture })` | A roof over a convex outline: `kind` `gable`, `hip`, `shed` or `flat`, `pitch` degrees, `overhang` units; the solids, their slopes wearing the picture along the face. `house` and `hipRoof` are made with it |
| `snapped(brush, grid)` | Every point of its planes rounded to the grid; refused if that breaks it |
| `offGrid(brush, grid, tolerance)` | The points of its planes that are off the grid |
| `shapeOf(brush)` | The brush worked out from its planes as the compiler does it: `{ faces, corners, min, max, volume, faults }` |
| `holds(brush, point)` | Whether a point is inside it |

### Entities

| | |
| --- | --- |
| `pointEntity(classname, origin, keys)` | A thing with a place: `pointEntity("monster_zombie", [100, 40, 0], { angles: [0, 90, 0] })` |
| `brushEntity(classname, brushes, keys)` | A thing made of brushes: `func_wall`, `func_door`, `func_illusionary`, `trigger_once`... It seals nothing |
| `originBrush(centre, size)` | The small ORIGIN brush a turning entity needs among its brushes, at its hinge |
| `playerStart(floorPoint, yaw)` | `info_player_start`, written 36 above the floor point given. A third argument names a mod's own start: a mod may want its own classes and more than one (Master Sword: an `ms_player_begin` and an `ms_player_spawn`, which `checkPlan` and `reachOf` count as starts without being asked). `smak map-entities` on one of the mod's maps shows what it uses |
| `light(origin, { color, brightness })` | A light that shines every way. About 200 lights a room |
| `spotLight(origin, { at, cone, inner })` | A cone of light, aimed at a point (or `yaw`, `pitch`) |
| `sunLight(origin, { pitch, yaw, color, brightness })` | `light_environment`: light from every `sky` face, all one way |
| `textureLights(origin, { NAME: [r, g, b, brightness] })` | `info_texlights`: every face wearing NAME shines |
| `entity(classname, keys, brushes)` | The plain form the others are made with |

Values may be numbers and lists: `origin: [0, 0, 36]` is written `"0 0 36"`. An entity is plain data,
`{ classname, origin, ..., brushes }`, so a literal object does as well as a helper.

### The file

| | |
| --- | --- |
| `writeMap({ worldspawn, brushes, entities })` | The `.map` text, Valve 220. `worldspawn`: `wad` (a list of .wad paths), `skyname`, `MaxRange`, `message`... |
| `readMap(text)` | The same structure back from a `.map`'s text, to change and write again. Valve 220 only |
| `mapNumber(n)`, `valueText(v)` | A number, and a key's value, as a map holds them |

### The plan and the compile

| | |
| --- | --- |
| `checkPlan(map, { textures, starts, range, grid, cell, mod, definitions, folders })` | `{ errors, warnings, facts, leak }` before any compile. An entity is numbered in its sentences as the pictures number it: the first of `entities` is 1. `mod`: the mod's profile, which gives the starts, the textures and the folders and has the entities checked; `definitions`: an FGD's path, or learned definitions, with no profile |
| `checkEntities(map, { mod, definitions, folders })` | The entities' part by itself: `{ errors, warnings, facts }` (`docs/MAPS.md`, "Entities against a mod") |
| `GOLDSRC`, `loadMod(file, { folders, cache })`, `definitionsOf(fgd)`, `learnEntities(folder, { cache })`, `classesOfDll(bytes)`, `definitionsOfCode(folder)` | Half-Life's own profile; a mod's read from a file; entity definitions from an FGD, from the mod's own maps, the classes its program has, and the classes and keys its C++ source reads |
| `writeFgd(definitions, { name })` | An .fgd file's text from definitions put together (`joinDefinitions(code, learned, fgd)`): for a mod with no FGD, or one behind its code |
| `leakHint(map, { cell })` | The flood on its own: `{ leak, cell, cells, from }` |
| `reachOf(map, { from, jump, slopes, exits, doors, open, shut, bodies, to, cell })` | The walk test: `{ warnings, facts, entities, unreached, stuck, hanging, oneWay, leaps, openings, routes, ... }` (`docs/MAPS.md`, "The walk test") |
| `storeyCuts(map)` | The heights to cut the map at so that every floor is seen: `[{ z, floors, area }]` |
| `wadTextureNames(bytes)` | The names in a .wad, for `checkPlan`'s `textures` |
| `findCompilers({ folder })` | `{ found, tools, folder, missing, message }`: where the compilers are, or one sentence on what is missing |
| `compileMap(mapFile, { wads, wadinclude, out, fast, vis, light, compilers, timeout, keep })` | `{ bsp, logs, errors, warnings, leak }` |
| `compileSummary(result)` | That, in a few lines for a person |

## A mod's profile

A map is made for one game, and that game reads the map's entities by its own code. What it does not know it
drops without a word: the first map drafted with this kit used three classes its mod does not have, put a key
on entities where the game never reads it, left a spawn point without the key that makes it one, named an item
by its script's path, and would have put 39 monsters in an area that holds 32. It compiled, and every picture
of it was right.

A **profile** is one plain object that says what the mod expects, and `checkPlan`, `checkBsp`, `reachOf` and
the pictures take it as `mod`. The kit ships `GOLDSRC`, Half-Life's own. A mod's own is yours to write; it is
data, kept in a file of your project. `profiles/mastersword.mjs` is one mod's, with every rule's source
written over it: read it as the example.

**From nothing to a checked profile**, for a mod the kit has never seen (say The Specialists, in
`<Half-Life>/ts`). Ask the person where the game is; everything below reads it and writes nothing into it.

1. **What classes exist.** The game's own program has the certain answer:
   `maps.classesOfDll(readFileSync("<Half-Life>/ts/dlls/mp.dll"))` lists them (the `gamedll` line of
   `ts/liblist.gam` names the file). Put the file in the profile as `dlls`.
   **With the mod's C++ source** (the server library's, `dlls/`), `maps.definitionsOfCode(folder)` reads
   more: every class `LINK_ENTITY_TO_CLASS` makes, with the keys its `KeyValue` and its bases' read, each
   typed by what the code does with the value. `smak map-fgd <dlls> -o mod.fgd --fgd <its FGD> --maps
   <its maps>` writes an FGD from all three for the person's editor, and lists the keys the code reads that the
   old FGD left out. The Specialists' source gives 192 classes, and 60 of them have keys its shipped FGD lacks.
2. **An FGD, when there is one.** Look in the mod's folder (`ts/ts_fgd.fgd`; Master Sword's is in `msc/dev/`)
   and in the editors' folders (J.A.C.K., Hammer, TrenchBroom). `maps.definitionsOf(file)` reads it; `fgd` in
   the profile. It gives the keys with their types, and each class's `size(...)`, which becomes the box the
   walk test and the pictures move it with.
3. **What the mod's own maps do**: `smak map-learn <Half-Life>/ts/maps -o work/ts-learned.json`, then
   `--class <name>` for any class you mean to use: how often it appears, the keys every one gives, the keys
   that go together, the commonest values. This is how you learn to write an entity as the mod's authors
   write it, and it stands in for an FGD that is missing or wrong. `learned: { maps, cache }` in the profile.
4. **The starts.** Which classes does a player start at? The `mpentity` line of `liblist.gam`, and in what
   was learned the classes every map has (`info_player_deathmatch` in 28 of The Specialists' 29 maps).
   `starts` in the profile.
   Beside them: `exits`, the classes a player leaves a map by (the walk test then knows a way out from a
   dead end), and `modelOf(keys)`, the model the game gives an entity whose keys name none, when the mod
   keeps that somewhere you can read (a script, a table by class): the pictures then show a monster as
   itself and not as a box.
5. **Run it on the mod's own maps first**: `smak map-check <Half-Life>/ts/maps/<name>.bsp --mod work/ts.json
   --game <Half-Life>/ts --game <Half-Life>/valve`, on three or four. The game's own maps must come out
   nearly clean. What they are told of is one of three things: a real slip of that map (a name nothing answers
   to, a file in other capitals); something the FGD has wrong, to mend in the profile's `classes`; or a rule
   of yours that is not so. A rule that the game's own maps break in numbers is the rule's fault.
6. **The mod's quirks, as rules**, each from a source you can name: the game's code where it can be read, or
   a count over its maps. Write the source beside the rule. A profile with no rules still catches the class
   that does not exist and the key nothing reads; the rules catch what only that mod does.
7. **Then your map**: `checkPlan(map, { mod })` before the compile, `checkBsp(bytes, { mod })` after it.

```js
// work/ts.json: a profile that is data. Every path is the person's own.
{
  "name": "ts",
  "folders": ["C:/games/Half-Life/ts", "C:/games/Half-Life/valve"],
  "dlls": ["C:/games/Half-Life/ts/dlls/mp.dll"],
  "fgd": ["C:/games/Half-Life/ts/ts_fgd.fgd"],
  "learned": { "maps": "C:/games/Half-Life/ts/maps", "cache": "work/ts-learned.json" },
  "starts": ["info_player_deathmatch", "info_player_start"]
}
```

```js
const mod = await maps.loadMod("work/ts.json");                  // or a .mjs module, for rules that are functions
const plan = maps.checkPlan(map, { mod });                       // its starts, its folders, its entities checked
const reach = maps.reachOf(map, { mod });                        // walked from its starts, each class in its own box
```

On The Specialists' 29 maps that profile, with no rule at all, finds no error in the entities. What it warns
of: skies written in other capitals than their files (8 maps), names nothing answers to (3), a weapon's number
that is none of the FGD's choices (2), a sky and a sound the game does not have (1 each).

A rule is data with its reason (`docs/MAPS.md` has the kinds): `{ rule: "limit", key: "spawnarea", most: 32,
to: ["ms_monsterspawn"], why: "a spawn area holds 32 monsters" }`. A mod whose entities name scripts or items
says how such a name is resolved with a `names` rule and a function: `{ rule: "names", classes: ["msitem_spawn"],
key: "scriptfile", among: (name) => items.has(name), what: "an item's name" }`. Such a profile is a `.mjs`
module whose default is a function that reads the game and returns the profile, as `profiles/mastersword.mjs`
does.

A profile may also carry the game's manner for the **figure judges** (`figureStyle`, apart from a map's
`character.figures`): which measures tell its figures from other games', and how much each weighs (`docs/API.md`,
"The figure judges"). The kit's three profiles export theirs as `FIGURE_STYLE`; `profiles/halflife.mjs` is
Half-Life's, the maps' `GOLDSRC` with the game's folders and that.

**What a profile cannot know.** It checks a map against what was written down, counted or read in the code. It
does not run the game: a key that exists and is given a wrong meaning passes, and so does a script that is
there and does the wrong thing. Say so when you report.

## Leaks, and how never to have one

The inside of a map has to be sealed from the void outside by **world brushes**. If any entity can "see" the
void through a gap, however thin, the map leaks: `hlbsp` says `LEAK`, `hlvis` has nothing to work with, the
whole map is drawn at once and the light is wrong. The programs still end with code 0, which is why
`compileMap` reads their words and treats a leak as a failure.

What does **not** seal: a brush entity (a `func_wall`, a door, a window pane), water (`!` textures), and the
compilers' marks (ORIGIN, CLIP, HINT). An entity placed outside the map is a leak too.

**Avoid leaks by construction:**

- Build interiors with `carve`. What is not a room is rock; there is no wall to forget and no corner to
  misjoin. A doorway is a small room through the rock between two.
- An outdoor place is a room too: carve it, and line its far sides and top with boxes wearing `sky`.
- Put anything that is not a box (arches, columns, terrain, house fronts) **inside** a carved or hollow room,
  as furniture. Then its gaps and off-grid corners can never open the map.
- When a curved piece must itself be a wall (a `bend`), back it with rock: carve a box-shaped room round the
  whole turn and stand the bend inside it.
- Keep entities inside rooms, a few units clear of the walls.

**When there is one.** `checkPlan` floods the space from every entity on a grid of 16 units and warns
`the map looks OPEN to the void`, with the entity it started from and the point where the way out leaves the
world. A way out it reports is real. Finding none is only a hint: a crack finer than the grid is not seen
(`cell: 4` looks closer, more slowly). The compiler's word is final: `result.leak` gives `entity` (where the
compiler started), `points` (its trail, which begins at the first opening out of that entity's space and runs
on through the void), `at` (where the trail leaves the box of the world) and `nearest` (the map's entity
nearest to that). Look at the wall near `at`; with `keep: true` the trail's `.pts` file stays in
`result.work`, and the person can load it in the game (`pointfile`) or an editor.

## Textures

A face wears a texture by **name**; the picture comes from a .wad listed in worldspawn's `wad`. What a
builder takes as `texture`:

```js
"C1A0_LABW4"                                              // every face
{ name: "C1A0_LABW4", scale: 0.5, offset: [0, 32], rotation: 90, align: "face" }
{ top: "FLOOR", bottom: "CEILING", sides: "WALL", west: { name: "DOOR", scale: [1, 0.875] } }   // by the way a face looks
(normal) => (normal[2] > 0.7 ? "GRASS" : "ROCK")          // by a rule of your own
```

- `scale`: units a texel. 1 is the picture's own size, 0.5 twice as fine, `[x, y]` to stretch one way.
- `offset`: `[u, v]` in texels, to slide the picture.
- **To fit a picture to a face** (a 96 x 96 window picture in a 64 x 64 opening on a west face from `y0` to
  `y1`, `z0` to `z1`): `scale: [(y1 - y0) / 96, (z1 - z0) / 96]`, `offset: [(-y0 * 96 / (y1 - y0)) % 96,
  (z1 * 96 / (z1 - z0)) % 96]`. A picture's columns run along the first of the face's two world axes and its
  rows run **down**: on a wall, down is `-z`.
- Without `align`, a face more than 5 degrees off every axis (a ramp, a roof, a chamfer, a turned building's
  slanted face) wears its picture in the face itself: nothing stretched. A straight face takes the world's axes.
- `align: "world"` takes the world's axes, chosen by the way the face mostly looks, as the editors' "align to
  world". Faces in one plane then line up across brushes, which walls and floors want. On a slope the picture is
  stretched (by 1.41 at 45 degrees).
- `align: "face"` lays the picture in the face itself, whatever its slope.
- A name is at most **15 letters**, one word. Case does not matter to the compilers.

**What a name's first letters mean** (the engine and the compilers go by them):

| | |
| --- | --- |
| `{NAME` | See-through where the picture has its last palette colour (a grate, a fence, leaves). Put it on a brush entity with `rendermode: 4, renderamt: 255`: on the world, or without that render mode, the game fills the holes with that colour, and a view of the result shows it so and says it |
| `!NAME` | A liquid: water, `!lava`, `!slime`. The brush is swum in, and seals nothing |
| `sky` | The sky: not drawn itself; the sky picture named by worldspawn's `skyname` shows through, and `sunLight` shines from it |
| `+0NAME` ... `+9NAME` | Animated: the frames of one picture, played in turn. `+ANAME`...: the second set a button swaps to |
| `-0NAME` ... | Tiled at random from the set, to break up repetition |
| `~NAME` | By convention, a texture that gives light (a lamp, a screen): it is a name that lists of texture lights go by; the engine does nothing with it. `+0~NAME` is both |
| `NULL`, `CLIP`, `ORIGIN`, `AAATRIGGER`, `HINT`, `SKIP` | The compilers' own (their `zhlt.wad`, which `compileMap` adds by itself): a face not drawn; a wall for players and not for bullets; a hinge; a trigger's brush; hints for visibility |

### A .wad of your own

A map names its textures; the pictures are in a `.wad`. To make one from pictures of your own:

```js
import { maps } from "./smak/src/index.mjs";
writeFileSync("mine.wad", maps.writeWad([{ name: "my_stone", image: stone }, { name: "{my_bars", image: bars }]));
```

or `smak wad-make my_stone.png "{my_bars.png" -o mine.wad`, each texture named after its file.

- An image is `{ width, height, rgb }` or `{ width, height, rgba }`, drawn by code (as the models' textures are)
  or read from a file (`unpng`). **Both sides are multiples of 16**; a name is at most 15 letters, one word.
- `{name` has holes where the picture is see-through (bars, a fence), and goes on a brush entity with
  `rendermode: 4, renderamt: 255`; the other first letters are in the table above.
- A texture is drawn one texel a unit: a 64 wide picture repeats every 64 units. Draw it to tile.
- `smak wad <file.wad>` lists a `.wad`; `smak map-textures <bsp> -o dir` takes a map's out as PNGs. A game's
  textures are its authors': do not put them, or a map compiled with them inside, in anything shared
  (`AGENTS.md`, rule 7).

## Light

A map with no light in it comes out black; one never passed through `hlrad` (`light: false`) is drawn fully
bright.

- `light(origin, { color, brightness })`: 150 to 300 for a room's lamp. `_fade` above 1 makes it fall off
  sooner. Keep it clear of the walls, or it burns a spot.
- `spotLight`: a lamp's cone on a floor, a beam through a window.
- **Texture lights** are how a lantern or a window glows: `textureLights(origin, { pi_lantern: [255, 255, 128,
  100] })`, and every face wearing that texture shines. Brightness is per unit of area: a large face needs a
  small number. The classic lantern is a small `func_illusionary` box wearing the lamp's picture, with a
  `light` beside it for the pool on the floor.
- **The sun**: faces wearing `sky`, and one `sunLight`. No sky faces, no sun.
- `checkPlan` warns when nothing lights the map, and when a texture light names a texture no face wears.

## Seeing it in the game

Every picture above is the kit's own drawing. `src/play.mjs` shows the map in the game itself: it loads the
map in a running engine, gets through the game's menu, walks, turns, speaks, and takes pictures of what the
player sees. A door that opens, an NPC that answers and a monster that appears are seen here and nowhere
else.

**What it needs**, beside the kit: a browser build of the Xash3D engine with the game in it, served at an
address (the person has one or has not; ask), and Playwright, which drives the browser. Neither is part of
this kit, which has no dependencies: Playwright is installed in a folder of the person's own (`npm install
playwright`, `npx playwright install chromium`) and that folder is named with `--playwright`, or in the
`PLAYWRIGHT_DIR` environment variable. Without it the command says so in one sentence.

```
smak play http://127.0.0.1:8097/?args= --map orchard --steps steps.json -o work/seen \
     --mod smak/profiles/mastersword.mjs --game <Half-Life>/msc --game <Half-Life>/valve --playwright <folder>
```

`steps.json` is a list. A step does one thing, and any step may also `wait` (milliseconds, after it) and take
a `shot` (a picture, after the wait):

| A step | What it does |
| --- | --- |
| `{ "command": "noclip" }` | A console command, or a list of them |
| `{ "say": "hail" }` | The words said as the mod's profile says a thing is said |
| `{ "walk": 3000 }` | Forward for 3 seconds; `"to": "back"`, `"left"` or `"right"` |
| `{ "turn": 90 }` | A quarter turn to the left (under 0: to the right) |
| `{ "button": "jump", "ms": 200 }` | One of the game's buttons held: `jump`, `duck`, `use`, `attack`, `moveup`... |
| `{ "hold": "w", "ms": 2000 }`, `{ "press": "Enter" }` | A key of the keyboard held, or pressed once |
| `{ "click": [512, 330] }` | A click at that place of the page, in pixels |
| `{ "wait": 5000 }`, `{ "shot": "gate" }` | Only a wait; only a picture |

After a step that does something and gives no `wait`, a second is waited. The pictures are written to the
folder as `00_loaded.png`, `01_...png`, numbered in the order taken, with the game's console in `log.txt`.
Two are taken unasked: `loaded`, when the map has loaded, and `entered`, after the menu. **Open them**: a run
that never got into the game shows in those two at once. From a script it is `play.play({ driver, map, steps,
out, mod })` with `play.browserDriver({ url, playwright })`, which resolves to `{ pictures, steps, log }`.

- **Since 0.13 this section is the short of it: `docs/PLAY.md` is the whole.** The game's text is heard and
  written to `log.txt`; a step waits for a line (`until`) and a run is held to lines (`expect`, `expectNot`);
  `turn`, `face` and `look` are exact; `where` reads the player's place and `goto` puts him at one (by the
  profile's `play.goto`); `--serve` and `--attach` keep the game up between runs.
- **The game's own part is in the profile**, as its `play` field: `enter` (the steps that get through the
  menu once the map has loaded), `say` (the console commands that say a thing, with `{text}` for the words),
  `loaded`, `goto`, `messages` and `screen` (the page's size the clicks were measured on):
  `profiles/mastersword.mjs`.
- Say to the person what the run's lines proved, what you saw in its pictures, and what you did not try.

## The limits of this way of making maps

- **Convex brushes only.** That is the format, not the kit: an L-shaped block is two boxes. `solid` and
  `prism` refuse a shape that is not convex and tell you to make it of several.
- **No curves but by pieces.** A cylinder is a prism of flat sides; an arch is a run of wedges. Twelve sides
  read as round at a room's scale. Their corners fall off the grid (`snap: 1` rounds them, at the cost of a
  slightly uneven outline); keep such pieces as furniture inside a sealed room.
- **`carve` cuts boxes; `carvePlan` cuts outlines in plan.** With `carvePlan` a room is any shape in plan,
  upright walls at any angle, between a flat floor and a flat ceiling. A sloped floor or a vault is still a
  piece put in (`terrain`, `wedge`, `arch`). With `carve`, a room that is not a box is carved as a box and shaped with pieces put into it:
  chamfers along a tunnel make it an octagon, a `terrain` hung under the ceiling makes it a cave, an `arch`
  in a doorway makes it arched. All the rock wears one set of textures; to give a room its own, line it with
  thin boxes of another texture (16 thick, inside the carved space).
- **No brush is cut by another.** Two brushes may overlap, and the compiler sorts it out, but the kit has no
  "subtract this shape from that one" beyond a box from a box.
- **Texture alignment is per face, by numbers.** There is no "fit" or "wrap round the corner": see the fitting
  sum above. Brushes are turned about an upright axis (or x or y) with `turned`, their pictures with them.
- **Compile times.** A few rooms: seconds. `hlvis` grows steeply with open space and with detail the world is
  cut by: put small pieces (beams, lanterns, posts) in a `func_wall` or `func_illusionary` so they do not cut
  the world, when a map grows slow. `fast: true` for drafts; each program has a timeout (2 minutes for hlcsg
  and hlbsp, 15 for hlvis and hlrad; `timeout` changes them).
- **`readMap` reads Valve 220** and nothing older, and keeps an entity's keys in an object: a key that is a
  whole number (rare) is listed first when written again.
- **Nothing here runs the game**, unless the person has a browser build of it ("Seeing it in the game").
  Doors that open, triggers that fire, a monster that finds its way: say to the person what you could not
  verify. The walk test is geometry (the box of a player moved over the map,
  with the engine's numbers for a step, a jump, a run and a slope): it was never measured against the game's
  own movement, and where a monster's origin is (its feet, the kit takes it) and whether it is dropped to the
  floor are the mod's to say.
- **A .bsp compiled with `wadinclude` carries the textures** of whoever made the .wad. Keep it out of anything
  shared, as with a game's models.

## When something is wrong

| What you see | What it is |
| --- | --- |
| `compileMap: this needs the map compilers VHLT ...` | They are not installed, or not named. Ask the person; `VHLT_DIR` |
| `the texture X is in none of the .wad files given` | A wrong name, or the .wad not passed in `wads`. `wadTextureNames` lists what a .wad has |
| `the map LEAKS ...` | See "Leaks". Look near `result.leak.at`. Was a wall made a brush entity? Is an entity outside? |
| `the map looks OPEN to the void` (plan) | The same, found before compiling. Fix it first: it saves the compile |
| `N brushes that are no sound convex solid` | A brush built by hand with a face turned inwards, missing, or given twice. Use a builder; `shapeOf(brush).faults` says which face |
| `the solid is not convex` / `is inside the solid the other points make` | The shape has a dent. Make it of several convex pieces |
| `N brushes have planes written with points off the grid` | Cylinders, arches, bends. Harmless as furniture; where they must meet other brushes, `snap: 1` |
| `N brushes reach further than 4096 from the origin` | The map is too large for the engine, or a number is wrong by a factor. Build round the origin |
| `N classes are in none of the definitions given` / `are not in the game's own program` | The game has no such entity and drops it. A wrong name; look the right one up in the mod's own maps (`smak map-learn ... --class`), or in its program's list. With an FGD and maps only, a class the mod has and neither uses is told too: give the profile the game's `dlls` |
| `N keys their class does not define` | The game reads only the keys its code asks for. A key copied from another class, or a guess. `smak map-learn <maps> --class <name>` shows the keys that class is given in the mod's own maps |
| `N values are not of their key's kind` | Text where a number goes, a choice that is not one. When the FGD is the one that is wrong, the profile's `classes` gives the key its true type |
| `N entities name something no entity of the map is called` | A `target` with no `targetname` to answer: a misspelling (capitals count), or the entity was never made |
| `N entities are named by more others than they take`, `give X with no Y beside it`, `wait for others that never run out`, `have no X`, `give a X that is not ...` | A rule of the mod's profile, with its reason in the sentence. The reason is the profile author's: read the rule's comment in the profile for where it is from |
| `N models are in none of the game's folders given`, `found only in other capitals` | The game does not have the file, or has it under a name that only Windows takes for the same. Ship the file with the map, or write the name as the folder has it |
| The map is black | No light, or lights buried in walls (`checkPlan` warns of both) |
| A room is dark in the pictures of the result | It is dark in the game too: the pictures use the map's own light. A `light` nearer, or brighter (`brightness` 200 to 300 for a room), then compile again. `drawMap(bsp, { brightness: 4 })` only looks into it |
| The source's view shows something in front of a door, or a start facing a wall | It is so. Move it in the script and draw again: nothing was compiled yet |
| `N of the M entities a player goes to are not reached on foot` | Each has its reason. `no opening leads to it`: a room with no doorway, or one filled by another piece of rock (two `carve` calls whose blocks overlap fill each other's rooms: carve every room that meets in ONE call, or draw a `sectionOf` through it and look). `only by a jump`: a step over 18. `only crouching`: a lintel under 72. `open air leads to it`: a gap under 32, or a ledge over 63 |
| `N entities stand in something solid` | Its box (32 x 32 x 72 unless `bodies` says) does not fit there: `it fits 8 higher` says how far to lift it; `a wall, a ceiling or a piece of the map is in its box` wants it moved aside or the ceiling raised |
| `N entities hang more than 64 units over their floor` | A wrong height, or a floor that is not where you think: a section through it shows which |
| `N places are one-way` | A player gets in and finds no way back to a place to start: a pit deeper than 63, a room only a teleport leads into, the foot of a slope too steep to climb. Each says where it is and how it is entered. Give it a way out (stairs, a ladder, a ramp no steeper than 45 degrees), or mean it; a place a player leaves the map by is named with `exits` |
| A ramp is not walked up | It is steeper than a player stands on (`about N square units ... are too steep to stand on`): make it longer for its rise, at least as long as it is high and a little more |
| A plan with `reach` is red where a player should walk | No way was found to that floor from the places to start: the reasons are in `reachOf(map).warnings`, and the nearest green edge is where the way ends |
| A floor's height on a plan (`heights`) is not the one you wrote | Another brush lies on it: the plan shows the highest floor under the cut |
| A face is a flat colour in a view of the result | Its texture is in none of the .wad files given to the picture (`facts.missing`): pass `folders` or `textures`. The game needs the same .wad, unless the compile was `wadinclude` |
| The map is fully bright and slow | It leaked, or `hlvis` / `hlrad` were left out |
| A picture is smeared along a slope | `align: "world"` was asked for a slanted face: leave `align` out (a face more than 5 degrees off every axis wears its own) |
| A door's picture is mirrored or upside down | Negate that side's scale: `scale: [-1, 1]` |
| `hlvis did not finish in 900 seconds` | Too much open space for a full run: `fast: true`, or simplify what cuts the world |
| `readMap: ... the file is in the older format` | Open it in J.A.C.K. or TrenchBroom and save it as Valve 220 |
| An older `.bsp` is still there after a failed compile | It is the last good one, left alone on purpose; `result.bsp` is null and a warning says so |
