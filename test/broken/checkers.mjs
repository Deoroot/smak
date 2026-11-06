// Every checker of the kit: a function or a command that answers pass or fail, or reports what is wrong (errors,
// faults, warnings). Each is to have its broken cases in this folder, by the name given here, or `none`: why it
// has none. A new checker goes in this list with its cases; 107-broken-cases.mjs fails while one has neither.
export const CHECKERS = [
  // ── models ──
  { name: "check", at: "src/check.mjs check" },
  { name: "compareContract", at: "src/contract.mjs compareContract" },
  { name: "keptWhole", at: "src/items.mjs keptWhole" },
  { name: "soundness", at: "src/sound.mjs soundness (shapeSoundness under it)" },
  { name: "seeThrough", at: "src/sound.mjs seeThrough" },
  { name: "motionOverlaps", at: "src/wear.mjs motionOverlaps" },
  { name: "objMeshes", at: "src/obj.mjs objMeshes" },
  {
    name: "readFbx, readGlb, importRigged",
    at: "src/fbx.mjs readFbx, src/glb.mjs readGlb, src/import-rig.mjs importRigged",
    none: "what they warn of is how a file of another tool was read (a layer passed over, a stretch lost, the feet off the floor): 39-import-faults.mjs holds their refusals (cut short, old versions, Draco, a .bin not given) and a file with no mesh warned of, each made in the case",
  },
  {
    name: "putBody, ownPixels",
    at: "src/bodies.mjs putBody, src/reskin.mjs ownPixels",
    none: "a tool's note on what it did (a texture of that name kept, a picture copied smaller), not a check of an input",
  },
  { name: "publishCheck", at: "src/publish.mjs publishCheck" },
  // ── levels/assembly ──
  { name: "checkLayout", at: "levels/assembly/layout.mjs checkLayout (its other sentences in test/150-assembly-layout.mjs)" },
  { name: "checkStyle", at: "levels/assembly/style.mjs checkStyle" },
  { name: "checkStyleBuilding", at: "levels/assembly/style.mjs checkStyleBuilding (through building.mjs checkBuilding)" },
  { name: "checkSite", at: "levels/assembly/site.mjs checkSite" },
  { name: "checkSpawns", at: "levels/assembly/site.mjs checkSpawns" },
  { name: "dressSite", at: "levels/assembly/dress.mjs dressSite" },
  { name: "laneProblems", at: "levels/assembly/dress.mjs laneProblems (a room's doorways kept open past its props' clips; dressSite's failures)" },
  { name: "checkBelow", at: "levels/assembly/below.mjs checkBelow (and readBelow, planBelow: the description's sentences, through planSite)" },
  {
    name: "siteLight",
    at: "levels/assembly/site.mjs siteLight",
    none: "it measures a compiled site's lightmaps, which the self-test cannot make without VHLT; where VHLT_DIR and the three wads are given, 158-assembly-mese-site.mjs compiles mese-01 and holds its rooms above its street (a draft compile, with no bounces, puts them under it: what the rule exists to catch)",
  },
  { name: "checkPaths", at: "levels/rp/paths.mjs checkPaths (the RP contract's walking graph)" },
  // ── maps ──
  { name: "checkPlan", at: "src/maps/plan.mjs checkPlan" },
  { name: "leakHint", at: "src/maps/plan.mjs leakHint" },
  { name: "checkEntities", at: "src/maps/rules.mjs checkEntities" },
  { name: "checkBsp", at: "src/maps/check.mjs checkBsp" },
  { name: "reachOf", at: "src/maps/reach.mjs reachOf" },
  { name: "doorClearance", at: "src/maps/doorways.mjs doorClearance (and smak map-doors over it)" },
  { name: "teamsOf", at: "src/maps/teams.mjs teamsOf" },
  { name: "spawnsOf", at: "src/maps/encounters.mjs spawnsOf" },
  { name: "propsOf", at: "src/maps/scene3d.mjs propsOf" },
  { name: "lightReport", at: "src/maps/light.mjs lightReport" },
  { name: "wiringOf", at: "src/maps/wiring.mjs wiringOf" },
  { name: "waypointsOf", at: "src/maps/waypoints.mjs waypointsOf" },
  { name: "scriptsPlaced", at: "src/maps/scripts.mjs scriptsPlaced" },
  { name: "scriptLint", at: "profiles/mastersword.mjs scriptLint" },
  {
    name: "compileMap",
    at: "src/maps/compile.mjs compileMap",
    none: "it runs the compilers (VHLT or SDHLT), which the self-test does not have; where VHLT_DIR names them, 21-maps-make.mjs compiles a room with a wall taken away and holds the leak the compiler reports, and that no .bsp is left",
  },
  {
    name: "measure, measureDressing, textureFidelity",
    at: "src/maps/measure.mjs measure, src/maps/dressing.mjs measureDressing, src/maps/fidelity.mjs textureFidelity",
    none: "measures held against another map's or a mod's bands, not checks of the map alone: a broken input would be a band set for the case, which tests the band and not the measure",
  },
  {
    name: "focusSeen",
    at: "src/spec/focus.mjs focusSeen",
    none: "the map spec's landmark seen from the ways in: it is asked only inside buildMapSpec, whose walk and sight 76-map-specs.mjs holds with a landmark hidden behind a wall",
  },
  // ── specs ──
  { name: "validateModelSpec", at: "src/spec/model.mjs validateModelSpec" },
  { name: "validateMapSpec", at: "src/spec/map.mjs validateMapSpec" },
  { name: "validateWadSpec", at: "src/spec/wad.mjs validateWadSpec" },
  { name: "validateSoundSpec", at: "src/spec/sound.mjs validateSoundSpec" },
  { name: "validateMusicSpec", at: "src/spec/music.mjs validateMusicSpec" },
  { name: "validateSpriteSpec", at: "src/spec/sprite.mjs validateSpriteSpec" },
  { name: "validateVideoSpec", at: "src/spec/video.mjs validateVideoSpec" },
  { name: "lookFaults", at: "src/spec/look.mjs lookFaults (lookSentence over it)" },
  {
    name: "buildModelSpec, buildMapSpec, buildWadSpec, buildSoundSpec, buildMusicSpec, buildVideoSpec",
    at: "src/spec/*.mjs build*Spec",
    none: "a build's report.ok is its validation and the checkers it runs (soundness, seeThrough, compareContract, reachOf, checkPlan, lookFaults, audio.checks), each with its cases here; buildSpriteSpec has cases of its own for the measures only it takes",
  },
  // ── sounds, sprites ──
  { name: "audio.checks", at: "src/audio/measure.mjs checks" },
  { name: "buildSpriteSpec", at: "src/spec/sprite.mjs buildSpriteSpec (its faults)" },
  // ── figures ──
  { name: "judgeStyle", at: "src/figures/judge-style.mjs judgeStyle" },
  { name: "judgeTexture", at: "src/figures/judge-texture.mjs judgeTexture" },
  { name: "judgeShape", at: "src/figures/judge-shape.mjs judgeShape" },
  { name: "validateStyle", at: "src/figures/judge-style.mjs validateStyle" },
  {
    name: "validateTexture, validateShape",
    at: "src/figures/judge-texture.mjs validateTexture, src/figures/judge-shape.mjs validateShape",
    none: "validateStyle's question (are two manners told apart) of the texture and shape measures, by the same AUC; validateStyle's case of two corpora of one manner stands for the three",
  },
  // ── the Source engine ──
  { name: "comparePort", at: "src/source/check.mjs comparePort" },
  {
    name: "compileQc, portToGmod",
    at: "src/source/compile.mjs compileQc, src/source/gmod.mjs portToGmod",
    none: "they run GMod's studiomdl, which the self-test may not have; where it is found, 109-source.mjs compiles a port and holds a moved corner against it, and comparePort, which portToGmod answers by, has its cases here",
  },
  { name: "smak gmod-port", at: "bin/smak.mjs gmodPort", none: "it prints portToGmod's faults (comparePort's, with cases here) and exits 1 on them; 109-source.mjs runs it where studiomdl is" },
  // ── s&box ──
  { name: "compareSbox", at: "src/sbox/check.mjs compareSbox" },
  {
    name: "compileVmdl, checkSboxPort",
    at: "src/sbox/compile.mjs compileVmdl, src/sbox/check.mjs checkSboxPort",
    none: "they run s&box's resourcecompiler and its editor, which the self-test may not have; 112-sbox.mjs compiles a port, and one with a mesh's node broken, where s&box is found, and checkSboxPort answers by compareSbox, which has its cases here",
  },
  { name: "smak sbox-check", at: "bin/smak.mjs sboxCheck", none: "it prints checkSboxPort's faults (compareSbox's, with cases here) and exits 1 on them; it needs s&box's editor" },
  // ── play ──
  { name: "play", at: "src/play.mjs play (its expectations and passed)" },
  // ── the command lines that fail by their exit code ──
  { name: "smak check", at: "bin/smak.mjs check" },
  { name: "smak map-check", at: "bin/smak.mjs mapCheck" },
  { name: "smak map-reach", at: "bin/smak.mjs mapReach" },
  { name: "smak contract", at: "bin/smak.mjs contractCommand (--against)" },
  { name: "smak sprite", at: "bin/smak.mjs spriteCommand (reportOut)" },
  {
    name: "smak map-teams, map-spawns, item, import, obj, sound, music, wad-make, model, map, video, figure-*",
    at: "bin/smak.mjs mapTeams, mapSpawns, item, imported, obj, soundCommand, musicCommand, wadSpecCommand, modelSpecCommand, mapSpecCommand, videoSpec, figureJudge ...",
    none: "each prints its library checker's report and exits 1 on its faults, as the five above do; their checkers have cases here, and the commands' own refusals are in 18-tool-faults.mjs and their areas' cases",
  },
  {
    name: "smak play",
    at: "bin/smak.mjs playMap",
    none: "it drives a browser through Playwright, which the self-test does not have; `play` itself, which it wraps, has its cases on a fake driver",
  },
];
