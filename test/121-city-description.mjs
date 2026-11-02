// A city described before geometry (levels/lib/city-*.mjs, levels/specs/CITY.md): New Byzantium's spec passing,
// the format validated field by field, and each rule failing a copy broken in one way, by the sentence it gives:
// reach on foot, the vehicle network (joined, wide, turning), connectors between layers and the walk to them,
// homes per class and layer, buildings per layer, repeats, palettes and the decay going down, the Nexus and its
// checkpoints on the MSR's own network, secrets, tiles with their seams and portals, the engine's budget, bands.
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test, sure, HERE, tmp } from "./helper.mjs";
import { validateCity, measureCity, FORMAT } from "../levels/lib/city-description.mjs";
import { checkCity, bandsFromCityStyle, RP_CITY_PROVISIONAL } from "../levels/lib/city-checks.mjs";

const SPEC = join(HERE, "../levels/specs/newbyzantium.json");
const TOOL = join(HERE, "../levels/tools/check-city.mjs");
const TEXT = readFileSync(SPEC, "utf8");
const fresh = () => JSON.parse(TEXT);
const failuresOf = (desc, bands = null) => checkCity(desc, bands).failures.join(" | ");
/** A copy changed by `change`, which must fail with a sentence containing `words`. */
const breaks = (what, change, words) => {
  const d = fresh();
  change(d);
  const f = failuresOf(d);
  sure(f.includes(words), `${what}: wanted a failure with "${words}", got: ${f || "PASS"}`);
};
const byId = (list, id) => list.find((x) => x.id === id);
/** Connectors taken out, and out of every checkpoint's `controls` (a checkpoint left with none goes too). */
const dropConnectors = (d, ids) => {
  d.connectors = d.connectors.filter((c) => !ids.includes(c.id));
  for (const k of d.checkpoints) k.controls = k.controls.filter((c) => !ids.includes(c));
  d.checkpoints = d.checkpoints.filter((k) => k.controls.length);
};

test("a city description: New Byzantium passes every rule and the provisional rp-city bands", () => {
  const d = fresh();
  sure(d.format === FORMAT, `format ${d.format}`);
  const r = checkCity(d, RP_CITY_PROVISIONAL);
  sure(r.pass, r.failures.join(" | "));
  const m = r.analysis.metrics;
  sure(m.layers === 3 && m.homes === 65 && m.enterableMaxPerLayer <= 10, `layers ${m.layers}, homes ${m.homes}, enterable ${m.enterableMaxPerLayer}`); // prettier-ignore
  sure(m.lifts >= 6 && m.checkpoints === 12 && m.secrets >= 22, `lifts ${m.lifts}, checkpoints ${m.checkpoints}, secrets ${m.secrets}`); // prettier-ignore
  sure(r.analysis.tiles.filter((t) => t.things).length === 9 && r.analysis.portals > 0, "nine tiles with portals");
  const city = measureCity(d);
  sure(city.edges.some((e) => e.kind === "connector" && e.access === "msr"), "the Nexus's own lifts are MSR edges");
});

test("a city description: validation names the field and what it wanted", () => {
  const d = fresh();
  delete d.grid.cellUnits;
  d.layers[0].ceiling = "cloud";
  d.streets.segments[0].to = "n2_gate"; // L3 to L2
  d.housing.target.L1.hut = 11;
  d.buildings[0].units = { palace: 1 };
  d.connectors[0].stops = ["n3_stair_w", "n2_stair_w"]; // upper first
  const { errors } = validateCity(d);
  const all = errors.join(" | ");
  for (const words of ["grid.cellUnits: wanted engine units", "layers[0] (L1).ceiling: wanted one of", "a segment joins nodes of one layer", "the homes sum to 63, the player target is 64", "units.palace: no such home class", "each stop one level above the last"]) // prettier-ignore
    sure(all.includes(words), `missing "${words}" in: ${all}`);
  sure(!checkCity(d).pass && checkCity(d).failures[0].startsWith("invalid: "), "invalid fails before any rule");
});

test("a city description: reach on foot and the vehicle network", () => {
  breaks("the Hollow cut off", (d) => {
    d.streets.segments = d.streets.segments.filter((s) => !["s1_road_d", "s1_canal_h2", "s1_hollow_run"].includes(s.id)); // prettier-ignore
    d.connectors = d.connectors.filter((c) => c.id !== "c21_hollow_stair");
  }, "insurgent_base"); // prettier-ignore
  breaks("an avenue too narrow", (d) => (byId(d.streets.segments, "s2_av_s").width = 3), "s2_av_s carriageway 1 cells");
  breaks("the gate off the roads", (d) => (byId(d.streets.segments, "s2_gate").vehicle = false), "is on no vehicle street"); // prettier-ignore
  breaks("a tight corner", (d) => (byId(d.streets.nodes, "n2_stacks_s").cornerRadius = 0), "under the turning radius 4");
  breaks("a road under a low ceiling", (d) => (byId(d.streets.segments, "s1_road").clearance = 6), "its layer L1 has 4");
  breaks("a ramp too steep", (d) => (byId(d.connectors, "c21_ramp").length = 20), "a ramp at most 0.15");
});

test("a city description: connectors between layers, the walk to them, lifts", () => {
  breaks("too few kinds", (d) => dropConnectors(d, ["c32_forum_lift", "c32_spire_lift", "c32_ministry_lift"]), "kinds of public connector"); // prettier-ignore
  breaks("a long walk", (d) => {
    dropConnectors(d, ["c32_stair_w", "c32_palace_stair", "c32_arcade_stair"]);
    d.checkpoints = d.checkpoints.filter((k) => k.id !== "cp3_stair_w");
  }, "the walk to a public connector is over 20 cells"); // prettier-ignore
  breaks("a lift askew", (d) => (byId(d.connectors, "c21_freight").stops = ["n1_canal_e", "n2_foundry"]), "a shaft goes straight up"); // prettier-ignore
  breaks("a layer joined only by its ramp", (d) => {
    const cut = (c) => c.type !== "ramp" && c.type !== "secret" && c.access !== "msr" && c.stops.some((x) => x.startsWith("n3_")); // prettier-ignore
    const gone = new Set(d.connectors.filter(cut).map((c) => c.id));
    d.connectors = d.connectors.filter((c) => !gone.has(c.id));
    d.checkpoints = d.checkpoints.filter((k) => !k.controls.some((c) => gone.has(c)));
  }, "nothing may depend on vehicles"); // prettier-ignore
  breaks("no multi-stop lift", (d) => (byId(d.connectors, "c_spine_lift").stops = ["msr_precinct", "msr_nexus"]), "no lift with more than two stops"); // prettier-ignore
});

test("a city description: homes, buildings per layer, repeats, rooms, door names", () => {
  breaks("a home short", (d) => (byId(d.buildings, "stacks_block_b").units["flat-s"] = 4), "L2 has 15 flat-s homes, the table wants 16"); // prettier-ignore
  breaks("an eleventh building", (d) => {
    d.buildings.push({ ...byId(d.buildings, "drains_pawn"), id: "extra_shop", district: "d2_bazaar", block: "b_bazaar_emporium", frontage: "n2_bazaar", at: [50, 50], variant: "extra", sign: "extra" }); // prettier-ignore
  }, "L2 has 11 enterable buildings, at most 10"); // prettier-ignore
  breaks("a facade stamped twice", (d) => (byId(d.buildings, "drains_den").variant = "club-neon-deco"), "variant club-neon-deco is used 2 times"); // prettier-ignore
  breaks("a sign twice", (d) => (byId(d.buildings, "drains_pawn").sign = "the-rat-den"), "sign the-rat-den is used 2 times");
  breaks("a cell smaller than a bed", (d) => (d.roomSizes = { cell: [0.6, 1.5] }), "cell is 0.6x1.5 cells");
  breaks("doors unnamed", (d) => (d.housing.doorNaming.home = "{building}"), "wants a pattern with {building} and {unit}");
  breaks("too few spawns", (d) => (d.spawns.count = 40), "40 spawn points, wanted 64");
  breaks("too many light switches", (d) => (d.wiring.switchableLights = 40), "switchableLights 40, at most 32");
});

test("a city description: palette discipline and the decay going down", () => {
  breaks("a texture from elsewhere", (d) => (byId(d.buildings, "drains_den").palette = { wall: "marble-wall-dark" }), "outside d1_drains's wall palette"); // prettier-ignore
  breaks("a crowded slot", (d) => byId(d.districts, "d2_gate").palette.wall.push("brick-red", "rust-metal-wall", "sewer-wall"), "d2_gate.wall has 4 roles"); // prettier-ignore
  breaks("two districts alike", (d) => {
    const [gate, foundry] = [byId(d.districts, "d2_gate"), byId(d.districts, "d2_foundry")];
    foundry.palette.wall = [...gate.palette.wall];
    foundry.palette.floor = [...gate.palette.floor];
  }, "d2_gate and d2_foundry share 100 %"); // prettier-ignore
  breaks("a pristine undercity", (d) => d.districts.filter((x) => x.layer === "L1").forEach((x) => (x.wear = 0)), "the city degrades going down"); // prettier-ignore
  breaks("a texture under two roles", (d) => d.materials["sewer-wall"].textures.push("marb"), "texture marb is under two roles"); // prettier-ignore
});

test("a city description: the Nexus, its checkpoints and the MSR's hallways", () => {
  breaks("a small jail", (d) => (byId(d.buildings, "msr_nexus").rooms.cell = 4), "the Nexus holds 4 cells, wanted 12");
  breaks("a checkpoint cut off", (d) => (d.streets.segments = d.streets.segments.filter((s) => s.id !== "sv2_stacks")), "cp2_stacks at n2_stacks_s is not on the MSR's service network"); // prettier-ignore
  breaks("the spine broken", (d) => (d.connectors = d.connectors.filter((c) => !c.id.startsWith("c_spine"))), "the Nexus does not reach L1"); // prettier-ignore
  breaks("a checkpoint with no cell", (d) => (byId(d.checkpoints, "cp3_helix").program["holding-cell"] = 0), "cp3_helix has 0 holding-cell"); // prettier-ignore
  breaks("a checkpoint by geometry", (d) => delete byId(d.checkpoints, "cp2_ramp").reason, "cp2_ramp gives no reason");
  breaks("an endless corridor", (d) => (d.rules.msr.maxServiceRun = 15), "sv2_gate runs 22.4 cells with nothing off it");
  breaks("the gate unguarded", (d) => (d.checkpoints = d.checkpoints.filter((k) => k.id !== "cp2_gate")), "the gate n2_gate has no checkpoint"); // prettier-ignore
});

test("a city description: required places and secrets", () => {
  breaks("a market without stalls", (d) => (byId(d.buildings, "bazaar_market").rooms.stall = 6), "market wants 12 stall, has 6"); // prettier-ignore
  breaks("too few huts", (d) => (byId(d.required, "canal_huts").min = 3), "canal_huts wants 3 huts building(s) in d1_canal, found 2"); // prettier-ignore
  breaks("few secrets", (d) => (d.secrets = d.secrets.filter((s) => s.kind !== "door" || s.in !== "msr_nexus")), "the Nexus has 0 secret doors, wanted 3"); // prettier-ignore
});

test("a city description: tiles, seams and portals, each tile's budget", () => {
  breaks("a portal missing", (d) => (d.tiles.portals = d.tiles.portals.filter((p) => p.segment !== "s2_av_bazaar")), "s2_av_bazaar crosses the seam"); // prettier-ignore
  breaks("a stale portal", (d) => d.tiles.portals.push({ id: "p_stale", segment: "s2_gate", at: [0, 0] }), "portal p_stale matches no crossing"); // prettier-ignore
  breaks("a building on a seam", (d) => (byId(d.buildings, "stacks_block_a").at = [38, 48]), "stacks_block_a (6x7 at [38,48]) crosses a seam"); // prettier-ignore
  breaks("a node on a seam", (d) => (byId(d.streets.nodes, "n2_lift_n").at = [60, 79]), "n2_lift_n stands 1 cells from a seam"); // prettier-ignore
  breaks("a heavy tile", (d) => (d.rules.tiles.maxShare = 0.05), "c1_r1 takes");
  breaks("over the brush wall", (d) => (d.engine.limits.brushes.value = 5000), "brushes estimated");
});

test("a city description: bands from an rp-city style, and the tool's answers", () => {
  const style = { kind: "rp-city", bands: { cityHomes: { band: { median: 9, p10: 70, p90: 90 } }, cityRoomArea: { unit: "m2", band: { median: 32, p10: 25, p90: 50 } }, cityFloorLight: { band: { median: 60 } } } }; // prettier-ignore
  const bands = bandsFromCityStyle(style);
  sure(bands.metrics.homes.min === 70 && bands.metrics.homes.max === undefined, "a scale measure is a floor only");
  sure(bands.metrics.medianRoomAreaM2.p90 === 50 && bands.unheld.includes("cityFloorLight"), JSON.stringify(bands));
  const r = checkCity(fresh(), bands);
  const said = r.failures.join(" | ");
  sure(said.includes("band: homes 65 below 70") && said.includes("band: medianRoomAreaM2 63.4 above 25..50"), said);
  const ok = spawnSync(process.execPath, [TOOL, SPEC, "--bands", "rp-provisional"], { encoding: "utf8" });
  sure(ok.status === 0 && ok.stdout.startsWith("PASS  newbyzantium"), ok.stdout + ok.stderr);
  const bad = fresh();
  bad.rules.buildings.maxEnterablePerLayer = 5;
  const file = join(tmp, "nb-broken.json");
  writeFileSync(file, JSON.stringify(bad));
  const no = spawnSync(process.execPath, [TOOL, file, "--bands", "none"], { encoding: "utf8" });
  sure(no.status === 1 && no.stdout.includes("at most 5"), no.stdout);
  const usage = spawnSync(process.execPath, [TOOL], { encoding: "utf8" });
  sure(usage.status === 2, `usage exit ${usage.status}`);
});
