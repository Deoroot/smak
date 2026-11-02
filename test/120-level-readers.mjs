// The level surveys' readers (levels/lib/), on small inputs made here, never a game's files: a Source model's
// collision (.phy) written and read back and a static prop placed by it in the lines a survey asks; Valve's
// ICE cipher against Kwan's published vectors (Left 4 Dead 2's .nuc scripts are Thin-ICE); a director
// script told an event or a mood by what it says; a GoldSrc map's lifts and its clip hulls past the file.
import { readPhy, writePhy } from "../levels/lib/phy.mjs";
import { solidOf, axesOf } from "../levels/lib/source-bsp.mjs";
import { iceEncrypt, iceDecrypt, NUC_KEY } from "../levels/lib/ice.mjs";
import { scriptSays } from "../levels/lib/director-script.mjs";
import { liftsOf, repairedOf } from "../levels/lib/goldsrc-level-measures.mjs";
import { test, sure } from "./helper.mjs";

const near = (a, b, within = 0.01) => Math.abs(a - b) <= within;
/** A box's eight corners and twelve triangles (wound any way: the reader faces planes outward itself). */
const boxHull = ([x0, y0, z0], [x1, y1, z1]) => ({
  points: [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
  triangles: [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 5, 1], [0, 4, 5], [1, 6, 2], [1, 5, 6], [2, 7, 3], [2, 6, 7], [3, 4, 0], [3, 7, 4]], // prettier-ignore
});

test("readPhy: a .phy of convex hulls written and read back, in the model's units and axes, planes outward", () => {
  for (const vphy of [true, false]) {
    const phy = readPhy(writePhy([[boxHull([-16, -8, 0], [16, 8, 40]), boxHull([20, -4, 0], [28, 4, 64])], [boxHull([0, 0, 0], [1, 1, 1])]], { vphy })); // prettier-ignore
    sure(phy.solids.length === 2 && phy.solids[0].hulls.length === 2 && phy.solids[1].hulls.length === 1, `${vphy}: solids and hulls ${phy.solids.map((s) => s.hulls.length)}`); // prettier-ignore
    const [a, b] = phy.solids[0].hulls;
    // IVP's metres and axes turned back: x stays, its z is the model's y, its -y the model's z
    sure([-16, -8, 0].every((v, k) => near(a.min[k], v)) && [16, 8, 40].every((v, k) => near(a.max[k], v)), `box: ${a.min} ${a.max}`); // prettier-ignore
    sure(near(b.max[2], 64) && near(phy.max[0], 28) && near(phy.min[0], -16), `the whole: ${phy.min} ${phy.max}`);
    // a box has six planes once each (two triangles a face), each with the middle behind it
    sure(a.planes.length === 24, `planes ${a.planes.length / 4}`);
    for (let p = 0; p < a.planes.length; p += 4) sure(a.planes[p + 2] * 20 < a.planes[p + 3], "outward: the middle (0, 0, 20) behind each plane");
  }
  let refused = "";
  try {
    readPhy(Buffer.alloc(8));
  } catch (error) {
    refused = error.message;
  }
  sure(/shorter than its header/.test(refused), refused);
});

test("solidOf: a static prop as its collision hulls, turned as it stands, stops a line where its hull is", () => {
  // no world asked for (mask 0): only the prop. A box 32 long (x) and 16 wide (y), turned 90 degrees
  const bsp = { models: [{ head: 0 }], displacements: [], brushes: new Int32Array(0) };
  const hulls = readPhy(writePhy([[boxHull([-16, -8, 0], [16, 8, 40])]])).solids[0].hulls;
  const solid = solidOf(bsp, { mask: 0, displacements: false, hulls: [{ origin: [100, 0, 0], angles: [0, 90, 0], hulls }] });
  sure(solid.hulls === 1, `hulls ${solid.hulls}`);
  // turned, it is 16 along x (92 to 108) and 32 along y: a line along x at z 20 meets it 92 from 0
  const along = solid.firstStop([0, 0, 20], [300, 0, 20]);
  sure(along !== null && near(along, 92, 0.05), `along x: ${along}`);
  // along y, from beside it: 16 to its face at y = -16
  const across = solid.firstStop([100, -32, 20], [100, 32, 20]);
  sure(across !== null && near(across, 16, 0.05), `along y: ${across}`);
  // over it, and from inside it (a line that begins inside does not meet it, as a brush), nothing
  sure(solid.firstStop([0, 0, 50], [300, 0, 50]) === null, "over it");
  sure(solid.firstStop([100, 0, 20], [300, 0, 20]) === null, "from inside");
  // straight up from under a prop raised off the floor: its underside
  const raised = solidOf(bsp, { mask: 0, displacements: false, hulls: [{ origin: [0, 0, 100], hulls }] });
  sure(near(raised.upward([0, 0, 8], 1000).distance, 92, 0.05), `up: ${raised.upward([0, 0, 8], 1000).distance}`);
  // Source's AngleMatrix: yaw 90 turns forward onto y
  const [forward, left] = axesOf([0, 90, 0]);
  sure(near(forward[1], 1) && near(left[0], -1), `axes ${forward} ${left}`);
});

test("ICE: Kwan's published vectors at levels 0, 1 and 2; a .nuc's text through Thin-ICE and back, a short tail left as it is", () => {
  const key = (hex) => Buffer.from(hex, "hex").toString("latin1");
  const plain = Buffer.from("fedcba9876543210", "hex");
  const cases = [
    [0, "deadbeef01234567", "de240d83a00a9cc0"],
    [1, "deadbeef01234567", "7d6ef1ef30d47a96"],
    [2, "00112233445566778899aabbccddeeff", "f94840d86972f21c"],
  ];
  for (const [level, k, want] of cases) {
    const got = iceEncrypt(plain, key(k), { level });
    sure(got.toString("hex") === want, `level ${level}: ${got.toString("hex")}, not ${want}`);
    sure(iceDecrypt(got, key(k), { level }).equals(plain), `level ${level} back`);
  }
  const text = Buffer.from('DirectorOptions <- { MobSpawnMinTime = 3 }\n// 7 over'); // not a multiple of 8
  const sealed = iceEncrypt(text, NUC_KEY);
  sure(!sealed.equals(text) && sealed.subarray(-(text.length % 8)).equals(text.subarray(-(text.length % 8))), "the tail kept");
  sure(iceDecrypt(sealed, NUC_KEY).equals(text), "back");
});

test("scriptSays: a director script an event (a panic, a mob spawned, mobs every 10 s or less) or a mood", () => {
  sure(scriptSays("DirectorOptions <- { MobSpawnMinTime = 3 MobSpawnMaxTime = 3 }").event, "a crescendo's tempo");
  sure(scriptSays("DirectorOptions <- { PanicForever = true }").event, "PanicForever");
  sure(scriptSays("ZSpawn({ type = 10, pos = Vector(0,0,0) });").event, "a mob spawned");
  const ambient = scriptSays("DirectorOptions <- { AlwaysAllowWanderers = true MobSpawnMinTime = 60 }");
  sure(!ambient.event && ambient.mobEvery === 60, "an ambient script");
  sure(!scriptSays("DirectorOptions <- { ProhibitBosses = true }").event, "no bosses: a mood");
  sure(!scriptSays("// PanicForever = true\nDirectorOptions <- { ProhibitBosses = true }").event, "a comment says nothing");
});

test("liftsOf and repairedOf: a platrot ridden as a plat, a door and a train that move across left; a clip hull past the file emptied", () => {
  const model = (mins, maxs) => ({ mins, maxs, origin: [0, 0, 0], headNodes: [0, 0, 0, 0] });
  const entity = (pairs) => Object.entries(pairs);
  const bsp = {
    models: [model([-512, -512, -512], [512, 512, 512]), model([0, 0, 0], [64, 64, 8]), model([0, 0, 0], [8, 64, 96]), model([0, 0, 0], [64, 64, 8])], // prettier-ignore
    clipnodes: [{ plane: 0, children: [-1, -2] }],
    entities: [
      entity({ classname: "worldspawn" }),
      entity({ classname: "func_platrot", model: "*1", height: "128" }),
      entity({ classname: "func_door", model: "*2", angles: "0 90 0" }), // slides sideways
      entity({ classname: "func_train", model: "*3", target: "a" }),
      entity({ classname: "path_corner", targetname: "a", target: "b", origin: "32 32 4" }),
      entity({ classname: "path_corner", targetname: "b", target: "a", origin: "512 32 200" }), // up, but across too
    ],
  };
  const { bsp: ridden, lifts } = liftsOf(bsp);
  sure(lifts.platrots === 1 && lifts.doors === 0 && lifts.trains === 0 && lifts.trainsAcross === 1, JSON.stringify(lifts));
  const kind = (e) => e.find(([k]) => k === "classname")[1];
  sure(kind(ridden.entities[1]) === "func_plat" && ridden.entities[1].some(([k, v]) => k === "height" && v === "128"), "the platrot");
  sure(ridden.entities[2] === bsp.entities[2] && ridden.entities[3] === bsp.entities[3], "the door and the train as they were");
  sure(kind(bsp.entities[1]) === "func_platrot", "the map given is not changed");
  // a brush model whose clip hulls point past the clip nodes (1 here): taken as empty (-1)
  const broken = { ...bsp, models: [...bsp.models, { ...model([0, 0, 0], [8, 8, 8]), headNodes: [0, 1, 1, 0] }] };
  const repaired = repairedOf(broken);
  sure(repaired.repairs === 2 && repaired.models[4].headNodes.join() === "0,-1,-1,0" && broken.models[4].headNodes[1] === 1, `${repaired.repairs} ${repaired.models[4].headNodes}`); // prettier-ignore
  sure(repairedOf(bsp) === bsp, "a whole map as it was");
});
