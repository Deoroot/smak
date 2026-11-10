// A map's two teams as the ts_matchmode plugin plays a deathmatch map of The Specialists (teams.mjs): its spawns
// gathered and split as the plugin's own code does it, a spawn file read and written in the plugin's format, the
// nearest spawns across the teams, spawns in sight of the other side's, the walks to a goal and their balance;
// `smak map-teams`. Then what came with it: the kit's profiles by name and the installed game found, the walk to
// a point, the dressing held to a mod's own bands (and those bands learned), lamp faces counted beside the
// lights, and The Specialists' compact arenas. Arenas of the kit's own; no game file.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../check/maps/index.mjs";
import specialists, { COMPACT, DRESSING, TEAMS } from "../profiles/specialists.mjs";
import { test, sure, near, tmp, runSmak, runRefused, SMAK_CLI, HERE } from "./helper.mjs";

const FIXTURES = join(HERE, "fixtures");
const folder = join(tmp, "map-teams");
mkdirSync(folder, { recursive: true });
const WEARS = { floor: "FLOOR", ceiling: "CEILING", wall: "WALL" };
const spawn = (x, y, classname = "info_player_deathmatch") => maps.playerStart([x, y, 0], 0, classname);
const WEST = [[64, 128], [64, 256], [64, 384]];
const EAST = [[2336, 128], [2336, 256], [2336, 384]];

/**
 * An arena 2400 long: `walled`, two rooms whose only way between is a corridor to the north (no line runs from
 * one to the other); else one open hall. Three spawns at each end.
 */
function arena({ walled = true, more = [] } = {}) {
  const rooms = walled
    ? [
        { min: [0, 0, 0], max: [1000, 512, 256] },
        { min: [1400, 0, 0], max: [2400, 512, 256] },
        { min: [900, 512, 0], max: [1500, 700, 128] },
      ]
    : [{ min: [0, 0, 0], max: [2400, 512, 256] }];
  return {
    worldspawn: {},
    brushes: maps.carve(rooms, 16, WEARS),
    entities: [...WEST.map(([x, y]) => spawn(x, y)), ...EAST.map(([x, y]) => spawn(x, y)), ...more],
  };
}
const RULES = { names: ["red", "blue"] };

// ── the plugin's own rules ──────────────────────────────────────────────────
test("collectSpawns: info_player_deathmatch first, then info_player_start, each in the map's order, 64 at the most", () => {
  const map = { worldspawn: {}, brushes: [], entities: [spawn(0, 0, "info_player_start"), spawn(10, 0), spawn(20, 0), spawn(30, 0, "info_player_start")] }; // prettier-ignore
  const got = maps.collectSpawns(map);
  sure(JSON.stringify(got.map((each) => each.number)) === "[2,3,1,4]", `the order: ${got.map((each) => each.number)}`);
  sure(got[0].classname === "info_player_deathmatch" && got[2].classname === "info_player_start", "the classes");
  near(got[0].origin[2], 36, 0, "an origin read from the entity");
  sure(maps.collectSpawns(map, { most: 3 }).length === 3, "no more than `most`");
  const many = { worldspawn: {}, brushes: [], entities: Array.from({ length: 70 }, (_, i) => spawn(i * 40, 0)) };
  sure(maps.collectSpawns(many).length === 64, "64 at the most, as the plugin's g_spawns[64]");
});

test("partitionSpawns: the farthest pair (the first found) the anchors, each spawn with the nearer, a tie with team 1", () => {
  const at = (...points) => points.map((origin, number) => ({ number, origin }));
  // a square: both diagonals are farthest; the first pair found (0 and 3) are the anchors; 1 and 2 are equally far
  const square = maps.partitionSpawns(at([0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 10, 0]));
  sure(JSON.stringify(square.anchors) === "[0,3]", `the anchors: ${square.anchors}`);
  sure(JSON.stringify(square.teams.map((team) => team.map((each) => each.number))) === "[[0,1,2],[3]]", JSON.stringify(square.teams)); // prettier-ignore
  near(square.apart, Math.hypot(10, 10), 1e-4, "the anchors' distance");
  // in 3D: the height counts
  const high = maps.partitionSpawns(at([0, 0, 0], [300, 0, 0], [0, 0, 500], [280, 0, 20]));
  sure(JSON.stringify(high.anchors) === "[1,2]", `the anchors in 3D: ${high.anchors}`);
  // one spawn: both teams share it
  const one = maps.partitionSpawns(at([0, 0, 0]));
  sure(one.anchors === null && one.teams[0].length === 1 && one.teams[1].length === 1, "one spawn shared");
});

test("readSpawnCfg and spawnCfgText: the plugin's file read as it reads it, written as amx_tsm_spawn_save writes it", () => {
  const text = [
    "// a comment",
    "tsm_spawn 1 64 128 36 0 90",
    "tsm_spawn 2 2336.5 256 36",
    "tsm_spawn 3 0 0 0",
    "tsm_spawn 1 5 5",
    "exec something.cfg",
    "  TSM_SPAWN 2 x 10 20 // what is no number is 0",
  ].join("\r\n");
  const read = maps.readSpawnCfg(text);
  sure(read.spawns.length === 3, `three taken: ${JSON.stringify(read.spawns)}`);
  sure(JSON.stringify(read.spawns[0].angles) === "[0,90,0]" && JSON.stringify(read.spawns[1].angles) === "[0,0,0]", "the facing, or none"); // prettier-ignore
  sure(JSON.stringify(read.spawns[2].origin) === "[0,10,20]", `a word that is no number: ${read.spawns[2].origin}`);
  sure(read.refused.length === 2 && /team must be 1 or 2/.test(read.refused[0].why) && read.refused[1].line === 5, JSON.stringify(read.refused)); // prettier-ignore
  const full = Array.from({ length: 3 }, () => "tsm_spawn 1 0 0 0").join("\n");
  sure(maps.readSpawnCfg(full, { most: 2 }).refused.length === 1, "a team's list full");
  const written = maps.spawnCfgText("ts_arena", [
    { team: 2, origin: [2336, 256, 36], angles: [0, 180] },
    { team: 1, origin: [64, 128.456, -0.001], angles: [0, -0.004] },
  ]);
  const expected = [
    "// ts_matchmode spawn points for ts_arena -- written by amx_tsm_spawn_save",
    "// tsm_spawn <team> <x> <y> <z> <pitch> <yaw>",
    "tsm_spawn 1 64.00 128.46 0.00 0.00 0.00",
    "tsm_spawn 2 2336.00 256.00 36.00 0.00 180.00",
    "",
  ].join("\n");
  sure(written === expected, `the file:\n${written}`);
  sure(maps.spawnCfgName("ts_arena") === "tsm_spawns_ts_arena.cfg", "its name");
});

// ── the report ──────────────────────────────────────────────────────────────
test("teamsOf: the map's spawns split, the nearest across, no sight between walled ends, the walks to a goal even", () => {
  const report = maps.teamsOf(arena(), { teams: RULES, goal: [1200, 606, 0], name: "ts_arena" });
  sure(report.source === "map" && report.anchors && report.anchors.a.number === 1 && report.anchors.b.number === 6, JSON.stringify(report.anchors)); // prettier-ignore
  sure(report.teams[0].spawns.every((each) => each.origin[0] === 64) && report.teams[1].spawns.every((each) => each.origin[0] === 2336), "west and east"); // prettier-ignore
  near(report.cross.distance, 2272, 0, "the nearest across");
  sure(report.seen.length === 0, `no sight: ${JSON.stringify(report.seen.map((pair) => pair.distance))}`);
  sure(report.contact > 2000, `the walk between: ${report.contact}`);
  sure(report.walks.teams.every((walk) => walk.median > 1000) && report.walks.balance <= 2, JSON.stringify(report.walks.teams.map((walk) => walk.median)) + ` ${report.walks.balance}`); // prettier-ignore
  sure(report.faults.length === 0, report.faults.join(" | "));
  sure(report.facts.some((line) => /team 1 \(red\)/.test(line)), report.facts.join(" | "));
  // the file: at the floor (z 36 over it), turned to the goal
  const lines = report.cfg.trim().split("\n");
  sure(lines.length === 8 && lines[2].startsWith("tsm_spawn 1 64.00 128.00 36.00 0.00 ") && lines[7].startsWith("tsm_spawn 2 2336.00 384.00 36.00"), report.cfg); // prettier-ignore
  const yaw = Number(lines[2].split(" ")[6]);
  near(yaw, (Math.atan2(606 + 36 * 0 - 128, 1200 - 64) * 180) / Math.PI, 0.01, "team 1's first turned to the goal");
});

test("teamsOf: an open hall seen across, ends near each other, an uneven goal, a stuck spawn: each a fault or a warning", () => {
  const open = maps.teamsOf(arena({ walled: false }), { teams: RULES, walk: false });
  sure(open.seen.length === 9 && open.faults.some((line) => /9 pairs of spawns of the two teams are in sight/.test(line)), open.faults.join(" | ")); // prettier-ignore
  const warned = maps.teamsOf(arena({ walled: false }), { teams: { ...RULES, sight: "warn", cross: { fail: 100, warn: 2400 } }, walk: false }); // prettier-ignore
  sure(warned.faults.length === 0 && warned.warnings.some((line) => /in sight/.test(line)) && warned.warnings.some((line) => /under 2400/.test(line)), warned.warnings.join(" | ")); // prettier-ignore
  const near1 = maps.teamsOf(arena({ walled: false }), { teams: { ...RULES, cross: { fail: 2400, warn: 3000 } }, walk: false }); // prettier-ignore
  sure(near1.faults.some((line) => /2272 apart.*under 2400, a fight at the spawn/.test(line)), near1.faults.join(" | "));
  // a goal by the west room's door: west walks far less
  const uneven = maps.teamsOf(arena(), { teams: RULES, goal: [960, 606, 0] });
  sure(uneven.walks.balance > 25 && uneven.faults.some((line) => /walks to the goal are .*% apart.*over 25%/.test(line)), uneven.faults.join(" | ")); // prettier-ignore
  // each spawn walked alone: the median of each team's
  const each = maps.teamsOf(arena(), { teams: RULES, goal: [1200, 606, 0], each: true });
  sure(each.walks.teams.every((walk) => walk.each.length === 3 && walk.each.every((far) => far > 0)), JSON.stringify(each.walks.teams)); // prettier-ignore
  // a spawn in the wall
  const stuck = maps.teamsOf(arena({ more: [maps.pointEntity("info_player_start", [2410, 256, 36])] }), { teams: RULES, walk: false }); // prettier-ignore
  sure(stuck.faults.some((line) => /spawns put a player in something solid: entity 7/.test(line)), stuck.faults.join(" | "));
  // a goal by name; one the map has not
  const named = maps.teamsOf(arena({ more: [maps.pointEntity("info_target", [1200, 606, 40], { targetname: "clock" })] }), { teams: RULES, goal: "clock" }); // prettier-ignore
  sure(named.walks.goal.named.includes('"clock"') && named.walks.balance <= 2, JSON.stringify(named.walks));
  let refused = "";
  try {
    maps.teamsOf(arena(), { goal: "nothing" });
  } catch (error) {
    refused = error.message;
  }
  sure(/no entity nothing in the map/.test(refused), refused);
  // too few spawns on a side
  const few = maps.teamsOf(arena(), { teams: RULES, walk: false });
  sure(few.warnings.some((line) => /has 3 spawns/.test(line)), few.warnings.join(" | "));
});

test("teamsOf with a spawn file: its spawns over the map's, its own facing kept; a side with none, a fault", () => {
  const cfg = maps.spawnCfgText("ts_arena", [
    { team: 1, origin: [500, 256, 36], angles: [0, 45] },
    { team: 2, origin: [1900, 256, 36], angles: [0, 225] },
  ]);
  const report = maps.teamsOf(arena(), { teams: RULES, cfg, walk: false });
  sure(report.source === "cfg" && report.anchors === null && report.teams[0].spawns.length === 1, JSON.stringify(report.teams)); // prettier-ignore
  near(report.cross.distance, 1400, 0, "the nearest across, from the file");
  sure(report.cfg.includes("tsm_spawn 1 500.00 256.00 36.00 0.00 45.00"), report.cfg);
  const one = maps.teamsOf(arena(), { teams: RULES, cfg: "tsm_spawn 1 500 256 36", walk: false });
  sure(one.faults.some((line) => /gives team 2 \(blue\) no spawn/.test(line)), one.faults.join(" | "));
  const none = maps.teamsOf(arena(), { teams: RULES, cfg: "// nothing", walk: false });
  sure(none.source === "map" && none.warnings.some((line) => /falls back to the map's own/.test(line)), none.warnings.join(" | ")); // prettier-ignore
});

test("smak map-teams: the report, the spawn file written and read back, exit code 1 on a FAIL", () => {
  const walledFile = join(folder, "ts_arena.map");
  const openFile = join(folder, "ts_open.map");
  writeFileSync(walledFile, maps.writeMap(arena()));
  writeFileSync(openFile, maps.writeMap(arena({ walled: false })));
  const profile = join(folder, "teamplay.mjs");
  writeFileSync(profile, `export default { name: "teamplay", starts: ["info_player_deathmatch"], teams: ${JSON.stringify(RULES)} };\n`); // prettier-ignore
  const out = join(folder, "cfgs");
  const said = runSmak("map-teams", walledFile, "--mod", profile, "--goal", "1200,606,0", "--write-cfg", out);
  sure(/team 1 red\s+3 spawns\s+to the goal \d+/.test(said) && /the nearest spawns of the two teams are 2272 apart/.test(said), said); // prettier-ignore
  const file = join(out, "tsm_spawns_ts_arena.cfg");
  sure(existsSync(file) && readFileSync(file, "utf8").startsWith("// ts_matchmode spawn points for ts_arena -- written by amx_tsm_spawn_save\n"), "the file"); // prettier-ignore
  const back = runSmak("map-teams", walledFile, "--mod", profile, "--cfg", file, "--no-walk", "--json");
  const json = JSON.parse(back);
  sure(json.source === "cfg" && json.plugin === "ts_matchmode" && json.teams[1].spawns.length === 3, back.slice(0, 300));
  const open = runRefused(SMAK_CLI, "map-teams", openFile, "--mod", profile, "--no-walk");
  sure(open.code === 1 && /FAIL\s+9 pairs of spawns/.test(open.out), open.out + open.err);
  const plain = join(folder, "plain.mjs");
  writeFileSync(plain, "export default { name: \"plain\" };\n");
  const refused = runRefused(SMAK_CLI, "map-teams", walledFile, "--mod", plain);
  sure(refused.code === 1 && /teams/.test(refused.err), refused.err);
  const nameless = runRefused(SMAK_CLI, "map-teams", walledFile, "--mod", "nosuchgame");
  sure(nameless.code === 1 && /one of the kit's: ts, specialists/.test(nameless.err), nameless.err);
});

// ── what came with it ───────────────────────────────────────────────────────
test("the walk to a point: a route and its length; a point no floor comes to, with where the walk comes nearest", () => {
  const walked = maps.reachOf(arena(), { to: [[1200, 606, 36]] });
  sure(walked.routes.length === 1 && walked.routes[0].number === null && walked.routes[0].far > 1000, JSON.stringify(walked.routes.map(({ points, ...rest }) => rest))); // prettier-ignore
  const missed = maps.reachOf(arena(), { to: [[1200, 256, 36]] });
  sure(!missed.routes.length && missed.warnings.some((line) => /the point 1200 256 36 is not reached.*walked floor comes within/.test(line)), missed.warnings.join(" | ")); // prettier-ignore
  const sees = maps.sightTest(arena());
  sure(!sees([64, 256, 64], [2336, 256, 64]) && sees([64, 256, 64], [900, 256, 64]), "the sight test, exported");
});

test("the kit's profiles by name, and the Half-Life folder found (SMAK_HALF_LIFE, or none)", () => {
  sure(maps.mapProfileOf("TS").folder === "ts" && /specialists\.mjs$/.test(maps.mapProfileOf("ts").file), "ts");
  sure(maps.mapProfileOf("msc").folder === "msc" && maps.mapProfileOf("quake") === null, "msc; a name that is none");
  const game = join(folder, "Half-Life");
  mkdirSync(join(game, "valve"), { recursive: true });
  mkdirSync(join(game, "ts", "maps"), { recursive: true });
  sure(maps.findHalfLife({ mod: "ts", env: { SMAK_HALF_LIFE: game } }) === game, "told");
  sure(maps.findHalfLife({ mod: "msc", env: { SMAK_HALF_LIFE: game } }) === null, "told, with no such mod there");
  sure(maps.findHalfLife({ env: { SMAK_HALF_LIFE: "none" } }) === null, "none: no game looked for");
  sure(Array.isArray(maps.steamLibraries({ env: {} })), "the libraries, a list");
});

test("The Specialists' profile: its compact arenas by kind, its teams and its own dressing", () => {
  const game = join(folder, "Half-Life");
  const compact = specialists({ game, kind: "compact" });
  sure(compact.character.figures === COMPACT.figures && compact.character.from === COMPACT.from, "compact");
  sure(compact.teams === TEAMS && compact.dressing === DRESSING, "teams and dressing");
  sure(TEAMS.cross.warn === 1400 && TEAMS.balance.warn === 10 && TEAMS.classes[0] === "info_player_deathmatch", "the rules");
  sure(DRESSING.measures.darkFloor.median < 0.15 && DRESSING.measures.contrast.median < 5, "the game's own light, brighter and flatter than Valve's"); // prettier-ignore
  let refused = "";
  try {
    specialists({ game, kind: "duel" });
  } catch (error) {
    refused = error.message;
  }
  sure(/"arena", "compact" or "roleplay"/.test(refused), refused);
});

test("the dressing held to a mod's own bands (Valve's where it has none), the bands learned from maps", () => {
  const bsp = maps.readBsp(readFileSync(join(FIXTURES, "tworooms.bsp")));
  const list = Array.from({ length: 20 }, (_, i) => ({ name: `m${i}`, measures: { darkFloor: (i + 1) / 100, contrast: i + 1, lampFaces: null } })); // prettier-ignore
  const learned = maps.learnDressing(list, { name: "The game's", of: "the game's 20 maps" });
  sure(JSON.stringify(learned.measures.contrast) === JSON.stringify({ least: 2, q1: 6, median: 11, q3: 16, most: 20 }), JSON.stringify(learned.measures.contrast)); // prettier-ignore
  sure(!learned.measures.lampFaces && learned.maps.length === 20, "a measure no map has is left out");
  const held = maps.dressingOf(bsp, { against: { ...learned, measures: { ...learned.measures, oneTextureWalls: { least: 0, q1: 0, median: 0.1, q3: 0.2, most: 0.3 } } } }); // prettier-ignore
  sure(held.facts.some((line) => /floor light's contrast .*\(The game's: 2 to 20, median 11\)/.test(line)), held.facts.join(" | ")); // prettier-ignore
  sure(held.facts.some((line) => /faces at texture scale 1: .*\(Valve's:/.test(line)), "Valve's for a measure the bands lack");
  sure(held.warnings.some((line) => /tall walls of one texture only.*over the 95th in 100 of the game's 20 maps/.test(line)), held.warnings.join(" | ")); // prettier-ignore
  sure(held.rows.find((row) => row.key === "contrast").by === "The game's", "each row says whose");
  // from the command line: a folder learned, and held to
  const maps2 = join(folder, "maps");
  mkdirSync(maps2, { recursive: true });
  writeFileSync(join(maps2, "a.bsp"), readFileSync(join(FIXTURES, "tworooms.bsp")));
  writeFileSync(join(maps2, "b.bsp"), readFileSync(join(FIXTURES, "tworooms.bsp")));
  const bands = join(folder, "bands.json");
  const said = runSmak("map-dressing", maps2, "--learn", "-o", bands, "--as", "Mine");
  sure(/the dressing of 2 maps/.test(said) && JSON.parse(readFileSync(bands, "utf8")).name === "Mine", said);
  const against = runSmak("map-dressing", join(FIXTURES, "tworooms.bsp"), "--against", bands);
  sure(/\(Mine: /.test(against), against);
});

test("lamp faces counted beside the light entities: a map lit by its texture lights is no unlit map", () => {
  const bsp = maps.readBsp(readFileSync(join(FIXTURES, "tworooms.bsp")));
  const plain = maps.characterOf(bsp);
  sure(plain.figures.lampFaces === 0 && /lights and 0 lamp faces/.test(plain.facts[2]), plain.facts[2]);
  const lit = maps.characterOf({ ...bsp, entities: [...bsp.entities, [["classname", "info_texlights"], ["smakfloor", "255 255 255 100"]]] }); // prettier-ignore
  sure(lit.figures.lampFaces > 0, `the floor's faces a lamp: ${lit.figures.lampFaces}`);
  const learned = maps.learnCharacter([{ name: "a", figures: lit.figures }]);
  sure(Array.isArray(learned.figures.lampFaces), "learned too");
});
