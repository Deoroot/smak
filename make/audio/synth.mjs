// Sounds made from layers, in plain arithmetic: noise through filters or shaped to a curve, tones that sweep,
// FM, a struck thing's modes, a cloud of small particles or a train of them, a short room, saturation, a
// limiter, and a finish. Every random choice comes from a seed, so a spec gives the same samples every time.
// research/sound-generation.md, section 4, has the blocks and the recipes; research/sound-shape-results.md the
// shaped noise and the limiter.
//
//   render(sound, { rate }) -> Float32Array: `sound` is { length, seed, layers, finish, loop }, as a sound spec has it

import { shapedNoise } from "./spectral.mjs";

/** A seeded random number maker, 0 to 1. */
export function seeded(seed = 1) {
  let state = (seed >>> 0) ^ 0x9e3779b9 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/** Ratios of a struck thing's modes: a bar free at its ends, one clamped, a round plate, a bell. */
export const MODE_SETS = {
  bar: [1, 2.756, 5.404, 8.933],
  clamped: [1, 6.267, 17.55],
  plate: [1, 1.59, 2.14, 2.3, 2.65, 2.92],
  bell: [0.5, 1, 1.183, 1.506, 2, 2.514, 2.662],
  tube: [1, 2.32, 4.25, 6.63],
};

/** A biquad filter (the RBJ cookbook): a function of one sample, with its state. */
export function biquad(type, f, rate, q = 0.707, gain = 0) {
  const w = (2 * Math.PI * Math.min(f, rate * 0.49)) / rate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const A = 10 ** (gain / 40);
  const k = {
    lowpass: [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha],
    highpass: [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha],
    bandpass: [alpha, 0, -alpha, 1 + alpha, -2 * cos, 1 - alpha],
    notch: [1, -2 * cos, 1, 1 + alpha, -2 * cos, 1 - alpha],
    peak: [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A],
    // the shelves (RBJ's cookbook): every frequency under (or over) `f` lifted or cut by `gain` dB
    lowshelf: [A * (A + 1 - (A - 1) * cos + 2 * Math.sqrt(A) * alpha), 2 * A * (A - 1 - (A + 1) * cos), A * (A + 1 - (A - 1) * cos - 2 * Math.sqrt(A) * alpha), A + 1 + (A - 1) * cos + 2 * Math.sqrt(A) * alpha, -2 * (A - 1 + (A + 1) * cos), A + 1 + (A - 1) * cos - 2 * Math.sqrt(A) * alpha],
    highshelf: [A * (A + 1 + (A - 1) * cos + 2 * Math.sqrt(A) * alpha), -2 * A * (A - 1 + (A + 1) * cos), A * (A + 1 + (A - 1) * cos - 2 * Math.sqrt(A) * alpha), A + 1 - (A - 1) * cos + 2 * Math.sqrt(A) * alpha, 2 * (A - 1 - (A + 1) * cos), A + 1 - (A - 1) * cos - 2 * Math.sqrt(A) * alpha],
  }[type];
  if (!k) throw new Error(`a filter is lowpass, highpass, bandpass, peak, notch, lowshelf or highshelf, not ${type}`);
  const [b0, b1, b2, a0, a1, a2] = k;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return (x) => {
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    [x2, x1, y2, y1] = [x1, x, y1, y];
    return y;
  };
}

/** A chain of filters as a spec gives them: [{ type, f, q, gain, sweep: { to, time } }]; a swept one is remade every 32 samples. */
function filterChain(list = [], rate) {
  const stages = list.map((given) => {
    let current = biquad(given.type, given.f, rate, given.q, given.gain);
    let count = 0;
    return (x, t) => {
      if (given.sweep && count++ % 32 === 0) {
        const u = Math.min(1, t / (given.sweep.time || 1e-9));
        current = biquad(given.type, given.f * (given.sweep.to / given.f) ** u, rate, given.q, given.gain);
      }
      return current(x);
    };
  });
  return (x, t) => stages.reduce((v, stage) => stage(v, t), x);
}

/** How loud a layer is at `t` seconds into it: attack (linear), hold, then falling 60 dB in `decay`; or a table of [t, dB] points. */
export function envelopeAt(env = {}, t) {
  if (env.points) {
    const p = env.points;
    if (t <= p[0][0]) return 10 ** (p[0][1] / 20);
    for (let i = 1; i < p.length; i++)
      if (t <= p[i][0]) {
        const u = (t - p[i - 1][0]) / (p[i][0] - p[i - 1][0] || 1e-9);
        return 10 ** ((p[i - 1][1] + (p[i][1] - p[i - 1][1]) * u) / 20);
      }
    return 10 ** (p.at(-1)[1] / 20);
  }
  const { attack = 0.001, hold = 0, decay = 0.3, shape } = env;
  if (shape === "bell") {
    // a swell: up and down again over `decay`, as a swing's whoosh
    const u = Math.min(1, t / decay);
    return Math.sin(Math.PI * u) ** 3;
  }
  if (t < attack) return t / attack;
  if (t < attack + hold) return 1;
  return Math.exp((-6.9078 * (t - attack - hold)) / decay);
}

/** Noise of a colour: white, pink (Paul Kellet's filter) or brown (a leaky sum). */
function noiseSource(color = "white", random) {
  if (color === "white") return () => random() * 2 - 1;
  if (color === "brown") {
    let last = 0;
    return () => (last = Math.max(-1, Math.min(1, last * 0.98 + (random() * 2 - 1) * 0.15))) * 3;
  }
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  return () => {
    const w = random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    return (b0 + b1 + b2 + w * 0.1848) * 0.2;
  };
}

const peakOf = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/** One layer's samples, from its own start: a Float32Array of `seconds`. */
function layerSamples(layer, seconds, rate, random) {
  const n = Math.max(1, Math.round(seconds * rate));
  const out = new Float32Array(n);
  const filter = filterChain(layer.filter, rate);
  const env = (t) => envelopeAt(layer.env, t);
  switch (layer.kind) {
    case "sample": {
      // a recording (a generator's take), already at this rate (buildSoundSpec reads and resamples it): its
      // own loudness kept unless the layer gives an envelope
      const pcm = layer.pcm ?? new Float32Array(0);
      for (let i = 0; i < n && i < pcm.length; i++) out[i] = filter(pcm[i], i / rate) * (layer.env ? env(i / rate) : 1);
      break;
    }
    case "noise": {
      if (layer.shape) {
        // its spectrum given as a curve: made in the frequency domain, then filtered and enveloped as any noise
        const shaped = shapedNoise(layer.shape, n, rate, random, { iterations: layer.iterations ?? 0 });
        for (let i = 0; i < n; i++) out[i] = filter(shaped[i], i / rate) * env(i / rate);
        break;
      }
      const source = noiseSource(layer.color, random);
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        out[i] = filter(source(), t) * env(t);
      }
      break;
    }
    case "tone":
    case "fm": {
      const wave = layer.wave ?? "sine";
      let phase = 0;
      let modPhase = 0;
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        const u = layer.sweep ? Math.min(1, t / (layer.sweep.time || seconds)) : 0;
        const f = layer.sweep ? layer.f * (layer.sweep.to / layer.f) ** u : layer.f;
        let p = phase;
        if (layer.kind === "fm") {
          modPhase += (2 * Math.PI * f * (layer.ratio ?? 1.4)) / rate;
          const index = (layer.index ?? 2) * (layer.indexDecay ? Math.exp((-6.9078 * t) / layer.indexDecay) : 1);
          p += index * Math.sin(modPhase);
        }
        phase += (2 * Math.PI * f) / rate;
        const s = Math.sin(p);
        const v = wave === "square" ? Math.sign(s) : wave === "saw" ? ((p / Math.PI) % 2) - 1 : wave === "triangle" ? (2 / Math.PI) * Math.asin(s) : s;
        out[i] = filter(v, t) * env(t);
      }
      break;
    }
    case "modes": {
      const ratios = layer.modes ? layer.modes.map((m) => m.f / layer.modes[0].f) : Array.isArray(layer.ratios) ? layer.ratios : MODE_SETS[layer.ratios ?? "bar"];
      const base = layer.modes ? layer.modes[0].f : layer.f;
      const decay = layer.decay ?? 0.5;
      const modes = ratios.map((r, k) => ({
        f: base * r * (1 + ((random() - 0.5) * (layer.detune ?? 0.5)) / 100),
        gain: layer.modes?.[k]?.gain ?? layer.gains?.[k] ?? 1 / (k + 1),
        decay: layer.modes?.[k]?.decay ?? decay / (k + 1) ** (layer.damping ?? 1),
        phase: random() * 2 * Math.PI,
      }));
      const attack = layer.env?.attack ?? 0.0005;
      for (const m of modes) {
        if (m.f >= rate / 2) continue;
        for (let i = 0; i < n; i++) {
          const t = i / rate;
          const a = t < attack ? t / attack : Math.exp((-6.9078 * (t - attack)) / m.decay);
          out[i] += m.gain * Math.sin(2 * Math.PI * m.f * t + m.phase) * a;
        }
      }
      for (let i = 0; i < n; i++) out[i] = filter(out[i], i / rate);
      break;
    }
    case "particles": {
      // small bursts at random times through the layer's length: gravel, rattles, debris, crackle; or, with
      // `every`, one each `every` seconds, moved by up to `jitter` of that: a door's stop, a ratchet, a train
      const count = layer.every ? Math.ceil(seconds / layer.every) : (layer.count ?? Math.round((layer.rate ?? 30) * seconds));
      const [lo, hi] = layer.band ?? [1500, 4000];
      for (let p = 0; p < count; p++) {
        const start = layer.every ? Math.round((p + (random() - 0.5) * (layer.jitter ?? 0)) * layer.every * rate) : Math.floor(random() * n);
        if (start < 0 || start >= n) continue;
        const f = lo + random() * (hi - lo);
        const grain = Math.round((layer.grain ?? 0.003) * rate);
        const band = biquad("bandpass", f, rate, 2);
        const level = 0.4 + 0.6 * random();
        for (let i = 0; i < grain && start + i < n; i++) out[start + i] += band(random() * 2 - 1) * level * (1 - i / grain);
      }
      for (let i = 0; i < n; i++) out[i] = filter(out[i], i / rate) * env(i / rate);
      break;
    }
    default:
      throw new Error(`a layer is noise, tone, fm, modes or particles, not ${layer.kind}`);
  }
  // its own drive: this layer saturated alone, at its own peak, so that the others keep their edges
  if (layer.drive) {
    const top = peakOf(out) || 1;
    const d = layer.drive;
    for (let i = 0; i < n; i++) out[i] = (top * Math.tanh((out[i] / top) * d)) / Math.tanh(d);
  }
  return out;
}

/** A short room: the sound convolved with decaying filtered noise, `wet` of it added. */
function withRoom(x, { decay = 0.3, wet = 0.15, tone = 4000 } = {}, rate, random) {
  const length = Math.round(decay * rate);
  const ir = new Float32Array(length);
  const lp = biquad("lowpass", tone, rate);
  let energy = 0;
  for (let i = 1; i < length; i++) {
    ir[i] = lp(random() * 2 - 1) * Math.exp((-6.9078 * i) / length);
    energy += ir[i] * ir[i];
  }
  const g = wet / Math.sqrt(energy || 1);
  const out = new Float32Array(x.length + length);
  out.set(x);
  for (let i = 0; i < x.length; i++) {
    const v = x[i] * g;
    if (!v) continue;
    for (let j = 1; j < length; j++) out[i + j] += v * ir[j];
  }
  return out;
}

/** The sound made louder or softer until its peak is at `dB` dBFS. */
export function normalise(x, dB) {
  const g = 10 ** (dB / 20) / (peakOf(x) || 1);
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

/**
 * The samples of a sound: its layers mixed (each at its `at` seconds and `gain` dB, `pitch` percent), then
 * finished: `saturate` (a drive, tanh), `room`, `peak` (dBFS, -0.5 unless told), a DC block, a trim of
 * silence at the end and a 5 ms fade (one-shots), or a crossfaded seam (`loop`).
 */
/**
 * A look-ahead peak limiter (Zölzer, DAFX, chapter 4): the gain at each sample the least that keeps the next
 * 2 ms under the ceiling, falling at once and coming back over `release` seconds (0.002 unless told: Valve's
 * weapons are clipped near square, and a slow release of 0.05 squashed the head of a copy of their envelope
 * and moved its T20 out of range, research/sound-shape-results.md); the body made up to full
 * scale again and `after` (the later layers) added. The ceiling is found by halving until the sum's crest
 * (peak over RMS, dB) is `crest`; a mix already under it is left as it is.
 */
export function limitTo(x, after, { crest, release = 0.002 }, rate) {
  const ahead = Math.max(1, Math.round(0.002 * rate));
  const back = Math.exp(-1 / (Math.max(1e-4, release) * rate));
  const n = x.length;
  const wanted = new Float32Array(n);
  const gain = new Float32Array(n);
  const out = new Float32Array(n);
  const squash = (ceiling) => {
    for (let i = 0; i < n; i++) wanted[i] = Math.min(1, ceiling / (Math.abs(x[i]) || 1e-12));
    // the least over the 2 ms ahead, by a queue of rising values
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    for (let i = n - 1; i >= 0; i--) {
      while (tail > head && wanted[queue[tail - 1]] >= wanted[i]) tail--;
      queue[tail++] = i;
      while (queue[head] > i + ahead) head++;
      gain[i] = wanted[queue[head]];
    }
    let g = 1;
    for (let i = 0; i < n; i++) {
      g = gain[i] < g ? gain[i] : gain[i] + (g - gain[i]) * back;
      out[i] = (x[i] * g) / ceiling + (after ? after[i] : 0);
    }
    return crestOf(out);
  };
  if (squash(1) <= crest) return out;
  let lo = Math.log(1e-3);
  let hi = 0;
  for (let step = 0; step < 24; step++) {
    const mid = (lo + hi) / 2;
    if (squash(Math.exp(mid)) > crest) hi = mid;
    else lo = mid;
  }
  squash(Math.exp(lo));
  return out;
}

/** Peak over RMS, in dB. */
function crestOf(x) {
  let peak = 0;
  let squares = 0;
  for (const v of x) {
    peak = Math.max(peak, Math.abs(v));
    squares += v * v;
  }
  return 20 * Math.log10((peak || 1e-12) / Math.sqrt(squares / (x.length || 1) || 1e-24));
}

/** How long a layer takes to die away when it is not told: its envelope's attack, hold and decay (to -60 dB). */
function naturalLength(layer) {
  if (layer.length) return layer.length;
  if (layer.kind === "sample") return (layer.pcm?.length ?? 0) / (layer.pcmRate || 22050);
  const env = layer.env ?? {};
  if (env.points) return env.points.at(-1)[0];
  const decay = layer.kind === "modes" ? (layer.modes ? Math.max(...layer.modes.map((m) => m.decay)) : (layer.decay ?? 0.5)) : (env.decay ?? 0.3);
  return Math.min(6, (env.attack ?? 0.001) + (env.hold ?? 0) + decay);
}

export function render(sound, { rate = 22050 } = {}) {
  const random = seeded(sound.seed ?? 1);
  const length = sound.length ?? Math.max(...sound.layers.map((l) => (l.at ?? 0) + naturalLength(l)));
  const pitch = 1 + (sound.pitch ?? 0) / 100;
  let mix = new Float32Array(Math.round(length * rate));
  // the layers that come after the finish's saturation and limiter: a crack that keeps its onset
  const posts = sound.layers.some((layer) => layer.post);
  let after = posts ? new Float32Array(mix.length) : null;
  sound.layers.forEach((layer, k) => {
    const own = seeded((sound.seed ?? 1) * 7919 + k * 104729);
    const seconds = Math.max(0.001, Math.min(layer.length ?? length - (layer.at ?? 0), length - (layer.at ?? 0)));
    const samples = layerSamples(layer, seconds * pitch, rate, own);
    // its own last 5 ms faded: a layer cut off while it still rings is a click in the middle of the sound
    const fade = Math.min(samples.length, Math.round(0.005 * rate));
    for (let i = 0; i < fade; i++) samples[samples.length - 1 - i] *= i / fade;
    const gain = 10 ** ((layer.gain ?? 0) / 20);
    const at = Math.round((layer.at ?? 0) * rate);
    const into = layer.post ? after : mix;
    for (let i = 0; i < mix.length - at; i++) {
      // a pitch other than 1 plays the layer faster or slower, read between its samples
      const s = i * pitch;
      const j = Math.floor(s);
      if (j + 1 >= samples.length) break;
      into[at + i] += (samples[j] + (samples[j + 1] - samples[j]) * (s - j)) * gain;
    }
  });
  const finish = { peak: -0.5, ...(sound.finish ?? {}) };
  // the room, then the saturation: a shot is loud because its room's tail is squashed up to its blast
  // (research/sound-generation.md, 5.4: saturating before the room left the tail thin and the shot spiky)
  if (finish.room) mix = withRoom(mix, finish.room, rate, random);
  if (finish.saturate) {
    normalise(mix, 0);
    const d = finish.saturate;
    for (let i = 0; i < mix.length; i++) mix[i] = Math.tanh(mix[i] * d) / Math.tanh(d);
  }
  // a DC block: a one-pole high-pass at 25 Hz; before the limiter when there is one, so that the crest it
  // reaches is the file's (a block after it moved a squashed shot's peaks by 3 dB)
  const blockDc = (x) => {
    const r = 1 - (2 * Math.PI * 25) / rate;
    let lastIn = 0;
    let lastOut = 0;
    for (let i = 0; i < x.length; i++) {
      const v = x[i] - lastIn + r * lastOut;
      [lastIn, lastOut] = [x[i], v];
      x[i] = v;
    }
  };
  if (finish.limit || posts) {
    blockDc(mix);
    // at full scale, so that a later layer's `gain` is in dB of the body's peak
    normalise(mix, 0);
    if (after) {
      const longer = new Float32Array(mix.length);
      longer.set(after.subarray(0, mix.length));
      after = longer;
    }
    if (finish.limit) mix = limitTo(mix, after, finish.limit, rate);
    else for (let i = 0; i < mix.length; i++) mix[i] += after[i];
  }
  if (!(finish.limit || posts)) blockDc(mix);
  normalise(mix, finish.peak);
  if (sound.loop) {
    // the last `crossfade` seconds laid over the first, faded across: the seam is continuous
    const fade = Math.round((sound.loop.crossfade ?? 0.25) * rate);
    const out = mix.slice(0, mix.length - fade);
    for (let i = 0; i < fade; i++) {
      const g = i / fade;
      out[i] = out[i] * g + mix[mix.length - fade + i] * (1 - g);
    }
    return normalise(out, finish.peak);
  }
  // a one-shot: trimmed where it falls under -60 dB (and 5 ms after), its end faded
  if (finish.trim !== false) {
    const under = 10 ** (-60 / 20) * peakOf(mix);
    let end = mix.length;
    while (end > 1 && Math.abs(mix[end - 1]) < under) end--;
    mix = mix.slice(0, Math.min(mix.length, end + Math.round(0.005 * rate)));
  }
  const fade = Math.min(mix.length, Math.round((finish.fade ?? 0.008) * rate));
  for (let i = 0; i < fade; i++) mix[mix.length - 1 - i] *= i / fade;
  return mix;
}
