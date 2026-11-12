// A re-skin in one step (check/reskin.mjs): triangles that share pixels with others given pixels of their own
// (ownPixels), a model recoloured, weathered and painted over by rules (reskin), each changed texture drawn
// before and after, `smak reskin`, and `check --source` saying which warnings the original has too.
//
// The model is made here: two squares on two bones whose places in one picture overlap (the left square on its
// left half, the right square across its middle), as a game's plates share one tiled rust. The picture's left
// half is red, its right half blue.
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import { test, sure, near, tmp, runSmak, runRefused, SMAK_CLI } from "./helper.mjs";

const W = 64;
const H = 32;
/** A picture `width` by `height`: red on its left half, blue on its right. */
const halves = (name, width = W, height = H) => {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) rgb.set((i % width) < width / 2 ? [200, 30, 30] : [30, 40, 200], i * 3);
  return smak.indexed({ width, height, rgb }, name);
};
const bones = [
  { name: "low", parent: -1, pos: [0, 0, 0] },
  { name: "high", parent: 0, pos: [0, 0, 10] },
];
/** A square facing +x, from z0 to z0 + 4, on `bone`, laid on the picture from u0 to u1 across all of its height. */
const square = (z0, bone, u0, u1) => {
  const c = (y, z, u, v) => ({ p: [1, y, z], uv: [u, v], bone });
  return [
    [c(-2, z0, u0, 1), c(2, z0, u1, 1), c(2, z0 + 4, u1, 0)],
    [c(-2, z0, u0, 1), c(2, z0 + 4, u1, 0), c(-2, z0 + 4, u0, 0)],
  ];
};
const model = (texture = halves("plates.bmp"), extra = []) =>
  smak.buildMdl({
    name: "plates.mdl",
    bones,
    bodyparts: [{ name: "body", models: [{ name: "plates", meshes: [{ tris: [...square(0, 0, 0, 0.5), ...square(10, 1, 0.25, 0.75)], texture }, ...extra] }] }],
  });
const src = model();
/** The texture each triangle wears, by the bone it hangs on: { low: name, high: name }. */
const wornBy = (mdl) => {
  const out = {};
  for (const t of smak.posed(mdl, { seq: 0 }).tris) out[["low", "high"][t.c[0].bone]] = t.tex.name;
  return out;
};
/** The colour of a texture at a pixel, [r, g, b]. */
const pixel = (mdl, name, x, y) => {
  const t = smak.textureOf(mdl, name);
  const k = t.pixels[y * t.width + x] * 3;
  return [t.palette[k], t.palette[k + 1], t.palette[k + 2]];
};
const refuses = (run, pattern) => {
  try {
    run();
  } catch (e) {
    return pattern.test(e.message) ? true : `it said: ${e.message}`;
  }
  return "it did not refuse";
};

test("ownPixels: one island of a shared picture gets a texture of its own, a copy of its pixels; the other keeps the old", () => {
  const islands = smak.uvIslands(src, { seq: 0 }).list;
  sure(islands.length === 2, `two islands, not ${islands.length}`);
  const low = islands.find((island) => island.bones[0] === "low").id;
  const own = smak.ownPixels(src, { islands: low });
  sure(own.texture === "plates_own.bmp" && own.moved === 2, `${own.texture}, ${own.moved} moved`);
  // the box of the triangles (0 to 32 across, all 32 down) and two pixels about it
  sure(own.width === 36 && own.height === 36 && own.scale === 1, `${own.width}x${own.height} at ${own.scale}`);
  sure(JSON.stringify(own.box) === "[-2,-2,34,34]", JSON.stringify(own.box));
  sure(own.meshes.length === 1 && own.meshes[0].mesh === 1, JSON.stringify(own.meshes));
  const worn = wornBy(own.mdl);
  sure(worn.low === "plates_own.bmp" && worn.high === "plates.bmp", JSON.stringify(worn));
  sure(!smak.check(own.mdl).errors.length, smak.check(own.mdl).errors.join("; "));
  // the points stay where they were, and the copy is the old picture's pixels
  const points = (mdl) => smak.posed(mdl, { seq: 0 }).tris.flatMap((t) => t.c.map((c) => c.p.join())).sort().join("|");
  sure(points(own.mdl) === points(src), "the points moved");
  sure(pixel(own.mdl, "plates_own.bmp", 12, 12).join() === pixel(src, "plates.bmp", 10, 10).join(), "a copy of the red");
  // painted alone: the new texture changes, the old one (which the other square wears) does not
  const green = smak.paint(own.mdl, () => [0, 1, 0], { only: ["plates_own.bmp"] }).mdl;
  sure(pixel(green, "plates_own.bmp", 12, 12).join() === "0,255,0", `${pixel(green, "plates_own.bmp", 12, 12)}`);
  sure(pixel(green, "plates.bmp", 20, 10).join() === pixel(src, "plates.bmp", 20, 10).join(), "the shared pixels changed");
  // what the island is called now
  sure(own.islands.length === 1 && smak.uvIslands(own.mdl).list[own.islands[0]].tex === "plates_own.bmp", JSON.stringify(own.islands));
});

test("ownPixels: a box larger than `most` is made smaller and its corners follow; a body or a mesh is asked for too; refusals", () => {
  const small = smak.ownPixels(src, { mesh: { bodypart: 0, model: 0, mesh: 0 }, most: 16, name: "small.bmp" });
  sure(small.width <= 16 && small.height <= 16 && small.scale < 1, `${small.width}x${small.height}`);
  sure(small.warnings.some((line) => /to keep within 16/.test(line)), small.warnings.join("; "));
  sure(small.moved === 4 && wornBy(small.mdl).high === "small.bmp", JSON.stringify(wornBy(small.mdl)));
  // every corner still within the smaller picture
  for (const t of smak.posed(small.mdl, { seq: 0 }).tris)
    for (const c of t.c) sure(c.u >= 0 && c.u <= small.width && c.v >= 0 && c.v <= small.height, `a corner at ${c.u}, ${c.v}`);
  const whole = smak.ownPixels(src, { body: 0, tex: "plates.bmp" });
  sure(whole.moved === 4 && whole.width === 52, `${whole.moved} moved, ${whole.width} wide`);
  sure(refuses(() => smak.ownPixels(src, {}), /say which triangles/), "nothing asked for");
  sure(refuses(() => smak.ownPixels(src, { islands: 9 }), /there is no island 9/), "an island it has not");
  sure(refuses(() => smak.ownPixels(src, { islands: 0, name: "plates.bmp" }), /has a texture called plates.bmp/), "a name it has");
  const two = model(halves("plates.bmp"), [{ tris: square(20, 1, 0, 1), texture: halves("other.bmp") }]);
  sure(refuses(() => smak.ownPixels(two, { body: 0 }), /wear plates.bmp, other.bmp: one texture a call/), "two textures");
});

test("reskin: a hue recoloured with its light kept, a box darkened, rust by place; rules said wrong are refused in words", () => {
  const made = smak.reskin(src, [
    { hue: [330, 30], sat: [0.3, 1], recolour: [0.1, 0.6, 0.1] },
    { box: [40, 0, 48, 32], darken: 0.5 },
  ]);
  const red = pixel(made.mdl, "plates.bmp", 8, 8);
  sure(red[1] > red[0] * 3 && red[1] > red[2] * 3, `the red is green now: ${red}`);
  // the mean of what the rule took becomes the colour asked for: here every red pixel is one colour
  near(red[1] / 255, 0.6, 0.03, "green as asked");
  const blue = pixel(made.mdl, "plates.bmp", 36, 8);
  sure(blue[2] > 150 && blue[0] < 60, `the blue is left: ${blue}`);
  const dark = pixel(made.mdl, "plates.bmp", 44, 8);
  near(dark[2], 100, 6, "the box darkened by half");
  sure(made.changed.join() === "plates.bmp" && made.pictures.length === 1, made.changed.join());
  sure(made.pictures[0].image.width === 2 * W && made.pictures[0].image.height === H, "before and after, side by side");
  const rusted = smak.reskin(src, [{ rust: 1, scale: 0.2 }]);
  sure(rusted.changed.length === 1, "rust changed nothing");
  sure(refuses(() => smak.reskin(src, [{ darken: 0.2, rust: 0.5 }]), /does one thing of .*; it has darken and rust/), "two things");
  sure(refuses(() => smak.reskin(src, [{ hue: 30, darken: 0.2 }]), /hue is \[low, high\]/), "a hue of one number");
  sure(refuses(() => smak.reskin(src, [{ shade: 1 }]), /does one thing/), "no action");
  sure(refuses(() => smak.reskin(src, [{ darken: 0.2, colour: 1 }]), /colour is not a word of a rule/), "a word it has not");
});

test("reskin with `own`: one plate painted alone, the plate that shares its pixels untouched", () => {
  const low = smak.uvIslands(src).list.find((island) => island.bones[0] === "low").id;
  const made = smak.reskin(src, [{ only: ["plates_own.bmp"], paint: [1, 1, 0] }], { own: [{ islands: low }] });
  sure(made.owned.length === 1 && made.changed.join() === "plates_own.bmp", made.changed.join());
  sure(pixel(made.mdl, "plates_own.bmp", 12, 12).join() === "255,255,0", "the plate painted");
  sure(pixel(made.mdl, "plates.bmp", 20, 10).join() === pixel(src, "plates.bmp", 20, 10).join(), "the other plate kept");
});

test("check with its source: what the original has too is said as inherited, a texture it lacks is the file's own", () => {
  const wide = halves("wide.bmp", 520, 8);
  const original = model(halves("plates.bmp"), [{ tris: square(20, 1, 0, 1), texture: wide }]);
  const made = smak.reskin(original, [{ only: ["wide.bmp"], darken: 0.3 }]).mdl;
  const plain = smak.check(made);
  sure(plain.warnings.some((line) => /larger than 512 \(wide.bmp 520x8\)/.test(line)) && !plain.inherited, plain.warnings.join("; "));
  const told = smak.check(made, "goldsrc", { source: original });
  sure(told.inherited === 1 && told.warnings.every((line) => line.startsWith(smak.INHERITED)), told.warnings.join("; "));
  // a texture of the re-skin's own, too large, is not inherited
  const grown = smak.replaceTexture(made, "plates.bmp", halves("plates.bmp", 600, 8), { quiet: true });
  const both = smak.check(grown, "goldsrc", { source: original });
  sure(both.inherited === 1 && both.warnings.some((line) => /^1 textures larger than 512 \(plates.bmp 600x8\)/.test(line)), both.warnings.join("; "));
});

test("smak reskin: a file of rules, the textures before and after; smak check --source", () => {
  const file = join(tmp, "plates.mdl");
  writeFileSync(file, src);
  const rules = join(tmp, "plates-rules.json");
  writeFileSync(rules, JSON.stringify({ rules: [{ hue: [330, 30], recolour: [0.2, 0.5, 0.2] }, { moss: 0.8, low: 30 }] }));
  const out = join(tmp, "plates-reskin.mdl");
  const said = runSmak("reskin", file, rules, "-o", out, "--pictures", join(tmp, "plates-pictures"));
  sure(/1 textures changed: plates.bmp/.test(said) && existsSync(join(tmp, "plates-pictures", "plates_before_after.png")), said);
  const checked = runSmak("check", out, "--source", file);
  sure(/fit for goldsrc/.test(checked), checked);
  const wrong = join(tmp, "plates-wrong.json");
  writeFileSync(wrong, JSON.stringify({ rules: [{ darken: 0.1, rust: 1 }] }));
  const refused = runRefused(SMAK_CLI, "reskin", file, wrong, "-o", out);
  sure(refused.code === 1 && /does one thing/.test(refused.err), refused.err);
  const noFolder = runRefused(SMAK_CLI, "reskin", file, rules, "-o", out, "--pictures");
  sure(noFolder.code === 1 && /--pictures needs a folder/.test(noFolder.err), noFolder.err);
});
