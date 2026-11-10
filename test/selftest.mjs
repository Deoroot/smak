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
  "63-sounds", // sounds made of layers: a file written as it is read, measured, checked as the engine needs it, held against the game's own; `smak sound` and the loudness a judge measures
  "64-sound-shape", // noise shaped to a curve, a limiter, grains at a period, a sound's picture read back
  "65-mod-code", // a mod's entities read from its C++ source and an FGD written from them; Biped's bones in their languages
  "67-height-plan", // a height plan read back into open space, storeys over storeys
  "80-map-overlay", // a map's edges laid over a picture of it, and the camera found that lays them best
  "81-rigid", // a bodypart added that keeps every body number, one taken out, the header named, rigid pieces laid into as many as the limits need
  "82-solids", // convex solids in plain JavaScript: closed, facing out, convex, their points counted
  "83-kitbash", // the kitbash kit's 45 parts: closed, within their reach, the same for one seed
  "84-linkage", // a piston across a hinge: the anchors on its axis found, animations kept elsewhere named
  "85-motion-overlaps", // pieces on bones driven into each other: a pair swung together caught, a pair apart not
  "86-unwrap", // pieces unfolded into nets on one picture: no texel twice, true density, mirrored halves on one
  "88-reproportion", // bones made longer and shorter: every turn kept, the feet on the ground, a walk that does not slide, rigid pieces whole; the feet's slide measured
  "89-animations-elsewhere", // animations kept in <name>01.mdl files posed by the pictures, the linkages and the overlaps
  "90-cull", // rigid pieces lighter: a piece shut inside another dropped, a face pressed on another taken out, shapes reduced within a tolerance
  "105-sweep-slab", // the sweep's drops: no fall through a slab a body does not fit on by a wall
  "104-fixtures", // lamps built as fixtures: a sconce on a wall facing any way, a chandelier; stairs of open treads
  "103-fitted", // a picture fitted to a brush: its corner on each face's, whole when asked, words that read on every side
  "96-map-teams", // a map's two teams as ts_matchmode splits them, its spawn file, sight and walks across; profiles by name, the game found, a mod's own dressing, lamp faces
  "95-rcbot-waypoints", // RCBot's .rcw read and written byte for byte; waypoints from the walk (a ladder, a jump, a crouching passage); smak map-waypoints
  "19-example-and-kit-faults", // the examples' wrong arguments and refused models; the kits' fittings and rings
  "108-play-native", // the Steam game's driver against a fake engine: the console loop, a command once, a map entered, its screenshot, its refusals
  "113-demo", // a GoldSrc demo read: each frame's view of the player, its command, the server's movement settings
  "114-model-light", // a model lit as GoldSrc lights one: the sky's or the floor's light, its shade, the map's light tree, the studio shader
  "107-broken-cases", // every checker failing an input broken in one way, by the sentence it must give, and passing its twin whole
  "124-bsp2", // Xash's BSP2 read beside version 30: told by its header, the same shape and numbers, 32 bit numbers kept, grey light, walked and checked
  "133-art-kit", // the art kit: GoldSrc texture names and sizes, the kit manifest, photos at the texture density, 256 colours with masked index 255 blue, four mips, the WAD round trip, ambientCG zips; each broken case by its sentence
  "150-assembly-layout", // levels/assembly: a building description checked (a room that cannot fit, a room no door reaches, a stair over two storeys, each by its sentence); constrained growth with the stairwell placed first, doors on shared walls, the same seed the same layout
  "151-assembly-pieces", // levels/assembly: the Half-Life piece library: every piece loads at its declared size, its textures in halflife.wad (a missing one by its sentence), pieces found by slot and corner mask, four quarter turns round-trip, a turned door at its connector, the stair's treads and landings flush
  "152-assembly-views", // levels/assembly: the diagnostic views: storey cutaways, plans with the layout overlaid (a raised door by its sill), floor heights (a lifted stair by its ledge), eye-height shots, the dark map (an unlit room)
  "153-assembly-navwalk", // levels/assembly: the second walk test on a navmesh (recast-navigation): a room up the stair reached, a sealed room not, a lifted stair breaking the walk by name, a door closed and open
  "154-assembly-assemble", // levels/assembly: a layout assembled from the pieces: piece counts by edge kind, every brush resting on its storey's floor, nothing on the stairwell's edges, the same .map twice, a door off its rooms' wall by its sentence; with VHLT and the game's wad, house-01 compiled with no leak and every room, door and stair end walked to
  "155-assembly-style", // levels/assembly: the style (styles/house.json) in cells from architecture.json, doors auto, house-02 laid out keeping its rules, and the bare layout breaking them
  "156-assembly-mese-pieces", // levels/assembly: the Mese's piece library for The Specialists: every piece within its frame, its textures in specialists.wad, halflife.wad and the H9 wad together, the doors, entrance and shopfront 64 x 112 clear with the leaf open and opened by use only, the shop window's glass breakable with 40 to climb through, column, architrave and portico meeting at 176, the stair the house's, the landmark in its 3 x 3; the sewer's pieces in their own frame, its ladder's plate off the grid, its lids used and broken
  "157-assembly-mese-layout", // levels/assembly: the Mese's buildings (styles/mese.json): a shop and a stair hall each with its own street door on the front, the shop's window beside its door, nothing opened in the blind walls, a blind front and a window on a blind wall refused by their sentences
  "158-assembly-mese-site", // levels/assembly: the Mese's site (site.mjs, specs/mese-01.json): five buildings along a street with porticoes, lanes and a square planned with every site rule kept, their properties, every leaf named for its property, the lamps out of the world; a level below its street (its rules, ways down cut through the street, ladders and lids); with VHLT and the three wads compiled, its rooms lit above its street, every room walked to
  "159-assembly-dress", // levels/assembly: the dressing (dress.mjs, dress/h9-byzantium.json): the Mese's site dressed for the H9 client with accent glows, looped ambient sounds and props, every prop the dress's and on its floor, every solid one clipped and none beside a doorway, the same dressing twice
  "160-maps-doors", // room before a door (src/maps/doorways.mjs): both sides of a clear door with room, a crate and a prop with no clip each found on their side, each door seen from both sides from where it is seen, map-doors' PASS and FAIL lines
  "161-rp-contract", // the RP contract of a site (levels/rp/contract.mjs): every named door in one property of a known kind, the shops and homes, the places in their rooms, the roaming spots on public floor and the roambots' file
  "162-npc-sim", // the NPC plugin's offline check (levels/rp/npc-sim.mjs): the Mese's roles, homes and routes on walk, stair and plain-door links only; the same check failing by its sentence on a graph with its doors turned to lids, a home or a place with no node
  "163-rp-script", // the script plugin's offline check (levels/rp/script.mjs, `smak check rp`): the mtest script clean, the limits the plugin's own, a global file's unknown NPC a warning, a later checker plugged in, PASS and FAIL lines of the command
  "164-rp-items", // the RP items and shops check (levels/rp/items.mjs): the example catalogue and the mtest shop clean, buying and selling back never paying across shops, the plugin's table sizes the checker's
  "165-rp-law", // the RP law check (levels/rp/law.mjs): the mtest police station clean, inside the room and clear of the shop, the plugin's table sizes the checker's
  "166-rp-implants", // the RP implants and clinics check (levels/rp/implants.mjs): the example catalogue and the mtest clinic clean, no refund over the price, the plugin's table sizes, slots and effect keys the checker's
  "167-rp-jobs", // the RP jobs check (levels/rp/jobs.mjs): the example jobs and the mtest office clean, the office inside the room and clear of the shop, police station and clinic, the plugin's tables, formats, skills and permissions the checker's
  "169-assembly-chase", // what a city of chases wants (levels/assembly): an extra door between a shop's back room and its stair hall, a plain gap in a wall, the ground floor's glass sealed, narrow halls measured, a sealed mission arena, a police post's guard spawns
  "170-assembly-arenas", // the plans of a mission arena (levels/assembly/arena.mjs): room, yard, vault with its door, tunnel, a mini room, the spawns option, and the arenas and missions of byzantium-01
  "171-assembly-kowloon", // the Kowloon facade (levels/assembly/kowloon.mjs): switched on per building or district, seeded, only world brushes, nothing low over a street or in an opening
  "172-assembly-below-byz", // byzantium-01's level below (levels/assembly/below.mjs): low tunnels, high halls, loops, a way in every district and by each Hollow tower, the den's front flat the hideout's
  "173-assembly-terrain", // the ground heights (levels/assembly/terrain.mjs, specs/terrain-test.json): terraces, a ramp of 1:8, stairs with a landing, retaining walls, a canal with bridges, a stair into it and a culvert planned and assembled, a flat site left as it was; with VHLT compiled and walked
  "183-form", // form: boxes measured against round things (axes, bare edges, silhouette), a chamfered box, profiles extruded and swept into brushes and meshes, the limits, check's form warning
  "174-pvs", // checkPvs: the faces drawn from where players stand, from the compiled visibility; BSP2 too; the heat map
  "175-assembly-below-levels", // levels/assembly/below-levels.mjs: the sewers on several levels (levels/specs/below-levels-01.json): planned clean, loops, stair, brushes
  "177-assembly-shells", // levels/assembly/shell.mjs (levels/specs/shells-test.json): a building that is its facade only: planned with no room, door or property, the facade and a solid mass built, a locked door and dark windows with no entity, a walkable roof fenced in clip; the same site all-interior as the control; with VHLT compiled and measured
  "178-rp-below-levels", // levels/rp/deep.mjs: the sewers on several levels in the RP contract's walking graph (below-levels-01): nodes on each floor, links a hull walks clear of walls, columns and water, stair links between the levels and a ladder NPCs do not take, places and roaming spots on the floor, the plugin's caps and ROUTE_LEN held through npc-sim
  "179-assembly-heights", // the ground heights with everything a site uses (levels/specs/heights-test.json): a low and a high district joined by a ramp and a stair, buildings, shells, porticoes and a shaped plaza on each, the dressing and the RP contract at the ground, the sewers (a manhole in each district, a stair from the high one, 512 down) from the ground of their cell; with VHLT compiled and walked down to S1
  "180-assembly-roofs", // levels/assembly/roofs.mjs (levels/specs/roofs-test.json): routes over the roofs of a district: ladders, an outside stair, a crate climb and a drop up and down the walls, planks, jumps and a bridge across the gaps; the rails open where they meet, the heights and gaps held, each link walked alone with the walk test, the roofs in the RP contract for players only; with VHLT compiled and the rails, planks and jumps measured in the hulls
  "181-below-metro", // levels/assembly/metro.mjs (levels/specs/metro-test.json): a metro under the street: a wide entrance with an arch down to a concourse, passages onto the platforms of a station (a trench between two platforms, rails, edge strips, square columns, benches, a crossing, steps out of the trench), a line to a second station, a back passage; the rules of METRO held, the light cream and warm and never pink, the RP graph on platforms, crossings and concourse and none in the line, npc-sim; with VHLT compiled and walked from the street down to the platform, across, into the trench, along the line and out by the steps
  "182-metro-train-ride", // levels/assembly/ride.mjs: a parked train and its fake ride (zones, managers, the looping lining)
  "184-metro-doorways", // the car doorways as Cry of Fear inter_door: the in and out spots of each doorway, smak_tpguard.sma (the arrival guard) read and compiled
  "186-massing", // levels/assembly/massing.mjs: the shells' cornice, hipped roof, corner tower and battered foot as whole-number convex brushes off the axes, and fitBands (a band's picture on its brush); the site's off-axis share is held by the build of byzantium-02-spine, by hand
  "187-interiors-models", // levels/art/h9-interiors.mjs: the shelves, tables, crates, beds, wardrobe, rugs ... of the shops and flats: each passes check and the form band, the dress file holds their boxes, the rooms name only models it has
  "185-portico-alignment", // levels/assembly/porticoes.mjs: every column of every portico of mese-01 (and, with SMAK_PORTICO_BYZ=1, of byzantium-02-spine) under its architrave: shaft, capital and beam centred on its vertex within 1 unit
  "176-assembly-shapes", // levels/assembly/shapes.mjs (specs/shapes-test.json): a street at 45 and one at 24 degrees, an octagon plaza, an oval track round a spine and a raised concave court planned, assembled as whole-number angled brushes that tile their cells, the RP graph on their floors; with VHLT compiled and walked
  "168-rp-doors", // the RP doors check (levels/rp/doors.mjs): the byz01 doors file clean against the catalogue and an rp.json, every home offered has a key item, the plugin's tables, format and policies the checker's
];

// one after another: each file runs its cases as it is loaded, and the servers' cases wait for their answers
for (const area of areas) await import(`./${area}.mjs`);

finish();
