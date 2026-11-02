// Blender, where the machine has it: the one thing in the kit that is not plain JavaScript, and nothing else
// needs it. It is found (the SMAK_BLENDER environment variable, the usual places it is installed, the PATH), run
// headless on a job: a script given a job as JSON, its result read back as JSON and files (src/blender_job.py is
// the scripts' side). Two jobs come with the kit: a bake (a detailed copy's colours, occlusion and normals laid
// onto a plain one's picture, selected to active), and what Blender sees in a .glb or .fbx.
//
//   findBlender({ blender })                      the program's path, or null
//   blenderVersion({ blender })                   [major, minor, patch], asked once a program
//   runBlender(script, args, { blender, timeout })  headless, the script's lines that begin with `[smak]`
//   runBlenderJob(script, job, { blender, timeout, minVersion, out })  → { result, files, out, version, lines, log }
//   readFloatMap(file)                            a raw float32 RGBA picture and its .json: rows from the top
//   bakeMaps(pairs, { width, height, outDir, maps, ao, cage, distance, samples, occluders, blender })
//   blenderInspect(file, options)                 armatures, bones, actions (frames, fps), meshes
//
// Without Blender, findBlender gives null and the rest throw, saying where it was looked for.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, delimiter, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The environment variable that names Blender's program. */
export const BLENDER_VARIABLE = "SMAK_BLENDER";
/** Where Blender is installed on each system, newest version first where a folder holds several. */
const PLACES = {
  win32: ["C:/Program Files/Blender Foundation", "C:/Program Files (x86)/Blender Foundation"],
  darwin: ["/Applications/Blender.app/Contents/MacOS/Blender"],
  linux: ["/usr/bin/blender", "/usr/local/bin/blender", "/snap/bin/blender", "/opt/blender/blender"],
};
const PROGRAM = process.platform === "win32" ? "blender.exe" : "blender";

/** The versions in a folder such as "Blender Foundation", newest first: "Blender 5.2" before "Blender 4.10". */
const versionsIn = (folder) => {
  if (!existsSync(folder)) return [];
  const number = (name) => (name.match(/\d+/g) ?? []).map(Number);
  return readdirSync(folder)
    .filter((name) => /blender/i.test(name) && existsSync(join(folder, name, PROGRAM)))
    .sort((a, b) => {
      const x = number(a);
      const y = number(b);
      for (let i = 0; i < Math.max(x.length, y.length); i++)
        if ((y[i] ?? 0) !== (x[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
      return 0;
    })
    .map((name) => join(folder, name, PROGRAM));
};

/** Every place Blender is looked for, in order. */
export function blenderPlaces({ blender } = {}) {
  const out = [];
  if (blender) out.push(blender);
  if (process.env[BLENDER_VARIABLE]) out.push(process.env[BLENDER_VARIABLE]);
  for (const place of PLACES[process.platform] ?? []) {
    const inside = versionsIn(place);
    out.push(...(inside.length ? inside : [place]));
  }
  for (const folder of (process.env.PATH ?? "").split(delimiter)) if (folder) out.push(join(folder, PROGRAM));
  return out;
}

/** Blender's program: the one given, SMAK_BLENDER, the usual places, then the PATH; null when none is there. */
export function findBlender(options = {}) {
  return blenderPlaces(options).find((p) => existsSync(p) && !/Blender Foundation$/.test(p)) ?? null;
}

const needBlender = (options) => {
  const found = findBlender(options);
  if (!found)
    throw new Error(
      `Blender was not found: set ${BLENDER_VARIABLE} to its program (looked in ${blenderPlaces(options).slice(0, 6).join(", ")} and the PATH)`,
    );
  return found;
};

/**
 * Runs a Python script in Blender, headless and with its factory settings: `blender -b --factory-startup
 * --python script -- ...args`. Returns { lines (those the script printed beginning with "[smak]", without it),
 * log (all it printed) }. Throws with the end of the log when Blender fails.
 */
export function runBlender(script, args = [], { blender, timeout = 30 * 60 * 1000 } = {}) {
  const program = needBlender({ blender });
  const path = script instanceof URL ? fileURLToPath(script) : script;
  let log;
  try {
    log = execFileSync(program, ["-b", "--factory-startup", "--python", path, "--", ...args.map(String)], {
      encoding: "utf8",
      maxBuffer: 1 << 28,
      timeout,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const said = `${e.stdout ?? ""}${e.stderr ?? ""}`.split("\n").slice(-12).join("\n");
    throw new Error(`Blender failed on ${path}: ${e.message.split("\n")[0]}\n${said}`);
  }
  // Blender says a script's own error on its output and still ends well: that is a failure here
  if (/Traceback \(most recent call last\)/.test(log)) {
    const at = log.indexOf("Traceback");
    throw new Error(`Blender's script ${path} failed:\n${log.slice(at, at + 2000)}`);
  }
  const lines = log
    .split(/\r?\n/)
    .filter((l) => l.startsWith("[smak]"))
    .map((l) => l.slice(7));
  return { lines, log };
}

/** The versions read, a program's path to its [major, minor, patch]: `blender --version` is asked once a program. */
const VERSIONS = new Map();

/** "4.2", "4.2.1", 4.2 or [4, 2] as [major, minor, patch]. */
const versionOf = (v) => {
  const parts = Array.isArray(v) ? v.map(Number) : String(v).split(".").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) throw new Error(`not a Blender version: ${v}`);
  return [0, 1, 2].map((i) => parts[i] ?? 0);
};

/** a before b: negative, the same: 0, after: positive */
const compareVersions = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * Blender's version, [major, minor, patch], as `blender --version` says it; asked once a program, then kept.
 * Throws when Blender is not found or does not answer with a version.
 */
export function blenderVersion({ blender } = {}) {
  const program = needBlender({ blender });
  if (!VERSIONS.has(program)) {
    let said;
    try {
      said = execFileSync(program, ["--factory-startup", "--version"], {
        encoding: "utf8",
        timeout: 60 * 1000,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      throw new Error(`Blender at ${program} did not say its version: ${e.message.split("\n")[0]}`);
    }
    const m = said.match(/Blender\s+(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!m) throw new Error(`Blender at ${program} did not say its version: ${said.slice(0, 200)}`);
    VERSIONS.set(program, [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)]);
  }
  return [...VERSIONS.get(program)];
}

/** The Python helper job scripts import (`from blender_job import read_job, write_result, fail, out_path, say`). */
export const JOB_HELPER = new URL("./blender_job.py", import.meta.url);

/** Every file under a folder, its path from the folder with forward slashes. */
const filesUnder = (folder, base = folder) =>
  readdirSync(folder, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? filesUnder(join(folder, e.name), base)
      : [relative(base, join(folder, e.name)).split(sep).join("/")],
  );

/**
 * A job for Blender: `job` written as JSON, Blender run headless on `script` (factory settings, with
 * `src/blender_job.py` importable as `blender_job`), and the result the script wrote read back.
 *   script      a Python file (a path or a file: URL); it calls read_job(), does its work, write_result(dict),
 *               or fail(message)
 *   job         anything JSON can hold
 *   out         the folder the script writes result.json and its files to (a new temp folder when not given)
 *   minVersion  the oldest Blender the job runs on ("4.2", [4, 2]): an older one is refused before it is run
 *   blender, timeout   the program (see findBlender), and how long it may take (30 minutes)
 * Returns { result, files, out, version, lines, log }: `files` the paths under `out` the script wrote (not
 * result.json), `version` Blender's [major, minor, patch], `lines` what it printed after "[smak] ". A script's
 * fail(), or an exception it did not catch, is thrown as an Error with its message.
 */
export function runBlenderJob(script, job, { blender, timeout = 30 * 60 * 1000, minVersion, out } = {}) {
  const program = needBlender({ blender });
  const version = blenderVersion({ blender: program });
  if (minVersion != null && compareVersions(version, versionOf(minVersion)) < 0)
    throw new Error(
      `Blender ${version.join(".")} at ${program} is older than ${versionOf(minVersion).join(".")}, which this job needs: set ${BLENDER_VARIABLE} to a newer one`,
    );
  const path = script instanceof URL ? fileURLToPath(script) : script;
  const jobDir = mkdtempSync(join(tmpdir(), "smak-blender-"));
  const outDir = out ?? join(jobDir, "out");
  mkdirSync(outDir, { recursive: true });
  const resultFile = join(outDir, "result.json");
  rmSync(resultFile, { force: true });
  const before = new Set(filesUnder(outDir));
  const jobFile = join(jobDir, "job.json");
  writeFileSync(jobFile, JSON.stringify(job ?? null));
  const helperDir = dirname(fileURLToPath(JOB_HELPER));
  const prelude = `import sys; sys.path.insert(0, ${JSON.stringify(helperDir)}); import blender_job`;
  const args = ["-b", "--factory-startup", "--python-exit-code", "1", "--python-expr", prelude, "--python", path];
  let log;
  let failure = null;
  try {
    log = execFileSync(program, [...args, "--", jobFile, outDir], {
      encoding: "utf8",
      maxBuffer: 1 << 28,
      timeout,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    log = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    failure = e;
  }
  const written = existsSync(resultFile) ? JSON.parse(readFileSync(resultFile, "utf8")) : null;
  if (out != null) rmSync(jobDir, { recursive: true, force: true });
  if (written && written.ok === false) {
    const error = new Error(`Blender's job ${path} failed: ${written.error}`);
    error.traceback = written.traceback ?? null;
    error.log = log;
    throw error;
  }
  if (failure || /Traceback \(most recent call last\)/.test(log)) {
    const tail = log.split("\n").slice(-12).join("\n");
    throw new Error(`Blender failed on ${path}: ${failure ? failure.message.split("\n")[0] : "a traceback"}\n${tail}`);
  }
  const lines = log
    .split(/\r?\n/)
    .filter((l) => l.startsWith("[smak]"))
    .map((l) => l.slice(7));
  const files = filesUnder(outDir).filter((f) => f !== "result.json" && !before.has(f));
  return { result: written ? written.result : null, files, out: outDir, version, lines, log };
}

/**
 * A picture Blender wrote as raw float32 RGBA with a .json of its size beside it: { width, height, data }, data
 * four floats a pixel, rows from the top (Blender keeps them from the bottom).
 */
export function readFloatMap(file) {
  const { width, height } = JSON.parse(readFileSync(file + ".json", "utf8"));
  const buf = readFileSync(file);
  if (buf.length !== width * height * 16)
    throw new Error(`readFloatMap: ${file} is not ${width} by ${height} RGBA floats`);
  const raw = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++)
    data.set(raw.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
  return { width, height, data };
}

/** The bake's script, which comes with the kit. */
export const BAKE_SCRIPT = new URL("./blender-bake.py", import.meta.url);

/**
 * A detailed copy baked onto a plain one, selected to active, in Blender.
 *   pairs     [{ low: { tris, uv }, high: { tris, colours } }]: `tris` triangles of points (or of { p }) in one
 *             space for all; `uv` each low triangle's corners on the picture, in pixels; `colours` one [r, g, b]
 *             (0 to 1) a high triangle (grey when not given)
 *   width, height   the picture's size
 *   outDir    where the maps are written (and input.json)
 *   maps      which: "albedo" (the high pieces' colours), "ao" (their occlusion, `ao` units out: 1), "normal"
 *             (their normals in that space, 0 to 1). All three unless told
 *   cage, distance   how far out the rays start (0.1) and how far they look (0.5), units
 *   samples   Cycles' samples a pixel (16); `occluders`: triangles that only cast shadow
 * Returns { albedo, ao, normal } as `readFloatMap` gives them (rows from the top), and `lines`, what it said.
 */
export function bakeMaps(
  pairs,
  {
    width,
    height,
    outDir,
    maps = ["albedo", "ao", "normal"],
    ao = 1,
    cage = 0.1,
    distance = 0.5,
    samples = 16,
    margin = 2,
    occluders = [],
    blender,
  } = {},
) {
  if (!width || !height || !outDir) throw new Error("bakeMaps: give width, height and outDir");
  const points = (tris) => tris.map((t) => t.map((c) => c.p ?? c));
  const input = {
    width,
    height,
    maps,
    ao,
    cage,
    distance,
    samples,
    margin,
    pairs: pairs.map(({ low, high }) => ({
      low: { tris: points(low.tris), uv: low.uv },
      high: { tris: points(high.tris), colours: high.colours ?? null },
    })),
    occluders: points(occluders),
  };
  const { lines } = runBlenderJob(BAKE_SCRIPT, input, { blender, out: outDir });
  const out = { lines };
  for (const name of maps) out[name] = readFloatMap(join(outDir, name));
  return out;
}

/** The inspection's script, which comes with the kit. */
export const INSPECT_SCRIPT = new URL("./blender-inspect.py", import.meta.url);

/**
 * What Blender sees in a .glb, .gltf or .fbx (src/blender-inspect.py), as a job: { fps, armatures: [{ name,
 * bones: [{ name, parent }], actions }], actions: [{ name, frames: [first, last], seconds, fps, bones }], meshes:
 * [{ name, vertices, triangles, armature }], version }. Options as runBlenderJob takes them.
 */
export function blenderInspect(file, options = {}) {
  const { result, version } = runBlenderJob(INSPECT_SCRIPT, { file: resolve(file) }, options);
  return { ...result, version };
}
