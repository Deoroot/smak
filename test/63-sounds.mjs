// Sounds: a GoldSrc file written and read back (8 and 16 bit, a cue point), measured in known signals, made
// from a spec the same way every time, checked as the engine needs it, and built by the tool.
import { readFileSync, existsSync, mkdirSync as mkdirOf, writeFileSync as writeOf } from "node:fs";
import { join, delimiter } from "node:path";
import * as smak from "../src/index.mjs";
import { test, sure, tmp, runSmak, runRefused, SMAK_CLI } from "./helper.mjs";
import { buildSoundSpec, validateSoundSpec } from "../src/audio/spec.mjs";
import { writeFileSync, mkdirSync } from "node:fs";

const { audio: A } = smak;
const RATE = 22050;
const signal = (seconds, f) => Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => f(i / RATE, i));

test("a sound file: mono PCM written and read back, 8 and 16 bit, with the one cue point a loop wants", () => {
  const x = signal(0.2, (t) => 0.5 * Math.sin(2 * Math.PI * 440 * t));
  const sixteen = A.readWav(A.writeWav(x, { rate: RATE, bits: 16 }));
  sure(sixteen.format === 1 && sixteen.channels === 1 && sixteen.bits === 16 && sixteen.rate === RATE && sixteen.samples === x.length, JSON.stringify({ ...sixteen, x: undefined }));
  sure(sixteen.x.every((v, i) => Math.abs(v - x[i]) < 1e-4) && sixteen.cue === null, "16 bit: the same samples, no cue");
  const looped = A.readWav(A.writeWav(x, { rate: 11025, bits: 8, loop: 2339 }));
  sure(looped.bits === 8 && looped.rate === 11025 && looped.cue?.[0] === 2339 && looped.x.every((v, i) => Math.abs(v - x[i]) < 0.02), `8 bit with a cue at 2339: ${looped.cue}`);
  const again = A.writeWav(x, { bits: 8, loop: 0, seed: 5 });
  sure(again.equals(A.writeWav(x, { bits: 8, loop: 0, seed: 5 })), "the dither is seeded: the same bytes every time");
  let refused = "";
  try {
    A.writeWav(x, { rate: 32000 });
  } catch (error) {
    refused = error.message;
  }
  sure(/a rate of 11025, 22050, 44100 Hz/.test(refused), refused);
});

test("a sound's features: a tone, white noise and a dying ping measure what they are", () => {
  const tone = A.features({ x: signal(0.5, (t) => 0.5 * Math.sin(2 * Math.PI * 1000 * t)), rate: RATE });
  sure(Math.abs(tone.centroid - 1000) < 40 && tone.flatness < 0.01 && Math.abs(tone.crest - 3) < 0.2 && tone.length === 0.5, `a 1000 Hz tone: ${JSON.stringify(tone)}`);
  sure(tone.bands["600-2k"] > 95, `its power between 600 and 2000 Hz: ${JSON.stringify(tone.bands)}`);
  const random = A.seeded(9);
  const noise = A.features({ x: signal(0.5, () => random() * 2 - 1), rate: RATE });
  sure(noise.flatness > 0.5 && noise.centroid > 4000, `white noise is flat and bright: ${noise.flatness} ${noise.centroid}`);
  // the same noise at the game's 11025 and at 22050 is as flat: an empty top half of a faster file counts for nothing
  const slow = signal(0.25, () => random() * 2 - 1);
  const [at11, at22] = [A.features({ x: slow, rate: 11025 }).flatness, A.features({ x: A.resample(slow, 11025, 22050), rate: 22050 }).flatness];
  sure(Math.abs(at11 - at22) < 0.1 * at11, `as flat at either rate: ${at11} at 11025, ${at22} at 22050`);
  // falls 60 dB in 0.3 s: 20 dB in 0.1 s, 40 in 0.2
  const ping = A.features({ x: signal(0.6, (t) => Math.sin(2 * Math.PI * 800 * t) * Math.exp((-6.9078 * t) / 0.3)), rate: RATE });
  sure(Math.abs(ping.t20 - 0.1) < 0.012 && Math.abs(ping.t40 - 0.2) < 0.015 && ping.attack < 0.01, `a ping that dies in 0.3 s: T20 ${ping.t20} T40 ${ping.t40}`);
});

test("the checks a played file must pass: clipping, an offset, a late start, an end that clicks, a loop's cue and seam", () => {
  const wav = (x, options) => A.readWav(A.writeWav(x, options));
  const clean = A.checks(wav(signal(0.3, (t) => 0.8 * Math.sin(2 * Math.PI * 300 * t) * Math.exp(-20 * t) * (t < 0.29 ? 1 : 0))));
  sure(clean.faults.length === 0, `a clean one-shot: ${clean.faults}`);
  const faults = A.checks(wav(signal(0.3, (t) => (t < 0.05 ? 0 : t < 0.1 ? 1 : 0.3 + 0.2 * Math.sin(2 * Math.PI * 200 * t))))).faults.join(" | ");
  sure(/clipped/.test(faults) && /DC offset/.test(faults) && /silence before it starts/.test(faults) && /ends in a click/.test(faults), faults);
  const hum = signal(1, (t) => 0.5 * Math.sin(2 * Math.PI * 50.25 * t));
  sure(/no cue point/.test(A.checks(wav(hum), { loop: true }).faults.join()), "a loop without a cue is played once");
  sure(/jumps by .* at the seam/.test(A.checks(wav(hum, { loop: 0 }), { loop: true }).faults.join()), "a quarter of a cycle short, its end at a peak: a click every time round");
  // a loop of one drip and then silence is a one-shot with a gap after it (Haiku's drips: silent 95%); a hum is not
  const drip = signal(4, (t) => (t < 0.2 ? 0.6 * Math.sin(2 * Math.PI * 900 * t) * Math.exp(-30 * t) : 0));
  sure(/silent 9\d% of the time/.test(A.checks(wav(drip, { loop: 0 }), { loop: true }).faults.join()), A.checks(wav(drip, { loop: 0 }), { loop: true }).faults.join());
  sure(!/silent/.test(A.checks(wav(hum, { loop: 0 }), { loop: true }).faults.join()), "a hum is never silent");
});

const HIT = {
  spec: "smak.sound/1",
  name: "weapons/cbar_hit1.wav",
  class: "metal hit",
  seed: 3,
  layers: [
    { id: "click", kind: "noise", filter: [{ type: "highpass", f: 1500 }], env: { decay: 0.012 }, gain: -2 },
    { id: "ring", kind: "modes", f: 760, ratios: "bar", decay: 0.7, damping: 1.2 },
  ],
  finish: { saturate: 1.5, room: { decay: 0.35, wet: 0.15 } },
  variants: [{ name: "weapons/cbar_hit2.wav", seed: 4, pitch: 3 }],
};

test("a sound spec: built the same every time, its variants, held against its class, its mistakes said", () => {
  const first = A.buildSoundSpec(HIT);
  sure(first.report.ok && first.files.length === 2, [...first.report.errors, ...first.report.faults].join("; "));
  sure(first.files[0].bytes.equals(A.buildSoundSpec(HIT).files[0].bytes), "the same spec, the same bytes");
  sure(!first.files[0].bytes.equals(first.files[1].bytes), "a variant is another sound");
  sure(first.report.facts.some((f) => /cbar_hit1.wav: against the game's metal hit sounds, \d+ of 22/.test(f)), first.report.facts.join(" | "));
  sure(first.picture && first.picture.width === 640 && first.picture.height > 400, "a picture of the two");
  const loop = A.buildSoundSpec({ spec: "smak.sound/1", name: "ambience/hum.wav", class: "loop machine", length: 2.5, loop: { crossfade: 0.3 }, layers: [{ kind: "tone", f: 60, env: { attack: 0.01, hold: 3 } }, { kind: "noise", color: "pink", filter: [{ type: "bandpass", f: 300 }], gain: -14, env: { attack: 0.01, hold: 3 } }] });
  sure(loop.report.ok && A.readWav(loop.files[0].bytes).cue?.[0] === 0, `a loop with its cue and a smooth seam: ${[...loop.report.errors, ...loop.report.faults]}`);
  // a ring cut off long before it has died (its layer 0.2 s, its decay 1 s) is faded at its end: no click
  // inside the sound, which the wrench's hits had before (a stripe down the spectrogram)
  const cut = A.render({ length: 0.4, finish: { trim: false }, layers: [{ kind: "modes", f: 700, decay: 1, length: 0.2 }, { kind: "noise", gain: -60, length: 0.4 }] }, { rate: RATE });
  const at = Math.round(0.2 * RATE);
  const jump = Math.max(...Array.from({ length: 6 }, (_, i) => Math.abs(cut[at - 3 + i] - cut[at - 4 + i])));
  const step = Math.max(...Array.from({ length: 200 }, (_, i) => Math.abs(cut[at - 400 + i] - cut[at - 401 + i])));
  sure(jump <= step, `no step at the layer's end: ${jump.toFixed(4)} against ${step.toFixed(4)} before it`);
  const wrong = A.validateSoundSpec({ spec: "smak.sound/1", name: "Weapons/Hit 1.wav", class: "clang", layers: [{ kind: "chime" }, { kind: "modes", ratios: "drum" }] });
  const said = wrong.errors.join(" | ");
  sure(/name: the file's path under sound\/, lower case/.test(said) && /class: one of metal hit/.test(said) && /kind: noise, tone, fm, modes, particles/.test(said) && /ratios: bar, clamped/.test(said), said);
});

test("finish.fit brings a sound's power to its bands: those asked, or its class's middle; with nothing to fit to, refused", () => {
  const want = { "<150": 5, "150-600": 10, "600-2k": 60, "2k-5k": 20, ">5k": 5 };
  const noise = [{ kind: "noise", color: "pink", env: { attack: 0.002, decay: 0.3 } }];
  const fitted = A.buildSoundSpec({ spec: "smak.sound/1", name: "x/fit.wav", length: 0.5, layers: noise, bands: want, finish: { fit: "bands" } });
  const got = A.features({ x: A.readWav(fitted.files[0].bytes).x, rate: RATE }).bands;
  sure(Object.keys(want).every((k) => Math.abs(got[k] - want[k]) < 2.5), `the bands asked: ${JSON.stringify(got)}`);
  sure(fitted.report.facts.some((f) => /fit\.wav: fitted to the bands of the bands asked, [\d.]+ points off at most; gains <150/.test(f)), fitted.report.facts.join(" | "));
  const classed = A.buildSoundSpec({ spec: "smak.sound/1", name: "x/swing.wav", class: "swing", length: 0.4, layers: noise, finish: { fit: "bands" } });
  sure(classed.report.facts.some((f) => /fitted to the bands of the middle of the swing class/.test(f)), classed.report.facts.join(" | "));
  const ranges = A.rangesOf("swing");
  const swung = A.features({ x: A.readWav(classed.files[0].bytes).x, rate: RATE }).bands;
  sure(Object.keys(swung).every((k) => swung[k] >= ranges[`band ${k}`][0] && swung[k] <= ranges[`band ${k}`][1]), `inside the class's bands: ${JSON.stringify(swung)}`);
  // off its class's bands without the fit, its warning names it
  const unfitted = A.buildSoundSpec({ spec: "smak.sound/1", name: "x/swing2.wav", class: "swing", length: 0.4, layers: noise });
  sure(unfitted.report.warnings.some((w) => /off the game's swing sounds.*finish: \{ fit: "bands" \} brings its bands there/.test(w)), unfitted.report.warnings.join(" | "));
  const none = A.buildSoundSpec({ spec: "smak.sound/1", name: "x/none.wav", length: 0.3, layers: noise, finish: { fit: "bands" } });
  sure(none.report.errors.some((e) => /nothing to fit to/.test(e)), none.report.errors.join(" | "));
  sure(A.validateSoundSpec({ spec: "smak.sound/1", name: "x/a.wav", layers: noise, finish: { fit: "eq" } }).errors.some((e) => /finish\.fit: "bands"/.test(e)), "another fit refused");
});

/** The bytes of a WAVE file a generator writes: stereo, at 48 kHz, as 24-bit whole numbers or 32-bit floats, plain or extensible. */
function generated(left, right, { rate = 48000, bits = 32, float = true, extensible = false } = {}) {
  const width = bits / 8;
  const data = Buffer.alloc(left.length * 2 * width);
  left.forEach((v, i) =>
    [v, right[i]].forEach((s, c) => {
      const o = (i * 2 + c) * width;
      if (float) data.writeFloatLE(s, o);
      else data.writeIntLE(Math.round(s * 8388607), o, 3);
    }),
  );
  const fmt = Buffer.alloc(extensible ? 40 : 16);
  fmt.writeUInt16LE(extensible ? 0xfffe : float ? 3 : 1, 0);
  fmt.writeUInt16LE(2, 2);
  fmt.writeUInt32LE(rate, 4);
  fmt.writeUInt32LE(rate * 2 * width, 8);
  fmt.writeUInt16LE(2 * width, 12);
  fmt.writeUInt16LE(bits, 14);
  if (extensible) {
    fmt.writeUInt16LE(22, 16);
    fmt.writeUInt16LE(float ? 3 : 1, 24);
  }
  const chunk = (id, body) => Buffer.concat([Buffer.from(id, "ascii"), Buffer.from(Uint32Array.of(body.length).buffer), body]);
  return chunk("RIFF", Buffer.concat([Buffer.from("WAVE", "ascii"), chunk("fmt ", fmt), chunk("data", data)]));
}

test("a generator's take read whole: 24-bit and float, plain and extensible, its channels mixed, brought to the game's rate", () => {
  const n = 4800;
  const left = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / 48000));
  const right = Float32Array.from(left, (v) => v * 0.5);
  for (const kind of [{ float: true }, { float: false, bits: 24 }, { float: true, extensible: true }, { float: false, bits: 24, extensible: true }]) {
    const wav = A.readWav(generated(left, right, kind));
    sure(wav.rate === 48000 && wav.channels === 2 && wav.samples === n && wav.x.every((v, i) => Math.abs(v - 0.75 * left[i]) < 1e-5), `${JSON.stringify(kind)}: ${wav.format} ${wav.bits}`);
  }
  // to 22050: the tone kept at its level, a tone over the new rate's half taken out, not folded down
  const both = Float32Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / 48000) + 0.5 * Math.sin((2 * Math.PI * 20000 * i) / 48000));
  const y = A.resample(both, 48000, RATE);
  const inner = y.subarray(500, -500);
  const rms = Math.sqrt(inner.reduce((s, v) => s + v * v, 0) / inner.length);
  sure(y.length === RATE && Math.abs(rms - Math.SQRT1_2) < 0.005, `${y.length} samples, rms ${rms}`);
});

test("a sample layer: a generator's take cut at its first hit, brought to the sound's rate, filtered, and what made it told", () => {
  const folder = join(tmp, "sampled");
  mkdirSync(join(folder, "gen"), { recursive: true });
  // 0.3 s of nothing, then a ringing hit for 0.5 s, at 48 kHz in stereo floats
  const hit = Float32Array.from({ length: 38400 }, (_, i) => (i < 14400 ? 0 : 0.8 * Math.exp(-(i - 14400) / 4000) * Math.sin((2 * Math.PI * 800 * (i - 14400)) / 48000)));
  writeFileSync(join(folder, "gen", "hit_s2.wav"), generated(hit, hit));
  writeFileSync(join(folder, "gen", "hit_s2.json"), JSON.stringify({ model: "woosh-dflow", seed: 2, prompt: "a wrench hitting a pipe", licence: "CC-BY-NC 4.0" }));
  const spec = { spec: "smak.sound/1", name: "weapons/cbar_hit1.wav", class: "metal hit", layers: [{ id: "take", kind: "sample", file: "gen/hit_s2.wav", from: "onset", filter: [{ type: "highpass", f: 200 }] }] };
  const { report, files } = buildSoundSpec(spec, { folder });
  sure(!report.errors.length, report.errors.join("; "));
  const made = A.readWav(files[0].bytes);
  // its first hit at the start, not 0.3 s in, and the file not cut longer than the take after it
  const firstLoud = made.x.findIndex((v) => Math.abs(v) > 0.05);
  sure(made.rate === RATE && firstLoud < RATE * 0.02 && made.samples <= RATE * 0.52, `rate ${made.rate}, first loud sample ${firstLoud}, ${made.samples} samples`);
  sure(report.facts.some((f) => /sample gen\/hit_s2\.wav: 48000 Hz 2 channels mixed, from 0\.29\d? s.*woosh-dflow seed 2 from "a wrench hitting a pipe", licence CC-BY-NC 4\.0/.test(f)), report.facts.join(" | "));
  sure(report.facts.some((f) => /licence CC-BY-NC 4\.0 \(non-commercial\)/.test(f)) && !report.warnings.some((w) => /licen/i.test(w)), [...report.facts, ...report.warnings].join(" | "));
  sure(spec.layers[0].pcm === undefined, "the caller's spec left as it was");
  const missing = buildSoundSpec({ ...spec, layers: [{ kind: "sample", file: "gen/none.wav" }] }, { folder });
  sure(missing.report.errors.some((e) => /the sample gen\/none\.wav/.test(e)), missing.report.errors.join("; "));
  const bad = validateSoundSpec({ ...spec, layers: [{ kind: "sample", from: -1 }] });
  sure(bad.errors.some((e) => /\.file: a \.wav/.test(e)) && bad.errors.some((e) => /\.from: seconds/.test(e)), bad.errors.join("; "));
});

test("loudness as broadcasters measure it: EBU's stereo tone at -23 LUFS, at any rate", () => {
  for (const rate of [48000, 44100, 22050]) {
    const x = Float32Array.from({ length: rate * 10 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / rate) * 10 ** (-23 / 20));
    const both = A.loudness([x, x], rate);
    sure(both.lufs === -23 && A.loudness([x], rate).lufs === -26 && both.peak === -23 && both.range === 0, `${rate}: ${JSON.stringify(both)}`);
  }
});

test("a sound further from its picture than a copy is held to is warned of, and one near it is not", () => {
  const folder = join(tmp, "near-picture");
  mkdirSync(folder, { recursive: true });
  // the picture: a low thump; one sound made like it, one bright hiss
  const thump = { kind: "tone", f: 120, env: { decay: 0.25 } };
  const made = buildSoundSpec({ spec: "smak.sound/1", name: "x/thump.wav", layers: [thump] }, { folder });
  const wav = A.readWav(made.files[0].bytes);
  const pic = A.soundPicture([{ name: "x/thump.wav", x: wav.x, rate: wav.rate }], { width: 960 });
  writeFileSync(join(folder, "thump.png"), smak.png(pic.width, pic.height, pic.rgba));
  const near = buildSoundSpec({ spec: "smak.sound/1", name: "x/near.wav", picture: "thump.png", layers: [thump] }, { folder });
  sure(!near.report.warnings.some((w) => /further from its picture/.test(w)), near.report.warnings.join(" | "));
  const far = buildSoundSpec({ spec: "smak.sound/1", name: "x/far.wav", picture: "thump.png", layers: [{ kind: "noise", filter: [{ type: "highpass", f: 3000 }], env: { decay: 0.25 } }] }, { folder });
  sure(far.report.warnings.some((w) => /x\/far\.wav: further from its picture than a copy should be: centroid \d+% off \(aim within 15%\)/.test(w)), far.report.warnings.join(" | "));
  // flatness: a crash of noise round 1 kHz in the picture; the same noise is near it, a ring at 1 kHz too tonal
  const crash = { kind: "noise", filter: [{ type: "bandpass", f: 1000, q: 0.7 }], env: { decay: 0.3 } };
  const crashed = buildSoundSpec({ spec: "smak.sound/1", name: "x/crash.wav", layers: [crash] }, { folder });
  const cw = A.readWav(crashed.files[0].bytes);
  const cpic = A.soundPicture([{ name: "x/crash.wav", x: cw.x, rate: cw.rate }], { width: 960 });
  writeFileSync(join(folder, "crash.png"), smak.png(cpic.width, cpic.height, cpic.rgba));
  const same = buildSoundSpec({ spec: "smak.sound/1", name: "x/same.wav", picture: "crash.png", layers: [crash] }, { folder });
  sure(!same.report.warnings.some((w) => /flatness/.test(w)) && same.report.facts.some((f) => /flatness [\d.]+ to [\d.]+/.test(f)), [...same.report.warnings, ...same.report.facts].join(" | "));
  const rung = buildSoundSpec({ spec: "smak.sound/1", name: "x/rung.wav", picture: "crash.png", layers: [{ kind: "modes", f: 1000, ratios: "bar", decay: 0.3 }] }, { folder });
  sure(rung.report.warnings.some((w) => /x\/rung\.wav: further from its picture.*flatness [\d.]+ against [\d.]+: [\d.]+ times too tonal/.test(w)), rung.report.warnings.join(" | "));
});

test("an 8-bit sound is warned of for its hiss; 16 bits, the default, is not", () => {
  const spec = (bits) => ({ spec: "smak.sound/1", name: "x/tick.wav", ...(bits ? { bits } : {}), layers: [{ kind: "tone", f: 440, env: { decay: 0.2 } }] });
  sure(buildSoundSpec(spec(8)).report.warnings.some((w) => /x\/tick\.wav: 8 bits adds a hiss under its quiet tail/.test(w)), "8 bits warned of");
  sure(!buildSoundSpec(spec()).report.warnings.some((w) => /8 bits/.test(w)), "16 bits not");
});

test("noise over a take, and smooth noise ringing past 0.3 s, are warned of as static and reverb", () => {
  const folder = join(tmp, "noisy");
  mkdirSync(join(folder, "gen"), { recursive: true });
  const take = Float32Array.from({ length: 24000 }, (_, i) => 0.5 * Math.exp(-i / 3000) * Math.sin((2 * Math.PI * 500 * i) / 48000));
  writeFileSync(join(folder, "gen", "t_s0.wav"), generated(take, take));
  const base = { spec: "smak.sound/1", name: "x/hit.wav" };
  const over = buildSoundSpec({ ...base, layers: [{ kind: "sample", file: "gen/t_s0.wav" }, { id: "body", kind: "noise", env: { decay: 0.2 } }] }, { folder });
  sure(over.report.warnings.some((w) => /1 noise layer \(body\) over a recorded take/.test(w)), over.report.warnings.join(" | "));
  const long = buildSoundSpec({ ...base, layers: [{ id: "wash", kind: "noise", env: { decay: 0.8 } }] }, { folder });
  sure(long.report.warnings.some((w) => /wash: smooth noise ringing past 0\.3 s/.test(w)), long.report.warnings.join(" | "));
  const short = buildSoundSpec({ ...base, layers: [{ id: "crack", kind: "noise", env: { decay: 0.05 } }, { kind: "modes", f: 600, decay: 0.6 }] }, { folder });
  sure(!short.report.warnings.some((w) => /static/.test(w)), short.report.warnings.join(" | "));
});

test("modes over a take are warned of as a bell; modes alone are not", () => {
  const folder = join(tmp, "rung");
  mkdirSync(join(folder, "gen"), { recursive: true });
  const take = Float32Array.from({ length: 24000 }, (_, i) => 0.5 * Math.exp(-i / 3000) * Math.sin((2 * Math.PI * 500 * i) / 48000));
  writeFileSync(join(folder, "gen", "t_s0.wav"), generated(take, take));
  const base = { spec: "smak.sound/1", name: "x/hit.wav" }, ring = { id: "ring", kind: "modes", f: 1000, decay: 0.6 };
  const over = buildSoundSpec({ ...base, layers: [{ kind: "sample", file: "gen/t_s0.wav" }, ring] }, { folder });
  sure(over.report.warnings.some((w) => /1 modes layer \(ring\) over a recorded take/.test(w)), over.report.warnings.join(" | "));
  const alone = buildSoundSpec({ ...base, layers: [ring] }, { folder });
  sure(!alone.report.warnings.some((w) => /bell/.test(w)), alone.report.warnings.join(" | "));
});

test("a hit that swells to its peak is warned of as played backwards, and one that dies early as dry", () => {
  const swell = buildSoundSpec({ spec: "smak.sound/1", name: "x/shot.wav", class: "gunshot", layers: [{ kind: "noise", color: "pink", env: { attack: 0.15, decay: 0.2 }, filter: [{ type: "lowpass", f: 2000 }] }] });
  sure(swell.report.warnings.some((w) => /x\/shot\.wav: it takes [\d.]+ s to reach its peak.*played backwards/.test(w)), swell.report.warnings.join(" | "));
  const dry = buildSoundSpec({ spec: "smak.sound/1", name: "x/step.wav", class: "step metal", layers: [{ kind: "modes", f: 300, decay: 0.12 }] });
  sure(dry.report.warnings.some((w) => /x\/step\.wav: it dies to -20 dB in [\d.]+ s, sooner than the game's step metal sounds.*padded room/.test(w)), dry.report.warnings.join(" | "));
  const fine = buildSoundSpec({ spec: "smak.sound/1", name: "x/ok.wav", class: "step metal", layers: [{ kind: "modes", f: 300, decay: 1.3 }] });
  sure(!fine.report.warnings.some((w) => /played backwards|padded room/.test(w)), fine.report.warnings.join(" | "));
});

test("a sound held to the band shares a description gives: off by more than 7 points is warned of", () => {
  const spec = (bands) => ({ spec: "smak.sound/1", name: "x/low.wav", bands, layers: [{ kind: "tone", f: 100, env: { decay: 0.3 } }] });
  const near = buildSoundSpec(spec({ "<150": 95 }));
  sure(near.report.facts.some((f) => /its bands against the shares asked: <150 9\d(\.\d)?% for 95%/.test(f)) && !near.report.warnings.some((w) => /bands asked/.test(w)), [...near.report.facts, ...near.report.warnings].join(" | "));
  const far = buildSoundSpec(spec({ "<150": 10, "600-2k": 60 }));
  sure(far.report.warnings.some((w) => /further from the bands asked than a copy should be: <150 \+\d+/.test(w)), far.report.warnings.join(" | "));
  sure(validateSoundSpec(spec({ low: 5 })).errors.some((e) => /bands: the share of its power/.test(e)), "a band by another name refused");
});

test("a sound held to the decay a description gives: a T20 more than a fifth off is warned of", () => {
  const spec = (t20, decay) => ({ spec: "smak.sound/1", name: "x/ring.wav", t20, layers: [{ kind: "modes", f: 600, decay }] });
  // modes decay is to -60 dB: a third of it is to -20
  const near = buildSoundSpec(spec(0.3, 0.9));
  sure(near.report.facts.some((f) => /T20 [\d.]+ s against the 0\.3 s asked/.test(f)) && !near.report.warnings.some((w) => /its decay is/.test(w)), [...near.report.facts, ...near.report.warnings].join(" | "));
  const long = buildSoundSpec(spec(0.3, 2.4));
  sure(long.report.warnings.some((w) => /x\/ring\.wav: its decay is [\d.]+ s to 20 dB under its loudest, against the 0\.3 s asked \(\d+% long/.test(w)), long.report.warnings.join(" | "));
  sure(validateSoundSpec(spec(-1, 1)).errors.some((e) => /t20: the seconds from its loudest/.test(e)), "a negative t20 refused");
});

test("a sound held to the hits a description counts, as a judge counts them", () => {
  const hit = (at) => ({ kind: "noise", at, filter: [{ type: "highpass", f: 800 }], env: { decay: 0.3 } });
  const bed = { kind: "noise", color: "brown", gain: -30, length: 0.8, env: { attack: 0.001, hold: 0.5, decay: 0.3 } };
  const spec = (layers) => ({ spec: "smak.sound/1", name: "x/hit.wav", onsets: 1, layers: [bed, ...layers] });
  // a strike at once is no onset to the count; one after a quieter start is
  const atOnce = buildSoundSpec(spec([hit(0)]));
  sure(atOnce.report.warnings.some((w) => /x\/hit\.wav: 0 onsets, as a judge counts them, against the 1 asked: a hit the count does not see/.test(w)), atOnce.report.warnings.join(" | "));
  const later = buildSoundSpec(spec([hit(0.06)]));
  sure(later.report.facts.some((f) => /1 onsets against the 1 asked/.test(f)) && !later.report.warnings.some((w) => /onsets, as a judge/.test(w)), [...later.report.facts, ...later.report.warnings].join(" | "));
  sure(validateSoundSpec({ ...spec([]), onsets: 1.5 }).errors.some((e) => /onsets: how many hits/.test(e)), "a fraction of a hit refused");
});

test("a sound's spectrum off its class is warned of, which way, as a judge measures it", () => {
  // a metal hit made of a low thud alone: far too dark for the game's metal hits
  const dark = buildSoundSpec({ spec: "smak.sound/1", name: "weapons/thud.wav", class: "metal hit", length: 0.5, layers: [{ kind: "tone", f: 90, env: { attack: 0.002, decay: 0.3 } }] }, { games: [] });
  const said = dark.report.warnings.find((w) => /spectrum is off the game's metal hit sounds/.test(w)) ?? "";
  sure(/centroid \d+ Hz under the class's/.test(said) && /too dark/.test(said), dark.report.warnings.join(" | "));
});

test("a sound in the place of one of the game's own is held to it: far in spectrum or length, warned of", () => {
  const [mkdirSync, writeFileSync] = [mkdirOf, writeOf];
  const game = join(tmp, "game-sounds");
  mkdirSync(join(game, "sound", "headcrab"), { recursive: true });
  // the game's own: a bright hiss of a quarter second
  const theirs = smak.audio.render({ length: 0.25, layers: [{ kind: "noise", color: "white", filter: [{ type: "highpass", f: 2000 }], env: { attack: 0.002, decay: 0.2 } }] }, { rate: 22050 });
  writeFileSync(join(game, "sound", "headcrab", "hc_pain1.wav"), smak.audio.writeWav(theirs, { rate: 22050 }));
  const low = buildSoundSpec({ spec: "smak.sound/1", name: "headcrab/hc_pain1.wav", length: 0.25, layers: [{ kind: "tone", f: 120, env: { attack: 0.002, decay: 0.2 } }] }, { games: [game] });
  sure(low.report.warnings.some((w) => /far from the game's own sound it takes the place of/.test(w) && /too dark/.test(w)), low.report.warnings.join(" | "));
});

test("smak sound: a spec's sounds written under the folder's sound/, their picture beside the spec, the report said; a spec with errors refused", () => {
  const folder = join(tmp, "sound-command");
  const spec = join(tmp, "beep.sound.json");
  writeFileSync(spec, JSON.stringify({ spec: "smak.sound/1", name: "buttons/beep1.wav", class: "click", length: 0.15, layers: [{ kind: "tone", f: 880, env: { attack: 0.002, decay: 0.1 } }] })); // prettier-ignore
  const said = runSmak("sound", spec, "-o", folder);
  const wav = A.readWav(readFileSync(join(folder, "sound", "buttons", "beep1.wav")));
  sure(wav.rate === 22050 && wav.bits === 16 && /1 sounds built, and every check passed/.test(said), said);
  sure(existsSync(join(tmp, "buttons_beep1.png")), "its picture beside the spec");
  writeFileSync(spec, JSON.stringify({ spec: "smak.sound/1", name: "buttons/bad.wav", layers: [{ kind: "hum" }] }));
  const refused = runRefused(SMAK_CLI, "sound", spec, "-o", folder);
  sure(refused.code === 1 && /ERROR/.test(refused.out) && !existsSync(join(folder, "sound", "buttons", "bad.wav")), refused.out + refused.err);
});
