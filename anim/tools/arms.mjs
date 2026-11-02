// The arms judged: a view model's arm (its proportions, roll bones, skin across the joints, shape and mesh) against a
// reference game's, as bands (lib/arms.mjs). What makes a reference's blows look as they do is partly the arm they
// move: a skin blended across the wrist twists where a rigid one wrings, a ring of vertices more bends cleanly.
//
//   node anim/tools/arms.mjs survey [--game vt2|msr|hl|ts|l4d2]
//        every hero's striking arm measured (vt2: anim/vt2/out/arms.json, from anim/vt2/arms.py), or both arms of
//        each view model whose blows make the game's style bands (anim/lib/games.mjs), into
//        anim/corpus/arms-<game>.json: each measure's lowest, median and highest, and how many. Numbers only.
//   node anim/tools/arms.mjs judge <mdl> [--side R|L] [--ref vt2]
//        a view model's arm against those bands: each measure, the band, inside or which way out; PASSES with none
//        out, DOUBTFUL with one or two, else FAILS. Measures marked info are shown, not counted.
//   node anim/tools/arms.mjs fit <mdl> [--out file] [--ref vt2] [--skip proportions,roll] [--share 0.5]
//        the view model's arms fitted toward those bands (lib/fitarms.mjs): proportions into the bands, roll bones
//        on the upper arm and the forearm turned in every animation; written to --out (build/arms/<name>.fitted.mdl
//        unless told), and both arms judged before and after.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { armOfVt2, armOfModel, armMeasures, vt2Heroes, ARM_MEASURES } from "../lib/arms.mjs";
import { viewModel } from "../lib/corpus.mjs";
import { fitArms } from "../lib/fitarms.mjs";
import { gameBlows, GAMES } from "../lib/games.mjs";

/** Each game's name, as the bands say it. */
const REFERENCE = { vt2: "Vermintide 2", msr: "Master Sword Rebirth", hl: "Half-Life", ts: "The Specialists", l4d2: "Left 4 Dead 2" };
import { check } from "../../src/check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A model's arm judged against bands, printed: how many measures are out (info ones not counted). */
function judge(buf, side, name, bands, reference, { quiet = false } = {}) {
  const arm = armOfModel(buf, side, name);
  const m = armMeasures(arm);
  let out = 0;
  if (!quiet) console.log(`${arm.name}: the ${side} arm against ${reference}'s`);
  for (const [key, meta] of Object.entries(ARM_MEASURES)) {
    const b = bands[key];
    const v = m[key];
    if (v === undefined && !b) continue;
    let mark = "";
    if (b && v !== undefined) {
      const [lo, hi] = [b.low - meta.tol, b.high + meta.tol];
      mark = v < lo ? "LOW" : v > hi && !meta.least ? "HIGH" : "ok";
      if (mark !== "ok" && !meta.info) out++;
    } else mark = v === undefined ? "none" : "";
    const band = b ? (b.low === b.high ? `${b.low}` : `${b.low}..${b.high}`) : "-";
    if (!quiet) console.log(`  ${key.padEnd(20)} ${String(v ?? "-").padStart(7)}  ${band.padStart(13)}  ${(meta.info ? `(${mark})` : mark).padEnd(6)} ${meta.what}`);
  }
  if (!quiet) console.log(verdict(out));
  return { out, m };
}
const verdict = (out) => (out ? (out <= 2 ? `DOUBTFUL (${out} out)` : `FAILS (${out} out)`) : "PASSES");

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus");
const args = process.argv.slice(2);
const loose = [];
const opts = {};
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith("--")) loose.push(args[i]);
  else opts[args[i].slice(2)] = args[++i];
}
const [command, file] = loose;

if (command === "survey") {
  const game = opts.game ?? "vt2";
  // each hero's arm (Vermintide 2), or each view model's whose blows make the game's style bands (games.mjs)
  const rows = [];
  const names = [];
  if (game === "vt2") {
    const heroes = vt2Heroes();
    if (!heroes.length) throw new Error("no anim/vt2/out/arms.json: run anim/vt2/arms.py");
    for (const h of heroes) {
      rows.push(armMeasures(armOfVt2(h, "R")));
      names.push(h);
    }
  } else {
    if (!GAMES.includes(game)) throw new Error(`no arms survey for ${game}: one of ${GAMES.join(", ")}`);
    const seen = new Set();
    for (const b of gameBlows([game])) {
      if (seen.has(b.model)) continue;
      seen.add(b.model);
      // both arms: a game's own left arm is its style as much as its right (MSR's left hand is longer)
      for (const side of ["R", "L"])
        try {
          rows.push(armMeasures(armOfModel(b.buf, side, b.model, b.opts.arms?.[side])));
          names.push(`${b.model} ${side}`);
        } catch (e) {
          console.log(`  ${b.model} ${side}: ${e.message}, left out`);
        }
    }
    if (!rows.length) throw new Error(`no arms of ${game} read`);
  }
  const bands = {};
  for (const key of Object.keys(ARM_MEASURES)) {
    const xs = rows.map((r) => r[key]).filter((x) => typeof x === "number").sort((a, b) => a - b);
    if (xs.length) bands[key] = { low: xs[0], median: xs[Math.floor(xs.length / 2)], high: xs.at(-1), n: xs.length };
  }
  const out = {
    reference: REFERENCE[game] ?? game,
    game,
    made: new Date().toISOString().slice(0, 10),
    how:
      game === "vt2"
        ? "anim/tools/arms.mjs survey: each hero's first-person right arm (one skeleton, a mesh each), measured at the skin's bind pose; ratios only"
        : "anim/tools/arms.mjs survey: both arms of each view model whose blows make the game's style bands (anim/lib/games.mjs), at its idle's first frame; ratios only",
    arms: names.length,
    bands,
  };
  writeFileSync(join(CORPUS, `arms-${game}.json`), JSON.stringify(out, null, 1) + "\n");
  console.log(`${names.length} arms (${names.join(", ")}) -> anim/corpus/arms-${game}.json`);
  for (const [k, b] of Object.entries(bands)) console.log(`  ${k.padEnd(20)} ${String(b.low).padStart(7)} ${String(b.median).padStart(7)} ${String(b.high).padStart(7)}`);
} else if (command === "judge" && file) {
  const { bands, reference } = JSON.parse(readFileSync(join(CORPUS, `arms-${opts.ref ?? "vt2"}.json`), "utf8"));
  judge(viewModel(file), opts.side ?? "R", file, bands, reference);
} else if (command === "fit" && file) {
  const { bands, reference } = JSON.parse(readFileSync(join(CORPUS, `arms-${opts.ref ?? "vt2"}.json`), "utf8"));
  const src = viewModel(file);
  const skip = (opts.skip ?? "").split(",").filter(Boolean);
  const steps = Object.fromEntries(skip.map((k) => [k, false]));
  const { mdl, did } = fitArms(src, bands, { steps, rollShare: opts.share ? Number(opts.share) : undefined });
  const to = opts.out ?? join(ROOT, "build", "arms", `${basename(file, ".mdl")}.fitted.mdl`);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, mdl);
  console.log(`${file} fitted toward ${reference}'s arms -> ${to}`);
  for (const line of did) console.log(`  ${line}`);
  const { errors } = check(mdl);
  console.log(errors.length ? `  check: ${errors.join("; ")}` : "  check: no errors");
  for (const side of ["R", "L"]) {
    let was;
    try {
      was = judge(src, side, file, bands, reference, { quiet: true });
    } catch {
      continue;
    }
    console.log(`
${side} arm: before ${verdict(was.out)}, after:`);
    judge(mdl, side, basename(to), bands, reference);
  }
} else {
  console.log("node anim/tools/arms.mjs survey [--game vt2]\nnode anim/tools/arms.mjs judge <mdl> [--side R|L] [--ref vt2]");
  process.exit(1);
}
