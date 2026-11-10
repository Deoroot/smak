// The battery over a built map: every player-facing fault the kit can measure of a compiled map, hand-made or not, in
// one place (ARCHITECTURE.md 2.5: the battery reads the built file, never a generator's plan). It calls the checks that
// exist and adds two that read the .bsp alone: the front of every door and opening, and the first look of every spawn.
//
//   reach     the walk test (`reachOf`): entities not reached or in solid FAIL; one-way places, room-sized floor not
//             walked to, narrow openings WARN
//   light     the floor's light (`lightReport`), by the rooms given or by its dark patches; a dark room WARN
//   fronts    before every door (func_door, func_door_rotating, momentary_door) and every opening the walk finds, on
//             both sides: 72 units of clear air at 40 over the floor, a place to stand 36 out (`doorClearance` for the
//             doors' sides too); FAIL
//   spawns    from each info_player_* at the eye along its own yaw, 128 to the first solid (FAIL); no angle set while the
//             open side is elsewhere WARN
//   skygaps   sky seen through a gap (`skyGaps`, every eye); WARN
//   coplanar  a brush entity's face on another's, looking the same way (`coplanarFaults`, with the .map); FAIL
//   pvs       what the engine draws from where players stand (`checkPvs`); FAIL over the budget
//   budget    leaves, faces, edicts, the range (`budgetOf`); FAIL over a limit
//   sweep     drops that hurt, glows in mid-air, solid floating (`sweepOf`); WARN
//   compile   the compiler's log, its warnings grouped (`groupedWarnings`); an error FAIL, a warning WARN
//
// The rules of fronts and spawns are those of levels/assembly/fronts.mjs (the owner's walk of byz02, 2026-11-08; the
// eye views, 2026-11-10), read off the built file: the doors are the brush entities that open and the openings of the
// walk test, not a plan's doorway list. A plan knows which side of a door is the street, and held a wall that fills the
// view within 112 of it; a built map does not say, so that rule is not asked here.
import { readBsp } from "./bsp.mjs";
import { valueOf } from "./entities.mjs";
import { reachOf } from "./reach.mjs";
import { lightReport, DARK_FLOOR } from "./light.mjs";
import { doorClearance, standsAt } from "./doorways.mjs";
import { spaceOf, bodyOf } from "./space.mjs";
import { skyGaps, traceSolid } from "./skygaps.mjs";
import { coplanarFaults } from "./plan.mjs";
import { checkPvs } from "./pvs.mjs";
import { budgetOf } from "./budget.mjs";
import { sweepOf } from "./sweep.mjs";
import { groupedWarnings } from "./compile.mjs";

/** Clear air a player needs before a door, at FRONT_Z over its floor; where one stands, FRONT_STAND out. */
export const FRONT_CLEAR = 72;
export const FRONT_STAND = 36;
const FRONT_Z = 40;
/** How far a spawn looks before the first solid, from its eye (28 over its origin, the body's middle). */
export const SPAWN_LOOK = 128;
const SPAWN_EYE = 28;
const LOOK_FAR = 1024;
const LEVELS = ["PASS", "WARN", "FAIL"];

const place = (p) => p.map((v) => Math.round(v)).join(" ");
const some = (list, most = 6) => `${list.slice(0, most).join("; ")}${list.length > most ? `; and ${list.length - most} more` : ""}`;
const compass = ([x, y]) => (Math.abs(x) > Math.abs(y) ? (x > 0 ? "east" : "west") : y > 0 ? "north" : "south");

/**
 * The first solid along a line in the built map: the world's, or a solid brush entity's own model (a door taken as
 * open stops nothing). `{ distance, what }` or null.
 */
function lineTracer(bsp, space) {
  const head = bsp.models[0].headNodes[0];
  const models = space.areas
    .filter((area) => area.solid && !area.open && /^\*\d+$/.test(valueOf(bsp.entities[area.number], "model") ?? ""))
    .map((area) => {
      const entity = bsp.entities[area.number];
      const origin = (valueOf(entity, "origin") ?? "0 0 0").split(/\s+/).map(Number);
      return { area, head: bsp.models[Number(valueOf(entity, "model").slice(1))].headNodes[0], origin };
    });
  return (from, to) => {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const hit = traceSolid(bsp, head, from, to);
    let best = hit ? { distance: Math.hypot(...[0, 1, 2].map((k) => hit.at[k] - from[k])), what: "a wall of the world" } : null; // prettier-ignore
    for (const { area, head: own, origin } of models) {
      const shift = (p) => p.map((v, k) => v - origin[k]);
      const met = traceSolid(bsp, own, shift(from), shift(to));
      if (!met) continue;
      const distance = Math.hypot(...[0, 1, 2].map((k) => met.at[k] + origin[k] - from[k]));
      if (distance <= length && (!best || distance < best.distance)) best = { distance, what: `the ${area.classname} ${area.number}` };
    }
    return best;
  };
}

/**
 * The fronts of the doors and openings: `{ fronts, failures, warnings }`, each front `{ name, at, front, distance, what,
 * stands }`. A door's fault is a failure; an opening's a warning, since an opening may be a passage's bend, meant.
 */
function doorFronts(bsp, space, reach, clearance) {
  const first = lineTracer(bsp, space);
  const fronts = [
    ...clearance.doors.flatMap((door) => [-1, 1].map((sign) => ({ name: `${door.classname} ${door.number}${door.targetname ? ` "${door.targetname}"` : ""}`, door: true, at: door.at, front: door.across === "x" ? [sign, 0] : [0, sign] }))), // prettier-ignore
    ...reach.openings.flatMap((opening) =>
      // (`across` is the axis the width is measured along: the way through runs along the other)
      opening.sides.map((side) => {
        const way = opening.across === "x" ? 1 : 0;
        const front = [0, 0];
        front[way] = Math.sign(side[way] - opening.at[way]) || 1;
        return { name: `opening ${opening.number} (${opening.width} wide)`, at: opening.at, front };
      }),
    ),
  ];
  const failures = [];
  const warnings = [];
  for (const door of fronts) {
    const [x, y, floor] = door.at;
    const hit = first([x, y, floor + FRONT_Z], [x + door.front[0] * FRONT_CLEAR, y + door.front[1] * FRONT_CLEAR, floor + FRONT_Z]); // prettier-ignore
    const stands = standsAt(space, [], x + door.front[0] * FRONT_STAND, y + door.front[1] * FRONT_STAND, floor, bodyOf("standing")) === true; // prettier-ignore
    Object.assign(door, { distance: hit ? Math.round(hit.distance) : null, what: hit?.what ?? null, stands });
    const where = `${door.name} at ${place(door.at)}, its ${compass(door.front)} front`;
    const said = door.door ? failures : warnings;
    if (hit) said.push(`${where}: ${hit.what} stands ${door.distance} units before it at ${FRONT_Z} over its floor, under the ${FRONT_CLEAR} a player needs to come through`); // prettier-ignore
    else if (!door.stands) said.push(`${where}: a standing player (32 x 32 x 72) has no place to stand ${FRONT_STAND} out from it`); // prettier-ignore
  }
  return { fronts, failures, warnings };
}

/** Each spawn's first look: `{ looks, failures, warnings }`. */
function spawnLooks(bsp, space) {
  const first = lineTracer(bsp, space);
  const along = (from, yaw) => {
    const r = (yaw * Math.PI) / 180;
    return first(from, [from[0] + Math.cos(r) * LOOK_FAR, from[1] + Math.sin(r) * LOOK_FAR, from[2]])?.distance ?? LOOK_FAR;
  };
  const looks = [];
  const failures = [];
  const warnings = [];
  bsp.entities.forEach((entity, number) => {
    const classname = valueOf(entity, "classname") ?? "";
    const origin = (valueOf(entity, "origin") ?? "").split(/\s+/).map(Number);
    if (!/^info_player_/.test(classname) || origin.length !== 3 || !origin.every(Number.isFinite)) return;
    const angles = valueOf(entity, "angles");
    const set = angles !== undefined || valueOf(entity, "angle") !== undefined;
    const yaw = Number(angles !== undefined ? String(angles).trim().split(/\s+/)[1] ?? 0 : valueOf(entity, "angle") ?? 0) || 0;
    const eye = [origin[0], origin[1], origin[2] + SPAWN_EYE];
    const distance = Math.round(along(eye, yaw));
    const best = [0, 45, 90, 135, 180, 225, 270, 315].map((way) => ({ yaw: way, distance: Math.round(along(eye, way)) })).reduce((a, b) => (b.distance > a.distance + 1 ? b : a)); // prettier-ignore
    looks.push({ number, classname, eye, yaw, distance, best });
    const where = `${classname} ${number} at ${place(origin)}, looking yaw ${yaw}`;
    if (distance < SPAWN_LOOK) failures.push(`${where}: the first solid is ${distance} units away, under ${SPAWN_LOOK}; the longest open way is yaw ${best.yaw} (${best.distance}): a player spawns facing a wall`); // prettier-ignore
    else if (!set && best.yaw !== yaw && best.distance > distance * 2) warnings.push(`${where}: the entity has no angle (0 by default) and the open side is elsewhere: yaw ${best.yaw} sees ${best.distance}, this ${distance}`); // prettier-ignore
  });
  return { looks, failures, warnings };
}

/** A compiler's log as `{ errors, warnings }` sentences: its warning lines grouped, its error lines as they are. */
function logFaults(text) {
  const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return {
    errors: lines.filter((line) => /^error\b|===\s*leak\b/i.test(line)),
    warnings: groupedWarnings(lines.filter((line) => /^warning\b/i.test(line) && !/===\s*leak\b/i.test(line))),
  };
}

/**
 * Every player-facing check the kit has, over a compiled map's bytes (`.bsp`). Options:
 *   map       the .map it came from (`readMap`'s), for the coplanar faces and the budget's brushes and range
 *   rooms     `{ name: { min, max } }` boxes, for the light room by room (else its dark patches)
 *   eyes      `[[x, y, z]]` eyes for the sky gaps instead of the spawns and the walked floor; `windows` boxes whose gaps
 *             are meant (`skyGaps`'s `ignore`); `rays` (2000)
 *   log       a compile's log text, its warnings grouped
 *   pvsBudget `{ median, p90 }`; `limits` the budget's (`budgetOf`)
 * Returns `{ checks, level, line, reach, pvs, views }`: `checks` is `[{ name, level, said, detail }]` (`level` PASS, WARN or
 * FAIL, `said` its first reason, `detail` every line), `line` the last line with the counts, `views` the places to look
 * at a fault from (`[{ from, to, name }]`, what `viewsOf` takes as `at`): each sky gap from its eye, each failing front
 * and spawn, each dark room from its middle.
 */
export function mapBattery(bytes, { map = null, rooms = null, eyes, windows, rays, log = null, pvsBudget, limits } = {}) {
  if (!(bytes instanceof Uint8Array)) throw new Error("mapBattery: the compiled map's bytes, as readFileSync gives them");
  const bsp = readBsp(bytes);
  const checks = [];
  const views = [];
  const check = (name, { failures = [], warnings = [], facts = [], passed }) => {
    const level = failures.length ? "FAIL" : warnings.length ? "WARN" : "PASS";
    const said = failures[0] ?? warnings[0] ?? passed;
    checks.push({ name, level, said, detail: [...failures.map((f) => `FAIL ${f}`), ...warnings.map((w) => `WARN ${w}`), ...facts] });
  };

  const reach = reachOf(bsp);
  const fatal = (w) => / are not reached | stand in something solid|^no place to start/i.test(w);
  check("reach", { failures: reach.warnings.filter(fatal), warnings: reach.warnings.filter((w) => !fatal(w)), facts: reach.facts, passed: `every entity a player goes to is reached, and no part of the floor the size of a room is left; ${reach.facts.find((f) => /^the walk reaches/.test(f)) ?? ""}` }); // prettier-ignore

  const light = lightReport(bsp, { rooms, reach });
  const dark = light.rooms.filter((room) => room.dark && room.name !== "elsewhere");
  for (const room of dark) {
    const box = rooms[room.name];
    const middle = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, box.min[2] + 8 + 64];
    views.push({ from: middle, to: [middle[0] + 64, middle[1], middle[2] - 32], name: `dark room ${room.name} (${room.mean})` });
  }
  check("light", { warnings: light.lit ? light.warnings : ["the map has no light data (compiled without hlrad): the game draws it fully bright"], facts: light.facts, passed: `no floor a player walks is dark (${light.floor.mean} of 255 on average${rooms ? `, ${light.rooms.length} rooms` : ""})` }); // prettier-ignore

  const space = spaceOf(bsp);
  const clearance = doorClearance(bsp);
  const fronts = doorFronts(bsp, space, reach, clearance);
  for (const door of fronts.fronts.filter((d) => d.distance !== null || !d.stands).slice(0, 4)) {
    const eye = [door.at[0] - door.front[0] * 8, door.at[1] - door.front[1] * 8, door.at[2] + 64];
    views.push({ from: eye, to: [eye[0] + door.front[0] * 256, eye[1] + door.front[1] * 256, eye[2] - 24], name: `front of ${door.name}` });
  }
  check("fronts", { failures: [...clearance.warnings, ...fronts.failures], warnings: fronts.warnings, facts: fronts.fronts.map((d) => `${d.name} ${compass(d.front)}: ${d.distance === null ? "clear" : `${d.distance} to ${d.what}`}${d.stands ? "" : ", no place to stand"}`), passed: `${clearance.doors.length} doors and ${reach.openings.length} openings, ${fronts.fronts.length} fronts: each has ${FRONT_CLEAR} of clear air and a place to stand ${FRONT_STAND} out` }); // prettier-ignore

  const spawns = spawnLooks(bsp, space);
  for (const look of spawns.looks.filter((l) => l.distance < SPAWN_LOOK).slice(0, 4)) views.push({ from: look.eye, yaw: look.yaw, name: `spawn ${look.number}` });
  check("spawns", { failures: spawns.failures, warnings: spawns.warnings, facts: spawns.looks.map((l) => `${l.classname} ${l.number} yaw ${l.yaw}: ${l.distance} to the first solid; the longest open way yaw ${l.best.yaw} (${l.best.distance})`), passed: spawns.looks.length ? `${spawns.looks.length} spawns, each sees ${SPAWN_LOOK} or more along its yaw` : "no info_player_* in the map" }); // prettier-ignore

  const sky = skyGaps(bsp, { reach, ...(eyes ? { eyes } : {}), ...(windows ? { ignore: windows } : {}), ...(rays ? { rays } : {}) });
  for (const gap of sky.gaps.slice(0, 4)) views.push({ from: gap.eye, to: gap.at, name: `sky gap ${gap.width} wide at ${place(gap.at)}` });
  check("skygaps", { warnings: sky.warnings, facts: sky.facts, passed: sky.said });

  if (map) {
    const coplanar = coplanarFaults(map);
    check("coplanar", { failures: coplanar.fights, facts: coplanar.folded, passed: "no brush entity's face lies on another's looking the same way" });
  } else checks.push({ name: "coplanar", level: "PASS", said: "not asked: give the .map (--map)", detail: [] });

  const pvs = checkPvs(bsp, { reach, ...(pvsBudget ? { budget: pvsBudget } : {}) });
  check("pvs", { failures: pvs.errors.length ? pvs.errors : pvs.passed ? [] : [pvs.said], warnings: pvs.warnings, facts: pvs.facts, passed: pvs.said });

  const budget = budgetOf({ bsp: bytes, map, ...(limits ? { limits } : {}) });
  check("budget", { failures: budget.failures, warnings: budget.warnings, facts: budget.text.split("\n"), passed: budget.line.replace(/^PASS: /, "") });

  const swept = sweepOf(bsp, { reach });
  const hurts = swept.drops.length ? [swept.facts[0]] : [];
  const glows = swept.floating.some((f) => f.seen) ? [swept.facts[1]] : [];
  check("sweep", { warnings: [...hurts, ...glows, ...(swept.islands.length || /not looked for/.test(swept.facts[3]) ? [swept.facts[3]] : [])], facts: swept.facts, passed: "no drop that hurts, no glow in mid-air, no solid floating" }); // prettier-ignore

  if (log !== null) {
    const compiled = logFaults(log);
    check("compile", { failures: compiled.errors, warnings: compiled.warnings, passed: "the compiler's log has no warning" });
  } else checks.push({ name: "compile", level: "PASS", said: "not asked: give the compile's log (--log)", detail: [] });

  const count = (level) => checks.filter((c) => c.level === level);
  const level = LEVELS[Math.max(...checks.map((c) => LEVELS.indexOf(c.level)))];
  const names = (list) => (list.length ? ` (${list.map((c) => c.name).join(", ")})` : "");
  const line = `${level}: ${count("FAIL").length} of ${checks.length} checks fail${names(count("FAIL"))}, ${count("WARN").length} warn${names(count("WARN"))}, ${count("PASS").length} pass`; // prettier-ignore
  return { checks, level, line, reach, pvs, views };
}
