// The tree against ARCHITECTURE.md: imports go downward only (layers.json says which layer each file is in), every
// module is reached from a command, a kit or a tool, the kit stays within its size, and the kit names no game.
// Run alone (`node test/00-architecture.mjs`) it ends with one line, PASS or FAIL.
//
// Gates arm at the step that makes them true (ARCHITECTURE.md 2.4, 3.3). Today, in P1, only the direction of the
// imports can fail: the other three are measures (NOTE lines) with their counts.
//   - orphans: FAIL from P3, when what the H9 project needs is out and a module nothing imports goes dormant;
//   - budget: FAIL from P3, when the folders are the layers and the kit is pruned to its 60 k lines;
//   - game names: FAIL from P3, when the H9 content has left for its own project.
// To arm one, change its `armed` flag below to true in the commit that makes it true.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test, sure } from "./helper.mjs";
import { checkArchitecture, KIT, BUDGET } from "./architecture-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// run alone it names every orphan and every hit; inside the selftest only their counts
const alone = /00-architecture\.mjs$/.test(process.argv[1] ?? "");
const armed = { orphans: false, budget: false, names: false };

const result = checkArchitecture(ROOT);
const failures = [...result.fails];
const notes = [...result.notes];

// ── orphans ──
if (alone) for (const path of result.orphans) notes.push(`NOTE orphan: ${path} (${result.layers.get(path)}) is imported from no command, kit, example or tool`);
notes.push(`NOTE orphans: ${result.orphans.length}`);
if (armed.orphans && result.orphans.length) failures.push(`${result.orphans.length} modules no root reaches`);

// ── budget ──
const kitLines = KIT.reduce((sum, layer) => sum + result.counts[layer], 0);
notes.push(`NOTE budget: ${kitLines} lines of ${BUDGET}`);
notes.push(`NOTE lines per layer: ${Object.entries(result.counts).map(([layer, lines]) => `${layer} ${lines}`).join(", ")}`); // prettier-ignore
if (armed.budget && kitLines > BUDGET) failures.push(`budget: ${kitLines} lines of ${BUDGET}`);

// ── game names in the kit layers ──
if (alone) for (const hit of result.hits) notes.push(`NOTE game name: ${hit.path}:${hit.line}: ${hit.text}`);
const byFolder = {};
for (const hit of result.hits) {
  const folder = hit.path.split("/").slice(0, hit.path.startsWith("src/maps") || hit.path.startsWith("levels/") ? 2 : 1).join("/");
  byFolder[folder] = (byFolder[folder] ?? 0) + 1;
}
notes.push(`NOTE game names: ${result.hits.length} hits (${Object.entries(byFolder).map(([folder, n]) => `${folder} ${n}`).join(", ")})`); // prettier-ignore
if (armed.names && result.hits.length) failures.push(`${result.hits.length} game names in the kit`);

for (const line of notes) console.log(line);
test("architecture: every file is in a layer, no import points up, the exceptions written down still hold", () => {
  sure(!failures.length, `\n${failures.map((line) => `FAIL: ${line}`).join("\n")}`);
});
console.log(`NOTE allowed exceptions: ${result.allowedCount}`);
console.log(failures.length ? `FAIL: ${failures.length} faults in the architecture` : `PASS: ${result.files.length} files in layers, no import points up`); // prettier-ignore
