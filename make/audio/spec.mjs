// A sound spec: a sound, or a set of them, described as layers and built into GoldSrc's files, checked and
// held against the game's own of its kind. The agent writes the spec; this builds it. docs/SOUNDS.md says how to write one.
//
//   validateSoundSpec(spec)                      -> { errors, warnings }
//   buildSoundSpec(spec, { games, folder, readPicture }) -> { report, files: [{ name, bytes }], picture }

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { render, MODE_SETS, normalise } from "./synth.mjs";
import { writeWav, readWav, resample, RATES } from "../../core/audio/wav.mjs";
import { checks, features } from "./measure.mjs";
import { CLASSES, scoreAgainst, rangesOf } from "./classes.mjs";
import { soundPicture } from "./draw.mjs";
import { fitBands } from "./fit.mjs";
import { pictureMeasures } from "./picture.mjs";
import { unpicture } from "../../core/image.mjs";

export const SOUND_SPEC = "smak.sound/1";
const TOP = ["spec", "name", "class", "rate", "bits", "seed", "length", "pitch", "layers", "finish", "loop", "variants", "reference", "picture", "bands", "t20", "onsets", "sounds", "note"];
const LAYER = ["id", "kind", "file", "from", "at", "length", "gain", "env", "filter", "color", "shape", "iterations", "wave", "f", "sweep", "ratio", "index", "indexDecay", "ratios", "modes", "gains", "decay", "damping", "detune", "count", "rate", "every", "jitter", "band", "grain", "drive", "post", "note"];
const KINDS = ["noise", "tone", "fm", "modes", "particles", "sample"];
/** Licences a take's sidecar may name that do not allow selling what is made with it: told so in the report's facts. */
const NON_COMMERCIAL = /\bNC\b|non-?commercial|research only/i;
const FILTERS = ["lowpass", "highpass", "bandpass", "peak", "notch", "lowshelf", "highshelf"];
/**
 * How near a sound should come to its picture before the report stops warning: inside the reproduction test's
 * lines (a centroid within 20%, each band within 10 points) by the error of reading a picture (about 3 points and
 * 10% on Half-Life's sounds; more in the lowest band of a short one).
 */
const PICTURE_CENTROID = 0.15;
/** The classes whose sounds strike: every one of the game's starts within 25 ms. A swing, a reload and a loop swell. */
const STRUCK = new Set(["metal hit", "flesh hit", "gunshot", "click", "pump", "shell", "launcher", "grenade bounce", "explosion", "step concrete", "step metal", "step dirt", "step tile", "step grate", "step vent"]);
/** An attack slower than this, in a struck class, is warned of: Steven heard a .357 that took 0.14 s as played backwards. */
const SWELL = 0.05;
const PICTURE_BANDS = 7;
/** A sound's T20 more than this share off the one its spec asks (`t20`) is warned of: a judge holds a copy to a quarter, less a margin. */
const T20_ASKED = 0.2;
/**
 * Flatness off its picture's by more than this many times, either way, is warned of. A picture's reading is within
 * a tenth on nine of Half-Life's ten sounds tried (the crowbar's hit, read 0.34 for 0.22, the worst).
 */
const PICTURE_FLATNESS = 1.6;
/** The bands a sound's power is told in (features' bands), as a spec's `bands` names them. */
const BAND_NAMES = ["<150", "150-600", "600-2k", "2k-5k", ">5k"];
/** The longest a sound's path may be from the mod's folder: the engine's 64 with its zero, `sound/` added. */
const LONGEST_NAME = 63 - "sound/".length;

const isNumber = (v) => typeof v === "number" && Number.isFinite(v);

/** What is wrong with a noise layer's `shape`: a curve [[Hz, dB], ...] rising in Hz, or { keys: [{ at, curve }] } rising in time. */
function shapeFaults(shape) {
  const curveFault = (curve) =>
    !Array.isArray(curve) || !curve.length || curve.some((p, i) => !Array.isArray(p) || !isNumber(p[0]) || !isNumber(p[1]) || p[0] <= 0 || (i && p[0] <= curve[i - 1][0]));
  if (Array.isArray(shape)) return curveFault(shape) ? ["a curve of [Hz, dB] points, Hz over 0 and rising"] : [];
  if (!Array.isArray(shape?.keys) || !shape.keys.length) return ["a curve [[Hz, dB], ...], or { keys: [{ at, curve }] }"];
  return shape.keys.flatMap((key, i) =>
    !isNumber(key?.at) || (i && key.at < shape.keys[i - 1].at) ? [`keys[${i}].at: seconds from the layer's start, rising`] : curveFault(key.curve) ? [`keys[${i}].curve: [Hz, dB] points, Hz over 0 and rising`] : [],
  );
}

/** The sounds a spec makes: itself, or each of its `sounds` with the spec's fields as defaults. */
function soundsOf(spec) {
  const { sounds, spec: _, ...shared } = spec;
  return sounds ? sounds.map((sound) => ({ ...shared, ...sound })) : [spec];
}

/** What is wrong with a sound spec, in sentences that say what to write. */
export function validateSoundSpec(spec) {
  const errors = [];
  const warnings = [];
  if (spec?.spec !== SOUND_SPEC) errors.push(`spec: "${SOUND_SPEC}"`);
  for (const key of Object.keys(spec ?? {})) if (!TOP.includes(key)) warnings.push(`${key}: not a field of a sound spec, left out`);
  if (spec?.sounds !== undefined && (!Array.isArray(spec.sounds) || !spec.sounds.length)) errors.push("sounds: a list of sounds, each with its own name and layers (the spec's other fields are their defaults)");
  for (const [n, sound] of soundsOf(spec ?? {}).entries()) {
    const at = spec?.sounds ? `sounds[${n}]` : "";
    const where = (field) => `${at}${at ? "." : ""}${field}`;
    if (typeof sound.name !== "string" || !/^[a-z0-9_\-/]+\.wav$/.test(sound.name))
      errors.push(`${where("name")}: the file's path under sound/, lower case, ending .wav ("weapons/cbar_hit1.wav"), not ${JSON.stringify(sound.name)}`);
    else if (sound.name.length > LONGEST_NAME) errors.push(`${where("name")}: ${sound.name.length} letters; the engine holds ${LONGEST_NAME} after sound/`);
    if (sound.rate !== undefined && !RATES.includes(sound.rate)) errors.push(`${where("rate")}: ${RATES.join(", ")} Hz`);
    if (sound.bits !== undefined && sound.bits !== 8 && sound.bits !== 16) errors.push(`${where("bits")}: 8 or 16`);
    if (sound.class !== undefined && !CLASSES[sound.class]) errors.push(`${where("class")}: one of ${Object.keys(CLASSES).join(", ")}`);
    if (!Array.isArray(sound.layers) || !sound.layers.length) errors.push(`${where("layers")}: a list of one layer at least`);
    for (const [k, layer] of (sound.layers ?? []).entries()) {
      const label = `${where(`layers[${k}]`)}${layer?.id ? ` (${layer.id})` : ""}`;
      for (const key of Object.keys(layer ?? {})) if (!LAYER.includes(key)) warnings.push(`${label}.${key}: not a field of a layer, left out`);
      if (!KINDS.includes(layer?.kind)) errors.push(`${label}.kind: ${KINDS.join(", ")}`);
      if (["tone", "fm"].includes(layer?.kind) && !isNumber(layer.f)) errors.push(`${label}.f: its frequency in Hz`);
      if (layer?.kind === "sample") {
        if (typeof layer.file !== "string" || !/\.wav$/i.test(layer.file)) errors.push(`${label}.file: a .wav in the work folder (a generator's take: "work:gen/hit_s2.wav")`);
        if (layer.from !== undefined && layer.from !== "onset" && !(isNumber(layer.from) && layer.from >= 0)) errors.push(`${label}.from: seconds into the file to start at, or "onset" (its first hit)`);
      } else if (layer?.file !== undefined || layer?.from !== undefined) warnings.push(`${label}: file and from are a sample layer's, left out`);
      if (layer?.kind === "modes" && !isNumber(layer.f) && !Array.isArray(layer.modes))
        errors.push(`${label}: f (the lowest mode's Hz) with ratios (${Object.keys(MODE_SETS).join(", ")} or a list), or modes: [{ f, gain, decay }]`);
      if (layer?.kind === "modes" && typeof layer.ratios === "string" && !MODE_SETS[layer.ratios]) errors.push(`${label}.ratios: ${Object.keys(MODE_SETS).join(", ")}, or a list of numbers`);
      if (layer?.shape !== undefined) {
        if (layer.kind !== "noise") errors.push(`${label}.shape: only a noise layer takes a shape`);
        for (const fault of shapeFaults(layer.shape)) errors.push(`${label}.shape: ${fault}`);
      }
      if (layer?.iterations !== undefined && !(Number.isInteger(layer.iterations) && layer.iterations >= 0 && layer.iterations <= 200)) errors.push(`${label}.iterations: a whole number, 0 to 200 (32 is plenty)`);
      if (layer?.every !== undefined && !(isNumber(layer.every) && layer.every > 0)) errors.push(`${label}.every: seconds from one grain to the next, over 0`);
      if (layer?.jitter !== undefined && !(isNumber(layer.jitter) && layer.jitter >= 0 && layer.jitter <= 1)) errors.push(`${label}.jitter: 0 to 1, the share of \`every\` a grain may move`);
      if (layer?.drive !== undefined && !(isNumber(layer.drive) && layer.drive >= 1 && layer.drive <= 20)) errors.push(`${label}.drive: 1 to 20`);
      for (const [j, filter] of (layer?.filter ?? []).entries())
        if (!FILTERS.includes(filter?.type) || !isNumber(filter?.f)) errors.push(`${label}.filter[${j}]: { type: ${FILTERS.join("|")}, f, q, gain, sweep: { to, time } }`);
    }
    const limit = sound.finish?.limit;
    if (limit !== undefined && !(isNumber(limit?.crest) && limit.crest >= 1 && limit.crest <= 40 && (limit.release === undefined || (isNumber(limit.release) && limit.release > 0))))
      errors.push(`${where("finish.limit")}: { crest: the peak over the RMS it is squashed to, in dB (Valve's weapons 6 to 10), release: seconds (0.05) }`);
    const fit = sound.finish?.fit;
    if (fit !== undefined && fit !== "bands")
      errors.push(`${where("finish.fit")}: "bands": its power brought to the shares it is to have (its own \`bands\`, its picture's, the game's own sound it takes the place of, or its class's)`);
    if (sound.bands !== undefined && !(sound.bands && typeof sound.bands === "object" && Object.entries(sound.bands).every(([k, v]) => BAND_NAMES.includes(k) && isNumber(v) && v >= 0 && v <= 100)))
      errors.push(`${where("bands")}: the share of its power in each band, in %, as a description of the sound gives it: { ${BAND_NAMES.map((k) => `"${k}": n`).join(", ")} } (any of them)`);
    if (sound.onsets !== undefined && !(Number.isInteger(sound.onsets) && sound.onsets >= 0 && sound.onsets <= 64))
      errors.push(`${where("onsets")}: how many hits a description of the sound counts ("three closely spaced hits": 3; "no separate impacts": 0), as a judge counts them`);
    if (sound.t20 !== undefined && !(isNumber(sound.t20) && sound.t20 > 0 && sound.t20 < 30))
      errors.push(`${where("t20")}: the seconds from its loudest to 20 dB under it, as a description of the sound gives it ("falls about 20 dB in the next 0.44 s": 0.44)`);
    if (sound.picture !== undefined && typeof sound.picture !== "string" && typeof sound.picture?.file !== "string")
      errors.push(`${where("picture")}: the sound's picture (as soundPicture draws it) to measure against: a file, or { file, length, rate, row }`);
    for (const [k, variant] of (sound.variants ?? []).entries())
      if (typeof variant?.name !== "string" || !/^[a-z0-9_\-/]+\.wav$/.test(variant.name)) errors.push(`${where(`variants[${k}]`)}.name: the variant's own file under sound/`);
  }
  return { errors, warnings };
}

/** The seconds from a recording's start to its first hit: 5 ms before the first sample over a thirtieth of its peak. */
function onsetOf(x, rate) {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const over = peak / 31.6;
  const i = x.findIndex((v) => Math.abs(v) >= over);
  return Math.max(0, i / rate - 0.005);
}

/**
 * A sample layer with its recording: the file read (any PCM or float WAV, its channels mixed), brought to the
 * sound's rate, cut from `from` (seconds, or "onset": its first hit) for `length`, and what made it told from the
 * sidecar a generator writes beside it (`<file>.json`: model, prompt, seed, licence), a licence that does not
 * allow selling warned of.
 */
function sampleOf(layer, rate, readFile, fact, warn) {
  let wav;
  try {
    wav = readWav(readFile(layer.file));
  } catch (error) {
    throw new Error(`the sample ${layer.file}: ${error.message}`);
  }
  let pcm = resample(wav.x, wav.rate, rate);
  const from = layer.from === "onset" ? onsetOf(pcm, rate) : (layer.from ?? 0);
  pcm = pcm.subarray(Math.min(pcm.length, Math.round(from * rate)), layer.length ? Math.round((from + layer.length) * rate) : undefined);
  let made = null;
  try {
    made = JSON.parse(readFile(layer.file.replace(/\.wav$/i, ".json")).toString("utf8"));
  } catch {
    made = null;
  }
  fact(`sample ${layer.file}: ${wav.rate} Hz ${wav.channels > 1 ? `${wav.channels} channels mixed, ` : ""}from ${Math.round(from * 1000) / 1000} s, ${Math.round((pcm.length / rate) * 1000) / 1000} s at ${rate}${made ? `; made by ${made.model ?? "?"}${made.seed !== undefined ? ` seed ${made.seed}` : ""}${made.prompt ? ` from "${made.prompt}"` : ""}, licence ${made.licence ?? "not given"}${made.licence && NON_COMMERCIAL.test(made.licence) ? " (non-commercial)" : ""}` : "; no sidecar says what made it"}`);
  // the licence is a fact the person weighs, not a warning: a warning read as a reason to drop every take (Steven, 2026-10-15)
  if (!pcm.length) throw new Error(`the sample ${layer.file} has nothing after ${from} s`);
  return { ...layer, pcm, pcmRate: rate };
}

/**
 * The words that point a sound whose bands are off at the finish that fits them, unless it has it already:
 * the run 6 maker read "filter the layers" and never found `fit` (2026-10-17).
 */
const fitHint = (sound) => (sound.finish?.fit === "bands" ? "" : 'finish: { fit: "bands" } brings its bands there by arithmetic, a gain a band. ');

/** A game's own file of the sound folders given, read: { name, x, rate } or null. */
function referenceOf(name, games) {
  for (const game of games) {
    const file = join(game, "sound", name);
    if (existsSync(file)) {
      const wav = readWav(readFileSync(file));
      return { name: `the game's ${name}`, x: wav.x, rate: wav.rate };
    }
  }
  return null;
}

/**
 * A made sound's features against those read off a picture of the sound it is to be (`picture`, as
 * `soundPicture` draws it): the numbers the reproduction test's judge takes, each with how far off it is.
 * Measures only: nothing of the picture goes into the sound.
 */
function againstPicture(f, seen, sound) {
  const share = (a, b) => Math.abs(a - b) / (Math.abs(b) || 1e-9);
  const most = Object.keys(seen.bands).reduce((a, k) => (Math.abs(f.bands[k] - seen.bands[k]) > Math.abs(f.bands[a] - seen.bands[a]) ? k : a));
  const t20Range = seen.loop ? null : sound.class ? rangesOf(sound.class).t20 : [seen.t20 - Math.max(0.05, seen.t20 * 0.25), seen.t20 + Math.max(0.05, seen.t20 * 0.25)];
  return {
    length: seen.length,
    lengthOff: Math.round(share(f.length, seen.length) * 1000) / 1000,
    centroid: seen.centroid,
    centroidOff: Math.round(share(f.centroid, seen.centroid) * 1000) / 1000,
    bands: seen.bands,
    bandsOffMost: Math.round(Math.abs(f.bands[most] - seen.bands[most]) * 10) / 10,
    bandMostOff: most,
    t20: seen.t20,
    t20Range: t20Range && t20Range.map((v) => Math.round(v * 1000) / 1000),
    t20In: !t20Range || (f.t20 >= t20Range[0] && f.t20 <= t20Range[1]),
    crest: seen.crest,
    crestOff: Math.round((f.crest - seen.crest) * 10) / 10,
    onsets: seen.onsets,
    flatness: seen.flatness,
    // how many times flatter or more tonal than the picture: the copies of the reproduction test came out two to
    // twenty times more tonal than their originals, and the judges took S4 for it
    flatnessOff: typeof seen.flatness === "number" && typeof f.flatness === "number" ? ((a, b) => Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100)(Math.max(f.flatness, 0.001), Math.max(seen.flatness, 0.001)) : 1,
  };
}

/**
 * Builds a sound spec: each sound and each of its variants made, written as a file, checked, and measured
 * against its class and, with `picture`, against the numbers read off that picture. `games`: folders whose
 * sound/ the references are read from (never copied); `readPicture(name)` reads a picture the spec names
 * (unless given, from `folder`). Returns { report: { ok, errors, faults, warnings, facts, sounds }, files:
 * [{ name, bytes }], picture }.
 */
export function buildSoundSpec(spec, { games = [], folder = ".", readPicture = (name) => unpicture(readFileSync(resolve(folder, name))), readFile = (name) => readFileSync(resolve(folder, name)) } = {}) {
  const { errors, warnings } = validateSoundSpec(spec);
  const report = { ok: false, errors, faults: [], warnings, facts: [], sounds: {} };
  const files = [];
  const rows = [];
  if (errors.length) return { report, files, picture: null };
  for (const given of soundsOf(spec)) {
    // a copy: its sample layers are given their recordings below, and the caller's spec is left as it was
    const sound = { ...given };
    const rate = sound.rate ?? 22050;
    const bits = sound.bits ?? 16;
    // 8 bits is 256 steps: the dither that hides them is a hiss under every quiet tail, heard as static and as a
    // room that is not there (Steven, listening to the reproduction test's sounds, 2026-10-15). The engine plays
    // 16 as well: 8 only where the file must be small
    // steady noise is heard as static, and steady noise fading slowly as a reverb that is not there: Steven heard
    // both in the reproduction test's sounds, and their spectrograms showed an even wash where the game's own
    // break into grains and tones; taken out, the take under it was clean (2026-10-15)
    const noisy = sound.layers.map((layer, k) => ({ layer, k })).filter(({ layer }) => layer.kind === "noise" && !layer.post);
    const overTake = sound.layers.some((layer) => layer.kind === "sample") && noisy.length;
    if (overTake)
      warnings.push(`${sound.name}: ${noisy.length} noise layer${noisy.length > 1 ? "s" : ""} (${noisy.map(({ layer, k }) => layer.id ?? `layers[${k}]`).join(", ")}) over a recorded take: a take has its own texture, and steady noise added to it is heard as static (fading, as reverb). Shape the take with its filter and env instead; add a short crack (post: true) or particles for grain`);
    // modes laid over a take rang as a bell: Steven heard the crowbar's and the metal step's so, the only two of
    // ten sounds from a brief whose makers added them (2026-10-16)
    const rung = sound.layers.map((layer, k) => ({ layer, k })).filter(({ layer }) => layer.kind === "modes");
    if (sound.layers.some((layer) => layer.kind === "sample") && rung.length)
      warnings.push(`${sound.name}: ${rung.length} modes layer${rung.length > 1 ? "s" : ""} (${rung.map(({ layer, k }) => layer.id ?? `layers[${k}]`).join(", ")}) over a recorded take: a take has its own ring, and partials added to a hit or a step are heard as a bell. Choose a take that rings as wanted, or shape its own with a filter (a peak where it should ring) and its env`);
    if (!overTake) {
      const ringing = noisy.filter(({ layer }) => (layer.length ?? (layer.env?.points ? layer.env.points.at(-1)[0] : (layer.env?.attack ?? 0) + (layer.env?.hold ?? 0) + (layer.env?.decay ?? 0.3))) > 0.3 && !layer.shape?.keys);
      if (ringing.length)
        warnings.push(`${sound.name}: ${ringing.map(({ layer, k }) => layer.id ?? `layers[${k}]`).join(", ")}: smooth noise ringing past 0.3 s is heard as static and, as it fades, as a reverb; a real tail breaks into grains (particles, rate falling) and tones (modes): use those for a long tail, or a noise shape that moves (keys)`);
    }
    if (bits === 8) warnings.push(`${sound.name}: 8 bits adds a hiss under its quiet tail, heard as static (and, on a long tail, as reverb); the game plays 16 bits as well and a copy is not held to the original's depth: leave bits out (16) unless the file must be small`);
    const takes = [{ name: sound.name }, ...(sound.variants ?? [])];
    // its recordings read once, at the sound's rate
    try {
      sound.layers = sound.layers.map((layer, k) => (layer.kind === "sample" ? sampleOf(layer, rate, readFile, (line) => report.facts.push(`${sound.name}: layers[${k}]${layer.id ? ` (${layer.id})` : ""}: ${line}`), (line) => warnings.push(`${sound.name}: layers[${k}]${layer.id ? ` (${layer.id})` : ""}: ${line}`)) : layer));
    } catch (error) {
      errors.push(`${sound.name}: ${error.message}`);
      continue;
    }
    // the picture it is to be, read once: its numbers, never its samples
    let seen = null;
    if (sound.picture) {
      const given = typeof sound.picture === "string" ? { file: sound.picture } : sound.picture;
      try {
        seen = pictureMeasures(readPicture(given.file), { length: given.length, rate: given.rate, row: given.row });
      } catch (error) {
        warnings.push(`picture ${given.file}: ${error.message}`);
      }
    }
    for (const take of takes) {
      const made = { ...sound, seed: take.seed ?? sound.seed ?? 1, pitch: (sound.pitch ?? 0) + (take.pitch ?? 0) };
      let x;
      try {
        x = render(made, { rate });
      } catch (error) {
        errors.push(`${take.name}: ${error.message}`);
        continue;
      }
      // its power brought to the shares it is to have: the bands asked, its picture's, the game's own it takes the
      // place of, or the middle of its class's ranges, the first there is
      if (sound.finish?.fit === "bands") {
        const own = referenceOf(take.name, games);
        const ranges = sound.class ? rangesOf(sound.class) : null;
        const [target, from] = sound.bands
          ? [sound.bands, "the bands asked"]
          : seen
            ? [seen.bands, "its picture's"]
            : own
              ? [features({ x: own.x, rate: own.rate }).bands, `the game's own ${take.name}`]
              : ranges
                ? [Object.fromEntries(Object.entries(ranges).filter(([k]) => k.startsWith("band ")).map(([k, [lo, hi]]) => [k.slice(5), (lo + hi) / 2])), `the middle of the ${sound.class} class`]
                : [null, null];
        if (!target) {
          errors.push(`${take.name}: finish.fit "bands" has nothing to fit to: give it \`bands\`, a \`picture\`, a \`class\`, or the name of the game's own sound it takes the place of`);
          continue;
        }
        const fitted = fitBands(x, rate, target, { loop: !!sound.loop });
        x = normalise(fitted.x, sound.finish.peak ?? -0.5);
        report.facts.push(`${take.name}: fitted to the bands of ${from}, ${fitted.off} points off at most; gains ${Object.entries(fitted.gains).map(([k, g]) => `${k} ${g > 0 ? "+" : ""}${g} dB`).join(", ")}`);
      }
      if (take.gain) for (let i = 0; i < x.length; i++) x[i] *= 10 ** (take.gain / 20);
      const loop = sound.loop ? 0 : null;
      const bytes = writeWav(x, { rate, bits, loop, seed: made.seed });
      const wav = readWav(bytes);
      const checked = checks(wav, { loop: !!sound.loop });
      const f = checked.features;
      report.faults.push(...checked.faults.map((line) => `${take.name}: ${line}`));
      warnings.push(...checked.warnings.map((line) => `${take.name}: ${line}`));
      const entry = { rate, bits, bytes: bytes.length, features: f };
      report.facts.push(
        `${take.name}: ${rate} Hz ${bits}-bit mono${sound.loop ? ", looped from its start" : ""}, ${f.length} s, ${Math.round(bytes.length / 1024)} KB, peak ${f.peak} dBFS, RMS ${f.rms}, crest ${f.crest} dB`,
        `${take.name}: attack ${Math.round(f.attack * 1000)} ms, T20 ${f.t20} s, T40 ${f.t40} s, centroid ${f.centroid} Hz, flatness ${f.flatness}, onsets ${f.onsets}; power ${Object.entries(f.bands).map(([b, v]) => `${b} ${v}%`).join(", ")}`,
      );
      if (sound.class) {
        // what a listener hears where the numbers are off its class (Steven's listening, 2026-10-15): a hit that
        // swells to its peak is heard played backwards, and one that dies sooner than the game's as dry, in a
        // padded room
        if (STRUCK.has(sound.class) && f.attack > SWELL)
          warnings.push(`${take.name}: it takes ${f.attack} s to reach its peak, where the game's ${sound.class} sounds strike at once: a swell into a hit is heard as a sound played backwards. Start it at its hit (a sample's from: "onset"), an env with attack 0.002, or a crack at 0 (post: true)`);
        const t20Range = sound.loop ? null : rangesOf(sound.class).t20;
        if (t20Range && f.t20 < t20Range[0])
          warnings.push(`${take.name}: it dies to -20 dB in ${f.t20} s, sooner than the game's ${sound.class} sounds (${Math.round(t20Range[0] * 100) / 100} s at least): heard dry, as in a padded room. A short room (finish.room: { decay: 0.25, wet: 0.12 }) or a longer decay gives it the space theirs have; not noise, which is heard as static`);
        // its spectrum against its class's range, as a judge holds it: inside it (the original-creation mod's sounds kept
        // these in their facts and scored 0 on spectrum; past a margin, the judges still marked them 1)
        const ranges = rangesOf(sound.class);
        const spectrum = [];
        if (ranges.centroid) {
          const [lo, hi] = ranges.centroid;
          if (f.centroid < lo) spectrum.push(`centroid ${f.centroid} Hz under the class's ${Math.round(lo)} to ${Math.round(hi)}: too dark, more energy 600 to 5000 Hz`);
          else if (f.centroid > hi) spectrum.push(`centroid ${f.centroid} Hz over the class's ${Math.round(lo)} to ${Math.round(hi)}: too bright, less over 2000 Hz`);
        }
        for (const [key, [lo, hi]] of Object.entries(ranges).filter(([k]) => k.startsWith("band "))) {
          const v = f.bands[key.slice(5)];
          if (v < lo) spectrum.push(`${key.slice(5)} Hz holds ${v}% (the class's ${Math.round(lo)} to ${Math.round(hi)}): more there`);
          else if (v > hi) spectrum.push(`${key.slice(5)} Hz holds ${v}% (the class's ${Math.round(lo)} to ${Math.round(hi)}): less there`);
        }
        // only where the sound has no target of its own: a copy is held to its original (a description's bands, a
        // picture), and the class's range pulled the words leg's copies off theirs (a round of 0 of 10, 2026-10-16)
        if (spectrum.length && !sound.bands && !sound.picture)
          warnings.push(`${take.name}: its spectrum is off the game's ${sound.class} sounds, as a judge measures it: ${spectrum.join("; ")}. ${fitHint(sound)}Filter the layers (lowpass, highpass, a band) or change what makes it, and build again`);
        const scored = scoreAgainst(f, sound.class);
        entry.score = `${scored.score} of ${scored.of}`;
        report.facts.push(`${take.name}: against the game's ${sound.class} sounds, ${scored.score} of ${scored.of}${scored.lines.length ? `; off: ${scored.lines.join("; ")}` : ": every feature in range"}`);
      }
      // the shares a description gives (a words leg has no picture): each band held to them as to a picture's
      if (sound.bands && take.name === sound.name) {
        const off = Object.entries(sound.bands).map(([k, want]) => [k, Math.round((f.bands[k] - want) * 10) / 10]);
        report.facts.push(`${take.name}: its bands against the shares asked: ${off.map(([k, d]) => `${k} ${f.bands[k]}% for ${sound.bands[k]}% (${d > 0 ? "+" : ""}${d})`).join(", ")}`);
        const far = off.filter(([, d]) => Math.abs(d) > PICTURE_BANDS);
        if (far.length) warnings.push(`${take.name}: further from the bands asked than a copy should be: ${far.map(([k, d]) => `${k} ${d > 0 ? "+" : ""}${d} points`).join(", ")} (aim within ${PICTURE_BANDS}). ${fitHint(sound)}A filter (lowpass, highpass, a shelf) or a layer's gain moves them; build again`);
      }
      // the decay a description gives: held as a judge holds a copy with no class of its own, within a quarter
      if (sound.t20 !== undefined && take.name === sound.name) {
        const off = (f.t20 - sound.t20) / sound.t20;
        report.facts.push(`${take.name}: T20 ${f.t20} s against the ${sound.t20} s asked (${off > 0 ? "+" : ""}${Math.round(off * 100)}%)`);
        if (Math.abs(off) > T20_ASKED && Math.abs(f.t20 - sound.t20) > 0.05)
          warnings.push(`${take.name}: its decay is ${f.t20} s to 20 dB under its loudest, against the ${sound.t20} s asked (${Math.round(Math.abs(off) * 100)}% ${off > 0 ? "long: a shorter decay or a lower tail" : "short: a longer decay, or more of its tail"}; aim within ${T20_ASKED * 100}%)`);
      }
      // the hits a description counts, by the judge's own count (spectral flux peaks over its mean and two
      // deviations, which sees no hit in a sound's first frames: at 22050 Hz a lone hit 60 ms in counted, one 40 ms in
      // did not, and of three equal hits one counted): the .357's three made
      // two, the shotgun's and the crowbar's one made none, and the judges took S4 for each
      if (sound.onsets !== undefined && take.name === sound.name) {
        report.facts.push(`${take.name}: ${f.onsets} onsets against the ${sound.onsets} asked`);
        if (f.onsets !== sound.onsets)
          warnings.push(`${take.name}: ${f.onsets} onsets, as a judge counts them, against the ${sound.onsets} asked: ${f.onsets < sound.onsets ? "a hit the count does not see: a strike in its first frames is not counted (let it start a little quieter, the hit some 40 to 60 ms in), hits under 50 ms apart are one, and of several only those well over the sound's own mean rise count (make each later hit a step up from what is sounding, not a swell): build again and read the count" : "more hits than asked: a layer's grains or a ring that swells again counts as one"}`);
      }
      if (seen && take.name === sound.name) {
        const p = (entry.picture = againstPicture(f, seen, sound));
        report.facts.push(
          `${take.name}: against its picture (${p.length} s): length ${f.length} s (${Math.round(p.lengthOff * 100)}% off), centroid ${f.centroid} Hz to ${p.centroid} (${Math.round(p.centroidOff * 100)}% off), bands ${p.bandsOffMost} points off at most (${p.bandMostOff}), T20 ${f.t20} s${p.t20Range ? ` (${p.t20Range[0]} to ${p.t20Range[1]}${p.t20In ? "" : ": out"})` : ""}, crest ${f.crest} dB to about ${p.crest} (${p.crestOff > 0 ? "+" : ""}${p.crestOff}; read off the outline, within 3 dB), flatness ${f.flatness} to ${p.flatness}, onsets ${f.onsets} to ${p.onsets}`,
        );
        // a copy is held to its original within 20% of centroid, 10 points of each band and its decay's range (the
        // reproduction test's S2 and S3): warned of short of those, by the margin a picture's reading may be off
        const far = [
          p.centroidOff > PICTURE_CENTROID ? `centroid ${Math.round(p.centroidOff * 100)}% off (aim within ${PICTURE_CENTROID * 100}%)` : null,
          p.bandsOffMost > PICTURE_BANDS ? `${p.bandMostOff} ${p.bandsOffMost} points off (aim within ${PICTURE_BANDS}: ${f.bands[p.bandMostOff]}% against ${p.bands[p.bandMostOff]}%)` : null,
          p.lengthOff > 0.1 ? `length ${Math.round(p.lengthOff * 100)}% off` : null,
          p.t20Range && !p.t20In ? `T20 ${f.t20} s outside ${p.t20Range[0]} to ${p.t20Range[1]}` : null,
          p.flatnessOff > PICTURE_FLATNESS
            ? f.flatness < p.flatness
              ? `flatness ${f.flatness} against ${p.flatness}: ${p.flatnessOff} times too tonal, its rings and lines louder than the picture's noise (shorten the modes' decay or lower their gain, raise the noise or particles under them, or take another take)`
              : `flatness ${f.flatness} against ${p.flatness}: ${p.flatnessOff} times too noisy, the picture's tones under its noise (a modes or tone layer at the picture's lines, the noise lower)`
            : null,
        ].filter(Boolean);
        if (far.length) warnings.push(`${take.name}: further from its picture than a copy should be: ${far.join("; ")}. ${far.some((line) => /points off/.test(line)) ? fitHint(sound) : ""}Bring it nearer (a filter, a layer's gain, the decay, another take) and build again`);
      }
      // a sound in the place of one of the game's own (its name, in the game folders given) is held to that sound as a
      // judge holds it: its spectrum and length. The original-creation mod's crawler, given no class, scored 4 of 10
      // with nothing to tell its maker why
      const own = referenceOf(take.name, games);
      if (own) {
        const g = features({ x: own.x, rate: own.rate });
        const off = [];
        if (g.centroid > 0 && Math.abs(f.centroid - g.centroid) / g.centroid > 0.2)
          off.push(`centroid ${f.centroid} Hz against its ${g.centroid}: ${f.centroid < g.centroid ? "too dark, more energy higher up" : "too bright, less higher up"}`);
        for (const k of Object.keys(g.bands)) if (Math.abs(f.bands[k] - g.bands[k]) > 10) off.push(`${k} Hz ${f.bands[k]}% against its ${g.bands[k]}%`);
        if (Math.abs(f.length - g.length) / Math.max(g.length, 0.01) > 0.25) off.push(`${f.length} s long against its ${Math.round(g.length * 1000) / 1000} s`);
        report.facts.push(`${take.name}: takes the place of the game's own ${take.name} (centroid ${g.centroid} Hz, ${Math.round(g.length * 1000) / 1000} s)`);
        if (off.length) warnings.push(`${take.name}: far from the game's own sound it takes the place of, as a judge measures it: ${off.join("; ")}. ${off.some((line) => /%/.test(line)) ? fitHint(sound) : ""}Bring it nearer and build again`);
      }
      report.sounds[take.name] = entry;
      files.push({ name: take.name, bytes });
      rows.push({ name: take.name, x, rate, loop });
    }
    // the game's own files of its kind, drawn under it to be compared (read from the person's install)
    const asked = [sound.reference ?? []].flat();
    const references = asked.length ? asked : sound.class ? CLASSES[sound.class].slice(0, 1).map((r) => r.file) : [];
    for (const name of references) {
      const reference = referenceOf(name, games);
      if (reference) rows.push(reference);
      else if (asked.length) warnings.push(`reference ${name}: in none of the game folders given (${games.join(", ") || "none"})`);
    }
  }
  report.facts.push("what cannot be checked here: how it sounds to a person, and in the game: its volume and pitch as the code plays it, the map's room (env_sound), the mix. Listen in the game.");
  report.ok = !errors.length && !report.faults.length;
  return { report, files, picture: rows.length ? soundPicture(rows) : null };
}
