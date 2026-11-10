// The tool `run`: a script the client wrote, run by Node in a process of its own, in the work folder. It is
// how a shape is built and a model painted through this server, since both are functions and not settings.
//
// THIS RUNS WHATEVER CODE IT IS GIVEN, with everything the person who started the server may do on the
// machine. Nothing holds the script inside the two folders. `--no-run` starts the server without it.
//
// So that `import * as smak from "smak"` finds the kit, the work folder gets a `node_modules/smak` that is a
// link to the kit's folder: a junction on Windows, which needs no rights an ordinary account lacks, and a
// symbolic link elsewhere. Node looks for a package in the `node_modules` beside the importing file and
// above it, so the script (and any module it leaves in the work folder) finds it there, and the kit's own
// package.json says what "smak", "smak/workshop" and "smak/kits/swordkit" stand for.
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import * as smak from "../../src/index.mjs";
import { text, image } from "./protocol.mjs";
import { filesUnder, pathOf, LINK_FOLDER } from "./folders.mjs";
import { KIT } from "./guide.mjs";

/** How long a script may run when the call does not say, and the longest it may ask for, in seconds. */
export const TIMEOUT_SECONDS = 120;
export const TIMEOUT_MOST_SECONDS = 600;
/** What a script printed is cut to this many characters, for each of its two streams. */
export const OUTPUT_MOST = 6000;
/** How many pictures one call may ask to be shown. */
export const SHOWN_MOST = 3;
/** The longest side, in pixels, of a picture handed to the client: a larger one is shrunk to fit. */
export const PICTURE_MOST = 1024;
/**
 * A picture handed to the client keeps this many levels of each of red, green and blue. A drawn model is
 * full of fine grain that a PNG file cannot pack; with 32 levels in place of 256 the file is well under half
 * the size, and a shape, a seam or a colour reads the same.
 */
const COLOUR_LEVELS = 32;
const BYTE_MOST = 255;
/** What the script's file is called when the call gives it no name; it is removed after the run. */
const SCRIPT_NAME = "smak-run";
const MILLISECONDS = 1000;

/**
 * The bytes of a PNG file as they are handed to the client: shrunk by a whole number where its longer side
 * is over `most` pixels, in COLOUR_LEVELS levels a channel, and with nothing see-through.
 */
export function pictureWithin(pngBytes, most = PICTURE_MOST) {
  const picture = smak.unpng(pngBytes);
  const factor = Math.ceil(Math.max(picture.width, picture.height) / most);
  const small = factor > 1 ? smak.shrink(smak.rgbOf(picture), factor) : smak.rgbOf(picture);
  const step = BYTE_MOST / (COLOUR_LEVELS - 1);
  const rgba = new Uint8Array(small.width * small.height * 4).fill(BYTE_MOST);
  for (let i = 0; i < small.width * small.height; i++)
    for (let channel = 0; channel < 3; channel++)
      rgba[i * 4 + channel] = Math.round(Math.round(small.rgb[i * 3 + channel] / step) * step);
  return smak.png(small.width, small.height, rgba);
}

/**
 * Makes sure the work folder has its link to the kit, so that a script there can import "smak". It throws
 * when something else is already in the link's place.
 */
export function linkKit(work) {
  const link = join(work, LINK_FOLDER, "smak");
  const kit = realpathSync(KIT);
  if (existsSync(link)) {
    if (realpathSync(link) === kit) return;
    throw new Error(`${link} is there already and is not this kit: scripts would import another`);
  }
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(kit, link, "junction");
}

/** Gathers what a stream says, keeping its first and its last `most / 2` characters once it says more. */
function gather(stream, most = OUTPUT_MOST) {
  const half = most / 2;
  let head = "";
  let tail = "";
  let total = 0;
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    total += chunk.length;
    const room = most - head.length;
    head += chunk.slice(0, room);
    tail = (tail + chunk.slice(room)).slice(-half);
  });
  return () => {
    if (total <= most) return head;
    return `${head.slice(0, half)}\n[... ${total - most} of ${total} characters cut here ...]\n${tail}`;
  };
}

/**
 * What a script printed, without what costs words and says nothing: the script's whole address (its name
 * stays), the lines of an error's trace that are inside Node, and Node's version under it.
 */
const tidy = (printed, script) =>
  printed
    .split(pathToFileURL(script).href)
    .join(basename(script))
    .split(/\r?\n/)
    .filter((line) => !/^\s+at .*node:internal/.test(line) && !/^Node\.js v/.test(line))
    .join("\n")
    .trim();

/** Runs a script's file with Node in the work folder. Resolves to { code, stopped, seconds, out, err }. */
function runNode(script, folders, seconds, signal) {
  return new Promise((done) => {
    const began = Date.now();
    const child = spawn(process.execPath, [script], {
      cwd: folders.work,
      env: { ...process.env, SMAK_WORK: folders.work, SMAK_MODELS: folders.models ?? "" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const out = gather(child.stdout);
    const err = gather(child.stderr);
    let stopped = "";
    const stop = (why) => {
      stopped = why;
      child.kill();
    };
    const timer = setTimeout(
      () => stop(`it ran over its ${seconds} seconds and was stopped`),
      seconds * MILLISECONDS,
    );
    const cancelled = () => stop("the call was taken back and it was stopped");
    signal?.addEventListener("abort", cancelled);
    if (signal?.aborted) cancelled();
    child.on("error", (error) => stop(`it could not be started: ${error.message}`));
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancelled);
      const took = (Date.now() - began) / MILLISECONDS;
      done({ code, stopped, seconds: took, out: tidy(out(), script), err: tidy(err(), script) });
    });
  });
}

/** What a run wrote, as words: the files that are new or changed, and those that are gone. */
function writtenSince(before, after) {
  const was = new Map(before.map((file) => [file.name, file]));
  const now = new Set(after.map((file) => file.name));
  const written = after.filter((file) => {
    const old = was.get(file.name);
    return !old || old.stamp !== file.stamp || old.bytes !== file.bytes;
  });
  const gone = before.filter((file) => !now.has(file.name));
  const lines = [
    written.length
      ? `written: ${written.map((file) => `${file.name} (${file.bytes} bytes)`).join(", ")}`
      : "no file written",
  ];
  if (gone.length) lines.push(`removed: ${gone.map((file) => file.name).join(", ")}`);
  return lines.join("\n");
}

/**
 * A kept script's text after `edits`: each is { old, new }, and `old` must be in the text exactly once (so a
 * change lands where it was meant, or is refused), in the order given.
 */
export function edited(script, edits) {
  if (!Array.isArray(edits)) throw new Error("edits: a list of { old, new }");
  let changed = script;
  for (const [number, change] of edits.entries()) {
    if (typeof change?.old !== "string" || !change.old || typeof change.new !== "string")
      throw new Error(`edits: number ${number + 1} needs "old" (text that is in the script) and "new"`);
    const times = changed.split(change.old).length - 1;
    if (times !== 1) {
      const advice = times ? "give more of the text round it" : "the script was not changed";
      throw new Error(
        `edits: the "old" of number ${number + 1} is in the script ${times} times, not once: ${advice}`,
      );
    }
    changed = changed.replace(change.old, () => change.new);
  }
  return changed;
}

/**
 * The tool: `script` (the text of an ES module) is written into the work folder and run there.
 *   timeout  seconds it may take (TIMEOUT_SECONDS; TIMEOUT_MOST_SECONDS at most)
 *   name     keep the script in the work folder under this name, so that a later one can import it or it
 *            can be run again; without it the file is removed after the run
 *   edits    in place of `script`, with the `name` of a script kept before: [{ old, new }] changed in it
 *            (see edited) before it is run again, so that a small change does not send the whole text;
 *            neither `script` nor `edits`, with a `name`: the kept script run again as it is
 *   show    up to SHOWN_MOST of the PNG files it wrote, to come back as pictures in the same answer
 * Returns { content, isError }: how it ended, what it printed, what it wrote, and the pictures. A script
 * that ends with an error, or is stopped, is an error of the tool.
 */
export async function run(folders, { script, edits, timeout, name, show = [] }, { signal } = {}) {
  const given = typeof script === "string" && Boolean(script.trim());
  if (given && edits) throw new Error('script or edits, not both: edits change the script kept under "name"');
  if (!given && !name)
    throw new Error('script: the text of an ES module is needed (or the "name" of one kept before)');
  if (!Array.isArray(show) || show.length > SHOWN_MOST)
    throw new Error(`show: a list of up to ${SHOWN_MOST} PNG files of the work folder`);
  const seconds = Math.min(TIMEOUT_MOST_SECONDS, Math.max(1, Number(timeout) || TIMEOUT_SECONDS));
  const kept = name ? pathOf(folders, `work:${name.replace(/(\.mjs)?$/, ".mjs")}`, { write: true }) : null;
  const file = kept ?? join(folders.work, `${SCRIPT_NAME}-${process.pid}.mjs`);
  if (!given && !existsSync(file))
    throw new Error(`no script is kept as ${basename(file)}: send "script" with this "name" first`);
  const toRun = given ? script : edits ? edited(readFileSync(file, "utf8"), edits) : null;
  linkKit(folders.work);
  mkdirSync(dirname(file), { recursive: true });
  // the script's own file is not among what the run is said to have written
  const others = () => filesUnder(folders.work).filter((one) => join(folders.work, one.name) !== file);
  const before = others();
  if (toRun !== null) writeFileSync(file, toRun);
  const ended = await runNode(file, folders, seconds, signal);
  if (!kept) rmSync(file, { force: true });

  const failed = Boolean(ended.stopped) || ended.code !== 0;
  const how = ended.stopped || (failed ? `it ended with an error (exit code ${ended.code})` : "it ran");
  const words = [`${how}, in ${ended.seconds.toFixed(1)} s`];
  if (ended.out) words.push(`stdout:\n${ended.out}`);
  if (ended.err) words.push(`stderr:\n${ended.err}`);
  words.push(writtenSince(before, others()));
  const content = [text(words.join("\n"))];
  for (const picture of show) {
    try {
      const path = pathOf(folders, `work:${picture}`);
      if (!/\.png$/i.test(path)) throw new Error(`${picture} is not a PNG file`);
      content.push(image(pictureWithin(readFileSync(path))));
    } catch (error) {
      content.push(text(`not shown: ${error.message}`));
    }
  }
  return { content, isError: failed };
}
