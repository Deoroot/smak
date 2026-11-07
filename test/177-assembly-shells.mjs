// levels/assembly/shell.mjs on levels/specs/shells-test.json: a street of six buildings, three of them shells (`program:
// "shell"`: the facade only) and three with interiors. Planned: a shell's layout holds no room, door, entrance or stair, its
// facade is the building's own outside walls, no property or place is made for it. Assembled: its walls, windows, entrance,
// roof and street lamps are the real building's, behind them one solid mass; no door, breakable, button or light entity
// stands in a shell; its door is a world brush and its window dark; a walkable roof is fenced with clip, a closed one not.
// The same street with every building an interior one is the control: a shell costs fewer brushes and edicts. With VHLT
// and the three wads: both compiled with no leak, the budget and checkPvs measured (leaves, faces, edicts, median and p90
// faces from the street), the shells' hull-1 contents on the roof (a player stands on it, the rail stops him at the edge).
// The broken cases of checkShells are in test/broken/levels.mjs.
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { test, testAsync, sure, HERE } from "./helper.mjs";
import { planSite, assembleSite, propertiesOf, siteSpec } from "../levels/assembly/site.mjs";
import { loadStyle } from "../levels/assembly/style.mjs";
import { loadLibrary } from "../levels/assembly/library.mjs";
import { FACADE_KINDS, checkShells, isShell, ROOF_RAIL } from "../levels/assembly/shell.mjs";
import { writeMap, shapeOf } from "../src/maps/source.mjs";

const cache = join(tmpdir(), "smak-shells-layouts");
const spec = JSON.parse(readFileSync(join(HERE, "../levels/specs/shells-test.json"), "utf8"));
const control = structuredClone(spec);
control.name = "smak_shells_all";
for (const b of control.buildings) (delete b.program, delete b.roof);
const plan = planSite(spec, { cache });
const all = planSite(control, { cache });
const library = loadLibrary(join(HERE, "../levels/assembly/pieces/mese"));
const style = loadStyle(plan.site.style);
const SHELLS = ["b", "d", "f"];
const boxOf = (id) => {
  const b = plan.site.buildings.find((q) => q.id === id);
  return { min: [b.at[0] * 64, b.at[1] * 64], max: [(b.at[0] + b.size[0]) * 64, (b.at[1] + b.size[1]) * 64] };
};
const inside = (p, id) => {
  const r = boxOf(id);
  return p[0] > r.min[0] && p[0] < r.max[0] && p[1] > r.min[1] && p[1] < r.max[1];
};
const originOf = (e) => String(e.origin).split(/[ ,]+/).map(Number);

test("assembly shells: the site plans with no failure; the shells are the buildings b, d and f", () => {
  sure(!plan.failures.length && !all.failures.length, `plan: ${[...plan.failures, ...all.failures].join(" | ")}`);
  sure(plan.site.buildings.filter(isShell).map((b) => b.id).join() === SHELLS.join(), "the shells");
  sure(plan.site.buildings.find((b) => b.id === "b").roof === "walk", "b's roof is walked");
});

test("assembly shells: a shell's layout holds no room, door, entrance or stair; no property is made for it", () => {
  for (const id of SHELLS) {
    const l = plan.layouts.get(id);
    sure(l.shell && !l.rooms.length && !l.doors.length && !l.entrances.length && !l.storeyPlans.length && !l.stairwell, `${id}: ${JSON.stringify(Object.keys(l))}`); // prettier-ignore
    sure([...propertiesOf(l, style).values()].every((v) => v === null), `${id} has a property`);
  }
  for (const id of ["a", "c", "e"]) sure(plan.layouts.get(id).rooms.length >= 4, `${id} keeps its rooms`);
  const c = checkShells(plan);
  sure(!c.failures.length && c.measures.shells === 3, `checkShells: ${c.failures.join(" | ")}`);
});

test("assembly shells: the facade is the real building's outside walls, edge for edge, and nothing else", () => {
  for (const id of SHELLS) {
    const f = plan.shells.get(id);
    const real = all.layouts.get(id);
    sure(f.shell && !f.stairwell && !f.doors.length && f.storeyPlans.length === real.storeyPlans.length, `${id} facade`);
    f.storeyPlans.forEach((p, s) => {
      sure(p.edges.every((e) => FACADE_KINDS.has(e.kind)), `${id} storey ${s}: an inside wall in the facade`);
      const want = real.storeyPlans[s].edges.filter((e) => FACADE_KINDS.has(e.kind));
      sure(JSON.stringify(p.edges) === JSON.stringify(want), `${id} storey ${s}: its outside walls are not the building's`);
    });
  }
});

const built = assembleSite(plan, library, {});
const builtAll = assembleSite(all, library, {});

test("assembly shells: assembled with no failure; no door, breakable, button or light entity in a shell; its entrance is a world brush", () => {
  sure(!built.report.failures.length, `assembled: ${built.report.failures.join(" | ")}`);
  const working = new Set(["func_door_rotating", "func_door", "func_breakable", "func_button", "light", "light_spot"]);
  for (const e of built.map.entities) {
    if (!working.has(e.classname)) continue;
    const at = e.origin ? originOf(e) : (() => { const s = shapeOf(e.brushes[0]); return [(s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2]; })(); // prettier-ignore
    for (const id of SHELLS) sure(!inside(at, id), `a ${e.classname} stands in the shell ${id} at ${at.join(" ")}`);
  }
  // every door entity belongs to an interior building, and the named doorways are all theirs
  sure(built.report.doorways.every((d) => !SHELLS.includes(d.building)), "a doorway of a shell is the RP's");
  const doors = (m) => m.entities.filter((e) => e.classname === "func_door_rotating").length;
  sure(doors(built.map) * 2 === doors(builtAll.map), `doors: ${doors(built.map)} with the shells, ${doors(builtAll.map)} without`);
  // the locked door: wood8dn as a world brush on the front of b, set back out of the mass
  const front = built.map.brushes.filter((br) => br.faces.some((f) => f.texture === "wood8dn")).map(shapeOf).filter((s) => s.min[0] >= 640 && s.max[0] <= 1216 && s.min[1] >= 1200 && s.max[1] <= 1240); // prettier-ignore
  sure(front.length === 2, `b's two locked doors: ${front.length}`);
  sure(front.every((s) => s.max[1] <= 1224), `a leaf still in the mass: ${JSON.stringify(front)}`);
});

test("assembly shells: a mass of solid world brush behind the facade, the ground to the roof's underside; the windows dark", () => {
  for (const id of SHELLS) {
    const r = boxOf(id);
    const mass = built.map.brushes.map(shapeOf).filter((s) => s.min[0] === r.min[0] && s.min[1] === r.min[1] && s.max[0] === r.max[0] && s.max[1] === r.max[1] && s.min[2] === -16 && s.max[2] === 368); // prettier-ignore
    sure(mass.length === 1, `${id}: ${mass.length} mass brushes over its whole footprint, -16 to 368`);
  }
  const dark = built.map.brushes.filter((b) => b.faces.some((f) => f.texture === "GLASS_DARK"));
  sure(dark.length >= 3 * 2, `dark faces: ${dark.length}`);
  sure(!built.map.entities.some((e) => e.classname === "func_breakable" && inside(shapeOf(e.brushes[0]).min, "d")), "a pane breakable in d"); // prettier-ignore
});

test("assembly shells: the walked roof of b is fenced in clip along its open edges, the closed roofs of d and f are not", () => {
  const rails = (m) => m.brushes.filter((b) => b.faces.every((f) => f.texture === "CLIP")).map(shapeOf).filter((s) => s.min[2] >= 384); // (the pieces have clip of their own, low)
  const clips = rails(built.map);
  sure(clips.length >= 3, `the rail: ${clips.length} brushes`);
  for (const s of clips) {
    sure(s.min[2] === 384 && s.max[2] === 384 + ROOF_RAIL.height, `the rail's height ${s.min[2]} to ${s.max[2]}`);
    sure(s.min[0] >= 640 - ROOF_RAIL.out && s.max[0] <= 1216 + ROOF_RAIL.out && s.min[1] >= 1216 - ROOF_RAIL.out && s.max[1] <= 1664 + ROOF_RAIL.out, `a rail off b: ${JSON.stringify(s)}`); // prettier-ignore
  }
  sure(!rails(builtAll.map).length, "the control has a rail");
});

test("assembly shells: a shell costs fewer brushes and edicts than the same building with its interior, the facade as many pieces", () => {
  const n = (m) => m.brushes.length + m.entities.reduce((s, e) => s + (e.brushes?.length ?? 0), 0);
  const counts = { shell: n(built.map), all: n(builtAll.map), entShell: built.map.entities.length, entAll: builtAll.map.entities.length };
  sure(counts.shell < counts.all && counts.entShell < counts.entAll, JSON.stringify(counts));
  console.log(`      brushes ${counts.all} -> ${counts.shell}, entities ${counts.entAll} -> ${counts.entShell} (3 of 6 buildings shells)`);
  sure(writeMap(assembleSite(plan, library, {}).map) === writeMap(built.map), "the same site gave two different maps");
});

// ── with the compilers ──
const VHLT = process.env.VHLT_DIR;
const wads = [process.env.TS_WAD, process.env.HL_WAD, process.env.MESE_WAD];
if (!VHLT || wads.some((w) => !w || !existsSync(w)))
  console.log("skip  the shells compiled, measured and the roof walked\n      skipped: it wants VHLT in VHLT_DIR and the three wads in TS_WAD, HL_WAD and MESE_WAD"); // prettier-ignore
else await testAsync("assembly shells: both sites compiled with no leak; the budget and the faces drawn from the street are less with the shells; a player stands on b's roof and is held at its edge", "shells measured", async () => { // prettier-ignore
  const { compileMap } = await import("../src/maps/compile.mjs");
  const { readBsp, contentsAt, CONTENTS } = await import("../src/maps/bsp.mjs");
  const { budgetOf } = await import("../src/maps/budget.mjs");
  const { checkPvs } = await import("../src/maps/pvs.mjs");
  const work = mkdtempSync(join(tmpdir(), "smak-shells-"));
  const compile = (name, b) => {
    const file = join(work, `${name}.map`);
    writeFileSync(file, writeMap(b.map));
    const r = compileMap(file, { wads, wadinclude: library.wadinclude, fast: true, timeout: 900000, compilers: { folder: VHLT } });
    sure(r.bsp && !r.leak, `${name} compile: ${r.errors.join(" | ")}${r.leak ? " LEAK" : ""}`);
    const bytes = readFileSync(r.bsp);
    return { bsp: readBsp(bytes), budget: budgetOf({ bsp: bytes, map: b.map, compile: r }).measures };
  };
  const s = compile("smak_shells_test", built);
  const a = compile("smak_shells_all", builtAll);
  const street = [];
  for (let x = 128; x <= 1856; x += 128) for (let y = 736; y <= 1056; y += 128) street.push([x, y, 36]);
  const pvs = (bsp) => checkPvs(bsp, { points: street, floor: false, spawns: false }); // the street only, the same spots in both
  const [ps, pa] = [pvs(s.bsp), pvs(a.bsp)];
  const line = (name, m, p) => `      ${name}: leaves ${m.leaves}, faces ${m.faces}, static edicts ${m.staticEdicts}, brushes ${m.brushes}; faces drawn from ${p.overall.count} street spots: median ${p.overall.median}, p90 ${p.overall.p90}`; // prettier-ignore
  console.log(line("with 3 shells", s.budget, ps));
  console.log(line("all interior ", a.budget, pa));
  sure(ps.overall.median <= pa.overall.median && ps.overall.p90 <= pa.overall.p90, `faces drawn from the street: ${ps.overall.median}/${ps.overall.p90} against ${pa.overall.median}/${pa.overall.p90}`);
  sure(s.budget.leaves < a.budget.leaves && s.budget.faces < a.budget.faces, `the shells' leaves ${s.budget.leaves} / ${a.budget.leaves}, faces ${s.budget.faces} / ${a.budget.faces}`); // prettier-ignore
  // b's roof: a player (hull 1) stands in its middle and near the edge, and is stopped by the rail at the edge
  const free = (p) => contentsAt(s.bsp, p, { hull: 1 }) !== CONTENTS.SOLID;
  sure(free([928, 1440, 384 + 37]) && free([700, 1300, 384 + 37]) && free([1150, 1620, 384 + 37]), "a player cannot stand on the roof of b");
  sure(!free([928, 1216 - 2, 384 + 37]) && !free([928, 1664 + 2, 384 + 37]), "no rail holds a player at the roof's edge");
  sure(!free([928, 1440, 384 - 40]), "the roof is not solid under a player's feet");
});
