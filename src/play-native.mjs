// A driver for `play` (src/play.mjs) that plays the person's own GoldSrc game, the one Steam installs, by its
// console: no browser, and no key pressed or mouse moved unless the person has said yes (below).
//
//   import { play } from "./smak/src/index.mjs";
//   const driver = play.nativeDriver({ mod: "ts" });   // the Half-Life folder found as findHalfLife finds it
//   const run = await play.play({ driver, map: "ts_lobbyduel", out: "work/seen", mod, steps });
//
// WHERE THE FACTS ARE FROM. Measured 2026-10-24 on Steam's Half-Life (build 8684) with The Specialists:
//   - the game is started as `hl.exe -game <mod> -insecure -windowed -w <w> -h <h> -condebug +exec <cfg>`.
//     `-insecure` keeps it off VAC; the driver never joins a server (`connect` and `retry` are refused);
//   - `-condebug` writes the console to `qconsole.log` in the Half-Life folder (not the mod's), and each start
//     ADDS to the file: a run reads what follows the size it had when the game was started;
//   - the engine reads no commands from outside while it runs. So the `.cfg` it starts with keeps a loop:
//     `alias smak_poll "exec smak_in.cfg; wait; ...; smak_poll"`, which reads the file `smak_in.cfg` every few
//     frames, from the menu and across a map's load. A command is put in a file of its own, `smak_<n>.cfg`, run
//     by the alias `smak_g<n>` that `smak_in.cfg` names; that file empties its own alias as it ends and gives
//     the next one, so a command runs once however often the loop reads `smak_in.cfg`, and says
//     `SMAK_ACK <n>` when it has. It answers in 0.1 to 0.2 seconds;
//   - `exec` is not echoed to the console, so the loop leaves nothing in the log;
//   - `status` names the player (`# 1 "name" ...`) once he is in the map: that is how the driver knows a
//     `map` has loaded (the line Xash says, "Custom resource propagation complete", Steam's game does not);
//   - `screenshot` writes `HalfLife<nn>.tga` (24 bits, rows from the bottom) in the mod's folder and says
//     `Wrote HalfLife<nn>.tga`: the picture is the game's own, at the window's size;
//   - `quit` closes it.
// Without Steam running was not tried. The game writes the person's binds and settings to the mod's
// config.cfg as it quits, so a step's `bind` would stay theirs: the driver keeps the file as it was before the
// run and puts it back. Two starts in seven of ts_lobbyduel ended by themselves (code 0, no line, no dump) as
// the player connected; Neuropolis never did. The run then says the game ended.
//
// THE SPECIALISTS lets the player in ("Press Fire To Play!") by the key bound to +attack, read by its client
// library, and not by `+attack` from the console ("MOUSE1 is unbound"): its player stays a spectator here.
// `slot7` takes the buy menu's Random and closes it.
//
// What it has not: `view` and `look` (the console tells where the player stands, `status`, and not where he
// looks). A walk (`+forward`) and a turn by time are console commands and work.
//
// KEYS AND THE MOUSE (docs/history/PLAN.md, 3c), only when told `input: true`, which the person has said yes to: real keys
// and buttons sent to the game's window by src/play-window.mjs, while it is in front and the person's hands
// are off the machine. The first waits for the keyboard and mouse to be left alone `quiet` milliseconds; the
// person touching either after that stops the run, and what was held is let go. Without `input`, a step that
// presses a key or clicks says how it could be done.
//
// PICTURES OF THE WINDOW (docs/history/PLAN.md, 3b): `pictures: "window"` takes each picture of the window, as the person
// sees it, in place of the game's `screenshot`; and a game that does not answer is said with its windows (the
// text of a box it shows: "Fatal Error", a missing file).
import { spawn as spawnProcess } from "node:child_process";
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync, openSync, readSync, closeSync, readdirSync } from "node:fs"; // prettier-ignore
import { join } from "node:path";
import { png } from "./image.mjs";
import { findHalfLife } from "./maps/games.mjs";
import { KEY_NAMES, scanOf, windowHelper } from "./play-window.mjs";

/** The line the driver says once the player is in a map it loaded: `play` waits for it (`driver.loaded`). */
export const NATIVE_LOADED = /^SMAK entered (\S+)$/;
/** Frames the console loop waits between two readings of its file. */
const LOOP_FRAMES = 5;
/** How often the log is read while a line is waited for, and how often `status` asks whether a map is in. */
const READ_EVERY = 100;
const ASK_EVERY = 1000;
/** The commands that would join a server: never sent. */
const JOINS = /^\s*(connect|retry|redirect)\b/i;
/** The driver's own lines in the log: the loop's answers, and what it asked itself. */
const ACK = /^SMAK_(ACK|UP|ASK|ASKED)\b/;

const shown = (value) => (value === undefined ? "nothing" : JSON.stringify(value));
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
/** A line as the console wrote it, with the colour codes and what is not print taken out. */
const clean = (text) => text.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, "").trim();

/**
 * A GoldSrc screenshot (a TGA: uncompressed or run-length, 24 or 32 bits, from the bottom or the top) as a
 * PNG's bytes.
 */
export function pngOfTga(bytes) {
  const type = bytes[2];
  const width = bytes.readUInt16LE(12);
  const height = bytes.readUInt16LE(14);
  const depth = bytes[16] / 8;
  const fromTop = (bytes[17] & 0x20) !== 0;
  if (![2, 10].includes(type) || ![3, 4].includes(depth) || !width || !height)
    throw new Error(`play: a screenshot is a TGA of 24 or 32 bits in colour (type 2 or 10), not type ${type} of ${bytes[16]} bits`); // prettier-ignore
  const pixels = new Uint8Array(width * height * depth);
  let at = 18 + bytes[0];
  if (type === 2) bytes.copy(pixels, 0, at, at + pixels.length);
  else
    for (let put = 0; put < pixels.length; ) {
      const head = bytes[at++];
      const count = (head & 0x7f) + 1;
      if (head & 0x80) {
        for (let k = 0; k < count; k++) bytes.copy(pixels, put + k * depth, at, at + depth);
        at += depth;
      } else {
        bytes.copy(pixels, put, at, at + count * depth);
        at += count * depth;
      }
      put += count * depth;
    }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const from = ((fromTop ? y : height - 1 - y) * width + x) * depth;
      const to = (y * width + x) * 4;
      rgba[to] = pixels[from + 2];
      rgba[to + 1] = pixels[from + 1];
      rgba[to + 2] = pixels[from];
      rgba[to + 3] = 255;
    }
  return png(width, height, rgba);
}

/** The `.cfg` the game starts with: the alias of the first command, and the loop that reads `smak_in.cfg`. */
export function startCfg(frames = LOOP_FRAMES) {
  return [
    'alias smak_g1 "exec smak_1.cfg"',
    `alias smak_poll "exec smak_in.cfg; ${"wait; ".repeat(frames)}smak_poll"`,
    "echo SMAK_UP",
    "smak_poll",
    "",
  ].join("\n");
}

/** The file of the command numbered `n`: the command, its alias emptied, the next one's given, its answer. */
export function commandCfg(n, text) {
  return [text, `alias smak_g${n} ""`, `alias smak_g${n + 1} "exec smak_${n + 1}.cfg"`, `echo SMAK_ACK ${n}`, ""].join("\n"); // prettier-ignore
}

/**
 * A driver for `play` that plays the installed game:
 *   halfLife   the Half-Life folder (unless told: SMAK_HALF_LIFE, or Steam's libraries, as findHalfLife)
 *   mod        the game's folder in it, as `-game` takes it ("valve", "ts", "msc")
 *   exe        the program (hl.exe in that folder)
 *   width, height   the window (1024 by 768); the pictures are its size
 *   args       more of the game's arguments, put before `+exec`
 *   readyWithin, enterWithin, answerWithin   milliseconds the game is given to start (90 s), a map to let the
 *              player in (120 s), and a command to be taken (20 s)
 *   input      true: real keys and mouse buttons may be sent to its window (the person has said yes)
 *   quiet, quietWithin   milliseconds the keyboard and mouse are to be left alone before the first input
 *              (5000), and how long that is waited for, with the game's window in front (60 s)
 *   pictures   "console" (the game's own `screenshot`) or "window" (the window, as the person sees it)
 *   spawn      how a program is started (node's own; a test's fake engine)
 *   windows    how the window helper is made (src/play-window.mjs's; a test's fake)
 * `ready()` starts the game, `command(text)` runs a console command and resolves when it has run (a `map`
 * when the player is in it, saying `SMAK entered <map>`), `shot(file)` writes the game's own screenshot as a
 * PNG, `lines(from)` gives what the console said, `close()` quits the game (or ends its process, by its own
 * id) and takes the driver's files out of the mod's folder.
 */
export function nativeDriver({
  halfLife,
  mod = "valve",
  exe = "hl.exe",
  width = 1024,
  height = 768,
  args = [],
  readyWithin = 90000,
  enterWithin = 120000,
  answerWithin = 20000,
  input = false,
  quiet = 5000,
  quietWithin = 60000,
  pictures = "console",
  spawn = spawnProcess,
  windows = windowHelper,
} = {}) {
  const fail = (sentence) => {
    throw new Error(`play: ${sentence}`);
  };
  if (typeof mod !== "string" || !/^[\w.-]+$/.test(mod))
    fail(`mod is the game's folder in the Half-Life folder, as -game takes it ("ts"), not ${shown(mod)}`);
  if (![width, height].every((side) => Number.isInteger(side) && side > 0))
    fail(`width and height are whole numbers of pixels, not ${shown(width)} by ${shown(height)}`);
  if (!(Array.isArray(args) && args.every((each) => typeof each === "string")))
    fail(`args is a list of the game's arguments, not ${shown(args)}`);
  if (!["console", "window"].includes(pictures))
    fail(`pictures are "console" (the game's screenshot) or "window" (its window), not ${shown(pictures)}`);
  const game = halfLife ?? findHalfLife({ mod });
  if (!game)
    fail(`no Half-Life with ${mod} in it was found in Steam's libraries: name its folder (halfLife, --half-life, or SMAK_HALF_LIFE)`); // prettier-ignore
  const folder = join(game, mod);
  const program = join(game, exe);
  const logFile = join(game, "qconsole.log");
  const heard = [];
  let child = null;
  let exited = null;
  let offset = 0;
  let rest = "";
  let next = 1;
  /** The lines between the driver's own SMAK_ASK and SMAK_ASKED are its own too. */
  let asking = false;
  /** The person's settings as the game had them before the run: a `bind` or a setting a step changes is
   * saved into config.cfg as the game quits, and put back as it was. */
  const settings = join(folder, "config.cfg");
  let kept = null;

  /** The window helper, for the game's process: made the first time it is wanted. */
  let helper = null;
  /** Whether the first input was waited for (the hands off, the window in front). */
  let inputReady = false;
  const window = () => (helper ??= windows({ pid: child.pid, quiet }));
  const note = (kind, text) => heard.push({ at: Date.now(), kind, text });
  const read = () => {
    if (!existsSync(logFile)) return;
    const size = statSync(logFile).size;
    if (size <= offset) return;
    const bytes = Buffer.alloc(size - offset);
    const handle = openSync(logFile, "r");
    try {
      readSync(handle, bytes, 0, bytes.length, offset);
    } finally {
      closeSync(handle);
    }
    offset = size;
    const parts = (rest + bytes.toString("latin1")).split(/\r?\n/);
    rest = parts.pop();
    for (const part of parts) {
      const text = clean(part);
      if (!text) continue;
      if (/^SMAK_ASK\b/.test(text)) asking = true;
      note(ACK.test(text) || asking ? "play" : "console", text);
      if (/^SMAK_ASKED\b/.test(text)) asking = false;
    }
  };
  /** Waits for a line from `from` on that matches: the line, or null when `within` ran out or the game ended. */
  const waitFor = async (pattern, from, within) => {
    for (let waited = 0; ; waited += READ_EVERY) {
      read();
      const line = heard.slice(from).find((each) => pattern.test(each.text));
      if (line || waited >= within || exited !== null) return line ?? null;
      await pause(READ_EVERY);
    }
  };
  const ended = () => (exited !== null ? ` The game ended (${exited}).` : "");
  /** What the game's windows show, for a sentence that says it did not answer: a box's text above all. */
  const shows = async () => {
    if (!child?.pid || exited !== null || (process.platform !== "win32" && windows === windowHelper)) return "";
    try {
      const seen = (await window().ask("windows")).windows ?? [];
      if (!seen.length) return " It shows no window.";
      return ` It shows ${seen.map((each) => `${each.cls === "#32770" ? "a box" : "a window"} ${shown(each.title)}${each.text ? ` saying ${shown(each.text)}` : ""} (${each.w} by ${each.h})`).join(", ")}.`; // prettier-ignore
    } catch {
      return "";
    }
  };
  const lastSaid = (from) => {
    const said = heard.slice(from).filter((each) => each.kind === "console").slice(-4);
    return said.length ? ` The last it said: ${said.map((each) => shown(each.text)).join(", ")}` : "";
  };
  /** A command put in the loop's file; resolves to where in `heard` its answer is. */
  const send = async (text) => {
    if (!child) fail("the game is not started: ready() comes first");
    if (exited !== null) fail(`the game has ended (${exited}): ${shown(text)} was not run`);
    const n = next++;
    const from = heard.length;
    writeFileSync(join(folder, `smak_${n}.cfg`), commandCfg(n, text));
    writeFileSync(join(folder, "smak_in.cfg"), `smak_g${n}\n`);
    const answer = await waitFor(new RegExp(`^SMAK_ACK ${n}$`), from, answerWithin);
    if (!answer)
      fail(`the game did not take ${shown(text)} in ${answerWithin / 1000} seconds: its console loop stopped (a command it ran with no end?).${ended()}${await shows()}${lastSaid(from)}`); // prettier-ignore
    return heard.indexOf(answer);
  };
  /** Asks `status` until it names a player: resolves once he is in. */
  const entered = async (name, from) => {
    for (let waited = 0; waited < enterWithin; waited += ASK_EVERY) {
      const before = heard.length;
      const at = await send("echo SMAK_ASK; status; echo SMAK_ASKED");
      if (heard.slice(before, at).some((each) => /^#\s*\d+\s+"/.test(each.text))) {
        note("console", `SMAK entered ${name}`);
        return;
      }
      await pause(ASK_EVERY);
    }
    fail(`the player was not in ${name} ${enterWithin / 1000} seconds after it was asked for: is it in the mod's maps folder?${lastSaid(from)}`); // prettier-ignore
  };
  /** Before the first input: the game's window in front, and the keyboard and mouse left alone. */
  const readyForInput = async () => {
    if (!input)
      fail('a key or the mouse is sent to the Steam game only with input: true (--input), once the person has said yes: it takes their keyboard and mouse while the run lasts. Otherwise use console commands (a walk, a turn by time, "command")'); // prettier-ignore
    if (!child) fail("the game is not started: ready() comes first");
    if (exited !== null) fail(`the game has ended (${exited})`);
    if (inputReady) return;
    let state = {};
    for (let waited = 0; waited < quietWithin; waited += 250) {
      state = await window().ask("state");
      if (state.window && state.front && state.idle >= quiet) {
        inputReady = true;
        return;
      }
      await pause(250);
    }
    fail(
      !state.window
        ? `the game shows no window to send keys to${await shows()}`
        : !state.front
          ? `the game's window was not in front for ${quietWithin / 1000} seconds, and keys go to it only there: click on it, then leave the keyboard and mouse alone ${quiet / 1000} seconds`
          : `the keyboard or the mouse was in use for ${quietWithin / 1000} seconds, and keys are sent only once they have been left alone ${quiet / 1000} seconds`,
    );
  };
  /** An input sent, or the run stopped by why it may not be. */
  const sent = async (line) => {
    const answer = await window().ask(line);
    if (answer.refused) {
      await window().ask("release").catch(() => {});
      fail(
        answer.refused === "person"
          ? "the person used the keyboard or the mouse during the run, so no more keys are sent (what was held is let go): run it again with the hands off"
          : "the game's window is no longer in front, and keys go to it only there (what was held is let go)",
      );
    }
    if (answer.error) fail(`the game's window could not be sent ${shown(line)}: ${answer.error}`);
  };
  const keyOf = (key) => {
    const scan = scanOf(key);
    if (!scan) fail(`${shown(key)} is no key the driver knows: ${KEY_NAMES}`);
    return `${scan.code} ${scan.extended ? 1 : 0}`;
  };
  const buttonOf = (button) => {
    if (!["left", "right", "middle"].includes(button))
      fail(`a button of the mouse is left, right or middle, not ${shown(button)}`);
    return button;
  };
  const windowShot = async (file) => {
    if (!child) fail("the game is not started: ready() comes first");
    const answer = await window().ask(`shot ${file}`);
    if (answer.error) fail(`no picture of the game's window: ${answer.error === "minimised" ? "it is minimised" : answer.error}${await shows()}`); // prettier-ignore
    // a window all black is a picture of nothing: what the graphics card drew did not reach it
    if (answer.mean < 1) fail(`the picture of the game's window came out black (${answer.how}): is it covered, or on another desktop?`); // prettier-ignore
  };
  const ours = () => (existsSync(folder) ? readdirSync(folder).filter((name) => /^smak_(\d+|in|run)\.cfg$/.test(name)) : []); // prettier-ignore

  return {
    loaded: NATIVE_LOADED,
    logFile,
    async ready() {
      if (!existsSync(program)) fail(`there is no ${exe} in ${game}`);
      if (!existsSync(folder)) fail(`there is no ${mod} in ${game}: the mod's folder, as -game takes it`);
      for (const name of ours()) unlinkSync(join(folder, name));
      kept = existsSync(settings) ? readFileSync(settings) : null;
      offset =existsSync(logFile) ? statSync(logFile).size : 0;
      writeFileSync(join(folder, "smak_in.cfg"), "");
      writeFileSync(join(folder, "smak_run.cfg"), startCfg());
      const given = ["-game", mod, "-insecure", "-windowed", "-w", String(width), "-h", String(height), "-condebug", ...args, "+exec", "smak_run.cfg"]; // prettier-ignore
      child = spawn(program, given, { cwd: game, stdio: "ignore" });
      child.on("exit", (code) => (exited = code ?? "ended"));
      child.on("error", (error) => (exited = error.message));
      const up = await waitFor(/^SMAK_UP$/, 0, readyWithin);
      if (!up)
        fail(`the game did not come up in ${readyWithin / 1000} seconds: it never ran smak_run.cfg.${ended()}${await shows()} Is Steam running?${lastSaid(0)}`); // prettier-ignore
    },
    async command(text) {
      if (typeof text !== "string" || !text.trim() || /[\r\n]/.test(text))
        fail(`a command is one line of the console, not ${shown(text)}`);
      if (JOINS.test(text)) fail(`${shown(text)} would join a server, and a run only ever plays its own`);
      const from = heard.length;
      await send(text);
      const map = /^\s*(?:map|changelevel)\s+(\S+)/i.exec(text);
      if (map) await entered(map[1], from);
    },
    async keyDown(key) {
      const scan = keyOf(key);
      await readyForInput();
      await sent(`key down ${scan}`);
    },
    async keyUp(key) {
      // let go whatever happened before: a key is never left down
      if (helper) await sent(`key up ${keyOf(key)}`);
    },
    async press(key) {
      const scan = keyOf(key);
      await readyForInput();
      await sent(`key down ${scan}`);
      await pause(60);
      await sent(`key up ${scan}`);
    },
    async click(x, y) {
      if (![x, y].every(Number.isFinite)) fail(`a click is at a place of the window, in its pixels, not ${shown([x, y])}`); // prettier-ignore
      await readyForInput();
      await sent(`move to ${Math.round(x)} ${Math.round(y)}`);
      await sent("button down left");
      await pause(60);
      await sent("button up left");
    },
    // without input there is no mouse: a step that holds a button is refused before the game is started
    ...(input && {
      async mouseDown(button) {
        const which = buttonOf(button);
        await readyForInput();
        await sent(`button down ${which}`);
      },
      async mouseUp(button) {
        if (helper) await sent(`button up ${buttonOf(button)}`);
      },
    }),
    wait: (ms) => pause(ms),
    async shot(file) {
      if (pictures === "window") return windowShot(file);
      const before = heard.length;
      await send("screenshot");
      const wrote = await waitFor(/^Wrote (\S+\.(?:tga|bmp))$/i, before, answerWithin);
      if (!wrote) fail(`the game wrote no screenshot in ${answerWithin / 1000} seconds${lastSaid(before)}`);
      const name = /^Wrote (\S+)$/i.exec(wrote.text)[1];
      const made = [join(folder, name), join(game, name)].find((each) => existsSync(each));
      if (!made) fail(`the game said it wrote ${name}, and it is not in ${folder}`);
      if (!/\.tga$/i.test(name)) fail(`the game wrote ${name}: a screenshot is read as a TGA`);
      writeFileSync(file, pngOfTga(readFileSync(made)));
      unlinkSync(made);
    },
    /** The game's window, as the person sees it, written as a PNG (`pictures: "window"` takes every picture so). */
    windowShot: (file) => windowShot(file),
    async leave() {
      await send("disconnect");
    },
    async lines(from = 0) {
      read();
      return heard.slice(from);
    },
    log: () => heard.filter((each) => each.kind !== "play").map((each) => each.text),
    async close() {
      if (helper) {
        await helper.ask("release").catch(() => {});
        await helper.close();
        helper = null;
      }
      if (child && exited === null) {
        // asked to quit; ended by its own id if it does not
        const n = next++;
        writeFileSync(join(folder, `smak_${n}.cfg`), "quit\n");
        writeFileSync(join(folder, "smak_in.cfg"), `smak_g${n}\n`);
        for (let waited = 0; exited === null && waited < answerWithin; waited += READ_EVERY) await pause(READ_EVERY);
        if (exited === null) child.kill();
      }
      read();
      for (const name of ours()) unlinkSync(join(folder, name));
      if (kept && Buffer.compare(kept, existsSync(settings) ? readFileSync(settings) : Buffer.alloc(0)) !== 0)
        writeFileSync(settings, kept);
      child = null;
    },
  };
}
