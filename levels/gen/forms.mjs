// Stage 9's shared part (levels/gen/stage9-forms.mjs): the forms context a family places in, the parts and
// instances it returns, the checks every form is held to whatever its family, and the brush and entity budget.
// The forms themselves come from family modules, `levels/gen/forms-<family>.mjs`, each exporting `family` (the
// contract is in levels/gen/ARTIFACTS.md, "9 09-forms.json"); this file loads them in their order.
//
// Units: x, y, z in cells like every artifact; the rulebook's `forms` section (metres) converted to cells on the
// 16-unit grid (an eighth of a cell) by `formRules`. Stage 8's street helpers (dressing.mjs) are reused for what a
// form must keep clear and for the walk, in their world metres.
//
// Written rules every form is held to (a family adds its own):
//   - A part is one convex brush (its `poly` the outline in plan, convex, z0 < z1), but for a `cut` (rock carved,
//     only a family's oculus or shaft): counted in `rock` instead of `brushes`.
//   - No part enters what the stages before placed (connector pieces, hallway legs, checkpoint rooms, posts,
//     enterable buildings and their towers, monuments, colonnade columns, street props), but a part marked
//     `embeds` may enter a facade lot (uncarved rock: a pier embedded in the street wall, a corbel on its face).
//   - No part below its layer's zone head (ZONE_HEAD cells over the floor) enters a carriageway and its kerb, a way's
//     mouth into a plaza, a portal's mouth, a connector exit's approach or a gate (stage 8's streetZones); no part
//     enters a door's approach or swing, a spawn, a sign's or a lamp's keep-clear box (streetZones' boxes).
//   - A part standing at the hull's height on a layer's floor blocks the street walk there: every pair of street
//     entries (street doors, connector exits, portals) the empty floor joined at a public corridor's width (else the
//     hull) stays joined with stage 8's street props and every form standing (streetWalk).
//   - M18: an instance's brushes at most forms.maxBrushesBy[kind]. M19: only a cut carves rock, through the deck's
//     band only (its z the layer's top and the next floor: no new carve height); the forms' rock at most
//     forms.maxRockShare of engine.limits.rock in the tile's share. M20: every frame form wears its layer's `frame`
//     role, a role of the materials no district's palette holds (the frame crosses districts, one material a layer).
//   - The tile's brushes (stage 8's total, the description's estimate with its props) plus the forms' brushes and
//     rock within the tile's share of engine.limits.brushes; its entities (07's and 08's model props) plus the forms'
//     within its share of engine.limits.entities.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PLAIN } from "../lib/architecture-rules.mjs";
import { ESTIMATE, tileEstimateOf } from "../lib/city-checks.mjs";
import { HERE } from "./common.mjs";
import { r3, polyOverlap, polyBox, rectPoly } from "./geom.mjs";
import { streetWorld, streetZones, streetSigns, streetEntries, streetWalk, fittingsOf, hullCells, walkCells, _internal } from "./dressing.mjs"; // prettier-ignore

/** A family module's file name. */
export const FAMILY_FILE = /^forms-[a-z0-9-]+\.mjs$/;
/** How high over a layer's floor its street zones (carriageways, mouths, portals, exits, gates) are kept clear, cells. */
export const ZONE_HEAD = 3;
/** A form's part standing within this of a layer's floor blocks the walk: the hull's 72 units (cells). */
export const HULL_HEAD = 72 / 128;
const EPS = 0.01;

// ── the families ──

/**
 * The family modules (levels/gen/forms-*.mjs, each exporting `family`), checked against the contract and sorted by
 * `order`, then id. Throws naming a module that breaks the contract.
 */
export async function loadFamilies(dir = HERE) {
  const out = [];
  for (const f of readdirSync(dir).filter((x) => FAMILY_FILE.test(x)).sort()) {
    const mod = await import(pathToFileURL(join(dir, f)).href);
    const fam = mod.family;
    const why = familyFaults(fam);
    if (why.length) throw new Error(`levels/gen/${f}: not a forms family (${why.join("; ")})`);
    out.push({ ...fam, file: f });
  }
  const ids = new Set();
  for (const f of out) {
    if (ids.has(f.id)) throw new Error(`forms family "${f.id}" is given twice (${out.filter((x) => x.id === f.id).map((x) => x.file).join(", ")})`); // prettier-ignore
    ids.add(f.id);
  }
  return out.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
/** What a module's `family` lacks of the contract (empty when it keeps it). */
export function familyFaults(fam) {
  const out = [];
  if (!fam || typeof fam !== "object") return ["exports no `family` object"];
  if (typeof fam.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(fam.id)) out.push("`id` wanted a lower-case name");
  if (!Number.isFinite(fam.order)) out.push("`order` wanted a number (the run order among the families)");
  if (!Array.isArray(fam.forms) || !fam.forms.every((x) => /^[FS]\d+$/.test(x))) out.push("`forms` wanted the vocabulary's ids it places (F1 ... F27, the scale illusion's means S1 ... S8)");
  if (typeof fam.place !== "function") out.push("`place(fx)` wanted: returns { forms, failures, notes }");
  if (fam.check !== undefined && typeof fam.check !== "function") out.push("`check(forms, fx)` wanted a function or nothing");
  return out;
}

// ── the rules in cells ──

const KEEP = new Set(["maxBrushesBy", "source", "modeByWealth", "cageDensities", "guards", "cagesPerFace"]);
/** The rulebook's `forms` section in cells: every length divided by the cell and snapped to the 16-unit grid. */
export function formRules(forms, cell) {
  const conv = (node, key) => {
    if (Array.isArray(node)) return node.map((v) => conv(v, key));
    if (node && typeof node === "object") {
      const o = {};
      for (const [k, v] of Object.entries(node)) o[k] = KEEP.has(k) ? v : conv(v, k);
      return o;
    }
    if (typeof node !== "number" || PLAIN.has(key)) return node;
    return Math.round((node / cell) * 8) / 8;
  };
  return conv(forms ?? {}, "forms");
}

// ── parts and instances ──

/** A part: one convex brush (or a `cut` of rock). `top` an outline at z1 (a frustum), `edge` a wedge's full-height edge. */
export function part(shape, poly, z, extra = {}) {
  return { shape, poly: poly.map((p) => [r3(p[0]), r3(p[1])]), z: [r3(z[0]), r3(z[1])], ...extra, ...(extra.top ? { top: extra.top.map((p) => [r3(p[0]), r3(p[1])]) } : {}), ...(extra.edge ? { edge: extra.edge.map((p) => [r3(p[0]), r3(p[1])]) } : {}) }; // prettier-ignore
}
/**
 * An instance of a form with its counts: brushes (parts not cut), rock (the cuts' estimate), entities and brush
 * models. Entity parts sharing a `group` are one brush entity (a fan's hub and blades: one func_rotating); `points`
 * are point entities ({ classname, at: [x, y, z] cells, keys }: a sound loop, a sprite, a train's path_corner), one
 * entity each and no brush.
 */
export function instance(fields) {
  const parts = fields.parts ?? [];
  const points = fields.points ?? [];
  const brushes = parts.filter((p) => p.build !== "cut").length;
  const rock = parts.filter((p) => p.build === "cut").reduce((s, p) => s + (p.rock ?? 0), 0);
  const groups = new Set(parts.map((p, i) => (p.build === "entity" ? p.group ?? `#${i}` : null)).filter((g) => g !== null));
  const entityBrushes = parts.filter((p) => p.build === "entity").length;
  return { ...fields, parts, ...(points.length ? { points } : {}), brushes, rock, entities: groups.size + points.length, brushModels: groups.size, entityBrushes }; // prettier-ignore
}
export const isConvex = (poly) => {
  if (poly.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [a, b, c] = [poly[i], poly[(i + 1) % poly.length], poly[(i + 2) % poly.length]];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < 1e-9) continue;
    if (sign && Math.sign(cr) !== sign) return false;
    sign = Math.sign(cr);
  }
  return sign !== 0;
};
export const boxPoly = (b) => [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];

// ── the context ──

/** The forms context: what a family reads (the artifacts, the rules in cells, the deck) and the shared tests. */
export function formsContext(ctx, rules) {
  const inputs = ctx.inputs;
  const desc = ctx.description;
  const site = inputs["01-site.json"];
  const lots = inputs["02-lots.json"];
  const net = inputs["04-network.json"];
  const dressing = inputs["08-dressing.json"];
  const cell = site.grid.cell;
  const R = formRules(rules.forms, cell);
  const layers = site.layers;
  const layerOf = (id) => layers.find((L) => L.id === id) ?? null;
  const storeyCells = site.grid.storey ?? desc.grid.storey;
  const deckL = layers.find((L) => L.ceiling === "deck");
  const over = deckL ? layers.find((L) => L.level === deckL.level + 1) : null;
  const deck = deckL && over ? { layer: deckL.id, over: over.id, box: over.bounds, soffit: deckL.top, top: over.floor } : null;
  const fit = fittingsOf(inputs);
  const worlds = new Map();
  const world = (lid) => {
    if (!worlds.has(lid)) {
      const W = streetWorld({ desc, inputs, layer: lid });
      const signs = streetSigns(inputs, lid, rules);
      const Z = streetZones({ desc, rules, inputs, layer: lid, W, fit, signs });
      const ent = streetEntries({ inputs, layer: lid, W });
      worlds.set(lid, { W, Z, ent, base: null });
    }
    return worlds.get(lid);
  };
  const fx = { desc, rules, R, cell, cu: site.grid.cellUnits, storey: storeyCells, inputs, site, lots, net, dressing, tile: site.tile, layers, layerOf, deck, world, seed: ctx.params.seed }; // prettier-ignore
  fx.solids = solidsOf(fx);
  fx.keep = (lid) => keepOf(fx, lid);
  return fx;
}

/** The deck: whether a point stands under it (inside the upper layer's bounds). */
export const underDeck = (fx, p, e = 0) => !!fx.deck && p[0] >= fx.deck.box[0] - e && p[0] <= fx.deck.box[2] + e && p[1] >= fx.deck.box[1] - e && p[1] <= fx.deck.box[3] + e; // prettier-ignore

/** What the stages before placed, as 3D solids in cells: { what, kind, id, layer, poly, z, soft }. */
function solidsOf(fx) {
  const out = [];
  const hallPoly = (a, b, w) => boxPoly([Math.min(a[0], b[0]) - w / 2, Math.min(a[1], b[1]) - w / 2, Math.max(a[0], b[0]) + w / 2, Math.max(a[1], b[1]) + w / 2]); // prettier-ignore
  for (const c of fx.net.connectors) for (const p of c.pieces ?? []) out.push({ what: `${c.id}'s ${p.kind}`, kind: "connector", id: c.id, poly: p.poly, z: p.z }); // prettier-ignore
  for (const h of fx.net.hallways ?? []) for (const lg of h.legs ?? []) out.push({ what: `hallway ${h.id}`, kind: "hallway", id: h.id, layer: h.layer, poly: hallPoly(lg.from, lg.to, h.width ?? 1.5), z: lg.z }); // prettier-ignore
  for (const k of fx.net.checkpoints ?? []) k.rooms.forEach((r, i) => out.push({ what: `${k.id}'s ${r.kind}`, kind: "checkpoint", id: `${k.id}.${i}`, layer: k.layer, poly: r.poly ?? rectPoly(r.rect), z: r.z })); // prettier-ignore
  for (const p of fx.net.posts ?? []) out.push({ what: `post ${p.id}`, kind: "post", id: p.id, layer: p.layer, poly: rectPoly(p.rect), z: p.z }); // prettier-ignore
  for (const l of fx.lots.lots) {
    if (l.kind === "enterable") {
      out.push({ what: `building ${l.building}`, kind: "building", id: l.building, layer: l.layer, poly: rectPoly(l.rect), z: [l.zBase, r3(l.zBase + l.storeys * fx.storey)] }); // prettier-ignore
      if (l.tower) out.push({ what: `${l.building}'s tower`, kind: "tower", id: l.building, layer: l.layer, poly: boxPoly([l.tower.at[0] - l.tower.across / 2, l.tower.at[1] - l.tower.across / 2, l.tower.at[0] + l.tower.across / 2, l.tower.at[1] + l.tower.across / 2]), z: l.tower.z }); // prettier-ignore
    } else out.push({ what: `facade ${l.id}`, kind: "facade", id: l.id, layer: l.layer, poly: rectPoly(l.rect), z: [l.zBase, r3(l.zBase + (l.facade?.height ?? 1))], soft: true }); // prettier-ignore
  }
  for (const p of fx.site.plazas) for (const mo of p.monuments ?? []) out.push({ what: `monument ${mo.id}`, kind: "monument", id: mo.id, layer: p.layer, poly: boxPoly([mo.at[0] - mo.base[0] / 2, mo.at[1] - mo.base[1] / 2, mo.at[0] + mo.base[0] / 2, mo.at[1] + mo.base[1] / 2]), z: mo.z }); // prettier-ignore
  for (const col of fx.net.colonnades ?? []) for (const c of col.columns) out.push({ what: `${col.ref ?? col.plaza}'s column`, kind: "column", id: col.ref ?? col.plaza, layer: col.layer, poly: boxPoly([c.at[0] - col.column / 2, c.at[1] - col.column / 2, c.at[0] + col.column / 2, c.at[1] + col.column / 2]), z: col.z }); // prettier-ignore
  for (const p of fx.dressing?.props ?? []) if (p.place === "street") out.push({ what: `prop ${p.id}`, kind: "prop", id: p.id, layer: p.layer, poly: rectPoly(p.rect), z: [p.z, r3(p.z + p.size_m[2] / fx.cell)] }); // prettier-ignore
  return out;
}

/** A layer's keep-clear in cells: its street zones (2D, to ZONE_HEAD over the floor; walking lanes left out) and boxes (3D). */
function keepOf(fx, lid) {
  const L = fx.layerOf(lid);
  const { Z } = fx.world(lid);
  const c = fx.cell;
  const zones = Z.zones.filter((z) => z.kind !== "lane").map((z) => ({ what: z.what, kind: z.kind, poly: z.poly.map((p) => [p[0] / c, p[1] / c]), z: [L.floor, L.floor + ZONE_HEAD] })); // prettier-ignore
  const boxes = Z.boxes.map((b) => ({ what: b.what, poly: boxPoly([b.min[0] / c, b.min[1] / c, b.max[0] / c, b.max[1] / c]), z: [b.min[2] / c, b.max[2] / c] })); // prettier-ignore
  return { zones, boxes };
}

const zMeet = (a, b) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]);

/**
 * What a part enters: [{ what, by }] (cells). `layers`: the layers whose keep-clear it is tested against (default
 * every layer whose floor-to-lid band it meets); `ignore(solid)`: solids it may meet (its own connector, say).
 */
export function partFaults(fx, p, { ignore = () => false, layers = null } = {}) {
  const out = [];
  for (const s of fx.solids) {
    if (zMeet(s.z, p.z) <= EPS || ignore(s)) continue;
    if (s.soft && p.embeds) continue;
    const d = polyOverlap(p.poly, s.poly);
    if (d > EPS) out.push({ what: s.what, by: r3(d), kind: s.kind });
  }
  const ls = layers ?? fx.layers.filter((L) => p.z[0] < (L.sky ?? L.top) && p.z[1] > L.floor).map((L) => L.id);
  for (const lid of ls) {
    const K = fx.keep(lid);
    for (const z of [...K.zones, ...K.boxes]) {
      if (zMeet(z.z, p.z) <= EPS) continue;
      const d = polyOverlap(p.poly, z.poly);
      if (d > EPS) out.push({ what: z.what, by: r3(d), kind: z.kind ?? "keep-clear" });
    }
  }
  return out;
}

/** Parts standing on a layer's floor (blocking the walk): their footprints in world metres. */
export function standingFeet(fx, lid, instances) {
  const L = fx.layerOf(lid);
  const c = fx.cell;
  const out = [];
  for (const f of instances)
    for (const p of f.parts) {
      if (p.build === "cut" || p.build === "entity") continue;
      if (!(p.z[0] < L.floor + HULL_HEAD - 1e-6 && p.z[1] > L.floor + 0.14)) continue;
      const b = polyBox(p.poly);
      out.push({ foot: [b[0] * c, b[1] * c, b[2] * c, b[3] * c], collision: true, form: f.id });
    }
  return out;
}

/** The street walk on a layer with stage 8's street props and these forms standing: the pairs it no longer joins. */
export function walkBreaks(fx, lid, instances) {
  const w = fx.world(lid);
  const probes = { walk: walkCells(fx.rules.dimensions.corridors.public.width.min), hull: hullCells(fx.rules) };
  if (!w.base) {
    const base = streetWalk(w.W, w.ent, [], probes);
    w.need = _internal.pairsOf(base, w.ent.length);
    w.props = (fx.dressing?.props ?? []).filter((p) => p.place === "street" && p.layer === lid && p.collision).map((p) => ({ foot: [p.rect.x * fx.cell, p.rect.y * fx.cell, (p.rect.x + p.rect.w) * fx.cell, (p.rect.y + p.rect.d) * fx.cell], collision: true })); // prettier-ignore
    w.base = base;
  }
  const feet = standingFeet(fx, lid, instances);
  if (!feet.length) return [];
  const st = streetWalk(w.W, w.ent, [...w.props, ...feet], probes);
  return w.need.filter(([i, j, pr]) => !_internal.meets(st[pr].at[i], st[pr].at[j])).map(([i, j, pr]) => ({ a: w.ent[i], b: w.ent[j], probe: pr, feet })); // prettier-ignore
}

// ── the checks every form is held to ──

/** The frame role of a layer and why it is not usable (null when it is). */
export function frameRoleFault(fx, lid) {
  const L = fx.layerOf(lid);
  const role = L?.frame ?? null;
  if (!role) return `${lid} names no frame role (layers[].frame): the frame wears one role a layer (M20)`;
  if (!fx.desc.materials?.[role]) return `${lid}'s frame role "${role}" is no material's role`;
  const holder = (fx.desc.districts ?? []).find((d) => Object.values(d.palette ?? {}).some((rs) => Array.isArray(rs) && rs.includes(role)));
  if (holder) return `${lid}'s frame role "${role}" is in district ${holder.id}'s palette: the frame crosses districts, its role is its own (M20)`;
  return null;
}

/** The checks of stage 9 that hold whatever the family: { failures, notes }. */
export function commonChecks(forms, fx, families) {
  const failures = [];
  const notes = [];
  const R = fx.R;
  const famIds = new Set(families.map((f) => f.id));
  const ids = new Set();
  for (const f of forms) {
    const at = `form ${f.id}`;
    if (ids.has(f.id)) failures.push(`${at}: its id is given twice`);
    ids.add(f.id);
    if (!famIds.has(f.family)) failures.push(`${at}: family "${f.family}" is no loaded family`);
    if (!fx.layerOf(f.layer)) failures.push(`${at}: layer ${f.layer} is not one of the tile's`);
    if (!/^[FS]\d+$/.test(f.form ?? "")) failures.push(`${at}: wanted its vocabulary id (F1 ... F27, S1 ... S8), got ${JSON.stringify(f.form)}`);
    if (!f.parts?.length && !f.points?.length) failures.push(`${at}: no parts`);
    for (const [i, p] of (f.parts ?? []).entries()) {
      if (!isConvex(p.poly)) failures.push(`${at} part ${i} (${p.shape}): its outline is not convex`);
      if (!(p.z[1] > p.z[0])) failures.push(`${at} part ${i} (${p.shape}): z ${p.z[0]} to ${p.z[1]} is empty`);
    }
    // M18: the instance's brushes
    const max = R.maxBrushesBy?.[f.kind];
    if (max !== undefined && f.brushes > max) failures.push(`${at}: a ${f.kind} of ${f.brushes} brushes, at most ${max} (forms.maxBrushesBy, M18)`);
    // M20: the frame's role
    if (f.frame) {
      const why = frameRoleFault(fx, f.layer);
      if (why) failures.push(`${at}: ${why}`);
      else if (f.role !== fx.layerOf(f.layer).frame) failures.push(`${at}: wears "${f.role}", its layer ${f.layer}'s frame role is "${fx.layerOf(f.layer).frame}" (M20)`); // prettier-ignore
    }
    // what it enters
    for (const [i, p] of (f.parts ?? []).entries()) {
      if (p.build === "cut") continue;
      for (const x of partFaults(fx, p, { ignore: (s) => (f.around ?? []).includes(s.id) })) failures.push(`${at} part ${i} (${p.shape}) enters ${x.what} by ${x.by} cells`); // prettier-ignore
    }
    // M19: only a cut carves, through the deck's band, or a shaft down from the lowest layer's floor (`shaft`)
    const lowest = fx.layers.reduce((m, L) => (L.level < m.level ? L : m), fx.layers[0]);
    for (const p of (f.parts ?? []).filter((q) => q.build === "cut")) {
      if (p.shaft) {
        if (Math.abs(p.z[1] - lowest.floor) > 1e-6 || !(p.z[0] < p.z[1])) failures.push(`${at}: its shaft spans z ${p.z[0]} to ${p.z[1]}, wanted from below down to ${lowest.id}'s floor ${lowest.floor} (M19)`); // prettier-ignore
        continue;
      }
      if (!fx.deck || Math.abs(p.z[0] - fx.deck.soffit) > 1e-6 || Math.abs(p.z[1] - fx.deck.top) > 1e-6) failures.push(`${at}: its cut spans z ${p.z[0]} to ${p.z[1]}, not the deck's band ${fx.deck ? `${fx.deck.soffit} to ${fx.deck.top}` : "(no deck)"}: no form adds a carve height (M19)`); // prettier-ignore
    }
  }
  // the walk on each layer a form stands on
  for (const L of fx.layers) {
    const standing = forms.filter((f) => f.parts.some((p) => p.build !== "cut" && p.build !== "entity" && p.z[0] < L.floor + HULL_HEAD && p.z[1] > L.floor + 0.14)); // prettier-ignore
    if (!standing.length) continue;
    for (const br of walkBreaks(fx, L.id, standing)) failures.push(`walk on ${L.id}: ${br.a.what} and ${br.b.what} are no longer joined (${br.probe === "walk" ? "a public corridor's width" : "the hull"}) with the forms standing`); // prettier-ignore
  }
  // M19: the forms' rock in the tile's share
  const rock = forms.reduce((s, f) => s + (f.rock ?? 0), 0);
  const share = fx.desc.rules?.tiles?.maxShare ?? 0.25;
  const rockMax = Math.floor((fx.desc.engine?.limits?.rock?.value ?? 6000) * (R.maxRockShare ?? 0.02) * share);
  if (rock > rockMax) failures.push(`rock: the forms carve ${rock} brushes of rock in the tile, at most ${rockMax} (forms.maxRockShare ${R.maxRockShare} of engine.limits.rock in the tile's share, M19)`); // prettier-ignore
  failures.push(...allowanceFaults(forms, fx));
  return { failures, notes };
}

/**
 * The brushes a form claims are already in the description's estimate (`allowance`, `allowanceOf: { building, kind }`):
 * a building's facade allowance (ESTIMATE.facadePerCellStorey: a brush a cell of perimeter a storey, the notes' trade 3:
 * relief instead of window frames) or its tower's crown and cap (ESTIMATE.tower.brushesFixed less the shaft). Every
 * claim within the instance's brushes, each building's claims within what the estimate gave it.
 */
export function allowanceFaults(forms, fx) {
  const out = [];
  const E = { ...ESTIMATE, ...(fx.desc.engine?.estimate ?? {}) };
  const sums = new Map();
  for (const f of forms) {
    if (!f.allowance) continue;
    const a = f.allowanceOf;
    const b = (fx.desc.buildings ?? []).find((x) => x.id === a?.building);
    if (!b || !["facade", "tower"].includes(a?.kind)) out.push(`form ${f.id}: claims ${f.allowance} brushes of an allowance (${JSON.stringify(a)}) the description does not give`); // prettier-ignore
    else if (!(f.allowance > 0 && f.allowance <= f.brushes)) out.push(`form ${f.id}: claims ${f.allowance} brushes of ${a.building}'s ${a.kind} allowance, more than its ${f.brushes}`); // prettier-ignore
    else sums.set(`${a.building}|${a.kind}`, (sums.get(`${a.building}|${a.kind}`) ?? 0) + f.allowance);
  }
  for (const [k, n] of sums) {
    const [id, kind] = k.split("|");
    const b = fx.desc.buildings.find((x) => x.id === id);
    const cap = kind === "facade" ? Math.round(2 * (b.footprint[0] + b.footprint[1]) * b.storeys * (E.facadePerCellStorey?.brushes ?? 1)) : b.tower ? Math.max(0, (E.tower?.brushesFixed ?? 3) - 1) : 0; // prettier-ignore
    if (n > cap) out.push(`allowance: the forms claim ${n} brushes of ${id}'s ${kind} allowance, the description's estimate gives it ${cap}`);
  }
  return out;
}

// ── measures and the budget ──

export function measuresOf(forms, fx) {
  const byForm = {};
  const byFamily = {};
  const byKind = {};
  for (const f of forms) {
    for (const [m, k] of [[byForm, f.form], [byFamily, f.family], [byKind, f.kind]]) {
      m[k] ??= { instances: 0, brushes: 0, rock: 0, entities: 0 };
      m[k].instances++;
      m[k].brushes += f.brushes;
      m[k].rock += f.rock;
      m[k].entities += f.entities;
    }
  }
  const sum = (k) => forms.reduce((s, f) => s + (f[k] ?? 0), 0);
  const world = forms.reduce((s, f) => s + f.parts.filter((p) => p.build === "world").length, 0);
  // a brush entity's brushes (several parts of one group are one entity: a fan), counted apart from its entities
  const entityBrushes = forms.reduce((s, f) => s + (f.entityBrushes ?? f.parts.filter((p) => p.build === "entity").length), 0);
  const brushes = { detail: sum("brushes") - world - entityBrushes, world, entity: entityBrushes, rock: sum("rock") };
  brushes.total = brushes.detail + brushes.world + brushes.entity + brushes.rock;
  return { forms: forms.length, byForm: sorted(byForm), byFamily: sorted(byFamily), byKind: sorted(byKind), brushes, entities: sum("entities"), brushModels: sum("brushModels"), budget: budgetOf(forms, fx, brushes) }; // prettier-ignore
}
const sorted = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true })));

/** The tile's budget with the forms: brushes, entities and leaves, before (stage 8) and after. */
export function budgetOf(forms, fx, brushes) {
  const bb = fx.dressing?.measures?.brushBudget ?? {};
  const mp = fx.dressing?.measures?.modelProps ?? {};
  const est = (() => {
    try {
      return tileEstimateOf(fx.desc, fx.tile.id);
    } catch {
      return null;
    }
  })();
  const E = { ...ESTIMATE, ...(fx.desc.engine?.estimate ?? {}) };
  const before = bb.total ?? null;
  // what the forms claim of the description's facade and tower allowances is in stage 8's total already
  const allowance = forms.reduce((s, f) => s + Math.min(Math.max(0, f.allowance ?? 0), f.brushes ?? 0), 0);
  const formsBrushes = brushes.total - allowance;
  const total = before === null ? null : before + formsBrushes;
  const entBefore = (mp.wiringEntities ?? 0) + (mp.placed ?? 0);
  const formsEntities = forms.reduce((s, f) => s + (f.entities ?? 0), 0);
  const structural = est?.structural ?? 0;
  const leaves = (b, s) => Math.round(Math.max(s * E.leavesPerStructural, (b - s) * E.leavesPerBrush));
  const formsStructural = brushes.rock + brushes.world;
  return {
    brushes: { before, forms: formsBrushes, ...(allowance ? { allowance } : {}), total, limit: bb.limit ?? null, target: bb.target ?? null },
    entities: { before: entBefore, forms: formsEntities, total: entBefore + formsEntities, limit: mp.limit ?? null },
    leaves: before === null ? null : { before: leaves(before, structural), total: leaves(total, structural + formsStructural), structural: structural + formsStructural, note: "the description's estimate's two terms (2.2 a structural brush, 1.5 a brush besides; UNCALIBRATED until the Core is compiled): detail cuts no leaf, so only the forms' rock and world brushes add structure" }, // prettier-ignore
    note: "brushes: stage 8's total for the tile (the description's estimate with the props placed, each room's dressing allowance taken out) plus every form's brushes and its rock; entities: 07's that stay and 08's model props, plus the forms' (grates); limits: the tile's maxShare of engine.limits",
  };
}
