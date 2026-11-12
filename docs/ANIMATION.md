# Animation: how an agent makes one the person keeps

This guide covers how to make an animation for the person's game: a first-person blow or reload, or a third-person
gait. It describes the method; the measures themselves are in `docs/MODELS.md`, "Motion", and the functions in
`docs/API.md`.

The method comes from three pieces that passed in the game: a katana's blows, a pistol's reload and a civilian's run.
Each of them first passed every check and still looked wrong to the person. The checks did not find what was wrong.
Four things did: the pictures drawn by the game's own eye, a reference from a game whose animation was made by
animators, and the person's own words about direction.

## The order

1. **Read what the game has.** `smak info` gives the sequences, their frame counts, rates, events and travel. Then
   `smak motion <mdl> --seq <name>` runs the judge over the game's own animation. Its faults on the game's own files
   are the baseline: a fault the original has too is not yours to fix first.
2. **Find the game's eye before drawing anything.** Use the fov the person plays at, the shape of their screen, and
   how the engine widens the fov (Xash's `r_adjust_fov 1` is Hor+ on a 4:3 base). Read the fov in the game's config
   (`default_fov`, the `fov` cvar); do not assume 90. Calibrate against one of the person's screenshots: draw the
   idle at that eye with `strip --view first --screen 16:9 --fov <n>`. Lay the drawing over the screenshot. When the
   fov is right, the arms meet within a few pixels. At a wrong fov, every later picture lies about size and framing.
3. **Look at it as the player does.** Run `smak view <originals folder> <yours>` and tick "game's eye" (or add
   `?eye=1&fov=80&screen=16:9` to the address). The arrow keys step one frame and space plays. A gait goes in
   "travel" (`?travel=1&ups=<run speed>`), where the floor goes by at the game's speed. Each model plays by the
   distance it covers over its own travel, as the engine does, so a foot that slides on the lines slides in the game.
4. **R1: the key poses, drawn by that eye, before any in-between.** Show the person one picture of each key pose:
   the wind-up, the contact, the follow-through, the hold (for a reload: the magazine out, the new one shown, seated,
   racked). Approving a path drawn from above is not approving poses. The katana's first R1 approved an arc, and its
   poses had forearms aimed at the camera.
5. **Make it with a script** in your own project, always from the original file (rule 1 of `AGENTS.md`). Replace
   each sequence where it stands. Keep its frame count, its rate and its event frames, because the game times them
   (`replaceSequence(src, i, { frames, fps })`).
6. **Judge it**:
   - `check`, then `smak motion --eye <fov>` (with `--arms fore:hand[:held],...` on a rig of `Bone01`s) with no
     FAULT you cannot explain.
   - `strip --every --beside <the original>` at the game's eye.
   - `strip --onion --bones <forearms>`: the arms' outlines over the whole blow in one picture.
7. **R2 in the game**, only after the person says yes to the copy, with the original backed up. A run of the game
   is the person's to start. What they say about direction ("this cut hits with the flat", "the clip floats") is the
   measure that matters. Fix that before anything a number says.

## First person: the arms

A view model has forearms and hands, and usually no upper arm. Nothing in the file says where the body is, so every
motion keyed on the hand alone risks the two AI faults:
- **The fan:** forearms that sweep the lower screen from a root behind the camera.
- **The arm at the eye:** a forearm seen end-on.

- **Key the hand on a body that existed.** Take the shoulder, elbow and hand at the key moments from a reference
  game's first-person clip of the same action. Read it on the machine and never ship it. The Source reader is not in
  this kit: it is kept on the branch `dormant/0.38` (`src/source/draw.mjs` `sourceFiles`, `docs/SOURCE.md`). Scale the reference to the model by the ratio of the
  forearms. Put the hand where the reference's hand is. Point the forearm along the reference's line from the hand
  to the elbow (`placeForearm`). Turn what the hand holds by the reference's weapon bone. Then fill the frames
  between the keys with eases.
- **Retime, do not copy frame by frame.** Map the reference's frames onto the game's: the reference's fastest frame
  lands on the game's hit frame. Skip the reference's opening frames when they start from a pose that is not yours.
  Ease in from your idle and back out to it. The last frames of the sequence are idle's frame 0, so the cut back does
  not pop.
- **What the hand does not hold leaves the screen.** A hand that lets go of a two-handed grip, and an off hand
  fetching a magazine, drop below the screen's edge for those frames. Carry their forearm down in the world and
  ease it in and out. Otherwise a fist shows in a corner.
- **A part carried by a hand stays on it.** A magazine brought up by the off hand is pinned to that hand. To pin it,
  hold its offset from the hand at the frame where they are closest. Ease it onto the gun's own path only as it
  seats. The game's own files often drift several units, which is hidden below their screen and seen once carried
  into view.
- **An edged weapon cuts with its edge.** `smak motion` measures the tip's motion against the blade's thin axis
  (taken from its mesh) on a blow's frames: `edge` is a fault over 35 degrees on average. When you retarget, match
  the edges, not the bones' axes: find each blade's thin axis by PCA, and take its sign from the side that leads the
  reference's cut.
- **Keep what the person liked.** One horizontal cut of the original was right, so it stayed. Replace only the
  sequences the person names.

### What the judge says that you weigh

- **`elbow` on a rig with no upper arm** is measured against a shoulder fitted to idle's first frame. A mod that
  holds its elbows high gets its shoulder placed far back, and a sound arm from a real game then reads as 10 to 15
  units off. The fact line says when the shoulder was fitted. Compare with the reference's own shoulder, scaled,
  before you move an arm for it.
- **`tail`** fires on every sequence another one follows (reload pieces, a miss into the idle). It is a fact for
  those sequences.
- **The sweep** (the share of the screen the forearms cross over the hand's fastest stretch) is a fact, never a
  fault. A grenade throw sweeps too. Look at the onion skin beside the game's own animation.
- **`cover`** under the game's own does not clear a fan. The pictures decide.

## Third person: a gait

The engine plays a player's gait by distance. Each frame it advances the sequence by the distance moved, divided
by the sequence's travel (`movement`, the linear movement). So the feet stay planted only when the travel is what
the planted feet cover in one play of the sequence.

- `smak motion <mdl> --seq run` gives the slide as a fact, or as a fault when the travel is off by half, with the
  number to use: "the feet ask a travel of N (movement M)". Set the movement to N
  (`replaceSequence(src, q, { movement: [N, y, z] })`) and leave the frames as they are. The legs then cycle faster
  at the same speed, at the cadence a runner has.
- A run's contacts are short: each foot is down 3 or 4 frames out of 31. The judge measures a loop whose feet come
  down by turns as a gait. A jump or a dive is not measured as one, and the fact says why.
- Check the result in `smak view`'s travel mode, several models at once at the game's run speed, before the copy.
- The fix applies to every player model that shares the gait. Build each model from its own original, never from one
  copy reused.

## The copy into the game

- Ask the person before each copy and before each run of the game.
- Back up what the copy replaces. Keep a separate backup of the original; the first replacement is not the
  original.
- When the mod has variants of the same file, as The Specialists' match modes do, build each one from its own
  original.
- Compare each copied file's hash with the one you built.
- Say which file went where, and where the backups are.

## When it still looks wrong

When the person sees a fault no check names, it is a fault of the kit: write it in your project's list of the kit's
faults, with the numbers you measured by hand. Then fix the animation by direction, not by the number. The katana's
flat-first cut had no measure; it got one (`edge`) after the person named it. A fault that only the person's eye
catches today is the next measure.
