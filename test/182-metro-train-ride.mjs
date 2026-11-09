// levels/assembly/metro.mjs (a parked train, a station's posters, machines and name boards) and levels/assembly/ride.mjs (the fake ride):
// metro-test's two stations with a train of one car each and a ride each way between them. Planned: no failure, checkMetro and
// checkRides say nothing. Assembled: the cars (doorways, windows, benches, a lamp whose lens alone wears the lamp texture), the door
// leaves (func_door, starts open + toggle, one name for a train), the wiring of the ride (every target of a zone is a
// destination; every master a multisource that a manager lists; the manager's times; the train's path_corners, the first one the
// teleport; the lining's bounding box centred on it), and with VHLT and the wads the compiled map: no leak, the lining's model
// bounds at the path_corner, the cars enterable from the platform.
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { test, testAsync, sure, HERE } from "./helper.mjs";
import { planSite, assembleSite, siteSpec } from "../levels/assembly/site.mjs";
import { checkBelow } from "../levels/assembly/below.mjs";
import { loadLibrary } from "../levels/assembly/library.mjs";
import { checkMetro, trainOf, TRAIN, METRO_TEX } from "../levels/assembly/metro.mjs";
import { checkRides, RIDE } from "../levels/assembly/ride.mjs";
import { writeMap, shapeOf } from "../src/maps/source.mjs";

const spec = siteSpec("metro-test");
const below = structuredClone(spec.below);
below.levels[0].halls.find((h) => h.id === "st-a").trench.train = { side: 0, cars: 1, from: 72 };
below.levels[0].halls.find((h) => h.id === "st-a").trench.crossings = [240];
below.levels[0].halls.find((h) => h.id === "st-b").trench.train = { side: 1, cars: 1, from: 72 };
below.levels[0].halls.find((h) => h.id === "st-b").trench.crossings = [240];
below.rides = [{ id: "ab", from: "st-a", to: "st-b", at: [0, 1600, -3200], time: 16, reverse: { id: "ba", at: [0, 1600, -2800] } }];
const plan = planSite({ ...spec, below });
const library = loadLibrary(join(HERE, "../levels/assembly/pieces/mese"));
const deep = plan.below.deep;
const hall = (id) => deep.halls.find((h) => h.id === id);

test("train: two stations with a car each plan with no failure; checkMetro, checkBelow and checkRides say nothing", () => {
  sure(!plan.failures.length, `plan: ${plan.failures.join(" | ")}`);
  const m = checkMetro(deep, plan.site.below.rules);
  sure(!m.failures.length && !m.warnings.length, `checkMetro: ${[...m.failures, ...m.warnings].join(" | ")}`);
  sure(m.measures.trains === 2 && m.measures.cars === 2, JSON.stringify(m.measures));
  const r = checkRides(plan);
  sure(!r.failures.length && !r.warnings.length, `checkRides: ${r.failures.join(" | ")}`);
  sure(r.measures.directions === 2 && r.measures.zones === 2 * 2 * 6, JSON.stringify(r.measures));
  const b = checkBelow(plan, undefined, []);
  sure(!b.failures.length, `checkBelow: ${b.failures.join(" | ")}`);
});

test("train: a car is 384 long and 120 wide with its platform wall 10 from the platform's edge, two doorways 52 wide and the floor at the platforms' level", () => {
  const h = hall("st-a");
  const t = trainOf(h, h.floor);
  sure(t.cars.length === 1, "one car");
  const c = t.cars[0];
  sure(c.u[1] - c.u[0] === TRAIN.car && c.w[1] - c.w[0] === TRAIN.width, JSON.stringify(c));
  sure(c.w[0] - h.trench.v[0] === TRAIN.gap, `gap ${c.w[0] - h.trench.v[0]}`);
  sure(c.doors.length === 2 && c.doors.every((d) => d.u[1] - d.u[0] === TRAIN.door), "doorways");
  const o = trainOf(hall("st-b"), hall("st-b").floor).cars[0];
  sure(o.pw === 1 && hall("st-b").trench.v[1] - o.w[1] === TRAIN.gap, "the second station's train is at its north platform");
});

const built = assembleSite(plan, library, {});
const ents = built.map.entities;
const named = (cls, name) => ents.filter((e) => e.classname === cls && e.targetname === name);
const brushes = [...built.map.brushes, ...ents.flatMap((e) => e.brushes ?? [])];

test("train: assembled with no failure; door leaves are func_doors that start open and toggle; a lamp's housing and lens, only the lens wearing the lamp texture", () => {
  sure(!built.report.failures.length, `assembled: ${built.report.failures.join(" | ")}`);
  const doors = ents.filter((e) => e.classname === "func_door" && /_doors$/.test(e.targetname ?? ""));
  sure(doors.length === 4, `${doors.length} door leaves (two a car)`);
  sure(doors.every((d) => Number(d.spawnflags) === 33 && Number(d.wait) === -1 && Number(d.dmg) === 0), "starts open (1) + toggle (32), no wait; named, so no player's touch or use moves it");
  sure(new Set(doors.map((d) => d.targetname)).size === 2, "one name a train");
  const c = built.report.below.counts;
  for (const k of ["car-floor", "car-roof", "car-wall", "car-lintel", "car-bench", "car-lens", "poster", "machine", "name-board"]) sure(c[k] > 0, `no ${k}`);
  // a lamp's lens is the only brush of a car that wears the lamp texture, on one face
  const lit = brushes.filter((b) => b.faces.some((f) => f.texture === METRO_TEX.lamp));
  sure(lit.length > 0 && lit.every((b) => b.faces.filter((f) => f.texture === METRO_TEX.lamp).length === 1), "a brush wearing the lamp texture on more than one face");
});

test("ride: every zone's target is a destination, every master a multisource a manager lists, the managers' times are as written, the train loops by its first corner", () => {
  const zones = ents.filter((e) => e.classname === "trigger_teleport");
  sure(zones.length === 24, `${zones.length} zones (6 a car, a departure and an arrival, each way)`);
  for (const z of zones) {
    sure(ents.some((e) => e.classname === "info_teleport_destination" && e.targetname === z.target), `no destination ${z.target}`);
    const ms = ents.find((e) => e.classname === "multisource" && e.targetname === z.master);
    sure(ms, `no multisource ${z.master}`);
    sure(ents.some((e) => e.classname === "multi_manager" && Object.keys(e).some((k) => k.split("#")[0] === z.master)), `no manager lists ${z.master}`);
    sure(Number(z.spawnflags) === 0, "players only");
  }
  for (const dir of ["ab", "ba"]) {
    const pre = `${spec.name}_ride_${dir}`;
    const go = named("multi_manager", `${pre}_go`)[0];
    sure(go, `${pre}_go`);
    const keys = Object.fromEntries(Object.entries(go).filter(([k]) => k.startsWith(pre) || /_doors/.test(k)).map(([k, v]) => [k, Number(v)]));
    sure(keys[`${pre}_dep_ms`] === RIDE.countdown && keys[`${pre}_dep_ms#1`] === RIDE.countdown + RIDE.window, `the departure window: ${JSON.stringify(keys)}`);
    sure(keys[`${pre}_arr`] === RIDE.countdown + RIDE.window + 16, `the arrival after the ride's 16 seconds: ${keys[`${pre}_arr`]}`);
    const arr = named("multi_manager", `${pre}_arr`)[0];
    sure(arr && Number(arr[`${pre}_arr_ms#1`]) === RIDE.window && Number(arr[`${pre}_arr_ms#3`]) > Number(arr[`${pre}_arr_ms#2`]), "the arrival has two windows, each opened and shut");
    sure(named("func_button", `${pre}_exit`).length === 1 && named("func_button", `${pre}_btn0`)[0].target === `${pre}_go`, "the exit button and the parked car's");
    sure(named("env_shake", `${pre}_shake`).length === 1, "the shake");
    const train = ents.find((e) => e.classname === "func_train" && e.target === `${pre}_c1`);
    sure(train && Number(train.speed) === RIDE.speed && train.targetname === undefined, "a func_train with no name (it starts at once) at 450");
    const c1 = named("path_corner", `${pre}_c1`)[0];
    const c2 = named("path_corner", `${pre}_c2`)[0];
    sure(Number(c1.spawnflags) === 2 && c1.target === `${pre}_c2` && c2.target === `${pre}_c1` && !c2.spawnflags, "the first corner is the one that teleports (the corner a train goes TO is the one that sends it back)");
    const [mn, mx] = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
    for (const b of train.brushes) {
      const s = shapeOf(b);
      for (let i = 0; i < 3; i++) (mn[i] = Math.min(mn[i], s.min[i]), (mx[i] = Math.max(mx[i], s.max[i])));
    }
    const centre = mn.map((v, i) => (v + mx[i]) / 2);
    const at = String(c1.origin).split(" ").map(Number);
    sure(centre.every((v, i) => Math.abs(v - at[i]) < 0.01), `the lining's centre ${centre} is where its first corner is, ${at}`);
    sure(Math.abs(mx[0] - mn[0] - (RIDE.to - RIDE.from)) < 0.01 && (RIDE.to - RIDE.from) % RIDE.period === 0 && RIDE.shift % RIDE.period === 0, "the lining is a whole number of periods and slides a whole number");
  }
});

// ── with the compilers ──
const VHLT = process.env.VHLT_DIR;
const wads = [process.env.TS_WAD, process.env.HL_WAD, process.env.MESE_WAD];
if (!VHLT || wads.some((w) => !w || !existsSync(w)))
  console.log("skip  the train and ride compiled\n      skipped: it wants VHLT in VHLT_DIR and the three wads in TS_WAD, HL_WAD and MESE_WAD"); // prettier-ignore
else await testAsync("ride: compiled with no leak; a player walks from the platform through the doorway into the car", "train compiled", async () => { // prettier-ignore
  const { compileMap } = await import("../src/maps/compile.mjs");
  const { readBsp } = await import("../src/maps/bsp.mjs");
  const { reachOf } = await import("../src/maps/reach.mjs");
  const work = mkdtempSync(join(tmpdir(), "smak-train-"));
  const file = join(work, "smak_train_test.map");
  writeFileSync(file, writeMap(built.map));
  const r = compileMap(file, { wads, wadinclude: library.wadinclude, fast: true, timeout: 900000, compilers: { folder: VHLT } });
  sure(r.bsp && !r.leak, `compile: ${r.errors.join(" | ")}${r.leak ? " LEAK" : ""}`);
  const bsp = readBsp(readFileSync(r.bsp));
  const reach = reachOf(bsp);
  // the lining's compiled model is centred on its first path_corner (the engine puts a train's bounding-box centre on the corner it starts at)
  const ents = bsp.entities.map((p) => Object.fromEntries(p));
  for (const t of ents.filter((e) => e.classname === "func_train")) {
    const m = bsp.models[Number(t.model.slice(1))];
    const c1 = ents.find((e) => e.classname === "path_corner" && e.targetname === t.target);
    const at = c1.origin.split(" ").map(Number);
    sure(m.mins.every((v, i) => Math.abs((v + m.maxs[i]) / 2 - at[i]) < 0.5), `the model of ${t.target}: centre ${m.mins.map((v, i) => (v + m.maxs[i]) / 2)} against its corner ${at}`);
  }
  const h = hall("st-a");
  const c = trainOf(h, h.floor).cars[0];
  const door = (c.doors[0].u[0] + c.doors[0].u[1]) / 2;
  const inside = reach.walked(door, (c.w[0] + c.w[1]) / 2 + 20, h.floor + 40);
  sure(inside !== null && Math.abs(inside - h.floor) <= 8, `through the doorway, into the car: ${inside}`);
});
