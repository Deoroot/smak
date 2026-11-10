// A model lit as GoldSrc lights one (maps/model-light.mjs): the light at a point (the sky's or the floor's), how it is
// split into ambient and shade, a vertex's light, the map's light tree and its bytes.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as smak from "../src/index.mjs";
import { test, sure, near } from "./helper.mjs";

const { maps } = smak;
const HERE = dirname(fileURLToPath(import.meta.url));

// a tree of one node, the plane z = 100: above it a leaf of sky, below it an open one; one face on it, 2 by 2
// samples, its texture's axes the world's x and y
const tiny = (sky = true) => ({
  head: 0,
  planes: [{ normal: [0, 0, 1], dist: 100 }],
  nodes: [{ plane: 0, children: [-1, -2], firstFace: 0, faceCount: 1 }],
  leaves: [sky ? maps.CONTENTS.SKY : maps.CONTENTS.EMPTY, maps.CONTENTS.EMPTY],
  faces: [{ s: [1, 0, 0, 0], t: [0, 1, 0, 0], originS: 0, originT: 0, width: 2, height: 2, at: 0 }],
  samples: Uint8Array.from([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]),
  sky: sky ? { rgb: [200, 100, 50], vec: [0, 0, -1] } : null,
});

test("lightAlong: the first lit face a line meets, at its nearest sample (R_RecursiveLightPoint); none, null", () => {
  const tree = tiny(false);
  const at = (x, y) => maps.lightAlong(tree, [x, y, 150], [x, y, -100]);
  sure(at(2, 3).rgb.join() === "10,20,30", JSON.stringify(at(2, 3)));
  near(at(2, 3).at[2], 100, 1e-9, "met on the plane");
  // nearest: 9 is the second sample across (16 x 0.56), 7 the first
  sure(
    at(9, 0).rgb.join() === "40,50,60" && at(7, 0).rgb.join() === "10,20,30",
    "rounded to the nearest sample",
  );
  sure(at(3, 12).rgb.join() === "70,80,90" && at(12, 12).rgb.join() === "100,110,120", "down the rows");
  sure(at(-1, 0) === null && at(17, 0) === null, "off the face: nothing");
  sure(maps.lightAlong(tree, [2, 3, 50], [2, 3, 10]) === null, "a line that crosses no plane meets nothing");
  // a face the walk passes through, and a lit one the compiler left dark
  tree.faces[0].at = maps.PASSED;
  sure(at(2, 3) === null, "passed through");
  tree.faces[0].at = maps.DARK;
  sure(at(2, 3).rgb.join() === "0,0,0", "dark");
});

test("lightAt: the sky's light when a line toward the sun comes to sky, else the floor's, leant by its gradient", () => {
  // below the plane, the sun straight up: the sky above it
  const sky = maps.lightAt(tiny(true), [4, 4, 50]);
  sure(sky.sky && sky.rgb.join() === "200,100,50" && sky.way.join() === "0,0,-1", JSON.stringify(sky));
  // above it, the floor's: its own sample, and its way down, leant by the floor's light 16 off on the diagonals: of
  // those only the -x -y one is on the face, so the light comes from that side, shining toward +x +y
  const floor = maps.lightAt(tiny(false), [16, 16, 120]);
  sure(!floor.sky && floor.rgb.join() === "100,110,120", JSON.stringify(floor));
  sure(floor.way[2] < -0.5 && floor.way[0] > 0 && floor.way[1] > 0, `the way: ${floor.way}`);
  near(Math.hypot(...floor.way), 1, 1e-9, "a unit way");
  // even light round it: straight down
  const even = { ...tiny(false), samples: new Uint8Array(12).fill(50) };
  const flat = maps.lightAt(even, [8, 8, 120]);
  sure(flat.way[2] < -0.99, `even light shines straight down: ${flat.way}`);
  // nothing under it: black
  sure(maps.lightAt(tiny(false), [500, 500, 120]).rgb.join() === "0,0,0", "no floor: black");
});

test("modelShade and vertexLight: v_direct shades, the rest ambient (128 at most, 255 the two); the modified hemisphere", () => {
  const s = maps.modelShade({ rgb: [100, 50, 0], way: [0, 0, -1] });
  near(s.shade, 90, 1e-9, "shade");
  near(s.ambient, 10, 1e-9, "ambient");
  sure(s.color.join() === "1,0.5,0", JSON.stringify(s.color));
  // a sky of 369: the ambient 36.9, the shade cut to 255 less it
  const bright = maps.modelShade({ rgb: [369, 369, 369], way: [0, 0, -1] });
  near(bright.ambient, 36.9, 1e-9, "ambient of a bright light");
  near(bright.ambient + bright.shade, 255, 1e-9, "255 at most");
  // facing the light: all; away: the ambient alone; side-on: the shade less its (0.495 / 1.495)
  const up = maps.vertexLight(s, [0, 0, 1]);
  const down = maps.vertexLight(s, [0, 0, -1]);
  const side = maps.vertexLight(s, [1, 0, 0]);
  near(up[0], 100 / 255, 1e-9, "facing it");
  near(down[0], 10 / 255, 1e-9, "away");
  near(side[0], (100 - 90 * (0.495 / 1.495)) / 255, 1e-9, "side-on");
  near(up[1], 50 / 255, 1e-9, "its colour");
});

test("skyLight: light_environment as TS sets sv_skycolor ((c x v / 255 / 114)^0.6 x 264) and sv_skyvec (its pitch turned)", () => {
  const bsp = {
    entities: [
      [
        ["classname", "light_environment"],
        ["_light", "255 255 255 200"],
        ["angles", "-90 0 0"],
      ],
    ],
  };
  const sky = maps.skyLight(bsp);
  sure(sky.rgb.join() === "369,369,369", sky.rgb.join());
  near(sky.vec[2], -1, 1e-9, "straight down");
  const leant = maps.skyLight({ entities: [[["classname", "light_environment"], ["_light", "114 0 0"], ["angles", "0 90 0"], ["pitch", "-30"]]] }); // prettier-ignore
  sure(leant.rgb.join() === "264,0,0", leant.rgb.join());
  near(leant.vec[1], Math.cos(Math.PI / 6), 1e-9, "toward +y");
  near(leant.vec[2], -0.5, 1e-9, "30 down");
  // an `angles` after the `pitch` sets the pitch again (ts_lobby's)
  const level = maps.skyLight({ entities: [[["classname", "light_environment"], ["_light", "114 0 0"], ["pitch", "-30"], ["angles", "0 90 0"]]] }); // prettier-ignore
  near(level.vec[2], 0, 1e-9, "level");
  sure(maps.skyLight({ entities: [] }) === null, "none");
});

test("lightTree: a map's floors give its lightmaps' own samples, every style at its level; its bytes read back", () => {
  const bsp = maps.readBsp(readFileSync(join(HERE, "fixtures", "tworooms.bsp")));
  const tree = maps.lightTree(bsp);
  // the floor under the start, found by hand: the lit face under (96, 96) and its sample there
  const point = [96, 96, 48];
  const hit = maps.lightAlong(tree, point, [96, 96, -2000]);
  let expected = null;
  for (let i = 0; i < bsp.faces.length && !expected; i++) {
    const lm = maps.faceLightmap(bsp, i);
    const n = maps.faceNormal(bsp, i);
    if (!lm || n[2] < 0.99) continue;
    const ti = bsp.texinfo[bsp.faces[i].texinfo];
    const p = [96, 96, hit.at[2]];
    const ds = p[0] * ti.s[0] + p[1] * ti.s[1] + p[2] * ti.s[2] + ti.s[3] - lm.originS;
    const dt = p[0] * ti.t[0] + p[1] * ti.t[1] + p[2] * ti.t[2] + ti.t[3] - lm.originT;
    if (ds < 0 || dt < 0 || ds > (lm.width - 1) * 16 || dt > (lm.height - 1) * 16) continue;
    const k = (Math.round(dt / 16) * lm.width + Math.round(ds / 16)) * 3;
    expected = [0, 1, 2].map((c) =>
      Math.min(lm.styles.reduce((sum, s) => sum + s.rgb[k + c] * 264, 0) >> 8, 255),
    );
  }
  sure(expected && hit.rgb.join() === expected.join(), `${hit.rgb} against ${expected}`);
  sure(
    hit.rgb.some((c) => c > 0),
    "lit",
  );
  const bytes = maps.lightTreeBytes(tree);
  sure(bytes.toString("latin1", 0, 4) === "SMLT" && bytes.readInt32LE(4) === 1, "SMLT, version 1");
  sure(bytes.readInt32LE(8) === tree.head && bytes.readInt32LE(12) === tree.planes.length && bytes.readInt32LE(28) === tree.samples.length, "the head and the counts"); // prettier-ignore
  const size = 56 + tree.planes.length * 16 + tree.nodes.length * 20 + tree.leaves.length * 4 + tree.faces.length * 52 + tree.samples.length; // prettier-ignore
  sure(bytes.length === size, `${bytes.length} bytes, not ${size}`);
  sure(
    Buffer.compare(bytes.subarray(bytes.length - tree.samples.length), Buffer.from(tree.samples)) === 0,
    "the samples last",
  );
});
