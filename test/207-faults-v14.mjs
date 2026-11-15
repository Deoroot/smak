// What a real room (the lounge, 2026-11-15) found wrong in 1.3, each held on the kit's own inputs: a face of more
// points than sdHLBSP reads is an error before the compile (L3); a model too heavy to draw as itself is said, not left
// out in silence (L4); a kit-made model's texture takes its set in the lit .glb (L6).
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import * as maps from "../check/maps/index.mjs";
import { mapGlb } from "../packs/gltf/gltf.mjs";
import { TWOROOMS, domes, GREYS } from "./fixture-gltf.mjs";
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

test("L6: in the lit way a model's texture takes its set when the set's picture is that texture, and is left out and said when not; baked bytes unchanged", () => {
  const tworooms = readFileSync(TWOROOMS);
  const corner = (index, s, t) => [index, 0, s, t];
  const palette = new Uint8Array(768).fill(200);
  writeFileSync(join(game, "models", "wedge.mdl"), smak.writeMdl({
    name: "wedge.mdl",
    bones: [{ name: "root", parent: -1 }],
    sequences: [{ name: "idle", fps: 10, frames: [[[0, 0, 0, 0, 0, 0]]] }],
    textures: [{ name: "lp_brass.bmp", width: 8, height: 8, pixels: new Uint8Array(64), palette, flags: 0 }],
    bodyparts: [{ name: "wedge", models: [{ name: "wedge", verts: [[32, 0, 0], [0, -8, 0], [0, 8, 0], [0, 0, 16]], vertBones: [0, 0, 0, 0], meshes: [{ skin: 0, norms: [[1, 0, 0]], normBones: [0], tris: [[corner(0, 0, 0), corner(3, 8, 0), corner(1, 0, 8)], [corner(0, 0, 0), corner(2, 8, 8), corner(3, 8, 0)], [corner(0, 0, 0), corner(1, 0, 8), corner(2, 8, 8)], [corner(1, 0, 8), corner(3, 8, 0), corner(2, 8, 8)]] }] }] }], // prettier-ignore
  }));
  const setFolder = (grey) => {
    const folder = join(tmp, `faults-v14-sets-${grey}`);
    mkdirSync(join(folder, "lp_brass.set"), { recursive: true });
    writeFileSync(join(folder, "lp_brass.png"), smak.png(8, 8, new Uint8Array(256).map((_, at) => (at % 4 === 3 ? 255 : grey))));
    const normal = domes();
    writeFileSync(join(folder, "lp_brass.set", "normal.png"), smak.png(normal.width, normal.height, normal.rgba));
    for (const [map, value] of Object.entries(GREYS)) writeFileSync(join(folder, "lp_brass.set", `${map}.png`), smak.png(32, 32, new Uint8Array(32 * 32 * 4).map((_, at) => (at % 4 === 3 ? 255 : value)))); // prettier-ignore
    writeFileSync(join(folder, "lp_brass.set", "material.json"), JSON.stringify({ texture: { name: "lp_brass" } }));
    return folder;
  };
  const bytes = maps.withEntities(tworooms, maps.addEntity(maps.readBsp(tworooms).entities, "env_model", [96, 96, 0], { model: "models/wedge.mdl" })); // prettier-ignore
  const jsonOf = (glb) => JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"));
  const brass = (made) => jsonOf(made.glb).materials.find((m) => /wedge\.mdl\/lp_brass/.test(m.name));
  const own = mapGlb(bytes, { folders: [game], light: "lit", sets: [setFolder(200)] });
  const m = brass(own);
  sure(own.facts.sets === 1 && m.normalTexture && m.pbrMetallicRoughness.metallicRoughnessTexture && m.pbrMetallicRoughness.metallicFactor === 1, JSON.stringify(m)); // prettier-ignore
  const other = mapGlb(bytes, { folders: [game], light: "lit", sets: [setFolder(90)] });
  sure(other.facts.sets === 0 && !brass(other).normalTexture && other.facts.notes.some((n) => /^lp_brass: the set in .* is not of this texture \(its lp_brass\.png differs by 110\.0\): left out$/.test(n)), other.facts.notes.join(" | ")); // prettier-ignore
  sure(Buffer.compare(mapGlb(bytes, { folders: [game], sets: [setFolder(200)] }).glb, mapGlb(bytes, { folders: [game] }).glb) === 0, "the baked way never reads a set"); // prettier-ignore
});
