// Faults that were found in the library by reading it, each with the case that showed it: a file cut short,
// an animation whose values end early, textures of several skins, a texture given twice, a bodypart with
// nothing in it, a handle that stands straight up, pictures that cannot be read, layers named wrongly, and a
// shape's own normals.
import { deflateSync } from "node:zlib";
import * as smak from "../src/index.mjs";
import { test, sure, near, knife } from "./helper.mjs";

const WAVE = 1; // the wave animation's number in the knife
const HAND = 1; // the hand bone's number

// where things are in a .mdl file (the engine's studio.h; see core/mdl.mjs)
const HDR_LENGTH = 72; // the header: how long the file says it is
const HDR_SEQINDEX = 168; // where the table of animations is
const HDR_BODYPARTINDEX = 208; // and the table of bodyparts
const SEQ_SIZEOF = 176; // one animation's entry
const SEQ_ANIMINDEX = 124; // in it: where its table of offsets is, twelve bytes a bone
const ANIM_SIZEOF = 12;
const BODYPART_NUMMODELS = 64; // in a bodypart's entry: how many submodels it has
const MESH_TRIINDEX = 4; // in a mesh's entry: where its triangles are
// where a PNG keeps its colour type: after the signature (8), the first chunk's length and name (8), then 9
const PNG_COLOUR_TYPE_AT = 25;
const PNG_BIT_DEPTH_AT = 24;

/** True when `run` throws an error whose message matches `pattern`. */
const refuses = (run, pattern) => {
  try {
    run();
  } catch (e) {
    return pattern.test(e.message);
  }
  return false;
};

/** Runs `run` and returns { result, said }: what it returned and the lines it wrote with console.warn. */
const warningsOf = (run) => {
  const said = [];
  const consoleWarn = console.warn;
  console.warn = (line) => said.push(String(line));
  try {
    return { result: run(), said };
  } finally {
    console.warn = consoleWarn;
  }
};

/** A texture of one colour, `side` pixels each way. */
const plainTexture = (name, side) => ({
  name,
  width: side,
  height: side,
  pixels: new Uint8Array(side * side),
  palette: new Uint8Array(768).fill(128),
  flags: 0,
});

// ── check ──

test("check reports a file cut short as an error, wherever it is cut", () => {
  // The knife as a compiler leaves a model: something other than a texture at its very end. Here the mesh's
  // triangles, copied there (26 bytes a triangle and two that end them) with the mesh pointed at the copy.
  const mesh = smak.readMdl(knife.mdl).bodyparts[0].models[0].meshes[0];
  const commands = knife.mdl.subarray(mesh.triindex, mesh.triindex + mesh.numtris * 26 + 2);
  const trianglesLast = Buffer.concat([knife.mdl, commands]);
  trianglesLast.writeInt32LE(knife.mdl.length, mesh.at + MESH_TRIINDEX);
  trianglesLast.writeInt32LE(trianglesLast.length, HDR_LENGTH);
  sure(smak.posed(trianglesLast).tris.length === mesh.numtris, "the knife with its triangles last");

  // 37 bytes short: its last triangles are cut
  const answer = smak.check(trianglesLast.subarray(0, trianglesLast.length - 37));
  sure(
    answer.errors.some((error) => /cut short or broken/.test(error)),
    answer.errors.join("; "),
  );
  sure(Array.isArray(answer.warnings) && Array.isArray(answer.facts), "warnings and facts are lists still");

  // and cut anywhere else, down to a few bytes: always errors in words, never a throw
  for (let length = 5; length < trianglesLast.length; length += 499) {
    const errors = smak.check(trianglesLast.subarray(0, length)).errors;
    sure(errors.length > 0, `cut to ${length} bytes it passed`);
    sure(
      !errors.some((error) => /offset|out of range/i.test(error)),
      `cut to ${length}: ${errors.join("; ")}`,
    );
  }
});

test("check reports a bodypart with no submodel", () => {
  const emptied = Buffer.from(knife.mdl);
  emptied.writeInt32LE(0, emptied.readInt32LE(HDR_BODYPARTINDEX) + BODYPART_NUMMODELS);
  const errors = smak.check(emptied).errors;
  sure(
    errors.some((error) => /bodypart body has no submodel/.test(error)),
    errors.join("; ") || "no error",
  );
});

// ── animations ──

test("poseAt says which bone's values end early, as frameValues does", () => {
  // the hand's turn about y in the wave: its run of values is made to cover no frame
  const TURN_ABOUT_Y = 4;
  const RUN_TOTAL = 1; // a run is [how many values are written, how many frames they cover], then the values
  const broken = Buffer.from(knife.mdl);
  const sequence = broken.readInt32LE(HDR_SEQINDEX) + WAVE * SEQ_SIZEOF;
  const entry = broken.readInt32LE(sequence + SEQ_ANIMINDEX) + HAND * ANIM_SIZEOF;
  const run = entry + broken.readUInt16LE(entry + TURN_ABOUT_Y * 2);
  broken[run + RUN_TOTAL] = 0;

  const told = /the animation's values for hand end before frame 5/;
  sure(
    refuses(() => smak.frameValues(broken, WAVE, 5), told),
    "frameValues",
  );
  sure(
    refuses(() => smak.poseAt(broken, WAVE, 5), told),
    "poseAt",
  );
  sure(
    refuses(() => smak.poseBetween(broken, WAVE, 5), told),
    "poseBetween",
  );
  // the animation that is whole is read as before
  sure(smak.poseAt(broken, 0, 0).length === 2, "idle");
});

// ── textures ──

test("replaceTexture at another size tells of a mesh left with pictures of two sizes in two skins", () => {
  // a flag of one triangle that wears day.bmp in the first skin and night.bmp in the second, both 8 x 8
  const flag = smak.writeMdl({
    name: "flag.mdl",
    bones: [{ name: "root", parent: -1 }],
    sequences: [{ name: "idle", fps: 10, frames: [[[0, 0, 0, 0, 0, 0]]] }],
    textures: [plainTexture("day.bmp", 8), plainTexture("night.bmp", 8)],
    skins: [[0], [1]],
    bodyparts: [
      {
        name: "body",
        models: [
          {
            name: "flag",
            verts: [
              [0, 0, 0],
              [1, 0, 0],
              [0, 1, 0],
            ],
            vertBones: [0, 0, 0],
            meshes: [
              {
                skin: 0,
                norms: [[0, 0, 1]],
                normBones: [0],
                tris: [
                  [
                    [0, 0, 0, 0],
                    [1, 0, 8, 0],
                    [2, 0, 0, 8],
                  ],
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  /** the farthest corner of the flag's triangle in its picture, in pixels */
  const reachOf = (mdl) => {
    const info = smak.readMdl(mdl);
    const model = info.bodyparts[0].models[0];
    return Math.max(...smak.readMesh(mdl, model, model.meshes[0])[0].map((corner) => corner.s));
  };

  // the second skin's picture at 16 x 16: the corners stay (they are in pixels of the first skin's), and it
  // is told that the two no longer agree
  const nightFirst = warningsOf(() => smak.replaceTexture(flag, "night.bmp", plainTexture("night.bmp", 16)));
  sure(reachOf(nightFirst.result) === 8, `the corners moved: ${reachOf(nightFirst.result)}`);
  sure(
    nightFirst.said.length === 1 &&
      /night\.bmp is now 16x16.*flag.*day\.bmp \(8x8\)/.test(nightFirst.said[0]),
    `told: ${nightFirst.said.join(" | ") || "nothing"}`,
  );
  // then the first skin's too: the corners move, the two agree again, and nothing is told
  const thenDay = warningsOf(() =>
    smak.replaceTexture(nightFirst.result, "day.bmp", plainTexture("day.bmp", 16)),
  );
  sure(reachOf(thenDay.result) === 16 && !thenDay.said.length, `${reachOf(thenDay.result)}, ${thenDay.said}`);

  // the other way about: the first skin's picture first (the corners move at once), then the second's
  const dayFirst = warningsOf(() => smak.replaceTexture(flag, "day.bmp", plainTexture("day.bmp", 16)));
  sure(reachOf(dayFirst.result) === 16 && dayFirst.said.length === 1, "the first skin's picture first");
  const thenNight = warningsOf(() =>
    smak.replaceTexture(dayFirst.result, "night.bmp", plainTexture("night.bmp", 16)),
  );
  sure(reachOf(thenNight.result) === 16 && !thenNight.said.length, "then the second's");

  // `quiet` says nothing; a picture of the same size, and a model of one skin, have nothing to tell
  const quiet = warningsOf(() =>
    smak.replaceTexture(flag, "night.bmp", plainTexture("night.bmp", 16), { quiet: true }),
  );
  const sameSize = warningsOf(() => smak.replaceTexture(flag, "night.bmp", plainTexture("night.bmp", 8)));
  const oneSkin = warningsOf(() =>
    smak.replaceTexture(knife.mdl, "knife.bmp", plainTexture("knife.bmp", 64)),
  );
  sure(!quiet.said.length && !sameSize.said.length && !oneSkin.said.length, "told when there was nothing to");
});

test("retexture with a texture the file has wears that one, as replaceMesh does", () => {
  const firstMesh = { bodypart: 0, model: 0, mesh: 0 };
  const other = { ...knife.texture, name: "other.bmp" };
  const once = smak.retexture(knife.mdl, firstMesh, other);
  const twice = smak.retexture(once, firstMesh, other);
  const namesOf = (mdl) => smak.readMdl(mdl).textures.map((texture) => texture.name);
  sure(namesOf(twice).join() === "knife.bmp,other.bmp", `textures: ${namesOf(twice).join()}`);
  sure(smak.readMdl(twice).bodyparts[0].models[0].meshes[0].texture.name === "other.bmp", "what it wears");
  sure(!smak.check(twice).errors.length, smak.check(twice).errors.join("; "));

  // given under that name at another size, the file's own is worn, and the corners are laid for its size
  const smaller = smak.retexture(once, firstMesh, { ...plainTexture("other.bmp", 64) });
  const mesh = smak.readMdl(smaller).bodyparts[0].models[0].meshes[0];
  const farthest = Math.max(
    ...smak
      .readMesh(smaller, smak.readMdl(smaller).bodyparts[0].models[0], mesh)
      .flat()
      .map((corner) => corner.s),
  );
  sure(
    mesh.texture.width === 256 && farthest > 64,
    `width ${mesh.texture.width}, farthest corner ${farthest}`,
  );
});

// ── a model written from nothing ──

test("writeMdl refuses a bodypart with no submodel", () => {
  const withEmptyPart = () =>
    smak.buildMdl({
      name: "parts.mdl",
      bodyparts: [
        { name: "nothing", models: [] },
        {
          name: "body",
          models: [{ name: "knife", meshes: [{ tris: knife.piece.tris, texture: knife.texture }] }],
        },
      ],
    });
  sure(
    refuses(withEmptyPart, /parts\.mdl: the bodypart nothing has no submodel/),
    "an empty bodypart was written",
  );

  // one submodel with no meshes is what an empty bodypart is: every body number then finds a submodel
  const blankFirst = smak.buildMdl({
    name: "parts.mdl",
    bodyparts: [
      { name: "nothing", models: [{ name: "blank", meshes: [] }] },
      {
        name: "body",
        models: [{ name: "knife", meshes: [{ tris: knife.piece.tris, texture: knife.texture }] }],
      },
    ],
  });
  sure(smak.bodyOf(blankFirst, 0).join() === "0,0", `bodyOf: ${smak.bodyOf(blankFirst, 0).join()}`);
  sure(!smak.check(blankFirst).errors.length, smak.check(blankFirst).errors.join("; "));
});

// ── fitting ──

test("a piece is laid on a handle that stands straight along z", () => {
  /** a box as twelve triangles of plain points */
  const boxOf = ([x0, y0, z0], [x1, y1, z1]) => {
    const corner = (i) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
    const faces = [
      [0, 1, 3, 2],
      [4, 6, 7, 5],
      [0, 4, 5, 1],
      [2, 3, 7, 6],
      [0, 2, 6, 4],
      [1, 5, 7, 3],
    ];
    return faces.flatMap(([a, b, c, d]) => [
      [corner(a), corner(b), corner(c)],
      [corner(a), corner(c), corner(d)],
    ]);
  };
  /** the four walls of a square tube up z, each wall four triangles about its middle: alike on every side */
  const tubeOf = (half, z0, z1) =>
    [0, 1, 2, 3].flatMap((side) => {
      const at = (across, z) => {
        const wall = [half, across];
        const turned = side & 1 ? [-wall[1], wall[0]] : wall;
        return [side & 2 ? -turned[0] : turned[0], side & 2 ? -turned[1] : turned[1], z];
      };
      const middle = at(0, (z0 + z1) / 2);
      const rim = [at(-half, z0), at(half, z0), at(half, z1), at(-half, z1)];
      return rim.map((corner, k) => [corner, rim[(k + 1) % 4], middle]);
    });
  // the original, as `measure` gives it: a handle 24 long that stands exactly along z (its numbers are chosen
  // so that its main axis comes out as [0, 0, 1] to the last bit), and a head on one side of its top
  const haft = { name: "haft" };
  const head = { name: "head" };
  const original = [
    ...tubeOf(1.5, 0, 24).map((tri) => tri.map((p) => ({ p, mesh: haft }))),
    ...boxOf([2, -0.25, 18], [5, 0.25, 21]).map((tri) => tri.map((p) => ({ p, mesh: head }))),
  ];
  // the new piece, drawn with its handle on its own x axis: 8 long
  const piece = boxOf([0, -0.25, -0.25], [8, 0.25, 0.25]).map((tri) => tri.map((p) => ({ p })));

  const fit = smak.bestTurn(piece, original, true);
  sure(/on its handle/.test(fit.name), `laid ${fit.name}`);
  const ends = [fit.at([0, 0, 0]), fit.at([8, 0, 0])];
  sure(ends.flat().every(Number.isFinite), `its ends: ${JSON.stringify(ends)}`);
  near(Math.abs(ends[1][2] - ends[0][2]), 24, 1e-9, "as long as the handle, along z");
  near(Math.hypot(ends[1][0] - ends[0][0], ends[1][1] - ends[0][1]), 0, 1e-9, "and nowhere else");
  near(fit.k, 3, 1e-9, "stretched to its length");
  // its width and its thickness are across the handle, at right angles to each other, and as much larger
  const wide = [0, 1, 2].map((axis) => fit.at([0, 1, 0])[axis] - ends[0][axis]);
  const thick = [0, 1, 2].map((axis) => fit.at([0, 0, 1])[axis] - ends[0][axis]);
  near(Math.hypot(...wide), 3, 1e-9, "its width");
  near(Math.hypot(...thick), 3, 1e-9, "its thickness");
  near(smak.dot(wide, thick), 0, 1e-9, "at right angles");
  near(Math.abs(wide[2]) + Math.abs(thick[2]), 0, 1e-9, "across the handle");
  sure(Number.isFinite(fit.left), `what is left between the outlines: ${fit.left}`);
});

// ── pictures ──

test("unpng refuses a PNG it cannot read, saying what it reads", () => {
  const whole = smak.png(2, 2, new Uint8Array(16).fill(200));
  sure(smak.unpng(whole).rgba[0] === 200, "a PNG of its own");

  // colour type 5 is none: it used to come back as a picture of nothing
  const oddType = Buffer.from(whole);
  oddType[PNG_COLOUR_TYPE_AT] = 5;
  sure(
    refuses(() => smak.unpng(oddType), /colour type 5.*grey, RGB or a palette/),
    "a colour type that is none was read",
  );
  // RGBA has 8 and 16 bits a channel only
  const fourBits = Buffer.from(whole);
  fourBits[PNG_BIT_DEPTH_AT] = 4;
  sure(refuses(() => smak.unpng(fourBits), /colour type 6 has no bit depth 4/), "a bit depth the colour type has not was read");
});

test("unpng reads every kind of PNG: 16 bits, fewer than 8, a palette of 16, interlaced, a see-through colour", () => {
  // a picture of 5 by 3 written each way, its rows unfiltered, read back to the pixels it holds
  const [w, h] = [5, 3];
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  /** a PNG of `kind` and `depth` whose pixel (x, y) is the samples `at(x, y)` gives, interlaced or not */
  const pngOf = (kind, depth, at, { interlaced = false, extra = [] } = {}) => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = depth;
    ihdr[9] = kind;
    ihdr[12] = interlaced ? 1 : 0;
    const passes = interlaced ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
    const rows = [];
    for (const [x0, y0, dx, dy] of passes) {
      const xs = [];
      for (let x = x0; x < w; x += dx) xs.push(x);
      if (!xs.length) continue;
      for (let y = y0; y < h; y += dy) {
        const samples = xs.flatMap((x) => at(x, y));
        const bits = [];
        for (const v of samples) for (let b = depth - 1; b >= 0; b--) bits.push((v >> b) & 1);
        while (bits.length % 8) bits.push(0);
        const line = [0];
        for (let i = 0; i < bits.length; i += 8) line.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
        rows.push(Buffer.from(line));
      }
    }
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), ...extra, chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
  };
  const colour = (x, y) => [x * 50, y * 100, (x * 37 + y * 91) % 256, 255 - x * 20];
  const pixels = (picture) => Array.from({ length: w * h }, (_, i) => [...picture.rgba.subarray(i * 4, i * 4 + 4)].join(",")).join(" ");
  const want = (f) => Array.from({ length: w * h }, (_, i) => f(i % w, Math.floor(i / w)).join(",")).join(" ");
  // RGBA, 16 bits a channel: its upper 8
  const rgba16 = pngOf(6, 16, (x, y) => colour(x, y).map((v) => v * 256 + (v ^ 0x5a)));
  sure(pixels(smak.unpng(rgba16)) === want(colour), "16 bits a channel");
  // the same in 8, interlaced
  sure(pixels(smak.unpng(pngOf(6, 8, colour, { interlaced: true }))) === want(colour), "interlaced");
  // grey of 1, 2 and 4 bits, stretched to 0 to 255
  for (const depth of [1, 2, 4]) {
    const most = (1 << depth) - 1;
    const grey = (x, y) => (x + y * w) % (most + 1);
    const read = smak.unpng(pngOf(0, depth, (x, y) => [grey(x, y)], { interlaced: depth === 2 }));
    sure(pixels(read) === want((x, y) => { const v = Math.round((grey(x, y) * 255) / most); return [v, v, v, 255]; }), `grey of ${depth} bits`);
  }
  // a palette of 16 colours, 4 bits a pixel, its alphas in tRNS
  const palette = Buffer.from(Array.from({ length: 16 * 3 }, (_, i) => (i * 17) % 256));
  const index = (x, y) => (x * 3 + y) % 16;
  const paletted = smak.unpng(pngOf(3, 4, (x, y) => [index(x, y)], { extra: [chunk("PLTE", palette), chunk("tRNS", Buffer.from([0, 128]))] }));
  sure(pixels(paletted) === want((x, y) => { const k = index(x, y); return [palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2], k === 0 ? 0 : k === 1 ? 128 : 255]; }), "a palette of 4 bits");
  // grey of 16 bits with a see-through colour (tRNS: its value in 16 bits)
  const key = Buffer.alloc(2);
  key.writeUInt16BE(0x1234);
  const keyed = smak.unpng(pngOf(0, 16, (x, y) => (x === 2 ? [0x1234] : [x * 40 * 256 + 7]), { extra: [chunk("tRNS", key)] }));
  sure(pixels(keyed) === want((x) => (x === 2 ? [0x12, 0x12, 0x12, 0] : [x * 40, x * 40, x * 40, 255])), "a see-through grey");
});

// ── layers ──

test("a layer made before is taken for its texture whatever the capitals of the name", () => {
  const made = smak.layersOf(knife.mdl, { bright: ({ rgb }) => rgb[0] > 0.3 }, { pose: { seq: 0 } });
  sure(made.bright.tex === "knife.bmp", `made for ${made.bright.tex}`);
  // the same layer, named as another tool writes the texture's name
  const capitals = { ...made.bright, tex: "KNIFE.BMP" };
  let asked = 0;
  smak.paint(
    knife.mdl,
    ({ layerAt }) => {
      asked++;
      layerAt("bright");
    },
    { pose: { seq: 0 }, layers: { bright: capitals } },
  );
  sure(asked > 0, "nothing was painted");
});

test("a layer's `over` that names no layer is told, even where no pixel is worn", () => {
  const declarations = {
    lit: ({ rgb }) => rgb[0] > 0.3,
    soft: { fn: ({ rgb }) => rgb[0] > 0.5, blur: 2, over: "lot" },
  };
  const told = /no layer lot on knife\.bmp: it has lit/;
  sure(
    refuses(() => smak.layersOf(knife.mdl, declarations, { pose: { seq: 0 } }), told),
    "on the knife",
  );
  // a body that shows nothing: no pixel of the picture is worn, and the name is as wrong
  const withBlank = smak.addModel(knife.mdl, 0, "blank");
  sure(
    refuses(
      () => smak.layersOf(withBlank, declarations, { pose: { seq: 0, body: 1 }, tex: "knife.bmp" }),
      told,
    ),
    "where no pixel is worn",
  );
  // rightly named, it is made
  const right = { ...declarations, soft: { ...declarations.soft, over: "lit" } };
  const soft = smak.layersOf(knife.mdl, right, { pose: { seq: 0 } }).soft;
  sure(soft.value.length === soft.width * soft.height && soft.value.some((v) => v > 0), "over: lit");
});

// ── drawing ──

test("strip says so when the model has no animation", () => {
  const still = smak.buildMdl({
    name: "still.mdl",
    sequences: [],
    bodyparts: [
      {
        name: "body",
        models: [{ name: "knife", meshes: [{ tris: knife.piece.tris, texture: knife.texture }] }],
      },
    ],
  });
  sure(
    refuses(() => smak.strip(still), /the model has no animations/),
    "no animation at all",
  );
  sure(
    refuses(() => smak.strip(knife.mdl, { seq: "stab" }), /^no animation stab$/),
    "an animation it has not",
  );
});

// ── islands and paint: what is documented, held to ──

test("an island two bodies lay on the same pixels has one border, not two", () => {
  const before = smak.uvIslands(knife.mdl, { seq: 0 }).list;
  const copied = smak.copyBody(knife.mdl, "knife", "second", "knife.bmp");
  const after = smak.uvIslands(copied, { seq: 0 }).list;
  sure(after.length === before.length, `${after.length} islands for ${before.length}`);
  for (const island of before) {
    const both = after[island.id];
    sure(both.tris === 2 * island.tris && both.uses.length === 2, `island ${island.id}: its triangles twice`);
    sure(
      both.border === island.border && both.open === island.open,
      `island ${island.id}: border ${both.border} for ${island.border}`,
    );
  }
});

test("paint with soft asks at every point with the normal there", () => {
  let asked = 0;
  let worst = 0;
  const { mdl } = smak.paint(
    knife.mdl,
    ({ n }) => {
      asked++;
      worst = Math.max(worst, Math.abs(Math.hypot(...n) - 1));
      return [n[2] > 0 ? 1 : 0, 0, 0];
    },
    { pose: { seq: 0 }, soft: 2 },
  );
  sure(asked > 0 && asked % 4 === 0, `asked ${asked} times: four a pixel`);
  near(worst, 0, 1e-9, "a normal of length one at every point");
  sure(!smak.check(mdl).errors.length, smak.check(mdl).errors.join("; "));
});

// ── a shape's own normals ──

/** One texture for the shapes below. */
const grey = plainTexture("grey.bmp", 16);

/** Every corner of a model's body 0, as [point, normal] rounded to three decimals. */
const cornersOf = (mdl) =>
  smak.readMdl(mdl).bodyparts.flatMap((bodypart, part) =>
    bodypart.models.flatMap((model) =>
      model.meshes.flatMap((mesh) =>
        smak
          .readMesh(mdl, model, mesh)
          .flat()
          .map((corner) => ({ part, p: corner.p.map((v) => v.toFixed(3)).join(), n: corner.n })),
      ),
    ),
  );

test("meshOf stores a corner's own normal; buildMdl and putBody hand it on when asked", () => {
  // one triangle in the plane z = 0, facing +z, whose corners say they look up and a little forwards
  const leaning = [0.6, 0, 0.8];
  const flat = [
    { p: [0, 0, 0], uv: [0, 0] },
    { p: [1, 0, 0], uv: [1, 0] },
    { p: [0, 1, 0], uv: [0, 1] },
  ];
  const withNormals = flat.map((corner) => ({ ...corner, n: leaning.map((v) => v * 3) }));

  const worked = smak.meshOf(null, [flat], grey, 0);
  const given = smak.meshOf(null, [withNormals], grey, 0);
  sure(worked.norms.length === 1 && worked.norms[0].join() === "0,0,1", `worked out: ${worked.norms}`);
  sure(given.norms.length === 1, `${given.norms.length} normals`);
  given.norms[0].forEach((v, axis) => near(v, leaning[axis], 1e-12, "its own normal, one long"));
  // a normal of no length says nothing: the faces decide
  const none = smak.meshOf(null, [flat.map((corner) => ({ ...corner, n: [0, 0, 0] }))], grey, 0);
  sure(none.norms[0].join() === "0,0,1", `no direction: ${none.norms}`);

  // buildMdl and putBody: only when asked, so that what was built before is built the same
  const bodyparts = (tris) => [
    { name: "body", models: [{ name: "one", meshes: [{ tris, texture: grey }] }] },
  ];
  const plain = smak.buildMdl({ name: "one.mdl", bodyparts: bodyparts([flat]) });
  const notAsked = smak.buildMdl({ name: "one.mdl", bodyparts: bodyparts([withNormals]) });
  const asked = smak.buildMdl({ name: "one.mdl", bodyparts: bodyparts([withNormals]), ownNormals: true });
  sure(plain.equals(notAsked), "normals were read without being asked for");
  cornersOf(asked).forEach((corner) =>
    corner.n.forEach((v, axis) => near(v, leaning[axis], 1e-6, "buildMdl with ownNormals")),
  );

  const put = (ownNormals) =>
    smak.putBody(knife.mdl, { name: "one", tris: [withNormals], texture: grey, bone: "hand", ownNormals })
      .mdl;
  const putPlain = smak.putBody(knife.mdl, { name: "one", tris: [flat], texture: grey, bone: "hand" }).mdl;
  sure(put(false).equals(putPlain), "putBody read normals without being asked");
  const one = smak.readMdl(put(true)).bodyparts[0].models[1];
  smak
    .readMesh(put(true), one, one.meshes[0])[0]
    .forEach((corner) =>
      corner.n.forEach((v, axis) => near(v, leaning[axis], 1e-6, "putBody with ownNormals")),
    );
});

test("objModel keeps an .obj's own normals, stood up with its points", () => {
  // a square facing the file's +z (its front), whose normals lean up: +y in the file, +z in the game
  const square = ["v 0 0 0", "v 1 0 0", "v 1 1 0", "v 0 1 0", "vn 0 0.6 0.8", "f 1//1 2//1 3//1 4//1"].join(
    "\n",
  );
  const { mdl, warnings } = smak.objModel(smak.readObj(square));
  sure(!warnings.some((warning) => /normals/.test(warning)), warnings.join("; "));
  const corners = cornersOf(mdl);
  sure(corners.length === 6, `${corners.length} corners`);
  for (const corner of corners)
    [0.8, 0, 0.6].forEach((v, axis) => near(corner.n[axis], v, 1e-6, "the file's normal, stood up"));

  // normals that look the other way from their face are not kept: the face's own, and a sentence on it
  const behind = smak.objModel(smak.readObj(square.replace("vn 0 0.6 0.8", "vn 0 0 -1")));
  sure(
    behind.warnings.some((warning) =>
      /2 triangles have normals \(vn\) that look the other way/.test(warning),
    ),
    behind.warnings.join("; ") || "no warning",
  );
  for (const corner of cornersOf(behind.mdl))
    [1, 0, 0].forEach((v, axis) => near(corner.n[axis], v, 1e-6, "worked out from the face"));
});

test("an .obj shared out over bodyparts is lit alike on both sides of the cut", () => {
  // a ball of 2498 points, more than a submodel holds, each point's normal straight out from the middle
  const ACROSS = 64;
  const DOWN = 40;
  const lines = [];
  const numberOf = (row, column) =>
    row === 0 ? 1 : row === DOWN ? 2 + (DOWN - 1) * ACROSS : 2 + (row - 1) * ACROSS + (column % ACROSS);
  for (let row = 0; row <= DOWN; row++)
    for (let column = 0; column < (row === 0 || row === DOWN ? 1 : ACROSS); column++) {
      const down = (row / DOWN) * Math.PI;
      const round = (column / ACROSS) * 2 * Math.PI;
      const out = [Math.sin(down) * Math.cos(round), Math.cos(down), Math.sin(down) * Math.sin(round)];
      lines.push(
        `v ${out.map((v) => (v * 10).toFixed(5)).join(" ")}`,
        `vn ${out.map((v) => v.toFixed(5)).join(" ")}`,
      );
    }
  const word = (row, column) => `${numberOf(row, column)}//${numberOf(row, column)}`;
  for (let row = 0; row < DOWN; row++)
    for (let column = 0; column < ACROSS; column++) {
      // counter-clockwise seen from outside; a triangle at each pole, two elsewhere
      if (row > 0) lines.push(`f ${word(row, column)} ${word(row, column + 1)} ${word(row + 1, column + 1)}`);
      if (row < DOWN - 1)
        lines.push(`f ${word(row, column)} ${word(row + 1, column + 1)} ${word(row + 1, column)}`);
    }
  const { mdl, warnings, report } = smak.objModel(smak.readObj(lines.join("\n")));
  sure(report.bodyparts > 1, `${report.bodyparts} bodyparts`);
  sure(!warnings.some((warning) => /look the other way/.test(warning)), warnings.join("; "));
  sure(
    warnings.some((warning) => /shared out over.*own normals are kept/.test(warning)) &&
      !warnings.some((warning) => /faint line/.test(warning)),
    warnings.join("; "),
  );

  // every point that two bodyparts have: the same normal in both, and it looks straight out
  const first = new Map();
  let shared = 0;
  let worst = 0;
  for (const corner of cornersOf(mdl)) {
    const seen = first.get(corner.p);
    if (!seen) first.set(corner.p, corner);
    else if (seen.part !== corner.part) {
      shared++;
      worst = Math.max(worst, Math.hypot(...corner.n.map((v, axis) => v - seen.n[axis])));
    }
  }
  sure(shared > ACROSS, `${shared} corners on the cuts`);
  near(worst, 0, 1e-6, "the normals each side of a cut");
});

// ── found by the animation piece of 1.0 (its faults 33, 34) ──

test("the readers take a Uint8Array as a Buffer, and readMesh a mesh's index", () => {
  const bytes = new Uint8Array(knife.mdl);
  sure(smak.sequences(bytes).map((s) => s.name).join() === "idle,wave", "sequences");
  const model = smak.readMdl(bytes).bodyparts[0].models[0];
  sure(smak.readMesh(bytes, model, 0).length === smak.readMesh(knife.mdl, model, model.meshes[0]).length, "readMesh by index");
  sure(refuses(() => smak.readMesh(bytes, model, 9), /readMesh takes a mesh of readMdl's model\.meshes/), "a mesh not there");
});

test("render's ground is drawn at a z, or at the lowest point drawn", () => {
  const GROUND = [240, 200, 70];
  const rowOf = (img) => {
    for (let y = 0; y < img.height; y++)
      if ([0, 1, 2].every((k) => img.rgba[y * img.width * 4 + k] === GROUND[k])) return y;
    return -1;
  };
  const side = { view: "side", width: 96, height: 96 };
  const atZero = rowOf(smak.render(knife.mdl, { ...side, ground: true }));
  const below = rowOf(smak.render(knife.mdl, { ...side, ground: -2 }));
  const low = rowOf(smak.render(knife.mdl, { ...side, ground: "low" }));
  sure(atZero >= 0 && below > atZero, `z = 0 at row ${atZero}, z = -2 lower, at ${below}`);
  sure(low >= 0, `the lowest point's line at row ${low}`);
});
