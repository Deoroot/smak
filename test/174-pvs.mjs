// checkPvs (src/maps/pvs.mjs): the faces the engine draws from where players stand, from the compiled
// visibility, held on the kit's own two rooms (test/fixtures) in version 30 and in Xash's BSP2: what a spot in
// one room sees is less than the whole map; the spots' kinds; regions and points given; the picture.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../src/maps/index.mjs";
import { test, sure, HERE } from "./helper.mjs";

const read = (name) => readFileSync(join(HERE, "fixtures", name));
const v30 = maps.checkPvs(read("tworooms.bsp"));
const v2 = maps.checkPvs(read("tworooms-bsp2.bsp"));

test("checkPvs: the two rooms pass the budget, and a spot sees less than the whole map", () => {
  sure(v30.passed, `it should pass: ${v30.errors.join(" | ")}`);
  const total = maps.readBsp(read("tworooms.bsp")).faces.length;
  sure(v30.spawns.max < total, `the spawn in room A draws ${v30.spawns.max} of the ${total} faces: the vis keeps room C out of it`);
  sure(v30.spots.some((s) => s.kind === "spawn") && v30.spots.some((s) => s.kind === "floor"), "spawns and floor samples both");
  sure(/^median \d+ faces drawn \(budget 25000\), p90 \d+ \(36000\), max \d+, from \d+ spots$/.test(v30.said), v30.said);
});

test("checkPvs: BSP2 gives the same answer as version 30", () => {
  sure(maps.readBsp(read("tworooms-bsp2.bsp")).format === "bsp2", "the fixture is BSP2");
  sure(v2.passed && v2.overall.median === v30.overall.median && v2.overall.max === v30.overall.max, `${v2.said} / ${v30.said}`);
});

test("checkPvs: points and regions given are used, and the budget is the caller's", () => {
  const worst = v30.worst[0].origin;
  const given = maps.checkPvs(read("tworooms.bsp"), {
    floor: false,
    spawns: false,
    points: [{ name: "far", origin: worst }, [64, 64, 0]],
    regions: { everywhere: [-1e5, -1e5, 1e5, 1e5], nowhere: [5e4, 5e4, 6e4, 6e4] },
  });
  sure(given.spots.length === 2 && given.spots[0].name === "far" && given.spots[0].kind === "point", "two points, in the order given");
  const names = given.regions.map((r) => `${r.name}:${r.count}`).sort().join(",");
  sure(names === "everywhere:2,nowhere:0", names);
  sure(given.warnings.some((w) => /^no spot fell in 1 regions: nowhere$/.test(w)), given.warnings.join("|"));
  sure(!maps.checkPvs(read("tworooms.bsp"), { budget: { median: 1, p90: 1 } }).passed, "a budget of 1 face fails");
  sure(maps.pointsFrom({ points: [{ x: 1, y: 2, z: 3 }] })[0].origin.join() === "1,2,3", "points as { x, y, z }");
});

test("checkPvs: the heat map is a picture of the plan", () => {
  const picture = maps.pvsPicture(maps.readBsp(read("tworooms.bsp")), v30);
  sure(picture.width > 100 && picture.rgba.length === picture.width * picture.height * 4, "a picture");
  sure(/^0 to 72000 faces/.test(picture.facts.ramp), picture.facts.ramp);
});
