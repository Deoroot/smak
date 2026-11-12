// A map seen in the game itself: the game is entered, the player walks, turns, speaks, and pictures are taken;
// what the game SAYS is heard, waited for and asserted, so that a run passes or fails without a person
// reading its pictures.
//
//   import { play, maps } from "./smak/src/index.mjs";
//   const driver = play.browserDriver({ url: "http://127.0.0.1:8097/?args=", playwright: "C:/tools/browser" });
//   const run = await play.play({ driver, map: "orchard", out: "work/seen", mod, steps: [
//     { walk: 3000, shot: "walked" },                 // forward for three seconds, then a picture
//     { face: 90, look: -20 },                        // look along +y and 20 degrees down, exactly
//     { say: "hail", until: "Keeper: .*welcome" },    // said as the mod's profile says a thing is said;
//                                                     // then waited for, by what the game answers
//     { expect: "You receive" },                      // the run FAILS unless the game said so
//   ] });
//   run.pictures;                                     // the PNG files, in the order taken
//   run.passed, run.expectations;                     // whether every expectation held, and each one
//   run.logFile;                                      // every line the game said, with its time
//
// The parts, kept apart:
//   playOf         a list of steps, as a person or an agent writes them, checked and made plain actions
//   playSession    a game kept up: many runs and many maps against one engine, which is started once
//   play           one run from a cold start: the engine waited for, the map, the steps, the driver closed
//   browserDriver  a browser build of the Xash3D engine, driven with Playwright (cli/play-browser.mjs)
//   nativeDriver   the person's own game from Steam, driven by its console alone (cli/play-native.mjs)
//   serveSession, attachSession   a session kept by one process and used by others (cli/play-session.mjs)
//   sheetOf        a run's pictures in one, each with its name (cli/play-sheet.mjs)
//
// What belongs to one game (how its menu is got through, how a thing is said so that an NPC hears it, what
// line says a map has loaded, how its messages are read) is the `play` field of the mod's profile
// (maps/mod.mjs), and nothing of it is here.
//
// WHERE THE FACTS ARE FROM. The engine is Xash3D FWGS built for the browser. A console command is run by the
// engine's own Cmd_ExecuteString (engine/common/cmd.c), called through the page's Emscripten module. A player
// moves while one of the client library's buttons is down: `+forward`, `+back`, `+moveleft`, `+moveright`,
// `+left`, `+right`, `+jump`, `+duck`, `+use`, `+attack`, each let go by the same word with `-` (the SDK's
// cl_dll/input.cpp, InitInput). Typed with no key's number after it, a `+` command is "typed manually at the
// console for continuous down" (KeyDown, same file): the button stays down until its `-` comes. So a walk is
// `+forward`, a wait, `-forward`, whatever keys the person has bound.
//
// TIME. Measured 2026-10-13 in a local build drawn in software: the engine is up 8 seconds after the page
// is opened, a small map has loaded 8 seconds after `map <name>` (4 the second time in one session), and the
// player is in the game 3 seconds after the menu's click. The rest of a run of old was waiting by the clock:
// a profile that names the line a loaded map prints (`play.loaded`) and gives its `enter` steps an `until`
// waits for the game instead. A picture costs about 1.6 seconds there; text costs nothing.
//
// TURNING. A driver that can set the view (`look`, as the browser driver can) turns exactly: `turn`, `face`
// and `look` are set and read back in degrees. Without it a `turn` is by time and only about right: `+left`
// turns the view by cl_yawspeed degrees a second (input.cpp, CL_AdjustAngles: 210 unless the person changed
// it), counted frame by frame, so a turn is out by up to a frame's worth and does not add up over several.
//
// GOING TO A PLACE. Xash3D FWGS has no command that puts the player at a place (no `setpos`: looked for in
// engine/server/sv_client.c and engine/client/cl_main.c, 2026-10-13). A game may have one of its own, and
// its profile names it (`play.goto`); then `{ goto: [x, y, z] }` runs it and, where the driver knows where
// the player stands, makes sure he is there. Without one: walk, or `{ command: ["sv_cheats 1", "noclip"] }`
// and fly, which a listen server allows, with `{ where: "name" }` to read the place as you go.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { GOLDSRC, modOf } from "../make/maps/mod.mjs";
import { sheetOf, smallerPng } from "./play-sheet.mjs";
import { MOUSE_BUTTONS } from "./play-browser.mjs";
import { ASIDE, CENSUS_RADIUS, LOOSED, aimOf, besideOf, censusOf, censusTable, fightOptionsOf, fightPartOf, leftOf, placeOf, progressOf } from "./play-fight.mjs"; // prettier-ignore

export { SOFTWARE_GL, HARDWARE_GL, playwrightFrom, browserDriver } from "./play-browser.mjs";
export { nativeDriver, pngOfTga, NATIVE_LOADED } from "./play-native.mjs";
export { sheetOf, smallerPng } from "./play-sheet.mjs";
export { readDemo } from "./play-demo.mjs";
export { serveSession, attachSession, sessionState, closeSession, SESSION_PORT } from "./play-session.mjs";

/** What a step may do: one of these, or nothing but a wait and a picture. */
const KINDS = [
  ...["command", "say", "walk", "turn", "button", "hold", "press", "click"],
  ...["mouse", "mouseDown", "mouseUp", "tap", "look", "face", "faceAt", "goto", "where", "map"],
  ...["expect", "expectNot", "repeat", "fight", "section", "travel", "census", "record"],
];
/** What a step may hold beside its kind, and which kinds take `ms` and `to`. */
const BESIDE = ["wait", "shot", "ms", "to", "until", "within", "every", "since", "times", "for", "radius", "already", "onFail", "keep"]; // prettier-ignore
/** Milliseconds between two settings of the view in a pan (`look` or `face` with `ms`): a frame's at 60. */
const PAN_EVERY = 16;
/** What a step whose line was heard before it began does (`already`), and what a step that fails does (`onFail`). */
const ALREADY = ["pass", "warn", "wait"];
const ON_FAIL = ["stop", "continue"];
/** A value kept by a step's `keep`, as a later step's text names it: `${hp}`. */
const KEPT = /\$\{(\w+)\}/g;
/** The section the steps before any `section` step are in. */
const OPENING = "(start)";
const TAKES_MS = ["button", "hold", "mouse", "tap", "look"];
/** The kinds that hold steps of their own and end by a line, a count or a time. */
const LOOPS = ["repeat", "fight"];
/** The lines of a fight a profile's `play.fight` may give the pattern of. */
const FIGHT_LINES = ["dealt", "taken", "missed", "slain", "died", "health", "maxHealth"];
/** What a `fight` step may say in its object. */
const FIGHT = ["radius", "heal", "post", "attack", "chase", "quiet", "prefer", "sidestep", "dodge", "stuck", "ranged", "quietEnds"]; // prettier-ignore
/** What a fight's `dodge` may say in its object. */
const DODGE = ["line", "far", "ms", "hold"];
/** A word of an enemy's name a fight prefers: what a game's command takes as one word. */
const WORD = /^[A-Za-z0-9_-]+$/;
/** Milliseconds of one sidestep round a crowd; how far a fight goes from a place it was warned of, the longest
 * it takes to, and how long after it walks at nobody; units a chase must gain on its enemy to be getting on. */
const SIDESTEP = 600;
const DODGE_FAR = 150;
const DODGE_MS = 1500;
const DODGE_HOLD = 2000;
const GAINED = 16;
/** A chase's walk: units a second it is timed by, the longest one step of it, and how far beyond `chase` the
 * enemy may still be for the blow after it to be struck when nobody else is on the player. */
const PACE = 200;
const CHASE_MOST = 1500;
const OUT_OF_REACH = 100;
/** Blows a round strikes at an enemy within `chase` before it asks for him again. */
const FLURRY = 3;
/** Sidesteps after which a preferred enemy who comes no nearer is let be, and for how long (milliseconds). */
const LET_BE_AFTER = 4;
const LET_BE = 20000;
/** The kinds that only read: nothing is done to the game, so no wait follows them unless one is given. */
const READS = ["where", "expect", "expectNot", "section", "census", "record"];
/** Where a walk goes, as the client library's buttons name it (the SDK's cl_dll/input.cpp). */
const WALKS = { forward: "forward", back: "back", left: "moveleft", right: "moveright" };
/** Milliseconds waited after a step that does something, unless the step says: a frame or two to show it. */
const PAUSE = 1000;
/** How long a key is held when a `hold` step does not say. */
const HOLD = 1000;
/** A tap of the mouse: how long its button is down, and from one tap's beginning to the next's. */
const TAP = 200;
const TAP_EVERY = 700;
/** How far round the player a `fight` and a `faceAt: "target"` look for an enemy unless told. */
const RADIUS = 768;
/** Milliseconds a profile's `play.target` is given to answer. */
const TARGET_WITHIN = 3000;
/** Milliseconds a fallen player is given to rise, and a fight waits where it finds no enemy. */
const RISES = 30000;
const IDLE = 300;
/** Milliseconds between the commands of one step, so that each is taken in a frame of its own. */
const BETWEEN = 150;
/** Milliseconds an `until` waits for its line unless the step says, and between two looks for it. */
const WITHIN = 30000;
const POLL = 100;
/** Milliseconds a map is given to be left before files are put into the engine. */
const LEAVES = 700;
/** How near the place asked for a `goto` has to bring the player, across and in height, and how long it has. */
const GOTO_NEAR = 16;
const GOTO_NEAR_Z = 72;
const GOTO_WITHIN = 3000;
/** Units a `walk` has to move the player by, or the run stops: he did not move (in a brush). */
const WALKED = 2;
/** A map's name and a picture's, as they may be written: nothing a console or a file system minds. */
const MAP_NAME = /^[A-Za-z0-9_][A-Za-z0-9_\-/.]*$/;
const SHOT_NAME = /^[A-Za-z0-9_-]+$/;
const BUTTON_NAME = /^[a-z][a-z0-9_]*$/;
/** From where an expectation reads, beside a picture's name; and an `until`, which may also read "deed". */
const SINCE = ["run", "map", "step"];
const BEFORE = "deed";
/** What a driver is: every one of these is called by `play`. */
const DRIVER = ["ready", "command", "keyDown", "keyUp", "press", "click", "wait", "shot", "log", "close"];
/** A run's own lines in what was heard: never matched by an `until` or an expectation. */
const OWN = "play";
/** How many of the last lines heard a failed wait repeats. */
const LAST_LINES = 6;
/** How many pictures a row of the contact sheet holds, and how much smaller each is drawn. */
const SHEET = { cols: 4, shrink: 3 };

const shown = (value) => (value === undefined ? "nothing" : JSON.stringify(value));
const isCount = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isText = (value) => typeof value === "string" && value.trim() !== "";
/** Whether a step's text names a value a step before kept (`${hp}`). */
const templated = (value) => typeof value === "string" && /\$\{\w+\}/.test(value);
/** An object without the fields that are undefined. */
const defined = (fields) => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));

// ── what the game says ──────────────────────────────────────────────────────
/**
 * A pattern as a step writes it, made a regular expression: `"HIT! .* holy damage"` is the expression's
 * source, matched as written (capitals count); `"/the flame sinks/i"` gives flags too. A RegExp is itself.
 */
export function patternOf(written, what = "a pattern") {
  if (written instanceof RegExp) return written;
  if (!isText(written))
    throw new Error(
      `play: ${what} is a regular expression as text, such as "HIT! .* damage", not ${shown(written)}`,
    );
  const literal = /^\/(.+)\/([a-z]*)$/s.exec(written);
  try {
    return literal ? new RegExp(literal[1], literal[2]) : new RegExp(written);
  } catch (error) {
    throw new Error(`play: ${what} ${shown(written)} is no regular expression: ${error.message}`, {
      cause: error,
    });
  }
}

/** The strings of a message's bytes: each run that ends at a 0, read as Latin-1. */
const stringsOf = (bytes, from = 0) => {
  const strings = [];
  let text = "";
  for (let at = from; at < bytes.length; at++)
    if (bytes[at]) text += String.fromCharCode(bytes[at]);
    else {
      strings.push(text);
      text = "";
    }
  if (text) strings.push(text);
  return strings;
};
/** A line as it is kept: the colour codes of the engine's console (1 to 8) and what is not print taken out. */
const clean = (text) => text.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, "").trim();
const linesOfText = (text) => text.split(/\r?\n/).map(clean).filter(Boolean);

/**
 * How the SDK's own user messages are read, by the names a profile's `play.messages` may give:
 *   "textmsg"   TextMsg (the SDK's dlls/util.cpp, ClientPrint): a byte for where it is shown, the text, and
 *               up to four strings put where the text has %s. What a script or the game prints to a player's
 *               console, his notify lines and the middle of his screen
 *   "saytext"   SayText (dlls/client.cpp, Host_Say): a byte for who spoke, then the line
 *   "strings"   any message: every string of two letters or more in it, for a message whose layout is not known
 */
export const MESSAGE_READERS = {
  textmsg(bytes) {
    const [text = "", ...put] = stringsOf(bytes, 1);
    let next = 0;
    return linesOfText(text.replace(/%s/g, () => clean(put[next++] ?? "")));
  },
  saytext: (bytes) => linesOfText(stringsOf(bytes, 1).join(" ")),
  strings: (bytes) => stringsOf(bytes).flatMap(linesOfText).filter((each) => each.length > 1), // prettier-ignore
};

// ── the profile's part ──────────────────────────────────────────────────────
/**
 * What a mod's profile says of playing it, made whole: `{ enter, say, loads, loaded, goto, messages,
 * yawspeed, screen }`. A field the profile leaves out is `GOLDSRC`'s; with no profile it is all `GOLDSRC`'s.
 *   enter      the steps that get a player from "the map has loaded" into the game (a menu's clicks); none
 *              for a game that puts the player in by itself. A step with `until` (and `every`) waits for
 *              the game instead of the clock
 *   say        how a thing is said: a list of console commands with `{text}` where the words go, or a
 *              function of the text that gives the commands
 *   loads      milliseconds a map is given to load after `map <name>`: waited out where nothing is heard,
 *              and the longest `loaded` is waited for
 *   loaded     a pattern of the line that says the map has loaded, or null: with it, and a driver that
 *              hears, a run goes on the moment the line comes
 *   goto       how the player is put at a place: console commands with `{x}`, `{y}`, `{z}` in them, or a
 *              function of the three; null where the game has no such command
 *   messages   the game's user messages to listen to, each with how its bytes are read: a name of
 *              `MESSAGE_READERS`, or a function of the bytes that gives a line, lines, or nothing
 *   yawspeed   the game's cl_yawspeed, in degrees a second: what a `turn` is timed by where the driver
 *              cannot set the view
 *   screen     `[width, height]` of the page the `enter` steps' clicks were measured on
 *   eye        how far the player's eyes are above his origin (28: the SDK's VEC_VIEW, dlls/util.h): what
 *              `faceAt` aims from
 *   target     how the nearest living enemy is found, or null where the game cannot say: either
 *              `{ commands: ["nearest {radius}"], answer, none, within }`: console commands, the pattern of
 *              the line that answers, with the named groups `x`, `y`, `z` (the place to aim at) and, if the
 *              game says them, `id`, `name`, `hp`, `far`, `count` (the living enemies in the radius) and
 *              `close` (those on the player, as the game counts that); `none` the pattern of the line that
 *              says there is no enemy; `within` the milliseconds an answer is given (3000). Or a function
 *              `({ radius, command, heard, view })` that resolves to `{ origin: [x, y, z], id, name, hp, far,
 *              count, close }` or null: `command(text)` runs a console command, `heard(pattern, within)`
 *              resolves to the match of the first line said from then on (or null), `view()` is the driver's,
 *              `prefer` the words of the names a fight goes for first (a list, maybe empty). With commands:
 *              `prefer`, the commands that make the game answer with the nearest enemy whose name holds
 *              `{word}` (and the nearest of all when none does), and `unprefer`, those that undo it
 *   heal       how the player's health is given back in a test: console commands, or a function that gives
 *              them; null where the game has no such command
 *   travel     how the player goes through a way to another map that he stands in (a `travel` step):
 *              `{ commands, spawned }`, the console commands that take him (`["accept"]`) and the pattern of
 *              the line that says the next map's server is up, its first group the map's name. A session
 *              follows the map it is in by that line, however the player got there. Null where the game
 *              has no ways between maps
 *   fight      what a `fight` step does and reads: `{ attack, dealt, taken, missed, slain, died, health,
 *              maxHealth }`. `attack`: the steps of one blow (`[{ tap: "left" }]`), done once a round. The
 *              rest are patterns of the game's lines, each null where the game says no such thing: a hit the
 *              player `dealt` and one he has `taken` (the first group the damage), a blow of his that
 *              `missed`, an enemy `slain` (the first group its name), the player `died`, his `health` and the
 *              most it can be, `maxHealth` (the first group the number)
 */
export function playPartOf(mod) {
  const whole = modOf(mod) ?? GOLDSRC;
  if (
    whole.play !== undefined &&
    (typeof whole.play !== "object" || !whole.play || Array.isArray(whole.play))
  )
    throw new Error(
      `mod: play is an object such as { enter: [], say: ["say {text}"] }, not ${shown(whole.play)}`,
    );
  const part = { ...GOLDSRC.play, ...whole.play };
  if (!Array.isArray(part.enter))
    throw new Error(`mod: play.enter is a list of steps, not ${shown(part.enter)}`);
  const commands = (value) => typeof value === "function" || (Array.isArray(value) && value.every(isText));
  if (!commands(part.say))
    throw new Error(
      `mod: play.say is a list of console commands with {text} in them, or a function of the text, not ${shown(part.say)}`,
    );
  if (!isCount(part.loads))
    throw new Error(`mod: play.loads is a number of milliseconds, not ${shown(part.loads)}`);
  if (!(isCount(part.yawspeed) && part.yawspeed > 0))
    throw new Error(`mod: play.yawspeed is degrees a second, over 0, not ${shown(part.yawspeed)}`);
  part.loaded ??= null;
  if (part.loaded !== null) part.loaded = patternOf(part.loaded, "mod: play.loaded");
  part.goto ??= null;
  if (part.goto !== null && !commands(part.goto))
    throw new Error(
      `mod: play.goto is a list of console commands with {x}, {y} and {z} in them, or a function of the three, not ${shown(part.goto)}`,
    );
  part.messages ??= {};
  const readers = typeof part.messages === "object" && !Array.isArray(part.messages) ? part.messages : null;
  const read = (how) => typeof how === "function" || Object.hasOwn(MESSAGE_READERS, how);
  if (!readers || !Object.values(readers).every(read))
    throw new Error(
      `mod: play.messages gives each message's name the way it is read: one of ${Object.keys(MESSAGE_READERS).join(", ")}, or a function of its bytes; not ${shown(part.messages)}`,
    );
  if (!isNumber(part.eye))
    throw new Error(`mod: play.eye is how far the eyes are above the player's origin, not ${shown(part.eye)}`);
  part.heal ??= null;
  if (part.heal !== null && !commands(part.heal))
    throw new Error(
      `mod: play.heal is a list of console commands that give the player's health back, or a function that gives them, not ${shown(part.heal)}`,
    );
  part.travel ??= null;
  if (part.travel !== null) {
    const asked = part.travel;
    if (typeof asked !== "object" || Array.isArray(asked) || !commands(asked.commands) || asked.spawned === undefined)
      throw new Error(
        `mod: play.travel is { commands, spawned }: the console commands that take the player through a way to another map, and the pattern of the line that says the next map's server is up (its first group the map's name), not ${shown(asked)}`,
      ); // prettier-ignore
    part.travel = { commands: asked.commands, spawned: patternOf(asked.spawned, "mod: play.travel.spawned") };
  }
  part.target ??= null;
  if (part.target !== null && typeof part.target !== "function") {
    const asked = part.target;
    if (typeof asked !== "object" || Array.isArray(asked) || !commands(asked.commands) || asked.answer === undefined)
      throw new Error(
        `mod: play.target is { commands, answer, none } (console commands with {radius} in them, and the patterns of the lines that answer), or a function, not ${shown(asked)}`,
      ); // prettier-ignore
    const answer = patternOf(asked.answer, "mod: play.target.answer");
    if (!["x", "y", "z"].every((name) => answer.source.includes(`(?<${name}>`)))
      throw new Error(
        `mod: play.target.answer names the place in the groups (?<x>...), (?<y>...) and (?<z>...), which ${answer} does not`,
      );
    const none = asked.none == null ? null : patternOf(asked.none, "mod: play.target.none");
    if (asked.within !== undefined && !(isCount(asked.within) && asked.within > 0))
      throw new Error(`mod: play.target.within is a number of milliseconds over 0, not ${shown(asked.within)}`);
    for (const name of ["prefer", "unprefer"])
      if (asked[name] != null && !commands(asked[name]))
        throw new Error(
          `mod: play.target.${name} is a list of console commands${name === "prefer" ? " with {word} in them (the enemy whose name holds that word is the one answered)" : " that undo a prefer"}, or a function, not ${shown(asked[name])}`,
        ); // prettier-ignore
    part.target = {
      ...{ commands: asked.commands, answer, none, within: asked.within ?? TARGET_WITHIN },
      ...{ prefer: asked.prefer ?? null, unprefer: asked.unprefer ?? null },
    };
  }
  if (whole.play?.fight !== undefined && (typeof whole.play.fight !== "object" || !whole.play.fight || Array.isArray(whole.play.fight))) // prettier-ignore
    throw new Error(
      `mod: play.fight is an object such as { attack: [{ tap: "left" }], dealt: "You hit .* for (\d+)" }, not ${shown(whole.play.fight)}`,
    );
  part.fight = { ...GOLDSRC.play.fight, ...whole.play?.fight };
  const unknown = Object.keys(part.fight).filter((name) => name !== "attack" && !FIGHT_LINES.includes(name));
  if (unknown.length)
    throw new Error(`mod: play.fight has ${unknown.join(", ")}, which it does not read: attack, ${FIGHT_LINES.join(", ")}`); // prettier-ignore
  if (!Array.isArray(part.fight.attack) || !part.fight.attack.length)
    throw new Error(`mod: play.fight.attack is the steps of one blow, such as [{ tap: "left" }], not ${shown(part.fight.attack)}`); // prettier-ignore
  for (const name of FIGHT_LINES)
    part.fight[name] = part.fight[name] == null ? null : patternOf(part.fight[name], `mod: play.fight.${name}`);
  // a goto's lift, a census, a ranged weapon drawn, enemies passed over: cli/play-fight.mjs
  return fightPartOf(part, whole.play?.target, { patternOf, commands });
}

/** The names of the user messages a profile reads: what a driver is asked to listen to. */
export const messagesOf = (mod) => Object.keys(playPartOf(mod).messages);

/** The console commands a profile's list (or function) gives for the words put into it. */
function commandsOf(given, put, values, what) {
  const commands =
    typeof given === "function"
      ? [given(...values)].flat()
      : given.map((each) => each.replace(/\{(\w+)\}/g, (all, name) => (name in put ? put[name] : all)));
  if (!commands.length || !commands.every((each) => isText(each) && !/[\r\n]/.test(each)))
    throw new Error(
      `mod: ${what} gave ${shown(commands)} for ${shown(values)}, where console commands were wanted`,
    );
  return commands;
}

/** The console commands that say `text` in a game, as its profile's `play.say` has it. */
function sayCommands(part, text, where) {
  // the console ends a command at `;` and at a line's end, and a `"` opens a quoted word: none can be said
  if (!isText(text) || /[;"\r\n]/.test(text))
    throw new Error(
      `play: ${where}: say is the words to say, with no ; and no " and on one line (the console would take them for its own), not ${shown(text)}`,
    );
  return commandsOf(part.say, { text }, [text], "play.say");
}

// ── steps into actions ──────────────────────────────────────────────────────
/**
 * A list of steps checked and made plain actions; a wrong step is refused in a sentence that names it.
 *
 * A step is an object with at most one of:
 *   { command: "noclip" }             a console command, or a list of them
 *   { say: "hail" }                   said as the mod's profile says a thing is said (`play.say`)
 *   { walk: 2000 }                    forward for that many milliseconds; `to: "back" | "left" | "right"`
 *   { turn: 90 }                      degrees to the left (under 0: to the right): exact where the driver
 *                                     sets the view, by time and about right where it does not
 *   { face: 90 }                      the player turned to that yaw: 0 looks along +x, 90 along +y
 *   { look: -30 }                     the player looking that many degrees up (under 0: down), level at 0
 *   { button: "jump", ms: 200 }       one of the game's buttons held: `+jump`, the wait, `-jump`
 *   { hold: "w", ms: 2000 }           a key of the keyboard held (ms: 1000 unless told), as the driver names keys
 *   { press: "Enter" }                a key pressed and let go
 *   { click: [512, 330] }             a click at that place of the page, in its pixels
 *   { mouse: "left", ms: 2500 }       a button of the mouse held that long: left, right, middle
 *   { mouseDown: "left" }             a button of the mouse held until `{ mouseUp: "left" }` (or the run's
 *                                     end), while the steps between are done
 *   { tap: "left", times: 3 }         a button of the mouse pressed and let go, `times` over (1), `every`
 *                                     milliseconds from one tap to the next (700), down for `ms` (200). With
 *                                     `until`, tapped again every that often until the line comes. A game
 *                                     that charges a blow while the button is held swings on a tap only
 *   { faceAt: [1872, 976, 40] }       the view turned to that place, yaw and pitch, from where the player's
 *                                     eyes are; `faceAt: "target"` turns it to the nearest living enemy, found
 *                                     as the profile's `play.target` finds one, within `radius` (768)
 *   { goto: [512, 96, 36] }           the player put at that place, by the profile's `play.goto`; the place
 *                                     is the middle of his box, 36 above the floor he stands on
 *   { where: "gate" }                 the player's place and view written into the log, under that name
 *   { map: "barrowroad" }             another map loaded in the same run, and entered as the profile says
 *   { travel: true }                  through the way to another map the player stands in: the profile's
 *                                     `play.travel` commands, its line of the next map's server, the map's
 *                                     `loaded` line, and its `enter` steps. `travel: "barrowroad"`: and the
 *                                     run stops if the way led elsewhere. `within`: the longest each wait is
 *                                     (the profile's `loads`)
 *   { section: "terraces" }           the steps after it, up to the next section, are one part of the run:
 *                                     timed and counted on their own (`sections`, summary.json), and a run
 *                                     may begin at it (`from`). It does nothing in the game
 *   { expect: "HIT! .* holy" }        the run fails unless a line heard matches (a regular expression)
 *   { expectNot: "Script Error" }     the run fails if a line heard matches
 *   { repeat: [steps], until: "x" }   the steps done again and again: until a line (`within`: 30000, and the
 *                                     run stops when it never comes), `times` over, or `for` that many
 *                                     milliseconds. With `until` and one of the other two the block ends at
 *                                     whichever comes first, and a line that did not come stops nothing
 *   { fight: { heal: 0.5 }, until: "x" }   the nearest enemy faced and struck, again and again, until a line
 *                                     (`within`) or `for` a time, as `repeat` ends; `fight: true` for a plain
 *                                     one. In the object: `radius` (768), `heal` (the share of his health
 *                                     under which the player is healed by the profile's `play.heal`), `post`
 *                                     ([x, y, z]: where he is put back when he has died and risen), `chase`
 *                                     (a distance: he walks at an enemy farther off than that), `quiet`
 *                                     (milliseconds: the fight is over when no enemy has been found for
 *                                     that long, which stops nothing), `attack` (the steps of one blow,
 *                                     for the profile's), `prefer` (a word of a name, or a list: that
 *                                     enemy first, by the profile's `play.target.prefer`), `sidestep`
 *                                     (milliseconds, 600, or false: with `chase`, a step to the side
 *                                     round others in the way), `dodge` (the pattern of a line that warns
 *                                     of a blow to a place, its `(?<x>)` and `(?<y>)`; or `{ line, far,
 *                                     ms, hold }`: stepped away from), `stuck` (`{ after, then }` or false:
 *                                     an enemy it cannot get at, passed over, stopped at, gone to or shot
 *                                     at), `ranged` (a ranged weapon drawn for him), `quietEnds` (an end by
 *                                     its quiet without the line is no failure): cli/play-fight.mjs. What
 *                                     happened is written to the log as a line of the kind "fight", and is
 *                                     the run's `fights`
 *   { census: 6000 }                  the living monsters within that radius counted as the profile's
 *                                     `play.census` does, and written as a table (`true`: 6000)
 *   { face: 270, ms: 4000 }           (with look too) the view eased there over that time, the shorter way
 *                                     round: a camera's pan, for a clip
 *   { record: "plaza" }               the page filmed from here, as a clip of that name, until the next
 *                                     `record` or the run's end: `NN_plaza.mp4` (H.264, 30 a second, through
 *                                     ffmpeg), numbered with the pictures. `{ record: false }` ends it. The
 *                                     browser's driver films what the page draws (its screencast); a window
 *                                     on the graphics card (`--show --gpu`) draws a map smoothly, software
 *                                     at a few frames a second
 * and any step may also carry:
 *   until: "Skeleton .* dies"         after it, a line the game says is waited for (and not the clock). A
 *                                     step that DOES a thing hears from when it began doing it; one that
 *                                     only waits (`{ until }`, with a picture or not) hears from when the
 *                                     last step that did a thing began, so that a line said while that
 *                                     step was still at its work, or in the same instant as the line IT
 *                                     waited for, is not missed, however many waits follow one deed. No
 *                                     `until` stops at a line another `until` has stopped at
 *   within: 20000                     the longest `until` waits, in milliseconds (30000): past it the run
 *                                     stops and says what it waited for. With `expect`: how long the line
 *                                     is given to come (unless told: it has to be there already); with
 *                                     `expectNot`: how long the line is watched for
 *   every: 1000                       with `until`: the step is done again that often until the line comes
 *   since: "run"                      with `expect` and `expectNot`: the lines read are those since the
 *                                     run began ("run", as when nothing is said), since the map last
 *                                     loaded ("map"), since this step began ("step"), or since a picture
 *                                     of that name was taken. With `until`: the same, and "deed" (since
 *                                     the last step that did a thing began); unless told, as `until` says
 *   wait: 1500                        milliseconds waited after it (unless told: 1000 after a step that does
 *                                     something and has no `until`, none after one that only reads)
 *   shot: "gate"                      a picture taken after the wait: `NN_gate.png`, numbered as taken
 *   already: "pass"                   with `until`: what is done when the line was said BEFORE the step began
 *                                     (since the map was entered, or since the last step that waited for the
 *                                     same line; a line another `until` stopped at is not looked at): "pass"
 *                                     ends the step at once, the line taken as its own (unless told: a
 *                                     fight's); "warn" says so in the log and waits all the same (a wait's
 *                                     and a repeat's); "wait" says nothing (a step that does a thing: its
 *                                     line is an answer to what it did). A run stopped by an `until` says
 *                                     when its line was heard before, if it was
 *   onFail: "continue"                the step failing (its line never came, a `goto` that put him nowhere)
 *                                     is a failed expectation and the run goes on; "stop" (unless told, or as
 *                                     its section's step says) stops it
 *   keep: { hp: "= ([\\d.]+)" }       a value kept from what was said: the first group of the pattern, in the
 *                                     line its `until` stopped at or else the last line since it began that
 *                                     matches. A later step's command, `until`, `expect` or `expectNot` names
 *                                     it `${hp}` (in a pattern, matched as written: dots are dots)
 * so `{ wait: 5000 }` only waits, `{ shot: "here" }` only takes a picture and `{ until: "dies" }` only waits
 * for a line.
 *
 * Options: `mod` (the profile: its `play.say`, `play.goto` and `play.yawspeed`), `pause` (the wait after a
 * step that does something), `what` (how the list is named in a refusal).
 *
 * Each action is `{ kind, wait, shot, step }` with its own fields: "command" `commands`; "button" `button`,
 * `ms` (and `turn`, the degrees, when it came of one); "hold" `key`, `ms`; "press" `key`; "click" `x`, `y`;
 * "mouse" `mouse`, `ms`; "mouseDown", "mouseUp" `mouse`; "tap" `mouse`, `ms`, `times`, `every`; "look" `yaw`,
 * `pitch` (one of them); "faceAt" `place` (or `target: true` with `radius`); "goto" `commands`, `place`;
 * "where" `name`; "map" `map`; "expect", "expectNot" `pattern`, `within`, `since`; "repeat" `actions`, `times`,
 * `for`; "fight" `actions` (one blow), `radius`, `heal`, `post`, `chase`, `quiet`, `for`, `prefer` (and
 * `prefers`, `unprefers`: the commands), `sidestep`, `dodge`; "wait" nothing more. One with
 * `until` has `until` (a RegExp), `within`, `every` (or null) and `since` too. `step` is the step as written.
 */
export function playOf(steps, { mod, pause = PAUSE, what = "step" } = {}) {
  const part = playPartOf(mod);
  if (!Array.isArray(steps))
    throw new Error(
      `play: the steps are a list, such as [{ walk: 2000 }, { shot: "here" }], not ${shown(steps)}`,
    );
  if (!isCount(pause)) throw new Error(`play: pause is a number of milliseconds, not ${shown(pause)}`);
  return steps.map((step, index) => actionOf(step, `${what} ${index + 1}`, part, pause));
}

function actionOf(step, where, part, pause) {
  const refuse = (sentence) => {
    throw new Error(`play: ${where} ${sentence}`);
  };
  if (!step || typeof step !== "object" || Array.isArray(step))
    refuse(
      `is ${shown(step)}: a step is an object, such as { walk: 2000 } or { command: "noclip", shot: "seen" }`,
    );
  const unknown = Object.keys(step).filter((key) => !KINDS.includes(key) && !BESIDE.includes(key));
  if (unknown.length)
    refuse(
      `has ${unknown.join(", ")}, which no step has: a step is one of ${KINDS.join(", ")}, with wait, shot and until`,
    );
  // to face a way and to look up or down are one setting of the view: the two may share a step
  const kinds = KINDS.filter((kind) => step[kind] !== undefined);
  const both = kinds.length === 2 && kinds.includes("look") && kinds.includes("face");
  if (kinds.length > 1 && !both)
    refuse(`has ${kinds.join(" and ")}: one thing a step, the next in a step of its own`);
  const kind = both ? "look" : kinds[0];
  const waits = step.wait !== undefined || step.shot !== undefined || step.until !== undefined;
  if (!kind && !waits) refuse(`does nothing: ${shown(step)}`);
  if (step.ms !== undefined && !TAKES_MS.includes(kind))
    refuse("has ms, which goes with hold or button only, with mouse and tap, and with look or face (a pan)");
  if (step.to !== undefined && kind !== "walk") refuse("has to, which goes with walk only");
  if (step.wait !== undefined && !isCount(step.wait))
    refuse(`waits ${shown(step.wait)}: wait is a number of milliseconds`);
  if (step.shot !== undefined && !(typeof step.shot === "string" && SHOT_NAME.test(step.shot)))
    refuse(`names its picture ${shown(step.shot)}: letters, digits, _ and - (it becomes a file's name)`);
  const expects = kind === "expect" || kind === "expectNot";
  if (step.until !== undefined && expects)
    refuse(`has until and ${kind}: an expectation waits by its own within`);
  if (step.within !== undefined && step.until === undefined && !expects && kind !== "travel")
    refuse("has within, which goes with until, expect or expectNot only, and with travel");
  if (step.within !== undefined && !(isCount(step.within) && step.within > 0))
    refuse(`waits within ${shown(step.within)}: a number of milliseconds over 0`);
  const loops = LOOPS.includes(kind);
  if (step.every !== undefined && loops)
    refuse(`has every and ${kind}: what is done again there is the ${kind === "repeat" ? "block" : "blow"} itself`);
  if (step.every !== undefined && kind !== "tap" && (step.until === undefined || !kind))
    refuse("has every, which goes with until, on a step that does a thing to do again, and with tap");
  if (step.every !== undefined && !(isCount(step.every) && step.every > 0))
    refuse(`does it again every ${shown(step.every)}: a number of milliseconds over 0`);
  if (step.since !== undefined && !expects && step.until === undefined)
    refuse("has since, which goes with until, expect or expectNot only");
  const sinces = expects || loops ? SINCE : [...SINCE, BEFORE];
  if (step.since !== undefined && !(sinces.includes(step.since) || SHOT_NAME.test(String(step.since))))
    refuse(`reads since ${shown(step.since)}: ${sinces.join(", ")}, or the name of a picture taken before`);
  if (step.times !== undefined && kind !== "tap" && kind !== "repeat")
    refuse("has times, which goes with tap or repeat only");
  if (step.times !== undefined && !(Number.isInteger(step.times) && step.times > 0))
    refuse(`does it ${shown(step.times)} times: a whole number over 0`);
  if (step.for !== undefined && !loops) refuse("has for, which goes with repeat or fight only");
  if (step.for !== undefined && !(isCount(step.for) && step.for > 0))
    refuse(`goes on for ${shown(step.for)}: a number of milliseconds over 0`);
  if (step.radius !== undefined && !(kind === "faceAt" && step.faceAt === "target"))
    refuse('has radius, which goes with faceAt: "target" only (that of a fight is in its object)');
  if (step.already !== undefined && step.until === undefined)
    refuse("has already, which goes with until only: what a step does when its line was heard before it began");
  if (step.already !== undefined && !ALREADY.includes(step.already))
    refuse(`does ${shown(step.already)} with a line heard before it began: ${ALREADY.join(", ")}`);
  if (step.onFail !== undefined && !ON_FAIL.includes(step.onFail))
    refuse(`does ${shown(step.onFail)} when it fails: ${ON_FAIL.join(", ")}`);
  const keeps = step.keep !== undefined && step.keep && typeof step.keep === "object" && !Array.isArray(step.keep) ? Object.keys(step.keep) : null; // prettier-ignore
  if (step.keep !== undefined && !(keeps?.length && keeps.every((name) => /^\w+$/.test(name))))
    refuse(`keeps ${shown(step.keep)}: { "name": "a pattern whose first group is kept" }, each name of letters, digits and _`); // prettier-ignore
  const far = (value, of) =>
    isCount(value) && value > 0 ? value : refuse(`${of} ${shown(value)}: a distance in the map's units, over 0`);
  const place = (value) => Array.isArray(value) && value.length === 3 && value.every(isNumber);
  const finds = (does) =>
    part.target ||
    refuse(
      `${does}, and the profile names no way to find one (play.target): the engine has none of its own. Face a place with faceAt: [x, y, z]`,
    );
  const quiets = kind === "fight" && step.fight?.quiet !== undefined;
  if (loops && step.until === undefined && step.times === undefined && step.for === undefined && !quiets)
    refuse(`${kind === "repeat" ? "repeats" : "fights"} without an end: until (a line), ${kind === "repeat" ? "times (a count) or for (milliseconds)" : "for (milliseconds) or quiet in its object"} says when it stops`); // prettier-ignore
  // a text that names a kept value (`${hp}`) is made whole when the step is done: checked here with a stand-in
  const pattern = (written, of) => {
    try {
      return patternOf(templated(written) ? written.replace(KEPT, "0") : written, of);
    } catch (error) {
      return refuse(error.message.replace(/^play: /, ""));
    }
  };
  const held = (ms, of) =>
    isCount(ms) && ms > 0 ? ms : refuse(`${of} ${shown(ms)}: a number of milliseconds over 0`);
  const mouse = (button) =>
    MOUSE_BUTTONS.includes(button)
      ? button
      : refuse(`names the mouse's button ${shown(button)}: ${MOUSE_BUTTONS.join(", ")}`);

  const action = { kind: kind ?? "wait" };
  /** The texts of the step that name a kept value, as written: made whole as it is done. */
  const templates = {};
  if (kind === "command") {
    const commands = [step.command].flat();
    if (!commands.length || !commands.every((each) => isText(each) && !/[\r\n]/.test(each)))
      refuse(
        `gives the command ${shown(step.command)}: a console command, or a list of them, each on one line`,
      );
    action.commands = commands;
    if (commands.some(templated)) templates.commands = commands;
  } else if (kind === "section") {
    if (!(typeof step.section === "string" && SHOT_NAME.test(step.section)))
      refuse(`opens the section ${shown(step.section)}: a name of letters, digits, _ and -`);
    const strange = Object.keys(step).filter((key) => key !== "section" && key !== "onFail");
    if (strange.length) refuse(`opens a section and has ${strange.join(", ")}: a section's step holds its name and onFail only`); // prettier-ignore
    action.name = step.section;
  } else if (kind === "travel") {
    if (!(step.travel === true || (typeof step.travel === "string" && MAP_NAME.test(step.travel))))
      refuse(`travels to ${shown(step.travel)}: true, or the name of the map the way leads to`);
    if (step.until !== undefined) refuse("has until and travel: a travel waits for the next map by itself");
    if (!part.travel)
      refuse("travels to another map, and the profile names no way to (play.travel: the commands and the line of the next map's server)"); // prettier-ignore
    action.map = step.travel === true ? null : step.travel;
    action.commands = commandsOf(part.travel.commands, {}, [], "play.travel");
    action.within = step.within ?? null;
  } else if (kind === "say") {
    action.commands = sayCommands(part, step.say, where);
    action.kind = "command";
  } else if (kind === "walk") {
    const to = step.to ?? "forward";
    if (!Object.hasOwn(WALKS, to)) refuse(`walks to ${shown(to)}: ${Object.keys(WALKS).join(", ")}`);
    // a walk that moves him nowhere stops the run (he stands in something solid): see the button's
    Object.assign(action, { kind: "button", button: WALKS[to], ms: held(step.walk, "walks for") });
  } else if (kind === "turn") {
    if (!(isNumber(step.turn) && step.turn !== 0))
      refuse(`turns ${shown(step.turn)}: degrees, over 0 to the left and under 0 to the right`);
    // by time where the view cannot be set: see TURNING at the head of this file
    const ms = Math.max(1, Math.round((Math.abs(step.turn) / part.yawspeed) * 1000));
    Object.assign(action, { kind: "button", button: step.turn > 0 ? "left" : "right", ms, turn: step.turn });
  } else if (kind === "look") {
    if (step.look !== undefined && !(isNumber(step.look) && Math.abs(step.look) <= 89))
      refuse(`looks ${shown(step.look)}: degrees up, from -89 (down) to 89`);
    if (step.face !== undefined && !isNumber(step.face))
      refuse(`faces ${shown(step.face)}: a yaw in degrees, 0 along +x and 90 along +y`);
    if (step.face !== undefined) action.yaw = step.face;
    if (step.look !== undefined) action.pitch = step.look;
    // a pan: the view eased there over that time, by the shorter way round (a camera's move, for a clip)
    if (step.ms !== undefined) action.ms = held(step.ms, "turns the view over");
  } else if (kind === "face") {
    if (!isNumber(step.face))
      refuse(`faces ${shown(step.face)}: a yaw in degrees, 0 along +x and 90 along +y`);
    Object.assign(action, { kind: "look", yaw: step.face });
  } else if (kind === "button") {
    if (!(typeof step.button === "string" && BUTTON_NAME.test(step.button)))
      refuse(
        `holds the button ${shown(step.button)}: a button's name without its +, such as jump, duck, use, attack`,
      );
    Object.assign(action, { button: step.button, ms: held(step.ms, "holds its button for") });
  } else if (kind === "hold") {
    if (!isText(step.hold)) refuse(`holds ${shown(step.hold)}: a key, such as "w" or "Space"`);
    Object.assign(action, { key: step.hold, ms: held(step.ms ?? HOLD, "holds its key for") });
  } else if (kind === "record") {
    if (!(step.record === false || (typeof step.record === "string" && SHOT_NAME.test(step.record))))
      refuse(`records ${shown(step.record)}: a clip's name (letters, digits, _ and -), or false to end the clip`);
    action.clip = step.record || null;
  } else if (kind === "press") {
    if (!isText(step.press)) refuse(`presses ${shown(step.press)}: a key, such as "e" or "Enter"`);
    action.key = step.press;
  } else if (kind === "click") {
    if (!(Array.isArray(step.click) && step.click.length === 2 && step.click.every(isCount)))
      refuse(`clicks ${shown(step.click)}: [x, y], a place of the page in its pixels`);
    [action.x, action.y] = step.click;
  } else if (kind === "mouse") {
    Object.assign(action, { mouse: mouse(step.mouse), ms: held(step.ms, "holds the mouse's button for") });
  } else if (kind === "mouseDown" || kind === "mouseUp") {
    action.mouse = mouse(step[kind]);
  } else if (kind === "tap") {
    const every = step.every ?? TAP_EVERY;
    const ms = held(step.ms ?? Math.min(TAP, every), "holds the mouse's button for");
    if (ms > every) refuse(`holds the button ${ms} ms and taps every ${every}: a tap is over before the next`);
    Object.assign(action, { mouse: mouse(step.tap), ms, times: step.times ?? 1, every });
  } else if (kind === "faceAt") {
    if (step.faceAt === "target") {
      finds("faces the nearest enemy");
      Object.assign(action, { target: true, radius: far(step.radius ?? RADIUS, "looks for an enemy within") });
    } else if (place(step.faceAt)) action.place = [...step.faceAt];
    else refuse(`faces ${shown(step.faceAt)}: [x, y, z], a place in the map's units, or "target" for the nearest enemy`); // prettier-ignore
  } else if (kind === "repeat") {
    if (!Array.isArray(step.repeat) || !step.repeat.length)
      refuse(`repeats ${shown(step.repeat)}: a list of steps, such as [{ faceAt: "target" }, { tap: "left" }]`);
    action.actions = step.repeat.map((each, index) => actionOf(each, `${where}.${index + 1}`, part, pause));
    Object.assign(action, { times: step.times ?? null, for: step.for ?? null });
  } else if (kind === "fight") {
    const asked = step.fight === true ? {} : step.fight;
    if (!asked || typeof asked !== "object" || Array.isArray(asked))
      refuse(`fights ${shown(step.fight)}: true, or an object such as { heal: 0.5, radius: 600 }`);
    const unknownHere = Object.keys(asked).filter((key) => !FIGHT.includes(key));
    if (unknownHere.length) refuse(`fights with ${unknownHere.join(", ")}, which no fight has: ${FIGHT.join(", ")}`);
    finds("fights the nearest enemy");
    if (asked.heal !== undefined && !(isNumber(asked.heal) && asked.heal > 0 && asked.heal <= 1))
      refuse(`heals under ${shown(asked.heal)}: a share of the player's health, over 0 and up to 1`);
    if (asked.heal !== undefined && !(part.heal && part.fight.health))
      refuse(
        "heals, and the profile does not say how (play.heal) or by what line the player's health is known (play.fight.health)",
      );
    if (asked.post !== undefined && !place(asked.post))
      refuse(`is held at ${shown(asked.post)}: post is [x, y, z], where the player is put back after a death`);
    if (asked.post !== undefined && !part.goto)
      refuse("has a post, and the profile names no command that puts the player at a place (play.goto)");
    if (asked.attack !== undefined && !(Array.isArray(asked.attack) && asked.attack.length))
      refuse(`strikes with ${shown(asked.attack)}: attack is the steps of one blow, such as [{ tap: "left" }]`);
    action.actions = (asked.attack ?? part.fight.attack).map((each, index) =>
      actionOf(each, `${where}'s blow, step ${index + 1}`, part, pause),
    );
    if (action.actions.some((each) => LOOPS.includes(each.kind) || each.until))
      refuse("strikes with steps that wait or repeat: a blow is done and over");
    Object.assign(action, {
      radius: far(asked.radius ?? RADIUS, "looks for an enemy within"),
      heal: asked.heal ?? null,
      post: asked.post ? [...asked.post] : null,
      chase: asked.chase === undefined ? null : far(asked.chase, "walks at an enemy farther than"),
      quiet: asked.quiet === undefined ? null : held(asked.quiet, "is over when no enemy was found for"),
      for: step.for ?? null,
    });
    // what it goes for first: words of a name, the first the most
    action.prefer = asked.prefer === undefined ? [] : [asked.prefer].flat();
    if (asked.prefer !== undefined && !(action.prefer.length && action.prefer.every((word) => typeof word === "string" && WORD.test(word)))) // prettier-ignore
      refuse(`prefers ${shown(asked.prefer)}: a word of an enemy's name ("lantern"), or a list of them, the first preferred most`); // prettier-ignore
    if (action.prefer.length && typeof part.target !== "function" && !part.target.prefer)
      refuse("prefers an enemy, and the profile names no way to ask the game for one (play.target.prefer)");
    if (action.prefer.length && typeof part.target !== "function") {
      action.prefers = action.prefer.map((word) => commandsOf(part.target.prefer, { word }, [word], "play.target.prefer")); // prettier-ignore
      action.unprefers = part.target.unprefer ? commandsOf(part.target.unprefer, {}, [], "play.target.unprefer") : null; // prettier-ignore
    }
    // round a crowd: only on the way to an enemy farther than chase
    if (asked.sidestep !== undefined && action.chase === null)
      refuse("sidesteps, which a fight does on its way to an enemy farther off than its chase: give chase too");
    action.sidestep = asked.sidestep === false ? null : asked.sidestep === undefined ? SIDESTEP : held(asked.sidestep, "sidesteps for"); // prettier-ignore
    // out of a place the game warns of
    action.dodge = null;
    if (asked.dodge !== undefined) {
      const dodge = typeof asked.dodge === "string" ? { line: asked.dodge } : asked.dodge;
      if (!dodge || typeof dodge !== "object" || Array.isArray(dodge) || dodge.line === undefined)
        refuse(`dodges ${shown(asked.dodge)}: the pattern of the line that warns, or { line, far, ms, hold }`);
      const strange = Object.keys(dodge).filter((key) => !DODGE.includes(key));
      if (strange.length) refuse(`dodges with ${strange.join(", ")}, which a dodge has not: ${DODGE.join(", ")}`);
      const line = pattern(dodge.line, "dodges at");
      if (/\(\?<x>/.test(line.source) !== /\(\?<y>/.test(line.source))
        refuse(`dodges at ${line}, which names one of the groups (?<x>...) and (?<y>...): the place is both, or neither`); // prettier-ignore
      action.dodge = {
        line,
        far: far(dodge.far ?? DODGE_FAR, "dodges as far as"),
        ms: held(dodge.ms ?? DODGE_MS, "dodges for at most"),
        hold: dodge.hold === 0 ? 0 : held(dodge.hold ?? DODGE_HOLD, "after a dodge walks at nobody for"),
      };
    }
    // an enemy it cannot get at, a ranged weapon, an end by quiet without the line: cli/play-fight.mjs
    fightOptionsOf(asked, action, part, { refuse, held, far, commandsOf, until: step.until !== undefined });
    // a place gone to is asked a little over itself (the profile's lift): he drops onto the floor
    const goesTo = ([x, y, z]) => commandsOf(part.goto, { x, y, z: z + part.lift }, [x, y, z + part.lift], "play.goto");
    if (action.post) action.back = goesTo(action.post);
    if (part.goto) action.goesTo = goesTo;
    if (action.heal !== null) action.heals = commandsOf(part.heal, {}, [], "play.heal");
  } else if (kind === "goto") {
    if (!place(step.goto))
      refuse(`goes to ${shown(step.goto)}: [x, y, z], the middle of the player's box in the map's units`);
    if (!part.goto)
      refuse(
        "goes to a place, and the profile names no command that puts the player at one (play.goto): the engine has none of its own. Walk there, or fly with noclip",
      );
    const [x, y, z] = step.goto;
    // a little over the place (the profile's lift): he drops onto a floor, where at its height a brush a unit or
    // two high (a path) holds him fast; he is looked for at the place asked
    action.commands = commandsOf(part.goto, { x, y, z: z + part.lift }, [x, y, z + part.lift], "play.goto");
    action.place = [x, y, z];
  } else if (kind === "census") {
    if (!(step.census === true || (isCount(step.census) && step.census > 0)))
      refuse(`counts within ${shown(step.census)}: a distance in the map's units over 0, or true (${CENSUS_RADIUS})`);
    if (!part.census)
      refuse("counts the monsters, and the profile names no way to ask the game (play.census)");
    action.radius = step.census === true ? CENSUS_RADIUS : step.census;
  } else if (kind === "where") {
    if (!(step.where === true || (typeof step.where === "string" && SHOT_NAME.test(step.where))))
      refuse(`asks where under the name ${shown(step.where)}: letters, digits, _ and -, or true for no name`);
    action.name = step.where === true ? "" : step.where;
  } else if (kind === "map") {
    if (!(typeof step.map === "string" && MAP_NAME.test(step.map)))
      refuse(`loads the map ${shown(step.map)}: the map's name as the console's \`map\` takes it`);
    action.map = step.map;
  } else if (expects) {
    action.pattern = pattern(step[kind], `${kind === "expect" ? "expects" : "expects no"}`);
    if (templated(step[kind])) templates.pattern = step[kind];
    action.within = step.within ?? 0;
    action.since = step.since ?? "run";
  }
  if (step.until !== undefined) {
    action.until = pattern(step.until, "waits until");
    if (templated(step.until)) templates.until = step.until;
    // its line said before it began: a fight's ends it at once (an area that fell quiet while another was
    // fought stays quiet); a wait's and a block's are told of; a deed's is the answer to nothing it did
    action.already = step.already ?? (kind === "fight" ? "pass" : !kind || kind === "repeat" ? "warn" : "wait");
    action.within = step.within ?? WITHIN;
    // a tap is tapped again as often as it taps
    action.every = loops ? null : kind === "tap" ? action.every : (step.every ?? null);
    // a step that only waits hears from the last that did a thing: see `until` at the head of playOf
    action.since = step.since ?? (kind ? "step" : BEFORE);
  }
  const idle = !kind || READS.includes(kind) || kind === "map" || kind === "travel" || step.until !== undefined || loops; // prettier-ignore
  // a tap is followed by what is left of its `every`, so that taps in steps of their own keep one time
  action.wait = step.wait ?? (idle ? 0 : kind === "tap" ? action.every - action.ms : pause);
  action.shot = step.shot ?? null;
  if (step.onFail !== undefined) action.onFail = step.onFail;
  if (keeps) action.keep = keeps.map((name) => ({ name, pattern: pattern(step.keep[name], `keeps ${name} by`) }));
  if (Object.keys(templates).length) action.templates = templates;
  action.step = step;
  return action;
}

// ── the run ─────────────────────────────────────────────────────────────────
/** What a driver has to be able to do for an action, as a sentence's end; null when every driver can. */
function wantOf(action, driver) {
  const has = (...names) => names.every((name) => typeof driver[name] === "function");
  if ((action.until || ["expect", "expectNot", "travel", "census"].includes(action.kind) || action.keep) && !has("lines"))
    return "waits for what the game says, and this driver hears nothing (it has no lines())";
  if (action.kind === "look" && !has("look"))
    return "sets the view, which this driver cannot (it has no look())";
  if (action.kind === "where" && !has("view"))
    return "asks where the player is, which this driver does not know (it has no view())";
  if (["mouse", "mouseDown", "mouseUp", "tap"].includes(action.kind) && !has("mouseDown", "mouseUp"))
    return "holds a button of the mouse, and this driver has no mouse (no mouseDown() and mouseUp())";
  if ((action.kind === "faceAt" || action.kind === "fight") && !has("view", "look"))
    return "turns the view to a place, which this driver cannot (it has no view() and look())";
  if ((action.target || action.kind === "fight") && !has("lines"))
    return "finds an enemy by what the game answers, and this driver hears nothing (it has no lines())";
  for (const inner of action.actions ?? []) {
    const want = wantOf(inner, driver);
    if (want) return want;
  }
  return null;
}

const rounded = (value) => Math.round(value * 10) / 10;
const placeText = (origin) => (origin ? origin.map(rounded).join(" ") : "nowhere yet");

/**
 * A game kept up for many runs: the engine is started once (`ready`), and each `run` loads a map, or stays
 * in the one it is in, does its steps and writes its pictures, its log and its sheet. The driver is closed
 * by `close()` and by nothing else, so a second run pays for its map and not for the engine.
 *
 *   const session = play.playSession({ driver, mod });
 *   const first = await session.run({ map: "yard", steps, out: "work/first" });
 *   const second = await session.run({ map: "road", steps: more, out: "work/second" });   // some seconds later
 *   await session.close();
 *
 *   driver   a driver, as `play` takes one
 *   mod      the mod's profile
 *   pause    milliseconds waited after a step that does something and gives no `wait` (1000)
 *   tell     a function handed a line as each thing is done; a run may give its own
 *   over     folders laid over the game's files, marked as the session begins: `[{ path: "msc", folder }]`
 *            (the folder's files are the engine's `<path>/...`). A run that names one again puts what changed
 *            in it since (see the run's `over`)
 *
 * `session.state` is `{ up, map, entered, runs }`. A run takes:
 *   map        the map to load, as `map <name>` takes it. Loaded afresh even when it is the map the session
 *              is in (monsters back, doors shut), unless `stay` is true
 *   stay       true: nothing is loaded; the steps go on from where the last run left the player
 *   steps      what to do once in the game (`playOf` has the format)
 *   out        the folder the pictures and the log go to; it is made
 *   expect, expectNot   patterns the whole run is held to, beside its steps' own: checked at its end
 *   put        files written into the engine before the map loads: `[{ path: "msc/maps/yard.bsp", file }]`
 *              (or `bytes`). A driver that cannot (`put`) refuses. The map the session is in is left first
 *              (the driver's `leave`): a game may write its own files as a map ends, over what was put
 *   over       folders laid over the game's files, `[{ path: "msc", folder }]`: every file in one that is new
 *              or changed (its size or its time) since the session marked it is put, as `put` puts, and the
 *              mark is moved on. A game that is up reads a file once (a model it failed to find stays
 *              failed): this is how one edited since is tried without starting the engine again. A folder
 *              the session has not marked (not given to `playSession`, nor to a run before) is marked by
 *              this run, and nothing of it is put
 *   loads, pause, tell   as `play`'s
 *   sheet      false for no contact sheet (unless told: `sheet.png`, when a picture was taken)
 *   shrink     each picture written this many times smaller each way (unless told: 1, the page's size);
 *              the sheet is drawn from them at its own size all the same
 *
 * and resolves to what happened:
 *   { map, out, took,
 *     pictures      the PNG files written, in the order taken (their paths)
 *     sheet         the contact sheet of them, `<out>/sheet.png`, or null
 *     steps         one for each thing done: { part: "load" | "enter" | "steps", index, kind, step, at, took,
 *                   picture, heard }: `at` and `took` in milliseconds from the run's start, `picture` its
 *                   file or null, `heard` the line an `until` waited for. A step of a `repeat`'s block is
 *                   there once for each time it was done, with `where` ("step 3.2") and its index in the block
 *     expectations  one for each `expect` and `expectNot`: { where, kind, pattern, passed, line }
 *     fights        one for each `fight` step: { where, seconds, ended: "line" | "time" | "quiet", line, rounds, blows,
 *                   dealt: { hits, sum, missed }, taken: { hits, sum }, heals, deaths, down (seconds dead),
 *                   slain: [names], enemies: { asked, none, most, mean, closeMost, closeMean }, health:
 *                   { least, most } }, counted by the profile's `play.fight` patterns; with `prefer`, `prefer:
 *                   { words, slain, rounds, letBe }` (the slain whose names hold a word; the rounds that faced one;
 *                   the times one was let be);
 *                   with `chase`, `sidesteps`; with `dodge`, `dodge: { warned, dodged, clear }`
 *     passed        true when every expectation held
 *     lines         what was heard in the run: { at, kind, text }, `at` in milliseconds from its start and
 *                   `kind` "console", "error", a message's name, "where", or "play" for the run's own notes
 *     log           the same as text lines; logFile: <out>/log.txt; linesFile: <out>/log.jsonl (a JSON
 *                   object a line); resultFile: <out>/result.json (this, without the lines) }
 *
 * A run that cannot go on (a line waited for that never came, a driver that failed) throws, with the step it
 * was at named; the log, the sheet and result.json are written all the same and named on the error
 * (`pictures`, `logFile`, `sheet`, `expectations`). An expectation that does not hold does not stop a run:
 * it is in `expectations`, and `passed` is false.
 */
export function playSession({ driver, mod, pause: sessionPause, tell: sessionTell, over: sessionOver = [] } = {}) {
  const lacks = DRIVER.filter((name) => typeof driver?.[name] !== "function");
  if (lacks.length)
    throw new Error(
      `play: driver is an object with ${DRIVER.join(", ")} (browserDriver makes one)${driver ? `: this one has no ${lacks.join(", ")}` : ""}`,
    );
  const part = playPartOf(mod);
  // a driver that tells itself when the player is in a map says by what line (the Steam game's, which never
  // says the profile's: cli/play-native.mjs)
  if (driver.loaded) part.loaded = patternOf(driver.loaded, "driver.loaded");
  /** The folders laid over the game's, each with its files' marks as the engine last had them. */
  const laid = new Map();
  for (const each of oversOf(sessionOver)) laid.set(each.key, { ...each, marks: marksOf(each.folder) });
  const hears = typeof driver.lines === "function";
  const state = { up: false, map: null, entered: false, runs: 0 };
  /** Everything heard since the session began: `{ at, kind, text }`, `at` the clock's milliseconds. */
  const heard = [];
  let taken = 0;
  /** Whether a turn is still set exactly: false once the driver's view could not be read. */
  let exact = true;
  /** The lines an `until` has stopped at, in any run of the session: no other stops at one of them. */
  const stoppedAt = new WeakSet();
  /** Where in `heard` the map the session is in began (its `map` command, or its server's line): what a
   * step's `already` looks back to; and where the last step that waited for each pattern ended. */
  let mapStart = 0;
  const lastWaited = new Map();
  /** The values steps kept (`keep`), by name: a run that stays has those of the runs before it. */
  const kept = new Map();
  /** What the runs since a map was last loaded came to (a run that stays adds to them): summary.json's chain. */
  let chain = [];
  const readers = Object.fromEntries(
    Object.entries(part.messages).map(([name, how]) => [
      name,
      typeof how === "function" ? how : MESSAGE_READERS[how],
    ]),
  );
  /** What the driver heard since the last asking, read and kept. */
  const listen = async () => {
    if (!hears) return;
    const fresh = (await driver.lines(taken)) ?? [];
    taken += fresh.length;
    const was = heard.length;
    for (const each of fresh) {
      if (each.text !== undefined) heard.push({ at: each.at, kind: each.kind, text: String(each.text) });
      else if (readers[each.kind])
        for (const text of [readers[each.kind](each.bytes) ?? []].flat())
          if (isText(text)) heard.push({ at: each.at, kind: each.kind, text: String(text) });
    }
    // the map is followed by its server's line, however the player came there (a way walked through)
    if (part.travel)
      for (let at = was; at < heard.length; at++) {
        const spawned = heard[at].kind === OWN ? null : part.travel.spawned.exec(heard[at].text);
        if (spawned?.[1]) [state.map, mapStart] = [spawned[1], at];
      }
  };
  const note = (kind, text) => heard.push({ at: Date.now(), kind, text });
  /** The first line from `from` on that matches, is not the run's own, and is none of `but` (a WeakSet). */
  const found = (pattern, from, but) => {
    for (let at = from; at < heard.length; at++)
      if (heard[at].kind !== OWN && !but?.has(heard[at]) && pattern.test(heard[at].text)) return heard[at];
    return null;
  };
  /** The driver's own time where it keeps one (a test's fake), the clock's otherwise: milliseconds. */
  const clock = () => (typeof driver.clock === "function" ? driver.clock() : Date.now());
  /** Waits until a line from `from` on matches: the line, or null when `within` ran out. */
  const waitFor = async (pattern, from, within, every, again, but) => {
    for (let waited = 0, last = 0; ; waited += POLL) {
      await listen();
      const line = found(pattern, from, but);
      if (line || waited >= within) return line;
      if (every && waited - last >= every) {
        last = waited;
        await again();
      }
      await driver.wait(POLL);
    }
  };
  const lastLines = (from) => {
    const said = heard.slice(from).filter((each) => each.kind !== OWN);
    return said.length
      ? `The last it said: ${said.slice(-LAST_LINES).map((each) => shown(each.text)).join(", ")}` // prettier-ignore
      : "It said nothing meanwhile";
  };
  /** The enemies fights found they could not get at, by the game's id: passed over by every fight until a map loads. */
  const unreachable = new Map();
  /** The living monsters within `radius`, as the profile's `play.census` counts them: `{ count, ones }`, or null
   * where the game did not answer or cannot be asked (cli/play-fight.mjs reads it). */
  const census = async (radius = CENSUS_RADIUS) => {
    if (!part.census || !hears) return null;
    await listen();
    const from = heard.length;
    for (const [index, command] of commandsOf(part.census.commands, { radius }, [radius], "play.census").entries()) {
      if (index) await driver.wait(BETWEEN);
      await driver.command(command);
    }
    const head = await waitFor(part.census.count, from, part.census.within);
    if (!head) return null;
    const count = Number(part.census.count.exec(head.text).groups.count);
    const after = () => heard.slice(heard.indexOf(head)).filter((each) => each.kind !== OWN).map((each) => each.text);
    // each one's line comes with the count's: a moment more for the last of them
    for (let waited = 0; after().filter((text) => part.census.one.test(text)).length < count && waited < part.census.within; waited += POLL) { // prettier-ignore
      await driver.wait(POLL);
      await listen();
    }
    return censusOf(after(), part.census);
  };
  /** What is left, for the sentence of a failure: " left: Wolf 114 hp at (780,1322,0), 1 of 1." by a census done
   * then; nothing where the game cannot be asked. */
  const leftNow = async () => {
    if (!part.census || !hears) return "";
    try {
      return ` ${leftOf(await census())}.`;
    } catch (error) {
      return ` (A census was asked, and failed: ${error.message})`;
    }
  };

  async function ready() {
    if (state.up) return;
    await driver.ready();
    state.up = true;
  }

  async function run({
    map,
    stay = false,
    steps = [],
    out,
    loads,
    pause = sessionPause,
    tell = sessionTell,
    expect = [],
    expectNot = [],
    put = [],
    sheet = true,
    shrink = 1,
    over = [],
    from = null,
  } = {}) {
    const staying = stay === true;
    if (staying && !state.entered)
      throw new Error("play: stay goes on from the run before, and this session has entered no map yet");
    if (!staying && !(typeof map === "string" && MAP_NAME.test(map)))
      throw new Error(
        `play: map is the map's name as the console's \`map\` takes it, such as "orchard", not ${shown(map)}`,
      );
    if (!isText(out))
      throw new Error(`play: out is the folder the pictures and the log go to, not ${shown(out)}`);
    if (!(Number.isInteger(shrink) && shrink > 0))
      throw new Error(`play: shrink is how many times smaller each picture is written, a whole number over 0, not ${shown(shrink)}`); // prettier-ignore
    const loading = loads ?? part.loads;
    if (!isCount(loading)) throw new Error(`play: loads is a number of milliseconds, not ${shown(loads)}`);
    const entering = playOf(part.enter, { mod, pause, what: "the profile's enter step" });
    const asked = playOf(steps, { mod, pause });
    /** The step the run begins at: `from`, a section's name or a step's number (1 is the first). */
    let startAt = 0;
    if (from !== null && from !== undefined) {
      const number = Number.isInteger(from) ? from : /^\d+$/.test(String(from)) ? Number(from) : null;
      const names = asked.filter((action) => action.kind === "section").map((action) => action.name);
      startAt = number !== null ? number - 1 : asked.findIndex((action) => action.kind === "section" && action.name === from); // prettier-ignore
      if (!(startAt >= 0 && startAt < asked.length))
        throw new Error(
          `play: from ${shown(from)}: ${number !== null ? `the steps are numbered 1 to ${asked.length}` : `the steps have no section of that name (${names.length ? names.join(", ") : "they have none"})`}`,
        ); // prettier-ignore
    }
    const held = [expect, expectNot].map((list, which) =>
      [list].flat().map((written) => ({
        kind: which ? "expectNot" : "expect",
        pattern: patternOf(written, which ? "expectNot" : "expect"),
      })),
    );
    for (const [list, name] of [[entering, "the profile's enter step"], [asked, "step"]]) // prettier-ignore
      list.forEach((action, index) => {
        const want = wantOf(action, driver);
        if (want) throw new Error(`play: ${name} ${index + 1} ${want}`);
      });
    if (held.flat().length && !hears)
      throw new Error("play: an expectation reads what the game says, and this driver hears nothing");
    if (!Array.isArray(put) || !put.every((each) => isText(each?.path) && (each.bytes || isText(each.file))))
      throw new Error(
        `play: put is a list of { path, file } (or bytes): a place in the engine's files and what goes there, not ${shown(put)}`,
      );
    const overs = oversOf(over);
    /** What changed in each folder laid over since the session marked it, as files to put; and the new marks. */
    const moved = overs.map((each) => {
      const marks = marksOf(each.folder);
      const had = laid.get(each.key)?.marks;
      const files = had ? [...marks].filter(([file, mark]) => had.get(file) !== mark).map(([file]) => file) : null;
      return { ...each, marks, files };
    });
    put = [
      ...put,
      ...moved.flatMap(({ path, folder, files }) => (files ?? []).map((file) => ({ path: `${path}/${file}`, file: join(folder, file) }))), // prettier-ignore
    ];
    if (put.length && typeof driver.put !== "function")
      throw new Error("play: this driver cannot put a file into the engine (it has no put())");

    mkdirSync(out, { recursive: true });
    const began = Date.now();
    const pictures = [];
    const done = [];
    const expectations = [];
    const marks = new Map();
    const down = new Set();
    const fights = [];
    let first = heard.length;
    let mapFrom = first;
    /** Where the last step that did a thing began: what "deed" reads from. */
    let before = first;
    /** The run's sections, each as it is timed and counted; the one the steps are in; the steps that ended
     * at once by a line said before they began (`already: "pass"`), by where they are. */
    const sections = [];
    let current = null;
    const early = new Set();
    /** The clip being filmed (`record`), by its name, and those written: `NN_name.mp4`, numbered with the pictures. */
    let clip = null;
    const clips = [];
    const endClip = async () => {
      const name = clip;
      clip = null;
      const frames = await driver.recordStop();
      const { encodeTimed } = await import("../check/video.mjs");
      const file = join(out, `${String(pictures.length + clips.length).padStart(2, "0")}_${name}.mp4`);
      writeFileSync(file, await encodeTimed(frames));
      clips.push(file);
      const seconds = frames.length > 1 ? (frames[frames.length - 1].at - frames[0].at) / 1000 : 0;
      const said = `clip ${file}: ${frames.length} frames drawn in ${seconds.toFixed(1)} s (${(frames.length / Math.max(seconds, 0.001)).toFixed(0)} a second)`; // prettier-ignore
      note(OWN, said);
      tell?.(said);
    };
    const picture = async (name) => {
      const file = join(out, `${String(pictures.length).padStart(2, "0")}_${name}.png`);
      await driver.shot(file);
      if (shrink > 1)
        try {
          writeFileSync(file, smallerPng(readFileSync(file), shrink));
        } catch {
          // a picture that is not a PNG (a driver of another kind) is kept as the driver wrote it
        }
      pictures.push(file);
      // what was said before the picture is heard before it: "since the picture" is then from here
      await listen();
      marks.set(name, heard.length);
      return file;
    };
    /** One thing done and written down: `does` does it, `shot` names the picture taken after it. */
    const record = async (phase, index, kind, step, shot, does, named) => {
      const at = Date.now() - began;
      let file = null;
      let line = null;
      const where =
        named ??
        (phase === "load"
          ? "loading the map"
          : `${phase === "enter" ? "the profile's enter step" : "step"} ${index + 1}`);
      try {
        line = (await does(where)) ?? null;
        if (shot) file = await picture(shot);
      } catch (error) {
        throw new Error(`${/^play: /.test(error.message) ? "" : "play: "}${error.message} (at ${where})`, {
          cause: error,
        });
      }
      const entry = { part: phase, index, kind, step, at, took: Date.now() - began - at, picture: file };
      if (line) entry.heard = line.text;
      if (named) entry.where = named;
      if (early.delete(where)) entry.already = true;
      done.push(entry);
      const said = lineOf(entry);
      note(OWN, said.trim());
      tell?.(said);
      return entry;
    };
    /** An expectation looked at and written down; it never stops the run. */
    const expecting = async ({ kind, pattern, within = 0, since = "run" }, where, stepFrom) => {
      if (!SINCE.includes(since) && !marks.has(since))
        throw new Error(`play: no picture named ${shown(since)} was taken before, to read since`);
      const from = since === "run" ? first : since === "map" ? mapFrom : since === "step" ? stepFrom : marks.get(since); // prettier-ignore
      // an expectation that a line is not there watches for it; one that it is there waits for it
      const line = within ? await waitFor(pattern, from, within) : (await listen(), found(pattern, from));
      const passed = kind === "expect" ? Boolean(line) : !line;
      const entry = { where, kind, pattern: String(pattern), passed, line: line?.text ?? null };
      expectations.push(entry);
      // told at the run's end by whoever reports it, and kept in the log where it was asked
      note(OWN, expectationLine(entry));
    };
    /** Where a step reads from, by its `since`; `from` is where the step itself began. */
    const sinceOf = (since, from) => {
      if (!SINCE.includes(since) && since !== BEFORE && !marks.has(since))
        throw new Error(`play: no picture named ${shown(since)} was taken before, to read since`);
      return since === "run" ? first : since === "map" ? mapFrom : since === "step" ? from : since === BEFORE ? Math.min(before, from) : marks.get(since); // prettier-ignore
    };
    /** The view turned to a place: yaw and pitch from where the player's eyes are. */
    const aim = async ([x, y, z]) => {
      const { origin } = await driver.view();
      if (!origin) throw new Error("play: the view cannot be turned to a place: the player is nowhere yet");
      const [dx, dy, dz] = [x - origin[0], y - origin[1], z - origin[2] - part.eye];
      const flat = Math.hypot(dx, dy);
      const to = { pitch: Math.max(-89, Math.min(89, (Math.atan2(dz, flat) * 180) / Math.PI)) };
      // straight over or under him there is no way to turn to: the yaw stays
      if (flat > 0.01) to.yaw = (Math.atan2(dy, dx) * 180) / Math.PI;
      await driver.look(to);
      return Math.hypot(flat, dz);
    };
    /** The nearest living enemy within `radius`, as the profile finds one, or null: `{ origin, ... }`. */
    const targetOf = async (radius, prefer = []) => {
      await listen();
      const asked = heard.length;
      if (typeof part.target === "function") {
        const told = await part.target({
          radius,
          command: (text) => driver.command(text),
          heard: async (pattern, within = TARGET_WITHIN) => {
            const expression = patternOf(pattern, "play.target: heard");
            const line = await waitFor(expression, asked, within);
            return line ? expression.exec(line.text) : null;
          },
          view: () => driver.view(),
          prefer,
        });
        if (told == null) return null;
        if (!(Array.isArray(told.origin) && told.origin.length === 3 && told.origin.every(isNumber)))
          throw new Error(`play: the profile's play.target gave ${shown(told)}, where { origin: [x, y, z] } or null was wanted`); // prettier-ignore
        return told;
      }
      const { commands, answer, none, within } = part.target;
      const said = commandsOf(commands, { radius }, [radius], "play.target");
      for (const [index, command] of said.entries()) {
        if (index) await driver.wait(BETWEEN);
        await driver.command(command);
      }
      const either = { test: (text) => answer.test(text) || Boolean(none?.test(text)) };
      const line = await waitFor(either, asked, within);
      if (!line)
        throw new Error(
          `play: the game did not answer ${shown(said.join("; "))} in ${rounded(within / 1000)} seconds (the profile's play.target): does this map have that command? ${lastLines(asked)}`,
        );
      const groups = answer.exec(line.text)?.groups;
      if (!groups) return null;
      const number = (text) => (text === undefined || text === "" || !Number.isFinite(Number(text)) ? undefined : Number(text)); // prettier-ignore
      const origin = [groups.x, groups.y, groups.z].map(Number);
      if (!origin.every(isNumber))
        throw new Error(`play: the place of an enemy does not read as numbers in ${shown(line.text)} (the profile's play.target.answer)`); // prettier-ignore
      return {
        origin,
        ...defined({ id: groups.id, name: groups.name }),
        ...defined({ hp: number(groups.hp), far: number(groups.far), count: number(groups.count), close: number(groups.close) }), // prettier-ignore
      };
    };
    /** Steps of a block done one after another, each written down; true to `ends` stops them. */
    const block = async (actions, where, ends) => {
      for (const [index, inner] of actions.entries()) {
        const named = `${where}.${index + 1}`;
        await record("steps", index, inner.kind, inner.step, inner.shot, () => act(inner, named), named);
        if (await ends?.()) return true;
      }
      return false;
    };
    /**
     * A block done again and again, as `repeat` and `fight` are: `round` does one pass and gives true when
     * the pass itself ends it. Gives the line it ended at, or null; stops the run when only `within`
     * bounded it and the line never came.
     */
    const again = async (action, where, from, round) => {
      const began = clock();
      // a time the caller set ends it quietly; the `within` of an `until` alone stops the run
      const quiet = action.for !== null || (action.times ?? null) !== null;
      const most = action.for ?? (action.until && !quiet ? action.within : Infinity);
      const but = stoppedAt;
      let line = null;
      let passes = 0;
      let over = false;
      const ended = async () => {
        if (action.until) {
          await listen();
          line = found(action.until, from, but);
        }
        return Boolean(line) || clock() - began >= most;
      };
      while (!(await ended())) {
        const at = clock();
        over = await round(ended, passes);
        passes++;
        if (over || line || (action.times && passes >= action.times)) break;
        // a pass that took no time would never come to its end by the clock
        if (clock() === at) await driver.wait(POLL);
      }
      if (line) stoppedAt.add(line);
      else if (action.until && !quiet && !over)
        throw new Error(
          `play: the game never said ${action.until} in the ${rounded(action.within / 1000)} seconds its ${action.kind} was given (${passes} ${passes === 1 ? "pass" : "passes"}). ${lastLines(from)}${await leftNow()}`,
        );
      return { line, passes, over, took: clock() - began };
    };
    /** The last line heard that matches, back to `from`: its first group as a number, or null. */
    const lastAmount = (pattern, from = 0) => {
      if (!pattern) return null;
      for (let at = heard.length - 1; at >= from; at--) {
        const read = heard[at].kind === OWN ? null : pattern.exec(heard[at].text);
        if (read) return Number(read[1]);
      }
      return null;
    };
    /** A fight: the nearest enemy faced and struck until its end, and what happened written down. */
    const fight = async (action, where, from) => {
      const lines = part.fight;
      const tally = {
        ...{ where, seconds: 0, ended: null, rounds: 0, blows: 0 },
        ...{ dealt: { hits: 0, sum: 0, missed: 0 }, taken: { hits: 0, sum: 0 } },
        ...{ heals: 0, deaths: 0, slain: [], down: 0 },
        ...{ enemies: { asked: 0, none: 0, most: 0, sum: 0, closeMost: 0, closeSum: 0, closeAsked: 0 } },
        ...{ health: { least: null, most: null } },
        ...(action.prefer.length ? { prefer: { words: action.prefer, slain: 0, rounds: 0, letBe: 0 } } : {}),
        ...(action.chase !== null && action.sidestep !== null ? { sidesteps: 0 } : {}),
        ...(action.dodge ? { dodge: { warned: 0, dodged: 0, clear: 0 } } : {}),
        ...(action.ranged ? { ranged: { item: action.ranged.item, shots: 0, hits: 0, draws: 0 } } : {}),
        ...(action.stuck ? { unreachable: [] } : {}),
      };
      const fightBegan = clock();
      let read = from;
      let fallen = null;
      let alone = null;
      let health = lastAmount(lines.health);
      let most = lastAmount(lines.maxHealth) ?? health;
      /** What was said since the last look, counted. */
      const count = () => {
        for (; read < heard.length; read++) {
          const { kind, text } = heard[read];
          if (kind === OWN) continue;
          const amount = (pattern) => {
            const got = pattern?.exec(text);
            return got ? (Number.isFinite(Number(got[1])) ? Number(got[1]) : 0) : null;
          };
          const dealt = amount(lines.dealt);
          const taken = amount(lines.taken);
          if (dealt !== null) (tally.dealt.hits++, (tally.dealt.sum += dealt));
          if (taken !== null) (tally.taken.hits++, (tally.taken.sum += taken));
          if (lines.missed?.test(text)) tally.dealt.missed++;
          const slain = lines.slain?.exec(text);
          if (slain) tally.slain.push(slain[1] ?? text);
          if (slain && tally.prefer && preferred(slain[1] ?? text)) tally.prefer.slain++;
          if (lines.died?.test(text) && fallen === null) {
            tally.deaths++;
            fallen = clock();
          }
          const now = amount(lines.health);
          if (now !== null) {
            health = now;
            if (fallen === null || now > 0) tally.health.least = Math.min(tally.health.least ?? now, now);
          }
          const top = amount(lines.maxHealth);
          if (top !== null) most = top;
          if (health !== null) most = Math.max(most ?? health, health);
        }
      };
      const done = async (inner) => {
        for (const [index, command] of inner.entries()) {
          if (index) await driver.wait(BETWEEN);
          await driver.command(command);
        }
      };
      const blow = async () => {
        for (const [index, inner] of action.actions.entries()) await act(inner, `${where}'s blow, step ${index + 1}`);
        tally.blows++;
      };
      /** The first word of `prefer` a name holds, or null. */
      const preferred = (name) =>
        action.prefer.find((word) => String(name ?? "").toLowerCase().includes(word.toLowerCase())) ?? null;
      /** The word the game was last told to prefer, by this fight; until when the preferred are let be. */
      let preferSaid = null;
      let letBe = -Infinity;
      /** The enemy to strike: of the words of `prefer`, the first that one within the radius has; else the nearest. */
      const find = async () => {
        // a preferred one that could not be got at is let be a while: the nearest meanwhile
        if (clock() < letBe) {
          if (preferSaid !== null && action.unprefers) await done(action.unprefers);
          preferSaid = null;
          return targetOf(action.radius);
        }
        if (!action.prefers) return targetOf(action.radius, action.prefer);
        let enemy = null;
        for (const [index, word] of action.prefer.entries()) {
          if (preferSaid !== word) {
            await done(action.prefers[index]);
            preferSaid = word;
          }
          enemy = await targetOf(action.radius);
          // none at all, or one of this word: the answer stands; else the next word is asked for
          if (!enemy || preferred(enemy.name) === word) return enemy;
        }
        return enemy;
      };
      /** Buttons held for a while and let go: a move the fight makes. Gives the milliseconds it took. */
      const moving = async (buttons, ms, stop) => {
        for (const button of buttons) await driver.command(`+${button}`);
        let went = 0;
        try {
          while (went < ms) {
            const step = Math.min(POLL, ms - went);
            await driver.wait(step);
            went += step;
            if (await stop?.()) break;
          }
        } finally {
          for (const button of buttons) await driver.command(`-${button}`);
        }
        return went;
      };
      /** The buttons that move the player towards a yaw of the world while his view is turned to `yaw`. */
      const towards = (way, yaw) => {
        const turned = ((way - yaw) * Math.PI) / 180;
        const [ahead, left] = [Math.cos(turned), Math.sin(turned)];
        return [
          ...(ahead > 0.38 ? ["forward"] : ahead < -0.38 ? ["back"] : []),
          ...(left > 0.38 ? ["moveleft"] : left < -0.38 ? ["moveright"] : []),
        ];
      };
      // a warning heard is dodged once; after a dodge he walks at nobody for its `hold`
      let warnedRead = from;
      let calm = -Infinity;
      let aside = 1;
      /** A line that warns of a blow to a place, dodged: true when he moved. */
      const evade = async () => {
        if (!action.dodge) return false;
        await listen();
        let warned = null;
        let said = "";
        for (; warnedRead < heard.length; warnedRead++) {
          const got = heard[warnedRead].kind === OWN ? null : action.dodge.line.exec(heard[warnedRead].text);
          if (got) [warned, said] = [got, heard[warnedRead].text];
        }
        if (!warned) return false;
        tally.dodge.warned++;
        const { far, ms, hold } = action.dodge;
        const named = warned.groups?.x !== undefined ? [Number(warned.groups.x), Number(warned.groups.y)] : null;
        const spot = named?.every(isNumber) ? named : null;
        const { origin, yaw = 0 } = await driver.view();
        if (!origin) return false;
        const off = (at) => Math.hypot(at[0] - spot[0], at[1] - spot[1]);
        if (spot && off(origin) >= far) {
          tally.dodge.clear++;
          note(OWN, `${where}: warned (${shown(said)}), and ${rounded(off(origin))} off it already`);
          return false;
        }
        // away from the place; straight over it (or with no place said), to one side and the other the next time
        aside = -aside;
        const way = spot && off(origin) > 8 ? (Math.atan2(origin[1] - spot[1], origin[0] - spot[0]) * 180) / Math.PI : yaw + 90 * aside; // prettier-ignore
        const away = async () => Boolean(spot) && off((await driver.view()).origin ?? origin) >= far;
        const took = await moving(towards(way, yaw), ms, away);
        const now = (await driver.view()).origin ?? origin;
        tally.dodge.dodged++;
        calm = clock() + hold;
        note(OWN, `${where}: dodged ${shown(said)}: ${spot ? `from ${rounded(off(origin))} to ${rounded(off(now))} off ${spot.join(" ")}` : `a step aside, ${rounded(Math.hypot(now[0] - origin[0], now[1] - origin[1]))} units`} in ${took} ms`); // prettier-ignore
        return true;
      };
      // ── an enemy it cannot get at, and a ranged weapon (cli/play-fight.mjs) ──
      /** Each enemy's time spent for nothing; whether the ranged weapon is in his hands; the hits before the last shot. */
      const progress = progressOf();
      let drawn = false;
      let shotAt = null;
      const keyOf = (enemy) => String(enemy.id ?? enemy.name ?? "");
      /** The ranged weapon put into his hands, and asked after where the profile can: the run stops when it is not. */
      const draw = async () => {
        const { ranged } = action;
        for (let tries = 1; ; tries++) {
          await done(ranged.draws);
          await driver.wait(ranged.drawn);
          if (!ranged.asks) break;
          await listen();
          const asked = heard.length;
          await done(ranged.asks);
          const said = await waitFor(ranged.answer, asked, TARGET_WITHIN);
          if (said && ranged.answer.exec(said.text).groups.held === "1") break;
          if (tries >= 2)
            throw new Error(`play: ${where} drew ${ranged.item} (${ranged.draws.join("; ")}) twice, and it is not in the player's hands: ${said ? shown(said.text) : "the game did not answer"}. Does the character carry it where the profile's play.ranged.draw takes it from (slot ${ranged.slot})?`); // prettier-ignore
        }
        drawn = true;
        tally.ranged.draws++;
        note("fight", `${where}: drew ${action.ranged.item}`);
      };
      /** What he held before put back into his hands, for the blows. */
      const sheathe = async () => {
        await done(action.ranged.backs);
        await driver.wait(action.ranged.drawn);
        drawn = false;
        note("fight", `${where}: put ${action.ranged.item} back, for the blows`);
      };
      /** One shot: aimed (higher, for its fall; each a little over or under the last, see ASIDE), the button held
       * for the draw (a mouse's, or a game's button by the console), aimed again, let go. */
      const shoot = async (enemy) => {
        const { ranged } = action;
        if (!drawn) await draw();
        const at = [enemy.origin[0], enemy.origin[1], enemy.origin[2] + ASIDE[tally.ranged.shots % ASIDE.length]];
        const aimAt = async () => {
          const { origin } = await driver.view();
          if (origin) await driver.look(aimOf([origin[0], origin[1], origin[2] + part.eye], at, ranged).view);
        };
        const mouse = MOUSE_BUTTONS.includes(ranged.button);
        await aimAt();
        if (mouse) {
          await driver.mouseDown(ranged.button);
          down.add(ranged.button);
        } else await driver.command(`+${ranged.button}`);
        try {
          await driver.wait(Math.max(0, ranged.hold - POLL));
          await aimAt();
          await driver.wait(Math.min(POLL, ranged.hold));
        } finally {
          if (mouse) {
            await driver.mouseUp(ranged.button);
            down.delete(ranged.button);
          } else await driver.command(`-${ranged.button}`);
        }
        await driver.wait(LOOSED);
        tally.ranged.shots++;
        shotAt = tally.dealt.hits;
      };
      /** Whether this round's enemy is shot at, not struck: farther than `near`, and as the fight's `when` says. */
      const shoots = async (enemy, far, track) => {
        const { when, near, above } = action.ranged;
        if (far <= near) return false;
        if (when.includes("always") || track.shot || unreachable.get(track.key)?.then === "ranged") return true;
        const { origin } = await driver.view();
        return when.includes("flying") && Boolean(origin) && enemy.origin[2] - (origin[2] + part.eye) > above;
      };
      /** An enemy spent on for `stuck.after` with nothing to show: passed over, the run stopped, gone to or shot at.
       * True when the round is over. */
      const stuckOn = async (enemy, track) => {
        let then = action.stuck.then;
        // a goto done once, or shots that came to nothing as well: passed over now
        if ((then === "goto" && track.went) || (then === "ranged" && track.shot)) then = "skip";
        const name = enemy.name ?? "enemy";
        const seconds = rounded(track.idle / 1000);
        const what = { skip: "passed over from now on", fail: "the run stops", goto: "the player is put beside him", ranged: `shot at with ${action.ranged?.item}` }[then]; // prettier-ignore
        const said = `${where}: ${track.rounds} rounds on an unreachable ${name} at ${placeOf(enemy.origin)} (${seconds} s with no blow landing and no nearer): ${what}`; // prettier-ignore
        // of the kind "fight", as the fight's own line: a step may expect it
        note("fight", said);
        tell?.(said);
        tally.unreachable.push({ name: enemy.name ?? null, at: enemy.origin.map(rounded), rounds: track.rounds, seconds, then }); // prettier-ignore
        if (then === "fail")
          throw new Error(`play: ${track.rounds} rounds on an unreachable ${name} at ${placeOf(enemy.origin)}, ${seconds} s with no blow of the player's landing and not coming nearer: the fight stops (stuck: "fail").${await leftNow()}`); // prettier-ignore
        progress.again(track);
        if (then === "goto") {
          const { origin } = await driver.view();
          const place = besideOf(enemy.origin, origin ?? enemy.origin);
          await done(action.goesTo(place));
          await driver.wait(PAUSE);
          note("fight", `${where}: put beside ${name}: asked ${placeText(place)}, at ${placeText((await driver.view()).origin)}`); // prettier-ignore
          track.went = true;
          chased = null;
          return true;
        }
        if (then === "ranged") {
          track.shot = true;
          unreachable.set(track.key, { name, origin: enemy.origin, then });
          return false;
        }
        unreachable.set(track.key, { name, origin: enemy.origin, then: "skip", skipped: true });
        if (action.skips && enemy.id !== undefined) await done(action.skips(enemy.id));
        chased = null;
        return true;
      };
      /** The enemy chased: how near it has come, the rounds that came no nearer, the blows that landed on others. */
      let chased = null;
      let chasing = false;
      let hitsBefore = 0;
      let side = 1;
      let ran;
      let failure = null;
      try {
      ran = await again(action, where, from, async (ended) => {
        tally.rounds++;
        await listen();
        count();
        // the round before given its due: a blow landed in it, or it was time spent on its enemy for nothing
        progress.settle(clock(), tally.dealt.hits);
        if (shotAt !== null) [tally.ranged.hits, shotAt] = [tally.ranged.hits + tally.dealt.hits - shotAt, null];
        // the last round's blow, struck on the way to an enemy out of reach, landed: on another, in the way
        if (chasing && chased && tally.dealt.hits > hitsBefore) chased.others++;
        chasing = false;
        if (await evade()) return false;
        if (fallen !== null) {
          // down: a game may want a button pressed to rise, so the blows go on; risen when his health is back
          if (health !== null && health > 0 && lines.health) {
            tally.down += clock() - fallen;
            fallen = null;
            if (action.back) {
              await done(action.back);
              await arrived(action.post);
            }
            note(OWN, `${where}: the player died and has risen${action.back ? `, and is put back at ${placeText(action.post)}` : ""}`); // prettier-ignore
          } else if (clock() - fallen > RISES || !lines.health) {
            // a game that does not say his health: taken to have risen where he fell, after a moment
            tally.down += clock() - fallen;
            fallen = null;
            if (lines.health) throw new Error(`play: the player died in ${where} and had not risen ${rounded(RISES / 1000)} seconds after: the game never said his health again`); // prettier-ignore
          } else {
            await blow();
            return false;
          }
        }
        if (action.heal !== null && health !== null && most && health < action.heal * most) {
          await done(action.heals);
          tally.heals++;
          // the game is given a moment to say his health again, so that one wound is healed once
          const told = heard.length;
          await waitFor(lines.health, told, 1000);
          count();
        }
        const enemy = await find();
        tally.enemies.asked++;
        // one found unreachable and passed over, that the game still answers with (it cannot be told to skip): none
        if (!enemy || unreachable.get(keyOf(enemy))?.skipped) {
          tally.enemies.none++;
          alone ??= clock();
          if (action.quiet !== null && clock() - alone >= action.quiet) return true;
          await driver.wait(IDLE);
          return false;
        }
        alone = null;
        const seen = enemy.count ?? 1;
        tally.enemies.sum += seen;
        tally.enemies.most = Math.max(tally.enemies.most, seen);
        if (enemy.close !== undefined) {
          tally.enemies.closeAsked++;
          tally.enemies.closeSum += enemy.close;
          tally.enemies.closeMost = Math.max(tally.enemies.closeMost, enemy.close);
        }
        if (tally.prefer && preferred(enemy.name)) tally.prefer.rounds++;
        const far = await aim(enemy.origin);
        const track = progress.seen(keyOf(enemy), { ...enemy, far }, clock(), tally.dealt.hits);
        if (action.stuck && progress.stuck(track, action.stuck.after) && (await stuckOn(enemy, track))) return false;
        // shot at from where he stands, or struck: the ranged weapon put back first
        if (action.ranged && (await shoots(enemy, far, track))) {
          await shoot(enemy);
          await evade();
          return false;
        }
        if (drawn) await sheathe();
        if (action.chase !== null && far > action.chase && clock() >= calm) {
          // the same enemy chased: is he any nearer?
          const who = enemy.id ?? enemy.name ?? "";
          if (chased?.who !== who) chased = { who, best: far, stalled: 0, others: 0, tries: 0 };
          else if (far < chased.best - GAINED) Object.assign(chased, { best: far, stalled: 0, tries: 0 });
          else chased.stalled++;
          // as long as it takes him at a walk's pace, up to CHASE_MOST: one that keeps away is followed, not edged at
          const step = Math.min(CHASE_MOST, Math.max(100, ((far - action.chase) / PACE) * 1000));
          const held = chased.others >= 2 || chased.stalled >= 3;
          // four sidesteps that did not get him nearer: the preferred one is let be for a while, and the
          // nearest (who stands in the way) fought, where the game can be told to prefer nobody
          const canLetBe = action.prefer.length && (action.unprefers || !action.prefers);
          if (held && canLetBe && preferred(enemy.name) && chased.tries >= LET_BE_AFTER) {
            letBe = clock() + LET_BE;
            tally.prefer.letBe++;
            note(OWN, `${where}: ${enemy.name} is not got at (${chased.tries} sidesteps, ${rounded(far)} off): the nearest for ${LET_BE / 1000} s`); // prettier-ignore
            chased = null;
            await blow();
            return false;
          }
          if (action.sidestep !== null && held) {
            // held up by others in the way, or getting no nearer: round them, a step to the side, then on.
            // Twice to one side, then twice to the other: a side that got him on is kept for the next time
            if (chased.tries && chased.tries % 2 === 0) side = -side;
            chased.tries++;
            Object.assign(chased, { stalled: 0, others: 0 });
            tally.sidesteps++;
            await moving([side > 0 ? "moveright" : "moveleft"], action.sidestep);
            note(OWN, `${where}: a sidestep to the ${side > 0 ? "right" : "left"}, round what stands between him and ${enemy.name ?? "the enemy"} (${rounded(far)} off)`); // prettier-ignore
            await aim(enemy.origin);
          }
          // a step towards him, and the blow all the same: he may be in reach before it lands
          await moving(["forward"], step);
          // a fight whose time ran out in the step is ended by its time, at the loop's next look
          if (await ended()) return false;
          if (await evade()) return false;
          const left = await aim(enemy.origin);
          chasing = true;
          hitsBefore = tally.dealt.hits;
          // still well out of reach of where he was, and nobody on the player: no blow at the air, the next
          // round walks on. With others on him the blow is struck, and lands on whoever is in front
          if (left > action.chase + OUT_OF_REACH && enemy.close === 0) return false;
        }
        await blow();
        // in reach (a fight that says its reach with chase): more blows before he is asked for again, as a player
        // swings while the one before him stands; each with a look at the time and at a warning
        if (action.chase !== null && far <= action.chase)
          for (let more = 1; more < FLURRY; more++) {
            if ((await ended()) || (await evade())) return false;
            await blow();
          }
        await evade();
        return false;
      });
      } catch (error) {
        // the run stops, and what the fight came to is written all the same
        failure = error;
        ran = { line: null, over: false, took: clock() - fightBegan };
      }
      const { line, over, took } = ran;
      await listen();
      count();
      if (shotAt !== null) tally.ranged.hits += tally.dealt.hits - shotAt;
      if (drawn) await sheathe().catch(() => {});
      if (preferSaid !== null && action.unprefers) await done(action.unprefers);
      if (fallen !== null) tally.down += clock() - fallen;
      tally.seconds = rounded(took / 1000);
      tally.down = rounded(tally.down / 1000);
      tally.ended = line ? "line" : over ? "quiet" : "time";
      if (line) tally.line = line.text;
      for (const side of [tally.dealt, tally.taken]) side.sum = rounded(side.sum);
      const { asked, none, sum, closeAsked, closeSum, ...kept } = tally.enemies;
      tally.enemies = {
        ...{ asked, none, most: kept.most, mean: asked ? Math.round((sum / asked) * 100) / 100 : 0 },
        ...(closeAsked ? { closeMost: kept.closeMost, closeMean: Math.round((closeSum / asked) * 100) / 100 } : {}),
      };
      tally.health.most = most ?? null;
      // no enemy left, and the line never came: the area did not end as the steps thought
      if (!failure && over && action.until && !line) tally.unended = String(action.until);
      fights.push(tally);
      note("fight", fightLine(tally));
      tell?.(fightLine(tally));
      if (failure) throw failure;
      if (tally.unended) {
        // the pattern is said in the error and in the run's own note only: in a line of the kind "fight" a later
        // `until` of the same pattern would stop at it
        const said = `${where}: the fight ended by its quiet (no enemy found for ${rounded(action.quiet / 1000)} s), and the game never said`; // prettier-ignore
        if (!action.quietEnds)
          throw new Error(`play: ${said} ${action.until}: the area did not end as the steps thought (quietEnds: true takes the quiet for its end).${await leftNow()}`); // prettier-ignore
        const left = await leftNow();
        note(OWN, `NOTE ${said} ${action.until}`);
        note("fight", `NOTE ${said} its line: taken for its end (quietEnds).${left}`);
        tell?.(`NOTE ${said} ${action.until}: taken for its end (quietEnds).${left}`);
      }
      return line;
    };
    /** When a line was said, from this run's beginning. */
    const whenOf = (line) =>
      line.at >= began ? `${rounded((line.at - began) / 1000)} s` : `${rounded((began - line.at) / 1000)} s before this run began`; // prettier-ignore
    /** The last line before `to` that matches, looked for back to `back`; a line an `until` stopped at only if `any`. */
    const earlier = (pattern, back, to, any = false) => {
      for (let at = to - 1; at >= back; at--)
        if (heard[at].kind !== OWN && (any || !stoppedAt.has(heard[at])) && pattern.test(heard[at].text)) return heard[at]; // prettier-ignore
      return null;
    };
    /** The commands a profile heals by: a command step that gives one is a heal in the run's summary. */
    const healing = part.heal ? commandsOf(part.heal, {}, [], "play.heal") : [];
    /** An action with the values it names (`${hp}`) put in: in a pattern as the text they are, dots and all. */
    const whole = (action, where) => {
      if (!action.templates) return action;
      const fill = (text, literal) =>
        text.replace(KEPT, (all, name) => {
          if (!kept.has(name))
            throw new Error(`play: ${where} names \${${name}}, and no step before it has kept a value of that name (keep)`); // prettier-ignore
          return literal ? kept.get(name).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") : kept.get(name);
        });
      const { commands, pattern, until } = action.templates;
      return {
        ...action,
        ...(commands ? { commands: commands.map((each) => fill(each, false)) } : {}),
        ...(pattern ? { pattern: patternOf(fill(pattern, true), "an expectation") } : {}),
        ...(until ? { until: patternOf(fill(until, true), "an until") } : {}),
      };
    };
    /** What a step's `keep` keeps: the first group of its pattern, in its line or else the last said since it began. */
    const keeping = async (action, line, from, where) => {
      await listen();
      for (const { name, pattern } of action.keep) {
        let got = line ? pattern.exec(line.text) : null;
        for (let at = heard.length - 1; !got && at >= from; at--)
          if (heard[at].kind !== OWN) got = pattern.exec(heard[at].text);
        if (!got)
          throw new Error(`play: ${where} keeps ${name} by ${pattern}, and nothing said since it began matches it. ${lastLines(from)}`); // prettier-ignore
        kept.set(name, got[1] ?? got[0]);
        note(OWN, `${where}: kept ${name} = ${kept.get(name)}`);
      }
    };
    /**
     * One step done: its kept values put in; its line looked for in what was said before it began (`already`);
     * then done (`perform`); a line it never heard said, in the sentence that stops the run, when it was heard
     * before; its line marked as the last of its pattern waited for, and its values kept.
     */
    const act = async (written, where) => {
      const action = whole(written, where);
      await listen();
      const from = heard.length;
      if (action.kind === "command" && action.commands.some((each) => healing.some((heal) => each === heal || each.startsWith(`${heal} `)))) // prettier-ignore
        if (current) current.heals++;
      if (action.until && action.already !== "wait") {
        // before where it hears from: a wait hears from the last deed, and a line since then is its own anyway
        const hears = Math.min(from, sinceOf(action.since, from));
        const back = earlier(action.until, Math.max(mapStart, lastWaited.get(String(action.until)) ?? 0), hears);
        if (back && action.already === "pass") {
          stoppedAt.add(back);
          lastWaited.set(String(action.until), from);
          early.add(where);
          const said = `${where}: ${shown(back.text)} was heard at ${whenOf(back)}, before the step began: it ends at once (already: "pass")`; // prettier-ignore
          note(OWN, said);
          tell?.(said);
          if (action.keep) await keeping(action, back, from, where);
          return back;
        }
        if (back) {
          const said = `${where}: WARN ${shown(back.text)} was heard at ${whenOf(back)}, before the step began; it waits for the line all the same (already: "warn")`; // prettier-ignore
          note(OWN, said);
          tell?.(said);
        }
      }
      let line;
      try {
        line = await perform(action, where);
      } catch (error) {
        const back = action.until && /never said/.test(error.message) ? earlier(action.until, Math.min(first, mapStart), from, true) : null; // prettier-ignore
        if (back)
          error.message += ` This line was heard at ${whenOf(back)}, before the step began${stoppedAt.has(back) ? " (another step's until stopped at it)" : ""}: ${shown(back.text)}`; // prettier-ignore
        throw error;
      }
      if (action.until && line) lastWaited.set(String(action.until), heard.length);
      if (action.keep) await keeping(action, line, from, where);
      return line;
    };
    /** One action done through the driver: what it does, its `until`, then its wait. */
    const perform = async (action, where) => {
      // what was said before the step is heard before it, so that "from this step on" is from here
      await listen();
      const from = heard.length;
      const hears = action.until ? sinceOf(action.since, from) : from;
      // a step that only reads or waits moves nothing on: the waits after a step that did a thing all hear from it
      if (!READS.includes(action.kind) && action.kind !== "wait") before = from;
      if (action.kind === "repeat") {
        const { line, passes } = await again(action, where, hears, async (ended) => {
          await block(action.actions, where, ended);
          return false;
        });
        note(OWN, `${where}: repeated ${passes} ${passes === 1 ? "time" : "times"}${line ? "" : action.until ? `, and the game did not say ${action.until}` : ""}`); // prettier-ignore
        if (action.wait > 0) await driver.wait(action.wait);
        return line;
      }
      if (action.kind === "fight") {
        const line = await fight(action, where, hears);
        if (action.wait > 0) await driver.wait(action.wait);
        return line;
      }
      const once = async () => {
        if (action.kind === "command" || action.kind === "goto")
          for (const [index, command] of action.commands.entries()) {
            if (index) await driver.wait(BETWEEN);
            await driver.command(command);
          }
        else if (action.kind === "button") {
          if (action.turn !== undefined && exact && typeof driver.view === "function" && driver.look) {
            // a build whose view cannot be read is turned by time from then on, as a driver with no view is
            const seen = await Promise.resolve(driver.view()).catch((error) => {
              exact = false;
              note(OWN, `${error.message}: a turn is by time, and about right only`);
              return null;
            });
            if (seen) {
              await driver.look({ yaw: (((seen.yaw + action.turn) % 360) + 540) % 360 - 180 }); // prettier-ignore
              return;
            }
          }
          const was = action.step?.walk !== undefined && typeof driver.view === "function" ? (await driver.view()).origin : null;
          await driver.command(`+${action.button}`);
          try {
            await driver.wait(action.ms);
          } finally {
            await driver.command(`-${action.button}`);
          }
          // a walk that took him nowhere: he stands in something solid (a goto into a brush), and what follows
          // would be done where he is not thought to be
          const now = was ? (await driver.view()).origin : null;
          if (now && Math.hypot(now[0] - was[0], now[1] - was[1], now[2] - was[2]) < WALKED)
            throw new Error(`play: did not move after walk ${action.ms} ms: in solid? (origin ${placeText(now)})`);
        } else if (action.kind === "hold") {
          await driver.keyDown(action.key);
          try {
            await driver.wait(action.ms);
          } finally {
            await driver.keyUp(action.key);
          }
        } else if (action.kind === "record") {
          if (clip) await endClip();
          if (action.clip) {
            if (typeof driver.recordStart !== "function")
              throw new Error("play: this driver cannot film a clip (the browser's driver can: recordStart)");
            await driver.recordStart();
            clip = action.clip;
          }
        } else if (action.kind === "press") await driver.press(action.key);
        else if (action.kind === "click") await driver.click(action.x, action.y);
        else if (action.kind === "mouse") {
          await driver.mouseDown(action.mouse);
          try {
            await driver.wait(action.ms);
          } finally {
            await driver.mouseUp(action.mouse);
          }
        } else if (action.kind === "tap") {
          for (let tapped = 0; tapped < action.times; tapped++) {
            if (tapped) await driver.wait(action.every - action.ms);
            await driver.mouseDown(action.mouse);
            try {
              await driver.wait(action.ms);
            } finally {
              await driver.mouseUp(action.mouse);
            }
          }
        } else if (action.kind === "faceAt") {
          let place = action.place;
          if (action.target) {
            const enemy = await targetOf(action.radius);
            if (!enemy)
              throw new Error(`play: there is no living enemy within ${action.radius} of the player to face`);
            place = enemy.origin;
          }
          await aim(place);
        } else if (action.kind === "mouseDown") {
          await driver.mouseDown(action.mouse);
          down.add(action.mouse);
        } else if (action.kind === "mouseUp") {
          await driver.mouseUp(action.mouse);
          down.delete(action.mouse);
        } else if (action.kind === "look") {
          const to = {};
          if (action.yaw !== undefined) to.yaw = action.yaw;
          if (action.pitch !== undefined) to.pitch = action.pitch;
          if (action.ms && typeof driver.view === "function") {
            const from = await driver.view();
            const turn = to.yaw === undefined ? 0 : ((((to.yaw - from.yaw) % 360) + 540) % 360) - 180;
            const tilt = to.pitch === undefined ? 0 : to.pitch - from.pitch;
            const began = Date.now();
            for (let done = 0; done < 1; ) {
              done = Math.min(1, (Date.now() - began) / action.ms);
              const eased = done < 0.5 ? 2 * done * done : 1 - 2 * (1 - done) ** 2;
              await driver.look({ yaw: from.yaw + turn * eased, pitch: from.pitch + tilt * eased });
              if (done < 1) await driver.wait(PAN_EVERY);
            }
          } else await driver.look(to);
        } else if (action.kind === "where") {
          const { yaw, pitch, origin } = await driver.view();
          note(
            "where",
            `where${action.name ? ` ${action.name}` : ""}: origin ${placeText(origin)}, yaw ${rounded(yaw)}, pitch ${rounded(pitch)}`,
          );
        } else if (action.kind === "map") await load(action.map);
        else if (action.kind === "census") {
          const counted = await census(action.radius);
          for (const said of censusTable(counted, where, action.radius)) note("census", said);
          tell?.(censusTable(counted, where, action.radius).join("\n"));
        }
        else if (action.kind === "travel") await travel(action, where);
        else if (action.kind === "expect" || action.kind === "expectNot")
          await expecting(action, where, from);
      };
      await once();
      if (action.kind === "goto" && typeof driver.view === "function") await arrived(action.place);
      let line = null;
      if (action.until) {
        line = await waitFor(action.until, hears, action.within, action.every, once, stoppedAt);
        if (!line)
          throw new Error(
            `play: the game never said ${action.until} in the ${rounded(action.within / 1000)} seconds it was given. ${lastLines(hears)}${await leftNow()}`,
          );
        stoppedAt.add(line);
      }
      if (action.wait > 0) await driver.wait(action.wait);
      return line;
    };
    /** The player is where a `goto` put him, or the run says where he is instead. */
    const arrived = async ([x, y, z]) => {
      let origin = null;
      for (let waited = 0; waited <= GOTO_WITHIN; waited += POLL) {
        ({ origin } = await driver.view());
        const near =
          origin &&
          Math.hypot(origin[0] - x, origin[1] - y) <= GOTO_NEAR &&
          Math.abs(origin[2] - z) <= GOTO_NEAR_Z;
        if (near) return;
        await driver.wait(POLL);
      }
      throw new Error(
        `play: the player was to be put at ${placeText([x, y, z])} and is at ${placeText(origin)}: does this map have the command the profile's play.goto names?`,
      );
    };
    const through = async (phase, actions) => {
      for (const [index, action] of actions.entries())
        await record(phase, index, action.kind, action.step, action.shot, (where) => act(action, where));
    };
    /** `map <name>`, the wait for it, and the profile's steps into the game. */
    const load = async (name, shots = false) => {
      state.entered = false;
      state.map = name;
      // the monsters are new: none is passed over (the game's own list goes with its map)
      unreachable.clear();
      const loaded = async () => {
        const from = heard.length;
        mapStart = from;
        await driver.command(`map ${name}`);
        if (!(part.loaded && hears)) {
          if (loading > 0) await driver.wait(loading);
          return null;
        }
        const line = await waitFor(part.loaded, from, loading);
        if (!line)
          throw new Error(
            `play: the map ${name} had not loaded after ${rounded(loading / 1000)} seconds: the game never said ${part.loaded}. ${lastLines(from)}`,
          );
        return line;
      };
      const step = { command: `map ${name}`, wait: loading };
      await record("load", 1, "command", step, shots ? "loaded" : null, loaded);
      mapFrom = heard.length;
      await through("enter", entering);
      if (entering.length && shots)
        await record("enter", entering.length, "wait", { shot: "entered" }, "entered", () => {});
      state.entered = true;
    };
    /** Through the way the player stands in: the profile's commands, the next map's server, its load, its enter. */
    const travel = async (action, where) => {
      const within = action.within ?? loading;
      const from = heard.length;
      for (const [index, command] of action.commands.entries()) {
        if (index) await driver.wait(BETWEEN);
        await driver.command(command);
      }
      const spawned = await waitFor(part.travel.spawned, from, within);
      if (!spawned)
        throw new Error(
          `play: the game never said ${part.travel.spawned} in the ${rounded(within / 1000)} seconds a travel was given: is the player in a way to another map (its "travel" line said)? ${lastLines(from)}`,
        ); // prettier-ignore
      state.entered = false;
      const name = part.travel.spawned.exec(spawned.text)[1];
      if (action.map && name.toLowerCase() !== action.map.toLowerCase())
        throw new Error(`play: the way led to ${name}, and the step travels to ${action.map}`);
      state.map = name;
      if (part.loaded) {
        const line = await waitFor(part.loaded, heard.indexOf(spawned) + 1, within);
        if (!line)
          throw new Error(
            `play: the map ${name} had not loaded ${rounded(within / 1000)} seconds after its server began: the game never said ${part.loaded}. ${lastLines(from)}`,
          ); // prettier-ignore
      } else if (loading > 0) await driver.wait(loading);
      mapFrom = heard.length;
      await through("enter", entering);
      state.entered = true;
      const said = `${where}: travelled to ${name}`;
      note(OWN, said);
      tell?.(said);
    };
    /** A section begun (`marker` its step, or null for the steps before any) and the one before it ended. */
    const open = (marker, index) => {
      shut("done");
      current = {
        ...{ name: marker?.name ?? OPENING, step: index + 1, onFail: marker?.onFail ?? null, began: Date.now() },
        ...{ from: heard.length, fights: fights.length, expectations: expectations.length, steps: 0, heals: 0, failed: 0 },
      };
      sections.push(current);
      if (!marker) return;
      const said = `section ${current.name} (step ${index + 1})`;
      note(OWN, said);
      tell?.(`--- ${said}`);
    };
    const shut = (how) => {
      if (!current || current.ended) return;
      Object.assign(current, { ended: how, took: Date.now() - current.began, to: heard.length });
      Object.assign(current, { fightsTo: fights.length, expectationsTo: expectations.length });
    };
    /** The run's steps, from `from` on, by sections; a step that fails with onFail "continue" lets the run go on. */
    const stepsOfRun = async () => {
      if (startAt) {
        const said = `from step ${startAt + 1}${asked[startAt].kind === "section" ? ` (section ${asked[startAt].name})` : ""}: steps 1 to ${startAt} are not done`; // prettier-ignore
        note(OWN, said);
        tell?.(said);
      }
      for (let index = startAt; index < asked.length; index++) {
        const action = asked[index];
        if (action.kind === "section") open(action, index);
        else if (!current) open(asked.slice(0, index).findLast((each) => each.kind === "section") ?? null, index);
        if (action.kind !== "section") current.steps++;
        const at = Date.now() - began;
        try {
          await record("steps", index, action.kind, action.step, action.shot, (where) => act(action, where));
        } catch (error) {
          if ((action.onFail ?? current.onFail ?? "stop") !== "continue") throw error;
          done.push({ part: "steps", index, kind: action.kind, step: action.step, at, took: Date.now() - began - at, picture: null, failed: error.message }); // prettier-ignore
          // let go what the step held, as a run's end would: the next step begins with free hands
          for (const button of down) await Promise.resolve(driver.mouseUp(button)).catch(() => {});
          down.clear();
          const entry = { where: `step ${index + 1}`, kind: "step", pattern: JSON.stringify(action.step), passed: false, line: error.message }; // prettier-ignore
          expectations.push(entry);
          current.failed++;
          note(OWN, `${expectationLine(entry)} (onFail: "continue": the run goes on)`);
          tell?.(`${expectationLine(entry)} (onFail: "continue": the run goes on)`);
        }
      }
    };

    let failure = null;
    try {
      if (!state.up) await record("load", 0, "ready", null, null, ready);
      await listen();
      first = heard.length;
      mapFrom = first;
      // a game leaving a map may write its own files (a character saved as the server ends): the map is left
      // first, so that what is put is what the next map reads and not what the last one wrote over it
      // (a run that stays is not taken out of its map: what is put is read when the game next opens it)
      if (put.length && !staying && state.map !== null && typeof driver.leave === "function") {
        await driver.leave();
        await driver.wait(LEAVES);
        state.entered = false;
      }
      if (put.length && staying) {
        const said = "put while staying: the map is not left, and the game reads these files when it next opens them (a map, a script pack: at the next map)"; // prettier-ignore
        note(OWN, said);
        tell?.(said);
      }
      for (const each of put) {
        const bytes = each.bytes ?? readFileSync(each.file);
        await driver.put(each.path, bytes);
        note(OWN, `put ${each.path} (${bytes.length} bytes)`);
        tell?.(`put ${each.path} (${bytes.length} bytes)`);
      }
      for (const each of moved) {
        laid.set(each.key, { ...each });
        const said = each.files
          ? `over ${each.path}: ${each.files.length} files of ${each.folder} changed since the session had them${each.files.length ? `: ${each.files.slice(0, 8).join(", ")}${each.files.length > 8 ? ", ..." : ""}` : ""}` // prettier-ignore
          : `over ${each.path}: ${each.folder} is new to the session: marked now, and nothing of it put (what changes in it from now on is)`; // prettier-ignore
        note(OWN, said);
        tell?.(said);
      }
      if (!staying) await load(map, true);
      await stepsOfRun();
      shut("done");
      for (const each of held.flat()) await expecting(each, "the run", heard.length);
    } catch (error) {
      failure = error;
    }
    // a clip still being filmed is ended and written: a run that stopped keeps what was filmed of it
    if (clip)
      await endClip().catch((error) => {
        failure ??= error;
      });
    shut("stopped");
    // whatever is still held is let go: the next run begins with free hands
    for (const button of down) await Promise.resolve(driver.mouseUp(button)).catch(() => {});
    await listen().catch(() => {});
    state.runs++;

    // the log is kept whatever happened: a failed run's log says why
    const said = heard.slice(first).sort((a, b) => a.at - b.at);
    const lines = said.map((each) => ({ at: each.at - began, kind: each.kind, text: each.text }));
    let log = lines.map(
      (each) => `[${(each.at / 1000).toFixed(3).padStart(9)}] ${each.kind.padEnd(10)} ${each.text}`,
    );
    if (!hears)
      try {
        log = [...((await driver.log()) ?? [])].map(String);
      } catch {
        log = [];
      }
    const logFile = join(out, "log.txt");
    writeFileSync(logFile, log.join("\n"));
    const linesFile = join(out, "log.jsonl");
    if (hears)
      writeFileSync(
        linesFile,
        said.map((each) => JSON.stringify({ t: (each.at - began) / 1000, time: new Date(each.at).toISOString(), kind: each.kind, text: each.text })).join("\n"), // prettier-ignore
      );
    let sheetFile = null;
    if (sheet && pictures.length)
      try {
        sheetFile = join(out, "sheet.png");
        // pictures written smaller are drawn less small on it: the sheet keeps its size
        writeFileSync(sheetFile, sheetOf(pictures, { ...SHEET, shrink: Math.max(1, Math.round(SHEET.shrink / shrink)) })); // prettier-ignore
      } catch {
        // pictures that are not PNG (a driver of another kind) make no sheet, and the run is no worse for it
        sheetFile = null;
      }
    const passed = !failure && expectations.every((each) => each.passed);
    // what the run came to, section by section and fight by fight; and with the runs that stayed before it
    if (!staying) chain = [];
    const summary = summaryOf({ sections, fights, expectations, heard, lines: part.fight, map: state.map, out, took: Date.now() - began, passed, failure }); // prettier-ignore
    chain.push({ out, map: summary.map, took: summary.took, passed, totals: summary.totals });
    summary.chain = { runs: chain.map(({ totals: _totals, ...run }) => run), totals: totalsOf(chain.map((run) => run.totals)) }; // prettier-ignore
    const summaryFile = join(out, "summary.json");
    writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
    const result = {
      ...{ map: state.map, out, took: Date.now() - began, passed },
      ...{ pictures, sheet: sheetFile, steps: done, expectations, fights, sections: summary.sections, summary },
      ...{ logFile, linesFile: hears ? linesFile : null, resultFile: join(out, "result.json"), summaryFile },
    };
    writeFileSync(
      result.resultFile,
      JSON.stringify({ ...result, failure: failure ? failure.message : null }, null, 2),
    );
    if (failure) throw Object.assign(failure, { pictures, logFile, sheet: sheetFile, expectations, fights, summary, summaryFile }); // prettier-ignore
    return { ...result, lines, log };
  }

  async function close() {
    state.up = false;
    state.entered = false;
    await driver.close();
  }

  return { ready, run, close, state };
}

/** Folders laid over the game's files, checked: `[{ path, folder, key }]`, the folder made whole. */
function oversOf(list) {
  if (!Array.isArray(list) || !list.every((each) => isText(each?.path) && isText(each?.folder)))
    throw new Error(
      `play: over is a list of { path, folder }: a place in the engine's files and the folder laid over it there, not ${shown(list)}`,
    );
  return list.map(({ path, folder }) => {
    const whole = resolve(folder);
    if (!existsSync(whole) || !statSync(whole).isDirectory())
      throw new Error(`play: over: ${folder} is no folder, to lay over ${path}`);
    const place = path.replace(/\\/g, "/").replace(/\/+$/, "");
    return { path: place, folder: whole, key: `${place}=${whole}` };
  });
}

/** Every file under a folder, `a/b.mdl` from it, with its size and time as a mark: what changed is told by it. */
function marksOf(folder, under = "", marks = new Map()) {
  for (const entry of readdirSync(join(folder, under), { withFileTypes: true })) {
    const name = `${under}${entry.name}`;
    if (entry.isDirectory()) marksOf(folder, `${name}/`, marks);
    else if (entry.isFile()) {
      const { size, mtimeMs } = statSync(join(folder, name));
      marks.set(name, `${size}:${mtimeMs}`);
    }
  }
  return marks;
}

/**
 * A map played from a cold start: the engine waited for, `map <name>`, the profile's steps to enter the
 * game, then `steps`, with a picture wherever a step asks for one; then the driver is closed. Resolves to
 * what `playSession`'s run does: `{ map, out, pictures, sheet, steps, expectations, passed, lines, log,
 * logFile, ... }`.
 *
 * Two pictures are taken unasked, since a run that never got into the game is told by them at a glance:
 * `loaded` when the map has loaded and `entered` after the profile's steps to enter (when it has any).
 *
 *   driver   a plain object: `ready()` resolves when the engine takes commands, `command(text)` runs a
 *            console command, `keyDown(key)`, `keyUp(key)`, `press(key)`, `click(x, y)`, `wait(ms)`,
 *            `shot(file)` writes a PNG of what the player sees, `log()` gives the console's lines and
 *            `close()` ends it. Each may be async. A driver may also have `lines(from)` (what it heard:
 *            `until` and the expectations need it), `view()` and `look({ yaw, pitch })` (`look`, `face`,
 *            `where`, `faceAt`, `fight`, an exact `turn`), `mouseDown(button)` and `mouseUp(button)`,
 *            `put(path, bytes)` with `leave()`, and `clock()` (its own time in milliseconds, where it is
 *            not the clock's: a test's fake, by which `repeat` and `fight` then count their time).
 *            `browserDriver` makes the kit's own, which has them all
 *   map      the map's name, as `map <name>` takes it
 *   steps    what to do once in the game (`playOf` has the format)
 *   out      the folder the pictures and the log go to; it is made
 *   mod      the mod's profile: its `play` part says how the game is entered and how a thing is said
 *   loads    milliseconds the map is given to load (unless told: the profile's `play.loads`)
 *   pause    milliseconds waited after a step that does something and gives no `wait` (1000)
 *   tell     a function handed a line as each thing is done, for a caller that prints while it waits
 *   expect, expectNot, put, sheet   as a session's run takes them
 *
 * Every step is checked before the driver is touched. The driver is closed and the log written whatever
 * happens; what a driver throws comes through with the step it was doing named before it. For a second map
 * or a second run without the engine's start, keep a `playSession`.
 */
export async function play({ driver, mod, pause, tell, ...run } = {}) {
  const session = playSession({ driver, mod, pause, tell });
  let result = null;
  let failure = null;
  try {
    result = await session.run({ ...run, stay: false });
  } catch (error) {
    failure = error;
  }
  // a run refused before the driver was touched leaves nothing to close
  if (session.state.up || session.state.runs)
    try {
      await session.close();
    } catch (error) {
      failure ??= new Error(`play: the driver did not close: ${error.message}`, { cause: error });
    }
  if (failure) throw failure;
  return result;
}

/** The numbers a summary adds up, each of a section, a run or the runs that stayed. */
const TOTALS = ["seconds", "steps", "fights", "fightSeconds", "heals", "deaths", "slain"];
/** Sums of the parts of a summary: `{ seconds, steps, fights, fightSeconds, heals, deaths, slain, taken, dealt, expectations }`. */
export function totalsOf(parts) {
  const totals = Object.fromEntries(TOTALS.map((name) => [name, 0]));
  Object.assign(totals, { taken: { hits: 0, sum: 0 }, dealt: { hits: 0, sum: 0 }, expectations: { held: 0, failed: 0 } }); // prettier-ignore
  for (const part of parts) {
    for (const name of TOTALS) totals[name] += part?.[name] ?? 0;
    for (const side of ["taken", "dealt"]) for (const name of ["hits", "sum"]) totals[side][name] += part?.[side]?.[name] ?? 0; // prettier-ignore
    for (const name of ["held", "failed"]) totals.expectations[name] += part?.expectations?.[name] ?? 0;
  }
  for (const name of ["seconds", "fightSeconds"]) totals[name] = rounded(totals[name]);
  for (const side of [totals.taken, totals.dealt]) side.sum = rounded(side.sum);
  return totals;
}

/**
 * What a run came to (summary.json): each section's time, steps, fights, heals (a fight's, and a step's that
 * gives the profile's heal command), deaths, hits taken and dealt and the slain, as the game said them by the
 * profile's `play.fight` patterns, and its expectations; each fight's; and the run's totals.
 */
export function summaryOf({ sections, fights, expectations, heard, lines, map, out, took, passed, failure }) {
  const amount = (pattern, text) => {
    const got = pattern?.exec(text);
    return got ? (Number.isFinite(Number(got[1])) ? Number(got[1]) : 0) : null;
  };
  const sectionOf = (index) => sections.find((each) => index >= each.fights && index < (each.fightsTo ?? Infinity))?.name ?? null; // prettier-ignore
  const fought = fights.map((fight, index) => ({
    ...{ where: fight.where, section: sectionOf(index), seconds: fight.seconds ?? 0, ended: fight.ended ?? null },
    ...{ heals: fight.heals ?? 0, deaths: fight.deaths ?? 0, taken: { hits: fight.taken?.hits ?? 0, sum: fight.taken?.sum ?? 0 } }, // prettier-ignore
    ...{ dealt: { hits: fight.dealt?.hits ?? 0, sum: fight.dealt?.sum ?? 0 }, slain: fight.slain?.length ?? 0 },
  }));
  const parts = sections.map((section) => {
    const counted = { deaths: 0, slain: 0, taken: { hits: 0, sum: 0 }, dealt: { hits: 0, sum: 0 } };
    for (let at = section.from; at < (section.to ?? heard.length); at++) {
      const { kind, text } = heard[at];
      if (kind === OWN || kind === "fight" || kind === "where") continue;
      const taken = amount(lines?.taken, text);
      const dealt = amount(lines?.dealt, text);
      if (taken !== null) (counted.taken.hits++, (counted.taken.sum += taken));
      if (dealt !== null) (counted.dealt.hits++, (counted.dealt.sum += dealt));
      if (lines?.died?.test(text)) counted.deaths++;
      if (lines?.slain?.test(text)) counted.slain++;
    }
    for (const side of [counted.taken, counted.dealt]) side.sum = rounded(side.sum);
    const own = fought.slice(section.fights, section.fightsTo ?? fights.length);
    const asked = expectations.slice(section.expectations, section.expectationsTo ?? expectations.length);
    return {
      ...{ name: section.name, step: section.step, ended: section.ended ?? "stopped", seconds: rounded((section.took ?? 0) / 1000) }, // prettier-ignore
      ...{ steps: section.steps, fights: own.length, fightSeconds: rounded(own.reduce((sum, each) => sum + each.seconds, 0)) }, // prettier-ignore
      ...{ heals: section.heals + own.reduce((sum, each) => sum + each.heals, 0), ...counted },
      expectations: { held: asked.filter((each) => each.passed).length, failed: asked.filter((each) => !each.passed).length }, // prettier-ignore
    };
  });
  return {
    ...{ map, out, took, passed, failure: failure ? failure.message : null },
    ...{ sections: parts, fights: fought, totals: totalsOf(parts) },
  };
}

/** A summary as lines to print: a line a section, one for the run, and one for the runs that stayed in it. */
export function summaryLines(summary) {
  const line = (head, part) =>
    `${head}: ${part.seconds} s${part.ended ? `, ${part.ended}` : ""}; ${part.steps} steps; ${part.fights} ${part.fights === 1 ? "fight" : "fights"}${part.fights ? ` (${part.fightSeconds} s)` : ""}; ${part.heals} ${part.heals === 1 ? "heal" : "heals"}, ${part.deaths} ${part.deaths === 1 ? "death" : "deaths"}; taken ${part.taken.hits} hits, ${part.taken.sum} in all; dealt ${part.dealt.hits} hits, ${part.dealt.sum} in all; slain ${part.slain}; expectations ${part.expectations.held} held, ${part.expectations.failed} failed`; // prettier-ignore
  const lines = summary.sections.map((part) => line(`section ${part.name} (step ${part.step})`, part));
  lines.push(line("the run", summary.totals));
  if (summary.chain?.runs.length > 1) lines.push(line(`the ${summary.chain.runs.length} runs since the map was loaded`, summary.chain.totals)); // prettier-ignore
  return lines;
}

/** One thing done, as a line: when, how long, what, its picture and the line it waited for. */
function lineOf({ part, kind, step, at, took, picture, heard, where }) {
  const seconds = (ms) => `${(ms / 1000).toFixed(1).padStart(6)} s`;
  const what = kind === "ready" ? "the engine is up" : JSON.stringify(step);
  // a step of a block is said with its place in it: "1.2" is the second step of step 1's block
  const of = part === "enter" ? "enter  " : where ? `${where.replace(/^step /, "")}  ` : "";
  return `${seconds(at)} ${seconds(took)}  ${of}${what}${heard ? `   heard: ${heard}` : ""}${picture ? `   -> ${picture}` : ""}`;
}

/**
 * A fight, as a line: how long, how it ended, the blows struck and landed, the hits taken, the heals, the
 * deaths, who was slain, how many enemies there were at once and the least health seen.
 */
export function fightLine(fight) {
  const { where, seconds, ended, line, rounds, blows, dealt, taken, heals, deaths, slain, enemies, health, down } = fight; // prettier-ignore
  const rate = (sum) => (seconds > 0 ? (sum / seconds).toFixed(2) : "0.00");
  const names = new Map();
  for (const name of slain) names.set(name, (names.get(name) ?? 0) + 1);
  const dead = [...names].map(([name, count]) => (count > 1 ? `${name} x${count}` : name)).join(", ");
  return [
    `fight (${where}): ${seconds} s, ended by ${ended === "line" ? `the line ${shown(line)}` : ended === "quiet" ? `no enemy being left${fight.unended ? ", WITHOUT its line" : ""}` : "its time"}`,
    `${blows} blows in ${rounds} rounds`,
    `dealt ${dealt.hits} hits, ${dealt.sum} in all (${rate(dealt.hits)} hits a second), ${dealt.missed} missed`,
    `taken ${taken.hits} hits, ${taken.sum} in all (${rate(taken.sum)} a second)`,
    `${heals} ${heals === 1 ? "heal" : "heals"}, ${deaths} ${deaths === 1 ? "death" : "deaths"}${deaths ? ` (${down} s down)` : ""}`,
    `slain ${slain.length}${dead ? `: ${dead}` : ""}`,
    `enemies at once: ${enemies.most} at most, ${enemies.mean} on average${enemies.closeMost === undefined ? "" : `; on the player: ${enemies.closeMost} at most, ${enemies.closeMean} on average`}${enemies.none ? ` (none found in ${enemies.none} of ${enemies.asked} rounds)` : ""}`,
    `health ${health.least ?? "not said"} at its least${health.most ? ` of ${health.most}` : ""}`,
    ...(fight.prefer ? [`preferred (${fight.prefer.words.join(", ")}): ${fight.prefer.slain} of the ${slain.length} slain, faced in ${fight.prefer.rounds} of ${rounds} rounds${fight.prefer.letBe ? `, let be ${fight.prefer.letBe} ${fight.prefer.letBe === 1 ? "time" : "times"} (not got at)` : ""}`] : []), // prettier-ignore
    ...(fight.sidesteps !== undefined ? [`${fight.sidesteps} ${fight.sidesteps === 1 ? "sidestep" : "sidesteps"} round others in the way`] : []), // prettier-ignore
    ...(fight.dodge ? [`dodged ${fight.dodge.dodged} of ${fight.dodge.warned} warnings${fight.dodge.clear ? ` (${fight.dodge.clear} heard off the place already)` : ""}`] : []), // prettier-ignore
    ...(fight.ranged ? [`ranged (${fight.ranged.item}): ${fight.ranged.shots} ${fight.ranged.shots === 1 ? "shot" : "shots"}, ${fight.ranged.hits} ${fight.ranged.hits === 1 ? "hit" : "hits"}, drawn ${fight.ranged.draws} ${fight.ranged.draws === 1 ? "time" : "times"}`] : []), // prettier-ignore
    ...(fight.unreachable?.length ? [`unreachable: ${fight.unreachable.map((one) => `${one.name ?? "an enemy"} at (${one.at.map(Math.round).join(",")}) after ${one.rounds} rounds (${one.then === "skip" ? "passed over" : one.then === "ranged" ? "shot at" : one.then === "goto" ? "gone to" : "the run stopped"})`).join(", ")}`] : []), // prettier-ignore
  ].join("; ");
}

/** An expectation, as a line: whether it held, what it was, where it was asked and the line that decided. */
export function expectationLine({ where, kind, pattern, passed, line }) {
  // a step that failed and let the run go on (onFail: "continue") is one too: its sentence is the line
  const what = kind === "expect" ? "expect" : kind === "expectNot" ? "expect no" : kind;
  const why = line ? `: ${line}` : kind === "expect" ? ": no such line was heard" : "";
  return `${passed ? "PASS" : "FAIL"}  ${what} ${pattern} (${where})${why}`;
}
