# SMAK: architecture and method

Agreed with the owner on 2026-11-09 (section 6 holds the decisions). It follows the audit of that day (four
read-only reviews: the map API, the levels pipeline, the checks and tests, the history and process), whose
findings are summed up in section 1. Sections 2 to 5 are the law of this tree; `test/00-architecture.mjs`
checks what a test can check of it. Section 4 says in what order the tree gets there.

## 1. What the audit found, in one page

- 160 k lines of code in 27 days, 259 k added and 4.6 k deleted: pivots were layered, never retired. The
  city path was built three times (spec maps, `levels/experimental-city` + `levels/lib`, `levels/assembly`)
  and three spec formats coexist. 55 to 60 % of the code serves no H9 map (Source and s&box ports, figures,
  the spec builder, the paused generator, the editor, MCP).
- The look of byz02 is structural: `levels/assembly` owns the world by 64-unit axis-aligned cells (GRID
  redeclared in 10 modules), districts and areas are rectangles, pieces turn in quarters, six fixed building
  programs share one stairwell and twelve wall pieces. No field can say a turned building, a bent street, a
  facade variant or a landmark. Moria (msr-web, 2026-10) looked right because it used the layer below
  (`src/maps`: carvePlan, sketchMap, turned, solid, prism) and free hand geometry.
- The rules are of the wrong kind: 451 failure sentences and 251 constants in `levels/assembly`, most of
  them shaping the look by predicate (a cornice on every front, a tower on every free corner, a lamp every
  five cells, Kowloon items by hash), several added as patches on symptoms (massing for the off-axis metric,
  teleport doors for jammed leaves, `glows: false`). Look bands were learned from Half-Life's campaign and
  TS arenas, never from an RP city on Xash.
- The faults are concrete: 59 of 132 dress models have no `clip` (the walk-through props); `doorClearance`
  exists with its test and the build never calls it; the build ends at the compile and runs none of the
  player-facing checks; props on public floor silently drop path nodes; sloped faces keep world texture
  alignment; `turned()` snaps to nothing and `checkPlan` then warns on every turned building.
- Of 101 checkers about 14 measure anything a player notices. Four generator tests have failed for seven
  days and 127 commits; no commit of the last 120 says the suite was run.
- The process had no stop where a person judges a plan before brushes exist: PLAN.md's R1/R2 stops were
  written on 2026-11-02 with the same diagnosis ("measures stood in for eyes") and never implemented. byz02
  went through 40 branches and 35 merges in three days; the owner's play after install was the only test
  of what was never measured. byz02's design document is not in the repository.

## 2. Architecture

### 2.1 Four layers in the kit, the game's content outside it, one direction

```
(a game project)   its own repository, outside this one: a game's pieces, dress sets, map scripts, RP data,
                   AMXX plugins. It imports the kit by file URL, as msr-web does for Moria.
cli/               bin/smak.mjs, the commands and the MCP server: thin, parse and call, print PASS/FAIL
check/             measures and checks, pure: of a .mdl, a .bsp, a plan, a dressing, a form, an RP contract
make/              builders, pure, returning data: brushes and maps, meshes and textures, the interiors factory
core/              file formats and math, pure: mdl, bsp, map, wad, spr, wav, png, bmp, vec
```

The rule: **imports go downward only.** A game project may import anything of the kit; `cli` imports
`check`, `make`, `core`; `check` imports `make` and `core`; `make` imports `core`; `core` imports nothing of
the kit. **Nothing of a game is in this repository**: no texture name, entity class, mod path, piece or map
of H9 (the owner, 2026-11-09: H9 was worked here to see what SMAK 1.0 could take from it; the kit keeps the
generic part, the H9 project keeps H9). A test (`test/00-architecture.mjs`) parses every import and fails on
the first edge that points up, and greps the kit for the game names it must not hold.

Today's folders map onto it like this: `src/mdl.mjs`, `src/maps/{bsp,lumps,wad,miptex,entities}.mjs`,
`src/{vec,pixels,image}.mjs` are `core`; `src/maps/{source,ground,profiles,pieces,relief,sketch,houses,
compile}.mjs`, `src/{mesh,workshop,paint}.mjs` and `levels/assembly/{layout,building,assemble,counter}.mjs`
are `make`; `src/maps/{check,plan,reach,doorways,budget,pvs,light,dressing,measure}.mjs`, `src/form.mjs`,
`levels/rp/*` (the checkers, with the plugin include contract) and `levels/assembly/dress.mjs`'s checks are
`check`; `levels/assembly/pieces/make-mese.mjs`, `levels/dress/h9-*`, `levels/specs/byzantium-*`,
`levels/art/h9-*`, `levels/rp/plugin/*` and `levels/notes-h9.md` go to the H9 project.

The H9 project: `C:/Users/User/Documents/Visual Studio Projects/h9-maps`, its own git repository, holding
`pieces/`, `dress/`, `art/`, `plugins/`, `maps/<map>/` (each map's script, PLAN.md, references, report) and a
`smak.mjs` that resolves the kit (the owner may rename or move it; the kit does not care where it is).

**The layers are declared before they are folders.** In P1 the four folders are not created. The tree still
holds the H9 content that P3 moves out and the duplicate builders that P2 retires, and moving every file twice
is churn for nothing. `layers.json` at the root maps each existing path (a folder or one file) to a layer:
`core`, `make`, `check`, `cli`, and `game` for what leaves in P3 (`levels/assembly/{pieces,dress}`,
`levels/specs`, `levels/art`, `levels/rp/plugin`, `levels/{styles,corpus,rules}`, `levels/notes-h9.md`, the
profiles of mods, the H9 build driver). The most specific path wins. A file that mixes two layers takes the
higher one: `check` above `make`. Examples may import anything. Test 00 fails on a file no rule covers and on
an import that points up. A debt that cannot be fixed by moving a function or splitting a file is written in
`layers.json` under `allowed`, with its reason and the step (P2 or P3) that retires it; an `allowed` entry
that no import needs any more fails the test. The physical move into `core/ make/ check/ cli/` happens in P3,
when the game content is out.

### 2.2 What leaves the tree

A branch `dormant/0.38` keeps everything as it is. The main tree drops, by moving to that branch:
`src/source` and `src/sbox` (ports, 12 k), `src/figures` (4.7 k), `src/spec` (12 k), `levels/experimental-city`
(6.2 k), `levels/lib/{city-*,plan-picture,review-picture,description*,architecture-rules}` (7.9 k), the L4D2 /
Source / VT2 survey code in `levels/lib` and `levels/vt2`, `anim/`, the live editor (`editor/`, in disuse;
the owner), the Blender jobs. About 55 k lines. **The MCP server stays** (`mcp/`, it is used; it is `cli`).
A thing comes back only with a consumer: a map or model the owner uses that needs it.

### 2.3 The size budget

The kit (`core` + `make` + `check` + `cli`) stays under **60 k lines**; tests under one line per line of
code; each guide under 300 lines. `test/00-architecture.mjs` prints the counts; over budget is a FAIL of
the suite, and the release that fixes it says what was removed. Until P3 it is a measure: the test prints the
lines of each layer and `NOTE budget`.

### 2.4 Three kinds of code and the rule of each

- **Formats** (`core`) change only when a real file broke, and the file (or a cut of it) joins the tests.
- **Builders** (`make`) are pure functions that return data; **one way to do each thing.** The audit's
  duplicates each keep one survivor: stairs (`stairs`), ground (`carvePlan` + `reliefOf`), rooms
  (`carvePlan`; `sketchMap` when relief and starts are wanted), cornice (`sweepProfile`), roof (a new
  `roof(outline, { pitch, kind })`), rail and bridge (`railing`, `bridge`), circle (`circle`). A builder
  never decides the look of a map by predicate: ornament, towers, lamps are asked for by the author per
  element.
- **Checks** (`check`) are `(data) → { failures, warnings, measures }`. Every FAIL names the thing, where
  it is, the number and **the limit's source**: an engine constant, a measured reference map, or a playtest
  fault with its date. A limit with no source is a NOTE. A band carries `{ n, corpus }`; with `n < 10`, or a
  corpus that is not the target game and kind (an RP city on Xash), it is a NOTE too. A check that can FAIL
  has a broken case (the existing rule, test/107); a NOTE does not need one.

### 2.5 The one pipeline of a map

```
reference   photos, a real map measured from above, the owner's words           R0
plan        a drawing, sizes, the landmark, the route a player walks; PLAN.md   R1: the owner says yes
compose     h9-maps/maps/<map>/<map>.mjs: the public realm written by hand over make/ (polygons,
            turned buildings, bent streets, terrain); buildings from the interiors factory
            (assemble(layout) → brushes + doors) placed into that composition by a frame
build       .map → compile → the post-compile battery on the .bsp: reach, doorClearance, propsOf,
            light, pvs, budget, clips → six eye-height views and one per door → report.md with pictures
walk        the owner plays it in H9                                            R2: faults → fixes or checks
```

`build` FAILs on any player-facing check; a WARN is not a pass. The RP layer (contract, paths, roam spots,
doors) reads the **built** map (the floor walk and the doorway list) and never the plan's cells, so it runs on
a hand-written map as on an assembled one. The report with its pictures is what the manager looks at before
anything is said to the owner, and what the merge message names.

**Gates arm at the step that makes them true.** In P1 test 00 fails only on the direction of the imports. The
orphans, the budget and the game names in the kit are printed as NOTE lines with their counts, and become
FAIL at P3, when the H9 content has left and the folders are the layers. Each has an `armed` flag in the test.

## 3. Method

### 3.1 The loop, with its stops

R0 reference, R1 plan approved, the build gate, R2 the owner's walk. No geometry before R1; no second slice
before R2 of the first. Each stop leaves a file in the game project, `maps/<map>/`: the references, PLAN.md
with the owner's answer and date, the build report, the walk's notes.

### 3.2 Who does what

One author per map, start to end. Workers (Sonnet) take pieces whose result fits in a picture: a model, a
texture, a check with its broken case, a builder with its test. The manager looks at the pictures, not at
the worker's account, and the merge message names the picture or the test. Two branches in parallel at
most; merges in series, each after the fast suite is green. Nothing reaches the game folder but by the
manager, with a backup, after asking.

### 3.3 Seven rules against accumulation

1. **No module without a consumer.** `test/00-architecture.mjs` lists modules no shipped map, model or
   command imports; an orphan goes dormant in the next release.
2. **No rule without a source** (2.4). A number nobody can trace is a NOTE.
3. **No pivot without a retirement.** A replacement deletes what it replaces in the same change.
4. **No new subsystem while the current map has an open playtest fault.**
5. **A fault found in play becomes a fix, or a check that measures that fault on the built file.** Never a
   rule on the plan, never ornament.
6. **Red suite, no merge.** The quarantine list is empty at every release.
7. **Every number in a plan is measured against a real map** (floor area, street width, walk to the
   landmark), as Moria was against Helena and Deralia.

### 3.4 Tests

- `npm test`: the fast suite, under two minutes (75 s measured in P1), no compiler, every commit. An area that
  takes 5 s or more is in the `slow` list of `test/selftest.mjs`.
- `npm run test:slow`: every area, with the broken cases run (they take 7 min; 17 min in all, measured in P1); before an install and before a
  release. The fast suite still registers the broken cases, so a checker with no case and no reason fails it.
- The four generator tests leave the suite with the generator (2.2). A failing test is fixed or removed the
  day it fails; it is never carried.

### 3.5 Docs

`AGENTS.md` stays the index, under 150 lines, and gains the row it lacks: a game's map from a compose script
in its own project (the interiors factory, the build with its battery, the RP layer over the built map).
One guide per task, reader-facing, under 300 lines, each naming the one way to do its thing (2.4). This file
is the law of the tree and is checked by test 00. `CHANGELOG.md` is history; `PLAN.md` moves to
`docs/history/`; a map's own plan and pictures live beside its script. README's numbers are generated by a
script, not typed.

### 3.6 Versions

0.39 "the pruning" (2.2, 3.4, 3.5); 0.40 the layers and test 00 (2.1, 2.3); 0.41 the builders and the
battery (2.4, 2.5); 1.0 is **a map the owner wants to play**, not a count of features.

## 4. Migration, in order

| step | what | gate |
| --- | --- | --- |
| P0, 1 day | branch `dormant/0.38`; drop the folders of 2.2 from main; take the four tests out; fix README and CHANGELOG; this file in | fast suite green |
| P1, 2 days | the layers declared in `layers.json`, not yet folders (2.1); `test/00-architecture.mjs` (direction fails; orphans, budget and game names measured); fast/slow split; approval hashes over LF text | test 00 green |
| P2, 2 days | `make`: `align: "face"` on slopes, `turned` snapping, `frame({ at, yaw })`, `dome`, `arcade`, `roof`; the duplicates retired; `check`: the dress clip gate, public-floor lanes, the post-compile battery and the views in `build`, bands demoted to NOTES | the battery FAILs today's byz02 for the faults the owner saw |
| P3, 2-3 days | the layer folders `core/ make/ check/ cli/` made and the files moved into them; test 00 arms the orphan, budget and game-name gates; the H9 project made (`h9-maps`, its own repository): pieces, dress, art, plugins, specs and notes moved out of this tree; the RP layer reads the built map; `assemble` as a factory placed by `frame` | this tree holds nothing of H9 (test 00); byz02's interiors rebuilt into a hand-laid test plaza, walked |
| P4 | the Byzantium plan: references, a drawing, sizes against a real map; R1; one plaza; build; R2 | the owner wants to play it |

Nothing of P3 or P4 starts before P0 to P2 are green. Each step is one release line in CHANGELOG.

## 5. What stays as it is

The interiors machinery (layout → pieces → checked doorways), the teleport doors, the RP contract and its
eleven plugins, the sewers and the metro as brush makers, BSP2 compile, budget and PVS, `map-view` (the
player's view, lit from the lightmaps), the form judge for models, `carvePlan` / `sketchMap` / `turned`.

## 6. Decided (the owner, 2026-11-09)

1. What leaves the tree goes to the branch `dormant/0.38`, not to deletion.
2. The live editor is in disuse and goes dormant; the MCP server is used and stays.
3. H9 is separate from SMAK: nothing of H9 in this repository. It was worked here to see what SMAK 1.0 could
   take from it; the generic part stays, the H9 part moves to its own project (`h9-maps`, the kit's choice of
   name and place).
4. The size budget is left to the kit: 60 k lines for `core` + `make` + `check` + `cli`.
5. The repository's documents are in English.
