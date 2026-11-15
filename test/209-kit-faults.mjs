// What an underground district (2026-11-15, built by an agent with the kit and its guides alone) found wrong in 1.4,
// each held on the kit's own inputs. D16 (a compile log read one way) is in 191-map-battery.mjs and the broken cases.
import * as smak from "../src/index.mjs";
import { test, sure } from "./helper.mjs";

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
