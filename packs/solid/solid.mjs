// packs/solid: booleans on the kit's meshes through manifold-3d (README.md). A mesh is what buildMdl's meshes are,
// { tris, texture }, its corners { p, uv?, n?, bone? } counter-clockwise seen from outside (as core/solids.mjs makes
// them); an operand is one mesh or a list of them, together one closed solid (or several apart). What comes back is
// { meshes, facts }: `meshes` a list of { tris, texture }, one a texture, ready for buildMdl and for another boolean.
//
//   union(...operands)            the solids together
//   minus(body, ...cutters)       the body with the cutters taken out of it
//   common(...operands)           what the solids share
//   hull(...operands)             the convex hull of them all, in the first one's texture
//   planar(meshes)                corners with no `uv` given one, by the rule the booleans use (below)
//   roundedRect(sx, sy, r, steps) an outline of a rectangle with its corners rounded, for extrudeTris: a slot, a window
//
// Each triangle keeps the texture of the mesh it came from: the faces a cut makes are the cutter's own surface, so
// they wear the cutter's texture (give the cutter the texture the cut faces are to have). A corner that had `uv`
// keeps it, carried through the cut; one that had none is laid planar on the face's main axis at DENSITY texels a
// unit, measured from the result's box, made less (all faces alike) where the box would run off the picture: a
// studio model's picture is not repeated. A corner's own normal (`n`) is carried, and turned over where a cutter's
// face is turned inside out (where it looks against its face); with none, buildMdl works one out by its smoothing
// angle, and the faces of different operands never share one (corner `group`), so the edge a cut makes is a crease
// and a round cutter's wall is smooth. Every WASM object made is freed (`delete()`) before the answer comes back.
import { closed } from "../../core/solids.mjs";

/** Texels a unit: make/unwrap.mjs's density, the kit's. */
export const DENSITY = 3;
/** The package and the version package.json pins (its optionalDependencies). */
const PACKAGE = "manifold-3d";
const PINNED = "3.2.1";
const PROPS = 8; // x y z u v nx ny nz
const keyOf = (p) => p.map((v) => Math.round(v * 1e4)).join(",");

let loading = null;
/**
 * The WASM module, loaded once; its absence is one sentence that says how to install it. `specifier`: another name to
 * load it by (the pack's test names one that is not there, to hear that sentence).
 */
export function manifold(specifier = PACKAGE) {
  if (specifier !== PACKAGE) return load(specifier);
  loading ??= load(PACKAGE).catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}
async function load(specifier) {
  let made;
  try {
    made = (await import(specifier)).default;
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" && String(error.message).includes(specifier)) {
      const kit = decodeURIComponent(new URL("../../", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
      throw new Error(`packs/solid needs ${PACKAGE}, which is not installed: run \`npm install\` in the kit's folder (${kit}); it installs ${PACKAGE} ${PINNED} (Apache-2.0, 0.6 MB, nothing else) from package.json's optionalDependencies`); // prettier-ignore
    }
    throw error;
  }
  const wasm = await made();
  wasm.setup();
  return wasm;
}

/** An operand as a list of meshes, refused with a sentence when it is not one closed solid facing out on one bone. */
function meshesOf(operand, called, op) {
  const list = Array.isArray(operand) ? operand : [operand];
  if (!list.length || list.some((mesh) => !mesh || !Array.isArray(mesh.tris) || !mesh.texture?.name))
    throw new Error(`${op}: ${called} is not a mesh: a mesh is { tris, texture } (buildMdl's), an operand one mesh or a list of them`); // prettier-ignore
  const tris = list.flatMap((mesh) => mesh.tris);
  const names = [...new Set(list.map((mesh) => mesh.texture.name))].join(", ");
  const { open, doubled } = closed(tris);
  if (open || doubled)
    throw new Error(`${op}: ${called} (${names}) is not closed: ${open} open edge${open === 1 ? "" : "s"} (met by one face) and ${doubled} met twice the same way, in ${tris.length} triangles; a boolean needs a closed solid: build it of closed pieces (core/solids.mjs makes them so) and union them`); // prettier-ignore
  let volume = 0;
  for (const t of tris) {
    const [a, b, c] = t.map((corner) => corner.p);
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; // prettier-ignore
  }
  if (volume < 0)
    throw new Error(`${op}: ${called} (${names}) faces inwards (its volume is ${volume.toFixed(1)}): its triangles are to run counter-clockwise seen from outside, as core/solids.mjs makes them; turn each over`); // prettier-ignore
  const bones = new Set(tris.flatMap((t) => t.map((corner) => corner.bone)));
  if (bones.size > 1)
    throw new Error(`${op}: ${called} (${names}) hangs from ${bones.size} bones (${[...bones].join(", ")}): a boolean cuts a piece on one bone; cut each bone's piece apart`); // prettier-ignore
  return list;
}

/** One operand as a Manifold: the corners that share a place merged, each mesh a run of its own reserved id. */
function solidOf(M, meshes, sources, operand) {
  const props = [];
  const triVerts = [];
  const runIndex = [];
  const runOriginalID = [];
  const at = new Map();
  const vertOf = new Map();
  const mergeFrom = [];
  const mergeTo = [];
  const first = M.Manifold.reserveIDs(meshes.length);
  meshes.forEach((mesh, m) => {
    runIndex.push(triVerts.length);
    runOriginalID.push(first + m);
    const hasUV = mesh.tris.every((t) => t.every((c) => c.uv));
    const hasN = mesh.tris.every((t) => t.every((c) => c.n));
    sources.set(first + m, { mesh, operand, hasUV, hasN, bone: mesh.tris[0]?.[0]?.bone });
    for (const tri of mesh.tris)
      for (const c of tri) {
        const place = keyOf(c.p);
        const uv = hasUV ? c.uv : [0, 0];
        const n = hasN ? c.n : [0, 0, 0];
        const key = `${place}|${uv}|${n}|${m}`;
        let v = vertOf.get(key);
        if (v === undefined) {
          v = props.length / PROPS;
          vertOf.set(key, v);
          if (!at.has(place)) at.set(place, { v, p: c.p });
          else mergeFrom.push(v), mergeTo.push(at.get(place).v);
          props.push(...at.get(place).p, ...uv, ...n);
        }
        triVerts.push(v);
      }
  });
  const mesh = new M.Mesh({
    numProp: PROPS,
    vertProperties: new Float32Array(props),
    triVerts: new Uint32Array(triVerts),
    mergeFromVert: new Uint32Array(mergeFrom),
    mergeToVert: new Uint32Array(mergeTo),
    runIndex: new Uint32Array(runIndex),
    runOriginalID: new Uint32Array(runOriginalID),
  });
  return new M.Manifold(mesh);
}

/** The main axis of a face and the picture's (u, v) on it, from outside: [axis of u, its sign, axis of v, its sign]. */
function axesOf(n) {
  const a = [0, 1, 2].reduce((best, k) => (Math.abs(n[k]) > Math.abs(n[best]) ? k : best), 0);
  const s = Math.sign(n[a]) || 1;
  if (a === 0) return [1, s, 2, -1];
  if (a === 1) return [0, -s, 2, -1];
  return [0, 1, 1, -s];
}
const normalOf = ([a, b, c]) => {
  const e = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const f = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]];
};

/** Corners with no uv laid planar on their face's main axis, from the box of all the meshes given (the rule above). */
export function planar(meshes) {
  const list = Array.isArray(meshes) ? meshes : [meshes];
  const bare = list.filter((mesh) => !mesh.tris.every((t) => t.every((c) => c.uv)));
  if (!bare.length) return list;
  const points = list.flatMap((mesh) => mesh.tris.flat().map((c) => c.p));
  const lo = [0, 1, 2].map((k) => Math.min(...points.map((p) => p[k])));
  const hi = [0, 1, 2].map((k) => Math.max(...points.map((p) => p[k])));
  const span = Math.max(...hi.map((v, k) => v - lo[k]), 1e-6);
  const density = Math.min(
    DENSITY,
    ...bare.map((mesh) => Math.min(mesh.texture.width, mesh.texture.height) / span),
  );
  const along = (p, axis, sign) => (sign > 0 ? p[axis] - lo[axis] : hi[axis] - p[axis]) * density;
  return list.map((mesh) => {
    if (!bare.includes(mesh)) return mesh;
    const { width, height } = mesh.texture;
    const tris = mesh.tris.map((tri) => {
      const [ua, us, va, vs] = axesOf(normalOf(tri.map((c) => c.p)));
      return tri.map((c) => ({ ...c, uv: [along(c.p, ua, us) / width, along(c.p, va, vs) / height] }));
    });
    return { ...mesh, tris };
  });
}

/** Runs one of manifold's operations over the operands and makes the result the kit's meshes again. */
async function run(op, operands, names, apply) {
  const lists = operands.map((operand, k) => meshesOf(operand, names(k), op));
  const M = await manifold();
  const started = performance.now();
  const sources = new Map();
  const made = [];
  try {
    for (const [k, list] of lists.entries()) {
      try {
        made.push(solidOf(M, list, sources, k));
      } catch (error) {
        throw new Error(`${op}: ${names(k)} was refused by ${PACKAGE} (${error.code ?? error.message}): it is not a closed solid in its own measure, an edge met by more than two faces or a face with no area`); // prettier-ignore
      }
    }
    const result = apply(M, made);
    made.push(result);
    const out = result.getMesh();
    const p = out.vertProperties;
    const np = out.numProp;
    const byTexture = new Map();
    for (let r = 0; r < out.runOriginalID.length; r++) {
      // a hull is a solid of its own: its triangles are the first operand's first mesh's
      const source = sources.get(out.runOriginalID[r]) ?? sources.values().next().value;
      const { mesh, hasUV, hasN, bone, operand } = source;
      const into = byTexture.get(mesh.texture.name) ?? { texture: mesh.texture, tris: [] };
      byTexture.set(mesh.texture.name, into);
      for (let t = out.runIndex[r]; t < out.runIndex[r + 1]; t += 3) {
        const tri = [0, 1, 2].map((j) => {
          const v = out.triVerts[t + j] * np;
          const corner = { p: [p[v], p[v + 1], p[v + 2]], group: `operand ${operand}` };
          if (hasUV && np >= PROPS) corner.uv = [p[v + 3], p[v + 4]];
          if (hasN && np >= PROPS) corner.n = [p[v + 5], p[v + 6], p[v + 7]];
          if (bone !== undefined) corner.bone = bone;
          return corner;
        });
        // a cutter's face is turned inside out by the cut, and its own normals with it (3.2.1's getMesh does not)
        const sum = tri.reduce((s, c) => [s[0] + (c.n?.[0] ?? 0), s[1] + (c.n?.[1] ?? 0), s[2] + (c.n?.[2] ?? 0)], [0, 0, 0]); // prettier-ignore
        const face = normalOf(tri.map((c) => c.p));
        if (hasN && face[0] * sum[0] + face[1] * sum[1] + face[2] * sum[2] < 0)
          for (const c of tri) c.n = c.n.map((v) => -v);
        into.tris.push(tri);
      }
    }
    const meshes = planar([...byTexture.values()]);
    const triangles = { in: lists.flat().reduce((s, mesh) => s + mesh.tris.length, 0), out: out.numTri };
    const facts = { triangles, volume: result.volume(), volumes: made.slice(0, -1).map((m) => m.volume()), ms: performance.now() - started }; // prettier-ignore
    return { meshes, facts };
  } finally {
    for (const solid of made) solid.delete();
  }
}

const solidNames = (k) => `solid ${k + 1}`;
/** The solids together, as one. */
export const union = (...operands) => run("union", operands, solidNames, (M, all) => M.Manifold.union(all));
/** The body with each cutter taken out of it: the faces the cut makes wear the cutter's texture. */
export const minus = (body, ...cutters) =>
  run(
    "minus",
    [body, ...cutters],
    (k) => (k ? `cutter ${k}` : "the body"),
    (M, all) => M.Manifold.difference(all),
  );
/** What all the solids share. */
export const common = (...operands) =>
  run("common", operands, solidNames, (M, all) => M.Manifold.intersection(all));
/** The convex hull of all the solids' points, in the first one's texture. */
export const hull = (...operands) => run("hull", operands, solidNames, (M, all) => M.Manifold.hull(all));

/**
 * The outline of a rectangle sx by sy about the origin, its corners rounded by r (at most half the shorter side: a
 * slot), each corner `steps` sides (4: 22.5 degrees a side, under the kit's smoothing of 40, so it is lit round).
 * Counter-clockwise, for core/solids.mjs's extrudeTris and sweepTris.
 */
export function roundedRect(sx, sy, r, steps = 4) {
  const x = sx / 2;
  const y = sy / 2;
  r = Math.min(r, x, y);
  const out = [];
  for (const [
    cx,
    cy,
    from,
  ] of [[x - r, y - r, 0], [-x + r, y - r, 90], [-x + r, -y + r, 180], [x - r, -y + r, 270]]) // prettier-ignore
    for (let k = 0; k <= steps; k++) {
      const a = ((from + (90 * k) / steps) * Math.PI) / 180;
      const q = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      const last = out.at(-1);
      if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 1e-6) out.push(q);
    }
  if (Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) < 1e-6) out.pop();
  return out;
}
