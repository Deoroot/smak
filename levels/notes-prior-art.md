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
