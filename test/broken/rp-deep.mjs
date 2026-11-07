// The RP layer's walking graph of the sewers on several levels (levels/rp/deep.mjs) broken in one way each: a stair that no
// walk joins, a level reached only by ladder (a warning), a node reached by no link, a route longer than the plugin's, a
// tunnel nobody can walk for the water, a ladder whose top reaches nothing, a place on no floor, a place of no kind. The
// graph is below-levels-01's, built from the description (no site, no compiler).
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { HERE } from "../helper.mjs";
import { broken } from "./case.mjs";
import { planLevels } from "../../levels/assembly/below-levels.mjs";
import { deepGraph, deepSpots, checkDeepPaths, ROUTE_LEN } from "../../levels/rp/deep.mjs";

const spec = JSON.parse(readFileSync(join(HERE, "../levels/specs/below-levels-01.json"), "utf8"));
const planOf = (below) => planLevels(below, spec, null);
const KINDS = new Set(["shop", "bar", "den", "office"]);

/** The graph in the shape of a contract's `paths`, from a description's levels. */
function pathsFrom(below = spec.below) {
  const G = deepGraph(planOf(below), {});
  return {
    nodes: G.nodes.map((n) => ({ id: `d${n.i}`, at: [n.x, n.y, n.z + 36], kind: n.kind, district: "below", part: n.part, level: n.level, ...(n.way ? { way: n.way } : {}) })),
    links: G.links.map((l) => ({ a: `d${l.a}`, b: `d${l.b}`, how: l.how, ...(l.way ? { way: l.way } : {}) })),
    deep: { levels: G.measures.levels, stairs: G.measures.stairs },
    warnings: [],
  };
}
const whole = pathsFrom();
const copy = () => structuredClone(whole);

broken("checkDeepPaths", "a stair of the description that no walk joins", {
  said: /the stair stair-1 joins S1 and S2 in the plan, but no walk or stair link joins them in the graph/,
  others: true, // its treads are then reached by no link either
  broken: () => {
    const p = copy();
    const stair = new Set(p.nodes.filter((n) => n.part === "stair-1").map((n) => n.id));
    p.links = p.links.filter((l) => !stair.has(l.a) && !stair.has(l.b));
    return checkDeepPaths(p).failures;
  },
  whole: () => checkDeepPaths(copy()).failures,
});
broken("checkDeepPaths", "a level that is reached only by ladder (a warning)", {
  said: /the level S2 is reached only by ladder: a guard on a chase cannot follow/,
  broken: () => {
    const p = copy();
    const stair = new Set(p.nodes.filter((n) => n.part === "stair-1").map((n) => n.id));
    p.links = p.links.filter((l) => !stair.has(l.a) && !stair.has(l.b));
    p.nodes = p.nodes.filter((n) => !stair.has(n.id));
    p.deep = { ...p.deep, stairs: [] };
    return checkDeepPaths(p).warnings;
  },
  whole: () => checkDeepPaths(copy()).warnings,
});
broken("checkDeepPaths", "a node of a level that no link reaches", {
  said: /1 nodes of the levels below are reached from the first level by no link/,
  broken: () => {
    const p = copy();
    const id = p.nodes.find((n) => n.part === "customs" && n.kind === "sewer").id;
    p.links = p.links.filter((l) => l.a !== id && l.b !== id);
    return checkDeepPaths(p).failures;
  },
  whole: () => checkDeepPaths(copy()).failures,
});
/** A line of `n` nodes on one level. */
const line = (n) => ({
  nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, at: [i * 50, 0, 36], kind: "sewer", district: "below", part: "line", level: "L" })),
  links: Array.from({ length: n - 1 }, (_, i) => ({ a: `n${i}`, b: `n${i + 1}`, how: "walk" })),
  warnings: [],
});
broken("checkDeepPaths", `a route longer than the plugin's ${ROUTE_LEN} nodes`, {
  said: new RegExp(`the longest route between two nodes of the levels below is ${ROUTE_LEN + 1} nodes; the plugin's route holds ${ROUTE_LEN}`),
  broken: () => checkDeepPaths(line(ROUTE_LEN + 1)).failures,
  whole: () => checkDeepPaths(line(ROUTE_LEN)).failures,
});

const withTunnel = (id, change) => ({ ...spec.below, levels: spec.below.levels.map((l) => ({ ...l, tunnels: l.tunnels.map((t) => (t.id === id ? change(t) : t)) })) });
broken("deepGraph", "a tunnel whose ledge beside the water is too narrow to stand on (a warning)", {
  said: /the tunnel s2-t2: its ledge beside the water is 6 wide, 16 wanted; nobody walks it \(water is never a route\)/,
  broken: () => deepGraph(planOf(withTunnel("s2-t2", (t) => ({ ...t, water: { ...t.water, strip: 0.9 } }))), {}).warnings,
  whole: () => deepGraph(planOf(spec.below), {}).warnings,
});
broken("deepGraph", "a ladder shaft that no tunnel of the upper level meets", {
  said: /ladder-1: no tunnel of S1 meets its shaft above the floor, so its ladder's top reaches nothing/,
  others: true, // the tunnel taken out leaves the shaft's wall bare and the level's loops short
  broken: () => deepGraph(planOf({ ...spec.below, levels: spec.below.levels.map((l) => ({ ...l, tunnels: l.tunnels.filter((t) => t.id !== "s1-t6") })) }), {}).failures,
  whole: () => deepGraph(planOf(spec.below), {}).failures,
});

const deepPlan = planOf(spec.below);
broken("deepSpots", "a place that lands on no floor", {
  said: /the place far: no spot a player can stand within 96 units of 9000, 9000 on the floor -384 of S1/,
  broken: () => deepSpots(deepPlan, { places: [{ id: "far", kind: "den", level: "S1", at: [9000, 9000] }] }, { kinds: KINDS }).failures,
  whole: () => deepSpots(deepPlan, { places: [{ id: "far", kind: "den", level: "S1", at: [320, 832] }] }, { kinds: KINDS }).failures,
});
broken("deepSpots", "a place of a kind the contract does not know", {
  said: /the place x of the levels below: its kind "castle" is not one of shop, bar, den, office/,
  broken: () => deepSpots(deepPlan, { places: [{ id: "x", kind: "castle", hall: "weir" }] }, { kinds: KINDS }).failures,
  whole: () => deepSpots(deepPlan, { places: [{ id: "x", kind: "den", hall: "weir" }] }, { kinds: KINDS }).failures,
});
broken("deepSpots", "a place in a hall that is not there", {
  said: /the place x: there is no hall nowhere/,
  broken: () => deepSpots(deepPlan, { places: [{ id: "x", kind: "den", hall: "nowhere" }] }, { kinds: KINDS }).failures,
  whole: () => deepSpots(deepPlan, { places: [{ id: "x", kind: "den", hall: "weir" }] }, { kinds: KINDS }).failures,
});
