// The test map for the smak_rp plugin: smak_rp_mtest, and its smak_rp_mtest.rp.json beside it.
//
//   node levels/rp/test-map.mjs [--vhlt C:/Herramientas/vhlt] [--wad <Half-Life>/valve/halflife.wad]
//                               [--model models/player/merc/merc.mdl] [--game C:/Juegos/H9XASH/ts]
//
// Two places that do not touch:
//   the room    a lit hall with four places to start (info_player_deathmatch) and the spot of one mission giver
//   the yard    the arena, sealed, 4480 units east of it: where the party is put, a goal pad (trigger_multiple), a
//               button (func_button), a crate (func_breakable), and the reset (multi_manager -> a bell, so a
//               run's start is heard)
// Every name is the contract's (levels/rp/CONTRACT.md): smak_rp_mtest_arena_yard_<what>.
//
// Writes levels/rp/build/smak_rp_mtest.map, .bsp (compiled with VHLT) and .rp.json, and pictures of the source.
// The NPC's model is only named, never copied: it must be one the game has (checked with --game).
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { carve, box, light, playerStart, pointEntity, brushEntity, writeMap } from "../../src/maps/source.mjs";
import { checkPlan, wadTextureNames } from "../../src/maps/plan.mjs";
import { findCompilers, compileMap, compileSummary } from "../../src/maps/compile.mjs";
import { planOfSource, drawSource } from "../../src/maps/draw.mjs";
import { png } from "../../src/image.mjs";
import { readBsp } from "../../src/maps/bsp.mjs";
import { breakablesOf } from "./contract.mjs";
import { reachOf } from "../../src/maps/reach.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const given = {
  vhlt: process.env.VHLT_DIR || "C:/Herramientas/vhlt",
  wad: "C:/Juegos/Steam/steamapps/common/Half-Life/valve/halflife.wad",
  model: "models/player/merc/merc.mdl",
  game: "C:/Juegos/H9XASH/ts",
  out: join(here, "build"),
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

const NAME = "smak_rp_mtest";
const ARENA = "yard";
const named = (what) => `${NAME}_arena_${ARENA}_${what}`;
const TEX = { floor: "C1A0_LABFLR", wall: "C1A0_LABW4", ceiling: "C1A0_C1" };
const YARD_TEX = { floor: "OUT_GRND1", wall: "C2A4_W1A", ceiling: "C1A0_C1" };

// ── the room: 640 x 512, 192 high ──
const ROOM = { min: [-3072, 0, 0], max: [-2432, 512, 192] };
const starts = [96, 192, 320, 416].map((y) => playerStart([-2976, y, 0], 0, "info_player_deathmatch"));
const giver = { at: [-2592, 256, 0], yaw: 180 }; // faces the starts
const back = [
  [-2848, 160, 0, 0],
  [-2848, 352, 0, 0],
  [-2784, 208, 0, 0],
  [-2784, 304, 0, 0],
];

// ── the yard: 768 x 768, 256 high, far east ──
const YARD = { min: [2048, 0, 0], max: [2816, 768, 256] };
const spawns = [288, 352, 416, 480].map((y) => [2144, y, 0, 0]);
const GOAL = { min: [2656, 576, 0], max: [2784, 736, 96] }; // north-east corner
const pad = box([2656, 576, 0], [2784, 736, 2], { top: "C1A0_LABGLU", sides: "C1A0_LABGLU", bottom: "C1A0_LABGLU" });
const BUTTON = { min: [2808, 144, 48], max: [2816, 176, 80] }; // on the east wall, south
const CRATE = { min: [2432, 96, 0], max: [2496, 160, 64] }; // south side, in plain view

const brushes = [...carve([ROOM], 16, TEX), ...carve([YARD], 16, YARD_TEX), pad];
// an info_target where each point is, at the height of a standing player's middle (a picture or a check finds it)
const marker = (what, [x, y, z, yaw]) => pointEntity("info_target", [x, y, z + 36], { targetname: named(what), angles: [0, yaw, 0] });
const entities = [
  ...starts,
  light([-2912, 256, 176], { brightness: 260 }),
  light([-2592, 256, 176], { brightness: 260 }),
  ...back.map((point, i) => marker(`back${i + 1}`, point)),
  ...spawns.map((point, i) => marker(`spawn${i + 1}`, point)),
  light([2240, 192, 240], { brightness: 300 }),
  light([2240, 576, 240], { brightness: 300 }),
  light([2624, 192, 240], { brightness: 300 }),
  light([2624, 576, 240], { color: [255, 230, 160], brightness: 320 }),
  brushEntity("trigger_multiple", box(GOAL.min, GOAL.max, "AAATRIGGER"), { targetname: named("goal"), spawnflags: 0, wait: 1 }),
  brushEntity("func_button", box(BUTTON.min, BUTTON.max, "+0BUTTON1"), {
    targetname: named("button"), angles: [0, 0, 0], speed: 50, lip: 4, wait: 1, sounds: 0,
  }),
  brushEntity("func_breakable", box(CRATE.min, CRATE.max, "CRATE01"), { targetname: named("crate"), material: 1, health: 30 }),
  pointEntity("multi_manager", [2432, 384, 200], { targetname: named("reset"), [named("bell")]: 0 }),
  pointEntity("ambient_generic", [2432, 384, 200], {
    targetname: named("bell"), message: "buttons/bell1.wav", health: 10, pitch: 100, pitchstart: 100, spawnflags: 50,
  }),
];
const map = {
  worldspawn: { message: "SMAK RP mission test", wad: [given.wad], MaxRange: 8192 },
  brushes,
  entities,
};

// ── the file, looked over ──
const mapFile = join(given.out, `${NAME}.map`);
writeFileSync(mapFile, writeMap(map));
console.log(`wrote ${mapFile}: ${brushes.length} world brushes, ${entities.length} entities`);
const plan = checkPlan(map, { textures: wadTextureNames(readFileSync(given.wad)) });
for (const fact of plan.facts) console.log(`  ${fact}`);
for (const warning of plan.warnings) console.log(`  WARN: ${warning}`);
for (const error of plan.errors) console.log(`  ERROR: ${error}`);
if (plan.errors.length) process.exit(1);
const save = (name, picture) => {
  writeFileSync(join(given.out, name), png(picture.width, picture.height, picture.rgba));
  console.log(`wrote ${join(given.out, name)}`);
};
save(`${NAME}-source-plan.png`, planOfSource(map));
save(`${NAME}-source-view.png`, drawSource(map));

// ── the NPC's model: one the game has ──
if (given.game && !existsSync(join(given.game, given.model))) {
  console.error(`the game has no ${given.model} under ${given.game}`);
  process.exit(1);
}

// ── the compile ──
const compilers = findCompilers({ folder: given.vhlt });
if (!compilers.found) {
  console.error(`not compiled: ${compilers.message}`);
  process.exit(1);
}
const result = compileMap(mapFile, { wads: [given.wad], compilers });
console.log(compileSummary(result));
if (!result.bsp) process.exit(1);
const bsp = readFileSync(result.bsp);

// ── the arena walked from its own markers: map-reach walks from the places to start, and the yard is reached
// only by the plugin's teleport, so its targets are walked to here from the info_targets of spawns and back ──
const walk = reachOf(readBsp(bsp), { starts: ["info_target"] });
console.log("the walk from the spawn and back markers:");
for (const fact of walk.facts) console.log(`  ${fact}`);
for (const warning of walk.warnings) console.log(`  WARN: ${warning}`);

// ── the JSON beside it (smak-rp/1) ──
const rp = {
  format: "smak-rp/1",
  map: NAME,
  build: createHash("sha1").update(bsp).digest("hex"),
  properties: [],
  places: [],
  npcs: [
    { id: "fixer", name: "Marco the Fixer", model: given.model, at: giver.at, yaw: giver.yaw, gives: ["pad_button", "crate_hold"] },
  ],
  arenas: [{ id: ARENA, spawns, back, reset: [named("reset")] }],
  missions: [
    {
      id: "pad_button", title: "The Signal", giver: "fixer", arena: ARENA, party: [1, 4], time: 120,
      steps: [
        { do: "reach", target: named("goal"), say: "Get to the green pad in the far left corner." },
        { do: "use", target: named("button"), say: "Now press the small button on the far wall, at its right end." },
      ],
      done: { say: "Signal sent. Marco is pleased.", reward: { frags: 1 } },
    },
    {
      id: "crate_hold", title: "Break and Hold", giver: "fixer", arena: ARENA, party: [1, 4], time: 120,
      steps: [
        { do: "destroy", target: named("crate"), say: "Smash the crate by the south wall." },
        { do: "survive", time: 20, say: "Hold out for 20 seconds." },
      ],
      done: { say: "Done. Marco pays you.", reward: { frags: 2 } },
    },
  ],
  breakables: [],
  roam: [],
};
rp.breakables = breakablesOf(rp.missions, readBsp(bsp).entities); // the keys of the crate, its model "*N" from the compiled map
const jsonFile = join(given.out, `${NAME}.rp.json`);
writeFileSync(jsonFile, JSON.stringify(rp, null, 2) + "\n");
console.log(`wrote ${jsonFile} (build ${rp.build})`);
