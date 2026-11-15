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
import { readFileSync } from "node:fs";
import { mapGlb } from "../../packs/gltf/gltf.mjs";
import { writeLitSet, TWOROOMS } from "../fixture-gltf.mjs";

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
