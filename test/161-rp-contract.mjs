// The RP contract of a site (levels/rp/contract.mjs, levels/rp/CONTRACT.md): mese-01 planned and assembled, its
// contract read: every named door in one property and only one, each property of a kind the contract knows, the shops
// and the flats where the plan has them, the places in rooms of their kind, the roaming spots on public floor, and the
// roambots' file a line a spot; with a level below (test/fixtures/mese-01-below.json), spots on its walkways clear of
// its ways down, and the place a part is. And its `paths`, the walking graph (levels/rp/paths.mjs): a node for every
// place and every roaming spot, links that exist, every place reached from every other, each way down joining the
// streets to the level below by itself, the points inside +-4096; the .rcw written from it (RCBot's waypoints) read back
// whole, both ways a path, the goals first, a ladder's flags only where its lid is let through.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test, sure, sureEach, HERE } from "./helper.mjs";
import { planSite, assembleSite, siteSpec, PUBLIC } from "../levels/assembly/site.mjs";
import { loadLibrary } from "../levels/assembly/library.mjs";
import { loadStyle } from "../levels/assembly/style.mjs";
import { rpContract, roamspotsCfg, breakablesOf, checkRewards, MAX_REWARD_MONEY, RP_FORMAT } from "../levels/rp/contract.mjs";
import { checkPaths, rcwOf, componentsOf } from "../levels/rp/paths.mjs";
import { readRcw, writeRcw, RCW_FLAGS, RCBOT_MOST_WAYPOINTS } from "../src/maps/rcbot.mjs";

const plan = planSite(siteSpec("mese-01"));
const built = assembleSite(plan, loadLibrary(join(HERE, "../levels/assembly/pieces/mese")), { style: loadStyle("mese") });
const contract = rpContract(plan, built);
const KINDS = new Set(["home", "shop", "public", "jail", "hideout", "police", "other"]);

test("rp contract: every named door in one property, each of a kind the contract knows", () => {
  sure(contract.format === RP_FORMAT && contract.map === plan.site.name && contract.build === null, `head: ${contract.format} ${contract.map}`); // prettier-ignore
  const named = new Set(built.report.doorways.map((d) => d.targetname).filter(Boolean));
  const listed = contract.properties.flatMap((p) => p.doors);
  sure(listed.length === new Set(listed).size, "a door in two properties");
  sure(named.size === listed.length && [...named].every((n) => listed.includes(n)), `doors: ${named.size} named, ${listed.length} listed`);
  sureEach(contract.properties, "the properties", (p) => sure(KINDS.has(p.kind), `${p.id}: kind ${p.kind}`));
  const kinds = (k) => contract.properties.filter((p) => p.kind === k).length;
  sure(kinds("shop") === 5 && kinds("home") === 10, `shops ${kinds("shop")}, homes ${kinds("home")}`);
});

test("rp contract: places in rooms of their kind, roaming spots on public floor, the roambots' file", () => {
  sureEach(contract.places, "the places", (p) => {
    const [x, y] = [Math.floor(p.at[0] / 64), Math.floor(p.at[1] / 64)];
    sure(plan.cells[y]?.[x] === `building ${p.building}`, `${p.id} at ${p.at}: on ${plan.cells[y]?.[x]}`);
  });
  sureEach(contract.roam, "the roaming spots", (r) => {
    const v = plan.cells[Math.floor(r.at[1] / 64)]?.[Math.floor(r.at[0] / 64)];
    sure(PUBLIC.has(v) && r.at[2] === 0, `a spot at ${r.at} on ${v}`);
  });
  const lines = roamspotsCfg(contract).trim().split("\n");
  sure(lines.length === contract.roam.length + 1 && lines.slice(1).every((l) => /^roamspot \S+ -?\d+(\.\d+)? -?\d+(\.\d+)? \d+$/.test(l)), lines.slice(0, 3).join(" | ")); // prettier-ignore
});

test("rp contract: a level below roamed on its walkways, clear of its ways down; a part that is a place", () => {
  const below = JSON.parse(readFileSync(join(HERE, "fixtures/mese-01-below.json"), "utf8"));
  below.parts = below.parts.map((p) => (p.id === "foot" ? { ...p, place: "den" } : p));
  const p = planSite({ ...siteSpec("mese-01"), below });
  const b = assembleSite(p, loadLibrary(join(HERE, "../levels/assembly/pieces/mese")), { style: loadStyle("mese") });
  const c = rpContract(p, b);
  const spots = c.roam.filter((r) => r.district === "below");
  const clear = new Set(b.report.below.keepClear);
  sure(spots.length >= 5, `${spots.length} spots below`);
  sureEach(spots, "the spots below", (r) => {
    const k = `${Math.floor(r.at[0] / 64)},${Math.floor(r.at[1] / 64)}`;
    sure(r.at[2] === p.below.floor && p.below.cells.get(k)?.kind === "walk" && !clear.has(k), `a spot at ${r.at}: ${p.below.cells.get(k)?.kind}${clear.has(k) ? ", by a way down" : ""}`); // prettier-ignore
  });
  sure(spots.every((r, i) => spots.every((q, j) => i === j || Math.max(Math.abs(r.at[0] - q.at[0]), Math.abs(r.at[1] - q.at[1])) >= 4 * 64)), "two spots below closer than 4 cells"); // prettier-ignore
  const place = c.places.find((q) => q.id === "below_foot");
  sure(place?.kind === "den" && p.below.cells.get(`${Math.floor(place.at[0] / 64)},${Math.floor(place.at[1] / 64)}`)?.part === "foot", `the foot's place: ${JSON.stringify(place)}`); // prettier-ignore
  const lines = roamspotsCfg(c).trim().split("\n").filter((l) => l.startsWith("roamspot below"));
  sure(lines.length === spots.length && lines.every((l) => / -348$/.test(l)), lines.slice(0, 2).join(" | "));
});

test("rp contract: breakables, the keys of each destroy target as the compiled map holds them", () => {
  sure(Array.isArray(contract.breakables) && contract.breakables.length === 0, "a site with no missions has an empty list");
  const ents = [[["classname", "worldspawn"]], [["classname", "func_breakable"], ["targetname", "crate"], ["model", "*3"], ["health", 30]], [["classname", "func_door"], ["targetname", "door"], ["model", "*4"]]]; // prettier-ignore
  const missions = [{ steps: [{ do: "reach", target: "door" }, { do: "destroy", target: "crate" }] }, { steps: [{ do: "destroy", target: "crate" }] }]; // prettier-ignore
  const got = breakablesOf(missions, ents);
  sure(JSON.stringify(got) === JSON.stringify([{ name: "crate", keys: { classname: "func_breakable", targetname: "crate", model: "*3", health: "30" } }]), JSON.stringify(got)); // prettier-ignore
  let said = "";
  try { breakablesOf([{ steps: [{ do: "destroy", target: "ghost" }] }], ents); } catch (e) { said = e.message; }
  sure(/ghost/.test(said), `a destroy target the map lacks must be an error: ${said}`);
});

// ── the walking graph ──
const withBelow = () => {
  const below = JSON.parse(readFileSync(join(HERE, "fixtures/mese-01-below.json"), "utf8"));
  const p = planSite({ ...siteSpec("mese-01"), below });
  const b = assembleSite(p, loadLibrary(join(HERE, "../levels/assembly/pieces/mese")), { style: loadStyle("mese") });
  return { p, b, c: rpContract(p, b) };
};
const lower = withBelow();

test("rp paths: a node for every place and roaming spot, links that exist, every point inside +-4096", () => {
  for (const [name, c] of [["the street", contract], ["the street and its level below", lower.c]]) {
    const ids = new Set(c.paths.nodes.map((n) => n.id));
    sure(ids.size === c.paths.nodes.length, `${name}: two nodes with one id`);
    sureEach(c.paths.links, `${name}: the links`, (l) => sure(ids.has(l.a) && ids.has(l.b) && l.a !== l.b && ["walk", "stair", "ladder", "jump-down"].includes(l.how), `a link ${l.a} ${l.b} ${l.how}`)); // prettier-ignore
    sureEach(c.paths.nodes, `${name}: the nodes`, (n) => sure(n.at.every((v) => Math.abs(v) <= 4096) && n.at.length === 3 && n.kind, `node ${n.id} at ${n.at}`)); // prettier-ignore
    sureEach(c.places, `${name}: the places`, (p) => {
      const n = c.paths.nodes.find((q) => q.place === p.id);
      sure(n && Math.hypot(n.at[0] - p.at[0], n.at[1] - p.at[1]) <= 192 && Math.abs(n.at[2] - 36 - p.at[2]) <= 1, `${p.id} at ${p.at}: node ${n?.id} at ${n?.at}`); // prettier-ignore
    });
    c.roam.forEach((r, i) => {
      const n = c.paths.nodes.filter((q) => q.roam === i);
      sure(n.length === 1 && n[0].at[0] === r.at[0] && n[0].at[1] === r.at[1] && n[0].at[2] === r.at[2] + 36, `roaming spot ${i} at ${r.at}: ${JSON.stringify(n.map((q) => q.at))}`); // prettier-ignore
    });
    const answer = checkPaths(c.paths, c);
    sure(answer.failures.length === 0, `${name}: ${answer.failures.join(" | ")}`);
    sure(componentsOf(c.paths).length === 1, `${name}: ${componentsOf(c.paths).length} pieces`);
  }
  const doors = contract.paths.nodes.filter((n) => n.gate === "door");
  sure(doors.length >= 20 && doors.every((n) => n.door), `${doors.length} thresholds, ${doors.filter((n) => !n.door).length} unnamed`); // prettier-ignore
  const stairs = contract.paths.links.filter((l) => l.how === "stair");
  sure(stairs.length === 2 * 5 || stairs.length >= 5, `${stairs.length} stair links`);
});

test("rp paths: every way down joins the streets to the level below by itself", () => {
  const { c, p } = lower;
  sure(c.paths.ways.length === p.below.ways.length && c.paths.ways.length === 3, `${c.paths.ways.length} ways`);
  const answer = checkPaths(c.paths, c);
  sure(answer.failures.length === 0, answer.failures.join(" | "));
  sure(c.paths.ways.map((w) => w.kind).sort().join() === "drain,manhole,stair", c.paths.ways.map((w) => w.kind).join());
  const ladders = c.paths.links.filter((l) => l.how === "ladder");
  sure(ladders.length === 2 && ladders.map((l) => l.gate).sort().join() === "grate,lid", JSON.stringify(ladders));
  const sewer = c.paths.nodes.filter((n) => n.district === "below");
  sure(sewer.length >= 8 && sewer.every((n) => n.at[2] >= p.below.floor + 36 && n.at[2] <= 36), `${sewer.length} nodes below`);
});

test("rp paths: RCBot's file from the graph, read back whole", () => {
  for (const c of [contract, lower.c]) {
    const r = rcwOf(c.paths, { mapName: c.map });
    const back = readRcw(r.bytes);
    sure(back.mapName === c.map && back.waypoints.length === r.waypoints.length && back.waypoints.length <= RCBOT_MOST_WAYPOINTS && back.waypoints.length > 20, `${back.mapName}: ${back.waypoints.length} waypoints`); // prettier-ignore
    back.waypoints.forEach((w, i) => {
      sure(w.paths.every((to) => to >= 0 && to < back.waypoints.length && back.waypoints[to].paths.includes(i)), `waypoint ${i}: a path with no way back`); // prettier-ignore
      sure(w.origin.every((v) => Math.abs(v) < 4096), `waypoint ${i} at ${w.origin}`);
    });
    // the goals first: the bots pick among the first 50
    const goal = (w) => { const n = c.paths.nodes.find((q) => q.id === w.id); return n.roam !== undefined || n.kind === "place"; }; // prettier-ignore
    const first = r.waypoints.slice(0, Math.min(50, r.waypoints.filter(goal).length));
    sure(first.length > 10 && first.every(goal), `the first ${first.length} are not all goals`);
  }
  const shut = rcwOf(lower.c.paths, { mapName: lower.c.map });
  sure(shut.waypoints.every((w) => !(w.flags & RCW_FLAGS.LADDER)), "a ladder in a file that lets no lid through");
  const open = rcwOf(lower.c.paths, { mapName: lower.c.map, gates: ["gate", "lid", "grate"] });
  sure(open.waypoints.filter((w) => w.flags & RCW_FLAGS.LADDER).length === 4 && open.facts.paths === shut.facts.paths + 4, `${open.facts.ladders} ladder waypoints, ${open.facts.paths} paths against ${shut.facts.paths}`); // prettier-ignore
  sure(readRcw(open.bytes).waypoints.length === open.waypoints.length, "the open file");
});

test("rp paths: crouch, jump and ladder flags where a node or a link says so", () => {
  const paths = {
    nodes: [
      { id: "a", at: [0, 0, 36], kind: "street", roam: 0 },
      { id: "b", at: [100, 0, 36], kind: "street", crouch: true },
      { id: "c", at: [200, 0, 0], kind: "street" },
      { id: "d", at: [300, 0, 36], kind: "ladder" },
      { id: "e", at: [300, 0, 300], kind: "hatch" },
    ],
    links: [
      { a: "a", b: "b", how: "walk" },
      { a: "b", b: "c", how: "jump-down", oneWay: true },
      { a: "c", b: "d", how: "walk" },
      { a: "d", b: "e", how: "ladder" },
    ],
    ways: [],
  };
  const r = rcwOf(paths, { mapName: "x" });
  const byId = Object.fromEntries(r.waypoints.map((w) => [w.id, w]));
  sure(byId.b.flags & RCW_FLAGS.CROUCH && byId.b.origin[2] === 18 && byId.b.flags & RCW_FLAGS.JUMP, `b ${byId.b.flags} ${byId.b.origin}`); // prettier-ignore
  sure(byId.d.flags & RCW_FLAGS.LADDER && byId.e.flags & RCW_FLAGS.LADDER && !(byId.a.flags & RCW_FLAGS.LADDER), "ladder flags");
  const to = (id) => r.waypoints.indexOf(byId[id]);
  sure(byId.c.paths.includes(to("d")) && !byId.c.paths.includes(to("b")) && byId.b.paths.includes(to("c")), "a one-way link goes one way");
  sure(writeRcw(r.waypoints, { mapName: "x" }).length > 52, "written");
});

test("rp contract: a mission's reward.money is optional, an integer from 0 to the ceiling; frags stay", () => {
  const one = (reward) => [{ id: "m", steps: [], done: { reward } }];
  sure(checkRewards([]).length === 0 && checkRewards(one(undefined)).length === 0, "no reward is fine");
  sure(checkRewards(one({ frags: 2 })).length === 0, "frags alone (a contract from before money) is fine");
  sure(checkRewards(one({ frags: 1, money: 150 })).length === 0 && checkRewards(one({ money: 0 })).length === 0, "money with frags, or zero");
  sure(checkRewards(one({ money: MAX_REWARD_MONEY })).length === 0, "the ceiling itself");
  for (const bad of [-1, 1.5, "100", null, MAX_REWARD_MONEY + 1])
    sure(checkRewards(one({ money: bad })).length === 1, `money ${JSON.stringify(bad)} is refused`);
  sure(checkRewards(one({ frags: -1 })).length === 1, "negative frags are refused");
});
