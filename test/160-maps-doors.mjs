// Room before a door (src/maps/doorways.mjs): two rooms through a doorway, a door's leaf in it. Both sides with room;
// a crate before it and a prop with no clip each found on their side; the views of each door from both its sides,
// from where the door is seen and not from the next room; map-doors' PASS and FAIL on the same rooms. The broken
// cases are in test/broken/maps.mjs.
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import * as maps from "../src/maps/index.mjs";
import { test, sure, sureEach, tmp, runSmak, runRefused, SMAK_CLI } from "./helper.mjs";

// two rooms of 320 x 256 either side of a wall at x 320 to 352, a doorway 64 wide in it, a third room behind the west one
const house = (more = []) => ({
  worldspawn: {},
  brushes: [
    ...maps.carve([{ min: [0, 0, 0], max: [320, 256, 128] }, { min: [352, 0, 0], max: [672, 256, 128] }, { min: [320, 96, 0], max: [352, 160, 112] }, { min: [-352, 0, 0], max: [-32, 256, 128] }], 16, { floor: "FLOOR", ceiling: "CEILING", wall: "WALL" }), // prettier-ignore
    ...more,
  ],
  entities: [maps.playerStart([96, 128, 0], 0), maps.light([160, 128, 112]), maps.brushEntity("func_door_rotating", [maps.box([332, 96, 0], [340, 160, 112], "DOOR")], { targetname: "study" })], // prettier-ignore
});

test("doors: room on both sides of a clear door; a crate and a prop each found on their side", () => {
  const clear = maps.doorClearance(house());
  sure(clear.doors.length === 1 && !clear.warnings.length, `a clear door: ${clear.warnings.join(" | ")}`);
  const [door] = clear.doors;
  sure(door.across === "x" && door.width === 64 && door.at.join() === "336,128,0", `the door: ${JSON.stringify(door)}`);
  sureEach(door.sides, "the door's sides", (s) => sure(s.room, `${s.side}: no room`));
  const crate = maps.doorClearance(house([maps.box([360, 96, 0], [400, 160, 40], "CRATE")])).doors[0];
  sure(crate.sides.map((s) => `${s.side} ${s.room}`).join() === "west true,east false", `the crate: ${JSON.stringify(crate.sides)}`);
  const bench = { number: 9, file: "models/bench.mdl", min: [270, 100, 0], max: [318, 156, 30] };
  const propped = maps.doorClearance(house(), { props: [bench] }).doors[0];
  sure(!propped.sides[0].room && propped.sides[0].prop === bench && propped.sides[1].room, `the prop: ${JSON.stringify(propped.sides)}`);
});

test("doors: each door seen from both its sides, at the eye, from where it is seen", () => {
  const stands = maps.doorViews(house());
  sure(stands.length === 2, `views: ${stands.map((s) => s.name).join(", ")}`);
  sureEach(stands, "the views", (s) => {
    sure(s.from[2] === 64 && s.to[0] === 336 && s.to[1] === 128, `${s.name}: from ${s.from} to ${s.to}`);
    sure(s.from[0] > 0, `${s.name}: from ${s.from}, in the room behind the west room's wall`);
  });
  // the west room 32 deep: the place 128 back is in the room behind its wall, which does not see the door
  const narrow = { ...house(), brushes: maps.carve([{ min: [288, 0, 0], max: [320, 256, 128] }, { min: [352, 0, 0], max: [672, 256, 128] }, { min: [320, 96, 0], max: [352, 160, 112] }, { min: [0, 0, 0], max: [256, 256, 128] }], 16, { floor: "FLOOR", ceiling: "CEILING", wall: "WALL" }) }; // prettier-ignore
  const west = maps.doorViews(narrow).find((s) => s.name.includes("from west"));
  sure(west && west.from[0] > 288, `the narrow side's view from ${west?.from}: behind the wall`);
});

test("doors: map-doors passes the clear door and fails the crate's, by its line", () => {
  const good = join(tmp, "doors-good.map");
  const bad = join(tmp, "doors-bad.map");
  writeFileSync(good, maps.writeMap(house()));
  writeFileSync(bad, maps.writeMap(house([maps.box([360, 96, 0], [400, 160, 40], "CRATE")])));
  const passed = runSmak("map-doors", good).trim().split("\n").at(-1);
  sure(passed === "PASS: room before every one of 1 doors, on both sides (0 props counted)", passed);
  const failed = runRefused(SMAK_CLI, "map-doors", bad);
  const last = failed.out.trim().split("\n").at(-1);
  sure(failed.code === 1 && last === "FAIL: 1 of 1 doors with no room before them on a side", `${failed.code}: ${last}`);
  sure(/east NONE/.test(failed.out), failed.out);
});
