// What the assets pack's tests (204-pack-assets.mjs, broken/packs.mjs) are made on, with no network and nothing
// downloaded: a small glTF written as Poly Haven lays one out (the .gltf, its .bin, its pictures in textures/), a
// list of models in the API's shape, and a stand-in for the network that serves them by their addresses.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { png } from "../src/index.mjs";

/** A square-based frustum in metres, glTF's +y up: a foot 0.4 across, a top 0.2 across, 1 high. */
const FOOT = 0.2;
const TOP = 0.1;
const HIGH = 1;
/**
 * Its triangles as [[x, y, z, u, v] x 3]: the sides and the foot on the picture's left half (red), the top on its
 * right half (blue), counter-clockwise seen from outside. `at`: where its foot's middle is (not the origin, and
 * off the floor: the pack is to stand it on z = 0 at the middle).
 */
function frustum([ax, ay, az]) {
  const ring = (half, y) => [[-half, y, -half], [half, y, -half], [half, y, half], [-half, y, half]].map(([x, h, z]) => [x + ax, h + ay, z + az]); // prettier-ignore
  const low = ring(FOOT, 0);
  const high = ring(TOP, HIGH);
  const tris = [];
  const quad = (a, b, c, d, u0, u1) => {
    const uv = [
      [u0, 1],
      [u1, 1],
      [u1, 0],
      [u0, 0],
    ];
    const corners = [a, b, c, d].map((p, k) => [...p, ...uv[k]]);
    tris.push([corners[0], corners[1], corners[2]], [corners[0], corners[2], corners[3]]);
  };
  for (let k = 0; k < 4; k++) quad(low[(k + 1) % 4], low[k], high[k], high[(k + 1) % 4], 0.05, 0.45);
  quad(high[3], high[2], high[1], high[0], 0.55, 0.95); // the top, seen from above
  quad(low[0], low[1], low[2], low[3], 0.05, 0.45); // the foot, seen from below
  return tris;
}
/** A small closed tetrahedron at `at`, which the reducer cannot take a triangle from. */
function tetrahedron([x, y, z]) {
  const p = [
    [x, y, z],
    [x + 0.01, y, z],
    [x, y + 0.01, z],
    [x, y, z + 0.01],
  ];
  return [
    [0, 2, 1],
    [0, 1, 3],
    [0, 3, 2],
    [1, 2, 3],
  ].map((face) => face.map((k) => [...p[k], 0.25, 0.5]));
}

/** The picture: its left half red, its right half blue, 64 a side; `opacity`: a grey map, black on its right half. */
function pictures() {
  const colour = new Uint8Array(64 * 64 * 4);
  const opacity = new Uint8Array(64 * 64 * 4);
  for (let i = 0; i < 64 * 64; i++) {
    const right = i % 64 >= 32;
    colour.set(right ? [20, 40, 230, 255] : [220, 30, 20, 255], i * 4);
    opacity.set(right ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
  }
  return { colour: png(64, 64, colour), opacity: png(64, 64, opacity) };
}

/**
 * A .gltf with its .bin and its picture in `folder`, as Poly Haven's at 1k: returns the .gltf's path.
 *   lying     the frustum turned to lie along -x (a node's turn), as a file that lies on its side
 *   pieces    so many tetrahedra a little apart beside it (points the reducer cannot take away)
 *   opacity   an opacity map beside the colour (`<name>_opacity_1k.png`), black on the picture's right half
 *   twin      a second frustum, a mesh of its own (`<name>_b`), 2 m beside the first: two objects side by side
 *   name      the asset's id
 */
export function writePropGltf(
  folder,
  { lying = false, pieces = 0, opacity = false, twin = false, name = "test_prop" } = {},
) {
  const tris = [...frustum([0.5, 0.1, -0.3])];
  for (let k = 0; k < pieces; k++)
    tris.push(...tetrahedron([2 + (k % 40) * 0.03, 0, Math.floor(k / 40) * 0.03]));
  const objects = [tris];
  if (twin) objects.push(frustum([2.5, 0.3, 0.4]));
  const corners = objects.flat(2);
  const turn = Math.SQRT1_2;
  const chunks = [];
  const bufferViews = [];
  const accessors = [];
  const meshes = [];
  for (const [k, list] of objects.entries()) {
    const flat = list.flat();
    const positions = new Float32Array(flat.flatMap((c) => c.slice(0, 3)));
    const uvs = new Float32Array(flat.flatMap((c) => c.slice(3, 5)));
    const min = [0, 1, 2].map((a) => Math.min(...flat.map((c) => c[a])));
    const max = [0, 1, 2].map((a) => Math.max(...flat.map((c) => c[a])));
    const at = accessors.length;
    for (const array of [positions, uvs]) {
      bufferViews.push({ buffer: 0, byteOffset: chunks.reduce((sum, c) => sum + c.length, 0), byteLength: array.byteLength });
      chunks.push(Buffer.from(array.buffer));
    }
    accessors.push({ bufferView: at, componentType: 5126, count: flat.length, type: "VEC3", min, max }, { bufferView: at + 1, componentType: 5126, count: flat.length, type: "VEC2" }); // prettier-ignore
    meshes.push({ name: k ? `${name}_b` : name, primitives: [{ attributes: { POSITION: at, TEXCOORD_0: at + 1 }, material: 0 }] });
  }
  const bin = Buffer.concat(chunks);
  const gltf = {
    asset: { version: "2.0", generator: "SMAK's test" },
    scene: 0,
    scenes: [{ nodes: meshes.map((_, k) => k) }],
    nodes: meshes.map((m, k) => ({ name: m.name, mesh: k, ...(lying && !k ? { rotation: [0, 0, turn, turn] } : {}) })),
    meshes,
    materials: [{ name, ...(opacity ? { alphaMode: "BLEND" } : {}), pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, normalTexture: { index: 1 } }], // prettier-ignore
    textures: [{ source: 0 }, { source: 1 }],
    images: [{ uri: `textures/${name}_diff_1k.png` }, { uri: `textures/${name}_nor_gl_1k.png` }],
    buffers: [{ uri: `${name}.bin`, byteLength: bin.length }],
    bufferViews,
    accessors,
  };
  mkdirSync(join(folder, "textures"), { recursive: true });
  const { colour, opacity: alpha } = pictures();
  writeFileSync(join(folder, `${name}_1k.gltf`), JSON.stringify(gltf));
  writeFileSync(join(folder, `${name}.bin`), bin);
  writeFileSync(join(folder, "textures", `${name}_diff_1k.png`), colour);
  writeFileSync(join(folder, "textures", `${name}_nor_gl_1k.png`), colour);
  if (opacity) writeFileSync(join(folder, "textures", `${name}_opacity_1k.png`), alpha);
  return join(folder, `${name}_1k.gltf`);
}

/** A list of models as /assets?t=models gives it (the fields search reads), and one texture that is not a model. */
export const LIST = {
  korean_fire_extinguisher_01: { type: 2, name: "Korean Fire Extinguisher 01", categories: ["industrial", "props"], tags: ["fire", "extinguisher", "red"], dimensions: [280, 367, 659], polycount: 9913, download_count: 10 }, // prettier-ignore
  fire_hydrant: { type: 2, name: "Fire Hydrant", categories: ["industrial"], tags: ["city", "extinguisher", "valve"], dimensions: [870, 320, 800], polycount: 86316, download_count: 50 }, // prettier-ignore
  metal_trash_can: { type: 2, name: "Metal Trash Can", categories: ["industrial", "containers"], tags: ["bin", "rubbish", " urban"], download_count: 5 }, // prettier-ignore
  red_brick: { type: 1, name: "Red Brick", categories: ["brick"], tags: ["red", "fire"] },
};

/**
 * The network as the API answers, from memory: `files` maps an address to its bytes (an object is sent as JSON);
 * any other is a 404. `asked` lists the addresses asked, in order.
 */
export function fakeNetwork(files) {
  const asked = [];
  const ask = async (url) => {
    asked.push(url);
    if (!(url in files)) throw Object.assign(new Error(`${url} is not there (404)`), { status: 404 });
    const body = files[url];
    return Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  };
  return { ask, asked };
}
