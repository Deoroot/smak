// The kit's own small map for the sky-gap check (test/fixtures/skygap.map and .bsp): three roofed rooms in a row
// under one sky, and a yard open to the sky south of them. The roofs are sheets 4 thick; room A's stops 2 units
// short of room B's over the wall between them: a slit the sky shows through, from the spawn under it. Room B's
// roof is whole, and its south wall has a window 64 wide onto the yard: sky seen through it is no gap. Room C is
// sealed with no sky in sight. In the yard, under the open sky, an arcade of one bay stands 2 units off the south
// wall with its crown 8 over the wall's top: from the yard, under the arch and over the wall, a sliver of sky (the
// owner's plaza, 2026-11-10: arches against a rock wall, meeting edge to edge with a hair of air); and a lamp post
// stands free, which is no gap. The walls, floors and the sky are the kit's own textures, put inside the .bsp. Run
// this file to write the .map and, where VHLT_DIR names the compilers, the .bsp (test/fixtures/README.md).
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as maps from "../src/maps/index.mjs";

const T = { floor: "SKGFLOOR", ceiling: "SKGCEIL", wall: "SKGWALL" };
/** The three rooms' x ranges, 256 wide with 32 of wall between; every room is 256 deep (y 0..256) and 128 high under a roof 4 thick. */
export const ROOF = [128, 132];
export const ROOMS = { a: [0, 256], b: [288, 544], c: [576, 832] };
export const SLIT = 2;
export const WINDOW = { x: [384, 448], z: [48, 112] };
/** The arcade in the yard: its x range, the line its piers stand on (its back face at y -254, the wall's at -256), and the arch's crown (the wall's top is 144). */
export const ARCADE = { x: [96, 256], y: -238, crown: 152 };
export const LAMP = [672, -128];

/** The eye a standing player has in the middle of a room, under room A's slit (the spawn's), in the yard before the arcade's bay, and in the yard by the lamp. */
export const eyeIn = (room) => [(ROOMS[room][0] + ROOMS[room][1]) / 2, 128, 64];
export const EYE_UNDER_SLIT = [ROOMS.a[1] - 12, 128, 64];
export const EYE_BEFORE_ARCH = [176, -200, 64];
export const EYE_BY_LAMP = [LAMP[0], LAMP[1] + 32, 64];

export function skyGapMap() {
  const brushes = [
    maps.box([-16, -272, -16], [848, 272, 0], T.floor), // the floor under everything, the yard's too
    maps.box([0, 256, 0], [832, 272, 144], T.wall), // the north wall
    maps.box([-16, -272, 0], [0, 272, 144], T.wall), // west
    maps.box([832, -272, 0], [848, 272, 144], T.wall), // east
    maps.box([0, -272, 0], [832, -256, 144], T.wall), // the yard's south wall
    maps.box([256, 0, 0], [288, 256, ROOF[0]], T.wall), // between A and B, up to the roofs' underside
    maps.box([544, 0, 0], [576, 256, ROOF[1]], T.wall), // between B and C, up to the roofs' top
    // the south wall of the rooms, with B's window cut out of it
    maps.box([0, -16, 0], [WINDOW.x[0], 0, 144], T.wall),
    maps.box([WINDOW.x[1], -16, 0], [832, 0, 144], T.wall),
    maps.box([WINDOW.x[0], -16, 0], [WINDOW.x[1], 0, WINDOW.z[0]], T.wall),
    maps.box([WINDOW.x[0], -16, WINDOW.z[1]], [WINDOW.x[1], 0, 144], T.wall),
    // the roofs: B's runs over the wall between A and B, and A's stops SLIT short of it
    maps.box([0, 0, ROOF[0]], [ROOMS.a[1] - SLIT, 256, ROOF[1]], T.ceiling),
    maps.box([ROOMS.a[1], 0, ROOF[0]], [ROOMS.b[1], 256, ROOF[1]], T.ceiling),
    maps.box([ROOMS.c[0], 0, ROOF[0]], [ROOMS.c[1], 256, ROOF[1]], T.ceiling),
    // the yard's arcade against the south wall, and its lamp post (a shaft 8 square under a head of 16)
    ...maps.arcade([ARCADE.x[0], ARCADE.y, 0], [ARCADE.x[1], ARCADE.y, 0], { bays: 1, pier: 32, height: ARCADE.crown, texture: T.wall }),
    maps.box([LAMP[0] - 4, LAMP[1] - 4, 0], [LAMP[0] + 4, LAMP[1] + 4, 96], T.ceiling),
    maps.box([LAMP[0] - 8, LAMP[1] - 8, 96], [LAMP[0] + 8, LAMP[1] + 8, 112], T.ceiling),
    // the sky: a shell of four walls standing on the walls' tops, and a lid
    maps.box([-32, -288, 144], [-16, 288, 432], "sky"),
    maps.box([848, -288, 144], [864, 288, 432], "sky"),
    maps.box([-32, -288, 144], [864, -272, 432], "sky"),
    maps.box([-32, 272, 144], [864, 288, 432], "sky"),
    maps.box([-32, -288, 416], [864, 288, 432], "sky"),
  ];
  const lamp = (at) => maps.light(at, { brightness: 200 });
  return {
    worldspawn: { skyname: "desert" },
    brushes,
    entities: [maps.playerStart([ROOMS.a[1] - 12, 128, 0], 0), maps.playerStart([560, -128, 0], 0), lamp([128, 128, 100]), lamp([416, 128, 100]), lamp([704, 128, 100]), lamp([416, -128, 120])], // prettier-ignore
  };
}

/** The textures of the map, drawn by code: plain greys and a sky. */
export function skyGapTextures() {
  const plain = (value) => ({ width: 16, height: 16, rgb: new Uint8Array(16 * 16 * 3).fill(value) });
  return [
    { name: T.wall, image: plain(120) },
    { name: T.floor, image: plain(80) },
    { name: T.ceiling, image: plain(160) },
    { name: "sky", image: plain(200) },
  ];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
  const wad = join(fixtures, "skygap.wad");
  writeFileSync(wad, maps.writeWad(skyGapTextures()));
  const map = skyGapMap();
  const file = join(fixtures, "skygap.map");
  writeFileSync(file, maps.writeMap({ ...map, worldspawn: { ...map.worldspawn, wad: "skygap.wad" } }));
  console.log(`wrote ${file}`);
  const compilers = process.env[maps.COMPILERS_VARIABLE] ? maps.findCompilers() : { found: false };
  if (!compilers.found) console.log(`no compilers (${maps.COMPILERS_VARIABLE}): skygap.bsp not written`);
  else {
    const made = maps.compileMap(file, { fast: true, engine: "xash", compilers, wads: [wad], wadinclude: true, out: join(fixtures, "skygap.bsp") });
    console.log(made.bsp ? `wrote ${made.bsp}` : `FAIL: ${made.errors.join("; ")}`);
  }
}
