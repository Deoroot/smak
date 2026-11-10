// Triangles into what a studio model stores: shared points, normals of their own, and the bone each hangs
// from.
import { sub, dot, cross, unit } from "../core/vec.mjs";

/**
 * Which way round a compiled model's triangles go: the sign of (b - a) x (c - a) against the normal that
 * looks out of the surface.
 */
export const FRONT = -1;

/**
 * The most alike (as a cosine) two faces may be asked to be before they share a normal: just under the same.
 */
const NEARLY_SAME = 0.99999;
/** A normal given with a corner counts when it is longer than this: a shorter one says no direction. */
const NO_DIRECTION = 1e-9;
const cosOfDegrees = (degrees) => Math.cos((degrees * Math.PI) / 180);
/** A point as text, to four decimals: points that near are one point. */
const pointKey = (p) => p.map((v) => v.toFixed(4)).join();

/**
 * Triangles placed in a bone's space, as what replaceMesh takes. A corner is { p, uv } and,
 * for a piece on several bones, { bone, to } too: the bone it hangs from and the matrix
 * that takes it there from the space `p` is in. `original` is the mesh being replaced:
 * which way round the game's triangles go is read off it, its stored normals against its faces (null: FRONT).
 * `smooth`: faces that meet at a point at less than this many degrees share a normal there. A corner may
 * carry `group` (faces share a normal only within one group: what the workshop's `turn` gives each side of a
 * ring marked `crease`) and `smooth` (its part's own angle, in place of the mesh's).
 * A corner may also carry `n`, a normal of its own, in the space `p` is in and looking out of the surface: it
 * is stored as it is (made one long), in place of the one worked out from the faces. That is for normals
 * that come with the shape (an .obj's `vn`): a surface cut in two then has the same light on both sides of
 * the cut. `buildMdl` and `putBody` hand it on only when asked (`ownNormals`).
 */
export function meshOf(original, tris, tex, bone, smooth = 40) {
  const faceNormal = (tri) => cross(sub(tri[1].p, tri[0].p), sub(tri[2].p, tri[0].p));
  // with no original to read it off (a model made from nothing): as the compiler leaves them, clockwise seen
  // from outside
  const sign = original?.length
    ? Math.sign(original.reduce((sum, tri) => sum + Math.sign(dot(faceNormal(tri), tri[0].n)), 0)) || 1
    : FRONT;
  // the generators' triangles face outwards counter-clockwise
  if (sign < 0) tris = tris.map((tri) => [tri[0], tri[2], tri[1]]);

  // Normals: faces that meet at a point at less than 40 degrees share one (grips and shafts are round).
  // `facesAt`: for each point, the normals of the faces that meet there, each as long as its face is large.
  const facesAt = new Map();
  // a corner may say which group its face is in (`group`): only faces of one group share a normal at a point,
  // so the line between two is a crease
  tris.forEach((tri) => {
    const normal = faceNormal(tri).map((v) => v * sign);
    for (const corner of tri) {
      const faces = facesAt.get(pointKey(corner.p)) ?? [];
      faces.push(corner.group === undefined ? normal : Object.assign([...normal], { group: corner.group }));
      facesAt.set(pointKey(corner.p), faces);
    }
  });

  // the points and the normals, each kept once for each bone it is on
  const verts = [];
  const vertBones = [];
  const vertNumbers = new Map();
  const norms = [];
  const normBones = [];
  const normNumbers = new Map();
  // the number of a point (or a normal) on a bone in its list, added to the list when it is not there yet
  const numberOf = (list, bones, numbers, value, onBone) => {
    const key = onBone + ":" + pointKey(value);
    if (!numbers.has(key)) {
      numbers.set(key, list.length);
      list.push(value);
      bones.push(onBone);
    }
    return numbers.get(key);
  };

  const meshCos = cosOfDegrees(smooth);
  const corners = tris.map((tri) => {
    const facing = unit(faceNormal(tri).map((v) => v * sign));
    return tri.map((corner) => {
      // the corner's normal: the sum of the faces at its point that are of its group and near enough its own
      const leastCos =
        corner.smooth === undefined ? meshCos : Math.min(NEARLY_SAME, cosOfDegrees(corner.smooth));
      const workedOut = () =>
        facesAt
          .get(pointKey(corner.p))
          .filter((face) => face.group === corner.group && dot(unit(face), facing) > leastCos)
          .reduce((sum, face) => [sum[0] + face[0], sum[1] + face[1], sum[2] + face[2]], [0, 0, 0]);
      // or the corner's own, when it brings one that says a direction
      const own = corner.n && Math.hypot(...corner.n) > NO_DIRECTION;
      const normal = unit(own ? corner.n : workedOut());
      // into the space of the corner's own bone, when it is not the piece's
      const onBone = corner.bone ?? bone;
      const p = corner.to ? corner.to.map((row) => dot(row, corner.p) + row[3]) : corner.p;
      const n = corner.to ? corner.to.map((row) => dot(row, normal)) : normal;
      return [
        numberOf(verts, vertBones, vertNumbers, p, onBone),
        numberOf(norms, normBones, normNumbers, n, onBone),
        Math.round(corner.uv[0] * tex.width),
        Math.round(corner.uv[1] * tex.height),
      ];
    });
  });
  return { bone, verts, norms, vertBones, normBones, tris: corners };
}
