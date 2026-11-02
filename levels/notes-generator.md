# SMAK's present map generator and the New Byzantium generator: an inventory

Point 4 of "Data before building" (PLAN.md Phase 3): what the two generators do, stage by stage, and which code
causes each H9 complaint and measured fault. Read-only study, 2026-11-01. It builds on `notes-h9.md` (limits,
complaints, what each pass changed) and `notes-rp-city.md` (bands, New Byzantium measured) and does not repeat
them. Code is cited, not copied.

Paths: `src/...` is smak-next. `nb/...` is the delivered generator, `C:/Users/User/Downloads/TEMP/h9_tsrp_newbyzantium/`
(read, never run). Its `../lib.mjs` (SMAK 0.x, imported as `M`) is not shipped, so its SMAK calls are read against
smak-next's functions of the same name (notes-h9.md section 8 found the roleplay profile identical, and
`carvePlan`, `checkPlan`, `compileMap` present).

---

## 1. SMAK's present generator (smak-next `src/maps/`)

SMAK has **no layout generator**. It builds a map from a layout someone else gives it: a person's drawing
(`smak sketch`) or a script that lists spaces and calls the builders (example 07, New Byzantium). Everything
below the layout (carving, pieces, dressing, compiling, checking) is SMAK's.

### Stages, in order

| # | stage | in → out | code |
| --- | --- | --- | --- |
| 1 | read a drawing | SVG (paths, strokes, labels, layers) or flat-colour PNG → shapes `{ areas \| outlines \| lines, keys, colour }` | `src/maps/sketch.mjs:335` `readSvgSketch`, `:543` `readPngSketch` |
| 2 | shapes → spaces | shapes + legend → `{ spaces, starts, lights, pieces, skipped }`; a space is `{ outline(s), floor, ceiling, texture, slope?, horizon?, rough?, cliff?, relief? }` | `sketch.mjs:612` `sketchSpaces` (keys merged colour < name < label `:619`) |
| 3 | carve | spaces + rock thickness + fallback texture → convex upright prisms of rock | `src/maps/ground.mjs:461` `carvePlan` (box-only version: `src/maps/source.mjs:1093` `carve`) |
| 4 | rock dressing | rough walls, cliffs, relief ground → `func_detail` brushes | `sketch.mjs:850-868` (`rockWall`, `cliffWall`, `reliefOf`) |
| 5 | pieces | spiral stairs, bridges from the sketch → world brushes | `sketch.mjs:869-875`; builders in `src/maps/pieces.mjs` (`spiralStairs :61`, `bridge :218`, `chandelier :174`, `railing`, `balcony`, `brokenWall`) and `source.mjs` (`stairs :819`, `wedge :561`, `arch`, `bend`, `terrain`) |
| 6 | entities | starts (or one in the first space), one lamp per `light=` space, a sun if any space is open to the sky | `sketch.mjs:876-886` |
| 7 | hand edits kept | the person's J.A.C.K. additions merged back on a re-run | `sketch.mjs:888` `mergeMaps`, `pieces.mjs:494` `additions` |
| 8 | optional dressing (script use) | houses, interiors, scatter, sound | `src/maps/houses.mjs:80` `house`, `src/maps/interiors.mjs:164` `dressRoom`, `scatter.mjs:115`, `ambience.mjs:34` |
| 9 | write | `{ worldspawn, brushes, entities }` → Valve 220 `.map` | `source.mjs:1473` `writeMap` |
| 10 | source check | `.map` → errors / warnings / leak hint (no compile) | `src/maps/plan.mjs:534` `checkPlan` |
| 11 | compile | `.map` → `.bsp` + per-tool log, limits parsed | `src/maps/compile.mjs:420` `compileMap`, `:259` `limitsOf` |
| 12 | compiled checks (by command) | v30 `.bsp` → reports | `check.mjs:530` `checkBsp`, `reach.mjs:1002` `reachOf` (map-reach), `light.mjs:269` `lightReport`, `character.mjs:88` `characterOf`, `encounters.mjs:145` `spawnsOf`, `measure.mjs:187` `measure`, `wiring.mjs:83` `wiringOf` |
| 13 | level measures (survey) | corpus `.bsp` → bands; descriptions → checks with no geometry | `levels/lib/goldsrc-level-measures.mjs`, `city-measures.mjs`, `description-checks.mjs`, `city-checks.mjs:903` |

CLI wiring of 1-9: `bin/smak.mjs:3428` `sketchOf`, `:3454` `sketchCommand`.

### What decides what

| | present SMAK |
| --- | --- |
| layout | the drawing or the script; SMAK places nothing by itself |
| room shapes | the outlines as drawn: any convex or concave outline, with holes (`ground.mjs:144` `planSpace`), `path`/`curve`/`circle` helpers (`ground.mjs:731-787`); height = `[floor, ceiling]` per space |
| texturing | one `{ floor, ceiling, wall }` per space (or the carve's fallback); each rock face wears the texture of the space seen most along it (`ground.mjs:553-569`), top = space over, bottom = space under (`:603-605`); walls aligned from the space's least corner (`:495-509`) |
| lighting | `light=` puts one lamp at the space's middle, `LAMP_UNDER` below its ceiling (`sketch.mjs:735-742`); a sun when a space is open to the sky (`:880-886`); `dressRoom` adds torches |
| entities | starts, lights, sun only (`sketch.mjs:876-886`); dressing helpers return point entities |
| doors | **none**: MAPS-SKETCH.md, "Not straight stairs, doors, props or the map's other entities"; a doorway is just two spaces that touch |
| checks | `checkPlan` before compile (brush soundness, range ±4096 by default, texture names in the wads, entities in brushes, loose detail, a flood leak hint); compile log; then by command `map-reach`, `map-light`, `map-character`, `map-spawns`, `measure` on the compiled map |

### What it assumes

- **GoldSrc brush maps**: Valve 220 `.map`, convex brushes, hlcsg/hlbsp/hlvis/hlrad (`compile.mjs:37`); compiled
  maps read as BSP v30 and, since 2026-11-01, BSP2 (`readBsp`).
- **Carving from one block of rock**: every space is an upright prism (vertical walls, flat floor and ceiling, a
  `slope` ramp the only exception); what is not a space is rock, so it cannot leak (`ground.mjs:447-460`).
- **Storeys are z-bands, not a limit**: the carve slices the whole block at every distinct floor and ceiling height
  of every space (`ground.mjs:472-479`, loop `:539-600`) and merges a piece upward only when its outline and
  textures repeat (`:582-597`). Spaces stacked with ceiling = floor join with no rock between
  (`ground.mjs:449-450`). Multi-storey works; the brush count grows with the number of distinct heights × the
  plan's complexity, and one carve covers the whole map.
- **Any angle in plan**, points snapped to whole units (`onWholePoints`, `ground.mjs:609-622`). No fixed grid.
- **One texture per role per space**; no palette concept; no building, room program, door, name, switch, lift.
- **One map, one compile**; extent checked at ±4096 unless `range` is given (`plan.mjs:26`).
- **Fantasy content** in the dressing helpers (MSC's `HOUSE_SET`, `INTERIOR_SETS`, `TORCH`): GoldSrc/MSC wads.

### s&box side (for the dungeon)

No generator. `src/sbox/map.mjs:314` `portMapToSbox` turns a **compiled GoldSrc map** into an s&box scene (faces
as meshes, materials, sky, spawns, lights); `src/sbox/mapcheck.mjs` holds the port to the GoldSrc map in the s&box
editor (collision spots, floors, light). `levels/tools/kit-measure.mjs` measures a modular kit's pieces and grid
(the local Synty kit: 2.5 m module, `levels/kits/synty-knights/notes.md`); nothing places kit pieces.
`levels/lib/nav.mjs` reads Valve `.nav` files for measures only.

---

## 2. The New Byzantium generator (`nb/`, SMAK 0.x)

5,683 lines. `nb/city.mjs` drives; `nb/plan.mjs` (1,763) lays out everything; `nb/kit.mjs` (646) holds the carve
wrappers and pieces; `nb/nexus.mjs` the Nexus and the well's air; `nb/geo.mjs` frames and octagons.

### Stages, in order

| # | stage | in → out | code |
| --- | --- | --- | --- |
| 1 | plan | seed `0xb12a` → `Bag { spaces, world, detail, entities }`, `streets`, `publicSpaces` | `nb/plan.mjs:258` `buildCity` |
| 1a | the well | octagon ±1664 → open-air spaces round the Nexus | `plan.mjs:317-323`, `nexus.mjs` `wellSpaces` |
| 1b | street lattice | fixed lines `LINES` + `MINOR`, per-line `OFFSET`, per-district drop/alley chance, widths by class → street rects | `plan.mjs:326-386`; `HALF` `:329`, `OFFSET` `:331-335`, widths `:374` |
| 1c | MSR network | 4 cardinal + 4 corner precincts, sewer and ward checkpoints, the ward ring/wings/outer ring | `plan.mjs:398-615` |
| 1d | Ascents | 4 stair halls, sewer → Mese, ten flights | `plan.mjs:649-687` |
| 1e | upper city | Mese arcade, Mese checkpoints, Basilica, Exchange, Ministry, Palace Row | `plan.mjs:690-768` |
| 1f | lower landmarks, courts | Stacks well, Rookery, Bazaar, Foundry, garden, 6 courtyards | `plan.mjs:771-817` |
| 1g | undercity | sewer mains, ring sewer, manholes, cistern, well stairwells | `plan.mjs:820-879` |
| 1h | canals | quarter, quays, gate, barges, pump house, shacks | `plan.mjs:882-926` |
| 1i | Descents | 4 corner stair halls, first free spot | `plan.mjs:932-988` |
| 1j | roads | carriageway space 8 lower in avenue/ring/outer | `plan.mjs:993-1001` |
| 1k | hidden places | Mese studies, sewer dens, 12 block passages (4 secret) | `plan.mjs:1005-1122` |
| 1l | gallery ramps | a ramp tower per gallery street side, first free of 8 tries | `plan.mjs:1125-1154` |
| 1m | **frontages** | every street side → units of stacked rooms with door, lamp, front, furniture | `plan.mjs:1157-1165`, `frontage` `:1176-1380` |
| 1n | street dressing | gallery walkways, street lamps, litter, fog, stalls, machines, shacks, sounds wanted | `plan.mjs:1383-1504` |
| 1o | the Nexus | HQ program, jail, tunnels | `plan.mjs:1507`, `nexus.mjs` `buildNexus` |
| 1p | sound keeper | ranked wishes → ≤ 240 kept, 600/320/1800 spacing | `plan.mjs:1536-1550` |
| 1q | spawns | street middles, quays, cistern, Bazaar → ≤ 104 + fixed | `plan.mjs:1556-1598` |
| 1r | kinds, public ways | names → kinds (regexes), public spaces and their touch graph | `plan.mjs:1604-1640`, `kindOf` `:1647` |
| 2 | carve | spaces → rock, in 3,072 tiles, wall 64, undercity and city carved apart at z −16 | `city.mjs:60-73`, `kit.mjs:126` `carveTiled` (calls `M.carvePlan` per tile `:144`, `clipToRect` `:109`) |
| 3 | re-wear | rock tops/bottoms re-textured from the space over/under; split where two textures meet | `city.mjs:75`, `kit.mjs:167` `wearFromSpaces` |
| 4 | texture audit | every texture in an embedded wad | `city.mjs:84-94` |
| 5 | write | `.map`, `.plan.json` (spaces with kinds, public ways), `.res` | `city.mjs:97-122` |
| 6 | roam waypoints | `.map` + plan → RCBot `.rcw` and roam spots, via SMAK `waypointsOf` on the **source**, doors shut | `city.mjs:128`, `nb/roamwaypoints.mjs:325` |
| 7 | source check | `M.checkPlan(map, { range: 32768 })`, printed, not blocking | `city.mjs:129-135` |
| 8 | compile | `-engine xash`, full vis, `hlrad -chop 128 -texchop 64` (or `--draft`), `--preview` ±2600 as v30 | `city.mjs:157-186` |
| 9 | after the build, by hand | `checks.mjs` (map + bsp + log), `walk.mjs` (plan graph), `score.mjs` (map-character vs the cities via `bsp2.mjs`) | see Checks |

### What decides what

| | New Byzantium |
| --- | --- |
| layout | a fixed lattice of axis-aligned rects (`plan.mjs:38`, `:326-386`) and fixed four-fold pieces placed per frame `n e s w` (`geo.mjs` `FRAMES`); everything else is **first come, first served** in an `Occupancy` hash (`kit.mjs:39-77`): each stage takes what is still free (`spaceIfFree` `plan.mjs:282`), frontages last, so units fill whatever the earlier stages left |
| districts | 3×3 squares round the well, by position only (`plan.mjs:251` `districtAt`); a district is `STYLES[k]` (`:237-249`): street textures, ground/upper room mixes, light colour, alley/drop/gallery/mess/door chances, widths, depths |
| room shapes | boxes only (`kit.mjs:34` `boxSpace`): width from `style.widths` (×1.5 shop/bar), depth the deepest free of `style.depths`, height `ROOM_H` 160 (`kit.mjs:9`), storey 176 (`kit.mjs:8`) |
| buildings | none: a "unit" is a column of rooms one per storey, each its own door on the street or gallery (`plan.mjs:1246-1263`); 20 % get one back room (`:1242`) |
| texturing | per room `roomTex` = district list for that kind, else the city-wide `ROOM_TEX` (`plan.mjs:154`, `:41-88`, `:95-152`); streets per district, avenues/ring overridden city-wide (`:382-384`); carve fallback grey (`city.mjs:65`); trims `TRIM`/`FASCIA` (`:156-157`) |
| lighting | one lamp per room at its middle, 24 under the ceiling, colour/brightness by kind (`ROOM_LIGHT` `plan.mjs:166-171`, `:1304`); a lamp over every ground door (`:1268`); street lamps every 448 down the middle (`:1427-1441`); neon by signs (`:1350`); MSR purple everywhere MSR |
| entities | doors (`kit.mjs:288`), secret doors (`:313`), glass, plates, signs (`:593`), ladders (`:566`), grates, props and litter (`ts_model`), fog sprites, sounds, spawns |
| doors | one per room, picture by kind (`DOOR_TEX` `plan.mjs:158`), 56×112 (shop/bar 96, MSR 112), 8 thick; named only for the MSR, cells, desks, gates, secrets (`kit.mjs:305`) |

### What it added on top of SMAK 0.x

Used from SMAK: `box`, `solid`, `prism`, `wedge`, `cylinder`, `cone`, `fitted`, `stairs`, `spiralStairs`,
`chandelier`, `bridge`, `turned`, `carvePlan`, `writeMap`/`readMap`, `checkPlan`, `compileMap`, `wadTextureNames`,
`waypointsOf`/RCW, `characterOf`, `drawMap`/`drawSource`/`planOfSource`, sky helpers. **Not used**: `sketchMap`,
`house`, `dressRoom`, `scatter`, `ambience`, `reachOf`, `measure`, `lightReport`.

Added: the procedural plan itself (all of `plan.mjs`, `nexus.mjs`, `geo.mjs`); the `Occupancy` placer; the tiled,
seam-split carve (`carveTiled`, `clipBrush`, `clipToRect`); `wearFromSpaces` (patches the carve's lost tags where
spaces overlap, `kit.mjs:158-166`); **the floor slab** (rooms run up to the next storey so the carve leaves no rock,
and a `func_detail` slab 16 thick wears floor on top and ceiling under, `plan.mjs:1258`, `:1305-1310`,
`:1368-1377`, `city.mjs:80`); pieces (doors with fitted pictures, secret doors, glass, signs, furniture boxes by
kind, litter models clear of doors, fog, ladders, breakable grates, ramp and spiral cores, columns, portcullis +
button); the sound keeper; the spawn placer; `plan.json` with kinds and public ways; roam waypoints; `checks.mjs`,
`walk.mjs`, `score.mjs`; the BSP2 reader `bsp2.mjs`; `bigtest.mjs`; the custom sky; a v30 preview build.

### Checks, and when they run

| when | check | what it holds | code |
| --- | --- | --- | --- |
| end of each build, printed only | `checkPlan` | brush soundness, ±32,768, textures named, leak hint | `city.mjs:131` |
| end of each build | texture audit | every face's texture in an embedded wad | `city.mjs:84-94` |
| by hand after | floors | every walkable top wears its space's floor, no carve grey | `checks.mjs:134` |
| | strays | no small loose brush on a public floor | `:209` |
| | doors | leaf size, picture fitted once, only cells see-through, lit on both faces (compiled lightmap) | `:235`, light `:305-316` |
| | sounds | in a built space, reach fits it, music only beside a source | `:323` |
| | signs | not facing a wall | `:361` |
| | starts | ≥ 72, public, spread, headroom, clear of doors | `:385` |
| | limits | brushes < 32,767, models + precached < 2,048, edicts < 4,098 − 464, loops ≤ 240, lightdata from the log | `:428-456` |
| | walk | reach from the avenues, hidden places, MSR network from `hq_ops`, public/MSR openings, checkpoints per district | `walk.mjs` |
| | score | `characterOf` vs the three cities' bands | `score.mjs:19-25` |

**The walk test is not a geometric walk.** `walk.mjs` reads only `plan.json`: two spaces join when their outlines
touch for 32 units with 72 of shared height, doors count as open (`walk.mjs:1-10`). It cannot see a step too high,
an unclimbable stair, a blocked doorway or a slab in the way. (notes-h9.md 4.3 says "SMAK `reachOf`"; the code
does not call it.) The only walk over geometry is the roam-waypoint step (SMAK `waypointsOf` on the `.map`, doors
shut, public spaces only, `roamwaypoints.mjs:18-33`). Nothing checks leaves, portals, PHS, the reTS 2,048 send
cap, room sizes, variety, names or sight lines; nothing gates a deploy.

---

## 3. Each complaint and measured fault, traced to its cause

Kind: **P** parameter choice (a number or list in the code), **M** missing stage (nothing in the pipeline does it),
**S** structural (the way the pipeline is built prevents it).

| fault (source) | cause in code | kind |
| --- | --- | --- |
| one room template on every front; "carbon copy storefronts"; 640 single-room buildings | `frontage` (`plan.mjs:1176-1380`) is the only builder of enterable places: one box room per storey, one door on the street, one lamp, one front recipe (`:1275-1299`), one furnish recipe per kind (`kit.mjs:344-428`); a back room 20 % of the time (`plan.mjs:1242`) and never more; each storey is its own property with its own door (`:1259-1263`) | S |
| 76 % buildings / 81 % rooms repeat a footprint | widths 2-3 values per district (`plan.mjs:238-248`) ×1.5 for shop/bar (`:1196`), depths 2-3 values, snapped to 16; every storey of a unit the same footprint (`:1259`); height fixed `ROOM_H` 160 (`kit.mjs:9`) | P + S |
| 97 % of brush models repeat | every door leaf 56/96/112 × 112 × 8 (`kit.mjs:13`, `plan.mjs:164`, `kit.mjs:288-306`), one picture per kind (`plan.mjs:158`); glass panes and blade signs from the same few sizes | P |
| "tiny areas": median room 192 × 256 u (24 m²) | `style.widths` 128-320 and `depths` 160-512 (`plan.mjs:238-248`); precinct cells 192 × 80 (`:519`); room height 160 | P |
| 85-95 % of fronts enterable; "WAY too many enterable"; 750 rooms against ~100 properties per source city | blank-front chance `BLANK` 0.05-0.15 off the sewers (`plan.mjs:222`, used `:1230`); upper storeys rooms 80 % of the time (`:1250`); the count is street length ÷ unit width (`while (u < end - 128)` `:1192`), no property budget | P + M |
| "more homes than stores" | ground mixes shop/bar-heavy at the street (Bazaar 7 of 10, Mese 5 of 8, `plan.mjs:240`, `:246`). By count the final build is already home-heavy (slum 199, poor 113, flat 82, lux 44 against shop 64, bar 56: `out/compile-b1.log`), so the complaint is what fronts the streets, not the total | P |
| "applied whatever, anywhere": textures from mixed city-wide lists | `roomTex` falls back to `ROOM_TEX` (mixed wads) for any kind a district does not name (`plan.mjs:154`); MSR rooms take one city-wide pick (`:399`); avenues and ring one city-wide set (`:382-384`); carve grey where tags are lost (`city.mjs:65`, patched by `wearFromSpaces`); gallery walkways, ramp cores, stair cores, lamp fittings, columns fixed city-wide (`:1418`, `:1145`, `kit.mjs:619`, `plan.mjs:1440`, `:392`); trim fallback `d_drkmtl_mpanel` (`:1277`). No closed palette exists | M |
| 58,000 u of identical police corridor; "hallways that go on forever" | the ward level: ring 192 wide round the well, wings, outer ring 128 × 6,528 a side, all one texture set (`wardTex` `plan.mjs:398`, geometry `:594-615`), lamps every 448-768 (`:612-614`); tunnels 128 × 3,072 (`nexus.mjs:388`); only 8 spurs off it (`:544`, `:589`) | P + M (no rule breaking a run with posts) |
| checkpoints placed by geometry | stamped once per frame or corner in four-fold loops: Mese (`plan.mjs:453`, `:706`), cardinal precincts + sewer posts (`:498-546`), corner precincts (`:549-592`), ward posts off the Ascents (`:673-686`); no input says where policing is needed | S |
| rooms darker than streets (36 vs 55) | one lamp per room whatever its size (`plan.mjs:1304`, back rooms × 0.8 `:1329`); `ROOM_LIGHT` 70-85 for slum, flat_poor, storage, cell (`:166-171`), which are 375 of the 750 rooms; streets get 190-240 lamps every 448 (`:1435`), door lamps (`:1268`), neon (`:1350`). Coarse bounce (`-chop 128`, `city.mjs:167`) may add to it in small rooms (not measured) | P |
| only 102 of 841 doors named | frontage doors get no name (`doorway(..., { tex, up, mesh })`, `plan.mjs:1263`); `door()` sets `targetname` only when given (`kit.mjs:305`). The 102 are cells 48, checkpoints 20, precincts 16, gates 8, HQ 9, outlands 1 (counted in `out/*.bsp`) | M |
| 8 switches | the only `func_button` is the portcullis button (`plan.mjs:434`), called for 4 Mese and 4 sewer gates (`:485`, `:537`); no lamp, TV, radio, alarm wiring; no named lights | M |
| no lifts, no teleports | no `func_plat`/`func_train`/lift door/`trigger_teleport` anywhere in `nb/` except `bigtest.mjs:52`; vertical links are stairs, ramps, ladders only | M |
| no hidden ways (measured 0) | **stale BSP**: `out/h9_tsrp_newbyzantium.bsp` (14:40) holds no `secret_*` door; the newer `.map` (14:46) holds 20 (`plan.mjs:1029`, `:1052`, `:1112-1113`, `:1322`). The source makes them; the measured build predates them | — (measure the latest build) |
| connector reach p90 94 m; "clear ways up and down" | public connectors are fixed by frame: 4 Ascents by the avenues (`plan.mjs:649`), 4 Descents at the ring corners (`:932`), 2 well stairs (`:865`), manholes on the avenues only (`:831`); gallery ramps only on gallery streets ≥ 640 long (`:1125-1129`); spiral cores are MSR-only. No rule of a farthest walk to a connector | M |
| sight lines twice the cities' (58 m) | straight lattice lines run the city's width (`plan.mjs:38`, `:344-386`); streets are rectangles only (`addStreet` `:304`); no bends, no jogs except the hidden passages | S |
| "no roads for cars" | pass 2 only lowers a carriageway space into avenue/ring/outer (`plan.mjs:993-1001`): no parking, turns, turning radius | M |
| Nexus "monument dome", "hollow shell" | fixed in pass 2 by `nexus.mjs` (HQ program); the hall's octagon still mostly dome air (notes-h9.md section 5) | P |
| walls on the grid, floors flat | every NB space a box (`kit.mjs:34`), except the well's octagon and the Basilica's dome; carvePlan could cut any outline | P |

### Top root causes

1. **One unit type, no building stage** (`nb/plan.mjs:1176-1380`): repetition, single rooms, storefront copies.
2. **Quantity from street length, not from a budget** (`plan.mjs:1192`, `BLANK :222`, `:1250`): far too many
   enterable rooms, all small.
3. **No closed palette** (`plan.mjs:154` fallback to `ROOM_TEX :41`, city-wide overrides `:382-384`, fittings
   with fixed textures).
4. **Fixed four-fold placement of networks** (ward `:594-615`, checkpoints `:453`/`:498`/`:549`/`:673`,
   connectors `:649`/`:932`): endless MSR corridor, checkpoints and ways up where the frame put them, not where
   needed.
5. **No wiring/naming stage** (`plan.mjs:1263`, only button `:434`, no lift piece): unnamed doors, 8 switches,
   no lifts.

---

## 4. Worth keeping (verified)

| keep | evidence | caveat |
| --- | --- | --- |
| carving from rock (`carvePlan`) | sealed by construction (`ground.mjs:447-460`); no compile log in `nb/out/` reports a leak | rock is the bulk of the brushes: 16,037 of 24,910 (`compile-b1.log`), because the carve slices at every distinct height (`ground.mjs:472-479`); one carve per map does not scale (NB needed `carveTiled`, which also cuts brushes at every tile edge, `kit.mjs:145-152`) |
| one shared slab per floor | rooms run ceiling = next floor so no rock is left, one `func_detail` slab worn on both faces (`plan.mjs:1305-1310`, `:1368-1377`); detail does not cut vis leaves | only the frontage stacks use it; a slab is still one brush per room per storey |
| the layer stack and the open central shaft | `Z` table (`plan.mjs:28-35`), the well open to the sky (`:317-323`), districts round it | the layers are numbers in one table; nothing checks headroom or links between them |
| the look | `STYLES`, `DISTRICT_ROOMS`, the regal Mese palette, night lighting by local colour | the palettes are open lists with city-wide fallbacks (section 3) |
| checks | `checks.mjs` floors, strays, doors lit, sounds, signs, starts, limits | run by hand, after; limits use 4,098 edicts, not reTS's 2,048; no leaf/PHS budget |
| walk test | MSR network, hidden places, public/MSR openings, checkpoints per district (`walk.mjs`) | a graph of touching boxes, not a walk; keep the questions, walk the geometry (`reachOf`, or the roam step's `waypointsOf`) |
| add: `plan.json` as the bridge | kinds + public ways feed spawns, roam waypoints, the walk | — |
| add: `wearFromSpaces` | removes carve grey where spaces overlap (`kit.mjs:158-166`) | a patch for a carve gap; belongs in the carve |
| add: sound keeper, spawn placer | rank, spacing, 240 cap (`plan.mjs:1536-1550`); ≥ 72 spawns clear of doors (`:1556-1598`) | — |
| add: `bigtest` | extent, movers, sounds, sprites proven before the city | — |
| add: the pieces | fitted door pictures, secret doors in wall texture, portcullis + button, signs cut to shape, litter clear of doors | — |
| drop: the `Occupancy` first-come placer as the layout method | order of stages decides what exists (frontages get the leftovers) | a spatial hash is still useful as an index |

---

## 5. Gaps against the description formats

### CITY.md (`smak-city-description/1`)

| field / check | present code (SMAK + NB) | needs |
| --- | --- | --- |
| `grid` cell 128, storey 192 | NB storey 176, room 160 (`kit.mjs:8-9`) | a parameter |
| `tiles`, portals, per-tile budget | `carveTiled` tiles the carve only; one compile, no portals, no per-tile limits | new: tile build with seams at portals, per-tile compile/budget |
| `layers` (z, ceiling, wealth, bounds) | NB `Z` table; carvePlan stacks bands | small: layers from the description; wealth/decay rules new |
| `districts` with closed `palette` | `STYLES`/`DISTRICT_ROOMS` open lists | new: palette resolver; every surface from district, shared or faction set |
| `streets` nodes + segments, winding, corner radius, sidewalks, lanes, clearance | NB lattice rects; SMAK `path`/`curve`/`circle` + `carvePlan` can cut any outline | new: street graph → outlines (the cutting exists) |
| `blocks`, lots, facades | none (blank fronts are window panes, `plan.mjs:1230`) | new |
| `buildings` (type, variant, footprint, storeys, units, rooms, sign, palette) | none; SMAK `house` is an MSC exterior, `dressRoom` fantasy interiors | new: building programs → floor plans (lobby, stairwell, units, rooms) |
| `roomSizes` | widths/depths lists | new (table-driven rooms) |
| `connectors`: stair, grand-stair, ramp, ladder-shaft, secret | pieces exist (`stairs`, NB `flights`, `rampCore`, `spiralCore`, `shaftLadder`) | placement from the description new |
| connectors: lift | none (bigtest's train only) | new piece + placement |
| `checkpoints` with program and reason | the post/cell/portcullis template exists | placement by description new |
| `secrets` doors, passages | `secretDoor`, passages exist | placement by description new |
| `housing.doorNaming`, homes per class | none (`plan.mjs:1263`) | new, small (a name per door) |
| `required` places with programs | Nexus program hand-coded (`nexus.mjs`) | program → layout new |
| `wiring` switches, switchable lights | none | new |
| `spawns` | placer exists (`plan.mjs:1556`) | reuse |
| `vehicle` roads | carriageway space only | turning room, ramps by grade new |
| engine budget estimate | `city-checks.mjs:70` `ESTIMATE` on the description; NB reads the compile log after | as-built counts per tile new |
| checks that run on the description | `levels/lib/city-checks.mjs` (all of CITY.md's table) | — (done) |
| checks that the built map matches it | none; `city-measures.mjs` measures a compiled v30 or BSP2 map | new: built-vs-described check |

### Dungeon (`levels/specs/rpg-dungeon-01.json`, s&box modular kit)

| | present | needs |
| --- | --- | --- |
| spaces by size class on a 2.5 m grid, storeys | description + checks (`levels/lib/description.mjs`, `description-checks.mjs`) | layout: graph → positions on the grid (no code does this) |
| links (door, open, stair, drop, gate + key, secret) | checked on the graph only | geometry for each link type in kit pieces |
| kit pieces placed in an s&box scene | kit measured (`kit-measure.mjs`, `synty-knights/kit.json`); nothing places pieces; only GoldSrc → s&box ports (`src/sbox/map.mjs:314`) | new: kit placer / editor driver |
| navmesh reach, sightlines, cover | GoldSrc `reachOf`, `sightTest` (`encounters.mjs:390`) on compiled BSP; `mapcheck.mjs` collision probes in the s&box editor; `nav.mjs` reads `.nav` for measures | new: s&box navmesh query and as-built measures |
| encounters, rewards, keys | in the description and its checks | entity placement new |

---

## Implications

- The two targets share the description → plan → checks half (descriptions and their checks exist for both);
  they part at the build: brushes carved in GoldSrc, kit pieces in s&box. The layout stage is new for both.
- Nothing in the current code makes buildings, blocks, palettes, names, wiring or lifts: these are new stages,
  not fixes to `frontage`.
- `carvePlan`, the floor slab, the pieces and the sound/spawn placers are reusable as they are; the carve's
  brush cost (bands at every height, tile-edge cuts) is the number to watch against 25,000.
- The NB build checks itself after the fact and only partly; every rule in CITY.md has a description-side check,
  so the gap is checking the built map against the description (and walking geometry, not the plan graph).
- Measure the latest build before quoting it: the measured BSP predates the secret doors in the source.
