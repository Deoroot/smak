// RCBot's waypoints: the .rcw file read and written byte for byte as the bot writes it (its header with the
// stack's bytes after "RCBot", a deleted waypoint, a path to a waypoint the file does not have), what it
// refuses; and waypoints made from the walk test of a small map built here (two halls, a corridor, a vent
// only a crouching player passes, a ledge with a ladder, a crate a jump gets onto), and `smak map-waypoints`.
// Then what makes them good to play on (a dock with a truck pit, columns in a hall): lines with room beside
// them, waypoints off the walls, no drop where a walk goes, the bot's goals first in the file, nothing on a
// crate that breaks, and the waypoint nearest a place on that place's own floor.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import * as maps from "../src/maps/index.mjs";
import { test, sure, tmp, runSmak, runRefused, SMAK_CLI } from "./helper.mjs";

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

// ── waypoints from a map ──
const WEARS = { floor: "FLOOR", ceiling: "CEILING", wall: "WALL" };
const LEDGE = { min: [400, 0, 0], max: [512, 96, 96] }; // in hall A: 96 high, past any jump
const CRATE = { min: [160, 768, 0], max: [288, 896, 40] }; // in hall B: 40 high, a jump gets onto it
const VENT = { min: [32, 256, 0], max: [96, 640, 40] }; // from hall to hall, west: 40 high, crouching only
function halls({ ladder = true } = {}) {
  const rooms = [
    { min: [0, 0, 0], max: [512, 256, 256] }, // hall A
    { min: [0, 640, 0], max: [512, 896, 256] }, // hall B
    { min: [416, 256, 0], max: [512, 640, 128] }, // the corridor between them, east
    VENT,
  ];
  return {
    worldspawn: {},
    brushes: [
      ...maps.carve(rooms, 16, WEARS),
      maps.box(LEDGE.min, LEDGE.max, "LEDGE"),
      maps.box(CRATE.min, CRATE.max, "CRATE"),
    ],
    entities: [
      maps.playerStart([128, 128, 0], 0),
      maps.playerStart([256, 700, 0], 0, "info_player_deathmatch"),
      ...(ladder
        ? [maps.brushEntity("func_ladder", maps.box([396, 32, 0], [400, 64, 96], "AAATRIGGER"))]
        : []),
    ],
  };
}
const made = maps.waypointsOf(halls());
const { waypoints } = made;
const inside = (point, box) =>
  [0, 1].every((axis) => point[axis] >= box.min[axis] && point[axis] <= box.max[axis]);

test("waypoints from the walk: starts, a ladder's foot and top, a jump and its landing, a crouching passage", () => {
  sure(waypoints.length >= 12 && waypoints.length <= 40 && !made.warnings.length, `${made.facts.join(" | ")} | ${made.warnings.join(" | ")}`); // prettier-ignore
  sure(waypoints.filter((waypoint) => waypoint.kind === "start").length === 2, "one at each start");
  const ladder = waypoints.filter((waypoint) => waypoint.flags & LADDER);
  sure(ladder.length === 2, `two on the ladder: ${ladder.map((w) => w.origin).join(" / ")}`);
  const [foot, top] = ladder.sort((a, b) => a.origin[2] - b.origin[2]);
  sure(foot.origin[2] === 36 && top.origin[2] === 96 + 36 && inside(top.origin, LEDGE), `the foot on the floor, the top on the ledge: ${foot.origin} / ${top.origin}`); // prettier-ignore
  const [footAt, topAt] = [foot, top].map((waypoint) => waypoints.indexOf(waypoint));
  sure(foot.paths.includes(topAt) && top.paths.includes(footAt), "climbed both ways");
  const jumps = waypoints.filter((waypoint) => waypoint.flags & JUMP);
  sure(jumps.length === 1 && jumps[0].origin[2] === 36, `one jump, from the floor: ${jumps.map((w) => w.origin).join(" / ")}`); // prettier-ignore
  const landing = waypoints[jumps[0].paths[jumps[0].ways.indexOf("jump")]];
  sure(landing && landing.origin[2] === 40 + 36 && inside(landing.origin, CRATE), `onto the crate: ${landing?.origin}`); // prettier-ignore
  sure(landing.ways.includes("drop") && !landing.ways.includes("jump"), "and down off it again, one way");
  const crouching = waypoints.filter((waypoint) => waypoint.flags & CROUCH);
  sure(crouching.length >= 2 && crouching.every((waypoint) => waypoint.origin[2] === 18), `crouching, 18 over the floor: ${crouching.map((w) => w.origin).join(" / ")}`); // prettier-ignore
  sure(
    crouching.some((w) => w.origin[1] < 300) && crouching.some((w) => w.origin[1] > 600),
    "at both ends of the vent",
  );
  // every other waypoint stands: 36 over its floor
  for (const waypoint of waypoints.filter((w) => !(w.flags & CROUCH)))
    sure([36, 76, 132].includes(waypoint.origin[2]), `standing at ${waypoint.origin}`);
});

test("the paths: both ways where the line is walked, one way down, every waypoint got to and left", () => {
  const index = (waypoint) => waypoints.indexOf(waypoint);
  for (const waypoint of waypoints)
    for (const [nth, to] of waypoint.paths.entries()) {
      sure(to >= 0 && to < waypoints.length && to !== index(waypoint), `a path to ${to}`);
      if (waypoint.ways[nth] === "walk") sure(waypoints[to].paths.includes(index(waypoint)), `a walk both ways: ${waypoint.origin} to ${waypoints[to].origin}`); // prettier-ignore
      if (waypoint.ways[nth] === "drop")
        sure(waypoints[to].origin[2] < waypoint.origin[2], "a drop goes down");
    }
  const reachedFrom = (start, next) => {
    const seen = new Set([start]);
    for (const at of seen) for (const to of next(at)) seen.add(to);
    return seen;
  };
  const into = waypoints.map(() => []);
  waypoints.forEach((waypoint, number) => waypoint.paths.forEach((to) => into[to].push(number)));
  const first = waypoints.findIndex((waypoint) => waypoint.kind === "start");
  sure(
    reachedFrom(first, (at) => waypoints[at].paths).size === waypoints.length,
    "all got to from the first start",
  );
  sure(reachedFrom(first, (at) => into[at]).size === waypoints.length, "and all lead back to it");
  // the halls are joined by the corridor's waypoints, not through the wall between them
  const hallA = waypoints.filter((w) => w.origin[1] < 240 && !(w.flags & CROUCH));
  const hallB = waypoints.filter((w) => w.origin[1] > 656 && !(w.flags & CROUCH));
  for (const a of hallA)
    for (const to of a.paths) sure(!hallB.includes(waypoints[to]), `no path through the wall: ${a.origin} to ${waypoints[to].origin}`); // prettier-ignore
  // the file takes them as they are
  const again = maps.readRcw(maps.writeRcw(waypoints, { mapName: "halls" }));
  sure(again.waypoints.length === waypoints.length && again.waypoints.every((w, i) => w.origin.join() === waypoints[i].origin.join() && w.paths.join() === waypoints[i].paths.join() && w.flags === waypoints[i].flags), "read back as made"); // prettier-ignore
});

test("without the ladder the ledge has no waypoint; with no jumps no crate, with no crouching no vent", () => {
  const plain = maps.waypointsOf(halls({ ladder: false }), { jump: false, crouch: false });
  sure(!plain.waypoints.some((w) => w.flags & (LADDER | JUMP | CROUCH)), "no flags at all");
  sure(!plain.waypoints.some((w) => inside(w.origin, LEDGE) || inside(w.origin, CRATE)), "nothing on the ledge or the crate"); // prettier-ignore
  const wide = maps.waypointsOf(halls(), { spacing: 320 });
  sure(wide.waypoints.length < waypoints.length, `a wider spacing, fewer: ${wide.waypoints.length} against ${waypoints.length}`); // prettier-ignore
  const fewest = maps.waypointsOf(halls(), { most: waypoints.length - 1 });
  sure(fewest.waypoints.length < waypoints.length && fewest.warnings.some((w) => /over the \d+ the bot has room for, so the spacing was made/.test(w)), fewest.warnings.join(" | ")); // prettier-ignore
});

test("smak map-waypoints: the file where the bot looks, its plan, and what it refuses", () => {
  const file = join(tmp, "ts_halls.map");
  writeFileSync(file, maps.writeMap(halls()));
  const out = runSmak("map-waypoints", file, "--mod", "ts", "--out", join(tmp, "rcbot"), "--plan", join(tmp, "halls-waypoints.png")); // prettier-ignore
  const written = join(tmp, "rcbot", "waypoints", "ts", "ts_halls.rcw");
  sure(
    existsSync(written) && /waypoints for the map ts_halls/.test(out) && /crouching in 1 passages/.test(out),
    out,
  );
  const read = maps.readRcw(readFileSync(written));
  sure(read.mapName === "ts_halls" && read.waypoints.length === waypoints.length && read.fileFlags === 1, `${read.mapName} ${read.waypoints.length}`); // prettier-ignore
  sure(existsSync(join(tmp, "halls-waypoints.png")), "the plan drawn");
  const json = JSON.parse(
    runSmak("map-waypoints", file, "-o", join(tmp, "x.rcw"), "--name", "other", "--json"),
  );
  sure(json.mapName === "other" && json.waypoints.length === waypoints.length && maps.readRcw(readFileSync(join(tmp, "x.rcw"))).mapName === "other", "-o and --name"); // prettier-ignore
  const noMod = runRefused(SMAK_CLI, "map-waypoints", file, "--out", join(tmp, "rcbot"));
  sure(
    noMod.code === 1 && /--out puts the file under waypoints\/<mod>\/: say the mod/.test(noMod.err),
    noMod.err,
  );
  const badSpacing = runRefused(SMAK_CLI, "map-waypoints", file, "--spacing", "-5");
  sure(badSpacing.code === 1 && /--spacing: a number over 0/.test(badSpacing.err), badSpacing.err);
});

// ── waypoints a bot plays well on ──
/**
 * The least room beside a standing body (units, each side, past its own 16) along each path walked on the
 * level, the line sampled every 2 units: -1 where the body does not fit on the line itself.
 */
function roomAlong(map, list) {
  const space = maps.spaceOf(map);
  const fits = (x, y, feet) => {
    const rest = maps.restOf(space, [x, y, feet + 1], maps.BODIES.standing);
    return rest.fits && rest.floor !== null && rest.floor > feet - 2;
  };
  const lines = [];
  list.forEach((waypoint, number) =>
    waypoint.paths.forEach((to, nth) => {
      const [a, b] = [waypoint.origin, list[to].origin];
      if (waypoint.ways[nth] !== "walk" || to < number || a[2] !== b[2]) return;
      const feet = a[2] - 36;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const side = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
      let least = 16;
      for (let along = 0; along <= length; along += 2) {
        const x = a[0] + ((b[0] - a[0]) * along) / length;
        const y = a[1] + ((b[1] - a[1]) * along) / length;
        let room = -1;
        for (const off of [0, 2, 4, 6, 8]) {
          if (!fits(x + side[0] * off, y + side[1] * off, feet) || !fits(x - side[0] * off, y - side[1] * off, feet)) break; // prettier-ignore
          room = off;
        }
        least = Math.min(least, room);
      }
      lines.push({ a, b, least, tight: waypoint.tight[nth] });
    }),
  );
  return lines;
}
// a hall, a corridor east out of it, a second hall: a column in the first, a thin one and a crate in the second
const COLUMNS = {
  worldspawn: {},
  brushes: [
    ...maps.carve([{ min: [0, 0, 0], max: [768, 512, 192] }, { min: [768, 192, 0], max: [1024, 320, 128] }, { min: [1024, 0, 0], max: [1536, 512, 192] }], 16, WEARS), // prettier-ignore
    maps.box([352, 224, 0], [416, 288, 192], "COLUMN"),
    maps.box([1200, 96, 0], [1232, 128, 192], "COLUMN"),
    maps.box([1300, 360, 0], [1340, 400, 48], "CRATE"),
  ],
  entities: [
    maps.playerStart([64, 64, 0], 0),
    maps.playerStart([1472, 448, 0], 180, "info_player_deathmatch"),
  ],
};
// a dock: the starts at its west end, a truck pit 64 deep open to it on three sides with one stair out at its
// west end, a column, and a crate that breaks, large enough to stand on, in the far corner
const PIT = { min: [384, 256, -64], max: [832, 448, 0] };
const BREAKS = { min: [880, 32, 0], max: [976, 128, 40] };
const DOCK = {
  worldspawn: {},
  brushes: [
    ...maps.carve([{ min: [0, 0, 0], max: [1024, 448, 256] }, PIT], 16, WEARS),
    ...maps.stairs([384, 256, -64], [432, 416, 0], "-y", "STEP", { steps: 4 }),
    maps.box([224, 176, 0], [256, 208, 256], "COLUMN"),
  ],
  entities: [
    maps.playerStart([96, 96, 0], 0),
    maps.playerStart([96, 352, 0], 0, "info_player_deathmatch"),
    maps.brushEntity("func_breakable", [maps.box(BREAKS.min, BREAKS.max, "CRATE")], { health: 20 }),
  ],
};
const GOAL_KINDS = ["floor", "start"];
const LAST_KINDS = ["jump", "landing", "ledge", "drop", "near", "crouch"];

test("lines with room beside them, waypoints off the walls: a bot does not walk into a column's corner", () => {
  const { waypoints: list } = maps.waypointsOf(COLUMNS);
  const lines = roomAlong(COLUMNS, list);
  sure(lines.length >= 30, `${lines.length} lines walked`);
  const brushing = lines.filter((line) => !line.tight && line.least < 8);
  sure(!brushing.length, `every line keeps 8 off what stands beside it: ${brushing.map((line) => `${line.a} to ${line.b}: ${line.least}`).join("; ")}`); // prettier-ignore
  sure(lines.filter((line) => line.tight).length <= 2, "a line with no room only where no other way joins two waypoints"); // prettier-ignore
  // the floor's own waypoints stand with room all round: a body moved 8 any way still fits
  const space = maps.spaceOf(COLUMNS);
  for (const waypoint of list.filter((w) => w.kind === "floor")) {
    const [x, y] = waypoint.origin;
    const room = [[8, 0], [-8, 0], [0, 8], [0, -8]].every(([dx, dy]) => maps.restOf(space, [x + dx, y + dy, 1], maps.BODIES.standing).fits); // prettier-ignore
    sure(room, `off the walls: ${waypoint.origin}`);
  }
});

test("a dock with a truck pit: no drop where a walk goes, the nearest waypoint on the bot's own floor", () => {
  const made = maps.waypointsOf(DOCK);
  const { waypoints: list } = made;
  const far = (a, b) => Math.hypot(...[0, 1, 2].map((axis) => list[b].origin[axis] - list[a].origin[axis]));
  // the pit is waypointed (its stair is a way in and out)
  sure(
    list.some((w) => w.origin[2] === -64 + 36),
    "waypoints in the pit",
  );
  // each drop is a way the walk does not go at about its length (1.5 times, and 64)
  const walkedWithin = (from, to, most) => {
    const best = new Map([[from, 0]]);
    const open = [from];
    while (open.length) {
      open.sort((p, q) => best.get(p) - best.get(q));
      const at = open.shift();
      if (at === to) return true;
      list[at].paths.forEach((next, nth) => {
        const further = best.get(at) + far(at, next);
        if (list[at].ways[nth] === "drop" || further > most || (best.has(next) && best.get(next) <= further)) return; // prettier-ignore
        best.set(next, further);
        open.push(next);
      });
    }
    return false;
  };
  const drops = list.flatMap((w, number) => w.paths.filter((_, nth) => w.ways[nth] === "drop").map((to) => [number, to])); // prettier-ignore
  sure(drops.length <= 8, `a few drops into the pit, not one from every waypoint beside it: ${drops.length}`);
  for (const [from, to] of drops)
    sure(!walkedWithin(from, to, far(from, to) * 1.5 + 64), `a drop where the walk goes too: ${list[from].origin} to ${list[to].origin}`); // prettier-ignore
  // RCBot takes the nearest waypoint it sees when it has lost its way: from the dock, never one in the pit
  const space = maps.spaceOf(DOCK);
  let places = 0;
  let misled = 0;
  for (let x = 24; x < 1024; x += 16)
    for (let y = 24; y < 448; y += 16) {
      if (x > PIT.min[0] - 16 && x < PIT.max[0] + 16 && y > PIT.min[1] - 16) continue;
      const rest = maps.restOf(space, [x, y, 1], maps.BODIES.standing);
      if (!rest.fits || rest.floor !== 0) continue;
      places++;
      const eye = [x, y, 36];
      const seen = list
        .map((w) => [Math.hypot(w.origin[0] - x, w.origin[1] - y, w.origin[2] - 36), w])
        .sort((p, q) => p[0] - q[0])
        .find(([, w]) => space.sees(eye, w.origin));
      if (seen && seen[1].origin[2] < 0) misled++;
    }
  sure(places > 500 && misled === 0, `${misled} of ${places} places on the dock have their nearest waypoint in the pit`); // prettier-ignore
  // nothing on the crate that breaks, which a jump gets onto
  sure(
    !list.some((w) => inside(w.origin, BREAKS) && w.origin[2] > 36),
    "no waypoint on the crate that breaks",
  );
  sure(made.facts.some((fact) => /1 tops of what gives way \(a crate that breaks\) not waypointed/.test(fact)), made.facts.join(" | ")); // prettier-ignore
});

test("the bot's goals first: RCBot roams to one of the first 50 waypoints, so they are open floor spread out", () => {
  for (const map of [DOCK, COLUMNS, halls()]) {
    const { waypoints: list, facts } = maps.waypointsOf(map);
    sure(GOAL_KINDS.includes(list[0].kind), `open floor or a start first: ${list.slice(0, 4).map((w) => w.kind)}`); // prettier-ignore
    // every goal before what is not one, and the jumps, ledges, landings and crouching places last of all
    const lastGoal = Math.max(...list.map((w, i) => (GOAL_KINDS.includes(w.kind) ? i : -1)));
    const firstOdd = list.findIndex((w) => LAST_KINDS.includes(w.kind) || w.flags & JUMP);
    sure(firstOdd < 0 || firstOdd > lastGoal, `the jumps and the rest after the goals: ${firstOdd} against ${lastGoal}`); // prettier-ignore
    sure(
      facts.some((fact) => /the first \d+ waypoints are where the bot roams to/.test(fact)),
      facts.join(" | "),
    );
  }
  // spread: the dock's goals are not huddled at its starts
  const goals = maps.waypointsOf(DOCK).waypoints.filter((w) => GOAL_KINDS.includes(w.kind));
  sure(
    goals.some((w) => w.origin[0] > 800) && goals.some((w) => w.origin[0] < 200),
    "goals at both ends of the dock",
  );
});
