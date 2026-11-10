# Sounds: GoldSrc's files made from layers, checked, measured against the game's own

`smak sound` builds a sound, or a set of them, from a spec in JSON: layers of noise, tones, FM, struck modes,
particles and recordings, finished (a room, saturation, a limiter, its bands fitted), written as the files the
engine plays (mono PCM, 22050 Hz 16-bit unless told), checked as the engine needs them (no clipping, no offset,
no silence before it starts, no click at its end, a loop's cue and seam), and measured against the game's own
sounds of its kind.

```
smak sound hit.json                     each .wav under the spec's folder, at sound/<its name>
smak sound hit.json -o <mod folder>     under the mod's folder: <mod>/sound/weapons/cbar_hit1.wav
smak sound hit.json --game <valve>      a sound named as one of the game's own held to it, and its references drawn
```

A take (a `sample` layer's) and a `picture` are read from beside the spec; `work:` in their
names is that folder too. The picture of the sounds (each one's waveform over its spectrogram, the game's own of
its kind under them) is written beside the spec. The report follows: `ERROR` for a spec that cannot be built,
`FAULT` for what the engine would do wrong, `WARN`, then the facts (its rate, length, peak, crest, attack, T20,
centroid, bands, against the game's own of its class). The exit code is 1 when it is not OK. In a script:
`buildSoundSpec(spec, { games, readFile, readPicture })` and `validateSoundSpec(spec)` in `src/audio/spec.mjs`, and `smak.audio` for the rest (`readWav`, `writeWav`, which
writes a file it reads back to the same bytes, `features`, `checks`, `soundPicture`, `fromPicture`, `loudness`).

The checks are held to what
SMAK makes: of the game's own files, many have an offset or end on a sample far from silence.

## A sound

A sound, or a set of them, made from layers into GoldSrc's own files (mono PCM, 22050 Hz 16-bit unless
told), checked as the engine needs them, and measured against the game's own sounds of its kind.

```json
{
  "spec": "smak.sound/1",
  "name": "weapons/cbar_hit1.wav",
  "class": "metal hit",
  "seed": 3,
  "layers": [
    { "id": "click", "kind": "noise", "filter": [{ "type": "highpass", "f": 1500 }], "env": { "decay": 0.012 }, "gain": -2 },
    { "id": "ring", "kind": "modes", "f": 760, "ratios": "bar", "decay": 0.7, "damping": 1.2 }
  ],
  "finish": { "saturate": 1.5, "room": { "decay": 0.35, "wet": 0.15 } },
  "variants": [{ "name": "weapons/cbar_hit2.wav", "seed": 4, "pitch": 3 }]
}
```

| Field | |
| --- | --- |
| `name` | Its path under `sound/`, lower case, `.wav`. A sound the game's code plays keeps the game's name (the crowbar's hit is `weapons/cbar_hit1.wav`): that name is the one the game loads, with no code |
| `class` | What it is held against: `metal hit`, `flesh hit`, `swing`, `gunshot`, `reload`, `click`, `pump`, `shell`, `launcher`, `grenade cock`, `grenade bounce`, `explosion`, `step concrete`, `step metal`, `step dirt`, `step tile`, `step grate`, `step vent`, `loop drips`, `loop crickets`, `loop machine`, `loop drone`, `loop fire` |
| `rate`, `bits` | 22050 and 16 unless told; 11025, 44100 and 8 too. Never stereo: GoldSrc plays mono only. 8 bits is warned of: its dither is a hiss under every quiet tail, heard as static and as a reverb that is not there; Valve's own sounds are often 8-bit, and a copy is not held to their depth |
| `seed` | Every random choice: the same spec makes the same bytes |
| `length`, `pitch` | Seconds (unless told, the longest layer's end); a pitch in percent |
| `layers` | Each `{ id, kind, at (s), length (s), gain (dB), env, filter }` (below) |
| `finish` | `room: { decay, wet, tone }` (keep it short: the map's `env_sound` adds the room), then `saturate` (a drive, 1 to 8: what makes a shot loud, its room's tail squashed up to its blast), then `limit: { crest, release }` (a peak limiter squashing the mix until its peak over its RMS is `crest` dB: Valve's weapons are 6 to 10, steps 15 to 21; `release` 0.002 s), `peak` (dBFS, -0.5); last, `fit: "bands"`: its power brought by arithmetic to the shares of the bands it is to have (its own `bands`, else its `picture`'s, else the game's own sound it takes the place of, else the middle of its class's), a gain a band laid smoothly over the spectrum, to within a point or two; the report says the gains. A band the sound has nothing in is not raised from nothing |
| `loop` | `true` or `{ crossfade }`: a cue point at its start, its seam crossfaded; the engine loops it |
| `variants` | More files from the same layers: `{ name, seed, pitch, gain }` (`cbar_hit2`, `pl_step1` to `4`) |
| `reference` | The game's files to draw beside it (unless told, the first of its class), read from the game folders the server was given and never copied |
| `bands` | The share of its power in each band, in %, as a description gives them: `{ "<150": 5, "150-600": 35, "600-2k": 45, "2k-5k": 12, ">5k": 3 }` (any of them). The report holds the made sound to them and warns of a band more than 7 points off, as it does against a `picture` |
| `t20` | The seconds from its loudest to 20 dB under it, as a description gives its decay ("falls about 20 dB in the next 0.44 s": 0.44). The report holds the made sound to it and warns past a fifth off (a copy is judged at a quarter) |
| `onsets` | How many hits a description counts ("three closely spaced hits": 3). The report counts the made sound's as a judge does (spectral flux peaks well over the sound's own mean: no hit in its first frames counts, and of several equal hits fewer count) and warns when they differ: build, read the count, and move the hits |
| `picture` | A picture of the sound it is to be, as the kit draws one (a waveform over a spectrogram, its length in its label): `"sound.png"`, or `{ file, length, rate, row }` when its label or marks cannot be read. The report then gives the numbers read off it beside the made sound's (below) |
| `sounds` | A set: a list of sounds, the spec's other fields their defaults |

The kinds of layer:

| kind | fields | what it is |
| --- | --- | --- |
| `noise` | `color`: `white`, `pink`, `brown`; or `shape` (below), `iterations` | a hiss, a whoosh, a blast, a scrape: shaped by its filters, or by a curve as steep as it says |
| `tone` | `f`, `wave` (`sine`, `square`, `saw`, `triangle`), `sweep: { to, time }` | a boom that falls (`f` 140, `to` 45), a beep |
| `fm` | `f`, `ratio`, `index`, `indexDecay` | a bell, a metallic ring, a machine |
| `modes` | `f` and `ratios` (`bar`, `clamped`, `plate`, `bell`, `tube`, or a list), `gains`, `decay` (s to -60 dB), `damping`, `detune`; or `modes: [{ f, gain, decay }]` | a struck thing ringing: a wrench, a bell, a casing, a plate |
| `particles` | `count` or `rate` (a second), `band: [lo, hi]` Hz, `grain` (s); or `every` (s) and `jitter` (0 to 1 of `every`) | gravel, a rattle, debris, crackle; with `every`, a train of pulses: a door's stop, a ratchet |
| `sample` | `file` (a `.wav` in the work folder: a generator's take, any rate, channels and PCM or float), `from` (seconds into it, or `"onset"`: its first hit), `length` | a recording: brought to the sound's rate, cut, then filtered, enveloped (only when `env` is given: it keeps its own loudness otherwise), pitched and finished as any layer. A sidecar beside it (`hit_s2.json`: `model`, `prompt`, `seed`, `licence`) is told in the report's facts, a non-commercial licence said so |

`env`: `{ attack, hold, decay }` in seconds (`decay` to -60 dB), `{ shape: "bell", decay }` (a swell up and
down, a swing's whoosh), or `points: [[t, dB], ...]`. `filter`: a list of `{ type: lowpass | highpass |
bandpass | peak | notch, f, q, gain, sweep: { to, time } }`. A layer's `at` puts it later: a pump is two
clacks 0.2 apart, a step a heel and a toe. Any layer also takes `drive` (1 to 20: that layer saturated
alone, at its own peak) and `post: true` (added after the finish's saturation and limiter, its `gain` in dB of
the squashed body's peak: a crack of 1 to 3 ms of white noise high-passed at 2 kHz keeps its onset that way).

A noise layer's `shape` is its spectrum, made in the frequency domain where the biquads cannot reach (their
skirts leak into each other): `[[Hz, dB], ...]`, straight between its points on a log scale of frequency
and held past its ends, 0 dB everywhere being the white noise of `color: "white"`; or a shape that moves,
`{ keys: [{ at, curve }] }`, each point's dB going straight from one key to the next (`at` in seconds from the
layer's start). `iterations` (0 to 200, 0 unless told; 32 is plenty) makes the frames' phases agree, so the
sound's spectrogram follows the curve closer; a long sound takes a second or more for it. The `env` still
gives its loudness.

```json
{ "id": "blast", "kind": "noise", "iterations": 32, "env": { "points": [[0, 0], [0.4, -3], [1.0, -40]] },
  "shape": { "keys": [{ "at": 0, "curve": [[60, -12], [300, 0], [1200, -2], [4000, -14], [11000, -30]] },
                      { "at": 0.5, "curve": [[60, -6], [300, 0], [1200, -8], [4000, -26], [11000, -45]] }] } }
```

**From a recording.** When the person has a generator of recordings, a sound of a real thing (a hit, a shot, a step, a
door, debris, a medkit's click) begins best from a generated take, which has the grain, the ring and the room no
layer of noise and modes reaches. The models learned from short captions of real recordings (WavCaps' average 7.8
words; AudioCaps': "a dog barking in the distance", "a train passes by, blowing its horns"), so ask as such a caption
does: 5 to 15 plain words about the sound alone, its source, the action, the material and the space, the events in
order when there are several ("a heavy steel wrench striking a metal pipe, one sharp clang, close-miked, dry"). No
numbers, no frequencies, nothing only seen. Name the source of what is heard, not only the thing: "a sliding door" is
a door pushed by hand, "a sliding door driven by an electric motor, a rising whine" is the machine. A take carries
the room it imagines, which a game's own sounds mostly lack: say "dry" or "close-miked".

**The person's own words** go to the generator as its prompt as they are when the person asks, otherwise rewritten and told to them.

Give its `length`, its `class`, and 4 to 8 seeds; another seed is another take, another wording another set. Choose
the take that is what was asked for and is clean (the measures flag clipping, a slow attack, a ringing tail of noise),
and put it in a `sample` layer `from: "onset"`. Add no `noise` or `modes` layer over a take: it has its texture and
its ring already. Steady noise added to it is heard as static (and, fading, as reverb; the build warns of it), and
modes laid on a hit or a step are heard as a bell. Shape it in the spec only
where it needs it: its `length`, the finish's `fit: "bands"` (a generated hit is often brighter than the game's,
and a filter by hand rarely lands every band: the fit does), `saturate` and `limit` (a shot is loud for its peak). Layers alone are for what has no
real source (a beep, a drone) or where no take comes near. Each take's sidecar names its model's licence, and the
report's facts say when it is non-commercial: tell the person, whose call it is. How a sound sounds is the person's
to say, by ear: the numbers find faults, not likeness.

**Static and reverb.** A steady `noise` layer is heard as static, and one that fades slowly as a reverb the sound
does not have: a real hit, shot or slide is grains and tones, not a smooth wash. Keep noise short (a crack, a
blast's first tenth of a second), and grains under about 3 kHz unless the sound sparkles (particles' `band` up
past 4 kHz is heard as glitter on a blast); make a long tail of `particles` (their `rate` falling) and `modes`, or of a noise
whose `shape` moves through keys. The build warns of smooth noise ringing past 0.3 s; with a `class`, of a struck
sound (a hit, a shot, a step) that takes over 50 ms to reach its peak (heard as played backwards) and of one that
dies sooner than the game's of its class (heard dry, as in a padded room: a short `room` gives it space, noise
does not), and, when it has no target of its own (`bands`, `picture`), of a spectrum off its class's as a judge measures it
(its centroid or a band's share outside the class's range), saying which way to move it. A sound named as one of the
game's own (`headcrab/hc_pain1.wav`), with the game's folders given, is held to that sound the same way, and to its
length within a quarter: it takes its place, and is judged beside it.

**From a picture.** `audio.fromPicture(png)` reads a sound's picture as the kit draws it (its label gives the
length, its marks the rate) and returns a draft spec of tens of numbers: one noise layer whose `shape` moves
through keys read off the spectrogram (where it starts, its loudest, and as it falls by 6, 12, 20, 30 and 45
dB), its `env` points, and a `modes` layer for each tone line it finds, with its level and decay. Edit it:
add a crack, a `limit` at the crest wanted, and change what the picture cannot say. It never gives samples:
a picture inverted to sound is a traced copy of the recording it was drawn from.

What the report says of a sound: each file's rate, length, peak, RMS and crest; its attack, T20 and T40
(seconds to -20 and -40 dB), centroid (Hz: bright or dark), flatness (0 a pure tone, 1 white noise, taken
under 5512 Hz so that a file at 22050 reads as one at 11025), onsets, and its power in five bands; then, with a `class`, how many of its features are in the range of
the game's own of that kind, and each one off in words with which way to go (`centroid 881 Hz (1074 to
1654): too dark: more 600 to 5000 Hz`); with a `picture`, the numbers read off it beside its own: length,
centroid and the band most off (each with how far off), T20 against its class's range (or the picture's own
within a quarter), crest (the picture's is read off its outline, within 3 dB), flatness and onsets, and a warning
(`further from its picture than a copy should be`) while its centroid is more than 15% off, a band more than 7 points,
its length more than 10%, its T20 out of range, or its flatness 1.6 times the picture's or under its share: a copy is
judged at 20% and 10 points, and a picture's reading may be a few off. Flatness is how much of it is noise (0 a pure
tone, 1 white noise); a sound too tonal for its picture is heard as a ring where the original has a crash or a
scrape. Build until it is gone, not only until `OK`. `FAULT`s are what the engine would do wrong: clipping, an offset,
silence before it starts (it plays late), an end that clicks, a loop with no cue or a seam that jumps, and a loop
silent more than 60% of the time (the game's own are at most about half silent: a drip loop is many drips). The
picture is each file's waveform over its spectrogram (log frequency, 50 Hz at the bottom), the game's own
of its kind under them at the same time scale. What it cannot say is how it sounds, or how the game plays
it (its volume, its pitch, the map's room): say so, and the person listens in the game.
