// Animations spoiled in one way each (test/fixture-biped.mjs: a small biped with a walk and a swing, made from nothing),
// for the motion judge (check/motion.mjs, judgeMotion over motionOf): each must give the one sentence of its fault, and
// the clean biped must give none. `check` says the same grouped as a warning, `smak motion` as a FAIL. The arms of a
// view model (test/fixture-arms.mjs) are spoiled the same way, at the end.
import * as smak from "../../src/index.mjs";
import { biped, spoiled } from "../fixture-biped.mjs";
import { broken } from "./case.mjs";
import { viewArms, ARMS } from "../fixture-arms.mjs";

/** The judge's faults over both animations of a biped. */
const faultsOf = (mdl) => ["walk", "swing"].flatMap((seq) => smak.judgeMotion(smak.motionOf(mdl, { seq })).faults);
const clean = () => faultsOf(biped().mdl);

const CASES = [
  ["pop", "the spine turned 30 degrees for one frame and back", /^motion: swing: frame 15, Bip01 Spine turns 30 degrees in one frame and back the next, \d+ times its run of [\d.]+: a pop/],
  ["jitter", "the forearm turned 2.5 degrees one way and the other every frame", /^motion: swing: frame \d+, Bip01 R Forearm turns one way and back every frame for 7 steps: jitter/],
  ["flip", "the hand turned 170 degrees in one frame", /^motion: swing: frame 15, Bip01 R Hand turns 170 degrees in one frame: a flip/, true],
  ["hyper", "the elbow bent the wrong way, past straight", /^motion: swing: frame \d+, the right elbow \(Bip01 R Forearm\) bends \d+ degrees past straight, the wrong way: hyperextended/],
  ["stall", "four frames of the swing made copies of one", /^motion: swing: nothing moves from frame 13 for 3 frames or more, between motion before and after: a stall/],
  ["lockstep", "every bone keyed at the same frames with the same ease", /^motion: swing: the moving bones speed up and slow down together \(lockstep r 0\.9\d+, over 0\.9\)/],
  ["seam", "the walk's last frame no copy of its first", /^motion: walk: the loop does not close: in its last frame Bip01 L UpperArm is \d+ degrees and 0 units from where it is in the first/],
  ["slide", "the walk's travel three times the feet's speed", /^motion: walk: the planted feet go 45 units a second and the travel is 135: foot slide \(67% off\)/],
  ["tail", "the swing cut off as the arm is fastest", /^motion: swing: it ends still moving \(frame 13: the fastest bone turns [\d.]+ degrees, \d+ a second, of a peak of [\d.]+\): no held pose/],
  ["overlap", "the hanging hand turned into the thigh", /^motion: swing: frame \d+, Bip01 L Hand is [\d.]+ units inside Bip01 L Thigh: parts through each other/],
  ["wrist", "the hand turned 140 degrees from its rest", /^motion: swing: frame \d+, the right wrist \(Bip01 R Hand\) is turned 1[34]\d degrees from rest, past the 130 a wrist turns/],
  ["head", "the head turned 100 degrees about the upright", /^motion: swing: frame \d+, the head \(Bip01 Head\) is turned (9[1-9]|100) degrees from rest, past the 90 a head turns/],
];
for (const [way, defect, said, others = false] of CASES)
  broken("judgeMotion", defect, { said, others, broken: () => faultsOf(spoiled(way).mdl), whole: clean });

// check says the faults grouped, one warning a kind, and nothing of the clean biped (its boxes' form left out)
const warned = (mdl) => smak.check(mdl, "goldsrc", { kind: false }).warnings;
broken("check", "an animation that stalls: check warns of the motion, grouped", {
  said: /^motion: a stall \(frames of no motion between motion before and after\) in 1 animation \(swing frame 13\): let some joint keep turning through it/,
  broken: () => warned(spoiled("stall").mdl),
  whole: () => warned(biped().mdl),
});

// The body behind a view model's arms (test/fixture-arms.mjs: two forearms and hands with no upper arm, named as a rig
// whose names say nothing, judged with the arms given): each spoil must give its one sentence, the clean model none.
const armFaults = (mdl) => ["idle", "swing"].flatMap((seq) => smak.judgeMotion(smak.motionOf(mdl, { seq, arms: ARMS })).faults);
const ARM_CASES = [
  ["elbow", "the right forearm pushed out of its upper arm's reach", /^motion: swing: frame 7, the right forearm \(Bone23\) starts 6 units farther from its shoulder than the upper arm's 11\.37 \(in \d+ frames on the screen\): no shoulder holds it there/],
  ["aim", "the right forearm turned onto the eye's line", /^motion: swing: frame 7, the right forearm \(Bone23\) lies 0 degrees off the eye's line to its root, under 30 \(in \d+ frames\): seen end-on/],
  ["through", "the left hand driven into the right forearm (both hang from one root)", /^motion: swing: frame \d+, Bone02 is [\d.]+ units inside Bone23: parts through each other/],
];
for (const [way, defect, said] of ARM_CASES)
  broken("judgeMotion", defect, { said, broken: () => armFaults(viewArms(way).mdl), whole: () => armFaults(viewArms().mdl) });
