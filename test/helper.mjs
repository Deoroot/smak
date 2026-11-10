// What every area of the self-test shares: the temp folder its files go to, the way a case is run and
// counted, the assertions, and the tiny knife model that the first case builds and the others read, change
// and draw.
// Nothing here is a test framework: a case is a function that throws when something is wrong.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import * as smak from "../src/index.mjs";
import { sword, taper } from "../kits/swordkit.mjs";

/** the folder of the tests, from which the kit's command lines are found */
export const HERE = dirname(fileURLToPath(import.meta.url));

/** `check` with the form judgement left out: the fixtures of other cases are boxes, and a case of theirs is not about form (183-form.mjs is) */
export const checked = (mdl, engine, options = {}) => smak.check(mdl, engine, { kind: false, ...options });

/** a fresh temp folder for every file a case writes; its path is printed in the last line */
export const tmp = mkdtempSync(join(tmpdir(), "smak-"));

// ── running and counting the cases ──

let passed = 0;
const failed = [];
// one file of cases run alone (`node test/46-specs.mjs`) never calls finish: it still ends with exit code 1 and
// the count when a case failed, so a failure is not read as a pass from the exit code
process.on("exit", (code) => {
  if (code === 0 && failed.length) {
    console.log(`\n${passed} passed, ${failed.length} failed: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
});

/** Runs one case and prints `ok    name`, or `FAIL  name` with the reason under it. */
export const test = (name, run) => {
  try {
    run();
    passed++;
    console.log(`ok    ${name}`);
  } catch (e) {
    failed.push(name);
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
};

/**
 * The same for a case that waits (the servers). When it fails, the last line of the run lists it under
 * `shortName` instead of its whole name.
 */
export const testAsync = async (name, shortName, run) => {
  try {
    await run();
    passed++;
    console.log(`ok    ${name}`);
  } catch (e) {
    failed.push(shortName);
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
};

/** Prints the last line of the run and ends the process: exit code 1 when any case failed. */
export const finish = () => {
  const names = failed.length ? `: ${failed.join(", ")}` : "";
  console.log(
    `\n${passed} passed, ${failed.length} failed${names}   (Node ${process.version}; files in ${tmp})`,
  );
  process.exit(failed.length ? 1 : 0);
};

// ── assertions ──

/** Throws `what` unless `condition` holds. Every check of the self-test is one of these. */
export const sure = (condition, what) => {
  if (!condition) throw new Error(what);
};

/**
 * A check of each thing of a list, that fails when the list is empty: a check over nothing passes anything, and a
 * list made empty by a mistake upstream (a field read that the records do not carry) is that mistake. `what` names
 * the list in the sentence; `each` is the check of one, which throws (with `sure`) when it is wrong.
 */
export const sureEach = (list, what, each) => {
  sure(list.length > 0, `${what}: none to check (a check over an empty list passes anything)`);
  list.forEach(each);
};

/** Two numbers no farther apart than `tolerance`; the message names both. */
export const near = (value, expected, tolerance, what) =>
  sure(Math.abs(value - expected) <= tolerance, `${what}: ${value} against ${expected}`);

/** The largest difference between two poses (a pose is one 3x4 matrix a bone). */
export const poseGap = (poseA, poseB) => {
  let gap = 0;
  poseA.forEach((matrix, bone) =>
    matrix.forEach((row, rowIndex) =>
      row.forEach((value, column) => {
        gap = Math.max(gap, Math.abs(value - poseB[bone][rowIndex][column]));
      }),
    ),
  );
  return gap;
};

/** The share of a drawn picture's pixels that are not the background colour. */
export const inked = (image, background = [58, 62, 70]) => {
  let drawn = 0;
  for (let i = 0; i < image.width * image.height; i++)
    if (
      image.rgba[i * 4] !== background[0] ||
      image.rgba[i * 4 + 1] !== background[1] ||
      image.rgba[i * 4 + 2] !== background[2]
    )
      drawn++;
  return drawn / (image.width * image.height);
};

// ── the kit's command lines, run as a person would run them ──

export const SMAK_CLI = join(HERE, "../bin/smak.mjs");

/** Runs `node bin/smak.mjs <args>` and returns what it printed. It throws when the command fails. */
export const runSmak = (...args) => execFileSync(process.execPath, [SMAK_CLI, ...args], { encoding: "utf8" });

/**
 * Runs a command line that is expected to refuse (`cli`: SMAK_CLI or EDITOR_CLI) and gives what came of it:
 * { code, out, err }. It does not throw.
 */
export const runRefused = (cli, ...args) => {
  const run = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  return { code: run.status, out: run.stdout, err: run.stderr };
};

/**
 * What `start` resolves to, with nothing printed meanwhile: a server prints its address when it starts, and
 * that is kept off the test's output. The printing is given back whatever happens, so that a server that
 * fails to start does not take the rest of the run's lines with it.
 */
export const quietly = async (start) => {
  const realLog = console.log;
  console.log = () => {};
  try {
    return await start();
  } finally {
    console.log = realLog;
  }
};

/**
 * For a server at `address`, the function its cases call the API with: `call(name, query, body)` asks
 * /api/<name>?<query>, posting `body` as JSON when there is one, and returns the JSON answer. An answer that
 * holds an `error` is thrown as one.
 */
export const apiCaller = (address) => async (name, query, body) => {
  const response = await fetch(
    `${address}/api/${name}?${new URLSearchParams(query)}`,
    body ? { method: "POST", body: JSON.stringify(body) } : {},
  );
  const answer = await response.json();
  if (answer.error) throw new Error(answer.error);
  return answer;
};

// ── a model from nothing: a knife on a hand bone, with an arm bone before it ──

// the knife's shape and its picture, from the sword kit
const piece = sword({
  seed: 3,
  pommel: {
    profile: [
      [0, 0.3],
      [0.5, 0.6],
      [1, 0.45],
    ],
  },
  grip: {
    profile: [
      [0.9, 0.5],
      [5, 0.55],
    ],
  },
  guard: {
    x: 5.2,
    sections: [
      [-1.2, 0.2, 0.15],
      [0, 0.3, 0.3],
      [1.2, 0.2, 0.15],
    ],
  },
  blade: { x0: 5.5, x1: 16, half: taper(0.9, 0.8), section: "single" },
});

// its picture shrunk to 256 x 256 and cut to a palette
const texture = smak.indexed(smak.shrink(piece.image, 4), "knife.bmp");

const bones = [
  { name: "arm", parent: -1, pos: [0, 0, 10] },
  { name: "hand", parent: 0, pos: [8, 0, 0], rot: [0, 0, 0.3] },
];

// one frame with every bone at rest: six numbers a bone (position x, y, z and rotation x, y, z)
const still = bones.map((bone) => [...bone.pos, ...(bone.rot ?? [0, 0, 0])]);

// twelve frames in which the hand turns up and back down
const wave = Array.from({ length: 12 }, (_, frame) => [
  still[0],
  [8, 0, 0, 0, 0.4 * Math.sin((frame / 11) * Math.PI), 0.3],
]);

/**
 * The knife. `mdl` is the file itself: the first case (in 01-format.mjs) builds it with buildMdl and puts it
 * here, and every later case starts from it. Its animations are "idle" (the still frame) and "wave".
 */
export const knife = { piece, texture, bones, still, wave, mdl: undefined };
