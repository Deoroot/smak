// The map generator's first stages (levels/experimental-city/, levels/tools/generate.mjs): New Byzantium's Core tile (c1_r1) run
// through stage 0 (the description and the rulebook), 1 (the site), 2 (blocks and lots) and 4 (connectors,
// checkpoints, the MSR's hallways, spawns). The Core passes every gate; the same inputs give the same bytes; a
// stale artifact is refused when a run resumes; each gate fails a broken copy with the sentence that names the thing.
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { testAsync, sure, HERE, tmp } from "./helper.mjs";
import { runGenerator, regate } from "../levels/experimental-city/runner.mjs";

const SPEC = join(HERE, "../levels/specs/newbyzantium.json");
const TOOL = join(HERE, "../levels/tools/generate.mjs");
const city = () => JSON.parse(readFileSync(SPEC, "utf8"));
const FILES = ["00-description.json", "01-site.json", "02-lots.json", "04-network.json"];
const read = (dir, f) => JSON.parse(readFileSync(join(dir, f), "utf8"));
const copy = (v) => JSON.parse(JSON.stringify(v));
const OUT = join(tmp, "gen-core");
let base = null; // the Core's artifacts, made once

/** The artifacts' inputs for a gate, with the description (in 00) changed by `edit`. */
const inputsWith = (edit = () => {}) => {
  const d0 = copy(base["00-description.json"]);
  edit(d0.description);
  return { "00-description.json": d0, "01-site.json": base["01-site.json"], "02-lots.json": base["02-lots.json"] };
};
const gateSays = async (name, artifact, inputs, ...words) => {
  const v = await regate(name, artifact, { inputs });
  const hit = v.failures.find((f) => words.every((w) => f.includes(w)));
  sure(hit, `the ${name} gate did not say ${JSON.stringify(words)}; it said: ${v.failures.slice(0, 4).join(" | ") || "nothing (it passed)"}`);
};

await testAsync("generator: New Byzantium's Core tile passes stages 0, 1, 2 and 4", "gen core", async () => {
  const res = await runGenerator({ desc: city(), out: OUT, tile: "c1_r1", until: 4 });
  sure(res.ok, `stopped: ${res.refused ?? JSON.stringify(res.stopped)}`);
  // stage 3 (building programs) is another's and may be registered too: 0, 1, 2 and 4 must be among those run
  sure([0, 1, 2, 4].every((n) => res.results.some((r) => r.n === n && r.pass)), `stages run ${res.results.map((r) => r.n)}`);
  base = Object.fromEntries(FILES.map((f) => [f, read(OUT, f)]));
  for (const f of FILES) {
    const a = base[f];
    sure(a.format === "smak-gen/1" && a.gate.pass && a.params.tile === "c1_r1", `${f}: ${JSON.stringify(a.gate)}`);
    sure(Object.values(a.inputs).every((h) => /^[0-9a-f]{64}$/.test(h)), `${f} inputs ${JSON.stringify(a.inputs)}`);
  }
  sure(base["01-site.json"].inputs["00-description.json"] && base["04-network.json"].inputs["02-lots.json"], "the inputs name the artifacts read");
  const site = base["01-site.json"];
  sure(site.layers.map((L) => L.id).join() === "L1,L2,L3", `layers ${site.layers.map((L) => L.id)}`);
  sure(site.ways.every((w) => w.parts.length && w.parts.every((p) => p.length >= 2)), "a way with no polyline");
  sure(site.ways.find((w) => w.id === "s3_north").portico === 2 && site.ways.find((w) => w.id === "s3_north").carriageway === 4, "the Mese's portico and carriageway"); // prettier-ignore
  sure(site.portals.some((p) => p.id === "p_s3_north" && p.seam === "c1_r1|c1_r2"), "the Mese's portal north");
  // the lots: only the description's enterable buildings, the rest facades, within the budget
  const lots = base["02-lots.json"];
  const ent = lots.lots.filter((l) => l.kind === "enterable");
  const want = city().buildings.filter((b) => b.interior && b.at[0] >= 40 && b.at[0] < 80 && b.at[1] >= 40 && b.at[1] < 80).map((b) => b.id).sort(); // prettier-ignore
  sure(ent.map((l) => l.building).sort().join() === want.join(), `enterable ${ent.map((l) => l.building)} against ${want}`);
  sure(lots.measures.enterableShare <= 0.35 && lots.measures.facades >= 2 * ent.length, JSON.stringify(lots.measures));
  for (const l of ent) {
    for (const k of ["id", "building", "tile", "layer", "rect", "frontage", "zBase", "storeys", "storeyHeight_m"]) sure(l[k] !== undefined, `${l.id} has no ${k}`); // prettier-ignore
    sure(["x", "y", "w", "d"].every((k) => Number.isInteger(l.rect[k] * 2)), `${l.id}'s rect off the half cell ${JSON.stringify(l.rect)}`);
    sure("nsew".includes(l.frontage.side) && l.frontage.door.at >= 0 && l.frontage.door.width_m > 1, `${l.id}'s door ${JSON.stringify(l.frontage)}`); // prettier-ignore
  }
  sure(lots.lots.filter((l) => l.kind === "facade").every((l) => l.facade.storeys >= 1 && l.facade.kind && l.facade.variant >= 0), "a facade with no kind or height"); // prettier-ignore
  // the network: every connector of the tile placed, the spine through three layers, the gates, the spawns
  const net = base["04-network.json"];
  sure(net.connectors.every((c) => !c.unplaced && c.pieces.length && c.exits.length), "a connector unplaced");
  const spine = net.connectors.find((c) => c.id === "c_spine_stair");
  sure(spine.form === "switchback" && spine.exits.map((e) => e.layer).join() === "L1,L2,L3" && spine.dims.fits.length === 0, `spine ${JSON.stringify(spine.exits)}`); // prettier-ignore
  sure(net.connectors.find((c) => c.id === "c32_forum_stair_w").form === "switchback", "the Forum Stair west is a well in the Forum's north portico (on the axes since the R1 review)");
  const forum = net.checkpoints.find((k) => k.id === "cp2_forum");
  sure(forum.rooms.filter((r) => r.kind === "gate").length === 3 && forum.rooms.some((r) => r.kind === "holding-cell"), JSON.stringify(forum.rooms.map((r) => r.kind))); // prettier-ignore
  sure(net.hallways.every((h) => !h.unrouted && h.runs.every((r) => r <= 24)), "a hallway unrouted or a run over 24");
  sure(net.spawns.length >= net.measures.spawns.target && net.measures.spawns.target > 0, JSON.stringify(net.measures.spawns));
  sure(net.spawns.every((s) => s.layer !== "L3"), "a spawn past the checkpoints, on the gated upper city");
  const w = net.measures.walk;
  sure(w.p90 <= 14 && w.maxWalk.distance <= 20 && !w.unreached.length, JSON.stringify(w));
});

await testAsync("generator: the same description, tile and seed give the same bytes; the command line agrees", "gen same bytes", async () => {
  const again = join(tmp, "gen-core-again");
  const res = await runGenerator({ desc: city(), out: again, tile: "c1_r1", until: 4 });
  sure(res.ok, "the second run stopped");
  for (const f of FILES) sure(readFileSync(join(OUT, f), "utf8") === readFileSync(join(again, f), "utf8"), `${f} differs between two runs`);
  const cli = join(tmp, "gen-core-cli");
  const r = spawnSync(process.execPath, [TOOL, SPEC, "--tile", "c1_r1", "--until", "4", "--out", cli], { encoding: "utf8" });
  sure(r.status === 0 && /PASS {2}stage 4 network/.test(r.stdout), `generate: ${r.status} ${r.stdout}${r.stderr}`);
  for (const f of FILES) sure(readFileSync(join(OUT, f), "utf8") === readFileSync(join(cli, f), "utf8"), `${f} differs from the command line's`);
  const seeded = join(tmp, "gen-core-seed2");
  await runGenerator({ desc: city(), out: seeded, tile: "c1_r1", until: 2, seed: 2 });
  sure(read(seeded, "02-lots.json").params.seed === 2, "the seed is recorded");
  const bad = spawnSync(process.execPath, [TOOL, SPEC], { encoding: "utf8" });
  sure(bad.status === 2 && /usage/.test(bad.stderr), "no --out: a usage line and exit 2");
});

await testAsync("generator: resuming refuses a stale artifact, by the input that changed", "gen stale", async () => {
  // another description: stage 0's own input changed
  const d = city();
  d.spawns.count = 73;
  let res = await runGenerator({ desc: d, out: OUT, tile: "c1_r1", from: 4, until: 4 });
  sure(!res.ok && /00-description\.json is stale: it was made from description [0-9a-f]{12}, description is now [0-9a-f]{12}/.test(res.refused), `refused: ${res.refused}`); // prettier-ignore
  // an artifact changed after the one that read it
  const dir = join(tmp, "gen-stale");
  await runGenerator({ desc: city(), out: dir, tile: "c1_r1", until: 4 });
  const site = read(dir, "01-site.json");
  site.ways[0].width += 1;
  writeFileSync(join(dir, "01-site.json"), `${JSON.stringify(site, null, 1)}\n`);
  res = await runGenerator({ desc: city(), out: dir, tile: "c1_r1", from: 4, until: 4 });
  sure(!res.ok && /02-lots\.json is stale: its input 01-site\.json changed after it was made/.test(res.refused), `refused: ${res.refused}`); // prettier-ignore
  // other parameters
  res = await runGenerator({ desc: city(), out: OUT, tile: "c1_r1", from: 4, until: 4, seed: 9 });
  sure(!res.ok && /was made with .*"seed":1.*this run is .*"seed":9/.test(res.refused), `refused: ${res.refused}`);
  // fresh: resuming at 4 reads 0-2 back and makes 4 again, byte for byte
  res = await runGenerator({ desc: city(), out: OUT, tile: "c1_r1", from: 4, until: 4 });
  sure(res.ok && res.results.filter((r) => r.reused).length === res.results.filter((r) => r.n < 4).length && res.results.find((r) => r.n === 4 && !r.reused), `resume: ${res.refused ?? JSON.stringify(res.results.map((r) => [r.n, r.reused]))}`); // prettier-ignore
  sure(readFileSync(join(OUT, "04-network.json"), "utf8") === readFileSync(join(tmp, "gen-core-again", "04-network.json"), "utf8"), "resumed 04 differs"); // prettier-ignore
});

await testAsync("generator: stages 0 and 1 fail a broken description or site by the sentence naming it", "gen gates 0-1", async () => {
  const d = city();
  d.tiles.portals = d.tiles.portals.filter((p) => p.id !== "p_s3_north");
  let res = await runGenerator({ desc: d, out: join(tmp, "gen-broken-0"), tile: "c1_r1" });
  sure(res.stopped?.n === 0 && res.stopped.failures.some((f) => f.startsWith("description: tiles: s3_north crosses the seam")), JSON.stringify(res.stopped)); // prettier-ignore
  res = await runGenerator({ desc: city(), out: join(tmp, "gen-broken-0b"), tile: "c7_r1" });
  sure(res.stopped?.n === 0 && res.stopped.failures.some((f) => f.includes("tile c7_r1 is outside the 3 x 3 tiles")), JSON.stringify(res.stopped)); // prettier-ignore
  // a plaza across the seam (the Bazaar's square where it stood before 2026-11-01): check-city passes, the site does not
  const p = city();
  p.streets.nodes.find((n) => n.id === "n2_bazaar").at = [60, 46];
  res = await runGenerator({ desc: p, out: join(tmp, "gen-broken-1"), tile: "c1_r1" });
  sure(res.stopped?.n === 1 && res.stopped.failures.some((f) => f.includes("plaza n2_bazaar (14x14) reaches 1 cells across the edge of c1_r1")), JSON.stringify(res.stopped)); // prettier-ignore
  const site = copy(base["01-site.json"]);
  site.ways.find((w) => w.id === "s3_north").caps[0].portal = null;
  await gateSays("site", site, inputsWith(), "way s3_north crosses the seam c1_r1|c1_r2", "with no portal there");
  const crossing = copy(base["01-site.json"]);
  crossing.ways.push({ ...copy(crossing.ways.find((w) => w.id === "s2_av_hearth")), id: "s2_cross", from: "x", to: "y", parts: [[[50, 60], [70, 60]]], caps: [] }); // prettier-ignore
  await gateSays("site", crossing, inputsWith(), "ways s2_av_hearth and s2_cross cross at [60,");
  await gateSays("site", copy(base["01-site.json"]), inputsWith((x) => (x.rules.space.maxStraightRun = 10)), "s1_main on L1 runs straight 21 cells", "at most 10");
});

await testAsync("generator: stage 2 fails placement and the budget by the sentence naming the lot", "gen gates 2", async () => {
  const into = copy(base["02-lots.json"]);
  into.lots.find((l) => l.id === "lot_msr_precinct").rect.x -= 3; // into the Hearth avenue
  await gateSays("lots", into, inputsWith(), "placement: lot_msr_precinct (msr_precinct) stands", "into avenue s2_av_hearth");
  const door = copy(base["02-lots.json"]);
  const t = door.lots.find((l) => l.id === "lot_hearth_terrace");
  t.frontage.side = "n";
  await gateSays("lots", door, inputsWith(), "placement: lot_hearth_terrace (hearth_terrace)'s door is", "from its frontage s2_hearth_w, at most 1");
  const outside = copy(base["02-lots.json"]);
  outside.lots.find((l) => l.id === "lot_drains_cutter").rect.x = 76; // past the Drains' east edge (75)
  await gateSays("lots", outside, inputsWith(), "lot_drains_cutter (drains_cutter) reaches 5 cells outside its district d1_drains");
  const extra = copy(base["02-lots.json"]);
  const f = extra.lots.find((l) => l.kind === "facade" && l.layer === "L2");
  Object.assign(f, { kind: "enterable", building: "a_shop_nobody_named" });
  await gateSays("lots", extra, inputsWith(), `lots: ${f.id} is enterable but the description names no enterable building a_shop_nobody_named`); // prettier-ignore
  await gateSays("lots", copy(base["02-lots.json"]), inputsWith((x) => (x.rules.buildings.maxEnterableLotShare = 0.05)), "budget: 9 of", "lots in c1_r1 are enterable", "at most 5 %"); // prettier-ignore
  await gateSays("lots", copy(base["02-lots.json"]), inputsWith((x) => (x.rules.buildings.maxEnterablePerLayer = 4)), "budget: L2 has 5 enterable lots in c1_r1, at most 4"); // prettier-ignore
  const overlap = copy(base["02-lots.json"]);
  const facade = overlap.lots.find((l) => l.kind === "facade" && l.layer === "L1");
  overlap.lots.find((l) => l.id === "lot_drains_pawn").rect = { ...facade.rect };
  await gateSays("lots", overlap, inputsWith(), `lots: lot_drains_pawn and ${facade.id} overlap`);
});

await testAsync("generator: stage 4 fails the walk, the gated arrival, an overlap, the spawns and a run by the sentence naming them", "gen gates 4", async () => {
  const net = () => copy(base["04-network.json"]);
  await gateSays("network", net(), inputsWith((x) => (x.rules.connectors.p90Walk = 5)), "walk: the p90 walk from c1_r1's public floor to a public connector is", "on the real footprints, at most 5 (p90Walk)"); // prettier-ignore
  await gateSays("network", net(), inputsWith((x) => (x.rules.connectors.maxWalk = 3)), "walk: on L2", "cells from a public connector on the real footprints, at most 3 (maxWalk)"); // prettier-ignore
  const open = net();
  const forum = open.checkpoints.find((k) => k.id === "cp2_forum");
  forum.rooms = forum.rooms.filter((r) => r.fronts !== "c32_forum_lift");
  await gateSays("network", open, inputsWith(), "gated: cp2_forum has no gate room over c32_forum_lift's exit at n2_lift_n");
  const uncontrolled = inputsWith((x) => (x.checkpoints.find((k) => k.id === "cp2_forum").controls = ["c32_forum_stair_w", "c32_forum_stair_e"])); // prettier-ignore
  await gateSays("network", net(), uncontrolled, "gated: c32_forum_lift arrives on the gated layer L3 at n3_mese_n and no checkpoint controls it");
  const moved = net();
  const well = moved.connectors.find((c) => c.id === "c32_ascent").pieces.find((p) => p.kind === "well");
  well.poly = [[66, 46], [70, 46], [70, 49], [66, 49]]; // into the Bazaar Hall
  await gateSays("network", moved, inputsWith(), "overlap: c32_ascent's well and building bazaar_market overlap");
  const lost = net();
  lost.spawns[0].at = [67, 59]; // inside the MSR precinct
  lost.spawns[0].layer = "L2";
  await gateSays("network", lost, inputsWith(), `spawns: ${lost.spawns[0].id} at [67,59] is not on public floor`);
  const few = net();
  few.spawns = few.spawns.slice(0, 3);
  await gateSays("network", few, inputsWith(), "spawns: 3 placed in c1_r1, its share of the description's 72 is");
  const near = net();
  near.spawns[1] = { ...near.spawns[1], layer: near.spawns[0].layer, at: [near.spawns[0].at[0] + 1, near.spawns[0].at[1]] };
  await gateSays("network", near, inputsWith(), `spawns: ${near.spawns[0].id} and ${near.spawns[1].id} stand 1 cells apart, at least 4.4`);
  const long = net();
  long.hallways.find((h) => h.id === "sv2_core_w1").runs = [30];
  await gateSays("network", long, inputsWith(), "msr: hallway sv2_core_w1 runs 30 cells between posts, at most 24 (maxServiceRun)");
  const drift = net();
  drift.connectors.find((c) => c.id === "c32_ascent").lengthDescribed = 14;
  await gateSays("network", drift, inputsWith(), "connectors: c32_ascent is built 19.131 cells long by the rulebook, the description says 14");
  await gateSays("network", net(), inputsWith((x) => (x.rules.msr.maxServiceTotal = 200)), "cells of service hallway in the city (routed in c1_r1, as described elsewhere), at most 200 (maxServiceTotal)"); // prettier-ignore
  const gone = net();
  gone.connectors = gone.connectors.filter((c) => c.id !== "c21_hearth");
  await gateSays("network", gone, inputsWith(), "connectors: c21_hearth has stops in c1_r1 (n1_cistern, n2_hearth) and no pieces");
});
