# Owner's verdicts

## F4 A1: the short sword's slash, backhand and thrust (swing, --fit, msc), in the local game, 2026-10-22

"De hecho se ve sorpresivamente bien": a little awkward, as expected, but much better than the blind animations made
with SMAK before, and it has MSC's feel of weapons that move somewhat slowly. What feels odd, hard to say: as if there
were a stop between the parts, as if the slash and the backhand first moved the hand and arm and only then swung.

Measured (tip and joint turn speeds per frame, deg/s), against MSR's attack1 and attack2:
- A dead stop at the cock: at frames 12-13 the tip (5-13 u/s) and every joint (shoulder, elbow, wrist under 20) are
  still at once. MSR never stops all of it: at its slowest some joint still turns at 48 (attack1) or 120 (attack2).
- The wind-up in lockstep: our shoulder, elbow and wrist rise and fall together on one bell (joint-space
  interpolation). In MSR they do not: the wrist is still through the whole wind-up (0 until frame 10 in attack1, 18
  in attack2) and snaps only in the strike; the shoulder keeps turning while the elbow stops.
- A second move after: our tip falls to 33 at frame 25 and rises again to 187 for a short recovery (12 frames); MSR's
  recovery is longer and slower (28 frames in attack1).
- MSR starts already moving (attack1's tip at 71 u/s at frame 0, attack2's 184); ours from 14.
So the owner's words are right: the arm is placed, stops, then swings.

### A1b (2026-10-22): the stop removed

The judge gained flow.stall (counted; MSR 1h swords p5 48) and flow.lockstep (noise across the corpus, but tells
the short sword apart). swing passes the cock moving, the shoulder leads, the wrist is held in the wind-up and snaps
in the strike. flow.stall slash 5.9 -> 95.8, backhand 2.5 -> 100.2, thrust 43.8 -> 81.1; all three PASS (msc, sync);
game test PASSED. Still there: the second move after the follow-through (return bell / peak: slash 0.55, backhand
0.30, against MSR's 0.35 and 0.27).

Owner, after playing A1b in the game (2026-10-22): "esta mucho mejor" (much better). The stop no longer stands out.
Left for later: the second move after the slash's follow-through (lengthen the slash or ease its return), the
overhead, a follow-through on cuts, other weapons.
