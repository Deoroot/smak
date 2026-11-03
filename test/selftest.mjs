// SMAK checked against itself, with no game files:   node test/selftest.mjs      (npm test)
// A model is made from nothing, then read, changed in every way the kit can change one, checked and drawn.
// Run it first on a new machine: if it passes, Node is new enough and the kit is whole.
//
// The cases are in one file an area, beside this one, and run in the order below. That order matters: the
// first case builds the knife model that the others start from, and a few later cases use what an earlier
// one found. What they share (the temp folder, `test`, `sure`, the knife) is in helper.mjs; the two
// fixture-*.mjs files hold the small models that more than one area uses.
import { finish } from "./helper.mjs";

const areas = [
  "01-format", // a model written from nothing reads back; check; poses; the mesh
  "02-images", // PNG and BMP, a picture with holes, a texture replaced
  "03-change", // meshes swapped and added, bones added, animations replaced and added, textures put inside
  "04-render-and-kits", // render, sheet, strip, uvMap; the axe and bow kits
  "05-workshop", // turned surfaces, creases, ridges, bands, bosses, a leaf, a tube
  "06-bodies", // putBody and carryPicture
  "07-wear", // a head in a helmet, one size to another, graft to the bone above, several models as one
  "08-place", // paint by place, loose pieces, graft by the bones' names
  "09-islands", // a picture's islands, paint by island, soft edges, passes, blur, copyBody
  "10-layers", // layers of a picture: values, distances, regions, busy, layerMap
  "11-commandline", // bin/smak.mjs
  "12-servers", // the viewer and the editor
  "13-editor-colours", // the editor's adjustments for chosen colours
  "14-orbit-and-normals", // render with a distance; copyBody with normals stored as nothing
  "15-obj", // Wavefront .obj files read, stood up and made into models; `smak obj`
  "16-mcp", // the MCP server: the protocol, the guide by section, info, check, render, and run
  "17-library-faults", // a file cut short, skins of two sizes, a texture given twice, a shape's own normals
  "18-tool-faults", // the command lines' wrong arguments, addresses a server cannot read, a taken port
  "20-maps-read", // compiled maps: read, entities changed and put back, contents, visibility, light, textures, .wad files
  "21-maps-make", // brushes, a map written and read, the plan check, the leak hint, the compile where VHLT is installed
  "22-maps-draw", // pictures of a map: views, plans, the source drawn; the map commands; the MCP tools on a map
  "23-maps-walk", // the walk test, entities at their true size, sections, storeys, views through openings
  "24-maps-mods", // entity definitions from an FGD and learned from maps, a mod's profile and rules, the files entities name
  "25-maps-seen", // a map's pictures with the game's files: models textured and posed, sprites, the sky, `{` holes
  "26-maps-play", // the walk test playing more: jumps across gaps, one-way places, slopes too steep to stand on
  "28-maps-profile", // a profile's ways out and the model it gives an entity; --mod on the picture commands
  "27-play", // the play driver: steps made actions, a map played through a fake driver, `smak play`'s refusals
  "29-monster-parts", // a monster's parts: hit boxes, attachments, controllers, an animation's travel and box, the floor's line
  "30-animate", // animations written as poses: turns in the model's axes, a leg bent to its foot, keys, the walk's measures
  "31-items", // a submodel added before the last bodypart and its bases, a piece laid on one that is there, an item's family, `smak item`
  "32-map-faults", // a walked floor at 0 asked as yes or no, entities switched off, markers and wiring, a counter with no brush, scripts placed
  "33-compile-light", // a compile seen to work and stopped at its time, the portals foretold, a draft; the light on a map's floors
  "34-fbx-read", // FBX read: binary (32 and 64 bit, zlib arrays) and text, polygons cut, texture coordinates turned, nodes placed
  "35-glb-read", // glTF read: a .glb and a .gltf with its .bin, a turned node, a picture inside, strips and fans, sparse numbers
  "36-import-model", // a bought model as a prop (true size, fitted, on its base) and as a piece (its grip found or told, a shield's face)
  "37-import-rig", // a file's skeleton, skin and animations made a studio model's, from FBX and from glTF
  "38-import-commandline", // smak import: a file, a prop, a folder with its sheet and table, --anim; smak item with a bought model
  "39-import-faults", // what the readers refuse and say: cut short, old versions, Draco, a .bin not given, a JPEG, wrong options
  "40-glb-write", // glTF written: a rig read and written back, bones, weights and a picture kept; a studio model as a .glb
  "40-play-heard", // the play driver hearing the game: until, expect, the view, a place, a session kept and served, the sheet
  "43-maps-reach", // a body by its name, a ladder off the grid, teleports, walls that give way, why each part of the floor is not walked to, a profile's lists
  "41-play-steps", // the play driver's later steps: from where an until hears, a tap, the view turned to a place, a block repeated, a run that stays
  "42-play-fight", // a fight played by one step: the nearest enemy found, faced and struck, heals, deaths, and what happened counted
  "45-map-small-faults", // stairs with no step level with the upper floor and treads on the grid, hlvis's time said and not foretold, one map's own scripts
  "44-maps-measure", // a map in numbers (widths, headroom, sight) and beside others; maps at one scale; views from starts together, a view of one colour left out
  "46-reskin", // an island given pixels of its own, a re-skin by rules with its pictures before and after, `smak reskin`, check --source
  "47-sequence-from", // an animation of frames of another, backwards or held; `smak sequence-add --from`
  "48-animate-hold", // a held thing aimed and gripped, a bone held at a turn of its own, the quaternions, a fall kept on the ground, yaw with a named view
  "49-compose", // a piece composed on an imported rig's parts before building; the workshop's skinned body
  "50-play-session-long", // a session's run quiet for long still answered (headers at once, a beat, no fetch); folders laid over, what changed put
  "51-map-bands-open", // a band left empty at a place on purpose, said by a key the bands rule reads: only the true faults told
  "52-play-fight-ways", // a fight that prefers a kind of enemy, sidesteps round a crowd to it, dodges a place it is warned of
  "53-play-runner", // a line said before its step, sections and a run from one, kept values, a travel, the summary, the script lint
  "54-play-fight-reach", // an enemy a fight cannot get at (passed over, stopped at, gone to, shot at), a ranged weapon drawn and put back, a quiet without its line, a census, a walk that moves nobody
  "55-map-encounters", // how a spawn area's monsters come (fired by what, seen appearing, back soon, races at war, a far reward), the recipes, a map's character
  "56-map-roleplay", // switched lights as the map starts, rooms carved in textures of their own, a map's wiring, a line of sight in one walk, The Specialists' profile
  "57-map-ground", // spaces of any outline carved, paths and curves, brushes turned, a cliff, maps from an SVG or a PNG sketch
  "58-map-viewer", // a map as a 3D scene, props held against the world (stuck, floating, facing a wall), the map viewer served
  "59-map-country", // cliffs that lean along an outdoor map's rock, the land round it as a model, ground that rises and falls, patches, paths, things strewn, ruins, houses, fences
  "60-reduce", // fewer triangles: the quadric reducer keeps a shape closed, its border, its volume and its charts
  "61-decompile", // a compiled map made back into a .map (Half-Life's frenzy where installed), recompiled, and measured against its original
  "62-sprites", // sprites made of layers of effects by rule: glows, flares, fire, beams, billows, blobs; measured against a reference; a .spr written as it is read
  "63-sounds", // sounds made of layers: a file written as it is read, measured, checked as the engine needs it, held against the game's own; a music track levelled by loudness
  "64-sound-shape", // noise shaped to a curve, a limiter, grains at a period, a sound's picture read back
  "65-mod-code", // a mod's entities read from its C++ source and an FGD written from them; Biped's bones in their languages
  "66-sky", // a sky made from words, written as the game's Targa files, its sides meeting with no seam
  "67-height-plan", // a height plan read back into open space, storeys over storeys
  "68-textures", // a wad spec: textures worn, in relief, made from another; each where a map shows it best, matched to a picture
  "69-reference-textures", // a photograph made a texture: its material found, filtered to Valve's range, laid as it is or aged
  "70-carve", // a shape carved from pictures' outlines, and the quadric reducer that brings it to its triangles
  "71-blob", // a soft body of one surface: limbs, eggs and a skirt blended round a skeleton
  "72-outline-parts", // which parts change a model's outline from some side, and which only cost triangles
  "73-firearm-kit", // a gun from the firearm kit, laid the right way up in another weapon's place
  "74-generated-character", // a character from a made shape on a base: fused limbs warned, its back and sides painted
  "75-model-specs", // a model spec: parts placed by words, characters on a game's skeleton, a weapon in a game's place
  "76-map-specs", // a map spec: rooms laid out by words, their ways, furniture, frames, light and focus, walked
  "77-props-look", // props as GoldSrc's look: crossed cards for a crown, a model's colours against Valve's
  "78-floorplan", // a map's space from a floor plan of height plans, and a texture lifted off its view
  "79-video", // a video of models and maps from a shot list: camera paths, a turntable, a GIF written here
  "80-map-overlay", // a map's edges laid over a picture of it, and the camera found that lays them best
  "81-rigid", // a bodypart added that keeps every body number, one taken out, the header named, rigid pieces laid into as many as the limits need
  "82-solids", // convex solids in plain JavaScript: closed, facing out, convex, their points counted
  "83-kitbash", // the kitbash kit's 45 parts: closed, within their reach, the same for one seed
  "84-linkage", // a piston across a hinge: the anchors on its axis found, animations kept elsewhere named
  "85-motion-overlaps", // pieces on bones driven into each other: a pair swung together caught, a pair apart not
  "86-unwrap", // pieces unfolded into nets on one picture: no texel twice, true density, mirrored halves on one
  "87-blender", // Blender found or not, its float pictures read, and a cube baked where it is installed
  "88-reproportion", // bones made longer and shorter: every turn kept, the feet on the ground, a walk that does not slide, rigid pieces whole; the feet's slide measured
  "89-animations-elsewhere", // animations kept in <name>01.mdl files posed by the pictures, the linkages and the overlaps
  "90-cull", // rigid pieces lighter: a piece shut inside another dropped, a face pressed on another taken out, shapes reduced within a tolerance
  "91-figures", // the figure judges: a figure's facts, its style, texture and shape measured and judged against corpora made here; a library surveyed
  "92-figure-profiles", // each game's manner for the figure judges: MSC, TS and Half-Life's profiles by name, file and object
  "93-figure-commands", // smak figure-survey, figure-judge, figure-texture, figure-shape and figure-validate on a library of the test's own
  "94-ts-map-spec", // The Specialists' map spec: its textures, ts_model props and rooms furnished by its uses; its models where the game is installed
  "97-ts-map-delivered", // a mod's map delivered as the .bsp alone: no .wad of its own, or its pictures put inside the .bsp
  "98-ts-map-breakables", // what breaks: furniture, prefabs and their pieces as func_breakable with their material's keys, a mod's over the kit's
  "99-ts-map-solid-props", // props a player cannot walk through: a mod's solid things clipped, turned as they stand; the rest walked through
  "100-ts-map-lamps", // a mod's lamps: every room's lamp a fixture of the game's light texture, lit as a texture light in its makers' colour
  "106-spec-lamps-fog", // a room's lamps as panels along its long side, sconces, chandeliers; fog, the mod's own
  "105-sweep-slab", // the sweep's drops: no fall through a slab a body does not fit on by a wall
  "104-fixtures", // lamps built as fixtures: a sconce on a wall facing any way, a chandelier; stairs of open treads
  "103-fitted", // a picture fitted to a brush: its corner on each face's, whole when asked, words that read on every side
  "102-marble", // marble: veins over clouded stone, as tiles, let be bright
  "101-ts-map-dressing", // rooms dressed as thickly as the game's: along every wall, crates piled, desks in rows, couches about a table, a room's density
  "96-map-teams", // a map's two teams as ts_matchmode splits them, its spawn file, sight and walks across; profiles by name, the game found, a mod's own dressing, lamp faces
  "95-rcbot-waypoints", // RCBot's .rcw read and written byte for byte; waypoints from the walk (a ladder, a jump, a crouching passage); smak map-waypoints
  "19-example-and-kit-faults", // the examples' wrong arguments and refused models; the kits' fittings and rings
  "108-play-native", // the Steam game's driver against a fake engine: the console loop, a command once, a map entered, its screenshot, its refusals
  "109-source", // the Source engine: VTF, SMD, a GoldSrc model ported to GMod and why it changes, VPK, VMT, compiled where GMod's studiomdl is
  "110-source-map", // Source's maps: the BSP written lump by lump and read back, its light, visibility and PAKFILE
  "111-source-game", // GMod while it runs: RCON against a server speaking it, a probe run end to end
  "112-sbox", // s&box: DMX of a mesh and an animation, ModelDoc's document, a material, a port compiled where s&box is
  "113-demo", // a GoldSrc demo read: each frame's view of the player, its command, the server's movement settings
  "114-model-light", // a model lit as GoldSrc lights one: the sky's or the floor's light, its shade, the map's light tree, the studio shader
  "115-sbox-map-state", // a map's animated, scrolling and added faces, a brush entity's slot for its state; on The Specialists' maps when found
  "116-level-styles", // levels tagged by kind of game, their measures in one vocabulary, banded per kind and never pooled
  "117-level-description", // a level described before geometry: spaces, links, keys and gates, drops, pacing; reach, strands, loops, dead ends and bands checked
  "121-city-description", // a city described before geometry: layers, districts, streets, homes, the Nexus and its checkpoints, tiles and portals, the engine budget checked
  "107-broken-cases", // every checker failing an input broken in one way, by the sentence it must give, and passing its twin whole
  "120-level-readers", // the level surveys' readers: a .phy's hulls placed as a static prop, ICE (L4D2's .nuc), director scripts, GoldSrc lifts
  "121-city-measures", // a role-play city's streets, buildings behind doors, layers and connectors, repetition, districts, light; the city kind's bands
  "124-bsp2", // Xash's BSP2 read beside version 30: told by its header, the same shape and numbers, 32 bit numbers kept, grey light, walked and checked
  "123-architecture-rules", // the architecture rulebook: valid, in each engine's units, tightened never loosened; doors, stairs, keep-clear volumes, programs, circulation; the two specs held to it
  "122-city-prep", // New Byzantium ready to build: the walk to a connector (20, p90 14), the Mese widened with porticoes, the rock term per tile, the portals regenerated, the gated upper city, placement on the plan, the rulebook's stair pitch
  "125-plan-picture", // the R1 review's plan pictures: a city per layer, tile and whole, a dungeon per storey; the same bytes twice, every building and connector by its id, review.json's hashes, a broken description refused
  "126-gen-site", // the map generator's stages 0, 1, 2, 4 on New Byzantium's Core: site, lots, connectors, checkpoints, hallways, spawns; the same bytes twice, stale inputs refused, each gate failing by its sentence
  "127-gen-buildings", // the map generator's stages 3 and 5 on all 29 of New Byzantium's buildings: programs and floor plans passing their gates, the same bytes twice, each gate failing a broken copy by its sentence, rooms per building, repeats, variety
  "128-gen-palette-wiring", // the map generator's stages 6 and 7 on New Byzantium's Core: every surface from its closed palette, lamps planning rooms brighter than streets, sounds and switches within the tile's budget, every door named in the RP wiring contract, the Apollo-RP seed; the same bytes twice, each gate failing by its sentence
  "129-gen-dressing", // the map generator's stage 8 on New Byzantium's Core: furniture and street props by rules only, clear of every keep-clear volume and opening, the walk kept; the same body twice, each gate failing a broken copy by its sentence (a wardrobe in a swing, a crate across a doorway, a table cutting a room in two)
  "130-review-pictures", // the R1 review drawn from the generator's artifacts: the Core per layer, in section through the spine and per building; the same bytes twice, every enterable building, connector, checkpoint and spawn by its id, review.json's hashes, an approval refused on a changed artifact, marks for a narrow room and a prop in a doorway
  "131-gen-brush-budget", // the R1 review's remarks on the Core: stage 8's brush budget counts a room's furniture once (the description's dressing allowance out for each room dressed, the props in), a dormitory under its maxArea with its reason, the barracks' dormitories within it
  "132-forum-tower", // the R1 review's remarks on the Nexus Forum: the square sized from data (an open span within the games' p90 sight, a wide one framed by a portico and a monument), the Nexus a tower under the sky and cheap in brushes, the rulebook's entries with their sources; stairs, bridges and hallways on the axes in the description, stage 4's routing and its gate, each failing a broken copy by its sentence
  "133-art-kit", // the art kit: GoldSrc texture names and sizes, the kit manifest, photos at the texture density, 256 colours with masked index 255 blue, four mips, the WAD round trip, ambientCG zips; each broken case by its sentence
  "133-art-emblems", // New Byzantium's emblems as vector art: the minimal SVG rasterizer (coverage, fill rules, masks, blur, transforms, what it refuses), the drawn alphabet, the three MSR and three Insurgent designs (the same SVG twice, inside their box, distinct at 64 px), a design made a masked texture in a WAD that reads back
  "133-sky-megacity", // New Byzantium's rendered sky: the tool's arguments, GoldSrc's face names and the engine's orientation per camera, the seam check catching a turned face; a tiny render where Blender is installed
  "134-gen-forms", // the map generator's stage 9 on New Byzantium's Core: the deck framed by piers, girders, trusses, coffers, services, the fusion band, oculi, feet and the spine's drum within the tile's brushes; the same body twice, a stale input refused, each gate failing a broken copy by its sentence (M1-M7, M16, M18-M20); the sky raised to z 28
  "134-gen-forms-facade", // stage 9's facade family on the Core: fronts broken by pilasters, pipes, bays, cages and buttresses, corner pieces, rooflines, setback tiers, the Nexus tower's crown, within the tile's brushes (enterable buildings paid from their facade allowance); the same body twice; each check failing a broken copy by its sentence (M8-M13, M18, M19, F16, F27, the frame's role, an allowance overclaimed, a form inside another); the rulebook's entries; a dome over a named room
  "135-room-caps", // the Core review's oversized rooms: room kinds capped from real data times the games' area factor with their reasons, a corridor's area and width cap; caps refused without a reason and never raised by a description; stages 3 and 5 failing a room or a corridor past a cap by its sentence; the layout holding a capped room under its cap; the description's buildings given rooms or a smaller footprint
  "137-gen-forms-edges", // stage 9's edges family: the Core's undercity vaulted (chamfers, ribs), the Cistern a column hall at 2-2.5 cells, fans and light shafts under the deck, worldspawn's MaxRange and sky; on edge-tile fixtures the wall's towers, the backdrop's pockets, cards and motion, a gate's road, a shaft, the canal's arches; each check failing a broken copy by its sentence (M14, M15, M17, M21, V3, V4, V7, V8, F25)
  "138-gen-way-colonnade", // the Mese's porticoes given their columns: stage 1's column lines (the inner line set back by the kerb, a column a pitch, the runs cut at the seams clear of the portals and short of the plazas, none in a side way's mouth), stage 4 clear of a door under the portico, the estimate counting them where they stand, the review's plan and section; each gate failing a broken copy by its sentence
  "139-gen-dressing-trade", // the room-dressing trade: the rulebook's dressing allowance by room kind (the RP rooms kept whole) and the props that make each room one; trimming after placing so a kept prop never moves, the Core's stage 8 within its allowances; the gate failing a bedroom without its bed, a shop floor without its counter, an office without its desk, a cell without its cot, a storeroom past its allowance
  "140-gen-geometry", // the map generator's stage 10, the Xash adapter: the Core as brush source (the carve clipped to the tile, shells of world with detail inside, streets, stairs, forms, the wiring contract by name), checkPlan, no leak, the counts within the tile's share, the carve's heights, the texture audit, the same .map twice, the R2 pictures, a changed .map stale; each source check failing a broken case by its sentence
  "141-gen-forms-edge-tiles", // stage 9 on the edge tiles' cases the Core never met, on small fixtures: the deck's edge over a facade lot cut across it (the fascia on the lot's top, brackets where it overhangs, M7 over the overhang), a nave's stations on one rhythm through a seam, a station sliding outward first (M6); the facade chooser's neighbours on every face, a filler drop pipe kept from breaking M11, a giant pilaster over the street's props (M9), a tier on the rock over a vault (M4 the deck's), two pipes at a point two ids
  "142-gen-edge-tiles-network", // stages 1-7 on the edge tiles: a winding lane capped at its portal vertex, the sky ring's facade heights, hallway bridges at the higher clearance, a hallway from its own seam and to the nearer post, a secret stub under the floor, a vehicle ramp as a helix, lamps off water and out of wells, the alarm in the Nexus tile, a second post _post_b
  "145-gen-room-pockets", // R2's room caps held: a room alone in a pocket past its kind's cap takes a part under it, the rest spare (a neighbour under its cap, a corridor bay, a loggia or a closed void); a stage-4 post stood past its cap kept against the lot's edge; a stair or a spine leaving a band too thin for a room passed over; the kinds that soaked the floor capped from data with their reasons; the MSR's buildings and the flats under their caps, the Nexus's program grown for its spare floor; each broken case by its sentence
  "146-city-join", // the city join: two small tiles capped alone made one map: the seam's caps off (the portal open), the outer caps and a deeper tile's cap under its shallower neighbour kept, a clashing name renamed with its references, the names shared by design kept, one worldspawn (wads merged in order, a conflict told) and one light_environment; the checks passing, the seam flood finding the leak a missing cap makes
  "150-assembly-layout", // levels/assembly: a building description checked (a room that cannot fit, a room no door reaches, a stair over two storeys, each by its sentence); constrained growth with the stairwell placed first, doors on shared walls, the same seed the same layout
  "151-assembly-pieces", // levels/assembly: the Half-Life piece library: every piece loads at its declared size, its textures in halflife.wad (a missing one by its sentence), pieces found by slot and corner mask, four quarter turns round-trip, a turned door at its connector, the stair's treads and landings flush
  "152-assembly-views", // levels/assembly: the diagnostic views: storey cutaways, plans with the layout overlaid (a raised door by its sill), floor heights (a lifted stair by its ledge), eye-height shots, the dark map (an unlit room)
  "153-assembly-navwalk", // levels/assembly: the second walk test on a navmesh (recast-navigation): a room up the stair reached, a sealed room not, a lifted stair breaking the walk by name, a door closed and open
  "154-assembly-assemble", // levels/assembly: a layout assembled from the pieces: piece counts by edge kind, every brush resting on its storey's floor, nothing on the stairwell's edges, the same .map twice, a door off its rooms' wall by its sentence; with VHLT and the game's wad, house-01 compiled with no leak and every room, door and stair end walked to
  "155-assembly-style", // levels/assembly: the style (styles/house.json) in cells from architecture.json, doors auto, house-02 laid out keeping its rules, and the bare layout breaking them
  "156-assembly-mese-pieces", // levels/assembly: the Mese's piece library for The Specialists: every piece within its frame, its textures in specialists.wad, halflife.wad and the H9 wad together, the doors, entrance and shopfront 64 x 112 clear with the leaf open and opened by use only, the shop window's glass breakable with 40 to climb through, column, architrave and portico meeting at 176, the stair the house's, the landmark in its 3 x 3
  "157-assembly-mese-layout", // levels/assembly: the Mese's buildings (styles/mese.json): a shop and a stair hall each with its own street door on the front, the shop's window beside its door, nothing opened in the blind walls, a blind front and a window on a blind wall refused by their sentences
  "158-assembly-mese-site", // levels/assembly: the Mese's site (site.mjs, specs/mese-01.json): five buildings along a street with porticoes, lanes and a square planned with every site rule kept, their properties, every leaf named for its property, the lamps out of the world; with VHLT and the three wads compiled, its rooms lit above its street, every room walked to
  "159-assembly-dress", // levels/assembly: the dressing (dress.mjs, dress/h9-byzantium.json): the Mese's site dressed for the H9 client with accent glows, looped ambient sounds and props, every prop the dress's and on its floor, every solid one clipped and none beside a doorway, the same dressing twice
];

// one after another: each file runs its cases as it is loaded, and the servers' cases wait for their answers
for (const area of areas) await import(`./${area}.mjs`);

finish();
