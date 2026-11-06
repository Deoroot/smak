// The edges, vaults and scale family of stage 9 (levels/experimental-city/stage9-forms.mjs): the undercity built as vaults under
// the city's frame, its column halls, arcades on the squares, gantries, raised ground, the city wall with its towers,
// the backdrop beyond it and the scale illusion's means the description can place (levels/notes-megastructure.md F10,
// F11, F12, F19, F20, F21, F25 and section 7, its means S1-S7; the rulebook's `forms` section; the checks M14, M15,
// M17, M21 and the description-level parts of V3, V4, V7, V8). A pure function of the forms context.
//
// Written rules (each a sentence the family's check holds or the placer obeys):
//   - Budget. Every form here is counted into the tile's brushes and entities (stage 9's gate). What M14 and M17
//     need (vaults, ribs, canal arches, hall columns, wall towers and the wall's relief) is placed while the tile
//     stays under its limit, else the family fails with a sentence; the rest (light shafts, fans, architraves,
//     daises, an arcade, a gantry, searchlights) only within forms.edges.maxShareOfHeadroom of what the tile has
//     left after the families before it, so a family after this one keeps the rest. The trades it takes are notes.
//   - Vaults (F11). Over each straight leg of a public way of a vaulted layer in the tile (no service way): two
//     chamfer wedges in the ceiling's corners (forms.vault.chamfer, its lower edge at least vault.springing.min over
//     the floor), cut round what passes and never where the wall behind is open floor; a rib (two haunches and a
//     crown band) at stations at most vault.rib.every.max apart, sliding no further than keeps that pitch. The
//     ceiling is the way's carve height: its floor plus its clearance on the half-storey grid, at most the layer's
//     top (city-checks.mjs rockCuts). A canal's way is vaulted by segmental arches across its full width at the
//     same pitch (vault.canalArch: its segments, its rise), each segment one brush (`voussoir`).
//   - Halls (F12). Each plaza of a vaulted layer at least cistern.minSide square, not a basin (no canal ends in it):
//     a column grid at a pitch within cistern.pitch (largest first), centred and shifted by quarter cells to stand
//     the most columns; a column an 8-sided shaft and an impost to the layer's top (as tall as the hall); a column
//     that would enter anything is left out (a pier foot there stands for it), at least cistern.minShare of the grid
//     standing; the walk kept (a column cutting it goes). Architraves along the grid lines under the vault, cut round
//     what passes.
//   - Arcades (F10). On one side of at most arcade.maxPerTile plazas of an open layer (no portico of its own, every
//     side at least arcade.minSide): piers arcade.depth in from the edge at a span within arcade.span, round arches
//     of 4 segments (6 past 2 cells clear) springing at arcade.springing; an arch only between two piers standing.
//   - Gantries (F19). Over a public way of the deck's layer between two facades at most gantry.maxPerTile a tile, a
//     plate, two rails (dimensions.parapets) and two brackets, its underside gantry.over.min over the way's
//     clearance: dressing out of reach, never walked (V7).
//   - Ground (F25). On at most ground.maxPerTile plazas a dais raised one step (ground.step.max, under the hull's
//     step): raised, never sunk; never in a mouth, a keep-clear volume or over an opening.
//   - The wall (F20). On each side of the city the tile reaches: towers on one rhythm round the city
//     (wall.tower.pitch.typical, the side's length split evenly, the corners on the north and south sides), each an
//     8-sided tower wall.tower.across wide centred on the wall's line (projecting half of it), rising
//     wall.tower.rise.min over the wall's top (wall.top.min) with a cornice, a crown and a cap, and a door at its
//     foot (the scale pair, V8); sliding at most wall.tower.slide.max; a gate on the side flanked by two towers and
//     no tower of the rhythm in it. Where public floor reaches the wall between towers, the wall's face gets a
//     string course, a battered plinth and pilasters at most wall.pilaster.every.max apart (V3: no bare face).
//   - Backdrop (F21, S2, S3). Beyond each such side, over the tile's span, a pocket of carved air from the wall's top
//     to the sky lid, backdrop.pocket.depth deep (world.backdrop: its rock is the map's, not the tile's); skyline
//     cards (one func_illusionary each, masked) at most backdrop.card.every.max apart at two depths; a backdrop
//     model in each pocket; a viaduct train (func_train and its path_corners) in the east and west pockets' middle
//     tiles, an airship in the north and south ones. An outside gate's way goes on beyond it as a road pocket with
//     lamps and fog cards, closed by an end card from its floor past the eye (M21).
//   - Scale cues (S4, S5, S6). A bottomless shaft under a flush grate in each plaza of the lowest layer that is no
//     basin and not the city's largest hall, the scaleIllusion.shaft.maxPerCity largest of them in the city; a fan (func_rotating, scaleIllusion.fan) under the deck's soffit over
//     each under-deck plaza, with a human-sized thing within scaleIllusion.human.reach (V8); a light shaft (an
//     additive func_illusionary) under each oculus; a strobing sprite on each wall tower's crown, a searchlight on
//     every other; sound loops: the city's hum in the Core, a train's, a horn at an outside gate (at most
//     scaleIllusion.sounds.maxPerCity in the city); an env_sound in each hall and under the deck.
//   - The world (S1): worldspawn's MaxRange (the engine's extent, at least the longest line from public floor to
//     the backdrop plus backdrop.farClipMargin, V4) and the sky's name, handed to the geometry in `world`.
//   - Every part is held to stage 9's common rules (forms.mjs) and kept off the forms placed before (fx.placed).
import { r3, dist, polyOverlap, polyBox, clipPolyline, growPoly } from "./geom.mjs";
import { part, instance, partFaults, walkBreaks, boxPoly, HULL_HEAD, ZONE_HEAD } from "./forms.mjs";
import { SKY_DEFAULTS } from "../lib/sky-megacity.mjs";
import { KERB } from "./dressing.mjs";

export const family = {
  id: "edges",
  order: 20,
  forms: ["F10", "F11", "F12", "F19", "F20", "F21", "F25", "S1", "S2", "S3", "S4", "S5", "S6", "S7"],
  place,
  check,
};

const EPS = 1e-6;
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
const unit = (a, b) => {
  const L = dist(a, b) || 1;
  return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
};
const left = (u) => [-u[1], u[0]];
const neg = (u) => [-u[0], -u[1]];
/** A rectangle from point c: along u from a0 to a1, along v from b0 to b1 (anticlockwise when v is u's left). */
const oriented = (c, u, v, a0, a1, b0, b1) => {
  const pts = [add(add(c, u, a0), v, b0), add(add(c, u, a1), v, b0), add(add(c, u, a1), v, b1), add(add(c, u, a0), v, b1)];
  const cr = u[0] * v[1] - u[1] * v[0];
  return cr >= 0 ? pts : pts.reverse();
};
/** An n-sided prism's outline `across` flat to flat, its flats square to the axes for n a multiple of 4. */
const ngon = (c, across, n = 8) => {
  const R = across / 2 / Math.cos(Math.PI / n);
  return [...Array(n).keys()].map((i) => [c[0] + R * Math.cos(Math.PI / n + (2 * Math.PI * i) / n), c[1] + R * Math.sin(Math.PI / n + (2 * Math.PI * i) / n)]); // prettier-ignore
};
const square = (c, w) => boxPoly([c[0] - w / 2, c[1] - w / 2, c[0] + w / 2, c[1] + w / 2]);
const centroid = (poly) => [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
const inBox = (p, b, e = 0) => p[0] >= b[0] - e && p[0] <= b[2] + e && p[1] >= b[1] - e && p[1] <= b[3] + e;
const zMeet = (a, b) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
const say = (v) => `${r3(v)}`;
const P3 = (p, z) => [r3(p[0]), r3(p[1]), r3(z)];

// ── what stands where ──

/** The owner of a point of a layer's public floor (cells): { kind: way | plaza, id } or null. */
const floorAt = (fx, lid, p) => fx.world(lid).W.ownerAt([p[0] * fx.cell, p[1] * fx.cell]);
/** The lot of a layer holding a point (cells), or null. */
const lotAt = (fx, lid, p) => fx.lots.lots.find((l) => l.layer === lid && p[0] >= l.rect.x - EPS && p[0] <= l.rect.x + l.rect.w + EPS && p[1] >= l.rect.y - EPS && p[1] <= l.rect.y + l.rect.d + EPS) ?? null; // prettier-ignore
/** A way's ceiling: its floor plus its clearance on the half-storey grid, at most its layer's top (rockCuts). */
export function ceilingOf(fx, L, w) {
  const half = fx.storey / 2;
  return Math.min(L.top, L.floor + Math.round(w.clearance / half) * half);
}
/** A plaza a canal ends in (a basin). */
const isBasin = (fx, q) => fx.site.ways.some((w) => w.class === "canal" && (w.from === q.id || w.to === q.id));
/** The plazas of the tile on a layer. */
const tilePlazas = (fx, lid) => fx.site.plazas.filter((q) => q.layer === lid && (q.tile ? q.tile === fx.tile.id : inBox(centroid(boxPoly(q.box)), fx.tile.box))); // prettier-ignore
/** The parapet's height and thickness in cells (dimensions.parapets). */
const parapetOf = (fx) => ({
  h: Math.ceil(fx.rules.dimensions.parapets.height.min / 0.0254) / fx.cu,
  t: Math.max(0.0625, Math.ceil((fx.rules.dimensions.parapets.thickness.min / fx.cell) * 16) / 16),
});

/** What a part meets among the forms placed (before this family and by it): the first form's id, or null. */
function placedHit(list, p, { skip = null, touch = false } = {}) {
  for (const f of list) {
    if (skip && (typeof skip === "function" ? skip(f) : skip.has(f.id))) continue;
    for (const q of f.parts ?? []) {
      if (q.build === "entity" && q.entity === "func_illusionary") continue;
      const m = zMeet(q.z, p.z);
      if (touch ? m < -0.01 : m <= 0.01) continue;
      if (polyOverlap(p.poly, q.poly) > 0.01) return f.id;
    }
  }
  return null;
}

/** Why a part cannot stand (a sentence), or null: the common rules on its layers, then the forms placed. */
function faultOf(S, pt, lids, opts = {}) {
  const fl = partFaults(S.fx, pt, { layers: lids, ignore: opts.ignore });
  if (fl.length) return `${fl[0].what} by ${fl[0].by}`;
  if (opts.placed === false) return null;
  const h = placedHit([...S.fx.placed, ...S.out.forms, ...(opts.also ?? [])], pt, opts);
  return h ? `${h}` : null;
}

// ── the budget ──

function budgetOf(fx) {
  const bb = fx.dressing?.measures?.brushBudget ?? {};
  const mp = fx.dressing?.measures?.modelProps ?? {};
  const before = bb.total ?? 0;
  const limit = bb.limit ?? Infinity;
  const placed = fx.placed.reduce((s, f) => s + f.brushes + f.rock, 0);
  const head = limit - before - placed;
  const entBefore = (mp.wiringEntities ?? 0) + (mp.placed ?? 0) + fx.placed.reduce((s, f) => s + (f.entities ?? 0), 0);
  const entHead = (mp.limit ?? Infinity) - entBefore;
  const share = fx.R.edges?.maxShareOfHeadroom ?? 0.5;
  const reserve = Number.isFinite(limit) ? Math.ceil(limit * (fx.R.reserveShare ?? 0)) : 0; // optional forms never eat the tile's reserve
  return { before, limit, placed, head, reserve, allowance: Math.max(0, Math.floor((head - reserve) * share)), entHead, entAllowance: Math.max(0, Math.floor(entHead * share)), share }; // prettier-ignore
}

/** Takes an instance into the tile if the budget holds it: `need` forms under the limit, the rest within the allowance. */
function take(S, inst, need = false) {
  const cost = inst.brushes + inst.rock;
  const ent = inst.entities ?? 0;
  const B = S.B;
  if (need) {
    if (S.used + cost > B.head || S.ents + ent > B.entHead) {
      S.out.failures.push(`budget: ${inst.id} (${inst.form}, ${cost} brushes, ${ent} entities) does not fit the tile's limit: ${B.before + B.placed + S.used} of ${B.limit} brushes taken (a trade is needed: notes-megastructure.md section 6, "What to trade")`); // prettier-ignore
      return false;
    }
  } else if (S.used + cost > B.allowance || S.ents + ent > B.entAllowance) {
    S.skipped.push(`${inst.id} (${cost})`);
    return false;
  }
  S.used += cost;
  S.ents += ent;
  S.out.forms.push(inst);
  return true;
}

// ── F11: vaults and ribs over the undercity's ways, segmental arches over the canal ──

function vaults(S) {
  const { fx } = S;
  for (const L of fx.layers.filter((x) => x.ceiling === "vault")) {
    for (const w of fx.site.ways.filter((x) => x.layer === L.id && x.access === "public" && x.class !== "service")) {
      const zc = ceilingOf(fx, L, w);
      let legN = 0;
      for (const pts of w.parts)
        for (const line of clipPolyline(pts, fx.tile.box))
          for (let i = 1; i < line.length; i++) {
            const [a, b] = [line[i - 1], line[i]];
            const leg = legN++;
            if (dist(a, b) < 1) continue;
            if (w.class === "canal") canalArches(S, L, w, a, b, leg, zc);
            else wayVault(S, L, w, a, b, leg, zc);
          }
    }
  }
}

/** The two chamfer wedges of a vault along a leg from s0 to s1 (cells along u from a). */
function chamfers(a, u, nL, half, c, s0, s1, zc) {
  return [1, -1].map((sg) => {
    const v = [nL[0] * sg, nL[1] * sg];
    return part("wedge", oriented(a, u, v, s0, s1, half - c, half), [zc - c, zc], { what: sg > 0 ? "left chamfer" : "right chamfer", edge: [add(add(a, u, s0), v, half), add(add(a, u, s1), v, half)] }); // prettier-ignore
  });
}

/** A rib across a way at c: two haunches (chamfer plus the rib's depth) and a crown band under the vault. */
function ribParts(c, u, nL, half, ch, V, zc, R = null) {
  const rw = V.rib.width.typical;
  const d = V.rib.depth.typical;
  // over a carriageway kept clear to the zone head the rib is two haunches over the sidewalks, no crown
  const reach = R ? R.reach : ch + d;
  const parts = R ? [] : [part("box", oriented(c, u, nL, -rw / 2, rw / 2, -half, half), [zc - d, zc], { what: "crown" })];
  for (const sg of [1, -1]) {
    const v = [nL[0] * sg, nL[1] * sg];
    parts.push(part("wedge", oriented(c, u, v, -rw / 2, rw / 2, half - reach, half), [zc - reach, zc], { what: sg > 0 ? "left haunch" : "right haunch", edge: [add(add(c, u, -rw / 2), v, half), add(add(c, u, rw / 2), v, half)] })); // prettier-ignore
  }
  return parts;
}

/**
 * A vehicle way whose carriageway is kept clear past its ceiling (the zone head over a low vaulted way): its ribs
 * are haunches over the sidewalks, { reach } cells out from each wall, or { reach: 0 } (no rib can stand). Null for
 * every other way (a full rib).
 */
export function ribReach(fx, L, w, zc) {
  if (!(w.vehicle && (w.carriageway ?? 0) > 0 && zc < L.floor + ZONE_HEAD - EPS)) return null;
  const side = (w.width - w.carriageway) / 2 - KERB / fx.cell;
  const V = fx.R.vault;
  const reach = Math.min(Math.min(V.chamfer.typical, w.width / 4) + V.rib.depth.typical, Math.floor(side * 8) / 8);
  return { reach: reach >= V.rib.width.typical - EPS ? reach : 0 };
}

/** Runs of true in a list of steps: [[s0, s1]] (cells), at least `min` long. */
function runsOf(ok, step, len, min = 1) {
  const runs = [];
  let s0 = null;
  ok.forEach((g, i) => {
    if (g && s0 === null) s0 = i * step;
    if (!g && s0 !== null) (runs.push([s0, i * step]), (s0 = null));
  });
  if (s0 !== null) runs.push([s0, len]);
  return runs.filter(([x, y]) => y - x >= min - EPS);
}

function wayVault(S, L, w, a, b, leg, zc) {
  const { fx } = S;
  const V = fx.R.vault;
  const len = dist(a, b);
  const u = unit(a, b);
  const nL = left(u);
  const half = w.width / 2;
  const ch = Math.min(V.chamfer.typical, w.width / 4);
  if (zc - ch - V.rib.depth.typical < L.floor + V.springing.min - EPS) {
    S.out.notes.push(`vault of ${w.id} leg ${leg}: none (its ceiling at z ${zc} leaves no springing ${V.springing.min} over the floor)`);
    return;
  }
  // the chamfers, step by step, where the wall stands on both sides and nothing passes
  const step = 0.25;
  const ok = [];
  const why = new Map();
  for (let s = 0; s < len - EPS; s += step) {
    const s1 = Math.min(len, s + step);
    const mid = add(a, u, (s + s1) / 2);
    const open = [1, -1].find((sg) => floorAt(fx, L.id, add(mid, nL, sg * (half + 0.25))));
    let f = open ? "open floor behind the wall" : null;
    if (!f) for (const pt of chamfers(a, u, nL, half, ch, s, s1, zc)) f ??= faultOf(S, pt, [L.id]);
    if (f) why.set(f, (why.get(f) ?? 0) + step);
    ok.push(!f);
  }
  const runs = runsOf(ok, step, len);
  runs.forEach(([s0, s1], j) => {
    const inst = instance({ id: `edges.vault.${w.id}.${leg}.${j}`, family: "edges", form: "F11", kind: "vault", layer: L.id, build: "detail", frame: true, role: L.frame, on: w.id, leg, t: [r3(s0), r3(s1)], ceiling: r3(zc), chamfer: r3(ch), at: add(a, u, (s0 + s1) / 2).map(r3), parts: chamfers(a, u, nL, half, ch, s0, s1, zc) }); // prettier-ignore
    take(S, inst, true);
  });
  const cut = [...why].sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k, v]) => `${k} (${r3(v)} cells)`);
  if (cut.length) S.out.notes.push(`vault of ${w.id} leg ${leg}: ${r3(runs.reduce((s, r) => s + r[1] - r[0], 0))} of ${r3(len)} cells vaulted; left off: ${cut.join(", ")}`); // prettier-ignore
  // ribs: no stretch of the leg (its ends counted) longer than rib.every.max without one
  const R = ribReach(fx, L, w, zc);
  if (R && !R.reach) {
    S.out.notes.push(`vault of ${w.id} leg ${leg}: no ribs (its carriageway is kept clear ${ZONE_HEAD} cells up, past its ceiling at z ${zc}, and its sidewalks hold no haunch)`); // prettier-ignore
    return;
  }
  for (const st of rowOf(S, len, V.rib.every.max, (t) => {
    const c = add(a, u, t);
    const parts = ribParts(c, u, nL, half, ch, V, zc, R);
    const open = [1, -1].find((sg) => floorAt(fx, L.id, add(c, nL, sg * (half + 0.25))));
    const own = (f) => f.id.startsWith(`edges.vault.${w.id}.${leg}.`);
    return { c, parts, fault: open ? "open floor behind the wall" : parts.map((pt) => faultOf(S, pt, [L.id], { skip: own })).find(Boolean) };
  }, `vault of ${w.id} leg ${leg}`)) {
    take(S, instance({ id: `edges.rib.${w.id}.${leg}.${st.k}`, family: "edges", form: "F11", kind: "vault-rib", layer: L.id, build: "detail", frame: true, role: L.frame, on: w.id, leg, station: st.k, t: r3(st.t), legLength: r3(len), ceiling: r3(zc), at: st.c.map(r3), parts: st.parts }), true); // prettier-ignore
  }
}

/**
 * The stations of a row of ribs or arches along a leg: no stretch (the leg's ends counted) longer than `every`.
 * Each next station is the nearest to an even spacing of what is left that `at(t)` finds no fault at, within
 * `every` of the last; a stretch with none is said and skipped. Returns [{ k, t, c, parts }].
 */
function rowOf(S, len, every, at, what) {
  const out = [];
  let prev = 0;
  for (let guard = 0; len - prev > every + EPS && guard < 200; guard++) {
    const need = Math.ceil((len - prev) / every - EPS);
    const ideal = prev + (len - prev) / need;
    const cands = [];
    for (let t = prev + 0.5; t <= Math.min(len - 0.25, prev + every) + EPS; t += 0.125) cands.push(t);
    cands.sort((p, q) => Math.abs(p - ideal) - Math.abs(q - ideal) || p - q);
    let got = null;
    let first = null;
    for (const t of cands) {
      const r = at(t);
      if (!r.fault) {
        got = { k: out.length, t, c: r.c, parts: r.parts };
        break;
      }
      first ??= r.fault;
    }
    if (!got) {
      S.out.notes.push(`${what}: nothing stands between ${r3(prev)} and ${r3(Math.min(len, prev + every))} cells along (${first})`);
      prev += every;
      continue;
    }
    out.push(got);
    prev = got.t;
  }
  return out;
}

/** A segmental arch's soffit over a chord `span` with `rise`: z at x (from the middle) under the crown zc. */
function segmental(span, rise, zc) {
  const r = (span * span) / 4 / (2 * rise) + rise / 2;
  return (x) => zc - (r - Math.sqrt(Math.max(0, r * r - x * x)));
}

/** The voussoirs of an arch at c across a way (along v from -half to half), the soffit z(x), its top zt. */
function voussoirs(c, u, v, half, n, zOf, zt, width, what) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const x0 = -half + (2 * half * i) / n;
    const x1 = -half + (2 * half * (i + 1)) / n;
    const [z0, z1] = [zOf(x0), zOf(x1)];
    parts.push(part("voussoir", oriented(c, u, v, -width / 2, width / 2, x0, x1), [Math.min(z0, z1), zt], { what: `${what} ${i + 1}`, soffit: { from: add(c, v, x0).map(r3), to: add(c, v, x1).map(r3), z: [r3(z0), r3(z1)] } })); // prettier-ignore
  }
  return parts;
}

function canalArches(S, L, w, a, b, leg, zc) {
  const { fx } = S;
  const V = fx.R.vault;
  const A = V.canalArch;
  const len = dist(a, b);
  const u = unit(a, b);
  const nL = left(u);
  const half = w.width / 2;
  const zOf = segmental(w.width, A.rise.typical, zc);
  if (zOf(half) < L.floor + V.springing.min - EPS) {
    S.out.notes.push(`canal ${w.id} leg ${leg}: no arches (its springing at z ${r3(zOf(half))} is under ${V.springing.min} over the quay)`);
    return;
  }
  for (const st of rowOf(S, len, A.every.max, (t) => {
    const c = add(a, u, t);
    const parts = voussoirs(c, u, nL, half, A.segments, zOf, zc, A.width.typical, "segment");
    const open = [1, -1].find((sg) => floorAt(fx, L.id, add(c, nL, sg * (half + 0.25))));
    return { c, parts, fault: open ? "open floor behind the wall" : parts.map((pt) => faultOf(S, pt, [L.id])).find(Boolean) };
  }, `canal ${w.id} leg ${leg}`)) {
    take(S, instance({ id: `edges.canal-arch.${w.id}.${leg}.${st.k}`, family: "edges", form: "F11", kind: "canal-arch", layer: L.id, build: "detail", frame: true, role: L.frame, on: w.id, leg, station: st.k, t: r3(st.t), legLength: r3(len), ceiling: r3(zc), rise: r3(A.rise.typical), span: r3(w.width), at: st.c.map(r3), parts: st.parts }), true); // prettier-ignore
  }
}

// ── F12: the column halls ──

function halls(S) {
  const { fx } = S;
  const C = fx.R.cistern;
  for (const L of fx.layers.filter((x) => x.ceiling === "vault")) {
    for (const q of tilePlazas(fx, L.id)) {
      const b = q.box;
      if (Math.min(b[2] - b[0], b[3] - b[1]) < C.minSide - EPS || isBasin(fx, q)) continue;
      const cw = C.column.width.typical;
      const ih = C.impost.height.typical;
      const colParts = (c) => [
        part("prism", ngon(c, cw, 8), [L.floor, L.top - ih], { what: "shaft" }),
        part("frustum", square(c, cw), [L.top - ih, L.top], { what: "impost", top: growPoly(square(c, cw), C.impost.flare.typical) }),
      ];
      const lines = (lo, hi, p, shift) => {
        const n = Math.floor((hi - lo - 2 * C.inset.min) / p + EPS) + 1;
        const s0 = lo + (hi - lo - (n - 1) * p) / 2 + shift;
        return [...Array(Math.max(0, n)).keys()].map((k) => s0 + k * p).filter((x) => x >= lo + C.inset.min / 2 - EPS && x <= hi - C.inset.min / 2 + EPS); // prettier-ignore
      };
      let best = null;
      for (let p = C.pitch.max; p >= C.pitch.min - EPS; p -= 0.125) {
        for (const shift of [0, 0.25, -0.25, 0.5, -0.5]) {
          const xs = lines(b[0], b[2], p, shift);
          const ys = lines(b[1], b[3], p, shift);
          const grid = [];
          for (const x of xs) for (const y of ys) grid.push([x, y]);
          const stand = grid.filter((c) => !colParts(c).some((pt) => faultOf(S, pt, [L.id])));
          const share = grid.length ? stand.length / grid.length : 0;
          if (!best || stand.length > best.stand.length || (stand.length === best.stand.length && p > best.p)) best = { p, shift, xs, ys, grid, stand, share };
        }
        if (best && best.share >= C.minShare - EPS) break;
      }
      if (!best || !best.grid.length) continue;
      let cols = best.stand.map((c, i) => instance({ id: `edges.column.${q.id}.${i}`, family: "edges", form: "F12", kind: "cistern-column", layer: L.id, build: "detail", frame: true, role: L.frame, on: q.id, pitch: r3(best.p), grid: [best.xs.length, best.ys.length], at: c.map(r3), height: r3(L.top - L.floor), parts: colParts(c) })); // prettier-ignore
      // the walk: a column cutting it goes, nearest the cut first
      cols = keepWalk(S, L, cols);
      let placed = 0;
      for (const col of cols) if (take(S, col, true)) placed++;
      S.out.notes.push(`hall ${q.id}: columns at ${r3(best.p)} cells (${best.xs.length} x ${best.ys.length} grid, ${placed} standing, ${best.grid.length - placed} left out where something stands: a pier foot or a connector there stands for its column)`); // prettier-ignore
      S.halls.push({ q, L, best, cols });
    }
  }
}

/** Architraves along a hall's grid lines under the vault, cut round what passes (optional). */
function architraves(S) {
  const { fx } = S;
  const C = fx.R.cistern;
  const max = fx.R.maxBrushesBy?.architrave ?? 4;
  for (const { q, L, best, cols } of S.halls) {
    const skip = new Set(cols.map((c) => c.id));
    const ad = C.architrave.depth.typical;
    const aw = C.architrave.width.typical;
    const z = [L.top - ad, L.top];
    const b = q.box;
    for (const [dir, list] of [[0, best.xs], [1, best.ys]]) {
      list.forEach((x, i) => {
        const a = dir === 0 ? [x, b[1]] : [b[0], b[1] + 0];
        const start = dir === 0 ? [x, b[1]] : [b[0], x];
        void a;
        const u = dir === 0 ? [0, 1] : [1, 0];
        const len = dir === 0 ? b[3] - b[1] : b[2] - b[0];
        const step = 0.25;
        const ok = [];
        for (let s = 0; s < len - EPS; s += step) {
          const pt = part("box", oriented(start, u, left(u), s, Math.min(len, s + step), -aw / 2, aw / 2), z);
          ok.push(!faultOf(S, pt, [L.id], { skip }));
        }
        const runs = runsOf(ok, step, len, 1).sort((p, r) => r[1] - r[0] - (p[1] - p[0])).slice(0, max).sort((p, r) => p[0] - r[0]);
        if (!runs.length) return;
        const parts = runs.map(([s0, s1]) => part("box", oriented(start, u, left(u), s0, s1, -aw / 2, aw / 2), z, { what: "architrave" }));
        const inst = instance({ id: `edges.architrave.${q.id}.${dir === 0 ? "x" : "y"}${i}`, family: "edges", form: "F12", kind: "architrave", layer: L.id, build: "detail", frame: true, role: L.frame, on: q.id, axis: dir === 0 ? "y" : "x", at: add(start, u, len / 2).map(r3), parts }); // prettier-ignore
        take(S, inst);
      });
    }
  }
}

/** Standing instances on a layer that cut its walk taken out (nearest the cut first); returns those left. */
function keepWalk(S, L, mine) {
  const { fx } = S;
  const standing = (list) => list.filter((f) => f.parts.some((p) => p.build !== "cut" && p.build !== "entity" && p.z[0] < L.floor + HULL_HEAD && p.z[1] > L.floor + 0.14)); // prettier-ignore
  let left2 = [...mine];
  const others = standing([...fx.placed, ...S.out.forms].filter((f) => f.layer === L.id || f.parts.some((p) => p.z[0] < L.floor + HULL_HEAD && p.z[1] > L.floor))); // prettier-ignore
  for (let guard = 0; guard < 40; guard++) {
    const st = standing(left2);
    if (!st.length) break;
    const br = walkBreaks(fx, L.id, [...others, ...st]);
    if (!br.length) break;
    const mid = [(br[0].a.p[0] + br[0].b.p[0]) / 2 / fx.cell, (br[0].a.p[1] + br[0].b.p[1]) / 2 / fx.cell];
    const victim = st.reduce((m, f) => (dist(f.at, mid) < dist(m.at, mid) ? f : m), st[0]);
    left2 = left2.filter((f) => f !== victim);
    S.out.notes.push(`walk on ${L.id}: ${victim.id} taken out (${br[0].a.what} and ${br[0].b.what} were cut apart)`);
  }
  return left2;
}

// ── F10: arcades ──

function arcades(S) {
  const { fx } = S;
  const A = fx.R.arcade;
  let done = 0;
  for (const L of fx.layers.filter((x) => x.ceiling !== "vault")) {
    for (const q of tilePlazas(fx, L.id)) {
      if (done >= A.maxPerTile) return;
      const b = q.box;
      if (q.portico || Math.min(b[2] - b[0], b[3] - b[1]) < A.minSide - EPS) continue;
      const sides = [
        { side: "s", a: [b[0], b[1]], u: [1, 0], n: [0, 1], len: b[2] - b[0] },
        { side: "n", a: [b[2], b[3]], u: [-1, 0], n: [0, -1], len: b[2] - b[0] },
        { side: "w", a: [b[0], b[3]], u: [0, -1], n: [1, 0], len: b[3] - b[1] },
        { side: "e", a: [b[2], b[1]], u: [0, 1], n: [-1, 0], len: b[3] - b[1] },
      ].sort((x, y) => y.len - x.len);
      for (const sd of sides) {
        const got = arcadeOn(S, L, q, sd);
        if (!got) continue;
        const before = S.used;
        const kept = keepWalk(S, L, got.arches);
        if (kept.length < got.arches.length) {
          S.out.notes.push(`arcade of ${q.id} on its ${sd.side} side: it would cut the walk`);
          continue;
        }
        if (got.arches.reduce((s, f) => s + f.brushes, 0) > S.B.allowance - S.used) {
          S.skipped.push(`the arcade of ${q.id} (${got.arches.reduce((s, f) => s + f.brushes, 0)})`);
          break;
        }
        for (const f of got.arches) take(S, f);
        S.out.notes.push(`arcade of ${q.id} on its ${sd.side} side: ${got.arches.filter((f) => !f.end).length} arches of ${r3(got.span)} cells (${S.used - before} brushes)`); // prettier-ignore
        done++;
        break;
      }
    }
  }
}

/** An arcade along one side of plaza q: { arches, span } or null. */
function arcadeOn(S, L, q, sd) {
  const { fx } = S;
  const A = fx.R.arcade;
  const d = A.depth.typical;
  const pw = A.pier.width.typical;
  const avail = sd.len - 2 * d;
  let n = Math.ceil(avail / A.span.max - EPS);
  while (n > 1 && avail / n < A.span.min - EPS) n--;
  const span = avail / n;
  if (n < 3 || span < A.span.min - EPS || span > A.span.max + EPS) return null;
  const clear = span - pw;
  const segs = clear <= 2 + EPS ? 4 : 6;
  const zs = L.floor + A.springing.typical;
  const top = zs + clear / 2 + A.ring.typical;
  const line = add(sd.a, sd.n, d);
  const piers = [];
  for (let j = 0; j <= n; j++) {
    const c = add(line, sd.u, d + j * span);
    const pt = part("box", oriented(c, sd.u, sd.n, -pw / 2, pw / 2, -pw / 2, pw / 2), [L.floor, top], { what: "pier" });
    piers.push(faultOf(S, pt, [L.id]) ? null : { c, pt });
  }
  const arches = [];
  const th = A.thickness.typical;
  const zOf = (x) => zs + Math.sqrt(Math.max(0, (clear / 2) ** 2 - x * x));
  for (let j = 0; j < n; j++) {
    if (!piers[j] || !piers[j + 1]) continue;
    const mid = add(piers[j].c, sd.u, span / 2);
    const vs = voussoirs(mid, sd.n, neg(sd.u), clear / 2, segs, zOf, top, th, "segment");
    if (vs.some((pt) => faultOf(S, pt, [L.id]))) continue;
    arches.push(instance({ id: `edges.arch.${q.id}.${sd.side}${j}`, family: "edges", form: "F10", kind: "arch", layer: L.id, build: "detail", frame: false, role: null, on: q.id, side: sd.side, station: j, span: r3(span), clear: r3(clear), springing: r3(zs), at: mid.map(r3), parts: [piers[j].pt, ...vs] })); // prettier-ignore
  }
  if (arches.length < 3) return null;
  const lastJ = Math.max(...arches.map((x) => x.station)) + 1;
  arches.push(instance({ id: `edges.arch.${q.id}.${sd.side}${lastJ}.end`, family: "edges", form: "F10", kind: "arch", layer: L.id, build: "detail", frame: false, role: null, on: q.id, side: sd.side, station: lastJ, end: true, at: piers[lastJ].c.map(r3), parts: [piers[lastJ].pt] })); // prettier-ignore
  return { arches, span };
}

// ── F25: raised ground ──

function daises(S) {
  const { fx } = S;
  const G = fx.R.ground;
  let done = 0;
  for (const L of fx.layers) {
    for (const q of tilePlazas(fx, L.id)) {
      if (done >= G.maxPerTile) return;
      const b = q.box;
      const ctr = centroid(boxPoly(b));
      let got = null;
      for (let s = G.dais.size.max; s >= G.dais.size.min - EPS && !got; s -= 1) {
        const cands = [];
        for (let dx = -3; dx <= 3; dx += 0.5) for (let dy = -3; dy <= 3; dy += 0.5) cands.push([ctr[0] + dx, ctr[1] + dy]);
        cands.sort((p, r) => dist(p, ctr) - dist(r, ctr) || p[0] - r[0] || p[1] - r[1]);
        for (const c of cands) {
          const box = [c[0] - s / 2, c[1] - s / 2, c[0] + s / 2, c[1] + s / 2];
          if (!(box[0] >= b[0] + 1 - EPS && box[2] <= b[2] - 1 + EPS && box[1] >= b[1] + 1 - EPS && box[3] <= b[3] - 1 + EPS)) continue;
          const pt = part("box", boxPoly(box), [L.floor, L.floor + G.step.max], { what: "dais" });
          // over the dais the hull stands: nothing of the layer may be there (keep-clear volumes, mouths, props)
          const head = part("box", boxPoly(box), [L.floor, L.floor + HULL_HEAD], { what: "head" });
          if (faultOf(S, pt, [L.id], { touch: true }) || faultOf(S, head, [L.id])) continue;
          got = { box, pt, s };
          break;
        }
      }
      if (!got) continue;
      if (take(S, instance({ id: `edges.dais.${q.id}`, family: "edges", form: "F25", kind: "dais", layer: L.id, build: "detail", frame: false, role: null, on: q.id, size: r3(got.s), rise: r3(G.step.max), at: centroid(boxPoly(got.box)).map(r3), parts: [got.pt] }))) done++; // prettier-ignore
    }
  }
}

// ── F19: gantries ──

function gantries(S) {
  const { fx } = S;
  const Gt = fx.R.gantry;
  const D = fx.deck;
  if (!D) return;
  const L = fx.layerOf(D.layer);
  const par = parapetOf(fx);
  let done = 0;
  for (const w of fx.site.ways.filter((x) => x.layer === L.id && x.access === "public" && x.class !== "service" && x.class !== "canal")) {
    if (done >= Gt.maxPerTile) return;
    let legN = 0;
    for (const pts of w.parts)
      for (const line of clipPolyline(pts, fx.tile.box))
        for (let i = 1; i < line.length; i++) {
          if (done >= Gt.maxPerTile) return;
          const [a, b] = [line[i - 1], line[i]];
          const leg = legN++;
          const len = dist(a, b);
          if (len < 4) continue;
          const u = unit(a, b);
          const nL = left(u);
          const half = w.width / 2;
          const z0 = w.z + w.clearance + Gt.over.min;
          for (const d of [0, 1, -1, 2, -2, 3, -3]) {
            const c = add(a, u, len / 2 + d);
            // a facade on both sides, tall enough to carry it
            const lots = [1, -1].map((sg) => lotAt(fx, L.id, add(c, nL, sg * (half + 0.5))));
            if (!lots.every((l) => l && l.kind === "facade" && l.zBase + (l.facade?.height ?? 0) >= z0 + par.h - EPS)) continue;
            const gw = Gt.width.typical;
            const e = 0.25;
            const parts = [part("box", oriented(c, u, nL, -gw / 2, gw / 2, -half - e, half + e), [z0, z0 + 0.125], { what: "plate", embeds: true })];
            for (const sg of [1, -1]) parts.push(part("box", oriented(c, u, nL, sg > 0 ? gw / 2 - par.t : -gw / 2, sg > 0 ? gw / 2 : -gw / 2 + par.t, -half, half), [z0 + 0.125, z0 + 0.125 + par.h], { what: "rail" })); // prettier-ignore
            for (const sg of [1, -1]) {
              const v = [nL[0] * sg, nL[1] * sg];
              parts.push(part("wedge", oriented(c, u, v, -gw / 2, gw / 2, half - 0.5, half), [z0 - 0.5, z0], { what: "bracket", embeds: true, edge: [add(add(c, u, -gw / 2), v, half), add(add(c, u, gw / 2), v, half)] })); // prettier-ignore
            }
            if (parts.some((pt) => faultOf(S, pt, [L.id]))) continue;
            if (take(S, instance({ id: `edges.gantry.${w.id}.${leg}`, family: "edges", form: "F19", kind: "gantry", layer: L.id, build: "detail", frame: false, role: null, on: w.id, leg, walkable: false, underside: r3(z0), clearanceTop: r3(w.z + w.clearance), rail: r3(par.h), at: c.map(r3), parts }))) done++; // prettier-ignore
            break;
          }
        }
  }
}

// ── S5: fans, light shafts ──

function fans(S) {
  const { fx } = S;
  const D = fx.deck;
  const F = fx.R.scaleIllusion.fan;
  if (!D) return;
  const L = fx.layerOf(D.layer);
  let done = 0;
  const zTop = D.soffit - (fx.R.coffer?.depth?.typical ?? 0.5) - 0.125;
  for (const q of tilePlazas(fx, L.id).filter((x) => inBox([x.box[0], x.box[1]], D.box) && inBox([x.box[2], x.box[3]], D.box))) {
    if (done >= F.maxPerTile) return;
    const ctr = centroid(boxPoly(q.box));
    let got = null;
    for (let across = F.across.max; across >= F.across.min - EPS && !got; across -= 1) {
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
        const c = [ctr[0] + dx, ctr[1] + dy];
        const parts = fanParts(c, across, zTop, q.id);
        if (zTop - 0.375 < L.floor + ZONE_HEAD + 0.5 - EPS) break;
        if (parts.some((pt) => faultOf(S, pt, [L.id]))) continue;
        got = { c, across, parts };
        break;
      }
    }
    if (!got) {
      S.out.notes.push(`fan over ${q.id}: no room under the soffit`);
      continue;
    }
    const pair = humanNear(fx, L.id, got.c);
    if (!pair) {
      S.out.notes.push(`fan over ${q.id}: left out, nothing human-sized within ${fx.R.scaleIllusion.human.reach.max} cells to read it by (V8)`);
      continue;
    }
    if (take(S, instance({ id: `edges.fan.${q.id}`, family: "edges", form: "S5", kind: "fan", layer: L.id, build: "entity", frame: false, role: null, on: q.id, across: r3(got.across), blades: F.blades, pair, at: got.c.map(r3), parts: got.parts }))) done++; // prettier-ignore
  }
}

function fanParts(c, across, zTop, id) {
  const g = `edges.fan.${id}`;
  const keys = { speed: 24, spawnflags: 1, origin: [r3(c[0]), r3(c[1]), r3(zTop - 0.1875)] };
  const ent = { build: "entity", entity: "func_rotating", group: g, keys };
  const parts = [part("prism", ngon(c, 0.5, 8), [zTop - 0.375, zTop], { what: "hub", ...ent })];
  for (const dir of [[1, 0], [0, 1], [-1, 0], [0, -1]]) parts.push(part("box", oriented(c, dir, left(dir), 0.25, across / 2, -0.1875, 0.1875), [zTop - 0.25, zTop - 0.125], { what: "blade", ...ent })); // prettier-ignore
  return parts;
}

/** The nearest human-sized thing (a door, a lamp, a sign: their keep-clear volumes) within reach of p, or null. */
function humanNear(fx, lid, p) {
  const reach = fx.R.scaleIllusion.human.reach.max;
  let best = null;
  for (const b of fx.keep(lid).boxes) {
    if (!/^(door|light|sign|lamp)/.test(b.what)) continue;
    const bb = polyBox(b.poly);
    const d = Math.hypot(Math.max(bb[0] - p[0], 0, p[0] - bb[2]), Math.max(bb[1] - p[1], 0, p[1] - bb[3]));
    if (d <= reach + EPS && (!best || d < best.d)) best = { what: b.what, d: r3(d) };
  }
  return best;
}

function lightShafts(S) {
  const { fx } = S;
  const D = fx.deck;
  if (!D) return;
  const L = fx.layerOf(D.layer);
  for (const oc of fx.placed.filter((f) => f.kind === "oculus" && f.hole)) {
    const h = oc.hole;
    const box = [h[0] + 0.25, h[1] + 0.25, h[2] - 0.25, h[3] - 0.25];
    const pt = part("box", boxPoly(box), [L.floor + ZONE_HEAD, D.soffit], { what: "light", build: "entity", entity: "func_illusionary", group: `edges.light.${oc.on}`, keys: { rendermode: 5, renderamt: 48 }, texture: "lightshaft" }); // prettier-ignore
    const f = faultOf(S, pt, [L.id], { placed: false });
    if (f) {
      S.out.notes.push(`light shaft under ${oc.id}: left out (${f})`);
      continue;
    }
    take(S, instance({ id: `edges.light.${oc.on}`, family: "edges", form: "S5", kind: "light-shaft", layer: L.id, build: "entity", frame: false, role: null, on: oc.on, under: oc.id, at: centroid(boxPoly(box)).map(r3), parts: [pt] })); // prettier-ignore
  }
}

// ── the city's edge: the wall (F20), the backdrop (F21, S2, S3), far motion (S6), gate roads (S7) ──

/** The walled layer (its bounds the city's extent) and the city's sides with their towers' rhythm, for the whole city. */
export function cityPlan(fx) {
  const ext = [0, 0, fx.desc.extent.x, fx.desc.extent.y];
  const L = [...fx.layers].sort((a, b) => b.level - a.level).find((x) => x.bounds.every((v, i) => Math.abs(v - ext[i]) < EPS) && x.ceiling !== "vault"); // prettier-ignore
  if (!L) return null;
  const W = fx.R.wall;
  const B = fx.R.backdrop;
  const sky = L.sky ?? L.top;
  const wallTop = W.top.min; // M21 holds it over every open layer's eye
  const sides = [
    { side: "s", a: [ext[0], ext[1]], u: [1, 0], in: [0, 1], len: ext[2] - ext[0], ownsCorners: true },
    { side: "n", a: [ext[0], ext[3]], u: [1, 0], in: [0, -1], len: ext[2] - ext[0], ownsCorners: true },
    { side: "w", a: [ext[0], ext[1]], u: [0, 1], in: [1, 0], len: ext[3] - ext[1], ownsCorners: false },
    { side: "e", a: [ext[2], ext[1]], u: [0, 1], in: [-1, 0], len: ext[3] - ext[1], ownsCorners: false },
  ];
  const across = W.tower.across.typical;
  for (const sd of sides) {
    const N = Math.max(1, Math.ceil(sd.len / W.tower.pitch.typical - EPS));
    sd.pitch = sd.len / N;
    sd.gates = gatesOf(fx, L.id).filter((g) => touches(g.box, sd, ext)).map((g) => ({ id: g.id, outside: g.outside, span: spanOn(g.box, sd) }));
    sd.towers = [];
    for (let k = 0; k <= N; k++) {
      if ((k === 0 || k === N) && !sd.ownsCorners) continue;
      const t = k * sd.pitch;
      if (sd.gates.some((g) => t >= g.span[0] - across - EPS && t <= g.span[1] + across + EPS)) continue;
      sd.towers.push({ t: r3(t), k, gate: null });
    }
    for (const g of sd.gates) for (const [t, w] of [[g.span[0] - across / 2 - 0.25, "w"], [g.span[1] + across / 2 + 0.25, "e"]]) sd.towers.push({ t: r3(t), k: null, gate: g.id, flank: w }); // prettier-ignore
    sd.towers.sort((x, y) => x.t - y.t);
  }
  const depth = B.pocket.depth.typical;
  // V4: the longest line from public floor to the backdrop
  const floorZ = Math.min(...fx.layers.map((x) => x.floor));
  const far = Math.hypot(ext[2] - ext[0] + depth, ext[3] - ext[1], sky - floorZ);
  const extentUnits = fx.desc.engine?.limits?.extent?.value ?? 32768;
  return { layer: L.id, ext, wallTop: r3(wallTop), sky, sides, depth, longest: r3(far), longestUnits: Math.round(far * fx.cu), maxRange: extentUnits }; // prettier-ignore
}
/** The described gates of a layer with their boxes (cells): [{ id, box, outside }]. */
const gatesOf = (fx, lid) => (fx.desc.streets?.nodes ?? []).filter((n) => n.kind === "gate" && n.layer === lid && n.size).map((n) => ({ id: n.id, outside: !!n.outside, box: [n.at[0] - n.size[0] / 2, n.at[1] - n.size[1] / 2, n.at[0] + n.size[0] / 2, n.at[1] + n.size[1] / 2] })); // prettier-ignore
const touches = (box, sd, ext) => (sd.side === "s" ? box[1] <= ext[1] + EPS : sd.side === "n" ? box[3] >= ext[3] - EPS : sd.side === "w" ? box[0] <= ext[0] + EPS : box[2] >= ext[2] - EPS); // prettier-ignore
const spanOn = (box, sd) => (sd.u[0] ? [box[0], box[2]] : [box[1], box[3]]);
/** The point at t along a side. */
const onSide = (sd, t) => add(sd.a, sd.u, t);
/** The sides of the city the tile reaches, with the tile's span on each. */
function tileSides(fx, plan) {
  const tb = fx.tile.box;
  const out = [];
  for (const sd of plan.sides) {
    const on = sd.side === "s" ? tb[1] <= plan.ext[1] + EPS : sd.side === "n" ? tb[3] >= plan.ext[3] - EPS : sd.side === "w" ? tb[0] <= plan.ext[0] + EPS : tb[2] >= plan.ext[2] - EPS; // prettier-ignore
    if (on) out.push({ ...sd, span: sd.u[0] ? [tb[0], tb[2]] : [tb[1], tb[3]] });
  }
  return out;
}

function wall(S, plan) {
  const { fx } = S;
  const W = fx.R.wall;
  const L = fx.layerOf(plan.layer);
  const across = W.tower.across.typical;
  for (const sd of tileSides(fx, plan)) {
    const mine = sd.towers.filter((tw) => tw.t >= sd.span[0] - EPS && tw.t < sd.span[1] - EPS + (sd.span[1] >= sd.len - EPS ? 2 * EPS : 0));
    const stood = [];
    for (const tw of mine) {
      let got = null;
      let first = null;
      const slides = [0, 0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 1, -1, 1.25, -1.25, 1.5, -1.5].filter((d) => Math.abs(d) <= W.tower.slide.max + EPS && tw.t + d >= -EPS && tw.t + d <= sd.len + EPS); // prettier-ignore
      for (const d of slides) {
        const t = tw.t + d;
        const c = onSide(sd, t);
        const parts = towerParts(fx, L, plan, sd, c, across);
        const f = parts.map((pt) => faultOf(S, pt, [L.id])).find(Boolean);
        if (!f) {
          got = { t, c, parts };
          break;
        }
        first ??= f;
      }
      // its door on the inner face stood nowhere: on another flat of its foot that meets public floor, else (its foot
      // all in a lot's rock, as beside a gate a facade lot fills: no foot to read a door against, V8) none
      for (let i = 0; i < slides.length && !got; i++) {
        const t = tw.t + slides[i];
        const c = onSide(sd, t);
        const body = towerParts(fx, L, plan, sd, c, across).filter((pt) => pt.what !== "door");
        if (body.map((pt) => faultOf(S, pt, [L.id])).find(Boolean)) continue;
        const spots = towerDoorSpots(fx, L, sd, c, across);
        const door = spots.find((sp) => sp.floor && !faultOf(S, sp.part, [L.id]));
        if (door) got = { t, c, parts: [...body, door.part] };
        else if (!spots.some((sp) => sp.floor)) got = { t, c, parts: body, buried: towerFootIn(fx, L, c, across) };
      }
      if (got?.buried) S.out.notes.push(`wall ${sd.side}: the tower at ${r3(got.t)} cells along stands with its foot in ${got.buried}, no public floor at it: no door (V8's scale pair wants a foot to read it against)`); // prettier-ignore
      if (!got) {
        S.out.notes.push(`wall ${sd.side}: no tower at ${tw.t} cells along${tw.gate ? ` (flanking ${tw.gate})` : ""}: ${first}`);
        continue;
      }
      const id = `edges.tower.${sd.side}.${tw.gate ? `${tw.gate}.${tw.flank}` : tw.k}`;
      const top = plan.wallTop + W.tower.rise.min;
      const points = [{ classname: "env_sprite", at: P3(got.c, top + 1.75), keys: { model: "sprites/glow01.spr", rendermode: 5, renderamt: 255, renderfx: 4, rendercolor: "255 48 32", scale: 1 }, what: "strobe" }]; // prettier-ignore
      const inst = instance({ id, family: "edges", form: "F20", kind: "wall-tower", layer: L.id, build: "detail", frame: true, role: L.frame, on: `${sd.side} wall`, side: sd.side, t: r3(got.t), rhythm: tw.t, gate: tw.gate, across: r3(across), projection: r3(across / 2), top: r3(top), wallTop: plan.wallTop, at: got.c.map(r3), parts: got.parts, points }); // prettier-ignore
      if (take(S, inst, true)) stood.push(inst);
    }
    S.towers.push(...stood);
    wallFace(S, plan, sd, L);
  }
}

/**
 * The places a wall tower's door may stand at its foot: on its inner flat (the first, towerParts' own), the two
 * inner diagonal flats, then the two flats along the wall (half a cell in from the wall's line); each with whether
 * public floor lies just before its face (past the door's own depth). [{ part, floor }].
 */
export function towerDoorSpots(fx, L, sd, c, across) {
  const r2 = Math.SQRT1_2;
  const normals = [sd.in, [(sd.in[0] + sd.u[0]) * r2, (sd.in[1] + sd.u[1]) * r2], [(sd.in[0] - sd.u[0]) * r2, (sd.in[1] - sd.u[1]) * r2], sd.u, [-sd.u[0], -sd.u[1]]]; // prettier-ignore
  return normals.map((n, i) => {
    const o = i >= 3 ? add(c, sd.in, 0.5) : c;
    const along = [-n[1], n[0]];
    const pt = part("box", oriented(o, along, n, -0.25, 0.25, across / 2 - 0.0625, across / 2 + 0.125), [L.floor, L.floor + 0.875], { what: "door", texture: "door-service" }); // prettier-ignore
    return { part: pt, floor: !!floorAt(fx, L.id, add(o, n, across / 2 + 0.1875)) };
  });
}
/** What a tower's foot stands in where no public floor meets it (the lots its inner half enters). */
function towerFootIn(fx, L, c, across) {
  const oct = ngon(c, across, 8);
  const hit = fx.solids.filter((s) => s.layer === L.id && (s.kind === "facade" || s.kind === "building") && polyOverlap(oct, s.poly) > 0.01).map((s) => s.what);
  return hit.length ? hit.join(", ") : "the rock";
}

/** V8 on a wall tower: a door at its foot, or a foot that meets no public floor (a note). { failure } | { note } | null. */
export function towerDoorCheck(fx, plan, t) {
  if (t.parts.some((p) => p.what === "door")) return null;
  const sd = plan?.sides.find((x) => x.side === t.side);
  const L = fx.layerOf(t.layer);
  if (sd && L && !towerDoorSpots(fx, L, sd, t.at, t.across).some((sp) => sp.floor)) return { note: `V8: ${t.id}'s foot meets no public floor (in ${towerFootIn(fx, L, t.at, t.across)}): no door wanted` }; // prettier-ignore
  return { failure: `V8: ${t.id} has no door at its foot (the scale pair)` };
}

function towerParts(fx, L, plan, sd, c, across) {
  const W = fx.R.wall;
  const top = plan.wallTop + W.tower.rise.min;
  const oct = ngon(c, across, 8);
  return [
    part("prism", oct, [L.floor, top], { what: "shaft", embeds: true }),
    part("frustum", oct, [top, top + 0.25], { what: "cornice", top: growPoly(oct, 0.25), embeds: true }),
    part("prism", ngon(c, across - 0.5, 8), [top + 0.25, top + 1], { what: "crown", embeds: true }),
    part("frustum", ngon(c, across - 0.5, 8), [top + 1, top + 1.5], { what: "cap", top: ngon(c, across * 0.25, 8), embeds: true }),
    part("box", oriented(c, sd.u, sd.in, -0.25, 0.25, across / 2 - 0.0625, across / 2 + 0.125), [L.floor, L.floor + 0.875], { what: "door", texture: "door-service" }), // prettier-ignore
  ];
}

/** The wall's face where public floor reaches it: a string course, a battered plinth and pilasters (V3). */
function wallFace(S, plan, sd, L) {
  const { fx } = S;
  const W = fx.R.wall;
  const step = 0.5;
  const [t0, t1] = [Math.max(0, sd.span[0]), Math.min(sd.len, sd.span[1])];
  const ok = [];
  for (let t = t0; t < t1 - EPS; t += step) ok.push(!!floorAt(fx, L.id, add(onSide(sd, t + step / 2), sd.in, 0.25)));
  const runs = runsOf(ok, step, t1 - t0, 1).map(([a, b]) => [t0 + a, t0 + b]);
  const max = fx.R.maxBrushesBy?.["wall-face"] ?? 8;
  for (const [r0, r1] of runs) {
    // chunks of at most (max - 2) pilasters
    const per = (max - 2) * W.pilaster.every.max;
    const n = Math.ceil((r1 - r0) / per - EPS);
    for (let k = 0; k < n; k++) {
      const a = r0 + ((r1 - r0) * k) / n;
      const b = r0 + ((r1 - r0) * (k + 1)) / n;
      const parts = [];
      const left2 = [];
      const tryPart = (pt) => {
        const f = faultOf(S, pt, [L.id]);
        if (f) left2.push(`${pt.what} (${f})`);
        else parts.push(pt);
        return !f;
      };
      tryPart(part("box", oriented(sd.a, sd.u, sd.in, a, b, 0, 0.25), [plan.wallTop - 0.5, plan.wallTop], { what: "string course" }));
      tryPart(part("wedge", oriented(sd.a, sd.u, sd.in, a, b, 0, 0.25), [L.floor, L.floor + 1], { what: "plinth", edge: [onSide(sd, a), onSide(sd, b)] })); // prettier-ignore
      const np = Math.max(1, Math.ceil((b - a) / W.pilaster.every.max - EPS));
      for (let i = 0; i < np; i++) {
        const tc = a + ((i + 0.5) * (b - a)) / np;
        let stood = false;
        for (const d of [0, 0.5, -0.5, 1, -1]) {
          const pw = W.pilaster.width.typical;
          if (tryPart(part("box", oriented(sd.a, sd.u, sd.in, tc + d - pw / 2, tc + d + pw / 2, 0, W.pilaster.projection.typical), [L.floor, plan.wallTop], { what: `pilaster ${i + 1}`, t: r3(tc + d) }))) { // prettier-ignore
            stood = true;
            break;
          }
          left2.pop();
        }
        if (!stood) left2.push(`pilaster ${i + 1}`);
      }
      if (left2.length) S.out.notes.push(`wall ${sd.side} ${r3(a)}-${r3(b)}: ${left2.slice(0, 3).join(", ")} left out`);
      if (!parts.length) continue;
      const kept = keepWalk(S, L, [instance({ id: `edges.wall-face.${sd.side}.${r3(a)}`, family: "edges", form: "F20", kind: "wall-face", layer: L.id, build: "detail", frame: true, role: L.frame, on: `${sd.side} wall`, side: sd.side, t: [r3(a), r3(b)], pilasters: parts.filter((p) => /^pilaster/.test(p.what)).map((p) => p.t), at: onSide(sd, (a + b) / 2).map(r3), parts })]); // prettier-ignore
      for (const f of kept) take(S, f, true);
    }
  }
}

/** Beyond each of the tile's city sides: the pocket (world), its cards, its model, a train or an airship. */
function backdrop(S, plan) {
  const { fx } = S;
  const B = fx.R.backdrop;
  const L = fx.layerOf(plan.layer);
  const sky = plan.sky;
  for (const sd of tileSides(fx, plan)) {
    const [t0, t1] = [Math.max(0, sd.span[0]), Math.min(sd.len, sd.span[1])];
    const out = neg(sd.in);
    const depth = plan.depth;
    const corners = [onSide(sd, t0), onSide(sd, t1), add(onSide(sd, t1), out, depth), add(onSide(sd, t0), out, depth)];
    const box = polyBox(corners).map(r3);
    const pocket = { id: `pocket.${sd.side}.${fx.tile.id}`, side: sd.side, box, z: [plan.wallTop, sky], depth: r3(depth), rockEstimate: B.pocket.rockEstimate, cards: [], models: [], motion: [] }; // prettier-ignore
    // the cards: at most card.every.max apart, two depths
    const n = Math.max(1, Math.ceil((t1 - t0) / B.card.every.max - EPS));
    for (let j = 0; j < n; j++) {
      const tc = t0 + ((j + 0.5) * (t1 - t0)) / n;
      const dd = depth * (j % 2 ? 0.75 : 0.45);
      const w = ((t1 - t0) / n) * 0.9;
      const c = add(onSide(sd, tc), out, dd);
      const z1 = Math.min(sky - 0.25, plan.wallTop + B.card.height.min + 2);
      const id = `edges.card.${sd.side}.${fx.tile.id}.${j}`;
      const pt = part("box", oriented(c, sd.u, out, -w / 2, w / 2, -0.0625, 0.0625), [plan.wallTop, z1], { what: "skyline card", build: "entity", entity: "func_illusionary", group: id, keys: { rendermode: 4, renderamt: 255 }, texture: "{skyline" }); // prettier-ignore
      if (take(S, instance({ id, family: "edges", form: "F21", kind: "card", layer: L.id, build: "entity", frame: false, role: null, on: pocket.id, side: sd.side, depth: r3(dd), at: c.map(r3), parts: [pt] }), true)) pocket.cards.push(id); // prettier-ignore
    }
    // a backdrop model; a train east and west, an airship north and south, in the side's middle tile
    const mc = add(onSide(sd, (t0 + t1) / 2), out, depth * 0.6);
    const points = [{ classname: "cycler_sprite", at: P3(mc, plan.wallTop), keys: { model: `models/nb/backdrop_${sd.side}.mdl`, framerate: 1, renderfx: 0 }, top: r3(sky - 0.5), what: "backdrop model" }]; // prettier-ignore
    const middle = sd.len / 2 >= t0 - EPS && sd.len / 2 < t1 - EPS;
    const parts = [];
    if (middle && (sd.side === "e" || sd.side === "w")) {
      const zt = plan.wallTop + 2;
      const g = `edges.train.${sd.side}`;
      const names = [`nb_train_${sd.side}_a`, `nb_train_${sd.side}_b`];
      const ends = [add(onSide(sd, t0 + 1), out, depth * 0.5), add(onSide(sd, t1 - 1), out, depth * 0.5)];
      for (let i = 0; i < 3; i++) {
        const c = add(ends[0], sd.u, 1.5 + i * 3.25);
        parts.push(part("box", oriented(c, sd.u, out, -1.5, 1.5, -0.375, 0.375), [zt, zt + 0.75], { what: `car ${i + 1}`, build: "entity", entity: "func_train", group: g, keys: { targetname: g, target: names[0], speed: 320 } })); // prettier-ignore
      }
      points.push(...ends.map((p, i) => ({ classname: "path_corner", at: P3(p, zt), keys: { targetname: names[i], target: names[1 - i] }, what: "path_corner" }))); // prettier-ignore
      points.push({ classname: "ambient_generic", at: P3(onSide(sd, (t0 + t1) / 2), plan.wallTop + 1), keys: { message: "ambience/nb_train.wav", health: 6, spawnflags: 8 }, what: "sound loop", loop: "train" }); // prettier-ignore
      pocket.motion.push(g);
    }
    if (middle && (sd.side === "n" || sd.side === "s")) {
      points.push({ classname: "cycler_sprite", at: P3(add(onSide(sd, (t0 + t1) / 2), out, depth * 0.8), sky - 2), keys: { model: "models/nb/airship.mdl", framerate: 1 }, top: r3(sky - 0.5), what: "airship" }); // prettier-ignore
      pocket.motion.push(`edges.airship.${sd.side}`);
    }
    const id = `edges.backdrop.${sd.side}.${fx.tile.id}`;
    if (take(S, instance({ id, family: "edges", form: "S2", kind: "backdrop", layer: L.id, build: "entity", frame: false, role: null, on: pocket.id, side: sd.side, at: mc.map(r3), parts, points }), true)) pocket.models.push(id); // prettier-ignore
    S.world.pockets.push(pocket);
  }
}

/** An outside gate's way going on beyond it: a road pocket, lamps receding, fog cards and an end card (S7, M21). */
function gateRoads(S, plan) {
  const { fx } = S;
  const B = fx.R.backdrop;
  const L = fx.layerOf(plan.layer);
  for (const sd of tileSides(fx, plan)) {
    for (const g of sd.gates) {
      if (!g.outside) continue;
      if (g.span[1] < sd.span[0] - EPS || g.span[0] > sd.span[1] + EPS) continue;
      const out = neg(sd.in);
      const len = B.road.length.typical;
      const [a0, a1] = g.span;
      const box = polyBox([onSide(sd, a0), onSide(sd, a1), add(onSide(sd, a1), out, len), add(onSide(sd, a0), out, len)]).map(r3);
      const road = { id: `road.${g.id}`, gate: g.id, side: sd.side, box, z: [L.floor, plan.sky], length: r3(len), rockEstimate: B.road.rockEstimate, cards: [], lamps: 0 }; // prettier-ignore
      const mid = (a0 + a1) / 2;
      const w = a1 - a0;
      const points = [];
      for (let d = B.road.lampEvery.max; d < len - 1 + EPS; d += B.road.lampEvery.max)
        for (const sg of [1, -1]) points.push({ classname: "env_sprite", at: P3(add(onSide(sd, mid + sg * (w / 2 - 0.5)), out, d), L.floor + 1.25), keys: { model: "sprites/glow01.spr", rendermode: 5, renderamt: 160, scale: 0.5 }, what: "road lamp" }); // prettier-ignore
      road.lamps = points.length;
      points.push({ classname: "ambient_generic", at: P3(add(onSide(sd, mid), out, len / 2), L.floor + 2), keys: { message: "ambience/nb_horn.wav", health: 7, spawnflags: 8 }, what: "sound loop", loop: "horn" }); // prettier-ignore
      const parts = [];
      const depths = [len * 0.45, len * 0.7, len - 0.25];
      depths.forEach((d, i) => {
        const end = i === depths.length - 1;
        const c = add(onSide(sd, mid), out, d);
        const z1 = end ? Math.min(plan.sky - 0.25, L.floor + B.card.height.min + 2) : L.floor + B.card.height.min;
        parts.push(part("box", oriented(c, sd.u, out, -w / 2, w / 2, -0.0625, 0.0625), [L.floor, z1], { what: end ? "end card" : "fog card", build: "entity", entity: "func_illusionary", group: `edges.road.${g.id}.${i}`, keys: end ? { rendermode: 4, renderamt: 255 } : { rendermode: 2, renderamt: 110 }, texture: end ? "{roadend" : "{fogcard", depth: r3(d) })); // prettier-ignore
      });
      const id = `edges.road.${g.id}`;
      if (take(S, instance({ id, family: "edges", form: "S7", kind: "gate-road", layer: L.id, build: "entity", frame: false, role: null, on: g.id, side: sd.side, length: r3(len), at: add(onSide(sd, mid), out, len / 2).map(r3), parts, points }), true)) road.cards.push(id); // prettier-ignore
      S.world.roads.push(road);
    }
  }
}

/** Searchlights on every other wall tower: an additive beam from its cap to under the lid (optional). */
function searchlights(S, plan) {
  for (const tw of S.towers.filter((x) => x.rhythm !== undefined && ((Math.round(x.rhythm * 8) / 8) | 0) % 2 === 0 && !x.gate).filter((_, i) => i % 2 === 0)) {
    const L = S.fx.layerOf(tw.layer);
    const z0 = tw.top + 1.5;
    if (plan.sky - 0.25 - z0 < 1) continue;
    const pt = part("prism", ngon(tw.at, 0.5, 8), [z0, plan.sky - 0.25], { what: "beam", build: "entity", entity: "func_illusionary", group: `edges.searchlight.${tw.id}`, keys: { rendermode: 5, renderamt: 64 }, texture: "lightbeam" }); // prettier-ignore
    if (faultOf(S, pt, [L.id], { placed: false })) continue;
    take(S, instance({ id: `edges.searchlight.${tw.id.slice(12)}`, family: "edges", form: "S5", kind: "searchlight", layer: L.id, build: "entity", frame: false, role: null, on: tw.id, at: tw.at, parts: [pt] })); // prettier-ignore
  }
}

// ── S4: bottomless shafts ──

function shafts(S) {
  const { fx } = S;
  const H = fx.R.scaleIllusion.shaft;
  const lowest = [...fx.layers].sort((a, b) => a.level - b.level)[0];
  if (lowest.ceiling !== "vault") return;
  // the city's largest hall of the layer keeps its floor whole (from the description: the same in every tile)
  const canalEnds = new Set((fx.desc.streets?.segments ?? []).filter((g) => g.class === "canal").flatMap((g) => [g.from, g.to]));
  const all = (fx.desc.streets?.nodes ?? []).filter((n) => n.kind === "plaza" && n.layer === lowest.id && n.size && !canalEnds.has(n.id));
  const largest = all.reduce((m, n) => (n.size[0] * n.size[1] > (m ? m.size[0] * m.size[1] : -1) ? n : m), null);
  // at most H.maxPerCity in the city: the largest of the other halls (then by id), chosen from the description so
  // every tile agrees which
  const area = (n) => n.size[0] * n.size[1];
  const chosen = new Set(all.filter((n) => n.id !== largest?.id).sort((p, r) => area(r) - area(p) || (p.id < r.id ? -1 : 1)).slice(0, H.maxPerCity ?? Infinity).map((n) => n.id)); // prettier-ignore
  for (const q of tilePlazas(fx, lowest.id).filter((x) => !isBasin(fx, x) && !canalEnds.has(x.id) && x.id !== largest?.id && chosen.has(x.id))) {
    const s = H.size.min;
    const b = q.box;
    const cands = [];
    for (let x = b[0] + 0.5; x + s <= b[2] - 0.5 + EPS; x += 0.5) for (let y = b[1] + 0.5; y + s <= b[3] - 0.5 + EPS; y += 0.5) cands.push([x, y, x + s, y + s]); // prettier-ignore
    // beside the hall: nearest its edge first
    const edgeD = (h) => Math.min(h[0] - b[0], h[1] - b[1], b[2] - h[2], b[3] - h[3]);
    cands.sort((p, r) => edgeD(p) - edgeD(r) || p[0] - r[0] || p[1] - r[1]);
    let got = null;
    for (const h of cands) {
      const over = part("box", boxPoly(h), [lowest.floor, lowest.floor + HULL_HEAD], { what: "over" });
      if (faultOf(S, over, [lowest.id], { touch: true })) continue;
      got = h;
      break;
    }
    if (!got) {
      S.out.notes.push(`shaft in ${q.id}: no free ${s} x ${s} cells`);
      continue;
    }
    const zb = lowest.floor - H.depth.typical;
    const parts = [
      part("box", boxPoly(got), [zb, lowest.floor], { what: "shaft", build: "cut", shaft: true, rock: H.rockEstimate }),
      part("box", boxPoly(got), [lowest.floor - 0.0625, lowest.floor], { what: "grate", build: "entity", entity: "func_wall", group: `edges.shaft.${q.id}`, texture: "{grate" }), // prettier-ignore
    ];
    take(S, instance({ id: `edges.shaft.${q.id}`, family: "edges", form: "S4", kind: "shaft", layer: lowest.id, build: "detail", frame: false, role: null, on: q.id, hole: got.map(r3), bottom: r3(zb), guard: "grate", at: centroid(boxPoly(got)).map(r3), parts }), true); // prettier-ignore
  }
}

// ── S6: sound loops and room echoes in the tile ──

function sounds(S) {
  const { fx } = S;
  const points = [];
  for (const h of S.halls) points.push({ classname: "env_sound", at: P3(centroid(boxPoly(h.q.box)), h.L.floor + 1), keys: { roomtype: 15, radius: 512 }, what: "echo (hall)" }); // prettier-ignore
  const D = fx.deck;
  const under = D ? tilePlazas(fx, D.layer).filter((q) => inBox([q.box[0], q.box[1]], D.box) && inBox([q.box[2], q.box[3]], D.box)) : [];
  for (const q of under) points.push({ classname: "env_sound", at: P3(centroid(boxPoly(q.box)), fx.layerOf(D.layer).floor + 1), keys: { roomtype: 18, radius: 768 }, what: "echo (under the deck)" }); // prettier-ignore
  const core = fx.desc.tiles?.names?.[fx.tile.id] === "Core";
  if (core) {
    const q = under[0] ?? tilePlazas(fx, fx.layers[1]?.id ?? fx.layers[0].id)[0];
    if (q) points.push({ classname: "ambient_generic", at: P3(centroid(boxPoly(q.box)), fx.layerOf(q.layer).floor + 2), keys: { message: "ambience/nb_hum.wav", health: 5, spawnflags: 1 }, what: "sound loop", loop: "hum" }); // prettier-ignore
  }
  if (points.length) take(S, instance({ id: `edges.sounds.${fx.tile.id}`, family: "edges", form: "S6", kind: "sounds", layer: fx.layers[0].id, build: "detail", frame: false, role: null, on: fx.tile.id, at: centroid(boxPoly(fx.tile.box)).map(r3), parts: [], points }), true); // prettier-ignore
}

/** The city's sound loops, counted from the plan (a train a side east and west, a horn an outside gate, the hum). */
function cityLoops(fx, plan) {
  if (!plan) return { count: 0, what: [] };
  const what = [];
  for (const sd of plan.sides) if (sd.side === "e" || sd.side === "w") what.push(`train ${sd.side}`);
  for (const sd of plan.sides) for (const g of sd.gates) if (g.outside) what.push(`horn ${g.id}`);
  if (Object.values(fx.desc.tiles?.names ?? {}).includes("Core")) what.push("hum");
  return { count: what.length, what };
}

// ── the family ──

function place(fx) {
  const out = { forms: [], failures: [], notes: [] };
  const S = { fx, out, B: budgetOf(fx), used: 0, ents: 0, skipped: [], halls: [], towers: [], world: { pockets: [], roads: [] } };
  const plan = cityPlan(fx);
  // what the checks need, under the limit
  vaults(S);
  halls(S);
  if (plan) {
    wall(S, plan);
    backdrop(S, plan);
    gateRoads(S, plan);
  }
  shafts(S);
  sounds(S);
  // the rest within the family's share of what is left
  lightShafts(S);
  fans(S);
  arcades(S);
  daises(S);
  architraves(S);
  gantries(S);
  if (plan) searchlights(S, plan);
  if (S.skipped.length) out.notes.push(`budget: left out past the family's share (${Math.round(S.B.share * 100)} % of the ${S.B.head} brushes the tile had left, ${S.B.allowance}): ${S.skipped.slice(0, 8).join(", ")}${S.skipped.length > 8 ? ` and ${S.skipped.length - 8} more` : ""}`); // prettier-ignore
  out.notes.push(`budget: ${S.used} brushes and ${S.ents} entities taken of the ${S.B.head} brushes and ${S.B.entHead} entities the tile had left (the family's share for what the checks do not need: ${S.B.allowance} brushes)`); // prettier-ignore
  const loops = cityLoops(fx, plan);
  out.world = {
    worldspawn: { MaxRange: plan?.maxRange ?? fx.desc.engine?.limits?.extent?.value ?? 32768, skyname: SKY_DEFAULTS.name, note: "worldspawn keys for the geometry: MaxRange (sv_zmax) the engine's extent, the sky rendered by levels/tools/sky.mjs (notes-megastructure.md 7.1, V4)" }, // prettier-ignore
    edge: plan
      ? {
          layer: plan.layer,
          wallTop: plan.wallTop,
          sky: plan.sky,
          depth: r3(plan.depth),
          longest: plan.longest,
          longestUnits: plan.longestUnits,
          sides: plan.sides.map((sd) => ({ side: sd.side, len: sd.len, pitch: r3(sd.pitch), towers: sd.towers.map((t) => t.t), gates: sd.gates })),
          tileSides: tileSides(fx, plan).map((sd) => sd.side),
          pockets: S.world.pockets,
          roads: S.world.roads,
          loops,
        }
      : null,
  };
  return out;
}

// ── its checks (the gate runs them again on the artifact's forms) ──

function check(forms, fx, world = null) {
  const failures = [];
  const notes = [];
  const V = fx.R.vault;
  const C = fx.R.cistern;
  const by = (k) => forms.filter((f) => f.kind === k);
  // M17: the vault's rhythm along each leg of a vaulted way in the tile, and the halls' columns
  const legs = new Map();
  const exempt = [];
  for (const r of [...by("vault-rib"), ...by("canal-arch")]) (legs.get(`${r.on} leg ${r.leg}`) ?? legs.set(`${r.on} leg ${r.leg}`, { len: r.legLength, ts: [], kind: r.kind }).get(`${r.on} leg ${r.leg}`)).ts.push(r.t); // prettier-ignore
  for (const L of fx.layers.filter((x) => x.ceiling === "vault"))
    for (const w of fx.site.ways.filter((x) => x.layer === L.id && x.access === "public" && x.class !== "service")) {
      let legN = 0;
      for (const pts of w.parts)
        for (const line of clipPolyline(pts, fx.tile.box))
          for (let i = 1; i < line.length; i++) {
            const leg = legN++;
            const len = dist(line[i - 1], line[i]);
            if (len < 1) continue;
            const every = w.class === "canal" ? V.canalArch.every.max : V.rib.every.max;
            const [a, b] = [line[i - 1], line[i]];
            const u = unit(a, b);
            const zc = ceilingOf(fx, L, w);
            if (w.class !== "canal" && ribReach(fx, L, w, zc)?.reach === 0) {
              exempt.push(`${w.id} (its carriageway kept clear past its ceiling)`);
              continue;
            }
            // only the stretches walled on both sides count: where another floor opens beside it, no arch can spring
            const walled = (t) => ![1, -1].some((sg) => floorAt(fx, L.id, add(add(a, u, t), left(u), sg * (w.width / 2 + 0.25))));
            const g = legs.get(`${w.id} leg ${leg}`);
            const ts = (g?.ts ?? []).sort((p, q) => p - q);
            const stops = [0, ...ts, len];
            for (let k = 1; k < stops.length; k++) {
              let run = 0;
              for (let t = stops[k - 1] + 0.125; t < stops[k]; t += 0.25) run += walled(t) ? 0.25 : 0;
              if (run > every + EPS) {
                failures.push(`M17: ${w.id} leg ${leg} has no ${w.class === "canal" ? "arch" : "rib"} for ${r3(stops[k] - stops[k - 1])} cells (from ${r3(stops[k - 1])} to ${r3(stops[k])} of ${r3(len)}, ${r3(run)} of them walled), at most ${every} (forms.vault)`); // prettier-ignore
                break;
              }
            }
          }
    }
  if (exempt.length) notes.push(`M17: no ribs over ${exempt.join(", ")}: the vault is its chamfers`);
  for (const v of by("vault")) if (v.ceiling - v.chamfer < fx.layerOf(v.layer).floor + V.springing.min - EPS) failures.push(`F11: ${v.id}'s chamfers come down to z ${r3(v.ceiling - v.chamfer)}, under the springing ${V.springing.min} over the floor`); // prettier-ignore
  const halls = new Map();
  for (const c of by("cistern-column")) (halls.get(c.on) ?? halls.set(c.on, []).get(c.on)).push(c);
  for (const [q, cols] of halls) {
    const L = fx.layerOf(cols[0].layer);
    const p = cols[0].pitch;
    if (p < C.pitch.min - EPS || p > C.pitch.max + EPS) failures.push(`M17: the columns of ${q} stand ${p} cells apart, wanted ${C.pitch.min} to ${C.pitch.max} (the Basilica Cistern's 4.9 m at game scale)`); // prettier-ignore
    const xs = [...new Set(cols.map((c) => c.at[0]))].sort((a, b) => a - b);
    const ys = [...new Set(cols.map((c) => c.at[1]))].sort((a, b) => a - b);
    for (const list of [xs, ys]) for (let i = 1; i < list.length; i++) if (list[i] - list[i - 1] > C.pitch.max * 2 + EPS || (list[i] - list[i - 1] < C.pitch.min - EPS)) failures.push(`M17: the columns of ${q} stand on lines ${r3(list[i] - list[i - 1])} cells apart, wanted the pitch ${C.pitch.min} to ${C.pitch.max}`); // prettier-ignore
    for (const c of cols) {
      const top = Math.max(...c.parts.map((x) => x.z[1]));
      if (Math.abs(top - L.top) > EPS || c.parts[0].z[0] > L.floor + EPS) failures.push(`M17: column ${c.id} stands z ${c.parts[0].z[0]} to ${top}, wanted the hall's full height ${L.floor} to ${L.top}`); // prettier-ignore
    }
    const grid = cols[0].grid[0] * cols[0].grid[1];
    if (cols.length / grid < C.minShare - EPS) failures.push(`M17: ${cols.length} of ${grid} columns of ${q}'s grid stand, at least ${C.minShare * 100} %`); // prettier-ignore
  }
  const hallPlazas = fx.layers.filter((x) => x.ceiling === "vault").flatMap((L) => tilePlazas(fx, L.id)).filter((q) => Math.min(q.box[2] - q.box[0], q.box[3] - q.box[1]) >= C.minSide - EPS && !isBasin(fx, q)); // prettier-ignore
  for (const q of hallPlazas) if (!halls.has(q.id)) failures.push(`M17: ${q.id} (${r3(q.box[2] - q.box[0])} x ${r3(q.box[3] - q.box[1])} cells under the vault) has no columns, wanted a column hall at ${C.pitch.min}-${C.pitch.max} cells`); // prettier-ignore
  if (halls.size) notes.push(`M17: halls ${[...halls].map(([q, c]) => `${q} ${c.length} columns at ${c[0].pitch}`).join(", ")}; ${legs.size} vaulted legs with ribs or arches`); // prettier-ignore
  // M14 and V3: the wall's rhythm and its face where the tile reaches the city's edge
  const plan = cityPlan(fx);
  if (plan) {
    const W = fx.R.wall;
    if (plan.wallTop < W.top.min - EPS) failures.push(`M14: the wall's top at z ${plan.wallTop}, at least ${W.top.min}`);
    for (const sd of tileSides(fx, plan)) {
      const towers = by("wall-tower").filter((t) => t.side === sd.side).sort((a, b) => a.t - b.t);
      const [t0, t1] = [Math.max(0, sd.span[0]), Math.min(sd.len, sd.span[1])];
      if (!towers.length) failures.push(`M14: the city's ${sd.side} wall in the tile (${r3(t1 - t0)} cells) has no tower`);
      for (let i = 1; i < towers.length; i++) if (towers[i].t - towers[i - 1].t > W.tower.pitch.max + EPS) failures.push(`M14: towers on the ${sd.side} wall stand ${r3(towers[i].t - towers[i - 1].t)} cells apart (at ${towers[i - 1].t} and ${towers[i].t}), at most ${W.tower.pitch.max}`); // prettier-ignore
      if (towers.length && (towers[0].t - t0 > W.tower.pitch.max + EPS || t1 - towers[towers.length - 1].t > W.tower.pitch.max + EPS)) failures.push(`M14: the ${sd.side} wall's towers leave ${r3(Math.max(towers[0].t - t0, t1 - towers[towers.length - 1].t))} cells at the tile's end, at most ${W.tower.pitch.max}`); // prettier-ignore
      for (const t of towers) {
        if (t.projection < W.tower.projection.min - EPS) failures.push(`M14: ${t.id} projects ${t.projection} cells, at least ${W.tower.projection.min}`);
        const shaftTop = t.parts[0].z[1];
        if (shaftTop < plan.wallTop + W.tower.rise.min - EPS) failures.push(`M14: ${t.id} rises to z ${shaftTop}, at least ${W.tower.rise.min} over the wall's top ${plan.wallTop}`); // prettier-ignore
        if (Math.max(...t.parts.map((p) => p.z[1])) > plan.sky + EPS) failures.push(`V4: ${t.id} rises past the sky lid z ${plan.sky}`);
      }
      // V3: every stretch of public floor at the wall within bare.max of a tower, a pilaster or a gate
      const L = fx.layerOf(plan.layer);
      const marks = [...towers.map((t) => t.t), ...by("wall-face").filter((f) => f.side === sd.side).flatMap((f) => f.pilasters ?? [])];
      const gates = sd.gates.map((g) => g.span);
      let bare = null;
      for (let t = t0 + 0.25; t < t1; t += 0.5) {
        if (!floorAt(fx, L.id, add(onSide(sd, t), sd.in, 0.25))) continue;
        if (gates.some((g) => t >= g[0] - EPS && t <= g[1] + EPS)) continue;
        if (!marks.some((m) => Math.abs(m - t) <= W.pilaster.every.max / 2 + 0.25 + EPS)) {
          bare = t;
          break;
        }
      }
      if (bare !== null) failures.push(`V3: the ${sd.side} wall is a bare face at ${r3(bare)} cells along (public floor reaches it with no tower, pilaster or gate within ${W.pilaster.every.max / 2} cells)`); // prettier-ignore
    }
    // M21: no sky below eye level: the wall's top over every open public floor's eye; a road ends in a card past the eye
    const eye = fx.R.backdrop.eye.typical;
    for (const L of fx.layers.filter((x) => x.sky)) if (plan.wallTop < L.floor + eye - EPS) failures.push(`M21: the wall's top z ${plan.wallTop} is under ${L.id}'s eye z ${r3(L.floor + eye)}: the sky shows below eye level over the wall`); // prettier-ignore
    for (const r of by("gate-road")) {
      const end = r.parts.find((p) => p.what === "end card");
      const L = fx.layerOf(r.layer);
      if (!end || end.z[0] > L.floor + EPS || end.z[1] < L.floor + eye - EPS) failures.push(`M21: ${r.id} does not end in a card from its floor past the eye (z ${r3(L.floor + eye)}): the sky shows down the road`); // prettier-ignore
    }
    // V4: the far clip and the lid
    const reach = plan.longestUnits * (1 + fx.R.backdrop.farClipMargin);
    if (plan.maxRange < reach - EPS) failures.push(`V4: worldspawn MaxRange ${plan.maxRange} is under the longest line to the backdrop ${plan.longestUnits} units plus ${fx.R.backdrop.farClipMargin * 100} %`); // prettier-ignore
    const ext = (fx.desc.engine?.limits?.extent?.value ?? 32768) / fx.cu;
    const [ox, oy] = fx.desc.grid?.origin ?? [0, 0];
    for (const f of forms)
      for (const p of f.points ?? []) {
        if (p.top !== undefined && p.top > plan.sky + EPS) failures.push(`V4: ${f.id}'s ${p.what} rises to z ${p.top}, past the sky lid ${plan.sky}`);
        if (Math.abs(p.at[0] - ox) > ext || Math.abs(p.at[1] - oy) > ext) failures.push(`${f.id}'s ${p.what} at [${p.at}] is outside the engine's extent`);
      }
    for (const f of [...by("card"), ...by("gate-road")]) for (const p of f.parts) if (p.z[1] > plan.sky + EPS) failures.push(`V4: ${f.id}'s ${p.what} rises past the sky lid ${plan.sky}`); // prettier-ignore
    // the city's sound loops
    const loops = cityLoops(fx, plan);
    if (loops.count > fx.R.scaleIllusion.sounds.maxPerCity) failures.push(`S6: ${loops.count} distant sound loops in the city (${loops.what.join(", ")}), at most ${fx.R.scaleIllusion.sounds.maxPerCity}`); // prettier-ignore
    notes.push(`edge: the wall's top z ${plan.wallTop}, towers every ${plan.sides.map((sd) => `${r3(sd.pitch)} (${sd.side})`).join(", ")} cells; the longest line to the backdrop ${plan.longestUnits} units (MaxRange ${plan.maxRange}); ${tileSides(fx, plan).length ? `the tile reaches the ${tileSides(fx, plan).map((s) => s.side).join(", ")} side` : "the tile reaches no side of the city"}; sound loops in the city ${loops.count} (${loops.what.join(", ")})`); // prettier-ignore
  }
  // V7: voids guarded, gantries out of reach
  for (const s of by("shaft")) {
    const cut = s.parts.find((p) => p.build === "cut");
    const grate = s.parts.find((p) => p.what === "grate" && p.build === "entity");
    const ring = s.parts.filter((p) => p.what === "parapet").length;
    if (!grate && ring < 4) failures.push(`V7: shaft ${s.id} is not guarded (a grate over it or a parapet ring)`);
    else if (grate && cut && polyOverlap(grate.poly, cut.poly) < Math.min(polyBox(cut.poly)[2] - polyBox(cut.poly)[0], polyBox(cut.poly)[3] - polyBox(cut.poly)[1]) / 2 - 0.01) failures.push(`V7: shaft ${s.id}'s grate does not cover it`); // prettier-ignore
  }
  const reachZ = ((fx.rules.hull?.engines?.goldsrc?.height ?? 72) + (fx.rules.hull?.engines?.goldsrc?.jump ?? 45)) / fx.cu;
  for (const g of by("gantry")) {
    const L = fx.layerOf(g.layer);
    if (g.walkable === false && g.underside - L.floor < reachZ - EPS) failures.push(`V7: gantry ${g.id}'s underside z ${g.underside} is within reach (the hull and a jump, ${r3(reachZ)} cells)`); // prettier-ignore
    if (g.parts.filter((p) => p.what === "rail").length < 2) failures.push(`V7: gantry ${g.id} has no rail on both sides`);
  }
  // F25: raised, never sunk; one step without a flight
  for (const d of by("dais")) {
    const L = fx.layerOf(d.layer);
    for (const p of d.parts) {
      if (p.z[0] < L.floor - EPS) failures.push(`F25: ${d.id} sinks under ${L.id}'s floor (z ${p.z[0]}): ground is raised by detail, never sunk`);
      if (p.z[1] - L.floor > fx.R.ground.step.max + EPS) failures.push(`F25: ${d.id} rises ${r3(p.z[1] - L.floor)} cells with no flight, at most a step (${fx.R.ground.step.max})`); // prettier-ignore
    }
  }
  // V8: every giant beside something human-sized
  for (const f of by("fan")) if (!humanNear(fx, f.layer, f.at)) failures.push(`V8: fan ${f.id} has nothing human-sized (a door, a lamp, a sign) within ${fx.R.scaleIllusion.human.reach.max} cells`); // prettier-ignore
  // (a tower whose foot meets no public floor, all in a lot's rock, has no foot to read a door against: a note)
  const plan0 = cityPlan(fx);
  for (const t of by("wall-tower")) {
    const v = towerDoorCheck(fx, plan0, t);
    if (v?.failure) failures.push(v.failure);
    else if (v?.note) notes.push(v.note);
  }
  // M15: a view event at most scaleIllusion.view.every.max apart along the tile's public ways
  m15(forms, fx, failures, notes);
  // V4 and S1: what the artifact hands the geometry for worldspawn
  const ws = world?.worldspawn;
  if (world && plan) {
    const reach = Math.ceil(plan.longestUnits * (1 + fx.R.backdrop.farClipMargin));
    if (!ws) failures.push("V4: the artifact hands the geometry no worldspawn keys (world.worldspawn: MaxRange, skyname)");
    else {
      if (!(ws.MaxRange >= reach)) failures.push(`V4: worldspawn MaxRange ${ws.MaxRange} is under the longest line to the backdrop ${plan.longestUnits} units plus ${fx.R.backdrop.farClipMargin * 100} % (${reach})`); // prettier-ignore
      if (ws.MaxRange > (fx.desc.engine?.limits?.extent?.value ?? 32768)) failures.push(`V4: worldspawn MaxRange ${ws.MaxRange} is past the engine's extent ${fx.desc.engine?.limits?.extent?.value ?? 32768}`); // prettier-ignore
      if (!(typeof ws.skyname === "string" && ws.skyname)) failures.push("S1: worldspawn has no skyname (the rendered sky, levels/tools/sky.mjs)");
    }
  }
  return { failures, notes };
}

/** M15: along each public way's legs in the tile, the gaps between view events (judged where the gap lies in the tile). */
function m15(forms, fx, failures, notes) {
  const every = fx.R.scaleIllusion.view.every.max;
  const reach = fx.R.scaleIllusion.view.reach.max;
  const events = [];
  for (const q of fx.site.plazas) events.push({ layer: q.layer, box: q.box, what: q.id });
  for (const f of [...fx.placed, ...forms]) if (["oculus", "light-shaft", "fan", "wall-tower", "arch", "deck-edge", "core", "cistern-column", "shaft", "truss"].includes(f.kind)) events.push({ layer: f.kind === "oculus" ? fx.deck?.layer : f.layer, box: [f.at[0], f.at[1], f.at[0], f.at[1]], what: f.id }); // prettier-ignore
  for (const l of fx.lots.lots) if (l.tower) events.push({ layer: l.layer, box: [l.tower.at[0], l.tower.at[1], l.tower.at[0], l.tower.at[1]], what: `${l.building}'s tower` }); // prettier-ignore
  if (fx.deck) events.push({ layer: fx.deck.layer, edgeOf: fx.deck.box, what: "the deck's edge" });
  let judged = 0;
  for (const w of fx.site.ways.filter((x) => x.access === "public" && x.class !== "service")) {
    for (const pts of w.parts) {
      // positions along the whole polyline, events within reach
      const marks = [];
      let s = 0;
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]];
        const len = dist(a, b);
        for (let t = 0; t <= len + EPS; t += 0.5) {
          const p = add(a, unit(a, b), Math.min(t, len));
          const near = events.some((e) => e.layer === w.layer && (e.edgeOf ? Math.abs(inBox(p, e.edgeOf) - inBox(add(p, [reach, 0]), e.edgeOf)) + Math.abs(inBox(p, e.edgeOf) - inBox(add(p, [-reach, 0]), e.edgeOf)) + Math.abs(inBox(p, e.edgeOf) - inBox(add(p, [0, reach]), e.edgeOf)) + Math.abs(inBox(p, e.edgeOf) - inBox(add(p, [0, -reach]), e.edgeOf)) > 0 : Math.hypot(Math.max(e.box[0] - p[0], 0, p[0] - e.box[2]), Math.max(e.box[1] - p[1], 0, p[1] - e.box[3])) <= reach + EPS)); // prettier-ignore
          marks.push({ s: s + Math.min(t, len), p, near });
        }
        s += len;
      }
      // a stretch in the tile with no view event within reach (from the last event or from where the way enters the tile)
      let from = null;
      let said = false;
      for (const m of marks) {
        if (!inBox(m.p, fx.tile.box) || m.near) {
          if (from && m.near) judged++;
          from = m.near && inBox(m.p, fx.tile.box) ? m : null;
          said = false;
          continue;
        }
        from ??= m;
        if (!said && m.s - from.s > every + EPS) {
          failures.push(`M15: ${w.id} runs ${r3(m.s - from.s)} cells with no view (a plaza, an oculus, a deck-edge view, a landmark, an arcade, a hall) from [${from.p.map(say)}] to [${m.p.map(say)}], at most ${every}`); // prettier-ignore
          said = true;
        }
      }
    }
  }
  notes.push(`M15: ${judged} stretches between view events judged on the tile's public ways (at most ${every} cells)`);
}

export const _internal = { cityPlan, ceilingOf, segmental, tileSides, budgetOf, humanNear };
