// Map making (make/maps/source.mjs, plan.mjs, compile.mjs): brushes written the way the compilers read them,
// a map's text written and read back, the plan looked over before a compile, and, where the compilers are
// installed, the compile itself.
//
// The compilers (VHLT) are an outside program. The cases that need them run when the VHLT_DIR environment
// variable names their folder, and print a "skip" line otherwise, so that the self-test passes without them.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import * as source from "../make/maps/source.mjs";
import { checkPlan, leakHint, wadTextureNames, SOURCE_LIMITS } from "../check/maps/plan.mjs";
import {
  findCompilers,
  compileMap,
  compileSummary,
  BAD_LINE,
  COMPILERS_VARIABLE,
} from "../make/maps/compile.mjs";
import { test, sure, near, tmp, HERE } from "./helper.mjs";

const { box, solid, prism, wedge, cylinder, cone, arch, bend, stairs, terrain, hollow, carve, subtract } =
  source;
const { shapeOf, planeOf, writeMap, readMap, textureAxes, light, playerStart } = source;

// ── what the cases share ──

/** What a call throws, as its message; "" when it throws nothing. */
const refusal = (call) => {
  try {
    call();
    return "";
  } catch (error) {
    return error.message;
  }
};

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const minus = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The outward normal of a face by the compilers' own sum, done here by hand and not by the kit:
 * cross(p0 - p1, p2 - p1), as qbsp and hlcsg take it. Not made of length 1.
 */
const compilersNormal = ([p0, p1, p2]) => cross(minus(p0, p1), minus(p2, p1));

/** A brush is sound, and holds about `volume` cubic units. */
const sureSolid = (brush, volume, what) => {
  const shape = shapeOf(brush);
  sure(!shape.faults.length, `${what}: ${shape.faults.join("; ")}`);
  near(shape.volume, volume, Math.max(1e-3, volume * 1e-6), `${what}: its volume`);
};

/** The planes of a brush as text that does not depend on which three points each was written with. */
const planeSet = (brush) =>
  brush.faces
    .map((face) => {
      const plane = planeOf(face.points);
      return [...plane.normal, plane.dist]
        .map((value) => (Math.round(value * 1e6) / 1e6 + 0).toFixed(6))
        .join(" ");
    })
    .sort()
    .join("\n");

// a sealed room of 256 x 256 x 128 with walls 16 thick, a light and a place to start
const ROOM_MIN = [0, 0, 0];
const ROOM_MAX = [256, 256, 128];
const WALL = 16;
const EAST_WALL = 3;
const TEXTURES = { floor: "SMAKFLOOR", ceiling: "SMAKCEIL", wall: "SMAKWALL" };
const sealedRoom = () => hollow(ROOM_MIN, ROOM_MAX, WALL, TEXTURES);
const roomEntities = () => [playerStart([64, 64, 0], 0), light([128, 128, 96])];
/** The room with its east wall taken away: a hole 256 wide and 128 tall at x = 256. */
const openRoom = () => sealedRoom().filter((_, number) => number !== EAST_WALL);

// ── brushes ──

test("a box has six planes that look outwards by the compilers' own sum, and are the reference's", () => {
  const min = [-784, -208, -16];
  const max = [-768, 208, 208];
  const brush = box(min, max, { top: "ms_floor01", bottom: "ms_wood01", sides: "ms_stnwall01" });
  sure(brush.faces.length === 6, `${brush.faces.length} faces`);
  const middle = [0, 1, 2].map((i) => (min[i] + max[i]) / 2);
  const seen = new Set();
  for (const face of brush.faces) {
    const normal = compilersNormal(face.points);
    // outwards: the middle of the box is behind the plane, and each corner is on it or behind it
    sure(
      dot(normal, minus(middle, face.points[1])) < 0,
      `a plane looks inwards: ${JSON.stringify(face.points)}`,
    );
    for (const x of [min[0], max[0]])
      for (const y of [min[1], max[1]])
        for (const z of [min[2], max[2]])
          sure(dot(normal, minus([x, y, z], face.points[1])) <= 0, "a corner is in front of a plane");
    seen.add(normal.map(Math.sign).join());
  }
  sure(seen.size === 6, "the six planes do not look six ways");
  // the lines the generator this was ported from wrote for the same box (its sala88.map, first brush)
  const reference = [
    "( -720 -208 208 ) ( -784 -208 208 ) ( -784 -144 208 ) ms_floor01 [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1",
    "( -784 -144 -16 ) ( -784 -208 -16 ) ( -720 -208 -16 ) ms_wood01 [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1",
    "( -768 -144 -16 ) ( -768 -208 -16 ) ( -768 -208 48 ) ms_stnwall01 [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 1 1",
    "( -784 -208 48 ) ( -784 -208 -16 ) ( -784 -144 -16 ) ms_stnwall01 [ 0 1 0 0 ] [ 0 0 -1 0 ] 0 1 1",
    "( -784 208 48 ) ( -784 208 -16 ) ( -720 208 -16 ) ms_stnwall01 [ 1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1",
    "( -720 -208 -16 ) ( -784 -208 -16 ) ( -784 -208 48 ) ms_stnwall01 [ 1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1",
  ];
  const written = writeMap({ brushes: [brush] }).split("\n");
  for (const line of reference) sure(written.includes(line), `the reference's line is not written: ${line}`);
  sureSolid(brush, 16 * 416 * 224, "the box");
  sure(
    /no size along y/.test(refusal(() => box([0, 0, 0], [8, 0, 8], "A"))),
    "a box with no size is not refused",
  );
});

test("a convex solid from a box's corners is that box, whatever the order; one that is not convex is refused", () => {
  const corners = [];
  for (const x of [0, 64]) for (const y of [-32, 32]) for (const z of [8, 24]) corners.push([x, y, z]);
  const fromPoints = solid(corners, "A");
  const theBox = box([0, -32, 8], [64, 32, 24], "A");
  sure(planeSet(fromPoints) === planeSet(theBox), "the solid's planes are not the box's");
  sure(planeSet(solid([...corners].reverse(), "A")) === planeSet(theBox), "the order of the points matters");
  for (const face of fromPoints.faces) {
    const normal = compilersNormal(face.points);
    sure(dot(normal, minus([32, 0, 16], face.points[1])) < 0, "a face of the solid looks inwards");
  }
  sureSolid(fromPoints, 64 * 64 * 16, "the solid");
  // a point inside the others: these are not the corners of a convex solid
  const dented = refusal(() => solid([...corners, [32, 0, 16]], "A"));
  sure(/inside the solid the other points make/.test(dented) && /32 0 16/.test(dented), `said: ${dented}`);
  // faces named by hand round an L-shaped outline: a corner in front of a face
  const outline = [[0, 0], [64, 0], [64, 32], [32, 32], [32, 64], [0, 64]]; // prettier-ignore
  const notConvex = refusal(() => prism("z", outline, 0, 16, "A"));
  sure(/not convex/.test(notConvex) && /several/.test(notConvex), `said: ${notConvex}`);
  sure(/no volume/.test(refusal(() => solid([[0, 0, 0], [8, 0, 0], [8, 8, 0], [0, 8, 0]], "A"))), "a flat set of points is not refused"); // prettier-ignore
  sure(/in a line/.test(refusal(() => solid([[0, 0, 0], [8, 0, 0], [16, 0, 0], [0, 8, 8]], "A", { faces: [[0, 1, 2]] }))), "a face in a line is not refused"); // prettier-ignore
});

test("prisms, wedges, cylinders and cones are sound solids of the right size, on any axis", () => {
  const triangle = [[0, 0], [16, 0], [0, 24]]; // prettier-ignore
  for (const axis of ["x", "y", "z"]) {
    sureSolid(prism(axis, triangle, -8, 56, "A"), ((16 * 24) / 2) * 64, `a prism along ${axis}`);
    sureSolid(
      prism(axis, [...triangle].reverse(), -8, 56, "A"),
      ((16 * 24) / 2) * 64,
      `the outline turned round`,
    );
  }
  // where the outline goes: along x its two numbers are y and z
  const along = shapeOf(prism("x", triangle, 100, 200, "A"));
  sure(
    along.min.join() === "100,0,0" && along.max.join() === "200,16,24",
    `along x: ${along.min} to ${along.max}`,
  );
  for (const high of ["+x", "-x", "+y", "-y"])
    sureSolid(wedge([0, 0, 0], [64, 32, 16], high, "A"), (64 * 32 * 16) / 2, `a wedge ${high}`);
  // the high side of a wedge is where its top is
  const ramp = shapeOf(wedge([0, 0, 0], [64, 32, 16], "+x", "A"));
  const topCorners = ramp.corners.filter((corner) => Math.abs(corner[2] - 16) < 1e-6);
  sure(
    topCorners.length === 2 && topCorners.every((corner) => Math.abs(corner[0] - 64) < 1e-6),
    "the wedge's top is not at +x",
  );
  const sides = 12;
  const polygon = (radius) => (sides / 2) * radius * radius * Math.sin((2 * Math.PI) / sides);
  sureSolid(cylinder("z", [10, 20], 16, 0, 32, "A"), polygon(16) * 32, "a cylinder");
  sureSolid(cone("z", [0, 0], 16, 0, 30, "A"), (polygon(16) * 30) / 3, "a cone");
  sureSolid(cone("y", [0, 0], 16, 30, 0, "A"), (polygon(16) * 30) / 3, "a cone that points down its axis");
  // cut off at half its radius: the whole cone less the top eighth of one twice as tall
  sureSolid(
    cone("z", [0, 0], 16, 0, 30, "A", { top: 8 }),
    (polygon(16) * 60) / 3 - (polygon(8) * 30) / 3,
    "a cone cut off",
  );
  const snappedOne = cylinder("z", [0, 0], 16, 0, 32, "A", { snap: 1 });
  sure(!source.offGrid(snappedOne).length, "a snapped cylinder has points off the grid");
  sure(
    source.offGrid(cylinder("z", [0, 0], 16, 0, 32, "A")).length > 0,
    "a cylinder's corners were expected off the grid",
  );
});

test("an arch, a bend, stairs and terrain are runs of sound convex pieces that leave no gap", () => {
  // an arched doorway: what is left of a 96 x 64 rectangle outside a half circle of radius 32
  const pieces = arch(
    "y",
    { centre: [0, 0], radius: 32, outer: { min: [-48, 0], max: [48, 64] }, pieces: 6 },
    0,
    16,
    "A",
  );
  sure(pieces.length === 6, `${pieces.length} pieces`);
  const halfHexagon = 6 * 0.5 * 32 * 32 * Math.sin(Math.PI / 6);
  let volume = 0;
  for (const piece of pieces) {
    sure(!shapeOf(piece).faults.length, shapeOf(piece).faults.join("; "));
    volume += shapeOf(piece).volume;
  }
  near(volume, (96 * 64 - halfHexagon) * 16, 1e-3, "the arch's pieces fill the rectangle outside the curve");
  // a ring: 8 pieces of a quarter turn
  const ring = arch("z", { centre: [0, 0], radius: 64, outer: 96, angles: [0, 90], pieces: 8 }, 0, 8, "A");
  const sector = (radius) => 8 * 0.5 * radius * radius * Math.sin(Math.PI / 16);
  near(
    ring.reduce((sum, piece) => sum + shapeOf(piece).volume, 0),
    (sector(96) - sector(64)) * 8,
    1e-3,
    "the ring's volume",
  );
  // a bend: a floor, a ceiling and two walls of 6 pieces; its ends are square to the axes at 0 and 90
  const turn = bend(
    { centre: [0, 0], inner: 64, outer: 160, floor: 0, ceiling: 112, angles: [0, 90] },
    TEXTURES,
  );
  sure(turn.length === 24 && turn.every((piece) => !shapeOf(piece).faults.length), "a bend's pieces");
  const ends = turn.flatMap((piece) => shapeOf(piece).corners);
  sure(
    Math.min(...ends.map((corner) => corner[0])) > -1e-6 &&
      Math.min(...ends.map((corner) => corner[1])) > -1e-6,
    "the bend's ends are not flat",
  );
  // the walkable space is open: a point in its middle is in no piece
  const walk = [112 * Math.cos(Math.PI / 4), 112 * Math.sin(Math.PI / 4), 56];
  sure(!turn.some((piece) => source.holds(piece, walk)), "the bend's passage is filled");
  sure(
    turn.some((piece) => source.holds(piece, [walk[0], walk[1], -8])),
    "the bend has no floor under its passage",
  );

  const flight = stairs([0, 0, 0], [128, 64, 64], "+x", "A");
  sure(flight.length === 4, `${flight.length} steps for 64 at 16 each`);
  sureSolid(flight[3], 32 * 64 * 16, "the top step");
  sure(
    shapeOf(flight[3]).min[0] === 96 && shapeOf(flight[3]).max[2] === 64,
    "the top step is not at the high end",
  );
  sure(
    /walks up 18 at most/.test(refusal(() => stairs([0, 0, 0], [64, 64, 64], "+x", "A", { steps: 2 }))),
    "steps of 32 are not refused",
  );

  // a ramp laid on the nosings: every step's front top edge on its slope, the foot one tread before the first
  // riser, the head at the top; the steps themselves as they were without it
  for (const [min, max, high, options] of [
    [[80, 0, 64], [344, 64, 240], "+x", { tread: 24, top: false }],
    [[464, 0, 0], [528, 64, 64], "-x", { tread: 16, top: false }],
    [[0, 0, 0], [64, 160, 80], "+y", {}],
    [[0, 0, 0], [64, 160, 80], "-y", {}],
  ]) {
    const plain = stairs(min, max, high, "A", options);
    const ramped = stairs(min, max, high, "A", { ...options, ramp: "CLIP" });
    sure(ramped.length === plain.length + 1, `${high}: the ramp is not one brush more`);
    const ramp = ramped.at(-1);
    sure(ramp.faces.every((face) => face.texture === "CLIP"), `${high}: the ramp is not all CLIP`);
    sure(!shapeOf(ramp).faults.length, `${high}: the ramp is not a sound brush: ${shapeOf(ramp).faults.join("; ")}`);
    const axis = high.endsWith("x") ? 0 : 1;
    const sign = high.startsWith("+") ? 1 : -1;
    for (const step of plain) {
      const shape = shapeOf(step);
      const nose = [...shape.min];
      nose[axis] = sign > 0 ? shape.min[axis] : shape.max[axis];
      nose[1 - axis] = (shape.min[1 - axis] + shape.max[1 - axis]) / 2;
      nose[2] = shape.max[2];
      const under = [...nose];
      under[2] -= 0.5;
      const over = [...nose];
      over[2] += 0.5;
      sure(source.holds(ramp, under) && !source.holds(ramp, over), `${high}: a step's nosing at ${nose} is not on the ramp`);
    }
  }

  // terrain that hangs from a lid at 288: two brushes a cell, each reaching its three heights
  const height = (x, y) => 200 + ((x + y) % 48) + 0.4;
  const rock = terrain({ min: [0, 0], max: [128, 64], step: [64, 64], base: 288, height, texture: "A" });
  sure(rock.length === 4, `${rock.length} brushes for two cells`);
  for (const piece of rock) {
    const shape = shapeOf(piece);
    sure(!shape.faults.length, shape.faults.join("; "));
    sure(
      !source.offGrid(piece).length,
      "a terrain brush has a point off the grid: heights are to be rounded",
    );
    for (const corner of shape.corners)
      if (corner[2] !== 288)
        near(corner[2], Math.round(height(corner[0], corner[1])), 1e-6, "a corner's height");
  }
  sure(/meets the base/.test(refusal(() => terrain({ min: [0, 0], max: [64, 64], step: [64, 64], base: 10, height: () => 10, texture: "A" }))), "a height at the base is not refused"); // prettier-ignore
  sure(/other side of the base/.test(refusal(() => terrain({ min: [0, 0], max: [64, 64], step: [64, 64], base: 10, height: (x) => (x ? 20 : 0), texture: "A" }))), "heights on both sides of the base are not refused"); // prettier-ignore
});

test("rooms: a box less a box keeps its volume, carved rooms are empty and wrapped, a hollow room is six walls", () => {
  const whole = { min: [0, 0, 0], max: [100, 100, 100] };
  const hole = { min: [20, 30, 40], max: [60, 70, 120] };
  const left = subtract(whole, hole);
  const size = (one) => (one.max[0] - one.min[0]) * (one.max[1] - one.min[1]) * (one.max[2] - one.min[2]);
  near(
    left.reduce((sum, one) => sum + size(one), 0),
    100 ** 3 - 40 * 40 * 60,
    1e-9,
    "what is left of the box",
  );
  sure(
    subtract(whole, { min: [200, 0, 0], max: [300, 10, 10] }).length === 1,
    "a hole that does not touch cut the box",
  );
  const rooms = [
    { min: [0, 0, 0], max: [128, 128, 96] },
    { min: [128, 32, 0], max: [256, 96, 96] },
  ];
  const rock = carve(rooms, 16, TEXTURES);
  const inAny = (point) => rock.some((piece) => source.holds(piece, point, -1e-6));
  sure(!inAny([64, 64, 48]) && !inAny([200, 64, 48]), "a carved room is filled");
  sure(
    inAny([200, 16, 48]) && inAny([64, 64, -8]) && inAny([264, 64, 48]),
    "the rock round the rooms is missing",
  );
  // seen from inside: the floor's picture on top of the rock below, the ceiling's under the rock above
  const below = rock.find((piece) => source.holds(piece, [64, 64, -8]));
  const top = below.faces.find((face) => planeOf(face.points).normal[2] > 0.5);
  sure(top.texture === "SMAKFLOOR", `the floor wears ${top.texture}`);
  const room = sealedRoom();
  sure(
    room.length === 6 && !room.some((wall) => source.holds(wall, [128, 128, 64])),
    "a hollow room is not empty",
  );
});

// ── textures ──

test("texture axes: the world's for a straight face, and for a slanted one the world's or the face's own", () => {
  const up = textureAxes([0, 0, 1]);
  sure(up.u.join() === "1,0,0" && up.v.join() === "0,-1,0", `a floor's axes: ${up.u} / ${up.v}`);
  const east = textureAxes([1, 0, 0]);
  sure(east.u.join() === "0,1,0" && east.v.join() === "0,0,-1", `an east wall's axes: ${east.u} / ${east.v}`);
  const north = textureAxes([0, -1, 0]);
  sure(
    north.u.join() === "1,0,0" && north.v.join() === "0,0,-1",
    `a south wall's axes: ${north.u} / ${north.v}`,
  );
  // a slope of 45 degrees that looks up and east: z wins the tie, as in the editors
  const slope = [Math.SQRT1_2, 0, Math.SQRT1_2];
  const world = textureAxes(slope);
  sure(world.u.join() === "1,0,0" && world.v.join() === "0,-1,0", "a slope's world axes are not the floor's");
  const own = textureAxes(slope, { align: "face" });
  near(dot(own.u, slope), 0, 1e-8, "the face's own u lies in the face");
  near(dot(own.v, slope), 0, 1e-8, "the face's own v lies in the face");
  near(Math.hypot(...own.u), 1, 1e-8, "u is of length 1");
  near(dot(own.u, own.v), 0, 1e-8, "u and v are square");
  // the picture is not stretched: a step of 1 along the slope moves 1 texel, and 0.707 with the world's axes
  const downSlope = [Math.SQRT1_2, 0, -Math.SQRT1_2];
  near(Math.abs(dot(own.u, downSlope)), 1, 1e-8, "the face's own axes stretch the picture");
  near(Math.abs(dot(world.u, downSlope)), Math.SQRT1_2, 1e-8, "the world's axes were expected to stretch it");
  // a quarter turn, anticlockwise seen from above: the picture's columns now run along +y
  const turned = textureAxes([0, 0, 1], { rotation: 90 });
  sure(turned.u.join() === "0,1,0" && turned.v.join() === "1,0,0", `turned: ${turned.u} / ${turned.v}`);
  // scale, offset and one face of a box of its own
  const door = box([0, 0, 0], [4, 64, 112], {
    sides: "BEAM",
    west: { name: "DOOR", scale: [1, 0.875], offset: [8, 16] },
  });
  const west = door.faces.find((face) => face.texture === "DOOR");
  sure(
    compilersNormal(west.points)[0] < 0 && door.faces.filter((face) => face.texture === "BEAM").length === 5,
    "one face of the box",
  );
  sure(west.scale.join() === "1,0.875" && west.u[3] === 8 && west.v[3] === 16, "the fit of that face");
  sure(
    /DOOR \[ 0 1 0 8 \] \[ 0 0 -1 16 \] 0 1 0\.875/.test(writeMap({ brushes: [door] })),
    "the face's line",
  );
  sure(
    /one word/.test(refusal(() => box([0, 0, 0], [8, 8, 8], "TWO WORDS"))),
    "a name with a space is not refused",
  );
  // moved, a brush keeps its picture where it was on its surface
  const shifted = source.moved(door, [0, 32, 0]);
  const texelAt = (face, point) => dot(face.u, point) / face.scale[0] + face.u[3];
  near(texelAt(shifted.faces.find((face) => face.texture === "DOOR"), [0, 42, 0]), texelAt(west, [0, 10, 0]), 1e-9, "the picture moved with the brush"); // prettier-ignore
});

// ── entities and the file ──

test("entities: values as a map holds them, a brush entity keeps its brushes, and what would break the file is refused", () => {
  const lamp = light([10, 20.5, 30], { color: [255, 128, 64], brightness: 100, _fade: "1.0" });
  sure(
    lamp.classname === "light" && lamp.origin === "10 20.5 30" && lamp._light === "255 128 64 100",
    JSON.stringify(lamp),
  );
  sure(playerStart([64, 64, 0], 90).origin === "64 64 36", "a player starts 36 above the floor point");
  const spot = source.spotLight([0, 0, 100], { at: [100, 0, 0] });
  sure(spot.pitch === "-45" && spot.angles === "0 0 0" && spot._cone === "45", JSON.stringify(spot));
  sure(source.sunLight([0, 0, 0]).classname === "light_environment", "the sun");
  sure(
    source.textureLights([0, 0, 0], { LAMP: [255, 255, 128, 100] }).LAMP === "255 255 128 100",
    "a texture light",
  );
  const door = source.brushEntity(
    "func_door_rotating",
    [box([0, 0, 0], [4, 64, 96], "A"), source.originBrush([2, 0, 48])],
    { speed: 100 },
  );
  sure(door.brushes.length === 2 && door.speed === "100", "a brush entity");
  sure(
    door.brushes[1].faces.every((face) => face.texture === "ORIGIN"),
    "the origin brush wears ORIGIN",
  );
  const text = writeMap({ entities: [door] });
  sure(
    !/"brushes"/.test(text) && (text.match(/ORIGIN/g) ?? []).length === 6,
    "the entity's brushes are inside it",
  );
  sure(
    /quote/.test(refusal(() => source.pointEntity("info_null", [0, 0, 0], { message: 'he said "no"' }))),
    "a quote is not refused",
  );
  sure(
    /a brush at least/.test(refusal(() => source.brushEntity("func_wall", []))),
    "a brush entity with no brush is not refused",
  );
  sure(
    source.mapNumber(-0) === "0" &&
      source.mapNumber(1 / 3) === "0.3333333333" &&
      source.mapNumber(1e-12) === "0",
    "numbers",
  );
  sure(source.mapNumber(123456789) === "123456789" && source.mapNumber(-2.5) === "-2.5", "numbers");
  sure(/cannot be NaN/.test(refusal(() => source.mapNumber(NaN))), "NaN is not refused");
});

test("a map written and read back is the same text, letter for letter; another tool's file is read too", () => {
  const map = {
    worldspawn: { wad: ["a.wad", "b.wad"], skyname: "desert", MaxRange: 2560 },
    brushes: [
      ...sealedRoom(),
      cylinder("z", [128, 128], 12, 0, 64, { name: "SMAKWALL", scale: 0.5, align: "face", rotation: 30 }),
      wedge([32, 32, 0], [96, 64, 32], "+x", { name: "SMAKFLOOR", offset: [3.25, -7] }),
    ],
    entities: [
      ...roomEntities(),
      source.brushEntity("func_illusionary", [box([200, 200, 100], [216, 216, 126], "LAMP")], {
        rendermode: 2,
      }),
      source.textureLights([128, 128, 64], { LAMP: [255, 255, 128, 100] }),
    ],
  };
  const text = writeMap(map);
  sure(
    text.startsWith('{\n"classname" "worldspawn"\n"mapversion" "220"\n"wad" "a.wad;b.wad"\n'),
    text.slice(0, 80),
  );
  const back = readMap(text);
  sure(writeMap(back) === text, "written, read and written again, the text changed");
  sure(
    back.brushes.length === 8 && back.entities.length === 4 && back.worldspawn.skyname === "desert",
    "what was read",
  );
  sure(
    back.entities[2].brushes.length === 1 && back.entities[0].brushes === undefined,
    "the entities' brushes",
  );
  sure(JSON.stringify(readMap(writeMap(back))) === JSON.stringify(back), "read twice, the structure changed");
  // changed and written: the change is there and the rest is as it was
  back.entities[1]._light = "255 0 0 300";
  const changed = writeMap(back).split("\n");
  const before = text.split("\n");
  sure(
    changed.length === before.length &&
      changed.filter((line, number) => line !== before[number]).length === 1,
    "one line changed",
  );
  // as an editor writes it: comments, CRLF, tabs, numbers with zeros after the point
  const foreign = text
    .replace("{\n", "// entity 0\r\n{\r\n")
    .replace(/\n/g, "\r\n")
    .replace(/ 1 1\r\n/g, "\t1.000000 1\r\n");
  sure(writeMap(readMap(foreign)) === text, "an editor's way of writing the same map reads differently");
  // refused in words, with the line
  const old = '{\n"classname" "worldspawn"\n{\n( 0 0 0 ) ( 1 0 0 ) ( 0 1 0 ) A 0 0 0 1 1\n}\n}\n';
  sure(/line 4.*older format/.test(refusal(() => readMap(old))), `said: ${refusal(() => readMap(old))}`);
  sure(
    /cut short/.test(refusal(() => readMap(text.slice(0, text.length - 3)))),
    "a file cut short is not refused",
  );
  sure(/line 2/.test(refusal(() => readMap("{\nnonsense\n}\n"))), "a broken line is not named");
  sure(
    /only Valve 220/.test(refusal(() => readMap('{\n"classname" "worldspawn"\n}\n'))),
    "a map with no mapversion",
  );
});

// ── the plan ──

test("the plan check passes a sealed room and says what it is", () => {
  const plan = checkPlan({
    worldspawn: { wad: "smak.wad" },
    brushes: sealedRoom(),
    entities: roomEntities(),
  });
  sure(!plan.errors.length && !plan.warnings.length, [...plan.errors, ...plan.warnings].join("; "));
  sure(
    /^6 world brushes, 0 brushes in 0 brush entities, 36 faces, 2 point entities$/.test(plan.facts[0]),
    plan.facts[0],
  );
  sure(/from -16 -16 -16 to 272 272 144/.test(plan.facts[1]), plan.facts[1]);
  sure(
    plan.facts.some((fact) => /no way out to the void found from 2 entities/.test(fact)) &&
      plan.leak === null,
    "the leak hint",
  );
});

test("the leak hint: a sealed room keeps the flood in, a room with a wall taken away lets it out at the hole", () => {
  const sealed = leakHint({ brushes: sealedRoom(), entities: roomEntities() });
  sure(
    sealed.leak === null && sealed.from === 2 && sealed.cell === 16,
    JSON.stringify({ ...sealed, leak: !!sealed.leak }),
  );
  const open = leakHint({ brushes: openRoom(), entities: roomEntities() });
  sure(open.leak, "no way out found through a missing wall");
  // the hole is the east side: x = 256, y 0 to 256, z 0 to 128
  const [x, y, z] = open.leak.at;
  sure(
    x > 256 - 16 && x <= 272 && y > 0 && y < 256 && z > 0 && z < 128,
    `the way out is at ${open.leak.at}, not at the hole`,
  );
  sure(
    open.leak.points.length > 2 && open.leak.points[0].join() === open.leak.entity.origin.join(),
    "the way starts at the entity",
  );
  const last = open.leak.points[open.leak.points.length - 1];
  sure(last[0] > 272, `the way ends at ${last}, which is not out through the east`);
  // every step of the way is clear of every brush: a way out that is reported is real
  const walls = openRoom();
  for (const point of open.leak.points)
    sure(
      !walls.some((wall) => source.holds(wall, point, -1e-6)),
      `the way passes through a wall at ${point}`,
    );
  const plan = checkPlan({ worldspawn: { wad: "smak.wad" }, brushes: openRoom(), entities: roomEntities() });
  sure(
    plan.warnings.length === 1 &&
      /looks OPEN to the void/.test(plan.warnings[0]) &&
      /compiler's word is final/.test(plan.warnings[0]),
    plan.warnings.join("; "),
  );
  sure(plan.leak?.at, "the plan gives the leak");
  // the compilers' marks as the east wall, as VHLT and SDHLT 1.3.1 compile them: these leak (NOCLIP and
  // NULLNOCLIP in the hulls a player moves in), these seal
  for (const [texture, leaks] of [["SKIP", true], ["SPLITFACE", true], ["NOCLIP", true], ["NULLNOCLIP", true], ["CLIP", true], ["SOLIDHINT", false], ["BEVELHINT", false], ["NULL", false]]) { // prettier-ignore
    const wall = source.box([256, -16, -16], [272, 272, 144], texture);
    const marked = checkPlan({ worldspawn: { wad: "smak.wad" }, brushes: [...openRoom(), wall], entities: roomEntities() });
    sure(Boolean(marked.leak) === leaks, `a wall of ${texture}: ${marked.leak ? "leaks" : "seals"}`);
  }
  // a wall that is a brush entity seals nothing; water does not either
  const eastWall = sealedRoom()[EAST_WALL];
  const withDoor = {
    brushes: openRoom(),
    entities: [...roomEntities(), source.brushEntity("func_wall", [eastWall])],
  };
  sure(leakHint(withDoor).leak, "a func_wall was taken for a wall of the world");
  const water = box([256, -16, 0], [272, 272, 128], "!WATER");
  sure(
    leakHint({ brushes: [...openRoom(), water], entities: roomEntities() }).leak,
    "water was taken for a wall",
  );
  // a crack of 4 units is finer than the grid of 16 and is found on a grid of 4: a hint, not a proof
  const short = sealedRoom();
  short[EAST_WALL] = box([256, -16, 0], [272, 272, 124], "SMAKWALL");
  sure(
    leakHint({ brushes: short, entities: roomEntities() }, { cell: 4 }).leak,
    "a crack of 4 units is not found on a grid of 4",
  );
  // an entity outside the map altogether
  const outside = leakHint({ brushes: sealedRoom(), entities: [light([900, 0, 0])] });
  sure(outside.leak?.entity.classname === "light", "an entity in the void is not told");
});

test("the plan check's errors, each in words", () => {
  const base = () => ({ worldspawn: { wad: "smak.wad" }, brushes: sealedRoom(), entities: roomEntities() });
  const errorsOf = (change, options) => {
    const map = base();
    change(map);
    return checkPlan(map, options).errors;
  };
  const only = (errors, pattern, what) =>
    sure(errors.length === 1 && pattern.test(errors[0]), `${what}: ${errors.join(" | ") || "no error"}`);

  // every face turned inwards (the points in the wrong order): nothing is behind them all
  const inwards = box([64, 64, 0], [96, 96, 32], "SMAKWALL");
  for (const face of inwards.faces) face.points.reverse();
  only(
    errorsOf((map) => map.brushes.push(inwards)),
    /1 brushes that are no sound convex solid: world brush 6: it has no volume/,
    "a brush turned inside out",
  );
  // one face turned inwards: the brush runs on without end beyond it
  const oneInwards = box([64, 64, 0], [96, 96, 32], "SMAKWALL");
  oneInwards.faces[0].points.reverse();
  only(
    errorsOf((map) => map.brushes.push(oneInwards)),
    /world brush 6: its planes do not close it.*turned inwards/,
    "a face turned inwards",
  );
  // a plane the others cut away: a face with no area
  const extra = box([64, 64, 0], [96, 96, 32], "SMAKWALL");
  extra.faces.push({ ...box([0, 0, 0], [8, 8, 200], "SMAKWALL").faces[0] });
  only(
    errorsOf((map) => map.brushes.push(extra)),
    /world brush 6: face 6 \(SMAKWALL\) has no area/,
    "a face with no area",
  );
  // the same plane twice
  const twice = box([64, 64, 0], [96, 96, 32], "SMAKWALL");
  twice.faces.push({ ...twice.faces[0] });
  only(
    errorsOf((map) => map.brushes.push(twice)),
    /face 6 \(SMAKWALL\) is the same plane as face 0/,
    "a plane given twice",
  );
  // a face missing: the planes do not close
  const open = box([64, 64, 0], [96, 96, 32], "SMAKWALL");
  open.faces.pop();
  only(
    errorsOf((map) => map.brushes.push(open)),
    /do not close it/,
    "a brush with a face missing",
  );
  // three points in a line
  const line = box([64, 64, 0], [96, 96, 32], "SMAKWALL");
  line.faces[2].points[2] = line.faces[2].points[0];
  sure(
    errorsOf((map) => map.brushes.push(line)).some((error) => /three points in a line/.test(error)),
    "points in a line",
  );
  // a list of brushes put in as one
  only(
    errorsOf((map) => map.brushes.push({ nothing: true })),
    /is not a brush/,
    "what is not a brush",
  );

  only(
    errorsOf((map) => map.brushes.push(box([4000, 0, 0], [4200, 64, 64], "SMAKWALL")), { leak: false }),
    /1 brushes reach further than 4096 from the origin.*world brush 6 reaches 4200/,
    "a brush out of range",
  );
  sure(
    !errorsOf((map) => map.brushes.push(box([4000, 0, 0], [4200, 64, 64], "SMAKWALL")), {
      leak: false,
      range: 32768,
    }).length,
    "the range given is not used",
  );
  sure(SOURCE_LIMITS.range === 4096, "the range");
  only(
    errorsOf((map) => map.entities.push(light([5000, 0, 0])), { leak: false }),
    /1 entities are further than 4096/,
    "an entity out of range",
  );
  only(
    errorsOf((map) => map.entities.push({ classname: "ambient_generic", message: "hum.wav" })),
    /1 point entities have no origin.*entity 3 \(ambient_generic\)/,
    "an entity with no origin",
  );
  only(
    errorsOf((map) => map.entities.push({ origin: "1 2 3" })),
    /entity 3 has no classname/,
    "an entity with no classname",
  );
  only(
    errorsOf((map) => map.entities.shift()),
    /no info_player_start/,
    "no place to start",
  );
  sure(
    !errorsOf((map) => (map.entities[0].classname = "ms_player_begin"), { starts: ["ms_player_begin"] })
      .length,
    "a mod's own start",
  );
  only(
    errorsOf((map) => map.brushes.push(box([64, 64, 0], [96, 96, 32], "A_NAME_OF_SIXTEEN"))),
    /1 texture names are longer than 15 letters.*A_NAME_OF_SIXTEEN/,
    "a long texture name",
  );
  const names = ["smakfloor", "SMAKCEIL", "SMAKWALL"];
  sure(!errorsOf(() => {}, { textures: names }).length, "textures are looked up by their case");
  only(
    errorsOf((map) => map.brushes.push(box([64, 64, 0], [96, 96, 32], "NOWHERE")), { textures: names }),
    /1 textures are in none of the \.wad files given: NOWHERE \(6 faces\)/,
    "a texture in no .wad",
  );
  sure(
    !errorsOf(
      (map) => map.entities.push(source.brushEntity("func_door_rotating", [source.originBrush([8, 8, 8])])),
      { textures: names },
    ).length,
    "the compilers' own textures are looked for",
  );
  // texture axes that lie across the face
  const edgeOn = box([64, 64, 0], [96, 96, 32], "SMAKWALL");
  edgeOn.faces[0].v = [0, 0, 1, 0];
  only(
    errorsOf((map) => map.brushes.push(edgeOn)),
    /1 faces have texture axes that lie across the face.*world brush 6 face 0/,
    "edge-on axes",
  );
  only(
    errorsOf((map) => (map.entities[1].a_key_that_is_much_longer_than_a_map_holds = "1")),
    /longer than 31 letters/,
    "a long key",
  );
  only(
    errorsOf((map) => (map.entities[1].message = 'a "quote"')),
    /holds a quote/,
    "a quote in a value",
  );
  only(checkPlan({ brushes: [], entities: roomEntities() }).errors, /no world brush/, "no world");
  // a class that precaches its model, with none named, stops the map on load
  only(
    errorsOf((map) => map.entities.push({ classname: "env_glow", origin: "128 128 64" })),
    /precache a model they do not name.*PF_precache_model_I/,
    "a glow with no sprite",
  );
});

test("a carved wall's texture stands on the floor of the room it faces and starts at its corner", () => {
  // two rooms 16 apart, the second 40 higher and 24 further north: each side of the rock between them is lined
  // up with the room it faces, its picture's foot on that floor (v runs down -z) and its left edge on that
  // room's corner (u runs along +y on walls that face x)
  const first = { min: [0, 0, 0], max: [256, 256, 128] };
  const second = { min: [272, 24, 40], max: [528, 280, 168] };
  const walls = (rooms, texture) =>
    carve(rooms, 16, texture).flatMap((brush) => brush.faces.filter((face) => face.texture === "W"));
  const facing = (faces, x, normal) =>
    faces.filter((face) => face.points.every((p) => Math.abs(p[0] - x) < 1e-6) && Math.round(planeOf(face.points).normal[0]) === normal); // prettier-ignore
  const faces = walls([first, second], { floor: "F", ceiling: "C", wall: "W" });
  const intoFirst = facing(faces, 256, -1);
  const intoSecond = facing(faces, 272, 1);
  sure(intoFirst.length && intoFirst.every((face) => face.v[3] === 0 && face.u[3] === 0), JSON.stringify(intoFirst.map((f) => [f.u[3], f.v[3]])));
  sure(intoSecond.length && intoSecond.every((face) => face.v[3] === 40 && face.u[3] === -24), JSON.stringify(intoSecond.map((f) => [f.u[3], f.v[3]])));
  // in the texture's own scale, added to its own offset; rooms of their own textures alike
  const scaled = walls([first, { ...second, texture: { name: "W", scale: 2, offset: [3, 5] } }], { floor: "F", ceiling: "C", wall: "W" }); // prettier-ignore
  sure(facing(scaled, 272, 1).every((face) => face.v[3] === 5 + 20 && face.u[3] === 3 - 12), JSON.stringify(facing(scaled, 272, 1).map((f) => [f.u[3], f.v[3]]))); // prettier-ignore
  // a turned texture is left as it is
  const turned = walls([first, second], { floor: "F", ceiling: "C", wall: { name: "W", rotation: 90 } });
  sure(facing(turned, 272, 1).every((face) => face.v[3] === 0 && face.u[3] === 0), "a turned texture");
});

test("no map is written with an entity that precaches a model it does not name", () => {
  const glow = (keys) => ({ brushes: sealedRoom(), entities: [...roomEntities(), { classname: "env_glow", origin: "128 128 64", ...keys }] }); // prettier-ignore
  sure(/entity 3 \(env_glow\) precache a model/.test(refusal(() => writeMap(glow({})))), "a glow with no sprite");
  sure(!refusal(() => writeMap(glow({ model: "sprites/glow01.spr" }))), "a glow with its sprite");
  // cycler checks its model and removes itself: it is no fault
  sure(!refusal(() => writeMap({ brushes: sealedRoom(), entities: [...roomEntities(), { classname: "cycler", origin: "128 128 0" }] })), "a cycler"); // prettier-ignore
});

test("the plan check's warnings: planes off the grid (a fact since 0.39), no wad, no light, a light buried in a wall", () => {
  const map = { worldspawn: { wad: "smak.wad" }, brushes: sealedRoom(), entities: roomEntities() };
  const round = cylinder("z", [128, 128], 16, 0, 64, "SMAKWALL");
  const offGrid = checkPlan({ ...map, brushes: [...map.brushes, round] });
  sure(
    !offGrid.errors.length &&
      !offGrid.warnings.length &&
      offGrid.facts.some((fact) => /1 brushes have planes through points off the grid of 1/.test(fact)),
    [...offGrid.warnings, ...offGrid.facts].join("; "),
  );
  sure(
    !checkPlan({ ...map, brushes: [...map.brushes, source.snapped(round)] }).facts.some((fact) => /off the grid/.test(fact)),
    "snapped, it is still said",
  );
  sure(/no wad key/.test(checkPlan({ ...map, worldspawn: {} }).warnings.join()), "no wad key");
  sure(
    /nothing lights it/.test(checkPlan({ ...map, entities: [playerStart([64, 64, 0])] }).warnings.join()),
    "no light",
  );
  const buried = checkPlan({ ...map, entities: [...map.entities, light([264, 100, 50])] });
  sure(
    /1 entities are inside a world brush: entity 3 \(light\) at 264 100 50 is inside world brush 3/.test(
      buried.warnings.join(),
    ),
    buried.warnings.join("; "),
  );
  const unused = checkPlan({
    ...map,
    entities: [...map.entities, source.textureLights([10, 10, 10], { LAMP: [1, 2, 3, 4] })],
  });
  sure(
    /names the texture LAMP, which no face wears/.test(unused.warnings.join()),
    "a texture light no face wears",
  );
});

// ── the compilers ──

/** A WAD3 file of plain 16 x 16 textures, one a name, each of one colour: all a compile needs. */
const tinyWad = (names) => {
  const SIDE = 16;
  const HEADER = 40;
  const pixels = [SIDE * SIDE, (SIDE * SIDE) / 4, (SIDE * SIDE) / 16, (SIDE * SIDE) / 64];
  const lumpSize = HEADER + pixels.reduce((sum, count) => sum + count, 0) + 2 + 768 + 2;
  const file = Buffer.alloc(12 + names.length * (lumpSize + 32));
  file.write("WAD3", 0, "latin1");
  file.writeInt32LE(names.length, 4);
  file.writeInt32LE(12 + names.length * lumpSize, 8);
  names.forEach((name, number) => {
    const at = 12 + number * lumpSize;
    file.write(name, at, "latin1");
    file.writeUInt32LE(SIDE, at + 16);
    file.writeUInt32LE(SIDE, at + 20);
    let offset = HEADER;
    pixels.forEach((count, level) => {
      file.writeUInt32LE(offset, at + 24 + level * 4);
      // every pixel is colour 1 of the palette
      file.fill(1, at + offset, at + offset + count);
      offset += count;
    });
    file.writeUInt16LE(256, at + offset);
    // colour 1: a grey that differs from one texture to the next
    file.fill(90 + number * 40, at + offset + 2 + 3, at + offset + 2 + 6);
    const entry = 12 + names.length * lumpSize + number * 32;
    file.writeInt32LE(at, entry);
    file.writeInt32LE(lumpSize, entry + 4);
    file.writeInt32LE(lumpSize, entry + 8);
    file[entry + 12] = 0x43;
    file.write(name, entry + 16, "latin1");
  });
  return file;
};

const WAD_NAMES = ["SMAKFLOOR", "SMAKCEIL", "SMAKWALL", "SMAKSTEP"];
const wadFile = join(tmp, "smak-maps.wad");
writeFileSync(wadFile, tinyWad(WAD_NAMES));
const mapsFolder = join(tmp, "maps");
mkdirSync(mapsFolder, { recursive: true });

test("a .wad's texture names are read from its directory; what is no .wad is refused", () => {
  sure(
    wadTextureNames(readFileSync(wadFile)).join() === WAD_NAMES.join(),
    "the names of the test's own .wad",
  );
  sure(
    /not a \.wad file/.test(refusal(() => wadTextureNames(Buffer.from("IDST nothing here")))),
    "a model taken for a .wad",
  );
  sure(
    /cut short/.test(refusal(() => wadTextureNames(readFileSync(wadFile).subarray(0, 600)))),
    "a .wad cut short",
  );
});

test("without the compilers, every function that needs them says so in one sentence", () => {
  const empty = join(tmp, "no-compilers");
  mkdirSync(empty, { recursive: true });
  const none = findCompilers({ folder: empty, env: {} });
  sure(!none.found && none.missing.join() === "hlcsg,hlbsp,hlvis,hlrad", JSON.stringify(none.missing));
  sure(
    /VHLT \(Vluzacn's ZHLT v34/.test(none.message) &&
      /not part of this kit/.test(none.message) &&
      /VHLT_DIR/.test(none.message),
    none.message,
  );
  sure(!/\n/.test(none.message), "the message is more than a line");
  // some of the four: the ones that are missing are named
  writeFileSync(join(empty, "hlcsg.exe"), "");
  const some = findCompilers({ folder: empty, env: {} });
  sure(!some.found && /has no hlbsp, hlvis, hlrad/.test(some.message), some.message);
  // SDHLT's names, as its Linux build leaves them, are found as the four
  const seedee = join(tmp, "sdhlt-names");
  mkdirSync(seedee, { recursive: true });
  for (const name of ["sdHLCSG", "sdHLBSP", "sdHLVIS", "sdHLRAD"]) writeFileSync(join(seedee, name), "");
  const sdhlt = findCompilers({ folder: seedee, env: {} });
  sure(sdhlt.found && sdhlt.tools.hlrad === join(seedee, "sdHLRAD"), JSON.stringify(sdhlt.tools));
  // the release's own folder named, its programs found where it keeps them (tools/Win64, tools/Linux)
  const release = join(tmp, "sdhlt-release");
  const kept = join(release, "tools", process.platform === "win32" ? (process.arch === "ia32" ? "Win32" : "Win64") : "Linux");
  mkdirSync(kept, { recursive: true });
  for (const name of ["sdHLCSG", "sdHLBSP", "sdHLVIS", "sdHLRAD"]) writeFileSync(join(kept, name), "");
  const fromRelease = findCompilers({ folder: release, env: {} });
  sure(fromRelease.found && fromRelease.folder === kept, fromRelease.message);
  const mapFile = join(mapsFolder, "unbuilt.map");
  writeFileSync(mapFile, writeMap({ brushes: sealedRoom(), entities: roomEntities() }));
  const result = compileMap(mapFile, { compilers: none, wads: [wadFile] });
  sure(
    result.bsp === null &&
      result.errors.length === 1 &&
      /needs the map compilers VHLT/.test(result.errors[0]),
    result.errors.join("; "),
  );
  sure(
    !existsSync(join(mapsFolder, "unbuilt.bsp")) && /not compiled/.test(compileSummary(result)),
    "something was left behind",
  );
  // the lines that spoil a compile though the program ends with 0
  for (const line of ["Error: ::LoadLump() texture X not found!", "Warning: === LEAK in hull 0 ===", "Warning: Brush 3 has no visible faces", "No visibility data", "Entity 4, Brush 2: mixed face contents"]) // prettier-ignore
    sure(BAD_LINE.test(line), `not taken for a bad line: ${line}`);
  sure(
    !BAD_LINE.test("1.50 seconds elapsed") && !BAD_LINE.test("Wad files required to run the map: (None)"),
    "a good line taken for a bad one",
  );
});

const compilers = process.env[COMPILERS_VARIABLE] ? findCompilers() : { found: false };
/** A case that needs the compilers: run when they are there, and said to be skipped when not. */
const testCompiled = (name, run) => {
  if (compilers.found) test(name, run);
  else
    console.log(
      `skip  ${name}\n      skipped: no compilers (name the folder of VHLT in ${COMPILERS_VARIABLE} to run it)`,
    );
};

/** The longest a compile of one of these small rooms may take before the case fails, in milliseconds. */
const PATIENCE = 120_000;

testCompiled("compiled: a sealed room becomes a .bsp, with no error, no leak and four logs", () => {
  const door = source.brushEntity(
    "func_door_rotating",
    [box([120, 60, 0], [124, 124, 96], "SMAKSTEP"), source.originBrush([122, 60, 48])],
    { speed: 100, angles: [0, 0, 0] },
  );
  const map = {
    brushes: [
      ...sealedRoom(),
      cylinder("z", [200, 200], 12, 0, 64, "SMAKSTEP"),
      wedge([32, 160, 0], [96, 224, 32], "+x", { name: "SMAKSTEP", align: "face" }),
    ],
    entities: [...roomEntities(), door],
  };
  const mapFile = join(mapsFolder, "sealed.map");
  writeFileSync(mapFile, writeMap(map));
  const result = compileMap(mapFile, { wads: [wadFile], compilers, timeout: PATIENCE });
  sure(!result.errors.length && result.leak === null, result.errors.join("; "));
  sure(result.bsp === join(mapsFolder, "sealed.bsp") && existsSync(result.bsp), `the .bsp: ${result.bsp}`);
  sure(
    result.logs.map((log) => log.tool).join() === "hlcsg,hlbsp,hlvis,hlrad" &&
      result.logs.every((log) => log.code === 0 && log.text.length > 100),
    "the four logs",
  );
  sure(result.work === null && /compiled: /.test(compileSummary(result)), "the summary");
  const bsp = readFileSync(result.bsp);
  // version 30, and its entities are the map's: the worldspawn, the start, the light and the door
  sure(bsp.readInt32LE(0) === 30, `a .bsp of version ${bsp.readInt32LE(0)}`);
  const entityText = bsp.toString("latin1", bsp.readInt32LE(4), bsp.readInt32LE(4) + bsp.readInt32LE(8));
  for (const classname of ["worldspawn", "info_player_start", "func_door_rotating"])
    sure(entityText.includes(`"classname" "${classname}"`), `the .bsp has no ${classname}`);
  // the door's origin is where its ORIGIN brush was
  sure(/"origin" "122 60 48"/.test(entityText), "the door's origin is not its ORIGIN brush's middle");
  // the map names its .wad and does not carry it; with wadinclude it carries the textures and is larger
  const carried = compileMap(mapFile, {
    wads: [wadFile],
    wadinclude: true,
    compilers,
    out: join(mapsFolder, "carried.bsp"),
    light: false,
    vis: false,
    timeout: PATIENCE,
  });
  sure(carried.bsp && carried.logs.length === 2, carried.errors.join("; "));
  // VHLT says "Including Wadfile: ...smak-maps.wad"; SDHLT names it in its "Wadinclude list"
  // (its log's lines end in \r\n on Windows)
  const takenIn = /Including Wadfile: .*smak-maps\.wad|Wadinclude list\r?\n-+\r?\n(?:[^-\r\n].*\r?\n)*smak-maps\r?\n/;
  sure(takenIn.test(carried.logs[0].text) && !takenIn.test(result.logs[0].text), "wadinclude");
  // the textures lump (the third of a .bsp's header) then holds the pictures themselves, and is larger
  const texturesLump = (file) => file.readInt32LE(8 + 2 * 8);
  sure(texturesLump(readFileSync(carried.bsp)) > texturesLump(bsp), "the textures are not inside");
});

testCompiled(
  "compiled: a room with a wall taken away is reported as a leak, with its points, and leaves no .bsp",
  () => {
    const mapFile = join(mapsFolder, "open.map");
    writeFileSync(mapFile, writeMap({ brushes: openRoom(), entities: roomEntities() }));
    const result = compileMap(mapFile, { wads: [wadFile], compilers, timeout: PATIENCE });
    sure(result.bsp === null && !existsSync(join(mapsFolder, "open.bsp")), "a leaking map left a .bsp");
    sure(result.leak && result.leak.points.length > 2, "no points of the leak");
    sure(
      result.leak.entity?.classname === "info_player_start" || result.leak.entity?.classname === "light",
      JSON.stringify(result.leak.entity),
    );
    sure(
      result.errors.length === 1 &&
        /the map LEAKS/.test(result.errors[0]) &&
        /leaves the world near/.test(result.errors[0]),
      result.errors.join(" | "),
    );
    sure(
      result.leak.nearest?.classname && result.errors[0].includes(result.leak.nearest.classname),
      "the nearest entity is not named",
    );
    // the trail passes through the hole: one of its points is in the opening at x = 256
    const inHole = result.leak.points.some(
      ([x, y, z]) => x >= 250 && x <= 278 && y >= 0 && y <= 256 && z >= 0 && z <= 128,
    );
    sure(inHole, `no point of the trail is in the hole: it starts at ${result.leak.points[0]}`);
    sure(result.logs.length === 2 && result.logs[1].tool === "hlbsp", "the compile went on after the leak");
    // the kit's own hint, before the compile, said the same
    sure(checkPlan({ brushes: openRoom(), entities: roomEntities() }).leak, "the plan's hint did not see it");
  },
);

testCompiled(
  "compiled: a texture that is in no .wad is reported in words, and an older .bsp is left alone and said to be old",
  () => {
    const room = hollow(ROOM_MIN, ROOM_MAX, WALL, { ...TEXTURES, wall: "NOSUCHTEXTURE" });
    const mapFile = join(mapsFolder, "sealed.map");
    const older = existsSync(join(mapsFolder, "sealed.bsp"))
      ? readFileSync(join(mapsFolder, "sealed.bsp"))
      : null;
    writeFileSync(mapFile, writeMap({ brushes: room, entities: roomEntities() }));
    const result = compileMap(mapFile, { wads: [wadFile], compilers, timeout: PATIENCE });
    sure(result.bsp === null, "a map with a missing texture compiled");
    sure(
      result.errors.some((error) =>
        /the texture NOSUCHTEXTURE is in none of the \.wad files given/.test(error),
      ),
      result.errors.join(" | "),
    );
    if (older) {
      sure(
        readFileSync(join(mapsFolder, "sealed.bsp")).equals(older),
        "the older .bsp was written over by a failed compile",
      );
      sure(
        result.warnings.some((warning) => /an older .*sealed\.bsp was left as it was/.test(warning)),
        result.warnings.join(" | "),
      );
    }
    const noWad = compileMap(mapFile, { wads: [join(tmp, "not-there.wad")], compilers });
    sure(/there is no \.wad file/.test(noWad.errors.join()), "a .wad that is not there");
    sure(
      /there is no map file/.test(compileMap(join(tmp, "not-there.map"), { compilers }).errors.join()),
      "a map that is not there",
    );
  },
);

/** Runs the example as a person would, from the temp folder. */
const runExample = (args, env = {}) => {
  const run = spawnSync(process.execPath, [join(HERE, "../examples/07-a-small-map.mjs"), ...args], {
    cwd: tmp,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { code: run.status, out: run.stdout, err: run.stderr.trim() };
};
const EXAMPLE_TEXTURES = [
  "--floor",
  "SMAKFLOOR",
  "--wall",
  "SMAKWALL",
  "--ceiling",
  "SMAKCEIL",
  "--step",
  "SMAKSTEP",
];

test("the example writes its map and checks it with no .wad and no compilers, and says why it did not compile", () => {
  const plain = runExample(["small-plain"], { [COMPILERS_VARIABLE]: "" });
  sure(plain.code === 0 && !plain.err, `code ${plain.code}: ${plain.err}`);
  sure(
    /not compiled: a compile needs the \.wad/.test(plain.out) && !/ERROR|warning/.test(plain.out),
    plain.out,
  );
  const map = readMap(readFileSync(join(tmp, "small-plain", "small.map"), "utf8"));
  const plan = checkPlan(map);
  sure(!plan.errors.length && plan.leak === null && map.entities.length === 3, plan.errors.join("; "));
  // two rooms, a doorway a player fits through, and a step up of no more than 18
  const inRock = (point) => map.brushes.some((brush) => source.holds(brush, point, -1e-6));
  sure(
    !inRock([160, 128, 80]) && !inRock([480, 128, 80]) && !inRock([336, 128, 64]) && !inRock([336, 208, 96]),
    "a room, the doorway or the window is filled",
  );
  sure(
    inRock([336, 128, 8]) && inRock([336, 128, 120]) && inRock([336, 40, 64]),
    "the wall between the rooms is missing",
  );
  sure(inRock([308, 128, 4]) && !inRock([308, 128, 12]), "the step before the doorway");
  // with a .wad and no compilers: said plainly, by name
  const noTools = runExample(["small-no-tools", "--wad", wadFile, ...EXAMPLE_TEXTURES], {
    [COMPILERS_VARIABLE]: join(tmp, "no-compilers"),
    PATH: "",
    Path: "",
  });
  sure(
    noTools.code === 0 && /not compiled: this needs the map compilers VHLT/.test(noTools.out),
    noTools.out + noTools.err,
  );
  // a texture the .wad has not: the plan stops it before any compile
  const wrong = runExample(["small-wrong", "--wad", wadFile], {});
  sure(
    wrong.code === 1 && /ERROR: 4 textures are in none of the \.wad files given/.test(wrong.out),
    wrong.out,
  );
  const bogus = runExample(["--bogus"]);
  sure(bogus.code === 1 && /^--bogus: the options are/.test(bogus.err) && !/\n/.test(bogus.err), bogus.err);
  sure(
    runExample(["x", "--wad", join(tmp, "not-there.wad")]).err ===
      `there is no .wad file ${join(tmp, "not-there.wad")}`,
    "a .wad that is not there",
  );
});

testCompiled("compiled: the example's two rooms compile with no leak", () => {
  const run = runExample(["small-built", "--wad", wadFile, ...EXAMPLE_TEXTURES]);
  sure(run.code === 0 && !run.err, `code ${run.code}: ${run.err}\n${run.out}`);
  sure(/compiled: .*small\.bsp/.test(run.out) && !/error|LEAK/i.test(run.out), run.out);
  sure(existsSync(join(tmp, "small-built", "small.bsp")), "no small.bsp");
});
