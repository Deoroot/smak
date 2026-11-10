// What a reader of another tool's file hands on: one shape for every format, which is the shape `readObj`
// gives with a few things more. `readFbx` and `readGlb` make it, `importedObj` makes it of an .obj, and
// import-model.mjs turns it into a model, a piece for `addItem`, or a monster's skeleton and animations.
//
//   {
//     format     "fbx", "glb", "gltf" or "obj", and `version` as the file says it
//     groups     [{ object, group, material, tris }]: as `readObj`'s, one run of triangles a mesh and material.
//                A corner is { p, uv, n, group, smooth, node, weights }:
//                  p        where it is: +x forward, +y left, +z up (GoldSrc's axes), every node's place
//                           applied, in the FILE'S units (`unit` says what one is)
//                  uv       [u, v] from the picture's top left, as the kit counts (`uv.given` false where
//                           the file has none)
//                  n        its normal, turned as its point, or null
//                  group, smooth   which faces share a normal where one is worked out (see `readObj`)
//                  node     the number of the node it hangs from: of a skinned mesh the joint that weighs most
//                           on it, of any other the node that holds the mesh
//                  weights  of a skinned corner, [[node, weight], ...] as the file has them, heaviest first
//     materials  [{ name, colour, picture, image }]: `picture` the file name it gives its base colour,
//                `image` the number of the picture in `images` when the picture is inside the file
//     images     [{ name, mime, bytes }]: the pictures a file carries inside it, as they are (PNG or JPEG)
//     libraries  [] (an .obj's `mtllib`; nothing for the others)
//     meshes     [{ name, node, triangles, points, materials, skinned, uvSets }]: one for each mesh of the
//                scene, for a table
//     nodes      [{ name, parent (-1 for a root; a parent comes first), kind, rest }]: the scene's tree.
//                `rest`: the node's own matrix from its parent, in the file's axes and units
//     joints     the numbers of the nodes that are a skin's bones
//     animations [{ name, duration (seconds), nodes (the numbers of the nodes it moves), at(seconds) }]:
//                `at` gives a Map from a node's number to its own matrix at that moment
//     stand      the matrix that takes the file's scene to GoldSrc's axes (already done to `p` and `n`)
//     axes       { up, front, said }: the file's own, as "+y" and "+z"; `said`: where that was read
//     unit       { metres, said }: what one unit of the file is
//     box        { mn, mx } about every point
//     warnings   sentences: what the file holds that was passed over
//   }
import { IDENTITY, apply, applyDir, standingUp } from "./import-math.mjs";

/** The angle (degrees) that makes faces share a normal however sharply they meet. */
const ALWAYS_SMOOTH = 180;
/** A normal as text, to this many decimals: corners whose normals are that near are lit as one. */
const NORMAL_DECIMALS = 3;
/** Further out than any point: where a box starts. */
const FAR = Infinity;
/** GoldSrc's units in a metre: a unit is about an inch. */
export const UNITS_A_METRE = 39.37;

/**
 * One face's corners with what `meshOf` reads to decide where the creases are: when every corner brings a
 * normal, the faces that give a point the same normal share one there (as `readObj` does it).
 */
export function creased(corners) {
  if (!corners.every((corner) => corner.n)) return corners;
  return corners.map((corner) => ({
    ...corner,
    group: `n${corner.n.map((value) => value.toFixed(NORMAL_DECIMALS)).join()}`,
    smooth: ALWAYS_SMOOTH,
  }));
}

/** The box about the points of some groups, and the least and most of their texture coordinates. */
export function measured(groups) {
  const mn = [FAR, FAR, FAR];
  const mx = [-FAR, -FAR, -FAR];
  const uv = { mn: [FAR, FAR], mx: [-FAR, -FAR] };
  let triangles = 0;
  for (const group of groups)
    for (const tri of group.tris) {
      triangles++;
      for (const corner of tri) {
        for (let a = 0; a < 3; a++) {
          if (corner.p[a] < mn[a]) mn[a] = corner.p[a];
          if (corner.p[a] > mx[a]) mx[a] = corner.p[a];
        }
        if (corner.uv.given === false) continue;
        for (let a = 0; a < 2; a++) {
          if (corner.uv[a] < uv.mn[a]) uv.mn[a] = corner.uv[a];
          if (corner.uv[a] > uv.mx[a]) uv.mx[a] = corner.uv[a];
        }
      }
    }
  return { box: { mn, mx }, uv: uv.mn[0] === FAR ? null : uv, triangles };
}

/** An axis and its sign as "+y" or "-z". */
export const axisName = ([axis, sign]) => `${sign < 0 ? "-" : "+"}${"xyz"[axis]}`;
/** "+y", "-z", "x" as [axis, sign]; it throws on anything else. */
export function axisNamed(text, what = "an axis") {
  const found = /^([+-]?)([xyz])$/i.exec(String(text).trim());
  if (!found) throw new Error(`${what}: x, y or z, with + or - before it, not ${text}`);
  return ["xyz".indexOf(found[2].toLowerCase()), found[1] === "-" ? -1 : 1];
}

/**
 * An .obj as `readObj` gives it, in the common shape: stood up for GoldSrc. An .obj says neither its axes nor
 * its units: `up` ("y" unless told, what most tools write) and `metres` (1) are the caller's word.
 */
export function importedObj(obj, { up = "y", metres = 1 } = {}) {
  if (up !== "y" && up !== "z") throw new Error(`importedObj: up is "y" or "z", not ${up}`);
  const axes = up === "y" ? { up: [1, 1], front: [2, 1] } : { up: [2, 1], front: [0, 1] };
  const stand = standingUp(axes.up, axes.front);
  const names = [...new Set(obj.groups.map((group) => group.object || group.group || ""))];
  const groups = obj.groups.map((group) => ({
    ...group,
    tris: group.tris.map((tri) =>
      tri.map((corner) => ({
        ...corner,
        p: apply(stand, corner.p),
        n: corner.n ? applyDir(stand, corner.n) : corner.n,
        node: 0,
      })),
    ),
  }));
  const meshes = names.map((name) => {
    const own = groups.filter((group) => (group.object || group.group || "") === name);
    return {
      name,
      node: 0,
      triangles: own.reduce((sum, group) => sum + group.tris.length, 0),
      points: new Set(own.flatMap((group) => group.tris.flat().map((corner) => corner.p.join()))).size,
      materials: [...new Set(own.map((group) => group.material))],
      skinned: false,
      uvSets: own.some((group) => group.tris.some((tri) => tri.some((corner) => corner.uv.given))) ? 1 : 0,
    };
  });
  return {
    format: "obj",
    version: null,
    groups,
    materials: obj.materials ?? [],
    images: [],
    libraries: obj.libraries ?? [],
    meshes,
    nodes: [{ name: "root", parent: -1, kind: "root", rest: IDENTITY.map((row) => [...row]) }],
    joints: [],
    animations: [],
    stand,
    axes: { up: axisName(axes.up), front: axisName(axes.front), said: "told (an .obj does not say)" },
    unit: { metres, said: "told (an .obj does not say)" },
    box: measured(groups).box,
    warnings: [],
  };
}
