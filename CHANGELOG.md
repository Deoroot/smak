# What changed, version by version

The newest first. A version that changes what a model's file looks like, or that a model made before needs
mending for, says so under **Mind**.

## 0.39.0, the motion judge

**The viewer's travel** (2026-11-12, for the civilian's run): `smak view`'s "travel" box moves a floor under a walk or a
run at a speed (the A model's own unless told) and plays each model's frames by the distance over its own travel, as
Half-Life's player renderer does (StudioProcessGait): two runs with different travels go side by side on one floor, and a
planted foot that drifts on the lines is one that slides in the game. Each sequence's `movement` is sent to the page.

**The viewer's game's eye** (2026-11-12, so that a view model's animation is tried in seconds, not by a copy into the game):
`smak view` has a "game's eye" box: the camera at the view model's origin looking along +x, the fov given on a 4:3 base and
widened Hor+ to the screen's shape, letterboxed, the near plane at 4: the same picture as `render --view first --screen`
(the katana's idle in both overlap 98%, and that picture lies on H9's own screenshot at fov 80). ‹ › and the arrow keys step a
frame, space plays; `?eye=1&fov=80&screen=16:9` opens it so.
**The edge and the fan** (the remade katana played in the game: its second slash hit with the flat of the blade, and its
forearms fanned across the lower screen; no check had said either):

- **`edge`**, a hard fault of `judgeMotion` (`smak motion --arms fore:hand:held`): the held bone's mesh gives the blade's
  axes (its length, edge to back, the flat's normal; nothing with a section near round is judged, `BLADE_THIN` 0.75); in an
  animation named as a blow, over the cut (the steps where the tip goes half its fastest or more) the tip's motion across
  the blade against the edge, weighed by speed: over 35 degrees (`EDGE_DEGREES`) is a FAULT with the frames and what to
  do (roll the hand and blade about its length). The Specialists' own katana cuts at 3; the remade one's slash2 at 54 and
  slash3 at 41 fail, its slash1 (10) passes. Else a fact.
- **The sweep** (`screenOf`'s `sweep`): the share of the screen the forearms' own mesh covers in any frame of the hand's
  fastest stretch (the onion's union), said by `smak motion` as a fact (and in `--json`), with the screen's fov from
  `--eye` when `--fov` is not given. A fact and no WARN: at fov 80 on 16:9 the remade katana's slashes sweep 5.6 to 9.1%
  against the original's 1.5% and Half-Life's crowbar's 2.7%, but Half-Life's grenade throws sweep 10.8 to 16.5%.
- Broken case: a blade on the fixture's right hand (`test/fixture-arms.mjs` "blade", "edge") turned a quarter about its
  length.

**The game's eye** (ARCHITECTURE.md 8.5, after the katana's first R2: its blows passed every check and the owner saw at once
that the forearms were aimed at the camera):

- **`screen`** on `render`, `strip`, `gif` (`--screen 16:9|4:3|16:10|w:h` with `--view first`): the picture is the player's
  screen, the fov given on a 4:3 base widened Hor+ as Xash's `r_adjust_fov 1` (90 is 106.26 across 16:9), the near plane at
  4 (`gameEye`, `aspectOf`). Without it every picture is as before.
- **`strip --every`**: every frame, labelled with its frame and its time; **`--beside other.mdl [--beside-seq n]`**: the
  other model's same frames under each row (strip) or under the picture (gif), labelled by file; **`--onion [--bones]
  [--mark]`** (`onion`): one picture of the bones' outlines at every frame, blue to red, over the first drawn solid.
- **The GIF plays at the sequence's rate**: a GIF counts in hundredths, so 30 a second is 3, 4, 3 hundredths, not 3 (33);
  each frame's label has its time.
- **`screenOf`, `judgeScreen`, `SCREEN_LIMITS`** (`check/screen.mjs`; `render`'s `depth` and `inside`): per frame, the share
  of the screen a view model's mesh covers, and the inside of a mesh seen (through its open end, or where the near plane
  cuts it). `smak motion` says them as `WARN  screen:` lines of a view model (its PASS or FAIL unchanged), in `--json`,
  and on `--draw` (the cover a white line, the cuts marked). The limits are the next round step over Half-Life's 16 view
  models (133 animations, 5624 frames): cover 35% (v_rpg's reload 31.6%), an open end 0.3% (v_satchel's draw 0.29%), the
  near plane 1.2% (v_grenade's throw 1.17%). The remade katana's slash3 is warned (the right forearm's open end, 0.7% of
  the screen, frames 7 to 9); the game's own is not. Its cover (16.7% at most) is under the game's own: what is wrong with
  its blows shows in the onion skin and beside the original, not in that number.
- Broken cases (`test/broken/screen.mjs`): a forearm made from nothing (`test/fixture-viewmodel.mjs`) spoiled three ways.

ARCHITECTURE.md 8.4 (the owner, 2026-11-11): a generic judge of any animation of any model first, the classes plugging in
as references.

- **The body behind a view model's arms** (ARCHITECTURE.md 8.5, after the katana's first R2: forearms aimed at the camera
  that every check passed). `make/arm.mjs`: `VIEW_BODY` (Half-Life's shoulder from the eye, -3.47, +-6.72, -4.55, and its
  forearm over upper arm, 1.0, measured on its 16 view models; Vermintide 2's 0.94 and The Specialists' 0.909 beside it),
  `shoulderFor`, the two-bone IK `solveArm`, and `placeForearm`, which puts a rig's forearm with no upper arm at the solved
  elbow with the hand's matrix kept. `motionOf(mdl, { arms, eye })` and `smak motion --arms fore:hand[:held],... --eye
  90:16/9 --json` (a `v_` model's Biped arms unless told): in the frames a forearm is on the screen, an `elbow` fault for a
  root no upper arm reaches (0.3 of it off: Half-Life's are 0.00 off, their shoulders move 0.26 at most) or 0.3 of it over
  the shoulder (Half-Life's 0.21 at most), an `aim` fault for a forearm under 30 degrees off the eye's line (Half-Life's
  seen forearms 35.1 at the least); the two arms' bones (a box about each one's bulk where its skin is open) through each
  other as `overlap`, though they hang from one root; the hand's arc, spacing, anticipation and the tip's lag as facts.
  Three broken cases on a view model made from nothing (`test/fixture-arms.mjs`). `animate.qofMatrix` exported.

- **`smak motion <mdl> [--seq name|n|all] [--kind figure|melee|firearm|none] [--draw out.png]`** (`check/motion.mjs`:
  `motionOf`, `motionSummary`, `judgeMotion`, `motionPicture`, `motionKindOf`, `MOTION_LIMITS`, `MOTION_BANDS`,
  `MOTION_SAID`): one animation measured bone by bone from its poses (each bone's own turn a frame and its axis, the still
  frames, each bone's run, the named joints' flex and turn by Biped's names, the loop's seam, the planted feet against the
  travel, parts through each other over the bones' closed pieces, the events against the motion) and judged for hard
  faults, each naming the frame, the bone and what to do: a pop, jitter, a flip, an elbow or knee hyperextended, a wrist or
  head past its range, lockstep, a stall, a tail still moving, a loop that does not close, foot slide, parts through each
  other. FAIL on one; `--draw` is each bone's turn over the frames with the faults marked in red, the strip under it. The
  thresholds were set where Half-Life's own figures (59 walks, runs and idles of 10 models) and view models pass but for
  what they really ship (three one-frame slips, the scientist's scared tremble, the chained reload's and the miss's tails,
  the hgrunt's hand 128 from its rest), each named in `MOTION_LIMITS`' comments.
- **Bands as facts**: `MOTION_BANDS.figure`, measured from those 59 animations (peak, speed, moving, lockstep, spike, jerk;
  the corpus in the comment, as `FORM_BANDS`), places a measure "inside the middle half" or "over the 95th in 100" of
  Half-Life's figures, never fails it (8.1: bands are a game's style); `melee` and `firearm` are empty until their pieces.
- **`check` warns of the motion**: `WARN: motion: <fault> in N animations (name frame bone, ...): what to do`, one line a
  kind of fault, never a FAIL (as `form`); the seam stays checkLoops'; the costly measures (the feet, the pieces) are
  `smak motion`'s. `check(src, engine, { motion: false })` and `--motion off` leave it out. `SEAM_UNITS` and `SEAM_DEGREES`
  live in `MOTION_LIMITS` now, with their provenance.
- **Broken cases** (`test/broken/motion.mjs`): a biped made from nothing (`test/fixture-biped.mjs`, Biped's names, a box on
  each bone, a walk whose feet go at its travel and a swing whose joints take turns) spoiled twelve ways, one each, with the
  sentence each must give, and the clean one that must pass; `test/193-motion.mjs` the measures, the summary's maths, the
  check line and the command.
- docs: docs/MODELS.md "Motion", docs/COMMANDS.md and docs/API.md, the loop in AGENTS.md.

## 0.39.0, H9 and the generators leave

ARCHITECTURE.md, P3 and section 7 (the owner, 2026-11-10): SMAK 1.0 is the formats, the measurements and the small
pure builders of form; the map generators, which replaced the author's judgement with code, are given up, and H9's
content lives in its own project.

- **The prune** (p3-prune, toward the 60 k budget of ARCHITECTURE.md 2.3; deleted here, git history keeps it):
  - `check/maps/waypoints.mjs` (`waypointsOf`, 1,575 lines with its command) and `smak map-waypoints`: RCBot's waypoints laid from
    the walk test, a generator of a file and no measure; h9-maps lays its own (`rp/paths.mjs`). The .rcw format
    (`make/maps/rcbot.mjs`: `readRcw`, `writeRcw`, `RCW_FLAGS`) stays.
  - The dressers by rule, generators of the kind 1.0 gives up (1,852 lines): `make/maps/houses.mjs` (`house`,
    `fence`, `HOUSE_SET`), `interiors.mjs` (`dressRoom`, `pickSet`, `INTERIOR_SETS`, `chamfered`, the torches),
    `scatter.mjs` (`scatter`, `boulder`, `card`, `STREWN`), `ambience.mjs` (`ambience`, `learnDetails`,
    `detailText`), `families.mjs` (`WALL_FAMILIES`, `familyOf`), `sizes.mjs` (`SIZES`, `ruin`) and `backdrop.mjs`
    (`backdropModel`). `reliefOf`, `trail`, `cliffWall` and `brokenWall` stay.
  - The reproduction of retail maps (2,447 lines), whose project left: `make/maps/decompile.mjs` (`decompile`,
    `decompileSummary`) and `smak map-decompile`, `check/maps/fidelity.mjs` (`textureFidelity`, `lightParity`),
    `check/maps/overlay.mjs` (`overlayOf`, `fitCamera`) and `smak map-overlay`, `check/maps/places.mjs`
    (`texturePlaces`, `placeView`) and `make/maps/match.mjs` (`matchTextures`). The texture lights
    (`make/maps/texlights.mjs`) stay, with their test (now in 33-compile-light).
  - The sound and sprite generators (3,138 lines), the last two spec formats: `make/audio/spec.mjs` (`buildSoundSpec`,
    `validateSoundSpec`, `SOUND_SPEC`), `synth.mjs` (the layers, `seeded`), `spectral.mjs` (`shapedNoise`),
    `fit.mjs`, `classes.mjs` (the game's sounds by class) and `picture.mjs` (`fromPicture`, `readSoundPicture`), with
    `smak sound`; `make/sprite/spec.mjs` (`buildSpriteSpec`, `validateSpriteSpec`), `effects.mjs`, `palette.mjs`,
    `measure.mjs` (`measureSprite`, `shapeOverlap`), `colours.mjs` and `draw.mjs`, with `smak sprite`; test
    64-sound-shape and `test/broken/specs.mjs`. The formats and the measures stay: `readWav`, `writeWav`,
    `resample`, `features`, `checks`, `loudness`, `soundPicture` (`smak.audio`), and `writeSpr`, now
    `maps.writeSpr` beside `maps.readSpr`. docs/SOUNDS.md and docs/SPRITES.md say what is left.
  - What the figure judges and the directed video left behind (918 lines): `make/cull.mjs` (`cullHidden`,
    `reducePieces`, `reduceWithin`, `triangleVisibility`), `make/linkage.mjs` (`findPiston`; `posesFor` moves into
    `make/wear.mjs`, where `motionOverlaps` uses it), `make/camera.mjs` (`curveOf`, `walkPath`, `lookAhead`) and the
    shot list of `check/video.mjs` (`framesOfShot`, `frameStep`, `encoder`, `contactSheet`); tests 84-linkage and
    90-cull. `check/video.mjs` keeps `encodeTimed` (`smak play`'s film) and the GIF writer (`smak gif`).
  - What no command reached but the kit's one entry (870 lines): `check/maps/model-light.mjs` (`lightAt`,
    `lightTree`, `skyLight`, `modelShade`, `vertexLight`; the map pictures light models their own way) and test
    114-model-light; `kits/encounterkit.mjs` (`recipesOf`, encounters wired by recipe: a generator) with the Master
    Sword profile's `recipes`; the exports no file used (`apng`, `unpicture`, `decalRgba`, `turnedInPose`,
    `frameOfBox`, `frameOfGuard`, `skyFiles`, `RULE_WORDS`). And `smak info` and `smak map-info` print through
    `make/describe.mjs` and `make/maps/describe.mjs` (`describeModel`, `modelInfoLines`, `describeMap`,
    `mapInfoLines`) instead of a second copy of them in `bin/smak.mjs`: the same bytes out.
  - The last 312 lines: `openBoxesOf` (a height plan read back as a map spec's floor plan) and test 67-height-plan,
    `standingIn` (a building a map spec stood in its room, taken out), the profile's `spec` field in `mod.mjs`'s notes,
    and `cli/scripts/no-game-files.mjs`, a second check of what `smak check --publish` checks (a game's bytes and
    textures in a folder; it also read git's history, which `--publish` does not).
  - The kit is 59,814 lines of 60,000 (it was 70,926), and `layers.json`'s ratchet is lowered to it.
- **The layers are folders** (ARCHITECTURE.md 2.1, P3): every module of `src/`, `src/maps/`, `src/audio/` and
  `src/sprite/` moved by `git mv` into `core/`, `make/`, `check/` or `cli/` by the layer `layers.json` gave it
  (keeping `maps/`, `audio/` and `sprite/` beneath), and `mcp/`, `viewer/` and `scripts/` into `cli/`. `layers.json`
  is nine rules (the four folders and what stays outside them), and test 00 takes a file's layer from its folder and
  fails a rule that says otherwise. No line was added or removed: the kit is still 70,926 lines. **Mind**: the kit's
  one entry is still `src/index.mjs`, `bin/smak.mjs` is still the command, and `kits/`, `profiles/` and
  `examples/` are where they were; a script that imported a module by its old path (`src/maps/bsp.mjs`) imports it
  from its folder now (`core/maps/bsp.mjs`), and an MCP client starts `cli/mcp/server.mjs` (or `smak mcp`).
- **The generators leave**, kept on the branch `dormant/0.39-generators` (not deleted): `levels/assembly` (layout,
  massing, assemble, building, style, site, dress by rule, below, metro, ride, terrain, roofs, shells, shapes, pieces,
  themes, styles, views, fronts: 16,385 lines), `levels/tools` (build-site, assemble, layout, navwalk, views, art-kit),
  `levels/lib/art-kit.mjs`, `levels/specs`, `levels/styles`, `levels/corpus`, `levels/rules` and the generator's notes;
  and three modules nothing reaches once they left, `src/maps/texture-recipe.mjs`, `src/mapbrushes.mjs` and
  `src/maps/lift.mjs`. `recast-navigation` (the navmesh walk's) is no longer a dependency: the kit has none.
- **H9 leaves for its own project** (`h9-maps`, its own repository): the RP layer (`levels/rp`: the plugins, their
  data, the checkers, CONTRACT.md and NPCS.md, the SQL tests) as `rp/`, H9's art scripts and models (`levels/art`) as
  `art/`, the H9 studies (`notes-h9`, `-rp-city`, `-rp-rooms`, `-art-kit`, `-megastructure`) as `notes/`, and the
  role-play profile of The Specialists. **`smak check rp` is gone** from the kit: it is `node rp/check-rp.mjs` there,
  and `--mod ts-roleplay` with it (a two-line profile of `specialists({ kind: "roleplay" })` does the same).
- **Removed tests**, whose subject left: 133 (the art kit), 150-159, 169-173, 175-177, 179-182, 184-188 (the
  generators), 161, 162, 178 (the RP contract over a generated site: they stay with the generators), 163-168 (the RP
  data checks: they run in h9-maps, `node rp/test.mjs`), and the broken cases `test/broken/levels.mjs` and `rp*.mjs`.
- **Test 00 arms two gates**: a kit module no command, kit, MCP server, script, viewer, profile or example reaches is a
  FAIL, and so is a line of the kit (code, tests, guides) that names a game; the history (`docs/history/`, this file,
  ARCHITECTURE.md) may name one. Each gate has its broken case. The budget stays a NOTE: the kit is 70,527 lines of
  60,000 (90,747 before). `PLAN.md` moves to `docs/history/`.
- `profiles/specialists.mjs` and `profiles/mastersword.mjs`, profiles of public mods, stay, in the `make` layer (they
  import `fgd`, `mod` and `learn`, not the maps' index); the `game` layer is gone.
- **Mind**: a script that imported `levels/...`, `src/maps/texture-recipe.mjs`, `src/mapbrushes.mjs` or
  `src/maps/lift.mjs` finds them on `dormant/0.39-generators` only.

## 0.39.0, the battery over a built map

- **`smak map-battery <bsp>`** (`mapBattery`, `src/maps/battery.mjs`): every player-facing check over a compiled map,
  hand-made or not, read off the built file: reach, light (by `--rooms`), the front of every door and opening, each
  spawn's first look, sky gaps, coplanar faces (`--map`), PVS, budget, sweep, the compiler's log grouped (`--log`). A
  line a check, the detail in `<dir>/battery.txt`, the pictures named (the walk's plan, the PVS heat map, the faults
  seen from the eye); the last line PASS, WARN or FAIL with the counts, exit code 1 on FAIL. The rules of the door
  fronts (72 of clear air, a place to stand 36 out) and the spawn looks (128 to the first solid) are those of the
  generator's battery, which needed its plan and could not run on the hand-made plaza (KIT-FAULTS 7).
- **`reachOf` warns of a part of the floor the size of a room** (16384 square units or more, at most 320 over the
  highest floor walked) reached only by a jump or not at all; a roof over the walked floor open to the sky is not said.
  It was a fact, and a gallery reached by a jump of 107 went unsaid (KIT-FAULTS 21). **Mind**: a script that held
  `reachOf(...).warnings` empty may now have one.
- **`lightReport`**: a room box of any height (a floor is of the box whose foot is nearest under it: a box taller than
  about 200 lost a gallery's floor to the portico's box under it, and gave it area 0); with `reach`, a room whose lit
  floor none is walked is said "not walked to" (`walked: false`) (KIT-FAULTS 22).
- **`map-sweep` no longer runs out of memory** on a map in a big sky box (KIT-FAULTS 8, the plaza's variant A): the sky's
  brushes hold what touches them (the whole site had been one island in the air, then looked at again on a grid of 2),
  and past 48 million cells the floating solid is not looked for, and that is said. Variant A sweeps in 8 seconds.
- `checkPvs`, `skyGaps` and `floorSpots` take `reach` (a walk made already); `traceSolid` (skygaps.mjs) and `standsAt`
  (doorways.mjs) are exported for the battery.
- Retired: `src/maps/lift.mjs` (`liftTexture`), an orphan that no command, test or guide used; it is on `dormant/0.38`.
- Tests: `191-map-battery` (a compiled door with a pillar before it with `VHLT_DIR`); broken cases for `mapBattery` and
  the room-sized part of `reachOf`.

## 0.39.0, turns are exact

- **`turned` is exact at any angle** (`src/maps/source.mjs`): the points are kept to a billionth, so two brushes that
  shared a corner before the turn share it after, and the planes they share stay one plane to the compiler. Until now a
  turn off the quarters rounded each brush's corners to whole units on its own: the pieces of an arch ring, a dome or an
  arcade placed by a frame turned 12 degrees no longer shared their planes, and on the plaza (2026-11-10) hlbsp warned
  553 times "Ambiguous leafnode content" and dropped faces: sky through the arcades' tops, a notch in a dome. `snap: n`
  still rounds on request (each face's plane the nearest fit through grid points, a brush the rounding would break left
  exact). Measured on a test room with an arcade of 3 bays along a line at 12 degrees and a dome of 352 (sdhlt, Xash):
  the forms rounded piece by piece give hlbsp 144 to 149 ambiguous leaves (it is threaded; the count moves), exact 0.
- **`snap` on the way in**: `frame.place({ brushes, entities, snap })` passes it to `turned`; `arcade` takes `snap` for
  the row turned onto its line; `dome` is exact unless told (`snap: 1` rounds). `arch`, `cylinder` and `bend` were exact
  already; `roof` and `tree` round heights and centres, not turned pieces, and a palm's fronds are now turned exact.
  `forms.mjs` keeps its numbers to a billionth, as `source.mjs` does, so a dome's planes written through different
  corners of one plane agree.
- **checkPlan**: "N brushes have planes through points off the grid" is a fact now, not a warning: the writer keeps ten
  decimals and shared corners stay shared, so it names no fault; `csgFaults` still refuses what the compiler would.
- **`compileMap` says a repeated warning once** (`groupedWarnings`): a warning the compiler prints once a place
  ("Ambiguous leafnode content", "Leaf portals saw into leaf", "Illegal Brush", coplanar, outside world, tiny face, and
  any line repeated with other numbers) is one sentence with its count, its first three places and what it means and what
  to do; the lines as printed stay in `result.logs[].text`. hlbsp's warnings glued to its progress ("500...Warning: ...")
  were missed before and are read now.
- Tests: `190-exact-turns` (the compile part with `VHLT_DIR`); 189's turned cases ask for `snap: 1` where they hold
  whole units; docs/MAPS-MAKING.md.

## 0.39.0, two checks from the plaza's walk

- **A face on a face** (`coplanarFaults`, in `checkPlan`): a face of a brush entity that lies on a face of the world, or of
  another brush entity, looking the same way and sharing area with it, is an error: sdHLCSG keeps both and the engine draws
  both on one plane (z-fighting). Measured with the compiler: a func_wall panel set flush into a wall keeps its face and the
  wall's stays whole; a func_detail's face there is cut away instead (the world is not cut by detail), so it is a fact of
  the report, not a fault; faces that look at each other (a crate on a floor) are left alone. Broken cases; docs/MAPS-CHECKS.md.
- **Sky through a gap** (`skyGaps`, `smak map-skygaps`): from the spawns and the walked floor, the eyes under a roof cast
  2000 rays each over the upper half of the sky through the map's own tree; a ray that reaches the sky through an opening
  under 24 units wide, measured where the ray comes out from under the roof, is a gap, told with the eye, the way it looked
  and where the gap is. A window or an arch is wider and no gap; `ignore` boxes (`--windows`) name the places meant. Its
  fixture (`test/fixture-skygap.mjs`: a slit 2 wide in a roof 4 thick, a window of 64, a sealed room) and broken case.
  Made after the owner's walk of the plaza slice (2026-11-10): the sky box showed through a slit at a gallery roof's edge.
- `floorSpots` (the eye points over the walked floor) is exported from pvs.mjs for both; fidelity.mjs reads leaves with
  bsp.mjs's `leafAt` instead of its own copy.

## 0.39.0, the battery's eyes

- **`fronts`** in the post-compile battery (`checkDoorFronts`, `levels/assembly/fronts.mjs`): every street door, shop front and
  mover, both sides, is traced from its middle at 40 over its floor: FAIL under 72 to anything solid (the world, a brush entity's
  own geometry, a CLIP, a prop's box), or solid at 10, 40 and 70 over the floor within 112 of a street door (a wall or column that
  fills the view of a player stepping out), or no place to stand 36 out. The old `doors` answer measured only the `func_door` movers.
- **`spawns`** (`checkSpawnViews`): from each spawn at eye height along its own yaw (`angles`, which the eye views had not read), FAIL under
  128 to the first solid, WARN when the entity has no angle and the open side is elsewhere.
- **Placers**: the seed search keeps a building whose doors do not face a shaped area's mass (`entrancesFacingWalls`); a portico leaves
  out the column on a door's line (`plan.columnsSkipped`, a wider bay); `spawnsOf` turns a spawn that would face a wall to the longest of
  eight open ways (`openYaw`).
- **Reach**: the walk's targets leave out the cells a roof way's crate climb or stair stands on and the open trench of a stair
  down (`publicCells`): byz02's 18 misses were those, not pockets.

## 0.39.0, the builders of form

- **`horizon` on rooms, and one sky**: a room with a `horizon` keeps a stone roof over its ceiling (`wall` thick at least) to its roof
  line; it was only outdoors, and an indoor room's rock stood to the sky plane. Over every roof and rim the volume is now air up to
  one sky box (a slab and four walls of sky, 64 thick, round the plan) instead of solid sky brushes that hid what stood behind them.
  Rooms without `horizon` keep their rock to the slab. hlvis sees across the roofs now.
- **`carvePlan` over turned outlines**: a sliver of rock between two lines that should be one wall (the wall two turned rooms
  share, its ends rounded apart) joins the rock beside it, and a piece whose end would be a hair short ends at the crossing of
  its lines; a plaza turned 12 degrees now compiles (8 brushes CSG called illegal before).
- **`checkPlan` finds what sdHLCSG refuses**: `csgFaults` (`source.mjs`) works each brush out as CSG does (a point within 0.04
  of a plane is on it) and fails a brush whose faces do not close (an edge with no opposite face, a wedge a hundredth of a
  unit thick) and one that reaches past +/-32768, with the brush's number and place; broken cases for both.
- **`dome` at any radius**: each tile is `solidOfPlanes` (new, `source.mjs`): faces are planes through three rounded corners,
  shared by the neighbours, so no corner rounded off its face makes a sliver (a dome of 352 gave 63 illegal brushes).
- **The plaza walk's three forms** (2026-11-10): `railing` has `kind` `"bars"` (a handrail, a bottom rail, posts every
  `spacing`, balusters every `gap`) and `"panel"` (a slab under a handrail) beside the `"slab"` it was, which read as a wall
  of gold in the game; `tree(at, { kind: "round" | "cypress" | "palm", height, crown, bark, leaves })` (`forms.mjs`) makes
  the faceted trees of the game's own maps, under ten brushes, every one closed for CSG, in place of a cylinder under a
  dome of grass; and every builder of form takes `scale` (a number or [x, y]), with `withScale(texture, scale)` and
  `scaled(brushes, scale)` (`source.mjs`), so a 64-texel trim on a cornice of 1536 is a moulding at 0.5, not wallpaper.

- **Face alignment**: a face more than 5 degrees off every axis wears its picture along the face unless told `align`
  (`"auto"`); straight faces are unchanged byte for byte.
- **`turned`** rounds to whole units at other than a quarter turn (`snap: 1` the default).
- **New, each the one way**: `frame({ at, yaw })`, `roof(outline, { kind, pitch, overhang })`, `dome`, `arcade`
  (`src/maps/frame.mjs`, `forms.mjs`; `examples/08-form.mjs`).
- **Retired**: massing's own cornice (now `sweepProfile`), terrain's stair treads and bridge decks (now `stairs`,
  `bridge`), the roof slabs in `house` and `hipRoof` (now `roof`), five hand-made round outlines (now `circle`).

## 0.39.0, the pruning

Everything below went to the branch `dormant/0.38`, which holds the whole tree as it was; none of it is deleted from
history. A thing comes back only with a consumer: a map or model that is used and needs it (`ARCHITECTURE.md`, 2.2).
About 90 k lines of code left (lines of .mjs, .py and .cpp; the tests of those areas, 15 k, with them).

- **The Source and s&box ports**: `src/source` (5.7 k lines; `mapbrushes.mjs`, which the navmesh walk reads brushes with,
  stays as `src/mapbrushes.mjs`), `src/sbox` (6.1 k), `src/glb-write.mjs` (0.7 k), the commands `gmod-*`, `sbox-*`,
  `source-*`, the guides `docs/SOURCE.md` and `docs/SBOX.md`. They served games the kit no longer works for.
- **The figure judges**: `src/figures` (4.7 k), `figure-*` commands, `docs/FIGURES.md`, `profiles/halflife.mjs` and the
  `FIGURE_STYLE` of the other profiles. No map or model the owner uses asks for them.
- **The spec builder**: `src/spec` (12.1 k; the colour helpers of the sprite measure stay as `src/sprite/colours.mjs`), the
  commands `build` and `music`, `docs/SPEC.md`, `docs/SPEC-MAPS.md`, the spec defaults of the profiles (`SPEC`). Three spec
  formats coexisted; the kit goes by scripts over `src/maps`. The sprite, sound and music libraries stay. **The sound and
  sprite spec builders stayed too**, as `src/audio/spec.mjs` and `src/sprite/spec.mjs` (with the commands `sound` and
  `sprite`, tests 62 and 63 and part of 64), because the metro's ride loop and chime (`levels/art/h9-metro-sounds.json`) and the
  glow sprite (`levels/art/h9-glow.sprite.json`) are built from them; the music spec stays on `dormant/0.38`.
- **The paused city generator and its surveys**: `levels/experimental-city` (19.1 k), the generator world of `levels/lib`
  (13.4 k: city, description, plan and review pictures, architecture rules, the sky, emblems, the L4D2, Source and VT2 survey
  readers) and the `levels/tools` that existed only for them (6.6 k; `levels/lib/art-kit.mjs` and the tools of the assembly
  and the art kit stay), `scripts/source-budgets.mjs`. New Byzantium's first build is paused; `levels/assembly` is the live path.
- **P2, the checks of a map's dressing and build** (the owner's walk of byz02, 2026-11-08):
  - `dressSite` fails when a dress model that stands on a floor and is over 18 high has no `clip: true` (`dressClipProblems`; 23 models of h9-byzantium set), and the placed-prop sentence names its source.
  - The street-lamp lattice skips a cell whose post touches a keep-clear, ramp, stair, blocked or door-front cell (`street-lamp-skipped` in the counts, the reason in `skipped`); the keep-clear sets move above the lamp loop.
  - The public-floor and room placers refuse a ramp or stair cell and anything `blockageProblems` would find (margin of a stair, ramp or roof way, a door's front, leaf or spot); test 188 holds mese-01, roofs-test and terrain-test to none.
  - `build-site` runs a post-compile battery (reach, doors, props, clips, light, pvs; `siteBattery` in levels/assembly/views.mjs), eye-height views and `<name>.report.md`; any FAIL fails the build; `--battery-only <folder>` re-runs it on a built folder.
  - A style rule with a corpus band `{ n, corpus }` is a FAIL only with n >= 10 of the target corpus, else a NOTE (`BAND_N`, `checkStyle`'s `notes`); no rule of the three styles carries a band yet.
- **The live editor**: `editor/` (7.8 k, in disuse; the owner). The MCP server stays.
- **Animation surveys**: `anim/` (12.6 k lines of Python and data on VT2). **The Blender jobs**: `src/blender.mjs` and the
  `.py` files (0.6 k); `runBlenderJob`, `bakeMaps` and `blenderInspect` are gone.
- **Tests** of the above: 60 of the 184 areas (the generator's 122, 126, 130 and 140 among them), their broken cases
  (`test/broken/{figures,sbox,source}.mjs`, and `specs.mjs` but for the sound and sprite validators) and entries in `test/broken/checkers.mjs`; `docs` and `README.md` lose
  their mentions. `bin/smak.mjs` goes from 86 commands to 64.
- **The layers declared, and the suite split** (`ARCHITECTURE.md`, P1): `layers.json` maps every `.mjs` file to `core`,
  `make`, `check`, `cli` or `game` (what leaves for the H9 project in P3); the folders are not created yet. `test/00-architecture.mjs`
  runs first and fails on a file in no layer and on an import that points up; the orphans, the 60 k budget and the game names in the
  kit are printed as NOTE lines until P3. `npm test` is the fast suite, 75 s (633 cases; 26 areas that took 5 s or more and the
  broken cases' runs are left out; the broken cases are still registered, so every checker still needs a case or a reason);
  `npm run test:slow` runs everything, 17 min (1219 cases). The approval hashes of the piece maps are taken over their text with
  line endings read as LF, so `.gitattributes` no longer forces any.

## Unreleased

The city generator (`levels/experimental-city`, now on the branch `dormant/0.38`) is paused: New Byzantium's first build waits (`PLAN.md`, Phase 3).

Levels:
- A metro under the streets (`levels/assembly/metro.mjs`, `levels/specs/metro-test.json`, test 181): a hall with a `trench` is a station
  (platforms, a trench with rails, edge strips, steps out of it, a crossing, benches, square columns, cream and warm lamps), a tunnel with a
  `trench` is the line between stations (walkways with a railing under a pitched roof), a stair from the street 160 wide with an arch
  (`street.arch`) goes down to a concourse (`role: "concourse"`). `checkMetro` holds the rules (with its broken cases); the walking graph
  has the platforms, crossings and concourses, not the trench or the line. byzantium-02's S1 is a metro instead of sewers.
- Ground heights with everything a site uses (`levels/specs/heights-test.json`, test 179): the level below (manholes, ladders, lids,
  a stair from the street under the paving), the dressing, the site's walls and lights and the light's storeys count from the ground of
  their cell, not from 0; a vault too close to the ground over it is a failure with a sentence. A site of one height builds the same .map.
- `levels/tools/city-join.mjs`: a city's tiles joined into one map. Each tile's seal on a shared seam is cut away,
  the city's outer border keeps its own; one worldspawn (wads merged in order), one `light_environment`, names made
  unique where two tiles' clash (shared ones kept); checks against the description's budget, every seam portal open,
  and no leak (a flood a seam).
- Stage 4 carries a hallway onto the seam at its portal, routes one through a tile it only crosses, and lays one path
  for each connector and secret passage that crosses a seam (`passages`), so both tiles build it alike.
- Stage 10 on every tile, not only the Core: the air beyond the city's edge is carved and capped; a canal no longer
  adds a height; entity names keep to letters, digits and `_`; a floor with no kept height below stays where it is.
- Stairs: a switchback in a walled stair core with a spine wall between its lanes, its material by the district's
  wealth (wood only in slums). Light: one `light_environment` a tile (a dim storm sky), lamps scaled to their space
  (200-1500). Doors: every door but a cell's is seated, with jambs and a head where there was air; plain doors swing,
  gates slide up.
- Towers: `spire` and `stepped` silhouettes beside round, octagon and square.

Maps:
- `doorClearance` and `smak map-doors`: room for a standing player on both sides of every door, props counted by
  their models' boxes and named (exit code 1 on a door with no room). `doorViews` and `map-views --each-door`: each
  door from both sides at the eye, in sheets. Made after six street doors of smak_byz01 were found blocked in H9.

Tests: `sureEach` (test/helper.mjs), a check of each thing of a list that fails on an empty list; the dressing's
reserved cells were empty and its test passed over nothing.

Left: the secret tunnels' change (under the slab, with a check) is half done and untested. The selftest gives 1178
passed and 4 failed, all in the city generator: city prep's rock term (122, failing before), the Core's stages 0-4 (a
connector unplaced) and the review pictures (c32_secret_salon has no exit), both from the seam paths of connectors
and secret passages, and gen geometry's edge cases (the half-done tunnels).

## 0.38.0 (2026-11-02)

The first steps of SMAK 1.0: a kit for game content in general, glTF at its centre, measured against real games.
The plan is `PLAN.md`; the 0.x plan is kept as `docs/history/PLAN-0.x.md`.

Levels from a description (`levels/`, Phase 3 of the plan):
- A map generator in stages, each writing an artifact (`smak-gen/1`, with its inputs' hashes) and each stopped by a
  gate that fails in sentences: description, site, lots, programs, network, plans, palette, wiring, dressing, forms,
  geometry, compile, measure and walk (`levels/experimental-city/`, now on `dormant/0.38`, run by `levels/tools/generate.mjs <description> --tile cX_rY
  --until N --out <dir>`; artifacts in `levels/experimental-city/ARTIFACTS.md`).
- A rulebook of architecture (`levels/rules/architecture.json`): every dimension, room size, cap and band with its
  source and a note. A description may tighten it, never loosen it.
- Cities built by tiles, with tools held over the whole city: `check-city` (walks, connectors, checkpoints, homes),
  `city-portals` (the doors between tiles), `check-seams` (a deck's piers in one rhythm across the tiles' seams),
  `review` (plan pictures for a person's review and approval), `geometry-review`.
- Room layouts: pockets split, rooms swapped, soft caps on each room's area; stair bands and slivers checked.
- Forms (stage 9): facades by wealth, edges, a deck frame, colonnades, towers and domes, an art kit, emblems and a
  storm sky (`levels/tools/art-kit.mjs`, `emblems.mjs`, `sky.mjs`), kept to a brush budget with a reserve.
- Geometry (stage 10) for Xash3D, and a BSP2 reader beside the v30 one (`src/maps/bsp.mjs`, `lumps.mjs`).
- Level styles as a kind of game plus a theme, and measures of other games' maps (Half-Life, The Specialists,
  Left 4 Dead 2, Vermintide 2) as bands: only measures are kept, never a game's file (`levels/corpus/`,
  `levels/notes-*.md`).
- The test is New Byzantium, an RP city in three layers for Xash3D (`levels/specs/newbyzantium.json`): eight of its
  nine tiles pass stages 0 to 9; one (c2_r2) still fails M13, a district with no landmark, until the description's
  format has more tower silhouettes.

Animation measured (`anim/`, Phase 2):
- A judge of first-person melee swings in units of the arm (forearms), with bands measured from Master Sword Rebirth
  and Vermintide 2 (`anim/corpus/`, measures only), and the Python readers that took Vermintide 2's clips, skeleton
  and weapon templates apart on the machine where the game is (`anim/vt2/`; what they read stays there).
- `anim/corpus/melee-items.json`, MSR's items read out of its scripts, is not in the repository: `anim/tools/corpus.mjs`
  makes it again from the game, and `meleeBlows` needs it.

glTF:
- `writeGlb(scene)`, `mdlScene(mdl)` and `mdlToGlb(mdl)` (`src/glb-write.mjs`): a `.glb` written from the common
  shape, or from a studio model, with its bones, skin, animations and pictures.
- `smak sbox-port model.glb` ports a glTF model, skin and animations included, straight to s&box, and
  `smak sbox-check model.glb` holds the editor's copy to the file (`src/sbox/glb.mjs`, `docs/SBOX.md`).
- `insertBones` puts new bones among a model's old ones (`src/mdl.mjs`).

Blender:
- `runBlenderJob(script, job, options)` runs a job headless with `src/blender_job.py` importable; `blenderVersion`,
  and `blenderInspect(file)`, what Blender sees in a `.glb`, `.gltf` or `.fbx`. `bakeMaps` is a job too.

Maps:
- `compileMap({ engine })`: `-engine goldsrc` or `-engine xash` for compilers that take it (2cwldys/sdhlt).
- `compileMap({ format })`: `-format bsp30|bsp30ext|bsp2` to every program (the same fork), that layout written
  whether or not the map outgrows version 30; bsp30ext and bsp2 refused without `engine: "xash"`. `BSP_FORMATS`.

**Mind**: `runBlenderJob`'s arguments changed (`script, job, options`; it was `script, input, outDir, options`).

## 0.37.1 (2026-10-30)

s&box, the lightmapped and studio shaders (`lightmap.mjs`, `studio.mjs`), which 0.37.0's left uncompilable:
- `F_TRANSLUCENT` names its three values (Opaque, Blended, Added): s&box refuses a feature of more than two values
  without names, and the studio shader failed to compile.
- The lightmapped shader reads `g_flOpacityScale` only in its see-through combos: s&box's sbox_pixel.fxc declares it
  only when `S_TRANSLUCENT`, so every opaque face's material failed to compile. An opaque face's amount is 1, or its
  entity's once changed.

## 0.37.0 (2026-10-30)

s&box, a map's liquids and see-through faces (`map.mjs`, `lightmap.mjs`):
- The world's liquid faces are drawn apart, in a `worldspawn liquid` object that blocks nothing (a liquid is swum in:
  a game reads where it is from the map's contents); a func_water or func_door of special contents (a skin) and a
  passable door (spawnflag 8) block nothing either (doors.cpp).
- A brush entity's liquid shows its top only, as Xash3D's R_SortBrushModelSurfaces draws it: of its liquid faces, none
  whose plane is not level (unless EF_WATERSIDES) and none at its bottom. The compiler gives a liquid every face both
  ways, and those under the top showed through it as dark shapes that moved with the view (ts_casa's pool).
- With lightmaps, a see-through brush entity (rendermode 1 to 3) is drawn by the lightmapped shader, `F_TRANSLUCENT 1`,
  blended by its `renderamt` (`g_flOpacityScale`), in full light and with none of s&box's lighting: complex.shader's
  translucent pass took the screen's ambient occlusion from what lies behind it.
- TS's slow-motion zone (`ts_slowmotion`) is one of the classes never drawn.

s&box, a map's dynamic lights (`lightmap.mjs`):
- The lightmapped shader adds GoldSrc's dynamic lights (dlights: a flashlight) to a face's light as the engine does
  (R_AddDynamicLights): a light's radius less its distance off the face's plane, (rad - d) x its colour at each of the
  face's samples, d measured in texels the engine's way, on the lightmap's own scale (a sample x 264), mixed between
  samples as the lightmap is. Up to `DLIGHTS` (8), handed to every material by the game (`SmakDlight0..`,
  `SmakDlightColor0..`: Scene.RenderAttributes). Measured in Momentum Break: on a wall whose texture is scaled 2 across,
  a light of 120 reaches 133 units up and past 150 across, as GoldSrc's does, and lifts the wall from 97 to 167 where
  GoldSrc's sum gives 163..177.

s&box, a map's faces that change (`lightmap.mjs`, `map.mjs`; Xash3D R_TextureAnimation, DrawGLPoly):
- An animated texture plays: its frames (`+0`..`+9`, `+a`..`+j`) side by side in one picture, `g_flFrames` and
  `g_flOtherFrames` of them, stepped at `ANIMATION_RATE` (20) a second from the face's own set, or from the other
  while its entity's frame is on (a button pressed). Measured on The Specialists' maps: ts_lobby's screens, the
  elevator buttons' lit and unlit sets.
- A conveyor's texture (`scroll*`) moves along s by -speed / its width a second: a func_conveyor's `speed` as
  CFuncConveyor::UpdateSpeed codes it, any other brush entity's `rendercolor` read the same way.
- A brush entity whose state a game may change wears a slot, its model's number (`g_flSlot`): a texture with another
  set of frames, a func_conveyor's, one an env_render names. A game hands every material a picture of the slots
  (`SmakEntities`, with `SmakEntitiesSet` 1), 8 bits a channel: red full while its frame is on, green full while its
  conveyor runs the other way, blue its render amount with alpha full (alpha 0: the map's). Until it does, each face is drawn as the map starts it.
- A brush entity an env_render names is drawn though the map starts it unseen (render amount 0), so its amount can
  rise.
- With lightmaps, an added brush entity (rendermode 5) is drawn by the lightmapped shader, `F_TRANSLUCENT 2`: the
  texture times its amount, unlit, added (ONE, ONE), writing no depth.

s&box, a model's folder (`port.mjs`): a nested `folder` ("ts/props") is kept as folders, each part named as before;
it was made one name (`ts_props`).

s&box, a model's render mode (`studio.mjs`):
- The model shader's `F_TRANSLUCENT` draws an entity's render mode as GoldSrc's studio renderer does (Xash
  GL_StudioSetRenderMode): 1 blended by `SmakModelBlend` (the render amount over 255) and still writing depth, for
  kRenderTransColor, TransTexture, Glow and TransAlpha; 2 kRenderTransAdd, the texture times the amount added (ONE, ONE),
  unlit, unfogged, writing no depth. A game sets it on copies of a model's materials; added in linear light, not on the
  screen's colours as GoldSrc adds.

s&box, a model's dynamic lights (`studio.mjs`):
- The model shader takes `SmakModelLightTotal` and `SmakModelLightReach`, set by a game when dynamic lights reach a
  model as the engine's R_EntityDynamicLight adds them (each within its radius adds radius - distance to the total,
  pulls the light's way toward itself by as much, and tints the light): the total, and the pulled way's length, of
  which v_direct shades. Unset, a model is lit as before. Measured in Momentum Break: a white light of 120 40 in front
  of a player model raised its total from 63 to 143 and its way to 102 long, the engine's numbers.

s&box, GoldSrc's additive drawing:
- `sbox.additiveShader()` and `ADDITIVE_SHADER`: a shader that adds a texture to the frame as GoldSrc adds
  (kRenderTransAdd), on the screen's colours, from a copy of the frame behind it. s&box's own additive blend adds in
  linear light, where a faint sprite (TS's gun smoke and laser beam, at most 27 of 255) adds about a tenth of what
  GoldSrc adds on a lit wall. For quads drawn from code (Graphics.Draw); measured in Momentum Break: a quad of 27 adds
  27 on every part of a wall, dark or lit.

Sprites:
- `maps.spriteFrameRgba(sprite, n)`: a sprite's frame as a picture, as the engine reads its format (additive and
  normal opaque, alpha test's holes black and clear, index alpha the last colour with the index as alpha), for a game
  that draws sprites itself (Momentum Break's TS impact particles).

s&box, a map's surfaces (`docs/SBOX.md`, "A map, as a scene"):
- Each material of a ported map names its texture's type (the game's `sound/materials.txt`) as a physics surface of
  the kit's own, `goldsrc_<type>` (`surfaces/goldsrc_<type>.surface`, made on the nearest of s&box's), which a trace
  that hits the face reports: what a game picks a step's or an impact's sound and particles by. `surfaceOfType`,
  `SURFACE_OF_TYPE`; `vmatOf`'s `surface`.
- `sboxDecal` (`src/sbox/decal.mjs`): a decals.wad texture (a bullet's hole, blood) as an s&box decal definition and
  its picture, read as the engine reads it (`maps.decalRgba`: masked when the palette's last colour is pure blue, else
  a gradient of that colour), at its texture's size in units. The lightmapped shader lays s&box's decals on the
  texture before its light (`Decals::Apply`), so a hole is lit by its face's lightmap as GoldSrc lights a decal;
  Momentum Break's {shot} holes on ts_lobby measured so.

Play (`docs/PLAY.md`, "A demo, read"):
- `play.readDemo`: a GoldSrc demo (.dem, the console's `record`) read, every frame the client drew: where it had the
  player, how fast, on the ground or not, the eye's height, the command sent and the server's movement settings.
  Momentum Break's walk test held s&box's port of TS's movement to a demo of TS played by hand on ts_lobby: top
  speed, acceleration, the stop, the jump, the duck, all within 1%.

s&box, a map's light (`docs/SBOX.md`, "A map, as a scene"):
- A map is lit by its own lightmaps (`lighting: "lightmaps"`, the default; `src/sbox/lightmap.mjs`): every face's
  lightmap in one picture of the map's, each face's place there in its corners' vertex colour, and SMAK's shader
  (`shaders/smak_lightmapped.shader`, written into the project) laying it on the texture as GoldSrc does. TS's
  ts_lobby: 1.02 times as bright as GoldSrc draws it, every start within 1.00 to 1.04, correlated 1.00, nothing to bake
  (with s&box's lights, 0.12: TS's lamps are in no lights.rad). `lightmapAtlas`, `lightmapShader`,
  `LIGHTMAP_SHADER`, `LIGHTMAP_SCALE`, `OFFSET_BIAS` exported; `meshBlob` takes a polygon's `color`.
- Its light styles played as the game plays them: a steady style added at its letter's share, one that changes (a
  flicker, a light's own pattern) in a layer of the atlas below the faces, its pattern in `lightstyles.png`, played
  by the shader's clock. `stylePatterns` and `GOLDSRC_STYLES` (`src/maps/light.mjs`) say each style's pattern as the
  map starts. ts_parking (Half-Life's flicker on 109 faces): every start 1.00 to 1.04, correlated 1.00. A light
  switched by its name stays as the map starts it (no stock TS map switches one).
- The lightmapped faces take no shine from s&box's lights (the shader ends without them): ts_parking's 131 lights
  had put patches of gloss on its walls.
- s&box's lights stay as `lighting: "lights"` (`--lighting lights` on `sbox-map` and `sbox-map-check`), with: the
  indirect light at 4 probes per 1024 units (`INDIRECT_LIGHT_DENSITY`, was 8: ts_lobby's 66096 probes baked at 6 to 26
  a second); its bake kept while the port writes the same (`smak_bake.json`, `bakeKeyOf`, `recordBake`), older
  bakes' files removed; its time allowed from its probes (`indirectProbes`), the editor's minimized windows shown
  while it bakes (`editorWindowsShown`).
- A brush entity in render mode 1 to 3 is drawn seen through at its `renderamt` and lit by itself (it was opaque);
  one at `renderamt` 0, and the classes the game never draws (triggers, ladders, monster clips, zones), not drawn.
  Those classes do not block: ts_lobby's trigger_hurts had blocked 3.5 spots in a hundred.
- A `{` texture's holes are open only on a brush entity in render mode 4; on the world and in any other mode they
  are filled with the palette's last colour, as the game draws them (`drawMap`'s `lookOf`).
- The sky's picture laid as s&box's sky shader reads it: -X in its middle (measured with a picture coloured by the
  way each part faces). With +X there, as before, ts_lobby's sky was turned half round.
- Sky brushes are solid for players (`clipBrushesOf(bsp, { skySolid: true })`): ts_lobby's open roof had let
  4.6 spots in a hundred through. And the world's sky faces collide, never drawn (`sky clip`, under `clip`): a sky
  face that closes the map has the void behind it, where the clip brushes' samples miss the hull's growth
  (ts_parking: 2.24 spots in a hundred blocked otherwise than in GoldSrc, 0.40 with them).
- A texture drawn translucent (render mode 1 to 3 or 5) whose sides are not powers of two wears a copy that is
  (`_pot.png`): complex.shader's translucent mipmaps failed on ts_parking's `ts_wall19` (96 by 128).
- `sbox-map-check` writes each start's two pictures (`shots`), and sbox-cli calls get their own time
  (`--request-timeout`). It pictures each start twice, the first to stream the textures in: with one, coarse
  mipmaps of ts_parking's atlas had put three starts at 1.14 to 1.18.

s&box, a model lit as GoldSrc lights one (`docs/SBOX.md`, "Lit as GoldSrc lights a model"):
- `src/maps/model-light.mjs`: Xash3D's R_EntityDynamicLight, R_RecursiveLightPoint and R_StudioLighting ported.
  `lightAt` (the sky's light when a line toward the sun comes to sky, else the floor's under the model, leant by
  its gradient), `lightAlong`, `floorLight`, `meetsSky`, `modelShade` (v_direct 0.9, ambient 128 at most),
  `vertexLight` (SHADE_LAMBERT 1.495), `skyLight` (TS's sv_skycolor and sv_skyvec, after stevenlafl's), `styleLevels`.
- A map ported with lightmaps writes its light tree (`materials/<folder>/maps/<map>/lighttree.bin`; `lightTree`,
  `lightTreeBytes`, the port's `modelLight`): what those walks read, so a game lights a model to the sample.
- `sbox-port --lighting goldsrc` (`lighting: "goldsrc"`): a model's textures on SMAK's studio shader
  (`shaders/smak_studio.shader`; `src/sbox/studio.mjs`: `studioShader`, `studioVmatOf`, `STUDIO_SHADER`,
  `STUDIO_SCALE`), lit by the light the game hands its renderer (`SmakModelLight`, `SmakModelLightWay`,
  `SmakModelLit`); an additive texture stays complex.shader's.
  Its colour is the engine's (texgamma's texture, `STUDIO_TEXGAMMA` 0.8, times illum / 255) times 1.5
  (`STUDIO_SCALE`), measured against TS on Steam from a demo's own camera (ts_lobby's hallway: TS's agent's suit
  within 0.2 of TS's by channel, the world there 1.07).
- Momentum Break's C# port of the walks agrees with SMAK's at ts_lobby's 17 starts and 300 spots round them, to the
  sample; TS's gordon drawn at the starts in s&box's editor.
- The self-test runs `113-demo` (it had been left out of the list) and `114-model-light`.
- A light_environment's `pitch` followed by `angles` takes the later one's, as CLight::KeyValue does (ts_lobby's sun
  is level in the game, though its lightmaps were baked 30 degrees down).
- `sbox-port` no longer passes on the GMod port's own warnings (a weapon script's activities, the Lua for a view
  model's sounds).

## 0.36.0 (2026-10-27)

s&box, a map's light (`docs/SBOX.md`, "A map, as a scene"):
- A brush entity in render mode 5 is added in linear light: its `renderamt` share to the power 2.2. test_scripts'
  shield had washed s&box's whole view purple, and the check had counted that as the room's light (0.84, a false PASS).
- A shining texture's light as hlrad counts it: its value times its colour, area and reflectivity over pi, made
  s&box's light by `TEXLIGHT_SCALE` (1e-7) to the power 1.21, reaching where hlrad's falls to one level in 255 (it
  had ended where a small face's brightness said: test_scripts' crystals 35 to 192 units out, its walls black). A
  map's own `info_texlights` in the older compilers' measure, without the reflectivity and pi. `TEXLIGHT_AREA` is
  gone; `TEXLIGHT_SCALE`, `TEXLIGHT_POWER` and `TEXLIGHT_REACH` are exported.
- Measured: test_scripts' light 0.82 times as bright as GoldSrc's (PASS; it was 0.38 with the shield fixed),
  stalkyard's 1.02 (PASS, 5 of 21 starts within a third where it had 9).

## 0.35.0 (2026-10-27)

s&box: a map, as a scene (`docs/SBOX.md`, "A map, as a scene"; `src/sbox/map.mjs`, `mapcheck.mjs`):
- `sbox-map` makes a GoldSrc map an s&box scene: each face of the BSP a polygon of the scene editor's own meshes
  (MeshComponent, written as s&box saves one: drawn, collided with, editable), the world's in one, each brush
  entity's in its own; its clip brushes rebuilt from the player's hulls (`clipBrushesOf`, now shared with
  `gmod-map`, whose maps come out byte for byte as before), solid and seen in the editor only; its textures, its sky
  as one picture round the world, its starts as SpawnPoints, its lights as s&box's, and a face whose texture shines
  lit by itself with a light before it.
- `sbox-map-check` opens it in the editor and holds it to the GoldSrc map: its meshes and materials (each compiled),
  where a player is blocked at 5000 spots standing and ducked, each start's floor, and its light pictured from each
  start beside GoldSrc's lightmaps.
- Its bounced light: GoldSrc's light compiler bounced every light round the map into its lightmaps, and s&box's
  lights are direct only (MSC's test_scripts, a closed room lit by glowing crystals, came out an eighth as bright).
  Each map gets an `IndirectLightVolume` (s&box's DDGI) over the world, the clip brushes out of it, and
  `sbox-map-check` bakes it before picturing the light.
- A mod's own starts (`--mod msc`: `ms_player_begin`, `ms_player_spawn`), for both commands; a map's
  `info_texlights` read as its shining textures.
- A brush entity is solid with every one of its brushes, faces never drawn too (test_scripts' shield, a cage with an
  undrawn lid: the player walked through its top), as hidden solids under it tagged `brush`; render mode 5 drawn
  additive at its `renderamt`.
- The check: a brush entity's brushes count as blocking on GoldSrc's side as on s&box's, the traces ask for the world
  and the brush entities, and a tab already open on the scene is closed first (it showed the scene as it was when
  opened, not the new port).
- Measured on stalkyard: blocked otherwise than in GoldSrc at 0.16 and 0.18 in a hundred of the spots (GMod: 0.10,
  0.18); its light 0.97 times as bright, correlated 0.82 (without the indirect light, 1.04 and 0.85; 9 starts of
  21 within a third either way, where 17 were). On test_scripts: 0.32 and 0.24 in a hundred; its light 0.23 times as
  bright, a FAIL: the bounce now there, its glowing textures' own light is too weak, and not yet fitted.
- A fullbright texture's material (a model's too) has a white picture as its self-illumination mask: as a colour,
  s&box drew it red.

s&box: a port's materials, and how it looks (`docs/SBOX.md`, "How a port is checked"):
- A masked texture whose sides are not powers of two is made so (its picture opaque, its holes in its mask): s&box
  made no mipmaps of it and the material failed, the model compiling all the same (Counter-Strike's four trees,
  Master Sword's two).
- `sbox-port`'s compile names every material, and fails, saying which, when one is not compiled by the run: the
  compiler left a model's other skins' materials uncompiled (Half-Life's can, chumtoad, hgrunt, houndeye, icky,
  scientist and bullsquid), and a deep project folder runs the generated textures' paths past Windows' 260
  characters, which the error now says.
- `sbox-check` asks the editor to compile each material, and pictures the model: s&box's drawing in a scene of its
  own beside the kit's renderer, from four views, its silhouette and colours held region by region (`--no-look`).
  Its limits measured on Half-Life's 205 models, all of which pass (`-o` writes the pictures side by side); each of
  their materials drawn red, as s&box draws one not compiled, is caught 349 times in 480 where it is a twentieth of
  the model or more.

## 0.34.0 (2026-10-26)

s&box: a model's sounds, as `.sound` assets (`docs/SBOX.md`, "Its sounds"; `src/sbox/sound.mjs`):
- `sbox-port` copies the sounds a model's events play (1004, 1008, 5004) from the game's sound folders (its mod's,
  then valve's) under `sounds/<folder>/`, and beside each a `.sound` heard as GoldSrc heard it: its gain a line from 1
  to 0 at 1000 units over its attenuation (a monster's 500, a view model's 1250), no occlusion or reverb. A loop is
  told in a `.meta` (s&box's compiler does not read the cue chunk). The events become `AE_CL_PLAYSOUND` (5004 at the
  first attachment), which s&box plays with no game code; the `.wav` is compiled with the model (`compileSounds`).
- `sbox-check` reads each `.sound` back as the editor compiled it (its file, length, distance, falloff, and its
  loudness 10 ms by 10 ms against the original), plays each to see that a loop loops, and plays each animation with
  sound events through, hearing its sounds.
- Measured: Half-Life's 13 models with sounds, 69 sounds and 185 sound events, pass; a model of the tests' with a
  loop and a view model's clip at an unnamed attachment passes in the editor too.

## 0.33.0 (2026-10-26)

s&box: an animation's blends, in an animation graph (`docs/SBOX.md`, `src/sbox/graph.mjs`):
- `sbox-port` writes every blend of an animation (before, the first only), each an animation of its own
  (`shootgun_blend1`) after the model's own, and a model one of whose animations blends gets an animation graph
  (`<name>.vanmgrph`, named by the `.vmdl`, compiled beside it): a selector on the enum `sequence` (an option each
  animation, a new one started at its first frame), under it each animation that blends a blend node on the GMod
  port's pose parameter (`blend_xr`) at the values its blends stand for, one on two axes a 2D blend. A game's code
  does what GoldSrc's did: `Set( "sequence", "shootgun" )`, `Set( "blend_xr", 20f )`.
- Measured: s&box's blend node mixes as GoldSrc's renderer does (barney's `shootgun` within 0.008 units at five
  values); a graph played at a rate of 0 is not played at all.
- `sbox-check` holds each blend as an animation, and plays the graph: each animation that blends at its blends'
  start, middle and end, held to GoldSrc's mix (`blendedPoseAt`). The seven of Half-Life's models that blend (agrunt,
  barney, hassassin, hgrunt, icky, player, tentacle2) pass, 207 blends within 0.023 units (tentacle2's tip 0.19).

## 0.32.0 (2026-10-26)

s&box: what a port collides as (`docs/SBOX.md`, `src/sbox/physics.mjs`):
- `sbox-port` makes what the GMod port makes, from the same code (`--collision`, `--surfaceprop`, `--mass`): a
  model of one bone its convex hull, a figure with hit boxes a ragdoll, a view model and a `p_` model nothing. Each
  piece a `PhysicsHullFile` of its own on its bone; each joint a revolute one (a bone its animations turn about one
  axis) or a conical one along the bone, anchored at the child's place at rest; a ragdoll's 90 kg shared by volume,
  its pieces' inertia and damping as the GMod port's QC has them; GMod's surfaceprop as the s&box surface like it.
- Measured in s&box's editor and its own physics: a hull file is read in the model's space and put on its bone, a
  body a bone; a joint turns about its frame's z; a cone holds 90 degrees of swing at most (wider ones are held to
  it, said); a hull of more than 255 half-edges is dropped ("Hull Too Complex for Runtime"), and the compiler's own
  simplifying left hulls up to 14 units off, so the port keeps a hull to 44 corners itself and has it made exactly;
  s&box pushes pieces that start inside each other apart (barney's hands 13 units, 10 to 44 as a game's ragdoll), so
  pieces that meet at rest and are not joined are trimmed apart; a joint between pieces of weights far apart gives
  (loader thrown thousands of units), so no piece weighs less than a tenth of one joined to it, and the rest presses
  a light piece through the floor (big_mom's), so none weighs less than 1% of the whole; s&box's code cannot read a
  model with a `PhysicsJointNull`.
- Gibs are no ragdoll (both ports, `--collision auto`): a body part whose choices are each on bones of their own,
  the model as first drawn on one bone with hit boxes at most (hgibs.mdl, woodgibs.mdl), is shown a choice at a
  time; said, and nothing made unless told. Before, GMod's port made a ragdoll of all its gibs together.
- `sbox-check` holds the physics too: each piece's hull, mass, surface and joint as written, then tried in physics
  worlds of its own: held at rest (no piece pushes another), held in the sampled poses inside its joints' limits
  that its animations do not stretch, and dropped onto a floor until still (not through the floor, its joints
  together). All 210 of Half-Life's models pass: 60 ragdolls, 55 hulls.
- `source.portToSource` also returns `parts.collision`; `RAGDOLL_BODY` (the QC's `$inertia`, `$damping`,
  `$rotdamping`).

## 0.31.0 (2026-10-26)

s&box (Source 2), models first (`docs/SBOX.md`):
- `smak sbox-port <mdl> -o <Assets>`: a GoldSrc model ported to s&box and compiled by s&box's own
  resourcecompiler. Its meshes and animations as DMX (s&box reads no SMD), its bodygroups, skins (material
  groups), attachments, hit boxes, animations' activities and events in a `.vmdl`, its textures as PNG and
  `.vmat` (masked alpha-tested, additive, fullbright). A loop's travel is taken out as root motion; an event is
  kept as s&box's generic one, its number and options.
- `smak sbox-check <mdl> --project <folder>`: the port read back in s&box's own editor (through sbox-cli, which comes
  with s&box: the editor open on the project, or one opened and closed) and held to the original: its bones under
  their parents, animations of their lengths, parts, skins, attachments, hit boxes, and each animation stopped at
  its first and middle frames with every bone where GoldSrc's frame puts it, within 0.1 units and 0.0005 of the
  bone's chain (s&box compresses rotations). All 210 of Half-Life's models pass, in 8 minutes; the farthest bone
  is 0.19 units off, the end of tentacle2's tentacle.
- `sbox.portToSboxFile`, `portToSbox`, `writeSboxPort`, `dmxOf`, `vmdlOf`, `vmatOf`, `kv3`, `findSbox`, `compileVmdl`,
  `checkSboxPort`, `compareSbox`, `expectedOf`, `probeCode`, `editorFor`, `sboxCall`, `runCsharp`.
- `source.portToSource` also returns `parts`, what its QC and SMDs say as data. The GMod port is unchanged.
- Measured in s&box's editor: no turn (`forwardParity 1`); bones named as s&box keeps them (`Bip01_Pelvis`,
  `Stealth_`), or an animation moves nothing; no bone culled, or barney loses his root's turn; no hyphen in a
  mesh's node name, which fails the compile unsaid why; no bodygroup name ending in a number after a letter, which
  ModelDoc renumbers (loader.mdl's `leg2` is `leg_2`). A `p_` model keeps its own bones' names.
- All 210 of Half-Life's models port and compile, in 3.5 minutes together.

## 0.30.1 (2026-10-26)

What a GoldSrc map's port is made of, to the physics and to traces (`docs/SOURCE.md` "A GoldSrc map in GMod"):
- **Corrected:** 0.30.0 said the game reads a physics convex's game data as its surfaceprop. It does not, as
  stevenlafl found and measured: to the physics every hit on the world was `default`. Now each of the world's
  triangles takes the surfaceprop of the brush side it lies on, and the lump's text carries the
  `materialtable`, as vbsp does (stevenlafl's, ported). A brush entity's solid takes its textures'
  surfaceprop with the most area. On stalkyard, 21 crates: 90 hits all `default` before; concrete, wood and
  metalgrate now, each crate's first its floor's own. **Mind:** port a map again for it.
- `source.physCollideLump(models, { materials, surfaceprops })`: convexes as `{ planes, mins, maxs }`, each plane
  with its `material`; `portMapToSource` gives `physicsMaterials` and `physicsSurfaceprops`.
- GMod's 64-bit vphysics.dll has one slot more before `CreateQueryModel` than Valve's header; the helper
  calls it there.
- A rebuilt brush's side takes the texture of the face lying on it, not the first face on its plane. 11 to 25
  in a hundred of the world's drawn area read as another surfaceprop or none (boot_camp's floors as
  toolsnodraw's `default_silent`); now 0.0 to 2.2. Bullets' impacts and footsteps read it too.
- A rebuilt clip brush is left out at more than 10 in a hundred of its grown faces' points open, not 2: at 2,
  real clip of TS's ts_bikini was lost. Half-Life's eight maps still agree on all but 0.02 to 0.48 in a hundred
  spots (datacore ducked 0.48, was 0.34).
- The `map` probe checks that a crate hits its floor, to the physics, as the floor's own surfaceprop. It looks
  256 down for a start's floor and notes one over 64, as Half-Life's own maps have them.

## 0.30.0 (2026-10-26)

GoldSrc maps in GMod (PLAN.md 6f, `docs/SOURCE.md` "A GoldSrc map in GMod"), ported from stevenlafl's converter:
- `smak gmod-map`, `source.portMapToSource` and `portMapToGmod`. The BSP 30 is rewritten as BSP 20 lump by lump:
  its geometry, light and visibility kept, its collision brushes and clip rebuilt, its entities as Source reads
  them, its textures, sky and sprites as VTF and VMT.
- `source.writeSourceBsp` and `readSourceBsp`, and the lumps' pieces (`Packer`, `colorRgbExp`, `visibilityLump`,
  `storedZip`).
- `source.physCollideLump`: the map's physics, made by GMod's own vphysics through `src/source/vcollide.cpp`,
  built once with Visual Studio.
- `writeVtf` takes `frames`, `alpha: "smooth"` and `keepHoles`; `bleedHoles`.
- **Mind:** every VTF now has a thumbnail (up to 16 a side, BGR888), models' too. Without one, the engine had no
  colour for a bullet's chips and dust, and they came out yellow. Port a model again for it.
- Each texture's `$surfaceprop` from the game's `sound/materials.txt` (`source.textureTypes`,
  `surfacepropOfType`), and each physics convex tagged with its surfaceprop's index in GMod's table, as vbsp
  does (wrong: the game does not read it; corrected in 0.30.1).
- Seen in GMod: Half-Life's stalkyard loads, drawn, lit, walked on, with physics. All 115 of Half-Life's maps
  port, with physics.

GMod driven while it runs (`docs/SOURCE.md` "GMod while it runs"), after stevenlafl's tools:
- `smak gmod-rcon`, `source.rcon`: console commands over Source's RCON, found on the LAN address a listen
  server answers on.
- `smak gmod-probe`, `source.runProbe`: Lua run inside the game, PASS or FAIL from its `check()` lines. The
  built-in `map` probe holds a `gmod-map` port: physics, starts, floors' surfaceprops, a crate that lands.
- `smak gmod-shoot`, `source.shoot`: a screenshot from a spot, the HUD and view model hidden, no setting changed.
- `smak gmod-server`, `source.startGmodServer`: a dedicated server from SteamCMD, on port 27016.
- `smak gmod-collision`, `source.checkCollision`: where a player is blocked in the GoldSrc map and in its port,
  spot by spot (stevenlafl's `check-collision`). Eight of Half-Life's maps agree on all but 0.02 to 0.34 in a
  hundred spots.
- Clip brushes rebuilt closer to the map's: each side sampled in a grid, and one that does not lie inside both
  players' hulls when grown left out (`source.clipOutsideHull`). Datacore's came out 8 to 16 units too big.
  Brushes carry vbsp's edge bevels too. **Mind:** a map ported before is ported again for it; a port takes 5 to
  24 s where it took 1 to 6.

A ported ragdoll fitted to the body, its joints measured on its animations (`docs/SOURCE.md`):
- Each piece is the convex hull of its bone's corners, the triangles' sides between pieces shared out among
  them. A bone with hit boxes and no body of its own is left to the piece above. GoldSrc's hit boxes are the
  pieces only of a model whose corners make none.
- Each joint bends as far as the model's animations turn it from its rest, about each axis; an axis it never
  turns about is held, so knees and elbows are hinges. Valve's convention measured on a Half-Life 2 citizen's
  `.phy`. A bone never turned, or a model with no animation, bends 40 degrees each way, said.
- A ragdoll weighs 90 kg, as Valve's do whatever their build.
- `portToSource` takes `densities(surfaceprop)`, which `portToGmod` gives from GMod's own table.

A model made for Source (PLAN.md, 6d): a spec's `"engine": "source"`, or `smak build --engine source`.
- Held to Half-Life 2's props and people, measured on GMod's packs (`scripts/source-budgets.mjs`;
  `SOURCE_PROP_TRIANGLES`, `SOURCE_CHARACTER_TRIANGLES`), not Half-Life's. Painted on 512 a side (1024 a
  character's) unless told.
- Its pictures kept in full colour (`buildModelSpec`'s `pictures`), not cut to 256 colours.
- `check`'s `source` profile (`--engine source`).
- Written, compiled and drawn under `<name>_source/` (`builtToGmod`), colliding as a port does.
- A Source weapon is refused for now.
- A character keeps its base's animations kept apart, and is bound in the stance it was built in.
- A port keeps a bone no vertex is on (`$bonemerge`): Source's compiler dropped it and then could not find it
  for a hit box (a body built on Half-Life's grunt left its toes empty).

A port's blends and travel (`docs/SOURCE.md`):
- An animation's blends ported on a pose parameter named by GoldSrc's motion (`blend_xr` for Half-Life's
  aiming), over GoldSrc's range; four of two axes a grid two by two. `blendingOf(seq)`.
- The compiled port held to it: each loop's travel taken out in one straight piece, as far as GoldSrc's; each
  animation's blends and pose parameters; a view model's fades. Half-Life's 210 models pass.
- `readSourceMdl` reads the animations and their travel, the pose parameters, a sequence's blends and fades.
- `sequences` reads each blend's motion and range; `writeMdl` and `buildMdl` write blends (`blendFrames`).

From stevenlafl's port of The Specialists to GMod, measured there:
- A port's travel comes out as GoldSrc's: `$motionrollback 0`, so a walk's travel is extracted in one straight
  line (Half-Life's grunt walks 112.19 and runs 172.27, as in GoldSrc), and a one-shot stays in place, as
  GoldSrc played it (Source extracts a one-shot's travel along a curve).
- A view model (a name that begins `v_`, or `view`) starts its animations outright (`fadein 0 fadeout 0`), and
  collides as nothing. Its animations with no activity are given Source's by their names (`VIEW_ACTIVITIES`:
  shoot `ACT_VM_PRIMARYATTACK`, deploy `ACT_VM_DRAW`...), as a GMod weapon's script plays them; its first
  attachment is its `muzzle`, turned along the gun's forward.
- The sounds a port's events play (1004, 1008, 5004) moved under `sound/<folder>/` and copied into the addon
  from the mod's `sound/` or `valve/`'s (`soundFoldersOf`); one the game has not is said. A view model's (5004)
  are played by client Lua written beside it (`viewSoundsLua`) and left out of the model: GMod never plays a
  view model's own (stevenlafl's finding in their port of The Specialists). A sound at a rate Source does not
  play (it plays 11025, 22050 and 44100 Hz only), or not 8 or 16-bit PCM, is rewritten as 16-bit at 44100
  (`sourceWav`, their finding too).
- A player (`--kind player`; one under `models/player/`) and a weapon held in its hand (`--kind held`, a `p_`
  model) made a biped GMod knows (`valveBiped`): Valve's bone names, the hands turned as Valve's (measured by
  the thumb: Half-Life's are 180 degrees from male_07's), nothing moved in any frame. A player also gets GMod's
  `anim_attachment_RH` and `LH`, stands on its feet (its animations lifted 36) and is lit from its middle
  (`$illumposition`); `--upper` copies each animation from the spine up (`<name>_upper`). A held one collides as
  nothing. GMod's own player animations are not made to work on it.
- Chrome drawn as GoldSrc draws it: where each corner is in the picture worked out by how it faces the eye
  (R_StudioChrome), once, in the first animation's first frame, from the view's eye for a view model; no room's
  reflection over it, which drew a view model's gloves as mirrors in GMod. A view or held model is known by its
  file's name (`v_`, `p_`) whatever `--name` it is ported as.
- The compiled model's `.dx80.vtx` and `.sw.vtx` left out: GMod reads only the `.dx90.vtx`, and gmad refuses a
  `.sw.vtx`.

## 0.29.0 (2026-10-25)

The Source engine, first step (PLAN.md, phase 6): a GoldSrc model ported to Garry's Mod (`docs/SOURCE.md`).
- `smak gmod-port <mdl> -o <folder>`, `source.portToGmod`. The kit reads the model and writes Source's
  compiler's files: SMD for each submodel and animation, a QC, a VTF and a VMT for each texture. GMod's own
  studiomdl compiles them, in a folder of its own. The compiled model is read back and held to the original,
  corner by corner, and drawn.
  - Kept: bones, animations (those in `01.mdl` files too), bodygroups and their empty submodels, skin families,
    attachments, hit boxes, activities, events, a walk's travel.
  - Changed, each said: what Source refuses (a bone with no name, two bones or animations of one name in any
    case, fps or weight 0, a triangle of no area).
  - Left, each said: chrome, bone controllers, blends after the first.
  - Measured on all 210 of Half-Life's models: every one compiles and holds every corner.
- Source models read and drawn:
  - `smak source-info`, `source-render` and `source-sheet`;
  - `readSourceMdl`, `readVvd`, `readVtx`, `sourceTriangles`;
  - VMTs and VTFs, including DXT;
  - Valve's packs (`openVpk`), so Half-Life 2's own models are read from GMod's packs.
  - `render` takes another kind of model's triangles (`tris`), with textures of their own colours.
- What a port collides as and weighs (seen in GMod: a barrel too heavy, a grunt with no collisions):
  - `--collision hull` (by default for a model of one bone): the convex hull of all its triangles, made by the
    kit (`convexHull`). Source's compiler refuses a collision mesh of several pieces.
  - `--collision ragdoll` (by default for a figure with hit boxes): a box a bone from its hit boxes, joined,
    with a `ragdoll` animation. Half-Life's grunt: 22 pieces, 21 joints.
  - `--surfaceprop`: taken from a kit-built model's record, `flesh` for a ragdoll.
  - `--mass`. Unless given, the hull's volume at the surfaceprop's density from GMod's
    `surfaceproperties.txt`, since GMod's compiler weighs everything as `default`; 90 kg a ragdoll.
  - `readPhy`: the PASS line says what it collides as.
  - A built model's record (`<name>.built.json`) keeps each part's material.
- `ACTIVITY` names every number of `activity.h`, 1 to 76, held to Half-Life's models. 47 is `ACT_IDLE_ANGRY`
  ("combatidle", "madidle"), where the table had `ACT_COMBAT_IDLE`, which is 62.

`AGENTS.md`, "Handing work to another agent": one task a worker, its guide named, every `WARN` quoted in its
report, the pictures looked at by the agent that gave the task, against what the person asked; and
`.claude/agents/smak-worker.md`, such a worker for Claude Code, on Sonnet (PLAN.md, "Which model does the work").

## 0.28.0 (2026-10-25)

The Steam game's window (PLAN.md, phases 3b and 3c), by `src/play-window.mjs`: a helper of C# that PowerShell
compiles (nothing installed), for the windows of the one process a run started, by its id.
- `smak play native --window-pictures`: each picture is the game's window as the person sees it (PrintWindow,
  which draws a window of the graphics card: 36 ms a picture). A game that does not answer is said with what
  its windows show, a box's words first.
- `smak play native --input [--quiet 5000]`: `hold`, `press`, `click`, `mouse`, `tap` and `mouseDown` as real
  keys and buttons (SendInput, scan code and key), only while the game's window is in front (never brought
  there), only after the keyboard and mouse have been left alone `--quiet` ms, and the run stopped, and what
  it held let go, when the person touches either. Without `--input`, a mouse step is refused before the game
  starts and a key step says how. Measured in TS: a real left click takes "Press Fire To Play!" away and a
  second puts the player in; W and D move the camera.

## 0.27.0 (2026-10-25)

Art from a generator (PLAN.md, phase 5): `docs/IMPORT.md`, "Art from a generator": a generated texture as a
material's photograph, a generated mesh through `smak import` (`--triangles`, `--fit`, `--origin base`) or as a
spec's `mesh`, when to ask the person first, what a generator gets wrong, and ComfyUI's API for a script.

What nine agents tripped on (PLAN.md, "Which model does the work"):
- **`findCompilers`** finds SDHLT's programs under the folder it unpacks to (`tools/Win64`, `tools/Linux`), so
  `VHLT_DIR` or `--vhlt` may name that folder as it is.
- **`smak build`** of a map with `--game <Half-Life>/valve` and no FGD holds its entities to the kit's own
  profile of Half-Life (`--mod goldsrc`), which ships no `.fgd`; the no-FGD warning names the flags that give one.
- **A room's own texture** given in place (`surfaces: { floor: { texture } }`) is reported by its room
  (`rooms gallery.surfaces.floor: ...`), not as `[object Object]`.
- **`smak item`** ends with a `PASS`/`FAIL` line, and the picture to look at.
- **`check`'s warning on animations kept in other files** says the engine finds them by the file's own name, so a
  copy under a new name needs them copied under it too.
- **`AGENTS.md`**: a script imports the kit by its `file://` URL.

Before sharing (PLAN.md, phase 4): `smak check --publish <folder>`.
- **`publishCheck`** fails a folder that holds a file of the game's byte for byte, one of the game's textures
  inside a `.wad` or a `.bsp` of it (by its pixels and palette, under any name), a path into the person's own
  folder (in a text or a map's entities) or a key or a token; it warns of another absolute path, an archive over
  50 MB and a missing readme. The game is the Half-Life folder Steam has unless `--game`; `--ours` names a file
  of the person's installed there. The whole Half-Life folder (16,805 files, 8,861 textures) costs 3 seconds.
  Its four broken cases are in `test/broken/publish.mjs`.

The Steam game played by its console (PLAN.md, phase 3a): `smak play native`.
- **`smak play native --map <name> --mod ts`** plays the game Steam installed, GoldSrc's own engine, with
  nothing but Node: `hl.exe -game <folder> -insecure -windowed -condebug +exec smak_run.cfg`, a loop in that
  `.cfg` reading a file every few frames, each command in a file of its own that runs once and answers
  (0.1 to 0.2 s), the console read from `qconsole.log` from where the run began, a map waited for until
  `status` names the player, the game's own `screenshot` made a PNG (`pngOfTga`), `quit` at the end. A run of
  Neuropolis in TS is in the map in 2 s and over in 4. It never joins a server; it has no keys, mouse or view.
  The person's `config.cfg` is put back as it was after the run (the game saves a step's `bind` into it).
  In TS the player stays a spectator: its client lets him in only on the key bound to `+attack`.
- `play.nativeDriver`, and a driver's `loaded`: the line a session waits for after `map` in place of the
  profile's (the Steam game never says Xash's "Custom resource propagation complete").

Fewer tokens a task (PLAN.md, phase 1): an agent reads a short index and the one guide its task needs, and a
check answers in a line.
- **`AGENTS.md` is an index**: what the kit is and needs, the loop, the rules short, how to report, and a table
  "the task, the guide, the template" (7 KB where it was 112). What it held is in guides of its own, word for
  word where nothing held it before: `docs/COMMANDS.md` (the command line, and how a check answers),
  `docs/MODELS.md` (how a model is put together, the rules in full, a new model, an `.obj`, animations, a
  monster), `docs/RESKIN.md`, `docs/SHAPES.md`, `docs/FIGURES.md`, `docs/TROUBLE.md` (what it can and cannot
  do, and when something is wrong), `docs/MAPS-LOOKING.md` (looking at a map, changing its entities). A new
  map's steps went into `docs/MAPS-MAKING.md`'s loop, a `.wad` of one's own into its "Textures", the walk
  test's use to the head of `docs/MAPS-CHECKS.md`, the bought models' advice into `docs/IMPORT.md`, the
  usual tests into `docs/PLAY.md`. `docs/SPEC.md`'s map specs are `docs/SPEC-MAPS.md`.
- The table of what it can and cannot do says what 0.26 can: FBX, glTF and JPEG pictures are read
  (`smak import`), a map is played in the game where there is a browser build of it (`smak play`), SDHLT
  compiles as VHLT does.
- **Answers in text first**: `check`, `map-check`, `figure-judge`, `figure-texture`, `figure-shape` and `play`
  end in one line, `PASS: ...` or `FAIL: ...`, with the reasons. A pass prints five lines or fewer; the detail
  goes to a file it names (`--report <file>`, or `smak/` in the system's temp folder; `told.txt` in a run's
  folder), and `--verbose` prints it as before. The judges pass a figure at or over the lower quarter of the
  game's own figures (style) or with no measure far out of the corpus' middle half (texture, shape), and end 0
  either way. A command that draws says which picture to look at, or that none is needed.
- **Pictures cheap by default**: `smak play` writes each picture a third of the page each way (a run's
  `shrink`, 1 in a script; `sheet.png` keeps its size; `smallerPng`), the judges' sheets two pixels a texel and
  silhouettes at half size (`textureSheet`'s and `shapeSheet`'s `scale`); `--full-pictures` for the full size.
- The MCP `guide` reads `AGENTS.md` and the guides its briefing went to as one, so its sections are found as
  before, and every guide of `docs/` by its name (`doc: "play"`, `"spec-maps"`).

**Mind**: the last line of `check` and `map-check` is `PASS: fit for goldsrc` where it was `fit for goldsrc`,
and the facts are in the file unless `--verbose`; `play` ends `PASS:` or `FAIL:` where it ended `PASSED:` or
`FAILED:`, and its pictures are smaller unless `--full-pictures`.

A broken case for every checker (PLAN.md, phase 2a): a checker that always says PASS no longer goes unnoticed.
- **`test/broken/`, the self-test's area `107-broken-cases`**: for each checker, inputs made in the case with
  exactly one thing wrong and the sentence it must give; a case fails when the checker passes the input, fails
  it for another reason, or fails its twin whole. 74 cases for 40 checkers: models (the engine's limits, a
  texture's size, a loop that does not come back, an event on no frame, a hit box or an attachment on no bone),
  maps (a leak, an entity the mod has not, a spawn in a wall, a monster walled off), specs, sounds and sprites,
  the figure judges (a figure in another game's manner, on corpora made in the case: no game's files), `play`'s
  expectations, and five command lines by their exit code. `test/broken/checkers.mjs` lists every checker of the kit with where it is, and the area
  fails while one has no case and no reason written beside it.
- **`check` tells of an event on a frame its animation has not**: the engine fires an event as the animation
  passes its frame (0 to the count less one), so one past the last never fires. It passed before.
- **`motionOverlaps` asks a piece's middle too**: a piece driven onto one of its own size and place had every
  corner on the other's faces, at no depth, and was not told.
- **`contractOf` reads a model's bone controllers**: it read them from where `readMdl` keeps none, so a
  contract's controllers were always none. `compareContract` still does not hold a model to them (a case of
  `107-broken-cases` marked known, for the owner to decide).

## 0.26.0 (2026-10-24)

The game filmed by the tool that tests it: SMAK's showcase video was made this way (docs/media).
- **`record`, a step of `smak play`**: `{ "record": "plaza" }` films the page from there as a clip of that name,
  until the next `record` or the run's end, written `NN_plaza.mp4` beside the pictures (H.264 at 30 a second,
  through ffmpeg); `{ "record": false }` ends it. The browser's driver films what the page draws (Chromium's
  screencast: a JPEG each time it is drawn, with its moment) through `recordStart()` and `recordStop()`, and a
  clip left open when a run stops is still written.
- **`encodeTimed(frames, { fps })`** (video.mjs): pictures that came with their moments made an MP4 at a steady
  rate, each moment showing the last picture drawn by then (a slow stretch is held, never played fast).
- **Pans**: `face` and `look` take `ms`, the view eased there over that time by the shorter way round.
- **`--gpu`** with `--show`: WebGL on the graphics card (`HARDWARE_GL`), a map drawn smoothly enough to film
  (a walled town at 40 to 90 frames a second where software drew 3 to 7). The pictures then depend on the card:
  checks stay on `SOFTWARE_GL`.
- README: shorter, with what the kit has made and its measures.

## 0.25.2 (2026-10-24)

- **`house` builds a house one goes into** (`inside: true`): its storeys one room up to the roof's beams, walls 16
  thick (plaster within, `within` of the set; boards on the floor, `boards`), the doorway open with its leaf swung
  in against the wall, tie beams a bay apart under the attic. It returns `room` (`min`, `max`, `floor`, `ceiling`,
  `door`, `toMap`, `turn`) to furnish it by. `doorAt` puts the door at a place along the front (the seed's
  otherwise; the seed's draws are kept in their order, so a house without it is as before). Made for Moria's
  Captain's hall (msr-web, the Old Orchard's third version).
- **`render` takes `near`**: what is nearer the eye than it is cut off (GoldSrc cuts at 4), for first-person views
  of a view model.

## 0.25.1 (2026-10-22)

What Havoc9's first play of h9_te_meridian found, and the checks that would have told it before:
- **`fitted` makes words read on every side unless told** (`readable` is true unless `readable: false`): a sign
  fitted to a north or a west face read backwards (Meridian's RECORDS did). A picture is never meant mirrored.
- **`checkPlan` tells func_detail that hangs in the air**: a piece of detail brushes (those that touch one another)
  that touches no seen brush of the world or of another entity, with where it is and what it wears: a lamp in a
  doorway, a sign with no bracket, pipes off their wall, a light in a stair's well. Meridian had eight.
- **`propsOf` (`map-props`) has a thing hang on a wall only when most of a side has wall behind it**, looked at
  over that side's breadth and height. It took one point near the floor before, so a picture in a doorway with a
  jamb by its edge passed as hung.
- **RCBot's waypoints, as the bots played them** (bots ran at crates, scraped walls, and the msr side dropped into
  Meridian's truck pit):
  - The file's first 50 waypoints are open floor and starts, spread farthest-first. RCBot picks its roaming goals
    among the first 50 only (`WaypointFindRandomGoal`), and those had been jump takeoffs and crate tops.
  - A path's line keeps 8 units of room beside the body, short of what a narrow way offers. A line where the body
    only just fits is used only where no other way joins the two waypoints, and is marked `tight`.
  - Waypoints stand off the walls: corners are found on a walk that keeps from them, and are moved into room.
  - Drops are no shortcuts: one is left out where a walk of about its length reaches the same place. A crate top a
    jump reaches is a side trip, and nothing on what breaks is waypointed.
  - Where the nearest waypoint a place sees is on another floor (a bot that lost its way walks at it), a waypoint is
    put on that place's own floor.
  - On Meridian: lines a body does not fit along 199 to 27, one-way drops 585 to 98.

**Mind:** a map that fits a picture to a north or a west face with no `readable` now shows it flipped from before
(words read; a pattern that was mirrored is not). Pass `readable: false` to keep the old way.

## 0.25.0 (2026-10-21)

- **The Specialists' map spec** (`profiles/specialists.mjs`, `SPEC`): a map spec with `"mod"` The Specialists is
  built in the game's manner. Its textures are the shipped .wad files' (specialists.wad and halflife.wad; the
  game's 29 maps keep most of theirs inside themselves), each the one those maps wear most for its part: wood4a
  floors, crete33 walls, fifties_ceil01 ceilings, door006, wall1 brick outside, and more words for a room's
  surfaces (ts_tile, ts_parquet, ts_asphalt, ts_metal...). A prop is a `ts_model`, as the maps place theirs. Rooms
  are furnished by their `use`, with models the maps name, measured and turned as the maps stand them: `office`
  (computers on desks, office chairs, plants, paintings), `lobby`, `cafe`, `warehouse`, `garage`, `server`,
  `stairwell`, and in the open `alley`, `plaza` and `rooftop`. Where the game is installed, the tests find every
  texture in its .wad files and every model under its very name, of the size the profile gives it.
- A mod's thing for a room's use (`spec.things`) may say `deep` (how far it reaches into the room, when that is not
  its `r`: a couch is long and shallow), `turn` (the yaw that faces a model made facing elsewhere into the room)
  and `on` (a piece of the kit's it stands on, put with it: a computer on a desk).
- A room's dressing keeps clear of the places to start: a start stood in a couch.
- **A mod's map is delivered as the .bsp alone.** Built on the .wad files the game ships, a map that wears only
  their textures writes and names no .wad of its own (it wrote one holding nothing but `sky`, which the compilers
  have); one with pictures of its own puts them inside the .bsp (`hlcsg -wadinclude`), so the compiled map asks the
  game only for the .wad files it ships. `compile.embed: false` ships them beside it instead. The report says
  which .wad files the compiled map asks for and how many pictures it carries.
- **What breaks** (`breakable`): a piece of furniture, a prefab or one piece of a prefab that says `breakable:
  "wood"` (or glass, metal, concrete... Half-Life's materials, `BREAKABLE_MATERIALS`) is a `func_breakable` of its
  own with the keys its material takes, the kit's under a mod's (a profile's `spec.breakable`). A window's glass
  takes them too. A mod's profile may flag the kit's dressing pieces or give its own (`spec.pieces`). The
  Specialists' profile, read off its maps' 1006 breakables: glass in render mode 2 at 100 and health 1, crates of
  wood at 15, every one back after 45 seconds; the kit's crates, and crates of 40 and 48, break each alone.
- **Solid props from the profile.** A mod's thing may say `solid` and `high`: a prop of that model, put by the spec
  or by a room's use, gets a `CLIP` box of its footprint (turned as it stands) from its foot to its top, unless the
  prop says `solid: false`; a profile's `prop.solid` says it for all. The Specialists' ts_model is a point to a
  player (its program sizes it to nothing): its couches, armchairs, tables, booths, boxes, dumpster, bench and statue
  are solid, its plants, pictures, office chairs and street lamp walked through, as its maps' makers clip them. A
  thing in the middle of a room (a coffee table) keeps its footprint, turned along the room, not a square.
- **A mod's lamps** (a profile's `spec.lamps`, `{ texture: [r, g, b, brightness] }`, and `textures.fixture` one of the
  game's): every room's lamp is built in a fixture of the game's light texture, two tubes at its own size on the
  ceiling, its picture laid whole, and each of the mod's lamps a map wears is a texture light (`info_texlights`).
  The Specialists' fixture is `+0~fifties_lgt2`; its lamps are halflife.wad's lights its maps wear, each in the
  colour its maps' makers lit it (measured on their lamps' faces) at the brightness of the kit's Valve list, with
  words for a spec's own (`ts_lamp_warm`, `ts_lamp_cool`, `ts_sodium`, `ts_screen`). A map of its rooms no longer
  warns that none of its brushes wear a lamp.
- **Rooms dressed as thickly as the game's.** A room's use stands its pieces all along the walls (every 16, a wall
  kind spread round the room, a corner kind piled into the corners and along the walls from them), not at the four
  corners and a few spots: The Specialists' warehouse of 448 x 384 got 4 pieces and gets 8 to 12. A use may stand
  things in the middle, a walk from the walls and from what stands at them: `rows` (an office's desks), `group`
  (couches facing each other over a coffee table, a walk round it), `cluster` (a pile of crates). A room's
  `density` (a number, or sparse, normal, dense, cluttered; a profile's by use) thickens or thins it. The ways
  through and the places to start stay clear, and every room is still walked.
- **Two teams on a deathmatch map** (`src/maps/teams.mjs`, `smak map-teams`): Havoc9's ts_matchmode replayed from
  its source. A spawn file (`tsm_spawns_<map>.cfg`, `readSpawnCfg`) over the map's own; else the map's
  `info_player_deathmatch` then `info_player_start`, 64 at the most, split as `partition_spawns` splits them
  (`collectSpawns`, `partitionSpawns`: the farthest pair in 3D the anchors, each spawn with the nearer, in single
  precision). `teamsOf` tells the nearest spawns across the teams, spawns in sight of the other side's (the
  encounters' sight test, now `sightTest`), the walk between the sides, each side's walk to a goal (a point or an
  entity; `--each`: the median of every spawn's) and their balance, spawns stuck or over nothing; FAIL and WARN by
  the profile's new `teams` (The Specialists': cross 512 and 1400, balance 25% and 10%, sight a FAIL); exit code 1
  on a FAIL. `--write-cfg` writes the plugin's file as amx_tsm_spawn_save does (`spawnCfgText`), each spawn at its
  floor + 36 and turned to the goal or the map's middle.
- **The walk test to a point**: `reachOf`'s `to` takes `[x, y, z]` beside entities; a point not reached says where
  the walked floor comes nearest.
- **A map's dressing against the mod's own maps**: `dressingOf`'s `against` (a profile's `dressing`; each line says
  whose, Valve's for a measure the bands lack), `learnDressing` and `smak map-dressing <folder> --learn -o
  bands.json`; `map-dressing --mod` and a map spec's build with a profile hold a map to the profile's bands. The
  Specialists' (`DRESSING`), measured over its 29 maps: the floor under 24 1% to 56% (median 10%, Valve's 21%), the
  light's contrast 2.2 to 10.7 (median 3.9, Valve's 12.9).
- **The Specialists' compact arenas**: `COMPACT`, the figures of its eight compact maps (ts_trident,
  ts_hammertime, ts_lobbyduel, ts_wyndham, ts_supertimor, ts_metro, ts_rundown, ts_neobaroque), by
  `kind: "compact"` (`map-character --mod ts --kind compact`).
- **Lamp faces beside the lights**: `characterOf`'s `lampFaces`, the faces wearing a lamp's texture (`lampsOf`), so
  a map lit by its texture lights (ts_trident: one light entity, 58 lamp faces) does not read as unlit.
- **Profiles by name and the game found** (`src/maps/games.mjs`): `--mod ts`, `specialists`, `ts-roleplay`, `msc`,
  `mastersword` (`MAP_PROFILES`, `mapProfileOf`); with no `--game`, a profile made from the installed game is handed
  the Half-Life folder found (`findHalfLife`: `SMAK_HALF_LIFE`, or a Steam library, `steamLibraries`), so
  `map-measure --mod ts` works with no `--game`. `--kind` is handed to the profile.

- **Marble**, a material base (`{ "base": "marble", "tone", "vein", "veins", "scale", "cell" }`): polished stone
  clouded lighter and darker, crossed by veins that wander on a slant with a finer set across them; with `cell`
  laid as tiles with a fine joint. A map's picture of it tiles by noise that comes round with the picture, not by
  blending copies (which left veins a quarter as dark in its middle), and is worn less than a wall (half the patches, two thirds of the grain). It may
  be brighter and more coloured than Valve's walls without a warning.

- **`fitted`** (src/maps/source.mjs): a picture fitted to a box as a mapper fits one by hand. On each face its
  corner stands on the face's corner (top left as seen; a floor's north west), so a trim band's edge falls on the
  brush's edge; `whole` stretches one picture across each face (or one way), `repeat` lays so many, `readable` flips
  the north and west faces, where the world's grid runs a picture right to left, so a sign reads from every side;
  `faces` and `rest` fit some faces only. The Specialists' maps have 49 to 98 in 100 of their faces shifted off the
  world's grid; a box on the grid has none.

- **Lamps built as fixtures on walls and hung** (src/maps/pieces.mjs): `sconce`, a shade of glass on a plate
  standing out of a wall facing any way (a fan, a drum or a box), and `chandelier`, tiers of glass under a canopy and
  a rod. Their glass is a light's texture, lit as a texture light: a room was lit only by tubes on its ceiling,
  laid along y, or by lights in the air. `plate: false` hangs a sconce's shade alone, for a hall where many are
  seen at once.
- **Open stairs**: `stairs(..., { open: 8 })` lays each step as a tread that thick with nothing under it (a fire
  escape, an open-riser stair), at the heights and depths the solid flight has; with `ramp` and `tread` as before.

- **The sweep's drops**: an upper floor's edge by a wall, where a body does not fit, over a room below that runs on
  under it, where one does, was told as a fall to that room (Meridian's mezzanine by the hall's back wall: 384 down
  to the vault). A body falls onto the first solid under it: such an edge is no drop.

- **A mod's own light** (a profile's `spec.lighting`: `{ lamp, composed }`): a room's lamp in a fixture of the game's
  light texture is lit at `lamp` (0: the fixture's texture light alone, no light entity), and the light is composed
  as the mod's maps are unless the spec says `lighting: false`; a dimmed lamp in a game's fixture wears the profile's
  `fixture_dim`. The Specialists': the fixture alone, one lamp in three dimmed to `+0~fifts_lght3` (lit at a quarter).
  Valve's lamps of 250 under its texture lights lit a spec's floors at 218 of 255; now a lobby, an office and a
  warehouse come to 83, within the game's own maps' 52 to 102.

- **A room's lamps as it wants them** (`light.fixture`): `"panel"` on the ceiling (unless told), its tubes now laid
  along the room's longer side (they lay along y in every room); `"sconce"` on its two longer walls in turn;
  `"chandelier"` hung from its ceiling. Their glass is the room's fixture, a texture light where the mod has one.
- **Fog** (a spec's `fog`): over the whole map as the mod draws it, its profile's `spec.fog` (The Specialists'
  `ts_fog`, written as ts_frigid writes it); a game with no fog of its own is warned of.
- **Waypoints for bots** (`src/maps/waypoints.mjs`, `src/maps/rcbot.mjs`; `smak map-waypoints <map> --mod ts --out
  <Half-Life>/rcbot`): RCBot's `.rcw` read and written byte for byte as the bot writes it (`readRcw`, `writeRcw`,
  from its own WaypointLoad and WaypointSave, v1.51b13; 1112 of the bot's files written back unchanged), and
  waypoints laid from the walk test (`waypointsOf`): one at each start, the foot and top of each ladder, each jump
  to floor only a jump reaches with its landing, the ends of stairs, each opening, then every 160 units of walk,
  corners and drops mended until every two neighbours are joined by a line a body walks (both ways) or drops
  (one way), crouching waypoints in a passage only a crouching body fits, jumps and drops added where the paths
  do not yet join what the walk does; only those got to from a start and leading back kept; the top of the sky
  and clips over it left out; RCBot's limit of 1024 waypoints kept. The bot works out its visibility table itself.
  `reachOf(map, { graph: true })` hands back the walk itself (`graph`, not enumerable) for what is built on it.

**Mind**: a map spec built on a mod whose shipped .wad files hold every texture writes and names no .wad of its own
any more, and one with pictures of its own now carries them inside the .bsp (`compile.embed: false` ships the .wad
beside it, as before).

## 0.24.0 (2026-10-20)

- **The figure judges** (`src/figures/`, exported as `figures`), from the figures research: does a figure (a
  humanoid model) belong to a game's manner, and where not. Three judges of measures that work for any GoldSrc game,
  each holding a figure against a corpus of the game's own figures and saying what is off in words, with the part,
  band or texture at fault and what to do:
  - **style**: 52 measures of the model (`styleMeasures`: shape, proportions, texture as laid, colour, per part), a
    score 0 to 100 against the corpus (`judgeStyle`), and the calibration it was validated by (`validateStyle`:
    each corpus' own figures against foreign ones as AUC, the same characters in two manners, a confusion matrix);
  - **texture**: the texture as painting (`textureMeasures`, 21 measures: repetition, flat fills, ramps, speckle,
    slant, charts, an occlusion it follows, value, colours), from a model or from a picture of an atlas read back
    at its pixels a texel (`textureOfPicture`: a screenshot of a UV editor at 4 pixels a texel reads 4.00), against
    the corpus and a reference (`judgeTexture`);
  - **shape**: silhouettes from four sides and the mesh (`shapeOfModel`, 20 measures: holes, notches, inner edges,
    symmetry, pieces, layers, mirror, likeness, boxes), against the corpus and a reference's masks (`judgeShape`);
    `masksLikeReference` draws a model in a reference's own pose and views, framed as its figure stands.
- **The corpus is never in the kit**: `surveyFigures` (`smak figure-survey`) measures the installed game's figures
  into a library of the person's (`~/.smak/figures.json`, or SMAK_FIGURES), each game a corpus beside the others.
- **Each game's manner is its profile's** `figureStyle` (exported as `FIGURE_STYLE`), apart from a map's
  `character.figures`: the corpus, which judges apply, the groups the style judge scores (shape, texture and
  colour: proportions tell characters apart, not manners), and each judge's weights, how far that game's figures
  stand from the other games' on each measure. `profiles/mastersword.mjs` (MSC), `profiles/specialists.mjs` (The
  Specialists' players) and the new **`profiles/halflife.mjs`** (Half-Life, and its HD pack with `kind: "hd"`; for
  maps, `GOLDSRC` with the game's folders). `figureStyleOf` finds one by name, file or object.
- `smak figure-survey`, `figure-judge`, `figure-texture`, `figure-shape` and `figure-validate`.

## 0.23.0 (2026-10-20)

- **Animations kept in other files are posed everywhere a model is posed**: `posed`, `render`, `strip`
  (and `sheet`, `animationGif`), `poseBetween`, `posesFor`, `findPiston` and `motionOverlaps` (its `still` pose
  too) take `groups`, the files `sequenceFilesOf` reads beside a model, as `poseAt` has since 0.22.0. Without
  them `findPiston` and `motionOverlaps` still name such an animation in `skipped`, and `strip` now refuses it
  instead of drawing the bones at rest frame after frame. `smak render`, `sheet`, `strip` and `gif`, and the MCP
  server's pictures, read `<name>01.mdl` beside the model themselves.
- **`footSlide`** (src/reproportion.mjs): how far a walk's planted foot slides over the floor with its travel
  applied, and the lowest point of the feet each frame; the feet are found by their Biped names in English or
  Italian, and where a foot touches is the middle of its lowest points, so a flat sole is not read as its heel
  one frame and its toe the next. The figures research measured a robot's walk against the model under it so.
- **`removeBodypart`**, the counterpart of `addBodypart`: a bodypart taken out and the body numbers counted again
  over those that remain, with the map from every old number to the new one that shows the same; where a number
  the file had would show another submodel, it is refused and says which, unless told to renumber or to keep the
  other bodyparts' bases. **`modelName`** and **`setModelName`**: the name in the header read and written (a
  player made from The Specialists' merc said `D:\half-life\TS\models\player\merc\merc.mdl` inside).
- **Fewer triangles for rigid pieces** (src/cull.mjs): `cullHidden` takes out the faces never seen, the pieces
  drawn from many sides in poses of every animation (or those told), front faces only and with a depth test, a
  face going when it shows less than `keep` of what it could, a piece left with none dropped, the pieces of one
  share kept alike; `triangleVisibility` and `sphereViews` under it. `reduceWithin` and `reducePieces` bring each
  piece down through `reduce` as far as keeps its shape within a tolerance (`shapeDeviation`, both ways). From
  the figures research, where they took a robot for The Specialists from 7,618 triangles to 4,996.
- **`unwrap` lays nets**: the islands of the pieces of one `net` key (each piece's `net`, or `nets: (piece, n) =>
  key`) laid together, each touching one before it at a corner and on none of its texels, and packed as one: a
  limb's plates side by side on the picture. The figures research's bake packed them so again after unwrap, and
  now does not. A corner's place on the picture is its place in its island rounded, then moved by the island's
  whole texels, as the packing measured it (it was rounded after the move, which at a half texel could put a
  corner one texel off where the packing had measured it).
- **`reproportion` keeps a hit box's thickness**: a box on a bone that changed grows or shrinks along the bone
  only (the axis its children stand out along, x for a Biped bone; `along` says which), and is as thick across it
  as it was, as fairness wants: a shorter spine made The Specialists' robot a thinner target, and its research
  put the merc's thickness back by hand. `hitboxes: "all"` (`smak reproportion --hitboxes all`) is the old way.

**Mind**: a model `reproportion` makes now has the hit boxes of the bones it changed as thick as the original's;
made again, a model made before gets those, and `hitboxes: "all"` makes it as it was. `strip` refuses an
animation kept in another file without `groups`, where it drew the bones at rest.

## 0.22.0 (2026-10-20)

- **`reproportion`** (src/reproportion.mjs, `smak reproportion`): a skeleton's bones made longer or shorter, a tall
  thin robot on the soldier's. A factor is a bone's length, where the bones hanging from it stand, a number or
  `[x, y, z]` in its own axes; the other side follows unless told; Biped bones by any of their names. A bone's
  rest position and its position scale multiplied together carry every frame of every animation, those in
  `<name>01.mdl` files too, which are not written: every turn is kept to the bit. The roots' x and y and every
  travel grow with the legs (the stride, measured hip to foot), so a walk's planted foot does not slide; their
  height is a line fitted over every frame that stands, so the feet stay on the floor standing, walking and
  crouching. Hit boxes and attachments grow with their bones, the eye goes with the nearest, and every
  animation's box is measured again. Points stay in their bones: rigid pieces keep their shape. Factors of 1
  give the file back byte for byte. On Half-Life's soldier, legs 1.2 and shoulders 0.8: the lowest point of
  idle, crouch and combat idle within 0.2 of where it was, all 82 animations' boxes measured.
- **Animations kept in other files are read**: `frameValues`, `readSequence` and `poseAt` take `groups`, the bytes
  of `<name>01.mdl` and the rest by their group's number, which `sequenceFilesOf(file, src)` reads beside a model;
  `sequenceGroups` lists the groups. Without them they say, as before, that the animation is kept in another file.
- **`setBoneValues`** (bones' rest values and scales, nothing else touched), **`modelBoxes`** and **`setModelBoxes`**
  (the header's eye and four boxes).

## 0.21.0 (2026-10-20)

From the figures research (a robot of rigid hard-surface pieces on Half-Life's soldier, its parts made in plain
JavaScript), the tools that are not about that one robot:

- **`addBodypart`** and **`putRigid`**: a bodypart added after the others, whose base keeps every body number the
  model had (each shows what it did, and the new bodypart's first submodel); and pieces each on one bone laid into
  as many such bodyparts as the engine's 2048 points and normals a submodel need. A robot of 528 pieces on the
  soldier went in as three bodyparts beside its own, every animation kept, nothing stretched.
- **`solids`** (src/solids.mjs): convex solids in plain JavaScript, no Blender: boxes cut and bevelled, plates of
  any convex outline, prisms, cylinders, rods, beams, faceted balls and lofts on a place, made into triangles that
  face out, with their planes, their points counted and a check that they close. `inset` no longer turns a
  rectangle moved in past its middle inside out (the research's own kept it, at its full size the other way).
- **The kitbash kit** (kits/kitbash.mjs): 45 parametric hard-surface parts of those solids, a bolt to a motor,
  each `PARTS[name](place, size, rnd)` set on a surface, the same for the same seed (`seeded`), grouped by what
  they suit (`SETS`), within a reach their size gives them (`REACH`).
- **`findPiston`** (src/linkage.mjs): a telescopic piston across a joint, its cylinder on one bone and its rod on
  the other, anchored where the rod strays least from the cylinder through the animations, and sized to stay in
  it. On Half-Life's soldier it finds what the research's own found, and says what that one passed over in
  silence: two of the animations it was given are kept in another file and were never posed (`skipped`).
- **`motionOverlaps`** (src/wear.mjs): rigid convex pieces on bones that the animations drive into each other,
  how much deeper than they stand as built, frame by frame, each pair told as on bones next to each other (a
  joint's own parts) or apart (a fault); only pairs whose spheres meet are measured. 436 of the robot's pieces
  through the soldier's walk and run in under a second.
- **`unwrap`** (src/unwrap.mjs): pieces laid out on one picture as their own nets, unfolded about their edges at
  one texel density, packed by their shapes rather than their boxes, every corner on a whole texel; a left and
  its right on one set of texels (`share`), a piece of the middle by its one half (`mirror`); `withUV` puts the
  places on the corners for `putRigid`.
- **Blender, where the machine has it** (src/blender.mjs, the kit's one outside program, and only for this):
  `findBlender` (the program given, `SMAK_BLENDER`, the usual places, the PATH), `runBlender` and
  `runBlenderJob` (a script headless on a JSON file), `readFloatMap` (the float pictures it writes), and
  `bakeMaps`: a detailed copy's colours, occlusion and normals baked onto a plain one's picture, selected to
  active. Its test bakes a cube and runs only where Blender is found.

Of the research, the mech grammar, the hard suit, the paint's composing and the markings stay in it: they are
one robot's, not the kit's.

- **`buildMdl({ skins })`**: skin families after the first, each the textures it changes by the name of the one
  each stands for (of the same size); a script or an entity shows family n with skin n. A bought character in
  liveries of its own (the Old Orchard's militia) is one model, not one a livery.

From Steven Linn's fork, [stevenlafl/smak](https://github.com/stevenlafl/smak), taken as it was or ported:

- **SDHLT** (seedee's fork of VHLT) is found by its own names (`sdHLCSG_x64.exe`, `sdhlt.wad`), and its leak and
  wadinclude lines are read. A map's own `wad` key is read again (its pattern had lost its backslashes).
- **No map is written with an entity that precaches a model it does not name** (`env_sprite`, `env_glow`,
  `cycler_sprite`, `monster_generic`, `monster_furniture`): the game stops on load with `PF_precache_model_I:
  Bad string ''`. `checkPlan` and `checkBsp` name it in maps made elsewhere.
- **The compilers' marks as VHLT and SDHLT 1.3.1 compile them**, measured: SKIP, SPLITFACE, NOCLIP and NULLNOCLIP
  leak (NOCLIP and NULLNOCLIP in the hulls a player moves in), SOLIDHINT and BEVELHINT seal and stop a body. The
  plan check took SKIP and NULLNOCLIP for walls; the walk test SOLIDHINT for air and NULLNOCLIP for a wall.
- **The walk test rides a lift** (`func_plat`) either way, as a ladder in its shaft; one with no name whose end
  has no floor near it, or no room for a player, is warned of.
- **A class's flags are joined with its bases'**, as Hammer joins them: the kit's doors are no longer warned of.
- **A carved wall's texture stands on the floor of the room it faces and starts at its corner** (`onFloor`), in
  `carve` and in `carvePlan` (sketches, natural maps) at any angle. In `carvePlan` the rock stacked under a floor
  had kept the sides of the band that sees nothing, so its walls lined up with no space.
- **`soundness` and `seeThrough`**: a model's shape checked for holes, faces turned inside out and pieces
  floating apart. `workshop`'s band once round a shape closes. `sheet()` keeps a framing it is given. A bone at
  exactly half a turn survives a rewrite of the animations.
- **`reduce`** (src/qem.mjs), the quadric reducer: a shape brought to fewer triangles, closed, its border and its
  picture's charts kept; `keep` holds points where they are.
- **`--triangles <n>`** on `smak import` and `smak item` (`triangles` to `importModel`, `importPiece`,
  `importRigged`; `fewerTriangles`): a bought model brought down first, each mesh and material by its share, the
  points where two materials meet kept so no crack opens; `report.fewer` says how far it got and why it stopped.
  A spear of 11430 triangles to 1216, a rigged archer of 1080 to 618 (docs/IMPORT.md).
- **A rigged character is held to the game's monsters** (`importRigged`, the idea from the fork's character
  checks): where its feet stand as its first animation begins, warned of 6 units off the floor (a bought troll
  kept its file's origin at its hips and stood 37 under it; -36 is named as a player's model's place), and its
  triangles against Master Sword's own monsters and people of its size, warned of past three quarters of them
  (`report.feet`, `report.kin`, `CHARACTER_TRIANGLES`).
- **`smak map-decompile`** (`decompile`, `textureFidelity`, `lightParity`, the texture-light table): a compiled map
  made back into brush source, the port of Steven's bsp2map. Master Sword's maps come back and compile again with
  SDHLT, their faces in the original's textures 91 to 100 in 100; a texture in no shipped .wad has to be given.
- **Videos, GIFs and a map against a picture** (Steven Linn's fork): `smak build` of a `smak.video/1` spec (shots
  of models and maps: a title, a turntable, a sheet, the animations, a walk, a flyover, a path; a contact sheet
  with `--preview`, then MP4 through ffmpeg or a GIF written by the kit without it); `smak gif` (an animation, or
  every one, as a looping GIF); `smak map-overlay` (a map's edges over a picture of it from a camera, green where
  they lie on its lines, the faces that are off by how much, `--locate` the camera found by the edges). Its
  photogrammetry (features, PnP, structure from motion in Python venvs) is not taken.
- **Maps from a spec** (`smak build`, `smak.map/1`; Steven Linn's fork, `buildMapSpec`): rooms laid out by words
  (or a drawing, or a floor plan of height plans) carved from one block, doors, openings, windows and stairs with
  railings between them, buildings in the open, furniture that never floats, the kit's 30 pieces of furniture as
  models (`kit:<name>`), ladders, frames, banded walls, composed light, a landmark seen from each way in, its own
  .wad, sky, sounds and music, modules taken in; checked, walked, compiled when VHLT is found, swept, measured
  against Valve's dressing, drawn, and told against the last build. The map in a folder of its name.
- **A mod's map from a spec** (`"mod"` in a map spec, or `smak build --mod <profile>`): its places to start are
  the mod's, stood on the floor, and the plan and the walk test go by its classes and rules; its folders are where
  the game's .wad files and models are found; a profile's `spec` gives the game's own textures, the class a prop
  is and rooms furnished by their `use` with the game's models. Master Sword's profile has one: ms_generic.wad's
  flags, laid stone and planks, env_model props, and a tavern, hall, store, bedroom, kitchen, library and crypt
  furnished with its tables, barrels, shelves, hearth, beds and urns (ROOM_THINGS).
- **`standingIn(map, box, { by })`**: what stands in a box of a map, moved: a map spec's building taken out of its
  yard (its shell, roof, door, furniture and props; not the yard's rock, starts or sun) and set in a map made
  another way with `mergeMaps`. A building's rooms dressed by their use are no longer told they are bare.
- **Models from a spec** (`smak build`, `smak.model/1`; Steven Linn's fork, `buildModelSpec`): parts placed by
  what they sit on (boxes, turned parts, tubes, superquadrics, bands, studs, the kits' weapons, prefabs), a
  character on a game's skeleton keeping its bones and animations and held apart in its run, walk, crouch and
  jump, a weapon in place of a game's in its v_, p_ and w_ files, a body carved from pictures' outlines or
  blended as one surface, pictures projected onto it, a finish of wear and grime; checked for holes, parts that
  float, triangles past Valve's, and told against the last build. A sheet of `sheet`'s carved from is read with
  its three-quarter view: taken for the underside, a box was carved again finer for seven minutes and 4 GB.
- **`smak build <spec.json>`** (docs/SPEC.md): a spec built by its kind. `smak.wad/1`, from Steven Linn's fork
  (`buildWadSpec`): textures for maps painted from materials or photographs (filtered to Valve's range, laid as
  they are, or aged), with panels, words, grime, wear and relief, made from one another or lifted off a map's
  view; a .wad and a sheet of them, and with `preview` the map drawn wearing them, each where it shows best.
  `smak.sound/1`, `smak.music/1` and `smak.sprite/1` as their own commands.
- **PNG of every kind read**: 16 bits a channel, 1, 2 and 4, interlaced, a see-through colour. Of the 2856 PNG
  files of the bought packs, 145 could not be read; all 2856 now read as Pillow reads them, pixel for pixel.
- **From the spec builder's ground** (Steven Linn's fork, the parts that stand without it): `smak map-fgd` (an FGD
  from a mod's C++ source: each class `LINK_ENTITY_TO_CLASS` makes, with the keys its `KeyValue` and its bases'
  read, joined to its FGD and maps), `smak map-dressing` (a map's dressing beside Valve's campaign, measured),
  `smak map-sweep` (drops that hurt, lights in mid-air), `smak map-heights` (a height plan, layer by layer),
  `smak contract` (what a mod's code asks of a model by name or number, and what a model breaks of another's),
  `map-views --aim` (views aimed at the water, the lamps, each storey, a landmark; none facing a wall).
  `carve` takes a room's `bands` (a wall's textures stacked up it, joined on brush edges) and `wears`; the
  compilers are told how many threads to use and their limits are read; a map in a mod's `maps/` finds its .wad
  files in the mod's folder; Half-Life leaves a map by its level changes; `bestTurn`'s `upright`; `clearModel`;
  a plate's and a sword's ends closed; `allot` packs tallest first; `soundness` names parts that nearly touch.
  `familyOf` of wiring.mjs is now `doorFamilyOf`: `familyOf` is a wall texture's family (families.mjs).
- **`smak sound <spec.json>`** and **`smak music <spec.json>`** (`buildSoundSpec`, `buildMusicSpec`,
  `smak.audio`; docs/SOUNDS.md): sounds made of layers (noise, shaped noise, tones, FM, struck modes, particles,
  recordings) with a room, saturation, a limiter and a fit to their bands, checked as the engine needs them and
  measured against the game's own of their kind; a recording made a track levelled by loudness, an MP3 under
  media/ or a looped WAV. `writeWav` writes a file `readWav` read to the same bytes: Half-Life's and Master
  Sword's sounds at the game's rates are written again byte for byte.
- **`smak sprite <spec.json>`** (`buildSpriteSpec`, `writeSpr`; docs/SPRITES.md): sprites made of layers of
  effects (glow, flare, fire, smoke, explosion, billow, blobs, sparks, ring, beam), written as `.spr` with a sheet
  and an animated picture, measured against Half-Life's own of their kind. `readSpr` keeps a file's groups,
  radius, beam length and sync: Half-Life's and Master Sword's 198 sprites are written again byte for byte.
- **JPEG read whole** (`src/jpeg.mjs`, in place of the baseline-only reader): progressive, CMYK, the EXIF
  orientation; `unpicture` reads PNG, BMP or JPEG, and `textureFrom` takes JPEG.
- **`scripts/no-game-files.mjs`**: every tracked file (`--history`: every version ever committed) held against a
  game's folders by bytes, texture pixels and sound samples.

**Mind**: a map with one of those entities and no model is now refused by `writeMap`. Carved rooms' walls take
new texture offsets: a map rebuilt with `carve` or `carvePlan` (a sketch) has its wall pictures moved to line
up with each room.

## 0.20.0 (2026-10-19)

What Master Sword Rebirth's Thornlands showed an outdoor map wants (the orchard's second version, built with it).

- **`cliffWall`** and the sketch's **`cliff`** key: an outdoor space's rock made cliffs of large faces leaning
  back at angles of their own, two facets to a piece meeting in a ridge, some bent half way up, some with a
  scree; the skyline uneven, never under the horizon. `sketchMap(..., { clear })` keeps their feet off houses
  and doorways. Rough walls and cliffs find the rock along a side by one function (`rockSides`).
- **`backdropModel`**: the land round a map as one studio model, a ring of hills from just outside its walls to
  the far distance (fields and hedges, woods, haze of a colour given), seen over the walls: the engine draws a
  model over the sky's faces. Two bodyparts, each under GoldSrc's 2048 points and normals.
- **`reliefOf`** and the sketch's **`relief`**, **`bank`** keys: ground that rises and falls, hummocks and
  banks against the rock, level where a space opens and in the `clear` boxes; on a slope, a bank in place of
  a flat ramp. `sketchMap`'s result tells the ground's height anywhere (`groundAt`) and holds each space with
  its rock and ground (`places`).
- **`scatter`**, **`boulder`**, **`card`**, **`STREWN`**: grass, flowers, ferns, bushes and stones strewn as
  the game's own maps strew them (read from them: clumped, thicker by the rock, so many to the floor), and a
  fringe of grass along the rock's foot. The fringe takes several rows: a forest's edge of single trees,
  flat and overlapping, and lines of trees before them (`textures`, `keepShape`, `tile`: a picture kept in
  shape and repeated along a long card).
- **`trail`**, **`smoothLine`**: a path worn into the ground, a ribbon over it wearing a picture of a path
  turned to run along it, its corners cut, its middle over the ground and its edges under it.
- **`reliefOf`**'s **`patches`** and the sketch's **`patch`**, **`patchShare`** keys: the ground's triangles
  painted with another ground over a share of the floor, where a noise is highest.
- **`ambience`**, **`HEARD`**: looping sounds strewn over spaces as the game's wild maps have them (so many to
  the floor, a wind heard far at least once, birds by the wood). **`learnDetails`**, **`detailText`**: what
  detail texture the game's own `_detail.txt` files give each texture, and a map's file written from that.
- **`solid`** (from points): two faces all but in one plane (a crease of a hundredth of a degree, from corners
  rounded to whole units) are made one; the compiler refused such a brush ("coplanar faces"). Cliffs met it.
- **`scatter`**'s fringe: a picture too wide for a short side stands across it, past its corners, instead of
  being left out (a forest's dark wall showed there).
- **`dressRoom`**: a carved room dressed as the game's interiors are (measured room by room in 60 of its maps):
  a battered base, a moulding, beams on corbels or pilasters and columns, a pitched ceiling with tie beams, an
  inlaid floor, a dais, torches with fire and light, webs, moss and chains, and the things of its use (hall,
  store, bedroom, kitchen, library, crypt) kept off its doorways. **`INTERIOR_SETS`**, **`pickSet`**,
  **`chamfered`**: interiors' textures from ms_generic.wad, a room's picked by its seed; corners cut back.
- **`dressRoom`'s `gallery`, `spots`, `doors`**: a second level in a room (a ledge up a wall, on posts, railed,
  its stair along the wall with open floor before its foot; `loose` gives the steps back to be made to rise);
  places by the walls kept for a builder's events; the base stopped at doorways and nothing hung or stood in
  them. The torches are the game's own wall torch (**`TORCH`**, **`TORCH_SCALE`**), as MSC's maps hang it.
- **`house`**: a town's house the way the game's towns build them (deralia, edana): a footing, brick under, a
  jutting storey of timber and plaster over, windows painted on its facade pictures and fitted whole, a roof of
  the kind's slope with eaves, gable, ridge and sometimes a chimney, a door of the kind's size with frame and
  steps; places by its walls and over its door for what a town puts there. **`fence`**: posts and rails of
  wood along a line, on the ground.
- **`SIZES`**: what a door, a step, a roof's pitch, a room's height and a way's width come to in the game's maps
  of each kind (read from 92 of them); **`ruin`**: a ruined house of broken walls sized by them, its door's
  gap facing the way it is turned, stones fallen about it: a landmark to walk to.
- **`brokenWall`** on a slant: its pieces' sloped tops stay in one plane (their corners were rounded one by
  one, and a brush was refused as not convex).
- The sketch's sky stands over its cliffs' tops (it stood 128 over the highest floor or ceiling given, and cut
  the cliffs off flat at it), and over the **`sky`** key's height: room for tall trees.
- **`drawMap`** gives each pixel's distance, whether it shows sky and which texture (`depth`, `shows`,
  `named` into `names`): what a player sees, measured.
- **`drawMap`** makes the smaller sizes of a texture with holes from its largest where the .wad's own lost
  them (MSC's `{ms_tree04` to `08`): a far tree was drawn as a dark box, where the engine, which makes its own,
  draws a tree (`shrunkWithHoles`).
- **`learnEntities`** of a folder that is not there (a mod's overlay given first to `map-viewer --game`) learns
  nothing, where it stopped the viewer.

## 0.19.1 (2026-10-17)

What the first draft of a map twice the orchard's size, drawn as a hill of terraces, found.

- **`horizon`** (a space's key, and a sketch's): the rock round an outdoor space stands this high over its
  floor, and sky is over it, so that the ground looks out over a land beyond and not up a cliff to the top
  of the map (each space its own: a terrace's horizon is over its own floor). Rock that no space sees over the
  lowest horizon is sky too, or it would hang in the sky its neighbours became.
- **The sky no longer takes the ground**: a face of the carved block that looks at no space (its underside)
  wore the carve's ceiling texture, `sky` in an outdoor map's legend (MAPS-SKETCH.md's own example), and the
  brush with it became sky all round: the ground under every outdoor floor was sky.
- **A ramp at an angle** (`slope` on a turned outline) had its top corners rounded off its own plane and was
  refused as not convex.
- **Two outlines crossing a hair from a corner** left a piece of rock that twisted on itself (VHLT: "brush
  outside world"): cuts nearer than half a unit are one, the whole one kept, and a piece ends where its two
  lines cross.
- **`terrain`** of a length that is no whole number of steps made a last column a hair wide (rough rock along
  a wall at an angle failed with "a face with no area").
- **The map viewer**: a compiled face whose first three corners lie in a line (the compiler puts corners
  along edges) was wound either way, so floors showed in patches with the ceilings hidden; "Ceilings and
  sky" hid only some of the sky; the near plane moves out with the camera, so a map seen from far off keeps
  its floors.

## 0.19.0 (2026-10-17)

Ground that bends, and a map from a drawing. The study of the game's maps measured what made the kit's maps
read as "all straight lines": `carve` cut only boxes, no brush could be turned, rock was a floor only. The
owner asked for a way to sketch a map's shapes and have the kit build them.

- **`carvePlan(spaces, wall, texture)`**: `carve` for spaces of any outline in plan (concave, with holes,
  several that overlap), carved from one block of rock so that the map cannot leak. The rock is cut in strips
  at every corner and crossing and joined again into convex pieces; each face wears the texture of the space
  it is seen from; planes are written through the outlines' own whole points. A brush with a face of sky is
  sky all round (VHLT took a brush of sky and stone for neither: the map compiled with no inside and no light).
- **`path`, `curve`, `circle`**: a street or a track along a line, mitred at its corners (a tight bend's loop
  cut off); a smooth line through points; a round outline.
- **`turned(brushes, degrees, pivot)`**: brushes turned about an axis, their pictures with them.
- **`terrain({ axis })`**: rock stood up, a cliff's face or a cave's wall.
- **Pieces made to measure** (`src/maps/pieces.mjs`): `spiralStairs` (refused with no headroom under the turn
  above, a step over 18 or a tread too narrow), `bridge` at any angle with rails and piers, `railing`,
  `balcony`, `brokenWall`, `rockWall` (rough rock along a line, its pictures laid on each face).
- **Sloped floors**: a space's `slope: { rise, toward }`; `convexPieces(space)`, `slopePlane(space)`.
- **Drawn again, the hand's work kept**: `additions(edited, made)` finds what a person added in an editor
  (by the brushes' planes); `smak sketch` keeps it when it writes the map again (`<name>.smak.map` is its
  copy); `mergeMaps`.
- **The map viewer** (`smak map-viewer`, `viewer/map.html`): a .bsp, a .map or a sketch in 3D in the browser,
  textured and lit, its entities as their models with the way each faces, floors coloured by height, ceilings
  and clips hidden or shown, reloaded as the file changes. `sceneOf3d` makes the scene.
- **Things held against the world** (`propsOf`, `smak map-props`): stuck or buried in solid, floating,
  standing on another model, the nose to a wall; warnings and notes apart; `--views` a picture of each.
- **A map from a drawing** (`docs/MAPS-SKETCH.md`): `readSvgSketch` (Inkscape: labels and layers as keys,
  paths, curves, arcs, holes, transforms, a stroke as a corridor), `readPngSketch` (Paint: a legend of
  colours, black lines as walls, colours painted side by side joined), `sketchSpaces`, `sketchMap`, and
  `smak sketch <svg|png> -o out.map --legend legend.json`. Keys `slope`, `toward`, `rough`; kinds `spiral`
  and `bridge`. `examples/sketch/` has a village, a Paint drawing and every piece in one.

## 0.18.2 (2026-10-17)

- **Stairs that are walked, not climbed.** `stairs(..., { ramp: "CLIP" })` adds a wedge laid on the steps'
  nosings, from one tread before the first riser to the top: a player walks up it smoothly, shots and grenades
  (which CLIP does not stop) still meet the steps. Where the box has no room before the first riser the ramp
  stands on a lip of one step there. Found when Havoc9 played a city built with the kit: its box stairs were
  "hard to navigate"; their own cities' stairs are box steps too (16 high, treads of 23 to 45), with no ramps.

## 0.18.1 (2026-10-17)

- **No more than 32 switched lights.** `checkPlan` refuses a map whose lights carry more than 32 names: hlcsg
  gives each its own light style from 32 to 63 and stops with "Exceeded MAX_SWITCHED_LIGHTS" (found building
  a city of 40 flats and shops, each with a lamp switch); under it, it says how many of the 32 are used.
  docs/MAPS-DESIGN.md: switches are rationed in a role-play city.

## 0.18.0 (2026-10-17)

A second game's maps. The kit was made on Master Sword; it was turned on The Specialists and on three
role-play cities of its Havoc9 community (Paradise City, Xenon City, Alexandria), to say what makes them good
and to build one like them. A block was built, wired and compiled in two seconds; what the kit read wrong or
could not say on the way is mended here.

- **Switched lights count as the map starts.** A light with a name gets a style of 32 or more, and Half-Life
  starts it on unless its spawnflags have 1 (CLight::Spawn). `map-light`, `map-character` and the views
  counted every switched light off, so a city whose every flat has a lamp switch read black (a flat lit in the
  game: "dark, mean 2.6"). `stylesAtStart(bsp)` and `stylesCounted`; `lightReport`'s `switched`
  ("start", "off", "on"; `map-light --switched`); the views' `light` takes "start" (the default) and "off".
- **What a map is wired to do.** `wiringOf(map)` and `smak map-wiring`: its properties (the doors by name,
  and their families: `resident x9`), each switch and trigger followed through multi_managers and relays to
  what it works (lights, sounds, lifts, doors, places that heal or hurt), its trains and their stops, a name
  said from many speakers (an alarm), teleports, what comes back after it is broken; and the slips: a switch at
  a name nothing answers to, a train that runs off its corners for good. Works on a .bsp and a .map.
- **The Specialists' profile** (`profiles/specialists.mjs`), from the installed game: its starts, its
  `ts_model` props (a city's props were counted 0), the FGD's door `delay` mended to a number with a fraction,
  and two sets of figures, the game's 29 arenas and the Havoc9 cities (`specialists-roleplay.mjs` for the
  command line). docs/MAPS-DESIGN.md has a section on the role-play city: wiring, density and dressing, not
  shape.
- **Rooms carved in their own textures.** A room given to `carve` may bring `texture`: the rock it is seen
  from wears it, and a slab under two rooms is cut where they meet. A street of brick and asphalt and a shop of
  tiles behind one wall is one carve.
- **map-measure eight times faster on a large map** (Xenon City: 86 s to 12 s). A compiled map's space finds
  where a line of sight stops in one walk (`firstStop`), where it was asked by halves.
- **map-views looks where something is.** Its "largest rooms" are rooms with entities in them first, then
  those with a floor: on a city the largest empty leaves were the air under its sky and black voids.
- `map-character` takes folders, as its help said (each was refused); its table keeps its columns apart; its
  warning no longer says Master Sword's maps of any mod's.
- `embeddedTexture` gives null for a name the map lacks (one name looked for in several maps), as the docs
  said; a number it has none for is still refused.
- Master Sword's `character.figures` measured again for the light (47 of its 94 maps have switched lights):
  shadow 17-55, brightest 188-250, mean 29.9-78; the rest is as it was.
- New: src/maps/wiring.mjs, profiles/specialists.mjs, profiles/specialists-roleplay.mjs, test 56.

**Mind**: the light of a map with switched lights is brighter than before in `map-light`, `map-character`
and every view, and a view's words say so. `--switched off` and `--light off` give the old count.

## 0.17.0 (2026-10-16)

Maps a player likes. A player walked the first two maps an agent made with this kit and said the items were good
but the maps not: one "all straight lines, nothing unique", and in the other monsters that appeared in front of
him, wolves and boars of one terrace that fought each other, and the reward back at the start. The game's own
100 maps were measured with the kit, eleven read closely, and what they do is now a guide, two checks and a kit
of recipes.

- **How a map's monsters come.** `spawnsOf(map, { mod })` and `smak map-spawns`: each spawn area, how it comes
  (at the start, on arrival, fired) and by what (a trigger walked into, a button, a breakable, a death, an area
  cleared, a script), followed back through relays, counters and multi_managers. It warns of monsters a player in
  the trigger that brings them could see appear (a clear line through the world, closed doors and the brush
  entities that hide), of monsters back at their own spot within a minute of dying, of races that attack each
  other on one spawn, and of a reward far from the death that brings it; `-o` draws a line from each trigger to
  each monster seen from it. Its warnings are also `map-check --mod`'s. The profile's new `spawns` says how a
  mod's spawn areas work; Master Sword's reads its races from the pack's races.script and each monster's script
  (`raceTable`, `raceRelation`, `scriptRace`), and the names a script fires (`usetrigger`).
- **A map's character in numbers.** `characterOf(bsp)` and `smak map-character`: walls off the grid, floor that
  slopes, floor levels, the spread of the floor's height, textures, props, sounds, music, lights, and the floor's
  light, its shadow and its brightest; held against the mod's own maps (`characterAgainst`, the profile's new
  `character.figures`): a PLAIN line for each figure on the plain side of their middle half, and a warning on
  five or more. `learnCharacter` (`--learn`) makes the figures from any folder of maps; Master Sword's profile
  carries those of its 94 maps.
- **The guide**: docs/MAPS-DESIGN.md, the rules of thumb for shape, height, landmarks, light, dressing, a map's
  own touch, monsters, races and rewards, with the game's numbers.
- **The recipes**: kits/encounterkit.mjs, `recipesOf(mod)`: an area filled ahead out of sight, areas filled on
  arrival, a breakable that releases monsters, waves, things counted that open a way, a reward where the fight
  was won, a chance and one of several at random (the profile's new `recipes`).
- `planOf` and `planOfSource` take `lines`: lines of one's own over the plan.
- New: src/maps/encounters.mjs, src/maps/character.mjs, kits/encounterkit.mjs, docs/MAPS-DESIGN.md, test 55.

**Mind**: `map-check --mod` with a profile that has `spawns` (Master Sword's) now says the encounters' warnings
too: a map that passed with no warning may now have some. `checkEntities(map, { encounters: false })` leaves them
out.

## 0.16.0 (2026-10-16)

A long run that goes on, and a fight that knows what it cannot reach. A run of 98 minutes through two maps, from
one map's door to the next one's last chest, lost most of its time to an enemy no blow could reach (a wolf in a
fenced pen, a healer that kept away, a spider beyond a crowd), to waits for lines already said, and to putting
together by hand what a run of many parts needs. And a fighter with only a sword cannot finish a map whose enemies
fly or stand on a ledge: a test character now carries a bow, and the fight draws it.

- **A fight that knows what it cannot reach, and shoots it.** Each enemy's time spent with no blow landing and no
  step nearer is kept, and past `stuck.after` (30 s and four rounds) he is unreachable for every fight until a map
  loads. The log says `N rounds on an unreachable Wolf at (780,1322,0)`, and `stuck.then` decides what follows:
  `skip` (the profile's new `play.target.skip`; Master Sword's `trial skip`), `fail` (the run stops naming him and
  his place), `goto` (the player is put beside him) or `ranged`.
- **Ranged weapons.** `ranged: { item, slot, when, hold, near, above, speed }`: the character's bow or spell is
  drawn (the profile's new `play.ranged`; Master Sword by quickslot, a spell by `prep`, and `trial hands` asks
  whether it is held). He is aimed at in yaw and pitch, higher for the shot's fall, each shot a little over or
  under the last (a game leaves an arrow stuck in its target). The button is held for the draw and let go, and the
  weapon is put back when he comes within `near`. `when` is `"unreachable"`, `"flying"` (more than 64 units over
  the eyes) or `"always"`. Seen in the game: a fighter shut in a pen shot a sentry 520 off over the fence (13 hits
  of 28), then struck down a wolf with the sword. The test characters carry a Thornbow (fighter20) and a Longbow
  (fighter6) with arrows.
- **An end by quiet without the line fails**, unless `quietEnds: true`; either way a line says so.
- **A census.** The profile's `play.census` (Master Sword's `trial census`) answers a `{ "census": radius }` step
  with a table, and a census done by itself ends the sentence of a run stopped by an `until`, a fight without its
  line or `stuck: "fail"`: `left: Wolf 114 hp at (780,1322,0), 1 of 1`.
- **A stuck player.** A `walk` that moves him less than 2 units stops the run (`did not move after walk N ms: in
  solid?`), and `goto` asks the profile's `lift` over its place (Master Sword: 4), so he drops onto a path brush
  instead of being set into it.
- **A long run that goes on, and is added up.** A step looks back as it begins: a `fight` whose line was said
  before it ends at once (`"already": "pass"`, a fight's unless told; a ledge fight had waited 600 s for a line said
  a minute earlier), a wait warns (`"warn"`), and a run stopped by an `until` says when its line was heard before.
  `{ "section": "name" }` parts one file of steps: each section timed and counted, and `run({ from })` /
  `--from <section|step>` begins at one (with `--stay`, after a failure). `"onFail": "continue"` makes a step's
  failure an expectation and goes on. `"keep": { "hp": "= ([\d.]+)" }` keeps a value that a later step names
  `${hp}`. `{ "travel": true }` goes through a way to another map (the profile's new `play.travel`: Master Sword
  `accept` and "Spawn Server: <map>"), and a session follows its map by that line. Each run writes summary.json:
  per section and per fight, time, heals (a `trial heal` outside a fight too), deaths, hits taken and dealt, the
  slain, its expectations; `chain` adds up the runs that stayed. `summaryOf`, `summaryLines`, `totalsOf`.
- **What the game would cut.** The script check takes a profile's `lint`: Master Sword's warns of a `desc` over 72
  characters and a `name` with a prefix over 29 (shared/ms/scriptcmds.cpp). Six of a mod's item descriptions were
  found cut.
- In msr-web's tools/playtest.mjs: the trial commands, and our built map, in every map a way of the run's map leads
  to; `--define script:NAME=value` (a test copy at pack time, for a hand copy); a folder per run (`<name>/<time>/`,
  failed ones never deleted); `--detach` and `playtest wait`.
- New: src/play-fight.mjs, tests 53 and 54.

**Mind**: every fight now finds and passes over an enemy it cannot get at after 30 s (`stuck: false` for the old
way). A walk into a wall, or from inside one, now stops the run. A fight with `until` and `quiet` that runs out of
enemies without its line now fails (`quietEnds: true` for the old way). A fight that stops the run still writes its
`fight` line. A step whose `until` line was said before it began now behaves otherwise: a fight ends at once (give
`"already": "wait"` for the old way), a wait writes a WARN line. The lines an `until` stopped at are the session's,
not one run's: a run that stays never stops at a line an earlier run's `until` took. A run's result has `sections`,
`summary` and `summaryFile`. After a change to SMAK, stop the session and serve again.

## 0.15.0 (2026-10-15)

Re-skins in one step, and a fight that chooses and moves. Agents making a map's monsters found that a body made
from nothing reads as crude beside a game's own, and that the person wanted the game's models re-skinned: this
version makes a re-skin a short list of rules. And a fight played by one step could not go for a healer first,
walk round a crowd or step out of a marked circle, so every reading of difficulty was a worst case.

- **Re-skins in one step, and composing on a bought rig.** `reskin` repaints a game's model by rules (in a script
  or `smak reskin`): a rule recolours a hue keeping the shading, darkens or tints, rusts, mosses, dirties or greens
  by place on the body, or paints, kept to textures, islands, colour ranges, pixel boxes or places; each changed
  texture comes out before and after. `ownPixels` gives an island, body or mesh a texture of its own copied from
  the pixels it wore, so one plate of an armour whose one rust covers every plate can be marked alone.
  `addSequenceFrom` and `smak sequence-add --from x --frames 80-57` make an animation from another's frames,
  forward or backward. `importRigged` returns `parts`, so a bone and a piece can be added before `buildMdl`.
  `animate.reach` takes `aim` and `grip`; new `animate.hold` keeps a bone at its own turn in the model,
  `animate.grounded` lifts falls onto the floor; the quaternion helpers are exported. `workshop.skinned`,
  `zoneOn`, `span` hold the scarecrow's tubes and lofts. `check --source` marks warnings the original also has as
  inherited. `--yaw`/`--pitch` now turn front/side/top views. Texture flags are documented (flag 4, full bright:
  Xash honours it; GoldSrc not known). New: src/reskin.mjs, src/skinned.mjs, tests 46-49.
- **Long runs, and files changed while the game is up.** `attachSession` reads a run's answer by `node:http`,
  with no limit of time; the server sends its headers at once and a `{ beat }` line every 30 s of a quiet run
  (`serveSession({ beat })`). A run of over five minutes used to end in the attaching process with
  `FAILED: terminated` while it went on in the game; runs of 10 and 11 minutes now say their real result.
  `smak play --serve --over msc=<folder>` marks a folder laid over the game's files, and each `--attach ...
  --over` puts what changed in it since (`playSession({ over })`, `run({ over })`).
- **A fight that chooses and moves.** `prefer: "lantern"` (or a list) goes for that kind first, by the profile's
  new `play.target.prefer` and `unprefer` (Master Sword: `trial prefer {word}`); one that cannot be got at is let
  be for 20 s while the nearest is fought. With `chase`, the bot sidesteps round others in the way (`sidestep`,
  600 ms or `false`), walks at a far enemy as long as the way takes (up to 1.5 s a round), swings no blow at the
  air, and strikes three blows a round in reach. `dodge` steps away from a place a line warns of (a test copy's
  line: the game shows a sprite). The fight line gains preferred kills, sidesteps and dodges. In a map's bay
  with a healer behind a guard, all of it now dies (nothing did); a boss's marks struck 19 of 41 times with
  `dodge`, 31 of 32 without. A fight whose time ran out on a chase step is "ended by its time". `block` is not
  made: Master Sword says nothing before a blow lands.
- **A band left empty on purpose.** The `bands` rule takes `open`, a key naming ranges a place leaves empty
  (Master Sword: `reqhp_none "150;500"`): the check names only true faults (a map's 18 warnings to 0, its
  monsters unchanged).
- New: tests 50-52.

**Mind**: a named view given a yaw or pitch no longer ignores it. `ownPixels` renumbers islands (the moved
  ones last). Moved triangles are written as strips of three (more corners drawn). Fights with `chase` read otherwise than in 0.14 (sidesteps, longer walks, three
blows a round). A fight runs in the serving process: after a change to SMAK, stop the session and serve again.

## 0.14.0 (2026-10-13)

Bought models, and a fight played by one step. A person's folder of bought low-poly packs (some 1750 .fbx,
1600 .glb, 1150 .obj) is now read whole; a bought mace, shield and bow went into a game's own weapon files with
`check` clean, and a rigged zombie came in with its skeleton and both its animations. And the faults agents met
building a second map with 0.13 are mended: a fight is one step, a wait no longer misses a line, a map is
measured beside the game's.

- **Bought models.** `readFbx` (binary FBX 7.0-7.7 with zlib arrays, and the text form) and `readGlb` (.glb,
  .gltf with its .bin) read meshes, texture coordinates, normals, materials and their pictures, every node's
  place, the file's axes and units, skins and animations into one shape, which `readObj` now shares through
  `importedObj`. `importModel` makes a prop of it at its true size, or `fit`; `importPiece` makes a piece for
  `addItem` (a haft, a shield, by outline; its grip found or told); `importRigged` makes a model with the
  file's bones and animations, each point on its heaviest bone. `unjpeg` reads baseline JPEG. Commands:
  `smak import <file|folder>` (what is in it; `-o` a prop; a folder: props, sheet.png, import.json; `--anim`),
  and `smak item` takes a .fbx/.glb/.gltf/.obj in place of a piece module. Checked against Blender 5.2 and
  against the same models shipped in two formats (docs/IMPORT.md).
- **A fight played by one step, and steps that repeat.** `fight` faces the nearest living enemy (the
  profile's new `play.target`: commands and the line that answers, or a function) and strikes
  (`play.fight.attack`), heals under a share of health (`play.heal`), puts a fallen player back at `post`, and
  ends by a line, a time, or when no enemy is left (`quiet`). What happened (seconds, blows, hits dealt and
  taken with their sums, heals, deaths, the slain, enemies at once and on the player, the least health) is a
  `fight` line of the log and `fights` in result.json. `repeat` runs a block until a line, a count or a time.
  `faceAt` turns to a place, or to `"target"`. `tap` presses and lets go; a held button only charges a blow in
  Master Sword. A wing of 14 monsters fought by an outside loop guessing where to face took about 14 minutes
  and died 11 times; by one step file, 6 minutes and none.
- **From where an `until` hears.** A step that does a thing hears from its own beginning; a wait hears from
  the last step that did a thing, so a line said in the same instant as the one before, or during its wait,
  is no longer missed. No `until` stops at a line another stopped at. `since` goes on `until` too (and
  `"deed"`).
- **A run that stays stays**: `stay` with `put` no longer leaves the map.
- **The walk test says how much of the floor it walks, and why not the rest**: `reach.share`, `standable`,
  and `parts` (each part not walked, `how`: jump, crouch-jump, crouch, wall, air, none; the brush entities in
  the way by name; the walked floor nearest). Ladders off the grid are climbed, teleports followed by every
  way it tries, `walls: "gone"` (`--walls`) for what breaks, toggles or is pushed. A body is asked for by name
  (`bodyOf`). With `mod`, a list given adds to the profile's.
- **A map in numbers, beside the game's** (`maps.measure`, `measureTable`, `smak map-measure`): width bands,
  medians and quartiles, headroom of corridors and rooms, sight lines, openings, storeys, footprint and fill.
  **Maps at one scale** (`maps.compareOf`, `smak map-compare`).
- **Views from places to start**: starts that stand together get one view; a view nearly one colour is
  dropped for the next room (`facts.dropped`).
- **stairs** takes `top: false` and `tread`; the default is as before.
- **A compile says what hlvis took**, and guesses only where the guess is a minute or more (`portalsLine`).
- **map-check --scripts** warns of the checked map's own unnamed scripts only; `--all` of every one.
- The Master Sword profile: no "Graphics test" box (`ms_didbloomcheck 1` before entering), a box with no
  title read as its text, `eye`, `heal`, `target` (`trial nearest`), `fight`.
- New: src/fbx.mjs, src/glb.mjs, src/import-*.mjs, src/maps/measure.mjs, docs/IMPORT.md, tests 34-39 and
  41-45 with their fixtures (written in code: no bought file is in the kit).

**Mind**: `until` hears from a step's beginning or from the last deed, and never matches a stopped-at line
again: a run that relied on a stale line now behaves otherwise. `compileMap`'s words for the portals changed.
`map-check --scripts` warns less unless `--all`. An imported rigged model has each point on one bone (it
may crease at shared joints) and is no monster yet: no activities, events or travel are set.

## 0.13.0 (2026-10-13)

A weapon in one recipe, a game that is heard, and the faults agents met building two maps. Three agents
making a second map and its first weapon for Master Sword Classic spent over half their time testing in the
game by reading pictures, each run paying over a minute of loading; this version is what they asked for.

- **`smak play` hears the game, and a run passes or fails by what it says.** What the server tells the player
  (HUD lines, boxes, chat, a script's console lines) is read from the engine's own user messages, with nothing
  of the game changed, and written with its time to log.txt and log.jsonl. `until` on any step waits for a
  line instead of the clock (`within`, `every`); `expect` and `expectNot` (steps, and `--expect`,
  `--expect-not`) hold a run to lines: it ends with 1 when one fails, and says which.
- **A session that stays up**: `smak play <url> --serve`, then `smak play <session> --attach --map ...` as often
  as wanted (`--stay`, `--close`); several `--map`/`--steps` in one command; a `map` step; `--put place=file`
  writes a rebuilt map or pack into the running engine. Measured: in the game 6 s after a run begins in a
  session and 18 s from a cold start, where 0.11's fixed waits took 79.
- **New steps**: `mouse` (a button held), `mouseDown`/`mouseUp` (held across steps), `look` and `face` (the
  view set in degrees), an exact `turn`, `where` (the player's place and view, in the log), `goto` (by the
  profile's `play.goto`, read back). A contact sheet of each run's pictures (`sheet.png`), and `result.json`.
- **A profile's `play`** gains `loaded` (the line a loaded map prints), `goto`, `messages` (which user
  messages to read, and how); its `enter` steps may wait by `until`. Master Sword's profile enters with one
  click repeated until the game answers, reads HUDInfoMsg, TextMsg, SayText, HP and MP, and says a thing with
  `cmd say_text 1` (its old `setsay` moved the way of speaking on by one each time).
- **A new item in a game's own models** (`src/items.mjs`, docs/ITEMS.md). `addFitted`: a piece as a new
  submodel after the ones a bodypart has, laid on one that is there (by its outline, as a shield on its back,
  or as given), on the bone asked for, with `bones` for the corners a piece marks by `part`, `rig: "nearest"`
  for what bends, `keep` for meshes taken along (a bow's nocked arrow). `addItem`: one piece in every file
  and place of a family (data: files, bodyparts, bones, the thing each is laid on, how a script's numbers
  follow), returning the files and the constants (`itemConstants`). `keptWhole`: that what a file had is where
  it was. `itemSheet`: each new submodel beside the one it was laid on. `smak item`. A file that holds the
  item already is kept when it is the same thing (`existing: "same"`) and refused when it is another.
- **A bodypart that is not the last may be added to**: `addModel` (and so `putBody`, `copyBody`) raises the
  `base` of the bodyparts after it; `check` warns of a base that is not the product of the counts before it
  (`basesByRule`) and refuses a base of 0.
- **An icon's tile** (`src/icon.mjs`): `iconPicture` draws one body on black as it stands or with its long
  axis on the diagonal, heavy end up; `reducedPicture`. `render` takes `parts`.
- **`check` and the hundred textures**: the 100 is the compiler's (studiomdl's MAXSTUDIOSKINS), not an
  engine's. For goldsrc the warning says so; for xash it is a fact above 256.
- **The walk test is told what a class is**: `markers`, `wiring`, `off` beside `exits`, as options and as a
  profile's fields. A class the game does not have is no wall; a way out so written is looked for and told
  apart. Triggers that are only fired are not gone to. `reach.on(x, y)` answers yes or no where `walked`
  gives a height that may be 0.
- **A `trigger_counter` with no brush** is no longer said to have no shape.
- **Scripts placed against the game's** (`maps.scriptsPlaced`, `smak scripts`, `map-check --scripts`): each
  of ours replaces a game script, is new and named, or is new and named by nothing (a warning). The rules
  are a profile's `scriptPack`.
- **A compile that is seen and stopped**: `progress`, `--timeout`, "stopped" in the summary, and the portals
  hlbsp left (`result.portals`), with a warning before hlvis when they foretell minutes. A draft says in
  `result.facts` that its light has no bounces.
- **The light on the floor** (`maps.lightReport`, `smak map-light`): the mean of the floors' lightmap samples,
  by room or as dark stretches. The views say what their light is.
- `bowkit` marks the middle of its string `part: 1`.
- The Master Sword profile: `ITEM_FAMILIES` (blunt1h, shield, bow, bow_bending) as `items`; `wiring`;
  `scriptPack`; `play`.
- New: src/items.mjs, src/icon.mjs, src/maps/scripts.mjs, src/maps/light.mjs, src/maps/compile-run.mjs,
  src/play-browser.mjs, src/play-session.mjs, src/play-sheet.mjs, docs/ITEMS.md, docs/MAPS-CHECKS.md,
  docs/PLAY.md, tests 31 to 33 and 40.

**Mind**: a body number that shows another than the first submodel of a LATER bodypart changes when a
submodel is added before it (the bases grow). A brush `trigger_counter` is no longer among a walk's entities.
`compileMap`'s result has `facts` and `portals`. The bending bow family creases where two bones meet and has
not been in a game; the rigid one is the sound one. Reading the game's text and setting the view find the
engine's tables in memory: tried against one Xash3D FWGS browser build only.

## 0.12.0 (2026-10-13)

A monster made from nothing. Until now the kit made things that are carried, worn or stood somewhere; the
first monster made with it was a scarecrow for Master Sword Classic: 17 bones, a body of 857 triangles and
five animations, every one written in code. In the game it came to the player on feet that did not slide,
struck him, took a blow (so its hit boxes are where a blade goes) and fell dead on its back. Two things the
game would not have forgiven were learned from its code before a frame was made: a model with no hit boxes
cannot be hit at all, and a walk whose sequence says it travels nowhere moves the monster nowhere.

- **Animations written as poses** (`src/animate.mjs`, exported as `animate`). A frame in the file is six
  numbers a bone in the bone's own axes: arithmetic on them nudges an animation that exists and makes none.
  `rigOf`, `poseOf` (a `turn` in degrees about the MODEL's axes, from rest and carried by the parent, the
  same on a skeleton whose bones are turned as a Biped's), `reach` (a limb of two bones bent to put its end
  at a place: feet planted by arithmetic), `mirror`, `between`, `animate` (key poses joined by the shortest
  turn, eased; a loop closed; `each` for a frame made by a formula), `valuesOf`, `worldOf`, `matricesOf`
  (a pose drawn by `render` without being an animation). And the measures: `seam` (a loop's gap), `track`
  (where a joint goes), `stride` (the speed the planted feet ask for, and how much they slide). The
  scarecrow's walk asks for 33.3 units a second and its sequence travels exactly that; the game's own
  skeleton and boar slide.
- **A monster's parts, read and written** (`src/mdl.mjs`, `src/build.mjs`): hit boxes (`setHitboxes`,
  `autoHitboxes`: the boxes studiomdl makes, which match Valve's own files box for box where those were
  made so), attachments (`setAttachments`), bone controllers (`boneControllers`, `setBoneControllers`), and
  for a sequence its travel (`movement`, with the motion bits), `activity`, `actweight` and its box, measured
  from the posed vertices as studiomdl measures it (within 0.024 units of the files' own). `writeMdl` and
  `buildMdl` take them all, with `eyes` and the header's boxes; `MOTION`, `HITGROUP`, `ACTIVITY` name the
  numbers. Written back through the setters, Half-Life's zombie and grunt and Master Sword's skeleton and
  rat read the same.
- **`info`** prints each animation's travel and the speed it makes, its activity, the hit boxes
  (`--hitboxes` lists them), attachments, controllers and eyes. **`check`** tells of a hit box on a bone that
  is not there, an animation with a box of no size, a loop that does not come back to where it starts, and,
  as a fact, a model that travels and has no hit boxes.
- **`render` and `strip` take `--view side|front|top` and `--ground`**: an animation from the side, every
  frame from one camera, over the line of z = 0. A walk is judged by its feet against that line.
- **The Master Sword profile's `play` and one more rule**: a map with neither an `ms_player_spec` nor an
  `ms_player_spawn` drops a player as he connects (found by making a yard to try the monster in, then read
  in the game's code; all 100 of the game's maps have one or the other).

**Mind**: `replaceSequence` with new frames, and `addSequence`, now measure the animation's box where they
kept or copied one; `addSequence`'s `like` copies a box only when given.

## 0.11.0 (2026-10-13)

What the first map made with the kit still had to be done by hand for: seeing it in the game itself, naming
each monster's model for a picture, and telling the walk test where the mod's maps end.

- **A map played in the game** (`play.play`, `play.playOf`, `play.browserDriver`, in `src/play.mjs`;
  `smak play <url> --map <name> --steps steps.json -o <folder>`): a list of steps (`command`, `say`, `walk`,
  `turn`, `button`, `hold`, `press`, `click`, `wait`, `shot`) run through a driver, and what happened
  given back: the pictures in order, each step with its time, the console's lines. The one driver shipped
  is for an Xash3D build in a browser, through Playwright, which is the caller's and never the kit's
  (`--playwright <folder>`). What is the game's own is in its profile's `play`: the steps that get a player
  in after the map has loaded, how a thing is said, how long a load takes. Tried on Master Sword's browser
  build: it chose the character, walked, turned, spoke to an NPC and was answered. No step places the
  player: the engine has no command for it. Turns are by time and inexact; loads are waited for by the clock.
- **A profile says what an entity looks like** (`modelOf(keys)` in a profile; `maps.modelsOf(mod, map)`):
  with `models`, the pictures draw an entity whose keys name no model as the one its mod gives it.
  `profiles/mastersword.mjs` reads it from the monster's script (`scriptModel`, `packScripts`): the
  `setmodel` line, a word given its value with `const` or `setvard`, and the scripts taken in with
  `#include`; 670 of the game's 875 monster and NPC scripts give a model this way, the rest being bases and
  the players' side. Not read: `setmodelbody`, and a model chosen while the game runs.
- **A profile names the ways out of its maps** (`exits`; Master Sword's `msarea_transition`): floor one is
  reached from is no one-way place, with no `--exit` given each time. A way out is now an entity a player
  goes to whatever its class: before, one that was no `trigger_` or `msarea_` by name was never reached.
- **Every picture command takes `--mod`** (`map-view`, `map-views`, `map-plan`, `map-section`,
  `map-storeys`, `map-openings`; `map-views` also takes `--body`, `--models` and `--model` now): the mod's
  folders, its classes' boxes and its models, as `map-check` and `map-reach` took its rules and starts.

## 0.10.0 (2026-10-13)

A map's entities held against the game that will read them. The first draft of the first map made with the
kit used three classes its mod does not have, put a key on entities where the game never reads it, left a
spawn point without the key that makes it one, named an item by its script's path where the game wants the
item's name, and would have put 39 monsters in an area that holds 32. It compiled, and every picture of it
was right. A person found all five, by reading a hundred maps and the game's C++; the kit had said nothing.

- **Entity definitions from `.fgd` files** (`maps.readFgd`, `loadFgd`, `definitionsOf`, in
  `src/maps/fgd.mjs`): the Valve format read into plain data: `@BaseClass`, `@PointClass`, `@SolidClass`,
  `base(...)`, `size(...)`, `studio(...)`, every key with its type, choices, flags and default, `@include`
  followed. Six FGDs found on one machine (Half-Life's as Master Sword ships it, Master Sword's two, The
  Specialists', Counter-Strike's, VHLT's) are read whole.
- **Definitions learned from a mod's own maps** (`maps.learnEntities`, `entitiesOfFile`, in
  `src/maps/learn.mjs`; `smak map-learn <folder> -o <file>`), for a mod with no FGD or a wrong one: each
  class with how often it appears and whether as a point or of brushes, each key with how often and its
  commonest values, the keys every entity of a class gives and the keys that are always given together. Only
  each map's header and entity text are read: Master Sword's 100 maps (593 MB) take under half a second, and the
  answer is kept in a file the caller names until a map of the folder changes. Used in place of an FGD, more
  weakly ("never seen in any of the mod's 100 maps" is a warning, with the count), and beside one.
- **The classes a game's own program has** (`maps.classesOfDll`, `definitionsOfDll`, in `src/maps/dll.mjs`):
  the engine makes an entity by calling the function of the game's library that bears the classname, so the
  library's exported names are the one certain list of the classes that exist. With it, a class the program
  does not have is an error whatever an FGD says, and one it has is no fault though no FGD and no map uses
  it: Master Sword's FGD and all its 100 maps lack `msmonster_giantspider`, which its program has.
- **The entity check** (`maps.checkEntities`, in `src/maps/rules.mjs`), which `checkPlan` (brush source) and
  `checkBsp` (a compiled map) run when given **`mod`** or **`definitions`**: a class that is not defined; a
  point class given brushes and a brush class given none; a key its class does not define (a warning: a mod
  reads keys its FGD forgets, and a key the mod's own maps give that class is not told); a value that is not
  of its key's type or not among its choices (not told when the mod's own maps do the same: the FGD is then
  the one that is wrong); a `target`, `killtarget`, `master` or any `target_destination` that names no entity;
  the targetnames nothing names, as a fact.
- **Mod profiles** (`maps.GOLDSRC`, `modOf`, `loadMod`, `withMod`, `bodiesOf`, `definitionsFor`,
  `joinDefinitions`, in `src/maps/mod.mjs`): one plain object a mod: its folders and `.wad` files, where its
  definitions come from, its start classes, the classes that walk with their boxes and where a thing's origin
  is in its box, the classes that open, the classnames that switch an entity off, its rules. `checkPlan`,
  `checkBsp`, `reachOf` and every picture take `mod` and no longer need the same options one by one. A
  class's FGD `size(...)` is the box the walk test and the pictures move it with. The kit ships `GOLDSRC`,
  Half-Life's own, with nothing of any mod in it; a mod's profile is data the caller passes or loads from a
  file, never built in.
- **Rules a profile carries**, as data with the reason of each, and small functions: no more than so many
  entities may name one other (`limit`); a key that does something only beside another (`beside`); ranges that
  must meet and not overlap among the entities at one place (`bands`); an entity that waits for others, each
  of which must have a count that ends (`finite`); a key whose value must be the name of something that
  exists, in the map or wherever a function of the profile looks (`names`: a script, an item).
- **Files**: every model, sprite, sound, sky picture and `.wad` an entity or the worldspawn names is looked
  for in the mod's folders and then `valve`. One that is found only in other capitals than the map writes is
  told: Windows finds it, a server on Linux does not (`maps.fileFinder`).
- **`profiles/mastersword.mjs`**: Master Sword Classic's profile, as one mod's and an example, outside the
  kit's core. It holds no game content: it reads the installed game's program, FGDs, maps and script pack when
  it is made. Every rule has its source over it, most of them a line of the game's C++. On the game's own 100
  maps: no map breaks the limit of 32; `reqhp` stands without `spawnarea` in 1 map; no ranges gap or overlap;
  26 spawn areas in 9 maps wait on `fireallperish` for a monster with no `lives`, which the game's code says
  never fires; 20 classnames in 11 maps are not in the program (misspellings such as `func_monsterclips`).
- **Commands**: `smak map-check` takes a `.map` as well as a `.bsp`, and `--mod <profile.mjs|.json|goldsrc>`,
  `--fgd`, `--learned`, `--scripts`, `--cache`; `smak map-learn <folder> -o <file> [--class name]`; `smak
  map-reach --mod`. The MCP tool `check` takes `against` (FGDs, learned definitions, a profile that is data).
- The self-test has 21 cases for all of this (`test/24-maps-mods.mjs`), with an FGD and a made-up game of the
  kit's own in `test/fixtures/` and no game's content. The five faults above are cases of it.

And what the pictures and the walk test could not show of that same map: its trees were blue blobs, its
torches boxes, its sky one colour, and nothing said that a player who dropped into a pit could not leave it.

- **Models in a map's pictures wear their textures** (`src/maps/figures.mjs`): each triangle its own, the
  nearest pixel of it, seen from its front as the game draws it. A masked texture's holes are open (a crown
  is leaves and air; it was one flat colour, the mean of its picture with the blue of its holes in it); an
  additive one is added to what is behind it. A model takes the light of the floor under it. An entity's own
  keys stand it: `angles` (all three, by the engine's own arithmetic), `body`, `skin`, `sequence` and
  `frame`, `scale` (`modelScale: false` where a mod's drawing does not scale models). A model is read once
  and kept: twelve views of a map with sixty-five models take under a second together.
- **Sprites** (`maps.readSpr`, `spritesOf`, `boardOf`, in `src/maps/sprites.mjs`): with the game's
  `folders`, an entity that names a `.spr` (`env_sprite`, `env_glow`) is drawn as its first frame at its
  `scale`, set up by the sprite's kind and blended by the entity's render mode (whole, with holes, added,
  tinted, a glow that grows with its distance), as Xash3D FWGS draws one. A small cross on a plan.
- **The sky's own picture** (`maps.skyOf`, `skyColour`, `readTga`, in `src/maps/sky.mjs`): the six sides
  the worldspawn's `skyname` names (`gfx/env/<name>rt.tga` and its like, or `.bmp`), where the engine lays
  them; a flat colour where they are not found, and a note that names the file.
- **A `{` texture has its holes where the game gives them**: on a brush entity in render mode 4. On the world
  and in any other mode a view fills them with the texture's last colour, as the game does, and says how
  many faces: a fence left without its `rendermode` is seen before the game shows it.
- **`entities: "game"`** (`--entities game`): only what the game shows is drawn (models and sprites, no box
  for a start or a monster): with `labels: false`, a picture to lay beside a screenshot.
- **One-way places** (`reachOf(...).oneWay`, `trapped(x, y)`; a warning): floor a player gets to from the
  places to start and from which there is no way back to one, by a step, a jump of 63, a jump across a gap,
  crouching or a teleport: a pit, the foot of a slope too steep to climb, a room a teleport leads into. Each
  with where it is, how large, how it is entered and what is in it. `trigger_changelevel` is a way out, and
  `exits` (`--exit`) names a mod's own. A plan with `reach` tints such a place amber.
- **Slopes as the engine has them**: how each floor lies is read from the map (a brush's plane; a compiled
  map's clip hull), and one whose normal has a z under 0.7 is slid down and never walked or jumped up.
  `spaceOf(...).blocked` gives each stretch's `slant`. `slopes: false` (`--no-slopes`) walks as 0.9.0 did.
- **Jumps across gaps** (`jump: true`, `--jump`): one arc at a run, from the engine's own numbers (a throw
  of 268.3 units a second up, a gravity of 800, a run of 320: the body's middle goes 215 landing level;
  `speed`, `gravity`), with the whole body clear on the way. What only a jump reaches is told apart: an
  entity's `how` is `"jump"`, `leaps` lists the jumps, `jumped(x, y)` is that floor (blue on a plan). An
  entity a walk does not reach says which jump would: `a jump of 144 across a gap, from ... to ...`. The
  numbers and where each is from are in `docs/MAPS.md`, "The engine's numbers".
- **Commands**: `map-reach --jump --speed --gravity --no-slopes --exit`; the map pictures take
  `--entities game`, `--no-sprites`, `--no-sky`, `--sky r,g,b`, `--no-model-scale`.
- The self-test has 20 cases for these, 21 where the compilers are (`test/25-maps-seen.mjs`,
  `test/26-maps-play.mjs`): a card of two triangles for a model, sprites and skies written byte by byte, a
  hall cut by a trench and a hall with a ramp.

**Mind**

- **With no `mod`, nothing changes**: `checkPlan` and `reachOf` still count `START_CLASSES` (Half-Life's two
  starts and Master Sword's two), and no entity is looked up. With a profile, the starts are the profile's:
  `GOLDSRC` asks for Half-Life's alone. `checkPlan`'s sentence for a map with no start now ends with the two
  ways of naming a mod's own (`mod`, `starts`).
- **`bodyFor`: a box of exactly a hull's size is that hull.** `bodies: { name: { half: 32, height: 64 } }` was
  "a box of its own", which a compiled map's walk passes over; it is now walked as the large hull.
- **Not measured in a game.** The entity check holds a map against what was written down (an FGD), counted
  (the maps) or read (the program's class list, a profile's rules). It does not run the game: a key that
  exists and is given the wrong meaning passes.
- **Pictures given `folders` look different**: sky faces show the sky's picture where the folders have it
  (`sky: false` for the flat colour), and an entity that names a sprite is drawn as it and no longer as a
  small box (`sprites: false`). `facts.marked[].drawn` may be `"sprite"`; the note `N as their model, in flat
  colours` is `N as their model, with its textures`. `figuresOf` gives each figure `surfaces` and `pose`;
  its `triangles` are still `{ points, colour }`, the colour now without the blue of a masked texture's
  holes. A model is seen from its front only, where both sides of every triangle were drawn.
- **A model follows its entity's `scale`, `body`, `skin`, `sequence` and all three `angles`**, where only its
  yaw was read. The engine's own drawing does not scale a model and Master Sword's does: `modelScale: false`
  for a mod that does not.
- **A `{` texture on the world, or on an entity that is not in render mode 4, is drawn filled.** It was
  drawn with holes everywhere, which the game does not do.
- **The walk test no longer walks up a slope steeper than 45.6 degrees**, which it did wherever each 8 units
  rose no more than 18. On the two maps it was run on, the floor walked is 1.3 and 2.7 in 100 smaller and
  the same entities are reached. `slopes: false` is the old walk.
- **With `jump`, an entity only a jump reaches has `how: "jump"`**, where it had `"walk"`; it is `reached`
  as before. A jump is now also one across a gap, so `jump: true` reaches more floor than it did.
- **`reachOf` warns of one-way places**, which is one more warning a map may have. `map-reach` still ends
  with 1 only for an entity that is not reached or stands in something solid.
- **Not measured in a game.** The models, the sky and the trees of one map were laid beside the game's own
  screenshots and agree in place, turn, size, holes and sky (`docs/MAPS.md`, "Against the game"); a sprite
  was not looked at there. A model's pitch and roll, a sprite's glow and every jump the walk test finds are
  the engine's arithmetic read from its source (Xash3D FWGS's drawing; Half-Life's `pm_shared.c`), not seen
  in a game. The MCP server draws the sky and the sprites when its models folder is the game's; it does not
  take `jump`, `models` or `exits` (its tools' descriptions are kept short): they go by `run`.

## 0.9.0 (2026-10-12)

A map judged with no game running. The first map drafted with the kit (a farm, three terraces and a cellar,
from a script) showed what its maker could not tell: entities were dots, nothing said whether a player could
get from the start to each place, and a plan showed one height at a time.

- **The walk test** (`maps.reachOf`, in `src/maps/reach.mjs`; `smak map-reach`), of brush source and of
  compiled maps. From the places to start it floods the floor as the box of a standing player: up a step of
  18, down any drop, doors open (`doors: "closed"`, `open`, `shut`), ladders and liquids climbed, teleports
  followed. It says, in sentences: the entities a player goes to that are not reached, each with what it
  would take (`only by a jump`, `only crouching` with where and how low, `open air leads to it` with how near
  the walked floor comes, `no opening leads to it`, `inside something solid`); the entities whose box does
  not fit where they stand, and how far to lift one sunk in its floor; those that hang; every opening with
  its width and height, and those a large monster's box does not pass; the walk to chosen entities, with its
  way. Brush source is measured by growing each brush by the body, as the compilers grow their clip hulls; a
  compiled map by its own clip hulls. On the kit's own two rooms the two give the same floor to the unit.
- **The space** (`maps.spaceOf`, `restOf`, `bodyFor`, `BODIES`, in `src/maps/space.mjs`): at a place, the
  heights at which a body fits; whether one fits with its feet at a point, and the floor under it.
- **Entities at their true size** (`src/maps/figures.mjs`): a place to start, a monster and an NPC are drawn
  as the box they move with (32 x 32 x 72; `bodies: { name: "large" }` for 64 x 64 x 64) in `drawMap` and
  `drawSource`, outlined on `planOf` and `planOfSource`, and on a section. With `models` and `folders`, an
  entity that names a `.mdl` (or that `models` names one for) is drawn as that model, in flat colours.
  `--body`, `--models`, `--model` on the command line.
- **A side section** (`maps.sectionOf`; `smak map-section`): an upright cut along a line, floors with their
  heights written under them, the entities on the line.
- **The storeys side by side** (`maps.storeysOf`, `maps.storeyCuts`; `smak map-storeys`): the cuts that show
  every floor are found, and each plan marks the entities of its own storey. `heights: true` (`--heights`)
  writes each floor's height on any plan.
- **A view through each opening** (`maps.openingViews`; `smak map-openings`).
- **Plans**: `reach` tints the walk test (walked floor green, floor with room to stand and no way to it red,
  the ways asked for as lines, the openings numbered); `legend` lists the entities beside the plan; a label
  with no room is tried on the other sides of its dot and then written as the number alone, where it was
  left out before; `only` marks the entities named.
- **`checkPlan` counts a mod's starts**: `starts` is `START_CLASSES` unless told (`info_player_start`,
  `info_player_deathmatch`, Master Sword's `ms_player_begin` and `ms_player_spawn`), and a fact says which
  were found and how many.
- **The MCP server**: `check` takes a `.map` (its plan's faults) and `walk` (the walk test); `render` has the
  kinds `section`, `storeys` and `openings`, and `heights`, `legend` and `reach` for a plan. No new tool.
- The self-test has 165 cases, 170 where the compilers are (`test/23-maps-walk.mjs`).

**Mind**

- **`checkPlan` numbers entities from 1**, as the pictures, `smak info` and `viewFrom` do (the world is 0).
  Its sentences said `entity 14` for the one the plan labels 15.
- **Pictures of a map with monsters or starts look different**: each was a box of 16 units, and is now its
  whole box. `facts.marked` has `drawn` and `size`; the note `N point entities are marked by a box` is now
  `N point entities are drawn: ...`. `entities: false` leaves them out as before.
- **Not measured in a game.** The walk test is geometry. A monster's origin is taken to be at its feet (a
  start's is its middle), from how Master Sword's own maps place theirs; a jump clears 45 and 63, as mappers
  measure it; a jump across a gap, a slope's slide and what a script does are not played.

## 0.8.0 (2026-10-12)

Maps. The kit read, made and drew studio models; it now does the same for a level, under `maps`
(`import { maps } from "smak"`), with `docs/MAPS.md` and `docs/MAPS-MAKING.md` and a Maps section in AGENTS.md.

- **A compiled map read** (`maps.readBsp`, GoldSrc `.bsp` version 30): entities, faces, textures, lightmaps,
  the collision hulls, visibility. Of the 472 maps on the machine it was written on, 470 read; the other two
  are 2-byte files. `maps.checkBsp` checks one against GoldSrc's and Xash's limits, as `check` does a model.
- **Its entities changed** with nothing else in the file touched (`maps.withEntities`; `smak map-set`): a start
  moved, a key set, a point entity added or removed. Unchanged, a map is written back byte for byte. Light,
  visibility and collision stay as they were compiled.
- **Textures**: `.wad` files read and written (`maps.readWad`, `maps.writeWad`; `smak wad`, `smak wad-make`), so a
  map can wear pictures made with the kit.
- **A map made from code** (`maps.box`, `solid`, `prism`, `wedge`, `cylinder`, `arch`, `bend`, `stairs`,
  `terrain`, `carve`, `hollow`, entities and lights; `maps.writeMap` and `readMap` for Valve 220 `.map`
  text), checked before any compile (`maps.checkPlan`, with a hint of where it would leak), and compiled by
  the VHLT compilers where they are installed (`maps.compileMap`; `smak map-compile`), a leak reported with
  its points and the nearest entity. **The compilers are an outside program** (VHLT, Vluzacn's ZHLT v34): the
  kit finds them in a folder given, in `VHLT_DIR` or on the PATH, and says so plainly when they are not there.
- **Pictures of a map**, so that it can be looked at: `maps.planOf` (from above: floors, walls, every entity
  marked and numbered, a scale and north), `maps.drawMap` (a view from inside, textured and lit by the map's own
  lightmaps), `maps.viewsOf` (several in one), and `drawSource` / `planOfSource` for brushes before any
  compile. `smak map-plan`, `map-view`, `map-views`, `map-info`, `map-check`, `map-entities`, `map-textures`.
  A view of a map of 15,000 faces takes about a tenth of a second.
- **The MCP server** lists, describes, checks and draws maps with the six tools it had.
- `examples/07-a-small-map.mjs`: two rooms, written, checked, drawn, and compiled where the compilers are.
- The self-test has 144 cases, 149 where the compilers are; its map is the kit's own (`test/fixtures/`).

**Mind**: a point entity's model is not drawn in a map's pictures (a labelled box stands for it), nor a sprite,
an open door or the sky's picture; a dark map is drawn dark (`brightness` lifts it). The brightness of a view
was matched to the game's own screenshots of one map in Xash. A map made here was loaded by the local game
(Master Sword Classic in the browser); not tried: GoldSrc itself, a dedicated server, a change of level. For
Master Sword a new model's file is only loaded if a script that runs at the map's start names it.

## 0.7.1 (2026-10-12)

The faults found by reading the code for 0.6.1, mended, each with a case that failed before. A script that
worked gives the same model as in 0.7.0.

- **Command lines**: `smak` and the editor's answer every wrong or missing argument with one sentence and exit
  code 1 (of 213 wrong command lines tried, 95 gave a stack trace or quietly did something else; a project is no
  longer written with a value that was not a number). `--seq rest` in `islands` and `pieces`; `-o` asked for
  before the work is done; a bone the model has not is answered with those it has.
- **Servers**: an address that cannot be read is answered with 400 by the editor and the viewer, where it could
  stop the server; a refused call is 400, not 200; a taken port is said; the timeline no longer throws when a
  dragged key cannot be moved.
- **Library**: `check` reports a file cut short instead of throwing; `poseAt` says which bone's values end
  early; `retexture` wears the file's own texture of that name, with no duplicate; `writeMdl` refuses a bodypart
  with no submodel; `replaceTexture` tells when a new size leaves a mesh with pictures of two sizes across
  skins; a handle straight along z is fitted; `unpng` refuses what it cannot read; a layer's `over` that names
  no layer is refused at once; `strip` on a model with no animations says so.
- **An .obj's own normals are kept** (`vn`): the model is lit as the tool that made it lit it, and a big one
  split over bodyparts shows no line at the cut. `meshOf` takes a corner's `n`; `buildMdl` and `putBody` with
  `ownNormals: true`.
- **Examples**: 02 and 05 write nothing when the check refuses the result; every wrong argument is one line.
- **Kits**: a sword's `extra` without `tall: true`, and more fittings on an axe than its texture has rows for
  (10; 21 with veins), are refused in words where the part silently wore another's picture; bluntkit honours a
  ring's `flatten`; `grip.mottle: "own"` mottles a lattice grip towards its own colour; an axe may be a head
  with no haft; the headers name every option the code reads.
- **Tried**: an .obj written by Blender 5.2 (a textured Suzanne: upright, the right way round, its picture in
  place), and the MCP server with a real client (a Claude session with nothing else made a barrel that passes
  the check, for about a third less than one with a shell and the whole guide; one run of one task).
- The self-test has 100 cases; the editor's browser tests need no outside file but the sword's model.

**Mind**: a flag that takes a value and is given none is refused (`smak check x.mdl --engine` alone meant
goldsrc). An .obj with normals gives other bytes than in 0.7.0, lit by the file's normals. A blunt weapon
whose script passed `flatten` to a ring, which was ignored, now has the flat ring it asked for. Not tried:
anything made from an .obj in the game.

## 0.7.0 (2026-10-12)

Two ways in for people who do not write SMAK scripts by hand.

- **From an .obj file**: `smak obj file.obj -o out.mdl`, or `readObj` / `objToMdl` (`src/obj.mjs`). Geometry made
  anywhere (Blender, another tool's output) becomes a model the game can load, with its .mtl's pictures (PNG, BMP)
  or flat colours as textures, stood up from Y-up, scaled, grounded or centred. One bone, one still animation.
  What the format cannot hold is met and said (a large picture shrunk, a big mesh split over bodyparts, tiling
  texture coordinates laid out) or refused in words. `objMeshes` gives the triangles for `putBody`, to add an
  .obj as a new body on a bone of a model that is there. `examples/06-from-obj.mjs`.
- **An MCP server**: `smak mcp --work <folder> [--models <folder>]` (`mcp/`, with no dependencies: JSON-RPC on
  stdin and stdout by hand). For a client with no shell, such as Claude Desktop. Six tools: `guide` (this kit's
  guide a section at a time, in place of reading all of AGENTS.md), `models`, `info`, `check`, `render` (a view,
  a sheet, a strip or a texture's layout, as a picture in the conversation) and `run` (a script over the kit in
  the work folder: it runs code on the machine; `--no-run` leaves it out; a script kept by
  `name` is changed by `edits` and run again without being sent whole). `mcp/README.md` has the settings.
- The self-test has 68 cases.

**Mind**: an .obj's own normals are not stored; they decide where the creases are. Not tried: an .obj written
by Blender itself, either of these in the game, and the server with a real client.

## 0.6.1 (2026-10-12)

No change in what the kit does: the same calls give the same bytes. The code itself was rewritten to be read,
after a reader from outside found it too dense to follow.

- **One statement a line**, at 110 columns, kept so by Prettier (`npm run format`; a tool for whoever works on the
  kit, not something the kit needs to run).
- **The formats' numbers have names.** Every offset and size read from a model is a field of a table named after
  the format's own structure (`HDR` for studiohdr_t, `SEQ` for mstudioseqdesc_t and so on, at the top of
  `src/mdl.mjs`); the same for BMP and PNG in `src/image.mjs`. Tolerances and defaults elsewhere are named too.
- **Words for names**, separate declarations, long functions cut into named steps.
- **Smaller files.** `src/place.mjs` is now a list of what it gives, from `surface`, `islands`, `layers`,
  `paint`, `pieces`, `bodies` and `carry`; the editor's page is `app.mjs` and eleven modules beside it; each
  command of `smak` and of the editor's command line is a function of its own; the self-test is one file an area
  under `test/`, still run by `node test/selftest.mjs`, the same 49 cases.

**Mind**: nothing for a model. For a script that reaches inside rather than through `src/index.mjs`: the short
names in the page's `window.ed.S` are words now (`id` is `modelId`, `n` is `animNumber`; `frame`, `bone`,
`tex`, `project`, `saved`, `ready`, `busy` and `live` are as they were), and the editor's `core.trackOf` gives
`{ frames, values, turns }`.

## 0.6.0 (2026-10-12)

Out of the first trial with a new shape, not paint on one of the game's: a great helm with a domed crown, bars,
an apple finial and a plume. It was made through the lathe's escape hatches and with corners built by hand, its
first version failed review on shape, and a third of its script reproduced what the kit already knew (where the
lathe's own faces are, where the head is, how the game's helmets sit).

- **`M.turn(rings, zone, options)`**: the lathe's successor, beside it. A ring has its own outline (`r` a radius,
  an oval `[ra, rb]` or a function of the angle; `ds(angle)` for a rim that dips; `off`, `tilt`); an end is open,
  flat, or a **dome** (`caps: [false, { dome, rings, zone }]`, laid as a disc in a zone of its own; under 0, a
  dimple); **`lining`** is the inside, facing inwards at an inset, with its rim and a closed end, in its own zone;
  **`seam`** says where the picture's edges meet; **`lie: "across"`** stands the surface up in its zone. Its
  picture **follows the real surface**: each band is as long in the zone as on the shape after `at`, a ring's `w`
  weighs its band, and `workshop.allot` shares a whole picture out between parts by their sizes.
- **A built surface says where it is**: `turn` returns it, and `surface.at(s, angle, out)` is the point of the
  built faces themselves, the normal there and its place in the picture. On it: **`M.ridge`** (a ridge or a bar
  along a path, its ends falling to a point, running out into the surface, or cut), **`M.band`** (round it),
  **`M.boss`** and **`M.studs`** (a row of rivets in one zone).
- **`M.leaf(rows, zone)`**: a thin sheet seen from both sides, each side with its own faces and normals (a `plate`
  with no thickness showed from one). **`M.tube(path, zone)`**: a tube or a tapering tail along a curve, to a
  point if its last radius is 0; it returns a surface too.
- **Creases**: a ring marked `crease: true` is a hard edge however gentle the bend, and a part's `smooth` is its
  own angle. Underneath, a corner may carry `group` and `smooth`, which `meshOf`, `buildMdl`, `swapMesh` and
  `putBody` honour; corners without them are smoothed as before.
- **`putBody(src, { name or body, tris, texture, bone, pose })`**: a body made from triangles into a model that is
  there, as a new body or in the place of one, on a bone, from points in the bone's space or in model space in a
  pose. It **warns** (in its result and on the console) when the body it replaces was painted for another layout,
  and when the file has a texture of that name with another picture. `layoutMoved(old, now, { body })` is the
  measure behind the first.
- **`carryPicture(old, now, { body, was, is })`**: a painted picture carried to a changed shape. A triangle that
  lies on the picture as it did keeps its pixels; with the old and the new triangles from the workshop the rest
  goes part by part, a ring that both shapes have being the same place and the bands that changed stretched; and
  without them by place, the nearest point of the old shape that faces the same way, which also puts the paint of a
  shape made another way on a new one. `places` on `turn` keeps the old rings on their pixels when one is added.
- **Measuring what is worn** (`src/wear.mjs`): `bodyIn` and `boxIn` (a body's triangles and its box in a bone's
  own space), `facingOf` (how a crown is tilted), `fitBetween` (the scale and shift from a man's piece to the
  woman's, from their points or their boxes), `clearance` (is the head inside the helmet, how many corners poke
  out, and the gap at the tightest place), `bodyCounts` (a body's triangles against the others of its file).
- **`graft(..., { missing: "ancestor" })`**: corners on a bone the target lacks (a jaw) hang on the nearest bone
  above it that it has, instead of the call throwing.
- **`together([...])`**: several models that share a skeleton by bone name as one model to draw: a helmet on a head
  with an armour is `sheet(together([armour, head, helmet]))`.
- `AGENTS.md`: the shape recipes use the new calls, and there are three new ones: a new body from triangles in a
  model that is there, a worn piece placed where the game's own sits and checked against what is under it, and
  changing a shape after it was painted.

Nothing that 0.5.0 had was changed or removed: `lathe`, `plate`, `tri`, `quad`, `meshOf`, `buildMdl`, `swapMesh`,
`graft` without its new option, `copyBody`, `paint` and the four kits give the same bytes as before on the
self-test's shapes, the kits and the five examples. A shape made by the newer calls has four fields more on each
corner (`of`, `q`, `group` and, when told, `smooth`).

**Mind**: `turn` is not the lathe under another name. Its picture is laid by the real surface and fills its zone
(the lathe went by `px` and the profile), and it turns its faces by how it is built, with no `inside` point. A
shape moved from `lathe` to `turn` needs its picture painted again, or carried: `carryPicture(old, new, { body })`.

## 0.5.1 (2026-10-12)

Out of three trials in which agents drove the editor's page as a person would (a surcoat, a plate armour, two
helmets): what was wrong in the page, and what they had to go round.

- **A body whose stored normals are all nothing is no longer drawn solid black** in the page (some of the game's
  own models store 0, 0, 0 for every corner: bodies 0 to 4 of Master Sword's `p_helmets.mdl`). The page's shader
  made a direction of them and got none; it now leaves such a normal as nothing, as `render` always did, and the
  two pictures agree: half lit.
- `copyBody` of such a body stores one normal where the original stores hundreds (282 to 1 on a helmet). That is
  left as it is, and a test now holds it: a copy stores each pair of bone and normal once, the engine lights a
  mesh's stored normals one by one from the bone and the three numbers alone, and a corner takes its light by
  its normal's number, so every corner is lit as before (read in Xash's `gl_studio.c`; `docs/ENGINES.md`).
- **`smak's picture` keeps the camera in use.** Ticking it switched the view to first person, and a model that
  is not a view model left the picture. It is now drawn from the page's own camera, whichever it is: in orbit
  from where the camera stands, what it turns about and how near, with the page's perspective.
- **`smak's picture` follows the camera**: asked for again when a drag of the camera ends, a moment after the
  wheel rests, and when the view changes size (it was redrawn only on a change of frame, body or project).
- **Both sides of every triangle**: the `both sides` box, or <kbd>F</kbd>. A face that is inside out and a thin
  sheet seen from behind show; off by default, as the game draws. `smak's picture` follows it, and
  `editor/cli.mjs render` takes `--both`.
- **A second body beside the first**: the `second body` box, or <kbd>V</kbd>. Another body of the same model,
  chosen by its own selects at the top of its view, from the same camera, animation and frame. For looking
  only: bones are picked and posed in the first view.
- **Adjustments for chosen colours only.** A click on a texture's picture in the *Textures* tab chooses a
  colour; the sliders then change only the palette colours like it (*how like*, 0 to 100, and *every colour
  but those* for the inverse), and the picture shows what is left alone dimmed. *All colours* is as before. It
  is kept in the project with the adjustments (`adjust.select: { colour, tolerance, invert }`) and baked the
  same by the page's server and by `editor/cli.mjs texture`, which takes `--select r,g,b`,
  `--select-at x,y`, `--tolerance n`, `--invert`, `--no-invert`, `--all-colours` and `--mask out.png`. How
  like two colours are counts their hue and its strength in full and their brightness by half, so a metal's
  light and dark shades are chosen together and the steel beside a brass is not. One selection a texture.
- **A picture dropped on a texture that has adjustments says so.** The adjustments stay and apply on top, and
  *Export PNG* gives the adjusted picture, so export, paint, drop tinted twice with no hint. The *Textures* tab
  now has a line saying that the replaced picture has adjustments on top, with *No adjustments* beside it; the
  status line says it when the picture is dropped; and *PNG without adjustments* (`--export out.png --plain`
  on the command line) gives the picture to paint on while the adjustments stand.
- **Hex digits for the tint that cannot be read are said** in the status line, and nothing is written. Before,
  the line was written over at once, and the tint became whatever shorter text had been readable on the way
  (`#c08` of `#c0804`).
- **A double click on the model in Orbit** makes the camera turn and zoom about that point; a double click
  beside the model, about its middle again.
- `render` takes `dist`: an orbit view with perspective, the eye that many units from `target`, `fov`
  degrees across. It is how the editor's server draws the page's orbit camera.
- The page's top bar goes onto a second row when the window is too narrow for it (it was cut off).

Projects made by 0.5.0 load as they are and bake to the same bytes, and `render` without `dist` draws the same
picture. Four things in the page behave otherwise: ticking `smak's picture` no longer changes the camera; in
orbit that picture is drawn from the page's camera with perspective, where it was a view without perspective
fitted to the model from the same side; unreadable hex digits for the tint write nothing; and a double click
on the 3D view moves what the orbit camera turns about (each of its two clicks still picks the bone under it).

## 0.5.0 (2026-10-12)

Out of a full plate armour painted with 0.4.0: a third of that agent's code was a mask module of its own, made
again in every round, because `paint` could not remember what was mail, strap or rim in the picture it began from.

- **Layers**: `paint(src, passes, { layers: { mail: fn, strap: fn } })`. A layer is a number from 0 to 1 for
  every pixel of a texture, made once from the picture as it was before the first pass (from a function of what
  `paint` hands its own, or from an image) and read in every pass as `layer.mail`, at the point asked about, so
  that with `soft` its edges come out soft. `layerAt(name, u, v)` reads it anywhere else. A later layer may read
  the ones declared before it.
- **Distance to a layer's edge**: `dist.mail`, in pixels, over 0 inside the layer and under 0 outside, so a rim
  is `0 < d < 2` and its dark line `2 < d < 3` where the plate's boundary lies inside an island and `edge` cannot
  serve. `distSmooth(name, r)` is that distance averaged, for a line that does not wander with the layer's noise.
- **Cleaning where a layer is declared**: `{ fn, blur, drop, fill, smooth }` softens it, drops regions under a
  size, closes pinholes and straightens its boundary (the layer, its regions and its distance then go by one line).
- **Regions**: `layersOf(src, layers, { pose, tex })` makes the layers on their own and gives each one's connected
  regions with their box, centre and size in pixels and their place on the body (`mn`, `mx`, `mid`): three straps
  and their buckles are found by rule and not with a measuring probe. `region.mail` in a pass is the region's id
  there. What `layersOf` returns can be handed to `paint` as its `layers`.
- **The original picture from any pass**: `orig(u, v)`, and `blur(r, { orig: true })`. `at` and `blur(r)` still
  see what the pass before left.
- **A blur that respects a layer**: `blur(r, { within: "plate" })`, `blur(r, { not: "mail" })`, still inside the
  island.
- **`busy(r)`**: how busy the picture was about a pixel (local contrast), for telling mail from plate by its
  texture where the colour is the same.
- **Seeing layers**: `layerMap(src, texture, layers)` and `smak layers <mdl> [layers.mjs] [name=expression ...]
  -o out.png` draw a texture with the layers tinted over it and list every region, as `islandMap` and
  `smak islands` do for islands. A layer can be tried in one line: `smak layers m.mdl "mail=busy(3)>0.25"`.
- `uvIslands` gives each island `bodies: [{ body, tris }]`: an island that two bodies lay on the same pixels
  counted its triangles for both in `tris` (it still does), and `smak islands --body n` now lists that body's own
  count and the sum.
- The editor: a run of arrow-key presses on a texture slider is one revision and one line of the log, written
  when the keys stop for a moment or the slider is left (each press wrote its own); the picture follows every
  press as before.
- The editor: a picture dropped on a texture no longer stays in `<name>.tex/` for ever. When another is dropped on
  that texture, its files that the project no longer names are removed but for the newest eight, so undo finds
  its picture eight replacements back; beyond that it says in words that the picture is gone.

Nothing that 0.4.0 had was changed or removed: the same calls of `paint`, `uvIslands`, `islandMap`, `pieces`,
`dropTriangles`, `copyBody`, `surface`, `check` and `render` give the same bytes as before, and a list of islands
has one field more. `paint` hands its function eight things more than it did and takes about a tenth longer over
the same call. Two things behave otherwise: `smak islands --body n` prints a body's own triangle counts where it
printed the sum over every body, and the editor writes a run of key presses once, a little after the last.

## 0.4.1 (2026-10-12)

- **The editor's page takes up by itself what changes under it**, within a second and without a reload: a model
  written into the folder (an empty folder's page opens the first that appears), the open model's file written
  anew by a script (read again, with the camera, body, frame, bone and undo kept), and, as before, every change
  to the project. A mark at the top right says `live`, what last changed and when, or `server away`.

## 0.4.0 (2026-10-12)

Out of an agent's first armour texture made with the kit, and what got in its way.

- **`paint` tells its function where it is painting**: beside the point, the normal, the colour and the texture,
  now the bone the point follows, its mesh, body and triangle, the pixel's `u` and `v`, and the **island** of the
  picture it is in (a trunk's front, a sleeve), with how far the pixel is from that island's border (`edge`) and
  from the nearest open stretch of it, a hem or an armhole (`open`).
- **Islands**: `uvIslands(src, pose)` lists them (texture, box, bones, place, the way each faces, how much of its
  border is open), `islandMap` and `smak islands <mdl> -o dir` draw each texture with its islands tinted and
  numbered, and `paint`'s new `islands` option paints the chosen ones only.
- **Soft edges**: `paint(..., { soft: 3 })` asks the function at 3x3 points inside each pixel and averages them.
- **Passes**: `paint(src, [pass, pass], options)` paints several layers in full colour and cuts each picture to
  256 colours once, at the end. A pass can read the picture as it stood before it at any pixel (`at`) and
  smoothed within its island (`blur`), to lose an old picture's fine detail and keep its light and shade.
- **`copyBody(src, body, name, texture)`**: a body again, as a new body after the others, wearing another texture.
- `smak pieces <mdl> --body n` lists that body's pieces (it listed every submodel's); `pieces` gives each piece's
  mesh (`where`), `dropTriangles` each triangle's number (`tri`), `posed` both and each corner's bone.
- The editor's texture sliders: a focused slider takes the arrow keys (they stepped the timeline instead), each
  has a number box beside it and the tint colour a box for its hex digits, and one change of the tint is one line
  of the project's log.
- `AGENTS.md` now says what is true of texture sizes (any size loads; `check` notes what GoldSrc stretches or
  shrinks) and that a model's rest pose can be turned from its animated one.
- The editor's browser tests take their models and their Playwright from `SMAK_MODELS` and `SMAK_PLAYWRIGHT`.

Nothing that 0.3.0 had was changed or removed: the same calls of `paint` write the same bytes, and scripts
written for it run as they are. One thing behaves otherwise in the editor's page: letting a slider go where it
stood no longer writes a revision that changes nothing.

## 0.3.0 (2026-10-12)

- **The editor** (`editor/`): `node bin/smak.mjs edit <folder of models>`, a page in the browser. Play and re-time
  an animation, pose a bone at a frame, thin an animation's keys so that it can be shaped by hand, add and move
  events, replace or adjust a texture, and save a model checked for GoldSrc or Xash. The models are only read: the
  work goes to a project file beside the saved model, and an agent makes the same edits on that file with
  `node editor/cli.mjs` (`editor/AGENTS.md`).
- It opens any model. A weapon in the player's hands (`v_<name>.mdl`) is shown as the player sees it, anything else
  from outside.
- An animation the game mixes from several (a player's aim up and down) is not posed, by the page or the command
  line: written from one set of frames it would lose the others. Its speed, looping and events can be changed, and
  a copy of it posed freely.
- The self-test covers the editor without a browser: 22 cases.

## 0.2.1 (2026-10-12)

- **A fault mended: models written by 0.2.0 and before can end a dedicated server (HLDS, ReHLDS) on a change of
  level.** They were written with their texture table, new textures or new animations after the first textures;
  the server's engine does not look there (`docs/ENGINES.md`, "The same file, appended to"). The clients draw such
  a file without complaint. Every function that changes a model now returns it laid out as the server reads it,
  and `check` refuses a file that is not.
- `engineLayout` (`src/layout.mjs`), which lays a model out so.

**Mind**: a model made with an earlier version that a server loads has to be mended once:
`writeFileSync(file, engineLayout(readFileSync(file)))`. Its numbers, shapes, animations and textures stay as they
were.

## 0.2.0 (2026-10-11)

- Working by place (`src/place.mjs`): `paint` across a texture's seams, `surface`, `spot`, `pieces` (a model's
  loose pieces), `dropTriangles`, and `graft` (parts from one model onto another with the same skeleton).
- The viewer: `smak view <folders>`, any two models side by side, turned and animated together.
- `smak pieces <mdl>`, `lineup` for before-and-after pictures, `workshop.fbm3` and `workshop.seeded`.
- `examples/05-by-place.mjs`.
- First run against another game: 13 player models of The Specialists, 20 variants made from them.

## 0.1.0 (2026-10-11)

The first release: the model tooling of the msr-web project, taken out to stand on its own.

- The reader and writer of GoldSrc studio models (`.mdl`, version 10): bones, bodyparts, meshes, textures, skins,
  animations, events, attachments, hit boxes; a model built from nothing (`buildMdl`), meshes replaced and added,
  textures replaced, animations replaced and added.
- `check` for GoldSrc and for Xash, pictures of a model (`render`, `sheet`, `strip`, `uvMap`), fitting a shape to
  a hand or a body, and the workshop for building shapes and painting textures.
- Kits for swords and knives, axes, blunt weapons and bows.
- The command line (`bin/smak.mjs`), four examples, the self-test, and the guide for an agent (`AGENTS.md`).
