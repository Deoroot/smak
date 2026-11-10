// The battery over a built map (src/maps/battery.mjs, smak map-battery): every player-facing check of a compiled map in
// one place, hand-made or not, read off the .bsp (and the .map when given). On the kit's own fixtures: the two rooms (a
// spawn that looks at a wall 96 off, a room behind a grate), the sky-gap rooms (a slit, a spawn in a wall, a sealed room).
// With the compilers (VHLT_DIR), a door with a pillar before it compiled. Beside it, what the battery asked of the checks
// it calls: reachOf says a room-sized floor not walked to as a warning, lightReport takes a box of any height and says a
// room not walked to, sweepOf gives up on a map too large with a sentence.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../src/maps/index.mjs";
import { islandsOf } from "../src/maps/sweep.mjs";
import { test, sure, HERE, SMAK_CLI, runRefused, tmp } from "./helper.mjs";

const FIXTURES = join(HERE, "fixtures");
const bytesOf = (name) => readFileSync(join(FIXTURES, name));
const tworooms = bytesOf("tworooms.bsp");
const skygap = bytesOf("skygap.bsp");
const tworoomsMap = maps.readMap(readFileSync(join(FIXTURES, "tworooms.map"), "utf8"));
/** The sky-gap fixture's three rooms (test/fixture-skygap.mjs ROOMS), as boxes a floor's light is told by. */
const BOXES = { a: [0, 256], b: [288, 544], c: [576, 832] };
const roomsOf = (high) => Object.fromEntries(Object.entries(BOXES).map(([name, [x0, x1]]) => [name, { min: [x0, 0, -8], max: [x1, 256, high] }]));
const byName = (report) => Object.fromEntries(report.checks.map((check) => [check.name, check]));

test("the two rooms: a spawn looking at a wall 96 off fails, the room behind the grate is a warning, every check answers", () => {
  const report = maps.mapBattery(tworooms, { map: tworoomsMap });
  const c = byName(report);
  sure(report.checks.map((check) => check.name).join() === "reach,light,fronts,spawns,skygaps,coplanar,pvs,budget,sweep,compile", report.checks.map((check) => check.name).join()); // prettier-ignore
  sure(c.spawns.level === "FAIL" && /^info_player_start 1 at 96 96 40, looking yaw 90: the first solid is 96 units away, under 128; the longest open way is yaw 0/.test(c.spawns.said), c.spawns.said); // prettier-ignore
  sure(c.reach.level === "WARN" && /^1 parts of the floor the size of a room .* behind 4 func_wall/.test(c.reach.said), c.reach.said);
  sure(c.fronts.level === "PASS" && /0 doors and 1 openings, 2 fronts/.test(c.fronts.said), c.fronts.said);
  for (const name of ["light", "skygaps", "coplanar", "pvs", "budget", "sweep"]) sure(c[name].level === "PASS", `${name}: ${c[name].said}`);
  sure(c.compile.level === "PASS" && /not asked/.test(c.compile.said), c.compile.said);
  sure(report.level === "FAIL" && report.line === "FAIL: 1 of 10 checks fail (spawns), 1 warn (reach), 8 pass", report.line);
  sure(report.views.some((view) => view.name === "spawn 1" && view.yaw === 90), JSON.stringify(report.views));
});

test("the sky-gap rooms: the spawn in the wall fails the walk, the slit is a warning seen from its eye, the sealed room is not walked to", () => {
  const report = maps.mapBattery(skygap, { rooms: roomsOf(120) });
  const c = byName(report);
  sure(c.reach.level === "FAIL" && /^1 entities stand in something solid/.test(c.reach.said), c.reach.said);
  sure(c.reach.detail.some((line) => /^WARN 2 parts of the floor the size of a room .*704 128 0 \(floor z 0\): no opening leads to it/.test(line)), c.reach.detail.join(" | ")); // prettier-ignore
  sure(c.skygaps.level === "WARN" && /^sky seen from 244 128 64 looking yaw \d+ pitch \d+: a gap 2\.\d units wide/.test(c.skygaps.said), c.skygaps.said); // prettier-ignore
  sure(report.views.some((view) => /^sky gap 2\.\d wide/.test(view.name) && view.from.join() === "244,128,64"), JSON.stringify(report.views));
  sure(c.light.detail.some((line) => /^not walked to \(lit floor, none of it walked, so its light is not measured\): b; c$/.test(line)), c.light.detail.join(" | ")); // prettier-ignore
  sure(c.coplanar.said === "not asked: give the .map (--map)", c.coplanar.said);
});

test("compile: a log's warnings are grouped (a WARN) and an error line FAILs", () => {
  const log = ["hlbsp v1", "Warning: Ambiguous leafnode content ( -1 -2 -3 )", "Warning: Ambiguous leafnode content ( 4 5 6 )", "done"].join("\n");
  const warned = byName(maps.mapBattery(tworooms, { log })).compile;
  sure(warned.level === "WARN" && /^2 warnings "Ambiguous leafnode content"/.test(warned.said), warned.said);
  const failed = byName(maps.mapBattery(tworooms, { log: `${log}\nError: a brush with no volume` })).compile;
  sure(failed.level === "FAIL" && failed.said === "Error: a brush with no volume", failed.said);
});

test("reachOf: a part the size of a room not walked to is a warning, a roof open to the sky over the walked floor is not", () => {
  const behind = maps.reachOf(maps.readBsp(tworooms));
  sure(behind.warnings.some((w) => /^1 parts of the floor the size of a room \(16384 square units or more, at most 320 over the highest floor walked, 0\) are reached only by a jump or not at all/.test(w)), behind.warnings.join(" | ")); // prettier-ignore
  const opened = maps.reachOf(maps.readBsp(tworooms), { open: "func_wall" });
  sure(!opened.warnings.some((w) => /size of a room/.test(w)), opened.warnings.join(" | "));
  const roofs = maps.reachOf(maps.readBsp(skygap));
  const said = roofs.warnings.find((w) => /size of a room/.test(w));
  sure(roofs.parts.some((part) => part.how === "air" && part.floors[0] === 132) && !/floor z 132/.test(said), said);
});

test("lightReport: a box of any height (a floor is of the box whose foot is nearest under it), a room not walked to said so", () => {
  const bsp = maps.readBsp(skygap);
  // two boxes round room a's floor, of one volume (as a portico's and its gallery's are when both are tall): the floor is
  // of the one whose foot is nearer under it, the second, where the first listed of the smallest took it
  const stacked = maps.lightReport(bsp, { rooms: { below: { min: [0, 0, -100], max: [256, 256, 400] }, over: { min: [0, 0, -8], max: [256, 256, 492] } } }); // prettier-ignore
  const [below, over] = stacked.rooms;
  sure(below.area === 0 && over.area > 0, JSON.stringify(stacked.rooms));
  for (const high of [120, 400, 1200]) {
    const report = maps.lightReport(bsp, { rooms: roomsOf(high), reach: maps.reachOf(bsp) });
    const told = Object.fromEntries(report.rooms.map((room) => [room.name, room]));
    sure(told.a.area > 0 && told.a.walked === true && told.b.walked === false && told.c.walked === false, `${high}: ${JSON.stringify(report.rooms)}`); // prettier-ignore
  }
});

test("sweepOf: a map too large to look over for floating solid gives up in a sentence, not out of memory", () => {
  const notes = [];
  const found = islandsOf({ models: [{ mins: [-16384, -16384, -4096], maxs: [16384, 16384, 4096] }] }, notes);
  sure(found.length === 0 && /^the pieces of solid that touch nothing were not looked for: the map is \d+ x \d+ x \d+ units, \d+ million cells of 16, over the 48 million a sweep holds$/.test(notes[0]), notes.join(" | ")); // prettier-ignore
});

test("smak map-battery: a line a check, the detail in battery.txt, the pictures named, FAIL last and exit code 1", () => {
  const out = join(tmp, "battery-tworooms");
  const run = runRefused(SMAK_CLI, "map-battery", join(FIXTURES, "tworooms.bsp"), "--map", join(FIXTURES, "tworooms.map"), "-o", out);
  const lines = run.out.trim().split(/\r?\n/);
  sure(run.code === 1, `exit ${run.code}: ${run.err}`);
  sure(/^spawns +FAIL: info_player_start 1/.test(lines[3]) && /^reach +WARN: /.test(lines[0]), lines.slice(0, 4).join(" | "));
  sure(lines.at(-1) === "FAIL: 1 of 10 checks fail (spawns), 1 warn (reach), 8 pass", lines.at(-1));
  for (const file of ["battery.txt", "battery-reach.png", "battery-pvs.png", "battery-views.png"]) sure(existsSync(join(out, file)) && run.out.includes(join(out, file)), `${file}: ${run.out}`); // prettier-ignore
  sure(readFileSync(join(out, "battery.txt"), "utf8").includes("spawns FAIL: info_player_start 1 at 96 96 40"), "the detail");
});

const compilers = process.env[maps.COMPILERS_VARIABLE] ? maps.findCompilers() : { found: false };
if (!compilers.found) console.log(`skip  a door with a pillar 40 before it, compiled and run through the battery\n      skipped: no compilers (name the folder of VHLT in ${maps.COMPILERS_VARIABLE} to run it)`); // prettier-ignore
else
  test("compiled: a func_door with a pillar 40 before it fails its front; the same door clear passes", () => {
    const folder = join(tmp, "battery-door");
    mkdirSync(folder, { recursive: true });
    const wad = join(folder, "battery.wad");
    writeFileSync(wad, maps.writeWad([{ name: "WALL", image: { width: 16, height: 16, rgb: new Uint8Array(16 * 16 * 3).fill(120) } }]));
    const built = (pillar) => {
      // two rooms of 256 joined through a wall at x 256..272 by a doorway 64 wide, a door in it; the pillar 40 east of it
      const brushes = [
        ...maps.hollow([0, 0, 0], [528, 256, 160], 16, "WALL"),
        maps.box([256, 0, 0], [272, 96, 160], "WALL"),
        maps.box([256, 160, 0], [272, 256, 160], "WALL"),
        maps.box([256, 96, 112], [272, 160, 160], "WALL"),
        ...(pillar ? [maps.box([312, 112, 0], [344, 144, 160], "WALL")] : []),
      ];
      const map = { worldspawn: { wad: [wad] }, brushes, entities: [maps.playerStart([64, 128, 0], 0), maps.light([128, 128, 128], { brightness: 300 }), maps.light([400, 128, 128], { brightness: 300 }), maps.brushEntity("func_door", [maps.box([262, 96, 0], [266, 160, 112], "WALL")], { angles: "0 90 0" })] }; // prettier-ignore
      const file = join(folder, `door-${pillar ? "pillar" : "clear"}.map`);
      writeFileSync(file, maps.writeMap(map));
      const made = maps.compileMap(file, { fast: true, compilers, wads: [wad], engine: "xash" });
      sure(made.bsp, made.errors.join("; "));
      return byName(maps.mapBattery(readFileSync(made.bsp), { map, log: made.logs.map((log) => log.text).join("\n") }));
    };
    const blocked = built(true);
    sure(blocked.fronts.level === "FAIL" && blocked.fronts.detail.some((line) => /^FAIL func_door \d+ at 264 128 0, its east front: a wall of the world stands 4\d units before it at 40 over its floor, under the 72/.test(line)), blocked.fronts.detail.join(" | ")); // prettier-ignore
    const clear = built(false);
    sure(clear.fronts.level === "PASS" && /^1 doors and/.test(clear.fronts.said), clear.fronts.said);
    sure(clear.spawns.level === "PASS" && clear.reach.level !== "FAIL", `${clear.spawns.said} | ${clear.reach.said}`);
  });
