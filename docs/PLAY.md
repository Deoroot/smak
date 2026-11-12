# Playing a map in the game, and testing by what the game says

`smak play` opens a browser build of the Xash3D engine, loads a map, gets into the game as the mod's profile
says, does a list of steps, and writes down what happened: pictures, a sheet of them, and **every line the
game said, with its time**. A step can wait for a line and a run can be held to lines, so a test passes or
fails by text and nobody has to read its pictures.

Or it plays the person's own game from Steam, by its console (`smak play native`, below), with nothing more
than Node. The browser build needs two things that are not part of this kit: the build served at an address, and
Playwright (`npm install playwright` in a folder of your own; name the folder with `--playwright` or
`PLAYWRIGHT_DIR`). The library is `cli/play.mjs` (`import { play } from "smak"`); `docs/API.md` has its
functions.

In short, for the usual tests:

- To test a fight, write `{ "fight": { "heal": 0.5, "post": [...] }, "until": "<the line that ends it>" }`,
  not a loop outside: the summary line is the measure of difficulty.
- A held mouse button charges in Master Sword: use `tap`.
- A fight strikes the nearest unless told: `prefer: "lantern"` goes for the healer first, `chase` walks
  round a crowd to it (sidesteps), `dodge` steps out of a place a line warns of (a test copy's line: the
  real game shows a sprite). Their counts are in the fight's line ("A fight", below).
- A session (`--serve`) keeps a fight of any length; `--over msc=<folder>` puts a model rebuilt since the
  game started.
- To film it, run with `--show --gpu` (a window on the graphics card: software draws a town at a few frames a
  second) and put `{ "record": "name" }` ... `{ "record": false }` round the steps to film; `face` and `look`
  with `ms` pan the view. Each clip is written `NN_name.mp4` beside the pictures (needs ffmpeg).
- A run ends in one line, `PASS: ...` or `FAIL: ...`, and says which picture to look at, or that none is
  needed (`docs/COMMANDS.md`, "Answers in text first").

## The Steam game itself: `smak play native`

```
smak play native --map te_neuropolis --mod ts --steps steps.json -o work/run1 --expect-not "Couldn't load"
```

The same run in the game Steam installed, GoldSrc's own engine, with nothing but Node: no browser, no
Playwright, and no key pressed unless asked for (`--input`, below). The game is started as `hl.exe -game <folder> -insecure
-windowed -condebug +exec smak_run.cfg` and driven by its console alone (cli/play-native.mjs, which says how):
a command is put in a `.cfg` the game reads every few frames, and answered in a tenth of a second; what the
game says is read from `qconsole.log`; a picture is its own `screenshot`. A run is in the map 2 seconds after
the start and over in 4 to 9 (Neuropolis in TS, 2026-10-24).

- The Half-Life folder is found in Steam's libraries (or `--half-life <folder>`, `SMAK_HALF_LIFE`); the game's
  folder is the profile's (`ts`, `msc`), or `--game-folder`, or `valve`. Steam is running (without it was not
  tried); one game at a time.
- `-insecure` keeps it off VAC, and a run never joins a server: `connect` and `retry` are refused.
- It has no view: a walk (`+forward`), a turn by time, `command`, `say`, `until`, `expect` and `shot` work;
  `look`, `face`, `where`, `goto` with a check and a fight's aim do not, and say so. `--put`, `--over`,
  `--serve` and `record` are the browser's.
- **Keys and the mouse** (`hold`, `press`, `click`, `mouse`, `tap`, `mouseDown`) only with `--input`, and
  only once the person has said yes: they are real keys and buttons (Windows' `SendInput`, by scan code, so
  the person's own binds apply), and they take the keyboard and mouse while the run lasts. They are sent only
  while the game's window is in front, never brought there; the first waits until the keyboard and mouse have
  been left alone `--quiet` milliseconds (5000), for up to a minute; the person touching either after that
  stops the run, and whatever was held is let go. Only the windows of the process the run started are
  reached, by its id. Keys are Playwright's names (`"w"`, `"Enter"`, `"Space"`, `"ArrowUp"`); `click` is in
  the window's pixels.
- **Pictures of the window** (`--window-pictures`): each `shot` is the game's window as the person sees it
  (PrintWindow, which draws a window of the graphics card), in place of the game's own `screenshot`. When the
  game does not answer, the sentence says what its windows show, a box's words first ("Fatal Error ...").
- Its log is the mod's own words, including what it could not load: a missing sound, sky or model is a line
  (`Warning:  Unable to open ...`, `R_LoadSkys: Couldn't load ...`), so `--expect-not` holds a map to having
  every file it names.
- The person's settings are theirs: the game saves its binds and settings into the mod's `config.cfg` as it
  quits, so the run keeps the file as it was and puts it back (a step's `bind` does not stay).
- In The Specialists the player begins as a spectator with the buy menu open. `slot7` takes its Random and
  closes it; "Press Fire To Play!" then wants the key bound to `+attack`, which TS's client reads itself, and
  `+attack` from the console does not let him in (measured 2026-10-24). With `--input`, `{ "tap": "left" }`
  is that key, when the person has MOUSE1 bound to `+attack`: the first click takes the prompt away and a second
  puts the player in (`{ "tap": "left", "times": 2, "every": 2000 }`; measured 2026-10-25, `te_neuropolis`,
  the second by the person; real W and D moved the free-look camera before it). Without `--input` a TS run looks round its map as a spectator and is held to
  what the game says (a missing file, a script's line), not walked.
- Real keys are the person's binds: a key they have not bound does nothing, and says nothing. TS's
  `config.cfg` on this machine was found with `unbindall` and three binds left (2026-10-24; not by a run), and
  every key step did nothing until the person bound them again. When a key seems to do nothing, read the
  mod's `config.cfg` first.
- Two starts of `ts_lobbyduel` in seven ended by themselves as the player connected (code 0, no line): the run
  stops and says the game ended; run it again.

## A demo, read: `play.readDemo`

```js
const demo = smak.play.readDemo(readFileSync("Half-Life/ts/walk.dem"));
demo.frames[0]; // { time, frametime, origin, velocity, onGround, waterLevel, viewHeight, viewAngles, cmd, movevars }
```

A GoldSrc demo (the console's `record <name>`, ended by `stop`) keeps, with every network message, the view the
client drew that frame with: the player where the client predicted them (`origin`, `velocity`, `onGround`, the eye's
`viewHeight`), the command it sent (`cmd`: `msec`, `forward`, `side`, `up`, `buttons`, `viewAngles`) and the
server's movement settings (`movevars`: gravity, maxspeed, friction, accelerate...). `commands` are the console
commands it kept. So a demo of a run is the player's own movement frame by frame, as exact as the game had it,
whether the run was played by the person or by `smak play native` (whose console moves need no `--input`). A
spectator's `viewHeight` is 0. The layout is Xash3D's cl_demo.c's (demo protocol 5).

In The Specialists a run of `smak play native` did not get the player in (2026-10-28): the buy menu, a VGUI menu,
stays open over `slot7`, takes real clicks, and the server let no `respawn` from the console through, with an empty
loadout either. The walk was played by the person and recorded.

## The commands

```
smak play <url> --map yard --steps steps.json -o work/run1 --mod <profile> --game <folder> --playwright <folder>
```

One run from a cold start. It ends with 0 when every expectation held, with 1 when one did not or the run
stopped. Several `--map` (each with the `--steps` given in the same place) are several runs in one start of
the engine, each in a folder of its own under `-o`.

```
smak play <url> --serve [--port 8098] --mod <profile> --game <folder> --playwright <folder>
smak play http://127.0.0.1:8098 --attach --map yard --steps steps.json -o work/run1
smak play http://127.0.0.1:8098 --attach --map road --steps more.json -o work/run2 --expect "Skeleton .* dies"
smak play http://127.0.0.1:8098 --attach --stay --steps again.json -o work/run3
smak play http://127.0.0.1:8098 --attach --close
```

**A session.** `--serve` starts the game once and keeps it; every `--attach` is a run in it that pays for its
map and not for the engine. Measured in a local build drawn in software (2026-10-13): the engine is up in 8
to 9 seconds; a small map has loaded 8 seconds after `map` the first time and 4 to 6 after that; the player
is in the game a tenth of a second after the menu's click. A cold run is in the game after 18 seconds and a
run in a session after 6, where the fixed waits of 0.11 took 79.

- `--map <name>` loads the map afresh, even the one the session is in (monsters back, doors shut).
- `--stay` loads nothing: the steps go on where the last run left the player. A file `--put` with it is
  written without leaving the map (the game reads it when it next opens it), and the run says so.
- `--from <section|step>`: the steps begin at that section or step number (**A run in sections**, below);
  with `--stay`, a run that stopped is gone on with where it stopped.
- `--put <place>=<file>` writes a file into the running engine before the map loads (`--put
  msc/maps/yard.bsp=build/yard.bsp`): a map rebuilt, a script pack repacked or a save put back is tried
  without starting the engine again. The map the session is in is left first, because a game may write its own
  files as a map ends. What an engine reads only once is not changed by this: a game's list of items, read
  when its libraries load, wants a new session; so may a model the engine still holds.
- `--over <place>=<folder>`: a folder laid over the game's files (`--over msc=content/assets/msc`). Given
  to `--serve`, the session marks every file in it (its size and time) as the engine starts; a run
  `--attach`ed with the same `--over` puts every file of it that is new or changed since, and the mark moves
  on. A game that is up reads a model once (one it failed to find stays failed): this is how a model rebuilt
  is tried in the game that is up. A folder the session never marked is marked by the first run that names
  it, and nothing of it is put then. A run that names no `--over` puts nothing of it: what changed waits.
- `--port <n>` (with `--serve`): several sessions side by side, each with its own engine and port, for
  several agents testing at once.
- `--expect <pattern>`, `--expect-not <pattern>`: lines the whole run is held to.
- `--no-sheet`, `--show` (the browser's window seen), `--gpu` (with `--show`: WebGL on the graphics card, smooth
  enough to film; the pictures then depend on the card), `--loads <ms>`, `--width`, `--height`.
- `--full-pictures`: the pictures at the page's size. Unless told, each is written a third of it each way
  (341 by 256 for a page of 1024 by 768), which tells where the player stands and what he sees; the clicks
  and the page keep their size, and `sheet.png` its own. In a script, a run's `shrink` (1 unless told).
- `--verbose`: each step printed as it is done, and every picture and section line after the run, as before
  0.27. Unless told, a run that passes prints four lines: where its steps and the game's lines were written,
  its fight's line (or the run's), which picture to look at, if any, and `PASS: ...`.

**A long run** (a fight of ten minutes) is answered as it goes: the session sends its answer's headers at
once, a line for each thing done, and a beat (`{ "beat": seconds }`) every 30 seconds in which the run says
nothing; `--attach` reads the answer with Node's own `http` and no time limit. Before 0.15 it read it with
`fetch`, which gives up after 300 seconds of silence: a run of over five minutes ended in the attaching
process with `FAILED: terminated` while it went on in the game.

What a run leaves in its folder: `NN_name.png` for each picture, `sheet.png` (all of them in one, each under
its name), `log.txt` and `log.jsonl` (what was heard), `told.txt` (what the command printed before 0.27:
each step done with its times, the pictures, the fights and sections, ending in PASS or FAIL), `result.json` (the steps with their times, the
expectations, `passed`, and the `failure` when it stopped), and `summary.json` (below, **A run in
sections**).

## The steps

A JSON list. Each step is an object with at most one thing to do:

| Step | What it does |
| --- | --- |
| `{ "command": "noclip" }` | a console command, or a list of them |
| `{ "say": "hail" }` | said as the profile says a thing is said |
| `{ "walk": 2000 }` | forward for that many milliseconds; `"to": "back"`, `"left"`, `"right"`. Where the view can be read, a walk that moved the player by less than 2 units stops the run: `did not move after walk 2000 ms: in solid? (origin ...)` (a `goto` that set him into a brush) |
| `{ "turn": 90 }` | 90 degrees to the left (under 0: right). Exact: the yaw is read, added to and set |
| `{ "face": 90 }` | turned to that yaw: 0 looks along +x, 90 along +y |
| `{ "look": -30 }` | looking 30 degrees down (over 0: up; 0: level). `face` and `look` may share a step |
| `{ "button": "use", "ms": 200 }` | one of the game's buttons held: `+use`, the wait, `-use` |
| `{ "mouse": "left", "ms": 2500 }` | a button of the mouse held that long: `left`, `right`, `middle`. **A game may charge a blow while the button is held and strike only when it is let go** (Master Sword does: a held left button swings nothing, and a wall that breaks is broken by taps): use `tap` |
| `{ "mouseDown": "left" }` ... `{ "mouseUp": "left" }` | held while the steps between are done (let go at the run's end if not before) |
| `{ "tap": "left", "times": 5, "every": 700 }` | the button pressed and let go, `times` over (1), `every` ms from one tap's beginning to the next (700), down `ms` each (200). What is left of `every` is waited after the last, so taps in steps of their own keep time. With `until`, tapped again every `every` until the line comes |
| `{ "faceAt": [1872, 976, 40] }` | the view turned to a place, yaw and pitch, from the player's eyes (his origin and the profile's `eye`, 28) |
| `{ "faceAt": "target", "radius": 600 }` | turned to the nearest living enemy, as the profile's `play.target` finds one (768 round unless told); the run stops if there is none |
| `{ "hold": "w", "ms": 2000 }`, `{ "press": "Enter" }`, `{ "click": [512, 330] }` | a key held, a key pressed, a click on the page |
| `{ "goto": [512, 96, 36] }` | the player put at that place (the middle of his box: the floor and 36), by the profile's command, the profile's `lift` over it (Master Sword: 4, so that he drops onto a path brush two units high instead of being set into it); then read back, and the run stops if he is not there |
| `{ "census": 6000 }` | the living monsters within that radius (`true`: 6000) counted as the profile's `play.census` asks, and printed as a table in the log, of the kind `census`: `census (step 3): 2 within 6000, 1 an enemy`, then a line each: name, health, place, and whose enemy |
| `{ "face": 270, "ms": 4000 }` | (with `look` too) the view eased there over that time, the shorter way round: a camera's pan, for a clip |
| `{ "record": "plaza" }` | the page filmed from here as a clip of that name until the next `record` or the run's end, written as `NN_plaza.mp4` (H.264, 30 a second, through ffmpeg) numbered with the pictures; `{ "record": false }` ends it. The browser's driver films what the page draws (its screencast): in a window on the graphics card (`--show --gpu`) a map is drawn smoothly, in software at a few frames a second |
| `{ "where": "gate" }` | a line in the log: `where gate: origin 512 96 36, yaw 90, pitch -30` |
| `{ "map": "road" }` | another map loaded and entered, in the same run |
| `{ "travel": true }` | through the way to another map the player stands in: the profile's `play.travel` commands (Master Sword: `accept`), its line of the next map's server (`Spawn Server: <map>`), the map's `loaded` line and the profile's `enter` steps. `"travel": "barrowroad"` stops the run if the way led elsewhere; `within` is the longest each wait is (the profile's `loads`) |
| `{ "section": "terraces" }` | the steps after it, to the next section, are one part of the run: timed and counted on their own, and a run may begin at it (`--from`). It does nothing in the game |
| `{ "expect": "HIT! .* holy damage" }` | the run fails unless a line heard matches |
| `{ "expectNot": "Script Error" }` | the run fails if a line heard matches |
| `{ "repeat": [steps], "until": "dies", "within": 60000 }` | the steps done again and again until a line; or `"times": 4`, or `"for": 20000` (ms). With `until` alone the run stops when the line never comes in `within` (30000); with `until` and `times` or `for` the block ends at whichever comes first and stops nothing. Its steps are in the log as `3.1`, `3.2`... once for each time they were done |
| `{ "fight": { "heal": 0.5 }, "until": "is quiet", "within": 600000 }` | the nearest enemy found, faced and struck, again and again, until a line (or `"for"` a time): see **A fight** below |

and any step may carry:

| Beside | What it does |
| --- | --- |
| `"until": "Skeleton .* dies"` | after the step, wait for a line the game says, and not for the clock. From where it hears: see below |
| `"within": 20000` | the longest `until` waits (30000). Past it the run stops and says what it waited for and the last lines heard. With `expect`: how long the line is given to come (unless told, it has to be there already); with `expectNot`: how long it is watched for |
| `"every": 1000` | with `until`: the step is done again that often until the line comes (a click a menu does not take until it is drawn) |
| `"since": "map"` | with `expect`, `expectNot`: read the lines since the run began (`"run"`, the default), since the map last loaded (`"map"`), since this step began (`"step"`), or since the picture of that name. With `until`: the same, and `"deed"` (since the last step that did a thing began) |
| `"wait": 1500` | milliseconds waited after it (1000 after a step that does something and has no `until`) |
| `"shot": "gate"` | a picture taken after the wait |
| `"already": "pass"` | with `until`: what is done when its line was said BEFORE the step began (below). `"pass"` ends it at once, `"warn"` says so and waits all the same, `"wait"` says nothing |
| `"onFail": "continue"` | the step failing (its line never came, a `goto` that put the player nowhere) is a failed expectation, and the run goes on; on a `section` step, for every step of the section. Unless told: `"stop"` |
| `"keep": { "hp": "= ([\\d.]+)" }` | a value kept: the first group of the pattern, in the line its `until` stopped at, or else in the last line said since it began. A later step names it `${hp}` in a `command`, an `until`, an `expect` or an `expectNot` (in a pattern it is matched as written: a dot is a dot). A run that stays has the values kept before it |

So `{ "wait": 5000 }` only waits, `{ "shot": "here" }` only takes a picture, `{ "until": "dies" }` only waits
for a line.

**From where an `until` hears.** A step that DOES a thing and has `until` hears from its own beginning: the
line it waits for is the answer to what it did, and a line said before it acted is not that answer. A step
that ONLY waits (`{ "until": ... }`, with a picture or not) hears from where the last step that did a thing
began. So in

```json
[
  { "button": "use", "until": "The altar sinks", "wait": 1000 },
  { "until": "the dead get up" },
  { "until": "a door opens" }
]
```

a line the game said in the same instant as "The altar sinks", or while the first step was still at its
wait, is heard by the waits after it, however many there are; a step that only reads (`where`, `expect`)
between them changes nothing. And no `until` stops at a line another `until` has stopped at: two waits for
`"HIT"` want two hits. `"since"` says otherwise where it is wanted (`"run"`, `"map"`, `"step"`, `"deed"`, a
picture's name). A pattern is a regular expression as text, matched as written (capitals count); `"/flame
sinks/i"` gives flags.

**A line already said.** An `until` hears from its step's beginning (or from the last deed's), so a line the
game said before that is not heard: an area that fell quiet while the player fought the one before it never
falls quiet again, and its fight waited out its `within` (a ledge's, 600 seconds, for a line said a minute
earlier). So a step with `until` looks back as it begins, over the lines said since the map was entered (or
since the last step that waited for the same pattern ended) that no `until` stopped at:

- a `fight` whose line is there ends at once, the line taken as its own (`"already": "pass"`, a fight's unless
  told), and the log says `step 27: "The Watchers' hall is still. ..." was heard at 1188.4 s, before the step
  began: it ends at once (already: "pass")`; it strikes no blow and is no fight in `fights`;
- a step that only waits, and a `repeat`, warn (`"warn"`: `step 4: WARN "..." was heard at ... s, before the
  step began; it waits for the line all the same`) and wait as before;
- a step that does a thing says nothing (`"wait"`): its line is the answer to what it did.

And a run stopped by an `until` that never heard its line says when it was heard before, if it was: `...
in the 600 seconds its fight was given (321 passes). ... This line was heard at 1188.4 s, before the step
began: "The Watchers' hall is still. ..."`.

A test, whole:

```json
[
  { "look": -55 },
  { "button": "use", "ms": 200, "until": "The trial chest gives you blunt_lantern", "every": 1500 },
  { "goto": [272, 48, 36] },
  { "face": 0, "look": -5, "shot": "at_dummy" },
  { "mouse": "right", "ms": 250, "until": "You kindle the lantern", "shot": "kindled" },
  { "mouseDown": "left" },
  { "until": "holy damage", "within": 15000 },
  { "until": "The flame sinks", "within": 90000, "shot": "sunk" },
  { "mouseUp": "left" },
  { "expect": "HIT! .* holy damage" },
  { "expectNot": "Script Error|PAGE ERROR" }
]
```

## A run in sections

A long run is one file of steps in sections:

```json
[
  { "section": "terraces" },
  { "command": "trial get me maxhp", "until": "TRIAL get me maxhp", "keep": { "maxhp": "= ([\\d.]+)" } },
  { "fight": { "heal": 0.5, "chase": 60 }, "until": "The lower terrace falls quiet", "within": 900000 },
  { "until": "The hill shudders", "within": 15000, "onFail": "continue" },
  { "section": "travel" },
  { "goto": [2750, 1776, -152] },
  { "face": 0, "look": 0 },
  { "walk": 1500, "until": "Travel to next area", "within": 15000 },
  { "travel": "barrowroad", "shot": "arrived" },
  { "command": "trial get me maxhp", "until": "TRIAL get me maxhp" },
  { "expect": "TRIAL get me maxhp = ${maxhp}$", "since": "map" }
]
```

Each section is timed and counted. `summary.json` (and `summary` in the result) has, for each section and for
the run: its seconds, its steps, its fights and their seconds, its heals (a fight's, and each step whose
command is the profile's `play.heal`: `trial heal` outside a fight counts), its deaths, the hits taken and
dealt and their sums, the slain (all three by the profile's `play.fight` patterns, counted in what the game
said in the section), and its expectations held and failed; and each fight's seconds, heals, deaths, hits and
slain, with its section. `chain` adds up the runs since a map was last loaded: a run that stays (`--stay`)
goes on with the totals of the ones before it. The same is printed at the end of a run (a run that stayed
in the Barrow Road's hall with the First Warden, 2026-10-16: he marked the ground, struck and killed):

```
section (start) (step 1): 56.1 s, stopped; 4 steps; 0 fights; 1 heal, 1 death; taken 30 hits, 648.9 in all; dealt 0 hits, 0 in all; slain 0; expectations 0 held, 0 failed
the run: 56.1 s; 4 steps; 0 fights; 1 heal, 1 death; taken 30 hits, 648.9 in all; dealt 0 hits, 0 in all; slain 0; expectations 0 held, 0 failed
the 2 runs since the map was loaded: 119.4 s; 8 steps; 0 fights; 2 heals, 1 death; taken 30 hits, 648.9 in all; dealt 0 hits, 0 in all; slain 0; expectations 0 held, 0 failed
```

**Going on after a failure.** `--from <section|step>` (`run({ from })`) begins the steps at a section's step,
or at a step's number (1 is the first, and the section it is in is counted from there); the log says which
were not done. With `--stay` it goes on in the game where the run that stopped left the player:

```
smak play http://127.0.0.1:8098 --attach --stay --steps fullrun.json --from tomb -o work/fullrun-2
```

A step with `"onFail": "continue"` (or in a section whose step says so) does not stop the run when it fails: a
mere expectation ("the gate grinds open in 15 seconds") is held to and the run goes on to the next section.
Its failure is an expectation (`FAIL  step {...} (step 26): play: the game never said ...`) and the run ends
`FAIL` (before 0.27, `FAILED`).

**A way to another map.** `{ "travel": true }` does what the player does at a way out: the game asks
"Press (enter) to continue", the profile's command answers (`accept`), the next map's server starts, its files
come, and the card is clicked. The session follows the map it is in by the server's line
(`Spawn Server: barrowroad`), however the player got there, so a run that stays after a travel is in the map
the game is in.

## A fight

```json
[
  { "goto": [1812, 976, 36] },
  { "faceAt": [1872, 976, 30] },
  { "button": "use", "ms": 200, "until": "The altar sinks", "every": 1500 },
  { "fight": { "heal": 0.5, "post": [1812, 976, 36] }, "until": "The round tomb is quiet", "within": 900000 },
  { "expect": "^fight \\(step 4\\): .* 0 deaths" }
]
```

A `fight` goes round and round: it asks the game for the nearest living enemy (the profile's `play.target`),
turns the player's view to it (yaw and pitch, as `faceAt`), and strikes one blow (the profile's
`play.fight.attack`: for Master Sword a tap of the left button). It ends when its line comes (`until`, with
`within` as ever: the run stops if the line never comes) or after `for` milliseconds, which stops nothing. In
its object:

| Field | What it does |
| --- | --- |
| `radius` | how far round the player an enemy is looked for (768) |
| `heal` | a share of the player's health (`0.5`): under it he is healed by the profile's `play.heal`, once a wound |
| `post` | `[x, y, z]`: where he is put back (by the profile's `play.goto`) when he has died and risen |
| `chase` | a distance, the reach of a blow: an enemy farther off than it is walked at (+forward) before the blow, for as long as the way takes at 200 units a second (at most 1.5 s a round: one that keeps away is followed); one still over 100 beyond it, with nobody on the player, is not struck at. An enemy within it takes three blows a round before he is asked for again |
| `quiet` | milliseconds: the fight is over when no enemy has been found for that long, which stops nothing (a fight that has no line to wait for) |
| `attack` | the steps of one blow, for the profile's |
| `prefer` | a word of an enemy's name, or a list of them (`"lantern"`, `["lantern", "guard"]`): the enemy whose name holds the first word is struck first, wherever he stands within the radius; then the second word's; the nearest when nobody has one. Matched without regard to capitals. It needs the profile's `play.target.prefer` (below). One that four sidesteps got no nearer (behind others in a corridor) is let be for 20 seconds, the nearest fought meanwhile (the profile's `unprefer`), and then asked for again: `let be N times` in the line |
| `sidestep` | milliseconds of a step to the side (600), or `false` for none. With `chase`, when the enemy chased is held up (two blows swung at him landed on others in the way, or three rounds brought him no nearer by 16) the fight strafes that long, twice to one side and then twice to the other, and walks on |
| `dodge` | the pattern of a line that warns of a blow to a place, or `{ line, far, ms, hold }`. When it is heard the player steps away: from the place the line names in the groups `(?<x>...)` and `(?<y>...)` until he is `far` (150) off it, or (no place named, or he stands on it) to one side; at most `ms` (1500). For `hold` (2000) after it he strikes and does not chase, so as not to walk back in |
| `stuck` | `{ after, then }`, or `false`. An enemy the fight has spent `after` milliseconds on (30000, and four rounds at least) with no blow of the player's landing and without coming 16 nearer is **unreachable**, for every fight of the run until a map loads, and `then`: `"skip"` (passed over from then on, by the profile's `play.target.skip`), `"fail"` (the run stops at once, naming him and his place, with what is left), `"goto"` (the player put beside him by the profile's `goto`, once; then skipped) or `"ranged"` (shot at; skipped if eight shots and `after` bring nothing either). Unless told: `"ranged"` with a `ranged` that shoots the unreachable, `"skip"` otherwise. On unless told: `false` for none |
| `ranged` | an item's name, or `{ item, slot, when, hold, near, above, speed }`: a ranged weapon or spell the character carries (where the profile's `play.ranged.draw` takes it from: Master Sword, quickslot `slot`, 1). It is drawn for an enemy `when` says (`"unreachable"`, the default: one `stuck` found; `"flying"`: one whose middle is `above` (64) over the player's eyes; `"always"`; or a list), aimed at him (yaw and pitch, the pitch raised for the shot's fall when the profile gives the item's `speed` and the game's gravity), its button held `hold` ms (the profile's: 1400) and let go, again each round; an enemy within `near` (the chase, or 96) is struck instead, and the weapon put back (`play.ranged.back`) first |
| `quietEnds` | `true`: a fight with `until` and `quiet` that ends by its quiet (nobody left) without the line has ended all the same, and says so in a line of the log. Unless told, that **fails** the run: the area did not end as the steps thought |

**Choosing and moving.** A fight without these strikes whoever is nearest, never gets past a crowd and never
steps out of anything, so what it counts is the worst case. `prefer` goes for the healer first; `sidestep`
(on unless told, wherever `chase` is) gets round a front line to it; `dodge` steps out of a marked place.
**A dodge by a line is an aid for tests only**: a game that shows its warning as a picture (Master Sword's
First Warden marks the ground with a sprite and says nothing) is heard by a test only through a copy of the
monster's script that says it (`WARDEN marks the ground under <name> at <x> <y>` in msr-web's test copy). A
player sees the sprite; the bot hears the line. What a fight with `dodge` counts is how a player who sees
every mark fares. No `block`: Master Sword says nothing before a blow lands (its lines come after the hit),
so there is nothing to block on; a profile cannot name a warning that is not there.

**An enemy it cannot get at.** In a run of 98 minutes a wolf in a fenced pen took 900 s of a fight, a spider
60 to 190 units off was sidestepped for six minutes, and a fleeing Lantern-bearer ate a fight of 400 s: each
fight struck the air until its time ran out. Now the fight keeps, for each enemy it turned to, the time spent on
him for nothing, and past `stuck.after` says so as a line of the kind `fight` (`step 9: 7 rounds on an
unreachable Wolf at (780,1322,0) (12 s with no blow landing and no nearer): passed over from now on`) and does
what `then` says. A game that cannot be told to skip one (no `play.target.skip`) has its answers of him taken
for none: the fight goes on to its `quiet`, or to its `until`'s end, where the census says who is left.

**At range.** `ranged` is the owner's way past ledges, fences and flyers: the character's bow (or a spell) is
drawn when an enemy cannot be struck, shot until he falls or comes within `near`, and put back for the blows.
Each shot is aimed a little over or under the last (0, +10, -10, +5, -5, +14, -14 units): Master Sword leaves an
arrow stuck in its target for ten seconds, and the next one loosed along the same line strikes that and not
him. What it came to is in the fight's line (`; ranged (bows_thornbow): 28 shots, 13 hits, drawn 1 time`) and
`result.json`'s `ranged: { item, shots, hits, draws }`; each draw and each putting back is a line of the kind
`fight` (`step 10: drew bows_thornbow`, `step 10: put bows_thornbow back, for the blows`). Seen in the game
(2026-10-16): a fighter shut in a hay pen, a sentry 520 off over its fence, found unreachable after 12 s and
shot dead (13 hits of 28 shots); then a wolf that ran at him shot at once and struck down with the sword.

**Ended by its quiet, without its line.** A fight with `until` and `quiet` that runs out of enemies without
the line used to pass in silence, and the run went on in an area that had not ended. It now fails, and says
what is left (`... the game never said /The terrace falls quiet/: the area did not end as the steps thought
(quietEnds: true takes the quiet for its end). left: Wolf 114 hp at (780,1322,0), 1 of 1.`); with `quietEnds`
it passes with a line `NOTE step 5: the fight ended by its quiet ..., and the game never said its line: taken
for its end (quietEnds). left: ...` (the pattern is left out of a line a later `until` could stop at).

**What is left.** Where the profile can count the monsters (`play.census`), a run stopped by an `until` that
never came, a fight that ended without its line, and a `stuck: "fail"` each end their sentence with a census
done then: `left: Wolf 114 hp at (780,1322,0), 1 of 1` (the enemies, up to six of them, and how many there are).

What happened is a line in the log, of the kind `fight` (an `expect` can be held to it), printed at the end
of the run, and `fights` in `result.json`, counted by the profile's patterns of the game's lines:

```
fight (step 12): 129.4 s, ended by the line "The round tomb is quiet at last. ..."; 97 blows in 97 rounds;
dealt 80 hits, 776.5 in all (0.62 hits a second), 11 missed; taken 500 hits, 4009.5 in all (30.99 a second);
19 heals, 0 deaths; slain 5: the Enraged Skeleton x2, the Fallen Knight, the Awakened Guardian x2; enemies at
once: 5 at most, 3.53 on average; on the player: 5 at most, 3.36 on average; health 104 at its least of 339
```

With `prefer`, `chase`, `dodge`, `ranged` or an enemy found unreachable the line goes on: `; preferred (lantern): 2 of the 3 slain, faced in 60
of 98 rounds, let be 1 time (not got at); 3 sidesteps round others in the way; dodged 9 of 11 warnings (2 heard off the place already)`,
and `result.json`'s fight has `prefer: { words, slain, rounds, letBe }`, `sidesteps` and `dodge: { warned, dodged,
clear }`. Each sidestep and each dodge is a line of the log (`step 4: a sidestep to the right, round what
stands between him and Lantern-bearer (212.4 off)`, `step 4: dodged "WARDEN marks the ground under Deoroot at
1700 1950": from 12.3 to 151.6 off 1700 1950 in 700 ms`). The unreachable are `unreachable: [{ name, at, rounds,
seconds, then }]` (`; unreachable: Wolf at (780,1322,0) after 7 rounds (passed over)`), and a fight that ended by
its quiet without its line has `unended` (its pattern) and says `ended by no enemy being left, WITHOUT its line`.

`enemies at once` are those the game counted within the radius each time it was asked; `on the player` those
it counts as on him (Master Sword's helper: within 128), when the profile reads such a count. A death is the
profile's `died` line; the fight then waits for the player's health to come back (he has risen) with its
blows going on (a game may want a button to rise), and puts him at `post`.

An expectation that does not hold does not stop the run: every one is looked at, and the run ends `FAIL` (`FAILED`
before 0.27) with the ones that failed on a line each above it (`FAIL  expect /.../ (step 10): no such line was
heard`), and every one in `told.txt` (`PASS  expect /.../ (step 10): the line that decided`). A line an `until` waited for in
vain does stop it: the steps after it would be done in a game that is not where they think.

## What is heard

`log.txt` has a line for everything, with its seconds from the run's start and its kind:

```
[   13.668] HUDInfoMsg ent_owner CHARGEPROBE blunt begin
[   13.877] HUDInfoMsg You attack a Trial Dummy. (61/0) HIT! 35.5 blunt damage.
[   14.584] TextMsg    TRIAL get target haseffect = 0
[   15.002] console    [19:22:41] Host_EndGame: disconnected from server
[   15.100] where      where gate: origin 512 96 36, yaw 90, pitch -30
[   15.101] play       15.0 s    0.1 s  {"where":"gate"}
```

- `console`: the page's console, which is the engine's; `error`: an error of the page (`PAGE ERROR: ...`).
- **A message's name**: what the server told the player. A GoldSrc game speaks to its players in "user
  messages": HUD text, hints, chat. The browser driver listens to the ones the profile names, in the engine's
  own table of them, and the profile reads their bytes (`play.messages`). The SDK's two, `TextMsg` (what a
  script or the game prints to a player's console or the middle of his screen) and `SayText`, are read for
  any game. Nothing of the game is changed for this (`cli/play-browser.mjs` says how it is done).
- `where`: a `where` step's answer. `fight`: what a fight came to. `play`: the run's own notes (each step as
  it ended, each expectation, how often a block went round); these are never matched by an `until` or an
  expectation.

`log.jsonl` is the same, one JSON object a line: `{ "t": 13.877, "time": "2026-10-13T19:22:55.012Z", "kind":
"HUDInfoMsg", "text": "..." }`.

What is NOT heard: what a game draws without telling (a health bar's length, a model's animation), and what a
build prints nowhere (Master Sword's script command `dbg` is compiled out of a release build; `consolemsg`
and the `playermessage` family are heard).

## The profile's part

Everything that is one game's is the `play` field of its profile (`docs/MAPS-MAKING.md`, "A mod's profile"):

```js
play: {
  enter: [{ click: [512, 330], every: 1000, until: "^Welcome to Master Sword", within: 60000 }],
  say: ["cmd say_text 1 {text}"],
  loads: 90000,                                    // the longest a map is given to load
  loaded: "Custom resource propagation complete",  // the line that says it has: waited for, not the clock
  travel: { commands: ["accept"], spawned: /Spawn Server: (\S+)/ },  // through a way to another map, and the line of its server
  goto: ["trial goto {x} {y} {z}"],                // the game's command that puts the player at a place, if it has one
  heal: ["trial heal"],                            // the command that gives his health back, if it has one
  target: {                                        // how the nearest living enemy is found, if the game can say
    commands: ["trial nearest {radius}"],
    answer: /^TRIAL nearest (?<id>\S+) hp (?<hp>\S+) at \((?<x>[-\d.]+),(?<y>[-\d.]+),(?<z>[-\d.]+)\) far (?<far>\S+) count (?<count>\d+) close (?<close>\d+) name (?<name>.*)$/,
    none: /^TRIAL nearest none/,
    prefer: ["trial prefer {word}"],               // the commands after which the answer is the nearest whose name holds {word}
    unprefer: ["trial prefer none"],               // and those that undo it (sent when a fight that preferred ends)
    skip: ["trial skip {id}"],                     // the commands after which the answers pass over the enemy {id} (stuck)
  },
  lift: 4,                                         // units a goto puts the player over the place asked: he drops onto it
  census: {                                        // the living monsters within {radius}: a census step, and a failure's "left:"
    commands: ["trial census {radius}"],
    count: /^TRIAL census (?<count>\d+) within/,
    one: /^TRIAL census one (?<name>.*) hp (?<hp>\S+) at \((?<x>[-\d.]+),(?<y>[-\d.]+),(?<z>[-\d.]+)\) relate (?<relate>\S+)$/,
  },
  ranged: {                                        // a ranged weapon drawn ({item}, kept in {slot}), and put back
    draw: ({ item, slot }) => ["cmd quickslot create 9 current", `+quickslot ${slot}`, `-quickslot ${slot}`],
    back: ["+quickslot 10", "-quickslot 10"],
    held: { commands: ["trial hands {item}"], answer: /^TRIAL hands \S+ (?<held>[01])$/ },  // is it in his hands?
    hold: 1400, drawn: 1000, button: "attack",      // the draw held, the hands' time, the button (a mouse's, or +attack)
    speeds: { bows_thornbow: 1700, bows_longbow: 2100 }, gravity: 580,  // a far shot aimed higher for its fall
  },
  fight: {                                         // a blow, and the lines a fight is counted by
    attack: [{ tap: "left", ms: 200, every: 700 }],
    dealt: /^You attack .*HIT! ([\d.]+)/, missed: /^You attack .*MISS!/, taken: / attacks you\..*HIT! ([\d.]+)/,
    slain: /^You've slain (.*)$/, died: / has fallen!$/, health: /^HP (\d+)$/, maxHealth: /^MaxHP (\d+)$/,
  },
  messages: { HUDInfoMsg: hudInfoLines, TextMsg: "textmsg", SayText: "saytext" },
  eye: 28, yawspeed: 210, screen: [1024, 768],
}
```

`target` may instead be a function `({ radius, command, heard, view, prefer })` that resolves to `{ origin: [x, y, z],
name, hp, far, count, close }` or null: a game whose engine can be asked another way. Its `answer` names the
place to aim at in the groups `x`, `y`, `z` (the middle of the enemy, for a blow); the rest are read when they
are there.

`messages` gives each user message the way its bytes are read: `"textmsg"`, `"saytext"`, `"strings"` (every
string in it, for a message whose layout you do not know yet), or a function of the bytes that gives a line,
several, or nothing. To find a game's messages: its server registers them by name (`REG_USER_MSG`), and
`"strings"` on a name shows what it carries. `profiles/mastersword.mjs` is a whole example, with where each
fact is from.

With no profile (`GOLDSRC`) nothing is clicked to enter, a thing is said with `say`, the engine's own line is
waited for, `TextMsg` and `SayText` are read, and a `goto` step is refused: the engine has no command that
puts a player at a place. The eyes are 28 above the origin and a blow is `+attack`; a `fight` and `faceAt:
"target"` are refused, for the engine says nothing of where an enemy is.

## From a script

```js
import { play } from "./smak/src/index.mjs";
const driver = play.browserDriver({ url, playwright: "C:/tools/browser", messages: play.messagesOf(mod) });
const session = play.playSession({ driver, mod });
const first = await session.run({ map: "yard", steps, out: "work/first", expect: ["holy damage"] });
const second = await session.run({ map: "road", steps: more, out: "work/second" });
await session.close();
first.passed; first.expectations; first.lines; first.pictures; first.sheet;
```

`play.play({ driver, map, steps, out, mod })` is one run with the driver closed after it.
`play.serveSession({ session, port })` and `play.attachSession(address, run)` are the session shared between
processes. `play.sheetOf(files, { cols, shrink })` is the sheet by itself. A driver of your own is a plain
object (`ready, command, keyDown, keyUp, press, click, wait, shot, log, close`); with `lines(from)` it can be
waited on and expected of, with `view()` and `look()` it turns exactly, with `mouseDown`/`mouseUp`, `put` and
`leave` it does the rest.

## When it does not work

| What you see | Why, and what to do |
| --- | --- |
| `the map X had not loaded after N seconds: the game never said /.../` | The map did not load. The last lines heard are in the sentence and in `log.txt`: a missing file, a map with no place to put a player |
| `the game never said /Welcome.../ ... (at the profile's enter step 1)` | The menu was not got through. Open `00_loaded.png`: is the menu where the profile clicks? |
| `the game never said /.../ in the N seconds it was given` | The line did not come. The sentence ends with the last lines that did: is the pattern right (capitals, a full stop), is the thing in reach? |
| `the player was to be put at ... and is at ...` | The profile's `goto` command did nothing: this map does not have it |
| `the view cannot be read: this build of the engine does not export pfnSPR_Load...` | The view cannot be read or set in this build. A `turn` is then by time (the game's `+left` held: about right only, and the log says so); `face`, `look` and `where` stop the run |
| A message named in the profile is never heard | It is not in the engine's table (the game does not register it), or the game's client takes it by no function. `driver.unheard()` lists them |
| A new item, or a script's new model, is not there after `--put` | The game read its list once, when it started: close the session and start it again |
| `the game never said /x/ in the N seconds its repeat was given (P passes)` | A `repeat` (or a `fight`) with `until` alone ran out of `within`. Give `for` or `times` beside `until` for a block that may end without its line |
| `the game did not answer "trial nearest 768" ... (the profile's play.target)` | The map has not the command that finds an enemy: for Master Sword, the trial helper script (tools/playtest.mjs adds it to any map's map_startup) |
| `step 9: 7 rounds on an unreachable Wolf at (...)` | The fight could not get at him (a fence, a ledge, one who flees): give `ranged` (and carry the weapon), `stuck: { then: "goto" }` to put the player beside him, or `"fail"` to stop there; `stuck: false` strikes on, as 0.15 did |
| `... and the game never said /x/: the area did not end as the steps thought (quietEnds: ...)` | Nobody was left within the radius and the line never came: the census at its end says who is left and where. Widen `radius`, or say `quietEnds: true` where the quiet is the end |
| `did not move after walk N ms: in solid? (origin ...)` | The player is set into a brush (a `goto` at a floor's own height, a place inside a wall): `goto` a few units higher (the profile's `lift`), or elsewhere |
| `step 4 drew bows_thornbow (...) twice, and it is not in the player's hands` | The character does not carry it where the profile's `play.ranged.draw` takes it from: Master Sword's test characters keep their bow in quickslot 1 (msr-web maps/trial/chars) |
| A fight lands few blows | `chase` an enemy that keeps off; a `radius` that takes in enemies behind a wall aims at them. The log has the answer of each `target` asked, and `enemies at once` says how many there were |
| A held mouse button does nothing in the game | It charges a blow: `tap` |
| A change to the kit (or to a profile) does nothing in `--attach` runs | The steps are done by the serving process, with the code it started with: close the session and serve it again |
| A fight waited out its `within` for a line said a minute before it began (0.15 and before) | Its area fell quiet while another was fought. 0.16 looks back as a step begins: a fight ends at once (`already`), a wait warns, and a run stopped by an `until` says when its line was heard before |
| `--stay` after a way to another map says the game is in the map before (0.15 and before) | The session took its map from the last `map` it loaded. 0.16 follows the server's line (`Spawn Server: <map>`, the profile's `play.travel.spawned`) |
| `step 12 names ${hp}, and no step before it has kept a value of that name` | The step that keeps it (`keep`) was not done in this session: a run `--from` after it, in a new session. Begin at the step that keeps it |
| `FAILED: terminated` after five minutes (0.14 and before) | `fetch` gave up on a long run's answer. 0.15 reads it with no limit; update the kit |
| `play: the session at ... went away during the run (ECONNRESET)` | The serving process ended in the run (closed, killed, out of memory). Its `session.log`, or the terminal that serves, says why |
| `step 4 prefers an enemy, and the profile names no way to ask the game for one` | The profile's `play.target` has no `prefer` commands: the game cannot be asked. Add them, or a `target` function that takes `prefer` |
| A fight with `prefer` strikes the others all the same | The preferred one is out of reach behind them: give `chase` (and its sidesteps). Or the word is not in his name as the game says it (`trial nearest`'s `name`) |
