// Stage 3, building programs: per enterable building of the tile, its units (homes by class, a business, the MSR's
// or the insurgents' function), every room with its kind, storey, target and minimum area, needs and adjacency,
// the circulation it asks for, a court or terrace where the footprint is far larger than the program, the floor
// kept for connectors stopping in it, and its named doors; tied to stage 4's network (its hallways' ends, lifts and
// checkpoint rooms at the building), so it runs after stage 4 (the runner orders stages by what they read; stage 4
// reads nothing of 3). Writes 03-programs.json. The work is programs.mjs's; this file plugs it into the runner.
// Seeded by params.seed and each building's id.
import { tighten } from "../lib/architecture-rules.mjs";
import { programsOf, checkPrograms, TYPICAL, GROW_MAX, COURT_MIN_SHARE, WALL } from "./programs.mjs";

/** The rulebook in metres, tightened by the description's `architecture` (never loosened). */
export function metreRules(ctx) {
  const { rules, errors } = tighten(ctx.rulebook, ctx.description.architecture ?? {});
  if (errors.length) throw new Error(`stage 3: the description's architecture loosens the rulebook: ${errors.join("; ")}`);
  return rules;
}

export const stage = {
  n: 3,
  name: "programs",
  reads: ["description", "rulebook", "02-lots.json", "04-network.json"],
  run(ctx) {
    const lots = ctx.inputs["02-lots.json"];
    const doc = programsOf(ctx.description, lots, metreRules(ctx), { seed: `gen${ctx.params.seed}`, network: ctx.inputs["04-network.json"] ?? null }); // prettier-ignore
    return {
      tile: lots.tile ?? null,
      scope: doc.scope,
      rules: { TYPICAL, GROW_MAX, COURT_MIN_SHARE, WALL_m: WALL, note: "typical area = rulebook minimum x TYPICAL; a storey's rooms grow at most GROW_MAX past typical before fill rooms, a court or a terrace" }, // prettier-ignore
      buildings: doc.buildings,
    };
  },
  gate(artifact, ctx) {
    const r = checkPrograms({ buildings: artifact.buildings, scope: artifact.scope }, ctx.description, metreRules(ctx));
    const notes = [];
    if (artifact.scope === "tile") notes.push("homes per layer and class are held city-wide (housing.target): this tile's programs hold a part of them");
    for (const b of artifact.buildings) for (const d of b.decisions) if (d.rule === "court" || d.rule === "second stair") notes.push(`${b.id}: ${d.what}`);
    return { failures: r.failures, notes };
  },
};
