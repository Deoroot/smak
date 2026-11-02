# Havoc9 (H9) role-play maps and the New Byzantium generator: what a SMAK city spec should know

A read-only study, 2026-11-01, to inform SMAK's city-map specification. **Measures and descriptions only.**
No code, geometry or texture is copied; texture and wad names are given only as names.

Sources read:
- the H9 repo `github.com/2cwldys/HAVOC-NINE` (cloned shallow and sparse into
  `C:/Users/User/Downloads/TEMP/havoc-nine-src`, BSPs left as LFS pointers): `docs/XASH_MAPPING_LIMITATIONS.txt`,
  `docs/PLAYER_LIMIT_128.txt`, `docs/GAME_MODES.txt`, `docs/COMMANDS.txt`, `docs/AMX_PRESETS.txt`,
  `xash3d-h9-patches/patches/PATCH_CHANGELOG.md`, `H9XASH/ts/maps/*`, the configs, `SMAK/profiles/`;
- the delivered generator `C:/Users/User/Downloads/TEMP/h9_tsrp_newbyzantium` (`plan.mjs`, `kit.mjs`, `nexus.mjs`,
  `city.mjs`, `checks.mjs`, `score.mjs`, `bigtest.mjs`, `bsp2.mjs`, `STUDY.md`, `REDESIGN.md`, the `.bak` files of
  earlier passes, and `out/` (compile logs, checks logs, `walk.txt`, `plan.json`)).

Not in the repo: the generator's `../lib.mjs` and `../h9_tsrp_hive/wads.mjs` (they live in the author's
`D:\Downloads\TSM\export-map\`, which the export does not ship), the compilers (`sdhlt-goldsrc-net`), and any
role-play plugin or car mod (see section 2).

---

## 1. The H9 maps; which are cities

Sizes are the compiled `.bsp` (from the LFS pointers in `H9XASH/ts/maps`).

| map | BSP size | what it is |
|---|---|---|
| `h9_tsrp_hive` | 45.6 MB | **city**: Alexandria, Paradise City and Xenon City merged into one map, stacked in Z (names prefixed `al_`, `pc_`, `xe_`); BSP2 |
| `h9_tsrp_newbyzantium` | 42.9 MB (46.6 MB latest in `out/`) | **city**: the generated one studied here; BSP2 |
| `alexandria_msr_b5` | 23.1 MB | **city** (the MSR city; `.map` sources b4v3 and b5 ship) |
| `paradisecity_revival_final` | 11.6 MB | **city** (`.map`/`.rmf` ship) |
| `xenoncity_final` | 10.2 MB | **city** |
| `ts_wyndham`, `ts_neobaroque`, `ts_antrodome`, `ts_faculty`, `ts_urbannights`, `ts_frigid`, `ts_casa`, `ts_panzibar`, `ts_supertimor`, `ts_central`, ... | 2 - 14 MB | stock TS deathmatch arenas (about 30) |
| `h9_te_neuropolis`, `h9_siege_neuropolis`, `h9_te_meridian`, `h9_*_lift` (mw/up/ws/siege), `h9_*_drainage` (mw/up/ws), `ctb_deadheat` | 2 - 6.5 MB | H9 match-mode maps (team elimination, siege, uplink, mechwarrior) |

The three source cities, as measured for New Byzantium (`STUDY.md`, by `smak map-character` and `map-wiring`):

| | Alexandria | Paradise City | Xenon City |
|---|---|---|---|
| extent x y z | 7560 x 8012 x 4872 | 7224 x 7779 x 1899 | 4673 x 5467 x 3565 |
| floor (thousand sq u) | 41,219 | 23,344 | 28,198 |
| faces | 28,442 | 16,659 | 16,651 |
| walls off grid / floor sloped | 13.7% / 7.3% | 11.3% / 5.9% | 12.5% / 7.3% |
| height spread | 650 | 418 | 1163 |
| textures / props / sounds | 444 / 101 / 94 | 236 / 214 / 47 | 68 / 57 / 29 |
| lights / lamp faces | 104 / 1403 | 53 / 1204 | 59 / 583 |
| floor light (mean of 255; share under 24) | 58.9; 21% | 62.1; 13% | 104.3; 15% |
| doors (named) | 111 (97) | 99 (91) | 94 (94) |
| switches / walk-in triggers | 53 / 6 | 45 / 2 | 35 / 0 |
| lifts and trains | 8 | 6 | 9 |
| heal / hurt places | 5 / 0 | 0 / 5 | 2 / 8 |
| teleports / breakables that respawn | 3 / 32 | 0 / 14 | 4 / 3 |

Each city is about 7,500 units across: one city fills most of the stock +/-4096 box. Their layout (from
`smak map-plan`): streets are roofed corridors 128-350 wide (median way 228-303), rooms 200-600 across hang off
both sides through doors, solid rock behind (the city fills about half its square), 2-3 open courts each, one
dominant landmark, headroom 167-213, 3-5 floors stacked, median sight lines 760-1280.

The hive merge (`h9_tsrp_hive.map`, 14.4 MB source, 1,707 entities): 336 `ts_model`, 273 `func_door`, 180 `light`,
167 `ambient_generic`, 137 `func_wall`, 127 `func_button`, 123 `func_illusionary`, 91 `func_breakable`,
40 `path_corner`, 26 `info_player_deathmatch`, 24 `multi_manager`, 20 `func_door_rotating`, 19 `func_train`,
19 `func_ladder`, 15 `trigger_hurt`, 13/10 teleport destinations/triggers, 13 `func_water`.

---

## 2. What the role-play game needs from a map

### There is no RP gamemode code in the repo
- H9 decides the mode **by the map's name**: `rp_` or `tsrp_` at the start, or `_rp_`/`_tsrp_` anywhere
  (`roleplay_map()` in `ts_matchmode.sma`). On such a map the match mode stays out: "the game as it ships",
  TS deathmatch rules, TS's own cash (`usecash 0`) and powerups, no team menus. Worldspawn `gamemode` key still
  wins (1 DM, 2 teamplay, 3 LMS, 4 The One).
- The only RP-specific plugin is `tsrp_roambots.amxx` (unarmed RCBot "citizens" walking public spaces; see below).
- An RP plugin suite is only *researched*: Apollo-RP (`ARP_TS.amxx` exists for TS; MySQL in practice; per-map SQL
  seed files keyed on door names; last real commit 2012). `docs/AMX_PRESETS.txt` describes swapping its config, not
  installing it. STUDY.md: "named or not: the RP plugin comes later".
- **No car mod.** Nothing named carmod or "fisk" in code; "mr fisk" is credited only for "assistance with
  mapping". reTS has no `func_vehicle` entity (only CS-SDK leftovers in `player.cpp`); the drivable thing GoldSrc
  offers is `func_tracktrain` + `func_traincontrols` (rides on `path_track`s). The pass-2 "roads" are geometry only
  (section 4). A road spec should assume cars come later from a plugin, and size roads for them anyway.

### What a map must carry (from the cities, `docs/MAPS-DESIGN.md` "A role-play city", and `map-wiring`)
- **Every door a property**: 94-111 doors per city, nearly all **named**, one name per home or shop
  (`resident1..9`, `lux_apt_a..d`, `citizen`, `clubdoor`, `estategatep`, `gunshop`, `gearshop`, `bankdoor`,
  `office_door`, `gang_hideout`, ...). The name is what an RP plugin hands out as a key. Doors opened by use
  (spawnflag 256), not touch, so they can be locked.
- **Jail**: cells with named grate doors (`al_cell*`, `xe_cp_prison` x6, `pc_mdcell`), a police/MSR HQ
  (`xe_cp_help`, `xe_cp_armory`, Alexandria's MSR core with four spawn lifts `spawn.core.1..4`, blast doors
  `ug.blast`, maintenance gates).
- **Jobs/shops** are implied by named places: gun shop, gear shop, bank, club, cafe, lab with working machines
  (`fabricator`, `lab_radio_machine`), food processing, datacom, offices, clinic.
- **Housing**: flats and luxury flats (named), an estate with a keyed gate, storage units, hideouts.
- **Switches that make a room live**: 35-55 per city (lamp, TV, radio, club music, shower, stove, oven that
  kills, alarm said from 9-11 speakers). Named lights are capped at **32 switchable light styles** (styles 32-63):
  the cities use 11-14 lamp switches.
- **Lifts/trains**: 6-9, one with several stops; a sewer lift; healing pads (`trigger_hurt` with negative dmg).
- **Spawns**: TS's picker reads only the first 32 `info_player_deathmatch` it finds (`TS_gamerules.cpp`).
  New Byzantium has 52 (about 26 a side); 64-player running needs 32+ a side (`amx_tsm_spawn_save`).
  The generator places at least 72 (aim 104) spawns, public spaces only, 560 apart, clear of doors.
- **Roaming citizens** (`tsrp_roambots`): default 12 bots, 2 slots reserved, walk 120 u/s, 40% pause chance,
  unarmed; spawn spots in `configs/tsrp_roamspots_<map>.cfg` (`roamspot <district> x y z`, New Byzantium has
  ~1,720 lines); waypoints `.rcw` laid in public spaces only (the generator writes both from its `plan.json`).
  The RCBot roam patch accepts waypoints to **+/-16384** (stock RCBot drops anything past +4096).
- **Players**: the engine clamps `maxplayers` to **32** today (`sv_init.c`), AMXX's player table is 33, reTS
  slow-motion tables are 32. The plan (`PLAYER_LIMIT_128.txt`) is: build for 128, run at **64**, keep default 32
  until done (4-6 weeks estimated). At 64 the server does ~4x the per-viewer entity work of 32; the server is a
  32-bit process without large-address-aware (2 GB), and the packet-entity ring alone is 170 MiB at 32 slots,
  340 at 64. New Byzantium's 46 MB BSP lives in that 2 GB.
- **Edicts at run time**, counted from the maps' entity lumps:

  | map | in lump | untargeted lights (freed) | stay | peak at 64 | peak at 128 |
  |---|---|---|---|---|---|
  | h9_tsrp_newbyzantium | 3,942 | 2,494 | ~1,447 | ~2,000 | ~2,650 |
  | h9_tsrp_hive | 1,707 | 158 | ~1,549 | ~2,100 | ~2,750 |

  Per player: the player, one `weapon_tsgun`, an icon, plus corpses and dropped weapons.

---

## 3. Xash / H9 limits (the numbers that constrain a huge layered city)

### 3.1 Map extent
| | reach | why |
|---|---|---|
| stock GoldSrc | +/-4,096 | network origin bits |
| **H9 on Xash** | **+/-32,768** | `ts/delta.lst` widened (entities 19 bits in eighths, players 21 bits in 32nds, clientdata 23 bits in 128ths, custom entities/events 19 in eighths) + `engine-h9-bigworld.patch` (turns on `ENGINE_WRITE_LARGE_COORD`: WRITE_COORD as whole units past +/-4096) |
| hlcsg | +/-65,536 (`-worldextent`) | compiler only; stay inside 32,768. Its "origin outside +/-4096" warnings are GoldSrc's and harmless on H9 |
| game DLL user messages | eighths (+/-4096) | reTS client reads them so: any plugin/user message carrying a coordinate past 4096 breaks |
| RCBot waypoints | +/-16,384 | H9's roam patch; stock 4096 |

**bigtest** (`bigtest.mjs`, `out/h9_tsrp_bigtest.bsp`, 627 KB, BSP2): a sky-open strip 24,000 x 1,024 x 768
(x -12,000..12,000), a lit pillar every 2,048, spawns at 0, +/-4,000, +/-8,000, +/-11,500, and at the far end a
`func_train` shuttle running end to end at speed 900, a `func_door`, a looping `ambient_generic` and a glow
`env_sprite`: everything that travels over the network, at distance. Compiled `-engine xash`, fast vis. No
failure is recorded in `out/`; the bigworld patch and delta changes were written for it (2026-10-31), and the city
was then built to about +/-5,600 x, -8,450..+5,550 y. **Keep the grid idea**: a cheap test map at the target extent
proving players, movers, sounds and sprites before any city is built.

### 3.2 BSP format and per-lump limits (sdhlt with H9's `-engine xash`, Xash's `bspfile.h`)
Formats: `bsp30` (16-bit, every engine), `bsp30ext` (v30 with 32-bit clipnodes, Xash only), `BSP2` (32-bit
everywhere, Xash only). The compiler picks the smallest that fits. **SMAK 0.x's map readers read v30 only** (smak-next
too, until 2026-11-01, when `readBsp` gained BSP2); the generator needed its own `bsp2.mjs` adapter (six lumps re-read wider:
nodes 44 B, leaves 44 B, faces 28 B, edges 8 B, marksurfaces 4 B, clipnodes 12 B).

| lump | GoldSrc v30 | Xash (BSP2) | over Xash's limit | New Byzantium latest (`compile-b1.log`) | NB earlier (doc, 29,846-brush build) |
|---|---|---|---|---|---|
| brushes (all, incl. detail/entities) | 32,768 | **32,768** | hlcsg stops | 24,910 (76%) | 29,846 (91%) |
| brush sides | 196,608 | 196,608 | compiler | - | - |
| entities compiled | 16,384 | 16,384 | - | 4,847 | 3,868 |
| entity text | 2 MB | 2 MB | warns | 474 KB (23%) | - |
| brush models | 512 | **2,048** | **refuses map** | 1,091 (53%) | - |
| planes | 32,768 | 131,072 | warns | 33,105 (25%) | 33,415 |
| vertexes | 65,535 | 524,288 | warns | 158,334 (30%) | 191,717 |
| nodes | 32,767 | 262,144 | **refuses** | 55,128 (21%) | 68,121 |
| leaves | 32,760 (world 8,192 warns) | 131,072 | **refuses** | 37,863 (29%); world 31,322 | 46,737; world 40,616 |
| faces | 65,535 (world 32,768) | 262,144 | **refuses** | 109,486 (42%); world 102,694 | 128,464 |
| texinfo | 32,767 | 32,767 | refuses past 262,144 | 4,299 (13%) | - |
| clipnodes | 32,767 | 524,288 (32,767 per hull per model in bsp30ext) | warns | 138,364 (26%) | 171,493 |
| marksurfaces | 65,535 | 524,288 | warns | 163,298 (31%) | 203,995 |
| edges | 256,000 | 1,048,576 | warns | 276,414 (26%) | 328,893 |
| surfedges | 512,000 | 2,097,152 | warns | 518,463 (25%) | 601,370 |
| textures in map | 4,096 | 4,096 (renderer 8,192 loaded) | - | 163-169 referenced | - |
| texture data | 32 MB | 32 MB | warns | 7.1 MB (21%) embedded | - |
| light data | 48 MB | 48 MB (warns past 32) | warns | 15.4 MB (31%) | - |
| vis data | 8 MB | 16 MB | warns | 7.0 MB (42%), **fast vis** | - |
| lightmap pages | 64 | 256 | "LM_AllocBlock: full" | compiler counts **379 of 256 (148%)** | - |

Lightmap pages: the compiler counts 128x128 pages; Xash uses 1024x1024 pages in a BSP2 map (64x the room), so
379 "pages" fit in practice, but the city **would not load as a v30 map**. Luxel = 16 units; hlbsp subdivides faces
at 240.

The v30 counts that forced BSP2 (from the last log line): vertexes 158,334 (v30 65,535), nodes 55,128 (32,767),
leaves 37,863 (32,767), faces 109,486 (65,535), marksurfaces 163,298 (65,535).

hlvis / hlrad: vis leaves (portal leafs) 32,760 both engines; 256 portals per vis leaf; light patches 1,048,560;
4 light styles per face; 64 light styles in a map (switchable 32-63).

### 3.3 Run-time limits (Xash FWGS, H9 values)
| | Xash / H9 | GoldSrc |
|---|---|---|
| edicts | 8,192 max (13 bits); H9's liblist/gameinfo say **4,098**; Xash default without one 1,200 | 900 by default (`-num_edicts`; not from the H9 docs) |
| **reTS send cap** | **2,048**: reTS `AddToFullPack` drops any entity index >= 2048 (its MAX_EDICTS). At 64 players NB reaches ~1,580 before a shot; late entities (weapons, corpses) past 2047 become invisible. Fix pending (compare to `gpGlobals->maxEntities`) | - |
| entities sent per frame | 2,048 | 256 |
| model precache | 4,096 | 512 |
| sound precache | 2,048 | 512 |
| static sound channels | **256** (every looping `ambient_generic`, near or far) + 64 dynamic | - |
| light styles on network | 256 (compiler writes 64) | - |
| dynamic / entity lights per frame | 32 / 128 | - |
| static entities | 3,096 | - |
| decals | 512 sent, 4,096 drawn | - |
| leaves an entity touches | 48 in v30, **24 in BSP2**: a long brush entity (door, func_wall) can drop out of view; keep them compact | - |
| players | 32 (64 planned) | 32 |

### 3.4 What actually failed or hurt while building New Byzantium
- **Compile failures** (all before BSP2/Xash limits were in the compilers): `Exceeded MAX_WVERTS` (hlbsp, v4),
  `Exceeded MAX_MAP_EDGES` (v4c), `Exceeded MAX_MAP_LEAFS` (v4d, v5; 29,846 brushes, 17,085 rock brushes from the
  carve). Fixed by H9's sdhlt patches (`// 2CWLDYS`) and BSP2 output.
- **Brush count is the real ceiling** (the only limit the same for both engines). The carve made 16-17k rock brushes
  alone; floors between stacked rooms became one detail slab "worn on both faces" to stay under 32,768.
- **PHS memory and time** (`engine-h9-phsbudget.patch`): a multiplayer server builds the PHS at load, memory
  ~ `rowbytes * leaves * 2`, growing with leaves squared. 46,744 leaves -> **521 MB**, which froze or OOM'd a
  32-bit listen server. A later build (26,388 leaves, 166 MB) compiled with **fast vis** saw 60% of all leaves
  from the average leaf: ~1,300 GB of OR work, hours of frozen load. The patch skips the PHS past **192 MB** or
  **8 GB of merging**; then sounds and PAS messages reach every player. Lesson: **a full vis and few leaves matter
  as much as lump limits**; a draft vis on a huge map is not just ugly, it is unloadable.
- **Vis cost**: hlbsp left 5,113 portals between 3,437 portal leaves; SMAK guesses a full hlvis at ~221 s, growing
  with the square of portals. Lower portal counts: decorative world brushes as `func_detail`, big rooms kept apart
  by bends and doors.
- **hlrad cost**: full bounce at the default chop on the whole city ran for hours; the build uses full vis +
  `-chop 128 -texchop 64` (or `-fast` for drafts). Timings, latest builds: hlcsg 16-22 s, hlbsp 123-230 s, hlvis
  4-7 s (fast), hlrad 150-840 s; 428,236 base patches.
- **Edict warnings**: 1,447-1,912 entities exceed Xash's default 1,200 unless gameinfo sets `max_edicts`.
- **Sounds**: 240 looping sounds kept of up to 319 wanted (the 256 static-channel cap, minus headroom).
- Dark doors: checks still find 3-4 doors "dark on one face" (light under 8 of 255).

### 3.5 Budgets for a quadrant-built huge 3-layer city (derived)
- Extent: plan inside **+/-16,384** if roam bots must walk it (RCBot), otherwise +/-32,768; never rely on user
  messages carrying coordinates past 4096.
- One BSP2 map holds about **one New Byzantium** (11,200 x 14,000 x 5,300 units, ~25-30k brushes) before the
  **32,768-brush** wall. A city several times larger cannot be one map of the same density: either lower density
  (bigger rooms, fewer brushes per room), or several maps (quadrants) joined by changelevel. The brush budget per
  quadrant should be ~25k to leave room for fixes.
- Keep **leaves under ~25k and a full vis**, or the PHS is skipped (sounds global) or the load freezes.
- **Brush models 2,048** (each door, func_wall, button, glass pane, illusionary sign is one): NB used 1,091 with
  ~750 doors. An RP city with "every room a door" plus glass and signs reaches it quickly.
- **Edicts**: target < 2,048 total at peak (reTS cap) until fixed: ~1,450 static map entities + 3 per player.
  Untargeted `light`s free their edict; named (switched) lights do not, and only 32 can switch.
- **Looping sounds** <= 240; **switchable lights** <= 32; light data < 32 MB (warn), lightmap pages fine in BSP2.

---

## 4. How the New Byzantium generator works

Pipeline (`city.mjs`): `buildCity()` (plan.mjs) -> list of **spaces** (rooms, streets, halls, shafts with outline,
floor, ceiling, texture set), **fittings** (world/detail brushes), **entities** -> `carveTiled` (kit.mjs) carves all
spaces out of solid rock in 3,072-unit tiles with 64-unit outer walls, the undercity and the city carved apart at a
seam (z -16) -> `wearFromSpaces` re-textures each rock face's floor/ceiling from the space it faces -> `.map` +
`.plan.json` (every space with kind, public ways) + `.res` -> roam waypoints -> `checkPlan` at range 32,768 ->
compile (`-engine xash`, full vis, hlrad `-chop 128 -texchop 64`) -> `checks.mjs` -> `score.mjs` against the
three cities. A `--preview` builds the middle (+/-2,600) as a v30 file so SMAK's renderer can draw it.

### 4.1 Plan: layers, districts, streets
- **Layers (Z)**: cistern -880 (water -896), sewer -704 (to -352), street 0 (avenue roofs 528, ring 352, street 352,
  alley 336), galleries +176 and +352, ward 704 (to 896), Mese (upper city) 1056 (to 1504), court sky 2304, well sky
  4352. Storey 176, room height 160, wall 16, door 56 x 112, window 48-112.
- **The Well**: an open octagonal shaft +/-1,664 (chamfer 448) to the sky; the Nexus stands in it on 22 steps.
- **Grid**: street lines at 0, +/-1,152, +/-2,432, +/-3,200 (ring), +/-4,096, +/-4,864 (outer), plus minor lines
  +/-3,648, +/-4,480; each line shifted by a fixed per-line offset (32-160) "so no two blocks match", streets and
  alleys jittered +/-32. Widths: avenue 384 (galleries at 176 and 352), ring 256, outer 224, street 192/224, alley
  112/128. Streets dropped or turned into alleys per district probability. Landmark plots reserved.
- **Districts**: the 3x3 squares around the well (`districtAt`): Foundry, Gate Ward, Infirmary / Works, (Well),
  Bazaar / Rookery, Stacks, Spire Heights; plus regal (Mese), sewer, canal styles. Each style has: street texture
  set, weighted ground and upper room-kind mixes, light colour, alley/drop/gallery/mess/door probabilities, and
  **footprint widths (128-320) and depths (160-512)**.
- **MSR network**: 8 street precincts (4 cardinal by the avenues, 4 at the ring corners), each a lobby, front desk
  with glass, 2-3 holding cells, a spiral-stair core from sewer to ward; under each an undercity checkpoint (post,
  window, cell, portcullis across the sewer main with a button); ward checkpoints off the four Ascent landings; four
  Mese checkpoints at the Nexus bridges (post, cell, portcullis). Ward level: ring round the well, wings over the
  avenues, an outer ring over the ring road, enclosed bridges into the Nexus. 24 checkpoints total.
- **Ascents** (4 stair halls, sewer -> street -> Mese, ten flights), **Descents** (corner stair halls to the ring
  sewer, pass 2), **landmarks** (Stacks light well, Heights garden, Bazaar hall, Foundry casting hall, Rookery
  roofless hall, Basilica, Exchange, Ministry, Palace Row), **undercity** (sewer mains under avenues and ring, dens,
  cistern 3,072 square on columns), **canals** south of the gate (quays, barges, pump house, shanties).
- **Frontages** (the bulk of the city): for every street side, walk along it placing **units**: pick a ground kind
  from the district mix, width from the style list (x1.5 for shop/bar since pass 2), the deepest free depth, stack as
  many storeys as galleries allow; each storey is one room with one door onto the street, a lamp over the door, a
  glass front/fascia/awning for shops, furniture, props, a lamp; 20% get a back room; some fronts are blank windows.
- **Spawns**: street middles, sewer walkways, avenue galleries, the well plaza, canal quays, cistern, Bazaar hall.
- **Sounds**: ranked wish list; kept if no other within 600 (320 in a room), same file not within 1,800, max 240.

Final build (`compile-b1.log`): 288-319 streets, 2,673 spaces, **750 rooms / 750 doors** (slum 199, flat_poor 113,
flat 82, shop 64, workshop 63, bar 56, flat_lux 44, storage 43, clinic 29, office 29, cell 20, msr 8), 16,037 rock
brushes, 7,732 detail brushes, 4,847 entities, 169 textures, 61 spread spawns (plus fixed ones).

From `plan.json` (2,826 spaces): extent x -5,616..5,584, y -8,448..5,552, z -944..4,352. **Median room 192 x 256
x 160** (813 rooms); street 224 wide x 352 high; alley 112 x 336; avenue 384 x 528; MSR rooms median 80 x 176 x 128.

### 4.2 Kit
Pieces: `Occupancy` (512-unit spatial hash of reserved boxes), `carveTiled`, `clipBrush`, `wearFromSpaces`, `Bag`,
`door` (8-thick leaf sliding into the wall or up as a shutter, picture fitted once, use-only when named),
`secretDoor` (wall-thick leaf in the wall's own texture, use-only), glass, plates/signs, lamps, `furnish` (boxes
along walls by room kind: bed, kitchen, couch, rug, paintings; shop shelves; etc.), `furnishProps` (`ts_model`
props), litter (models, with clips), fog sprites, sounds, shaft ladders, breakable grates, blade signs, columns,
ramp and spiral stair cores. Door pictures with texel sizes (`DOOR_PICTURES`), sign textures with sizes (`SIGNS`).

### 4.3 Checks (`checks.mjs`)
floors (every walkable top wears its space's floor; ~1.4 M samples on ~200 heights), strays (no loose small brushes
on public floors), doors (leaf size, picture fitted once, only cells see-through, lit on both faces in the compiled
map), sounds (in a built space, reach fits the space, music only in rooms beside a source), signs (not facing a
wall), starts (>= 72, public only, spread over districts and levels, headroom, clear of doors, not facing a wall),
limits (brushes < 32,767, brush models + precached < 2,048, edicts < 4,098 - 64 - 400, loops <= 240, lightdata
< 48 MB from the log). A separate walk test (`walk.txt`, `walk.mjs`; not SMAK's `reachOf`, which it never calls: it
joins spaces of `plan.json` whose outlines touch, doors open, and walks no geometry; see notes-generator.md section
2): every space reachable from the avenues;
hidden places 32/32 reached; 267 MSR spaces on the Nexus network; 37 openings where public meets MSR; per-district
checkpoint coverage. **Not checked**: property naming of doors, building identity/variety, sight lines, corridor
length, room size against the cities, leaf/portal/PHS budgets.

### 4.4 Score (`score.mjs`)
`map-character` figures of NB beside Alexandria, Paradise, Xenon and the profile's quartile band (offGrid, sloped,
levels, heightSpread, textures, props, sounds, music, lights, lampFaces, lightMean, shadow, brightest), via
`bsp2.mjs`. The roleplay profile (`profiles/specialists-roleplay.mjs`, identical in smak-next) holds `CITIES`
bands: offGrid 11.3/13.7/16.5, sloped 4.8/5.9/7.3, levels 11/13/13, heightSpread 418/650/1064, textures
64/236/444, sounds 38/47/94, props 70/101/214, lights 53/93/104, lightMean 58.9/62.1/87.1, floor area 23.3-41.2 M.

### 4.5 What each pass changed
- **Before pass 1** (`checks-before.txt`): 26,742 brushes, 1,255 brush models, 1,031 doors, 208 loops, 0 props
  (boxes as debris); 967 bad floors, 3,725 stray brushes on public floors, 3,239 door offenders.
- **Pass 1 (fixes)**: wall ladders and breakable grates in sewer shafts; fitted signs dealt per street without
  repeats; a door on every room; fewer upper rooms; trash models instead of crate boxes, kept off doorways;
  catwalks cut at crossings; more fog; floating pedestals fixed; two stairwells from the Well to the cistern;
  district soundscapes, no tune twice in earshot, no Half-Life sounds. Result ~22,200 brushes, ~930 models,
  ~734 doors, ~530 props, ~140 loops.
- **Pass 2 (REDESIGN.md)**: `DISTRICT_ROOMS` palettes (per-district room texture sets) on top of the city-wide
  `ROOM_TEX`; shops/bars 1.5x wide; the Nexus rewritten as MSR HQ (`nexus.mjs`: undercroft jail of 12 cells
  128 x 176, guard post, booking, interrogation, armory, lockers, sally-port garage; lobby with front desk;
  operations floor; command floor with commander's office; two stairs; four tunnels under the plaza to the cardinal
  precincts); precincts with lobbies, desks and cells; Descents; carriageways on avenues/ring/outer; ~32 hidden
  places (secret back rooms, hidden study off the Mese, smugglers' dens, winding passages). **Not done**: the
  building types of REDESIGN section 2 (apartment block, townhouse, big store, club, warehouse...) - the frontage
  stacker remains; homes 60/40 over shops; landmark per district hub; hidden doors in the Nexus upper hallways.
  Latest: 24,910 brushes, 1,091 models, 750 doors.

---

## 5. User complaints -> root causes in the generator

| complaint (REDESIGN.md) | root cause |
|---|---|
| "everything looks like carbon copy storefronts", "copy pasted", "no real estate or proper polished buildings" | **One unit type.** `frontage()` is a single stacker: every enterable thing is one box room, one street door, one lamp over it, same fascia/pilasters/awning recipe for every shop. No building as a whole exists (no lobby, stairwell, facade, roofline, number); a "building" is just adjacent units. Facade variety comes only from texture picks. |
| "tiny areas everywhere" | Footprints from `style.widths` 128-320 and `depths` 160-512, room height fixed 160: **median room 192 x 256 x 160**; holding cells 192 x 80; MSR rooms median 80 x 176. The source cities' rooms are 200-600. |
| "WAY too many enterable buildings", "areas without doors" | Every unit along every street side, on every gallery storey, is a room (1,318-1,339 rooms before pass 2, 750 after). The blank-front chance is only 5-15% per district (`BLANK`). Quantity is driven by street length, not by an RP budget (cities have ~100 properties). Openings without leaves (`opening` without door) leave doorless holes. |
| "more homes than stores" | District ground mixes are shop/bar-heavy (Bazaar 5 shop + 2 bar of 10, Mese 3+2 of 8); the 60/40 homes target was never encoded. |
| "looks like we applied whatever, anywhere", "poorly textured", "needs a theme per district" | `pick(rng, list)` per room from `ROOM_TEX[kind]` (city-wide, mixed families: cyber*, sin*, cd_*, po_*, MJST*); `DISTRICT_ROOMS` (pass 2) covers only some kinds per district, the rest fall back to the city list. Streets have one texture set per district but avenues/ring override with a fixed set city-wide. The carve's default grey (`grey_creteflr2`/`po_concretwall`/`crete3_ceil03c`) shows where `wearFromSpaces` cannot attribute a face. No palette is a closed set; trims/doors/signs are chosen independently of walls. |
| "the Nexus looks like some monument dome", "no place to jail people", "doesn't lead to any MSR building", "can't reach lower levels", "hollow shell" | Pre-pass-2 `nexus()` built a ceremonial octagon (dais and seat, chandelier, balconies, dome, spire) with no program; jail cells lived only in small precincts. Fixed in pass 2 by `nexus.mjs` (HQ program + tunnels), but the hall's volume (octagon 896 across, 352..1408) is still mostly the dome's air. |
| "sprawling hallways that go on forever" | The **ward level**: ring round the well 192 wide x 3,776 per side, wings 128 x 1,248, outer ring 128 x 6,528 per side, all 192 high, plus 4 tunnels 128 x 3,072 x 160: ~58,000 units of identical MSR corridor (one texture set `MJSTFLOOR01/MJSTWALL10/MJSTFLAT03`, a lamp every 448-768), only 8 spurs and 4 checkpoints off them. Walk test: ward level has 0 public spaces. Long straight streets (median 688-848 per segment, sewer mains 6,656) too. |
| "clear and distinct ways to reach higher and lower parts", "more passageways" | Vertical links are few and fixed: 4 Ascents, 4 Descents, 2 well stairwells, spiral cores inside MSR precincts (not public), gallery stair-ramps; no district hub lift/stair landmark. The grid is a lattice, so passages between districts are just more identical streets. |
| "no roads for cars" | Pre-pass-2 nothing; pass 2 drops a carriageway 8 units into avenue/ring/outer (lanes 256/160/128 wide, `asphalt04`, kerb texture) inside the same roofed corridor (ceiling 352-528), no parking, no turning space, no vehicle entity. |
| "hidden doors and areas" | Pass 1 none; pass 2 adds `secretDoor` (wall texture, use-only) in max 8 back rooms (10% chance), Mese studies, sewer dens, passages: 32 hidden places. The requested Nexus upper-hallway secrets were not built. |
| "big crowded street ... boring and not roleplay accessible" | The generator optimises coverage (fill every frontage) and dressing counts (props, sounds, signs against the cities' bands), not RP function: no property naming (frontage doors get **no targetname**, so an RP plugin cannot key them), no ownership groups (a flat + back room is one property only by convention), no job sites, no capacity per player. |
| signs misaligned/facing walls, debris in the way, fog, sounds | Fixed in pass 1/2 (signs check, litter as models clear of doors, fog sprites, sound spacing). |

The checkpoints and cells (the user liked the idea, not the result): 24 checkpoints were stamped from one template
per level, placed by geometry (avenue/ring intersections, bridge heads), not by where the city needs policing;
precinct cells 192 x 80 (smaller than a bed), Mese/undercity cells one each; portcullis gates span sewer mains
and bridge mouths with a single button; the MSR network is reachable only through MSR doors, so to the public
it is just locked doors on long corridors.

---

## 6. Worth keeping

- **The Byzantine regal look**: the Mese/Nexus palette - marble floors (`marb`, `marb062`, `hMarb_surfaced3`,
  `sinpalacefloor`), marble walls (`sinmarblewall`, `sinwall32`), gold trim and fascia (`singold`, `sintrim`),
  gold ceilings (`sinceiling3`), stone-and-gold columns, MJST (majestic.wad) walls/floors/doors for the MSR,
  dark wood (`wooddark`, `sinfinewood`, `sinwoodwallluxu`), chandeliers and banners. The user named "the pillars
  with the stone and gold" as the theme to keep; dark marble / cement contrast with gold.
- **The bigtest grid**: prove extent, movers, sounds, sprites at distance before building.
- **Spaces carved from rock** + `wearFromSpaces` + one detail slab per floor between stacked rooms: the brush economy
  that let a city this size fit 32,768 brushes.
- **Layer stack** (cistern / sewer / street / galleries / ward / upper / sky well) and the Well as the one great sky
  view; districts in a 3x3 around it; canals as an open outskirt.
- **plan.json with space kinds and public ways**, from which roam waypoints, roamspots, spawns and the walk test are
  derived.
- **The checks** (floors, strays, doors lit, sounds, signs, starts, limits) and the walk test with MSR-network and
  hidden-place coverage; the sound keeper (rank, 600/1,800 spacing, 240 cap); spawns >= 72 in public ways.
- **MSR HQ program** (lobby/desk, booking, jail block with guard post, interrogation, armory, lockers, garage,
  operations, command, tunnels to precincts) as a building type; **portcullis checkpoints** as an idea.
- **District soundscapes**, no tune twice in earshot, music only beside a source; night lighting by local coloured
  lamps (mean ~60 of 255, a fifth in shadow).

---

## 7. Texture sets and wads per area (names only)

Wads embedded (`-wadinclude`, Valve's halflife/liquids/xeno/decals excluded), with textures used of total:
`alexandria_msr_b4v3_generated` 77/595, `cyberdynamics` 22/497, `xenoncity_true_b3v2_generated` 17/83,
`avp2` 12/1,338, `paradise_missing` 12/60, `majestic` 9/25 (Randy Reddig, scmapdb; the MSR's own), `specialists`
7/116, `io_v1` 6/391, `submerged` 2/169, `techno` 2/470. 166 textures referenced, 7.1 MB embedded.
The hive also uses `halflife`, `liquids`, `xeno`, `decals`, `zhlt`.

Texture families by area (from `STYLES`, `ROOM_TEX`, `DISTRICT_ROOMS`, `TRIM`, `nexus.mjs`):

| area | street / walls | rooms | trim |
|---|---|---|---|
| Mese, Nexus (regal) | `marb` floor, `sinmarblewall`, `sinceiling3` | marble/palace floors, `sinwoodwallluxu`; Nexus `MJSTWALL04/09/10`, `MJSTFLOOR01/02`, `MJSTFLAT01/03`, `MJSTTRIM01`, doors `MJSTDOOR02`, `cd_wooddoor` | `sintrim`, fascia `singold` |
| Spire Heights | `sintilesfloor`, `sinmarblewall`, `fap-ceiling03` | `sinwall32`, `sinwoodenfloor5`, `WOODFLOOR02_256`, `marb062` | `sintrim`, `singold` |
| The Stacks | `po_slasphalblgr`, `wallvault1`, `ceilingpipec` | `sinbrickwall`, `howall3b`, `po_concretwall`, `singhetto*` | `po_concretwall` |
| The Bazaar | `sintilesplain`, `cyberwall2` | `cyberwall3`, `cyberfloor`, `cyberbar`, `stec_panel3` | `cyberwall2` |
| The Infirmary | `cds_tilefgray`, `wht_wall1` | `wht_wall1`, `cds_lab*`, `cds_tilefwhite` | `wht_wall1` |
| Gate Ward | `Pavement001`, `bigcrete2` | concrete, storage | `bigcrete2` |
| Foundry / Works | `grey_creteflr(2)`, `mo_rustwall1`, `po_concretwall`, `ceilingpipec` | rust metal, grey concrete | `mo_rustwall1`, `metal5` |
| The Rookery | `po_slasphalblgr`, `sinbrickwall` | `po_rustmetalblu`, `po_subtrash`, `singhettofloor` | `sinbrickwall` |
| Undercity | `po_sewerfloor`, `po_sewerwall` | slum/den sets | `po_sewerwall` |
| Canals | `pkf_concrete5a`, `bigcrete2`, sky | storage, workshop | `bigcrete2` |
| Avenues / ring (city-wide override) | `sinfuturefloor` + `stec_panel5b`; ring `Pavement001` + `wallvault2`; roads `asphalt04` + `pkf_trimpavemen` | | |
| MSR rooms, cells, ward | `stec_panel5b`, `gratefloor`, `wallvault2`, MJST sets; cells `stec_panel3` + `vaultfloor`, doors `{grate1`, portcullis `{grate2` | | |

Doors by kind: flat `homedoor1dn`, poor `door006`, lux `cd_wooddoor`, shop `garage03` (shutter, rises), bar
`cds_wooddoor1` (pair), clinic `cds_labdoor1`, office `cds_metaldoor1`, workshop `metaldoor2dn`, storage
`o_mtldoor3`, slum `mo_mtldoor1`. Signs: `{xc_*` (Xenon), `{PC_*` (Paradise), `sign_*`, `jap_sign2`, `hb_sign_028`,
`cd_sign_cafe`. Sky: a custom dystopian night skybox (`sky.mjs`).

Sound families: `alexandria/*`, `paradise/*`, `amethyst/*`, `ambience/*` (TS and community), no Half-Life sounds.

---

## 8. SMAK 0.x vs smak-next, for the spec

- `smak map-character --mod profiles/specialists-roleplay.mjs` and `smak map-wiring` exist in smak-next
  (`docs/COMMANDS.md`); the roleplay profile is identical to the one in the H9 repo's SMAK copy.
- smak-next's `readBsp` reads BSP2 since 2026-11-01 (detected by the "BSP2" header, the six wider lumps), so
  `measure`, `city-measures` and `reachOf` read Xash builds directly; the generator's v30 preview path is not needed.
- `carvePlan` (src/maps/ground.mjs), `checkPlan` (src/maps/plan.mjs, `range` option), `compileMap`
  (src/maps/compile.mjs) are the 0.x calls the generator used; smak-next also has `houses.mjs` and
  `interiors.mjs`, which a building-type layer (the missing REDESIGN section 2) would sit on.
