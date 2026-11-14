// A texture file checked (check/maps/wadcheck.mjs, `smak check x.wad`): a whole one passes; each name, size, mip, key colour
// and animated set that is wrong is told, by the sentence it must give. Files are made with the kit's writer, and its
// refusals bypassed by patching bytes (fixture-wad.mjs). The broken cases are in broken/maps.mjs.
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test, sure, tmp, runSmak, HERE } from "./helper.mjs";
import * as maps from "../check/maps/index.mjs";
import { flat, wholeWad, patched } from "./fixture-wad.mjs";

test("checkWad: a whole texture file has nothing said of it", () => {
  const report = maps.checkWad(wholeWad());
  sure(!report.errors.length && !report.warnings.length, [...report.errors, ...report.warnings].join(" | "));
  sure(/^5 textures/.test(report.facts[0]) && report.facts.includes("1 animated sets"), report.facts.join(" | "));
});

test("the writer refuses a name of sixteen letters, saying the name and the limit", () => {
  let said = "";
  try {
    maps.writeWad([flat("abcdefghijklmnop")]);
  } catch (error) {
    said = error.message;
  }
  sure(/abcdefghijklmnop is 16 letters: a map's holds 15/.test(said), said);
});

test("checkWad: what only warns: upper case, a size over the engine's, a key colour not blue, a mask with no hole", () => {
  const big = maps.writeWad([flat("big", 1024, 16)]);
  sure(maps.checkWad(big).warnings.some((w) => /^big: 1024x16 is over 512, the most goldsrc draws/.test(w)), "over 512");
  sure(!maps.checkWad(big, "source").warnings.length, "within source's 4096");
  const upper = patched(wholeWad(), ({ bytes, entry }) => bytes.write("SMAKFLOOR", entry(0) + 16, "latin1"));
  sure(maps.checkWad(upper).warnings.some((w) => /^SMAKFLOOR: not in lower case/.test(w)) && !maps.checkWad(upper).errors.length, "upper case");
  const green = patched(wholeWad(), ({ bytes, miptex }) => bytes.writeUInt8(255, miptex(1) + 24 + 4 * 4 + 32 * 32 + 16 * 16 + 8 * 8 + 4 * 4 + 2 + 255 * 3 + 1));
  sure(maps.checkWad(green).warnings.some((w) => /^\{smakfence: masked, its key colour .* not blue/.test(w)), maps.checkWad(green).warnings.join(" | "));
  const solid = maps.writeWad([{ ...flat("{plain"), pixels: new Uint8Array(32 * 32).fill(1) }]);
  sure(maps.checkWad(solid).warnings.some((w) => /^\{plain: masked, but no pixel is the key colour/.test(w)), "no hole");
});

test("smak check on a .wad: ends in PASS for a whole one, FAIL with the error for a broken one", () => {
  const good = `${tmp}/whole.wad`;
  writeFileSync(good, wholeWad());
  sure(/PASS: texture file fit for goldsrc\s*$/.test(runSmak("check", good)), "pass");
  const bad = `${tmp}/bad.wad`;
  writeFileSync(bad, patched(wholeWad(), ({ bytes, miptex }) => bytes.writeUInt32LE(30, miptex(0) + 16)));
  const run = spawnSync(process.execPath, [`${HERE}/../bin/smak.mjs`, "check", bad], { encoding: "utf8" });
  const said = { status: run.status, out: run.stdout };
  sure(said.status === 1 && /ERROR smakfloor: 30x32, both sides must be multiples of 16/.test(said.out) && /FAIL: 1 errors in the texture file/.test(said.out), said.out);
});
