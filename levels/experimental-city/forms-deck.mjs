// The deck family of stage 9 (levels/experimental-city/stage9-forms.mjs): the frame that carries the upper deck over the layer
// under it, so the street under the deck reads as part of one structure and not as boxes under a lid
// (levels/notes-megastructure.md F1-F9, F26; the rulebook's `forms` section; the checks M1-M7, M16). A pure
// function of the forms context: the same artifacts give the same forms.
//
// Written rules (each a sentence the family's check holds or the placer obeys):
//   - Naves (F1, F3, F6). Along every public way under the deck (no service hallway, no canal), each straight leg of
//     its whole line under the deck is cut into bays of at most forms.pier.pitch.typical (7 cells), a station at each
//     bay's middle, so the rhythm runs on through the seams; a tile places the stations whose point is in it; at a
//     station a pier stands engaged in each street wall: forms.pier.width along the way, projecting its typical half
//     cell where the sidewalk keeps placement.minWalkWidth beside it, else a pilaster's projection.min, never into
//     the carriageway and its kerb (dressing.mjs KERB); embedded half a cell into a facade's rock or the block's
//     back, not into an enterable building; never where the wall behind is open floor (a junction, another way).
//     A station that cannot hold a pier slides along the way by half cells, at most 2 cells either side, outward
//     (toward its leg's nearer end) first unless that could open a bay past maxPitchPastObstacle. A girder
//     spans the way between the two piers of a station, its top on the deck's soffit, span/12 deep in game height
//     (forms.girder), haunched past girder.haunch.minSpan; the piers' capitals stop under it. Each leg with a girder
//     carries a pipe, a duct and a cable tray under its girders (forms.services), one straight run each.
//   - Feet (F2). A pier over rock lands; over a plaza (a hall) of the layer below it comes down a foot there, 1.5
//     cells square, with an impost; over a way, a building, a hallway or a connector of the layer below it does not
//     land and the station slides (M4).
//   - Plazas (F1, F4, F5). Over each plaza under the deck: trusses across its shorter span at the pier pitch, each
//     bearing on an engaged pier at both of its edges (a truss without both bears is not built; it slides like a
//     station); piers at the pitch along the two other edges; coffers both ways (forms.coffer), a beam cut round
//     whatever passes through the deck.
//   - Fusion (F7). Each facade lot under the deck in the tile is worked by its district's wealth
//     (forms.fusion.modeByWealth): full, partial or gap (the rulebook's note says what each holds and why).
//   - Deck edge (F8). Where the deck's edge (the upper layer's bounds) runs through the tile: bays of at most
//     forms.deckEdge.bay.max, each a fascia (on half-cell runs, its bottom raised to the top of a wall standing past
//     the edge under it: a facade lot stage 2 cut across the edge line), brackets at bracket.every.typical along the
//     stretches the edge overhangs (where it bears on a wall standing to the soffit there is no cantilever, and a
//     bracket would stand in the wall's rock: M7 counts them over the overhang), an edge pier pierSetback in from the
//     edge (sliding like a station), and the upper layer's parapet wherever its floor reaches the edge.
//   - Oculi (F9). Over each plaza under the deck, the first legal opening by guard (a parapet ring before a flush
//     grate), size (4 x 4, then 4 x 2 and 2 x 4) and nearness to the plaza's centre, inset forms.oculus.inset, on the
//     upper layer's public floor under the sky (never under a portico's vault); with a parapet nothing of the upper
//     layer may stand or pass over the hole and its ring keeps the walk; a grate is floor.
//   - Cores (F26). The Nexus's spine (msr.nexus's connectors with three stops or more): a 16-sided drum round
//     their wells; on each layer, each side of the drum standing on public floor gets a wall segment and a rib.
//   - Every part is then held to stage 9's common rules (forms.mjs); a form whose part fails them is not placed and
//     the station slides or the form is left out with a note. The walk: a standing form that cuts a street walk is
//     taken out again, nearest the cut first (its girder, truss and services with it).
import { r3, dist, polyOverlap, polyBox, clipPolyline, growPoly, bandPoly, trimStartInBox, trimEndInBox, meander, seeded, seedOf } from "./geom.mjs"; // prettier-ignore
import { KERB } from "./dressing.mjs";
import { measured } from "./site.mjs";
import { part, instance, partFaults, walkBreaks, boxPoly, HULL_HEAD } from "./forms.mjs";

export const family = {
  id: "deck",
  order: 10,
  forms: ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F26"],
  place,
  check,
};

/** A station's slides off its place, half a cell at a time, nearest first (+ before -), at most forms.pier.slide.max (2 cells). */
const DELTAS = [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2];
const q4 = (v) => Math.ceil(v * 4 - 1e-9) / 4; // up to a quarter cell
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
const unit = (a, b) => {
  const L = dist(a, b) || 1;
  return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
};
const left = (u) => [-u[1], u[0]];
/** A rectangle from point c: along u from a0 to a1, along v from b0 to b1. */
const oriented = (c, u, v, a0, a1, b0, b1) => [
  add(add(c, u, a0), v, b0),
  add(add(c, u, a1), v, b0),
  add(add(c, u, a1), v, b1),
  add(add(c, u, a0), v, b1),
];
const centroid = (poly) => [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
const inBox = (p, b, e = 0) => p[0] >= b[0] - e && p[0] <= b[2] + e && p[1] >= b[1] - e && p[1] <= b[3] + e;
const boxMeet = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
const boxDist = (a, b) => Math.hypot(Math.max(0, b[0] - a[2], a[0] - b[2]), Math.max(0, b[1] - a[3], a[1] - b[3]));
const rectBox = (r) => [r.x, r.y, r.x + r.w, r.y + r.d];
const say = (v) => `${r3(v)}`;

// ── what stands where ──

/** The owner of a point of a layer's public floor (cells): { kind: way | plaza, id } or null. */
const floorAt = (fx, lid, p) => fx.world(lid).W.ownerAt([p[0] * fx.cell, p[1] * fx.cell]);
/** The lot of a layer holding a point (cells), or null. */
const lotAt = (fx, lid, p) => fx.lots.lots.find((l) => l.layer === lid && inBox(p, rectBox(l.rect), 1e-6)) ?? null;
/** The plaza of a layer whose box holds a point. */
const plazaAt = (fx, lid, p) => fx.site.plazas.find((q) => q.layer === lid && inBox(p, q.box, 1e-6)) ?? null;
/** Whether a point of a layer stands under a portico's vault (a way's portico band, a square's portico). */
function underPortico(fx, lid, p) {
  for (const w of fx.site.ways) {
    if (w.layer !== lid || !(w.portico > 0)) continue;
    for (const pts of w.parts)
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]];
        const u = unit(a, b);
        const t = (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1];
        if (t < 0 || t > dist(a, b)) continue;
        const off = Math.abs((p[0] - a[0]) * -u[1] + (p[1] - a[1]) * u[0]);
        if (off <= w.width / 2 + 1e-6 && off >= w.width / 2 - w.portico - 1e-6) return `${w.id}'s portico`;
      }
  }
  for (const q of fx.site.plazas) if (q.layer === lid && q.portico && inBox(p, q.box) && !inBox(p, q.portico.line)) return `${q.id}'s portico`;
  return null;
}

/**
 * Where a footprint of a layer lands on the layer below (M4): rock, a hall (a plaza) or blocked by what stands there.
 * Returns { kind: "rock" } | { kind: "hall", plaza } | { kind: "blocked", what }.
 */
export function landingOf(fx, lid, poly) {
  const L = fx.layerOf(lid);
  const B = fx.layers.find((x) => x.level === L.level - 1);
  if (!B) return { kind: "rock" };
  const zB = [B.floor, B.top];
  const meetsZ = (z) => Math.min(z[1], zB[1]) - Math.max(z[0], zB[0]) > 0.01;
  for (const w of fx.site.ways) {
    if (w.layer !== B.id) continue;
    for (const pts of w.parts) for (let i = 1; i < pts.length; i++) if (polyOverlap(poly, bandPoly(pts[i - 1], pts[i], w.width)) > 0.01) return { kind: "blocked", what: `${B.id}'s way ${w.id}` }; // prettier-ignore
  }
  for (const s of fx.solids) {
    if (s.kind === "facade" || s.kind === "prop" || !meetsZ(s.z)) continue;
    if (polyOverlap(poly, s.poly) > 0.01) return { kind: "blocked", what: `${s.what} on ${B.id}` };
  }
  const hall = fx.site.plazas.find((q) => q.layer === B.id && polyOverlap(poly, boxPoly(q.box)) > 0.01);
  return hall ? { kind: "hall", plaza: hall.id } : { kind: "rock" };
}

// ── piers ──

/**
 * An engaged pier on a wall line: `at` a point on the line, `u` along it, `s` out of the floor into the wall;
 * `p` how far it projects into the floor; `capTop` its capital's top (a girder's soffit, or the deck's).
 * Returns { inst, faults: [sentences] } (inst null when it cannot stand).
 */
function pierOn(fx, lid, { at, u, s, p, capTop, id, on, onKind, extra = {}, owner }) {
  const P = fx.R.pier;
  const L = fx.layerOf(lid);
  const width = Math.max(P.width.typical, P.width.min, (capTop - L.floor) / P.maxSlenderness);
  const behind = add(at, s, 0.25);
  const faults = [];
  if (floorAt(fx, lid, behind)) faults.push(`open floor behind it at [${behind.map(say)}]`);
  const lot = lotAt(fx, lid, behind);
  const embed = lot?.kind === "enterable" ? 0 : P.embed.typical;
  // the visible part on this way's (or plaza's) floor
  const mid = add(at, s, -p / 2);
  const o = floorAt(fx, lid, mid);
  if (!o || (owner && o.id !== owner)) faults.push(`its face would stand off ${owner ?? "the floor"} (at [${mid.map(say)}]: ${o ? o.id : "no floor"})`);
  const poly = oriented(at, u, s, -width / 2, width / 2, -p, embed);
  const capH = P.capital.height.typical;
  const shaft = part("prism", poly, [L.floor, capTop - capH], { embeds: embed > 0 });
  const capital = part("frustum", poly, [capTop - capH, capTop], { top: growPoly(poly, P.capital.flare.typical), embeds: true });
  for (const pt of [shaft, capital]) for (const x of partFaults(fx, pt, { layers: [lid] })) faults.push(`it enters ${x.what} by ${x.by}`);
  const landing = landingOf(fx, lid, poly);
  if (landing.kind === "blocked") faults.push(`it does not land: over ${landing.what} (M4)`);
  if (faults.length) return { inst: null, faults };
  const inst = instance({ id, family: "deck", form: "F1", kind: "pier", layer: lid, build: "detail", frame: true, role: L.frame, on, onKind, at: centroid(poly).map(r3), width: r3(width), projection: r3(p), embed: r3(embed), capTop: r3(capTop), landing, ...extra, parts: [shaft, capital] }); // prettier-ignore
  return { inst, faults: [] };
}

/** A pier's foot in the hall under it (F2), or a fault sentence. */
function footUnder(fx, lid, pier) {
  const L = fx.layerOf(lid);
  const B = fx.layers.find((x) => x.level === L.level - 1);
  const F = fx.R.pierFoot;
  const c = pier.at;
  const w = F.width.min;
  const poly = boxPoly([c[0] - w / 2, c[1] - w / 2, c[0] + w / 2, c[1] + w / 2]);
  const ih = F.impost.height.typical;
  const shaft = part("prism", poly, [B.floor, B.top - ih]);
  const impost = part("frustum", poly, [B.top - ih, B.top], { top: growPoly(poly, F.impost.flare.typical) });
  const faults = [];
  for (const pt of [shaft, impost]) for (const x of partFaults(fx, pt, { layers: [B.id] })) faults.push(`its foot enters ${x.what} by ${x.by}`); // prettier-ignore
  if (faults.length) return { inst: null, faults };
  return { inst: instance({ id: `${pier.id}.foot`, family: "deck", form: "F2", kind: "pier-foot", layer: B.id, build: "detail", frame: true, role: B.frame, on: pier.landing.plaza, carries: pier.id, at: c, parts: [shaft, impost] }), faults: [] }; // prettier-ignore
}

/** How far an engaged pier projects from a way's wall: its typical where the sidewalk keeps the walk, else a pilaster's. */
function projectionOf(fx, w) {
  const P = fx.R.pier;
  const cell = fx.cell;
  if (!w.vehicle || w.carriageway === null || w.carriageway === undefined) return P.projection.min;
  const side = Math.max(w.sidewalk ?? 0, w.portico ?? 0);
  const room = (side * cell - KERB - fx.rules.placement.minWalkWidth) / cell;
  const most = (side * cell - KERB) / cell;
  const p = room >= P.projection.typical ? P.projection.typical : P.projection.min;
  return Math.min(p, Math.max(0, Math.floor(most * 8) / 8));
}

/** A girder's depth over a span (M2): span/12 in game height (scale.ceiling) on the quarter-cell grid, at least half a cell. */
const girderDepth = (fx, span) => Math.max(0.5, q4(span * fx.R.girder.minDepthPerSpan * (fx.rules.scale?.ceiling ?? 1.5)));

// ── naves ──

/**
 * A way's whole centre line through the city, as stage 1 draws it (levels/experimental-city/stage1-site.mjs: the segment's two
 * nodes, a winding one meandering between its portal points, trimmed out of its nodes' squares), or null when the
 * tile's parts of the way are not that line cut to the tile's window (the tile's own parts are then its legs).
 */
export function wholeLine(fx, w) {
  let m;
  try {
    m = measured(fx.desc);
  } catch {
    return null;
  }
  const s = m.segments.get(w.id);
  const A = m.nodes.get(s?.from);
  const B = m.nodes.get(s?.to);
  if (!s || !A || !B) return null;
  let line = [A.at, B.at];
  if (w.winding) {
    const cuts = (fx.desc.tiles?.portals ?? []).filter((p) => p.segment === s.id).map((p) => p.at).sort((p, q) => dist(A.at, p) - dist(A.at, q)); // prettier-ignore
    const stops = [A.at, ...cuts, B.at];
    const rng = seeded(seedOf(fx.seed, s.id));
    line = [A.at];
    for (let i = 1; i < stops.length; i++) {
      const share = (s.length * dist(stops[i - 1], stops[i])) / s.straight;
      line.push(...meander(stops[i - 1], stops[i], share, Math.max(2, Math.round(share / 8)), rng() < 0.5 ? 1 : -1).slice(1));
    }
  }
  const boxOf = (n) => (n.size ? [n.at[0] - n.size[0] / 2, n.at[1] - n.size[1] / 2, n.at[0] + n.size[0] / 2, n.at[1] + n.size[1] / 2] : null); // prettier-ignore
  if (boxOf(A)) line = trimStartInBox(line, boxOf(A));
  if (boxOf(B)) line = trimEndInBox(line, boxOf(B));
  // the same line as the tile's: cut to the window it gives the tile's parts
  const win = fx.site.tile.window;
  const parts = clipPolyline(line, win);
  const same = parts.length === w.parts.length && parts.every((pl, i) => pl.length === w.parts[i].length && pl.every((p, j) => dist(p, w.parts[i][j]) < 0.01)); // prettier-ignore
  return same ? line : null;
}

/**
 * The legs of an under-deck way the tile frames: each straight run of the way's whole line under the deck, so its
 * stations keep one rhythm through the seams (each tile places the stations whose point is in it), with `cut` the
 * stretch of the leg in the tile; a way whose whole line is not known gives its legs in the tile alone.
 */
function navesLegs(fx, w) {
  const D = fx.deck;
  const tb = fx.tile.box;
  const legs = [];
  const whole = wholeLine(fx, w);
  if (whole) {
    let leg = 0;
    for (const line of clipPolyline(whole, D.box))
      for (let i = 1; i < line.length; i++) {
        const [a, b] = [line[i - 1], line[i]];
        const len = dist(a, b);
        const inTile = clipPolyline([a, b], tb)[0];
        const k = leg++;
        if (!inTile || dist(inTile[0], inTile[inTile.length - 1]) < 1e-6) continue;
        const cut = [dist(a, inTile[0]), dist(a, inTile[inTile.length - 1])].sort((x, y) => x - y);
        // a station's point on a seam belongs to the tile east or north of it
        const owns = (p) => p[0] >= tb[0] - 1e-9 && p[0] < tb[2] - 1e-9 && p[1] >= tb[1] - 1e-9 && p[1] < tb[3] - 1e-9;
        legs.push({ a, b, len, leg: k, cut, owns, rhythm: "whole" });
      }
    return legs;
  }
  let leg = 0;
  for (const pts of w.parts)
    for (const line of clipPolyline(pts, boxMeet(tb, D.box)))
      for (let i = 1; i < line.length; i++) {
        const [a, b] = [line[i - 1], line[i]];
        const len = dist(a, b);
        legs.push({ a, b, len, leg: leg++, cut: [0, len], owns: () => true, rhythm: "tile" });
      }
  return legs;
}

/**
 * The order a station of a leg tries its slides (half cells, at most 2 either side): outward first, toward the
 * leg's nearer end, so a station giving way keeps the bays between the stations (the frame's rhythm, M6) and gives
 * up the end bay, which ends at a junction or the deck's edge; inward first where an outward slide could open a bay
 * past forms.pier.maxPitchPastObstacle (M1). A leg's middle station tries them as DELTAS.
 */
export function slideOrder(k, n, bay, P) {
  const so = Math.sign(k + 0.5 - n / 2);
  if (!so) return DELTAS;
  const out = [0];
  for (const m of [0.5, 1, 1.5, 2]) out.push(...(bay + 2 * m <= P.maxPitchPastObstacle + 1e-9 ? [so * m, -so * m] : [-so * m, so * m]));
  return out;
}

function naves(fx, out) {
  const D = fx.deck;
  const L = fx.layerOf(D.layer);
  const P = fx.R.pier;
  const G = fx.R.girder;
  const ways = fx.site.ways.filter((w) => w.layer === L.id && w.class !== "service" && w.class !== "canal" && w.access === "public"); // prettier-ignore
  for (const w of ways) {
    const half = w.width / 2;
    const p = projectionOf(fx, w);
    const span = w.width - 2 * p;
    const depth = girderDepth(fx, span);
    const ribSoffit = D.soffit - depth;
    for (const { a, b, len, leg, cut, owns, rhythm } of navesLegs(fx, w)) {
          if (len < 2 * P.width.typical) continue;
          const u = unit(a, b);
          const nL = left(u);
          const n = Math.max(1, Math.ceil(len / P.pitch.typical - 1e-9));
          const legRibs = [];
          for (let k = 0; k < n; k++) {
            const t0 = ((k + 0.5) * len) / n;
            if (!owns(add(a, u, t0))) continue;
            const room = len / (2 * n) - P.width.typical / 2;
            let best = null;
            const why = [];
            for (const d of slideOrder(k, n, len / n, P)) {
              if (Math.abs(d) > Math.max(0, room) + 1e-9 || Math.abs(d) > P.slide.max + 1e-9) continue;
              const t = t0 + d;
              const c = add(a, u, t);
              const sides = [1, -1].map((sg) => {
                const sv = [nL[0] * sg, nL[1] * sg];
                const id = `deck.pier.${w.id}.${leg}.${k}${sg > 0 ? "l" : "r"}`;
                return pierOn(fx, L.id, { at: add(c, sv, half), u, s: sv, p, capTop: ribSoffit, id, on: w.id, onKind: "way", owner: w.id, extra: { leg, station: k, side: sg > 0 ? "l" : "r", t: r3(t), nominal: r3(t0), bays: n, legLength: r3(len), rhythm } }); // prettier-ignore
              });
              // a foot under each pier over a hall
              for (const sd of sides) {
                if (!sd.inst || sd.inst.landing.kind !== "hall") continue;
                const ft = footUnder(fx, L.id, sd.inst);
                if (!ft.inst) {
                  sd.faults.push(...ft.faults);
                  sd.inst = null;
                } else sd.foot = ft.inst;
              }
              const okN = sides.filter((sd) => sd.inst).length;
              if (okN === 2) {
                best = { t, c, sides };
                break;
              }
              if (okN === 1 && !best) best = { t, c, sides };
              if (d === 0) why.push(...sides.flatMap((sd, j) => sd.faults.map((f) => `${j ? "right" : "left"}: ${f}`)));
            }
            if (!best) {
              out.notes.push(`nave ${w.id} leg ${leg}: no pier at station ${k} (${r3(t0)} cells along): ${why.slice(0, 2).join("; ")}`);
              continue;
            }
            for (const sd of best.sides) if (sd.inst) out.forms.push(sd.inst, ...(sd.foot ? [sd.foot] : []));
            // the girder: on both piers, or on one pier and a corbel in the wall where the other could not stand
            // (never where the wall behind it is open floor: a junction)
            const tR = G.width.typical;
            const bearings = best.sides.map((sd, j) => {
              if (sd.inst) return { pier: sd.inst.id };
              const sg = j === 0 ? 1 : -1;
              const behind = add(add(best.c, nL, sg * half), nL, sg * 0.25);
              return floorAt(fx, L.id, behind) ? null : { wall: sg > 0 ? "l" : "r", sg };
            });
            if (bearings.some((x) => !x)) {
              const sd = best.sides.find((x) => x.inst);
              sd.inst.parts[1] = part("frustum", sd.inst.parts[1].poly, [sd.inst.parts[1].z[0], D.soffit], { top: sd.inst.parts[1].top, embeds: true }); // prettier-ignore
              sd.inst.capTop = D.soffit;
              out.notes.push(`nave ${w.id} leg ${leg} station ${k}: one pier only (${best.sides.map((x, j) => (x.inst ? null : `${j ? "right" : "left"}: ${x.faults[0]}`)).filter(Boolean).join("; ")}), no girder`); // prettier-ignore
              continue;
            }
            const beam = part("box", oriented(best.c, u, nL, -tR / 2, tR / 2, -half, half), [ribSoffit, D.soffit], { embeds: true, what: "beam" });
            const parts = [beam];
            for (const bg of bearings) {
              const sg = bg.wall ? bg.sg : bg === bearings[0] ? 1 : -1;
              const sv = [nL[0] * sg, nL[1] * sg];
              if (bg.wall) {
                // a corbel under the girder's end, in the wall
                parts.push(part("box", oriented(best.c, u, sv, -tR / 2, tR / 2, half - 0.25, half), [ribSoffit - 0.5, ribSoffit], { what: "corbel", embeds: true })); // prettier-ignore
              } else if (span >= G.haunch.minSpan - 1e-9) {
                const hl = G.haunch.length.typical;
                const hd = G.haunch.depth.typical;
                const poly = oriented(best.c, u, sv, -tR / 2, tR / 2, half - p - hl, half - p);
                parts.push(part("wedge", poly, [ribSoffit - hd, ribSoffit], { what: "haunch", edge: [add(add(best.c, u, -tR / 2), sv, half - p), add(add(best.c, u, tR / 2), sv, half - p)] })); // prettier-ignore
              }
            }
            const faults = parts.flatMap((pt) => partFaults(fx, pt, { layers: [L.id] }));
            if (faults.length) {
              out.notes.push(`nave ${w.id} leg ${leg} station ${k}: no girder (${faults[0].what} by ${faults[0].by})`);
              continue;
            }
            if (bearings.some((x) => x.wall)) out.notes.push(`nave ${w.id} leg ${leg} station ${k}: the girder bears on a corbel in the ${bearings.find((x) => x.wall).wall === "l" ? "left" : "right"} wall (${best.sides.find((x) => !x.inst).faults[0]})`); // prettier-ignore
            const rib = instance({ id: `deck.rib.${w.id}.${leg}.${k}`, family: "deck", form: "F3", kind: "rib", layer: L.id, build: "detail", frame: true, role: L.frame, on: w.id, leg, station: k, at: best.c.map(r3), span: r3(span), depth: r3(depth), soffit: r3(ribSoffit), clearanceTop: r3(w.z + w.clearance), bears: bearings.filter((x) => x.pier).map((x) => x.pier), bearsOnWall: bearings.filter((x) => x.wall).map((x) => x.wall), parts }); // prettier-ignore
            out.forms.push(rib);
            legRibs.push(rib);
          }
          // services under the girders of the leg
          if (legRibs.length) {
            const S = fx.R.services;
            const e = S.endClear.min;
            // kept off the leg's ends (its junctions, the deck's edge), run on through a seam (the next tile's run goes on)
            const r0 = cut[0] > 1e-6 ? cut[0] : e;
            const r1 = cut[1] < len - 1e-6 ? cut[1] : len - e;
            if (r1 - r0 < 1) continue;
            const zTop = ribSoffit - 0.125;
            const runs = [
              ["pipe", oriented(a, u, nL, r0, r1, half - p - 0.5 - S.pipe.typical / 2, half - p - 0.5 + S.pipe.typical / 2), [zTop - S.pipe.typical, zTop], "octagon-run"], // prettier-ignore
              ["duct", oriented(a, u, nL, r0, r1, -(half - p - 0.5) - S.duct.typical / 2, -(half - p - 0.5) + S.duct.typical / 2), [zTop - 0.375, zTop], "box"], // prettier-ignore
              ["tray", oriented(a, u, nL, r0, r1, -S.tray.typical / 2, S.tray.typical / 2), [zTop - 0.0625, zTop], "box"],
            ];
            const parts = [];
            for (const [what, poly, z, shape] of runs) {
              const pt = part(shape, poly, z, { what });
              const fl = partFaults(fx, pt, { layers: [L.id] });
              if (fl.length) out.notes.push(`services of ${w.id} leg ${leg}: no ${what} (${fl[0].what} by ${fl[0].by})`);
              else parts.push(pt);
            }
            if (parts.length) out.forms.push(instance({ id: `deck.services.${w.id}.${leg}`, family: "deck", form: "F6", kind: "services", layer: L.id, build: "detail", frame: false, role: null, on: w.id, leg, hungFrom: legRibs.map((r) => r.id), at: add(a, u, (cut[0] + cut[1]) / 2).map(r3), parts })); // prettier-ignore
          }
        }
  }
}

// ── plazas: edge piers, trusses, coffers ──

function plazaFrames(fx, out) {
  const D = fx.deck;
  const L = fx.layerOf(D.layer);
  const P = fx.R.pier;
  const T = fx.R.truss;
  const C = fx.R.coffer;
  const plazas = fx.site.plazas.filter((q) => q.layer === L.id && inBox(centroid(boxPoly(q.box)), fx.tile.box) && inBox([q.box[0], q.box[1]], D.box) && inBox([q.box[2], q.box[3]], D.box)); // prettier-ignore
  for (const q of plazas) {
    const b = q.box;
    const wx = b[2] - b[0];
    const wy = b[3] - b[1];
    const ax = wx <= wy ? 0 : 1; // the trusses span the shorter side (ties: along x)
    const span = ax === 0 ? wx : wy;
    const cross = ax === 0 ? wy : wx;
    const depth = q4(span * T.minDepthPerSpan);
    const proj = P.projection.typical;
    const trussLines = [];
    // edges: s, e, n, w with their line, along-vector u and outward s
    const edges = {
      s: { a: [b[0], b[1]], u: [1, 0], s: [0, -1], len: wx },
      n: { a: [b[0], b[3]], u: [1, 0], s: [0, 1], len: wx },
      w: { a: [b[0], b[1]], u: [0, 1], s: [-1, 0], len: wy },
      e: { a: [b[2], b[1]], u: [0, 1], s: [1, 0], len: wy },
    };
    const bearing = ax === 0 ? ["w", "e"] : ["s", "n"]; // the edges a truss bears on
    const others = ax === 0 ? ["s", "n"] : ["w", "e"];
    // trusses at the pitch across, each on a pier at both ends
    const n = Math.max(1, Math.ceil(cross / P.pitch.typical - 1e-9));
    for (let k = 0; k < n; k++) {
      const t0 = ((k + 0.5) * cross) / n;
      let done = null;
      const why = [];
      for (const d of DELTAS) {
        if (Math.abs(d) > cross / (2 * n) - P.width.typical / 2 + 1e-9) continue;
        const t = t0 + d;
        const ends = bearing.map((e) => {
          const E = edges[e];
          return pierOn(fx, L.id, { at: add(E.a, E.u, t), u: E.u, s: E.s, p: proj, capTop: D.soffit - depth, id: `deck.pier.${q.id}.${e}${k}`, on: q.id, onKind: "plaza", owner: q.id, extra: { edge: e, station: k, t: r3(t) } }); // prettier-ignore
        });
        for (const sd of ends) {
          if (!sd.inst || sd.inst.landing.kind !== "hall") continue;
          const ft = footUnder(fx, L.id, sd.inst);
          if (!ft.inst) (sd.faults.push(...ft.faults), (sd.inst = null));
          else sd.foot = ft.inst;
        }
        if (!ends.every((x) => x.inst)) {
          if (d === 0) why.push(...ends.flatMap((x) => x.faults.slice(0, 1)));
          continue;
        }
        const tr = trussAt(fx, q, ax, t, span, depth);
        if (tr.faults.length) {
          if (d === 0) why.push(tr.faults[0]);
          continue;
        }
        done = { ends, tr, t };
        break;
      }
      if (!done) {
        out.notes.push(`plaza ${q.id}: no truss at station ${k} (${r3(t0)} cells across): ${why.slice(0, 2).join("; ")}`);
        continue;
      }
      for (const sd of done.ends) out.forms.push(sd.inst, ...(sd.foot ? [sd.foot] : []));
      out.forms.push(instance({ id: `deck.truss.${q.id}.${k}`, family: "deck", form: "F5", kind: "truss", layer: L.id, build: "detail", frame: true, role: L.frame, on: q.id, station: k, axis: ax === 0 ? "x" : "y", at: [r3(ax === 0 ? (b[0] + b[2]) / 2 : b[0] + done.t), r3(ax === 0 ? b[1] + done.t : (b[1] + b[3]) / 2)], span: r3(span), depth: r3(depth), panels: done.tr.panels, bears: done.ends.map((x) => x.inst.id), parts: done.tr.parts })); // prettier-ignore
      trussLines.push(done.t);
    }
    // piers along the two other edges, capitals to the soffit
    for (const e of others) {
      const E = edges[e];
      const m = Math.max(1, Math.ceil(E.len / P.pitch.typical - 1e-9));
      for (let k = 0; k < m; k++) {
        const t0 = ((k + 0.5) * E.len) / m;
        let got = null;
        let why = null;
        for (const d of DELTAS) {
          if (Math.abs(d) > E.len / (2 * m) - P.width.typical / 2 + 1e-9) continue;
          const sd = pierOn(fx, L.id, { at: add(E.a, E.u, t0 + d), u: E.u, s: E.s, p: proj, capTop: D.soffit, id: `deck.pier.${q.id}.${e}${k}`, on: q.id, onKind: "plaza", owner: q.id, extra: { edge: e, station: k, t: r3(t0 + d) } }); // prettier-ignore
          if (sd.inst && sd.inst.landing.kind === "hall") {
            const ft = footUnder(fx, L.id, sd.inst);
            if (!ft.inst) (sd.faults.push(...ft.faults), (sd.inst = null));
            else sd.foot = ft.inst;
          }
          if (sd.inst) {
            got = sd;
            break;
          }
          if (d === 0) why = sd.faults[0];
        }
        if (got) out.forms.push(got.inst, ...(got.foot ? [got.foot] : []));
        else out.notes.push(`plaza ${q.id}: no pier on its ${e} edge at station ${k}: ${why}`);
      }
    }
    // coffers both ways, none within 0.75 cell of a truss
    coffers(fx, out, q, ax, trussLines);
  }
}

/** A truss across plaza q at `t` (cells from its least edge across): its parts and faults. */
function trussAt(fx, q, ax, t, span, depth) {
  const D = fx.deck;
  const T = fx.R.truss;
  const b = q.box;
  const a = ax === 0 ? [b[0], b[1] + t] : [b[0] + t, b[1]];
  const u = ax === 0 ? [1, 0] : [0, 1];
  const v = left(u);
  const th = 0.25;
  const ch = T.chord.typical;
  const zb = D.soffit - depth;
  const panels = Math.max(1, Math.min(7, Math.round(span / T.panel.typical)));
  const pl = span / panels;
  const parts = [
    part("box", oriented(a, u, v, 0, span, -th / 2, th / 2), [D.soffit - ch, D.soffit], { what: "top chord", embeds: true }),
    part("box", oriented(a, u, v, 0, span, -th / 2, th / 2), [zb, zb + ch], { what: "bottom chord", embeds: true }),
  ];
  for (let i = 1; i < panels; i++) parts.push(part("box", oriented(a, u, v, i * pl - th / 2, i * pl + th / 2, -th / 2, th / 2), [zb + ch, D.soffit - ch], { what: "vertical" })); // prettier-ignore
  for (let i = 0; i < panels; i++) parts.push(part("diagonal", oriented(a, u, v, i * pl, (i + 1) * pl, -th / 2, th / 2), [zb + ch, D.soffit - ch], { what: "diagonal", rises: i % 2 ? "down" : "up" })); // prettier-ignore
  const faults = [];
  for (const pt of parts) for (const x of partFaults(fx, pt, { layers: [D.layer] })) faults.push(`its ${pt.what} enters ${x.what} by ${x.by}`);
  return { parts, panels, faults };
}

function coffers(fx, out, q, ax, trussLines) {
  const D = fx.deck;
  const C = fx.R.coffer;
  const max = fx.R.maxBrushesBy?.coffers ?? 12;
  const b = q.box;
  const wx = b[2] - b[0];
  const wy = b[3] - b[1];
  let pitch = C.pitch.min;
  const lines = (pp) => Math.max(0, Math.ceil(wx / pp - 1e-9) - 1) + Math.max(0, Math.ceil(wy / pp - 1e-9) - 1);
  while (lines(pitch) > max) pitch += 0.5;
  const th = C.beam.typical;
  const z = [D.soffit - C.depth.typical, D.soffit];
  const parts = [];
  const skipped = [];
  // beams along y at x lines (dir 0), along x at y lines (dir 1)
  for (const dir of [0, 1]) {
    const len = dir === 0 ? wx : wy;
    const m = Math.max(0, Math.ceil(len / pitch - 1e-9) - 1);
    for (let i = 1; i <= m; i++) {
      const t = (i * len) / (m + 1);
      // a beam parallel to the trusses (trusses span axis ax, stand at cross positions) keeps off them
      const parallel = dir !== ax;
      if (parallel && trussLines.some((tl) => Math.abs(tl - t) < 0.75)) continue;
      const a = dir === 0 ? [b[0] + t, b[1]] : [b[0], b[1] + t];
      const u = dir === 0 ? [0, 1] : [1, 0];
      const full = dir === 0 ? wy : wx;
      for (const [s0, s1] of freeRuns(fx, a, u, full, th, z)) {
        if (parts.length >= max) break;
        if (s1 - s0 < 1) continue;
        parts.push(part("box", oriented(a, u, left(u), s0, s1, -th / 2, th / 2), z, { what: dir === 0 ? "beam n-s" : "beam e-w", embeds: true })); // prettier-ignore
      }
      if (parts.length >= max) skipped.push(`${dir === 0 ? "x" : "y"} ${r3(t)}`);
    }
  }
  if (parts.length) out.forms.push(instance({ id: `deck.coffers.${q.id}`, family: "deck", form: "F4", kind: "coffers", layer: D.layer, build: "detail", frame: true, role: fx.layerOf(D.layer).frame, on: q.id, pitch: r3(pitch), at: centroid(boxPoly(b)).map(r3), parts })); // prettier-ignore
  if (skipped.length) out.notes.push(`coffers of ${q.id}: beams at ${skipped.join(", ")} left out (forms.maxBrushesBy.coffers ${max})`);
}

/** The stretches of a beam line (from a along u, length len, width th, z) free of what the stages before placed. */
function freeRuns(fx, a, u, len, th, z) {
  const v = left(u);
  const step = 0.25;
  const ok = [];
  for (let s = 0; s < len - 1e-9; s += step) {
    const pt = part("box", oriented(a, u, v, s, Math.min(len, s + step), -th / 2, th / 2), z, { embeds: true });
    ok.push(partFaults(fx, pt, { layers: [fx.deck.layer] }).length === 0);
  }
  const runs = [];
  let s0 = null;
  ok.forEach((g, i) => {
    if (g && s0 === null) s0 = i * step;
    if (!g && s0 !== null) (runs.push([s0, i * step]), (s0 = null));
  });
  if (s0 !== null) runs.push([s0, len]);
  // a cut leaves a quarter cell to whatever it was cut round
  return runs.map(([x, y]) => [x === 0 ? 0 : x + 0.25, y === len ? len : y - 0.25]).filter(([x, y]) => y - x > 0);
}

// ── fusion ──

/** The carve heights the tile-layer already has (its floor, its top, its enterable buildings' roofs). */
function carveHeights(fx, lid) {
  const L = fx.layerOf(lid);
  const out = new Set([L.floor, L.top]);
  for (const l of fx.lots.lots) if (l.kind === "enterable" && l.layer === lid) out.add(r3(l.zBase + l.storeys * fx.storey));
  return out;
}

function fusion(fx, out) {
  const D = fx.deck;
  const L = fx.layerOf(D.layer);
  const F = fx.R.fusion;
  const districts = new Map((fx.desc.districts ?? []).map((d) => [d.id, d]));
  const heights = carveHeights(fx, L.id);
  const NORMAL = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] };
  const modes = new Map();
  for (const l of fx.lots.lots) {
    if (l.kind !== "facade" || l.layer !== L.id || l.tile !== fx.tile.id) continue;
    const r = rectBox(l.rect);
    if (!(inBox([r[0], r[1]], D.box) && inBox([r[2], r[3]], D.box))) continue;
    const dd = districts.get(l.district);
    let mode = F.modeByWealth[dd?.wealth ?? "mid"] ?? "partial";
    const top = r3(l.zBase + (l.facade?.height ?? 1));
    let why = `${dd?.wealth ?? "?"} wealth`;
    if (mode === "gap" && !(heights.has(top) && D.soffit - top >= F.gap.min - 1e-9)) {
      mode = "partial";
      why += `: its roofline z ${top} is no carve height of the tile-layer, or the gap is under ${F.gap.min} (a carved gap would add one, M19)`;
    }
    const side = l.frontage?.side ?? "s";
    const nrm = NORMAL[side];
    const [a, b] = side === "s" ? [[r[0], r[1]], [r[2], r[1]]] : side === "n" ? [[r[0], r[3]], [r[2], r[3]]] : side === "w" ? [[r[0], r[1]], [r[0], r[3]]] : [[r[2], r[1]], [r[2], r[3]]]; // prettier-ignore
    const u = unit(a, b);
    const len = dist(a, b);
    const parts = [];
    const dropped = [];
    const tryPart = (pt) => {
      const fl = partFaults(fx, pt, { layers: [L.id] });
      if (fl.length) dropped.push(`${pt.what} (${fl[0].what})`);
      else parts.push(pt);
    };
    if (mode !== "gap") tryPart(part("box", oriented(a, u, nrm, 0, len, 0, F.corbel.depth.typical), [D.soffit - F.corbel.height.typical, D.soffit], { what: "corbel course", embeds: true })); // prettier-ignore
    if (mode !== "full" && top - l.zBase >= F.cornice.height.typical) tryPart(part("box", oriented(a, u, nrm, 0, len, 0, F.cornice.depth.typical), [top - F.cornice.height.typical, top], { what: "cornice", embeds: true })); // prettier-ignore
    if (mode === "full") {
      const k = F.cagesPerFace[Math.max(0, F.cageDensities.indexOf(dd?.density ?? "medium"))] ?? 0;
      const cw = Math.min(F.cage.width.typical, len / Math.max(1, k) - 0.25);
      // over the top storey in the fused band, else on the top storey (never on the ground storey)
      let z0 = top;
      let z1 = Math.min(top + F.cage.height.typical, D.soffit - F.corbel.height.typical);
      if (z1 - z0 < 0.75) [z0, z1] = [top - F.cage.height.typical, top];
      if (k > 0 && cw >= 0.5 && z0 >= L.floor + F.cage.height.typical - 1e-9)
        for (let i = 0; i < k; i++) {
          const mid = ((i + 0.5) * len) / k;
          tryPart(part("box", oriented(a, u, nrm, mid - cw / 2, mid + cw / 2, 0, F.cage.depth.typical), [z0, z1], { what: `cage ${i + 1}`, embeds: true })); // prettier-ignore
        }
    }
    if (dropped.length) out.notes.push(`fusion of ${l.id}: ${dropped.join(", ")} left out`);
    modes.set(l.district, { mode, why, wealth: dd?.wealth ?? null, density: dd?.density ?? null });
    // nothing of its band stood (a connector's well through it, say): no form, only the note above
    if (!parts.length) continue;
    out.forms.push(instance({ id: `deck.fusion.${l.id}`, family: "deck", form: "F7", kind: "fusion", layer: L.id, build: "detail", frame: false, role: null, palette: l.district, on: l.frontage?.way ?? null, lot: l.id, mode, fused: mode !== "gap", band: [top, D.soffit], at: centroid([a, b]).map(r3), side, parts })); // prettier-ignore
  }
  for (const [d, m] of [...modes].sort((x, y) => x[0].localeCompare(y[0]))) out.notes.push(`fusion in ${d}: ${m.mode} (${m.why}${m.mode === "full" ? `, ${m.density}: cages by density` : ""})`); // prettier-ignore
}

// ── the deck's edge ──

const zMeet = (p, q) => Math.min(p[1], q[1]) - Math.max(p[0], q[0]);
/** Half-cell steps of an edge line (from a along u) between t0 and t1: [[s0, s1], ...]. */
function halfSteps(t0, t1) {
  const out = [];
  for (let t = t0; t < t1 - 1e-9; t += 0.5) out.push([t, Math.min(t + 0.5, t1)]);
  return out;
}
/** Merged runs of the steps that pass a test (consecutive steps of one key). */
function runsOf(steps, keyOf) {
  const runs = [];
  for (const [s0, s1] of steps) {
    const k = keyOf(s0, s1);
    if (k === null) continue;
    const last = runs[runs.length - 1];
    if (last && Math.abs(last.t1 - s0) < 1e-9 && last.key === k.key) (last.t1 = s1), last.over.push(...k.over);
    else runs.push({ t0: s0, t1: s1, key: k.key, over: [...k.over] });
  }
  return runs;
}

/**
 * Where the deck's edge bears on a wall (cells along the edge line from a, between t0 and t1): a step whose bracket
 * zone (forms.deckEdge.bracket: its depth in from the edge, its height under the soffit) is met by something the
 * stages before placed standing through that whole height to the soffit (a facade lot fused to the deck, a building,
 * a connector) is borne; the rest is free, overhanging, and wants its brackets (M7). { borne, free: [[t0, t1]] }.
 */
export function edgeBearing(fx, a, u, inward, t0, t1) {
  const D = fx.deck;
  const B = fx.R.deckEdge.bracket;
  const z = [D.soffit - B.height.typical, D.soffit];
  const runs = runsOf(halfSteps(t0, t1), (s0, s1) => {
    const zone = oriented(a, u, inward, s0, s1, 0, B.depth.typical);
    const wall = fx.solids.find((s) => s.z[0] <= z[0] + 1e-6 && s.z[1] >= z[1] - 1e-6 && polyOverlap(zone, s.poly) > 0.01);
    return { key: wall ? "borne" : "free", over: wall ? [wall.what] : [] };
  });
  const pick = (k) => runs.filter((r) => r.key === k).map((r) => [r.t0, r.t1]);
  return { borne: pick("borne"), free: pick("free") };
}

/**
 * The fascia of an edge bay (from a along u, proud along o, between t0 and t1) on half-cell runs: its typical band
 * over the deck's thickness, its bottom raised to the top of whatever the stages before placed stands past the edge
 * under it (a facade lot cut across the edge line), left out where that leaves nothing or it still enters something.
 * { runs: [{ t0, t1, z0 }], notes }.
 */
export function fasciaRuns(fx, a, u, o, t0, t1) {
  const D = fx.deck;
  const F = fx.R.deckEdge.fascia;
  const z = [D.top - F.height.typical, D.top];
  const notes = [];
  const runs = runsOf(halfSteps(t0, t1), (s0, s1) => {
    const poly = oriented(a, u, o, s0, s1, 0, F.depth.typical);
    const walls = fx.solids.filter((s) => zMeet(s.z, z) > 0.01 && polyOverlap(poly, s.poly) > 0.01);
    const z0 = Math.max(z[0], ...walls.map((s) => s.z[1]));
    const why = z0 >= D.top - 1e-6 ? `${walls.find((s) => s.z[1] >= D.top - 1e-6).what} stands to the deck's top` : partFaults(fx, part("box", poly, [z0, D.top]))[0];
    if (why) {
      notes.push(`fascia ${r3(s0)}-${r3(s1)} left out (${typeof why === "string" ? why : `${why.what} by ${why.by}`})`);
      return null;
    }
    return { key: r3(z0), over: walls.map((s) => s.what) };
  });
  for (const r of runs) if (r.key > z[0] + 1e-6) notes.push(`fascia ${r3(r.t0)}-${r3(r.t1)} rises to z ${r.key} over ${[...new Set(r.over)].join(", ")}`);
  return { runs: runs.map((r) => ({ t0: r.t0, t1: r.t1, z0: r.key })), notes };
}

/** An edge pier at t along the edge line (from a along u), set in from the edge: { pier } or { why }. */
function edgePierAt(fx, a, u, inward, t) {
  const D = fx.deck;
  const L = fx.layerOf(D.layer);
  const P = fx.R.pier;
  const c = add(add(a, u, t), inward, fx.R.deckEdge.pierSetback.typical);
  const w = P.width.typical;
  const poly = oriented(c, u, inward, -w / 2, w / 2, -w / 2, w / 2);
  const capH = P.capital.height.typical;
  const shaft = part("prism", poly, [L.floor, D.soffit - capH], { what: "edge pier", embeds: true });
  const cap = part("frustum", poly, [D.soffit - capH, D.soffit], { what: "edge pier's capital", top: growPoly(poly, P.capital.flare.typical), embeds: true }); // prettier-ignore
  const fl = [shaft, cap].flatMap((pt) => partFaults(fx, pt, { layers: [L.id] }));
  const land = landingOf(fx, L.id, poly);
  if (!fl.length && land.kind !== "blocked" && land.kind !== "hall") return { pier: { shaft, cap, at: c, land, t } };
  return { why: fl[0] ? `${fl[0].what} by ${fl[0].by}` : `it does not land (${land.what ?? land.kind})` };
}

/**
 * The edge piers of a side's bays in the tile: each at its bay's middle, sliding like a station (DELTAS, at most 2
 * cells); where those leave two piers more than forms.pier.maxPitchPastObstacle apart (M7: a wide way crossing the
 * edge at a bay's middle, a ramp's mouth beside it), the side's piers are chosen together from every place in their
 * bays on the quarter-cell grid: fewest gaps past it, then fewest bays without a pier, then nearest their middles.
 * [{ pier, why }] a bay, with `moved` naming the bays slid further.
 */
export function edgePiers(fx, a, u, inward, n, bl) {
  const P = fx.R.pier;
  const max = P.maxPitchPastObstacle;
  const w = P.width.typical;
  const bays = [];
  for (let k = 0; k < n; k++) {
    const mid = k * bl + bl / 2;
    const at0 = edgePierAt(fx, a, u, inward, mid);
    let first = null;
    for (const d of DELTAS) {
      const got = d === 0 ? at0 : edgePierAt(fx, a, u, inward, mid + d);
      if (got.pier) {
        first = got.pier;
        break;
      }
    }
    bays.push({ mid, first, why: at0.why ?? null });
  }
  const ts = bays.filter((b) => b.first).map((b) => b.first.t);
  const old = bays.map((b) => ({ pier: b.first, why: b.why }));
  if (ts.every((t, i) => i === 0 || t - ts[i - 1] <= max + 1e-6)) return old;
  // every place in each bay, nearest its middle first (+ before - as DELTAS)
  for (const b of bays) {
    b.cands = [];
    const half = bl / 2 - w / 2;
    const ds = [0];
    for (let m = 0.25; m <= half + 1e-9; m += 0.25) ds.push(m, -m);
    ds.forEach((d, i) => {
      const got = Math.abs(d) <= 2 + 1e-9 && b.first && Math.abs(b.first.t - b.mid - d) < 1e-9 ? { pier: b.first } : edgePierAt(fx, a, u, inward, b.mid + d);
      if (got.pier) b.cands.push({ pier: got.pier, d: Math.abs(d), i });
    });
  }
  // chosen together: a state is a bay's candidate, the cost [gaps past max, bays without a pier, sum of slides, order]
  const less = (x, y) => { for (let i = 0; i < x.length; i++) if (Math.abs(x[i] - y[i]) > 1e-9) return x[i] < y[i]; return false; }; // prettier-ignore
  const add4 = (x, y) => x.map((v, i) => v + y[i]);
  const best = bays.map((b) => b.cands.map(() => null));
  for (let k = 0; k < n; k++)
    bays[k].cands.forEach((c, j) => {
      const own = [0, 0, c.d, c.i];
      let pick = { cost: add4([0, k, 0, 0], own), prev: null };
      for (let k0 = 0; k0 < k; k0++)
        bays[k0].cands.forEach((c0, j0) => {
          const b0 = best[k0][j0];
          const cost = add4(b0.cost, add4([c.pier.t - c0.pier.t > max + 1e-6 ? 1 : 0, k - k0 - 1, 0, 0], own));
          if (less(cost, pick.cost)) pick = { cost, prev: [k0, j0] };
        });
      best[k][j] = pick;
    });
  let end = null;
  for (let k = 0; k < n; k++) bays[k].cands.forEach((_, j) => { const cost = add4(best[k][j].cost, [0, n - 1 - k, 0, 0]); if (!end || less(cost, end.cost)) end = { cost, at: [k, j] }; }); // prettier-ignore
  if (!end) return old;
  const out = bays.map((b) => ({ pier: null, why: b.why }));
  for (let at = end.at; at; at = best[at[0]][at[1]].prev) out[at[0]].pier = bays[at[0]].cands[at[1]].pier;
  out.moved = out.map((x, k) => (x.pier && Math.abs(x.pier.t - bays[k].mid) > 2 + 1e-9 ? `bay ${k} by ${r3(x.pier.t - bays[k].mid)}` : null)).filter(Boolean).join(", "); // prettier-ignore
  return out;
}

function deckEdge(fx, out) {
  const D = fx.deck;
  const L = fx.layerOf(D.layer);
  const U = fx.layerOf(D.over);
  const E = fx.R.deckEdge;
  const P = fx.R.pier;
  const tb = fx.tile.box;
  const db = D.box;
  const sides = {
    s: { a: [db[0], db[1]], b: [db[2], db[1]], o: [0, -1] },
    n: { a: [db[0], db[3]], b: [db[2], db[3]], o: [0, 1] },
    w: { a: [db[0], db[1]], b: [db[0], db[3]], o: [-1, 0] },
    e: { a: [db[2], db[1]], b: [db[2], db[3]], o: [1, 0] },
  };
  const parH = Math.ceil(fx.rules.dimensions.parapets.height.min / 0.0254) / fx.cu;
  const parT = Math.max(0.0625, Math.ceil((fx.rules.dimensions.parapets.thickness.min / fx.cell) * 16) / 16);
  for (const [side, S] of Object.entries(sides)) {
    const line = clipPolyline([S.a, S.b], tb)[0];
    if (!line || dist(line[0], line[line.length - 1]) < 1) continue;
    const [a, b] = [line[0], line[line.length - 1]];
    const len = dist(a, b);
    const u = unit(a, b);
    const inward = [-S.o[0], -S.o[1]];
    const n = Math.max(1, Math.ceil(len / E.bay.max - 1e-9));
    const bl = len / n;
    const edgeP = edgePiers(fx, a, u, inward, n, bl);
    if (edgeP.moved) out.notes.push(`deck edge ${side}: edge piers slid past 2 cells in their bays (${edgeP.moved}) so they stand at most ${P.maxPitchPastObstacle} apart (M7)`); // prettier-ignore
    for (let k = 0; k < n; k++) {
      const t0 = k * bl;
      const parts = [];
      // the fascia, on half-cell runs: where a wall stands past the edge (a facade lot cut across the edge line, its
      // rock up to the soffit) its bottom rises to the wall's top, the wall closing the band under it
      const fas = fasciaRuns(fx, a, u, S.o, t0, t0 + bl);
      for (const r of fas.runs) parts.push(part("box", oriented(a, u, S.o, r.t0, r.t1, 0, E.fascia.depth.typical), [r.z0, D.top], { what: "fascia" })); // prettier-ignore
      for (const n of fas.notes) out.notes.push(`deck edge ${side} bay ${k}: ${n}`);
      // the brackets along the stretches the edge overhangs: where it bears on a wall standing to the soffit (a facade
      // fused to the deck, F7) there is no cantilever to carry and a bracket would stand in the wall's rock
      const bw = E.bracket.width.typical;
      const free = edgeBearing(fx, a, u, inward, t0, t0 + bl).free.filter(([x, y]) => y - x >= bw - 1e-9);
      let nbs = free.map(([x, y]) => Math.max(Math.ceil((y - x) / E.bracket.every.typical - 1e-9), Math.ceil((y - x) / E.bracket.every.max - 1e-9))); // prettier-ignore
      const room = (fx.R.maxBrushesBy?.["deck-edge"] ?? 9) - parts.length - 2; // the edge pier's two
      if (nbs.reduce((s, x) => s + x, 0) > room) nbs = free.map(([x, y]) => Math.ceil((y - x) / E.bracket.every.max - 1e-9));
      let bi = 0;
      free.forEach(([x, y], j) => {
        for (let i = 0; i < nbs[j]; i++) {
          bi++;
          const t = x + ((i + 0.5) * (y - x)) / nbs[j];
          const poly = oriented(a, u, inward, t - bw / 2, t + bw / 2, 0, E.bracket.depth.typical);
          const pt = part("wedge", poly, [D.soffit - E.bracket.height.typical, D.soffit], { what: `bracket ${bi}`, edge: [add(add(a, u, t - bw / 2), inward, 0), add(add(a, u, t + bw / 2), inward, 0)] }); // prettier-ignore
          const fl = partFaults(fx, pt, { layers: [L.id] });
          if (!fl.length) parts.push(pt);
          else out.notes.push(`deck edge ${side} bay ${k}: bracket ${bi} left out (${fl[0].what})`);
        }
      });
      // the edge pier, set in from the edge (chosen with the side's others: edgePiers)
      const { pier, why } = edgeP[k];
      if (pier) parts.push(pier.shaft, pier.cap);
      else out.notes.push(`deck edge ${side} bay ${k}: no edge pier (${why})`);
      out.forms.push(instance({ id: `deck.edge.${side}.${k}`, family: "deck", form: "F8", kind: "deck-edge", layer: L.id, build: "detail", frame: true, role: L.frame, on: `${side} edge`, side, bay: k, t: [r3(t0), r3(t0 + bl)], at: add(a, u, t0 + bl / 2).map(r3), pier: pier ? { at: pier.at.map(r3), landing: pier.land } : null, brackets: parts.filter((p) => /^bracket/.test(p.what ?? "")).length, fasciaHeight: fas.runs.length ? r3(Math.min(...fas.runs.map((r) => D.top - r.z0))) : 0, parts })); // prettier-ignore
      // the upper layer's parapet: runs a cell long where the upper floor reaches the edge, merged
      const runs = [];
      for (let t = t0; t < t0 + bl - 1e-9; t += 0.5) {
        const inside = add(add(a, u, t + 0.25), inward, 0.25);
        const ok = !!floorAt(fx, U.id, inside);
        const last = runs[runs.length - 1];
        if (ok && last && Math.abs(last[1] - t) < 1e-9) last[1] = t + 0.5;
        else if (ok) runs.push([t, Math.min(t + 0.5, t0 + bl)]);
      }
      const pparts = [];
      for (const [r0, r1] of runs) {
        const pt = part("box", oriented(a, u, inward, r0, r1, 0, parT), [U.floor, U.floor + parH], { what: "parapet" });
        const fl = partFaults(fx, pt, { layers: [U.id] });
        if (fl.length) out.notes.push(`deck edge ${side} bay ${k}: parapet ${r3(r0)}-${r3(r1)} left out (${fl[0].what})`);
        else pparts.push(pt);
      }
      if (pparts.length) out.forms.push(instance({ id: `deck.parapet.${side}.${k}`, family: "deck", form: "F8", kind: "parapet", layer: U.id, build: "detail", frame: true, role: U.frame, on: `${side} edge`, side, bay: k, at: add(a, u, t0 + bl / 2).map(r3), height: r3(parH), parts: pparts })); // prettier-ignore
    }
  }
}

// ── oculi ──

function oculi(fx, out) {
  const D = fx.deck;
  const L = fx.layerOf(D.layer);
  const U = fx.layerOf(D.over);
  const O = fx.R.oculus;
  const parH = Math.ceil(fx.rules.dimensions.parapets.height.min / 0.0254) / fx.cu;
  const parT = Math.max(0.0625, Math.ceil((fx.rules.dimensions.parapets.thickness.min / fx.cell) * 16) / 16);
  const sizes = [[4, 4], [4, 2], [2, 4]].filter(([w, d]) => Math.min(w, d) >= O.size.min - 1e-9 && Math.max(w, d) <= O.size.max + 1e-9); // prettier-ignore
  const plazas = fx.site.plazas.filter((q) => q.layer === L.id && inBox(centroid(boxPoly(q.box)), fx.tile.box) && inBox([q.box[0], q.box[1]], D.box) && inBox([q.box[2], q.box[3]], D.box)); // prettier-ignore
  const guards = O.guards ?? ["parapet", "grate"];
  for (const q of plazas) {
    const b = q.box;
    const ctr = centroid(boxPoly(b));
    let got = null;
    const tried = [];
    for (const guard of guards) {
      for (const [w, d] of sizes) {
        const cands = [];
        for (let x = b[0] + O.inset.min; x + w <= b[2] - O.inset.min + 1e-9; x += 0.5)
          for (let y = b[1] + O.inset.min; y + d <= b[3] - O.inset.min + 1e-9; y += 0.5) cands.push([x, y, x + w, y + d]);
        cands.sort((p, r) => dist(centroid(boxPoly(p)), ctr) - dist(centroid(boxPoly(r)), ctr) || p[0] - r[0] || p[1] - r[1]);
        for (const h of cands) {
          const why = oculusFault(fx, h, guard, { parH, parT });
          if (!why.fault) {
            got = { h, guard, parts: why.parts, opensOn: why.opensOn };
            break;
          }
          if (tried.length < 3) tried.push(`${guard} ${w}x${d}: ${why.fault}`);
        }
        if (got) break;
      }
      if (got) break;
    }
    if (!got) {
      out.notes.push(`plaza ${q.id}: no oculus (${tried.join("; ")})`);
      continue;
    }
    out.forms.push(instance({ id: `deck.oculus.${q.id}`, family: "deck", form: "F9", kind: "oculus", layer: U.id, build: "detail", frame: true, role: U.frame, on: q.id, opensOn: got.opensOn, guard: got.guard, hole: got.h.map(r3), at: centroid(boxPoly(got.h)).map(r3), parts: got.parts })); // prettier-ignore
  }
}

/** Whether an oculus `h` (box, cells) with its guard may open: { fault } or { parts, opensOn }. */
function oculusFault(fx, h, guard, { parH, parT }) {
  const D = fx.deck;
  const U = fx.layerOf(D.over);
  const owners = new Set();
  for (let x = h[0] + 0.125; x < h[2]; x += 0.25)
    for (let y = h[1] + 0.125; y < h[3]; y += 0.25) {
      const o = floorAt(fx, U.id, [x, y]);
      if (!o) return { fault: `[${r3(x)}, ${r3(y)}] is not ${U.id}'s public floor` };
      const roof = underPortico(fx, U.id, [x, y]);
      if (roof) return { fault: `[${r3(x)}, ${r3(y)}] is under ${roof}` };
      owners.add(o.id);
    }
  const cut = part("box", boxPoly(h), [D.soffit, D.top], { what: "opening", build: "cut", rock: 8 });
  const cf = partFaults(fx, cut, { layers: [] });
  if (cf.length) return { fault: `the opening enters ${cf[0].what}` };
  // nothing of the upper layer over the hole (a parapet's) or on the grate (props, monuments, pieces)
  const over = part("box", boxPoly(h), [U.floor, U.floor + HULL_HEAD], { what: "over" });
  const of = partFaults(fx, over, { layers: guard === "parapet" ? [U.id] : [] });
  if (of.length) return { fault: `${of[0].what} over it` };
  const parts = [cut];
  if (guard === "parapet") {
    const ring = [
      [h[0] - parT, h[1] - parT, h[2] + parT, h[1]],
      [h[0] - parT, h[3], h[2] + parT, h[3] + parT],
      [h[0] - parT, h[1], h[0], h[3]],
      [h[2], h[1], h[2] + parT, h[3]],
    ];
    for (const r of ring) {
      const pt = part("box", boxPoly(r), [U.floor, U.floor + parH], { what: "parapet" });
      const fl = partFaults(fx, pt, { layers: [U.id] });
      if (fl.length) return { fault: `its parapet enters ${fl[0].what}` };
      parts.push(pt);
    }
    // the walk round it
    const inst = instance({ id: "probe", parts });
    if (walkBreaks(fx, U.id, [inst]).length) return { fault: "its parapet cuts a walk" };
  } else parts.push(part("box", boxPoly(h), [D.top - 0.0625, D.top], { what: "grate", build: "entity", entity: "func_wall", texture: "{grate" })); // prettier-ignore
  return { parts, opensOn: [...owners].sort() };
}

// ── cores ──

function cores(fx, out) {
  const nexus = fx.desc.rules?.msr?.nexus ?? fx.desc.msr?.nexus;
  if (!nexus) return;
  const conns = fx.net.connectors.filter((c) => c.stops.includes(nexus) && c.stops.length >= 3 && (c.pieces ?? []).some((p) => p.kind === "well" || p.kind === "shaft")); // prettier-ignore
  if (!conns.length) return;
  const polys = conns.flatMap((c) => c.pieces.filter((p) => p.kind === "well" || p.kind === "shaft").map((p) => p.poly));
  const bb = polyBox(polys.flat());
  const K = fx.R.core;
  const ctr = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
  const rad = Math.hypot(bb[2] - bb[0], bb[3] - bb[1]) / 2 + K.wall.typical;
  const N = K.sides;
  const ring = [...Array(N).keys()].map((i) => add(ctr, [Math.cos(((i + 0.5) * 2 * Math.PI) / N), Math.sin(((i + 0.5) * 2 * Math.PI) / N)], rad)); // prettier-ignore
  const max = fx.R.maxBrushesBy?.core ?? 16;
  for (const Ly of fx.layers) {
    const lid = Ly.id;
    const lid2 = fx.deck && lid === fx.deck.layer ? fx.deck.soffit : Ly.ceiling === "sky" ? Ly.top : Ly.top;
    const parts = [];
    for (let i = 0; i < N && parts.length < max; i++) {
      const [a, b] = [ring[i], ring[(i + 1) % N]];
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (!floorAt(fx, lid, add(m, unit(ctr, m), 0.25))) continue;
      const u = unit(a, b);
      const inw = unit(m, ctr);
      const wall = part("box", oriented(a, u, inw, 0, dist(a, b), 0, K.wall.typical), [Ly.floor, lid2], { what: `drum side ${i}` });
      const rib = part("box", oriented(a, u, [-inw[0], -inw[1]], -K.rib.width.typical / 2, K.rib.width.typical / 2, 0, K.rib.depth.typical), [Ly.floor, lid2], { what: `rib ${i}` }); // prettier-ignore
      for (const pt of [wall, rib]) {
        if (parts.length >= max) break;
        if (!partFaults(fx, pt, { layers: [lid], ignore: (s) => conns.some((c) => c.id === s.id) }).length) parts.push(pt);
      }
    }
    if (parts.length) out.forms.push(instance({ id: `deck.core.${nexus}.${lid}`, family: "deck", form: "F26", kind: "core", layer: lid, build: "detail", frame: true, role: Ly.frame, on: nexus, around: conns.map((c) => c.id), at: ctr.map(r3), radius: r3(rad), parts })); // prettier-ignore
  }
  out.notes.push(`core of ${nexus}: a ${N}-sided drum of ${r3(rad)} cells round ${conns.map((c) => c.id).join(", ")}; ${out.forms.filter((f) => f.kind === "core").map((f) => `${f.layer} ${f.parts.length} brushes`).join(", ") || "no side of it stands on public floor in the tile (inside buildings and rock the carve is the drum)"}`); // prettier-ignore
}

// ── the walk: a standing form that cuts it goes, its girder, truss and services with it ──

/** A nave's pier taken out from under its girder: the girder's end on a corbel in the wall instead. True when done. */
function corbelInstead(fx, out, pier) {
  if (pier.kind !== "pier" || pier.onKind !== "way") return false;
  const rib = out.forms.find((f) => f.kind === "rib" && (f.bears ?? []).includes(pier.id));
  if (!rib || rib.parts.some((p) => p.what === "haunch")) return false;
  const L = fx.layerOf(pier.layer);
  const beam = rib.parts[0].poly;
  const u = unit(beam[0], beam[1]);
  const nL = unit(beam[1], beam[2]);
  const half = dist(beam[1], beam[2]) / 2;
  const tR = dist(beam[0], beam[1]);
  const sg = pier.side === "l" ? 1 : -1;
  const sv = [nL[0] * sg, nL[1] * sg];
  if (floorAt(fx, L.id, add(add(rib.at, sv, half), sv, 0.25))) return false;
  const corbel = part("box", oriented(rib.at, u, sv, -tR / 2, tR / 2, half - 0.25, half), [rib.soffit - 0.5, rib.soffit], { what: "corbel", embeds: true }); // prettier-ignore
  if (partFaults(fx, corbel, { layers: [L.id] }).length) return false;
  const gone = new Set([pier.id, ...out.forms.filter((f) => f.carries === pier.id).map((f) => f.id)]);
  out.forms = out.forms.filter((f) => !gone.has(f.id));
  const i = out.forms.indexOf(rib);
  out.forms[i] = instance({ ...rib, bears: rib.bears.filter((b) => b !== pier.id), bearsOnWall: [...(rib.bearsOnWall ?? []), pier.side], parts: [...rib.parts, corbel] }); // prettier-ignore
  return true;
}

function keepWalks(fx, out) {
  for (const L of fx.layers) {
    for (let guard = 0; guard < 60; guard++) {
      const standing = out.forms.filter((f) => f.parts.some((p) => p.build !== "cut" && p.build !== "entity" && p.z[0] < L.floor + HULL_HEAD && p.z[1] > L.floor + 0.14)); // prettier-ignore
      if (!standing.length) break;
      const br = walkBreaks(fx, L.id, standing);
      if (!br.length) break;
      const mid = [(br[0].a.p[0] + br[0].b.p[0]) / 2 / fx.cell, (br[0].a.p[1] + br[0].b.p[1]) / 2 / fx.cell];
      const victim = standing.reduce((m, f) => (dist(f.at, mid) < dist(m.at, mid) ? f : m), standing[0]);
      // a nave's pier: its girder keeps that end on a corbel in the wall behind it (a lane too narrow for its piers
      // and the walk both), the girder and its services stay
      if (corbelInstead(fx, out, victim)) {
        out.notes.push(`walk on ${L.id}: ${victim.id} taken out, its girder's end on a corbel in its wall (${br[0].a.what} and ${br[0].b.what} were cut apart)`); // prettier-ignore
        continue;
      }
      const gone = new Set([victim.id]);
      for (const f of out.forms) if ((f.bears ?? []).includes(victim.id) || f.carries === victim.id) gone.add(f.id);
      for (const f of out.forms) if ((f.hungFrom ?? []).some((r) => gone.has(r))) gone.add(f.id);
      out.forms = out.forms.filter((f) => !gone.has(f.id));
      out.notes.push(`walk on ${L.id}: ${[...gone].join(", ")} taken out (${br[0].a.what} and ${br[0].b.what} were cut apart)`);
    }
  }
}

// ── the family ──

function place(fx) {
  const out = { forms: [], failures: [], notes: [] };
  if (!fx.deck) {
    out.notes.push("no deck in the tile: the deck family places nothing");
    return out;
  }
  naves(fx, out);
  plazaFrames(fx, out);
  fusion(fx, out);
  deckEdge(fx, out);
  oculi(fx, out);
  cores(fx, out);
  keepWalks(fx, out);
  return out;
}

// ── its checks (the gate runs them again on the artifact's forms) ──

function check(forms, fx) {
  const failures = [];
  const notes = [];
  if (!fx.deck) return { failures, notes };
  const D = fx.deck;
  const L = fx.layerOf(D.layer);
  const P = fx.R.pier;
  const G = fx.R.girder;
  const byId = new Map(forms.map((f) => [f.id, f]));
  const piers = forms.filter((f) => f.kind === "pier");
  // M1: pier pitch along each leg and plaza edge, each side
  const runs = new Map();
  for (const p of piers) {
    const key = p.onKind === "way" ? `${p.on} leg ${p.leg} ${p.side === "l" ? "left" : "right"}` : `${p.on} ${p.edge} edge`;
    (runs.get(key) ?? runs.set(key, []).get(key)).push(p.t);
  }
  const gaps = [];
  for (const [key, ts] of runs) {
    ts.sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i++) {
      const g = ts[i] - ts[i - 1];
      gaps.push(g);
      if (g > P.maxPitchPastObstacle + 1e-6) failures.push(`M1: piers along ${key} stand ${r3(g)} cells apart (at ${r3(ts[i - 1])} and ${r3(ts[i])}), at most ${P.pitch.max} (${P.maxPitchPastObstacle} past an obstacle)`); // prettier-ignore
      else if (g > P.pitch.max + 1e-6) notes.push(`M1: piers along ${key} ${r3(g)} cells apart, past the pitch ${P.pitch.max} where a pier gave way (at most ${P.maxPitchPastObstacle})`); // prettier-ignore
    }
  }
  // M2: girders
  for (const r of forms.filter((f) => f.kind === "rib")) {
    const want = r.span * G.minDepthPerSpan * (fx.rules.scale?.ceiling ?? 1.5);
    if (r.depth < want - 1e-6) failures.push(`M2: girder ${r.id} is ${r.depth} cells deep over a ${r.span}-cell span, at least ${r3(want)} (span/12 in game height)`); // prettier-ignore
    if (r.soffit < r.clearanceTop + G.clearanceOver.min - 1e-6) failures.push(`M2: girder ${r.id}'s soffit at z ${r.soffit} is under ${r.on}'s clearance (z ${r.clearanceTop}) plus ${G.clearanceOver.min}`); // prettier-ignore
    const beam = r.parts[0];
    if (Math.abs(beam.z[1] - D.soffit) > 1e-6) failures.push(`M2: girder ${r.id}'s top at z ${beam.z[1]}, not the deck's soffit ${D.soffit}`);
    for (const b of r.bears ?? []) if (!byId.has(b)) failures.push(`F3: girder ${r.id} bears on ${b}, which is not placed`);
  }
  // M3: pier width
  for (const p of piers) {
    const want = Math.max(P.width.min, (p.capTop - fx.layerOf(p.layer).floor) / P.maxSlenderness);
    if (p.width < want - 1e-6) failures.push(`M3: pier ${p.id} is ${p.width} cells wide, at least ${r3(want)} (forms.pier.width.min, clear height / ${P.maxSlenderness})`); // prettier-ignore
  }
  // M4: every pier lands
  for (const p of [...piers, ...forms.filter((f) => f.kind === "deck-edge" && f.pier)]) {
    const poly = p.kind === "pier" ? p.parts[0].poly : p.parts.find((x) => x.what === "edge pier")?.poly;
    if (!poly) continue;
    const land = landingOf(fx, p.layer, poly);
    if (land.kind === "blocked") failures.push(`M4: ${p.kind === "pier" ? "pier" : "edge pier of"} ${p.id} does not land: over ${land.what}`);
    else if (land.kind === "hall" && !forms.some((f) => f.kind === "pier-foot" && f.carries === p.id && dist(f.at, centroid(poly)) <= fx.R.pierFoot.landing.max + 1e-6)) failures.push(`M4: pier ${p.id} stands over ${land.plaza} with no foot under it within ${fx.R.pierFoot.landing.max} cells`); // prettier-ignore
  }
  // F5: trusses
  for (const t of forms.filter((f) => f.kind === "truss")) {
    if (t.depth < t.span * fx.R.truss.minDepthPerSpan - 1e-6) failures.push(`F5: truss ${t.id} is ${t.depth} cells deep over ${t.span}, at least ${r3(t.span * fx.R.truss.minDepthPerSpan)} (span/10)`); // prettier-ignore
    for (const b of t.bears ?? []) if (!byId.has(b)) failures.push(`F5: truss ${t.id} bears on ${b}, which is not placed`);
  }
  // M5: the frame along every under-deck public way
  const box = boxMeet(fx.tile.box, D.box);
  const frame = forms.filter((f) => ["pier", "rib", "truss"].includes(f.kind));
  const reach = fx.R.frameCover.every.max / 2;
  const cover = [];
  for (const w of fx.site.ways.filter((x) => x.layer === L.id && x.class !== "service" && x.class !== "canal" && x.access === "public")) {
    let n = 0;
    let hit = 0;
    for (const pts of w.parts)
      for (const line of clipPolyline(pts, box))
        for (let i = 1; i < line.length; i++) {
          const [a, b] = [line[i - 1], line[i]];
          const len = dist(a, b);
          const u = unit(a, b);
          for (let t = 0.25; t < len; t += 0.5) {
            const p = add(a, u, t);
            n++;
            if (frame.some((f) => dist(f.at, p) <= reach + w.width / 2 + 1e-6)) hit++;
          }
        }
    if (n < 4) continue;
    const share = hit / n;
    cover.push({ way: w.id, cells: n / 2, share: r3(share) });
    if (share < fx.R.frameCover.minShare - 1e-9) failures.push(`M5: ${w.id} under the deck has a pier, girder or truss within ${reach} cells on ${Math.round(share * 1000) / 10} % of its ${n / 2} cells in the tile, at least ${fx.R.frameCover.minShare * 100} %`); // prettier-ignore
  }
  if (cover.length) notes.push(`M5: frame along the ways under the deck: ${cover.map((c) => `${c.way} ${Math.round(c.share * 100)} % of ${c.cells}`).join(", ")}`); // prettier-ignore
  // M6: two scales
  const fronts = fx.lots.lots.filter((l) => l.kind === "facade" && l.layer === L.id && l.tile === fx.tile.id && inBox([l.rect.x + l.rect.w / 2, l.rect.y + l.rect.d / 2], D.box)).map((l) => (["n", "s"].includes(l.frontage?.side) ? l.rect.w : l.rect.d)).sort((a, b) => a - b); // prettier-ignore
  const wayGaps = [];
  for (const [key, ts] of runs) if (/ leg /.test(key)) for (let i = 1; i < ts.length; i++) wayGaps.push(ts[i] - ts[i - 1]);
  wayGaps.sort((a, b) => a - b);
  if (fronts.length && wayGaps.length) {
    const bay = wayGaps[Math.floor(wayGaps.length / 2)];
    const front = fronts[Math.floor(fronts.length / 2)];
    const want = fx.R.twoScales.minBayPerFrontage * front;
    if (bay < want - 1e-6) failures.push(`M6: the frame's bay under the deck is ${r3(bay)} cells at the median, at least ${fx.R.twoScales.minBayPerFrontage} x the median facade frontage ${front} = ${r3(want)} (two scales)`); // prettier-ignore
    else notes.push(`M6: bay ${r3(bay)} cells at the median against facade frontage ${front} (at least x${fx.R.twoScales.minBayPerFrontage})`);
  } else notes.push("M6: too few bays or facades under the deck in the tile to measure two scales");
  // M7: the deck's edge
  const E = fx.R.deckEdge;
  const edges = forms.filter((f) => f.kind === "deck-edge");
  for (const e of edges) {
    if (e.fasciaHeight < E.fascia.height.min - 1e-6) failures.push(`M7: ${e.id}'s fascia is ${e.fasciaHeight} cells high, at least ${E.fascia.height.min}`);
    // the bay's overhang: its length less the stretches where the edge bears on a wall standing to the soffit
    const ns = e.side === "s" || e.side === "n";
    const a0 = ns ? [Math.max(D.box[0], fx.tile.box[0]), e.side === "s" ? D.box[1] : D.box[3]] : [e.side === "w" ? D.box[0] : D.box[2], Math.max(D.box[1], fx.tile.box[1])]; // prettier-ignore
    const inw = { s: [0, 1], n: [0, -1], w: [1, 0], e: [-1, 0] }[e.side];
    const free = edgeBearing(fx, a0, ns ? [1, 0] : [0, 1], inw, e.t[0], e.t[1]).free.filter(([x, y]) => y - x >= E.bracket.width.typical - 1e-9);
    const bl = free.reduce((s, [x, y]) => s + y - x, 0);
    const borne = e.t[1] - e.t[0] - bl;
    if (e.brackets < Math.ceil(bl / E.bracket.every.max - 1e-9)) failures.push(`M7: ${e.id} has ${e.brackets} brackets over ${r3(bl)} cells${borne > 1e-6 ? ` (of its ${r3(e.t[1] - e.t[0])}, ${r3(borne)} borne on walls)` : ""}, one every ${E.bracket.every.max} at most`); // prettier-ignore
  }
  const edgeRuns = new Map();
  for (const e of edges) if (e.pier) (edgeRuns.get(e.side) ?? edgeRuns.set(e.side, []).get(e.side)).push(e.side === "s" || e.side === "n" ? e.pier.at[0] : e.pier.at[1]); // prettier-ignore
  for (const side of new Set(edges.map((e) => e.side))) {
    const ts = (edgeRuns.get(side) ?? []).sort((a, b) => a - b);
    if (!ts.length) failures.push(`M7: the deck's ${side} edge in the tile has no edge pier`);
    for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > P.maxPitchPastObstacle + 1e-6) failures.push(`M7: edge piers on the deck's ${side} edge ${r3(ts[i] - ts[i - 1])} cells apart, at most ${P.maxPitchPastObstacle}`); // prettier-ignore
  }
  // the parapet wherever the upper floor reaches the edge
  const U = fx.layerOf(D.over);
  const parapets = forms.filter((f) => f.kind === "parapet");
  for (const e of edges) {
    const sides = { s: [[D.box[0], D.box[1]], [1, 0], [0, 1]], n: [[D.box[0], D.box[3]], [1, 0], [0, -1]], w: [[D.box[0], D.box[1]], [0, 1], [1, 0]], e: [[D.box[2], D.box[1]], [0, 1], [-1, 0]] }; // prettier-ignore
    const [a0, u, inw] = sides[e.side];
    for (let t = e.t[0]; t < e.t[1] - 1e-9; t += 0.5) {
      const base = e.side === "s" || e.side === "n" ? [Math.max(D.box[0], fx.tile.box[0]) + t, a0[1]] : [a0[0], Math.max(D.box[1], fx.tile.box[1]) + t];
      void u;
      const inside = add(add(base, e.side === "s" || e.side === "n" ? [1, 0] : [0, 1], 0.25), inw, 0.25);
      if (!floorAt(fx, U.id, inside)) continue;
      const covered = parapets.some((p) => p.side === e.side && p.parts.some((pt) => { const bb = polyBox(pt.poly); return inside[0] >= bb[0] - 0.3 && inside[0] <= bb[2] + 0.3 && inside[1] >= bb[1] - 0.3 && inside[1] <= bb[3] + 0.3; })); // prettier-ignore
      if (!covered) {
        failures.push(`M7: ${U.id}'s floor reaches the deck's ${e.side} edge at [${inside.map(say)}] with no parapet (dimensions.parapets)`);
        break;
      }
    }
  }
  // M16: oculi
  const O = fx.R.oculus;
  const ocs = forms.filter((f) => f.kind === "oculus");
  const under = fx.site.plazas.filter((q) => q.layer === L.id && inBox(centroid(boxPoly(q.box)), fx.tile.box) && inBox([q.box[0], q.box[1]], D.box) && inBox([q.box[2], q.box[3]], D.box)); // prettier-ignore
  for (const q of under) {
    const near = ocs.some((o) => boxDist(q.box, o.hole) <= O.reach.max + 1e-6);
    const edgeD = Math.min(q.box[0] - D.box[0], q.box[1] - D.box[1], D.box[2] - q.box[2], D.box[3] - q.box[3]);
    if (!near && edgeD > O.reach.max + 1e-6) failures.push(`M16: under-deck plaza ${q.id} has no oculus and no deck-edge view within ${O.reach.max} cells (the edge ${r3(edgeD)} away)`); // prettier-ignore
  }
  for (const o of ocs) {
    const ring = o.parts.filter((p) => p.what === "parapet").length;
    const grate = o.parts.some((p) => p.what === "grate" && p.build === "entity");
    if (!(ring === 4 || grate)) failures.push(`M16: oculus ${o.id} is not guarded (a parapet ring of 4 or a grate), it has ${ring} parapet sides`);
  }
  // the other tiles' under-deck plazas, as `under` takes this tile's (the box inside the deck: a plaza across the deck's
  // edge gets no oculus), each with at most one
  const boxOfNode = (nd) => [nd.at[0] - nd.size[0] / 2, nd.at[1] - nd.size[1] / 2, nd.at[0] + nd.size[0] / 2, nd.at[1] + nd.size[1] / 2];
  const elsewhere = (fx.desc.streets?.nodes ?? []).filter((nd) => nd.kind === "plaza" && nd.layer === L.id && nd.size && inBox(boxOfNode(nd).slice(0, 2), D.box) && inBox(boxOfNode(nd).slice(2), D.box) && !inBox(nd.at, fx.tile.box)).length; // prettier-ignore
  if (ocs.length + elsewhere > O.maxPerCity) failures.push(`M16: ${ocs.length} oculi in the tile and up to ${elsewhere} over the other under-deck plazas make ${ocs.length + elsewhere}, at most ${O.maxPerCity} in the city`); // prettier-ignore
  else notes.push(`M16: ${ocs.length} oculi in the tile (${ocs.map((o) => `${o.on} ${o.guard}`).join(", ") || "none"}); at most ${ocs.length + elsewhere} in the city with one over each other under-deck plaza, of ${O.maxPerCity}`); // prettier-ignore
  return { failures, notes };
}

/**
 * The naves' rhythm across the tiles' seams, checked once a way over every tile's stage 9 (the forms of each tile's
 * 09-forms.json, its own piers only; forms.pier, its note): for each way's leg and side, the piers of all the tiles
 * stitched in order. Fails (sentences): a station given by two tiles (crowding at the seam); a pier off its place in
 * the rhythm past forms.pier.slide.max; tiles framing one leg on different rhythms (its length or its bays), or on
 * their own tile's rhythm where the way's whole line was not known; two piers of a side from different tiles more
 * than forms.pier.maxPitchPastObstacle apart (a gap at the seam). M1 holds each tile's own gaps.
 * `tiles`: [{ tile, forms }]; `R`: the rules in cells (forms.mjs formRules). { failures, notes, ways }.
 */
export function seamRhythm(tiles, R) {
  const P = R.pier;
  const failures = [];
  const notes = [];
  const runs = new Map();
  for (const { tile, forms } of tiles)
    for (const p of forms ?? []) {
      if (p.kind !== "pier" || p.onKind !== "way") continue;
      const key = `${p.on} leg ${p.leg} ${p.side === "l" ? "left" : "right"}`;
      (runs.get(key) ?? runs.set(key, []).get(key)).push({ tile, p });
    }
  let seams = 0;
  for (const [key, list] of [...runs].sort((x, y) => x[0].localeCompare(y[0]))) {
    const tilesOn = new Set(list.map((x) => x.tile));
    if (tilesOn.size < 2) continue;
    seams++;
    const legs = new Set(list.map((x) => `${x.p.legLength}|${x.p.bays}`));
    if (list.some((x) => x.p.rhythm !== "whole")) failures.push(`seams: ${key} is framed by ${[...tilesOn].join(", ")}, ${list.filter((x) => x.p.rhythm !== "whole").map((x) => x.tile).filter((t, i, a) => a.indexOf(t) === i).join(", ")} on its own tile's rhythm (the way's whole line not known there): out of step at the seam`); // prettier-ignore
    else if (legs.size > 1) failures.push(`seams: ${key} is framed on different rhythms by ${[...tilesOn].join(", ")} (length|bays ${[...legs].join(" / ")})`);
    const byK = new Map();
    for (const x of list) (byK.get(x.p.station) ?? byK.set(x.p.station, []).get(x.p.station)).push(x);
    for (const [k, xs] of byK) if (xs.length > 1) failures.push(`seams: ${key} station ${k} is given by ${xs.map((x) => `${x.tile} at ${x.p.t}`).join(" and ")}: crowding at the seam`); // prettier-ignore
    for (const x of list) {
      const off = Math.abs(x.p.t - (x.p.nominal ?? x.p.t));
      if (off > P.slide.max + 1e-6) failures.push(`seams: ${key} station ${x.p.station} (${x.tile}) stands ${r3(off)} cells off its place in the rhythm, at most ${P.slide.max} (forms.pier.slide)`); // prettier-ignore
    }
    const ts = [...list].sort((x, y) => x.p.t - y.p.t);
    for (let i = 1; i < ts.length; i++) {
      if (ts[i].tile === ts[i - 1].tile) continue;
      const g = ts[i].p.t - ts[i - 1].p.t;
      if (g > P.maxPitchPastObstacle + 1e-6) failures.push(`seams: ${key}'s piers ${r3(g)} cells apart across the seam of ${ts[i - 1].tile} and ${ts[i].tile} (at ${ts[i - 1].p.t} and ${ts[i].p.t}), at most ${P.maxPitchPastObstacle}`); // prettier-ignore
      else if (g < P.width.typical - 1e-6) failures.push(`seams: ${key}'s piers ${r3(g)} cells apart across the seam of ${ts[i - 1].tile} and ${ts[i].tile}: crowding at the seam`); // prettier-ignore
    }
  }
  notes.push(`seams: ${seams} way legs' sides framed across a seam, ${runs.size} in all`);
  return { failures, notes, ways: seams };
}

export const _internal = { landingOf, projectionOf, girderDepth, oculusFault, carveHeights, underPortico, navesLegs, fusion, corbelInstead };
