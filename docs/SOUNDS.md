# Sounds: GoldSrc's files read, written, measured and checked

The kit reads and writes the sound files the engine plays and measures them; it does not make sounds (the sound
spec and its synthesis left in 0.39, with the generators). A sound made elsewhere (recorded, a generator's take,
an editor's) is brought to what the engine plays and checked here before it goes into a mod.

```js
import * as smak from "file:///C:/path/to/smak/src/index.mjs";
const A = smak.audio;
const wav = A.readWav(readFileSync("take.wav"));            // any rate, channels, 8/16/24-bit or float, plain or extensible
const mono = Float32Array.from(wav.x);                         // the channels mixed (`{ split: true }` keeps them apart)
const x = A.resample(mono, wav.rate, 22050);                   // to a rate the engine has
writeFileSync("cbar_hit1.wav", A.writeWav(x, { rate: 22050, bits: 16 }));   // `loop`: the cue point a loop wants
const { faults, warnings, features } = A.checks(A.readWav(readFileSync("cbar_hit1.wav")), { loop: false });
```

- `readWav(bytes, { split })` → `{ x, rate, channels, bits, format, samples, cue }`; `writeWav(x, { rate, bits, loop,
  seed })` writes mono PCM (22050 Hz 16-bit unless told) that reads back to the same bytes; `resample(x, from, to)`.
- `checks(wav, { loop, oneShot })` → `{ faults, warnings, features }`: what the engine plays wrong (not PCM, not
  mono, not 8 or 16 bits, a rate other than 11025, 22050 or 44100, clipped, a DC offset, silence before it starts,
  a click at its end, a loop with no cue point or a jump at its seam, a loop mostly silent) and what to know (a quiet
  peak, silence at its end, a cue point on a sound not to loop). The checks are held to what a made sound should be:
  of the game's own files, many have an offset or end on a sample far from silence.
- `features({ x, rate })`: length, peak, crest, attack, T20 and T40, centroid, flatness, onsets and the power in
  five bands (`BANDS`), the top half over 5512 Hz left out so that a file at 22050 reads as one at 11025.
- `loudness(channels, rate)` → `{ lufs, peak, range }`, as broadcasters measure it (ITU-R BS.1770-4, EBU R128):
  what a music track is levelled by, where a sound effect is levelled by its peak.
- `soundPicture(rows, { width })`: a sound drawn for an agent to read, its waveform over a spectrogram on a log
  scale of frequency, with lines at -6 and -20 dBFS and the loop's start marked; several one under another at one
  time scale.
