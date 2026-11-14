// The drive check (check/maps/drive.mjs, smak map-drive): a vehicle's way along a line, read off a compiled map. On the kit's
// own fixture (test/fixture-drive.mjs, five roads: whole, a pit, a step, no north wall, a block on the line; the .bsp is
// compiled once with the compilers and kept in test/fixtures, so the test needs none). With VHLT_DIR the fixture is made again
// and the same roads checked. The broken cases are in test/broken/maps.mjs.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../check/maps/index.mjs";
import { driveMap, lineOf, ROADS } from "./fixture-drive.mjs";
import { test, sure, HERE, SMAK_CLI, runRefused, tmp } from "./helper.mjs";

const FIXTURES = join(HERE, "fixtures");
const bytes = readFileSync(join(FIXTURES, "drive.bsp"));
const road = (name, options = {}) => maps.driveOf(bytes, { points: lineOf(name), ...options });

test("the fixture's .map is what test/fixture-drive.mjs makes", () => {
  const written = maps.writeMap({ ...driveMap(), worldspawn: { wad: "drive.wad" } }).replace(/\r\n/g, "\n");
  sure(written === readFileSync(join(FIXTURES, "drive.map"), "utf8").replace(/\r\n/g, "\n"), "run node test/fixture-drive.mjs with VHLT_DIR and commit the files");
});

test("the whole road: floor everywhere, no step, no slope, nothing solid, walls 128 out on both sides, one PASS sentence", () => {
  const whole = road("a", { side: 300 });
  sure(whole.passed && !whole.warnings.length && whole.samples === 31, JSON.stringify(whole.warnings));
  sure(whole.step.v === 0 && whole.slope.v === 0 && whole.walls.min === 128 && whole.walls.max === 136 && whole.walls.open === 0, JSON.stringify(whole.walls));
  sure(/^31 samples every 32 units along 2 points, hull 0; floor everywhere, steps up to 0, slopes up to 0%, nothing solid on the line, a wall on every side within 300$/.test(whole.said), whole.said);
  const wide = road("a", { side: 300, half: 100 });
  sure(wide.walls.min === 32 && wide.walls.max === 32, `from the road's edge: ${JSON.stringify(wide.walls)}`);
  sure(road("a").facts.length === 2, "walls are not looked for unless --side is given");
});

test("each measure has its place: the pit's two samples, the step's 24 and 75%, the block on the line, the open side's 31 of 62", () => {
  sure(road("b").noFloor.join("; ") === "416 512 0; 448 512 0", road("b").noFloor.join("; "));
  const step = road("c");
  sure(step.step.v === 24 && step.slope.v === 75 && step.bump.v === 75 && step.step.at === "608 1024 0", JSON.stringify([step.step, step.slope, step.bump]));
  sure(road("e").blocked.join() === "512 2048 0" && road("d", { side: 300 }).walls.open === 31, "block, open side");
  sure(!road("c", { maxStep: 30, maxSlope: 80, maxBump: 80 }).warnings.length, "limits are options");
});

test("the line from entities: ordered by a number, else nearest next; closed adds the way back; two points needed", () => {
  const [a, b] = lineOf("a");
  const entity = (class_, p, n) => [["classname", class_], ["origin", p.join(" ")], ...(n === undefined ? [] : [["order", String(n)]])];
  const given = maps.readBsp(maps.withEntities(bytes, [...maps.readBsp(bytes).entities, entity("drive_point", b, 2), entity("drive_point", a, 1), entity("drive_point", [512, 0, 0], 1.5)]));
  sure(maps.lineFrom(given, { class: "drive_point", key: "order" }).map((p) => p[0]).join() === "32,512,992", "ordered by the number");
  const near = maps.lineFrom(given, { class: "drive_point" }).map((p) => p[0]);
  sure(near.length === 3 && near[0] === 992, `nearest next from the first listed: ${near}`);
  sure(maps.driveOf(given, { class: "drive_point", key: "order" }).samples === 31, "a line by class and key is the road");
  sure(maps.driveOf(bytes, { points: lineOf("a"), closed: true }).samples === 61, "closed: there and back");
  for (const [options, said] of [[{}, /a line of two points/], [{ class: "none_here" }, /no entity of class none_here/]]) {
    try {
      maps.driveOf(bytes, options);
      sure(false, "no refusal");
    } catch (error) {
      sure(said.test(error.message), error.message);
    }
  }
});

test("smak map-drive: the warnings, the detail in a file, PASS or FAIL last, exit code 1 on FAIL, --json", () => {
  const file = join(FIXTURES, "drive.bsp");
  const points = join(tmp, "drive-points.json");
  mkdirSync(tmp, { recursive: true });
  writeFileSync(points, JSON.stringify(lineOf("b")));
  const bad = runRefused(SMAK_CLI, "map-drive", file, "--points", points, "--report", join(tmp, "drive-b.txt"));
  const lines = bad.out.trim().split(/\r?\n/);
  sure(bad.code === 1 && /^WARN  2 samples with no floor within 200 under them \(hull 0\), at 416 512 0; 448 512 0$/.test(lines[0]), bad.out);
  sure(/^FAIL: 1 of the drive's measures over their limit \(floor\); 31 samples every 32 units along 2 points, hull 0$/.test(lines.at(-1)), lines.at(-1));
  sure(readFileSync(join(tmp, "drive-b.txt"), "utf8").includes("floor-less 2; largest step"), "the detail file");
  const good = runRefused(SMAK_CLI, "map-drive", file, "--points", JSON.stringify(lineOf("a")), "--side", "300", "--json");
  sure(good.code === 0 && JSON.parse(good.out).passed === true && JSON.parse(good.out).walls.min === 128, good.out);
  const text = runRefused(SMAK_CLI, "map-drive", file, "--points", JSON.stringify(lineOf("a")), "--hull", "1");
  sure(text.code === 0 && /^PASS: 31 samples/.test(text.out.trim().split(/\r?\n/).at(-1)), text.out);
  sure(runRefused(SMAK_CLI, "map-drive", file, "--line", "name:x").code === 1, "--line takes class:<name>");
  sure(ROADS.e === 2048, "the roads");
});
