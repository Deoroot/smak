// What a real scene (the mess hall, 2026-11-14) found wrong in 1.1 and 1.2, each held on the kit's own fixtures: the
// battery takes `--ignore` (M3) and a `--seen` box for space seen and never walked (M18), and the box hides nothing
// else; a setting entity of the mod (`ts_fog`) is no place to go to (M2); map-view's `--no-labels` is in its help
// and COMMANDS.md (M6); the light's line says nothing of a draft a .bsp cannot tell (M14). M12 and M13 are in 204.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../check/maps/index.mjs";
import { test, sure, HERE, SMAK_CLI, runRefused, tmp } from "./helper.mjs";

const tworooms = readFileSync(join(HERE, "fixtures", "tworooms.bsp"));
const bsp = maps.readBsp(tworooms);
/** The room behind the func_walls of tworooms: its part is the one the walk names at 96 352 0. */
const over = { min: [64, 320, -8], max: [128, 384, 8] };
const elsewhere = { min: [0, 0, -8], max: [64, 64, 8] };

test("seen: a box over the room not walked to leaves it out of the warning and says so in one fact; a box elsewhere leaves the warning standing", () => {
  const warned = (seen) => maps.reachOf(bsp, { seen });
  const hidden = warned([over]);
  sure(!hidden.warnings.some((w) => /size of a room/.test(w)), hidden.warnings.join(" | "));
  sure(hidden.facts.some((f) => /^1 parts of the floor the size of a room are in space given as seen and never walked \(64 320 -8 to 128 384 8\), and are left out of the warning: 96 352 0$/.test(f)), hidden.facts.join(" | ")); // prettier-ignore
  const standing = warned([elsewhere]);
  sure(standing.warnings.some((w) => /^1 parts of the floor the size of a room .*96 352 0/.test(w)), standing.warnings.join(" | "));
  sure(!standing.facts.some((f) => /given as seen/.test(f)), "a box that holds nothing says nothing");
});

test("map-battery --seen and --ignore reach the walk: the reach line passes with the box over the room, warns with it elsewhere; --ignore is counted", () => {
  const run = (...args) => runRefused(SMAK_CLI, "map-battery", join(HERE, "fixtures", "tworooms.bsp"), "-o", join(tmp, "battery-seen"), "--verbose", ...args);
  const seen = run("--seen", "64,320,-8,128,384,8");
  sure(/^reach +PASS/m.test(seen.out), seen.out.split("\n")[0]);
  sure(/left out of the warning: 96 352 0/.test(seen.out), "the one fact");
  sure(/^reach +WARN/m.test(run("--seen", "0,0,-8,64,64,8").out), "a box elsewhere hides nothing");
  sure(/1 entities named in ignore left out/.test(run("--ignore", "info_player_start").out), "--ignore reaches reachOf");
  const bad = run("--seen", "1,2,3");
  sure(bad.code === 1 && /--seen: six numbers x0,y0,z0,x1,y1,z1, not 1,2,3/.test(bad.err), bad.err);
});

test("a ts_fog out in the void is a setting, no place a player goes to; a monster out there still is", () => {
  const house = (...entities) => ({
    worldspawn: {},
    brushes: maps.carve([{ min: [0, 0, 0], max: [320, 256, 160] }], 16, { floor: "FLOOR", ceiling: "CEILING", wall: "WALL" }),
    entities: [maps.playerStart([96, 128, 0], 0), maps.light([160, 128, 140]), ...entities],
  });
  const fog = maps.pointEntity("ts_fog", [2000, 2000, 2000], { density: "0.001" });
  sure(!maps.reachOf(house(fog)).warnings.length, maps.reachOf(house(fog)).warnings.join(" | "));
  sure(maps.reachOf(house(fog, maps.pointEntity("monster_zombie", [2000, 2000, 2000]))).warnings.some((w) => /^1 of the 2 entities a player goes to are not reached/.test(w)), "a monster there is not reached"); // prettier-ignore
});

test("the help lists map-view's --no-labels and the light's line makes no claim about a draft", () => {
  const help = runRefused(SMAK_CLI, "--help").out;
  sure(/map-view <bsp\|map> .*\[--no-labels\]/.test(help), "map-view's usage lists --no-labels");
  sure(/\[--ignore a,b\] \[--seen x0,y0,z0,x1,y1,z1 \.\.\.\]/.test(help), "map-battery's usage lists --ignore and --seen");
  sure(/--no-labels/.test(readFileSync(join(HERE, "../docs/COMMANDS.md"), "utf8")), "COMMANDS.md has it");
  const view = maps.drawMap(bsp, { from: [96, 96, 40], yaw: 0, width: 64, height: 36 });
  sure(/^lightmaps: .* on its texture, as the compiler stored it$/.test(view.facts.light) && !/draft|fast|bounces/.test(view.facts.light), view.facts.light);
});
