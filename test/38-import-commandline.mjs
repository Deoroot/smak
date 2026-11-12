// `smak import` (bin/smak.mjs over check/import-files.mjs): what is in a file, a prop written and checked with its
// picture found beside it, a folder made into props with a sheet and a table, a rigged file with its animation;
// and `smak item` taking a bought model in place of a module.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import { test, sure, tmp, runSmak, runRefused, SMAK_CLI } from "./helper.mjs";
import { fbxBinary, globalSettings, model, geometry, material, connections, objects, gltfBuilder, CUBE_POINTS, CUBE_FACES } from "./fixture-import.mjs";

const folder = join(tmp, "import");
mkdirSync(join(folder, "pack", "crate"), { recursive: true });
mkdirSync(join(folder, "pack", "ball"), { recursive: true });

/** A picture of one colour as a PNG. */
const flatPng = (side, colour) => {
  const rgba = new Uint8Array(side * side * 4);
  for (let i = 0; i < side * side; i++) rgba.set([...colour, 255], i * 4);
  return smak.png(side, side, rgba);
};
// a crate: a cube of 50 cm wearing "Material", with Material_Base_color.png beside it, as a bought pack has it
const crate = fbxBinary([
  globalSettings({ unit: 1 }),
  objects(
    model(1, "crate", "Mesh", [["Lcl Scaling", 25, 25, 25]]),
    geometry(2, "crate", { points: CUBE_POINTS, polygons: CUBE_FACES, uv: { values: [0, 0, 1, 0, 1, 1, 0, 1], index: CUBE_FACES.flatMap(() => [0, 1, 2, 3]) } }),
    material(3, "Material"),
  ),
  connections([1, 0], [2, 1], [3, 1]),
]);
writeFileSync(join(folder, "pack", "crate", "crate.fbx"), crate);
writeFileSync(join(folder, "pack", "crate", "Material_Base_color.png"), flatPng(64, [160, 110, 60]));
// a ball that is a .glb with its picture inside it: a cube will do
const ball = (() => {
  const g = gltfBuilder();
  const POSITION = g.accessor(CUBE_FACES.flatMap((face) => face.flatMap((i) => CUBE_POINTS[i].map((v) => v * 0.1))), "VEC3");
  const TEXCOORD_0 = g.accessor(CUBE_FACES.flatMap(() => [0, 1, 1, 1, 1, 0, 0, 0]), "VEC2");
  const indices = g.accessor(CUBE_FACES.flatMap((_, n) => [n * 4, n * 4 + 1, n * 4 + 2, n * 4, n * 4 + 2, n * 4 + 3]), "SCALAR", 5123);
  const image = g.image(flatPng(8, [20, 200, 20]), "image/png");
  Object.assign(g.json, {
    nodes: [{ name: "ball", mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION, TEXCOORD_0 }, indices, material: 0 }] }],
    materials: [{ name: "green", pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: image }],
  });
  return g.glb();
})();
writeFileSync(join(folder, "pack", "ball", "ball.glb"), ball);

test("smak import: what is in a file (meshes, materials and the picture found beside it, axes, units, its size)", () => {
  const said = runSmak("import", join(folder, "pack", "crate", "crate.fbx"));
  sure(/fbx 7400/.test(said) && /up \+y, front \+z \(GlobalSettings\)/.test(said), said);
  sure(/one is 0\.01 m \(UnitScaleFactor 1\)/.test(said), "its unit");
  sure(/crate: 12 triangles on 8 points; material Material/.test(said), "its mesh");
  sure(/material Material: Material_Base_color\.png, called after the material/.test(said), "its picture, found");
  sure(/at its true size: 0\.5 x 0\.5 x 0\.5 m, 19\.7 x 19\.7 x 19\.7 units/.test(said), "its size");
  const json = JSON.parse(runSmak("import", join(folder, "pack", "ball", "ball.glb"), "--json"));
  sure(json.format === "glb" && json.triangles === 12 && json.materials[0].inside === true, JSON.stringify(json).slice(0, 300));
});

test("smak import -o: a prop written with its picture, fitted, standing on its base; smak check passes it", () => {
  const out = join(folder, "crate.mdl");
  const said = runSmak("import", join(folder, "pack", "crate", "crate.fbx"), "-o", out, "--fit", "32", "--origin", "base", "--pictures");
  sure(/12 triangles on 8 points/.test(said) && /fitted: its longest side \(50 of the file's units\) made 32 units/.test(said), said);
  sure(/32\.0 x 32\.0 x 32\.0 units \(x y z\), from -16\.0 -16\.0 0\.0/.test(said), "fitted and on its base");
  sure(/Material\.bmp\s+64x64\s+material Material: the picture given/.test(said), "its texture");
  sure(/fit for goldsrc and xash/.test(said) && existsSync(join(folder, "crate.png")), "checked, and drawn");
  sure(/fit for goldsrc/.test(runSmak("check", out)), "smak check");
  const texture = smak.textureOf(readFileSync(out), 0);
  sure(texture.palette[0] > 100 && texture.palette[2] < 100, "the brown of its picture");
});

test("smak import <folder> -o <folder>: every model a prop, a sheet of them, a table", () => {
  const out = join(folder, "props");
  const said = runSmak("import", join(folder, "pack"), "-o", out, "--fit", "24");
  sure(/2 models in/.test(said) && /0 failed/.test(said), said);
  sure(existsSync(join(out, "crate", "crate.mdl")) && existsSync(join(out, "ball", "ball.mdl")), "by the same paths");
  sure(existsSync(join(out, "sheet.png")), "the sheet");
  const table = JSON.parse(readFileSync(join(out, "import.json"), "utf8"));
  sure(table.length === 2 && table.every((row) => row.triangles === 12 && row.pictures === 1 && !row.error), JSON.stringify(table));
  const sheet = smak.unpng(readFileSync(join(out, "sheet.png")));
  sure(sheet.width === 2 * 224 && sheet.height === 224, `the sheet ${sheet.width}x${sheet.height}`);
});

test("smak import --anim: a rigged file's skeleton and animations; refused without a file to read", () => {
  const g = gltfBuilder();
  const POSITION = g.accessor([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 2, 0, 1, 2, 0, 0, 3, 0], "VEC3");
  const JOINTS_0 = g.accessor([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], "VEC4", 5121);
  const WEIGHTS_0 = g.accessor(new Array(6).fill([1, 0, 0, 0]).flat(), "VEC4");
  const times = g.accessor([0, 0.5], "SCALAR");
  const turns = g.accessor([0, 0, 0, 1, 0, 0, Math.SQRT1_2, Math.SQRT1_2], "VEC4");
  Object.assign(g.json, {
    scenes: [{ nodes: [0, 2] }],
    nodes: [{ name: "hip", children: [1] }, { name: "neck", translation: [0, 2, 0] }, { name: "flag", mesh: 0, skin: 0 }],
    skins: [{ joints: [0, 1], inverseBindMatrices: g.accessor([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -2, 0, 1], "MAT4") }],
    meshes: [{ primitives: [{ attributes: { POSITION, JOINTS_0, WEIGHTS_0 } }] }],
    animations: [{ name: "Wave", samplers: [{ input: times, output: turns }], channels: [{ sampler: 0, target: { node: 1, path: "rotation" } }] }],
  });
  writeFileSync(join(folder, "flag.glb"), g.glb());
  const said = runSmak("import", join(folder, "flag.glb"), "-o", join(folder, "flag.mdl"), "--anim", "--fps", "10");
  sure(/2 bones/.test(said) && /animation wave: 6 frames at 10 a second/.test(said) && /fit for goldsrc and xash/.test(said), said);
  const strip = runSmak("strip", join(folder, "flag.mdl"), "--seq", "wave", "-o", join(folder, "flag.png"));
  sure(/flag\.png/.test(strip), strip);
  const none = runRefused(SMAK_CLI, "import", join(folder, "nothing.fbx"));
  sure(none.code === 1 && /no such file/.test(none.err), none.err);
  const folderAlone = runRefused(SMAK_CLI, "import", join(folder, "pack"));
  sure(folderAlone.code === 1 && /-o <folder>/.test(folderAlone.err), folderAlone.err);
});

test("smak item: a bought model in place of a piece module, laid on the game's own and checked", () => {
  // a made-up game: one view file whose first bodypart has a club (a handle and a head along x) on `hand`
  const game = join(folder, "game");
  mkdirSync(join(game, "models"), { recursive: true });
  const boxPoints = (a, b) => [
    [a[0], a[1], a[2]], [b[0], a[1], a[2]], [b[0], b[1], a[2]], [a[0], b[1], a[2]],
    [a[0], a[1], b[2]], [b[0], a[1], b[2]], [b[0], b[1], b[2]], [a[0], b[1], b[2]],
  ]; // prettier-ignore
  const box = (a, b) => CUBE_FACES.flatMap((face) => [[0, 1, 2], [0, 2, 3]].map((t) => t.map((i) => ({ p: boxPoints(a, b)[face[i]], uv: [0, 0] })))); // prettier-ignore
  const plain = smak.indexed({ width: 8, height: 8, rgb: new Uint8Array(192).fill(120) }, "club.bmp");
  writeFileSync(
    join(game, "models", "v_things.mdl"),
    smak.buildMdl({
      name: "v_things.mdl",
      bones: [{ name: "hand", parent: -1 }],
      bodyparts: [{ name: "weapons", models: [{ name: "club_ref", meshes: [{ tris: [...box([0, -0.5, -0.5], [20, 0.5, 0.5]), ...box([20, -2, -2], [26, 2, 2])], texture: plain }] }] }],
    }),
  );
  const profile = join(folder, "profile.json");
  const family = { title: "a club", numbers: { MODEL_VIEW_IDX: "view" }, placements: [{ group: "view", file: "models/v_things.mdl", like: "club_ref", bone: "hand", name: "{name}_ref", shrink: 2 }] };
  writeFileSync(profile, JSON.stringify({ name: "made-up", items: { club: family } }));
  // the mace of a bought pack: a handle and a head standing up, its picture beside it
  const points = [...boxPoints([-0.5, 0, -0.5], [0.5, 30, 0.5]), ...boxPoints([-3, 30, -3], [3, 36, 3])];
  const polygons = [...CUBE_FACES, ...CUBE_FACES.map((face) => face.map((i) => i + 8))];
  writeFileSync(
    join(folder, "mace.fbx"),
    fbxBinary([globalSettings(), objects(model(1, "mace", "Mesh"), geometry(2, "mace", { points, polygons }), material(3, "Material")), connections([1, 0], [2, 1], [3, 1])]),
  );
  const picture = join(folder, "mace_colour.png");
  writeFileSync(picture, flatPng(32, [90, 60, 30]));
  const said = runSmak("item", join(folder, "mace.fbx"), "--mod", profile, "--game", game, "--family", "club", "--name", "mace", "--texture", picture, "-o", join(folder, "items"));
  sure(/item: mace\.fbx: 24 triangles, a picture of 32x32, held as haft/.test(said), said);
  sure(/assumed: its grip is taken at the slimmer end/.test(said), "what it assumed");
  sure(/added models\/v_things\.mdl mace_ref: submodel 1, on hand as club_ref, 24 triangles, on its handle/.test(said), "laid on the club's handle");
  sure(/const MODEL_VIEW_IDX 1/.test(said) && !/FAIL|ERROR/.test(said), "its script's line, nothing wrong");
  const missing = runRefused(SMAK_CLI, "item", join(folder, "mace.fbx"), "--mod", profile, "--game", game, "--family", "club", "--name", "mace", "--texture", join(folder, "none.png"), "-o", join(folder, "items2"));
  sure(missing.code === 1 && /no such file/.test(missing.err), `a picture that is not there: ${missing.err}`);
});
