// A new thing in a model a game already has: a submodel added to a bodypart that is not the last (the bases
// of those after it), `check` telling a wrong base, a piece laid on a submodel that is there (`addFitted`),
// an item put into every file of its family (`addItem`), `smak item`, and what `check` says of a model with
// more textures than the compiler's hundred.
//
// The game is made up here: a "view" file whose first bodypart holds the weapons (a club on the bone `hand`,
// a bow whose string's middle hangs on the bone `pull`, with an arrow beside it) and whose second holds two
// arms; and a "world" file with the club in each hand and on the floor.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import { bow, through } from "../kits/bowkit.mjs";
import { test, sure, checked, near, tmp, runSmak, runRefused, SMAK_CLI } from "./helper.mjs";

const folder = join(tmp, "items");
mkdirSync(join(folder, "game", "models"), { recursive: true });

/** a picture of one grey, cut to a palette, under a name */
const plain = (name, grey = 150, side = 16) =>
  smak.indexed({ width: side, height: side, rgb: new Uint8Array(side * side * 3).fill(grey) }, name);
/** a box from `a` to `b`: twelve triangles that face outwards, each corner on `bone` when one is told */
const boxTris = (a, b, bone) => {
  const P = (i, j, k) => [i ? b[0] : a[0], j ? b[1] : a[1], k ? b[2] : a[2]];
  const faces = [
    [P(1, 0, 0), P(1, 1, 0), P(1, 1, 1), P(1, 0, 1)],
    [P(0, 1, 0), P(0, 0, 0), P(0, 0, 1), P(0, 1, 1)],
    [P(1, 1, 0), P(0, 1, 0), P(0, 1, 1), P(1, 1, 1)],
    [P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1)],
    [P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1)],
    [P(0, 1, 0), P(1, 1, 0), P(1, 0, 0), P(0, 0, 0)],
  ];
  const uv = [[0, 1], [1, 1], [1, 0], [0, 0]]; // prettier-ignore
  return faces.flatMap((face, n) =>
    [[0, 1, 2], [0, 2, 3]].map((t) => t.map((i) => ({ p: face[i], uv: uv[i], group: n, bone }))), // prettier-ignore
  );
};
const refuses = (run, pattern) => {
  try {
    run();
  } catch (e) {
    return pattern.test(e.message) ? true : `it said: ${e.message}`;
  }
  return "it did not refuse";
};

const bones = [
  { name: "arm", parent: -1, pos: [0, 0, 10] },
  { name: "hand", parent: 0, pos: [8, 0, 0], rot: [0, 0, 0.3] },
  { name: "pull", parent: 0, pos: [8, -6, 0] },
  { name: "left", parent: -1, pos: [0, 12, 10], rot: [0.4, 0, 0] },
  { name: "floor", parent: -1, pos: [0, 0, 0], rot: [0, 1.2, 0] },
];
// the club: a long box out of the hand; the old bow: a stave on the hand, the middle of its string (a small
// box 5 units behind the stave) on `pull`, and an arrow of its own texture
const club = (bone) => boxTris([9, -1, 9], [29, 1, 11], bone);
const oldBow = [
  ...boxTris([8, -0.5, 0], [9, 0.5, 20], "hand"),
  ...boxTris([3, -0.2, 9.8], [3.4, 0.2, 10.2], "pull"),
];
const view = smak.buildMdl({
  name: "v_things.mdl",
  bones,
  bodyparts: [
    {
      name: "weapons",
      models: [
        { name: "club_ref", meshes: [{ tris: club("hand"), texture: plain("club.bmp") }] },
        {
          name: "bow_ref",
          meshes: [
            { tris: oldBow, texture: plain("bow.bmp", 90) },
            { tris: boxTris([3, -0.1, 10], [14, 0.1, 10.2], "pull"), texture: plain("arrow.bmp", 200) },
          ],
        },
      ],
    },
    {
      name: "arms",
      models: [
        { name: "bare", meshes: [{ tris: boxTris([0, -1, 9], [8, 1, 11], "arm"), texture: plain("arms.bmp", 120) }] }, // prettier-ignore
        { name: "sleeved", meshes: [{ tris: boxTris([0, -2, 8], [8, 2, 12], "arm"), texture: plain("arms.bmp", 120) }] }, // prettier-ignore
      ],
    },
  ],
});
const world = smak.buildMdl({
  name: "p_things.mdl",
  bones,
  bodyparts: [
    {
      name: "hands",
      models: [
        { name: "club_rhand", meshes: [{ tris: club("hand"), texture: plain("club.bmp") }] },
        { name: "club_lhand", meshes: [{ tris: boxTris([1, 11, 9], [21, 13, 11], "left"), texture: plain("club.bmp") }] }, // prettier-ignore
        { name: "club_floor", meshes: [{ tris: boxTris([-10, -1, 0], [10, 1, 2], "floor"), texture: plain("club.bmp") }] }, // prettier-ignore
      ],
    },
  ],
});
/** each bodypart's base, as the file has it */
const basesOf = (mdl) => smak.readMdl(mdl).bodyparts.map((part) => part.base);
/** the names of the submodels a body number shows */
const shown = (mdl, body) => {
  const info = smak.readMdl(mdl);
  return smak.bodyOf(mdl, body).map((model, part) => info.bodyparts[part].models[model].name).join(" + "); // prettier-ignore
};
/** a file with one bodypart's base written over */
const withBase = (mdl, part, base) => {
  const out = Buffer.from(mdl);
  out.writeInt32LE(base, out.readInt32LE(208) + part * 76 + 68);
  return out;
};
// a new piece: a short thick stick drawn along x at another size, with a picture of its own
const stick = () => ({
  tris: boxTris([0, -0.5, -0.5], [10, 0.5, 0.5]).map((tri) => tri.map(({ bone: _bone, ...corner }) => corner)),
  image: { width: 32, height: 32, rgb: new Uint8Array(32 * 32 * 3).fill(60) },
});

test("addModel: a submodel added to a bodypart that is not the last raises the bases after it", () => {
  sure(basesOf(view).join() === "1,2" && smak.basesByRule(view).join() === "1,2", "the fixture's bases");
  sure(shown(view, 3) === "bow_ref + sleeved", `body 3 before: ${shown(view, 3)}`);
  const added = smak.addModel(view, 0, "third");
  // the base is what a body number is divided by: with three weapons the arms are counted in threes
  sure(basesOf(added).join() === "1,3", `bases after: ${basesOf(added)}`);
  sure(smak.basesByRule(added).join() === "1,3", "the rule");
  sure(shown(added, 2) === "third + bare", `body 2 shows ${shown(added, 2)}`);
  sure(shown(added, 2 + 3) === "third + sleeved", `body 5 shows ${shown(added, 5)}`);
  sure(shown(added, 1 + 3) === "bow_ref + sleeved", `body 4 shows ${shown(added, 4)}`);
  // every pairing has a number of its own: six of them, 0 to 5
  sure(new Set([0, 1, 2, 3, 4, 5].map((body) => shown(added, body))).size === 6, "six pairings, six numbers");
  // the last bodypart added to changes no base; a base that was not by the rule is left alone
  sure(basesOf(smak.addModel(view, 1, "gloved")).join() === "1,2", "added to the last");
  sure(basesOf(smak.addModel(withBase(view, 1, 5), 0, "third")).join() === "1,5", "an odd base is left");
});

test("putBody and copyBody on the first of two bodyparts give a number that shows the new body", () => {
  const put = smak.putBody(view, { name: "stick_ref", bodypart: 0, tris: club(), texture: plain("s.bmp"), bone: "hand" }); // prettier-ignore
  sure(put.body === 2 && shown(put.mdl, put.body) === "stick_ref + bare", `putBody: ${shown(put.mdl, put.body)}`); // prettier-ignore
  sure(basesOf(put.mdl).join() === "1,3", `putBody's bases: ${basesOf(put.mdl)}`);
  const copied = smak.copyBody(view, "club_ref", "club_red", plain("red.bmp", 30));
  sure(basesOf(copied).join() === "1,3" && shown(copied, 2 + 3) === "club_red + sleeved", "copyBody");
  for (const mdl of [put.mdl, copied])
    sure(!checked(mdl).warnings.some((line) => /base/.test(line)), "check has nothing to say of them");
});

test("check: a base that is not the product of the counts before it is told, and a base of 0 refused", () => {
  sure(!checked(view).warnings.length && !checked(view).errors.length, "the fixture is clean");
  // what a tool left that raised the count and not the base: three weapons, the arms still counted in twos
  const stale = withBase(smak.addModel(view, 0, "third"), 1, 2);
  const told = checked(stale).warnings.filter((line) => /the bodypart arms has base 2/.test(line));
  sure(told.length === 1 && /its base is to be 3/.test(told[0]), `it said: ${checked(stale).warnings}`);
  sure(/show other submodels/.test(told[0]), "two arms: the numbers are wrong now");
  // with one submodel after it nothing shows yet, and that is said
  const single = smak.buildMdl({
    name: "one.mdl",
    bodyparts: [
      { name: "a", models: [{ name: "a0", meshes: [] }, { name: "a1", meshes: [] }] }, // prettier-ignore
      { name: "b", models: [{ name: "b0", meshes: [{ tris: club(), texture: plain("b.bmp") }] }] },
    ],
  });
  const waits = checked(withBase(single, 1, 1)).warnings.find((line) => /has base 1/.test(line));
  sure(waits && /waits for its second/.test(waits), `one submodel: ${waits}`);
  const none = checked(withBase(view, 1, 0));
  sure(none.errors.some((line) => /has base 0/.test(line)), `base 0: ${none.errors}`);
  sure(checked(stale, "xash").warnings.some((line) => /base 2/.test(line)), "for xash too");
});

test("addFitted: a piece laid on a submodel that is there, as a new one after the others", () => {
  const piece = stick();
  const fitted = smak.addFitted(view, { name: "stick_ref", piece, texture: { ...piece.image, name: "stick.bmp" }, like: "club_ref" }); // prettier-ignore
  sure(fitted.model === 2 && fitted.body === 2 && !fitted.kept, `model ${fitted.model}, body ${fitted.body}`);
  sure(fitted.report.like === "club_ref" && fitted.report.bone === "hand", `on ${fitted.report.bone}`);
  // drawn 10 long, the club is 20: the same length, the same place
  near(fitted.report.scale, 2, 1e-6, "scale");
  // (a stick of square section may lie turned about its length: its box is then a little off the club's)
  sure(fitted.report.boxOff < 0.5 && fitted.report.tris === 12, `box off by ${fitted.report.boxOff}`);
  const whole = smak.keptWhole(view, fitted.mdl);
  sure(whole.ok, whole.lines.filter((line) => !line.ok).map((line) => line.text).join("; ")); // prettier-ignore
  sure(/2=stick_ref/.test(whole.lines[0].text) && /base 2 -> 3/.test(whole.lines[1].text), whole.lines[1].text);
  for (const engine of ["goldsrc", "xash"]) {
    const report = checked(fitted.mdl, engine);
    sure(!report.errors.length && !report.warnings.length, `${engine}: ${[...report.errors, ...report.warnings]}`); // prettier-ignore
  }
  sure(smak.isEngineLayout(fitted.mdl), "laid out for a server");
  // the bodypart by its name, the thing by its number; a bone of another name is reached through the rest pose
  const byName = smak.addFitted(view, { name: "stick_ref", piece, texture: plain("stick.bmp"), bodypart: "weapons", like: 0 }); // prettier-ignore
  sure(byName.model === 2, "by name and number");
  const onArm = smak.addFitted(view, { name: "stick_arm", piece, texture: plain("stick.bmp"), like: 0, bone: "arm" }); // prettier-ignore
  const where = (mdl, body) => smak.box(smak.posed(mdl, { body, seq: null }).tris.filter((t) => t.where.bodypart === 0).flatMap((t) => t.c.map((c) => c.p))); // prettier-ignore
  const a = where(fitted.mdl, 2);
  const b = where(onArm.mdl, 2);
  sure(onArm.report.bone === "arm", "on the arm");
  for (let axis = 0; axis < 3; axis++) near(b.mn[axis], a.mn[axis], 1e-3, "at rest it stands where the other does"); // prettier-ignore
  // what is asked wrongly is refused in words
  sure(refuses(() => smak.addFitted(view, { name: "x", piece, texture: plain("x.bmp"), like: "sword_ref" }), /no submodel sword_ref to fit to/) === true, "no such thing"); // prettier-ignore
  sure(refuses(() => smak.addFitted(view, { name: "x", piece, texture: plain("x.bmp"), like: 0, bone: "tail" }), /no bone tail/) === true, "no such bone"); // prettier-ignore
  sure(refuses(() => smak.addFitted(view, { name: "x", piece, texture: plain("x.bmp"), like: 0, how: "glue" }), /how is outline, shield, bone/) === true, "no such way"); // prettier-ignore
  sure(refuses(() => smak.addFitted(view, { name: "x", piece, texture: plain("x.bmp"), like: 0, bodypart: "legs" }), /no bodypart legs/) === true, "no such bodypart"); // prettier-ignore
});

test("addFitted: a file that holds the thing already is refused, or kept when it is the same thing", () => {
  const piece = stick();
  const texture = plain("stick.bmp", 60);
  const once = smak.addFitted(view, { name: "stick_ref", piece, texture, like: 0 });
  sure(refuses(() => smak.addFitted(once.mdl, { name: "stick_ref", piece, texture, like: 0 }), /has a submodel called stick_ref already/) === true, "refused unless told"); // prettier-ignore
  const again = smak.addFitted(once.mdl, { name: "stick_ref", piece, texture, like: 0, existing: "same" });
  sure(again.kept && again.model === 2 && again.mdl === once.mdl, "the same thing: the file as it is");
  // another shape under the same name cannot be put where the old one is
  const thicker = { ...piece, tris: boxTris([0, -1, -1], [10, 1, 1]) };
  sure(refuses(() => smak.addFitted(once.mdl, { name: "stick_ref", piece: thicker, texture, like: 0, existing: "same" }), /is not what is made now/) === true, "another shape"); // prettier-ignore
  sure(refuses(() => smak.addFitted(once.mdl, { name: "stick_ref", piece, texture: plain("stick.bmp", 200), like: 0, existing: "same" }), /is not what is made now/) === true, "another picture"); // prettier-ignore
});

test("addFitted: a bow's string on the bone that draws it, and the old bow's arrow taken along", () => {
  const piece = bow({ L: 10, centre: through([[0, 0], [10, -2]]), thick: () => 0.4, wide: () => 0.4, sides: 4, stations: [0, 5, 10], paint: () => [0.4, 0.3, 0.2], string: { x: 9.5, drop: 0.3 } }); // prettier-ignore
  sure(piece.tris.flat().filter((corner) => corner.part === 1).length === 24, "the kit marks the string's middle");
  const texture = smak.indexed(smak.shrink(piece.image, 8), "newbow.bmp");
  const fitted = smak.addFitted(view, {
    name: "newbow_ref",
    piece,
    texture,
    like: "bow_ref",
    pick: /^bow\./,
    keep: /^arrow\./,
    rig: null,
    bones: [null, "pull"],
  });
  const info = smak.readMdl(fitted.mdl);
  const model = info.bodyparts[0].models[fitted.model];
  sure(model.meshes.map((mesh) => mesh.texture.name).join() === "newbow.bmp,arrow.bmp", "its meshes");
  const on = {};
  for (const tri of smak.readMesh(fitted.mdl, model, model.meshes[0]))
    for (const corner of tri) on[info.bones[corner.bone]] = (on[info.bones[corner.bone]] ?? 0) + 1;
  sure(on.pull === 24 && on.hand === piece.tris.length * 3 - 24, `corners by bone: ${JSON.stringify(on)}`);
  sure(fitted.report.carried === 1 && fitted.report.bones.join() === "hand,pull", "the report");
  // the arrow is the old bow's, corner for corner
  const arrowOf = (mdl, m) => JSON.stringify(smak.readMesh(mdl, m, m.meshes[1]).map((tri) => tri.map((c) => [c.p, c.bone]))); // prettier-ignore
  sure(arrowOf(fitted.mdl, model) === arrowOf(view, smak.readMdl(view).bodyparts[0].models[1]), "the arrow");
  // at rest the string's middle is one piece with its ends: no corner flew off with its bone
  const span = smak.box(smak.posed(fitted.mdl, { body: fitted.body, seq: null }).tris.filter((t) => t.tex.name === "newbow.bmp").flatMap((t) => t.c.map((c) => c.p))); // prettier-ignore
  sure(span.mx[2] - span.mn[2] < 21 && span.mx[0] - span.mn[0] < 8, `the new bow's box at rest: ${JSON.stringify(span)}`); // prettier-ignore
  // by the nearest corner alone: every corner takes a bone the old bow's corners are on
  const nearest = smak.addFitted(view, { name: "nb", piece: { ...piece, tris: piece.tris.map((tri) => tri.map(({ part: _part, ...corner }) => corner)) }, texture, like: "bow_ref", pick: /^bow\./, rig: "nearest" }); // prettier-ignore
  sure(nearest.report.bones.sort().join() === "hand,pull", `nearest: ${nearest.report.bones}`);
  sure(!checked(fitted.mdl).errors.length, "check");
});

// ── a family: the club's, in the two files ──
const FAMILY = {
  script: "items/club",
  constants: { MODEL_VIEW: "v_things.mdl", ANIM_PREFIX: "club" },
  numbers: { MODEL_VIEW_IDX: "view", MODEL_BODY_OFS: "world" },
  placements: [
    { group: "view", file: "models/v_things.mdl", bodypart: "weapons", like: "club_ref", bone: "hand", name: "{name}_ref", view: "first", seq: "idle" }, // prettier-ignore
    { group: "world", file: "models/p_things.mdl", like: "club_rhand", bone: "hand", name: "{name}_rhand", shrink: 2 }, // prettier-ignore
    { group: "world", file: "models/p_things.mdl", like: "club_lhand", bone: "left", name: "{name}_lhand", shrink: 2 }, // prettier-ignore
    { group: "world", file: "models/p_things.mdl", like: "club_floor", bone: "floor", name: "{name}_floor", shrink: 2 }, // prettier-ignore
  ],
};
const gameFiles = { "models/v_things.mdl": view, "models/p_things.mdl": world };
for (const [file, bytes] of Object.entries(gameFiles)) writeFileSync(join(folder, "game", file), bytes);

test("addItem: one item in every file and place of its family, and the numbers its script names", () => {
  const item = { name: "stick", piece: stick(), texture: "stick.bmp" };
  const result = smak.addItem((file) => gameFiles[file], item, FAMILY);
  sure([...result.files.keys()].join() === "models/v_things.mdl,models/p_things.mdl", "the files");
  sure(result.placed.map((place) => `${place.name}=${place.model}`).join() === "stick_ref=2,stick_rhand=3,stick_lhand=4,stick_floor=5", "the submodels"); // prettier-ignore
  sure(result.numbers.MODEL_VIEW_IDX === 2 && result.numbers.MODEL_BODY_OFS === 3, JSON.stringify(result.numbers)); // prettier-ignore
  sure(smak.itemConstants(result).join("|") === "const MODEL_VIEW v_things.mdl|const ANIM_PREFIX club|const MODEL_VIEW_IDX 2|const MODEL_BODY_OFS 3", smak.itemConstants(result).join("|")); // prettier-ignore
  // the picture is whole in the hands' file and half the size in the world's
  const sizeOf = (file) => smak.readMdl(result.files.get(file)).textures.find((t) => t.name === "stick.bmp").width; // prettier-ignore
  sure(sizeOf("models/v_things.mdl") === 32 && sizeOf("models/p_things.mdl") === 16, "the picture's sizes");
  for (const [file, mdl] of result.files) {
    sure(smak.keptWhole(gameFiles[file], mdl).ok, `${file}: what it had is as it was`);
    sure(!checked(mdl).errors.length && !checked(mdl).warnings.length, `${file}: check`);
  }
  // each on the bone its placement names, where the game's own lies
  sure(result.placed.map((place) => place.report.bone).join() === "hand,hand,left,floor", "the bones");
  sure(result.placed.every((place) => place.report.boxOff < 0.5), "each where the club is");
  // a second run on its own result changes nothing; unless told, it is refused
  const again = smak.addItem((file) => result.files.get(file), item, FAMILY, { reference: (file) => gameFiles[file], existing: "same" }); // prettier-ignore
  sure(again.kept && [...again.files].every(([file, mdl]) => mdl.equals(result.files.get(file))), "run twice");
  sure(again.numbers.MODEL_BODY_OFS === 3, "the same numbers");
  sure(refuses(() => smak.addItem((file) => result.files.get(file), item, FAMILY), /already/) === true, "refused"); // prettier-ignore
  // a file that holds only part of it: the rest would not follow on, and that is said
  const half = new Map(result.files);
  half.set("models/p_things.mdl", smak.addFitted(smak.addFitted(world, { name: "stick_rhand", piece: item.piece, texture: smak.indexed(smak.shrink(item.piece.image, 2), "stick.bmp"), like: "club_rhand" }).mdl, { name: "other", piece: item.piece, texture: "stick.bmp", like: 0 }).mdl); // prettier-ignore
  sure(refuses(() => smak.addItem((file) => half.get(file), item, FAMILY, { reference: (file) => gameFiles[file], existing: "same" }), /do not follow one another/) === true, "half made"); // prettier-ignore
  // the pictures: a pair a placement
  const sheet = smak.itemSheet(result.files.get("models/p_things.mdl"), result.placed.filter((place) => place.group === "world"), { width: 96, height: 96 }); // prettier-ignore
  sure(sheet.width === 192 && sheet.height === 288, `the sheet: ${sheet.width}x${sheet.height}`);
});

test("smak item: a piece from a module into a profile's family, checked and written", () => {
  const profile = join(folder, "profile.json");
  writeFileSync(profile, JSON.stringify({ name: "made-up", items: { club: FAMILY } }));
  const module = join(folder, "stick.mjs");
  writeFileSync(
    module,
    `const face = (a, b, c, d, n) => [[a, b, c], [a, c, d]].map((t) => t.map((p, i) => ({ p, uv: [i ? 1 : 0, i > 1 ? 1 : 0], group: n })));
export default () => ({ tris: [...face([0, 0, 0], [0, 1, 0], [10, 1, 0], [10, 0, 0], 0), ...face([0, 0, 1], [10, 0, 1], [10, 1, 1], [0, 1, 1], 1)], image: { width: 16, height: 16, rgb: new Uint8Array(768).fill(90) } });\n`,
  );
  const out = join(folder, "out");
  const said = runSmak("item", module, "--mod", profile, "--game", join(folder, "game"), "--family", "club", "--name", "slat", "-o", out, "--pictures"); // prettier-ignore
  sure(/added models\/v_things\.mdl slat_ref: submodel 2/.test(said), said);
  sure(/const MODEL_VIEW_IDX 2/.test(said) && /const MODEL_BODY_OFS 3/.test(said), "its script's lines");
  sure(!/FAIL|ERROR/.test(said), said);
  sure(/^PASS: slat added to 2 files; each checks for goldsrc and xash and keeps what it had$/.test(said.trim().split(/\r?\n/).pop()), said); // prettier-ignore
  const written = readFileSync(join(out, "models", "p_things.mdl"));
  sure(smak.readMdl(written).bodyparts[0].models.map((model) => model.name).slice(3).join() === "slat_rhand,slat_lhand,slat_floor", "the world file"); // prettier-ignore
  sure(existsSync(join(out, "pictures", "slat_v_things.png")), "the pictures");
  // on its own result: kept, the same bytes
  const again = runSmak("item", module, "--mod", profile, "--game", join(folder, "game"), "--family", "club", "--name", "slat", "-o", join(folder, "out2"), "--base", out); // prettier-ignore
  sure(/kept {2}models\/v_things\.mdl slat_ref/.test(again), again);
  sure(readFileSync(join(folder, "out2", "models", "p_things.mdl")).equals(written), "the same bytes");
  const none = runRefused(SMAK_CLI, "item", module, "--mod", profile, "--game", join(folder, "game"), "--family", "axe", "--name", "x", "-o", out); // prettier-ignore
  sure(none.code === 1 && /no family axe: club/.test(none.err), none.err);
  const bare = runRefused(SMAK_CLI, "item", module, "--family", "club", "--name", "x", "-o", out);
  sure(bare.code === 1 && /--mod <profile>/.test(bare.err), bare.err);
});

test("check: more textures than the compiler's hundred is said as what it is, for each engine", () => {
  const many = smak.buildMdl({
    name: "many.mdl",
    bodyparts: [
      {
        name: "body",
        models: [
          {
            name: "all",
            meshes: Array.from({ length: 101 }, (_, i) => ({ tris: club().slice(0, 2), texture: plain(`t${i}.bmp`, 100, 2) })), // prettier-ignore
          },
        ],
      },
    ],
  });
  const goldsrc = checked(many, "goldsrc");
  const told = goldsrc.warnings.find((line) => /^101 textures, more than 100/.test(line));
  sure(told && /the compiler's limit \(studiomdl's MAXSTUDIOSKINS\), not one found in an engine/.test(told), `goldsrc: ${goldsrc.warnings}`); // prettier-ignore
  sure(!goldsrc.errors.length, "no error");
  // Xash names 256 and uses it nowhere: under it nothing is said, over it a fact and no warning
  const xash = checked(many, "xash");
  sure(![...xash.warnings, ...xash.facts].some((line) => /more than/.test(line)), "xash, 101: nothing");
});

test("iconPicture: a long thing laid on the diagonal fills the tile, heavy end up; parts leave the arms out", () => {
  // a mace of sorts: a thin haft with a thick head at one end, lying along the floor bone's turned axes
  const mace = smak.buildMdl({
    name: "mace.mdl",
    bones,
    bodyparts: [
      {
        name: "hands",
        models: [
          {
            name: "mace_floor",
            meshes: [
              { tris: [...boxTris([-10, -0.5, 0], [10, 0.5, 1], "floor"), ...boxTris([7, -2, -1.5], [11, 2, 2.5], "floor")], texture: plain("m.bmp", 200) }, // prettier-ignore
            ],
          },
        ],
      },
    ],
  });
  const side = 120;
  const tile = smak.iconPicture(mace, { side, lie: "diagonal", margin: 0.1 });
  sure(tile.side === side && tile.rgb.length === side * side * 3, "the drawing's size");
  // what is drawn: its box, and how its pixels lie about their middle
  const inked = [];
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) if (tile.rgb[(y * side + x) * 3] > 0) inked.push([x, y]);
  const xs = inked.map((p) => p[0]);
  const ys = inked.map((p) => p[1]);
  const reach = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  sure(reach[0] >= 9 && reach[1] >= 9 && reach[2] <= 110 && reach[3] <= 110, `inside the margin: ${reach}`);
  sure(Math.max(reach[2] - reach[0], reach[3] - reach[1]) >= 90, `and filling it: ${reach}`);
  const mean = [xs.reduce((a, b) => a + b) / xs.length, ys.reduce((a, b) => a + b) / ys.length];
  // rising to the right: x and y of a picture (y grows downwards) go against one another
  const slant = inked.reduce((sum, p) => sum + (p[0] - mean[0]) * (p[1] - mean[1]), 0) / inked.length;
  sure(slant < -200, `from the lower left to the upper right: ${slant}`);
  // the head is the upper right end: more ink in the upper right quarter than in the lower left
  const quarter = (right, top) => inked.filter((p) => p[0] > 60 === right && p[1] < 60 === top).length;
  sure(quarter(true, true) > 1.5 * quarter(false, false), `head up: ${quarter(true, true)} against ${quarter(false, false)}`); // prettier-ignore
  const flipped = smak.iconPicture(mace, { side, lie: "diagonal", flip: true });
  const inkAt = (rgb, right, top) => { let n = 0; for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) if (rgb[(y * side + x) * 3] > 0 && x > 60 === right && y < 60 === top) n++; return n; }; // prettier-ignore
  sure(inkAt(flipped.rgb, false, false) > 1.5 * inkAt(flipped.rgb, true, true), "flip: head down");
  // as it stands: the camera told, the levels; and a brighter gain is brighter
  const plainView = { yaw: 30, pitch: 10, fov: 30, dist: 60 };
  const stood = smak.iconPicture(mace, { side: 60, view: plainView });
  const bright = smak.iconPicture(mace, { side: 60, view: plainView, levels: { gain: 1.2 } });
  const sum = (rgb) => rgb.reduce((a, b) => a + b, 0);
  sure(sum(stood.rgb) > 0 && sum(bright.rgb) > sum(stood.rgb) * 1.1, "levels");
  // reduced: each pixel the mean of those it covers
  const small = smak.reducedPicture(stood.rgb, 60, 4);
  sure(small.length === 15 * 15 * 3, "reduced size");
  near(sum(small) * 16, sum(stood.rgb), 1e-6 * sum(stood.rgb), "reduced keeps the light");
  // the weapon of a file with arms, alone: fewer pixels than with them, and render frames it by itself
  const withArms = smak.render(view, { body: 0, seq: "idle", yaw: 60, width: 80, height: 80, background: [0, 0, 0] }); // prettier-ignore
  const alone = smak.render(view, { body: 0, seq: "idle", yaw: 60, width: 80, height: 80, background: [0, 0, 0], parts: [0] }); // prettier-ignore
  const lit = (img) => { let n = 0; for (let i = 0; i < img.width * img.height; i++) if (img.rgba[i * 4]) n++; return n; }; // prettier-ignore
  sure(lit(alone) > 0 && lit(alone) !== lit(withArms), "parts");
  const icon = smak.iconPicture(view, { side: 60, lie: "diagonal", parts: [0] });
  sure(sum(icon.rgb) > 0, "an icon of the weapon alone");
  sure(refuses(() => smak.iconPicture(view, { lie: "upright" }), /lie is "diagonal" or left out/) === true, "a wrong lie"); // prettier-ignore
});
