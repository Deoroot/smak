// Props on the floor (make/maps/props.mjs, propsOf's ground, the battery's props): a model's foot found from its own
// lowest points, the floor under each point of it, a prop that floats or stands over a slope or an edge warned of, and
// groundProps, which stands each prop of a compiled map on its floor (the two passes: compile, ground, write the
// entities). On the kit's two rooms (test/fixtures/tworooms.bsp) and brush source made here; with the compilers
// (VHLT_DIR), a ramp compiled, a prop across it warned of, grounded and quiet after.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../check/maps/index.mjs";
import { test, sure, HERE, tmp } from "./helper.mjs";

const tworooms = readFileSync(join(HERE, "fixtures", "tworooms.bsp"));
const prop = (origin, keys = {}) => [["classname", "ts_model"], ["origin", origin.join(" ")], ["model", "models/prop.mdl"], ...Object.entries(keys)]; // prettier-ignore
/** The two rooms with props added (the floor of the first is z 0): a map's bytes, as compiled. */
const withProps = (...props) => maps.withEntities(tworooms, [...maps.readBsp(tworooms).entities, ...props]);

test("footOf: a model's foot is its lowest points (two posts, not the banner between them); a box's is nine over its footprint", () => {
  const post = (x) => [[x, 0, 0], [x + 4, 0, 0], [x, 4, 100]];
  const banner = { min: [0, 0, 0], max: [204, 4, 120], triangles: [{ points: post(0) }, { points: post(200) }, { points: [[0, 0, 80], [204, 0, 80], [0, 4, 120]] }] }; // prettier-ignore
  const foot = maps.footOf(banner);
  sure(foot.every(([x]) => x <= 4 || x >= 200) && foot.some(([x]) => x === 0) && foot.some(([x]) => x === 204), JSON.stringify(foot));
  const box = maps.footOf({ min: [0, 0, 0], max: [100, 10, 10] });
  sure(box.length === 9 && box[0].join() === "10,1" && box[8].join() === "90,9", JSON.stringify(box));
});

test("floorsUnder: the floor under each point, from over a sunk foot; null with none within reach; Infinity in a wall", () => {
  // a ramp z = x / 2 from x 0, a wall from x 300
  const solid = ([x, , z]) => x >= 300 || (x >= 0 && z < x / 2);
  const floors = maps.floorsUnder(solid, [[40, 0], [200, 0], [-10, 0], [310, 0]], 50, 150);
  sure(Math.abs(floors[0] - 20) <= 1 && Math.abs(floors[1] - 100) <= 1 && floors[2] === null && floors[3] === Infinity, JSON.stringify(floors)); // prettier-ignore
});

test("propsOf: a prop over the floor floats, one half over a step stands over an edge, one on the floor is quiet", () => {
  const stepRoom = (x) => ({
    worldspawn: {},
    brushes: [...maps.hollow([0, 0, 0], [512, 512, 256], 16, "W"), maps.box([300, 0, 0], [512, 512, 32], "W")],
    entities: [maps.playerStart([100, 100, 0]), maps.pointEntity("ts_model", [x + 35, 200, 32], { model: "models/crate.mdl" })],
  });
  const crateAt = (x) => {
    const figures = new Map([[2, { min: [x, 180, 32], max: [x + 70, 220, 64], file: "models/crate.mdl" }]]);
    return maps.propsOf(stepRoom(x), { models: false, figures }).props.find((p) => p.number === 2);
  };
  const over = crateAt(260);
  sure(over.warnings.length === 1 && /^it stands over a slope or an edge: its foot is 32 over the floor at 6 of 9 points under it$/.test(over.warnings[0]), JSON.stringify(over)); // prettier-ignore
  sure(over.ground.low === 0 && over.ground.high === 32 && over.floats === null, JSON.stringify(over.ground));
  const on = crateAt(340);
  sure(!on.warnings.length && on.ground.most <= 1, JSON.stringify(on));
  // no game folders: a model is a small box on its origin, its file named
  const bsp = maps.readBsp(withProps(prop([160, 100, 40]), prop([240, 150, 0])));
  const { props } = maps.propsOf(bsp, {});
  const [up, down] = props.filter((p) => p.classname === "ts_model");
  sure(up.file === "prop.mdl" && up.warnings.join() === "it floats 40 over the floor" && !down.warnings.length, JSON.stringify([up, down])); // prettier-ignore
});

test("the battery: a prop off the floor is a warning with its class, model, place and gap, and a view of it", () => {
  const report = maps.mapBattery(withProps(prop([160, 100, 40]), prop([240, 150, 0])));
  const props = report.checks.find((c) => c.name === "props");
  sure(props.level === "WARN" && /^ts_model \d+ \(prop\.mdl\) at 160 100 40: it floats 40 over the floor$/.test(props.said), props.said);
  sure(report.views.some((view) => /^prop \d+ off the floor$/.test(view.name)), JSON.stringify(report.views));
  const quiet = maps.mapBattery(withProps(prop([240, 150, 0]))).checks.find((c) => c.name === "props");
  sure(quiet.level === "PASS" && /none over the floor/.test(quiet.said), quiet.said);
});

test("groundProps: each prop stood on the floor less its sink; a foot in a wall (past the map's edge) is not placed", () => {
  const bsp = maps.readBsp(tworooms);
  const entities = [
    maps.pointEntity("ts_model", [160, 100, 40], { model: "models/prop.mdl" }),
    maps.pointEntity("ts_model", [240, 150, -6], { model: "models/rock.mdl" }),
    maps.pointEntity("info_target", [100, 100, 40], { model: "models/prop.mdl" }),
    maps.pointEntity("ts_model", [5000, 0, 0], { model: "models/prop.mdl" }),
  ];
  const { placed, unplaced } = maps.groundProps(bsp, entities, { sink: { rock: 4, "*": 1 } });
  sure(placed.length === 2 && Math.abs(placed[0].z + 1) <= 0.6 && Math.abs(placed[1].z + 4) <= 0.6, JSON.stringify(placed));
  sure(unplaced.length === 1 && unplaced[0].number === 3 && /in solid/.test(unplaced[0].why), JSON.stringify(unplaced));
  // the map's own list, as pairs: the prop that floats grounded
  const own = maps.groundProps(maps.readBsp(withProps(prop([160, 100, 40]))));
  sure(own.placed.length === 1 && Math.abs(own.placed[0].z) <= 0.6 && own.placed[0].points === 9, JSON.stringify(own));
});

const compilers = process.env[maps.COMPILERS_VARIABLE] ? maps.findCompilers() : { found: false };
if (!compilers.found) console.log(`skip  a ramp compiled, a prop across it warned of, grounded and quiet\n      skipped: no compilers (name the folder of VHLT in ${maps.COMPILERS_VARIABLE} to run it)`); // prettier-ignore
else
  test("compiled: a prop across a ramp stands over a slope; grounded it is placed only within its tolerance, and is quiet", () => {
    const folder = join(tmp, "props-ground");
    mkdirSync(folder, { recursive: true });
    const wad = join(folder, "ground.wad");
    writeFileSync(wad, maps.writeWad([{ name: "WALL", image: { width: 16, height: 16, rgb: new Uint8Array(16 * 16 * 3).fill(120) } }]));
    // a ramp rising 128 over 128 from x 256, a shelf at 128 after it
    const brushes = [...maps.hollow([0, 0, 0], [512, 256, 256], 16, "WALL"), maps.wedge([256, 0, 0], [384, 256, 128], "+x", "WALL"), maps.box([384, 0, 0], [512, 256, 128], "WALL")]; // prettier-ignore
    const entities = [maps.playerStart([64, 128, 0], 0), maps.light([128, 128, 200], { brightness: 300 }), maps.pointEntity("ts_model", [320, 128, 80], { model: "models/crate.mdl" }), maps.pointEntity("ts_model", [100, 64, 30], { model: "models/crate.mdl" })]; // prettier-ignore
    const map = { worldspawn: { wad: [wad] }, brushes, entities };
    const file = join(folder, "ramp.map");
    writeFileSync(file, maps.writeMap(map));
    const made = maps.compileMap(file, { fast: true, compilers, wads: [wad], engine: "xash" });
    sure(made.bsp, made.errors.join("; "));
    const bytes = readFileSync(made.bsp);
    const bsp = maps.readBsp(bytes);
    const said = maps.propsOf(bsp, {}).props.filter((p) => p.classname === "ts_model").map((p) => p.warnings.join());
    sure(/^it stands over a slope or an edge: its foot is 2\d over the floor at [1-9] of 9 points under it$/.test(said[0]) && said[1] === "it floats 30 over the floor", said.join(" | ")); // prettier-ignore
    const strict = maps.groundProps(bsp, entities, { tolerance: 16 });
    sure(strict.unplaced.length === 1 && /^the floor rises 2\d across its foot, over the 16 it may \(too steep\)$/.test(strict.unplaced[0].why), JSON.stringify(strict.unplaced)); // prettier-ignore
    const { placed } = maps.groundProps(bsp, entities, { tolerance: 32 });
    sure(placed.length === 2 && Math.abs(placed[1].z) <= 0.6, JSON.stringify(placed));
    // the second pass: the entities written with their grounded z, and nothing over the floor
    const grounded = bsp.entities.map((entity, number) => {
      const at = placed.find((p) => p.number === number - 1);
      return at ? entity.map(([key, value]) => [key, key === "origin" ? [...at.origin.slice(0, 2), at.z].join(" ") : value]) : entity;
    });
    const after = maps.propsOf(maps.readBsp(maps.withEntities(bytes, grounded)), {}).props.filter((p) => p.classname === "ts_model");
    sure(after.every((p) => !p.warnings.length && p.floats === null), JSON.stringify(after.map((p) => [p.origin, p.warnings, p.ground])));
  });
