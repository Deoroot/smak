# SMAK 1.0: a kit for making games with an agent

Started 2026-10-31, from SMAK 0.37.1. The plan for 0.x (fewer tokens, broken cases, the native game, GMod,
s&box) is kept in `docs/history/PLAN-0.x.md`; most of it is done.

SMAK began as a way to read, make and port GoldSrc's models and maps, and it does that well: all of Half-Life's
210 models and 115 maps port to GMod, the models and TS's 29 maps to s&box, held to the originals by checks that
run in the game. 1.0 turns it into a kit that helps a game developer (an agent and the person it works for) make
a game's content from scratch, for several engines, in several styles: Half-Life's or Vermintide's first person,
a fantasy keep or a sci-fi corridor. The aim past 1.0 is a generalist tool for anything a game needs; the two
goals that come first are weapons animated convincingly in several styles, and decent maps in several settings.

Each phase says what it is for, what it delivers, and how we know it worked.

## Why

What the 0.x work taught, in the projects SMAK served (Moria, specialists-next, rpg_sbox):

- **What worked**: porting and measuring against an original. A check that answers PASS or FAIL against a
  reference (GoldSrc's collision, a model's pose bone by bone, TS's own numbers) made results we could trust.
- **What didn't**: making from nothing and judging by pictures. Textures from procedural noise looked
  machine-made; the figure and map judges scored screenshots and passed bad results. Animation keyed bone by bone
  stayed at GoldSrc's level, below what a modern game needs.
- **What cost the most**: making everything ourselves. The rule "no dependencies" gave SMAK its own JPEG reader,
  mesh simplifier, renderer and painter (84,000 lines in `src/`), where established libraries and Blender do
  each better.
- **GoldSrc at the centre**: every asset passes through GoldSrc's formats and limits (`.mdl`, `.bsp`, 2048
  vertices a submodel), even when neither the source nor the target is GoldSrc.

## Principles

1. **Bases before generation.** A model, an animation or a level starts from an existing base (a CC0 kit, a
   motion clip, a modular set, the person's own art) that the agent picks, fits, edits and combines. Making from
   nothing is the fallback, and its results are drafts.
2. **Measure, don't judge pictures.** A check measures something a player would notice: a foot that slides, a
   blade that misses its contact frame, a room no path reaches, a sightline too long for the style. Pictures are
   for the person, who judges how a thing looks. No check passes a result on its looks alone.
3. **Use what exists.** Blender (headless) for meshes, rigs, retargeting and rendering; established libraries
   for glTF, meshes and images; the engine's own compiler and editor (s&box's resourcecompiler and its MCP).
   Each outside tool sits behind one adapter, is optional, and is pinned to a version. `smak doctor` says which
   are present. Reading and checking still need only Node.
4. **One neutral form in the middle.** Assets: glTF 2.0 (meshes, skeletons, animations, materials), with SMAK's
   own data alongside (events, hit frames, hit boxes, the contract a game reads). Levels: a level description
   (spaces, links, gates, encounter slots, metrics) that each engine's adapter builds. GoldSrc becomes one
   adapter among the others.
5. **Engines are adapters.** s&box first; GoldSrc and Xash3D, and Source (GMod), kept. Others (Godot, Unity,
   Unreal) only when a project asks for one, by glTF where they can take it.
6. **Pulled by a game.** Every phase ends with a result a real project uses (rpg_sbox, specialists-next). A
   feature no project needs waits.
7. **Tokens and errors are measured**, for each phase, against the measures of phase 0.

## What stays

The loop (look, script, check, draw, look again); answers in text first (`PASS`/`FAIL` and their reasons, detail
in a file); a broken case for every checker; evidence labels in reports (read, drawn, checked, played); stop
after three; the publish check (no game's files in anything shared); game profiles; the editor page; the MCP
server; the self-test (976 passing on this machine at 0.37.1), which keeps passing through every phase.

## Phase 0: set-up and the measures to beat

- **This folder** (`smak-next`), cloned from `msr-web/smak` at 0.37.1 with its history. Its remotes: `local`
  (the 0.x copy), `origin` (Deoroot/smak), `up` (stevenlafl/smak). Nothing is pushed until asked.
- **SMAK's next major version** (decided 2026-10-31), in the same repository, not a fork. Tell stevenlafl
  (they/them; 19 of SMAK's commits are theirs) before it is pushed.
- **The measures, taken on 0.37.1**, with a sample of usual tasks each run by a Sonnet worker from a clean start:
  - tokens read before a task starts (`AGENTS.md`: 112 KB at 0.26, now an index), and per task in all;
  - tasks done right the first time, out of the sample;
  - the self-test's time, and the share of commands with a broken case.
  The sample: re-skin a model, an item from a kit, a map from a spec, port a model to s&box, port a map to s&box,
  play a map and answer a question about it.

**Done when** the measures are written into this file.

**Measured 2026-11-01** on 0.37.1 (a clean worktree of commit e2cc626), each task given to a Sonnet worker with
the kit's folder, the person's words, where the game is and a working folder, and nothing else (it finds its guide
from `AGENTS.md`). No game or editor was launched; the results were judged by Opus from their checks and pictures.

- **Read before a task starts**: `AGENTS.md`, 9,274 bytes.
- **The self-test**: 976 passed, 0 failed, in 9 min 0 s.
- **Broken cases**: 43 of the kit's 56 checkers have them; 13 have a reason written instead
  (`test/broken/checkers.mjs`). The command line has 84 commands; not every command is a checker.

| Task | Tokens | Tools | Time | Runs | Right first time | What the run found wrong with the kit |
| --- | --- | --- | --- | --- | --- | --- |
| Re-skin: Barney's shirt dark olive | 70,600 | 15 | 70 s | 2 | yes (the shirt alone; asked about the trousers) | `smak inline` and `smak reskin` end with no PASS/FAIL line |
| Item: a flanged mace, MSR's one-handed blunts | 72,400 | 17 | 91 s | 1 | yes | the first-person picture cuts off the head; Master Sword Classic's profile used on Rebirth (said so) |
| Map: corridor, hall, gallery by stairs, storeroom behind a door | 97,700 | 17 | 121 s | 2 | yes (built again after the walk test found a gap) | the compile ends with no PASS/FAIL line; `map-reach --doors closed` does not say a closed door was counted as opened |
| Port a model to s&box: v_crowbar | 69,100 | 8 | 43 s | 1 | yes, by its compile (not seen in s&box) | — |
| Port a map to s&box: ts_lobby | 72,900 | 12 | 67 s | 1 | yes, by its checks (not seen in s&box) | made a `.sbproj` by hand where the guide's way is `sbox-cli --new` |
| A question: crossfire's spawns and the air strike | 101,800 | 26 | 305 s | 1 | yes (17 spawns, all reach the strike's trigger; what it could not settle, said) | the walk test rides no lift and does not get up one tower; the worker never looked at its pictures and first ran a model command on the map |

In all: 484,500 tokens (80,700 a task), 95 tools, 11.6 min; 6 of 6 right the first time. The marks to beat are
the tokens a task and the time; "right first time" has no room to rise on this sample, so a later phase's sample
should add harder tasks (an animation from a spec, a model made from a description) to stay a measure.

## Phase 0b: defining decent

A person can't say what "good" is, and a model doesn't know. Decent is defined in three layers, each measurable:

1. **No defects**: what no professional ships (a foot that slides, a pose that pops, an elbow past straight, a
   blade through the body or the camera; a path no one can walk, wrong scale). Hard limits, the same for every
   game, each check proved on several skeletons and kits.
2. **Inside the professionals' range for the style**: the principles as numbers (wind-up share, the speed curve's
   shape, the arc's smoothness, the joints' order, the settle; for maps loops, sightlines, landmarks, enclosure),
   banded over a corpus of many games and packs, per style (Half-Life's snap, Vermintide's weight). One game's
   bands are its style, not quality.
3. **Chosen by people**: two clips side by side, pick the better. Decent means a few people can't reliably pick a
   paid pack's clip over ours. Every choice also tunes which measures matter, and the person's own taste is kept.

The corpus, measured on this machine and never shared: MSR's view models (`anim/`, from msr-web), Half-Life's,
The Specialists' (knives, katana, kung fu), Left 4 Dead 2's melee and guns, the bought packs (Human Melee
Animations, MCSTEEG), Mixamo; Vermintide 2 later, by video and its weapon scripts' timings.

**Step 1 done 2026-10-31** (`anim/NOTES.md`): MSR's judge moved into SMAK and run on Half-Life and TS. Valve's
crowbar fails MSR's style bands and passes every physical check; the physical checks misread TS's unnamed
skeleton. Next: split the judge into defects and style, prove the defects on every skeleton, add L4D2.

**Closed 2026-11-01** for weapon animation (layers 1 and 2; layer 3, people choosing, waits for clips played in
s&box). What it delivered (`anim/NOTES.md`, steps 1 to 1w):
- **Defects** split from style (step 1d), tried on the blows of MSR, Half-Life, TS, L4D2 and Vermintide 2, and
  caught throughout the bad set (39 of MSR's sword blows, each spoiled by one known fault).
- **Style bands** for five games' blows (`anim/corpus/styles.json`, bands-*.json): Vermintide 2's 214 blows read from
  its own files, MSR's 205, L4D2's 62, TS's 17, Half-Life's 3 (too few to be a style).
- **Arms bands** for the same five (`anim/corpus/arms-*.json`): proportions, roll and palm bones, the skin's blend.

Pulled forward from later phases, on GoldSrc only (the reason the phase ran long, and worth it: the blows got
much better):
- **Phase 2's generation half**: blows made from a spec (keys, path, timing, shares of the joints), judged and
  fitted to a style, with the fingers on the handle, the off hand, the camera and the charge; Vermintide 2's five
  pass on MSR's sword. Not done: a motion base, glTF, and the swing played in s&box (its "done when").
- **Phase 6's styles as numbers** for Vermintide 2's first person, and the arms fitter (`anim/tools/arms.mjs fit`):
  a view model's arms brought to a profile's proportions with roll and palm bones, every animation kept.

Phase 0's measures were taken after it (above), and Phase 1's glTF to s&box (below). Next, in order: Phase 2's
swing played in s&box; then blocks, shields and dual wields (Phase 6's weapon sets).

## Phase 1: the first adapters, as little as the pilots need

- **Blender headless**: SMAK runs a Python script in `blender -b`, passes it a job as JSON, and reads back a
  result as JSON and files. Blender's version is checked. The existing `bakeMaps` moves onto it.
- **glTF in and out**: a `.glb` read into SMAK's model (the importer exists) and written from it, skeletons and
  animations included.
- **glTF to s&box**: a `.glb` made into a `.vmdl` with its animations, events and hit boxes, by the path
  `sbox-port` already uses (DMX, resourcecompiler), so a model need not pass through `.mdl`.

**Done when** a Quaternius character (CC0) with its animations goes `.glb` → s&box, and `sbox-check` holds every
bone of every animation to the `.glb`.

**Done 2026-11-01** for its "done when". Quaternius's "Character Animated" (CC0, poly.pizza; 32 bones, 6,050
triangles, 11 materials, 12 animations) went `.glb` → s&box with `smak sbox-port character.glb -o <Assets>`
(`src/sbox/glb.mjs`: no `.mdl` on the way, so no GoldSrc limit on it; its skin's weights kept, four bones a vertex),
compiled in 2.3 s, and `smak sbox-check character.glb --project smak_pilot --frames 5` PASSES in s&box's editor: 32
bones under their parents, 12 animations of their lengths, 60 poses with every bone where the file's own nodes put
it, the farthest 0.022 units off (the tolerance 0.1). The expected places come from the glTF's nodes, not from the
frames written, so the check holds the whole port to the file; the frames written agree with the nodes to 4e-13
before s&box sees them. s&box's own pictures of it are saved beside (`-o`). The pilot project: `smak_pilot`
(sbox-cli's addon template), beside this folder.

Not done of the phase: glTF written out (only read), and the Blender adapter as a general job runner (it runs its one
bake). Neither was needed for the pilot; Phase 2's motion base will say whether they are.

## Phase 2: pilot one, a sword swing in first and third person

The question: can the agent make a melee animation good enough for a modern game, from a base?

- A swing taken from a motion base (Quaternius's library, or a Mixamo clip the person downloads), retargeted to
  one skeleton in Blender, its root motion taken out, its feet locked.
- **The swing's spec**: its phases (wind-up, release, contact, follow-through, recovery) as times, the contact
  frame as an event, the arc the blade's tip draws, the windows a game reads (when it can be cancelled, when it
  hits). The edit is done to the spec, by code: timing curves, a held anticipation, a hit pause.
- **First person**: the same swing on arms seen from a camera; the arc measured on the screen (where it enters,
  where it crosses the centre). The camera's own motion (sway, a kick on contact) as parameters a game applies.
- **Checks**: foot slide, the ground passed through, joints over their limits, the contact frame against the
  spec, the loop's seam, the arc against the spec's screen region.
- In s&box, in rpg_sbox: the swing played by a key, in both views, hitting a target on its contact frame.

**Done when** the person plays it in s&box and finds it good enough to build on. If not, write down why, and
try the next base (a different clip, Cascadeur, a local text-to-motion model as a draft) before going on.

**Where it stands (2026-11-01).** First person is done by its "done when": the person played the five
Vermintide-style blows in rpg_sbox (attack1 the lights, attack2 held for a heavy's charge) and found them good. Each
carries its hit as an event, and a blade swept from that frame hits a dummy 0 to 3 frames after it. Getting there
took the blows ending as Vermintide 2's do, on a held pose the game blends from, and the tail after the cut-in point
measured against its corpus (anim/NOTES.md, steps 1x and 1y). Still open in the phase: third person (the citizen's
own swing is a stand-in; the real one is a swing from a motion base retargeted to a body, which the Blender job
runner and glTF writing now make possible), the camera's sway and kick, the arc measured on screen in s&box, and
our own arms (MSR's are a local test only).

## Phase 3: pilot two, a level from a description

The question: can the agent lay out a level that plays well, checked by measures instead of pictures?

- **The level description**: spaces (a room, a corridor, an arena, a yard), what links them (a door, a stair, a
  drop, a gate with its key), the pacing (where it is quiet, where fights are), encounter slots.
- **A style's metrics**, as numbers in a guide (and in a profile the checks read): the player's size, step,
  jump and speed for the engine; corridor widths, ceiling heights, room sizes, cover spacing and sightline
  lengths. Two styles to begin with: a fantasy dungeon and a sci-fi facility.
- **Built from a modular kit** (Kenney's or Quaternius's CC0 dungeon and sci-fi sets): pieces snapped on a grid,
  placed in an s&box scene through the editor (sbox-cli and s&box's own Hammer and scene tools), not written into
  `.scene` files by hand.
- **Checks**: every space reached on the navmesh, path lengths and loops against the description, sightlines and
  cover against the style's metrics, no spot stuck. Then bots walk and fight through it (specialists-next's bots)
  and SMAK reports where they went, where they died and how long a crossing took.

**Styles are a kind of game plus a theme** (decided 2026-11-01). The corpus's levels are tagged by kind and a
style's bands come from one kind, never pooled: a co-op campaign (Left 4 Dead 2, Vermintide 2: one route start to
end, wide for four, open spaces for hordes, one-way drops, few choices), a single-player linear level (Half-Life),
an arena (The Specialists: loops, several routes, sightlines) and RPG exploration (MSR: hubs, branches, dead ends
with rewards). The theme (fantasy, sci-fi) is the kit's. rpg_sbox's first dungeon: MSR's exploration, possibly
mixed with a co-op route and side areas (Vermintide 2 keeps 30 % of its floor off the path) if limits are found.

**Data before building** (decided 2026-11-01). Generation starts only when five things are in hand: bands per
kind (co-op, linear, arena, exploration done; rp-city for the H9 roleplay cities in progress); description formats
that pass their checks (dungeon done; city with layers, districts, quadrants, housing and the Nexus in progress);
the target engines' limits (Xash: BSP2, world extent, web-client budget); an inventory of SMAK's present generator
and of the New Byzantium generator built on it, each H9 complaint traced to its cause; and the new generator's
design written here (stages, their inputs and outputs, the checks at each), general enough for both a modular-kit
dungeon in s&box and a brush-built city in GoldSrc. Then a small first build (one city quadrant or the dungeon in
greybox) before full scale. The final test: a good New Byzantium (h9_tsrp_newbyzantium, HAVOC-NINE's roleplay
city).

Where the five stand (2026-11-01):
1. **Bands per kind: met.** rp-city is banded too (`levels/styles/rp-city.json`, `levels/notes-rp-city.md`), from
   three cities only, so it is held as a floor (below).
2. **Description formats: met.** The dungeon (`levels/specs/rpg-dungeon-01.json`) and the city
   (`smak-city-description/1`, `levels/specs/CITY.md`; `newbyzantium.json` PASSES `check-city`) pass their checks.
3. **Engine limits: met** for Xash/BSP2 (`levels/notes-h9.md` section 3, in `newbyzantium.json`'s `engine`). s&box's
   budget is not measured yet; the dungeon's first build measures it.
4. **The inventory: met** (`levels/notes-generator.md`).
5. **The design: written** ("The map generator", below), with open decisions for the person. Building starts when
   they are settled.

**Paused, 2026-11-02: the first New Byzantium build, judged.** The person paused the city work: a good attempt,
but what it cost did not give good results. All 9 tiles pass stages 0 to 10 and join into one map (16,481 brushes,
60 seam portals open, no leak; carved rock 6,051 of the 6,000 target, over by the last secret tunnels). The Core
compiled and loaded in H9's Xash client, where its scale was found interesting and the rest poor: stairs hanging
in the air as loose wooden steps, too dark, doors standing in air. Those three were fixed in the generator after;
the fixed Core was not walked again.

What went wrong:
- **The first real build was the largest test there is**: nine tiles, three layers, a niche engine. It should have
  started at one building or one street and grown.
- **Measures stood in for eyes.** Over a thousand checks passed while the map read wrong in game; the gates
  measured what was known to measure, and what failed was how it looked. The first walk came after the generator
  was built; it should come at every step.
- **Fixes one case at a time.** Each new tile brought cases the last had not, and each round of fixes cost 0.5-1M
  tokens. Called general, the rules were in practice fitted to New Byzantium.
- **Made by hand where methods exist.** Room layout and stair placement, where most rounds went, have published
  methods: constrained growth on a grid with a stairwell fixed through the floors (Lopes et al., GAMEON 2010), room
  graphs laid out from templates (Edgar, MIT), settlement generation (GDMC entries); Xu & Verbrugge (AIIDE 2025) has
  the same shape as this generator (rooms from a database, a constraint layout, repair by pathfinding).
- **Workers too large and too long**: contexts near 1M, hours a round, two on one file, stale artifacts.
- **Borrowed art**: the map's textures are other H9 maps' wads, not ours, which the client did not even load from
  where they sit.

What holds: the BSP and BSP2 readers, the compiler's engine option and 2cwldys/sdhlt (Xash, BSP2), the map
measures and the corpus, the staged artifacts with gates that fail in sentences, the rulebook's form (a source and
a note a rule), the tile join (`levels/tools/city-join.mjs`), and some general rules learnt in game: a stair in a
walled core with a closed soffit, lamps scaled to their space, a sky light, every door seated in its opening.

So: the city generator (`levels/experimental-city`, stages 1 to 10) is **experimental**, kept in the repository and not offered
as a feature; New Byzantium's description stays as a test case. Left unfinished: the secret tunnels' change (kept
under the slab, a check that one touches no other space but at its ends) was stopped half-way and is untested; the
selftest has 4 city tests failing (1178 pass): the rock term (122), the Core's stages 0-4 and the review pictures (both
from the connectors' and secret passages' seam paths), and the geometry edge cases (the half-done tunnels).

**The next attempt** (Phase 3 restarted at a much smaller scope): one building or one street on one layer, walked
in game at every iteration with the person's eye as a gate; a known layout method for rooms and stairs instead of
the present one; a token cap on every round of work. New Byzantium is taken up again from there.

**What the next attempt uses** (proposed 2026-11-02 from `levels/notes-prior-art.md`, a survey of what exists; not
settled with the person yet). Each New Byzantium fault has a published cure that is not one more rule:
- **A building as a room graph per storey**, as Infinigen Indoors and Holodeck represent one: a door is a relation
  of two rooms on a wall they share, at floor level; a stair is a link with a landing on each of its two storeys.
  Doors in the air and loose stairs can then not be written, rather than being found after.
- **Pieces joined by typed connectors**, as every generator that looks natural does (Dead Cells, Enter the Gungeon,
  Warframe, Minecraft's jigsaw, DunGen, Dungeon Architect): the generator decides the topology, authored pieces give
  the shape, a doorway joins only its match and is capped when unused; each piece placed relative to what it stands
  on (Gumin et al., SIGGRAPH Asia 2025), each edit checked before it is kept.
- **Floor plans by constrained growth** (Lopes et al. 2010): the stairwell reserved first and copied to every floor,
  rooms grown around it; Edgar's method (MIT, ported to JS) where rooms are templates with door slots.
- **A second walk test** that shares no code with `reachOf`: a navmesh by `recast-navigation` (MIT, Node) with HL's
  player, on the compiled map.
- **Light**: SDHLT's hlrad switches by default (`-ao`, `-bounce`, `-pcf`, texlights, a per-texture minimum, the sky's
  `_diffuse_light`), then lamps added where the compiled lightmaps fall short, and compiled again.
- **Modules made by hand** in TrenchBroom (its Half-Life config): stair runs, doorways with frames, room shells,
  facades, each looked at once and placed by SMAK on MESS's model (templates, scatter over surfaces, seeds). The
  same files are where the person finishes a map by hand.
- **Views to judge by**: storey cutaways, a plan per storey with a grid, a storey as text, eye-height shots at every
  door and stair (as WebitroHQ's minecraft-structure-mcp gives); a vision critic asked defect questions, never
  scores. TrenchBroom-MCP tried as an inspection station, pinned.
- **Libraries instead of hand-made maths**: Clipper2 for wall insets and door cuts, manifold-3d to check brushes;
  fine detail as `.mdl` props (Map2Prop's idea, native).

The first step is one building of two storeys with a stair, through the new stages, walked in game.

**First walk in game (2026-11-02, house-01 in Half-Life on Steam), and what it changed.** Built in `levels/assembly`
(README there): layout by constrained growth, 18 authored pieces the person approved, the assembler, diagnostic
views, a second walk test on a navmesh (`recast-navigation`). Every check passed; in game:
- **the entrance could not be passed**: one 64 edge left 36 between posts and frame, and the open leaf stood in it.
  Both walk tests had removed the leaf instead of opening it. Now: doors span two edges (64 clear with the leaf open),
  the walk runs on a variant with every leaf at its open position, and each doorway's clear width is measured;
- **windows looked like a way in and could not be broken**: their glass is a `func_breakable` now;
- **the house reads as a house but is not laid out as one**: a living room two cells wide wrapped round a kitchen in
  the middle. The layout used area ranges only, not what makes a plan read as a home ("spatial empathy": the person's
  word for what the survey's methods measure). Next, before the next walk, each as a measured check of the layout:
  1. **room kinds from the rulebook** (`levels/rules/architecture.json`: zone, `minSide`, area, `roomNeeds.window`,
     `circulation.noPassThrough`), in cells; every arm of an L at least `minSide`; a room's main rectangle most of it;
     domestic kinds the rulebook lacks (entry, landing, bathroom) added with their sources;
  2. **the privacy gradient** (Alexander 127): the door graph chosen from the room kinds when a description gives
     none, public at the entrance and private deepest; no private or service room passed through;
  3. **front and back**: the entrance on the side the description names as the street, the social rooms toward it,
     the kitchen and service behind, rooms that want windows on outside walls;
  4. **the view on entering**: from each doorway at eye height, what is seen (an isovist) and a focal point in it (a
     window, a lamp, the stair); a corridor's sight within the style's band from the corpus;
  5. **light from room to room**: the contrast between neighbouring spaces within a band per style.
  **Points 1 to 3 done (2026-11-02)**, as a style (`levels/assembly/styles/house.json`, read by `style.mjs`): nine
  rules, each with its source (Neufert's sizes through `architecture.json`, Alexander's patterns, or the walk above);
  sizes in cells computed from the rulebook's metres, not copied; `"doors": "auto"` and `"front"` in the description;
  the rules in the layout's search and in its polish. Measured on `levels/specs/house-02.json` (hall, living,
  kitchen, study; landing, three bedrooms, bath), 20 seeds: laid out bare, 1 of 20 keeps the style (39 failures:
  rooms narrower than their kind, the entrance off the front, the kitchen before the living room); with the style,
  20 of 20, 8 warnings left. The assembler's hull check then found what no plan showed: a kitchen's two doors at one
  corner, one open leaf across the other doorway; the layout now keeps each leaf's swept cells to itself
  (`checkLayout`). house-02 seed 16 compiled and walked (29 of 29 targets) and copied as `smak_house02.bsp`.
  Points 4 and 5 are next, then the bands from real plans (ResPlan, MSD) to replace judged values.
  Styles (Phase 7) are then the same method with another rulebook, bands and piece library: a dungeon or a medieval
  house (tension, enclosure, privacy, light that changes), an industrial complex (function, choke points as the door
  graph's articulation points, a service network beside the main one).

### The map generator (point 5 of "Data before building")

Designed 2026-11-01 from `levels/notes-generator.md` (the inventory and each fault's cause), `levels/notes-h9.md`
(Xash/BSP2 limits, H9's brief), `levels/notes-rp-city.md` and the style bands, the two description formats and their
checks, and the L4D2 and Vermintide 2 surveys. Nothing of it is built yet.

**What it is.** Deterministic code that turns a description into a level through stages in a fixed order. Each
stage reads saved files, writes one named artifact, and runs the checks that gate it; a failing check stops the
build with a sentence naming the thing and the number it wanted (as `check-city` does now). The generator follows the
description and the architecture rulebook (below) and nothing else: where they fix something it copies it and
checks it, where they leave a choice it decides by a written rule from a seed and records the decision in the
artifact. It never improvises outside them: a case no rule covers stops the build and says which rule is missing.
The same seed and inputs give the same artifacts, byte for byte.

**One core, adapters per engine.** Stages 0 to 9 are the core and know no engine: they work in cells and in the
player's hull, read from the adapter. The adapter does the geometry, the budget, the compile and reading the result
back. Two adapters to begin with: Xash/GoldSrc brushes (New Byzantium) and s&box kit pieces (rpg-dungeon-01). Code in
`levels/lib/gen/` until Phase 4 moves it to `src/core/`; one command runs the stages, resumes from the last saved
artifact, and stops at the first failing gate. Artifacts go to `<out>/<level>/NN-<stage>.json` beside the pictures.

#### The stages

| # | stage | reads | writes (artifact) | gated by |
| --- | --- | --- | --- | --- |
| 0 | description | the description, the rulebook, the targets | `00-description.json` (validated, defaults filled) | `check-city` / `check-description` PASS, the rulebook valid, every target with its source |
| 1 | site graph | 00 | `01-graph.json`: layers, districts, street nodes at positions and segments as polylines (bends for `winding`), the tile of each, the seam portals; for the dungeon, the space graph laid on the kit grid (positions solved, the format gives none) | segments cross only at nodes; the description's reach re-run on the placed graph; nodes ≥ `seamMargin` from a seam; every seam crossing at its portal (the portal tool's output, unchanged); no straight public run longer than the sight target; street length between junctions in its target |
| 2 | blocks and lots | 01 | `02-lots.json`: each block's outline (what the streets leave), cut into lots by the district's frontage; each lot an enterable building (named in the description) or a facade (a variant of the district's) | enterable buildings per layer ≤ the cap (10), ≤ `maxEnterableLotShare` of lots; a building in its block, on one tile, fronting its frontage; `blockFill`; no lot enterable that the description did not name |
| 3 | building programs | 02, rulebook | `03-programs.json`: per building its type, variant, storeys, homes, rooms (kind, size from the room table), circulation (lobby, stair, corridor), doors with owner groups | homes per layer and class ≥ the table; homes fit at `fill`; required programs present (the Nexus's ≥ 12 cells); every variant and sign once; room sizes ≥ the rulebook's minima for their kind |
| 4 | connectors and networks | 01-03 | `04-networks.json`: each connector placed at its stops (shafts and stairwells reserved in the buildings they pass), checkpoints at the stops they control with their program, the MSR's service hallways behind the streets, secrets | farthest walk to a public connector, measured along the polylines, ≤ the target; per layer pair the connectors and checkpoints the rules ask; a service run ≤ `maxServiceRun` with a post or office at each node, ≤ `maxServiceTotal` in all; each checkpoint has its reason; every secret found from a public way |
| 5 | floor plans | 03, 04, rulebook | `05-plans.json`: per building and storey, rooms as outlines in the footprint, doors between them, stairs stacked, windows; for the dungeon, each space's outline on the grid | the rulebook's circulation, adjacency and dimensions (below); every room reached from its entrance; rooms repeated ≤ 20 % by footprint, buildings 0; median room side ≥ `medianSideUnits` |
| 6 | palette and light plan | 05 | `06-surfaces.json`: every surface's role and texture (district, shared or faction palette, no fallback); lamps by floor area and kind | closed set (a surface with no role stops the build, naming it); a texture under one role; per slot ≤ `maxPerSlot`; districts of a layer share ≤ `maxSharedWallFloor`; wear falls and wealth rises upward; planned light in rooms ≥ the public ways' |
| 7 | wiring | 03-06 | `07-wiring.json`: the RP wiring contract (below) | names complete, unique, ≤ 31 characters; switches 35-55; switchable lights ≤ 32; every target exists; entities that stay ≤ the adapter's cap |
| 8 | dressing | 05-07, rulebook | `08-dressing.json`: furniture, props, signs, lamps' fittings, each by a placement rule | nothing in a keep-clear volume or across an opening (rulebook); a sign on a wall it can be read from |
| 9 | forms | 01-08, rulebook | `09-forms.json`: the mega-structure's forms (levels/notes-megastructure.md F1-F27) as convex parts in cells, family by family (a module each, `levels/experimental-city/forms-*.mjs`): first the deck family (piers, feet, girders, coffers, trusses, hung services, the fusion band by wealth, the deck's edge, oculi, the Nexus spine's drum) | nothing in a keep-clear volume, a carriageway, a mouth, an exit, a gate or what the stages before placed; every street walk kept; the checks M1-M7, M16, M18-M20; the tile's brushes and entities with the forms within its share |
| R1 | **review: plans** | 01-09 | pictures: top-down plan per layer and tile with the frame, each building's floors, sections up to the sky lid | the person approves (below); no geometry is made before |
| 10 | geometry (adapter) | 01-09 | Xash: a `.map` per tile (seams capped) and the whole `.map`; s&box: the scene, pieces placed through the editor | adapter's source checks: `checkPlan` (now blocking), every texture or material present, brushes and structural brushes per tile within budget, distinct heights per tile ≤ the rule, seams match face for face, every contract entity present |
| R2 | **review: geometry** | 10 | pictures: plans cut from the source, elevations of every street front, each building in section | the person approves; nothing is compiled before |
| 11 | compile (adapter) | 10 | the compiled level per tile (budget) and whole (play), `11-compile.json` | every limit under its value and the tile under its share; Xash: a full vis ran, leaves ≤ 25,000, the PHS under 192 MB |
| 12 | measure the built level | 11 | `12-measures.json`: the city or level measures of the compiled file, beside the description and the targets | as built = as described (buildings, rooms, named doors, switches, lifts, cells, secrets counted in the file); every target met (below); light in rooms ≥ on public ways; the rulebook's built checks |
| 13 | walk test | 11 | `13-walk.json`: a walk over the compiled geometry with the real player hull | every public node, entrance, room and hidden place reached from the gate and from the spawns (doors used, lifts ridden); the MSR network from the Nexus with public doors shut; walk to a connector at its target; no spot that traps a player |

(Stage 9, forms, was added on 2026-11-02 between the dressing and the geometry; the adapter's stages moved up by one, so
notes written before that date call the geometry 9, the compile 10, the measures 11 and the walk 12.)

A build counts only when every gate from 0 to 13 has passed for its exact inputs: each artifact records the hashes of
what it read, and measuring a stale file (as the old build's 0 hidden ways did) fails at once. The deploy step copies
a level to a game only then.

**What differs per adapter.**

| | Xash / GoldSrc (New Byzantium) | s&box (rpg-dungeon-01) |
| --- | --- | --- |
| units, hull | 1 cell = 128 units; hull 32 × 32 × 72 standing, 36 ducked, step 18 | 1 cell = 2.5 m on the kit's grid, storey 3.0 m; the hull read from the game's player controller, not assumed |
| geometry | rock carved per tile and layer (`carvePlan`, with the rules under "Brush economy"), building shells, detail interiors, SMAK's pieces; entities; Valve 220 `.map` | the measured kit's pieces snapped on the grid (floor, wall, door frame, stair, arch), each with its collision checked (the kit's notes list pieces whose hull fills their hole); placed through s&box's editor, not written into `.scene` by hand |
| budget | brushes, structural brushes, leaves, faces, clipnodes, brush models, entities that stay, light data, texture data, looping sounds, switchable lights, extent (`engine.limits`), and a brush entity in ≤ 24 leaves | pieces, triangles drawn, shadowed lights, navmesh build time: no numbers yet; the first build measures them and sets the caps |
| compile | hlcsg, hlbsp, hlvis (full), hlrad, `-engine xash`, BSP2; a tile alone with a fast vis for its budget | the scene saved and its resources compiled; the navmesh generated |
| read back | `readBsp`, which reads BSP2 since 2026-11-01, under `measure`, `city-measures` and `reachOf` | the scene's pieces and the navmesh, through the editor |
| walk | `reachOf` on the compiled BSP2 with hull 1 (and 3 ducked), doors used, lifts ridden; RCBot waypoints from the same walk | navmesh paths in the editor, then traces with the player's hull through each doorway |
| wiring | `func_door` named, use-only (256); `func_button` targets; lights styled 32-63; `func_plat` and `func_train` with stops; `multi_manager` | components on the scene's objects carrying the same names and groups |

#### The architecture rulebook

There is no architect on the project; a generator left to itself puts a crate across a doorway, a lamp in a stair's
headroom, a bedroom you can only reach through another. So the rules an architect carries in their head are written as
data, `levels/rules/architecture.json` (to write), shared by both descriptions and every adapter, and read by stages
3, 5 and 8. A description may tighten a rule; it cannot loosen one.

- **Dimensions**, each with its source, in metres and converted per adapter through the player's hull. Real
  references set proportions and sanity: Neufert's *Architects' Data* (room, furniture and circulation sizes),
  building codes (a stair's rise and run in the 0.18/0.28 m range, headroom over a stair 2.0 m, a door's clear width
  0.8-0.9 m). Game scale is larger than real and comes from the measured games: doors 1.42-1.80 m wide and
  2.39-2.74 m high in the three RP cities and 1.42 m in L4D2, alleys no narrower than 3.8 m (the cities' p10), stair
  risers 0.2 m (every kind's commonest). Where they disagree the game's number wins and the real one stays as the
  ratio (a stair no steeper than the code's). The rulebook also holds ceiling heights per room kind (a cell lower than
  a hall), window sills and heads, wall thickness, landing sizes.
- **Programs and adjacency.** What a building of each type holds, and what sits next to what: a shop's floor on the
  street with its back room behind it; a kitchen beside a dining or great hall; cells off a guarded corridor, never
  off the lobby; a bar's toilet off the barroom. What needs a window or a door to a street (a shop, a living room).
  From Alexander's *A Pattern Language* (1977): the intimacy gradient (public rooms at the entrance, private at the
  back, 127), short passages (132), light on two sides where the footprint allows (159), ceiling height variety (190).
- **Circulation.** Every room reached; none only through a private room (a bedroom, a cell, an office) unless the
  rule for the pair allows it (an en suite); a corridor no longer than its rule before a room, a turn or a window;
  every storey of a building on one stair at least, two past a size.
- **Keep-clear volumes.** Boxes no prop, fitting or brush may enter: a door's swing and its approach on both sides
  (the hull's width plus a margin, a hull's depth deep); every opening's full height and width; a stair's flight, its
  landings and the headroom over them; under and round each light fitting; in front of each sign and switch (its
  reading and use distance).
- **Furniture and props by rules only.** Against a wall, facing into the room; never in a keep-clear volume, across an
  opening or on a route's narrowest line; the rule says what a kind of room holds and how much of its floor may be
  covered. A prop no rule places is not placed.

The built checks (stage 12, on the compiled level, not on the plan): every prop's and fitting's collision box against
every opening and keep-clear volume, none overlapping; each door opened in the compiled level and passed by a hull
trace both ways; no face sharing a plane with another face of the same place (z-fighting) and no sign or switch face
covered or facing a wall within its reading distance; and stage 13's walk with the real hull (32 × 72 in GoldSrc, the
controller's in s&box), not a plan graph.

#### Review stops: the person as the architect's eye

The checks measure what can be measured; the person judges what reads as a building. Two stops, R1 and R2 in the
table: before geometry (plans per layer and tile, each building's floors) and before compile (plans cut from the
source, an elevation of every street front, each building in section). The pictures come from SMAK's own drawing
(`drawSource`, `planOfSource`) and a new plan view of the artifacts, each labelled with ids so a remark can name a
building or a room. The build pauses until the person answers; the answer is saved with the hashes of what they saw,
so a changed artifact asks again. A remark becomes a change to the description or the rulebook (never a hand edit of
an artifact), and a remark about something every check passed becomes a new check.

#### The RP wiring contract

What the map promises the game, written by stage 7 as `07-wiring.json` and as names in the level; scripting is the
game's job (an RP plugin reads the names). For a door: its name (`housing.doorNaming`: `{building}_{unit}` for a
home, `{building}` for a business, `{place}_cell{n}` for a cell), its owner group (residents, business, msr,
insurgents, city), its building, unit and zone, use-only and lockable. Zones: every building, district, public way and
MSR area with an id. Spawn groups: public spawns (≥ 64), grouped by layer and district and interleaved in the entity
order, as TS reads only the first 32. Cells with their doors. Switches with their targets (lamps, sounds, alarms) and
the ≤ 32 switchable lights. Lifts with their stops and call buttons. Secrets with their doors. The dungeon's keys, gates,
encounter slots and rewards are entries of the same contract.

#### Each fault, its cause, and what prevents it

| fault (notes-generator.md section 3) | cause in the old code | prevented by |
| --- | --- | --- |
| one room template on every front; 640 one-room buildings; 76 % of buildings and 81 % of rooms repeat | `frontage()` the only builder of enterable places: a column of box rooms, one door each, one front recipe | stages 3 and 5: buildings from types and programs, multi-room floor plans, a variant once; stage 12 holds repeats (rooms ≤ 20 %, buildings 0) |
| units fill the street length: 750 rooms, 85-95 % of fronts enterable | count = street length ÷ unit width, `BLANK` 5-15 % | stage 2: only the description's buildings are enterable (≤ 10 a layer, ≤ 35 % of lots); facades fill the rest; stage 12 counts them in the file |
| no closed palette: "whatever, anywhere" | per-room picks from city-wide lists, city-wide overrides, the carve's grey | stage 6: every surface from its closed set, no fallback; stage 10's texture audit; stage 12's district measure |
| networks stamped at fixed positions: 58,000 units of identical corridor, checkpoints where the frame put them | four-fold loops; no input says where policing is needed | stage 4: connectors at the description's stops, checkpoints with a reason at what they control, service runs broken every ≤ 24 cells |
| no door names, 8 switches, no lifts | no naming or wiring stage, no lift piece | stage 7's contract and its checks; a lift piece in each adapter; stage 12 counts names, switches and lifts as built |
| rooms darker than streets (36 against 55) | one lamp per room whatever its size, dim levels for half the rooms | stage 6: lamps by floor area and kind, rooms planned brighter; stage 12 measures rooms ≥ public ways |
| carved rock 16,037 of 24,910 brushes | the carve slices at every distinct height (~200) and at every 3,072-unit tile edge | "Brush economy" below: heights on a half-storey grid, buildings carved as one shell with detail inside, facades uncarved, 9 tiles; stage 10 counts structural brushes per tile |
| the walk test walked plan boxes | `walk.mjs` joins touching outlines of `plan.json` | stage 13: `reachOf` on the compiled BSP2 with the real hull |
| no check gates a build | checks printed, run by hand afterwards | every stage gates; a build counts and deploys only when 0-13 pass for its inputs |
| edicts held at 4,098, not reTS's 2,048 | the limit taken from gameinfo, not from reTS's send cap | the adapter's limit: entities that stay ≤ 1,650 (2,048 − 3 × 64 players − headroom), estimated at stage 7, counted at 10 |
| tiny rooms (median 24 m²) | width and depth lists of 128-320 and 160-512 units | the room table and the rulebook's minima (stage 3), median side ≥ 256 units (stage 5) |
| sight lines twice the cities' (58 m) | a lattice of straight lines across the city | stage 1: winding segments, jogs, and no public run past the sight target except named views |
| connector reach p90 94 m | connectors fixed by frame | stage 4 on the polylines, stage 13 on the geometry, both against the target |

#### Budget, not fill

Counts come from the description: the enterable buildings (≤ ~10 a layer), their homes and rooms, the connectors, the
checkpoints, the secrets. The generator adds no enterable place. Every lot without a building is a facade: the
district's wall with windows and a door that does not open, no interior. Streets, plazas and facades fill the
space; buildings never do.

**Brush economy** (Xash). The old build: 24,910 brushes, of them 16,037 carved rock and 7,732 detail; 37,863 leaves,
about 2.2 for each brush that is not detail. Leaves bind before brushes: at that ratio 25,000 leaves allow about
11,000 structural brushes. The targets, with a fifth of each limit kept for fixes:

| | old build | target, whole city | a tile (mean / the Core's cap, 25 %) |
| --- | --- | --- | --- |
| structural brushes (rock, shells) | ~17,200 | ≤ 8,000 | 890 / 2,000 |
| of them carved rock | 16,037 | ≤ 6,000 | 670 / 1,500 |
| detail brushes (partitions, slabs, stairs, trims, furniture) | 7,732 | ≤ 10,000 | 1,100 / 2,500 |
| brushes in all | 24,910 | ≤ 20,000 (limit 25,000) | 2,200 / 5,000 |
| leaves | 37,863 | ≤ 20,000 (limit 25,000) | measured whole only |
| brush models | 1,091 | ≤ 1,200 (limit 2,048) | 130 / 300 |

How the rock comes down from 16,037 to ≤ 6,000:
1. **Fewer distinct heights.** Every floor and ceiling on a half storey (96 units) inside its layer: L1 (0-512) at
   most 6 heights, L2 (640-1,408) 9, L3 (1,536-2,560) 11. The old build's floors stood on about 200 heights (its
   floors check samples ~200, notes-h9.md 4.3), and the carve slices the whole block at each.
2. **Fewer outlines.** The carve cuts the public ways, the building shells, the connectors and the service hallways:
   about 200 outlines for the city, against 2,673 spaces. A building is one shell of its footprint and storeys; its
   rooms are partitions and slabs of detail inside it, which cut no vis leaf. A building of more than about 150 m² a
   floor (the Nexus, the market hall) keeps structural walls between its big rooms, for vis.
3. **Facades are uncarved rock** wearing the facade's palette; windows, doors and trims are detail, counted in the
   detail budget.
4. **Fewer seams.** One carve per tile and layer, on 9 tiles of 5,120 units, against about 40 carves on 3,072-unit tiles.
5. **Fewer texture breaks.** The carve merges a piece upward only when its outline and textures repeat; a closed
   palette of ≤ 3 roles a slot changes texture less often.

The description's estimate (`ESTIMATE`, city-checks.mjs) has no term for the rock yet: it gives 12,071 brushes and
18,107 leaves without it. A term is added (brushes per outline corner per height band, and leaves per structural
brush) and its coefficients, with all the others, are set from the first compiled tile. If the Core's rock passes
1,500, the fallback is to build the streets' walls as world-brush shells instead of carving them; the first tile
decides, on numbers.

**Tiles.** For building, checking and budgeting only: the city is one BSP2 map. Nine tiles of 40 × 40 cells, each
built alone: its own `.map` with every seam portal capped by a sealing brush, compiled with a fast vis for its
counts, held to ≤ 25 % of each limit (`tiles.maxShare`). The seams are crossed only at the portals, at fixed
positions and widths, so a tile is rebuilt without its neighbours; the whole map is the tiles' fragments without the
caps, compiled once with a full vis, and its leaves are measured only there. The portal positions come from a tool,
`levels/tools/city-portals.mjs` (to write): it finds every seam crossing in a description (segments, connectors,
secret and MSR passages), writes their portals, and reports any it changed; `check-city` already fails a missing or
stale portal. The 52 portals in `newbyzantium.json` are regenerated with it and compared.

#### Targets: where each comes from

The rp-city bands (Alexandria, Paradise City, Xenon City: hand-made, but three maps and the H9 group's own) are a
**quality floor**, not a target (decided by the person, 2026-11-01). New Byzantium is meant to be a level above them, so
its targets also come from other games' urban maps (measured locally, measures only: L4D2's c1m2, c5m1, c5m4, c8m1,
c9m1, c10m4; Vermintide 2's Bogenhafen slum and city, Righteous Stand (`magnus`), The Screaming Bell, Festering
Ground (`nurgle`), A Quiet Drink (`dlc_celebrate_crawl`)), from Byzantine Constantinople, and from H9's brief. The
targets live in `levels/specs/newbyzantium.targets.json` (to write), each with its source, and stage 12 holds them.

| measure | rp-city floor | other games, urban | real city | New Byzantium target | source; above the references? |
| --- | --- | --- | --- | --- | --- |
| narrowest public way (p10) | 3.8-4.2 m | VT2 path width 3.6-5.8 m | Zeno's law (476-479, *Cod. Just.* 8.10.12): streets ≥ 12 ft (3.7 m) | alleys ≥ 4.0 m (1.25 cells) | the floor and the law agree |
| main avenue | widest street under sky 7.4-15.2 m | L4D2 floor width 10.3-16.4 m | the Mese: 25 m, porticoes of shops both sides, ~600 m Milion to the Forum of Constantine | one Mese of 25 m with porticoes (open decision: the description has 6 cells, 19.5 m) | real city; above |
| fora and plazas | 1-5 plazas of 215-296 m² | — | 4 fora in the *Notitia Urbis* (c. 425) | ≥ 2 plazas a layer (14 described), one forum a layer ≥ 600 m² | real city; above |
| sight (median) | 19-28 m | VT2 floor run 14-19 m; L4D2 32-69 m | — | 20-35 m; longer only at named views (the well, the Mese, the fora) | the floor plus landmarks; the old build's 58 m fails |
| walk to a connector (p90) | 27-45 m | — | — | ≤ 45 m on the geometry | the floor; the description's `maxWalk` of 32 cells (104 m) is looser (open decision) |
| rooms per building | 1-2 | — | — | median ≥ 3; homes with 1-4 rooms by class | H9's brief ("proper buildings"); above |
| median room | 25-64 m² | — | Neufert's room sizes per use | 25-64 m², minima by kind | the floor |
| repeats | rooms 5-20 %, buildings 0, brush models 31-62 % | — | — | rooms ≤ 10 %, buildings 0, brush models ≤ 35 % | above the floor |
| districts | 3-13 by palette | — | 14 regions | 13 measured, neighbours sharing ≤ 34 % of walls and floors | district identity; above |
| layers stacked | 3-5 floors over one another, span 34-72 m | VT2 height range 21-86 m | — | 3 layers over the Core, 65 m from the cistern to the Mese's roofs | verticality; at the top of the band |
| cistern | — | — | Basilica Cistern 138 × 65 m, 336 columns of 9 m, 5 m apart | the Cistern under the Hearth: columns 9 m tall, 5 m apart, its plan scaled to the tile | real city; a landmark |
| hidden ways | 5-15 | — | — | 27 (described) | H9's brief; above |
| alternate routes | loops 4-6 | L4D2 alternatives 1-5 | — | every pair of neighbouring districts joined by 2 routes that share no street | above |
| light | floor 55-94, rooms 68-93 above public 53-94 | — | — | floor median 50-65 (a night city, as asked), rooms ≥ public + 10, shadow ≤ 15 % | the floor's shape; darker on purpose |
| named doors, switches, lifts | ~99 all named, 38-53, 1-6 | — | — | 111 named, 44 switches, ≥ 6 lifts, one of 3 stops | the floor; lifts above |
| walked floor | 8,000-12,500 m² | L4D2 6,500-40,000 m² | — | from the description's own estimate ± 15 % | none: the references are 3-12 times smaller |

Where the city goes past the references on purpose: landmarks (the Mese, the fora, the cistern, the Nexus), interiors
of several rooms, district identity, verticality, secrets and alternate routes. The rest holds the floor.

Sources for the real city: the Mese's width and porticoes, Wikipedia, "Mese (Constantinople)"; the Basilica Cistern,
Wikipedia, "Basilica Cistern"; the *Notitia Urbis Constantinopolitanae*'s totals (14 regions, 4 fora, 322 streets,
52 porticoes), istanbultarihi.ist, "Politics and society in the early Byzantine capital (330-565)", and J. Matthews,
"Two Romes" (OUP 2012); Zeno's law, *Cod. Just.* 8.10.12, as summarised in *The Byzantine House (400-912)*
(austriaca.at) and Koç University's library guide to Byzantine Constantinople.

**Vehicles** stay an optional, unbuilt dependency: H9 has no car model and no driving code. Roads reserve the room
(widths, grades ≤ 0.15, turning radius 512, clearances, garages) where the description says, held by its vehicle
checks; every place is reached on foot and every layer pair is joined without its ramp. Nothing depends on cars.

#### The first build, then full scale

1. **Before it** (small, each with its broken case): the BSP2 reader under `measure`, `city-measures` and `reachOf`;
   the portal tool; the rock term in `ESTIMATE`; the rulebook's first version; the plan pictures for R1. All five
   done 2026-11-01 (`src/maps/bsp.mjs`, `levels/tools/city-portals.mjs`, `levels/lib/city-checks.mjs`,
   `levels/rules/architecture.json`, `levels/tools/plan-picture.mjs`); New Byzantium's spec was brought to the
   decisions (Mese, walk limits, gated upper city with 12 checkpoints, placement and rulebook checks).
2. **The Core tile (c1_r1) in greybox**, recommended over an edge tile. It is the heaviest tile (11 % of the brushes
   in today's estimate, 8 buildings, 17 nodes, all three layers), so its counts bound every other tile's; it holds the
   Nexus, the precinct and the 3-stop spine lift, the place H9 complained of most; and it has portals on all four
   seams. An edge tile (c0_r1, the Stacks) would be easier and would calibrate low. Greybox: the palette's textures
   on (they are a stage and a complaint), no props, signs' pictures, litter or sounds. **Done** when stages 0-13 pass on
   the tile alone (its 8 buildings as described, every door named by the contract, the Nexus with 12 cells, the
   spine lift riding its 3 stops, the walk reaching every node, room and hidden place, within 25 % of each limit), and
   the person walks it in H9's Xash and finds it worth dressing.
3. **rpg-dungeon-01 in greybox**, in s&box from the measured kit, in parallel. **Done** when its 24 spaces stand on the
   2.5 m grid, the description's checks pass on the as-built graph, the navmesh reaches every space with the gates
   holding until their keys and the drop one way, the built route is within 15 % of the described 260 m (direct
   124 m), the fantasy-dungeon bands pass, and the person plays it.
4. **Calibrate**: every `ESTIMATE` coefficient (rooms, facades, streets, rock, leaves per structural brush, entities)
   fitted to the Core's compiled counts, s&box's caps set from the dungeon's; `check-city` run again; any limit past
   80 % is answered in the description (fewer heights, simpler footprints) before going on.
5. **Full scale**: the other eight tiles, each through its gates alone; then the whole map with a full vis, and stages
   11 and 12 on it.
6. **The final test**: h9_tsrp_newbyzantium played on H9's server: it loads without the PHS skipped, the roam bots
   walk it, every target holds, and the H9 group finds it a good city.

#### Form, scale and the art kit (2026-11-02)

The first R1 of the Core showed what the earlier attempts lacked: every outline a rectangle, the deck a bare slab
with nothing holding it up, nothing bigger than a building, the sky capping the skyline flat. A city that reads as
part of a mega-structure, "too big for people", with no end in sight, needs three things the stages above do not yet
make. The data are in `levels/notes-megastructure.md` (forms, rules, scale illusion, cost) and
`levels/notes-art-kit.md` (what the clients have, coverage, what to make).

1. **Forms, not boxes.** A vocabulary of 27 forms built by "carve rectangles, add shapes" (a convex brush may be
   chamfered or a prism at no extra cost; only openings cut rock): deck piers with capitals every 6-8 cells and their
   feet in L1, girder ribs that make each street under the deck a nave of bays, coffers and trusses over the covered
   squares, services hung under the deck, facades fused into it, a worked deck edge, oculi, arcades and vaults, the
   Cistern's column forest, buttresses, balconies and cages, setbacks, corner pieces, gantries, the city wall with
   towers, domes over named programs, exposed cores (the Nexus spine, the Helix). Each becomes a rulebook entry with
   its source, and 21 checks (pier pitch, girder depth, a frame element every 8 cells under the deck, no unbroken
   facade past 4 cells at the street, a corner treatment a block, massing repeats, skyline heights, a view every 25
   cells) gate the stage that places it: stage 9, forms (built 2026-11-02, below).
2. **Scale illusion.** The space round the city (about 68 cells a side within ±32,768) and below z 0 holds what is
   seen and never reached: a sky rendered by us (a generated megacity of lit windows in haze, Blender, 1,024 rendered,
   512 shipped, 256 fallback), backdrop models as a fake 3D skybox (one entity each, no brushes), fog where the
   client draws it and fog cards where it does not, vertical voids, giant machines beside human-sized doors, far
   motion (trains, airships, blinking lights, distant sound), edges that are never flat walls, winding sight lines.
   Checked on the compiled map (stages 12-13): every sight line past 11 cells ends in sky, backdrop, fog or a facade
   with relief; no point sees more than 20 % of its layer; something moves in view of each main plaza.
3. **The art kit.** H9's clients have no Valve `halflife.wad`; the MSR's present look comes from a third-party WAD of
   unknown licence the old map embedded; 14 named textures resolve nowhere. The kit: about 130 textures (5.7 MB):
   our own MSR set and identity (eagle, banners, six posters), L1/L2/L3 surfaces, 12 mega-structure surfaces,
   insurgent marks, 42 signs and neon frames, decal textures as masked brushes; a red storm sky; about 8 models
   (the Column's crown, an MSR standard, camera, loudspeaker, barricade, canal skiff, hanging cables). About 56
   textures start from CC0 bases (ambientCG, Poly Haven) palettized to 256 colours, about 74 are painted. The
   description's `look` strings are the brief; stage 6's closed palette takes the kit's names, so geometry can be
   built and walked with on-client textures first and the kit swapped in without touching it. Cell fronts are real
   bars (`dimensions.cellBars`), a masked texture only where a tile is past its target and the guard post does not
   look.

**Cost.** The forms add about 3,800 brushes (nearly all detail) and the scale illusion about 380 and 110-155
entities. City-wide that is about 25,650 brushes against the 25,000 limit; the trades in the notes (room dressing
13 to 6 brushes, street props halved where forms replace them, balconies from the facade allowance, cheaper vaults)
bring it to about 21,550. The Core binds: about 5,870 after its trades, under its 6,250. All of it is uncalibrated
until the Core compiles.

**Decided (2026-11-02):** the sky goes up to about z 28 over L3 and the outer ring; about 21.5k brushes are
accepted (1,500 over the target is small), and if the Core's compile shows an error or a limit near, the furniture
goes to models then; facades fuse into the deck by wealth: Kowloon-like fusion for the poor apartment districts,
less as wealth rises; the MSR stays purple and gold, to be recoloured to H9's blue later (a palette change). **For H9:** how our WAD reaches clients
(their client, FastDL or embedded); whether `majestic.wad` may stay; whether their emblem is the one players know.

**Built (2026-11-02, first wave).** The sky: a layer's `sky` in the description (L2's ring and L3 at z 28; z 20 stays
L3's top for what is built and walked), held by `check-city` (a lid at or above its layer's top, one lid where a deck
layer's ring meets the layer above, inside the extent, towers to the sky less `topClearance` where they stand under
it, the ring's lid one more carve height in each tile that has some: every tile within `rock.maxHeights`, rock 3,504 to
3,828 city-wide, the Core unchanged); the Nexus's tower rises 7 storeys over its 3 to z 27 (48.8 m over the Forum, the
tallest thing in the city, a cell under the lid). Stage 9, forms (`levels/experimental-city/stage9-forms.mjs`, `forms.mjs`, one module
a family, the contract in `levels/experimental-city/ARTIFACTS.md`), its first family the deck (`forms-deck.mjs`): F1-F9 and F26
with the rulebook's new `forms` section (ACI 318's span/12 girders and short-column piers, the rest judged with their
reasons) and the checks M1-M7, M16, M18-M20 in its gate. Fusion by wealth: slum and low full (Kowloon: fused to the
soffit, a corbel course, cages by density), mid partial (a cornice at the roofline and the corbel course; a carved gap
would cost a carve height a roofline), high and elite a gap only at an existing carve height. Each layer names its
frame role (`frame-cement` on L1 and L2, `frame-marble-gold` on L3: M20's open question answered as a layer field,
the MSR's colours unchanged). No trade was needed in the Core: its deck family is under 200 brushes and the tile stays
under its 6,250 (the numbers are in 09's gate notes).
**Built (2026-11-02, the edges family).** `levels/experimental-city/forms-edges.mjs` (F10, F11, F12, F19, F20, F21, F25 and
section 7's means S1-S7, numbered after the notes' eight): L1's ways vaulted by chamfers with a rib every 6 cells or
closer (M17 kept at 6: the notes' trade of 8 would loosen it), the canal by segmental arches, the Cistern a column hall
at 2.5 cells with architraves for arches (the notes' trades 4: 2.5 cells, architraves), an arcade on one square a
tile, gantries out of reach, one-step daises (raised, never sunk), the city wall's towers on one rhythm round the city
(17.1 cells) with a door at each foot and relief where public floor reaches the wall, pockets of air beyond the wall
(z 20 to the lid at 28, 30 cells deep, their rock the map's) with skyline cards, a backdrop model, a train east and
west, an airship north and south, the front gate's road going on with lamps and fog cards, a bottomless shaft under a
grate in the Drain Market and the Hollow, fans and light shafts under the deck, strobes and searchlights on the wall,
four sound loops city-wide; worldspawn's `MaxRange` 32,768 and the sky `nbstorm` handed to the geometry in 09's
`world`. Its gate checks M14, M15, M17, M21 and the description-level parts of V3, V4, V7, V8; the sight-ray checks
(V1, V2, V5, V6, M21 on the map) are specified for stages 12-13 in `levels/experimental-city/ARTIFACTS.md`. Budget: what M14 and
M17 need is placed under the tile's limit, the rest within half of what the tile has left after the deck
(`forms.edges.maxShareOfHeadroom`), so the facade family keeps the other half. The Core reaches no side of the city
and the edge tiles' stages 2-8 do not run yet: the wall and backdrop were tried on fixtures (an edge tile's own site
and lots, stages 4-8 empty).
**On the first compile:** sky size and fog on H9's Xash, WADs found in `ts/maps/`, `infodecal`'s WAD, masked
textures' lighting, leaves a freestanding brush adds.

#### Decisions taken (2026-11-01)

The person accepted the recommendations:

- An apartment block counts as one of the ~10 enterable buildings a layer (29 buildings, 111 named doors); its homes
  are units inside, held by the housing table. To confirm with the H9 group, the one decision that is theirs.
- The first tile is the Core.
- Rock: the constrained carve with the five rules; world-brush shells only if the Core's rock passes 1,500 brushes.
- Interiors are detail inside a structural shell.
- `maxWalk` drops to 20 cells and the p90 walk to a connector is held at 14 cells (45 m) at stages 4 and 12; the
  Hollow and Palace Row get more connectors.
- The Mese alone widens to 8 cells (25 m) with porticoes.
- The dungeon's greybox uses plain blocks on the measured grid (or a CC0 kit) in the repo; the Synty set stays a
  local test only, under its licence, never committed.
- The wiring contract stays neutral JSON plus the names in the map. Who writes the RP scripting is still open (the
  H9 group runs AMX Mod X; Apollo-RP for TS keys its per-map SQL seed on door names); a seed writer would be an
  adapter over the contract, not part of the generator.

The New Byzantium build leans on SMAK's GoldSrc side (the .map writer, carvePlan, compile, BSP2 reading, the TS
profile), so those parts are the Xash adapter and stay in step with the core.

**Done when** the two greybox levels pass their checks and the person plays both and finds the layouts worth
dressing. What the measures missed (something the person disliked that every check passed) becomes a new check.

## Phase 4: the core rebuilt around glTF

Only after the pilots, which show what the core must hold.

- `src/core/`: the neutral model (mesh, skeleton, animation, material, events, hit boxes) and the level
  description. `src/goldsrc/`, `src/source/`, `src/sbox/` as adapters over it; the formats' readers and writers
  move there unchanged.
- **What a library or Blender does better is replaced**, measured first: the JPEG reader, mesh simplification
  (meshoptimizer), image work, the renderer for pictures (Blender's, or a small GPU renderer). What SMAK does
  that nothing else does stays: GoldSrc's formats, the checks against the game, the engines' contracts.
- **Specs validated by schema**: every spec (model, animation, level) has a JSON Schema; an error names the field
  and the value it wanted.

**Done when** the self-test passes on the new layout, Half-Life's 210 models go `.mdl` → glTF → `.mdl` and → s&box
unchanged by `sbox-check`, and `src/` is smaller than at 0.37.1.

## Phase 5: the bases library

- `smak bases`: an index of the bases SMAK knows, each with where it comes from, its licence (CC0, CC BY with its
  credit line, a store's licence, the person's own), its skeleton, style, scale and size. Searched by the agent
  ("a sword swing, two-handed", "a sci-fi door, 2 m").
- What the index holds, to begin with: Quaternius (models, the animation library), Kenney (modular sets), Poly
  Haven and ambientCG (textures, HDRIs), CMU's and 100STYLE's motion data. Mixamo and paid stores as entries the
  person downloads with their own account; SMAK never redistributes them.
- **A ledger per project**: every base a project uses, with its licence and credit, which the publish check reads.
  A base without a licence fails the check.

**Done when** the pilots' bases are all in the index and in rpg_sbox's ledger, and the publish check fails a
broken case (a base with no licence, a CC BY base without its credit).

## Phase 6: animation in styles

From pilot one, made general.

- **One humanoid map**: the bones of Mixamo's, Quaternius's, s&box's citizen, Valve's biped and GoldSrc's Bip01
  named to one set, so a motion moves between any two.
- **Styles as numbers**, measured from references the person picks: Half-Life's first person (sequences a game
  plays by name: draw, idle, fire, reload, holster; quick and snappy), Vermintide's (weight, light and heavy
  swings, a charge, block and push, the camera moved by the swing), a third person body for each.
- **Weapon sets**: a weapon's whole set of animations from a spec (what it does, its style), with the events a
  game reads, checked against the style's numbers.
- **Procedural layers** as parameters for a game's code: sway, bob, recoil, inertia, the hit pause.
- **Adapters for more bases**, each optional: Cascadeur (physics-correct poses), a local text-to-motion model
  (drafts only).

**Done when** a melee weapon (Vermintide's style) and a gun (Half-Life's style) each have a full set, in first
and third person, played in s&box, and the person finds them good enough to ship.

## Phase 7: levels in styles and engines

From pilot two, made general.

- More styles' metrics: a Half-Life style linear level, an arena shooter, an open fantasy town (from SMAK's
  existing town and house tools, which move onto the level description).
- The same description built by each engine's adapter: s&box (a scene), GoldSrc (a `.map` compiled by VHLT, as
  SMAK does now), and glTF for any other.
- Dressing after layout: props and lights placed by rules from the kit, checked so they block no path.

**Done when** one description builds in s&box and GoldSrc, and both pass the same checks.

## Throughout: tokens and errors

- `AGENTS.md` stays an index under 8,000 tokens; each area (animation, levels, bases, each engine) has one guide,
  read only when the task needs it. The areas are also packaged as agent skills (a guide with its scripts),
  and the MCP server's tools follow the same split.
- Every command answers in 5 lines or fewer when it passes; every checker has its broken cases; a new checker
  comes with them.
- After each phase, the sample of phase 0 is run again: tokens per task and tasks right first time, written here.

## Rules

- Commits and pushes only when asked. Version notes go in `CHANGELOG.md`.
- No game's own files in this repository or in anything shared; the publish check holds it.
- Credit stevenlafl (they/them) for their part, as SMAK's README does now.
- A base's licence is recorded before it is used.
