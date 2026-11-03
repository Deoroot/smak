// Stage 6, palette and light plan: every surface of the tile (each public way, plaza, facade, building shell, room,
// door, connector stop, checkpoint room, post and service hallway) given a role and a texture from its owner's
// CLOSED palette, and the lamps and ambient sounds that light and fill it. Writes 06-palette.json.
//
// Written rules (the decisions the description leaves):
// - The owner's palette: a thing of the MSR (an MSR building, a checkpoint room, a post, a service hallway, an MSR
//   connector) or of the insurgents takes its faction's palette for each slot the faction has, else its district's;
//   everything else its district's; the shared palette for the parts it names (a road's carriageway, a curb, a
//   street-name sign). No fallback: a slot with no role in that set stops the build, naming the thing and the slot.
// - The role inside a slot: a role is specific when its first word names a building type, an owner group, a home
//   class, a room kind, a door kind or a word of a building's id ("clinic-wall-white" is hearth_clinic's,
//   "cell-grate" a cell's, "home-door" a home's); a thing takes the specific roles its own words name, else the
//   unspecific roles of the slot, else any role of it. Among several, a building takes one by its seeded id for
//   all its rooms, a facade by its variant, a way or plaza the first; a part that names a look (a colonnade's
//   columns a pillar, a monument's plinth a marble, a tower's crown its gold) the first role of that look.
// - A square's colonnade (its columns, its vault), its monuments (shaft, plinth) and a building's tower (its
//   shaft's wall, its crown) are things of their own, from their square's district or their building's owner.
// - Wear picks the variant: the role's texture names in order from new to worn, the index wear / 3 of the way
//   along. A thing's wear is its district's; an MSR thing is kept one step newer. A role the description names no
//   textures for keeps texture null (stage 9's texture audit picks or stops).
// - Lamps by floor area and room kind: a room lamp lights LAMP[ceiling class].area m2 (the rulebook's ceiling class
//   of its kind) to ROOM_TARGET; public ways one lamp every SPACING[class] cells (avenues and canals both sides)
//   to PUBLIC_TARGET, plazas one a PLAZA_AREA m2 of their open floor, and a square with a portico one every
//   SPACING.avenue cells along its colonnade, hung from the portico's vault (deliberate: `mount: "hung"`, as
//   stage 8's lampMounts says for a lamp under a portico); a way with a colonnade (stage 1's: the Mese) hangs its
//   lamps the same way, in the middle of each portico. Each other street and plaza lamp is fixed where stage 8's street rules
//   let it be (dressing.mjs's lampMounts): a post within LAMP_MOVE of its spot, else a wall bracket on the nearest
//   building or facade face (BRACKET_REACH), else a post along its way or round its plaza (LAMP_SLIDE), else hung
//   from the vault of a portico (flagged `mount: "hung"`, deliberate); a lamp none of these allows stops the build.
//   Estimated light of a space: its layer's ambient + its lamps'
//   power / its floor. ROOM_TARGET 72 and PUBLIC_TARGET 52: the corpus's rooms 68-71 over streets 53-56
//   (levels/notes-rp-city.md), PLAN.md's night city (floor median 50-65, rooms >= public + 10).
// - Colour: public ways and plazas the district's first light; homes, shops, bars and the insurgents its first
//   warm light; the MSR and the city's public buildings its first cool or white light; else its first.
// - Switchable lights: one lamp a room, rooms by SWITCH_KINDS order, up to the tile's share of
//   wiring.switchableLights (its share of the city's enterable buildings), each its own light style from a block
//   of styles 32-63 laid tile after tile.
// - Ambient sounds: a district's first sound every SOUND_AREA cells2 of its public floor in the tile (at least one),
//   its last in rooms of ROOM_SOUND kinds (radios, music, machines; those in SWITCH_SOUND kinds switchable), the
//   city alarm's speaker at each checkpoint's guard post and in each MSR building's lobby; at most the tile's share
//   of engine.limits.loopingSounds, rooms dropped last-kind first past it.
import { clipPolyline, polylineLength, boxBoxDist, rectCentre, seedOf, r3, pointPolylineDist } from "./geom.mjs";
import { districtAt, tileAt, tileBox } from "./site.mjs";
import { metreRules } from "./stage3-programs.mjs";
import { lampMounts } from "./dressing.mjs";

export const SLOTS = ["wall", "floor", "ceiling", "trim", "door", "window", "sign"];
export const ROOM_TARGET = 72;
export const PUBLIC_TARGET = 52;
/** The corpus's room over public floor light (levels/styles/rp-city.json: cityRoomLight 70.6 / cityPublicLight 56.3). */
export const RATIO_TARGET = 1.25;
export const AMBIENT = { sky: 6, deck: 4, slab: 3, vault: 2, room: 2 };
export const LAMP = { hall: 45, public: 30, room: 18, corridor: 14, low: 9, outdoor: 30 };
export const SPACING = { avenue: 6, street: 6, alley: 5, catwalk: 5, canal: 8 };
export const BOTH_SIDES = new Set(["avenue", "canal"]);
export const PLAZA_AREA = 280;
export const SOUND_AREA = 150;
export const SWITCH_KINDS = ["barroom", "living", "shop-floor", "great-hall", "hall", "briefing", "workshop", "office", "kitchen", "bedsit", "stall", "ward"]; // prettier-ignore
export const ROOM_SOUND = ["barroom", "shop-floor", "hall", "factory-floor", "workshop", "living", "kitchen", "briefing", "bedsit"];
export const SWITCH_SOUND = new Set(["living", "kitchen", "barroom", "bedsit", "shop-floor"]);

const M2 = (desc) => desc.grid.cell * desc.grid.cell; // m2 a cell2
const OWNER_OF_UNIT = { home: "residents", business: "business", msr: "msr", public: "city", insurgent: "insurgents" };

/** A colour word's hue class: warm (red, orange, yellow), cool (green, cyan, blue, purple) or white. */
export function hueOf(colour) {
  const m = /#([0-9a-f]{6})/i.exec(colour ?? "");
  if (!m) return "white";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0 || (max - min) / max < 0.2) return "white";
  let h;
  if (max === r) h = ((g - b) / (max - min)) * 60;
  else if (max === g) h = (2 + (b - r) / (max - min)) * 60;
  else h = (4 + (r - g) / (max - min)) * 60;
  h = (h + 360) % 360;
  return h < 70 || h >= 330 ? "warm" : "cool";
}

/** The roles a thing may wear in a slot: its faction's (when the faction has the slot), else its district's; the shared palette's only for a shared part. */
export function allowedRoles(desc, { district, faction, shared }, slot) {
  if (shared) return desc.sharedPalette?.[slot] ?? [];
  const f = faction ? desc.factionPalettes?.[faction]?.[slot] : null;
  if (f?.length) return f;
  return desc.districts.find((d) => d.id === district)?.palette?.[slot] ?? [];
}

/** The words that make a role specific (see the header). */
function specificWords(desc, rules) {
  const w = new Set([...Object.keys(desc.housing?.groups ?? {}), "home", "house", "shop", "cell", "secret", "gate", "public", "interior"]); // prettier-ignore
  for (const b of desc.buildings) {
    w.add(b.type);
    for (const p of b.id.split("_")) w.add(p);
  }
  for (const k of Object.keys(rules.roomKinds ?? {})) w.add(k);
  for (const k of Object.keys(desc.housing?.classes ?? {})) w.add(k);
  for (const k of ["hut", "slum", "flat", "manor"]) w.add(k);
  w.add("portcullis");
  return w;
}

const variantOf = (textures, wear) => (textures.length <= 1 ? 0 : Math.min(textures.length - 1, Math.round((wear / 3) * (textures.length - 1)))); // prettier-ignore

function picker(desc, rules, seed) {
  const SPEC = specificWords(desc, rules);
  const first = (r) => r.split("-")[0];
  return function pick(owner, slot, words, choose) {
    const roles = allowedRoles(desc, owner, slot);
    if (!roles.length) return { role: null, texture: null };
    // words: a set, or a list of sets from the most particular (the room's or door's kind) to the building's
    const tiers = words instanceof Set ? [words] : words;
    let mine = [];
    for (const w of tiers) if (!mine.length) mine = roles.filter((r) => SPEC.has(first(r)) && w.has(first(r)));
    const open = roles.filter((r) => !SPEC.has(first(r)));
    const from = mine.length ? mine : open.length ? open : roles;
    const role = choose instanceof RegExp ? (from.find((r) => choose.test(r)) ?? roles.find((r) => choose.test(r)) ?? from[0]) : from[choose(from.length) % from.length]; // prettier-ignore
    const tex = desc.materials?.[role]?.textures ?? [];
    return { role, texture: tex.length ? tex[variantOf(tex, owner.wear)] : null };
  };
}

const clipToTile = (parts, box) => parts.flatMap((p) => clipPolyline(p, box));
/** The point `t` cells along a polyline and the direction of its leg there. */
function pointAt(pl, t) {
  for (let k = 1; k < pl.length; k++) {
    const [a, b] = [pl[k - 1], pl[k]];
    const s = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (t <= s + 1e-9 || k === pl.length - 1) {
      const u = s ? Math.min(1, Math.max(0, t / s)) : 0;
      return { at: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], dir: s ? [(b[0] - a[0]) / s, (b[1] - a[1]) / s] : [1, 0] }; // prettier-ignore
    }
    t -= s;
  }
  return { at: pl[0], dir: [1, 0] };
}
/**
 * n points spread along a polyline, each in the middle of its share; one whose lamp would stand over water (`wet(at,
 * dir)`: a footbridge's stretch over a canal, a street's end where it runs onto a canal's quay, where neither a post
 * nor a wall can hold a lamp) slides along the line to the nearest dry point, on the quarter-cell steps.
 */
function pointsAlong(pl, spacing, n, wet = () => false) {
  const L = polylineLength(pl);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * L;
    let got = pointAt(pl, t);
    if (wet(got.at, got.dir))
      for (let d = 0.25; d <= L; d += 0.25) {
        const dry = [t - d, t + d].filter((x) => x >= 0 && x <= L).map((x) => pointAt(pl, x)).find((p) => !wet(p.at, p.dir));
        if (dry) {
          got = dry;
          break;
        }
      }
    out.push(got);
  }
  return out;
}
const median = (xs) => {
  // area-weighted median of [{ v, w }]
  const s = [...xs].sort((a, b) => a.v - b.v);
  const tot = s.reduce((t, x) => t + x.w, 0);
  let acc = 0;
  for (const x of s) if ((acc += x.w) >= tot / 2) return x.v;
  return null;
};

/** The tile's share of the city's enterable buildings, and every tile's (for the light-style blocks). */
export function tileShares(desc) {
  const ent = desc.buildings.filter((b) => b.interior !== false);
  const by = {};
  for (const b of ent) {
    const t = tileAt(desc, b.at);
    if (t) by[t] = (by[t] ?? 0) + 1;
  }
  const tiles = [];
  for (let r = 0; r < desc.tiles.rows; r++) for (let c = 0; c < desc.tiles.cols; c++) tiles.push(`c${c}_r${r}`);
  return { total: ent.length, by, tiles };
}
/** The tile's budgets: { share, maxShare, switchable { target, limit, styles: [first, last] }, sounds, switches, entities, textures }. */
export function tileBudget(desc, tile) {
  const { total, by, tiles } = tileShares(desc);
  const share = (by[tile] ?? 0) / Math.max(1, total);
  const maxShare = desc.rules?.tiles?.maxShare ?? 0.25;
  const lim = (k) => desc.engine?.limits?.[k]?.value ?? Infinity;
  const W = desc.wiring ?? {};
  const RW = desc.rules?.wiring ?? {};
  const styleMax = RW.switchableLights?.max ?? 32;
  const lightsOf = (t) => Math.round((W.switchableLights ?? 0) * ((by[t] ?? 0) / Math.max(1, total)));
  let first = 32;
  for (const t of tiles) {
    if (t === tile) break;
    first += lightsOf(t);
  }
  const target = lightsOf(tile);
  return {
    share: r3(share),
    maxShare,
    switchable: { target, limit: Math.min(target, Math.floor(styleMax * maxShare)), styles: [first, first + target - 1], cityStyles: 32 + styleMax - 1 }, // prettier-ignore
    sounds: { limit: Math.floor(lim("loopingSounds") * maxShare) },
    switches: { target: Math.round((W.switches ?? 0) * share), min: Math.floor((RW.switches?.min ?? 0) * share), max: Math.floor((RW.switches?.max ?? Infinity) * share) }, // prettier-ignore
    entities: { limit: Math.floor(lim("entities") * maxShare) },
    textures: { limit: Math.floor((lim("textureBytes") * maxShare) / 88149), bytesEach: 88149 },
  };
}

export const stage = {
  n: 6,
  name: "palette",
  reads: ["description", "rulebook", "01-site.json", "02-lots.json", "04-network.json", "05-plans.json"],
  run(ctx) {
    const desc = ctx.description;
    const rules = metreRules(ctx);
    const seed = ctx.params.seed ?? 1;
    const site = ctx.inputs["01-site.json"];
    const lots = ctx.inputs["02-lots.json"];
    const net = ctx.inputs["04-network.json"];
    const plans = ctx.inputs["05-plans.json"];
    const tile = ctx.params.tile;
    const tbox = tileBox(desc, tile);
    const pick = picker(desc, rules, seed);
    const dist = Object.fromEntries(desc.districts.map((d) => [d.id, d]));
    const layerOf = Object.fromEntries(site.layers.map((L) => [L.id, L]));
    const nodeOf = Object.fromEntries(site.nodes.map((n) => [n.id, n]));
    const bOf = Object.fromEntries(desc.buildings.map((b) => [b.id, b]));
    const lotOf = Object.fromEntries(lots.lots.filter((l) => l.building).map((l) => [l.building, l]));
    const cell = desc.grid.cell;
    const things = [];
    const ownerFor = (district, faction) => {
      const wear = dist[district]?.wear ?? 0;
      return { district, faction: faction ?? null, wear: faction === "msr" ? Math.max(0, wear - 1) : wear };
    };
    const add = (id, kind, owner, parts, extra = {}) => {
      const slots = {};
      for (const [key, words, choose, shared] of parts) {
        const slot = key.split(".")[0];
        slots[key] = pick(shared ? { ...owner, shared: true } : owner, slot, words, choose ?? (() => 0));
      }
      const t = { id, kind, layer: extra.layer ?? null, district: owner.district, faction: owner.faction, wear: owner.wear, ...extra, slots };
      things.push(t);
      return t;
    };
    const none = new Set();
    // public ways and service hallways
    for (const w of site.ways) {
      if (!w.lengthInTile) continue;
      const L = layerOf[w.layer];
      const roofed = L?.ceiling !== "sky";
      if (w.class === "service") {
        add(`way:${w.id}`, "hallway", ownerFor(w.district, "msr"), [["floor", none], ["wall", none], ["ceiling", none], ["trim", none]], { layer: w.layer, ref: w.id }); // prettier-ignore
        continue;
      }
      const parts = [["floor", none], ["wall", none]];
      if (w.vehicle) parts.push(["floor.road", none, null, true]);
      if ((w.sidewalk ?? 0) > 0 || (w.portico ?? 0) > 0) parts.push(["trim.curb", none, null, true]);
      if (roofed) parts.push(["ceiling", none]);
      if (w.name) parts.push(["sign.street", none, null, true]);
      add(`way:${w.id}`, "way", ownerFor(w.district), parts, { layer: w.layer, ref: w.id });
      // its porticoes' colonnade (stage 1's column lines): the columns a pillar, the vault a ceiling, as a square's
      if (w.colonnade?.columns.length) add(`colonnade:${w.id}`, "colonnade", ownerFor(w.district), [["trim.column", none, /pillar|column/], ["ceiling.vault", none, /ceiling|vault/], ["floor", none]], { layer: w.layer, ref: w.id }); // prettier-ignore
    }
    for (const p of site.plazas) {
      if (p.tile !== tile) continue;
      const n = nodeOf[p.id];
      const parts = [["floor", none]];
      if (layerOf[p.layer]?.ceiling !== "sky") parts.push(["ceiling", none]);
      if (p.name) parts.push(["sign.street", none, null, true]);
      const owner = ownerFor(n?.district ?? districtAt(desc, p.layer, [(p.box[0] + p.box[2]) / 2, (p.box[1] + p.box[3]) / 2]));
      add(`plaza:${p.id}`, "plaza", owner, parts, { layer: p.layer, ref: p.id });
      // its colonnade (the columns a pillar, the vault a ceiling) and its monuments (the shaft a pillar, the plinth marble)
      if (p.portico) add(`colonnade:${p.id}`, "colonnade", owner, [["trim.column", none, /pillar|column/], ["ceiling.vault", none, /ceiling|vault/], ["floor", none]], { layer: p.layer, ref: p.id }); // prettier-ignore
      for (const mo of p.monuments ?? []) add(`monument:${mo.id}`, "monument", owner, [["trim.shaft", none, /pillar|column|stone/], ["floor.plinth", none, /marble|stone/], ["trim.crown", none, /gold/]], { layer: p.layer, ref: mo.id, plaza: p.id, monumentKind: mo.kind }); // prettier-ignore
    }
    // facades: the district's wall by the facade's variant
    for (const l of lots.lots) {
      if (l.kind !== "facade" || l.tile !== tile) continue;
      const v = l.facade?.variant ?? 0;
      add(`facade:${l.id}`, "facade", ownerFor(l.district), [["wall", none, (n) => v], ["trim", none, (n) => v], ["door", none], ["window", none]], { layer: l.layer, ref: l.id }); // prettier-ignore
    }
    // buildings: the shell, every room, every door
    const UNIT_KIND = {};
    for (const b of plans.buildings) {
      const desB = bOf[b.id];
      const lot = lotOf[b.id];
      const faction = desB.owner === "msr" ? "msr" : desB.owner === "insurgents" ? "insurgents" : null;
      const owner = ownerFor(desB.district, faction);
      const bw = new Set([desB.type, desB.owner, ...b.id.split("_")]);
      const ch = (slot) => (n) => seedOf(seed, `${b.id}:${slot}`) % n;
      const shell = [["wall", bw, ch("wall")], ["trim", bw, ch("trim")], ["window", bw, ch("window")]];
      if (desB.sign) shell.push(["sign", bw, ch("sign")]);
      add(`building:${b.id}`, "building", owner, shell, { layer: b.layer, ref: b.id, sign: desB.sign ?? null });
      // its tower: the shaft in the shell's wall, its cornices and crown gold where the palette has it
      if (desB.tower) add(`tower:${b.id}`, "tower", owner, [["wall.shaft", bw, ch("wall")], ["trim.crown", bw, /gold|pillar/], ["window.slit", bw, ch("window")]], { layer: b.layer, ref: b.id, silhouette: desB.tower.silhouette }); // prettier-ignore
      for (const u of b.units ?? []) UNIT_KIND[u.id] = u.kind;
      for (const r of b.rooms) {
        const uk = UNIT_KIND[r.unit];
        const cls = b.units.find((u) => u.id === r.unit)?.class;
        const words = [new Set([r.kind, ...(r.kind === "holding-cell" ? ["cell"] : [])]), new Set([...(uk ? [uk] : []), ...(cls ? [cls] : [])]), bw]; // prettier-ignore
        add(`room:${r.id}`, "room", owner, ["wall", "floor", "ceiling", "trim"].map((s) => [s, words, ch(s)]), { layer: b.layer, ref: r.id, building: b.id, roomKind: r.kind, storey: r.storey }); // prettier-ignore
      }
      for (const d of b.doors) {
        if (d.kind === "opening") continue;
        const to = b.rooms.find((r) => r.id === d.to) ?? b.rooms.find((r) => r.id === d.from);
        const uk = to ? UNIT_KIND[to.unit] : null;
        const words = [new Set([d.kind, ...(d.kind === "house" ? ["home"] : []), ...(to ? [to.kind] : []), ...(to?.kind === "holding-cell" ? ["cell"] : [])]), new Set(uk ? [uk] : []), bw]; // prettier-ignore
        if (d.kind === "secret") {
          // a secret door wears the wall's own texture: its slot is the wall of the room it is hidden in
          add(`door:${d.id}`, "door", owner, [["wall", words, ch("wall")]], { layer: b.layer, ref: d.id, building: b.id, secret: true }); // prettier-ignore
          continue;
        }
        add(`door:${d.id}`, "door", owner, [["door", words, ch(`door:${d.kind}`)]], { layer: b.layer, ref: d.id, building: b.id }); // prettier-ignore
      }
    }
    // connectors: one thing a stop in the tile
    for (const c of net.connectors) {
      for (const stop of c.inTile ?? []) {
        const node = nodeOf[stop];
        const bld = bOf[stop];
        const district = node?.district ?? bld?.district;
        const layer = node?.layer ?? bld?.layer ?? null;
        const faction = c.access === "msr" ? "msr" : c.type === "secret" && bld?.owner === "insurgents" ? "insurgents" : null;
        const words = new Set([c.type, ...(c.type === "secret" ? ["secret"] : [])]);
        const parts = [["wall", words], ["floor", words], ["trim", words]];
        if (c.type === "lift") parts.push(["door", words]);
        add(`connector:${c.id}@${stop}`, "connector", ownerFor(district, faction), parts, { layer, ref: c.id, stop });
      }
    }
    // checkpoints and posts: the MSR's
    for (const cp of net.checkpoints) {
      const node = nodeOf[cp.node];
      cp.rooms.forEach((r, i) => {
        const words = new Set([r.kind, ...(r.kind === "holding-cell" ? ["cell"] : []), ...(r.kind === "gate" ? ["portcullis"] : [])]);
        const parts = [["wall", words], ["floor", words], ["ceiling", words], ["trim", words], ["door", words]];
        add(`checkpoint:${cp.id}.${i}`, "checkpoint", ownerFor(node?.district ?? districtAt(desc, cp.layer, rectCentre(r.rect)), "msr"), parts, { layer: cp.layer, ref: cp.id, roomKind: r.kind, index: i }); // prettier-ignore
      });
    }
    for (const p of net.posts) {
      const words = new Set([p.kind]);
      add(`post:${p.id}`, "post", ownerFor(districtAt(desc, p.layer, rectCentre(p.rect)), "msr"), ["wall", "floor", "ceiling", "trim", "door"].map((s) => [s, words]), { layer: p.layer, ref: p.id }); // prettier-ignore
    }

    // ── the light plan ──
    const budget = tileBudget(desc, tile);
    const lamps = [];
    const spaces = [];
    const colourOf = (district, kind) => {
      const lights = dist[district]?.palette?.light ?? [];
      const by = (h) => lights.find((l) => hueOf(l) === h);
      const c = kind === "public" ? lights[0] : kind === "warm" ? (by("warm") ?? lights[0]) : (by("cool") ?? by("white") ?? lights[0]); // prettier-ignore
      return { colour: c ?? null, hue: hueOf(c) };
    };
    const m2 = M2(desc);
    const ambient = (layer) => AMBIENT[layerOf[layer]?.ceiling] ?? 2;
    const addLamp = (space, at, z, power, col, extra = {}) => {
      const l = { id: `lamp_${tile}_${String(lamps.length + 1).padStart(3, "0")}`, space, at: [r3(at[0]), r3(at[1])], z: r3(z), power: Math.round(power), colour: col.colour, hue: col.hue, ...extra }; // prettier-ignore
      lamps.push(l);
      return l;
    };
    // public ways (service hallways are the MSR's, lit as rooms are not; they are left to stage 8's fittings)
    // where a lamp of way w cannot be fixed: over a canal (its water or its quays' walking lanes: a footbridge's lamp,
    // or a street's where it runs onto a quay), for a canal's own quay lamp in another way's band (where a street runs
    // along the quay), and outside the tile (a quay lamp's offset past the seam); such a spot slides along the way
    const wetFor = (w) => {
      const others = site.ways.filter((c) => c.id !== w.id && c.layer === w.layer && c.class !== "service" && (w.water > 0 || c.water > 0));
      const inBand = (p) => others.some((c) => c.parts.some((part) => pointPolylineDist(p, part) < c.width / 2));
      const outside = (p) => p[0] < tbox[0] || p[1] < tbox[1] || p[0] > tbox[2] || p[1] > tbox[3];
      const off = w.width / 2 - 0.25; // as a way's lamps stand off its line below
      return (p, dir = [1, 0]) => [-1, 1].some((s) => { const q = [p[0] - dir[1] * off * s, p[1] + dir[0] * off * s]; return outside(q) || inBand(q); }); // prettier-ignore
    };
    for (const w of site.ways) {
      if (!w.lengthInTile || w.class === "service") continue;
      const pieces = clipToTile(w.parts, tbox);
      const len = pieces.reduce((s, p) => s + polylineLength(p), 0);
      if (len < 0.5) continue;
      const area = len * w.width * m2;
      const spacing = SPACING[w.class] ?? 6;
      const sides = BOTH_SIDES.has(w.class) ? 2 : 1;
      const per = Math.max(1, Math.round(len / spacing));
      const amb = ambient(w.layer);
      const power = (PUBLIC_TARGET - amb) * (area / (per * sides));
      const col = colourOf(w.district, "public");
      // a way with a colonnade: its lamps in the middle of each portico, hung from the vault (as a square's portico)
      const C = w.colonnade?.columns.length ? w.colonnade : null;
      let k = 0;
      const ids = [];
      for (const pl of pieces) {
        const n = Math.max(1, Math.round((per * polylineLength(pl)) / len));
        for (const { at, dir } of pointsAlong(pl, spacing, n, wetFor(w)))
          for (let s = 0; s < sides; s++) {
            const side = sides === 2 ? (s ? 1 : -1) : k % 2 ? 1 : -1;
            const off = (C ? w.width / 2 - w.portico / 2 : w.width / 2 - 0.25) * side;
            const z = (layerOf[w.layer]?.floor ?? w.z) + (C ? Math.min(1.2, C.height - 0.25) : Math.min(w.clearance ?? 2, 1.2));
            ids.push(addLamp(`way:${w.id}`, [at[0] - dir[1] * off, at[1] + dir[0] * off], z, power, col, { kind: "street", ...(C ? { portico: true } : {}) }).id); // prettier-ignore
            k++;
          }
      }
      const got = ids.length * power;
      spaces.push({ id: `way:${w.id}`, kind: "public", layer: w.layer, district: w.district, area_m2: r3(area), lamps: ids.length, estimate: r3(Math.min(255, amb + got / area)) }); // prettier-ignore
    }
    for (const p of site.plazas) {
      if (p.tile !== tile) continue;
      const n = nodeOf[p.id];
      // a square with a portico: its open floor inside the colonnade takes the grid, the portico its own lamps
      const [x0, y0, x1, y1] = p.portico ? p.portico.line : p.box;
      // the plaza's floor less the buildings standing on it
      let cells2 = (x1 - x0) * (y1 - y0);
      for (const l of lots.lots) if (l.kind === "enterable" && l.standsOn === p.id) cells2 -= l.rect.w * l.rect.d;
      const area = Math.max(1, cells2) * m2;
      const per = Math.max(1, Math.round(area / PLAZA_AREA));
      const amb = ambient(p.layer);
      const power = (PUBLIC_TARGET - amb) * (area / per);
      const district = n?.district ?? districtAt(desc, p.layer, [(x0 + x1) / 2, (y0 + y1) / 2]);
      const col = colourOf(district, "public");
      const cols = Math.ceil(Math.sqrt(per));
      const rows = Math.ceil(per / cols);
      // on the plaza's own floor: a grid point inside a lot of its layer (a building standing on the plaza, a facade
      // round it) goes to the nearest half-cell point of the plaza clear of every lot by half a cell, not yet taken
      const lotsHere = lots.lots.filter((l) => l.layer === p.layer).map((l) => [l.rect.x - 0.5, l.rect.y - 0.5, l.rect.x + l.rect.w + 0.5, l.rect.y + l.rect.d + 0.5]); // prettier-ignore
      // and clear of a connector's well or shaft standing on the plaza (a helix's or a stair's), as of a lot
      const pz = layerOf[p.layer]?.floor ?? p.z;
      for (const c of net?.connectors ?? []) for (const pc of c.pieces ?? []) if ((pc.kind === "well" || pc.kind === "shaft") && pc.z[0] <= pz + 1e-6 && pc.z[1] > pz + 0.5) { const xs = pc.poly.map((q) => q[0]); const ys = pc.poly.map((q) => q[1]); lotsHere.push([Math.min(...xs) - 0.5, Math.min(...ys) - 0.5, Math.max(...xs) + 0.5, Math.max(...ys) + 0.5]); } // prettier-ignore
      const free = (q) => q[0] >= Math.max(x0, tbox[0]) + 0.5 && q[0] <= Math.min(x1, tbox[2]) - 0.5 && q[1] >= Math.max(y0, tbox[1]) + 0.5 && q[1] <= Math.min(y1, tbox[3]) - 0.5 && !lotsHere.some((b) => q[0] > b[0] && q[0] < b[2] && q[1] > b[1] && q[1] < b[3]); // prettier-ignore
      const taken = [];
      for (let i = 0; i < per; i++) {
        const [cx, cy] = [i % cols, Math.floor(i / cols)];
        let at = [x0 + ((cx + 0.5) * (x1 - x0)) / cols, y0 + ((cy + 0.5) * (y1 - y0)) / rows];
        if (!free(at) || taken.some((t) => Math.hypot(t[0] - at[0], t[1] - at[1]) < 2)) {
          let best = null;
          for (let qx = Math.ceil(x0 * 2) / 2; qx <= x1; qx += 0.5)
            for (let qy = Math.ceil(y0 * 2) / 2; qy <= y1; qy += 0.5) {
              const q = [qx, qy];
              if (!free(q) || taken.some((t) => Math.hypot(t[0] - q[0], t[1] - q[1]) < 2)) continue;
              const d = Math.hypot(q[0] - at[0], q[1] - at[1]);
              if (!best || d < best.d - 1e-9) best = { q, d };
            }
          if (best) at = best.q;
        }
        taken.push(at);
        addLamp(`plaza:${p.id}`, at, (layerOf[p.layer]?.floor ?? p.z) + 1.2, power, col, { kind: "plaza" }); // prettier-ignore
      }
      let under = 0;
      if (p.portico) {
        // the portico: a lamp every SPACING.avenue cells along the middle of each side, hung from its vault
        const [b0, b1, b2, b3] = p.box;
        const h = p.portico.depth / 2;
        const runs = [[[b0 + h, b1 + h], [b2 - h, b1 + h]], [[b2 - h, b1 + h], [b2 - h, b3 - h]], [[b2 - h, b3 - h], [b0 + h, b3 - h]], [[b0 + h, b3 - h], [b0 + h, b1 + h]]]; // prettier-ignore
        const pArea = ((b2 - b0) * (b3 - b1) - (x1 - x0) * (y1 - y0)) * m2;
        const n = runs.reduce((t, [a, b]) => t + Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / SPACING.avenue)), 0);
        const pPower = (PUBLIC_TARGET - amb) * (pArea / n);
        for (const [a, b] of runs) {
          const k = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / SPACING.avenue));
          for (let i = 0; i < k; i++) {
            const t = (i + 0.5) / k;
            addLamp(`plaza:${p.id}`, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], (layerOf[p.layer]?.floor ?? p.z) + Math.min(1.2, p.portico.height - 0.25), pPower, col, { kind: "plaza", portico: true }); // prettier-ignore
            under++;
          }
        }
      }
      spaces.push({ id: `plaza:${p.id}`, kind: "public", layer: p.layer, district, area_m2: r3(area), lamps: per + under, estimate: r3(Math.min(255, amb + (per * power) / area)) }); // prettier-ignore
    }
    // each street and plaza lamp fixed where stage 8's rules allow it: a post, a wall bracket, or hung under a portico
    {
      const wayLayer = Object.fromEntries(site.ways.map((w) => [w.id, w.layer]));
      const plazaLayer = Object.fromEntries(site.plazas.map((p) => [p.id, p.layer]));
      const street = lamps.filter((l) => l.kind === "street" || l.kind === "plaza").map((l) => {
        const [k, ref] = l.space.split(/:(.*)/s);
        return { id: l.id, layer: k === "way" ? wayLayer[ref] : plazaLayer[ref], ref, kind: l.kind, at: l.at, z: l.z, portico: Boolean(l.portico) }; // prettier-ignore
      });
      const mounts = lampMounts({ desc, rules, inputs: ctx.inputs, lamps: street });
      for (const l of lamps) {
        const m = mounts.get(l.id);
        if (!m) continue;
        l.at = m.at.map(r3);
        l.mount = m.mount;
        if (m.facing) l.facing = m.facing;
        if (m.moved_m) l.moved_m = m.moved_m;
        if (m.mount !== "post") l.why = m.why;
      }
    }
    // rooms
    const roomLamps = {};
    for (const b of plans.buildings) {
      const desB = bOf[b.id];
      const lot = lotOf[b.id];
      const zBase = lot?.zBase ?? b.lot?.zBase ?? 0;
      const sh = (b.frame?.storeyHeight_m ?? lot?.storeyHeight_m ?? 4.877) / cell;
      for (const r of b.rooms) {
        const kind = rules.roomKinds?.[r.kind] ?? {};
        const cls = kind.ceiling ?? "room";
        const per_m2 = LAMP[cls] ?? LAMP.room;
        const n = Math.max(1, Math.round(r.area_m2 / per_m2));
        const power = (ROOM_TARGET - AMBIENT.room) * per_m2;
        const uk = UNIT_KIND[r.unit];
        const group = OWNER_OF_UNIT[uk] ?? desB.owner;
        const col = colourOf(desB.district, group === "msr" || group === "city" ? "cool" : "warm");
        const rc = [...r.cells].sort((a, b2) => b2.w * b2.d - a.w * a.d)[0];
        const ids = [];
        const along = rc.w >= rc.d;
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          const at = along ? [rc.x + rc.w * t, rc.y + rc.d / 2] : [rc.x + rc.w / 2, rc.y + rc.d * t];
          const z = zBase + r.storey * sh + Math.max(0.5, (r.height_m ?? 3) - 0.35) / cell;
          ids.push(addLamp(`room:${r.id}`, at, z, power, col, { kind: "room" }).id);
        }
        roomLamps[r.id] = ids;
        spaces.push({ id: `room:${r.id}`, kind: "room", layer: b.layer, district: desB.district, building: b.id, roomKind: r.kind, area_m2: r.area_m2, lamps: n, estimate: r3(Math.min(255, AMBIENT.room + (n * power) / r.area_m2)) }); // prettier-ignore
      }
    }
    // switchable lights: one a room by SWITCH_KINDS, up to the budget, each its own style
    const rank = (k) => {
      const i = SWITCH_KINDS.indexOf(k);
      return i < 0 ? Infinity : i;
    };
    const cands = spaces.filter((s) => s.kind === "room" && rank(s.roomKind) < Infinity).sort((a, b) => rank(a.roomKind) - rank(b.roomKind) || (a.id < b.id ? -1 : 1)); // prettier-ignore
    // one room of a building before a second of any building
    const seenB = new Map();
    const ordered = cands.map((s) => ({ s, k: (seenB.set(s.building, (seenB.get(s.building) ?? 0) + 1), seenB.get(s.building)) })).sort((a, b) => a.k - b.k || rank(a.s.roomKind) - rank(b.s.roomKind) || (a.s.id < b.s.id ? -1 : 1)); // prettier-ignore
    // the tile's switches (its share of rules.wiring.switches, at most) leave room for what stage 7 must place besides:
    // a gate switch a checkpoint with a gate, and the city's alarm switch in the Nexus's tile (a small edge tile's
    // share may hold no lamp switch once its checkpoint's gate is wired)
    const nexusB = (desc.buildings ?? []).find((b) => b.id === desc.rules?.msr?.nexus);
    const alarmHere = (!nexusB?.at || tileAt(desc, nexusB.at) === tile) && (desc.wiring?.alarms ?? 0) > 0 ? 1 : 0;
    const gatesHere = (net?.checkpoints ?? []).filter((k) => k.rooms?.some((r) => r.kind === "gate")).length;
    const lampSwitches = Math.max(0, Math.min(budget.switchable.limit, budget.switches.max - gatesHere - alarmHere));
    const switchable = [];
    for (const { s } of ordered) {
      if (switchable.length >= lampSwitches) break;
      const lamp = lamps.find((l) => l.id === roomLamps[s.id.slice(5)][0]);
      lamp.switchable = true;
      lamp.style = budget.switchable.styles[0] + switchable.length;
      switchable.push(lamp.id);
    }
    // ── ambient sounds ──
    const sounds = [];
    const addSound = (space, name, at, z, extra = {}) => sounds.push({ id: `snd_${tile}_${String(sounds.length + 1).padStart(3, "0")}`, space, name, at: [r3(at[0]), r3(at[1])], z: r3(z), ...extra }); // prettier-ignore
    const pubByDistrict = {};
    for (const s of spaces) if (s.kind === "public") (pubByDistrict[`${s.layer}|${s.district}`] ??= []).push(s);
    for (const key of Object.keys(pubByDistrict).sort()) {
      const [layer, district] = key.split("|");
      const sp = pubByDistrict[key].sort((a, b) => b.area_m2 - a.area_m2 || (a.id < b.id ? -1 : 1));
      const cells2 = sp.reduce((t, s) => t + s.area_m2, 0) / m2;
      const names = dist[district]?.palette?.sound ?? [];
      if (!names.length) continue;
      const n = Math.max(1, Math.round(cells2 / SOUND_AREA));
      for (let i = 0; i < n; i++) {
        const s = sp[i % sp.length];
        const ls = lamps.filter((l) => l.space === s.id);
        const l = ls[Math.floor(i / sp.length) % Math.max(1, ls.length)] ?? ls[0];
        addSound(s.id, names[0], l?.at ?? [0, 0], (layerOf[layer]?.floor ?? 0) + 0.5, { kind: "street" });
      }
    }
    const roomSounds = [];
    for (const s of spaces) {
      if (s.kind !== "room" || !ROOM_SOUND.includes(s.roomKind)) continue;
      const names = dist[s.district]?.palette?.sound ?? [];
      if (!names.length) continue;
      const l = lamps.find((x) => x.id === roomLamps[s.id.slice(5)][0]);
      roomSounds.push({ s, name: names[names.length - 1], at: l.at, z: l.z - 0.5 });
    }
    const alarms = [];
    if ((desc.wiring?.alarms ?? 0) > 0) {
      for (const cp of net.checkpoints) {
        const post = cp.rooms.find((r) => r.kind === "guard-post");
        if (post) alarms.push({ space: `checkpoint:${cp.id}.${cp.rooms.indexOf(post)}`, at: rectCentre(post.rect), z: post.z?.[0] ?? (layerOf[cp.layer]?.floor ?? 0) }); // prettier-ignore
      }
      for (const b of plans.buildings) {
        if (bOf[b.id].owner !== "msr") continue;
        const lobby = b.rooms.find((r) => r.kind === "lobby") ?? b.rooms[0];
        const l = lamps.find((x) => x.id === roomLamps[lobby.id][0]);
        alarms.push({ space: `room:${lobby.id}`, at: l.at, z: l.z - 0.5 });
      }
    }
    const room = Math.max(0, budget.sounds.limit - sounds.length - alarms.length);
    const keep = roomSounds.map((x, i) => ({ ...x, i })).sort((a, b) => ROOM_SOUND.indexOf(a.s.roomKind) - ROOM_SOUND.indexOf(b.s.roomKind) || a.i - b.i).slice(0, room); // prettier-ignore
    const dropped = roomSounds.length - keep.length;
    for (const x of keep.sort((a, b) => a.i - b.i)) addSound(x.s.id, x.name, x.at, x.z, { kind: "room", switchable: SWITCH_SOUND.has(x.s.roomKind) }); // prettier-ignore
    for (const a of alarms) addSound(a.space, "city-alarm", a.at, a.z + 0.5, { kind: "alarm", switchable: true });

    // ── measures ──
    const pub = spaces.filter((s) => s.kind === "public").map((s) => ({ v: s.estimate, w: s.area_m2 }));
    const rms = spaces.filter((s) => s.kind === "room").map((s) => ({ v: s.estimate, w: s.area_m2 }));
    const publicMedian = median(pub);
    const roomMedian = median(rms);
    const allFloor = [...pub, ...rms];
    const totalA = allFloor.reduce((t, x) => t + x.w, 0);
    const darkShare = totalA ? allFloor.filter((x) => x.v < 24).reduce((t, x) => t + x.w, 0) / totalA : 0;
    const textures = new Set();
    const byDistrict = {};
    for (const t of things)
      for (const s of Object.values(t.slots)) {
        if (s.texture) textures.add(s.texture);
        const key = t.faction ? `${t.faction} (faction)` : t.district;
        const set = (byDistrict[key] ??= new Set());
        set.add(s.texture ?? `(${s.role})`);
      }
    const warm = lamps.filter((l) => l.hue === "warm").length;
    return {
      tile: plans.tile ?? lots.tile ?? null,
      rules: { ROOM_TARGET, PUBLIC_TARGET, RATIO_TARGET, AMBIENT, LAMP, SPACING, PLAZA_AREA, SOUND_AREA, SWITCH_KINDS, ROOM_SOUND, note: "lamp power in light-value x m2: a space's estimate is its ambient + its lamps' power / its floor (0-255); rough on purpose, measured at stage 11" }, // prettier-ignore
      budget,
      things,
      lamps,
      spaces,
      sounds,
      measures: {
        things: things.length,
        textures: textures.size,
        rolesWithoutTextures: [...new Set(things.flatMap((t) => Object.values(t.slots).filter((s) => s.role && !s.texture).map((s) => s.role)))].sort(), // prettier-ignore
        texturesByOwner: Object.fromEntries(Object.entries(byDistrict).sort().map(([k, v]) => [k, v.size])),
        lamps: lamps.length,
        roomLamps: lamps.filter((l) => l.kind === "room").length,
        publicLamps: lamps.filter((l) => l.kind !== "room").length,
        light: { roomMedian, publicMedian, ratio: publicMedian ? r3(roomMedian / publicMedian) : null, target: RATIO_TARGET, darkShare: r3(darkShare), warmShare: r3(warm / Math.max(1, lamps.length)) }, // prettier-ignore
        switchable: switchable.length,
        sounds: { total: sounds.length, street: sounds.filter((s) => s.kind === "street").length, room: sounds.filter((s) => s.kind === "room").length, alarm: sounds.filter((s) => s.kind === "alarm").length, droppedRooms: dropped }, // prettier-ignore
      },
    };
  },
  gate(artifact, ctx) {
    const desc = ctx.description;
    const failures = [];
    const notes = [];
    const P = desc.rules?.palette ?? {};
    // 1, 2: a role in every slot, from the owner's closed set, a texture of that role
    for (const t of artifact.things)
      for (const [key, s] of Object.entries(t.slots)) {
        const slot = key.split(".")[0];
        const shared = ["floor.road", "trim.curb", "sign.street"].includes(key);
        const owner = t.faction ? `${t.faction}'s faction palette or ${t.district}'s` : `${t.district}'s`;
        if (!s.role) {
          failures.push(`palette: ${t.id} has no ${key} role: ${shared ? "the shared palette" : owner} names none for ${slot}, and there is no fallback`); // prettier-ignore
          continue;
        }
        const allowed = allowedRoles(desc, { district: t.district, faction: t.faction, shared }, slot);
        if (!allowed.includes(s.role)) failures.push(`palette: ${t.id}.${key} wears ${s.role}, outside its closed palette (${shared ? "shared" : owner} ${slot}: ${allowed.join(", ") || "none"})`); // prettier-ignore
        const tex = desc.materials?.[s.role]?.textures ?? [];
        if (s.texture !== null && !tex.includes(s.texture)) failures.push(`palette: ${t.id}.${key} has texture ${s.texture}, not one of ${s.role}'s (${tex.join(", ") || "none named"})`); // prettier-ignore
        if (s.texture === null && tex.length) failures.push(`palette: ${t.id}.${key} has no texture, ${s.role} names ${tex.join(", ")}`); // prettier-ignore
      }
    // 3: a texture under one role
    const under = new Map();
    for (const t of artifact.things)
      for (const s of Object.values(t.slots))
        if (s.texture) {
          if (!under.has(s.texture)) under.set(s.texture, new Set());
          under.get(s.texture).add(s.role);
        }
    for (const [tex, roles] of under) if (roles.size > 1) failures.push(`palette: texture ${tex} is used under ${roles.size} roles (${[...roles].join(", ")}), wanted one`); // prettier-ignore
    // 4: neighbouring districts read apart (their own walls and floors, faction and shared surfaces aside)
    const own = {};
    for (const t of artifact.things) {
      if (t.faction) continue;
      for (const [key, s] of Object.entries(t.slots)) {
        if (!s.role || key.includes(".")) continue;
        if (key !== "wall" && key !== "floor") continue;
        (own[t.district] ??= new Set()).add(s.texture ?? `(${s.role})`);
      }
    }
    const ds = desc.districts.filter((d) => own[d.id]);
    const limit = P.maxSharedWallFloor ?? 1;
    for (let i = 0; i < ds.length; i++)
      for (let j = i + 1; j < ds.length; j++) {
        const [a, b] = [ds[i], ds[j]];
        if (a.layer !== b.layer || boxBoxDist(a.area, b.area) > 0) continue;
        const A = own[a.id];
        const B = own[b.id];
        const inter = [...A].filter((x) => B.has(x)).length;
        const share = inter / new Set([...A, ...B]).size;
        if (share > limit) failures.push(`palette: neighbouring districts ${a.id} and ${b.id} share ${Math.round(share * 100)} % of the wall and floor textures they use, at most ${Math.round(limit * 100)} %: they do not read apart`); // prettier-ignore
      }
    // 5: wear rising downward (each layer's mean wear over its surfaces)
    if (P.decayDownward !== false) {
      const byL = {};
      for (const t of artifact.things) if (t.layer) (byL[t.layer] ??= []).push(t.wear);
      const order = desc.layers.filter((L) => byL[L.id]).sort((a, b) => a.level - b.level);
      const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
      for (let i = 1; i < order.length; i++) {
        const [lo, hi] = [mean(byL[order[i - 1].id]), mean(byL[order[i].id])];
        if (!(lo > hi)) failures.push(`palette: wear does not rise downward: ${order[i - 1].id}'s surfaces wear ${r3(lo)} on average, ${order[i].id}'s above it ${r3(hi)}`); // prettier-ignore
      }
    }
    // 6: rooms lit above the streets
    const L = artifact.measures.light;
    for (const s of artifact.spaces) if (!s.lamps) failures.push(`light: ${s.id} has no lamp`);
    for (const l of artifact.lamps) if ((l.kind === "street" || l.kind === "plaza") && !l.mount) failures.push(`light: ${l.id} (${l.space}) has nowhere to be fixed: ${l.why}`); // prettier-ignore
    const mounts = artifact.lamps.filter((l) => l.mount);
    if (mounts.length) notes.push(`street and plaza lamps: ${mounts.filter((l) => l.mount === "post").length} on posts, ${mounts.filter((l) => l.mount === "bracket").length} on wall brackets, ${mounts.filter((l) => l.mount === "hung").length} hung under porticoes`); // prettier-ignore
    if (L.publicMedian && L.roomMedian && !(L.roomMedian / L.publicMedian >= RATIO_TARGET)) failures.push(`light: rooms are planned at ${L.roomMedian} against public floor ${L.publicMedian} (ratio ${r3(L.roomMedian / L.publicMedian)}), wanted ${RATIO_TARGET} or more as in the corpus (rooms 70.6 over streets 56.3)`); // prettier-ignore
    if (L.darkShare > 0.15) notes.push(`light: ${Math.round(L.darkShare * 100)} % of the floor is planned under 24 (the corpus 5-11 %, PLAN.md 15 % at most)`); // prettier-ignore
    // 7: budgets for the tile
    const B = tileBudget(desc, ctx.params.tile);
    const sw = artifact.lamps.filter((l) => l.switchable);
    if (sw.length > B.switchable.limit) failures.push(`budget: ${sw.length} switchable lights in tile ${ctx.params.tile}, at most ${B.switchable.limit} (its share of ${desc.rules?.wiring?.switchableLights?.max ?? 32} light styles)`); // prettier-ignore
    const styles = sw.map((l) => l.style);
    if (new Set(styles).size !== styles.length) failures.push(`budget: two switchable lights share a light style (${styles.join(", ")})`); // prettier-ignore
    for (const s of styles) if (!(s >= 32 && s <= B.switchable.cityStyles)) failures.push(`budget: light style ${s} is outside 32-${B.switchable.cityStyles}, the engine's switchable styles`); // prettier-ignore
    if (artifact.sounds.length > B.sounds.limit) failures.push(`budget: ${artifact.sounds.length} looping sounds in tile ${ctx.params.tile}, at most ${B.sounds.limit} (its ${Math.round(B.maxShare * 100)} % share of ${desc.engine?.limits?.loopingSounds?.value} static sound channels)`); // prettier-ignore
    const tex = artifact.measures.textures;
    if (tex > B.textures.limit) failures.push(`budget: ${tex} textures in tile ${ctx.params.tile}, at most ${B.textures.limit} (its share of the texture data at ${B.textures.bytesEach} bytes each)`); // prettier-ignore
    notes.push(`light: rooms ${L.roomMedian} against public floor ${L.publicMedian} (ratio ${L.ratio}, target ${RATIO_TARGET}); ${artifact.measures.lamps} lamps (${artifact.measures.roomLamps} in rooms), ${artifact.measures.switchable} switchable (styles ${styles.length ? `${Math.min(...styles)}-${Math.max(...styles)}` : "none"}), warm ${Math.round(L.warmShare * 100)} %`); // prettier-ignore
    notes.push(`textures: ${tex} used (${Object.entries(artifact.measures.texturesByOwner).map(([k, v]) => `${k} ${v}`).join(", ")}); ${artifact.measures.rolesWithoutTextures.length} roles with no texture names, left to stage 9's texture audit`); // prettier-ignore
    notes.push(`sounds: ${artifact.sounds.length} of ${B.sounds.limit} (${artifact.measures.sounds.street} street, ${artifact.measures.sounds.room} room, ${artifact.measures.sounds.alarm} alarm speakers${artifact.measures.sounds.droppedRooms ? `, ${artifact.measures.sounds.droppedRooms} room sounds dropped past the budget` : ""})`); // prettier-ignore
    return { failures, notes };
  },
};
