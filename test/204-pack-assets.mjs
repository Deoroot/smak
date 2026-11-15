// The assets pack (packs/assets): Poly Haven's models searched and one made a GoldSrc prop, with no network and
// nothing downloaded. The search over a small list in the API's shape; the list kept and not asked again; an id
// that is not a model refused; the download asking only for the base colour (and its opacity map), and nothing
// the second time, through a stand-in for the network; a small glTF in metres, +y up, written here, made a prop
// at its true size and at a height (standing on z = 0 at the middle, upright, its picture carried the right way
// up, an opacity map made holes), the sheet beside the source, the credit; the command's refusals.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import {
  searchAssets,
  assetLine,
  assetList,
  assetInfo,
  downloadGltf,
  gltfWants,
  API,
} from "../packs/assets/polyhaven.mjs";
import { makeProp, propSheet, creditText, propBudget, partsOf, partsSheet } from "../packs/assets/prop.mjs";
import { writePropGltf, LIST, fakeNetwork } from "./fixture-assets.mjs";
import { test, testAsync, sure, near, tmp, HERE, runRefused } from "./helper.mjs";

const BIN = join(HERE, "../packs/assets/bin.mjs");
const UNITS = 39.37;

test("search: every word in the id, name, tags or categories, the name before a tag, a texture never; each line with its size and polycount", () => {
  const ids = (words) => searchAssets(LIST, words).map((found) => found.id);
  sure(
    ids(["extinguisher"]).join() === "korean_fire_extinguisher_01,fire_hydrant",
    ids(["extinguisher"]).join(),
  );
  sure(
    ids(["fire", "extinguisher"]).length === 2 && !ids(["red"]).includes("red_brick"),
    ids(["red"]).join(),
  );
  sure(
    ids(["urban"]).join() === "metal_trash_can" && !ids(["extinguisher", "bin"]).length,
    ids(["urban"]).join(),
  );
  const line = assetLine("korean_fire_extinguisher_01", LIST.korean_fire_extinguisher_01);
  sure(line.includes("0.28 x 0.37 x 0.66 m (11 x 14 x 26 units)") && line.includes("9913 triangles"), line);
  sure(
    /size not given.*polycount not given/.test(assetLine("metal_trash_can", LIST.metal_trash_can)),
    "what is not given is said",
  );
});

await testAsync(
  "the list is asked once and kept in the cache; an id that is not a model is refused in a sentence",
  "list and info",
  async () => {
    const cache = join(tmp, "assets-cache");
    const net = fakeNetwork({ [`${API}/assets?t=models`]: LIST, [`${API}/info/red_brick`]: LIST.red_brick });
    const first = await assetList({ cache, ask: net.ask });
    const second = await assetList({ cache, ask: net.ask });
    sure(
      net.asked.length === 1 && Object.keys(second.list).length === 4 && first.from.startsWith(API),
      net.asked.join(),
    );
    sure(existsSync(join(cache, "models.json")) && second.from === join(cache, "models.json"), second.from);
    const refused = async (id) =>
      assetInfo(id, { ask: net.ask }).then(
        () => "",
        (error) => error.message,
      );
    sure(
      /no asset nothing_here: search for one/.test(await refused("nothing_here")),
      await refused("nothing_here"),
    );
    sure(/is Poly Haven's texture, not a model/.test(await refused("red_brick")), await refused("red_brick"));
    const before = net.asked.length;
    sure(
      /not an asset's id/.test(await refused("../etc")) && net.asked.length === before,
      "a path is refused before asking",
    );
  },
);

await testAsync(
  "the download: the .gltf, its .bin, the base colour and its opacity map, not the normal map; nothing the second time",
  "download",
  async () => {
    const made = join(tmp, "assets-source");
    const file = writePropGltf(made, { opacity: true });
    const at = (name) => `https://dl.example/${name}`;
    const net = fakeNetwork({
      [`${API}/files/test_prop`]: {
        gltf: { "1k": { gltf: { url: at("test_prop_1k.gltf"), size: readFileSync(file).length, include: {
        "test_prop.bin": { url: at("test_prop.bin") },
        "textures/test_prop_diff_1k.png": { url: at("test_prop_diff_1k.png") },
        "textures/test_prop_nor_gl_1k.png": { url: at("test_prop_nor_gl_1k.png") },
      } } } }, // prettier-ignore
        Diffuse: { "1k": { png: { url: at("test_prop_diff_1k.png") } } },
        opacity: { "1k": { png: { url: at("test_prop_opacity_1k.png") } } },
      },
      [at("test_prop_1k.gltf")]: readFileSync(file),
      [at("test_prop.bin")]: readFileSync(join(made, "test_prop.bin")),
      [at("test_prop_diff_1k.png")]: readFileSync(join(made, "textures/test_prop_diff_1k.png")),
      [at("test_prop_opacity_1k.png")]: readFileSync(join(made, "textures/test_prop_opacity_1k.png")),
    });
    const cache = join(tmp, "assets-cache");
    const got = await downloadGltf("test_prop", { cache, ask: net.ask });
    sure(got.fetched.length === 4 && !net.asked.some((url) => /nor_gl/.test(url)), net.asked.join(" "));
    sure(got.skipped.join() === "textures/test_prop_nor_gl_1k.png", got.skipped.join());
    sure(
      existsSync(join(cache, "test_prop/1k/textures/test_prop_opacity_1k.png")),
      "the opacity map is beside the colour",
    );
    const again = await downloadGltf("test_prop", { cache, ask: net.ask });
    sure(again.fetched.length === 0 && again.kept.length === 4, `${again.fetched.length} asked again`);
    sure(
      gltfWants(JSON.parse(readFileSync(file, "utf8"))).colours.join() === "textures/test_prop_diff_1k.png",
      "the base colour found by the material",
    );
  },
);

const upright = writePropGltf(join(tmp, "assets-upright"));
const lying = writePropGltf(join(tmp, "assets-lying"), { lying: true });
const prop = makeProp(upright, { name: "test_prop.mdl", scale: 1, real: [0.4, 0.4, 1] });
const pointsOf = (mdl) => smak.posed(mdl, {}).tris.flatMap((t) => t.c.map((c) => c.p));
const boxOf = (points) => [0, 1, 2].map((a) => [Math.min(...points.map((p) => p[a])), Math.max(...points.map((p) => p[a]))]); // prettier-ignore

test("a glTF in metres, +y up, at its true size: 39.37 units a metre, on z = 0 at the middle, upright, no error; check's form warning carried", () => {
  // a frustum of 12 triangles is all bare edges: check's form warning is the only thing said
  sure(
    !prop.errors.length && prop.warnings.length === 1 && /^form: .*bare 80-degree/.test(prop.warnings[0]),
    [...prop.errors, ...prop.warnings].join(" | "),
  );
  const [x, y, z] = boxOf(pointsOf(prop.mdl));
  near(z[0], 0, 0.01, "its foot on z = 0");
  near(z[1], UNITS, 0.05, "a metre high");
  near(x[0] + x[1], 0, 0.01, "its middle on x = 0");
  near(y[0] + y[1], 0, 0.01, "its middle on y = 0");
  near(x[1] - x[0], 0.4 * UNITS, 0.05, "0.4 m across");
  // upright: its foot is the wide end
  const across = (from, to) => { const xs = pointsOf(prop.mdl).filter((p) => p[2] >= from && p[2] <= to).map((p) => p[0]); return Math.max(...xs) - Math.min(...xs); }; // prettier-ignore
  sure(
    across(0, 1) > 1.8 * across(UNITS - 1, UNITS),
    `foot ${across(0, 1)}, top ${across(UNITS - 1, UNITS)}`,
  );
  sure(prop.report.triangles === 12 && prop.report.sourceTriangles === 12 && prop.report.textures.join() === "64x64", JSON.stringify(prop.report.textures)); // prettier-ignore
});

test("the picture is carried the right way up: the top blue, the sides red, as the source's", () => {
  /** The share of the dots drawn (not the background) that are red, or blue. */
  const share = (picture, colour) => {
    let hits = 0;
    let drawn = 0;
    for (let i = 0; i < picture.rgba.length; i += 4) {
      const [r, g, b] = picture.rgba.subarray(i, i + 3);
      if (Math.abs(r - 58) + Math.abs(g - 62) + Math.abs(b - 70) < 6) continue;
      drawn++;
      if (colour === "red" ? r > b + 40 : b > r + 40) hits++;
    }
    return hits / drawn;
  };
  const [red, blue] = ["red", "blue"];
  sure(share(smak.render(prop.mdl, { view: "top", light: false }), blue) > 0.15, "the top is blue");
  sure(share(smak.render(prop.mdl, { view: "front", light: false }), red) > 0.9, "the sides are red");
  sure(
    share(smak.render(prop.mdl, { view: "front", light: false, tris: prop.source }), red) > 0.9,
    "the source drawn the same",
  );
});

test("a height in units: the prop made that high; Half-Life's figures behind the budget", () => {
  const made = makeProp(upright, { name: "short.mdl", height: 20 });
  const [, , z] = boxOf(pointsOf(made.mdl));
  near(z[1] - z[0], 20, 0.01, "20 units high");
  sure(
    propBudget(26) === 1040 && propBudget(5) === 1000 && propBudget(300) === 2000,
    `${propBudget(26)} ${propBudget(5)} ${propBudget(300)}`,
  );
});

test("an opacity map beside the colour makes a texture with holes, and the see-through material is said", () => {
  const made = makeProp(writePropGltf(join(tmp, "assets-holes"), { opacity: true }), {
    name: "holes.mdl",
    scale: 1,
  });
  sure(
    smak.readMdl(made.mdl).textures.some((texture) => texture.flags & 64),
    "a masked texture",
  );
  sure(
    made.warnings.filter((w) => !/^form:/.test(w)).length === 1 &&
      made.warnings.some((w) => /holes where its opacity map is under half/.test(w)),
    made.warnings.join(" | "),
  );
  sure(
    made.lines.some((line) => /opacity map test_prop_opacity_1k\.png as alpha/.test(line)),
    made.lines.join(" | "),
  );
});

test("a file that lies on its side is a FAIL, by the height Poly Haven gives", () => {
  const made = makeProp(lying, { name: "lying.mdl", scale: 1, real: [0.4, 0.4, 1] });
  sure(made.errors.length === 1 && /stands 0\.400 m high where Poly Haven says 1\.000 m: it may lie on its side/.test(made.errors[0]), made.errors.join(" | ")); // prettier-ignore
});

test("the sheet: each view the source and the prop from one camera, four tiles a row; the credit", () => {
  const sheet = propSheet(prop, { size: 96 });
  sure(sheet.width === 4 * 96 && sheet.height === 3 * 96, `${sheet.width}x${sheet.height}`);
  const credit = creditText("test_prop", { type: 2, name: "Test Prop", authors: { "A. Maker": "All" }, files_hash: "abc" }, { date: "2026-11-14" }); // prettier-ignore
  for (const said of ["Test Prop", "Poly Haven asset: test_prop", "URL: https://polyhaven.com/a/test_prop", "Authors: A. Maker (All)", "CC0", "Powered by Poly Haven", "files_hash abc"]) // prettier-ignore
    sure(credit.includes(said), `the credit says ${said}`);
});

test("the command's refusals come before any network: a sentence and the usage", () => {
  mkdirSync(join(tmp, "assets-out"), { recursive: true });
  const refused = (...args) => runRefused(BIN, ...args);
  const cases = [
    [[], /usage: node packs\/assets\/bin\.mjs search/],
    [["search"], /search: what is looked for\?/],
    [["search", "crate", "--limit", "0"], /--limit: a whole number from 1, not 0/],
    [["prop", "some_id"], /-o out\/<name>\.mdl is where the prop goes/],
    [["prop", "some_id", "-o", join(tmp, "assets-out/a.mdl")], /--height <units> or --scale <n>/],
    [
      ["prop", "some_id", "-o", join(tmp, "assets-out/a.mdl"), "--height", "20", "--scale", "1"],
      /one of them/,
    ],
    [
      ["prop", "some_id", "-o", join(tmp, "assets-out/a.mdl"), "--scale", "1", "--texture", "300"],
      /--texture: 256 or 512, not 300/,
    ],
    [
      ["prop", "some_id", "-o", join(tmp, "assets-out/a.mdl"), "--scale", "1", "--fit", "3"],
      /prop: what is --fit\?/,
    ],
    [["parts"], /parts: one asset's id/],
    [["parts", "a", "b"], /parts: one asset's id/],
    [["parts", "some_id", "--part", "1"], /parts: what is --part\?/],
  ];
  for (const [args, said] of cases) {
    const run = refused(...args);
    sure(run.code === 1 && said.test(run.err), `${args.join(" ")}: ${run.code} ${run.err}`);
  }
});

test("two objects side by side: parts lists both, --part takes one alone on its own foot, the credit says which, a part that is not there is refused", () => {
  const twins = writePropGltf(join(tmp, "assets-twins"), { twin: true });
  const parts = partsOf(smak.readModelFile(twins));
  sure(parts.length === 2 && parts[0].triangles === 12 && parts[1].names.join() === "test_prop_b", JSON.stringify(parts.map((p) => p.names)));
  near(parts[1].size[2], UNITS, 0.05, "a metre high");
  const sheet = partsSheet(twins, { size: 64 });
  sure(sheet.parts.length === 2 && sheet.width === 128, `${sheet.width}x${sheet.height}`);
  const all = makeProp(twins, { name: "all.mdl", scale: 1 });
  sure(all.warnings.some((w) => /^the file holds 2 objects side by side, all of them in the prop: .*`parts`/.test(w)), all.warnings.join(" | ")); // prettier-ignore
  for (const part of [2, "test_prop_b", "prop_b"]) {
    const second = makeProp(twins, { name: "second.mdl", scale: 1, part });
    const [x, y, z] = boxOf(pointsOf(second.mdl));
    near(x[0] + x[1], 0, 0.01, "its own middle on x = 0");
    near(y[0] + y[1], 0, 0.01, "its own middle on y = 0");
    near(z[0], 0, 0.01, "its foot on z = 0");
    sure(!second.errors.length && second.report.triangles === 12 && second.report.sourceTriangles === 12, `${second.report.triangles}`); // prettier-ignore
    sure(second.warnings.some((w) => /^the file holds 2 objects side by side: this prop is part 2 only \(test_prop_b\)$/.test(w)), second.warnings.join(" | ")); // prettier-ignore
    sure(creditText("t", { name: "T" }, { part: second.part }).includes("Part 2 of the 2 objects the file holds (test_prop_b)"), "the credit says the part"); // prettier-ignore
  }
  for (const part of [3, "nothing"])
    sure(
      (() => { try { makeProp(twins, { name: "x.mdl", scale: 1, part }); return ""; } catch (e) { return e.message; } })().startsWith(`there is no part "${part}": the file holds 2 (1: test_prop; 2: test_prop_b)`), // prettier-ignore
      `part ${part} refused`,
    );
});

test("--cache holds every file the pack writes that nobody named: search takes it, parts' sheet and prop's detail go under it (v1.2 faults M12, M13), the network stood in for", () => {
  const cache = join(tmp, "assets-cache2");
  const folder = join(cache, "test_prop", "1k");
  writePropGltf(folder);
  const at = (name) => ({ url: `https://dl.polyhaven.org/${name}`, size: readFileSync(join(folder, name)).length });
  const files = { gltf: { "1k": { gltf: { ...at("test_prop_1k.gltf"), include: { "test_prop.bin": at("test_prop.bin"), "textures/test_prop_diff_1k.png": at("textures/test_prop_diff_1k.png") } } } } }; // prettier-ignore
  writeFileSync(join(cache, "models.json"), JSON.stringify(LIST));
  // a fetch that answers /files and /info from memory, so no byte goes to the network (the files are already in the cache)
  const stub = join(tmp, "assets-fetch.mjs");
  writeFileSync(stub, `const answers = ${JSON.stringify({ "/files/test_prop": files, "/info/test_prop": { type: 2, name: "Test Prop", authors: { "A. Maker": "All" } } })};
globalThis.fetch = async (url) => { const body = answers[new URL(url).pathname]; return body ? new Response(JSON.stringify(body)) : new Response("", { status: 404 }); };\n`);
  const strayTemp = join(tmp, "assets-stray");
  mkdirSync(strayTemp, { recursive: true });
  const run = (...args) => spawnSync(process.execPath, ["--import", pathToFileURL(stub).href, BIN, ...args], { encoding: "utf8", env: { ...process.env, TEMP: strayTemp, TMP: strayTemp, TMPDIR: strayTemp } }); // prettier-ignore
  const searched = run("search", "extinguisher", "--cache", cache);
  sure(searched.status === 0 && searched.stdout.includes(join(cache, "models.json")), `search: ${searched.status} ${searched.stderr}`);
  const made = run("prop", "test_prop", "-o", join(tmp, "assets-out/cached.mdl"), "--scale", "1", "--cache", cache);
  sure(made.status === 0 && existsSync(join(cache, "assets-prop-cached.mdl.txt")), `prop: ${made.status} ${made.stderr} ${made.stdout}`);
  const listed = run("parts", "test_prop", "--cache", cache);
  sure(listed.status === 0 && existsSync(join(cache, "assets-parts-test_prop.png")), `parts: ${listed.status} ${listed.stderr}`);
  sure(!existsSync(join(strayTemp, "smak")), "nothing went to the system's temp folder");
});
