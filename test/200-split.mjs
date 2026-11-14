// A submodel over what GoldSrc holds (2048 points or normals, MAXSTUDIOVERTS) cut by buildMdl into bodyparts of their
// own, all shown by body 0 (KIT-FAULTS R7 of the rally maps: the limit was met by cutting detail by hand). A tube swept along a
// coil, on two bones, beside a cap of another texture, its body in a bodypart before a lid's: the pieces come after
// the lid, every corner keeps its point, normal, pixel and bone, and the drawing is the same to the pixel as the
// whole written in one submodel. A bodypart of two submodels is left whole, and check names its heaviest mesh.
import * as smak from "../src/index.mjs";
import { test, sure, checked } from "./helper.mjs";

const S = smak.solids;
const plain = (name, shade) => smak.indexed({ width: 16, height: 16, rgb: new Uint8Array(16 * 16 * 3).map((_, i) => (i % 7) * 20 + shade) }, name); // prettier-ignore
const coil = Array.from({ length: 90 }, (_, i) => [Math.cos(i / 6) * 20, Math.sin(i / 6) * 20, i]);
const corner = (c) => ({ p: c.p, uv: [(c.p[0] + 20) / 40, c.p[2] / 90], bone: c.p[2] > 35 ? "top" : "root" });
const tube = S.sweepTris(S.ngon(24, 2), coil).map((tri) => tri.map(corner));
const cap = S.trisOf(S.lathe(S.place([0, 0, 90], [0, 0, 1]), [[6, 0], [7, 2], [3, 6]], { n: 16 })).map((tri) => tri.map(corner)); // prettier-ignore
const body = { name: "coil", meshes: [{ tris: tube, texture: plain("coil.bmp", 60) }, { tris: cap, texture: plain("cap.bmp", 120) }] }; // prettier-ignore
const lid = { name: "lid", models: [{ name: "lid", meshes: [{ tris: cap, texture: plain("cap.bmp", 120) }] }] };
const bones = [{ name: "root", parent: -1 }, { name: "top", parent: 0, pos: [0, 0, 35] }];
const said = [];
const realWarn = console.warn;
console.warn = (line) => said.push(line);
let split;
try {
  split = smak.buildMdl({ name: "coil.mdl", bones, bodyparts: [{ name: "body", models: [body] }, lid] });
} finally {
  console.warn = realWarn;
}
// the same triangles in one submodel: a second submodel keeps buildMdl from cutting it, and body 0 shows the first
const whole = smak.buildMdl({ name: "coil.mdl", bones, bodyparts: [{ name: "body", models: [body, lid.models[0]] }, lid] }); // prettier-ignore
const info = smak.readMdl(split);

test("buildMdl: a submodel over 2048 points is cut into bodyparts after the last, and says so", () => {
  const first = smak.readMdl(whole).bodyparts[0].models[0];
  sure(first.numverts > 4096 && first.numverts < 6144, `the whole has ${first.numverts} points`);
  const names = info.bodyparts.map((part) => part.name);
  sure(names.length === 4 && names.join() === "body,lid,body2,body3", names.join());
  sure(info.bodyparts.every((part) => part.models.length === 1 && part.models[0].numverts <= 2048 && part.models[0].numnorms <= 2048), "each piece within 2048"); // prettier-ignore
  sure(said.length === 1 && /^smak: buildMdl: body\/coil: \d+ points, \d+ normals and \d+ triangles, more than a submodel holds \(2048 points and normals, MAXSTUDIOVERTS; 5461 triangles in Xash\): cut into 3, the first where it was and the rest in body2 to body3 \(bodyparts 2 to 3\), all shown by body 0; every point keeps its normal and bone$/.test(said[0]), said.join()); // prettier-ignore
  for (const engine of ["goldsrc", "xash"]) sure(!checked(split, engine).errors.length, `${engine}: ${checked(split, engine).errors}`);
});

test("buildMdl's pieces: every corner as in the whole (point, normal, pixel, bone), posed or at rest, drawn the same", () => {
  const key = (t) => t.c.map((c) => `${c.p.map((v) => v.toFixed(4))}|${c.n.map((v) => v.toFixed(4))}|${c.u},${c.v}|${c.bone}|${t.tex.name}`).join(" "); // prettier-ignore
  const rest = smak.posed(whole, { seq: null }).pose;
  const bent = rest.map((m, i) => (i === 1 ? [[0, -1, 0, m[0][3]], [1, 0, 0, m[1][3] + 4], [0, 0, 1, m[2][3]]] : m));
  for (const options of [{ seq: null }, { pose: bent }]) {
    const a = smak.posed(whole, options).tris.map(key).sort();
    const b = smak.posed(split, options).tris.map(key).sort();
    sure(a.length === b.length && a.every((k, i) => k === b[i]), `${a.length} and ${b.length} triangles, the same corners`);
  }
  const drawn = (mdl) => smak.render(mdl, { view: "side", yaw: 30, pitch: 15, width: 160, height: 160 }).rgba;
  const [a, b] = [drawn(whole), drawn(split)];
  sure(a.every((v, i) => v === b[i]), "the same pixels");
  sure(JSON.stringify(smak.attachments(split)) === JSON.stringify(smak.attachments(whole)) && info.bones.join() === "root,top", "bones kept"); // prettier-ignore
});

test("check: a submodel over 2048 in a bodypart of two is an error naming its heaviest meshes and the way out", () => {
  const [error] = checked(whole, "goldsrc").errors;
  sure(/^body\/coil: \d+ points and \d+ normals: goldsrc holds 2048 a submodel; the heaviest meshes coil\.bmp \(\d+ normals\), cap\.bmp \(\d+ normals\)\. buildMdl and importModel cut .*\(reduce\)$/.test(error), error); // prettier-ignore
});
