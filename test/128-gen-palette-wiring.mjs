// The map generator's stages 6 (palette and light plan) and 7 (the RP wiring contract) on New Byzantium's Core
// (c1_r1), and the Apollo-RP adapter: the Core passes both gates; the same inputs give the same bytes; each gate
// fails a broken copy with the sentence naming the thing; a palette slot with no role stops the build naming it.
// Stages 0-5 run once (or are read back from SMAK_GEN_CACHE, a folder holding fresh 00-05 artifacts of the Core).
import { join } from "node:path";
import { readFileSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { testAsync, sure, HERE, tmp } from "./helper.mjs";
import { runGenerator, regate } from "../levels/gen/runner.mjs";
import { stage as stage6 } from "../levels/gen/stage6-palette.mjs";
import { apolloSeed } from "../levels/gen/wiring-apollo.mjs";
import { RULES_PATH } from "../levels/lib/architecture-rules.mjs";

const SPEC = join(HERE, "../levels/specs/newbyzantium.json");
const city = () => JSON.parse(readFileSync(SPEC, "utf8"));
const UP = ["00-description.json", "01-site.json", "02-lots.json", "03-programs.json", "04-network.json", "05-plans.json"];
const read = (dir, f) => JSON.parse(readFileSync(join(dir, f), "utf8"));
const bytes = (dir, f) => readFileSync(join(dir, f), "utf8");
const copy = (v) => JSON.parse(JSON.stringify(v));
const OUT = join(tmp, "gen-core-67");
let A = null; // every artifact of the Core, by file

/** Runs 6 and 7 into `dir`, from 00-05 already there (fresh), else 0-7 whole. */
async function build(dir) {
  const res = await runGenerator({ desc: city(), out: dir, tile: "c1_r1", from: 6, until: 7 });
  if (res.ok || !res.refused) return res;
  return runGenerator({ desc: city(), out: dir, tile: "c1_r1", until: 7 });
}
const inputs6 = () => Object.fromEntries(["01-site.json", "02-lots.json", "04-network.json", "05-plans.json"].map((f) => [f, A[f]]));
const inputs7 = () => Object.fromEntries(["01-site.json", "02-lots.json", "03-programs.json", "04-network.json", "05-plans.json", "06-palette.json"].map((f) => [f, A[f]])); // prettier-ignore
const says = async (name, artifact, inputs, ...words) => {
  const v = await regate(name, artifact, { desc: city(), inputs });
  const hit = v.failures.find((f) => words.every((w) => f.includes(w)));
  sure(hit, `the ${name} gate did not say ${JSON.stringify(words)}; it said: ${v.failures.slice(0, 4).join(" | ") || "nothing (it passed)"}`);
};

await testAsync("generator: the Core passes stages 6 (palette, light) and 7 (wiring)", "gen 6-7 core", async () => {
  mkdirSync(OUT, { recursive: true });
  const cache = process.env.SMAK_GEN_CACHE;
  if (cache && UP.every((f) => existsSync(join(cache, f)))) for (const f of UP) copyFileSync(join(cache, f), join(OUT, f));
  const res = await build(OUT);
  sure(res.ok, `stopped: ${res.refused ?? JSON.stringify(res.stopped)}`);
  sure([6, 7].every((n) => res.results.some((r) => r.n === n && r.pass && !r.reused)), `stages run ${res.results.map((r) => r.n)}`);
  A = Object.fromEntries([...UP, "06-palette.json", "07-wiring.json"].map((f) => [f, read(OUT, f)]));
  const p = A["06-palette.json"];
  const w = A["07-wiring.json"];
  sure(p.format === "smak-gen/1" && p.gate.pass && p.inputs["05-plans.json"], "06's header");
  sure(w.gate.pass && w.inputs["06-palette.json"], "07's header");
  // every room, door, way and facade of the tile has its surfaces, every texture its role's
  const plans = A["05-plans.json"];
  for (const b of plans.buildings) for (const r of b.rooms) sure(p.things.some((t) => t.id === `room:${r.id}`), `room ${r.id} has no surfaces`);
  sure(p.things.filter((t) => t.kind === "facade").length === A["02-lots.json"].lots.filter((l) => l.kind === "facade").length, "a facade with no surfaces"); // prettier-ignore
  const desc = city();
  for (const t of p.things) for (const s of Object.values(t.slots)) sure(s.texture === null || desc.materials[s.role].textures.includes(s.texture), `${t.id}: ${s.texture} not ${s.role}'s`); // prettier-ignore
  // MSR cells wear the cell palette, the clinic its own
  sure(p.things.find((t) => t.id === "room:msr_nexus.msr.cell-2").slots.wall.role === "cell-wall", "the Nexus's cell is not in cell-wall");
  sure(p.things.find((t) => t.id.startsWith("room:hearth_clinic")).slots.wall.role === "clinic-wall-white", "the clinic's walls");
  // rooms planned brighter than the streets, budgets kept
  const L = p.measures.light;
  sure(L.roomMedian / L.publicMedian >= 1.25 && L.roomMedian >= L.publicMedian + 10, JSON.stringify(L));
  sure(p.lamps.filter((l) => l.switchable).length <= p.budget.switchable.limit && p.sounds.length <= p.budget.sounds.limit, JSON.stringify(p.budget));
  // every door named, every 05 door present, the names short and unique
  const names = w.doors.map((d) => d.name);
  sure(names.every((n) => n && n.length <= 31) && new Set(names).size === names.length, "door names");
  for (const b of plans.buildings) for (const d of b.doors) if (d.name) sure(names.includes(d.name), `${d.name} lost`);
  sure(w.cells.length === 12 + 2 + 2 * w.zones.filter((z) => z.of === "checkpoint").length, `${w.cells.length} cells`);
  sure(w.lifts.some((l) => l.stops.length === 3 && l.stops.every((s) => s.call)), "the spine lift's three stops with call buttons");
  sure(w.switches.some((s) => s.kind === "alarm" && s.targets[0] === "alarm_city"), "the city alarm");
  sure(w.entities.total <= w.entities.limit, JSON.stringify(w.entities));
  // a checkpoint's rooms folded into a building are named once, by 05's door; every switch on a wall with its facing
  for (const b of plans.buildings) for (const r of b.rooms.filter((x) => x.checkpoint && x.kind === "holding-cell")) sure(w.cells.filter((c) => c.room === r.id).length === 1 && w.cells.find((c) => c.room === r.id).place === r.checkpoint, `${r.id}: one cell, under ${r.checkpoint}`); // prettier-ignore
  sure(w.switches.every((s) => Array.isArray(s.facing) && s.facing.length === 2), "a switch with no facing");
  sure(w.switches.filter((s) => s.room).every((s) => s.door), "a room's switch not beside its door");
  sure(typeof w.entities.props === "number" && w.entities.props > 0, "07's entities reserve no model props");
  // every street and plaza lamp fixed: a post, a wall bracket, or hung under a portico on purpose
  sure(p.lamps.filter((l) => l.kind !== "room").every((l) => ["post", "bracket", "hung"].includes(l.mount)), "a street lamp with no mount");
});

await testAsync("generator: stages 6 and 7 give the same bytes from the same inputs", "gen 6-7 same bytes", async () => {
  const two = join(tmp, "gen-core-67b");
  mkdirSync(two, { recursive: true });
  for (const f of UP) copyFileSync(join(OUT, f), join(two, f));
  const res = await runGenerator({ desc: city(), out: two, tile: "c1_r1", from: 6, until: 7 });
  sure(res.ok, JSON.stringify(res.stopped ?? res.refused));
  for (const f of ["06-palette.json", "07-wiring.json"]) sure(bytes(OUT, f) === bytes(two, f), `${f} differs between two runs`);
});

await testAsync("generator: stage 6 stops on a missing role and fails a broken palette, light or budget by its sentence", "gen gates 6", async () => {
  // a district with no ceiling role: the build stops naming the thing and the slot, no fallback
  const desc = city();
  desc.districts.find((d) => d.id === "d1_drains").palette.ceiling = [];
  const ctx = { description: desc, rulebook: JSON.parse(readFileSync(RULES_PATH, "utf8")), params: { tile: "c1_r1", seed: 1 }, inputs: inputs6() }; // prettier-ignore
  const body = stage6.run(ctx);
  const v = stage6.gate({ ...body }, ctx);
  sure(v.failures.some((f) => f.includes("way:s1_main has no ceiling role") && f.includes("no fallback")), `missing role: ${v.failures.slice(0, 3).join(" | ")}`); // prettier-ignore
  const base = A["06-palette.json"];
  const thing = (a, id) => a.things.find((t) => t.id === id);
  let a = copy(base);
  thing(a, "way:s1_main").slots.wall = { role: "gold-trim", texture: "sintrim" };
  await says("palette", a, inputs6(), "way:s1_main.wall wears gold-trim, outside its closed palette");
  a = copy(base);
  thing(a, "way:s1_main").slots.wall.texture = "marb";
  await says("palette", a, inputs6(), "way:s1_main.wall has texture marb, not one of sewer-wall's");
  a = copy(base);
  thing(a, "way:s1_main").slots.floor = { role: "plank-floor-rotten", texture: "po_sewerwall" };
  await says("palette", a, inputs6(), "texture po_sewerwall is used under 2 roles");
  a = copy(base);
  const bz = a.things.filter((t) => t.district === "d2_bazaar" && !t.faction && t.slots.wall);
  for (const t of a.things.filter((t) => t.district === "d2_hearth" && !t.faction)) {
    if (t.slots.wall) t.slots.wall = { ...bz[0].slots.wall };
    if (t.slots.floor) t.slots.floor = { ...bz[0].slots.floor };
  }
  for (const t of bz) (t.slots.wall = { ...bz[0].slots.wall }), t.slots.floor && (t.slots.floor = { ...bz[0].slots.floor });
  for (const t of a.things.filter((t) => t.district === "d2_bazaar" && !t.faction && t.slots.floor)) t.slots.floor = { ...bz[0].slots.floor };
  await says("palette", a, inputs6(), "neighbouring districts d2_bazaar and d2_hearth share", "do not read apart");
  a = copy(base);
  for (const t of a.things) if (t.layer === "L1") t.wear = 0;
  await says("palette", a, inputs6(), "wear does not rise downward: L1's surfaces wear 0");
  a = copy(base);
  a.measures.light.roomMedian = 50;
  await says("palette", a, inputs6(), "light: rooms are planned at 50 against public floor", "wanted 1.25 or more");
  a = copy(base);
  a.lamps.filter((l) => l.kind === "room").slice(0, 12).forEach((l, i) => ((l.switchable = true), (l.style = 32 + i)));
  await says("palette", a, inputs6(), "switchable lights in tile c1_r1, at most 7");
  a = copy(base);
  for (let i = 0; i < 40; i++) a.sounds.push({ ...a.sounds[0], id: `x${i}` });
  await says("palette", a, inputs6(), "looping sounds in tile c1_r1, at most 60");
});

await testAsync("generator: stage 7 fails names, doors, owners, cells, switches and entities by its sentence", "gen gates 7", async () => {
  const base = A["07-wiring.json"];
  let a = copy(base);
  a.doors[1].name = a.doors[0].name;
  await says("wiring", a, inputs7(), `names: ${base.doors[0].name} is given 2 times`);
  a = copy(base);
  a.doors[0].name = "a_name_far_too_long_for_the_engine_x";
  await says("wiring", a, inputs7(), "is 36 characters, at most 31");
  a = copy(base);
  const gone = a.doors.find((d) => d.name === "hearth_terrace_2");
  a.doors = a.doors.filter((d) => d !== gone);
  await says("wiring", a, inputs7(), `door ${gone.id} (hearth_terrace_2) from 05-plans.json is missing`);
  a = copy(base);
  a.doors.find((d) => d.name === "drains_pawn").owner = "police";
  await says("wiring", a, inputs7(), "drains_pawn has owner group police");
  a = copy(base);
  a.cells = a.cells.filter((c) => c.name !== "cp1_cistern_cell2");
  await says("wiring", a, inputs7(), "checkpoint cp1_cistern has 1 cell doors and 2 holding cells, its program asks 2");
  a = copy(base);
  for (let i = 0; i < 10; i++) a.switches.push({ ...a.switches[0], name: `sw_extra_${i}` });
  await says("wiring", a, inputs7(), `switches: ${base.switches.length + 10} in tile c1_r1, wanted`);
  a = copy(base);
  a.switches[0].targets = ["no_such_lamp"];
  await says("wiring", a, inputs7(), "targets no_such_lamp, which is no door, light or sound");
  a = copy(base);
  a.entities.total = 500;
  await says("wiring", a, inputs7(), "entities: an estimated 500 entities stay in tile c1_r1, at most 412");
  a = copy(base);
  a.doors.find((d) => d.kind === "interior").use = false;
  await says("wiring", a, inputs7(), "is not use-only (spawnflag 256)");
});

await testAsync("generator: the Apollo-RP seed keys every lockable door on its targetname", "gen apollo seed", async () => {
  const w = A["07-wiring.json"];
  const s = apolloSeed(w, { map: "h9_tsrp_newbyzantium" });
  const sql = s.files["h9_tsrp_newbyzantium.sql"];
  sure(sql.includes("CREATE TABLE IF NOT EXISTS arp_doors (targetname VARCHAR(36),internalname VARCHAR(66),UNIQUE KEY (targetname))"), "arp_doors schema"); // prettier-ignore
  const lockable = w.doors.filter((d) => d.lockable && d.kind !== "secret" && d.kind !== "hatch");
  sure(s.doors.length === lockable.length, `${s.doors.length} door rows for ${lockable.length} lockable doors`);
  for (const d of lockable) sure(sql.includes(`('t|${d.name}', '${d.key}')`), `no row for ${d.name}`);
  sure(s.doors.every((d) => d.targetname.length <= 36), "a targetname past VARCHAR(36)");
  sure(new Set(s.properties.map((p) => p.internalname)).size === s.properties.length, "a property twice");
  for (const d of s.doors) sure(s.properties.some((p) => p.internalname === d.internalname), `${d.targetname} keyed to no property`);
  sure(s.properties.find((p) => p.internalname === "msr_nexus").access === "a", "the MSR's access letter");
  sure((s.files["jailmod.ini"].match(/^origin "/gm) ?? []).length === w.cells.length, "a jail cell a cell");
  sure((s.files["zones.ini"].match(/"boundaries1"/g) ?? []).length === w.zones.length, "a zone a zone");
});
