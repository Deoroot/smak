// Blows written from a spec (anims/lib/swing.mjs), put into a copy of the view model, and judged.
//
//   node anims/tools/swing.mjs <spec.json> [--src <mdl>] [--out <dir>] [--reference vt2|msr] [--fit [--iterations 6]]
//        [--timing msc|sync] [--own-places]
//        every blow of the spec solved and added to the model (as badset does) in <out>/<spec's name>.mdl, then
//        each judged (anims/lib/judge.mjs, the reference's bands for the family, msc timing and sync beside it).
//        The reference (Vermintide 2's unless told) also gives the joints' shares, the body's among them,
//        unless the spec says. --fit nudges each spec (shares, contact, phases, the peak's offset) until the judge
//        finds no counted measure outside the reference's 5-95%, a few rounds at most, and says what it changed;
//        the fitted specs are written beside it.
//        --timing makes every blow in that timing (named <blow>_<timing>, written to <name>_<timing>.mdl).
//   node anims/tools/swing.mjs reproduce <seq> [--src <mdl>] [--out <dir>]
//        one of the model's own blows described as a spec (swing.describe: its tip's path read by
//        corpus.weaponPath), made again, and set against the original: the tip's distance frame by frame and
//        the judge's values side by side.
//
// A blow whose strength is "heavy" is made as a charged attack plays it (anim/lib/charge.mjs), where the
// reference keeps a charge profile (anim/corpus/charge-<game>.json, Vermintide 2's): its frames and hitFrame are
// the release's (what plays when the button is let go: it starts cocked), a wind-up is put before it and split
// off as <blow>_charge, drawn back on the reference's timing and held, and the charge is measured against the
// profile. Every blow carries an event on its hit frame (number 100, options "hit"). <name>.play.json says how a game plays the clips: each heavy's charge, when a release becomes the
// heavy and when it fires by itself, the crossfades, each blow's hit after its clip starts.
//
// A spec file is one blow, a list of them, or { name, blows: [...] }; each blow as resolveSpec says. --src is the
// model to write into (the short sword's v_1hswords unless told), --out build/anims/swing.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { addSequence } from "../../src/mdl.mjs";
import { swing, describe, eyePlace, resolveSpec, armOf, charged, KINDS, JOINTS } from "../lib/swing.mjs";
import { weaponPath, armBones, weaponOf } from "../lib/corpus.mjs";
import { asModel } from "../lib/model.mjs";
import { measureCharge } from "../lib/charge.mjs";
import { measure, verdicts, overall, familyOf, MEASURES } from "../lib/judge.mjs";
import { loadBands, REFERENCE, REFERENCES, CORPUS } from "../lib/bands.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const loose = [];
const opts = {};
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith("--")) loose.push(args[i]);
  else if (args[i] === "--fit") opts.fit = true;
  else if (args[i] === "--own-places") opts["own-places"] = true;
  else opts[args[i].slice(2)] = args[++i];
}
const SRC = opts.src ?? "C:/Juegos/MSR/msr/models/viewmodels/v_1hswords.mdl";
const OUT = resolve(opts.out ?? join(ROOT, "build", "anim", "swing"));
const RANGE = 60;
// the event on a blow's hit frame: a game deals the blow there (s&box: a generic event, Int 100, StringData "hit")
const HIT_EVENT = 100;
const src = readFileSync(SRC);
// the profile the blows are made in and held to (--reference msr for MSR's): its family's joint shares are the
// blows' unless a spec says, and its bands judge them
const bands = loadBands(opts.reference ?? REFERENCE);
const family = opts.family ?? familyOf(SRC);
const medians = (b) => Object.fromEntries(JOINTS.map((k) => [k, b?.[`share.${k}`]?.median]).filter(([, v]) => typeof v === "number"));
const styleShares = medians(bands.families?.[family]);
// and its joints' ranges (the upper quartile) as the limits the arm may go to, where wider than the generator's
const fam = bands.families?.[family] ?? bands.overall;
const q3 = (k) => fam?.[k]?.q3;
const style = {
  shares: Object.keys(styleShares).length === JOINTS.length ? styleShares : medians(bands.overall),
  limits: { cone: q3("shoulder.cone"), wristBend: q3("wrist.bend"), roll: q3("wrist.twist") },
  // where its kinds of blow go, for a spec that does not say: the generator's own kinds are MSR's short sword's,
  // tuned on it, so MSR's style keeps them (--own-places keeps them for any)
  places: opts["own-places"] || bands.game === "msr" ? undefined : bands.places,
  // and how its hands hold (the squeeze, the thumb: each kind's places' hand measures), whatever the places
  hands: bands.places,
  // and the family's, for a kind with too few blows of its own to say
  hand: { thumbAlong: fam?.["fingers.thumbAlong"]?.median ?? null, squeeze: fam?.["fingers.curlChange"]?.median ?? 0 },
  // its strokes seen edge-on, a straight line across the screen, where most of its blows are (plane.eyeAngle)
  edgeOn: (bands.overall?.["plane.eyeAngle"]?.median ?? 90) < 12,
  // the trunk's share of the body's carrying (body.trunk), where the body carries enough to tell (body.share)
  trunk: (fam?.["body.share"]?.median ?? 0) >= 0.1 ? fam?.["body.trunk"]?.median : undefined,
};
const WHOSE = REFERENCES[bands.reference] ?? bands.reference;
// how the reference plays a charged attack, where it has one (anim/tools/charge.mjs)
const chargeFile = `${CORPUS}charge-${bands.game}.json`;
const chargeRef = existsSync(chargeFile) ? JSON.parse(readFileSync(chargeFile, "utf8")) : null;
const theirCharge = (k, d) => chargeRef?.overall?.[k]?.median ?? d;
// an engine that crossfades into a light: its clips start near the cock, not at the idle
style.crossfade = theirCharge("release.lightBlend", 0) > 0;
/** Seconds of wind-up put before a heavy's release, to be retimed as its charge. */
const WIND = 0.3;

const fmt = (x) => (x === null || x === undefined ? "-" : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));
const r2 = (v) => Number(v.toFixed(2));

/** A blow made and added to `buf`: { buf, made }. */
function addBlow(buf, spec) {
  if (spec.strength === "heavy" && chargeRef) {
    // the release's frames and hit as the spec says, a wind-up put before it to be split off as the charge
    const fps = resolveSpec(src, spec, armOf(src, { bodypart: spec.bodypart, submodel: spec.submodel, rest: spec.rest }), style).fps;
    const C = Math.round(WIND * fps);
    const hitFrame = spec.hitFrame ?? Math.round((spec.delay ?? 0.6) * fps);
    // the cock in the release where the spec's phases put it before contact (as resolveSpec does), so that a fit's
    // shorter or longer strike moves it
    const kind = KINDS[spec.kind ?? "slash"];
    const phases = { ...kind.phases, ...spec.phases };
    const contactAt = hitFrame + (spec.peakOffset ?? (spec.timing === "sync" ? kind.syncOffset ?? 0 : kind.mscOffset));
    const at = { ...spec.at, from: C + (spec.at?.from ?? Math.max(1, Math.min(contactAt - 3, Math.round((contactAt * phases.windup) / (phases.windup + phases.strike))))) };
    if (spec.at?.through !== undefined) at.through = C + spec.at.through;
    // a heavy's draw-back is its charge, from the idle
    // its recovery keys' frames are the release's, as its hit is
    const recovery = spec.recovery?.map((k) => ({ ...k, at: k.at + C }));
    const made = swing(src, { ...spec, start: "rest", frames: (spec.frames ?? 37) + C, hitFrame: hitFrame + C, delay: undefined, at, split: C, ...(recovery ? { recovery } : {}) }, { style });
    const auto = theirCharge("charge.autoAt", 0.7);
    const { charge, release } = charged(made, { at: C, reach: theirCharge("charge.reach", 0.47), full: Math.min(theirCharge("charge.deepAt", auto), auto), hold: auto + 0.3 });
    release.charge = charge;
    release.hitFrame = hitFrame;
    return { buf: addMade(buf, release), made: release };
  }
  const made = swing(src, spec, { style });
  return { buf: addMade(buf, made), made };
}

/** A made blow added to `buf`, its charge before it when it has one, and its hit as an event (HIT_EVENT). */
function addMade(buf, made) {
  if (made.charge) buf = addSequence(buf, { name: made.charge.name, fps: made.charge.fps, frames: made.charge.frames, like: made.like });
  const hit = made.hitFrame ?? made.plan?.hit;
  const events = Number.isFinite(hit) ? [{ frame: Math.round(hit), event: HIT_EVENT, options: "hit", type: 0 }] : [];
  return addSequence(buf, { name: made.name, fps: made.fps, frames: made.frames, like: made.like, events });
}

/** A heavy's charge measured in `buf` (anim/lib/charge.mjs) and set against the reference's: lines. */
function chargeLines(buf, made) {
  const spec = made.spec;
  const arms = armBones(src, { bodypart: spec.bodypart ?? 0, submodel: spec.submodel ?? 0 });
  const weapon = weaponOf(src, { bodypart: spec.bodypart ?? 0, submodel: spec.submodel ?? 0, arms });
  const c = measureCharge(asModel(buf), {
    charge: made.charge.name,
    heavy: made.name,
    idle: made.like,
    fps: made.fps,
    arms,
    attach: weapon.tip.bone,
    tip: weapon.tip.p,
    heavyAt: theirCharge("charge.heavyAt", 0.5),
    autoAt: theirCharge("charge.autoAt", 0.7),
  });
  const shown = ["charge.reach", "charge.travel", "charge.creep", "charge.deepGap"].map((k) => {
    const b = chargeRef.overall[k];
    const v = c.values[k];
    const where = v === null || !b ? "" : v < b.p5 ? " (low)" : v > b.p95 ? " (high)" : "";
    return `${k.split(".")[1]} ${fmt(v)} [${fmt(b?.p5)} .. ${fmt(b?.p95)}]${where}`;
  });
  return [`  charge ${made.charge.name}: ${made.charge.frames.length} frames; against ${WHOSE}'s: ${shown.join(", ")}`];
}

/** Seconds from a blow's damage to its chain point (when the next attack may start), as the reference's, or null. */
const chainAfter = (strength) => (chargeRef ? theirCharge(strength === "heavy" ? "release.heavyChain" : "release.lightChain", null) : null);

/** The judge's word on one sequence of a file, in both timings: { m, list, msc, sync }. */
function judged(buf, made) {
  const after = chainAfter(made.spec.strength);
  // the recovery as played: up to the chain point, where the reference gives one
  const cut = after === null ? null : made.spec.hit / made.fps + after;
  const m = measure(buf, { seq: made.name, delay: made.spec.hit / made.fps, range: RANGE, cut });
  const list = verdicts(m, bands, family, made.spec.strength ?? opts.strength ?? null);
  return { m, list, msc: overall(list, m.info, { timing: "msc", reference: bands.reference }), sync: overall(list, m.info, { timing: "sync", reference: bands.reference }) };
}

/** A judged sequence as lines: the overall words and every counted measure outside the reference's middle half. */
function verdictLines(j) {
  const i = j.m.info;
  const lines = [
    `  phases (frames): wind-up 0-${i.phases.windup[1]}, strike ${i.phases.strike.join("-")}, follow-through ${i.phases.follow.join("-")}, recovery ${i.phases.recovery.join("-")}; peak at ${i.peakFrame}, deepest at ${i.deepestFrame}, hit at ${fmt(i.hitFrame)} (${i.hitPhase}); turns about the ${i.pivotJoint}`,
  ];
  for (const v of j.list) {
    if (v.where === "in" || v.where === "unbanded") continue;
    const b = v.band;
    const mark = { edge: " ~", low: " <", high: " >", fault: "!!" }[v.where];
    lines.push(`  ${mark} ${v.key.padEnd(21)} ${fmt(v.value).padStart(7)} ${MEASURES[v.key].unit.padEnd(8)} [${fmt(b?.p5)} .. ${fmt(b?.p95)}] ${v.say}${v.noise ? " (not counted)" : ""}`);
  }
  lines.push(`  msc:  ${j.msc.say}`, `  sync: ${j.sync.say}`);
  return lines;
}

// ── the judge in the loop ──────────────────────────────────────────────────

/** A spec with its places (as the style or the kind gives them) and phases written out, so that they can be nudged. */
function explicit(spec) {
  const kind = KINDS[spec.kind ?? "slash"];
  const s = resolveSpec(src, spec, armOf(src, { bodypart: spec.bodypart, submodel: spec.submodel, rest: spec.rest }), style);
  const shares = spec.shares ? { ...spec.shares } : null;
  return {
    ...spec,
    // the clip's start as the style gave it, kept with the cock it leads to
    ...(s.start && !spec.start ? { start: eyePlace(s.start) } : {}),
    from: eyePlace(s.from),
    contact: eyePlace(s.contact),
    through: eyePlace(s.through),
    // places that came from the style stay edge-on as the fit moves them
    ...(style.edgeOn && spec.edgeOn === undefined && !spec.from && !spec.through && (spec.peakAt ?? kind.peakAt ?? "contact") === "contact" ? { edgeOn: true } : {}),
    phases: { ...kind.phases, ...spec.phases },
    peakOffset: spec.peakOffset ?? (spec.timing === "sync" ? kind.syncOffset ?? 0 : kind.mscOffset),
    shares,
  };
}

/**
 * What to change for a measure outside the reference's 5-95%: [what is said, (spec, made) => void]. Each changes one thing
 * a little in the direction that should bring the measure back (the meanings in judge.mjs's MEASURES).
 */
const share = (joint, by) => (s, made) => {
  s.shares ??= { ...made.shares.wanted };
  // a joint held still (the body in MSR's manner) is let move a little, or kept still
  s.shares[joint] = s.shares[joint] > 0 ? s.shares[joint] * by : by > 1 ? 0.05 : 0;
  for (const k of Object.keys(s.shares)) s.shares[k] = r2(s.shares[k]);
};
const phase = (name, by) => (s) => (s.phases[name] = r2(s.phases[name] * by));
const depth = (by) => (s) => (s.contact[0] = r2(s.contact[0] + by));
const offset = (by) => (s) => (s.peakOffset += by);
const toSight = (s) => {
  s.contact[1] = r2(s.contact[1] * 0.6);
  s.contact[2] = r2(s.contact[2] * 0.6);
};
/** The off arm's swing with the blow changed by `d` (swing.mjs's offArm), kept 0 to 2. */
const offArm = (d) => (s) => (s.offArm = Math.max(0, Math.min(2, (s.offArm ?? 0) + d)));
const RULES = {
  "reach.hitDistance": { low: ["peak nearer the hit", offset(-1)], high: ["contact nearer", depth(-3)] },
  "reach.hitDepth": { low: ["peak nearer the hit", offset(-1)], high: ["contact nearer", depth(-3)] },
  "reach.hitAngle": { high: ["peak nearer the hit", (s) => (s.peakOffset -= Math.sign(s.peakOffset))] },
  "reach.maxDepth": { low: ["contact deeper", depth(3)], high: ["contact nearer", depth(-3)] },
  "reach.deepDistance": { low: ["contact deeper", depth(3)], high: ["contact nearer", depth(-3)] },
  "reach.deepAngle": { high: ["contact towards the crosshair", toSight] },
  "phase.windup": { low: ["longer wind-up", phase("windup", 1.25)], high: ["shorter wind-up", phase("windup", 0.8)] },
  "phase.strike": { low: ["longer strike", phase("strike", 1.25)], high: ["shorter strike", phase("strike", 0.8)] },
  "phase.follow": { low: ["longer follow-through", phase("follow", 1.3)], high: ["shorter follow-through", phase("follow", 0.75)] },
  "phase.recovery": { low: ["longer recovery", phase("recovery", 1.25)], high: ["shorter recovery", phase("recovery", 0.8)] },
  "phase.strikeShare": { low: ["longer strike", phase("strike", 1.2)], high: ["shorter strike", phase("strike", 0.85)] },
  "phase.peakSpeed": { low: ["shorter strike (faster)", phase("strike", 0.85)], high: ["longer strike (slower)", phase("strike", 1.2)] },
  "fan.travelRatio": { low: ["more wrist", share("wrist", 1.3)], high: ["less wrist", share("wrist", 0.7)] },
  "fan.pivot": { low: ["less wrist", share("wrist", 0.7)], high: ["more elbow", share("elbow", 1.25)] },
  "elbow.min": { high: ["contact deeper (the arm straightens)", depth(2)] },
  "elbow.max": { low: ["drawn farther back", (s) => (s.from[0] = r2(s.from[0] - 3))], high: ["less elbow", share("elbow", 0.8)] },
  "elbow.range": { low: ["more elbow", share("elbow", 1.3)], high: ["less elbow", share("elbow", 0.8)] },
  "shoulder.cone": { low: ["more shoulder", share("shoulder", 1.15)], high: ["less shoulder", share("shoulder", 0.85)] },
  "wrist.bend": { low: ["more wrist", share("wrist", 1.25)], high: ["less wrist", share("wrist", 0.75)] },
  "wrist.angle": { high: ["less wrist", share("wrist", 0.75)] },
  "wrist.twist": { high: ["less wrist", share("wrist", 0.8)] },
  "speed.elbow": { low: ["more elbow", share("elbow", 1.2)], high: ["less elbow", share("elbow", 0.85)] },
  "speed.wrist": { low: ["more wrist", share("wrist", 1.2)], high: ["less wrist", share("wrist", 0.8)] },
  "timing.hitMinusPeak": { low: ["peak earlier", offset(-1)], high: ["peak later", offset(1)] },
  "timing.hitMinusDeep": { low: ["peak earlier", offset(-1)], high: ["peak later", offset(1)] },
  "timing.hitSpeedShare": { low: ["peak nearer the hit", (s) => (s.peakOffset -= Math.sign(s.peakOffset))] },
  "smooth.jumpRatio": { high: ["longer strike", phase("strike", 1.2)] },
  "frame.tipOnScreen": { low: ["contact towards the crosshair", toSight] },
  "body.share": { low: ["more body", share("body", 1.3)], high: ["less body", share("body", 0.75)] },
  "other.travel": { low: ["the off arm swung more", offArm(0.25)], high: ["the off arm swung less", offArm(-0.25)] },
  "other.speed": { low: ["the off arm swung more", offArm(0.25)], high: ["the off arm swung less", offArm(-0.25)] },
  "other.elbowMin": { high: ["the off arm swung more", offArm(0.25)] },
  "body.shoulderTravel": { low: ["more body", share("body", 1.3)], high: ["less body", share("body", 0.75)] },
  "share.body": { low: ["more body", share("body", 1.3)], high: ["less body", share("body", 0.75)] },
  "share.shoulder": { low: ["more shoulder", share("shoulder", 1.15)], high: ["less shoulder", share("shoulder", 0.85)] },
  "share.elbow": { low: ["more elbow", share("elbow", 1.2)], high: ["less elbow", share("elbow", 0.85)] },
  "share.wrist": { low: ["more wrist", share("wrist", 1.2)], high: ["less wrist", share("wrist", 0.8)] },
  "frame.nearArms": { high: ["cocked farther from the eye", (s) => (s.from[0] = r2(s.from[0] + 3))] },
};

/** How bad a judged blow is: its outside measures, the far ones counting more. */
const badness = (j) => j.list.filter((v) => (v.where === "low" || v.where === "high") && !v.noise).reduce((s, v) => s + 1 + v.far, 0) + 10 * j.list.filter((v) => v.where === "fault").length;

/**
 * A spec nudged by the judge: { spec (the best), made, j, score, changes: [what each round did] }. Each round
 * tries, one at a time, the change each counted measure outside the reference's 5-95% asks for (RULES), and keeps the one
 * that leaves the judge least unhappy (badness); it stops when nothing is outside or no change helps. One change
 * a round, because two at once can undo each other (a thrust drawn back and shortened at once turns about
 * nothing: fan.pivot out of band, though either alone is fine).
 */
function fit(spec, iterations) {
  const tryOut = (s) => {
    const { buf, made } = addBlow(src, s);
    const j = judged(buf, made);
    return { spec: s, made, j, score: badness(j) };
  };
  let best = tryOut(explicit(spec));
  let now = best;
  const changes = [];
  let stuck = 0;
  for (let round = 1; round <= iterations; round++) {
    const outside = now.j.list.filter((v) => (v.where === "low" || v.where === "high") && !v.noise && RULES[v.key]?.[v.where]);
    if (!outside.length) break;
    const tried = new Map();
    for (const v of outside) {
      const [what, change] = RULES[v.key][v.where];
      if (tried.has(what)) continue;
      const next = JSON.parse(JSON.stringify(now.spec));
      change(next, now.made);
      tried.set(what, { ...tryOut(next), why: `${v.key} ${v.where} (${fmt(v.value)})`, what, change });
    }
    if (tried.size > 1) {
      const next = JSON.parse(JSON.stringify(now.spec));
      for (const t of tried.values()) t.change(next, now.made);
      const all = [...tried.values()];
      tried.set("all", { ...tryOut(next), why: all.map((t) => t.why).join(", "), what: `all of ${all.map((t) => t.what).join(" + ")}` });
    }
    // the best change is taken even when it does not help, once: a share may have to pass a hump (the wrist
    // bending past MSR's before the elbow takes its part); the best spec seen is what is kept
    const pick = [...tried.values()].sort((x, y) => x.score - y.score)[0];
    const others = [...tried.values()].filter((t) => t !== pick).map((t) => `${t.what} ${fmt(t.score)}`);
    changes.push(`round ${round}: ${pick.why}: ${pick.what}, score ${fmt(now.score)} -> ${fmt(pick.score)}${others.length ? ` (also tried ${others.join(", ")})` : ""}`);
    stuck = pick.score < best.score ? 0 : stuck + 1;
    now = pick;
    if (now.score < best.score) best = now;
    if (stuck >= 2) break;
  }
  changes.push(best === now ? `kept the last (score ${fmt(best.score)})` : `kept the best seen (score ${fmt(best.score)})`);
  return { ...best, changes };
}

// ── what the spec changed into, said plainly ───────────────────────────────

function diffSpec(a, b) {
  const out = [];
  const walk = (x, y, path) => {
    if (typeof x === "object" && x && typeof y === "object" && y) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], path ? `${path}.${k}` : k);
    } else if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`${path} ${JSON.stringify(x)} -> ${JSON.stringify(y)}`);
  };
  walk(a, b, "");
  return out;
}

// ── modes ──────────────────────────────────────────────────────────────────

/** A spec file's blows; with --timing, each made in that timing and named for it. */
function fromFile(file) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  let blows = Array.isArray(raw) ? raw : raw.blows ?? [raw];
  let name = raw.name ?? basename(file, ".json");
  if (opts.timing) {
    blows = blows.map((b) => ({ ...b, timing: opts.timing, name: `${b.name ?? `swing_${b.kind ?? "slash"}`}_${opts.timing}` }));
    name = `${name}_${opts.timing}`;
  }
  return { name, blows };
}

function makeAll() {
  const { name, blows } = fromFile(loose[0]);
  mkdirSync(OUT, { recursive: true });
  let buf = src;
  const report = [];
  const fitted = [];
  const plays = [];
  for (const spec of blows) {
    let made;
    let j;
    let lines = [];
    if (opts.fit) {
      const got = fit(spec, Number(opts.iterations ?? 6));
      made = got.made;
      fitted.push(got.spec);
      lines = ["  fit:", ...got.changes.map((c) => `    ${c}`), "  spec changed:", ...diffSpec(explicit(spec), got.spec).map((d) => `    ${d}`)];
      buf = addMade(buf, made);
    } else {
      ({ buf, made } = addBlow(buf, spec));
    }
    j = judged(buf, made);
    const p = made.plan;
    report.push(
      [
        `${made.name} (${made.spec.kind}): ${p.frames} frames at ${made.fps} fps; cocked at ${p.from}, contact (fastest) at ${p.contact}, through at ${p.through}, hit at ${p.hit} (${p.timing}, peak ${p.peakOffset >= 0 ? "+" : ""}${p.peakOffset})`,
        `  shares ${JOINTS.join("/")}: made ${JOINTS.map((k) => r2(made.shares.made[k])).join("/")}, asked ${JOINTS.map((k) => r2(made.shares.wanted[k])).join("/")} (${WHOSE}'s); keys' misses ${Object.entries(made.misses).map(([k, v]) => `${k} ${v.miss}${v.bladeOff !== null ? ` (blade ${v.bladeOff} deg)` : ""}`).join(", ")}`,
        ...made.notes.map((n) => `  note: ${n}`),
        ...lines,
        ...(made.charge ? chargeLines(buf, made) : []),
        ...verdictLines(j),
      ].join("\n"),
    );
    const hit = Number((made.spec.hit / made.fps).toFixed(3));
    plays.push(
      made.charge
        ? { heavy: made.name, charge: made.charge.name, hit, chain: chainAfter("heavy") === null ? undefined : Number((hit + chainAfter("heavy")).toFixed(3)), heavyAt: theirCharge("charge.heavyAt", 0.5), autoAt: theirCharge("charge.autoAt", 0.7), blend: theirCharge("release.heavyBlend", 0.1) }
        : { [made.spec.strength ?? "blow"]: made.name, hit, ...(made.spec.strength === "light" && chargeRef ? { chain: Number((hit + chainAfter("light")).toFixed(3)), blend: theirCharge("release.lightBlend", 0.15) } : {}) },
    );
  }
  const file = join(OUT, `${name}.mdl`);
  writeFileSync(file, buf);
  if (opts.fit) writeFileSync(join(OUT, `${name}.fitted.json`), JSON.stringify({ name, blows: fitted }, null, 1));
  writeFileSync(
    join(OUT, `${name}.play.json`),
    JSON.stringify(
      {
        name,
        how: chargeRef
          ? `as ${WHOSE}'s charged attacks: a press plays a heavy's charge; let go before heavyAt seconds and a light plays, after it the heavy, and held to autoAt the heavy fires by itself; each crossfaded in over blend seconds; hit is seconds from its clip's start, chain when the next press may start the next charge`
          : "each blow's hit, seconds from its clip's start",
        plays,
      },
      null,
      1,
    ),
  );
  console.log(report.join("\n\n"));
  console.log(`\nwrote ${file}${opts.fit ? ` and ${name}.fitted.json` : ""}`);
}

function reproduce() {
  const seq = loose[1];
  const spec = describe(src, seq, { delay: Number(opts.delay ?? 0.6) });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `re_${seq}.json`), JSON.stringify(spec, null, 1));
  const { buf, made } = addBlow(src, spec);
  const file = join(OUT, `re_${seq}.mdl`);
  writeFileSync(file, buf);
  const a = weaponPath(src, { seq });
  const b = weaponPath(buf, { seq: made.name });
  const d = a.frames.map((f, i) => Math.hypot(...f.tip.map((v, k) => v - b.frames[i].tip[k])));
  const g = a.frames.map((f, i) => Math.hypot(...f.grip.map((v, k) => v - b.frames[i].grip[k])));
  const rms = (xs) => Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length);
  const strike = d.slice(made.plan.from, made.plan.through + 1);
  const ja = (() => {
    const m = measure(src, { seq, delay: spec.hitFrame / spec.fps, range: RANGE });
    const list = verdicts(m, bands, family);
    return { m, list, msc: overall(list, m.info, { reference: bands.reference }), sync: overall(list, m.info, { timing: "sync", reference: bands.reference }) };
  })();
  const jb = judged(buf, made);
  const lines = [
    `${seq} described (${spec.windup.length} wind-up keys, ${spec.via.length + spec.after.length} strike points, ${spec.recovery.length} recovery keys; shares ${spec.shares.shoulder}/${spec.shares.elbow}/${spec.shares.wrist}) and made again as ${made.name}`,
    `  shares made ${["shoulder", "elbow", "wrist"].map((k) => r2(made.shares.made[k])).join("/")}; keys' misses ${Object.entries(made.misses).map(([k, v]) => `${k} ${v.miss}`).join(", ")}`,
    ...made.notes.map((n) => `  note: ${n}`),
    `  tip distance from the original: RMS ${fmt(rms(d))} u a frame, max ${fmt(Math.max(...d))} (frame ${d.indexOf(Math.max(...d))}); over the strike (${made.plan.from}-${made.plan.through}) RMS ${fmt(rms(strike))}, max ${fmt(Math.max(...strike))}`,
    `  grip distance: RMS ${fmt(rms(g))}, max ${fmt(Math.max(...g))}`,
    `  per frame: ${d.map((x) => x.toFixed(1)).join(" ")}`,
    "",
    `  ${"measure".padEnd(22)} ${"original".padStart(9)} ${"made".padStart(9)}  where (original / made)`,
  ];
  for (const v of ja.list) {
    const w = jb.list.find((x) => x.key === v.key);
    if (!w) continue;
    lines.push(`  ${v.key.padEnd(22)} ${fmt(v.value).padStart(9)} ${fmt(w.value).padStart(9)}  ${v.where} / ${w.where}`);
  }
  lines.push("", `  original msc: ${ja.msc.say}`, `  original sync: ${ja.sync.say}`, `  made msc: ${jb.msc.say}`, `  made sync: ${jb.sync.say}`);
  console.log(lines.join("\n"));
  console.log(`\nwrote ${file} and re_${seq}.json`);
}

if (loose[0] === "reproduce" && loose[1]) reproduce();
else if (loose[0]) makeAll();
else {
  console.error("node anims/tools/swing.mjs <spec.json> [--src mdl] [--out dir] [--fit] | reproduce <seq>");
  process.exit(1);
}
