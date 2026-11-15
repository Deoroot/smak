// The solid pack (packs/solid): booleans on the kit's meshes through manifold-3d, held by what does not come from the
// library: each result closed by the kit's own measure (core/solids.mjs closed), its volume the inputs' by the
// boolean's arithmetic (a box minus a prism of known section, two boxes' union and common), its box, the texture of
// each face kept (a cut's faces the cutter's), its corners' uv inside the picture, a corner's own normal carried and
// turned over where a cutter's face is turned inside out, a model built of it passing check, the same bytes twice. The
// refusals need no package: an operand that is not closed, faces inwards or hangs from two bones, and the sentence
// when the package is not installed. With no `npm install`, the cases that cut are said as skipped.
import { solids as S, buildMdl, check } from "../src/index.mjs";
import { union, minus, common, hull, planar, roundedRect, manifold } from "../packs/solid/solid.mjs";
import { test, testAsync, sure } from "./helper.mjs";

const tex = (name, side = 64) => ({ name, width: side, height: side, pixels: new Uint8Array(side * side).fill(1), palette: new Uint8Array(768).fill(200), flags: 0 }); // prettier-ignore
const AT = (x, y, z) => S.place([x, y, z], [0, 0, 1], [1, 0, 0]);
const box = (c, sx, sy, sz, t) => ({ tris: S.trisOf(S.box(AT(...c), sx, sy, sz)), texture: t });
const PLATE = tex("plate.bmp");
const BORE = tex("bore.bmp");
/** A 16-sided prism along z through the plate: its section's area is known (a polygon's), so is what it takes out. */
const bore = (n = 16, r = 5) => ({ tris: S.trisOf(S.cyl(AT(0, 0, 0), r, -5, 5, { n })), texture: BORE });
const sectionArea = (n, r) => (n * r * r * Math.sin((2 * Math.PI) / n)) / 2;
const near = (got, want, share = 1e-3) => Math.abs(got - want) <= share * Math.abs(want);
const all = (meshes) => meshes.flatMap((mesh) => mesh.tris);
const boxOf = (meshes) => {
  const points = all(meshes)
    .flat()
    .map((corner) => corner.p);
  return [0, 1, 2].map((k) => [Math.min(...points.map((p) => p[k])), Math.max(...points.map((p) => p[k]))]);
};
/** The volume the triangles close, by the divergence theorem: what is measured here, not what the library says. */
const volumeOf = (meshes) =>
  all(meshes).reduce((sum, t) => {
    const [a, b, c] = t.map((corner) => corner.p);
    return sum + (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; // prettier-ignore
  }, 0);
const said = async (run) => {
  try {
    await run();
  } catch (error) {
    return error.message;
  }
  return "nothing";
};

await testAsync(
  "the solid pack refuses, before any WASM, an operand that is not closed, faces inwards or hangs from two bones",
  "solid: refusals",
  async () => {
    const plate = box([0, 0, 0], 40, 20, 4, PLATE);
    const open = await said(() => minus({ ...plate, tris: plate.tris.slice(1) }, bore()));
    sure(/^minus: the body \(plate\.bmp\) is not closed: 3 open edges .* in 11 triangles/.test(open), open);
    const inwards = await said(() =>
      minus(plate, { ...bore(), tris: bore().tris.map(([a, b, c]) => [a, c, b]) }),
    );
    sure(/^minus: cutter 1 \(bore\.bmp\) faces inwards \(its volume is -/.test(inwards), inwards);
    const twoBones = await said(() => union(plate, { ...bore(), tris: bore().tris.map((t, k) => t.map((c) => ({ ...c, bone: k % 2 ? "a" : "b" }))) })); // prettier-ignore
    sure(/^union: solid 2 \(bore\.bmp\) hangs from 2 bones/.test(twoBones), twoBones);
    const notMesh = await said(() => union(plate.tris));
    sure(/^union: solid 1 is not a mesh: a mesh is \{ tris, texture \}/.test(notMesh), notMesh);
  },
);

await testAsync(
  "with no manifold-3d, one sentence saying how to install it (a name not there stands for the package)",
  "solid: absent",
  async () => {
    const absent = await said(() => manifold("manifold-3d-not-installed-here"));
    sure(/^packs\/solid needs manifold-3d, which is not installed: run `npm install` in the kit's folder \(.+\); it installs manifold-3d 3\.2\.1/.test(absent), absent); // prettier-ignore
  },
);

const installed = await manifold().then(
  () => true,
  (error) => error.message,
);
if (installed !== true) {
  console.log(
    `skip  the solid pack's cuts (volumes, textures, normals, a model, the same bytes)\n      skipped: ${installed}`,
  );
  await testAsync(
    "the pack's own functions answer the install sentence when the package is absent",
    "solid: absent call",
    async () => {
      const answer = await said(() => minus(box([0, 0, 0], 40, 20, 4, PLATE), bore()));
      sure(answer === installed, answer);
    },
  );
} else {
  await testAsync(
    "a box minus a prism: closed, the volume the box's less the prism's section through it, the box's own bounds, the cut's faces the cutter's",
    "solid: minus",
    async () => {
      const { meshes, facts } = await minus(box([0, 0, 0], 40, 20, 4, PLATE), bore());
      const shut = S.closed(all(meshes));
      sure(shut.closed, `open ${shut.open}, doubled ${shut.doubled}`);
      const want = 40 * 20 * 4 - sectionArea(16, 5) * 4;
      sure(near(volumeOf(meshes), want) && near(facts.volume, want), `${volumeOf(meshes)} measured, ${facts.volume} said, ${want} by arithmetic`); // prettier-ignore
      sure(
        JSON.stringify(boxOf(meshes)) ===
          JSON.stringify([
            [-20, 20],
            [-10, 10],
            [-2, 2],
          ]),
        JSON.stringify(boxOf(meshes)),
      );
      const byName = Object.fromEntries(meshes.map((mesh) => [mesh.texture.name, mesh.tris.length]));
      // the plate's 12 triangles become its top and bottom about the hole (20 each) and its four sides (8); the bore's walls 32
      sure(byName["plate.bmp"] === 48 && byName["bore.bmp"] === 32, JSON.stringify(byName));
      sure(facts.triangles.in === 12 + 60 && facts.triangles.out === 80, JSON.stringify(facts.triangles));
      for (const mesh of meshes) for (const t of mesh.tris) for (const c of t) sure(c.uv.every((v) => v >= -1e-6 && v <= 1 + 1e-6), `${mesh.texture.name}: uv ${c.uv}`); // prettier-ignore
      // every wall triangle of the bore faces into the hole (towards the bore's axis): turned inside out by the cut
      for (const t of meshes.find((mesh) => mesh.texture.name === "bore.bmp").tris) {
        const [a, b, c] = t.map((corner) => corner.p);
        const n = S.cross(S.sub(b, a), S.sub(c, a));
        const mid = S.mul(S.add(a, S.add(b, c)), 1 / 3);
        sure(n[0] * mid[0] + n[1] * mid[1] < 0, `a wall triangle at ${mid} faces out of the hole`);
      }
    },
  );

  await testAsync(
    "two boxes overlapping: their union and their common by arithmetic, each face's texture kept; the hull of two apart",
    "solid: union, common, hull",
    async () => {
      const a = box([0, 0, 0], 10, 10, 10, PLATE);
      const b = box([5, 5, 5], 10, 10, 10, BORE);
      const joined = await union(a, b);
      sure(
        S.closed(all(joined.meshes)).closed && near(volumeOf(joined.meshes), 2000 - 125),
        `union ${volumeOf(joined.meshes)}`,
      );
      // the faces of the corner each box lost are the other's: every triangle keeps the texture of the box it lies on
      for (const mesh of joined.meshes)
        for (const t of mesh.tris) {
          const mid = t.reduce((s, c) => S.add(s, S.mul(c.p, 1 / 3)), [0, 0, 0]);
          const onA = mid.every((v) => v >= -5 - 1e-6 && v <= 5 + 1e-6);
          sure(mesh.texture.name === (onA ? "plate.bmp" : "bore.bmp"), `${mesh.texture.name} at ${mid}`);
        }
      const shared = await common(a, b);
      sure(
        S.closed(all(shared.meshes)).closed && near(volumeOf(shared.meshes), 125),
        `common ${volumeOf(shared.meshes)}`,
      );
      const wrapped = await hull(box([0, 0, 0], 2, 2, 2, PLATE), box([10, 0, 0], 2, 2, 2, BORE));
      sure(near(volumeOf(wrapped.meshes), 12 * 2 * 2) && wrapped.meshes.length === 1 && wrapped.meshes[0].texture.name === "plate.bmp", `hull ${volumeOf(wrapped.meshes)}`); // prettier-ignore
    },
  );

  await testAsync(
    "a corner's own uv and normal carried through a cut, a cutter's normal turned over; a rounded slot through a plate; a model of it passes check; the same bytes twice",
    "solid: carried, built",
    async () => {
      // the plate's corners carry a uv of their own (x across the picture) and a normal up or down; the cut keeps both
      const plate = planar([box([0, 0, 0], 40, 20, 4, PLATE)])[0];
      const withN = { ...plate, tris: plate.tris.map((t) => t.map((c) => ({ ...c, uv: [(c.p[0] + 20) / 40, 0.5], n: [0, 0, Math.sign(c.p[2])] }))) }; // prettier-ignore
      const round = bore();
      const ownN = {
        ...round,
        tris: round.tris.map((t) => t.map((c) => ({ ...c, n: S.unit([c.p[0], c.p[1], 0]) }))),
      };
      const { meshes } = await minus(withN, ownN);
      const top = meshes
        .find((mesh) => mesh.texture.name === "plate.bmp")
        .tris.flat()
        .filter((c) => c.p[2] > 1.99);
      sure(
        top.every((c) => Math.abs(c.uv[0] - (c.p[0] + 20) / 40) < 1e-5 && c.n[2] === 1),
        "the plate's uv or normal not carried",
      );
      const wall = meshes.find((mesh) => mesh.texture.name === "bore.bmp").tris.flat();
      sure(
        wall.every((c) => c.n[0] * c.p[0] + c.n[1] * c.p[1] < 0),
        "a cutter's normal not turned to face into the hole",
      );
      const make = async () => {
        const slots = [-10, 0, 10].map((x) => ({ tris: S.extrudeTris(roundedRect(3, 12, 1.5), [x, 0, -5], [x, 0, 5], { up: [0, 1, 0] }), texture: BORE })); // prettier-ignore
        const cut = await minus(box([0, 0, 0], 40, 20, 4, PLATE), ...slots);
        const name = "slotted.mdl";
        return buildMdl({ name, bodyparts: [{ name: "body", models: [{ name: "slotted", meshes: cut.meshes }] }], sequences: [{ name: "idle", fps: 10, loops: true, frames: [[[0, 0, 0, 0, 0, 0]]] }], quiet: true }); // prettier-ignore
      };
      const mdl = await make();
      const report = check(mdl, "goldsrc", { name: "slotted.mdl", kind: false });
      sure(!report.errors.length, report.errors.join("; "));
      sure(
        Buffer.compare(Buffer.from(mdl), Buffer.from(await make())) === 0,
        "the same script made other bytes",
      );
    },
  );
}
