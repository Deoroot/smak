// glTF read (core/glb.mjs): a .glb written here from nothing, read back: indexed triangles, texture coordinates
// as they are (glTF counts from the top), a node turned under a parent that is moved, a picture inside the file,
// strips and fans; and the same scene as a .gltf with its .bin given beside it.
import * as smak from "../src/index.mjs";
import { test, sure, near } from "./helper.mjs";
import { gltfBuilder, CUBE_POINTS, CUBE_FACES } from "./fixture-import.mjs";

/** A picture of 4x4 as a PNG: red on its top row, grey below. */
const picture = (() => {
  const rgba = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; i++) rgba.set(i < 4 ? [255, 0, 0, 255] : [128, 128, 128, 255], i * 4);
  return smak.png(4, 4, rgba);
})();

/**
 * A cube (24 points: each face its own four, with its texture coordinates) on a node turned a quarter about
 * +y (glTF's up), under a node moved 3 along +x; two materials, the first with the picture inside the file.
 */
function cubeScene() {
  const g = gltfBuilder();
  const positions = [];
  const uvs = [];
  const indices = [];
  CUBE_FACES.forEach((face, n) => {
    face.forEach((point) => positions.push(...CUBE_POINTS[point]));
    uvs.push(0, 1, 1, 1, 1, 0, 0, 0);
    indices.push(n * 4, n * 4 + 1, n * 4 + 2, n * 4, n * 4 + 2, n * 4 + 3);
  });
  const POSITION = g.accessor(positions, "VEC3");
  const TEXCOORD_0 = g.accessor(uvs, "VEC2");
  const sides = g.accessor(indices.slice(12), "SCALAR", 5123);
  const ends = g.accessor(indices.slice(0, 12), "SCALAR", 5125);
  const image = g.image(picture, "image/png");
  Object.assign(g.json, {
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "holder", translation: [3, 0, 0], children: [1] },
      { name: "cube", mesh: 0, rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] },
      { name: "unseen", mesh: 0, translation: [100, 0, 0] },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION, TEXCOORD_0 }, indices: sides, material: 0 }, { attributes: { POSITION, TEXCOORD_0 }, indices: ends, material: 1 }] }],
    materials: [
      { name: "painted", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: [1, 1, 1, 1] } },
      { name: "plain", pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.6, 1] } },
    ],
    textures: [{ source: image }],
  });
  return g;
}

test("readGlb: a .glb's indexed triangles, a node turned under one moved, only what the scene shows", () => {
  const read = smak.readGlb(cubeScene().glb());
  sure(read.format === "glb" && read.binary && read.version === "2.0", `${read.format} ${read.version}`);
  const triangles = read.groups.reduce((sum, group) => sum + group.tris.length, 0);
  sure(triangles === 12, `${triangles} triangles (the node outside the scene is not read)`);
  // the cube turned about glTF's y and moved 3 along its x: x from 2 to 4; stood up, glTF's x is GoldSrc's y
  near(read.box.mn[1], 2, 1e-6, "the least y");
  near(read.box.mx[1], 4, 1e-6, "the most y");
  near(read.box.mx[2], 1, 1e-6, "up is up");
  sure(read.unit.metres === 1 && read.axes.up === "+y", JSON.stringify(read.unit));
  // the turn: the point (1, -1, -1) of the cube goes to (-1, -1, -1) by a quarter about +y, then x + 3
  const all = read.groups.flatMap((group) => group.tris.flat());
  sure(all.some((corner) => Math.hypot(corner.p[0] - -1, corner.p[1] - 2, corner.p[2] - -1) < 1e-6), "the turned point");
  const u = (tri) => [tri[1].p.map((v, a) => v - tri[0].p[a]), tri[2].p.map((v, a) => v - tri[0].p[a])];
  const outward = read.groups.every((group) =>
    group.tris.every((tri) => {
      const [p, q] = u(tri);
      const f = [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
      const m = [0, 1, 2].map((a) => (tri[0].p[a] + tri[1].p[a] + tri[2].p[a]) / 3 - [0, 3, 0][a]);
      return f[0] * m[0] + f[1] * m[1] + f[2] * m[2] > 0;
    }),
  );
  sure(outward, "every triangle faces out of the cube");
});

test("readGlb: texture coordinates as glTF has them (from the top), and the picture inside the file taken out", () => {
  const read = smak.readGlb(cubeScene().glb());
  const painted = read.groups.find((group) => group.material === "painted");
  sure(painted.tris.length === 8, `${painted.tris.length} triangles wear the picture`);
  sure(painted.tris[0][0].uv.join() === "0,1" && painted.tris[0][0].uv.given, `uv ${painted.tris[0][0].uv}`);
  const material = read.materials.find((each) => each.name === "painted");
  sure(material.image === 0 && read.images[0].mime === "image/png", JSON.stringify(material));
  sure(Buffer.from(read.images[0].bytes).equals(picture), "the picture's bytes, as they were");
  sure(read.materials.find((each) => each.name === "plain").colour.map((v) => +v.toFixed(3)).join() === "0.2,0.4,0.6", "a colour");
});

test("readGlb: a .gltf names its .bin, given as a resource; a strip and a fan are cut into triangles", () => {
  const g = cubeScene();
  const text = Buffer.from(g.gltf("cube.bin"));
  const read = smak.readGlb(text, { resources: { "cube.bin": g.bin() } });
  sure(read.format === "gltf" && !read.binary, read.format);
  sure(read.groups.reduce((sum, group) => sum + group.tris.length, 0) === 12, "the same twelve");
  // the same through a function of the name
  const again = smak.readGlb(text, { resources: (name) => (name === "cube.bin" ? g.bin() : null) });
  sure(again.box.mx[1] === read.box.mx[1], "by a function");

  const strip = gltfBuilder();
  const POSITION = strip.accessor([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 2, 0], "VEC3");
  Object.assign(strip.json, {
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION }, mode: 5 }, { attributes: { POSITION }, mode: 6 }] }],
  });
  const both = smak.readGlb(strip.glb());
  sure(both.groups[0].tris.length === 6, `strip of five: 3, fan of five: 3; got ${both.groups[0].tris.length}`);
  // every triangle of the strip faces the same way: glTF's +z, which is GoldSrc's +x
  const faces = both.groups[0].tris.slice(0, 3).map((tri) => {
    const [a, b, c] = tri.map((corner) => corner.p);
    const p = b.map((v, i) => v - a[i]);
    const q = c.map((v, i) => v - a[i]);
    return p[1] * q[2] - p[2] * q[1];
  });
  sure(faces.every((x) => x > 0), `the strip's facings along x: ${faces}`);
});

test("readGlb: whole numbers made 0..1 (normalized texture coordinates), and a sparse accessor", () => {
  const g = gltfBuilder();
  const POSITION = g.accessor([0, 0, 0, 1, 0, 0, 0, 1, 0], "VEC3");
  const TEXCOORD_0 = g.accessor([0, 0, 255, 0, 0, 255], "VEC2", 5121);
  g.json.accessors[TEXCOORD_0].normalized = true;
  // the third point moved to (0, 0, 7) by a sparse entry
  const which = g.accessor([2], "SCALAR", 5125);
  const value = g.accessor([0, 0, 7], "VEC3");
  g.json.accessors[POSITION].sparse = {
    count: 1,
    indices: { bufferView: g.json.accessors[which].bufferView, componentType: 5125 },
    values: { bufferView: g.json.accessors[value].bufferView },
  };
  Object.assign(g.json, { nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION, TEXCOORD_0 } }] }] });
  const read = smak.readGlb(g.glb());
  const tri = read.groups[0].tris[0];
  sure(tri[1].uv[0] === 1 && tri[2].uv[1] === 1, `uvs ${tri.map((c) => c.uv).join(" ")}`);
  near(read.box.mx[0], 7, 1e-6, "the sparse point, glTF's z = 7, is GoldSrc's x");
});
