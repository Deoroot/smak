// Three faults met building a map: stairs with a step that is only more floor and edges off the grid, a
// compile that foretold seconds for an hlvis that took a tenth of one, and a check of one map that warned
// of another map's scripts.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../check/maps/index.mjs";
import { test, sure, tmp, runSmak } from "./helper.mjs";

const folder = join(tmp, "map-small-faults");
mkdirSync(folder, { recursive: true });
const refusal = (run) => {
  try {
    run();
  } catch (e) {
    return e.message;
  }
  return "";
};
/** A box brush's extent, from the points of its faces. */
const extentOf = (brush) => {
  const points = brush.faces.flatMap((face) => face.points);
  const min = [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis])));
  // a face's three points are on its plane and may run past the brush: what bounds it is where the planes meet
  return { min, max };
};
const solidOf = (brush) => maps.brushShape?.(brush) ?? null;

test("stairs as they were, unless a flight asks for no top step or a tread of its own", () => {
  const old = maps.stairs([0, 0, 0], [128, 64, 64], "+x", "A");
  const same = maps.stairs([0, 0, 0], [128, 64, 64], "+x", "A", { tread: 32, top: true });
  sure(JSON.stringify(old) === JSON.stringify(same), "a tread that is the run shared out is the flight as it was");
  // 64 high in steps of 16: four risers; without the top step three slabs, the last riser onto the upper floor
  const slabs = maps.stairs([0, 0, 0], [96, 64, 64], "+x", "A", { top: false });
  sure(slabs.length === 3, `three steps where the upper floor is the fourth: ${slabs.length}`);
  const box = (brush) => maps.writeMap({ worldspawn: {}, brushes: [brush], entities: [] });
  const want = [
    [64, 96, 48],
    [32, 64, 32],
    [0, 32, 16],
  ];
  // each a slab of its own tread, standing on the floor, the highest first and under the upper floor's edge
  want.forEach(([from, to, top], index) => {
    const one = maps.stairs([0, 0, 0], [96, 64, 64], "+x", "A", { top: false })[index];
    const made = maps.writeMap({ worldspawn: {}, brushes: [maps.box([from, 0, 0], [to, 64, top], "A")], entities: [] }); // prettier-ignore
    sure(box(one) === made, `step ${index + 1} is the box ${from}..${to} up to ${top}`);
  });
  // a tread of 20 on a run of 100: on the grid from the high side, and what is over is floor
  const treads = maps.stairs([0, 0, 0], [100, 64, 64], "-x", "A", { top: false, tread: 20 });
  const made = treads.map((brush) => box(brush));
  const boxes = [[0, 20, 48], [20, 40, 32], [40, 60, 16]].map(([from, to, top]) => box(maps.box([from, 0, 0], [to, 64, top], "A"))); // prettier-ignore
  sure(made.join() === boxes.join(), "a tread laid from the high side (-x), each 20 deep");
  // with its top step and a tread: stacked as ever, each running on to the high side, the top one level
  const stacked = maps.stairs([0, 0, 0], [100, 64, 32], "+x", "A", { tread: 24 });
  const stackedBoxes = [[52, 100, 0, 16], [76, 100, 16, 32]].map(([from, to, low, top]) => box(maps.box([from, 0, low], [to, 64, top], "A"))); // prettier-ignore
  sure(stacked.map((brush) => box(brush)).join() === stackedBoxes.join(), "a tread with the top step");
  // what is wrong is said
  sure(/stairs: 3 steps of 40 are 120 long, and the box runs 100 towards \+x/.test(refusal(() => maps.stairs([0, 0, 0], [100, 64, 64], "+x", "A", { top: false, tread: 40 }))), "a run too short for its treads"); // prettier-ignore
  sure(/stairs: tread is how deep a step is, in units over 0, not 0/.test(refusal(() => maps.stairs([0, 0, 0], [100, 64, 64], "+x", "A", { tread: 0 }))), "a tread of nothing"); // prettier-ignore
  sure(/stairs: top is true or false, not "no"/.test(refusal(() => maps.stairs([0, 0, 0], [100, 64, 64], "+x", "A", { top: "no" }))), "a top that is a word"); // prettier-ignore
  void extentOf;
  void solidOf;
});

test("a compile says what hlvis took, and guesses at what it would take only where the guess is minutes", () => {
  const portals = (count) => ({ leaves: Math.round(count / 3), portals: count, seconds: Math.round(219 * (count / 5088) ** 2) }); // prettier-ignore
  const small = portals(595);
  sure(small.seconds === 3, `595 portals are guessed at ${small.seconds} s from the one map measured`);
  const said = (result) => maps.portalsLine({ logs: [], ...result });
  // a full hlvis that ran: what it took, and no guess
  sure(said({ portals: small, logs: [{ tool: "hlvis", args: ["x"], seconds: 0.12, code: 0 }] }) === "595 between 198 leaves (hlvis's work: a full one took 0.1 s)", "what a full hlvis took"); // prettier-ignore
  // a draft: its hlvis was the quick one, and a small guess says nothing
  sure(said({ portals: small, logs: [{ tool: "hlvis", args: ["-fast", "x"], seconds: 0.1, code: 0 }] }) === "595 between 198 leaves (hlvis's work)", "a draft's hlvis is no full one, and 3 s is no guess worth saying"); // prettier-ignore
  sure(said({ portals: small }) === "595 between 198 leaves (hlvis's work)", "nor before hlvis has run");
  // a guess of minutes is said, and said to be a guess
  const big = portals(5088);
  sure(said({ portals: big, logs: [{ tool: "hlvis", seconds: 480, code: null }] }) === "5088 between 1696 leaves (hlvis's work: a full one is guessed at about 219 s, from one map measured)", said({ portals: big })); // prettier-ignore
  sure(said({}) === null, "no portals, no line");
  const summary = maps.compileSummary({ bsp: "x.bsp", logs: [{ tool: "hlvis", args: ["x"], seconds: 0.12, code: 0 }], portals: small, errors: [], warnings: [] }); // prettier-ignore
  sure(/^portals: 595 between 198 leaves \(hlvis's work: a full one took 0\.1 s\)$/m.test(summary), summary);
  sure(!/foretold|or more/.test(summary), "no foretelling that is no floor");
});

// ── scripts: a made-up game whose scripts are named by path, a map's own under a folder of its name ──
const SHIPPED = new Map([["world", "// the world\n"]]);
const RULES = { ofEntity: (keys) => (keys.script ? [keys.script.toLowerCase()] : []) };
const oursOf = (list) => new Map(Object.entries(list).map(([name, text]) => [name, { text, file: `ours/${name}.script` }])); // prettier-ignore

test("a check of one map warns of its own scripts named by nothing, and of another map's only when told", () => {
  const ours = oursOf({
    "yard/keeper": "// named by the yard\n",
    "yard/lost": "use yard/lost2\n",
    "yard/lost2": "// named only by a script of the yard nothing names\n",
    "cellar/rat": "// the cellar's: named by the cellar, which is not looked at\n",
    "beasts/stray": "// no map's\n",
  });
  const yard = { name: "yard", entities: [{ classname: "beast", script: "yard/keeper" }] };
  const mapNames = ["yard", "cellar"];
  const every = maps.scriptsPlaced({ ours, shipped: SHIPPED, maps: [yard], rules: RULES, mapNames });
  sure(/^4 scripts are new .*yard\/lost.*yard\/lost2.*cellar\/rat.*beasts\/stray/.test(every.warnings[0]), every.warnings.join(" | ")); // prettier-ignore
  const one = maps.scriptsPlaced({ ours, shipped: SHIPPED, maps: [yard], rules: RULES, mapNames, only: ["yard"] });
  sure(one.warnings.length === 1 && /^2 scripts are new .*yard\/lost \(ours\/yard\/lost\.script\).*yard\/lost2/.test(one.warnings[0]), one.warnings.join(" | ")); // prettier-ignore
  sure(!/cellar\/rat|beasts\/stray/.test(one.warnings[0]), "another map's script, and one of no map, are not warned of");
  sure(one.facts.includes("2 more scripts are new and named by nothing, and are no part of yard: not warned of here (all of them are when every map is looked at)"), one.facts.join(" | ")); // prettier-ignore
  sure(one.scripts.find((script) => script.name === "cellar/rat").state === "unnamed", "every script is placed all the same");
  // a profile may say whose a script is
  const theirs = maps.scriptsPlaced({ ours, shipped: SHIPPED, maps: [yard], rules: { ...RULES, mapOf: (name) => (name === "beasts/stray" ? "yard" : null) }, mapNames, only: "yard" }); // prettier-ignore
  sure(/^1 scripts are new .*beasts\/stray/.test(theirs.warnings[0]), theirs.warnings.join(" | "));
});

test("smak map-check --scripts warns of the map's own scripts, and of all of them with --all", () => {
  const scripts = join(folder, "scripts");
  const shipped = join(folder, "shipped");
  for (const [name, text] of Object.entries({ "yard/lost": "//\n", "cellar/rat": "//\n", "yard/keeper": "//\n" })) {
    mkdirSync(join(scripts, name, ".."), { recursive: true });
    writeFileSync(join(scripts, `${name}.script`), text);
  }
  mkdirSync(shipped, { recursive: true });
  writeFileSync(join(shipped, "world.script"), "//\n");
  const profile = join(folder, "profile.mjs");
  writeFileSync(
    profile,
    `import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const read = (folder, under = "", found = new Map()) => {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) read(path, under + name + "/", found);
    else if (name.endsWith(".script")) found.set((under + name).replace(/\\.script$/, ""), { text: readFileSync(path, "utf8"), file: path });
  }
  return found;
};
export default () => ({
  name: "made-up",
  scriptPack: {
    shipped: (folder) => new Map([...read(folder)].map(([name, script]) => [name, script.text])),
    loose: read,
    ofEntity: (keys) => (keys.script ? [keys.script] : []),
    maps: () => ["yard", "cellar"],
  },
});
`,
  );
  const room = [maps.box([-16, -16, -16], [272, 272, 0], "A"), maps.box([-16, -16, 128], [272, 272, 144], "A"), maps.box([-16, -16, 0], [0, 272, 128], "A"), maps.box([256, -16, 0], [272, 272, 128], "A"), maps.box([0, -16, 0], [256, 0, 128], "A"), maps.box([0, 256, 0], [256, 272, 128], "A")]; // prettier-ignore
  const mapFile = join(folder, "yard.map");
  writeFileSync(mapFile, maps.writeMap({ worldspawn: {}, brushes: room, entities: [maps.playerStart([128, 128, 0], 0), maps.pointEntity("monster_zombie", [64, 64, 36], { script: "yard/keeper" })] })); // prettier-ignore
  const checked = runSmak("map-check", mapFile, "--mod", profile, "--scripts", scripts, "--shipped", shipped, "--verbose");
  sure(/^WARN {2}1 scripts are new .*yard\/lost/m.test(checked) && !/cellar\/rat/.test(checked.split("\n").filter((line) => /^WARN/.test(line)).join()), checked); // prettier-ignore
  sure(/1 more scripts are new and named by nothing, and are no part of yard/.test(checked), "the others are counted");
  const all = runSmak("map-check", mapFile, "--mod", profile, "--scripts", scripts, "--shipped", shipped, "--all", "--verbose");
  sure(/^WARN {2}2 scripts are new .*cellar\/rat.*yard\/lost/m.test(all), all);
});
