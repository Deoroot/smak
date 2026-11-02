// Stage 0, the description: validated field by field, checked by every check-city rule (with the city kind's
// bands, as the check-city command holds them by default), the architecture rulebook loaded, tightened by the
// description's own `architecture` and put in the engine's units (rulesFor goldsrc), and every engine limit held to
// carry its source. Writes 00-description.json: the description as given, the rulebook in units, the check's headline.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateCity } from "../lib/city-description.mjs";
import { checkCity, bandsFromCityStyle } from "../lib/city-checks.mjs";
import { validateRules, tighten, rulesFor } from "../lib/architecture-rules.mjs";

const STYLE = join(dirname(fileURLToPath(import.meta.url)), "../styles/rp-city.json");
const bands = () => (existsSync(STYLE) ? bandsFromCityStyle(JSON.parse(readFileSync(STYLE, "utf8"))) : null);

function run(ctx) {
  const desc = ctx.description;
  const { errors } = validateCity(desc);
  const result = errors.length ? null : checkCity(desc, bands());
  const ruleErrors = validateRules(ctx.rulebook).errors;
  let rulebook = null;
  let tightenErrors = [];
  if (!ruleErrors.length) {
    const t = tighten(ctx.rulebook, desc?.architecture ?? {});
    tightenErrors = t.errors;
    rulebook = rulesFor(ctx.params.engine ?? "goldsrc", t.rules);
  }
  return {
    description: desc,
    rulebook,
    check: {
      valid: errors,
      pass: Boolean(result?.pass),
      failures: result?.failures ?? errors.map((e) => `invalid: ${e}`),
      metrics: result?.analysis?.metrics ?? null,
      rulebookErrors: [...ruleErrors, ...tightenErrors],
    },
  };
}

function gate(a) {
  const failures = [];
  for (const f of a.check.failures) failures.push(`description: ${f}`);
  for (const e of a.check.rulebookErrors) failures.push(`rulebook: ${e}`);
  if (!a.rulebook) failures.push("rulebook: not loaded (it is invalid)");
  for (const [k, lim] of Object.entries(a.description?.engine?.limits ?? {}))
    if (!(typeof lim?.source === "string" && lim.source)) failures.push(`targets: engine.limits.${k} gives no source`);
  if (a.description?.tiles && !/^c\d+_r\d+$/.test(a.params.tile)) failures.push(`params: tile ${JSON.stringify(a.params.tile)} is not a tile id (c<col>_r<row>)`); // prettier-ignore
  else if (a.description?.tiles) {
    const [c, r] = a.params.tile.slice(1).split("_r").map(Number);
    if (c >= a.description.tiles.cols || r >= a.description.tiles.rows) failures.push(`params: tile ${a.params.tile} is outside the ${a.description.tiles.cols} x ${a.description.tiles.rows} tiles`); // prettier-ignore
  }
  return { failures, notes: [] };
}

export const stage = { n: 0, name: "description", reads: ["description", "rulebook"], run, gate };
