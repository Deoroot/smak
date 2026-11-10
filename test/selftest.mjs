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
  "00-architecture", // layers.json: every file in a layer, no import pointing up; orphans, budget and game names measured
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
  "160-maps-doors", // room before a door (check/maps/doorways.mjs): both sides of a clear door with room, a crate and a prop with no clip each found on their side, each door seen from both sides from where it is seen, map-doors' PASS and FAIL lines
  "183-form", // form: boxes measured against round things (axes, bare edges, silhouette), a chamfered box, profiles extruded and swept into brushes and meshes, the limits, check's form warning
  "174-pvs", // checkPvs: the faces drawn from where players stand, from the compiled visibility; BSP2 too; the heat map
  "189-make-builders", // the make layer's form builders: sloped faces wear their picture in their plane, turned snaps when told, frame places, roof, dome, arcade, tree, railing kinds, scale
  "190-exact-turns", // turned exact at any angle (the pieces of a form keep sharing their planes), snap on request through frame.place and arcade, dome exact, checkPlan's off-grid fact, compileMap's warnings grouped by kind; with VHLT_DIR an arcade at 12 degrees and a dome compiled rounded and exact, hlbsp's ambiguous leaves 0 for the exact
  "191-map-battery", // mapBattery and smak map-battery: every player-facing check over a built map in one place (reach, light, door and opening fronts, spawn looks, sky gaps, coplanar faces, PVS, budget, sweep, the compile's log) on the kit's fixtures; reachOf's room-sized floor not walked to as a warning, lightReport's boxes of any height and rooms not walked to, sweepOf's bound; with VHLT_DIR a door with a pillar before it compiled
  "192-map-coplanar-skygaps", // coplanarFaults (a brush entity's face on another looking the same way) and skyGaps from every eye on the kit's fixtures (a slit under a roof, an arch against a wall in the open), the CLI
];

// one after another: each file runs its cases as it is loaded, and the servers' cases wait for their answers
// `npm test` runs the fast suite (under two minutes, no compiler, every commit); `npm run test:slow` (`--slow`) runs
// every area. An area is slow when it took 5 seconds or more, timed on 2026-11-09 (SMAK_TIMINGS=1 prints each area's
// time): the ones that build whole sites and run their checks, or start many command lines. 107-broken-cases is slow
// too, 606 s, but its registry assertion (every checker has a broken case or a reason) stays in the fast suite: the
// cases are only registered there (SMAK_FAST=1, test/broken/case.mjs) and run in the slow one.
const slow = new Set([
  "108-play-native", // 50 s
  "11-commandline", // 6 s
  "18-tool-faults", // 12 s
  "19-example-and-kit-faults", // 21 s
  "22-maps-draw", // 19 s
  "23-maps-walk", // 9 s
  "44-maps-measure", // 7 s
  "80-map-overlay", // 5 s
  "107-broken-cases", // 606 s: the cases run only in the slow suite
]);
const everything = process.argv.includes("--slow") || process.env.SMAK_SLOW === "1";
if (!everything) process.env.SMAK_FAST = "1";

const timings = [];
const skipped = [];
for (const area of areas) {
  if (slow.has(area) && !everything && area !== "107-broken-cases") {
    skipped.push(area);
    continue;
  }
  const started = Date.now();
  await import(`./${area}.mjs`);
  timings.push([area, Date.now() - started]);
}

if (process.env.SMAK_TIMINGS) {
  for (const [area, ms] of timings) console.log(`TIME  ${String(ms).padStart(7)} ms  ${area}`);
}
if (skipped.length) console.log("\nfast suite: " + skipped.length + " slow areas left to npm run test:slow (" + skipped.join(", ") + "); the broken cases are registered, not run"); // prettier-ignore
finish();
