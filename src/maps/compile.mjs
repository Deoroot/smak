// A `.map` compiled into the `.bsp` the game loads, by the four programs every GoldSrc map goes through:
//
//   hlcsg   cuts the brushes against each other and looks every texture up in the .wad files
//   hlbsp   builds the tree the engine draws and collides with, and finds LEAKS
//   hlvis   works out what can be seen from where (slow on a large open map; `fast` for a draft)
//   hlrad   lights it: light entities, texture lights, the sky
//
// THE COMPILERS ARE NOT PART OF THIS KIT. They are an outside program the person installs once: VHLT, also
// known as Vluzacn's ZHLT v34 (hlcsg, hlbsp, hlvis and hlrad, with their zhlt.wad), or SDHLT, its fork that
// builds on Linux (sdHLCSG... with their sdhlt.wad). `findCompilers` looks for
// them in a folder you name, in the folder the VHLT_DIR environment variable names, and on the PATH, and
// says in one sentence what is missing. Nothing here works without them, and each function says so.
//
// WHY A .bsp ON THE DISK IS NOT ENOUGH. The four programs end with code 0 in cases that are no success: a
// leak leaves hlvis nothing to do and the whole map is drawn at once, and hlrad then lights every face the
// same. So what they print is read as well, and any line of error or leak makes the compile a failure. The
// work is done in a folder of its own, and the `.bsp` is put where it was asked for only when all of it
// went well: a failed compile leaves no half-made result behind.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  writeSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { join, resolve, dirname, basename, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir, availableParallelism } from "node:os";
import { readMap } from "./source.mjs";
import { TIMED_OUT, COULD_NOT_RUN } from "./compile-run.mjs";

/** The four programs, in the order they run. */
export const COMPILERS = ["hlcsg", "hlbsp", "hlvis", "hlrad"];
/** The environment variable that names the compilers' folder. */
export const COMPILERS_VARIABLE = "VHLT_DIR";
/**
 * The engines a compile can be held to with `engine`: SDHLT's goldsrc fork (goldsrc-net, and 2cwldys's) takes
 * `-engine goldsrc|xash` in all four programs, and with xash holds the map to Xash3D FWGS's limits and writes
 * bsp30ext or BSP2 only where version 30 cannot number it. VHLT and stock SDHLT know no such switch.
 */
export const ENGINES = ["goldsrc", "xash"];
/**
 * The layouts a compile can be told to write with `format`, whether or not the map outgrows version 30 (the same
 * fork's `-format`): bsp30ext and bsp2 only with the engine xash, which alone reads them.
 */
export const BSP_FORMATS = ["bsp30", "bsp30ext", "bsp2"];
/**
 * The names a compiler's file may have, most wanted first: `hlcsg` gives hlcsg_x64.exe, hlcsg.exe... and then
 * SDHLT's (seedee's fork of VHLT v34, which builds on Linux): sdHLCSG_x64.exe, sdHLCSG.exe, sdHLCSG.
 */
const FILE_NAMES = (tool) =>
  [tool, `sd${tool.toUpperCase()}`].flatMap((name) => [`${name}_x64.exe`, `${name}.exe`, `${name}_x64`, name]);
/**
 * Where SDHLT's release keeps its programs under the folder it unpacks to (`sdhlt/tools/Win64/sdHLCSG_x64.exe`),
 * so the folder of the release can be named as it is.
 */
const RELEASE_FOLDERS =
  process.platform !== "win32"
    ? ["tools/Linux", "Linux"]
    : process.arch === "ia32"
      ? ["tools/Win32", "Win32"]
      : ["tools/Win64", "Win64", "tools/Win32", "Win32"];
/** What the compilers are, said wherever they are missing. */
const WHAT_THEY_ARE =
  "the map compilers VHLT (Vluzacn's ZHLT v34: hlcsg, hlbsp, hlvis, hlrad), an outside program that is not part of this kit";
/** Where to put them, said with it. */
const HOW_TO_GIVE = `install them and name their folder: findCompilers({ folder }), or the ${COMPILERS_VARIABLE} environment variable, or put them on the PATH`;

/**
 * The lines that make a compile count for nothing though the program ended with code 0: an error, a leak,
 * a brush the compiler had to mend or drop, a map with no visibility, a face of mixed contents.
 */
export const BAD_LINE = /\b(error|leak|warning: brush|no visibility|mixed face contents)\b/i;
/** A line that warns without spoiling the result. */
const WARNING_LINE = /^\s*warning\b/i;
/**
 * hlbsp's word for a leak (`Warning: === LEAK in hull 0 ===`), the lines of the explanation it prints after
 * it, which are no errors of their own, and the entity it names: `Entity light @ (  10, -20,  30)` (VHLT),
 * `Entity light at ( 10  -20   30)` (SDHLT).
 */
const LEAK_FOUND = /===\s*leak\b/i;
const LEAK_TALK = /\bleak\b|listed in the error|^error:?\s*$/i;
const LEAK_ENTITY = /Entity\s+(\S+)\s*(?:@|at)\s*\(\s*(-?[\d.]+)\s*,?\s*(-?[\d.]+)\s*,?\s*(-?[\d.]+)\s*\)/i;
/** hlcsg's words for a texture that is in none of the .wad files. */
const MISSING_TEXTURE = /texture\s+(\S+)\s+not found/i;
/** How long each program may run, in milliseconds, before it is stopped. */
const TIMEOUTS = { hlcsg: 120_000, hlbsp: 120_000, hlvis: 900_000, hlrad: 900_000 };
/** The program that runs a compiler with its output passing through (`progress`). */
const RUNNER = join(dirname(fileURLToPath(import.meta.url)), "compile-run.mjs");
/** How much longer than a compiler's own limit its runner is waited for, in milliseconds. */
const RUNNER_SLACK = 15_000;
/**
 * hlvis's work, foretold from what hlbsp leaves it: the portals of the .prt file, the openings between the
 * leaves of the map, each of which a full hlvis holds against the others it may see through.
 * What was measured (VHLT v34, 12 threads, 2026-10): a map of 5088 portals between 1395 leaves took a full
 * hlvis 219 seconds; one of 269 portals between 115 leaves, 0.01. Two maps are no curve: the time is taken
 * to grow with the square of the count (every portal against every other). That is a guess and no floor:
 * a map of 595 portals was guessed at 3 seconds and took a tenth of one (the Barrow Road, 2026-10-13),
 * since what a portal sees matters as much as how many there are. So a guess is said only from GUESS_FROM
 * seconds, where it tells minutes from seconds; under it the portals are counted and nothing is foretold,
 * and once hlvis has run, what it took is said instead. From MANY_PORTALS a full hlvis is minutes, and it
 * is said before hlvis begins.
 */
const VIS_MEASURED = { portals: 5088, seconds: 219 };
const MANY_PORTALS = 4000;
const GUESS_FROM = 60;
/** The compilers print in the machine's old code page; latin1 keeps every byte. */
const LOG_ENCODING = "latin1";
/** How much a program may print before it is cut off. */
const LOG_LIMIT = 64 * 1024 * 1024;

/**
 * Looks for the four compilers: in `folder` when given, then in the folder the VHLT_DIR environment
 * variable names, then in every folder of the PATH. It returns
 *   { found, tools: { hlcsg, hlbsp, hlvis, hlrad }, folder, missing, searched, message }
 * `tools` holds each program's path (all four from one folder: the first that has them all), `missing` the
 * names not found, `searched` where it looked, and `message` one sentence that says what was found, or what
 * is missing and what to do about it. It never throws.
 */
export function findCompilers({ folder, env = process.env } = {}) {
  const places = [];
  /** A folder named, and the folders SDHLT's release keeps its programs in under it. */
  const withRelease = (place) => [place, ...RELEASE_FOLDERS.map((sub) => join(place, sub))];
  if (folder) places.push(...withRelease(resolve(folder)));
  if (env[COMPILERS_VARIABLE]) places.push(...withRelease(resolve(env[COMPILERS_VARIABLE])));
  for (const place of (env.PATH ?? env.Path ?? "").split(delimiter)) if (place) places.push(place);
  const searched = [...new Set(places)];
  /** The compilers a folder has: `{ hlcsg: path, ... }` for those that are there. */
  const toolsIn = (place) => {
    const tools = {};
    for (const tool of COMPILERS) {
      const file = FILE_NAMES(tool)
        .map((name) => join(place, name))
        .find((path) => existsSync(path));
      if (file) tools[tool] = file;
    }
    return tools;
  };
  let best = { tools: {}, folder: null };
  for (const place of searched) {
    const tools = toolsIn(place);
    if (Object.keys(tools).length > Object.keys(best.tools).length) best = { tools, folder: place };
    if (Object.keys(tools).length === COMPILERS.length) break;
  }
  const missing = COMPILERS.filter((tool) => !best.tools[tool]);
  const found = !missing.length;
  const named = [
    folder && `the folder ${resolve(folder)}`,
    env[COMPILERS_VARIABLE] && `${COMPILERS_VARIABLE} (${env[COMPILERS_VARIABLE]})`,
    "the PATH",
  ]
    .filter(Boolean)
    .join(", ");
  let message;
  if (found) message = `the compilers are in ${best.folder}`;
  else if (!best.folder)
    message = `this needs ${WHAT_THEY_ARE}, and none of them was found (looked in ${named}): ${HOW_TO_GIVE}`;
  else
    message = `this needs ${WHAT_THEY_ARE}, and ${best.folder} has no ${missing.join(", ")}: ${HOW_TO_GIVE}`;
  return { found, tools: best.tools, folder: best.folder, missing, searched, message };
}

/** The points of a leak's trail, from the file hlbsp leaves: one `x y z` a line (a .lin has two a line). */
function trailOf(text) {
  const points = [];
  for (const line of text.split(/\r?\n/)) {
    const numbers = (line.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    for (let at = 0; at + 2 < numbers.length; at += 3) points.push(numbers.slice(at, at + 3));
  }
  return points;
}

/** The entities of a map's text that have a place: `[{ classname, origin, targetname }]`; none when unread. */
function placedEntities(mapText) {
  let map;
  try {
    map = readMap(mapText);
  } catch {
    return [];
  }
  const placed = [];
  for (const one of map.entities) {
    const origin = (one.origin ?? "").trim().split(/\s+/).map(Number);
    if (origin.length === 3 && origin.every(Number.isFinite))
      placed.push({ classname: one.classname, origin, targetname: one.targetname });
  }
  return placed;
}

/** The box round a map's world brushes, from the points its planes are written with; null when unread. */
function worldBox(mapText) {
  let map;
  try {
    map = readMap(mapText);
  } catch {
    return null;
  }
  const points = map.brushes.flatMap((brush) => brush.faces.flatMap((face) => face.points));
  if (!points.length) return null;
  // (reduce, not Math.min(...points): a big map's points overflow the call stack as arguments)
  return {
    min: [0, 1, 2].map((i) => points.reduce((m, point) => Math.min(m, point[i]), Infinity)),
    max: [0, 1, 2].map((i) => points.reduce((m, point) => Math.max(m, point[i]), -Infinity)),
  };
}

/**
 * What is known of a leak: the entity hlbsp names, the trail it wrote from that entity out to the void, and
 * the entity of the map nearest to where the trail leaves the world.
 */
function leakOf(log, workBase, mapText) {
  const named = LEAK_ENTITY.exec(log);
  let points = [];
  for (const ending of [".pts", ".lin"]) {
    if (points.length || !existsSync(workBase + ending)) continue;
    points = trailOf(readFileSync(workBase + ending, "utf8"));
  }
  const entity = named
    ? { classname: named[1], origin: [Number(named[2]), Number(named[3]), Number(named[4])] }
    : null;
  // The trail starts where the entity's own space ends (the first opening on the way out, which in a
  // simple room is the hole itself) and wanders on through the void. Put that end first.
  const world = worldBox(mapText);
  const insideWorld = (point) =>
    world && [0, 1, 2].every((i) => point[i] >= world.min[i] && point[i] <= world.max[i]);
  if (points.length > 1 && !insideWorld(points[0]) && insideWorld(points[points.length - 1]))
    points.reverse();
  // where it gets out: the last point of the trail that is still inside the box of the world's brushes
  const firstOut = points.findIndex((point) => !insideWorld(point));
  const at = points.length
    ? points[Math.max(0, (firstOut < 0 ? points.length : firstOut) - 1)]
    : (entity?.origin ?? null);
  let nearest = null;
  if (at)
    for (const one of placedEntities(mapText)) {
      const distance = Math.hypot(one.origin[0] - at[0], one.origin[1] - at[1], one.origin[2] - at[2]);
      if (!nearest || distance < nearest.distance) nearest = { ...one, distance: Math.round(distance) };
    }
  return { entity, points, at, nearest };
}

/** A leak, said in a sentence. */
function leakSentence(leak) {
  const place = (point) => point.map((value) => Math.round(value)).join(" ");
  const from = leak.entity
    ? ` It was found from the ${leak.entity.classname} at ${place(leak.entity.origin)}.`
    : "";
  const out =
    leak.at && leak.points.length
      ? ` The trail (${leak.points.length} points) leaves the world near ${place(leak.at)}`
      : "";
  const near =
    out && leak.nearest
      ? `, ${leak.nearest.distance} units from the ${leak.nearest.classname} at ${place(leak.nearest.origin)}.`
      : out
        ? "."
        : "";
  return `the map LEAKS: the space the entities are in is open to the void outside, through a gap between world brushes or because an entity is outside the map.${from}${out}${near} Close the gap with world brushes (brush entities seal nothing) and compile again`;
}

/** A share of an engine's limit from which a map is said to be near it. */
const NEAR_LIMIT = 0.75;
/**
 * The engine's limits as the compilers' charts give them: `* AllocBlock 5/64`, `* worldleaves 771/8192`,
 * `* worldfaces 2791/32768`, and the lumps' rows (`models 2/512 ...`). The last of each name: { name: { used, most } }.
 */
export function limitsOf(text) {
  const limits = {};
  for (const match of text.matchAll(/^\s*\*?\s*([A-Za-z]+)\s+(\d+)\s*\/\s*(\d+)/gm)) {
    const [, name, used, most] = match;
    if (Number(most) > 0) limits[name.toLowerCase()] = { used: Number(used), most: Number(most) };
  }
  return limits;
}

/**
 * The compilers' own .wad, kept beside them: the pictures of ORIGIN, CLIP, NULL, HINT, SKIP and the like.
 * VHLT's is zhlt.wad, SDHLT's sdhlt.wad; SDHLT's release keeps it in `tools`, a folder over the programs
 * (`tools/Win64`, `tools/Win32`, `tools/Linux`), so it is looked for there too.
 */
const TOOL_WADS = ["zhlt.wad", "sdhlt.wad"];

/** Where worldspawn's keys end in a map's text: at its first brush, or at its closing brace. */
function worldHeadEnd(mapText) {
  const open = mapText.indexOf("{");
  const firstBrush = mapText.indexOf("{", open + 1);
  const end = mapText.indexOf("}", open);
  return firstBrush >= 0 && firstBrush < end ? firstBrush : end;
}

/** The .wad files worldspawn's `wad` key lists in a map's text. */
function wadsOf(mapText) {
  const key = /^\s*"wad"\s+"([^"]*)"\s*$/m.exec(mapText.slice(0, worldHeadEnd(mapText)));
  return key ? key[1].split(";").filter(Boolean) : [];
}

/** The map's text with worldspawn's `wad` key set to these files. */
function withWads(mapText, wadFiles) {
  const line = `"wad" "${wadFiles.join(";")}"`;
  const open = mapText.indexOf("{");
  const headEnd = worldHeadEnd(mapText);
  const head = mapText.slice(0, headEnd);
  if (/^\s*"wad"\s+"[^"]*"\s*$/m.test(head))
    return head.replace(/^\s*"wad"\s+"[^"]*"\s*$/m, line) + mapText.slice(headEnd);
  return `${mapText.slice(0, open + 1)}\n${line}${mapText.slice(open + 1)}`;
}

/**
 * The portals hlbsp left for hlvis: `{ leaves, portals }` from the first two numbers of its .prt file, or
 * null when there is none (a leak, or a map never cut). `seconds` is what a full hlvis is guessed to take
 * from one map measured (see VIS_MEASURED): a guess, said only from GUESS_FROM seconds.
 */
function portalsOf(workBase) {
  if (!existsSync(`${workBase}.prt`)) return null;
  const [leaves, portals] = readFileSync(`${workBase}.prt`, "latin1").split(/\s+/).filter(Boolean).map(Number);
  if (!Number.isInteger(leaves) || !Number.isInteger(portals)) return null;
  const seconds = Math.round(VIS_MEASURED.seconds * (portals / VIS_MEASURED.portals) ** 2);
  return { leaves, portals, seconds };
}

/**
 * A program run and waited for: `{ text, status, timedOut, failed }`. With `progress` it is run by RUNNER,
 * which hands on what it prints as it comes (to this program's standard error, or to the file descriptor
 * given) and keeps it in a file; without, in one call, and nothing is seen until it ends.
 */
function waitedFor(file, args, workFolder, timeout, progress) {
  if (!progress) {
    const run = spawnSync(file, args, {
      cwd: workFolder,
      encoding: LOG_ENCODING,
      timeout,
      maxBuffer: LOG_LIMIT,
      windowsHide: true,
    });
    return {
      text: `${run.stdout ?? ""}${run.stderr ?? ""}`,
      status: run.status,
      timedOut: run.error?.code === "ETIMEDOUT",
      failed: run.error && run.error.code !== "ETIMEDOUT" ? (run.error.code ?? run.error.message) : null,
    };
  }
  const kept = join(workFolder, "smak-run.txt");
  const run = spawnSync(process.execPath, [RUNNER, String(timeout), kept, file, ...args], {
    cwd: workFolder,
    stdio: ["ignore", "ignore", progress === true ? "inherit" : progress],
    timeout: timeout + RUNNER_SLACK,
    windowsHide: true,
  });
  return {
    text: existsSync(kept) ? readFileSync(kept, LOG_ENCODING) : "",
    status: run.status === TIMED_OUT || run.status === COULD_NOT_RUN ? null : run.status,
    timedOut: run.status === TIMED_OUT || run.error?.code === "ETIMEDOUT",
    failed: run.status === COULD_NOT_RUN ? "it could not be started" : null,
  };
}

/** One program run: what it printed, how it ended, and the sentences its output gives. */
function runTool(tool, file, args, workFolder, timeout, { progress = false, portals = null } = {}) {
  const started = Date.now();
  const run = waitedFor(file, args, workFolder, timeout, progress);
  const { text } = run;
  const seconds = (Date.now() - started) / 1000;
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const bad = lines.filter((line) => BAD_LINE.test(line));
  const leaked = lines.some((line) => LEAK_FOUND.test(line));
  const warnings = lines
    .filter((line) => WARNING_LINE.test(line) && !BAD_LINE.test(line) && !MISSING_TEXTURE.test(line))
    .map((line) => `${tool}: ${line}`);
  const errors = [];
  if (run.timedOut)
    errors.push(
      `${tool} did not finish in ${Math.round(timeout / 1000)} seconds and was STOPPED: nothing was written where the .bsp goes${
        tool === "hlvis" && portals
          ? `. It had ${portals.portals} portals between ${portals.leaves} leaves to work through${portals.seconds >= GUESS_FROM ? `, guessed at about ${portals.seconds} seconds` : ""}`
          : ""
      }. Give it longer (timeout: { ${tool}: milliseconds }), or fast: true for a draft${tool === "hlvis" ? "; or give it less to do: world brushes that only decorate made func_detail, hint brushes" : ""}`,
    );
  else if (run.failed) errors.push(`${tool} could not be run (${run.failed}): ${file}`);
  for (const line of bad) {
    const texture = MISSING_TEXTURE.exec(line);
    if (texture) {
      const said = `the texture ${texture[1]} is in none of the .wad files given: name one that is, or give the .wad that has it`;
      if (!errors.includes(said)) errors.push(said);
    } else if (!LEAK_TALK.test(line)) errors.push(`${tool}: ${line}`);
  }
  if (!run.timedOut && !run.failed && run.status !== 0 && !errors.length && !leaked)
    errors.push(`${tool} ended with code ${run.status}: read its log`);
  return { tool, args, code: run.status, seconds, text, errors, warnings, leaked };
}

/**
 * Compiles a `.map` file into a `.bsp`: hlcsg, hlbsp, hlvis and hlrad in turn. It NEEDS THE COMPILERS
 * (VHLT, an outside program: see `findCompilers`), and says so in `errors` when they are absent.
 *
 *   wads         the .wad files the map's textures are in (paths). They are written into the copy of the map
 *                that is compiled, in place of worldspawn's `wad` key; without them that key is used as it is.
 *                The compilers' own zhlt.wad (ORIGIN, CLIP, NULL...) is added to either by itself
 *   wadinclude   true to put the textures INSIDE the .bsp (all the wads'), or a list of wad names to put in.
 *                Such a .bsp carries the pictures of whoever made the .wad: keep it out of anything shared.
 *                Without it the game needs the .wad files beside its own, as every Half-Life map does
 *   out          where the .bsp goes (beside the map, with its name, unless told)
 *   fast         a quick draft: hlvis and hlrad at their fastest. The light is rougher
 *   fastVis      hlvis's -fast on its own; unless told, what `fast` says. `fast: true, fastVis: false` is a draft
 *                light with the full vis (a fast vis draws 25-50 % more faces than the full one)
 *   vis, light   false leaves hlvis, or hlrad, out (a map with no light is drawn fully bright)
 *   compilers    what `findCompilers` returned, or `{ folder }`; looked for when not given
 *   timeout      milliseconds each program may run before it is stopped, or `{ hlvis: ..., hlrad: ... }` for
 *                some of them. Unless told: 2 minutes for hlcsg and for hlbsp, 15 for hlvis and for hlrad. A
 *                program that is stopped is an error that says so, and no .bsp is written
 *   progress     true: what each program prints is handed on as it comes, to this program's standard error
 *                (or to the file descriptor given), so that a long hlvis is seen to work. Unless told,
 *                nothing is seen until all four have ended
 *   keep         true keeps the folder the work was done in (the .pts of a leak, the .prt, the .log) and
 *                returns it as `work`
 *   threads      how many threads each program uses (all the machine's, unless told; 0 leaves the program to
 *                choose, which for SDHLT on Linux is one)
 *   args         more for each program, `{ hlrad: ["-extra", "-bounce", 8], hlcsg: [...] }`, before the map's name
 *   format       "bsp30", "bsp30ext" or "bsp2" (BSP_FORMATS): `-format` given to all four programs, that layout
 *                written whether or not the map outgrows version 30 (the goldsrc fork; bsp30ext and bsp2 want
 *                engine "xash"). Unless told, the smallest that fits
 *   engine       "xash" or "goldsrc" (ENGINES): `-engine` given to all four programs, as SDHLT's goldsrc fork
 *                needs (hlvis and hlrad refuse a Xash-only file without it). Unless told, no switch is given,
 *                as VHLT and stock SDHLT know none
 *
 * It returns `{ bsp, logs, errors, warnings, facts, leak, portals, work }` (`facts`: what is to be known of a
 * result that is no fault: that a draft's light has no bounces). `bsp` is the path of the result, or null
 * when the compile failed: then nothing was written where the .bsp goes. `logs` is one entry a program run:
 * `{ tool, args, code, seconds, text }`. `errors` and `warnings` are sentences. `portals` is what hlbsp
 * left hlvis to do, `{ leaves, portals, seconds }` (`seconds`: the least a full hlvis is foretold to take;
 * null with no .prt): from 4000 portals a full hlvis is minutes, and a warning says so before it begins;
 * a count that foretells more than hlvis's timeout says that too. `leak` is null, or
 * `{ entity, points, at, nearest }`: the entity the compiler found the leak from, the trail of points from
 * it out to the void, the point where the trail leaves the world, and the map's entity nearest to that.
 * It never throws for what is wrong with the map.
 */
export function compileMap(mapFile, options = {}) {
  const {
    wads,
    wadinclude = false,
    out,
    fast = false,
    fastVis = fast,
    light = true,
    vis = true,
    compilers,
    timeout,
    progress = false,
    keep = false,
    threads = availableParallelism(),
    args: more = {},
    engine,
    format,
  } = options;
  const result = { bsp: null, logs: [], errors: [], warnings: [], facts: [], leak: null, portals: null, work: null }; // prettier-ignore
  if (engine !== undefined && !ENGINES.includes(engine)) {
    result.errors.push(`compileMap: engine is ${ENGINES.join(" or ")}, not ${engine}`);
    return result;
  }
  if (format !== undefined && !BSP_FORMATS.includes(format)) {
    result.errors.push(`compileMap: format is ${BSP_FORMATS.join(", ")}, not ${format}`);
    return result;
  }
  if (format && format !== "bsp30" && engine !== "xash") {
    result.errors.push(`compileMap: format ${format} is read by Xash alone; it wants engine "xash"`);
    return result;
  }
  // what a draft is: said with its result, since its light is not the map's
  if (fast && light)
    result.facts.push(
      "a draft (fast): hlrad bounced no light, so what no lamp or sky sees directly is black, and every room is darker than the full compile makes it; " + (fastVis ? "hlvis took its quick guess, so more is drawn than need be. " : "") + "Judge the light by a full compile",
    );
  const found = compilers?.tools ? compilers : findCompilers(compilers ?? {});
  if (!found.found) {
    result.errors.push(`compileMap: ${found.message}`);
    return result;
  }
  if (typeof mapFile !== "string" || !existsSync(mapFile)) {
    result.errors.push(
      `compileMap: there is no map file ${mapFile}: write the text of writeMap to a .map file first`,
    );
    return result;
  }
  const name = basename(mapFile).replace(/\.map$/i, "");
  const target = resolve(out ?? join(dirname(mapFile), `${name}.bsp`));
  const wadFiles = (wads ?? []).map((wad) => resolve(wad));
  for (const wad of wadFiles)
    if (!existsSync(wad)) result.errors.push(`compileMap: there is no .wad file ${wad}`);
  if (result.errors.length) return result;

  let mapText = readFileSync(mapFile, "utf8");
  // the compilers' own .wad goes with the others, or ORIGIN and CLIP would be textures found nowhere
  const listed = wadFiles.length ? [...wadFiles] : wadsOf(mapText);
  const toolFolder = found.folder ?? dirname(found.tools.hlcsg);
  const toolWad =
    [toolFolder, dirname(toolFolder)]
      .flatMap((folder) => TOOL_WADS.map((name) => join(folder, name)))
      .find((file) => existsSync(file)) ?? join(toolFolder, TOOL_WADS[0]);
  const isToolWad = (wad) => TOOL_WADS.includes(basename(wad).toLowerCase());
  const ownWads = listed.filter((wad) => !isToolWad(wad));
  if (existsSync(toolWad) && !listed.some(isToolWad)) listed.push(toolWad);
  if (listed.length) mapText = withWads(mapText, listed);
  const work = mkdtempSync(join(tmpdir(), "smak-map-"));
  const base = join(work, name);
  writeFileSync(`${base}.map`, mapText);

  const included =
    wadinclude === true ? ownWads.map((wad) => basename(wad).replace(/\.wad$/i, "")) : wadinclude || [];
  // every program told the engine, when one is chosen, and how many threads to use: SDHLT on Linux uses one unless told (its threads.h), which
  // made a hlvis of minutes into one of over ten (research/compiler-features.md)
  const common = [...(engine ? ["-engine", engine] : []), ...(format ? ["-format", format] : []), ...(threads ? ["-threads", String(threads)] : [])];
  const extra = (tool) => [more[tool] ?? []].flat().map(String);
  const steps = [
    { tool: "hlcsg", args: [...common, ...included.flatMap((wad) => ["-wadinclude", wad]), ...extra("hlcsg"), base] },
    { tool: "hlbsp", args: [...common, ...extra("hlbsp"), base] },
    vis && { tool: "hlvis", args: [...common, ...(fastVis ? ["-fast"] : []), ...extra("hlvis"), base] },
    light && { tool: "hlrad", args: [...common, ...(fast ? ["-fast"] : []), ...extra("hlrad"), base] },
  ].filter(Boolean);
  const limitFor = (tool) => (typeof timeout === "number" ? timeout : (timeout?.[tool] ?? TIMEOUTS[tool]));

  for (const step of steps) {
    const run = runTool(step.tool, found.tools[step.tool], step.args, work, limitFor(step.tool), {
      progress,
      portals: result.portals,
    });
    result.logs.push({
      tool: run.tool,
      args: run.args,
      code: run.code,
      seconds: run.seconds,
      text: run.text,
    });
    result.warnings.push(...run.warnings);
    result.errors.push(...run.errors);
    if (run.leaked) {
      result.leak = leakOf(run.text, base, mapText);
      result.errors.push(leakSentence(result.leak));
    }
    // the programs after a failed one would only fail on what it left
    if (result.errors.length) break;
    // what hlbsp left for hlvis: said before hlvis begins, when it is much
    if (step.tool === "hlbsp") {
      result.portals = portalsOf(base);
      const left = result.portals;
      const limit = Math.round(limitFor("hlvis") / 1000);
      if (left && vis && !fastVis && (left.portals >= MANY_PORTALS || left.seconds > limit)) {
        const said = `hlbsp left ${left.portals} portals between ${left.leaves} leaves: a full hlvis is guessed at about ${left.seconds} seconds (a map of ${VIS_MEASURED.portals} portals took ${VIS_MEASURED.seconds}, and the time is taken to grow with the square of the count: a guess from one map)${left.seconds > limit ? `, which is more than the ${limit} it is given: it would be stopped` : ""}. Fewer portals: make func_detail of world brushes that only decorate, keep large rooms apart by bends and doors; or fast: true for a draft`;
        result.warnings.push(said);
        if (progress === true || typeof progress === "number") writeSync(progress === true ? 2 : progress, `smak: ${said}\n`);
      }
    }
  }
  // what the compilers say of the engine's limits (SDHLT prints a chart after each program): the last of each
  result.limits = limitsOf(result.logs.map((log) => log.text).join("\n"));
  for (const [name, { used, most }] of Object.entries(result.limits))
    if (used / most >= NEAR_LIMIT) result.warnings.push(`${name} ${used} of ${most}: near the engine's limit`);
  if (!result.errors.length && !existsSync(`${base}.bsp`))
    result.errors.push("compileMap: the compilers ended well and left no .bsp: read their logs");
  if (!result.errors.length) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(`${base}.bsp`, target);
    result.bsp = target;
  } else if (existsSync(target)) {
    result.warnings.push(`an older ${target} was left as it was: it is not the result of this compile`);
  }
  if (keep) result.work = work;
  else rmSync(work, { recursive: true, force: true });
  return result;
}

/**
 * The portals hlbsp left hlvis, as the end of a line: how many, and what hlvis made of them. What a full
 * hlvis TOOK, when it ran to its end; a guess at what it would take only where the guess is minutes
 * (GUESS_FROM seconds and more), and is said to be one; else nothing more. Null when there were none.
 */
export function portalsLine(result) {
  const { portals } = result;
  if (!portals) return null;
  const vis = (result.logs ?? []).find((log) => log.tool === "hlvis");
  const full = vis && vis.code === 0 && !(vis.args ?? []).includes("-fast");
  const work = full
    ? `: a full one took ${vis.seconds.toFixed(1)} s`
    : portals.seconds >= GUESS_FROM
      ? `: a full one is guessed at about ${portals.seconds} s, from one map measured`
      : "";
  return `${portals.portals} between ${portals.leaves} leaves (hlvis's work${work})`;
}

/**
 * What a compile said, in a few lines for a person or a log: each program with its time and how it ended,
 * then the errors, the leak and the warnings.
 */
export function compileSummary(result) {
  const lines = result.logs.map(
    (log) =>
      `${log.tool}  ${log.seconds.toFixed(1)} s  ${log.code === 0 ? "ended" : log.code === null ? "stopped" : `code ${log.code}`}`,
  );
  const portals = portalsLine(result);
  if (portals) lines.push(`portals: ${portals}`);
  for (const fact of result.facts ?? []) lines.push(fact);
  for (const error of result.errors) lines.push(`error: ${error}`);
  for (const warning of result.warnings) lines.push(`warning: ${warning}`);
  lines.push(result.bsp ? `compiled: ${result.bsp}` : "not compiled");
  return lines.join("\n");
}
