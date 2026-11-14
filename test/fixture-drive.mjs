// The kit's own small map for the drive check (test/fixtures/drive.map and .bsp): a closed hall with five roads side by side
// (each 1024 long along x, 256 across, walls 16 thick at both edges, the floor at z 0 over a hall floor 512 lower), one fault
// to a road: A is whole; B has a pit across it (a gap of 64 with no floor within reach); C steps up 24 half way; D has no
// wall on its north side; E has a block across it, 96 high. Run this file to write the .map and, where VHLT_DIR names the
// compilers, the .bsp (test/fixtures/README.md).
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as maps from "../check/maps/index.mjs";

const T = "DRVWALL";
/** The roads' centre lines (y), 512 apart, the roads 256 wide, and the pit's x range, the step's x, and the block's x range. */
export const ROADS = { a: 0, b: 512, c: 1024, d: 1536, e: 2048 };
export const PIT = [400, 464];
export const STEP_AT = 600;
export const BLOCK = [500, 532];
/** The line down the middle of a road, from x 32 to 992. */
export const lineOf = (road) => [[32, ROADS[road], 0], [992, ROADS[road], 0]];

export function driveMap() {
  const wall = (road, side) => maps.box([0, ROADS[road] + side * 128 - (side > 0 ? 0 : 16), -512], [1024, ROADS[road] + side * 128 + (side > 0 ? 16 : 0), 128], T);
  const slab = (road, x0, x1, top) => maps.box([x0, ROADS[road] - 128, -512], [x1, ROADS[road] + 128, top], T);
  const brushes = [
    ...maps.hollow([-64, -256, -512], [1088, 2304, 320], 16, T),
    slab("a", 0, 1024, 0),
    slab("b", 0, PIT[0], 0),
    slab("b", PIT[1], 1024, 0),
    slab("c", 0, STEP_AT, 0),
    slab("c", STEP_AT, 1024, 24),
    slab("d", 0, 1024, 0),
    slab("e", 0, 1024, 0),
    maps.box([BLOCK[0], ROADS.e - 128, 0], [BLOCK[1], ROADS.e + 128, 96], T),
    ...["a", "b", "c", "e"].flatMap((road) => [wall(road, 1), wall(road, -1)]),
    wall("d", -1),
  ];
  return { worldspawn: {}, brushes, entities: [maps.playerStart([32, 0, 16], 0), maps.light([512, 256, 200], { brightness: 300 })] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
  const wad = join(fixtures, "drive.wad");
  writeFileSync(wad, maps.writeWad([{ name: T, image: { width: 16, height: 16, rgb: new Uint8Array(16 * 16 * 3).fill(120) } }]));
  const map = driveMap();
  const file = join(fixtures, "drive.map");
  writeFileSync(file, maps.writeMap({ ...map, worldspawn: { ...map.worldspawn, wad: "drive.wad" } }));
  console.log(`wrote ${file}`);
  const compilers = process.env[maps.COMPILERS_VARIABLE] ? maps.findCompilers() : { found: false };
  if (!compilers.found) console.log(`no compilers (${maps.COMPILERS_VARIABLE}): drive.bsp not written`);
  else {
    const made = maps.compileMap(file, { fast: true, engine: "xash", compilers, wads: [wad], wadinclude: true, out: join(fixtures, "drive.bsp") });
    console.log(made.bsp ? `wrote ${made.bsp}` : `FAIL: ${made.errors.join("; ")}`);
  }
}
