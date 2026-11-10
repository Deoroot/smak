// A sound's power brought to the shares of its bands that it is to have: a gain for each band, laid as a smooth
// curve over the spectrum (in octaves between the bands' middles) and applied once to the whole sound with no
// shift of phase, measured as the judge measures (`features`) and set again until it is near. A maker who
// filtered a generated take by hand left every sound of a mod outside the game's bands ("I could not get them to
// zero by filtering", 2026-10-17): this is that filtering done by arithmetic.
//
//   fitBands(x, rate, target, { loop, rounds, most }) -> { x, gains, bands, off }
// `target`: { "<150": share, ... } in %, any of the bands. `loop`: the sound wraps (a loop's seam stays whole);
// a one-shot is padded so that its tail does not wrap onto its head. `gains`: dB a band; `bands`: the shares it
// came to; `off`: the most points a band given is from its target. A band the sound has (nearly) nothing in
// cannot be raised from nothing: its gain stops at `most` dB and `off` says how far it stayed.
import { fft, BANDS, features } from "./measure.mjs";

/** Each band's middle in Hz, the lowest and highest at a sensible place for open ends. */
const MIDDLES = BANDS.map(([, lo, hi]) => (lo === 0 ? hi / 2 : hi === Infinity ? lo * 1.6 : Math.sqrt(lo * hi)));

export function fitBands(x, rate, target, { loop = false, rounds = 8, most = 30 } = {}) {
  const names = BANDS.map(([name]) => name);
  for (const key of Object.keys(target ?? {})) if (!names.includes(key)) throw new Error(`fitBands: no band "${key}": ${names.join(", ")}`);
  let size = 1;
  while (size < (loop ? x.length : 2 * x.length)) size *= 2;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  re.set(x);
  fft(re, im);
  const hz = (k) => ((k <= size / 2 ? k : size - k) * rate) / size;
  const octave = MIDDLES.map(Math.log2);
  const curve = (gains) => (f) => {
    const at = Math.log2(Math.max(f, 1));
    if (at <= octave[0]) return gains[0];
    if (at >= octave[octave.length - 1]) return gains[gains.length - 1];
    const i = octave.findIndex((o) => o > at) - 1;
    const t = (at - octave[i]) / (octave[i + 1] - octave[i]);
    return gains[i] + (gains[i + 1] - gains[i]) * t;
  };
  const apply = (gains) => {
    const g = curve(gains);
    const r = new Float64Array(size);
    const q = new Float64Array(size);
    for (let k = 0; k < size; k++) {
      const a = 10 ** (g(hz(k)) / 20);
      // the inverse by the forward transform of the conjugate
      r[k] = re[k] * a;
      q[k] = -im[k] * a;
    }
    fft(r, q);
    return Float32Array.from({ length: x.length }, (_, i) => r[i] / size);
  };
  const offOf = (bands) => Math.max(0, ...Object.entries(target).map(([k, want]) => Math.abs(bands[k] - want)));
  const gains = names.map(() => 0);
  let best = { x, gains: [...gains], bands: features({ x, rate }).bands };
  best.off = offOf(best.bands);
  for (let round = 0; round < rounds && best.off > 1; round++) {
    const bands = round ? features({ x: apply(gains), rate }).bands : best.bands;
    names.forEach((name, i) => {
      if (target[name] === undefined) return;
      const step = 10 * Math.log10(Math.max(target[name], 0.05) / Math.max(bands[name], 0.05));
      gains[i] = Math.max(-most, Math.min(most, gains[i] + step));
    });
    const y = apply(gains);
    const now = features({ x: y, rate }).bands;
    const off = offOf(now);
    if (off < best.off) best = { x: y, gains: [...gains], bands: now, off };
  }
  return { x: best.x, gains: Object.fromEntries(names.map((name, i) => [name, Math.round(best.gains[i] * 10) / 10])), bands: best.bands, off: Math.round(best.off * 10) / 10 };
}
