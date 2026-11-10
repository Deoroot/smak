// Example 7: a small map, from a description to a .bsp. Two rooms joined by a doorway with a step up, a
// window opening between them, two lights and a place to start:
//
//   node examples/07-a-small-map.mjs [output folder, default out] [--wad <file.wad>]
//                                    [--floor NAME] [--wall NAME] [--ceiling NAME] [--step NAME]
//
// It writes small.map (open it in J.A.C.K. or TrenchBroom to see it), looks the plan over, draws the source
// (small-source-plan.png, small-source-view.png: look at them before any compile), and compiles it to
// small.bsp when it can, which it then draws as the game will light it (small-plan.png, small-views.png).
// Two things it cannot bring itself:
//
//   textures   A map only NAMES its textures; the pictures are in a .wad file. The names below are in
//              Half-Life's own halflife.wad (`--wad <Half-Life>/valve/halflife.wad`); for a mod, give its
//              .wad and names of its own. A .wad can also be made with this kit from pictures of your own:
//              `writeWad([{ name, image }])` in core/maps/wad.mjs.
//   compilers  VHLT (Vluzacn's ZHLT v34), an outside program. Name its folder in the VHLT_DIR environment
//              variable. Without it the .map is still written and checked.
//
// The pattern:
//   1. the rooms as boxes of empty space, carved out of one block of rock: nothing can leak
//   2. what stands in them (a step), and the entities (lights, the start)
//   3. writeMap, to a file
//   4. checkPlan: fix every error before spending minutes on a compile; planOfSource and drawSource: LOOK
//   5. compileMap, then read its errors, its leak and its warnings
//   6. planOf and viewsOf of the result: look again, now with its textures and its light
//
// Units: about an inch. A player is 72 tall and 32 wide, walks up a step of 18 and jumps about 45.
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { carve, box, light, playerStart, writeMap } from "../make/maps/source.mjs";
import { checkPlan, wadTextureNames } from "../check/maps/plan.mjs";
import { findCompilers, compileMap, compileSummary } from "../make/maps/compile.mjs";
import { planOfSource, drawSource, planOf, viewsOf } from "../check/maps/draw.mjs";
import { readBsp } from "../core/maps/bsp.mjs";
import { readWad } from "../core/maps/wad.mjs";
import { png } from "../core/image.mjs";

// ── the arguments ──
const NAMES = { floor: "C1A0_LABFLR", wall: "C1A0_LABW4", ceiling: "C1A0_C1", step: "C1A0_LABGLU" };
const given = { out: "out", wad: undefined, ...NAMES };
const words = process.argv.slice(2);
while (words.length) {
  const word = words.shift();
  const option = word.startsWith("--") ? word.slice(2) : undefined;
  if (option === undefined) given.out = word;
  else if (option in given && words.length) given[option] = words.shift();
  else {
    console.error(
      `${word}: the options are --wad <file.wad> and --floor, --wall, --ceiling, --step <texture name>`,
    );
    process.exit(1);
  }
}
if (given.wad && !existsSync(given.wad)) {
  console.error(`there is no .wad file ${given.wad}`);
  process.exit(1);
}
try {
  mkdirSync(given.out, { recursive: true });
} catch (error) {
  console.error(`the output folder ${given.out} cannot be made (${error.code})`);
  process.exit(1);
}

// ── 1. the rooms: boxes of empty space ──
const HALL = { min: [0, 0, 0], max: [320, 256, 160] };
// the study's floor is 16 higher: the way in is a step up
const STUDY = { min: [352, 0, 16], max: [608, 256, 144] };
// 32 of rock lie between the two; a doorway (64 wide, 96 tall) and a window (48 square) go through it
const DOORWAY = { min: [320, 96, 16], max: [352, 160, 112] };
const WINDOW = { min: [320, 184, 72], max: [352, 232, 120] };
const ROCK = 16;
const rooms = carve([HALL, STUDY, DOORWAY, WINDOW], ROCK, given);

// ── 2. what stands in them, and the entities ──
// the doorway's floor is 16 above the hall's: a slab 8 high before it makes two easy steps of 8
const step = box([296, 96, 0], [320, 160, 8], { top: given.step, sides: given.wall });
const entities = [
  // the place to start: on the hall's floor, facing the doorway (+x)
  playerStart([96, 128, 0], 0),
  light([160, 128, 136], { brightness: 250 }),
  light([480, 128, 120], { color: [255, 214, 170], brightness: 200 }),
];
const map = {
  worldspawn: { message: "A small map made with SMAK", wad: given.wad ? [given.wad] : undefined },
  brushes: [...rooms, step],
  entities,
};

// ── 3. the file ──
const mapFile = join(given.out, "small.map");
writeFileSync(mapFile, writeMap(map));
console.log(`wrote ${mapFile}: ${map.brushes.length} world brushes, ${entities.length} entities`);

// ── 4. the plan, looked over before any compile ──
const textures = given.wad ? wadTextureNames(readFileSync(given.wad)) : undefined;
const plan = checkPlan(map, { textures });
for (const fact of plan.facts) console.log(`  ${fact}`);
// with no --wad there is no wad key, and that warning is said below in this example's own words
for (const warning of plan.warnings.filter((one) => given.wad || !/no wad key/.test(one)))
  console.log(`  warning: ${warning}`);
for (const error of plan.errors) console.log(`  ERROR: ${error}`);
if (plan.errors.length) {
  console.log("the plan has errors: not compiled");
  process.exit(1);
}
// the source drawn: where the rooms, the doorway and the entities are, before any compile
/** Writes a picture the kit drew as a PNG in the output folder, and says so. */
const savePicture = (name, picture) => {
  writeFileSync(join(given.out, name), png(picture.width, picture.height, picture.rgba));
  console.log(`wrote ${join(given.out, name)} (${picture.width}x${picture.height}): look at it`);
};
savePicture("small-source-plan.png", planOfSource(map));
savePicture("small-source-view.png", drawSource(map));

// ── 5. the compile, when the textures and the compilers are there ──
const compilers = findCompilers();
if (!given.wad) {
  console.log("not compiled: a compile needs the .wad the textures are in (--wad <file.wad>)");
} else if (!compilers.found) {
  console.log(`not compiled: ${compilers.message}`);
} else {
  const result = compileMap(mapFile, { wads: [given.wad], compilers });
  console.log(compileSummary(result));
  if (!result.bsp) process.exit(1);
  // ── 6. the result drawn, with the textures of its .wad and its own light ──
  const compiled = readBsp(readFileSync(result.bsp));
  const drawn = { textures: readWad(readFileSync(given.wad)).textures };
  savePicture("small-plan.png", planOf(compiled, drawn));
  savePicture("small-views.png", viewsOf(compiled, drawn));
  console.log("put small.bsp in the game's maps folder and load it with: map small");
}
