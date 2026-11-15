#!/usr/bin/env node
// The pack's commands: Poly Haven's CC0 models searched, and one brought into the game as a prop (README.md).
//
//   node packs/assets/bin.mjs search <words> [--limit n]
//   node packs/assets/bin.mjs prop <id> -o out/<name>.mdl --height <units> | --scale <n> [--triangles n] [--texture 256|512] [--cache <folder>]
//
// `smak` cannot reach a pack (the kit never imports one), so the pack has its own entry. A check ends with one
// line, PASS or FAIL and its reasons, the detail in a file it names (docs/COMMANDS.md, "Answers in text first").
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { png } from "../../src/index.mjs";
import {
  assetList,
  searchAssets,
  assetLine,
  assetInfo,
  downloadGltf,
  realSize,
  CREDIT,
  DEFAULT_CACHE,
} from "./polyhaven.mjs";
import { makeProp, propSheet, creditText } from "./prop.mjs";

const USAGE = `usage: node packs/assets/bin.mjs search <words> [--limit n]
       node packs/assets/bin.mjs prop <id> -o out/<name>.mdl --height <units> | --scale <n> [--triangles n] [--texture 256|512] [--cache <folder>]`;
const fail = (said) => {
  console.error(said);
  process.exit(1);
};
const [command, ...rest] = process.argv.slice(2);
const words = [];
const flags = {};
const VALUED = {
  search: ["--limit"],
  prop: ["-o", "--height", "--scale", "--triangles", "--texture", "--cache"],
};
if (!VALUED[command]) fail(USAGE);
for (let at = 0; at < rest.length; at++) {
  if (rest[at].startsWith("-")) {
    if (!VALUED[command].includes(rest[at])) fail(`${command}: what is ${rest[at]}?\n${USAGE}`);
    if (rest[at + 1] === undefined) fail(`${rest[at]} needs a value\n${USAGE}`);
    flags[rest[at].replace(/^-+/, "")] = rest[++at];
  } else words.push(rest[at]);
}
const number = (name, test, said) => {
  if (flags[name] === undefined) return undefined;
  const value = Number(flags[name]);
  if (!test(value)) fail(`--${name}: ${said}, not ${flags[name]}`);
  return value;
};
const cache = flags.cache ?? DEFAULT_CACHE;

try {
  if (command === "search") await search();
  else await prop();
} catch (error) {
  fail(`${command}: ${error.message}`);
}

async function search() {
  if (!words.length) fail(`search: what is looked for?\n${USAGE}`);
  const limit = number("limit", (v) => Number.isInteger(v) && v > 0, "a whole number from 1") ?? 20;
  const { list, from } = await assetList({ cache });
  const found = searchAssets(list, words);
  for (const { id, asset } of found.slice(0, limit)) console.log(assetLine(id, asset));
  console.log(
    `${found.length} of ${Object.keys(list).length} models hold "${words.join(" ")}"${found.length > limit ? `, the first ${limit} shown` : ""} (the list: ${from})`,
  );
  console.log(`${CREDIT}. A prop: node packs/assets/bin.mjs prop <id> -o out/<name>.mdl --scale 1`);
}

async function prop() {
  const [id, more] = words;
  if (!id || more) fail(`prop: one asset's id\n${USAGE}`);
  const out = flags.o;
  if (!out || !/\.mdl$/i.test(out)) fail(`prop: -o out/<name>.mdl is where the prop goes\n${USAGE}`);
  const height = number("height", (v) => v > 0, "a height in units over 0");
  const scale = number("scale", (v) => v > 0, "a number over 0 (1 its true size, 39.37 units a metre)");
  if ((height === undefined) === (scale === undefined))
    fail("prop: --height <units> or --scale <n> (--scale 1: its true size, Poly Haven's), one of them");
  const triangles = number("triangles", (v) => Number.isInteger(v) && v > 0, "a whole number from 1");
  const texture = number("texture", (v) => v === 256 || v === 512, "256 or 512") ?? 512;

  const info = await assetInfo(id);
  const real = realSize(info);
  const got = await downloadGltf(id, { cache });
  const made = makeProp(got.file, {
    name: basename(out),
    height,
    scale,
    triangles,
    texture,
    real: real?.metres,
  });
  const r = made.report;
  const base = out.replace(/\.mdl$/i, "");
  mkdirSync(dirname(out) || ".", { recursive: true });
  writeFileSync(out, made.mdl);
  writeFileSync(`${base}.credit.txt`, creditText(id, info));
  const sheet = propSheet(made);
  writeFileSync(`${base}.png`, png(sheet.width, sheet.height, sheet.rgba));

  const units = (list) => list.map((v) => v.toFixed(1)).join(" x ");
  const authors = Object.keys(info.authors ?? {}).join(", ") || "authors not given";
  const lines = [
    `${info.name} (${id}) by ${authors}: CC0. ${CREDIT}.`,
    `the file: ${got.file} (${got.fetched.length} downloaded, ${got.kept.length} already there; left out, a studio model having no use for them: ${got.skipped.length} normal, roughness and metal maps)`,
    `source: ${r.sourceTriangles} triangles, textures ${r.sourceTextures.join(", ")}${real ? `; Poly Haven's size ${real.metres.map((v) => v.toFixed(3)).join(" x ")} m` : ""}`,
    `prop: ${r.triangles} triangles (${r.target} asked) on ${r.points} points, ${r.bodyparts} bodypart${r.bodyparts > 1 ? "s" : ""}, textures ${r.textures.join(", ")} (base colour only: no normal, roughness or metal map), ${Math.round(r.bytes / 1024)} KB`,
    `size: ${units(r.size)} units (x y z), ${r.times === 1 ? "its true size" : `${+r.times.toFixed(4)} times its true size`}; its box ${units(r.box.mn)} to ${units(r.box.mx)}`,
    `check goldsrc: ${r.check.errors.length ? r.check.errors.join("; ") : "no error"}, ${r.check.warnings.length} warning${r.check.warnings.length === 1 ? "" : "s"}`,
    `form: boxiness ${r.form.measures.boxiness} (${r.form.kind}: median ${r.form.rows.at(-1).band.median}, 95th ${r.form.rows.at(-1).band.most})${r.form.warnings.length ? ", boxier than 19 of 20 of Half-Life's" : ""}; silhouette corners front/side/top ${r.form.counts.corners?.join("/")}`,
    ...made.lines,
    ...r.facts,
    ...r.form.rows.map(
      (row) =>
        `${r.form.kind}: ${row.key} ${row.value} (median ${row.band.median}, 5th ${row.band.least}, 95th ${row.band.most})${row.off ? " OFF" : ""}`,
    ),
    `wrote ${out}, ${base}.credit.txt, ${base}.png`,
  ];
  const shown = [...made.errors.map((e) => `ERROR ${e}`), ...made.warnings.map((w) => `WARN  ${w}`)];
  const passed = !made.errors.length;
  const said = passed
    ? `${basename(out)} fit for goldsrc: ${r.triangles} triangles, ${units(r.size)} units, standing on z = 0${made.warnings.length ? `, with ${made.warnings.length} warnings` : ""}`
    : `${made.errors.length} error${made.errors.length > 1 ? "s" : ""}: ${made.errors[0]}`;
  const look = `look at ${base}.png: each view the source (left) and the prop (right) from the same camera; the last two from a player's eye 96 and 256 away, as many pixels as a 1280-wide screen shows`;
  const detail = join(tmpdir(), "smak", `assets-prop-${basename(out).replace(/[^\w.-]/g, "_")}.txt`);
  mkdirSync(dirname(detail), { recursive: true });
  writeFileSync(detail, `${[...lines, ...shown, look, `${passed ? "PASS" : "FAIL"}: ${said}`].join("\n")}\n`);
  for (const line of [...lines.slice(0, 7), ...shown]) console.log(line);
  console.log(`the detail: ${detail}`);
  console.log(look);
  console.log(`${passed ? "PASS" : "FAIL"}: ${said}`);
  if (!passed) process.exit(1);
}
