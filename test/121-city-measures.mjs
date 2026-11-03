// A role-play city's measures (levels/lib/city-measures.mjs) on small synthetic places, never a game's map:
// streets thinned to their middle lines (a crossing is one junction, a plaza one node, a grid's streets measured
// between junctions), buildings cut at doors (rooms behind a door, a building of two rooms entered from the
// street, named as a home or a cell), layers joined by a ramp and a lift, the walk to the nearest of them,
// repeated rooms, districts by texture palette, light and its colours. And the styles: a city kind banded
// with its own measures, never another kind's; L4D2's dressed width by its props' collision.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, sure, near, HERE } from "./helper.mjs";

const LEVELS = join(HERE, "..", "levels");
const LIB = join(LEVELS, "lib", "city-measures.mjs");
const url = (file) => new URL(`file:///${file.replace(/\\/g, "/")}`).href;

if (existsSync(LIB)) {
  const C = await import(url(LIB));
  const S = await import(url(join(LEVELS, "lib", "styles.mjs")));
  const G = 32;
  const M = G * 0.0254; // a place's side in metres
  /** places: [x, y] in grid steps; width in units; on floor z; under sky or not */
  const places = (list, { z = 0, width = 192, sky = true, light } = {}) =>
    list.map(([x, y]) => ({ at: [x * G, y * G, z], width, headroom: sky ? null : 128, sky, ...(light === undefined ? {} : { light }) }));
  const rect = (x0, y0, x1, y1) => {
    const out = [];
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) out.push([x, y]);
    return out;
  };
  const without = (list, holes) => list.filter(([x, y]) => !holes.some(([a, b]) => a === x && b === y));

  test("city streets: a crossing is one junction, its four arms dead ends; a street 4 m wide takes vehicles", () => {
    const cross = [...rect(0, 27, 60, 33), ...without(rect(27, 0, 33, 60), rect(27, 27, 33, 33))];
    const r = C.cityOf({ cells: places(cross) });
    const s = r.streets;
    sure(s.junctions === 1 && s.deadEnds === 4 && s.plazas === 0, `junctions ${s.junctions}, dead ends ${s.deadEnds}, plazas ${s.plazas}`);
    near(s.width.median, 192 * 0.0254, 0.01, "192 units are 4.88 m");
    sure(s.vehicleShare === 1 && s.vehicleStreetShare === 1, "4.88 m takes a vehicle");
    // each arm runs from the crossing's middle out: about 27 places, less what the thinning eats at its end
    sure(s.deadEndLength.median > 20 && s.deadEndLength.median < 27 * M + 2, `arm ${s.deadEndLength.median} m`);
    const narrow = C.cityOf({ cells: places(cross, { width: 120 }) }).streets;
    sure(narrow.vehicleShare === 0 && narrow.pedestrianShare === 1, "3 m is a lane for walking");
  });

  test("city streets: a grid of streets measured between its junctions; a broad square is a plaza, one node", () => {
    // two streets each way, 4 places wide, 24 apart, across a block 72 places square
    const grid = [];
    for (const at of [20, 44]) grid.push(...rect(0, at, 72, at + 4), ...rect(at, 0, at + 4, 72));
    const unique = [...new Map(grid.map((p) => [p.join(), p])).values()];
    const r = C.cityOf({ cells: places(unique, { width: 128 }) }).streets;
    sure(r.junctions === 4, `four crossings: ${r.junctions}`);
    // between two crossings 24 places apart, middle to middle
    sure(r.betweenJunctions && Math.abs(r.betweenJunctions.median - 24 * M) < 2.5, `between ${r.betweenJunctions?.median} m (${24 * M})`);
    sure(r.deadEnds === 8, `eight arms run out: ${r.deadEnds}`);
    // a square 20 places (16 m) across with a street out of each side: one plaza, no junction
    const square = rect(20, 20, 40, 40);
    const arms = [...rect(0, 28, 20, 32), ...rect(40, 28, 60, 32), ...rect(28, 0, 32, 20), ...rect(28, 40, 32, 60)];
    const cells = [...places(square, { width: 640 }), ...places(arms, { width: 128 })];
    const p = C.cityOf({ cells }).streets;
    sure(p.plazas === 1 && p.junctions === 0, `a plaza, ${p.plazas}; junctions ${p.junctions}`);
    near(p.plazaM2.median, 400 * M * M, 1, "its floor");
    // a long wide avenue is no plaza (longer than three to one)
    const avenue = C.cityOf({ cells: places(rect(0, 0, 80, 16), { width: 520 }) }).streets;
    sure(avenue.plazas === 0, "an avenue 16 wide and 80 long is a street");
  });

  test("city buildings: rooms behind doors, two rooms one building entered from the street, named by their doors", () => {
    // a street (under sky) along y 0..3; north of it, a flat: a door at y 4, a hall (y 5..9), a door at y 10, a
    // bedroom (y 11..15); and a cell beside it behind its own door
    const street = places(rect(0, 0, 40, 4));
    const doorway = (x0, x1, y) => places(rect(x0, y, x1, y + 1), { sky: false, width: 96 });
    const flat = [...doorway(4, 7, 4), ...places(rect(2, 5, 10, 10), { sky: false, width: 160 }), ...doorway(4, 7, 10), ...places(rect(2, 11, 10, 16), { sky: false, width: 160 })]; // prettier-ignore
    const cell = [...doorway(22, 25, 4), ...places(rect(21, 5, 26, 9), { sky: false, width: 128 })];
    const door = (x0, x1, y, name) => ({ min: [x0 * G, y * G - 2, 0], max: [x1 * G, y * G + 2, 96], name });
    const doors = [door(4, 6, 4, "resident1"), door(4, 6, 10, "resident1bed"), door(22, 24, 4, "cell1")];
    const entities = doors.map((d) => ({ classname: "func_door", name: d.name }));
    const r = C.cityOf({ cells: [...street, ...flat, ...cell], doors, entities });
    const b = r.buildings;
    sure(b.count === 2 && b.rooms === 3, `buildings ${b.count}, rooms ${b.rooms}`);
    sure(b.entered === 2, "both entered from the street");
    sure(b.byKind.home === 1 && b.byKind.jail === 1, JSON.stringify(b.byKind));
    sure(b.roomsPerBuilding.most === 2, "the flat has two rooms");
    near(b.roomM2.median, 40 * M * M, 0.5, "a room of 8 by 5 places");
    sure(b.apartmentSized === 1, "the flat is apartment-sized (53 m2); the cell is 13 m2");
    sure(r.furniture.cells === 1 && r.furniture.namedDoors === 3, "a cell door, three named");
    sure(r.publicRoofedShare === 0 && r.streets.places === 160, "the street is the public floor");
    sure(C.kindOfName("lux_apt_b") === "home" && C.kindOfName("gunshop1") === "shop" && C.kindOfName("bankdoor") === "public", "names");
    sure(C.kindOfName("cp_prison3") === "jail" && C.kindOfName("pphideout") === "hideout" && C.kindOfName(null) === "unnamed", "names");
    // asked with `detail`, the cut comes too and nothing else of the record changes
    const d = C.cityOf({ cells: [...street, ...flat, ...cell], doors, entities, detail: true });
    const { detail, ...rest } = d;
    sure(JSON.stringify(rest) === JSON.stringify(r) && !("detail" in r), "detail leaves the record as it was");
    const flatOf = detail.buildings.find((x) => x.kind === "home");
    sure(detail.buildings.length === 2 && flatOf.rooms.length === 2 && flatOf.doorNodes.length === 2 && flatOf.entered, "the flat: two rooms, two doors, entered"); // prettier-ignore
    sure(flatOf.rooms.every((p) => detail.isRoom[p]) && !detail.isRoom[detail.publicPart], "rooms and the public floor");
    sure(detail.part.length === street.length + flat.length + cell.length, "a part for each place");
  });

  test("city layers: two floors joined by a ramp and a lift; the walk from the street to the nearest of them", () => {
    // ground (z 0) 40 by 20; a ramp 4 wide up 20 a place for 8 places at x 40..47; an upper floor (z 160) beyond
    const ground = places(rect(0, 0, 40, 20));
    const ramp = [];
    for (let k = 0; k < 8; k++) ramp.push(...places(rect(40 + k, 0, 41 + k, 4), { z: 20 * (k + 1), sky: false }));
    const upper = places(rect(48, 0, 80, 20), { z: 160, sky: false });
    const r = C.cityOf({ cells: [...ground, ...ramp, ...upper] });
    sure(r.layers.count === 2, `two layers: ${r.layers.count} (${r.layers.heights})`);
    sure(r.layers.connectors.stairs === 1 && r.layers.layerPairsJoined === 1, JSON.stringify(r.layers.connectors));
    near(r.layers.span, 160 * 0.0254, 0.3, "4 m apart");
    // the farthest ground place (0, 19) is 24 places and 16 diagonal steps from the ramp's foot (40, 3)
    near(r.layers.toConnector.most, (24 + 16 * Math.SQRT2) * M, 0.05, "the farthest walk to the ramp");
    // a lift at the ground's far end brings the middling walk down
    const lift = { kind: "lift", min: [0, 2 * G, 0], max: [2 * G, 4 * G, 160] };
    const withLift = C.cityOf({ cells: [...ground, ...ramp, ...upper], connectors: [lift] });
    sure(withLift.layers.connectors.lift === 1 && withLift.layers.toConnector.median < r.layers.toConnector.median - 5, `with a lift: ${withLift.layers.toConnector.median} m against ${r.layers.toConnector.median}`);
  });

  test("city variety, light and furniture: repeated rooms, districts by palette, the floor's light and the lamps' hues", () => {
    // two flats alike behind their doors, and one unlike
    const street = places(rect(0, 0, 96, 4), { light: 10 });
    const room = (x0, w, h) => places(rect(x0, 5, x0 + w, 5 + h), { sky: false, width: 160, light: 140 });
    const doorway = (x0) => places(rect(x0 + 1, 4, x0 + 3, 5), { sky: false, width: 64, light: 80 });
    const cells = [...street, ...doorway(2), ...room(2, 6, 5), ...doorway(20), ...room(20, 6, 5), ...doorway(40), ...room(40, 9, 7)];
    const door = (x0) => ({ min: [(x0 + 1) * G, 4 * G - 2, 0], max: [(x0 + 3) * G, 4 * G + 2, 96], name: null });
    // the west's faces wear brick, the east's metal: two districts of three tiles (512 units, 16 places)
    const faces = [];
    for (let x = 0; x < 96; x += 2) for (let y = 0; y < 12; y += 2) faces.push({ texture: x < 48 ? "brick" : "metal", at: [x * G, y * G, 0], area: 1000 }); // prettier-ignore
    const lights = [{ rgb: [255, 140, 40] }, { rgb: [40, 90, 255] }, { rgb: [250, 250, 245] }, { rgb: [255, 255, 255], sky: true }];
    const entities = [{ classname: "func_wall_toggle" }, { classname: "func_door", name: "secret_stash" }, { classname: "func_button" }];
    const r = C.cityOf({ cells, doors: [door(2), door(20), door(40)], faces, lights, entities });
    sure(r.variety.rooms.n === 3 && Math.abs(r.variety.rooms.repeatedShare - 2 / 3) < 0.01 && r.variety.rooms.mostOfOne === 2, JSON.stringify(r.variety.rooms));
    sure(r.variety.textures === 2 && r.variety.districts === 2, `districts ${r.variety.districts}`);
    sure(r.light.public.median === 10 && r.light.rooms.median === 140, "the street dark, the rooms lit");
    sure(r.light.floor.darkShare > 0.6 && r.light.floor.brightShare > 0.15, JSON.stringify(r.light.floor));
    sure(r.light.lights === 3 && r.light.hues.orange === 1 && r.light.hues.blue === 1 && r.light.hues.white === 1, JSON.stringify(r.light.hues));
    sure(r.furniture.wallToggles === 1 && r.furniture.hiddenNames === 1 && r.furniture.switches === 1, "furniture");
    sure(C.hueOf([255, 0, 0]) === "red" && C.hueOf([0, 255, 255]) === "cyan" && C.hueOf([180, 0, 255]) === "purple", "hues");
    let refused = "";
    try {
      C.cityOf({ cells: [] });
    } catch (error) {
      refused = error.message;
    }
    sure(/no walked places/.test(refused), refused);
  });

  test("styles: a city kind banded with its city measures, never another kind's; L4D2 dressed by prop collision", () => {
    const gold = (name, city) => ({
      name,
      group: "tsrp",
      reachedShare: 0.6,
      area: 1000000,
      width: { median: 250, p5: 100, p95: 600 },
      crossing: { to: "farthest", walk: 9000, ratio: 2 },
      ...(city ? { city } : {}),
    });
    const city = (x) => ({
      streets: { areaM2: 1000 * x, width: { median: 8 * x }, vehicleShare: 0.9 },
      publicWays: { width: { median: 6, p10: 4 }, plazas: x, junctions: 10 * x, betweenJunctions: { median: 10 } },
      publicM2: 5000,
      publicRoofedShare: 0.7,
      buildings: { count: 20 * x, byKind: { home: 5 * x }, roomsPerBuilding: { median: 2 } },
      layers: { count: 4 + x, connectors: { stairs: 10, lift: x }, toConnector: { median: 15, p90: 30 } },
      variety: { rooms: { repeatedShare: 0.1 }, buildings: { repeatedShare: 0 }, brushModels: { repeatedShare: 0.3 } },
      light: { floor: { median: 60, darkShare: 0.1 } },
      furniture: { doors: 100, namedDoors: 90, disguisedDoors: 1, wallToggles: 0, hiddenNames: 2 },
    });
    const l4d2 = (name) => ({
      name,
      width: { median: 720 },
      withPropBoxes: { width: { median: 360 } },
      withPropCollision: { width: { median: 540 }, sight: { median: 1200 } },
      sight: { median: 3000 },
      crossing: { walked: 14400, ratio: 1.6 },
    });
    const tags = { kinds: { "rp-city": "", "coop-campaign": "", arena: "" }, groups: { tsrp: "rp-city", ts: "arena", l4d2: "coop-campaign" } };
    const corpora = {
      tsrp: { maps: [gold("a", city(1)), gold("b", city(2)), gold("c", city(3))] },
      ts: { maps: [gold("arena1")] },
      l4d2: { maps: [l4d2("m1"), l4d2("m2")] },
    };
    const { kinds } = S.styleBands(corpora, tags);
    const rp = kinds["rp-city"].bands;
    sure(rp.cityBuildings.band.median === 40 && rp.cityHomes.band.median === 10, `buildings ${rp.cityBuildings.band.median}`);
    near(rp.cityStreetWidth.band.median, 16, 0.01, "metres as measured");
    near(rp.cityStreetWidth.ph.median, 16 / 1.829, 0.01, "and player heights");
    sure(rp.cityHidden.band.median === 3, "hidden ways add up");
    sure(rp.crossing.band?.n === 3, "a city's start-to-farthest is its crossing");
    sure(!("cityBuildings" in kinds.arena.bands) && !("cityBuildings" in kinds["coop-campaign"].bands), "no city measure in other kinds");
    sure(!kinds["coop-campaign"].gaps.some((g) => /^city/.test(g.key)) && !kinds.arena.gaps.some((g) => /^city/.test(g.key)), "nor among their gaps");
    const coop = kinds["coop-campaign"].bands;
    near(coop.width.band.median, 540 * 0.0254, 0.01, "dressed by the props' collision, not their boxes");
    near(coop.width.bare.median, 720 * 0.0254, 0.01, "the bare world beside it");
    near(coop.sight.band.median, 1200 * 0.0254, 0.01, "sight too");
    // an older corpus with boxes alone still has a dressed width
    const old = S.styleBands({ l4d2: { maps: [{ ...l4d2("o"), withPropCollision: undefined }] } }, tags).kinds["coop-campaign"].bands;
    near(old.width.band.median, 360 * 0.0254, 0.01, "boxes where collision is lacking");
  });
}
