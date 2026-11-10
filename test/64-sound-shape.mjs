// Sounds shaped and squashed: noise made to a curve of [Hz, dB] and to one that moves, a limiter that reaches
// a crest, a crack added after it, a layer's own drive, grains at a period; a sound's picture read back to
// numbers and to a draft spec of the kit's own layers, and a spec measured against a picture.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import { test, sure, tmp } from "./helper.mjs";

const { audio: A } = smak;
const RATE = 22050;
const build = (spec) => {
  const built = A.buildSoundSpec({ spec: "smak.sound/1", name: "test/x.wav", ...spec });
  sure(built.report.ok, [...built.report.errors, ...built.report.faults].join("; "));
  return { ...built, f: A.features(A.readWav(built.files[0].bytes)) };
};

test("shaped noise: a flat curve is the kit's white noise, a curve's band holds the power, Griffin-Lim keeps the level", () => {
  const rms = (x) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
  const white = A.shapedNoise([[100, 0], [10000, 0]], RATE, RATE, A.seeded(3));
  sure(Math.abs(rms(white) - 0.577) < 0.03, `a 0 dB curve at white noise's level (RMS 0.577): ${rms(white)}`);
  const band = [[200, -60], [600, 0], [2000, 0], [2500, -60]];
  for (const iterations of [0, 16]) {
    const x = A.shapedNoise(band, RATE, RATE, A.seeded(4), { iterations });
    const f = A.features({ x, rate: RATE });
    sure(f.bands["600-2k"] > 90 && Math.abs(rms(x) - 0.577 * Math.sqrt(0.06)) < 0.1, `${iterations} iterations: ${JSON.stringify(f.bands)}, RMS ${rms(x)}`);
  }
  // a shape that moves from dark to bright: the end brighter than the start
  const moving = A.shapedNoise({ keys: [{ at: 0, curve: [[100, 0], [400, 0], [800, -60]] }, { at: 1, curve: [[2000, -60], [4000, 0], [8000, 0]] }] }, RATE, RATE, A.seeded(5));
  const early = A.features({ x: moving.subarray(0, 4000), rate: RATE });
  const late = A.features({ x: moving.subarray(RATE - 4000), rate: RATE });
  sure(early.centroid < 800 && late.centroid > 3000, `dark to bright: ${early.centroid} Hz, then ${late.centroid} Hz`);
  sure(A.curveAt([[100, 0], [1000, -20]], Math.sqrt(100 * 1000)) === -10, "a curve straight on a log scale of frequency");
});

test("a shaped layer in a spec, built the same every time; the specs before it unchanged; its faults said", () => {
  const spec = { seed: 2, length: 0.5, layers: [{ kind: "noise", shape: [[300, -20], [1000, 0], [3000, -20]], iterations: 4, env: { attack: 0.001, decay: 0.4 } }] };
  const a = build(spec);
  sure(a.files[0].bytes.equals(build(spec).files[0].bytes), "the same spec, the same bytes");
  sure(a.f.bands["600-2k"] > 60, JSON.stringify(a.f.bands));
  const plain = { seed: 3, layers: [{ kind: "noise", color: "pink", filter: [{ type: "bandpass", f: 900 }], env: { decay: 0.3 } }], finish: { saturate: 2 } };
  sure(build(plain).files[0].bytes.equals(A.writeWav(A.render(plain), { seed: 3 })), "a spec without the new fields made as render makes it");
  const bad = A.validateSoundSpec({
    spec: "smak.sound/1",
    name: "x.wav",
    layers: [{ kind: "tone", f: 100, shape: [[100, 0]] }, { kind: "noise", shape: [[1000, 0], [500, 0]] }, { kind: "noise", shape: { keys: [{ at: 1, curve: [[100, 0]] }, { at: 0, curve: [[100, 0]] }] } }, { kind: "particles", every: 0 }],
    finish: { limit: { crest: "loud" } },
  }).errors.join(" | ");
  sure(/only a noise layer takes a shape/.test(bad) && /Hz over 0 and rising/.test(bad) && /keys\[1\]\.at/.test(bad) && /every: seconds/.test(bad) && /finish\.limit/.test(bad), bad);
});

test("the limiter reaches the crest asked for; a crack after it keeps its onset; a layer's drive is its own", () => {
  const body = { kind: "noise", color: "pink", filter: [{ type: "lowpass", f: 3000 }], env: { attack: 0.002, hold: 0.1, decay: 0.6 } };
  const free = build({ seed: 5, layers: [body] });
  for (const crest of [9, 6]) {
    const squashed = build({ seed: 5, layers: [body], finish: { limit: { crest } } });
    sure(Math.abs(squashed.f.crest - crest) < 1 && squashed.f.crest < free.f.crest, `crest ${crest}: made ${squashed.f.crest}, unlimited ${free.f.crest}`);
  }
  const loose = build({ seed: 5, layers: [body], finish: { limit: { crest: 40 } } });
  sure(Math.abs(loose.f.crest - free.f.crest) < 0.3, `a crest the mix is already under leaves it as it is: ${loose.f.crest} against ${free.f.crest}`);
  // the crack: a few ms of bright noise at 0.3 s, over a squashed body, with and without `post`
  const crack = { kind: "noise", color: "white", filter: [{ type: "highpass", f: 2000 }], env: { attack: 0.0001, hold: 0.001, decay: 0.003 }, at: 0.3, gain: -6 };
  const near = (x) => {
    let top = 0;
    for (let i = Math.round(0.299 * RATE); i < Math.round(0.306 * RATE); i++) top = Math.max(top, Math.abs(x[i]));
    let around = 0;
    for (let i = Math.round(0.25 * RATE); i < Math.round(0.29 * RATE); i++) around = Math.max(around, Math.abs(x[i]));
    return top / around;
  };
  const after = A.render({ seed: 5, length: 0.8, layers: [body, { ...crack, post: true }], finish: { limit: { crest: 6 } } });
  const before = A.render({ seed: 5, length: 0.8, layers: [body, crack], finish: { limit: { crest: 6 } } });
  sure(near(after) > 1.2 && near(after) > near(before) * 1.1, `the crack over the body: ${near(after)} after the limiter, ${near(before)} squashed with it`);
  // a driven layer is squarer: its crest falls
  const tone = { kind: "tone", f: 220, env: { attack: 0.01, hold: 0.3, decay: 0.2 } };
  const driven = A.render({ seed: 1, length: 0.5, layers: [{ ...tone, drive: 6 }] });
  const clean = A.render({ seed: 1, length: 0.5, layers: [tone] });
  sure(A.features({ x: driven, rate: RATE }).crest < A.features({ x: clean, rate: RATE }).crest - 1.5, "a driven tone is squarer");
});

test("grains at a period: one each `every` seconds, moved by `jitter`, where random grains fall anywhere", () => {
  const train = A.render({ seed: 2, length: 1, finish: { trim: false }, layers: [{ kind: "particles", every: 0.1, jitter: 0, band: [800, 1200], grain: 0.004, env: { attack: 0.001, hold: 2 } }] });
  const loud = [];
  for (let k = 0; k < 10; k++) {
    let e = 0;
    for (let i = 0; i < 0.01 * RATE; i++) e += Math.abs(train[Math.round(k * 0.1 * RATE) + i]);
    let gap = 0;
    for (let i = 0.03 * RATE; i < 0.07 * RATE; i++) gap += Math.abs(train[Math.round(k * 0.1 * RATE + i)]);
    loud.push(e > 5 * gap);
  }
  sure(loud.every(Boolean), `a grain at each 0.1 s and quiet between: ${loud}`);
});

test("a sound's picture read back: its length, rate, centroid, bands, a tone line, and a draft that is near it", () => {
  // a known sound: a ring at 1000 Hz over a band of noise, dying in 0.6 s, at 11025 Hz
  const rate = 11025;
  const random = A.seeded(8);
  const x = Float32Array.from({ length: Math.round(0.8 * rate) }, (_, i) => {
    const t = i / rate;
    return Math.exp((-6.9 * t) / 0.6) * (0.4 * Math.sin(2 * Math.PI * 1000 * t) + 0.3 * (random() * 2 - 1));
  });
  const picture = A.soundPicture([{ name: "test/ring.wav", x, rate }], { width: 960 });
  const png = smak.png(picture.width, picture.height, picture.rgba);
  writeFileSync(join(tmp, "ring.png"), png);
  const real = A.features({ x, rate });
  const seen = A.pictureMeasures(png);
  sure(seen.length === 0.8 && seen.rate === rate, `its label and marks read: ${seen.length} s, ${seen.rate} Hz`);
  sure(Math.abs(seen.centroid - real.centroid) / real.centroid < 0.1, `centroid ${seen.centroid} against ${real.centroid}`);
  sure(Object.keys(real.bands).every((k) => Math.abs(seen.bands[k] - real.bands[k]) < 5), `bands ${JSON.stringify(seen.bands)} against ${JSON.stringify(real.bands)}`);
  sure(Math.abs(seen.crest - real.crest) < 3 && Math.abs(seen.t20 - real.t20) < 0.06, `crest ${seen.crest} against ${real.crest}, T20 ${seen.t20} against ${real.t20}`);
  const { spec, lines } = A.fromPicture(png, { name: "test/ring.wav" });
  sure(lines.some((l) => Math.abs(l.f - 1000) < 30), `the ring found: ${JSON.stringify(lines)}`);
  sure(spec.layers[0].shape.keys.length > 1 && spec.layers.some((l) => l.kind === "modes"), JSON.stringify(spec.layers.map((l) => l.kind)));
  const numbers = JSON.stringify(spec).match(/-?\d+(\.\d+)?/g).length;
  sure(numbers < 400, `a draft of numbers, not samples: ${numbers}`);
  const made = build({ ...spec, picture: join(tmp, "ring.png") });
  sure(Math.abs(made.f.centroid - real.centroid) / real.centroid < 0.2 && Object.keys(real.bands).every((k) => Math.abs(made.f.bands[k] - real.bands[k]) < 10), `the draft built: ${made.f.centroid} Hz, ${JSON.stringify(made.f.bands)}`);
  const line = made.report.facts.find((f) => /against its picture \(0.8 s\)/.test(f));
  sure(line && /centroid \d+ Hz to \d+/.test(line) && made.report.sounds["test/ring.wav"].picture.lengthOff < 0.05, made.report.facts.join(" | "));
  const missing = A.buildSoundSpec({ spec: "smak.sound/1", name: "test/x.wav", picture: join(tmp, "none.png"), layers: [{ kind: "tone", f: 200 }] });
  sure(missing.report.ok && missing.report.warnings.some((w) => /picture .*none\.png/.test(w)), "a picture that cannot be read is a warning");
});
