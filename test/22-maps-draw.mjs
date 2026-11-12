// Pictures of maps: the kit's own small map (test/fixtures) drawn from inside, from above and from its
// source, and looked at pixel by pixel where the picture has to show a known thing; then the map commands of
// the command line, what they print and what they refuse; and the MCP server's tools on a map.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import * as maps from "../check/maps/index.mjs";
import { test, testAsync, sure, near, HERE, tmp, runSmak, runRefused, SMAK_CLI } from "./helper.mjs";

const FIXTURES = join(HERE, "fixtures");
const mapFile = join(FIXTURES, "tworooms.bsp");
const sourceFile = join(FIXTURES, "tworooms.map");
const wadFile = join(FIXTURES, "tworooms.wad");
const tworooms = readFileSync(mapFile);
const bsp = maps.readBsp(tworooms);
const wantsWad = maps.readBsp(readFileSync(join(FIXTURES, "tworooms-wants-wad.bsp")));
const source = maps.readMap(readFileSync(sourceFile, "utf8"));
const folder = join(tmp, "maps-draw");
mkdirSync(folder, { recursive: true });
const inFolder = (name) => join(folder, name);

// ── the map as it was drawn (test/fixtures/README.md): places in units ──
const PLAYER_START = [96, 96, 40]; // in room A, looking along +y at the wall between the rooms
const EYES_OVER_START = 28;
const IN_ROOM_C = [96, 352, 64]; // the room with no light of its own
const IN_THE_WALL_BETWEEN_THE_ROOMS = [96, 224, 64];
const BEFORE_THE_GRATE = [272, 352, 48]; // in the corridor, level with the doorway of room C
const CORRIDOR_LIGHT = [272, 224, 104];
const START = 1; // the entities, by their numbers in the file
const CORRIDOR_LIGHT_ENTITY = 3;
const GRATE_WALL = 4;
const CUT_HEIGHT = 40;
const WHOLE_MAP = { min: [-16, -16], max: [336, 464] };

// ── reading a picture ──
/** The colour of one pixel, `[r, g, b]`. */
const pixelAt = (picture, x, y) => [
  ...picture.rgba.subarray((y * picture.width + x) * 4, (y * picture.width + x) * 4 + 3),
];
/** Every pixel of a rectangle about the picture's middle, `halfWide` and `halfHigh` each way. */
const middleOf = (picture, halfWide, halfHigh) => {
  const pixels = [];
  for (let y = picture.height / 2 - halfHigh; y < picture.height / 2 + halfHigh; y++)
    for (let x = picture.width / 2 - halfWide; x < picture.width / 2 + halfWide; x++)
      pixels.push(pixelAt(picture, x, y));
  return pixels;
};
/** The mean brightness of a picture, 0 to 255: green counts most, blue least. */
const brightnessOf = (picture) => {
  let sum = 0;
  for (let i = 0; i < picture.width * picture.height; i++)
    sum += 0.3 * picture.rgba[i * 4] + 0.59 * picture.rgba[i * 4 + 1] + 0.11 * picture.rgba[i * 4 + 2];
  return sum / (picture.width * picture.height);
};
const sameColour = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
/** True when `run` throws an error whose message matches `pattern`. */
const refuses = (run, pattern) => {
  try {
    run();
  } catch (e) {
    return pattern.test(e.message);
  }
  return false;
};
// the three textures, told apart by their colours: the wall is warm (red over blue), the floor has green
// over red, and the grate alone has blue over green
const isWall = ([red, , blue]) => red > blue;
const isGrate = ([, green, blue]) => blue > green;

test("a view from the player start shows the wall it faces, lit, and nothing of the room behind it", () => {
  const view = maps.drawMap(bsp);
  sure(view.width === 640 && view.height === 480 && view.rgba.length === 640 * 480 * 4, "640 x 480, as rgba");
  sure(
    view.facts.from.join() === [PLAYER_START[0], PLAYER_START[1], PLAYER_START[2] + EYES_OVER_START].join() &&
      view.facts.yaw === 90 &&
      view.facts.contents === "empty",
    `taken from the start's eyes, the way it faces: ${JSON.stringify(view.facts.from)} yaw ${view.facts.yaw}`,
  );
  sure(view.facts.pixels === 1 && view.facts.faces > 3, `every pixel shows a face: ${view.facts.pixels}`);
  sure(view.facts.missing.length === 0 && /^lightmaps/.test(view.facts.light), "its own textures and light");
  // straight ahead is the wall between the rooms: its warm stone, and not black
  const ahead = middleOf(view, 60, 60);
  sure(ahead.every(isWall), "the middle of the view is not all wall");
  sure(Math.min(...ahead.map((pixel) => pixel[0])) > 30, "the wall ahead is black: its light is missing");
  // room C is behind that wall: fewer faces are drawn than from inside the wall, where everything is
  const fromSolid = maps.drawMap(bsp, { from: IN_THE_WALL_BETWEEN_THE_ROOMS, yaw: 90 });
  sure(/the eye is in solid/.test(fromSolid.facts.notes.join()), "an eye in solid is said");
  sure(view.facts.faces < fromSolid.facts.faces, "the room that cannot be seen was drawn");
});

test("lit places are brighter than unlit ones, and the light's own colour and brightness can be asked for", () => {
  const lit = maps.drawMap(bsp, { from: [96, 96, 64], yaw: 180 });
  const unlit = maps.drawMap(bsp, { from: IN_ROOM_C, yaw: 180 });
  sure(
    lit.facts.brightness > unlit.facts.brightness * 1.5,
    `room A ${lit.facts.brightness}, room C ${unlit.facts.brightness}`,
  );
  near(brightnessOf(lit), lit.facts.brightness, 1.5, "facts.brightness is the picture's mean");
  sure(/the picture is dark/.test(unlit.facts.notes.join()), "a dark view is said to be dark");
  // without the light the dark room's walls are the texture as it is; with less brightness a view is darker
  const plain = maps.drawMap(bsp, { from: IN_ROOM_C, yaw: 180, light: false });
  sure(plain.facts.brightness > unlit.facts.brightness * 2, "light: false shows the textures as they are");
  const stored = maps.drawMap(bsp, { from: [96, 96, 64], yaw: 180, brightness: 1 });
  sure(stored.facts.brightness < lit.facts.brightness, "brightness: 1 is the samples as stored, darker");
});

test("the grate's holes show what is behind it", () => {
  const view = maps.drawMap(bsp, { from: BEFORE_THE_GRATE, yaw: 180, light: false });
  const doorway = middleOf(view, 100, 180);
  const bars = doorway.filter(isGrate).length / doorway.length;
  // the picture's bars are 3 pixels in every 8, each way: they cover 61 in 100
  sure(bars > 0.45 && bars < 0.75, `the bars cover ${Math.round(bars * 100)} in 100 of the doorway`);
  sure(
    doorway.some((pixel) => !isGrate(pixel) && isWall(pixel)),
    "room C's wall is not seen through the holes",
  );
});

test("textures wanted from a .wad are found in the folders given, or drawn flat and named", () => {
  const eye = { from: [272, 224, 64], yaw: 135, width: 160, height: 120 };
  const inside = maps.drawMap(bsp, eye);
  const found = maps.drawMap(wantsWad, { ...eye, folders: [FIXTURES] });
  const handed = maps.drawMap(maps.readBsp(wantsWad.bytes), {
    ...eye,
    textures: maps.readWad(readFileSync(wadFile)).textures,
  });
  sure(
    found.facts.missing.length === 0 && Buffer.from(found.rgba).equals(Buffer.from(inside.rgba)),
    "from the .wad beside it: the same picture",
  );
  sure(
    Buffer.from(handed.rgba).equals(Buffer.from(inside.rgba)),
    "from textures handed over: the same picture",
  );
  const flat = maps.drawMap(maps.readBsp(wantsWad.bytes), eye);
  sure(
    flat.facts.missing.join() === "smakfloor,smakwall,{smakgrate" &&
      /found nowhere/.test(flat.facts.notes.join()),
    `the missing textures are named: ${flat.facts.missing}`,
  );
  sure(
    flat.facts.pixels === 1 && !Buffer.from(flat.rgba).equals(Buffer.from(inside.rgba)),
    "drawn, in flat colours",
  );
});

test("drawMap refuses what it cannot draw from, in words", () => {
  sure(
    refuses(() => maps.drawMap(bsp, { from: [1, 2] }), /from: where the eye is/),
    "a point of two numbers",
  );
  sure(
    refuses(() => maps.drawMap(bsp, { width: 5 }), /width: a whole number from 16/),
    "a width of 5",
  );
  sure(
    refuses(() => maps.drawMap(bsp, { fov: 200 }), /fov: degrees across/),
    "a view 200 degrees wide",
  );
  sure(
    refuses(() => maps.viewFrom(bsp, 99), /no entity 99/),
    "an entity the map has not",
  );
  sure(
    refuses(() => maps.viewFrom(bsp, GRATE_WALL), /no place of its own/),
    "a view from a brush entity",
  );
  sure(maps.viewFrom(bsp, "light").from.join() === "96,96,104", "a view from the first of a class");
});

test("the plan marks the player start and the lights at the right pixels for its scale", () => {
  const SCALE = 2;
  const plan = maps.planOf(bsp, { scale: SCALE });
  const { x0, y0, scale, marks } = plan.facts;
  sure(scale === SCALE && plan.facts.z === null && plan.facts.bar === 64, "its scale, and a bar of 64 units");
  const pixelOf = (point) => [Math.round((point[0] - x0) * scale), Math.round((y0 - point[1]) * scale)];
  const light = marks.find((mark) => mark.number === CORRIDOR_LIGHT_ENTITY);
  sure(
    light.at.join() === pixelOf(CORRIDOR_LIGHT).join() && light.kind === "light",
    `the light at ${light.at}`,
  );
  sure(
    sameColour(pixelAt(plan, ...light.at), maps.MARK_COLOURS.light),
    "the light's dot is not in the lights' colour",
  );
  // +y is up the picture and +x to its right: the corridor's light is right of the start, and above it
  const start = marks.find((mark) => mark.number === START);
  sure(start.kind === "start" && light.at[0] > start.at[0] && light.at[1] < start.at[1], "north is not up");
  sure(
    marks.find((mark) => mark.number === GRATE_WALL).kind === "brush" && marks.length === 4,
    "the func_wall is outlined",
  );

  // the start moved in the compiled map: its dot is where it was moved to, in the starts' colour
  const MOVED_TO = [48, 160, 40];
  const moved = maps.readBsp(maps.withEntities(tworooms, maps.moveEntity(bsp.entities, START, MOVED_TO)));
  const planMoved = maps.planOf(moved, { scale: SCALE });
  const movedMark = planMoved.facts.marks.find((mark) => mark.number === START);
  sure(movedMark.at.join() === pixelOf(MOVED_TO).join(), `the moved start at ${movedMark.at}`);
  sure(
    sameColour(pixelAt(planMoved, ...movedMark.at), maps.MARK_COLOURS.start),
    "the start's dot is not in its colour",
  );
  sure(
    !sameColour(pixelAt(plan, ...movedMark.at), maps.MARK_COLOURS.start),
    "there was a start's dot there before",
  );

  // without marks the picture has none of their colours; a floor is lighter than the rock about it
  const bare = maps.planOf(bsp, { scale: SCALE, entities: false });
  sure(
    bare.facts.marks.length === 0 && !sameColour(pixelAt(bare, ...light.at), maps.MARK_COLOURS.light),
    "entities: false",
  );
  const floor = pixelAt(bare, ...pixelOf([96, 96]));
  const rock = pixelAt(bare, ...pixelOf(IN_THE_WALL_BETWEEN_THE_ROOMS));
  sure(
    sameColour(rock, maps.PLAN_COLOURS.rock) && floor[1] > rock[1] + 20,
    `a floor ${floor} against the rock ${rock}`,
  );
  sure(
    refuses(() => maps.planOf(bsp, { scale: 0 }), /scale: pixels a unit/),
    "a scale of 0",
  );
  sure(
    refuses(() => maps.planOf(bsp, { area: { min: [9, 9], max: [1, 1] } }), /area:/),
    "an area turned about",
  );
});

test("a plan of the source agrees with the compiled map's on where the walls are", () => {
  const options = { z: CUT_HEIGHT, scale: 1, area: WHOLE_MAP, entities: false };
  const compiled = maps.planOf(bsp, options);
  const drawn = maps.planOfSource(source, options);
  sure(compiled.width === drawn.width && compiled.height === drawn.height, "the two plans are of one size");
  sure(
    drawn.facts.z === CUT_HEIGHT && /source/.test(drawn.facts.notes.join()),
    "the source's plan says what it is",
  );
  let solidInBoth = 0;
  let solidInOne = 0;
  for (let y = 0; y < compiled.height; y++)
    for (let x = 0; x < compiled.width; x++) {
      const a = sameColour(pixelAt(compiled, x, y), maps.PLAN_COLOURS.solid);
      const b = sameColour(pixelAt(drawn, x, y), maps.PLAN_COLOURS.solid);
      if (a && b) solidInBoth++;
      else if (a !== b) solidInOne++;
    }
  // the rock is cut where the map says, and beyond the map's box the compiled map is solid too: the source's
  // plan knows nothing there, so only the pixels inside the box are counted
  sure(solidInBoth > 40000, `the walls are ${solidInBoth} pixels`);
  const margin = solidInOne - (compiled.width * (compiled.height - 46) - 352 * 480);
  sure(Math.abs(margin) < 2500, `${solidInOne} pixels are wall in one plan only`);
  // the doorway of room A is open in both, and the wall beside it solid in both
  const pixelOf = (point) => [Math.round(point[0] - drawn.facts.x0), Math.round(drawn.facts.y0 - point[1])];
  for (const plan of [compiled, drawn]) {
    sure(
      !sameColour(pixelAt(plan, ...pixelOf([208, 96])), maps.PLAN_COLOURS.solid),
      "the doorway is walled up",
    );
    sure(
      sameColour(pixelAt(plan, ...pixelOf([208, 160])), maps.PLAN_COLOURS.solid),
      "the wall by the doorway is open",
    );
  }
  // a source's plan is a cut at the start's height unless told; and its marks are the compiled map's
  const asIs = maps.planOfSource(source);
  sure(asIs.facts.z === PLAYER_START[2] && asIs.facts.marks.length === 4, `cut at ${asIs.facts.z}`);
});

test("a view of the source shows the same room in flat colours, and several views go in one picture", () => {
  const drawn = maps.drawSource(source);
  sure(
    drawn.facts.pixels === 1 && drawn.facts.faces > 3 && drawn.facts.light === "none",
    "the source's view is blank",
  );
  sure(
    drawn.facts.from.join() === "96,96,68" && drawn.facts.yaw === 90,
    "from the start, as the compiled view",
  );
  sure(
    drawn.facts.textures.map((texture) => texture.name).join() === "smakfloor,smakwall,{smakgrate",
    "the textures it names",
  );
  // straight ahead is one flat wall: one colour, but for the darker lines of the brushes' edges
  const ahead = middleOf(drawn, 40, 40);
  sure(new Set(ahead.map(String)).size <= 2, "the wall ahead is not one flat colour");
  sure(
    refuses(() => maps.drawSource({ brushes: source.brushes, entities: [] }), /no place to start/),
    "a map with no start",
  );
  sure(
    refuses(() => maps.drawSource({}), /what `writeMap` takes/),
    "what is no map",
  );

  const views = maps.viewsOf(bsp);
  sure(
    views.width === 1280 && views.height === 480,
    `five cells of 320 x 240 in rows of four: ${views.width}x${views.height}`,
  );
  sure(
    views.facts.views.length === 5 &&
      /^1 info_player_start yaw 90$/.test(views.facts.views[0].name) &&
      /^room /.test(views.facts.views[1].name),
    views.facts.views.map((view) => view.name).join("; "),
  );
  const chosen = maps.viewsOf(bsp, {
    at: [START, { from: IN_ROOM_C, yaw: 0, name: "room c" }],
    width: 160,
    height: 120,
  });
  sure(
    chosen.width === 320 && chosen.facts.views[1].name === "room c yaw 0",
    "views from places of one's own",
  );
});

// ── the command line ────────────────────────────────────────────────────────
/**
 * One wrong command line: it has to end with exit code 1 and one sentence that `says` matches, with no stack
 * trace under it.
 */
const refused = (args, says) => {
  const run = runRefused(SMAK_CLI, ...args);
  const asked = `smak ${args.join(" ")}`;
  sure(run.code === 1, `${asked}: exit code ${run.code}, and it printed ${run.out.slice(0, 80)}`);
  sure(!/\n\s+at /.test(run.err), `${asked}: a stack trace: ${run.err.slice(0, 200)}`);
  sure(says.test(run.err), `${asked}: it said ${run.err.slice(0, 200)}`);
  sure(run.err.trim().split("\n").length === 1, `${asked}: more than a sentence: ${run.err.slice(0, 200)}`);
};

test("the map commands tell what is in a map and check it", () => {
  const told = runSmak("map-info", mapFile);
  sure(
    /a GoldSrc map \(version 30\), 26276 bytes, "SMAK's own two rooms"/.test(told) &&
      /from -16 -16 -16 to 336 464 144 \(352 x 480 x 160 units/.test(told) &&
      /faces\s+860 bytes\s+43/.test(told) &&
      /ENTITIES \(5\): 1 of them made of brushes/.test(told) &&
      /\{smakgrate\s+32x32\s+inside/.test(told) &&
      /LIGHT {2}\d+ bytes, baked; styles 0/.test(told),
    told,
  );
  const json = JSON.parse(runSmak("map-info", mapFile, "--json"));
  sure(
    json.classes.light === 2 && json.lumps.faces.entries === 43 && json.textures.length === 3,
    "map-info --json",
  );
  sure(
    /WANTED from a \.wad/.test(runSmak("map-info", join(FIXTURES, "tworooms-wants-wad.bsp"))),
    "a texture wanted from a .wad",
  );
  sure(
    /fit for goldsrc/.test(runSmak("map-check", mapFile, "--engine", "xash").replace("xash", "goldsrc")),
    "map-check",
  );
  // a map that passes: five lines at most, the last PASS; its counts in the file it names
  const passed = runSmak("map-check", mapFile).trim().split("\n");
  const detail = /^the detail: (.*)$/m.exec(passed.join("\n"))?.[1];
  sure(
    passed.length <= 5 && passed.at(-1) === "PASS: fit for goldsrc" && /version 30/.test(readFileSync(detail, "utf8")),
    `map-check printed ${passed.join(" | ")}`,
  );
  sure(
    /found in the folders given: 1 of 1 \.wad files, 3 of 3 textures/.test(
      runSmak("map-check", join(FIXTURES, "tworooms-wants-wad.bsp"), "--game", FIXTURES, "--verbose"),
    ),
    "map-check --game",
  );
  // a map cut short: its errors are printed, and the exit code is 1
  writeFileSync(inFolder("cut.bsp"), tworooms.subarray(0, 9000));
  const cut = runRefused(SMAK_CLI, "map-check", inFolder("cut.bsp"));
  sure(cut.code === 1 && /ERROR [^]*errors: not fit for goldsrc/.test(cut.out), `a cut map: ${cut.out}`);

  const listed = runSmak("map-entities", mapFile);
  sure(
    /^ {3}1 {2}info_player_start {2}at 96 96 40 +angles="0 90 0"$/m.test(listed) &&
      /^ {3}4 {2}func_wall +brushes \*1 +renderamt=255 rendermode=4$/m.test(listed) &&
      /5 entities, of 5 in the map/.test(listed),
    listed,
  );
  sure(
    /2 entities of the class light, of 5/.test(runSmak("map-entities", mapFile, "--class", "light")),
    "--class",
  );
  const asJson = JSON.parse(runSmak("map-entities", mapFile, "--class", "func_wall", "--json"));
  sure(
    asJson.length === 1 && asJson[0].number === GRATE_WALL && asJson[0].model === 1,
    "map-entities --json",
  );
});

test("map-set changes, adds and takes out one entity, into a new file", () => {
  const moved = inFolder("moved.bsp");
  const said = runSmak(
    "map-set",
    mapFile,
    "-o",
    moved,
    "--entity",
    "info_player_start",
    "--move",
    "48,160,40",
    "angles=0 180 0",
  );
  sure(
    /entity 1 \(info_player_start\): angles 0 90 0 -> 0 180 0; moved from 96 96 40 to 48 160 40/.test(said),
    said,
  );
  sure(
    /only what the game reads when it runs has changed/.test(said),
    "what a change of entities does not change is said",
  );
  const start = maps.readBsp(readFileSync(moved)).entities[START];
  sure(
    maps.originOf(start).join() === "48,160,40" && maps.valueOf(start, "angles") === "0 180 0",
    "the entity in the new file",
  );
  sure(readFileSync(mapFile).equals(tworooms), "the original was written over");

  const added = inFolder("added.bsp");
  sure(
    /entity 5 added: monster_zombie at 96 300 36/.test(
      runSmak(
        "map-set",
        mapFile,
        "-o",
        added,
        "--add",
        "monster_zombie",
        "--at",
        "96,300,36",
        "angles=0 90 0",
      ),
    ),
    "--add",
  );
  const zombie = maps.readBsp(readFileSync(added)).entities[5];
  sure(
    maps.valueOf(zombie, "classname") === "monster_zombie" && maps.valueOf(zombie, "angles") === "0 90 0",
    "the added entity",
  );
  sure(
    /entity 2 \(light\) taken out/.test(
      runSmak("map-set", mapFile, "-o", inFolder("less.bsp"), "--remove", "2"),
    ),
    "--remove",
  );
  sure(maps.readBsp(readFileSync(inFolder("less.bsp"))).entities.length === 4, "one entity fewer");
  sure(
    /_light taken out/.test(
      runSmak("map-set", mapFile, "-o", inFolder("unset.bsp"), "--entity", "2", "--unset", "_light"),
    ),
    "--unset",
  );

  const out = ["-o", inFolder("never.bsp")];
  refused(["map-set", mapFile], /map-set: -o out\.bsp/);
  refused(["map-set", mapFile, "-o", mapFile, "--remove", "2"], /never over the original/);
  refused(["map-set", mapFile, ...out], /one of --entity/);
  refused(["map-set", mapFile, ...out, "--entity", "1", "--remove", "2"], /one of --entity/);
  refused(
    ["map-set", mapFile, ...out, "--entity", "light", "_light=1 1 1 1"],
    /2 of that class \(2, 3\): give the number/,
  );
  refused(["map-set", mapFile, ...out, "--entity", "monster_zombie", "a=b"], /no entity of that class/);
  refused(["map-set", mapFile, ...out, "--entity", "9", "a=b"], /no entity 9: the map has 5/);
  refused(["map-set", mapFile, ...out, "--entity", "1"], /nothing to change/);
  refused(["map-set", mapFile, ...out, "--entity", "1", "angles"], /angles is not key=value/);
  refused(
    ["map-set", mapFile, ...out, "--entity", "1", "--move", "1,2"],
    /--move: three numbers x,y,z, not 1,2/,
  );
  refused(["map-set", mapFile, ...out, "--entity", "4", "--move", "1,2,3"], /is made of brushes/);
  refused(["map-set", mapFile, ...out, "--remove", "4"], /cannot be taken out of a compiled map/);
  refused(["map-set", mapFile, ...out, "--remove", "0"], /worldspawn cannot be removed/);
  refused(["map-set", mapFile, ...out, "--add", "worldspawn"], /one worldspawn/);
  refused(["map-set", mapFile, ...out, "--add"], /--add needs a value/);
  sure(!existsSync(inFolder("never.bsp")), "a refused change wrote a file");
});

test("map-plan, map-view and map-views draw a compiled map and its source", () => {
  const plan = inFolder("plan.png");
  const told = runSmak("map-plan", inFolder("moved.bsp"), "-o", plan, "--scale", "1");
  sure(/plan\.png {2}400x574 {2}1 pixels a unit, seen from above; \+y is up the picture/.test(told), told);
  sure(
    /^ {3}1 {2}info_player_start +48 160 40 +at pixel 88,328$/m.test(told),
    `the moved start's pixel: ${told}`,
  );
  const read = smak.unpng(readFileSync(plan));
  sure(
    read.width === 400 && sameColour(pixelAt(read, 88, 328), maps.MARK_COLOURS.start),
    "the start's dot in the file",
  );
  sure(
    /cut at z 40/.test(runSmak("map-plan", mapFile, "-o", plan, "--z", "40", "--area", "0,0,192,192")),
    "--z and --area",
  );
  const ofSource = runSmak("map-plan", sourceFile, "-o", inFolder("source-plan.png"), "--no-labels");
  sure(
    /cut at z 40/.test(ofSource) && /source, not compiled/.test(ofSource),
    `a plan of the source: ${ofSource}`,
  );

  const view = runSmak(
    "map-view",
    mapFile,
    "-o",
    inFolder("view.png"),
    "--at",
    "3",
    "--yaw",
    "100",
    "--width",
    "320",
    "--height",
    "200",
  );
  sure(
    /view\.png {2}320x200 {2}from 272 224 104, yaw 100, pitch 0, 90 degrees across; \d+ faces; light: lightmaps/.test(
      view,
    ),
    view,
  );
  sure(
    /from 96 96 68, yaw 90/.test(runSmak("map-view", mapFile, "-o", inFolder("view.png"))),
    "from the start, unless told",
  );
  sure(
    /from 10 20 30, yaw 45, pitch 0/.test(
      runSmak("map-view", sourceFile, "-o", inFolder("v.png"), "--from", "10,20,30", "--to", "20,30,30"),
    ),
    "--to, on the source",
  );
  sure(/light: none/.test(runSmak("map-view", sourceFile, "-o", inFolder("v.png"))), "a view of the source");
  const views = runSmak("map-views", mapFile, "-o", inFolder("views.png"), "--count", "5");
  sure(
    /views\.png {2}1280x480 {2}5 views/.test(views) &&
      /1 info_player_start yaw 90, from 96 96 68/.test(views),
    views,
  );

  const out = ["-o", inFolder("never.png")];
  refused(["map-plan", mapFile], /map-plan: -o out\.png/);
  refused(["map-plan", mapFile, ...out, "--area", "1,2,3"], /--area: four numbers x0,y0,x1,y1, not 1,2,3/);
  refused(["map-plan", mapFile, ...out, "--scale"], /--scale needs a value/);
  refused(["map-plan", mapFile, ...out, "--scale", "0"], /scale: pixels a unit, over 0/);
  refused(["map-plan", mapFile, ...out, "--z", "high"], /--z: a number, not high/);
  refused(["map-plan", mapFile, ...out, "--width", "5"], /--width: a whole number from 16 to 4096, not 5/);
  refused(["map-plan", inFolder("cut.bsp"), ...out], /map-plan: /);
  refused(["map-view", mapFile], /map-view: -o out\.png/);
  refused(["map-view", mapFile, ...out, "--from", "1,2"], /--from: three numbers x,y,z, not 1,2/);
  refused(["map-view", mapFile, ...out, "--from", "1,2,3", "--at", "1"], /both say where the eye is/);
  refused(["map-view", mapFile, ...out, "--at", "99"], /no entity 99/);
  refused(["map-view", mapFile, ...out, "--at", "func_wall"], /no place of its own/);
  refused(
    ["map-view", mapFile, ...out, "--light", "dim"],
    /--light: start or off or steady or all \(or --no-light\), not dim/,
  );
  refused(["map-view", mapFile, ...out, "--entities", "some"], /--entities: all, models, game, none/);
  refused(["map-view", mapFile, ...out, "--brightness", "0"], /--brightness: a number over 0/);
  refused(["map-view", mapFile, ...out, "--fov", "200"], /fov: degrees across/);
  refused(["map-view", mapFile, ...out, "--game", inFolder("nowhere")], /--game: no such folder/);
  refused(["map-view", mapFile, ...out, "--wad", inFolder("no.wad")], /no such file/);
  refused(["map-views", mapFile], /map-views: -o out\.png/);
  refused(["map-views", sourceFile, ...out], /a compiled map \(\.bsp\)/);
  refused(["map-views", mapFile, ...out, "--count", "0"], /--count: a whole number from 1, not 0/);
  sure(!existsSync(inFolder("never.png")), "a refused picture was written");
});

test("textures go out of a map and a .wad as pictures, and back into a .wad", () => {
  const listed = runSmak("wad", wadFile);
  sure(
    /smakwall\s+64x64/.test(listed) &&
      /\{smakgrate\s+32x32 {2}with holes/.test(listed) &&
      /3 textures/.test(listed),
    listed,
  );
  runSmak("wad", wadFile, "-o", inFolder("from-wad"));
  runSmak("map-textures", mapFile, "-o", inFolder("from-map"));
  const fromWad = readFileSync(inFolder("from-wad/{smakgrate.png"));
  sure(
    fromWad.equals(readFileSync(inFolder("from-map/{smakgrate.png"))),
    "the map's own texture and the .wad's are one picture",
  );
  sure(
    smak.unpng(fromWad).rgba.some((value, at) => at % 4 === 3 && value === 0),
    "the grate's holes are see-through in its PNG",
  );
  const wanted = runSmak(
    "map-textures",
    join(FIXTURES, "tworooms-wants-wad.bsp"),
    "-o",
    inFolder("from-wanted"),
  );
  sure(
    /smakwall\.png {2}64x64 {2}from tworooms\.wad/.test(wanted),
    `textures found in the .wad beside the map: ${wanted}`,
  );
  // a map alone, its .wad nowhere: its wants are said, and nothing is made up
  copyFileSync(join(FIXTURES, "tworooms-wants-wad.bsp"), inFolder("alone.bsp"));
  sure(
    /WARN {2}smakwall 64x64: wanted from a \.wad, and in none that was found/.test(
      runSmak("map-textures", inFolder("alone.bsp"), "-o", inFolder("none")),
    ),
    "a wanted texture not found",
  );

  // the pictures made into a .wad again: the same textures, pixel for pixel
  const made = inFolder("made.wad");
  const said = runSmak(
    "wad-make",
    inFolder("from-wad/smakwall.png"),
    inFolder("from-wad/smakfloor.png"),
    inFolder("from-wad/{smakgrate.png"),
    "-o",
    made,
  );
  sure(/made\.wad: 3 textures/.test(said) && /\{smakgrate\s+32x32 {2}with holes/.test(said), said);
  const again = maps.readWad(readFileSync(made)).textures;
  const first = maps.readWad(readFileSync(wadFile)).textures;
  sure(
    again.every((texture, nth) => {
      const before = maps.textureRgba(first[nth]);
      const after = maps.textureRgba(texture);
      return texture.name === first[nth].name && Buffer.from(after.rgba).equals(Buffer.from(before.rgba));
    }),
    "a .wad made of a .wad's pictures is not the same textures",
  );

  writeFileSync(inFolder("odd.png"), smak.png(20, 20, new Uint8Array(20 * 20 * 4).fill(200)));
  writeFileSync(inFolder("not-a.wad"), "this is not a wad\n");
  refused(["wad", inFolder("not-a.wad")], /wad: not a \.wad file/);
  refused(["wad", mapFile], /wad: not a \.wad file/);
  refused(["wad-make", inFolder("from-wad/smakwall.png")], /wad-make: -o out\.wad/);
  refused(["wad-make", inFolder("odd.png"), "-o", inFolder("odd.wad")], /both sides must be multiples of 16/);
  refused(
    ["wad-make", inFolder("from-wad/smakwall.png"), inFolder("no.png"), "-o", inFolder("odd.wad")],
    /no such file/,
  );
  refused(["wad-make", inFolder("not-a.wad"), "-o", inFolder("odd.wad")], /wad-make: /);
  refused(["map-textures", mapFile], /map-textures: -o <folder>/);
  refused(["map-info", inFolder("not-a.wad")], /map-info: /);
  refused(["map-compile", sourceFile], /map-compile: -o out\.bsp/);
  refused(
    ["map-compile", mapFile, "-o", inFolder("c.bsp")],
    /brush source \(a \.map file\) is what is compiled/,
  );
  // without the compilers the compile says in one line what it needs, and ends with 1
  const none = runRefused(
    SMAK_CLI,
    "map-compile",
    sourceFile,
    "-o",
    inFolder("c.bsp"),
    "--vhlt",
    inFolder("nowhere"),
    "--wad",
    wadFile,
  );
  if (!maps.findCompilers().found)
    sure(
      none.code === 1 &&
        /ERROR compileMap: this needs the map compilers VHLT/.test(none.out) &&
        /not compiled/.test(none.out),
      none.out,
    );
});

if (maps.findCompilers().found)
  test("map-compile compiles the fixture's source, and the result is drawn (VHLT is installed)", () => {
    const compiled = inFolder("compiled.bsp");
    const said = runSmak("map-compile", sourceFile, "-o", compiled, "--wad", wadFile, "--wadinclude");
    sure(/hlrad {2}[\d.]+ s {2}ended/.test(said) && /compiled\.bsp: compiled/.test(said), said);
    const view = maps.drawMap(maps.readBsp(readFileSync(compiled)));
    sure(
      view.facts.pixels === 1 && view.facts.missing.length === 0 && middleOf(view, 60, 60).every(isWall),
      "the compiled map's view",
    );
  });

// ── the MCP server on a map ─────────────────────────────────────────────────
/** The server started on the fixtures as its models: `tool(name, args)` calls one, `close()` ends it. */
function startServer() {
  const child = spawn(
    process.execPath,
    [join(HERE, "../cli/mcp/server.mjs"), "--models", FIXTURES, "--work", inFolder("mcp-work"), "--no-run"],
    { stdio: ["pipe", "pipe", "ignore"] },
  );
  const waiting = new Map();
  let nextId = 1;
  createInterface({ input: child.stdout }).on("line", (line) => {
    const answer = JSON.parse(line);
    waiting.get(answer.id)?.(answer);
    waiting.delete(answer.id);
  });
  const request = (method, params) =>
    new Promise((answered) => {
      const id = nextId++;
      waiting.set(id, answered);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  return {
    request,
    tool: async (name, args = {}) => (await request("tools/call", { name, arguments: args })).result,
    close: () =>
      new Promise((closed) => {
        child.on("close", closed);
        child.stdin.end();
      }),
  };
}
const wordsOf = (result) =>
  result.content
    .filter((piece) => piece.type === "text")
    .map((piece) => piece.text)
    .join("\n");
const picturesOf = (result) =>
  result.content
    .filter((piece) => piece.type === "image")
    .map((piece) => smak.unpng(Buffer.from(piece.data, "base64")));

await testAsync("the MCP server lists, describes, checks and draws maps", "mcp: maps", async () => {
  const server = startServer();
  await server.request("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "selftest", version: "0" },
  });
  const tools = (await server.request("tools/list")).result.tools;
  sure(
    tools.map((tool) => tool.name).join() === "guide,models,info,check,render",
    "a map needed a tool of its own",
  );
  // what every conversation pays for: the descriptions of all the tools, kept short
  sure(
    JSON.stringify(tools).length < 4200,
    `the tools are described in ${JSON.stringify(tools).length} characters`,
  );

  const listed = wordsOf(await server.tool("models"));
  sure(
    /tworooms\.bsp 26276/.test(listed) &&
      /tworooms\.map/.test(listed) &&
      /tworooms\.wad/.test(listed) &&
      !/README/.test(listed),
    listed,
  );
  const told = wordsOf(await server.tool("info", { model: "tworooms.bsp" }));
  sure(
    /a GoldSrc map, 26276 bytes/.test(told) &&
      /1 info_player_start at 96 96 40/.test(told) &&
      /\{smakgrate 32x32/.test(told),
    told,
  );
  sure(
    /_light="255 240 210 220"/.test(
      wordsOf(await server.tool("info", { model: "tworooms.bsp", full: true })),
    ),
    "full: the keys",
  );
  sure(
    /brush source, 20 brushes of the world, 4 entities/.test(
      wordsOf(await server.tool("info", { model: "tworooms.map" })),
    ),
    "info of a .map",
  );
  sure(
    /3 map textures: smakwall 64x64/.test(wordsOf(await server.tool("info", { model: "tworooms.wad" }))),
    "info of a .wad",
  );
  const checked = wordsOf(await server.tool("check", { model: "tworooms-wants-wad.bsp" }));
  sure(/3 of 3 textures/.test(checked) && /fit for goldsrc/.test(checked), checked);

  const plan = await server.tool("render", { model: "tworooms.bsp", size: 400 });
  const [planPicture] = picturesOf(plan);
  sure(
    /tworooms\.bsp plan: \d+x400/.test(wordsOf(plan)) &&
      /1 info_player_start 96 96 40 at pixel \d+,\d+/.test(wordsOf(plan)),
    wordsOf(plan),
  );
  // the pixel the words give for the corridor's light is that light's dot in the picture that was sent
  const [x, y] = /3 light 272 224 104 at pixel (\d+),(\d+)/.exec(wordsOf(plan)).slice(1).map(Number);
  const dot = pixelAt(planPicture, x, y);
  sure(dot[0] > 200 && dot[1] > 180 && dot[2] < 120, `the light's dot at ${x},${y} is ${dot}`);
  const view = await server.tool("render", {
    model: "tworooms.bsp",
    kind: "view",
    at: "3",
    yaw: 90,
    size: 200,
  });
  sure(
    /view: 200x150\nfrom 272 224 104, yaw 90/.test(wordsOf(view)) && picturesOf(view)[0].width === 200,
    wordsOf(view),
  );
  const views = await server.tool("render", { model: "tworooms.bsp", kind: "views", size: 800 });
  sure(picturesOf(views)[0].width === 800 && /room 272 224 64 yaw 0/.test(wordsOf(views)), wordsOf(views));
  const ofSource = await server.tool("render", { model: "tworooms.map", kind: "view", at: "96 96 64" });
  sure(
    /source, not compiled/.test(wordsOf(ofSource)) && picturesOf(ofSource).length === 1,
    wordsOf(ofSource),
  );
  const wrongKind = await server.tool("render", { model: "tworooms.bsp", kind: "sheet" });
  sure(
    wrongKind.isError && /kind: for a map, one of plan, view, views/.test(wordsOf(wrongKind)),
    wordsOf(wrongKind),
  );

  // the two map documents, through the guide
  sure(
    /What a compiled map is/.test(wordsOf(await server.tool("guide", { doc: "maps" }))),
    "the guide hands out docs/MAPS.md",
  );
  sure(
    /carve\(/.test(wordsOf(await server.tool("guide", { doc: "maps-making", find: "carve(" }))),
    "and docs/MAPS-MAKING.md",
  );
  sure(/maps, maps-making/.test(wordsOf(await server.tool("guide"))), "the guide's list names the two");
  sure((await server.close()) === 0, "the server did not end cleanly");
});

test("shrunkWithHoles: a texture's smaller sizes made from its largest keep its holes (MSC's {ms_tree04 to 08 lost them)", () => {
  // 4 x 4: the left half holes (255), the right half colour 7
  const pixels = Uint8Array.from({ length: 16 }, (_, i) => (i % 4 < 2 ? 255 : 7));
  const half = maps.shrunkWithHoles(pixels, 4, 4, 1);
  sure(half.length === 4 && [...half].join() === "255,7,255,7", `the halves kept (${[...half]})`);
  const one = maps.shrunkWithHoles(pixels, 4, 4, 2);
  sure(one[0] === 255, "half holes or more: a hole");
});
