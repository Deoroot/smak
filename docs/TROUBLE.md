# What it can do, and when something is wrong

The table of what the kit can and cannot do, and what a message or a picture means when something goes
wrong. When a task needs something in the right-hand column, say so to the person instead of working round it
silently. A map's entities against its mod have a longer table in `docs/MAPS-MAKING.md` ("When something is
wrong"), `smak play` its own in `docs/PLAY.md` ("When it does not work").

## What it can and cannot do

| It can | It cannot |
| --- | --- |
| Read everything in a `.mdl`: bones, meshes, textures, animations (with their activity, how far they travel, their box), events, attachments, hit boxes, bone controllers | Read Source engine models (`.mdl` version 44+), or `.smd` / `.qc` source files |
| Write a whole new model from triangles, with bones and animations | Write an animation of several blends into a new model (one that is there keeps and takes them) |
| Give a model, new or old, what a monster has: hit boxes (yours, or the ones studiomdl would make), attachments, bone controllers, where it sees from, each animation's activity and travel | Take a walk's travel out of its frames: you give the frames walking on the spot and say the travel. Say what a mod's code does with an activity or a hit group: that is the mod's |
| Make a model from a Wavefront `.obj` file (Blender, a script, any tool), with its `.mtl` and PNG or BMP pictures | Read `.blend` files, or TGA pictures |
| Read a bought model in FBX (binary 7.0 to 7.7, and the text form), glTF 2.0 (`.glb`, `.gltf` with its `.bin`) or OBJ, with its PNG, BMP or JPEG pictures, and make of it a prop, a piece for `smak item`, or a model with the file's skeleton and animations (`smak import`, docs/IMPORT.md) | Read what docs/IMPORT.md lists as not read: cameras, lights, shape keys, a second set of texture coordinates, more than the first animation layer, Draco or meshopt packing, a lossless or arithmetic coded JPEG; keep more than 128 bones |
| Replace a mesh inside an existing model, keeping its skeleton and animations | Weight one vertex to several bones (the format has one bone a vertex) |
| Replace or add textures; recolour by palette; export and import PNG / BMP | Edit animations kept in separate `name01.mdl` files |
| Replace or add animations, and the events (sounds) on their frames | Show the engine's real lighting: its pictures are a plain stand-in |
| Add bones to a model | |
| Play a map in the game: the Steam game by its console (`smak play native`), or a browser build of Xash3D with Playwright (`smak play`, docs/PLAY.md): the game entered, walked, a fight fought, pictures and clips taken, every line it says written down, and a run passed or failed by those lines | Press a key, move the mouse or read where the player looks in the Steam game: `smak play native` plays it by its console alone (walks and turns by time, commands, its lines and its own screenshots); a fight's aim, `look` and clips want the browser build and Playwright, which are not part of the kit |
| Pose the animations kept in `name01.mdl` files wherever a model is posed: its pictures, `motionOverlaps`, `findPiston`, `footSlide` (`groups: sequenceFilesOf(file, src)`; the command line reads them beside the model) | Write them: they are read, and `reproportion` carries them through the bones untouched |
| Make a skeleton's bones longer or shorter (`reproportion`): every turn of every animation kept, those in `name01.mdl` files too, the feet on the ground and a walk's stride as long as the legs | Stretch a body's points with its bones: each stays in its bone's space, so a skinned thigh made longer parts from its knee |
| Say whether a figure belongs to a game's manner and where not: its style (52 measures), its texture as painting and its shape (silhouettes and mesh), each held against the game's own figures, with the part, band or texture at fault and what to do (`smak figure-judge`, `figure-texture`, `figure-shape`); the game's manner is its profile's (`figureStyle`: MSC, TS, Half-Life) | Ship a game's figures or their measures: the corpus is surveyed from the installed game into a library of the person's (`smak figure-survey`). Say whether the owner will like it: the judges tell manners between games, and a game from its remake only weakly; the looks are the owner's to judge |
| Hold a figure against a reference in the manner wanted: a picture of an atlas at its pixels a texel, masks cut from a screenshot, or a set of models; the model drawn in the reference's own pose and views (`masksLikeReference`) | Find the pose that matches a reference's picture: the pose is given (the bones' matrices, from a module of the person's) |
| Check a model against GoldSrc's and Xash's limits | |
| Draw a model from any side, or as the player sees a weapon, into a PNG | |
| Paint a model by where a point is on its body, across all its textures | Give the two sides of a body different marks where they share the same pixels of a texture, until one side has pixels of its own (`ownPixels`: a copy in a texture of its own) |
| Take out of rigid pieces the faces never seen in the animations (`cullHidden`), and give each piece as few triangles as keep its shape within a tolerance (`reducePieces`) | Tell what the game's own lighting shows: the faces are judged by whether they are seen, from many sides of many poses, not how they are lit |
| Take a bodypart out, the body numbers counted again (`removeBodypart`), and give the file its own name inside (`setModelName`) | Take one out where a body number the game asks for would then show another body: it is refused, unless told to renumber or to keep the bases |
| Add a body again as a new body in a texture of its own, and paint a garment on chosen islands of it | |
| Tell what an old picture is, pixel by pixel (mail, plate, a strap), as layers that every pass of paint reads, with the distance to their edges and their regions' places on the body | Tell what a picture shows without a rule from you: a layer is your function of colour, texture and place |
| Find a model's loose pieces and take them off; move a part between models on one skeleton | Put a body under armour that has none: taking such a piece off leaves a gap |
| Build a new shape from turned surfaces, tubes, ridges, bosses and thin sheets, each knowing where it is, and put it in a model as a new body on a bone | Bend a worn piece with the body: it hangs on one bone, as the game's own helmets and pauldrons do |
| Measure a worn piece against the head or body under it, and against the game's own of its kind | Tell whether it looks right on a moving body: draw the animations, and it still only shows in the game |
| Change a shape after its texture was painted, and carry the picture over to the new shape | Carry paint to a part that has no counterpart in the old shape: that is left to paint |
| Draw several models on one skeleton as one (a helmet on a head with an armour) | |
| Show models side by side in the person's browser, turning and animated | |
| Read everything in a compiled map (`.bsp`, GoldSrc's version 30): faces, textures, light, what is solid where, what is seen from where, entities | Read Quake's or Source's maps (versions 29, BSP2, `IBSP`, `VBSP`) |
| Draw a map: a plan from above with every entity marked, views from inside lit by the map's own baked light, several views in one picture, a side section with the floors' heights, the storeys side by side, a view through each doorway; what stands in it at its true size (its box, or its model where one is named, with its textures and their holes, in the body, skin, sequence, scale and angles its entity gives); its sprites and its sky's own picture, from the game's folders | Draw decals, a door open, an animation playing, or a monster's model that only its script names (unless you name it) |
| Walk a map with no game: which entities a player cannot reach on foot and why, which stand in something solid or hang, how wide and high each opening is, how far the walk is, where a player gets in and not out again (a one-way place), which floor is too steep to stand on, and with jumps what only a jump reaches | Play the rest of the game's movement: friction, a door's push, speed gained in the air, what a monster's AI or a script does. The walk test is geometry with the engine's numbers, never measured against the game |
| Change a compiled map's entities: move a start, add a monster, change a door's keys, take a point entity out | Change the brushes, the light or the visibility of a compiled map: that is a recompile from its source |
| Make a new map from brushes in a script, check it and draw it before any compile, and compile it with VHLT or SDHLT (outside programs) | Compile without VHLT or SDHLT; cut one brush by another (a box out of a box is `subtract`, which `carve` uses); place brushes by hand as an editor does |
| Read a `.wad`, take a map's textures out as pictures, and make a `.wad` from pictures | Show a door that opens, a trigger that fires or a script that runs without the game: they show in the game only (`smak play`, where the person has its browser build) |

## When something is wrong

| What you see | What it is |
| --- | --- |
| `the map LEAKS ...` (compile), `the map looks OPEN to the void` (plan) | The inside is not sealed from the outside by world brushes. Look at the wall near the point it names. Was a wall made a brush entity? Is an entity outside? Build rooms with `carve` (`docs/MAPS-MAKING.md`, "Leaks"). |
| `the texture X is in none of the .wad files given` (compile); a face in a flat colour, `facts.missing` (pictures) | A wrong name, or the `.wad` not given: `--wad`, `--game <folder>`, `wads`, `folders`. `smak wad` lists what a `.wad` has. |
| `N classes are in none of the definitions given`, `are not in the game's own program`; `N keys their class does not define`; `N entities name something no entity of the map is called`; a sentence with a reason in brackets (`... (a spawn area holds 32 monsters ...)`) | The map's entities against its mod (`map-check --mod`, `checkPlan(map, { mod })`): the game would drop or pass over each of these without a word. `docs/MAPS-MAKING.md`, "When something is wrong", has each; a reason in brackets is a rule of the mod's profile |
| A map's picture is dark, or black | It is the map's own light. No `light` there, lights buried in walls, or (all black, `LIGHT none` in `map-info`) a leak. A light added to a compiled map lights nothing: recompile. `--brightness 4` only looks. |
| `check-pvs`: `the median spot draws N faces ... over the budget`; `compiled without vis` | The first: the map draws too much from where players stand. Look at the heat map and the worst spots, then change the layout: bend straight streets into dog-legs so a street cannot be seen down its whole length; put a gate or a wall where two districts meet; make decoration `func_detail` (and the roofs' trim, which splits leaves); `-maxdistance` in hlvis with fog hiding the cut. Hint brushes added by a script made it worse in the measures (more leaves, more portals): do not add them blind. The second: run hlvis (`compileMap` runs it unless told not to). The default budget is a guess from one city; give the one the game has run well (`--budget-median`, `--budget-p90`). |
| `map-check` says a count is over what the engine holds | The map is too big or too finely cut for GoldSrc (`docs/MAPS.md`, "Limits"). Fewer, larger brushes; small pieces made `func_wall`; or Xash only (`--engine xash`). |
| `this needs the map compilers VHLT ...` | They are not installed, or not named: ask the person, then `VHLT_DIR` or `--vhlt <folder>`. Everything but the compile works without. |
| `not a GoldSrc map`, a version that is not 30 | A Quake or Source map, or a file cut short. Not read. |
| `the eye is in solid` under a view | `--from` is inside a wall or outside the map. Take a point off the plan, or `--at` an entity. |
| A moved entity is not where it was put, in the game | The game loaded another file of that name. Ask where the mod looks first. |
| `not a studio model, version 10` | A Source model, a sprite, or a `name01.mdl` / `namet.mdl` side file. Open the main file. |
| Meshes have `texture: null`; grey model | The textures are in `<name>t.mdl`. The command line reads them itself; in a script call `withTextures(src, readFileSync("namet.mdl"))` first. |
| `an animation kept in another file` | The model has `name01.mdl` sequence files. Read them by giving the files: `readSequence(mdl, name, 0, sequenceFilesOf(file, mdl))`; `poseAt`, `frameValues`, `posed`, `render`, `strip`, `motionOverlaps`, `findPiston` and `footSlide` take them as `groups`. They cannot be changed here; `reproportion` carries them through the bones, their files untouched. |
| An empty picture | A blank submodel. Use the right `--body`. |
| `the file is cut short or broken` | Something in it points past its end. Copy it again from the mod. |
| `the bodypart X has no submodel` | The engine needs one at least: give it one with no meshes. |
| A sword's `extra` or an axe's fittings refused | A sword's `extra` needs `tall: true`; an axe's turned parts and rings take a row of its texture each, ten in all (twenty-one with veins). A lattice grip in a colour of your own wants `mottle: "own"`. |
| Holes in the model in the picture | Triangles facing inwards. `check` counts them. If you built corners by hand, your `inside` point is outside. |
| A thin part is there from one side and gone from the other | A sheet with one face (a `plate` with no thickness, a quad by hand). Make it with `M.leaf`. |
| An open shape (a helmet, a cup) shows nothing inside from below | It has no inside faces. Give its `turn` a `lining`. |
| `smak: putBody: ... now colour another place` | The body you replaced was painted for another layout. `carryPicture` carries the old picture over. |
| A painted detail sits beside the part it was painted for after a change of shape | The same: the texture was left as it was. `carryPicture(old, new, { body, was, is })`. |
| A worn piece sits askew, too high, or the face shows through it | It was built along the bone's axis instead of where the game's own sits. Measure theirs (`boxIn`, `facingOf`) and check yours (`clearance`). |
| `graft: the target has no bone called ...` | The part hangs on a bone the other skeleton lacks. `{ missing: "ancestor" }`, or `together` for a picture only. |
| The new piece is back to front or upside down | The automatic fit chose the wrong turn (it happens with symmetric shapes). Use `place: "bone"`. |
| A model from an .obj lies on its side, or faces sideways | The file's up axis is not the one assumed, or its front is not towards `+z`. `up: "z"` / `--up z`, and `turn` / `--turn 90`. |
| A model from an .obj is a speck, or fills the room | The file's units: `scale` (39.37 for metres). `smak obj` prints its size in units. |
| `readObj: line n: the face names point ...` | The .obj is cut short or broken: export it again. |
| The piece is in the right place and huge or tiny | `size: "old"` against `size: "own"`. |
| `the looping animation X does not come back to where it starts` | Its last frame is not its first again. Make the last frame a copy of the first (docs/MODELS.md, "A monster from nothing"). |
| `N animations have a box of no size` | A file made elsewhere, or a box told as zero: `replaceSequence(mdl, name, { frames: readSequence(mdl, name).frames })` measures it again. |
| `hit box N is on bone M, and the model has ...` | A hit box (or an attachment, or a bone controller) names a bone that is not there: `setHitboxes` with a right list. |
| `it has no hit boxes: traces against it use the entity's box` | A note: a thing that is shot at usually has them. `hitboxes: "auto"`, or `setHitboxes(mdl, autoHitboxes(mdl))`. |
| `moves further than its scale holds` | Should not happen: `replaceSequence` and `addSequence` widen a bone's scale themselves. Tell the person; it is a fault in the kit. |
| `too long for one animation` | Over 64 KB of values. Fewer frames, or split it in two. |
| Texture looks blurry in the game but not in the picture | Larger than `gl_max_size`, or not a power of two. See `docs/ENGINES.md`. |
| A mark painted on one arm is on both | The two share the same pixels (`paint` reports it as `shared`). Give one of them pixels of its own first: `ownPixels(src, { islands: id })` (or `own` in `reskin`). |
| A hole where a piece was taken off | It was part of the body, not gear over it. Leave it on. |
| The model shows in the picture and not in the game | Run `check`. If it passes, the game is loading another file: ask where the mod looks first. |
