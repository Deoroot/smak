// The art kit's texture pipeline (levels/lib/art-kit.mjs): GoldSrc's name and size rules, the kit manifest checked,
// photos laid at the texture's density (whole repeats or a seamless crop), 256 colours with a masked texture's index
// 255 pure blue, the four mip sizes, the WAD written and read back, the contact sheet, ambientCG's zips read entry by
// entry. No network: every picture and zip is made here. Each check passes its whole case and fails a broken copy
// by its sentence.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { test, sure, HERE } from "./helper.mjs";
import {
  nameProblems,
  validateKit,
  photoFit,
  seamlessCrop,
  linearOf,
  quantize,
  makeTexture,
  buildKitWad,
  verifyKitWad,
  contactSheet,
  zipDirectory,
  zipEntryData,
  withParams,
  composeTexture,
  textureMeasures,
  recipeProblems,
  openFlags,
} from "../levels/lib/art-kit.mjs";
import { readWad } from "../src/maps/wad.mjs";

const KIT = JSON.parse(readFileSync(join(HERE, "../levels/art/newbyzantium-kit.json"), "utf8"));
const copy = (v) => JSON.parse(JSON.stringify(v));
const has = (list, words, what) => {
  const all = list.join(" | ");
  sure(all.includes(words), `${what}: wanted "${words}", got: ${all || "nothing"}`);
};
/** A small photo made here: a deterministic pattern of `w` x `h`, its colour leaning to `tint`. */
const photo = (w, h, tint = [1, 1, 1]) => {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = 60 + ((x * 7 + y * 13 + ((x * y) % 11) * 9) % 140);
      rgba.set([v * tint[0], v * tint[1], v * tint[2], 255].map(Math.round), (y * w + x) * 4);
    }
  return { width: w, height: h, rgba };
};
const BASES = { stone: { picture: photo(64, 64), metres: [1, 1] }, gold: { picture: photo(32, 32, [1, 0.8, 0.35]), metres: [0.5, 0.5] } };
const PLAIN = { name: "t_panel", size: [64, 32], recipe: [{ op: "photo", photo: "stone", grade: { mean: 0.3 } }, { op: "panels", grid: { cols: 2, rows: 1, gap: 4 }, fill: { photo: "gold", grade: { colorize: { hue: "$hue", sat: 0.4 } } }, bevel: 2 }] };
const MASKED = { name: "{t_bars", size: [32, 32], recipe: [{ op: "photo", photo: "stone" }, { op: "clear" }, { op: "beams", segments: [[8, -2, 8, 34], [24, -2, 24, 34]], width: 4, fill: { photo: "stone" } }] };
const make = () => [makeTexture(PLAIN, { bases: BASES, params: { hue: 270 }, supersample: 2 }), makeTexture(MASKED, { bases: BASES, supersample: 2 })];

test("art kit: GoldSrc's name and size rules, each broken name refused by its sentence", () => {
  for (const n of ["nbm_wall1", "{nbm_bars", "~nbx_light", "+0nbs_neonsalon", "!nb_toxic", "+anbs_x"]) {
    const p = nameProblems(n, { width: 64, height: 128 });
    sure(!p.length, `${n} should pass: ${p.join("; ")}`);
  }
  has(nameProblems("nbs_trade_repair"), "16 characters", "a name of 16");
  has(nameProblems("NBM_wall"), "capitals", "capitals");
  has(nameProblems("{{double"), "two prefixes", "two prefixes");
  has(nameProblems("+xframe"), "not +0..+9", "a bad frame");
  has(nameProblems("nb wall"), "character other than", "a space");
  has(nameProblems("{"), "nothing after it", "a bare prefix");
  has(nameProblems("a", { width: 100, height: 64 }), "not a multiple of 16", "a side of 100");
  has(nameProblems("a", { width: 64, height: 0 }), "not a whole number", "a side of 0");
  has(nameProblems("a", { width: 1024, height: 64 }), "over 512", "a side of 1024");
});

test("art kit: the manifest passes, covers the notes' ~130 by theme, and each broken copy fails by its sentence", () => {
  const { errors, counts } = validateKit(KIT);
  sure(!errors.length, `the kit should pass: ${errors.join("; ")}`);
  // insurgents: the notes' 9, plus four defaced posters (one for each of the six) and the Upturned mark at 128 and 64 (emblems, 2026-11-02)
  const want = { msr: 11, "msr-id": 14, l3: 10, l2: 13, l1: 8, props: 2, mega: 12, insurgents: 15, signs: 42, decals: 9, liquid: 1 };
  for (const [k, v] of Object.entries(want)) sure(counts[k] === v, `theme ${k}: ${counts[k]} textures, the notes plan ${v}`);
  const built = KIT.textures.filter((t) => t.status === "built");
  sure(built.filter((t) => t.batch === 1).length === 23, `batch 1 should be the 23 MSR and mega textures, got ${built.filter((t) => t.batch === 1).length}`);
  sure(built.filter((t) => t.batch === 2).length === 22, `batch 2 should be the 22 CC0 textures that had a family only, got ${built.filter((t) => t.batch === 2).length}`);
  sure(built.every((t) => t.recipe && t.source.kind === "cc0" && t.source.bases?.length), "every built texture has a recipe and chosen CC0 bases");
  sure(KIT.textures.filter((t) => t.source.kind === "cc0").every((t) => t.status === "built"), "no CC0 texture is left without a recipe");
  for (const t of KIT.textures.filter((x) => x.source.kind === "cc0")) for (const k of t.source.bases ?? []) sure(KIT.bases[k].licence === "CC0-1.0", `${t.name}'s base ${k} is not CC0`);
  const broken = (what, change, words) => {
    const k = copy(KIT);
    change(k);
    has(validateKit(k).errors, words, what);
  };
  broken("a name twice", (k) => k.textures.push({ ...copy(k.textures[0]), name: k.textures[0].name.toUpperCase() }), "given twice");
  broken("a licence not CC0", (k) => (k.bases.Marble016.licence = "CC-BY-4.0"), "licence CC-BY-4.0");
  broken("a URL not the provider's", (k) => (k.bases.Marble016.url = "https://example.com/m"), "not the provider's page");
  broken("no metres", (k) => delete k.bases.Marble016.metres, "metres [w, h]");
  broken("a recipe's base unknown", (k) => (k.textures[0].recipe[0].photo = "Nope"), "reads base Nope, not in the kit's bases");
  broken("a recipe's base not in its source", (k) => (k.textures[0].recipe[0].photo = "Concrete033"), "not listed in its source");
  broken("masked with no hole", (k) => (k.textures.find((t) => t.name === "{nbm_bars").recipe = [{ op: "photo", photo: "Metal038" }]), "never clears a hole");
  broken("holes in a plain name", (k) => k.textures[0].recipe.push({ op: "clear" }), "does not begin with {");
  broken("a family only, built", (k) => (k.textures.find((t) => t.name === "nb3_stucco").source = { kind: "cc0", families: ["Plaster"] }), "its base must be chosen");
  broken("paint with no brief", (k) => delete k.textures.find((t) => t.source.kind === "paint").source.brief, "no painter's brief");
  broken("an unknown theme", (k) => (k.textures[0].theme = "space"), "theme space");
  broken("a wrong format", (k) => (k.format = "smak-art-kit/0"), "not smak-art-kit/1");
  has([(() => { try { withParams(["$nothing"], {}); } catch (e) { return e.message; } return ""; })()], "$nothing is not given", "a parameter missing");
});

test("art kit: photos laid at the texture's density, whole repeats or a crop that tiles", () => {
  // 256 texels of 1 unit = 6.5 m: a 2 m photo three times; 128 texels = 3.25 m of a 4 m photo (0.81): whole; 64 = 1.63 m: cropped
  const a = photoFit([2, 2], 256, 256);
  sure(a.repeat[0] === 3 && a.crop[0] === 1, `a 2 m photo on 256 texels: ${JSON.stringify(a)}`);
  const b = photoFit([4, 4], 128, 64);
  sure(b.repeat[0] === 1 && b.crop[0] === 1 && Math.abs(b.crop[1] - 0.4064) < 1e-3, `a 4 m photo on 128 texels: ${JSON.stringify(b)}`);
  sure(photoFit([4, 4], 128, 64, 1, { crop: false }).crop[1] === 1, "crop: false keeps the whole photo");
  // the crop's last column runs on into its first as the photo does: the seam is no bigger than the photo's own steps
  const lin = linearOf(photo(64, 64));
  const c = seamlessCrop(lin, 0.5, 1);
  const step = (x0, x1) => Math.abs(c.rgb[(10 * c.width + x0) * 3] - c.rgb[(10 * c.width + x1) * 3]);
  const seam = step(c.width - 1, 0);
  const photoStep = Math.abs(lin.rgb[(10 * 64 + 32) * 3] - lin.rgb[(10 * 64 + 31) * 3]);
  sure(Math.abs(seam - photoStep) < 1e-6, `the crop's seam ${seam} should be the photo's own step ${photoStep}`);
});

test("art kit: 256 colours, a masked texture's index 255 pure blue and only where the holes are; deterministic", () => {
  const pic = photo(32, 32, [1, 0.6, 0.9]);
  for (let i = 0; i < 32 * 8; i++) pic.rgba[i * 4 + 3] = 0; // the top quarter see-through
  const q = quantize(pic, { masked: true });
  sure(q.colours <= 255, `masked: ${q.colours} colours, at most 255`);
  sure(q.palette[765] === 0 && q.palette[766] === 0 && q.palette[767] === 255, "index 255 should be 0,0,255");
  for (let i = 0; i < 32 * 32; i++) sure((q.pixels[i] === 255) === i < 32 * 8, `pixel ${i}: a hole exactly where alpha is 0`);
  const again = quantize(pic, { masked: true });
  sure(Buffer.compare(Buffer.from(again.pixels), Buffer.from(q.pixels)) === 0 && Buffer.compare(Buffer.from(again.palette), Buffer.from(q.palette)) === 0, "the same picture gives the same bytes");
  const plain = quantize(photo(64, 64, [0.9, 0.7, 0.5]), { iterations: 4 });
  sure(plain.colours <= 256 && plain.palette.length === 768, "a plain texture: 256 colours at most, 768 bytes");
  const dithered = quantize(photo(64, 64, [0.9, 0.7, 0.5]), { dither: 1 });
  sure(Buffer.compare(Buffer.from(dithered.pixels), Buffer.from(plain.pixels)) !== 0, "a dither changes the mapping");
});

test("art kit: textures made with four mips, the WAD round trip, and each broken WAD told", () => {
  const made = make();
  for (const t of made) {
    t.mips.forEach((m, l) => sure(m.length === (t.width >> l) * (t.height >> l), `${t.name} mip ${l}: ${m.length} pixels`));
    sure(t.stats.meanBrightness > 20 && t.stats.paletteError < 8, `${t.name}: ${JSON.stringify(t.stats)}`);
  }
  sure(made[1].mips[3].includes(255), "{t_bars keeps holes down to its smallest mip");
  sure(!made[0].pixels.includes(255) || !made[0].holes, "a plain texture has no holes");
  const { bytes, problems } = buildKitWad(made);
  sure(!problems.length, `the WAD should read back: ${problems.join("; ")}`);
  const back = readWad(bytes);
  sure(back.textures.map((t) => t.name).join() === "t_panel,{t_bars", "names and order kept");
  sure(Buffer.compare(bytes, buildKitWad(make()).bytes) === 0, "the same recipes give the same WAD");
  // the hue parameter recolours: a different hue, different palette, same pixels count
  const blue = makeTexture(PLAIN, { bases: BASES, params: { hue: 215 }, supersample: 2 });
  sure(Buffer.compare(Buffer.from(blue.palette), Buffer.from(made[0].palette)) !== 0, "msrHue changes the palette");
  // broken: cut short, a masked palette's 255 not blue, a texture missing, a size not as asked
  has(verifyKitWad(bytes.subarray(0, 40), made), "does not read back", "a cut WAD");
  const wrongBlue = Buffer.from(bytes);
  const bars = readWad(wrongBlue).textures[1];
  bars.palette[766] = 9; // a view into wrongBlue: index 255's green
  has(verifyKitWad(wrongBlue, made), "not pure blue", "index 255 not blue");
  has(verifyKitWad(bytes, [...made, { ...made[0], name: "t_extra" }]), "t_extra is not in the WAD", "a texture missing");
  has(verifyKitWad(bytes, [{ ...made[0], width: 32 }, made[1]]), "reads back 64x32, not 32x32", "a size not as asked");
  has(verifyKitWad(buildKitWad([made[0], { ...made[0], name: "{t_none" }]).bytes, [made[0], { ...made[0], name: "{t_none" }]), "has no hole", "a masked texture with no hole");
});

test("art kit: the contact sheet at game scale, and ambientCG's zip read entry by entry", () => {
  const { bytes } = buildKitWad(make());
  const sheet = contactSheet(bytes, { cols: 2 });
  sure(sheet.width === 2 * (384 + 40) + 8 && sheet.height === 384 + 18 + 8 && sheet.rgba.length === sheet.width * sheet.height * 4, `sheet ${sheet.width}x${sheet.height}`);
  // a zip made here: one stored entry, one deflated, the directory, the end record
  const entries = [["Thing_1K-PNG_NormalGL.png", Buffer.from("normal map bytes"), 0], ["Thing_1K-PNG_Color.png", Buffer.from("colour ".repeat(50)), 8]];
  const parts = [];
  const dir = [];
  let off = 0;
  for (const [name, data, method] of entries) {
    const packed = method ? deflateRawSync(data) : data;
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.write(name, 30);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(off, 42);
    central.write(name, 46);
    parts.push(local, packed);
    dir.push(central);
    off += local.length + packed.length;
  }
  const dirBytes = Buffer.concat(dir);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBytes.length, 12);
  end.writeUInt32LE(off, 16);
  const zip = Buffer.concat([...parts, dirBytes, end]);
  const tail = zip.subarray(zip.length - 120);
  const list = zipDirectory(zip, zip.length);
  const colour = list.find((e) => /_Color\.png$/.test(e.name));
  sure(colour && colour.method === 8, `the colour entry found: ${JSON.stringify(list)}`);
  sure(zipEntryData(zip.subarray(colour.local), colour).toString() === entries[1][1].toString(), "the deflated entry unpacks");
  sure(zipEntryData(zip.subarray(list[0].local), list[0]).toString() === "normal map bytes", "the stored entry reads");
  has([(() => { try { zipDirectory(tail, zip.length); } catch (e) { return e.message; } return ""; })()], "not in the bytes read", "a tail too short");
  has([(() => { try { zipDirectory(Buffer.alloc(64), 64); } catch (e) { return e.message; } return ""; })()], "no end-of-directory", "not a zip");
  has([(() => { try { zipEntryData(zip.subarray(colour.local), { ...colour, method: 12 }); } catch (e) { return e.message; } return ""; })()], "method 12", "bzip2");
  has([(() => { try { zipEntryData(zip.subarray(colour.local), { ...colour, size: 3 }); } catch (e) { return e.message; } return ""; })()], "not 3", "a size that lies");
});

// ── the second pass: relief, baked light, weathering, variation, the programmer-art measure ──
const lum = (pic, x, y) => {
  const o = (y * pic.width + x) * 4;
  return 0.2126 * pic.rgba[o] + 0.7152 * pic.rgba[o + 1] + 0.0722 * pic.rgba[o + 2];
};
const meanIn = (pic, [x0, y0, w, h]) => {
  let s = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) s += lum(pic, x, y);
  return s / (w * h);
};
const GREY = [{ op: "fill", colour: "#808080" }];
const compose = (recipe, size = 32, extra = {}) => composeTexture(recipe, { width: size, height: size, bases: BASES, supersample: 2, seed: "t", ...extra });

test("art kit: light baked from the relief: a raised panel lit top-left, its joint occluded, a flat face kept, a pipe lit on top", () => {
  const pic = compose([...GREY, { op: "panels", rects: [[6, 6, 20, 20]], relief: 3, bevel: 3, groove: 2, grooveDark: 0 }, { op: "bake" }]);
  const flat = meanIn(compose([...GREY, { op: "bake" }]), [0, 0, 32, 32]);
  sure(Math.abs(flat - 128) < 3, `a flat face keeps its colour under the bake: ${flat}`);
  const topLeft = meanIn(pic, [7, 7, 2, 12]);
  const bottomRight = meanIn(pic, [23, 12, 2, 12]);
  sure(topLeft > bottomRight + 15, `the bevel facing the key is lighter: ${topLeft.toFixed(1)} against ${bottomRight.toFixed(1)}`);
  const joint = meanIn(pic, [4, 14, 2, 4]);
  const centre = meanIn(pic, [14, 14, 4, 4]);
  sure(joint < centre - 8, `the joint is occluded: ${joint.toFixed(1)} against the face's ${centre.toFixed(1)}`);
  const pipe = compose([...GREY, { op: "cylinder", rect: [0, 8, 32, 16], axis: "x", fill: { colour: "#808080" } }, { op: "bake" }]);
  sure(meanIn(pipe, [0, 10, 32, 2]) > meanIn(pipe, [0, 21, 32, 2]) + 15, "a pipe along x is lit on its upper side");
});

test("art kit: weathering follows the relief and its wear: grime at a recess's bottom, streaks under a ledge, nothing at wear 0", () => {
  const sunk = [{ op: "photo", photo: "stone", grade: { mean: 0.5, saturation: 0 } }, { op: "panels", rects: [[4, 4, 24, 24]], fill: { photo: "stone", grade: { mean: 0.5, saturation: 0 } }, relief: -3, bevel: 1 }];
  const clean = compose(sunk);
  const worn0 = compose([...sunk, { op: "weather", wear: 0 }]);
  sure(Buffer.compare(Buffer.from(clean.rgba), Buffer.from(worn0.rgba)) === 0, "wear 0 changes nothing");
  const worn = compose([...sunk, { op: "weather", wear: 1, streaks: 0, dust: 0, edges: 0 }]);
  const dropBottom = meanIn(clean, [8, 24, 16, 3]) - meanIn(worn, [8, 24, 16, 3]);
  const dropTop = meanIn(clean, [8, 6, 16, 3]) - meanIn(worn, [8, 6, 16, 3]);
  sure(dropBottom > dropTop + 3, `grime gathers at the recess's bottom: ${dropBottom.toFixed(1)} darker there, ${dropTop.toFixed(1)} at its top`);
  const ledge = [...GREY, { op: "panels", rects: [[0, 4, 32, 6]], relief: 3, bevel: 0.5 }];
  const streaked = compose([...ledge, { op: "weather", wear: 1, grime: 0, dust: 0, edges: 0, streaks: 2, noise: "stone" }]);
  const plain = compose(ledge);
  const under = meanIn(plain, [0, 12, 32, 6]) - meanIn(streaked, [0, 12, 32, 6]);
  const over = meanIn(plain, [0, 0, 32, 3]) - meanIn(streaked, [0, 0, 32, 3]);
  sure(under > over + 2, `streaks run down from the ledge: ${under.toFixed(1)} darker below it, ${over.toFixed(1)} above`);
  const rusty = compose([...ledge, { op: "weather", wear: 1, rust: 2, rustPhoto: "gold" }]);
  sure(Buffer.compare(Buffer.from(rusty.rgba), Buffer.from(compose([...ledge, { op: "weather", wear: 1 }]).rgba)) !== 0, "rust in the joints changes the colour");
});

test("art kit: panels that differ: tone, place and seams by panel, so repeated panels stop measuring as copies", () => {
  const grid = (vary) => compose([{ op: "photo", photo: "stone" }, { op: "panels", grid: { cols: 2, rows: 2, gap: 2 }, fill: { photo: "stone", grade: { mean: 0.4 } }, relief: 1, vary }, { op: "bake" }], 64);
  const same = grid(undefined);
  const varied = grid({ tone: 0.2, hue: 6, scale: 0.2, seam: 1, chips: 0.5 });
  const spread = (pic) => {
    const m = [[1, 1], [33, 1], [1, 33], [33, 33]].map(([x, y]) => meanIn(pic, [x + 2, y + 2, 26, 26]));
    return Math.max(...m) - Math.min(...m);
  };
  sure(spread(varied) > spread(same) + 5, `panels differ in tone: ${spread(varied).toFixed(1)} against ${spread(same).toFixed(1)}`);
  sure(textureMeasures(varied).repeat < textureMeasures(same).repeat, `vary lowers the repeat: ${textureMeasures(varied).repeat} against ${textureMeasures(same).repeat}`);
  sure(Buffer.compare(Buffer.from(varied.rgba), Buffer.from(grid({ tone: 0.2, hue: 6, scale: 0.2, seam: 1, chips: 0.5 }).rgba)) === 0, "the same seed gives the same panels");
  // a base's normal map reaches the bake
  const normals = { width: 8, height: 8, rgba: new Uint8Array(8 * 8 * 4).map((_, i) => (i % 4 === 0 ? ((i >> 2) % 8) * 30 : i % 4 === 1 ? 128 : 255)) };
  const withMap = { ...BASES, bumpy: { picture: photo(8, 8), metres: [0.2, 0.2], maps: { NormalGL: normals } } };
  const a = composeTexture([{ op: "photo", photo: "bumpy", detail: 1 }, { op: "bake" }], { width: 32, height: 32, bases: withMap, supersample: 2 });
  const b = composeTexture([{ op: "photo", photo: "bumpy" }, { op: "bake" }], { width: 32, height: 32, bases: withMap, supersample: 2 });
  sure(Buffer.compare(Buffer.from(a.rgba), Buffer.from(b.rgba)) !== 0, "detail takes the photo's normal map into the light");
});

test("art kit: the programmer-art measure flags flat, ruled, repeating and loud pictures, and passes a photograph", () => {
  const solid = compose([{ op: "fill", colour: "#556677" }], 64);
  has(textureMeasures(solid).flags, "flat:", "a solid fill");
  const boxes = compose([{ op: "fill", colour: "#303030" }, { op: "fill", grid: { cols: 4, rows: 4, gap: 4 }, colour: "#a0a0a0" }], 64);
  has(textureMeasures(boxes).flags, "ruled:", "drawn rectangles");
  has(textureMeasures(boxes).flags, "repeats:", "sixteen equal boxes");
  has(textureMeasures(compose([{ op: "fill", colour: "#ff00ff" }], 32)).flags, "loud:", "magenta");
  // a photo bigger than the texture, cropped seamlessly: one photo across it, no repeat inside
  const real = textureMeasures(compose([{ op: "photo", photo: "big" }], 64, { bases: { ...BASES, big: { picture: photo(96, 96), metres: [4, 4] } } }));
  sure(!real.flags.length, `a photograph should pass: ${real.flags.join("; ")}`);
  has([(() => { try { textureMeasures({ width: 4, height: 4, rgba: new Uint8Array(10) }); } catch (e) { return e.message; } return ""; })()], "needs 64 bytes", "a picture of the wrong size");
});

test("art kit: recipes and manifests refuse a broken op, profile, axis, wear, accepted flag or map by its sentence", () => {
  const refuse = (recipe, words) => has([(() => { try { compose(recipe); } catch (e) { return e.message; } return ""; })()], words, words);
  refuse([{ op: "emboss" }], "op 0 (emboss) is not one the kit knows");
  refuse([{ op: "moulding", rect: [0, 0, 32, 8], profile: [[0, 0], [0.7, 2], [0.3, 1], [1, 0]] }], "moulding profile must run from 0 to 1");
  refuse([{ op: "moulding", rect: [0, 0, 32, 8], profile: [[0.1, 0], [1, 0]] }], "moulding profile must run from 0 to 1");
  refuse([{ op: "cylinder", rect: [0, 0, 32, 8], axis: "z" }], "axis z is not x or y");
  refuse([{ op: "weather", wear: 1.5 }], "wear 1.5 is outside 0-1");
  sure(!recipeProblems(KIT.textures.find((t) => t.name === "nbm_trim1").recipe).length, "the kit's moulding passes");
  const broken = (what, change, words) => {
    const k = copy(KIT);
    change(k);
    has(validateKit(k).errors, words, what);
  };
  broken("an unknown op in the kit", (k) => k.textures[0].recipe.push({ op: "emboss" }), "is not one the kit knows");
  broken("an accepted flag unknown", (k) => (k.textures[0].accept = { shiny: "why not" }), "accept shiny is not one of");
  broken("an accepted flag with no reason", (k) => (k.textures[0].accept = { ruled: "" }), "accepting ruled needs a reason");
  broken("a base map unknown", (k) => (k.bases.Marble016.maps = ["Roughness"]), "map Roughness is not one of");
  const flags = { flags: ["ruled: 90%", "repeats: 90%"] };
  sure(openFlags({ accept: { ruled: "bars" } }, flags).join() === "repeats: 90%", "an accepted flag is not raised");
});

// ── batch 2's additions: alpha masks from photos, lines that wander, stretched sampling, streaks from drawn edges ──
const holeShare = (pic) => {
  let n = 0;
  for (let i = 3; i < pic.rgba.length; i += 4) if (pic.rgba[i] < 128) n++;
  return n / (pic.width * pic.height);
};

test("art kit: a decal's holes from a photo: its threshold, its normalised luminance, a rim kept clear, and its refusals", () => {
  const big = { ...BASES, big: { picture: photo(96, 96), metres: [1.63, 1.63] } };
  const mask = (extra) => composeTexture([{ op: "fill", colour: "#303030" }, { op: "alpha", photo: "big", crop: false, ...extra }], { width: 64, height: 64, bases: big, supersample: 2 });
  const low = holeShare(mask({ threshold: 0.3, normalise: true }));
  const high = holeShare(mask({ threshold: 0.7, normalise: true }));
  sure(high > low + 0.2, `a higher threshold makes more holes: ${high.toFixed(2)} against ${low.toFixed(2)}`);
  sure(low > 0.02 && high < 0.98, `normalised, the photo's own light and dark decide: ${low.toFixed(2)}, ${high.toFixed(2)}`);
  const ringed = mask({ threshold: 0.3, normalise: true, shape: { radial: 0.6 } });
  let rim = 0;
  for (let x = 0; x < 64; x++) for (const y of [0, 63]) if (ringed.rgba[(y * 64 + x) * 4 + 3] >= 128) rim++;
  sure(rim === 0, `a radial shape keeps the decal off its edges: ${rim} solid pixels on the rim`);
  const refuse = (recipe, words) => has([(() => { try { compose(recipe); } catch (e) { return e.message; } return ""; })()], words, words);
  refuse([{ op: "alpha" }], "needs the photo its mask comes from");
  refuse([{ op: "alpha", photo: "stone", threshold: 1.5 }], "threshold 1.5 is outside 0-1");
  refuse([{ op: "alpha", photo: "stone", map: "Opacity" }], "has no Opacity map");
  const k = copy(KIT);
  const rain = k.textures.find((t) => t.name === "{nbd_rain1");
  sure(rain.recipe.some((o) => o.op === "alpha") && !validateKit(k).errors.length, "a masked decal made by alpha alone passes the manifest");
  rain.recipe = rain.recipe.filter((o) => o.op !== "alpha");
  has(validateKit(k).errors, "never clears a hole", "a decal with no alpha");
});

test("art kit: lines that wander off the ruler, stretched sampling, and streaks only from drawn edges", () => {
  const grid = (vary) => compose([{ op: "photo", photo: "stone", grade: { mean: 0.25 } }, { op: "lines", lines: [8, 24, 40, 56].flatMap((v) => [[v, 0, v, 64], [0, v, 64, v]]), width: 2, colour: "#e0e0e0", vary }], 64);
  const ruled = textureMeasures(grid(undefined)).straightEdges;
  const wandering = textureMeasures(grid({ seam: 1.2 })).straightEdges;
  sure(wandering < ruled - 0.2, `wandering lines are less ruled: ${wandering} against ${ruled}`);
  const plain = compose([{ op: "photo", photo: "stone" }]);
  const drawn = compose([{ op: "photo", photo: "stone", stretch: [1, 0.1] }]);
  sure(Buffer.compare(Buffer.from(plain.rgba), Buffer.from(drawn.rgba)) !== 0, "stretch changes where the photo is read");
  // a photo's own relief sheds no streaks: weather with streaks only changes nothing on an undrawn surface
  const heights = { width: 16, height: 16, rgba: new Uint8Array(16 * 16 * 4).map((_, i) => (i % 4 === 3 ? 255 : (((i >> 2) % 16) < 8 ? 40 : 220))) };
  const bumpy = { ...BASES, bumpy: { picture: photo(16, 16), metres: [0.4, 0.4], maps: { Displacement: heights } } };
  const surface = [{ op: "photo", photo: "bumpy", relief: 3 }];
  const a = composeTexture(surface, { width: 32, height: 32, bases: bumpy, supersample: 2 });
  const b = composeTexture([...surface, { op: "weather", wear: 1, grime: 0, dust: 0, edges: 0, rust: 0, streaks: 2 }], { width: 32, height: 32, bases: bumpy, supersample: 2 });
  sure(Buffer.compare(Buffer.from(a.rgba), Buffer.from(b.rgba)) === 0, "the photo's grain sheds no streaks");
});
