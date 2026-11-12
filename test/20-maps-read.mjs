// Compiled maps: the kit's own small map (test/fixtures) read to the numbers it was compiled to; its
// entities written back to the byte, changed, and put into the map with every other lump left as it was;
// what is solid and what is seen from where; its light and its textures; texture files written and read;
// and checkBsp, which passes it and reports a broken one.
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../check/maps/index.mjs";
import { test, sure, near, HERE, tmp } from "./helper.mjs";
import { mapTextures, mapWad, WALL, FLOOR, GRATE } from "./fixture-maptextures.mjs";

const FIXTURES = join(HERE, "fixtures");
/** The map with its textures' pixels inside it, and the same map wanting them from tworooms.wad. */
const tworooms = readFileSync(join(FIXTURES, "tworooms.bsp"));
const wantsWad = readFileSync(join(FIXTURES, "tworooms-wants-wad.bsp"));
const bsp = maps.readBsp(tworooms);

// ── the map as it was drawn (test/fixtures/README.md): places in units ──
const PLAYER_START = [96, 96, 40]; // in room A, 40 over its floor
const IN_ROOM_A = [96, 96, 64];
const IN_ROOM_C = [96, 352, 64];
const IN_THE_CORRIDOR = [272, 224, 64];
const IN_THE_DOORWAY_OF_A = [208, 96, 48];
const IN_THE_WALL_BETWEEN_THE_ROOMS = [96, 224, 64];
const OUTSIDE_THE_MAP = [-500, 0, 0];
const FAR_OUTSIDE = [1000, 1000, 1000];
const TEN_FROM_A_WALL = [10, 96, 64]; // open to a point, too near the wall for a player's middle
const ROOM_SIDE = 192; // a room is 192 by 192
const FLOOR_HEIGHT = 0;
const STANDING_HALF_HEIGHT = 36; // a standing player's middle rests this far over the floor
// the entities, by their numbers in the file
const WORLDSPAWN = 0;
const START = 1;
const FIRST_LIGHT = 2;
const GRATE_WALL = 4; // the func_wall, the map's model *1

/** True when `run` throws an error whose message matches `pattern`. */
const refuses = (run, pattern) => {
  try {
    run();
  } catch (e) {
    return pattern.test(e.message);
  }
  return false;
};
/** The bytes of one lump of a map. */
const lumpOf = (bytes, lump) => bytes.subarray(lump.offset, lump.offset + lump.length);
/** The names of the lumps whose bytes are not the same in two maps. */
const lumpsThatDiffer = (before, after) => {
  const was = maps.readBsp(before).lumps;
  const is = maps.readBsp(after).lumps;
  return maps.LUMP_NAMES.filter((name) => !lumpOf(before, was[name]).equals(lumpOf(after, is[name])));
};
/** The names of the lumps that are not at the same place in two maps. */
const lumpsThatMoved = (before, after) => {
  const was = maps.readBsp(before).lumps;
  const is = maps.readBsp(after).lumps;
  return maps.LUMP_NAMES.filter((name) => was[name].offset !== is[name].offset);
};
/** The world's face that looks up and lies in room A: its floor. */
const floorOfRoomA = () =>
  bsp.faces.findIndex(
    (face, index) =>
      index < bsp.models[0].faceCount &&
      maps.faceNormal(bsp, index)[2] > 0.9 &&
      maps.facePolygon(bsp, index).every((corner) => corner[0] <= ROOM_SIDE && corner[1] <= ROOM_SIDE),
  );

test("readBsp reads the kit's own map to its counts", () => {
  sure(bsp.version === 30 && !bsp.blueShift, "version");
  sure(Object.keys(bsp.lumps).length === 15, "fifteen lumps");
  sure(
    Object.values(bsp.lumps).every((lump) => lump.offset + lump.length <= tworooms.length),
    "lumps inside",
  );
  const counts = {
    planes: 53,
    vertices: 60,
    edges: 100,
    surfedges: 198,
    faces: 43,
    texinfo: 7,
    textures: 3,
    models: 2,
    nodes: 26,
    leaves: 12,
    marksurfaces: 43,
    clipnodes: 62,
    entities: 5,
  };
  for (const [what, count] of Object.entries(counts))
    sure(bsp[what].length === count, `${what}: ${bsp[what].length} against ${count}`);

  // the world's box is the rooms and the 16 of wall about them; model 1 is the grate in the doorway
  const world = maps.worldBounds(bsp);
  sure(world.mins.join() === "-16,-16,-16" && world.maxs.join() === "336,464,144", "the world's bounds");
  sure(bsp.models[1].mins.join() === "204,320,0" && bsp.models[1].maxs.join() === "208,384,96", "model 1");
  sure(bsp.models[0].faceCount === 37 && bsp.models[1].faceCount === 6, "faces of each model");
  sure(maps.modelFaces(bsp, 1).length === 6, "modelFaces");
  sure(bsp.models[0].headNodes.length === 4 && bsp.models[0].visLeaves === 5, "head nodes, leaves seen");
  sure(bsp.leaves[0].contents === maps.CONTENTS.SOLID, "leaf 0 is the solid one");
  sure(bsp.textures.map((texture) => texture.name).join() === `${FLOOR},${WALL},${GRATE}`, "texture names");
  sure(
    bsp.textures.every((texture) => texture.embedded && !texture.absent),
    "pixels inside",
  );
});

test("a file that is not a GoldSrc map is refused in words", () => {
  const quake = Buffer.from(tworooms);
  quake.writeInt32LE(29, 0);
  sure(
    refuses(() => maps.readBsp(quake), /Quake 1/),
    "a Quake 1 map read",
  );
  const quake3 = Buffer.from(tworooms);
  quake3.write("IBSP", 0, "latin1");
  sure(
    refuses(() => maps.readBsp(quake3), /IBSP/),
    "a Quake 3 map read",
  );
  sure(
    refuses(() => maps.readBsp(tworooms.subarray(0, 60)), /60 bytes/),
    "a stub read",
  );
  sure(
    refuses(() => maps.readBsp(tworooms.subarray(0, tworooms.length - 3000)), /cut short.*textures lump/),
    "a cut map read",
  );
});

test("a map laid out as Blue Shift's are, entities and planes changed over, is read all the same", () => {
  // the header's first two entries, eight bytes each after the version, changed over
  const FIRST_ENTRY = 4;
  const ENTRY = 8;
  const swapped = Buffer.from(tworooms);
  tworooms.copy(swapped, FIRST_ENTRY, FIRST_ENTRY + ENTRY, FIRST_ENTRY + 2 * ENTRY);
  tworooms.copy(swapped, FIRST_ENTRY + ENTRY, FIRST_ENTRY, FIRST_ENTRY + ENTRY);
  const read = maps.readBsp(swapped);
  sure(read.blueShift && read.entities.length === 5 && read.planes.length === 53, "the changed over map");
  sure(maps.contentsAt(read, IN_ROOM_A) === maps.CONTENTS.EMPTY, "its world");
  // its entities go back into the header's second place
  const changed = maps.withEntities(swapped, maps.setKey(read.entities, WORLDSPAWN, "message", "x"));
  const after = maps.readBsp(changed);
  sure(after.blueShift && maps.valueOf(after.entities[WORLDSPAWN], "message") === "x", "changed");
  sure(after.planes.length === 53 && lumpsThatDiffer(swapped, changed).join() === "entities", "its planes");
  sure(
    maps.checkBsp(swapped).warnings.some((warning) => /Blue Shift/.test(warning)),
    "checkBsp does not tell of it",
  );
});

test("the entities are read in order, and written back to the byte", () => {
  const { entities } = bsp;
  sure(maps.valueOf(entities[WORLDSPAWN], "classname") === "worldspawn", "the worldspawn is first");
  sure(maps.worldspawn(entities) === entities[WORLDSPAWN], "worldspawn()");
  // the compiler writes the classname last: the pairs keep the file's order
  sure(entities[START].map((pair) => pair[0]).join() === "angles,origin,classname", "order of the keys");
  sure(maps.originOf(entities[START]).join() === PLAYER_START.join(), "originOf");
  sure(maps.anglesOf(entities[START]).join() === "0,90,0", "anglesOf");
  sure(maps.numberOf(entities[GRATE_WALL], "renderamt") === 255, "numberOf");
  sure(maps.numberOf(entities[GRATE_WALL], "nothing", 7) === 7, "numberOf's fallback");
  sure(maps.vectorOf(entities[FIRST_LIGHT], "_light") === null, "four numbers are not a vector");
  sure(
    maps.byClass(entities, "light").length === 2 && maps.byClass(entities, /^info_/).length === 1,
    "byClass",
  );
  sure(maps.byKey(entities, "origin").length === 3, "byKey");
  sure(maps.byKey(entities, "rendermode", 4)[0] === entities[GRATE_WALL], "byKey with a value");
  sure(maps.byModel(entities, 1)[0] === entities[GRATE_WALL], "byModel");
  sure(
    maps.brushModelOf(entities[GRATE_WALL]) === 1 && maps.brushModelOf(entities[START]) === null,
    "brushModelOf",
  );
  sure(
    maps.isBrushEntity(entities[WORLDSPAWN]) && !maps.isBrushEntity(entities[FIRST_LIGHT]),
    "isBrushEntity",
  );
  sure(maps.asObject(entities[START]).classname === "info_player_start", "asObject");

  for (const map of [tworooms, wantsWad]) {
    const read = maps.readBsp(map);
    const lump = lumpOf(map, read.lumps.entities);
    sure(lump[lump.length - 1] === 0, "the lump ends with a zero byte");
    sure(maps.entityLump(read.entities).equals(lump), "the entity lump written again is not the lump read");
    sure(maps.withEntities(map, read.entities).equals(map), "the map written again is not the map read");
  }
});

test("entity text of any spacing comes back as it was; a key given twice is kept twice", () => {
  const text = [
    "// a comment before the first\r\n",
    '{\r\n"classname" "worldspawn"\r\n"wad" "\\a\\b.wad;c.wad"\r\n}\r\n',
    '{ "classname"   "multi_manager" "target" "one" "target" "two"\t"note" "a { brace } inside" }\n\n',
    '{\n"classname" "light"\n"origin" "1 2 3"\n}',
    "\n   ",
  ].join("");
  const entities = maps.parseEntities(text);
  sure(entities.length === 3, `${entities.length} entities`);
  sure(maps.valuesOf(entities[1], "target").join() === "one,two", "the key given twice");
  sure(maps.valueOf(entities[1], "target") === "one", "valueOf gives the first");
  sure(maps.valueOf(entities[1], "note") === "a { brace } inside", "braces inside quotes");
  sure(maps.writeEntities(entities) === text, "the text written is not the text read");
  // what follows the zero byte is not text, and the lump's own ending is kept by withEntities
  sure(maps.parseEntities(Buffer.from(`${text}\0junk`, "latin1")).length === 3, "read past the zero byte");

  // a changed entity is written in the compilers' form with the file's line endings; the others stay
  const changed = maps.setKey(entities, 0, "skyname", "desert");
  const written = maps.writeEntities(changed);
  sure(written.includes('"wad" "\\a\\b.wad;c.wad"\r\n"skyname" "desert"\r\n}\r\n'), "the changed one's form");
  sure(written.includes('"target" "one" "target" "two"\t"note"'), "the unchanged one's own spacing");
  sure(maps.writeEntities(entities) === text, "the list given was changed");
});

test("an entity moved, a key set and removed, a point entity added and removed", () => {
  let entities = bsp.entities;
  entities = maps.moveEntity(entities, START, [100, 80.5, 40]);
  entities = maps.setKey(entities, FIRST_LIGHT, "_light", "255 0 0 300");
  entities = maps.setKey(entities, FIRST_LIGHT, "style", 3);
  entities = maps.removeKey(entities, START, "angles");
  entities = maps.addEntity(entities, "env_sprite", [272, 224, 64], {
    model: "sprites/glow01.spr",
    scale: 0.5,
  });
  entities = maps.addEntity(entities, "info_target", [1, 2, 3], [["targetname", "gone"]]);
  entities = maps.removeEntity(entities, entities.length - 1);
  sure(
    bsp.entities.length === 5 && maps.originOf(bsp.entities[START])[0] === 96,
    "the list given was changed",
  );

  const changed = maps.withEntities(tworooms, entities);
  const after = maps.readBsp(changed);
  sure(after.entities.length === 6, `${after.entities.length} entities`);
  sure(maps.valueOf(after.entities[START], "origin") === "100 80.5 40", "moved");
  sure(maps.valueOf(after.entities[START], "angles") === undefined, "key removed");
  sure(maps.valueOf(after.entities[FIRST_LIGHT], "_light") === "255 0 0 300", "key set where it stood");
  sure(
    after.entities[FIRST_LIGHT].map((pair) => pair[0]).join() === "_light,origin,classname,style",
    "a new key goes last",
  );
  const sprite = after.entities[5];
  sure(
    JSON.stringify(sprite) ===
      '[["classname","env_sprite"],["origin","272 224 64"],["model","sprites/glow01.spr"],["scale","0.5"]]',
    "added",
  );
  sure(maps.byKey(after.entities, "targetname", "gone").length === 0, "removed");
  // the untouched entities are as they stood, to the letter
  sure(JSON.stringify(after.entities[WORLDSPAWN]) === JSON.stringify(bsp.entities[WORLDSPAWN]), "worldspawn");
  sure(
    JSON.stringify(after.entities[GRATE_WALL]) === JSON.stringify(bsp.entities[GRATE_WALL]),
    "the func_wall",
  );

  // nothing but the entities differs, and nothing else moved
  sure(
    lumpsThatDiffer(tworooms, changed).join() === "entities",
    `lumps that differ: ${lumpsThatDiffer(tworooms, changed)}`,
  );
  sure(
    lumpsThatMoved(tworooms, changed).join() === "entities",
    `lumps that moved: ${lumpsThatMoved(tworooms, changed)}`,
  );
  // and the map is still a map: the same world, checked, and written again unchanged
  sure(maps.contentsAt(after, IN_ROOM_A) === maps.CONTENTS.EMPTY, "the world after the change");
  sure(maps.checkBsp(changed).errors.length === 0, maps.checkBsp(changed).errors.join("; "));
  sure(maps.withEntities(changed, after.entities).equals(changed), "written again, it changed");
});

test("a map with an entity that precaches a model it does not name is refused, here and in the check", () => {
  const refusal = (call) => {
    try {
      call();
      return "";
    } catch (error) {
      return error.message;
    }
  };
  const glow = maps.addEntity(bsp.entities, "env_glow", IN_ROOM_A, { model: "sprites/glow01.spr" });
  sure(maps.checkBsp(maps.withEntities(tworooms, glow)).errors.length === 0, "a glow with its sprite");
  sure(
    /env_glow precache a model and name none/.test(refusal(() => maps.withEntities(tworooms, maps.setKey(glow, glow.length - 1, "model", "")))), // prettier-ignore
    "written with an empty model",
  );
  // made elsewhere: the same name blanked in the bytes, its length kept
  const named = maps.withEntities(tworooms, glow);
  const at = named.indexOf('"sprites/glow01.spr"');
  const blanked = Buffer.from(named);
  blanked.write(`""${" ".repeat('"sprites/glow01.spr"'.length - 2)}`, at, "latin1");
  const errors = maps.checkBsp(blanked).errors;
  sure(errors.some((error) => /1 entities precache a model they do not name.*env_glow/.test(error)), errors.join("; "));
});

test("withEntities puts longer text at the file's end and shorter text where the old was", () => {
  const before = bsp.lumps.entities;
  // longer: this map's entities are not the last thing in the file, so the new text goes to the end
  const longer = maps.withEntities(
    tworooms,
    maps.setKey(bsp.entities, WORLDSPAWN, "message", "a longer title than it had"),
  );
  const longerAt = maps.readBsp(longer).lumps.entities;
  sure(
    longerAt.offset >= tworooms.length && longerAt.offset % 4 === 0,
    `the longer text is at ${longerAt.offset}`,
  );
  sure(longerAt.offset + longerAt.length === longer.length, "it is not the last thing in the file");
  sure(
    longer.subarray(before.offset, before.offset + before.length).every((byte) => byte === 0),
    "the old text was left in the file",
  );
  sure(longer.subarray(0, 4).equals(tworooms.subarray(0, 4)), "the version");
  // a file whose length is not a multiple of four: the new text still begins on one
  const ragged = maps.withEntities(
    Buffer.concat([tworooms, Buffer.from([7])]),
    maps.setKey(bsp.entities, WORLDSPAWN, "message", "a longer title than it had"),
  );
  const raggedAt = maps.readBsp(ragged).lumps.entities;
  sure(
    raggedAt.offset === tworooms.length + 4 && ragged[tworooms.length] === 7,
    `after a ragged end it is at ${raggedAt.offset}`,
  );
  sure(maps.readBsp(ragged).entities.length === 5, "and reads back");
  // shorter: in the old one's place, and nothing else in the file moves
  const shorter = maps.withEntities(tworooms, maps.setKey(bsp.entities, WORLDSPAWN, "message", "short"));
  const shorterAt = maps.readBsp(shorter).lumps.entities;
  sure(shorter.length === tworooms.length && shorterAt.offset === before.offset, "the shorter text moved");
  sure(shorterAt.length < before.length, "its length was not written");
  sure(lumpsThatDiffer(tworooms, shorter).join() === "entities", "another lump changed");
  sure(lumpsThatMoved(tworooms, shorter).length === 0, "a lump moved");
  sure(maps.valueOf(maps.readBsp(shorter).entities[WORLDSPAWN], "message") === "short", "reads back");
});

test("what cannot be done to an entity is refused, with the reason", () => {
  const { entities } = bsp;
  sure(
    refuses(
      () => maps.removeEntity(entities, GRATE_WALL),
      /made of brushes.*model \*1.*hiding, not removing/,
    ),
    "a brush entity was removed",
  );
  sure(
    refuses(() => maps.removeEntity(entities, WORLDSPAWN), /worldspawn cannot be removed/),
    "the worldspawn was removed",
  );
  sure(
    refuses(() => maps.moveEntity(entities, GRATE_WALL, [0, 0, 0]), /made of brushes/),
    "a brush entity was moved to a point",
  );
  sure(
    refuses(() => maps.setKey(entities, START, "message", 'say "hello"'), /quote/),
    "a quote was written",
  );
  sure(
    refuses(() => maps.setKey(entities, START, "note", "x".repeat(2000)), /1023/),
    "a value too long was written",
  );
  sure(
    refuses(() => maps.setKey(entities, 99, "a", "b"), /no entity 99/),
    "an entity that is not there was changed",
  );
  sure(
    refuses(() => maps.moveEntity(entities, START, [1, 2]), /three numbers/),
    "an origin of two numbers",
  );
  sure(
    refuses(() => maps.addEntity(entities, "func_wall", null, { model: "*7" }), /\*7.*no entity of this map/),
    "an entity on a model the map does not have",
  );
  sure(
    refuses(() => maps.removeKey(entities, START, "classname"), /classname/),
    "a classname was removed",
  );
  // a second entity on the grate's model can be added, and then either of the two taken away
  const twice = maps.addEntity(entities, "func_wall", null, { model: "*1", origin: [0, -64, 0] });
  sure(maps.removeEntity(twice, GRATE_WALL).length === 5, "one of two entities on a model");
});

test("what is at a point: open in a room, solid in a wall and outside", () => {
  const { EMPTY, SOLID } = maps.CONTENTS;
  for (const [where, point] of Object.entries({ IN_ROOM_A, IN_ROOM_C, IN_THE_CORRIDOR, IN_THE_DOORWAY_OF_A }))
    sure(
      maps.contentsAt(bsp, point) === EMPTY,
      `${where} is ${maps.contentsName(maps.contentsAt(bsp, point))}`,
    );
  for (const [where, point] of Object.entries({
    IN_THE_WALL_BETWEEN_THE_ROOMS,
    OUTSIDE_THE_MAP,
    FAR_OUTSIDE,
  }))
    for (const hull of [0, 1, 2, 3])
      sure(
        maps.contentsAt(bsp, point, { hull }) === SOLID,
        `${where} in hull ${hull} is ${maps.contentsName(maps.contentsAt(bsp, point, { hull }))}`,
      );
  // a point ten units from a wall is open; the middle of a player, 16 wide each way, cannot be there
  sure(maps.contentsAt(bsp, TEN_FROM_A_WALL) === EMPTY, "ten from a wall, to a point");
  for (const hull of [1, 2, 3])
    sure(maps.contentsAt(bsp, TEN_FROM_A_WALL, { hull }) === SOLID, `ten from a wall, in hull ${hull}`);
  // a doorway 64 wide lets a player through and not the large hull, 64 wide itself
  sure(maps.contentsAt(bsp, IN_THE_DOORWAY_OF_A, { hull: 1 }) === EMPTY, "a player in the doorway");
  sure(maps.contentsAt(bsp, IN_THE_DOORWAY_OF_A, { hull: 2 }) === SOLID, "the large hull in the doorway");
  sure(maps.contentsName(SOLID) === "solid" && maps.contentsName(-99) === "unknown (-99)", "contentsName");
  // the grate is not in the world's tree: it is its own model, solid where its brush is
  sure(maps.contentsAt(bsp, [206, 352, 48]) === EMPTY, "the grate in the world's tree");
  sure(maps.contentsAt(bsp, [206, 352, 48], { model: 1 }) === SOLID, "the grate in its own model");
  sure(maps.contentsAt(bsp, IN_ROOM_C, { model: 1 }) === EMPTY, "beside the grate, in its model");
  sure(
    refuses(() => maps.contentsAt(bsp, IN_ROOM_A, { hull: 4 }), /hull/),
    "a fifth hull",
  );
});

test("the floor under the player start", () => {
  const start = maps.originOf(bsp.entities[START]);
  near(maps.floorUnder(bsp, start), FLOOR_HEIGHT, 1 / 64, "the floor");
  // a standing player's middle comes to rest half his height over it
  near(maps.floorUnder(bsp, start, { hull: 1 }), FLOOR_HEIGHT + STANDING_HALF_HEIGHT, 1 / 64, "hull 1");
  sure(maps.floorUnder(bsp, IN_THE_WALL_BETWEEN_THE_ROOMS) === null, "a floor under a point in solid");
  sure(maps.floorUnder(bsp, start, { reach: 10 }) === null, "a floor 40 down found within 10");
});

test("visibility: each room sees the corridor, and neither sees the other", () => {
  const roomA = maps.leafAt(bsp, IN_ROOM_A);
  const roomC = maps.leafAt(bsp, IN_ROOM_C);
  const corridor = maps.leafAt(bsp, IN_THE_CORRIDOR);
  sure(new Set([roomA, roomC, corridor]).size === 3 && roomA > 0 && roomC > 0, "three leaves");
  sure(maps.leafAt(bsp, IN_THE_WALL_BETWEEN_THE_ROOMS) === 0, "solid is leaf 0");
  sure(maps.sees(bsp, roomA, corridor) && maps.sees(bsp, corridor, roomA), "room A and the corridor");
  sure(maps.sees(bsp, roomC, corridor) && maps.sees(bsp, corridor, roomC), "room C and the corridor");
  sure(!maps.sees(bsp, roomA, roomC) && !maps.sees(bsp, roomC, roomA), "the rooms see each other");
  sure(maps.visibleFrom(bsp, roomA).includes(roomA), "a leaf sees itself");
  // the corridor sees every open leaf of the world: the two rooms, the two doorways and itself
  sure(
    maps.visibleFrom(bsp, corridor).join() === "1,2,3,4,5",
    `the corridor sees ${maps.visibleFrom(bsp, corridor)}`,
  );
  sure(maps.visibleFrom(bsp, 0) === null, "leaf 0 keeps no visibility");
  // a row packed with a run of zero bytes, by hand: leaf 1, then three bytes of nothing, then leaf 40
  const packed = Buffer.from([0b00000001, 0, 3, 0b10000000]);
  const fortyLeaves = {
    bytes: packed,
    lumps: { visibility: { offset: 0, length: packed.length } },
    leaves: [{ visOffset: -1 }, { visOffset: 0 }],
    models: [{ visLeaves: 40 }],
  };
  sure(
    maps.visibleFrom(fortyLeaves, 1).join() === "1,40",
    `a packed row read as ${maps.visibleFrom(fortyLeaves, 1)}`,
  );
  // the leaves of the grate's own model keep none either
  sure(maps.visibleFrom(bsp, bsp.leaves.length - 1) === null, "a brush model's leaf");
});

test("a face: its corners, its place on its texture, its light", () => {
  const floor = floorOfRoomA();
  sure(floor >= 0, "room A's floor was not found");
  const corners = maps.facePolygon(bsp, floor);
  sure(corners.length >= 4 && corners.every((corner) => corner[2] === FLOOR_HEIGHT), "the floor's corners");
  sure(maps.faceNormal(bsp, floor).join() === "0,0,1", "the floor looks up");
  // every face of the map: no corner twice, every corner on the face's plane, and the corners turning
  // clockwise as seen from the side the face looks to
  bsp.faces.forEach((face, index) => {
    const polygon = maps.facePolygon(bsp, index);
    const normal = maps.faceNormal(bsp, index);
    sure(
      new Set(polygon.map((corner) => corner.join())).size === polygon.length,
      `face ${index} has a corner twice`,
    );
    const plane = bsp.planes[face.plane];
    for (const corner of polygon)
      near(
        corner[0] * plane.normal[0] + corner[1] * plane.normal[1] + corner[2] * plane.normal[2],
        plane.dist,
        0.01,
        `face ${index}'s plane`,
      );
    let turn = 0;
    for (let nth = 0; nth < polygon.length; nth++) {
      const [a, b, c] = [0, 1, 2].map((step) => polygon[(nth + step) % polygon.length]);
      const edgeA = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const edgeB = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
      const cross = [
        edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1],
        edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2],
        edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0],
      ];
      turn += cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2];
    }
    sure(turn < 0, `face ${index} does not turn clockwise about its normal`);
  });
  sure(maps.faceTexture(bsp, floor).name === FLOOR, "the floor's texture");
  // the texture lies along x and y, a pixel a unit, and is 32 wide: the floor is six turns of it across
  const texels = maps.faceTexels(bsp, floor);
  const uvs = maps.faceUvs(bsp, floor);
  corners.forEach((corner, nth) => {
    near(texels[nth][0], corner[0], 1e-6, "s");
    near(texels[nth][1], -corner[1], 1e-6, "t");
    near(uvs[nth][0], corner[0] / 32, 1e-6, "u");
  });

  // 192 units at a sample every 16 is 12 steps: 13 samples a side
  const size = maps.lightmapSize(bsp, floor);
  sure(size.width === 13 && size.height === 13, `the floor's lightmap is ${size.width}x${size.height}`);
  sure(size.originS === 0 && size.originT === -ROOM_SIDE, "where its first sample is");
  const light = maps.faceLightmap(bsp, floor);
  sure(light.styles.length === 1 && light.styles[0].style === 0, "its styles");
  sure(light.styles[0].rgb.length === 13 * 13 * 3, "its samples");
  sure(Math.max(...light.styles[0].rgb) > 100, "the floor under the light is dark");

  // every lit face of the map has light, and their blocks lie in the lighting lump one after another, none
  // over another and none apart: the oracle for the sizes, which are nowhere in the file
  const blocks = [];
  bsp.faces.forEach((face, index) => {
    const lightmap = maps.faceLightmap(bsp, index);
    if (!lightmap) return;
    sure(
      lightmap.styles[0].rgb.some((value) => value > 0),
      `face ${index} is lit and black`,
    );
    blocks.push({
      from: face.lightOffset,
      bytes: lightmap.styles.reduce((sum, style) => sum + style.rgb.length, 0),
    });
  });
  sure(blocks.length === 39, `${blocks.length} lit faces`);
  blocks.sort((one, other) => one.from - other.from);
  let end = 0;
  for (const block of blocks) {
    sure(block.from === end, `a face's light begins at ${block.from}, and the one before it ends at ${end}`);
    end += block.bytes;
  }
  // what the compiler leaves after the last block belongs to no face, and is nothing
  const lighting = lumpOf(tworooms, bsp.lumps.lighting);
  sure(end === 8565 && lighting.length === 9327, `${end} bytes of light claimed of ${lighting.length}`);
  sure(
    lighting.subarray(end).every((byte) => byte === 0),
    "the light no face claims is not zeros",
  );
  // the grate's two broad faces are lit; its four thin edges have no style and so no light, though the
  // compiler left an offset in them that points into another face's
  const grateFaces = maps.modelFaces(bsp, 1);
  sure(grateFaces.filter((face) => maps.hasLightmap(bsp, face)).length === 2, "the grate's lit faces");
  sure(
    grateFaces.some((face) => !maps.hasLightmap(bsp, face) && face.lightOffset >= 0),
    "no unlit face with a stale offset",
  );
});

test("the textures inside the map decode to their sizes; the one with holes has holes", () => {
  const sizes = { [WALL]: 64, [FLOOR]: 32, [GRATE]: 32 };
  for (const [name, side] of Object.entries(sizes)) {
    const texture = maps.embeddedTexture(bsp, name);
    sure(texture.width === side && texture.height === side, `${name} is ${texture.width}x${texture.height}`);
    sure(
      texture.mips.map((mip) => mip.length).join() ===
        [1, 4, 16, 64].map((part) => (side * side) / part).join(),
      `${name}'s four sizes`,
    );
    sure(texture.palette.length === 768 && texture.pixels === texture.mips[0], `${name}'s palette`);
    const picture = maps.textureRgba(texture);
    sure(picture.rgba.length === side * side * 4, `${name} as a picture`);
    const seeThrough = picture.rgba.filter((_, index) => index % 4 === 3 && picture.rgba[index] === 0).length;
    sure(texture.holes === (name === GRATE), `${name}: holes`);
    // the grate's bars are 3 pixels of every 8, both ways: 25 of each 64 pixels are open
    sure(seeThrough === (name === GRATE ? 400 : 0), `${name} has ${seeThrough} see-through pixels`);
    sure(
      new Set(texture.pixels).size > 4,
      `${name} is one flat colour: its palette was read from the wrong place`,
    );
  }
  sure(maps.embeddedTexture(bsp, 1).name === WALL, "by number");
  sure(maps.embeddedTexture(bsp, GRATE.toUpperCase()).name === GRATE, "whatever the case");
  sure(maps.textureRgba(maps.embeddedTexture(bsp, WALL), 3).width === 8, "the smallest size as a picture");
  sure(
    maps.textureKind(GRATE).holes && maps.textureKind("sky").sky && maps.textureKind("+0button").animated,
    "textureKind",
  );
  // the pixels inside the map are the ones the compiler took from the kit's .wad
  const fromWad = maps.textureFromWad(mapWad(), WALL);
  sure(
    Buffer.from(maps.embeddedTexture(bsp, WALL).pixels).equals(Buffer.from(fromWad.pixels)),
    "the map's wall is not the wad's",
  );
});

test("writeWad writes textures that read back the same, and the fixture's .wad is that file", () => {
  const written = mapWad();
  sure(
    written.equals(readFileSync(join(FIXTURES, "tworooms.wad"))),
    "test/fixtures/tworooms.wad is not what writeWad writes now",
  );
  const wad = maps.readWad(written);
  sure(
    wad.textures.map((texture) => texture.name).join() === `${WALL},${FLOOR},${GRATE}` && !wad.others.length,
    "names",
  );

  // pictures in: the same holes out, and each colour within a hair (cutting a picture down to a palette
  // counts colours in 6 bits a channel, so two that near become one)
  const NEAREST_COLOURS_APART = 4;
  for (const { name, image } of mapTextures()) {
    const texture = maps.textureFromWad(wad, name.toUpperCase());
    const picture = maps.textureRgba(texture);
    let differing = 0;
    for (let pixel = 0; pixel < image.width * image.height; pixel++) {
      const hole = image.rgba[pixel * 4 + 3] === 0;
      const gap = [0, 1, 2].map((channel) =>
        Math.abs(image.rgba[pixel * 4 + channel] - picture.rgba[pixel * 4 + channel]),
      );
      if (hole !== (picture.rgba[pixel * 4 + 3] === 0)) differing++;
      else if (!hole && Math.max(...gap) > NEAREST_COLOURS_APART) differing++;
    }
    sure(differing === 0, `${name}: ${differing} pixels differ from the picture given`);
  }
  // palette indices in: the same indices and palette out, and the smaller sizes are shrunk from the full one
  const palette = new Uint8Array(768).map((_, index) => (index * 7) % 256);
  const pixels = new Uint8Array(32 * 16).map((_, index) => (index * 5) % 256);
  const again = maps.readWad(maps.writeWad([{ name: "indexed", width: 32, height: 16, pixels, palette }]))
    .textures[0];
  sure(Buffer.from(again.pixels).equals(Buffer.from(pixels)), "indices");
  sure(Buffer.from(again.palette).equals(Buffer.from(palette)), "palette");
  sure(again.mips[1].length === 16 * 8 && again.mips[3].length === 4 * 2, "smaller sizes");
  // one flat colour shrinks to that colour; a picture that is all holes shrinks to holes
  const flat = maps.mipsOf({
    name: "flat",
    width: 16,
    height: 16,
    pixels: new Uint8Array(256).fill(9),
    palette,
  });
  sure(
    flat[3].every((index) => palette[index * 3] === palette[27]),
    "a flat colour shrunk",
  );
  const open = maps.mipsOf({
    name: "{open",
    width: 16,
    height: 16,
    pixels: new Uint8Array(256).fill(255),
    palette,
  });
  sure(open[1].every((index) => index === 255) && open[3].every((index) => index === 255), "holes shrunk");
  // the grate's half size keeps holes and bars both
  const grate = maps.textureFromWad(wad, GRATE);
  sure(grate.mips[1].includes(255) && grate.mips[1].some((index) => index !== 255), "the grate at half size");

  sure(
    refuses(
      () => maps.writeWad([{ name: "odd", width: 20, height: 16, pixels: new Uint8Array(320), palette }]),
      /multiples of 16/,
    ),
    "a texture 20 wide was written",
  );
  sure(
    refuses(
      () =>
        maps.writeWad([
          { name: "a_name_of_many_letters", width: 16, height: 16, pixels: new Uint8Array(256), palette },
        ]),
      /15/,
    ),
    "a name too long was written",
  );
  sure(
    refuses(() => maps.writeWad([mapTextures()[0], mapTextures()[0]]), /twice/),
    "a texture was written twice",
  );
  sure(
    refuses(
      () => maps.writeWad([{ name: "{rgb", image: { width: 16, height: 16, rgb: new Uint8Array(768) } }]),
      /rgba/,
    ),
    "a texture with holes from a picture with no alpha",
  );
  sure(
    refuses(() => maps.readWad(Buffer.from("WAD2 and nothing more")), /Quake/),
    "a Quake .wad was read",
  );
  sure(
    refuses(() => maps.readWad(tworooms), /not a \.wad/),
    "a map was read as a .wad",
  );
});

test("a map that wants its textures from a .wad says so, and they are found in a game's folder", () => {
  const wanting = maps.readBsp(wantsWad);
  sure(
    wanting.textures.every((texture) => !texture.embedded),
    "pixels inside the map that wants a wad",
  );
  sure(maps.embeddedTexture(wanting, WALL) === null, "embeddedTexture of a texture that is not inside");
  const wanted = maps.wantedTextures(wanting);
  sure(wanted.wads.join() === "tworooms.wad", `wads wanted: ${wanted.wads}`);
  sure(wanted.textures.join() === `${FLOOR},${WALL},${GRATE}`, `textures wanted: ${wanted.textures}`);
  sure(
    maps.wantedTextures(bsp).textures.length === 0 && maps.wantedTextures(bsp).wads.length === 0,
    "the other map wants none",
  );
  // the paths a mapper's machine leaves in the key come down to file names
  sure(
    maps.listedWads("\\half-life\\valve\\HalfLife.WAD;C:/x/decals.wad;gfx/pldecal.wad;;my").join() ===
      "halflife.wad,decals.wad,my.wad",
    "listedWads",
  );

  const empty = join(tmp, "no-wads-here");
  mkdirSync(empty, { recursive: true });
  const found = maps.wadsFor(wanting, [empty, FIXTURES]);
  sure(
    found.found.length === 1 &&
      found.found[0].path === join(FIXTURES, "tworooms.wad") &&
      !found.missing.length,
    "wadsFor",
  );
  sure(maps.wadsFor(wanting, [empty]).missing.join() === "tworooms.wad", "a wad that is not there");
  // a map in a mod's maps/ has its .wad files looked for in the mod's folder over it, as the game does
  sure(JSON.stringify(maps.mapOwnFolders(join("mod", "maps", "a.bsp"))) === JSON.stringify([join("mod", "maps"), "mod"]) && maps.mapOwnFolders(join("work", "a.bsp")).length === 1, "maps/ and the mod over it");
  const textures = maps.texturesFor(wanting, [empty, FIXTURES], { pixels: true });
  sure(textures.textures.length === 3 && !textures.missing.length, "texturesFor");
  sure(
    textures.textures.every((texture) => texture.wad === "tworooms.wad" && texture.texture.width > 0),
    "their pixels",
  );
  sure(maps.texturesFor(wanting, [empty]).missing.length === 3, "textures of a wad that is not there");

  // checkBsp tells the same: lost for GoldSrc, which stops on a .wad it cannot open; found with the folder
  const lost = maps.checkBsp(wantsWad, { folders: [empty] });
  sure(
    lost.errors.some((error) => /tworooms\.wad/.test(error) && /couldn't open/.test(error)),
    `errors: ${lost.errors}`,
  );
  sure(
    maps.checkBsp(wantsWad, { engine: "xash", folders: [empty] }).errors.length === 0,
    "the same for Xash is an error",
  );
  const here = maps.checkBsp(wantsWad, { folders: [FIXTURES] });
  sure(!here.errors.length && !here.warnings.length, `${here.errors} ${here.warnings}`);
  sure(
    here.facts.some((fact) => /1 of 1 \.wad files, 3 of 3 textures/.test(fact)),
    `facts: ${here.facts.join(" | ")}`,
  );
  const unasked = maps.checkBsp(wantsWad);
  sure(
    !unasked.errors.length && unasked.facts.some((fact) => /no game folders were given/.test(fact)),
    "with no folders",
  );
});

test("checkBsp passes the map for both engines, and reports a broken one without throwing", () => {
  for (const engine of ["goldsrc", "xash"]) {
    const result = maps.checkBsp(tworooms, { engine });
    sure(!result.errors.length, result.errors.join("; "));
    sure(!result.warnings.length, result.warnings.join("; "));
    sure(result.counts.faces === 43 && result.counts.entities === 5, "counts");
    sure(
      result.facts.some((fact) => /43 faces/.test(fact)),
      "facts",
    );
  }
  // over what an engine holds is an error, and near it a warning (the limit lowered for the case, and put back)
  const facesHeld = maps.MAP_LIMITS.goldsrc.faces;
  try {
    maps.MAP_LIMITS.goldsrc.faces = 40;
    sure(maps.checkBsp(tworooms).errors.join() === "43 faces: goldsrc holds 40", "over a limit");
    sure(!maps.checkBsp(tworooms, { engine: "xash" }).errors.length, "the other engine's limit");
    maps.MAP_LIMITS.goldsrc.faces = 50;
    sure(
      maps.checkBsp(tworooms).warnings.join() === "43 faces: near the 50 that goldsrc holds",
      "near a limit",
    );
  } finally {
    maps.MAP_LIMITS.goldsrc.faces = facesHeld;
  }
  sure(maps.MAP_LIMITS.goldsrc.leaves === 32767 && maps.MAP_LIMITS.xash.models === 2048, "the limits");
  // the files its entities name are listed
  const withSprite = maps.withEntities(
    tworooms,
    maps.addEntity(bsp.entities, "env_sprite", [96, 96, 64], { model: "sprites/glow01.spr" }),
  );
  const named = maps.checkBsp(withSprite);
  sure(named.resources.sprites.join() === "sprites/glow01.spr", "resources");
  sure(
    named.facts.some((fact) => /name 1 sprites: sprites\/glow01\.spr/.test(fact)),
    "the sprite among the facts",
  );

  const cut = maps.checkBsp(tworooms.subarray(0, tworooms.length - 3000));
  sure(cut.errors.length === 1 && /textures lump.*cut short/.test(cut.errors[0]), `a cut map: ${cut.errors}`);
  sure(/124/.test(maps.checkBsp(tworooms.subarray(0, 60)).errors[0]), "a stub");
  sure(/not a GoldSrc map/.test(maps.checkBsp(Buffer.from("not a map at all".repeat(20))).errors[0]), "junk");
  // a lump that is not a whole number of entries
  const ragged = Buffer.from(tworooms);
  ragged.writeInt32LE(bsp.lumps.faces.length - 1, 4 + bsp.lumps.faces.slot * 8 + 4);
  sure(
    maps.checkBsp(ragged).errors.some((error) => /faces lump.*funny lump size/.test(error)),
    "a ragged lump",
  );
  // a face that names a plane the map does not have
  const wild = Buffer.from(tworooms);
  wild.writeUInt16LE(60000, bsp.lumps.faces.offset);
  sure(
    maps.checkBsp(wild).errors.some((error) => /faces name a plane/.test(error)),
    "a wild plane",
  );
  // an entity on a model that is not there
  const orphaned = maps.withEntities(tworooms, maps.setKey(bsp.entities, GRATE_WALL, "model", "*9"));
  const orphanedResult = maps.checkBsp(orphaned);
  sure(
    orphanedResult.errors.some((error) => /\*9/.test(error)),
    "an entity on a model the map has not",
  );
  sure(
    orphanedResult.warnings.some((warning) => /belong to no entity.*\*1/.test(warning)),
    "the model left without an entity",
  );
  sure(
    refuses(() => maps.checkBsp(tworooms, { engine: "source" }), /goldsrc or xash/),
    "an engine it does not know",
  );
});
