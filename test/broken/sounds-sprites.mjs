// Sounds and sprites broken in one way each: a sound in two channels, at a rate the engine has not, clipped, late
// to start, ending in a click, a loop with no cue point or a jump at its seam; a sprite whose light reaches its
// border, and a one-shot that does not end dark. Each made here from a formula.
import * as smak from "../../src/index.mjs";
import { buildSpriteSpec } from "../../make/sprite/spec.mjs";
import { broken } from "./case.mjs";

const A = smak.audio;
const RATE = 22050;
const signal = (seconds, f) => Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => f(i / RATE, i));
/** A sound as written and read back: the samples, `rate`, `bits`, `loop` (its cue point). */
const wav = (x, options) => A.readWav(A.writeWav(x, options));
// a ping that dies away well before its end, starts at once and ends at nothing
const ping = () => signal(0.3, (t) => 0.8 * Math.sin(2 * Math.PI * 300 * t) * Math.exp(-20 * t) * (t < 0.29 ? 1 : 0));
// a hum of whole cycles: 60 Hz in 22050 samples a second is 367.5 a cycle, so two seconds are 120 cycles
const hum = () => signal(2, (t) => 0.5 * Math.sin(2 * Math.PI * 60 * t));
const faultsOf = (read, options) => A.checks(read, options).faults;

broken("audio.checks", "a sound in two channels", {
  said: /^2 channels: GoldSrc plays mono only$/,
  broken: () => faultsOf({ ...wav(ping()), channels: 2 }),
  whole: () => faultsOf(wav(ping())),
});

broken("audio.checks", "a rate of 32000", {
  said: /^32000 Hz: 11025, 22050 or 44100$/,
  broken: () => faultsOf({ ...wav(ping()), rate: 32000 }),
  whole: () => faultsOf(wav(ping())),
});

broken("audio.checks", "a run of samples at full scale", {
  said: /^clipped: \d+ samples in a row at full scale$/,
  broken: () => faultsOf(wav(signal(0.3, (t) => Math.max(-1, Math.min(1, 3 * Math.sin(2 * Math.PI * 300 * t) * Math.exp(-20 * t) * (t < 0.29 ? 1 : 0)))))), // prettier-ignore
  whole: () => faultsOf(wav(ping())),
});

broken("audio.checks", "a tenth of a second of silence before it starts", {
  said: /^\d+ ms of silence before it starts: it plays late$/,
  broken: () => faultsOf(wav(signal(0.4, (t) => (t < 0.1 ? 0 : 0.8 * Math.sin(2 * Math.PI * 300 * (t - 0.1)) * Math.exp(-20 * (t - 0.1)) * (t < 0.39 ? 1 : 0))))), // prettier-ignore
  whole: () => faultsOf(wav(ping())),
});

broken("audio.checks", "a one-shot cut off while it still rings: it ends in a click", {
  said: /^its last samples are at 0\.\d\d of full scale: it ends in a click; fade its end$/,
  broken: () => faultsOf(wav(signal(0.3, (t) => 0.8 * Math.sin(2 * Math.PI * 300 * t) * Math.exp(-3 * t)))),
  whole: () => faultsOf(wav(ping())),
});

broken("audio.checks", "a loop with no cue point", {
  said: /^it is to loop and has no cue point: the engine plays it once$/,
  broken: () => faultsOf(wav(hum()), { loop: true }),
  whole: () => faultsOf(wav(hum(), { loop: 0 }), { loop: true }),
});

broken("audio.checks", "a loop a quarter of a cycle short: a jump at its seam", {
  said: /^its loop jumps by [\d.]+ at the seam/,
  broken: () => faultsOf(wav(signal(2 - 1 / 240, (t) => 0.5 * Math.sin(2 * Math.PI * 60 * t)), { loop: 0 }), { loop: true }), // prettier-ignore
  whole: () => faultsOf(wav(hum(), { loop: 0 }), { loop: true }),
});

// ── buildSpriteSpec: a sprite's frames measured as the engine draws them ──

const sprite = (layer, more = {}) => buildSpriteSpec({ spec: "smak.sprite/1", name: "sprites/t.spr", size: [32, 32], frames: 4, layers: [{ kind: "glow", colour: [1, 0.6, 0.2], ...layer }], ...more }).report.faults; // prettier-ignore

broken("buildSpriteSpec", "a glow so wide its light reaches the frame's border", {
  said: /^sprites\/t\.spr: light at its border \(mean [\d.]+\): the frame's square shows/,
  broken: () => sprite({ radius: 3, core: 0.9 }),
  whole: () => sprite({ radius: 0.35, core: 0.2 }),
});

broken("buildSpriteSpec", "an explosion (it plays once) that does not end dark", {
  said: /^sprites\/t\.spr: a explosion plays once and must end dark; its last frame is [\d.]+ of its peak/,
  broken: () => sprite({ radius: 0.35, core: 0.2 }, { class: "explosion" }),
  whole: () => sprite({ radius: 0.35, core: 0.2, env: { attack: 0.05, decay: 0.9 } }, { class: "explosion" }),
});
