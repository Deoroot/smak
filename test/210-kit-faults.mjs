// What an underground district (2026-11-15, built by an agent with the kit and its guides alone) found wrong in 1.4,
// each held on the kit's own inputs. D16 (a compile log read one way) is in 191-map-battery.mjs and the broken cases.
import * as smak from "../src/index.mjs";
import * as maps from "../check/maps/index.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, sure, HERE, tmp, runSmak } from "./helper.mjs";

const TEXTURES = { floor: "FLOOR", ceiling: "CEILING", wall: "WALL" };

test("D4: a rail's top, widened by the player's box into a strip the size of a room, is a fact with its place and its own area, not a room", () => {
  const hall = { worldspawn: {}, brushes: [...maps.carve([{ min: [0, 0, 0], max: [640, 400, 200] }], 16, TEXTURES), maps.box([64, 200, 0], [576, 204, 40], "WALL")], entities: [maps.playerStart([96, 64, 0], 0), maps.light([160, 128, 140])] }; // prettier-ignore
  const reach = maps.reachOf(hall);
  sure(!reach.warnings.length, reach.warnings.join(" | "));
  const said = reach.facts.find((fact) => /size of a room/.test(fact));
  sure(/^1 parts of the floor the size of a room are far narrower than a player: under a third of each has floor under a point \(the top of a rail, a beam or a ledge, widened by the player's 32-wide box that overhangs it; or a clip brush's top over nothing drawn\), and they are left out of the warning: about 320 200 40 \(floor z 40; \d+ square units, \d+ of them over floor\)$/.test(said ?? ""), said); // prettier-ignore
  sure(reach.parts[0].area >= 16384 && reach.parts[0].own < 8192, `${reach.parts[0].area} ${reach.parts[0].own}`);
});

test("D5: floor more than a step over the walked floor under it (a beam's top) is not walked floor; the dark floor in no room is in patches", () => {
  const tworooms = maps.readBsp(readFileSync(join(HERE, "fixtures", "tworooms.bsp")));
  // the fixture's floors are at 0: a walk that says its floor is 18 under a sample counts it, 19 under does not
  const lit = (under) => maps.lightReport(tworooms, { reach: { walked: () => under } }).floor.area;
  sure(lit(0) > 0 && lit(-18) === lit(0) && lit(-19) === 0 && lit(null) === 0, `${lit(0)} ${lit(-18)} ${lit(-19)} ${lit(null)}`);
  const byRoom = maps.lightReport(tworooms, { rooms: { first: { min: [0, 0, 0], max: [320, 208, 128] } } });
  sure(!byRoom.warnings.length && byRoom.patches.length === 1 && byRoom.patches[0].at.join(" ") === "56 352 0", JSON.stringify(byRoom.patches));
});

test("D3: smak form on a .bsp and on a .map says what it measured, how many of which class, and where the world is measured", () => {
  const last = (...args) => runSmak("form", ...args).trim().split("\n").pop();
  const compiled = last(join(HERE, "fixtures", "tworooms.bsp"));
  sure(compiled === "PASS: measured, with 3 warnings: the furniture of 1 brush-entity models (1 func_wall) and no more: a func_detail is world in a .bsp, and the world is not measured here. smak form on the .map measures the detail brushes; smak map-dressing on the .bsp measures the world's faces", compiled); // prettier-ignore
  const file = join(tmp, "d3.map");
  writeFileSync(file, maps.writeMap({ worldspawn: {}, brushes: maps.hollow([0, 0, 0], [256, 256, 128], 16, TEXTURES), entities: [maps.brushEntity("func_detail", [maps.box([32, 32, 0], [64, 64, 32], "WALL"), maps.box([96, 32, 0], [128, 64, 32], "WALL")]), maps.brushEntity("func_wall", [maps.box([160, 32, 0], [192, 64, 32], "WALL")])] })); // prettier-ignore
  const source = last(file);
  sure(/^PASS: measured, with \d warnings: 3 detail and entity brushes \(2 func_detail, 1 func_wall\) and the world's face area off the axes\. smak map-dressing on the \.bsp measures the compiled world$/.test(source), source); // prettier-ignore
  sure(smak.formOfBsp(maps.readBsp(readFileSync(join(HERE, "fixtures", "tworooms.bsp")))).classes.func_wall === 1, "formOfBsp's classes");
});

test("D2: a source's face area off the axes counts what is seen: carve's rock faces on each other and those to the void are left out", () => {
  const rock = maps.carve([{ min: [0, 0, 0], max: [256, 256, 128] }], 16, TEXTURES);
  const ramp = maps.wedge([64, 64, 0], [192, 192, 64], "+x", "WALL");
  // by hand: the ramp's slope 18318 of the 280462 square units a player sees (0.065); it was 0.024, with the rock's hidden faces
  const share = smak.nonAxialOfSource({ brushes: [...rock, ramp] });
  sure(share > 0.055 && share < 0.08, `the ramp in a carved room: ${share}`);
  sure(smak.nonAxialOfSource({ brushes: rock }) === 0, "a carved room alone has nothing off the axes");
  sure(smak.nonAxialOfSource({ brushes: [...rock, ramp, maps.box([48, 48, 0], [208, 208, 80], "WALL")] }) === 0, "a slope buried in a box is not seen");
  sure(smak.nonAxialOfSource({ brushes: [] }) === null, "no world brush: not measured");
});

test("D10: the planes a floor are the world's and its furniture's models', and over Valve's band the sentence does not say less clutter", () => {
  const tworooms = maps.readBsp(readFileSync(join(HERE, "fixtures", "tworooms.bsp")));
  const { counts, measures } = maps.measureDressing(tworooms);
  // the fixture's world has 15 planes and its one func_wall 6 of its own
  sure(counts.planes === 21 && Math.abs(measures.detail - 11.39) < 0.01, `${counts.planes} ${measures.detail}`);
  const crowded = maps.dressingOf(tworooms, { against: { name: "a band's", of: "a band set for the case", measures: { detail: { least: 1, median: 2, most: 3 } } } }).warnings.find((w) => /planes a 256/.test(w)); // prettier-ignore
  sure(/^dressing: planes a 256 x 256 of floor \(the world's and its furniture's\): 11\.39 \(a band's: 1 to 3, median 2\): over the 95th in 100 of a band set for the case; every chamfer, baluster and side of a round thing is a plane, and faces to draw: those that are the form asked for \(smak form\) stand; what repeats or is round is better a model, whose planes are not the map's; hold the count to the budget \(smak map-battery\)$/.test(crowded ?? ""), crowded); // prettier-ignore
});

// a picture of one colour a quarter: red, green over blue, white
const quarters = (width, height) => {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set(x < width / 2 ? (y < height / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]) : y < height / 2 ? [0, 255, 0, 255] : [255, 255, 255, 255], (y * width + x) * 4); // prettier-ignore
  return { width, height, rgba };
};
const at = (picture, x, y) => [...picture.rgba.subarray((y * picture.width + x) * 4, (y * picture.width + x) * 4 + 3)].join(" ");

test("pictureSheet: pictures of other sizes fitted into cells, a piece of one, a dark cell for none, one over another at an opacity, a PNG's bytes", () => {
  const wide = quarters(200, 100);
  const tall = quarters(50, 100);
  const sheet = maps.pictureSheet([wide, { picture: tall }, { picture: wide, crop: [100, 0, 200, 50] }, null, { picture: smak.png(200, 100, wide.rgba), over: quarters(100, 50), opacity: 0.5 }], { cols: 3, width: 100, height: 50 }); // prettier-ignore
  sure(sheet.width === 300 && sheet.height === 100, `${sheet.width}x${sheet.height}`);
  // the wide one fills its cell; the tall one stands in its middle between dark bars (25 wide of 100)
  sure(at(sheet, 20, 40) === "0 0 255" && at(sheet, 80, 40) === "255 255 255", `${at(sheet, 20, 40)} | ${at(sheet, 80, 40)}`);
  sure(at(sheet, 110, 25) === "24 24 28" && at(sheet, 145, 40) === "0 0 255" && at(sheet, 155, 40) === "255 255 255" && at(sheet, 190, 25) === "24 24 28", `${at(sheet, 110, 25)} | ${at(sheet, 145, 40)} | ${at(sheet, 155, 40)}`); // prettier-ignore
  // the piece is the green quarter alone, the cell after it dark, and a picture under itself is itself
  sure(at(sheet, 210, 40) === "0 255 0" && at(sheet, 290, 40) === "0 255 0" && at(sheet, 50, 75) === "24 24 28" && at(sheet, 120, 90) === "0 0 255", `${at(sheet, 210, 40)} | ${at(sheet, 50, 75)} | ${at(sheet, 120, 90)}`); // prettier-ignore
  const under = maps.pictureSheet([{ picture: quarters(40, 40), over: { width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 255]) }, opacity: 0.25 }], { cols: 1, width: 40, height: 40 });
  sure(at(under, 30, 30) === "191 191 191" && under.width === 40, at(under, 30, 30));
});

test("smak pictures and map-look on a picture: a sheet written with a piece and a picture over it; a picture in the map's place measured as a view", () => {
  const [a, b] = [join(tmp, "quarters-wide.png"), join(tmp, "quarters-tall.png")];
  writeFileSync(a, smak.png(200, 100, quarters(200, 100).rgba));
  writeFileSync(b, smak.png(50, 100, quarters(50, 100).rgba));
  const said = runSmak("pictures", a, b, "-o", join(tmp, "pictures.png"), "--crop", "all", "--crop", "0,0,25,50", "--over", a, "--opacity", "0.5", "--cols", "2", "--width", "100", "--height", "50"); // prettier-ignore
  sure(/pictures\.png {2}200x50 {2}2 pictures in one sheet, .*quarters-wide\.png laid over each at 0\.5/.test(said), said);
  const sheet = smak.unpng(readFileSync(join(tmp, "pictures.png")));
  // the second cell: the tall one's red quarter (its piece) under the wide one's blue: half of each
  sure(sheet.width === 200 && at(sheet, 140, 40) === "127 0 127", at(sheet, 140, 40));
  const look = runSmak("map-look", a, "--ref", a, "-o", join(tmp, "look-picture.png"));
  sure(/the reference and the picture .*quarters-wide\.png, each 200x100/.test(look) && /brightness: close: /.test(look) && /colours: close/.test(look), look);
});

test("D14: a uv given in texels is refused in a sentence that says what uv is, not a RangeError from the writer", () => {
  const texture = { name: "crate.bmp", width: 256, height: 256, pixels: new Uint8Array(65536), palette: new Uint8Array(768), flags: 0 };
  const model = (uvs) => smak.buildMdl({ name: "crate.mdl", bodyparts: [{ name: "body", models: [{ name: "crate", meshes: [{ tris: [[[0, 0, 0], [16, 0, 0], [0, 16, 0]].map((p, k) => ({ p, uv: uvs[k], bone: "root" }))], texture }] }] }] }); // prettier-ignore
  let said = "";
  try {
    model([[0, 0], [161.4, 0], [0, 255]]);
  } catch (error) {
    said = `${error.name}: ${error.message}`;
  }
  sure(said === "Error: a corner's uv is 0 255 on the 256 x 256 picture crate.bmp: uv is a share of the picture, 0 to 1 from its top left (past 1 it repeats), not texels: divide by the picture's width and height", said); // prettier-ignore
  // a share, and a texture repeated a few times, are built as before
  sure(model([[0, 0], [1, 0], [0, 1]]).length > 0 && model([[0, 0], [4, 0], [0, -3]]).length > 0, "a uv of 0 to 1 and one that repeats");
});
