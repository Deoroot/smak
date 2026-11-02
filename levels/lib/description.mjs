// A level description: what a level is made of and how it plays, before any geometry exists. Spaces (a room, a
// corridor, a hall, a cave, a yard, a stair) with a size class and a storey; links between them (a door, an
// opening, a stair, a one-way drop, a gate with its key, a secret); the route (start, goal, hubs); the pacing of
// every space and its encounter slots; rewards; and the grid a modular kit is laid on. The format is documented
// in levels/specs/README.md; this file reads and validates one and gives the measured form the checks use
// (levels/lib/description-checks.mjs).
//
// Nothing here knows a kit or an engine: sizes are in grid cells, and the grid section says what a cell is.

export const FORMAT = "smak-level-description/1";

export const SPACE_TYPES = ["room", "corridor", "hall", "cave", "yard", "stair"];
export const LINK_TYPES = ["door", "open", "stair", "drop", "gate", "secret"];
export const PACING = ["quiet", "tension", "fight", "rest"];
export const SIZE_CLASSES = ["s", "m", "l", "xl"];

/** An encounter slot's weight by its size: what the pacing curve sums. */
export const ENCOUNTER_WEIGHTS = { small: 1, medium: 2, large: 4, boss: 8 };

/**
 * Footprints of the size classes in grid cells, [width, depth] (depth the long side, the way through). A
 * corridor one cell wide is 2.5 m on a 2.5 m grid, MSR's passages' median (2.6 m); a stair's depth carries one
 * storey's flight (16 risers of 0.3125 m = 5 m, two cells) and its landings. A description may override any of
 * them in its own `sizes`, or give a space `cells` instead of a class.
 */
export const DEFAULT_SIZES = {
  room: { s: [3, 3], m: [4, 5], l: [6, 6], xl: [8, 8] },
  hall: { s: [4, 6], m: [6, 8], l: [8, 10], xl: [10, 14] },
  corridor: { s: [1, 4], m: [1, 6], l: [1, 10], xl: [2, 14] },
  cave: { s: [3, 4], m: [5, 6], l: [8, 10], xl: [12, 14] },
  yard: { s: [6, 6], m: [8, 8], l: [12, 12], xl: [16, 16] },
  stair: { s: [1, 3], m: [2, 4], l: [2, 6], xl: [4, 6] },
};

/** Types whose way through is their long side (walked end to end); the others are crossed side to side. */
const LENGTHWISE = new Set(["corridor", "stair"]);
/** Types that may stand over more than one storey (`storey: [low, high]`). */
const TALL = new Set(["stair", "hall", "cave", "yard"]);

const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);
/** A space's storeys as [low, high]. */
export const storeysOf = (space) =>
  Array.isArray(space.storey) ? [space.storey[0], space.storey[1]] : [space.storey ?? 0, space.storey ?? 0];
/** The keys a space gives: `key` (one name) and `keys` (several). */
export const keysOf = (space) => [...(space.key ? [space.key] : []), ...(space.keys ?? [])];
/** A space's rewards as a list, a key counted as one. */
export const rewardsOf = (space) => [
  ...(Array.isArray(space.reward) ? space.reward : space.reward ? [space.reward] : []),
  ...keysOf(space).map((key) => ({ kind: "key", key })),
];
/** A space's encounter weight: the sum of its slots' weights times their counts. */
export const encounterWeight = (space) =>
  (space.encounters ?? []).reduce((sum, e) => sum + (ENCOUNTER_WEIGHTS[e.size] ?? 0) * (e.count ?? 1), 0);

/**
 * Validates a description. Returns the errors (each names the field and what it wanted) and the warnings
 * (things allowed but probably not meant). An empty `errors` means the checks can run on it.
 */
export function validateDescription(desc) {
  const errors = [];
  const warnings = [];
  if (!isObject(desc)) return { errors: ["the description is not a JSON object"], warnings };
  if (desc.format !== FORMAT) errors.push(`format: wanted "${FORMAT}", got ${JSON.stringify(desc.format)}`);
  if (typeof desc.name !== "string" || !desc.name) errors.push("name: wanted a non-empty string");

  const grid = desc.grid;
  if (!isObject(grid)) errors.push("grid: wanted an object with cell and storey (metres)");
  else {
    if (!(grid.cell > 0)) errors.push(`grid.cell: wanted metres > 0, got ${JSON.stringify(grid.cell)}`);
    if (!(grid.storey > 0)) errors.push(`grid.storey: wanted metres > 0, got ${JSON.stringify(grid.storey)}`);
  }
  const sizes = sizeTable(desc);
  for (const [type, classes] of Object.entries(desc.sizes ?? {})) {
    if (!SPACE_TYPES.includes(type)) errors.push(`sizes.${type}: no such space type (${SPACE_TYPES.join(", ")})`);
    else for (const [c, cells] of Object.entries(classes)) if (!goodCells(cells)) errors.push(`sizes.${type}.${c}: wanted [width, depth] in cells > 0`); // prettier-ignore
  }

  const spaces = Array.isArray(desc.spaces) ? desc.spaces : [];
  if (!spaces.length) errors.push("spaces: wanted a non-empty list");
  const ids = new Set();
  const keyHolders = new Map();
  spaces.forEach((s, i) => {
    const at = `spaces[${i}]${s && s.id ? ` (${s.id})` : ""}`;
    if (!isObject(s)) return errors.push(`${at}: wanted an object`);
    if (typeof s.id !== "string" || !s.id) errors.push(`${at}.id: wanted a non-empty string`);
    else if (ids.has(s.id)) errors.push(`${at}.id: "${s.id}" is given twice`);
    else ids.add(s.id);
    if (!SPACE_TYPES.includes(s.type)) errors.push(`${at}.type: wanted one of ${SPACE_TYPES.join(", ")}, got ${JSON.stringify(s.type)}`); // prettier-ignore
    if (s.cells !== undefined) {
      if (!goodCells(s.cells)) errors.push(`${at}.cells: wanted [width, depth] in cells > 0 (halves allowed)`);
    } else if (!SIZE_CLASSES.includes(s.size)) errors.push(`${at}.size: wanted one of ${SIZE_CLASSES.join(", ")} or cells: [w, d], got ${JSON.stringify(s.size)}`); // prettier-ignore
    else if (SPACE_TYPES.includes(s.type) && !sizes[s.type]?.[s.size]) errors.push(`${at}.size: no size "${s.size}" for a ${s.type}`); // prettier-ignore
    if (Array.isArray(s.storey)) {
      const [lo, hi] = s.storey;
      if (!isInt(lo) || !isInt(hi) || hi <= lo) errors.push(`${at}.storey: wanted [low, high] integers, high above low`);
      else if (!TALL.has(s.type)) errors.push(`${at}.storey: only a ${[...TALL].join(", ")} may stand over several storeys`); // prettier-ignore
    } else if (s.storey !== undefined && !isInt(s.storey)) errors.push(`${at}.storey: wanted an integer, got ${JSON.stringify(s.storey)}`); // prettier-ignore
    if (s.pacing !== undefined && !PACING.includes(s.pacing)) errors.push(`${at}.pacing: wanted one of ${PACING.join(", ")}, got ${JSON.stringify(s.pacing)}`); // prettier-ignore
    (Array.isArray(s.encounters) ? s.encounters : s.encounters === undefined ? [] : [null]).forEach(
      (e, j) => {
        if (!isObject(e) || !(e.size in ENCOUNTER_WEIGHTS)) errors.push(`${at}.encounters[${j}].size: wanted one of ${Object.keys(ENCOUNTER_WEIGHTS).join(", ")}`); // prettier-ignore
      else if (e.count !== undefined && !(isInt(e.count) && e.count >= 1)) errors.push(`${at}.encounters[${j}].count: wanted an integer >= 1`); // prettier-ignore
      },
    );
    if (s.pacing === "fight" && !(s.encounters ?? []).length) errors.push(`${at}.encounters: a fight space wants at least one encounter slot`); // prettier-ignore
    if ((s.pacing === "rest" || s.pacing === "quiet") && (s.encounters ?? []).length) warnings.push(`${at}: a ${s.pacing} space holds encounter slots`); // prettier-ignore
    for (const r of Array.isArray(s.reward) ? s.reward : s.reward ? [s.reward] : []) if (!isObject(r) || typeof r.kind !== "string") errors.push(`${at}.reward: wanted { kind } (or a list of them)`); // prettier-ignore
    if (s.key !== undefined && (typeof s.key !== "string" || !s.key))
      errors.push(`${at}.key: wanted a key's name`);
    if (s.keys !== undefined && !(Array.isArray(s.keys) && s.keys.every((k) => typeof k === "string" && k))) errors.push(`${at}.keys: wanted a list of keys' names`); // prettier-ignore
    for (const k of keysOf(s)) {
      if (typeof k !== "string") continue;
      if (keyHolders.has(k))
        errors.push(`${at}: key "${k}" is also in ${keyHolders.get(k)}: a key lies in one space`);
      else keyHolders.set(k, s.id);
    }
  });
  const byId = new Map(spaces.filter((s) => isObject(s)).map((s) => [s.id, s]));

  const links = Array.isArray(desc.links) ? desc.links : [];
  if (!Array.isArray(desc.links)) errors.push("links: wanted a list");
  const usedKeys = new Set();
  links.forEach((l, i) => {
    const at = `links[${i}]${l && l.from ? ` (${l.from} -> ${l.to})` : ""}`;
    if (!isObject(l)) return errors.push(`${at}: wanted an object`);
    for (const end of ["from", "to"])
      if (!byId.has(l[end])) errors.push(`${at}.${end}: "${l[end]}" is no space's id`);
    if (l.from === l.to) errors.push(`${at}: a link joins two different spaces`);
    if (!LINK_TYPES.includes(l.type)) return errors.push(`${at}.type: wanted one of ${LINK_TYPES.join(", ")}, got ${JSON.stringify(l.type)}`); // prettier-ignore
    if (l.type === "gate") {
      if (typeof l.key !== "string" || !l.key) errors.push(`${at}.key: a gate wants the name of its key`);
      else if (!keyHolders.has(l.key)) errors.push(`${at}.key: "${l.key}" is no space's key`);
      else usedKeys.add(l.key);
    } else if (l.key !== undefined) errors.push(`${at}.key: only a gate takes a key (this is a ${l.type})`);
    if (l.oneWay !== undefined && typeof l.oneWay !== "boolean")
      errors.push(`${at}.oneWay: wanted true or false`);
    const a = byId.get(l.from);
    const b = byId.get(l.to);
    if (!a || !b) return;
    const [aLo, aHi] = storeysOf(a);
    const [bLo, bHi] = storeysOf(b);
    const share = aLo <= bHi && bLo <= aHi;
    if (l.type === "drop") {
      if (!(aLo > bLo) && !(l.height > 0)) errors.push(`${at}: a drop goes to a lower storey (${aLo} to ${bLo}), or gives its height in metres within one`); // prettier-ignore
    } else if (l.type === "stair") {
      if (aLo === bLo && aHi === bHi && a.type !== "stair" && b.type !== "stair") errors.push(`${at}: a stair link joins two storeys (both are ${aLo})`); // prettier-ignore
    } else if (!share) errors.push(`${at}: a ${l.type} joins spaces of one storey (${fmtStoreys(a)} and ${fmtStoreys(b)}); use a stair or a drop`); // prettier-ignore
  });
  for (const [k, holder] of keyHolders)
    if (!usedKeys.has(k)) warnings.push(`key "${k}" (in ${holder}) opens no gate`);

  const route = desc.route;
  if (!isObject(route)) errors.push("route: wanted { start, goal }");
  else {
    for (const end of ["start", "goal"]) if (!byId.has(route[end])) errors.push(`route.${end}: "${route[end]}" is no space's id`); // prettier-ignore
    if (route.start && route.start === route.goal) errors.push("route: start and goal are one space");
    (route.hubs ?? []).forEach(
      (h, i) => byId.has(h) || errors.push(`route.hubs[${i}]: "${h}" is no space's id`),
    );
  }
  return { errors, warnings };
}

const goodCells = (c) =>
  Array.isArray(c) && c.length === 2 && c.every((v) => v > 0 && Number.isInteger(v * 2));
const fmtStoreys = (s) => (Array.isArray(s.storey) ? `${s.storey[0]}..${s.storey[1]}` : `${s.storey ?? 0}`);
const sizeTable = (desc) => {
  const out = {};
  for (const type of SPACE_TYPES) out[type] = { ...DEFAULT_SIZES[type], ...(desc?.sizes?.[type] ?? {}) };
  return out;
};

/**
 * The measured form of a valid description: every space with its footprint in cells and metres, its area, the
 * length a walk through it takes, its storeys, keys, rewards and encounter weight; the links as directed moves
 * (a drop or a one-way link only from `from` to `to`; a gate needing its key). Throws if the description is not
 * valid (validateDescription first to get the reasons).
 */
export function measureDescription(desc) {
  const { errors } = validateDescription(desc);
  if (errors.length) throw new Error(`the description is not valid: ${errors[0]}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ""}`); // prettier-ignore
  const cell = desc.grid.cell;
  const sizes = sizeTable(desc);
  const spaces = new Map();
  for (const s of desc.spaces) {
    const cells = s.cells ?? sizes[s.type][s.size];
    const [w, d] = [Math.min(...cells), Math.max(...cells)];
    const traverse = (LENGTHWISE.has(s.type) ? d : (w + d) / 2) * cell;
    spaces.set(s.id, {
      id: s.id,
      type: s.type,
      cells: [w, d],
      metres: [w * cell, d * cell],
      area: w * d * cell * cell,
      traverse,
      storeys: storeysOf(s),
      pacing: s.pacing ?? "quiet",
      weight: encounterWeight(s),
      encounters: s.encounters ?? [],
      keys: keysOf(s),
      rewards: rewardsOf(s),
      side: Boolean(s.side),
      source: s,
    });
  }
  const moves = [];
  desc.links.forEach((l, index) => {
    const oneWay = l.type === "drop" || l.oneWay === true;
    const base = {
      index,
      type: l.type,
      key: l.type === "gate" ? l.key : undefined,
      secret: l.type === "secret",
    };
    moves.push({ ...base, from: l.from, to: l.to });
    if (!oneWay) moves.push({ ...base, from: l.to, to: l.from });
  });
  const keys = [...new Set(desc.spaces.flatMap(keysOf))];
  return {
    name: desc.name,
    grid: desc.grid,
    style: desc.style ?? {},
    start: desc.route.start,
    goal: desc.route.goal,
    hubs: desc.route.hubs ?? [],
    spaces,
    links: desc.links,
    moves,
    keys,
  };
}
