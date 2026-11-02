// The defects tried on professional work: every hard limit of the judge (MEASURES' `hard`) run over the blows of
// several shipped games, each game counted apart. A defect is one only when it never fires on this corpus, or
// fires where a look at the frames shows a real fault; anything else is a style and belongs in a band.
//
//   node anim/tools/defects.mjs [--games msr,hl,ts,l4d2,bad] [--show] [--json <file>]
//
// --show lists every firing (game, model, sequence, measure, value, frame); without it, the count per game.
// "bad" is the bad set (build it first with anim/tools/badset.mjs): there every blow should fire, and the
// table says which faults went unseen. The games are read where this machine has them (anim/lib/games.mjs); a
// game not installed is left out with a note.
// Nothing of a game's is written: only the measures.
import { writeFileSync } from "node:fs";
import { measure, MEASURES } from "../lib/judge.mjs";
import { gameBlows } from "../lib/games.mjs";

const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const games = arg("--games", "msr,hl,ts,l4d2,bad").split(",");
const show = process.argv.includes("--show");

const hardKeys = Object.entries(MEASURES).filter(([, m]) => m.hard).map(([k]) => k);
const tally = {};
const firings = [];
const rows = [];
for (const b of gameBlows(games)) {
  const t = (tally[b.game] ??= { blows: 0, failed: 0, errors: 0, by: {} });
  t.blows++;
  let m;
  try {
    m = measure(b.buf, b.opts);
  } catch (err) {
    t.errors++;
    if (show) console.log(`${b.game} ${b.model} ${b.seq}: ERROR ${err.message}`);
    continue;
  }
  const fired = [];
  for (const key of hardKeys) {
    const value = m.values[key];
    const meta = MEASURES[key];
    if (value === null || value === undefined) continue;
    const [lo, hi] = meta.heldOnly && m.info.twoHanded !== "held" ? [null, null] : meta.hard;
    if ((lo !== null && value < lo) || (hi !== null && value > hi)) fired.push({ key, value, at: m.info.where?.[key]?.at ?? null });
  }
  rows.push({ game: b.game, model: b.model, seq: b.seq, values: Object.fromEntries(hardKeys.map((k) => [k, m.values[k] ?? null])), fired: fired.map((f) => f.key) });
  if (fired.length) t.failed++;
  for (const f of fired) {
    t.by[f.key] = (t.by[f.key] ?? 0) + 1;
    firings.push({ game: b.game, model: b.model, seq: b.seq, ...f });
  }
}

const fmt = (x) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));
if (show) for (const f of firings) console.log(`${f.game.padEnd(5)} ${f.model.padEnd(16)} ${String(f.seq).padEnd(22)} ${f.key.padEnd(16)} ${fmt(f.value).padStart(7)}${f.at !== null ? `  frame ${f.at}` : ""}`);
console.log(`\n${"game".padEnd(6)}${"blows".padStart(6)}${"with a defect".padStart(15)}  defects fired`);
for (const [game, t] of Object.entries(tally))
  console.log(`${game.padEnd(6)}${String(t.blows).padStart(6)}${String(t.failed).padStart(15)}  ${Object.entries(t.by).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}${t.errors ? `  (${t.errors} errors)` : ""}`);
const out = arg("--json");
if (out) writeFileSync(out, JSON.stringify({ hardKeys, tally, rows }, null, 1));
