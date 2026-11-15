// Example 9: cutting, with the solid pack (packs/solid, docs/SOLID.md). A window frame for a station's hull, a plate
// 112 x 72 x 8 with an opening of rounded corners (radius 20), a rebate round it for the pane and rivets in a ring,
// made as one closed mesh by booleans on the kit's own solids. It needs manifold-3d (`npm install` in the kit's
// folder) and no game files:
//
//   node examples/09-cut.mjs [output folder, default out]
//
// It writes window.mdl and window.png (its sheet), and prints the triangles before and after each boolean, check's
// answer and the form. The faces a cut makes are the cutter's own surface: the cutter's texture (here bare metal)
// is what they wear. Corners with no uv are laid planar on each face's main axis (packs/solid/solid.mjs, planar).
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildMdl, check, sheet, png, solids as S, indexed, formOfMdl, judgeForm } from "../src/index.mjs";
import { minus, union, roundedRect, manifold } from "../packs/solid/solid.mjs";

// without the package: its sentence (how to install it), not a stack
await manifold().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
const OUT = process.argv[2] ?? "out";
mkdirSync(OUT, { recursive: true });

// two textures of 64 x 64: painted plate with a panel line every 16 texels, and bare metal for the cut faces
const texture = (name, rgb) => {
  const pixels = new Uint8Array(64 * 64 * 3);
  for (let i = 0; i < 64 * 64; i++) {
    const line = i % 16 === 0 || Math.floor(i / 64) % 16 === 0 ? 0.8 : 1;
    const grain = 0.92 + 0.08 * (((i * 2654435761) >>> 0) / 2 ** 32);
    for (let c = 0; c < 3; c++) pixels[i * 3 + c] = Math.round(rgb[c] * line * grain);
  }
  return indexed({ width: 64, height: 64, rgb: pixels }, name, 32);
};
const PAINT = texture("hullpaint.bmp", [120, 126, 104]);
const BARE = texture("bare.bmp", [180, 182, 186]);

// the plate stands in the (y, z) plane facing +x; a profile [a, b] drawn along x is (y = -a, z = b)
const facing = S.place([0, 0, 36], [1, 0, 0], [0, 1, 0]);
const throughX = (profile, x0, x1, texture) => ({ tris: S.extrudeTris(profile, [x0, 0, 36], [x1, 0, 36], { up: [0, 0, 1] }), texture }); // prettier-ignore
const plate = { tris: S.trisOf(S.box(facing, 112, 72, 8, { bevel: 1.5, bevelFoot: 0.5 })), texture: PAINT };
const opening = throughX(roundedRect(84, 48, 20, 6), -6, 6, BARE);
const rebate = throughX(roundedRect(92, 56, 24, 6), 1, 6, BARE); // 3 deep from the front (x = 4)
const cut = await minus(plate, opening, rebate);

// rivets: a domed head every 11 units round a ring 5 outside the rebate, each sunk 0.4 into the plate so the union closes on it
const ring = roundedRect(102, 62, 26, 8);
const rivets = [];
for (let i = 0, carried = 0; i < ring.length; i++) {
  const [a, b] = [ring[i], ring[(i + 1) % ring.length]];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (let t = carried; t < length; t += 11) {
    const [y, z] = [a[0] + ((b[0] - a[0]) * t) / length, a[1] + ((b[1] - a[1]) * t) / length];
    const head = S.lathe(S.place([4, -y, 36 + z], [1, 0, 0], [0, 0, 1]), [[1.7, -0.4], [1.7, 0.2], [1.5, 0.7], [1, 1.1], [0.3, 1.3]], { n: 8 }); // prettier-ignore
    rivets.push({ tris: S.trisOf(head), texture: BARE });
  }
  carried = (((carried - length) % 11) + 11) % 11;
}
const whole = await union(cut.meshes, ...rivets);
for (const [what, { facts }] of [["plate minus opening and rebate", cut], [`and ${rivets.length} rivets`, whole]])
  console.log(`${what}: ${facts.triangles.in} triangles in, ${facts.triangles.out} out, volume ${facts.volume.toFixed(1)}, ${facts.ms.toFixed(1)} ms`); // prettier-ignore

const mdl = buildMdl({
  name: "window.mdl",
  bodyparts: [{ name: "body", models: [{ name: "window", meshes: whole.meshes }] }],
  sequences: [{ name: "idle", fps: 10, loops: true, frames: [[[0, 0, 0, 0, 0, 0]]] }],
});
writeFileSync(join(OUT, "window.mdl"), mdl);
const view = sheet(mdl, { size: 256 });
writeFileSync(join(OUT, "window.png"), png(view.width, view.height, view.rgba));
const report = check(mdl, "goldsrc", { name: "window.mdl" });
const form = formOfMdl(mdl).measures;
console.log(
  `check: ${report.errors.length} errors, ${report.warnings.length} warnings${report.warnings.map((w) => `\n  WARN ${w}`).join("")}`,
);
console.log(`form: boxiness ${form.boxiness}, on the axes ${form.axisAligned}, bare edges ${form.sharpEdges}; ${judgeForm(form, "props").warnings.length} warnings`); // prettier-ignore
console.log(`written to ${OUT}: window.mdl, window.png`);
