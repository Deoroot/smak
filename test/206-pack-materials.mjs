// The materials pack (packs/materials): ambientCG's and Poly Haven's materials searched and one made a GoldSrc
// texture with its set, with no network and nothing downloaded. The two lists kept and searched together; the sets
// downloaded through a stand-in for the network (ambientCG's zip unpacked, Poly Haven's files one by one, DirectX's
// normal taken only when alone, nothing the second time); a material made from a small set written here (its size,
// it tiles, 256 colours, the set's files and json, the normal turned when it came as DirectX's, a part mended);
// the folder made a .wad that checkWad passes colour for colour; marks laid on colour and normal together; the tone as
// the final mean, chroma, shift and mirror, the band, a ring of rivets, a caller's mark, holes from bars or a mask;
// search's sheet of candidates; refusals.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import { materialList, searchMaterials, materialLine, downloadSet, unzip } from "../packs/materials/libraries.mjs";
import { makeMaterial, writeMaterial, wadOfFolder, seamOf, resample, readPicture, wallSheet, linesOf, SEAM_BOUND, FINAL_TOLERANCE } from "../packs/materials/material.mjs"; // prettier-ignore
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
  const sheet = join(tmp, "materials-candidates.png");
  const run = runRefused(BIN, "search", "ambientcg:MetalPlates099", "--source", "ambientcg", "--sheet", sheet, "--cache", cache); // prettier-ignore
  const seen = run.code === 0 && smak.unpng(readFileSync(sheet));
  sure(seen && seen.width === 256 && [...seen.rgba.subarray((233 * 256 + 250) * 4, (233 * 256 + 250) * 4 + 3)].join() === "200,0,0" && /1 of \d+ materials named/.test(run.out), `the sheet: ${run.code} ${run.err}`); // prettier-ignore
  sure(/ambientcg:Nothing99: not in ambientcg/.test(runRefused(BIN, "search", "ambientcg:Nothing99", "--source", "ambientcg", "--cache", cache).err), "an id not there"); // prettier-ignore
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

test("puddles: a floor's wet in patches, darker, smooth and flat, over about `cover` of the tile, seamless; wet stays bands down it", () => {
  const W = 128;
  const layers = () => ({ color: { width: W, height: W, data: new Float32Array(W * W * 3).fill(120) }, normal: { width: W, height: W, data: Float32Array.from({ length: W * W * 3 }, (_, i) => [100, 160, 230][i % 3]) }, roughness: { width: W, height: W, data: new Float32Array(W * W).fill(200) } }); // prettier-ignore
  const stripes = (r) => { const m = r.data.reduce((a, v) => a + v, 0) / r.data.length; const all = r.data.reduce((a, v) => a + (v - m) ** 2, 0) / r.data.length; const cols = Array.from({ length: W }, (_, x) => { let s = 0; for (let y = 0; y < W; y++) s += r.data[y * W + x]; return s / W; }); return cols.reduce((a, v) => a + (v - m) ** 2, 0) / W / (all || 1); }; // prettier-ignore
  const p = layMarks(layers(), parseMarks("puddles:cover=0.3"), { width: 64, height: 64 });
  const wet = [...p.roughness.data.keys()].filter((i) => p.roughness.data[i] < 150);
  sure(wet.length > 0.2 * W * W && wet.length < 0.45 * W * W, `wet share ${wet.length / (W * W)}`);
  const i = wet.find((k) => p.roughness.data[k] < 20);
  sure(i !== undefined && p.color.data[i * 3] < 100 && p.normal.data[i * 3] > 120 && p.normal.data[i * 3 + 2] > 240, `the heart of a puddle: rough ${p.roughness.data[i]}, colour ${p.color.data[i * 3]}, normal ${p.normal.data.slice(i * 3, i * 3 + 3)}`); // prettier-ignore
  sure(stripes(p.roughness) < 0.3, `puddles are not bands: ${stripes(p.roughness)}`);
  let [inside, wrap] = [0, 0];
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const d = Math.abs(p.roughness.data[y * W + x] - p.roughness.data[y * W + ((x + 1) % W)]); if (x === W - 1) wrap = Math.max(wrap, d); else inside = Math.max(inside, d); } // prettier-ignore
  sure(wrap <= inside, `the wrap steps ${wrap}, inside at most ${inside}`);
  sure(stripes(layMarks(layers(), parseMarks("wet"), { width: 64, height: 64 }).roughness) > 0.9, "wet is bands down");
});

test("linesOf: joints crossing the whole tile counted each way (a grid of 3 x 3 slabs, 5 planks down), none in a grain without them", () => {
  const grain = (x, y) => 140 + 40 * ((Math.imul(x * 73856093 ^ y * 19349663, 83492791) >>> 0) / 4294967296 - 0.5);
  const of = (joint) => ({ width: 240, height: 240, data: Float32Array.from({ length: 240 * 240 * 3 }, (_, i) => { const [x, y] = [Math.floor(i / 3) % 240, Math.floor(i / 720)]; return joint(x, y) ? 50 : grain(x, y); }) }); // prettier-ignore
  sure(linesOf(of((x, y) => x % 80 < 2 || y % 80 < 2)).join() === "3,3", "slabs");
  sure(linesOf(of((x, y) => y % 48 < 2)).join() === "0,5", "planks");
  sure(linesOf(of(() => false)).join() === "0,0", "grain");
  const line = makeMaterial(set, { name: "mt_lines", size: [32, 32] }).lines.find((l) => /lines cross|no lines/.test(l));
  sure(line, "said in the answer");
});

const texel = (m, x, y, layer = m.picture) => [0, 1, 2].map((c) => layer.data[(y * layer.width + x) * 3 + c]);
test("the tone as the final mean: asked 60/76/75 under grime and streaks, the texture's mean is that within the tolerance (before the marks it is darker); chroma brings the colour in round its grey", () => {
  const marks = "grime:amount=0.5,cell=8,low=0.5;streaks:count=4,amount=0.4";
  const was = makeMaterial(set, { name: "mt_was", size: [32, 32], tone: [60, 76, 75], marks });
  const now = makeMaterial(set, { name: "mt_now", size: [32, 32], tone: [60, 76, 75], marks, final: true });
  sure(was.report.mean[1] < 72 && now.report.mean.every((v, c) => Math.abs(v - [60, 76, 75][c]) <= FINAL_TOLERANCE) && !now.warnings.length, `${was.report.mean} ${now.report.mean} ${now.warnings}`); // prettier-ignore
  sure(now.json.final === true && was.json.final === undefined && now.lines.some((l) => /asked as the final mean/.test(l)), "said");
  const spread = (m) => { let s = 0; for (let i = 0; i < 32 * 32; i++) { const [r, g, b] = texel(m, i % 32, i >> 5); s += Math.abs(r - (0.299 * r + 0.587 * g + 0.114 * b)); } return s; }; // prettier-ignore
  near(spread(makeMaterial(set, { name: "mt_half", size: [32, 32], chroma: 0.5 })) / spread(made), 0.5, 0.01, "chroma 0.5 halves the colour");
  sure(spread(makeMaterial(set, { name: "mt_grey", size: [32, 32], chroma: 0 })) < 1, "chroma 0 is grey");
});

test("shift and mirror: the material and its marks rolled together, its set by as many of its own pixels; mirrored, the normal's red turned", () => {
  const plain = makeMaterial(set, { name: "mt_p", size: [32, 32], marks: "seams:x=16,y=0" });
  const moved = makeMaterial(set, { name: "mt_m", size: [32, 32], marks: "seams:x=16,y=0", shift: [5, 3] });
  const mirror = makeMaterial(set, { name: "mt_r", size: [32, 32], marks: "seams:x=16,y=0", shift: [5, 3], mirror: true });
  for (const [x, y] of [[0, 0], [7, 30], [21, 9]]) {
    sure(texel(moved, x, y).join() === texel(plain, (x + 27) % 32, (y + 29) % 32).join() && texel(mirror, x, y).join() === texel(moved, 31 - x, y).join(), `${x} ${y}`); // prettier-ignore
    const [X, Y] = [x * 2, y * 2];
    sure(texel(moved, X, Y, moved.layers.color).join() === texel(plain, (X + 54) % 64, (Y + 58) % 64, plain.layers.color).join(), `the set at ${X} ${Y}`); // prettier-ignore
    near(texel(mirror, X, Y, mirror.layers.normal)[0], 255 - texel(moved, 63 - X, Y, moved.layers.normal)[0], 1e-3, "red turned");
  }
});

test("the face's marks: a band at the foot (dark, its groove sunk in the normal, its lip lit), a ring of rivets, a caller's function; laid after the shift", () => {
  const band = makeMaterial(set, { name: "mt_band", size: [32, 32], marks: "band:height=8", shift: [0, 9] });
  const base = makeMaterial(set, { name: "mt_base", size: [32, 32], shift: [0, 9] });
  const k = (y) => texel(band, 10, y)[0] / texel(base, 10, y)[0];
  sure([[30, 0.62], [25, 0.32], [23, 1.18], [10, 1]].every(([y, want]) => Math.abs(k(y) - want) < 1e-3), [30, 25, 23, 10].map(k).join()); // prettier-ignore
  const g = (y) => band.layers.normal.data[(y * 64 + 10) * 3 + 1];
  sure(Math.abs(g(47) - 180) > 5 && Math.abs(g(20) - 180) < 1, `the groove's normal ${g(47)}, elsewhere ${g(20)}`);
  const ring = makeMaterial(set, { name: "mt_ring", size: [32, 32], marks: "ring:x=16,y=16,radius=8,step=4,r=1.5" });
  sure(texel(ring, 23, 15)[0] > texel(made, 23, 15)[0] * 1.15 && texel(ring, 16, 16)[0] === texel(made, 16, 16)[0], "a rivet on the ring, none at its centre"); // prettier-ignore
  const drawn = makeMaterial(set, { name: "mt_fn", size: [32, 32], marks: ["seams:x=16,y=0", (u) => (u < 4 ? { mul: 0 } : {})] });
  sure(texel(drawn, 2, 5).join() === "0,0,0" && texel(drawn, 6, 5)[0] > 50, "the caller's mark");
});

test("holes of a { texture from bars (no opacity in the set) or from a mask the caller gives; the set gets them as its opacity; the mean leaves them out", () => {
  const bars = makeMaterial(set, { name: "{mt_bars", size: [32, 32], marks: "bars:pitch=8,bar=3,cross=16,rod=2" });
  const at = (m, x, y) => m.texture.pixels[y * 32 + x];
  sure(at(bars, 5, 5) === 255 && at(bars, 1, 5) !== 255 && at(bars, 5, 0) !== 255, "a hole between, a bar, a rod");
  sure(bars.layers.opacity.data[10 * 64 + 10] === 0 && bars.layers.opacity.data[10 * 64 + 2] === 255 && bars.json.holes === "bars", "the set's opacity"); // prettier-ignore
  const out = join(tmp, "materials-bars");
  writeMaterial(bars, out, set);
  sure(existsSync(join(out, "{mt_bars.set/opacity.png")), "opacity.png written");
  let [sum, n] = [0, 0];
  for (let i = 0; i < 32 * 32; i++) if (bars.texture.pixels[i] !== 255) [sum, n] = [sum + bars.texture.palette[bars.texture.pixels[i] * 3], n + 1];
  near(bars.report.mean[0], sum / n, 0.06, "the mean of the bars alone");
  sure(texel(bars, 0, 5)[0] / texel(made, 0, 5)[0] > 1.2, "the bar lit on its side");
  const mask = makeMaterial(set, { name: "{mt_mask", size: [32, 32], holes: (x) => x < 16 });
  sure(at(mask, 3, 3) === 255 && at(mask, 20, 3) !== 255 && mask.json.holes === "given", "the mask");
  sure(/no opacity map: give its holes/.test((() => { try { makeMaterial(set, { name: "{mt_none", size: [32, 32] }); return ""; } catch (e) { return e.message; } })()), "refused"); // prettier-ignore
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
    [["material", "Metal038", "--name", "x", "-o", out, "--size", "256", "--final"], /--final: the tone is what is final/],
    [["material", "Metal038", "--name", "x", "-o", out, "--size", "256", "--shift", "1.5,0"], /--shift: dx,dy, whole texels/],
    [["material", "Metal038", "--name", "x", "-o", out, "--size", "256", "--chroma", "3"], /--chroma: the share of its colour/],
    [["material", "Metal038", "--name", "x", "-o", out, "--size", "256", "--holes", "m.png"], /--holes: a texture with holes is named \{name/],
    [["wad", out], /-o x\.wad/],
  ];
  for (const [args, said] of cases) {
    const run = runRefused(BIN, ...args);
    sure(run.code === 1 && said.test(run.err), `${args.join(" ")}: ${run.code} ${run.err}`);
  }
});

await testAsync("search --sheet with nothing found says so, writes no sheet and ends cleanly (it crashed on an empty sheet)", "empty sheet", async () => {
  const cache = join(tmp, "materials-cache-empty");
  const net = fakeNetwork(lists);
  await materialList("ambientcg", { cache, ask: net.ask });
  await materialList("polyhaven", { cache, ask: net.ask });
  const sheet = join(tmp, "materials-none.png");
  const run = runRefused(BIN, "search", "zzzznomatch", "--sheet", sheet, "--cache", cache);
  sure(run.code === 0 && /no materials match "zzzznomatch": no sheet written/.test(run.out) && /0 of \d+ materials hold/.test(run.out) && !existsSync(sheet), `${run.code} ${run.out} ${run.err}`); // prettier-ignore
});

test("primext: <tex>_norm.tga (DirectX green, 24 bit) and <tex>_gloss.tga (R smoothness, G metal, B occlusion, A 128, 32 bit) at the base texture's size, from a set of another size", () => {
  const out = join(tmp, "materials-px");
  const small = makeMaterial(set, { name: "px_plate", size: [32, 32] }); // the set's pictures are 64
  writeMaterial(small, out, set, { date: "2026-11-17" });
  const tga = (f) => { const b = readFileSync(join(out, "tex", f)); const [w, h, px] = [b.readUInt16LE(12), b.readUInt16LE(14), b[16] / 8]; return { b, w, h, bpp: b[16], at: (x, y, c) => b[18 + ((h - 1 - y) * w + x) * px + c] }; }; // prettier-ignore
  const run = runRefused(BIN, "primext", out, "-o", join(out, "tex"), "--metal", "px_plate=0.6", "--rough", "px_plate=0.5");
  sure(run.code === 0 && /PASS: 1 textures/.test(run.out) && /px_plate: 32x32 norm gloss/.test(run.out), `${run.code} ${run.out} ${run.err}`);
  const n = tga("px_plate_norm.tga");
  const normal = readPicture(readFileSync(join(out, "px_plate.set/normal.png")));
  sure(n.w === 32 && n.h === 32 && n.bpp === 24 && n.b[2] === 2, `norm ${n.w}x${n.h} ${n.bpp}`);
  // BGR in the file: the flat normal is 128, 180 (OpenGL's), 230; DirectX's green is 255 - 180 = 75
  sure(n.at(5, 7, 2) === 128 && n.at(5, 7, 1) === 75 && n.at(5, 7, 0) === 230, [n.at(5, 7, 2), n.at(5, 7, 1), n.at(5, 7, 0)].join());
  sure(Math.abs(normal.data[1] - 180) < 1, "the set's own normal is OpenGL's");
  const g = tga("px_plate_gloss.tga");
  // roughness 128/255 x 0.5: smoothness 255 x (1 - 0.251) = 191; metal 0.6 = 153; no occlusion = 255; alpha 128
  sure(g.w === 32 && g.h === 32 && g.bpp === 32, `gloss ${g.w}x${g.h} ${g.bpp}`);
  const px = [g.at(3, 9, 2), g.at(3, 9, 1), g.at(3, 9, 0), g.at(3, 9, 3)].join();
  sure(px === "191,153,255,128", px);
  // the set's own metalness and occlusion maps used as they are (at any size); no options: roughness 128/255 whole
  const flat = (v) => smak.png(16, 16, new Uint8Array(16 * 16 * 4).map((_, i) => (i % 4 === 3 ? 255 : v)));
  writeFileSync(join(out, "px_plate.set/metalness.png"), flat(200));
  writeFileSync(join(out, "px_plate.set/occlusion.png"), flat(90));
  const again = runRefused(BIN, "primext", join(out, "px_plate.set"), "-o", join(out, "tex2"));
  sure(again.code === 0 && /metal from its map/.test(again.out) && !/no occlusion/.test(again.out), again.out + again.err);
  const g2 = readFileSync(join(out, "tex2/px_plate_gloss.tga"));
  sure([g2[20], g2[19], g2[18], g2[21]].join() === "127,200,90,128", [g2[20], g2[19], g2[18], g2[21]].join());
  // a smooth gloss (roughness 0.25 with --rough 0.5) is warned of once, with the factor that makes it about 0.8; 0.5 is not
  sure(/WARN {2}1 glosses are smooth, a mean roughness under 0\.45: .*px_plate 0\.25 \(--rough px_plate=3\.2\)/.test(run.out) && /\(1 warnings\)/.test(run.out), run.out); // prettier-ignore
  sure(!/WARN/.test(again.out), again.out);
  // --flatten: a texel tilted less than the slope given is made flat (the set's normal leans 0.41), one tilted more is kept
  const flattened = runRefused(BIN, "primext", join(out, "px_plate.set"), "-o", join(out, "tex3"), "--flatten", "px_plate=0.5");
  const n3 = readFileSync(join(out, "tex3/px_plate_norm.tga"));
  sure(/norm \(flat under 0\.5\)/.test(flattened.out) && [n3[20], n3[19], n3[18]].join() === "128,128,255", flattened.out + [n3[20], n3[19], n3[18]].join()); // prettier-ignore
  runRefused(BIN, "primext", join(out, "px_plate.set"), "-o", join(out, "tex4"), "--flatten", "px_plate=0.22");
  sure(readFileSync(join(out, "tex4/px_plate_norm.tga"))[19] === 75, "a tilt over the slope given is kept");
  // no base texture beside the set: FAIL and a sentence; a metal out of range is refused
  const lone = join(tmp, "materials-px-lone", "lone.set");
  mkdirSync(lone, { recursive: true });
  const refused = runRefused(BIN, "primext", lone, "-o", join(tmp, "materials-px-none"));
  sure(refused.code === 1 && /FAIL: lone: no lone\.png beside lone\.set/.test(refused.out), refused.out + refused.err);
  sure(/--metal: px 0 to 1, not 2/.test(runRefused(BIN, "primext", lone, "-o", out, "--metal", "px=2").err), "metal out of range");
});
