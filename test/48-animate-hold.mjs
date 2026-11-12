// What a hand holds, and the ground (make/animate.mjs): `reach` turning the hand so that a held thing points
// along a direction (`aim`) and putting its grip at the place (`grip`); `hold` keeping a bone at a turn of its
// own in the model (a lantern that hangs straight); the quaternion helpers; `grounded` lifting a fall onto
// the floor. And `render`'s yaw with a named view.
//
// The arm's bones are turned at rest every which way, so that nothing here holds only for bones whose own
// axes are the model's.
import * as smak from "../src/index.mjs";
import { rigOf, poseOf, worldOf, reach, hold, grounded, qturn, qmul, qconj, qofAngles, anglesOf, qframes, qabout, degreesOf, turnOf } from "../make/animate.mjs"; // prettier-ignore
import { test, sure, near } from "./helper.mjs";

const bones = [
  { name: "pelvis", parent: -1, pos: [0, 0, 40] },
  { name: "arm", parent: 0, pos: [0, 8, 10], rot: [0.3, 0.5, -0.2] },
  { name: "fore", parent: 1, pos: [14, 0, 0], rot: [0, -0.4, 0.2] },
  { name: "hand", parent: 2, pos: [12, 0, 0], rot: [0.1, 0, 0.4] },
  { name: "lamp", parent: 3, pos: [2, 0, 0], rot: [0.7, 0.2, 0] },
];
const rig = rigOf(bones);
const ARM = ["arm", "fore", "hand"];
const HAND = rig.index("hand");
const unit = (v) => v.map((x) => x / Math.hypot(...v));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Where a direction that lies along `axis` at rest points now, carried by the bone `i` of a pose. */
const carried = (pose, i, axis) => qturn(qmul(worldOf(rig, pose)[i].q, qconj(rig.world[i])), axis);
const nearPlace = (a, b, tolerance, what) => a.forEach((v, k) => near(v, b[k], tolerance, `${what} ${"xyz"[k]}`));

test("reach with aim: the held thing's axis points where it is told, its edge turned about it as told", () => {
  const to = [15, 10, 45];
  const dir = unit([0.3, -0.2, 0.9]);
  const pointed = reach(rig, rig.rest, { bones: ARM, to, aim: { axis: [1, 0, 0], dir } });
  sure(pointed.reached, "the hand reaches");
  nearPlace(worldOf(rig, pointed)[HAND].p, to, 1e-6, "the hand at its place");
  nearPlace(carried(pointed, HAND, [1, 0, 0]), dir, 1e-9, "the axis along dir");
  const edged = reach(rig, rig.rest, { bones: ARM, to, aim: { axis: [1, 0, 0], dir, edge: [0, 0, 1], edgeDir: [1, 0, 0] } });
  nearPlace(carried(edged, HAND, [1, 0, 0]), dir, 1e-9, "with an edge, the axis still along dir");
  const edge = carried(edged, HAND, [0, 0, 1]);
  const square = unit([1, 0, 0].map((v, k) => v - dir[k] * dir[0]));
  nearPlace(edge, square, 1e-9, "the edge as near [1, 0, 0] as it goes, square to the axis");
  const refused = (() => {
    try {
      reach(rig, rig.rest, { bones: ARM, to, aim: { axis: [1, 0, 0], dir, edge: [0, 0, 1] } });
    } catch (e) {
      return /aim.edge and aim.edgeDir go together/.test(e.message);
    }
    return false;
  })();
  sure(refused, "an edge with no edgeDir");
});

test("reach with grip: the grip, not the wrist, is at the place, as the hand is turned", () => {
  const rest = worldOf(rig, rig.rest)[HAND].p;
  const grip = [rest[0] + 3, rest[1], rest[2] - 1];
  const to = [14, 12, 46];
  const dir = unit([0.5, 0.1, 0.8]);
  const made = reach(rig, rig.rest, { bones: ARM, to, grip, aim: { axis: [1, 0, 0], dir, edge: [0, 1, 0], edgeDir: [0, 1, 0] } });
  const w = worldOf(rig, made)[HAND];
  const gripNow = w.p.map((v, k) => v + qturn(qmul(w.q, qconj(rig.world[HAND])), grip.map((g, a) => g - rest[a]))[k]);
  nearPlace(gripNow, to, 1e-6, "the grip at its place");
  nearPlace(carried(made, HAND, [1, 0, 0]), dir, 1e-9, "and the axis along dir");
});

test("hold: a bone kept at a turn of its own in the model, whatever its parents do; the quaternion helpers", () => {
  const swung = poseOf(rig, { arm: { turn: { y: -60, x: 20 } }, hand: { turn: { z: 45 } } });
  const kept = hold(rig, swung, "lamp");
  near(degreesOf(qmul(worldOf(rig, kept)[rig.index("lamp")].q, qconj(rig.world[rig.index("lamp")]))), 0, 1e-6, "as at rest");
  nearPlace(worldOf(rig, kept)[rig.index("lamp")].p, worldOf(rig, swung)[rig.index("lamp")].p, 1e-9, "where its parent carries it");
  const tilted = hold(rig, swung, "lamp", { y: 30 });
  near(degreesOf(qmul(worldOf(rig, tilted)[rig.index("lamp")].q, qconj(rig.world[rig.index("lamp")]))), 30, 1e-6, "turned 30 from rest");
  const given = qabout([0, 0, 1], Math.PI / 2);
  near(degreesOf(qmul(worldOf(rig, hold(rig, swung, "lamp", { q: given }))[rig.index("lamp")].q, qconj(given))), 0, 1e-6, "a whole turn given");
  // the helpers: the engine's angles there and back, a pair of directions onto another, a turn as poseOf says it
  const angles = [0.3, -0.7, 1.2];
  nearPlace(anglesOf(qofAngles(angles)), angles, 1e-9, "angles there and back");
  const q = qframes([1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0]);
  nearPlace(qturn(q, [1, 0, 0]), [0, 0, 1], 1e-9, "d onto D");
  nearPlace(qturn(q, [0, 1, 0]), [1, 0, 0], 1e-9, "e onto E");
  near(degreesOf(turnOf({ z: 90 })), 90, 1e-9, "turnOf");
  sure(dot(qturn(turnOf({ z: 90 }), [1, 0, 0]), [0, 1, 0]) > 0.999, "z 90 takes +x to +y");
});

test("grounded: a frame under the floor lifted onto it by the root; one above it lowered only with touch", () => {
  const tex = smak.indexed({ width: 8, height: 8, rgb: new Uint8Array(192).fill(90) }, "box.bmp");
  const tris = [[[0, 0, 0], [4, 0, 0], [4, 0, 4]], [[0, 0, 0], [4, 0, 4], [0, 0, 4]]].map((t) => t.map((p) => ({ p, uv: [p[0] / 4, p[2] / 4], bone: 1 })));
  const two = [{ name: "root", parent: -1, pos: [0, 0, 0] }, { name: "body", parent: 0, pos: [0, 0, 0] }];
  const frame = (z) => [[0, 0, z, 0, 0, 0], [0, 0, 0, 0, 0, 0]];
  const mdl = smak.buildMdl({
    name: "fall.mdl",
    bones: two,
    bodyparts: [{ name: "body", models: [{ name: "box", meshes: [{ tris, texture: tex }] }] }],
    sequences: [{ name: "idle", fps: 10, frames: [frame(0)] }, { name: "fall", fps: 10, frames: [frame(0), frame(-3), frame(2)] }],
  });
  const low = (m, f) => Math.min(...smak.posed(m, { seq: "fall", frame: f }).tris.flatMap((t) => t.c.map((c) => c.p[2])));
  const lifted = grounded(mdl, { seqs: ["fall"] });
  sure(lifted.lifted.fall.join() === "0,3,0", lifted.lifted.fall.join());
  near(low(lifted.mdl, 1), 0, 1e-3, "frame 1 on the floor");
  near(low(lifted.mdl, 2), 2, 1e-3, "frame 2 left floating");
  sure(lifted.frames.fall[1][0][2] === 0, "the frames handed back, lifted");
  const touched = grounded(mdl, { seqs: ["fall"], touch: true });
  near(low(touched.mdl, 2), 0, 1e-3, "with touch, frame 2 lowered onto it");
  sure(smak.readSequence(touched.mdl, "idle").frames.length === 1 && smak.sequences(touched.mdl).length === 2, "nothing else changed");
});

test("render: a yaw given with a named view turns the camera on from there", () => {
  const tex = smak.indexed({ width: 8, height: 8, rgb: new Uint8Array(192).fill(150) }, "wedge.bmp");
  const P = [[0, 0, 0], [6, 0, 0], [0, 3, 0], [0, 0, 8]];
  const faces = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
  const mdl = smak.buildMdl({ name: "wedge.mdl", bodyparts: [{ name: "b", models: [{ name: "w", meshes: [{ tris: faces.map((f) => f.map((i) => ({ p: P[i], uv: [0, 0] }))), texture: tex }] }] }] });
  const same = (a, b) => Buffer.from(a.rgba).equals(Buffer.from(b.rgba));
  const pic = (o) => smak.render(mdl, { width: 64, height: 64, ...o });
  sure(same(pic({ view: "front", yaw: 90 }), pic({ view: "side" })), "front turned 90 is the side");
  sure(!same(pic({ view: "front", yaw: 205 }), pic({ view: "front", yaw: 25 })), "205 is not 25");
  sure(same(pic({ view: "front", yaw: 205 }), pic({ view: "orbit", yaw: 205, pitch: 0 })), "front at 205 is the orbit at 205, level");
});
