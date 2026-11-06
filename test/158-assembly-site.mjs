// levels/assembly, the site (site.mjs, levels/specs/street-01.json, styles/shops.json): a stretch of a colonnaded
// street, its street, porticoes, lanes and square given, five buildings laid out from their program (a shop and two
// flats each). The plan with no failure, every site rule kept (properties, portico depth, street width, the square,
// footprints, homes' share), the spawns on public floor; the properties of a building (the back room the shop's, each
// flat its own, the stair hall the building's door). Assembling the site needs a kit of pieces with porticoes and
// shopfronts, which this folder has none of; assembleSite, siteLight and dressSite are tested where such a kit is.
// The level below the street (below.mjs, test/fixtures/street-01-below.json): planned, its rules kept, every part reached, a
// floor too high refused. The broken cases of checkSite and checkSpawns are in test/broken/levels.mjs.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test, sure, HERE } from "./helper.mjs";
import { planSite, checkSite, spawnsOf, checkSpawns, propertiesOf, siteSpec } from "../levels/assembly/site.mjs";
import { checkBelow, readBelow } from "../levels/assembly/below.mjs";
import { loadStyle } from "../levels/assembly/style.mjs";

const plan = planSite(siteSpec("street-01"));
const style = loadStyle("shops");

test("assembly site: street-01 planned with no failure and every site rule of the shops' style kept", () => {
  sure(!plan.failures.length, `the plan: ${plan.failures.join(" | ")}`);
  const c = checkSite(plan, style);
  sure(!c.failures.length && !c.warnings.length, `the site: ${[...c.failures, ...c.warnings].join(" | ")}`);
  const m = c.measures;
  sure(m.properties.shop === 5 && m.properties.home === 10 && m.homesShare >= 0.6, `properties: ${JSON.stringify(m.properties)}`);
  sure(m.porticoes.every((d) => d >= 2) && m.street >= 5 && m.street <= 9, `porticoes ${m.porticoes}, street ${m.street}`);
  const spawns = spawnsOf(plan);
  sure(spawns.length >= 8 && !checkSpawns(plan, spawns, style).failures.length, `spawns: ${checkSpawns(plan, spawns, style).failures.join(" | ")}`); // prettier-ignore
});

test("assembly site: a building's properties: the back room the shop's, each flat its own, the stair hall the door's", () => {
  const props = propertiesOf(plan.layouts.get("a"), style);
  const got = Object.fromEntries(props);
  sure(got.shop === "shop" && got.back === "shop" && got.flat1 === "flat1" && got.flat2 === "flat2" && got.hall === "hall" && got.landing === null, `properties: ${JSON.stringify(got)}`); // prettier-ignore
});

test("assembly site: a level below the street: planned with its rules kept, every part reached, a floor too high refused", () => {
  const BELOW = JSON.parse(readFileSync(join(HERE, "fixtures/street-01-below.json"), "utf8"));
  const p = planSite({ ...siteSpec("street-01"), below: BELOW });
  sure(!p.failures.length, `the plan: ${p.failures.join(" | ")}`);
  const c = checkBelow(p, undefined, spawnsOf(p));
  sure(!c.failures.length && c.measures.ways === 3 && c.measures.reached === c.measures.cells, `the level's rules: ${c.failures.join(" | ")} ${JSON.stringify(c.measures)}`); // prettier-ignore
  sure(readBelow({ size: [32, 28], below: { ...BELOW, floor: -200 } }).some((f) => /the ground the street stands on/.test(f)), "a floor too high is refused");
});
