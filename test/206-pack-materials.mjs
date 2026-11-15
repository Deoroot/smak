// The materials pack (packs/materials): ambientCG's and Poly Haven's materials searched and one made a GoldSrc
// texture with its set, with no network and nothing downloaded. The two lists kept and searched together; the sets
// downloaded through a stand-in for the network (ambientCG's zip unpacked, Poly Haven's files one by one, DirectX's
// normal taken only when alone, nothing the second time); a material made from a small set written here (its size,
// it tiles, 256 colours, the set's files and json, the normal turned when it came as DirectX's, a part mended);
// the folder made a .wad that checkWad passes colour for colour; marks laid on colour and normal together; refusals.
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import { materialList, searchMaterials, materialLine, downloadSet, unzip } from "../packs/materials/libraries.mjs";
import { makeMaterial, writeMaterial, wadOfFolder, seamOf, resample, readPicture, wallSheet, SEAM_BOUND } from "../packs/materials/material.mjs"; // prettier-ignore
import { parseMarks, layMarks } from "../packs/materials/marks.mjs";
import { API as PH_API } from "../packs/assets/polyhaven.mjs";
import { fakeNetwork } from "./fixture-assets.mjs";
import { writeSet, zipOf, picture, COLOURS, ACG_PAGE, PH_LIST, ACG_LIST_URL, PH_LIST_URL } from "./fixture-materials.mjs";
import { test, testAsync, sure, near, tmp, HERE, runRefused } from "./helper.mjs";

const BIN = join(HERE, "../packs/materials/bin.mjs");
const lists = { [ACG_LIST_URL]: ACG_PAGE, [PH_LIST_URL]: PH_LIST };

await testAsync("both lists asked once and kept a week; a search over both, each line with how it was made, its real size and maps", "lists and search", async () => {
  const cache = join(tmp, "materials-cache");
  const net = fakeNetwork(lists);
  const acg = await materialList("ambientcg", { cache, ask: net.ask });
  const ph = await materialList("polyhaven", { cache, ask: net.ask });
  await materialList("ambientcg", { cache, ask: net.ask });
  sure(net.asked.length === 2 && existsSync(join(cache, "ambientcg.json")), net.asked.join(" "));
  sure(acg.list.MetalPlates099.metres.join() === "1.6,1.6" && acg.list.Metal999.metres === null, "ambientCG's centimetres");
  near(ph.list.rusty_plate_09.metres[0], 2, 1e-9, "Poly Haven's millimetres");
  const found = searchMaterials({ ambientcg: acg.list, polyhaven: ph.list }, ["metal"]);
  sure(found.map((f) => `${f.source}:${f.id}`).sort().join() === "ambientcg:Metal999,ambientcg:MetalPlates099,polyhaven:rusty_plate_09", found.map((f) => f.id).join()); // prettier-ignore
  const line = materialLine(found.find((f) => f.id === "MetalPlates099"));
  sure(/made by surface-photogrammetry/.test(line) && /a tile 1\.60 x 1\.60 m \(63 x 63 units\)/.test(line) && /maps: color, normal, roughness/.test(line), line); // prettier-ignore
  sure(/size not given/.test(materialLine(found.find((f) => f.id === "Metal999"))), "no size is said");
});

await testAsync("the sets downloaded: ambientCG's zip unpacked to its maps, OpenGL's normal chosen; Poly Haven's files, DirectX's normal when alone; nothing the second time", "download", async () => {
  const cache = join(tmp, "materials-cache-dl");
  const p = (at) => picture(16, () => at);
  const zip = zipOf({ "MetalPlates099_1K-JPG_Color.png": p([200, 0, 0]), "MetalPlates099_1K-JPG_NormalGL.png": p([128, 200, 255]), "MetalPlates099_1K-JPG_NormalDX.png": p([128, 56, 255]), "MetalPlates099_1K-JPG.blend": Buffer.from("x"), "../evil_Color.png": p([0, 0, 0]) }); // prettier-ignore
  const at = (name) => ({ "1k": { png: { url: `https://dl.example/${name}` } } });
  const net = fakeNetwork({ ...lists, "https://ambientcg.com/get?file=MetalPlates099_1K-JPG.zip": zip, [`${PH_API}/files/rusty_plate_09`]: { Diffuse: at("d.png"), nor_dx: at("n.png"), Rough: at("r.png") }, [`${PH_API}/info/rusty_plate_09`]: { authors: { "A. Scanner": "All" } }, "https://dl.example/d.png": p([0, 200, 0]), "https://dl.example/n.png": p([128, 56, 255]), "https://dl.example/r.png": p([90, 90, 90]) }); // prettier-ignore
  const a = await downloadSet("ambientcg", "MetalPlates099", { cache, ask: net.ask });
  sure(a.normalFrom === "opengl" && /NormalGL/.test(a.files.normal) && Object.keys(a.files).sort().join() === "color,normal", JSON.stringify(a.files)); // prettier-ignore
  sure(readPicture(readFileSync(a.files.color)).data[0] === 200 && a.made === "surface-photogrammetry", "the colour unpacked");
  const b = await downloadSet("polyhaven", "rusty_plate_09", { cache, ask: net.ask });
  sure(b.normalFrom === "directx" && b.authors["A. Scanner"] === "All" && b.files.roughness, JSON.stringify(b));
  const before = net.asked.length;
  const again = await downloadSet("ambientcg", "MetalPlates099", { cache, ask: net.ask });
  sure(net.asked.length === before && again.fetched.length === 0, "nothing asked again");
  const refused = (source, id) => downloadSet(source, id, { cache, ask: net.ask }).then(() => "", (e) => e.message);
  sure(/has no material Nothing99: search/.test(await refused("ambientcg", "Nothing99")), "an id not there");
  sure(/not a material's id/.test(await refused("ambientcg", "../x")), "a path refused");
  sure(/no 1K-JPG zip/.test(await refused("ambientcg", "Metal999")), "no zip");
  sure(Object.keys(unzip(zip, (n) => n.endsWith(".blend"))).join() === "MetalPlates099_1K-JPG.blend", "unzip by name");
});

const set = writeSet(join(tmp, "materials-set"));
const made = makeMaterial(set, { name: "mt_plate", size: [32, 32] });
test("a material: its size, it tiles (seam under the bound), 256 colours or fewer, its brightness, the scale its real size asks, no warning", () => {
  sure(made.texture.width === 32 && made.texture.pixels.length === 32 * 32 && made.texture.palette.length === 768, "32 x 32, a palette");
  sure(made.report.seam.after < SEAM_BOUND && !made.report.seam.mended && !made.errors.length && !made.warnings.length, [...made.errors, ...made.warnings].join(" | ")); // prettier-ignore
  sure(made.texture.error.mean < 3 && made.report.brightness > 80 && made.report.brightness < 160, JSON.stringify(made.texture.error));
  near(made.report.scale, 39.37 / 32, 0.01, "a metre a tile over 32 texels");
  near(seamOf(resample(readPicture(readFileSync(set.files.color)), 32, 32)).worst, 1, 0.3, "the wave tiles");
});

test("the files: <name>.png, the set (colour, normal, roughness, material.json), the credit; a normal that came as DirectX's turned to OpenGL's", () => {
  const out = join(tmp, "materials-out");
  writeMaterial(made, out, set, { date: "2026-11-14" });
  for (const f of ["mt_plate.png", "mt_plate.credit.txt", "mt_plate.set/color.png", "mt_plate.set/normal.png", "mt_plate.set/roughness.png", "mt_plate.set/material.json"]) sure(existsSync(join(out, f)), f); // prettier-ignore
  const json = JSON.parse(readFileSync(join(out, "mt_plate.set/material.json"), "utf8"));
  sure(json.licence.startsWith("CC0") && json.normal.written.startsWith("opengl") && json.texture.width === 32 && json.maps.join() === "color,normal,roughness", JSON.stringify(json)); // prettier-ignore
  sure(/Created using Test Set 001 from ambientCG\.com/.test(readFileSync(join(out, "mt_plate.credit.txt"), "utf8")), "the credit");
  const dx = makeMaterial(writeSet(join(tmp, "materials-dx"), { convention: "directx" }), { name: "mt_dx", size: [32, 32] });
  near(dx.layers.normal.data[1], 180, 1, "DirectX's 75 turned to OpenGL's 180");
  near(made.layers.normal.data[1], 180, 1, "OpenGL's kept");
});

test("a part of a picture never tiles: it is mended, said, and the seam after is under the bound; a ramp that does not tile at all is mended too", () => {
  const part = makeMaterial(set, { name: "mt_part", size: [32, 32], part: [0.1, 0.1, 0.6, 0.6] });
  sure(part.report.seam.mended && part.report.seam.after < SEAM_BOUND && part.warnings.some((w) => /a part never does/.test(w)), part.warnings.join(" | ")); // prettier-ignore
  const ramp = makeMaterial(writeSet(join(tmp, "materials-ramp"), { colour: "ramp" }), { name: "mt_ramp", size: [32, 32] });
  sure(ramp.report.seam.before > SEAM_BOUND && ramp.report.seam.after < SEAM_BOUND && ramp.warnings.some((w) => /does not tile/.test(w)), JSON.stringify(ramp.report.seam)); // prettier-ignore
});

test("the folder made one .wad through writeWad: checkWad passes it, each texture colour for colour; a { texture has holes from the opacity map", () => {
  const out = join(tmp, "materials-wad");
  writeMaterial(made, out, set);
  const masked = makeMaterial(writeSet(join(tmp, "materials-mask"), { opacity: true }), { name: "{mt_grate", size: [32, 32] });
  writeMaterial(masked, out, set);
  const wad = wadOfFolder(out);
  sure(!wad.check.errors.length && wad.textures.map((t) => t.name).join() === "mt_plate,{mt_grate", JSON.stringify(wad.check));
  const back = smak.maps.textureFromWad(wad.bytes, "mt_plate");
  const rgba = smak.maps.textureRgba(back).rgba;
  const want = smak.maps.textureRgba({ ...made.texture, holes: false }).rgba;
  sure(rgba.every((v, i) => v === want[i]), "the same colours, texel for texel");
  sure(smak.maps.textureFromWad(wad.bytes, "{mt_grate").pixels.includes(255), "holes");
  sure(/no <texture>\.png/.test((() => { try { mkdirSync(join(tmp, "materials-empty"), { recursive: true }); wadOfFolder(join(tmp, "materials-empty")); return ""; } catch (e) { return e.message; } })()), "an empty folder refused"); // prettier-ignore
});

test("marks: a seam darkens the colour and sinks the normal at the same texel of the texture and of the 1K set; a rivet raises it; the spec refused in words", () => {
  const marked = makeMaterial(set, { name: "mt_seam", size: [32, 32], marks: "seams:x=16,y=0;rivets:every=16,step=8,inset=4,r=1.5,rows=x" }); // prettier-ignore
  const c = (m, x, y) => m.texture.palette[m.texture.pixels[y * 32 + x] * 3];
  sure(c(marked, 16, 9) < c(made, 16, 9) * 0.6, `the groove at x 16: ${c(marked, 16, 9)} against ${c(made, 16, 9)}`);
  // the set is 64 a side: texel 16 is pixels 32 and 33; the groove's left wall tilts the normal to -x before it, +x after
  const n = (x, y) => marked.layers.normal.data[(y * 64 + x) * 3];
  sure(n(31, 18) > 140 && n(34, 18) < 116 && Math.abs(n(10, 18) - 128) < 2, `normal x: ${n(31, 18)} ${n(34, 18)} ${n(10, 18)}`);
  // a rivet's dome at (4, 4) of the texture, (8, 8) of the set: its upper side tilts up (+green in OpenGL), its lower down
  const g = (x, y) => marked.layers.normal.data[(y * 64 + x) * 3 + 1];
  sure(g(8, 6) > 200 && g(8, 10) < 160, `the rivet's top ${g(8, 6)}, bottom ${g(8, 10)}`);
  const rough = { width: 64, height: 64, data: new Float32Array(64 * 64).fill(128) };
  layMarks({ roughness: rough }, parseMarks("seams:x=16,y=0"), { width: 32, height: 32 });
  sure(rough.data[32] > 140 && rough.data[10] === 128, "the groove is rougher");
  for (const [spec, said] of [["paint:x=1", /paint is not a mark/], ["seams:depth=2", /seams has no depth/], ["streaks:colour=1/2", /colour is 1\/2/], ["rivets:rows=z", /rows is z, not x, y or both/]]) // prettier-ignore
    sure(said.test((() => { try { parseMarks(spec); return ""; } catch (e) { return e.message; } })()), spec);
});

test("the sheet: the source, the tile 3 x 3, on a wall beside a player, and the texture of now beside it", () => {
  const sheet = wallSheet({ source: readPicture(readFileSync(set.files.color)), texture: made.texture, scale: 1, against: { ...smak.maps.textureRgba({ ...made.texture, holes: false }), name: "old", scale: 1 }, side: 64, name: "mt_plate" }); // prettier-ignore
  sure(sheet.width === 128 && sheet.height === 128, `${sheet.width}x${sheet.height}`);
  sure([...sheet.rgba].some((v, i) => i % 4 === 0 && v === 255 && sheet.rgba[i + 1] === 200), "the player's outline is drawn");
});

test("the command's refusals come before any network: a sentence and the usage", () => {
  const out = join(tmp, "materials-cli");
  const cases = [
    [[], /usage: node packs\/materials\/bin\.mjs search/],
    [["search"], /search: what is looked for\?/],
    [["search", "metal", "--source", "textures.com"], /--source ambientcg or polyhaven, not textures\.com/],
    [["material", "Metal038"], /--name <texture>/],
    [["material", "Metal038", "--name", "x"], /-o <folder>/],
    [["material", "Metal038", "--name", "x", "-o", out, "--size", "100"], /--size 256, 512 or WxH/],
    [["material", "Metal038", "--name", "x", "-o", out, "--size", "256", "--tone", "300,0,0"], /--tone: r,g,b of 0 to 255/],
    [["material", "Metal038", "--name", "x", "-o", out, "--size", "256", "--part", "0.5,0,0.2,1"], /--part: x1 over x0/],
    [["material", "Metal038", "--name", "x", "-o", out, "--size", "256", "--fit"], /material: what is --fit\?/],
    [["wad", out], /-o x\.wad/],
  ];
  for (const [args, said] of cases) {
    const run = runRefused(BIN, ...args);
    sure(run.code === 1 && said.test(run.err), `${args.join(" ")}: ${run.code} ${run.err}`);
  }
});
