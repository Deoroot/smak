# SMAK: guide for the agent

SMAK (Studio Model Agent Kit) is a set of JavaScript modules for making and changing GoldSrc studio models (the
`.mdl` files Half-Life and its mods use for weapons, players, monsters and props) and maps (a compiled `.bsp`
read, checked, drawn and its entities changed; a new map made from brushes and compiled; `.wad` textures). You,
an AI agent, are its user: you write short Node scripts over the library, or run its commands, look at the
pictures it draws, and repeat until the work is right. The person you work for sees the result in their game.

This file is the index. Read the one guide your task needs (the table below), not all of them.

## What it needs

- **Node 18 or later.** Nothing else: no `npm install`, no browser, no compiler, no Blender, no studiomdl.
- **The mod's own model files**, for any work that changes an existing model. They are not in this kit. Ask the
  person where the mod is installed (for example `…/Half-Life/ts/models/`).
- A way for you to look at a PNG. You must look at what you make; see "The loop".
- **For a map**: the map's own file, and the game's folders when its textures are in `.wad` files (most maps').
  **To compile** a new map: VHLT (or SDHLT), an outside program the person installs once (`VHLT_DIR`); everything
  else about maps needs Node alone.
- **To play a map in the game** (`smak play`): the person's Steam game (`smak play native`, by its console), or
  their browser build of Xash3D and Playwright.

First thing on a new machine, from this folder: `node test/selftest.mjs`. It makes a model from nothing and
exercises every part of the kit. If every test passes, the kit works here.

## The loop

Every task goes the same way. Do not skip the last two steps: a model that parses can still be inside out, tiny,
or held by the wrong end, and only the picture shows it.

1. **Look at what is there.** `node bin/smak.mjs info model.mdl`, then `sheet` or `strip` to see it.
2. **Write a script** in a working folder of your own (not inside this kit) that reads the model, changes it and
   writes the result to a **new** file. It imports the kit by its file URL:
   `import * as smak from "file:///C:/path/to/smak/src/index.mjs"` (and a kit as `.../smak/kits/bluntkit.mjs`).
   A bare `C:/...` path fails on Windows, where Node reads `C:` as a URL's scheme, and the guides' `"smak"`
   resolves only in a project that has the kit installed as a package.
3. **Check it.** `check(mdl, "goldsrc")` in the script, or `node bin/smak.mjs check out.mdl`. Fix every error.
4. **Draw it and look at the PNG.** Compare with the picture from step 1, or with the reference the person gave
   (a photo, a section, a silhouette): against that, not against "looks like a bench". Iterate on the script.
   A `WARN: form:` line from `check`, `map-dressing` or `smak form` is part of what the picture shows: it says the
   thing is a pile of boxes (rule 9 below); act on it, do not report it as noise. A `WARN: motion:` line from `check`
   (a `FAULT` from `smak motion`) is part of it too: a pop, a stall, a joint bent the wrong way or a loop that does not
   close shows in the game before anything else does; `smak motion <mdl> --seq <name> --draw <png>` marks the frame.

Always start from the original file, not from your last output: every change appends to the file and leaves the
old data unused inside it, so stacking runs makes it grow. Keep the originals untouched and write elsewhere.
A map goes the same way: look, change, check, draw it and look; never write over a map of the game's.

Every command that checks something ends with one line, `PASS: ...` or `FAIL: ...`, and its reasons; the detail
goes to a file it names (`--verbose` prints it), and it says which picture to look at when one is needed
(`docs/COMMANDS.md`, "Answers in text first"). When a task needs what the kit cannot do (`docs/TROUBLE.md`),
say so to the person instead of working round it silently.

## Rules that keep a model working in the game

In full, with the reasons, in `docs/MODELS.md`.

1. **Never reorder or remove animations**: game code plays them by number. Replace one where it stands, or add
   after the last.
2. **Never renumber submodels, bones or attachments** of a model the game already uses.
3. **Keep an animation's frame count and rate close to the original** when the game times something by it; if
   you change its length, tell the person.
4. **Keep to the engine's limits**: `check` for `goldsrc` unless told Xash only (2048 vertices a submodel, 128
   bones). A replaced texture keeps its size; a new one is best 256x256 or 512x256.
5. **Keep texture names unique** inside one file, ending in `.bmp`.
6. **Never write over the mod's original files.** Write to a working folder; the person installs the result.
7. **Do not copy a game's models or textures into this kit** or into anything that is shared.
8. **A new model file has to be named when the map starts**: a new file name needs the mod's code or scripts to
   name it then; a file that replaces one the game loads needs nothing. Ask the person which it is.
9. **No bare box for anything a player looks at.** Checks measure validity, budget and walkability, never form, and a
   box always compiles, so a box is what an agent makes, and the person sees at once that a program made it. Start a
   form from a reference (a photo, a section, a silhouette) and compare the picture with it; chamfer the edges people
   look at (`box`'s `bevel`); give a long thing a profile and sweep it (`extrudeProfile`, `sweepProfile`; `lathe` and
   `sweepTris` for a mesh); a vehicle or a curved prop is a model, not brushes. `smak form` measures it beside
   Half-Life's own; docs/MODELS.md, "Form".

## Which guide to read

| The task | The guide | The template |
| --- | --- | --- |
| Re-skin a model: a texture recoloured or replaced, a game's monster re-skinned by rules, wear and marks, a garment over an old picture | `docs/RESKIN.md` | `examples/03-reskin.mjs`, `05-by-place.mjs` |
| A new model: from triangles, from an `.obj`, its animations, a monster; how a model is put together | `docs/MODELS.md` | `examples/01-new-model.mjs`, `06-from-obj.mjs`, `04-animate.mjs` |
| A new shape in a model: a weapon's mesh swapped, a helmet or a pack added, pieces taken off, paint carried to a changed shape | `docs/SHAPES.md` | `examples/02-swap-mesh.mjs`, `kits/` |
| A form that is not a pile of boxes: how boxy a model or a map's furniture is, beside the game's own; a profile swept, a chamfer, a lathe | `docs/MODELS.md`, "Form" | `examples/08-form.mjs` |
| An item (weapon, shield, bow) in a game's own model files, from a kit or a bought model | `docs/ITEMS.md` | `kits/` |
| A bought model (FBX, glTF, OBJ); art from a generator (a texture, a mesh) | `docs/IMPORT.md` | |
| An animation for the person's game: a first-person blow or reload, a third-person gait; the game's eye, key poses, a reference game's arm | `docs/ANIMATION.md` | |
| Look at a compiled map, check it, change its entities | `docs/MAPS-LOOKING.md` | |
| A walk test, and the other checks of a map with no game; how much of a map the engine draws (`smak check-pvs`) | `docs/MAPS-CHECKS.md` | |
| A new map in a script (and, before the first brush, `docs/MAPS-DESIGN.md`) | `docs/MAPS-MAKING.md` | `examples/07-a-small-map.mjs` |
| A map from a person's drawing | `docs/MAPS-SKETCH.md` | |
| Play a map in the game, and test by what the game says | `docs/PLAY.md` | |
| A sound file read, written and checked; a sprite file | `docs/SOUNDS.md`; `docs/SPRITES.md` | |
| GoldSrc against Xash | `docs/ENGINES.md` | |
| A compiled map in depth: lumps, pictures, waypoints, decompiling, entities against a mod | `docs/MAPS.md` | |
| Before a folder is shared: nothing of the game's in it, no personal path, no key (`smak check --publish`) | `docs/COMMANDS.md` | |
| Every command, and the options they share | `docs/COMMANDS.md` | |
| Every function | `docs/API.md` | |
| Can it do this? Something is wrong | `docs/TROUBLE.md` | |
| A client with no shell (MCP) | `cli/mcp/README.md` | |

## Changing the kit itself

The kit's modules are in four folders, one for each layer (ARCHITECTURE.md 2.1): `core/` (file formats and math),
`make/` (builders), `check/` (measures and checks) and `cli/` (the commands' helpers, the MCP server, the viewer). An
import points to the same layer or a lower one, never up; `node test/00-architecture.mjs` says so. `src/index.mjs`
re-exports them all and is the one entry; `bin/smak.mjs` is the command; `kits/` and `profiles/` are `make`.

A new checker (anything that answers PASS/FAIL, or reports errors or warnings) comes with its broken cases:
inputs in `test/broken/` with exactly one thing wrong each and the sentence it must give, and its line in
`test/broken/checkers.mjs`. The self-test fails while a checker has neither a case nor a reason written there.

## Handing work to another agent

When you give a task to a worker (a subagent, another model), as measured in `docs/history/PLAN-0.x.md` ("Which model does the
work"):
- **One task to each worker**, with the guide and the template it needs named, and the person's words about
  the look given as they were said. A worker that has to find its guide from this index spends most of its
  tokens doing so.
- **The worker's report quotes every `WARN` line as the kit gave it**, says what each check answered, and names
  the files and the pictures. A warning left unsaid is the most common miss.
- **You look at the pictures yourself**, against what the person asked, not against the worker's account:
  every check can pass on a shape or a material that is not what was asked, and a worker can describe what it
  meant to draw rather than what it drew.
- **Keep for yourself**: talking to the person, and anything that reaches their machine beyond the working
  folder (`smak play native --input` above all: ask them before each run).

In Claude Code, `.claude/agents/smak-worker.md` is such a worker, on Sonnet.

## Reporting to the person

They cannot read the model; you can. When you hand work over, say what file to put where, what you changed in
plain terms, what `check` said, and show them the picture. For several models, or anything that moves, start the
viewer for them (`smak view`) on the originals' folder and yours together. Say plainly what you could not verify: the kit's
pictures are not the game, and timing, lighting and how a weapon sits in the hand while moving only show there.
