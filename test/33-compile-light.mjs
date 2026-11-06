// A compile that is seen to work and can be stopped, and the light of a compiled map's floors.
//   the runner that hands a compiler's output on while it works, keeps it, and stops it at a time
//   what a compile says of itself: each program's seconds, "stopped", the portals hlbsp left hlvis, a draft
//   `smak map-compile --timeout`; and, where the compilers are, a compile with progress, a timeout, a draft
//   `lightReport`: the floor's light from the lightmaps, room by room and as dark stretches; `smak map-light`
//
// The compilers (VHLT) are an outside program: the cases that need them are skipped without them, as in
// 21-maps-make.mjs. The map with light is the fixture's two rooms, whose third room no lamp reaches.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, openSync, closeSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../src/maps/index.mjs";
import { test, sure, near, HERE, tmp, runSmak, runRefused, SMAK_CLI } from "./helper.mjs";

const FIXTURES = join(HERE, "fixtures");
const folder = join(tmp, "compile-light");
mkdirSync(folder, { recursive: true });
const RUNNER = join(HERE, "../src/maps/compile-run.mjs");
const node = process.execPath;
/** the runner with a program that is node itself, running a line of script */
const ran = (limit, script) => {
  const kept = join(folder, `kept-${limit}.txt`);
  const run = spawnSync(node, [RUNNER, String(limit), kept, node, "-e", script], { encoding: "utf8" });
  return { code: run.status, live: run.stderr, kept: existsSync(kept) ? readFileSync(kept, "utf8") : null };
};

test("the compile's runner hands on what a program prints, keeps it, and stops it at its time", () => {
  const well = ran(20000, 'console.log("to its output"); console.error("and to its errors"); process.exitCode = 3');
  sure(well.code === 3, `the program's own code: ${well.code}`);
  for (const line of ["to its output", "and to its errors"])
    sure(well.live.includes(line) && well.kept.includes(line), `"${line}" handed on and kept: ${well.live} / ${well.kept}`); // prettier-ignore
  // one that would run for a minute is stopped after half a second, and said to be
  const began = Date.now();
  const slow = ran(500, 'console.log("begun"); setTimeout(() => {}, 60000)');
  sure(slow.code === 124 && Date.now() - began < 20000, `stopped: code ${slow.code} after ${Date.now() - began} ms`);
  sure(slow.kept.includes("begun"), "what it printed before is kept");
  // a program that is not there
  const kept = join(folder, "kept-none.txt");
  const none = spawnSync(node, [RUNNER, "1000", kept, join(folder, "no-such-program")], { encoding: "utf8" });
  sure(none.status === 126, `not started: code ${none.status}`);
});

test("what a compile says of itself: seconds, a program that was stopped, the portals, a draft", () => {
  const summary = maps.compileSummary({
    bsp: null,
    logs: [
      { tool: "hlcsg", seconds: 0.21, code: 0 },
      { tool: "hlbsp", seconds: 1.04, code: 0 },
      { tool: "hlvis", seconds: 480.02, code: null },
    ],
    portals: { leaves: 1395, portals: 5088, seconds: 219 },
    facts: ["a draft (fast): hlrad bounced no light"],
    errors: ["hlvis did not finish in 480 seconds and was STOPPED"],
    warnings: [],
  });
  const lines = summary.split("\n");
  sure(lines[0] === "hlcsg  0.2 s  ended" && lines[2] === "hlvis  480.0 s  stopped", lines.slice(0, 3).join(" | "));
  sure(lines[3] === "portals: 5088 between 1395 leaves (hlvis's work: a full one is guessed at about 219 s, from one map measured)", lines[3]);
  sure(lines[4] === "a draft (fast): hlrad bounced no light" && /^error: hlvis did not finish/.test(lines[5]), lines[4]);
  sure(lines.at(-1) === "not compiled", lines.at(-1));
  // an older result, with neither portals nor facts, is still summed up
  sure(/^hlcsg {2}0\.2 s {2}ended\ncompiled: x\.bsp$/.test(maps.compileSummary({ bsp: "x.bsp", logs: [{ tool: "hlcsg", seconds: 0.2, code: 0 }], errors: [], warnings: [] })), "as it was"); // prettier-ignore
});

test("compileMap's engine: -engine before the rest for SDHLT's goldsrc fork, nothing unless told, anything else refused", () => {
  const mapFile = join(folder, "engine.map");
  writeFileSync(mapFile, readFileSync(join(FIXTURES, "tworooms.map")));
  // node stands in for the four programs: it refuses "-engine" as an option of its own, and the run shows what it was given
  const tools = Object.fromEntries(maps.COMPILERS.map((tool) => [tool, node]));
  const compilers = { found: true, tools, folder };
  const xash = maps.compileMap(mapFile, { compilers, engine: "xash", threads: 2, out: join(folder, "engine.bsp") });
  const first = xash.logs[0];
  sure(first?.tool === "hlcsg" && first.args.slice(0, 4).join(" ") === "-engine xash -threads 2", `hlcsg was given: ${first?.args.join(" ")}`); // prettier-ignore
  sure(xash.bsp === null && xash.errors.length > 0, "the stand-in failed, and so did the compile");
  const plain = maps.compileMap(mapFile, { compilers, threads: 2, out: join(folder, "engine.bsp") });
  sure(!plain.logs[0].args.includes("-engine"), `no engine, no switch: ${plain.logs[0].args.join(" ")}`);
  const wrong = maps.compileMap(mapFile, { compilers, engine: "source" });
  sure(!wrong.logs.length && /engine is goldsrc or xash, not source/.test(wrong.errors.join(" ")), wrong.errors.join(" ")); // prettier-ignore
  sure(maps.ENGINES.join(",") === "goldsrc,xash", maps.ENGINES.join(","));
});

test("compileMap's format: -format after -engine for every program; Xash's layouts refused without engine xash", () => {
  const mapFile = join(folder, "format.map");
  writeFileSync(mapFile, readFileSync(join(FIXTURES, "tworooms.map")));
  const tools = Object.fromEntries(maps.COMPILERS.map((tool) => [tool, node]));
  const compilers = { found: true, tools, folder };
  const bsp2 = maps.compileMap(mapFile, { compilers, engine: "xash", format: "bsp2", threads: 2, out: join(folder, "format.bsp") });
  sure(bsp2.logs[0]?.args.slice(0, 6).join(" ") === "-engine xash -format bsp2 -threads 2", `hlcsg was given: ${bsp2.logs[0]?.args.join(" ")}`); // prettier-ignore
  const alone = maps.compileMap(mapFile, { compilers, format: "bsp2" });
  sure(!alone.logs.length && /format bsp2 is read by Xash alone; it wants engine "xash"/.test(alone.errors.join(" ")), alone.errors.join(" ")); // prettier-ignore
  const wrong = maps.compileMap(mapFile, { compilers, engine: "xash", format: "bsp29" });
  sure(!wrong.logs.length && /format is bsp30, bsp30ext, bsp2, not bsp29/.test(wrong.errors.join(" ")), wrong.errors.join(" ")); // prettier-ignore
  sure(maps.BSP_FORMATS.join(",") === "bsp30,bsp30ext,bsp2", maps.BSP_FORMATS.join(","));
});

test("smak map-compile --timeout: seconds for all, or by program; anything else is refused in words", () => {
  const mapFile = join(folder, "any.map");
  writeFileSync(mapFile, readFileSync(join(FIXTURES, "tworooms.map")));
  for (const wrong of ["soon", "hlvis=ten", "hlfoo=10"]) {
    const refused = runRefused(SMAK_CLI, "map-compile", mapFile, "-o", join(folder, "any.bsp"), "--timeout", wrong);
    sure(refused.code === 1 && /--timeout is seconds \("600"\), or seconds by program/.test(refused.err), `${wrong}: ${refused.err}`); // prettier-ignore
  }
  const bare = runRefused(SMAK_CLI, "map-compile", mapFile, "-o", join(folder, "any.bsp"), "--timeout");
  sure(bare.code === 1 && /--timeout needs a value/.test(bare.err), bare.err);
});

const compilers = process.env[maps.COMPILERS_VARIABLE] ? maps.findCompilers() : { found: false };
const testCompiled = (name, run) => {
  if (compilers.found) test(name, run);
  else
    console.log(
      `skip  ${name}\n      skipped: no compilers (name the folder of VHLT in ${maps.COMPILERS_VARIABLE} to run it)`,
    );
};

testCompiled("compiled: progress is handed on as it comes, the portals are counted, a draft says what it is", () => {
  const mapFile = join(folder, "rooms.map");
  writeFileSync(mapFile, readFileSync(join(FIXTURES, "tworooms.map")));
  const wad = join(FIXTURES, "tworooms.wad");
  const seen = join(folder, "progress.txt");
  const fd = openSync(seen, "w");
  let result;
  try {
    result = maps.compileMap(mapFile, { wads: [wad], compilers, progress: fd, timeout: 120_000 });
  } finally {
    closeSync(fd);
  }
  sure(!result.errors.length && existsSync(result.bsp), result.errors.join("; "));
  const live = readFileSync(seen, "latin1");
  for (const tool of maps.COMPILERS) sure(new RegExp(`${tool}`, "i").test(live), `${tool} was not seen working`);
  sure(result.logs.every((log) => log.text.length > 100 && log.code === 0), "and its logs are kept as before");
  sure(Number.isInteger(result.portals?.portals) && result.portals.leaves > 0, `portals: ${JSON.stringify(result.portals)}`); // prettier-ignore
  sure(/^portals: \d+ between \d+ leaves/m.test(maps.compileSummary(result)) && !result.facts.length, "the summary");
  // the same without progress gives the same count
  const quiet = maps.compileMap(mapFile, { wads: [wad], compilers, timeout: 120_000, out: join(folder, "quiet.bsp") });
  sure(quiet.portals?.leaves === result.portals.leaves, "portals without progress");
  // a draft
  const draft = maps.compileMap(mapFile, { wads: [wad], compilers, fast: true, out: join(folder, "draft.bsp") });
  sure(draft.bsp && /a draft \(fast\): hlrad bounced no light/.test(draft.facts.join()), draft.facts.join());
  sure(/-fast/.test(draft.logs[3].args.join(" ")) && /bounces\s+\[\s+0 \]/.test(draft.logs[3].text), "hlrad's own word: no bounces");
});

testCompiled("compiled: a program that runs past its time is stopped, said to be, and no .bsp is written", () => {
  const mapFile = join(folder, "rooms.map");
  const out = join(folder, "never.bsp");
  for (const progress of [false, true]) {
    const result = maps.compileMap(mapFile, {
      wads: [join(FIXTURES, "tworooms.wad")],
      compilers,
      out,
      timeout: { hlcsg: 1 },
      // handed on to nowhere: the case is of the stopping
      progress: progress ? "ignore" : false,
    });
    sure(result.bsp === null && !existsSync(out), "a .bsp was written");
    sure(/^hlcsg did not finish in 0 seconds and was STOPPED: nothing was written where the \.bsp goes/.test(result.errors[0]), result.errors.join("; ")); // prettier-ignore
    sure(result.logs.length === 1 && /hlcsg {2}[\d.]+ s {2}stopped/.test(maps.compileSummary(result)), maps.compileSummary(result));
  }
});

// ── light ──
const tworooms = maps.readBsp(readFileSync(join(FIXTURES, "tworooms.bsp")));
const ROOMS = { first: { min: [0, 0, 0], max: [320, 208, 128] }, behind: { min: [0, 240, 0], max: [128, 448, 128] } };

test("lightReport: the light on a map's floors from its lightmaps, by room and as dark stretches", () => {
  const report = maps.lightReport(tworooms);
  sure(report.lit, "the fixture has light");
  // the floor is 320 by 448: every sample stands for the floor about it, a little over at the edges
  near(report.floor.area, 320 * 448, 320 * 448 * 0.06, "the floor's area");
  sure(report.floor.mean > 80 && report.floor.mean < 160 && report.floor.most <= 255, JSON.stringify(report.floor));
  sure(/^the light on the floor: [\d.]+ of 255 on average over \d+ square units/.test(report.facts[0]), report.facts[0]);
  // the room behind the grate has no lamp: one dark stretch, there
  sure(report.patches.length === 1, `patches: ${JSON.stringify(report.patches)}`);
  const [patch] = report.patches;
  sure(patch.mean < maps.DARK_FLOOR && patch.at[0] < 128 && patch.at[1] > 240 && patch.area > 15000, JSON.stringify(patch)); // prettier-ignore
  sure(/^1 stretches of floor are dark/.test(report.warnings[0]), report.warnings.join(" | "));
  // by room
  const byRoom = maps.lightReport(tworooms, { rooms: ROOMS });
  const room = Object.fromEntries(byRoom.rooms.map((each) => [each.name, each]));
  sure(room.first.mean > 100 && !room.first.dark, `the lit room: ${JSON.stringify(room.first)}`);
  sure(room.behind.dark && room.behind.mean < maps.DARK_FLOOR && room.behind.darkShare > 0.9, `the dark one: ${JSON.stringify(room.behind)}`); // prettier-ignore
  sure(room.elsewhere?.area > 0 && !byRoom.patches.length, "what is in neither is elsewhere");
  sure(/^1 rooms are dark on the floor \(a mean under 24 of 255\): behind /.test(byRoom.warnings.join("|")), byRoom.warnings.join(" | ")); // prettier-ignore
  sure(/by room, the floor's mean: first [\d.]+; behind [\d.]+ \(\d+ in 100 under 24\)/.test(byRoom.facts.join("|")), byRoom.facts.join(" | ")); // prettier-ignore
  // a room inside another's box (a house in its yard) takes its own floor, whichever is named first
  const nested = maps.lightReport(tworooms, { rooms: { all: { min: [-64, -64, -64], max: [512, 512, 256] }, ...ROOMS } });
  const inner = Object.fromEntries(nested.rooms.map((each) => [each.name, each]));
  sure(inner.first.area === room.first.area && inner.behind.area === room.behind.area, `the inner rooms keep their floors: ${JSON.stringify(nested.rooms)}`);
  // only the floor that is walked: the room behind the grate is not, and nothing is dark
  const walked = maps.lightReport(tworooms, { reach: maps.reachOf(tworooms) });
  sure(walked.floor.area < report.floor.area * 0.7 && walked.patches.length === 0, `walked: ${JSON.stringify(walked.floor)}`); // prettier-ignore
  sure(/the floor a player walks/.test(walked.facts[0]) && /no stretch of floor/.test(walked.facts[1]), walked.facts.join(" | "));
  // a higher line makes more of it dark; a map with no light data says so
  sure(maps.lightReport(tworooms, { dark: 250 }).patches[0].area > report.floor.area * 0.9, "dark: 250");
  const unlit = maps.lightReport({ ...tworooms, lumps: { ...tworooms.lumps, lighting: { ...tworooms.lumps.lighting, length: 0 } } }); // prettier-ignore
  sure(!unlit.lit && /no light data/.test(unlit.facts[0]) && !unlit.warnings.length, unlit.facts.join());
  // three rooms, one with half the light of the middling: dim beside the rest
  const dim = maps.lightReport(tworooms, {
    rooms: { a: { min: [0, 0, 0], max: [160, 208, 128] }, b: { min: [160, 0, 0], max: [320, 208, 128] }, c: { min: [200, 240, 0], max: [320, 448, 128] }, behind: ROOMS.behind }, // prettier-ignore
    dark: 1,
  });
  sure(dim.rooms.find((each) => each.name === "behind").dim && /^1 rooms are dim beside the rest/.test(dim.warnings.join("|")), `${JSON.stringify(dim.rooms)} ${dim.warnings.join(" | ")}`); // prettier-ignore
});

test("smak map-light prints it, by room with --rooms, and as JSON", () => {
  const said = runSmak("map-light", join(FIXTURES, "tworooms.bsp"));
  sure(/the light on the floor: [\d.]+ of 255/.test(said) && /^WARN {2}1 stretches of floor are dark/m.test(said), said);
  const roomsFile = join(folder, "rooms.json");
  writeFileSync(roomsFile, JSON.stringify(ROOMS));
  const byRoom = runSmak("map-light", join(FIXTURES, "tworooms.bsp"), "--rooms", roomsFile);
  sure(/^WARN {2}1 rooms are dark on the floor/m.test(byRoom), byRoom);
  const json = JSON.parse(runSmak("map-light", join(FIXTURES, "tworooms.bsp"), "--rooms", roomsFile, "--json"));
  sure(json.rooms.length === 3 && json.lit === true, "as JSON");
  sure(/no stretch of floor/.test(runSmak("map-light", join(FIXTURES, "tworooms.bsp"), "--walked")), "--walked");
  const wrong = runRefused(SMAK_CLI, "map-light", join(FIXTURES, "tworooms.bsp"), "--dark", "0");
  sure(wrong.code === 1 && /--dark is a brightness/.test(wrong.err), wrong.err);
});
