// detail: the rule that turns a site's static decoration into func_detail (or back into world brushes) after the
// pieces and the dressing have made it. A decorative func_wall costs an edict and its faces are drawn from every leaf
// its box touches; as func_detail the compiler folds it into the world: no edict, and hlvis cuts it out of the
// portals, so fewer faces are visible (byz01, measured: 16-28 % fewer visible faces, 211 edicts free). What hides the
// view (a facade's wall, a cornice, a parapet, an overhang) stays in the WORLD, where it closes sight lines.
//
// Each func_wall is sorted:
//   stays func_wall   a targetname (a lamp that switches), a target, spawnflags, a render mode (masked grates, rungs,
//                     glass), any key but the two below: it moves, switches, fades or is fired
//   world brushes     a skyline crown (zhlt_noclip + zhlt_lightflags: parapets, merlons, domes), and brush by brush a
//                     wall-like mass (96 tall and 96 long) or an overhang (from 128 up, 96 long, 16 thick)
//   func_detail       the rest: lamps, columns, frames, trims, pipes, signs. `zhlt_noclip` is kept (a lamp is no
//                     one's to touch: SDHLT reads the key per brush before it moves the brushes to the world)
// SDHLT (hlcsg map.cpp, ParseBrush): func_detail and func_group brushes become the world entity's, their
// `zhlt_detaillevel` read first (1: they do not cut the leaves hlvis walks); `zhlt_lightflags` of the entity is lost
// with the entity and need not be kept: world faces cast their shadows anyway.
import { shapeOf, brushEntity } from "../../src/maps/source.mjs";

/** The keys a func_wall may have and still be only decoration. */
const PLAIN = new Set(["classname", "brushes", "zhlt_noclip", "zhlt_lightflags"]);
/** A brush this tall and this long (units) is a wall-like mass; one from this high up and this long, an overhang. */
export const OCCLUDER = { tall: 96, long: 96, overhangFrom: 128, thick: 16, overhangMax: 64 };

/** Why a func_wall stays one, or null when it is plain decoration. */
function whyStays(e) {
  const extra = Object.keys(e).filter((k) => !PLAIN.has(k));
  if (e.targetname !== undefined || e.target !== undefined) return "named or targeted";
  if (extra.length) return `keys ${extra.join(", ")}`;
  return null;
}

/** What one brush is for the view: "world" (hides it) or "detail". */
export function brushRole(brush, limits = OCCLUDER) {
  const { min, max } = shapeOf(brush);
  const d = max.map((v, k) => v - min[k]);
  const long = Math.max(d[0], d[1]);
  const thick = Math.min(d[0], d[1]);
  if (d[2] >= limits.tall && long >= limits.long) return "world";
  if (min[2] >= limits.overhangFrom && long >= limits.long && thick >= limits.thick && d[2] <= limits.overhangMax) return "world";
  return "detail";
}

/**
 * The map with its decorative func_wall sorted. `map` is { brushes, entities }; returns { brushes, entities, report }
 * with `report` { kept: { reason: n }, world: brushes, detail: brushes, walls: n turned, faces: { world, detail } }.
 * `mode` "off" returns the map as it was. `crown` "detail" makes the skyline's crowns func_detail too (they stay world by default). `classify(entity)` may be given to decide an entity by hand:
 * "keep", "world" or "detail" (null: the rule).
 */
export function detailize(map, { mode = "auto", classify = null, limits = OCCLUDER, crown: crownAs = "world" } = {}) {
  const report = { mode, kept: {}, walls: 0, wallsBefore: 0, world: 0, detail: 0, facesWorld: 0, facesDetail: 0 };
  if (mode === "off") return { brushes: map.brushes, entities: map.entities, report };
  const entities = [];
  const world = [];
  const detail = { true: [], false: [] };
  for (const e of map.entities) {
    if (e.classname !== "func_wall" || !e.brushes?.length) {
      entities.push(e);
      continue;
    }
    report.wallsBefore++;
    const say = classify?.(e);
    const why = say === "keep" ? "kept by hand" : say ? null : whyStays(e);
    if (why) {
      report.kept[why] = (report.kept[why] ?? 0) + 1;
      entities.push(e);
      continue;
    }
    const crown = e.zhlt_noclip !== undefined && e.zhlt_lightflags !== undefined;
    const noclip = e.zhlt_noclip !== undefined;
    report.walls++;
    for (const b of e.brushes) {
      const role = say === "world" || (!say && crown && crownAs === "world") ? "world" : say === "detail" ? "detail" : noclip && (!e.zhlt_lightflags || crown) ? "detail" : brushRole(b, limits);
      const faces = b.faces.length;
      if (role === "world") (world.push(b), report.world++, (report.facesWorld += faces));
      else (detail[noclip].push(b), report.detail++, (report.facesDetail += faces));
    }
  }
  for (const key of [true, false]) {
    if (!detail[key].length) continue;
    entities.push(brushEntity("func_detail", detail[key], { zhlt_detaillevel: 1, ...(key ? { zhlt_noclip: 1 } : {}) }));
  }
  report.wallsAfter = entities.filter((e) => e.classname === "func_wall").length;
  return { brushes: [...map.brushes, ...world], entities, report };
}

/** The report as a sentence. */
export function detailSentence(r) {
  if (r.mode === "off") return "func_wall decoration: left as it was (--detail off)";
  const kept = Object.entries(r.kept).map(([k, n]) => `${n} ${k}`).join(", ");
  return `func_wall decoration: ${r.wallsBefore} func_wall before, ${r.wallsAfter} after; ${r.walls} sorted into ${r.detail} func_detail brushes (${r.facesDetail} faces) and ${r.world} world brushes (${r.facesWorld} faces: wall-like masses, overhangs, crowns); kept: ${kept || "none"}`; // prettier-ignore
}
