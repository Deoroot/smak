// The physical judge from the command line.
//
//   node anim/tools/judge.mjs survey [--game vt2|msr] [--models <dir>]
//        a reference game's blows measured (vt2, the default: every melee sweep of Vermintide 2's templates, from
//        anim/vt2/'s local cache; msr: every melee item's attack sequences, anim/corpus/melee-items.json, one per
//        model, submodel and sequence); writes anim/corpus/bands-<game>.json: each measure's spread over the
//        game's blows and per weapon family, and the measures each blow gave.
//   node anims/tools/judge.mjs judge <mdl> <seq> [--submodel g=i] [--delay s] [--range u] [--family f]
//        [--fps n] [--idle seq] [--fist] [--timing msc|sync] [--reference vt2|msr] [--strength light|heavy] [--json]
//        one sequence's measures, each against its band (Vermintide 2's unless --reference says), with what it
//        means, and a verdict. --strength holds it to the reference's light blows' or heavy blows' bands where
//        it keeps them apart (Vermintide 2's: a heavy starts cocked from a held charge).
//   node anims/tools/judge.mjs judge <mdl> --all [...]
//        every sequence of the file whose name is not an idle, a draw or a sheath.
//   ... --draw [dir]
//        also the pictures of what the judge found, each fault drawn where it happens (anims/lib/draw.mjs):
//        eye.png (frames from the eye, each finding marked on its frame and written under it), plans.png (side,
//        top and edge-on to the strike's plane), timeline.png (frame by frame, each finding's curve against
//        the reference's band), closeups.png (each finding up close). Into build/anims/judged/<model>/<seq>/, or <dir>
//        (with --all, <dir>/<seq>/); a dir is told by a slash or a leading dot.
//
// <mdl> is a path or a view model's name in MSR's install ("v_1hswords"). --submodel takes a bodypart's name
// or number and a submodel number, as strip.mjs does; --family is one of the FAMILIES, else guessed from the
// file's name.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { png } from "../../src/image.mjs";
import { judgedPictures } from "../lib/draw.mjs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { readMdl, sequences } from "../../src/mdl.mjs";
import { viewModel, meleeBlows, VIEWMODELS } from "../lib/corpus.mjs";
import { measure, verdicts, overall, band, familyOf, blowKind, FAMILIES, MEASURES } from "../lib/judge.mjs";
import { gameBlows } from "../lib/games.mjs";
import { loadBands, bandsPath, REFERENCE, REFERENCES } from "../lib/bands.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const loose = [];
const opts = { submodel: [] };
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith("--")) {
    loose.push(args[i]);
    continue;
  }
  const key = args[i].slice(2);
  if (key === "all" || key === "fist" || key === "json") {
    opts[key] = true;
    continue;
  }
  // --draw takes a directory only when the next word is one (a slash in it, or a leading dot)
  if (key === "draw") {
    const next = args[i + 1];
    opts.draw = next !== undefined && !next.startsWith("--") && /[\\/]|^\./.test(next) ? args[++i] : true;
    continue;
  }
  const value = args[++i];
  if (value === undefined) throw new Error(`--${key} wants a value`);
  if (key === "submodel") opts.submodel.push(value.split("="));
  else opts[key] = value;
}
const [mode, ...rest] = loose;

// ── survey ─────────────────────────────────────────────────────────────────

function survey() {
  const game = opts.game ?? REFERENCE;
  if (!REFERENCES[game]) throw new Error(`--game: one of ${Object.keys(REFERENCES).join(", ")}`);
  const results = [];
  const skipped = [];
  if (game === "msr") {
    const modelsDir = opts.models ?? VIEWMODELS;
    const buffers = new Map();
    for (const e of meleeBlows(modelsDir)) {
      if (!buffers.has(e.model)) buffers.set(e.model, viewModel(e.model, modelsDir));
      try {
        const m = measure(buffers.get(e.model), { bodypart: e.bodypart, submodel: e.submodel, seq: e.seq, delay: e.delay, range: e.range, fist: e.family === "martial arts", twoHanded: e.family === "2h swords" || e.family === "polearms" || /^v_2h/.test(e.model) ? true : undefined });
        results.push({ ...e, info: m.info, values: m.values, notes: m.notes });
      } catch (err) {
        skipped.push({ model: e.model, submodel: e.submodel, seq: e.seqName, why: err.message });
      }
    }
  } else {
    for (const b of gameBlows([game], { log: (x) => console.log(x) })) {
      try {
        const m = measure(b.buf, b.opts);
        results.push({ model: b.model, seq: b.seq, seqName: b.seq, family: b.family, strength: b.strength ?? null, loadout: b.loadout ?? null, weight: b.weight, delay: b.opts.delay ?? null, range: null, bodypart: 0, submodel: 0, items: b.info ? [b.info.unit] : [], info: m.info, values: m.values, notes: m.notes });
      } catch (err) {
        skipped.push({ model: b.model, submodel: 0, seq: b.seq, why: err.message });
      }
    }
  }
  // a sequence copied under another name (eattack2, 4 and 5; nh_attack4 and 5) is one blow: the copies share
  // one sequence's weight
  const copies = new Map();
  for (const r of results) {
    const sig = `${r.model}|${r.submodel}|${JSON.stringify(r.values)}`;
    copies.set(sig, [...(copies.get(sig) ?? []), r]);
  }
  for (const group of copies.values()) for (const r of group) r.weight /= group.length;
  const keys = Object.keys(MEASURES);
  // each band says how many distinct sequences it stands on: a family's is used only on five or more
  const bandsOf = (rows) =>
    Object.fromEntries(
      keys
        .map((k) => {
          const b = band(rows.map((r) => r.values[k] ?? null), rows.map((r) => r.weight));
          if (b) b.sequences = new Set(rows.filter((r) => r.values[k] !== null && r.values[k] !== undefined).map((r) => `${r.model}|${r.seq}`)).size;
          return [k, b];
        })
        .filter(([, b]) => b),
    );
  const overallBands = bandsOf(results);
  const families = Object.fromEntries(FAMILIES.map((f) => [f, bandsOf(results.filter((r) => r.family === f))]));
  // a game whose heavy blows are clips of their own (Vermintide 2's) keeps them apart from its light ones
  const kinds = [...new Set(results.map((r) => r.strength).filter(Boolean))];
  const strengths = kinds.length
    ? Object.fromEntries(
        kinds.map((k) => {
          const rows = results.filter((r) => r.strength === k);
          return [k, { count: rows.length, overall: bandsOf(rows), families: Object.fromEntries(FAMILIES.map((f) => [f, bandsOf(rows.filter((r) => r.family === f))])) }];
        }),
      )
    : undefined;
  // where each kind of blow goes (the tip from the eye in full reaches, a right hand's): the medians and quartiles
  // of the cocked, contact and through places, over the kind's blows and by strength, for swing.mjs's specs
  for (const r of results) Object.assign(r, blowKind(r.info.path, r.info.side, r.values["strike.turn"] ?? null, r.info.blades));
  const placesOf = (rows) => ({
    n: rows.length,
    ...Object.fromEntries(
      ["start", "cocked", "contact", "through", "hit", "end", "shoulder", "offStart", "offCocked", "offHit", "offThrough", "offEnd"].map((k) => {
        // the off hand's places from blows with one weapon in one hand only: a second weapon or a shield is held
        // elsewhere, and a two-handed weapon's off hand is on its handle
        const withIt = rows.filter((r) => r.path[k] && (!k.startsWith("off") || (r.loadout === "one" && !r.info.offGrip?.hit)));
        if (!withIt.length) return [k, null];
        const axes = [0, 1, 2].map((i) => band(withIt.map((r) => r.path[k][i]), withIt.map((r) => r.weight)));
        return [k, Object.fromEntries(["median", "q1", "q3"].map((q) => [q, axes.map((b) => b[q])]))];
      }),
    ),
    // the blade's direction at each, the median of each axis made a direction again
    blades: Object.fromEntries(
      ["start", "cocked", "contact", "through", "end"].map((k) => {
        const withBlade = rows.filter((r) => r.blades?.[k]);
        const m = [0, 1, 2].map((i) => band(withBlade.map((r) => r.blades[k][i]), withBlade.map((r) => r.weight))?.median ?? 0);
        const l = Math.hypot(...m) || 1;
        return [k, m.map((x) => Number((x / l).toFixed(4)))];
      }),
    ),
    // how many of its one-weapon blows take the handle in both hands at the hit (the off hand's places above are of
    // the rest: a free off hand)
    grip: ((one) => (one.length ? Number((one.filter((r) => r.info.offGrip?.hit).length / one.length).toFixed(3)) : null))(rows.filter((r) => r.loadout === "one" && r.info.offGrip)),
    // the forearm's roll from the cock through the follow-through, signed as a right arm's (judge's info.roll)
    roll: ((withRoll) => (withRoll.length ? band(withRoll.map((r) => r.info.roll * (r.info.side === "L" ? -1 : 1)), withRoll.map((r) => r.weight)) : null))(
      rows.filter((r) => typeof r.info.roll === "number"),
    ),
    // how far the striking hand squeezes the handle and lets go (its curl's most change: fingers.curlChange)
    squeeze: ((withIt) => (withIt.length ? band(withIt.map((r) => r.values["fingers.curlChange"]), withIt.map((r) => r.weight)) : null))(rows.filter((r) => typeof r.values["fingers.curlChange"] === "number")),
    // the striking thumb against the handle at the hit (fingers.thumbAlong: 0 along it, 90 wrapped across)
    thumb: ((withIt) => (withIt.length ? band(withIt.map((r) => r.values["fingers.thumbAlong"]), withIt.map((r) => r.weight)) : null))(rows.filter((r) => typeof r.values["fingers.thumbAlong"] === "number")),
    // and how far it rolls either way: a kind may roll both ways about as often (an overhead), each as far
    rollSize: ((withRoll) => (withRoll.length ? band(withRoll.map((r) => Math.abs(r.info.roll)), withRoll.map((r) => r.weight)) : null))(
      rows.filter((r) => typeof r.info.roll === "number"),
    ),
  });
  const places = {};
  // a cut's line apart too: level (its plane tilted under LEVEL degrees) or diagonal; the median of both is neither
  const LEVEL = 20;
  const lineOf = (r) => (r.kind === "slash" || r.kind === "backhand" ? (r.values["plane.tilt"] < LEVEL ? "level" : "diagonal") : null);
  const groups = [...new Set(results.flatMap((r) => [r.kind, lineOf(r) && `${r.kind}/${lineOf(r)}`]).filter(Boolean))].sort();
  for (const group of groups) {
    const rows = results.filter((r) => r.kind === group || `${r.kind}/${lineOf(r)}` === group);
    places[group] = { all: placesOf(rows) };
    for (const k of kinds) if (rows.some((r) => r.strength === k)) places[group][k] = placesOf(rows.filter((r) => r.strength === k));
  }
  // near-constant over the corpus: its 5-95% spread within twice its tolerance
  const constant = keys.filter((k) => overallBands[k] && overallBands[k].p95 - overallBands[k].p5 <= 2 * (MEASURES[k].tol ?? 0));
  const out = {
    reference: REFERENCES[game],
    game,
    made: new Date().toISOString().slice(0, 10),
    how:
      game === "msr"
        ? "anim/tools/judge.mjs survey --game msr: every melee item's blows, one per model + submodel + sequence, each model's sequence weighted 1 over its submodels; quantiles weighted"
        : `anim/tools/judge.mjs survey --game ${game}: every melee sweep that plays one clip, once per clip; lengths in forearms`,
    count: results.length,
    sequences: new Set(results.map((r) => `${r.model}|${r.seq}`)).size,
    perFamily: Object.fromEntries(FAMILIES.map((f) => [f, { rows: results.filter((r) => r.family === f).length, sequences: new Set(results.filter((r) => r.family === f).map((r) => `${r.model}|${r.seq}`)).size }])),
    constant,
    noise: NOISE,
    overall: overallBands,
    families,
    strengths,
    places,
    skipped,
    rows: results.map((r) => ({
      model: r.model,
      bodypart: r.bodypart,
      submodel: r.submodel,
      seq: r.seqName,
      family: r.family,
      strength: r.strength ?? undefined,
      kind: r.kind,
      delay: r.delay,
      range: r.range,
      weight: Number(r.weight.toFixed(4)),
      items: r.items,
      hitPhase: r.info.hitPhase,
      pivotJoint: r.info.pivotJoint,
      twoHanded: r.info.twoHanded,
      notes: r.notes,
      values: r.values,
    })),
  };
  writeFileSync(bandsPath(game), JSON.stringify(out, null, 1));
  console.log(`bands-${game}.json: ${results.length} blows (${out.sequences} model sequences), ${skipped.length} skipped`);
  for (const s of skipped) console.log(`  skipped ${s.model} ${s.submodel} ${s.seq}: ${s.why}`);
  console.log(`near-constant over the corpus: ${constant.join(", ") || "none"}`);
}

/**
 * Measures that do not tell a good blow from a bad one, so the overall verdict does not count them (they are
 * still shown): set from the survey against the bad and naive sets.
 */
const NOISE = ["phase.windupBack", "plane.tilt", "plane.residual", "strike.arc", "strike.turn", "smooth.ldlj", "speed.shoulder", "reach.hitOverRange", "flow.lockstep"];

// ── judge ──────────────────────────────────────────────────────────────────

const fmt = (x) => (x === null || x === undefined ? "-" : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));

function judgeOne(buf, seq, bands, family, file) {
  const parts = readMdl(buf).bodyparts;
  let bodypart = 0;
  let submodel = 0;
  for (const [g, i] of opts.submodel) {
    bodypart = /^\d+$/.test(g) ? Number(g) : parts.findIndex((p) => p.name.toLowerCase() === g.toLowerCase());
    if (bodypart < 0) throw new Error(`no bodypart ${g}: it has ${parts.map((p) => p.name).join(", ")}`);
    submodel = Number(i);
  }
  if (!opts.submodel.length) bodypart = parts.reduce((best, p, i) => (p.models.length > parts[best].models.length ? i : best), 0);
  const m = measure(buf, {
    bodypart,
    submodel,
    seq: /^\d+$/.test(seq) ? Number(seq) : seq,
    delay: opts.delay !== undefined ? Number(opts.delay) : null,
    range: opts.range !== undefined ? Number(opts.range) : null,
    fps: opts.fps !== undefined ? Number(opts.fps) : undefined,
    idle: opts.idle,
    // --arms "R:hand=Bone24,elbow=Bone23;L:hand=Bone02,elbow=Bone01" for a skeleton whose arms have no names
    arms: opts.arms ? Object.fromEntries(opts.arms.split(";").map((s) => s.split(":")).map(([side, roles]) => [side, Object.fromEntries(roles.split(",").map((r) => r.split("=")))])) : undefined,
    fist: opts.fist || family === "martial arts",
    // a two-handed family's off hand belongs on the handle: judged there even when it leaves it
    twoHanded: family === "2h swords" || family === "polearms" || /(^|[\/])v_2h/i.test(file) ? true : undefined,
  });
  const list = verdicts(m, bands, family, opts.strength ?? null);
  const verdict = overall(list, m.info, { timing: opts.timing ?? "msc", reference: bands.reference });
  const drawn = opts.draw ? drawOne(buf, m, list, verdict, file) : null;
  if (opts.json) return { file, seq: m.info.seq, family, info: m.info, values: m.values, verdicts: list, overall: verdict, ...(drawn ? { pictures: drawn } : {}) };
  const i = m.info;
  const lines = [
    `${basename(file)} ${i.seq}: ${i.frames} frames at ${i.fps} fps (${fmt(i.seconds)} s), idle ${i.idle}, ${i.fist ? "fist" : `${i.weapon.name} (${fmt(i.weapon.length)} long)`} in the ${i.side} hand${i.twoHanded === "held" ? ", held in both hands" : i.twoHanded ? ", the off hand on the handle" : ""}; family ${family ?? "all"}`,
    `phases (frames): wind-up ${i.phases.windup.join("-")}, strike ${i.phases.strike.join("-")}, follow-through ${i.phases.follow.join("-")}, recovery ${i.phases.recovery.join("-")}; peak speed at ${i.peakFrame}, deepest at ${i.deepestFrame}` +
      (i.hitFrame !== null ? `, hit at ${fmt(i.hitFrame)} (${i.hitPhase})` : ", no delay given: no hit frame"),
    `the blade turns about the ${i.pivotJoint} in the strike` + (i.jumpFrames.length ? `; jumps at frames ${i.jumpFrames.join(" ")}` : "") +
      (i.cutFrames.arms.length ? `; arm cut by the near plane at frames ${i.cutFrames.arms.join(" ")}` : ""),
    ...m.notes,
    "",
    `${"measure".padEnd(24)} ${"value".padStart(8)}   ${"band p5 [q1 med q3] p95".padEnd(36)} verdict`,
  ];
  for (const v of list) {
    const b = v.band;
    const span = b ? `${fmt(b.p5)} [${fmt(b.q1)} ${fmt(b.median)} ${fmt(b.q3)}] ${fmt(b.p95)}` + (v.from !== "all" ? "" : " (all)") : "-";
    const mark = { in: "  ", edge: " ~", low: " <", high: " >", fault: "!!", unbanded: "  " }[v.where];
    lines.push(`${mark} ${v.key.padEnd(21)} ${fmt(v.value).padStart(8)} ${MEASURES[v.key].unit.padEnd(8)} ${span.padEnd(36)} ${v.say}${v.noise ? " (not counted: does not separate)" : ""}`);
  }
  lines.push("", verdict.say);
  if (drawn) lines.push(`drew ${drawn.map((p) => basename(p)).join(", ")} into ${dirname(drawn[0])}`);
  return lines.join("\n");
}

/** The judge's pictures of one sequence written out: their paths. */
function drawOne(buf, m, list, verdict, file) {
  const model = basename(file).replace(/\.mdl$/i, "");
  const out =
    typeof opts.draw === "string" ? (opts.all ? join(opts.draw, m.info.seq) : opts.draw) : join(here, "..", "..", "build", "anim", "judged", model, m.info.seq);
  mkdirSync(out, { recursive: true });
  const { pictures } = judgedPictures(buf, m, list, verdict);
  return Object.entries(pictures).map(([name, img]) => {
    const path = join(out, name);
    writeFileSync(path, png(img.width, img.height, img.rgba));
    return path;
  });
}

function judge() {
  const [file, seq] = rest;
  if (!file || (!seq && !opts.all)) {
    console.error("node anim/tools/judge.mjs judge <mdl> <seq>|--all [--submodel g=i] [--delay s] [--range u] [--family f] [--fps n] [--idle seq] [--fist] [--reference vt2|msr] [--json] [--draw [dir]]");
    process.exit(1);
  }
  const bands = loadBands(opts.reference ?? REFERENCE);
  const buf = /[\\/]/.test(file) || file.endsWith(".mdl") ? readFileSync(file) : viewModel(file);
  const family = opts.family ?? familyOf(file);
  if (family && !FAMILIES.includes(family)) throw new Error(`--family: one of ${FAMILIES.join(", ")}`);
  const seqs = opts.all
    ? sequences(buf).map((s, i) => ({ s, i })).filter(({ s }) => !/idle|draw|lift|sheath|holster/i.test(s.name)).map(({ i }) => String(i))
    : [seq];
  const out = [];
  for (const s of seqs) {
    try {
      out.push(judgeOne(buf, s, bands, family, file));
    } catch (err) {
      out.push(opts.json ? { file, seq: s, error: err.message } : `${basename(file)} ${s}: ${err.message}`);
    }
  }
  console.log(opts.json ? JSON.stringify(out, null, 1) : out.join("\n\n" + "-".repeat(100) + "\n\n"));
}

if (mode === "survey") survey();
else if (mode === "judge") judge();
else {
  console.error("node anim/tools/judge.mjs survey [--game vt2|msr] | judge <mdl> <seq> [...]");
  process.exit(1);
}
