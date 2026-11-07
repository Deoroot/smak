// levels/assembly/below-levels.mjs: the sewers on several levels (below.levels). The test spec's two levels (levels/specs/below-levels-01.json)
// plan with no failure, each with 2 loops, a stair of 96 or more, bends mostly at 45 degrees, a hall of each shape; their brushes are all convex
// and made; byzantium-01's cell sewer has no `levels` and no `deep`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, sure, HERE } from "./helper.mjs";
import { readBelow } from "../levels/assembly/below.mjs";
import { planLevels, checkLevels, assembleLevels } from "../levels/assembly/below-levels.mjs";

const spec = JSON.parse(readFileSync(join(HERE, "../levels/specs/below-levels-01.json"), "utf8"));
const deep = planLevels(spec.below, spec, null);
const got = checkLevels(deep, spec.below.rules);

test("below-levels-01: read and planned with no failure, 2 loops on each level, nothing to warn of", () => {
  sure(readBelow({ ...spec, below: spec.below }).length === 0, readBelow(spec).join(" | "));
  sure(deep.failures.length === 0, deep.failures.join(" | "));
  sure(got.failures.length === 0 && got.warnings.length === 0, [...got.failures, ...got.warnings].join(" | "));
  for (const l of got.measures.levels) sure(l.loops >= 2, `${l.id}: ${l.loops} loops`);
  sure(got.measures.levels.length === 2 && got.measures.stairs === 1 && got.measures.ways === 2, JSON.stringify(got.measures));
  sure(got.measures.longest <= 768, `longest run ${got.measures.longest}`);
});

test("below-levels-01: its brushes are made (halls of three shapes, arches, columns, pipes, water, lights of several colours)", () => {
  const out = assembleLevels(deep, { swapOf: () => null, swapped: (g) => g, ladder: () => ({ brushes: [], entities: [], rungs: [] }), lid: () => [] });
  sure(out.failures.length === 0, out.failures.join(" | "));
  for (const k of ["hall-cove", "column", "pipe", "water", "stair-step", "hall-vault", "chimney", "ladder-shaft", "ledge"]) sure(out.counts[k] > 0, `no ${k}`);
  const colours = new Set(out.entities.filter((e) => e.classname === "light").map((e) => e._light.split(" ").slice(0, 3).join(",")));
  sure(colours.size >= 4, `${colours.size} light colours`);
  sure(out.ways.length === 2 && out.holes.length === 2, "the two manholes");
});
