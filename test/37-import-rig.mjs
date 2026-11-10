// A file's skeleton and animations made a studio model's (src/import-rig.mjs): a small rig written here from
// nothing as an FBX (a skin of two clusters, an animation curve) and as a .glb (JOINTS_0, WEIGHTS_0, inverse bind
// matrices, a LINEAR turn and a STEP move), read, made a model, and its points seen to go where the file's bones
// take them.
import * as smak from "../src/index.mjs";
import { test, sure, near } from "./helper.mjs";
import {
  L,
  S,
  record,
  properties,
  P,
  doubles,
  ints,
  longs,
  floats,
  fbxBinary,
  globalSettings,
  model,
  geometry,
  connections,
  objects,
  objectName,
  gltfBuilder,
  CUBE_FACES,
} from "./fixture-import.mjs";

/** Two boxes standing on each other along the file's +y: the lower from y 0 to 8, the upper from 10 to 12. */
const boxPoints = (a, b) => [
  [a[0], a[1], a[2]], [b[0], a[1], a[2]], [b[0], b[1], a[2]], [a[0], b[1], a[2]],
  [a[0], a[1], b[2]], [b[0], a[1], b[2]], [b[0], b[1], b[2]], [a[0], b[1], b[2]],
]; // prettier-ignore
const POINTS = [...boxPoints([-1, 0, -1], [1, 8, 1]), ...boxPoints([-1, 10, -1], [1, 12, 1])];
const POLYGONS = [...CUBE_FACES, ...CUBE_FACES.map((face) => face.map((i) => i + 8))];
const TICKS = 46186158000;
/** A matrix of sixteen numbers as FBX writes it, the move last: a move alone. */
const movedBy = ([x, y, z]) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

/**
 * The FBX: an armature node, a bone `root` and a bone `tip` 10 above it; the lower box on root alone, the
 * upper on tip (0.7) and root (0.3); an animation "Armature|Bend" that turns tip a quarter about the file's z
 * over a second.
 */
const rigFbx = () =>
  fbxBinary([
    globalSettings({ unit: 1 }),
    objects(
      model(1, "Armature", "Null"),
      model(2, "root", "LimbNode"),
      model(3, "tip", "LimbNode", [["Lcl Translation", 0, 10, 0]]),
      model(4, "body", "Mesh"),
      geometry(5, "body", { points: POINTS, polygons: POLYGONS }),
      record("Deformer", [L(6), S(objectName("skin", "Deformer")), S("Skin")]),
      record("Deformer", [L(7), S(objectName("root", "SubDeformer")), S("Cluster")], [
        record("Indexes", [ints([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])]),
        record("Weights", [doubles([1, 1, 1, 1, 1, 1, 1, 1, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3])]),
        record("Transform", [doubles(movedBy([0, 0, 0]))]),
        record("TransformLink", [doubles(movedBy([0, 0, 0]))]),
      ]),
      record("Deformer", [L(8), S(objectName("tip", "SubDeformer")), S("Cluster")], [
        record("Indexes", [ints([8, 9, 10, 11, 12, 13, 14, 15])]),
        record("Weights", [doubles([0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7])]),
        record("Transform", [doubles(movedBy([0, -10, 0]))]),
        record("TransformLink", [doubles(movedBy([0, 10, 0]))]),
      ]),
      record("AnimationStack", [L(20), S(objectName("Armature|Bend", "AnimStack")), S("")]),
      record("AnimationLayer", [L(21), S(objectName("BaseLayer", "AnimLayer")), S("")]),
      record("AnimationCurveNode", [L(22), S(objectName("R", "AnimCurveNode")), S("")], [properties(P("d|X", "Number", 0), P("d|Y", "Number", 0), P("d|Z", "Number", 0))]),
      record("AnimationCurve", [L(23), S(objectName("", "AnimCurve")), S("")], [
        record("KeyTime", [longs([0, TICKS])]),
        record("KeyValueFloat", [floats([0, 90])]),
      ]),
    ),
    connections(
      [1, 0], [2, 1], [3, 2], [4, 0], [5, 4], [6, 5], [7, 6], [8, 6], [2, 7], [3, 8],
      [21, 20], [22, 21], [22, 3, "Lcl Rotation"], [23, 22, "d|Z"],
    ), // prettier-ignore
  ]);

/** The posed corners of a model at a frame, and the one nearest a point. */
const nearestCorner = (mdl, seq, frame, to) => {
  const corners = smak.posed(mdl, { seq, frame }).tris.flatMap((tri) => tri.c.map((c) => c.p));
  return Math.min(...corners.map((p) => Math.hypot(p[0] - to[0], p[1] - to[1], p[2] - to[2])));
};

test("readFbx: a skin's clusters: each corner's weights, the bone that weighs most, the joints; an animation's curve", () => {
  const read = smak.readFbx(rigFbx());
  sure(read.joints.map((joint) => read.nodes[joint].name).join() === "root,tip", `joints ${read.joints}`);
  const upper = read.groups[0].tris.flat().filter((corner) => corner.p[2] > 9);
  sure(upper.length && upper.every((corner) => read.nodes[corner.node].name === "tip"), "the upper box on tip");
  sure(upper.every((corner) => corner.weights.length === 2 && Math.abs(corner.weights[0][1] - 0.7) < 1e-9), "with both weights, heaviest first");
  near(read.box.mx[2], 12, 1e-9, "the skinned points where the bones hold them at rest");
  sure(read.animations.length === 1 && read.animations[0].name === "Armature|Bend", JSON.stringify(read.animations.map((a) => a.name)));
  near(read.animations[0].duration, 1, 1e-9, "a second long");
  const halfway = read.animations[0].at(0.5).get(read.nodes.findIndex((node) => node.name === "tip"));
  // a turn of 45 degrees about the file's z: its first column is (cos 45, sin 45, 0), the move kept
  near(halfway[0][0], Math.SQRT1_2, 1e-9, "halfway: 45 degrees");
  near(halfway[1][3], 10, 1e-9, "its place kept");
});

test("importRigged: the FBX's bones and animation in a model; the upper box swings as the file's tip turns", () => {
  const read = smak.readFbx(rigFbx());
  // a unit of the file for a unit of the game
  const made = smak.importRigged(read, { name: "rig.mdl", fps: 10, scale: 1 / 0.3937 });
  sure(made.report.bones.join() === "Armature,root,tip", made.report.bones.join());
  const [bend] = made.report.sequences;
  sure(bend.name === "bend" && bend.frames === 11 && !bend.loops, JSON.stringify(bend));
  sure(made.report.shared === 36 && made.warnings.some((line) => /weighs most/.test(line)), `${made.report.shared} shared`);
  for (const engine of ["goldsrc", "xash"]) sure(!smak.check(made.mdl, engine).errors.length, smak.check(made.mdl, engine).errors.join("; "));
  // at rest the upper box's top corner (1, 12, 1) of the file is (1, 1, 12) in GoldSrc's axes
  const seq = smak.sequenceAt(made.mdl, "bend");
  near(nearestCorner(made.mdl, seq, 0, [1, 1, 12]), 0, 1e-3, "frame 0: as it rests");
  // a quarter about the file's z (GoldSrc's x): (1, 2, 1) from the tip goes to (-2, 1, 1), so with the tip at
  // (0, 10, 0) it is (-2, 11, 1) of the file, (1, -2, 11) of GoldSrc
  near(nearestCorner(made.mdl, seq, 10, [1, -2, 11]), 0, 1e-2, "frame 10: turned a quarter");
  near(nearestCorner(made.mdl, seq, 10, [1, 1, 8]), 0, 1e-3, "the lower box stays where it was");
});

/** The same rig as a .glb: joints root and tip (10 above), the mesh skinned to them, a turn of tip and a step of root. */
function rigGlb() {
  const g = gltfBuilder();
  const positions = POINTS.flat();
  const indices = POLYGONS.flatMap((face) => [face[0], face[1], face[2], face[0], face[2], face[3]]);
  const POSITION = g.accessor(positions, "VEC3");
  const JOINTS_0 = g.accessor(POINTS.flatMap((_, i) => (i < 8 ? [0, 0, 0, 0] : [1, 0, 0, 0])), "VEC4", 5121);
  const WEIGHTS_0 = g.accessor(POINTS.flatMap((_, i) => (i < 8 ? [1, 0, 0, 0] : [0.7, 0.3, 0, 0])), "VEC4");
  const index = g.accessor(indices, "SCALAR", 5123);
  const binds = g.accessor([...movedBy([0, 0, 0]), ...movedBy([0, -10, 0])], "MAT4");
  const times = g.accessor([0, 1], "SCALAR");
  const s = Math.SQRT1_2;
  const turns = g.accessor([0, 0, 0, 1, 0, 0, s, s], "VEC4");
  const steps = g.accessor([0, 0, 0, 0, 0, 5], "VEC3");
  Object.assign(g.json, {
    scenes: [{ nodes: [0, 2] }],
    nodes: [
      { name: "root", children: [1] },
      { name: "tip", translation: [0, 10, 0] },
      { name: "body", mesh: 0, skin: 0 },
    ],
    skins: [{ joints: [0, 1], inverseBindMatrices: binds }],
    meshes: [{ primitives: [{ attributes: { POSITION, JOINTS_0, WEIGHTS_0 }, indices: index }] }],
    animations: [
      {
        name: "bend",
        samplers: [
          { input: times, output: turns, interpolation: "LINEAR" },
          { input: times, output: steps, interpolation: "STEP" },
        ],
        channels: [
          { sampler: 0, target: { node: 1, path: "rotation" } },
          { sampler: 1, target: { node: 0, path: "translation" } },
        ],
      },
    ],
  });
  return g.glb();
}

test("readGlb and importRigged: a skin of JOINTS_0 and WEIGHTS_0, a LINEAR turn, a STEP move", () => {
  const read = smak.readGlb(rigGlb());
  sure(read.joints.length === 2 && read.animations.length === 1, `${read.joints} ${read.animations.length}`);
  const tip = read.nodes.findIndex((node) => node.name === "tip");
  const halfway = read.animations[0].at(0.5);
  near(halfway.get(tip)[0][0], Math.SQRT1_2, 1e-6, "halfway: 45 degrees");
  near(halfway.get(0)[1][3], 0, 1e-9, "a STEP move waits for its key");
  near(read.animations[0].at(1).get(0)[2][3], 5, 1e-9, "and then jumps");
  const made = smak.importRigged(read, { name: "rig.mdl", fps: 10, scale: 1 / 39.37 });
  sure(made.report.bones.join() === "root,tip", made.report.bones.join());
  const seq = smak.sequenceAt(made.mdl, "bend");
  near(nearestCorner(made.mdl, seq, 0, [1, 1, 12]), 0, 1e-3, "frame 0: as it rests");
  // at the end the turn as in the FBX, and the whole moved 5 along glTF's z: GoldSrc's x
  near(nearestCorner(made.mdl, seq, 10, [6, -2, 11]), 0, 1e-2, "frame 10: turned and moved");
});

test("importRigged: animations chosen by the end of their names and renamed; none at all gives one still pose", () => {
  const read = smak.readFbx(rigFbx());
  const chosen = smak.importRigged(read, { name: "rig", animations: ["Bend"], names: { "Armature|Bend": "swing" } });
  sure(chosen.report.sequences.map((s) => s.name).join() === "swing" && chosen.report.name === "rig.mdl", JSON.stringify(chosen.report.sequences));
  const none = smak.importRigged(read, { name: "rig.mdl", animations: [] });
  sure(none.report.sequences.map((s) => s.name).join() === "rest", "no animation: rest");
  let said = "";
  try {
    smak.importRigged(read, { name: "rig.mdl", animations: ["run"] });
  } catch (e) {
    said = e.message;
  }
  sure(/no animation run: it has Armature\|Bend/.test(said), said);
});

test("importRigged: where its feet stand as the first animation begins, and its triangles against the game's own of its size", () => {
  const read = smak.readFbx(rigFbx());
  const feetSaid = (made) => made.warnings.find((w) => /lowest point is at z/.test(w));
  // on its own origin, the lower box's foot at 0: on the floor, nothing told
  const kept = smak.importRigged(read, { name: "rig.mdl", fit: 12 });
  near(kept.report.feet, 0, 0.05, "on its own origin");
  sure(!feetSaid(kept), kept.warnings.join(" | "));
  sure(/^Master Sword's own monsters and people of its size \(\d+ units corner to corner\) have 414 triangles at the median, three quarters under 579/.test(kept.report.kin), kept.report.kin);
  // its middle on the origin, 12 high: 6 under the floor is within; 24 high, 12 under, is told
  sure(!feetSaid(smak.importRigged(read, { name: "rig.mdl", origin: "centre", fit: 12 })), "6 under: within");
  const sunk = smak.importRigged(read, { name: "rig.mdl", origin: "centre", fit: 24 });
  sure(/at z -12: .* sink 12 into it\. Unless it flies, swims or rises out of the ground, import it with origin "base"$/.test(feetSaid(sunk)), feetSaid(sunk));
  // 72 high on its middle, as a player's model stands: said so
  const player = smak.importRigged(read, { name: "rig.mdl", origin: "centre", fit: 72 });
  sure(/at z -36: .*\(-36 is where a player's model stands/.test(feetSaid(player)), feetSaid(player));
  near(smak.importRigged(read, { name: "rig.mdl", origin: "base", fit: 72 }).report.feet, 0, 0.05, "base: on the floor");
  // over three quarters of the small creatures' 579: told, with the way down
  const heavy = { ...read, groups: read.groups.map((g) => ({ ...g, tris: Array.from({ length: 30 }, () => g.tris).flat() })) };
  const made = smak.importRigged(heavy, { name: "rig.mdl", fit: 12 });
  sure(made.warnings.some((w) => /^720 triangles, more than three quarters of Master Sword's own .*: they have 414 .* heavy for a pack of them/.test(w)), made.warnings.join(" | "));
});
