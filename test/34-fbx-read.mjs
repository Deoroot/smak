// FBX read (core/fbx.mjs): a scene written here from nothing in the binary form (32 and 64 bit records, an array
// packed with zlib) and in the text form, read back: its polygons cut into triangles, texture coordinates turned
// to count from the top, each node's place through its parent, the axes and units the file says, materials.
import * as smak from "../src/index.mjs";
import { test, sure, near } from "./helper.mjs";
import {
  I,
  L,
  S,
  record,
  properties,
  P,
  fbxBinary,
  fbxText,
  globalSettings,
  model,
  geometry,
  material,
  texture,
  connections,
  objects,
  CUBE_POINTS,
  CUBE_FACES,
} from "./fixture-import.mjs";

// ── the scene: a cube under a node that is moved and made twice as large; the cube itself moved and turned
// a quarter about the file's up (+y). Its four sides wear the material "red", its top and bottom "blue"
const QUAD_UV = [0, 0, 1, 0, 1, 1, 0, 1];
const cubeGeometry = (id, packed) =>
  geometry(id, "cube", {
    points: CUBE_POINTS,
    polygons: CUBE_FACES,
    packed,
    uv: { values: QUAD_UV, index: CUBE_FACES.flatMap(() => [0, 1, 2, 3]) },
    // each corner the normal of its face: the cross of two of its edges, made one long
    normals: {
      values: CUBE_FACES.flatMap((face) => {
        const [a, b, c] = face.map((i) => CUBE_POINTS[i]);
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const length = Math.hypot(...n);
        return face.flatMap(() => n.map((t) => t / length));
      }),
    },
    materials: [1, 1, 0, 0, 0, 0],
  });
const scene = (packed = true) => [
  globalSettings({ up: [1, 1], front: [2, 1], unit: 1 }),
  objects(
    model(10, "base", "Null", [["Lcl Translation", 0, 10, 0], ["Lcl Scaling", 2, 2, 2]]),
    model(11, "cube", "Mesh", [["Lcl Translation", 5, 0, 0], ["Lcl Rotation", 0, 90, 0]]),
    cubeGeometry(12, packed),
    material(13, "red", [1, 0, 0]),
    material(14, "blue", [0, 0, 1]),
    texture(15, "redpicture", "C:\\somewhere\\red.png"),
  ),
  connections([10, 0], [11, 10], [12, 11], [13, 11], [14, 11], [15, 13, "DiffuseColor"]),
];

/** The middle of a triangle, and which way it faces (not made one long). */
const middle = (tri) => [0, 1, 2].map((a) => (tri[0].p[a] + tri[1].p[a] + tri[2].p[a]) / 3);
const facing = (tri) => {
  const [a, b, c] = tri.map((corner) => corner.p);
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
};
/** Every triangle of a closed shape about `centre` faces away from it (counter-clockwise seen from outside). */
const facesOut = (groups, centre) =>
  groups.every((group) =>
    group.tris.every((tri) => {
      const m = middle(tri);
      const f = facing(tri);
      return f[0] * (m[0] - centre[0]) + f[1] * (m[1] - centre[1]) + f[2] * (m[2] - centre[2]) > 0;
    }),
  );

test("readFbx: a binary FBX's cube, its quads cut in two, each material a group, its parent's place applied", () => {
  const read = smak.readFbx(fbxBinary(scene()));
  sure(read.format === "fbx" && read.version === 7400 && read.binary, `${read.format} ${read.version}`);
  const triangles = read.groups.reduce((sum, group) => sum + group.tris.length, 0);
  sure(triangles === 12, `${triangles} triangles`);
  const red = read.groups.find((group) => group.material === "red");
  const blue = read.groups.find((group) => group.material === "blue");
  sure(red?.tris.length === 8 && blue?.tris.length === 4, `red ${red?.tris.length}, blue ${blue?.tris.length}`);
  // world: T(0,10,0) S(2) T(5,0,0) Ry(90) p, then the file's +y up and +z front stood as GoldSrc's +z and +x
  [[-2, 2], [8, 12], [8, 12]].forEach(([least, most], a) => {
    near(read.box.mn[a], least, 1e-9, `the box's least ${"xyz"[a]}`);
    near(read.box.mx[a], most, 1e-9, `the box's most ${"xyz"[a]}`);
  });
  // the cube's point (1, -1, -1): turned to (-1, -1, -1), moved to (4, -1, -1), doubled, moved up: (8, 8, -2)
  // in the file, so (-2, 8, 8) in GoldSrc's axes
  const all = read.groups.flatMap((group) => group.tris.flat());
  sure(all.some((corner) => Math.hypot(corner.p[0] + 2, corner.p[1] - 8, corner.p[2] - 8) < 1e-9), "the point (-2, 8, 8)");
  sure(facesOut(read.groups, [0, 10, 10]), "every triangle faces out of the cube");
  sure(read.unit.metres === 0.01 && read.axes.up === "+y" && read.axes.front === "+z", JSON.stringify([read.unit, read.axes]));
});

test("readFbx: texture coordinates by corner through an index, counted from the picture's top; normals turned with the node", () => {
  const read = smak.readFbx(fbxBinary(scene()));
  const red = read.groups.find((group) => group.material === "red");
  // the first quad of red is CUBE_FACES[2]: its first corner wears (0, 0) of the file, the picture's bottom left
  const first = red.tris[0][0];
  sure(first.uv[0] === 0 && first.uv[1] === 1 && first.uv.given, `the first corner's uv ${first.uv}`);
  const uvs = new Set(red.tris.flat().map((corner) => corner.uv.join()));
  sure(["0,1", "1,1", "1,0", "0,0"].every((uv) => uvs.has(uv)) && uvs.size === 4, [...uvs].join(" "));
  // a corner's normal looks the way its triangle faces, after the turn of its node
  for (const tri of read.groups.flatMap((group) => group.tris)) {
    const f = facing(tri);
    const length = Math.hypot(...f);
    for (const corner of tri)
      near(corner.n[0] * f[0] + corner.n[1] * f[1] + corner.n[2] * f[2], length, 1e-9, "a normal along its face");
  }
  sure(red.tris[0].every((corner) => corner.group?.startsWith("n")), "the file's normals mark the creases");
});

test("readFbx: materials with their colours and the picture joined to their colour; meshes and nodes listed", () => {
  const read = smak.readFbx(fbxBinary(scene()));
  const red = read.materials.find((each) => each.name === "red");
  sure(red.picture === "C:\\somewhere\\red.png" && red.colour.join() === "1,0,0", JSON.stringify(red));
  sure(read.materials.find((each) => each.name === "blue").picture === null, "blue names no picture");
  sure(read.meshes.length === 1 && read.meshes[0].triangles === 12 && read.meshes[0].points === 8, JSON.stringify(read.meshes));
  sure(read.nodes.map((node) => `${node.name}:${node.parent}`).join() === "base:-1,cube:0", JSON.stringify(read.nodes.map((n) => n.name)));
  sure(read.groups.every((group) => group.tris.flat().every((corner) => corner.node === 1)), "each corner hangs from the cube's node");
});

test("readFbx: 64 bit records (7.5), arrays not packed, and the text form give the same scene", () => {
  const binary = smak.readFbx(fbxBinary(scene()));
  const wide = smak.readFbx(fbxBinary(scene(false), 7500));
  const text = smak.readFbx(Buffer.from(fbxText(scene())));
  sure(wide.version === 7500 && text.binary === false, `${wide.version} ${text.binary}`);
  const corners = (read) => JSON.stringify(read.groups.map((group) => [group.material, group.tris.map((tri) => tri.map((c) => [c.p.map((v) => +v.toFixed(9)), c.uv]))]));
  sure(corners(wide) === corners(binary), "7500 against 7400");
  sure(corners(text) === corners(binary), "the text form against the binary");
  sure(text.materials.find((each) => each.name === "red").picture === "C:\\somewhere\\red.png", "a text file's picture");
});

test("readFbx: a polygon of five corners is a fan of three; one written with a negative end alone is one triangle", () => {
  const pentagon = [[0, 0, 0], [2, 0, 0], [3, 1, 0], [1, 2, 0], [-1, 1, 0], [0, 0, 5]];
  const records = [
    globalSettings({ up: [2, 1], front: [1, -1] }),
    objects(model(1, "flat", "Mesh"), geometry(2, "flat", { points: pentagon, polygons: [[0, 1, 2, 3, 4], [0, 5, 1]] })),
    connections([1, 0], [2, 1]),
  ];
  const read = smak.readFbx(fbxBinary(records));
  const tris = read.groups.flatMap((group) => group.tris);
  sure(tris.length === 4, `${tris.length} triangles`);
  sure(tris.every((tri) => tri.every((corner) => corner.uv.given === false)), "no texture coordinates: none given");
  sure(read.groups[0].material === "", "no material: the faces without one");
  // up +z and front -y: GoldSrc's x is the file's -y, its y the file's x
  sure(read.axes.up === "+z" && read.axes.front === "-y", JSON.stringify(read.axes));
  near(read.box.mx[0], 0, 1e-12, "the file's y = 0 at the most is x = 0");
  near(read.box.mn[0], -2, 1e-12, "the file's y = 2 is x = -2");
  near(read.box.mx[2], 5, 1e-12, "up is up");
});

test("readFbx: a node that mirrors (a scale under 0) has its faces turned back the right way round", () => {
  const records = [
    globalSettings(),
    objects(
      model(1, "mirrored", "Mesh", [["Lcl Scaling", -1, 1, 1], ["RotationOrder", 4], ["PreRotation", 0, 0, 30]]),
      geometry(2, "cube", { points: CUBE_POINTS, polygons: CUBE_FACES }),
    ),
    connections([1, 0], [2, 1]),
  ];
  const read = smak.readFbx(fbxBinary(records));
  sure(facesOut(read.groups, [0, 0, 0]), "every triangle still faces out");
  // a turn before the node's own (PreRotation 30 about the file's z) leans the cube: its box is wider than 2
  sure(read.box.mx[1] - read.box.mn[1] > 2.5, `the box across: ${read.box.mx[1] - read.box.mn[1]}`);
});
