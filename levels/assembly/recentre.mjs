// levels/assembly/recentre.mjs: a site is built in its own frame (cells of 64, the origin its south-west corner), and a map whose
// far corner is past +-4096 draws wrong in GoldSrc and warns in the budget. A site's `recentre: [dx, dy]` (units, whole multiples of
// 256 so the pictures keep their alignment) moves the finished map, and the RP file with it, by that much: the map is planned,
// assembled, dressed and checked where it was drawn, and only written, compiled and read back moved.
//
//   shiftMap(map, [dx, dy])      -> the map with every brush and every entity moved (an entity's `origin` key)
//   shiftContract(contract, d)   -> the RP contract (smak-rp/1) with every place, spawn, npc, arena point, roam spot, roof and path node moved
//   shiftPaths(paths, d)         -> the walking graph moved (a copy)
import { moved } from "../../src/maps/source.mjs";

const num = (v) => Array.isArray(v) && v.length >= 2 && v.every((q) => typeof q === "number");
const plus = (v, d) => v.map((q, i) => (i < 2 ? Math.round((q + d[i]) * 100) / 100 : q));

/** The map moved by `d` ([dx, dy], or [dx, dy, dz]). */
export function shiftMap(map, d) {
  const by = [d[0], d[1], d[2] ?? 0];
  const entities = map.entities.map((e) => {
    const out = { ...e };
    if (typeof e.origin === "string") out.origin = e.origin.trim().split(/\s+/).map(Number).map((q, i) => q + by[i]).join(" ");
    if (e.brushes) out.brushes = moved(e.brushes, by);
    return out;
  });
  return { ...map, brushes: moved(map.brushes.flat(), by), entities };
}

/** `value` with every [x, y, z, ...] under these keys moved (a copy). */
function walk(value, d, key = "") {
  if (Array.isArray(value)) {
    if (["at", "origin", "front", "pass", "lo", "hi"].includes(key) && num(value) && value.length >= 3) return plus(value, d);
    if (["back", "spawns"].includes(key)) return value.map((q) => (num(q) && q.length >= 3 ? plus(q, d) : walk(q, d, "")));
    return value.map((q) => walk(q, d, key));
  }
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, d, k)]));
  return value;
}

export const shiftPaths = (paths, d) => walk(paths, d, "paths");

/** The contract moved by `d` ([dx, dy]): see the module's head. */
export function shiftContract(contract, d) {
  const { roofs, ...rest } = contract;
  const out = walk(rest, d);
  if (roofs) {
    out.roofs = {
      ...walk({ ways: roofs.ways }, d),
      roofs: roofs.roofs.map((r) => ({ ...r, from: plus(r.from, d), to: plus(r.to, d) })),
      links: roofs.links,
    };
  }
  return out;
}

/**
 * A read map (readBsp) moved by `-d`: the compiled, recentred map as the site's own frame sees it, for the code that holds the
 * site's plan against the map (the walking graph). Its planes, vertices and models; the nodes and leaves are by plane number.
 */
export function unshiftBsp(bsp, d) {
  const by = [-d[0], -d[1], d[2] ? -d[2] : 0];
  const move = (v) => v.map((q, i) => q + by[i]);
  return {
    ...bsp,
    planes: bsp.planes.map((p) => ({ ...p, dist: p.dist + p.normal[0] * by[0] + p.normal[1] * by[1] + p.normal[2] * by[2] })),
    vertices: bsp.vertices.map(move),
    models: bsp.models.map((m) => ({ ...m, mins: move(m.mins), maxs: move(m.maxs), ...(m.origin ? { origin: move(m.origin) } : {}) })),
  };
}
