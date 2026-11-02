// Stage 9, forms: the mega-structure's forms over the plans and the dressing (levels/notes-megastructure.md, the
// vocabulary F1-F27), so the city reads as part of one structure and not as boxes on a grid. Writes 09-forms.json.
// Between the dressing (8) and the geometry (the adapter's stage, 10): every form is placed as convex parts in
// cells, held clear of what the stages before placed and of every keep-clear volume and walk, counted into the
// tile's brush and entity budget; the adapter only builds them.
//
// The forms come in families, one module each (levels/gen/forms-<family>.mjs exporting `family`, the contract in
// levels/gen/ARTIFACTS.md); this file loads them all in their order, lets each place its forms seeing those placed
// before, and gates them with the common rules (forms.mjs) and each family's own checks. A family plugs in by its
// file alone.
import { metreRules } from "./stage3-programs.mjs";
import { loadFamilies, formsContext, commonChecks, measuresOf, formRules } from "./forms.mjs";

const FAMILIES = await loadFamilies();

export const stage = {
  n: 9,
  name: "forms",
  reads: ["description", "rulebook", "01-site.json", "02-lots.json", "04-network.json", "05-plans.json", "06-palette.json", "07-wiring.json", "08-dressing.json"], // prettier-ignore
  run(ctx) {
    const rules = metreRules(ctx);
    const fx = formsContext(ctx, rules);
    const forms = [];
    const notes = [];
    const failures = [];
    const families = [];
    const world = {};
    for (const fam of FAMILIES) {
      const got = fam.place({ ...fx, placed: [...forms] });
      const mine = (got.forms ?? []).map((f) => ({ ...f, family: fam.id }));
      forms.push(...mine);
      notes.push(...(got.notes ?? []).map((n) => `${fam.id}: ${n}`));
      failures.push(...(got.failures ?? []).map((n) => `${fam.id}: ${n}`));
      // what a family hands the geometry for the whole map (worldspawn's keys, the edge and its backdrop): one owner a key
      for (const [k, v] of Object.entries(got.world ?? {})) {
        if (k in world) failures.push(`${fam.id}: world.${k} is given by an earlier family too`);
        else world[k] = v;
      }
      families.push({ id: fam.id, file: `levels/gen/${fam.file}`, order: fam.order, forms: fam.forms, placed: mine.length, brushes: mine.reduce((s, f) => s + f.brushes + f.rock, 0) }); // prettier-ignore
    }
    return {
      tile: ctx.inputs["05-plans.json"].tile ?? ctx.inputs["01-site.json"].tile?.id ?? null,
      rules: { units: "cells, on the 16-unit grid (an eighth of a cell)", forms: formRules(rules.forms, fx.cell), note: "the rulebook's forms section in cells (lengths / grid.cell); ratios, counts and shares as they are" }, // prettier-ignore
      deck: fx.deck,
      world,
      families,
      forms,
      placing: { notes, failures },
      measures: measuresOf(forms, fx),
    };
  },
  gate(artifact, ctx) {
    const rules = metreRules(ctx);
    const fx = formsContext(ctx, rules);
    const forms = artifact.forms ?? [];
    const failures = [...(artifact.placing?.failures ?? [])];
    const notes = [...(artifact.placing?.notes ?? [])];
    const common = commonChecks(forms, fx, FAMILIES);
    failures.push(...common.failures);
    notes.push(...common.notes);
    for (const fam of FAMILIES) {
      if (!fam.check) continue;
      const r = fam.check(forms.filter((f) => f.family === fam.id), { ...fx, placed: forms }, artifact.world ?? {}); // placed: every form of the artifact
      failures.push(...r.failures.map((x) => `${fam.id}: ${x}`));
      notes.push(...r.notes.map((x) => `${fam.id}: ${x}`));
    }
    // the budget, recounted from the forms (a changed artifact is counted as it now is)
    const m = measuresOf(forms, fx);
    const B = m.budget;
    const byForm = Object.entries(m.byForm).map(([k, v]) => `${k} ${v.instances} (${v.brushes + v.rock})`).join(", ");
    if (B.brushes.total !== null) {
      const line = `brushes: ${B.brushes.total} estimated in the tile (stage 8's ${B.brushes.before} + ${B.brushes.forms} of forms: ${byForm || "none"}) against its limit ${B.brushes.limit} and PLAN.md's target ${B.brushes.target}${B.brushes.total > B.brushes.target ? ": past the target" : ""}`; // prettier-ignore
      if (B.brushes.limit !== null && B.brushes.total > B.brushes.limit) failures.push(`${line}: past the limit`);
      else notes.push(line);
    }
    if (B.entities.limit !== null && B.entities.total > B.entities.limit) failures.push(`entities: ${B.entities.total} in the tile (07's and 08's ${B.entities.before} + the forms' ${B.entities.forms}), at most ${B.entities.limit}`); // prettier-ignore
    else notes.push(`entities: ${B.entities.total} of ${B.entities.limit} (07's and 08's ${B.entities.before} + the forms' ${B.entities.forms})`);
    if (B.leaves) notes.push(`leaves (UNCALIBRATED): ${B.leaves.before} estimated before the forms, ${B.leaves.total} with them (their rock and world brushes are structure, detail cuts none)`); // prettier-ignore
    return { failures, notes };
  },
};
