# The RP contract: what a map gives an RP plugin

A map made by SMAK for role-play carries names in the map and, beside it, one JSON file that says what each name
is. A plugin (ours, `levels/rp/plugin/`, or any other) reads the JSON and finds the entities by their names. Neither
side guesses at the other: the map never holds plugin logic, the plugin never holds positions.

H9 (Xash3D FWGS with The Specialists) treats a map as role-play only by its name: `rp_` or `tsrp_` at the start, or
`_rp_` / `_tsrp_` in it (`roleplay_map()` in `ts_matchmode.sma`). Every map here is named `smak_rp_<name>`.

## The files

| file | where it goes in the game | written by |
| --- | --- | --- |
| `maps/smak_rp_<name>.bsp` | `ts/maps/` | the kit (site, dress, compile) |
| `smak_rp_<name>.rp.json` | `ts/addons/amxmodx/configs/smak_rp/` | the kit, from the same build |
| `tsrp_roamspots_smak_rp_<name>.cfg` | `ts/addons/amxmodx/configs/` | the kit, from the JSON's `roam` |
| `smak_rp_<name>.rcw` | `rcbot/waypoints/ts/` in the game folder (`H9XASH/rcbot/waypoints/ts/`, beside `h9_tsrp_hive.rcw`) | the kit, from the JSON's `paths` |
| `smak_rp.amxx` | `ts/addons/amxmodx/plugins/`, named in `configs/plugins.ini` | `levels/rp/plugin/smak_rp.sma` |

The JSON and the map come from the same build and carry the same `build` string; the plugin refuses a JSON whose
`map` is not the map running, and says so in the server's log.

## The JSON (`smak-rp/1`)

```json
{
  "format": "smak-rp/1",
  "map": "smak_rp_byz01",
  "build": "sha1 of the .bsp",
  "properties": [
    { "id": "m1_flat1", "kind": "home", "doors": ["smak_rp_byz01_m1_flat1"], "district": "mese" }
  ],
  "places": [
    { "id": "msr_desk", "kind": "police", "at": [x, y, z], "district": "nexus" }
  ],
  "npcs": [
    { "id": "broker", "name": "Ilias the Broker", "model": "models/...mdl", "at": [x, y, z], "yaw": 90,
      "gives": ["courier_1"] }
  ],
  "arenas": [
    { "id": "warehouse", "spawns": [[x, y, z, yaw], ...], "back": [[x, y, z, yaw], ...],
      "reset": ["smak_rp_byz01_arena_warehouse_reset"] }
  ],
  "missions": [
    { "id": "courier_1", "title": "The Broker's Parcel", "giver": "broker", "arena": "warehouse",
      "party": [1, 4], "time": 300,
      "steps": [
        { "do": "reach", "target": "smak_rp_byz01_arena_warehouse_goal", "say": "Find the parcel." },
        { "do": "use", "target": "smak_rp_byz01_arena_warehouse_crate", "say": "Open the crate." }
      ],
      "done": { "say": "The Broker pays you.", "reward": { "frags": 2, "money": 300 } } }
  ],
  "breakables": [
    { "name": "smak_rp_byz01_arena_warehouse_vase",
      "keys": { "classname": "func_breakable", "targetname": "smak_rp_byz01_arena_warehouse_vase", "model": "*12", "health": "30" } }
  ],
  "roam": [ { "district": "mese", "at": [x, y, z] } ],
  "quotas": { "market": 10, "hippodrome": 7, "mese": 5 },
  "paths": {
    "nodes": [
      { "id": "street_12", "at": [x, y, z], "kind": "street", "district": "mese", "part": "the avenue", "roam": 7 },
      { "id": "place_40", "at": [x, y, z], "kind": "place", "district": "nexus", "part": "nexus.booking", "place": "nexus_booking" }
    ],
    "links": [
      { "a": "street_12", "b": "door_50", "how": "walk" },
      { "a": "ladder_70", "b": "hatch_71", "how": "ladder", "way": "the avenue's manhole", "gate": "lid" }
    ],
    "ways": [ { "id": "the avenue's manhole", "kind": "manhole", "top": "hatch_71", "foot": "ladder_70" } ],
    "pruned": 0, "notes": [], "warnings": []
  }
}
```

- **properties**: every door with a name is a property's (`home`, `shop`, `public` (a building's common door), `gate` (a checkpoint in a wall), `jail`, `hideout`, `police` (the regime's
  rooms), `other`);
  the doors of one flat or shop are listed together (a shop's back door to its stair hall, when it has one, is the shop's own name). A leaf's keys
  follow its property's kind (levels/assembly/site.mjs `DOOR_KEYS`): a `home`'s is use-only and toggle (spawnflags 256 + 32, `wait` -1: it
  stays as its user left it, so that nothing slams on a guard behind); a `shop`'s, `public`, `police`'s and the hideout's use-only (256) and swing
  back after 4 s; a `jail` cell's and a `gate`'s are one-way (16), the cell's toggle and opened by the jail's switch; every leaf has `dmg` 0 (nothing is
  crushed; a blocked leaf reverses). A plugin that walks through a toggle door must not use it again while it is open (smak_npc's 1.5 s re-use would shut it).
- **spawns**: `[{ id, role: "guard", building, district, at }]`, where the regime's guards start: cells of a post's or the Nexus's guard room and
  two cells outside its street door (floor points, as `places`). Optional; a plugin that does not know it ignores it. A plugin that sells keys (Apollo-RP and the like) keys on these
  names.
- **places**: where a job works (police desk, clinic, bar, bank vault), for a plugin or an admin to use. A part of
  the level below that is a place (the smugglers' cellar) is one too, `id` `below_<part>`, `district` `below`.
Every point (`at`, `spawns`, `back`, `roam`) is a point on the floor, where the feet are, not a player's origin;
the plugin lifts a player or an NPC by 37 (half a standing player's 72, and 1). The arena's `info_target`s stand 36
over those points, where a standing player's origin is. (The exception is `paths`, below: its nodes are origins.)

- **npcs**: a mission giver stands at `at` facing `yaw`. The map has no entity for it: the plugin makes it (a model,
  a box a player cannot walk through, used with the use key). `model` is one the game already has.
- **arenas**: a sealed place of the map, far from the city, where a mission is played. One party at a time. `spawns`
  where the party arrives (as many as the party's most); `back` where it is put in the city when the mission ends,
  however it ends. `reset` names entities the plugin fires before each run (a `multi_manager` that closes the doors,
  turns lights back). A broken `func_breakable` is gone from the game and no map entity brings it back: the plugin
  itself spawns every `destroy` target again before a run, from the keys in `breakables`.
- **breakables**: `[{ "name": <targetname>, "keys": { "classname": "func_breakable", "model": "*3", "health": "30", ... } }]`,
  one for each entity a mission's `destroy` step names: every key the entity has in the compiled map, as strings,
  read from the .bsp's entity lump by `targetname` (`breakablesOf` in `contract.mjs`; the brush model number `*N` is
  only known after the compile, so the JSON is written after it). The plugin does not watch the entities spawn (a
  `FM_KeyValue` hook crashes Xash3D FWGS 0.21): it reads these, and when a breakable's keys have no `model` it takes
  it from the live entity's `pev_model` at `plugin_init`, before anything can break it. Empty when no mission
  destroys anything.
- **missions**: a giver, an arena, how many players (`party`: least and most), a time in seconds, and steps in order.
  A step is one of:
  - `reach`: a player of the party touches the brush entity `target` (a `trigger_multiple`, its `targetname` the
    name; the plugin watches the touch);
  - `use`: a player uses `target` (a `func_button`);
  - `destroy`: `target` (a `func_breakable`) is broken;
  - `survive`: the time given in the step (`time`) passes with one of the party alive in the arena.
  `say` is told to the party when the step begins. `done` is told when the last step is done; `reward` is what the
  plugin gives, both fields optional:
  - `frags`: integer >= 0, added to the player's frags.
  - `money`: integer from 0 to 100000, paid by `smak_money_add(id, money, "mission:<id>")` of `smak_core`
    (`levels/rp/plugin/smak_core.sma`). **Each** member of the party still in the mission when it ends in `done`
    gets the full amount (it is not split). A mission that fails, is abandoned (`/quit`) or times out pays nothing,
    and neither does a member who left or died out of it before the end. Without `smak_core` loaded the plugin
    still runs and pays frags only (it says so in the log). Still `smak-rp/1`: a plugin that does not know
    `money` ignores it. `contract.mjs` (`checkRewards`) refuses anything else.
- **quotas** (optional): `{ "<district>": n }`, the virtual roster of smak_npc: how many citizens a district holds when the whole city is seen
  (a place may also carry `"quota": n`, added to its district's). The plugin makes only `smak_npc_max` people; with quotas, every
  `smak_npc_stream_sec` (3) seconds one citizen that no player is near (`smak_npc_near`) or sees is moved to a roam spot, out of sight and
  at least `smak_npc_spawn_min` (600) from every player, of the district that has fewer than its share (a district's quota, times 1 within twice
  `smak_npc_near` of a player, 0.35 within four times, 0.05 beyond) and given a home there. Districts are the nodes' `district`. Without
  `quotas` nothing moves (`smak_npc_stream 0` also stops it). `node levels/rp/npc-sim.mjs <rp.json> --stream <node>,<node> --quotas a=8,b=6` shows it.
- **roam**: points for `tsrp_roambots`' citizens (`configs/tsrp_roamspots_<map>.cfg` is written from them). A map
  with a level below the streets has spots on its walkways too (`district` `below`), never at a ladder or a stair.

- **paths**: where a citizen, or a bot, can walk (`levels/rp/paths.mjs`). It is made from the plan (the streets' cells,
  the walls and their checkpoints, each building's rooms, doors, entrances and stair, the level below's cells and its
  ways down) and, with the compiled map, held against it. Unlike every other point of the JSON, a node's `at` is a
  **standing player's origin** (the floor + 36), because the .rcw wants it so and a bot is sent to it as it is.
  - `nodes`: `id`, `at`, `kind`, `district`, `part` (the street or area, a room as `<building>.<room>`, a part of the
    level below). Kinds: `street` (open ground), `sewer` (a walkway below), `room` (a point in a room, a hub or a
    corner), `place` (the room's middle where a job works; `place` is the id in `places`), `door` (a doorway's
    threshold, with `door` its targetname and `gate` what it is, or a spot 40 units in front of it, `approach`), `stair`
    (a flight's foot, start, end or landing), `ladder` (a ladder's foot), `hatch` (a ladder's top, on the ledge beside
    its lid, or in a den's floor). A spot a roaming citizen walks to has `roam`, its index in `roam`: every spot of
    `roam` is on exactly one node, and none is left on a prop's cell, behind the outfall's bars, or where the compiled
    map has no floor (the build says which it dropped).
  - `links`: `a`, `b`, `how` (`walk`, `stair`, `ladder`, `jump-down`), both ways unless `oneWay`. `gate` says what
    stands in the way: `door` (a named leaf, a property's, `via` its targetname), `gate` (a checkpoint in a wall),
    `lid` (a manhole's, slid by use), `grate` (a drain's, shot to break), `secret` (the den's hidden door),
    `trapdoor` (the den's lid in its floor). `way` names the way down a link belongs to.
  - The sewers on several levels (`below.levels`; levels/rp/deep.mjs, levels/assembly/README.md "Sewers on several levels"):
    their nodes are `sewer`, `place`, `stair` (a tread), `ladder`/`hatch` (a shaft's foot and top) with a `level` (the
    level's id) and `district` `below`; the links between levels are `stair` (a walk) and, for a shaft, `ladder` with `way`
    (the plugin leaves ladders out), so a level reached only by ladder is a WARN and a stair no walk joins a FAIL; the
    graph stays inside the plugin's caps (2048 nodes, 8192 directed edges, 320 nodes in a route; `npc-sim` reports them).
  - `ways`: each way down of the level below (`stair`, `manhole`, `drain`, `trapdoor`) with its `top` node (on the
    street, or in the den) and its `foot` (in the sewer). `checkPaths` holds that each joins the streets to its foot
    **by itself**: with the other ways' links taken out.
  - What is held: every `place` and every `roam` spot is on a node and reached from every other (one piece: a piece
    with no place and no way in it is cut off and left out, and said); the points are inside +-4096, the most a
    plugin's message carries (the city is about 3 000 x 3 500 units, so every node is); a walk is flat and a stair no
    steeper than 45 degrees. Against the compiled map (`levels/tools/build-site.mjs`): each node's floor, where a standing player's
    hull rests, is within 12 units of the node (20 on a stair), and each link has floor within 14 of its line every 8
    units (18 on a stair); what fails is dropped (`pruned`, the first 40 sentences in `notes`) and the build says each as a
    `WARN`. A room whose door a prop blocks goes with it. A ladder is not walked by the map check.
  - The **.rcw** (RCBot's waypoint file, `rcwOf`) is written from the same graph: the nodes of the piece with the
    most roaming spots, the links `build-site --rcw-gates` lets through (default `gate`: the checkpoints. A leaf with a
    key, a lid slid by use and a hidden door are not for a bot, so the interiors are left out and the sewer is reached
    by the stair; `gate,lid,grate` puts the manhole's and the drain's ladders in, flagged `LADDER` at both ends). At
    most 1024 waypoints (RCBot's room). The first 50 are goals spread over the map (the bots pick among them), then the
    rest. `CROUCH` and `JUMP` are written for a node with `crouch` and a `jump-down` link; the city has neither.
    The map name in the file is the map's, exactly, or RCBot does not load it.

## What the map holds for a mission

All named `smak_rp_<name>_arena_<arena>_<what>`:
- the arena's brushes, sealed, no way into the city;
- `info_target`s where the JSON's `spawns` and `back` are (so a picture or a check can find them);
- the steps' targets: `trigger_multiple` (with `spawnflags` 0 and a `wait` of 1), `func_button`, `func_breakable`;
- one `multi_manager` named `..._reset` that puts the arena back as it was.

An arena's `plan` (site spec `arenas`, `levels/assembly/arena.mjs`) gives it its shape; each has `spawn1..n`, `back1..n`,
`goal` (the pad), `button` and `reset`, and:
- `room` (the default; 512 x 512 x 192 at least): one box, `crate`;
- `yard` (1024 x 768 x 192): stacks for cover, breakables `crate1..3`, the pad on a dock up four steps of 16;
- `vault` (896 x 512 x 192): two rooms and `vaultdoor` (a `func_door`, shut at the start, opened by `button` outside and
  `button_in` inside, back after 20 s by itself: a door cannot be told to shut, only to toggle, so `reset` does not fire it);
  the pad and the strongbox `crate` in the inner room;
- `tunnel` (1024 x 640 x 192): a snake of corridors 128 wide, `button` in the middle lane, the pad in a chamber at the far
  end (room for a `survive` step); no crate.
`spawns: n` (1 to 4) makes fewer starts, and so fewer entities: the engine holds about 1200, and each arena costs 11 to 15.

## The party and the mission, as the plugin plays them

- `/party` opens a menu: invite a player near you, leave, see who is in it. A party has at most 4. A player is in one
  party at most; a player alone is a party of one.
- A player uses a giver: a menu lists its missions (those whose arena is free, with how many players each takes).
  The leader chooses one; each member near the giver (within 512 units) is asked, and those who accept go.
- The arena is held, `reset` fired, the members put at `spawns` (their health filled), the time started.
- The mission ends done (the last step done), failed (time out, every member dead or left the server), or quit
  (`/quit`). Whatever the end, every member still on the server is put at `back` and the arena freed.
- A member who dies in the arena is out of the mission (they respawn in the city as usual); the mission goes on with
  the rest.

## Not yet

Enemies in an arena. TS's server library (`mp.dll`) holds the names of a few Half-Life monsters
(`monster_human_grunt`, `monster_barney`, `monster_scientist`), but whether they work in TS has not been tried. The
first missions are without enemies; enemies wait for a test in the game.
