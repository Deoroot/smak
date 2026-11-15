// The signs pack (packs/signs): a sign drawn by a program onto a texture, with no network and no picture of
// anyone's: the stroke font (every capital and digit, a small letter its capital, a letter it has not said), words
// laid in a box left, centre and right and fitted to it, the shapes (a filled rectangle, an arc, a polygon, an
// arrow, copies, a share of them, one only within another), the four finishes (neon's glow and its emissive, a lit
// panel's ground and frame, paint worn over a material made here by packs/materials with its set carried over and
// taken by packs/gltf's lit way, a plate), the folder a .wad checkWad passes, the sheet, the command and its refusals.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import { textPaths, textWidth } from "../packs/signs/font.mjs";
import { makeSign, writeSign, signSheet, pictureOf, FINISHES } from "../packs/signs/sign.mjs";
import { makeMaterial, writeMaterial, wadOfFolder, readPicture } from "../packs/materials/material.mjs";
import { mapGlb } from "../packs/gltf/gltf.mjs";
import { writeSet } from "./fixture-materials.mjs";
import { writeLitSet, TWOROOMS } from "./fixture-gltf.mjs";
import { test, sure, near, tmp, HERE, runRefused } from "./helper.mjs";

const BIN = join(HERE, "../packs/signs/bin.mjs");
const at = (image, x, y) => [0, 1, 2].map((c) => image.data[(y * image.width + x) * 3 + c]);
const luma = (rgb) => 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
/** A material as packs/materials writes it (a wave that tiles, 64 a side), in a folder of the temp one. */
const materialFolder = join(tmp, "signs-material");
const wallSet = writeSet(join(tmp, "signs-material-set"));
writeMaterial(makeMaterial(wallSet, { name: "sg_wall", size: [64, 64] }), materialFolder, wallSet);

test("the font: every capital, digit and mark has strokes inside its 12 rows, a small letter is its capital, a letter it has not is said, a word's width", () => {
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:!?'\"-+/()=<>%←→↑↓") {
    const { paths, missing } = textPaths(letter, 0, 0, 12);
    sure(paths.length && !missing.length, `no strokes for ${letter}`);
    sure(paths.flat().every(([x, y]) => x >= 0 && x <= 10 && y >= 0 && y <= 13), `${letter} leaves its grid`);
  }
  sure(JSON.stringify(textPaths("exit", 3, 4, 20).paths) === JSON.stringify(textPaths("EXIT", 3, 4, 20).paths), "a small letter");
  sure(textPaths("A~B", 0, 0, 12).missing.join() === "~", "the letter it has not");
  near(textWidth("HI", 12), 8 + 0.2 * 12, 1e-9, "H is 8 of 12 wide, the gap a fifth of the height, I one stroke");
  near(textWidth("HI", 24), 2 * textWidth("HI", 12), 1e-9, "twice as high, twice as wide");
  sure(textPaths("O", 0, 0, 12).paths[0].length > 20, "an O's corners are rounded");
});

test("neon: a glow round the strokes on a dark ground, white-hot along the tube, the ground no part of its emissive; ~name and the texture light said", () => {
  const made = makeSign({ name: "~sg_neon", size: [96, 32], finish: "neon", frame: 1, items: [{ text: "EXIT", box: [8, 6, 88, 26], width: 2.5 }, { circle: [48, 16, 14], from: 200, to: 340 }] }); // prettier-ignore
  sure(!made.errors.length && !made.warnings.length, [...made.errors, ...made.warnings].join(" | "));
  sure(made.texture.width === 96 && made.texture.height === 32 && made.texture.pixels.length === 96 * 32 && made.texture.palette.length === 768, "the texture");
  const row = Array.from({ length: 96 }, (_, x) => luma(at(made.picture, x, 16)));
  const peak = row.indexOf(Math.max(...row));
  sure(row[peak] > 200 && row[peak] > luma(FINISHES.neon.colour), `the tube's middle is hotter than its colour: ${row[peak]}`);
  const beside = [3, 4, 5, 6].map((d) => row[peak + d]).find((v) => v < 150);
  sure(beside > luma(FINISHES.neon.ground) + 20, `a glow beside the tube: ${row.slice(peak, peak + 7).map(Math.round)}`);
  near(luma(at(made.picture, 3, 3)), luma(FINISHES.neon.ground), 12, "the ground far from a tube");
  sure(at(made.emissive, 0, 0).join() === "0,0,0" && luma(at(made.emissive, peak, 16)) > 150, "the emissive: the frame dark, the tube lit");
  sure(made.lines.some((line) => /"~sg_neon" "\d+ \d+ \d+ <brightness>" in info_texlights/.test(line)), made.lines.join(" | "));
  sure(makeSign({ name: "sg_neon", size: [96, 32], finish: "neon", items: [] }).lines.some((line) => /does not begin with ~/.test(line)), "no ~ said");
});

test("words in a box: left, centre and right, fitted to it when no height is given, several lines; a lit panel's ground from top to bottom and its frame", () => {
  const sign = (item) => makeSign({ name: "~sg_lit", size: [128, 64], finish: "lit", flat: true, ground: { from: [250, 250, 250], to: [200, 220, 250] }, frame: { width: 2, colour: [10, 10, 10] }, items: [{ colour: [0, 0, 0], ...item }] }); // prettier-ignore
  const inked = (made) => { const xs = []; for (let x = 4; x < 124; x++) for (let y = 4; y < 60; y++) if (luma(at(made.picture, x, y)) < 60) xs.push(x); return [Math.min(...xs), Math.max(...xs)]; }; // prettier-ignore
  const [left, centre, right] = ["left", "centre", "right"].map((align) => inked(sign({ text: "TO", box: [10, 10, 118, 54], height: 20, align })));
  sure(left[0] === 10 && right[1] === 117 && Math.abs(centre[0] + centre[1] - 127) <= 1, `${left} ${centre} ${right}`);
  const fitted = sign({ text: ["PLATFORM", "2"], box: [10, 10, 118, 54] });
  sure(!fitted.warnings.length && inked(fitted)[0] >= 10 && inked(fitted)[1] <= 117, `fitted: ${inked(fitted)} ${fitted.warnings.join()}`);
  sure(/its smallest capitals [\d.]+ texels high/.test(fitted.lines[0]), fitted.lines[0]);
  sure(at(fitted.picture, 64, 3)[2] === 250 && at(fitted.picture, 64, 60)[0] < 205 && at(fitted.picture, 1, 30).join() === "10,10,10", "the ground and the frame");
  sure(at(sign({ text: "A", at: [20, 20], height: 10 }).emissive, 1, 1).join() === "0,0,0", "the frame gives no light");
});

test("shapes: a filled rectangle (rounded), an arc, a polygon, an arrow, copies by repeat, a share of them by some, one only within another, a colour as #rrggbb", () => {
  const plate = (items) => makeSign({ name: "sg_plate", size: [64, 64], finish: "plate", frame: 0, ground: [0, 0, 0], items }).picture;
  const lit = (picture, x, y) => luma(at(picture, x, y)) > 128;
  const box = plate([{ rect: [8, 8, 40, 24], radius: 6, fill: true, colour: "#ffffff" }]);
  sure(lit(box, 24, 16) && lit(box, 9, 16) && !lit(box, 8, 8) && !lit(box, 42, 16) && !lit(box, 24, 26), "the rectangle, its corner rounded off");
  const arc = plate([{ circle: [32, 32, 20], from: 0, to: 180, width: 3, colour: [255, 255, 255] }]);
  sure(lit(arc, 32, 52) && lit(arc, 12, 33) && !lit(arc, 32, 12) && !lit(arc, 32, 32), "the lower half of a circle (y is down)");
  const shape = plate([{ polygon: [[4, 60], [32, 4], [60, 60]], colour: [255, 255, 255] }, { arrow: [32, 44, 8], dir: 90, colour: [255, 0, 0], width: 2 }]); // prettier-ignore
  sure(lit(shape, 32, 30) && !lit(shape, 6, 10) && at(shape, 32, 37)[1] < 60 && at(shape, 32, 37)[0] > 200, "a triangle filled, an arrow up on it");
  const dots = { rect: [2, 2, 4, 4], fill: true, colour: [255, 255, 255], repeat: [10, 10, 6, 6] };
  const count = (picture) => { let n = 0; for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) n += lit(picture, 3 + i * 6, 3 + j * 6) ? 1 : 0; return n; }; // prettier-ignore
  sure(count(plate([dots])) === 100, "a hundred copies");
  const some = count(plate([{ ...dots, some: 0.3 }]));
  sure(some > 15 && some < 45 && some === count(plate([{ ...dots, some: 0.3 }])), `a share of them, the same each time: ${some}`);
  const within = plate([{ rect: [0, 0, 32, 64], fill: true, colour: [0, 0, 0] }, { ...dots, within: 0 }]);
  sure(count(within) === 50 && lit(within, 27, 3) && !lit(within, 33, 3), `only within the first: ${count(within)}`);
  const refusal = (items) => { try { plate(items); return ""; } catch (error) { return error.message; } }; // prettier-ignore
  sure(/an item is a text, line, polygon, rect, circle or arrow/.test(refusal([{ square: 1 }])) && /within: 3 is not an item before/.test(refusal([{ ...dots, within: 3 }])) && /its height, or a box to fit/.test(refusal([{ text: "A", at: [1, 1] }])), "the refusals"); // prettier-ignore
});

test("paint over a material: the material's own texels round it, worn (chipped more with more wear, first where the material is dark), its set carried over with the paint on colour and roughness, the credit", () => {
  const spec = { name: "sg_num", size: [48, 48], finish: "paint", on: "sg_wall", at: [16, 8], items: [{ text: "7", box: [4, 4, 44, 44], width: 8, colour: [190, 30, 20] }] }; // prettier-ignore
  const made = makeSign(spec, { base: materialFolder });
  sure(!made.errors.length && !made.warnings.length, [...made.errors, ...made.warnings].join(" | "));
  const wall = readPicture(readFileSync(join(materialFolder, "sg_wall.png")));
  sure(at(made.picture, 1, 1).every((v, c) => Math.abs(v - at(wall, 17, 9)[c]) < 0.01), "off the paint, the material's texel from where the sign lies on it");
  const red = (m) => { let n = 0; for (let i = 0; i < 48 * 48; i++) n += m.picture.data[i * 3] - m.picture.data[i * 3 + 1] > 60 ? 1 : 0; return n; }; // prettier-ignore
  const [fresh, worn] = [makeSign({ ...spec, wear: 0 }, { base: materialFolder }), makeSign({ ...spec, wear: 0.6 }, { base: materialFolder })];
  sure(red(fresh) > red(made) && red(made) > red(worn) && red(worn) > 0, `chipped more with more wear: ${red(fresh)} ${red(made)} ${red(worn)}`);
  const [kept, lost] = [[], []];
  for (let i = 0; i < 48 * 48; i++) if (fresh.picture.data[i * 3] - fresh.picture.data[i * 3 + 1] > 60) (worn.picture.data[i * 3] - worn.picture.data[i * 3 + 1] > 60 ? kept : lost).push(luma(at(wall, (16 + (i % 48)) % 64, (8 + Math.floor(i / 48)) % 64))); // prettier-ignore
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  sure(mean(lost) < mean(kept), `the paint went first where the material is dark: lost on ${mean(lost).toFixed(1)}, kept on ${mean(kept).toFixed(1)}`);
  sure(Object.keys(made.layers).join() === "color,normal,roughness" && made.layers.color.width === 48 && /its set carried over at 48x48: color, normal, roughness/.test(made.lines.join("\n")), made.lines.join(" | ")); // prettier-ignore
  const middle = 24 * 48 + 30;
  sure(made.layers.color.data[middle * 3] - made.layers.color.data[middle * 3 + 1] > 60 && made.layers.roughness.data[middle * 3] < 128 - 5 && made.layers.roughness.data[0] === 128, "the paint on the set's colour, a little smoother on its roughness"); // prettier-ignore
  sure(made.layers.normal.data[middle * 3 + 2] === 230, "the normal as it was");
  const folder = join(tmp, "signs-painted");
  const written = writeSign(made, folder);
  const json = JSON.parse(readFileSync(join(folder, "sg_num.set", "material.json"), "utf8"));
  sure(written.length === 3 && json.part === null && json.texture.name === "sg_num" && json.on === "sg_wall" && json.id === "TestSet001", JSON.stringify(json));
  sure(/^sg_num: painted by SMAK's signs pack over sg_wall/.test(readFileSync(join(folder, "sg_num.credit.txt"), "utf8")) && /ambientCG/.test(readFileSync(join(folder, "sg_num.credit.txt"), "utf8")), "the credit carried"); // prettier-ignore
});

test("a painted sign's set is one packs/gltf's lit way takes: the two rooms' wall, written by the pack with no paint, read with its set and no note", () => {
  const walls = writeLitSet(join(tmp, "signs-lit-wall"));
  const wall = smak.unpng(readFileSync(join(walls, "smakwall.png")));
  const made = makeSign({ name: "smakwall", size: [wall.width, wall.height], finish: "paint", on: "smakwall", items: [] }, { base: walls });
  const folder = join(tmp, "signs-lit-sign");
  writeSign(made, folder);
  sure(existsSync(join(folder, "smakwall.set", "color.png")) && existsSync(join(folder, "smakwall.set", "normal.png")), "a set with no colour gets the texture's own");
  const { facts } = mapGlb(readFileSync(TWOROOMS), { light: "lit", sets: [folder] });
  sure(facts.sets === 1 && !facts.notes.some((note) => note.startsWith("smakwall")), `${facts.sets} ${facts.notes.join(" | ")}`);
});

test("the folder is a .wad checkWad passes, colour for colour; a glowing sign's set is emissive.png and sign.json (no material.json: no relief claimed); the sheet at full and a quarter", () => {
  const folder = join(tmp, "signs-folder");
  const neon = makeSign({ name: "~sg_neon", size: [96, 32], finish: "neon", items: [{ text: "OPEN", box: [8, 6, 88, 26] }] });
  const plate = makeSign({ name: "sg_board", size: [64, 32], texels: 2, finish: "plate", items: [{ text: "← WAY OUT", box: [6, 6, 58, 26] }] });
  for (const made of [neon, plate]) writeSign(made, folder);
  sure(existsSync(join(folder, "~sg_neon.set", "emissive.png")) && existsSync(join(folder, "~sg_neon.set", "sign.json")) && !existsSync(join(folder, "~sg_neon.set", "material.json")) && !existsSync(join(folder, "sg_board.set")), "the sets"); // prettier-ignore
  sure(plate.texture.width === 128 && /64 x 32 units at 2 texels a unit, so lay it at scale 0.5/.test(plate.lines[0]), plate.lines[0]);
  const wad = wadOfFolder(folder);
  sure(!wad.check.errors.length && wad.textures.map((t) => `${t.name} ${t.width}x${t.height}`).join() === "sg_board 128x64,~sg_neon 96x32", JSON.stringify(wad.textures)); // prettier-ignore
  const back = smak.maps.textureFromWad(wad.bytes, "~sg_neon");
  sure(Buffer.compare(Buffer.from(smak.maps.textureRgba(back).rgba), Buffer.from(pictureOf(neon).rgba)) === 0, "the .wad's texture is the sign's, colour for colour");
  const sheet = signSheet([{ name: "neon", pictures: [pictureOf(neon)] }, { name: "plate", pictures: [pictureOf(neon), pictureOf(plate)] }]);
  sure(sheet.width === 12 + 96 + 12 + 24 + 12 + 128 + 12 + 32 + 12 && sheet.height === 32 + 30 + 64 + 30, `${sheet.width}x${sheet.height}`);
});

test("the command: a list of signs made into a folder with their sheet, PASS; a size that is not in 16s, FAIL and nothing written of it; sheet --against; the refusals", () => {
  const folder = join(tmp, "signs-command");
  const spec = join(tmp, "signs-spec.json");
  writeFileSync(spec, JSON.stringify([{ name: "~sg_a", size: [64, 32], finish: "lit", items: [{ text: "TICKETS", box: [4, 4, 60, 28] }] }, { name: "sg_b", size: [48, 48], finish: "paint", on: "signs-material/sg_wall", items: [{ text: "B2", box: [2, 8, 46, 40] }] }])); // prettier-ignore
  const run = runRefused(BIN, "sign", spec, "-o", folder);
  sure(run.code === 0 && /\nPASS: 2 signs in /.test(run.out) && /look at .*signs-spec\.sheet\.png/.test(run.out), run.out + run.err);
  sure(["~sg_a.png", "~sg_a.set/emissive.png", "sg_b.png", "sg_b.set/material.json", "signs-spec.sheet.png"].every((file) => existsSync(join(folder, file))), "the files");
  const bad = join(tmp, "signs-bad.json");
  writeFileSync(bad, JSON.stringify({ name: "sg_c", size: [50, 32], finish: "plate", items: [] }));
  const failed = runRefused(BIN, "sign", bad, "-o", folder);
  sure(failed.code === 1 && /\nFAIL: sg_c: the texture would be 50x32/.test(failed.out) && !existsSync(join(folder, "sg_c.png")), failed.out + failed.err);
  const sheet = join(tmp, "signs-against.sheet.png");
  const drawn = runRefused(BIN, "sheet", spec, "-o", sheet, "--against", folder);
  sure(drawn.code === 0 && smak.unpng(readFileSync(sheet)).width === 12 + 2 * (64 + 12 + 16 + 12), drawn.out + drawn.err);
  sure(/usage:/.test(runRefused(BIN).err) && /what is --loud/.test(runRefused(BIN, "sign", spec, "-o", folder, "--loud").err) && /-o <folder> is where/.test(runRefused(BIN, "sign", spec).err), "usage"); // prettier-ignore
  sure(/none\.json is not there/.test(runRefused(BIN, "sign", join(tmp, "none.json"), "-o", folder).err) && /--against: .*sg_a\.png is not there/.test(runRefused(BIN, "sheet", spec, "-o", sheet, "--against", tmp).err), "a file not there"); // prettier-ignore
  writeFileSync(bad, JSON.stringify({ name: "sg_d", size: [64, 32], finish: "chalk", items: [] }));
  sure(/finish: neon, lit, paint, plate, not "chalk"/.test(runRefused(BIN, "sign", bad, "-o", folder).err), "a finish it has not");
  writeFileSync(bad, JSON.stringify({ name: "sg_d", size: [64, 32], finish: "paint", on: "nowhere/wall", items: [] }));
  sure(/on: .*wall\.png is not there: a material packs\/materials made/.test(runRefused(BIN, "sign", bad, "-o", folder).err), "a material not there");
});
