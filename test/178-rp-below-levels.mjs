// The RP layer on the sewers of several levels (levels/rp/deep.mjs; levels/specs/below-levels-01.json, two levels, a stair and a
// ladder shaft between them, two manholes from the street): the contract's walking graph has nodes on each level's floor, along
// every tunnel and across every hall, a link only where a player's hull walks it clear of the walls and the columns, no
// route over a water channel or a pool, stair links between the levels and a ladder link NPCs do not take, the places and
// roaming spots of the description on the floor, and every cap of the plugin kept; npc-sim holds it.
import { join } from "node:path";
import { test, sure, sureEach, HERE } from "./helper.mjs";
import { planSite, assembleSite, siteSpec } from "../levels/assembly/site.mjs";
import { loadLibrary } from "../levels/assembly/library.mjs";
import { loadStyle } from "../levels/assembly/style.mjs";
import { rpContract } from "../levels/rp/contract.mjs";
import { checkPaths } from "../levels/rp/paths.mjs";
import { walkModel, checkDeepPaths, ROUTE_LEN } from "../levels/rp/deep.mjs";
import { analyse, CAPS } from "../levels/rp/npc-sim.mjs";

const plan = planSite(siteSpec("below-levels-01"));
const built = assembleSite(plan, loadLibrary(join(HERE, "../levels/assembly/pieces/mese")), { style: loadStyle("mese") });
const contract = rpContract(plan, built);
const paths = contract.paths;
const deep = plan.below.deep;
const floors = new Map(deep.levels.map((l) => [l.id, l.floor]));
const mine = paths.nodes.filter((n) => n.district === "below" && n.level !== undefined);
const byId = new Map(paths.nodes.map((n) => [n.id, n]));
const model = walkModel(deep);
const EYE = 36;

test("rp below levels: the graph checks clean, every node of both levels reached from the first, nothing warned of for the levels", () => {
  const got = checkPaths(paths, contract);
  sure(got.failures.length === 0, got.failures.join(" | "));
  const own = got.warnings.filter((w) => /level|tunnel|ladder|stair|hall/.test(w));
  sure(own.length === 0, own.join(" | "));
  sure(got.measures.deep.levels.S1 > 20 && got.measures.deep.levels.S2 > 20, JSON.stringify(got.measures.deep));
});

test("rp below levels: nodes on each level's floor, in every tunnel and every hall", () => {
  for (const n of mine) {
    if (n.kind === "stair") continue; // a tread
    if (floors.get(n.level) === undefined) {
      sure(deep.chains.some((c) => c.kind === "stair" && c.id === n.level), `${n.id} is on a level that is none: ${n.level}`); // a landing of a stair, between the floors
      continue;
    }
    sure(Math.abs(n.at[2] - EYE - floors.get(n.level)) < 0.5, `${n.id} (${n.kind}, ${n.part}) stands at ${n.at[2] - EYE}, not on the floor ${floors.get(n.level)} of ${n.level}`);
  }
  for (const c of deep.chains.filter((q) => q.kind === "tunnel")) sure(mine.some((n) => n.part === c.id), `no node along the tunnel ${c.id}`);
  for (const h of deep.halls.filter((q) => !q.shaft)) sure(mine.filter((n) => n.part === h.id).length >= 3, `the hall ${h.id} has ${mine.filter((n) => n.part === h.id).length} nodes`);
  // the tunnels' nodes follow the bends: a tunnel of 45-degree bends has a node by every point
  const t2 = deep.chains.find((c) => c.id === "s1-t2");
  const own = mine.filter((n) => n.part === "s1-t2");
  for (const p of t2.pts) sure(own.some((n) => Math.hypot(n.at[0] - p.x, n.at[1] - p.y) < 40), `no node near the bend (${p.x}, ${p.y}) of s1-t2`);
});

test("rp below levels: every sewer node a hull stands on, every walk clear of the walls, the columns and the water", () => {
  const near = new Map(mine.map((n) => [n.id, n]));
  for (const n of mine) {
    if (!["sewer", "place"].includes(n.kind)) continue;
    sure(model.clear([n.at[0], n.at[1]], n.at[2] - EYE), `${n.id} (${n.part}) at ${n.at} is on no clear floor: a wall, a column, the water or a basin is in the hull`);
  }
  let walked = 0;
  for (const l of paths.links) {
    if (l.how !== "walk" && l.how !== "stair") continue;
    const [a, b] = [near.get(l.a), near.get(l.b)];
    if (!a || !b) continue;
    walked++;
    sure(model.line([a.at[0], a.at[1]], [b.at[0], b.at[1]], a.at[2] - EYE, b.at[2] - EYE), `the ${l.how} ${l.a} to ${l.b} (${a.part} to ${b.part}) passes through a wall, a column or the water`);
  }
  sure(walked > 150, `${walked} walks`);
  // water is no route: nothing stands over the channel of a tunnel or the basin of a pool
  const great = deep.halls.find((h) => h.id === "great");
  const xs = great.poly.map((p) => p[0]);
  const ys = great.poly.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs) + 64, Math.max(...xs) - 64, Math.min(...ys) + 64, Math.max(...ys) - 64];
  for (const n of mine.filter((q) => q.level === "S2")) sure(!(n.at[0] > x0 && n.at[0] < x1 && n.at[1] > y0 && n.at[1] < y1), `${n.id} stands in the basin of the great hall`);
});

test("rp below levels: a stair of walk links joins the levels, the ladder is a link the NPCs do not take, the manholes join the streets", () => {
  const stairLinks = paths.links.filter((l) => l.how === "stair" && byId.get(l.a)?.district === "below" && byId.get(l.b)?.district === "below");
  sure(stairLinks.length >= 4, `${stairLinks.length} stair links below`);
  const ladders = paths.links.filter((l) => l.how === "ladder" && byId.get(l.a)?.district === "below" && byId.get(l.b)?.district === "below");
  sure(ladders.length === 1 && ladders[0].way === "ladder-1", JSON.stringify(ladders));
  const way = paths.ways.map((w) => w.id).sort();
  sure(way.join() === "pump-manhole,weir-manhole", way.join());
  const deepOnly = checkDeepPaths(paths);
  sure(deepOnly.failures.length === 0 && deepOnly.warnings.length === 0, [...deepOnly.failures, ...deepOnly.warnings].join(" | "));
  sure(deepOnly.measures.ladderOnly.length === 0, "a level reached only by ladder");
  // the ladder's two ends are on the two levels
  const [a, b] = [byId.get(ladders[0].a), byId.get(ladders[0].b)];
  sure(new Set([a.level, b.level]).size === 2, `the ladder joins ${a.level} and ${b.level}`);
});

test("rp below levels: the places and the roaming spots of the description are on the floor", () => {
  const market = contract.places.find((p) => p.id === "below_market");
  const pumps = contract.places.find((p) => p.id === "below_pumps");
  sure(market && pumps && market.kind === "den" && pumps.kind === "office", JSON.stringify(contract.places.filter((p) => p.district === "below")));
  sure(market.at[2] === floors.get("S2") && pumps.at[2] === floors.get("S1"), `places at ${market.at[2]} and ${pumps.at[2]}`);
  for (const p of [market, pumps]) {
    const n = paths.nodes.find((q) => q.place === p.id);
    sure(n && n.kind === "place" && Math.abs(n.at[0] - p.at[0]) < 6 && Math.abs(n.at[1] - p.at[1]) < 6, `the place ${p.id} has no node on its spot`);
    sure(model.clear([p.at[0], p.at[1]], p.at[2]), `the place ${p.id} is not on a clear floor`);
  }
  const below = contract.roam.filter((r) => r.district === "below");
  sure(below.length >= 8, `${below.length} roaming spots below`);
  sure(below.every((r) => Object.values(Object.fromEntries(floors)).includes(r.at[2])), "a roaming spot off a floor");
  sure(below.some((r) => r.at[2] === floors.get("S2")) && below.some((r) => r.at[2] === floors.get("S1")), "roaming spots on one level only");
  sure(below.every((r, i) => paths.nodes.some((n) => n.roam !== undefined && n.district === "below" && Math.abs(n.at[0] - r.at[0]) < 6 && Math.abs(n.at[1] - r.at[1]) < 6)), "a roaming spot below on no node");
  // the spot the description gave on S2 at (1000, 700): on a floor within 96 of it
  sure(below.some((r) => r.at[2] === floors.get("S2") && Math.hypot(r.at[0] - 1000, r.at[1] - 700) <= 96), "the roaming spot given at S2 1000,700 is not there");
});

test("rp below levels: within the plugin's caps, and npc-sim holds it: every node reached, the longest route under ROUTE_LEN", () => {
  sure(paths.nodes.length <= CAPS.nodes, `${paths.nodes.length} nodes`);
  sure(paths.links.length * 2 <= CAPS.edges, `${paths.links.length * 2} directed edges`);
  sure(contract.roam.length <= CAPS.roam && contract.places.length <= CAPS.places, `${contract.roam.length} roam, ${contract.places.length} places`);
  const r = analyse(JSON.parse(JSON.stringify(contract)));
  sure(r.errors.length === 0, r.errors.join(" | "));
  sure(r.deep.nodes === mine.length && r.deep.fromStreet === mine.length, JSON.stringify(r.deep));
  sure(r.deep.longestRoute + 1 <= ROUTE_LEN, `the longest route is ${r.deep.longestRoute + 1} nodes`);
  sure(r.deep.toDeepest && r.deep.toDeepest.to === "S2" && r.deep.toDeepest.nodes > 10, JSON.stringify(r.deep.toDeepest));
  sure(r.skipped["how ladder"] === 3, `links left out: ${JSON.stringify(r.skipped)}`); // two manholes and the shaft's ladder
});
