// The architecture rulebook (`smak-architecture-rules/1`, levels/rules/architecture.json): the rules an architect
// carries in their head, as data a level generator obeys so a layout is sound with no architect on the project.
// This file loads and validates the rulebook (each error names its field), converts it to an engine's units through
// the player hull (`rulesFor`), lays a description's own rules over it allowing only tightening (`tighten`), and
// gives the pure checks the generator's stages and the built-geometry checks share: doors, stairs, ceilings, the
// keep-clear volumes and props against them, room programs and circulation. Every check answers
// `{ ok, failures }`, each failure a sentence naming the thing and the number it wanted.
//
// Coordinates: x and y on the floor, z up. Boxes are axis-aligned `{ what, min: [x, y, z], max: [x, y, z] }`. A
// `facing` is a unit vector on the floor along an axis ([1, 0], [-1, 0], [0, 1], [0, -1]). Lengths are in the
// rules' own units: metres for the rulebook as loaded, engine units after `rulesFor`.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FORMAT = "smak-architecture-rules/1";
export const RULES_PATH = join(dirname(fileURLToPath(import.meta.url)), "../rules/architecture.json");

export const DOOR_KINDS_WANTED = ["house", "shop", "public", "cell", "gate", "secret"];
const ZONE_NAMES = ["public", "staff", "home", "private", "secure", "circulation", "outdoor"];
const CLUTTER = ["circulation", "public", "work", "living", "storage", "secure", "hall", "outdoor"];

// Keys whose numbers carry no length (left alone by rulesFor) and keys that are areas (by length squared).
export const PLAIN = new Set([
  "maxPitch", "maxGrade", "typicalGrade", "maxRisersPerFlight", "minPerStorey", "rank", "privateFrom",
  "entranceMaxRank", "version", "maxSlopeDeg", "horizontal", "openingHeight", "ceiling", "pattern",
  "maxBrushes", "maxSkewDeg", "maxBaseShare", "maxWidthOfTypical",
  // the forms section (stage 9): ratios, shares and counts
  "maxSlenderness", "minDepthPerSpan", "minShare", "minBayPerFrontage", "maxPerCity", "cagesPerFace", "sides",
  "maxRockShare", "reserveShare", "maxBrushesPerBay",
  // the facade family's (forms-facade.mjs): ratios and counts
  "rise", "ribs", "minDiffer", "maxRepeatShare", "minHeights", "maxRun", "minStoreysOver", "maxTiers",
  // the edges family's (forms-edges.mjs): shares, counts and estimates
  "maxShareOfHeadroom", "segments", "blades", "maxPerTile", "rockEstimate", "farClipMargin",
]); // prettier-ignore
const AREA = new Set(["minArea", "maxArea", "maxAreaOnOneStair"]);
// Sections rulesFor converts; the rest (sources, scale, zones, programs, homes, roomNeeds) hold no lengths.
const LENGTH_SECTIONS = ["dimensions", "roomKinds", "spaceKinds", "circulation", "keepClear", "placement", "forms"];
/** The forms' wealth modes (forms.fusion.modeByWealth) and guards (forms.oculus.guards). */
export const FUSION_MODES = ["full", "partial", "gap"];
export const OCULUS_GUARDS = ["parapet", "grate"];
/** The facade family's vocabulary (forms.facadeThemes): relief patterns, rooflines by the ceiling over a lot, corner pieces. */
export const FACADE_PATTERNS = ["pier", "loggia", "bay", "plain", "cage", "box", "drop"];
export const ROOF_FORMS = ["plain", "cornice", "balustrade", "parapet", "tank", "shack", "vents", "pipe", "attic"];
export const ROOF_CEILINGS = ["sky", "fused", "vault"];
export const CORNER_TREATMENTS = ["turret", "drum", "pier", "quoin", "buttress"];
const WEALTHS = ["slum", "low", "mid", "high", "elite"];
// Text the tightening merge lets a description change freely.
const TEXT = new Set(["note", "maxNote", "maxSource", "why", "real", "source", "sources", "patterns", "pattern", "status", "about", "pitchNote", "walkNote", "coveredNote", "privateThroughNote", "jumpNote", "unplaced", "swing", "facing", "headroom", "title", "budgetNote"]); // prettier-ignore
// Lists a description may only shorten (fewer allowances) and lists it may only lengthen (more demands).
const SUBSET = new Set(["privateThroughAllowed", "optional", "entrance", "kinds", "waive", "guards"]);
const SUPERSET = new Set(["adjacency", "oneOf", "street", "window", "noWindow", "neverAcross"]);

const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const clone = (v) => JSON.parse(JSON.stringify(v));
const round = (v) => (isNum(v) ? Math.round(v * 1000) / 1000 : v);
const unitOf = (rules) => (rules?.units?.length === "m" ? "m" : rules?.units?.length ?? "m");
const areaUnitOf = (rules) => (unitOf(rules) === "m" ? "m2" : `square ${unitOf(rules)}`);
const say = (v, rules) => `${round(v)} ${unitOf(rules)}`;
const result = (failures) => ({ ok: failures.length === 0, failures });

// ── loading and validating ──

/** Reads the rulebook (the default one beside this file), validates it, and throws listing every error. */
export function loadRules(file = RULES_PATH) {
  const rules = JSON.parse(readFileSync(file, "utf8"));
  const { errors } = validateRules(rules);
  if (errors.length) throw new Error(`${file}: the rulebook is invalid:\n  ${errors.join("\n  ")}`);
  return rules;
}

/** The hull in metres that bounds every engine listed: the widest, tallest, and the lowest step. */
export function hullMetres(rules) {
  const engines = Object.values(rules?.hull?.engines ?? {}).filter((e) => isNum(e.unitM));
  const max = (k) => Math.max(...engines.map((e) => e[k] * e.unitM));
  const min = (k) => Math.min(...engines.map((e) => e[k] * e.unitM));
  return { width: max("width"), height: max("height"), crouch: max("crouch"), step: min("step") };
}

/** The hull in the rules' own units (after rulesFor: the engine's; before: hullMetres). */
export function hullOf(rules) {
  return rules.hullNow ?? hullMetres(rules);
}

/**
 * Validates a rulebook. Returns { errors, warnings }; each error names the field and what it wanted. Holds every
 * range in order (min <= typical <= max), every source cited to the sources list, every passable minimum at least
 * the hull plus its clearance for every engine, and every room kind, zone and ceiling a program names to exist.
 */
export function validateRules(rules) {
  const errors = [];
  const warnings = [];
  const err = (field, wanted) => errors.push(`${field}: ${wanted}`);
  if (!isObject(rules)) return { errors: ["the rulebook: wanted a JSON object"], warnings };
  if (rules.format !== FORMAT) err("format", `wanted "${FORMAT}", got ${JSON.stringify(rules.format)}`);
  for (const k of ["sources", "scale", "hull", "dimensions", "zones", "roomKinds", "programs", "spaceKinds", "circulation", "keepClear", "placement"]) // prettier-ignore
    if (!isObject(rules[k])) err(k, "wanted an object");
  if (errors.length) return { errors, warnings };
  if (rules.units?.length !== "m") err("units.length", `wanted "m" (the rulebook is kept in metres), got ${JSON.stringify(rules.units?.length)}`); // prettier-ignore

  // sources: every `source` list anywhere names an entry of `sources`
  const walk = (node, path, visit) => {
    if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`, visit));
    else if (isObject(node)) for (const [k, v] of Object.entries(node)) { visit(k, v, path ? `${path}.${k}` : k, node); walk(v, path ? `${path}.${k}` : k, visit); } // prettier-ignore
  };
  walk(rules, "", (k, v, field) => {
    if (field.startsWith("sources.")) return;
    if (k === "source" || k === "pitchSource" || k === "flightSource" || field === "scale.evidence") {
      const list = Array.isArray(v) ? v : [v];
      for (const s of list) if (typeof s !== "string" || !rules.sources[s]) err(field, `cites "${s}", which is not in sources`);
    }
    if (isObject(v) && ("min" in v || "max" in v || "typical" in v)) {
      const { min, typical, max } = v;
      for (const [name, x] of [["min", min], ["typical", typical], ["max", max]])
        if (x !== undefined && x !== null && !(isNum(x) && x >= 0)) err(`${field}.${name}`, `wanted a number >= 0, got ${JSON.stringify(x)}`); // prettier-ignore
      if (isNum(min) && isNum(typical) && typical < min) err(`${field}.typical`, `${typical} is under the min ${min}`);
      if (isNum(max) && isNum(typical) && typical > max) err(`${field}.typical`, `${typical} is over the max ${max}`);
      if (isNum(min) && isNum(max) && max < min) err(`${field}.max`, `${max} is under the min ${min}`);
    }
  });

  // the scale and the hulls
  for (const k of ["horizontal", "openingHeight", "ceiling"])
    if (!(isNum(rules.scale[k]) && rules.scale[k] >= 1)) err(`scale.${k}`, "wanted a factor >= 1 (game scale is never smaller than real)"); // prettier-ignore
  const engines = rules.hull.engines;
  if (!isObject(engines) || !Object.keys(engines).length) err("hull.engines", "wanted at least one engine");
  else
    for (const [name, e] of Object.entries(engines)) {
      for (const k of ["unitM", "width", "height", "crouch", "step"])
        if (!(isNum(e[k]) && e[k] > 0)) err(`hull.engines.${name}.${k}`, `wanted a number > 0, got ${JSON.stringify(e[k])}`); // prettier-ignore
      if (!e.source) err(`hull.engines.${name}.source`, "wanted where the hull was read");
    }
  const before = errors.length;
  for (const k of ["minClearance", "minHeadClearance"])
    if (!(isNum(rules.hull[k]) && rules.hull[k] >= 0)) err(`hull.${k}`, "wanted a number >= 0 in metres");
  if (errors.some((e) => e.startsWith("hull.")) || errors.length > before) return { errors, warnings };
  const hull = hullMetres(rules);
  const passW = hull.width + 2 * rules.hull.minClearance;
  const passH = hull.height + rules.hull.minHeadClearance;
  const crawlH = hull.crouch + rules.hull.minHeadClearance;
  const d = rules.dimensions;

  // doors: the six kinds the generator names, each passable by the hull
  const doors = d.doors ?? {};
  for (const k of DOOR_KINDS_WANTED) if (!doors[k]) err(`dimensions.doors.${k}`, "missing: wanted every door kind the generator names");
  for (const [k, door] of Object.entries(doors)) {
    const at = `dimensions.doors.${k}`;
    if (!isNum(door.width?.min)) { err(`${at}.width.min`, "wanted a number in metres"); continue; } // prettier-ignore
    if (!isNum(door.height?.min)) { err(`${at}.height.min`, "wanted a number in metres"); continue; } // prettier-ignore
    if (door.width.min < passW) err(`${at}.width.min`, `${door.width.min} m is under the hull's ${round(passW)} m (its width and ${rules.hull.minClearance} m a side)`); // prettier-ignore
    const wantH = door.posture === "ducked" ? crawlH : passH;
    if (door.height.min < wantH) err(`${at}.height.min`, `${door.height.min} m is under the hull's ${round(wantH)} m`);
    if (!door.source) err(`${at}.source`, "wanted where the number comes from");
  }
  for (const [k, c] of Object.entries(d.corridors ?? {})) {
    const at = `dimensions.corridors.${k}`;
    if (!isNum(c.width?.min) || c.width.min < passW) err(`${at}.width.min`, `wanted at least the hull's ${round(passW)} m, got ${c.width?.min}`); // prettier-ignore
    if (!isNum(c.height?.min) || c.height.min < passH) err(`${at}.height.min`, `wanted at least the hull's ${round(passH)} m, got ${c.height?.min}`); // prettier-ignore
  }
  // stairs
  const s = d.stairs ?? {};
  if (!isNum(s.rise?.max)) err("dimensions.stairs.rise.max", "wanted a number in metres");
  else if (s.rise.max > hull.step) err("dimensions.stairs.rise.max", `${s.rise.max} m is over the hull's step (${round(hull.step)} m): a riser could not be climbed`); // prettier-ignore
  if (!isNum(s.run?.min)) err("dimensions.stairs.run.min", "wanted a number in metres");
  if (!(isNum(s.maxPitch) && s.maxPitch > 0 && s.maxPitch <= 1)) err("dimensions.stairs.maxPitch", "wanted rise over run in (0, 1]"); // prettier-ignore
  const cb = d.cellBars;
  if (cb !== undefined) {
    for (const k of cb.kinds ?? []) if (!rules.roomKinds?.[k]) err("dimensions.cellBars.kinds", `no such room kind "${k}"`);
    if (!(isNum(cb.bar?.min) && cb.bar.min > 0)) err("dimensions.cellBars.bar.min", "wanted a bar's width in metres");
    if (!(isNum(cb.clearGap?.max) && cb.clearGap.max > (cb.bar?.min ?? 0))) err("dimensions.cellBars.clearGap.max", "wanted the clear gap between bars in metres");
    if (!(Number.isInteger(cb.maxBrushes) && cb.maxBrushes >= 3)) err("dimensions.cellBars.maxBrushes", "wanted a whole number of brushes a front, 3 or more");
    if (cb.fallback !== undefined && cb.fallback !== "masked") err("dimensions.cellBars.fallback", `wanted "masked" or nothing, got ${JSON.stringify(cb.fallback)}`); // prettier-ignore
  }
  for (const [k, w] of Object.entries(s.width ?? {}))
    if (!isNum(w.min) || w.min < passW) err(`dimensions.stairs.width.${k}.min`, `wanted at least the hull's ${round(passW)} m, got ${w.min}`); // prettier-ignore
  if (!isNum(s.headroom?.min) || s.headroom.min < passH) err("dimensions.stairs.headroom.min", `wanted at least the hull's ${round(passH)} m, got ${s.headroom?.min}`); // prettier-ignore
  if (!(Number.isInteger(s.maxRisersPerFlight) && s.maxRisersPerFlight > 0)) err("dimensions.stairs.maxRisersPerFlight", "wanted a whole number > 0"); // prettier-ignore
  if (!isNum(s.landing?.minDepth)) err("dimensions.stairs.landing.minDepth", "wanted a number in metres");
  // ceilings
  const ceilings = d.ceilings ?? {};
  for (const [k, c] of Object.entries(ceilings)) {
    if (!isObject(c)) continue;
    if (!isNum(c.min) || c.min < passH) err(`dimensions.ceilings.${k}.min`, `wanted at least the hull's ${round(passH)} m, got ${c.min}`); // prettier-ignore
  }
  // lifts and windows
  if (!isNum(d.lifts?.car?.width?.min) || d.lifts.car.width.min < passW) err("dimensions.lifts.car.width.min", `wanted at least the hull's ${round(passW)} m`); // prettier-ignore
  if (!isNum(d.windows?.sill?.min)) err("dimensions.windows.sill.min", "wanted a number in metres");
  else if (d.windows.sill.min <= hull.step) err("dimensions.windows.sill.min", `${d.windows.sill.min} m is not above the hull's step (${round(hull.step)} m): a player would walk out of an open window`); // prettier-ignore

  // zones, room kinds, programs
  for (const z of ZONE_NAMES) if (!isNum(rules.zones[z]?.rank)) err(`zones.${z}.rank`, "wanted a whole number");
  if (!isNum(rules.zones.privateFrom)) err("zones.privateFrom", "wanted the rank from which a room is private");
  const kinds = rules.roomKinds;
  for (const [k, r] of Object.entries(kinds)) {
    const at = `roomKinds.${k}`;
    if (!rules.zones[r.zone] || !isObject(rules.zones[r.zone])) err(`${at}.zone`, `wanted one of ${ZONE_NAMES.join(", ")}, got ${JSON.stringify(r.zone)}`); // prettier-ignore
    if (!isObject(ceilings[r.ceiling])) err(`${at}.ceiling`, `wanted a ceiling of dimensions.ceilings, got ${JSON.stringify(r.ceiling)}`); // prettier-ignore
    if (!(isNum(r.minArea) && r.minArea > 0)) err(`${at}.minArea`, "wanted square metres > 0");
    if (!(isNum(r.minSide) && r.minSide >= passW)) err(`${at}.minSide`, `wanted at least the hull's ${round(passW)} m, got ${r.minSide}`); // prettier-ignore
    if (isNum(r.minArea) && isNum(r.minSide) && r.minArea < r.minSide * r.minSide)
      warnings.push(`${at}: minArea ${r.minArea} is under minSide squared (${round(r.minSide * r.minSide)}): the side binds first`);
    if (!CLUTTER.includes(r.clutter)) err(`${at}.clutter`, `wanted one of ${CLUTTER.join(", ")}`);
    if (r.maxArea !== undefined && !(isNum(r.maxArea) && r.maxArea >= (r.minArea ?? 0))) err(`${at}.maxArea`, `wanted square metres at least its minArea ${r.minArea}`); // prettier-ignore
    if (r.maxArea !== undefined && !(typeof r.maxNote === "string" && r.maxNote && Array.isArray(r.maxSource) && r.maxSource.length)) err(`${at}.maxArea`, "wanted its reason: a maxNote and a maxSource (the real data and the games' area factor it was set from)"); // prettier-ignore
    for (const s of Array.isArray(r.maxSource) ? r.maxSource : []) if (!rules.sources?.[s]) err(`${at}.maxSource`, `cites "${s}", which is not in sources`);
    // a corridor kind's width cap, a share of its class's typical width (dimensions.corridors), with its reason
    if (r.maxWidthOfTypical !== undefined && !(isNum(r.maxWidthOfTypical) && r.maxWidthOfTypical >= 1)) err(`${at}.maxWidthOfTypical`, "wanted a number of 1 or more (times the corridor class's typical width)"); // prettier-ignore
    if (r.maxWidthOfTypical !== undefined && !(typeof r.maxNote === "string" && r.maxNote && Array.isArray(r.maxSource) && r.maxSource.length)) err(`${at}.maxWidthOfTypical`, "wanted its reason: a maxNote and a maxSource"); // prettier-ignore
  }
  const spaceKinds = rules.spaceKinds;
  for (const [k, r] of Object.entries(spaceKinds)) {
    if (!isObject(r) || k === "linkDoors") continue;
    if (!isObject(ceilings[r.ceiling])) err(`spaceKinds.${k}.ceiling`, `wanted a ceiling of dimensions.ceilings, got ${JSON.stringify(r.ceiling)}`); // prettier-ignore
    if (!(isNum(r.minSide) && r.minSide >= passW)) err(`spaceKinds.${k}.minSide`, `wanted at least the hull's ${round(passW)} m`); // prettier-ignore
    if (r.corridor && !d.corridors?.[r.corridor]) err(`spaceKinds.${k}.corridor`, `no corridor kind "${r.corridor}"`);
    if (r.stair && !s.width?.[r.stair]) err(`spaceKinds.${k}.stair`, `no stair width kind "${r.stair}"`);
    if (!CLUTTER.includes(r.clutter)) err(`spaceKinds.${k}.clutter`, `wanted one of ${CLUTTER.join(", ")}`);
  }
  for (const [link, door] of Object.entries(spaceKinds.linkDoors ?? {}))
    if (!doors[door]) err(`spaceKinds.linkDoors.${link}`, `no door kind "${door}"`);
  const known = (k, prog) => (prog.spaces ? spaceKinds[k] : kinds[k]);
  for (const [type, prog] of Object.entries(rules.programs)) {
    const at = `programs.${type}`;
    if (!isObject(prog.required)) err(`${at}.required`, "wanted { kind: count }");
    for (const [k, n] of Object.entries(prog.required ?? {})) {
      if (!known(k, prog)) err(`${at}.required.${k}`, "no such room kind in roomKinds");
      if (!(Number.isInteger(n) && n > 0)) err(`${at}.required.${k}`, `wanted a count > 0, got ${n}`);
    }
    for (const [i, k] of (prog.optional ?? []).entries()) if (!known(k, prog)) err(`${at}.optional[${i}]`, `no such room kind "${k}"`); // prettier-ignore
    for (const [i, group] of (prog.oneOf ?? []).entries())
      for (const k of group) if (!known(k, prog)) err(`${at}.oneOf[${i}]`, `no such room kind "${k}"`);
    for (const [i, k] of (prog.entrance ?? []).entries()) if (!known(k, prog)) err(`${at}.entrance[${i}]`, `no such room kind "${k}"`); // prettier-ignore
    for (const [i, a] of (prog.adjacency ?? []).entries()) {
      if (!known(a.a, prog)) err(`${at}.adjacency[${i}].a`, `no such room kind "${a.a}"`);
      const list = a.next ?? a.notNext;
      if (!Array.isArray(list) || !list.length) err(`${at}.adjacency[${i}]`, "wanted next or notNext: [room kinds]");
      else for (const k of list) if (!known(k, prog)) err(`${at}.adjacency[${i}]`, `no such room kind "${k}"`);
    }
    for (const [i, w] of (prog.waive ?? []).entries())
      for (const k of w.kinds ?? []) if (!prog.required?.[k]) err(`${at}.waive[${i}]`, `waives "${k}", which the program does not require`); // prettier-ignore
    // the generator's rules a program carries, each with its reason: an entrance above the rank, flats over a business, cells a storey
    const allowedHere = new Set([...Object.keys(prog.required ?? {}), ...(prog.optional ?? []), ...(prog.oneOf ?? []).flat()]);
    if (prog.entranceRank !== undefined) {
      const er = prog.entranceRank;
      for (const k of er.allowed ?? []) if (!(prog.entrance ?? []).includes(k)) err(`${at}.entranceRank.allowed`, `"${k}" is not one of the program's entrance kinds`); // prettier-ignore
      if (er.when !== undefined && er.when !== "oneRoom") err(`${at}.entranceRank.when`, `wanted "oneRoom" or nothing, got ${JSON.stringify(er.when)}`); // prettier-ignore
      if (typeof er.why !== "string" || !er.why) err(`${at}.entranceRank.why`, "wanted the reason, a sentence");
    }
    if (prog.homesOver !== undefined) {
      for (const k of prog.homesOver.kinds ?? []) if (!allowedHere.has(k)) err(`${at}.homesOver.kinds`, `"${k}" is not in the program (required, optional or oneOf)`); // prettier-ignore
      if (prog.homesOver.entry !== undefined && !allowedHere.has(prog.homesOver.entry)) err(`${at}.homesOver.entry`, `"${prog.homesOver.entry}" is not in the program`); // prettier-ignore
      if (typeof prog.homesOver.why !== "string" || !prog.homesOver.why) err(`${at}.homesOver.why`, "wanted the reason, a sentence");
    }
    if (prog.cellsPerStorey !== undefined) {
      if (!(Number.isInteger(prog.cellsPerStorey.max) && prog.cellsPerStorey.max >= 1)) err(`${at}.cellsPerStorey.max`, "wanted a whole number >= 1");
      for (const k of prog.cellsPerStorey.kinds ?? []) if (!kinds[k]) err(`${at}.cellsPerStorey.kinds`, `no such room kind "${k}"`);
      if (typeof prog.cellsPerStorey.why !== "string" || !prog.cellsPerStorey.why) err(`${at}.cellsPerStorey.why`, "wanted the reason, a sentence");
    }
  }
  for (const [n, list] of Object.entries(rules.homes?.byRooms ?? {})) {
    if (list.length !== Number(n)) err(`homes.byRooms.${n}`, `wanted ${n} kinds, got ${list.length}`);
    for (const k of list) if (!kinds[k]) err(`homes.byRooms.${n}`, `no such room kind "${k}"`);
  }
  for (const [need, list] of Object.entries(rules.roomNeeds ?? {}))
    if (Array.isArray(list) && need !== "source") for (const k of list) if (!kinds[k]) err(`roomNeeds.${need}`, `no such room kind "${k}"`); // prettier-ignore

  // circulation, keep-clear, placement
  const c = rules.circulation;
  for (const [i, pair] of (c.privateThroughAllowed ?? []).entries())
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((k) => kinds[k])) err(`circulation.privateThroughAllowed[${i}]`, "wanted [through kind, room kind], both room kinds"); // prettier-ignore
  if (!isNum(c.corridor?.maxRun)) err("circulation.corridor.maxRun", "wanted metres");
  if (!isNum(c.deadEnd?.maxLength)) err("circulation.deadEnd.maxLength", "wanted metres");
  if (!(Number.isInteger(c.stairs?.minPerStorey) && c.stairs.minPerStorey >= 1)) err("circulation.stairs.minPerStorey", "wanted a whole number >= 1"); // prettier-ignore
  if (!isNum(c.stairs?.maxAreaOnOneStair)) err("circulation.stairs.maxAreaOnOneStair", "wanted square metres");
  for (const [i, pair] of (c.privateThroughNotGenerated ?? []).entries())
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((k) => kinds[k])) err(`circulation.privateThroughNotGenerated[${i}]`, "wanted [through kind, room kind], both room kinds"); // prettier-ignore
  if (c.noPassThrough !== undefined) {
    if (!Array.isArray(c.noPassThrough.kinds)) err("circulation.noPassThrough.kinds", "wanted [room kinds]");
    else for (const k of c.noPassThrough.kinds) if (!kinds[k]) err("circulation.noPassThrough.kinds", `no such room kind "${k}"`);
  }
  if (c.stairs?.loggia !== undefined) {
    const lg = c.stairs.loggia;
    if (!(isNum(lg.roomsAtLeast) && lg.roomsAtLeast >= 1)) err("circulation.stairs.loggia.roomsAtLeast", "wanted a factor of the typical area, 1 or more");
    if (!(isNum(lg.keepUnder) && lg.keepUnder > 0 && lg.keepUnder <= 1)) err("circulation.stairs.loggia.keepUnder", "wanted a share of maxAreaOnOneStair in (0, 1]");
    if (lg.maxUnbuiltShare !== undefined && !(isNum(lg.maxUnbuiltShare) && lg.maxUnbuiltShare >= 0 && lg.maxUnbuiltShare <= 1)) err("circulation.stairs.loggia.maxUnbuiltShare", "wanted a share of the building's floor in [0, 1]"); // prettier-ignore
  }
  const kc = rules.keepClear;
  for (const k of ["door", "opening", "stair", "light", "switch", "sign", "window", "lift", "spawn"])
    if (!isObject(kc[k])) err(`keepClear.${k}`, "missing: wanted its volume");
  if (isObject(kc.door) && !(isNum(kc.door.minDepth) && kc.door.minDepth >= hull.width)) err("keepClear.door.minDepth", `wanted at least the hull's depth (${round(hull.width)} m)`); // prettier-ignore
  const p = rules.placement;
  if (!(isNum(p.minWalkWidth) && p.minWalkWidth >= passW)) err("placement.minWalkWidth", `wanted at least the hull's ${round(passW)} m`); // prettier-ignore
  for (const k of CLUTTER) {
    const v = p.maxCoveredShare?.[k];
    if (!(isNum(v) && v >= 0 && v <= 1)) err(`placement.maxCoveredShare.${k}`, `wanted a share in [0, 1], got ${JSON.stringify(v)}`); // prettier-ignore
  }
  // the room dressing's allowance by kind and the props each kind must keep (stage 8): each with its source and note,
  // every room kind named one, an allowance a whole number of brushes, no kind both kept full and trimmed
  const strs = (v) => Array.isArray(v) && v.every((s) => typeof s === "string" && s);
  for (const key of ["dressing", "requiredProps"]) {
    const e = p[key];
    if (e === undefined) continue;
    if (!isObject(e)) { err(`placement.${key}`, "wanted an object"); continue; } // prettier-ignore
    if (!(Array.isArray(e.source) && e.source.length)) err(`placement.${key}.source`, "wanted where it comes from (a list of sources)");
    if (!(typeof e.note === "string" && e.note)) err(`placement.${key}.note`, "wanted its reason, a sentence");
  }
  if (isObject(p.dressing)) {
    const d = p.dressing;
    if (!isObject(d.maxBrushesBy)) err("placement.dressing.maxBrushesBy", "wanted { room kind: brushes }");
    for (const [k, v] of Object.entries(d.maxBrushesBy ?? {})) {
      if (!kinds[k]) err(`placement.dressing.maxBrushesBy.${k}`, `no such room kind "${k}"`);
      if (!(Number.isInteger(v) && v >= 0)) err(`placement.dressing.maxBrushesBy.${k}`, `wanted a whole number of brushes >= 0, got ${JSON.stringify(v)}`); // prettier-ignore
    }
    if (!strs(d.full)) err("placement.dressing.full", "wanted [room kinds] whose dressing is never trimmed");
    for (const k of strs(d.full) ? d.full : []) {
      if (!kinds[k]) err("placement.dressing.full", `no such room kind "${k}"`);
      if (d.maxBrushesBy?.[k] !== undefined) err("placement.dressing.full", `"${k}" is kept full and given an allowance (maxBrushesBy) both`);
    }
    if (!(isObject(d.trimFirst) && strs(d.trimFirst.scatter) && strs(d.trimFirst.decor))) err("placement.dressing.trimFirst", "wanted { scatter: [prop kinds], decor: [prop kinds] }"); // prettier-ignore
  }
  if (isObject(p.requiredProps)) {
    const by = p.requiredProps.byKind;
    if (!isObject(by)) err("placement.requiredProps.byKind", "wanted { room kind: [[prop kinds], ...] }");
    for (const [k, groups] of Object.entries(by ?? {})) {
      if (!kinds[k]) err(`placement.requiredProps.byKind.${k}`, `no such room kind "${k}"`);
      if (!(Array.isArray(groups) && groups.length && groups.every(strs) && groups.every((g) => g.length))) err(`placement.requiredProps.byKind.${k}`, "wanted a list of props, each a non-empty list of the prop kinds that will do"); // prettier-ignore
    }
  }
  // the forms (stage 9): every entry with its source and its note; the budgets whole; the wealth modes known
  const fm = rules.forms;
  if (fm !== undefined) {
    if (!isObject(fm)) err("forms", "wanted an object");
    else {
      for (const [k, v] of Object.entries(fm)) {
        if (!isObject(v) || k === "maxBrushesBy") continue;
        if (!(Array.isArray(v.source) && v.source.length)) err(`forms.${k}.source`, "wanted where its numbers come from (a list of sources)");
        if (!(typeof v.note === "string" && v.note)) err(`forms.${k}.note`, "wanted its reason, a sentence");
      }
      for (const [k, n] of Object.entries(fm.maxBrushesBy ?? {})) if (!(Number.isInteger(n) && n >= 1)) err(`forms.maxBrushesBy.${k}`, `wanted a whole number of brushes >= 1, got ${JSON.stringify(n)}`); // prettier-ignore
      if (!(Array.isArray(fm.source) && fm.source.length)) err("forms.source", "wanted where the budgets come from");
      if (fm.reserveShare !== undefined && !(isNum(fm.reserveShare) && fm.reserveShare >= 0 && fm.reserveShare < 1 && typeof fm.reserveNote === "string" && fm.reserveNote)) err("forms.reserveShare", "wanted a share in [0, 1) with its reserveNote");
      if (fm.maxRockShare !== undefined && !(isNum(fm.maxRockShare) && fm.maxRockShare >= 0 && fm.maxRockShare <= 1)) err("forms.maxRockShare", "wanted a share in [0, 1]");
      for (const k of ["pier", "girder", "truss"]) if (fm[k] && !(isNum(fm[k].minDepthPerSpan ?? fm[k].maxSlenderness) && (fm[k].minDepthPerSpan ?? fm[k].maxSlenderness) > 0)) err(`forms.${k}`, "wanted its ratio (minDepthPerSpan or maxSlenderness) > 0"); // prettier-ignore
      const fu = fm.fusion;
      if (fu) {
        for (const w of ["slum", "low", "mid", "high", "elite"]) if (!FUSION_MODES.includes(fu.modeByWealth?.[w])) err(`forms.fusion.modeByWealth.${w}`, `wanted one of ${FUSION_MODES.join(", ")}`); // prettier-ignore
        if (!(Array.isArray(fu.cagesPerFace) && Array.isArray(fu.cageDensities) && fu.cagesPerFace.length === fu.cageDensities.length && fu.cagesPerFace.every((n) => Number.isInteger(n) && n >= 0))) err("forms.fusion.cagesPerFace", "wanted a whole number of cages for each of cageDensities"); // prettier-ignore
      }
      for (const g of fm.oculus?.guards ?? []) if (!OCULUS_GUARDS.includes(g)) err("forms.oculus.guards", `no such guard "${g}" (${OCULUS_GUARDS.join(", ")})`);
      // the edges family's: a share, ground one step under every hull's, the canal's arches whole, counts whole
      if (fm.edges && !(isNum(fm.edges.maxShareOfHeadroom) && fm.edges.maxShareOfHeadroom > 0 && fm.edges.maxShareOfHeadroom <= 1)) err("forms.edges.maxShareOfHeadroom", "wanted a share in (0, 1]"); // prettier-ignore
      const stepMax = fm.ground?.step?.max;
      if (stepMax !== undefined) for (const [name, e] of Object.entries(rules.hull.engines ?? {})) if (isNum(e.step) && isNum(e.unitM) && !(isNum(stepMax) && stepMax <= e.step * e.unitM + 1e-9)) err("forms.ground.step.max", `${stepMax} m is past ${name}'s step (${round(e.step * e.unitM)} m): a dais higher than a step needs a flight`); // prettier-ignore
      if (fm.vault?.canalArch && !(Number.isInteger(fm.vault.canalArch.segments) && fm.vault.canalArch.segments >= 3)) err("forms.vault.canalArch.segments", "wanted a whole number of segments >= 3 (notes-megastructure.md: a segmental arch takes 3-4)"); // prettier-ignore
      for (const [k, v] of [["arcade.maxPerTile", fm.arcade?.maxPerTile], ["gantry.maxPerTile", fm.gantry?.maxPerTile], ["ground.maxPerTile", fm.ground?.maxPerTile], ["scaleIllusion.fan.maxPerTile", fm.scaleIllusion?.fan?.maxPerTile], ["scaleIllusion.fan.blades", fm.scaleIllusion?.fan?.blades], ["scaleIllusion.sounds.maxPerCity", fm.scaleIllusion?.sounds?.maxPerCity]]) if (v !== undefined && !(Number.isInteger(v) && v >= 0)) err(`forms.${k}`, `wanted a whole number >= 0, got ${JSON.stringify(v)}`); // prettier-ignore
      if (fm.backdrop && !(isNum(fm.backdrop.farClipMargin) && fm.backdrop.farClipMargin >= 0)) err("forms.backdrop.farClipMargin", "wanted a share >= 0 (V4)");
      // the facade family's: its themes' words known, a theme for every wealth, a node's corners enough to differ
      const ft = fm.facadeThemes;
      if (ft) {
        for (const w of WEALTHS) {
          const t = ft[w];
          if (!isObject(t)) { err(`forms.facadeThemes.${w}`, "missing: wanted the wealth's patterns, rooflines and corners"); continue; } // prettier-ignore
          for (const p of t.patterns ?? []) if (!FACADE_PATTERNS.includes(p)) err(`forms.facadeThemes.${w}.patterns`, `no such pattern "${p}" (${FACADE_PATTERNS.join(", ")})`); // prettier-ignore
          if (!(Array.isArray(t.patterns) && t.patterns.length)) err(`forms.facadeThemes.${w}.patterns`, "wanted one pattern or more");
          for (const c of ROOF_CEILINGS) for (const r of t.roofline?.[c] ?? []) if (!ROOF_FORMS.includes(r)) err(`forms.facadeThemes.${w}.roofline.${c}`, `no such roofline "${r}" (${ROOF_FORMS.join(", ")})`); // prettier-ignore
          for (const c of t.corners ?? []) if (!CORNER_TREATMENTS.includes(c)) err(`forms.facadeThemes.${w}.corners`, `no such corner piece "${c}" (${CORNER_TREATMENTS.join(", ")})`); // prettier-ignore
          if (!(Array.isArray(t.corners) && new Set(t.corners).size >= 4)) err(`forms.facadeThemes.${w}.corners`, "wanted 4 different corner pieces or more (a junction's four corners differ, M10)"); // prettier-ignore
        }
      }
      for (const k of ["wallServices", "gallery"]) for (const w of fm[k]?.wealth ?? []) if (!WEALTHS.includes(w)) err(`forms.${k}.wealth`, `no such wealth "${w}" (${WEALTHS.join(", ")})`); // prettier-ignore
      for (const k of fm.dome?.over ?? []) if (!rules.roomKinds?.[k]) err("forms.dome.over", `no such room kind "${k}"`);
      if (fm.dome && !(isNum(fm.dome.rise) && fm.dome.rise > 0 && fm.dome.rise <= 1)) err("forms.dome.rise", "wanted the shell's rise over its radius, in (0, 1]");
      const ms = fm.massing;
      if (ms && !(Number.isInteger(ms.minDiffer) && ms.minDiffer >= 1 && ms.minDiffer <= 5)) err("forms.massing.minDiffer", "wanted how many of the 5 traits two neighbours differ in, 1 to 5");
      if (ms && !(isNum(ms.maxRepeatShare) && ms.maxRepeatShare > 0 && ms.maxRepeatShare <= 1)) err("forms.massing.maxRepeatShare", "wanted a share in (0, 1]");
      const sk = fm.skyline;
      if (sk && !(Number.isInteger(sk.minHeights) && sk.minHeights >= 1 && Number.isInteger(sk.maxRun) && sk.maxRun >= 1)) err("forms.skyline", "wanted minHeights and maxRun whole numbers >= 1"); // prettier-ignore
      if (fm.setback && !(Number.isInteger(fm.setback.maxTiers) && fm.setback.maxTiers >= 1)) err("forms.setback.maxTiers", "wanted a whole number of tiers >= 1");
      if (fm.landmark && !(Number.isInteger(fm.landmark.minStoreysOver) && fm.landmark.minStoreysOver >= 1)) err("forms.landmark.minStoreysOver", "wanted a whole number of storeys >= 1"); // prettier-ignore
    }
  }
  return { errors, warnings };
}

// ── engine units ──

const convert = (node, k, f, a) => {
  if (Array.isArray(node)) return node.map((v) => convert(v, k, f, a));
  if (isObject(node)) {
    const out = {};
    for (const [key, v] of Object.entries(node)) {
      if (key === "maxCoveredShare" || key === "source" || key === "mountHeightNote" || key === "maxBrushesBy") out[key] = clone(v);
      else out[key] = convert(v, key, f, a);
    }
    return out;
  }
  if (!isNum(node) || PLAIN.has(k)) return node;
  return AREA.has(k) ? round(node * a) : round(node * f);
};

/**
 * The rulebook in an engine's units: every length divided by the engine's metres a unit, every area by its square,
 * grades, counts and shares left alone. Adds `engine`, `units.length` (the engine's unit name) and `hullNow` (the
 * engine's hull, in its units). Throws for an engine the rulebook has no hull for.
 */
export function rulesFor(engine, rules = loadRules()) {
  const e = rules.hull?.engines?.[engine];
  if (!e) throw new Error(`rulesFor: no hull for engine "${engine}" in the rulebook (${Object.keys(rules.hull?.engines ?? {}).join(", ")})`); // prettier-ignore
  const f = 1 / e.unitM;
  const out = clone(rules);
  for (const k of LENGTH_SECTIONS) out[k] = convert(rules[k], k, f, f * f);
  out.hull.minClearance = round(rules.hull.minClearance * f);
  out.hull.minHeadClearance = round(rules.hull.minHeadClearance * f);
  out.engine = engine;
  out.units = { ...rules.units, length: "units", area: "square units", metresPerUnit: e.unitM };
  out.hullNow = { width: e.width, height: e.height, crouch: e.crouch, step: e.step, useReach: e.useReach ?? null };
  return out;
}

// ── tightening ──

const directionOf = (key, inherited) => {
  if (key === "min" || /^min[A-Z]/.test(key)) return "up";
  if (key === "max" || /^max[A-Z]/.test(key)) return "down";
  if (key === "typical" || /^typical[A-Z]/.test(key)) return "free";
  return inherited;
};

/**
 * Lays a description's own rules over the rulebook, allowing only tightening: a min raised, a max lowered, a
 * typical moved within its range, a rule or a room kind added, an allowance list shortened, a demand list
 * lengthened, false turned true. Anything that loosens is refused with a sentence naming the field. Returns
 * { rules, errors }; `rules` is the merge with the loosening parts left as they were, and is validated again.
 */
export function tighten(base, over) {
  const errors = [];
  const merge = (b, o, path, dir) => {
    const key = path.split(".").pop();
    if (o === undefined) return clone(b);
    if (b === undefined && SUBSET.has(key) && Array.isArray(o) && o.length) {
      errors.push(`${path}: may only shorten (it lists allowances) and the rulebook has none; ${JSON.stringify(o)} would loosen it`);
      return undefined;
    }
    if (b === undefined) return clone(o);
    if (isObject(b) && isObject(o)) {
      const out = clone(b);
      for (const [k, v] of Object.entries(o)) {
        const field = path ? `${path}.${k}` : k;
        if (TEXT.has(k)) out[k] = clone(v);
        else {
          const m = merge(b[k], v, field, k === "required" ? "up" : directionOf(k, dir));
          if (m === undefined) delete out[k];
          else out[k] = m;
        }
      }
      return out;
    }
    if (Array.isArray(b) && Array.isArray(o)) {
      const has = (list, x) => list.some((y) => JSON.stringify(y) === JSON.stringify(x));
      if (SUBSET.has(key)) {
        const extra = o.filter((x) => !has(b, x));
        if (extra.length) { errors.push(`${path}: may only shorten (it lists allowances); ${JSON.stringify(extra)} would loosen it`); return clone(b); } // prettier-ignore
        return clone(o);
      }
      if (SUPERSET.has(key)) {
        const lost = b.filter((x) => !has(o, x));
        if (lost.length) { errors.push(`${path}: may only lengthen (it lists demands); dropping ${JSON.stringify(lost)} would loosen it`); return clone(b); } // prettier-ignore
        return clone(o);
      }
      if (JSON.stringify(b) !== JSON.stringify(o)) errors.push(`${path}: fixed by the rulebook, wanted ${JSON.stringify(b)}`);
      return clone(b);
    }
    if (isNum(b) && isNum(o)) {
      const d = dir;
      if (d === "free") return o;
      if (d === "up" && o < b) { errors.push(`${path}: ${o} would loosen the rulebook's ${b}; a description may only raise it`); return b; } // prettier-ignore
      if (d === "down" && o > b) { errors.push(`${path}: ${o} would loosen the rulebook's ${b}; a description may only lower it`); return b; } // prettier-ignore
      if (d === undefined && o !== b) { errors.push(`${path}: fixed by the rulebook at ${b}, got ${o}`); return b; }
      return o;
    }
    if (typeof b === "boolean" && typeof o === "boolean") {
      if (b && !o) { errors.push(`${path}: true in the rulebook; a description may not turn it off`); return b; }
      return o;
    }
    if (b !== o) errors.push(`${path}: fixed by the rulebook at ${JSON.stringify(b)}, got ${JSON.stringify(o)}`);
    return clone(b);
  };
  const rules = merge(base, over ?? {}, "", undefined);
  if (over?.format !== undefined && over.format !== base.format) errors.push(`format: fixed at "${base.format}"`);
  const v = validateRules(rules);
  for (const e of v.errors) errors.push(`after the merge: ${e}`);
  return { rules, errors };
}

// ── checks: doors, stairs, ceilings ──

/** A door `{ id, kind, width, height }` (clear opening, rules' units) against its kind's minima and the hull. */
export function doorFits(door, rules) {
  const failures = [];
  const name = `door ${door.id ?? "?"} (${door.kind})`;
  const r = rules.dimensions.doors[door.kind];
  if (!r) return result([`${name}: no door kind "${door.kind}" in the rulebook (${Object.keys(rules.dimensions.doors).join(", ")})`]); // prettier-ignore
  if (!(isNum(door.width) && door.width >= r.width.min)) failures.push(`${name}: clear width ${say(door.width, rules)}, wanted ${say(r.width.min, rules)} or more`); // prettier-ignore
  if (!(isNum(door.height) && door.height >= r.height.min)) failures.push(`${name}: clear height ${say(door.height, rules)}, wanted ${say(r.height.min, rules)} or more`); // prettier-ignore
  if (isNum(r.width.max) && door.width > r.width.max) failures.push(`${name}: clear width ${say(door.width, rules)}, wanted ${say(r.width.max, rules)} or less`); // prettier-ignore
  return result(failures);
}

/**
 * A stair `{ id, kind (domestic|public|service|grand), rise, run, width, headroom?, risers?, landing? }`: rise and
 * run of one step, its width, the headroom over its pitch line, the risers of its longest flight, the depth of its
 * landings. Held to the rise and run ranges, the pitch, the hull's step, the width of its kind, the headroom, the
 * risers and rise of a flight, and the landing depth (at least its width).
 */
export function stairFits(stair, rules) {
  const failures = [];
  const s = rules.dimensions.stairs;
  const name = `stair ${stair.id ?? "?"} (${stair.kind})`;
  const w = s.width[stair.kind];
  if (!w) return result([`${name}: no stair kind "${stair.kind}" in the rulebook (${Object.keys(s.width).join(", ")})`]);
  const { rise, run } = stair;
  if (!(isNum(rise) && rise <= s.rise.max)) failures.push(`${name}: rise ${say(rise, rules)}, wanted ${say(s.rise.max, rules)} or less`); // prettier-ignore
  if (isNum(rise) && rise < s.rise.min) failures.push(`${name}: rise ${say(rise, rules)}, wanted ${say(s.rise.min, rules)} or more`); // prettier-ignore
  const step = hullOf(rules).step;
  if (isNum(rise) && rise > step) failures.push(`${name}: rise ${say(rise, rules)} is over the hull's step, wanted ${say(step, rules)} or less`); // prettier-ignore
  if (!(isNum(run) && run >= s.run.min)) failures.push(`${name}: run ${say(run, rules)}, wanted ${say(s.run.min, rules)} or more`); // prettier-ignore
  if (isNum(rise) && isNum(run) && run > 0 && rise / run > s.maxPitch) failures.push(`${name}: pitch ${round(rise / run)} (rise over run), wanted ${s.maxPitch} or less`); // prettier-ignore
  if (!(isNum(stair.width) && stair.width >= w.min)) failures.push(`${name}: width ${say(stair.width, rules)}, wanted ${say(w.min, rules)} or more`); // prettier-ignore
  if (stair.headroom !== undefined && !(stair.headroom >= s.headroom.min)) failures.push(`${name}: headroom ${say(stair.headroom, rules)}, wanted ${say(s.headroom.min, rules)} or more`); // prettier-ignore
  if (stair.risers !== undefined) {
    if (stair.risers > s.maxRisersPerFlight) failures.push(`${name}: ${stair.risers} risers in a flight, wanted ${s.maxRisersPerFlight} or fewer`); // prettier-ignore
    if (isNum(rise) && stair.risers * rise > s.maxFlightRise + 1e-9) failures.push(`${name}: a flight rises ${say(stair.risers * rise, rules)}, wanted ${say(s.maxFlightRise, rules)} or less before a landing`); // prettier-ignore
  }
  if (stair.landing !== undefined) {
    const want = Math.max(s.landing.minDepth, stair.width ?? 0);
    if (!(stair.landing >= want)) failures.push(`${name}: landing ${say(stair.landing, rules)} deep, wanted ${say(want, rules)} or more (at least the stair's width)`); // prettier-ignore
  }
  return result(failures);
}

/** A room or space `{ id, kind, height }` (clear floor to ceiling) against its kind's ceiling minimum. */
export function ceilingFits(room, rules) {
  const kind = rules.roomKinds[room.kind] ?? rules.spaceKinds[room.kind];
  const name = `room ${room.id ?? "?"} (${room.kind})`;
  if (!kind) return result([`${name}: no room or space kind "${room.kind}" in the rulebook`]);
  const c = rules.dimensions.ceilings[kind.ceiling];
  if (!(isNum(room.height) && room.height >= c.min)) return result([`${name}: ceiling ${say(room.height, rules)}, wanted ${say(c.min, rules)} or more (a ${kind.ceiling} ceiling)`]); // prettier-ignore
  return result([]);
}

// ── keep-clear volumes ──

/** A box from extents in a local frame: along the wall (u), out from it (n, the facing), up (z). */
const frameBox = (what, at, facing, [u0, u1], [n0, n1], [z0, z1]) => {
  const [fx, fy] = facing;
  const ux = -fy;
  const uy = fx;
  const xs = [u0 * ux + n0 * fx, u1 * ux + n0 * fx, u0 * ux + n1 * fx, u1 * ux + n1 * fx].map((v) => v + at[0]);
  const ys = [u0 * uy + n0 * fy, u1 * uy + n0 * fy, u0 * uy + n1 * fy, u1 * uy + n1 * fy].map((v) => v + at[1]);
  return {
    what,
    min: [Math.min(...xs), Math.min(...ys), at[2] + z0].map(round),
    max: [Math.max(...xs), Math.max(...ys), at[2] + z1].map(round),
  };
};
const goodFacing = (f) => Array.isArray(f) && f.length >= 2 && Math.abs(f[0]) + Math.abs(f[1]) === 1 && f[0] * f[1] === 0;

/**
 * The boxes no prop, fitting or brush may enter, for one item (rules' units):
 * - door / opening `{ kind, id, at (centre of the hole at its floor), facing, width, height, wall?, swing?: "front" | "back" | "none" }`:
 *   the hole, an approach each side (its width plus a margin a side, the rule's depth, its height plus a margin),
 *   and for a door the leaf's swing (a square of its width) on the swing side (front by default);
 * - window `{ at (centre of the hole at the floor), facing, width, sill, head, wall? }`: the hole and the strip in front, sill to head;
 * - stair `{ at (centre of the first riser's foot), facing (the way up), width, run (whole), rise (whole), landings?: [{ at, size: [w, d] }] }`:
 *   the flight with the headroom over it, an approach at the foot and the head, each landing with its headroom;
 * - light `{ at (centre), size: [x, y, z] }`: round it by a margin and below it;
 * - switch, sign `{ at (centre of the face), facing, size: [w, h], floor? }`: in front of it (a switch from the floor, a sign at its own height);
 * - lift `{ at (centre of the car floor), facing (its door side), car: [w, d, h] }`: the car and the landing before its door;
 * - spawn `{ at (the feet) }`: the hull and a margin.
 */
export function keepClearOf(item, rules) {
  const kc = rules.keepClear;
  const name = `${item.kind} ${item.id ?? "?"}`;
  const at = item.at ?? [0, 0, 0];
  if (at.length !== 3 || !at.every(isNum)) throw new Error(`keepClearOf: ${name}.at: wanted [x, y, z]`);
  const needFacing = ["door", "opening", "window", "stair", "switch", "sign", "lift"].includes(item.kind);
  if (needFacing && !goodFacing(item.facing)) throw new Error(`keepClearOf: ${name}.facing: wanted an axis on the floor, [1, 0], [-1, 0], [0, 1] or [0, -1]`); // prettier-ignore
  const f = item.facing;
  const wallT = item.wall ?? rules.dimensions.walls.interior.thickness.typical;
  const t = wallT / 2;
  if (item.kind === "door" || item.kind === "opening") {
    const r = kc[item.kind];
    const half = item.width / 2;
    const side = half + r.minSideMargin;
    const top = item.height + r.minHeadMargin;
    const boxes = [
      frameBox(`${name}'s opening`, at, f, [-half, half], [-t, t], [0, item.height]),
      frameBox(`${name}'s approach (front)`, at, f, [-side, side], [t, t + r.minDepth], [0, top]),
      frameBox(`${name}'s approach (back)`, at, f, [-side, side], [-t - r.minDepth, -t], [0, top]),
    ];
    const swing = item.swing ?? (item.kind === "door" ? "front" : "none");
    if (item.kind === "door" && swing !== "none") {
      const n = swing === "back" ? [-t - item.width, -t] : [t, t + item.width];
      boxes.push(frameBox(`${name}'s swing (${swing})`, at, f, [-half, half], n, [0, item.height]));
    }
    return boxes;
  }
  if (item.kind === "window") {
    const half = item.width / 2;
    return [
      frameBox(`${name}'s opening`, at, f, [-half, half], [-t, t], [item.sill, item.head]),
      frameBox(`${name}'s front`, at, f, [-half, half], [t, t + kc.window.minDepth], [item.sill, item.head]),
    ];
  }
  if (item.kind === "stair") {
    const head = rules.dimensions.stairs.headroom.min;
    const half = item.width / 2;
    const approach = Math.max(kc.stair.minApproach, item.width);
    const boxes = [
      frameBox(`${name}'s flight and headroom`, at, f, [-half, half], [0, item.run], [0, item.rise + head]),
      frameBox(`${name}'s approach (foot)`, at, f, [-half, half], [-approach, 0], [0, head]),
      frameBox(`${name}'s approach (head)`, at, f, [-half, half], [item.run, item.run + approach], [item.rise, item.rise + head]), // prettier-ignore
    ];
    for (const [i, l] of (item.landings ?? []).entries()) {
      const [w, d] = l.size;
      boxes.push({ what: `${name}'s landing ${i + 1} and headroom`, min: [l.at[0] - w / 2, l.at[1] - d / 2, l.at[2]].map(round), max: [l.at[0] + w / 2, l.at[1] + d / 2, l.at[2] + head].map(round) }); // prettier-ignore
    }
    return boxes;
  }
  if (item.kind === "light") {
    const m = kc.light.minMargin;
    const [sx, sy, sz] = item.size ?? [0, 0, 0];
    return [{ what: `${name}'s fitting and below it`, min: [at[0] - sx / 2 - m, at[1] - sy / 2 - m, at[2] - sz / 2 - m - kc.light.minBelow].map(round), max: [at[0] + sx / 2 + m, at[1] + sy / 2 + m, at[2] + sz / 2 + m].map(round) }]; // prettier-ignore
  }
  if (item.kind === "switch") {
    const r = kc.switch;
    const [w, h] = item.size ?? [0, 0];
    const floor = item.floor ?? at[2] - r.mountHeight.typical;
    const z0 = floor - at[2];
    return [frameBox(`${name}'s use space`, at, f, [-w / 2 - r.minSideMargin, w / 2 + r.minSideMargin], [0, r.minDepth], [z0, h / 2 + r.minSideMargin])]; // prettier-ignore
  }
  if (item.kind === "sign") {
    const r = kc.sign;
    const [w, h] = item.size ?? [0, 0];
    return [frameBox(`${name}'s reading space`, at, f, [-w / 2 - r.minSideMargin, w / 2 + r.minSideMargin], [0, r.minReadDistance], [-h / 2, h / 2])]; // prettier-ignore
  }
  if (item.kind === "lift") {
    const r = kc.lift;
    const [w, d, h] = item.car;
    return [
      frameBox(`${name}'s car`, at, f, [-w / 2, w / 2], [-d / 2, d / 2], [0, h]),
      frameBox(`${name}'s landing`, at, f, [-w / 2 - r.minSideMargin, w / 2 + r.minSideMargin], [d / 2, d / 2 + r.minLandingDepth], [0, h]), // prettier-ignore
    ];
  }
  if (item.kind === "spawn") {
    const r = kc.spawn;
    const hull = hullOf(rules);
    const half = hull.width / 2 + r.minMargin;
    return [{ what: `${name}'s hull and margin`, min: [at[0] - half, at[1] - half, at[2]].map(round), max: [at[0] + half, at[1] + half, at[2] + hull.height + r.minHeadMargin].map(round) }]; // prettier-ignore
  }
  throw new Error(`keepClearOf: ${name}: no keep-clear rule for a "${item.kind}" (door, opening, window, stair, light, switch, sign, lift, spawn)`); // prettier-ignore
}

/** A prop's box: its own `box`, or `at` (the centre of its foot) and `size`. */
export const propBox = (prop) =>
  prop.box ?? {
    min: [prop.at[0] - prop.size[0] / 2, prop.at[1] - prop.size[1] / 2, prop.at[2]],
    max: [prop.at[0] + prop.size[0] / 2, prop.at[1] + prop.size[1] / 2, prop.at[2] + prop.size[2]],
  };

/** How far two boxes overlap: the smallest overlap over the three axes (0 or less: apart or touching). */
export const overlapDepth = (a, b) => Math.min(...[0, 1, 2].map((i) => Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]))); // prettier-ignore

/** A prop `{ id, box | at + size }` against every keep-clear box of `items`; touching is allowed. */
export function overlapsKeepClear(prop, items, rules) {
  const failures = [];
  const p = propBox(prop);
  const eps = unitOf(rules) === "m" ? 1e-6 : 1e-3;
  for (const item of items)
    for (const box of keepClearOf(item, rules)) {
      const d = overlapDepth(p, box);
      if (d > eps) failures.push(`prop ${prop.id ?? "?"} enters ${box.what} by ${say(d, rules)}, wanted 0 ${unitOf(rules)} (clear of it)`); // prettier-ignore
    }
  return result(failures);
}

// ── room programs ──

const countsOf = (rooms) => {
  if (Array.isArray(rooms)) {
    const out = {};
    for (const r of rooms) out[r.kind] = (out[r.kind] ?? 0) + (r.count ?? 1);
    return out;
  }
  return { ...(rooms ?? {}) };
};

/**
 * A building's rooms against its type's program. `building`: `{ id, type, units?: { class: count }, footprint?:
 * [w, d], storeys?, homes?: [{ name, area, rooms }] }`; `rooms`: `{ kind: count }` or `[{ id?, kind, w?, d?, area?,
 * count? }]` (rules' units). Holds: the required kinds and counts (less what a waiver lifts), one of each `oneOf`
 * group, no kind outside the program, each sized room's area and narrow side, all the rooms within footprint x
 * storeys, and each home's area at least its rooms' minima. A dungeon (`type: "dungeon"`) uses spaceKinds.
 */
export function roomProgramOk(building, rooms, rules) {
  const failures = [];
  const name = `building ${building.id ?? "?"} (${building.type})`;
  const prog = rules.programs[building.type];
  if (!prog) return result([`${name}: no program for type "${building.type}" in the rulebook (${Object.keys(rules.programs).join(", ")})`]); // prettier-ignore
  const kinds = prog.spaces ? rules.spaceKinds : rules.roomKinds;
  const counts = countsOf(rooms);
  for (const k of Object.keys(counts)) if (!counts[k]) delete counts[k];
  const unitClasses = Object.keys(building.units ?? {}).filter((k) => building.units[k] > 0);
  const waived = new Set();
  for (const w of prog.waive ?? [])
    if (w.when?.unitsOnly && unitClasses.length && unitClasses.every((c) => w.when.unitsOnly.includes(c))) w.kinds.forEach((k) => waived.add(k)); // prettier-ignore
  for (const [k, n] of Object.entries(prog.required ?? {})) {
    if (waived.has(k)) continue;
    if ((counts[k] ?? 0) < n) failures.push(`${name}: ${counts[k] ?? 0} ${k}, wanted ${n} or more`);
  }
  for (const group of prog.oneOf ?? [])
    if (!group.some((k) => counts[k] > 0)) failures.push(`${name}: none of ${group.join(", ")}, wanted 1 or more`);
  const allowed = new Set([...Object.keys(prog.required ?? {}), ...(prog.optional ?? []), ...(prog.oneOf ?? []).flat()]);
  for (const k of Object.keys(counts))
    if (!allowed.has(k)) failures.push(`${name}: a ${k} is not in the program of a ${building.type} (wanted 0; allowed: ${[...allowed].join(", ")})`); // prettier-ignore
  let total = 0;
  if (Array.isArray(rooms))
    for (const r of rooms) {
      const kind = kinds[r.kind];
      const rn = `room ${r.id ?? r.kind} (${r.kind}) of ${name}`;
      if (!kind) { failures.push(`${rn}: no such room kind in the rulebook`); continue; } // prettier-ignore
      const area = r.area ?? (isNum(r.w) && isNum(r.d) ? r.w * r.d : null);
      if (area !== null) total += area * (r.count ?? 1);
      if (area !== null && area < kind.minArea - 1e-9) failures.push(`${rn}: ${round(area)} ${areaUnitOf(rules)}, wanted ${round(kind.minArea)} or more`); // prettier-ignore
      if (isNum(r.w) && isNum(r.d)) {
        const side = Math.min(r.w, r.d);
        if (side < kind.minSide - 1e-9) failures.push(`${rn}: narrow side ${say(side, rules)}, wanted ${say(kind.minSide, rules)} or more`); // prettier-ignore
      }
    }
  for (const h of building.homes ?? []) {
    const need = (h.rooms ?? []).reduce((s, k) => s + (rules.roomKinds[k]?.minArea ?? 0), 0);
    total += h.area * (h.count ?? 1);
    if (h.area < need - 1e-9) failures.push(`home ${h.name ?? "?"} of ${name}: ${round(h.area)} ${areaUnitOf(rules)}, wanted ${round(need)} or more for its rooms (${h.rooms.join(", ")}) at their minima`); // prettier-ignore
  }
  if (Array.isArray(building.footprint) && total > 0) {
    const room = building.footprint[0] * building.footprint[1] * (building.storeys ?? 1);
    if (total > room + 1e-9) failures.push(`${name}: its rooms take ${round(total)} ${areaUnitOf(rules)}, wanted ${round(room)} or less (footprint x storeys)`); // prettier-ignore
  }
  return result(failures);
}

// ── circulation ──

const storeyRange = (s) => (Array.isArray(s) ? s : isNum(s) ? [s, s] : null);

/**
 * A plan's circulation. `graph`: `{ id?, type (a building type or "dungeon"), rooms: [{ id, kind, storey?, street?,
 * exterior?, length?, area?, home?, reward?, key? }], links: [{ from, to, type?, oneWay? }], entrances: [room ids],
 * goal? }` (a drop or a oneWay link goes from -> to only). Holds: every room reached from an entrance; none reached
 * only through a private room unless the pair is allowed; no link between two homes' rooms; the entrance room's
 * zone and kind; the program's adjacency (next / notNext); rooms that need a street, a window or none; corridor
 * runs and dead ends; a dungeon's dead ends rewarded; every pair of storeys on a stair, two past the area rule.
 */
export function circulationOk(graph, rules) {
  const failures = [];
  const type = graph.type;
  const prog = rules.programs[type] ?? {};
  const dungeon = type === "dungeon" || prog.spaces;
  const kindsTable = dungeon ? rules.spaceKinds : rules.roomKinds;
  const byId = new Map(graph.rooms.map((r) => [r.id, r]));
  const label = (r) => `room ${r.id} (${r.kind})`;
  for (const r of graph.rooms) if (!kindsTable[r.kind]) failures.push(`${label(r)}: no such ${dungeon ? "space" : "room"} kind in the rulebook`); // prettier-ignore
  const out = new Map(graph.rooms.map((r) => [r.id, []]));
  const nbrs = new Map(graph.rooms.map((r) => [r.id, new Set()]));
  for (const l of graph.links) {
    if (!byId.has(l.from) || !byId.has(l.to)) { failures.push(`link ${l.from} - ${l.to}: joins a room the plan does not have`); continue; } // prettier-ignore
    out.get(l.from).push(l.to);
    if (!(l.type === "drop" || l.oneWay)) out.get(l.to).push(l.from);
    nbrs.get(l.from).add(l.to);
    nbrs.get(l.to).add(l.from);
  }
  const entrances = (graph.entrances ?? []).filter((id) => byId.has(id));
  if (!entrances.length) return result([...failures, `plan ${graph.id ?? "?"}: no entrance among its rooms, wanted 1 or more`]); // prettier-ignore
  const rank = (r) => rules.zones[rules.roomKinds[r.kind]?.zone]?.rank ?? 0;
  const isPrivate = (r) => !dungeon && rank(r) >= rules.zones.privateFrom;

  // 1. reach, with parents for naming the way
  const parent = new Map(entrances.map((e) => [e, null]));
  const queue = [...entrances];
  while (queue.length) {
    const u = queue.shift();
    for (const v of out.get(u)) if (!parent.has(v)) { parent.set(v, u); queue.push(v); } // prettier-ignore
  }
  for (const r of graph.rooms)
    if (!parent.has(r.id)) failures.push(`${label(r)} is not reached from the entrance (${entrances.join(", ")}), wanted every room reached`); // prettier-ignore

  // 2. not only through a private room, unless the pair is allowed
  if (!dungeon) {
    const allowed = new Set((rules.circulation.privateThroughAllowed ?? []).map(([a, b]) => `${a}>${b}`));
    const seen = new Set(entrances);
    const q = [...entrances];
    // service and secure rooms are ends (circulation.noPassThrough): a room behind one only when hidden there
    const noPass = new Set(rules.circulation.noPassThrough?.kinds ?? []);
    const endOnly = new Set();
    while (q.length) {
      const u = q.shift();
      const ru = byId.get(u);
      for (const v of out.get(u)) {
        if (seen.has(v)) continue;
        if (isPrivate(ru) && !entrances.includes(u) && !allowed.has(`${ru.kind}>${byId.get(v).kind}`)) continue;
        if (noPass.has(ru.kind) && !entrances.includes(u) && !byId.get(v).hidden) {
          endOnly.add(v);
          continue;
        }
        seen.add(v);
        q.push(v);
      }
    }
    for (const r of graph.rooms) {
      if (!parent.has(r.id) || seen.has(r.id)) continue;
      const store = endOnly.has(r.id) ? [...nbrs.get(r.id)].map((id) => byId.get(id)).find((x) => noPass.has(x.kind) && seen.has(x.id)) : null; // prettier-ignore
      if (store) {
        failures.push(`${label(r)} is reached only through ${label(store)}, a room nobody passes through; wanted a way through circulation (circulation.noPassThrough)`); // prettier-ignore
        continue;
      }
      let via = null;
      for (let p = parent.get(r.id); p !== null; p = parent.get(p)) if (isPrivate(byId.get(p))) via = byId.get(p);
      const v = via ? ` ${label(via)}` : " a private room";
      failures.push(`${label(r)} is reached only through${v}; wanted a way through no private room, or the pair [${via?.kind ?? "?"}, ${r.kind}] allowed`); // prettier-ignore
    }
    // homes never open into each other
    for (const l of graph.links) {
      const a = byId.get(l.from);
      const b = byId.get(l.to);
      if (a?.home && b?.home && a.home !== b.home) failures.push(`${label(a)} of home ${a.home} opens into ${label(b)} of home ${b.home}; wanted 0 links between homes (each opens on circulation)`); // prettier-ignore
    }
    // 3. the entrance room
    // a program may let one kind be the entrance above the rank, for a stated reason (a hut's one room)
    const er = prog.entranceRank;
    const minor = new Set(["toilet", "storeroom", "corridor", "stairwell"]);
    const oneRoom = graph.rooms.filter((r) => !minor.has(r.kind) && !r.hidden).length <= 1;
    for (const id of entrances) {
      const r = byId.get(id);
      const excused = er?.allowed?.includes(r.kind) && (er.when !== "oneRoom" || oneRoom);
      if (!excused && rank(r) > rules.circulation.entranceMaxRank) failures.push(`${label(r)} is an entrance of zone rank ${rank(r)}, wanted ${rules.circulation.entranceMaxRank} or less (public rooms at the door, Alexander 127)`); // prettier-ignore
      if (prog.entrance && !prog.entrance.includes(r.kind)) failures.push(`${label(r)} is an entrance of a ${type}, wanted one of ${prog.entrance.join(", ")}`); // prettier-ignore
    }
    // 4. adjacency
    for (const a of prog.adjacency ?? [])
      for (const r of graph.rooms.filter((x) => x.kind === a.a)) {
        const near = [...nbrs.get(r.id)].map((id) => byId.get(id).kind);
        if (a.next && !near.some((k) => a.next.includes(k))) failures.push(`${label(r)} opens on none of ${a.next.join(", ")}, wanted 1 or more (${a.why})`); // prettier-ignore
        if (a.notNext) for (const k of near.filter((k) => a.notNext.includes(k))) failures.push(`${label(r)} opens on a ${k}, wanted 0 (${a.why})`); // prettier-ignore
      }
    // 5. street, window, no window
    const needs = rules.roomNeeds ?? {};
    for (const r of graph.rooms) {
      if ((needs.street ?? []).includes(r.kind) && !entrances.includes(r.id) && r.street !== true) failures.push(`${label(r)} has no door to a street, wanted 1 (a ${r.kind} on the street)`); // prettier-ignore
      if ((needs.window ?? []).includes(r.kind) && r.exterior === false) failures.push(`${label(r)} has no window, wanted 1 or more on an outside wall`); // prettier-ignore
      if ((needs.noWindow ?? []).includes(r.kind) && r.exterior === true) failures.push(`${label(r)} has a window on an outside wall, wanted 0`); // prettier-ignore
    }
  }

  // 6. corridors: runs and dead ends
  const corridorish = (r) => (dungeon ? r.kind === "corridor" : rules.roomKinds[r.kind]?.zone === "circulation" && r.kind !== "stairwell" && r.kind !== "lift-lobby"); // prettier-ignore
  for (const r of graph.rooms.filter(corridorish)) {
    if (isNum(r.length) && r.length > rules.circulation.corridor.maxRun + 1e-9) failures.push(`${label(r)} runs ${say(r.length, rules)}, wanted ${say(rules.circulation.corridor.maxRun, rules)} or less before a room, a turn or a window`); // prettier-ignore
    if (nbrs.get(r.id).size === 1 && !entrances.includes(r.id) && isNum(r.length) && r.length > rules.circulation.deadEnd.maxLength + 1e-9) failures.push(`${label(r)} is a dead end ${say(r.length, rules)} long, wanted ${say(rules.circulation.deadEnd.maxLength, rules)} or less`); // prettier-ignore
  }
  // 7. a dungeon's dead ends hold something
  if (dungeon && rules.circulation.dungeon?.deadEndHoldsReward)
    for (const r of graph.rooms)
      if (nbrs.get(r.id).size === 1 && !entrances.includes(r.id) && r.id !== graph.goal && !r.reward && !r.key) failures.push(`${label(r)} is a dead end holding nothing, wanted a reward, a key or the goal`); // prettier-ignore

  // 8. stairs between storeys (buildings only; a dungeon's stairs are its own spaces and links)
  if (!dungeon) {
    const storeys = new Set();
    for (const r of graph.rooms) {
      const s = storeyRange(r.storey);
      if (s) for (let i = s[0]; i <= s[1]; i++) storeys.add(i);
    }
    const sorted = [...storeys].sort((a, b) => a - b);
    const stairKinds = new Set(["stairwell"]);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const lo = sorted[i];
      const hi = sorted[i + 1];
      let ways = graph.rooms.filter((r) => stairKinds.has(r.kind) && storeyRange(r.storey)?.[0] <= lo && storeyRange(r.storey)?.[1] >= hi).length; // prettier-ignore
      for (const l of graph.links) {
        if (l.type !== "stair") continue;
        const a = storeyRange(byId.get(l.from)?.storey);
        const b = storeyRange(byId.get(l.to)?.storey);
        if (a && b && ((a[0] <= lo && lo <= a[1] && b[0] <= hi && hi <= b[1]) || (b[0] <= lo && lo <= b[1] && a[0] <= hi && hi <= a[1]))) ways++; // prettier-ignore
      }
      const area = graph.rooms.filter((r) => storeyRange(r.storey)?.[0] <= hi && storeyRange(r.storey)?.[1] >= hi && isNum(r.area)).reduce((s, r) => s + r.area, 0); // prettier-ignore
      const want = area > rules.circulation.stairs.maxAreaOnOneStair ? Math.max(2, rules.circulation.stairs.minPerStorey) : rules.circulation.stairs.minPerStorey; // prettier-ignore
      if (ways < want) failures.push(`storeys ${lo} and ${hi} of ${graph.id ?? "the plan"} are joined by ${ways} stair${ways === 1 ? "" : "s"}, wanted ${want} or more${want > 1 ? ` (storey ${hi} has ${round(area)} ${areaUnitOf(rules)}, over ${round(rules.circulation.stairs.maxAreaOnOneStair)} on one stair)` : ""}`); // prettier-ignore
    }
  }
  return result(failures);
}
