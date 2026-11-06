# levels/assembly: buildings assembled from authored pieces

SMAK 1.0's second way of making maps (PLAN.md, Phase 3, "What the next attempt uses"; the survey behind it in
`levels/notes-prior-art.md`). The first way, `levels/experimental-city`, computed every brush and was paused. This one:

- **the generator decides the topology, authored pieces give the shape**: a building is a room graph per storey;
  a layout method lays it on a grid; each wall edge, corner, floor and stair is a piece from a library, each piece
  made once, looked at and approved by the person;
- **joins are typed connectors**: a doorway joins only its match, an unused one is capped; a stair is one piece
  with a landing on each of its two storeys, so loose steps and doors in the air cannot be written;
- **every piece is placed relative to what it stands on** (a storey's floor), never at a computed height;
- **each step is checked as it is made**, and every iteration is walked in the game by the person.

The first target is **one building of two storeys with a stair, in Half-Life on Steam** (GoldSrc, BSP v30, the
textures of `valve/halflife.wad`, compiled with VHLT, the folder in `VHLT_DIR`, the wad in `HL_WAD`). Larger things come after it works.

**A map for Xash alone is BSP2**: `compileMap({ engine: "xash", format: "bsp2" })` (docs/MAPS-MAKING.md) wants SDHLT's goldsrc
fork (`github.com/2cwldys/sdhlt`, branch `goldsrc`, built from its source) in `VHLT_DIR`; VHLT and stock SDHLT refuse both
switches. A BSP2 map loads in Xash only, not in Steam's Half-Life.

## Switches and the jail (`site.mjs`, the `switch` piece)

The first things a role-play map's players work (`levels/notes-h9.md`, "Switches that make a room live", "Jail", where that file is kept).

- **A room's lamps on a switch.** A light with a name is switched: hlcsg gives each name a style of 32 to 63, and a map
  holds 32 of them (`map-check` refuses a 33rd); the site takes **24 at the most** (`SWITCHES_MOST`), the rest kept
  for the city's own (an alarm, a club). One name a property, `<site>_<building>_<property>_light`, over all its rooms'
  lamps (a shop's back room is the shop's); `switchesOf` chooses them: every shop first (a shop, a bar, a clinic, a
  workshop), then the homes building by building in the site's order, a building's homes all or none (a landing where
  one flat has a switch and the next has none reads as a fault). On a site of more than 24 properties the rest go
  without (`report.unswitched`).
- **What goes off with the switch**: the lamps' light entities (named); the glass's texture light, by a VHLT
  `light_surface` of the same name filtered to the lamps' own entity (`_fname`), which takes its faces from
  `info_texlights` (measured on a built site, a draft, `map-light --switched off`: a flat's floor from 61..76 to 11..19 of 255, the clinic from
  95 to 3; a shop with its street windows from 105 to 63); and the glass itself, the lamps being one `func_wall` of that name a property, which when fired shows
  its textures' `+A` frame (`+A~LIGHT4A`, `+A~GENERIC86`, dark). Dress models (`lamp_chateau`) have no light and stay as
  they are.
- **The switch** (`switch`, slot `switch`): a `func_button` plate 2 proud on the wall, centred at hand height 48, inside the
  property's door from its hall, landing or street, at x 112 of the doorway piece's frame (the latch side: the leaf
  hangs at 32). Used, never touched; spawnflags 33 (it does not move, it toggles: it fires its target pressed and again
  released, and its face, the lever `+0SW3S`, shows the lever thrown while the lamps are off); sounds 14.
- **The jail.** The `nexus` program (the regime's seat) names its `control` room (the guard room). Its cells' doors keep their names but
  lose "use only": GoldSrc's `CBaseDoor` gives a player no use of a door without spawnflag 256 and locks the touch of
  one with a name, so a prisoner opens nothing; they take toggle (32: open until fired again). One switch on the
  guard room's wall by its door (the same piece, its face swapped to `+0SW2S`, sounds 3) fires a `multi_manager`
  `<site>_<building>_jail` that fires every cell's door: all open, and again all shut. A plugin may still fire one cell by
  its name.

## Below the streets (`below` in a site, `below.mjs`, the sewer pieces)

The first level under the street (a sewer): measured against role-play cities (median 9 layers, 34 m of height, 8
ladders) the site had 2 layers and no ladder, and the person asked for a lower level ("can't reach lower levels",
"sprawling hallways that go on forever").

- **The description** (`below` in the site): `floor`, the walkways' top (-384: two storeys, so a stair is two `stair-u`);
  `parts`, rectangles of the site's cells: `tunnel` (with `channel`, 3 across: a walkway, the channel, a walkway), `hall`
  (a `basin` of water inside a walkway's ring, `columns` at vertices), `room` (entered by its `doors` only); `ways` down:
  `stair` (2 x 4 cells from the street to half way, the lower well east of it to the floor, its foot south onto a walkway),
  `manhole` and `drain` (a shaft over a walkway, its ladder on `wall`, a lid on the street), `trapdoor` (a shaft up into a
  building's room: a den's own way down); `doors` between a part and a room (`secret`: the door piece in the tunnel's wall
  texture, named `<site>_<building>_<name>`, the hideout's key); `bars` across a dead end; `props` (the dress's ids) and
  `sounds`. Each part wears a `look`, a district of the theme (`sewer`, `cistern`, `service`, `smugglers`, `stairs`).
- **Each cell a column of air** from its floor to its vault (a tunnel's 208, a hall's 288, a room's 176), a shaft's to the
  street. A floor slab under each cell, a vault over each but a shaft and the stair's upper well, both joined into
  rectangles; a wall on every edge where the air on its two sides differs: the ground beside a tunnel, the kerb over the
  channel, the step from a tunnel's vault up to the hall's, a shaft's walls over the vault; one brush a straight run, 8
  past each end so that runs close their corners; between two parts not open to each other each side its own half in its
  own look. Nothing fills the ground round it: the walls close the map and VHLT drops every face that looks out. The
  street's paving and the sky's floor under it are left out over every opening (the den's floor too, `assemble`'s
  `holes`); round the stair's opening the wells' walls stand 40 over the street as a parapet (3 brushes where the rail
  piece came to some 90).
- **The water** is a world brush of `!gwater3` 16 deep (its surface 16 under the walkway): no entity, no model; a player
  wades the channel and jumps the 32 out. `func_water` would add a brush entity a stretch for waves nobody sees.
- **A ladder** is a steel plate on its wall (its face at 12, off the grid of 8: map-reach's body at the ladder's top then
  stands on the plate's top beside its place; on the grid, with the plate's face at 8, the walk test never climbed out of
  a 48-wide shaft), the rungs (`{po_laddrust` masked, all the level's in one func_wall) and a func_ladder 16 over the top.
  It stands on a wall the ground is beyond, so that at its top the player steps forward onto the street (or the den's
  floor), not into a wall: the den's trapdoor is on the cellar's south wall, the den's floor south of it.
- **The lids**: the manhole's a func_door grate (`{grate1` masked), used, slid +x over the paving and back after 4 s; the
  drain's a func_breakable grate; the den's trapdoor the manhole's lid in the den's floor texture, named as the hideout's
  doors (a game plugin's key opens both).
- **Light**: a caged lamp every 4 cells along a tunnel's walls, every 4 along a hall's and a room's, one in each well
  (brightness 85 and the lamp's texture light). a built site, full compile: the sewer's floors 26 to 38 of 255 at the
  median (the cellar 49), the stair's wells 19, the street 52.
- **`checkBelow`**: 3 to 5 ways down, a stair, a ladder from a street, a way from each den; no opening where a player
  starts; every part reached from a way through the cells open to each other; no tunnel straighter than 24 cells
  (39 m); 2 looks at least; a warning without a hall. Its broken cases are in test/broken/levels.mjs; a build script can print
  its measures. `planSite` refuses a way off its part, a manhole off public floor, a trapdoor outside its room, a ladder
  on a wall with the level beyond it.
- **What it costs** (a built site, full compile): faces 32 609 to 33 829 (past GoldSrc's 32 767, inside Xash's 65 535),
  vertices 48 889 to 50 622, clipnodes 20 803 to 21 852, leaves 10 679 to 11 122, brush entities 301 to 311 of 512,
  entities 1 282 to 1 338. The first sewer's portico column on a plinth in the cistern and a railing round the stair cost
  some 900 faces more; they became the stone pier and the parapet.

## Styles (`smak-style/1`, `styles/<name>.json`, read by `style.mjs`)

A style is the few rules a kind of building keeps beyond this contract, each with a source: a published one, or a
fault the person found walking a map in the game. No rule goes in without one. Sizes are not written in the style:
each of its kinds names a kind of `levels/rules/architecture.json`, whose metres `loadStyle` turns into cells of 64
(least sizes rounded up, greatest down, and never under 2 across, the depth a leaf swings into). The house style
(`styles/house.json`): each room's area within its kind's; its largest rectangle at least the kind's `minSide`
across; that rectangle at least 0.75 of the room (not halls); a window for living rooms, bedrooms, studies and
kitchens, and the living room's on two sides; every room reached without passing through a private room or a
bathroom; the entrance into a hall, living room or kitchen, on the front wall; the kitchen deeper from the front
than the living room. A shopping street's style: shops, back rooms, stair halls and flats; every entrance on the
front, a shop's window on the front beside its door (`frontWindow`; the layout puts one there when its runs leave none);
and a `site` block of the street's rules (properties, portico depth, street width, the square, footprints not
repeated, light, spawns), which a site check is to measure. `checkStyle(layout, description, style)` gives each broken rule's sentence with its source;
`layoutOf` puts the rules in its search and its polish, and their sentences in the layout's failures and warnings.

## The rules every part keeps

- Deterministic: the same description and seed give the same files, byte for byte.
- Every check ends in a sentence naming the thing and the number it wanted, as SMAK's checks do.
- Nothing of a game's files is copied into the kit (AGENTS.md rule 7): pieces name textures, they hold no pictures.
- Pictures are for the person; a check measures. Views are made at every step and looked at.
