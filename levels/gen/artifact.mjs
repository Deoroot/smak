// The map generator's artifacts: one JSON file a stage, `NN-<stage>.json` in the output folder, each carrying
// `{ format, stage, n, inputs: { name: sha256 }, params, ...its body, gate: { pass, failures, notes } }`. An
// artifact is fresh when every input it names still hashes to what it recorded (a source file, or an artifact
// that is itself fresh) and the run's parameters are the same; a stage refuses to read one that is not.
// levels/gen/ARTIFACTS.md documents each artifact's body.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../lib/plan-picture.mjs";

export const FORMAT = "smak-gen/1";
/**
 * A stage's body may carry files written beside its artifact (stage 10's .map): `body[FILES] = { name: text }`,
 * a symbol key, so the artifact's JSON never holds them; the body's `files: [{ file, sha256 }]` records each, and
 * an artifact whose file changed or went missing after it was made is stale.
 */
export const FILES = Symbol.for("smak-gen.files");
export const sha256 = (data) => createHash("sha256").update(data).digest("hex");
/** A JSON value's hash, its formatting and key order aside (the description's and the rulebook's). */
export const jsonHash = (value) => sha256(canonicalJson(value));
/** The bytes an artifact is written as: one space indent, keys in the order the stage built them. */
export const artifactText = (obj) => `${JSON.stringify(obj, null, 1)}\n`;

export const fileOf = (n, name) => `${String(n).padStart(2, "0")}-${name}.json`;

export function writeArtifact(dir, file, obj) {
  mkdirSync(dir, { recursive: true });
  const text = artifactText(obj);
  writeFileSync(join(dir, file), text);
  return sha256(text);
}

/** An artifact read back with its hash (of its bytes), or null when there is none. */
export function readArtifact(dir, file) {
  const path = join(dir, file);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  return { artifact: JSON.parse(text), hash: sha256(text), file };
}

const sameParams = (a, b) => canonicalJson(a ?? {}) === canonicalJson(b ?? {});

/**
 * Whether the artifact `file` in `dir` is fresh for these sources ({ name: sha256 }) and parameters: null when it
 * is, else the sentence that says why not (missing, made from another description, an input changed after it,
 * other parameters, its gate failed). Walks its inputs down to the sources.
 */
export function staleness(dir, file, sources, params, seen = new Map()) {
  if (seen.has(file)) return seen.get(file);
  const got = readArtifact(dir, file);
  let why = null;
  if (!got) why = `${file} is missing from ${dir}`;
  else {
    const a = got.artifact;
    if (a.format !== FORMAT) why = `${file} is not a generator artifact (format ${JSON.stringify(a.format)}, wanted "${FORMAT}")`; // prettier-ignore
    else if (!sameParams(a.params, params)) why = `${file} was made with ${canonicalJson(a.params)}, this run is ${canonicalJson(params)}`; // prettier-ignore
    else if (!a.gate?.pass) why = `${file} did not pass its gate (${a.gate?.failures?.[0] ?? "no gate recorded"})`;
    else
      for (const f of Array.isArray(a.files) ? a.files : []) {
        const p = join(dir, f.file);
        if (!existsSync(p)) why = `${file} is stale: its file ${f.file} is missing`;
        else if (sha256(readFileSync(p)) !== f.sha256) why = `${file} is stale: its file ${f.file} changed after it was made`;
        if (why) break;
      }
    if (!why && got && a.format === FORMAT && sameParams(a.params, params) && a.gate?.pass)
      for (const [name, hash] of Object.entries(a.inputs ?? {})) {
        if (name in sources) {
          if (sources[name] !== hash) why = `${file} is stale: it was made from ${name} ${hash.slice(0, 12)}, ${name} is now ${sources[name].slice(0, 12)}`; // prettier-ignore
        } else {
          const up = readArtifact(dir, name);
          if (!up) why = `${file} is stale: its input ${name} is missing`;
          else if (up.hash !== hash) why = `${file} is stale: its input ${name} changed after it was made (sha256 ${hash.slice(0, 12)}, now ${up.hash.slice(0, 12)})`; // prettier-ignore
          else why = staleness(dir, name, sources, params, seen);
        }
        if (why) break;
      }
  }
  seen.set(file, why);
  return why;
}
