// What a real room (the lounge, 2026-11-15) found wrong in 1.3, each held on the kit's own inputs: a face of more
// points than sdHLBSP reads is an error before the compile (L3); a model too heavy to draw as itself is said, not left
// out in silence (L4).
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import * as maps from "../check/maps/index.mjs";
import { test, sure, tmp } from "./helper.mjs";

const TEXTURES = { floor: "FLOOR", ceiling: "CEIL", wall: "WALL" };
const room = (...more) => ({
  worldspawn: {},
  brushes: [...maps.hollow([0, 0, 0], [256, 256, 128], 16, TEXTURES), ...more],
  entities: [maps.playerStart([64, 64, 0], 0), maps.light([128, 128, 96])],
});

test("L3: a 48-sided circle carved and a 30-sided cylinder each name their faces of more than 28 points; 28 sides pass", () => {
  const crowded = (map) => maps.checkPlan(map, { leak: false }).errors.filter((e) => /more than 28 points/.test(e));
  const carved = maps.carvePlan([{ outline: maps.circle([0, 0], 256, { sides: 48 }), floor: 0, ceiling: 200 }], 32, TEXTURES);
  const said = crowded({ worldspawn: {}, brushes: carved, entities: [maps.playerStart([0, 0, 0], 0)] });
  sure(said.length === 1 && /^\d+ faces have more than 28 points, the most sdHLBSP reads \(MAXPOINTS .*world brush \d+ face \d \(FLOOR\) at .*: 48 points/.test(said[0]), said.join(" | ")); // prettier-ignore
  const can = crowded(room(maps.cylinder("z", [128, 128], 40, 0, 30, "WALL", { sides: 30 })));
  sure(/^2 faces .*: 30 points; .*: 30 points$/.test(can[0] ?? ""), can.join(" | "));
  sure(!crowded(room(maps.cylinder("z", [128, 128], 40, 0, 30, "WALL", { sides: 28 }))).length, "28 sides is what the compiler takes");
  sure(!crowded(room(maps.cylinder("z", [128, 128], 40, 0, 30, "CLIP", { sides: 30 }))).length, "a CLIP brush is no face the compiler draws");
});

// a model of 12 800 triangles (a strip of quads), and a small one, in a game folder of their own
const game = join(tmp, "faults-v14-game");
mkdirSync(join(game, "models"), { recursive: true });
const skin = smak.indexed({ width: 16, height: 16, rgb: new Uint8Array(16 * 16 * 3).fill(128) }, "grey.bmp");
const strip = (quads) => {
  const tris = [];
  for (let i = 0; i < quads; i++) {
    const [a, b, c, d] = [[i, 0, 0], [i + 1, 0, 0], [i + 1, 0, 8], [i, 0, 8]].map((p) => ({ p, uv: [0, 0] }));
    tris.push([a, b, c], [a, c, d]);
  }
  return smak.buildMdl({ name: "m.mdl", bodyparts: [{ name: "body", models: [{ name: "strip", meshes: [{ texture: skin, tris }] }] }], quiet: true }); // prettier-ignore
};
writeFileSync(join(game, "models", "heavy.mdl"), strip(6400));
writeFileSync(join(game, "models", "light.mdl"), strip(20));

test("L4: a model over 12000 triangles is said in the notes, by name and count, every time; a light one says nothing", () => {
  const thing = (model) => ({ number: 3, classname: "ts_model", origin: [0, 0, 0], model: null, modelFile: model, angles: [0, 0, 0], pose: {} });
  const heavy = maps.figuresOf([thing("models/heavy.mdl")], { models: true, folders: [game] });
  sure(!heavy.figures.get(3).surfaces, "drawn as its box");
  sure(heavy.notes.some((n) => /^1 models have more than 12000 triangles and are not drawn as themselves: .*left out where only what the game shows is drawn .*models\/heavy\.mdl \(12800\)$/.test(n)), heavy.notes.join(" | ")); // prettier-ignore
  const light = maps.figuresOf([thing("models/light.mdl")], { models: true, folders: [game] });
  sure(light.figures.get(3).surfaces && !light.notes.length, light.notes.join(" | "));
});
