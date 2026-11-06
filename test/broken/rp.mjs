// The RP contract's walking graph (levels/rp/paths.mjs checkPaths) broken in one way each: a place cut off from the
// rest, a place with no node, a roaming spot cut off or with no node, a way down that does not join the streets to the
// level below, a node past what a plugin's message carries, a link to a node that is not there, a walk that climbs.
// The graph is mese-01's with its level below (test/fixtures/mese-01-below.json), no compiler needed.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { HERE } from "../helper.mjs";
import { broken } from "./case.mjs";
import { planSite, assembleSite, siteSpec } from "../../levels/assembly/site.mjs";
import { loadLibrary } from "../../levels/assembly/library.mjs";
import { loadStyle } from "../../levels/assembly/style.mjs";
import { rpContract } from "../../levels/rp/contract.mjs";
import { checkPaths } from "../../levels/rp/paths.mjs";

const below = JSON.parse(readFileSync(join(HERE, "fixtures/mese-01-below.json"), "utf8"));
const plan = planSite({ ...siteSpec("mese-01"), below });
const contract = rpContract(plan, assembleSite(plan, loadLibrary(join(HERE, "../levels/assembly/pieces/mese")), { style: loadStyle("mese") }));
const copy = () => structuredClone(contract);
/** The failures checkPaths gives a contract. */
const fails = (c) => checkPaths(c.paths, c).failures;
/** Takes every link of a node out. */
const cut = (c, id) => (c.paths.links = c.paths.links.filter((l) => l.a !== id && l.b !== id));

const place = contract.places[0];
broken("checkPaths", "a place cut off from every other", {
  said: new RegExp(`the place ${place.id} cannot be reached from the largest piece of the graph`),
  broken: () => {
    const c = copy();
    const n = c.paths.nodes.find((q) => q.place === place.id);
    // its room's other nodes go with it: the nodes it is linked to keep to themselves
    const near = c.paths.links.filter((l) => l.a === n.id || l.b === n.id).map((l) => (l.a === n.id ? l.b : l.a));
    cut(c, n.id);
    for (const id of near) if (c.paths.nodes.find((q) => q.id === id).kind === "room") cut(c, id);
    return fails(c);
  },
  others: true,
  whole: () => fails(copy()),
});
broken("checkPaths", "a place with no node", {
  said: new RegExp(`the place ${place.id} is on no node`),
  broken: () => {
    const c = copy();
    c.paths.nodes.find((q) => q.place === place.id).place = undefined;
    return fails(c);
  },
});
broken("checkPaths", "a roaming spot cut off from the rest", {
  said: /the roaming spot 3 cannot be reached from the largest piece of the graph/,
  broken: () => {
    const c = copy();
    cut(c, c.paths.nodes.find((q) => q.roam === 3).id);
    return fails(c);
  },
});
broken("checkPaths", "a roaming spot on no node", {
  said: /the roaming spot 3 at .* is on no node/,
  broken: () => {
    const c = copy();
    c.paths.nodes.find((q) => q.roam === 3).roam = undefined;
    return fails(c);
  },
});
broken("checkPaths", "a way down that does not join the streets to the level below by itself", {
  said: /the street's manhole \(manhole\) does not join the streets to its foot/,
  broken: () => {
    const c = copy();
    c.paths.links = c.paths.links.filter((l) => !(l.how === "ladder" && l.way === "the street's manhole"));
    return fails(c);
  },
});
broken("checkPaths", "a node past +-4096, which a plugin's message cannot carry", {
  said: /outside \+-4096/,
  broken: () => {
    const c = copy();
    c.paths.nodes[5].at[0] = 5000;
    return fails(c);
  },
});
broken("checkPaths", "a link to a node that is not there", {
  said: /a link .* to nowhere: a node is not there|a node is not there/,
  broken: () => {
    const c = copy();
    c.paths.links.push({ a: c.paths.nodes[0].id, b: "nowhere", how: "walk" });
    return fails(c);
  },
});
broken("checkPaths", "a walk that climbs", {
  said: /a walk is flat, a stair or a ladder climbs/,
  broken: () => {
    const c = copy();
    const l = c.paths.links.find((q) => q.how === "walk" && !q.gate);
    c.paths.nodes.find((q) => q.id === l.b).at[2] += 100;
    return fails(c);
  },
  others: true,
});
