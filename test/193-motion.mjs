// Motion (check/motion.mjs): one animation measured bone by bone (motionOf), the summary the bands hold (motionSummary),
// the hard faults and the bands as facts (judgeMotion), check's grouped motion warnings, `smak motion` and its picture.
// The biped and its spoiled set are test/fixture-biped.mjs's; the broken cases (test/broken/motion.mjs) run each way in
// the slow suite, so only a few are tried here.
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test, sure, near, tmp, HERE } from "./helper.mjs";
import * as smak from "../src/index.mjs";
import { biped, spoiled, WALK } from "./fixture-biped.mjs";
import { viewArms, ARMS } from "./fixture-arms.mjs";

const clean = biped();
const judge = (mdl, seq, options) => smak.judgeMotion(smak.motionOf(mdl, { seq }), options);

test("motionOf: a walk measured bone by bone, its feet against its travel, its named joints, its loop's seam", () => {
  const m = smak.motionOf(clean.mdl, { seq: "walk" });
  sure(m.frames === WALK.frames && m.turns.length === WALK.frames && m.turns[0] === null, "a turn for every step, none into frame 0");
  sure(m.turns[1].length === m.bones.length && m.turns[1].every((t) => t.length === 4), "each turn is [degrees, axis]");
  sure(m.total.slice(1).every((t) => t > 0), "every step of a walk moves something");
  sure(m.slide.off === 0 && m.slide.steps === 16, `the feet go at the travel: ${JSON.stringify(m.slide)}`);
  near(m.slide.planted, WALK.speed, 0.5, "the planted feet's speed");
  sure(m.joints.named && m.joints.list.some((j) => j.name === "knee" && j.side === "L" && j.bone === "Bip01 L Calf"), "the left knee by its Biped name");
  const knee = m.joints.list.find((j) => j.name === "knee" && j.side === "L");
  sure(Math.min(...knee.flex) > -1 && Math.max(...knee.flex) > 20, `a walk's knee bends the right way only: ${Math.min(...knee.flex)} to ${Math.max(...knee.flex)}`);
  sure(m.seam.degrees < 1e-6 && m.seam.units < 1e-6, "the loop closes");
  sure(m.overlaps.pieces === 16 && m.overlaps.pairs.length === 0, `sixteen closed pieces, none through another: ${JSON.stringify(m.overlaps)}`);
  const swing = smak.motionOf(clean.mdl, { seq: "swing" });
  sure(swing.slide.why === "does not travel" && !swing.loops && swing.seam === null, "a swing has no travel and no seam");
});

test("judgeMotion: the clean biped has no fault; its bands are facts, placed against Half-Life's figures", () => {
  for (const seq of ["walk", "swing"]) {
    const j = judge(clean.mdl, seq, { kind: "figure" });
    sure(!j.faults.length, `${seq}: ${j.faults.join(" | ")}`);
    sure(j.rows.length === 6 && j.rows.every((r) => r.band && r.place), `${seq}: a row for each band measure`);
    sure(j.facts.some((f) => /the fastest bone turns \(degrees a second\) [\d.]+: (inside the middle half|in the (lowest|highest) quarter|under the 5th in 100|over the 95th in 100) of Half-Life's figures' 59 walks, runs and idles/.test(f)), `${seq}: the peak's band as a fact: ${j.facts.join(" | ")}`); // prettier-ignore
  }
  const walk = judge(clean.mdl, "walk", { kind: "figure" });
  sure(walk.summary.lockstep < 0.3 && walk.summary.moving > 0.5, `a walk's joints take turns: ${JSON.stringify(walk.summary)}`);
  sure(judge(clean.mdl, "walk", { kind: "melee" }).facts.some((f) => /no band for the kind melee/.test(f)), "an empty band says so");
  sure(!judge(clean.mdl, "walk").rows.length, "no kind, no rows");
});

test("judgeMotion: a pop, lockstep, foot slide and a tail still moving, each said with its frame, bone and remedy", () => {
  const said = (way) => ["walk", "swing"].flatMap((seq) => judge(spoiled(way).mdl, seq).faults);
  sure(said("pop").length === 1 && /frame 15, Bip01 Spine turns 30 degrees in one frame and back the next, 3\d times its run of 0\.8: a pop/.test(said("pop")[0]), said("pop").join(" | "));
  sure(said("lockstep").length === 1 && /lockstep r 0\.9\d/.test(said("lockstep")[0]), said("lockstep").join(" | "));
  sure(said("slide").length === 1 && /travel is 135: foot slide \(67% off\)/.test(said("slide")[0]), said("slide").join(" | "));
  sure(said("tail").length === 1 && /ends still moving \(frame 13/.test(said("tail")[0]), said("tail").join(" | "));
  const found = smak.judgeMotion(smak.motionOf(spoiled("pop").mdl, { seq: "swing" })).found;
  sure(found.length === 1 && found[0].key === "pop" && found[0].frame === 15 && found[0].bone === "Bip01 Spine", JSON.stringify(found));
});

test("motionSummary: lockstep is 1 for bones that move alike and low for bones that take turns; a spike is a step over its bone's run", () => {
  const steps = 12;
  const curve = (phase) => Array.from({ length: steps }, (_, f) => 5 + 4 * Math.sin((2 * Math.PI * f) / steps + phase));
  const measures = (curves) => ({
    frames: steps + 1,
    fps: 30,
    bones: curves.map((_, b) => `b${b}`),
    turns: [null, ...Array.from({ length: steps }, (_, f) => curves.map((c) => [c[f], 1, 0, 0]))],
    total: [0, ...Array.from({ length: steps }, (_, f) => curves.reduce((s, c) => s + c[f], 0))],
    still: Array.from({ length: steps + 1 }, () => false),
    median: curves.map((c) => [...c].sort((a, b) => a - b)[steps >> 1]),
    travelled: curves.map((c) => c.reduce((s, v) => s + v, 0)),
  });
  const alike = smak.motionSummary(measures([curve(0), curve(0), curve(0)]));
  near(alike.lockstep, 1, 1e-6, "three bones moving alike");
  const turns = smak.motionSummary(measures([curve(0), curve(Math.PI / 2), curve(Math.PI)]));
  sure(turns.lockstep < 0, `bones that take turns: ${turns.lockstep}`);
  const spiked = [curve(0), curve(0), curve(0)];
  spiked[1][6] = 80;
  const spike = smak.motionSummary(measures(spiked));
  sure(spike.spike > 10 && spike.spike < 20, `a step of 80 over a run of about 5: ${spike.spike}`);
  near(alike.peak, 9 * 30, 1, "the peak in degrees a second");
  sure(smak.motionKindOf("v_katana.mdl", clean.rig.names) === undefined && smak.motionKindOf("barney.mdl", clean.rig.names) === "figure" && smak.motionKindOf("crate.mdl", ["root"]) === undefined, "the kind by the feet and the name"); // prettier-ignore
});

test("check: a hard fault is a WARN: motion: line grouped by fault, never an error; --motion off leaves it out", () => {
  const stalled = spoiled("stall").mdl;
  const report = smak.check(stalled, "goldsrc", { kind: false });
  sure(!report.errors.length, report.errors.join(" | "));
  const motion = report.warnings.filter((w) => /^motion:/.test(w));
  sure(motion.length === 1 && /^motion: a stall \(frames of no motion between motion before and after\) in 1 animation \(swing frame 13\): let some joint keep turning through it, or take the held frames out; smak motion/.test(motion[0]), motion.join(" | ")); // prettier-ignore
  sure(!smak.check(stalled, "goldsrc", { kind: false, motion: false }).warnings.some((w) => /^motion:/.test(w)), "motion: false");
  sure(!smak.check(clean.mdl, "goldsrc", { kind: false }).warnings.some((w) => /^motion:/.test(w)), "the clean biped");
});

test("smak motion: PASS on the clean biped, FAIL with the fault on a spoiled one, --draw writes the picture", () => {
  const file = join(tmp, "biped.mdl");
  writeFileSync(file, clean.mdl);
  const bad = join(tmp, "biped-stall.mdl");
  writeFileSync(bad, spoiled("stall").mdl);
  const run = (...args) => spawnSync(process.execPath, [join(HERE, "../bin/smak.mjs"), "motion", ...args], { encoding: "utf8" });
  const ok = run(file);
  sure(ok.status === 0 && /^PASS: 2 animations measured, no hard fault \(bands: figure\)$/m.test(ok.stdout), `${ok.stdout}\n${ok.stderr}`);
  const fail = run(bad, "--kind", "none");
  sure(fail.status === 1 && /^FAIL: 1 hard fault in 1 of 2 animations measured$/m.test(fail.stdout) && /^FAULT motion: swing: nothing moves from frame 13/m.test(fail.stdout), `${fail.stdout}\n${fail.stderr}`); // prettier-ignore
  const png = join(tmp, "biped-stall-motion.png");
  const drawn = run(bad, "--seq", "swing", "--draw", png, "--verbose");
  sure(drawn.status === 1 && /^look at .*biped-stall-motion\.png: each bone's turn a frame/m.test(drawn.stdout), `${drawn.stdout}\n${drawn.stderr}`);
  const picture = smak.unpng(readFileSync(png));
  sure(picture.width >= 480 && picture.height > 300, `${picture.width}x${picture.height}`);
  const refused = run(file, "--draw", png);
  sure(refused.status === 1 && /--draw draws one animation: name it with --seq/.test(refused.stderr), refused.stderr);
  const kind = run(file, "--kind", "props");
  sure(kind.status === 1 && /--kind: figure, melee, firearm or none, not props/.test(kind.stderr), kind.stderr);
});

test("the body: solveArm puts the elbow an upper arm from the shoulder, placeForearm the hand on its target", () => {
  const shoulder = [-3.47, -6.72, -4.55];
  const hand = [12, -6, -9];
  const { elbow, reached } = smak.solveArm({ shoulder, upper: 11.37, fore: 11.37, hand, pole: [0, -0.5, -1] });
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  sure(reached && Math.abs(d(elbow, shoulder) - 11.37) < 1e-6 && Math.abs(d(elbow, hand) - 11.37) < 1e-6 && elbow[2] < shoulder[2], `the elbow ${elbow}`);
  const far = smak.solveArm({ shoulder, upper: 11.37, fore: 11.37, hand: [40, 0, 0] });
  sure(!far.reached && far.short > 18, `a hand out of reach: ${JSON.stringify(far)}`);
  const bones = [{ parent: -1 }, { parent: 0 }, { parent: 1 }];
  const values = [[1, 2, 3, 0.1, 0.2, 0.3], [5, 0, 0, 0.4, -0.2, 0.1], [11.37, 0, 0, 0, 0, 0]];
  const target = smak.poseOfValues([[0, 0, 0, 0, 0, 0], [...hand, 0.3, -0.5, 1.2]], [-1, 0])[1];
  const placed = smak.placeForearm(bones, values, { fore: 1, hand: 2, elbow, target });
  const world = smak.boneMatrices(bones, placed);
  sure(world[1].every((row, r) => Math.abs(row[3] - elbow[r]) < 1e-6), "the forearm's root at the elbow");
  sure(world[2].every((row, r) => row.every((v, c) => Math.abs(v - target[r][c]) < 1e-6)), `the hand's matrix the target: ${JSON.stringify(world[2])}`);
  const fit = smak.shoulderFor({ elbow, fore: 11.37, side: "R" });
  sure(fit.fitted && d(fit.shoulder, shoulder) < 1e-6, `the shoulder fitted back from the elbow: ${fit.shoulder}`);
});

test("the body in the judge: a view model's arms by --arms, judged where seen; the clean one passes, a pushed elbow fails", () => {
  const m = smak.motionOf(viewArms().mdl, { seq: "swing", arms: ARMS });
  sure(m.body.arms.length === 2 && m.body.arms[0].fitted && m.body.arms.every((a) => a.frames.every((f) => Math.abs(f.reach) < 1e-3)), "both forearms an upper arm from their shoulders");
  sure(m.body.principles.arc.straight < 1 && m.body.principles.lag.travel === 1, `the principles: ${JSON.stringify(m.body.principles)}`);
  const file = join(tmp, "v_arms.mdl");
  writeFileSync(file, viewArms("elbow").mdl);
  const run = spawnSync(process.execPath, [join(HERE, "../bin/smak.mjs"), "motion", file, "--seq", "swing", "--arms", ARMS.join(","), "--eye", "90:4/3", "--json"], { encoding: "utf8" });
  sure(run.status === 1 && /^FAULT motion: swing: frame 7, the right forearm \(Bone23\) starts 6 units farther/m.test(run.stdout), `${run.stdout}\n${run.stderr}`);
  const json = JSON.parse(run.stdout.slice(run.stdout.indexOf("["), run.stdout.lastIndexOf("]") + 1));
  sure(json[0].body.eye.aspect === 4 / 3 && json[0].faults[0].key === "elbow" && json[0].body.arms[0].frames[7].reach === 6, JSON.stringify(json[0].faults));
});
