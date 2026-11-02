// A style's bands, from the level corpora and the table of what kind of game each level is (PLAN.md, Phase 3:
// "Styles are a kind of game plus a theme"). Pure: give it the corpora as read and the tags as read, get the
// bands back. levels/tools/styles.mjs reads the files and writes levels/styles/<kind>.json and the guide.
//
// THE ONE VOCABULARY. The corpora measure in three ways: GoldSrc's survey (Half-Life, The Specialists, Master
// Sword Rebirth) in Hammer units over the kit's walk; Left 4 Dead 2's in Source units over its nav mesh, width
// and sight twice (the world alone, and every static prop as its box); Vermintide 2's in metres over its
// navmesh, with no solid geometry (no headroom, no sight). Every measure here is named once, in metres (or a
// share, a count, a ratio, a fraction of the route), and also in player heights: 72 units (1.83 m) for
// GoldSrc and Source, 1.8 m for Vermintide 2. MEASURES says how each game's record gives it, which games lack
// it (and why), and which only bracket it (L4D2's width and sight: dressed = every solid static prop as the
// engine collides with it, its collision hulls (`withPropCollision`; the older `withPropBoxes`, props as their
// boxes, only where a corpus lacks it); bare = the world alone, far too wide; the band uses the dressed value
// and shows the bare).
//
// ROLE-PLAY CITIES. The tsrp corpus (The Specialists' role-play cities) carries each map's city measures
// (levels/lib/city-measures.mjs): streets, buildings, layers, variety, light, furniture. Those measures are
// `cityOnly`: banded only in a kind whose maps have them, and no other kind's gap.
//
// THE BANDS. One map one vote, as the corpora's own; and where a kind holds two games, each game's maps
// together weigh as much as the other's (57 L4D2 maps do not outvote 34 of Vermintide 2's; 12 Half-Life
// deathmatch maps count as much as 29 of The Specialists'). A band is n, median, p10 and p90 (weighted
// quantiles, linear between ranks), with each game's own band beside it. Never pooled across kinds. A
// measure the games of a kind take in different ways (`pool: false`) is banded per game only.

/** metres in a Hammer (or Source) unit */
export const UNIT_M = 0.0254;
/** a standing player, metres, by engine: GoldSrc's and Source's 72 units; Vermintide 2's 1.8 m as asked */
export const PLAYER_M = { goldsrc: 72 * UNIT_M, source: 72 * UNIT_M, vt2: 1.8 };
/** square metres in a square unit */
const UNIT_M2 = UNIT_M * UNIT_M;
/** a GoldSrc map whose walk reached less than this share of its floor is left out: the walk began boxed in */
export const MIN_REACHED = 0.1;
/** fewest maps for an exploration setting to get bands of its own */
export const MIN_SETTING_MAPS = 8;
/** the corpora's files, by their short name, and the engine their records are in */
export const CORPORA = { hl: "goldsrc", ts: "goldsrc", msr: "goldsrc", tsrp: "goldsrc", l4d2: "source", vt2: "vt2" };
/** the games' names for a reader */
export const GAME_NAMES = {
  hl: "Half-Life",
  ts: "The Specialists",
  msr: "Master Sword Rebirth",
  tsrp: "The Specialists role-play cities",
  l4d2: "Left 4 Dead 2",
  vt2: "Vermintide 2",
};

const u = (x) => (x == null || !Number.isFinite(x) ? null : x * UNIT_M);
const num = (x) => (x == null || !Number.isFinite(x) ? null : x);
const med = (b) => (b && b.median != null ? b.median : null);
/** a GoldSrc crossing is a route only when it starts at a way out, or in an arena or a city (start to farthest) */
const goldsrcRoute = (m, kind) =>
  kind === "arena" || kind === "rp-city" || (m.crossing && m.crossing.to !== "farthest");
/** L4D2's dressed floor: static props as the engine collides with them, else (an older corpus) as their boxes */
const dressedOf = (m) => m.withPropCollision ?? m.withPropBoxes;
const perKm = (count, metres) => (count == null || !metres ? null : count / (metres / 1000));

/**
 * The measures, each: `key`, `label`, `unit` ("m", "m2", "share", "count", "ratio", "fraction", "per-km"),
 * `group` (for the guide's tables), `from` by engine (a function of the map record and its kind giving a
 * value in the unit, or `{ dressed, bare }` for a bracket, or null), `lacks` by engine (why not), `note`,
 * `pool: false` when the games' takes differ too much to band together, and `routeOnly` for a measure only a
 * game with a director's route takes (a kind without one does not count it among its gaps).
 */
export const MEASURES = [
  {
    key: "width",
    label: "floor width (map's median place)",
    unit: "m",
    group: "width",
    from: {
      goldsrc: (m) => u(med(m.width)),
      source: (m) => ({ dressed: u(med(dressedOf(m)?.width)), bare: u(med(m.width)) }),
      vt2: (m) => num(med(m.width)),
    },
    note: "the narrowest of eight lines through each walked place; VT2's ends at the navmesh's edge (drops, low walls too)",
  },
  {
    key: "corridorWidth",
    label: "corridor width (map's p5 place: its narrowest common floor)",
    unit: "m",
    group: "width",
    from: {
      goldsrc: (m) => u(m.width?.p5),
      source: (m) => ({ dressed: u(dressedOf(m)?.width?.p5), bare: u(m.width?.p5) }),
      vt2: (m) => num(m.width?.p5),
    },
  },
  {
    key: "passageWidth",
    label: "passage width (gaps between walls, median)",
    unit: "m",
    group: "width",
    from: {
      goldsrc: (m) => u(med(m.passages?.width)),
      source: null,
      vt2: (m) => num(med(m.openings?.width)),
    },
    lacks: { source: "no walk-test openings; door openings (doorWidth) stand in" },
    note: "GoldSrc: the walk's openings (a wall each side, room either side); VT2: pinches on the main path",
  },
  {
    key: "mainPathWidth",
    routeOnly: true,
    label: "main path width (median)",
    unit: "m",
    group: "width",
    from: { goldsrc: null, source: null, vt2: (m) => num(med(m.pathWidth)) },
    lacks: { goldsrc: "no main path", source: "the nav route's width is not taken" },
  },
  {
    key: "narrowShare",
    label: "narrow floor share (under 2 player heights)",
    unit: "share",
    group: "width",
    from: {
      goldsrc: (m) => num(m.narrowShare),
      source: (m) => ({ dressed: num(dressedOf(m)?.narrow), bare: num(m.bands?.narrow) }),
      vt2: (m) => num(m.narrowShare),
    },
  },
  {
    key: "openWidth",
    label: "open-space width (map's p95 place: its big rooms and yards)",
    unit: "m",
    group: "space",
    from: {
      goldsrc: (m) => u(m.width?.p95),
      source: (m) => ({ dressed: u(dressedOf(m)?.width?.p95), bare: u(m.width?.p95) }),
      vt2: (m) => num(m.width?.p95),
    },
    note: "no corpus segments rooms; the widest common floor stands in for room size",
  },
  {
    key: "wideShare",
    label: "wide floor share (4 player heights and over)",
    unit: "share",
    group: "space",
    from: { goldsrc: (m) => num(m.wideShare), source: null, vt2: (m) => num(m.wideShare) },
    lacks: { source: "its bands cut at 176 and 352 units, not 288" },
  },
  {
    key: "walkedArea",
    label: "walked floor",
    unit: "m2",
    group: "space",
    from: {
      goldsrc: (m) => num(m.area) && m.area * UNIT_M2,
      source: (m) => num(m.walkable?.area) && m.walkable.area * UNIT_M2,
      vt2: (m) => num(m.reachedArea),
    },
  },
  {
    key: "headroom",
    label: "headroom, roofed floor (median)",
    unit: "m",
    group: "height",
    from: { goldsrc: (m) => u(med(m.headroom)), source: (m) => u(med(m.headroom?.under600)), vt2: null },
    lacks: { vt2: "no solid geometry: the navmesh only says 1.6 m are clear" },
    note: "GoldSrc leaves open-sky places out; L4D2: places under 600 units (its sky lid counts as a roof)",
  },
  {
    key: "corridorHeadroom",
    label: "headroom over narrow floor (median)",
    unit: "m",
    group: "height",
    from: {
      goldsrc: (m) => u(med(m.headroomNarrow)),
      source: (m) => u(med(m.headroom?.corridors)),
      vt2: null,
    },
    lacks: { vt2: "no solid geometry" },
    note: "GoldSrc under 144 units wide, L4D2 under 176",
  },
  {
    key: "openSkyShare",
    label: "floor under open sky",
    unit: "share",
    group: "height",
    from: { goldsrc: (m) => num(m.openSky), source: (m) => num(m.headroom?.underSky), vt2: null },
    lacks: { vt2: "no solid geometry" },
  },
  {
    key: "heightRange",
    label: "height range of the walked floor (p5 to p95)",
    unit: "m",
    group: "height",
    from: {
      goldsrc: (m) => u(m.vertical?.range90),
      source: (m) => u(m.vertical?.p5p95),
      vt2: (m) => num(m.vertical?.range90),
    },
  },
  {
    key: "floorLevels",
    label: "floor levels (heights holding 2 % of the floor)",
    unit: "count",
    group: "height",
    from: { goldsrc: (m) => num(m.vertical?.levels), source: null, vt2: (m) => num(m.vertical?.levels) },
    lacks: { source: "not taken" },
    note: "on VT2's levels that slope all the way this counts slope, not storeys",
  },
  {
    key: "sight",
    label: "sightline (map's median place: its longest line)",
    unit: "m",
    group: "sight",
    from: {
      goldsrc: (m) => u(med(m.sight)),
      source: (m) => ({ dressed: u(med(dressedOf(m)?.sight)), bare: u(med(m.sight)) }),
      vt2: null,
    },
    lacks: {
      vt2: "no solid geometry; its floorRun (how far the floor runs) is a floor under sight, not sight",
    },
    note: "lines capped at 3000 units (76 m)",
  },
  {
    key: "crossing",
    label: "crossing, walked",
    unit: "m",
    group: "route",
    from: {
      goldsrc: (m, kind) => (goldsrcRoute(m, kind) ? u(m.crossing?.walk) : null),
      source: (m) => (m.crossing?.finale ? null : u(m.crossing?.walked)),
      vt2: (m) => num(m.crossing?.walk),
    },
    note: "GoldSrc: from a way out (an arena: start to farthest floor); L4D2: saferoom to saferoom, finales left out; VT2: the director's main path",
  },
  {
    key: "crossingRatio",
    label: "walked / straight",
    unit: "ratio",
    group: "route",
    from: {
      goldsrc: (m, kind) => (goldsrcRoute(m, kind) ? num(m.crossing?.ratio) : null),
      source: (m) => (m.crossing?.finale ? null : num(m.crossing?.ratio)),
      vt2: (m) => num(m.crossing?.ratio),
    },
    note: "VT2's is ill-conditioned where a level comes back near its start; its winding per 100 m is in pathWinding",
  },
  {
    key: "pathWinding",
    routeOnly: true,
    label: "winding per 100 m of route",
    unit: "ratio",
    group: "route",
    from: { goldsrc: null, source: null, vt2: (m) => num(med(m.crossing?.winding100)) },
    lacks: { goldsrc: "no main path", source: "not taken" },
  },
  {
    key: "loops",
    label: "loops (cycles round 512-unit tiles)",
    unit: "count",
    group: "route",
    from: {
      goldsrc: (m) => num(m.loops?.tile512?.cycles),
      source: null,
      vt2: (m) => num(m.loops?.tile512?.cycles),
    },
    lacks: { source: "its coarse cyclomatic number counts open floor as loops; see alternativeRoutes" },
    note: "VT2's tiles scaled by player heights (12.8 m)",
  },
  {
    key: "alternativeRoutes",
    routeOnly: true,
    label: "alternative routes",
    unit: "count",
    group: "route",
    pool: false,
    from: {
      goldsrc: null,
      source: (m) => num(m.loops?.alternatives),
      vt2: (m) => num(m.routes?.crossroads),
    },
    lacks: { goldsrc: "no route to measure them against; loops stand in" },
    note: "L4D2: stretches of the route with another way round at 39 m; VT2: the director's crossroads. Not the same count",
  },
  {
    key: "branches",
    label: "branches and dead ends",
    unit: "count",
    group: "route",
    from: { goldsrc: null, source: null, vt2: null },
    lacks: {
      goldsrc: "not measured: the walk's graph is not split into rooms and links",
      source: "not measured",
      vt2: "not measured (offPathShare and its islands are the nearest)",
    },
  },
  {
    key: "offPathShare",
    label: "floor off the route",
    unit: "share",
    group: "route",
    from: { goldsrc: null, source: null, vt2: (m) => num(m.routes?.islandShare) },
    lacks: { goldsrc: "no route", source: "not taken" },
    note: "VT2: the director's island zones over all its zoned floor",
  },
  {
    key: "stairRise",
    label: "stair riser (commonest)",
    unit: "m",
    group: "stairs-doors",
    from: { goldsrc: (m) => u(m.steps?.commonRise), source: (m) => u(med(m.steps?.stairRisers)), vt2: null },
    lacks: { vt2: "the navmesh runs smooth over stairs" },
  },
  {
    key: "stairFlightRise",
    label: "stair flight rise",
    unit: "m",
    group: "stairs-doors",
    from: {
      goldsrc: (m) => u(med(m.steps?.flightRise)),
      source: (m) => u(med(m.steps?.stairFlights?.rise)),
      vt2: null,
    },
    lacks: { vt2: "the navmesh runs smooth over stairs" },
  },
  {
    key: "doorWidth",
    label: "door width",
    unit: "m",
    group: "stairs-doors",
    from: { goldsrc: (m) => u(med(m.doors?.width)), source: (m) => u(med(m.doors?.openingWidth)), vt2: null },
    lacks: { vt2: "doors are units, not entities with sizes" },
    note: "GoldSrc: the panel (includes what hides in the frame); L4D2: the prop door's leaf",
  },
  {
    key: "doorHeight",
    label: "door height",
    unit: "m",
    group: "stairs-doors",
    from: { goldsrc: (m) => u(med(m.doors?.height)), source: (m) => u(med(m.doors?.leafHeight)), vt2: null },
    lacks: { vt2: "doors are units, not entities with sizes" },
  },
  {
    key: "doors",
    label: "doors per map",
    unit: "count",
    group: "stairs-doors",
    from: {
      goldsrc: (m) => num(m.doors?.openings),
      source: (m) => num(m.doors?.openingWidth?.n),
      vt2: null,
    },
    lacks: { vt2: "doors are units, not entities" },
  },
  {
    key: "dropHeight",
    label: "drop height",
    unit: "m",
    group: "stairs-doors",
    pool: false,
    from: { goldsrc: null, source: (m) => u(med(m.steps?.drops)), vt2: (m) => num(med(m.pacing?.ledgeDrop)) },
    lacks: { goldsrc: "drops are walked down, not measured" },
    note: "L4D2: nav links falling over 18 units; VT2: the AI's ledges",
  },
  {
    key: "firstEventAt",
    routeOnly: true,
    label: "first event (fraction of the route)",
    unit: "fraction",
    group: "pacing",
    pool: false,
    from: {
      goldsrc: null,
      source: (m) => (m.pacing?.crescendos?.length ? Math.min(...m.pacing.crescendos) : null),
      vt2: (m) => (m.pacing?.bossAt?.length ? Math.min(...m.pacing.bossAt) : null),
    },
    lacks: { goldsrc: "no director events" },
    note: "L4D2: the first crescendo; VT2: the first boss route (its scripted events are not placed)",
  },
  {
    key: "eventsPerKm",
    routeOnly: true,
    label: "events per km of route",
    unit: "per-km",
    group: "pacing",
    pool: false,
    from: {
      goldsrc: null,
      source: (m) =>
        m.crossing?.finale ? null : perKm(m.pacing?.crescendos?.length ?? null, u(m.crossing?.walked)),
      vt2: (m) => perKm(num(m.pacing?.events), num(m.crossing?.walk)),
    },
    lacks: { goldsrc: "no director events" },
    note: "L4D2: crescendos; VT2: scripted terror events",
  },
  {
    key: "openSpacing",
    routeOnly: true,
    label: "spacing of open spaces along the route",
    unit: "m",
    group: "pacing",
    from: { goldsrc: null, source: null, vt2: (m) => num(med(m.pacing?.openSpacing)) },
    lacks: { goldsrc: "no route zones", source: "not taken" },
  },
  ...cityMeasures(),
];

/**
 * The role-play city measures (levels/lib/city-measures.mjs), read from a GoldSrc record's `city`, already in
 * metres, m2, shares and counts. Each is `cityOnly`, its `group` "city-..." (the guide's city table).
 */
function cityMeasures() {
  const c = (get) => (m) => (m.city ? num(get(m.city)) : null);
  const lacks = { source: "no city measures (not a city)", vt2: "no city measures (not a city)" };
  const one = (key, label, unit, group, get, note) => ({
    key,
    label,
    unit,
    group,
    cityOnly: true,
    from: { goldsrc: c(get), source: null, vt2: null },
    lacks,
    ...(note ? { note } : {}),
  });
  const kindOf = (x, k) => x.buildings.byKind?.[k] ?? 0;
  const connectors = (x) => Object.values(x.layers.connectors ?? {}).reduce((a, b) => a + b, 0);
  const hidden = (f) => f.disguisedDoors + f.wallToggles + f.hiddenNames;
  return [
    one("cityStreetArea", "street floor under open sky", "m2", "city-streets", (x) => x.streets.areaM2, "public floor (not behind a door) under open sky"),
    one("cityStreetWidth", "street width under sky (median place)", "m", "city-streets", (x) => x.streets.width?.median),
    one("cityStreetVehicleShare", "street floor 4 m wide or more (vehicles)", "share", "city-streets", (x) => x.streets.vehicleShare),
    one("cityPublicArea", "public floor (everything not behind a door)", "m2", "city-streets", (x) => x.publicM2),
    one("cityPublicRoofedShare", "public floor that is roofed", "share", "city-streets", (x) => x.publicRoofedShare),
    one("cityPublicWidth", "public way width (median place, roofed or not)", "m", "city-streets", (x) => x.publicWays.width?.median),
    one("cityPublicNarrowWidth", "public way width (p10 place: the alleys)", "m", "city-streets", (x) => x.publicWays.width?.p10),
    one("cityPublicVehicleShare", "public floor 4 m wide or more", "share", "city-streets", (x) => x.publicWays.vehicleShare),
    one("cityPlazas", "plazas (12 m wide both ways, 150 m2 or more)", "count", "city-streets", (x) => x.publicWays.plazas),
    one("cityPlazaArea", "plaza floor (median plaza)", "m2", "city-streets", (x) => x.publicWays.plazaM2?.median),
    one("cityJunctions", "junctions of the public ways (3 ways or more)", "count", "city-streets", (x) => x.publicWays.junctions),
    one("cityJunctionsPerHa", "junctions per hectare of public floor", "ratio", "city-streets", (x) => x.publicWays.junctionsPerHa),
    one("cityBetweenJunctions", "street length between junctions (median)", "m", "city-streets", (x) => x.publicWays.betweenJunctions?.median),
    one("cityStreetWayWidth", "street width (median street's own median)", "m", "city-streets", (x) => x.publicWays.streetWidth?.median),
    one("cityDeadEnds", "dead-end ways", "count", "city-streets", (x) => x.publicWays.deadEnds),
    one("cityBuildings", "buildings behind doors", "count", "city-buildings", (x) => x.buildings.count, "rooms joined by doors no public floor touches; a room open to a street is public floor"),
    one("cityBuildingsPerHa", "buildings per hectare of walked floor", "ratio", "city-buildings", (x) => x.buildings.perHa),
    one("cityRoomsPerBuilding", "rooms per building (median)", "ratio", "city-buildings", (x) => x.buildings.roomsPerBuilding?.median),
    one("cityRoomArea", "room floor (median room)", "m2", "city-buildings", (x) => x.buildings.roomM2?.median),
    one("cityBuildingArea", "building floor (median building)", "m2", "city-buildings", (x) => x.buildings.buildingM2?.median),
    one("cityApartments", "apartment-sized buildings (15 to 150 m2)", "count", "city-buildings", (x) => x.buildings.apartmentSized),
    one("cityRoomShare", "walked floor behind doors", "share", "city-buildings", (x) => x.buildings.roomShare),
    one("cityHomes", "buildings named as homes", "count", "city-buildings", (x) => kindOf(x, "home"), "by their doors' names (resident, apt, flat, citizen, lux, estate ...)"),
    one("cityShops", "buildings named as shops, bars, clubs", "count", "city-buildings", (x) => kindOf(x, "shop")),
    one("cityPublicBuildings", "buildings named as public (office, lab, bank, police ...)", "count", "city-buildings", (x) => kindOf(x, "public")),
    one("cityLayers", "vertical layers (heights holding 2 % of the floor)", "count", "city-layers", (x) => x.layers.count),
    one("cityLayerSpan", "lowest to highest layer", "m", "city-layers", (x) => x.layers.span),
    one("cityConnectors", "layer connectors (stairs and ramps, lifts, ladders, teleports)", "count", "city-layers", connectors),
    one("cityConnectorsPerHa", "connectors per hectare", "ratio", "city-layers", (x) => x.layers.connectorsPerHa),
    one("cityLiftConnectors", "lifts serving layers", "count", "city-layers", (x) => x.layers.connectors?.lift),
    one("cityToConnector", "walk from public floor to the nearest connector (median)", "m", "city-layers", (x) => x.layers.toConnector?.median),
    one("cityToConnectorFar", "walk from public floor to the nearest connector (p90)", "m", "city-layers", (x) => x.layers.toConnector?.p90),
    one("cityRoomRepeat", "rooms whose footprint repeats", "share", "city-variety", (x) => x.variety.rooms.repeatedShare),
    one("cityBuildingRepeat", "buildings whose footprint repeats", "share", "city-variety", (x) => x.variety.buildings.repeatedShare),
    one("cityModelRepeat", "brush models repeated (size and textures)", "share", "city-variety", (x) => x.variety.brushModels.repeatedShare),
    one("cityTextures", "world textures", "count", "city-variety", (x) => x.variety.textures),
    one("cityTexturesPerTile", "textures per 13 m tile (median)", "count", "city-variety", (x) => x.variety.texturesPerTile?.median),
    one("cityDistricts", "districts (like texture palettes, 3 tiles or more)", "count", "city-variety", (x) => x.variety.districts),
    one("cityDistrictArea", "district size (median)", "m2", "city-variety", (x) => x.variety.districtM2?.median),
    one("cityFloorLight", "floor light (median place, 0 to 255)", "ratio", "city-light", (x) => x.light.floor?.median),
    one("cityDarkShare", "floor in shadow (light under 24)", "share", "city-light", (x) => x.light.floor?.darkShare),
    one("cityBrightShare", "floor brightly lit (128 or more)", "share", "city-light", (x) => x.light.floor?.brightShare),
    one("cityPublicLight", "public floor light (median)", "ratio", "city-light", (x) => x.light.public?.median),
    one("cityRoomLight", "room floor light (median)", "ratio", "city-light", (x) => x.light.rooms?.median),
    one("cityLightsPerHa", "light entities per hectare", "ratio", "city-light", (x) => x.light.lightsPerHa),
    one("cityWarmLights", "lights warm (red, orange, yellow)", "share", "city-light", (x) => x.light.warmShare),
    one("cityCoolLights", "lights cool (green, cyan, blue, purple)", "share", "city-light", (x) => x.light.coolShare),
    one("cityWhiteLights", "lights white (pale)", "share", "city-light", (x) => x.light.whiteShare),
    one("cityDoors", "doors (func_door, rotating, momentary)", "count", "city-furniture", (x) => x.furniture.doors),
    one("cityNamedDoors", "doors with a name", "count", "city-furniture", (x) => x.furniture.namedDoors),
    one("citySwitches", "switches (buttons)", "count", "city-furniture", (x) => x.furniture.switches),
    one("citySpawns", "spawn points", "count", "city-furniture", (x) => x.furniture.spawns),
    one("cityCells", "cell doors (cell, jail, prison)", "count", "city-furniture", (x) => x.furniture.cells),
    one("cityLifts", "lifts the walk rides", "count", "city-furniture", (x) => x.furniture.lifts),
    one("cityTrains", "trains (func_train)", "count", "city-furniture", (x) => x.furniture.trains),
    one("cityTeleports", "teleports", "count", "city-furniture", (x) => x.furniture.teleports),
    one("cityLadders", "ladders", "count", "city-furniture", (x) => x.furniture.ladders),
    one("cityHidden", "hidden ways (disguised doors, wall toggles, secret names)", "count", "city-furniture", (x) => hidden(x.furniture)),
    one("cityIllusionary", "func_illusionary", "count", "city-furniture", (x) => x.furniture.illusionary),
    one("cityProps", "props (ts_model and the like)", "count", "city-furniture", (x) => x.furniture.props),
    one("citySounds", "sounds", "count", "city-furniture", (x) => x.furniture.sounds),
  ];
}

/** the positions along the route a pacing histogram is made of, by engine (fractions; L4D2 also its finale) */
const EVENT_POSITIONS = {
  source: (m) => [...(m.pacing?.crescendos ?? []), ...(m.pacing?.finale ?? [])],
  vt2: (m) => m.pacing?.bossAt ?? [],
};
const EVENT_WHAT = { source: "crescendos and finale triggers", vt2: "boss routes" };

// ── statistics ───────────────────────────────────────────────────────────────

/**
 * Weighted quantile of `[value, weight]` pairs at `q` (0..1): each value sits at the middle of its weight's
 * share of the whole, and between two the answer is linear. With equal weights this is Hazen's rule ((i + 0.5) / n),
 * exact at the median.
 */
export const weightedQuantile = (pairs, q) => {
  const s = pairs.filter(([v, w]) => Number.isFinite(v) && w > 0).sort((a, b) => a[0] - b[0]);
  if (!s.length) return null;
  if (s.length === 1) return s[0][0];
  const total = s.reduce((t, [, w]) => t + w, 0);
  let run = 0;
  const at = s.map(([v, w]) => {
    const mid = (run + w / 2) / total;
    run += w;
    return [mid, v];
  });
  if (q <= at[0][0]) return at[0][1];
  if (q >= at[at.length - 1][0]) return at[at.length - 1][1];
  for (let i = 1; i < at.length; i++)
    if (q <= at[i][0]) {
      const [x0, v0] = at[i - 1];
      const [x1, v1] = at[i];
      return v0 + ((v1 - v0) * (q - x0)) / (x1 - x0);
    }
  return at[at.length - 1][1];
};

const roundTo = (x, unit) => {
  if (x == null) return null;
  const d = unit === "share" || unit === "fraction" ? 3 : unit === "m2" ? 0 : unit === "count" ? 1 : 2;
  const f = 10 ** d;
  return Math.round(x * f) / f;
};

/** n, median, p10, p90 of `[value, weight]` pairs, rounded for the unit */
export const band = (pairs, unit) => {
  const ok = pairs.filter(([v]) => Number.isFinite(v));
  if (!ok.length) return null;
  return {
    n: ok.length,
    median: roundTo(weightedQuantile(ok, 0.5), unit),
    p10: roundTo(weightedQuantile(ok, 0.1), unit),
    p90: roundTo(weightedQuantile(ok, 0.9), unit),
  };
};

// ── tagging ──────────────────────────────────────────────────────────────────

/** the setting an exploration map's measures say, when the table does not name one */
export const settingByMeasure = (openSky) =>
  openSky == null ? "unclear" : openSky < 0.15 ? "dungeon" : openSky < 0.5 ? "mixed" : "outdoors";

/**
 * Every map of every corpus with its kind (or why it is left out). `corpora` maps a short name (hl, ts, msr,
 * l4d2, vt2) to that corpus as read; `tags` is levels/styles/tags.json as read. Returns rows of
 * `{ game, group, name, engine, kind, setting, settingFrom, left, map }` (`left` the reason it is out).
 */
export const tagLevels = (corpora, tags) => {
  const rows = [];
  for (const [game, corpus] of Object.entries(corpora)) {
    const engine = CORPORA[game];
    if (!engine || !corpus?.maps) continue;
    const settings = tags.settings?.[game] ?? {};
    const settingOf = new Map();
    for (const [setting, names] of Object.entries(settings)) for (const n of names) settingOf.set(n, setting);
    for (const map of corpus.maps) {
      const group = map.group ?? null;
      const gk = group ? `${game}/${group}` : null;
      const groups = tags.groups ?? {};
      const kind = gk && gk in groups ? groups[gk] : game in groups ? groups[game] : undefined;
      const row = {
        game,
        group,
        name: map.name,
        engine,
        kind: kind ?? null,
        setting: null,
        settingFrom: null,
      };
      const ex = tags.exclude?.[`${game}/${map.name}`];
      if (kind === undefined) {
        row.left = "no kind for its game or group in tags.json";
        row.untagged = true;
      } else if (kind === null)
        row.left = tags.groupsLeftOut?.[gk] ?? tags.groupsLeftOut?.[game] ?? "its group is left out";
      else if (ex) row.left = ex;
      else if (engine === "goldsrc" && map.reachedShare != null && map.reachedShare < MIN_REACHED)
        row.left = `the walk reached ${map.reachedShare} of its floor (under ${MIN_REACHED}): it began boxed in`;
      if (kind === "exploration") {
        if (settingOf.has(map.name)) {
          row.setting = settingOf.get(map.name);
          row.settingFrom = "table";
        } else {
          row.setting = settingByMeasure(map.openSky);
          row.settingFrom = "measure";
        }
      }
      rows.push({ ...row, map });
    }
  }
  return rows;
};

// ── bands ────────────────────────────────────────────────────────────────────

/** one measure's value for a row: `{ m, ph, bareM, barePh, bracketed }` or null */
const valueOf = (measure, row) => {
  const get = measure.from[row.engine];
  if (!get) return null;
  const raw = get(row.map, row.kind);
  if (raw == null) return null;
  const toPh = measure.unit === "m" ? (x) => (x == null ? null : x / PLAYER_M[row.engine]) : () => null;
  if (typeof raw === "object") {
    if (raw.dressed == null && raw.bare == null) return null;
    const d = raw.dressed ?? raw.bare;
    return { m: d, ph: toPh(d), bareM: raw.bare ?? d, barePh: toPh(raw.bare ?? d), bracketed: true };
  }
  if (!Number.isFinite(raw)) return null;
  return { m: raw, ph: toPh(raw), bareM: raw, barePh: toPh(raw), bracketed: false };
};

/** bands of every measure over some tagged rows (all of one kind, or one setting of it) */
export const bandsOf = (rows) => {
  const games = [...new Set(rows.map((r) => r.game))];
  const perGame = Object.fromEntries(games.map((g) => [g, rows.filter((r) => r.game === g).length]));
  const out = {};
  const cities = rows.some((r) => r.map?.city);
  for (const measure of MEASURES) {
    if (measure.cityOnly && !cities) continue;
    const vals = rows.map((r) => ({ r, v: valueOf(measure, r) })).filter((x) => x.v);
    const entry = { label: measure.label, unit: measure.unit };
    if (measure.note) entry.note = measure.note;
    const lacking = games.filter((g) => !measure.from[CORPORA[g]]);
    if (lacking.length)
      entry.lacks = Object.fromEntries(lacking.map((g) => [g, measure.lacks?.[CORPORA[g]] ?? "not taken"]));
    if (!vals.length) {
      entry.band = null;
      out[measure.key] = entry;
      continue;
    }
    // each game's maps weigh 1 together, among the games that have the measure
    const counted = Object.fromEntries(games.map((g) => [g, vals.filter((x) => x.r.game === g).length]));
    const w = (g) => 1 / counted[g];
    const pool = measure.pool !== false || Object.values(counted).filter(Boolean).length < 2;
    const pick = (key) => vals.map((x) => [x.v[key], w(x.r.game)]);
    if (pool) {
      entry.band = band(pick("m"), measure.unit);
      if (measure.unit === "m") entry.ph = band(pick("ph"), "ph");
      const bracketed = [...new Set(vals.filter((x) => x.v.bracketed).map((x) => x.r.game))];
      if (bracketed.length) {
        entry.bracketed = bracketed;
        entry.bare = band(pick("bareM"), measure.unit);
        if (measure.unit === "m") entry.barePh = band(pick("barePh"), "ph");
      }
    } else {
      entry.band = null;
      entry.pooled = false;
    }
    entry.bySource = {};
    for (const g of games) {
      const gv = vals.filter((x) => x.r.game === g);
      if (!gv.length) continue;
      const s = {
        ...band(
          gv.map((x) => [x.v.m, 1]),
          measure.unit,
        ),
      };
      if (measure.unit === "m")
        s.ph = band(
          gv.map((x) => [x.v.ph, 1]),
          "ph",
        );
      if (gv.some((x) => x.v.bracketed))
        s.bare = band(
          gv.map((x) => [x.v.bareM, 1]),
          measure.unit,
        );
      if (gv.length < perGame[g]) s.of = perGame[g];
      entry.bySource[g] = s;
    }
    out[measure.key] = entry;
  }
  return out;
};

/** each game's event positions as tenths of the route, each map one vote (its events share it) */
export const pacingTenths = (rows) => {
  const out = {};
  for (const engine of Object.keys(EVENT_POSITIONS)) {
    for (const g of [...new Set(rows.filter((r) => r.engine === engine).map((r) => r.game))]) {
      const tenths = new Array(10).fill(0);
      let maps = 0;
      for (const r of rows.filter((x) => x.game === g)) {
        const at = EVENT_POSITIONS[engine](r.map).filter(Number.isFinite);
        if (!at.length) continue;
        maps++;
        for (const f of at) tenths[Math.min(9, Math.max(0, Math.floor(f * 10)))] += 1 / at.length;
      }
      if (maps)
        out[g] = { what: EVENT_WHAT[engine], maps, tenths: tenths.map((t) => roundTo(t / maps, "share")) };
    }
  }
  return out;
};

/**
 * the measures every game of a set lacks: a style's gaps (a route-only measure only where a game has a route, a
 * city measure only in a kind of cities)
 */
const gapsOf = (games, cities = false) => {
  const routed = games.some((g) => CORPORA[g] !== "goldsrc");
  return MEASURES.filter(
    (m) => (routed || !m.routeOnly) && (cities || !m.cityOnly) && games.every((g) => !m.from[CORPORA[g]]),
  ).map(
    (m) => ({
      key: m.key,
      label: m.label,
      why: Object.fromEntries(games.map((g) => [g, m.lacks?.[CORPORA[g]] ?? "not taken"])),
    }),
  );
};

/**
 * The bands of every kind. `corpora`: short name → corpus as read; `tags`: tags.json as read. Returns
 * `{ kinds: { <kind>: { kind, about, sources, maps, left, bands, pacing, gaps, settings? } }, untagged }`.
 * Exploration also gets `settings` (dungeon, town, mixed, outdoors): bands of their own where a setting has
 * MIN_SETTING_MAPS maps or more, its maps' names where it has fewer.
 */
export const styleBands = (corpora, tags) => {
  const rows = tagLevels(corpora, tags);
  const kinds = {};
  const names = Object.keys(tags.kinds ?? {});
  for (const k of [...new Set(rows.map((r) => r.kind).filter(Boolean))])
    if (!names.includes(k)) names.push(k);
  for (const kind of names) {
    const all = rows.filter((r) => r.kind === kind);
    const used = all.filter((r) => !r.left);
    const games = [...new Set(all.map((r) => r.game))];
    const sources = games.map((g) => ({
      game: g,
      title: GAME_NAMES[g] ?? g,
      engine: CORPORA[g],
      playerHeightM: Math.round(PLAYER_M[CORPORA[g]] * 1000) / 1000,
      corpus: `levels/corpus/levels-${g}.json`,
      corpusMade: corpora[g]?.made ?? null,
      maps: used.filter((r) => r.game === g).length,
      left: all.filter((r) => r.game === g && r.left).length,
    }));
    const entry = {
      kind,
      about: tags.kinds?.[kind] ?? null,
      sources,
      n: used.length,
      maps: used.map((r) => (r.setting ? `${r.game}/${r.name} (${r.setting})` : `${r.game}/${r.name}`)),
      left: all.filter((r) => r.left).map((r) => ({ map: `${r.game}/${r.name}`, why: r.left })),
      bands: bandsOf(used),
      pacing: pacingTenths(used),
      gaps: gapsOf(
        games,
        used.some((r) => r.map?.city),
      ),
    };
    if (kind === "exploration") {
      entry.settings = {};
      const order = ["dungeon", "town", "mixed", "outdoors", "unclear"];
      const seen = [...new Set(used.map((r) => r.setting))].sort(
        (a, b) => order.indexOf(a) - order.indexOf(b),
      );
      for (const s of seen) {
        const sr = used.filter((r) => r.setting === s);
        const se = {
          n: sr.length,
          maps: sr.map((r) => `${r.game}/${r.name}${r.settingFrom === "measure" ? " (by measure)" : ""}`),
        };
        const note = tags.settingNotes?.[sr[0].game]?.[s];
        if (note) se.note = note;
        if (s === "unclear") se.bands = null;
        else if (sr.length >= MIN_SETTING_MAPS) se.bands = bandsOf(sr);
        else {
          se.bands = null;
          se.tooFew = `under ${MIN_SETTING_MAPS} maps: read the kind's bands`;
        }
        entry.settings[s] = se;
      }
    }
    kinds[kind] = entry;
  }
  const untagged = rows.filter((r) => r.untagged).map((r) => `${r.game}/${r.name}`);
  return { kinds, untagged, rows: rows.length };
};

/**
 * The styles: a kind (and a setting of it) plus a theme, with the kind to fall back on. rpg_sbox's first is a
 * fantasy dungeon: Master Sword Rebirth's exploration, its dungeons where they have bands, and the co-op
 * campaign's bands for a route mixed in.
 */
export const STYLES = [
  {
    name: "fantasy-dungeon",
    title: "fantasy dungeon (exploration)",
    theme: "fantasy",
    kind: "exploration",
    setting: "dungeon",
    fallback: "coop-campaign",
    for: "rpg_sbox's first dungeon",
    about:
      "Master Sword Rebirth's exploration: hubs, branches, dead ends with rewards. The dungeon setting's bands first, the whole kind's where a setting band is missing; the co-op campaign's bands (Vermintide 2's 30 % of floor off the route) for a mixed route with side areas.",
  },
];

/** a style's file: its kind's (and setting's) bands, and the fallback kind's, as styleBands gave them */
export const styleOf = (style, result) => {
  const kind = result.kinds[style.kind];
  const setting = style.setting ? kind?.settings?.[style.setting] : null;
  const fb = style.fallback ? result.kinds[style.fallback] : null;
  return {
    style: style.name,
    title: style.title,
    theme: style.theme,
    kind: style.kind,
    setting: style.setting ?? null,
    for: style.for ?? null,
    about: style.about,
    bands: setting?.bands ?? kind?.bands ?? null,
    bandsFrom: setting?.bands
      ? `${style.kind}/${style.setting} (${setting.n} maps)`
      : `${style.kind} (${kind?.n} maps)`,
    kindBands: kind?.bands ?? null,
    fallback: fb ? { kind: style.fallback, n: fb.n, bands: fb.bands, pacing: fb.pacing } : null,
    gaps: kind?.gaps ?? [],
  };
};
