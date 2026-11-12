// A view model made from nothing, for the game's eye (check/screen.mjs): a forearm on a root at the eye, a tube 14 long
// and 4 thick open at its elbow's end (as a view model's arm is modelled to the elbow and cut there), and an animation
// "swing" of 7 frames. At rest the arm lies low and to the right, its open end behind the eye: what the screen shows is
// clean. `viewModel(way)` spoils it one way: "cover" brings a fist of a box up before the eye, "open" turns the open end
// to the eye in the middle of the screen, "near" pulls the arm through the near plane where the screen shows it.
import * as smak from "../src/index.mjs";

const S = smak.solids;
const plain = smak.indexed({ width: 8, height: 8, rgb: new Uint8Array(8 * 8 * 3).fill(150) }, "plain.bmp");
/** Where the forearm's bone is at rest: its open end there, the tube running 14 forward from it. */
const REST = [-2, -7, -9];
const LONG = 14;
const THICK = 4;

/** The tube about the forearm at rest, its end at the bone's place left open (unless `closed`). */
function tube(closed = false) {
  const centre = [REST[0] + LONG / 2, REST[1], REST[2]];
  const tris = S.trisOf(S.box(S.place(centre, [0, 0, 1], [1, 0, 0]), LONG, THICK, THICK));
  const kept = closed ? tris : tris.filter((t) => !t.every((c) => Math.abs(c.p[0] - REST[0]) < 1e-6));
  return kept.map((t) => t.map((c) => ({ p: c.p, uv: [0, 0], bone: 1 })));
}
/** A box on the root, `size` big, its middle at `at`: a fist before the eye. */
const fist = (at, size) => S.trisOf(S.box(S.place(at, [0, 0, 1], [1, 0, 0]), size, size, size)).map((t) => t.map((c) => ({ p: c.p, uv: [0, 0], bone: 0 }))); // prettier-ignore

/** The poses the forearm goes through (its place; the root stays at the eye), each way's last frames held there. */
const PLACES = {
  clean: [REST, [-1, -7, -9], [0, -7.5, -9], [-1, -7, -9], REST, REST, REST],
  open: [REST, [3, -5, -6], [8, -2, -2], [10, 0, -2], [10, 0, -2], [6, -4, -5], REST],
  near: [REST, [-1, -4, -5], [0, -1, -2.5], [0, 0, -2], [0, -1, -2.5], [-1, -4, -5], REST],
};

/** The clean view model, or one spoiled `way`: { mdl }. */
export function viewModel(way = "clean") {
  const places = PLACES[way] ?? PLACES.clean;
  const frames = places.map((p) => [
    [0, 0, 0, 0, 0, 0],
    [p[0], p[1], p[2], 0, 0, 0],
  ]);
  const meshes = [{ tris: tube(), texture: plain }];
  if (way === "cover") meshes.push({ tris: fist([14.5, 0, -1], 12), texture: plain });
  const mdl = smak.buildMdl({
    name: "v_test.mdl",
    bones: [
      { name: "root", parent: -1, pos: [0, 0, 0] },
      { name: "forearm", parent: 0, pos: REST },
    ],
    bodyparts: [{ name: "arms", models: [{ name: "arms", meshes }] }],
    sequences: [{ name: "swing", fps: 30, loops: false, frames }],
  });
  return { mdl };
}
