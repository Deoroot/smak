// Ground in plan and maps from a drawing (make/maps/ground.mjs, sketch.mjs; turned and a standing terrain in
// source.mjs): spaces of any outline carved with no gap and no overlap, the planes through whole points, sky
// that is sky all round, paths and curves, brushes turned with their pictures, an SVG's shapes and layers and
// a PNG's colours read as spaces, and `smak sketch`.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../check/maps/index.mjs";
import { png } from "../core/image.mjs";
import { test, sure, near, tmp, runSmak } from "./helper.mjs";

const folder = join(tmp, "map-ground");
mkdirSync(folder, { recursive: true });

/** Whether a point is inside a brush, by its planes, within `margin`. */
const inside = (planes, p, margin) =>
  planes.every((q) => q.normal[0] * p[0] + q.normal[1] * p[1] + q.normal[2] * p[2] - q.dist <= margin);
/** A random number from a seed, the same each run. */
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

test("carvePlan: an L, a round yard open to the sky with a well in it and a bending street, with no gap and no overlap", () => {
  const spaces = [
    { name: "hall", outline: [[0, 0], [512, 0], [512, 256], [256, 256], [256, 512], [0, 512]], floor: 0, ceiling: 256, texture: "HALL" }, // prettier-ignore
    { name: "yard", rings: [maps.circle([1100, 700], 300, { sides: 12 }), maps.circle([1100, 700], 60, { sides: 6 })], floor: 0, ceiling: 512, texture: { floor: "STONE", ceiling: "sky" } }, // prettier-ignore
    {
      name: "street",
      outlines: maps.path(
        maps.curve([
          [400, 100],
          [700, 200],
          [900, 500],
        ]),
        128,
      ),
      floor: 0,
      ceiling: 256,
    },
  ];
  const brushes = maps.carvePlan(spaces, 16, { floor: "FLOOR", ceiling: "CEIL", wall: "WALL" });
  sure(
    brushes.every((brush) => !maps.shapeOf(brush).faults.length),
    "every brush is sound",
  );
  const made = spaces.map((space, nth) => maps.planSpace(space, nth));
  const planes = brushes.map(maps.planesOf);
  const random = seeded(7);
  let neither = 0;
  let both = 0;
  for (let i = 0; i < 4000; i++) {
    const p = [-15.9 + random() * 1431.8, -15.9 + random() * 1031.8, -15.9 + random() * 543.8];
    const open = maps.spaceAt(made, p) >= 0;
    if (!open && !planes.some((brush) => inside(brush, p, 0.01))) neither++;
    if (open && planes.some((brush) => inside(brush, p, -0.01))) both++;
  }
  sure(neither === 0, `every point is rock or space (${neither} are neither)`);
  sure(both === 0, `no point is both (${both} are)`);
  // the well is rock, the yard's floor stone, the hall's walls its own
  sure(
    planes.some((brush) => inside(brush, [1100, 700, 100], 0)),
    "the well in the yard is rock",
  );
  const worn = new Set(brushes.flatMap((brush) => brush.faces.map((face) => face.texture)));
  for (const name of ["HALL", "STONE", "sky", "WALL", "FLOOR"]) sure(worn.has(name), `${name} is worn`);
  // the rock over the yard is sky all round, as the compilers want a brush of sky
  for (const brush of brushes)
    if (brush.faces.some((face) => face.texture === "sky"))
      sure(
        brush.faces.every((face) => face.texture === "sky"),
        "a brush with a face of sky is sky all round",
      );
  // the planes are written through whole points but where two outlines cross
  const plan = maps.checkPlan({ brushes, entities: [maps.playerStart([100, 100, 0])] });
  sure(!plan.errors.length, `the plan has no error: ${plan.errors.join("; ")}`);
});

test("carvePlan refuses what is no space, and a corner that hardly turns is made straight", () => {
  const refused = (spaces) => {
    try {
      maps.carvePlan(spaces, 16, "W");
      return "";
    } catch (error) {
      return error.message;
    }
  };
  sure(
    /three points/.test(
      refused([
        {
          outline: [
            [0, 0],
            [1, 1],
          ],
          floor: 0,
          ceiling: 64,
        },
      ]),
    ),
    "two points refused",
  );
  sure(
    /ceiling/.test(
      refused([
        {
          outline: [
            [0, 0],
            [64, 0],
            [0, 64],
          ],
          floor: 64,
          ceiling: 64,
        },
      ]),
    ),
    "no height refused",
  );
  sure(
    /no area/.test(
      refused([
        {
          outline: [
            [0, 0],
            [64, 0],
            [128, 0],
          ],
          floor: 0,
          ceiling: 64,
        },
      ]),
    ),
    "a line refused",
  );
  const space = maps.planSpace({
    outline: [
      [0, 0],
      [100, 0],
      [200, 0.3],
      [300, 0],
      [300, 300],
      [0, 300],
    ],
    floor: 0,
    ceiling: 64,
  });
  sure(
    space.areas[0][0].length === 4,
    `the corner 0.3 off the line is taken out (${space.areas[0][0].length} corners)`,
  );
});

test("path: one outline along a bend, its loop on the inside of a tight bend cut off", () => {
  const [outline, ...more] = maps.path(
    [
      [0, 0],
      [400, 0],
      [400, 400],
    ],
    128,
  );
  sure(!more.length, "one outline");
  const space = maps.planSpace({ outline, floor: 0, ceiling: 64 });
  sure(
    maps.spaceAt([space], [200, 0, 10]) === 0 && maps.spaceAt([space], [400, 200, 10]) === 0,
    "along both legs",
  );
  sure(maps.spaceAt([space], [450, -50, 10]) === 0, "the outer corner mitred");
  sure(maps.spaceAt([space], [200, 200, 10]) === -1, "not inside the bend");
  const tight = maps.path(
    maps.curve(
      [
        [0, 0],
        [100, 0],
        [100, 60],
        [0, 60],
      ],
      { pieces: 8 },
    ),
    128,
  );
  sure(
    tight.length === 1 && tight[0].length >= 4,
    "a bend tighter than the path is wide still makes one outline",
  );
});

test("turned: a brush turned about a point, its picture kept on its face; a terrain stood up as a cliff", () => {
  const brush = maps.box([0, 0, 0], [128, 64, 32], "W");
  const quarter = maps.shapeOf(maps.turned(brush, 90, [64, 32, 0]));
  sure(!quarter.faults.length, "sound");
  sure(
    quarter.min.join() === "32,-32,0" && quarter.max.join() === "96,96,32",
    `a quarter turn: ${quarter.min} ${quarter.max}`,
  );
  const turned = maps.turned(brush, 30, [10, 20, 0]);
  near(maps.shapeOf(turned).volume, 128 * 64 * 32, 128 * 64 * 32 * 0.01, "the volume kept (the corners are rounded to whole units, within 1%)");
  const top = brush.faces.findIndex((face) => face.points.every((point) => point[2] === 32));
  const at = (face, p) =>
    [0, 1].map((k) => {
      const axis = k ? face.v : face.u;
      return (axis[0] * p[0] + axis[1] * p[1] + axis[2] * p[2]) / face.scale[k] + axis[3];
    });
  const angle = Math.PI / 6;
  const p = [50, 30, 32];
  const q = [
    10 + 40 * Math.cos(angle) - 10 * Math.sin(angle),
    20 + 40 * Math.sin(angle) + 10 * Math.cos(angle),
    32,
  ];
  const before = at(brush.faces[top], p);
  const after = at(turned.faces[top], q);
  near(after[0], before[0], 1e-6, "the picture's u at the turned point");
  near(after[1], before[1], 1e-6, "the picture's v at the turned point");
  const cliff = maps.terrain({ min: [0, 0], max: [256, 128], step: [64, 64], base: 0, height: (y, z) => 32 + ((y * 7 + z * 3) % 24), texture: "ROCK", axis: "x" }); // prettier-ignore
  sure(
    cliff.every((piece) => !maps.shapeOf(piece).faults.length),
    "the cliff's pieces are sound",
  );
  sure(
    maps.shapeOf(cliff[0]).max[2] === 64 && maps.shapeOf(cliff[0]).min[0] === 0,
    "it stands: its heights run along x",
  );
});

test("readSvgSketch and sketchSpaces: a layer's keys, a label's, a hole, a stroke as a corridor; text and notes left out", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">
    <g inkscape:groupmode="layer" inkscape:label="ground floor=0">
      <path id="path1" inkscape:label="yard ceiling=sky" style="fill:#c8c8c8" d="M 0,0 H 400 V 400 H 0 Z M 150,150 h 100 v 100 h -100 z" />
      <path id="path2" inkscape:label="lane ceiling=sky" style="fill:none;stroke:#806040;stroke-width:96" d="M 400,200 C 600,200 700,300 800,500" />
      <circle id="circle3" inkscape:label="kind=start yaw=90" cx="50" cy="50" r="10" style="fill:#00ff00" />
      <rect id="rect4" inkscape:label="kind=skip" x="0" y="0" width="10" height="10" style="fill:#000" />
      <rect id="rect5" x="900" y="900" width="50" height="50" style="fill:#123456" />
    </g>
    <g inkscape:label="hut floor=16 height=128" transform="translate(-300,0)">
      <polygon inkscape:label="hut light=150" points="300,0 260,0 260,-200 300,-200" style="fill:#d06040" />
    </g>
    <text x="5" y="5">a note</text>
  </svg>`;
  const shapes = maps.readSvgSketch(svg);
  const yard = shapes.find((shape) => shape.keys.name === "yard");
  sure(yard && yard.areas[0].length === 2, "the yard with its hole");
  sure(
    yard.areas[0][0].some(([x, y]) => x === 400 && y === -400),
    "+y of the map is up the drawing",
  );
  const lane = shapes.find((shape) => shape.keys.name === "lane");
  sure(lane && lane.outlines.length === 1, "the lane a corridor");
  near(lane.width, 96, 1e-9, "the corridor's width");
  const hut = shapes.find((shape) => shape.keys.name === "hut");
  sure(
    hut.keys.floor === 16 && hut.keys.height === 128 && hut.areas[0][0].every(([x]) => x <= 0),
    "the hut's group keys and transform",
  );
  const sketch = maps.sketchSpaces(shapes, { names: { lane: { texture: "MUD" } } });
  sure(sketch.spaces.length === 3, `three spaces: ${sketch.spaces.map((space) => space.name)}`);
  sure(sketch.starts.length === 1 && sketch.starts[0].yaw === 90, "one start");
  sure(
    sketch.lights.length === 1 && sketch.lights[0].at[2] === 16 + 128 - 24,
    "the hut's lamp under its ceiling",
  );
  sure(
    sketch.skipped.length === 1 && /floor/.test(sketch.skipped[0].why),
    "the unnamed rect told as left out",
  );
  const space = (name) => sketch.spaces.find((each) => each.name === name);
  sure(
    space("yard").ceiling === space("lane").ceiling && space("yard").ceiling > 144,
    "sky over every height",
  );
  sure(
    space("lane").texture.ceiling === "sky" && space("lane").texture.floor === "MUD",
    "the legend's name, and sky",
  );
  const map = maps.sketchMap(sketch, { texture: "ROCK" });
  sure(
    map.entities.some((entity) => entity.classname === "light_environment"),
    "the sun, for a sky",
  );
  sure(!maps.checkPlan(map).errors.length, "a sound plan");
});

test("readPngSketch: each colour of the legend a space, grown over its neighbours, black lines rock; smak sketch", () => {
  const [W, H] = [120, 80];
  const rgba = new Uint8Array(W * H * 4).fill(255);
  const put = (x, y, c) => rgba.set([...c, 255], (y * W + x) * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (x >= 10 && x < 60 && y >= 10 && y < 70) put(x, y, [200, 200, 200]);
      if (x >= 60 && x < 100 && y >= 30 && y < 50) put(x, y, [140, 100, 60]);
    }
  for (let y = 10; y < 70; y++) put(35, y, [0, 0, 0]);
  const file = join(folder, "sketch.png");
  writeFileSync(file, png(W, H, rgba));
  const colours = {
    "#c8c8c8": { name: "hall", floor: 0, height: 128 },
    "#8c643c": { name: "lane", floor: 0, height: 96 },
  };
  const shapes = maps.readPngSketch(readFileSync(file), { colours, scale: 8 });
  sure(shapes.length === 2, "two colours");
  const hall = shapes.find((shape) => shape.colour === "#c8c8c8");
  sure(hall.areas[0].length === 2, `the black line parts the hall in two (${hall.areas[0].length} patches)`);
  const lane = shapes.find((shape) => shape.colour === "#8c643c");
  sure(Math.min(...lane.areas[0][0].map(([x]) => x)) < 60 * 8, "the lane grown over the hall it meets");
  sure(
    Math.max(...hall.areas[0].flat().map(([, y]) => y)) === (H - 10) * 8,
    "the picture's bottom at y 0, its top up",
  );
  writeFileSync(join(folder, "legend.json"), JSON.stringify({ colours, texture: "ROCK" }));
  const said = runSmak(
    "sketch",
    file,
    "-o",
    join(folder, "sketch.map"),
    "--legend",
    join(folder, "legend.json"),
  );
  sure(/2 spaces/.test(said) && /written/.test(said), `smak sketch: ${said}`);
  const map = maps.readMap(readFileSync(join(folder, "sketch.map"), "utf8"));
  sure(
    map.brushes.length > 4 && map.entities.some((entity) => entity.classname === "info_player_start"),
    "the .map written",
  );
});

test("pieces: a spiral stair walked round its column, a bridge at an angle, a balcony, a broken wall, rough rock", () => {
  const spiral = maps.spiralStairs({
    centre: [0, 0],
    inner: 32,
    outer: 128,
    from: 0,
    to: 256,
    texture: "STEP",
  });
  sure(
    spiral.brushes.length === 17 && spiral.brushes.every((brush) => !maps.shapeOf(brush).faults.length),
    "16 steps and a column, sound",
  );
  near(spiral.top[2], 256, 1e-9, "its top");
  const tops = spiral.brushes.slice(0, 16).map((brush) => maps.shapeOf(brush).max[2]);
  sure(
    tops.every((top, k) => k === 0 || top - tops[k - 1] === 16),
    "each step 16 over the one before",
  );
  const refused = (call) => {
    try {
      call();
      return "";
    } catch (error) {
      return error.message;
    }
  };
  sure(
    /player's 72/.test(
      refused(() =>
        maps.spiralStairs({
          centre: [0, 0],
          outer: 64,
          inner: 16,
          from: 0,
          to: 300,
          tread: 60,
          texture: "S",
        }),
      ),
    ),
    "a turn with no headroom refused",
  );
  sure(
    /walks up/.test(
      refused(() =>
        maps.spiralStairs({ centre: [0, 0], outer: 128, from: 0, to: 64, rise: 32, texture: "S" }),
      ),
    ),
    "a step of 32 refused",
  );
  const span = maps.bridge({
    from: [0, 0],
    to: [300, 200],
    z: 96,
    width: 96,
    piers: 1,
    ground: -128,
    texture: "WOOD",
  });
  sure(
    span.every((brush) => !maps.shapeOf(brush).faults.length) && span.length >= 4,
    "a bridge at an angle, its rails and pier sound",
  );
  const deck = maps.shapeOf(span[0]);
  sure(deck.max[2] === 96 && deck.min[2] === 80, "the deck's top at z");
  const out = maps.balcony({
    wall: [
      [0, 0],
      [128, 0],
    ],
    depth: 64,
    z: 128,
    texture: "WOOD",
  });
  sure(maps.shapeOf(out[0]).max[1] === 64, "a balcony stands out to the left of its wall's line");
  const ruin = maps.brokenWall({
    from: [0, 0],
    to: [512, 0],
    bottom: 0,
    top: 192,
    pieces: 8,
    gaps: 0.25,
    seed: 3,
    texture: "STONE",
  });
  sure(
    ruin.length === 8 && ruin.every((brush) => !maps.shapeOf(brush).faults.length),
    "a broken wall in 8 sound pieces",
  );
  sure(new Set(ruin.map((brush) => maps.shapeOf(brush).max[2])).size > 2, "its top is jagged");
  const rock = maps.rockWall({ from: [0, 0], to: [0, 256], bottom: 0, top: 128, depth: 24, texture: "ROCK" });
  const shapes = rock.map((brush) => maps.shapeOf(brush));
  sure(
    shapes.every((shape) => !shape.faults.length),
    "rough rock is sound",
  );
  sure(
    Math.max(...shapes.map((shape) => shape.max[0])) === 0 &&
      Math.min(...shapes.map((shape) => shape.min[0])) >= -24.5,
    "it stands out to the left (here -x), no further than its depth",
  );
});

test("a sketch's slope, rough walls, spiral and bridge; additions by hand kept when it is made again", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">
    <rect inkscape:label="cave floor=0 height=192 rough=16" x="0" y="0" width="400" height="300" style="fill:#806040" />
    <rect inkscape:label="ramp floor=0 height=256 slope=64 toward=east" x="400" y="100" width="256" height="100" style="fill:#a09070" />
    <rect inkscape:label="yard floor=64 ceiling=sky" x="656" y="0" width="600" height="400" style="fill:#90b070" />
    <circle inkscape:label="kind=spiral floor=64 to=256" cx="1100" cy="200" r="140" style="fill:#c0a080" />
    <path inkscape:label="kind=bridge z=64 width=64" style="fill:none;stroke:#8a5a2a;stroke-width:64" d="M 700,50 L 900,350" />
  </svg>`;
  const sketch = maps.sketchSpaces(maps.readSvgSketch(svg));
  const ramp = sketch.spaces.find((space) => space.name === "ramp");
  sure(ramp.slope.rise === 64 && ramp.slope.toward === 0, "the ramp's slope, east");
  near(maps.slopePlane(ramp).at(656, -150), 64, 1e-9, "the ramp's top at its east side");
  sure(
    sketch.pieces.some((piece) => piece.kind === "spiral") &&
      sketch.pieces.some((piece) => piece.kind === "bridge"),
    "a spiral and a bridge",
  );
  const map = maps.sketchMap(sketch, { texture: "ROCK" });
  const detail = map.entities.find((entity) => entity.classname === "func_detail");
  sure(detail && detail.brushes.length > 10, "rough rock in a func_detail");
  // no rough rock in the cave's mouth, where the ramp opens from it (x 400, y -100 to -200)
  const inMouth = detail.brushes.some((brush) => {
    const shape = maps.shapeOf(brush);
    return shape.max[0] > 380 && shape.min[1] < -110 && shape.max[1] > -190;
  });
  sure(!inMouth, "the cave's mouth left open");
  sure(!maps.checkPlan(map).errors.length, "a sound plan");
  // made again over the map a person added a crate and a sound to
  const file = join(folder, "kept.map");
  const svgFile = join(folder, "kept.svg");
  writeFileSync(svgFile, svg);
  runSmak("sketch", svgFile, "-o", file, "--no-keep");
  const crate = maps.box([100, -200, 0], [148, -152, 48], "CRATE");
  const edited = maps.readMap(readFileSync(file, "utf8"));
  edited.entities.push(maps.brushEntity("func_wall", [crate]), {
    classname: "ambient_generic",
    origin: "200 -150 100",
  });
  writeFileSync(file, maps.writeMap(edited).replace(/\( 0 64 0 \)/g, "( 0.000000 64.000000 0.000000 )"));
  const said = runSmak("sketch", svgFile, "-o", file);
  sure(
    /kept what was added by hand: 0 brushes, 2 entities/.test(said),
    `the crate and the sound kept, nothing of the kit's twice: ${said}`,
  );
  const again = runSmak("sketch", svgFile, "-o", file);
  sure(/2 entities/.test(again), "and kept again the next time");
});

test("carvePlan outdoors: rock stops at a space's horizon, the air over it is empty, the ground under it never is; a ramp at an angle; terrain of an odd length", () => {
  const sky = { floor: "GRASS", ceiling: "sky" };
  const spaces = [
    { name: "yard", outline: [[0, 0], [512, 0], [512, 512], [0, 512]], floor: 0, ceiling: 640, texture: sky, horizon: 192 }, // prettier-ignore
    { name: "terrace", outline: [[512, 0], [900, 0], [900, 512], [512, 512]], floor: 96, ceiling: 640, texture: sky, horizon: 192 }, // prettier-ignore
    // a ramp turned 30 degrees, its corners on whole points that are not on its plane's own grid
    { name: "ramp", outline: [[100, 100], [239, 180], [199, 249], [60, 169]], floor: 0, ceiling: 640, texture: sky, slope: { rise: 64, toward: 30 } }, // prettier-ignore
  ];
  // the carve's own ceiling is the sky, as a sketch's legend for an outdoor map has it
  const brushes = maps.carvePlan(spaces, 16, { floor: "GRASS", ceiling: "sky", wall: "ROCK" });
  sure(
    brushes.every((brush) => !maps.shapeOf(brush).faults.length),
    "every brush is sound, the ramp's too",
  );
  const named = (face) => (typeof face.texture === "string" ? face.texture : face.texture?.name);
  const isSky = (brush) => brush.faces.some((face) => /^sky$/i.test(named(face)));
  const box = (brush) => {
    const points = maps.shapeOf(brush).faces.flatMap((face) => face.polygon);
    return [0, 1, 2].map((i) => [Math.min(...points.map((p) => p[i])), Math.max(...points.map((p) => p[i]))]);
  };
  sure(
    brushes.filter((brush) => box(brush)[2][1] <= 96).every((brush) => !isSky(brush)),
    "nothing under the floors is sky (the block's underside looks at no space)",
  );
  // the rock west of the yard: rock to its horizon (192), sky over it
  const west = brushes.filter((brush) => box(brush)[0][1] <= 0 && box(brush)[1][0] < 256 && box(brush)[1][1] > 256);
  sure(
    west.some((brush) => !isSky(brush) && box(brush)[2][1] === 192),
    "rock beside the yard up to its horizon",
  );
  sure(
    west.every((brush) => !isSky(brush) || box(brush)[0][1] <= -16 || box(brush)[2][0] >= 640),
    "no sky over it but the outer box: the air is empty above the horizon",
  );
  // the terrace's horizon is its own: rock beside it to 96 + 192
  const east = brushes.filter((brush) => box(brush)[0][0] >= 900);
  sure(
    east.some((brush) => !isSky(brush) && box(brush)[2][1] === 288),
    `rock beside the terrace to 288: ${east.map((brush) => box(brush)[2].join("..")).join(", ")}`,
  );
  // a terrain whose length is no whole number of steps: no column a hair wide
  const length = 498.8596997152606;
  const rock = maps.terrain({ min: [0, 0], max: [length, 96], step: [length / 10, 48], base: 0, height: () => 24, texture: "ROCK" }); // prettier-ignore
  sure(
    rock.length === 40 && rock.every((brush) => !maps.shapeOf(brush).faults.length),
    `ten columns of two rows, two prisms a cell, all sound (${rock.length})`,
  );
});

test("carvePlan: a wall's texture stands on the floor of the space it faces and starts at its corner, at an angle too", () => {
  // two rooms 16 apart, the second 40 higher and 24 further north, and a round one of 8 sides on a floor of 16
  const round = maps.circle([900, 300], 100, { sides: 8 });
  const spaces = [
    { name: "first", outline: [[0, 0], [256, 0], [256, 256], [0, 256]], floor: 0, ceiling: 128 },
    { name: "second", outline: [[272, 24], [528, 24], [528, 280], [272, 280]], floor: 40, ceiling: 168 },
    { name: "round", outline: round, floor: 16, ceiling: 144, texture: { wall: { name: "W", scale: 2, offset: [3, 5] } } },
  ]; // prettier-ignore
  const faces = maps.carvePlan(spaces, 16, { floor: "F", ceiling: "C", wall: "W" }).flatMap((brush) => brush.faces.filter((face) => face.texture === "W")); // prettier-ignore
  const at = (x, normal) => faces.filter((face) => face.points.every((p) => Math.abs(p[0] - x) < 1e-6) && Math.round(maps.planeOf(face.points).normal[0]) === normal); // prettier-ignore
  const offsets = (list) => JSON.stringify(list.map((f) => [f.u[3], f.v[3]]));
  sure(at(256, -1).length && at(256, -1).every((face) => face.u[3] === 0 && face.v[3] === 0), offsets(at(256, -1)));
  sure(at(272, 1).length && at(272, 1).every((face) => face.u[3] === -24 && face.v[3] === 40), offsets(at(272, 1)));
  // the round room's walls, each at its angle, by its own corner in its texture's scale: along +y on those
  // that look along x most, along +x on the others
  const least = [0, 1].map((k) => Math.min(...round.map((p) => p[k])));
  // (the faces of rock beside it: the rock under its floor and over its ceiling is cut along the same lines, unseen)
  const heights = (brush) => brush.faces.map((face) => maps.planeOf(face.points)).filter((plane) => Math.abs(plane.normal[2]) > 0.99).map((plane) => plane.dist * plane.normal[2]); // prettier-ignore
  const inRound = maps
    .carvePlan(spaces, 16, { floor: "F", ceiling: "C", wall: "W" })
    .filter((brush) => Math.min(...heights(brush)) < 144 && Math.max(...heights(brush)) > 16)
    .flatMap((brush) => brush.faces.filter((face) => face.texture === "W"))
    .filter((face) => face.points.every((p) => Math.hypot(p[0] - 900, p[1] - 300) < 101));
  sure(inRound.length >= 8, `${inRound.length} faces in the round room`);
  for (const face of inRound) {
    const normal = maps.planeOf(face.points).normal;
    const corner = least[Math.abs(normal[0]) >= Math.abs(normal[1]) ? 1 : 0];
    near(face.u[3], 3 - corner / 2, 1e-9, `u of a face looking ${normal.map((v) => v.toFixed(2)).join(" ")}`);
    near(face.v[3], 5 + 16 / 2, 1e-9, "v");
  }
});

test("carvePlan: a room with a horizon has its rock to its roof line and air over it up to one sky box; a room without keeps its rock to the slab; the map stays sealed", () => {
  const rect = (x0, x1) => [[x0, 0], [x1, 0], [x1, 300], [x0, 300]];
  const spaces = [
    { name: "yard", outline: rect(0, 400), floor: 0, ceiling: 900, horizon: 352, texture: { floor: "F", ceiling: "sky", wall: "W" } },
    { name: "roofed", outline: rect(500, 700), floor: 0, ceiling: 160, horizon: 352 },
    { name: "plain", outline: rect(800, 1000), floor: 0, ceiling: 160 },
  ];
  const brushes = maps.carvePlan(spaces, 16, { floor: "F", ceiling: "C", wall: "W" });
  /** The textures of the faces of the brush that holds a point, "" for open air. */
  const at = (x, z, y = 150) => {
    const brush = brushes.find((b) => maps.holds(b, [x, y, z]));
    return brush ? [...new Set(brush.faces.map((f) => f.texture))].sort().join("+") : "";
  };
  sure(at(600, 100) === "", "the room is open inside");
  sure(at(600, 200) !== "" && !/sky/.test(at(600, 200)), `its roof is stone: ${at(600, 200)}`);
  sure(at(600, 340) !== "" && !/sky/.test(at(600, 340)), `its rock stands to the horizon: ${at(600, 340)}`);
  sure(at(600, 368 + 100) === "", `a point 100 over its roof is empty air: ${at(600, 468)}`);
  sure(at(300, 600) === "", "and over the yard's rim");
  sure(at(900, 600) !== "" && !/sky/.test(at(900, 600)), `a room without a horizon keeps stone to the slab: ${at(900, 600)}`);
  sure(at(600, 900 + 30) === "sky", `the slab is sky: ${at(600, 930)}`);
  sure(at(600, 900 + 90) === "", "above the slab is outside");
  sure(at(-60, 400) === "sky" && at(1060, 400) === "sky" && at(500, 400, -40) === "sky" && at(500, 400, 340) === "sky", "the four walls are sky");
  const map = { worldspawn: { wad: "x.wad" }, brushes, entities: [maps.playerStart([200, 150, 0], 0), maps.light([200, 150, 100])] };
  const open = maps.checkPlan(map).warnings.filter((w) => /OPEN/.test(w));
  sure(!open.length, `no leak hint: ${open.join(" | ")}`);
  const errors = maps.checkPlan(map, { leak: false }).errors;
  sure(!errors.length, errors.join(" | "));
});

// ── a sketch's spiral as a stair, its top at a door; a pool; a street that dies in rock ──
const SKETCH_WAD = join(folder, "sketch.wad");
const flat = (r, g, b) => ({ width: 16, height: 16, rgb: new Uint8Array(16 * 16 * 3).map((_, i) => [r, g, b][i % 3]) });
writeFileSync(SKETCH_WAD, maps.writeWad(["FLOOR", "CEIL", "WALL", "STEP", "TILE", "!POOL"].map((name, i) => ({ name, image: flat(40 * i, 90, 160) })))); // prettier-ignore
const SVG = (body) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">${body}</svg>`;
// a portico with a gallery over it (one outline, a slab between), a spiral from the one to the other
const STACKED = `<rect inkscape:label="portico floor=0 height=176" x="0" y="0" width="512" height="256" fill="#b0a080"/>
  <rect inkscape:label="gallery floor=192 height=160" x="0" y="0" width="512" height="256" fill="#b0a080"/>
  <circle inkscape:label="up kind=spiral floor=0 to=192 steps=STEP inner=24" cx="128" cy="128" r="100" fill="#b0a080"/>
  <rect inkscape:label="go kind=start floor=0 yaw=0" x="400" y="100" width="64" height="64" fill="#00ff00"/>`;
// a stair hall with the shaft 100 round in it and a door at the top's height 28 beyond the shaft, onto a gallery
const HALL = `<rect inkscape:label="hall floor=0 height=352" x="0" y="16" width="240" height="256" fill="#d06040"/>
  <rect inkscape:label="door_up floor=192 height=112" x="88" y="0" width="64" height="16" fill="#d06040"/>
  <rect inkscape:label="gallery floor=192 height=160" x="-200" y="-200" width="640" height="200" fill="#b0a080"/>
  <circle inkscape:label="up kind=spiral floor=0 to=192 steps=STEP inner=24" cx="120" cy="144" r="100" fill="#d06040"/>
  <rect inkscape:label="go kind=start floor=0 yaw=90" x="200" y="240" width="32" height="32" fill="#00ff00"/>`;
const POOL = `<rect inkscape:label="bath floor=0 height=192 light=150 texture=TILE,CEIL,WALL" x="0" y="0" width="400" height="448" fill="#d06040"/>
  <rect inkscape:label="basin kind=pool depth=48 water=!POOL rim=16" x="100" y="100" width="200" height="248" fill="#4080c0"/>
  <rect inkscape:label="go kind=start floor=0 yaw=90" x="40" y="400" width="32" height="32" fill="#00ff00"/>`;
const sketched = (body) => {
  const sketch = maps.sketchSpaces(maps.readSvgSketch(SVG(body)));
  return { sketch, map: maps.sketchMap(sketch, { texture: { floor: "FLOOR", ceiling: "CEIL", wall: "WALL" }, worldspawn: { wad: [SKETCH_WAD] } }) }; // prettier-ignore
};
const wearing = (brush, name) => brush.faces.every((face) => (face.texture?.name ?? face.texture) === name);
const boxOf = (brushes) => {
  const shapes = brushes.map((brush) => maps.shapeOf(brush));
  return [0, 1, 2].map((i) => [Math.min(...shapes.map((s) => s.min[i])), Math.max(...shapes.map((s) => s.max[i]))]);
};

test("a sketch's spiral: its steps wear steps=; each a wedge one rise thick on whole units, rising a step at most, its underside the top of the one before; a landing at a door beside the shaft", () => {
  const { map } = sketched(STACKED);
  const steps = map.brushes.filter((brush) => wearing(brush, "STEP"));
  sure(steps.length === 12, `12 steps wearing STEP, not ${steps.length}`);
  const shapes = steps.map((brush) => maps.shapeOf(brush)).sort((a, b) => a.max[2] - b.max[2]);
  sure(
    shapes.every((shape, k) => !shape.faults.length && shape.max[2] - shape.min[2] === 16 && shape.max[2] - (k ? shapes[k - 1].max[2] : 0) <= 18 && shape.min[2] === (k ? shapes[k - 1].max[2] : 0)), // prettier-ignore
    "each wedge one rise thick, its underside the top of the one before, no rise over 18",
  );
  sure(steps.every((brush) => brush.faces.every((face) => face.points.every((p) => p.every(Number.isInteger)))), "corners on whole units"); // prettier-ignore
  sure(!maps.checkPlan(map, { wads: [SKETCH_WAD], leak: false }).warnings.some((w) => /off the grid/.test(w)), "the column on whole units too"); // prettier-ignore
  // in the hall the top faces the door and a bridge reaches its sill (the door's edge at y -16), 192 high, 64 wide
  const hall = sketched(HALL).map.brushes.filter((brush) => wearing(brush, "STEP"));
  const landing = hall.map((brush) => maps.shapeOf(brush)).find((shape) => shape.max[2] === 192 && shape.max[1] >= -16);
  sure(hall.length === 13 && landing && landing.min[2] === 176 && landing.max[0] - landing.min[0] === 64, `a bridge from the last step to the door's sill: ${hall.length} step brushes, ${landing && JSON.stringify([landing.min, landing.max])}`); // prettier-ignore
});

test("a sketch's pool: a space sunk in its room's floor, a func_water to 8 under the floor, a kerb astride its edge, rock under it; the plan sound", () => {
  const { sketch, map } = sketched(POOL);
  const basin = sketch.spaces.find((space) => space.name === "basin");
  sure(basin?.floor === -48 && basin.ceiling === 0 && basin.texture.wall === "TILE", "48 under the bath's floor, wearing its floor's texture"); // prettier-ignore
  const water = map.entities.filter((entity) => entity.classname === "func_water");
  sure(water.length === 1 && Number(water[0].skin) === -3 && water[0].brushes.every((brush) => wearing(brush, "!POOL")), "one func_water, water inside, the water's texture"); // prettier-ignore
  const box = boxOf(water[0].brushes);
  sure(JSON.stringify(box) === JSON.stringify([[100, 300], [-348, -100], [-48, -8]]), `the water fills the pool to 8 under the floor: ${JSON.stringify(box)}`); // prettier-ignore
  const kerb = map.brushes.filter((brush) => wearing(brush, "TILE") && maps.shapeOf(brush).max[2] === 16 && maps.shapeOf(brush).min[2] === 0); // prettier-ignore
  sure(kerb.length === 4, `a kerb of four pieces, not ${kerb.length}`);
  sure(map.brushes.some((brush) => maps.shapeOf(brush).max[2] === -48 && maps.shapeOf(brush).min[2] === -64), "rock under the pool's bottom: the block's bottom follows the lowest floor"); // prettier-ignore
  const plan = maps.checkPlan(map, { wads: [SKETCH_WAD] });
  sure(!plan.errors.length && !plan.warnings.length, `a sound plan: ${[...plan.errors, ...plan.warnings].join("; ")}`);
  sure(/a pool in no space/.test(maps.sketchSpaces(maps.readSvgSketch(SVG(POOL.replace('x="100" y="100"', 'x="1000" y="100"')))).skipped[0]?.why), "a pool outside every space is left out, and said"); // prettier-ignore
});

test("a street under the sky that ends in rock is warned of, by its end; a space there, or dead=ok, quiets it", () => {
  const lane = (more, keys = "") =>
    maps.sketchSpaces(maps.readSvgSketch(SVG(`<rect inkscape:label="yard floor=0 ceiling=sky" x="0" y="0" width="300" height="300" fill="#c0c0c0"/><rect inkscape:label="lane floor=0 ceiling=sky ${keys}" x="300" y="100" width="640" height="100" fill="#c0c0c0"/>${more}`))).warnings; // prettier-ignore
  sure(lane("").join() === "the street lane ends in a blind wall at its east end: give it a door, a gate or another space there, or make it a yard", `the lane's east end: ${lane("")}`); // prettier-ignore
  sure(!lane('<rect inkscape:label="court floor=16 ceiling=sky" x="940" y="0" width="300" height="300" fill="#c0c0c0"/>').length, "a court a step up at its end opens it"); // prettier-ignore
  sure(!lane("", "dead=ok").length, "dead=ok means it");
  const bent = maps.sketchSpaces(maps.readSvgSketch(SVG(`<path inkscape:label="road floor=0 ceiling=sky" d="M 0 0 L 400 0 L 400 400" fill="none" stroke="#8a6a40" stroke-width="128"/>`))).warnings; // prettier-ignore
  sure(bent.length === 2 && /west end/.test(bent[0]) && /south end/.test(bent[1]), `a bent road blind at both ends: ${bent.join(" | ")}`); // prettier-ignore
});

// with the compilers: the spiral walked from storey to storey and onto the door's gallery on foot; the pool compiled
const compilers = process.env[maps.COMPILERS_VARIABLE] ? maps.findCompilers() : { found: false };
if (!compilers.found)
  console.log(`skip  a sketch's spiral walked and its pool compiled\n      skipped: no compilers (name the folder of VHLT in ${maps.COMPILERS_VARIABLE} to run it)`); // prettier-ignore
else
  test("compiled: a spiral's shaft opens into the storey over it, its top lands on the door beside it, both walked on foot; a pool compiles", () => {
    for (const [name, body] of [["stacked", STACKED], ["hall", HALL], ["pool", POOL]]) {
      const file = join(folder, `${name}.map`);
      writeFileSync(file, maps.writeMap(sketched(body).map));
      const result = maps.compileMap(file, { wads: [SKETCH_WAD], compilers, fast: true, timeout: 120000 });
      sure(!result.errors.length && result.leak === null, `${name} compiles: ${result.errors.join("; ")}`);
      if (name === "pool") continue; // the walker does not swim: the pool is its one-way place
      const reach = maps.reachOf(maps.readBsp(readFileSync(result.bsp)));
      const jumped = reach.parts.filter((part) => part.floors[1] >= 192);
      sure(!jumped.length && reach.share === 1, `${name}: the upper floor walked on foot: ${reach.warnings.join("; ")} ${jumped.map((part) => part.why).join("; ")}`); // prettier-ignore
    }
  });

// a turned drawing: each corner turned and rounded on its own lands a few tenths off the line it was drawn on; the
// carve welds an edge onto the longer edge's line it was drawn on (plaza-01's south portico, a shop and its door, and the
// Chalke drawn touching its court, as drawn: 12 degrees round 2200 1500)
const TURNED = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="4096" height="3072">
  <g inkscape:label="city" transform="rotate(-12 2200 1500)">
    <rect inkscape:label="portico floor=0 height=176 horizon=352" x="1432" y="2012" width="1536" height="192" fill="#b0a080"/>
    <rect inkscape:label="shop floor=0 height=160 horizon=352" x="1944" y="2220" width="240" height="256" fill="#d06040"/>
    <rect inkscape:label="door_shop floor=0 height=128 horizon=352" x="2032" y="2204" width="64" height="16" fill="#d06040"/>
    <rect inkscape:label="chalke floor=0 height=320 horizon=352" x="2968" y="1628" width="256" height="256" fill="#d0b090"/>
    <rect inkscape:label="court floor=0 ceiling=sky horizon=352" x="3224" y="1628" width="512" height="512" fill="#c8c8c8"/>
    <rect inkscape:label="prefecture floor=0 height=192 horizon=352" x="2984" y="1180" width="512" height="384" fill="#d06040"/>
    <rect inkscape:label="cells floor=0 height=160 horizon=352" x="3512" y="1180" width="256" height="384" fill="#a04030"/>
    <rect inkscape:label="door_cells floor=0 height=112 horizon=352" x="3496" y="1340" width="16" height="64" fill="#a04030"/>
  </g>
</svg>`;

test("carvePlan welds a turned drawing: a door's end on its room's wall, two spaces drawn touching, the planes of one line shared", () => {
  const sketch = maps.sketchSpaces(maps.readSvgSketch(TURNED), {});
  const brushes = maps.carvePlan(sketch.spaces, 16, "WALL");
  const shapes = brushes.map(maps.shapeOf);
  const planes = shapes.flatMap((shape) => shape.faces.filter((face) => face.normal && Math.abs(face.normal[2]) < 0.5)).map(({ normal, dist }) => (normal[1] < 0 || (normal[1] === 0 && normal[0] < 0) ? { normal: normal.map((v) => -v), dist: -dist } : { normal, dist })); // prettier-ignore
  let apart = 0;
  for (let i = 0; i < planes.length; i++)
    for (let j = i + 1; j < planes.length; j++) {
      const [p, q] = [planes[i], planes[j]];
      const turn = Math.hypot(p.normal[0] - q.normal[0], p.normal[1] - q.normal[1]);
      const off = Math.abs(p.dist - q.dist);
      if (turn < 2e-3 && off < 1 && !(turn < 1e-7 && off < 1e-6)) apart++;
    }
  sure(apart === 0, `${apart} pairs of walls a hair apart: planes of one line not shared`);
  // no wedge of rock a few tenths thick (across the cells' door, between the Chalke and its court): each brush's
  // volume over its largest face is its thickness, near enough
  const thin = shapes.filter((shape) => shape.volume / Math.max(...shape.faces.map((face) => face.area)) < 1);
  sure(!thin.length, `${thin.length} wedges of rock under a unit thick: ${thin.map((shape) => shape.min.map(Math.round).join(" ")).join(", ")}`); // prettier-ignore
});

test("sketchFrame: a drawing's group rotate(-12 2200 1500) is frame({ at: [2200, -1500, 0], yaw: 12 }), its points where the sketch puts them", () => {
  const f = maps.sketchFrame(TURNED);
  sure(f.yaw === 12 && f.at.join() === "2200,-1500,0", `the frame: at ${f.at}, yaw ${f.yaw}`);
  const drawn = maps.readSvgSketch(TURNED, { grid: 0 }).find((shape) => shape.keys.name === "shop").areas[0][0][0];
  f.point([1944 - 2200, -(2220 - 1500), 0]).slice(0, 2).forEach((v, k) => near(v, drawn[k], 1e-5, "the shop's corner by the frame"));
  const nested = '<svg><g transform="translate(100 50)"><g transform="rotate(30)"><rect x="10" y="20" width="5" height="5" fill="#fff"/></g></g></svg>'; // prettier-ignore
  const g = maps.sketchFrame(nested);
  const corner = maps.readSvgSketch(nested, { grid: 0 })[0].areas[0][0][0];
  g.point([10, -20, 0]).slice(0, 2).forEach((v, k) => near(v, corner[k], 1e-5, "a translate over a rotate"));
  sure(maps.sketchFrame('<svg><rect x="1" fill="#fff"/></svg>').yaw === 0, "a drawing with no transform: no turn");
  let said = "";
  try {
    maps.sketchFrame('<svg><g transform="scale(2)"><rect fill="#fff"/></g></svg>');
  } catch (error) {
    said = error.message;
  }
  sure(/stretches or skews/.test(said), `a stretch refused: ${said}`);
});

if (compilers.found)
  test("compiled: the turned drawing welded gives hlbsp no ambiguous leaf (unwelded: 3 at the door's jambs)", () => {
    const sketch = maps.sketchSpaces(maps.readSvgSketch(TURNED), {});
    const file = join(folder, "turned.map");
    writeFileSync(file, maps.writeMap(maps.sketchMap(sketch, { wall: 16, texture: "WALL", worldspawn: { wad: [SKETCH_WAD] } }))); // prettier-ignore
    const made = maps.compileMap(file, { wads: [SKETCH_WAD], compilers, fast: true, engine: "xash", vis: false, light: false }); // prettier-ignore
    sure(made.bsp, made.errors.join("; "));
    const ambiguous = (made.logs.find((log) => log.tool === "hlbsp").text.match(/Ambiguous leafnode/g) ?? []).length;
    sure(ambiguous === 0, `${ambiguous} ambiguous leaves: ${made.warnings.join(" | ")}`);
  });
