// The sweep's drops: a body by a wall on an upper floor, where it does not fit, over a room below that runs on
// under that floor, where it does. The edge is no drop: it lands on the slab under it, not in the room below
// (Meridian's mezzanine by the hall's back wall read as a fall of 384 to the vault). A real drop is still one.
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../check/maps/index.mjs";
import { test, sure, tmp } from "./helper.mjs";

const folder = join(tmp, "sweep-slab");
mkdirSync(folder, { recursive: true });
const compilers = process.env[maps.COMPILERS_VARIABLE] ? maps.findCompilers() : { found: false };

if (!compilers.found) console.log(`skip  the sweep's drops over a slab\n      skipped: no compilers (name the folder of VHLT in ${maps.COMPILERS_VARIABLE} to run it)`);
else
  test("the sweep: an upper floor by a wall, a room under it that runs on further, is no drop; a pit 256 deep is one", () => {
    const rooms = [
      { min: [0, 0, 0], max: [256, 256, 256] }, // the upper room: its north wall at 256
      { min: [0, 0, -256], max: [256, 320, -128] }, // under it, a room that runs 64 further north
      { min: [256, 64, -256], max: [512, 192, 256] }, // a shaft beside, open from the upper floor's height to the bottom
    ];
    const map = {
      worldspawn: {},
      brushes: [...maps.carve(rooms, 16, "WALL"), maps.box([256, 64, -256], [512, 192, 0], "WALL")],
      entities: [maps.playerStart([128, 128, 0]), maps.light([128, 128, 200], { brightness: 300 }), maps.light([128, 160, -150], { brightness: 300 })],
    };
    // the shaft is filled up to the upper floor except a pit at its far end: 256 deep
    map.brushes.pop();
    map.brushes.push(maps.box([256, 64, -256], [448, 192, 0], "WALL"));
    const wad = join(folder, "slab.wad");
    writeFileSync(wad, maps.writeWad([{ name: "WALL", image: { width: 16, height: 16, rgb: new Uint8Array(16 * 16 * 3).fill(120) } }]));
    map.worldspawn.wad = [wad];
    const file = join(folder, "slab.map");
    writeFileSync(file, maps.writeMap(map));
    const made = maps.compileMap(file, { fast: true, compilers, wads: [wad] });
    sure(made.bsp, made.errors.join("; "));
    const { drops } = maps.sweepOf(maps.readBsp(readFileSync(made.bsp)));
    // none by the upper room's north wall, over the room below
    const false_ = drops.filter((d) => d.at[1] > 220 && d.at[2] >= 0 && d.to[2] < -100 && d.to[0] < 256);
    sure(false_.length === 0, `drops by the wall: ${JSON.stringify(false_.slice(0, 3))}`);
    // the pit at the shaft's far end is a drop of 256
    sure(drops.some((d) => d.fall >= 250 && d.to[0] >= 448), `the pit: ${JSON.stringify(drops.slice(0, 5))}`);
  });
