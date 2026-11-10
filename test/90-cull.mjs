// Fewer triangles for rigid pieces (make/cull.mjs): what is never seen taken out, over the poses of the animations,
// from many sides, front faces only and with a depth test; and each piece made of as few triangles as keep its
// shape within a tolerance. On a hinge of two bones, made up here: a hollow shell with a block shut inside it
// (never seen: dropped), a block outside on the swinging bone (kept whole), and a cap pressed against the shell's
// end (its face on the shell is never seen: that face goes).
import * as smak from "../src/index.mjs";
import { test, sure, near } from "./helper.mjs";

const S = smak.solids;
const plain = smak.indexed({ width: 8, height: 8, rgb: new Uint8Array(8 * 8 * 3).fill(128) }, "plain.bmp");
/** a box from a to b in model space at rest, as a solid's triangles (facing out) */
const block = (a, b) => S.trisOf(S.box(S.place(S.lerp3(a, b, 0.5), [0, 0, 1], [1, 0, 0]), b[0] - a[0], b[1] - a[1], b[2] - a[2])); // prettier-ignore
const frame = (turn) => [
  [0, 0, 0, 0, 0, 0],
  [10, 0, 0, 0, 0, turn],
];
const hinge = smak.buildMdl({
  name: "hinge.mdl",
  bones: [
    { name: "upper", parent: -1 },
    { name: "lower", parent: 0, pos: [10, 0, 0] },
  ],
  bodyparts: [{ name: "body", models: [{ name: "arm", meshes: [{ tris: block([0, -1, -1], [9, 1, 1]).map((t) => t.map((c) => ({ p: c.p, uv: [0, 0], bone: 0 }))), texture: plain }] }] }], // prettier-ignore
  sequences: [
    { name: "idle", activity: 1, frames: [frame(0)] },
    { name: "swing", frames: Array.from({ length: 11 }, (_, f) => frame((f / 10) * 1.2)) },
  ],
});
const PIECES = [
  { bone: "upper", name: "shell", tris: block([0, -3, -3], [9, 3, 3]) },
  { bone: "upper", name: "inside", tris: block([3, -1, -1], [5, 1, 1]) },
  { bone: "lower", name: "outside", tris: block([13, -1, -1], [17, 1, 1]) },
  // pressed against the shell's far end: its face at x = 0 lies on the shell's
  { bone: "upper", name: "cap", tris: block([-1, -1, -1], [0, 1, 1]) },
];
/** the triangles of a piece that face along `n` */
const facing = (tris, n) => tris.filter((t) => smak.dot(smak.cross(smak.sub(t[1].p, t[0].p), smak.sub(t[2].p, t[0].p)), n) > 0); // prettier-ignore

test("cullHidden: a piece shut inside another dropped, one outside kept whole, a face pressed on another taken out", () => {
  const done = smak.cullHidden(hinge, PIECES, { space: "rest" });
  sure(done.gone.join() === "inside", `dropped whole: ${done.gone}`);
  const by = Object.fromEntries(done.pieces.map((p) => [p.name, p]));
  sure(by.shell.tris.length === 12 && by.outside.tris.length === 12, `${by.shell.tris.length}, ${by.outside.tris.length}`);
  sure(by.cap.tris.length === 10, `the cap keeps ${by.cap.tris.length} of 12`);
  sure(!facing(by.cap.tris, [1, 0, 0]).length, "its face on the shell is gone");
  sure(done.before === 48 && done.after === 34, `${done.before} -> ${done.after}`);
  // the first idle seen closest, then the two animations at 0.3 and 0.7 of their frames
  sure(done.poses === 5, `${done.poses} poses`);
  sure(done.share[1].every((v) => v === 0) && done.share[2].every((v) => v > 0.2), "the shares seen");
  // the corners come back as given, every key of a piece kept
  sure(by.outside.tris[0] === PIECES[2].tris[0] && by.cap.name === "cap", "the pieces as given");
});

test("cullHidden: the same answer every time, poses and threshold as told, pieces of one share kept alike", () => {
  const a = smak.cullHidden(hinge, PIECES, { space: "rest" });
  const b = smak.cullHidden(hinge, PIECES, { space: "rest" });
  sure(JSON.stringify(a) === JSON.stringify(b), "deterministic");
  // nothing is seen at a threshold over one; everything that faces out at none
  sure(smak.cullHidden(hinge, PIECES, { space: "rest", keep: 1.01 }).after === 0, "keep over 1");
  sure(smak.cullHidden(hinge, PIECES, { space: "rest", keep: 0 }).after === 48, "keep 0");
  const few = smak.cullHidden(hinge, PIECES, { space: "rest", poses: [{ seq: null, views: 6, px: 0.3 }] });
  sure(few.poses === 1 && few.gone.join() === "inside", `${few.poses} pose, ${few.gone}`);
  // a cap at each end, built alike: each hides another face, and as one share both keep both
  const other = { bone: "upper", name: "cap 2", tris: block([9, -1, -1], [10, 1, 1]) };
  const two = [...PIECES, other];
  const apart = smak.cullHidden(hinge, two, { space: "rest" });
  sure(apart.pieces.find((p) => p.name === "cap 2").tris.length === 10, "the other cap alone");
  const shared = smak.cullHidden(hinge, two.map((p) => (/cap/.test(p.name) ? { ...p, share: "cap" } : p)), { space: "rest" }); // prettier-ignore
  sure(shared.pieces.filter((p) => /cap/.test(p.name)).every((p) => p.tris.length === 12), "one share: kept alike");
  // the pieces in their bones' space give the same
  const inv = smak.restPose(hinge).map(smak.inverse34);
  const onBones = PIECES.map((p) => {
    const bone = p.bone === "upper" ? 0 : 1;
    return { ...p, bone, tris: p.tris.map((t) => t.map((c) => ({ p: smak.apply34(inv[bone], c.p) }))) };
  });
  const there = smak.cullHidden(hinge, onBones);
  sure(there.after === a.after && there.gone.join() === a.gone.join(), `${there.after}, ${there.gone}`);
});

test("triangleVisibility: the area each triangle wins and could, over the views of each pose", () => {
  const v = smak.triangleVisibility(hinge, PIECES, { poses: [{ seq: "idle", frame: 0 }], views: 30, space: "rest" });
  sure(v.sign === 1, "the pieces face out counter-clockwise");
  sure(v.seen[1].every((s) => s === 0) && v.could[1].some((c) => c > 0), "the piece inside: could, never won");
  // the shell alone, nothing in front of it: it wins about all it could (pixels against exact areas)
  const alone = smak.triangleVisibility(hinge, PIECES.slice(0, 1), { poses: [{ seq: "idle", frame: 0 }], views: 30, space: "rest" }); // prettier-ignore
  const sum = (list) => list.reduce((a, b) => a + b, 0);
  near(sum(alone.seen[0]) / sum(alone.could[0]), 1, 0.03, "the shell alone, won against could");
  // a face of the shell, 9 by 6, seen whole from straight on: about its area once a view it faces
  const views = smak.sphereViews(30);
  sure(views.length === 30 && views.every((d) => Math.abs(Math.hypot(...d) - 1) < 1e-9), "unit directions");
  const top = PIECES[0].tris.map((t, k) => k).filter((k) => facing([PIECES[0].tris[k]], [0, 0, 1]).length);
  const face = top.reduce((s, k) => s + v.could[0][k], 0);
  const expect = views.reduce((s, d) => s + Math.max(0, d[2]) * 54, 0);
  near(face / expect, 1, 0.05, "the shell's top, its area times its cosine to each view");
});

/** a ball of rings (a smooth shape: reduction keeps it within a tolerance) */
const sphere = (r, rings, sides) =>
  S.trisOf(
    S.loft(
      S.place([0, 0, 0], [0, 0, 1]),
      Array.from({ length: rings }, (_, i) => {
        const a = -Math.PI / 2 + (Math.PI * (i + 1)) / (rings + 1);
        return { z: r * Math.sin(a), poly: S.ngon(sides, r * Math.cos(a)) };
      }),
    ),
  );
/** a box of 6 by 6 squares a side: flat faces, far more triangles than its shape needs */
const fineBox = (n = 6, s = 4) => {
  const out = [];
  const faces = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ]; // prettier-ignore
  for (const [nrm, u, v] of faces) {
    const at = (i, j) => [0, 1, 2].map((a) => (nrm[a] * s) / 2 + u[a] * (s * (i / n - 0.5)) + v[a] * (s * (j / n - 0.5)));
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        out.push([{ p: at(i, j) }, { p: at(i + 1, j) }, { p: at(i + 1, j + 1) }]);
        out.push([{ p: at(i, j) }, { p: at(i + 1, j + 1) }, { p: at(i, j + 1) }]);
      }
  }
  return out;
};

test("reduceWithin and reducePieces: fewer triangles, no point of either shape further than the tolerance", () => {
  const box = fineBox();
  const lighter = smak.reduceWithin(box, { tol: 0.01 });
  sure(lighter.length < box.length * 0.4, `${box.length} -> ${lighter.length}`);
  sure(smak.shapeDeviation(box, lighter) <= 0.01, `off by ${smak.shapeDeviation(box, lighter)}`);
  const ball = sphere(3, 9, 16);
  const tight = smak.reduceWithin(ball, { tol: 1e-4 });
  sure(tight === ball, "nothing fits so tight a tolerance: the triangles as given");
  for (const tol of [0.1, 0.2]) {
    const made = smak.reduceWithin(ball, { tol });
    sure(made.length < ball.length, `${tol}: ${ball.length} -> ${made.length}`);
    sure(smak.shapeDeviation(ball, made) <= tol, `${tol}: off by ${smak.shapeDeviation(ball, made)}`);
  }
  near(smak.shapeDeviation(block([0, 0, 0], [1, 1, 1]), block([0, 0, 0], [1, 1, 1.5])), 0.5, 1e-9, "a block half a unit taller"); // prettier-ignore
  const all = smak.reducePieces([{ name: "box", bone: 0, tris: box }, { name: "ball", bone: 1, tris: ball }], { tol: 0.1 }); // prettier-ignore
  sure(all.reduced.join() === "0,1" && all.before === box.length + ball.length && all.after < all.before, JSON.stringify(all.reduced)); // prettier-ignore
  sure(all.pieces[1].name === "ball" && all.pieces[1].bone === 1, "every key kept");
  const again = smak.reducePieces([{ name: "box", bone: 0, tris: box }, { name: "ball", bone: 1, tris: ball }], { tol: 0.1 }); // prettier-ignore
  sure(JSON.stringify(again) === JSON.stringify(all), "the same every time");
});
