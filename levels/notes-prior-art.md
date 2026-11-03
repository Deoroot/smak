# Prior art for SMAK's maps: editors, engine plugins, methods, libraries, MCP servers

A web survey made 2026-11-02 after the first New Byzantium build was paused (PLAN.md, Phase 3), to see what exists
that SMAK should adopt instead of making. Three searches: editors and engine plugins; procedural methods, libraries
and compilers; MCP servers and AI-made levels. **Nothing here was installed or tried**; every entry is what its page
says. "Unverified" marks what the search could not confirm. Licences matter: GPL code is read and reimplemented,
never copied into the kit.

## The answer in short

- **Nobody else generates GoldSrc brush maps from a description.** OBLIGE wrote Quake 1 BSPs directly (3.57 to 6.x)
  and dropped every engine but Doom in V7; no version targeted Half-Life. Badger (Black Mesa VMF, a few HL1
  deathmatch samples) is the only HL procedural precedent found; its site failed TLS, unverified.
- **No Godot, Unity or Unreal plugin writes GoldSrc brushes.** The mature ones import `.map`/`.bsp` into the engine
  (func_godot, goldsrc-godot, Scopa, Tremble, HammUEr, Qnreal). The one exception to test is HammerForge (Godot):
  a brush editor with stair, arch and door-frame generators that lists "Quake `.map` export"; whether it writes
  Valve 220 that hlcsg takes is unverified. Godot's or Unity's CSG is not convex brushes, so authoring there means
  writing and keeping an exporter ourselves.
- **Each New Byzantium fault has a published cure that is not one more rule:**

| Fault seen in game | Cause | Cure found |
| --- | --- | --- |
| stairs floating as loose steps | stairs placed after rooms | stairwell reserved first and copied to every floor, rooms grown around it (Lopes 2010; Freiknecht 2019) |
| doors in the air | a door not tied to a shared wall at floor height | a room graph first, a door only as a relation of two rooms on a shared wall (Edgar; Infinigen Indoors; Holodeck) |
| too dark | compile settings and too few lamps | SDHLT's full hlrad switches; lamps added where the compiled lightmaps fall short, then compiled again |
| machine-looking, rules fitted case by case | geometry computed from nothing | hand-made modules (TrenchBroom) placed by SMAK; WFC or model synthesis over a dual-grid kit for facades and dressing |
| 1000+ checks passed, looked wrong | the checks were numbers, not views | diagnostic views (storey cutaways, plans with a grid, a storey as text) and a vision critic asked defect questions, not scores |

## 1. Editors, engine plugins, converters

| Tool | What it does | Licence, state | For SMAK |
| --- | --- | --- | --- |
| TrenchBroom (trenchbroom.github.io) | brush editor with an official Half-Life config: Valve 220, WAD3, models; linked groups (instances) and layers stored as `func_group` | GPL-3, 2026.2 | the module workshop and the person's finishing pass; SMAK writes layers and groups it opens; no scripting or headless mode |
| MESS (github.com/pwitvoet/mess) | GoldSrc preprocessor run before hlcsg: `macro_template`/`macro_insert` instancing, `macro_cover` scatter over surfaces, `macro_fill`, `macro_brush`, seeded expressions, `.map`/`.rmf`/`.jmf` conversion | C#, v1.2.3, active Apr 2026; licence not seen | the model for placing modules and scatter; either write its macro entities or reimplement the idea in JS |
| Map2Prop (github.com/Erty-Gamedev/Map2Prop) | brushwork to `.mdl` props, also as a compile step | C++ (Python repo archived 2025) | fine detail without clipnodes or leaves; SMAK writes `.mdl` itself, so the idea can be native |
| io_export_qmap (github.com/c-d-a/io_export_qmap) | Blender meshes to `.map`: each object its convex hull, Valve 220 UVs, detail flags, lights as entities | GPL-3 | detail pieces modelled in Blender as convex parts; hlcsg untested |
| QuakeBlend (github.com/Tzeentchnet/QuakeBlend) | imports `.map` and GoldSrc BSP v30 with WAD3 into Blender 5 | GPL-3, 2026 | rendered views of a built map |
| HammerForge (github.com/saworbit/hammerforge) | Godot brush/CSG editor, stair/arch/dome/door-frame generators, "Quake `.map` export" | MIT, ~1,300 commits | one test: does its `.map` pass `check` and VHLT? |
| func_godot, goldsrc-godot | import `.map`/BSP30/WAD3 into Godot (no export) | MIT | an independent lit viewer and navmesh walk via godot-ai |
| Cyclops, godot-map-builder, Scopa, Tremble, RealtimeCSG/Chisel, HammUEr, Qnreal, Brushfall | blockout or import only, no GoldSrc export | various | none |
| Sledge.Formats (github.com/LogicAndTrick/sledge-formats) | C# read/write of `.map`, RMF, `.ol` prefabs, VMF, BSP 29/30, WAD3, FGD | MIT | reference for reading J.A.C.K./Hammer prefab libraries (only ones whose licence allows reuse) |
| HalfLife.UnifiedSdk.MapDecompiler | BSP to `.map` | C# | study proportions of good maps; nothing of a game copied (rule 7) |
| bspguy / newbspguy | edit compiled BSPs | unstable | reference only |
| hlviewer.js, urgorri/goldsrc-bsp-viewer | BSP30 in the browser with lightmaps | MIT / unverified | a lit fly-through for the person before the game |
| ReyondBroom (TrenchBroom fork) | bevel, Voronoi fracture, rubble settle, arrays, prefabs | GPL-3; HL unverified | hand-made ruined modules |

Mesh to brush: no real convex decomposition into brushes exists. Parts modelled convex (io_export_qmap) work;
decoration belongs in `.mdl` props.

## 2. Methods, libraries, compilers

**Layout (rooms, doors, stairs).**
- **Lopes, Tutenel, Smelik, de Kraker, Bidarra 2010**, constrained growth (graphics.tudelft.nl/~rafa/myPapers/bidarra.GAMEON10.pdf):
  a grid over the lot, seeds by weighted adjacency, rectangular then L growth, gaps filled, doors from the graph;
  stairs and shafts placed on the ground floor first and copied up as fixed obstacles. No code; a few hundred lines.
  Camozzato 2015 extends it to arbitrary outlines.
- **Edgar** (github.com/OndrejNepozitek/Edgar-DotNet, MIT, C#): a level graph plus room templates with door slots,
  laid out by chain decomposition, configuration spaces and annealing; every edge a real shared door. 2D, so per
  floor; stairs as two-floor templates. Core about 3-5k lines, portable. Edgar.Godot exists; no JS port confirmed.
- **Freiknecht & Effelsberg 2019** (multistory with interior, stairwells placed, invalid placement impossible);
  **Merrell, Schkufza, Koltun 2010** (Bayesian program, Metropolis over floors; their own figure shows a stair
  blocked upstairs: check stairs after layout); **Xu & Verbrugge, AIIDE 2025** (arXiv 2508.18533: template
  databases, multi-floor arrangement, navigability repair; no code found).
- **Infinigen Indoors** (github.com/princeton-vl/infinigen, BSD-3): room adjacency graph, then shapes; doors,
  windows and staircases by room type and adjacency; several storeys. **Holodeck** (github.com/allenai/Holodeck,
  Apache-2.0): rooms as polygons, doors installed between rooms. The representation to adopt.
- **WFC and model synthesis**: mxgmn/WaveFunctionCollapse, merrell42/model-synthesis (a Rooms tileset),
  MarkovJunior (MIT, 3D rewrite rules, house examples), DeBroglie (connectivity constraints). Over a coarse grid of
  brush modules for facades and dressing; alone it gives "serviceable but unrealistic" plans.
- **Dual grid**: corner-valued cells pick a tile by marching squares, about 15 tiles instead of 47; each tile a
  hand-made brush group, so wall joins need no case rules.
- **Shape grammars**: ShapeML (GPL-3, CGA-like split/repeat/comp). A small JS subset for facades.
- **Cities**: Watabou TownGeneratorOS (GPL-3, frozen): wards by Voronoi, lots by recursive splitting; small enough to
  reimplement for the site and lot stages.
- **OBLIGE 6.x** (GPL-2): quest/room graph, a coarse seed grid, prefabs ("skins") stretched to fit slots, CSG brushes.
  The only mature brush-world generator; its prefab fitting suits the dressing stage.
- Learned floor plans (HouseDiffusion, GSDiff, FloorplanGAN): single storey, no stairs, RPLAN's terms; not
  recommended. ResPlan (CC BY 4.0) and Modified Swiss Dwellings (CC BY 4.0) as sources of room sizes and adjacency.

**Light.** SDHLT (github.com/seedee/SDHLT): `-ao`/`-aoscale`/`-aogain` (corner darkening), `-pcf`, studio shadows,
`%` or `info_minlights` per-texture minimum, `-bounce N`, `-extra`, texlights in `lights.rad`, `light_environment`
`_diffuse_light`. `compileMap` already takes hlrad arguments; New Byzantium used none of these but `_diffuse_light`.
Then place lamps by set cover: sample the walked floor, read the compiled lightmaps, add a lamp or texlight where
luminance falls short, compile again (Mücke & Gerlach 2023 do the same for Minecraft torches). ericw-tools has an
HL target but no `light_environment` (issue #437, July 2026): not a replacement. PrimeXT's compilers (Xash only:
`zhlt_texturestep` to 2, seamless luxels) if Xash alone is the target.

**Node libraries.**
- `recast-navigation` (MIT, runs in Node): a navmesh with HL's player (radius 16, height 72, step 18) as a second
  walk test that shares no code with `reachOf`; a loose step shows as an island.
- `clipper2-ts` / `clipper2-wasm` (BSL-1.0): insets for walls, door cuts, lot booleans, then convex partition.
- `manifold-3d` (Apache-2.0): booleans and hulls to check brush sets for overlaps and gaps.
- `z3-solver` (WASM; crashes reported in long processes in 5.2.0) or MiniZinc JS: room rectangles on a 16/32 grid
  as constraints. `vhacd-js` (BSD-3) only for terrain or organic pieces.

## 3. MCP servers and AI-made levels

- **mekedron/TrenchBroom-MCP**: TrenchBroom with an MCP inside, ~207 tools: brush CSG, offscreen snapshots,
  pick by pixel, rooms and openings found, free spots, walkability, z-fighting/leak/stretched-texture checks,
  compile and play presets including Half-Life. The author says no person reviewed the code; 0 stars. Pin and test.
- KyodanCFG/trenchbroom-mcp (Node, edits `.map`, three-view SVG preview), Sycatle/hammer-mcp (VMF lint, seal check
  without compile, gates in `docs/gates.md`), mcp-hammerplusplus, Mapwright (CS:GO KZ): lint and gate ideas.
- **WebitroHQ/minecraft-structure-mcp** (MIT): the best perception set found: `render` isometric with `cut_y`
  cutaways, `render_layer` (a plan with grid and coordinates), `render_region`, `layer_text` (a layer as a
  character map, exact and cheap), `check_walkable`; its app has the model render, critique and fix. The model for
  SMAK's own MCP views.
- godot-ai (already in use: `csg_manage`, `navigation_manage`, `editor_screenshot`, `project_run`) with func_godot:
  the independent viewer and walker.
- Render, critique, repair: SceneCraft (ICML 2024, no code), Scenethesis (ICLR 2026, a judge triggers targeted
  repairs), aDSL (arXiv 2608.17975, 8 views at 45°, stops when nothing actionable). **IR3D-Bench** (arXiv 2506.23329):
  self-correction by images plateaus when the views cannot show fine differences, so the views must be diagnostic
  (false colour by height, doors and stairs marked, cutaways, eye-height shots at every door and stair).
- Vision judges: agreement between models on aesthetics is near zero (GameUIAgent, α 0.023); they do find glitches
  (VideoGameQA-Bench). Ask defect questions ("does the stair touch a floor at both ends?"), never scores.
- BaronOfAI (Doom, forum write-up only): agents plan, a deterministic compiler makes the WAD under rules. The split
  SMAK's design already has.
- FPS evaluation: Cardamone et al. 2011 (bot deathmatch fitness), de Donato, Lanzi, Loiacono 2026 (arXiv 2605.30570,
  Map-Elites, topological and emergent measures). For deathmatch balance, later.
- GDMC is judged by people on adaptation, function, narrative and aesthetics: a rubric for the person's gate.

## 4. Projects like SMAK in any engine, and how shipped games look natural

Second round, the same day: level generation beyond GoldSrc, by code or not.

**Closest to SMAK.**
- **Xu & Verbrugge, AIIDE 2025** (arXiv 2508.18533; above): the same architecture with a curated library in the
  middle. The LLM fills databases of rooms and facilities offline and never draws geometry; room templates stacked
  on several floors, stairs as vertical links; tried in Unity.
- **Code2Games** (arXiv 2610.05033, github.com/AIGeeksGroup/Code2Games, open): a base world in Blender, an agent
  plans over a shared scene-and-play representation whose elements keep their identity, another adapts it to an
  engine; benchmark GameCode4D. The same "agent writing code over a kit" philosophy.
- **Dungeon Architect** (dungeonarchitect.dev, Unity and Unreal, paid, active): an abstract flow graph (paths,
  cycles, lock and key, validated) kept apart from the builders that make geometry (Snap Map sews hand-made modules
  by graph grammars; Snap Grid Flow does several floors) and from themes that dress by markers. SMAK's gated stages
  in production form.
- **SceneX / CityX** (arXiv 2403.15698, 2407.17572): an LLM plans over a documented hub of Blender procedural modules;
  cities 2.5 km across, no playable interiors.
- **MANSION** (arXiv 2603.11554): multi-storey buildings from language with stairs, lifts and shafts explicit
  (for AI2-THOR, not games): a stair is a piece with a footprint and a landing on both storeys.
- **DunGen** (Unity, used by Lethal Company) and **Minecraft's jigsaw structures**: hand-made pieces with typed
  doorways (a shape and size that join only their match) drawn from weighted pools, with a blocker or fallback
  closing any doorway left unused. Doors in the air are impossible by construction.
- **Dungeon Alchemist** (paid): a room's function (a tavern) decides its furniture, doors, windows and **lights**,
  learnt from hand-furnished examples; exports walls, doors and lights.
- marian42/wavefunctioncollapse (Unity, ~4,900 stars, inactive): an endless walkable city by WFC with backtracking
  over hand-modelled modules; it looks good because the modules are authored.
- AutoUE (arXiv 2603.07106, Unreal, whole games), Summer Engine (closed, claims; unverified), Roblox Cube (a scene
  graph in JSON, then objects; whole scenes still on its roadmap).
- **World models** (Genie 3, Muse/WHAM, World Labs Marble, Tencent HY-World 2.0): splats, video or meshes; none
  gives a level with doors, stairs and a navmesh one can trust. Reference pictures at most.

**Shipped games** (Spelunky, Dead Cells, Enter the Gungeon, Unexplored, Warframe, Caves of Qud, Townscaper and Bad
North, Minecraft's villages, Lethal Company, Diablo) share one recipe:
1. The visible geometry is authored: rooms, chunks and modules, tens to hundreds a tileset, each tested alone.
2. The generator decides topology, not shape: a flow (Gungeon's 4-8 hand-made flows a floor, Dead Cells' concept
   graph a biome, Unexplored's cycles, Warframe's mission chains) fixed before anything is placed.
3. Joins are typed connectors (doorways, portals, jigsaw blocks) with a cap when unused.
4. Coarse to fine: structure, then detail (WFC trained on small templates in Qud), connectivity, then dressing,
   light and population by markers from the room's function.
5. Variation inside a style: weights, variants, glue pieces and rest rooms; Townscaper's irregular grid.
6. Pacing measured apart (a director, density by length), not by geometry.

## 5. Research on reliable and natural generation

- **Surveys.** Gallotta et al., "LLMs and Games" (IEEE ToG 2024, arXiv 2402.18659): LLMs place space badly and do best
  as orchestrators of tools. Wen et al., "3D Scene Generation" (arXiv 2505.05474): only procedural methods give
  editable, controllable results. Withington et al. (arXiv 2404.18657): how to evaluate generators (expressive range,
  players, likeness to examples).
- **Gumin, ..., Ritchie, "Procedural Scene Programs"** (SIGGRAPH Asia 2025, arXiv 2510.16147): each object placed
  relative to those already placed (imperative) instead of declarative constraints and a solver; invalid layouts
  repaired by a search with no LLM that stays near the intent; people preferred it 82 % and 94 % of the time over
  declarative baselines. Anchor every piece to what is built: the most direct answer to floating stairs and doors.
- **Agentic PCG** (Jiang, Earle, Khalifa, Togelius 2026; github.com/JiangZehua/AgenticPCG): an LLM using local
  brushes, classic PCG algorithms and evaluators in a loop; checking each edit before it is kept is reported to
  raise exact matches from 9.4 % to 100 % (unverified). Gates at the edit, not only the stage.
- Siper, Khalifa, Togelius (CoG 2026, arXiv 2608.17947): the LLM writes generators, not levels; a library of
  abstractions found along the way improves every comparison.
- **WorldClaw** (Tencent, arXiv 2608.05248, code): agents look at renders and correct pose, scale and contact with
  the ground: the layer between "checks pass" and "looks right".
- **SceneEval** (WACV 2026, arXiv 2503.14756): support checked by rays and geometry, the vision model only naming the
  kind of support; collision, navigability, reach, out of bounds. "No collisions" is not "walkable".
- Vision models find glitches unreliably (GlitchBench: GPT-4V 43 %; VideoGameQA-Bench: 46 % on real subtle bugs):
  a second net, never the main check.
- **Light**: Seif El-Nasr's ELE (2005, tried in an Unreal 2 FPS): the level cut into visible zones, lights per zone,
  angle and colour optimised for visibility, depth, continuity, focus and key. The only serious game-lighting model;
  nothing recent on lighting for readability.
- **Space and intent**: Hullett & Whitehead's FPS patterns (FDG 2010, tested with players 2013: sniper spot,
  gallery, arena, choke point, split level); space syntax and isovists (Mawhorter & Guzdial, AIIDE 2026, arXiv
  2610.38987). A machine-made level tends to even visual integration with no focus or sequence; these are measures
  to compare with Half-Life's maps.
- **GDMC**: van der Staaij et al. 2023 (arXiv 2309.10871, winner 2022): settlements grown step by step by
  decentralised agents, so the irregularity has a cause. Salge et al. (arXiv 2108.02955) and FDG 2021: automatic
  measures agree badly with people on composed artefacts. The New Byzantium lesson, in print.
- CHI 2026 (arXiv 2602.14254): players cannot tell generated Sokoban levels apart, yet rate lower what they believe
  generated; an obvious defect costs twice.
- Learnt from human maps: DoomGAN (about 1,000 community Doom maps; topology features made maps more human-like);
  Sakana's Dream-Cubed (2026, 3D diffusion on Minecraft builds). No open dataset of 3D FPS maps exists.
- Wargaming's Smart Brush (arXiv 2503.19793): the AI roughens the surface, the designer keeps the structure.

**What the research says makes a level look natural**: physical coherence first (contact, support, nothing
floating), best had by building anchored rather than checking after; passing measures is not looking right, so
views are judged in the loop; irregularity with a cause (growth, terrain), not noise; intent readable in space
(patterns, a hierarchy of spaces, focus); light as design (zones, contrast, the path read); the LLM orchestrating
tools or writing code, every edit verified; human style learnt locally (pieces, WFC), structure by rules.

## What to adopt, in order

1. A building as a room graph per storey: doors a relation of two rooms on a shared wall at floor level, stairs a
   link with a landing on each of its two storeys. Doors in the air and loose stairs become impossible to write.
2. Lopes growth for floor plans, stairwells first; Edgar's method (ported) where rooms are templates.
3. `recast-navigation` as a second walk test.
4. SDHLT's light switches by default, and lamps placed from the compiled lightmaps.
5. A module library made in TrenchBroom, placed by SMAK on MESS's model (templates, scatter, seeds).
6. Diagnostic views in SMAK's MCP, and a vision critic asked defect questions; TrenchBroom-MCP tried as an
   inspection station.
7. Clipper2 and manifold-3d for polygon and brush maths; Map2Prop's idea for fine detail as `.mdl`.

To verify first: HammerForge's `.map` through VHLT; MESS's and TrenchBroom-MCP's licences; Badger.
