// The car doorways as Cry of Fear's inter_door (levels/assembly/metro.mjs trainDoors, levels/rp/plugin/smak_tpguard.sma): every doorway of a
// parked car has an `in` spot inside the car and an `out` spot on the platform, both at the floor, named for its lock; the plugin
// has the cvars, the hooks and the guard it says; with the AMXX compiler at AMXXPC (or the H9 install) it compiles.
import { join } from "node:path";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test, sure, HERE, tmp } from "./helper.mjs";
import { planSite, assembleSite, siteSpec } from "../levels/assembly/site.mjs";
import { loadLibrary } from "../levels/assembly/library.mjs";
import { shapeOf } from "../src/maps/source.mjs";
import { trainOf, DOORWAY, TRAIN } from "../levels/assembly/metro.mjs";

const spec = siteSpec("metro-test");
const below = structuredClone(spec.below);
below.levels[0].halls.find((h) => h.id === "st-a").trench.train = { side: 0, cars: 1, from: 72 };
below.levels[0].halls.find((h) => h.id === "st-a").trench.crossings = [240];
below.levels[0].halls.find((h) => h.id === "st-b").trench.train = { side: 1, cars: 1, from: 72 };
below.levels[0].halls.find((h) => h.id === "st-b").trench.crossings = [240];
below.rides = [{ id: "ab", from: "st-a", to: "st-b", at: [0, 1600, -3200], time: 16, reverse: { id: "ba", at: [0, 1600, -2800] } }];
const plan = planSite({ ...spec, below });
const built = assembleSite(plan, loadLibrary(join(HERE, "../levels/assembly/pieces/mese")), {});
const ents = built.map.entities;
const pos = (e) => String(e.origin).split(" ").map(Number);

test("doorways: each parked car's doorway has an in and an out spot at the floor, named for its lock, in the car and on the platform", () => {
  const spots = ents.filter((e) => e.classname === "info_target" && /^smak_cd_/.test(e.targetname ?? ""));
  sure(spots.length === 8, `${spots.length} spots (two doorways a car, a car a station, two stations, two spots each)`);
  const leaves = new Set(ents.filter((e) => e.classname === "func_door" && /_doors$/.test(e.targetname ?? "")).map((e) => e.targetname));
  for (const h of plan.below.deep.halls.filter((x) => x.trench?.train)) {
    const c = trainOf(h, h.floor).cars[0];
    const T = h.trench;
    const name = `${spec.name}_${h.id.replace(/-/g, "_")}`;
    sure(leaves.has(`${name}_doors`), `no lock ${name}_doors`);
    for (let n = 0; n < 2; n++) {
      const a = ents.find((e) => e.targetname === `smak_cd_${name}_${n}_in`);
      const b = ents.find((e) => e.targetname === `smak_cd_${name}_${n}_out`);
      sure(a && b, `the spots of ${name} doorway ${n}`);
      const [pa, pb] = [pos(a), pos(b)];
      const w = (p) => (T.axis === 0 ? p[1] : p[0]);
      const u = (p) => (T.axis === 0 ? p[0] : p[1]);
      const d = c.doors[n];
      sure(pa[2] === h.floor + 2 && pb[2] === h.floor + 2, "at the floor");
      sure(u(pa) >= d.u[0] && u(pa) <= d.u[1] && u(pb) >= d.u[0] && u(pb) <= d.u[1], "in line with the doorway");
      sure(w(pa) > c.w[0] + TRAIN.wall && w(pa) < c.w[1] - TRAIN.wall, `the in spot ${w(pa)} is inside the car`);
      const edge = c.pw === 0 ? T.v[0] : T.v[1];
      sure(c.pw === 0 ? w(pb) === edge - DOORWAY.outside : w(pb) === edge + DOORWAY.outside, "the out spot is on the platform, past the edge strip");
      sure(Math.abs(w(pb) - w(pa)) >= 60, "the two spots are apart");
    }
  }
});

const sma = readFileSync(join(HERE, "../levels/rp/plugin/smak_tpguard.sma"), "utf8");
test("doorways: the plugin has its switch, the touch hooks, the rings, the ghost and the doorway use", () => {
  for (const k of ['register_cvar("smak_tpguard"', "smak_tpguard_doors", "smak_tpguard_ghost", 'RegisterHam(Ham_Touch, "trigger_teleport"', "EngFunc_TraceHull", "SOLID_NOT", "{40.0, 80.0, 120.0}", "ANGLE_N      12", "ScreenFade", "smak_cd_"])
    sure(sma.includes(k), `smak_tpguard.sma lacks ${k}`);
  sure(/doorway_shut/.test(sma) && /Las puertas estan cerradas/.test(sma), "a locked doorway refuses");
});

const amxxpc = [process.env.AMXXPC, "C:/Juegos/H9XASH/ts/addons/amxmodx/scripting/amxxpc.exe"].find((p) => p && existsSync(p));
if (!amxxpc) console.log("skip  the plugin compiled\n      skipped: it wants the AMXX compiler in AMXXPC");
else
  test("doorways: smak_tpguard.sma compiles with no warning", () => {
    mkdirSync(join(tmp, "amx"), { recursive: true });
    const r = spawnSync(amxxpc, ["-i" + join(HERE, "../levels/rp/plugin/include"), join(HERE, "../levels/rp/plugin/smak_tpguard.sma"), "-o" + join(tmp, "amx", "smak_tpguard.amxx")], { encoding: "utf8" });
    const text = `${r.stdout}${r.stderr}`;
    sure(/Done\./.test(text) && !/warning|error \d/i.test(text), text.split("\n").filter((l) => /warning|error/i.test(l)).join(" | ") || text);
  });


test("doorways: the doors never move: each doorway is plugged with CLIP in the wall's thickness, and its lock is a small passable invisible func_door", () => {
  const all = [...built.map.brushes, ...ents.filter((e) => e.classname !== "func_door").flatMap((e) => e.brushes ?? [])];
  const box = (b) => shapeOf(b);
  const size = (s) => s.max.map((v, i) => v - s.min[i]);
  const plugs = all.filter((b) => b.faces.every((f) => f.texture === "CLIP")).map(box).filter((x) => size(x).includes(TRAIN.door) && size(x).includes(TRAIN.doorHeight) && size(x).includes(TRAIN.wall));
  sure(plugs.length >= 8, `${plugs.length} plugs (two doorways a car, a car in each station and in each ride room)`);
  const locks = ents.filter((e) => e.classname === "func_door" && /_doors$/.test(e.targetname ?? ""));
  sure(locks.length === 4, `${locks.length} locks`);
  for (const e of locks) {
    const sz = size(box(e.brushes[0]));
    sure(sz.includes(TRAIN.door) && sz.includes(2) && (Number(e.spawnflags) & 8) === 8, "a plate 52 wide and 2 high, passable");
  }
});

test("doorways: the plugin says how a doorway is used the first time it is looked at", () => {
  sure(sma.includes("Usa (E) para subir") && sma.includes("Usa (E) para bajar") && sma.includes("g_hinted"), "the hint");
});

test("doorways: the car models hold the doors shut on both sides (the committed .mdl are what levels/art/h9-metro-car.mjs writes)", () => {
  const out = join(tmp, "cars");
  mkdirSync(out, { recursive: true });
  const r = spawnSync(process.execPath, [join(HERE, "../levels/art/h9-metro-car.mjs"), out], { encoding: "utf8" });
  sure(r.status === 0, r.stdout + r.stderr);
  for (const f of ["metro_cab.mdl", "metro_cab_m.mdl", "metro_mid.mdl", "metro_mid_m.mdl"]) sure(readFileSync(join(out, f)).equals(readFileSync(join(HERE, "../levels/art/h9/models", f))), `${f} is stale: run node levels/art/h9-metro-car.mjs`);
});
