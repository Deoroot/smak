// budget: what a compiled map spends of the engine's budgets, held against limits: the world's leaves (and the PHS
// the engine builds from them), faces, brushes, models, the edicts the map takes at once, the light, how far from the
// origin anything reaches, and what each compile tool took. One line PASS/FAIL, the detail for a file.
import { shapeOf } from "./source.mjs";
import { readBsp } from "./bsp.mjs";

/**
 * The limits a budget is held to unless the map's spec says other: leaves, edicts the map takes at once (`staticEdicts`:
 * the entities that keep an edict at runtime), faces, and `range`: a WARN past `warn` (±4096, what GoldSrc sends of an
 * entity's place) and a FAIL past `fail` (±8000: on H9's Xash build collision breaks past ±12000, tested in game).
 */
export const BUDGET_LIMITS = { leaves: 24000, staticEdicts: 1500, faces: 60000, range: { warn: 4096, fail: 8000 } };
/** Entities the engine does not keep an edict for when they have no name: the compilers fold them into the light. */
const NO_EDICT = /^(light|light_spot|light_environment|light_surface|info_texlights|info_compile_parameters)$/;
/** The PHS the engine builds in memory, in bytes: leaves x ceil(leaves / 8) x 2 (the PVS bit set, and the PHS). */
export const phsBytes = (leaves) => leaves * Math.ceil(leaves / 8) * 2;

/** The classnames of the entities that keep an edict, counted: `{ func_door: 98, ts_model: 381 }`. */
export function staticEdicts(entities) {
  const counts = {};
  for (const list of entities) {
    const e = Object.fromEntries(list);
    if (!e.classname || (NO_EDICT.test(e.classname) && !e.targetname)) continue;
    counts[e.classname] = (counts[e.classname] ?? 0) + 1;
  }
  return counts;
}

/** How far from the origin the map's brushes and entities reach: `{ max, at }` (the farthest one's sentence). */
export function reachOfMap(map) {
  let max = 0;
  let at = "";
  const see = (v, what) => {
    for (const x of v) if (Math.abs(x) > max) (max = Math.abs(x), (at = `${what} at ${v.map(Math.round).join(" ")}`));
  };
  const brushes = [...(map.brushes ?? []).flat(), ...(map.entities ?? []).flatMap((e) => e.brushes ?? [])];
  for (const b of brushes) {
    const s = shapeOf(b);
    if (!s.faults.length) (see(s.min, "a brush"), see(s.max, "a brush"));
  }
  for (const e of map.entities ?? []) {
    const o = typeof e.origin === "string" ? e.origin.split(/\s+/).map(Number) : e.origin;
    if (Array.isArray(o) && o.length === 3 && o.every(Number.isFinite)) see(o, e.classname ?? "an entity");
  }
  return { max, at };
}

/**
 * The budget of a compiled map. `bsp`: the .bsp's bytes; `map`: what writeMap took (for the reach and the brushes);
 * `compile`: compileMap's result (`logs` gives the time of each tool); `limits`: over BUDGET_LIMITS.
 * Returns `{ ok, line, failures, warnings, measures, text }`: `line` is `PASS: ...` or `FAIL: ...`.
 */
export function budgetOf({ bsp, map = null, compile = null, limits = {} }) {
  const lim = { ...BUDGET_LIMITS, ...limits, range: { ...BUDGET_LIMITS.range, ...(limits.range ?? {}) } };
  const b = readBsp(bsp);
  // the leaves of the file (the engine's PHS is built over all of them: byz01's 17,882 are 8,936 of the world's vis leaves and the rest)
  const leaves = b.leaves.length;
  const edicts = staticEdicts(b.entities);
  const edictTotal = Object.values(edicts).reduce((a, n) => a + n, 0);
  const phs = phsBytes(leaves);
  const times = Object.fromEntries((compile?.logs ?? []).map((l) => [l.tool, Math.round(l.seconds * 10) / 10]));
  const reach = map ? reachOfMap(map) : null;
  const detailBrushes = map ? (map.entities ?? []).filter((e) => /^func_(detail|group)$/.test(e.classname)).reduce((a, e) => a + e.brushes.length, 0) : 0;
  const measures = {
    leaves,
    visLeaves: b.models[0].visLeaves,
    faces: b.faces.length,
    worldFaces: b.models[0].faceCount,
    brushes: map ? (map.brushes ?? []).flat().length + (map.entities ?? []).reduce((a, e) => a + (e.brushes?.length ?? 0), 0) : null,
    worldBrushes: map ? (map.brushes ?? []).flat().length + detailBrushes : null,
    models: b.models.length - 1,
    entitiesInLump: b.entities.length,
    staticEdicts: edictTotal,
    edictsByClass: Object.fromEntries(Object.entries(edicts).sort((x, y) => y[1] - x[1])),
    phsMB: Math.round(phs / 1e5) / 10,
    lightdataBytes: b.lumps.lighting.length,
    times,
    reach: reach?.max ?? null,
  };
  const failures = [];
  const warnings = [];
  if (leaves > lim.leaves) failures.push(`${leaves} leaves, over ${lim.leaves} (the PHS would be ${measures.phsMB} MB)`);
  if (edictTotal > lim.staticEdicts) failures.push(`${edictTotal} static edicts, over ${lim.staticEdicts}`);
  if (measures.faces > lim.faces) failures.push(`${measures.faces} faces, over ${lim.faces}`);
  if (reach && reach.max > lim.range.fail) failures.push(`a map reaches ${Math.round(reach.max)} from the origin (${reach.at}), past the ${lim.range.fail} the H9 client holds`);
  else if (reach && reach.max > lim.range.warn) warnings.push(`a map reaches ${Math.round(reach.max)} from the origin (${reach.at}), past ±${lim.range.warn}: GoldSrc cannot place it, H9's Xash can (to ${lim.range.fail})`);
  const sec = Object.entries(times).map(([t, s]) => `${t} ${s}`).join(", ");
  const classes = Object.entries(measures.edictsByClass).map(([k, n]) => `${k} ${n}`).join(", ");
  const text = [
    `leaves         ${leaves} / ${lim.leaves}   (the world's vis leaves ${measures.visLeaves})   PHS ${measures.phsMB} MB (leaves x ceil(leaves/8) x 2)`,
    `faces          ${measures.faces} / ${lim.faces}   (world ${measures.worldFaces})`,
    `brushes        ${measures.brushes ?? "?"} (in the world ${measures.worldBrushes ?? "?"}, with func_detail)   brush models ${measures.models}`,
    `static edicts  ${edictTotal} / ${lim.staticEdicts}   of ${measures.entitiesInLump} entities in the lump (unnamed lights keep none)`,
    `  by class     ${classes}`,
    `lightdata      ${(measures.lightdataBytes / 1048576).toFixed(2)} MB`,
    `reach          ${reach ? `${Math.round(reach.max)} from the origin (${reach.at}); warn past ${lim.range.warn}, fail past ${lim.range.fail}` : "not read"}`,
    `compile time   ${sec || "not compiled here"}`,
    ...failures.map((f) => `FAIL ${f}`),
    ...warnings.map((w) => `WARN ${w}`),
  ].join("\n");
  const brief = `${leaves} leaves (PHS ${measures.phsMB} MB), ${measures.faces} faces, ${edictTotal} static edicts, ${measures.models} models, ${(measures.lightdataBytes / 1048576).toFixed(1)} MB light`;
  return { ok: !failures.length, line: failures.length ? `FAIL: ${failures.join("; ")}` : `PASS: ${brief}`, failures, warnings, measures, text };
}
