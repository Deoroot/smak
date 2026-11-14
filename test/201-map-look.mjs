// A view beside its reference (check/maps/look.mjs lookOf, lookAgainst, lookSheet; smak map-look): the measures on
// pictures whose answer is known. A picture against itself differs in nothing; against its darker copy in brightness
// alone (contrast, colour and warmth are ratios); against its grey copy in colour and warmth alone; an evenly lit
// picture against one of pools of light and dark of the same mean in contrast alone. A box left out of the reference
// (a HUD) leaves its numbers as if it were not there. Facts only: nothing warns or fails.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../check/maps/index.mjs";
import { png, unpng } from "../core/image.mjs";
import { test, sure, HERE, SMAK_CLI, runRefused, tmp } from "./helper.mjs";

const [W, H] = [160, 90];
/** A picture from a function of (x, y) to [r, g, b] in 0 to 1. */
const picture = (at) => {
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) rgba.set([...at(x, y).map((v) => Math.round(v * 255)), 255], (y * W + x) * 4);
  return { width: W, height: H, rgba };
};
const pixel = (p, x, y) => [0, 1, 2].map((c) => p.rgba[(y * W + x) * 4 + c] / 255);
// a scene: a teal quarter on the left, the rest warm, a grey band, light falling off to the bottom
const scene = picture((x, y) => {
  const fall = 1 - (0.5 * y) / H;
  const colour = y < H / 3 ? [0.6, 0.6, 0.6] : x < W / 4 ? [0.2, 0.7, 0.75] : [0.9, 0.55, 0.3];
  return colour.map((v) => v * fall);
});
const map = (p, f) => picture((x, y) => f(pixel(p, x, y)));
const luma = ([r, g, b]) => 0.3 * r + 0.59 * g + 0.11 * b;

test("a picture against itself: every line close, no gap, nothing warned", () => {
  const look = maps.lookAgainst(maps.lookOf(scene), maps.lookOf(scene));
  sure(!look.gaps.length && !look.warnings.length && !look.failures.length, look.said.join(" | "));
  sure(look.said.length === 5 && look.said.every((line) => /^(brightness|contrast|coloured|warmth|colours): close/.test(line)), look.said.join(" | ")); // prettier-ignore
  const teal = maps.lookOf(scene).palette.find((c) => c.name === "teal");
  sure(teal && teal.share > 0.15 && teal.rgb[2] > teal.rgb[0], JSON.stringify(maps.lookOf(scene).palette));
});

test("against its darker copy: brightness alone", () => {
  const look = maps.lookAgainst(maps.lookOf(map(scene, (rgb) => rgb.map((v) => v * 0.5))), maps.lookOf(scene));
  sure(look.gaps.join() === "brightness", look.said.join(" | "));
  sure(/^brightness: the view is darker: 0\.\d\d \(near black \d+%, near white 0%\) against the reference's 0\.\d\d/.test(look.said[0]), look.said[0]); // prettier-ignore
});

test("against its grey copy: colour and warmth, not brightness or contrast", () => {
  const grey = maps.lookOf(map(scene, (rgb) => [luma(rgb), luma(rgb), luma(rgb)]));
  const look = maps.lookAgainst(grey, maps.lookOf(scene));
  sure(look.gaps.join() === "coloured,warmth,colours", look.said.join(" | "));
  sure(grey.coloured === 0 && /^colours: the reference is \d+% (teal|orange), the view 0%/.test(look.said[4]), look.said[4]);
  sure(/^coloured: the view is greyer: 0% against the reference's \d+%$/.test(look.said[2]), look.said[2]);
});

test("evenly lit against pools of light and dark of the same mean: contrast alone", () => {
  const even = picture(() => [0.4, 0.4, 0.4]);
  const pools = picture((x, y) => (Math.hypot(((x % 40) - 20) / 20, ((y % 45) - 22.5) / 22.5) < 0.8 ? [0.7, 0.7, 0.7] : [0.18, 0.18, 0.18])); // prettier-ignore
  const [a, b] = [maps.lookOf(even), maps.lookOf(pools)];
  sure(Math.abs(a.brightness - b.brightness) < 0.06 && a.contrast === 0 && b.contrast > 0.5, JSON.stringify([a, b]));
  const look = maps.lookAgainst(a, b);
  sure(look.gaps.join() === "contrast" && /^contrast: the view is more evenly lit \(fewer pools of light and dark\): 0\.00 against the reference's 0\.\d\d$/.test(look.said[1]), look.said.join(" | ")); // prettier-ignore
});

test("a HUD left out of the reference by a box: its numbers as if it were not there", () => {
  const box = [100, 0, 160, 20];
  const hud = picture((x, y) => (x >= box[0] && y < box[3] ? [1, 1, 1] : pixel(scene, x, y)));
  const [plain, counted, ignored] = [maps.lookOf(scene), maps.lookOf(hud), maps.lookOf(hud, { ignore: [box] })];
  sure(counted.white > 0.05 && counted.brightness > plain.brightness, JSON.stringify(counted));
  sure(ignored.white === 0 && ignored.pixels === W * H - 60 * 20 && Math.abs(ignored.brightness - plain.brightness) < 0.02, JSON.stringify(ignored)); // prettier-ignore
  sure(maps.lookAgainst(ignored, plain).gaps.length === 0, maps.lookAgainst(ignored, plain).said.join(" | "));
});

test("the sheet: the two at one size side by side, the measures under them", () => {
  const big = { width: W * 2, height: H * 2, rgba: new Uint8Array(W * H * 16).fill(200) };
  const sheet = maps.lookSheet(scene, big);
  sure(sheet.width === 2 * W && sheet.height > H + 100, `${sheet.width}x${sheet.height}`);
});

test("smak map-look: the sheet written, five lines said, --json, a reference that is not a picture refused", () => {
  const ref = join(tmp, "look-ref.png");
  writeFileSync(ref, png(W, H, scene.rgba));
  const bsp = join(HERE, "fixtures", "tworooms.bsp");
  const out = join(tmp, "look.png");
  const run = runRefused(SMAK_CLI, "map-look", bsp, "--ref", ref, "-o", out, "--ignore", "0,0,10,10");
  const said = run.out.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^(brightness|contrast|coloured|warmth|colours): /.test(line)); // prettier-ignore
  sure(run.code === 0 && said.length === 5, `${run.code}: ${run.out}${run.err}`);
  const sheet = unpng(readFileSync(out));
  sure(sheet.width === 1280 && sheet.height > 360, `${sheet.width}x${sheet.height}`);
  const json = JSON.parse(runRefused(SMAK_CLI, "map-look", bsp, "--ref", ref, "-o", out, "--json").out);
  sure(json.said.length === 5 && json.measures.reference.pixels === W * H && json.measures.view.pixels === 640 * 360, JSON.stringify(json.measures.view.pixels)); // prettier-ignore
  const refused = runRefused(SMAK_CLI, "map-look", bsp, "--ref", bsp, "-o", out);
  sure(refused.code !== 0, refused.out);
});
