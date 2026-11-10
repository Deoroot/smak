// Ground in plan and maps from a drawing (src/maps/ground.mjs, sketch.mjs; turned and a standing terrain in
// source.mjs): spaces of any outline carved with no gap and no overlap, the planes through whole points, sky
// that is sky all round, paths and curves, brushes turned with their pictures, an SVG's shapes and layers and
// a PNG's colours read as spaces, and `smak sketch`.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as maps from "../src/maps/index.mjs";
import { png } from "../src/image.mjs";
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

test("carvePlan outdoors: rock over a space's horizon is sky, the ground under it never is; a ramp at an angle; terrain of an odd length", () => {
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
    west.some((brush) => isSky(brush) && box(brush)[2][0] >= 192),
    "sky over it",
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
