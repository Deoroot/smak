// Two checks from the owner's walk of the plaza slice (2026-11-10): a brush entity's face on a face of the world,
// looking the same way (z-fighting), and the sky seen through a slit in a roof from under it. The map of the second
// is the kit's own (test/fixture-skygap.mjs), compiled once into test/fixtures.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../src/maps/index.mjs";
import { skyGapMap, EYE_UNDER_SLIT, eyeIn, ROOMS } from "./fixture-skygap.mjs";
import { test, sure, HERE, SMAK_CLI, runRefused, tmp } from "./helper.mjs";

const FIXTURES = join(HERE, "fixtures");
const T = { floor: "SMAKFLOOR", ceiling: "SMAKCEIL", wall: "SMAKWALL" };
/** A sealed room of 256 x 256 x 128 with walls 16 thick (its east wall's inner face at x = 256), and the entities given. */
const room = (entities) => ({
  worldspawn: { wad: "smak.wad" },
  brushes: maps.hollow([0, 0, 0], [256, 256, 128], 16, T),
  entities: [maps.playerStart([64, 64, 0], 0), maps.light([128, 128, 96]), ...entities],
});

// ── coplanarFaults ──

test("a func_detail shelf flush against a wall, and a crate on the floor, are no fault: their faces look at the world's", () => {
  const shelf = maps.box([64, 240, 0], [192, 256, 120], "SMAKWALL"); // its back on the north wall's face, its foot on the floor
  const crate = maps.box([128, 64, 0], [160, 96, 32], "SMAKWALL");
  for (const classname of ["func_detail", "func_wall"]) {
    const found = maps.coplanarFaults(room([maps.brushEntity(classname, [shelf, crate])]));
    sure(found.fights.length === 0 && found.folded.length === 0, `${classname}: ${[...found.fights, ...found.folded].join(" | ")}`);
  }
});

test("a func_detail panel set flush into a wall is a fact (the compiler cuts its face away), a func_wall's a fight", () => {
  const panel = maps.box([256, 64, 32], [264, 128, 96], "SMAKWALL");
  const detail = maps.coplanarFaults(room([maps.brushEntity("func_detail", [panel])]));
  sure(detail.fights.length === 0 && detail.folded.length === 1, `func_detail: ${JSON.stringify(detail)}`);
  sure(/^brush 0 of entity 3 \(func_detail\) at 256 64 32: its face on x = 256 looking -x lies on world brush 3's/.test(detail.folded[0]), detail.folded[0]); // prettier-ignore
  const wall = maps.coplanarFaults(room([maps.brushEntity("func_wall", [panel])]));
  sure(wall.fights.length === 1 && wall.folded.length === 0, `func_wall: ${JSON.stringify(wall)}`);
  const report = maps.checkPlan(room([maps.brushEntity("func_detail", [panel])]), { leak: false });
  sure(report.errors.length === 0, report.errors.join(" | "));
  sure(report.facts.some((fact) => /^1 faces of func_detail lie on a world face looking the same way/.test(fact)), report.facts.join(" | ")); // prettier-ignore
});

test("a face on a turned plane is told by its normal, and a CLIP face is not counted", () => {
  const wedge = maps.wedge([64, 64, 0], [128, 128, 64], "+x", "SMAKWALL");
  const twin = maps.wedge([96, 64, 0], [128, 128, 64], "+x", "SMAKWALL"); // the same slope, half the run: its slope lies on the first's
  const found = maps.coplanarFaults(room([maps.brushEntity("func_wall", [wedge]), maps.brushEntity("func_illusionary", [twin])]));
  sure(found.fights.length >= 1, "the slopes share a plane");
  sure(found.fights.some((line) => /the plane looking \(/.test(line) || /looking [-+][xyz]/.test(line)), found.fights[0]);
  const clips = maps.coplanarFaults(room([maps.brushEntity("func_wall", [maps.box([256, 64, 32], [264, 128, 96], "CLIP")])]));
  sure(clips.fights.length === 0, clips.fights.join(" | "));
});

// ── skyGaps ──

const skygap = maps.readBsp(readFileSync(join(FIXTURES, "skygap.bsp")));

test("the fixture's .map is what test/fixture-skygap.mjs makes", () => {
  const map = skyGapMap();
  const written = maps.writeMap({ ...map, worldspawn: { ...map.worldspawn, wad: "skygap.wad" } }).replace(/\r\n/g, "\n");
  const kept = readFileSync(join(FIXTURES, "skygap.map"), "utf8").replace(/\r\n/g, "\n");
  sure(written === kept, "the fixture's .map differs from the script's: run node test/fixture-skygap.mjs with VHLT_DIR and commit the three files"); // prettier-ignore
});

test("the slit over room A's spawn shows the sky: found from the map's own eyes, told with the eye, the way looked and the place", () => {
  const report = maps.skyGaps(skygap);
  sure(!report.passed && report.gaps.length >= 1, report.said);
  sure(report.eyes.count >= 2 && report.eyes.roofed === report.eyes.count, JSON.stringify(report.eyes));
  const gap = report.gaps[0];
  sure(gap.width >= 2 && gap.width < 4, `the slit is 2 wide, measured ${gap.width}`);
  sure(Math.abs(gap.at[0] - 255) <= 2 && gap.at[2] >= 128 && gap.at[2] <= 132, `the gap is in the slit: ${gap.at}`);
  sure(gap.eye.join() === EYE_UNDER_SLIT.join() && gap.pitch >= 45 && gap.pitch <= 85, `seen from the spawn, steeply (along the slit the way is longer, so the pitch lower): ${JSON.stringify(gap)}`); // prettier-ignore
  sure(/^sky seen from 244 128 64 looking yaw \d+ pitch \d+: a gap [\d.]+ units wide at [-\d ]+ \(\d+ rays from \d+ eyes reach the sky through it\); close it, or it is meant to be a window: ignore it$/.test(report.warnings[0]), report.warnings[0]); // prettier-ignore
  sure(/^WARN|^\d+ gaps show the sky/.test(report.said) && /narrowest 2/.test(report.said), report.said);
});

test("room B's window of 64 shows the sky and is no gap; room C sees none; an ignore box over the slit silences it", () => {
  const window = maps.skyGaps(skygap, { eyes: [eyeIn("b")] });
  sure(window.passed && window.gaps.length === 0, window.warnings.join(" | "));
  sure(window.facts.some((fact) => /, [1-9]\d* of them reached the sky, [1-9]\d* through an opening 24 units wide or more/.test(fact)), window.facts.join(" | ")); // prettier-ignore
  const sealed = maps.skyGaps(skygap, { eyes: [eyeIn("c")] });
  sure(sealed.passed && sealed.facts.some((fact) => / 0 of them reached the sky/.test(fact)), sealed.facts.join(" | "));
  const ignored = maps.skyGaps(skygap, { eyes: [EYE_UNDER_SLIT], ignore: [{ min: [ROOMS.a[1] - 8, 0, 120], max: [ROOMS.b[0], 256, 140] }] });
  sure(ignored.passed && ignored.facts.some((fact) => /rays reached the sky through gaps inside the places ignored/.test(fact)), ignored.facts.join(" | ")); // prettier-ignore
  const open = maps.skyGaps(skygap, { eyes: [[416, -128, 64]] }); // in the yard, under the open sky: not asked
  sure(open.passed && open.eyes.roofed === 0 && open.eyes.open === 1, JSON.stringify(open.eyes));
});

test("smak map-skygaps ends in WARN with exit code 1 on the slit, and in PASS from room C", () => {
  const warned = runRefused(SMAK_CLI, "map-skygaps", join(FIXTURES, "skygap.bsp"));
  sure(warned.code === 1, `exit code ${warned.code}: ${warned.err}`);
  const lines = warned.out.trim().split(/\r?\n/);
  sure(/^WARN: \d+ gaps show the sky from under a roof/.test(lines.at(-1)), lines.at(-1));
  sure(lines.some((line) => /^WARN  sky seen from 244 128 64/.test(line)), warned.out);
  const eyes = join(tmp, "skygap-eyes-c.json");
  writeFileSync(eyes, JSON.stringify([eyeIn("c")]));
  const passed = runRefused(SMAK_CLI, "map-skygaps", join(FIXTURES, "skygap.bsp"), "--eyes", eyes);
  sure(passed.code === 0 && /^PASS: no gap shows the sky/m.test(passed.out), `${passed.code}: ${passed.out}${passed.err}`);
});
