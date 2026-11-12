// A model's loose pieces (a pouch, a plate, a pack: the groups of triangles that touch), and taking triangles
// off by a rule on their place.
import { readMdl, readMesh, filterMesh, apply34 } from "../core/mdl.mjs";
import { posed } from "./render.mjs";
import { box } from "../core/vec.mjs";
import { round1 } from "./place-shared.mjs";

/** Two corners are one point when they agree to two decimal places: the name such a point goes by. */
const pointKey = (p) => p.map((v) => v.toFixed(2)).join();
/** The name a triangle of a mesh goes by: its mesh and its three points. */
const triangleKey = (where, points) =>
  `${where.bodypart}|${where.model}|${where.mesh}|${points.map(pointKey).join("|")}`;

/** Every mesh's triangles in model space as the model stands in `pose`, with where the mesh is. */
function meshes(src, pose) {
  const info = readMdl(src);
  const matrices = posed(src, pose).pose;
  const out = [];
  info.bodyparts.forEach((bodypart, i) =>
    bodypart.models.forEach((model, j) =>
      model.meshes.forEach((mesh, k) => {
        if (mesh.numtris)
          out.push({
            where: { bodypart: i, model: j, mesh: k },
            part: bodypart.name,
            model: model.name,
            tex: mesh.texture?.name ?? null,
            tris: readMesh(src, model, mesh).map((t) => t.map((c) => apply34(matrices[c.bone], c.p))),
          });
      }),
    ),
  );
  return out;
}

/** The triangles of one mesh (three points each) in groups that touch one another through a point. */
function touching(tris) {
  // every point starts as a group of its own; a triangle joins the groups of its three
  const parent = new Map();
  const rootOf = (key) => {
    while (parent.get(key) !== key) {
      parent.set(key, parent.get(parent.get(key)));
      key = parent.get(key);
    }
    return key;
  };
  for (const t of tris) {
    const keys = t.map(pointKey);
    for (const key of keys) if (!parent.has(key)) parent.set(key, key);
    parent.set(rootOf(keys[1]), rootOf(keys[0]));
    parent.set(rootOf(keys[2]), rootOf(keys[0]));
  }
  const groups = new Map();
  for (const t of tris) {
    const root = rootOf(pointKey(t[0]));
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(t);
  }
  return [...groups.values()];
}

/**
 * The model's loose pieces: within each mesh, the groups of triangles that touch one another. A pouch, a
 * plate, a pack, a helmet is usually one piece. Returns { list, of }:
 *   list   [{ id, tex, part, model, where, tris (how many), mn, mx, mid }] in model space, as the model
 *          stands in `pose` (`where`: its mesh, { bodypart, model, mesh }; every submodel's pieces are
 *          listed, whatever body `pose` names)
 *   of(t)  the id of the piece a triangle belongs to, for a `t` as `dropTriangles` hands it to its `drop`
 * A body's own limb is a piece too, and often there is nothing under what looks like armour: look at a
 * picture of the model without a piece before deciding it can come off.
 */
export function pieces(src, pose = {}) {
  const list = [];
  const pieceOf = new Map();
  for (const mesh of meshes(src, pose)) {
    for (const group of touching(mesh.tris)) {
      const bounds = box(group.flat());
      const id = list.length;
      list.push({
        id,
        tex: mesh.tex,
        part: mesh.part,
        model: mesh.model,
        where: mesh.where,
        tris: group.length,
        mn: bounds.mn.map(round1),
        mx: bounds.mx.map(round1),
        mid: bounds.mn.map((v, a) => round1((v + bounds.mx[a]) / 2)),
      });
      for (const t of group) pieceOf.set(triangleKey(mesh.where, t), id);
    }
  }
  return {
    list,
    of: (t) => pieceOf.get(triangleKey(t.where, t.p)),
  };
}

/**
 * A copy of the model without the triangles `drop` accepts. It is given
 * { p: [three points], mid, tex, part, model, where, tri } in model space, as the model stands in `pose`
 * (`tri`: the triangle's number in its mesh). Points, normals, bones, animations and the other triangles stay
 * as they are (`filterMesh` does the cutting). Returns { mdl, gone }.
 *   const P = pieces(src); dropTriangles(src, (t) => [59, 36].includes(P.of(t)))  // two pieces off
 *   dropTriangles(src, (t) => t.mid[2] > 60)                                       // all above a height
 *   const I = uvIslands(src); dropTriangles(src, (t) => I.of(t) === 4)             // one island off
 */
export function dropTriangles(src, drop, pose = {}) {
  let mdl = src;
  let gone = 0;
  for (const mesh of meshes(src, pose)) {
    let next = 0;
    let cut = 0;
    // `filterMesh` asks about the mesh's triangles in their order: the place of each is the next of the list
    const without = filterMesh(mdl, mesh.where, () => {
      const tri = next;
      const p = mesh.tris[next++];
      const dropped = drop({
        p,
        mid: [0, 1, 2].map((a) => (p[0][a] + p[1][a] + p[2][a]) / 3),
        tex: mesh.tex,
        part: mesh.part,
        model: mesh.model,
        where: mesh.where,
        tri,
      });
      if (dropped) cut++;
      return !dropped;
    });
    if (cut) {
      mdl = without;
      gone += cut;
    }
  }
  return { mdl, gone };
}
