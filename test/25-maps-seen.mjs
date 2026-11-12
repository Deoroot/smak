// What a map's pictures show of the game's own files: a model with its textures (a masked one's holes left
// open, an additive one added), stood as its entity's keys say; a sprite's frame turned to the eye, blended
// by its render mode; the sky's six sides; and a `{` texture's holes where the game gives them.
//
// The files are the kit's own, made here: a card of two triangles for a model, sprites written byte by
// byte, skies of plain colours. The map is the two rooms of test/fixtures. Every "it is drawn" has a case
// beside it where it is not: a file that is missing, a key that asks for what is not there.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import * as maps from "../check/maps/index.mjs";
import { test, sure, near, HERE, tmp, runSmak } from "./helper.mjs";

const FIXTURES = join(HERE, "fixtures");
const tworoomsBytes = readFileSync(join(FIXTURES, "tworooms.bsp"));
const tworooms = maps.readBsp(tworoomsBytes);
const folder = join(tmp, "maps-seen");
const game = join(folder, "game");
for (const each of ["models", "sprites", "gfx/env"]) mkdirSync(join(game, each), { recursive: true });
const inFolder = (name) => join(folder, name);

// ── the map (test/fixtures/README.md): room A is 192 x 192 x 128 from the origin, room C north of it ──
const EYE_IN_A = [96, 96, 16]; // looking along +y at what stands at y 160, 64 away: a unit is 5 pixels
const BEFORE_THE_EYE = [96, 160];
const EYE_IN_C = [96, 352, 16]; // the room with no light of its own
const BEFORE_THE_EYE_IN_C = [96, 416];
const BEFORE_THE_GRATE = [272, 352, 48];
const GRATE = 4; // the fixture's func_wall
const NORTH = 90; // yaw
const CENTRE = [320, 240];
/** A pixel of a view from `EYE_IN_A`: so many units to the right of its middle, and up. */
const pixelOf = (right, up) => [CENTRE[0] + right * 5, CENTRE[1] - up * 5];
const LEFT_HALF = pixelOf(-8, 0);
const RIGHT_HALF = pixelOf(8, 0);

// ── reading a picture ──
const pixelAt = (picture, [x, y]) => [
  ...picture.rgba.subarray((y * picture.width + x) * 4, (y * picture.width + x) * 4 + 3),
];
const sameColour = (a, b, slack = 0) => a.every((value, channel) => Math.abs(value - b[channel]) <= slack);
const isRed = ([red, green, blue]) => red > 1.5 * green && red > 1.5 * blue;
const isGreen = ([red, green, blue]) => green > 1.5 * red && green > 1.5 * blue;
const isWall = ([red, , blue]) => red > blue; // the fixture's wall is warm
const isGrate = ([, green, blue]) => blue > green;
const refuses = (run, pattern) => {
  try {
    run();
  } catch (e) {
    return pattern.test(e.message);
  }
  return false;
};
/** The fixture with more point entities: `[[classname, origin, keys]]`. */
function withEntities(list, bytes = tworoomsBytes) {
  let entities = maps.readBsp(bytes).entities;
  for (const [classname, origin, keys] of list) entities = maps.addEntity(entities, classname, origin, keys);
  return maps.readBsp(maps.withEntities(bytes, entities));
}
const view = (bsp, options = {}) =>
  maps.drawMap(bsp, { from: EYE_IN_A, yaw: NORTH, folders: [game], labels: false, ...options });

// ── the colours ──
const RED = [220, 40, 40];
const GREEN = [40, 200, 60];
const GREY = [60, 60, 60];
const BLUE = [0, 0, 255]; // what a hole is kept as in a palette
const HOLE = 255;
/** A palette with a few colours at its start and the hole's blue at its end. */
function paletteOf(...colours) {
  const palette = new Uint8Array(768);
  colours.forEach((colour, index) => palette.set(colour, index * 3));
  palette.set(BLUE, HOLE * 3);
  return palette;
}
const PALETTE = paletteOf([0, 0, 0], RED, GREEN, GREY);
const [RED_INDEX, GREEN_INDEX, GREY_INDEX] = [1, 2, 3];
const SIDE = 16;
/** A picture of 16 x 16 palette indices: `indexAt(x, y)` for each. */
const pixelsOf = (indexAt) =>
  Uint8Array.from({ length: SIDE * SIDE }, (_, at) => indexAt(at % SIDE, Math.floor(at / SIDE)));
const HALF_HOLES = pixelsOf((x) => (x < SIDE / 2 ? HOLE : RED_INDEX)); // its left half is holes
const ALL = (index) => pixelsOf(() => index);

// ── the model: a card that stands on its origin and faces +x, 32 wide and 32 high ──
const MASKED = 64;
const ADDITIVE = 32;
const textureOf = (name, pixels, flags = 0) => ({
  name,
  width: SIDE,
  height: SIDE,
  pixels,
  palette: PALETTE,
  flags,
});
/**
 * A card of two triangles in the plane x = 0, its picture's left at y -16 and its top at `high`. Its
 * triangles go round clockwise seen from +x, as a compiled model's do: it is seen from its front only.
 */
const cardOf = (name, high) => ({
  name,
  verts: [
    [0, -16, 0],
    [0, 16, 0],
    [0, 16, high],
    [0, -16, high],
  ],
  vertBones: [0, 0, 0, 0],
  meshes: [
    {
      skin: 0,
      norms: [[1, 0, 0]],
      normBones: [0],
      tris: [
        [
          [0, 0, 0, SIDE],
          [2, 0, SIDE, 0],
          [1, 0, SIDE, SIDE],
        ],
        [
          [0, 0, 0, SIDE],
          [3, 0, 0, 0],
          [2, 0, SIDE, 0],
        ],
      ],
    },
  ],
});
const RAISED = 40; // the second animation lifts the card this far
const cardModel = (name, textures, skins = null) =>
  smak.writeMdl({
    name,
    bones: [{ name: "root", parent: -1 }],
    sequences: [
      { name: "idle", fps: 10, frames: [[[0, 0, 0, 0, 0, 0]]] },
      { name: "raised", fps: 10, frames: [[[0, 0, RAISED, 0, 0, 0]]] },
    ],
    textures,
    skins,
    // body 0 is the card, body 1 one twice as tall
    bodyparts: [{ name: "card", models: [cardOf("low", 32), cardOf("tall", 64)] }],
  });
writeFileSync(
  join(game, "models", "card.mdl"),
  cardModel(
    "card.mdl",
    [textureOf("holes.bmp", HALF_HOLES, MASKED), textureOf("green.bmp", ALL(GREEN_INDEX))],
    [[0], [1]],
  ),
);
writeFileSync(
  join(game, "models", "glow.mdl"),
  cardModel("glow.mdl", [textureOf("glow.bmp", ALL(GREY_INDEX), ADDITIVE)]),
);
const CARD = "models/card.mdl";
/** The card as an entity that faces the eye of `EYE_IN_A` (its front, +x, turned to -y). */
const cardAt = (place, keys = {}) => [
  "env_model",
  [...place, 0],
  { model: CARD, angles: "0 270 0", ...keys },
];
/** The card as `figuresOf` reads an entity, at the origin. */
const thing = (pose = {}, more = {}) => ({
  number: 5,
  classname: "env_model",
  origin: [0, 0, 0],
  model: null,
  modelFile: CARD,
  angles: [0, 0, 0],
  pose,
  ...more,
});
const figureOf = (pose, more, options = {}) =>
  maps.figuresOf([thing(pose, more)], { models: true, folders: [game], ...options });
const boxOf = (figure) => [...figure.min, ...figure.max].map((value) => Math.round(value * 100) / 100);

test("a model in a view wears its texture, and a masked texture's holes show what is behind", () => {
  const plain = view(tworooms);
  const drawn = view(withEntities([cardAt(BEFORE_THE_EYE)]), { models: true });
  sure(
    drawn.facts.marked.some((each) => each.drawn === "model") &&
      /1 as their model, with its textures/.test(drawn.facts.notes.join()),
    drawn.facts.notes.join(" | "),
  );
  // its right half is the picture's red; its left half is holes: the wall behind, as with no model at all
  sure(isRed(pixelAt(drawn, RIGHT_HALF)), `the card's red: ${pixelAt(drawn, RIGHT_HALF)}`);
  sure(
    sameColour(pixelAt(drawn, LEFT_HALF), pixelAt(plain, LEFT_HALF)) && isWall(pixelAt(drawn, LEFT_HALF)),
    `the holes are not open: ${pixelAt(drawn, LEFT_HALF)} against the wall's ${pixelAt(plain, LEFT_HALF)}`,
  );
  sure(
    sameColour(pixelAt(drawn, pixelOf(20, 0)), pixelAt(plain, pixelOf(20, 0))) &&
      sameColour(pixelAt(drawn, pixelOf(8, 20)), pixelAt(plain, pixelOf(8, 20))),
    "it is drawn no wider or taller than it is: 32 x 32",
  );
  // a hole's blue is no part of the colour a model is given where it is drawn flat
  const { figures } = figureOf();
  sure(sameColour(figures.get(5).triangles[0].colour, RED), `${figures.get(5).triangles[0].colour}`);
  // seen from behind it is not there: the game draws a model's triangles from their front only
  const behind = view(withEntities([cardAt(BEFORE_THE_EYE)]), {
    models: true,
    from: [96, 188, 16],
    yaw: 270,
  });
  sure(
    !isRed(pixelAt(behind, pixelOf(-3, 0))) && !isRed(pixelAt(behind, pixelOf(3, 0))),
    "from behind, nothing",
  );
  // `entities: "game"`: only what is drawn as the game shows it. A monster beside the card is a box by
  // default, and is left out
  const crowd = withEntities([cardAt(BEFORE_THE_EYE), ["monster_zombie", [40, 160, 0], {}]]);
  const boxed = view(crowd, { models: true }).facts.marked;
  const asInGame = view(crowd, { models: true, entities: "game" }).facts.marked;
  sure(
    boxed.some((each) => each.drawn === "box") && asInGame.length === 1 && asInGame[0].drawn === "model",
    `as the game shows it: ${JSON.stringify(asInGame)}`,
  );
  // not asked for, or not there: a small box, and a sentence
  sure(
    view(withEntities([cardAt(BEFORE_THE_EYE)])).facts.marked.every((each) => each.drawn === "mark"),
    "without `models`, a mark",
  );
  const lost = view(withEntities([cardAt(BEFORE_THE_EYE, { model: "models/lost.mdl" })]), { models: true });
  sure(
    /1 models were not drawn: models\/lost\.mdl is in none of the folders given/.test(
      lost.facts.notes.join(),
    ) && !isRed(pixelAt(lost, RIGHT_HALF)),
    lost.facts.notes.join(" | "),
  );
});

test("the kit's own picture of a model leaves a masked texture's holes open, and adds an additive one", () => {
  // the card from its front: its left half (as the picture shows it) is holes, its right half red
  const BACKGROUND = [58, 62, 70];
  const size = { yaw: 0, pitch: 0, width: 200, height: 200 };
  const card = smak.render(readFileSync(join(game, "models", "card.mdl")), size);
  sure(
    sameColour(pixelAt(card, [70, 100]), BACKGROUND) && isRed(pixelAt(card, [130, 100])),
    `holes ${pixelAt(card, [70, 100])}, red ${pixelAt(card, [130, 100])}`,
  );
  // without the flag the same picture is solid: the hole's blue is drawn
  const solid = smak.render(cardModel("solid.mdl", [textureOf("solid.bmp", HALF_HOLES)]), size);
  sure(!sameColour(pixelAt(solid, [70, 100]), BACKGROUND), "with no flag, no holes");
  const glow = smak.render(readFileSync(join(game, "models", "glow.mdl")), size);
  sure(
    sameColour(
      pixelAt(glow, [130, 100]),
      BACKGROUND.map((value, channel) => value + GREY[channel]),
      1,
    ),
    `the background with ${GREY} added: ${pixelAt(glow, [130, 100])}`,
  );
});

test("an additive texture is added to what is behind it, and a model takes the light of its floor", () => {
  const plain = view(tworooms);
  const glowing = view(withEntities([cardAt(BEFORE_THE_EYE, { model: "models/glow.mdl" })]), {
    models: true,
  });
  const before = pixelAt(plain, RIGHT_HALF);
  const after = pixelAt(glowing, RIGHT_HALF);
  sure(
    after.every((value, channel) => Math.abs(value - Math.min(255, before[channel] + GREY[channel])) <= 1),
    `the wall's ${before} with ${GREY} added, not ${after}`,
  );
  // the lit room's card is brighter than the dark room's; with no light asked for they are the same
  const both = withEntities([cardAt(BEFORE_THE_EYE), cardAt(BEFORE_THE_EYE_IN_C)]);
  const lit = pixelAt(view(both, { models: true }), RIGHT_HALF);
  const dark = pixelAt(view(both, { models: true, from: EYE_IN_C }), RIGHT_HALF);
  sure(lit[0] > dark[0] + 30, `in the light ${lit}, in the dark ${dark}`);
  const unlit = { models: true, light: false };
  sure(
    sameColour(
      pixelAt(view(both, unlit), RIGHT_HALF),
      pixelAt(view(both, { ...unlit, from: EYE_IN_C }), RIGHT_HALF),
    ),
    "with `light: false` both are the texture, shaded alike",
  );
});

test("a model is stood as its entity's keys say: angles, body, skin, sequence and scale", () => {
  const { figures, notes } = figureOf();
  const rest = figures.get(5);
  sure(boxOf(rest).join() === "0,-16,0,0,16,32" && !notes.length, `as it is: ${boxOf(rest)}`);
  sure(
    rest.pose.body === 0 && rest.pose.scale === 1 && rest.surfaces.length === 2,
    JSON.stringify(rest.pose),
  );
  // the body: the second submodel is twice as tall
  sure(boxOf(figureOf({ body: "1" }).figures.get(5))[5] === 64, "body 1 is the tall card");
  // the skin: the second family wears the green picture
  sure(
    rest.surfaces[0].texture.name === "holes.bmp" &&
      figureOf({ skin: 1 }).figures.get(5).surfaces[0].texture.name === "green.bmp",
    "skin 1 wears green.bmp",
  );
  // the sequence: the second animation lifts it
  const raised = figureOf({ sequence: 1 }).figures.get(5);
  sure(boxOf(raised)[2] === RAISED && boxOf(raised)[5] === RAISED + 32, `raised: ${boxOf(raised)}`);
  // one it does not have is its first, and that is said
  const none = figureOf({ sequence: 7 });
  sure(
    boxOf(none.figures.get(5)).join() === boxOf(rest).join() &&
      /could not follow.*it has no animation 7 \(it has 2\)/.test(none.notes.join()),
    none.notes.join(" | "),
  );
  // the scale, about its origin; and not when the mod's drawing does not scale models
  const twice = figureOf({ scale: "2" });
  sure(boxOf(twice.figures.get(5)).join() === "0,-32,0,0,32,64", `${boxOf(twice.figures.get(5))}`);
  sure(
    boxOf(figureOf({ scale: "2" }, {}, { modelScale: false }).figures.get(5)).join() === boxOf(rest).join(),
    "modelScale: false",
  );
  // the angles. Yaw 90: its front looks along +y, and the card lies along x
  sure(boxOf(figureOf({}, { angles: [0, 90, 0] }).figures.get(5)).join() === "-16,0,0,16,0,32", "yaw 90");
  // pitch 90 lifts its front straight up: the card's top goes back along -x, and it lies flat
  const pitched = boxOf(figureOf({}, { angles: [90, 0, 0] }).figures.get(5));
  sure(pitched.join() === "-32,-16,0,0,16,0", `pitch 90: ${pitched}`);
  sure(
    sameColour(
      maps.turnOf([90, 0, 0]).map((row) => Math.round(row[0])),
      [0, 0, 1],
    ),
    "the front of a model pitched by 90 looks up",
  );
  // roll 90 turns it about its own front: its left side goes up
  const rolled = boxOf(figureOf({}, { angles: [0, 0, 90] }).figures.get(5));
  sure(rolled.join() === "0,-32,-16,0,0,16", `roll 90: ${rolled}`);
  // in a view: at twice the size it is 64 wide, and is where the card at its own size is not
  const high = pixelOf(24, 0);
  const bsp = withEntities([cardAt(BEFORE_THE_EYE, { body: 1, scale: 2, skin: 1 })]);
  sure(isGreen(pixelAt(view(bsp, { models: true }), high)), "the keys reach the picture");
  sure(!isGreen(pixelAt(view(bsp, { models: true, modelScale: false }), high)), "and modelScale: false");
});

// ── sprites ──
const [NORMAL, ADDS, INDEX_ALPHA, ALPHA_TEST] = [0, 1, 2, 3]; // how a sprite's palette is meant
const [UPRIGHT, , PARALLEL, ORIENTED] = [0, 1, 2, 3]; // how it is turned to the eye
/** One frame of 16 x 16 about its middle. */
const frameOf = (pixels) => ({ left: -SIDE / 2, up: SIDE / 2, width: SIDE, height: SIDE, pixels });
/** A sprite file, byte by byte. `group`: its frames are one group, as an animation's are in some files. */
function sprFile({ type = PARALLEL, format = NORMAL, frames, palette = PALETTE, group = false }) {
  const head = Buffer.alloc(40);
  head.write("IDSP", 0, "latin1");
  head.writeInt32LE(2, 4);
  head.writeUInt32LE(type, 8);
  head.writeUInt32LE(format, 12);
  head.writeFloatLE(SIDE, 16);
  head.writeInt32LE(SIDE, 20);
  head.writeInt32LE(SIDE, 24);
  head.writeInt32LE(group ? 1 : frames.length, 28);
  const colours = Buffer.alloc(2 + 768);
  colours.writeUInt16LE(256, 0);
  colours.set(palette, 2);
  const int = (value) => {
    const four = Buffer.alloc(4);
    four.writeInt32LE(value);
    return four;
  };
  const frameBytes = (frame) =>
    Buffer.concat([
      int(frame.left),
      int(frame.up),
      int(frame.width),
      int(frame.height),
      Buffer.from(frame.pixels),
    ]);
  const body = group
    ? [int(1), int(frames.length), Buffer.alloc(4 * frames.length), ...frames.map(frameBytes)]
    : frames.flatMap((frame) => [int(0), frameBytes(frame)]);
  return Buffer.concat([head, colours, ...body]);
}
const sprites = {
  "red.spr": { frames: [frameOf(ALL(RED_INDEX)), frameOf(ALL(GREEN_INDEX))] },
  "grey.spr": { format: ADDS, frames: [frameOf(ALL(GREY_INDEX))] },
  "holes.spr": { format: ALPHA_TEST, frames: [frameOf(HALF_HOLES)] },
  "board.spr": { type: ORIENTED, frames: [frameOf(ALL(RED_INDEX))] },
  "post.spr": { type: UPRIGHT, frames: [frameOf(ALL(RED_INDEX))] },
  "mist.spr": { format: INDEX_ALPHA, frames: [frameOf(pixelsOf((x) => (x < SIDE / 2 ? 0 : 255)))] },
};
for (const [name, sprite] of Object.entries(sprites))
  writeFileSync(join(game, "sprites", name), sprFile(sprite));
/** A sprite as an entity before the eye of `EYE_IN_A`, at the height of the eye: 32 x 32 at scale 2. */
const spriteAt = (name, keys = {}, classname = "env_sprite") => [
  classname,
  [...BEFORE_THE_EYE, EYE_IN_A[2]],
  { model: `sprites/${name}`, scale: 2, ...keys },
];
const ADDITIVE_MODE = { rendermode: 5, renderamt: 255 };

test("a sprite file is read: its kind, its palette and its frames, one by one or in a group", () => {
  const read = maps.readSpr(sprFile(sprites["red.spr"]));
  sure(read.type === "parallel" && read.format === "normal", `${read.type}, ${read.format}`);
  sure(
    read.frames.length === 2 && read.frames[0].width === SIDE && read.frames[0].left === -SIDE / 2,
    "two frames of 16 x 16 about their middle",
  );
  sure(
    read.frames[0].pixels[0] === RED_INDEX && read.frames[1].pixels[0] === GREEN_INDEX,
    "each frame's own pixels",
  );
  sure(sameColour([...read.palette.subarray(3, 6)], RED), "its palette");
  const grouped = maps.readSpr(sprFile({ ...sprites["red.spr"], group: true }));
  sure(
    grouped.frames.length === 2 && grouped.frames[1].pixels[0] === GREEN_INDEX,
    "a group's frames are listed one after another",
  );
  sure(
    maps.readSpr(sprFile(sprites["holes.spr"])).format === "alpha test" &&
      maps.readSpr(sprFile(sprites["board.spr"])).type === "oriented",
    "the kinds, in words",
  );
  // what is not a sprite, and one that is cut short
  const whole = sprFile(sprites["red.spr"]);
  sure(
    refuses(() => maps.readSpr(Buffer.from("IDST" + "\0".repeat(900), "latin1")), /does not begin with IDSP/),
    "a model is not a sprite",
  );
  sure(
    refuses(() => maps.readSpr(whole.subarray(0, whole.length - 20)), /cut short/),
    "one cut short is said to be",
  );
  const quake = Buffer.from(whole);
  quake.writeInt32LE(1, 4);
  sure(
    refuses(() => maps.readSpr(quake), /version 1: Half-Life's are version 2/),
    "Quake's version",
  );
});

test("a sprite is drawn as its frame, turned to the eye, at its scale", () => {
  const plain = view(tworooms);
  const drawn = view(withEntities([spriteAt("red.spr")]));
  sure(
    drawn.facts.marked.some((each) => each.drawn === "sprite") &&
      /1 as their sprite's first frame/.test(drawn.facts.notes.join()),
    drawn.facts.notes.join(" | "),
  );
  // a sprite is not lit: its red is the file's own, 32 units wide and high about its entity
  for (const at of [pixelOf(-14, 0), pixelOf(14, 0), pixelOf(0, 14), pixelOf(0, -14)])
    sure(sameColour(pixelAt(drawn, at), RED), `at ${at}: ${pixelAt(drawn, at)}`);
  for (const at of [pixelOf(-18, 0), pixelOf(18, 0), pixelOf(0, 18), pixelOf(0, -18)])
    sure(sameColour(pixelAt(drawn, at), pixelAt(plain, at)), `past its edge at ${at}`);
  // its scale, and the frame its entity asks for
  const small = view(withEntities([spriteAt("red.spr", { scale: 1 })]));
  sure(
    sameColour(pixelAt(small, pixelOf(6, 0)), RED) &&
      sameColour(pixelAt(small, pixelOf(10, 0)), pixelAt(plain, pixelOf(10, 0))),
    "at scale 1 it is 16 units wide",
  );
  sure(
    sameColour(pixelAt(view(withEntities([spriteAt("red.spr", { frame: 1 })])), CENTRE), GREEN),
    "frame 1 is the green one",
  );
  // it faces the eye from wherever it is looked at
  const aside = view(withEntities([spriteAt("red.spr")]), {
    from: [40, 110, 16],
    to: [...BEFORE_THE_EYE, 16],
  });
  sure(sameColour(pixelAt(aside, pixelOf(10, 0)), RED), "seen from one side it is as wide");
  // not wanted, or not there: a small box as before, and for the missing one a sentence
  sure(
    view(withEntities([spriteAt("red.spr")]), { sprites: false }).facts.marked.every(
      (each) => each.drawn === "mark",
    ),
    "sprites: false",
  );
  const lost = view(withEntities([spriteAt("lost.spr")]));
  sure(
    /1 sprites were not drawn: sprites\/lost\.spr is in none of the folders/.test(lost.facts.notes.join()) &&
      lost.facts.marked[0].drawn === "mark",
    lost.facts.notes.join(" | "),
  );
  writeFileSync(join(game, "sprites", "broken.spr"), sprFile(sprites["red.spr"]).subarray(0, 900));
  sure(
    /broken\.spr could not be read: .*cut short/.test(
      view(withEntities([spriteAt("broken.spr")])).facts.notes.join(),
    ),
    "a broken file is said, not thrown",
  );
});

test("a sprite is blended as its render mode says: whole, with holes, added, tinted, a glow", () => {
  const plain = view(tworooms);
  const wall = pixelAt(plain, RIGHT_HALF);
  const added = (colour, share = 1) =>
    wall.map((value, channel) => Math.min(255, value + colour[channel] * share));
  // additive: the wall with the sprite's colour added, by as much as `renderamt` says
  const full = pixelAt(view(withEntities([spriteAt("grey.spr", ADDITIVE_MODE)])), RIGHT_HALF);
  sure(sameColour(full, added(GREY), 1), `the wall's ${wall} with ${GREY} added, not ${full}`);
  const half = pixelAt(
    view(withEntities([spriteAt("grey.spr", { rendermode: 5, renderamt: 128 })])),
    RIGHT_HALF,
  );
  sure(sameColour(half, added(GREY, 128 / 255), 1), `at renderamt 128: ${half}`);
  // a colour of its entity tints it; 0 0 0 is no colour
  const tinted = pixelAt(
    view(withEntities([spriteAt("grey.spr", { ...ADDITIVE_MODE, rendercolor: "0 255 0" })])),
    RIGHT_HALF,
  );
  sure(sameColour(tinted, added([0, GREY[1], 0]), 1), `tinted green: ${tinted}`);
  const untinted = pixelAt(
    view(withEntities([spriteAt("grey.spr", { ...ADDITIVE_MODE, rendercolor: "0 0 0" })])),
    RIGHT_HALF,
  );
  sure(sameColour(untinted, full), "rendercolor 0 0 0 leaves it as it is");
  // faded to nothing, it is not there
  sure(
    sameColour(
      pixelAt(view(withEntities([spriteAt("grey.spr", { rendermode: 5, renderamt: 0 })])), RIGHT_HALF),
      wall,
    ),
    "renderamt 0",
  );
  // an alpha-test sprite has holes: the wall on its left half, its red on its right
  const holes = view(withEntities([spriteAt("holes.spr", { rendermode: 4, renderamt: 255 })]));
  sure(
    sameColour(pixelAt(holes, LEFT_HALF), pixelAt(plain, LEFT_HALF)) &&
      sameColour(pixelAt(holes, RIGHT_HALF), RED),
    "holes on the left, red on the right",
  );
  // index alpha: all its last colour, each pixel as solid as its index is high
  const mist = view(withEntities([spriteAt("mist.spr", { rendermode: 2, renderamt: 255 })]));
  sure(
    sameColour(pixelAt(mist, LEFT_HALF), pixelAt(plain, LEFT_HALF)) &&
      sameColour(pixelAt(mist, RIGHT_HALF), BLUE),
    `index alpha: ${pixelAt(mist, LEFT_HALF)} and ${pixelAt(mist, RIGHT_HALF)}`,
  );
  // a glow grows with its distance (64 away: 64 / 200 of its size, so 10 units wide and not 32) ...
  const glow = view(withEntities([spriteAt("grey.spr", { rendermode: 3, renderamt: 255 }, "env_glow")]));
  const inGlow = pixelOf(3, 0);
  const glowing = pixelAt(plain, inGlow).map((value, channel) => Math.min(255, value + GREY[channel]));
  sure(
    sameColour(pixelAt(glow, inGlow), glowing, 1) && sameColour(pixelAt(glow, RIGHT_HALF), wall),
    `a glow 64 away: ${pixelAt(glow, inGlow)} and ${pixelAt(glow, RIGHT_HALF)}`,
  );
  // ... and is hidden when something is before its middle: here, the wall between the rooms
  const hidden = view(
    withEntities([["env_glow", [96, 300, 16], { model: "sprites/grey.spr", rendermode: 3, renderamt: 255 }]]),
  );
  sure(Buffer.from(hidden.rgba).equals(Buffer.from(plain.rgba)), "a glow behind a wall is not drawn");
  // an env_sprite with a name and no `Start on` is off when the game starts: drawn, and said
  const off = view(withEntities([spriteAt("red.spr", { targetname: "flame" })]));
  sure(
    /1 sprites start switched off/.test(off.facts.notes.join()) && sameColour(pixelAt(off, CENTRE), RED),
    off.facts.notes.join(" | "),
  );
  sure(
    !/switched off/.test(
      view(withEntities([spriteAt("red.spr", { targetname: "flame", spawnflags: 1 })])).facts.notes.join(),
    ),
    "with `Start on`, nothing is said",
  );
});

test("a sprite lies as its kind says, and is marked on a plan", () => {
  const camera = { eye: [0, -100, 0], right: [1, 0, 0], up: [0, 0, 1], forward: [0, 1, 0] };
  const down = { eye: [0, 0, 100], right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1] };
  const spriteOf = (name, keys = {}) =>
    maps
      .spritesOf(
        [
          {
            number: 7,
            classname: "env_sprite",
            origin: [0, 0, 0],
            model: null,
            modelFile: `sprites/${name}`,
            angles: [0, 0, 0],
            pose: {},
            render: {},
            ...keys,
          },
        ],
        { folders: [game] },
      )
      .sprites.get(7);
  const spanOf = (board, axis) => {
    const values = board.surface.polygon.map((corner) => corner[axis]);
    return Math.round(Math.max(...values) - Math.min(...values));
  };
  // parallel: it lies across the camera's own right and up, wherever the camera looks from
  const flat = maps.boardOf(spriteOf("red.spr"), down);
  sure(spanOf(flat, 0) === SIDE && spanOf(flat, 1) === SIDE && spanOf(flat, 2) === 0, "parallel, from above");
  // upright: it stands on z whatever the camera's pitch, and is not seen from straight above
  const post = spriteOf("post.spr");
  sure(post.type === "upright" && spanOf(maps.boardOf(post, camera), 2) === SIDE, "upright stands");
  sure(maps.boardOf(post, down) === null, "and from straight above it is edge on: not drawn");
  // oriented: it lies as its entity's angles say. Yaw 90: it looks along +y, so it is flat in y
  const board = maps.boardOf(spriteOf("board.spr", { angles: [0, 90, 0] }), camera);
  sure(
    spanOf(board, 1) === 0 && spanOf(board, 0) === SIDE && spanOf(board, 2) === SIDE,
    "oriented by its angles",
  );
  // on a plan: its dot, a cross through it, and what it is in the facts
  const bsp = withEntities([spriteAt("red.spr")]);
  const plan = maps.planOf(bsp, { folders: [game], labels: false });
  const mark = plan.facts.marks.find((each) => each.classname === "env_sprite");
  sure(mark.sprite === "sprites/red.spr" && mark.size === "32 x 32", JSON.stringify(mark));
  const other = maps.MARK_COLOURS.other;
  const arm = [mark.at[0] + 5, mark.at[1] + 5];
  sure(sameColour(pixelAt(plan, arm), other), `the cross's arm at ${arm}: ${pixelAt(plan, arm)}`);
  const noCross = maps.planOf(withEntities([["info_target", [...BEFORE_THE_EYE, 16], {}]]), {
    labels: false,
  });
  sure(!sameColour(pixelAt(noCross, arm), other), "an entity with no sprite has no cross");
});

// ── the sky ──
/** A Targa file of 24 bits, not packed, its rows from the bottom up: `colourAt(x, y)` from the top left. */
function tgaFile(side, colourAt) {
  const bytes = Buffer.alloc(18 + side * side * 3);
  bytes[2] = 2;
  bytes.writeUInt16LE(side, 12);
  bytes.writeUInt16LE(side, 14);
  bytes[16] = 24;
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const [red, green, blue] = colourAt(x, y);
      bytes.set([blue, green, red], 18 + ((side - 1 - y) * side + x) * 3);
    }
  return bytes;
}
// the four upright sides are one colour each, but `lf`, whose four quarters differ; the top and the bottom
const SKY = {
  rt: [10, 200, 10],
  lf: null,
  bk: [10, 10, 200],
  ft: [200, 200, 10],
  up: [250, 250, 250],
  dn: [30, 30, 30],
};
const QUARTERS = {
  topLeft: [200, 0, 0],
  topRight: [200, 100, 0],
  lowLeft: [100, 0, 0],
  lowRight: [100, 100, 0],
};
const quarterAt = (x, y) => QUARTERS[`${y < 4 ? "top" : "low"}${x < 4 ? "Left" : "Right"}`];
for (const [side, colour] of Object.entries(SKY))
  writeFileSync(join(game, "gfx/env", `smaksky${side}.tga`), tgaFile(8, colour ? () => colour : quarterAt));
/** The two rooms with their walls turned into sky (the texture's name written over), under `skyname`. */
function underSky(skyname = "smaksky") {
  const bytes = Buffer.from(tworoomsBytes);
  const wall = tworooms.textures.find((texture) => texture.name === "smakwall");
  bytes.fill(0, wall.at, wall.at + 16);
  bytes.write("sky", wall.at, "latin1");
  const entities = maps.setKey(maps.readBsp(bytes).entities, 0, "skyname", skyname);
  return maps.readBsp(maps.withEntities(bytes, entities));
}
const MIDDLE_OF_A = [96, 96, 64];
const skyView = (bsp, yaw, options = {}) =>
  maps.drawMap(bsp, { from: MIDDLE_OF_A, yaw, folders: [game], entities: false, ...options });

test("the sky is its own picture where the game's folders have it, each side where the engine puts it", () => {
  const bsp = underSky();
  // looking along -x (the wall with no doorway) the side is `lf`, its left on the left and its top at the top
  const west = skyView(bsp, 180);
  sure(west.facts.sky === "smaksky", `facts.sky: ${west.facts.sky}`);
  sure(
    sameColour(pixelAt(west, [200, 140]), QUARTERS.topLeft, 2) &&
      sameColour(pixelAt(west, [440, 140]), QUARTERS.topRight, 2) &&
      sameColour(pixelAt(west, [200, 340]), QUARTERS.lowLeft, 2) &&
      sameColour(pixelAt(west, [440, 340]), QUARTERS.lowRight, 2),
    `lf's four quarters: ${pixelAt(west, [200, 140])} ${pixelAt(west, [440, 140])} ${pixelAt(west, [200, 340])} ${pixelAt(west, [440, 340])}`,
  );
  // +x is `rt` (asked beside its doorway), +y `bk`, -y `ft`
  for (const [yaw, side, at] of [[0, "rt", [40, 60]], [90, "bk", CENTRE], [270, "ft", CENTRE]]) // prettier-ignore
    sure(
      sameColour(pixelAt(skyView(bsp, yaw), at), SKY[side], 2),
      `yaw ${yaw} shows ${side}: ${pixelAt(skyView(bsp, yaw), at)}`,
    );
  // asked by a way alone: up and down, and a way between two sides takes the one it leans to
  const sky = maps.skyOf("smaksky", [game]);
  sure(
    sky.sides.length === 6 && sky.files.every((file) => /smaksky(rt|lf|bk|ft|up|dn)\.tga$/.test(file)),
    "six",
  );
  sure(
    sameColour(maps.skyColour(sky, 0, 0, 1), SKY.up) && sameColour(maps.skyColour(sky, 0, 0, -9), SKY.dn),
    "up and down",
  );
  sure(
    sameColour(maps.skyColour(sky, 1, 0.9, 0.2), SKY.rt) &&
      sameColour(maps.skyColour(sky, 1, 1.1, 0.2), SKY.bk),
    "between two sides",
  );
  // seen along -x, +y is to the right and +z up: `lf`'s top right quarter
  sure(sameColour(maps.skyColour(sky, -1, 0.5, 0.5), QUARTERS.topRight), "lf, to the right and up");
  // without the folders, with a colour asked for, with no `skyname`: a flat colour
  const flat = pixelAt(skyView(bsp, 180, { folders: [] }), [200, 140]);
  sure(
    sameColour(flat, pixelAt(skyView(bsp, 180, { folders: [] }), [440, 340])) &&
      !sameColour(flat, QUARTERS.topLeft, 2),
    `no folders: one colour, ${flat}`,
  );
  const asked = skyView(bsp, 180, { sky: [1, 2, 3] });
  sure(sameColour(pixelAt(asked, CENTRE), [1, 2, 3]) && asked.facts.sky === null, "a colour asked for");
  sure(skyView(bsp, 180, { sky: false }).facts.sky === null, "sky: false is the flat colour too");
  // a sky with a side missing is not drawn, and the view says which file it wanted
  const lost = skyView(underSky("nosuchsky"), 180);
  sure(
    lost.facts.sky === null &&
      /the sky's picture \(skyname nosuchsky\) is not drawn: gfx\/env\/nosuchskyrt\.tga \(or \.bmp\) is in none/.test(
        lost.facts.notes.join(),
      ) &&
      sameColour(pixelAt(lost, [200, 140]), flat),
    lost.facts.notes.join(" | "),
  );
  // a side may be a .bmp
  for (const side of maps.SKY_SIDES)
    writeFileSync(
      join(game, "gfx/env", `bmpsky${side}.bmp`),
      smak.bmp({
        width: 16,
        height: 16,
        pixels: ALL(side === "rt" ? RED_INDEX : GREEN_INDEX),
        palette: PALETTE,
      }),
    );
  sure(sameColour(pixelAt(skyView(underSky("bmpsky"), 0), [40, 60]), RED, 1), "a sky of .bmp files");
});

test("a Targa picture is read plain or packed, from the top or the bottom, and others are refused", () => {
  const plain = maps.readTga(tgaFile(8, quarterAt));
  sure(plain.width === 8 && plain.height === 8, "its size");
  sure(
    sameColour([...plain.rgb.subarray(0, 3)], QUARTERS.topLeft) &&
      sameColour([...plain.rgb.subarray((7 * 8 + 7) * 3)], QUARTERS.lowRight),
    "its rows are turned the right way up",
  );
  // the same picture stored from the top down
  const fromTop = tgaFile(8, (x, y) => quarterAt(x, 7 - y));
  fromTop[17] = 0x20;
  sure(Buffer.from(maps.readTga(fromTop).rgb).equals(Buffer.from(plain.rgb)), "rows from the top");
  // packed: a run of 4 pixels of one colour, then 2 pixels one by one, with a see-through channel
  const header = Buffer.alloc(18);
  header[2] = 10;
  header.writeUInt16LE(6, 12);
  header.writeUInt16LE(1, 14);
  header[16] = 32;
  const packed = Buffer.concat([
    header,
    Buffer.from([0x83, 3, 2, 1, 255]),
    Buffer.from([0x01, 6, 5, 4, 255, 9, 8, 7, 255]),
  ]);
  sure(
    [...maps.readTga(packed).rgb].join() === "1,2,3,1,2,3,1,2,3,1,2,3,4,5,6,7,8,9",
    `packed runs: ${[...maps.readTga(packed).rgb]}`,
  );
  // greys, and 8 bits with a palette
  const grey = Buffer.alloc(18 + 1);
  grey[2] = 3;
  grey.writeUInt16LE(1, 12);
  grey.writeUInt16LE(1, 14);
  grey[16] = 8;
  grey[18] = 77;
  sure([...maps.readTga(grey).rgb].join() === "77,77,77", "greys");
  const mapped = Buffer.alloc(18 + 6 + 1);
  mapped[1] = 1;
  mapped[2] = 1;
  mapped.writeUInt16LE(2, 5);
  mapped[7] = 24;
  mapped.writeUInt16LE(1, 12);
  mapped.writeUInt16LE(1, 14);
  mapped[16] = 8;
  mapped.set([0, 0, 0, 30, 20, 10], 18);
  mapped[24] = 1;
  sure([...maps.readTga(mapped).rgb].join() === "10,20,30", "a palette");
  // what is not read, in words
  const sixteen = tgaFile(8, quarterAt);
  sixteen[16] = 16;
  sure(
    refuses(() => maps.readTga(sixteen), /a Targa of kind 2 and 16 bits is not read/),
    "16 bits",
  );
  sure(
    refuses(() => maps.readTga(tgaFile(8, quarterAt).subarray(0, 60)), /cut short/),
    "one cut short",
  );
  sure(
    refuses(() => maps.readTga(Buffer.alloc(4)), /shorter than its header/),
    "no header",
  );
});

test("a `{` texture has its holes on an entity in render mode 4 only, as in the game", () => {
  const eye = { from: BEFORE_THE_GRATE, yaw: 180, light: false, width: 320, height: 240 };
  const doorway = (picture) => {
    const pixels = [];
    for (let y = 60; y < 180; y += 4)
      for (let x = 120; x < 200; x += 4) pixels.push(pixelAt(picture, [x, y]));
    return pixels;
  };
  // the fixture's grate is in render mode 4: room C's wall is seen through it, and nothing is said
  const open = maps.drawMap(tworooms, eye);
  sure(
    doorway(open).some((pixel) => !isGrate(pixel) && isWall(pixel)) &&
      !/holes filled/.test(open.facts.notes.join()),
    "render mode 4: holes",
  );
  // in any other mode the game fills the holes with the texture's last colour: so does the view, and says it
  const filled = maps.drawMap(
    maps.readBsp(maps.withEntities(tworoomsBytes, maps.setKey(tworooms.entities, GRATE, "rendermode", 0))),
    eye,
  );
  sure(doorway(filled).every(isGrate), "render mode 0: the wall behind is still seen through the grate");
  sure(
    /faces wear a `\{` texture on the world or on an entity whose render mode is not 4/.test(
      filled.facts.notes.join(),
    ),
    filled.facts.notes.join(" | "),
  );
});

test("map-view draws models (with --game, unasked), sprites and the sky from the --game folders, and takes them away when told", () => {
  const file = inFolder("seen.bsp");
  const entities = [cardAt([40, 160]), spriteAt("red.spr")].reduce(
    (list, [classname, origin, keys]) => maps.addEntity(list, classname, origin, keys),
    underSky().entities,
  );
  writeFileSync(file, maps.withEntities(underSky().bytes, entities));
  const place = ["--from", EYE_IN_A.join(","), "--yaw", String(NORTH), "--game", game];
  const said = runSmak("map-view", file, "-o", inFolder("seen.png"), ...place);
  sure(/marked: \d+ env_model at pixel \d+,\d+, its model 32 x 0 x 32/.test(said), said);
  sure(/marked: \d+ env_sprite at pixel \d+,\d+, its sprite 32 x 32 x 32/.test(said), said);
  const picture = smak.unpng(readFileSync(inFolder("seen.png")));
  sure(sameColour(pixelAt(picture, CENTRE), RED), "the sprite is in the picture");
  const without = runSmak(
    "map-view",
    file,
    "-o",
    inFolder("unseen.png"),
    ...place,
    "--no-models",
    "--no-sprites",
    "--sky",
    "1,2,3",
  );
  sure(!/its sprite/.test(without) && !/its model/.test(without), without);
  // the eye looks north at the wall that is sky now: with --sky it is that colour
  const flat = smak.unpng(readFileSync(inFolder("unseen.png")));
  sure(sameColour(pixelAt(flat, [40, 40]), [1, 2, 3]), `--sky 1,2,3: ${pixelAt(flat, [40, 40])}`);
  sure(
    sameColour(pixelAt(picture, [40, 40]), SKY.bk, 2),
    `the sky's own picture: ${pixelAt(picture, [40, 40])}`,
  );
  near(picture.width, 640, 0, "the picture's width");
});
