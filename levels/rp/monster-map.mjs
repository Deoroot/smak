// A probe map: do Half-Life's monsters work inside The Specialists on H9 (Xash3D FWGS)? smak_rp_monsters.
//
//   node levels/rp/monster-map.mjs [--vhlt C:/Herramientas/sdhlt-xash/tools] [--wad <halflife.wad>]
//                                  [--game C:/Juegos/H9XASH/ts] [--valve C:/Juegos/H9XASH/valve]
//                                  [--pictures <folder>]
//
// The hall (1024 x 1024, 256 high) has four info_player_deathmatch (south-west corner), a grid of 64 info_node,
// and on coloured pads:
//   scientist  GREEN pad, west side, with a scripted_sequence (walk to the white pad in the east) on button 1,
//              and a second one (walk back) on button 2; both buttons stand by the south wall
//   barney     BLUE pad, standing in the middle of the north half
//   grunt      in the RED-floored side room east of the hall: behind a glass wall (func_breakable); the room's door
//              (func_door) opens with the button beside it in the hall; shoot the glass to release him
// Only names the game has are written; no model or sound is copied (the script reports which exist).
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { carve, box, light, playerStart, pointEntity, brushEntity, writeMap } from "../../src/maps/source.mjs";
import { checkPlan, wadTextureNames } from "../../src/maps/plan.mjs";
import { findCompilers, compileMap, compileSummary } from "../../src/maps/compile.mjs";
import { planOfSource, drawSource } from "../../src/maps/draw.mjs";
import { png } from "../../src/image.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const given = {
  vhlt: process.env.VHLT_DIR || "C:/Herramientas/sdhlt-xash/tools",
  wad: "C:/Juegos/Steam/steamapps/common/Half-Life/valve/halflife.wad",
  game: "C:/Juegos/H9XASH/ts",
  valve: "C:/Juegos/H9XASH/valve",
  out: join(here, "build"),
  pictures: join(here, "build", "pictures"),
};
const words = process.argv.slice(2);
while (words.length) {
  const word = words.shift().replace(/^--/, "");
  if (!(word in given) || !words.length) {
    console.error(`--${word}: the options are ${Object.keys(given).map((k) => `--${k}`).join(", ")}`);
    process.exit(1);
  }
  given[word] = words.shift();
}
mkdirSync(given.out, { recursive: true });
mkdirSync(given.pictures, { recursive: true });

const NAME = "smak_rp_monsters";
const TEX = { floor: "C1A0_LABFLR", wall: "C1A0_LABW4", ceiling: "C1A0_C1" };
const SIDE_TEX = { floor: "RED", wall: "C1A0_LABW4", ceiling: "C1A0_C1" };

// ── what the game has ──
const MODELS = ["scientist", "barney", "hgrunt"];
console.log("monster models (ts = The Specialists, valve = Half-Life):");
for (const m of MODELS) {
  const inTs = existsSync(join(given.game, "models", `${m}.mdl`));
  const inValve = existsSync(join(given.valve, "models", `${m}.mdl`));
  console.log(`  models/${m}.mdl  ts: ${inTs ? "yes" : "NO"}  valve: ${inValve ? "yes" : "NO"}`);
}

// ── the rooms ──
const HALL = { min: [0, 0, 0], max: [1024, 1024, 256] };
const SIDE = { min: [1088, 320, 0], max: [1344, 704, 192], texture: SIDE_TEX };
const DOORWAY = { min: [1016, 480, 0], max: [1096, 544, 96] };

const starts = [64, 128, 192, 256].map((y) => playerStart([64, y, 0], 0, "info_player_deathmatch"));
const nodes = [];
for (let x = 64; x < 1024; x += 128) for (let y = 64; y < 1024; y += 128) nodes.push(pointEntity("info_node", [x, y, 36]));

const pad = (x, y, texture) => box([x - 48, y - 48, 0], [x + 48, y + 48, 2], { top: texture, sides: texture, bottom: texture });
const SCI = [256, 768], BAR = [512, 768], DEST = [768, 768];
const pads = [pad(...SCI, "GLASSGREEN"), pad(...BAR, "GLASSBLUE1"), pad(...DEST, "C1A0_LABGLU")];

const brushes = [...carve([HALL, SIDE, DOORWAY], 16, TEX), ...pads];

const door = brushEntity("func_door", box([1036, 480, 0], [1052, 544, 96], "LAB1_DOOR1"), {
  targetname: "mon_door", angle: -1, speed: 120, lip: 4, wait: -1, spawnflags: 0, // angle -1: slides up
});
const glass = brushEntity("func_breakable", box([1200, 320, 0], [1208, 704, 192], "GLASSBLUE2"), {
  targetname: "mon_glass", material: 0, health: 10, rendermode: 2, renderamt: 160,
});
const button = (at, wall, targetname, target) =>
  brushEntity("func_button", box(...wall, "+0BUTTON1"), { targetname, target, angles: [0, 0, 0], speed: 40, lip: 2, wait: 1, sounds: 0 });
// buttons on the south wall (y 0), 8 thick, standing 48..80 high; the wall's face is at y 0
const btn = (x, name, target) => button(null, [[x, 0, 48], [x + 32, 8, 80]], name, target);
const btnDoor = brushEntity("func_button", box([1000, 560, 48], [1008, 592, 80], "+0BUTTON2"), {
  targetname: "mon_btn_door", target: "mon_door", angles: [0, 0, 0], speed: 40, lip: 2, wait: 1, sounds: 0,
});

const entities = [
  ...starts,
  ...nodes,
  light([256, 256, 232], { brightness: 300 }), light([768, 256, 232], { brightness: 300 }),
  light([256, 768, 232], { brightness: 300 }), light([768, 768, 232], { brightness: 300 }),
  light([512, 512, 232], { brightness: 300 }),
  light([1150, 512, 170], { brightness: 280 }), light([1280, 512, 170], { brightness: 280 }),
  // the monsters, on their pads
  pointEntity("monster_scientist", [SCI[0], SCI[1], 4], { targetname: "mon_sci", angles: [0, 0, 0] }),
  pointEntity("monster_barney", [BAR[0], BAR[1], 4], { targetname: "mon_barney", angles: [0, 270, 0] }),
  pointEntity("monster_human_grunt", [1290, 512, 4], { targetname: "mon_grunt", angles: [0, 180, 0], weapons: 1 }),
  // scripted_sequence: its origin is where the scientist walks to (m_fMoveTo 1 = walk, 2 = run); 4 = repeatable
  pointEntity("scripted_sequence", [DEST[0] - 40, DEST[1], 4], {
    targetname: "mon_seq_go", m_iszEntity: "mon_sci", m_fMoveTo: 1, m_iszPlay: "", m_flRadius: 0, m_flRepeat: 0, spawnflags: 4,
    angles: [0, 0, 0],
  }),
  pointEntity("scripted_sequence", [SCI[0] + 40, SCI[1], 4], {
    targetname: "mon_seq_back", m_iszEntity: "mon_sci", m_fMoveTo: 1, m_iszPlay: "", m_flRadius: 0, m_flRepeat: 0, spawnflags: 4,
    angles: [0, 0, 0],
  }),
  btn(384, "mon_btn_go", "mon_seq_go"),
  btn(448, "mon_btn_back", "mon_seq_back"),
  btnDoor,
  door,
  glass,
];
const map = {
  worldspawn: { message: "SMAK monster probe", wad: [given.wad], MaxRange: 8192 },
  brushes,
  entities,
};

// ── the file, looked over ──
const mapFile = join(given.out, `${NAME}.map`);
writeFileSync(mapFile, writeMap(map));
console.log(`wrote ${mapFile}: ${brushes.length} world brushes, ${entities.length} entities (${nodes.length} info_node)`);
const plan = checkPlan(map, { textures: wadTextureNames(readFileSync(given.wad)) });
for (const fact of plan.facts) console.log(`  ${fact}`);
for (const warning of plan.warnings) console.log(`  WARN: ${warning}`);
for (const error of plan.errors) console.log(`  ERROR: ${error}`);
if (plan.errors.length) process.exit(1);
const save = (name, picture) => {
  writeFileSync(join(given.pictures, name), png(picture.width, picture.height, picture.rgba));
  console.log(`wrote ${join(given.pictures, name)}`);
};
save(`${NAME}-source-plan.png`, planOfSource(map));
save(`${NAME}-source-view.png`, drawSource(map));

// ── the compile: Xash, BSP2 ──
const compilers = findCompilers({ folder: given.vhlt });
if (!compilers.found) {
  console.error(`not compiled: ${compilers.message}`);
  process.exit(1);
}
const result = compileMap(mapFile, { wads: [given.wad], compilers, engine: "xash", format: "bsp2" });
console.log(compileSummary(result));
if (result.leak) console.log(`LEAK at ${JSON.stringify(result.leak.at)}`);
if (!result.bsp) process.exit(1);
console.log(`bsp: ${result.bsp}`);
