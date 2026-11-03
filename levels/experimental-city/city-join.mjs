// The city join: the nine tiles' .map (stage 10, geometry-xash.mjs) made into the ONE map the city is (PLAN.md, "Tiles":
// "the whole map is the tiles' fragments without the caps"). Each tile's .map is already in city coordinates; this
// merges them and takes off what each added only to seal itself on a seam it shares with another tile.
//
// How a tile seals its seams (geometry-xash.mjs, "The rock"): its spaces are clipped to the tile's box and carvePlan
// fills the box of its spaces grown by WALL (64) on every side, from the lowest floor less WALL to the highest
// ceiling plus WALL, with rock wherever there is no space. So the tile's rock reaches WALL past its box on every
// side: that band is the cap of every seam portal. The rock is the first `counts.rock` world brushes of the .map (10-
// geometry.json), the shells, roofs and towers after it; the box is 10-geometry's `seams.box`.
//
// Written rules:
//   - Domains. The city's seam lines cut the plane into one domain a tile (a tile on the city's border owns
//     everything beyond it on that side, the air of 09's edge pockets with it). A tile's rock is cut on the seam lines
//     (a brush across one becomes two, the new face on the seam wearing the brush's own wall); a piece in the tile's
//     own domain is kept as it is.
//   - Cover. Where a piece of a tile's rock stands in another present tile's domain, the part of it inside that
//     tile's carve (the box its rock fills, rock or space everywhere inside it) is taken off: that tile's own rock or
//     its spaces are there, so the piece was only a cap. What is left of it (below a shallow neighbour's floor, past
//     its sides) stays: the cistern of one tile stays capped under a neighbour that does not reach down to it. A
//     piece in no present tile's domain (the city's outer border, beyond a tile not built) stays: the outer sealing.
//   - Only rock is cut: shells, roofs, towers and every brush entity are kept as they are.
//   - worldspawn: one; `wad` the union of the tiles' lists, each list's order kept (first seen first where none
//     says); `message` the city's name; any other key two tiles give differently is told, the first tile's kept.
//   - Names: a targetname on entities of two tiles is renamed in every tile after the first (`{name}_{c1r1}`, at
//     most maxName characters) with every reference to it in that tile (target, killtarget, master, netname, a
//     multi_manager's keys), unless it is shared by design: every holder a light (switching together) or a sound
//     (the city alarm), a name the description gives the city (a connector, a lift, a secret, a passage, a portal),
//     or a name targeted from a tile that does not hold it (a link across a seam).
//   - light_environment: one, the first tile's that has one (the others' told when their keys differ).
import { box, shapeOf, planesOf, holds } from "../../src/maps/source.mjs";
import { leakHint } from "../../src/maps/plan.mjs";
import { staysInGame, sourceChecks } from "./stage10-geometry.mjs";

const EPS = 1e-6;
/** A piece thinner than this (units) is dust from a cut: dropped. */
const DUST = 0.05;
/** Keys whose value names another entity. */
const REF_KEYS = ["target", "killtarget", "master", "netname"];
/** The H9 server's edict ceiling (gameinfo max_edicts), beside engine.limits.entities (indices under 2,048). */
export const MAX_EDICTS = 4098;

/** A tile id's numbers: c1_r2 -> [1, 2]. */
const cr = (id) => id.slice(1).split("_r").map(Number);
/** A tile id as the names carry it (c1r1). */
const short = (id) => id.replace("_", "");

/** The texture most of a brush's upright faces wear (its wall), else its first face's. */
function wallOf(brush, s = shapeOf(brush)) {
  const n = {};
  s.faces.forEach((p, i) => {
    const t = brush.faces[i].texture;
    if (p.normal && Math.abs(p.normal[2]) < 0.5 && t !== "sky") n[t] = (n[t] ?? 0) + 1;
  });
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] ?? brush.faces[0].texture;
}

/** The face on the plane `axis = value`, looking along `sign` (+1 / -1), in the brush's neighbourhood. */
function faceOn(axis, sign, value, texture, near) {
  const min = near.min.map((v) => Math.floor(v) - 16);
  const max = near.max.map((v) => Math.ceil(v) + 16);
  min[axis] = value - 16;
  max[axis] = value + 16;
  if (sign > 0) max[axis] = value;
  else min[axis] = value;
  const k = axis === 2 ? (sign > 0 ? 0 : 1) : axis === 0 ? (sign > 0 ? 2 : 3) : sign > 0 ? 4 : 5;
  return box(min, max, texture).faces[k];
}

/** A brush less the faces the others cut away (a plane added can leave one with no area). */
function tidyBrush(brush) {
  const s = shapeOf(brush);
  if (!s.corners.length || !(s.volume > 1)) return null;
  const faces = brush.faces.filter((_, i) => s.faces[i].normal && s.faces[i].area > 1e-6);
  const kept = faces.length === brush.faces.length ? brush : { ...brush, faces };
  return shapeOf(kept).faults.length ? null : kept;
}

/**
 * A brush cut by the plane `axis = value`: `{ below, above }`, each a brush or null. A brush wholly on one side
 * comes back as it was; the new face wears `texture` (else the brush's wall).
 */
export function splitBrush(brush, axis, value, texture) {
  const s = shapeOf(brush);
  if (s.max[axis] <= value + DUST) return { below: brush, above: null };
  if (s.min[axis] >= value - DUST) return { below: null, above: brush };
  const t = texture ?? wallOf(brush, s);
  const below = tidyBrush({ ...brush, faces: [...brush.faces, faceOn(axis, +1, value, t, s)] });
  const above = tidyBrush({ ...brush, faces: [...brush.faces, faceOn(axis, -1, value, t, s)] });
  return { below, above };
}

/** What is left of a brush outside the box [min, max] (3D): a list of brushes (empty when it is all inside). */
export function subtractBox(brush, min, max, texture) {
  const out = [];
  let rest = brush;
  for (let a = 0; a < 3 && rest; a++) {
    const lo = splitBrush(rest, a, min[a], texture);
    if (lo.below) out.push(lo.below);
    rest = lo.above;
    if (!rest) break;
    const hi = splitBrush(rest, a, max[a], texture);
    if (hi.above) out.push(hi.above);
    rest = hi.below;
  }
  return out;
}

/** The city's frame from a description: the tile grid in engine units. */
export function cityFrame(desc) {
  const t = desc.tiles;
  const cu = desc.grid?.cellUnits ?? 128;
  const [gx, gy] = desc.grid?.origin ?? [0, 0];
  const [tx, ty] = t.origin ?? [0, 0];
  const xs = Array.from({ length: t.cols + 1 }, (_, c) => (tx + c * t.size[0] - gx) * cu);
  const ys = Array.from({ length: t.rows + 1 }, (_, r) => (ty + r * t.size[1] - gy) * cu);
  return { cols: t.cols, rows: t.rows, xs, ys, cu, origin: [gx, gy] };
}

/** The tile (c, r) whose domain holds a point: the grid's cell, clamped to the city (the border owns beyond). */
function domainAt(F, [x, y]) {
  let c = 0;
  while (c < F.cols - 1 && x >= F.xs[c + 1]) c++;
  let r = 0;
  while (r < F.rows - 1 && y >= F.ys[r + 1]) r++;
  return `c${c}_r${r}`;
}

/** The box a tile's carve fills (its rock's extent): { min, max } in 3D, or null with no rock. */
function coverOf(rock) {
  if (!rock.length) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const b of rock) {
    const s = shapeOf(b);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], s.min[k]);
      max[k] = Math.max(max[k], s.max[k]);
    }
  }
  return { min, max };
}

/** Lists merged keeping each one's order (a stable topological merge; ties by first seen). */
export function mergeOrdered(lists) {
  const first = new Map();
  const after = new Map();
  for (const l of lists)
    l.forEach((x, i) => {
      if (!first.has(x)) first.set(x, first.size);
      if (!after.has(x)) after.set(x, new Set());
      if (i > 0) after.get(x).add(l[i - 1]);
    });
  const out = [];
  const left = new Set(first.keys());
  while (left.size) {
    const ready = [...left].filter((x) => [...after.get(x)].every((p) => !left.has(p)));
    const pick = (ready.length ? ready : [...left]).sort((a, b) => first.get(a) - first.get(b))[0];
    out.push(pick);
    left.delete(pick);
  }
  return out;
}

/** The names an entity refers to: { key, name } (a multi_manager's keys are the names it fires, `#n` its repeats). */
function refsOf(e) {
  const out = [];
  for (const k of REF_KEYS) if (e[k] !== undefined && e[k] !== "") out.push({ key: k, name: String(e[k]) });
  if (e.classname === "multi_manager")
    for (const k of Object.keys(e)) if (!["classname", "origin", "targetname", "spawnflags", "wait", "brushes"].includes(k)) out.push({ key: k, name: k.replace(/#\d+$/, ""), asKey: true }); // prettier-ignore
  return out;
}

/** The names the description gives the city: connectors, lifts, secrets, passages, streets, portals. */
function cityIds(desc) {
  const ids = new Set();
  const lists = [desc.connectors, desc.secrets, desc.streets?.segments, desc.streets?.nodes, desc.checkpoints, desc.tiles?.portals];
  for (const list of lists) for (const x of Array.isArray(list) ? list : []) if (x?.id) ids.add(String(x.id));
  for (const p of desc.tiles?.portals ?? []) if (p.of) ids.add(String(p.of));
  return ids;
}

/**
 * The tiles joined. `tiles`: [{ id, map (readMap's), rock (10-geometry's counts.rock: the first world brushes),
 * box (10-geometry's seams.box, units) }], in any order (joined in row order, south to north, west to east).
 * Returns { map, report } where report holds the caps taken off, the conflicts, the renames and the counts.
 */
export function joinTiles(desc, tiles, { maxName = desc.wiring?.maxNameLength ?? 31 } = {}) {
  const F = cityFrame(desc);
  const order = [...tiles].sort((a, b) => cr(a.id)[1] - cr(b.id)[1] || cr(a.id)[0] - cr(b.id)[0]);
  const present = new Map(order.map((t) => [t.id, t]));
  const report = { tiles: order.map((t) => t.id), caps: {}, conflicts: [], renames: [], shared: [], lightEnvironment: null, notes: [] }; // prettier-ignore
  // each tile's rock, and the box its carve fills
  const rockOf = new Map();
  const cover = new Map();
  for (const t of order) {
    const n = t.rock ?? t.map.brushes.length;
    rockOf.set(t.id, t.map.brushes.slice(0, n));
    cover.set(t.id, coverOf(rockOf.get(t.id)));
  }
  // ── the world: each tile's rock cut on the seam lines; a piece in another tile's domain less that tile's carve ──
  const brushes = [];
  /** Each world brush's tile, and whether it stands past the tile's own domain (a cap or the outer sealing). */
  const origin = new Map();
  const put = (tile, beyond, ...list) => {
    for (const b of list) origin.set(b, { tile, beyond });
    brushes.push(...list);
  };
  for (const t of order) {
    const rock = rockOf.get(t.id);
    const rest = t.map.brushes.slice(rock.length);
    const c = { rock: rock.length, cut: 0, dropped: 0, kept: 0, keptBeyond: 0, pieces: 0 };
    for (const b of rock) {
      const s = shapeOf(b);
      const own = domainAt(F, [(s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2]);
      const inner = (lines, lo, hi) => lines.slice(1, -1).filter((v) => v > lo + DUST && v < hi - DUST);
      const cutsX = inner(F.xs, s.min[0], s.max[0]);
      const cutsY = inner(F.ys, s.min[1], s.max[1]);
      if (!cutsX.length && !cutsY.length && own === t.id) {
        put(t.id, false, b);
        c.kept++;
        continue;
      }
      // the pieces of the brush, one a domain
      let pieces = [b];
      for (const [axis, cuts] of [[0, cutsX], [1, cutsY]])
        for (const v of cuts)
          pieces = pieces.flatMap((p) => {
            const { below, above } = splitBrush(p, axis, v);
            return [below, above].filter(Boolean);
          });
      if (pieces.length > 1) c.cut++;
      for (const p of pieces) {
        const ps = shapeOf(p);
        const dom = domainAt(F, [(ps.min[0] + ps.max[0]) / 2, (ps.min[1] + ps.max[1]) / 2]);
        if (dom === t.id) {
          put(t.id, false, p);
          c.pieces++;
          continue;
        }
        const U = present.has(dom) ? cover.get(dom) : null;
        if (!U) {
          put(t.id, true, p);
          c.keptBeyond++;
          continue;
        }
        const left = subtractBox(p, U.min, U.max);
        if (!left.length) c.dropped++;
        else c.keptBeyond += left.length;
        put(t.id, true, ...left);
      }
    }
    put(t.id, false, ...rest);
    report.caps[t.id] = { ...c, other: rest.length };
  }
  const rockTotal = Object.values(report.caps).reduce((s, c) => s + c.kept + c.pieces + c.keptBeyond, 0);

  // ── worldspawn ──
  const worldspawn = {};
  const wads = [];
  for (const t of order) {
    const ws = t.map.worldspawn ?? {};
    const list = Array.isArray(ws.wad) ? ws.wad : String(ws.wad ?? "").split(";").filter(Boolean);
    wads.push(list);
    for (const [k, v] of Object.entries(ws)) {
      if (k === "wad" || k === "message") continue;
      if (worldspawn[k] === undefined) worldspawn[k] = v;
      else if (String(worldspawn[k]) !== String(v)) report.conflicts.push(`worldspawn ${k}: ${t.id} gives "${v}", ${order[0].id}'s "${worldspawn[k]}" kept`); // prettier-ignore
    }
  }
  worldspawn.message = desc.title ?? desc.name ?? "city";
  worldspawn.wad = mergeOrdered(wads);

  // ── names ──
  const holders = new Map(); // name -> Map(tile -> [classname])
  const targetedFrom = new Map(); // name -> Set(tile)
  for (const t of order)
    for (const e of t.map.entities) {
      if (e.targetname !== undefined && e.targetname !== "") {
        const n = String(e.targetname);
        if (!holders.has(n)) holders.set(n, new Map());
        const m = holders.get(n);
        m.set(t.id, [...(m.get(t.id) ?? []), e.classname]);
      }
      for (const r of refsOf(e)) targetedFrom.set(r.name, (targetedFrom.get(r.name) ?? new Set()).add(t.id));
    }
  const ids = cityIds(desc);
  const renameIn = new Map(); // tile -> Map(old -> new)
  const taken = new Set(holders.keys());
  for (const [n, m] of holders) {
    if (m.size < 2) continue;
    const classes = [...m.values()].flat();
    const why = classes.every((x) => /^light/.test(x))
      ? "lights that switch together"
      : classes.every((x) => x === "ambient_generic")
        ? "sounds that answer one name"
        : ids.has(n)
          ? "a name the description gives the city"
          : [...(targetedFrom.get(n) ?? [])].some((t) => !m.has(t))
            ? "targeted from a tile that does not hold it (a link across a seam)"
            : null;
    if (why) {
      report.shared.push({ name: n, tiles: [...m.keys()], why });
      continue;
    }
    for (const tid of [...m.keys()].slice(1)) {
      const tail = `_${short(tid)}`;
      let nn = n.slice(0, maxName - tail.length) + tail;
      for (let k = 2; taken.has(nn); k++) nn = n.slice(0, maxName - tail.length - String(k).length) + tail + k;
      taken.add(nn);
      if (!renameIn.has(tid)) renameIn.set(tid, new Map());
      renameIn.get(tid).set(n, nn);
      report.renames.push({ tile: tid, from: n, to: nn, classes: m.get(tid) });
    }
  }

  // ── entities ──
  const entities = [];
  let le = null;
  for (const t of order) {
    const R = renameIn.get(t.id);
    for (const e0 of t.map.entities) {
      let e = e0;
      if (R) {
        e = { ...e0 };
        if (e.targetname !== undefined && R.has(String(e.targetname))) e.targetname = R.get(String(e.targetname));
        for (const r of refsOf(e0)) {
          if (!R.has(r.name)) continue;
          if (r.asKey) {
            const v = e[r.key];
            delete e[r.key];
            e[R.get(r.name) + r.key.slice(r.name.length)] = v;
          } else e[r.key] = R.get(r.name);
        }
      }
      if (e.classname === "light_environment") {
        if (!le) {
          le = { tile: t.id, entity: e };
          entities.push(e);
        } else {
          const diff = Object.keys({ ...e, ...le.entity }).filter((k) => k !== "origin" && String(e[k]) !== String(le.entity[k])); // prettier-ignore
          report.notes.push(`light_environment of ${t.id} dropped (${le.tile}'s kept)${diff.length ? `; it differed in ${diff.join(", ")}` : ""}`); // prettier-ignore
        }
        continue;
      }
      entities.push(e);
    }
  }
  report.lightEnvironment = le ? le.tile : null;
  report.rock = rockTotal;
  return { map: { worldspawn, brushes, entities }, report, origin };
}

// ── checks ──────────────────────────────────────────────────────────────────

/** Where a segment from `a` to `b` enters a convex brush, or false when it touches none of it (Cyrus-Beck). */
function segmentMeets(planes, a, b) {
  let enter = 0;
  let leave = 1;
  for (const p of planes) {
    if (!p) continue;
    const da = p.normal[0] * a[0] + p.normal[1] * a[1] + p.normal[2] * a[2] - p.dist;
    const db = p.normal[0] * b[0] + p.normal[1] * b[1] + p.normal[2] * b[2] - p.dist;
    if (da > -EPS && db > -EPS) return false;
    if (da > -EPS) enter = Math.max(enter, da / (da - db));
    else if (db > -EPS) leave = Math.min(leave, da / (da - db));
    if (enter > leave) return false;
  }
  return true;
}

/** A spatial index of world brushes: those whose box meets a point's neighbourhood. */
function indexOf(brushes) {
  const list = brushes.map((b) => {
    const s = shapeOf(b);
    return { b, min: s.min, max: s.max, planes: planesOf(b) };
  });
  const near = (lo, hi) => list.filter((x) => x.min.every((v, k) => v <= hi[k] + 1) && x.max.every((v, k) => v >= lo[k] - 1));
  return { list, near };
}

/** Whether the line across a seam from `a` to `b` is clear of every world brush (its ends in no brush). */
function clear(index, a, b) {
  return !blockers(index, a, b).length;
}
/** The world brushes a segment meets. */
function blockers(index, a, b) {
  const lo = [0, 1, 2].map((k) => Math.min(a[k], b[k]));
  const hi = [0, 1, 2].map((k) => Math.max(a[k], b[k]));
  return index.near(lo, hi).filter((x) => segmentMeets(x.planes, a, b)).map((x) => x.b);
}

/**
 * Every seam portal open across its seam in a map: for a portal with a height (a street's, 01's `z` and `width`),
 * the line across the seam (`reach` units each side) at its floor plus `head`, at its middle and a quarter of its
 * width each way, touches no world brush (open when one of the three is clear, `all` when every one is); a portal
 * with no height (a secret, a connector) is not checked (open null). Returns [{ id, seam, open, all, at, why }].
 */
export function portalsOpen(map, desc, portals, { reach = 48, head = 72, index = indexOf(map.brushes), origin = null } = {}) {
  /** Who shuts a line: each blocking brush's tile, and whether it is a piece past the tile (a cap) or its own. */
  const whose = (a, b) => [...new Set(blockers(index, a, b).map((x) => { const o = origin?.get(x); return o ? `${o.beyond ? "a piece past its domain" : "its own geometry"} of ${o.tile}` : "a world brush"; }))].join(", "); // prettier-ignore
  const F = cityFrame(desc);
  const X = (x) => (x - F.origin[0]) * F.cu;
  const Y = (y) => (y - F.origin[1]) * F.cu;
  const out = [];
  for (const p of portals) {
    const [a, b] = p.seam.split("|").map(cr);
    const across = a[0] !== b[0] ? 0 : 1; // the seam between two columns lies along y: crossed along x
    const at = [X(p.at[0]), Y(p.at[1])];
    const line = (off, z) => {
      const m = [...at, z];
      m[1 - across] += off;
      const lo = [...m];
      const hi = [...m];
      lo[across] -= reach;
      hi[across] += reach;
      return [lo, hi];
    };
    if (p.z !== null && p.z !== undefined) {
      const z = p.z * F.cu + head;
      const w = (p.width ?? 1) * F.cu;
      const offs = [0, -w / 4, w / 4];
      const res = offs.map((o) => clear(index, ...line(o, z)));
      const open = res.some(Boolean);
      out.push({ id: p.id, seam: p.seam, open, all: res.every(Boolean), at: [...at, z].map(Math.round), why: open ? "" : `shut across its width by ${whose(...line(0, z))}` }); // prettier-ignore
    } else {
      out.push({ id: p.id, seam: p.seam, open: null, all: null, at: at.map(Math.round), why: "no height known (01 gives none, 04 has no hallway for it): not checked" }); // prettier-ignore
    }
  }
  return out;
}

/**
 * The leak flood on each seam (a finer cut of checkPlan's, which the whole city's size makes coarse): the world
 * brushes within `span` of the seam between two tiles, cut to that band, walled on its two long sides (the tiles'
 * insides, each sealed by its own stage 10) and at an end inside the city, open above, below and at an end on the
 * city's border; flooded (leakHint) from the point entities in it and from points in the band, either side of the
 * seam, inside that side's carve and in no brush. A way out is a leak the join made. Returns [{ seam, leak, cell }].
 */
export function seamLeaks(map, desc, tiles, { span = 384, step = 256 } = {}) {
  const F = cityFrame(desc);
  const present = new Map(tiles.map((t) => [t.id, t]));
  const cover = new Map(tiles.map((t) => [t.id, coverOf(t.map.brushes.slice(0, t.rock ?? t.map.brushes.length))]));
  const zLo = Math.min(...[...cover.values()].filter(Boolean).map((c) => c.min[2])) - 128;
  const zHi = Math.max(...[...cover.values()].filter(Boolean).map((c) => c.max[2])) + 128;
  const index = indexOf(map.brushes);
  const out = [];
  for (const t of tiles) {
    const [c, r] = cr(t.id);
    for (const [dc, dr] of [[1, 0], [0, 1]]) {
      const u = `c${c + dc}_r${r + dr}`;
      if (!present.has(u)) continue;
      const across = dc ? 0 : 1;
      const along = 1 - across;
      const seam = dc ? F.xs[c + 1] : F.ys[r + 1];
      const A = cover.get(t.id);
      const B = cover.get(u);
      if (!A || !B) continue;
      // along: the shared edge, out to the carves' ends where the edge is the city's border (the edge pockets)
      const lineAlong = dc ? F.ys : F.xs;
      const k = dc ? r : c;
      const atBorderLo = k === 0;
      const atBorderHi = k === (dc ? F.rows : F.cols) - 1;
      const lo = atBorderLo ? Math.min(A.min[along], B.min[along]) - 128 : lineAlong[k] - span;
      const hi = atBorderHi ? Math.max(A.max[along], B.max[along]) + 128 : lineAlong[k + 1] + span;
      const bmin = [0, 0, zLo];
      const bmax = [0, 0, zHi];
      bmin[across] = seam - span;
      bmax[across] = seam + span;
      bmin[along] = lo;
      bmax[along] = hi;
      const cut = [];
      for (const x of index.near(bmin, bmax)) {
        let pieces = [x.b];
        for (let a = 0; a < 3; a++)
          pieces = pieces.flatMap((p) => {
            const s1 = splitBrush(p, a, bmin[a]).above;
            return s1 ? [splitBrush(s1, a, bmax[a]).below].filter(Boolean) : [];
          });
        cut.push(...pieces);
      }
      const W = 64;
      const wall = (m0, m1) => box(m0, m1, "crete33");
      const walls = [];
      for (const side of [-1, 1]) {
        const m0 = [...bmin];
        const m1 = [...bmax];
        m0[2] = zLo - 256;
        m1[2] = zHi + 256;
        if (side < 0) {
          m0[across] = bmin[across] - W;
          m1[across] = bmin[across];
        } else {
          m0[across] = bmax[across];
          m1[across] = bmax[across] + W;
        }
        m0[along] -= W;
        m1[along] += W;
        walls.push(wall(m0, m1));
      }
      for (const [end, inside] of [[-1, !atBorderLo], [1, !atBorderHi]]) {
        if (!inside) continue;
        const m0 = [...bmin];
        const m1 = [...bmax];
        m0[2] = zLo - 256;
        m1[2] = zHi + 256;
        if (end < 0) {
          m0[along] = bmin[along] - W;
          m1[along] = bmin[along];
        } else {
          m0[along] = bmax[along];
          m1[along] = bmax[along] + W;
        }
        walls.push(wall(m0, m1));
      }
      // seeds: the point entities in the band, and the band's open points inside their side's carve
      const ents = map.entities.filter((e) => {
        if (e.brushes?.length || e.origin === undefined) return false;
        const o = String(e.origin).split(" ").map(Number);
        return o.every((v, i) => v > bmin[i] && v < bmax[i]);
      });
      const seeds = [];
      const sideCover = (side) => (side < 0 ? A : B);
      for (let a = lo + step / 2; a < hi; a += step)
        for (let z = zLo + 64; z < zHi; z += 96)
          for (const side of [-1, 1]) {
            const p = [0, 0, z];
            p[across] = seam + side * (span / 2);
            p[along] = a;
            const C = sideCover(side);
            if (!p.every((v, i) => v > C.min[i] + 1 && v < C.max[i] - 1)) continue;
            if (index.near(p, p).some((x) => holds(x.b, p, -0.5))) continue;
            seeds.push({ classname: "info_target", origin: p.map((v) => Math.round(v * 10) / 10).join(" ") });
          }
      const sub = { brushes: [...cut, ...walls], entities: [...ents, ...seeds] };
      const h = leakHint(sub);
      out.push({ seam: `${t.id}|${u}`, leak: h.leak ? { from: h.leak.entity.origin.map(Math.round), at: h.leak.at.map(Math.round) } : null, cell: h.cell, seeds: seeds.length + ents.length, brushes: cut.length }); // prettier-ignore
    }
  }
  return out;
}

/**
 * The joined map's checks: the source checks of stage 10 against the whole of engine.limits (the counts, names,
 * targets, checkPlan with its leak flood), the edicts against H9's max_edicts, every seam portal open, the seam
 * floods. `shared`: joinTiles' report.shared (names on several entities on purpose). Returns { failures, notes,
 * counts, portals, seams }.
 */
export function cityChecks(map, desc, tiles, portals, { rock = 0, seams = true, origin = null, shared = [] } = {}) {
  const lim = desc.engine?.limits ?? {};
  const v = (k) => (lim[k]?.value > 0 ? lim[k].value : undefined);
  const limits = { brushes: v("brushes"), structural: v("structural"), rock: v("rock"), brushModels: v("brushModels"), entities: v("entities") }; // prettier-ignore
  const sc = sourceChecks(map, { limits, rock, range: v("extent") ?? 32768, maxName: desc.wiring?.maxNameLength ?? 31 });
  // a name the join kept shared by design (joinTiles' report.shared) is on several entities on purpose
  const sharedNames = new Set(shared.map((s) => (typeof s === "string" ? s : s.name)));
  const failures = sc.failures.filter((f) => !sharedNames.has(/^name (\S+) is on \d+ entities/.exec(f)?.[1]));
  const notes = [...sc.notes];
  const edicts = map.entities.filter(staysInGame).length + 1;
  if (edicts > MAX_EDICTS) failures.push(`edicts: ${edicts}, at most ${MAX_EDICTS} (H9's max_edicts)`);
  else notes.push(`edicts: ${edicts} of ${MAX_EDICTS} (H9's max_edicts; the world's one with the entities that stay)`);
  const lightEnv = map.entities.filter((e) => e.classname === "light_environment").length;
  if (lightEnv > 1) failures.push(`${lightEnv} light_environment: one at most`);
  const index = indexOf(map.brushes);
  const P = portalsOpen(map, desc, portals, { index, origin });
  for (const p of P) if (p.open === null) notes.push(`portal ${p.id} (${p.seam}): ${p.why}`);
  for (const p of P) if (p.open === false) failures.push(`portal ${p.id} (${p.seam}) is shut at ${p.at.join(" ")}: ${p.why}`);
  const S = seams ? seamLeaks(map, desc, tiles) : [];
  for (const s of S) if (s.leak) failures.push(`seam ${s.seam}: the flood (${s.cell}-unit cells) gets out near ${s.leak.at.join(" ")} from ${s.leak.from.join(" ")}`); // prettier-ignore
  return { failures, notes, counts: { ...sc.counts, edicts, lightEnvironment: lightEnv }, check: sc.check, portals: P, seams: S };
}

export const _internal = { domainAt, coverOf, refsOf, segmentMeets, indexOf, clear };
