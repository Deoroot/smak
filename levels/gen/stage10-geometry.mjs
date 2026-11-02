// Stage 10, geometry: the Xash / GoldSrc adapter (PLAN.md Phase 3, the stages table, row 10). Builds the tile's
// brush source from 01-09 (geometry-xash.mjs, on SMAK's GoldSrc side: carvePlan, the brush builders, writeMap),
// writes it as `<tile>.map` beside 10-geometry.json, and gates it with the source checks: checkPlan (blocking: a
// brush that is no sound convex solid, a key or value the formats cannot hold, a point entity with no place or
// outside the extent, no spawn), no way out to the void (checkPlan's leak hint over a carve that has none by
// construction), the texture audit (every name in a WAD the clients have, or the kit's with --kit), the counts
// against engine.limits and the tile's share of them (brushes, structural brushes, carved rock, brush models,
// entities that stay, switchable lights), the carve's distinct heights per layer against rock.maxHeights, every
// name of the wiring contract present and at most 31 characters, unique.
//
// The whole map (the nine tiles' fragments without their caps) is written when every tile has its geometry: until
// then only the tile's own .map, capped at its seams so it compiles alone.
import { FILES, sha256 } from "./artifact.mjs";
import { metreRules } from "./stage3-programs.mjs";
import { buildTile, WALL } from "./geometry-xash.mjs";
import { textureResolver } from "./geometry-textures.mjs";
import { writeMap, shapeOf, offGrid } from "../../src/maps/source.mjs";
import { checkPlan } from "../../src/maps/plan.mjs";

/** Classes that leave no entity in the game: compiled into the world, or read by the compilers only. */
const GONE = new Set(["func_detail", "info_texlights", "light_environment"]);
/** A targetname the contract allows: letters, digits and `_`. */
const NAME = /^[A-Za-z0-9_]+$/;

/** Whether an entity stays in the game (an untargeted light is freed when the map loads). */
export const staysInGame = (e) => !GONE.has(e.classname) && !(/^light(_spot)?$/.test(e.classname) && !e.targetname);

/**
 * The source checks on a map (what writeMap takes): checkPlan with the engine's extent, the counts, the names.
 * `limits` { brushes, structural, rock, brushModels, entities } (the tile's share); `rock` the carve's brushes.
 * Returns { failures, notes, counts, check }.
 */
export function sourceChecks(map, { limits = {}, rock = 0, range = 32768, maxName = 31, starts = ["info_player_deathmatch"] } = {}) {
  const failures = [];
  const notes = [];
  const check = checkPlan(map, { range, starts, grid: 1, tolerance: 0.01 });
  for (const e of check.errors) failures.push(`checkPlan: ${e}`);
  if (check.leak) failures.push(`leak: the map is open to the void near ${check.leak.at.map(Math.round).join(" ")} (checkPlan's flood); the carve should leave none`); // prettier-ignore
  const worldBrushes = map.brushes.length;
  const ents = map.entities;
  const brushEnts = ents.filter((e) => e.brushes?.length);
  const detail = brushEnts.filter((e) => e.classname === "func_detail").reduce((s, e) => s + e.brushes.length, 0);
  const entityBrushes = brushEnts.filter((e) => e.classname !== "func_detail").reduce((s, e) => s + e.brushes.length, 0);
  const brushModels = brushEnts.filter((e) => e.classname !== "func_detail").length;
  const staying = ents.filter(staysInGame).length;
  const total = worldBrushes + detail + entityBrushes;
  const counts = { brushes: total, world: worldBrushes, structural: worldBrushes, rock, detail, entityBrushes, brushModels, entities: ents.length, staying }; // prettier-ignore
  const over = (what, value, limit, why) => {
    if (limit === undefined || limit === null) return;
    if (value > limit) failures.push(`${what}: ${value}, at most ${limit} (${why})`);
    else notes.push(`${what}: ${value} of ${limit} (${why})`);
  };
  over("brushes", total, limits.brushes, "the tile's share of engine.limits.brushes");
  over("structural brushes (world)", worldBrushes, limits.structural, "the tile's share of engine.limits.structural");
  over("carved rock", rock, limits.rock, "the tile's share of engine.limits.rock");
  over("brush models", brushModels, limits.brushModels, "the tile's share of engine.limits.brushModels");
  over("entities that stay", staying, limits.entities, "the tile's share of engine.limits.entities");
  // names: every targetname at most maxName, of the contract's letters, no name on two entities but a
  // switched light's (lights that switch together share one) or a sound's (the alarm's speakers answer one name)
  const seen = new Map();
  for (const e of ents) {
    const n = e.targetname;
    if (n === undefined) continue;
    if (String(n).length > maxName) failures.push(`name ${n} (${e.classname}) is ${String(n).length} characters, at most ${maxName}`);
    if (!NAME.test(String(n))) failures.push(`name ${n} (${e.classname}) holds a character other than letters, digits and _`);
    seen.set(n, [...(seen.get(n) ?? []), e.classname]);
  }
  for (const [n, list] of seen) if (list.length > 1 && !list.every((c) => /^light/.test(c)) && !list.every((c) => c === "ambient_generic")) failures.push(`name ${n} is on ${list.length} entities (${list.join(", ")})`); // prettier-ignore
  // every target answered
  for (const e of ents) {
    const targets = [e.target, ...(e.classname === "multi_manager" ? Object.keys(e).filter((k) => !["classname", "origin", "targetname"].includes(k)) : [])].filter(Boolean); // prettier-ignore
    for (const t of targets) if (!seen.has(t)) failures.push(`${e.classname} ${e.targetname ?? ""} targets ${t}, which no entity is named`);
  }
  // off the grid: told, not failed (a pipe's octagon and a secret stair's diagonal cannot keep to it)
  let off = 0;
  for (const b of [...map.brushes, ...brushEnts.flatMap((e) => e.brushes)]) if (offGrid(b, 1, 0.01).length) off++;
  if (off) notes.push(`${off} brushes have plane points off the 1-unit grid (turned or chamfered shapes; checkPlan warns of them)`);
  const buried = check.warnings.find((w) => /inside a world brush/.test(w));
  if (buried) notes.push(`checkPlan: ${buried}`);
  for (const w of check.warnings.filter((x) => /hang in the air/.test(x))) notes.push(`checkPlan: ${w}`);
  return { failures, notes, counts, check: { errors: check.errors, warnings: check.warnings, facts: check.facts, leak: check.leak ? { at: check.leak.at } : null } }; // prettier-ignore
}

export const stage = {
  n: 10,
  name: "geometry",
  reads: ["description", "rulebook", "01-site.json", "02-lots.json", "04-network.json", "05-plans.json", "06-palette.json", "07-wiring.json", "08-dressing.json", "09-forms.json"], // prettier-ignore
  run(ctx) {
    const desc = ctx.description;
    const options = { kit: Boolean(ctx.options?.kit), wads: ctx.options?.wads ?? [] };
    const rules = metreRules(ctx);
    const tex = textureResolver({ desc, kit: options.kit, wadFiles: options.wads });
    const built = buildTile(ctx, tex, rules);
    const audit = tex.audit();
    built.map.worldspawn.wad = audit.wads;
    const text = writeMap(built.map);
    const tile = ctx.inputs["01-site.json"].tile;
    const file = `${tile.id}.map`;
    const limits = tileLimits(desc);
    const checks = sourceChecks(built.map, { limits, rock: built.counts.rock, range: desc.engine?.limits?.extent?.value ?? 32768, maxName: desc.wiring?.maxNameLength ?? ctx.rulebook?.doors?.maxNameLength ?? 31 }); // prettier-ignore
    const kinds = {};
    for (const k of built.kinds) kinds[k] = (kinds[k] ?? 0) + 1;
    const byClass = {};
    for (const e of built.map.entities) byClass[e.classname] = (byClass[e.classname] ?? 0) + 1;
    const targetnames = built.map.entities.filter((e) => e.targetname !== undefined).map((e) => String(e.targetname));
    const portals = (ctx.inputs["01-site.json"].portals ?? []).map((p) => ({ id: p.id, seam: p.seam, at: p.at, layer: p.layer }));
    const body = {
      tile: tile.id,
      units: { cell: ctx.inputs["01-site.json"].grid.cell, cellUnits: ctx.inputs["01-site.json"].grid.cellUnits, origin: desc.grid.origin ?? [0, 0], note: "engine units: x = (cells - origin) x cellUnits, z = cells x cellUnits" }, // prettier-ignore
      options: { kit: options.kit, wads: options.wads.map((w) => w.split(/[\\/]/).pop()) },
      world: { worldspawn: { skyname: built.map.worldspawn.skyname, MaxRange: built.map.worldspawn.MaxRange, wad: audit.wads } },
      files: [{ file, sha256: sha256(text), bytes: Buffer.byteLength(text), what: `the tile's .map (Valve 220), capped at its seams: compiles alone` }], // prettier-ignore
      whole: { written: false, why: "the whole map is the nine tiles' fragments without their caps: written when every tile has its 10-geometry (only this tile has run)" }, // prettier-ignore
      counts: { ...checks.counts, worldByKind: built.counts.world, detailByKind: built.counts.detail, entitiesByKind: kinds, entitiesByClass: byClass }, // prettier-ignore
      limits,
      heights: built.heights,
      maxHeights: desc.rules?.rock?.maxHeights ?? {},
      seams: { box: built.tileU.map(Math.round), cap: WALL, portals, note: "every space clipped to the tile's box; the carve's outer rock (cap thick) closes each portal, so the tile compiles alone" }, // prettier-ignore
      contract: built.contract,
      targetnames,
      textures: audit,
      checks: checks.check,
      sourceNotes: checks.notes,
      sourceFailures: checks.failures,
      notes: built.notes,
      dropped: built.dropped,
    };
    Object.defineProperty(body, FILES, { value: { [file]: text }, enumerable: true });
    return body;
  },
  gate(artifact, ctx) {
    const failures = [...(artifact.sourceFailures ?? [])];
    const notes = [...(artifact.sourceNotes ?? [])];
    const desc = ctx.description;
    // the counts against the limits, recounted from the artifact (a changed copy is held as it now is)
    const c = artifact.counts ?? {};
    const L = artifact.limits ?? tileLimits(desc);
    const past = (what, v, lim) => v !== undefined && lim !== undefined && lim !== null && v > lim && !failures.some((f) => f.startsWith(`${what}:`)) && failures.push(`${what}: ${v}, at most ${lim} (the tile's share)`); // prettier-ignore
    past("brushes", c.brushes, L.brushes);
    past("structural brushes (world)", c.structural, L.structural);
    past("carved rock", c.rock, L.rock);
    past("brush models", c.brushModels, L.brushModels);
    past("entities that stay", c.staying, L.entities);
    if (L.detail !== undefined && c.detail > L.detail) notes.push(`detail brushes: ${c.detail}, past PLAN.md's target of ${L.detail} for a tile (a target, not a limit)`); // prettier-ignore
    // the carve's heights per layer
    for (const [lid, hs] of Object.entries(artifact.heights ?? {})) {
      const max = (artifact.maxHeights ?? desc.rules?.rock?.maxHeights ?? {})[lid];
      if (max !== undefined && hs.length > max) failures.push(`rock: ${artifact.tile} on ${lid} is carved at ${hs.length} distinct heights (${hs.join(", ")}), at most ${max} (rock.maxHeights)`); // prettier-ignore
      else notes.push(`rock: ${lid} carved at ${hs.length} heights (${hs.join(", ")})${max !== undefined ? `, at most ${max}` : ""}`);
    }
    // the texture audit
    const T = artifact.textures ?? {};
    for (const n of T.unresolved ?? []) failures.push(`texture ${n} is in no WAD the clients have${T.kit ? " nor the kit's" : ""} (the texture audit)`);
    for (const n of T.tooLong ?? []) failures.push(`texture ${n} is ${n.length} characters, at most 15`);
    if ((T.standIns ?? []).length) notes.push(`textures: ${T.standIns.length} roles wear an on-client stand-in until the kit has them: ${T.standIns.map((s) => `${s.role} -> ${s.used}`).join(", ")}`); // prettier-ignore
    // the wiring contract: every name of 07 in the map
    const W = ctx.inputs?.["07-wiring.json"];
    const names = new Set(artifact.targetnames ?? []);
    if (W) {
      const want = [
        ...W.doors.map((d) => ["door", d.name]),
        ...W.switches.map((s) => ["switch", s.name]),
        ...W.lights.map((l) => ["switchable light", l.name]),
        ...W.sounds.filter((s) => s.name).map((s) => ["sound", s.name]),
        ...W.lifts.flatMap((l) => (l.stops.filter((s) => s.inTile).length >= 2 ? [["lift", l.name], ...l.stops.filter((s) => s.inTile).flatMap((s) => [["lift stop", s.name], ...(s.call ? [["call button", s.call]] : [])])] : [])), // prettier-ignore
      ];
      const missing = want.filter(([, n]) => !names.has(n));
      for (const [k, n] of missing.slice(0, 12)) failures.push(`the contract's ${k} ${n} is not in the map`);
      if (missing.length > 12) failures.push(`... and ${missing.length - 12} more of the contract's names not in the map`);
      const spawns = artifact.contract?.spawns ?? [];
      if (spawns.length < W.spawns.order.length) failures.push(`spawns: ${spawns.length} in the map, 07 orders ${W.spawns.order.length}`);
    }
    for (const n of artifact.targetnames ?? []) {
      const max = desc.wiring?.maxNameLength ?? 31;
      if (n.length > max && !failures.some((f) => f.startsWith(`name ${n} `))) failures.push(`name ${n} is ${n.length} characters, at most ${max}`); // prettier-ignore
    }
    if ((artifact.dropped ?? []).length) notes.push(`${artifact.dropped.length} things outside the tile's box left out: ${artifact.dropped.slice(0, 4).join("; ")}`); // prettier-ignore
    notes.push(...(artifact.notes ?? []).slice(0, 20));
    notes.push(artifact.whole?.why ?? "");
    return { failures, notes: notes.filter(Boolean) };
  },
};

/** The tile's share of engine.limits (tiles.maxShare), with PLAN.md's detail target for a tile. */
export function tileLimits(desc) {
  const share = desc.rules?.tiles?.maxShare ?? 0.25;
  const lim = desc.engine?.limits ?? {};
  const of = (k) => (lim[k]?.value > 0 ? Math.floor(lim[k].value * share) : undefined);
  return { share, brushes: of("brushes"), structural: of("structural"), rock: of("rock"), brushModels: of("brushModels"), entities: of("entities"), detail: Math.floor(10000 * share) }; // prettier-ignore
}

export { shapeOf };
