// The facade and skyline family of stage 9 (levels/gen/stage9-forms.mjs): what the lots' street faces, corners and
// roofs do, so a street reads as fronts of different buildings and a skyline of different heights, not one wall of
// boxes (levels/notes-megastructure.md F13-F18, F22-F24, F27; the rulebook's `forms` section; the checks M8-M13). A
// pure function of the forms context: the same artifacts give the same forms. It runs after the deck family and
// reads its forms (fx.placed): a deck pier engaged in a front is that front's relief, the fusion band under the deck
// is its roofline, a fused lot that got cages gets none here.
//
// The theme comes from the lot's district: its wealth picks the vocabulary (forms.facadeThemes: elite and high
// regal marble and gold, pilasters, loggias, cornices and balustrades, setbacks; mid industrial cement, pilaster
// strips, bays, pipes and vents in the fusion band; low and slum Kowloon-like add-ons: cages, boxes, drop pipes and
// wall-run pipes, rooftop tanks and shacks), its palette the material (each form wears its lot's own `trim` or
// `wall` role from 06, the capitals the district's gold trim; never the frame's role).
//
// Written rules (each a sentence the family's check holds or the placer obeys):
//   - Faces. A street face is the run of lot sides (facade lots and enterable buildings of the tile) on one line
//     whose outside is public floor (stage 8's street world), split where the line jogs. A form stands against a
//     face: its inner side on the wall line (or embedded in a facade's rock), never into an enterable building.
//   - M8. Along every face no unbroken stretch, in one plane and one material, past forms.facade.unbroken.ground
//     (4 cells) in the ground storey and forms.facade.unbroken.upper (8 cells) above it. A stretch is broken by a
//     change of material (06's wall role, an enterable building), a jog of the roofline by forms.massing.roofStep
//     (above the ground storey), a street door or window of 05, or relief at least forms.facade.breakRelief deep
//     standing through half the band or more (a pier, pilaster, drop pipe, bay, corner piece). The placer fills a
//     long stretch with lesenes (a pilaster strip), drop pipes on the poor fronts.
//   - M9. Every form on a face at least forms.facade.trim deep; every storey of a lot's front with an element at
//     least forms.facade.bandRelief deep in it; every lot with one major element (forms.facade.major: at least
//     2.9 m wide or deep and bandRelief deep): a giant pilaster, bay, cage, loggia, buttress or a deck pier.
//   - Patterns. Each lot's front gets one pattern of its theme (pier, bay, loggia; bay, pier, plain; cage, box,
//     drop) and a roofline of its layer's kind (under the sky: cornice, balustrade, attic, parapet, tank; in the
//     deck's fusion band: plain, pipe, vents; under a vault: plain, tank, shack), chosen along the face so that two
//     neighbours differ in at least forms.massing.minDiffer of roof height, roof form, cornice height, pattern and
//     wall role (M11), and no signature repeats on more than forms.massing.maxRepeatShare of the tile's lots.
//   - M12. Along every face under the sky, at least forms.skyline.minHeights roof heights in every window of
//     forms.skyline.window (20 cells) and no more than forms.skyline.maxRun lots in a row at one height; a lot is
//     raised by setback tiers (F16: world prisms on its own rock, set in forms.setback.inset from every street
//     face) whose tops are only heights the tile-layer already carves (its floor, its top, its lots' and buildings'
//     roofs): never a new carve height (M19).
//   - M10. Every convex block corner on public floor at a node (a junction or a plaza, alleys exempt) gets a corner
//     piece (F17: an octagonal turret or a 12-sided drum corbelled out over the ground storey, a corner pier with
//     its capital, quoins) or stands by an enterable building's door; the corners of one node never alike.
//   - M13. Every L3 district whose area's centre lies in the tile has a landmark: a described tower or a dome or
//     crown placed here, at least forms.landmark.minStoreysOver storeys over the district's median roof in the tile;
//     a silhouette kind (round, octagon, square, dome, spire, stepped) at most once a layer, city-wide by the
//     description's towers.
//   - F13 buttresses stand on the regime's (msr) buildings, stepping back; F23 a tower's crown (a gold ring and a
//     stepped drum) within its own height, replacing the crown and cap the description's estimate already counts;
//     F22 a dome only on a layer under the sky, over a building's top-storey room of a kind in forms.dome.over,
//     never where a tower stands; F27 a gold capital on every column of the gold-trimmed districts' colonnades
//     (a square's, a way's porticoes; no bases: the notes' trade); F14 galleries round the courts of the poor dense districts (the Stacks' light
//     well as a megablock's atrium), a slab and a rail a storey a face; F18 a wall-run pipe along each poor face
//     under a vault or in an industrial district, one brush a forms.wallServices.run.
//   - Budget. A form on an enterable building is paid out of the description's facade allowance for it
//     (ESTIMATE.facadePerCellStorey: a brush a cell of perimeter a storey, the notes' trade 3: windows drawn as
//     texture), a tower's crown out of the crown and cap the estimate counts; the rest counts into the tile's
//     brushes. Every part is then held to stage 9's common rules (forms.mjs) and to every form placed before it; a
//     standing form that cuts a street walk is taken out again, nearest the cut first.
import { r3, dist, polyOverlap, polyBox, seedOf, seeded } from "./geom.mjs";
import { part, instance, partFaults, walkBreaks, boxPoly, HULL_HEAD, ZONE_HEAD } from "./forms.mjs";
import { ESTIMATE } from "../lib/city-checks.mjs";
import { towerTiers } from "../lib/city-description.mjs";

export const family = {
  id: "facade",
  order: 30,
  forms: ["F13", "F14", "F15", "F16", "F17", "F18", "F22", "F23", "F24", "F27"],
  place,
  check,
};

const EPS = 1e-6;
const say = (v) => `${r3(v)}`;
/** A least size of the rulebook in metres as cells, less 2 cm for the 16-unit grid (48 units is 1.219 m, the rule 1.22). */
const cellsOf = (fx, metres) => (metres - 0.02) / fx.cell;
/** A face side: along-axis (0 x, 1 y), the outward normal's sign on the other axis, the line of a box. */
const SIDE = {
  s: { ax: 0, sg: -1, line: (b) => b[1] },
  n: { ax: 0, sg: 1, line: (b) => b[3] },
  w: { ax: 1, sg: -1, line: (b) => b[0] },
  e: { ax: 1, sg: 1, line: (b) => b[2] },
};
const OPP = { s: "n", n: "s", e: "w", w: "e" };
/** The point t along a face's line, d out of the wall (cells). */
const facePt = (side, line, t, d) => (SIDE[side].ax === 0 ? [t, line + SIDE[side].sg * d] : [line + SIDE[side].sg * d, t]);
/** A box on a face: along t0..t1, out of the wall d0..d1 (negative: into the lot). */
function faceBox(side, line, t0, t1, d0, d1) {
  const a = facePt(side, line, t0, d0);
  const b = facePt(side, line, t1, d1);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}
const rectBox = (r) => [r.x, r.y, r.x + r.w, r.y + r.d];
const inBox = (p, b, e = 0) => p[0] >= b[0] - e && p[0] <= b[2] + e && p[1] >= b[1] - e && p[1] <= b[3] + e;
const zMeet = (a, b) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
/** A regular n-gon round c, radius r (its first corner half a side off the axis). */
const ngon = (c, r, n) => [...Array(n).keys()].map((i) => [c[0] + r * Math.cos(((i + 0.5) * 2 * Math.PI) / n), c[1] + r * Math.sin(((i + 0.5) * 2 * Math.PI) / n)]); // prettier-ignore
/** A trapezoid on a face: its base t0..t1 on the wall, its front narrower by `taper` each side, d deep. */
function trapezoid(side, line, t0, t1, d, taper) {
  const pts = [facePt(side, line, t0, 0), facePt(side, line, t1, 0), facePt(side, line, t1 - taper, d), facePt(side, line, t0 + taper, d)];
  // counter-clockwise whatever the side
  const area = pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % 4][1] - pts[(i + 1) % 4][0] * p[1], 0);
  return area < 0 ? pts.reverse() : pts;
}

// ── the scene: lots, their themes and materials, their street faces ──

const SCENES = new WeakMap();
/** What the family reads, once per artifact set: lots of the tile with their theme and material, faces by layer. */
export function sceneOf(fx) {
  const key = fx.lots;
  if (SCENES.has(key)) return SCENES.get(key);
  const districts = new Map((fx.desc.districts ?? []).map((d) => [d.id, d]));
  const things = new Map((fx.inputs["06-palette.json"]?.things ?? []).map((t) => [t.id, t]));
  const plans = new Map((fx.inputs["05-plans.json"]?.buildings ?? []).map((b) => [b.id, b]));
  const descB = new Map((fx.desc.buildings ?? []).map((b) => [b.id, b]));
  const lots = [];
  for (const l of fx.lots.lots) {
    if (l.tile !== fx.tile.id) continue;
    const L = fx.layerOf(l.layer);
    if (!L) continue;
    const d = districts.get(l.district) ?? {};
    const enterable = l.kind === "enterable";
    const th = things.get(enterable ? `building:${l.building}` : `facade:${l.id}`);
    const storeys = enterable ? l.storeys : l.facade?.storeys ?? 1;
    const top = r3(l.zBase + (enterable ? l.storeys * fx.storey : l.facade?.height ?? fx.storey));
    lots.push({
      id: enterable ? l.building : l.id, lot: l, enterable, layer: l.layer, L, district: l.district, wealth: d.wealth ?? L.wealth ?? "mid", density: d.density ?? "medium", // prettier-ignore
      wall: th?.slots?.wall?.role ?? null, trim: th?.slots?.trim?.role ?? null, palette: d.palette ?? {}, storeys, z0: l.zBase, top, box: rectBox(l.rect), front: l.frontage?.side ?? "s", // prettier-ignore
      plan: enterable ? plans.get(l.building) ?? null : null, desc: enterable ? descB.get(l.building) ?? null : null, msr: enterable && (l.type === "msr" || l.owner === "msr"), // prettier-ignore
    });
  }
  const byId = new Map(lots.map((x) => [x.id, x]));
  const faces = [];
  for (const L of fx.layers) faces.push(...facesOf(fx, L, lots.filter((x) => x.layer === L.id)));
  const out = { lots, byId, faces, districts };
  SCENES.set(key, out);
  return out;
}

/** The owner of a layer's public floor at a point (cells): { kind, id } or null. */
const floorAt = (fx, lid, p) => fx.world(lid).W.ownerAt([p[0] * fx.cell, p[1] * fx.cell]);

/** The street faces of a layer: lot sides with public floor outside, merged along one line. */
function facesOf(fx, L, lots) {
  const segs = [];
  for (const lt of lots) {
    for (const side of ["s", "n", "w", "e"]) {
      const S = SIDE[side];
      const line = S.line(lt.box);
      const [a, b] = S.ax === 0 ? [lt.box[0], lt.box[2]] : [lt.box[1], lt.box[3]];
      let run = null;
      const flush = () => {
        if (run && run.t1 - run.t0 >= 0.5 - EPS) segs.push({ lot: lt, side, line, t0: r3(run.t0), t1: r3(run.t1), on: [...run.on].sort() });
        run = null;
      };
      for (let t = a; t < b - EPS; t += 0.25) {
        const o = floorAt(fx, L.id, facePt(side, line, t + 0.125, 0.25));
        if (!o) {
          flush();
          continue;
        }
        if (!run) run = { t0: t, t1: t + 0.25, on: new Set() };
        run.t1 = Math.min(b, t + 0.25);
        run.on.add(o.id);
      }
      flush();
    }
  }
  const groups = new Map();
  for (const s of segs) {
    const k = `${s.side}|${s.line}`;
    (groups.get(k) ?? groups.set(k, []).get(k)).push(s);
  }
  const faces = [];
  for (const [k, list] of [...groups].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    list.sort((x, y) => x.t0 - y.t0);
    let cur = null;
    for (const s of list) {
      if (cur && s.t0 - cur.t1 <= 0.05) {
        cur.segs.push(s);
        cur.t1 = Math.max(cur.t1, s.t1);
      } else {
        if (cur) faces.push(cur);
        cur = { layer: L.id, side: s.side, line: s.line, t0: s.t0, t1: s.t1, segs: [s] };
      }
    }
    if (cur) faces.push(cur);
    void k;
  }
  faces.forEach((f, i) => {
    f.id = `${L.id}.${f.side}${say(f.line)}.${say(f.t0)}`;
    f.n = i;
    f.on = [...new Set(f.segs.flatMap((s) => s.on))].sort();
  });
  return faces;
}

/** The street openings of an enterable lot on a face: [{ t0, t1, z: [z0, z1], what }] (05's street doors and windows). */
function openingsOn(fx, lt, face) {
  const out = [];
  if (!lt.plan) return out;
  const fr = lt.plan.frame;
  const origin = fr?.origin_cells ?? [lt.box[0], lt.box[1]];
  const h = fx.storey;
  const S = SIDE[face.side];
  const near = (c) => Math.abs((S.ax === 0 ? c[1] : c[0]) - face.line) <= 0.25;
  for (const d of lt.plan.doors ?? []) {
    if (!d.street || !d.cells) continue;
    if (!near(d.cells)) continue;
    const t = S.ax === 0 ? d.cells[0] : d.cells[1];
    const w = (d.width ?? 1.42) / fx.cell;
    const z0 = lt.z0 + (d.storey ?? 0) * h;
    out.push({ t0: t - w / 2, t1: t + w / 2, z: [z0, z0 + (d.height ?? 2.5) / fx.cell], what: `door ${d.name ?? d.id}` });
  }
  for (const w of lt.plan.windows ?? []) {
    if (!w.street) continue;
    const c = [origin[0] + w.at[0] / fx.cell, origin[1] + w.at[1] / fx.cell];
    if (!near(c)) continue;
    const t = S.ax === 0 ? c[0] : c[1];
    const ww = (w.width ?? 1.2) / fx.cell;
    const z0 = lt.z0 + (w.storey ?? 0) * h;
    out.push({ t0: t - ww / 2, t1: t + ww / 2, z: [z0 + (w.sill ?? 1) / fx.cell, z0 + (w.head ?? 2.5) / fx.cell], what: `window of ${w.room}` });
  }
  return out;
}

/**
 * The relief standing against a face from some forms: [{ t0, t1 (along, clipped to the face), width (its whole
 * extent along), depth (out of the wall, cells), z, form, kind, part }]. A part counts when its inner side meets the
 * wall line (or is embedded behind it) and it stands out of the wall.
 */
export function reliefOn(face, forms) {
  const S = SIDE[face.side];
  const out = [];
  for (const f of forms) {
    if (f.layer !== face.layer) continue; // a form of another layer never stands on this layer's face (the deck's oculi, the feet below)
    for (const p of f.parts ?? []) {
      if (p.build === "cut") continue;
      const b = polyBox(p.top ? [...p.poly, ...p.top] : p.poly);
      const lo = S.ax === 0 ? b[1] : b[0];
      const hi = S.ax === 0 ? b[3] : b[2];
      const inner = S.sg > 0 ? lo : hi;
      const outer = S.sg > 0 ? hi : lo;
      const depth = S.sg > 0 ? outer - face.line : face.line - outer;
      const touch = S.sg > 0 ? inner <= face.line + 0.0625 : inner >= face.line - 0.0625;
      if (!touch || depth <= 0.01) continue;
      const a0 = S.ax === 0 ? b[0] : b[1];
      const a1 = S.ax === 0 ? b[2] : b[3];
      const t0 = Math.max(a0, face.t0);
      const t1 = Math.min(a1, face.t1);
      if (t1 - t0 <= 0.01) continue;
      out.push({ t0, t1, width: a1 - a0, depth, z: p.z, form: f.id, kind: f.kind, family: f.family, what: p.what ?? p.shape, part: p });
    }
  }
  return out;
}

/**
 * The share of a lot's front strip (relief deep) in a z band that what the stages before placed stands in (a
 * hallway's bridge along it, a connector), or a vault's chamfer runs along (the edges family's: over a narrow alley
 * its lower edge comes down into the ground storey, as M10 counts a vault passing over a corner).
 */
export function maskedShare(fx, face, seg, zb) {
  const d = fx.R.pilaster.depth.typical;
  const vaults = (fx.placed ?? []).filter((f) => f.kind === "vault" && f.layer === face.layer).flatMap((f) => f.parts);
  let n = 0;
  let hit = 0;
  for (let t = seg.t0; t < seg.t1 - EPS; t += 0.25) {
    n++;
    const poly = boxPoly(faceBox(face.side, face.line, t, Math.min(seg.t1, t + 0.25), 0, d));
    if (fx.solids.some((sd) => !["facade", "prop", "building"].includes(sd.kind) && zMeet(sd.z, zb) > 0.25 && polyOverlap(poly, sd.poly) > 0.01)) hit++;
    else if (vaults.some((q) => zMeet(q.z, zb) > 0.25 && polyOverlap(poly, q.poly) > 0.01)) hit++;
    else {
      const K = fx.keep(face.layer);
      if ([...K.zones, ...K.boxes].some((z) => zMeet(z.z, zb) > 0.25 && polyOverlap(poly, z.poly) > 0.01)) hit++;
    }
  }
  return n ? hit / n : 0;
}
/** Whether an element stands in a z band: through half the band, or half of itself when it is shorter. */
const inBand = (z, band) => zMeet(z, band) >= 0.5 * Math.min(band[1] - band[0], z[1] - z[0]) - EPS;

// ── M8: the unbroken stretches of a face ──

/**
 * The stretches of a face in a band, unbroken by a material change, a roofline jog, an opening or relief:
 * [{ t0, t1, len, lots }]. `band`: "ground" (the ground storey of the layer) or "upper" (above it to each lot's top).
 */
export function stretchesOf(fx, face, relief, band) {
  const S = sceneOf(fx);
  const L = fx.layerOf(face.layer);
  const h = fx.storey;
  const rulesM = fx.rules.forms;
  const brk = cellsOf(fx, rulesM.facade.breakRelief.min);
  const step = fx.R.massing.roofStep.min;
  // the walls in the band: each segment whose lot reaches into it
  const walls = [];
  for (const s of face.segs) {
    const lt = s.lot;
    const z = band === "ground" ? [lt.z0, lt.z0 + Math.min(h, lt.top - lt.z0)] : [lt.z0 + h, lt.top];
    if (z[1] - z[0] < 0.25) continue;
    walls.push({ ...s, z });
  }
  void L;
  // cuts: relief through the band, openings
  const cuts = [];
  for (const r of relief) {
    if (r.depth < brk - EPS) continue;
    const zb = band === "ground" ? [face.segs[0].lot.z0, face.segs[0].lot.z0 + h] : [face.segs[0].lot.z0 + h, Math.max(...face.segs.map((s) => s.lot.top))]; // prettier-ignore
    if (!inBand(r.z, zb)) continue;
    cuts.push([r.t0, r.t1]);
  }
  for (const s of face.segs) for (const o of openingsOn(fx, s.lot, face)) {
    const zb = band === "ground" ? [s.lot.z0, s.lot.z0 + h] : [s.lot.z0 + h, s.lot.top];
    if (zMeet(o.z, zb) > 0.1) cuts.push([Math.max(o.t0, s.t0), Math.min(o.t1, s.t1)]);
  }
  void S;
  // runs of wall of one material, contiguous
  const runs = [];
  for (const w of walls) {
    const last = runs[runs.length - 1];
    const same = last && Math.abs(last.t1 - w.t0) <= 0.05 && last.mat === matOf(w.lot) && (band === "ground" || Math.abs(last.top - w.lot.top) < step - EPS);
    if (same) {
      last.t1 = w.t1;
      last.lots.push(w.lot.id);
    } else runs.push({ t0: w.t0, t1: w.t1, mat: matOf(w.lot), top: w.lot.top, lots: [w.lot.id] });
  }
  const out = [];
  for (const r of runs) {
    let pieces = [[r.t0, r.t1]];
    for (const [c0, c1] of cuts) pieces = pieces.flatMap(([a, b]) => (c1 <= a || c0 >= b ? [[a, b]] : [[a, Math.max(a, c0)], [Math.min(b, c1), b]])); // prettier-ignore
    for (const [a, b] of pieces) if (b - a > 0.01) out.push({ t0: r3(a), t1: r3(b), len: r3(b - a), lots: r.lots });
  }
  return out;
}
const matOf = (lt) => (lt.enterable ? `building ${lt.id}` : lt.wall ?? `facade ${lt.id}`);

// ── what one lot gets ──

/** The vocabulary of a wealth (the rulebook's facadeThemes): patterns, rooflines by ceiling, corner treatments. */
const themeOf = (fx, wealth) => fx.rules.forms.facadeThemes?.[wealth] ?? fx.rules.forms.facadeThemes?.mid;
/** The ceiling over a lot: sky, fused (the deck's band) or vault/slab. */
function ceilingOf(fx, lt) {
  const L = lt.L;
  if (L.ceiling === "sky") return "sky";
  if (L.ceiling === "deck") {
    const c = [(lt.box[0] + lt.box[2]) / 2, (lt.box[1] + lt.box[3]) / 2];
    return fx.deck && inBox(c, fx.deck.box) ? "fused" : "sky";
  }
  return "vault";
}
/** The lid over a lot (the deck's soffit, the vault's top, else the layer's top). */
const lidOf = (fx, lt) => (ceilingOf(fx, lt) === "fused" ? fx.deck.soffit : lt.L.top);

/** A material role of the lot's palette for a form: its trim (relief), its wall (masses), the district's gold. */
function roleOf(lt, use) {
  if (use === "gold") return (lt.palette.trim ?? []).find((r) => /gold/.test(r)) ?? lt.trim;
  if (use === "pillar") return (lt.palette.trim ?? []).find((r) => /pillar/.test(r)) ?? lt.trim;
  return use === "wall" ? lt.wall : lt.trim ?? lt.wall;
}

// ── the placer ──

function place(fx) {
  const out = { forms: [], failures: [], notes: [] };
  const S = sceneOf(fx);
  const P = { fx, S, out, placed: fx.placed ?? [], mine: out.forms, allowance: new Map(), traits: new Map() };
  landmarks(P);
  corners(P);
  patterns(P);
  skyline(P);
  galleries(P);
  fixRelief(P);
  // a lot whose pattern M9's giant pilaster replaced: where it no longer holds M11 now the fronts are done, its
  // roofline chosen again
  for (const sw of P.swapped ?? []) if (!massingHolds(P, sw.lt) && !reroof(P, sw.face, sw.seg, sw.lt)) out.notes.push(`M11: ${sw.lt.id}'s pattern became the pier (M9's giant pilaster) and no roofline sets it apart`); // prettier-ignore
  keepWalks(P);
  // what no check holds (the capitals, the wall-run pipes) only within the brushes the tile has left
  capitals(P);
  wallRuns(P);
  keepWalks(P);
  const left = headroom(P);
  if (left < 0) out.failures.push(`budget: the facade family's relief, corners and skyline (M8-M12) need ${-left} brushes more than the tile has left under its limit; the notes' trades (room dressing, street props) are the stages before's`); // prettier-ignore
  else out.notes.push(`budget: ${left} brushes left in the tile under its limit after the facade family`);
  // the claims on the facade allowance, said once a building
  const claims = new Map();
  for (const f of out.forms) if (f.allowanceOf) claims.set(f.allowanceOf.building, (claims.get(f.allowanceOf.building) ?? 0) + f.allowance);
  if (claims.size) out.notes.push(`paid from the description's facade and tower allowances (the notes' trade 3, windows as texture): ${[...claims].map(([b, n]) => `${b} ${n}`).join(", ")}`); // prettier-ignore
  return out;
}

/** The brushes the tile has left under its limit (stage 8's total, every form placed so far less what it claims of the allowances). */
function headroom(P) {
  const bb = P.fx.dressing?.measures?.brushBudget ?? {};
  if (!Number.isFinite(bb.total) || !Number.isFinite(bb.limit)) return Infinity;
  const net = (fs) => fs.reduce((s, f) => s + (f.brushes ?? 0) + (f.rock ?? 0) - Math.min(Math.max(0, f.allowance ?? 0), f.brushes ?? 0), 0);
  return bb.limit - bb.total - net(P.placed) - net(P.mine);
}

/** The brushes optional forms may take: the headroom less the tile's reserve (forms.reserveShare of its limit). */
function optionalRoom(P) {
  const bb = P.fx.dressing?.measures?.brushBudget ?? {};
  if (!Number.isFinite(bb.limit)) return headroom(P);
  return headroom(P) - Math.ceil(bb.limit * (P.fx.R.reserveShare ?? 0));
}

/** What a part enters: the common rules (forms.mjs) and every form placed before or by this family. */
function faultsOf(P, pt, { layer, ignore = () => false, ignoreForms = () => false } = {}) {
  const fx = P.fx;
  const fl = partFaults(fx, pt, { layers: layer ? [layer] : null, ignore }).map((x) => `${x.what} by ${x.by}`);
  if (fl.length) return fl;
  for (const f of [...P.placed, ...P.mine]) {
    if (ignoreForms(f)) continue;
    for (const q of f.parts ?? []) {
      if (q.build === "cut") continue;
      if (zMeet(q.z, pt.z) <= 0.01) continue;
      const d = polyOverlap(pt.poly, q.poly);
      if (d > 0.01) return [`${f.id} by ${r3(d)}`];
    }
  }
  return [];
}

/** Adds an instance with its claim on its building's facade allowance (forms on an enterable lot). */
function push(P, fields) {
  const fx = P.fx;
  const lt = fields.lotRef;
  delete fields.lotRef;
  const inst = instance({ family: "facade", build: "detail", frame: false, ...fields });
  // an id given already (a lot's drop pipes a storey each at one point of its front, where something passes higher
  // up): the next number after it
  const taken = (id) => P.mine.some((f) => f.id === id) || P.placed.some((f) => f.id === id);
  if (taken(inst.id)) {
    let k = 2;
    while (taken(`${inst.id}.${k}`)) k++;
    inst.id = `${inst.id}.${k}`;
  }
  if (lt?.enterable && lt.desc) {
    const E = { ...ESTIMATE, ...(fx.desc.engine?.estimate ?? {}) };
    const cap = facadeAllowance(lt.desc, E);
    const used = P.allowance.get(lt.id) ?? 0;
    const take = Math.min(inst.brushes, Math.max(0, cap - used));
    if (take > 0) {
      inst.allowance = take;
      inst.allowanceOf = { building: lt.id, kind: "facade" };
      P.allowance.set(lt.id, used + take);
    }
  }
  P.mine.push(inst);
  return inst;
}
/** A building's facade allowance in the description's estimate: a brush a cell of perimeter a storey. */
export const facadeAllowance = (b, E = ESTIMATE) => Math.round(2 * (b.footprint[0] + b.footprint[1]) * b.storeys * (E.facadePerCellStorey?.brushes ?? 1)); // prettier-ignore

/** Tries an element at positions round t (cells along the face): the first whose parts all stand. */
function tryAlong(P, face, lt, t, width, build, { span = [face.t0, face.t1], deltas = null, opts = {} } = {}) {
  let why = null;
  const ds = deltas ?? spread(t, width, span);
  for (const d of ds) {
    const tc = t + d;
    if (tc - width / 2 < span[0] - EPS || tc + width / 2 > span[1] + EPS) continue;
    const parts = build(tc);
    if (!parts) continue;
    const fl = parts.flatMap((pt) => faultsOf(P, pt, { layer: face.layer, ...opts }));
    if (!fl.length) return { parts, t: tc };
    why ??= fl[0];
  }
  return { parts: null, why: why ?? `no room on ${lt.id}'s face` };
}

/** Shifts from t that keep an element of a width inside a span, on the quarter-cell grid, nearest first (at most 24). */
function spread(t, width, span) {
  const out = [];
  for (let tc = span[0] + width / 2; tc <= span[1] - width / 2 + EPS; tc += 0.25) out.push(tc - t);
  return out.sort((a, b) => Math.abs(a) - Math.abs(b) || a - b).slice(0, 24);
}
/** Where the relief of a lot's front stops: a quarter cell under its roofline, where its cornice (or the deck's) runs. */
const reliefTop = (fx, lt) => {
  const top = Math.min(lt.top, lidOf(fx, lt)) - fx.R.roofline.cornice.height.typical;
  return ceilingOf(fx, lt) === "fused" ? Math.min(top, fx.deck.soffit - fx.R.fusion.corbel.height.typical) : top;
};

/** The lot's own segment on its front (else its longest on any face): { face, seg }. */
function frontOf(P, lt) {
  let best = null;
  for (const f of P.S.faces)
    for (const s of f.segs) {
      if (s.lot !== lt) continue;
      const score = (s.side === lt.front ? 1000 : 0) + (s.t1 - s.t0);
      if (!best || score > best.score) best = { face: f, seg: s, score };
    }
  return best;
}

// ── landmarks: a tower's crown (F23), domes (F22) ──

function landmarks(P) {
  const { fx, S, out } = P;
  const T = fx.R.towerCrown;
  const E = { ...ESTIMATE, ...(fx.desc.engine?.estimate ?? {}) };
  for (const lt of S.lots.filter((x) => x.enterable && x.lot.tower)) {
    const tw = lt.lot.tower;
    // its top tier (towerTiers) carries the crown: a spire's ring at its point's foot (no stepped crown, the point
    // is its crown), a stepped tower's on its smallest tier
    const tiers = towerTiers({ ...tw, silhouette: tw.silhouette ?? lt.desc?.tower?.silhouette ?? "round" });
    const point = tiers.find((t) => t.apex);
    const head = point ? tiers[tiers.indexOf(point) - 1] : tiers[tiers.length - 1];
    const n = head.sides;
    const r = head.across / 2;
    const zTop = tw.z[1];
    const ringH = T.ring.height.typical;
    const stepH = T.step.height.typical;
    const z1 = point ? head.z[1] : zTop - stepH;
    const ring = part("frustum", ngon(tw.at, r, n), [z1 - ringH, z1], { what: "gold ring", top: ngon(tw.at, r + T.ring.flare.typical, n), role: roleOf(lt, "gold") }); // prettier-ignore
    const step = point ? null : part("prism", ngon(tw.at, Math.max(0.5, r - T.step.inset.typical), n), [z1, zTop], { what: "stepped crown" }); // prettier-ignore
    const crown = [ring, step].filter(Boolean);
    const fl = crown.flatMap((pt) => faultsOf(P, pt, { layer: lt.layer, ignore: (s) => s.id === lt.id }));
    if (fl.length) {
      out.notes.push(`tower crown of ${lt.id}: left out (${fl[0]})`);
      continue;
    }
    const inst = push(P, { id: `facade.crown.${lt.id}`, form: "F23", kind: "tower-crown", layer: lt.layer, role: roleOf(lt, "wall"), palette: lt.district, on: lt.id, around: [lt.id], at: tw.at.map(r3), silhouette: lt.desc?.tower?.silhouette ?? "round", top: r3(zTop), parts: crown }); // prettier-ignore
    // its crown and cap are in the estimate's tower shell (ESTIMATE.tower.brushesFixed: shaft, crown, cap)
    inst.allowance = Math.min(inst.brushes, Math.max(0, (E.tower?.brushesFixed ?? 3) - 1));
    inst.allowanceOf = { building: lt.id, kind: "tower" };
  }
  domes(P);
}

function domes(P) {
  const { fx, S, out } = P;
  const D = fx.R.dome;
  const over = new Set(fx.rules.forms.dome.over ?? []);
  const top = Math.max(...fx.layers.map((L) => L.level));
  for (const lt of S.lots.filter((x) => x.enterable && x.plan && x.L.ceiling === "sky" && x.L.level === top)) {
    if (lt.lot.tower) continue;
    const st = lt.storeys - 1;
    const rooms = (lt.plan.rooms ?? []).filter((r) => r.storey === st && over.has(r.kind) && r.cells?.length);
    if (!rooms.length) continue;
    const room = rooms.sort((a, b) => (b.area_m2 ?? 0) - (a.area_m2 ?? 0) || (a.id < b.id ? -1 : 1))[0];
    const got = domeOn(fx, lt, room, D);
    if (got.why) {
      out.notes.push(`dome over ${room.id}: ${got.why}`);
      continue;
    }
    const fl = got.parts.flatMap((pt) => faultsOf(P, pt, { layer: lt.layer, ignore: (s) => s.id === lt.id }));
    if (fl.length) {
      out.notes.push(`dome over ${room.id}: left out (${fl[0]})`);
      continue;
    }
    push(P, { id: `facade.dome.${lt.id}`, form: "F22", kind: "dome", layer: lt.layer, role: roleOf(lt, "gold"), palette: lt.district, on: lt.id, over: room.id, overKind: room.kind, around: [lt.id], at: got.at, across: got.across, top: got.top, silhouette: "dome", parts: got.parts }); // prettier-ignore
  }
}

/** A dome over a room (05's room, its cells' rect on the building's top storey): a drum, three shells, a lantern, ribs. */
export function domeOn(fx, lt, room, D = fx.R.dome) {
  const rc = room.cells[0];
  const across = Math.min(rc.w, rc.d, D.across.max);
  if (across < D.across.min - EPS) return { why: `its room is ${r3(Math.min(rc.w, rc.d))} cells across, a dome at least ${D.across.min}` };
  const c = [rc.x + rc.w / 2, rc.y + rc.d / 2];
  const r = across / 2;
  const n = across >= 3 ? 16 : 12;
  const z0 = lt.top;
  const dh = D.drum.height.typical;
  const parts = [part("prism", ngon(c, r, n), [z0, z0 + dh], { what: "drum", build: "world" })];
  // the shell: three frustums to a quarter of the radius, a lantern on it
  const rise = r * D.rise;
  const rs = [r, r * 0.92, r * 0.7, r * 0.3];
  for (let i = 0; i < 3; i++) parts.push(part("frustum", ngon(c, rs[i], n), [z0 + dh + (rise * i) / 3, z0 + dh + (rise * (i + 1)) / 3], { top: ngon(c, rs[i + 1], n), what: `shell ${i + 1}`, build: "world" })); // prettier-ignore
  const zl = z0 + dh + rise;
  parts.push(part("prism", ngon(c, Math.max(0.25, r * 0.2), 8), [zl, zl + D.lantern.height.typical], { what: "lantern" }));
  // ribs round the drum: pilasters at every other side
  const ribs = Math.min(D.ribs, n / 2);
  for (let i = 0; i < ribs; i++) {
    const a = ((i * 2 + 0.5) * 2 * Math.PI) / n;
    const u = [Math.cos(a), Math.sin(a)];
    const v = [-u[1], u[0]];
    const w = 0.125;
    const p0 = [c[0] + u[0] * r, c[1] + u[1] * r];
    const p1 = [c[0] + u[0] * (r + 0.25), c[1] + u[1] * (r + 0.25)];
    const poly = [[p0[0] - v[0] * w, p0[1] - v[1] * w], [p0[0] + v[0] * w, p0[1] + v[1] * w], [p1[0] + v[0] * w, p1[1] + v[1] * w], [p1[0] - v[0] * w, p1[1] - v[1] * w]]; // prettier-ignore
    parts.push(part("box", poly, [z0, z0 + dh], { what: `rib ${i + 1}` }));
  }
  const top = r3(zl + D.lantern.height.typical);
  const L = lt.L;
  const lid = (L.sky ?? L.top) - (fx.rules.dimensions.towers?.topClearance?.min ?? 1.28) / fx.cell;
  if (top > lid + EPS) return { why: `its lantern at z ${top} would pass the sky lid less the towers' top clearance (z ${r3(lid)})` };
  return { parts, at: c.map(r3), across: r3(across), top };
}

// ── capitals (F27) ──

function capitals(P) {
  const { fx, S, out } = P;
  const C = fx.R.capital;
  // a square's colonnade, or a way's porticoes (stage 1's column lines, the tile's columns); the ways of one name (the
  // Mese's segments) are one colonnade: all of its capitals in the tile or none
  const wayOf = (col) => fx.site.ways.find((w) => w.id === col.way);
  const groupOf = (col) => (col.way ? `way:${wayOf(col)?.name ?? col.way}` : col.plaza);
  const need = new Map();
  for (const col of fx.net.colonnades ?? []) need.set(groupOf(col), (need.get(groupOf(col)) ?? 0) + col.columns.length);
  const decided = new Map();
  for (const col of fx.net.colonnades ?? []) {
    const ref = col.ref ?? col.plaza;
    const q = col.way ? wayOf(col) : fx.site.plazas.find((p) => p.id === col.plaza);
    if (!q || (!col.way && q.tile !== fx.tile.id) || !col.columns.length) continue;
    const group = groupOf(col);
    const district = q.district ?? fx.site.nodes?.find((n) => n.id === q.id)?.district;
    const lt0 = { palette: S.districts.get(district)?.palette ?? {}, trim: null };
    const gold = (lt0.palette.trim ?? []).find((r) => /gold/.test(r));
    if (!gold) {
      out.notes.push(`colonnade of ${ref}: its district's trim holds no gold, no capitals (F27 is the regime's gold-trimmed porticoes)`);
      continue;
    }
    if (!decided.has(group)) decided.set(group, optionalRoom(P) >= need.get(group) ? null : optionalRoom(P));
    if (decided.get(group) !== null) {
      const of = need.get(group) > col.columns.length ? ` (${need.get(group)} with the rest of ${group.slice(4)} in the tile)` : "";
      out.notes.push(`capitals of ${ref}: left out, ${col.columns.length} brushes${of} and the tile has ${decided.get(group)} left under its limit (F27 is held by no check: the first trade)`); // prettier-ignore
      continue;
    }
    const half = col.column / 2;
    const fl = C.flare.typical;
    const ch = C.height.typical;
    let n = 0;
    const dropped = [];
    for (const c of col.columns) {
      const sq = boxPoly([c.at[0] - half, c.at[1] - half, c.at[0] + half, c.at[1] + half]);
      const top = boxPoly([c.at[0] - half - fl, c.at[1] - half - fl, c.at[0] + half + fl, c.at[1] + half + fl]);
      const pt = part("frustum", sq, [col.z[1] - ch, col.z[1]], { what: "capital", top });
      const f = faultsOf(P, pt, { layer: col.layer, ignore: (s) => s.kind === "column" && s.id === ref });
      if (f.length) {
        dropped.push(`[${c.at.map(say)}] (${f[0]})`);
        continue;
      }
      push(P, { id: `facade.capital.${ref}.${n++}`, form: "F27", kind: "capital", layer: col.layer, role: gold, palette: district ?? null, on: ref, around: [ref], at: c.at.map(r3), side: c.side, parts: [pt] }); // prettier-ignore
    }
    out.notes.push(`capitals of ${ref}: ${n} of its ${col.columns.length} columns in ${gold}, no bases (the notes' trade)${dropped.length ? `; left out ${dropped.slice(0, 2).join(", ")}` : ""}`); // prettier-ignore
  }
}

// ── patterns and rooflines (F13 pilasters, F14 loggias, F15 bays and cages, F24 rooflines) ──

function patterns(P) {
  const { fx, S } = P;
  const M = fx.R.massing;
  const done = new Set();
  const counts = new Map();
  const cap = Math.max(1, Math.floor(S.lots.length * (fx.rules.forms.massing.maxRepeatShare ?? 0.1)));
  for (const face of S.faces) {
    let prev = null;
    for (const seg of face.segs) {
      const lt = seg.lot;
      if (done.has(lt.id)) {
        prev = P.traits.get(lt.id) ?? prev;
        continue;
      }
      const fr = frontOf(P, lt);
      if (!fr) continue;
      done.add(lt.id);
      const th = themeOf(fx, lt.wealth);
      const ceil = ceilingOf(fx, lt);
      const roofs = th.roofline[ceil] ?? ["plain"];
      const pats = lt.msr ? ["buttress"] : th.patterns.includes("pier") ? th.patterns : [...th.patterns, "pier"];
      // the fused lots that got cages from the deck's fusion keep them as their pattern
      const fused = P.placed.find((f) => f.kind === "fusion" && f.lot === lt.id);
      const caged = fused?.parts?.some((p) => /^cage/.test(p.what ?? ""));
      const rnd = seeded(seedOf(fx.seed ?? 1, `facade ${lt.id}`));
      const order = (list) => list.map((x) => [x, rnd()]).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
      const choices = [];
      for (const pat of caged ? ["cage-fused"] : order(pats)) for (const roof of order(roofs)) choices.push([pat, roof]);
      // M11 holds every pair of neighbours side by side on a face: the one before on this face, and any decided
      // already on a face the chooser passed first (a lot is chosen on the first face it is met on)
      const others = neighboursOf(S, lt).map((x) => P.traits.get(x.id)).filter(Boolean);
      const differs = (tr) => (!prev || differ(prev, tr, M) >= fx.rules.forms.massing.minDiffer) && others.every((o) => differ(o, tr, M) >= fx.rules.forms.massing.minDiffer); // prettier-ignore
      const scored = choices.map(([pat, roof], i) => {
        const tr = traitsOf(fx, lt, pat, roof);
        const over = (counts.get(signature(tr)) ?? 0) >= cap;
        return { pat, roof, i, score: (differs(tr) ? 0 : 10) + (over ? 5 : 0) + costOf(pat, roof) * 0.01 };
      });
      scored.sort((a, b) => a.score - b.score || a.i - b.i);
      let tr = null;
      for (const c of scored.slice(0, 16)) {
        const mark = P.mine.length;
        const built = buildPattern(P, fr.face, fr.seg, lt, c.pat);
        const roofB = buildRoof(P, fr.face, fr.seg, lt, c.roof);
        tr = traitsOf(fx, lt, built ? c.pat : "plain", roofB ? c.roof : ceil === "fused" ? "plain" : "none");
        const ok = differs(tr) && (counts.get(signature(tr)) ?? 0) < cap;
        if (ok || c === scored[Math.min(15, scored.length - 1)]) break;
        undo(P, mark);
      }
      P.traits.set(lt.id, tr);
      counts.set(signature(tr), (counts.get(signature(tr)) ?? 0) + 1);
      prev = tr;
    }
  }
}

/** The lots side by side with a lot on any face (their sides touching on one line), as M11 pairs them. */
function neighboursOf(S, lt) {
  const out = new Set();
  for (const face of S.faces)
    for (let i = 0; i < face.segs.length; i++) {
      if (face.segs[i].lot !== lt) continue;
      for (const j of [i - 1, i + 1]) {
        const o = face.segs[j];
        if (!o || o.lot === lt) continue;
        const gap = j < i ? face.segs[i].t0 - o.t1 : o.t0 - face.segs[i].t1;
        if (Math.abs(gap) <= 0.05) out.add(o.lot);
      }
    }
  return [...out];
}

/** Takes out what was placed since a mark (the chooser's next try), giving back the allowance it claimed. */
function undo(P, mark) {
  for (const f of P.mine.splice(mark)) if (f.allowanceOf?.kind === "facade") P.allowance.set(f.allowanceOf.building, (P.allowance.get(f.allowanceOf.building) ?? 0) - f.allowance); // prettier-ignore
}
const costOf = (pat, roof) => ({ plain: 0, "cage-fused": 0, pier: 1, drop: 1, cage: 2, box: 2, bay: 1, loggia: 3, buttress: 2 })[pat] + ({ plain: 0, none: 0, cornice: 1, parapet: 1, tank: 1, vents: 1, pipe: 1, shack: 1, balustrade: 2, attic: 1 })[roof]; // prettier-ignore
/** A lot's massing traits (M11): roof height, roof form, cornice height, relief pattern, wall role. */
function traitsOf(fx, lt, pattern, roof) {
  if (roof === "plain" && ceilingOf(fx, lt) !== "fused") roof = "none";
  const cz = ["cornice", "balustrade"].includes(roof) ? lt.top : ceilingOf(fx, lt) === "fused" ? lt.top : null;
  return { roof: lt.top, roofForm: roof, cornice: cz, pattern, wall: matOf(lt) };
}
const signature = (t) => `${t.roof}|${t.roofForm}|${t.cornice}|${t.pattern}|${t.wall}`;
function differ(a, b, M) {
  let n = 0;
  if (Math.abs(a.roof - b.roof) >= M.roofStep.min - EPS) n++;
  if (a.roofForm !== b.roofForm) n++;
  if (a.cornice !== b.cornice && !(a.cornice !== null && b.cornice !== null && Math.abs(a.cornice - b.cornice) < 0.25)) n++;
  if (a.pattern !== b.pattern) n++;
  if (a.wall !== b.wall) n++;
  return n;
}

/** A lot's relief pattern on its front segment; returns the instances placed (or null when nothing stood). */
function buildPattern(P, face, seg, lt, pat) {
  const fx = P.fx;
  const R = fx.R;
  const h = fx.storey;
  const mid = (seg.t0 + seg.t1) / 2;
  const len = seg.t1 - seg.t0;
  const base = { lotRef: lt, layer: lt.layer, palette: lt.district, on: lt.id, face: face.id, side: face.side };
  const topZ = reliefTop(fx, lt);
  const pier = (tc, w, z, what) => part("box", boxPoly(faceBox(face.side, face.line, tc - w / 2, tc + w / 2, 0, R.pilaster.depth.typical)), z, { what }); // prettier-ignore
  if (pat === "plain" || pat === "cage-fused") return null;
  if (pat === "pier") {
    const w = Math.min(R.pilaster.width.typical, len);
    if (w < 0.5) return null;
    // to the roof, else through the ground storey only (what passes higher up along the front)
    let got = tryAlong(P, face, lt, mid, w, (tc) => [pier(tc, w, [lt.z0, topZ], "giant pilaster")], { span: [seg.t0, seg.t1] });
    if (!got.parts && topZ > lt.z0 + h) got = tryAlong(P, face, lt, mid, w, (tc) => [pier(tc, w, [lt.z0, lt.z0 + h - 0.125], "pilaster")], { span: [seg.t0, seg.t1] }); // prettier-ignore
    if (!got.parts) return null;
    return push(P, { ...base, id: `facade.pilaster.${lt.id}`, form: "F13", kind: "pilaster", role: roleOf(lt, lt.wealth === "elite" || lt.wealth === "high" ? "pillar" : "trim"), at: facePt(face.side, face.line, got.t, 0).map(r3), width: r3(w), depth: R.pilaster.depth.typical, pattern: pat, parts: got.parts }); // prettier-ignore
  }
  if (pat === "buttress") return buttresses(P, face, seg, lt, base);
  if (lt.storeys < 2) return null;
  if (pat === "bay") {
    const B = R.bay;
    const w = Math.min(B.width.max, Math.max(B.width.min, len / 3));
    if (w > len - 0.25) return null;
    const z = [lt.z0 + h, topZ];
    if (z[1] - z[0] < 0.75) return null;
    const got = tryAlong(P, face, lt, mid, w, (tc) => [part("prism", trapezoid(face.side, face.line, tc - w / 2, tc + w / 2, B.depth.min, Math.min(0.25, w / 4)), z, { what: "bay" })], { span: [seg.t0, seg.t1] }); // prettier-ignore
    if (!got.parts) return null;
    return push(P, { ...base, id: `facade.bay.${lt.id}`, form: "F15", kind: "bay", role: roleOf(lt, "wall"), at: facePt(face.side, face.line, got.t, 0).map(r3), width: r3(w), depth: B.depth.min, storeys: [1, lt.storeys - 1], pattern: pat, parts: got.parts }); // prettier-ignore
  }
  if (pat === "loggia") {
    const Bl = R.balcony;
    const dep = Math.max(Bl.depth?.typical ?? 1, fx.rules.dimensions.balconies.depth.min / fx.cell);
    const w = Math.min(Bl.width.typical, len - 0.5);
    if (w < 1) return null;
    const zf = lt.z0 + h;
    const parH = Math.ceil(fx.rules.dimensions.parapets.height.min / 0.0254) / fx.cu;
    const parT = Math.max(0.0625, Math.ceil((fx.rules.dimensions.parapets.thickness.min / fx.cell) * 16) / 16);
    const build = (tc) => [
      part("box", boxPoly(faceBox(face.side, face.line, tc - w / 2, tc + w / 2, 0, dep)), [zf - Bl.slab.typical, zf], { what: "slab" }),
      part("box", boxPoly(faceBox(face.side, face.line, tc - w / 2, tc + w / 2, dep - parT, dep)), [zf, zf + parH], { what: "parapet" }),
      part("wedge", boxPoly(faceBox(face.side, face.line, tc - w / 2, tc + w / 2, 0, dep)), [zf - Bl.slab.typical - Bl.corbel.typical, zf - Bl.slab.typical], { what: "corbel", edge: [facePt(face.side, face.line, tc - w / 2, 0), facePt(face.side, face.line, tc + w / 2, 0)] }), // prettier-ignore
    ];
    const got = tryAlong(P, face, lt, mid, w, build, { span: [seg.t0, seg.t1] });
    if (!got.parts) return null;
    return push(P, { ...base, id: `facade.balcony.${lt.id}`, form: "F14", kind: "balcony", role: roleOf(lt, "trim"), at: facePt(face.side, face.line, got.t, 0).map(r3), width: r3(w), depth: r3(dep), storey: 1, pattern: pat, parts: got.parts }); // prettier-ignore
  }
  if (pat === "cage" || pat === "box") {
    const Cg = R.cage;
    const w = Math.min(pat === "box" ? Cg.width.typical * 1.5 : Cg.width.typical, len);
    if (w < 1 - EPS) return null;
    const st = Math.min(lt.storeys - 1, 1 + (seedOf(fx.seed ?? 1, `cage ${lt.id}`) % Math.max(1, lt.storeys - 1)));
    const z = [lt.z0 + st * h, Math.min(lt.z0 + (st + 1) * h, topZ)];
    if (z[1] - z[0] < 0.75) return null;
    const got = tryAlong(P, face, lt, mid, w, (tc) => [part("box", boxPoly(faceBox(face.side, face.line, tc - w / 2, tc + w / 2, 0, Cg.depth.typical)), z, { what: pat })], { span: [seg.t0, seg.t1] }); // prettier-ignore
    if (!got.parts) return null;
    return push(P, { ...base, id: `facade.cage.${lt.id}`, form: "F15", kind: "cage", role: roleOf(lt, "wall"), at: facePt(face.side, face.line, got.t, 0).map(r3), width: r3(w), depth: Cg.depth.typical, storey: st, pattern: pat, parts: got.parts }); // prettier-ignore
  }
  if (pat === "drop") return dropPipe(P, face, lt, mid, [seg.t0, seg.t1], base, "drop");
  return null;
}

/**
 * Whether a drop pipe filling a poor front (M8, M9: its lesene) keeps M11. The check reads a lot's first patterned
 * form as its pattern, so on a lot the chooser left plain the filler reads as a drop: then it must still differ from
 * its neighbours and keep the repeat share, else a lesene fills the front instead.
 */
function dropKeepsMassing(P, lt) {
  return massingKeeps(P, lt, [...P.mine, { id: "probe", on: lt.id, kind: "pipe", pattern: "drop", parts: [] }]);
}
/** Whether a lot's forms changed to `after` still read (as the check reads them) as M11 wants, when they read otherwise. */
function massingKeeps(P, lt, after) {
  if (signature(traitsOfForms(P.fx, lt, after)) === signature(traitsOfForms(P.fx, lt, P.mine))) return true;
  return massingHolds(P, lt, after);
}
/** Whether a lot, read from `forms` as the check reads it, differs enough from its neighbours and keeps the repeat share (M11). */
function massingHolds(P, lt, forms = P.mine) {
  const fx = P.fx;
  const read = (x) => traitsOfForms(fx, x, forms);
  const tr = read(lt);
  for (const o of neighboursOf(P.S, lt)) if (differ(read(o), tr, fx.R.massing) < fx.rules.forms.massing.minDiffer) return false;
  const cap = Math.max(1, Math.floor(P.S.lots.length * (fx.rules.forms.massing.maxRepeatShare ?? 0.1)));
  return P.S.lots.filter((x) => x !== lt && signature(read(x)) === signature(tr)).length < cap;
}

/** A lot's roofline chosen again (another of its ceiling's kinds) so its massing holds M11: true when one did. */
function reroof(P, face, seg, lt) {
  const fx = P.fx;
  const had = P.mine.filter((x) => x.on === lt.id && (x.kind === "roofline" || (x.kind === "pipe" && x.roofForm)));
  const now = had[0]?.roofForm ?? null;
  for (const x of had) P.mine.splice(P.mine.indexOf(x), 1);
  for (const roof of themeOf(fx, lt.wealth).roofline[ceilingOf(fx, lt)] ?? []) {
    if (roof === now) continue;
    const mark = P.mine.length;
    if (buildRoof(P, face, seg, lt, roof) && massingHolds(P, lt)) {
      P.out.notes.push(`M11: ${lt.id}'s roofline chosen again (${roof}) when its pattern became the pier`);
      return true;
    }
    undo(P, mark);
  }
  P.mine.push(...had);
  return false;
}

/** A drop pipe (F18) down a front from its top to the ground, an 8-sided run. */
function dropPipe(P, face, lt, t, span, base, why, z0 = lt.z0) {
  const fx = P.fx;
  const d = fx.R.wallServices.pipe.typical;
  // from the roof to the ground, else through the ground storey only (what passes higher up along the front)
  let got = null;
  for (const zTop of [reliefTop(fx, lt), Math.min(reliefTop(fx, lt), z0 + fx.storey - 0.125)]) {
    if (zTop - z0 < 0.75) continue;
    got = tryAlong(P, face, lt, t, d, (tc) => [part("octagon-run", boxPoly(faceBox(face.side, face.line, tc - d / 2, tc + d / 2, 0, d)), [z0, zTop], { what: "drop pipe" })], { span, opts: { ignoreForms: (f) => f.kind === "pipe" } }); // prettier-ignore
    if (got.parts) break;
  }
  if (!got?.parts) return null;
  return push(P, { ...base, id: `facade.pipe.${lt.id}.${say(got.t)}`, form: "F18", kind: "pipe", role: lt.palette.trim?.find((r) => /pipe|steel|rust/.test(r)) ?? roleOf(lt, "trim"), at: facePt(face.side, face.line, got.t, 0).map(r3), runs: 0, drops: 1, pattern: "drop", why, parts: got.parts }); // prettier-ignore
}

/** F13 buttresses on a regime building's face: stepped masses at forms.buttress.every, clear of its openings. */
function buttresses(P, face, seg, lt, base) {
  const fx = P.fx;
  const Bt = fx.R.buttress;
  const len = seg.t1 - seg.t0;
  const n = Math.max(1, Math.round(len / Bt.every.typical));
  const opens = openingsOn(fx, lt, face);
  const topZ = reliefTop(fx, lt) + 0.25;
  const w = Bt.width.typical;
  const lower = lt.z0 + (topZ - lt.z0) * 0.55;
  const made = [];
  for (let k = 0; k < n; k++) {
    const t = seg.t0 + ((k + 0.5) * len) / n;
    const build = (tc) => {
      if (opens.some((o) => o.t1 > tc - w / 2 - 0.125 && o.t0 < tc + w / 2 + 0.125)) return null;
      const foot = boxPoly(faceBox(face.side, face.line, tc - w / 2, tc + w / 2, 0, Bt.depth.min));
      const step = boxPoly(faceBox(face.side, face.line, tc - w / 2, tc + w / 2, 0, Bt.depth.min / 2));
      return [
        part("box", foot, [lt.z0, lower], { what: "buttress foot" }),
        part("wedge", step, [lower, topZ - 0.25], { what: "buttress slope", edge: [facePt(face.side, face.line, tc - w / 2, 0), facePt(face.side, face.line, tc + w / 2, 0)] }), // prettier-ignore
      ];
    };
    const got = tryAlong(P, face, lt, t, w, build, { span: [seg.t0, seg.t1] });
    if (!got.parts) continue;
    made.push(push(P, { ...base, id: `facade.buttress.${lt.id}.${face.side}${k}`, form: "F13", kind: "buttress", role: roleOf(lt, "wall"), at: facePt(face.side, face.line, got.t, 0).map(r3), width: r3(w), depth: Bt.depth.min, pattern: "buttress", parts: got.parts })); // prettier-ignore
  }
  // the regime's other public faces too (the Nexus stands free in the Forum)
  for (const f2 of P.S.faces)
    for (const s2 of f2.segs) {
      if (s2.lot !== lt || s2 === seg || s2.t1 - s2.t0 < 2) continue;
      const len2 = s2.t1 - s2.t0;
      const m = Math.max(1, Math.round(len2 / Bt.every.typical));
      const op2 = openingsOn(fx, lt, f2);
      for (let k = 0; k < m; k++) {
        const t = s2.t0 + ((k + 0.5) * len2) / m;
        const build = (tc) => {
          if (op2.some((o) => o.t1 > tc - w / 2 - 0.125 && o.t0 < tc + w / 2 + 0.125)) return null;
          return [
            part("box", boxPoly(faceBox(f2.side, f2.line, tc - w / 2, tc + w / 2, 0, Bt.depth.min)), [lt.z0, lower], { what: "buttress foot" }),
            part("wedge", boxPoly(faceBox(f2.side, f2.line, tc - w / 2, tc + w / 2, 0, Bt.depth.min / 2)), [lower, topZ - 0.25], { what: "buttress slope", edge: [facePt(f2.side, f2.line, tc - w / 2, 0), facePt(f2.side, f2.line, tc + w / 2, 0)] }), // prettier-ignore
          ];
        };
        const got = tryAlong(P, f2, lt, t, w, build, { span: [s2.t0, s2.t1] });
        if (!got.parts) continue;
        made.push(push(P, { ...base, face: f2.id, side: f2.side, id: `facade.buttress.${lt.id}.${f2.side}${k}`, form: "F13", kind: "buttress", role: roleOf(lt, "wall"), at: facePt(f2.side, f2.line, got.t, 0).map(r3), width: r3(w), depth: Bt.depth.min, pattern: "buttress", parts: got.parts })); // prettier-ignore
      }
    }
  return made.length ? made[0] : null;
}

/** A lot's roofline (F24) of its ceiling's kind; returns the instance (or null). */
function buildRoof(P, face, seg, lt, roof) {
  const fx = P.fx;
  const R = fx.R;
  const base = { lotRef: lt, layer: lt.layer, palette: lt.district, on: lt.id, face: face.id, side: face.side, roofForm: roof };
  const len = seg.t1 - seg.t0;
  const C = R.roofline;
  const parH = Math.ceil(fx.rules.dimensions.parapets.height.min / 0.0254) / fx.cu;
  const parT = Math.max(0.0625, Math.ceil((fx.rules.dimensions.parapets.thickness.min / fx.cell) * 16) / 16);
  const lid = lidOf(fx, lt);
  if (roof === "plain" || roof === "none" || roof === "attic") return null; // nothing, or a setback tier (F16) the skyline places
  // a run along the front, shortened at its ends (by half cells) where a corner piece or what passes takes them
  const build = (t0, t1, k) => {
    const out = [];
    const cornice = () => part("box", boxPoly(faceBox(face.side, face.line, t0, t1, 0, C.cornice.depth.typical)), [lt.top - C.cornice.height.typical, lt.top], { what: "cornice" }); // prettier-ignore
    if (roof === "cornice") out.push(cornice());
    else if (roof === "balustrade") out.push(cornice(), part("box", boxPoly(faceBox(face.side, face.line, t0, t1, -parT, 0)), [lt.top, lt.top + parH], { what: "balustrade", embeds: true })); // prettier-ignore
    else if (roof === "parapet") out.push(part("box", boxPoly(faceBox(face.side, face.line, t0, t1, -parT, 0)), [lt.top, lt.top + parH], { what: "parapet", embeds: true })); // prettier-ignore
    else if (roof === "tank" || roof === "vents" || roof === "shack") {
      // on the roof, a cell back from the front: a tank (8-sided), a vent stack or a shack (Kowloon's rooftops)
      let tc = seg.t0 + len * [0.3, 0.6, 0.15, 0.8][k % 4];
      // within the lot's own side along the face (its front may be a sliver of it)
      const sideR = SIDE[face.side].ax === 0 ? [lt.box[0], lt.box[2]] : [lt.box[1], lt.box[3]];
      const sz = roof === "shack" ? Math.min(1.5, len - 0.5) : 0.75;
      if (sz < 0.5) return null;
      const hgt = roof === "shack" ? 1 : roof === "tank" ? 0.75 : 0.5;
      const z = ceilingOf(fx, lt) === "fused" ? [lt.top, Math.min(lt.top + hgt, lid - fx.R.fusion.corbel.height.typical - 0.125)] : [lt.top, Math.min(lt.top + hgt, lid - 0.25)]; // prettier-ignore
      if (z[1] - z[0] < 0.375) return null;
      tc = Math.min(Math.max(tc, sideR[0] + sz / 2), sideR[1] - sz / 2);
      const bx = faceBox(face.side, face.line, tc - sz / 2, tc + sz / 2, -1 - sz, -1);
      const c = [(bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2];
      const poly = roof === "shack" ? boxPoly(bx) : ngon(c, sz / 2, 8);
      out.push(part(roof === "shack" ? "box" : "prism", poly, z, { what: roof, embeds: true }));
    } else if (roof === "pipe") {
      // a wall-run pipe along the fusion band, over the deck's cornice
      const d = R.wallServices.pipe.typical;
      const z0 = lt.top + 0.25;
      const z1 = z0 + d;
      if (z1 > lid - R.fusion.corbel.height.typical - EPS) return null;
      out.push(part("octagon-run", boxPoly(faceBox(face.side, face.line, t0 + 0.125, t1 - 0.125, 0, d)), [z0, z1], { what: "band pipe" })); // prettier-ignore
    } else return null; // an attic is a setback tier (F16): the skyline places it
    return out.some((pt) => pt.z[1] > lid + EPS) ? null : out;
  };
  let parts = null;
  let why = null;
  const trims = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5], [1, 0], [0, 1], [1, 0.5], [0.5, 1], [1, 1]];
  for (const [k, [a, b]] of trims.entries()) {
    // a run along the front wants a cell of it; a tank or vents stand on the roof behind it, so a narrower front
    // (a sliver of street at a lot's corner) still carries one, at its first place
    const point = roof === "tank" || roof === "vents";
    if (len - a - b < (point ? 0.5 : 1) - EPS || (point && len < 1 - EPS && k > 0)) continue;
    const got = build(seg.t0 + a, seg.t1 - b, k);
    if (!got) return null;
    const fl = got.flatMap((pt) => faultsOf(P, pt, { layer: lt.layer }));
    if (!fl.length) {
      parts = got;
      break;
    }
    why ??= fl[0];
  }
  if (!parts) {
    P.out.notes.push(`roofline of ${lt.id} (${roof}): left out (${why ?? "its front too short"})`);
    return null;
  }
  const kind = roof === "pipe" ? "pipe" : "roofline";
  return push(P, { ...base, id: `facade.${kind === "pipe" ? "bandpipe" : "roof"}.${lt.id}`, form: kind === "pipe" ? "F18" : "F24", kind, role: roof === "pipe" ? lt.palette.trim?.find((r) => /pipe|steel|rust/.test(r)) ?? roleOf(lt, "trim") : roleOf(lt, roof === "cornice" || roof === "balustrade" ? "trim" : "wall"), at: facePt(face.side, face.line, (seg.t0 + seg.t1) / 2, 0).map(r3), top: lt.top, parts }); // prettier-ignore
}

// ── M12: the skyline under the sky, by setback tiers (F16) ──

/** The carve heights a tile-layer already has: its floor, top and sky, its lots' and buildings' roofs, its towers' tops. */
export function carveHeightsOf(fx, lid) {
  const L = fx.layerOf(lid);
  const out = new Set([r3(L.floor), r3(L.top)]);
  for (const l of fx.lots.lots) {
    if (l.layer !== lid || l.tile !== fx.tile.id) continue;
    out.add(r3(l.zBase + (l.kind === "enterable" ? l.storeys * fx.storey : l.facade?.height ?? fx.storey)));
  }
  return [...out].sort((a, b) => a - b);
}

/** A lot's roof height with its tiers. */
const roofOf = (P, lt) => Math.max(lt.top, ...P.mine.concat(P.placed).filter((f) => f.kind === "setback" && f.on === lt.id).map((f) => f.top)); // prettier-ignore

function skyline(P) {
  const { fx, S, out } = P;
  const K = fx.R.skyline;
  const win = K.window.max;
  for (const face of S.faces) {
    const lots = face.segs.map((s) => s.lot).filter((lt, i, a) => a.indexOf(lt) === i && ceilingOf(fx, lt) === "sky");
    if (lots.length < 2) continue;
    const heights = carveHeightsOf(fx, face.layer);
    // ≤ maxRun in a row, then ≥ minHeights a window: raise a lot to a height the window lacks
    for (let pass = 0; pass < 3; pass++) {
      const roofs = lots.map((lt) => roofOf(P, lt));
      let fixed = false;
      for (let i = 0; i < lots.length && !fixed; i++) {
        const runStart = i - K.maxRun;
        const run = runStart >= 0 && roofs.slice(runStart, i + 1).every((h) => Math.abs(h - roofs[i]) < 0.01);
        const inWin = windowOf(face, lots, i, win);
        const want = Math.min(K.minHeights, inWin.length);
        const distinct = new Set(inWin.map((j) => roofs[j])).size;
        if (!run && distinct >= want) continue;
        // the lot to raise: in the run its middle, else the window's lowest without a tier
        const cand = run ? [i - 1, i, runStart] : inWin.slice().sort((a, b) => roofs[a] - roofs[b] || a - b);
        const whyNot = [];
        for (const j of cand) {
          const lt = lots[j];
          const have = new Set(inWin.map((k) => roofs[k]));
          const up = heights.filter((hh) => hh > roofs[j] + 0.5 && hh <= lt.L.top + EPS && !have.has(hh));
          const pick = up.length ? up[0] : heights.find((hh) => hh > roofs[j] + 0.5 && hh <= lt.L.top + EPS);
          if (pick === undefined) {
            whyNot.push(`${lt.id} has no carve height over z ${roofs[j]} to rise to`);
            continue;
          }
          const got = setbackOn(P, lt, pick);
          if (got === true) {
            fixed = true;
            break;
          }
          whyNot.push(got);
        }
        if (!fixed) out.notes.push(`skyline of face ${face.id}: no tier could raise ${run ? `the run of ${K.maxRun + 1} at ${roofs[i]}` : `the window at ${lots[i].id} to ${want} heights`} (${whyNot.join("; ") || "no lot to raise"})`); // prettier-ignore
      }
      if (!fixed) break;
    }
  }
}

/** The lots of a face whose front lies within a window of `win` cells starting at lot i's. */
function windowOf(face, lots, i, win) {
  const t = (lt) => face.segs.find((s) => s.lot === lt).t0;
  const out = [];
  for (let j = 0; j < lots.length; j++) if (t(lots[j]) >= t(lots[i]) - EPS && t(lots[j]) < t(lots[i]) + win - EPS) out.push(j);
  return out;
}

/** A setback tier (F16) on a lot up to height z: its rock base set in from every street face. True, or why not. */
function setbackOn(P, lt, z) {
  const fx = P.fx;
  const T = fx.R.setback;
  const have = P.mine.filter((f) => f.kind === "setback" && f.on === lt.id);
  if (have.length >= fx.rules.forms.setback.maxTiers) return `${lt.id} has its ${have.length} tiers`;
  const b = [...lt.box];
  const inset = T.inset.min * (have.length + 1);
  for (const f of P.S.faces)
    for (const s of f.segs) {
      if (s.lot !== lt) continue;
      if (s.side === "s") b[1] = Math.max(b[1], lt.box[1] + inset);
      if (s.side === "n") b[3] = Math.min(b[3], lt.box[3] - inset);
      if (s.side === "w") b[0] = Math.max(b[0], lt.box[0] + inset);
      if (s.side === "e") b[2] = Math.min(b[2], lt.box[2] - inset);
    }
  if (b[2] - b[0] < 1 - EPS || b[3] - b[1] < 1 - EPS) return `${lt.id} is under a cell deep once set in from its street faces`;
  const z0 = have.length ? have[have.length - 1].top : lt.top;
  if (z <= z0 + EPS) return `${lt.id} is at z ${z0} already`;
  // M4: a mass on the deck stands on the layer below's rock or a building, not over its open floor, which the deck
  // spans (notes-megastructure.md M4: an L3 mass over a pier or an L2 building). A layer whose floor is the rock over
  // a vault (L2 in the ring, over the undercity) carries its tier on the lot's own rock, which stands there already.
  const below = fx.layers.find((x) => x.level === lt.L.level - 1);
  const c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  if (below && below.ceiling === "deck" && floorAt(fx, below.id, c)) return `${lt.id}'s tier would stand over ${below.id}'s open floor (${floorAt(fx, below.id, c).id})`;
  const pt = part("prism", boxPoly(b), [z0, z], { what: `tier ${have.length + 1}`, build: "world", embeds: true });
  const fl = faultsOf(P, pt, { layer: lt.layer });
  if (fl.length) return `${lt.id}'s tier to z ${z} enters ${fl[0]}`;
  push(P, { id: `facade.setback.${lt.id}.${have.length + 1}`, form: "F16", kind: "setback", layer: lt.layer, build: "world", role: roleOf(lt, "wall"), palette: lt.district, on: lt.id, tier: have.length + 1, top: r3(z), inset: r3(inset), at: c.map(r3), parts: [pt] }); // prettier-ignore
  return true;
}

// ── M10: corners ──

/** The convex block corners on public floor at nodes in the tile: [{ id, layer, at, lot, sides: [s1, s2], node, ways }]. */
export function cornersOf(fx) {
  const S = sceneOf(fx);
  const out = [];
  const reach = fx.R.corner.reach.max;
  for (const lt of S.lots) {
    const b = lt.box;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const c = [sx < 0 ? b[0] : b[2], sy < 0 ? b[1] : b[3]];
      const diag = floorAt(fx, lt.layer, [c[0] + sx * 0.3, c[1] + sy * 0.3]);
      const ex = floorAt(fx, lt.layer, [c[0] + sx * 0.3, c[1] - sy * 0.3]);
      const ey = floorAt(fx, lt.layer, [c[0] - sx * 0.3, c[1] + sy * 0.3]);
      if (!diag || !ex || !ey) continue;
      const owners = [...new Set([diag.id, ex.id, ey.id])];
      const ways = owners.map((id) => fx.site.ways.find((w) => w.id === id)).filter(Boolean);
      const plaza = owners.find((id) => fx.site.plazas.some((q) => q.id === id));
      if (!plaza && ways.length && ways.every((w) => w.class === "alley" || w.class === "service")) continue;
      // the node: the plaza, else the nearest junction of the layer within reach (past the ways' half widths)
      let node = plaza ?? null;
      if (!node) {
        const near = (fx.site.nodes ?? []).filter((n) => n.layer === lt.layer && n.kind !== "service").map((n) => ({ n, d: dist(n.at, c) })).sort((p, q) => p.d - q.d)[0]; // prettier-ignore
        const half = Math.max(0, ...ways.map((w) => w.width / 2));
        if (near && near.d <= half + reach) node = near.n.id;
        else if (owners.length >= 2) node = owners.slice().sort().join("+");
      }
      if (!node) continue;
      const sides = [sx < 0 ? "w" : "e", sy < 0 ? "s" : "n"];
      // the corners that must differ: a junction's; at a plaza, those flanking one way's mouth (a lot standing free in
      // a plaza keeps its own corners alike: a monument's symmetry)
      const wayIds = ways.map((w) => w.id).sort();
      const probe = boxPoly([Math.min(c[0], c[0] + sx * 0.75), Math.min(c[1], c[1] + sy * 0.75), Math.max(c[0], c[0] + sx * 0.75), Math.max(c[1], c[1] + sy * 0.75)]); // prettier-ignore
      const masked = fx.solids.find((sd) => ["hallway", "connector", "checkpoint", "post"].includes(sd.kind) && zMeet(sd.z, [lt.z0, lt.top]) > 0.25 && polyOverlap(probe, sd.poly) > 0.01); // prettier-ignore
      const wide = boxPoly([Math.min(c[0] - sx, c[0] + sx * 0.75), Math.min(c[1] - sy, c[1] + sy * 0.75), Math.max(c[0] - sx, c[0] + sx * 0.75), Math.max(c[1] - sy, c[1] + sy * 0.75)]); // prettier-ignore
      // or by a form of another family over it (an arcade's arch, a gantry)
      const over = masked ? null : (fx.placed ?? []).find((g) => g.family !== "facade" && g.layer === lt.layer && (g.parts ?? []).some((q) => q.build !== "cut" && zMeet(q.z, [lt.z0, lt.top]) > 0.25 && polyOverlap(wide, q.poly) > 0.01)); // prettier-ignore
      const group = plaza ? `${node}|${wayIds.length ? wayIds.join("+") : lt.id}` : node;
      out.push({ id: `${lt.id}.${sides.join("")}`, layer: lt.layer, at: c, lot: lt, sx, sy, sides, node, group, owners, masked: masked?.what ?? over?.id ?? null });
    }
  }
  return out.sort((p, q) => (p.node < q.node ? -1 : p.node > q.node ? 1 : p.id < q.id ? -1 : 1));
}

/** A corner's treatment by an enterable building's street door within a cell: its entrance. */
function entranceAt(fx, cn) {
  const lt = cn.lot;
  if (!lt.enterable || !lt.plan) return null;
  return (lt.plan.doors ?? []).find((d) => d.street && d.cells && dist(d.cells, cn.at) <= 1.25) ?? null;
}

function corners(P) {
  const { fx, out } = P;
  const C = fx.R.corner;
  const h = fx.storey;
  const byNode = new Map();
  for (const cn of cornersOf(fx)) (byNode.get(cn.group) ?? byNode.set(cn.group, []).get(cn.group)).push(cn);
  for (const [, list] of byNode) {
    const used = new Map();
    for (const cn of list) {
      const lt = cn.lot;
      const node = cn.node;
      if (entranceAt(fx, cn)) continue;
      const th = themeOf(fx, lt.wealth);
      const mine = lt.msr ? ["buttress", "quoin"] : th.corners;
      const order = mine.filter((x) => !used.has(x) || used.get(x) === lt.id);
      let got = null;
      const why = [];
      // each piece full height, then raised over the street zones' head (a way's mouth), then in the ground storey only
      for (const tr of order) {
        for (const v of [0, 1, 2]) {
          const parts = cornerParts(fx, cn, tr, C, h, lidOf(fx, lt), v);
          if (!parts) continue;
          const fl = parts.flatMap((pt) => faultsOf(P, pt, { layer: lt.layer }));
          if (fl.length) {
            if (v === 0) why.push(`${tr}: ${fl[0]}`);
            continue;
          }
          got = { tr, parts, v };
          break;
        }
        if (got) break;
      }
      // where none stood as they are: a turret or drum slid a quarter cell along a face (off a way's mouth that
      // grazes the corner), quoins from over the street's furniture against the corner (a bench, a bin: stage 8's)
      // (only where M10 wants a piece: a corner something passes over needs none)
      for (const tr of got || cn.masked ? [] : order) {
        for (const sh of tr === "turret" || tr === "drum" ? [[-cn.sx * 0.125, 0], [0, -cn.sy * 0.125], [-cn.sx * 0.25, 0], [0, -cn.sy * 0.25]] : tr === "quoin" ? [null] : []) {
          const parts = sh ? cornerParts(fx, cn, tr, C, h, lidOf(fx, lt), 0, sh) : cornerParts(fx, cn, tr, C, h, lidOf(fx, lt), 3);
          if (!parts) continue;
          if (parts.flatMap((pt) => faultsOf(P, pt, { layer: lt.layer })).length) continue;
          got = { tr, parts, v: sh ? 0 : 3 };
          break;
        }
        if (got) break;
      }
      if (!got) {
        out.notes.push(`corner ${cn.id} at ${node}${cn.masked ? ` (masked by ${cn.masked})` : ""}: no corner piece stood (${why.slice(0, 2).join("; ") || "none of its theme left"})`);
        continue;
      }
      used.set(got.tr, lt.id);
      push(P, { lotRef: lt, id: `facade.corner.${cn.id}`, form: "F17", kind: "corner", layer: lt.layer, role: roleOf(lt, got.tr === "pier" ? (lt.wealth === "elite" ? "gold" : "pillar") : "trim"), palette: lt.district, on: lt.id, node, corner: cn.id, treatment: got.tr, variant: ["full", "raised", "ground storey", "over the street's furniture"][got.v], at: cn.at.map(r3), parts: got.parts }); // prettier-ignore
    }
  }
}

/** The parts of a corner treatment at a lot's corner: turret (8-sided), drum (12), pier with its capital, quoins. */
function cornerParts(fx, cn, tr, C, h, lid, v = 0, shift = [0, 0]) {
  const lt = cn.lot;
  const c = cn.at;
  const top = Math.min(lt.top, lid);
  const rTop = reliefTop(fx, lt);
  const head = lt.L.floor + ZONE_HEAD;
  if (tr === "turret" || tr === "drum") {
    if (v === 2 || (lt.storeys < 2 && top - lt.z0 < 2 * h - EPS)) return null;
    const r = C.turret.across.min / 2;
    const n = tr === "turret" ? 8 : 12;
    // centred a quarter of its width out of the corner, corbelled from the ground storey's head (raised: over the
    // street zones' head, rising a cell over it at least)
    const cc = [c[0] + cn.sx * r * 0.5 + shift[0], c[1] + cn.sy * r * 0.5 + shift[1]];
    const zc = v === 1 ? Math.max(lt.z0 + h, head + C.turret.corbel.typical) : lt.z0 + h;
    if (v === 1 && zc <= lt.z0 + h + EPS) return null;
    const capTop = Math.min(Math.max(top + C.turret.cap.typical, zc + 1), lid - 0.125);
    if (capTop - zc < 0.75) return null;
    const parts = [
      part("frustum", ngon(cc, 0.25, n), [zc - C.turret.corbel.typical, zc], { what: "corbel", top: ngon(cc, r, n), embeds: true }),
      part("prism", ngon(cc, r, n), [zc, capTop], { what: "turret", embeds: true }),
    ];
    return parts;
  }
  if (tr === "pier") {
    const w = C.pier.width.typical;
    const o = C.pier.projection.typical;
    const bx = [Math.min(c[0] - cn.sx * (w - o), c[0] + cn.sx * o), Math.min(c[1] - cn.sy * (w - o), c[1] + cn.sy * o), Math.max(c[0] - cn.sx * (w - o), c[0] + cn.sx * o), Math.max(c[1] - cn.sy * (w - o), c[1] + cn.sy * o)]; // prettier-ignore
    if (lt.enterable || v === 1) return null; // never into a building's wall; a pier stands on the ground
    const capH = C.pier.capital.typical;
    const pTop = v === 2 ? lt.z0 + h : rTop;
    if (pTop - capH - lt.z0 < 0.75) return null;
    return [
      part("prism", boxPoly(bx), [lt.z0, pTop - capH], { what: "corner pier", embeds: true }),
      part("frustum", boxPoly(bx), [pTop - capH, pTop], { what: "capital", top: boxPoly([bx[0] - 0.0625, bx[1] - 0.0625, bx[2] + 0.0625, bx[3] + 0.0625]), embeds: true }), // prettier-ignore
    ];
  }
  if (tr === "buttress") {
    // an angle buttress outside the corner, on the diagonal: a foot and a slope back to the wall
    if (v === 1) return null;
    const d = C.quoin.length.typical * 0.75;
    const bx = [Math.min(c[0], c[0] + cn.sx * d), Math.min(c[1], c[1] + cn.sy * d), Math.max(c[0], c[0] + cn.sx * d), Math.max(c[1], c[1] + cn.sy * d)]; // prettier-ignore
    const zt = v === 2 ? lt.z0 + h : rTop;
    const lower = lt.z0 + (zt - lt.z0) * 0.55;
    if (zt - lt.z0 < 1) return null;
    return [part("box", boxPoly(bx), [lt.z0, lower], { what: "angle buttress" }), part("frustum", boxPoly(bx), [lower, zt], { what: "its slope", top: boxPoly([Math.min(c[0], c[0] + cn.sx * 0.25), Math.min(c[1], c[1] + cn.sy * 0.25), Math.max(c[0], c[0] + cn.sx * 0.25), Math.max(c[1], c[1] + cn.sy * 0.25)]) })]; // prettier-ignore
  }
  if (tr === "quoin") {
    const q = C.quoin.depth.typical;
    const l = C.quoin.length.typical;
    // two long blocks, one on each face, meeting at the corner
    const a = [Math.min(c[0], c[0] - cn.sx * l), Math.min(c[1], c[1] + cn.sy * q), Math.max(c[0], c[0] - cn.sx * l), Math.max(c[1], c[1] + cn.sy * q)]; // prettier-ignore
    const b = [Math.min(c[0], c[0] + cn.sx * q), Math.min(c[1] + cn.sy * q, c[1] - cn.sy * (l - q)), Math.max(c[0], c[0] + cn.sx * q), Math.max(c[1] + cn.sy * q, c[1] - cn.sy * (l - q))]; // prettier-ignore
    // v 3: from over the street props standing against the corner (their tops, a sixteenth over)
    const over = () => {
      const tops = fx.solids.filter((sd) => sd.kind === "prop" && sd.layer === lt.layer && [a, b].some((bx) => polyOverlap(boxPoly(bx), sd.poly) > 0.01)).map((sd) => sd.z[1]);
      return tops.length ? Math.ceil(Math.max(...tops) * 16) / 16 + 0.0625 : null;
    };
    const z = v === 0 ? [lt.z0, rTop] : v === 1 ? [head, rTop] : v === 2 ? [lt.z0, lt.z0 + h] : [over(), rTop];
    if (z[0] === null || z[1] - z[0] < 0.75) return null;
    return [part("box", boxPoly(a), z, { what: "quoin" }), part("box", boxPoly(b), z, { what: "quoin" })]; // prettier-ignore
  }
  return null;
}

// ── F18 wall-run pipes along the poor fronts under a vault and in industry ──

function wallRuns(P) {
  const { fx, S } = P;
  const W = fx.R.wallServices;
  const wealth = new Set(fx.rules.forms.wallServices.wealth ?? []);
  for (const face of S.faces) {
    const lots = face.segs.filter((s) => wealth.has(s.lot.wealth) && ceilingOf(fx, s.lot) === "vault");
    if (lots.length < 2) continue;
    const z0 = Math.min(...lots.map((s) => s.lot.z0)) + fx.storey - W.pipe.typical - 0.125;
    const z = [z0, z0 + W.pipe.typical];
    if (lots.some((s) => s.lot.top < z[1] + 0.25)) continue;
    // one run a stretch of touching segments, a brush every forms.wallServices.run.max
    let a = lots[0].t0;
    let b = lots[0].t1;
    const runs = [];
    for (const s of lots.slice(1)) {
      if (s.t0 - b <= 0.05) b = s.t1;
      else (runs.push([a, b]), (a = s.t0), (b = s.t1));
    }
    runs.push([a, b]);
    for (const [r0, r1] of runs) {
      const n = Math.ceil((r1 - r0) / W.run.max - EPS);
      for (let k = 0; k < n; k++) {
        const t0 = r0 + ((r1 - r0) * k) / n + 0.125;
        const t1 = r0 + ((r1 - r0) * (k + 1)) / n - 0.125;
        if (t1 - t0 < 1) continue;
        if (optionalRoom(P) < 1) {
          P.out.notes.push(`wall-run pipe on ${face.id}: left out, the tile has no brush left under its limit`);
          continue;
        }
        const pt = part("octagon-run", boxPoly(faceBox(face.side, face.line, t0, t1, 0, W.pipe.typical)), z, { what: "wall-run pipe" });
        const fl = faultsOf(P, pt, { layer: face.layer, ignoreForms: (g) => g.kind === "pipe" });
        if (fl.length) {
          P.out.notes.push(`wall-run pipe on ${face.id} ${r3(t0)}-${r3(t1)}: left out (${fl[0]})`);
          continue;
        }
        const lt = face.segs.find((s) => s.t1 > (t0 + t1) / 2 && s.t0 <= (t0 + t1) / 2)?.lot ?? lots[0].lot;
        push(P, { id: `facade.run.${face.id}.${k}`, form: "F18", kind: "pipe", layer: face.layer, role: lt.palette.trim?.find((r) => /pipe|steel|rust/.test(r)) ?? roleOf(lt, "trim"), palette: lt.district, on: face.id, face: face.id, side: face.side, at: facePt(face.side, face.line, (t0 + t1) / 2, 0).map(r3), runs: 1, drops: 0, parts: [pt] }); // prettier-ignore
      }
    }
  }
}

// ── F14 galleries round a poor dense district's court (the Stacks' light well as an atrium) ──

function galleries(P) {
  const { fx, S, out } = P;
  const G = fx.R.gallery;
  const wealth = new Set(fx.rules.forms.gallery.wealth ?? []);
  const dens = new Set(fx.rules.forms.gallery.densities ?? []);
  const courts = fx.site.plazas.filter((q) => q.tile === fx.tile.id && /court/i.test(q.name ?? q.id) && (() => { const d = S.districts.get(q.district ?? fx.site.nodes?.find((n) => n.id === q.id)?.district); return d && wealth.has(d.wealth) && dens.has(d.density); })()); // prettier-ignore
  const parH = Math.ceil(fx.rules.dimensions.parapets.height.min / 0.0254) / fx.cu;
  const parT = Math.max(0.0625, Math.ceil((fx.rules.dimensions.parapets.thickness.min / fx.cell) * 16) / 16);
  for (const q of courts) {
    let n = 0;
    for (const face of S.faces) {
      if (!face.on.includes(q.id)) continue;
      for (const seg of face.segs) {
        const lt = seg.lot;
        for (let st = 1; st < lt.storeys; st++) {
          const zf = lt.z0 + st * fx.storey;
          const parts = [
            part("box", boxPoly(faceBox(face.side, face.line, seg.t0, seg.t1, 0, G.depth.typical)), [zf - 0.125, zf], { what: "gallery slab" }),
            part("box", boxPoly(faceBox(face.side, face.line, seg.t0, seg.t1, G.depth.typical - parT, G.depth.typical)), [zf, zf + parH], { what: "gallery rail" }),
          ];
          const fl = parts.flatMap((pt) => faultsOf(P, pt, { layer: lt.layer }));
          if (fl.length) {
            out.notes.push(`gallery of ${lt.id} storey ${st} on ${q.id}: left out (${fl[0]})`);
            continue;
          }
          push(P, { lotRef: lt, id: `facade.gallery.${lt.id}.${face.side}${st}`, form: "F14", kind: "gallery", layer: lt.layer, role: roleOf(lt, "trim"), palette: lt.district, on: q.id, lot: lt.id, storey: st, face: face.id, side: face.side, at: facePt(face.side, face.line, (seg.t0 + seg.t1) / 2, 0).map(r3), parts }); // prettier-ignore
          n++;
        }
      }
    }
    out.notes.push(`court ${q.id}: ${n} galleries round it (a megablock's atrium)`);
  }
}

// ── the fixers: M9's major and band elements, then M8's long stretches ──

function fixRelief(P) {
  const { fx, S, out } = P;
  const h = fx.storey;
  const Fm = fx.rules.forms.facade;
  const band = cellsOf(fx, Fm.bandRelief.min);
  const major = cellsOf(fx, Fm.major.min);
  const all = () => [...P.placed, ...P.mine];
  for (const lt of S.lots) {
    const fr = frontOf(P, lt);
    if (!fr) continue;
    const { face, seg } = fr;
    const base = { lotRef: lt, layer: lt.layer, palette: lt.district, on: lt.id, face: face.id, side: face.side };
    const poor = lt.wealth === "slum" || lt.wealth === "low";
    const relief = () => reliefOn(face, all()).filter((r) => Math.min(r.t1, seg.t1) - Math.max(r.t0, seg.t0) >= 0.125 - EPS && r.depth >= band - EPS);
    const topZ = reliefTop(fx, lt);
    const len = seg.t1 - seg.t0;
    // the major element (a front narrower than it shows the street too little: a note)
    const masked = maskedShare(fx, face, seg, [lt.z0, Math.min(lt.top, lidOf(fx, lt))]) >= 0.5;
    if (len >= major - EPS && masked) out.notes.push(`M9: ${lt.id}'s front is masked by what passes along it or keeps clear before it (half or more): no major element wanted`); // prettier-ignore
    else if (len >= major - EPS && !relief().some((r) => r.width >= major - EPS || r.depth >= major - EPS)) {
      const w = Math.min(fx.R.pilaster.width.typical, seg.t1 - seg.t0);
      let made = null;
      if (w >= major - EPS) {
        const giant = (z0 = lt.z0) => tryAlong(P, face, lt, (seg.t0 + seg.t1) / 2, w, (tc) => [part("box", boxPoly(faceBox(face.side, face.line, tc - w / 2, tc + w / 2, 0, fx.R.pilaster.depth.typical)), [z0, topZ], { what: "giant pilaster" })], { span: [seg.t0, seg.t1] }); // prettier-ignore
        let got = giant();
        // the least width that is a major element (on the 16-unit grid), at either end of the front, where the full
        // width stands nowhere (a door's approach and the street's props along the rest of it)
        const wm = Math.ceil(major * 16 - 1e-9) / 16;
        if (!got.parts && wm < w - EPS) {
          const why = got.why;
          const mid = (seg.t0 + seg.t1) / 2;
          const ends = [seg.t0 + wm / 2 - mid, seg.t1 - wm / 2 - mid];
          got = tryAlong(P, face, lt, mid, wm, (tc) => [part("box", boxPoly(faceBox(face.side, face.line, tc - wm / 2, tc + wm / 2, 0, fx.R.pilaster.depth.typical)), [lt.z0, topZ], { what: "giant pilaster" })], { span: [seg.t0, seg.t1], deltas: [...spread(mid, wm, [seg.t0, seg.t1]), ...ends] }); // prettier-ignore
          if (got.parts) got.width = wm;
          else got.why = why;
        }
        // a narrow front its own drop pipe fills: the giant pilaster instead (its pattern becomes the pier)
        const own = P.mine.filter((x) => x.on === lt.id && ((x.kind === "pipe" && x.pattern === "drop") || (x.kind === "pilaster" && x.pattern === "pier" && !/.major$/.test(x.id))));
        const swap = own.length > 0;
        let swapped = false;
        if (!got.parts && swap) {
          for (const x of own) P.mine.splice(P.mine.indexOf(x), 1);
          got = giant();
          if (!got.parts) P.mine.push(...own);
          else swapped = true;
        }
        // a front the street's props line (stage 8's benches and bins against the wall, where no deck pier stands
        // for its major element: the ring under the sky): the giant order from the first floor up, as a bay is
        const upper = lt.z0 + h;
        if (!got.parts && lt.storeys >= 2 && topZ - upper >= 1 - EPS) {
          const first = got.why;
          got = giant(upper);
          if (!got.parts && swap) {
            for (const x of own) P.mine.splice(P.mine.indexOf(x), 1);
            got = giant(upper);
            if (!got.parts) P.mine.push(...own);
            else swapped = true;
          }
          if (!got.parts) got.why = `${first}; from the first floor up: ${got.why}`;
        }
        // a fused front the deck's fusion fills over its top storey (cages, a corbel course: the full mode on a
        // narrow front): the giant order stops under the band, as it stops under a cornice
        const fusedAt = [...new Set(P.placed.filter((f) => f.kind === "fusion" && f.lot === lt.lot?.id).flatMap((f) => f.parts.map((q) => q.z[0])))].filter((z) => z < topZ - EPS && z - lt.z0 >= 2 * h - EPS).sort((a, b) => b - a); // prettier-ignore
        for (const z1 of fusedAt) {
          if (got.parts) break;
          const why = got.why;
          got = tryAlong(P, face, lt, (seg.t0 + seg.t1) / 2, w, (tc) => [part("box", boxPoly(faceBox(face.side, face.line, tc - w / 2, tc + w / 2, 0, fx.R.pilaster.depth.typical)), [lt.z0, z1], { what: "giant pilaster" })], { span: [seg.t0, seg.t1] }); // prettier-ignore
          if (!got.parts) got.why = `${why}; under the fusion band at z ${z1}: ${got.why}`;
        }
        if (got.parts) made = push(P, { ...base, id: `facade.pilaster.${lt.id}.major`, form: "F13", kind: "pilaster", role: roleOf(lt, lt.wealth === "elite" || lt.wealth === "high" ? "pillar" : "trim"), at: facePt(face.side, face.line, got.t, 0).map(r3), width: r3(got.width ?? w), depth: fx.R.pilaster.depth.typical, pattern: "pier", parts: got.parts }); // prettier-ignore
        else out.notes.push(`M9: ${lt.id} has no major element and none stood (${got.why})`);
        // its pattern became the pier after the chooser kept M11 with it: held again once the fronts are done (place)
        if (made && swapped) (P.swapped ??= []).push({ lt, face: fr.face, seg: fr.seg });
      }
      void made;
    } else if (len < major - EPS) out.notes.push(`M9: ${lt.id}'s street front is ${r3(len)} cells, narrower than a major element (${r3(major)}): only its storeys' relief is held`);
    // every storey band
    for (let s = 0; s < lt.storeys; s++) {
      const zb = [lt.z0 + s * h, Math.min(lt.z0 + (s + 1) * h, Math.min(lt.top, lidOf(fx, lt)))];
      if (zb[1] - zb[0] < 0.25 || len < 0.375 - EPS) continue;
      if (relief().some((r) => inBand(r.z, zb))) continue;
      if (maskedShare(fx, face, seg, zb) >= 0.5) {
        out.notes.push(`M9: ${lt.id} storey ${s}: its front is masked by what passes along it (half or more), no relief wanted`);
        continue;
      }
      // a lesene from this band to the top (a drop pipe on the poor fronts)
      const t = (seg.t0 + seg.t1) / 2 + 0.75;
      const span = [seg.t0, seg.t1];
      if (poor && dropKeepsMassing(P, lt)) {
        if (dropPipe(P, face, lt, t, span, base, "M9", zb[0])) continue;
      }
      const w = fx.R.pilaster.lesene.typical;
      let got = null;
      // to the top, else through the band, else through its lower half (under what passes along the wall's head in
      // the band: a vault's chamfer over an alley, its lower edge 0.75 cell up)
      for (const z1 of [topZ, Math.min(topZ, zb[1]), Math.min(topZ, zb[0] + (zb[1] - zb[0]) / 2)]) {
        if (z1 - zb[0] < 0.5) continue;
        got = tryAlong(P, face, lt, t, w, (tc) => [part("box", boxPoly(faceBox(face.side, face.line, tc - w / 2, tc + w / 2, 0, fx.R.pilaster.depth.typical)), [zb[0], z1], { what: "lesene" })], { span }); // prettier-ignore
        if (got.parts) break;
      }
      got ??= { parts: null, why: "the band too low" };
      if (got.parts) push(P, { ...base, id: `facade.lesene.${lt.id}.${s}`, form: "F13", kind: "pilaster", role: roleOf(lt, "trim"), at: facePt(face.side, face.line, got.t, 0).map(r3), width: r3(w), depth: fx.R.pilaster.depth.typical, pattern: "lesene", parts: got.parts }); // prettier-ignore
      else out.notes.push(`M9: ${lt.id} storey ${s}: no element stood (${got.why})`);
    }
  }
  // M8: a lesene (a drop pipe) in each stretch too long
  for (const face of S.faces) {
    for (const band of ["ground", "upper"]) {
      const max = band === "ground" ? fx.R.facade.unbroken.ground.max : fx.R.facade.unbroken.upper.max;
      for (let guard = 0; guard < 12; guard++) {
        const long = stretchesOf(fx, face, reliefOn(face, all()), band).find((s) => s.len > max + EPS);
        if (!long) break;
        const k = Math.ceil(long.len / max - EPS) - 1;
        let placed = false;
        for (let i = 1; i <= k; i++) {
          const t = long.t0 + (i * long.len) / (k + 1);
          const seg = face.segs.find((s) => s.t0 <= t + EPS && s.t1 >= t - EPS);
          if (!seg) continue;
          const lt = seg.lot;
          const base = { lotRef: lt, layer: lt.layer, palette: lt.district, on: lt.id, face: face.id, side: face.side };
          const topZ = reliefTop(fx, lt);
          const z0 = lt.z0;
          const w = fx.R.pilaster.lesene.typical;
          if ((lt.wealth === "slum" || lt.wealth === "low") && dropKeepsMassing(P, lt) && dropPipe(P, face, lt, t, [long.t0 + 0.25, long.t1 - 0.25], base, "M8")) {
            placed = true;
            continue;
          }
          // to the lot's top, else through the stretch's band alone (over the ground storey a bay or a loggia may stand)
          const lesAt = (zz) => tryAlong(P, face, lt, t, w, (tc) => [part("box", boxPoly(faceBox(face.side, face.line, tc - w / 2, tc + w / 2, 0, fx.R.pilaster.depth.typical)), zz, { what: "lesene" })], { span: [Math.max(long.t0, seg.t0) + 0.25, Math.min(long.t1, seg.t1) - 0.25] }); // prettier-ignore
          let got = lesAt([z0, topZ]);
          const bandZ = band === "ground" ? [z0, Math.min(topZ, z0 + fx.storey - 0.125)] : [z0 + fx.storey, topZ];
          if (!got.parts && bandZ[1] - bandZ[0] >= 0.5 && (bandZ[0] !== z0 || bandZ[1] !== topZ)) {
            const why = got.why;
            got = lesAt(bandZ);
            if (!got.parts) got.why = why;
          }
          if (got.parts) {
            push(P, { ...base, id: `facade.lesene.${lt.id}.m8.${say(got.t)}`, form: "F13", kind: "pilaster", role: roleOf(lt, "trim"), at: facePt(face.side, face.line, got.t, 0).map(r3), width: r3(w), depth: fx.R.pilaster.depth.typical, pattern: "lesene", parts: got.parts }); // prettier-ignore
            placed = true;
          } else out.notes.push(`M8: face ${face.id} ${band} stretch ${long.t0}-${long.t1}: no lesene stood at ${r3(t)} (${got.why})`);
        }
        if (!placed) break;
      }
    }
  }
}

// ── the walk: a standing form that cuts it goes ──

function keepWalks(P) {
  const { fx, out } = P;
  for (const L of fx.layers) {
    for (let guard = 0; guard < 40; guard++) {
      const standing = P.mine.filter((f) => f.parts.some((p) => p.build !== "cut" && p.build !== "entity" && p.z[0] < L.floor + HULL_HEAD && p.z[1] > L.floor + 0.14)); // prettier-ignore
      if (!standing.length) break;
      const br = walkBreaks(fx, L.id, [...P.placed, ...standing]);
      if (!br.length) break;
      const mid = [(br[0].a.p[0] + br[0].b.p[0]) / 2 / fx.cell, (br[0].a.p[1] + br[0].b.p[1]) / 2 / fx.cell];
      const victim = standing.reduce((m, f) => (dist(f.at, mid) < dist(m.at, mid) ? f : m), standing[0]);
      // raised over the hull's head where it stays tall enough (a drop pipe to a hopper, a lesene on a corbel), else out
      const head = L.floor + HULL_HEAD;
      const parts = victim.parts.flatMap((p) => (p.z[0] < head - 1e-6 && p.z[1] > L.floor + 0.14 ? (p.z[1] - head >= 0.5 ? [{ ...p, z: [r3(head), p.z[1]], what: `${p.what ?? p.shape} (over the walk)` }] : []) : [p])); // prettier-ignore
      const i = P.mine.indexOf(victim);
      if (parts.length) {
        const again = instance({ ...victim, parts, raised: true });
        if (victim.allowance) again.allowance = Math.min(victim.allowance, again.brushes);
        P.mine[i] = again;
        out.notes.push(`walk on ${L.id}: ${victim.id} raised over the hull's head (${br[0].a.what} and ${br[0].b.what} were cut apart)`);
        continue;
      }
      P.mine.splice(i, 1);
      if (victim.allowanceOf?.kind === "facade") P.allowance.set(victim.allowanceOf.building, (P.allowance.get(victim.allowanceOf.building) ?? 0) - victim.allowance); // prettier-ignore
      out.notes.push(`walk on ${L.id}: ${victim.id} taken out (${br[0].a.what} and ${br[0].b.what} were cut apart)`);
    }
  }
}

// ── its checks (the gate runs them again on the artifact's forms) ──

function check(forms, fx) {
  const failures = [];
  const notes = [];
  const S = sceneOf(fx);
  const Fm = fx.rules.forms;
  const h = fx.storey;
  // every form of the artifact (the gate hands them as fx.placed), ours among them
  const every = [...(fx.placed ?? []).filter((f) => f.family !== 'facade'), ...forms];
  const band = cellsOf(fx, Fm.facade.bandRelief.min);
  const major = cellsOf(fx, Fm.facade.major.min);
  const trim = cellsOf(fx, Fm.facade.trim.min);
  // each form on its district's palette (not the frame's); a form on no lot of the tile
  for (const f of forms) {
    if (f.frame) failures.push(`form ${f.id}: a facade form wears its district's palette, not the frame (frame: true)`);
    const d = S.districts.get(f.palette);
    const roles = d ? Object.values(d.palette ?? {}).flat() : null;
    if (f.role && roles && !roles.includes(f.role)) failures.push(`form ${f.id}: wears "${f.role}", not a role of district ${f.palette}'s palette`);
    for (const L of fx.layers) if (L.frame && f.role === L.frame) failures.push(`form ${f.id}: wears the frame's role "${f.role}" (M20: the frame's alone)`);
  }
  // M18 is the common check's; M19: a tier's top, a roof's height only from the tile-layer's carve heights
  for (const f of forms.filter((x) => x.kind === "setback")) {
    const hs = carveHeightsOf(fx, f.layer);
    if (!hs.some((z) => Math.abs(z - f.top) < 0.01)) failures.push(`M19: setback ${f.id} rises to z ${f.top}, no carve height of ${fx.tile.id}'s ${f.layer} (${hs.join(", ")})`); // prettier-ignore
    if (f.parts.some((p) => Math.abs(p.z[1] - f.top) > 0.01 && p.what?.startsWith("tier"))) failures.push(`M19: setback ${f.id}'s tier does not stop at its top z ${f.top}`);
    const lt = S.byId.get(f.on);
    if (lt) {
      const inset = Fm.setback.inset.min / fx.cell;
      for (const face of S.faces)
        for (const s of face.segs) {
          if (s.lot !== lt) continue;
          for (const p of f.parts) {
            const b = polyBox(p.poly);
            const off = s.side === "s" ? b[1] - s.line : s.side === "n" ? s.line - b[3] : s.side === "w" ? b[0] - s.line : s.line - b[2];
            if (off < inset * 0.875 - EPS) failures.push(`F16: setback ${f.id} stands ${r3(off)} cells from ${lt.id}'s ${s.side} street face, at least ${r3(inset)} (forms.setback.inset)`); // prettier-ignore
          }
        }
    }
  }
  // F27: capitals within the column's own top
  for (const f of forms.filter((x) => x.kind === "capital")) {
    const col = (fx.net.colonnades ?? []).find((c) => (c.ref ?? c.plaza) === f.on);
    if (!col) failures.push(`F27: capital ${f.id} on ${f.on}, which has no colonnade`);
    else if (Math.abs(f.parts[0].z[1] - col.z[1]) > 0.01) failures.push(`F27: capital ${f.id}'s top at z ${f.parts[0].z[1]}, not its column's top ${col.z[1]}`);
  }
  // F22: domes only under the sky, over a room of forms.dome.over
  for (const f of forms.filter((x) => x.kind === "dome")) {
    const L = fx.layerOf(f.layer);
    if (L.ceiling !== "sky") failures.push(`F22: dome ${f.id} on ${f.layer}, which is not under the sky`);
    if (!(Fm.dome.over ?? []).includes(f.overKind)) failures.push(`F22: dome ${f.id} over a ${f.overKind}, not one of forms.dome.over (${(Fm.dome.over ?? []).join(", ")})`);
  }
  // the parts of a facade form against every other form (the common check holds them against the stages before)
  for (const f of forms)
    for (const [i, p] of f.parts.entries()) {
      if (p.build === "cut") continue;
      for (const g of every) {
        if (g.id === f.id) continue;
        if (g.family === "facade" && g.id < f.id) continue;
        if (f.kind === "pipe" && g.kind === "pipe") continue; // a drop tees into a run
        for (const q of g.parts ?? []) {
          if (q.build === "cut" || zMeet(q.z, p.z) <= 0.01) continue;
          const d = polyOverlap(p.poly, q.poly);
          if (d > 0.01) {
            failures.push(`form ${f.id} part ${i} (${p.what ?? p.shape}) enters ${g.id} by ${r3(d)} cells`);
            break;
          }
        }
      }
    }
  // M8, M9 on every face of the tile
  for (const face of S.faces) {
    const relief = reliefOn(face, every);
    for (const r of relief.filter((x) => x.family === "facade" && x.depth < trim - EPS)) failures.push(`M9: ${r.form}'s ${r.what} stands ${r3(r.depth)} cells off face ${face.id}, at least ${r3(trim)} (forms.facade.trim: hlrad's 16-unit luxel)`); // prettier-ignore
    for (const bandName of ["ground", "upper"]) {
      const max = bandName === "ground" ? fx.R.facade.unbroken.ground.max : fx.R.facade.unbroken.upper.max;
      for (const s of stretchesOf(fx, face, relief, bandName)) if (s.len > max + EPS) failures.push(`M8: face ${face.id} (${face.on.join(", ")}) runs ${s.len} cells unbroken ${bandName === "ground" ? "in the ground storey" : "above the ground storey"} from ${s.t0} to ${s.t1} (${s.lots.join(", ")}), at most ${r3(max)}`); // prettier-ignore
    }
  }
  for (const lt of S.lots) {
    const fr = frontOfScene(S, lt);
    if (!fr) continue;
    const { face, seg } = fr;
    const rel = reliefOn(face, every).filter((r) => Math.min(r.t1, seg.t1) - Math.max(r.t0, seg.t0) >= 0.125 - EPS && r.depth >= band - EPS);
    const len = seg.t1 - seg.t0;
    if (len >= major - EPS && !rel.some((r) => r.width >= major - EPS || r.depth >= major - EPS) && maskedShare(fx, face, seg, [lt.z0, Math.min(lt.top, lidOf(fx, lt))]) < 0.5) failures.push(`M9: ${lt.id}'s front on face ${face.id} has no element ${r3(major)} cells wide or deep and ${r3(band)} deep (a giant pilaster, bay, cage, loggia, buttress or pier)`); // prettier-ignore
    const topZ = Math.min(lt.top, lidOf(fx, lt));
    for (let s = 0; s < lt.storeys; s++) {
      const zb = [lt.z0 + s * h, Math.min(lt.z0 + (s + 1) * h, topZ)];
      if (zb[1] - zb[0] < 0.25 || len < 0.375 - EPS) continue;
      if (!rel.some((r) => inBand(r.z, zb)) && maskedShare(fx, face, seg, zb) < 0.5) failures.push(`M9: ${lt.id}'s storey ${s} (z ${r3(zb[0])}-${r3(zb[1])}) on face ${face.id} has no element ${r3(band)} cells deep (forms.facade.bandRelief)`); // prettier-ignore
    }
  }
  // M10: a corner piece at every block corner at a node, none alike at one node
  const cs = cornersOf(fx);
  const byNode = new Map();
  for (const cn of cs) {
    const f = forms.find((x) => x.kind === "corner" && x.corner === cn.id);
    const tr = f ? f.treatment : entranceAt(fx, cn) ? "entrance" : null;
    if (!tr && cn.masked) {
      notes.push(`M10: block corner ${cn.id} at ${cn.node} is masked by ${cn.masked} passing over it: no corner piece wanted`);
      continue;
    }
    if (!tr) {
      failures.push(`M10: block corner ${cn.id} at ${cn.node} (on ${cn.owners.join(", ")}) has no corner treatment (turret, drum, pier, quoin, buttress or an entrance)`);
      continue;
    }
    (byNode.get(cn.group) ?? byNode.set(cn.group, []).get(cn.group)).push([cn.id, tr, cn.lot.id, cn.node]);
  }
  for (const [, list] of byNode) {
    const seen = new Map();
    for (const [id, tr, lot, node] of list) {
      const was = seen.get(tr);
      if (tr !== "entrance" && was && was[1] !== lot) failures.push(`M10: corners ${was[0]} and ${id} at ${node} are alike (${tr}): no two lots' corners at one junction, or flanking one mouth of a plaza, alike`); // prettier-ignore
      seen.set(tr, [id, lot]);
    }
  }
  if (cs.length) notes.push(`M10: ${cs.length} block corners at ${byNode.size} nodes, treated: ${Object.entries(cs.reduce((m, cn) => { const f = forms.find((x) => x.kind === "corner" && x.corner === cn.id); const k = f ? f.treatment : entranceAt(fx, cn) ? "entrance" : "none"; m[k] = (m[k] ?? 0) + 1; return m; }, {})).map(([k, v]) => `${k} ${v}`).join(", ")}`); // prettier-ignore
  // M11: neighbours differ, signatures repeat little
  const M = fx.R.massing;
  const traits = new Map();
  for (const lt of S.lots) traits.set(lt.id, traitsOfForms(fx, lt, forms));
  const pairs = new Set();
  for (const face of S.faces)
    for (let i = 1; i < face.segs.length; i++) {
      const [a, b] = [face.segs[i - 1].lot, face.segs[i].lot];
      if (a === b || Math.abs(face.segs[i].t0 - face.segs[i - 1].t1) > 0.05) continue;
      const key = [a.id, b.id].sort().join("|");
      if (pairs.has(key)) continue;
      pairs.add(key);
      const n = differ(traits.get(a.id), traits.get(b.id), M);
      if (n < Fm.massing.minDiffer) failures.push(`M11: ${a.id} and ${b.id} side by side on face ${face.id} differ in ${n} of roof height, roof form, cornice height, pattern and wall role, at least ${Fm.massing.minDiffer} (${signature(traits.get(a.id))} / ${signature(traits.get(b.id))})`); // prettier-ignore
    }
  const sigs = new Map();
  for (const [id, t] of traits) (sigs.get(signature(t)) ?? sigs.set(signature(t), []).get(signature(t))).push(id);
  const capN = Math.max(1, Math.floor(S.lots.length * Fm.massing.maxRepeatShare));
  for (const [sig, ids] of sigs) if (ids.length > capN) failures.push(`M11: ${ids.length} of the tile's ${S.lots.length} lots share one massing (${sig}: ${ids.slice(0, 4).join(", ")}...), at most ${Math.round(Fm.massing.maxRepeatShare * 100)} % (${capN})`); // prettier-ignore
  notes.push(`M11: ${pairs.size} pairs of neighbours, ${sigs.size} massings over ${S.lots.length} lots (the most repeated ${Math.max(0, ...[...sigs.values()].map((x) => x.length))}, at most ${capN}; city-wide by the tiles together)`); // prettier-ignore
  // M12: the skyline under the sky
  const K = Fm.skyline;
  const win = fx.R.skyline.window.max;
  for (const face of S.faces) {
    const lots = face.segs.map((s) => s.lot).filter((lt, i, a) => a.indexOf(lt) === i && ceilingOf(fx, lt) === "sky");
    if (lots.length < 2) continue;
    const roofs = lots.map((lt) => Math.max(lt.top, ...forms.filter((f) => f.kind === "setback" && f.on === lt.id).map((f) => f.top)));
    for (let i = K.maxRun; i < lots.length; i++) if (roofs.slice(i - K.maxRun, i + 1).every((x) => Math.abs(x - roofs[i]) < 0.01)) failures.push(`M12: ${K.maxRun + 1} lots in a row at roof z ${roofs[i]} on face ${face.id} (${lots.slice(i - K.maxRun, i + 1).map((x) => x.id).join(", ")}), at most ${K.maxRun}`); // prettier-ignore
    for (let i = 0; i < lots.length; i++) {
      const inWin = windowOf(face, lots, i, win);
      const want = Math.min(K.minHeights, inWin.length);
      const n = new Set(inWin.map((j) => roofs[j])).size;
      if (n < want) failures.push(`M12: face ${face.id} has ${n} roof heights in the ${r3(win)} cells from ${lots[i].id} (${inWin.map((j) => `${lots[j].id} ${roofs[j]}`).join(", ")}), at least ${want}`); // prettier-ignore
    }
  }
  // M13: landmarks
  landmarkChecks(fx, forms, failures, notes);
  return { failures, notes };
}

/** The front of a lot from the scene alone (the check has no placer's state). */
function frontOfScene(S, lt) {
  let best = null;
  for (const f of S.faces)
    for (const s of f.segs) {
      if (s.lot !== lt) continue;
      const score = (s.side === lt.front ? 1000 : 0) + (s.t1 - s.t0);
      if (!best || score > best.score) best = { face: f, seg: s, score };
    }
  return best;
}

/** A lot's massing traits read back from the forms (M11). */
function traitsOfForms(fx, lt, forms) {
  const mine = forms.filter((f) => f.on === lt.id);
  const roof = mine.find((f) => f.kind === "roofline" || (f.kind === "pipe" && f.roofForm));
  const pat = mine.find((f) => f.pattern && f.pattern !== "lesene" && !/\.major$/.test(f.id));
  const top = Math.max(lt.top, ...mine.filter((f) => f.kind === "setback").map((f) => f.top));
  const t = traitsOf(fx, lt, pat?.pattern ?? (mine.some((f) => /\.major$/.test(f.id)) ? "pier" : "plain"), roof?.roofForm ?? (ceilingOf(fx, lt) === "fused" ? "plain" : "none"));
  t.roof = top;
  return t;
}

function landmarkChecks(fx, forms, failures, notes) {
  const S = sceneOf(fx);
  const Lm = fx.rules.forms.landmark;
  const top = Math.max(...fx.layers.map((L) => L.level));
  const L3 = fx.layers.find((L) => L.level === top);
  if (!L3) return;
  const towers = (fx.desc.buildings ?? []).filter((b) => b.tower && (b.layer ?? S.districts.get(b.district)?.layer) === L3.id);
  // a silhouette kind at most once a layer (the description's towers, the domes and crowns placed)
  const kinds = new Map();
  for (const b of towers) (kinds.get(b.tower.silhouette) ?? kinds.set(b.tower.silhouette, []).get(b.tower.silhouette)).push(b.id);
  for (const f of forms.filter((x) => x.kind === "dome" && x.layer === L3.id)) (kinds.get("dome") ?? kinds.set("dome", []).get("dome")).push(f.on);
  for (const [k, ids] of kinds) if (ids.length > 1) failures.push(`M13: ${ids.length} landmarks of silhouette "${k}" on ${L3.id} (${ids.join(", ")}), each kind at most once a layer`);
  for (const d of S.districts.values()) {
    if (d.layer !== L3.id || !d.area) continue;
    const c = [(d.area[0] + d.area[2]) / 2, (d.area[1] + d.area[3]) / 2];
    if (!inBox(c, fx.tile.box)) continue;
    const lots = S.lots.filter((x) => x.district === d.id && x.layer === L3.id).map((x) => x.top).sort((a, b) => a - b);
    const median = lots.length ? lots[Math.floor(lots.length / 2)] : L3.floor;
    const want = median + Lm.minStoreysOver * fx.storey;
    const tw = towers.filter((b) => b.district === d.id).map((b) => ({ id: b.id, top: fx.layerOf(L3.id).floor + (b.storeys + b.tower.storeys) * fx.storey, kind: b.tower.silhouette })); // prettier-ignore
    const placed = forms.filter((f) => (f.kind === "dome" || f.kind === "tower-crown") && S.byId.get(f.on)?.district === d.id).map((f) => ({ id: f.id, top: f.top, kind: f.silhouette })); // prettier-ignore
    const best = [...tw, ...placed].sort((a, b) => b.top - a.top)[0];
    if (!best) failures.push(`M13: district ${d.id} (its centre in the tile) has no landmark: no tower in the description, no dome or crown placed`);
    else if (best.top < want - EPS) failures.push(`M13: district ${d.id}'s landmark ${best.id} tops out at z ${r3(best.top)}, at least ${r3(want)} (${Lm.minStoreysOver} storeys over its median roof z ${median})`); // prettier-ignore
    else notes.push(`M13: ${d.id}'s landmark ${best.id} (${best.kind}) at z ${r3(best.top)}, ${r3((best.top - median) / fx.storey)} storeys over its median roof z ${median}`); // prettier-ignore
  }
}

export const _internal = { sceneOf, reliefOn, stretchesOf, cornersOf, carveHeightsOf, domeOn, facadeAllowance, traitsOfForms, faceBox, facesOf, neighboursOf, dropKeepsMassing, massingHolds, reroof, setbackOn, fixRelief, push, cornerParts, buildRoof, maskedShare };
