// Loudness as broadcasters measure it (ITU-R BS.1770-4, EBU R128): what a music track is levelled by, where a
// sound effect is levelled by its peak. Each channel K-weighted (a high shelf of +4 dB over about 1.7 kHz, as a
// head hears, then a high-pass at 38 Hz), its power taken in blocks of 400 ms a quarter apart, the blocks under
// -70 LUFS left out, then those more than 10 LU under the mean of the rest, and the mean of what is left.
//
//   loudness(channels, rate)       -> { lufs, range, peak }: integrated loudness (LUFS), loudness range (LU,
//                                     the 10th to the 95th percentile of 3 s blocks), sample peak (dBFS)

/**
 * BS.1770's two filters at any rate, by the bilinear transform that gives its own coefficients at 48 kHz (the
 * form pyloudnorm uses): the head's high shelf (+4 dB over 1682 Hz) and the 38 Hz high-pass. One sample a call.
 */
function kWeighting(rate) {
  const stage = (b, a) => {
    let [x1, x2, y1, y2] = [0, 0, 0, 0];
    return (x) => {
      const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
      [x2, x1, y2, y1] = [x1, x, y1, y];
      return y;
    };
  };
  let K = Math.tan((Math.PI * 1681.974450955533) / rate);
  let Q = 0.7071752369554196;
  const Vh = 10 ** (3.999843853973347 / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = stage([(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0], [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0]);
  K = Math.tan((Math.PI * 38.13547087602444) / rate);
  Q = 0.5003270373238773;
  a0 = 1 + K / Q + K * K;
  const high = stage([1, -2, 1], [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0]);
  return (x) => high(shelf(x));
}

const dB = (power) => -0.691 + 10 * Math.log10(power || 1e-12);

/** Each block's mean K-weighted power, summed over the channels: from running totals of the squares, so any block costs two reads. */
function blockPowers(totals, rate, seconds, step) {
  const size = Math.round(seconds * rate);
  const hop = Math.round(step * rate);
  const n = totals[0].length - 1;
  const out = [];
  for (let start = 0; start + size <= n; start += hop) out.push(totals.reduce((sum, t) => sum + (t[start + size] - t[start]) / size, 0));
  return out;
}

/** Gated mean of block powers (BS.1770's integrated loudness), in LUFS; -Infinity when every block is under -70. */
function gated(powers) {
  const loud = powers.filter((p) => dB(p) > -70);
  if (!loud.length) return -Infinity;
  const first = dB(loud.reduce((a, b) => a + b, 0) / loud.length);
  const kept = loud.filter((p) => dB(p) > first - 10);
  return dB(kept.reduce((a, b) => a + b, 0) / kept.length);
}

/** A track's integrated loudness, loudness range and sample peak: `channels` a list of Float32Arrays at `rate`. */
export function loudness(channels, rate) {
  const weighted = channels.map((x) => {
    const k = kWeighting(rate);
    const totals = new Float64Array(x.length + 1);
    for (let i = 0; i < x.length; i++) {
      const v = k(x[i]);
      totals[i + 1] = totals[i] + v * v;
    }
    return totals;
  });
  const lufs = gated(blockPowers(weighted, rate, 0.4, 0.1));
  // the range (EBU Tech 3342): 3 s blocks a tenth apart, gated at -70 and 20 LU under their mean, 10th to 95th percentile
  const long = blockPowers(weighted, rate, 3, 0.1).filter((p) => dB(p) > -70);
  let range = 0;
  if (long.length > 1) {
    const mean = dB(long.reduce((a, b) => a + b, 0) / long.length);
    const kept = long.map(dB).filter((v) => v > mean - 20).sort((a, b) => a - b);
    const at = (q) => kept[Math.min(kept.length - 1, Math.max(0, Math.round(q * (kept.length - 1))))];
    range = at(0.95) - at(0.1);
  }
  let peak = 0;
  for (const x of channels) for (const v of x) peak = Math.max(peak, Math.abs(v));
  return { lufs: Math.round(lufs * 10) / 10, range: Math.round(range * 10) / 10, peak: Math.round(20 * Math.log10(peak || 1e-9) * 10) / 10 };
}
