// What is made of a file read (check/import-model.mjs): a prop's model at its true size or fitted, standing on its
// base; a piece for `addFitted` laid along +x with its grip found or told, a shield with its face away from its
// straps, the pictures of several materials on one sheet; the picture a piece wears in each file of a family;
// which picture beside a model is a material's.
import * as smak from "../src/index.mjs";
import { test, sure, near } from "./helper.mjs";
import { fbxBinary, globalSettings, model, geometry, material, connections, objects, CUBE_FACES } from "./fixture-import.mjs";

/** The eight points of a box from `a` to `b`, in the order of CUBE_FACES' cube. */
const boxPoints = (a, b) => [
  [a[0], a[1], a[2]], [b[0], a[1], a[2]], [b[0], b[1], a[2]], [a[0], b[1], a[2]],
  [a[0], a[1], b[2]], [b[0], a[1], b[2]], [b[0], b[1], b[2]], [a[0], b[1], b[2]],
]; // prettier-ignore
/** Several boxes as one mesh: their points and faces, and each face's material (the box's number). */
function boxes(list) {
  const points = [];
  const polygons = [];
  const materials = [];
  list.forEach(([a, b], n) => {
    const first = points.length;
    points.push(...boxPoints(a, b));
    for (const face of CUBE_FACES) {
      polygons.push(face.map((i) => first + i));
      materials.push(n);
    }
  });
  return { points, polygons, materials };
}
/** A file of one mesh of boxes, each box a material of its own; the file +y up, in centimetres. */
const boxFile = (list, names) =>
  fbxBinary([
    globalSettings({ unit: 1 }),
    objects(
      model(1, "thing", "Mesh"),
      geometry(2, "thing", { ...boxes(list), uv: { values: [0, 0, 1, 0, 1, 1, 0, 1], index: list.flatMap(() => CUBE_FACES.flatMap(() => [0, 1, 2, 3])) } }),
      ...names.map((name, n) => material(10 + n, name)),
    ),
    connections([1, 0], [2, 1], ...names.map((_, n) => [10 + n, 1])),
  ]);
/** A picture of one colour as a PNG. */
const flatPng = (side, colour) => {
  const rgba = new Uint8Array(side * side * 4);
  for (let i = 0; i < side * side; i++) rgba.set([...colour, 255], i * 4);
  return smak.png(side, side, rgba);
};
// a mace standing up (the file's +y): a handle 1 thick and 30 long, a head 6 wide on its top
const mace = smak.readFbx(boxFile([[[-0.5, 0, -0.5], [0.5, 30, 0.5]], [[-3, 30, -3], [3, 36, 3]]], ["wood", "iron"]));
const pictures = { wood: flatPng(32, [150, 100, 50]), iron: flatPng(16, [90, 90, 100]) };

test("importModel: a prop at its true size (a centimetre is 0.3937 units), standing on its base; and fitted", () => {
  const made = smak.importModel(mace, { name: "mace.mdl", pictures, origin: "base" });
  near(made.report.scale.factor, 0.3937, 1e-9, "units a centimetre");
  near(made.report.box.mn[2], 0, 1e-9, "its lowest point on z = 0");
  near(made.report.box.mx[2], 36 * 0.3937, 1e-6, "36 cm tall");
  near(made.report.box.mn[0] + made.report.box.mx[0], 0, 1e-9, "centred along x");
  sure(made.report.textures.length === 2 && made.report.textures.every((t) => t.from === "the picture given"), JSON.stringify(made.report.textures));
  for (const engine of ["goldsrc", "xash"]) sure(!smak.check(made.mdl, engine).errors.length, `${engine}: ${smak.check(made.mdl, engine).errors}`);
  const fitted = smak.importModel(mace, { name: "mace.mdl", pictures, fit: 72, origin: "centre" });
  near(fitted.report.box.mx[2] - fitted.report.box.mn[2], 72, 1e-6, "fitted: its longest side 72 units");
  near(fitted.report.box.mx[2] + fitted.report.box.mn[2], 0, 1e-6, "about its middle");
  sure(/fitted/.test(fitted.report.scale.said) && fitted.report.heavy === null, fitted.report.scale.said);
});

/** A triangle cut into 4^times, each corner's place and picture place halfway, what else it carries kept. */
function finer(tri, times) {
  if (!times) return [tri];
  const half = (a, b) => ({ ...a, p: a.p.map((v, k) => (v + b.p[k]) / 2), uv: a.uv.map((v, k) => (v + b.uv[k]) / 2), n: null }); // prettier-ignore
  const [a, b, c] = tri;
  const [ab, bc, ca] = [half(a, b), half(b, c), half(c, a)];
  return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]].flatMap((each) => finer(each, times - 1));
}

test("importModel and importPiece take triangles: a dense mace brought down, its size and its pictures kept", () => {
  // every face of the mace cut 64 times (24 faces: 1536 triangles), flat as it was
  const dense = { ...mace, groups: mace.groups.map((group) => ({ ...group, tris: group.tris.flatMap((tri) => finer(tri, 3)) })) }; // prettier-ignore
  const before = dense.groups.reduce((sum, group) => sum + group.tris.length, 0);
  sure(before === 1536, `${before} triangles`);
  const plain = smak.importModel(mace, { name: "mace.mdl", pictures, origin: "base" });
  const made = smak.importModel(dense, { name: "mace.mdl", pictures, origin: "base", triangles: 48 });
  sure(made.report.triangles <= 48 && /^1536 triangles brought down to \d+$/.test(made.report.fewer), `${made.report.triangles}: ${made.report.fewer}`); // prettier-ignore
  for (const axis of [0, 1, 2]) {
    near(made.report.box.mn[axis], plain.report.box.mn[axis], 1e-6, `its box, low end, axis ${axis}`);
    near(made.report.box.mx[axis], plain.report.box.mx[axis], 1e-6, `its box, high end, axis ${axis}`);
  }
  sure(made.report.textures.length === 2, "both pictures still worn");
  for (const engine of ["goldsrc", "xash"]) sure(!smak.check(made.mdl, engine).errors.length, `${engine}: ${smak.check(made.mdl, engine).errors}`);
  // asked for more than it has, it is as it was
  sure(smak.importModel(mace, { name: "mace.mdl", pictures, triangles: 5000 }).report.fewer === null, "no fewer than asked");
  const piece = smak.importPiece(dense, { pictures, triangles: 48 });
  sure(piece.tris.length <= 48 && piece.assumed.some((line) => /^1536 triangles brought down to/.test(line)), `${piece.tris.length}: ${piece.assumed.join(" | ")}`); // prettier-ignore
  sure(/whole number over 0/.test((() => { try { smak.fewerTriangles(dense, 0); } catch (error) { return error.message; } })()), "0 triangles refused"); // prettier-ignore
});

test("importPiece: a hafted weapon laid along +x from the butt, its handle's line on y = z = 0, two pictures on one", () => {
  const piece = smak.importPiece(mace, { pictures });
  sure(piece.haft === true && piece.as === "haft", `held as ${piece.as}`);
  near(piece.box.mn[0], 0, 1e-9, "the butt at x = 0");
  near(piece.box.mx[0], 36, 1e-9, "the head's top at x = 36");
  const head = piece.tris.flat().filter((corner) => corner.p[0] > 31);
  sure(head.length && Math.max(...head.map((corner) => Math.abs(corner.p[1]))) > 2.9, "the head is the wide end");
  near(Math.max(...piece.tris.flat().filter((c) => c.p[0] < 10).map((c) => Math.abs(c.p[1]))), 0.5, 1e-9, "the handle about y = 0");
  sure(piece.image.width === 48 && piece.image.height === 32, `one sheet of ${piece.image.width}x${piece.image.height}`);
  // the iron's corners are on the right of the sheet (from 32/48 to 1), the wood's on its left
  const ironU = piece.tris.flat().filter((c) => c.p[0] > 30.5).map((c) => c.uv[0]);
  sure(ironU.every((u) => u >= 32 / 48 - 1e-9), `iron's u from ${Math.min(...ironU)}`);
  sure(piece.assumed.some((line) => /length is taken along the file's z/.test(line)), piece.assumed.join(" | "));
  sure(piece.assumed.some((line) => /hafted/.test(line)) && piece.assumed.some((line) => /2 materials/.test(line)), "what it assumed is said");
});

test("importPiece: the grip told or flipped; the axis given with its sign", () => {
  const flipped = smak.importPiece(mace, { pictures, flip: true });
  const wideAt = (piece, low) =>
    Math.max(...piece.tris.flat().filter((c) => (low ? c.p[0] < 3 : c.p[0] > 33)).map((c) => Math.abs(c.p[1])));
  sure(wideAt(flipped, true) > 2.9 && wideAt(flipped, false) < 0.6, "flipped: the head at the butt's end");
  const toldHigh = smak.importPiece(mace, { pictures, grip: "high" });
  sure(wideAt(toldHigh, true) > 2.9, "--grip high: the hand at the head's end, as told");
  const minus = smak.importPiece(mace, { pictures, axis: "-z" });
  sure(wideAt(minus, true) > 2.9, "-z: the piece runs from the top of the file down");
  const plus = smak.importPiece(mace, { pictures, axis: "+z", as: "plain" });
  sure(plus.as === "plain" && !plus.haft && wideAt(plus, false) > 2.9, "+z, plain: as the file stands, no haft");
});

test("importPiece: a shield's face away from its straps, +x towards its narrow end, z = 0 its back", () => {
  // a board 20 long (the file's y), 12 wide (its x), 1 thick (its z), narrowed at its top by a second board,
  // and a strap behind it (towards the file's -z)
  const shield = smak.readFbx(
    boxFile(
      [
        [[-6, 0, 0], [6, 16, 1]],
        [[-3, 16, 0], [3, 20, 1]],
        [[-1, 6, -2], [1, 10, -1.5]],
      ],
      ["board", "top", "strap"],
    ),
  );
  const piece = smak.importPiece(shield, { as: "shield" });
  near(piece.box.mn[2], 0, 1e-9, "its back at z = 0");
  const strap = piece.tris.flat().filter((c) => c.p[2] < 0.6);
  const board = piece.tris.flat().filter((c) => c.p[2] > 1.4);
  sure(strap.length && board.length, "the strap behind the board, the board in front");
  // the narrow end towards +x: the top board is at high x
  const narrow = piece.tris.flat().filter((c) => c.p[0] > 7);
  sure(narrow.length && Math.max(...narrow.map((c) => Math.abs(c.p[1]))) <= 3 + 1e-9, "the narrow end at +x");
  sure(piece.assumed.some((line) => /away from its 1 loose pieces/.test(line)), piece.assumed.join(" | "));
  const over = smak.importPiece(shield, { as: "shield", flip: true });
  const overStrap = over.tris.flat().filter((c) => c.p[2] > 2);
  sure(overStrap.length, "flipped: the strap in front");
});

test("pieceTexture: a bought picture made no larger than 1024 / shrink (and 512) a side, else left as it is", () => {
  const piece = { image: { width: 2048, height: 1024, rgb: new Uint8Array(2048 * 1024 * 3).fill(90) } };
  const wear = smak.pieceTexture(piece, "thing.bmp");
  const world = wear({ shrink: 4 });
  const view = wear({ shrink: 1 });
  sure(world.width === 256 && world.height === 128 && world.name === "thing.bmp", `${world.width}x${world.height}`);
  sure(view.width === 512 && view.height === 256, `shrink 1: ${view.width}x${view.height} (512 at the most)`);
  const small = smak.pieceTexture({ image: { width: 64, height: 64, rgb: new Uint8Array(64 * 64 * 3) } }, "s.bmp")({ shrink: 4 });
  sure(small.width === 64, `a small one stays: ${small.width}`);
});

test("pictureBeside: the picture a material names, one called after it, the lone one, one whose name says colour", () => {
  const files = ["mace.fbx", "Material_Base_color.png", "Material_Normal.png", "wood.PNG", "readme.txt"];
  sure(smak.pictureBeside({ name: "x", picture: "C:\\art\\wood.tga" }, files)?.file === "wood.PNG", "by the name it gives, any ending");
  sure(smak.pictureBeside({ name: "Material", picture: null }, files)?.file === "Material_Base_color.png", "called after it, not its normal map");
  sure(smak.pictureBeside({ name: "other", picture: null }, ["a.fbx", "skin.png"])?.why === "the one picture beside the file", "the lone one");
  const said = smak.pictureBeside({ name: "other", picture: null }, ["a_albedo.png", "b.png", "a_roughness.png"]);
  sure(said?.file === "a_albedo.png", `the one that says colour: ${said?.file}`);
  sure(smak.pictureBeside({ name: "other", picture: null }, ["a.png", "b.png"]) === null, "two, and nothing to choose by: none");
});

test("addFitted takes an imported piece: laid on its handle over a club of a model made here", () => {
  const box = (a, b) =>
    CUBE_FACES.flatMap((face) => {
      const p = boxPoints(a, b);
      return [[0, 1, 2], [0, 2, 3]].map((t) => t.map((i) => ({ p: p[face[i]], uv: [0, 0] }))); // prettier-ignore
    });
  const plain = smak.indexed({ width: 8, height: 8, rgb: new Uint8Array(192).fill(120) }, "club.bmp");
  // a club: a handle along x and a fat head at its end
  const club = [...box([0, -0.5, -0.5], [20, 0.5, 0.5]), ...box([20, -2, -2], [26, 2, 2])];
  const src = smak.buildMdl({
    name: "view.mdl",
    bones: [{ name: "hand", parent: -1 }],
    bodyparts: [{ name: "weapons", models: [{ name: "club", meshes: [{ tris: club, texture: plain }] }] }],
  });
  const piece = smak.importPiece(mace, { pictures });
  const put = smak.addFitted(src, { name: "bought", piece, texture: smak.pieceTexture(piece, "bought.bmp")({ shrink: 2 }), like: "club" });
  sure(put.model === 1 && /on its handle/.test(put.report.turn), `${put.model} ${put.report.turn}`);
  sure(put.report.boxOff < 3, `the new one's box off the club's by ${put.report.boxOff}`);
  sure(!smak.check(put.mdl).errors.length, smak.check(put.mdl).errors.join("; "));
});
