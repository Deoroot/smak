# Designing a map: good to look at, and fun to play

`docs/MAPS-MAKING.md` says how to build a map that compiles and can be walked. This page says what makes one
that players like. It was read on 2026-10-16 from a game's own maps: Master Sword Classic's 100 compiled
maps, all measured with this kit, eleven read closely. It was read after a player walked the first two maps
an agent made with this kit and called one "all straight lines, nothing unique", and saw monsters appear in
front of him in the other. The numbers below are that game's; the rules hold for any GoldSrc game whose maps
are fought through.

Two checks hold a map to it: `smak map-character` (its shape, dressing and light against the mod's own maps)
and `smak map-spawns` (how its monsters come). Their recipes are `kits/encounterkit.mjs`.

## Shape: ground, not rooms

- **Walls off the grid.** A third of a good map's wall area runs along neither axis (the game's middle half:
  22% to 51%; its outdoor maps 45-50%). A rock that leans, a path that bends, a bank, a wall that follows a
  hill. Rooms of axis-aligned boxes read as rooms, however they are textured. `maps.carvePlan` carves spaces
  of any outline (`maps.path` and `maps.curve` for streets and tracks that bend; a person's drawing through
  `smak sketch`, docs/MAPS-SKETCH.md); `maps.turned`, `maps.prism`, `maps.wedge`, `maps.bend` and
  `maps.terrain` (standing, for a cliff) make the rest.
- **Floor that slopes.** 8% to 31% of the floor area. Ramps, banks, uneven ground.
- **Heights.** 7 to 13 distinct floor levels (32 units apart, each holding 2% of the floor), a spread of 250
  to 640 units. Height gives views: from a terrace the yard you came from, from a stair the hall you will
  fight in. Compact maps keep it too (a ruin of 3600 x 5200 units has 9 levels).
- **A loop, not a line.** The best-liked maps are hubs with branches (a field with six ways out; a hall with
  three wings, each ending at a seal) or lines that turn back on themselves and **open a shortcut home** once
  the player is deep in ("A shortcut has opened in the sewers.").
- **Landmarks.** One thing seen from most of the map that says where the goal is: a tree on a hill, a tower,
  a city's gate at the top of a stair. Light is a landmark too (below).
- **Size.** The game's middle half has 9 to 25 million square units of floor (`map-character` gives a map's
  `floorArea`). A small map can still feel large when every room is different (a map of 3300 x 2600 units
  with nine halls: stone, rock, water, a loft, a crevice, a broken hall).

- **Furniture, fixtures, vehicles: no bare box.** `nonAxial` above is the world's walls; what stands in a room is
  the other half. Valve's furniture (the brush entities `func_wall`, `func_breakable`, `func_train` ...; the 96
  campaign maps) is a bare six-sided box on the axes for a median 53% of it, 95th in 100 81%, and its creases are bare
  80-degree edges 85% at the median, so a map whose furniture is all boxes is over the band (`map-dressing` rows
  `bareProps`, `squareProps`, `propAxisAligned`; for a source, `bareBoxes`, `squareEdges`, its `func_detail` too).
  Reach for `box(min, max, texture, { bevel, edges })` (a 45-degree chamfer: "all", "vertical", "top", "bottom"),
  `roundedBox`, `extrudeProfile` and `sweepProfile` (a moulding, a cornice, a rail, a rounded roof, a bench's side),
  `loftBrush`; the room's own shape stays with the map spec's `frame` and `breaks`, `chamfered`, `prism`, `wedge`,
  `turned` and `bend`. A vehicle or a curved prop is a model (`solids.sweepTris`, `lathe`; docs/MODELS.md, "Form"),
  placed as an entity, not built of brushes: a train of brushes is the commonest tell that a program made a map.
  Start from a reference and compare the picture with it, not with "looks like a tram".

## Light: pools and shade

The game lights whatever stands in a place by the floor under it, so the floor's light is what plays
(`smak map-light`, docs/MAPS-CHECKS.md).
- **Shadow between the lights.** 17% to 55% of a good map's floor is under 24 of 255. An evenly lit map has
  no depth and no "there" to go to.
- **Pools that draw the eye.** The brightest floor reaches 188 to 250: lamps along a street, a sunlit gate.
- **The mean is low.** 30 to 78 of 255. A daylight field may be brighter (one well-liked field is 109) and
  then keeps its shade under trees and cliffs.

## Dressing: textures, props, sound

- **A set of textures for each part** of the map: 27 to 67 on the world's faces. Ten makes every place look
  like the last.
- **Props where people lived or worked**: chairs, barrels, racks of swords, sacks, mugs, a wagon, a letter, a
  hanged man. A good town map has a hundred; a fort a few dozen. A prop tells a story with no text.
- **Sound**: water, wind, a room's echo (`ambient_generic`, `env_sound`): 1 to 20, the well-liked maps 17 to 80;
  and music that changes by area (the best 11 to 18 music areas).

## A touch of its own

Each map that players come back to has one thing nobody forgets, and it is almost always made of entities
the game already has, wired together:
- riddles answered aloud that open a door; three seals; a key in three bloody pieces;
- a city full of people after dark tunnels;
- a camp that talks ("Wake the lads; we got ourselves another drifter!"), ambushes, and steals the loot;
- a boss who flees into his caves, each cave's wave to be cleared before the next;
- a random raid on the plains; a chest that is a trap;
- prisoners freed into a fight with their guards.

Decide the touch before the first brush, and build the map around it.

## Monsters: how they come

In the game's 100 maps, 6476 monster templates in 1966 spawn areas: 491 are there when the map starts; 38
when the first player arrives; 3522 are fired by a trigger a player walks into, and **about half of those can
be seen appearing** from that trigger (`map-spawns` counts 45%); 1791 come when another monster dies or an
area is cleared. Players notice a monster appearing in front of them. The maps that feel best bring theirs in
one of four ways:

1. **There before the player looks.** Filled when the map starts, or when the first player arrives (Master
   Sword: a `trigger_relay` named `game_playerspawn`, which the game fires as a player enters the world).
   A party's strength (`reqhp`) is then that of the players there at that moment.
2. **Ahead, out of sight.** The area is fired from a trigger the player crosses before its ground can be seen:
   a gate, the stair of the terrace below, the bend of a tunnel, a door. `smak map-spawns` says which
   monsters a player in the trigger could see.
3. **As a reply.** A breakable (crate, web, barrel, rotten board) releases what was in it; a chest that is a
   trap; a lever that wakes stone guards. A monster that appears because the player did something is a
   surprise, not a fault.
4. **In waves at one place.** Each wave fired by the last one's clearing, the player already standing there
   fighting: a wave appearing is the event (a boss after two waves; a trap of four waves and a queen).

**Respawns.** A template with more than one life comes back at its own spot after its delay, wherever the
players are: usually in front of whoever just killed it. One life, or minutes between lives (the game's
wanderers: 30 to 600 s) for a place that should live on.

**Races.** A mod's monsters have races, and races attack each other. In Master Sword (its races.script):
groups that never fight among themselves are **beasts** (`wildanimal`, `vermin`, `undead`), **the dark**
(`undead`, `spider`, `demon`) and **the horde** (`orc`, `goblin`, `demon`); `rogue` (every wolf, every
bandit) attacks every other race. One area of twenty in the game mixes races that fight, and where it does
the fight is meant (prisoners and their guards). Put allies together, or give the race that attacks
everyone its own ground. `smak map-spawns` says which areas mix races at war.

## Rewards: where the fight was won

A boss's chest appears at his feet (half of the game's within 267 units of the dying monster) or in a vault
his death opens on the way out. A large map pays as it goes: a chest for each camp's chief. Secret chests
reward looking. A reward far from the fight (back at the start, in front of a ladder) is told by `map-spawns`.

## The recipes (`kits/encounterkit.mjs`)

`recipesOf(mod)` gives the wiring for a mod whose profile has `spawns` and `recipes` (Master Sword's does).
Each returns entities for `writeMap`'s `entities`:

```js
import { recipesOf } from "../kits/encounterkit.mjs";
const kit = recipesOf(mod);
// a terrace filled from the stair of the one below, its monsters hidden by the retaining wall
entities.push(...kit.fillAhead({ name: "t2", at: [1408, 1568, 168], trigger: [[1344, 1056, 128], [1472, 1088, 240]], cleared: "t2_clear" }));
entities.push(kit.monster("t2", "msmonster_boar", [1296, 1424, 144], { script: "monsters/boar", band: "0;150" }));
// halls filled as the first player arrives, a second apart
entities.push(...kit.onArrival({ names: ["hall1", "hall2"], at: [0, 0, 64] }));
// a crate that releases rats
entities.push(...kit.surprise({ name: "crate1", at: [600, 200, 80], brushes: [maps.box([580, 180, 0], [620, 220, 40], "crate")] }));
// two waves, then the boss
entities.push(...kit.waves({ names: ["wave1", "wave2"], at: [2000, 1900, -100], then: "boss" }));
// three terraces counted, then the cellar door
entities.push(...kit.counted({ name: "terraces", from: ["t1_clear", "t2_clear", "t3_clear"], target: "cellar_open", at, lines: ["The lower terrace falls quiet.", ...] }));
// the boss's chest in his vault: give the boss `dies: "boss_dead"`
entities.push(...kit.rewardOnDeath({ name: "boss_dead", at: [2760, 1776, -176], classname: "msworlditem_treasure", script: "orchard/harness" }));
// a raid that comes one time in twenty; one of two ambushes
entities.push(kit.chance({ name: "raid_roll", target: "raid", percent: 5, at }), kit.oneOf({ name: "ambush", targets: ["pouncer", "shadow"], at }));
```

What a recipe cannot know is whether its trigger truly hides its monsters, or whether its monsters' races
get on: `smak map-spawns` on the result says.

## The checks

`smak map-character <bsp> --mod <profile>` measures the ground, the dressing and the light, and holds each
figure against the mod's own maps (the profile's `character.figures`; `--learn` makes them from a folder of
maps). A figure on the plain side of the mod's middle half is a PLAIN line; **five or more** is a warning. One
alone is no fault: of the game's maps that players come back to, none has more than 3 (a bright field has 3;
a flat town 2). The two maps a player called plain had 6 and 8; the game's maps with 5 or more are its oldest
and its betas.

`smak map-dressing <bsp|map>` holds the world's `nonAxial` and the furniture's form to Valve's bands (a WARNING with which
way to go); over a `.map` it needs no compile (`maps.judgeSourceForm`), and the site assembler (`levels/assembly`,
`levels/tools/assemble.mjs`) says the same of what it built: `form: ...` lines among its warnings. `smak form <bsp|map|mdl>`
prints only these.

`smak map-spawns <bsp|map> --mod <profile> [-o plan.png]` lists each spawn area, how it comes and by what
(followed back through relays, counters and multi_managers), and warns of monsters seen appearing (SEEN), back
soon at their own spot (QUICK), races at war on one spawn (FIGHT), and a reward far from the death that brings
it. The plan draws a line from where a player stands in each trigger to each monster seen from it. The sight
test is an upper bound: a clear line through the world and the brush entities that hide (walls, closed doors,
breakables, illusionaries that are not see-through), within 3000 units, from eyes on a grid over the
trigger's floor; it does not know where the player looks, or the dark. `map-check --mod` says the same
warnings among its own.

## A role-play city: wiring, not shape

The rules above are a fought-through game's. A role-play city is judged otherwise. Three role-play
cities of a community of The Specialists, read on 2026-10-17 (`profiles/specialists.mjs`, `CITIES`):

- **On the grid is no fault.** 11 to 17% of their walls are off the grid, 5 to 7% of the floor slopes: a
  street of boxes. The game's own arenas are squarer still (5%).
- **Dense and at a person's size.** 21 to 40% of the floor under 176 wide; headroom 167 to 213; doors 64
  wide; many small named places (shops, flats, a clinic, a lab, a bar) and few halls. A map whose floor is
  mostly over 352 wide, with headroom of 384, reads as an empty shell.
- **Dressed heavily.** 64 to 444 textures, 70 to 214 props (`ts_model`), 38 to 94 sounds; a district's own
  sounds and storefront signs.
- **Every door a property.** 98 to 110 doors, all but two named, one name a home or a shop (`resident1`
  to `resident9`, `lux_apt_a` to `d`): what a server's role-play plugin hands out as keys.
- **Switches that make a room live.** 38 to 53: a lamp's switch, a TV (a button at a coloured light, the
  screen's glow), a radio, a club's music, a shower, a stove; lifts (a button, a multi_manager, a train
  between two corners that wait to be fired again, the doors after it); an oven that kills; healing pads
  (`trigger_hurt` with `dmg` under 0); an alarm said from eleven speakers; windows that come back.

- **Switches are rationed.** A light with a name is switched, and the compilers hold 32 such names in a
  map (each a light style of its own, 32 to 63): the cities have 11 to 14 lamp switches each. Give the
  flats a switch and leave shops, halls and streets lit always; lamps that switch together share a name.
  `checkPlan` refuses a 33rd.

`smak map-wiring` reads all of this; `smak map-character --mod profiles/specialists-roleplay.mjs` holds a
map's figures against the cities.

## Pitfalls

- Monsters fired in view, at a few hundred units, and back again at the same spot 8 to 20 s after they die.
- A boar, a wolf and a spider on one terrace: the wolf attacks the boar, the spider attacks both.
- The reward back at the start, in front of the ladder the players came down.
- One even light, walls on the grid, four heights: a map that reads as a set of rooms.
- A monster that can flee where it cannot be reached keeps its area from ever clearing (a wall it jumps,
  a ledge): `func_monsterclip` keeps monsters in.
- The game's own: areas named by nothing, relays fired by nothing, `fireallperish` on monsters of endless
  lives. `map-check --mod` finds them.
