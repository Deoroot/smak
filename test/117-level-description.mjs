// A level's description checked with no geometry (levels/lib/description*.mjs): the format validated field by
// field; reach, keys before gates, drops that strand, hubs; the graph's loops, dead ends, branches and the share off
// the path; route lengths from size classes and the grid; the pacing curve; bands held; rpg-dungeon-01 passing
// MSR's provisional bands; a co-op style route; and each check failing a description broken in one way.
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test, sure, near, HERE, tmp } from "./helper.mjs";
import { validateDescription, measureDescription, FORMAT } from "../levels/lib/description.mjs";
import { analyseDescription, checkDescription, holdToBand, bandsFromStyle, MSR_EXPLORATION_PROVISIONAL } from "../levels/lib/description-checks.mjs"; // prettier-ignore

const SPEC = join(HERE, "../levels/specs/rpg-dungeon-01.json");
const TOOL = join(HERE, "../levels/tools/check-description.mjs");

/** A small dungeon: a square loop of four rooms (a, b, c, d), a key room off b, a gate from d to the goal. */
const small = () => ({
  format: FORMAT,
  name: "small",
  grid: { cell: 2.5, storey: 3 },
  route: { start: "a", goal: "g", hubs: ["b"] },
  spaces: [
    { id: "a", type: "room", size: "s", pacing: "quiet" },
    { id: "b", type: "room", size: "m", pacing: "fight", encounters: [{ size: "small" }] },
    { id: "k", type: "room", size: "s", key: "red", reward: { kind: "loot" } },
    { id: "c", type: "corridor", size: "m", pacing: "tension" },
    { id: "d", type: "room", size: "s", pacing: "rest" },
    { id: "g", type: "hall", size: "m", pacing: "fight", encounters: [{ size: "boss" }] },
  ],
  links: [
    { from: "a", to: "b", type: "door" },
    { from: "b", to: "c", type: "open" },
    { from: "c", to: "d", type: "open" },
    { from: "d", to: "a", type: "door" },
    { from: "b", to: "k", type: "door" },
    { from: "d", to: "g", type: "gate", key: "red" },
  ],
});
const round3 = (v) => Math.round(v * 1000) / 1000;
const failuresOf = (desc, bands) => checkDescription(desc, bands).failures.join(" | ");

test("a level description: sizes from classes and the grid, links as directed moves, a drop one way", () => {
  const desc = small();
  desc.spaces.push({ id: "p", type: "cave", cells: [2, 3], storey: -1, pacing: "quiet" });
  desc.links.push({ from: "c", to: "p", type: "drop" }, { from: "p", to: "d", type: "stair" });
  sure(!validateDescription(desc).errors.length, validateDescription(desc).errors.join("; "));
  const m = measureDescription(desc);
  const c = m.spaces.get("c");
  sure(
    c.cells.join() === "1,6" && c.area === 37.5 && c.traverse === 15,
    `corridor m: ${c.cells} ${c.area} ${c.traverse}`,
  );
  const b = m.spaces.get("b");
  sure(
    b.traverse === 11.25 && b.weight === 1,
    `room m crossed side to side: ${b.traverse}, weight ${b.weight}`,
  );
  sure(m.spaces.get("p").metres.join() === "5,7.5", "cells given instead of a class");
  sure(m.moves.filter((mv) => mv.type === "drop").length === 1, "a drop is one move, from its top");
  sure(m.moves.length === (desc.links.length - 1) * 2 + 1, `moves ${m.moves.length}`);
});

test("a level description's graph: one loop, a dead end rewarded, branches and the share off the path, the key fetched", () => {
  const a = analyseDescription(small());
  const m = a.metrics;
  sure(
    m.loops === 1 && m.deadEnds === 1 && m.rewardedDeadEndShare === 1,
    `loops ${m.loops}, dead ends ${m.deadEnds}`,
  );
  sure(a.route.walk.join(">") === "a>b>k>b>a>d>g", `walk ${a.route.walk.join(">")}`);
  // traverses: a 7.5, b 11.25, k 7.5, d 7.5, g 17.5 (hall m 6x8 crossed: 7 cells)
  near(
    m.routeLength,
    7.5 + 11.25 + 7.5 + 11.25 + 7.5 + 7.5 + 17.5,
    1e-9,
    "the critical walk, back from the key",
  );
  near(m.directLength, 7.5 + 7.5 + 17.5, 1e-9, "the direct walk, the gate open");
  sure(m.offPathSpaces === 1 && a.offPath[0] === "c", `off the path: ${a.offPath}`);
  near(m.offPathShare, 37.5 / (56.25 + 125 + 56.25 + 37.5 + 56.25 + 300), 1e-3, "off-path share by area");
  sure(m.branches === 2, `branches ${m.branches} (b-c and d-c)`);
  sure(a.hubs.join() === "b,d" && !a.weakHubs.length, `hubs ${a.hubs}`);
  sure(m.storeys === 1 && m.keys === 1 && m.gates === 1, "storeys, keys, gates counted");
  const dropped = small();
  dropped.links[2] = { from: "c", to: "d", type: "drop", height: 1.5 }; // the loop closed only one way
  const d = analyseDescription(dropped).metrics;
  sure(
    d.loops === 0 && d.oneWayLoops === 1,
    `a loop closed by a drop: loops ${d.loops}, one-way ${d.oneWayLoops}`,
  );
});

test("a level description's pacing curve: fights at their first visit as a fraction of the walk, the peak, a rest before it", () => {
  const a = analyseDescription(small());
  sure(a.curve.map((c) => c.id).join() === "b,g", `curve ${JSON.stringify(a.curve)}`);
  near(
    a.curve[0].at,
    (7.5 / 2 + 11.25 / 2 + 7.5 / 2 - 7.5 / 2 + 7.5 / 2) / a.metrics.routeLength,
    1e-3,
    "b's place on the walk",
  );
  sure(a.metrics.peakAt === a.curve[1].at && a.metrics.peakAt > 0.8, `peak at ${a.metrics.peakAt}`);
  sure(a.metrics.restBeforePeak === 1 && a.metrics.maxFightRun === 1, "d rests before the boss");
  sure(a.metrics.lastThirdShare === round3(8 / 9), `last third ${a.metrics.lastThirdShare}`);
});

test("bands held: inside the middle half ok, inside the band an edge, outside a failure; min and max over p5 and p95", () => {
  const band = { p5: 10, q1: 20, median: 30, q3: 40, p95: 50 };
  sure(holdToBand(30, band).verdict === "ok", "30 ok");
  sure(holdToBand(45, band).verdict === "edge", "45 an edge");
  sure(holdToBand(55, band).verdict === "fail" && /above 10\.\.50/.test(holdToBand(55, band).say), holdToBand(55, band).say); // prettier-ignore
  sure(
    holdToBand(5, { min: 8 }).verdict === "fail" && holdToBand(null, band).verdict === "skip",
    "min, and a value not measured",
  );
  const r = checkDescription(small(), {
    metrics: { offPathShare: { max: 0.02, source: "judged" }, spaces: { min: 2 } },
  });
  sure(!r.pass && r.failures.length === 1 && /^offPathShare: 0\.059 above -\.\.0\.02 \(judged\)$/.test(r.failures[0]), r.failures.join(" | ")); // prettier-ignore
  sure(checkDescription(small(), { spaces: { min: 2 } }).pass, "a plain metrics map is a bands object too");
  const style = { style: "dungeon", bands: { crossing: { unit: "m", band: { median: 60, p10: 40, p90: 90 } }, offPathShare: { band: null }, loops: { band: { median: 0, p10: 0, p90: 0 } } } }; // prettier-ignore
  const fromStyle = bandsFromStyle(style);
  sure(Object.keys(fromStyle.metrics).join() === "directLength,loops" && fromStyle.name === "style dungeon", JSON.stringify(fromStyle)); // prettier-ignore
  const held = checkDescription(small(), fromStyle);
  sure(held.failures.join(" | ") === "directLength: 32.5 below 40..90 (style dungeon: crossing) | loops: 1 above 0..0 (style dungeon: loops)", held.failures.join(" | ")); // prettier-ignore
});

test("rpg-dungeon-01 passes MSR's provisional bands: two hubs, two keys before their gates, loops, rewarded dead ends, a late peak", () => {
  const desc = JSON.parse(readFileSync(SPEC, "utf8"));
  const r = checkDescription(desc, MSR_EXPLORATION_PROVISIONAL);
  sure(r.pass, r.failures.join(" | "));
  const { metrics: m, route } = r.analysis;
  sure(
    m.loops >= 1 && m.gates >= 1 && m.keys >= 1 && m.drops >= 1,
    `loops ${m.loops}, gates ${m.gates}, drops ${m.drops}`,
  );
  sure(
    m.deadEnds >= 3 && m.rewardedDeadEndShare === 1,
    `dead ends ${m.deadEnds}, ${m.rewardedDeadEndShare} rewarded`,
  );
  sure(
    route.walk.indexOf("scriptorium") < route.walk.indexOf("great_stair"),
    "the iron key before the stair down",
  );
  sure(
    route.walk.indexOf("embalming_room") < route.walk.indexOf("antechamber"),
    "the crypt seal before the tomb",
  );
  sure(m.peakAt > 0.9 && m.restBeforePeak === 1, `peak at ${m.peakAt}`);
  sure(
    r.results.every((x) => x.verdict !== "fail" && x.verdict !== "skip"),
    "every band measured and held",
  );
  sure(r.analysis.reach.secretOnly.join() === "treasury", "the treasury is the one hidden space");
});

test("a co-op style route: one way start to end, side areas off it, one-way drops that strand no one, the crescendo last", () => {
  const spaces = ["street", "alley", "market", "sewer", "tunnel", "yard", "gatehouse"].map((id, i) => ({
    id, type: i % 2 ? "corridor" : "yard", size: "m", storey: id === "sewer" || id === "tunnel" ? -1 : 0,
    pacing: ["quiet", "tension", "fight", "tension", "fight", "rest", "fight"][i],
    encounters: [[], [], [{ size: "medium" }], [], [{ size: "large" }], [], [{ size: "boss" }, { size: "small", count: 4 }]][i],
  })); // prettier-ignore
  spaces.push({ id: "shop", type: "room", size: "s", storey: 0, reward: { kind: "supplies" } });
  spaces.push({ id: "cellar", type: "room", size: "s", storey: -1, reward: { kind: "tome" } });
  const desc = {
    format: FORMAT, name: "coop", grid: { cell: 2.5, storey: 3 }, route: { start: "street", goal: "gatehouse" }, spaces,
    links: [
      { from: "street", to: "alley", type: "open" }, { from: "alley", to: "market", type: "open" },
      { from: "market", to: "sewer", type: "drop" }, { from: "sewer", to: "tunnel", type: "open" },
      { from: "tunnel", to: "yard", type: "stair", oneWay: true }, { from: "yard", to: "gatehouse", type: "open" },
      { from: "market", to: "shop", type: "door" }, { from: "sewer", to: "cellar", type: "door" },
    ],
  }; // prettier-ignore
  const coop = { metrics: { loops: { max: 0 }, offPathShare: { min: 0.05, max: 0.4 }, peakAt: { min: 0.85 }, lastThirdShare: { min: 0.5 } } }; // prettier-ignore
  const r = checkDescription(desc, coop);
  sure(r.pass, r.failures.join(" | "));
  sure(
    r.analysis.metrics.drops === 1 && r.analysis.offPath.sort().join() === "cellar,shop",
    `off ${r.analysis.offPath}`,
  );
  desc.spaces.push({ id: "well", type: "room", size: "s", storey: -1 });
  desc.links.push({ from: "yard", to: "well", type: "drop" }); // a second drop, into a room with no way on
  sure(
    /stranded: a player in well can no longer reach the goal/.test(failuresOf(desc, coop)),
    failuresOf(desc, coop),
  );
});

test("a level description broken in one way fails by its sentence", () => {
  const broken = (change) => {
    const d = small();
    change(d);
    return failuresOf(d);
  };
  const cases = [
    [
      (d) => (d.links[0].to = "nowhere"),
      /invalid: links\[0\] \(a -> nowhere\)\.to: "nowhere" is no space's id/,
    ],
    [(d) => (d.spaces[0].type = "arena"), /invalid: spaces\[0\] \(a\)\.type: wanted one of room/],
    [(d) => (d.spaces[1].encounters = []), /invalid: spaces\[1\] \(b\)\.encounters: a fight space wants/],
    [(d) => delete d.links[5].key, /invalid: links\[5\] \(d -> g\)\.key: a gate wants the name of its key/],
    [(d) => (d.links[5].key = "blue"), /"blue" is no space's key/],
    [(d) => (d.spaces[3].storey = 1), /a open joins spaces of one storey \(0 and 1\); use a stair or a drop/],
    [(d) => d.links.push({ from: "a", to: "c", type: "drop" }), /a drop goes to a lower storey \(0 to 0\)/],
    [(d) => (d.format = "x"), /invalid: format: wanted "smak-level-description\/1"/],
    [
      (d) => d.spaces.push({ id: "lost", type: "room", size: "s" }),
      /^unreached: lost cannot be reached from the start$/,
    ],
    [
      (d) => (d.links[5].type = "secret") && delete d.links[5].key,
      /goal: g is reached only through a secret/,
    ],
    [(d) => d.links.splice(4, 1, { from: "g", to: "k", type: "door" }), /keys: key "red" \(in k\) lies behind its own gate/], // prettier-ignore
    [(d) => d.spaces.push({ id: "pit", type: "cave", size: "s", storey: -1 }) && d.links.push({ from: "c", to: "pit", type: "drop" }), /^stranded: a player in pit can no longer reach the goal$/], // prettier-ignore
    [(d) => d.route.hubs.push("k"), /hubs: k is named a hub but has 1 neighbour \(a hub wants 3\)/],
  ];
  for (const [change, sentence] of cases) {
    const said = broken(change);
    sure(sentence.test(said), `wanted ${sentence}, got: ${said || "PASS"}`);
  }
  sure(checkDescription(small()).pass, "and the small dungeon whole passes");
});

test("check-description: PASS in one line on rpg-dungeon-01 with its style's bands, FAIL with the reason and exit 1", () => {
  const ok = spawnSync(process.execPath, [TOOL, SPEC], { encoding: "utf8" });
  sure(ok.status === 0 && /^PASS {2}rpg-dungeon-01: \d+ spaces/.test(ok.stdout), ok.stdout + ok.stderr);
  sure(
    ok.stdout.trim().split("\n").length <= 5 && /msr-exploration \(provisional\)/.test(ok.stdout),
    ok.stdout,
  );
  const bad = small();
  bad.spaces.push({ id: "lost", type: "room", size: "s" });
  const file = join(tmp, "broken-description.json");
  writeFileSync(file, JSON.stringify(bad));
  const no = spawnSync(process.execPath, [TOOL, file, "--bands", "none"], { encoding: "utf8" });
  sure(
    no.status === 1 && /^FAIL/.test(no.stdout) && /unreached: lost/.test(no.stdout),
    no.stdout + no.stderr,
  );
});
