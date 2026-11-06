// The NPC plugin's offline check (levels/rp/npc-sim.mjs, levels/rp/plugin/smak_npc.sma): on the Mese's contract the
// roles and homes it gives, a route between every home and its work using only walk, stair and plain-door links of
// shops and public doors (and the NPC's own home); and the same check failing, by its sentence, on a graph with a
// gate, a lid and a ladder in the way, a home with no node, a place with no node.
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { test, sure, HERE } from "./helper.mjs";
import { planSite, assembleSite, siteSpec } from "../levels/assembly/site.mjs";
import { loadLibrary } from "../levels/assembly/library.mjs";
import { loadStyle } from "../levels/assembly/style.mjs";
import { rpContract } from "../levels/rp/contract.mjs";
import { analyse } from "../levels/rp/npc-sim.mjs";

const plan = planSite(siteSpec("mese-01"));
const built = assembleSite(plan, loadLibrary(join(HERE, "../levels/assembly/pieces/mese")), { style: loadStyle("mese") });
const contract = rpContract(plan, built);
const copy = (o) => JSON.parse(JSON.stringify(o));

test("npc sim: the Mese's shopkeepers and citizens have homes and routes on walk, stair and plain-door links", () => {
  const r = analyse(copy(contract), { cap: 12, workers: 2 });
  sure(r.errors.length === 0, `errors: ${r.errors.join(" | ")}`);
  sure(r.counts.shopkeeper === 5, `shopkeepers: ${JSON.stringify(r.counts)}`);
  sure(r.npcs.length === 12 && r.routes >= 10, `${r.npcs.length} NPCs, ${r.routes} routes`);
  sure(r.npcs.every((n) => n.home && n.home.node >= 0), "an NPC with no home node");
});

test("npc sim: the links an NPC never takes are left out (gate, lid, grate, secret, trapdoor, ladder, jump-down)", () => {
  const r = analyse(copy(contract), { cap: 6 });
  const links = contract.paths.links;
  const allowed = links.filter((l) => (l.how === "walk" || l.how === "stair") && (!l.gate || l.gate === "door")).length;
  const twoWay = links.filter((l) => (l.how === "walk" || l.how === "stair") && (!l.gate || l.gate === "door")).reduce((n, l) => n + (l.oneWay ? 1 : 2), 0); // prettier-ignore
  sure(r.edges === twoWay && allowed > 0, `${r.edges} directed edges, expected ${twoWay}`);
});

test("npc sim: a graph with its doors turned to lids, a home with no node, a place with no node: each says so", () => {
  const lids = copy(contract);
  for (const l of lids.paths.links) if (l.gate === "door") l.gate = "lid";
  const a = analyse(lids, { cap: 6 });
  sure(a.errors.some((e) => /no route/.test(e)), `doors as lids: ${a.errors.slice(0, 2).join(" | ")}`);
  const noHome = copy(contract);
  for (const n of noHome.paths.nodes) if (n.part && /flat|room/.test(n.part) && n.kind === "room") n.kind = "street";
  for (const n of noHome.paths.nodes) if (n.part && /flat|room/.test(n.part) && n.kind !== "street") n.part = "gone";
  const b = analyse(noHome, { cap: 6 });
  sure(b.warns.some((w) => /has no node/.test(w)) || b.errors.some((e) => /no home/.test(e)), `no home node: ${b.warns[0]} ${b.errors[0]}`); // prettier-ignore
  const noPlace = copy(contract);
  noPlace.paths.nodes = noPlace.paths.nodes.map((n) => (n.kind === "place" ? { ...n, kind: "street" } : n));
  const c = analyse(noPlace, { cap: 6 });
  sure(c.errors.some((e) => /its place has no node/.test(e)), `no place node: ${c.errors.slice(0, 2).join(" | ")}`);
});

// the city's own JSON, when the build is at hand (SMAK_RP_JSON, or the scratchpad build of 2026-11-05)
const cityJson = process.env.SMAK_RP_JSON;
if (cityJson && existsSync(cityJson)) {
  test("npc sim: the city's JSON, with the default budget (24)", () => {
    const r = analyse(JSON.parse(readFileSync(cityJson, "utf8")), { cap: 24, workers: 6 });
    sure(r.errors.length === 0, `errors: ${r.errors.slice(0, 3).join(" | ")}`);
    sure(r.npcs.length === 24 && r.counts.shopkeeper === 5 && r.counts.barman === 1 && r.counts.medic === 1 && r.counts.mechanic === 1, JSON.stringify(r.counts)); // prettier-ignore
  });
}
