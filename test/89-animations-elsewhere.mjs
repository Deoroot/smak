// Animations kept in other files (<name>01.mdl) read by everything that poses a model: `posed` and the pictures
// (`render`, `strip`), `posesFor` and `motionOverlaps`, each given `groups` as poseAt is. On a
// hinge of two bones, made up here, the animation that swings the lower bone into a guard is moved into a side
// file: without the file it is left out and named, with it it is measured as the model's own would be.
import * as smak from "../src/index.mjs";
import { test, sure, near, tmp, runSmak } from "./helper.mjs";
import { join } from "node:path";
import { writeFileSync, readFileSync } from "node:fs";

const S = smak.solids;
const plain = smak.indexed({ width: 8, height: 8, rgb: new Uint8Array(8 * 8 * 3).fill(128) }, "plain.bmp");
/** a box from a to b in model space at rest, as a solid's triangles */
const block = (a, b) => S.trisOf(S.box(S.place(S.lerp3(a, b, 0.5), [0, 0, 1], [1, 0, 0]), b[0] - a[0], b[1] - a[1], b[2] - a[2])); // prettier-ignore
const frame = (turn) => [
  [0, 0, 0, 0, 0, 0],
  [10, 0, 0, 0, 0, turn],
];
const onBone = (tris, bone) => tris.map((t) => t.map((c) => ({ p: c.p, uv: [0, 0], bone })));
const hinge = smak.buildMdl({
  name: "hinge.mdl",
  bones: [
    { name: "upper", parent: -1 },
    { name: "lower", parent: 0, pos: [10, 0, 0] },
  ],
  bodyparts: [{ name: "body", models: [{ name: "arm", meshes: [{ tris: [...onBone(block([0, -1, -1], [9, 1, 1]), "upper"), ...onBone(block([11, -1, -1], [20, 1, 1]), "lower")], texture: plain }] }] }], // prettier-ignore
  sequences: [
    { name: "idle", frames: [frame(0)] },
    { name: "swing", frames: Array.from({ length: 11 }, (_, f) => frame((f / 10) * 1.22)) },
  ],
});
// "swing" kept in another file: its record says group 1 (mstudioseqdesc_t.seqgroup, 156 bytes into the second
// sequence's), and the side file is the model's bytes marked as a sequence file, its values where they were
const main = Buffer.from(hinge);
main.writeInt32LE(1, main.readInt32LE(168) + 176 + 156);
const side = Buffer.from(hinge);
side.write("IDSQ", 0, "latin1");
const groups = [undefined, side];

const pieces = [
  { bone: "lower", name: "arm", tris: block([12, -1, -1], [16, 1, 1]) },
  { bone: "upper", name: "guard", tris: block([10.5, 3, -0.5], [13, 5, 0.5]) },
];

test("posed and strip: an animation in another file posed from groups, refused by strip without them", () => {
  sure(smak.sequences(main)[1].group === 1, "the swing is kept in another file");
  const tip = (mdl, opts) => Math.max(...smak.posed(mdl, { seq: "swing", frame: 10, ...opts }).tris.flatMap((t) => t.c.map((c) => c.p[1]))); // prettier-ignore
  near(tip(main, { groups }), tip(hinge), 1e-6, "posed from the side file as from the model's own");
  sure(tip(main, { groups }) > 5, "the lower block swung up");
  near(tip(main), 1, 1e-6, "without the file it stands at rest");
  const between = smak.posed(main, { seq: "swing", frame: 4.5, groups }).pose;
  const own = smak.posed(hinge, { seq: "swing", frame: 4.5 }).pose;
  sure(JSON.stringify(between) === JSON.stringify(own), "between two frames");
  const drawn = smak.strip(main, { seq: "swing", count: 3, groups, width: 64, height: 64 });
  const same = smak.strip(hinge, { seq: "swing", count: 3, width: 64, height: 64 });
  sure(Buffer.from(drawn.rgba).equals(Buffer.from(same.rgba)), "the strip is the model's own");
  let said = "";
  try {
    smak.strip(main, { seq: "swing", count: 3 });
  } catch (e) {
    said = e.message;
  }
  sure(/kept in another file: give groups/.test(said), `without them: ${said}`);
});

test("posesFor: an animation in another file posed from groups, named without them", () => {
  const without = smak.posesFor(main, {});
  sure(without.used.join() === "idle" && without.skipped[0]?.name === "swing", JSON.stringify(without));
  const withIt = smak.posesFor(main, { groups });
  sure(withIt.used.join() === "idle,swing" && !withIt.skipped.length, JSON.stringify(withIt.used));
  sure(withIt.poses.length === 1 + 6, `${withIt.poses.length} poses`);
});

test("motionOverlaps: an animation in another file measured from groups, as the model's own", () => {
  const without = smak.motionOverlaps(main, pieces, undefined, { space: "rest" });
  sure(without.sequences.map((s) => s.name).join() === "idle", without.sequences.map((s) => s.name).join());
  sure(without.skipped[0]?.name === "swing" && !without.worst, JSON.stringify(without.skipped));
  const found = smak.motionOverlaps(main, pieces, undefined, { space: "rest", groups });
  const own = smak.motionOverlaps(hinge, pieces, undefined, { space: "rest" });
  sure(!found.skipped.length, JSON.stringify(found.skipped));
  sure(found.worst?.a === "arm" && found.worst.b === "guard" && found.worst.sequence === "swing", JSON.stringify(found.worst)); // prettier-ignore
  sure(JSON.stringify(found) === JSON.stringify(own), "the same overlaps as on the model's own");
  // built in a pose of the side file: the swing's last frame
  const bent = smak.motionOverlaps(main, pieces, ["idle"], { space: "rest", groups, still: { seq: "swing", frame: 10 } }); // prettier-ignore
  sure(bent.built.some((p) => p.a === "arm" && p.b === "guard"), JSON.stringify(bent.built));
});

test("smak strip: an animation kept in <name>01.mdl beside the model drawn from it", () => {
  // the model's own table of sequence groups made two (mstudioseqgroup_t, 104 bytes: label, name), the second
  // named as studiomdl names it; the file of animations beside the model
  const table = Buffer.alloc(2 * 104);
  table.write("default", 0, "latin1");
  table.write("hinge01", 104, "latin1");
  table.write("models\hinge01.mdl", 104 + 32, "latin1");
  const grouped = Buffer.concat([main, table]);
  grouped.writeInt32LE(2, 172);
  grouped.writeInt32LE(main.length, 176);
  sure(smak.sequenceGroups(grouped).length === 2, "two groups");
  const file = join(tmp, "hinge.mdl");
  writeFileSync(file, grouped);
  writeFileSync(join(tmp, "hinge01.mdl"), side);
  const out = join(tmp, "hinge_swing.png");
  runSmak("strip", file, "-o", out, "--seq", "swing", "--count", "3", "--width", "64", "--height", "64");
  const own = smak.strip(hinge, { seq: "swing", count: 3, width: 64, height: 64 });
  const made = smak.unpng(readFileSync(out));
  sure(Buffer.from(made.rgba).equals(Buffer.from(own.rgba)), "drawn as the model's own swing");
});
