// levels/assembly, the site (site.mjs, levels/specs/street-01.json, styles/shops.json): a stretch of a colonnaded
// street, its street, porticoes, lanes and square given, five buildings laid out from their program (a shop and two
// flats each). The plan with no failure, every site rule kept (properties, portico depth, street width, the square,
// footprints, homes' share), the spawns on public floor; the properties of a building (the back room the shop's, each
// flat its own, the stair hall the building's door). Assembling the site needs a kit of pieces with porticoes and
// shopfronts, which this folder has none of; assembleSite, siteLight and dressSite are tested where such a kit is.
// The broken cases of checkSite and checkSpawns are in test/broken/levels.mjs.
import { test, sure } from "./helper.mjs";
import { planSite, checkSite, spawnsOf, checkSpawns, propertiesOf, siteSpec } from "../levels/assembly/site.mjs";
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
