#!/usr/bin/env node
// The pack's command: a compiled map as a Godot 4 project that opens and walks (README.md, docs/GODOT.md).
//
//   node packs/godot/bin.mjs project <bsp> -o <folder> [--game <folder> ...] [--sets <folder> ...] [--start x,y,z[,yaw]]
//        [--shot name=x,y,z,yaw,pitch[,fov] ...] [--tonemap linear|filmic|aces] [--probe x,y,z,sx,sy,sz]
//        [--ambient r,g,b] [--background r,g,b] [--name <words>] [--godot <program>]
//
// `smak` cannot reach a pack (the kit never imports one), so the pack has its own entry, as packs/gltf's.
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { godotProject, writeProject } from "./godot.mjs";

const USAGE = "usage: node packs/godot/bin.mjs project <bsp> -o <folder> [--game <folder> ...] [--sets <folder> ...] [--start x,y,z[,yaw]] [--shot name=x,y,z,yaw,pitch[,fov] ...] [--tonemap linear|filmic|aces] [--probe x,y,z,sx,sy,sz] [--ambient r,g,b] [--background r,g,b] [--name <words>] [--godot <program>]"; // prettier-ignore
const args = process.argv.slice(2);
const fail = (said) => {
  console.error(said);
  process.exit(1);
};
if (args[0] !== "project") fail(USAGE);
/** `1,2,3` as numbers, `count` of them (a list: any of its counts). */
const numbers = (flag, text, count, said = text) => {
  const values = text.split(",").map(Number);
  if (values.some((v) => !Number.isFinite(v)) || ![count].flat().includes(values.length)) fail(`${flag} ${said}: ${[count].flat().join(" or ")} numbers with commas between\n${USAGE}`); // prettier-ignore
  return values;
};
let file = null;
let out = null;
const options = { folders: [], sets: [], shots: [] };
for (let at = 1; at < args.length; at++) {
  const flag = args[at];
  if (/^(-o|--(game|sets|start|shot|tonemap|probe|ambient|background|name|godot))$/.test(flag)) {
    const value = args[++at];
    if (value === undefined) fail(`${flag} needs a value\n${USAGE}`);
    if (flag === "-o") out = value;
    else if (flag === "--game") options.folders.push(value);
    else if (flag === "--sets") options.sets.push(value);
    else if (flag === "--start") options.start = numbers(flag, value, [3, 4]);
    else if (flag === "--probe") options.probe = numbers(flag, value, 6);
    else if (flag === "--ambient" || flag === "--background") options[flag.slice(2)] = numbers(flag, value, 3);
    else if (flag === "--shot") {
      const [name, rest] = value.split("=");
      const [x, y, z, yaw, pitch, fov = 90] = numbers(flag, rest ?? "", [5, 6], value);
      options.shots.push({ name, from: [x, y, z], yaw, pitch, fov });
    } else options[flag.slice(2)] = value;
  } else if (!file && !flag.startsWith("-")) file = flag;
  else fail(`what is ${flag}?\n${USAGE}`);
}
if (!file || !out) fail(USAGE);
let bytes;
try {
  bytes = readFileSync(file);
} catch (error) {
  fail(`project: ${file} cannot be read: ${error.message}`);
}
options.name ??= basename(file).replace(/\.bsp$/i, "");
const started = Date.now();
let made;
try {
  made = godotProject(bytes, options);
} catch (error) {
  fail(`project: ${error.message}`);
}
const { stale } = writeProject(out, made);
const { facts } = made;
const mb = (glb) => (glb.length / 1048576).toFixed(1);
const round = (values) => values.map((v) => Math.round(v)).join(" ");
console.log(`wrote ${resolve(out)} in ${((Date.now() - started) / 1000).toFixed(1)} s: ${Object.keys(made.files).join(", ")}`);
console.log(`  baked.glb ${mb(made.files["baked.glb"])} MB, ${facts.baked.triangles.world + facts.baked.triangles.props} triangles; lit.glb ${mb(made.files["lit.glb"])} MB, ${facts.lit.triangles.world + facts.lit.triangles.props} triangles, ${facts.lit.lights} lamps, ${facts.lit.sets} textures with their set; ${facts.lit.props} props`); // prettier-ignore
if (facts.lit.missing.length) console.log(`  textures found nowhere, drawn grey: ${facts.lit.missing.join(", ")} (give --game the mod's folder and valve)`); // prettier-ignore
console.log(`  the start: feet at ${round(facts.start)}, yaw ${facts.yaw}${options.start ? "" : " (the map's info_player_start)"}; tonemap ${facts.tonemap}`); // prettier-ignore
console.log(`  the lit way: ambient ${facts.ambient.join(" ")} (linear${options.ambient ? "" : ", the export's"}); a reflection probe ${round(facts.probe.size)} at ${round(facts.probe.middle)}${options.probe ? "" : " (the world's box)"}, looking from ${round(facts.probe.from)}`); // prettier-ignore
console.log(`  shots: ${facts.shots.map((shot) => `${shot.name} from ${round(shot.from)} yaw ${shot.yaw} pitch ${shot.pitch} fov ${shot.fov}`).join("; ")}`); // prettier-ignore
if (stale) console.log("  the .glb changed: the old import (.godot) was removed, Godot imports again at the next run");
for (const note of facts.notes) console.log(`  ${note}`);
console.log(`  to walk it: run.bat (run.sh); pictures with no person: run.bat -- --shots, then look at shot-<name>-baked.png and shot-<name>-lit.png there`); // prettier-ignore
