#!/usr/bin/env node
// Level-design measures of an installed GoldSrc game's own maps, banded per game: the corpus Phase 3's
// level checks are held against (PLAN.md, "Phase 3").
//
//   node levels/tools/survey-goldsrc.mjs --game hl|ts|msr|tsrp [--root <folder>] [--jobs 4] [--most 120]
//                                        [--only name,name] [--out levels/corpus/levels-<game>.json]
//                                        [--timeout 240] [--merge] [--city]
//
// `--city` adds each map's role-play city measures (levels/lib/city-measures.mjs: streets and plazas,
// buildings behind doors, vertical layers and their connectors, repetition and districts, light, role-play
// furniture) as its record's `city`, and their bands as `city*`; the tsrp game (The Specialists' role-play
// cities, community maps fetched to ts_downloads) always has them. levels/notes-rp-city.md says what each is.
//
// MEASURES AND BANDS ONLY. The maps are read where the game has them and nothing of them is written: no
// geometry, no entities, no textures, no map file. The corpus holds each map's name and numbers, and the
// bands of those numbers per game (n, median, q1, q3, p5, p95; a map, a vote).
//
// Each map is measured in a child process (levels/lib/goldsrc-level-measures.mjs: the kit's readBsp,
// reachOf and measure, and what is added from the walk's graph), `--jobs` at once. A game with more maps
// than `--most` is sampled evenly by name, and the corpus says so. `--merge` re-measures the maps asked
// (`--only`) into the corpus already written and bands it all again: for maps that failed or timed out. levels/notes-goldsrc.md says what each
// measure is.
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  measureLevel,
  bandOf,
  inLengths,
  inAreas,
  UNIT_M,
  PLAYER_HEIGHT,
  NARROW,
} from "../lib/goldsrc-level-measures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(HERE, "../..");
/** A map that takes longer than this (seconds, unless `--timeout`) is given up. */
const PER_MAP_S = 240;

// ── the games ───────────────────────────────────────────────────────────────
/**
 * Each game: where it is installed (unless --root), the folders of maps it is read from, each a group of
 * the corpus, and the classes that are a way out besides trigger_changelevel. `skip`: maps that are no
 * part of the game as played (old copies kept beside the new, test maps).
 */
const GAMES = {
  hl: {
    title: "Half-Life (Steam), with the mods installed beside it",
    root: "C:/Juegos/Steam/steamapps/common/Half-Life",
    groups: [
      { name: "valve_sp", folder: "valve/maps", pick: (n) => /^(c\d|t0)a/.test(n), about: "Half-Life's single-player campaign and training" },
      { name: "valve_dm", folder: "valve/maps", pick: (n) => !/^(c\d|t0)a/.test(n), about: "Half-Life's deathmatch maps" },
      { name: "cstrike", folder: "cstrike/maps", about: "Counter-Strike 1.6's own maps" },
      { name: "msc", folder: "msc/maps", about: "Master Sword Classic (the predecessor of Master Sword Rebirth)", exits: ["msarea_transition"] },
    ],
    headline: ["valve_sp", "valve_dm"],
    notRead: [
      "msr/ and ts/ under Half-Life: the same games are surveyed from their own installs (--game msr, --game ts)",
      "czero_downloads/, ts_downloads/: maps downloaded from servers, not the games' own",
      "czero/: Condition Zero ships no loose maps here",
    ],
    skip: (n) => /_old$|^test/i.test(n),
  },
  ts: {
    title: "The Specialists 3.0",
    root: "C:/Juegos/TS30-clean",
    groups: [{ name: "ts", folder: "maps", about: "The Specialists' own maps" }],
    headline: ["ts"],
    notRead: [],
    skip: (n) => /_old$|^test/i.test(n),
  },
  tsrp: {
    title: "The Specialists role-play cities (community maps, as fetched from servers)",
    root: "C:/Juegos/Steam/steamapps/common/Half-Life/ts_downloads",
    groups: [
      {
        name: "tsrp",
        folder: "maps",
        pick: (n) => /^(tsrp_|rp_)|_rp_|_rp$|city|alexandria/i.test(n),
        about: "The Specialists' role-play cities: maps named as cities or role-play (tsrp_, rp_, *city*)",
      },
    ],
    headline: ["tsrp"],
    city: true,
    notRead: [],
    // New Byzantium is the city being redesigned (measured apart, never banded); the hive is three cities merged
    skip: (n) => /_old$|^test|newbyzantium|_hive$/i.test(n),
  },
  msr: {
    title: "Master Sword Rebirth",
    root: "C:/Juegos/MSR/msr",
    groups: [{ name: "msr", folder: "maps", about: "Master Sword Rebirth's own maps", exits: ["msarea_transition"] }],
    headline: ["msr"],
    notRead: [],
    skip: (n) => /_old$|^test|^old_/i.test(n),
  },
};

// ── the arguments ───────────────────────────────────────────────────────────
function argsOf(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i];
    if (!word.startsWith("--")) continue;
    const key = word.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else (out[key] = next), i++;
  }
  return out;
}

// ── a child: one map ────────────────────────────────────────────────────────
async function child() {
  process.on("disconnect", () => process.exit(0));
  process.on("message", ({ file, name, exits, city }) => {
    try {
      const t = Date.now();
      const record = measureLevel(readFileSync(file), { name, exits, city });
      record.times.total = Date.now() - t;
      process.send({ ok: true, record });
    } catch (error) {
      process.send({ ok: false, why: String(error?.message ?? error).split("\n")[0].slice(0, 300) });
    }
  });
}

// ── pak files: a map inside one is listed, not read (none was found in these games) ──
function paksWithMaps(folder) {
  const found = [];
  if (!existsSync(folder)) return found;
  for (const file of readdirSync(folder)) {
    if (!/\.pak$/i.test(file)) continue;
    try {
      const bytes = readFileSync(join(folder, file));
      if (bytes.toString("latin1", 0, 4) !== "PACK") continue;
      const at = bytes.readInt32LE(4);
      const size = bytes.readInt32LE(8);
      for (let entry = at; entry < at + size; entry += 64) {
        const name = bytes.toString("latin1", entry, entry + 56).replace(/\0.*$/s, "");
        if (/^maps\/[^/]+\.bsp$/i.test(name)) found.push(`${file}:${name}`);
      }
    } catch {
      // not a pak this reads
    }
  }
  return found;
}

// ── the parent ──────────────────────────────────────────────────────────────
async function main() {
  const args = argsOf(process.argv.slice(2));
  const game = GAMES[args.game];
  if (!game) {
    console.error("usage: survey-goldsrc.mjs --game hl|ts|msr|tsrp [--root <folder>] [--jobs 4] [--most 120] [--only a,b] [--out file] [--city]");
    process.exit(2);
  }
  const root = args.root ?? game.root;
  const jobs = Math.max(1, Number(args.jobs ?? 4));
  const most = Math.max(1, Number(args.most ?? 120));
  const only = args.only ? new Set(String(args.only).split(",")) : null;
  const out = args.out ?? join(KIT, "levels/corpus", `levels-${args.game}.json`);
  const started = Date.now();
  const perMapMs = 1000 * Number(args.timeout ?? PER_MAP_S);
  const city = Boolean(args.city || game.city);
  // the places' values (widths, sights, headrooms: numbers only) are kept outside the repository, for
  // `--merge`, which re-measures some maps into a corpus already made and bands it all again
  const poolFile = join(tmpdir(), `smak-levels-pool-${args.game}.json`);

  // the maps
  const work = [];
  const skipped = [];
  const paks = [];
  for (const group of game.groups) {
    const folder = join(root, group.folder);
    paks.push(...paksWithMaps(dirname(folder)));
    if (!existsSync(folder)) {
      skipped.push({ group: group.name, why: `no folder ${group.folder}` });
      continue;
    }
    for (const file of readdirSync(folder).filter((f) => /\.bsp$/i.test(f)).sort()) {
      const name = basename(file, ".bsp").replace(/\.bsp$/i, "");
      if (group.pick && !group.pick(name)) continue;
      if (only && !only.has(name)) continue;
      if (game.skip(name)) {
        skipped.push({ map: name, group: group.name, why: "an old copy or a test map" });
        continue;
      }
      work.push({ group: group.name, name, file: join(folder, file), exits: group.exits ?? [], bytes: statSync(join(folder, file)).size });
    }
  }
  // sampled evenly by name within each group when there are too many
  let sampled = false;
  const byGroup = new Map();
  for (const item of work) (byGroup.get(item.group) ?? byGroup.set(item.group, []).get(item.group)).push(item);
  const chosen = [];
  for (const [, list] of byGroup) {
    if (list.length <= most) chosen.push(...list);
    else {
      sampled = true;
      for (let k = 0; k < most; k++) chosen.push(list[Math.floor((k * list.length) / most)]);
    }
  }
  // the largest first, so the pool ends together
  chosen.sort((a, b) => b.bytes - a.bytes);
  console.log(`${args.game}: ${chosen.length} maps to measure (${work.length} found${sampled ? `, sampled to ${most} a group` : ""}), ${jobs} at once`);

  // the pool
  const records = [];
  const failed = [];
  let next = 0;
  await new Promise((done) => {
    let running = 0;
    const startOne = () => {
      if (next >= chosen.length) {
        if (!running) done();
        return;
      }
      const item = chosen[next++];
      running++;
      const worker = fork(fileURLToPath(import.meta.url), ["--child"], { execArgv: ["--max-old-space-size=4096"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
      let stderr = "";
      worker.stderr.on("data", (d) => (stderr += d));
      let finished = false;
      const finish = (message) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        worker.kill();
        running--;
        if (message?.ok) {
          records.push({ group: item.group, ...message.record });
          const r = message.record;
          console.log(`  ${item.group}/${item.name}: ${(r.times.total / 1000).toFixed(1)} s, width ${r.width.median}, headroom ${r.headroom?.median ?? "-"}, crossing ${r.crossing.walk} (${r.crossing.to})`);
        } else {
          failed.push({ map: item.name, group: item.group, why: message?.why ?? "the child ended without an answer" });
          console.log(`  ${item.group}/${item.name}: FAILED ${message?.why ?? ""}`);
        }
        startOne();
      };
      const timer = setTimeout(() => finish({ ok: false, why: `took over ${perMapMs / 1000} s` }), perMapMs);
      worker.on("message", finish);
      worker.on("exit", (code) => finish({ ok: false, why: `the child ended (${code}): ${stderr.trim().split("\n").pop() ?? ""}`.slice(0, 300) }));
      worker.send({ file: item.file, name: item.name, exits: item.exits, city });
    };
    for (let k = 0; k < jobs; k++) startOne();
  });
  let earlierSeconds = 0;
  let found = work.length;
  if (args.merge && existsSync(out)) {
    const before = JSON.parse(readFileSync(out, "utf8"));
    const pools = existsSync(poolFile) ? JSON.parse(readFileSync(poolFile, "utf8")) : {};
    const redone = new Set(chosen.map((item) => `${item.group}/${item.name}`));
    for (const record of before.maps ?? [])
      if (!redone.has(`${record.group}/${record.name}`)) records.push({ ...record, _pool: pools[`${record.group}/${record.name}`] });
    for (const fault of before.failed ?? []) if (!redone.has(`${fault.group}/${fault.map}`)) failed.push(fault);
    skipped.push(...(before.skipped ?? []).filter((s) => !skipped.some((t) => t.map === s.map && t.group === s.group)));
    earlierSeconds = before.runSeconds ?? 0;
    found = before.counts?.found ?? found;
  }
  records.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  writeFileSync(poolFile, JSON.stringify(Object.fromEntries(records.map((r) => [`${r.group}/${r.name}`, r._pool ?? null]))));

  // ── the bands ──
  const groups = {};
  for (const group of game.groups) {
    const list = records.filter((r) => r.group === group.name);
    if (list.length) groups[group.name] = { about: group.about, maps: list.length, bands: bandsOf(list) };
  }
  const headlineList = records.filter((r) => game.headline.includes(r.group));
  const seconds = earlierSeconds + Math.round((Date.now() - started) / 1000);
  const corpus = {
    game: args.game,
    title: game.title,
    made: new Date().toISOString().slice(0, 10),
    tool: "levels/tools/survey-goldsrc.mjs (levels/lib/goldsrc-level-measures.mjs)",
    what: "Measures and bands only: no geometry, entity, texture or map file of the game is in this file.",
    units: {
      length: `units (Hammer units); m = units x ${UNIT_M}; ph = units / ${PLAYER_HEIGHT} (a standing player's height)`,
      area: "m2 (square units x 0.00064516)",
      narrow: `floor under ${NARROW} units wide (two player heights) is narrow`,
    },
    banding:
      "Each band is n, median, q1, q3, p5, p95 across maps, a map one vote: `of maps` bands each map's own median (or value); `pooled` bands every measured place of every map, each map's places weighing 1 in all.",
    headline: game.headline,
    counts: { found, measured: records.length, failed: failed.length, skipped: skipped.length, sampled, most },
    runSeconds: seconds,
    jobs,
    pakMaps: paks,
    notRead: game.notRead,
    bands: headlineList.length ? bandsOf(headlineList) : null,
    groups,
    maps: records.map(({ _pool, ...record }) => record),
    failed,
    skipped,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(corpus, null, 1) + "\n");
  console.log(`${out}: ${records.length} maps measured, ${failed.length} failed, ${skipped.length} skipped, ${seconds} s`);
}

/** The bands of a list of map records. */
function bandsOf(list) {
  const of = (get) => list.map(get);
  const pooled = (key) => {
    const values = [];
    const weights = [];
    for (const r of list) {
      const own = r._pool?.[key] ?? [];
      const finite = own.filter((v) => v !== null && Number.isFinite(v));
      for (const v of finite) values.push(v), weights.push(1 / finite.length);
    }
    return inLengths(bandOf(values, weights));
  };
  const share = (get) => bandOf(of(get), null, 3);
  const plain = (get, places = 0) => bandOf(of(get), null, places);
  return {
    width: { ofMaps: inLengths(plain((r) => r.width.median)), pooled: pooled("widths") },
    sight: { ofMaps: inLengths(plain((r) => r.sight.median)), pooled: pooled("sights") },
    headroom: { ofMaps: inLengths(plain((r) => r.headroom?.median)), pooled: pooled("heads") },
    headroomNarrow: inLengths(plain((r) => r.headroomNarrow.median)),
    headroomOpen: inLengths(plain((r) => r.headroomOpen.median)),
    openSkyShare: share((r) => r.openSky),
    skyHeight: inLengths(plain((r) => r.skyHeight?.median)),
    area: inAreas(plain((r) => r.area)),
    narrowShare: share((r) => r.narrowShare),
    kitNarrowShare: share((r) => r.kitNarrowShare),
    wideShare: share((r) => r.wideShare),
    sightBeyond700Share: share((r) => r.sightBeyond700),
    stepRise: inLengths(plain((r) => r.steps.rise?.median, 1)),
    stepRiseCommon: inLengths(plain((r) => r.steps.commonRise, 1)),
    stairFlights: plain((r) => r.steps.flights),
    stairFlightRise: inLengths(plain((r) => r.steps.flightRise?.median)),
    floorLevels: plain((r) => r.vertical.levels),
    floorRange: inLengths(plain((r) => r.vertical.range)),
    floorRange90: inLengths(plain((r) => r.vertical.range90)),
    storeys: plain((r) => r.vertical.stacked),
    doorOpenings: plain((r) => r.doors.openings),
    doorWidth: inLengths(plain((r) => r.doors.width?.median)),
    doorHeight: inLengths(plain((r) => r.doors.height?.median)),
    passageWidth: inLengths(plain((r) => r.passages.width?.median)),
    crossing: inLengths(plain((r) => r.crossing.walk)),
    crossingExitToExit: inLengths(plain((r) => (r.crossing.to === "exit-to-exit" ? r.crossing.walk : null))),
    crossingFromExit: inLengths(plain((r) => (r.crossing.to !== "farthest" ? r.crossing.walk : null))),
    crossingStraight: inLengths(plain((r) => r.crossing.straight)),
    crossingRatio: plain((r) => r.crossing.ratio, 2),
    span: inLengths(plain((r) => r.span?.walk)),
    spanRatio: plain((r) => r.span?.ratio, 2),
    loops256: plain((r) => r.loops.tile256.cycles),
    loops512: plain((r) => r.loops.tile512.cycles),
    mapsWithLoop512: { n: list.length, share: Math.round((list.filter((r) => r.loops.tile512.cycles > 0).length / list.length) * 1000) / 1000 },
    mapsReachingExit: { n: list.length, share: Math.round((list.filter((r) => r.crossing.to !== "farthest").length / list.length) * 1000) / 1000 },
    reachedShare: share((r) => r.reachedShare),
    ...(list.some((r) => r.city) ? cityBandsOf(list) : {}),
  };
}

/** The bands of the role-play city measures (each map's `city`), in metres, m2, shares and counts. */
function cityBandsOf(list) {
  const plain = (get, places = 0) => bandOf(list.map((r) => (r.city ? get(r.city) : null)), null, places);
  return {
    cityStreetWidth: plain((c) => c.streets.width?.median, 2),
    cityStreetVehicleShare: plain((c) => c.streets.vehicleShare, 3),
    cityStreetM2: plain((c) => c.streets.areaM2),
    cityPlazas: plain((c) => c.streets.plazas),
    cityPublicWidth: plain((c) => c.publicWays.width?.median, 2),
    cityPublicVehicleShare: plain((c) => c.publicWays.vehicleShare, 3),
    cityPublicRoofedShare: plain((c) => c.publicRoofedShare, 3),
    cityJunctions: plain((c) => c.publicWays.junctions),
    cityBetweenJunctions: plain((c) => c.publicWays.betweenJunctions?.median, 2),
    cityBuildings: plain((c) => c.buildings.count),
    cityRoomsPerBuilding: plain((c) => c.buildings.roomsPerBuilding?.median, 1),
    cityRoomM2: plain((c) => c.buildings.roomM2?.median, 1),
    cityApartments: plain((c) => c.buildings.apartmentSized),
    cityLayers: plain((c) => c.layers.count),
    cityToConnector: plain((c) => c.layers.toConnector?.median, 2),
    cityRoomRepeatShare: plain((c) => c.variety.rooms.repeatedShare, 3),
    cityModelRepeatShare: plain((c) => c.variety.brushModels.repeatedShare, 3),
    cityDistricts: plain((c) => c.variety.districts),
    cityFloorLight: plain((c) => c.light.floor?.median, 1),
    cityDarkShare: plain((c) => c.light.floor?.darkShare, 3),
    cityDoors: plain((c) => c.furniture.doors),
    cityNamedDoors: plain((c) => c.furniture.namedDoors),
    citySwitches: plain((c) => c.furniture.switches),
    cityLifts: plain((c) => c.furniture.lifts),
  };
}

if (process.argv.includes("--child")) child();
else main().catch((error) => {
  console.error(error);
  process.exit(1);
});
