#!/usr/bin/env node
// The pack's commands: a compiled map as a Godot 4 project that opens and walks (README.md, docs/GODOT.md).
//
//   node packs/godot/bin.mjs project <bsp> -o <folder> [--game <folder> ...] [--sets <folder> ...] [--start x,y,z[,yaw]]
//        [--shot name=x,y,z,yaw,pitch[,fov] ...] [--size WxH] [--tonemap linear|filmic|aces] [--probe x,y,z,sx,sy,sz]
//        [--ambient r,g,b] [--background r,g,b] [--lamps <factor>] [--cells <factor>] [--role <name>=<factor> ...]
//        [--finish <name>=<tone>[,<roughness>] ...] [--ssr] [--fog density,r,g,b[,x,y,z,sx,sy,sz]] [--name <words>]
//        [--godot <program>] [--list] [--shots]
//   node packs/godot/bin.mjs shots <folder> [--godot <program>] [--size WxH]    Godot run, the pictures taken
//   node packs/godot/bin.mjs list <folder>      the lamps and the materials own.gd, --role and --finish reach
//
// `smak` cannot reach a pack (the kit never imports one), so the pack has its own entry, as packs/gltf's.
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { godotProject, writeProject, reachOf, takeShots } from "./godot.mjs";

const USAGE = "usage: node packs/godot/bin.mjs project <bsp> -o <folder> [--game <folder> ...] [--sets <folder> ...] [--start x,y,z[,yaw]] [--shot name=x,y,z,yaw,pitch[,fov] ...] [--size WxH] [--tonemap linear|filmic|aces] [--probe x,y,z,sx,sy,sz] [--ambient r,g,b] [--background r,g,b] [--lamps <factor>] [--cells <factor>] [--role <name>=<factor> ...] [--finish <name>=<tone>[,<roughness>] ...] [--ssr] [--fog density,r,g,b[,x,y,z,sx,sy,sz]] [--name <words>] [--godot <program>] [--list] [--shots]\n       node packs/godot/bin.mjs shots <folder> [--godot <program>] [--size WxH]\n       node packs/godot/bin.mjs list <folder>"; // prettier-ignore
const args = process.argv.slice(2);
const fail = (said) => {
  console.error(said);
  process.exit(1);
};
if (!["project", "shots", "list"].includes(args[0])) fail(USAGE);
/** `1,2,3` as numbers, `count` of them (a list: any of its counts). */
const numbers = (flag, text, count, said = text) => {
  const values = text.split(/[,x]/).map(Number);
  if (text === "" || values.some((v) => !Number.isFinite(v)) || ![count].flat().includes(values.length)) fail(`${flag} ${said}: ${[count].flat().join(" or ")} numbers with commas between\n${USAGE}`); // prettier-ignore
  return values;
};
let file = null;
let out = null;
const asked = {};
const options = { folders: [], sets: [], shots: [], roles: {}, finish: [] };
for (let at = 1; at < args.length; at++) {
  const flag = args[at];
  if (/^--(ssr|list|shots)$/.test(flag)) (flag === "--ssr" ? options : asked)[flag.slice(2)] = true;
  else if (/^(-o|--(game|sets|start|shot|size|tonemap|probe|ambient|background|lamps|cells|role|finish|fog|name|godot))$/.test(flag)) {
    const value = args[++at];
    if (value === undefined) fail(`${flag} needs a value\n${USAGE}`);
    const [name, rest = ""] = value.split("=");
    if (flag === "-o") out = value;
    else if (flag === "--game") options.folders.push(value);
    else if (flag === "--sets") options.sets.push(value);
    else if (flag === "--start") options.start = numbers(flag, value, [3, 4]);
    else if (flag === "--probe") options.probe = numbers(flag, value, 6);
    else if (flag === "--size") options.size = numbers(flag, value, 2);
    else if (flag === "--fog") options.fog = numbers(flag, value, [4, 10]);
    else if (flag === "--lamps" || flag === "--cells") [options[flag.slice(2)]] = numbers(flag, value, 1);
    else if (flag === "--role") [options.roles[name]] = numbers(flag, rest, 1, value);
    else if (flag === "--finish") {
      const [tone, roughness] = numbers(flag, rest, [1, 2], value);
      options.finish.push({ name, tone, roughness });
    } else if (flag === "--ambient" || flag === "--background") options[flag.slice(2)] = numbers(flag, value, 3);
    else if (flag === "--shot") {
      const [x, y, z, yaw, pitch, fov = 90] = numbers(flag, rest, [5, 6], value);
      options.shots.push({ name, from: [x, y, z], yaw, pitch, fov });
    } else options[flag.slice(2)] = value;
  } else if (!file && !flag.startsWith("-")) file = flag;
  else fail(`what is ${flag}?\n${USAGE}`);
}
if (!file || (args[0] === "project" && !out)) fail(USAGE);
const round = (values) => values.map((v) => Math.round(v)).join(" ");
/** The lamps and the materials of a lit file, a line each. */
const list = ({ lamps, materials }) => {
  console.log(`  ${lamps.length} lamps of the lit way (in own.gd: main.role_of(light), an entity's keys in light.get_meta("extras"); cd is Godot's light_energy before the factor):`); // prettier-ignore
  for (const lamp of lamps) console.log(`    ${lamp.role === "cell" ? `cell   "${lamp.name}", no extras` : `#${lamp.number} ${lamp.classname}${lamp.role ? ` _role ${lamp.role}` : ""}`}, ${lamp.kind} at ${round(lamp.origin)}, ${+lamp.candela.toFixed(2)} cd${lamp.factor === 1 ? "" : lamp.factor > 0 ? ` x ${+lamp.factor.toFixed(4)}` : ": off"}`); // prettier-ignore
  console.log(`  ${materials.length} materials (a material's resource_name; --finish takes a part of it):`);
  for (const material of materials) console.log(`    ${material.name}${material.set ? ", with its set" : ""}, roughness ${+material.roughness.toFixed(2)}, metallic ${+material.metallic.toFixed(2)}`); // prettier-ignore
};
/** Godot run on the folder; says where each picture is. */
const shots = (folder) => {
  const taken = takeShots(folder, { godot: options.godot, size: args[0] === "shots" ? options.size : null });
  console.log(`shots: ${taken.files.length} pictures in ${resolve(folder)}: ${taken.files.map((picture) => basename(picture)).join(", ")}; look at them`); // prettier-ignore
  for (const line of taken.said) console.log(`  Godot said: ${line}`);
};
try {
  if (args[0] === "shots") shots(file);
  else if (args[0] === "list") {
    const walker = readFileSync(join(file, "main.gd"), "utf8");
    const value = (name, otherwise) => JSON.parse(walker.match(new RegExp(`^const ${name} := (.*)$`, "m"))?.[1] ?? otherwise);
    list(reachOf(readFileSync(join(file, "lit.glb")), { lamps: value("LAMPS", "1"), cells: value("CELLS", "1"), roles: value("ROLES", "{}") })); // prettier-ignore
  }
} catch (error) {
  fail(`${args[0]}: ${error.message}`);
}
if (args[0] !== "project") process.exit(0);
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
console.log(`wrote ${resolve(out)} in ${((Date.now() - started) / 1000).toFixed(1)} s: ${Object.keys(made.files).join(", ")}`);
console.log(`  baked.glb ${mb(made.files["baked.glb"])} MB, ${facts.baked.triangles.world + facts.baked.triangles.props} triangles; lit.glb ${mb(made.files["lit.glb"])} MB, ${facts.lit.triangles.world + facts.lit.triangles.props} triangles, ${facts.lit.lights} lamps, ${facts.lit.sets} textures with their set; ${facts.lit.props} props`); // prettier-ignore
if (facts.lit.missing.length) console.log(`  textures found nowhere, drawn grey: ${facts.lit.missing.join(", ")} (give --game the mod's folder and valve)`); // prettier-ignore
console.log(`  the start: feet at ${round(facts.start)}, yaw ${facts.yaw}${options.start ? "" : " (the map's info_player_start)"}; tonemap ${facts.tonemap}`); // prettier-ignore
console.log(`  the lit way: ambient ${facts.ambient.join(" ")} (linear${options.ambient ? "" : ", the export's"}); a reflection probe ${round(facts.probe.size)} at ${round(facts.probe.middle)}${options.probe ? "" : " (the world's box)"}, looking from ${round(facts.probe.from)}`); // prettier-ignore
const roles = Object.entries(facts.lamps.roles).filter(([, count]) => count).map(([role, count]) => `${count} of _role ${role} x ${made.facts.reach.lamps.find((lamp) => lamp.role === role).factor}`); // prettier-ignore
if (facts.lamps.on < facts.lit.lights || options.lamps !== undefined || options.cells !== undefined) console.log(`  the lit way's lamps: ${facts.lamps.on} of ${facts.lit.lights} on; every one x ${options.lamps ?? 1}, the ${facts.lamps.cells} texture lights' cells x ${options.cells ?? 1} besides${roles.length ? `; ${roles.join(", ")}` : ""}`); // prettier-ignore
console.log(`  shots (${facts.size.join(" x ")}): ${facts.shots.map((shot) => `${shot.name} from ${round(shot.from)} yaw ${shot.yaw} pitch ${shot.pitch} fov ${shot.fov}`).join("; ")}`); // prettier-ignore
if (stale) console.log("  the .glb changed: the old import (.godot) was removed, Godot imports again at the next run");
for (const note of facts.notes) console.log(`  ${note}`);
if (asked.list) list(facts.reach);
console.log(`  to walk it: run.bat (run.sh); pictures with no person: node packs/godot/bin.mjs shots ${out} (or project --shots), then look at shot-<name>-baked.png and shot-<name>-lit.png there`); // prettier-ignore
if (asked.shots) {
  try {
    shots(out);
  } catch (error) {
    fail(`shots: ${error.message}`);
  }
}
