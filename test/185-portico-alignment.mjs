// levels/assembly/porticoes.mjs: every column of every portico of a site standing under its architrave: the shaft,
// the capital and the beam centred on the column's vertex within 1 unit. Held on the Mese's site (mese-01) and, where
// the file is there, on Byzantium's spine (byzantium-02-spine, the H9 map smak_rp_byz02s: 28 columns), whose planning
// takes minutes, so it is left to `SMAK_PORTICO_BYZ=1` (with `SMAK_LAYOUT_CACHE=<folder>` to keep the layouts between runs). The broken cases are in test/broken/levels.mjs.
import { join } from "node:path";
import { test, sure, HERE } from "./helper.mjs";
import { planSite, assembleSite, siteSpec } from "../levels/assembly/site.mjs";
import { checkPorticoes } from "../levels/assembly/porticoes.mjs";
import { loadLibrary } from "../levels/assembly/library.mjs";
import { loadStyle } from "../levels/assembly/style.mjs";

const library = loadLibrary(join(HERE, "../levels/assembly/pieces/mese"));

const held = (name, styleName) => {
  const plan = planSite(siteSpec(name), { cache: process.env.SMAK_LAYOUT_CACHE || null });
  const built = assembleSite(plan, library, { style: loadStyle(styleName) });
  const got = checkPorticoes(built.map, plan);
  sure(got.measures.columns > 0, `${name}: no portico column found`);
  sure(!got.failures.length, `${name}: ${got.failures.join(" | ")}`);
  return got.measures;
};

test("portico alignment: mese-01's columns, capitals and beams centred within 1 unit", () => {
  const m = held("mese-01", "mese");
  console.log(`      ${m.columns} columns, the worst ${m.worst.toFixed(2)} off its axis`);
});

if (process.env.SMAK_PORTICO_BYZ) {
  test("portico alignment: byzantium-02-spine's columns, capitals and beams centred within 1 unit", () => {
    const m = held("byzantium-02-spine", "byzantium");
    console.log(`      ${m.columns} columns, the worst ${m.worst.toFixed(2)} off its axis`);
  });
}
