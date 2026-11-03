// levels/assembly, the Mese's buildings (styles/mese.json, levels/specs/mese-shop-a.json): a shop below with its own
// street door and window, its back room behind it, and a stair hall with a street door of its own up to two flats,
// each a property no other is passed through to reach. The style's kinds in cells; a building with two entrances
// laid out at three seeds with no failure, both entrances on the front, the shop's window on the street beside its
// door, nothing opened in the blind walls the neighbours stand against; the same seed the same JSON; and a blind wall
// named as the front refused by its sentence. The broken cases of the rules are in test/broken/levels.mjs.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test, sure, HERE } from "./helper.mjs";
import { readBuilding, checkBuilding } from "../levels/assembly/building.mjs";
import { layoutOf, layoutJson, checkLayout } from "../levels/assembly/layout.mjs";
import { loadStyle, checkStyle } from "../levels/assembly/style.mjs";

const SPEC = JSON.parse(readFileSync(join(HERE, "../levels/specs/mese-shop-a.json"), "utf8"));
const style = loadStyle("mese");
const wallOf = (e, [w, h]) => (e.from[1] === e.to[1] ? (e.from[1] === 0 ? "south" : e.from[1] === h ? "north" : null) : e.from[0] === 0 ? "west" : e.from[0] === w ? "east" : null); // prettier-ignore

test("assembly mese: the style's kinds in cells of 64, every rule with a source the style lists", () => {
  const got = Object.fromEntries(Object.entries(style.kinds).map(([k, v]) => [k, [v.minArea, v.maxArea, v.minSide]]));
  const want = { shop: [15, 37, 3], backroom: [6, Infinity, 2], stairhall: [2, 23, 2], landing: [2, 23, 2], flat: [8, 28, 2], living: [16, 34, 4], kitchen: [6, 18, 2], bedroom: [8, 22, 3] }; // prettier-ignore
  sure(JSON.stringify(got) === JSON.stringify(want), `kinds in cells: ${JSON.stringify(got)}`);
  for (const [id, rule] of [...Object.entries(style.rules), ...Object.entries(style.site)])
    sure(rule.source?.length && rule.source.every((s) => style.sources[s]), `rule ${id} names no source the style lists`);
  const c = checkBuilding(SPEC);
  sure(!c.failures.length, `mese-shop-a does not check: ${c.failures.join(" | ")}`);
});

test("assembly mese: a shop and a stair hall, each its own street door, laid out at seeds 1 to 3 with no failure", () => {
  const d = readBuilding(SPEC);
  for (const seed of [1, 2, 3]) {
    const l = layoutOf(SPEC, { seed });
    sure(!l.failures.length, `seed ${seed}: ${l.failures.join(" | ")}`);
    sure(!checkStyle(l, d, style).failures.length, `seed ${seed}: the style fails`);
    const rooms = l.entrances.map((en) => en.room).sort();
    sure(rooms.join() === "hall,shop", `seed ${seed}: the entrances are of ${rooms.join(", ")}; it wants hall and shop`);
    for (const en of l.entrances) sure(wallOf(en.edges[0], l.size) === "south", `seed ${seed}: the entrance of ${en.room} is not on the south front`); // prettier-ignore
    sure(l.entrance === l.entrances[0], `seed ${seed}: entrance is not the first of entrances`);
    const ground = l.storeyPlans[0].edges;
    sure(ground.some((e) => e.kind === "window" && e.rooms.includes("shop") && wallOf(e, l.size) === "south"), `seed ${seed}: the shop has no window on the street`); // prettier-ignore
    for (const p of l.storeyPlans)
      for (const e of p.edges)
        sure(!((e.kind === "window" || e.kind === "entrance") && ["east", "west"].includes(wallOf(e, l.size))), `seed ${seed}: a ${e.kind} on the blind ${wallOf(e, l.size)} wall`); // prettier-ignore
    // no property through another: the shop and the hall join by no door
    sure(!l.doors.some((door) => door.rooms.includes("shop") && door.rooms.includes("hall")), `seed ${seed}: a door joins the shop and the stair hall`); // prettier-ignore
    if (seed === 1) sure(layoutJson(layoutOf(SPEC, { seed })) === layoutJson(l), "seed 1 gave two different layouts");
  }
});

test("assembly mese: a blind wall named as the front, and a window on a blind wall, refused by their sentences", () => {
  const c = checkBuilding({ ...SPEC, blind: ["south", "east"] });
  sure(c.failures.some((f) => /blind names the south wall, the front; the entrance stands on the front/.test(f)), `blind front: ${c.failures.join(" | ")}`); // prettier-ignore
  const l = layoutOf(SPEC, { seed: 1 });
  const d = readBuilding(SPEC);
  sure(!checkLayout(l, d).failures.length, `seed 1 does not check: ${checkLayout(l, d).failures.join(" | ")}`);
  const copy = JSON.parse(JSON.stringify(l));
  const e = copy.storeyPlans[1].edges.find((x) => x.kind === "exterior" && wallOf(x, copy.size) === "east");
  e.kind = "window";
  const f = checkLayout(copy, d).failures;
  sure(f.length === 1 && /storey 1: the window .* stands on the east wall, which is blind .*; a blind wall has no window and no entrance/.test(f[0]), `blind window: ${f.join(" | ")}`); // prettier-ignore
});
