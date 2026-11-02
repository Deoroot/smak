// Stage 5, floor plans: per building and storey, rooms as rectangles (an L as two) in metres in the lot's frame
// and in cells, walls, doors with their swing, windows, dog-leg stairs, units, named doors; the wells and shafts
// of stage 4's connectors kept clear, with a door at each exit. Writes 05-plans.json. The work is plans.mjs's
// (layout.mjs lays out one zone); this file plugs it into the runner.
import { plansOf, checkPlans } from "./plans.mjs";
import { metreRules } from "./stage3-programs.mjs";

export const stage = {
  n: 5,
  name: "plans",
  reads: ["description", "rulebook", "03-programs.json", "04-network.json"],
  run(ctx) {
    const programs = ctx.inputs["03-programs.json"];
    const doc = plansOf({ buildings: programs.buildings, description: ctx.description.name }, metreRules(ctx), {
      seed: `gen${ctx.params.seed}`,
      network: ctx.inputs["04-network.json"],
    });
    return { tile: programs.tile ?? null, buildings: doc.buildings, stats: doc.stats };
  },
  gate(artifact, ctx) {
    const programs = ctx.inputs["03-programs.json"];
    const r = checkPlans({ buildings: artifact.buildings }, { buildings: programs.buildings }, metreRules(ctx), { network: ctx.inputs["04-network.json"] ?? null }); // prettier-ignore
    const s = r.stats;
    const notes = [
      `rooms per building: median ${s.roomsPerBuilding.median} (${s.roomsPerBuilding.min} to ${s.roomsPerBuilding.max}); median room ${s.medianRoom_m2} m2`,
      `room footprints repeated: ${Math.round(s.roomRepeat.share * 1000) / 10} % (corridors and stairs out), ${Math.round(s.roomRepeat.withCirculation * 1000) / 10} % with corridors; plans distinct ${s.planVariety.distinct} of ${s.planVariety.buildings}`, // prettier-ignore
      ...r.waived.map((w) => `waived: ${w}`),
    ];
    return { failures: r.failures, notes };
  },
};
