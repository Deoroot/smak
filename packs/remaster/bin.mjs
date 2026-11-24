#!/usr/bin/env node
// The pack's commands (docs/MAPS-REMASTER.md). `smak` cannot reach a pack, so it has its own entry; each ends with one
// line, PASS or FAIL and its reasons.
//   build <shipped.map> --zone <folder | zone.mjs> ... -o <out.map> [--wad <name>] [--k 1]
//         every zone applied, checked against its box, written as one .map; --wad: the zones' textures in one .wad
//         beside it (out/<name>.wad), the shipped map's own .wad files left as they are. wads.txt lists them for the compile.
//   pick <map> --zone <folder | zone.mjs> --eye x,y,z [--yaw 0] [--pitch 0] [--fov 96.5] [--aspect 0.5625]
//         what the eye sees, and whether the zone can change it (a face is the zone's when its centre is in the box)
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { maps } from "../../src/index.mjs";
import { applyZones, sharedWad, pickFaces } from "./remaster.mjs";

const USAGE = `usage: node packs/remaster/bin.mjs build <shipped.map> --zone <folder|zone.mjs> ... -o <out.map> [--wad <name>] [--k 1]
       node packs/remaster/bin.mjs pick <map> --zone <folder|zone.mjs> --eye x,y,z [--yaw 0] [--pitch 0] [--fov 96.5] [--aspect 0.5625]`;
const fail = (said) => {
  console.log(`FAIL: ${said}`);
  process.exit(1);
};
const [command, file, ...rest] = process.argv.slice(2);
if (!["build", "pick"].includes(command) || !file) fail(USAGE);
const [zoneFiles, flags] = [[], {}];
for (let at = 0; at < rest.length; at++) {
  const name = rest[at].replace(/^-+/, "");
  if (!["zone", "o", "wad", "k", "eye", "yaw", "pitch", "fov", "aspect"].includes(name) || rest[at + 1] === undefined) fail(`${command}: what is ${rest[at]}?\n${USAGE}`); // prettier-ignore
  if (name === "zone") zoneFiles.push(rest[++at]);
  else flags[name] = rest[++at];
}
if (!existsSync(file)) fail(`${command}: there is no ${file}`);
if (!zoneFiles.length) fail(`${command}: --zone <folder | zone.mjs>, one or more\n${USAGE}`);
const map = maps.readMap(readFileSync(file, "latin1"));

/** A zone's module, by its folder (its zone.mjs) or its file: { id, BOX, WADS, apply }, its id its ID or its folder's name. */
async function zoneOf(path) {
  const at = existsSync(path) && statSync(path).isDirectory() ? join(path, "zone.mjs") : path;
  if (!existsSync(at)) fail(`there is no zone at ${path} (a folder with a zone.mjs, or the file)`);
  const zone = await import(pathToFileURL(resolve(at)).href);
  const id = zone.ID ?? basename(dirname(resolve(at)));
  if (!zone.BOX?.min || !zone.BOX?.max || typeof zone.apply !== "function") fail(`${id}: a zone exports BOX { min, max } and apply(map, context)`); // prettier-ignore
  return { id, BOX: zone.BOX, WADS: (zone.WADS ?? []).map((wad) => resolve(dirname(resolve(at)), wad)), apply: zone.apply };
}
const zones = [];
for (const each of zoneFiles) zones.push(await zoneOf(each));

if (command === "pick") {
  const eye = (flags.eye ?? "").split(",").map(Number);
  if (eye.length !== 3 || !eye.every(Number.isFinite)) fail(`pick: --eye x,y,z, not ${flags.eye}`);
  const number = (name, value) => (flags[name] === undefined ? value : Number(flags[name]));
  const seen = pickFaces(map, { eye, yaw: number("yaw", 0), pitch: number("pitch", 0), fov: number("fov", 96.5), aspect: number("aspect", 0.5625), box: zones[0].BOX }); // prettier-ignore
  for (const face of seen.outside) console.log(`  outside: ${face.texture} (${face.brush}) centre ${face.centre.join(" ")}, seen at ${face.point.join(" ")}`); // prettier-ignore
  console.log(`${seen.outside.length ? "FAIL" : "PASS"}: ${zones[0].id}: ${seen.said}`);
  process.exit(seen.outside.length ? 1 : 0);
}

if (!flags.o) fail(`build: -o <out.map>\n${USAGE}`);
const made = await applyZones(map, zones, { src: maps, prof: maps, K: Number(flags.k ?? 1) });
for (const fact of made.facts) console.log(`  ${fact}`);
for (const error of made.errors) console.log(`ERROR ${error}`);
if (made.errors.length) fail(`${made.errors.length} errors: ${made.errors[0]}`);
mkdirSync(dirname(resolve(flags.o)), { recursive: true });
let wads = made.wads;
if (flags.wad) {
  const shared = sharedWad(made.wads);
  if (shared.errors.length) fail(`--wad: ${shared.errors.join("; ")}`);
  const to = join(dirname(resolve(flags.o)), `${flags.wad}.wad`);
  writeFileSync(to, shared.bytes);
  console.log(`  ${to}: the zones' ${shared.count} textures in one .wad, ${(shared.bytes.length / 2 ** 20).toFixed(1)} MB: install it beside the map`); // prettier-ignore
  wads = [to];
}
writeFileSync(flags.o, maps.writeMap(map));
writeFileSync(join(dirname(resolve(flags.o)), "wads.txt"), `${wads.join("\n")}\n`);
console.log(`PASS: ${flags.o}: ${zones.length} zones, each in its box; their .wad files in wads.txt (give them to the compile with the shipped map's own)`); // prettier-ignore
