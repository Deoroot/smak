// The packs' checkers broken in one way each: the assets pack's prop (packs/assets/prop.mjs makeProp, which
// `node packs/assets/bin.mjs prop` ends in PASS or FAIL by) given a small glTF written in test/fixture-assets.mjs
// that lies on its side where Poly Haven says it stands, and one with more points than one submodel holds that the
// reducer cannot take away. The twins are the same files whole.
import { join } from "node:path";
import { makeProp } from "../../packs/assets/prop.mjs";
import { writePropGltf } from "../fixture-assets.mjs";
import { makeMaterial } from "../../packs/materials/material.mjs";
import { writeSet } from "../fixture-materials.mjs";
import { tmp } from "../helper.mjs";
import { broken } from "./case.mjs";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { mapGlb } from "../../packs/gltf/gltf.mjs";
import { writeLitSet, TWOROOMS } from "../fixture-gltf.mjs";
import { godotProject, writeProject } from "../../packs/godot/godot.mjs";
import { checkProject } from "../../packs/godot/test/check.mjs";
import { readBsp, addEntity, withEntities } from "../../check/maps/index.mjs";
import { makeSign } from "../../packs/signs/sign.mjs";

const REAL = [0.4, 0.4, 1];
const upright = writePropGltf(join(tmp, "broken-prop-upright"));

broken("makeProp", "a file lying on its side where Poly Haven says it stands a metre high", {
  said: /^the file stands 0\.400 m high where Poly Haven says 1\.000 m: it may lie on its side$/,
  broken: () => makeProp(writePropGltf(join(tmp, "broken-prop-lying"), { lying: true }), { name: "lying.mdl", scale: 1, real: REAL }).errors, // prettier-ignore
  whole: () => makeProp(upright, { name: "upright.mdl", scale: 1, real: REAL }).errors,
});

broken(
  "makeProp",
  "600 small closed pieces beside it, 2400 points the reducer cannot take away: more than one submodel holds",
  {
    said: /^not one prop GoldSrc draws at its ease: \d+ triangles on \d+ points: more than one submodel of GoldSrc holds \(2048 points\), so it is in 2 bodyparts$/, // prettier-ignore
    broken: () => makeProp(writePropGltf(join(tmp, "broken-prop-heavy"), { pieces: 600 }), { name: "heavy.mdl", scale: 1 }).errors, // prettier-ignore
    whole: () => makeProp(writePropGltf(join(tmp, "broken-prop-light"), { pieces: 300 }), { name: "light.mdl", scale: 1 }).errors, // prettier-ignore
  },
);

const twins = writePropGltf(join(tmp, "broken-prop-twins"), { twin: true });
broken("makeProp", "a part asked for of a file that holds two objects: the third", {
  said: /^there is no part "3": the file holds 2 \(1: test_prop; 2: test_prop_b\)$/,
  broken: () => { try { makeProp(twins, { name: "third.mdl", scale: 1, part: 3 }); return []; } catch (error) { return [error.message]; } }, // prettier-ignore
  whole: () => { try { makeProp(twins, { name: "second.mdl", scale: 1, part: 2 }); return []; } catch (error) { return [error.message]; } }, // prettier-ignore
});

// ── the materials pack's material (packs/materials/material.mjs makeMaterial, which `node packs/materials/bin.mjs
// material` ends in PASS or FAIL by): a small set written in test/fixture-materials.mjs, broken one way each; its
// twin the same set whole (a wave that tiles, mid-grey, photographed) ──
const tiles = () => writeSet(join(tmp, "broken-material-tiles"));
const material = (options, size = [32, 32]) => makeMaterial(writeSet(join(tmp, `broken-material-${options.colour ?? options.made}`), options), { name: "mt_case", size }); // prettier-ignore
const whole = makeMaterial(tiles(), { name: "mt_case", size: [32, 32] });

broken("makeMaterial", "a picture of two flat halves: a seam at its edge and one at its middle, which mending brings to the edge", {
  said: /^the tile's seam is [\d.]+ times the steps inside it after mending \(2\.5 at most\): it shows as a line$/,
  broken: () => material({ colour: "halves" }).errors,
  whole: () => whole.errors,
});
broken("makeMaterial warnings", "a picture near black: under Valve's 5th brightness", {
  said: /^its mean brightness is [\d.]+, under 31, Valve's 5th/,
  broken: () => material({ colour: "dark" }).warnings,
  whole: () => whole.warnings,
});
broken("makeMaterial warnings", "one bright quarter: the tile shouts its repeat", {
  said: /^it shouts its repeat: the brightness of its 16 blocks spreads [\d.]+ of their mean, over 0\.08/,
  others: true, // its quarter's edges meet the wrap: it is mended too, and says so
  broken: () => material({ colour: "blotch" }).warnings,
  whole: () => whole.warnings,
});
broken("makeMaterial warnings", "a tone asked as the final mean that the picture cannot reach: 250 a channel, its texels clip at 255", {
  said: /^its mean after the marks is [\d./]+, not the 250\/250\/250 the tone asks \(1\.5 a channel at most\)/,
  others: true, // so bright it washes out too, and says so
  broken: () => makeMaterial(tiles(), { name: "mt_case", size: [32, 32], tone: [250, 250, 250], final: true, marks: "grime:amount=0.4" }).warnings, // prettier-ignore
  whole: () => makeMaterial(tiles(), { name: "mt_case", size: [32, 32], tone: [120, 120, 120], final: true, marks: "grime:amount=0.4" }).warnings, // prettier-ignore
});
broken("makeMaterial warnings", "a material ambientCG says a program drew (surface-fully-procedural)", {
  said: /^ambientcg:TestSet001 was drawn by a program \(surface-fully-procedural\), not photographed/,
  broken: () => material({ made: "surface-fully-procedural" }).warnings,
  whole: () => whole.warnings,
});

// ── the glTF pack's lit way (packs/gltf/gltf.mjs mapGlb with light "lit", whose notes map-gltf prints): smakwall's set
// written by test/fixture-gltf.mjs, broken one way each; its twin the same set whole ──
const setNotes = (options, folder) => mapGlb(readFileSync(TWOROOMS), { light: "lit", sets: [writeLitSet(join(tmp, folder), options)] }).facts.notes.filter((note) => note.startsWith("smakwall")); // prettier-ignore
broken("mapGlb lit sets", "a set whose texture beside it is another picture (its colours turned)", {
  said: /^smakwall: the set in .* is not of this texture \(its smakwall\.png differs by [\d.]+\): left out$/,
  broken: () => setNotes({ wrong: true }, "broken-lit-wrong"),
  whole: () => setNotes({}, "broken-lit-whole"),
});
broken("mapGlb lit sets", "a set of a texture made from a part of its source (--part)", {
  said: /^smakwall: its set is the whole source, the texture a part of it \(--part\): the maps would not lie on it, left out$/,
  broken: () => setNotes({ part: [0, 0, 0.5, 0.5] }, "broken-lit-part"),
  whole: () => setNotes({}, "broken-lit-whole"),
});

// ── the Godot pack (packs/godot): the project's notes (godotProject's WARN lines, which `project` prints) on the two
// rooms with more lamps than Godot's default atlas shadows, and the folder read back (packs/godot/test/check.mjs
// checkProject) with one file spoiled; the twins the two rooms and their project whole ──
const godotWarns = (bytes) => godotProject(bytes).facts.notes.filter((note) => note.startsWith("WARN:"));
broken("godotProject notes", "66 lamps, where Godot's default shadow atlas holds 64 in its largest quadrant", {
  said: /^WARN: 66 lamps in the lit way: Godot's default shadow atlas \(64 in its largest quadrant\) gives a shadow to some of them only, and a lamp with none shines through walls; /,
  broken: () => {
    let entities = readBsp(readFileSync(TWOROOMS)).entities;
    for (let n = 0; n < 64; n++) entities = addEntity(entities, "light", [32 + (n % 8) * 32, 32 + Math.floor(n / 8) * 32, 100], { _light: "255 255 255 50" }); // prettier-ignore
    return godotWarns(withEntities(readFileSync(TWOROOMS), entities));
  },
  whole: () => godotWarns(readFileSync(TWOROOMS)),
});
const godotFolder = (name, spoil) => {
  const folder = join(tmp, name);
  writeProject(folder, godotProject(readFileSync(TWOROOMS)));
  spoil?.(folder);
  return checkProject(folder).errors;
};
broken("checkProject", "lit.glb cut short (a copy that stopped)", {
  said: /^lit\.glb is not a whole \.glb \(1000 bytes\): write the project again$/,
  broken: () => godotFolder("broken-godot-cut", (folder) => writeFileSync(join(folder, "lit.glb"), readFileSync(join(folder, "lit.glb")).subarray(0, 1000))), // prettier-ignore
  whole: () => godotFolder("broken-godot-whole"),
});
broken("checkProject", "main.gd with the start's line taken out by hand", {
  said: /^main\.gd has no const START: the walker's values are gone$/,
  broken: () => godotFolder("broken-godot-start", (folder) => writeFileSync(join(folder, "main.gd"), readFileSync(join(folder, "main.gd"), "utf8").replace(/^const START := .*\n/m, ""))), // prettier-ignore
  whole: () => godotFolder("broken-godot-whole"),
});

// ── the signs pack's sign (packs/signs/sign.mjs makeSign, which `node packs/signs/bin.mjs sign` ends in PASS or FAIL
// by, and whose warnings it prints): one plate of one word, broken one way each; its twin the same plate whole ──
const plate = (sign = {}, item = {}) => makeSign({ name: "sg_case", size: [96, 32], finish: "plate", ...sign, items: [{ text: "EXIT", box: [8, 6, 88, 26], ...item }] }); // prettier-ignore
broken("makeSign", "a sign 100 units wide at a texel a unit: its texture not in 16s", {
  said: /^the texture would be 100x32 \(100 x 32 units at 1 texel a unit\): both sides are multiples of 16 \(112x32 is the next\)$/,
  broken: () => plate({ size: [100, 32] }).errors,
  whole: () => plate().errors,
});
broken("makeSign", "a name of 16 letters, one more than a texture's name holds", {
  said: /^the name "sg_platform_two_" is 16 letters: a texture's name holds 15$/,
  broken: () => plate({ name: "sg_platform_two_" }).errors,
  whole: () => plate().errors,
});
broken("makeSign warnings", "a word with a letter the font has not", {
  said: /^"CAFÉ": the font has no "É": left out /,
  broken: () => plate({}, { text: "CAFÉ" }).warnings,
  whole: () => plate().warnings,
});
broken("makeSign warnings", "capitals 5 texels high", {
  said: /^"EXIT": its capitals are 5 texels high, under 7: the strokes of an E or a B run together/,
  broken: () => plate({}, { height: 5, width: 1 }).warnings,
  whole: () => plate().warnings,
});
broken("makeSign warnings", "strokes half a texel wide", {
  said: /^"EXIT": its strokes are 0\.5 of a texel wide, under 1: they break up and fade/,
  broken: () => plate({}, { height: 16, width: 0.5 }).warnings,
  whole: () => plate().warnings,
});
broken("makeSign warnings", "strokes 5 wide on capitals 16 high: the letters fill in", {
  said: /^"EXIT": its strokes are 5 wide on capitals 16 high, over 0\.25 of them: the letters fill in$/,
  broken: () => plate({}, { height: 16, width: 5 }).warnings,
  whole: () => plate().warnings,
});
broken("makeSign warnings", "dark grey words on a dark grey plate", {
  said: /^"EXIT": its colour 52\/54\/52 on \d+\/\d+\/\d+ is a contrast of 1\.\d to 1, under 2: hard to read$/,
  broken: () => plate({}, { colour: [52, 54, 52] }).warnings,
  whole: () => plate().warnings,
});
broken("makeSign warnings", "a word placed so that it runs off the sign's right edge", {
  said: /^"EXIT": it is cut by the sign's edge \(it reaches [\d., -]+ of x0, x1, y0, y1 on a sign 96 x 32\)$/,
  broken: () => plate({}, { box: undefined, at: [60, 8], height: 16 }).warnings,
  whole: () => plate({}, { box: undefined, at: [20, 8], height: 16 }).warnings,
});
broken("makeSign warnings", "a height asked that is wider than the word's box", {
  said: /^"EXIT": at a height of 24 it does not fit its box; [\d.]+ does \(or give no height\)$/,
  broken: () => plate({}, { box: [30, 2, 66, 30], height: 24, width: 2 }).warnings,
  whole: () => plate({}, { box: [30, 2, 66, 30], width: 1.2 }).warnings,
});
const bare = () => {
  const folder = writeLitSet(join(tmp, "broken-sign-bare"));
  rmSync(join(folder, "smakwall.set"), { recursive: true });
  return folder;
};
const painted = (base) => makeSign({ name: "sg_case", size: [32, 32], finish: "paint", on: "smakwall", items: [{ line: [[4, 16], [28, 16]], width: 4 }] }, { base }); // prettier-ignore
broken("makeSign warnings", "paint over a material's texture that has no set beside it", {
  said: /^smakwall has no set beside it: the sign has no set, and an engine that lights it gives it no relief where the wall round it has$/,
  broken: () => painted(bare()).warnings,
  whole: () => painted(writeLitSet(join(tmp, "broken-sign-set"))).warnings,
});
