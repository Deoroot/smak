// RCBot's waypoints: the .rcw file read and written byte for byte as the bot writes it (its header with the
// stack's bytes after "RCBot", a deleted waypoint, a path to a waypoint the file does not have), and what it refuses.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import * as maps from "../check/maps/index.mjs";
import { test, sure } from "./helper.mjs";

const refuses = (run, pattern) => {
  try {
    run();
  } catch (e) {
    return pattern.test(e.message);
  }
  return false;
};

/** A .rcw as the bot writes one, laid out by hand: 52 bytes of header, 16 a waypoint, then the paths. */
function botFile({ type = "RCBot\0\xCC\xCC", version = 4, flags = 0, name = "ts_test", waypoints, paths }) {
  const header = Buffer.alloc(52);
  header.write(type, 0, "latin1");
  header.writeInt32LE(version, 8);
  header.writeInt32LE(flags, 12);
  header.writeInt32LE(waypoints.length, 16);
  header.write(name, 20, "latin1");
  const body = Buffer.alloc(waypoints.length * 16);
  waypoints.forEach(([flag, x, y, z], index) => {
    body.writeInt32LE(flag, index * 16);
    body.writeFloatLE(x, index * 16 + 4);
    body.writeFloatLE(y, index * 16 + 8);
    body.writeFloatLE(z, index * 16 + 12);
  });
  const tail = [];
  for (const list of paths) tail.push(list.length, ...list);
  const bytes = Buffer.alloc(tail.length * 2);
  tail.forEach((value, index) => bytes.writeInt16LE(value, index * 2));
  return Buffer.concat([header, body, bytes]);
}
const LADDER = maps.RCW_FLAGS.LADDER;
const JUMP = maps.RCW_FLAGS.JUMP;
const CROUCH = maps.RCW_FLAGS.CROUCH;

test("a .rcw as the bot writes it is read, and written back byte for byte", () => {
  const bytes = botFile({
    waypoints: [
      [0, -322.5, 30.25, 292],
      [LADDER, -413, -21, 104],
      [JUMP | CROUCH, 67, 376, 100],
      [maps.RCW_FLAGS.DELETED, 0, 0, 0],
    ],
    // waypoint 2 has a path to 7, which the file does not have: old files do, and the bot never follows it
    paths: [[1, 2], [0], [0, 1, 7], []],
  });
  const read = maps.readRcw(bytes);
  sure(
    read.version === 4 && read.fileFlags === 0 && read.mapName === "ts_test",
    JSON.stringify(read).slice(0, 200),
  );
  sure(read.waypoints.length === 4 && read.waypoints[0].origin.join() === "-322.5,30.25,292", "the origins");
  sure(read.waypoints[2].paths.join() === "0,1,7", `the paths: ${read.waypoints[2].paths}`);
  sure(maps.waypointFlagNames(read.waypoints[2].flags).join() === "crouch,jump", maps.waypointFlagNames(read.waypoints[2].flags).join()); // prettier-ignore
  const again = maps.writeRcw(read.waypoints, { mapName: read.mapName, fileFlags: read.fileFlags, filetype: read.filetype, loose: true }); // prettier-ignore
  sure(Buffer.compare(again, bytes) === 0, "the same bytes, the two after RCBot's 0 too");
  sure(refuses(() => maps.writeRcw(read.waypoints, { mapName: "ts_test" }), /a path to 7, not one of the 4 waypoints/), "unless told, a path to nothing is refused"); // prettier-ignore
  // a new file: "RCBot" and zeros, version 4, and the bit that has the bot work its visibility table out
  const made = maps.writeRcw([{ origin: [0, 0, 36], flags: 0, paths: [] }], { mapName: "te_meridian" });
  sure(
    made.length === 52 + 16 + 2 && made.subarray(0, 8).equals(Buffer.from("RCBot\0\0\0", "latin1")),
    "a new header",
  );
  sure(made.readInt32LE(8) === 4 && made.readInt32LE(12) === maps.RCW_READ_VISIBILITY, "version 4, visibility to be worked out"); // prettier-ignore
});

test("what is not a .rcw the bot reads is refused in a sentence", () => {
  const one = { waypoints: [[0, 0, 0, 36]], paths: [[]] };
  sure(refuses(() => maps.readRcw(botFile({ ...one, type: "[Grave]\0" })), /not an RCBot waypoint file: its type is "\[Grave\]"/), "another bot's"); // prettier-ignore
  sure(refuses(() => maps.readRcw(botFile({ ...one, version: 5 })), /version 5: the bot reads version 4/), "another version"); // prettier-ignore
  const whole = botFile(one);
  sure(
    refuses(() => maps.readRcw(whole.subarray(0, 60)), /cut short/),
    "cut short",
  );
  sure(refuses(() => maps.readRcw(Buffer.concat([whole, Buffer.alloc(2)])), /2 bytes after the paths/), "bytes over"); // prettier-ignore
  sure(refuses(() => maps.writeRcw([], { mapName: "x".repeat(32) }), /31 letters at the most/), "a name too long"); // prettier-ignore
  const many = Array.from({ length: 1025 }, () => ({ origin: [0, 0, 0], flags: 0, paths: [] }));
  sure(refuses(() => maps.writeRcw(many, { mapName: "big" }), /1025 waypoints: the bot has room for 1024/), "over 1024"); // prettier-ignore
});
