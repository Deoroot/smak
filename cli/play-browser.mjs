// The one driver the kit ships for `play` (cli/play.mjs): a browser build of the Xash3D engine, driven with
// Playwright. Beside running commands and taking pictures it HEARS the game and SETS THE VIEW, neither of
// which the engine offers a page: both are done in the engine's own memory, with nothing of the game changed.
//
//   import { play } from "./smak/src/index.mjs";
//   const driver = play.browserDriver({ url, playwright: "C:/tools/browser", messages: ["TextMsg"] });
//   await driver.ready();
//   await driver.command("map crossfire");
//   await driver.lines();        // [{ at, kind: "console", text }, { at, kind: "TextMsg", bytes }, ...]
//   await driver.view();         // { yaw, pitch, origin: [x, y, z] }
//   await driver.look({ yaw: 90, pitch: 0 });
//
// THE KIT HAS NO DEPENDENCIES, AND THIS KEEPS IT SO. Playwright is the caller's: handed in as the module, or
// found in a folder the caller names (`playwrightFrom`).
//
// WHERE THE FACTS ARE FROM. The page is an Emscripten build: the engine is one WebAssembly module with the
// game's libraries linked to it as it runs, all in one memory and one table of functions. The page keeps the
// module's instance to itself, so a script put in the page before its own (`addInitScript`) keeps the first
// instance that is made with a memory and a table. Two things are then read out of the memory:
//
//   WHAT THE SERVER TELLS THE PLAYER. A GoldSrc game speaks to its players by "user messages" (the SDK's
//   MESSAGE_BEGIN ... MESSAGE_END): the text on the HUD, a chat line, a hint. The engine keeps each message's
//   name beside the function of the game's client library that takes it, in a table of
//   `{ char name[32]; int number; int size; pfnUserMsgHook func; }` (Xash3D FWGS, engine/client/client.h,
//   cl_user_message_t: 44 bytes in a 32-bit build), and calls that function as `func(name, size, bytes)`.
//   The entry is found by its name, and the function's place in the table of functions is given a function
//   that writes the bytes down and then calls the one that was there. Nothing of the game's is changed and
//   the game sees every message as before. What the bytes MEAN is the game's own, and is read by its
//   profile (`play.messages`, cli/play.mjs).
//
//   WHERE THE PLAYER LOOKS AND STANDS. The engine hands the client library its functions in one struct,
//   cl_enginefunc_t (the SDK's engine/cdll_int.h), whose order has not changed since 1999: it begins with
//   pfnSPR_Load and pfnSPR_Frames, and its 35th, 36th and 52nd are GetViewAngles, SetViewAngles and
//   GetLocalPlayer. The first two are found in the table of functions by the engine's own exports of those
//   names, and the struct by those two numbers side by side in the memory; then `SetViewAngles` is called as
//   the game's client would call it. The player's place is `curstate.origin` of the entity GetLocalPlayer
//   gives: 704 bytes into the SDK's cl_entity_t (common/cl_entity.h; an entity_state_t is 340 bytes).
//   Checked 2026-10-13 against the game's own account of the place, in a build of Xash3D FWGS 0.21.
//   A build that does not export the two names has no `view` and no `look`, and says so.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

/**
 * Chromium drawing WebGL in software, so that the pictures are the same on a machine with no graphics card
 * and under a headless browser: the arguments the first map made with the kit was looked at with.
 */
export const SOFTWARE_GL = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
];
/**
 * Chromium drawing WebGL on the machine's graphics card, in a window of its own (`headless: false`): smooth
 * enough to film a map at the game's own frame rate, where software draws a town at a few frames a second.
 * The pictures then depend on the card: for checks, SOFTWARE_GL.
 */
export const HARDWARE_GL = ["--ignore-gpu-blocklist", "--enable-gpu-rasterization"];
/** Milliseconds between two looks at whether the engine is up. */
const READY_EVERY = 250;
/** A message the engine does not know yet is looked for again this often, and this many times. */
const LISTEN_EVERY = 5000;
const LISTEN_TRIES = 6;
/** The mouse's buttons, as Playwright names them. */
export const MOUSE_BUTTONS = ["left", "right", "middle"];

const shown = (value) => (value === undefined ? "nothing" : JSON.stringify(value));
const isText = (value) => typeof value === "string" && value.trim() !== "";

/**
 * Playwright, found in a folder: one that holds `node_modules/playwright` (or `playwright-core`), which is
 * what `npm install playwright` in that folder leaves. It is looked for there and nowhere else, and when it
 * is not there that is said in a sentence. The kit never installs it.
 */
export function playwrightFrom(folder) {
  if (!isText(folder))
    throw new Error(
      "play: Playwright is not part of this kit, which has no dependencies: name a folder that holds node_modules/playwright (--playwright <folder>, or the PLAYWRIGHT_DIR environment variable), or hand browserDriver the module itself",
    );
  const home = resolve(folder);
  const name = ["playwright", "playwright-core"].find((each) => existsSync(join(home, "node_modules", each)));
  if (!name)
    throw new Error(
      `play: there is no Playwright in ${home} (no node_modules/playwright there). It is an outside program and no part of this kit: in a folder of your own run \`npm install playwright\` and \`npx playwright install chromium\`, and name that folder`,
    );
  const found = createRequire(join(home, "package.json"))(name);
  if (!found?.chromium) throw new Error(`play: the ${name} in ${home} has no chromium to launch`);
  return found;
}

// ── what runs in the page ───────────────────────────────────────────────────
// Each of these is handed to the page as its text, so it uses nothing of this file but its own arguments.

/** Before the page's own scripts: the first WebAssembly instance with a memory and a table is kept. */
function keepEngine() {
  const kit = (window.__smak = { engine: null, heard: [], taps: {}, missing: [], funcs: 0 });
  const keep = (instance) => {
    const made = instance?.exports;
    if (!kit.engine && made?.memory instanceof WebAssembly.Memory && made.__indirect_function_table)
      kit.engine = made;
  };
  for (const name of ["instantiate", "instantiateStreaming"]) {
    const original = WebAssembly[name]?.bind(WebAssembly);
    if (!original) continue;
    WebAssembly[name] = async (...given) => {
      const result = await original(...given);
      keep(result?.instance ?? result);
      return result;
    };
  }
}

/**
 * The messages named are listened to; gives the names that could not be (not in the engine's table yet, or
 * taken by no function of the game's). Asked again, it only tries those.
 */
function hearMessages(names) {
  const kit = window.__smak;
  if (!kit?.engine) return { error: "the page made no WebAssembly instance with a memory and a table" };
  const { memory, __indirect_function_table: table } = kit.engine;
  const ENTRY = 44;
  const NAME = 32;
  const bytes = new Uint8Array(memory.buffer);
  const view = new DataView(memory.buffer);
  /** Where the entry of a message begins, looked for from `from` to `to`; -1 when it is not there. */
  const entryOf = (name, from, to) => {
    const letters = [...name].map((letter) => letter.charCodeAt(0));
    const end = Math.min(to, bytes.length - ENTRY);
    for (let at = Math.max(0, from); at < end; at++) {
      if (bytes[at] !== letters[0] || bytes[at + 1] !== letters[1]) continue;
      let same = true;
      for (let k = 2; k < letters.length && same; k++) same = bytes[at + k] === letters[k];
      // the rest of the 32 is empty, and what follows reads as a number, a size and a function
      for (let k = letters.length; k < NAME && same; k++) same = bytes[at + k] === 0;
      if (!same) continue;
      const number = view.getInt32(at + NAME, true);
      const size = view.getInt32(at + NAME + 4, true);
      const func = view.getUint32(at + NAME + 8, true);
      if (number >= 0 && number < 256 && size >= -1 && size < 256 && func < table.length) return at;
    }
    return -1;
  };
  // a function of the table has to be WebAssembly's own: this small module takes one of ours and gives it back as one
  // (type (func (param i32 i32 i32) (result i32))) (import "e" "f" (func (type 0))) (export "f" (func 0))
  const WRAPPER = new Uint8Array([
    ...[0, 97, 115, 109, 1, 0, 0, 0],
    ...[1, 8, 1, 96, 3, 127, 127, 127, 1, 127],
    ...[2, 7, 1, 1, 101, 1, 102, 0, 0],
    ...[7, 5, 1, 1, 102, 0, 0],
  ]);
  const NEAR = ENTRY * 512;
  const LOW = 64 * 1048576;
  kit.missing = [];
  for (const name of names) {
    if (Object.values(kit.taps).includes(name) || name.length < 2 || name.length >= NAME) continue;
    // the table is one block of the engine's own data: the others are beside the first that is found
    let at = kit.table ? entryOf(name, kit.table - NEAR, kit.table + NEAR) : -1;
    if (at < 0 && !kit.table) at = entryOf(name, 0, LOW);
    if (at < 0 && !kit.table) at = entryOf(name, LOW, bytes.length);
    const func = at < 0 ? 0 : view.getUint32(at + NAME + 8, true);
    if (!func) {
      kit.missing.push(name);
      continue;
    }
    kit.table ??= at;
    if (kit.taps[func]) continue;
    const original = table.get(func);
    const heard = (called, size, from) => {
      try {
        const now = new Uint8Array(kit.engine.memory.buffer, from, Math.max(0, Math.min(size, 4096)));
        kit.heard.push({ at: Date.now(), name, bytes: Array.from(now) });
      } catch {
        // a message that cannot be written down is still the game's to take
      }
      return original(called, size, from);
    };
    table.set(func, new WebAssembly.Instance(new WebAssembly.Module(WRAPPER), { e: { f: heard } }).exports.f);
    kit.taps[func] = name;
  }
  return { missing: kit.missing, heard: Object.values(kit.taps) };
}

/** What was heard since the last asking, and nothing kept. */
function takeHeard() {
  return window.__smak?.heard.splice(0) ?? [];
}

/**
 * Where the player looks and stands, after the view is set when `set` gives one: `{ yaw, pitch, origin }`,
 * or `{ error }` where the engine's functions are not found.
 */
function viewInPage(set) {
  const kit = window.__smak;
  if (!kit?.engine) return { error: "the page made no WebAssembly instance with a memory and a table" };
  const { memory, __indirect_function_table: table, malloc, free, pfnSPR_Load, pfnSPR_Frames } = kit.engine;
  const SLOTS = { GetViewAngles: 34, SetViewAngles: 35, GetLocalPlayer: 51 };
  const ORIGIN = 8 + 2 * 340 + 16;
  if (!kit.funcs) {
    if (!pfnSPR_Load || !pfnSPR_Frames || !malloc || !free)
      return {
        error: "this build of the engine does not export pfnSPR_Load, pfnSPR_Frames, malloc and free",
      };
    let first = 0;
    let second = 0;
    for (let index = 1; index < table.length && !(first && second); index++) {
      const each = table.get(index);
      if (each === pfnSPR_Load) first = index;
      else if (each === pfnSPR_Frames) second = index;
    }
    const words = new Uint32Array(memory.buffer, 0, memory.buffer.byteLength >> 2);
    const plain = (at) => {
      for (let slot = 0; slot <= SLOTS.GetLocalPlayer; slot++)
        if (!words[at + slot] || words[at + slot] >= table.length) return false;
      return true;
    };
    for (let at = 0; first && second && at < words.length - 64 && !kit.funcs; at++)
      if (words[at] === first && words[at + 1] === second && plain(at)) kit.funcs = at * 4;
    if (!kit.funcs) return { error: "the engine's functions for the client were not found in its memory" };
  }
  const data = new DataView(memory.buffer);
  const func = (name) => table.get(data.getUint32(kit.funcs + SLOTS[name] * 4, true));
  const at = malloc(12);
  try {
    const angles = () => new Float32Array(kit.engine.memory.buffer, at, 3);
    func("GetViewAngles")(at);
    if (set) {
      const [pitch, yaw] = angles();
      // the engine's pitch is under 0 when the player looks up
      angles().set([set.pitch === undefined ? pitch : -set.pitch, set.yaw === undefined ? yaw : set.yaw, 0]);
      func("SetViewAngles")(at);
      func("GetViewAngles")(at);
    }
    const [pitch, yaw] = angles();
    const player = func("GetLocalPlayer")();
    const now = new DataView(kit.engine.memory.buffer);
    const origin = player ? [0, 4, 8].map((k) => now.getFloat32(player + ORIGIN + k, true)) : null;
    return { yaw, pitch: pitch === 0 ? 0 : -pitch, origin };
  } finally {
    free(at);
  }
}

/** A file written into the engine's own file system (Emscripten's FS), its folders made. */
function putInPage([engine, path, base64]) {
  const files = window[engine]?.FS;
  if (!files) return { error: `the page's ${engine} has no file system (FS)` };
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let at = 0; at < raw.length; at++) bytes[at] = raw.charCodeAt(at);
  const whole = `/${path.replace(/^\/+/, "")}`;
  files.mkdirTree(whole.slice(0, whole.lastIndexOf("/")) || "/");
  files.writeFile(whole, bytes);
  return { size: bytes.length };
}

/** A file of the engine's own file system, as base64; `{ error }` when it is not there. */
function readInPage([engine, path]) {
  const files = window[engine]?.FS;
  if (!files) return { error: `the page's ${engine} has no file system (FS)` };
  try {
    const bytes = files.readFile(`/${path.replace(/^\/+/, "")}`);
    let raw = "";
    for (let at = 0; at < bytes.length; at += 32768)
      raw += String.fromCharCode(...bytes.subarray(at, at + 32768));
    return { base64: btoa(raw) };
  } catch (error) {
    return { error: `no such file in the engine: ${path} (${error.message})` };
  }
}

// ── the driver ──────────────────────────────────────────────────────────────
/**
 * The driver for a browser build of Xash3D: a headless Chromium opened on the page that runs the engine.
 *
 *   url           the page's address
 *   playwright    the Playwright module (`{ chromium }`), or a folder to find it in (`playwrightFrom`)
 *   width, height the page's size, which is the game's screen and the pictures' size (1024 by 768)
 *   readyWithin   milliseconds the engine is given to come up (120000)
 *   engine        the name of the page's global that is the engine's Emscripten module: commands are run by
 *                 its `ccall("Cmd_ExecuteString", ...)` and files put by its `FS` ("xash")
 *   readyFlag     the name of the global the page sets when the engine takes commands ("xashReady")
 *   args          Chromium's arguments (`SOFTWARE_GL`)
 *   messages      the names of the game's user messages to listen to (`["TextMsg", "SayText"]`): each one
 *                 heard comes back from `lines()` with its bytes. None unless told
 *   headless      false to see the browser's window (true)
 *
 * The two names are the page's own, not the engine's: they are what the one build this was tried with calls
 * them, and another page's are passed. Nothing is opened until `ready()` is called.
 *
 * Beside what `play` asks of every driver (ready, command, keyDown, keyUp, press, click, wait, shot, log,
 * close) this one has:
 *   lines(from)        everything heard, from the `from`th on: `{ at, kind, text }` for a line of the page's
 *                      console ("console") and for an error of the page ("error"), `{ at, kind, bytes }` for
 *                      a user message, `kind` its name. `at` is the clock's milliseconds
 *   view()             `{ yaw, pitch, origin }`: where the player looks (pitch over 0: up) and stands
 *   look({ yaw, pitch }) the view set, either or both; gives the view as it then is
 *   mouseDown(button), mouseUp(button)   a button of the mouse held and let go: "left", "right", "middle"
 *   put(path, bytes)   a file written into the engine's file system, as `msc/maps/yard.bsp`: what the
 *                      engine reads the next time it opens that file
 *   read(path)         a file of the engine's file system, as bytes: what the game wrote there (a save)
 *   leave()            the map left (`disconnect`), so that the game writes what it writes at a map's end
 *                      before files are put, and not over them
 *   recordStart({ quality })   the page filmed from now: the browser's screencast, a JPEG (quality 90) each
 *                      time the page is drawn, with the moment it was drawn
 *   recordStop()       the filming ended: `[{ at, jpeg }]`, `at` in milliseconds (video.mjs `encodeTimed`
 *                      makes them an MP4 at a steady rate)
 * `log()` is the console's lines and the page's errors, which begin `PAGE ERROR:`, as before.
 */
export function browserDriver({
  url,
  playwright,
  width = 1024,
  height = 768,
  readyWithin = 120000,
  engine = "xash",
  readyFlag = "xashReady",
  args = SOFTWARE_GL,
  messages = [],
  headless = true,
} = {}) {
  if (!(typeof url === "string" && /^https?:\/\//i.test(url)))
    throw new Error(
      `play: url is the address of the page that runs the engine (http://...), not ${shown(url)}`,
    );
  if (![width, height].every((side) => Number.isInteger(side) && side > 0))
    throw new Error(
      `play: width and height are whole numbers of pixels, not ${shown(width)} by ${shown(height)}`,
    );
  if (!(Array.isArray(messages) && messages.every(isText)))
    throw new Error(`play: messages is a list of the names of user messages, not ${shown(messages)}`);
  const library =
    typeof playwright === "string" || playwright === undefined ? playwrightFrom(playwright) : playwright;
  if (typeof library?.chromium?.launch !== "function")
    throw new Error(
      "play: playwright is the Playwright module ({ chromium }), or the folder it is installed in",
    );
  const heard = [];
  let browser = null;
  let page = null;
  let unheard = [...messages];
  let pointed = false;
  /** The screencast being filmed: its DevTools session and the frames it has sent. */
  let cast = null;
  let tries = 0;
  let tried = 0;
  const fail = (sentence) => {
    throw new Error(`play: ${sentence}`);
  };
  const opened = () => page ?? fail("the browser is not open: ready() comes first");
  const note = (kind, text) => heard.push({ at: Date.now(), kind, text });
  /** The messages not listened to yet are tried again: a game's library may hook its own late. */
  const listen = async () => {
    // looking for a name the engine does not have reads its whole memory: not at every asking
    if (!unheard.length || tries >= LISTEN_TRIES || Date.now() - tried < LISTEN_EVERY) return;
    tries++;
    tried = Date.now();
    const told = await opened()
      .evaluate(hearMessages, messages)
      .catch((error) => ({ error: error.message.split("\n")[0] }));
    unheard = told.error ? unheard : told.missing;
    return told;
  };
  /** The mouse is brought over the game once, so that a button pressed is the game's. */
  const point = async () => {
    if (!pointed) await opened().mouse.move(Math.round(width / 2), Math.round(height / 2));
    pointed = true;
  };
  const seen = async (set) => {
    const told = await opened().evaluate(viewInPage, set ?? null);
    if (told.error) fail(`the view cannot be ${set ? "set" : "read"}: ${told.error}`);
    return told;
  };
  return {
    async ready() {
      browser = await library.chromium.launch({ args, headless });
      page = await browser.newPage({ viewport: { width, height } });
      await page.addInitScript(keepEngine);
      page.on("console", (message) => note("console", message.text()));
      page.on("pageerror", (error) => note("error", `PAGE ERROR: ${error.message}`));
      try {
        await page.goto(url);
      } catch (error) {
        fail(`nothing answers at ${url}: is the game's page being served? (${error.message.split("\n")[0]})`);
      }
      // asked four times a second: the page sets the flag when the engine's main loop runs
      for (let waited = 0; waited < readyWithin; waited += READY_EVERY) {
        await page.waitForTimeout(READY_EVERY);
        if (await page.evaluate((flag) => Boolean(window[flag]), readyFlag).catch(() => false)) {
          const told = await listen();
          if (told?.error) note("play", `the game's messages are not heard: ${told.error}`);
          return;
        }
      }
      fail(
        `the engine at ${url} did not come up in ${Math.round(readyWithin / 1000)} seconds: the page never set window.${readyFlag}. The console's last lines are in the log`,
      );
    },
    async command(text) {
      try {
        await opened().evaluate(
          ([name, command]) => window[name].ccall("Cmd_ExecuteString", null, ["string"], [command]),
          [engine, text],
        );
      } catch (error) {
        fail(`the engine did not take the command ${shown(text)}: ${error.message.split("\n")[0]}`);
      }
    },
    keyDown: (key) => opened().keyboard.down(key),
    keyUp: (key) => opened().keyboard.up(key),
    press: (key) => opened().keyboard.press(key),
    click: (x, y) => opened().mouse.click(x, y),
    async mouseDown(button) {
      await point();
      await opened().mouse.down({ button });
    },
    mouseUp: (button) => opened().mouse.up({ button }),
    wait: (ms) => opened().waitForTimeout(ms),
    async shot(file) {
      await opened().screenshot({ path: file });
    },
    view: () => seen(),
    look: (to) => seen(to),
    async leave() {
      // queued for the engine's own frame: run from outside one, `disconnect` leaves it by a jump the page
      // cannot follow (the engine's Host_AbortCurrentFrame)
      await opened().evaluate(
        (name) => window[name].ccall("Cbuf_AddText", null, ["string"], ["disconnect\n"]),
        engine,
      );
    },
    async put(path, bytes) {
      const told = await opened().evaluate(putInPage, [engine, path, Buffer.from(bytes).toString("base64")]);
      if (told.error) fail(`${path} was not put: ${told.error}`);
      return told;
    },
    async read(path) {
      const told = await opened().evaluate(readInPage, [engine, path]);
      if (told.error) fail(told.error);
      return Buffer.from(told.base64, "base64");
    },
    async lines(from = 0) {
      if (page) {
        await listen();
        const taken = await page.evaluate(takeHeard).catch(() => []);
        for (const each of taken) heard.push({ at: each.at, kind: each.name, bytes: each.bytes });
      }
      return heard.slice(from);
    },
    /** The messages asked for that the engine has no function for yet. */
    unheard: () => [...unheard],
    log: () =>
      heard.filter((each) => each.text !== undefined && each.kind !== "play").map((each) => each.text),
    async recordStart({ quality = 90 } = {}) {
      if (cast) fail("a clip is being filmed already: recordStop() ends it first");
      const cdp = await opened().context().newCDPSession(page);
      const frames = [];
      cdp.on("Page.screencastFrame", (frame) => {
        const at = frame.metadata?.timestamp ? frame.metadata.timestamp * 1000 : Date.now();
        frames.push({ at, jpeg: Buffer.from(frame.data, "base64") });
        // the next frame comes only once this one is taken
        cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
      });
      await cdp.send("Page.startScreencast", { format: "jpeg", quality, maxWidth: width, maxHeight: height, everyNthFrame: 1 }); // prettier-ignore
      cast = { cdp, frames };
    },
    async recordStop() {
      if (!cast) return [];
      const { cdp, frames } = cast;
      cast = null;
      await cdp.send("Page.stopScreencast").catch(() => {});
      await cdp.detach().catch(() => {});
      return frames;
    },
    async close() {
      cast = null;
      await browser?.close();
      browser = null;
      page = null;
    },
  };
}
