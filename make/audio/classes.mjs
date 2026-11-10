// What the game's own sounds of each kind measure: the ranges a made sound is held against. These are numbers
// measured from Half-Life's files in a person's install (research/sound-generation.md, section 5.3), not the
// files: nothing of the game's audio is in the kit. `research/sound-classes.mjs` measures them again where the
// game is installed.
//
//   CLASSES                     -> { name: [rows] }
//   rangesOf(name)              -> { feature: [lo, hi] } widened by the margins of section 5.4
//   scoreAgainst(features, name) -> { score, of, lines }: each feature 2 in range, 1 near it, 0 off, in words

// one row a file: length, peak, rms, crest, attack (s), t20, t40, centroid, flatness, bands <150 .. >5k
const row = (file, length, peak, rms, crest, attack, t20, t40, centroid, flatness, b0, b1, b2, b3, b4) => ({
  file,
  length,
  peak,
  rms,
  crest,
  attack: attack / 1000,
  t20,
  t40,
  centroid,
  flatness,
  bands: { "<150": b0, "150-600": b1, "600-2k": b2, "2k-5k": b3, ">5k": b4 },
});

export const CLASSES = {
  "metal hit": [row("weapons/cbar_hit1.wav", 0.69, -0.4, -9.9, 9.5, 5, 0.56, 0.65, 1343, 0.215, 4.9, 6.8, 73.8, 13.7, 0.9), row("weapons/cbar_hit2.wav", 0.49, -0.4, -8.7, 8.3, 5, 0.32, 0.46, 1378, 0.224, 4.5, 6.1, 73.7, 14.6, 1.0)],
  "flesh hit": [row("weapons/cbar_hitbod1.wav", 0.31, -0.5, -8.4, 7.9, 40, 0.24, 0.27, 702, 0.209, 68.1, 10.9, 8.1, 9.8, 3.1)],
  swing: [row("weapons/cbar_miss1.wav", 0.34, -8.9, -22.8, 13.9, 170, 0.1, 0.14, 760, 0.187, 1.0, 65.8, 25.0, 6.7, 1.6)],
  gunshot: [
    row("weapons/357_shot1.wav", 1.06, 0.0, -8.5, 8.5, 5, 0.75, 1.0, 937, 0.241, 20.3, 27.5, 43.9, 6.7, 1.6),
    row("weapons/357_shot2.wav", 1.06, 0.0, -8.7, 8.7, 5, 0.75, 0.98, 1048, 0.331, 23.3, 26.0, 36.1, 12.1, 2.4),
    row("weapons/sbarrel1.wav", 1.04, -0.4, -8.7, 8.3, 5, 0.61, 0.96, 604, 0.172, 31.7, 37.9, 24.4, 4.8, 1.3),
    row("weapons/dbarrel1.wav", 1.37, -0.1, -7.5, 7.5, 5, 0.81, 1.13, 526, 0.159, 38.0, 33.4, 23.4, 4.5, 0.7),
  ],
  reload: [row("weapons/357_reload1.wav", 0.58, -6.2, -28.5, 22.3, 175, 0.25, 0.39, 3930, 0.638, 1.1, 0.3, 18.4, 55.5, 24.6)],
  click: [
    row("weapons/357_cock1.wav", 0.12, 0.0, -12.9, 12.9, 10, 0.04, 0.11, 5923, 0.379, 0, 0.1, 2.5, 39.1, 58.2),
    row("weapons/dryfire1.wav", 0.18, -0.3, -15.4, 15.1, 15, 0.05, 0.14, 5922, 0.394, 0, 0.2, 6.6, 34.7, 58.4),
    row("weapons/reload1.wav", 0.22, -0.1, -21.1, 21.1, 95, 0.04, 0.08, 4579, 0.455, 0.1, 0.1, 12.5, 51.0, 36.3),
  ],
  pump: [row("weapons/scock1.wav", 0.53, 0.0, -18.3, 18.3, 329, 0.07, 0.18, 3996, 0.597, 0.2, 0.6, 18.3, 51.5, 29.4)],
  shell: [row("weapons/sshell1.wav", 0.71, -4.0, -19.4, 15.4, 55, 0.51, 0.65, 2117, 0.184, 0.7, 0.4, 46.3, 42.7, 9.8)],
  launcher: [row("weapons/rocketfire1.wav", 0.43, -1.0, -9.1, 8.1, 75, 0.3, 0.35, 2280, 0.475, 2.1, 36.2, 30.5, 13.4, 17.8), row("weapons/glauncher.wav", 1.27, 0.0, -12.2, 12.2, 0, 1.14, 1.19, 862, 0.267, 21.8, 43.1, 22.5, 10.2, 2.4)],
  "grenade cock": [row("weapons/gren_cock1.wav", 0.75, -0.3, -18.9, 18.6, 180, 0.37, 0.55, 1664, 0.523, 2.8, 34.2, 27.2, 34.5, 1.2)],
  "grenade bounce": [row("weapons/g_bounce1.wav", 0.28, -9.1, -21.2, 12.2, 75, 0.2, 0.21, 152, 0.01, 85.8, 12.8, 0.8, 0.4, 0)],
  explosion: [row("weapons/explode3.wav", 1.3, -0.4, -6.2, 5.7, 5, 0.89, 1.03, 616, 0.178, 36.4, 37.6, 19.5, 4.6, 1.9)],
  "step concrete": [row("player/pl_step1.wav", 0.27, -0.1, -21.1, 21.0, 0, 0.09, 0.26, 853, 0.27, 26.8, 48.3, 8.5, 15.1, 1.4), row("player/pl_step2.wav", 0.22, -0.6, -19.5, 18.8, 0, 0.13, 0.21, 847, 0.277, 25.2, 49.7, 8.2, 16.0, 0.9)],
  "step metal": [row("player/pl_metal1.wav", 0.58, 0.0, -15.5, 15.5, 25, 0.42, 0.54, 360, 0.057, 34.8, 43.8, 19.6, 1.8, 0.1)],
  "step dirt": [row("player/pl_dirt1.wav", 0.34, -0.1, -21.3, 21.2, 5, 0.26, 0.34, 1368, 0.433, 3.1, 30.1, 41.9, 24.2, 0.8)],
  "step tile": [row("player/pl_tile1.wav", 0.23, -2.3, -19.4, 17.0, 0, 0.11, 0.23, 274, 0.021, 11.4, 85.9, 1.4, 1.3, 0)],
  "step grate": [row("player/pl_grate1.wav", 0.82, 0.0, -14.8, 14.8, 35, 0.68, 0.73, 199, 0.019, 53.6, 41.2, 4.6, 0.5, 0)],
  "step vent": [row("player/pl_duct1.wav", 0.85, -0.3, -14.1, 13.8, 160, 0.59, 0.68, 236, 0.003, 64.3, 15.5, 20.2, 0.1, 0)],
  "loop drips": [row("ambience/drips.wav", 7.31, -0.4, -27.3, 26.9, 0, 0, 0, 839, 0.095, 1.2, 23.2, 72.3, 2.5, 0.7)],
  "loop crickets": [row("ambience/crickets.wav", 3.58, -0.1, -18.7, 18.7, 0, 0, 0, 4499, 0.086, 0.1, 0, 0.7, 86.2, 13.0)],
  "loop machine": [row("ambience/industrial1.wav", 2.71, -0.4, -11.7, 11.3, 0, 0, 0, 337, 0.001, 3.9, 94.2, 1.9, 0, 0)],
  "loop drone": [row("ambience/labdrone1.wav", 5.36, -0.1, -12.1, 12.1, 0, 0, 0, 188, 0.001, 55.6, 40.4, 4.0, 0, 0)],
  "loop fire": [row("ambience/burning1.wav", 5.4, 0.0, -13.1, 13.1, 0, 0, 0, 585, 0.2, 16.3, 63.1, 14.2, 5.5, 1.0)],
};

/** How far past the game's own a feature may be and still be in range (section 5.4): a share, and a least. */
const MARGINS = {
  length: { share: 0.25, least: 0.1, unit: "s" },
  crest: { share: 0.25, least: 3, unit: "dB" },
  rms: { share: 0, least: 3, unit: "dBFS" },
  t20: { share: 0.25, least: 0.05, unit: "s" },
  centroid: { share: 0.2, least: 100, unit: "Hz" },
  flatness: { share: 0.25, least: 0.05, unit: "" },
};
const BAND_MARGIN = 10;

/** The ranges of a class, widened by the margins: { feature: [lo, hi] }, bands by name. */
export function rangesOf(name) {
  const rows = CLASSES[name];
  if (!rows) throw new Error(`no class "${name}": the classes are ${Object.keys(CLASSES).join(", ")}`);
  const ranges = {};
  const loop = name.startsWith("loop ");
  for (const [feature, m] of Object.entries(MARGINS)) {
    if (loop && feature === "t20") continue;
    const values = rows.map((r) => r[feature]);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const widen = (v) => Math.max(m.least, Math.abs(v) * m.share);
    ranges[feature] = [lo - widen(lo), hi + widen(hi)];
  }
  for (const band of Object.keys(rows[0].bands)) {
    const values = rows.map((r) => r.bands[band]);
    ranges[`band ${band}`] = [Math.max(0, Math.min(...values) - BAND_MARGIN), Math.min(100, Math.max(...values) + BAND_MARGIN)];
  }
  return ranges;
}

/**
 * A sound's features against its class: each feature 2 inside the range, 1 within its width again, 0 off;
 * `lines` say the ones off in words, with which way to go.
 */
export function scoreAgainst(features, name) {
  const ranges = rangesOf(name);
  let score = 0;
  let of = 0;
  const lines = [];
  for (const [feature, [lo, hi]] of Object.entries(ranges)) {
    const value = feature.startsWith("band ") ? features.bands[feature.slice(5)] : features[feature];
    const width = Math.max(hi - lo, 1e-6);
    const points = value >= lo && value <= hi ? 2 : value >= lo - width && value <= hi + width ? 1 : 0;
    score += points;
    of += 2;
    if (points < 2) {
      const unit = MARGINS[feature]?.unit ?? "%";
      const way = value < lo ? "under" : "over";
      const hint =
        feature === "centroid"
          ? value < lo ? "too dark: more 600 to 5000 Hz" : "too bright: less over 2000 Hz"
          : feature === "crest"
            ? value > hi ? "too spiky: saturate more, or hold its body longer" : "too squashed"
            : feature === "flatness"
              ? value < lo ? "too pure: more noise" : "too noisy: more tone (modes)"
              : feature === "t20"
                ? value < lo ? "dies too soon: a longer decay" : "rings too long: a shorter decay"
                : feature === "length" ? (value < lo ? "too short" : "too long") : `${way} the range`;
      lines.push(`${feature} ${value}${unit === "%" ? "%" : unit ? ` ${unit}` : ""} (${round(lo)} to ${round(hi)}): ${hint}`);
    }
  }
  return { score, of, lines };
}
const round = (v) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100);
