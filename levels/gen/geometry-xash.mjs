// Stage 10's Xash / GoldSrc adapter: the artifacts 01-09 of one tile built as brush source, what SMAK's `writeMap`
// takes ({ worldspawn, brushes, entities }, src/maps/source.mjs), in the engine's units (a cell 128, z 0 the city's
// floor, x and y from the description's grid origin). It leans on SMAK's GoldSrc side: `carvePlan` (src/maps/ground.mjs)
// carves the rock, `box`, `prism`, `solid`, `stairs`, the entity builders and `writeMap` (source.mjs) make the rest,
// `checkPlan` (plan.mjs) looks it over. PLAN.md Phase 3, "Brush economy" and the stages table, row 10.
//
// Written rules:
//   - The rock: one carve of the tile (carvePlan: what is not a space is rock, so nothing leaks by construction),
//     its spaces clipped to the tile's box, so its outer rock caps every seam (a tile compiles alone). The spaces:
//     each public way (non-service) a band of its width along its centre line, each plaza less the buildings
//     standing on it, each enterable building's shell (its outline grown by the exterior wall, its storeys high),
//     stage 4's hallway legs, connector wells, shafts and straight runs, checkpoint rooms and posts (held in from
//     their outline by WALL so the rock between is their wall; a gate room not), a door's opening through such a
//     wall, the forms' cuts; where a layer is open to the sky (no layer above over it), the air over every lot from
//     its roof and over a block's back from its highest roof, up to the sky lid. A space under the layer above
//     ends at its layer's top (the deck's soffit, the vault); one open to the sky ends at the lid, its ceiling `sky`.
//   - Facades are uncarved rock (PLAN.md's rule 3): a face of rock whose back is inside a facade lot wears the
//     facade's wall (its district's palette); a face carved round any other space wears that space's own role.
//   - Carve heights: a space's floor and ceiling on the layer's half-storey grid (a connector's slab under its
//     first flight to the floor below it, its head up to the next grid line), so the rock is sliced as few times
//     as rock.maxHeights allows; the heights counted per layer are held against it.
//   - A building: its shell walls are world brushes on the outline (exterior wall thick, the full height), cut by
//     every exterior door (05's exterior walls' door holes), a roof slab of world over it where the sky is open,
//     its tower a world prism of its silhouette; inside, func_detail only (PLAN.md "interiors are detail inside a
//     structural shell"): interior and court walls with their doors' holes (lintels over), a slab under each upper
//     storey's rooms less the stair holes over the flights below, the stairs' flights (stairs()) and half landings,
//     terraces' parapets. Windows are texture (the facade allowance, 09): no hole is cut for one.
//   - Doors, by 07's names (<= 31 characters): a hinged door a func_door_rotating (its ORIGIN brush on the hinge,
//     opening to its swing side), a gate a func_door rising (its portcullis), a secret door a func_door sliding
//     along its wall wearing the wall, a hatch a func_door sliding flat, a cell's front real bars
//     (rulebook dimensions.cellBars: square bars `bar` thick, the clear gap at most `clearGap.max`, rails at the
//     foot, the lock and the head, at most `maxBrushes` with the leaf; the leaf a func_door of its bars sliding
//     along the wall; a front that cannot keep within falls back to one brush of the masked bars texture). Every
//     door use-only (spawnflags 256), toggling (wait -1).
//   - Switches func_button at 07's spot (a 4-unit plate on the wall), one target named, several through a
//     multi_manager; lifts a func_train (its car, a platform the shaft's size) on path_corners at each stop
//     (wait for a trigger), a call button at each stop's exit; lights: every lamp of 06 a light (07's switchable
//     ones named), its colour the district's, its brightness from its power; sounds ambient_generic (07's names, a
//     sample `ambience/nb_<sound>.wav` of the kit); spawns info_player_deathmatch in 07's order; signs a plate of
//     func_detail over their door; stage 8's brush props func_detail boxes, its model props ts_model with the
//     surveyed on-client model of their kind (a kind with none, a box); stage 9's forms part for part (detail,
//     world, a brush entity by group, a cut carved), their points as point entities.
//   - Streets: the way's floor the carriageway's road; each sidewalk or portico a raised strip of detail (a kerb of
//     KERB units, its side the curb trim); squares' porticoes a vault slab over their band, the columns 04 kept
//     standing; monuments a plinth, a shaft and a crown; hallway bridges a tube of detail (floor, walls, roof).
//   - Every point entity inside the tile's box (one outside would stand in the void and leak); every brush on whole
//     units where snapping keeps it sound.
import { box, prism, solid, stairs, brushEntity, pointEntity, originBrush, light as lightEntity, writeMap, snapped, shapeOf } from "../../src/maps/source.mjs"; // prettier-ignore
import { carvePlan } from "../../src/maps/ground.mjs";
import { bandPoly } from "./geom.mjs";

/** Rock round the carve (units): the seam's cap, the floor under L1, the lid's thickness. */
export const WALL = 64;
/** A carved room's own wall, held in from its outline (units). */
export const ROOM_WALL = 16;
/** A kerb's height (units), a door leaf's thickness, a slab's thickness where the plan names none. */
export const KERB = 8;
const LEAF = 4;
const SLAB = 16;
/** The half-storey grid the carve's heights keep to (cells). */
export const HALF_STOREY = 0.75;
/** The surveyed on-client models of stage 8's model kinds (levels/notes-art-kit.md section 4; to verify on a client). */
export const PROP_MODELS = {
  wc: "models/mecklenburg/toilette.mdl",
  "steel-wc": "models/mecklenburg/toilette.mdl",
  basin: "models/CLANKILL3R/GPC_flo_becken.mdl",
  "trash-scatter": "models/h9/qk_trash.mdl",
  rubble: "models/h9/re_dirt.mdl",
  planter: "models/ts_theatre/xt_plant.mdl",
};
/** A brush prop's texture by kind (on-client: levels/notes-art-kit.md section 4), else PROP_DEFAULT. */
const PROP_TEXTURES = {
  bunk: "metal5", cot: "metal5", "hospital-bed": "metal5", "bed-single": "wood2", "bed-double": "wood2", wardrobe: "cd_wood",
  dresser: "cd_wood", cabinet: "cd_wood", desk: "cd_wood", "dining-table": "cd_wood", "display-table": "cd_wood",
  bookshelf: "cd_wood", "filing-cabinet": "metal5", shelving: "metal5", "locker-row": "metal5", "weapon-rack": "armory11",
  counter: "booth_wood_1", worktop: "booth_wood_1", stove: "cd_white", fridge: "cd_white", sofa: "booth_wood_1",
  armchair: "booth_wood_1", bench: "wood4a", "street-bench": "wood4a", workbench: "metal_rusty5ccc", "tool-rack": "metal_rusty5ccc",
  machine: "metal_rusty5ccc", crate: "crapwood1c", barrel: "metal_rusty5eee", "stall-counter": "mr_kiosk",
  "market-stall": "mr_kiosk", bin: "bin", "lamp-post": "metal5",
}; // prettier-ignore
const PROP_DEFAULT = "crete33";
const M_PER_UNIT = 0.0254;

// ── small geometry ──
const round = (v) => Math.round(v) + 0;
const boxOf = (poly) => [Math.min(...poly.map((p) => p[0])), Math.min(...poly.map((p) => p[1])), Math.max(...poly.map((p) => p[0])), Math.max(...poly.map((p) => p[1]))]; // prettier-ignore
const rectBox = (r) => [r.x, r.y, r.x + r.w, r.y + r.d];
const boxPoly = ([x0, y0, x1, y1]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const inBox = (p, b, e = 0) => p[0] >= b[0] - e && p[0] <= b[2] + e && p[1] >= b[1] - e && p[1] <= b[3] + e;
const boxInside = (a, b, e = 1e-6) => a[0] >= b[0] - e && a[1] >= b[1] - e && a[2] <= b[2] + e && a[3] <= b[3] + e;
const boxMeet = (a, b) => Math.min(a[2], b[2]) > Math.max(a[0], b[0]) && Math.min(a[3], b[3]) > Math.max(a[1], b[1]);
const grow = (b, d) => [b[0] - d, b[1] - d, b[2] + d, b[3] + d];
const area = (poly) => Math.abs(poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2; // prettier-ignore

/** A convex outline clipped to a box (Sutherland-Hodgman), or null when nothing is left. */
export function clipToBox(poly, [x0, y0, x1, y1]) {
  let out = poly;
  const edges = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]],
    [(p) => p[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]],
  ];
  for (const [inside, cross] of edges) {
    const list = out;
    out = [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const b = list[(i + 1) % list.length];
      if (inside(b)) {
        if (!inside(a)) out.push(cross(a, b));
        out.push(b);
      } else if (inside(a)) out.push(cross(a, b));
    }
    if (out.length < 3) return null;
  }
  return area(out) > 1e-6 ? out : null;
}

/** A box less some boxes, as boxes (axis-aligned; holes may reach past it). */
export function boxMinus(b, holes) {
  let parts = [b];
  for (const h of holes) {
    const next = [];
    for (const p of parts) {
      if (!boxMeet(p, h)) {
        next.push(p);
        continue;
      }
      const [x0, y0, x1, y1] = p;
      const [hx0, hy0, hx1, hy1] = [Math.max(x0, h[0]), Math.max(y0, h[1]), Math.min(x1, h[2]), Math.min(y1, h[3])];
      if (hy0 > y0) next.push([x0, y0, x1, hy0]);
      if (hy1 < y1) next.push([x0, hy1, x1, y1]);
      if (hx0 > x0) next.push([x0, hy0, hx0, hy1]);
      if (hx1 < x1) next.push([hx1, hy0, x1, hy1]);
    }
    parts = next;
  }
  return parts.filter((p) => p[2] - p[0] > 1e-6 && p[3] - p[1] > 1e-6);
}

/** "#9a6cff MSR purple" -> [154, 108, 255]. */
function colourOf(text, fallback = [255, 236, 200]) {
  const m = /#([0-9a-f]{6})/i.exec(String(text ?? ""));
  if (!m) return fallback;
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
}

// ── the build ──

/**
 * The tile's brush source from the stage context (`ctx.inputs` holding 01-09), the texture resolver (geometry-
 * textures.mjs) and the rulebook in metres. Returns { map, spaces, heights, counts, contract, notes, dropped }.
 */
export function buildTile(ctx, tex, rules) {
  const desc = ctx.description;
  const I = ctx.inputs;
  const site = I["01-site.json"];
  const lots = I["02-lots.json"];
  const net = I["04-network.json"];
  const plans = I["05-plans.json"];
  const pal = I["06-palette.json"];
  const wir = I["07-wiring.json"];
  const dress = I["08-dressing.json"];
  const forms = I["09-forms.json"];
  const cu = site.grid.cellUnits;
  const cellM = site.grid.cell;
  const storey = site.grid.storey;
  const [ox, oy] = desc.grid.origin ?? [0, 0];
  const X = (x) => (x - ox) * cu;
  const Y = (y) => (y - oy) * cu;
  const Zc = (z) => z * cu;
  const P = (p) => [round(X(p[0])), round(Y(p[1]))];
  const tileBox = site.tile.box;
  const tileU = [X(tileBox[0]), Y(tileBox[1]), X(tileBox[2]), Y(tileBox[3])];
  const notes = [];
  const dropped = [];
  const layers = [...site.layers].sort((a, b) => a.level - b.level);
  const layerOf = (id) => layers.find((L) => L.id === id);
  const above = (L) => layers.find((M) => M.level === L.level + 1) ?? null;
  /** The layer whose band holds height z (cells). */
  const layerAtZ = (z) => [...layers].reverse().find((L) => z >= L.floor - 1e-6) ?? layers[0];
  /** Whether a box (cells) of a layer is open to the sky: no layer above reaches over it. */
  const openSky = (L, b) => {
    if (L.sky === null || L.sky === undefined) return false;
    const A = above(L);
    return !A || !boxMeet(b, A.bounds);
  };
  const things = new Map(pal.things.map((t) => [t.id, t]));
  const slot = (id, key) => things.get(id)?.slots?.[key] ?? null;
  const roleTex = (id, key, fallbackRole = null) => {
    const s = slot(id, key);
    return s ? tex.ofRole(s.role, s.texture) : tex.ofRole(fallbackRole);
  };
  const frameTex = (L) => tex.ofRole(L.frame ?? "frame-cement");

  const world = []; // world brushes besides the carve: { brush, kind }
  const detail = new Map(); // group -> [brushes]
  const entities = []; // { entity, kind }
  const counts = { world: {}, detail: {}, entities: {} };
  const bump = (o, k, n = 1) => (o[k] = (o[k] ?? 0) + n);
  const addWorld = (brush, kind) => {
    if (!brush) return;
    world.push(brush);
    bump(counts.world, kind);
  };
  const addDetail = (group, brush, kind) => {
    if (!brush) return;
    if (!detail.has(group)) detail.set(group, []);
    detail.get(group).push(brush);
    bump(counts.detail, kind);
  };
  const addEntity = (entity, kind) => {
    entities.push({ entity, kind });
    bump(counts.entities, kind);
  };
  /** A box brush from unit corners, null when it has no size on an axis. */
  const B = (min, max, texture) => {
    const a = min.map(round);
    const b = max.map(round);
    if (!(b[0] > a[0] && b[1] > a[1] && b[2] > a[2])) return null;
    return box(a, b, texture);
  };

  // ── the carve's spaces (units) ──
  const spaces = [];
  const heightsBy = new Map(layers.map((L) => [L.id, new Set()]));
  // the heights a layer has anyway (its floor, top and sky, its lots' roofs): a space's z on one is kept there
  const anchors = new Map(layers.map((L) => [L.id, new Set([L.floor, L.top, ...(L.sky ? [L.sky] : [])])]));
  for (const l of lots.lots) if (l.tile === site.tile.id) anchors.get(l.layer)?.add(Math.round((l.zBase + (l.kind === "enterable" ? l.storeys * storey : (l.facade?.height ?? storey))) * 1000) / 1000); // prettier-ignore
  /** z (cells) on the half-storey grid of its layer (down for a floor, up for a head), or on a height it has anyway. */
  const onGrid = (z, up) => {
    for (const set of anchors.values()) for (const a of set) if (Math.abs(a - z) < 1e-3) return a;
    const L = layerAtZ(z);
    const k = (z - L.floor) / HALF_STOREY;
    const s = up ? Math.ceil(k - 1e-6) : Math.floor(k + 1e-6);
    return Math.round((L.floor + s * HALF_STOREY) * 1000) / 1000;
  };
  const addSpace = (name, polyCells, z0, z1, texture, { clip = true, grid = true, outlines = null, flex = false, opening = false } = {}) => {
    const zz = grid ? [onGrid(z0, false), onGrid(z1, true)] : [z0, z1];
    if (!(zz[1] > zz[0])) return;
    const rings = (outlines ?? [polyCells]).map((poly) => {
      const u = poly.map((p) => [X(p[0]), Y(p[1])]);
      const c = clip ? clipToBox(u, tileU) : u;
      return c ? c.map((p) => [round(p[0]), round(p[1])]) : null;
    }).filter((r) => r && area(r) >= 16); // prettier-ignore
    if (!rings.length) return;
    spaces.push({ name, outlines: rings, floor: round(Zc(zz[0])), ceiling: round(Zc(zz[1])), texture, cells: { z: zz, raw: [z0, z1] }, flex, opening }); // prettier-ignore
  };
  const sky = "sky";

  // ways: each non-service way a band along its centre line, its floor the road where it has one
  for (const w of site.ways) {
    if (w.class === "service") continue;
    const L = layerOf(w.layer);
    const id = `way:${w.id}`;
    const floor = roleTex(id, slot(id, "floor.road") ? "floor.road" : "floor", L.frame);
    const wall = slot(id, "wall") ? roleTex(id, "wall") : frameTex(L);
    for (const part of w.parts ?? [])
      for (let i = 0; i + 1 < part.length; i++) {
        const poly = bandPoly(part[i], part[i + 1], w.width);
        const open = openSky(L, boxOf(poly));
        const ceiling = open ? sky : slot(id, "ceiling") ? roleTex(id, "ceiling") : frameTex(L);
        addSpace(`${id}#${i}`, poly, L.floor, open ? L.sky : L.top, { floor, wall, ceiling });
      }
  }
  // plazas: the box less the enterable buildings standing on it
  const enterable = lots.lots.filter((l) => l.kind === "enterable" && l.tile === site.tile.id);
  for (const pz of site.plazas) {
    const L = layerOf(pz.layer);
    const id = `plaza:${pz.id}`;
    const holes = enterable.filter((l) => l.layer === pz.layer && boxMeet(rectBox(l.rect), pz.box)).map((l) => rectBox(l.rect));
    const parts = boxMinus(pz.box, holes);
    const open = openSky(L, pz.box);
    const t = { floor: roleTex(id, "floor", L.frame), wall: frameTex(L), ceiling: open ? sky : slot(id, "ceiling") ? roleTex(id, "ceiling") : frameTex(L) }; // prettier-ignore
    addSpace(id, null, L.floor, open ? L.sky : L.top, t, { outlines: parts.map(boxPoly) });
  }
  // the air over the lots and the blocks' backs where the sky is open
  for (const blk of lots.blocks) {
    const L = layerOf(blk.layer);
    if (!openSky(L, blk.box)) continue;
    const mine = lots.lots.filter((l) => l.block === blk.id && l.tile === site.tile.id);
    const roofOf = (l) => l.zBase + (l.kind === "enterable" ? l.storeys * storey : (l.facade?.height ?? storey));
    const back = mine.length ? Math.max(...mine.map(roofOf)) : L.top;
    const holes = mine.map((l) => rectBox(l.rect));
    const parts = (blk.rows ?? [blk.box]).flatMap((r) => boxMinus(r, holes));
    if (parts.length && back < L.sky) addSpace(`block:${blk.id}`, null, back, L.sky, { floor: frameTex(L), wall: frameTex(L), ceiling: sky }, { outlines: mergeRows(parts).map(boxPoly) }); // prettier-ignore
  }
  for (const l of lots.lots) {
    if (l.tile !== site.tile.id) continue;
    const L = layerOf(l.layer);
    const b = rectBox(l.rect);
    if (!openSky(L, b)) continue;
    const roof = l.zBase + (l.kind === "enterable" ? l.storeys * storey : (l.facade?.height ?? storey));
    const fid = l.kind === "facade" ? `facade:${l.id}` : `building:${l.building}`;
    if (roof < L.sky) addSpace(`air:${l.id}`, boxPoly(b), roof, L.sky, { floor: roleTex(fid, "trim") , wall: roleTex(fid, "wall"), ceiling: sky }); // prettier-ignore
  }
  // enterable buildings' shells (their walls are world brushes below, their insides detail)
  const planOf = new Map(plans.buildings.map((b) => [b.id, b]));
  for (const l of enterable) {
    const plan = planOf.get(l.building);
    const roof = l.zBase + l.storeys * storey;
    const ground = plan?.rooms.find((r) => r.storey === 0 && !/stair|corridor/.test(r.kind)) ?? plan?.rooms.find((r) => r.storey === 0);
    const rid = ground ? `room:${ground.id}` : `building:${l.building}`;
    const t = { floor: roleTex(rid, "floor", "frame-cement"), wall: roleTex(`building:${l.building}`, "wall"), ceiling: roleTex(rid, "ceiling", "frame-cement") }; // prettier-ignore
    addSpace(`shell:${l.building}`, boxPoly(rectBox(l.rect)), l.zBase, roof, t, { grid: false });
  }
  // stage 4: hallways, connectors, checkpoint rooms and posts
  const hallTex = new Map();
  for (const h of net.hallways) {
    if (h.unrouted) continue;
    const id = `way:${h.id}`;
    // a hallway with no thing of its own in 06 (an MSR building's passage) wears the MSR's set, else its layer's frame
    const hf = h.kind === "passage" ? { floor: "msr-floor", wall: "msr-wall", ceiling: "msr-flat" } : { floor: layerOf(h.layer)?.frame, wall: layerOf(h.layer)?.frame, ceiling: layerOf(h.layer)?.frame }; // prettier-ignore
    const t = { floor: roleTex(id, "floor", hf.floor), wall: roleTex(id, "wall", hf.wall), ceiling: roleTex(id, "ceiling", hf.ceiling) };
    hallTex.set(h.id, t);
    for (const [i, g] of (h.legs ?? []).entries()) {
      const [a, b] = [g.from, g.to];
      const dx = Math.sign(b[0] - a[0]);
      const dy = Math.sign(b[1] - a[1]);
      const hw = h.width / 2;
      const bx = [Math.min(a[0], b[0]) - (dx ? 0 : hw), Math.min(a[1], b[1]) - (dy ? 0 : hw), Math.max(a[0], b[0]) + (dx ? 0 : hw), Math.max(a[1], b[1]) + (dy ? 0 : hw)]; // prettier-ignore
      // a leg's ends meet the next leg's: grown by half the width along its line, so the turns are full
      const g2 = [bx[0] - (dx ? hw : 0), bx[1] - (dy ? hw : 0), bx[2] + (dx ? hw : 0), bx[3] + (dy ? hw : 0)];
      addSpace(`hall:${h.id}#${i}`, boxPoly(g2), g.z[0], g.z[1], t, { flex: true });
    }
  }
  /** A layer's floor when z is a slab's depth under it (a connector's first flight), else z. */
  const floorNear = (z) => layers.find((L) => L.floor >= z - 1e-6 && L.floor - z <= 0.1)?.floor ?? z;
  const connectorTex = (c) => {
    const id = [...things.keys()].find((k) => k.startsWith(`connector:${c.id}@`));
    return id ? { floor: roleTex(id, "floor"), wall: roleTex(id, "wall"), ceiling: roleTex(id, "wall") } : null;
  };
  for (const c of net.connectors) {
    if (c.unplaced) continue;
    const t = connectorTex(c) ?? { floor: tex.ofRole("frame-cement"), wall: tex.ofRole("frame-cement"), ceiling: tex.ofRole("frame-cement") }; // prettier-ignore
    const straight = c.form === "straight";
    for (const [i, p] of c.pieces.entries()) {
      if (["well", "shaft", "stub"].includes(p.kind) || (straight && ["flight", "landing"].includes(p.kind)))
        addSpace(`conn:${c.id}#${i}`, p.poly, floorNear(p.z[0]), p.z[1], t, { flex: true });
    }
  }
  for (const cp of net.checkpoints)
    for (const [i, r] of cp.rooms.entries()) {
      if (!r.rect) continue;
      const id = `checkpoint:${cp.id}.${i}`;
      const t = { floor: roleTex(id, "floor"), wall: roleTex(id, "wall"), ceiling: roleTex(id, "ceiling") };
      const inset = r.kind === "gate" ? 0 : ROOM_WALL / cu;
      const poly = r.kind === "gate" && r.poly ? r.poly : boxPoly(grow(rectBox(r.rect), -inset));
      addSpace(`cp:${cp.id}#${i}`, poly, r.z[0], r.z[1], t);
    }
  for (const p of net.posts) {
    const id = `post:${p.id}`;
    const t = { floor: roleTex(id, "floor"), wall: roleTex(id, "wall"), ceiling: roleTex(id, "ceiling") };
    addSpace(`post:${p.id}`, boxPoly(grow(rectBox(p.rect), -ROOM_WALL / cu)), p.z[0], p.z[1], t);
  }
  // the openings of 04's doors through a carved room's wall (a checkpoint's, a post's)
  const cpDoors = wir.doors.filter((d) => d.source === "04-checkpoint");
  const cpRooms = net.checkpoints.flatMap((cp) => cp.rooms.map((r, i) => ({ ...r, id: `${cp.id}.${i}`, cp: cp.id }))).concat(net.posts.map((p) => ({ ...p, kind: "post", id: p.id }))); // prettier-ignore
  const doorFrames = new Map(); // door name -> { at, facing, width, height }
  for (const d of cpDoors) {
    const room = cpRooms.find((r) => r.id === d.id || d.id.startsWith(`${r.id}`)) ?? nearestRoom(cpRooms, d.at);
    if (!room) continue;
    const side = nearestSide(rectBox(room.rect), d.at);
    const wM = d.width_m ?? 1.2;
    const wc = wM / cellM;
    const along = side.axis === 0 ? [d.at[0] - wc / 2, d.at[0] + wc / 2] : [d.at[1] - wc / 2, d.at[1] + wc / 2];
    const depth = (ROOM_WALL * 2) / cu;
    const bx = side.axis === 0 ? [along[0], side.line - depth, along[1], side.line + depth] : [side.line - depth, along[0], side.line + depth, along[1]]; // prettier-ignore
    const z0 = d.at[2];
    const hc = HALF_STOREY; // a door's opening one half storey high (2.44 m): no carve height of its own
    addSpace(`opening:${d.name}`, boxPoly(bx), z0, z0 + hc, null, { flex: true, opening: true });
    doorFrames.set(d.name, { at: [d.at[0], d.at[1]], facing: side.normal, width: wM, height: hc * cellM, wall: (ROOM_WALL * 2) * M_PER_UNIT });
  }
  // the forms' cuts
  for (const f of forms.forms)
    for (const [i, p] of (f.parts ?? []).entries()) {
      if (p.build !== "cut") continue;
      const L = layerOf(f.layer) ?? layerAtZ(p.z[0]);
      addSpace(`cut:${f.id}#${i}`, p.poly, p.z[0], p.z[1], { floor: frameTex(L), wall: frameTex(L), ceiling: frameTex(L) }, { grid: false }); // prettier-ignore
    }
  // water: a canal's channel and its water (a world brush of a `!` texture: water contents, as GoldSrc maps keep it)
  for (const w of site.ways.filter((x) => x.water)) {
    const L = layerOf(w.layer);
    const water = tex.ofRole("water");
    const depth = 1;
    for (const part of w.parts ?? [])
      for (let i = 0; i + 1 < part.length; i++) {
        const poly = bandPoly(part[i], part[i + 1], w.water);
        addSpace(`canal:${w.id}#${i}`, poly, L.floor - depth, L.floor + 0.01, { floor: frameTex(L), wall: frameTex(L), ceiling: frameTex(L) }, { grid: false }); // prettier-ignore
        const c = clipToBox(poly.map((p) => [X(p[0]), Y(p[1])]), tileU);
        if (c) addWorld(prism("z", c.map((p) => p.map(round)), round(Zc(L.floor - depth)), round(Zc(L.floor) - KERB), water), "water");
      }
  }

  // ── the carve's heights: within rock.maxHeights per layer ──
  // a layer past its cap has its flexible spaces (hallways, connectors, openings) moved onto the heights the others
  // keep (a floor down, a head up): a taller tunnel, no new slice; a door's opening grown so gets a lintel of detail
  const maxHeights = desc.rules?.rock?.maxHeights ?? {};
  const heightsOf = (list) => {
    const by = new Map(layers.map((L) => [L.id, new Set()]));
    for (const sp of list) for (const z of sp.cells.z) by.get(layerAtZ(z).id)?.add(z);
    return by;
  };
  let hs = heightsOf(spaces);
  for (const L of layers) {
    const max = maxHeights[L.id];
    if (max === undefined || hs.get(L.id).size <= max) continue;
    const fixed = new Set([...anchors.get(L.id), ...spaces.filter((sp) => !sp.flex).flatMap((sp) => sp.cells.z)]);
    const all = [...new Set([...fixed, ...[...anchors.values()].flatMap((a) => [...a])])].sort((a, b) => a - b);
    const inL = (z) => layerAtZ(z).id === L.id;
    for (const sp of spaces) {
      if (!sp.flex) continue;
      const [z0, z1] = sp.cells.z;
      const n0 = inL(z0) && !fixed.has(z0) ? Math.max(...all.filter((a) => a <= z0)) : z0;
      const n1 = inL(z1) && !fixed.has(z1) ? Math.min(...all.filter((a) => a >= z1)) : z1;
      if (n0 === z0 && n1 === z1) continue;
      if (sp.opening && n1 > z1) addDetail("openings", B([Math.min(...sp.outlines[0].map((p) => p[0])), Math.min(...sp.outlines[0].map((p) => p[1])), Zc(z1)], [Math.max(...sp.outlines[0].map((p) => p[0])), Math.max(...sp.outlines[0].map((p) => p[1])), Zc(n1)], frameTex(L)), "lintel"); // prettier-ignore
      sp.cells.z = [n0, n1];
      sp.floor = round(Zc(n0));
      sp.ceiling = round(Zc(n1));
      sp.moved = true;
    }
    const moved = spaces.filter((sp) => sp.moved).length;
    hs = heightsOf(spaces);
    notes.push(`${L.id}: ${moved} hallway, connector and opening spaces moved onto the layer's own heights to keep the carve within ${max} (now ${hs.get(L.id).size})`); // prettier-ignore
  }
  for (const L of layers) for (const z of hs.get(L.id)) heightsBy.get(L.id).add(z);

  // ── the carve ──
  const fallbackTex = { floor: tex.ofRole("frame-cement"), wall: tex.ofRole("frame-cement"), ceiling: tex.ofRole("frame-cement") };
  const filled = spaces.map((s) => (s.texture ? s : { ...s, texture: fallbackTex }));
  const rock = carvePlan(filled.map(({ cells, flex, opening, moved, ...s }) => s), WALL, fallbackTex);
  // facades wear their own palette: a face of rock whose back is in a facade lot, under its roof
  const facades = lots.lots.filter((l) => l.kind === "facade" && l.tile === site.tile.id).map((l) => ({ l, b: [X(l.rect.x), Y(l.rect.y), X(l.rect.x + l.rect.w), Y(l.rect.y + l.rect.d)], z: [Zc(l.zBase), Zc(l.zBase + (l.facade?.height ?? storey))], wall: roleTex(`facade:${l.id}`, "wall") })); // prettier-ignore
  let worn = 0;
  for (const brush of rock) {
    const shape = shapeOf(brush);
    shape.faces.forEach((face, i) => {
      if (!face.normal || Math.abs(face.normal[2]) > 0.5 || !face.polygon.length || face.texture === "sky") return;
      const c = [0, 1, 2].map((k) => face.polygon.reduce((s, p) => s + p[k], 0) / face.polygon.length);
      const back = [c[0] - face.normal[0] * 4, c[1] - face.normal[1] * 4];
      const f = facades.find((x) => inBox(back, x.b) && c[2] >= x.z[0] && c[2] <= x.z[1]);
      if (f && brush.faces[i].texture !== f.wall) {
        brush.faces[i] = { ...brush.faces[i], texture: f.wall };
        worn++;
      }
    });
  }
  if (worn) notes.push(`${worn} faces of rock wear their facade's wall (the district's palette)`);

  // ── buildings ──
  for (const l of enterable) {
    const plan = planOf.get(l.building);
    if (!plan) {
      notes.push(`${l.building}: no plan in 05 (its shell carved, nothing inside)`);
      continue;
    }
    buildBuilding({ l, plan, L: layerOf(l.layer), openSky: openSky(layerOf(l.layer), rectBox(l.rect)) });
  }

  function buildBuilding({ l, plan, L, openSky: open }) {
    const F = plan.frame;
    const [oxc, oyc] = F.origin_cells;
    const mx = (m) => X(oxc + m / cellM);
    const my = (m) => Y(oyc + m / cellM);
    const mz = (m) => (m / cellM) * cu;
    const g = `building:${l.building}`;
    const zBase = Zc(l.zBase);
    const roof = Zc(l.zBase + l.storeys * storey);
    const storeyZ = (s) => mz(plan.storeys.find((x) => x.storey === s)?.z_m ?? (l.zBase + s * storey) * cellM);
    const slabU = (F.slab_m ?? 0.203) / M_PER_UNIT;
    const topOf = (s) => (s + 1 < plan.storeys.length ? storeyZ(s + 1) - slabU : roof);
    const wallTex = roleTex(`building:${l.building}`, "wall");
    const roomById = new Map(plan.rooms.map((r) => [r.id, r]));
    const cellDoors = new Set(plan.doors.filter((d) => d.kind === "cell").map((d) => d.id));
    const roomTex = (rid, key) => roleTex(`room:${rid}`, key, key === "floor" ? "frame-cement" : null);
    // the shell's walls: world, on the outline, cut by every exterior door
    const t = F.exteriorWall_m / M_PER_UNIT;
    for (const sh of plan.shells ?? []) {
      const inner = [mx(sh.rect.x), my(sh.rect.y), mx(sh.rect.x + sh.rect.w), my(sh.rect.y + sh.rect.d)];
      const outer = grow(inner, t);
      const holes = [];
      for (const w of plan.walls.filter((x) => x.kind === "exterior")) {
        const a = [mx(w.a[0]), my(w.a[1])];
        const b = [mx(w.b[0]), my(w.b[1])];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        for (const h of w.holes.filter((x) => x.kind === "door")) {
          const c = [a[0] + u[0] * (h.along_m / M_PER_UNIT), a[1] + u[1] * (h.along_m / M_PER_UNIT)];
          const half = h.width / M_PER_UNIT / 2;
          holes.push({ c, u, half, z0: storeyZ(w.storey), z1: storeyZ(w.storey) + h.height / M_PER_UNIT });
        }
      }
      // the four sides: s and n the full width, w and e between them
      const sides = [
        { axis: 0, box: [outer[0], outer[1], outer[2], inner[1]] },
        { axis: 0, box: [outer[0], inner[3], outer[2], outer[3]] },
        { axis: 1, box: [outer[0], inner[1], inner[0], inner[3]] },
        { axis: 1, box: [inner[2], inner[1], outer[2], inner[3]] },
      ];
      for (const s of sides) {
        const mine = holes.filter((h) => inBox(h.c, grow(s.box, 2)) && Math.abs(h.u[s.axis]) > 0.5);
        const a0 = s.box[s.axis];
        const a1 = s.box[s.axis + 2];
        const cuts = [...new Set([a0, a1, ...mine.flatMap((h) => [h.c[s.axis] - h.half, h.c[s.axis] + h.half])])].filter((v) => v >= a0 && v <= a1).sort((p, q) => p - q); // prettier-ignore
        for (let i = 0; i + 1 < cuts.length; i++) {
          const [u0, u1] = [cuts[i], cuts[i + 1]];
          if (u1 - u0 < 0.5) continue;
          const mid = (u0 + u1) / 2;
          const gaps = mine.filter((h) => Math.abs(mid - h.c[s.axis]) < h.half).map((h) => [h.z0, h.z1]).sort((p, q) => p[0] - q[0]); // prettier-ignore
          let z = zBase;
          const runs = [];
          for (const [g0, g1] of gaps) {
            if (g0 > z) runs.push([z, g0]);
            z = Math.max(z, g1);
          }
          if (roof > z) runs.push([z, roof]);
          for (const [z0, z1] of runs) {
            const min = s.axis === 0 ? [u0, s.box[1], z0] : [s.box[0], u0, z0];
            const max = s.axis === 0 ? [u1, s.box[3], z1] : [s.box[2], u1, z1];
            addWorld(B(min, max, wallTex), "shell");
          }
        }
      }
      if (open) addWorld(B([outer[0], outer[1], roof], [outer[2], outer[3], roof + SLAB], { top: roleTex(`building:${l.building}`, "trim"), bottom: roomTex(plan.rooms.find((r) => r.storey === plan.storeys.length - 1)?.id, "ceiling"), sides: wallTex }), "roof"); // prettier-ignore
    }
    // the tower over the roof: a world prism of its silhouette
    if (l.tower) {
      const T = l.tower;
      const sides = T.silhouette === "round" ? 16 : T.silhouette === "octagon" ? 8 : 4;
      const r = (T.across / 2) * cu;
      const c = [X(T.at[0]), Y(T.at[1])];
      const ring = Array.from({ length: sides }, (_, k) => {
        const a = (2 * Math.PI * (k + 0.5)) / sides;
        return [round(c[0] + r * Math.cos(a)), round(c[1] + r * Math.sin(a))];
      });
      addWorld(prism("z", ring, round(Zc(T.z[0])), round(Zc(T.z[1])), roleTex(`tower:${l.building}`, "wall.shaft")), "tower");
    }
    // interior and court walls: detail, holes for doors
    for (const w of plan.walls) {
      if (w.kind === "exterior") continue;
      const a = [mx(w.a[0]), my(w.a[1])];
      const b = [mx(w.b[0]), my(w.b[1])];
      const axis = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 0 : 1;
      const th = w.thickness_m / M_PER_UNIT;
      let off = [-th / 2, th / 2];
      if (w.kind === "court") {
        // outside its room's face: away from the room
        const room = roomById.get(w.rooms?.[0]);
        const rc = room?.rects?.[0];
        const across = axis === 0 ? a[1] : a[0];
        const rcAcross = rc ? (axis === 0 ? my(rc.y + rc.d / 2) : mx(rc.x + rc.w / 2)) : across;
        off = rcAcross > across ? [-th, 0] : [0, th];
      }
      const lo = Math.min(a[axis], b[axis]);
      const hi = Math.max(a[axis], b[axis]);
      const along0 = axis === 0 ? (a[0] <= b[0] ? a : b) : a[1] <= b[1] ? a : b;
      const sign = (axis === 0 ? b[0] - a[0] : b[1] - a[1]) >= 0 ? 1 : -1;
      const z0 = storeyZ(w.storey);
      const z1 = topOf(w.storey);
      const texA = roomTex(w.rooms?.[0], "wall");
      const texB = roomTex(w.rooms?.[1] ?? w.rooms?.[0], "wall");
      let holes = w.holes.filter((h) => h.kind === "door").map((h) => {
        const c = (axis === 0 ? a[0] : a[1]) + sign * (h.along_m / M_PER_UNIT);
        return [c - h.width / M_PER_UNIT / 2, c + h.width / M_PER_UNIT / 2, h.height / M_PER_UNIT];
      });
      // a cell's front: bars below its door's head the whole length (cellFront), the wall only over them
      const cellHole = w.holes.find((h) => h.kind === "door" && cellDoors.has(h.door));
      if (cellHole) holes = [[Math.min(a[axis], b[axis]), Math.max(a[axis], b[axis]), cellHole.height / M_PER_UNIT]];
      const cuts = [...new Set([lo, hi, ...holes.flatMap((h) => [h[0], h[1]])])].filter((v) => v >= lo && v <= hi).sort((p, q) => p - q); // prettier-ignore
      const across = axis === 0 ? along0[1] : along0[0];
      for (let i = 0; i + 1 < cuts.length; i++) {
        const [u0, u1] = [cuts[i], cuts[i + 1]];
        if (u1 - u0 < 0.5) continue;
        const hole = holes.find((h) => (u0 + u1) / 2 > h[0] && (u0 + u1) / 2 < h[1]);
        const zLow = hole ? z0 + hole[2] : z0;
        if (z1 - zLow < 0.5) continue;
        const min = axis === 0 ? [u0, across + off[0], zLow] : [across + off[0], u0, zLow];
        const max = axis === 0 ? [u1, across + off[1], z1] : [across + off[1], u1, z1];
        const sides = axis === 0 ? { south: texA, north: texB, sides: texA } : { west: texA, east: texB, sides: texA };
        addDetail(g, B(min, max, sides), hole ? "lintel" : "wall");
      }
    }
    // slabs under each upper storey's rooms, less the holes over the flights below
    const stairHoles = new Map(); // storey -> boxes (units)
    for (const st of plan.stairs) {
      const s = st.storey + 1;
      const bx = flightsBox(st);
      if (!stairHoles.has(s)) stairHoles.set(s, []);
      stairHoles.get(s).push(bx);
    }
    function flightsBox(st) {
      const pts = [];
      for (const f of st.flights) {
        const fa = [mx(f.at[0]), my(f.at[1])];
        const end = [fa[0] + f.facing[0] * (f.run / M_PER_UNIT), fa[1] + f.facing[1] * (f.run / M_PER_UNIT)];
        const half = f.width / M_PER_UNIT / 2;
        const side = [-f.facing[1] * half, f.facing[0] * half];
        for (const p of [fa, end]) pts.push([p[0] + side[0], p[1] + side[1]], [p[0] - side[0], p[1] - side[1]]);
      }
      return boxOf(pts);
    }
    for (const r of plan.rooms) {
      if (r.storey === 0) continue;
      const zTop = storeyZ(r.storey);
      const holes = stairHoles.get(r.storey) ?? [];
      for (const rc of r.rects ?? []) {
        const b = [mx(rc.x), my(rc.y), mx(rc.x + rc.w), my(rc.y + rc.d)];
        const below = plan.rooms.find((q) => q.storey === r.storey - 1 && (q.rects ?? []).some((qr) => inBox([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], [mx(qr.x), my(qr.y), mx(qr.x + qr.w), my(qr.y + qr.d)]))); // prettier-ignore
        for (const p of boxMinus(b, holes)) addDetail(g, B([p[0], p[1], zTop - slabU], [p[2], p[3], zTop], { top: roomTex(r.id, "floor"), bottom: roomTex(below?.id ?? r.id, "ceiling"), sides: roomTex(r.id, "wall") }), "slab"); // prettier-ignore
      }
    }
    // stairs: each flight stepped, each half landing a slab
    for (const st of plan.stairs) {
      const z0 = (st.z_m / cellM) * cu;
      const room = roomById.get(st.from) ?? roomById.get(st.id);
      const stex = room ? roomTex(room.id, "floor") : tex.ofRole("frame-cement");
      for (const f of st.flights) {
        const fa = [mx(f.at[0]), my(f.at[1])];
        const run = f.run / M_PER_UNIT;
        const half = f.width / M_PER_UNIT / 2;
        const end = [fa[0] + f.facing[0] * run, fa[1] + f.facing[1] * run];
        const side = [Math.abs(f.facing[1]) * half, Math.abs(f.facing[0]) * half];
        const min = [Math.min(fa[0], end[0]) - side[0], Math.min(fa[1], end[1]) - side[1], z0 + f.z / M_PER_UNIT];
        const max = [Math.max(fa[0], end[0]) + side[0], Math.max(fa[1], end[1]) + side[1], z0 + (f.z + f.rise) / M_PER_UNIT];
        const high = Math.abs(f.facing[0]) > 0.5 ? (f.facing[0] > 0 ? "+x" : "-x") : f.facing[1] > 0 ? "+y" : "-y";
        for (const b of stairBrushes(min, max, high, stex, f.risers)) addDetail(g, b, "stair");
      }
      if (st.halfLanding) {
        const hl = st.halfLanding;
        const c = [mx(hl.at[0]), my(hl.at[1])];
        const [sx, sy] = hl.size.map((v) => v / M_PER_UNIT / 2);
        const zt = z0 + hl.z / M_PER_UNIT;
        addDetail(g, B([c[0] - sx, c[1] - sy, zt - SLAB], [c[0] + sx, c[1] + sy, zt], stex), "landing");
      }
    }
    for (const pp of plan.parapets ?? []) {
      const a = [mx(pp.a[0]), my(pp.a[1])];
      const b = [mx(pp.b[0]), my(pp.b[1])];
      const th = pp.thickness_m / M_PER_UNIT / 2;
      const z0 = storeyZ(pp.storey);
      addDetail(g, B([Math.min(a[0], b[0]) - th, Math.min(a[1], b[1]) - th, z0], [Math.max(a[0], b[0]) + th, Math.max(a[1], b[1]) + th, z0 + pp.height_m / M_PER_UNIT], wallTex), "parapet"); // prettier-ignore
    }
    // the plan's doors' frames for the leaves (07 builds them by name)
    for (const d of plan.doors) {
      if (!d.at) continue;
      doorFrames.set(d.id, { at: [oxc + d.at[0] / cellM, oyc + d.at[1] / cellM], facing: d.facing, width: d.width, height: d.height, wall: d.wall, hinge: d.hinge, swing: d.swing, kind: d.kind, storeyZ: storeyZ(d.storey), building: l.building, plan, door: d }); // prettier-ignore
    }
  }

  /** A flight's steps: stairs() with its risers, or a single wedge-free box per riser when the box is too short. */
  function stairBrushes(min, max, high, texture, risers) {
    const m = min.map(round);
    const M = max.map(round);
    if (!(M[0] > m[0] && M[1] > m[1] && M[2] > m[2])) return [];
    const steps = stepsFor(M[2] - m[2], risers);
    try {
      return stairs(m, M, high, texture, { steps });
    } catch {
      return [box(m, M, texture)];
    }
  }

  // ── connectors: the steps in the wells and the runs, the lifts' shafts stay open ──
  for (const c of net.connectors) {
    if (c.unplaced || c.type === "lift") continue;
    const t = connectorTex(c)?.floor ?? tex.ofRole("frame-cement");
    const g = `connector:${c.id}`;
    const pieces = c.pieces.filter((p) => p.kind === "flight" || p.kind === "landing");
    if (!pieces.length) continue;
    const stops = c.stops.map((s) => c.exits?.find((e) => e.stop === s)?.z).filter((z) => z !== undefined);
    const zLow = stops.length ? Math.min(...stops) : pieces[0].z[0];
    const zHigh = stops.length ? Math.max(...stops) : pieces.at(-1).z[1];
    const runOf = (p) => Math.hypot(p.poly[1][0] - p.poly[0][0], p.poly[1][1] - p.poly[0][1]);
    const totalRun = pieces.filter((p) => p.kind === "flight").reduce((s, p) => s + runOf(p), 0) || 1;
    let z = zLow;
    // a switchback's landings reach along the well to its flights (stage 4 leaves a gap at the turn)
    const fl = pieces.filter((p) => p.kind === "flight");
    const fbox = fl.length ? boxOf(fl.flatMap((p) => p.poly)) : null;
    const runAxis = fl.length && Math.abs(fl[0].poly[1][0] - fl[0].poly[0][0]) >= Math.abs(fl[0].poly[1][1] - fl[0].poly[0][1]) ? 0 : 1;
    const reach = (p) => {
      if (c.form !== "switchback" || p.kind !== "landing" || !fbox) return p.poly;
      const b = boxOf(p.poly);
      if (b[runAxis + 2] <= fbox[runAxis] + 1e-6) b[runAxis + 2] = fbox[runAxis];
      else if (b[runAxis] >= fbox[runAxis + 2] - 1e-6) b[runAxis] = fbox[runAxis + 2];
      return boxPoly(b);
    };
    for (const p of pieces) {
      const clipped = clipToBox(reach(p).map((q) => [X(q[0]), Y(q[1])]), tileU);
      if (!clipped) continue;
      if (p.kind === "landing") {
        const top = c.form === "switchback" ? p.z[1] : z;
        if (top - zLow > 1e-6 || c.form === "switchback") addDetail(g, prismOf(clipped, Zc(top) - SLAB, Zc(top), t), "landing");
        continue;
      }
      const lo = c.form === "switchback" ? p.z[0] : z;
      const hi = c.form === "switchback" ? p.z[1] : z + ((zHigh - zLow) * runOf(p)) / totalRun;
      z = hi;
      for (const b of flightOf(p.poly, Zc(lo), Zc(hi), t, p.risers)) addDetail(g, b, "stair");
    }
  }
  /** A prism of a unit outline (whole units) from z0 to z1. */
  function prismOf(poly, z0, z1, texture) {
    const ring = poly.map((p) => [round(p[0]), round(p[1])]);
    if (!(round(z1) > round(z0)) || area(ring) < 4) return null;
    try {
      return prism("z", ring, round(z0), round(z1), texture);
    } catch {
      return null;
    }
  }
  /** A flight along its poly (poly[0] -> poly[1] the run, rising), as steps of whole risers. */
  function flightOf(poly, z0, z1, texture, risers) {
    const p = poly.map((q) => [X(q[0]), Y(q[1])]);
    const u = [p[1][0] - p[0][0], p[1][1] - p[0][1]];
    const v = [p[3][0] - p[0][0], p[3][1] - p[0][1]];
    const n = stepsFor(z1 - z0, risers);
    const out = [];
    for (let k = 0; k < n; k++) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      const ring = [
        [p[0][0] + u[0] * t0, p[0][1] + u[1] * t0],
        [p[0][0] + u[0] * t1, p[0][1] + u[1] * t1],
        [p[0][0] + u[0] * t1 + v[0], p[0][1] + u[1] * t1 + v[1]],
        [p[0][0] + u[0] * t0 + v[0], p[0][1] + u[1] * t0 + v[1]],
      ];
      const b = prismOf(ring, Math.min(z0, z1 - 1) - SLAB, z0 + ((z1 - z0) * (k + 1)) / n, texture);
      if (b) out.push(b);
    }
    return out;
  }

  // ── streets: sidewalks and porticoes as kerbs, squares' porticoes, columns, monuments, bridges ──
  for (const w of site.ways) {
    if (w.class === "service" || w.water) continue;
    const L = layerOf(w.layer);
    const id = `way:${w.id}`;
    const side = Math.max(w.sidewalk ?? 0, w.portico ?? 0);
    if (!(side > 0) || !(w.carriageway > 0)) continue;
    const kt = { top: roleTex(id, "floor", L.frame), bottom: roleTex(id, "floor", L.frame), sides: roleTex(id, "trim.curb", "curb-pavement") };
    for (const part of w.parts ?? [])
      for (let i = 0; i + 1 < part.length; i++) {
        const [a, b] = [part[i], part[i + 1]];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const n = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
        for (const sg of [1, -1]) {
          const off = sg * (w.carriageway / 2 + side / 2);
          const a2 = [a[0] + n[0] * off, a[1] + n[1] * off];
          const b2 = [b[0] + n[0] * off, b[1] + n[1] * off];
          const c = clipToBox(bandPoly(a2, b2, side).map((p) => [X(p[0]), Y(p[1])]), tileU);
          if (c) addDetail("streets", prismOf(c, Zc(L.floor), Zc(L.floor) + KERB, kt), "kerb");
        }
      }
  }
  for (const col of net.colonnades) {
    const L = layerOf(col.layer);
    const ref = col.plaza ? `colonnade:${col.plaza}` : `colonnade:${col.way}`;
    const ctex = roleTex(ref, "trim.column", "stone-pillar-plain");
    const half = (col.column / 2) * cu;
    for (const c of col.columns) {
      const at = [X(c.at[0]), Y(c.at[1])];
      addDetail("streets", B([at[0] - half, at[1] - half, Zc(col.z[0])], [at[0] + half, at[1] + half, Zc(col.z[1])], ctex), "column");
    }
    const vt = { bottom: roleTex(ref, "ceiling.vault", "frame-cement"), top: frameTex(L), sides: frameTex(L) };
    if (col.plaza && col.line) {
      const pz = site.plazas.find((p) => p.id === col.plaza);
      if (pz) for (const p of boxMinus(pz.box, [col.line])) addDetail("streets", B([X(p[0]), Y(p[1]), Zc(col.z[1])], [X(p[2]), Y(p[3]), Zc(col.z[1]) + SLAB], vt), "vault"); // prettier-ignore
    }
  }
  for (const pz of site.plazas)
    for (const m of pz.monuments ?? []) {
      const id = `monument:${m.id}`;
      const c = [X(m.at[0]), Y(m.at[1])];
      const [bw, bd] = (m.base ?? [1, 1]).map((v) => (v / 2) * cu);
      const z0 = Zc(m.z[0]);
      const plinth = Math.min(0.5 * cu, (Zc(m.z[1]) - z0) / 6);
      addDetail("streets", B([c[0] - bw, c[1] - bd, z0], [c[0] + bw, c[1] + bd, z0 + plinth], roleTex(id, "floor.plinth")), "monument");
      const r = ((m.across ?? 1) / 2) * cu;
      const ring = Array.from({ length: 8 }, (_, k) => [round(c[0] + r * Math.cos((Math.PI * (2 * k + 1)) / 8)), round(c[1] + r * Math.sin((Math.PI * (2 * k + 1)) / 8))]); // prettier-ignore
      addDetail("streets", prismOf(ring, z0 + plinth, Zc(m.z[1]) - plinth, roleTex(id, "trim.shaft")), "monument");
      addDetail("streets", B([c[0] - r * 1.4, c[1] - r * 1.4, Zc(m.z[1]) - plinth], [c[0] + r * 1.4, c[1] + r * 1.4, Zc(m.z[1])], roleTex(id, "trim.crown")), "monument"); // prettier-ignore
    }
  for (const h of net.hallways)
    for (const br of h.bridges ?? []) {
      const id = `way:${h.id}`;
      const ht = hallTex.get(h.id);
      const t = { top: ht?.floor ?? roleTex(id, "floor"), bottom: frameTex(layerOf(h.layer)), sides: ht?.wall ?? roleTex(id, "wall") };
      const a = [X(br.from[0]), Y(br.from[1])];
      const b = [X(br.to[0]), Y(br.to[1])];
      const ax = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 0 : 1;
      const hw = (h.width / 2) * cu;
      const lo = [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
      const hi = [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
      const zf = Zc(br.z[0]);
      const zt = Zc(br.z[1]);
      const o = ax === 0 ? [0, hw] : [hw, 0];
      const outer = [lo[0] - o[0], lo[1] - o[1], hi[0] + o[0], hi[1] + o[1]];
      addDetail("streets", B([outer[0], outer[1], zf - SLAB], [outer[2], outer[3], zf], t), "bridge");
      addDetail("streets", B([outer[0], outer[1], zt], [outer[2], outer[3], zt + SLAB], t), "bridge");
      const w8 = 8;
      if (ax === 0) {
        addDetail("streets", B([outer[0], outer[1] - w8, zf - SLAB], [outer[2], outer[1], zt + SLAB], t), "bridge");
        addDetail("streets", B([outer[0], outer[3], zf - SLAB], [outer[2], outer[3] + w8, zt + SLAB], t), "bridge");
      } else {
        addDetail("streets", B([outer[0] - w8, outer[1], zf - SLAB], [outer[0], outer[3], zt + SLAB], t), "bridge");
        addDetail("streets", B([outer[2], outer[1], zf - SLAB], [outer[2] + w8, outer[3], zt + SLAB], t), "bridge");
      }
    }
  // a facade's door that does not open: a plate on its front
  for (const f of lots.lots.filter((l) => l.kind === "facade" && l.tile === site.tile.id)) {
    const side = f.frontage?.side;
    if (!side) continue;
    const r = rectBox(f.rect);
    const mid = side === "n" || side === "s" ? (r[0] + r[2]) / 2 : (r[1] + r[3]) / 2;
    const line = { s: r[1], n: r[3], w: r[0], e: r[2] }[side];
    const out = { s: -1, n: 1, w: -1, e: 1 }[side];
    const hw = 0.4 * cu;
    const z0 = Zc(f.zBase);
    const zU = z0 + 2.4 / M_PER_UNIT;
    const t = roleTex(`facade:${f.id}`, "door");
    const lu = (side === "n" || side === "s" ? Y(line) : X(line));
    const m = side === "n" || side === "s" ? X(mid) : Y(mid);
    const [a0, a1] = [lu, lu + out * 2].sort((p, q) => p - q);
    const min = side === "n" || side === "s" ? [m - hw, a0, z0] : [a0, m - hw, z0];
    const max = side === "n" || side === "s" ? [m + hw, a1, zU] : [a1, m + hw, zU];
    addDetail("facades", B(min, max, t), "facade-door");
  }

  // ── stage 8's props ──
  for (const p of dress.props) {
    const r = p.rect;
    const z0 = Zc(p.z ?? 0) + (p.place === "street" ? 0 : 0);
    const h = (p.size_m?.[2] ?? 1) / M_PER_UNIT;
    const b = [X(r.x), Y(r.y), X(r.x + r.w), Y(r.y + r.d)];
    const centre = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    if (!inBox(centre, tileU)) {
      dropped.push(`${p.id}: outside the tile's box`);
      continue;
    }
    if (p.build === "model" && PROP_MODELS[p.kind]) {
      const yaw = Math.round((Math.atan2(p.facing?.[1] ?? 0, p.facing?.[0] ?? 1) * 180) / Math.PI);
      addEntity(pointEntity("ts_model", [round(centre[0]), round(centre[1]), round(z0)], { model: PROP_MODELS[p.kind], angles: [0, yaw, 0] }), "prop-model");
      continue;
    }
    const t = tex.ofName(PROP_TEXTURES[p.kind] ?? PROP_DEFAULT, null);
    addDetail(p.place === "street" ? "props-street" : `props:${p.building}`, B([b[0], b[1], z0], [b[2], b[3], z0 + h], t), p.build === "model" ? "prop-model-box" : "prop");
  }

  // ── stage 9's forms ──
  const groups = new Map(); // brush entity group -> { classname, keys, brushes }
  for (const f of forms.forms) {
    const L = layerOf(f.layer) ?? layers[0];
    for (const [i, p] of (f.parts ?? []).entries()) {
      if (p.build === "cut") continue;
      const role = p.role ?? f.role ?? null;
      const t = p.texture ? tex.ofName(p.texture, role ?? L.frame) : role ? tex.ofRole(role) : frameTex(L);
      const brush = formBrush(p, t);
      if (!brush) {
        notes.push(`${f.id} part ${i} (${p.shape}${p.what ? `, ${p.what}` : ""}) makes no sound brush: left out`);
        continue;
      }
      const build = p.build ?? f.build ?? "detail";
      if (build === "world") addWorld(brush, `form:${f.kind}`);
      else if (build === "entity") {
        const key = p.group ?? `${f.id}#${i}`;
        if (!groups.has(key)) groups.set(key, { classname: p.entity ?? "func_wall", keys: { ...(p.keys ?? {}) }, brushes: [], kind: f.kind });
        groups.get(key).brushes.push(brush);
      } else addDetail(`forms:${f.family}`, brush, `form:${f.kind}`);
    }
    for (const pt of f.points ?? []) {
      const at = [round(X(pt.at[0])), round(Y(pt.at[1])), round(Zc(pt.at[2]))];
      addEntity(pointEntity(pt.classname, at, pt.keys ?? {}), `form-point:${pt.classname}`);
    }
  }
  for (const [key, gr] of groups) {
    const keys = { ...gr.keys };
    if (keys.origin) keys.origin = [round(X(keys.origin[0])), round(Y(keys.origin[1])), round(Zc(keys.origin[2]))];
    const brushes = [...gr.brushes];
    if (gr.classname === "func_rotating" && keys.origin) {
      brushes.push(originBrush(keys.origin, 8));
      delete keys.origin;
    }
    if (gr.brushes.some((b) => b.faces.some((fc) => fc.texture.startsWith("{")))) Object.assign(keys, { rendermode: keys.rendermode ?? 4, renderamt: keys.renderamt ?? 255 }); // prettier-ignore
    addEntity(brushEntity(gr.classname, brushes, keys), `form-entity:${gr.classname}`);
  }

  /** A form's part as one brush (units), or null. */
  function formBrush(p, t) {
    const poly = p.poly.map((q) => [X(q[0]), Y(q[1])]);
    const z0 = Zc(p.z[0]);
    const z1 = Zc(p.z[1]);
    try {
      if (p.shape === "box" || p.shape === "prism") return prismOf(poly, z0, z1, t);
      if (p.shape === "frustum") return solid([...poly.map((q) => [q[0], q[1], z0]), ...p.top.map((q) => [X(q[0]), Y(q[1]), z1])], t);
      if (p.shape === "wedge") {
        const edge = (p.edge ?? []).map((q) => [X(q[0]), Y(q[1])]);
        const flatBottom = /plinth|ramp|buttress|foot/.test(p.what ?? "");
        const [flat, edgeZ] = flatBottom ? [z0, z1] : [z1, z0];
        return solid([...poly.map((q) => [q[0], q[1], flat]), ...edge.map((q) => [q[0], q[1], edgeZ])], { name: typeof t === "string" ? t : t.name, align: "face" }); // prettier-ignore
      }
      if (p.shape === "voussoir" && p.soffit) {
        const f0 = [X(p.soffit.from[0]), Y(p.soffit.from[1])];
        const f1 = [X(p.soffit.to[0]), Y(p.soffit.to[1])];
        const d = [f1[0] - f0[0], f1[1] - f0[1]];
        const dd = d[0] * d[0] + d[1] * d[1] || 1;
        const zs = (q) => {
          const k = Math.max(0, Math.min(1, ((q[0] - f0[0]) * d[0] + (q[1] - f0[1]) * d[1]) / dd));
          return Zc(p.soffit.z[0] + (p.soffit.z[1] - p.soffit.z[0]) * k);
        };
        return solid([...poly.map((q) => [q[0], q[1], z1]), ...poly.map((q) => [q[0], q[1], Math.min(zs(q), z1 - 1)])], { name: typeof t === "string" ? t : t.name, align: "face" }); // prettier-ignore
      }
      if (p.shape === "diagonal") {
        // a brace across its strip: low at one end, high at the other, as thick as the strip is wide
        const e = longEdges(poly);
        const th = Math.min(z1 - z0, Math.max(8, e.width));
        const [lo, hi] = p.rises === "down" ? [e.b, e.a] : [e.a, e.b];
        return solid([...lo.map((q) => [q[0], q[1], z0]), ...lo.map((q) => [q[0], q[1], z0 + th]), ...hi.map((q) => [q[0], q[1], z1 - th]), ...hi.map((q) => [q[0], q[1], z1])], { name: typeof t === "string" ? t : t.name, align: "face" }); // prettier-ignore
      }
      if (p.shape === "octagon-run") {
        // a pipe: an octagon in section along the strip's long side
        const e = longEdges(poly);
        const r = Math.min(e.width, z1 - z0) / 2;
        const zc = (z0 + z1) / 2;
        const ca = [(e.a[0][0] + e.a[1][0]) / 2, (e.a[0][1] + e.a[1][1]) / 2];
        const cb = [(e.b[0][0] + e.b[1][0]) / 2, (e.b[0][1] + e.b[1][1]) / 2];
        const len = Math.hypot(cb[0] - ca[0], cb[1] - ca[1]) || 1;
        const n = [-(cb[1] - ca[1]) / len, (cb[0] - ca[0]) / len];
        const k = 0.4142 * r;
        const sec = [[-r, -k], [-r, k], [-k, r], [k, r], [r, k], [r, -k], [k, -r], [-k, -r]];
        const pts = [];
        for (const c of [ca, cb]) for (const [s, zz] of sec) pts.push([c[0] + n[0] * s, c[1] + n[1] * s, zc + zz]);
        return solid(pts, t);
      }
    } catch {
      return null;
    }
    return prismOf(poly, z0, z1, t);
  }
  /** A thin rectangle's two short ends (each two points) and its width. */
  function longEdges(poly) {
    const e = [0, 1, 2, 3].map((i) => [poly[i], poly[(i + 1) % 4]]);
    const len = (s) => Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]);
    const short = e.filter((s, i) => len(s) <= len(e[(i + 1) % 4]) + 1e-9);
    const [a, b] = short.length >= 2 ? [short[0], short[1]] : [e[0], e[2]];
    return { a, b, width: len(a) };
  }

  // ── the wiring contract: doors, switches, lifts, lights, sounds, spawns, signs ──
  const contract = { doors: [], buttons: [], lifts: [], lights: [], sounds: [], spawns: [], managers: [], cells: [] };
  const R = rules?.dimensions?.cellBars ?? { bar: { typical: 0.06 }, clearGap: { max: 0.2, typical: 0.16 }, maxBrushes: 20 };
  for (const d of wir.doors) {
    const fr = doorFrames.get(d.id) ?? doorFrames.get(d.name) ?? null;
    const e = doorEntity(d, fr);
    if (!e) {
      notes.push(`door ${d.name}: no frame to hang it in (${d.source}); left out`);
      continue;
    }
    contract.doors.push(d.name);
  }
  function doorEntity(d, fr) {
    const at = fr?.at ?? [d.at[0], d.at[1]];
    const facing = fr?.facing ?? [0, 1];
    const width = (fr?.width ?? d.width_m ?? 1.2) / M_PER_UNIT;
    const height = (fr?.height ?? 2.44) / M_PER_UNIT;
    const z0 = Zc(d.at[2]);
    const c = [X(at[0]), Y(at[1])];
    const u = [Math.abs(facing[1]) > 0.5 ? 1 : 0, Math.abs(facing[0]) > 0.5 ? 1 : 0]; // along the wall
    const half = width / 2 - 1;
    const th = LEAF / 2;
    const leafBox = (a0, a1, z, zt) => (u[0] ? B([c[0] + a0, c[1] - th, z], [c[0] + a1, c[1] + th, zt], dtex) : B([c[0] - th, c[1] + a0, z], [c[0] + th, c[1] + a1, zt], dtex)); // prettier-ignore
    const doorRole = slot(`door:${d.id}`, "door")?.role ?? slot(`checkpoint:${d.id}`, "door")?.role ?? slot(`post:${d.id}`, "door")?.role ?? (d.owner === "msr" ? "msr-door" : "frame-cement");
    const dtex = d.kind === "secret" ? (slot(`door:${d.id}`, "wall") ? roleTex(`door:${d.id}`, "wall") : d.texture ? tex.ofName(d.texture) : roleTex(`room:${d.room}`, "wall", "frame-cement")) : d.texture ? tex.ofName(d.texture, doorRole) : tex.ofRole(doorRole); // prettier-ignore
    const keys = { targetname: d.name, spawnflags: 256, wait: -1, speed: 100 };
    if (d.kind === "cell") return cellFront(d, fr, c, u, z0, height, keys);
    if (d.kind === "gate") {
      const leaf = leafBox(-half, half, z0 + 1, z0 + height);
      if (!leaf) return null;
      const gt = tex.ofRole("portcullis");
      const brush = u[0] ? B([c[0] - half, c[1] - th, z0 + 1], [c[0] + half, c[1] + th, z0 + height], gt) : B([c[0] - th, c[1] - half, z0 + 1], [c[0] + th, c[1] + half, z0 + height], gt); // prettier-ignore
      addEntity(brushEntity("func_door", [brush], { ...keys, angles: [-90, 0, 0], lip: 8, rendermode: 4, renderamt: 255 }), "door:gate");
      return true;
    }
    if (d.kind === "hatch") {
      const hw = Math.max(width / 2, 24);
      const brush = B([c[0] - hw, c[1] - hw, z0 - 4], [c[0] + hw, c[1] + hw, z0], dtex);
      if (!brush) return null;
      addEntity(brushEntity("func_door", [brush], { ...keys, angles: [0, 0, 0], lip: 4 }), "door:hatch");
      return true;
    }
    if (d.kind === "secret" || fr?.swing === "none") {
      const leaf = leafBox(-half, half, z0 + 1, z0 + height);
      if (!leaf) return null;
      const yaw = u[0] ? 0 : 90;
      addEntity(brushEntity("func_door", [leaf], { ...keys, angles: [0, yaw, 0], lip: 4 }), `door:${d.kind === "secret" ? "secret" : "sliding"}`);
      return true;
    }
    // hinged: the origin on the hinge, the leaf from it across the hole
    const hingeLow = fr?.hinge !== "high";
    const sign = hingeLow ? 1 : -1;
    const hinge = u[0] ? [c[0] - sign * half, c[1], z0 + height / 2] : [c[0], c[1] - sign * half, z0 + height / 2];
    const leaf = hingeLow ? leafBox(-half, half - 2, z0 + 1, z0 + height) : leafBox(-half + 2, half, z0 + 1, z0 + height);
    if (!leaf) return null;
    // which way it turns: from the leaf's direction (along u, away from the hinge) to its swing side (the facing)
    const dir = [u[0] * sign, u[1] * sign];
    const cr = dir[0] * facing[1] - dir[1] * facing[0];
    const flags = 256 + (cr < 0 ? 2 : 0);
    addEntity(brushEntity("func_door_rotating", [leaf, originBrush(hinge.map(round), 8)], { ...keys, spawnflags: flags, distance: 90, speed: 100 }), "door:hinged"); // prettier-ignore
    return true;
  }
  /** A cell's front as real bars: the leaf (bars in the door's hole) a func_door sliding along the wall. */
  function cellFront(d, fr, c, u, z0, height, keys) {
    const bar = Math.max(2, round(R.bar.typical / M_PER_UNIT));
    const gapMax = R.clearGap.max / M_PER_UNIT;
    const gapTyp = R.clearGap.typical / M_PER_UNIT;
    const width = (fr?.width ?? d.width_m ?? 1.2) / M_PER_UNIT;
    // the front: the wall the door is in, where the plan has it (else the door's own width)
    let front = [-width / 2, width / 2];
    let frontWall = null;
    if (fr?.plan && fr.door) {
      const F = fr.plan.frame;
      const w = fr.plan.walls.find((x) => x.storey === fr.door.storey && x.holes.some((h) => h.door === fr.door.id));
      if (w && w.kind !== "exterior") {
        frontWall = w;
        const ax = u[0] ? 0 : 1;
        const a = X(F.origin_cells[0] + w.a[0] / cellM) * (ax === 0 ? 1 : 0) + Y(F.origin_cells[1] + w.a[1] / cellM) * ax;
        const b = X(F.origin_cells[0] + w.b[0] / cellM) * (ax === 0 ? 1 : 0) + Y(F.origin_cells[1] + w.b[1] / cellM) * ax;
        const cc = ax === 0 ? c[0] : c[1];
        front = [Math.min(a, b) - cc, Math.max(a, b) - cc];
      }
    }
    const btex = tex.ofRole("cell-grate");
    const metal = tex.ofName("metal5");
    const span = front[1] - front[0];
    const rails = frontWall ? 5 : 1; // head, foot, the lock rail either side of the leaf, the leaf's own
    let gap = gapTyp;
    let bars = Math.ceil(span / (bar + gap));
    if (bars + rails > R.maxBrushes) {
      gap = Math.min(gapMax, span / Math.max(1, R.maxBrushes - rails) - bar);
      bars = Math.ceil(span / (bar + gap));
    }
    const half = width / 2;
    const th = 2;
    const piece = (a0, a1, zz0, zz1, t) => (u[0] ? B([c[0] + a0, c[1] - th, zz0], [c[0] + a1, c[1] + th, zz1], t) : B([c[0] - th, c[1] + a0, zz0], [c[0] + th, c[1] + a1, zz1], t)); // prettier-ignore
    if (bars + rails > R.maxBrushes || gap < 1) {
      // the fallback: one brush of the masked bars texture, the leaf
      const leaf = piece(-half, half, z0 + 1, z0 + height, btex);
      addEntity(brushEntity("func_door", [leaf], { ...keys, angles: [0, u[0] ? 0 : 90, 0], lip: 4, rendermode: 4, renderamt: 255 }), "door:cell-masked"); // prettier-ignore
      contract.cells.push({ name: d.name, bars: 0, fallback: "masked" });
      return true;
    }
    const leafBars = [];
    let fixed = 0;
    const pitch = span / bars;
    for (let k = 0; k < bars; k++) {
      const a = front[0] + pitch * (k + 0.5);
      const b = piece(a - bar / 2, a + bar / 2, z0 + (frontWall ? 2 : 0), z0 + height - (frontWall ? 4 : 0), metal);
      if (!b) continue;
      if (Math.abs(a) < half) leafBars.push(b);
      else {
        addDetail("cells", b, "cell-bar");
        fixed++;
      }
    }
    if (frontWall) {
      addDetail("cells", piece(front[0], front[1], z0 + height - 4, z0 + height, metal), "cell-rail");
      addDetail("cells", piece(front[0], front[1], z0, z0 + 2, metal), "cell-rail");
      for (const [a0, a1] of [[front[0], -half], [half, front[1]]]) if (a1 - a0 > 2) addDetail("cells", piece(a0, a1, z0 + 38, z0 + 42, metal), "cell-rail");
    }
    leafBars.push(piece(-half + 1, half - 1, z0 + 40 - 2, z0 + 40 + 2, metal));
    addEntity(brushEntity("func_door", leafBars.filter(Boolean), { ...keys, angles: [0, u[0] ? 0 : 90, 0], lip: 4 }), "door:cell-bars");
    contract.cells.push({ name: d.name, bars: leafBars.length + fixed, gap_m: Math.round(gap * M_PER_UNIT * 1000) / 1000, front_m: Math.round(span * M_PER_UNIT * 100) / 100 }); // prettier-ignore
    return true;
  }
  // the walls the cell fronts replace are left out of the detail above: noted
  // switches
  for (const s of wir.switches) {
    const at = [X(s.at[0]), Y(s.at[1]), Zc(s.at[2])];
    const f = s.facing ?? [0, 1];
    const n = 4;
    const half = 4;
    const min = [at[0] - (Math.abs(f[0]) > 0.5 ? (f[0] > 0 ? 0 : n) : half), at[1] - (Math.abs(f[1]) > 0.5 ? (f[1] > 0 ? 0 : n) : half), at[2] - half]; // prettier-ignore
    const max = [min[0] + (Math.abs(f[0]) > 0.5 ? n : half * 2), min[1] + (Math.abs(f[1]) > 0.5 ? n : half * 2), at[2] + half];
    const target = s.targets.length === 1 ? s.targets[0] : `${s.name}_mm`;
    if (s.targets.length > 1) {
      const keys = { targetname: target };
      for (const t of s.targets) keys[t] = 0;
      addEntity(pointEntity("multi_manager", [round(at[0] + f[0] * 24), round(at[1] + f[1] * 24), round(at[2])], keys), "multi_manager");
      contract.managers.push(target);
    }
    addEntity(brushEntity("func_button", [B(min, max, tex.ofName("metal5"))], { targetname: s.name, target, spawnflags: 1, wait: 1, sounds: 0 }), "button"); // prettier-ignore
    contract.buttons.push(s.name);
  }
  // lifts: a func_train on its stops, a call button at each stop in the tile
  for (const lf of wir.lifts) {
    const c = net.connectors.find((x) => x.id === lf.id);
    const shaft = c?.pieces.find((p) => p.kind === "shaft");
    const stops = lf.stops.filter((s) => s.inTile);
    if (!shaft || stops.length < 2) {
      notes.push(`lift ${lf.name}: ${!shaft ? "no shaft in 04" : "fewer than two stops in the tile"}; left out`);
      continue;
    }
    const sb = boxOf(shaft.poly.map((q) => [X(q[0]), Y(q[1])]));
    const ib = grow(sb, -4);
    const z0 = Zc(stops[0].z);
    const car = B([ib[0], ib[1], z0], [ib[2], ib[3], z0 + 8], tex.ofName("metal5"));
    const cx = (ib[0] + ib[2]) / 2;
    const cy = (ib[1] + ib[3]) / 2;
    const corners = [...stops, ...stops.slice(1, -1).reverse()].map((s, k) => ({ name: k < stops.length ? s.name : `${s.name}b`, z: Zc(s.z) + 4 })); // prettier-ignore
    corners.forEach((cn, k) => addEntity(pointEntity("path_corner", [round(cx), round(cy), round(cn.z)], { targetname: cn.name, target: corners[(k + 1) % corners.length].name, spawnflags: 1 }), "path_corner")); // prettier-ignore
    addEntity(brushEntity("func_train", [car], { targetname: lf.name, target: corners[1].name, speed: 150, dmg: 0 }), "lift");
    for (const s of stops) {
      if (!s.call) continue;
      const ex = c.exits?.find((e) => e.stop === s.stop);
      const side = ex?.side ?? "e";
      const n = { e: [1, 0], w: [-1, 0], n: [0, 1], s: [0, -1] }[side];
      const edge = side === "e" ? sb[2] : side === "w" ? sb[0] : side === "n" ? sb[3] : sb[1];
      const along = side === "e" || side === "w" ? [edge + n[0] * 12, sb[1] - 8] : [sb[0] - 8, edge + n[1] * 12];
      const zc = Zc(s.z) + 48;
      addEntity(brushEntity("func_button", [B([along[0] - 4, along[1] - 4, zc - 4], [along[0] + 4, along[1] + 4, zc + 4], tex.ofName("metal5"))], { targetname: s.call, target: lf.name, spawnflags: 1, wait: 3 }), "button:call"); // prettier-ignore
      contract.buttons.push(s.call);
    }
    contract.lifts.push({ name: lf.name, stops: stops.map((s) => s.name) });
  }
  // lights
  const named = new Map(wir.lights.map((x) => [x.lamp, x]));
  for (const lp of pal.lamps) {
    const at = [round(X(lp.at[0])), round(Y(lp.at[1])), round(Zc(lp.z) - 4)];
    if (!inBox(at, tileU)) {
      dropped.push(`${lp.id}: outside the tile's box`);
      continue;
    }
    const sw = named.get(lp.id);
    const brightness = Math.max(80, Math.min(600, Math.round(Math.sqrt(lp.power ?? 10000) * 2)));
    const keys = sw ? { targetname: sw.name } : {};
    addEntity(lightEntity(at, { color: colourOf(lp.colour), brightness, ...keys }), sw ? "light:switched" : "light");
    if (sw) contract.lights.push(sw.name);
  }
  // sounds
  for (const s of wir.sounds) {
    const at = [round(X(s.at[0])), round(Y(s.at[1])), round(Zc(s.at[2]) + 32)];
    const keys = { message: `ambience/nb_${String(s.sample ?? s.kind).replace(/[^a-z0-9_]/gi, "_")}.wav`, health: s.kind === "alarm" ? 10 : 5, spawnflags: 4 + (s.looping === false ? 32 : 0) + (s.kind === "alarm" ? 16 : 0) }; // prettier-ignore
    if (s.name) keys.targetname = s.name;
    addEntity(pointEntity("ambient_generic", at, keys), "sound");
    contract.sounds.push(s.name ?? s.sound);
  }
  // spawns, in 07's order (TS reads the first 32)
  const spawnById = new Map(net.spawns.map((s) => [s.id, s]));
  for (const id of wir.spawns.order) {
    const s = spawnById.get(id);
    if (!s) continue;
    addEntity(pointEntity("info_player_deathmatch", [round(X(s.at[0])), round(Y(s.at[1])), round(Zc(s.z) + 36)], { angles: [0, 0, 0] }), "spawn");
    contract.spawns.push(id);
  }
  // signs: a plate over their door
  for (const s of dress.reserved?.signs ?? []) {
    const L = layerOf(s.layer);
    const f = s.facing ?? [0, -1];
    const c = [X(s.at[0] / cellM), Y(s.at[1] / cellM)];
    const z = Zc(L?.floor ?? 0) + s.at[2] / M_PER_UNIT;
    const [w, h] = (s.size ?? [1.5, 0.5]).map((v) => v / M_PER_UNIT);
    const t = roleTex(`building:${s.building}`, "sign", "sign-street-name");
    const min = Math.abs(f[0]) > 0.5 ? [c[0] - (f[0] > 0 ? 0 : 2), c[1] - w / 2, z - h / 2] : [c[0] - w / 2, c[1] - (f[1] > 0 ? 0 : 2), z - h / 2];
    const max = Math.abs(f[0]) > 0.5 ? [min[0] + 2, c[1] + w / 2, z + h / 2] : [c[0] + w / 2, min[1] + 2, z + h / 2];
    addDetail("signs", B(min, max, t), "sign");
  }

  // ── the map ──
  const keep = (b) => {
    try {
      return snapped(b, 1);
    } catch {
      return b;
    }
  };
  const worldBrushes = [...rock.map(keep), ...world.map(keep)];
  const detailEntities = [...detail.entries()].filter(([, list]) => list.length).map(([group, list]) => ({ entity: brushEntity("func_detail", list.map(keep), { zhlt_detaillevel: 1, _group: group }), kind: "func_detail" })); // prettier-ignore
  const inside = (e) => (e.entity.brushes?.length ? true : inBox(String(e.entity.origin).split(" ").map(Number), tileU));
  const pointsOut = entities.filter((e) => !inside(e));
  for (const e of pointsOut) dropped.push(`${e.entity.classname} ${e.entity.targetname ?? ""} at ${e.entity.origin}: outside the tile's box`);
  const all = [...detailEntities, ...entities.filter(inside)];
  const forms09 = forms.world?.worldspawn ?? {};
  const worldspawn = { message: `${desc.name ?? "city"} ${site.tile.id}`, skyname: forms09.skyname ?? "nbstorm", MaxRange: forms09.MaxRange ?? 32768, wad: [], light: 0 }; // prettier-ignore
  const map = { worldspawn, brushes: worldBrushes, entities: all.map((e) => e.entity) };
  counts.rock = rock.length;
  const heights = {};
  for (const L of layers) heights[L.id] = [...heightsBy.get(L.id)].sort((a, b) => a - b);
  return { map, kinds: all.map((e) => e.kind), spaces, heights, counts, contract, notes, dropped, tileU };
}

/**
 * How many steps a flight of `rise` units is built as: its risers two by two where two keep within a player's step
 * (STEP units), so a flight costs half the brushes; a riser alone where they would not.
 */
export const STEP = 18;
export function stepsFor(rise, risers) {
  const n = Math.max(1, risers ?? Math.round(rise / 8));
  const paired = Math.ceil(n / 2);
  return rise / paired <= STEP ? paired : n;
}

/** Half-cell rows of a block merged where they line up (fewer outlines for the carve). */
function mergeRows(rows) {
  const sorted = [...rows].sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
  const out = [];
  for (const r of sorted) {
    const last = out.find((o) => o[0] === r[0] && o[2] === r[2] && Math.abs(o[3] - r[1]) < 1e-9);
    if (last) last[3] = r[3];
    else out.push([...r]);
  }
  return out;
}
/** The room of a list nearest to a point (cells). */
function nearestRoom(rooms, at) {
  let best = null;
  let bd = Infinity;
  for (const r of rooms) {
    if (!r.rect) continue;
    const b = rectBox(r.rect);
    const d = Math.hypot(Math.max(b[0] - at[0], 0, at[0] - b[2]), Math.max(b[1] - at[1], 0, at[1] - b[3]));
    if (d < bd) [best, bd] = [r, d];
  }
  return bd < 1 ? best : null;
}
/** The side of a box nearest a point: { axis (0: the side runs along x), line, normal }. */
function nearestSide(b, at) {
  const c = [
    { axis: 0, line: b[1], normal: [0, -1], d: Math.abs(at[1] - b[1]) },
    { axis: 0, line: b[3], normal: [0, 1], d: Math.abs(at[1] - b[3]) },
    { axis: 1, line: b[0], normal: [-1, 0], d: Math.abs(at[0] - b[0]) },
    { axis: 1, line: b[2], normal: [1, 0], d: Math.abs(at[0] - b[2]) },
  ];
  return c.sort((p, q) => p.d - q.d)[0];
}

export const _internal = { clipToBox, boxMinus, mergeRows, colourOf, nearestSide };
export { writeMap };
