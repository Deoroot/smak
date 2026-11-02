// A city description (`smak-city-description/1`): a large roleplay city laid out before any geometry, as numbers
// and rules a generator follows exactly. City -> tiles (the coarse grid each part is built and budgeted in) ->
// layers (stacked, a z range, a ceiling, a wealth tier) -> districts (theme, palette, wealth, wear, density) ->
// the street network (nodes and segments by class) -> blocks -> buildings (type, footprint, storeys, rooms, homes)
// -> rooms. Between layers, connectors (stairs, ramps, lifts, shafts, secrets); on them, checkpoints; behind the
// public streets, service hallways. The format is documented in levels/specs/CITY.md; this file reads and
// validates one and gives the measured form (a walk graph) the checks use (levels/lib/city-checks.mjs).
//
// Every length is in grid cells (`grid.cell` metres, `grid.cellUnits` engine units); z too. Nothing here knows a
// kit: the engine's limits are the description's own `engine` section.

export const FORMAT = "smak-city-description/1";

export const CEILINGS = ["sky", "slab", "vault", "deck"]; // deck: under the layer above where it covers, sky elsewhere
export const WEALTH = ["slum", "low", "mid", "high", "elite"];
export const DENSITY = ["sparse", "medium", "dense"];
export const PALETTE_SLOTS = ["wall", "floor", "ceiling", "trim", "door", "window", "sign", "light", "sound"];
export const NODE_KINDS = ["junction", "plaza", "gate", "service", "end"];
export const ACCESS = ["public", "msr", "insurgent", "private"];
/** A tower's silhouette in plan and the sides of the prism it is built as (a round tower a sixteen-sided one). */
export const SILHOUETTES = { round: 16, octagon: 8, square: 4 };
/** What may stand on a square's open floor as its monument. */
export const MONUMENT_KINDS = ["column", "statue", "obelisk", "fountain"];

/** Street classes: width (cells, wall to wall), sidewalk each side, vehicle use, lanes, clearance (headroom). */
export const STREET_CLASSES = {
  avenue: { width: 6, sidewalk: 1, vehicle: true, lanes: 2, clearance: 3 },
  street: { width: 4, sidewalk: 0.5, vehicle: true, lanes: 2, clearance: 2.5 },
  alley: { width: 2, sidewalk: 0, vehicle: false, lanes: 0, clearance: 1.5 },
  canal: { width: 8, sidewalk: 1.5, vehicle: false, lanes: 0, clearance: 2 }, // water between two quays
  catwalk: { width: 1, sidewalk: 0, vehicle: false, lanes: 0, clearance: 1.5 },
  service: { width: 1.5, sidewalk: 0, vehicle: false, lanes: 0, clearance: 1.5, access: "msr" }, // MSR hallways
};

/** Connector types: the steepest grade (rise over path length), whether the ends stand one over the other. */
export const CONNECTOR_TYPES = {
  "grand-stair": { maxGrade: 0.75, vertical: false, vehicle: false },
  stair: { maxGrade: 0.75, vertical: false, vehicle: false }, // the architecture rulebook's pitch (levels/rules/architecture.json)
  ramp: { maxGrade: 0.15, vertical: false, vehicle: true },
  lift: { vertical: true, vehicle: false },
  "ladder-shaft": { vertical: true, vehicle: false },
  secret: { vertical: false, vehicle: false },
};

/** Home size classes: footprint in cells, rooms, the layers (by level) a class may stand on (none: any). */
export const UNIT_CLASSES = {
  hut: { cells: [1, 2], rooms: 1, levels: [1] },
  slum: { cells: [1, 2], rooms: 1 },
  "flat-s": { cells: [2, 2], rooms: 1 },
  "flat-m": { cells: [2, 3], rooms: 2 },
  "flat-l": { cells: [3, 4], rooms: 4 },
  house: { cells: [3, 4], rooms: 4 },
  manor: { cells: [8, 8], rooms: 10, levels: [3] },
};

/**
 * Building types: footprint range [[minW, minD], [maxW, maxD]] in cells, storeys [min, max], whether it is homes,
 * its default homes, its default room program (kind: count). A description may override any of them in its own
 * `buildingTypes`, and a building may give `rooms` over its type's program.
 */
export const BUILDING_TYPES = {
  manor: { footprint: [[8, 8], [16, 16]], storeys: [2, 3], residential: true, units: { manor: 1 }, rooms: { "great-hall": 1, kitchen: 1, study: 1, cellar: 1, garden: 1 } }, // prettier-ignore
  house: { footprint: [[3, 4], [6, 8]], storeys: [1, 3], residential: true, units: { house: 1 }, rooms: {} },
  apartment: { footprint: [[4, 6], [16, 20]], storeys: [2, 6], residential: true, units: {}, rooms: { lobby: 1, stairwell: 1 } }, // prettier-ignore
  huts: { footprint: [[4, 4], [20, 12]], storeys: [1, 2], residential: true, units: {}, rooms: {} },
  shop: { footprint: [[2, 3], [5, 6]], storeys: [1, 2], rooms: { "shop-floor": 1, backroom: 1 } },
  "double-shop": { footprint: [[4, 4], [10, 8]], storeys: [1, 3], rooms: { "shop-floor": 2, backroom: 1, storeroom: 1 } }, // prettier-ignore
  factory: { footprint: [[8, 10], [20, 24]], storeys: [1, 3], rooms: { "factory-floor": 1, office: 1, storeroom: 2, "loading-bay": 1, catwalk: 1 } }, // prettier-ignore
  workshop: { footprint: [[3, 4], [8, 10]], storeys: [1, 2], rooms: { workshop: 1, storeroom: 1 } },
  bar: { footprint: [[4, 5], [10, 12]], storeys: [1, 3], rooms: { barroom: 1, backroom: 1, toilet: 1, cellar: 1 } }, // prettier-ignore
  public: { footprint: [[5, 5], [16, 16]], storeys: [1, 3], rooms: { hall: 1, office: 1 } },
  msr: { footprint: [[6, 6], [24, 24]], storeys: [1, 6], rooms: { lobby: 1, office: 2, "guard-post": 1 } },
  insurgent: { footprint: [[6, 6], [16, 16]], storeys: [1, 2], rooms: { bunkroom: 1, armory: 1, "war-room": 1 } }, // prettier-ignore
};

/** Room sizes in cells for the estimates (a room kind not named here is 2 x 3). */
export const ROOM_SIZES = {
  stall: [1, 1], cell: [1.5, 2], "holding-cell": [1.5, 2], toilet: [1, 1], "guard-post": [2, 2], stairwell: [2, 3],
  "lift-lobby": [2, 2], gate: [2, 1], lobby: [4, 4], "front-desk": [2, 3], booking: [3, 3], office: [3, 3],
  briefing: [4, 5], armory: [3, 4], lockers: [3, 3], evidence: [2, 3], interrogation: [2, 2], "upper-hall": [2, 16],
  "great-hall": [6, 6], garden: [6, 6], hall: [8, 8], "shop-floor": [3, 4], barroom: [5, 6], "factory-floor": [10, 12],
  "loading-bay": [4, 6], catwalk: [1, 8], bunkroom: [4, 6], "war-room": [4, 4], courtroom: [6, 8], records: [4, 4],
  gatehouse: [4, 4], garage: [6, 8], ward: [4, 6], dormitory: [4, 8],
}; // prettier-ignore

const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isPos = (v) => isNum(v) && v > 0;
const isPair = (v, ok = isNum) => Array.isArray(v) && v.length === 2 && v.every(ok);
const isStrList = (v) => Array.isArray(v) && v.every((s) => typeof s === "string" && s);
const listOf = (v) => (Array.isArray(v) ? v : []);

/** The type table: the defaults with the description's `buildingTypes` laid over. */
export const typeTable = (desc) => {
  const out = {};
  for (const [k, v] of Object.entries(BUILDING_TYPES)) out[k] = { ...v, ...(desc?.buildingTypes?.[k] ?? {}) };
  for (const [k, v] of Object.entries(desc?.buildingTypes ?? {})) if (!out[k]) out[k] = { ...v };
  return out;
};
export const streetTable = (desc) => {
  const out = {};
  for (const [k, v] of Object.entries(STREET_CLASSES)) out[k] = { ...v, ...(desc?.streets?.classes?.[k] ?? {}) };
  return out;
};
export const unitTable = (desc) => ({ ...UNIT_CLASSES, ...(desc?.housing?.classes ?? {}) });

/** A building's room program: its type's, with its own `rooms` laid over (a count of 0 removes a kind). */
export const programOf = (building, types) => {
  const out = { ...(types[building.type]?.rooms ?? {}), ...(building.rooms ?? {}) };
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
};
/** A building's homes: { class: count }, its own `units` or its type's. */
export const unitsOf = (building, types) => building.units ?? types[building.type]?.units ?? {};

/**
 * Validates a city description. Returns { errors, warnings }: each error names the field and what it wanted.
 * An empty `errors` means the checks can run.
 */
export function validateCity(desc) {
  const errors = [];
  const warnings = [];
  const err = (s) => errors.push(s);
  if (!isObject(desc)) return { errors: ["the description is not a JSON object"], warnings };
  if (desc.format !== FORMAT) err(`format: wanted "${FORMAT}", got ${JSON.stringify(desc.format)}`);
  if (typeof desc.name !== "string" || !desc.name) err("name: wanted a non-empty string");

  const g = desc.grid;
  if (!isObject(g)) err("grid: wanted { cell (metres), cellUnits (engine units), storey (cells) }");
  else {
    if (!isPos(g.cell)) err(`grid.cell: wanted metres > 0, got ${JSON.stringify(g.cell)}`);
    if (!isPos(g.cellUnits)) err(`grid.cellUnits: wanted engine units > 0, got ${JSON.stringify(g.cellUnits)}`);
    if (!isPos(g.storey)) err(`grid.storey: wanted cells > 0 (a storey floor to floor), got ${JSON.stringify(g.storey)}`); // prettier-ignore
  }
  const ext = desc.extent;
  if (!isObject(ext) || !isPos(ext.x) || !isPos(ext.y)) err("extent: wanted { x, y } in cells > 0");
  const p = desc.players;
  if (!isObject(p) || !Number.isInteger(p.target) || p.target < 1) err("players.target: wanted an integer >= 1");

  const v = desc.vehicle;
  if (v !== undefined) {
    if (!isObject(v)) err("vehicle: wanted { width, length, height, turningRadius, margin } in cells");
    else for (const k of ["width", "length", "height", "turningRadius"]) if (!isPos(v[k])) err(`vehicle.${k}: wanted cells > 0, got ${JSON.stringify(v[k])}`); // prettier-ignore
  }

  // tiles: the coarse grid
  const t = desc.tiles;
  if (!isObject(t)) err("tiles: wanted { size: [w, d], origin: [x, y], cols, rows, portals: [] }");
  else {
    if (!isPair(t.size, isPos)) err("tiles.size: wanted [w, d] in cells > 0");
    if (t.origin !== undefined && !isPair(t.origin)) err("tiles.origin: wanted [x, y] in cells");
    if (!Number.isInteger(t.cols) || t.cols < 1 || !Number.isInteger(t.rows) || t.rows < 1) err("tiles.cols, tiles.rows: wanted integers >= 1"); // prettier-ignore
  }

  // layers
  const layers = listOf(desc.layers);
  if (!layers.length) err("layers: wanted a non-empty list");
  const layerIds = new Map();
  const levels = new Set();
  layers.forEach((L, i) => {
    const at = `layers[${i}]${L?.id ? ` (${L.id})` : ""}`;
    if (!isObject(L)) return err(`${at}: wanted an object`);
    if (typeof L.id !== "string" || !L.id) err(`${at}.id: wanted a non-empty string`);
    else if (layerIds.has(L.id)) err(`${at}.id: "${L.id}" is given twice`);
    else layerIds.set(L.id, L);
    if (!Number.isInteger(L.level)) err(`${at}.level: wanted an integer (1 the lowest)`);
    else if (levels.has(L.level)) err(`${at}.level: level ${L.level} is given twice`);
    else levels.add(L.level);
    if (!isPair(L.z) || !(L.z[1] > L.z[0])) err(`${at}.z: wanted [floor, top] in cells, top above floor`);
    if (!CEILINGS.includes(L.ceiling)) err(`${at}.ceiling: wanted one of ${CEILINGS.join(", ")}, got ${JSON.stringify(L.ceiling)}`); // prettier-ignore
    if (!WEALTH.includes(L.wealth)) err(`${at}.wealth: wanted one of ${WEALTH.join(", ")}, got ${JSON.stringify(L.wealth)}`); // prettier-ignore
    if (!Array.isArray(L.bounds) || L.bounds.length !== 4 || !L.bounds.every(isNum) || L.bounds[2] <= L.bounds[0] || L.bounds[3] <= L.bounds[1]) err(`${at}.bounds: wanted [x0, y0, x1, y1] in cells`); // prettier-ignore
    if (L.gated !== undefined && typeof L.gated !== "boolean") err(`${at}.gated: wanted true (every public way up is under a checkpoint) or false`); // prettier-ignore
    // the sky lid over the layer's open parts (all of a sky layer; a deck layer's ring outside the layer above)
    if (L.sky !== undefined) {
      if (L.ceiling !== "sky" && L.ceiling !== "deck") err(`${at}.sky: only a layer open to the sky (ceiling sky or deck) has a sky lid, ${L.id}'s ceiling is ${JSON.stringify(L.ceiling)}`); // prettier-ignore
      else if (!(isNum(L.sky) && isPair(L.z) && L.sky >= L.z[1])) err(`${at}.sky: wanted the sky lid's height in cells, at or above the layer's top ${isPair(L.z) ? L.z[1] : "?"}`); // prettier-ignore
    }
    if (L.frame !== undefined && (typeof L.frame !== "string" || !L.frame)) err(`${at}.frame: wanted the role the mega-structure's frame wears on this layer`); // prettier-ignore
  });
  const sortedLayers = [...layerIds.values()].filter((L) => Number.isInteger(L.level)).sort((a, b) => a.level - b.level); // prettier-ignore
  for (let i = 1; i < sortedLayers.length; i++) {
    const [lo, hi] = [sortedLayers[i - 1], sortedLayers[i]];
    if (isPair(lo.z) && isPair(hi.z) && hi.z[0] < lo.z[1]) err(`layers: ${hi.id} (floor ${hi.z[0]}) starts below the top of ${lo.id} (${lo.z[1]})`); // prettier-ignore
    if (hi.level !== lo.level + 1) err(`layers: levels wanted consecutive, ${lo.level} then ${hi.level}`);
    // a deck layer's ring and the layer above share their air over the deck's edge: one lid
    if (lo.ceiling === "deck" && isNum(lo.sky) && isPair(hi.z) && lo.sky > hi.z[0] && (hi.sky ?? hi.z?.[1]) !== lo.sky) err(`layers: ${lo.id}'s sky (z ${lo.sky}) rises past ${hi.id}'s floor, so the two share their air over the deck's edge: wanted one lid, ${hi.id}'s sky is z ${hi.sky ?? hi.z?.[1]}`); // prettier-ignore
  }

  // materials and districts
  const materials = isObject(desc.materials) ? desc.materials : null;
  if (!materials) err("materials: wanted { role: { look, textures? } }");
  else for (const L of layerIds.values()) if (typeof L.frame === "string" && L.frame && !materials[L.frame]) err(`layers (${L.id}).frame: "${L.frame}" is no material's role`); // prettier-ignore
  const shared = isObject(desc.sharedPalette) ? desc.sharedPalette : {};
  for (const [slot, roles] of Object.entries(shared)) {
    if (!PALETTE_SLOTS.includes(slot)) err(`sharedPalette.${slot}: no such slot (${PALETTE_SLOTS.join(", ")})`);
    else if (!isStrList(roles)) err(`sharedPalette.${slot}: wanted a list of roles`);
  }
  const districts = listOf(desc.districts);
  if (!districts.length) err("districts: wanted a non-empty list");
  const districtIds = new Map();
  districts.forEach((d, i) => {
    const at = `districts[${i}]${d?.id ? ` (${d.id})` : ""}`;
    if (!isObject(d)) return err(`${at}: wanted an object`);
    if (typeof d.id !== "string" || !d.id) err(`${at}.id: wanted a non-empty string`);
    else if (districtIds.has(d.id)) err(`${at}.id: "${d.id}" is given twice`);
    else districtIds.set(d.id, d);
    if (!layerIds.has(d.layer)) err(`${at}.layer: "${d.layer}" is no layer's id`);
    if (typeof d.theme !== "string" || !d.theme) err(`${at}.theme: wanted a theme in words`);
    if (!WEALTH.includes(d.wealth)) err(`${at}.wealth: wanted one of ${WEALTH.join(", ")}`);
    if (!Number.isInteger(d.wear) || d.wear < 0 || d.wear > 3) err(`${at}.wear: wanted 0 (pristine) to 3 (ruined)`);
    if (!DENSITY.includes(d.density)) err(`${at}.density: wanted one of ${DENSITY.join(", ")}`);
    if (!Array.isArray(d.area) || d.area.length !== 4 || !d.area.every(isNum)) err(`${at}.area: wanted [x0, y0, x1, y1] in cells`); // prettier-ignore
    if (!isObject(d.palette)) err(`${at}.palette: wanted { ${PALETTE_SLOTS.join(", ")} }`);
    else
      for (const slot of PALETTE_SLOTS) {
        const roles = d.palette[slot];
        if (!isStrList(roles) || !roles.length) err(`${at}.palette.${slot}: wanted a non-empty list`);
        else if (materials && slot !== "light" && slot !== "sound")
          for (const r of roles) if (!materials[r]) err(`${at}.palette.${slot}: "${r}" is no material's role`);
      }
  });

  // nodes and segments
  const classes = streetTable(desc);
  const nodes = listOf(desc.streets?.nodes);
  const segments = listOf(desc.streets?.segments);
  if (!isObject(desc.streets)) err("streets: wanted { classes?, nodes: [], segments: [] }");
  if (!nodes.length) err("streets.nodes: wanted a non-empty list");
  const nodeIds = new Map();
  nodes.forEach((n, i) => {
    const at = `streets.nodes[${i}]${n?.id ? ` (${n.id})` : ""}`;
    if (!isObject(n)) return err(`${at}: wanted an object`);
    if (typeof n.id !== "string" || !n.id) err(`${at}.id: wanted a non-empty string`);
    else if (nodeIds.has(n.id)) err(`${at}.id: "${n.id}" is given twice`);
    else nodeIds.set(n.id, n);
    if (!layerIds.has(n.layer)) err(`${at}.layer: "${n.layer}" is no layer's id`);
    if (!isPair(n.at)) err(`${at}.at: wanted [x, y] in cells`);
    if (!NODE_KINDS.includes(n.kind)) err(`${at}.kind: wanted one of ${NODE_KINDS.join(", ")}, got ${JSON.stringify(n.kind)}`); // prettier-ignore
    if (n.kind === "plaza" && !isPair(n.size, isPos)) err(`${at}.size: a plaza wants [w, d] in cells`);
    if (n.district !== undefined && !districtIds.has(n.district)) err(`${at}.district: "${n.district}" is no district's id`); // prettier-ignore
    if (n.cornerRadius !== undefined && !(isNum(n.cornerRadius) && n.cornerRadius >= 0)) err(`${at}.cornerRadius: wanted cells >= 0`); // prettier-ignore
    // a square's colonnade and monuments
    if ((n.portico !== undefined || n.monuments !== undefined) && n.kind !== "plaza") err(`${at}: only a plaza carries a portico or monuments`);
    if (n.portico !== undefined) {
      if (!isPos(n.portico)) err(`${at}.portico: wanted the depth in cells (> 0) of the colonnade along its edges`);
      else if (isPair(n.size, isPos) && 2 * n.portico >= Math.min(...n.size)) err(`${at}.portico: two porticoes of ${n.portico} leave no open floor in a size of [${n.size}]`); // prettier-ignore
    }
    if (n.monuments !== undefined && !Array.isArray(n.monuments)) err(`${at}.monuments: wanted a list of { id, kind, at, base, height }`);
    listOf(n.monuments).forEach((mo, j) => {
      const mat = `${at}.monuments[${j}]${mo?.id ? ` (${mo.id})` : ""}`;
      if (!isObject(mo)) return err(`${mat}: wanted an object`);
      if (typeof mo.id !== "string" || !mo.id) err(`${mat}.id: wanted a non-empty string`);
      if (!MONUMENT_KINDS.includes(mo.kind)) err(`${mat}.kind: wanted one of ${MONUMENT_KINDS.join(", ")}, got ${JSON.stringify(mo.kind)}`); // prettier-ignore
      if (!isPair(mo.at)) err(`${mat}.at: wanted [x, y] in cells (its base's centre)`);
      if (!isPair(mo.base, isPos)) err(`${mat}.base: wanted [w, d] in cells (its plinth)`);
      if (!isPos(mo.height)) err(`${mat}.height: wanted cells > 0 (from the square's floor to its top)`);
      if (mo.across !== undefined && !(isPos(mo.across) && isPair(mo.base, isPos) && mo.across <= Math.min(...mo.base))) err(`${mat}.across: wanted cells > 0, no wider than its base`); // prettier-ignore
      if (isPair(mo.at) && isPair(mo.base, isPos) && isPair(n.at) && isPair(n.size, isPos)) {
        const inner = n.portico ?? 0;
        const [x0, y0] = [n.at[0] - n.size[0] / 2 + inner, n.at[1] - n.size[1] / 2 + inner];
        const [x1, y1] = [n.at[0] + n.size[0] / 2 - inner, n.at[1] + n.size[1] / 2 - inner];
        if (mo.at[0] - mo.base[0] / 2 < x0 || mo.at[0] + mo.base[0] / 2 > x1 || mo.at[1] - mo.base[1] / 2 < y0 || mo.at[1] + mo.base[1] / 2 > y1) err(`${mat}: its base [${mo.base}] at [${mo.at}] is not on the square's open floor [${[x0, y0, x1, y1]}] (inside its porticoes)`); // prettier-ignore
      }
    });
    const L = layerIds.get(n.layer);
    if (L && isPair(n.at) && Array.isArray(L.bounds)) {
      const [x0, y0, x1, y1] = L.bounds;
      if (n.at[0] < x0 || n.at[0] > x1 || n.at[1] < y0 || n.at[1] > y1) err(`${at}.at: [${n.at}] is outside ${L.id}'s bounds [${L.bounds}]`); // prettier-ignore
    }
  });
  const segIds = new Map();
  segments.forEach((s, i) => {
    const at = `streets.segments[${i}]${s?.id ? ` (${s.id})` : ""}`;
    if (!isObject(s)) return err(`${at}: wanted an object`);
    if (typeof s.id !== "string" || !s.id) err(`${at}.id: wanted a non-empty string`);
    else if (segIds.has(s.id) || nodeIds.has(s.id)) err(`${at}.id: "${s.id}" is given twice`);
    else segIds.set(s.id, s);
    if (!classes[s.class]) err(`${at}.class: wanted one of ${Object.keys(classes).join(", ")}, got ${JSON.stringify(s.class)}`); // prettier-ignore
    for (const end of ["from", "to"]) if (!nodeIds.has(s[end])) err(`${at}.${end}: "${s[end]}" is no node's id`);
    if (s.from === s.to) err(`${at}: a segment joins two different nodes`);
    const a = nodeIds.get(s.from);
    const b = nodeIds.get(s.to);
    if (a && b && a.layer !== b.layer) err(`${at}: a segment joins nodes of one layer (${a.layer} and ${b.layer}); use a connector`); // prettier-ignore
    if (s.length !== undefined && !isPos(s.length)) err(`${at}.length: wanted cells > 0`);
    if (a && b && isPair(a.at) && isPair(b.at) && isPos(s.length) && s.length < Math.hypot(b.at[0] - a.at[0], b.at[1] - a.at[1]) - 0.01) err(`${at}.length: ${s.length} is shorter than the straight line between its nodes`); // prettier-ignore
    if (s.district !== undefined && !districtIds.has(s.district)) err(`${at}.district: "${s.district}" is no district's id`); // prettier-ignore
    for (const k of ["width", "clearance"]) if (s[k] !== undefined && !isPos(s[k])) err(`${at}.${k}: wanted cells > 0`);
    if (s.portico !== undefined) {
      const w = s.width ?? classes[s.class]?.width;
      if (!isPos(s.portico)) err(`${at}.portico: wanted the depth in cells (> 0) of the colonnade each side`);
      else if (isPos(w) && 2 * s.portico >= w) err(`${at}.portico: two porticoes of ${s.portico} leave no carriageway in a width of ${w}`);
    }
    if (s.vehicle !== undefined && typeof s.vehicle !== "boolean") err(`${at}.vehicle: wanted true or false`);
    if (s.access !== undefined && !ACCESS.includes(s.access)) err(`${at}.access: wanted one of ${ACCESS.join(", ")}`);
  });

  // buildings
  const types = typeTable(desc);
  const units = unitTable(desc);
  const blocks = listOf(desc.blocks);
  const blockIds = new Map();
  blocks.forEach((bl, i) => {
    const at = `blocks[${i}]${bl?.id ? ` (${bl.id})` : ""}`;
    if (!isObject(bl)) return err(`${at}: wanted an object`);
    if (typeof bl.id !== "string" || !bl.id) err(`${at}.id: wanted a non-empty string`);
    else if (blockIds.has(bl.id)) err(`${at}.id: "${bl.id}" is given twice`);
    else blockIds.set(bl.id, bl);
    if (!districtIds.has(bl.district)) err(`${at}.district: "${bl.district}" is no district's id`);
    if (!isPair(bl.size, isPos)) err(`${at}.size: wanted [w, d] in cells`);
    if (!Number.isInteger(bl.lots) || bl.lots < 1) err(`${at}.lots: wanted an integer >= 1`);
    if (!isStrList(bl.edges ?? [])) err(`${at}.edges: wanted a list of segment or node ids`);
    else for (const e of bl.edges ?? []) if (!segIds.has(e) && !nodeIds.has(e)) err(`${at}.edges: "${e}" is no segment's or node's id`); // prettier-ignore
  });
  const buildings = listOf(desc.buildings);
  const buildingIds = new Map();
  buildings.forEach((b, i) => {
    const at = `buildings[${i}]${b?.id ? ` (${b.id})` : ""}`;
    if (!isObject(b)) return err(`${at}: wanted an object`);
    if (typeof b.id !== "string" || !b.id) err(`${at}.id: wanted a non-empty string`);
    else if (buildingIds.has(b.id) || nodeIds.has(b.id) || segIds.has(b.id)) err(`${at}.id: "${b.id}" is given twice (ids are shared by nodes, segments and buildings)`); // prettier-ignore
    else buildingIds.set(b.id, b);
    const ty = types[b.type];
    if (!ty) err(`${at}.type: wanted one of ${Object.keys(types).join(", ")}, got ${JSON.stringify(b.type)}`);
    if (!districtIds.has(b.district)) err(`${at}.district: "${b.district}" is no district's id`);
    if (b.block !== undefined && !blockIds.has(b.block)) err(`${at}.block: "${b.block}" is no block's id`);
    else if (b.block !== undefined && blockIds.get(b.block).district !== b.district) err(`${at}.block: block ${b.block} is in ${blockIds.get(b.block).district}, the building in ${b.district}`); // prettier-ignore
    if (!segIds.has(b.frontage) && !nodeIds.has(b.frontage)) err(`${at}.frontage: "${b.frontage}" is no segment's or node's id (the street its door opens on)`); // prettier-ignore
    if (typeof b.variant !== "string" || !b.variant) err(`${at}.variant: wanted the name of its facade and plan`);
    if (!isPair(b.footprint, isPos)) err(`${at}.footprint: wanted [w, d] in cells`);
    else if (ty?.footprint) {
      const [[w0, d0], [w1, d1]] = ty.footprint;
      const [w, d] = [Math.min(...b.footprint), Math.max(...b.footprint)];
      if (w < Math.min(w0, d0) || d < Math.max(w0, d0) || w > Math.min(w1, d1) || d > Math.max(w1, d1)) err(`${at}.footprint: [${b.footprint}] is outside a ${b.type}'s ${w0}x${d0} to ${w1}x${d1}`); // prettier-ignore
    }
    if (!Number.isInteger(b.storeys) || b.storeys < 1) err(`${at}.storeys: wanted an integer >= 1`);
    else if (ty?.storeys && (b.storeys < ty.storeys[0] || b.storeys > ty.storeys[1])) err(`${at}.storeys: ${b.storeys} is outside a ${b.type}'s ${ty.storeys[0]} to ${ty.storeys[1]}`); // prettier-ignore
    if (b.at !== undefined && !isPair(b.at)) err(`${at}.at: wanted [x, y] in cells (the footprint's centre)`);
    if (typeof b.interior !== "boolean") err(`${at}.interior: wanted true (enterable) or false (a facade)`);
    if (b.rooms !== undefined && !(isObject(b.rooms) && Object.values(b.rooms).every((c) => Number.isInteger(c) && c >= 0))) err(`${at}.rooms: wanted { kind: count }`); // prettier-ignore
    if (b.units !== undefined) {
      if (!isObject(b.units)) err(`${at}.units: wanted { class: count }`);
      else for (const [c, n] of Object.entries(b.units)) {
        if (!units[c]) err(`${at}.units.${c}: no such home class (${Object.keys(units).join(", ")})`);
        if (!Number.isInteger(n) || n < 1) err(`${at}.units.${c}: wanted an integer >= 1`);
      }
    }
    if (typeof b.owner !== "string" || !b.owner) err(`${at}.owner: wanted an owner group's id`);
    else if (desc.housing?.groups && !desc.housing.groups[b.owner]) err(`${at}.owner: "${b.owner}" is no group of housing.groups`); // prettier-ignore
    if (b.sign !== undefined && (typeof b.sign !== "string" || !b.sign)) err(`${at}.sign: wanted a sign's name`);
    if (b.palette !== undefined && !isObject(b.palette)) err(`${at}.palette: wanted { slot: role }`);
    if (b.tower !== undefined) {
      const tw = b.tower;
      if (!isObject(tw)) err(`${at}.tower: wanted { storeys, silhouette, across }`);
      else {
        if (!Number.isInteger(tw.storeys) || tw.storeys < 1) err(`${at}.tower.storeys: wanted an integer >= 1 (its shaft's storeys over the building's, not enterable)`); // prettier-ignore
        if (!SILHOUETTES[tw.silhouette]) err(`${at}.tower.silhouette: wanted one of ${Object.keys(SILHOUETTES).join(", ")}, got ${JSON.stringify(tw.silhouette)}`); // prettier-ignore
        if (!isPos(tw.across)) err(`${at}.tower.across: wanted its width in cells (> 0)`);
        else if (isPair(b.footprint, isPos) && tw.across > Math.min(...b.footprint)) err(`${at}.tower.across: ${tw.across} is wider than the building's footprint [${b.footprint}] (a tower stands on its building)`); // prettier-ignore
        if (tw.at !== undefined && !isPair(tw.at)) err(`${at}.tower.at: wanted [x, y] in cells (its centre; the building's by default)`);
        if (tw.interior !== undefined && tw.interior !== false) err(`${at}.tower.interior: a tower's shaft is not enterable (false or nothing)`);
      }
    }
    listOf(b.passages).forEach((ps, j) => {
      if (!isObject(ps) || (!buildingIds.has(ps.to) && !nodeIds.has(ps.to) && !buildings.some((o) => o?.id === ps.to))) err(`${at}.passages[${j}].to: "${ps?.to}" is no building's or node's id`); // prettier-ignore
      if (isObject(ps) && ps.access !== undefined && !ACCESS.includes(ps.access)) err(`${at}.passages[${j}].access: wanted one of ${ACCESS.join(", ")}`); // prettier-ignore
    });
  });
  const layerOfDistrict = (id) => districtIds.get(id)?.layer;
  const layerOf = (id) => nodeIds.get(id)?.layer ?? layerOfDistrict(buildingIds.get(id)?.district);
  for (const b of buildings) for (const ps of listOf(b?.passages)) if (layerOf(ps?.to) && layerOf(b.id) && layerOf(ps.to) !== layerOf(b.id)) err(`buildings (${b.id}).passages: ${ps.to} is on another layer; use a connector`); // prettier-ignore
  for (const b of buildings) if (b && segIds.has(b.frontage)) {
    const n = nodeIds.get(segIds.get(b.frontage).from);
    if (n && layerOfDistrict(b.district) && n.layer !== layerOfDistrict(b.district)) err(`buildings (${b.id}).frontage: ${b.frontage} is on ${n.layer}, the building's district on ${layerOfDistrict(b.district)}`); // prettier-ignore
  }

  // connectors
  const ends = (id) => nodeIds.has(id) || buildingIds.has(id);
  const levelOf = (id) => layerIds.get(layerOf(id))?.level;
  const connectors = listOf(desc.connectors);
  const connIds = new Set();
  connectors.forEach((c, i) => {
    const at = `connectors[${i}]${c?.id ? ` (${c.id})` : ""}`;
    if (!isObject(c)) return err(`${at}: wanted an object`);
    if (typeof c.id !== "string" || !c.id) err(`${at}.id: wanted a non-empty string`);
    else if (connIds.has(c.id)) err(`${at}.id: "${c.id}" is given twice`);
    else connIds.add(c.id);
    if (!CONNECTOR_TYPES[c.type]) err(`${at}.type: wanted one of ${Object.keys(CONNECTOR_TYPES).join(", ")}, got ${JSON.stringify(c.type)}`); // prettier-ignore
    if (!Array.isArray(c.stops) || c.stops.length < 2) return err(`${at}.stops: wanted [lower, ..., upper], 2 or more node or building ids`); // prettier-ignore
    c.stops.forEach((s, j) => ends(s) || err(`${at}.stops[${j}]: "${s}" is no node's or building's id`));
    for (let j = 1; j < c.stops.length; j++) {
      const [l0, l1] = [levelOf(c.stops[j - 1]), levelOf(c.stops[j])];
      if (l0 !== undefined && l1 !== undefined && l1 !== l0 + 1) err(`${at}.stops: each stop one level above the last (${c.stops[j - 1]} is on level ${l0}, ${c.stops[j]} on ${l1})`); // prettier-ignore
    }
    if (c.length !== undefined && !isPos(c.length)) err(`${at}.length: wanted the path length in cells`);
    if (c.access !== undefined && !ACCESS.includes(c.access)) err(`${at}.access: wanted one of ${ACCESS.join(", ")}`);
    if (c.site !== undefined && !isPair(c.site)) err(`${at}.site: wanted [x, y] in cells (where its well or shaft is centred)`);
  });

  // checkpoints
  const checkpoints = listOf(desc.checkpoints);
  const cpIds = new Set();
  checkpoints.forEach((k, i) => {
    const at = `checkpoints[${i}]${k?.id ? ` (${k.id})` : ""}`;
    if (!isObject(k)) return err(`${at}: wanted an object`);
    if (typeof k.id !== "string" || !k.id) err(`${at}.id: wanted a non-empty string`);
    else if (cpIds.has(k.id)) err(`${at}.id: "${k.id}" is given twice`);
    else cpIds.add(k.id);
    if (!nodeIds.has(k.node)) err(`${at}.node: "${k.node}" is no node's id (where it stands)`);
    for (const c of listOf(k.controls)) if (!connIds.has(c) && !(nodeIds.get(c)?.kind === "gate") && !segIds.has(c)) err(`${at}.controls: "${c}" is no connector, segment or gate node`); // prettier-ignore
    if (!listOf(k.controls).length) err(`${at}.controls: wanted the connectors, gate or segments it controls`);
    if (k.program !== undefined && !isObject(k.program)) err(`${at}.program: wanted { kind: count }`);
  });

  // secrets
  listOf(desc.secrets).forEach((s, i) => {
    const at = `secrets[${i}]${s?.id ? ` (${s.id})` : ""}`;
    if (!isObject(s)) return err(`${at}: wanted an object`);
    if (s.kind === "door") {
      if (!buildingIds.has(s.in)) err(`${at}.in: "${s.in}" is no building's id (a secret door is in a building)`);
    } else if (s.kind === "passage") {
      for (const e of ["from", "to"]) if (!ends(s[e])) err(`${at}.${e}: "${s[e]}" is no node's or building's id`);
      if (layerOf(s.from) && layerOf(s.to) && layerOf(s.from) !== layerOf(s.to)) err(`${at}: a passage stays on one layer; a secret between layers is a connector of type secret`); // prettier-ignore
      if (!isPos(s.length)) err(`${at}.length: wanted cells > 0`);
    } else err(`${at}.kind: wanted door or passage, got ${JSON.stringify(s.kind)}`);
  });

  // housing
  const h = desc.housing;
  if (!isObject(h)) err("housing: wanted { groups, doorNaming, target: { layer: { class: count } } }");
  else {
    if (!isObject(h.groups)) err("housing.groups: wanted { id: { about } }");
    if (!isObject(h.target)) err("housing.target: wanted { layerId: { class: count } }");
    else {
      let sum = 0;
      for (const [lid, row] of Object.entries(h.target)) {
        if (!layerIds.has(lid)) err(`housing.target.${lid}: no layer of that id`);
        for (const [c, n] of Object.entries(row ?? {})) {
          if (!units[c]) err(`housing.target.${lid}.${c}: no such home class`);
          if (!Number.isInteger(n) || n < 0) err(`housing.target.${lid}.${c}: wanted an integer >= 0`);
          else sum += n;
        }
      }
      if (p && Number.isInteger(p.target) && sum !== p.target) err(`housing.target: the homes sum to ${sum}, the player target is ${p.target}`); // prettier-ignore
    }
  }
  listOf(desc.required).forEach((r, i) => {
    const at = `required[${i}]${r?.id ? ` (${r.id})` : ""}`;
    if (!isObject(r)) return err(`${at}: wanted an object`);
    if (r.building !== undefined && !buildingIds.has(r.building)) err(`${at}.building: "${r.building}" is no building's id`); // prettier-ignore
    if (r.node !== undefined && !nodeIds.has(r.node)) err(`${at}.node: "${r.node}" is no node's id`);
    if (r.building === undefined && r.node === undefined && r.type === undefined) err(`${at}: wanted a building, a node or a type`); // prettier-ignore
  });
  if (desc.spawns !== undefined && !(isObject(desc.spawns) && Number.isInteger(desc.spawns.count) && desc.spawns.count >= 0)) err("spawns: wanted { count, minSpacing (cells), where }"); // prettier-ignore
  if (desc.wiring !== undefined && !(isObject(desc.wiring) && Object.entries(desc.wiring).every(([k, n]) => k === "note" || (Number.isInteger(n) && n >= 0)))) err("wiring: wanted { switches, switchableLights, ... } as integers"); // prettier-ignore
  if (desc.roomSizes !== undefined && !(isObject(desc.roomSizes) && Object.values(desc.roomSizes).every((c) => isPair(c, isPos)))) err("roomSizes: wanted { kind: [w, d] } in cells"); // prettier-ignore
  if (!isObject(desc.rules)) err("rules: wanted the rules object (see CITY.md)");
  if (!isObject(desc.engine)) err("engine: wanted { name, limits }");
  return { errors, warnings };
}

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/**
 * The measured form of a valid city: layers by id and level, every node, segment (its length, width, class
 * parameters), building (layer, position, footprint, program, homes), connector (its stops' links, rise, length)
 * and secret; and the walk graph: vertices `n:<node>`, `s:<segment>` (its middle), `b:<building>`, `h:<secret
 * door's room>`; edges with a length in cells and flags (secret, access, vehicle, connector). Throws if not valid.
 */
export function measureCity(desc) {
  const { errors } = validateCity(desc);
  if (errors.length) throw new Error(`the city description is not valid: ${errors[0]}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ""}`); // prettier-ignore
  const classes = streetTable(desc);
  const types = typeTable(desc);
  const unitClasses = unitTable(desc);
  const layers = new Map(desc.layers.map((L) => [L.id, L]));
  const byLevel = new Map(desc.layers.map((L) => [L.level, L]));
  const districts = new Map(desc.districts.map((d) => [d.id, d]));
  const nodes = new Map(desc.streets.nodes.map((n) => [n.id, n]));
  const segments = new Map();
  for (const s of desc.streets.segments) {
    const a = nodes.get(s.from);
    const b = nodes.get(s.to);
    const cls = classes[s.class];
    const straight = dist(a.at, b.at);
    segments.set(s.id, {
      ...s,
      layer: a.layer,
      straight,
      length: s.length ?? straight,
      width: s.width ?? cls.width,
      sidewalk: s.sidewalk ?? cls.sidewalk,
      portico: s.portico ?? 0,
      lanes: s.lanes ?? cls.lanes,
      clearance: s.clearance ?? cls.clearance,
      vehicle: s.vehicle ?? cls.vehicle,
      access: s.access ?? cls.access ?? "public",
      mid: [(a.at[0] + b.at[0]) / 2, (a.at[1] + b.at[1]) / 2],
    });
  }
  const buildings = new Map();
  for (const b of desc.buildings ?? []) {
    const layer = districts.get(b.district).layer;
    const front = segments.get(b.frontage) ?? nodes.get(b.frontage);
    const at = b.at ?? front.mid ?? front.at;
    const program = programOf(b, types);
    const homes = unitsOf(b, types);
    buildings.set(b.id, { ...b, layer, at, program, homes, residential: Boolean(types[b.type].residential) });
  }
  const layerOf = (id) => nodes.get(id)?.layer ?? buildings.get(id)?.layer;
  const posOf = (id) => nodes.get(id)?.at ?? buildings.get(id)?.at;
  const vertexOf = (id) => (nodes.has(id) ? `n:${id}` : `b:${id}`);

  const edges = [];
  const edge = (a, b, length, flags = {}) => edges.push({ a, b, length, ...flags });
  for (const s of segments.values()) {
    const f = { kind: "segment", id: s.id, access: s.access, vehicle: s.vehicle, cls: s.class };
    edge(`n:${s.from}`, `s:${s.id}`, s.length / 2, f);
    edge(`s:${s.id}`, `n:${s.to}`, s.length / 2, f);
  }
  for (const b of buildings.values()) {
    const front = segments.has(b.frontage) ? `s:${b.frontage}` : `n:${b.frontage}`;
    edge(front, `b:${b.id}`, 0, { kind: "frontage", id: b.id, access: "public" });
    for (const ps of b.passages ?? [])
      edge(`b:${b.id}`, vertexOf(ps.to), ps.length ?? 4, { kind: "passage", id: b.id, access: ps.access ?? "public", secret: ps.type === "secret" }); // prettier-ignore
  }
  const connectors = [];
  for (const c of desc.connectors ?? []) {
    const links = [];
    for (let j = 1; j < c.stops.length; j++) {
      const [lo, hi] = [c.stops[j - 1], c.stops[j]];
      const [L0, L1] = [layers.get(layerOf(lo)), layers.get(layerOf(hi))];
      const rise = L1.z[0] - L0.z[0];
      const horizontal = dist(posOf(lo), posOf(hi));
      const length = c.length ?? Math.max(rise, horizontal);
      links.push({ lo, hi, loLevel: L0.level, hiLevel: L1.level, rise, horizontal, length });
      edge(vertexOf(lo), vertexOf(hi), length, { kind: "connector", id: c.id, type: c.type, access: c.access ?? "public", secret: c.type === "secret", vehicle: Boolean(CONNECTOR_TYPES[c.type].vehicle) }); // prettier-ignore
    }
    connectors.push({ ...c, access: c.access ?? "public", links });
  }
  const secrets = [];
  for (const s of desc.secrets ?? []) {
    if (s.kind === "door") {
      edge(`b:${s.in}`, `h:${s.id}`, 2, { kind: "secret-door", id: s.id, secret: true, access: "public" });
      secrets.push({ ...s, layer: buildings.get(s.in).layer });
    } else {
      edge(vertexOf(s.from), vertexOf(s.to), s.length, { kind: "secret-passage", id: s.id, secret: true, access: "public" }); // prettier-ignore
      secrets.push({ ...s, layer: layerOf(s.from) });
    }
  }
  const vertexLayer = (v) => {
    const [k, id] = [v.slice(0, 1), v.slice(2)];
    if (k === "n") return nodes.get(id).layer;
    if (k === "s") return segments.get(id).layer;
    if (k === "b") return buildings.get(id).layer;
    return secrets.find((s) => s.id === id)?.layer;
  };
  return {
    name: desc.name,
    desc,
    grid: desc.grid,
    classes,
    types,
    unitClasses,
    layers,
    byLevel,
    districts,
    nodes,
    segments,
    buildings,
    connectors,
    secrets,
    checkpoints: desc.checkpoints ?? [],
    edges,
    vertexLayer,
    vertexOf,
    layerOf,
    posOf,
  };
}
