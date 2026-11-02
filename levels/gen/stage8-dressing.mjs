// Stage 8, dressing: furniture in every room and props in the streets, each placed by a rule and held clear of
// every keep-clear volume, every opening and the walk (levels/gen/dressing.mjs's header lists the rules). Writes
// 08-dressing.json. Reads 06's artifact (its lamps) and 07's (its switches) when those
// stages exist; without them it reserves placeholder spots for them and says so in its notes.
import { existsSync, readdirSync } from "node:fs";
import { HERE } from "./common.mjs";
import { metreRules } from "./stage3-programs.mjs";
import { dressingOf, checkDressing, CATALOGUE, FURNISH, CLEAR_KINDS, DENSITY, WEAR_JUNK, STREET_CAP, WEAR_CAP, MARKET_CAP, KERB, KERB_STRIP, EDGE_STRIP, MOUTH, PORTAL_DEPTH, LAMP_SPACING } from "./dressing.mjs"; // prettier-ignore

// stages 6 and 7 are read only when their stage files are there (they are built apart)
// (a stage's artifact is NN-<name>.json, its file stageN-<name>.mjs)
const artifactOf = (n) => {
  const f = existsSync(HERE) ? readdirSync(HERE).find((x) => new RegExp(`^stage${n}-[a-z0-9-]+\\.mjs$`).test(x)) : null;
  return f ? `0${n}-${f.slice(`stage${n}-`.length, -4)}.json` : null;
};
const OPTIONAL = [artifactOf(6), artifactOf(7)].filter(Boolean);

export const stage = {
  n: 8,
  name: "dressing",
  reads: ["description", "rulebook", "01-site.json", "02-lots.json", "03-programs.json", "04-network.json", "05-plans.json", ...OPTIONAL],
  run(ctx) {
    const rules = metreRules(ctx);
    const body = dressingOf({ desc: ctx.description, rules, inputs: ctx.inputs, seed: `gen${ctx.params.seed}` });
    return {
      tile: ctx.inputs["05-plans.json"].tile ?? null,
      rules: {
        catalogue: CATALOGUE,
        furnish: FURNISH,
        keptClear: CLEAR_KINDS,
        density: DENSITY,
        wearJunk: WEAR_JUNK,
        allowance: rules.placement?.dressing?.maxBrushesBy ?? null,
        street: { KERB, KERB_STRIP, EDGE_STRIP, MOUTH, PORTAL_DEPTH, LAMP_SPACING, STREET_CAP, WEAR_CAP, MARKET_CAP },
        note: "sizes in metres on the plan grid (8 units); a prop's `use` is the strip it is used from (any listed side will do); `cls` its class in the rulebook's placement.freestanding.kinds; `build` brush (greybox func_detail) or model (an entity)",
      },
      ...body,
    };
  },
  gate(artifact, ctx) {
    return checkDressing(artifact, { desc: ctx.description, rules: metreRules(ctx), inputs: ctx.inputs });
  },
};
