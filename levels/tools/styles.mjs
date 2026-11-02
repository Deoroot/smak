// The level corpora made into per-kind style bands (PLAN.md, Phase 3: "Styles are a kind of game plus a
// theme"): levels/styles/<kind>.json for each kind, levels/styles/<style>.json for each style, and the guide
// levels/styles/README.md with the numbers in tables. Measures and bands only: no map's geometry or entities.
// The kinds come from levels/styles/tags.json, kept apart from the corpora, so run this again whenever a
// survey regenerates levels/corpus/levels-*.json.
//
//   node levels/tools/styles.mjs [--corpus <folder>] [--tags <file>] [--out <folder>] [--check]
//
// --check writes nothing and exits 1 when a file would change (the corpus moved on without the styles).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CORPORA,
  GAME_NAMES,
  MEASURES,
  MIN_SETTING_MAPS,
  STYLES,
  styleBands,
  styleOf,
} from "../lib/styles.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEVELS = join(HERE, "..");

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const corpusDir = opt("--corpus", join(LEVELS, "corpus"));
const tagsFile = opt("--tags", join(LEVELS, "styles", "tags.json"));
const outDir = opt("--out", join(LEVELS, "styles"));
const check = args.includes("--check");

const corpora = {};
for (const game of Object.keys(CORPORA)) {
  const f = join(corpusDir, `levels-${game}.json`);
  if (existsSync(f)) corpora[game] = JSON.parse(readFileSync(f, "utf8"));
  else console.log(`no corpus ${f}: its kind goes without it`);
}
const tags = JSON.parse(readFileSync(tagsFile, "utf8"));
const result = styleBands(corpora, tags);

// ── the guide's tables ───────────────────────────────────────────────────────

const pct = (x) => (x == null ? "" : `${Math.round(x * 100)} %`);
const fmt = (x, unit) => {
  if (x == null) return "";
  if (unit === "share") return pct(x);
  if (unit === "m2") return `${Math.round(x).toLocaleString("en-US").replace(/,/g, " ")} m²`;
  if (unit === "m") return `${x} m`;
  return `${x}`;
};
const cell = (e) => {
  if (!e) return "";
  if (!e.band) {
    if (e.pooled === false)
      return Object.entries(e.bySource ?? {})
        .map(([g, b]) => `${g}: ${fmt(b.median, e.unit)}`)
        .join("; ");
    return "—";
  }
  const b = e.band;
  let s = `${fmt(b.median, e.unit)} (${fmt(b.p10, e.unit)}–${fmt(b.p90, e.unit)})`;
  if (e.ph?.median != null) s += `, ${e.ph.median} ph`;
  if (e.bare) s += `; bare ${fmt(e.bare.median, e.unit)}`;
  return s;
};
const lacksCell = (e) => (e?.lacks ? Object.keys(e.lacks).join(", ") : "");

/**
 * one table: measure rows, a column per band set (`cols`: [title, bands]); `city` true for the role-play city
 * measures alone, false (the default) for the others
 */
const table = (cols, { withN = true, city = false } = {}) => {
  const head = ["measure", ...cols.map(([t]) => t)];
  const lines = [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`];
  for (const m of MEASURES) {
    if (Boolean(m.cityOnly) !== city) continue;
    const cells = cols.map(([, bands]) => {
      const e = bands?.[m.key];
      const c = cell(e);
      return c && withN && e?.band ? `${c} n${e.band.n}` : c;
    });
    if (cells.every((c) => !c || c === "—")) continue;
    lines.push(`| ${m.label} | ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
};

const tenthsLine = (pacing) =>
  Object.entries(pacing ?? {})
    .map(
      ([g, p]) => `${GAME_NAMES[g]} (${p.what}, ${p.maps} maps): ${p.tenths.map((t) => pct(t)).join(" · ")}`,
    )
    .join("\n- ");

const k = result.kinds;
const ex = k.exploration;
const lines = [];
lines.push(`# Level styles: bands per kind of game

What Phase 3's level checks read (PLAN.md, "Styles are a kind of game plus a theme"): the surveyed levels
tagged by kind (\`tags.json\`), and each kind's measures banded from its own levels only, never pooled across
kinds. Made by \`node levels/tools/styles.mjs\` from \`levels/corpus/levels-*.json\` with
\`levels/lib/styles.mjs\`; run it again after a survey. This file is written by the tool: change the tool, not
the tables. Measures and bands only.

**How to read a cell**: median (p10–p90), then the median in player heights (ph: 72 units = 1.83 m in
GoldSrc and Source, 1.8 m in Vermintide 2), then n maps. A map is one vote, and in a kind with two games
each game's maps weigh as much together as the other's. **bare**: Left 4 Dead 2 measures width and sight
twice; the band uses every solid static prop as the engine collides with it (its collision hulls,
\`withPropCollision\`: dressed), *bare* is the world alone (far too wide). A cell of several "game: value" is a measure the games take too
differently to pool. A measure no game of a kind takes is a gap, listed under the kind.
`);

lines.push(`## Kinds

| kind | maps | from | left out |
| --- | --- | --- | --- |
${Object.values(k)
  .map(
    (e) =>
      `| ${e.kind} | ${e.n} | ${e.sources.map((s) => `${s.title} ${s.maps}`).join(", ")} | ${e.left.length} |`,
  )
  .join("\n")}

Exploration's settings (Master Sword Rebirth): ${Object.entries(ex?.settings ?? {})
  .map(([s, v]) => `${s} ${v.n}`)
  .join(
    ", ",
  )}. Bands of a setting of its own need ${MIN_SETTING_MAPS} maps. Left out of every kind: Counter-Strike
(not one of the five kinds) and Master Sword Classic (the same maps as Rebirth, older); GoldSrc maps whose walk
reached under a tenth of their floor (it began boxed in); ms_soccer (a minigame). Each kind's file lists its
left-out maps and why. The role-play cities (rp-city) carry measures of their own (streets, buildings, layers,
variety, light, furniture), banded in their own section below.
`);

for (const style of STYLES) {
  const s = styleOf(style, result);
  lines.push(`## Style: ${s.title}

${s.for ? `${s.for}. ` : ""}${s.about}

Bands from **${s.bandsFrom}**; the whole exploration kind beside it; the co-op campaign (${s.fallback?.n ?? 0}
maps) as the fallback for a route with side areas mixed in.

${table([
  [`${s.kind}/${s.setting}`, s.bands],
  [`${s.kind} (all)`, s.kindBands],
  [`fallback: ${s.fallback?.kind}`, s.fallback?.bands],
])}

Gaps (no game of the kind takes them): ${s.gaps.map((g) => g.label).join("; ") || "none"}.
`);
}

lines.push(`## Exploration by setting (Master Sword Rebirth)

${table(
  Object.entries(ex?.settings ?? {})
    .filter(([, v]) => v.bands)
    .map(([name, v]) => [`${name} (${v.n})`, v.bands]),
)}

${Object.entries(ex?.settings ?? {})
  .filter(([, v]) => !v.bands)
  .map(
    ([name, v]) =>
      `- **${name}** (${v.n}): ${v.tooFew ?? "left out of the setting bands"}. ${v.maps.join(", ")}.`,
  )
  .join("\n")}
`);

const rp = k["rp-city"];
if (rp) {
  const perMap = rp.maps.map((name) => {
    const row = corpora[name.split("/")[0]]?.maps.find((m) => m.name === name.split("/")[1]);
    return [name.split("/")[1], row];
  });
  // a column per city: its own value of each measure, as one map's band
  const own = (row) => {
    const bands = {};
    for (const m of MEASURES) {
      if (!m.cityOnly) continue;
      const v = m.from.goldsrc(row, "rp-city");
      if (v == null) continue;
      bands[m.key] = { unit: m.unit, band: { n: 1, median: Math.round(v * 1000) / 1000, p10: null, p90: null } };
    }
    return bands;
  };
  const ownCell = (cols) => cols.map(([t, b]) => [t, b]);
  lines.push(`## Role-play cities (rp-city)

${rp.about ?? ""} ${rp.n} maps (${rp.maps.join(", ")}). The city measures are levels/lib/city-measures.mjs's, on
the walked floor (levels/notes-rp-city.md says what each is). Each city's own value beside the band; with so
few cities the band's p10 and p90 are the cities' own extremes, near enough.

${table([[`rp-city (${rp.n})`, rp.bands], ...ownCell(perMap.map(([n, row]) => [n, own(row)]))], { city: true, withN: false })
  .split("\n")
  .map((line) => line.replace(/ \(–\)/g, ""))
  .join("\n")}

The kind's general measures (width, headroom, sight ...) are in the table of all kinds.
`);
}

lines.push(`## All kinds side by side

${table(Object.values(k).map((e) => [`${e.kind} (${e.n})`, e.bands]))}

Pacing, event positions by tenths of the route (each map one vote):
- ${tenthsLine(k["coop-campaign"]?.pacing) || "none"}
`);

lines.push(`## Gaps

${Object.values(k)
  .map((e) => `- **${e.kind}**: ${e.gaps.map((g) => g.label).join("; ") || "none"}.`)
  .join("\n")}
- Every kind but rp-city: no corpus segments rooms (room size stands on the open-space width and walked
  floor), counts branches or dead ends, or measures cover. rp-city's rooms are cut at doors only (a room open
  to a street is street). Vermintide 2 has no solid geometry (no headroom, sight, doors or
  stairs); Left 4 Dead 2 only brackets width and sight. See levels/notes-*.md.
`);

const files = { "README.md": lines.join("\n") };
for (const e of Object.values(k)) files[`${e.kind}.json`] = JSON.stringify(e, null, 2) + "\n";
for (const style of STYLES)
  files[`${style.name}.json`] = JSON.stringify(styleOf(style, result), null, 2) + "\n";

let changed = 0;
if (!check) mkdirSync(outDir, { recursive: true });
for (const [name, text] of Object.entries(files)) {
  const f = join(outDir, name);
  const was = existsSync(f) ? readFileSync(f, "utf8") : null;
  if (was === text) continue;
  changed++;
  if (check) console.log(`would change ${f}`);
  else writeFileSync(f, text);
}
for (const e of Object.values(k))
  console.log(
    `${e.kind}: ${e.n} maps (${e.sources.map((s) => `${s.game} ${s.maps}`).join(", ")}), ${e.left.length} left out`,
  );
if (result.untagged.length) console.log(`untagged: ${result.untagged.join(", ")}`);
console.log(check ? `${changed} file(s) would change` : `${changed} file(s) written to ${outDir}`);
if (check && changed) process.exitCode = 1;
