// What an underground district (2026-11-15, built by an agent with the kit and its guides alone) found wrong in 1.4,
// each held on the kit's own inputs. D16 (a compile log read one way) is in 191-map-battery.mjs and the broken cases.
import * as smak from "../src/index.mjs";
import * as maps from "../check/maps/index.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, sure, HERE } from "./helper.mjs";

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
