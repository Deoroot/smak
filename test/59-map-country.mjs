// The country of an outdoor map: cliffs that lean along its rock (pieces.mjs `cliffWall`, the sketch's `cliff`
// key) and the land round it as a model seen over the walls (backdrop.mjs `backdropModel`).
import * as maps from "../check/maps/index.mjs";
import { check } from "../check/check.mjs";
import { readMdl } from "../core/mdl.mjs";
import { test, sure } from "./helper.mjs";

test("cliffWall: leaning pieces along the line, none under the top, uneven tops, feet kept off the clear boxes", () => {
  const line = {
    from: [0, 0],
    to: [1200, 0],
    bottom: 0,
    top: 160,
    rise: 160,
    foot: 96,
    seed: 3,
    texture: "rock",
  };
  const brushes = maps.cliffWall(line);
  sure(brushes.length >= 10, `pieces along 1200 units (${brushes.length})`);
  const points = (brush) => brush.faces.flatMap((face) => face.points);
  // every piece stands to the LEFT of the line (+y here) and reaches the top at least where it meets the line
  sure(
    brushes.every((brush) => points(brush).every((p) => p[1] >= -0.5)),
    "every piece on the space's side",
  );
  // the faces (a scree at a foot is low, and stands off the line)
  const faces = brushes.filter((brush) => points(brush).some((p) => Math.abs(p[1]) < 1 && p[2] > 0));
  const tops = faces.map((brush) => Math.max(...points(brush).map((p) => p[2])));
  // the skyline along the line: at every place the rock stands to the top (160) at least, hiding a plumb wall
  const skyline = [];
  for (let u = 40; u <= 1160; u += 40) {
    const here = faces.filter((brush) => { const xs = points(brush).map((p) => p[0]); return Math.min(...xs) <= u && Math.max(...xs) >= u; }); // prettier-ignore
    skyline.push(Math.max(...here.map((brush) => Math.max(...points(brush).map((p) => p[2])))));
  }
  sure(Math.min(...skyline) >= 160, `the rock stands to its top all along (lowest ${Math.min(...skyline)})`);
  sure(
    new Set(tops.map((z) => Math.round(z / 16))).size >= 4,
    `the skyline is not one line (${[...new Set(tops)].length} heights)`,
  );
  // a face that leans: points of one piece out from the line at the foot and near it at the top
  const leans = brushes.filter((brush) => {
    const ps = points(brush);
    const foot = Math.max(...ps.filter((p) => p[2] <= 0).map((p) => p[1]));
    const high = Math.max(...ps.filter((p) => p[2] >= 150).map((p) => p[1]), 0);
    return foot > high + 10;
  });
  sure(leans.length >= brushes.length / 3, "the faces lean back");
  // a house by the wall: no foot comes into its box
  const clear = [{ min: [400, 20], max: [700, 400] }];
  const kept = maps.cliffWall({ ...line, clear });
  const inside = kept.filter((brush) =>
    points(brush).some((p) => p[2] <= 0 && p[0] > 400 && p[0] < 700 && p[1] > 20),
  );
  sure(inside.length === 0, "the feet keep out of the clear box");
  // a sketch's `cliff` key makes them along its rock, not along the edge where it opens into another space
  const yard = {
    outline: [
      [0, 0],
      [1000, 0],
      [1000, 800],
      [0, 800],
    ],
    floor: 0,
    ceiling: 600,
    horizon: 160,
    name: "yard",
  };
  const lane = {
    outline: [
      [1000, 300],
      [1400, 300],
      [1400, 500],
      [1000, 500],
    ],
    floor: 0,
    ceiling: 600,
    horizon: 160,
    name: "lane",
  };
  const sketch = { spaces: [maps.planSpace(yard), maps.planSpace(lane)] };
  sketch.spaces[0].cliff = { rise: 120, foot: 80, seed: 1 };
  const made = maps.sketchMap(sketch, { texture: "rock" });
  const cliffs = made.entities
    .filter((each) => each.classname === "func_detail")
    .flatMap((each) => each.brushes);
  sure(cliffs.length > 8, "the yard has cliffs");
  const mouth = cliffs.filter((brush) =>
    points(brush).some((p) => p[0] > 990 && p[1] > 310 && p[1] < 490 && p[2] < 100),
  );
  sure(mouth.length === 0, "none across the lane's mouth");
});

test("backdropModel: a ring of hills round a map's box, made round the entity's place, fit for the engine", () => {
  const bounds = { min: [-1000, -800], max: [1200, 900] };
  const land = maps.backdropModel({ bounds, origin: [-500, -300, 8], far: 9000, texture: [128, 128] });
  const report = check(land.mdl, "goldsrc");
  sure(report.errors.length === 0, `no error (${report.errors.join("; ")})`);
  const mdl = readMdl(land.mdl);
  const corners = mdl.bodyparts.length;
  sure(land.far >= 9000, `MaxRange wanted: ${land.far}`);
  sure(land.facts[0].includes("ring of hills"), "it says what it made");
  sure(mdl.textures.length === 1, "one picture");
  void corners;
});

test("reliefOf: hummocks and banks over a space, level where it opens, walkable; scatter keeps off the clear boxes", () => {
  const meadow = maps.planSpace({
    outline: [
      [0, 0],
      [1600, 0],
      [1600, 1200],
      [0, 1200],
    ],
    floor: 0,
    ceiling: 600,
    name: "meadow",
  });
  const lane = maps.planSpace(
    {
      outline: [
        [1600, 500],
        [2200, 500],
        [2200, 700],
        [1600, 700],
      ],
      floor: 0,
      ceiling: 600,
      name: "lane",
    },
    1,
  );
  const sides = [
    { from: [0, 0], to: [1600, 0] },
    { from: [0, 1200], to: [0, 0] },
  ];
  const made = maps.reliefOf({
    space: meadow,
    others: [lane],
    sides,
    amp: 24,
    bank: 48,
    texture: "grass",
    seed: 2,
  });
  sure(made.brushes.length > 50, `a field of triangles (${made.brushes.length})`);
  sure(made.steep === 0, "none steeper than a player walks");
  // the bank stands up by the rock, the ground is level where the lane comes in
  sure(
    made.heightAt(800, 20) > made.heightAt(800, 600) + 10,
    `a bank by the rock (${made.heightAt(800, 20)} by it, ${made.heightAt(800, 600)} in the middle)`,
  );
  sure(
    made.heightAt(1590, 600) <= 8,
    `level at the lane's mouth, under a step (${made.heightAt(1590, 600)})`,
  );
  const clear = [{ min: [600, 400], max: [1000, 800] }];
  const strewn = maps.scatter({ places: [{ space: meadow, sides, groundAt: made.heightAt }], clear, seed: 4, density: 80,
    palette: [{ kind: "stone", weight: 1, texture: "rock", size: [[24, 48], [16, 32]] }, { kind: "model", weight: 1, model: "models/x.mdl", size: [[0, 0], [0, 0]] }] }); // prettier-ignore
  const models = strewn.entities.filter((e) => e.classname === "env_model");
  sure(strewn.facts.stones + strewn.facts.models > 10, `things strewn (${JSON.stringify(strewn.facts)})`);
  const origin = (e) => (Array.isArray(e.keys?.origin) ? e.keys.origin : (e.origin ?? e.keys?.origin));
  sure(models.every((e) => { const o = origin(e); return !(o[0] > 600 && o[0] < 1000 && o[1] > 400 && o[1] < 800); }), "none in the clear box"); // prettier-ignore
});

test("reliefOf patches, trail, a fringe of tree lines: painted ground, a path along a line, cards repeated", () => {
  const meadow = maps.planSpace({
    outline: [
      [0, 0],
      [1600, 0],
      [1600, 1200],
      [0, 1200],
    ],
    floor: 0,
    ceiling: 600,
    name: "meadow",
  });
  const sides = [{ from: [0, 0], to: [1600, 0] }];
  // patches: about the share asked of the triangles wear the other ground, and stand over the floor to wear it
  const made = maps.reliefOf({ space: meadow, sides, amp: 0, bank: 0, texture: "grass", patches: [{ texture: "earth", share: 0.2 }], seed: 2 }); // prettier-ignore
  const tops = made.brushes.map((brush) => brush.faces.find((face) => face.points.every((p) => p[2] > -1)));
  const earth = tops.filter((face) => face?.texture === "earth");
  sure(
    made.painted > 0 && Math.abs(made.painted / ((1600 / 96) * (1200 / 96) * 2) - 0.2) < 0.08,
    `a fifth painted (${made.painted})`,
  );
  sure(earth.length === made.painted, `each painted triangle a brush wearing it on top (${earth.length})`);
  sure(
    earth.every((face) => face.points.some((p) => p[2] >= 2)),
    "lifted over the floor",
  );
  // a trail: its middle over the ground, its edges under it, its picture's columns across the way it runs
  const way = maps.trail({ points: [[100, 600], [800, 600], [1500, 900]], width: 192, groundAt: () => 10, texture: { name: "path", size: [256, 256] } }); // prettier-ignore
  sure(way.brushes.length > 40, `a ribbon (${way.brushes.length} pieces)`);
  const zs = way.brushes.flatMap((brush) => brush.faces.flatMap((face) => face.points.map((p) => p[2])));
  sure(Math.max(...zs) === 13 && zs.includes(8), "its middle 3 over the ground, its edges 2 under");
  const first = way.brushes[0].faces.find((face) => face.texture === "path");
  sure(
    Math.abs(first.u[1]) > 0.99 && Math.abs(first.scale[0] - 0.75) < 1e-6,
    `the columns run across a path going east (u ${first.u.slice(0, 3)})`,
  );
  // the corners cut: the line through the middle bends smoothly (no two pieces turn by more than 25 degrees)
  const turns = way.along.slice(2).map((p, i) => { const [a, b] = [way.along[i], way.along[i + 1]]; const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]), t2 = Math.atan2(p[1] - b[1], p[0] - b[0]); return Math.abs(t2 - t1) * 57.3; }); // prettier-ignore
  sure(Math.max(...turns) < 25, `smooth bends (${Math.max(...turns).toFixed(1)} degrees)`);
  // a fringe row of tree lines, tiled: long cards whose picture keeps its shape and repeats
  const rows = maps.scatter({ places: [{ space: meadow, sides, groundAt: () => 0 }], palette: [{ kind: "stone", weight: 1, texture: "rock", size: [[8, 8], [8, 8]] }], density: 0, seed: 1,
    fringe: [{ textures: [{ name: "{trees", size: [512, 256] }], tile: true, length: [600, 800], height: [300, 300], gap: [-100, -50], inset: [8, 24] }] }); // prettier-ignore
  const cards = rows.entities.filter((e) => e.classname === "func_illusionary").flatMap((e) => e.brushes);
  sure(rows.facts.fringes >= 2, `tree lines along the rock (${rows.facts.fringes})`);
  const broad = cards[0].faces.find((face) => typeof face.texture === "string" && face.texture === "{trees" && Math.abs(face.scale[0] - face.scale[1]) < 1e-9 && Math.abs(face.scale[1] - 300 / 256) < 1e-6); // prettier-ignore
  sure(broad, "the picture kept in its shape: as wide a texel as high");
});

test("ambience, learnDetails, detailText: sounds strewn over a place, the game's detail textures learnt and written", () => {
  const meadow = maps.planSpace({
    outline: [
      [0, 0],
      [2400, 0],
      [2400, 2400],
      [0, 2400],
    ],
    floor: 0,
    ceiling: 600,
    name: "meadow",
  });
  const sides = [{ from: [0, 0], to: [2400, 0] }];
  const heard = maps.ambience({ places: [{ space: meadow, sides, groundAt: () => 10 }], density: 4, seed: 2,
    sounds: [{ file: "wind.wav", heard: "large", least: 1, volume: [5, 5] }, { file: "birds.wav", heard: "medium", byWall: 1, volume: [4, 6] }] }); // prettier-ignore
  const keys = (e) => e.keys ?? e;
  const wind = heard.entities.filter((e) => keys(e).message === "wind.wav");
  const birds = heard.entities.filter((e) => keys(e).message === "birds.wav");
  sure(
    heard.entities.every((e) => e.classname === "ambient_generic"),
    "ambient_generic each",
  );
  sure(wind.length >= 1 && Number(keys(wind[0]).spawnflags) === 8, "the wind at least once, heard far");
  sure(birds.length >= 1, `birds (${birds.length})`);
  const at = (e) => { const o = keys(e).origin; return Array.isArray(o) ? o : String(o).split(" ").map(Number); }; // prettier-ignore
  sure(
    birds.every((e) => at(e)[1] <= 3 * 72),
    "the birds by the rock",
  );
  sure(
    heard.entities.every((e) => at(e)[2] === 58),
    "an eye's height over the ground",
  );
  const table = maps.learnDetails(["rock_ewok detail/tl_rock 5.0 5.0\nGrass detail/tl_grass 4 4", "rock_ewok detail/tl_rock 5.0 5.0\nrock_ewok detail/tl_rock2 2 2\n// a note"]); // prettier-ignore
  sure(
    table.get("rock_ewok").detail === "detail/tl_rock" && table.get("rock_ewok").uses === 2,
    "the most used, by name in lower case",
  );
  const made = maps.detailText(["ROCK_EWOK", "grass", "other", "{card"], table, { fallback: (n) => (n === "other" ? { detail: "detail/x", scale: [3, 3] } : null) }); // prettier-ignore
  sure(
    made.text === "ROCK_EWOK detail/tl_rock 5.0 5.0\ngrass detail/tl_grass 4.0 4.0\nother detail/x 3.0 3.0\n",
    `the file (${JSON.stringify(made.text)})`,
  );
  sure(made.left.join() === "{card", "what nothing gave is told");
});

test("scatter's fringe: a tree too wide for a short side stands across it, past its corners, and none is left out", () => {
  const nook = maps.planSpace({
    outline: [
      [0, 0],
      [300, 0],
      [300, 900],
      [0, 900],
    ],
    floor: 0,
    ceiling: 600,
    name: "nook",
  });
  const sides = [{ from: [0, 0], to: [300, 0] }];
  const rows = maps.scatter({ places: [{ space: nook, sides, groundAt: () => 0 }], palette: [{ kind: "stone", weight: 1, texture: "rock", size: [[8, 8], [8, 8]] }], density: 0, seed: 2,
    fringe: [{ textures: [{ name: "{tree", size: [256, 256] }], keepShape: true, height: [448, 448], gap: [-100, -50], inset: [8, 8] }] }); // prettier-ignore
  sure(rows.facts.fringes === 1, `one tree across the short side (${rows.facts.fringes})`);
  const xs = rows.entities
    .flatMap((e) => e.brushes ?? [])
    .flatMap((b) => b.faces.flatMap((f) => f.points.map((p) => p[0])));
  sure(
    Math.min(...xs) < 0 && Math.max(...xs) > 300,
    `past both corners (${Math.min(...xs)} to ${Math.max(...xs)})`,
  );
});

test("ruin and SIZES: broken walls round a footprint, a door's gap the game's size, at any turn; brokenWall on a slant", () => {
  sure(
    maps.SIZES.settlement.door.wide[1] === 64 && maps.SIZES.dungeon.ceiling[1] === 216,
    "the game's sizes",
  );
  // a slanted broken wall's sloped tops stay in one plane (its corners were once rounded alone)
  sure(
    maps.brokenWall({
      from: [-201, 71],
      to: [-136, -108],
      thick: 16,
      bottom: -8,
      top: 166,
      low: 32,
      pieces: 3,
      seed: 7,
      texture: "s",
    }).length === 3,
    "a slanted wall",
  );
  for (const turn of [0, 37, 200, 291]) {
    const made = maps.ruin({ at: [100, 50], size: [384, 288], turn, texture: "stone", seed: turn + 1 });
    sure(made.brushes.length >= 8, `walls and stones at ${turn} degrees (${made.brushes.length})`);
  }
  // the door: walking out along the turn's way from the middle meets no wall within the door's half width
  const made = maps.ruin({ at: [0, 0], size: [384, 288], turn: 0, texture: "stone", seed: 3 });
  const walls = made.brushes.filter((b) => b.faces.some((f) => f.points.some((p) => p[2] > 60)));
  const front = walls.filter((b) => b.faces.every((f) => f.points.every((p) => p[0] > 130)));
  const ys = front.flatMap((b) => b.faces.flatMap((f) => f.points.map((p) => p[1])));
  const gap = [...new Set(ys.map(Math.round))].sort((a, b) => a - b);
  let widest = 0;
  for (let i = 1; i < gap.length; i++) widest = Math.max(widest, gap[i] - gap[i - 1]);
  sure(widest >= 60, `a door's gap in the front wall (${widest})`);
  sure(made.box.min[0] < -144 && made.box.max[1] > 192, "its box holds it");
});

test("house and fence: the towns' house at any turn, whole windows, its door facing the turn, things by its walls", () => {
  for (const turn of [0, 90, 37, 255])
    for (const storeys of [1, 2]) {
      const made = maps.house({ at: [200, -100], size: [384, 256], turn, storeys, seed: turn + storeys });
      const bad = made.brushes.filter((b) => maps.shapeOf(b).faults.length);
      sure(!bad.length, `every brush whole at ${turn}, ${storeys} storeys (${bad.length} not)`);
      sure(
        made.spots.length >= 6 && made.lamp[2] === made.floor + 100,
        `places by its walls, a lamp (${made.spots.length})`,
      );
      // the door's picture faces the turn's way
      const a = (turn * Math.PI) / 180;
      const doors = made.brushes.flatMap((b) => b.faces).filter((f) => f.texture === "door_36");
      const facing = doors.some((f) => { const n = maps.planeOf(f.points).normal; return n[0] * Math.cos(a) + n[1] * Math.sin(a) > 0.99; }); // prettier-ignore
      sure(facing, `its door faces ${turn}`);
    }
  // sizes come to whole bays; the upper storey's picture has its row 0 at the eaves (whole windows)
  const level = maps.house({ at: [0, 0], size: [300, 250], turn: 0, storeys: 2, seed: 4 });
  const upper = level.brushes.flatMap((b) => b.faces).filter((f) => /pk_dodwall02b/.test(f.texture) && maps.planeOf(f.points).normal[0] > 0.99); // prettier-ignore
  const front = upper.find((f) => Math.min(...f.points.map((p) => p[2])) > level.floor + 100);
  sure(front, "an upper front");
  const top = level.floor + 256; // two storeys of 128: the eaves
  const row = (top * front.v[2]) / front.scale[1] + front.v[3];
  sure(Math.abs(((row % 256) + 256) % 256) < 0.01, `the facade's top at the eaves (row ${row})`);
  const ys = level.brushes.flatMap((b) => b.faces.flatMap((f) => f.points.map((p) => p[1])));
  sure(Math.max(...ys) >= 128 && Math.max(...ys) < 200, "256 wide, its gable's eaves past it");
  // a fence: posts every 64 or so, two rails a length, on the ground
  const posts = maps.fence({
    points: [
      [0, 0],
      [256, 0],
      [256, 128],
    ],
    groundAt: (x) => x / 8,
  });
  sure(posts.length === 4 + 1 + 2 + 4 * 2 + 2 * 2, `posts and rails (${posts.length})`);
});

test("dressRoom, chamfered, pickSet: a carved room dressed for its use, its corners cut, its textures picked", () => {
  const cut = maps.chamfered(
    [
      [0, 0],
      [384, 0],
      [384, 256],
      [0, 256],
    ],
    32,
  );
  sure(
    cut.length === 8 && cut.some((p) => p[0] === 32 && p[1] === 0),
    `eight corners (${JSON.stringify(cut)})`,
  );
  const t = maps.pickSet("keep", 5);
  sure(typeof t.wall === "string" && typeof t.floor === "string" && t.door.name, "one of each list");
  const sketch = maps.sketchSpaces([{ outlines: [cut], keys: { name: "hall", floor: 0, height: 320, texture: { floor: t.floor, ceiling: t.ceiling, wall: t.wall } } }]); // prettier-ignore
  const map = maps.sketchMap(sketch, { texture: t.wall, wall: 32 });
  const place = map.places.find((p) => p.name === "hall");
  for (const use of ["hall", "store", "bedroom", "kitchen", "library", "crypt", "passage"]) {
    const made = maps.dressRoom({
      place,
      use,
      set: t,
      vault: use === "hall" ? 96 : null,
      dais: use === "hall",
      seed: 3,
    });
    const bad = [...made.brushes, ...made.cards].filter((b) => maps.shapeOf(b).faults.length);
    sure(!bad.length, `${use}: every brush whole (${bad.length} not)`);
    const torches = made.entities.filter((e) => e.model === maps.TORCH).length;
    sure(torches >= 2 && made.entities.filter((e) => e.classname === "light").length === torches, `${use}: torches and their light (${torches})`); // prettier-ignore
    for (const th of made.things)
      sure(th.at[0] > 0 && th.at[0] < 384 && th.at[1] > 0 && th.at[1] < 256, `${use}: ${th.name} inside`);
    if (use === "store") sure(made.things.length >= 2, `a store has things (${made.things.length})`);
  }
  // a doorway in the long wall (y 0, x 192): the base stops at it, no torch or pilaster stands in it
  const door = [192, 16, 48];
  const walled = maps.dressRoom({ place, use: "hall", set: t, seed: 3, torches: 96, doors: [door] });
  const inDoor = (b) => { const ps = b.faces.flatMap((f) => f.points); return ps.every((q) => q[1] < 64) && ps.some((q) => q[0] > 192 - 40 && q[0] < 192 + 40) && Math.min(...ps.map((q) => q[2])) < 100; }; // prettier-ignore
  sure(
    !walled.brushes.some(inDoor),
    `nothing stands low in the doorway (${walled.brushes.filter(inDoor).length})`,
  );
  const torchIn = walled.entities.filter((e) => e.model === maps.TORCH).map((e) => e.origin.split(" ").map(Number)).filter(([x, y]) => y < 64 && Math.abs(x - 192) < 80); // prettier-ignore
  sure(!torchIn.length, `no torch over the doorway (${JSON.stringify(torchIn)})`);
  // a pitched ceiling leans: faces under the ceiling looking down and sideways
  const hall = maps.dressRoom({ place, use: "hall", set: t, vault: 96, seed: 3 });
  const slopes = hall.brushes.flatMap((b) => b.faces).filter((f) => { const n = maps.planeOf(f.points).normal; return n[2] < -0.3 && n[2] > -0.95; }); // prettier-ignore
  sure(slopes.length >= 2, `a pitched ceiling (${slopes.length} sloped faces)`);
  // a gallery: a ledge at its height, a stair of its rise to it (loose: given back a step a brush), spots
  const top = (b) => Math.max(...b.faces.flatMap((f) => f.points.map((q) => q[2])));
  const up = maps.dressRoom({ place, use: "passage", set: t, seed: 3, gallery: { height: 64, length: 96, loose: true }, spots: 3 }); // prettier-ignore
  sure(up.gallery && up.gallery.top === 64, `a gallery at 64 (${JSON.stringify(up.gallery?.top)})`);
  sure(up.gallery.steps.length === 3 && up.gallery.steps.map(top).join() === "16,32,48", `its stair: ${up.gallery.steps.map(top)}`); // prettier-ignore
  sure(!up.brushes.some((b) => up.gallery.steps.includes(b)), "a loose stair is not among the brushes");
  sure(
    up.brushes.some((b) => top(b) === 64),
    "the ledge's slab tops at the gallery's height",
  );
  sure(up.spots.length === 3 && up.spots.every((s) => s.at[0] > 0 && s.at[0] < 384 && s.at[1] > 0 && s.at[1] < 256), `three spots kept, in the room (${JSON.stringify(up.spots)})`); // prettier-ignore
  const fixed = maps.dressRoom({ place, use: "hall", set: t, seed: 3, gallery: { height: 64, length: 96 } });
  sure(fixed.gallery && !fixed.gallery.steps && fixed.brushes.filter((b) => [16, 32, 48].includes(top(b))).length >= 3, "a fixed stair is among the brushes"); // prettier-ignore
});
