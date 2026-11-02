// The stage runner: the stages in order (levels/gen/registry.mjs: each after the stages whose artifacts it reads,
// ties by number), each reading the artifacts it names, writing its own, and running its gate; the first failing
// gate stops the run with its sentences. `from` resumes: the stages before it in that order are not run but read
// back, and a stale one (made from another description, rulebook or parameters, or from an input that changed after
// it) is refused with a sentence naming why. `until` stops after its stage in that order.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RULES_PATH } from "../lib/architecture-rules.mjs";
import { FILES, FORMAT, jsonHash, readArtifact, staleness, writeArtifact } from "./artifact.mjs";
import { loadStages } from "./registry.mjs";

const SOURCES = new Set(["description", "rulebook"]);

/** The tile a run builds when none is named: the one the description names Core, else c0_r0. */
export const defaultTile = (desc) => Object.entries(desc?.tiles?.names ?? {}).find(([, n]) => /core/i.test(n))?.[0] ?? "c0_r0"; // prettier-ignore

/**
 * Runs the generator. `desc` the description (parsed), `out` the folder, `tile`, `seed`, `until` (the number of the
 * last stage to run, in the runner's order: 4 runs 0, 1, 2, 4; 3 runs those and 3), `from` (the number of the first
 * to run; the stages before it in that order are read back, fresh or refused), `rulebook` (parsed;
 * default levels/rules/architecture.json). Returns { ok, refused?, results: [{ n, name, file, hash, pass,
 * failures, notes, reused }], stopped?: { n, name, failures } }.
 */
export async function runGenerator({ desc, out, tile, seed = 1, until = Infinity, from = 0, rulebook, options = {} } = {}) {
  const all = await loadStages();
  rulebook ??= JSON.parse(readFileSync(RULES_PATH, "utf8"));
  tile ??= defaultTile(desc);
  const params = { tile, seed };
  const sources = { description: jsonHash(desc), rulebook: jsonHash(rulebook) };
  const made = new Map(); // file -> { artifact, hash }
  const results = [];
  const read = (file) => {
    if (made.has(file)) return made.get(file);
    const why = staleness(out, file, sources, params);
    if (why) return { refused: why };
    const got = readArtifact(out, file);
    made.set(file, got);
    return got;
  };
  // positions in the run's order: `until` and `from` name stages; a number no stage has falls between them
  const lastAt = all.some((s) => s.n === until) ? all.findIndex((s) => s.n === until) : all.reduce((k, s, i) => (s.n <= until ? i : k), -1); // prettier-ignore
  const firstAt = all.some((s) => s.n === from) ? all.findIndex((s) => s.n === from) : Math.max(0, all.findIndex((s) => s.n >= from)); // prettier-ignore
  for (const [i, st] of all.entries()) {
    if (i > lastAt) break;
    if (i < firstAt) {
      const got = read(st.file);
      if (got.refused) return { ok: false, refused: `stage ${st.n} ${st.name}: cannot resume from ${st.file}: ${got.refused}`, results }; // prettier-ignore
      results.push({ n: st.n, name: st.name, file: st.file, hash: got.hash, pass: true, failures: [], notes: got.artifact.gate?.notes ?? [], reused: true }); // prettier-ignore
      continue;
    }
    const inputs = {};
    const hashes = {};
    for (const r of st.reads) {
      if (SOURCES.has(r)) {
        hashes[r] = sources[r];
        continue;
      }
      const got = read(r);
      if (got.refused) return { ok: false, refused: `stage ${st.n} ${st.name} refuses to run: ${got.refused}`, results };
      inputs[r] = got.artifact;
      hashes[r] = got.hash;
    }
    // options: a stage's own switches (stage 10's kit WAD), recorded in its body, not in params (the stages before
    // it are not made stale by them)
    const ctx = { description: desc, rulebook, params, inputs, sources, options };
    const body = st.run(ctx);
    const artifact = { format: FORMAT, stage: st.name, n: st.n, inputs: hashes, params, ...body };
    const verdict = st.gate(artifact, ctx);
    artifact.gate = { pass: verdict.failures.length === 0, failures: verdict.failures, notes: verdict.notes ?? [] };
    const hash = writeArtifact(out, st.file, artifact);
    for (const [name, text] of Object.entries(body?.[FILES] ?? {})) writeFileSync(join(out, name), text);
    made.set(st.file, { artifact, hash });
    results.push({ n: st.n, name: st.name, file: st.file, hash, pass: artifact.gate.pass, failures: verdict.failures, notes: artifact.gate.notes }); // prettier-ignore
    if (!artifact.gate.pass) return { ok: false, results, stopped: { n: st.n, name: st.name, failures: verdict.failures } }; // prettier-ignore
  }
  return { ok: true, results };
}

/** Runs one stage's gate again on a (possibly changed) artifact, with the inputs it was made from. */
export async function regate(name, artifact, { desc, rulebook, inputs = {}, params } = {}) {
  const all = await loadStages();
  const st = all.find((s) => s.name === name || String(s.n) === String(name));
  rulebook ??= JSON.parse(readFileSync(RULES_PATH, "utf8"));
  return st.gate(artifact, { description: desc, rulebook, params: params ?? artifact.params, inputs, sources: {}, options: artifact.options ?? {} }); // prettier-ignore
}
