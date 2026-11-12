// RCBot's waypoint file (.rcw): read and written as the bot reads and writes it. RCBot is Paul Murphy's
// ("Cheeseh") bot for Half-Life 1 mods, The Specialists 3.0 among them; the file is what its WaypointLoad and
// WaypointSave in dlls/waypoint.cpp read and write (APGRoboCop/rcbotold, the same at tag v1.51b13, the build
// a community's servers run, and at its master of 2026). Where the bot looks for it:
//   <Half-Life>/rcbot/waypoints/<mod folder>/<map>.rcw      (the mod folder: "ts" for The Specialists)
// and the visibility table beside it, <Half-Life>/rcbot/visibility/<mod folder>/<map>.rcv.
//
// THE FILE, little-endian, nothing between the parts:
//   header, 52 bytes (WAYPOINT_HDR)
//     char  filetype[8]   "RCBot" and its 0; the bot compares it with strcmp, so the two bytes after the 0
//                         are anything (the bot's own files have what its stack held: "\xCC\xCC" and others)
//     int   version       4 (WAYPOINT_VERSION); another is refused
//     int   flags         bit 0 (W_FILE_FL_READ_VISIBILITY): the visibility table is out of date. The bot
//                         then works it out as the map loads (a line between every two waypoints), writes
//                         the .rcv, and writes the .rcw again with the bit cleared
//     int   count         how many waypoints; the bot has room for 1024 (MAX_WAYPOINTS) and reads past it
//     char  mapname[32]   the map's name; the bot loads the file only when it is the map's, exactly
//   waypoints, 16 bytes each (class WAYPOINT)
//     int   flags         what the waypoint is (FLAGS below)
//     float origin[3]     where: a player's origin there, his middle (36 over the floor standing, 18 crouching).
//                         One over 4096 on any axis is taken as deleted when it loads
//   paths, for each waypoint in turn
//     short count         how many paths go out of it (the bot keeps them in lists of 4, any number)
//     short to[count]     the waypoints they go to. A path is one way: a way both ways is two paths
//
//   readRcw(buffer)        { filetype, version, fileFlags, mapName, waypoints: [{ flags, origin, paths }] }
//   writeRcw(waypoints, { mapName, fileFlags, filetype })   the file, as a Buffer
//   waypointFlagNames(flags)   a waypoint's flags as their names
import { Buffer } from "node:buffer";

/** The header's size, and a waypoint's, in bytes. */
export const RCW_HEADER = 52;
export const RCW_WAYPOINT = 16;
/** The version the bot reads, and the most waypoints it has room for. */
export const RCW_VERSION = 4;
export const RCBOT_MOST_WAYPOINTS = 1024;
/** The file's own flag: the visibility table is to be worked out again when the map loads. */
export const RCW_READ_VISIBILITY = 1;

/**
 * A waypoint's flags (dlls/waypoint.h). Bits 0 and 1 are a team's number (W_FL_TEAM) with TEAM_SPECIFIC;
 * some bits have other names in other mods (18 is a skulk's wall-stick in Natural Selection and a stunt in
 * The Specialists). What the bot does with the ones this kit writes (dlls/bot_navigate.cpp, bot.cpp):
 *   CROUCH  the bot crouches on the way to it, and has touched it within 24 units
 *   LADDER  on a ladder: the one at its foot and the one on the ledge at its top (rcbot/waypoints/
 *           waypointingladders.htm); the bot climbs between two
 *   JUMP    where to jump from: on touching it (within 32) the bot jumps with its legs drawn up, towards
 *           the next. The path from it goes to where the jump lands
 */
export const RCW_FLAGS = {
  TEAM: 0b11,
  TEAM_SPECIFIC: 1 << 2,
  CROUCH: 1 << 3,
  LADDER: 1 << 4,
  LIFT: 1 << 5,
  DOOR: 1 << 6,
  HEALTH: 1 << 7,
  ARMOR: 1 << 8,
  AMMO: 1 << 9,
  CHECK_LIFT: 1 << 10,
  IMPORTANT: 1 << 11,
  RESCUE: 1 << 12,
  DEFEND_ZONE: 1 << 13,
  AIMING: 1 << 14,
  CROUCHJUMP: 1 << 16,
  WAIT_FOR_LIFT: 1 << 17,
  STUNT: 1 << 18,
  JUMP: 1 << 19,
  WEAPON: 1 << 20,
  TELEPORT: 1 << 21,
  TANK: 1 << 22,
  FLY: 1 << 23,
  STAY_NEAR: 1 << 24,
  ENDLEVEL: 1 << 25,
  OPENS_LATER: 1 << 26,
  HUMAN_TOWER: 1 << 27,
  UNREACHABLE: 1 << 28,
  PUSHABLE: 1 << 29,
  GREN_THROW: 1 << 30,
  DELETED: 1 << 31,
};

/** A waypoint's flags as their names, the team's number as `team 2`. */
export function waypointFlagNames(flags) {
  const names = [];
  for (const [name, bit] of Object.entries(RCW_FLAGS)) {
    if (name === "TEAM") continue;
    if ((flags & bit) !== 0) names.push(name.toLowerCase());
  }
  if (flags & RCW_FLAGS.TEAM_SPECIFIC) names.push(`team ${flags & RCW_FLAGS.TEAM}`);
  return names;
}

/**
 * A .rcw read: `{ filetype (its 8 bytes), version, fileFlags, mapName, waypoints: [{ flags, origin: [x, y,
 * z], paths: [to, ...] }] }`, the waypoints in their order (a deleted one is kept, with its flag). A file
 * that is not RCBot's, of another version, cut short or with bytes over is refused in a sentence.
 */
export function readRcw(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (data.length < RCW_HEADER)
    throw new Error(`not an RCBot waypoint file: ${data.length} bytes, under the header's ${RCW_HEADER}`);
  const filetype = data.subarray(0, 8);
  const name = cString(filetype);
  if (name !== "RCBot" && name !== "HPB_bot")
    throw new Error(`not an RCBot waypoint file: its type is ${JSON.stringify(name)}, not "RCBot"`);
  const version = data.readInt32LE(8);
  if (version !== RCW_VERSION)
    throw new Error(`an RCBot waypoint file of version ${version}: the bot reads version ${RCW_VERSION}`);
  const fileFlags = data.readInt32LE(12);
  const count = data.readInt32LE(16);
  const mapName = cString(data.subarray(20, 52));
  if (count < 0 || RCW_HEADER + count * RCW_WAYPOINT > data.length)
    throw new Error(`cut short: ${count} waypoints do not fit in ${data.length} bytes`);
  const waypoints = [];
  let at = RCW_HEADER;
  for (let index = 0; index < count; index++, at += RCW_WAYPOINT)
    waypoints.push({
      flags: data.readInt32LE(at),
      origin: [data.readFloatLE(at + 4), data.readFloatLE(at + 8), data.readFloatLE(at + 12)],
      paths: [],
    });
  for (const waypoint of waypoints) {
    if (at + 2 > data.length) throw new Error("cut short in the paths");
    const many = data.readInt16LE(at);
    at += 2;
    if (many < 0 || at + many * 2 > data.length) throw new Error("cut short in the paths");
    for (let index = 0; index < many; index++, at += 2) waypoint.paths.push(data.readInt16LE(at));
  }
  if (at !== data.length)
    throw new Error(`${data.length - at} bytes after the paths: not a .rcw the bot wrote`);
  return { filetype: Buffer.from(filetype), version, fileFlags, mapName, waypoints };
}

/**
 * The .rcw of these waypoints (`[{ flags, origin, paths }]`), as a Buffer. `mapName`: the map's name as the
 * engine has it (the .bsp's name without .bsp), 31 letters at the most; `fileFlags`: RCW_READ_VISIBILITY
 * (unless told) so that the bot works out its visibility table when the map loads; `filetype`: the 8
 * bytes of a file read, to write it back byte for byte ("RCBot" and zeros unless told); `loose`: a path to
 * a waypoint the file does not have is written as it is (old files have them: the bot adds the path and
 * never follows it) instead of refused.
 */
export function writeRcw(
  waypoints,
  { mapName, fileFlags = RCW_READ_VISIBILITY, filetype, loose = false } = {},
) {
  if (typeof mapName !== "string" || !mapName.length)
    throw new Error("mapName: the map's name, as the engine has it (its .bsp's name without .bsp)");
  if (Buffer.byteLength(mapName, "latin1") > 31)
    throw new Error(`mapName: 31 letters at the most (the bot keeps 32 with the 0), not ${mapName.length}`);
  if (waypoints.length > RCBOT_MOST_WAYPOINTS)
    throw new Error(`${waypoints.length} waypoints: the bot has room for ${RCBOT_MOST_WAYPOINTS}`);
  let size = RCW_HEADER + waypoints.length * RCW_WAYPOINT;
  for (const [index, waypoint] of waypoints.entries()) {
    if (
      !Array.isArray(waypoint.origin) ||
      waypoint.origin.length !== 3 ||
      !waypoint.origin.every(Number.isFinite)
    )
      throw new Error(`waypoint ${index}: origin is [x, y, z]`);
    for (const to of waypoint.paths ?? [])
      if (
        !Number.isInteger(to) ||
        to < -32768 ||
        to > 32767 ||
        (!loose && (to < 0 || to >= waypoints.length))
      )
        throw new Error(`waypoint ${index}: a path to ${to}, not one of the ${waypoints.length} waypoints`);
    size += 2 + (waypoint.paths?.length ?? 0) * 2;
  }
  const data = Buffer.alloc(size);
  if (filetype) Buffer.from(filetype).copy(data, 0, 0, 8);
  else data.write("RCBot", 0, "latin1");
  data.writeInt32LE(RCW_VERSION, 8);
  data.writeInt32LE(fileFlags, 12);
  data.writeInt32LE(waypoints.length, 16);
  data.write(mapName, 20, "latin1");
  let at = RCW_HEADER;
  for (const waypoint of waypoints) {
    data.writeInt32LE(waypoint.flags | 0, at);
    data.writeFloatLE(waypoint.origin[0], at + 4);
    data.writeFloatLE(waypoint.origin[1], at + 8);
    data.writeFloatLE(waypoint.origin[2], at + 12);
    at += RCW_WAYPOINT;
  }
  for (const waypoint of waypoints) {
    const paths = waypoint.paths ?? [];
    data.writeInt16LE(paths.length, at);
    at += 2;
    for (const to of paths) {
      data.writeInt16LE(to, at);
      at += 2;
    }
  }
  return data;
}

/** The letters of a C string in a field: up to its first 0. */
function cString(bytes) {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end < 0 ? bytes.length : end).toString("latin1");
}
