// Sprites' layers past the first round: a glow with no hard cut, a flare's wedges, blur, haze and rays, a flat
// beam with streaks that still tiles, a fire with no cone and with tongues, the blast and muzzle ramps, a lit
// billow and a cluster of blobs; and a sprite measured against a reference sheet (measures, never pixels).
// Every new field left out builds what it built before.
import { writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { writeSpr } from "../src/sprite/spr.mjs";
import * as smak from "../src/index.mjs";
import { framesOf, RAMP_NAMES, LAYER_KINDS } from "../src/sprite/effects.mjs";
import { measureSprite, measureSheet, shapeOverlap } from "../src/sprite/measure.mjs";
import { sheetOf } from "../src/sprite/draw.mjs";
import { buildSpriteSpec, validateSpriteSpec } from "../src/sprite/spec.mjs";
import { test, sure, near, tmp, runSmak, runRefused, SMAK_CLI } from "./helper.mjs";

const lum = (f, x, y) => {
  const i = (y * f.width + x) * 3;
  return 0.299 * f.rgb[i] + 0.587 * f.rgb[i + 1] + 0.114 * f.rgb[i + 2];
};
const one = (layer, size = [64, 64], more = {}) => framesOf({ size, frames: 1, layers: [layer], ...more })[0];
const same = (a, b) => a.rgb.every((v, i) => v === b.rgb[i]) && a.a.every((v, i) => v === b.a[i]);
const spec = (sprite) => ({ spec: "smak.sprite/1", sprites: [{ name: "sprites/t.spr", size: [32, 32], ...sprite }] });

test("sprite layers: every new field at its default builds what the layer built before", () => {
  const flare = { kind: "flare", streaks: [{ angle: 30, length: 0.8, width: 0.03 }] };
  sure(same(one(flare), one({ ...flare, taper: 0, blur: 0, haze: 0 })), "a flare with taper, blur and haze at 0");
  sure(same(one({ kind: "glow" }), one({ kind: "glow", falloff: "smooth" })), "a glow's smooth falloff");
  const fire = { kind: "fire" };
  const loop = (layer) => framesOf({ size: [32, 64], frames: 4, loop: true, layers: [layer] });
  sure(loop(fire).every((f, n) => same(f, loop({ ...fire, taper: 0.65, tongues: 0 })[n])), "a fire's taper of 0.65 and no tongues");
  sure(same(one({ kind: "beam" }, [32, 64]), one({ kind: "beam", profile: "round", streaks: 0 }, [32, 64])), "a round beam with no streaks");
  sure(["blast", "muzzle"].every((r) => RAMP_NAMES.includes(r)) && ["billow", "blobs"].every((k) => LAYER_KINDS.includes(k)), `${RAMP_NAMES} ${LAYER_KINDS}`);
});

test("a glow with a power falloff has no hard cut: lit past its radius, eased to nothing at its reach", () => {
  const smooth = one({ kind: "glow", radius: 0.5, core: 0.2 }, [64, 64], { edge: 0 });
  const power = one({ kind: "glow", radius: 0.5, core: 0.2, falloff: "power" }, [64, 64], { edge: 0 });
  // 0.6 out from the middle along x: past the smooth glow's radius
  const x = 32 + Math.round(0.6 * 32);
  sure(lum(smooth, x, 32) === 0 && lum(power, x, 32) > 0.05, `at 0.6: smooth ${lum(smooth, x, 32)}, power ${lum(power, x, 32)}`);
  const short = one({ kind: "glow", core: 0.2, falloff: "power", reach: 0.5 }, [64, 64], { edge: 0 });
  sure(lum(short, x, 32) === 0, `reach 0.5: nothing at 0.6 (${lum(short, x, 32)})`);
});

test("a flare's streaks: a taper makes a wedge, blur spreads without losing light, a half streak has no tail, rays are many", () => {
  const arm = (more) => one({ kind: "flare", core: 0.01, streaks: [{ angle: 0, length: 0.9, width: 0.03, ...more }] }, [64, 64], { edge: 0 });
  // the width lit across the arm at a point: rows over a tenth of the peak
  const width = (f, x) => {
    let n = 0;
    for (let y = 0; y < 64; y++) if (lum(f, x, y) > 0.1) n++;
    return n;
  };
  const plain = arm({});
  const wedge = arm({ taper: 3 });
  sure(width(wedge, 36) > width(plain, 36) + 2 && width(wedge, 36) > width(wedge, 56), `wedge near the core ${width(wedge, 36)}, near its tip ${width(wedge, 56)}, plain ${width(plain, 36)}`);
  const across = (f, x) => Array.from({ length: 64 }, (_, y) => lum(f, x, y)).reduce((s, v) => s + v, 0);
  const blurred = arm({ blur: 0.06 });
  near(across(blurred, 44), across(plain, 44), 0.25 * across(plain, 44), "the light across a blurred arm");
  sure(width(blurred, 44) > width(plain, 44), `blurred wider: ${width(blurred, 44)} against ${width(plain, 44)}`);
  const hazy = arm({ haze: 0.2 });
  sure(lum(hazy, 44, 24) > lum(plain, 44, 24), "a haze lights beside the arm");
  const half = arm({ half: true });
  sure(lum(half, 12, 32) < 0.01 && lum(half, 52, 32) > 0.05, `a half streak: behind ${lum(half, 12, 32)}, ahead ${lum(half, 52, 32)}`);
  // rays: the ring at 0.35 crossed by many lit spokes
  const rayed = one({ kind: "flare", core: 0.01, streaks: [], rays: { count: 40, length: 0.9, jitter: 0.3 } }, [128, 128], { edge: 0 });
  let spokes = 0;
  let was = false;
  for (let k = 0; k < 720; k++) {
    const a = (k / 720) * 2 * Math.PI;
    const on = lum(rayed, Math.round(64 + 22 * Math.cos(a)), Math.round(64 + 22 * Math.sin(a))) > 0.03;
    if (on && !was) spokes++;
    was = on;
  }
  sure(spokes >= 25, `${spokes} rays crossed at 0.35`);
});

test("a flat beam with streaks: lit across its core, mottled across and not along, its ends still meeting", () => {
  const f = one({ kind: "beam", profile: "flat", core: 0.5, noise: 0, streaks: 1, colour: [1, 1, 1] }, [32, 64], { use: "beam", edge: 0 });
  const flat = one({ kind: "beam", profile: "flat", core: 0.5, noise: 0, colour: [1, 1, 1] }, [32, 64], { use: "beam", edge: 0 });
  sure([12, 16, 20].every((x) => lum(flat, x, 30) > 0.99), "flat across its core");
  let acrossStep = 0;
  let alongStep = 0;
  for (let y = 0; y < 63; y++) for (let x = 8; x < 23; x++) {
    acrossStep += Math.abs(lum(f, x + 1, y) - lum(f, x, y));
    alongStep += Math.abs(lum(f, x, y + 1) - lum(f, x, y));
  }
  sure(acrossStep > 2 * alongStep, `streaks change across (${acrossStep.toFixed(1)}) more than along (${alongStep.toFixed(1)})`);
  // the last row and the first meet as two rows next to each other do
  let seam = 0;
  for (let x = 0; x < 32; x++) seam += Math.abs(lum(f, x, 63) - lum(f, x, 0));
  sure(seam <= (alongStep / 63) * 2.5, `the ends meet: ${seam.toFixed(2)} against a step of ${(alongStep / 63).toFixed(2)}`);
});

test("a fire with no taper is as wide at its top as at its foot; tongues part it into licks; its loop still closes", () => {
  const litAcross = (f, y) => Array.from({ length: f.width }, (_, x) => lum(f, x, y)).filter((v) => v > 0.03).length;
  const fire = (more) => framesOf({ size: [32, 96], frames: 8, loop: true, layers: [{ kind: "fire", width: 0.9, ...more }], edge: 0 });
  const cone = fire({})[0];
  const straight = fire({ taper: 0 })[0];
  sure(litAcross(straight, 40) > litAcross(cone, 40), `at two fifths up: straight ${litAcross(straight, 40)}, cone ${litAcross(cone, 40)}`);
  const licks = fire({ taper: 0, tongues: 1 });
  const dark = (frames) => frames.reduce((s, f) => s + f.rgb.filter((v, i) => i % 3 === 0 && v < 0.03).length, 0);
  sure(dark(licks) > dark(fire({ taper: 0 })), "tongues leave dark between them");
  const bytes = buildSpriteSpec({ spec: "smak.sprite/1", name: "sprites/f.spr", size: [32, 96], frames: 12, loop: true, class: "fire loop", layers: [{ kind: "fire", taper: 0, tongues: 0.6 }] });
  sure(bytes.report.ok, bytes.report.faults.join(" | "));
  const m = measureSprite(smak.maps.readSpr(bytes.files[0].bytes), { loop: true });
  sure(m.wrap < 2.5, `the loop wraps at ${m.wrap} of its mean step`);
});

test("a billow is a lit cloud: grows, burns white early and cools through the blast ramp, lit from the top left, ends dark", () => {
  const frames = framesOf({ size: [64, 64], frames: 12, layers: [{ kind: "billow", spread: 0.4, dissolve: 0, env: { decay: 0.3 } }] });
  const mean = (f) => f.rgb.reduce((s, v) => s + v, 0) / f.rgb.length;
  const lit = (f) => f.a.filter((v) => v > 0.1).length;
  sure(lit(frames[6]) > 2 * lit(frames[0]), `it grows: ${lit(frames[0])} to ${lit(frames[6])} pixels`);
  // white early (blue as high as red), tan late (blue well under red)
  const tint = (f) => {
    let r = 0;
    let b = 0;
    for (let i = 0; i < f.rgb.length; i += 3) if (f.a[i / 3] > 0.5) (r += f.rgb[i]), (b += f.rgb[i + 2]);
    return b / (r || 1);
  };
  sure(tint(frames[1]) > 0.8 && tint(frames[8]) < 0.6, `blue over red: early ${tint(frames[1]).toFixed(2)}, late ${tint(frames[8]).toFixed(2)}`);
  sure(mean(frames.at(-1)) < 0.1 * Math.max(...frames.map(mean)), "it ends dark");
  // the light: the cloud's upper left brighter than its lower right
  const f = frames[8];
  const quarter = (x0, y0) => {
    let s = 0;
    let n = 0;
    for (let y = y0; y < y0 + 16; y++) for (let x = x0; x < x0 + 16; x++) if (f.a[y * 64 + x] > 0.5) (s += lum(f, x, y)), n++;
    return s / (n || 1);
  };
  sure(quarter(18, 18) > quarter(30, 30), `upper left ${quarter(18, 18).toFixed(2)}, lower right ${quarter(30, 30).toFixed(2)}`);
  // under index alpha a puff keeps its shading in its coverage
  const puff = buildSpriteSpec(spec({ size: [32, 48], frames: 8, format: "index alpha", class: "smoke puff", layers: [{ kind: "billow", hot: 0, size: 0.3, spread: 0.3, env: { decay: 0.4 } }] }));
  const shown = smak.maps.readSpr(puff.files[0].bytes).frames[4].pixels.filter((p) => p > 40);
  sure(new Set(shown).size > 20, `${new Set(shown).size} levels of coverage inside the puff`);
});

test("blobs are placed afresh every frame: they flicker as sparks do and keep a dark border", () => {
  const r = buildSpriteSpec(spec({ frames: 10, class: "sparks", layers: [{ kind: "blobs", ramp: "blue" }] }));
  const m = measureSprite(smak.maps.readSpr(r.files[0].bytes));
  sure(m.jitter > 1.5 && m.border.mean < 0.01, `jitter ${m.jitter}, border ${m.border.mean}`);
});

test("a sprite against its reference sheet: itself measures the same; another is told how far off; a bad one is refused", () => {
  const sprite = { size: [32, 64], frames: 6, loop: true, class: "fire loop", layers: [{ kind: "fire" }] };
  const made = buildSpriteSpec(spec(sprite));
  const back = smak.maps.readSpr(made.files[0].bytes);
  const file = join(tmp, "reference-sheet.png");
  const picture = sheetOf(back, { cols: 8, cell: 128 });
  writeFileSync(file, smak.png(picture.width, picture.height, picture.rgba));
  // the sheet's measures are the sprite's own
  const read = measureSheet(picture, { size: [32, 64] });
  const own = measureSprite(back, { loop: true });
  sure(read.frames === back.frames.length && Math.abs(read.dark - own.dark) <= 0.05, `sheet ${JSON.stringify(read)}, sprite dark ${own.dark}`);
  const again = buildSpriteSpec(spec({ ...sprite, reference: file }));
  const m = again.report.reference["sprites/t.spr"];
  sure(m.colourDeltaE === 0 && m.dark[0] === m.dark[1] && m.frames[0] === m.frames[1] && again.report.ok, JSON.stringify(m));
  sure(again.files[0].bytes.equals(made.files[0].bytes), "a reference changes nothing that is made");
  const other = buildSpriteSpec(spec({ ...sprite, reference: { picture: file, cell: 128 }, layers: [{ kind: "fire", ramp: "blue", width: 0.2 }] }));
  const off = other.report.reference["sprites/t.spr"];
  sure(off.colourDeltaE > 15 && other.report.warnings.some((n) => /colour is .* from its reference's.*build again/.test(n)) && other.report.warnings.some((n) => /more of it is dark/.test(n)), `${JSON.stringify(off)} ${other.report.warnings.join(" | ")}`);
  const missing = buildSpriteSpec(spec({ ...sprite, reference: join(tmp, "no-such.png") }));
  sure(missing.report.warnings.some((w) => /could not be read/.test(w)) && missing.files.length === 1, missing.report.warnings.join(" | "));
  const wrongGrid = buildSpriteSpec(spec({ ...sprite, size: [48, 48], reference: file }));
  sure(wrongGrid.report.warnings.some((w) => /not a grid of/.test(w)), wrongGrid.report.warnings.join(" | "));
  sure(validateSpriteSpec(spec({ ...sprite, reference: 3 })).errors.some((e) => /reference/.test(e)), "a reference that is no path");
});

test("shapeOverlap: a sprite's shape against its reference's at its edge, body and core", () => {
  const disc = (r, core) => Float32Array.from({ length: 32 * 32 }, (_, i) => {
    const d = Math.hypot((i % 32) - 15.5, Math.floor(i / 32) - 15.5);
    return d < r ? (d < core ? 0.9 : 0.2) : 0;
  });
  const same = shapeOverlap([disc(12, 4)], [disc(12, 4)]);
  sure(same.mean === 1 && same.levels.every((v) => v === 1), JSON.stringify(same));
  const wideCore = shapeOverlap([disc(12, 4)], [disc(12, 10)]);
  sure(wideCore.levels[0] === 1 && wideCore.levels[2] < 0.3 && wideCore.mean < 0.8, `a core too wide shows at the core: ${JSON.stringify(wideCore)}`);
});

test("a colour of 0 to 255 is refused, in a sprite's layers and ramps, with what it would be", () => {
  const { errors } = validateSpriteSpec({ spec: "smak.sprite/1", sprites: [{ name: "sprites/g.spr", size: [64, 64], colour: [1, 0.5, 0.2], layers: [{ kind: "glow", colour: [255, 255, 255] }, { kind: "fire", ramp: [[0, [0, 0, 0]], [1, [255, 128, 0]]] }] }] });
  sure(errors.some((e) => /layers\[0\]\.colour: \[r, g, b\] from 0 to 1, not \[255,255,255\]: as 0 to 255 it is \[1,1,1\]/.test(e)) && errors.some((e) => /layers\[1\]\.ramp\[1\]/.test(e)) && errors.length === 2, errors.join(" | "));
});

test("a layer masked by its reference: the reference's lit area frame by frame, its colours never taken", () => {
  // the reference: a small glow off to one side; ours: one broad glow over the whole frame, masked by it
  const ref = buildSpriteSpec({ spec: "smak.sprite/1", name: "sprites/ref.spr", size: [32, 32], frames: 4, layers: [{ kind: "glow", radius: 0.35, at: [0.4, 0.3], colour: [0.2, 0.4, 1] }] });
  const sheet = sheetOf(smak.maps.readSpr(ref.files[0].bytes), { cols: 8, cell: 128 });
  const file = join(tmp, "ref-sheet.png");
  writeFileSync(file, smak.png(sheet.width, sheet.height, sheet.rgba));
  const spec = (mask) => ({ spec: "smak.sprite/1", name: "sprites/ours.spr", size: [32, 32], frames: 4, reference: file, layers: [{ kind: "glow", radius: 1.6, core: 0.9, colour: [1, 0.6, 0.2], ...(mask ? { mask: "reference" } : {}) }] });
  // the outline's overlap: the faint edge's level, the first of the three the measure gives
  const overlap = (r) => Number(/the share of pixels lit in both: ([\d.]+)/.exec(r.report.facts.find((f) => /its shape against its reference's/.test(f)))?.[1]);
  const plain = buildSpriteSpec(spec(false));
  const masked = buildSpriteSpec(spec(true));
  sure(masked.report.facts.some((f) => /1 layer\(s\) masked by the reference's lit area, its 4 frames over this one's 4: its outline, not its colours/.test(f)), masked.report.facts.join(" | "));
  sure(overlap(masked) >= 0.8 && overlap(masked) > overlap(plain) + 0.2, `masked ${overlap(masked)}, plain ${overlap(plain)}`);
  // its colour is its own: orange, not the reference's blue
  const c = smak.maps.readSpr(masked.files[0].bytes);
  const lit = c.frames[0].pixels.reduce((best, v, i) => (v > c.frames[0].pixels[best] ? i : best), 0);
  const [r, , b] = c.palette.subarray(c.frames[0].pixels[lit] * 3, c.frames[0].pixels[lit] * 3 + 3);
  sure(r > b, `its brightest pixel ${r} red against ${b} blue`);
  const refused = validateSpriteSpec({ ...spec(true), reference: undefined });
  sure(refused.errors.some((e) => /mask: the sprite has no reference/.test(e)), refused.errors.join(" | "));
});

test("a glow of one colour is a ramp of 255 steps, and a middle hotter than its reference's is told", () => {
  // a white glow over a large frame: the falloff in many steps, none of its faint levels merged into bands
  const glow = buildSpriteSpec({ spec: "smak.sprite/1", name: "sprites/white.spr", size: [64, 64], frames: 1, layers: [{ kind: "glow", radius: 1.1, core: 0.24, colour: [1, 1, 1] }] });
  const s = smak.maps.readSpr(glow.files[0].bytes);
  const used = new Set(s.frames[0].pixels).size;
  sure(used > 100, `${used} colours used`);
  for (let k = 1; k < 256; k++) sure(s.palette[k * 3] === k && s.palette[k * 3 + 2] === k, `entry ${k} is ${s.palette.subarray(k * 3, k * 3 + 3)}`);
  // against a reference with a small core: the broad core is told
  const ref = buildSpriteSpec({ spec: "smak.sprite/1", name: "sprites/ref.spr", size: [64, 64], frames: 1, layers: [{ kind: "glow", radius: 1.1, core: 0.08, colour: [0.9, 0.9, 0.9] }] });
  const sheet = sheetOf(smak.maps.readSpr(ref.files[0].bytes), { cols: 8, cell: 128 });
  const file = join(tmp, "hot-ref.png");
  writeFileSync(file, smak.png(sheet.width, sheet.height, sheet.rgba));
  const hot = buildSpriteSpec({ spec: "smak.sprite/1", name: "sprites/hot.spr", size: [64, 64], frames: 1, reference: file, layers: [{ kind: "glow", radius: 1.1, core: 0.3, colour: [1, 1, 1] }] });
  sure(hot.report.warnings.some((w) => /its middle is hotter than its reference's/.test(w)), hot.report.warnings.join(" | "));
  const same = buildSpriteSpec({ spec: "smak.sprite/1", name: "sprites/same.spr", size: [64, 64], frames: 1, reference: file, layers: [{ kind: "glow", radius: 1.1, core: 0.08, colour: [0.9, 0.9, 0.9] }] });
  sure(!same.report.warnings.some((w) => /its middle is/.test(w)), same.report.warnings.join(" | "));
  // and the reverse: a small core against a reference with a broad one
  const broad = buildSpriteSpec({ spec: "smak.sprite/1", name: "sprites/broad.spr", size: [64, 64], frames: 1, layers: [{ kind: "glow", radius: 1.1, core: 0.3, colour: [1, 1, 1] }] });
  const broadSheet = sheetOf(smak.maps.readSpr(broad.files[0].bytes), { cols: 8, cell: 128 });
  const broadFile = join(tmp, "broad-ref.png");
  writeFileSync(broadFile, smak.png(broadSheet.width, broadSheet.height, broadSheet.rgba));
  const small = buildSpriteSpec({ spec: "smak.sprite/1", name: "sprites/small.spr", size: [64, 64], frames: 1, reference: broadFile, layers: [{ kind: "glow", radius: 1.1, core: 0.08, colour: [1, 1, 1] }] });
  sure(small.report.warnings.some((w) => /its middle is smaller than its reference's/.test(w)), small.report.warnings.join(" | "));
});

test("against a reference: a late brightest frame and a halo short of the border are told", () => {
  const ref = buildSpriteSpec({ spec: "smak.sprite/1", name: "sprites/ref.spr", size: [32, 32], frames: 10, layers: [{ kind: "glow", radius: 2.5, core: 0.9, colour: [0.5, 0.7, 1], env: { attack: 0.05, decay: 0.9 } }] });
  const sheet = sheetOf(smak.maps.readSpr(ref.files[0].bytes), { cols: 8, cell: 128 });
  const file = join(tmp, "env-ref.png");
  writeFileSync(file, smak.png(sheet.width, sheet.height, sheet.rgba));
  const late = buildSpriteSpec({ spec: "smak.sprite/1", name: "sprites/late.spr", size: [32, 32], frames: 10, reference: file, layers: [{ kind: "glow", radius: 0.6, core: 0.15, colour: [0.5, 0.7, 1], env: { attack: 0.5, decay: 0.5 } }] });
  sure(late.report.warnings.some((w) => /its brightest frame comes at [\d.]+ of its play, its reference's at/.test(w)), late.report.warnings.join(" | "));
  sure(late.report.warnings.some((w) => /falls off too soon/.test(w)), late.report.warnings.join(" | "));
  // the curve, frame by frame: a slow growth to the same light is told with its frames; the reference's own is not
  sure(late.report.warnings.some((w) => /its light over its play parts from its reference's by [\d.]+ a frame on average .*at the reference's frames \d+ to \d+ it is fainter/.test(w)), late.report.warnings.join(" | "));
  const same = buildSpriteSpec({ spec: "smak.sprite/1", name: "sprites/same.spr", size: [32, 32], frames: 10, reference: file, layers: [{ kind: "glow", radius: 2.5, core: 0.9, colour: [0.5, 0.7, 1], env: { attack: 0.05, decay: 0.9 } }] });
  sure(!same.report.warnings.some((w) => /parts from its reference's/.test(w)), same.report.warnings.join(" | "));
});

test("a loop with a reference starts at the frame where its light over the loop follows the reference's", () => {
  const spec = { spec: "smak.sprite/1", name: "sprites/flame.spr", size: [32, 64], frames: 12, loop: true, layers: [{ kind: "fire", width: 0.8 }, { kind: "glow", radius: 0.5, core: 0.2, colour: [1, 0.6, 0.2], env: { attack: 0.3, decay: 0.3 } }] };
  const plain = smak.maps.readSpr(buildSpriteSpec(spec).files[0].bytes);
  // the reference: the same loop cut open five frames on (and its first again at the end)
  const cycle = plain.frames.slice(0, -1);
  const turned = { ...plain, frames: [...cycle.slice(5), ...cycle.slice(0, 5), cycle[5]] };
  const sheet = sheetOf(turned, { cols: 8, cell: 128 });
  const file = join(tmp, "loop-ref.png");
  writeFileSync(file, smak.png(sheet.width, sheet.height, sheet.rgba));
  const built = buildSpriteSpec({ ...spec, reference: file });
  sure(built.report.facts.some((f) => /its loop starts at its frame 5,/.test(f)), built.report.facts.filter((f) => /loop/.test(f)).join(" | "));
  // the same flame made a one-shot against a reference that is still lit at its end: told to loop
  const once = buildSpriteSpec({ ...spec, loop: false, reference: file });
  sure(once.report.warnings.some((w) => /its reference's last frame is still [\d.]+ of its brightest, as a loop's is .*make it loop: true/.test(w)), once.report.warnings.join(" | "));
  sure(!built.report.warnings.some((w) => /make it loop/.test(w)), built.report.warnings.join(" | "));
});

test("ramp reference: a layer wears the reference's own colour at each brightness", () => {
  const ref = buildSpriteSpec({ spec: "smak.sprite/1", name: "sprites/ref.spr", size: [32, 32], frames: 1, layers: [{ kind: "glow", radius: 1.2, core: 0.3, ramp: [[0, [0, 0, 0]], [0.5, [0.6, 0.3, 0.1]], [1, [1, 0.9, 0.8]]] }] });
  const sheet = sheetOf(smak.maps.readSpr(ref.files[0].bytes), { cols: 8, cell: 128 });
  const file = join(tmp, "ramp-ref.png");
  writeFileSync(file, smak.png(sheet.width, sheet.height, sheet.rgba));
  const spec = (ramp) => ({ spec: "smak.sprite/1", name: "sprites/ours.spr", size: [32, 32], frames: 1, reference: file, layers: [{ kind: "glow", radius: 1.2, core: 0.3, ramp }] });
  const violet = buildSpriteSpec(spec([[0, [0, 0, 0]], [0.5, [0.4, 0.2, 0.6]], [1, [1, 0.9, 1]]]));
  const taken = buildSpriteSpec(spec("reference"));
  const deltaOf = (r) => Number(/mean colour delta E ([\d.]+)/.exec(r.report.facts.find((f) => /delta E/.test(f)))[1]);
  sure(taken.report.facts.some((f) => /ramp "reference": the reference.s own colour at each brightness/.test(f)), taken.report.facts.join(" | "));
  sure(deltaOf(taken) < 4 && deltaOf(taken) < deltaOf(violet), `taken ${deltaOf(taken)}, violet ${deltaOf(violet)}`);
  sure(validateSpriteSpec({ ...spec("reference"), reference: undefined }).errors.some((e) => /ramp: "reference" takes the reference's colours/.test(e)), "no reference, refused");
});

test("a ramp's stops in any order make the same colours", () => {
  const up = [[0, [0, 0, 0]], [0.5, [0.6, 0.3, 0.1]], [1, [1, 0.9, 0.8]]];
  const a = one({ kind: "glow", radius: 1, core: 0.3, ramp: up });
  const b = one({ kind: "glow", radius: 1, core: 0.3, ramp: [...up].reverse() });
  sure(same(a, b), "reversed stops, other colours");
});

test("an envelope's start lights the first frame; a reference's ramp is read frame by frame", () => {
  const dark = framesOf({ size: [16, 16], frames: 6, layers: [{ kind: "glow", env: { attack: 0.5 } }] });
  const lit = framesOf({ size: [16, 16], frames: 6, layers: [{ kind: "glow", env: { attack: 0.5, start: 0.2 } }] });
  const sum = (f) => f.rgb.reduce((a, b) => a + b, 0);
  sure(sum(dark[0]) < 1e-6 && sum(lit[0]) > 0.5, `first frames ${sum(dark[0])} and ${sum(lit[0])}`);
  sure(Math.abs(sum(dark[3]) - sum(lit[3])) < 1e-3, "the peak is where it was");
  // a reference white early and orange late: the copy's late frame is orange too
  const ref = buildSpriteSpec({ spec: "smak.sprite/1", name: "sprites/ref.spr", size: [32, 32], frames: 8, layers: [{ kind: "glow", radius: 1.2, core: 0.3, ramp: { frames: [[[0, [0, 0, 0]], [1, [1, 1, 1]]], [[0, [0, 0, 0]], [1, [1, 0.5, 0.1]]]] } }] });
  const sheet = sheetOf(smak.maps.readSpr(ref.files[0].bytes), { cols: 8, cell: 128 });
  const file = join(tmp, "cooling-ref.png");
  writeFileSync(file, smak.png(sheet.width, sheet.height, sheet.rgba));
  const ours = buildSpriteSpec({ spec: "smak.sprite/1", name: "sprites/ours.spr", size: [32, 32], frames: 8, reference: file, layers: [{ kind: "glow", radius: 1.2, core: 0.3, ramp: "reference" }] });
  sure(ours.report.facts.some((f) => /frame by frame over its 8 frames/.test(f)), ours.report.facts.join(" | "));
  const spr = smak.maps.readSpr(ours.files[0].bytes);
  const centre = (f) => { const i = f.pixels[16 * 32 + 16]; return [...spr.palette.subarray(i * 3, i * 3 + 3)]; };
  const [first, last] = [centre(spr.frames[0]), centre(spr.frames[7])];
  sure(first[2] > 200 && last[2] < 120 && last[0] > 200, `first ${first}, last ${last}`);
});

// from test/46-specs.mjs of stevenlafl/smak: the writer against the reader, and Half-Life's own sprites where it is
// installed (Steam's folder, or SMAK_HALF_LIFE)
test("a sprite file written is the file read: Half-Life's own, where the game is there, byte for byte", () => {
  // a group and a single frame, written and read back
  const frame = (v) => ({ left: -4, up: 4, width: 8, height: 8, pixels: new Uint8Array(64).fill(v) });
  const bytes = writeSpr({ type: "oriented", format: "alpha test", palette: new Uint8Array(768).fill(7), frames: [frame(1), frame(2), frame(3)], groups: [{ first: 1, count: 2, ends: [0.1, 0.25] }] }); // prettier-ignore
  const back = smak.maps.readSpr(bytes);
  sure(back.type === "oriented" && back.frames.length === 3 && back.groups[0].count === 2 && Math.abs(back.groups[0].ends[1] - 0.25) < 1e-6 && Buffer.compare(writeSpr(back), bytes) === 0, JSON.stringify(back.groups)); // prettier-ignore
  const game = [process.env.SMAK_HALF_LIFE, join(homedir(), ".steam/steam/steamapps/common/Half-Life"), "C:/Program Files (x86)/Steam/steamapps/common/Half-Life"]
    .filter(Boolean)
    .map((folder) => join(folder, "valve", "sprites"))
    .find((folder) => existsSync(folder)); // prettier-ignore
  if (!game) return;
  const files = readdirSync(game).filter((f) => f.endsWith(".spr"));
  const differ = files.filter((f) => Buffer.compare(writeSpr(smak.maps.readSpr(readFileSync(join(game, f)))), readFileSync(join(game, f))) !== 0); // prettier-ignore
  sure(files.length && !differ.length, `${differ.length} of ${files.length} differ: ${differ.slice(0, 5)}`);
});

test("smak sprite: a spec's sprites written under the folder with their sheets, the report said; a spec with errors refused", () => {
  const folder = join(tmp, "sprite-command");
  const spec = join(tmp, "torch.sprite.json");
  writeFileSync(spec, JSON.stringify({ spec: "smak.sprite/1", sprites: [{ name: "sprites/torch.spr", class: "fire loop", size: [32, 64], frames: 8, loop: true, fps: 10, origin: "bottom", layers: [{ kind: "fire" }] }] })); // prettier-ignore
  const said = runSmak("sprite", spec, "-o", folder);
  const torch = smak.maps.readSpr(readFileSync(join(folder, "sprites", "torch.spr")));
  sure(torch.frames.length === 9 && /against Half-Life's fire loop/.test(said) && /1 sprites built, and every check passed/.test(said), said);
  sure(["-sheet.png", "-animated.png"].every((end) => existsSync(join(folder, "sprites", `torch${end}`))), "its pictures beside it");
  writeFileSync(spec, JSON.stringify({ spec: "smak.sprite/1", sprites: [{ name: "sprites/bad.spr", size: [30, 64], layers: [{ kind: "glow", colour: [255, 0, 0] }] }] })); // prettier-ignore
  const refused = runRefused(SMAK_CLI, "sprite", spec, "-o", folder);
  sure(refused.code === 1 && /ERROR/.test(refused.out) && !existsSync(join(folder, "sprites", "bad.spr")), refused.out + refused.err);
});
