// The stage registry. A stage is a plain object
//   { n, name, reads: [artifact file names or "description" | "rulebook"], run(ctx) -> body, gate(artifact, ctx) -> { failures, notes } }
// `run` is pure: the same ctx gives the same body (seeded by ctx.params.seed and the things' names, no clock).
// `gate` reads only the artifact and ctx, so a test can break a copy of an artifact and call it again.
// A stage module is any levels/gen/stage*.mjs exporting `stage` (or a default); the runner imports them all, so a
// later stage (3, 5, 6, 7, 8 ...) plugs in by adding its file, with no edit here.
// The order the runner takes them in: each stage after every stage whose artifact it reads, ties by number (so 3
// programs, which reads 04-network.json, runs after 4; 4 reads nothing of 3 or 5). A cycle is refused by name.
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fileOf } from "./artifact.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGES = new Map();

export function registerStage(def) {
  for (const k of ["n", "name", "run", "gate"]) if (def?.[k] === undefined) throw new Error(`registerStage: a stage wants \`${k}\` (${JSON.stringify(def?.name ?? def?.n)})`); // prettier-ignore
  const old = [...STAGES.values()].find((s) => s.n === def.n && s.name !== def.name);
  if (old) throw new Error(`registerStage: stage ${def.n} is already ${old.name}, not ${def.name}`);
  STAGES.set(def.name, { reads: [], ...def, file: def.file ?? fileOf(def.n, def.name) });
  return STAGES.get(def.name);
}
export const stages = () => ordered([...STAGES.values()].sort((a, b) => a.n - b.n));

/** Stages sorted so each comes after the stages whose artifacts it reads (ties by number); throws on a cycle. */
export function ordered(list) {
  const maker = new Map(list.map((s) => [s.file, s]));
  const out = [];
  const placed = new Set();
  const left = [...list];
  while (left.length) {
    const i = left.findIndex((s) => s.reads.every((r) => !maker.has(r) || placed.has(r) || maker.get(r) === s));
    if (i < 0) throw new Error(`stages: ${left.map((s) => `${s.n} ${s.name}`).join(", ")} read each other's artifacts in a cycle`); // prettier-ignore
    const [s] = left.splice(i, 1);
    out.push(s);
    placed.add(s.file);
  }
  return out;
}
export const stageNamed = (name) => STAGES.get(name) ?? stages().find((s) => String(s.n) === String(name));

let loaded = null;
/** Imports every levels/gen/stage*.mjs once and registers what each exports. */
export async function loadStages() {
  if (!loaded)
    loaded = (async () => {
      const files = readdirSync(HERE).filter((f) => /^stage.*\.mjs$/.test(f)).sort();
      for (const f of files) {
        const mod = await import(pathToFileURL(join(HERE, f)).href);
        const def = mod.stage ?? mod.default;
        if (def && !STAGES.has(def.name)) registerStage(def);
      }
      return stages();
    })();
  return loaded;
}
