// A map's two teams, as a team plugin plays a deathmatch mod's map: which spawn each side comes into the
// round at, how near the two sides' spawns are, whether one side's spawn sees the other's, and how far each
// side walks to a goal. Made for the ts_matchmode plugin of The Specialists (its profile's `teams`), whose
// rules are replayed here exactly (ts_matchmode.sma: collect_spawns, partition_spawns, srv_spawn,
// cmd_spawn_save); any other mod's plugin that splits a map the same way is its profile's `teams`.
//
//   teamsOf(map, options)          the report: the teams, the nearest pair across them, the spawns seen from the
//                                  other side, the walks to a goal and their balance; faults, warnings, facts
//   collectSpawns(map, teams)      the map's own spawns as the plugin gathers them: one class after another,
//                                  each in the order of the map's entities, `most` at the most
//   partitionSpawns(spawns)        the plugin's split: the farthest pair (in 3D) the anchors, each spawn with the
//                                  nearer, a tie to team 1
//   readSpawnCfg(text)             a tsm_spawns_<map>.cfg read as the plugin reads it (`tsm_spawn` lines)
//   spawnCfgText(name, spawns)     one written as amx_tsm_spawn_save writes it
//   spawnCfgName(name)             its file's name for a map: tsm_spawns_<map>.cfg
//
// The profile's `teams` (profiles/specialists.mjs, TEAMS):
//   classes   the spawn classes, in the order the plugin gathers them
//   most      how many spawns it keeps, of the map's and of each team's in the file
//   names     the two teams' names
//   cross     { fail, warn }: the nearest spawns of the two teams closer than these is a fault, a warning
//   balance   { warn, fail }: the walks to a goal further apart than these per cent of the shorter
//   sight     "fail" or "warn": a spawn of one team in sight of one of the other's
// A geometry test, like the walk test: no game is run, and the plugin's random choice of a spawn for each player
// (with no check of a player standing there already) is not played.
import { spaceOf, restOf, isCompiled } from "./space.mjs";
import { entitiesOf } from "./rules.mjs";
import { worldBounds } from "./bsp.mjs";
import { reachOf } from "./reach.mjs";
import { sightTest } from "./encounters.mjs";
import { modOf } from "./mod.mjs";
import { PLAYER_ORIGIN_HEIGHT } from "./source.mjs";

/** What a profile's `teams` leaves out: ts_matchmode's own rules, and the thresholds of profiles/specialists.mjs. */
export const TEAM_PLAY = {
  plugin: "ts_matchmode",
  classes: ["info_player_deathmatch", "info_player_start"],
  most: 64,
  names: ["team 1", "team 2"],
  cross: { fail: 512, warn: 1400 },
  balance: { warn: 10, fail: 25 },
  sight: "fail",
};
/** A player's eyes over his origin (Half-Life's VEC_VIEW). */
const EYE = 28;
/** Fewer spawns a team than this, and two players are often put on one (the plugin picks at random). */
const FEW = 5;
/** A walk gets to a spawn or a goal when a player's box comes this near it (a goal written a little in a kerb is still got to). */
const TOUCH = 64;
/** How many of a list a sentence names. */
const LISTED = 6;

const round = (point) => point.map((value) => Math.round(value)).join(" ");
const some = (list, listed = LISTED) =>
  `${list.slice(0, listed).join("; ")}${list.length > listed ? `; and ${list.length - listed} more` : ""}`;
const f32 = Math.fround;
/** get_distance_f as the plugin has it: in single precision, as Pawn's floats are. */
const distanceF = (a, b) => {
  const dx = f32(f32(a[0]) - f32(b[0]));
  const dy = f32(f32(a[1]) - f32(b[1]));
  const dz = f32(f32(a[2]) - f32(b[2]));
  return f32(Math.sqrt(f32(f32(f32(dx * dx) + f32(dy * dy)) + f32(dz * dz))));
};
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const pointOf = (value) => {
  const parts = String(value ?? "").trim().split(/\s+/).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? parts : null;
};

/** The profile's `teams` made whole. */
function rulesOf(mod, given) {
  const own = { ...(modOf(mod)?.teams ?? {}), ...(given ?? {}) };
  return {
    ...TEAM_PLAY,
    ...own,
    cross: { ...TEAM_PLAY.cross, ...own.cross },
    balance: { ...TEAM_PLAY.balance, ...own.balance },
  };
}

/** The file a map's spawns are kept in for the plugin: `tsm_spawns_<map>.cfg`. */
export const spawnCfgName = (name) => `tsm_spawns_${name}.cfg`;

/**
 * The map's own spawns as the plugin gathers them (collect_spawns): every entity of the first class in the
 * order of the map's entities, then of the next, until `most`. `[{ number, classname, origin }]`; an entity with
 * no origin stands at 0 0 0, as the engine has it.
 */
export function collectSpawns(map, { classes = TEAM_PLAY.classes, most = TEAM_PLAY.most } = {}) {
  const entities = entitiesOf(map);
  const spawns = [];
  for (const classname of classes)
    for (const entity of entities) {
      if (spawns.length >= most) return spawns;
      if (entity.classname !== classname) continue;
      spawns.push({ number: entity.number, classname, origin: pointOf(entity.get("origin")) ?? [0, 0, 0] });
    }
  return spawns;
}

/**
 * The plugin's split of a map's spawns (partition_spawns): the two farthest apart in 3D (the first such pair
 * in the list's order) are the anchors, and each spawn goes with the nearer, a tie with the first (team 1).
 * Each team keeps 64 at the most. Fewer than two spawns: both teams share them. `{ teams: [[...], [...]], anchors:
 * [a, b] | null, apart }`, the anchors as indices of `spawns`.
 */
export function partitionSpawns(spawns, { most = TEAM_PLAY.most } = {}) {
  if (spawns.length < 2) return { teams: [[...spawns], [...spawns]], anchors: null, apart: 0 };
  let a = 0;
  let b = 1;
  let best = 0;
  for (let i = 0; i < spawns.length; i++)
    for (let j = i + 1; j < spawns.length; j++) {
      const d = distanceF(spawns[i].origin, spawns[j].origin);
      if (d > best) [best, a, b] = [d, i, j];
    }
  const teams = [[], []];
  for (const spawn of spawns) {
    const team = distanceF(spawn.origin, spawns[a].origin) <= distanceF(spawn.origin, spawns[b].origin) ? 0 : 1;
    if (teams[team].length < most) teams[team].push(spawn);
  }
  return { teams, anchors: [a, b], apart: best };
}

/**
 * A spawn file read as the plugin reads it (exec'd: `tsm_spawn <team> <x> <y> <z> [pitch] [yaw]`, a team 1 or
 * 2, `most` a team): `{ spawns: [{ team, origin, angles: [pitch, yaw, 0], line }], refused: [{ line, why }] }`.
 * Comments (`//`) and other commands are passed over; a line the plugin refuses is in `refused`.
 */
export function readSpawnCfg(text, { most = TEAM_PLAY.most } = {}) {
  const spawns = [];
  const refused = [];
  const count = [0, 0];
  String(text).split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const words = raw.replace(/\/\/.*$/, "").trim().split(/\s+/).filter(Boolean);
    if (words[0]?.toLowerCase() !== "tsm_spawn") return;
    if (words.length < 5) return refused.push({ line, why: "fewer than four numbers: tsm_spawn <team 1|2> <x> <y> <z> [pitch] [yaw]" }); // prettier-ignore
    // the plugin reads numbers as str_to_num and str_to_float do: what is not a number is 0
    const number = (word) => (word === undefined ? 0 : Number.isFinite(parseFloat(word)) ? parseFloat(word) : 0);
    const team = Number.isFinite(parseInt(words[1], 10)) ? parseInt(words[1], 10) : 0;
    if (team !== 1 && team !== 2) return refused.push({ line, why: `team must be 1 or 2, not ${words[1]}` });
    if (count[team - 1] >= most) return refused.push({ line, why: `team ${team}'s list is full (${most})` });
    count[team - 1]++;
    const origin = [number(words[2]), number(words[3]), number(words[4])];
    spawns.push({ team, origin, angles: [number(words[5]), number(words[6]), 0], line });
  });
  return { spawns, refused };
}

/**
 * A spawn file as amx_tsm_spawn_save writes it: its two lines of header, then a `tsm_spawn` line a spawn, team 1's
 * first, each number to two places. `spawns` is `[{ team, origin, angles: [pitch, yaw] }]`; `origin` is the
 * player's (his feet 36 under it).
 */
export function spawnCfgText(name, spawns) {
  const lines = [
    `// ts_matchmode spawn points for ${name} -- written by amx_tsm_spawn_save`,
    "// tsm_spawn <team> <x> <y> <z> <pitch> <yaw>",
  ];
  const fixed = (value) => {
    const text = (Math.round(value * 100) / 100).toFixed(2);
    return text === "-0.00" ? "0.00" : text;
  };
  for (const team of [1, 2])
    for (const spawn of spawns.filter((each) => each.team === team))
      lines.push(`tsm_spawn ${team} ${[...spawn.origin, spawn.angles?.[0] ?? 0, spawn.angles?.[1] ?? 0].map(fixed).join(" ")}`);
  return `${lines.join("\n")}\n`;
}

/** A goal as given: a point, or the origin of the entity a number, a classname or a targetname names. */
function goalOf(map, goal) {
  if (goal === undefined || goal === null) return null;
  if (Array.isArray(goal)) {
    if (goal.length !== 3 || !goal.every(Number.isFinite)) throw new Error(`goal: a point [x, y, z], not ${JSON.stringify(goal)}`);
    return { at: goal, named: `the point ${round(goal)}` };
  }
  const entity = entitiesOf(map).find(
    (each) => each.number === goal || each.classname === goal || each.get("targetname") === goal,
  );
  if (!entity) throw new Error(`goal: no entity ${goal} in the map (a number, a classname, a targetname, or a point x,y,z)`);
  const at = pointOf(entity.get("origin"));
  if (!at) throw new Error(`goal: ${entity.named} has no origin: give a point x,y,z`);
  return { at, named: `${entity.named}${entity.get("targetname") ? ` "${entity.get("targetname")}"` : ""} at ${round(at)}` };
}

/**
 * A map's two teams as the plugin plays it. `map` is a compiled map or brush source. Options:
 *   mod      the mod's profile: its `teams` (and its starts, its doors and its boxes for the walk)
 *   teams    rules over the profile's (`TEAM_PLAY`'s shape)
 *   cfg      the text of a tsm_spawns_<map>.cfg: its spawns, as the plugin takes them over the map's own
 *   goal     where both teams make for: a point [x, y, z], or an entity's number, classname or targetname
 *   walk     false: no walks (the walk test is the slow part)
 *   each     true: the walk from each spawn alone (a walk test a spawn), each team's median held to the other's;
 *            unless told, from each team's spawns at once: its nearest
 *   doors, jump, cell   for the walks, as `reachOf` takes them
 *   name     the map's name, for the file written
 *
 * Returns `{ source, rules, teams: [{ team, name, spawns: [{ number, classname, origin, floor, player, eye,
 * fits, hang, angles }] }], anchors, cross, seen, walks, contact, cfg, faults, warnings, facts }`: `source` "cfg" or
 * "map"; `cross` the nearest pair across the teams `{ distance, a, b }`; `seen` the pairs in sight of each other;
 * `walks` `{ goal, teams: [{ team, far, each, median }], balance }` (balance in per cent of the shorter);
 * `contact` the walk from team 1's spawns to team 2's nearest; `cfg` the file's text, each spawn at its floor
 * (z the player's origin, 36 over it) and turned to the goal, or to the middle of the map.
 */
export function teamsOf(map, options = {}) {
  const rules = rulesOf(options.mod, options.teams);
  const faults = [];
  const warnings = [];
  const facts = [];
  const said = (team) => `team ${team} (${rules.names[team - 1]})`;

  // ── the spawns: the file's, or the map's split as the plugin splits it ──
  let source = "map";
  let teams;
  let anchors = null;
  if (options.cfg !== undefined && options.cfg !== null) {
    const read = readSpawnCfg(options.cfg, rules);
    for (const each of read.refused) warnings.push(`the spawn file's line ${each.line} is passed over by the plugin: ${each.why}`);
    if (read.spawns.length) {
      source = "cfg";
      teams = [1, 2].map((team) => read.spawns.filter((each) => each.team === team).map((each) => ({ number: null, classname: `tsm_spawn line ${each.line}`, origin: each.origin, angles: each.angles }))); // prettier-ignore
      facts.push(`the spawn file gives ${read.spawns.length} spawns (${said(1)} ${teams[0].length}, ${said(2)} ${teams[1].length}): the plugin takes them, and the map's own spawns are not used`); // prettier-ignore
      for (const team of [1, 2])
        if (!teams[team - 1].length) faults.push(`the spawn file gives ${said(team)} no spawn: the plugin puts it at the other team's (it borrows one)`); // prettier-ignore
    } else warnings.push("the spawn file gives no spawn the plugin takes: it falls back to the map's own");
  }
  if (!teams) {
    const spawns = collectSpawns(map, rules);
    const counted = rules.classes.map((classname) => `${spawns.filter((each) => each.classname === classname).length} ${classname}`); // prettier-ignore
    const split = partitionSpawns(spawns, rules);
    teams = split.teams;
    if (split.anchors) {
      anchors = { a: spawns[split.anchors[0]], b: spawns[split.anchors[1]], apart: Math.round(split.apart) };
      facts.push(`the map's own spawns, as ${rules.plugin} gathers them (${counted.join(", ")}; ${rules.most} at the most) and splits them: the two farthest apart, entity ${anchors.a.number} at ${round(anchors.a.origin)} and entity ${anchors.b.number} at ${round(anchors.b.origin)} (${anchors.apart} apart), the anchors; each spawn with the nearer: ${said(1)} ${teams[0].length}, ${said(2)} ${teams[1].length}`); // prettier-ignore
    } else faults.push(`the map has ${spawns.length} spawn${spawns.length === 1 ? "" : "s"} of ${rules.classes.join(" or ")}: nothing to split, both teams share ${spawns.length ? "it" : "none"}`); // prettier-ignore
  }

  // ── where each stands: its floor, its eyes ──
  const space = spaceOf(map, { doors: "closed", mod: options.mod });
  const placed = teams.map((list, index) => ({
    team: index + 1,
    name: rules.names[index],
    spawns: list.map((spawn) => {
      const feet = [spawn.origin[0], spawn.origin[1], spawn.origin[2] - PLAYER_ORIGIN_HEIGHT];
      const rest = restOf(space, feet, "standing");
      const floor = rest.fits && rest.floor !== null ? rest.floor : null;
      const player = [spawn.origin[0], spawn.origin[1], floor === null ? spawn.origin[2] : floor + PLAYER_ORIGIN_HEIGHT];
      return { ...spawn, floor, fits: rest.fits, hang: rest.fits ? rest.hang : null, player, eye: [player[0], player[1], player[2] + EYE] }; // prettier-ignore
    }),
  }));
  const where = (spawn) => (spawn.number !== null ? `entity ${spawn.number} at ${round(spawn.origin)}` : `${spawn.classname} at ${round(spawn.origin)}`); // prettier-ignore
  for (const team of placed) {
    const stuck = team.spawns.filter((spawn) => !spawn.fits);
    if (stuck.length) faults.push(`${stuck.length} of ${said(team.team)}'s spawns put a player in something solid: ${some(stuck.map(where))}`); // prettier-ignore
    const air = team.spawns.filter((spawn) => spawn.fits && spawn.floor === null);
    if (air.length) faults.push(`${air.length} of ${said(team.team)}'s spawns have no floor under them: ${some(air.map(where))}`); // prettier-ignore
    if (team.spawns.length && team.spawns.length < FEW) warnings.push(`${said(team.team)} has ${team.spawns.length} spawn${team.spawns.length === 1 ? "" : "s"}: the plugin picks one at random for each player with no look at who stands there, so a team of ${FEW} is often put two on one; give each team ${FEW * 2} or more`); // prettier-ignore
    if (team.spawns.length) {
      const zs = team.spawns.map((spawn) => spawn.player[2]);
      const [lo, hi] = [Math.min(...zs), Math.max(...zs)];
      const xs = team.spawns.map((spawn) => spawn.player[0]);
      const ys = team.spawns.map((spawn) => spawn.player[1]);
      facts.push(`${said(team.team)}: ${team.spawns.length} spawns over ${Math.round(Math.max(...xs) - Math.min(...xs))} x ${Math.round(Math.max(...ys) - Math.min(...ys))}, standing at ${lo === hi ? Math.round(lo - PLAYER_ORIGIN_HEIGHT) : `${Math.round(lo - PLAYER_ORIGIN_HEIGHT)} to ${Math.round(hi - PLAYER_ORIGIN_HEIGHT)}`}`); // prettier-ignore
    }
  }

  // ── the nearest pair across the teams, and who sees whom ──
  let cross = null;
  const seen = [];
  const sees = sightTest(map, { space });
  if (source === "cfg" || anchors)
    for (const a of placed[0].spawns)
      for (const b of placed[1].spawns) {
        const d = distance(a.player, b.player);
        if (!cross || d < cross.distance) cross = { distance: d, a, b };
        const body = (spawn) => [spawn.player[0], spawn.player[1], spawn.player[2]];
        if (sees(a.eye, b.eye) || sees(a.eye, body(b)) || sees(b.eye, body(a))) seen.push({ a, b, distance: Math.round(d) });
      }
  if (cross) {
    cross.distance = Math.round(cross.distance);
    const line = `the nearest spawns of the two teams are ${cross.distance} apart (in 3D): ${said(1)}'s ${where(cross.a)} and ${said(2)}'s ${where(cross.b)}`; // prettier-ignore
    if (cross.distance < rules.cross.fail) faults.push(`${line}: under ${rules.cross.fail}, a fight at the spawn; put the teams' spawns at the map's far ends, ${rules.cross.warn} or more apart`); // prettier-ignore
    else if (cross.distance < rules.cross.warn) warnings.push(`${line}: under ${rules.cross.warn}; the teams meet within seconds of the round's start`); // prettier-ignore
    else facts.push(line);
  }
  if (seen.length) {
    const line = `${seen.length} pairs of spawns of the two teams are in sight of each other (a clear line from a player's eyes at one to the other; the dark and where he looks not counted): ${some(seen.sort((p, q) => p.distance - q.distance).map((pair) => `${where(pair.a)} and ${where(pair.b)}, ${pair.distance} apart`), 4)}`; // prettier-ignore
    (rules.sight === "warn" ? warnings : faults).push(`${line}: a wall, a turn or a closed door between the two sides' spawns`);
  } else if (cross) facts.push("no spawn of one team is in sight of a spawn of the other");

  // ── the walks ──
  // the goal as a player standing there: on the floor under it, or on the top of the solid it is in
  const goal = goalOf(map, options.goal);
  if (goal) {
    const rest = restOf(space, goal.at, "standing");
    const floor = rest.fits ? rest.floor : rest.stretch[1];
    if (floor !== null && goal.at[2] - floor < 2 * PLAYER_ORIGIN_HEIGHT + EYE) goal.at = [goal.at[0], goal.at[1], floor + PLAYER_ORIGIN_HEIGHT];
  }
  let walks = null;
  let contact = null;
  const walkOptions = { ...(options.mod ? { mod: options.mod } : {}), parts: false, touch: TOUCH, ...(options.doors ? { doors: options.doors } : {}), ...(options.jump !== undefined ? { jump: options.jump } : {}), ...(options.cell ? { cell: options.cell } : {}) }; // prettier-ignore
  const feetOf = (spawn) => [spawn.player[0], spawn.player[1], spawn.player[2] - PLAYER_ORIGIN_HEIGHT];
  let why = "";
  const walkFrom = (spawns, to) => {
    const walked = reachOf(map, { ...walkOptions, from: spawns.map(feetOf), to });
    why = walked.warnings.find((line) => line.startsWith("to: the point"))?.replace(/^to: /, "") ?? "";
    return walked.routes.length ? Math.min(...walked.routes.map((route) => route.far)) : null;
  };
  const ready = options.walk !== false && placed.every((team) => team.spawns.some((spawn) => spawn.floor !== null));
  if (ready && (source === "cfg" || anchors)) {
    const standing = placed.map((team) => team.spawns.filter((spawn) => spawn.floor !== null));
    contact = walkFrom(standing[0], standing[1].map((spawn) => spawn.player));
    if (contact === null) faults.push(`no walk leads from ${said(1)}'s spawns to ${said(2)}'s: the two sides never meet on foot`);
    else facts.push(`the walk from ${said(1)}'s spawns to within ${TOUCH} of ${said(2)}'s nearest is ${contact} units (${(contact / 320).toFixed(1)} s at a run of 320)`); // prettier-ignore
    if (goal) {
      const each = options.each === true;
      const teamWalks = standing.map((list, index) => {
        const all = each ? list.map((spawn) => walkFrom([spawn], [goal.at])) : null;
        const reached = all?.filter((far) => far !== null).sort((p, q) => p - q) ?? [];
        const far = each ? (reached.length ? reached[0] : null) : walkFrom(list, [goal.at]);
        const median = each ? (reached.length ? reached[Math.floor((reached.length - 1) / 2)] : null) : far;
        return { team: index + 1, far, each: all, median };
      });
      const [p, q] = teamWalks.map((walk) => walk.median);
      const balance = p && q ? Math.round((1000 * Math.abs(p - q)) / Math.min(p, q)) / 10 : null;
      walks = { goal, teams: teamWalks, balance };
      const by = each ? "the median of its spawns' walks" : "from its nearest spawn";
      for (const walk of teamWalks)
        if (walk.median === null) faults.push(`${said(walk.team)} does not walk to the goal, ${goal.named}${why ? `: ${why}` : ""}`);
        else facts.push(`${said(walk.team)} walks ${walk.median} units to the goal, ${goal.named} (${by}${each ? `; ${walk.each.map((far) => far ?? "none").join(", ")}` : ""})`); // prettier-ignore
      if (balance !== null) {
        const line = `the two teams' walks to the goal are ${balance}% apart (${p} and ${q}, of the shorter)`;
        if (balance > rules.balance.fail) faults.push(`${line}: over ${rules.balance.fail}%; one side gets there first by ${((Math.abs(p - q)) / 320).toFixed(1)} s`); // prettier-ignore
        else if (balance > rules.balance.warn) warnings.push(`${line}: over ${rules.balance.warn}%; even the walks within ${rules.balance.warn}%`); // prettier-ignore
        else facts.push(line);
      }
    } else facts.push("no goal given: the walks to one, and their balance, are not measured (goal: a point or an entity)");
  }

  // ── the file the plugin would read: each spawn at its floor, turned to the goal or the middle ──
  const middle = goal?.at ?? (() => {
    if (isCompiled(map)) {
      const { mins, maxs } = worldBounds(map);
      return mins.map((value, axis) => (value + maxs[axis]) / 2);
    }
    const all = placed.flatMap((team) => team.spawns.map((spawn) => spawn.player));
    return all.length ? [0, 1, 2].map((axis) => all.reduce((sum, point) => sum + point[axis], 0) / all.length) : [0, 0, 0];
  })();
  const toward = (from) => {
    const yaw = (Math.atan2(middle[1] - from[1], middle[0] - from[0]) * 180) / Math.PI;
    return Math.abs(from[0] - middle[0]) + Math.abs(from[1] - middle[1]) < 1 ? 0 : yaw;
  };
  // a file's own facing is kept; the map's spawns are turned
  for (const team of placed)
    for (const spawn of team.spawns) spawn.angles ??= [0, Math.round(toward(spawn.player) * 100) / 100];
  const filed = placed.flatMap((team) => team.spawns.map((spawn) => ({ team: team.team, origin: spawn.player, angles: spawn.angles })));
  const cfg = spawnCfgText(options.name ?? "map", filed);

  return { source, rules, teams: placed, anchors, cross, seen, walks, contact, cfg, faults, warnings, facts };
}
