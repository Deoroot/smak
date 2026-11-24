#!/usr/bin/env node
// The pack's commands: ambientCG's and Poly Haven's CC0 materials searched, one made a GoldSrc texture with its set
// kept for other engines, and a folder of them made one .wad (README.md). `smak` cannot reach a pack (the kit never
// imports one), so the pack has its own entry. A check ends with one line, PASS or FAIL and its reasons.
import { writeFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { png, maps, tile, label } from "../../src/index.mjs";
import { materialList, searchMaterials, materialLine, downloadSet, CREDITS, SOURCES, DEFAULT_CACHE } from "./libraries.mjs"; // prettier-ignore
import { writePrimext, valuesOf } from "./primext.mjs";
import { makeMaterial, writeMaterial, wadOfFolder, wallSheet, readPicture } from "./material.mjs";

const USAGE = `usage: node packs/materials/bin.mjs search <words | source:id...> [--source ambientcg|polyhaven] [--limit n] [--sheet x.png] [--cache <folder>]
       node packs/materials/bin.mjs material <id> --name <texture> --size 256|512|WxH -o <folder> [--tone r,g,b[,amount]] [--final] [--chroma k] [--shift dx,dy] [--mirror] [--holes mask.png] [--part x0,y0,x1,y1] [--marks spec] [--metres m] [--even] [--dither] [--against x.wad:name[@scale]] [--wall units] [--scale u] [--source s] [--cache <folder>]
       node packs/materials/bin.mjs wad <folder> -o x.wad
       node packs/materials/bin.mjs primext <name.set | folder of sets ...> -o <folder> [--metal name=0.6,...] [--rough name=0.42,...] [--flatten name=0.22,...]`;
const fail = (said) => {
  console.error(said);
  process.exit(1);
};
const [command, ...rest] = process.argv.slice(2);
const VALUED = {
  search: ["--source", "--limit", "--cache", "--sheet"],
  material: ["--name", "--size", "-o", "--tone", "--part", "--marks", "--metres", "--against", "--wall", "--scale", "--source", "--cache", "--chroma", "--shift", "--holes"], // prettier-ignore
  wad: ["-o"],
  primext: ["-o", "--metal", "--rough", "--flatten"],
};
const BARE = { material: ["--dither", "--even", "--final", "--mirror"] };
if (!VALUED[command]) fail(USAGE);
const [words, flags] = [[], {}];
for (let at = 0; at < rest.length; at++) {
  if (!rest[at].startsWith("-")) words.push(rest[at]);
  else if (BARE[command]?.includes(rest[at])) flags[rest[at].slice(2)] = true;
  else if (!VALUED[command].includes(rest[at])) fail(`${command}: what is ${rest[at]}?\n${USAGE}`);
  else if (rest[at + 1] === undefined) fail(`${rest[at]} needs a value\n${USAGE}`);
  else flags[rest[at].replace(/^-+/, "")] = rest[++at];
}
const numbers = (name, count, test, said) => {
  if (flags[name] === undefined) return undefined;
  const list = String(flags[name]).split(",").map(Number);
  if (!count.includes(list.length) || !list.every(test)) fail(`--${name}: ${said}, not ${flags[name]}`);
  return list;
};
const cache = flags.cache ?? DEFAULT_CACHE;
if (flags.source !== undefined && !SOURCES.includes(flags.source)) fail(`--source ${SOURCES.join(" or ")}, not ${flags.source}`); // prettier-ignore

try {
  if (command === "search") await search();
  else if (command === "material") await material();
  else if (command === "primext") primext();
  else wad();
} catch (error) {
  fail(`${command}: ${error.message}`);
}

async function search() {
  if (!words.length) fail(`search: what is looked for?\n${USAGE}`);
  const [limit] = numbers("limit", [1], (v) => Number.isInteger(v) && v > 0, "a whole number from 1") ?? [words.filter((w) => /^\w+:/.test(w)).length || 20];
  const sources = flags.source ? [flags.source] : SOURCES;
  const lists = {};
  const from = [];
  for (const source of sources) {
    const got = await materialList(source, { cache });
    lists[source] = got.list;
    from.push(got.from);
  }
  const ids = words.filter((w) => /^\w+:/.test(w)).map((w) => w.split(":"));
  const missing = ids.filter(([source, id]) => !lists[source]?.[id]).map((pair) => pair.join(":"));
  if (missing.length) fail(`search: ${missing.join(", ")}: not in ${sources.join(" or ")} (an id is source:id, as search prints it)`); // prettier-ignore
  const found = ids.length ? ids.map(([source, id]) => ({ source, id, asset: lists[source][id] })) : searchMaterials(lists, words); // prettier-ignore
  for (const f of found.slice(0, limit)) console.log(materialLine(f));
  if (flags.sheet && found.length) await sheet(found.slice(0, limit));
  else if (flags.sheet) console.log(`no materials match "${words.join(" ")}": no sheet written`);
  const total = Object.values(lists).reduce((s, l) => s + Object.keys(l).length, 0);
  console.log(`${found.length} of ${total} materials ${ids.length ? "named" : `hold "${words.join(" ")}"`}${found.length > limit ? `, the first ${limit} shown` : ""} (the lists: ${from.join("; ")})`); // prettier-ignore
  console.log(`${sources.map((s) => CREDITS[s]).join(". ")}. One: node packs/materials/bin.mjs material <id> --name <texture> --size 256 -o <folder>`); // prettier-ignore
}

/** The candidates flat at 256, 5 a row, each named, and in a band of its mean colour at its foot that colour, its brightness and how it was made. */
async function sheet(found) {
  const [tiles, names] = [[], []];
  for (const f of found) {
    const set = await downloadSet(f.source, f.id, { cache });
    const { texture, report } = makeMaterial(set, { name: "candidate", size: [256, 256] });
    const { rgba } = maps.textureRgba(texture);
    for (let i = 256 * 230; i < 256 * 256; i++) rgba.set(report.mean.map(Math.round), i * 4);
    tiles.push(label({ width: 256, height: 256, rgba }, `${report.mean.map(Math.round).join("/")} b${Math.round(report.brightness)}${report.joints?.some(Boolean) ? ` ${report.joints.map((n) => n || "-").join("x")}` : ""} ${/procedural/.test(set.made ?? "") ? "PROCEDURAL" : f.source === "polyhaven" ? "scanned" : set.made ? "photo" : "not said"}`, 4, 238)); // prettier-ignore
    names.push(f.id);
  }
  const t = tile(tiles, Math.min(5, tiles.length), names);
  mkdirSync(dirname(flags.sheet) || ".", { recursive: true });
  writeFileSync(flags.sheet, png(t.width, t.height, t.rgba));
  console.log(`look at ${flags.sheet}: ${tiles.length} candidates flat at 256 as \`material\` makes them with no tone, each with its mean colour (the band at its foot) and how it was made`); // prettier-ignore
}

async function material() {
  const [given, more] = words;
  if (!given || more) fail(`material: one material's id (as search prints it: ambientcg:MetalPlates001, polyhaven:metal_plate_02)\n${USAGE}`); // prettier-ignore
  const [prefix, bare] = given.includes(":") ? given.split(":") : [flags.source, given];
  const source = prefix ?? (/^[a-z0-9_]+$/.test(bare) ? "polyhaven" : "ambientcg");
  if (!SOURCES.includes(source)) fail(`material: ${source} is not a library (${SOURCES.join(", ")})`);
  if (!flags.name) fail(`material: --name <texture>, the name the map's faces wear (15 letters)\n${USAGE}`);
  if (!flags.o) fail(`material: -o <folder> is where the texture and its set go\n${USAGE}`);
  const size = /^\d+$/.test(flags.size ?? "") ? [+flags.size, +flags.size] : /^\d+x\d+$/.test(flags.size ?? "") ? flags.size.split("x").map(Number) : null; // prettier-ignore
  if (!size || size.some((v) => !v || v % 16)) fail(`material: --size 256, 512 or WxH (multiples of 16), not ${flags.size}\n${USAGE}`);
  const tone = numbers("tone", [3, 4], (v, i) => v >= 0 && (i < 3 ? v <= 255 : v <= 1), "r,g,b of 0 to 255 and an amount of 0 to 1");
  const [chroma] = numbers("chroma", [1], (v) => v >= 0 && v <= 2, "the share of its colour kept round its grey, 0 to 2 (1 as it is)") ?? [];
  const shift = numbers("shift", [2], Number.isInteger, "dx,dy, whole texels");
  if (flags.final && !tone) fail(`--final: the tone is what is final; give --tone r,g,b\n${USAGE}`);
  if (flags.holes && !maps.hasHoles(flags.name)) fail(`--holes: a texture with holes is named {name, not ${flags.name}`);
  const mask = flags.holes && readPicture(readFileSync(flags.holes));
  const holes = mask && ((x, y, w, h) => mask.data[(Math.floor((y * mask.height) / h) * mask.width + Math.floor((x * mask.width) / w)) * 3] < 128); // prettier-ignore
  const part = numbers("part", [4], (v) => v >= 0 && v <= 1, "x0,y0,x1,y1, each 0 to 1");
  if (part && !(part[2] > part[0] && part[3] > part[1])) fail(`--part: x1 over x0 and y1 over y0, not ${flags.part}`);
  const [metres] = numbers("metres", [1], (v) => v > 0, "the metres a tile covers, over 0") ?? [];
  const [wall] = numbers("wall", [1], (v) => v > 0, "a wall's width in units") ?? [512];
  const [shown] = numbers("scale", [1], (v) => v > 0, "units a texel, over 0") ?? [];
  let against = null;
  if (flags.against) {
    const m = /^(.+\.wad):([^@]+)(?:@([\d.]+))?$/i.exec(flags.against);
    if (!m) fail(`--against x.wad:name[@scale], not ${flags.against}`);
    const found = maps.textureFromWad(readFileSync(m[1]), m[2]);
    if (!found) fail(`--against: ${m[1]} has no texture ${m[2]}`);
    against = { ...maps.textureRgba(found), name: found.name, scale: m[3] ? +m[3] : 1 };
  }
  const set = await downloadSet(source, bare, { cache });
  const made = makeMaterial(set, { name: flags.name, size, tone, part, marks: flags.marks, metres, dither: !!flags.dither, even: !!flags.even, final: !!flags.final, chroma, shift, mirror: !!flags.mirror, holes }); // prettier-ignore
  mkdirSync(flags.o, { recursive: true });
  const written = writeMaterial(made, flags.o, set);
  const sheetFile = join(flags.o, `${flags.name}.sheet.png`);
  const sheet = wallSheet({ source: readPicture(readFileSync(set.files.color)), texture: made.texture, scale: shown ?? made.report.scale, against, wall, name: flags.name }); // prettier-ignore
  writeFileSync(sheetFile, png(sheet.width, sheet.height, sheet.rgba));
  console.log(`the set: ${set.fetched.length} downloaded, ${set.kept.length} already in ${join(cache, source, bare)}`);
  for (const line of made.lines) console.log(line);
  for (const e of made.errors) console.log(`ERROR ${e}`);
  for (const w of made.warnings) console.log(`WARN  ${w}`);
  console.log(`wrote ${written.join(", ")}, ${sheetFile}`);
  console.log(`look at ${sheetFile}: the source | the tile 3 x 3 (no line, no jump at the joins) | on a wall ${wall} wide beside a player 72 high${against ? ` | ${against.name} as it is now` : ""}`); // prettier-ignore
  console.log(CREDITS[source]);
  const passed = !made.errors.length;
  console.log(`${passed ? "PASS" : "FAIL"}: ${passed ? `${flags.name} ${size.join("x")}, tiles (seam ${made.report.seam.after}), brightness ${made.report.brightness}${made.warnings.length ? `, with ${made.warnings.length} warning${made.warnings.length > 1 ? "s" : ""}` : ""}` : made.errors.join("; ")}`); // prettier-ignore
  if (!passed) process.exit(1);
}

/** The sets' normal and gloss maps for PrimeXT, at the size of each base texture (primext.mjs). */
function primext() {
  if (!words.length) fail(`primext: which sets? a <texture>.set folder, or a folder of them (what \`material\` writes)\n${USAGE}`);
  if (!flags.o) fail(`primext: -o <folder> is where the .tga files go (the game's textures/)\n${USAGE}`);
  const metal = valuesOf(flags.metal, "--metal");
  const rough = valuesOf(flags.rough, "--rough");
  const bad = Object.entries(metal).find(([, v]) => v < 0 || v > 1);
  if (bad) fail(`--metal: ${bad[0]} 0 to 1, not ${bad[1]}`);
  let lines;
  try {
    lines = writePrimext(words, flags.o, { metal, rough, flatten: valuesOf(flags.flatten, "--flatten") });
  } catch (error) {
    console.log(`FAIL: ${error.message}`);
    process.exit(1);
  }
  for (const line of lines) console.log(line.startsWith("WARN ") ? `WARN  ${line.slice(5)}` : `  ${line}`);
  const warns = lines.filter((line) => line.startsWith("WARN ")).length;
  console.log(`PASS: ${lines.length - warns} textures${warns ? ` (${warns} warnings)` : ""}: <name>_norm.tga (DirectX green) and <name>_gloss.tga (R smoothness, G metal, B occlusion, A 128) in ${flags.o}`);
}

function wad() {
  const [folder, more] = words;
  if (!folder || more) fail(`wad: one folder of <texture>.png (what \`material\` writes)\n${USAGE}`);
  if (!flags.o || !/\.wad$/i.test(flags.o)) fail(`wad: -o x.wad is where the .wad goes\n${USAGE}`);
  const made = wadOfFolder(folder);
  mkdirSync(dirname(flags.o) || ".", { recursive: true });
  writeFileSync(flags.o, made.bytes);
  for (const t of made.textures) console.log(`  ${t.name.padEnd(16)} ${t.width}x${t.height}`);
  for (const f of made.check.facts) console.log(`      ${f}`);
  for (const e of made.check.errors) console.log(`ERROR ${e}`);
  for (const w of made.check.warnings) console.log(`WARN  ${w}`);
  const passed = !made.check.errors.length;
  console.log(`${passed ? "PASS" : "FAIL"}: ${flags.o}, ${made.textures.length} textures, ${Math.round(statSync(flags.o).size / 1024)} KB${passed ? ", as smak check takes it for goldsrc" : `: ${made.check.errors.join("; ")}`}`); // prettier-ignore
  if (!passed) process.exit(1);
}
