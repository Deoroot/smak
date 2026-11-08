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
import { rpContract, checkRewards } from "../../levels/rp/contract.mjs";
import { checkPaths, badStops, badStarts, closePoints } from "../../levels/rp/paths.mjs";

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

// A mission's reward in money (levels/rp/contract.mjs checkRewards): an integer from 0 to 100000.
const mission = (reward) => [{ id: "courier_1", steps: [], done: { say: "Paid.", reward } }];
broken("checkRewards", "a negative reward.money", {
  said: /mission courier_1: reward\.money must be an integer from 0 to 100000, not -5/,
  broken: () => checkRewards(mission({ frags: 1, money: -5 })),
  whole: () => checkRewards(mission({ frags: 1, money: 150 })),
});
broken("checkRewards", "a reward.money that is not a whole number", {
  said: /mission courier_1: reward\.money must be an integer from 0 to 100000, not 12\.5/,
  broken: () => checkRewards(mission({ money: 12.5 })),
  whole: () => checkRewards(mission({ money: 12 })),
});

// A stop point in a doorway or on a way down (levels/rp/paths.mjs badStops, npc-sim.mjs): a street spot a citizen idles at,
// 40 units from a door's middle or 30 from a ladder's foot; the same spot 100 units off is whole.
const stopDoor = (gap) => ({
  nodes: [
    { id: "door_1", at: [0, 0, 36], kind: "door", door: "d1", gate: "door" },
    { id: "door_2", at: [0, 40, 36], kind: "door", approach: true },
    { id: "street_1", at: [gap, 0, 36], kind: "street", roam: 0 },
  ],
  ways: [],
});
const stopWay = (gap) => ({
  nodes: [
    { id: "ladder_1", at: [500, 500, -348], kind: "ladder", way: "w" },
    { id: "sewer_1", at: [500, 500 + gap, -348], kind: "sewer", roam: 0 },
  ],
  ways: [],
});
// An NPC point where players appear, or two NPCs on one spot (levels/rp/paths.mjs badStarts, closePoints; npc-sim.mjs): a start
// 40 units from a roaming spot, a place on a start, a giver 20 from a roaming spot.
const startAt = (kind, d) => {
  const c = copy();
  const at = kind === "place" ? c.places[0].at : c.roam[0].at;
  c.starts = [{ at: [at[0] + d, at[1], at[2]] }];
  return c;
};
broken("badStarts", "a roaming spot 40 units from a player start", {
  said: /the roam spot 0 at .* is within 96 units of a player start/,
  broken: () => badStarts(startAt("roam", 40)).map((b) => b.say),
  others: true,
  whole: () => badStarts(copy()).map((b) => b.say),
});
broken("badStarts", "a place on a player start", {
  said: /the place [a-z_0-9]+ at .* is within 96 units of a player start/,
  broken: () => badStarts(startAt("place", 0)).map((b) => b.say),
  others: true,
  whole: () => badStarts(startAt("spawn", 200)).filter((b) => b.kind === "guard spawn").map((b) => b.say),
});
broken("closePoints", "a giver 20 units from a roaming spot", {
  said: /giver zz at .* are less than 40 units apart/,
  broken: () => {
    const c = copy();
    const at = c.roam[0].at;
    c.npcs = [{ id: "zz", at: [at[0] + 20, at[1], at[2]] }];
    return closePoints(c).map((b) => b.say);
  },
  whole: () => closePoints(copy()).map((b) => b.say),
});
broken("badStops", "a roaming spot 40 units from a door's middle", {
  said: /the roam stop point street_1 at 40,0,36 is within 64 units of the door door_1/,
  broken: () => badStops(stopDoor(40)).map((b) => b.say),
  whole: () => badStops(stopDoor(100)).map((b) => b.say),
});
broken("badStops", "a roaming spot 30 units from a ladder's foot", {
  said: /the roam stop point sewer_1 at 500,530,-348 is within 64 units of a way down \(ladder_1\)/,
  broken: () => badStops(stopWay(30)).map((b) => b.say),
  whole: () => badStops(stopWay(100)).map((b) => b.say),
});
