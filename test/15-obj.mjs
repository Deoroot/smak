// Wavefront OBJ files (check/obj.mjs): read into triangles, stood up for GoldSrc, made into a model, and what
// an .obj may hold that a studio model may not (large pictures, coordinates that repeat, many points).
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import { test, sure, checked, near, inked, tmp, runSmak, knife } from "./helper.mjs";

// ── what the cases share ──

/** `check` for both engines: it throws the errors of either. */
const sureFit = (mdl) => {
  for (const engine of ["goldsrc", "xash"]) {
    const errors = smak.check(mdl, engine).errors;
    sure(!errors.length, `${engine}: ${errors.join("; ")}`);
  }
};

/** Whether `run` throws, with a message that `pattern` matches. */
const refuses = (run, pattern) => {
  try {
    run();
  } catch (e) {
    return pattern.test(e.message);
  }
  return false;
};

// a picture of 64x64, light grey, with a red square in its top left corner and a green one in its top right
const PICTURE_SIDE = 64;
const MARK_SIDE = 20;
const RED = [255, 0, 0];
const GREEN = [0, 200, 0];
const GREY = [200, 200, 200];
const markedRgba = new Uint8Array(PICTURE_SIDE * PICTURE_SIDE * 4);
for (let y = 0; y < PICTURE_SIDE; y++)
  for (let x = 0; x < PICTURE_SIDE; x++) {
    const atTop = y < MARK_SIDE;
    const colour = atTop && x < MARK_SIDE ? RED : atTop && x >= PICTURE_SIDE - MARK_SIDE ? GREEN : GREY;
    markedRgba.set([...colour, 255], (y * PICTURE_SIDE + x) * 4);
  }
const markedPng = smak.png(PICTURE_SIDE, PICTURE_SIDE, markedRgba);

// a cube of side 2 as a tool writes it: +y up, its front towards +z, each face wearing the whole picture
// upright as seen from outside (an .obj counts texture coordinates from the bottom left)
const CUBE_OBJ = `# a cube
mtllib cube.mtl
o cube
v -1 -1  1
v  1 -1  1
v  1  1  1
v -1  1  1
v -1 -1 -1
v  1 -1 -1
v  1  1 -1
v -1  1 -1
vt 0 0
vt 1 0
vt 1 1
vt 0 1
usemtl marked
f 1/1 2/2 3/3 4/4
f 2/1 6/2 7/3 3/4
f 6/1 5/2 8/3 7/4
f 5/1 1/2 4/3 8/4
f 4/1 3/2 7/3 8/4
f 5/1 6/2 2/3 1/4
`;
const CUBE_MTL = "newmtl marked\nKd 1 1 1\nmap_Kd marked.png\n";

/** The middle of the pixels of a drawn picture that are nearly `colour`, and how many there are. */
const middleOf = (image, colour) => {
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) {
      const at = (y * image.width + x) * 4;
      const off = [0, 1, 2].reduce((sum, c) => sum + Math.abs(image.rgba[at + c] - colour[c]), 0);
      if (off > 60) continue;
      count++;
      sumX += x;
      sumY += y;
    }
  return { count, x: sumX / Math.max(1, count), y: sumY / Math.max(1, count) };
};

/** A ball as an .obj, +y up, of `around` by `down` faces of four corners, each corner with its own normal. */
const ballObj = (around, down) => {
  const lines = ["o ball", "usemtl marked"];
  for (let ring = 0; ring <= down; ring++)
    for (let step = 0; step <= around; step++) {
      const fromTop = (Math.PI * ring) / down;
      const round = (2 * Math.PI * step) / around;
      const out = [
        Math.sin(fromTop) * Math.sin(round),
        Math.cos(fromTop),
        Math.sin(fromTop) * Math.cos(round),
      ];
      lines.push(`v ${out.map((v) => (v * 2).toFixed(5)).join(" ")}`);
      lines.push(`vn ${out.map((v) => v.toFixed(5)).join(" ")}`);
      lines.push(`vt ${(step / around).toFixed(5)} ${(1 - ring / down).toFixed(5)}`);
    }
  const numberAt = (ring, step) => ring * (around + 1) + step + 1;
  for (let ring = 0; ring < down; ring++)
    for (let step = 0; step < around; step++) {
      const corners = [
        numberAt(ring, step),
        numberAt(ring + 1, step),
        numberAt(ring + 1, step + 1),
        numberAt(ring, step + 1),
      ];
      lines.push(`f ${corners.map((number) => `${number}/${number}/${number}`).join(" ")}`);
    }
  return lines.join("\n");
};

// ── the cases ──

test("readObj: faces of four corners and the four ways of naming a corner give the right triangles", () => {
  const obj = smak.readObj(
    `# points, texture coordinates, one normal
v 0 0 0
v 1 0 0
v 1 1 0   0.5 0.5 0.5
v 0 1 0
vt 0 0
vt 1 0
vt 1 1
vt 0 1
vn 0 0 1
l 1 2
p 1
curv 0 1 1 2
g plain
f 1 2 3 4
g with coordinates
usemtl wood
f 1/1 2/2 3/3
g with normals
f 1//1 2//1 3//1
g with both
f 1/1/1 2/2/1 \\
  3/3/1 4/4/1
`,
    { mtl: "newmtl wood\nKd 0.5 0.25 0\n" },
  );
  const [plain, coordinates, normals, both] = obj.groups;
  sure(
    obj.groups.length === 4 && plain.group === "plain" && plain.material === "" && both.material === "wood",
    "a group for each run of faces under one g and usemtl",
  );
  sure(
    plain.tris.length === 2 &&
      coordinates.tris.length === 1 &&
      normals.tris.length === 1 &&
      both.tris.length === 2,
    "a face of four corners is two triangles, one of three is one",
  );

  // the fan: corners 1 2 3, then 1 3 4, in the file's order
  const places = (tri) => tri.map((corner) => corner.p.join(" ")).join(", ");
  sure(
    places(plain.tris[0]) === "0 0 0, 1 0 0, 1 1 0" && places(plain.tris[1]) === "0 0 0, 1 1 0, 0 1 0",
    `fanned from the first corner: ${places(plain.tris[0])}; ${places(plain.tris[1])}`,
  );

  // v alone: no coordinates (the picture's middle), no normal, nothing said about creases
  const bare = plain.tris[0][0];
  sure(
    bare.uv.given === false && bare.uv[0] === 0.5 && bare.n === null && bare.group === undefined,
    "a corner named by its point alone",
  );
  // v/vt: the coordinates counted from the top left, so vt 0 0 is u 0, v 1
  const [first, , third] = coordinates.tris[0];
  sure(
    first.uv.given && first.uv.join() === "0,1" && third.uv.join() === "1,0" && first.n === null,
    `v/vt: ${first.uv.join()} and ${third.uv.join()}`,
  );
  // v//vn and v/vt/vn: the normal, and a group made of it for the kit's creases
  sure(
    normals.tris[0][0].n.join() === "0,0,1" && normals.tris[0][0].uv.given === false,
    "v//vn: a normal and no coordinates",
  );
  const full = both.tris[1][2];
  sure(
    full.n.join() === "0,0,1" && full.uv.join() === "0,0" && full.p.join() === "0,1,0" && full.smooth === 180,
    "v/vt/vn: all three",
  );
  sure(
    typeof full.group === "string" && full.group === both.tris[0][0].group,
    "corners of one normal are one group",
  );
  sure(obj.materials[0].name === "wood" && obj.materials[0].colour.join() === "0.5,0.25,0", "its materials");
});

test("readObj: numbers under 0 count back from the last point; s gives smoothing groups", () => {
  const counted = smak.readObj("v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nf 1/1 2/2 3/3\n");
  // the same face again after a fourth point, named from the end: -4 is the first point by then
  const back = smak.readObj(
    "v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nf -3/-3 -2/-2 -1/-1\nv 5 5 5\nf -4/-3 -3/-2 -2/-1\n",
  );
  const text = (tri) => JSON.stringify(tri.map((corner) => [corner.p, [...corner.uv]]));
  sure(
    back.groups[0].tris.length === 2 &&
      text(back.groups[0].tris[0]) === text(counted.groups[0].tris[0]) &&
      text(back.groups[0].tris[1]) === text(counted.groups[0].tris[0]),
    "the same triangle, named forwards and backwards",
  );

  // `s 1` makes one group of its faces, smooth however they meet; `s off` leaves each face flat
  const smoothed = smak.readObj("v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\ns 1\nf 1 2 3\ns off\nf 1 2 4\n");
  const [inGroup, flat] = smoothed.groups[0].tris;
  sure(
    inGroup[0].group === "s1" &&
      inGroup[0].smooth === 180 &&
      flat[0].group === undefined &&
      flat[0].smooth === 0,
    "s 1 and s off",
  );
});

test("objMeshes: +y up becomes +z up, the front towards +x, and every face still looks outwards", () => {
  // the cube with a nose on its front (+z in the file), so that front and up can be told apart
  const withNose = `${CUBE_OBJ}v 0 0 3\nf 1 2 -1\nf 2 3 -1\nf 3 4 -1\nf 4 1 -1\n`;
  const { meshes, box } = smak.objMeshes(smak.readObj(withNose), { scale: 10 });
  sure(
    box.mx.join() === "30,10,10" && box.mn.join() === "-10,-10,-10",
    `the nose points along +x: the box goes to ${box.mx.join(" ")}`,
  );
  // outwards: the kit's triangles go anticlockwise seen from outside, so (b - a) x (c - a) points away from
  // the middle of this shape, which bulges nowhere inwards but under the nose (those four faces are left out)
  const outer = meshes[0].tris.filter((tri) => !tri.every((corner) => corner.p[0] === 10));
  const inwards = outer.filter((tri) => {
    const normal = smak.cross(smak.sub(tri[1].p, tri[0].p), smak.sub(tri[2].p, tri[0].p));
    return smak.dot(normal, tri[0].p) <= 0;
  });
  sure(outer.length === 14 && !inwards.length, `${inwards.length} of ${outer.length} faces look inwards`);

  // +z up: the points as they are; a turn of 180 degrees about the upright axis
  const asItIs = smak.objMeshes(smak.readObj("v 1 2 3\nv 2 2 3\nv 1 3 3\nf 1 2 3\n"), { up: "z", turn: 180 });
  near(asItIs.meshes[0].tris[0][0].p[0], -1, 1e-9, "turned half round: x");
  near(asItIs.meshes[0].tris[0][0].p[1], -2, 1e-9, "turned half round: y");
  sure(asItIs.meshes[0].tris[0][0].p[2] === 3, "up stays up");

  // the origin: the middle of the model, or its lowest point on z = 0
  const grounded = smak.objMeshes(smak.readObj(withNose), { ground: true, centre: true }).box;
  sure(
    grounded.mn.join() === "-2,-1,0" && grounded.mx.join() === "2,1,2",
    `centred and standing on the ground: ${grounded.mn.join(" ")} to ${grounded.mx.join(" ")}`,
  );
});

test("objToMdl: a shape from an .obj is drawn as the same shape built directly", () => {
  // a wedge in GoldSrc's own axes, built with the workshop, which turns every face away from a point inside:
  // 6 long (x), 4 wide (y), 3 high at its back and nothing at its front
  const LONG = 6;
  const WIDE = 4;
  const HIGH = 3;
  const corners = [
    [0, 0, 0],
    [LONG, 0, 0],
    [LONG, WIDE, 0],
    [0, WIDE, 0],
    [0, 0, HIGH],
    [0, WIDE, HIGH],
  ];
  // the faces by their corners' numbers, anticlockwise seen from outside
  const faces = [
    [0, 3, 2, 1],
    [0, 4, 5, 3],
    [4, 1, 2, 5],
    [0, 1, 4],
    [3, 5, 2],
  ];
  const inside = [1, WIDE / 2, 0.5];
  const shape = smak.workshop.shape(PICTURE_SIDE, PICTURE_SIDE);
  // each corner takes the pixel of the picture over its place seen from above
  const pixelOf = (p) => [(p[0] / LONG) * PICTURE_SIDE, (p[1] / WIDE) * PICTURE_SIDE];
  for (const face of faces) {
    const at = face.map((number) => shape.V(corners[number], pixelOf(corners[number])));
    if (at.length === 4) shape.quad(...at, inside);
    else shape.tri(...at, inside);
  }
  const texture = smak.textureFrom(markedPng, "marked.bmp");
  const direct = smak.buildMdl({
    name: "wedge.mdl",
    bodyparts: [{ name: "body", models: [{ name: "wedge", meshes: [{ tris: shape.tris, texture }] }] }],
  });

  // the same wedge as a tool writes it: +y up, the file's (x, y, z) being the model's (y, z, x)
  const lines = [];
  for (const p of corners) {
    const [u, v] = pixelOf(p).map((pixel) => pixel / PICTURE_SIDE);
    lines.push(`v ${p[1]} ${p[2]} ${p[0]}`, `vt ${u} ${1 - v}`);
  }
  lines.push("usemtl marked");
  for (const face of faces) lines.push(`f ${face.map((number) => `${number + 1}/${number + 1}`).join(" ")}`);
  const fromObj = smak.objToMdl(smak.readObj(lines.join("\n")), {
    name: "wedge",
    textures: { marked: markedPng },
  });
  sureFit(fromObj);

  // from six sides and from below: the same picture, faces seen from behind left out in both
  for (const [yaw, pitch] of [
    [0, 0],
    [90, 0],
    [180, 10],
    [270, 0],
    [30, 60],
    [30, -60],
  ]) {
    const view = { yaw, pitch, width: 96, height: 96, seq: "idle" };
    const drawnDirect = smak.render(direct, view);
    const drawnFromObj = smak.render(fromObj, view);
    sure(inked(drawnFromObj) > 0.05, `drawn from yaw ${yaw}, pitch ${pitch}`);
    sure(
      Buffer.from(drawnDirect.rgba).equals(Buffer.from(drawnFromObj.rgba)),
      `from yaw ${yaw}, pitch ${pitch} the two are not the same picture`,
    );
    // and nothing is missing: with both sides of every face drawn the outline is no larger
    near(
      inked(smak.render(fromObj, { ...view, cull: false })),
      inked(drawnFromObj),
      1e-9,
      "a face is turned",
    );
  }
  const made = smak.readMdl(fromObj);
  sure(
    made.bones.join() === "root" && smak.sequences(fromObj)[0].name === "idle" && made.bodyparts.length === 1,
    "one bone, one still animation called idle, one bodypart",
  );
});

test("objToMdl: a cube's picture is the right way up and not mirrored", () => {
  const obj = smak.readObj(CUBE_OBJ, { mtl: CUBE_MTL });
  const mdl = smak.objToMdl(obj, { name: "cube", textures: { marked: markedPng }, scale: 10, ground: true });
  sureFit(mdl);
  writeFileSync(join(tmp, "obj_cube.mdl"), mdl);

  // every wall seen from outside: the red square at the top left, the green one at the top right
  for (const yaw of [0, 90, 180, 270]) {
    const drawn = smak.render(mdl, { yaw, pitch: 0, width: 128, height: 128, light: false, seq: "idle" });
    const red = middleOf(drawn, RED);
    const green = middleOf(drawn, GREEN);
    sure(red.count > 50 && green.count > 50, `yaw ${yaw}: both marks are drawn`);
    sure(
      red.y < 64 && green.y < 64 && red.x < 64 && green.x > 64,
      `yaw ${yaw}: red at ${red.x.toFixed(0)},${red.y.toFixed(0)} and green at ${green.x.toFixed(0)},${green.y.toFixed(0)}: not top left and top right`,
    );
  }
  const texture = smak.textureOf(mdl, "marked.bmp");
  sure(
    texture.width === PICTURE_SIDE && texture.pixels.length === PICTURE_SIDE ** 2,
    "the picture at its size",
  );
});

test("objToMdl: a ball with normals of its own is smooth; without them, as `s` says", () => {
  const ball = ballObj(16, 10);
  const smooth = smak.objModel(smak.readObj(ball), { textures: { marked: markedPng }, centre: true });
  sureFit(smooth.mdl);
  // the two rings of triangles at the poles have no area on one side: those halves are left out and told
  sure(
    smooth.report.triangles === 16 * 10 * 2 - 32 && /32 triangles of no area/.test(smooth.warnings.join()),
    `${smooth.report.triangles} triangles; ${smooth.warnings.join("; ")}`,
  );
  // smooth: one normal a point (the seam's points are stored once, with one normal)
  const normalsOf = (mdl) => smak.readMdl(mdl).bodyparts[0].models[0].numnorms;
  const points = 16 * 9 + 2;
  sure(normalsOf(smooth.mdl) === points, `a normal a point: ${normalsOf(smooth.mdl)} for ${points} points`);

  // the same ball without its normals: `s off` gives every face its own, `s 1` one a point again
  const bare = ball.replace(/^vn .*\n/gm, "").replace(/(\d+)\/(\d+)\/\d+/g, "$1/$2");
  const flat = smak.objToMdl(smak.readObj(bare.replace("usemtl marked", "usemtl marked\ns off")), {
    quiet: true,
  });
  const grouped = smak.objToMdl(smak.readObj(bare.replace("usemtl marked", "usemtl marked\ns 1")), {
    quiet: true,
  });
  // a normal is stored once for each way it points: flat, one a face at the least (16 by 10 faces)
  sure(
    normalsOf(flat) >= 16 * 10 && normalsOf(grouped) === points,
    `flat ${normalsOf(flat)} normals, s 1 ${normalsOf(grouped)}`,
  );
  // the material has no .mtl and no picture: a flat grey, said once
  const untold = smak.objModel(smak.readObj(bare));
  sure(/marked is in no .mtl/.test(untold.warnings.join()), "a material nobody describes is told");
});

test("readMtl and objToMdl: a material with a colour alone wears a small flat picture of it", () => {
  const materials = smak.readMtl(
    "# two\nnewmtl paint\nKa 0 0 0\nKd 0.2 0.4 0.8\nNs 10\n\nnewmtl label\nKd 1 1 1\nmap_Kd -s 1 1 1 -clamp on my label.png\n",
  );
  sure(
    materials.length === 2 && materials[0].colour.join() === "0.2,0.4,0.8" && materials[0].picture === null,
    "Kd is the colour",
  );
  sure(materials[1].picture === "my label.png", `map_Kd without its options: ${materials[1].picture}`);

  const obj = smak.readObj(CUBE_OBJ.replace("usemtl marked", "usemtl paint"), { mtl: materials });
  const mdl = smak.objToMdl(obj, { name: "painted.mdl" });
  sureFit(mdl);
  const texture = smak.textureOf(mdl, "paint.bmp");
  const colour = [0, 1, 2].map((channel) => texture.palette[texture.pixels[0] * 3 + channel]);
  sure(
    texture.width === 16 &&
      texture.height === 16 &&
      texture.pixels.every((pixel) => pixel === texture.pixels[0]),
    "16x16 of one colour",
  );
  sure(colour.join() === "51,102,204", `the colour of its Kd: ${colour.join(" ")}`);

  // a material whose picture was not handed over wears its colour, and that is told
  const lacking = smak.objModel(smak.readObj(CUBE_OBJ, { mtl: CUBE_MTL }));
  sure(
    /names the picture marked.png, which was not given/.test(lacking.warnings.join()),
    "a picture not given",
  );
});

test("objToMdl: a picture over 512 is made smaller; coordinates that repeat are laid out", () => {
  // 1100 x 600, in two colours: twice smaller would still be over 512, so three times: 366 x 200
  const large = { width: 1100, height: 600, rgb: new Uint8Array(1100 * 600 * 3).fill(90) };
  for (let i = 0; i < 1100 * 300 * 3; i++) large.rgb[i] = 220;
  const obj = smak.readObj(CUBE_OBJ, { mtl: CUBE_MTL });
  const made = smak.objModel(obj, { textures: { marked: large } });
  const texture = smak.textureOf(made.mdl, "marked.bmp");
  sure(texture.width === 366 && texture.height === 200, `made ${texture.width}x${texture.height}`);
  sure(/1100x600, larger than 512: made 366x200/.test(made.warnings.join()), made.warnings.join("; "));
  sure(!checked(made.mdl, "goldsrc").warnings.length, "no warning of a texture over 512");
  sureFit(made.mdl);
  // with a larger allowance it stays as it is, and `check` then tells of it for GoldSrc
  const kept = smak.objModel(obj, { textures: { marked: large }, maxTextureSize: 2048 });
  sure(
    smak.textureOf(kept.mdl, "marked.bmp").width === 1100 &&
      /larger than 512/.test(smak.check(kept.mdl, "goldsrc").warnings.join()),
    "maxTextureSize",
  );

  // one triangle that lies whole in the third copy of the picture, one that runs across two copies
  const tiled = (u) =>
    smak.readObj(`v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 2 0\nvt ${u} 0\nvt 2 1\nusemtl marked\nf 1/1 2/2 3/3\n`);
  const within = smak.objModel(tiled(3), { textures: { marked: markedPng } });
  sure(
    !within.warnings.length && smak.textureOf(within.mdl, "marked.bmp").width === PICTURE_SIDE,
    "a triangle in another copy of the picture is moved back at no cost",
  );
  const across = smak.objModel(tiled(4), { textures: { marked: markedPng } });
  const laid = smak.textureOf(across.mdl, "marked.bmp");
  sure(
    laid.width === 2 * PICTURE_SIDE &&
      laid.height === PICTURE_SIDE &&
      /laid 2 by 1 times/.test(across.warnings[0]),
    `the picture twice side by side: ${laid.width}x${laid.height}`,
  );
  // the second copy is the first again
  sure(laid.pixels[PICTURE_SIDE + 3] === laid.pixels[3] && laid.pixels[3] !== laid.pixels[30], "repeated");
  const pixelsAcross = smak.posed(across.mdl, { seq: "idle" }).tris[0].c.map((corner) => corner.u);
  sure(
    Math.max(...pixelsAcross) === 2 * PICTURE_SIDE && Math.min(...pixelsAcross) === 0,
    "its corners span both copies",
  );
  sureFit(across.mdl);
  sure(
    refuses(
      () => smak.objModel(tiled(4), { tiling: "refuse" }),
      /material marked .* 2 by 1 copies of its picture/,
    ),
    "tiling: refuse names the material",
  );
  sure(
    refuses(() => smak.objModel(tiled(40)), /more than the 8 each way/),
    "too many copies are refused",
  );
});

test("objToMdl: more points than a submodel holds are shared out over bodyparts", () => {
  // 64 by 40 faces: 2498 points, over GoldSrc's 2048 a submodel
  const made = smak.objModel(smak.readObj(ballObj(64, 40)), { textures: { marked: markedPng }, scale: 4 });
  sureFit(made.mdl);
  const parts = smak.readMdl(made.mdl).bodyparts;
  sure(
    parts.length === made.report.bodyparts &&
      parts.length > 1 &&
      /shared out over/.test(made.warnings.join()),
    `${parts.length} bodyparts`,
  );
  sure(
    parts.every((part) => part.models.length === 1 && part.models[0].numverts <= 2048) &&
      parts.every((part) => part.models[0].numnorms <= 2048),
    "each submodel within 2048 points and normals",
  );
  // body 0 shows them all: every triangle is there
  const shown = smak.posed(made.mdl, { seq: "idle", body: 0 }).tris.length;
  sure(shown === 64 * 40 * 2 - 2 * 64 && shown === made.report.triangles, `${shown} triangles shown`);
  near(
    inked(smak.render(made.mdl, { width: 96, height: 96, seq: "idle" })),
    Math.PI / 4,
    0.12,
    "a whole ball",
  );
});

test("a broken .obj is refused in words", () => {
  sure(
    refuses(
      () => smak.readObj("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 9\n"),
      /line 4: the face names point 9, and the file has 3/,
    ),
    "a face that names a point the file has not",
  );
  sure(
    refuses(() => smak.readObj("v 0 0 0\nv 1 0 0\nf 1 2\n"), /line 3: a face of 2 corners/),
    "two corners",
  );
  sure(
    refuses(() => smak.readObj("v 0 zero 0\n"), /line 1: .* needs 3 numbers/),
    "a point that is no number",
  );
  sure(
    refuses(() => smak.readObj("v 1 2 3\nf 1/1 1/1 1/1\n"), /texture coordinate 1, and the file has 0/),
    "vt",
  );
  sure(
    refuses(() => smak.readObj("v 0 0 0\nf 0 0 0\n"), /names point 0/),
    "points count from 1",
  );
  sure(
    refuses(() => smak.readObj("PK\u0003\u0004 not text at all"), /no faces in it/),
    "a file that is no .obj",
  );
  sure(
    refuses(() => smak.readObj(""), /no faces in it/),
    "an empty file",
  );
  // every face a line: nothing to make a model of
  const line = smak.readObj("v 0 0 0\nv 1 0 0\nv 2 0 0\nf 1 2 3\n");
  sure(
    refuses(() => smak.objModel(line), /every face of the .obj is a line or a point/),
    "faces of no area",
  );
  const one = smak.readObj("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");
  sure(
    refuses(() => smak.objModel(one, { up: "x" }), /up is "y" or "z"/),
    "up",
  );
  sure(
    refuses(() => smak.objModel(one, { scale: 0 }), /scale is a number over 0/),
    "scale",
  );
  sure(
    refuses(() => smak.objModel(one, { textures: { "": "wood.png" } }), /neither a PNG or BMP file's bytes/),
    "a picture that is a file's name, not its bytes",
  );
});

test("an .obj as a new body of a model that is there, on a bone (putBody)", () => {
  // the recipe of readObj's comment: one material, its triangles stood up, its picture as a texture
  const obj = smak.readObj(CUBE_OBJ, { mtl: CUBE_MTL });
  const [cube] = smak.objMeshes(obj, { scale: 0.5 }).meshes;
  const texture = smak.textureFrom(markedPng, "marked.bmp");
  const put = smak.putBody(knife.mdl, { name: "cube", tris: cube.tris, texture, bone: "hand", quiet: true });
  sureFit(put.mdl);
  sure(put.body === 1 && put.report.tris === 12 && !put.warnings.length, `body ${put.body}`);
  // on the hand bone: its middle is where that bone is as the knife stands
  const corners = smak.posed(put.mdl, { seq: "idle", body: put.body }).tris.flatMap((tri) => tri.c);
  const hand = smak.poseAt(put.mdl, 0, 0)[1];
  const middle = [0, 1, 2].map((axis) => corners.reduce((sum, c) => sum + c.p[axis], 0) / corners.length);
  near(Math.hypot(...smak.sub(middle, [hand[0][3], hand[1][3], hand[2][3]])), 0, 1e-3, "the cube's middle");
  sure(inked(smak.render(put.mdl, { body: put.body, width: 96, height: 96 })) > 0.05, "it is drawn");
});

test("the command line makes a model from an .obj, its .mtl and its pictures beside it", () => {
  const objFile = join(tmp, "cli_cube.obj");
  writeFileSync(objFile, CUBE_OBJ);
  writeFileSync(join(tmp, "cube.mtl"), CUBE_MTL);
  writeFileSync(join(tmp, "marked.png"), markedPng);
  const modelFile = join(tmp, "cli_cube.mdl");
  const printed = runSmak("obj", objFile, "-o", modelFile, "--scale", "10", "--ground", "--name", "box.mdl");
  sure(
    /"box\.mdl", \d+ bytes, 12 triangles on 8 points/.test(printed) &&
      /marked\.bmp\s+64x64\s+material marked: the picture given/.test(printed) &&
      /from -10\.0 -10\.0 0\.0 to 10\.0 10\.0 20\.0/.test(printed) &&
      /fit for goldsrc and xash/.test(printed) &&
      !/WARN(?!  form:)|ERROR/.test(printed),
    printed,
  );
  sure(existsSync(modelFile), "the model is written");
  // the same bytes as the library gives for the same options
  const same = smak.objToMdl(smak.readObj(CUBE_OBJ, { mtl: CUBE_MTL }), {
    name: "box.mdl",
    textures: { marked: markedPng },
    scale: 10,
    ground: true,
  });
  sure(readFileSync(modelFile).equals(same), "the command line and the library make the same file");

  // a picture that is not beside it: said, and the material wears its colour
  writeFileSync(join(tmp, "cube.mtl"), CUBE_MTL.replace("marked.png", "elsewhere.png"));
  const lacking = runSmak("obj", objFile, "-o", join(tmp, "cli_lacking.mdl"), "--up", "y");
  sure(
    /WARN {2}elsewhere\.png is not beside the \.obj/.test(lacking) &&
      /the flat colour of its Kd/.test(lacking),
    lacking,
  );
});
