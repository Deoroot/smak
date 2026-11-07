// levels/assembly/kowloon.mjs: the Kowloon facade of a building (smak_rp_byz01's tenement t1): the same facade for the
// same seed, a different one for another, only world brushes, nothing over a street lower than 2.5 m but a plate, and
// nothing in a window's or a doorway's opening. The broken cases of kowloonProblems are in test/broken/levels.mjs.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test, sure, HERE } from "./helper.mjs";
import { layoutOf } from "../levels/assembly/layout.mjs";
import { readSite, siteSpec, buildingOf } from "../levels/assembly/site.mjs";
import { loadStyle } from "../levels/assembly/style.mjs";
import { loadDress } from "../levels/assembly/dress.mjs";
import { kowloonFacade, kowloonProblems, kowloonOf, KOWLOON_RULES } from "../levels/assembly/kowloon.mjs";
import { towerOf, towerLayout, towerBrushes } from "../levels/assembly/tower.mjs";

const byz = readSite(siteSpec("byzantium-01")).site;
const t1 = byz.buildings.find((b) => b.id === "t1");
const dress = loadDress("h9-byzantium");
const desc = buildingOf(byz, { ...t1, seed: 5, seeds: undefined }, loadStyle("byzantium"));
const layout = layoutOf(desc);
const b = { ...t1, size: t1.size, base: [0, 0, 0] };
// the open width of the court to the south and the alley to the east, as the plan has it; elsewhere a 2-cell street
const clearOf = ([x, y], [dx, dy]) => (dy === -1 ? 512 : dx === 1 ? 128 : 128);
const make = (seed) => kowloonFacade(b, layout, { seed, density: 1, palette: dress.kowloon, clearOf });

test("kowloon: switched on by the building's own key, or its district, and off by false", () => {
  sure(kowloonOf({ kowloon: true }, "hollow", dress.kowloon)?.seed === 1, "kowloon: true is not on");
  sure(!kowloonOf({}, "hollow", dress.kowloon), "a building that does not say it is on");
  sure(kowloonOf({}, "hollow", { ...dress.kowloon, districts: ["hollow"] }), "its district does not switch it on");
  sure(!kowloonOf({ kowloon: false }, "hollow", { ...dress.kowloon, districts: ["hollow"] }), "false does not switch it off");
  sure(byz.buildings.filter((q) => q.kowloon).map((q) => q.id).join() === "t1,t2,t3,t4", "the spec turns it on for the Hollow's four tenements");
});

test("kowloon: the same seed gives the same facade, another seed another", () => {
  const a = make(1);
  const again = make(1);
  sure(JSON.stringify(a.items) === JSON.stringify(again.items), "two runs of one seed differ");
  sure(JSON.stringify(a.items) !== JSON.stringify(make(2).items), "two seeds give one facade");
  sure(a.brushes.length > 100, `only ${a.brushes.length} brushes`);
});

test("kowloon: nothing stands out below 2.5 m but a plate, nothing past its street's allowance, nothing in an opening", () => {
  for (const seed of [1, 2, 3]) {
    const k = make(seed);
    const bad = kowloonProblems(k.items, k.openings);
    sure(!bad.length, `seed ${seed}: ${bad.slice(0, 3).join(" | ")}`);
    const low = k.items.filter((i) => i.side !== "roof" && i.jut > KOWLOON_RULES.skin && i.lo[2] < KOWLOON_RULES.clearance);
    sure(!low.length, `seed ${seed}: ${low.length} items stand out low`);
    sure(k.openings.length > 10, "no openings were measured");
  }
});

test("kowloon: every kind of feature appears on the block", () => {
  const kinds = Object.keys(make(1).report.counts);
  for (const want of ["ac", "pipe", "patch", "fakewindow", "cage-front", "room", "shack", "mast", "tank"]) sure(kinds.includes(want), `no ${want}: ${kinds.join(" ")}`);
});

test("kowloon: the cage's mesh is no `{` texture (the world draws its holes filled)", () => {
  for (const m of dress.kowloon.mesh) sure(!m.startsWith("{"), `${m} is a masked texture: on the world it is drawn filled`);
});

test("tower: the Hollow's tenements are 4, 3, 4 and 3 storeys, the real two and a sealed shell over them", () => {
  const storeys = byz.buildings.filter((q) => /^t[1-4]$/.test(q.id)).map((q) => 2 + towerOf(q));
  sure(storeys.join() === "4,3,4,3", `storeys ${storeys.join()}`);
  const tl = towerLayout(t1, layout);
  sure(tl.storeys === 4 && tl.shell === 2 && tl.storeyPlans.length === 4, "the layout is not raised to 4 storeys");
  sure(layout.storeys === 2, "the layout itself was changed");
  sure(tl.storeyPlans[3].edges.every((e) => (e.rooms ?? []).includes(null)), "a shell storey holds an inside edge");
  const shell = towerBrushes({ ...t1, base: [0, 0, 0] }, layout, null);
  sure(shell.length === 8, `the shell of 2 storeys is ${shell.length} brushes, not 8 (4 slices a storey)`);
  sure(!towerBrushes({ ...t1, tower: 0 }, layout).length, "a building with no tower has a shell");
  sure(towerLayout({ ...t1, tower: 0 }, layout) === layout, "no tower, the layout changes");
});

test("tower: the facade dresses the shell's storeys with window plates, and keeps every rule", () => {
  const tl = towerLayout(t1, layout);
  for (const seed of [1, 2, 3]) {
    const k = kowloonFacade(b, tl, { seed, density: 1, palette: dress.kowloon, clearOf });
    const bad = kowloonProblems(k.items, k.openings);
    sure(!bad.length, `seed ${seed}: ${bad.slice(0, 3).join(" | ")}`);
    const panes = k.items.filter((i) => i.kind === "pane");
    sure(panes.length >= 6, `seed ${seed}: ${panes.length} window plates on the shell`);
    sure(panes.every((i) => i.lo[2] >= 384), "a window plate is on a real storey");
    const roof = k.items.filter((i) => i.side === "roof");
    sure(roof.length && roof.every((i) => i.lo[2] >= 4 * 192), "the roof's clutter is not over the fourth storey");
    sure(k.items.some((i) => i.lo[2] >= 2 * 192 && (i.kind === "cage-front" || i.kind === "room" || i.kind === "cloth")), `seed ${seed}: no cage, room or cloth over the second storey`);
  }
});

test("tower: a site that asks for one storey too many, or a half, is refused in a sentence", () => {
  for (const tower of [9, 1.5, -1, "two"]) {
    const f = readSite({ ...byz, buildings: byz.buildings.map((q) => (q.id === "t1" ? { ...q, tower } : q)) }).failures;
    sure(f.some((m) => /building t1: tower is .*whole number of storeys, 0 to 6/.test(m)), `tower ${tower}: ${f.join(" | ")}`);
  }
});
