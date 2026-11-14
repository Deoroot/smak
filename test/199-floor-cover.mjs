// The floor's faces (check/maps/cover.mjs floorCover, smak map-cover, the battery's cover): where a trace down stops on
// the world's solid and no face lies there, the game draws a hole. hlbsp dropped such faces from a field of turned
// prisms on a vehicle map's first build (2026-11-14); that cannot be had on demand, so the broken map here is the kit's
// two rooms compiled, with one face of the east room's floor given no edges in the face lump. With the compilers
// (VHLT_DIR), a room with what must not read as a hole: a CLIP slab (hull 1 solid, hull 0 empty), a func_wall step, a
// trigger on the floor, and a field of turned prisms in func_detail.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../check/maps/index.mjs";
import { test, sure, HERE, SMAK_CLI, runRefused, tmp } from "./helper.mjs";

const FIXTURES = join(HERE, "fixtures");
const tworooms = readFileSync(join(FIXTURES, "tworooms.bsp"));
/** Face 11 of the two rooms: the east room's floor, x 224 to 320, y 0 to 224, at z 0. */
const FLOOR_FACE = 11;
const holed = (() => {
  const bytes = Buffer.from(tworooms);
  bytes.writeUInt16LE(0, maps.locateLumps(bytes).lumps.faces.offset + FLOOR_FACE * 20 + 8);
  return bytes;
})();

test("the kit's fixtures have a face on every floor, walked or the whole grid", () => {
  for (const name of ["tworooms.bsp", "tworooms-bsp2.bsp", "skygap.bsp"]) {
    const bytes = readFileSync(join(FIXTURES, name));
    for (const walk of [true, false]) {
      const report = maps.floorCover(bytes, { walk });
      sure(report.passed && report.level === "PASS" && report.samples > 100 && !report.warnings.length, `${name} walk ${walk}: ${report.said}`);
      sure(new RegExp(`^every floor sample has its face \\(\\d+ samples of the ${walk ? "walked" : "standable"} floor every 16 units\\)$`).test(report.said), report.said); // prettier-ignore
    }
  }
});

test("a floor face taken out: one place, where the face was and as large, a FAIL on the walked floor with what to do", () => {
  const report = maps.floorCover(holed);
  sure(report.level === "FAIL" && report.places.length === 1, report.said);
  const [hole] = report.places;
  sure(hole.at[0] > 224 && hole.at[0] < 320 && hole.at[1] > 0 && hole.at[1] < 224 && Math.abs(hole.at[2]) < 0.01, JSON.stringify(hole));
  sure(hole.size[0] <= 96 && hole.size[1] <= 224 && hole.size[1] >= 160, `the face is 96 x 224, less the walls' margin: ${hole.size}`);
  sure(report.share > 0.1 && report.uncovered === hole.samples, `${report.uncovered} of ${report.samples}`);
  sure(/^\d+ of \d+ samples of the walked floor every 16 units \(\d+(\.\d)?%\) have solid under them and no face, in 1 places, the largest \d+ samples at 2\d\d 1\d\d 0: hlbsp drops faces of non-axial brushes .*func_detail.*-noinsidefill.*Ambiguous leafnode/.test(report.said), report.said); // prettier-ignore
  // the whole grid counts roofs nobody sees: there a hole is a warning at most
  const grid = maps.floorCover(holed, { walk: false });
  sure(grid.level === "WARN" && grid.places.length === 1 && grid.failures.length === 0, grid.said);
  // a finer grid finds the same place, with more samples
  const fine = maps.floorCover(holed, { step: 8 });
  sure(fine.places.length === 1 && fine.places[0].samples > hole.samples * 3, `${fine.places[0]?.samples} against ${hole.samples}`);
});

test("a floor meant to have no face is ignored by a box; the other faces of the map do not cover a face taken out", () => {
  const ignored = maps.floorCover(holed, { ignore: [{ min: [224, 0, -8], max: [320, 224, 8] }] });
  sure(ignored.passed, ignored.said);
  const half = maps.floorCover(holed, { ignore: [{ min: [224, 0, -8], max: [320, 112, 8] }] });
  sure(!half.passed && half.places[0].at[1] > 112, JSON.stringify(half.places));
});

test("the battery asks it, after the sky gaps, and looks at each hole from above", () => {
  const whole = maps.mapBattery(tworooms);
  const cover = whole.checks.find((check) => check.name === "cover");
  sure(cover?.level === "PASS" && /^every floor sample has its face/.test(cover.said), JSON.stringify(cover));
  sure(whole.checks.map((check) => check.name).indexOf("cover") === whole.checks.map((check) => check.name).indexOf("skygaps") + 1, "after skygaps");
  const broken = maps.mapBattery(holed);
  const failed = broken.checks.find((check) => check.name === "cover");
  sure(failed.level === "FAIL" && failed.detail.some((line) => /^WARN floor with no face at 2\d\d 1\d\d 0: /.test(line)), failed.detail.join(" | "));
  sure(broken.views.some((view) => /^floor with no face at /.test(view.name) && view.from[2] > view.to[2]), JSON.stringify(broken.views));
});

test("smak map-cover: PASS on the two rooms, FAIL with exit 1 on the face taken out, WARN with --no-walk", () => {
  const file = join(tmp, "holed.bsp");
  writeFileSync(file, holed);
  const passed = runRefused(SMAK_CLI, "map-cover", join(FIXTURES, "tworooms.bsp"));
  sure(passed.code === 0 && /^PASS: every floor sample has its face/m.test(passed.out), `${passed.code}: ${passed.out}${passed.err}`);
  const failed = runRefused(SMAK_CLI, "map-cover", file);
  const lines = failed.out.trim().split(/\r?\n/);
  sure(failed.code === 1 && /^FAIL: \d+ of \d+ samples of the walked floor/.test(lines.at(-1)), `${failed.code}: ${failed.out}${failed.err}`);
  sure(/^WARN {2}floor with no face at 2\d\d 1\d\d 0: \d+ samples over/.test(lines[0]), lines[0]);
  const grid = runRefused(SMAK_CLI, "map-cover", file, "--no-walk", "--step", "8");
  sure(grid.code === 1 && /^WARN: \d+ of \d+ samples of the standable floor every 8 units/m.test(grid.out), `${grid.code}: ${grid.out}${grid.err}`);
});

const compilers = process.env[maps.COMPILERS_VARIABLE] ? maps.findCompilers() : { found: false };
if (!compilers.found) console.log(`skip  a room with a CLIP slab, a func_wall step, a trigger and turned prisms in func_detail, compiled\n      skipped: no compilers (name the folder of VHLT in ${maps.COMPILERS_VARIABLE} to run it)`); // prettier-ignore
else
  test("compiled: a CLIP slab, a func_wall step, a trigger on the floor and a field of turned prisms in func_detail read as no hole", () => {
    const folder = join(tmp, "cover-room");
    mkdirSync(folder, { recursive: true });
    const wad = join(folder, "cover.wad");
    writeFileSync(wad, maps.writeWad(["WALL", "AAATRIGGER"].map((name) => ({ name, image: { width: 16, height: 16, rgb: new Uint8Array(16 * 16 * 3).fill(120) } })))); // prettier-ignore
    // prisms 32 wide along x, each a wedge rising to the east or the west by turns: a field of slopes
    const prisms = Array.from({ length: 6 }, (_, k) => maps.wedge([256 + k * 32, 32, 0], [288 + k * 32, 224, 16], k % 2 ? "-x" : "+x", "WALL"));
    const map = {
      worldspawn: { wad: [wad] },
      brushes: [...maps.hollow([0, 0, 0], [512, 256, 160], 16, "WALL"), maps.box([32, 32, 0], [96, 96, 24], "CLIP")],
      entities: [
        maps.playerStart([64, 192, 0], 0),
        maps.light([256, 128, 128], { brightness: 300 }),
        maps.brushEntity("func_wall", [maps.box([128, 32, 0], [192, 96, 16], "WALL")]),
        maps.brushEntity("trigger_once", [maps.box([128, 160, 0], [192, 224, 48], "AAATRIGGER")]),
        maps.brushEntity("func_detail", prisms),
      ],
    };
    const file = join(folder, "cover.map");
    writeFileSync(file, maps.writeMap(map));
    const made = maps.compileMap(file, { fast: true, compilers, wads: [wad], engine: "xash" });
    sure(made.bsp, made.errors.join("; "));
    for (const walk of [true, false]) {
      const report = maps.floorCover(readFileSync(made.bsp), { walk });
      sure(report.passed, `walk ${walk}: ${report.said} | ${report.warnings.join(" | ")}`);
    }
  });
