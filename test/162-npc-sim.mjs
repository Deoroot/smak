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
import { analyse, npcIds } from "../levels/rp/npc-sim.mjs";

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

// ---- the guards (smak_npc.sma "guards"): waypoints, ids, what they reach, in a graph small enough to read -------------
// A police place (post) and a checkpoint gate between the street and a square; a shop; a home behind its own door.
//   post -- street_a -- door_g (gate) -- street_b -- shop_door(door) -- shop_room;  street_b -- home_door(door) -- home_room
function tiny({ post = "place", gates = true, linkHome = true } = {}) {
  const n = (id, at, kind, extra = {}) => ({ id, at, kind, district: "d", part: "p_" + id, ...extra });
  const nodes = [
    n("post_n", [0, 0, 36], post === "place" ? "place" : "street", post === "place" ? { place: "desk_post" } : {}),
    n("street_a", [100, 0, 36], "street"),
    n("door_g", [200, 0, 36], "door", { gate: "gate" }),
    n("street_b", [300, 0, 36], "street"),
    n("shop_room", [300, 200, 36], "room", { part: "shop.room" }),
    n("home_room", [300, -200, 36], "room", { part: "home.room" }),
    n("police_room", [-100, 0, 36], "room", { part: "nx.booking" }),
  ];
  const link = (a, b, extra = {}) => ({ a, b, how: "walk", ...extra });
  const links = [link("post_n", "street_a"), link("street_b", "shop_room", { gate: "door", via: "t_shop" }), link("post_n", "police_room", { gate: "door", via: "t_police" })];
  if (gates) links.push(link("street_a", "door_g", { gate: "gate", via: "t_gate" }), link("door_g", "street_b", { gate: "gate", via: "t_gate" }));
  else links.push(link("street_a", "street_b"));
  if (linkHome) links.push(link("street_b", "home_room", { gate: "door", via: "t_home" }));
  return {
    format: "smak-rp/1",
    map: "tiny",
    places: post === "place" ? [{ id: "desk_post", kind: "police", building: "nx", district: "d" }] : [],
    properties: [
      { id: "shop", kind: "shop", doors: ["t_shop"], building: "s", rooms: ["room"], district: "d" },
      { id: "home", kind: "home", doors: ["t_home"], building: "home", rooms: ["room"], district: "d" },
      { id: "booking", kind: "police", doors: ["t_police"], building: "nx", rooms: ["booking"], district: "d" },
      { id: "gate_p", kind: "public", doors: ["t_gate"], building: null, rooms: [], district: "d" },
    ],
    paths: { nodes, links },
  };
}

test("npc sim guards: ids guard_01.., posts then the gate's two sides, and what they reach: patrol no homes, breach all", () => {
  const r = analyse(tiny(), { cap: 0, guards: 4 });
  sure(r.errors.length === 0, r.errors.join(" | "));
  const g = r.guards;
  sure(g.count === 4 && g.ids.join() === "guard_01,guard_02,guard_03,guard_04", JSON.stringify(g.ids));
  sure(g.src === "places" && g.posts === 1 && g.waypoints.join() === "post_n,street_a,street_b", `${g.src} ${g.waypoints}`);
  sure(g.reach.nodes === 7, `walkable nodes ${g.reach.nodes}`);
  sure(g.reach.patrol === 6, `patrol reach ${g.reach.patrol} (every node but the home)`);
  sure(g.reach.huntLockedHomes === 6 && g.reach.breach === 7, `hunt ${g.reach.huntLockedHomes}, breach ${g.reach.breach}`);
  sure(g.patrol.every((p) => p.ok && p.units > 0), JSON.stringify(g.patrol));
  sure(npcIds(tiny(), { cap: 0 }).join() === "guard_01,guard_02,guard_03,guard_04", "npcIds lacks the guards");
});

test("npc sim guards: a police property when no place is a post; gates when there is no police at all; none with no gate either", () => {
  const noPlace = tiny({ post: "none" });
  const a = analyse(noPlace, { cap: 0 });
  sure(a.guards.src === "police properties" && a.guards.waypoints[0] === "police_room", `${a.guards.src} ${a.guards.waypoints}`);
  const bare = tiny({ post: "none" });
  bare.properties = bare.properties.filter((p) => p.kind !== "police");
  const b = analyse(bare, { cap: 0 });
  sure(b.guards.src === "gates" && b.guards.waypoints.join() === "street_a,street_b", `${b.guards.src} ${b.guards.waypoints}`);
  sure(b.warns.some((w) => /patrol the gates only/.test(w)), b.warns.join(" | "));
  const empty = tiny({ post: "none", gates: false });
  empty.properties = empty.properties.filter((p) => p.kind !== "police");
  const none = analyse(empty, { cap: 0 });
  sure(none.guards.count === 0 && none.guards.src === "none", `${none.guards.count} guards, source ${none.guards.src}`);
  sure(none.warns.some((w) => /no guards/.test(w)), none.warns.join(" | "));
});

test("npc sim guards: the guards come out of the 40 (the others keep their ids); a home nobody can open is reported by what a breach still misses", () => {
  const rp = tiny();
  const a = analyse(rp, { cap: 40, guards: 8 });
  sure(a.npcs.length <= 32, `${a.npcs.length} civilians with 8 guards`);
  const unreached = tiny({ linkHome: false });
  const b = analyse(unreached, { cap: 0 });
  sure(b.guards.reach.breach === 6 && b.warns.some((w) => /even with doors breached the guards cannot reach 1 of 7/.test(w)), b.warns.join(" | "));
});

test("npc sim guards: a post the patrol cannot get out of is an error, by its sentence", () => {
  const rp = tiny();
  // the police room's door becomes a lid: the post's only other exit is street_a, so cut that too
  rp.paths.links = rp.paths.links.filter((l) => !(l.a === "post_n" && l.b === "street_a"));
  const r = analyse(rp, { cap: 0 });
  sure(r.errors.some((e) => /no patrol route/.test(e)), `errors: ${r.errors.join(" | ")}`);
});

// the city's own JSON, when the build is at hand (SMAK_RP_JSON, or the scratchpad build of 2026-11-05)
const cityJson = process.env.SMAK_RP_JSON;
if (cityJson && existsSync(cityJson)) {
  test("npc sim: the city's JSON, with the default budget (24)", () => {
    const r = analyse(JSON.parse(readFileSync(cityJson, "utf8")), { cap: 24, workers: 6 });
    sure(r.errors.length === 0, `errors: ${r.errors.slice(0, 3).join(" | ")}`);
    sure(r.guards.count === 4 && r.guards.reach.breach >= r.guards.reach.nodes - 5, `guards ${JSON.stringify(r.guards.reach)}`);
    sure(r.npcs.length === 24 && r.counts.shopkeeper === 5 && r.counts.barman === 1 && r.counts.medic === 1 && r.counts.mechanic === 1, JSON.stringify(r.counts)); // prettier-ignore
  });
}
