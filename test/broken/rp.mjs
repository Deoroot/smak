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
import { checkPaths, badStops, badStarts, closePoints, badCounters, badDoorSpots } from "../../levels/rp/paths.mjs";
import { placeCounter } from "../../levels/assembly/counter.mjs";

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

// A counter in every shop, bar and clinic room and the keeper's post behind it (levels/rp/paths.mjs badCounters; levels/assembly/counter.mjs
// placeCounter): a contract with the counter's numbers, a place without one, a post on the customers' side, a post in a wall, a counter that
// leaves 60 of floor in front or sits in a doorway, a post with no node; the room too small for one.
const withCounter = () => ({
  counters: { kinds: ["shop"], front: 96, side: 32 },
  places: [{ id: "b_shop", kind: "shop", building: "b", at: [100, 100, 0], yaw: 0, counter: { lo: [132, 36, 0], hi: [172, 164, 40] }, clear: 40, frontFree: 120 }],
  paths: {
    nodes: [
      { id: "place_b_shop", at: [100, 100, 36], kind: "place", place: "b_shop" },
      { id: "door_1", at: [400, 100, 36], kind: "door", door: "d1", gate: "door" },
    ],
    links: [],
  },
});
const counterFault = (edit) => badCounters(edit(withCounter())).map((b) => b.say);
broken("badCounters", "a shop place without a counter", {
  said: /the shop place b_shop has no counter/,
  broken: () => counterFault((c) => (delete c.places[0].counter, c)),
  whole: () => counterFault((c) => c),
});
broken("badCounters", "a keeper's post on the customers' side of its counter", {
  said: /the keeper's post of b_shop at 200 100 0 is not behind its counter/,
  broken: () => counterFault((c) => ((c.places[0].at = [200, 100, 0]), (c.paths.nodes[0].at = [200, 100, 36]), c)),
  whole: () => counterFault((c) => c),
});
broken("badCounters", "a keeper's post off the length of its counter", {
  said: /the keeper's post of b_shop at 100 200 0 is not behind its counter .*off its length/,
  broken: () => counterFault((c) => ((c.places[0].at = [100, 200, 0]), (c.paths.nodes[0].at = [100, 200, 36]), c)),
});
broken("badCounters", "a keeper's post with 20 clear to its back", {
  said: /the keeper's post of b_shop has 20 clear to its back and sides, not 32/,
  broken: () => counterFault((c) => ((c.places[0].clear = 20), c)),
});
broken("badCounters", "a counter that leaves 60 of floor on the customers' side", {
  said: /the counter of b_shop leaves 60 of floor on the customers' side, not 96: the counter cuts the room/,
  broken: () => counterFault((c) => ((c.places[0].frontFree = 60), c)),
});
broken("badCounters", "a counter in a doorway", {
  said: /the counter of b_shop is 0 from the door door_1: it blocks the doorway/,
  broken: () => counterFault((c) => ((c.paths.nodes[1].at = [150, 100, 36]), c)),
});
broken("badCounters", "a keeper's post with no walking node", {
  said: /the keeper's post of b_shop has no walking node at it/,
  broken: () => counterFault((c) => ((c.paths.nodes[0].at = [300, 300, 36]), c)),
});
const cellsOf = (w, h) => new Set(Array.from({ length: w * h }, (_, i) => `${i % w},${Math.floor(i / w)}`));
const roomDoor = { mid: [0, 128], at: [40, 128], entrance: true };
broken("placeCounter", "a room of one cell", {
  said: /no spot in the room holds a counter/,
  broken: () => [placeCounter({ cells: cellsOf(1, 1), doors: [{ mid: [0, 32], at: [40, 32], entrance: true }] }).why],
  whole: () => [placeCounter({ cells: cellsOf(6, 4), doors: [roomDoor] }).why],
});

// The teleport doors of a contract (levels/rp/paths.mjs badDoorSpots; npc-sim.mjs, check rp): a shop and a home with a door each, their two
// spots a side, each a node of the graph and the two joined by a tele link; a checkpoint gate that moves as its piece says. Then a door with no
// spots, one spot, a misnamed spot, a spot on no node (the compiled map took it out: a wall, no floor), no tele link, and two doors' spots 32 apart.
const teleRp = () => {
  const spots = (door, x) => [{ name: `${door}_1_a`, at: [x, -48, 2] }, { name: `${door}_1_b`, at: [x, 48, 2] }];
  const nodes = [];
  const links = [];
  for (const [door, x] of [["m_shop", 0], ["m_flat", 300]]) {
    nodes.push({ id: `${door}_a`, at: [x, -48, 38], kind: "door", approach: true, spot: `${door}_1_a` }, { id: `${door}_b`, at: [x, 48, 38], kind: "door", approach: true, spot: `${door}_1_b` });
    links.push({ a: `${door}_a`, b: `${door}_b`, how: "tele", gate: "door", via: door });
  }
  return {
    doorMode: "teleport",
    properties: [{ id: "shop", kind: "shop", doors: ["m_shop"] }, { id: "flat", kind: "home", doors: ["m_flat"] }, { id: "gate1", kind: "gate", doors: ["m_gate"] }],
    teleDoors: [{ door: "m_shop", n: 1, spots: spots("m_shop", 0) }, { door: "m_flat", n: 1, spots: spots("m_flat", 300) }],
    paths: { nodes, links },
  };
};
const spotFault = (edit) => { const c = teleRp(); edit(c); return badDoorSpots(c).map((b) => b.say); }; // prettier-ignore
const spotWhole = () => spotFault(() => {});
broken("badDoorSpots", "a door of a home with no spots", {
  said: /the door m_flat \(property flat, home\) is not a teleport door/,
  broken: () => spotFault((c) => c.teleDoors.pop()),
  whole: spotWhole,
});
broken("badDoorSpots", "a door with one spot", {
  said: /the door m_shop \(1\) has 1 spot, not 2 \(m_shop_1_a and m_shop_1_b\)/,
  broken: () => spotFault((c) => c.teleDoors[0].spots.pop()),
  whole: spotWhole,
});
broken("badDoorSpots", "a spot named for another door", {
  said: /the door m_shop \(1\)'s spot 2 is "m_flat_b" at .*; it wants m_shop_1_b/,
  broken: () => spotFault((c) => (c.teleDoors[0].spots[1].name = "m_flat_b")),
  others: true,
  whole: spotWhole,
});
broken("badDoorSpots", "a spot in a wall, which the compiled map took out of the graph", {
  said: /the spot m_shop_1_b of the door m_shop \(1\) is on no node of the walking graph: it is in a wall/,
  broken: () => spotFault((c) => (c.paths.nodes = c.paths.nodes.filter((n) => n.spot !== "m_shop_1_b"))),
  others: true,
  whole: spotWhole,
});
broken("badDoorSpots", "a door whose spots no tele link joins", {
  said: /the door m_flat \(1\) has no tele link between its spots m_flat_1_a and m_flat_1_b/,
  broken: () => spotFault((c) => (c.paths.links = c.paths.links.filter((l) => l.via !== "m_flat"))),
  whole: spotWhole,
});
broken("badDoorSpots", "two doors' spots 32 units apart", {
  said: /the spots m_shop_1_b and m_flat_1_a are 32 apart, under 48/,
  broken: () => spotFault((c) => { c.teleDoors[1].spots[0].at = [32, 48, 2]; }), // prettier-ignore
  others: true,
  whole: spotWhole,
});
