// Turns are exact (the plaza's fault of 2026-11-10): `turned` keeps every point to a billionth at any angle, so the
// pieces of a form turned together keep sharing their planes; `snap` rounds on request. `frame.place` and `arcade`
// take `snap`; `dome` is exact unless told. checkPlan's off-grid line is a fact, not a warning. `compileMap` says a
// warning the compiler repeats once a place in one sentence (`groupedWarnings`). With the compilers (VHLT_DIR) a room
// holding an arcade along a line at 12 degrees and a dome of 352 is compiled twice, the forms rounded piece by piece
// as 0.38 turned them and exact as 0.39 does, and hlbsp's "Ambiguous leafnode" count of the exact one is held at 0.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, sure, tmp } from "./helper.mjs";
import * as maps from "../check/maps/index.mjs";
import * as S from "../make/maps/source.mjs";
import { frame } from "../make/maps/frame.mjs";
import { arcade, dome } from "../make/maps/forms.mjs";
import { groupedWarnings } from "../make/maps/compile.mjs";

/**
 * Two faces of different brushes whose planes nearly coincide (normals within a hundred-thousandth, distances within
 * 0.05, facing either way) lie on ONE plane to a ten-millionth: what hlcsg needs to cut both the same way.
 */
const sharedExactly = (brushes, what) => {
  const planes = brushes.flatMap((b, n) => b.faces.map((f) => ({ n, ...S.planeOf(f.points) })));
  let near = 0;
  let apart = 0;
  for (let i = 0; i < planes.length; i++)
    for (let j = i + 1; j < planes.length; j++) {
      const [a, b] = [planes[i], planes[j]];
      if (a.n === b.n) continue;
      const along = a.normal[0] * b.normal[0] + a.normal[1] * b.normal[1] + a.normal[2] * b.normal[2];
      if (Math.abs(along) < 1 - 1e-5) continue;
      const gap = Math.abs(a.dist - Math.sign(along) * b.dist);
      if (gap < 0.05) {
        near++;
        if (gap > 1e-7 || Math.abs(along) < 1 - 1e-9) apart++;
      }
    }
  sure(near > 0, `${what}: no planes shared at all`);
  sure(apart === 0, `${what}: ${apart} of ${near} shared planes a hair apart (pieces rounded one by one)`);
};
const refused = (list) => list.flatMap((b, n) => { const c = S.csgFaults(b); return [...c.open, ...c.outside].map((m) => `brush ${n}: ${m}`); }); // prettier-ignore

test("turned: exact at any angle unless told, so two boxes that share a face keep sharing it; snap rounds on request", () => {
  const pair = [S.box([0, 0, 0], [64, 64, 64], "A"), S.box([64, 0, 0], [128, 64, 64], "A")];
  const exact = S.turned(pair, 12, [0, 0, 0]);
  sure(S.offGrid(exact[0]).length > 0, "turned 12 degrees, the corners are off the whole units");
  sharedExactly(exact, "two boxes turned 12 degrees");
  const [a, b] = exact.map((brush) => S.shapeOf(brush));
  sure(a.faults.length === 0 && b.faults.length === 0 && Math.abs(a.volume - 64 ** 3) < 1e-3, `sound, the volume kept: ${a.volume}`);
  const snapped = S.turned(pair, 12, [0, 0, 0], { snap: 1 });
  sure(snapped.every((brush) => S.offGrid(brush).length === 0 && S.shapeOf(brush).faults.length === 0), "snap 1 rounds to whole units and keeps the brush sound");
  sure(S.turned(pair[0], 90, [0, 0, 0]).faces.every((f) => f.points.flat().every(Number.isInteger)), "a quarter turn is whole units");
  // the frame: exact unless told, whole units with snap 1
  const placed = frame({ at: [100, 50, 0], yaw: 37 }).place({ brushes: pair });
  sharedExactly(placed.brushes, "a frame at 37 degrees");
  const rounded = frame({ at: [100, 50, 0], yaw: 37 }).place({ brushes: [pair[0]], snap: 1 }).brushes[0];
  sure(S.offGrid(rounded).length === 0 && S.shapeOf(rounded).faults.length === 0, "frame.place snap 1 rounds");
});

test("arcade along a line at 12 degrees and a dome: every corner two pieces share is one point, every brush closes for sdHLCSG", () => {
  const to = [400 * Math.cos((12 * Math.PI) / 180), 400 * Math.sin((12 * Math.PI) / 180), 0];
  const row = arcade([0, 0, 0], to, { bays: 3, texture: "A" });
  sharedExactly(row, "an arcade at 12 degrees");
  sure(!refused(row).length, `the arcade: ${refused(row).slice(0, 2).join(" | ")}`);
  sure(row.some((b) => S.offGrid(b).length > 0), "the turned row is off the whole units (exact)");
  const straight = arcade([0, 0, 0], [400, 0, 0], { bays: 3, texture: "A" });
  sure(straight.every((b) => S.offGrid(b, 1, 1e-9).length === 0), "a row along an axis is whole units");
  const d = dome([100.37, -50.21, 0], 352, { rings: 5, segments: 16, open: 40, texture: "D" });
  sharedExactly(d, "a dome of 352");
  sure(!refused(d).length, `the dome: ${refused(d).slice(0, 2).join(" | ")}`);
  sure(d.some((b) => S.offGrid(b).length > 0), "the dome is exact unless told");
  sure(dome([0, 0, 0], 256, { texture: "D", snap: 1 }).every((b) => S.offGrid(b).length === 0), "dome snap 1 rounds");
});

test("checkPlan: planes through points off the grid are a fact, not a warning", () => {
  const map = { worldspawn: { wad: "smak.wad" }, brushes: [...S.hollow([0, 0, 0], [256, 256, 128], 16, "W"), S.cylinder("z", [128, 128], 16, 0, 64, "W")], entities: [maps.playerStart([64, 64, 0], 0), maps.light([128, 128, 96])] }; // prettier-ignore
  const report = maps.checkPlan(map);
  sure(!report.errors.length && !report.warnings.length, `${report.errors.join("; ")} ${report.warnings.join("; ")}`);
  sure(report.facts.some((f) => /1 brushes have planes through points off the grid of 1/.test(f)), report.facts.join(" | "));
});

test("groupedWarnings: a warning repeated once a place is one sentence with its count, three places and what to do", () => {
  const lines = [
    'Warning: Ambiguous leafnode content ( EMPTY and SOLID ) at (1533 -90 697)-(1568 -84 704) in hull 0 of model 0 (entity: classname "worldspawn")',
    "Warning: Ambiguous leafnode content ( EMPTY and SOLID ) at (2113 -266 891)-(2183 -236 962) in hull 0 of model 0",
    "Warning: Ambiguous leafnode content ( EMPTY and SOLID ) at (1 2 3)-(4 5 6) in hull 0 of model 0",
    "Warning: Ambiguous leafnode content ( EMPTY and SOLID ) at (7 8 9)-(4 5 6) in hull 0 of model 0",
    "Warning: Leaf portals saw into leaf",
    "Warning: Leaf portals saw into leaf",
    "Warning: Illegal Brush (edge without opposite face): Entity 0, Brush 12",
    "Warning: something odd 5",
    "Warning: something odd 7",
    "Warning: lone",
  ];
  const said = groupedWarnings(lines);
  sure(said.length === 5, `${said.length} sentences for 10 lines: ${said.join(" || ")}`);
  sure(/^4 warnings "Ambiguous leafnode content" at \(1533 -90 697\)-\(1568 -84 704\), \(2113 -266 891\)-\(2183 -236 962\), \(1 2 3\)-\(4 5 6\) and 1 more: .*share their planes/.test(said[0]), said[0]); // prettier-ignore
  sure(/^2 warnings "Leaf portals saw into leaf": hlvis/.test(said[1]), said[1]);
  sure(/^Warning: Illegal Brush .*Brush 12: an edge with no face opposite it: the brush is DROPPED/.test(said[2]), said[2]);
  sure(said[3] === '2 warnings "something odd N"' && said[4] === "Warning: lone", `${said[3]} | ${said[4]}`);
});

const compilers = process.env[maps.COMPILERS_VARIABLE] ? maps.findCompilers() : { found: false };
if (!compilers.found) console.log(`skip  the arcade at 12 degrees and the dome compiled, exact against rounded piece by piece\n      skipped: no compilers (name the folder of VHLT in ${maps.COMPILERS_VARIABLE} to run it)`); // prettier-ignore
else
  test("compiled (hlbsp): an arcade at 12 degrees and a dome of 352 rounded piece by piece give ambiguous leaves, exact none; said once", () => {
    const folder = join(tmp, "exact-turns");
    mkdirSync(folder, { recursive: true });
    const wad = join(folder, "exact.wad");
    writeFileSync(wad, maps.writeWad([{ name: "WALL", image: { width: 16, height: 16, rgb: new Uint8Array(16 * 16 * 3).fill(120) } }]));
    const yaw = (12 * Math.PI) / 180;
    const from = [-560, -300, 0];
    const to = [from[0] + 400 * Math.cos(yaw), from[1] + 400 * Math.sin(yaw), 0];
    const centre = [100.37, -50.21, 0]; // a dome's centre as a frame places it: off the whole units
    const compiled = (snap) => {
      const map = {
        worldspawn: { wad: [wad] },
        brushes: [
          ...maps.hollow([-640, -640, 0], [640, 640, 480], 16, "WALL"),
          ...arcade(from, to, { bays: 3, pier: 40, height: 152, texture: "WALL", snap }),
          ...dome(centre, 352, { rings: 5, segments: 16, thick: 16, open: 40, texture: "WALL", snap }),
        ],
        entities: [maps.playerStart([-560, 500, 0], 0), maps.light([0, 400, 400], { brightness: 300 })],
      };
      const file = join(folder, `exact-${snap ?? "default"}.map`);
      writeFileSync(file, maps.writeMap(map));
      const made = maps.compileMap(file, { fast: true, compilers, wads: [wad], engine: "xash", vis: false, light: false });
      sure(made.bsp, made.errors.join("; "));
      const bsp = made.logs.find((log) => log.tool === "hlbsp");
      return { ambiguous: (bsp.text.match(/Ambiguous leafnode/g) ?? []).length, warnings: made.warnings };
    };
    const rounded = compiled(1);
    const exact = compiled(undefined);
    console.log(`      ambiguous leaves: rounded piece by piece ${rounded.ambiguous}, exact ${exact.ambiguous}`);
    sure(rounded.ambiguous > 0, "the rounded forms give hlbsp no ambiguous leaf: the case does not bite");
    sure(exact.ambiguous === 0, `the exact forms still give ${exact.ambiguous} ambiguous leaves`);
    const said = rounded.warnings.filter((w) => /Ambiguous leafnode/.test(w));
    sure(said.length === 1 && new RegExp(`^hlbsp: ${rounded.ambiguous} warnings "Ambiguous leafnode content" at`).test(said[0]), `said once with its count: ${said.join(" || ")}`); // prettier-ignore
  });
