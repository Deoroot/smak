// levels/assembly, the style (style.mjs, styles/house.json): a building's few rules beyond the contract, each with
// its source, its sizes read from levels/rules/architecture.json and turned into cells of 64. The house style's
// kinds come out in cells as the rulebook's metres give them; "doors": "auto" opens every room off its storey's
// hall and the kitchen onto the living room; house-02 is laid out with no failure at three seeds, the same seed
// giving the same JSON; and the same house laid out with the style keeps its rules where the bare layout breaks
// them (the measure of the round: the style's sentences with it and without it). The broken cases of checkStyle
// are in test/broken/levels.mjs.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test, sure, HERE } from "./helper.mjs";
import { readBuilding, checkBuilding } from "../levels/assembly/building.mjs";
import { layoutOf, layoutJson } from "../levels/assembly/layout.mjs";
import { loadStyle, checkStyle, doorsFor, largestRectangle } from "../levels/assembly/style.mjs";

const SPEC = JSON.parse(readFileSync(join(HERE, "../levels/specs/house-02.json"), "utf8"));
const style = loadStyle("house");

test("assembly style: the house's kinds in cells of 64 from architecture.json's metres, least up and greatest down", () => {
  const got = Object.fromEntries(Object.entries(style.kinds).map(([k, v]) => [k, [v.minArea, v.maxArea, v.minSide]]));
  const want = { hall: [2, 23, 2], living: [16, 34, 4], kitchen: [6, 18, 2], bedroom: [8, 22, 3], study: [8, 18, 3], bathroom: [2, Infinity, 2] }; // prettier-ignore
  sure(JSON.stringify(got) === JSON.stringify(want), `kinds in cells: ${JSON.stringify(got)}`);
  for (const [id, rule] of Object.entries(style.rules))
    sure(rule.source?.length && rule.source.every((s) => style.sources[s]), `rule ${id} names no source the style lists`);
});

test("assembly style: the largest rectangle of a room, and doors auto off each storey's hall with the kitchen on the living room", () => {
  const cells = [["a", "a", "a"], ["a", "a", null], ["a", "a", null]];
  const r = largestRectangle(cells, "a");
  sure(r.n === 6 && r.sides.join() === "2,3", `largest rectangle of an L: ${JSON.stringify(r)}`);
  const d = readBuilding(SPEC);
  const want = [["hall", "living"], ["hall", "kitchen"], ["hall", "study"], ["kitchen", "living"], ["landing", "bed1"], ["landing", "bed2"], ["landing", "bed3"], ["landing", "bath"]]; // prettier-ignore
  sure(JSON.stringify(d.doors) === JSON.stringify(want) && d.doorsAuto, `doors auto: ${JSON.stringify(d.doors)}`);
  sure(JSON.stringify(doorsFor(d, style)) === JSON.stringify(want), "doorsFor gives the same");
  const c = checkBuilding(SPEC);
  sure(!c.failures.length, `house-02 does not check: ${c.failures.join(" | ")}`);
});

test("assembly style: house-02 laid out with no failure at seeds 1 to 3, the style's rules kept, the same seed the same JSON", () => {
  for (const seed of [1, 2, 3]) {
    const l = layoutOf(SPEC, { seed });
    sure(!l.failures.length, `seed ${seed}: ${l.failures.join(" | ")}`);
    const s = checkStyle(l, readBuilding(SPEC), style);
    sure(!s.failures.length, `seed ${seed}, the style: ${s.failures.join(" | ")}`);
    const side = l.entrance.edges[0].from[1] === 0 && l.entrance.edges[0].to[1] === 0;
    sure(side, `seed ${seed}: the entrance is not on the south front: ${JSON.stringify(l.entrance.edges)}`);
    if (seed === 1) sure(layoutJson(layoutOf(SPEC, { seed })) === layoutJson(l), "seed 1 gave two different layouts");
  }
});

test("assembly style: the same house laid out bare breaks the style's rules the style keeps (seeds 1 to 4)", () => {
  const d = readBuilding(SPEC);
  const bare = { ...d };
  delete bare.style, delete bare.front;
  let withStyle = 0;
  let without = 0;
  for (const seed of [1, 2, 3, 4]) {
    withStyle += checkStyle(layoutOf(d, { seed }), d, style).failures.length;
    without += checkStyle(layoutOf(bare, { seed }), d, style).failures.length;
  }
  sure(withStyle === 0 && without > 0, `the style's failures over 4 seeds: ${withStyle} with it, ${without} without (it wants 0 with, more without)`); // prettier-ignore
});

test("assembly style: a corpus band is a FAIL only over at least 10 maps of the target game and kind; under that, or another game's, it is a NOTE", () => {
  const d = readBuilding(SPEC);
  const l = layoutOf(SPEC, { seed: 1 });
  const strict = (band) => ({ ...style, corpus: "tsrp", rules: { ...style.rules, compact: { ...style.rules.compact, value: 1.01, level: "fail", ...(band ? { band } : {}) } } }); // prettier-ignore
  const plain = checkStyle(l, d, strict(null));
  sure(plain.failures.length > 0 && !plain.notes.length, "a rule with no band keeps its level: " + plain.failures.length);
  const thin = checkStyle(l, d, strict({ n: 3, corpus: "tsrp" }));
  sure(!thin.failures.length && thin.notes.length === plain.failures.length && /^NOTE .*n=3 of tsrp.*at least 10 maps/.test(thin.notes[0]), thin.notes[0] ?? "no note");
  const other = checkStyle(l, d, strict({ n: 40, corpus: "l4d2" }));
  sure(!other.failures.length && other.notes.length > 0, "another game's band is a note");
  const own = checkStyle(l, d, strict({ n: 10, corpus: "tsrp" }));
  sure(own.failures.length === plain.failures.length && !own.notes.length, "ten maps of the target's corpus fail");
});
