// A spec of a sprite (.spr): layers of effects made by rule, quantised to one palette as its format reads it,
// written, read back, measured against Half-Life's own of its kind, and drawn (docs/SPRITES.md).
//
//   validateSpriteSpec(spec) -> { errors, warnings }
//   buildSpriteSpec(spec, { readPicture }) -> { report, files: [{ name, bytes, sheet, animation }] }
//
// One sprite, or a set: `sprites: [...]` with the spec's own fields as their defaults. A sprite that names a
// `reference` (a contact sheet of the one it reproduces) is measured against it as the judge measures: mean
// colour, dark share, border, frame count. Measures only: no pixel of the reference goes into a frame.
import { readFileSync } from "node:fs";
import { framesOf, LAYER_KINDS, RAMP_NAMES } from "./effects.mjs";
import { quantiseFrames } from "./palette.mjs";
import { writeSpr } from "./spr.mjs";
import { readSpr, SPRITE_TYPES, SPRITE_FORMATS } from "../maps/sprites.mjs";
import { measureSprite, measureSheet, shapeOverlap, SHAPE_LEVELS, rampOfSheet, rampOfFrames, againstClass, SPRITE_CLASSES } from "./measure.mjs";
import { sheetOf, animationOf } from "./draw.mjs";
import { png, unpicture } from "../image.mjs";

/**
 * What is wrong with a colour given as numbers: three, each 0 to 1. Null when nothing is. A colour of 0 to 255
 * (the way a picture program writes one) is told so: taken as it is, it paints 255 times too bright.
 */
function rgbFault(given) {
  if (!Array.isArray(given) || given.length !== 3 || !given.every((v) => typeof v === "number" && Number.isFinite(v))) return "[r, g, b], three numbers from 0 to 1";
  if (given.some((v) => v < 0)) return `[r, g, b] from 0 to 1, not ${JSON.stringify(given)}`;
  if (given.some((v) => v > 1))
    return `[r, g, b] from 0 to 1, not ${JSON.stringify(given)}: ${given.every((v) => v <= 255) ? `as 0 to 255 it is ${JSON.stringify(given.map((v) => Math.round((v / 255) * 1000) / 1000))}` : "each 1 at most"}`;
  return null;
}

export const SPRITE_SPEC = "smak.sprite/1";
const FIELDS = ["spec", "name", "use", "class", "size", "frames", "loop", "fps", "type", "format", "origin", "seed", "layers", "finish", "colour", "reference", "sprites", "note"];
const USES = ["env_sprite", "env_glow", "tempent", "beam", "hud"];
/** The widest a frame is drawn as painted, and the widest at all (GoldSrc shrinks past `gl_max_size`). */
const SIDE_WARN = 256;
const SIDE_MOST = 512;
/** A reference whose last frame is lit to this share of its brightest loops: a one-shot ends dark. */
const LOOPS_LIT = 0.5;
/** A sprite's light, frame by frame over the brightest, more than this from its reference's on average is warned of. */
const CURVE_GAP = 0.08;
/** Or any one frame further than this from the reference's at the same point of its play (steam1's growth: 0.41). */
const CURVE_FRAME = 0.25;
/** A loop that jumps by more than this at its wrap, against its mean step, shows the seam every time round. */
const WRAP_MOST = 2.5;
/** The classes that play once and must end dark. */
const ONE_SHOTS = new Set(["explosion", "smoke puff", "sparks", "ring"]);
const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
/**
 * Where a reproduction is told it is off its reference: the judge's bars. The shape's is 0.8: in sprites round 3 the judges gave its shape full marks (R2) at 0.76 and over, and
 * mostly not under.
 */
const REFERENCE_BARS = { shape: 0.8, colour: 15, dark: 0.05 };

/** The sprites of a spec, each with the spec's own fields as its defaults. */
const spritesOf = (spec) => (spec.sprites?.length ? spec.sprites.map((s) => ({ ...spec, sprites: undefined, ...s })) : [spec]);

export function validateSpriteSpec(spec) {
  const errors = [];
  const warnings = [];
  if (spec?.spec !== SPRITE_SPEC) errors.push(`spec: "${SPRITE_SPEC}"`);
  for (const key of Object.keys(spec ?? {})) if (!FIELDS.includes(key)) warnings.push(`${key}: a sprite spec takes no ${key}, left out`);
  spritesOf(spec ?? {}).forEach((s, n) => {
    const at = spec.sprites?.length ? `sprites[${n}]` : "the sprite";
    if (typeof s.name !== "string" || !/^[\w/.-]+\.spr$/.test(s.name)) errors.push(`${at}.name: its path under the mod, lower case, ending .spr (sprites/flame.spr)`);
    if (s.use !== undefined && !USES.includes(s.use)) errors.push(`${at}.use: one of ${USES.join(", ")}`);
    if (s.class !== undefined && !SPRITE_CLASSES[s.class]) errors.push(`${at}.class: one of ${Object.keys(SPRITE_CLASSES).join(", ")}`);
    if (!Array.isArray(s.size) || s.size.length !== 2 || !s.size.every((v) => Number.isInteger(v) && v >= 8 && v % 8 === 0 && v <= SIDE_MOST))
      errors.push(`${at}.size: [width, height], multiples of 8 up to ${SIDE_MOST}`);
    else if (Math.max(...s.size) > SIDE_WARN) warnings.push(`${at}.size: over ${SIDE_WARN} a side is drawn shrunk where the game's gl_max_size is 256`);
    if (s.frames !== undefined && !(Number.isInteger(s.frames) && s.frames >= 1 && s.frames <= 64)) errors.push(`${at}.frames: 1 to 64`);
    if (s.type !== undefined && !SPRITE_TYPES.includes(s.type)) errors.push(`${at}.type: one of ${SPRITE_TYPES.join(", ")}`);
    if (s.format !== undefined && !SPRITE_FORMATS.includes(s.format)) errors.push(`${at}.format: one of ${SPRITE_FORMATS.join(", ")}`);
    if (s.fps !== undefined && !(isNumber(s.fps) && s.fps > 0)) errors.push(`${at}.fps: frames a second, over 0`);
    if ((s.use ?? "env_sprite") === "env_sprite" && s.fps > 10) warnings.push(`${at}.fps: an env_sprite changes frame at most 10 times a second; ${s.fps} skips frames`);
    if (!Array.isArray(s.layers) || !s.layers.length) errors.push(`${at}.layers: a list of one layer at least, each { kind: ${LAYER_KINDS.join(" | ")}, ... }`);
    else
      s.layers.forEach((layer, k) => {
        if (!LAYER_KINDS.includes(layer?.kind)) errors.push(`${at}.layers[${k}].kind: one of ${LAYER_KINDS.join(", ")}`);
        if (layer?.ramp !== undefined && typeof layer.ramp === "string" && !RAMP_NAMES.includes(layer.ramp) && layer.ramp !== "reference") errors.push(`${at}.layers[${k}].ramp: one of ${RAMP_NAMES.join(", ")}, "reference" (the reference's own colour at each brightness), or a list of [heat, [r, g, b]] stops`);
        if (layer?.ramp === "reference" && s.reference === undefined) errors.push(`${at}.layers[${k}].ramp: "reference" takes the reference's colours, and the sprite has none`);
        // colours are 0 to 1: one of 0 to 255 summed into the frame is a white blot (three words legs of round 2)
        if (layer?.colour !== undefined && rgbFault(layer.colour)) errors.push(`${at}.layers[${k}].colour: ${rgbFault(layer.colour)}`);
        if (layer?.mask !== undefined) {
          if (layer.mask !== "reference" && !(layer.mask?.from === "reference")) errors.push(`${at}.layers[${k}].mask: "reference" (the reference's lit area, frame by frame), or { from: "reference", low, high }`);
          else if (s.reference === undefined) errors.push(`${at}.layers[${k}].mask: the sprite has no reference to take its outline from`);
        }
        if (Array.isArray(layer?.ramp))
          layer.ramp.forEach((stop, j) => {
            if (!Array.isArray(stop) || typeof stop[0] !== "number" || rgbFault(stop[1])) errors.push(`${at}.layers[${k}].ramp[${j}]: [heat 0 to 1, [r, g, b] 0 to 1]${Array.isArray(stop) && rgbFault(stop[1]) ? `: ${rgbFault(stop[1])}` : ""}`);
          });
      });
    if (s.colour !== undefined && rgbFault(s.colour)) errors.push(`${at}.colour: ${rgbFault(s.colour)}`);
    const ref = s.reference;
    if (ref !== undefined && typeof ref !== "string" && typeof ref?.picture !== "string") errors.push(`${at}.reference: a contact sheet's path, or { picture, cell, cols } (as it was drawn: 128 and 8)`);
    else if (ref?.cell !== undefined && !(Number.isInteger(ref.cell) && ref.cell >= 8)) errors.push(`${at}.reference.cell: the sheet's cell in pixels (128)`);
    else if (ref?.cols !== undefined && !(Number.isInteger(ref.cols) && ref.cols >= 1)) errors.push(`${at}.reference.cols: frames a row of the sheet (8)`);
  });
  return { errors, warnings };
}

/** Where a frame stands from the point the sprite is put at: `centre`, `bottom` (a flame on its base) or [x, y]. */
function originOf(origin, w, h) {
  if (origin === "bottom") return { left: -(w >> 1), up: h };
  if (Array.isArray(origin)) return { left: -origin[0], up: origin[1] };
  return { left: -(w >> 1), up: h >> 1 };
}

/**
 * A sprite measured against its reference, each the same way off a sheet of the same drawing: { facts, notes,
 * measured } or { error }. `readPicture(path)` gives the picture ({ width, height, rgba }).
 */
function againstReference(name, ref, back, s, readPicture) {
  const { picture: path, cell = 128, cols = 8 } = typeof ref === "string" ? { picture: ref } : ref;
  let picture;
  try {
    picture = readPicture(path);
  } catch (error) {
    return { error: `${name}: its reference ${path} could not be read (${error.message.split("\n")[0]})` };
  }
  const how = { size: s.size, format: s.format ?? "additive", cols, cell, tint: s.colour ?? [1, 1, 1] };
  const theirs = measureSheet(picture, how);
  if (theirs.error) return { error: `${name}: its reference ${path}: ${theirs.error}` };
  const ours = measureSheet(sheetOf(back, { cols, cell }), how);
  const colour = theirs.lab && ours.lab ? Math.round(Math.hypot(...theirs.lab.map((v, j) => v - ours.lab[j])) * 10) / 10 : null;
  const shape = shapeOverlap(theirs.masks, ours.masks);
  const measured = { reference: path, colourDeltaE: colour, dark: [theirs.dark, ours.dark], border: { max: [theirs.border.max, ours.border.max], mean: [theirs.border.mean, ours.border.mean] }, frames: [theirs.frames, ours.frames], shape: { mean: shape.mean, frames: shape.frames } };
  const facts = [`${name} against its reference (${path}, measured, nothing copied; the reference's, then this one's): mean colour delta E ${colour ?? "none"}, dark ${theirs.dark} and ${ours.dark}, border brightest ${theirs.border.max} and ${ours.border.max} (mean ${theirs.border.mean} and ${ours.border.mean}), frames ${theirs.frames} and ${ours.frames}`];
  const notes = [];
  if (colour !== null && colour > REFERENCE_BARS.colour) notes.push(`${name}: its colour is ${colour} from its reference's (delta E; the bar is ${REFERENCE_BARS.colour}): a ramp or a colour nearer the reference's`);
  const darker = ours.dark - theirs.dark;
  if (Math.abs(darker) > REFERENCE_BARS.dark) notes.push(`${name}: ${darker > 0 ? "more" : "less"} of it is dark than of its reference (${ours.dark} against ${theirs.dark}): the effect ${darker > 0 ? "covers too little of its frame" : "covers too much of its frame"}`);
  // the hot middle: how bright its brightest is, and how many pixels are near that (Steven, 2026-10-15: the glow's
  // brightest point larger than the original's, which the shape's levels up to 0.4 did not see)
  const hot = (m) => {
    const all = m.flatMap((f) => [...f]);
    const peak = Math.max(0, ...all);
    return { peak: Math.round(peak * 100) / 100, core: all.filter((e) => e > 0.7).length / (m.length || 1) };
  };
  const [hotTheirs, hotOurs] = [hot(theirs.masks), hot(ours.masks)];
  facts.push(`${name}: its brightest ${hotTheirs.peak} and ${hotOurs.peak}, pixels over 0.7 a frame ${Math.round(hotTheirs.core)} and ${Math.round(hotOurs.core)}`);
  if (hotOurs.peak > hotTheirs.peak + 0.15 || hotOurs.core > Math.max(2, 1.5 * hotTheirs.core))
    notes.push(`${name}: its middle is hotter than its reference's (brightest ${hotOurs.peak} against ${hotTheirs.peak}, ${Math.round(hotOurs.core)} pixels over 0.7 against ${Math.round(hotTheirs.core)}): a smaller core, a dimmer colour or a gentler falloff`);
  // and smaller: flare1's core of 222 pixels over 0.7 against the reference's 530 was "roughly half the original's
  // width" to the judges (R2 1), with its shape's mean at 0.85 and nothing said
  else if (hotTheirs.core > 4 && hotOurs.core < hotTheirs.core / 1.5)
    notes.push(`${name}: its middle is smaller than its reference's (${Math.round(hotOurs.core)} pixels over 0.7 a frame against ${Math.round(hotTheirs.core)}): a larger core, a brighter colour or a slower falloff`);
  else if (hotOurs.peak < hotTheirs.peak - 0.15) notes.push(`${name}: its middle is dimmer than its reference's (brightest ${hotOurs.peak} against ${hotTheirs.peak}): a brighter colour or core`);
  // when its light comes, frame by frame, and how far it reaches the border: the judges mark both down (R4: the
  // envelope's peak two frames late; R2: a halo that falls off before the reference's reaches the edge)
  const envelope = (m) => {
    const sums = m.map((f) => f.reduce((a, b) => a + b, 0));
    const most = Math.max(...sums, 1e-9);
    const at = sums.indexOf(Math.max(...sums));
    return { peakAt: sums.length > 1 ? Math.round((at / (sums.length - 1)) * 100) / 100 : 0, first: Math.round((sums[0] / most) * 100) / 100, last: Math.round((sums[sums.length - 1] / most) * 100) / 100 };
  };
  if (theirs.masks.length > 1 && ours.masks.length > 1) {
    const [a, b] = [envelope(theirs.masks), envelope(ours.masks)];
    // whether it loops: a one-shot ends dark, so a reference whose last frame is still lit loops. Unsaid in its
    // facts, fire was made a one-shot in four rounds of twelve, and the judges took R4 for "the loop closes differently"
    // (read off an additive sheet only, of four frames or more: a sheet drawn over grey reads a faint puff as lit,
    // and a muzzle flash of two frames is a tempent shown and gone, never a loop)
    const readable = (s.format ?? "additive") === "additive" && (s.use ?? "env_sprite") !== "tempent" && theirs.masks.length >= 4;
    if (readable && !s.loop && a.last >= LOOPS_LIT) notes.push(`${name}: its reference's last frame is still ${a.last} of its brightest, as a loop's is (a one-shot ends dark): make it loop: true`);
    else if (readable && s.loop && a.last < 0.1 && a.first < 0.1) notes.push(`${name}: its reference starts and ends dark (${a.first} and ${a.last} of its brightest), as a one-shot does: make it loop: false`);
    facts.push(`${name}: its light over its frames against its reference's: brightest at ${a.peakAt} and ${b.peakAt} of its play, first frame ${a.first} and ${b.first}, last ${a.last} and ${b.last} of the brightest`);
    if (Math.abs(a.peakAt - b.peakAt) > 0.08) notes.push(`${name}: its brightest frame comes at ${b.peakAt} of its play, its reference's at ${a.peakAt}: move its envelope (env's attack, or the layer's own timing) so that it peaks where the reference does`);
    if (Math.abs(a.first - b.first) > 0.2) notes.push(`${name}: its first frame is ${b.first} of its brightest, its reference's ${a.first}: it ${b.first < a.first ? "starts too faint" : "starts too bright"}`);
    // the whole curve, frame by frame: steam1 peaked where its reference did and grew three frames slower (a mean
    // gap of 0.11, 0.41 at its worst frame), and fire held its light to its last frame where the reference's sank
    // (0.09); the judges took R4 for both, and for zerogxplode (0.11). muzzleflash1, which passed, is at 0.005
    const curve = (m) => {
      const sums = m.map((f) => f.reduce((x, y) => x + y, 0));
      const most = Math.max(...sums, 1e-9);
      return sums.map((v) => v / most);
    };
    const [ca, cb] = [curve(theirs.masks), curve(ours.masks)];
    const atOurs = (i) => cb[Math.round((i / Math.max(1, ca.length - 1)) * (cb.length - 1))];
    const gaps = ca.map((v, i) => atOurs(i) - v);
    const meanGap = gaps.reduce((x, g) => x + Math.abs(g), 0) / gaps.length;
    const worst = gaps.reduce((w, g, i) => (Math.abs(g) > Math.abs(gaps[w]) ? i : w), 0);
    if (meanGap > CURVE_GAP || Math.abs(gaps[worst]) > CURVE_FRAME) {
      // the frames about the worst that part the same way
      const same = (i) => i >= 0 && i < gaps.length && Math.sign(gaps[i]) === Math.sign(gaps[worst]) && Math.abs(gaps[i]) > CURVE_GAP / 2;
      let [from, to] = [worst, worst];
      while (same(from - 1)) from--;
      while (same(to + 1)) to++;
      const run = [from, to];
      notes.push(`${name}: its light over its play parts from its reference's by ${Math.round(meanGap * 100) / 100} a frame on average (aim within ${CURVE_GAP}, and no frame past ${CURVE_FRAME}): at the reference's frames ${run[0]} to ${run.at(-1)} it is ${gaps[worst] > 0 ? "brighter" : "fainter"} (${Math.round(atOurs(worst) * 100) / 100} of its brightest against ${Math.round(ca[worst] * 100) / 100}): ${gaps[worst] > 0 ? "a faster fall or a later rise there" : "a faster rise or a slower fall there"} (env's attack and decay, env.start, or a layer's own growth)`);
    }
  }
  if (Math.abs(theirs.border.max - ours.border.max) > 0.08)
    notes.push(`${name}: its light reaches its frame's border at ${ours.border.max} at most, its reference's at ${theirs.border.max}: ${ours.border.max < theirs.border.max ? "it falls off too soon: a wider radius or falloff, so it fills its frame as the reference's does" : "it spills past where the reference's stops: a smaller radius"}`);
  if (ours.frames !== theirs.frames) notes.push(`${name}: ${ours.frames} frames against its reference's ${theirs.frames}`);
  // the shape, frame by frame: the lit pixels of each against the reference's at the same point of its play
  if (theirs.masks[0]?.length === ours.masks[0]?.length) {
    facts.push(`${name}: its shape against its reference's, frame by frame (at its faint edge, its body and its core, the share of pixels lit in both: ${shape.levels.join(", ")}): mean ${shape.mean}; ${shape.frames.join(" ")}`);
    if (shape.mean < REFERENCE_BARS.shape) {
      const [w] = s.size ?? [Math.sqrt(ours.masks[0].length)];
      const extent = (mask) => {
        let [x0, y0, x1, y1] = [Infinity, Infinity, -1, -1];
        mask.forEach((v, i) => {
          if (!v) return;
          const x = i % w;
          const y = Math.floor(i / w);
          [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
        });
        return x1 < 0 ? "nothing lit" : `columns ${x0}-${x1}, rows ${y0}-${y1}`;
      };
      // where each is lit at its core, the level where shapes most often part
      const core = (mask) => {
        const lit = mask.map((v) => (v >= SHAPE_LEVELS[2] ? 1 : 0));
        return extent(lit);
      };
      const shown = (shape.worst.length ? shape.worst : [0]).slice(0, 4).map((i) => {
        const j = Math.min(theirs.masks.length - 1, Math.round((i / Math.max(1, ours.masks.length - 1)) * (theirs.masks.length - 1)));
        return `frame ${i}: the reference lit at ${extent(theirs.masks[j].map((v) => (v >= SHAPE_LEVELS[0] ? 1 : 0)))} (its core at ${core(theirs.masks[j])}), this one at ${extent(ours.masks[i].map((v) => (v >= SHAPE_LEVELS[0] ? 1 : 0)))} (core ${core(ours.masks[i])})`;
      });
      notes.push(`${name}: its shape fills its frames otherwise than its reference's (overlap ${shape.mean}; the bar is ${REFERENCE_BARS.shape}). ${shown.join("; ")}`);
    }
  }
  return { facts, notes, measured };
}

export function buildSpriteSpec(spec, { readPicture = (path) => unpicture(readFileSync(path)) } = {}) {
  const { errors, warnings } = validateSpriteSpec(spec);
  const report = { ok: false, errors, warnings, faults: [], notes: [], facts: [] };
  if (errors.length) return { report, files: [] };
  const files = [];
  for (const s of spritesOf(spec)) {
    const use = s.use ?? "env_sprite";
    const format = s.format ?? "additive";
    const loop = s.loop ?? false;
    // a masked layer's outline: the reference's lit area frame by frame (Steven, 2026-10-15: its outline, never its
    // colours), read off its sheet as the measures read it, each frame scaled to its own brightest and eased in
    // between `low` and `high` of that
    let masks = null;
    const masked = s.layers.find((layer) => layer.mask);
    if (masked) {
      const ref = typeof s.reference === "string" ? { picture: s.reference } : s.reference;
      let read;
      try {
        read = measureSheet(readPicture(ref.picture), { size: s.size, format, cols: ref.cols ?? 8, cell: ref.cell ?? 128, tint: s.colour ?? [1, 1, 1] });
      } catch (error) {
        read = { error: error.message.split("\n")[0] };
      }
      if (read.error) {
        errors.push(`${s.name}: its masked layer's reference: ${read.error}`);
        continue;
      }
      const { low = 0.04, high = 0.3 } = typeof masked.mask === "object" ? masked.mask : {};
      masks = read.masks.map((m) => {
        const most = Math.max(...m) || 1;
        return Float32Array.from(m, (v) => {
          const t = clamp01((v / most - low) / (high - low));
          return t * t * (3 - 2 * t);
        });
      });
      report.facts.push(`${s.name}: ${s.layers.filter((l) => l.mask).length} layer(s) masked by the reference's lit area, its ${masks.length} frames over this one's ${s.frames ?? 1}: its outline, not its colours`);
    }
    // a layer's ramp "reference": the reference's own colour at each brightness, read off its sheet
    let layers = s.layers;
    if (layers.some((layer) => layer.ramp === "reference")) {
      const ref = typeof s.reference === "string" ? { picture: s.reference } : s.reference;
      let stops = null;
      try {
        const picture = readPicture(ref.picture);
        // frame by frame where it has more than one: its colour may change as it plays (an explosion cools)
        const count = measureSheet(picture, { size: s.size, format, cols: ref.cols ?? 8, cell: ref.cell ?? 128 }).frames ?? 1;
        stops = count > 1 ? rampOfFrames(picture, { size: s.size, format, cols: ref.cols ?? 8, cell: ref.cell ?? 128, frames: count }) : rampOfSheet(picture, { format });
      } catch (error) {
        errors.push(`${s.name}: its ramp's reference: ${error.message.split("\n")[0]}`);
        continue;
      }
      if (!stops) {
        errors.push(`${s.name}: its reference has no lit pixel to take a ramp from`);
        continue;
      }
      layers = layers.map((layer) => (layer.ramp === "reference" ? { ...layer, ramp: stops } : layer));
      const whole = stops.frames ? stops.frames[Math.floor(stops.frames.length / 2)] : stops;
      report.facts.push(`${s.name}: ramp "reference": the reference's own colour at each brightness${stops.frames ? `, frame by frame over its ${stops.frames.length} frames` : ""} (its middle: from ${whole[1][1].join(" ")} at its faintest to ${whole.at(-1)[1].join(" ")} at its brightest)`);
    }
    let made = framesOf({ size: s.size, frames: s.frames ?? 1, loop, layers, seed: s.seed ?? 1, edge: s.finish?.edge ?? 2, use, masks });
    // a loop has no first frame of its own: with a reference, it starts at the frame that puts its light over the
    // loop as the reference's is (the judges marked flames down for a brightest frame "two frames later", which in
    // a loop is only where it was cut open)
    if (loop && s.reference !== undefined && made.length > 3) {
      const ref = typeof s.reference === "string" ? { picture: s.reference } : s.reference;
      let read = null;
      try {
        read = measureSheet(readPicture(ref.picture), { size: s.size, format, cols: ref.cols ?? 8, cell: ref.cell ?? 128, tint: s.colour ?? [1, 1, 1] });
      } catch {
        // its reference unread: said by the measures below
      }
      if (read && !read.error && read.masks.length > 2) {
        const cycle = made.slice(0, -1);
        const energy = (f) => {
          let sum = 0;
          for (let i = 0; i < f.width * f.height; i++) sum += (0.299 * f.rgb[i * 3] + 0.587 * f.rgb[i * 3 + 1] + 0.114 * f.rgb[i * 3 + 2]) * (f.a ? f.a[i] : 1);
          return sum;
        };
        const norm = (list) => {
          const most = Math.max(...list, 1e-9);
          return list.map((v) => v / most);
        };
        const ours = norm(cycle.map(energy));
        // the reference's loop, its first frame again at its end left out when it has one more frame than ours
        let theirs = norm(read.masks.map((m) => m.reduce((x, y) => x + y, 0)));
        if (theirs.length === cycle.length + 1) theirs = theirs.slice(0, -1);
        const at = (i) => theirs[Math.round((i * theirs.length) / cycle.length) % theirs.length];
        const fits = [];
        for (let r = 0; r < cycle.length; r++) {
          let d = 0;
          for (let i = 0; i < cycle.length; i++) d += Math.abs(ours[(i + r) % cycle.length] - at(i));
          fits.push({ r, d });
        }
        // of the turns that follow it nearly as well, the one whose brightest frame falls where the reference's
        // does: a flame's or a spark's light hardly moves over its loop, so the turn that fits best put fire's
        // brightest frame at 0.71 of its play against the reference's 0.07, and the judges took R4 for it
        const least = Math.min(...fits.map((f) => f.d));
        const theirPeak = theirs.indexOf(Math.max(...theirs)) / theirs.length;
        const peakOf = (r) => ((ours.indexOf(Math.max(...ours)) - r + cycle.length) % cycle.length) / cycle.length;
        const ring = (x) => Math.min(Math.abs(x), 1 - Math.abs(x));
        const best = fits.filter((f) => f.d <= least * 1.1 + 1e-9).reduce((a, b) => (ring(peakOf(b.r) - theirPeak) < ring(peakOf(a.r) - theirPeak) - 1e-9 ? b : a));
        if (best.r) {
          const turned = cycle.map((_, i) => cycle[(i + best.r) % cycle.length]);
          made = [...turned, turned[0]];
          report.facts.push(`${s.name}: its loop starts at its frame ${best.r}, where its light over the loop follows its reference's`);
        }
      }
    }
    const { palette, pixels, error, colours } = quantiseFrames(made, format, { colour: s.colour ?? [1, 1, 1] });
    const [w, h] = s.size;
    const frames = pixels.map((p) => ({ ...originOf(s.origin, w, h), width: w, height: h, pixels: p }));
    const bytes = writeSpr({ type: s.type ?? (use === "beam" ? "parallel oriented" : "parallel"), format, palette, frames });
    // read back as the engine's own reader would: the same frames, the same palette
    const back = readSpr(bytes);
    if (back.frames.length !== frames.length || back.frames.some((f, i) => Buffer.compare(Buffer.from(f.pixels), Buffer.from(frames[i].pixels)) !== 0))
      report.faults.push(`${s.name}: it does not read back as written: a fault in the kit`);
    const m = measureSprite(back, { loop });
    const said = `${s.name}: ${w}x${h}, ${frames.length} frames${loop ? ` (a loop of ${frames.length - 1}, its first again at the end)` : ""}, ${format}, ${colours} colours, quantising lost ${error}; border ${m.border.mean} (brightest ${m.border.max}), dark ${m.dark}${m.wrap !== null ? `, wrap ${m.wrap}` : ""}${m.jitter !== null ? `, jitter ${m.jitter}` : ""}, envelope peaks at ${m.envelope.peakAt} (first ${m.envelope.first}, last ${m.envelope.last})`;
    report.facts.push(said);
    if (loop && m.wrap > WRAP_MOST) report.faults.push(`${s.name}: its loop jumps at the wrap (${m.wrap} times its mean step, over ${WRAP_MOST}): make the motion periodic`);
    if (ONE_SHOTS.has(s.class) && m.envelope.last > 0.15) report.faults.push(`${s.name}: a ${s.class} plays once and must end dark; its last frame is ${m.envelope.last} of its peak: give a layer an env with a decay`);
    if (use !== "beam" && m.border.mean > 0.03) report.faults.push(`${s.name}: light at its border (mean ${m.border.mean}): the frame's square shows; fade more (finish.edge) or shrink the effect`);
    const held = s.class ? againstClass(m, s.class) : null;
    if (held) {
      const off = held.filter((r) => !r.ok);
      report.facts.push(`${s.name} against Half-Life's ${s.class}: ${held.length - off.length} of ${held.length} in range`);
      // a warning, not a fact: makers stop at OK, and a judge holds the sprite to its class's measures
      if (off.length) report.warnings.push(`${s.name}: off Half-Life's ${s.class}: ${off.map((r) => `${r.measure} ${r.value} (${r.range.join(" to ")}): ${r.words}`).join("; ")}. Bring it into range and build again`);
    }
    const mode = format === "index alpha" ? "4 (Solid)" : format === "alpha test" ? "0 (Normal)" : use === "env_glow" ? "3 (Glow)" : "5 (Additive)";
    report.notes.push(`${s.name}: placed as ${use === "env_glow" ? "an env_glow" : use === "env_sprite" ? "an env_sprite" : `a ${use}`}, render mode ${mode}${s.fps ? `, framerate ${s.fps}` : ""}`);
    if (s.reference !== undefined) {
      const against = againstReference(s.name, s.reference, back, s, readPicture);
      if (against.error) report.warnings.push(against.error);
      else {
        report.facts.push(...against.facts);
        // warnings, not notes: in round 3 of the reproduction test makers stopped at OK with their shape at 0.4 to 0.6
        report.warnings.push(...against.notes.map((line) => `${line}. Bring it nearer and build again`));
        (report.reference ??= {})[s.name] = against.measured;
      }
    }
    const sheet = sheetOf(back);
    files.push({ name: s.name, bytes, sheet: png(sheet.width, sheet.height, sheet.rgba), sheetPicture: sheet, animation: animationOf(back, { fps: s.fps ?? 10, loop }) });
  }
  report.ok = !report.errors.length && !report.faults.length;
  return { report, files };
}
