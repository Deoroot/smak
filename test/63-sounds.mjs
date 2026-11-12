// Sounds: a GoldSrc file written and read back (8 and 16 bit, a cue point), another tool's take read whole, measured
// in known signals, checked as the engine needs it, and its loudness as broadcasters measure it.
import { readFileSync, existsSync, mkdirSync as mkdirOf, writeFileSync as writeOf } from "node:fs";
import { join, delimiter } from "node:path";
import * as smak from "../src/index.mjs";
import { test, sure, tmp, runSmak, runRefused, SMAK_CLI } from "./helper.mjs";
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
  const random = smak.seeded(9);
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

test("loudness as broadcasters measure it: EBU's stereo tone at -23 LUFS, at any rate", () => {
  for (const rate of [48000, 44100, 22050]) {
    const x = Float32Array.from({ length: rate * 10 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / rate) * 10 ** (-23 / 20));
    const both = A.loudness([x, x], rate);
    sure(both.lufs === -23 && A.loudness([x], rate).lufs === -26 && both.peak === -23 && both.range === 0, `${rate}: ${JSON.stringify(both)}`);
  }
});

