// The city join (levels/experimental-city/city-join.mjs): two small tiles, each carved alone and capped at its seam as stage 10
// caps one, joined into one map. The seam's caps taken off (the corridor open across the seam, the portal check
// passing where the two tiles side by side are shut), the outer caps kept, a deeper tile's cap kept under its
// shallower neighbour, a clashing name renamed with its references, the names shared by design kept (a pair named
// by the description, the alarm's sounds, a target in the other tile), one worldspawn with the wads merged in order
// and a conflict told, one light_environment; the joined map passing the checks, and the seam flood finding the leak
// when the piece under the shallower neighbour is taken away.
import { test, sure } from "./helper.mjs";
import { joinTiles, cityChecks, portalsOpen, seamLeaks, mergeOrdered, splitBrush } from "../levels/experimental-city/city-join.mjs";
import { carvePlan } from "../src/maps/ground.mjs";
import { box, brushEntity, light, playerStart, holds, shapeOf } from "../src/maps/source.mjs";

const desc = {
  name: "twin",
  tiles: { size: [8, 8], origin: [0, 0], cols: 2, rows: 1 },
  grid: { cellUnits: 128, origin: [0, 0] },
  engine: { limits: { brushes: { value: 2000 }, structural: { value: 1000 }, rock: { value: 1000 }, brushModels: { value: 50 }, entities: { value: 50 }, extent: { value: 32768 } } }, // prettier-ignore
  connectors: [{ id: "gate_pair" }],
};
/** A corridor from x0 to x1 (units) across y 384..640, carved alone and clipped to its tile as stage 10 clips. */
const rock = (x0, x1, floor) => carvePlan([{ outline: [[x0, 384], [x1, 384], [x1, 640], [x0, 640]], floor, ceiling: 192 }], 64, "crete33"); // prettier-ignore
const leaf = (x) => box([x, 400, 0], [x + 8, 496, 128], "door1");
const A = {
  id: "c0_r0",
  map: {
    worldspawn: { wad: ["a.wad", "c.wad"], skyname: "sky1", message: "twin c0_r0" },
    brushes: rock(0, 1024, -128),
    entities: [
      playerStart([256, 512, 0], 0, "info_player_deathmatch"),
      light([512, 512, 160], {}),
      { classname: "light_environment", origin: "512 512 100", _light: "255 255 255 200" },
      brushEntity("func_door", [leaf(300)], { targetname: "door_1" }),
      brushEntity("func_button", [box([200, 640 - 4, 48], [216, 640, 64], "button")], { target: "door_1" }),
      brushEntity("func_door", [leaf(1000)], { targetname: "gate_pair" }),
      { classname: "ambient_generic", origin: "600 512 100", targetname: "alarm_city", message: "a.wav" },
      { classname: "info_target", origin: "700 512 100", targetname: "a_only" },
    ],
  },
};
const B = {
  id: "c1_r0",
  map: {
    worldspawn: { wad: ["b.wad", "c.wad"], skyname: "sky2", message: "twin c1_r0" },
    brushes: rock(1024, 1920, 0),
    entities: [
      light([1500, 512, 160], {}),
      { classname: "light_environment", origin: "1500 512 100", _light: "255 255 255 300" },
      brushEntity("func_door", [leaf(1400)], { targetname: "door_1" }),
      brushEntity("func_button", [box([1300, 640 - 4, 48], [1316, 640, 64], "button")], { target: "door_1" }),
      brushEntity("func_button", [box([1200, 640 - 4, 48], [1216, 640, 64], "button")], { target: "a_only" }),
      brushEntity("func_door", [leaf(1030)], { targetname: "gate_pair" }),
      { classname: "ambient_generic", origin: "1600 512 100", targetname: "alarm_city", message: "a.wav" },
    ],
  },
};
A.rock = A.map.brushes.length;
B.rock = B.map.brushes.length;
const tiles = [B, A]; // any order: joined south to north, west to east
const portal = { id: "p_corridor", seam: "c0_r0|c1_r0", at: [8, 4], z: 0, width: 2 };
const inWorld = (map, p) => map.brushes.some((b) => holds(b, p, -0.5));

test("city join: the seam's caps off, the outer caps and a deeper tile's cap under its neighbour kept", () => {
  const { map, report } = joinTiles(desc, tiles);
  // before: the two tiles side by side are shut at the seam (each one's cap)
  const raw = { brushes: [...A.map.brushes, ...B.map.brushes] };
  sure(inWorld(raw, [1056, 512, 96]) && inWorld(raw, [1000, 512, 96]), "the tiles alone cap the seam");
  sure(!portalsOpen(raw, desc, [portal])[0].open, "the portal is shut before the join");
  // after: open across the seam, either side
  sure(!inWorld(map, [1056, 512, 96]) && !inWorld(map, [992, 512, 96]), "a cap is left on the seam");
  const P = portalsOpen(map, desc, [portal]);
  sure(P[0].open && P[0].all, `the portal: ${JSON.stringify(P[0])}`);
  // the city's border: A's west cap and B's east cap stay
  sure(inWorld(map, [-32, 512, 96]), "A's outer (west) cap is gone");
  sure(inWorld(map, [1920 + 32, 512, 96]), "B's outer (east) cap is gone");
  // A is deeper (its floor -128, B's 0): its cap past the seam below B's carve stays
  sure(inWorld(map, [1024 + 32, 512, -100]), "A's cap under the shallower B is gone");
  sure(report.caps.c1_r0.dropped > 0, JSON.stringify(report.caps));
  sure(report.caps.c0_r0.keptBeyond > 0, "no piece of A kept under B");
  for (const b of map.brushes) sure(!shapeOf(b).faults.length, `a brush is unsound: ${shapeOf(b).faults[0]}`);
});

test("city join: one worldspawn and one light_environment, a clashing name renamed, shared names kept", () => {
  const { map, report } = joinTiles(desc, tiles);
  sure(report.tiles.join() === "c0_r0,c1_r0", report.tiles.join());
  sure(map.worldspawn.wad.join() === "a.wad,b.wad,c.wad", map.worldspawn.wad.join());
  sure(map.worldspawn.skyname === "sky1" && report.conflicts.some((c) => c.includes("skyname") && c.includes("sky2")), report.conflicts.join("; ")); // prettier-ignore
  sure(map.worldspawn.message === "twin", map.worldspawn.message);
  sure(map.entities.filter((e) => e.classname === "light_environment").length === 1 && report.lightEnvironment === "c0_r0", "light_environment"); // prettier-ignore
  sure(report.notes.some((n) => n.includes("_light")), report.notes.join("; "));
  // door_1 on both tiles: B's renamed, its button with it; A's untouched
  const doors = map.entities.filter((e) => e.classname === "func_door").map((e) => e.targetname);
  sure(doors.includes("door_1") && doors.includes("door_1_c1r0"), doors.join());
  const targets = map.entities.filter((e) => e.classname === "func_button").map((e) => e.target);
  sure(targets.includes("door_1") && targets.includes("door_1_c1r0") && targets.includes("a_only"), targets.join());
  sure(report.renames.length === 1 && report.renames[0].tile === "c1_r0", JSON.stringify(report.renames));
  // shared by design: the description's pair across the seam, the alarm's sounds
  sure(doors.filter((n) => n === "gate_pair").length === 2, "the pair across the seam was renamed");
  const shared = Object.fromEntries(report.shared.map((s) => [s.name, s.why]));
  sure(/description/.test(shared.gate_pair) && /sounds/.test(shared.alarm_city), JSON.stringify(shared));
  sure(mergeOrdered([["x", "z"], ["y", "z"], ["w"]]).join() === "x,y,z,w", "mergeOrdered");
});

test("city join: the joined map passes the checks; the seam flood finds the leak a missing cap makes", () => {
  const { map, report, origin } = joinTiles(desc, tiles);
  const c = cityChecks(map, desc, tiles, [portal], { rock: report.rock, origin, shared: report.shared });
  sure(!c.failures.length, c.failures.slice(0, 3).join(" | "));
  sure(c.counts.edicts === map.entities.filter((e) => !["light", "light_environment"].includes(e.classname) || e.targetname).length + 1, `edicts ${c.counts.edicts}`); // prettier-ignore
  sure(c.seams.length === 1 && !c.seams[0].leak && c.seams[0].seeds > 0, JSON.stringify(c.seams));
  // the piece of A's cap under B taken away: the deep end of A's corridor opens to the void
  const broken = { ...map, brushes: map.brushes.filter((b) => !origin.get(b)?.beyond) };
  const s = seamLeaks(broken, desc, tiles);
  sure(s[0].leak, "the seam flood found no leak with the cap under the shallower tile gone");
});

test("city join: a brush cut on a plane gives two sound brushes that fill it", () => {
  const b = box([0, 0, 0], [100, 50, 40], "crete33");
  const { below, above } = splitBrush(b, 0, 30);
  const v = (x) => shapeOf(x).volume;
  sure(below && above && Math.abs(v(below) + v(above) - v(b)) < 1e-6, "volumes");
  sure(shapeOf(below).max[0] === 30 && shapeOf(above).min[0] === 30, "the cut");
  sure(splitBrush(b, 0, 200).below === b && splitBrush(b, 2, -5).above === b, "a brush on one side comes back whole");
});
