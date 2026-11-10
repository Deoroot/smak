// A compiled map made back into brush source, and the measures of a recompile against its original.
//   decompile: the fixture's two rooms become a .map that reads, whose brushes are whole solids, wearing the
//   textures the faces wore, with its textures inside it written as a .wad of their own; the rules' switches
//   the numbers as Python's round() writes them (a tie to the even digit)
//   textureFidelity and lightParity: a map against itself is the same in every number
//   the texture-light table: a map's own values over the list's, as lights.rad and as info_texlights
//   `smak map-decompile`, and its refusals
//   where the compilers are: the decompile recompiled, and its faces wear the original's textures
//   where Half-Life is installed: frenzy decompiles to the very text goldsrc.net's bsp2map.py writes
//
// The compilers (VHLT or SDHLT) and Half-Life are outside the kit: the cases that need them are skipped
// without them. No game's map, nor anything decompiled from one, is kept in the kit (AGENTS.md rule 7): the
// frenzy case holds a hash of the text, not the text.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import * as maps from "../check/maps/index.mjs";
import { test, sure, HERE, tmp, runSmak, runRefused, SMAK_CLI } from "./helper.mjs";

const FIXTURES = join(HERE, "fixtures");
const folder = join(tmp, "decompile");
mkdirSync(folder, { recursive: true });
const original = readFileSync(join(FIXTURES, "tworooms.bsp"));
const done = maps.decompile(original, { name: "tworooms" });

test("decompile: the two rooms come back as a .map that reads, of whole brushes, in their textures", () => {
  const { map, facts, warnings, wad } = done;
  sure(map.startsWith("// decompiled by smak") && !warnings.length, warnings.join("; "));
  const source = maps.readMap(map);
  // the world, the grate (a func_wall, model *1) and the three point entities, in the file's order
  sure(source.entities.length === 4 && source.entities.some((e) => e.classname === "func_wall" && e.brushes?.length), "the entities"); // prettier-ignore
  sure(
    !source.entities.some((e) => "model" in e || ("origin" in e && e.brushes)),
    "no *N model key, no origin on a brush entity",
  );
  sure(
    source.brushes.length >= 10 && facts.brushes === source.brushes.length + 1,
    `${facts.brushes} brushes`,
  );
  for (const brush of [...source.brushes, ...source.entities.flatMap((e) => e.brushes ?? [])]) {
    const shape = maps.shapeOf(brush);
    sure(!shape.faults.length && shape.volume > 0, `a brush is no whole solid: ${shape.faults.join("; ")}`);
  }
  // every texture the faces wore is worn again, and the faces no face covers are NULL
  const worn = new Set(
    map
      .split("\n")
      .filter((l) => l.startsWith("("))
      .map((l) => l.split(" ")[15]),
  );
  for (const name of ["smakwall", "smakfloor", "{smakgrate", "NULL"]) sure(worn.has(name), `${name} is worn`);
  sure(facts.textured + facts.null === facts.faces && facts.leaves > 0, JSON.stringify(facts));
  // its textures are inside it and it names no .wad: they become one of its own, named in worldspawn
  sure(
    wad?.name === "tworooms_dc.wad" && source.worldspawn.wad === "tworooms_dc.wad",
    `the .wad: ${wad?.name}`,
  );
  const read = maps.readWad(wad.bytes);
  sure(
    read.textures
      .map((t) => t.name)
      .sort()
      .join() === "smakfloor,smakwall,{smakgrate",
    "the .wad holds the three",
  );
  // the plan check has nothing against it
  const plan = maps.checkPlan(source, {});
  sure(!plan.errors.length, plan.errors.join("; "));
  // the switches: no merging gives as many brushes or more, no cuts makes none
  const unmerged = maps.decompile(original, { merge: false });
  sure(unmerged.facts.brushes >= facts.brushes && unmerged.facts.merged === 0, "merge: false");
  sure(maps.decompile(original, { cuts: false }).facts.cuts === 0, "cuts: false");
  // the same map twice gives the same text
  sure(maps.decompile(original, { name: "tworooms" }).map === map, "the decompile is the same each time");
});

test("decompile: a number is written as Python's round() writes it, five decimals, a tie to the even digit", () => {
  const cases = [
    [0.015625, "0.01562"], // a tie, exactly: to the even digit
    [0.046875, "0.04688"],
    [-0.000001, "0"],
    [-0, "0"],
    [128, "128"],
    [1.5, "1.5"],
    [-2.000004, "-2"],
    [0.1 + 0.2, "0.3"],
  ];
  for (const [x, text] of cases)
    sure(maps.roundText(x, 5) === text, `${x}: ${maps.roundText(x, 5)}, not ${text}`);
  sure(maps.roundText(0.25, 1) === "0.2" && maps.roundText(0.35, 1) === "0.3", "the plane keys' tenths");
});

test("textureFidelity and lightParity: a map against itself matches in every number", () => {
  const same = maps.textureFidelity(original, original);
  sure(
    same.faces > 0 && same.matched === 100 && same.same === 100 && same.texinfo === 100,
    JSON.stringify(same),
  );
  sure(
    same.covered === 0 && same.boxmove === 0 && same.lostModels === 0 && !same.lost.length,
    JSON.stringify(same),
  );
  sure(maps.fidelityLine(same).startsWith("100.0/100.0/100.0/0.0/0.0"), maps.fidelityLine(same));
  const light = maps.lightParity(maps.readBsp(original), original);
  sure(
    light.all.faces > 0 && light.all.ratio === 1 && light.all.retail === light.all.ours,
    JSON.stringify(light.all),
  );
  // against the same rooms compiled with their textures outside: the same faces, the same light
  const twin = readFileSync(join(FIXTURES, "tworooms-wants-wad.bsp"));
  const other = maps.textureFidelity(original, twin);
  sure(other.matched === 100 && other.same === 100, maps.fidelityLine(other));
});

test("the texture-light table: a map's own values win, written as lights.rad and as info_texlights", () => {
  sure(
    maps.TEXLIGHTS.length > 80 && maps.TEXLIGHTS.every((t) => t.rgb.length === 3 && t.value > 0),
    "the list",
  );
  const tech = (map) => maps.texlightsFor(map).find((t) => t.name === "TECH_LITE1").value;
  sure(tech() === 21400 && tech("c4a1e") === 32600 && tech("maps/C4A1E.bsp") === 32600, "c4a1e's own value");
  const rad = maps.texlightsRad("c4a1e").split("\n");
  sure(
    rad[0].startsWith("//") && rad.includes("TECH_LITE1\t255\t212\t131\t32600"),
    rad.slice(0, 3).join(" | "),
  );
  sure(rad.filter((l) => /^TECH_LITE1\t/.test(l)).length === 1, "once, the map's own");
  sure(
    !maps.NOT_EMITTERS.some((t) => maps.texlightsFor().some((l) => l.name === t.name)),
    "what does not shine is left out",
  );
  const entity = maps.textureLights([0, 0, 0], maps.texlightsEntity("c4a1e"));
  sure(
    maps.writeMap({ entities: [entity] }).includes('"TECH_LITE1" "255 212 131 32600"'),
    "as an info_texlights",
  );
  sure(
    maps.TEXLIGHT_RAD_ARGS.join(" ") === "-texreflectgamma 1.0 -texreflectscale 0.7",
    "the reflectivity it was calibrated under",
  );
});

test("smak map-decompile: the .map and its own .wad written; a .map or no -o refused", () => {
  const bsp = join(folder, "tworooms.bsp");
  writeFileSync(bsp, original);
  const out = join(folder, "out", "tworooms.map");
  const said = runSmak("map-decompile", bsp, "-o", out);
  sure(/15 brushes|\d+ brushes/.test(said) && /tworooms\.map: decompiled in/.test(said), said);
  sure(readFileSync(out, "utf8").split("\n").slice(1).join("\n") === done.map.split("\n").slice(1).join("\n"), "the same text as the library's"); // prettier-ignore
  sure(
    existsSync(join(folder, "out", "tworooms_dc.wad")) && /3 textures it carries inside it/.test(said),
    said,
  );
  const noOut = runRefused(SMAK_CLI, "map-decompile", bsp);
  sure(noOut.code === 1 && /-o out\.map/.test(noOut.err), noOut.err);
  const source = join(FIXTURES, "tworooms.map");
  const wrong = runRefused(SMAK_CLI, "map-decompile", source, "-o", join(folder, "x.map"));
  sure(wrong.code === 1 && /a compiled map \(\.bsp\) is what is decompiled/.test(wrong.err), wrong.err);
});

const compilers = process.env[maps.COMPILERS_VARIABLE] ? maps.findCompilers() : { found: false };
if (compilers.found)
  test("compiled: the decompiled rooms compile again, and their faces wear the original's textures", () => {
    const mapFile = join(folder, "again.map");
    writeFileSync(mapFile, done.map);
    const wad = join(folder, done.wad.name);
    writeFileSync(wad, done.wad.bytes);
    const result = maps.compileMap(mapFile, { wads: [wad], compilers, fast: true, timeout: 120_000 });
    sure(result.bsp && !result.errors.length, result.errors.join("; "));
    const fidelity = maps.textureFidelity(original, readFileSync(result.bsp));
    sure(fidelity.matched > 99 && fidelity.same > 99 && fidelity.texinfo > 99 && !fidelity.lostModels, maps.fidelityLine(fidelity)); // prettier-ignore
  });
else
  console.log(`skip  compiled: the decompiled rooms compile again\n      skipped: no compilers (name the folder of VHLT in ${maps.COMPILERS_VARIABLE} to run it)`); // prettier-ignore

// Half-Life's frenzy, decompiled by goldsrc.net's bsp2map.py (2026-10-14), less its first line (which names
// the program): this hash. The port wrote the same text for all 126 maps of the game's valve folder.
const FRENZY_SHA256 = "091b4c2f28d66a075f9ea1b71faa7aaed1c58424e73f8a304423bd84b6768765";
// Half-Life where Steam puts it, or where SMAK_HALF_LIFE names its folder
const VALVE =
  [process.env.SMAK_HALF_LIFE, join(homedir(), ".steam/steam/steamapps/common/Half-Life"), "C:/Program Files (x86)/Steam/steamapps/common/Half-Life"]
    .filter(Boolean)
    .map((folder) => join(folder, "valve"))
    .find((folder) => existsSync(folder)) ?? ""; // prettier-ignore
const frenzy = join(VALVE, "maps", "frenzy.bsp");
if (existsSync(frenzy))
  test("Half-Life's frenzy decompiles to the very text bsp2map.py writes", () => {
    const { map, facts } = maps.decompile(readFileSync(frenzy), { name: "frenzy", folders: [VALVE] });
    const hash = createHash("sha256")
      .update(map.slice(map.indexOf("\n") + 1))
      .digest("hex");
    sure(hash === FRENZY_SHA256, `frenzy: ${hash} (${facts.brushes} brushes)`);
    sure(map.split("\n").length === 4962 + 1 && facts.brushes === 546, `${facts.brushes} brushes`);
  });
else
  console.log(
    `skip  Half-Life's frenzy decompiles to the very text bsp2map.py writes\n      skipped: no ${frenzy}`,
  );
