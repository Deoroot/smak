#!/usr/bin/env node
// The pack's commands: signs made from a spec (a .json of one sign, or of several) into a folder as packs/materials
// writes its textures, and a sheet of several to look at (README.md). `smak` cannot reach a pack (the kit never
// imports one), so the pack has its own entry. `sign` ends with one line, PASS or FAIL and its reasons.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { png, unpng } from "../../src/index.mjs";
import { makeSign, writeSign, signSheet, pictureOf } from "./sign.mjs";

const USAGE = `usage: node packs/signs/bin.mjs sign <spec.json> -o <folder>
       node packs/signs/bin.mjs sheet <spec.json ...> -o <x.sheet.png> [--against <folder>]
a spec: { "name": "~exit", "size": [96, 32], "texels": 2, "finish": "neon|lit|paint|plate", "items": [{ "text": "EXIT", "box": [8, 6, 88, 26] }] }, or a list of them (docs/SIGNS.md)`;
const fail = (said) => {
  console.error(said);
  process.exit(1);
};
const [command, ...rest] = process.argv.slice(2);
if (command !== "sign" && command !== "sheet") fail(USAGE);
const [words, flags] = [[], {}];
for (let at = 0; at < rest.length; at++) {
  if (!rest[at].startsWith("-")) words.push(rest[at]);
  else if (!(rest[at] === "-o" || (command === "sheet" && rest[at] === "--against"))) fail(`${command}: what is ${rest[at]}?\n${USAGE}`);
  else if (rest[at + 1] === undefined) fail(`${rest[at]} needs a value\n${USAGE}`);
  else flags[rest[at].replace(/^-+/, "")] = rest[++at];
}
if (!words.length || (command === "sign" && words.length > 1)) fail(`${command}: ${command === "sign" ? "one spec" : "the specs to draw"}\n${USAGE}`);
if (!flags.o) fail(`${command}: -o ${command === "sign" ? "<folder> is where the textures go" : "<x.sheet.png> is the picture"}\n${USAGE}`);

/** The signs of a spec file, each made: [{ spec, made }]; a sign's `on` is looked for from the file's folder. */
function signsOf(file) {
  if (!existsSync(file)) fail(`${command}: ${file} is not there`);
  let read;
  try {
    read = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${command}: ${file} is not JSON: ${error.message}`);
  }
  return [read.signs ?? read].flat().map((spec) => ({ spec, made: makeSign(spec, { base: dirname(file) }) }));
}
const write = (file, sheet) => {
  mkdirSync(dirname(file) || ".", { recursive: true });
  writeFileSync(file, png(sheet.width, sheet.height, sheet.rgba));
};

try {
  if (command === "sign") {
    const all = signsOf(words[0]);
    const faults = [];
    let warned = 0;
    for (const { spec, made } of all) {
      for (const line of made.lines) console.log(line);
      for (const e of made.errors) console.log(`ERROR ${spec.name}: ${e}`);
      for (const w of made.warnings) console.log(`WARN  ${spec.name}: ${w}`);
      faults.push(...made.errors.map((e) => `${spec.name}: ${e}`));
      warned += made.warnings.length;
      if (!made.errors.length) console.log(`wrote ${writeSign(made, flags.o).join(", ")}`);
    }
    const good = all.filter(({ made }) => !made.errors.length);
    if (good.length) {
      const sheet = join(flags.o, `${basename(words[0]).replace(/\.json$/i, "")}.sheet.png`);
      write(sheet, signSheet(good.map(({ spec, made }) => ({ name: `${spec.name} ${made.texture.width}x${made.texture.height}`, pictures: [pictureOf(made)] })))); // prettier-ignore
      console.log(`look at ${sheet}: each sign at its size and at a quarter, as from four times as far: the words are to be read in both`);
      console.log(`the .wad: node packs/materials/bin.mjs wad ${flags.o} -o <x.wad>`);
    }
    console.log(`${faults.length ? "FAIL" : "PASS"}: ${faults.length ? faults.join("; ") : `${all.length} sign${all.length > 1 ? "s" : ""} in ${flags.o}${warned ? `, with ${warned} warning${warned > 1 ? "s" : ""}` : ""}`}`); // prettier-ignore
    if (faults.length) process.exit(1);
  } else {
    const rows = words.flatMap(signsOf).map(({ spec, made }) => {
      if (made.errors.length) fail(`sheet: ${spec.name}: ${made.errors.join("; ")}`);
      const old = flags.against && join(flags.against, `${spec.name}.png`);
      if (old && !existsSync(old)) fail(`sheet: --against: ${old} is not there`);
      return { name: `${spec.name} ${made.texture.width}x${made.texture.height}${old ? `: ${basename(flags.against)} then the pack` : ""}`, pictures: [...(old ? [unpng(readFileSync(old))] : []), pictureOf(made)] }; // prettier-ignore
    });
    write(flags.o, signSheet(rows));
    console.log(`look at ${flags.o}: ${rows.length} signs${flags.against ? `, each after the picture of its name in ${flags.against}` : ""}, at their size and at a quarter`); // prettier-ignore
  }
} catch (error) {
  fail(`${command}: ${error.message}`);
}
