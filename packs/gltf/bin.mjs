#!/usr/bin/env node
// The pack's command: a compiled map and its props written as one .glb (README.md).
//
//   node packs/gltf/bin.mjs map-gltf <bsp> -o scene.glb [--game <folder> ...] [--light baked|lit] [--sets <folder> ...]
//
// `smak` cannot reach a pack (the kit never imports one), so the pack has its own entry, as smak's commands go:
// the map, -o, and --game once for each of the game's folders, the mod's own first (`.../ts`, then `.../valve`).
import { readFileSync, writeFileSync } from "node:fs";
import { mapGlb } from "./gltf.mjs";

const USAGE = "usage: node packs/gltf/bin.mjs map-gltf <bsp> -o scene.glb [--game <folder> ...] [--light baked|lit] [--sets <folder> ...]"; // prettier-ignore
const args = process.argv.slice(2);
const fail = (said) => {
  console.error(said);
  process.exit(1);
};
if (args[0] !== "map-gltf") fail(USAGE);
let file = null;
let out = null;
const folders = [];
const sets = [];
let light = "baked";
for (let at = 1; at < args.length; at++) {
  if (["-o", "--game", "--light", "--sets"].includes(args[at])) {
    if (!args[at + 1]) fail(`${args[at]} needs a value\n${USAGE}`);
    if (args[at] === "-o") out = args[++at];
    else if (args[at] === "--light") light = args[++at];
    else (args[at] === "--sets" ? sets : folders).push(args[++at]);
  } else if (!file) file = args[at];
  else fail(`what is ${args[at]}?\n${USAGE}`);
}
if (!file || !out) fail(USAGE);
if (!/\.glb$/i.test(out)) fail(`-o ${out}: the pack writes a .glb (one file, its pictures inside)`);
let bytes;
try {
  bytes = readFileSync(file);
} catch (error) {
  fail(`map-gltf: ${file} cannot be read: ${error.message}`);
}
const started = Date.now();
let made;
try {
  made = mapGlb(bytes, { folders, light, sets });
} catch (error) {
  fail(`map-gltf: ${error.message}`);
}
writeFileSync(out, made.glb);
const { facts } = made;
const round = (value) => Math.round(value * 10) / 10;
console.log(`wrote ${out}: ${(made.glb.length / 1048576).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(`  the world: ${facts.faces} faces (${facts.fanned} triangles fanned), ${facts.triangles.world} triangles${!facts.lit ? ", no light in the map" : facts.light ? ", lit by the lamps (the baked light left out)" : " cut on the lightmaps' grid, the light as COLOR_0"}, ${round(facts.area.world)} m²`); // prettier-ignore
console.log(`  props: ${facts.props} placed, ${facts.shared} meshes shared among them, ${facts.triangles.props} triangles, ${round(facts.area.props)} m²`); // prettier-ignore
console.log(`  ${facts.materials} materials, ${facts.images} pictures, ${facts.lights} lights, ${facts.nodes} nodes`);
if (facts.missing.length) console.log(`  textures found nowhere, drawn grey: ${facts.missing.join(", ")} (give --game the mod's folder and valve)`); // prettier-ignore
if (facts.light) console.log(`  lit: ${facts.sets} textures with their set (normal, roughness, metalness, occlusion), ${facts.glows} texture lights emissive and their ${facts.glowLamps} brightest cells of ${facts.glowCells} lamps${facts.ambient ? `; ambient for the engine, the darkest tenth of the lightmaps: ${facts.ambient.join(" ")} (linear; root extras)` : ""}`); // prettier-ignore
for (const note of facts.notes) console.log(`  ${note}`);
