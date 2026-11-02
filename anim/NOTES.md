# Anims: first-person melee that makes physical sense

Begun 2026-10-21. The aim: first-person melee animations (swords, spears, axes...) made with SMAK by an AI
that are faithful: the blade reaches what it hits, the arms move as arms do, the blow has a wind-up, a strike
and a follow-through. And a judge that says, sequence by sequence, whether one makes physical sense and what is
wrong with it, not only whether it shares the game's style. Made the way `figures/` was: the game's own
animations are the measure.

## Why AI-made melee fails

A model writing an animation gives joint angles blind. It never sees where the weapon's tip is from the eye,
nor how far the thing it is to hit stands. So it misjudges distance (no point of contact to reach) and fans
(the wrist turns, the hand hardly moves, the tip sweeps an arc about the wrist). Firearms are easier: the
gun stays roughly in one place and kicks.

The answer: say a blow by the weapon's PATH in the camera's space (grip, tip, point of contact at the
weapon's range, phases and their timing), let IK move the arms, and MEASURE what was made.

## The corpus

MSR's 19 view models in `models/viewmodels/` (v_1hswords, v_2hswords, v_polearms, v_1haxes, v_martialarts...),
all on Biped skeletons (46-50 bones), more than 100 attack, block, thrust and spin sequences. Many weapons share
one view model (the item script's `MODEL_VIEW`, `ANIM_PREFIX`, `MODEL_VIEW_IDX`). The item scripts give each
blow's range and timing: `MELEE_RANGE` (e.g. 60), `MELEE_DMG_DELAY` (e.g. 0.6 s, the moment of the hit),
`MELEE_ATK_DURATION` (e.g. 1.2 s).

First weapon: the one-handed swords, the short sword first. First person only; the third-person player
animation comes later.

## Phases

| Phase | What | Out |
| --- | --- | --- |
| F0 | Corpus and conventions: every view model's sequences, fps, events; each melee item's range and delays and which sequences it plays; the camera (view model origin = eye, axes, FOV); the weapon's tip and grip in every frame | `anims/corpus/`, `anims/lib/corpus.mjs` |
| F0 | Viewer: strips from the player's eye with the tip's trail drawn, plus a side and a top view with the target at range | `anims/lib/view.mjs`, `anims/tools/strip.mjs` |
| F1 | Physical judge v0, every measure banded on the corpus, validated against a deliberately bad set (fans, short reach, broken elbows) and naive AI attempts | `anims/lib/judge.mjs`, `anims/tools/judge.mjs` |
| F2 | The viewer used by the judge: each fault drawn where it happens | |
| F3 | Authoring: a `swing` spec (weapon, grip, kind of blow, point of contact, phases, torso and clavicle share) solved by IK; and adapting an MSR attack to a new weapon keeping the tip's path. Reproduction test: describe v_1hswords attack1, measure the distance from the original | `anims/lib/swing.mjs` |
| F4 | Experiments with the owner's verdicts: A1 one-handed slash (short sword), A2 spear thrust, A3 two-handed overhead; each tried in the game with `tools/playtest.mjs` | `anims/verdicts.md` |
| F5 | Into SMAK: profile msc `viewmodel` block (FOV, ranges, bands), `smak anim-judge`, `smak swing`, docs | |

## The judge's measures (F1)

- Reach: the tip's depth at the hit frame against the item's `MELEE_RANGE` (as the corpus relates them).
- Strike plane: how far the tip's path strays from one plane during the strike.
- Fan: the tip's travel against the hand's, and where the pivot is (shoulder or torso, not the wrist alone).
- Joint limits: elbow on one axis without hyperextension, shoulder cone, wrist, forearm twist.
- Grip: the hand stays on the handle (both hands on two-handed weapons).
- Timing: wind-up, strike, follow-through, recovery; the speed peak at `MELEE_DMG_DELAY`; little jerk, no jumps.
- Framing: the tip on screen when it should be, the arms not through the near plane, idle -> attack -> idle without a jump.

Every band comes from MSR's own sequences; a measure that does not separate the corpus from the bad set is dropped.

## F0 findings (2026-10-21)

Tools: `anims/lib/corpus.mjs` (viewModel, sequenceList, armBones, weaponOf, weaponPath, blowOf),
`anims/tools/corpus.mjs` (writes `anims/corpus/viewmodels.json`, `melee-items.json`: 150 melee items, read as
the game's loader reads scripts), `anims/lib/view.mjs` (camera, track, reachOf, eyeStrip, plans),
`anims/tools/strip.mjs` (PNG strips into `build/anims/<model>/<seq>/`).

Camera: view model origin = the eye (then 1 unit lower, view.cpp:705); +x forward, +y LEFT, +z up; FOV 90
horizontal at 4:3 (73.74 vertical, Hor+ on wide screens), no separate view model FOV; near 4. Eye 28 above the
player's origin. Hit time = attack start + MELEE_DMG_DELAY (giattack.cpp:446), so the hit frame is DMG_DELAY x fps
(framerate 1 unless `setviewmodelprop animspeed`). The corpus is MSR's 19 view models; Classic's 13 in
run-msc differ (other sha1s). v_martialarts_claws has no recognisable arm bones.

Short sword (swords_shortsword.script; v_1hswords bodypart 0 submodel 0 `new_shortsword`; RANGE 60, DMG_DELAY
0.6 -> frame 18, ATK_DURATION 1.1; plays attack1-3 at random). Blade 31 long, grip 4.8 from the butt.

| seq | tip depth at frame 18 | max depth (frame) | max distance from eye (frame) | speed peak frame |
| --- | --- | --- | --- | --- |
| attack1 (overhead diagonal, 56 f) | 0.7 (still cocked above the eye) | 39.1 (24) | 46.4 (27) | 22 |
| attack2 (backhand, 37 f) | 7.5 | 36.8 (22) | 42.2 (25) | 22 |
| attack3 (upward/thrust, 28 f) | 32.1 | 46.1 (15) | 46.5 (14) | 14 |

- The tip never goes past ~46 from the eye against RANGE 60: the range is a trace from the eye, not the blade.
  Reach must be banded on the corpus (contact ~35-50 ahead, near the line of sight), not taken from RANGE.
- MSR's own timing is loose: the damage moment is 4 frames before (attack1, 2) or after (attack3) the speed peak,
  and attack1 lasts 1.83 s against ATK_DURATION 1.1.
- The shoulders and the left hand never move in the short sword's swings: all elbow, wrist and blade.
- v_2hswords parents the left hand to the sword's bone (second hand on the handle by construction).

## F1 findings (2026-10-21)

Tools: `anims/lib/judge.mjs` (measure, verdicts, overall, MEASURES), `anims/tools/judge.mjs` (`survey` ->
`anims/corpus/bands.json`, 50 distinct MSR sequences; `judge <mdl> <seq>|--all`), `anims/tools/badset.mjs`
(`build/anims/bad/v_1hswords_bad.mdl`, 13 faults x attack1-3, manifest.json). Naive attempts (an agent with SMAK's
IK but without plan, viewer or judge): `build/anims/naive/` (make.mjs, v_1hswords_naive.mdl).

- Bad set: 30 FAIL, 7 DOUBTFUL, 2 PASS (late_attack1/3: a 10-frame late peak sits inside MSR's own looseness).
- Naive: all 3 FAIL, reach in band in all three. The fault is the wrist doing the shoulder's and elbow's work:
  hand folded back (wrist angle 142), shoulder cone 37 against MSR's 59-105, elbow range low, forearm off its hinge.
- Measures that separate: reach.maxDepth (24/45/68), fan.travelRatio, fan.pivot (MSR pivots at elbow 21, shoulder
  19, wrist 9 of 50), elbow.min (hyper), shoulder.cone, wrist.twist, wrist.angle, smooth.jumpRatio, phase.peakSpeed;
  tolerance checks (stretch, grip.drift, seams, jumps) catch offgrip/teleport/seam/jitter. Noise: plane.residual,
  plane.tilt, strike.arc, smooth.ldlj and others; timing separates only weakly.
- MSR's own hit lands outside the strike in 24 of 50 sequences (blunts ~0.3 s after the peak, short sword attack1
  in the wind-up). Polearms and 2h swords break wrist limits (up to 130), near-plane cuts in polearms attack3/5.
- The overall word is too strict leave-one-out (MSR 16 PASS / 18 DOUBTFUL / 16 FAIL): families are small. Trust the
  per-measure lines and the faults.

## Timing, the owner's choice (2026-10-22)

Both, with MSC's looseness preferred: `overall(list, info, { timing })`, `judge ... --timing msc|sync`. "msc" (the
default) holds the hit only to MSR's own bands and only notes a hit outside the strike; "sync" also wants the hit
within 3 frames of the tip's fastest and in the strike or follow-through, else at best DOUBTFUL. The short sword's
attack1 and attack3 pass in msc and are DOUBTFUL in sync (4 frames off). `swing` places the hit by the same choice:
MSR-like by default, on the peak when asked.

## F2 findings (2026-10-22)

`judge ... --draw [dir]` (`anims/lib/draw.mjs`; default `build/anims/judged/<model>/<seq>/`) writes eye.png (frames from
the eye, tip trail by phase, hit/peak tips, the target at MSR's median reach, each finding ringed and captioned),
plans.png (side, top, and edge-on to the strike plane, MSR's reach band shaded, centres of turn), timeline.png (each
finding's curve against MSR's band and the body's limit) and closeups.png (each finding up close at its frame). The
verdicts are unchanged; the judge's m.info and m.path only gained fields (where, jumps, pivots, plane, grip...).

- Read well: fan (a fan of blades about a still wrist), teleport, hyperextended elbow, off-grip, the naive wrist.
- noplane_attack1 is not flagged: plane.residual 4.35 sits in MSR's band and the plane measures are noise. Seen only
  in the edge-on plan. A stricter plane measure is wanted.
- Twist cannot be seen in a still; measures low over the whole blow (shoulder.cone, elbow.range) have no frame of
  their own, so only the timeline tells them.
- Wanted from SMAK (F5): render only near a point or hide bones (close-ups without the torso), a label font with
  ' % < > ~ !, shared grid/column helpers, `smak anim-judge --draw`.

## F3 findings (2026-10-22)

Tools: `anims/lib/swing.mjs` (swing, resolveSpec, describe, solve, pathThrough...), `anims/tools/swing.mjs`
(`<spec.json> [--fit] [--timing msc|sync]`, `reproduce <seq>`), `anims/specs/shortsword.json`. Out in
`build/anims/swing/` (v_1hswords_swing.mdl msc fitted, v_1hswords_swing_sync.mdl, re_attack1-3, strips/).

- The arm as 7 numbers from idle1's frame 0 (shoulder 3, elbow hinge 1, wrist roll + bend 3); clavicle, left arm and
  the sword bone fixed (no drift). Limits by penalty; Levenberg-Marquardt per key, then per strike frame along a
  curve through the keys' reached points (arc / centripetal Catmull-Rom), arc-length Hermite fastest at contact
  (thrust: fastest mid-drive). Shares re-weighted until the strike's turning is split as asked (default from
  attack1-3: shoulder .58, elbow .25, wrist .17). First and last frame = idle's (seam 0).
- Spec: places from the eye [ahead, left, up] or {depth, side, height}; kind, frames, hitFrame/delay, timing,
  peakOffset (msc +3 cuts, +1 thrust; sync 0), from/contact/through, via/after, windup/recovery keys, blade hints,
  phases, shares, trail (a cut's blade trails its motion by 50 at contact, as attack1/2).
- Reproduction (describe -> swing): tip RMS attack1 0.86 u/frame (max 2.1), attack2 2.42, attack3 2.63. attack1's
  verdicts as the original's (msc PASSES, sync DOUBTFUL). Missed: MSR's forearm roll (wrist.twist 92 -> 6) and its
  jerkier speed.
- New blows (hit 18): unfitted, slash and thrust pass, backhand doubtful; with --fit all three pass with every measure
  inside, in msc and sync (sync thrust: reach.hitAngle low). fan.pivot 2.2/1.6/3.8 against the naive 0.9/0.8/0.4,
  wrist.angle ~25 against 142.
- The fit raised the wrist's share to ~.27: MSR cocks the wrist in the wind-up and recovery, not the strike, so a
  wind-up wrist cock would be more faithful. Cuts have no follow-through (phase.follow 0). Overhead untried; Biped
  arms only. Not yet tried in the game.
- SMAK for F5: a weighted, limited arm solver (`reachWeighted`) and pathThrough into animate.mjs.

## F4: the short sword in the game (2026-10-22)

The three blows built on Classic's own v_1hswords (`swing --src run-msc/.../v_1hswords.mdl --fit --out
build/anims/swing/classic`: slash, backhand pass; thrust passes with phase.peakSpeed just outside) as sequences
25-27, and a test copy of swords_shortsword with ANIM_ATTACK1-3 = 25-27 (`build/anims/swing/play-scripts`; `--define`
cannot reach the base scripts, they are not in the pack's folders). `node tools/playtest.mjs yard --items
swords_shortsword --monster trial/dummy --wide 96 --far 200 --steps anims/play/steps-shortsword.json --models
build/anims/swing/play --scripts build/anims/swing/play-scripts`: PASSED, no script errors, the blows play, 2 HITs
in 7 (the misses are the accuracy roll). The owner's verdicts go in anims/verdicts.md.

## F4 A1b: the stop taken out (2026-10-22)

Judge: `flow.stall` (the least, from frame 2 to the strike's first frame, of the fastest of the shoulder's, elbow's and
wrist's turns, deg/s; counted) and `flow.lockstep` (Pearson of the three joints' speed curves six frames either side
of the cock, each pair by its weaker joint's motion; noise, shown only: MSR's axes are in lockstep too). Bands: stall
1h swords p5 48.1 [149 193 268] p95 484 (all MSR p5 43.1); lockstep all p5 -0.33 .. p95 1.0. The old blows: stall
5.9 / 2.5 (slash, backhand: low), naive slash and backhand 0. Drawn in timeline.png. Old measures unchanged.

swing: `flow` { start, enter, leave, end, lead, windupWrist } (FLOW; the thrust's own in KINDS) and `still: { from,
through }`. The cock and the through point are passed with motion (the joints' parts take the strike's own first
and last step as their slopes), a cut's entry speed held down so it rises to contact without a lull, the shoulder's
reference leaves the cock already turning by time while the tip is still slow (elbow and wrist make up for it), the
wrist 10 times dearer in the wind-up's keys, the arm leaving and reaching the idle moving. Fitted on Classic's model:
stall 95.8 / 100.2 / 81.1, lockstep 0.23 / 0.13 / 0.87; all pass msc and sync (thrust: phase.peakSpeed 229 just
low, as before 260). The return to the idle is still one bell after the follow-through (a reversal the places make:
the through point is ~41 from rest); only more frames would make it slower. describe() now carries the original's
flow and marks keys still only where its tip all but stops: reproduce RMS attack1 0.91 (was 0.86), attack2 1.73
(2.42), attack3 1.63 (2.63).

## SMAK 1.0, step 1: the judge on other games (2026-10-31)

Copied from `msr-web/anims` (never committed there) into SMAK as `anim/`, imports on SMAK's own `src/`. Changes:
the old Biped arm names (`Bip01 R Arm1`, `Arm2`, Half-Life's `v_crowbar`); `--arms "R:hand=..,elbow=..;L:.."` for
skeletons with no arm names; arms cut off at the elbow (The Specialists' view models) ride their forearm's parent
as a stand-in shoulder, and the measures it would make up are left out (`UPPER_ARM_MEASURES`).

Judged against MSR's bands (no hit delay given):

| Model | Sequences | Verdict |
| --- | --- | --- |
| Half-Life `v_crowbar` (Valve) | attack1-3 | FAILS: 8-12 measures outside MSR's 5-95% (no wind-up, a snap, short recovery, the tip about the wrist, 0.45 s); no physical fault |
| TS `v_katana` | slash1-3 | FAILS on 2 "physical faults"; otherwise inside MSR's ranges |
| TS `v_knife`, `v_sealknife` | slashes | FAILS: 1-2 "physical faults", 8-9 measures outside (fast, short, snappy) |
| TS `v_melee` (kung fu, fists) | punches, kick, uppercut | PASSES or DOUBTFUL, one jump |

What it shows:
- **Bands from one game are that game's style, not quality.** Valve's crowbar, a well-loved blow, fails MSR's
  timing, reach and pivot measures, and passes every physical one.
- **The physical checks are not yet universal.** The katana's 12-unit `grip.drift` is the judge's error: the
  `katana` bone is fixed to the hand (`Bone24`) in every frame. On skeletons without names the grip is found
  wrongly. TS's `smooth.jumps` at frame 1 is not checked yet.
- So the judge splits in two: **defects** (hard limits a body or a camera sets, the same for every game, each
  proved on several skeletons) and **style** (timing, reach, pivot, speed), banded per style over many games,
  never one.

## Step 1b: Left 4 Dead 2 read (2026-10-31)

- **`src/source/anim.mjs`**: Source's animations decoded (versions 44-49): bone-by-bone animations (raw
  Quaternion48/64, Vector48, run-length Euler and positions, sections, the last frame apart, `.ani` blocks, bone
  255 for none) and L4D2's frame-by-frame ones (`STUDIO_FRAMEANIM` 0x40: bone flags, constants, one row a frame,
  from Alien Swarm's engine). `addDelta` adds a layer onto a base as `base * delta` (the sequences carry
  STUDIO_POST: QuaternionMA). Checked by drawing: Coach's arms swing the crowbar with the fist on the handle.
- **`anim/lib/model.mjs`**: the judge reads a model through one shape (bones, sequences, pose, bodyparts,
  vertices, triangles); `asModel` wraps a GoldSrc file (judge output on MSR, Half-Life and TS byte-for-byte as
  before), `sourceViewModel` builds a Source one: a weapon's or `anim_v_*`'s skeleton and animations with the
  weapon's and the survivor's arms' meshes joined by bone name. ValveBiped's arm names added.
- **L4D2's corpus**: 12 melee weapons with their own swings (62 measured), ~25 guns whose arm animations are in
  `anim_v_*.mdl` + `.ani` (rifle: idles, fidgets, draws, 5 reloads, shots, the shove), throwables, infected claws.
  Each melee view model holds the weapon only; the arms are `models/weapons/arms/v_arms_<survivor>.mdl`.

Against MSR's bands every one of L4D2's 62 swings FAILS (5 to 22 measures outside), as Half-Life's crowbar did.
Its "physical faults" are not Valve's:
- **The fire axe's mesh is drawn twice** (`v_fireaxe_ref_blur`): the axe on `weapon_bone` and a motion-blur copy
  on `weapon_trigger`, stretched in the swing and parked away otherwise. The judge took both as one weapon.
  To do: a copy of the weapon on a second bone is a blur card, not the weapon.
- **The hands are held on the weapon by IK at run time.** Every swing carries `ikrule`s (chains `rhand`, `lhand`);
  the raw keys let the hand drift up to 22 units off the handle, which the game's IK puts back. To do: read the
  ik rules (mstudioikrule_t) and solve the two-bone chains (Studio_SolveIK) before measuring, as the engine does.
- **Swings chain**: `attack_02` starts where `attack_01` ends, not at the idle (`seam.start` 35 units). To do: a
  seam is measured against the blow before it in the chain where a weapon has one.

## Step 1c: L4D2's IK, blur cards and the holding hand (2026-10-31)

- **IK** (`applySourceIk` in `src/source/anim.mjs`): an animation's IK_SELF rules read (mstudioikrule_t is 152
  bytes in L4D2, not the 2013 SDK's 156: the first rule's compressed error begins at 152), each frame's target
  decoded (scaled runs, three places, three angles), its weight from start/peak/tail/end (Source's spline), the
  two-bone chain solved with the elbow kept on its side, the hand turned to the target, the bones below carried.
  `sourceViewModel` applies it. Every L4D2 melee swing has a rule per hand on `weapon_bone`, full weight.
  **It changes little**: the targets are where the keys already put the hands (it tightens a grip by 0.1-0.8).
  The drifts it was meant to explain are authored.
- **A hand lets go**: the bat is held by the left hand and the right lets go in the follow-through (seen in the
  pictures: two hands, one in the sweep, two again), the katana and the axe let one hand off in their sweeps. That
  is a style, not a fault. `measure(..., { hand: "auto" })` takes the hand that keeps its place on the handle.
- **Blur cards**: the fire axe's copy on `weapon_trigger` has its texture smeared and its shape stretched, so it is
  told by the same corner count and material on a second weapon bone, the wider one left out. Its grip drift went
  from 28-35 units to 3-6.

What still FAILS on L4D2's 62 swings is the judge's own definitions, each seen:
- `elbow.min` / `other.elbowMin` (fire axe, shovel: "-172 deg"): the elbows bend 97-167 deg between the upper arm
  and forearm in those frames, never backwards. The hinge read in the upper arm's space misreads ValveBiped's
  arms. To do: the elbow's bend about its own hinge, proved on MSR's, TS's, Half-Life's and L4D2's skeletons.
- `smooth.jumps`: the katana's tip moving 35-41 units in one frame of its strike is a snap at full speed, not a
  teleport (3.5x its neighbours); the guitar's 21-unit wrist step out of frame 0 is hidden by the sequence's
  fade-in. To do: a jump is a step out of proportion to the blow's own peak speed, and seams are counted after
  the fade-in.
- `grip.drift` 3-9 units: the hand re-gripping or sliding along the handle (authored). Three at 20-26 (frying
  pan, golf club, katana) to look at.

## Step 1d: defects apart from style, tried on four games (2026-10-31)

`anim/tools/defects.mjs` runs every hard limit over the blows of MSR (205), Half-Life (3), The Specialists (20) and
Left 4 Dead 2 (62), and over the bad set (39, `anim/tools/badset.mjs`), each counted apart. A defect is one only
when it does not fire on the professional work, or fires where a look at the frames shows a real fault.

Before (the limits as MSR's judge had them): MSR 2, Half-Life 0, TS 15 of 20, L4D2 40 of 62. After:

| | blows | with a defect |
| --- | --- | --- |
| MSR | 205 | 0 |
| Half-Life | 3 | 0 |
| TS | 20 | 0 |
| L4D2 | 62 | 3: the fire axe's elbow flipping sides for a frame, on screen (frame 10 of `swing_sw_e` seen drawn) |
| bad set | 39 | hyper 3/3, offgrip 3/3, teleport 2/3 (the third is below the view), short_attack3 1 |

The bad set's other faults (fan, short, far, twist, late, early, jitter, seam, flat, noplane) were never hard
limits: the bands catch them.

What changed, and what each was found on:
- **Faults are `fault.*`, apart from the style measures.** The measures keep their whole-sequence values for the
  bands; the faults have the hard limits. MSR's bands rebuilt (`elbow.min`'s 5% went from -2.7 to 0.1: MSR never
  bends an elbow back, the old hinge misread it).
- **A wrong pose counts as long as it is seen.** States (an elbow past straight, a fold, a stretch, a folded wrist,
  the weapon off the fist, the off hand off the handle) are the worst level held for 0.1 s with the part on
  screen. Glitches in the motion (pops, flips) count in a single frame, when on screen. Off-screen ones are kept as
  `*Hidden` measures without a limit. Found on L4D2: the frying pan's tip pops 48 units at frame 17 of `swing_02`,
  below the view (drawn from the eye: nothing there); the katana's hilt leaves the hand for one frame (frame 10 of
  `swing_w_e`, 9 units) at the swing's fastest. **Valve ships one-frame slips**; the IK does not mend them (its
  targets are baked from the same keys).
- **The elbow's side from the joints' places**, carried frame to frame from rest, so it holds on ValveBiped (whose
  upper arm carries a roll its elbow does not: the hinge read in the upper arm's space put L4D2's elbows at -172).
  The side changes only through straight; an arm held straight for frames is told by the upper arm's own space.
  A plane that turns over while the arm is bent is a **flip** (`fault.elbowFlips`): a baked IK pole crossing,
  the arm popping to its other side for a frame. Tried and dropped: the upper arm's roll from the places in the
  clavicle's space (view-model arms have no torso; L4D2's roll to 174 deg, as far as the bad set's broken elbows).
- **Pops, not jumps.** `smooth.jumps` (a step 3x its neighbours) fired on snap strikes and smear frames (TS, the
  katana); it is a style measure now. `fault.pops`: a point that leaves its way in a step and comes back in another
  within 3 frames, each step over 3 units, with no slowing about it (steps taken less the window's own drift, so a
  pop in a moving wind-up counts). A first try (any point off the line of its neighbours) fired on every reversal.
- **The grip from the blow's own first frame**, not the idle's: L4D2's shoves re-grip during the blend in (the
  golf club's left hand 25 units from its idle place, held all through). The holding hand is the one the weapon
  hangs from unless another keeps to the handle 0.5 units better (`hand` defaults to "auto"); MSR's 2h sword's
  left hand is pulled along by the blade (its wrist folds to 153) and is not taken.
- **The weapon on a skeleton without names** (TS's BoneNN): the arms' bones and those above them are the body,
  and below an arm only the weapon's bone and what hangs from it are the weapon. TS's katana's "12.4 drift" was its
  butt taken from a vertex of the left forearm; it is 0.0 in every frame.
- **Seams on Source** are left out: Source blends a view model into and out of a sequence.
- `shoulder.cone` lost its limit (140 from rest): a view model has no torso to measure it against, and L4D2's fire
  axe and frying pan wind up to 144.

Still open: chained blows' seams (L4D2's `attack_02` from `attack_01`'s end); MSR's martial-arts claws (no arms in
the model, 12 skipped); the visibility of a part is its joints' (an elbow off screen can drag a forearm that is
on it).

Vermintide 2 is installed (`C:\Juegos\Steam\steamapps\common\Warhammer Vermintide 2`), to look at later.

## Step 1e: styles, game by game (2026-10-31)

`anim/tools/styles.mjs` measures the four games' blows (`anim/lib/games.mjs`, shared with defects.mjs) on the
style measures (not the faults), and writes each game's bands to `anim/corpus/styles.json`: a profile a blow can be
held to, as `bands.json` is MSR's. Blows: MSR 205 (50 sequences), Half-Life 3, TS 17, L4D2 62.

What each game's blows are like (medians; the measures that part them most):

| | MSR | Half-Life | TS | L4D2 |
| --- | --- | --- | --- | --- |
| wind-up | 0.33 s | 0.14 s | 0.00 s | 0.14 s |
| strike | 0.20 s | 0.14 s | 0.10 s | 0.15 s |
| recovery | 0.52 s | 0.23 s | 0.83 s (a hold) | 0.47 s |
| deepest reach | 45 | 32 | 20 | 37 |
| tip's arc in the strike | 79 | 45 | 22 | 57 |
| blade's turn in the strike | 126 deg | 62 deg | 75 deg | 115 deg |
| wrist / elbow / shoulder speed (deg/s) | 443 / 558 / 665 | 633 / 991 / 689 | 548 / - / - | 2016 / 1740 / 1807 |
| forearm twist | 50 deg | 28 deg | - | 86 deg |
| biggest step over its neighbours' | 1.16 | 1.62 | 2.62 | 2.46 |

In words: MSR draws back long and swings deep, wide and slow; Half-Life's crowbar is a short chop with a short
return; TS snaps out with no wind-up, short and straight, and holds; L4D2 whips (arms 3-4 times MSR's speed, the
forearm rolling), with smear frames. L4D2's speeds are not its frame rate: taken at half its rate (17.5 fps, below
MSR's 30) they are still 2-3 times MSR's. But the speed measures fall some 40% at half the rate, so speeds are to
be compared at one rate (to do: resample to a common rate before measuring speeds).

- **A game's blows are told from their measures**: set to the nearest game's centre (its own model left out), MSR
  69%, TS 82%, L4D2 71% (a third by chance). Half-Life's three are too few for a centre of their own.
- **Unnamed, the blows fall by kind of blow more than by game.** k-means finds, whatever k: a snap with smear
  frames (L4D2 and TS), a drawn-out curling strike (MSR, L4D2, Half-Life), a long follow-through (mostly L4D2), and
  one broad main body of every game. The spread left within the clusters falls evenly from k = 2 to 6: no k where
  styles fall apart, a continuum with a few kinds at its edges.

What this means for "decent": a style is not a few discrete boxes to pick from; it is a place in this space. A blow
is decent in a style when it has no fault and sits inside the bands of the profile asked for (a game's, or later a
blend: "L4D2's speed with MSR's reach"). The profiles are games for now; a profile per kind of blow (snap, chop,
sweep, thrust) is the next cut, once there are more games than four (Vermintide 2's to come).

## Step 1f: Vermintide 2's files (2026-10-31)

Investigated read-only; the scripts are in `anim/vt2/` (Python, `zstandard` in a scratch venv), what they extract
stays local. **The animations are readable, decoded and posed.**

- **Bundles** (`bundle/`, 4,678 files named by hash, 65 GB with their `.stream` files): Stingray's, version
  0xF0000007: zstd chunks of 64 KiB, each needing the dictionary in `bundle/compression.dictionary` (zstd
  dictionary id 0x2026CC0C). Inside: a count, 256 bytes of properties, an index (u64 type hash, u64 name hash,
  flags, size), then each file's variants.
- **Names** are MurmurHash64A of the path. The types count: 61,975 animations (2 GB), 1,292 skeletons (`bones`),
  939 state machines, 60,168 units, 6,026 Lua files. Hashing every path-like string in the Lua and units names 912
  of the 939 state machines and 1,175 of the 1,292 skeletons, but 2 animations: a state machine names its clips by
  hash only. There are some 40 first-person melee state machines
  (`units/beings/player/first_person_base/state_machines/melee/1h_sword`, `2h_sword`, `dual_daggers`, `spear`,
  `1h_flail`, `2h_hammer`, `fencing_sword` ...) and the ranged ones. 1h_sword's refers to 127 clips.
- **A clip**: tracks (160 for the first-person rig), its length, events (time, name hash), each bone's place,
  turn and scale at 0, then a stream of keys in the order they are needed, each with its bone and time: float keys,
  or packed: a rotation in 32 bits (smallest three: the largest's index in the low 2 bits, three 10-bit fields for
  the components after it round, over +-0.75), a position in 3 x 16 bits over +-10 m, times in ms. Checked: the
  packed keys at time 0 match the float values to 0.12 deg; 39,426 rotation steps run smooth (median 53 deg/s)
  for every largest index; positions match to the unit of quantisation.
- **The skeleton**: the `bones` resource gives the names in track order (`camera_node`, `j_spine2`,
  `j_rightarm`, `j_rightforearm`, `j_righthand`, `j_rightweaponattach`, fingers, 40 weapon component bones a hand);
  the parents come from the unit's scene graph ((u16, u16 parent) per node, then the nodes' u32 name hashes, which
  are the `bones` resource's): spine, shoulder, arm, forearm, hand, weapon attach, as they should be.
- **Posed**: the 1h sword's fastest clips, in the camera's space: a wind-up at 3-4 m/s, a strike of some 50 ms
  peaking at 20-34 m/s at the weapon attach, a smooth recovery; the upper arm keeps its 0.27 m in every frame.
  Units are metres (the hand rests 0.66 m ahead of the camera).

Still to do before the judge can measure them:
1. **Which clip is which attack**: the state machine's layout (states, events, clips), or the weapon templates in
   the Lua (`scripts/settings/equipment/...`: each attack's animation event and damage window), compiled LuaJIT
   whose strings and numbers can be read.
2. **The weapon's tip**: the weapon units' meshes (another Stingray format), or the length from the templates.
3. **Into SMAK**: Node 20 has no zstd; Node 22.15+ has `zlib.zstdDecompressSync` (to check that it takes a
   dictionary), else a small zstd decoder in JS, or Python as an outside tool behind an adapter.

## Step 1g: Vermintide 2's attacks named (2026-10-31)

Item 1 of Step 1f is done: every melee attack has its clip, its damage window and its timing. New in `anim/vt2/`:
`luajit.py`, `statemachine.py`, `attacks.py`, `idents.py`, `timing.py` (see its README).

- **The weapon templates** (`scripts/settings/equipment/weapon_templates/*.lua`) are LuaJIT 2.1 bytecode with debug
  info. Most of an action is a constant table template (TDUP); a small reader follows the main chunk's table
  building (constants, stores and reads by name or key, globals, `table.clone` taken as the table, the returned
  table) and gets each template whole: per action and sub-action its `kind`, `anim_event`, `damage_window_start`
  and `_end`, `total_time`, `anim_time_scale`, and the template's `state_machine`.
- **The state machine**: layers of (u32 default state, u32 count, states). A state: three u64 (the second is its
  name hash), kind, clips (animation hashes), weights, events (upper 32 bits of the event's name hash, transition),
  transitions (28 bytes: target state in the layer, blend time, ...), then a part not read, ending in 0xFFFFFFFF.
  States are found by shape; the layer counts match what is found in all but one place (flagged, not used).
- **Event to clip**: an attack's state is usually named as its event (`attack_swing_left_diagonal`); otherwise the
  event's transition in the layer gives it (`attack_push` -> `push`), kept to the weapon's attack layer.
- **The result**: 51 melee weapons (no `_vs` variants), 409 attacks (sweeps, pushes, shield slams, a lunge),
  397 to exactly one clip, 241 distinct clips. The 12 left are priest weapons with blend states and a few pushes.
- **Checked**: each sweep's peak hand speed falls in its damage window for 288 of 339 (with 0.05 s slack) when the
  window is taken as clip time, 260 if as action time x `anim_time_scale`; so clip time. The misses are mostly the
  right hand measured on left-hand attacks (dual wield) and the snap from a clip's first pose, which the game
  blends over.

**What goes in the corpus**: measures only, as for the other games: per-blow numbers and the bands made from them.
No clips, keys, poses or joint paths: those stay in the local `out/` cache, which anyone with the game rebuilds with
the scripts.

Still to do: the weapon's tip (item 2) and the reader in SMAK (item 3), then VT2's blows through the judge.

## Step 1h: Vermintide 2's ranged weapons, and numbers others can follow (2026-10-31)

**Ranged mapped.** `attacks.py` now takes every action of every melee and ranged weapon template, and every event an
action can play (`anim_event`, `_last_ammo`, `_no_ammo_left`, `_secondary` = the reload after, ...), with
`fire_time` and `reload_time` for ranged. 32 ranged weapons, 204 events; 51 melee weapons, 699 events (409 attacks).

- **Combo chains followed**: an event plays what its transition leads to *from the state the player is in*, so the
  states are found by walking the templates' `allowed_chain_actions` from idle: each action's entry starts from the
  weapon layer's `idle` states, a chained action from what the one before it played. The 1h sword comes out as
  played: charge left -> `light_attack_left`, charge right -> `light_attack_right`, the third charge -> the
  overhead, push then attack -> the bop. Melee: 397 of 409 attacks to one clip. Ranged: 127 of 204 events to one
  clip; the rest are real variants (a ranged layer has several `idle` sets, each with its own `shoot` and
  `reload`: hip and zoomed, loaded and empty) or blend states (several clips by a variable), all kept as samples.
- **Blend-in recorded**: each transition's crossfade into the state: light swings 0.15 s, heavies 0.05 s, charges
  0.2 s, many shots 0. This is why a clip's first frames can snap away from the idle: the game never shows it.
- **Ranged clips** (`ranged.py`): on two-handed guns the off hand keeps within 2-33 mm of its place on the weapon
  while shooting (a clean contact, measurable); on staves it is free (0.3-0.8 m, gestures); reloads take it off
  and work the weapon (0.05-0.9 m). Half the shot clips move weapon parts through the arm rig (crossbows: 7-9
  of the 40 `j_*weaponcomponentN` bones a hand); reloads seldom do: the weapons have their own state machines and
  skeletons (308 weapon `bones`, `_3p` versions too), driven by the same events. The kick at `fire_time` is not
  shown cleanly by peak hand speed (27 of 47 within 0.1 s); recoil needs its own measure.

**Will the numbers be followable?** A creator aiming at a VT2 band must be able to hit it in their own tool and
rig. Checked against the judge's measures:
- **Scale**: about a third are in GoldSrc units (`reach.*`, `phase.peakSpeed`, `plane.residual`, `strike.arc`,
  `arm.stretch`, `grip.*`, `seam.*`, and the fault limits `fault.armStretch`, `fault.gripLost`, `fault.pops` at 3
  u). VT2 is in metres; anyone's rig may be in anything. To do: lengths over the rig's own arm (shoulder to
  wrist) or forearm (as `fan.pivot` already is), tip measures also over the weapon's length, speeds in arm lengths
  a second; fault limits as fractions of the bone or hand. Angles, seconds and ratios already carry.
- **What the engine adds**: time scale (`anim_time_scale`, attack speed), the blend-in, procedural sway and aim.
  The bands must be of what is *played*: clip time scaled, and seams measured after the crossfade, not at frame 0.
- **The rig**: VT2 has twist (roll) bones, fingers, a weapon attach per hand and weapon part bones. Measures must
  use what every rig has (shoulder, elbow, wrist, the weapon's grip and tip) and treat the rest as optional.
- **Hands on weapons**: the grip measures are melee's (a handle's line). Ranged needs its own: the off hand's
  place on the weapon held (contact, in the weapon's space, over hand length), when it leaves and comes back
  (reloads), the kick (recoil's size and return), and the weapon's parts in time with the hands.

## Step 1i: Vermintide in the judge, and lengths in forearms (2026-10-31)

**The judge's lengths are the rig's own now.** Every length and speed comes out in forearms (elbow to wrist at rest,
both arms' mean; `length: true` in MEASURES), every limit inside the judge is in forearms and turned into the
model's units by it, and the tolerances and hard limits were carried over at MSR's 8.84 units a forearm (what they
were tuned on). A band made from one game now holds for a model of any scale. Checked: the defects come out as
before for every game and the bad set (MSR 0, HL 0, TS 0, L4D2 the same 3, bad set all caught).

**Vermintide is a game the tools read** (`anim/lib/vt2.mjs`, `games.mjs` "vt2"): the clip decoder in Node, clips
as a model (bones, sequences, poses in the camera's space at each frame), the arms by name, the weapon given
(`opts.weapon`: tip and butt on the hand's weapon attach), the hit at the damage window's middle, times as
played (the clip's over `anim_time_scale`), sampled at 60 a second. Python is only needed to fill the cache.
- **Weapons**: the templates name few units; the item lists (`ItemMasterList`, built through a function call the
  LuaJIT reader now follows) give 516. A unit begins with its first mesh's positions (half floats); its long
  extent gives tip and butt in the attach bone's space. A mesh can carry a node offset not read here, so a unit
  is used only when its handle passes through the hand (axis within 6 cm of the attach point, the hand on its
  lower 45%): 81 templates. 1h sword 0.93 m, 2h sword 1.43 m, boar spear 2.27 m.
- **Clips**: a second rest form found (3 clips: the rest values packed as keys are, 16 bytes a track); all 988
  clips decode. 187 blows measured (29 clips left out without a passing weapon, 6 blend states).
- **Crossfades**: Vermintide fades into each state (Step 1h). New `settle` option (seconds): the grip is taken,
  and faults counted, after it; an engine that crossfades never shows the step from rest to frame 0 as a flip.
- **Defects in Vermintide**: 4 of 187, all to be looked at in pictures before anything is concluded: 3 grip
  losses on spears and the billhook late in the clip (the wrist stays 4-8 cm from the shaft, but the shaft is up
  to 19 cm from where the fist closed: a regrip or a slip, numbers cannot tell), 1 elbow flip (a heavy spear
  stab), 1 off hand let go (an elf 2h sword heavy, maybe on purpose). The judge was not loosened to pass them.

**Styles with Vermintide** (`styles.mjs` now keeps a measure where two games have it, so the arm measures count:
TS lacks the upper arm only). Vermintide is told apart from the others for 97% of its blows. Its signature,
medians: deep reach (5.5 forearms), a fast strike (0.10 s, the tip 143 forearms/s), the blade turning about the
wrist (fan.pivot 0.27; MSR 1.21), a big, fast arm (shoulder swing 107 deg at 2183 deg/s, elbow 1568, wrist 2086,
forearm twist 102, wrist bend 101), a long recovery (0.67 s), a 0.27 s wind-up.

Still to do, in order:
1. MEASURES' words are MSR's ("faster than MSR's", a low fan.pivot "the forearm should carry the blow"): say them
   plainly, and make the bands and verdicts default to Vermintide's.
2. One sampling rate for speeds and smoothness across games (Vermintide at 60, GoldSrc at its own).
3. More of the arms (asked for): forearm twist through the twist bones, the off arm on one-handed weapons, how
   much the body and shoulder carry, the camera's motion; fingers later.
4. Pictures of Vermintide blows (the drawing is GoldSrc's meshes): to look at the 4 flags and the weapons.
5. Ranged: the hand measures of Step 1h.

## Step 1j: Vermintide 2 as the default reference (2026-10-31)

- **Reference profiles** (`anim/lib/bands.mjs`): one game's bands a file, `anim/corpus/bands-<game>.json`, each
  naming itself; `vt2` is the default (`judge.mjs judge ... --reference msr` for MSR's). `judge.mjs survey
  [--game vt2|msr]` builds one. Verdicts name the reference ("outside Vermintide 2's 5-95%") and say which layer
  decided them: "FAILS (physical faults)" or "DOUBTFUL (style: near the edge of Vermintide 2's)"; `overall`
  gives `style` ("like", "near", "unlike") apart from the faults. The swing generator (`tools/swing.mjs`) is
  held to MSR's profile, as its constants were tuned on it, until it is made to aim at Vermintide's.
- **Words without a norm**: MEASURES' lows and highs say what the motion is ("a wrist-led snap", "a fast
  shoulder"), not whose it is or that it should be otherwise; only the faults say wrong.
- **The tip's measures in full reaches** (reach.*, phase.peakSpeed, strike.arc, plane.residual): over the arm and
  the weapon from the wrist to the tip at rest, so a dagger's blow and a spear's compare (in forearms the weapon's
  length, which the animator does not choose, decided them). Tolerances carried at MSR's median, 5.83 forearms.
- **Weapons**: families by the template's name first (es_deus_01 is a spear); the striking end by vote over the
  weapon's blows, the end out ahead while the damage lands (the elf daggers' reverse grip). The elf 2h axe came
  out held at its head with its haft behind, seen in pictures (`tools/vt2view.mjs`): most likely a mesh offset
  along its length not read (node transforms), so a two-handed weapon struck with its near end is left out (5
  blows). Meshes centred on the hand are left out as before; the hand may be anywhere else along the weapon.
- **Checked**: defects as before for every game; Vermintide 182 blows, the same 4 flags. Against Vermintide's
  bands the bad set fails throughout (37 F, 2 D of 39). Each Vermintide blow against the others with its own weapon
  left out (a new weapon's test, harsher than MSR's calibration; MSR passes 34 of 205 on it): 74 pass, 46
  doubtful, 62 fail; most often outside: phase.recovery, fan.travelRatio, the joints' speeds.

To do, next:
1. **Recovery as seen**: a combo chains out of a blow at its `allowed_chain_actions` start_time, so the clip's
   recovery past it is seldom shown; measure the recovery to the chain point (the templates give it).
2. **Node transforms** of weapon units: place every mesh (the 29 clips without a weapon, the elf axe).
3. One sampling rate for speeds; the arm measures asked for (twist bones, the off arm, body share, camera); the
   swing generator aimed at Vermintide's profile; ranged hand measures.

## Step 1k: recovery as played, every weapon placed, one rate, the rest of the arms (2026-10-31)

- **Recovery to the chain point**: `attacks.py` keeps each action's `allowed_chain_actions` (`chains`); the judge's
  `cut` option (seconds) ends the recovery where the next attack may start, the earliest `action_one` entry
  (blocks and weapon switches are not the next attack), in clip time over the attack's speed as the damage
  window. Vermintide's recovery as played: median 0.13 s (often none: the next attack cuts into the
  follow-through), where the whole clip's was 0.67 s. It left the measures most often outside.
- **Weapon units placed by their nodes** (`weapons.py`): near a unit's end, u32 nodes, each node's local
  transform (3x3, position, scale), each's world 4x4 (row vectors), parents (u16 kind, u16 parent), names; then the
  meshes, each u32 name, u32 node, 2 x u32, u32 flags, its box (min, max, radius). Not 4-aligned: found by shape;
  a geometry's node is the mesh whose box is its positions' bounds. Every geometry is read (the ghost scythe's
  blade, staff, ...), each placed by its node. The elf 2h axe's node sits 0.61 m along the haft: held near its
  end after all, not at its head. The dwarf 2h axe's node is scaled (0.64 x 0.71): about 1.0 m, not 1.41. The
  rapier's tip was 26 cm short. Dual wields only by template (`dual_wield_*`): the rapier's pistol, a shield or
  the elf spear's javelin is no second blade; a weapon in the left hand alone strikes with it (the Warrior
  Priest's hammer, his book in the right). 214 blows (182); only the flaming sword spell left out (no mesh).
- **Flags now**: grip lost on the ghost scythe's swing, both heavy spear stabs and the sword-and-shield stab;
  the heavy spear's elbow flip; the elf 2h sword's off hand. The billhook's lost grip went with its placement.
- **One rate** (`SPEED_SPAN`, 0.05 s, a frame at MSR's 20 fps, the coarsest): speeds over that span with the
  track interpolated between frames, joints' turns likewise, the jerk on the tip's path resampled to it. Pops,
  flips and jumps stay per frame. Vermintide (51-88 fps) came down about a fifth (wrist 2094 to 1652 deg/s,
  shoulder 2210 to 1663, tip 27.7 to 23.2 reaches/s); MSR hardly moved.
- **The rest of the arms** (new measures): `other.travel`, `other.speed`, `other.lag` (its fastest moment less the
  tip's), `other.counter` (-1 against the blow, +1 with it), `other.onScreen`; `body.share` (the tip's travel the
  body above the arm carries, step by step, over the tip's own), `body.shoulderTravel`; `camera.turn`,
  `camera.shift` (a rig that animates its camera: Vermintide's `camera_node`, read through `model.camera`).
  Forearm twist was already `wrist.twist`; the twist bones only follow it in the skin.
- **What it shows**: Vermintide's body carries 44% of the tip's travel (median; middle half 30-62%) and its
  shoulder travels 1.5 forearms; MSR, Half-Life and L4D2 keep the shoulder nearly fixed (0-4%): the arm alone
  swings. The billhook's stab draws the whole arm 0.7 m back behind the camera and thrusts it out in a few
  frames. MSR's one-handed view models have no off arm: no `other.*` there.
- **Checked**: tests pass; MSR no faults; the bad set fails throughout against Vermintide; Vermintide still told
  apart 99%; leave-one-weapon-out 85 pass, 59 doubtful, 70 fail (more measures, more ways to be outside).

## Step 1l: two lengths the forearms missed, the generator in Vermintide's manner, the hands on ranged weapons (2026-10-31)

- **Two fixed lengths left in the judge**, both in the jumps: a step of 1 unit or less was never a jump, and a
  neighbour's step counted at least 0.5. In GoldSrc an inch and half an inch; in Vermintide a metre and half a
  metre, so no Vermintide jump could be seen at all and its jump ratio was always 1.00. Now in forearms
  (`LEAST_JUMP`, `STILL_STEP`). The jump ratio, a style, is taken over `SPEED_SPAN` steps like the speeds (frame by
  frame a 60 fps clip's steps are nearer alike than a 30 fps one's); the jumps, a glitch, stay per frame.
  Vermintide's ratio is 2.15 (MSR's 1.31): it snaps from a slow wind-up into a fast strike. No Vermintide blow
  jumps. Faults unchanged everywhere; the bad set's twist now fails all three ways.
- **The joints' shares as measures** (`share.shoulder`, `share.elbow`, `share.wrist`, `share.body`: each joint's
  turn in its parent while the blow moves, the body's the part above the arm turning in the view). Vermintide
  0.30/0.20/0.31/0.17, MSR 0.42/0.27/0.22/0.00.
- **The swing generator aims at a reference** (`tools/swing.mjs`, Vermintide's unless `--reference msr`): ten
  numbers, the body (the clavicle's turn, the shoulder's riding on it) among them, leading in time as the shoulder
  does; the reference's family medians of `share.*` are the shares unless a spec says; its upper quartile of the
  shoulder's cone, the wrist's bend and the roll widen the limits, never past a body's (`BODY_MOST`: 140, 90,
  120; Vermintide's rig bends its hand bone to 172 at the 95th, the fingers making up for it, which on a GoldSrc arm
  looks broken). A share of nought holds a joint still: against MSR the body does not move and the short sword's
  three blows pass as before. New fit rules for the body and the shares.
- **How near it gets**: `anim/specs/shortsword-vt2.json` (the short sword's blows paced as Vermintide's: the hit at
  0.4 s, 26 frames) fitted against Vermintide's bands: 4 to 7 measures at the edge each; the backhand DOUBTFUL,
  the slash and the thrust FAIL on one or two far out (the shoulder's cone, the wrist's twist, the tip on screen
  at the hit). Not there yet: the FLOW constants and the kinds' places are MSR's.
- **The hands on ranged weapons** (`lib/ranged.mjs`, `tools/ranged.mjs`, `corpus/ranged-vt2.json`): in the space of
  the hand that holds the weapon, lengths in forearms: the off hand's gap from its place (the clip's first frame),
  its most held 0.1 s, its share away, when it leaves and is back; the kick (travel towards the eye and turn in
  the 0.3 s after `fire_time`, and how soon it settles); how many of the weapon's own bones move against what they
  hang from. 81 clips (65 shots, 16 reloads; every variant's clip). Guns keep the off hand on (0.02 forearms) and
  kick 0.58 forearms and 19 deg, settled in 0.53 s; pistols kick 0.38 and 42 deg; a gun's reload takes the off
  hand off 30% of the clip, leaving at 0.23 s and back at 2.2 s; crossbows move 8 of their parts a shot, bows 9.
  Thrown weapons leave the hand: no off-hand place, no kick.
- **Checked**: 976 tests pass; leave-one-weapon-out 84 pass, 60 doubtful, 70 fail; Vermintide told apart 99%.

To do, next:
1. The generator: its FLOW constants and the kinds' places for Vermintide's manner, until the short sword's blows
   pass against it; a kind of spec per Vermintide family.
2. The 5 Vermintide flags to look at in pictures (lost grips on the ghost scythe, the heavy spear's stabs, the
   sword-and-shield stab; the heavy spear's elbow flip; the elf 2h sword's off hand).
3. Ranged against a profile: `judge` for a ranged clip (its kind and class's bands), and fire times for the
   crossbows and bows (none in their templates: from the clip's events).
4. Fingers.

## Step 1m: charged attacks, light and heavy, the reference's places (2026-10-31)

- **Vermintide's melee is charged** (`lib/charge.mjs`, `tools/charge.mjs`, `corpus/charge-vt2.json`): a press starts
  a charge clip (an `action_one` sub-action of kind `melee_start`); let go before `heavyAt` and the light plays,
  after it the heavy, held to `autoAt` the heavy fires by itself; the next press from the blow's chain point starts
  the next charge. 80 charges: heavy from 0.5 s (2h swords 0.65), fires by itself at 0.7; drawn back by 0.47 s,
  deepest (where the heavy's clip starts) at 1.0 s; crossfades 0.15 s into a light, 0.1 into a heavy; damage 0.33 s
  after a light's release, 0.24 after a heavy's; press to damage 0.43 s for a click, 0.76 for a heavy. The light's
  clip starts far from the charge (74 of 79 over half a forearm): the charge draws back for the heavy, a light has
  its own wind-up and the crossfade joins them. MSR's charged attack plays the same clip as its plain one.
- **Light and heavy bands**: Vermintide's blows are tagged by sub-action (135 light, 79 heavy) and the survey keeps
  `strengths` beside the families; `verdicts(m, bands, family, strength)` and `judge --strength`. The heavies draw
  back less in their clip (they start cocked: windupBack 0.08 against 0.29), stall more at the cock, and swing the
  off arm much more (travel 4.5 forearms against 1.9, counter 0.44 against 0.16).
- **The crossfade left out of the joints' ranges and speeds**: the first frames of a Vermintide clip are mixed with
  the pose before; its wrists fold to 166-173 deg there, behind the eye. The 95th of wrist.angle 162 -> 146; the
  medians hardly move: Vermintide's wrists are bent hard where they are seen.
- **The reference's places**: `info.path` (the tip from the eye in full reaches cocked, fastest, at the hit and
  through, and the striking shoulder at rest) and `info.blades`; the survey keeps `places` per kind (`blowKind`:
  slash, backhand, thrust, overhead) and strength. Vermintide's slash cocks 0.69 reaches out to the right and meets
  at 1.03; MSR's 0.33 and 0.69. The generator takes them (and the blade directions) where a spec gives none, carried
  from the reference's shoulder to the model's (`--own-places` for its own); a thrust's contact is the hit's place.
- **A fit bug**: `explicit()` wrote the generator's own kinds' places into every fitted spec, so fitted runs never
  used a reference's places.
- **Heavies made as charged attacks** (`swing.charged`): a heavy spec's frames and hit are the release's; a 0.3 s
  wind-up is put before it and split off as `<blow>_charge`, retimed to the reference's (a tenth left at 0.47 s,
  there at 0.7, held to 1.0) and measured against the profile; `<name>.play.json` says how a game plays the clips.
- **How near**: the short sword's set at 60 fps (`specs/shortsword-vt2.json`; at 30 fps a strike cannot be under
  0.1 s): the slash, the backhand and the thrust DOUBTFUL (8, 4 and 5 measures just outside, one more than 1 IQR);
  the heavy's charge inside Vermintide's bands, its release FAILS on 10 (the off arm still, the body, the joints'
  speeds). Out of reach notes: Vermintide leans the body in (contact past one full reach), the generator's body is
  a clavicle's turn. 976 tests pass.

To do, next:
1. The generator: the off arm (a counterweight, as Vermintide's heavies), a body that leans, FLOW for faster
   joints; a kind of spec per Vermintide family.
2. A project's choice of game and animation style (see PLAN): the anim tools read it instead of `--reference`.
3. The 5 Vermintide flags in pictures; ranged against a profile; fingers (as Step 1l).

## Step 1n: looked at, and the stroke seen edge-on (2026-10-31)

- **Pictures of ours against Vermintide's** (a local script; `build/anim/look/`, not committed): from the eye, both
  scaled to their full reach, aligned on the hit. What the measures had not said: Vermintide's slash is one straight
  diagonal through the screen, cocked off it; ours curved, held in view flat on the right before it moved; our
  thrust swept like a cut and missed the crosshair; our heavy (a vertical chop) read right.
- **`plane.eyeAngle`** (new): the eye's angle off the strike's plane, from the stroke's middle; 0 is a plane through
  the eye, a straight stroke on screen. Medians: Vermintide 8.6 deg, MSR 16, L4D2 17, Half-Life 41, TS 49. The
  generator puts a cut's plane through the eye (cock and through moved onto the plane of the eye, the contact and the
  sweep's way) when the reference's median is under 12 (`edgeOn`); a thrust has no plane and is left alone.
- **Reach**: a reference's places are kept within 0.95 of the arm's full reach from its shoulder (Vermintide leans
  its body in past one reach). Vermintide's thrust is drawn back almost to the face, which on MSR's short sword arm
  turned the blade across the view: `specs/shortsword-vt2.json`'s thrust has the generator's own places, with
  Vermintide's timing and blades.
- **The set now**: the thrust PASSES; the slash and the backhand DOUBTFUL (6 and 5 just outside: the elbow's range,
  the joints' speeds); the heavy's charge inside the profile, its release FAILS on 10 (the off arm, the body, the
  joints' speeds). On screen: the strokes are straight, but slower than Vermintide's and in view before they move.

To do, next: the joints faster (FLOW), the cock out of view, the off arm as a counterweight for heavies, a body
that leans; a slash split into level and diagonal by plane.tilt (the median of both is between them).

## Step 1o: the wind-up out of view, and a cut's line (2026-11-01)

- **The backhand's strange motion** (the owner's eye): its wind-up was all on screen, the arm raised up the left
  with the blade rolled back over the head out of sight. Vermintide's light clips do not start at the idle: their
  first frame is low in front and out of view (the start places, 0.66 reaches under the eye for a backhand), the
  0.15 s crossfade bridges it, and they draw back only a fifth of the strike in the clip (phase.windupBack 0.20).
- **`info.path.start`** and its blade, kept per kind in the survey's places. Where the style crossfades into its
  lights (the charge profile's lightBlend over nought) and the spec's cock is the style's, the generator starts the
  clip there instead of the idle (`spec.start`: a place or "rest"); the fit keeps it with the cock. Heavies start
  from the idle: their draw-back is the charge. In a game that does not crossfade, a clip that starts away from the
  idle pops: the play table's blend says how long to mix.
- **A cut's line**: the survey keeps slash and backhand places apart by line as well (`<kind>/level`, plane.tilt
  under 20 deg, and `<kind>/diagonal`); a spec says `line`. Vermintide's level backhand is wide (cocked 0.65 reaches
  to the left, through 1.03 to the right): MSR's right arm misses every key by 2 to 7 units across the body without
  the trunk turning. The short sword's set keeps the median places.
- **The set**: the slash, the backhand and the thrust PASS against Vermintide's light bands (2, 3 and 1 measures
  just outside: the shoulder's cone, the joints' speeds, the wrist's twist); the heavy's release still FAILS (the
  off arm, the body, the joints' speeds). On screen the backhand's fist passes close to the camera at the left edge
  as it comes in; its blade still trails the hand at the hit where Vermintide's has swept past it (the wrist's snap).

To do, next: the wrist's snap and faster joints (FLOW); the off arm as a counterweight and a trunk that turns and
leans (the heavy, the level backhand).

## Step 1p: the trunk, the off arm, the camera kept clear (2026-11-01)

- **`body.trunk`** (new): of the tip's travel the body carries, the share the trunk carries (the lowest bone above
  both arms' clavicles: Vermintide's `j_spine2`, Biped's neck). Vermintide 0.44 (one-handed swords 0.31): its torso
  turns and takes the off arm with the blow (other.counter positive: with it, not against it).
- **The generator's trunk**: the body's turn is shared between the trunk (the reference family's body.trunk, where
  its body carries a tenth or more) and the clavicle; the off arm rides the trunk. The slash then passes with every
  measure inside Vermintide's spread.
- **The off arm** (`spec.offArm`, set by the fit from other.travel, other.speed, other.elbowMin): still until the
  cock, then turned by that share of the striking shoulder's turn since the cock, its elbow straightening with it,
  eased back from the through point. Turned from rest at first, it stuck out into the view before the heavy
  (pictures); from the cock it does not. The heavy's off arm: travel 3.7 forearms (Vermintide's heavies 4.5),
  with the blow 0.16 to 0.39, on screen none (Vermintide's median 23%, its 5% none).
- **The camera kept clear**: no point of the arm in view (within 65 deg of the line of sight) nearer the eye than
  0.9 forearms, a cost in every solve, and the joints' parts solved again where they come nearer. The heavy's
  overhead had its sleeve across the screen at the cock (frame.nearArms 0.014; Vermintide's heavies none); now no
  blow's arm is cut.
- **The heavy's timing**: its cock where the spec's phases put it (the fit's shorter strike now moves it), its
  release 1.2 s long, and every made blow judged up to a chain point: the reference's from the damage to the next
  attack (`release.lightChain` 0.25 s, `release.heavyChain` 0.34 s, in the charge profile), written into the play
  table as `chain`.
- **MSR's style keeps the generator's own places** (they are MSR's short sword's, tuned on it; MSR's measured places
  are a median over every MSR weapon and made the slash and the backhand DOUBTFUL): its three blows PASS as before.
- **The set against Vermintide**: slash PASSES (every measure inside), backhand PASSES (3 just outside), thrust
  PASSES (1), the heavy DOUBTFUL (3: the wrist's twist, the elbow's speed, the stall at the cock). 976 tests pass.

To do, next: the wrist's snap and the elbow's speed (FLOW); the off arm into view at the hit; the level backhand
with the trunk turning (try again now that it can).

## Step 1q: the forearm's roll, the edge (2026-11-01)

- **`wrist.twist` was partly a measuring artifact.** It was taken from the idle, and Vermintide's chained blows start
  crossfaded in with the forearm already rolled (up to 135 deg from the idle's), so its bands counted the blow
  before's twist. It is now taken from the first frame shown, and the twist is unwound across frames (a forearm past
  a half turn read as a leap back). Vermintide's median went 101 -> 84 deg: it does roll, but less than it seemed.
- **`wrist.roll`** (new): how far the forearm rolls from the cock to the follow-through's end. Vermintide's lights 66
  deg, heavies 87 at the median; MSR's slash 12. `info.roll` keeps it signed (a right arm's), and the survey keeps
  each kind's signed median and its size (`places[kind].roll`, `.rollSize`): Vermintide's slashes roll one way (+34
  light, +71 heavy), its backhands and heavy overheads both ways about as often, each as far.
- **The generator's roll**: the blade's direction leaves its spin about its own length free, and the solver left the
  forearm unrolled (the heavy overhead rolled 1 deg against Vermintide's 68). A blow that rolls less than the
  reference's lower quartile for its kind, the way most of its kind roll, is asked to: half the roll by contact, all
  of it by the through point (`spec.roll` says it outright). Blows already rolling as the reference's are left alone:
  asking every blow to roll made the slash and backhand DOUBTFUL.
- **`edge.lead`** (new): the angle between the blade's edge and the way the tip moves across the blade, over the
  strike (0: the edge leads, 90: the flat). The edge is the widest way across the weapon's head (`judge.edgeOf`, from
  the mesh: MSR's from the model, Vermintide's from the unit's points in the local cache), none for a round head.
  Vermintide 8 deg at the median, MSR's one-handed swords 6.
- **The generator holds the edge into a cut** (`EDGE_WEIGHT`, at contact and every strike frame; not a thrust's),
  free within 8 deg (held to nought, the backhand leaned 0.4, past Vermintide's least). MSR's generated backhand had
  leaned 29 deg (MSR's own at most 18); now 4-15.
- **The fit's start**: from the hand-written spec (kind and strength only) the fit lands DOUBTFUL for the slash and
  backhand now; it is a greedy search and stops in another place. `anim/specs/shortsword-vt2.fitted.json` is the set
  fitted from Step 1p's, the one to build from.
- **The set against Vermintide** (the fitted spec): slash PASSES (2 just outside), backhand PASSES (4), thrust PASSES
  (every measure inside), heavy PASSES (2: shoulder.cone, flow.stall), the first heavy to pass. MSR's style: slash
  and backhand PASS; the thrust sits on the line (2-3 measures just outside, none far; body.trunk flips on the third
  decimal and the fit follows it).

To do, next: the heavy's stop at the cock (flow.stall: the release starts from the held charge); its off arm into
view at the hit; the backhand's hit comes early in its sweep (the tip still left of the crosshair where Vermintide's
is at the middle); the fit made less greedy (it lands in different places from small changes).

## Step 1r: the heavy's stall, the off hand in view (2026-11-01)

- **The heavy's stall at the cock** (flow.stall 70 deg/s, Vermintide's heavies 118 at their 5%): its release starts at
  the charge's held pose, 12 frames before the cock, and the joints, joined from the idle through the cock with the
  strike's speed at its end, slowed almost to a stop in between. Putting the cock nearer the release's start made
  the strike long and slow (phase.strike 0.28 s, FAILS). Now the release leaves the held pose already moving, at its
  mean speed to the cock, and speeds up into the strike (`spec.split`, set by swing.mjs's heavy); the step from the
  held pose is under the crossfade into the release (0.1 s). The stall: 118 deg/s.
- **Loadouts in the corpus**: each Vermintide blow says what the hands hold (`loadout`: "one", "two-handed", "dual",
  "shield"), from its template and state machine.
- **The off hand's places** (`info.path.offStart`, `offCocked`, `offHit`; the survey's `places[kind][strength]`, from
  blows with one weapon in one hand only). Vermintide's one-weapon heavies hold it forward and up: the heavy
  overhead's at the hit 0.44 ahead, 0.30 below the eye; ours, swung from MSR's low rest by the striking shoulder's
  turn, 0.22 ahead and 0.47 below, never on screen.
- **The off hand reached for** (`offReach`: the off arm's upper-arm turn and its own elbow bend, solved for the off
  wrist's place, `poseFrom`'s numbers 11 to 14): at rest at the first frame, at the reference's places at the cock
  and the hit, back at rest by the last. For heavies, unless a spec says (`offHand: { cocked, hit }`, or false):
  Vermintide's lights keep it about where it rests, and reached for from MSR's lower rest the lights' off hand went
  too far and too fast (other.counter, other.speed). It replaces `offArm` (the shoulder's turn copied) where the off
  elbow is a hinge. The heavy's off hand: at the hit 0.46 ahead, 0.29 below; on screen 25% (Vermintide 23%).
- **The set** (shortsword-vt2.fitted.json, the heavy refitted): all four PASS (slash 2 just outside, backhand 4,
  thrust none, heavy 2: shoulder.cone, body.shoulderTravel). MSR's style as in Step 1q.

To do, next: the heavy's shoulder (it turns and travels less than Vermintide's); the backhand's hit early in its
sweep; fingers (the off hand reaches forward open, as MSR's idle holds it); blocks, then shields and dual wields.

## Step 1s: both hands on a one-handed weapon, the off hand's through, the camera kept clear of the blade (2026-11-01)

- **Loadouts fixed**: two-handed weapons named so but not in a 2h state machine (the cog hammers, the scythe, the elf
  spear) were counted "one"; Kruber's spear and shield (es_deus_01) is a shield, the Warrior Priest's hammer and book
  a "book".
- **Both hands on the handle** (`info.offGrip`: the share of the strike's frames, and the hit, with the off wrist
  within GRAB 0.5 forearms of the handle's line). Vermintide's one-handed heavies take the handle in both hands more
  often than not: slashes 5 of 6, backhands 3 of 4, overheads 2 of 4, thrusts none; its lights seldom (the sword's
  heavy left and right, the elf sword's, the mace's heavy left, the falchion's second heavy, the crowbill's). The
  survey keeps the share (`places[kind][strength].grip`), and the off hand's places are now of free off hands only.
  The Step 1r places had both kinds mixed in, with two-handed weapons: a free off hand is lower than they said (a
  heavy slash's at the hit 0.49 below the eye), but a free overhead's is held forward, as there.
- **The generator's grip** (`offHand: "grip"`, a heavy's default where the reference's share of its kind is over a
  half): the off wrist beside the handle (GRIP_ALONG 0.6 of the way from the grip to the butt, GRIP_OFF 0.25 forearms
  off its line toward the off shoulder), solved each frame from the charge's end (the release starts with both hands
  on, as Vermintide's) to the through point, reached from rest before and let go after; the striking arm keeps the
  handle within GRIP_REACH 0.95 of the off arm's length from its shoulder. New in the set: `sw_heavy_slash_vt2`, a
  heavy slash in both hands: PASSES (2: phase.strike, other.lag), the off hand on the handle through the strike.
- **The camera kept clear of the weapon too**: the both-hands slash's charge held its crossguard, then its blade,
  in front of the eye for the whole hold (the charge is not judged for it; release frame 0 is its held pose). The eye
  room now counts the weapon's butt, grip and a quarter, half and three quarters up the blade as well as the arm, the
  off arm reaching or gripping too, and a frame solved again for it holds its blade loosely (EYE_BLADE 0.1 of its
  weight) so the hilt can turn away about the tip. The charge now holds the sword drawn back low to the right, both
  hands at the middle of the view; its cock is 8 units short of the reference's (MSR's shoulders are wide for a cock
  that far out with both hands on).
- **The off hand's through place** (`offThrough`): a free off hand in Vermintide's heavy overheads swings down and back
  after the hit (0.58 below the eye), its elbow straightening (other.elbowMin; ours stayed bent at 78 deg, past
  Vermintide's 68). Reached for at the through point too: 40 deg.
- **The set** (shortsword-vt2.fitted.json): all five PASS (slash 2 just outside, backhand 4, thrust none, heavy overhead
  1, heavy slash 2). MSR's style: all three PASS.

To do, next: the charge judged for the camera (frame.near* on the charge too); the both-hands cock's place for MSR's
proportions; the heavy's shoulder; the backhand's hit early in its sweep; fingers; blocks, shields, dual wields.

## Step 1t: fingers, the off hand aimed at the handle, the forearm's roll shared (2026-11-01)

- **Vermintide 2's fingers**: its rig has index, middle, ring and pinky of three joints, a thumb of two and a palm bone
  for each; every melee clip keys them all. A hand holds one shape through a blow: the striking hand squeezes (its
  curl 228 to 248 deg) early in the wind-up, holds it through the strike and lets go back to the idle's over the
  recovery; the off hand keeps its idle's loose fist even where it takes the handle. MSR's hands never move a finger
  (fingers.curlChange 0 on every blow).
- **Measured as outcomes, not rotations** (two rigs' fingers differ in length, rest pose and art): `judge.fingersOf`
  finds a hand's fingers by Vermintide's names or a biped's, `judge.handShape` reads a hand's own points. New
  measures: fingers.curl (shown, not counted: a hand's curl round a handle is its fingers' length against the
  handle's thickness; `meta.rigBound`), fingers.curlChange (the squeeze), fingers.stagger (pinky less index),
  fingers.wrap (fingertips' distance from the handle's line over the knuckles'), fingers.thumbAlong (0 along the
  grip, 90 wrapped), other.curl (rigBound), other.curlChange, other.wrap (where the off hand holds the handle; counted
  only above the band, `meta.counts: "high"`: Vermintide's off hand lies on the handle a loose fist, 1.0 to 1.4, and
  one closed round it is no fault). The survey keeps each kind's squeeze and thumb (`places[kind][strength].squeeze`,
  `.thumb`).
- **Sizes from the mesh** (`corpus.handSizes`): the handle's radius at the grip from where its triangles cross planes
  square to it (a handle's vertices are often only at its ends: the short sword's 0.60), a finger's half-thickness
  from its vertices about their joints' lines (0.55).
- **The grip solver** (swing.mjs `closeOn`): each finger closes in its own plane (the idle's curl plane), joints
  1/1/0.75, from the idle's pose until it holds the handle pressed PRESS 0.25 of its thickness in (MSR's own grip is),
  never past FIST 265 deg; the knuckle is not tested (it does not move). The striking hand: closed to hold, or kept as
  the idle's where that is tighter, then squeezed by the reference's curlChange, never past a finger's middle on the
  surface, over the wind-up's first SQUEEZE_BY 0.4, held to the hit, let go to the idle's by the end. The thumb is
  first swung round the handle (its first joint about the line out to it from the handle's axis) to the turn whose
  thumb lies nearest the reference's thumbAlong (Vermintide's wraps it, 45-89; MSR's lies along the grip, 48, and is
  kept as the idle has it). A kind with under five of its own blows takes its family's targets (`style.hand`); MSR's
  style, which keeps no places, gets the hands' targets all the same (`style.hands`).
- **The off hand aimed at the handle**: a hand's channel (`handOf`): where a handle goes through its curled fingers
  (the circles through each finger's knuckle, middle joint and end; MSR's sword hand's is within 4 deg and 0.26 of its
  handle), seated toward the palm where the idle's fist fits a handle best (`seatOf`). offReach takes three more
  numbers (the off hand's own turn, poseFrom 15-17) and puts the seat on the handle and the channel along it, thumb
  toward the tip as the striking hand's (chosen once where it takes the handle), the turn kept to a body's limits
  (LIMITS: roll 85, bend 55, measured on the turn itself, not its numbers). It lets go where the handle swings out
  of reach after the hit (LET_GO 0.1 forearms), its own turn back at rest within RELEASE_FRAMES 10. Its fingers close
  on the handle each frame it holds (a fist already round it kept).
- **The forearm's roll shared** (`shareRoll`): GoldSrc arms have no twist bones, and a forearm's whole roll on the
  hand bone wrung the wrist's skin (the sword wrist 60-88 deg in a follow-through, the off wrist folded 84 and turned
  56 in two frames as it let go: seen in the hand pictures, not by the judge). ROLL_SHARE 0.5 of a hand's roll now
  turns the forearm bone about the line to the hand's joint (not its x: MSR's hand is a little off it, and a turn
  about x moved the hand and the solver landed on a pop), the hand exactly where it was. The judge (`rollToWrist`) and
  the generator's shares count a forearm's roll at the wrist, whichever bone carries it.
- **Pictures of our own hands** (`anim/tools/handcam.mjs <mdl> <seq> [--side] [--frames] [--yaws]`): the model's
  mesh about one hand, frame by frame from several sides, into build/anim/handcam/. No reference game's art.
- **The sets**: Vermintide's fitted five all PASS (slash 2 just outside, backhand 3, thrust 1: the thumb 0.3 short,
  heavy overhead 1, heavy slash 3); MSR's three PASS with --fit. 976 tests pass.

To do, next: the striking wrist's bend in a follow-through (56-59 deg on MSR's mesh, the style's limit being
Vermintide's); a hand's fingers for a shield, a second weapon, a book; then blocks, shields, dual wields; the charge
judged for the camera; the both-hands cock for MSR's proportions.

## Step 1u: the arms surveyed, Vermintide 2's against MSR's (2026-11-01)

What a reference's blows look like is partly the arm they move. Each hero's first-person arm mesh read
(anim/vt2/arms.py: streams by the channel table, the u16 index buffer, the batches' bone sets, the skin's inverse
binds as the bind pose, nodes named from the skeleton's bones resource; local cache out/arms.json), and measured as
our own arms are (anim/lib/arms.mjs, `armMeasures`): ratios only, kept as bands in anim/corpus/arms-vt2.json
(`node anim/tools/arms.mjs survey`), any view model judged against them (`node anim/tools/arms.mjs judge <mdl>`).

- **One skeleton, four meshes** (Kruber, Bardin, Saltzpyre, Sienna; Kerillian's not found by name yet):
  forearm 0.94 of the upper arm, hand 0.40 of the forearm, middle finger 0.94-0.97 of the hand, palm 0.84.
- **Roll bones**: one in the upper arm (0.49 down it) and one in the forearm (0.55), but they barely move in
  the clips (the forearm's in 6 of 400 clips; measured shares against the hand's twist 0.02-0.04), and two heroes
  of four do not skin the forearm to its roll bone at all. Their twist is the skin's: **weights blended across
  the wrist** over 0.12-0.2 forearms and across the elbow over 0.16-0.44, 1.1-1.5 bones a vertex.
- **Palm bones**: five (j_rightinhand*), between the hand and each finger: a palm that cups round a handle.
- **The mesh**: edges of 0.02-0.07 forearms everywhere; the joints no denser than mid-forearm (0.3-1.3).
- **MSR's arm** (one rig in every view model; 1102 triangles about the right arm, 650 the left, by the measure): rigid (a bone a vertex: each joint a seam),
  no roll or palm bones, edges of 0.17-0.27 forearms at the joints, wrist twice as wide as thick, upper arm long
  (forearm 0.59 of it). `judge v_1hswords`: FAILS, 13 out: what our s&box arms must be, not a fault of MSR's.
- **What it changes**: shareRoll (step 1t) stays the GoldSrc answer (a rigid skin cannot blend), but it is not
  what Vermintide does; an arm of our own should blend its wrist and elbow, have palm bones, and be fine enough.
- **Fixed**: `fingersOf` took the other hand's fingers where one hand hangs from the other (v_2hswords: Biped's
  "Finger" names have no side of their own there): fingers now keep their hand's side.
- **Checked**: the Vermintide set unchanged (all five PASS, the same measures out); 976 tests pass.

To do, next: an arms fitter (roll and palm bones added, a GoldSrc forearm split onto its roll bone, weights
blended where the format has them, proportions to the bands, judged after); then blocks, shields, dual wields.

## Step 1v: the arms fitter, every profile's arms surveyed (2026-11-01)

A view model's arms brought toward a profile's (`node anim/tools/arms.mjs fit <mdl> [--ref vt2|msr|hl|ts|l4d2]
[--skip proportions,palm,roll] [--share 0.5] [--out file]`, anim/lib/fitarms.mjs): the same file, every animation
kept, written to build/arms/ and both arms judged before and after.

- **Proportions** out of the reference's bands moved to the nearer edge by `reproportion` (bone lengths, every frame
  kept), the reach (upper arm and forearm together) kept so the weapon ends where it did; GoldSrc's pieces stretched
  with their bones (points times the factor in the bone's axes, normals by the inverse). v_1hswords toward
  Vermintide 2: forearm 0.59 -> 0.94 of the upper arm (upper x0.82, forearm x1.30), hand 0.53 -> 0.40, fingers
  x1.45, palm wider.
- **Palm bones** (`insertBones`, src/mdl.mjs, new: a bone put anywhere in the list, bones it adopts keeping their
  place in every frame by their rest less its place): one between the hand and each finger at Vermintide's place
  (rig.palmAt, new measure: 0.31 of the way to the knuckle), each finger hung from its own, the hand's skin past
  them onto the nearest finger's. They rest in every animation: proved by every corner of every third frame of
  every animation (2.3 million) moving at most 6e-8. The generator leaves them as Vermintide's (`/inhand|palm/`).
- **Roll bones**: one on the upper arm (0.49) and one on the forearm (0.55), the forearm's wrist end (past 0.5) and
  the upper arm's shoulder half moved onto them, turned in every frame of every animation (`turnRolls`) by half the
  hand's roll from its rest and back by half the upper arm's own twist. A rigid skin cannot blend, but a triangle
  across two bones stretches between them: the wrist's seam wrings half, the forearm's round middle the other half.
  MSR's sword hand rolls 50 deg from its rest at idle and 140 in attack1: its wrist was wrung that far.
- **The generator** (swing.mjs): a rig with a forearm roll bone puts the share there (turnRolls on the made frames)
  and no longer turns the forearm itself (shareRoll only without one). The judge counts the roll at the wrist
  whichever bone carries it: with roll and palm bones and MSR's proportions the Vermintide set comes out as before
  (five PASS, the same measures out but the heavy slash's other.onScreen for other.elbowMin).
- **v_1hswords toward Vermintide 2**: R arm FAILS 13 -> 6 out, L 11 -> 5: what is left is the format's and the
  mesh's (no blend across the joints, edges three to five times longer, the wrist twice as wide as thick).
  The blows on the new proportions: the specs fitted to MSR's arm, fitted again (--fit, twice): slash, overhead and
  heavy slash DOUBTFUL, backhand PASSES, the thrust FAILS (fan.pivot 1.53 forearms: its blade turns 23 deg, too
  little for the new arm's reach, and --fit has no way to turn it more). The specs need their keys for this arm.
- **Toward a profile's own arms** (--ref msr): proportions inside, untouched; roll and palm bones added; PASSES. A
  rig count (roll, palm bones) is out only when fewer than the reference's (`least`).
- **Every profile's arms surveyed** (`survey --game msr|hl|ts|l4d2`: both arms of each view model whose blows make
  the game's style bands; Source's skin weights now carried through `sourceViewModel`):
  - **L4D2 does as Vermintide does**: two forearm twist bones turned by the engine (Forearm_driven, Driven_ulna)
    carrying 0.96 of the forearm's middle, the skin blended across the elbow (0.12-0.32 forearms) and the wrist
    (0.08-0.36), 1.5 bones a vertex, a thumbroot palm bone; forearm 0.96 of the upper arm, long fingers (1.2 hands).
  - **MSR has two arm rigs, not one** (step 1u was wrong): forearm 0.59 of the upper arm (v_1hswords, v_2hswords,
    v_2haxes, v_martialarts, v_smallarms) or 0.95 (v_1haxes, v_1hblunts, v_1hswordssb, v_2haxesgreat,
    v_2hblunts); the arm's triangles 325-1102, not 325. Its shape measures are noise where few points fall in a
    slice (wristFlat to 14.6): not used by the fitter, not to be trusted as bands.
  - **Half-Life** (v_crowbar only, as its style bands): no finger bones, forearm as long as the upper arm.
  - **The Specialists**: unnamed bones, no fingers found; forearm 0.67-1.09 of the upper arm.
- **Checked**: 979 tests pass (3 new, insertBones); the Vermintide set on MSR's own model unchanged.

To do, next: the thrust's keys for the fitted arm; the palm bones cupped by the generator round a handle; then
blocks, shields, dual wields. The phase: see PLAN.md (0b's judge done; Phase 2's generation half done on GoldSrc,
its s&box half and Phase 0's measures and Phase 1's adapters not begun).

## Step 1w: the fitted arm's blows, the palm cupped (2026-11-01)

- **The thrust was not the arm's**: on the fitted arm the spec fitted to MSR's arm PASSES (thrust variants with its
  keys moved out of reach or its strike cut to 4 frames did worse, up to FAILS with 13 out); it was `--fit` on the new
  arm that broke it (shares moved to elbow 0.47, shoulder 0.43). Each blow's better spec kept, the one fitted to MSR's
  arm or the one fitted again on the new arm: anim/specs/shortsword-vt2.arms.json (slash, thrust: MSR's; backhand,
  heavy slash: again). On the arm fitted toward Vermintide 2: slash, backhand, thrust PASS; overhead and heavy slash
  DOUBTFUL (fingers.wrap among them: the fitted fingers are 1.45 times longer and stand off the handle). None FAILS.
- **A twist followed past half a turn** (turnRolls): a hand rolled 140 deg from its rest goes on to 190, not back to
  -170, so the roll bones' share never jumps half a turn. (The thrust's one hidden pop, the wrist at frame 6 of the
  wind-up, is the solver's, not the roll bones'.)
- **The palm cupped** (swing.mjs CUP): Vermintide 2's palm bones measured at the hit of 120 blows against the bind
  pose: the pinky's palm folds 7 deg as its knuckle closes 39 (0.18); the index's, middle's, ring's and thumb's do not
  move (under 1 deg as their knuckles close 47-57). So the generator turns a pinky's palm bone by 0.18 of its
  knuckle's closing from the rest (the bind), the idle's part of it coming in with the blow so the ends stay the idle's.
  MSR's hand was skinned as a fist (knuckles 89-104 deg at rest and at idle): its palm is already the grip's and cups
  0.6 deg; an arm skinned open (ours, for s&box) cups the whole share.
- **Fixed**: the fitter's palm bones were named with two spaces ("Bip01 R  PalmPinky").
- **Checked**: 979 tests pass; Vermintide's set on MSR's own model unchanged (five PASS).

## Step 1x: the blows played in s&box, hitting a dummy on their hit frame (2026-11-01)

- **The hit as an event** (swing.mjs `HIT_EVENT`): every blow the generator writes carries a GoldSrc event on its hit
  frame (number 100, options "hit"); a heavy's on its release's own hit frame. `sbox-port` carries it to the
  `.vmdl` as s&box's generic event (Int 100, StringData "hit"), which the game's code hears through
  `SkinnedModelRenderer.OnGenericEvent`. Verdicts unchanged (on the fitted arm: slash, backhand, thrust PASS;
  overhead and heavy slash DOUBTFUL).
- **Fixed** (sbox/port.mjs): an additive (translucent) texture whose sides are not powers of two failed to compile
  (s&box weights a translucent picture's mipmaps by alpha, which it does only on powers of two: MSR's serpentsword,
  492x490); now resampled as a masked one is.
- **In rpg_sbox** (its `game.scene`, MSR's map loaded by GameMap): the fitted arm with the five blows
  (models/smak/v_1hswords_vt2.vmdl, a local test only: MSR's art), `FirstPersonArms` (attack1 the lights in turn,
  chained after 0.65 s; attack2 held a heavy's charge, let go its release), `HitDummy` (a citizen that flashes, rocks
  and logs each hit), `GameMap.Target` (the dummy put 48 units ahead of where the player starts).
  The hit: from the event, for 0.1 s, six points of the blade (bone smdimport's +z, 3 to 25.4) swept from where
  they were last frame to where they are, as spheres of 1.5; the first dummy struck is told the blow, the clip's
  frame it landed on and the event's. The same sweep runs in third person (the view model hidden by the camera's
  exclude tag, still played at the eye), where the citizen plays its own swing (holdtype 6, b_attack) started
  0.2 s before the hit, a box in its hand as the blade: a stand-in until the swing is retargeted to a body.
- **Measured in s&box** (play mode, a script pressing the blows, the dummy's centre 48 units from the eye): every
  blow hits, 0 to 3 frames (60 fps) after its event: thrust 24.7 on 24.7, heavy overhead 15.3 on 14.7, backhand 25.8
  on 24.5, slash 27.4 on 24.7, heavy slash 16.7 on 14.0 (the event read on the editor's next frame). A blow lands
  later the farther its contact passes in front of the dummy's surface. Pictures of the slash frame by frame in
  first person, and of the third person at the hit, looked at: the blade crosses the dummy at the hit frame.

## Step 1y: blows end as Vermintide 2's do, on a held pose the game blends from (2026-11-01)

The heavy slash took correction after correction (a recovery key, a lower through point, a longer hold of the off
hand): each fixed one thing and broke another. The cause was a rule every blow kept, from GoldSrc (which does not
blend between sequences): **the last frame is the idle's**. Vermintide 2's blows do not come back to the idle by
themselves: they glide from the through point to a pose they hold and its state machine blends from there into the
idle. And the judge measured nothing past where the next attack may cut in, so the way home was never held to
anything: every correction there was a guess.
- **The tail measured** (judge.mjs, from the strike's or the follow-through's end to the clip's last frame):
  tail.peeks (the weapon, a hand or an elbow back in view and out again before the end), tail.dip (the tip under
  the lower of the tail's ends), tail.wander (its path over the straight line), tail.settle (when it comes to
  rest), tail.endFromIdle; and the places' end and offEnd. Vermintide 2 (one-handed swords): no peek in its heavies
  (all 214 blows: 0 at the median, 1 at most), dip 0.02-0.07 reaches (p95 0.34), wander 1.6, settled 0.5-0.7 s
  after the follow-through, ending 1.0-1.2 reaches from its idle: low before the body, out of view (the tip 0.45
  ahead, centred, 0.7-0.8 below the eye, the blade forward and down; a thrust's to the right at the eye's height).
- **Its two-handed heavies keep both hands on the handle to the end**: the wrists 0.25-0.6 forearms apart through
  the whole clip (5 of its 16 one-handed sword heavies take the handle in both hands). Ours let go 6 frames after
  the hit (the wrist could not turn with the handle; the solver gave up the place) and the off arm went home by its
  own way: the arm seen in the corner.
- **The generator** (swing.mjs): a style that blends out of its clips (style.crossfade) ends each blow on the
  reference's end place for its kind and strength (spec.end a place, or "idle" for GoldSrc's way), glided to from
  the through point along the straight line (a key every GLIDE_EVERY 6 frames, each solved from the one before: the
  joints' own way between two poses solved apart swung the arm back up through the view), still at the end. A
  two-handed blow ending so keeps the off hand on the handle to the last frame, its turn along the handle held more
  loosely after the hit (AIM_AFTER). Fixed on the way: a heavy's recovery keys counted from the release's frames.
- **The game** (rpg_sbox's FirstPersonArms): Sequence.Blending, so the held end blends into the idle (and the charge
  into its release).
- **Measured**: heavy slash wrists 0.29-0.52 forearms apart throughout (was up to 1.84), tail wander 1.12 (was 2.9),
  no peek; slash PASSES, backhand, thrust, overhead, heavy slash DOUBTFUL, none FAILS (before: 3 PASS, 2 DOUBTFUL;
  the tail now counts). Light clips kept at 52 frames (64 and 70 tried: worse). In s&box, frame by frame at a tenth
  of the speed: the arms leave the view after the follow-through and come back only with the idle; every blow
  still hits the dummy 0-2.7 frames after its hit event.
- **A step where the strike meets the glide** (seen on a 2.31:1 view, not on 16:9): the through key, solved on its
  own and asked for the blade's way, sat on another of the arm's ways to put the tip there than the strike's frames
  before it; the hands stepped 4-11 units up and forward over frames 33-35 of the heavy slash, the off hand to the
  eye's height, and back by 38. A blow that glides to a held end now reaches its through point from the frame
  before, as the strike's frames do, and its glide keys are solved again from there. No peek in any of the five at
  2.31:1; hands 0.29-0.49 forearms apart throughout; slash PASSES, the rest DOUBTFUL (heavy slash 4 measures out,
  was 5); every blow still hits on its event's frame to 2.7 frames.

## Step 2: Vermintide 2's third-person blows measured (2026-11-01)

The body other players see, for the third-person blows we will make for a citizen-rigged body in s&box. Read and
measured only; clips, poses and skeletons stay in `anim/vt2/out/`, the corpus gets `corpus/body-vt2.json` (bands and
per-clip measures). New: `vt2/thirdperson.py`, `lib/vt2body.mjs`, `tools/body.mjs`; `statemachine.read` takes a
`limit` and `split` (both off for the first person, whose reading is unchanged), `skeleton.py` finds the scene graph at
any byte offset and takes a path; `vt2.mjs` exports `worldAt`, `judge.mjs` its STRIKE and FOLLOW shares.

- **Where it is**: each hero has a third-person machine, `units/beings/player/<hero>/third_person_base/chr_third_person_base`
  (Kruber's 9.4 MB), and a skeleton, `units/beings/player/third_person_base/<hero>/chr_third_person_base` (Kruber's 144
  bones: root_point, hips, ONE spine bone, neck, head, clavicles (`j_*shoulder`), arms, forearms, hands, a weapon attach
  a hand, roll bones, legs to the toes, fingers, face; arms and weapon bones named as the first person's). The mesh units
  (`chr_third_person_mesh`) carry only cloth and beard bones. The 1h swords are Kruber's and Sienna's
  (one_handed_swords), Saltzpyre's (falchion) and Kerillian's (her sword), by the item lists' `can_wield`.
- **Its layout**: a whole-body locomotion layer (Kruber's 1,605 states: idle, move, land, one set per weapon; the
  template's `wield_anim`, `to_1h_sword` for all three, sends it to the sword's), a 26-state layer of dodges and
  interactions, then the weapon layer (388 states), whose sword idle is EMPTY: nothing is layered until an attack. The
  sword's events play there, one clip a state; the locomotion layer does not hear them. Two readings had to be
  loosened: transitions reach state 1,600 (the reader stopped at 400), and the weapon layer's first state is of a kind
  not read, so the layer ran into the next ones; it is now cut at its count, a placeholder keeping the transitions'
  indices.
- **The first person's events, fewer clips**: every sword event the first person hears goes to one third-person state
  (45 of 45). The third person shares clips the first person keeps apart: Kruber's and Sienna's light right with the
  bopp, Kerillian's two downward heavies, Saltzpyre's light down with his light left and his upward bopp with his light
  right. Each hero has his own clips. 35 clips measured (11 lights, 8 heavies, 8 charges, 4 pushes, 4 blocks).
- **Crossfades into the states**: lights 0.1 s (Kruber's 0.2; Kerillian's 0.3 from some states), heavies 0.1-0.3,
  charges 0.2-0.4, the push none, the block 0.2. The standing idle is a blend of 3 clips (an aim: the legs agree, the
  arms move); the first is the neutral one and is the reference here.
- **What the clips are**: whole-body clips. They key the hips and legs, the root not at all (no root motion). A light
  starts low in a lunging stance (1.2 forearms of mean joint distance from the idle), lifts the feet three times, drives
  the hips 2.1 forearms ahead by the hit and 0.11 body heights lower, and comes back over the root. Which bones the
  weapon layer lets through over the locomotion is NOT read (no bone mask was found in the machine): the lower body is
  measured as the clip has it (`body.*`), everything else against the hips and the head of the same frame.
- **They come back to the idle by themselves**, unlike the first person's (Step 1y): Kruber's, Sienna's and
  Saltzpyre's lights and heavies end on the standing idle's own pose (0.02-0.04 forearms), still for the last 0.1 s;
  Kerillian's end 0.6-0.8 forearms off hers (her feet end elsewhere), left to the crossfade. But the next attack may cut
  in after a quarter of a light's clip (`time.chainShown` 0.25) and a fifth of a heavy's (0.18), before any has
  settled: in a chain of blows the way home is never seen; only when the player stops.
- **In time with the first person**: the tip's fastest moment against the first person's damage window, both as played
  (clip time over anim_time_scale; the third-person machine has the attack_speed variable too): lights +0.03 s at the
  median, heavies -0.02; 6 of 11 lights and 4 of 8 heavies inside the window. Kerillian's lag (+0.32 s her diagonal,
  +0.54 her stab: a long wind-up).

The bands, median [q1, q3]: lengths in forearms (fa, 0.27-0.31 m) or body heights (H: the head joint above the ground,
1.57-1.73 m); heights 0 at the frame's hips, 1 at its head; degrees; seconds as played.

| | light | heavy |
| --- | --- | --- |
| clip, crossfade | 1.83 [1.79, 1.88], 0.1 | 2.67 [2.04, 2.77], 0.2 |
| wind-up, strike, follow-through | 0.33 [0.27, 0.49], 0.26 [0.23, 0.32], 0.11 | 0.10 [0.07, 0.18], 0.32 [0.28, 0.40], 0.13 |
| settling after it (then held) | 1.00 [0.91, 1.13] (0.14) | 2.01 [1.49, 2.07] (0.07) |
| the tip's peak | 16.4 H/s (96 fa/s) | 15.2 H/s (90 fa/s) |
| wrist from the shoulder: cocked, hit, end | 1.56, 1.85, 1.91 fa (0.92 of the arm straight at the hit) | 1.50, 1.92, 1.84 fa (0.95) |
| tip from the shoulder at the hit | 4.3 fa | 4.4 fa |
| the tip's sweep about the shoulder, strike and follow-through | 280 deg [220, 350] | 367 deg [342, 394] |
| wrist's height cocked, hit, end | 1.08, 0.68, -0.07 | 0.83, 0.79, 0.25 |
| tip's height cocked, hit | 0.93, 1.30 | 0.76, 0.88 |
| the strike's way: down, across (+ left to right), ahead | 0.43, 0.34, 0.14 | 0.39, 0.65, 0.29 |
| spine's turn over the clip; the hips'; spine less hips at the hit | 79 deg; 60; 0 | 80; 64; -5 |
| spine's lean forward at the hit (its range); side lean's range | 13.5 deg (37); 18 | 7.9 (45); 25 |
| head: its turn's range, pitch down at the hit | 56, 10 | 36, 18 |
| hips ahead at the hit, lowest (H), feet lifted, feet apart at the hit | 2.1 fa, 0.11, 3, 3.7 fa | 1.3 fa, 0.13, 3, 4.4 fa |
| off wrist: path, height and ahead at the hit, with the blow (cosine) | 6.6 fa, 0.25, 0.7 fa, -0.33 | 7.9 fa, 0.63, 1.75 fa, +0.95 |
| the first frame from the idle (joints' mean) | 1.21 fa | 1.63 fa |

- **What that says for making one**: the body does the blow. The trunk (one spine bone) and the hips turn together
  (the spine adds nothing past the hips at the hit: 0 to -5 deg) through 60-80 deg; the spine bows 8-14 deg into the
  hit; the head turns less and pitches down 10-18 deg to watch it. The arm is near straight at the hit (0.92-0.95 of
  its length), the wrist from above the head (a light's cock, 1.08) to below the hips by its end; the tip sweeps
  280-370 deg about the shoulder (from behind the body over the shoulder, wrapping past the other side). Lights: a
  0.33 s wind-up, a 0.26 s strike; heavies start cocked from the charge (0.1 s to the strike). The off arm goes with a
  heavy (cosine 0.95, out ahead at chest height) and stays low by a light. Whole clips of about 1.8 s (lights) and 2.7 s
  (heavies), because they glide home: 1 s and 2 s of settling.
- **The ready pose** (the sword's standing idle, 4 heroes): the wrist 1.83 fa from the shoulder, elbow 125 deg, at the
  hips' height (-0.05), 1.3 fa right of the hips and 0.3 ahead, the blade up 34 deg (Sienna's down 20) and turned
  22 deg in; feet 1.96 fa apart, the right foot 1.2 fa ahead (Kerillian's left foot 1.7 ahead, her blade turned out), knees 160 deg, hips at 0.60 H, upright (2 deg);
  the off hand at the hips' height 1.24 fa to the left. The crouched idle's hips: 0.28 H.
- **Also in the file**: charges (drawn back over 0.5 s and held, ending 4 fa from the idle), pushes (a 0.23 s shove,
  the off arm along, two steps), blocks (a held guard, the wrist at the head's height, 1.15).

Uncertain, still: the weapon layer's bone mask (whether the lunge and the steps are seen standing, and what plays over
running legs); whether the third person plays at anim_time_scale (assumed, as the first person); the standing idle's aim
blend (only its neutral clip measured); the third-person weapon taken as the first person's unit on the same attach
bone (the blade meets the forearm at 2-126 deg in both, so the attach agrees). Few clips: 4 heroes, 11 lights, 8 heavies.

## Step 2b: our own third-person blows on a citizen body, laid over its animation graph (2026-11-01)

The five first-person blows' counterparts for the body other players see, made by SMAK on s&box's citizen skeleton and
shaped by Step 2's bands (no clip, key or pose of Vermintide's: only its numbers). New: `lib/bodyblow.mjs`,
`tools/bodyblow.mjs`, `specs/body-sword.json`; in rpg_sbox `Code/Player/BodyBlows.cs` and the keys file
`Assets/anims/body_sword.json`.

- **The mechanism** (Vermintide's two layers, ours): the citizen graph keeps the legs and the locomotion; a keys file
  (per clip and frame a quaternion per bone) is laid over it with `SceneModel.SetBoneOverride`, each bone its own way:
  the spine, neck and head as a turn on the graph's own local (its aim and gait stay), the clavicles, arms, hands, the
  hold bone and the sword hand's fingers as their local rotation, the pelvis and legs (a lunge over planted feet: the
  legs bent back onto the idle's ankles by two-bone IK) only while standing (faded out above 15 u/s). Every bone under
  a keyed one is re-set from the live locals down the hierarchy. A blow cross-fades in from what the body shows (0.15 s
  lights, 0.05 s a heavy's release from its held charge, 0.2 s a charge), so chains cut in anywhere; it ends exactly
  on the ready pose, which the sword arm holds between blows (the graph's hold type 0 leaves the off arm to the gait).
  The clip's rate is set so its hit lands on the first person's (`LightHitAt`, `HeavyHitAt`); the body turns to the
  eye's heading while a blow plays.
- **The rig** comes from the game (rpg_sbox `tools/cs/body_dump.cs`: names, parents, bind, the armed idle as the graph
  poses it, hold type 0, body turned to the eye; a second dump at hold type 6 gives the closed fingers and the hold
  point). Local only.
- **The generator**: keys in time give the grip (in forearms from the sword shoulder where the trunk carries it), the
  blade's way, the trunk's turn (shared 0.3/0.35/0.35 down the three spine bones), the head, the off wrist and the
  lunge; Catmull-Rom on the keys' index. A blow with a hit is run along its path (the tip's way and half the grip's,
  `GRIP_WEIGHT`, so a cusp of the tip's path is not leapt through) on a speed profile: a strike bell on the hit, a
  wind-up bump, a glide home (`strikeTime`). Each frame the sword arm is solved by two-bone IK over the elbow's swivel
  and the blade's roll (wrist bend and forearm twist held to a body's range, the edge led along the tip's way, eased
  over 0.1 s, no jump in twist); the elbow's places and the edge's way are then smoothed over a few frames and the arm
  solved again on them (one pass alone switched grips between frames: the hand stepped 2-3 times its neighbours'
  speed). The forearm's twist bone takes half the hand's roll.
- **Judged** with vt2body's own `measureBlow` (the pose given as turns from the ready pose, so the hips' heading reads
  right on another rig) against the strength's band (`bodyVerdicts`, `judge.overall`). Shown and not counted, by
  design: the hips' turn and steps (the graph's), the signed turns (the reference's lights mix both sides), the end
  (exactly on the ready pose), the game's cross-fade and chain. Results: slash DOUBTFUL (follow-through short, tip a
  little low at the peak, the off hand's reach), backhand DOUBTFUL (the arm 0.85 of straight at the peak, the hand
  high), heavy slash FAILS on its start (cocked farther from the idle than the reference's, 7.9 fa) and a short
  wind-up from the release; thrust FAILS as a thrust must against bands of cuts (arc 20 deg against 280, tip speed
  36 fa/s); heavy overhead FAILS (a straight chop: strike.down 0.8, arc 240 against 367, the arm not straight).
  Peaks 0.37-0.38 s (lights, hit key 0.4) and 0.20-0.22 s (heavies, 0.233).
- **In s&box** (rpg_sbox game.scene, play mode, third person, the Dummy 48 ahead): every blow still hits on the first
  person's sweep 1-2.7 frames after its event, and the body's own sword enters the Dummy's capsule 0.02-0.06 s before
  the first person's hit is told, closest at 0.22-0.42 s. Standing, the ankles move under 0.1 units through the
  lights (the lunge's IK holds them); 1.8-2.2 under the heavies, from the body turning to the eye during the charge.
  Pictures frame by frame (contact sheets) of the slash from behind, the backhand and the overhead from the side and
  the heavy slash from the front: the paths read as the first person's (right-high to left-low, left-high to right-low,
  a drive ahead, over the head and down).

Open: the heavy slash's follow-through hangs the blade near the left leg (clearance 0.52 fa from the legs' axes); the
heavy overhead and the thrust are unlike the reference's style; the follow-throughs keep a small cusp (the hand 1.6-2
times its neighbours' speed in one frame at the follow-through's end); not yet seen while running.
