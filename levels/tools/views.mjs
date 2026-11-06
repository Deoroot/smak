#!/usr/bin/env node
// views: the diagnostic views of a map (levels/assembly/views.mjs, part V of levels/assembly/README.md), all into
// one folder: each storey cut away from three corners, its plan on the 64 grid (the layout laid over it and each
// of its edges measured), its floor's height in colour, its floor's light as a heat map, and with a layout the
// shots at eye height through every door, up and down the stair and across each room.
//
//   node levels/tools/views.mjs <map.bsp|map.map> [--layout layout.json] --out <folder>
//        [--wad file.wad]... [--game folder]... [--flat] [--brightness 1.55]
//        [--storeys n --base z --storey-height 192]
//
//   --layout    a smak-layout/1: the storeys, the rooms' names and the edges come from it, and the eye shots
//   --wad       a .wad whose pictures the textures are drawn with (Half-Life's halflife.wad); --game a folder
//               whose .wad files the map lists
//   --flat      the cutaways shaded by the way each face looks, not by the map's light
//   --storeys   without a layout: how many storeys from z --base, --storey-height apart (else the walk finds them)
//
// The last line is `PASS: n views written in <folder>`, or `FAIL: ...` with the reason: a view that could not be
// made, an edge of the layout the built map does not have, or a room whose floor is dark. Exit code 0 on PASS,
// 1 on FAIL, 2 on wrong arguments.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { allViews, mapOf } from "../assembly/views.mjs";
import { readWad } from "../../src/maps/wad.mjs";

const usage = "usage: views <map.bsp|map.map> [--layout layout.json] --out <folder> [--wad file.wad]... [--game folder]... [--flat] [--brightness b] [--storeys n --base z --storey-height h]"; // prettier-ignore
const args = { _: [], wad: [], game: [] };
const LISTS = ["wad", "game"];
const FLAGS = ["flat"];
for (let i = 2; i < process.argv.length; i++) {
  const word = process.argv[i];
  if (!word.startsWith("--")) args._.push(word);
  else {
    const name = word.slice(2);
    if (FLAGS.includes(name)) args[name] = true;
    else if (LISTS.includes(name)) args[name].push(process.argv[++i]);
    else args[name] = process.argv[++i];
  }
}
const file = args._[0];
if (!file || !args.out) {
  console.error(usage);
  process.exit(2);
}
const fail = (why) => {
  console.log(`FAIL: ${why}`);
  process.exit(1);
};
if (!existsSync(file)) fail(`there is no map file ${file}`);
let map;
let layout;
try {
  map = mapOf(file);
} catch (e) {
  fail(`${file} cannot be read as a map (${e.message})`);
}
if (args.layout) {
  try {
    layout = JSON.parse(readFileSync(args.layout, "utf8"));
  } catch (e) {
    fail(`${args.layout} cannot be read as JSON (${e.message})`);
  }
  if (layout.format !== "smak-layout/1") fail(`${args.layout} is not a smak-layout/1 (its format is ${layout.format})`);
}
const textures = [];
for (const wad of args.wad) {
  try {
    textures.push(...readWad(readFileSync(wad)).textures);
  } catch (e) {
    fail(`${wad} cannot be read as a .wad (${e.message})`);
  }
}
const options = {
  layout,
  out: args.out,
  textures: textures.length ? textures : undefined,
  folders: args.game.length ? args.game : undefined,
  flat: Boolean(args.flat),
  brightness: args.brightness === undefined ? undefined : Number(args.brightness),
  storeys: args.storeys === undefined ? undefined : Number(args.storeys),
  base: args.base === undefined ? undefined : Number(args.base),
  storeyHeight: args["storey-height"] === undefined ? undefined : Number(args["storey-height"]),
};
let result;
try {
  result = allViews(map, options);
} catch (e) {
  fail(`a view could not be made: ${e.message}`);
}
mkdirSync(args.out, { recursive: true });
const report = [
  `views of ${file}${args.layout ? ` against ${args.layout}` : ""}`,
  `storeys: ${result.storeys.map((s) => `${s.index} at z ${s.floor}`).join(", ")}`,
  ...result.files.map((each) => `  ${each}`),
  ...result.notes,
  ...result.mismatches.map((each) => `EDGE: ${each}`),
  ...result.dark.map((each) => `DARK: ${each}`),
];
writeFileSync(join(args.out, "views.txt"), `${report.join("\n")}\n`);
for (const line of [...result.notes, ...result.mismatches.map((each) => `edge not as the layout says: ${each}`), ...result.dark.map((each) => `dark floor: ${each}`)]) console.log(line); // prettier-ignore
const pictures = result.files.filter((each) => each.endsWith(".png")).length;
if (!pictures) fail(`no view was written in ${args.out}`);
const wrong = [];
if (result.mismatches.length) wrong.push(`${result.mismatches.length} edges of the layout are not as built (plan-s*.png, red crosses)`);
if (result.dark.length) wrong.push(`${result.dark.length} rooms have a dark floor (light-s*.png): ${result.dark.join(", ")}`);
if (wrong.length) fail(`${pictures} views written in ${args.out}, and ${wrong.join("; ")}`);
console.log(`PASS: ${pictures} views written in ${args.out}`);
