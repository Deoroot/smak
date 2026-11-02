// Style apart from quality: the judge's style measures (not the faults) over the blows of several shipped games,
// to see what each game's blows are like, which measures tell the games apart, and whether the blows fall into
// styles of their own when no game is named.
//
//   node anim/tools/styles.mjs [--games vt2,msr,hl,ts,l4d2] [--k 2-6] [--json <file>]
//
// Writes anim/corpus/styles.json: each game's band of every style measure (median, middle half, 5-95%), a style
// profile a blow can be held to ("like L4D2"), as bands.json is MSR's. Only the measures: nothing of a game's.
//
// Prints:
//   1. per game, each measure's median and middle half (weighted: a sequence shown with many submodels counts once)
//   2. the measures that part the games most: the gap between two games' medians over their middle halves
//   3. how well a blow's game is told from its measures alone: each blow set to the nearest game's centre, its own
//      model left out of that centre (so a weapon does not find itself)
//   4. unnamed styles: k-means over the blows for each k, what game and family each cluster holds, and what sets
//      it apart, in the measures' own words
// The measures are compared as robust z-scores (less the corpus's median, over its middle half).
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { measure, MEASURES, band } from "../lib/judge.mjs";
import { gameBlows } from "../lib/games.mjs";

const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const games = arg("--games", "vt2,msr,hl,ts,l4d2").split(",");
const [kLo, kHi] = arg("--k", "2-6").split("-").map(Number);

/** Measures that are style: not a fault, not a count of what is unseen, not tied to a hit delay or a blend. */
const STYLE = (key) => !/^fault\.|Hidden$|^seam\.|^timing\.|^reach\.hit|^frame\.tipOnScreenAtHit$|^other\.|^grip\.offhand$/.test(key);

// ── measure ──
const rows = [];
for (const b of gameBlows(games)) {
  try {
    const m = measure(b.buf, b.opts);
    rows.push({ game: b.game, model: b.model, seq: b.seq, family: b.family, weight: b.weight, values: m.values });
  } catch {
    // no arms or no fist to follow (MSR's claws): no measures
  }
}
const keys = Object.keys(MEASURES).filter(STYLE);
// a measure kept where at least two games have it for nearly every blow; a game without it (TS's arms are cut at
// the elbow: no upper-arm measures) is left out of that measure's comparisons only
const hasIt = (g, k) => {
  const of = rows.filter((r) => r.game === g);
  return of.length > 0 && of.filter((r) => r.values[k] !== null && r.values[k] !== undefined).length >= 0.9 * of.length;
};
const usable = keys.filter((k) => games.filter((g) => hasIt(g, k)).length >= Math.min(2, games.length));
const dropped = keys.filter((k) => !usable.includes(k));
const lacking = usable.map((k) => [k, games.filter((g) => !hasIt(g, k))]).filter(([, gs]) => gs.length);

const fmt = (x) => (x === null || x === undefined ? "-" : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));
const pad = (s, n) => String(s).padEnd(n);
const bandOf = (list, k) => band(list.map((r) => r.values[k] ?? null), list.map((r) => r.weight));

// ── 1. per game ──
const byGame = Object.fromEntries(games.map((g) => [g, rows.filter((r) => r.game === g)]));
console.log(`blows measured: ${games.map((g) => `${g} ${byGame[g].length} (${new Set(byGame[g].map((r) => r.model + "|" + r.seq)).size} sequences)`).join(", ")}`);
if (dropped.length) console.log(`left out (fewer than two games have them): ${dropped.join(", ")}`);
if (lacking.length) console.log(`kept, some games lacking: ${lacking.map(([k, gs]) => `${k} (no ${gs.join(", ")})`).join(", ")}`);
const bands = Object.fromEntries(games.map((g) => [g, Object.fromEntries(usable.map((k) => [k, hasIt(g, k) ? bandOf(byGame[g], k) : null]))]));

// ── 2. what parts the games ──
const gaps = usable.map((k) => {
  let most = { gap: 0 };
  for (let i = 0; i < games.length; i++)
    for (let j = i + 1; j < games.length; j++) {
      const [a, b] = [bands[games[i]][k], bands[games[j]][k]];
      if (!a || !b) continue;
      const spread = Math.max(((a.q3 - a.q1) + (b.q3 - b.q1)) / 2, MEASURES[k].tol ?? 1e-6);
      const gap = Math.abs(a.median - b.median) / spread;
      if (gap > most.gap) most = { gap, pair: [games[i], games[j]] };
    }
  return { key: k, ...most };
}).sort((x, y) => y.gap - x.gap);
console.log(`\nthe measures that part the games most (the gap between two games' medians, in their middle halves):`);
console.log(`${pad("measure", 22)}${pad("gap", 6)}${pad("between", 12)}${games.map((g) => pad(`${g} median [q1 q3]`, 26)).join("")}`);
for (const x of gaps.slice(0, 16))
  console.log(`${pad(x.key, 22)}${pad(x.gap.toFixed(1), 6)}${pad(x.pair?.join("/") ?? "", 12)}${games.map((g) => { const b = bands[g][x.key]; return pad(b ? `${fmt(b.median)} [${fmt(b.q1)} ${fmt(b.q3)}]` : "-", 26); }).join("")}`);

// ── robust z ──
const all = bandOf.bind(null, rows);
const scale = Object.fromEntries(usable.map((k) => {
  const b = all(k);
  return [k, { mid: b.median, by: Math.max(b.q3 - b.q1, MEASURES[k].tol ?? 1e-6) }];
}));
// clipped, so one wild blow does not pull a centre on its own
const zOf = (r) => usable.map((k) => (r.values[k] === null || r.values[k] === undefined ? 0 : Math.max(-4, Math.min(4, (r.values[k] - scale[k].mid) / scale[k].by))));
for (const r of rows) r.z = zOf(r);
const dist = (a, b) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));
const centre = (list) => {
  const w = list.reduce((s, r) => s + r.weight, 0);
  return usable.map((_, i) => list.reduce((s, r) => s + r.z[i] * r.weight, 0) / w);
};

// ── 3. is a blow's game told by its measures? ──
console.log(`\nthe nearest game's centre, each blow's own model left out of it (weighted share right):`);
const confusion = Object.fromEntries(games.map((g) => [g, Object.fromEntries(games.map((h) => [h, 0]))]));
for (const r of rows) {
  const centres = games.map((g) => {
    const list = byGame[g].filter((x) => !(x.game === r.game && x.model === r.model));
    return list.length ? { g, c: centre(list) } : null;
  }).filter(Boolean);
  const best = centres.reduce((a, b) => (dist(r.z, b.c) < dist(r.z, a.c) ? b : a));
  confusion[r.game][best.g] += r.weight;
}
console.log(`${pad("game", 8)}${games.map((g) => pad(`as ${g}`, 10)).join("")}right`);
for (const g of games) {
  const total = Object.values(confusion[g]).reduce((s, x) => s + x, 0);
  console.log(`${pad(g, 8)}${games.map((h) => pad(confusion[g][h].toFixed(1), 10)).join("")}${((100 * confusion[g][g]) / total).toFixed(0)}%`);
}

// ── 4. unnamed styles ──
/** k-means, the start spread out (k-means++ by a fixed sequence, so the run is the same every time). */
function kmeans(list, k) {
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const cs = [list[Math.floor(rand() * list.length)].z];
  while (cs.length < k) {
    const d = list.map((r) => Math.min(...cs.map((c) => dist(r.z, c))) ** 2 * r.weight);
    let pick = rand() * d.reduce((s, x) => s + x, 0);
    let i = 0;
    while (pick > d[i]) pick -= d[i++];
    cs.push(list[Math.min(i, list.length - 1)].z);
  }
  let of = [];
  for (let round = 0; round < 100; round++) {
    const next = list.map((r) => cs.reduce((best, c, j) => (dist(r.z, c) < dist(r.z, cs[best]) ? j : best), 0));
    if (next.every((x, i) => x === of[i])) break;
    of = next;
    for (let j = 0; j < k; j++) {
      const members = list.filter((_, i) => of[i] === j);
      if (members.length) cs[j] = centre(members);
    }
  }
  const within = list.reduce((s, r, i) => s + dist(r.z, cs[of[i]]) ** 2 * r.weight, 0);
  return { of, cs, within };
}
const out = { usable, bands, gaps, confusion, clusters: {} };
for (let k = kLo; k <= kHi; k++) {
  const { of, cs, within } = kmeans(rows, k);
  console.log(`\nk = ${k} (spread left within the clusters ${within.toFixed(0)}):`);
  out.clusters[k] = [];
  for (let j = 0; j < k; j++) {
    const members = rows.filter((_, i) => of[i] === j);
    if (!members.length) continue;
    const w = (list) => list.reduce((s, r) => s + r.weight, 0);
    const tally = (field) => Object.entries(members.reduce((t, r) => ((t[r[field]] = (t[r[field]] ?? 0) + r.weight), t), {})).sort((a, b) => b[1] - a[1]).map(([x, n]) => `${x} ${n.toFixed(n % 1 ? 1 : 0)}`).join(", ");
    // what sets it apart: its centre's farthest measures from the corpus's middle, said as the measure says them
    const marks = usable.map((key, i) => ({ key, z: cs[j][i] })).sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 5);
    const says = marks.map((x) => `${x.key} ${x.z > 0 ? "+" : ""}${x.z.toFixed(1)} (${(x.z > 0 ? MEASURES[x.key].high : MEASURES[x.key].low) || MEASURES[x.key].what})`);
    console.log(`  ${j + 1}. ${w(members).toFixed(1)} blows: ${tally("game")}  |  ${tally("family")}`);
    for (const s of says) console.log(`       ${s}`);
    out.clusters[k].push({ games: tally("game"), families: tally("family"), marks, members: members.map((r) => `${r.game} ${r.model} ${r.seq}`) });
  }
}
const json = arg("--json");
if (json) writeFileSync(json, JSON.stringify(out, null, 1));
const profiles = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "styles.json");
writeFileSync(profiles, JSON.stringify({ written: new Date().toISOString().slice(0, 10), games, measures: keys, blows: Object.fromEntries(games.map((g) => [g, byGame[g].length])), bands: Object.fromEntries(games.map((g) => [g, Object.fromEntries(keys.map((k) => [k, bandOf(byGame[g], k)]).filter(([, b]) => b))])) }, null, 1));
console.log(`
wrote ${profiles}`);
