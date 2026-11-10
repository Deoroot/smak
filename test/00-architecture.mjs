// The tree against ARCHITECTURE.md: imports go downward only (a file's folder is its layer, core/ make/ check/ cli/,
// and layers.json says the layer of what stays outside them), every
// module is reached from a command, a kit or a tool, the kit stays within its size, and the kit names no game.
// Run alone (`node test/00-architecture.mjs`) it ends with one line, PASS or FAIL.
//
// Gates arm at the step that makes them true (ARCHITECTURE.md 2.4, 3.3). Armed in P3 (2026-11-10), when the game's
// content left for its own project and the generators for the branch dormant/0.39-generators:
//   - the direction of the imports (since P1);
//   - orphans: a kit module (core, make, check) that no command, kit, MCP server, script, viewer, profile or example
//     reaches is a FAIL: it goes dormant (3.3, rule 1);
//   - game names: a line of the kit (its code, tests and guides) that names a game is a FAIL (2.1); the history
//     (docs/history/, CHANGELOG.md, ARCHITECTURE.md) may name one, and architecture-check.mjs lists them;
//   - the ratchet (since 2026-11-10): layers.json `ratchet.lines` is the most the kit may be, and a commit that adds
//     lines deletes as many, or raises the number in the same commit and says why there (ARCHITECTURE.md 2.3).
// The budget (60 k lines for core + make + check + cli) is still a measure, a NOTE with the count: the kit is over it.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test, sure } from "./helper.mjs";
import { checkArchitecture, KIT, BUDGET } from "./architecture-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// run alone it names every orphan and every hit; inside the selftest only their counts
const alone = /00-architecture\.mjs$/.test(process.argv[1] ?? "");
const armed = { orphans: true, budget: false, names: true };

const result = checkArchitecture(ROOT, { armed });
const failures = [...result.fails];
const notes = [...result.notes];

// ── orphans (failures when armed, among result.fails) ──
if (alone && !armed.orphans) for (const path of result.orphans) notes.push(`NOTE orphan: ${path} (${result.layers.get(path)}) is reached from no command, kit, MCP server, script, viewer, profile or example`); // prettier-ignore
notes.push(`NOTE orphans: ${result.orphans.length}`);

// ── budget ──
const kitLines = KIT.reduce((sum, layer) => sum + result.counts[layer], 0);
notes.push(`NOTE budget: ${kitLines} lines of ${BUDGET} (ratchet ${result.ratchet ?? "none"}: a commit may not go over it)`);
notes.push(`NOTE lines per layer: ${Object.entries(result.counts).map(([layer, lines]) => `${layer} ${lines}`).join(", ")}`); // prettier-ignore
if (armed.budget && kitLines > BUDGET) failures.push(`budget: ${kitLines} lines of ${BUDGET}`);

// ── game names in the kit (failures when armed, among result.fails) ──
if (alone && !armed.names) for (const hit of result.hits) notes.push(`NOTE game name: ${hit.path}:${hit.line}: ${hit.text}`);
notes.push(`NOTE game names: ${result.hits.length} hits`);

for (const line of notes) console.log(line);
test("architecture: every file is in a layer, no import points up, every kit module is reached, no game is named, the exceptions written down still hold", () => {
  sure(!failures.length, `\n${failures.map((line) => `FAIL: ${line}`).join("\n")}`);
});
console.log(`NOTE allowed exceptions: ${result.allowedCount}`);
console.log(failures.length ? `FAIL: ${failures.length} faults in the architecture` : `PASS: ${result.files.length} files in layers, no import points up, no orphan, no game named`); // prettier-ignore
