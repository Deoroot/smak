// Faults mended in 0.7.1 in the examples and the weapon kits. The examples: each answers a wrong argument in
// one line, and none writes a model the check refuses. The kits: what used to come out broken without a word
// is refused in words (a part below the picture), what was read and not said is said in the headers, and
// what worked gives what it gave.
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as smak from "../src/index.mjs";
import { sword, taper } from "../kits/swordkit.mjs";
import { axe, wrap, flared } from "../kits/axekit.mjs";
import { blunt } from "../kits/bluntkit.mjs";
import { bow } from "../kits/bowkit.mjs";
import { test, sure, near, tmp, HERE, knife } from "./helper.mjs";

// ── what the cases share ──

/**
 * Runs one of the examples as a person would, from the temp folder: the code it ended with, what it printed
 * and what it complained of.
 */
const runExample = (name, args = [], env = {}) => {
  const result = spawnSync(process.execPath, [join(HERE, "../examples", name), ...args], {
    cwd: tmp,
    encoding: "utf8",
    env: { ...process.env, BODY: undefined, VIEW: undefined, ...env },
  });
  return { code: result.status, out: result.stdout, err: result.stderr.trim() };
};

/** The files in a folder of the temp folder; none when the folder was never made. */
const filesIn = (folder) => (existsSync(join(tmp, folder)) ? readdirSync(join(tmp, folder)) : []);

/** True when two pieces have the same triangles and the same picture. */
const samePiece = (first, second) =>
  JSON.stringify(first.tris) === JSON.stringify(second.tris) &&
  Buffer.from(first.image.rgb).equals(Buffer.from(second.image.rgb));

/** How many of a piece's triangles have a corner whose place in the texture is outside the picture. */
const outsidePicture = (piece) =>
  piece.tris.filter((triangle) =>
    triangle.some((corner) => corner.uv.some((share) => share < 0 || share > 1)),
  ).length;

/** What a call throws, as its message; "" when it throws nothing. */
const refusal = (call) => {
  try {
    call();
    return "";
  } catch (error) {
    return `${error.constructor.name}: ${error.message}`;
  }
};

/** The comment a kit's file opens with: everything before its first import. */
const headerOf = (kit) => readFileSync(join(HERE, "../kits", kit), "utf8").split("\nimport ")[0];

// the knife as a file, and two more made from it: one the check refuses (a second bodypart of 2400 loose
// points, and GoldSrc holds 2048 a submodel) and one with no animations
const looseTriangles = Array.from({ length: 800 }, (_, i) =>
  [
    [0, 0],
    [1, 0],
    [0, 1],
  ].map(([across, up]) => ({ p: [i * 0.03 + across, up, i * 0.02], uv: [across, up], bone: "arm" })),
);
const onHand = knife.piece.tris.map((triangle) => triangle.map((corner) => ({ ...corner, bone: "hand" })));
const knifeBody = { name: "knife", meshes: [{ tris: onHand, texture: knife.texture }] };
const animations = [
  { name: "idle", fps: 10, loops: true, frames: [knife.still] },
  { name: "wave", fps: 12, loops: false, frames: knife.wave },
];
const refusedModel = smak.buildMdl({
  name: "refused.mdl",
  bones: knife.bones,
  bodyparts: [
    { name: "weapon", models: [knifeBody] },
    {
      name: "bulk",
      models: [{ name: "bulk", meshes: [{ tris: looseTriangles, texture: knife.texture }] }],
    },
  ],
  sequences: animations,
});
const stillModel = smak.buildMdl({
  name: "still.mdl",
  bones: knife.bones,
  bodyparts: [{ name: "weapon", models: [knifeBody] }],
  sequences: [],
});
const knifeFile = join(tmp, "faults_knife.mdl");
const refusedFile = join(tmp, "faults_refused.mdl");
const stillFile = join(tmp, "faults_still.mdl");
const notAModel = join(tmp, "faults_not_a_model.mdl");
const inTheWay = join(tmp, "faults_in_the_way");

// ── the examples ──

test("no example writes a model the check refuses, and each ends with code 1", () => {
  writeFileSync(refusedFile, refusedModel);
  sure(smak.check(refusedModel).errors.length === 1, "the model made to be refused is refused");
  for (const [name, args, folder] of [
    ["02-swap-mesh.mjs", [refusedFile, "0", "faults_02"], "faults_02"],
    ["03-reskin.mjs", [refusedFile, "0", "faults_03"], "faults_03"],
    ["04-animate.mjs", [refusedFile, "0", "", "faults_04"], "faults_04"],
    ["05-by-place.mjs", [refusedFile, "faults_05"], "faults_05"],
    ["05-by-place.mjs", [refusedFile, "faults_05b", "--drop", "0"], "faults_05b"],
  ]) {
    const run = runExample(name, args);
    sure(run.code === 1, `${name} on a model the check refuses ended with code ${run.code}`);
    sure(/2400 points/.test(run.out + run.err), `${name} says what the check found`);
    sure(filesIn(folder).length === 0, `${name} wrote ${filesIn(folder).join(", ")} all the same`);
  }
});

test("every example answers a wrong argument in one line and code 1", () => {
  writeFileSync(knifeFile, knife.mdl);
  writeFileSync(notAModel, "not a model");
  writeFileSync(inTheWay, "a file where a folder is asked for");
  const missing = join(tmp, "faults_missing.mdl");
  // [example, arguments, what its one line has to say, the environment]
  const wrong = [
    ["01-new-model.mjs", [inTheWay], /output folder .* cannot be made/],
    ["06-from-obj.mjs", [inTheWay], /output folder .* cannot be made/],

    ["02-swap-mesh.mjs", [], /^usage: /],
    ["02-swap-mesh.mjs", [missing, "0", "faults_w"], /there is no file/],
    ["02-swap-mesh.mjs", [notAModel, "0", "faults_w"], /not a studio model/],
    ["02-swap-mesh.mjs", [knifeFile, "seven", "faults_w"], /body number is a whole number.*seven/],
    ["02-swap-mesh.mjs", [knifeFile, "0", "faults_w", "("], /not a regular expression/],
    ["02-swap-mesh.mjs", [knifeFile, "0", "faults_w", "nosuch"], /no mesh to replace.*knife\.bmp/],
    ["02-swap-mesh.mjs", [knifeFile, "0", inTheWay], /output folder .* cannot be made/],

    ["03-reskin.mjs", [], /^usage: .*\[texture name or number\]/],
    ["03-reskin.mjs", [missing], /there is no file/],
    ["03-reskin.mjs", [notAModel], /not a studio model/],
    ["03-reskin.mjs", [knifeFile, "7", "faults_w"], /no texture 7: it has 0 knife\.bmp/],
    ["03-reskin.mjs", [knifeFile, "nosuch.bmp", "faults_w"], /no texture nosuch\.bmp: it has 0 knife\.bmp/],
    ["03-reskin.mjs", [knifeFile, "0", inTheWay], /output folder .* cannot be made/],
    ["03-reskin.mjs", [knifeFile, "0", "faults_w"], /BODY is a whole number/, { BODY: "x" }],

    ["04-animate.mjs", [], /^usage: /],
    ["04-animate.mjs", [missing], /there is no file/],
    ["04-animate.mjs", [notAModel], /not a studio model/],
    ["04-animate.mjs", [knifeFile, "9", "", "faults_w"], /no animation 9: it has 0 idle, 1 wave/],
    ["04-animate.mjs", [knifeFile, "nosuch", "", "faults_w"], /no animation nosuch: it has 0 idle, 1 wave/],
    ["04-animate.mjs", [knifeFile, "0", "nosuchbone", "faults_w"], /no bone nosuchbone: it has arm, hand/],
    ["04-animate.mjs", [knifeFile, "0", "", inTheWay], /output folder .* cannot be made/],
    ["04-animate.mjs", [stillFile, "0", "", "faults_w"], /has no animations/],
    ["04-animate.mjs", [knifeFile, "0", "", "faults_w"], /VIEW is "first" or not set/, { VIEW: "sideways" }],
    ["04-animate.mjs", [knifeFile, "0", "", "faults_w"], /BODY is a whole number/, { BODY: "x" }],

    ["05-by-place.mjs", [], /^usage: /],
    ["05-by-place.mjs", [missing, "faults_w"], /there is no file/],
    ["05-by-place.mjs", [notAModel, "faults_w"], /not a studio model/],
    [
      "05-by-place.mjs",
      [knifeFile, "faults_w", "--seq", "nosuch"],
      /no animation nosuch: it has 0 idle, 1 wave/,
    ],
    ["05-by-place.mjs", [knifeFile, "faults_w", "--seq", "9"], /no animation 9: it has 0 idle, 1 wave/],
    ["05-by-place.mjs", [knifeFile, "faults_w", "--seq"], /--seq needs a value/],
    ["05-by-place.mjs", [knifeFile, "faults_w", "--drop"], /--drop needs a value/],
    ["05-by-place.mjs", [knifeFile, "faults_w", "--drop", "a,b"], /--drop takes the numbers of pieces/],
    [
      "05-by-place.mjs",
      [knifeFile, "faults_w", "--drop", "9999"],
      /no piece 9999: the model has pieces 0 to/,
    ],
    ["05-by-place.mjs", [knifeFile, "faults_w", "--colour", "red"], /no flag --colour/],
    ["05-by-place.mjs", [knifeFile, inTheWay], /output folder .* cannot be made/],
  ];
  writeFileSync(stillFile, stillModel);
  for (const [name, args, says, env] of wrong) {
    const run = runExample(name, args, env);
    const asked = `${name} ${args.map((arg) => arg.replace(tmp, "")).join(" ")}`;
    sure(run.code === 1, `${asked}: ended with code ${run.code}`);
    sure(
      run.err.split("\n").length === 1 && says.test(run.err),
      `${asked}: said "${run.err.split("\n").slice(0, 3).join(" / ")}"`,
    );
  }
  sure(filesIn("faults_w").length === 0, `a wrong argument left ${filesIn("faults_w").join(", ")}`);
});

test("example 02 draws a model that has no animations at rest, without the strip", () => {
  writeFileSync(stillFile, stillModel);
  const run = runExample("02-swap-mesh.mjs", [stillFile, "0", "faults_still"]);
  sure(run.code === 0 && run.err === "", `it ended with code ${run.code}: ${run.err.split("\n")[0]}`);
  const wrote = filesIn("faults_still").sort().join(", ");
  sure(wrote === "faults_still.mdl, swap_before_after.png", `it wrote ${wrote}`);
  sure(/no swap_strip\.png: the model has no animations/.test(run.out), "and says why there is no strip");
});

// ── the kits ──

// the parts the cases below make their weapons of
const bladeOf = { x0: 5.7, x1: 17, half: taper(0.9, 0.8, 0.7, 0.9) };
const gripProfile = [
  [0.8, 0.5],
  [2.2, 0.6],
  [4.4, 0.56],
  [5.2, 0.6],
];
const haft = {
  profile: [
    [0, 0.5],
    [1, 0.6],
    [20, 0.5],
    [21, 0.3],
  ],
};
const bit = { x0: 15, x1: 19, edges: (k) => [0.4, 3 + k], thick: 0.4 };
/** `count` collars along a haft, each a turned part. */
const collars = (count) =>
  Array.from({ length: count }, (_, i) => ({
    profile: [
      [1 + i, 0.55],
      [1.3 + i, 0.9],
      [1.7 + i, 0.9],
      [2 + i, 0.55],
    ],
  }));
/** An `extra` that builds one small face in the zone it is handed, and paints it. */
const faceInZone = ({ M, S, zone }) => {
  const corners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].map(([x, y]) => M.V([x, y, 0], [zone.x + 4 + x * 8, zone.y + 4 + y * 8]));
  M.quad(...corners, [0.5, 0.5, -1]);
  S.zone({ x: zone.x + 4, y: zone.y + 4, w: 8, h: 8 }, () => [1, 0, 0]);
};
/** An `extra` that goes by places of its own: a face that wears a corner of the grip's picture. */
const faceOnGrip = ({ M }) => {
  const corners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].map(([x, y]) => M.V([x, y, 0], [860 + x * 8, 20 + y * 8]));
  M.quad(...corners, [0.5, 0.5, -1]);
};

test("swordkit: `extra` on the short texture is refused in words when it builds below the picture", () => {
  // tall: the zone is in the picture, and the part wears what it painted
  const tall = sword({ seed: 27, tall: true, blade: bladeOf, extra: faceInZone });
  sure(outsidePicture(tall) === 0 && tall.image.height === 384, "with `tall` the part is in the picture");
  // flames make the texture tall too
  const flamed = sword({ seed: 27, blade: { ...bladeOf, flames: () => [1, 0.5, 0] }, extra: faceInZone });
  sure(outsidePicture(flamed) === 0, "with flames the part is in the picture");
  // short: the zone handed over lies below the picture, and a part built there is refused
  const said = refusal(() => sword({ seed: 27, blade: bladeOf, extra: faceInZone }));
  sure(
    /^Error: swordkit: `extra` needs `tall: true`/.test(said),
    `without \`tall\`: ${said || "no refusal"}`,
  );
  // an `extra` that goes by places of its own in the picture worked, and still does
  const own = sword({ seed: 27, blade: bladeOf, extra: faceOnGrip });
  const plain = sword({ seed: 27, blade: bladeOf });
  sure(
    own.tris.length === plain.tris.length + 2 && outsidePicture(own) === 0,
    "an `extra` that keeps to the picture is let be",
  );
  sure(/extra: +needs `tall: true`/.test(headerOf("swordkit.mjs")), "the header says `extra` needs `tall`");
});

test("axekit: more fittings than the texture has rows for are refused in words", () => {
  const ten = axe({
    seed: 3,
    haft,
    bits: [bit],
    turned: collars(8),
    rings: [
      { x: -1, radius: 0.8 },
      { x: -2, radius: 0.8 },
    ],
  });
  sure(outsidePicture(ten) === 0, `ten fittings fit: ${outsidePicture(ten)} triangles outside the picture`);
  const said = refusal(() => axe({ seed: 3, haft, bits: [bit], turned: collars(12) }));
  sure(
    /^Error: axekit: the fittings do not fit in the texture \(12 turned parts and rings, .* rows for 10\)/.test(
      said,
    ),
    `twelve fittings: ${said || "no refusal"}`,
  );
  sure(
    /do not fit in the texture/.test(refusal(() => axe({ seed: 3, haft, bits: [bit], turned: collars(11) }))),
    "eleven are one too many",
  );
  // the taller texture (a bit with veins) has rows for twenty-one
  const veins = () => [0.2, 0.6, 1];
  const veined = axe({ seed: 3, haft, bits: [{ ...bit, veins }], turned: collars(12) });
  sure(veined.image.height === 1024 && outsidePicture(veined) === 0, "twelve fit in the taller texture");
  sure(
    /rows for 21/.test(refusal(() => axe({ seed: 3, haft, bits: [{ ...bit, veins }], turned: collars(22) }))),
    "twenty-two do not",
  );
  // `extra` gets the rows the fittings leave: with nine there is one, with ten none
  const nine = axe({ seed: 3, haft, bits: [bit], turned: collars(9), extra: faceInZone });
  sure(outsidePicture(nine) === 0, "nine fittings leave `extra` a row");
  const noRoom = refusal(() => axe({ seed: 3, haft, bits: [bit], turned: collars(10), extra: faceInZone }));
  sure(
    /^Error: axekit: the fittings leave `extra` no room/.test(noRoom),
    `ten and \`extra\`: ${noRoom || "no refusal"}`,
  );
});

test("axekit: an axe may be a head with no haft; one with no bit is refused in words", () => {
  const whole = axe({ seed: 4, haft, bits: [bit] });
  const head = axe({ seed: 4, bits: [bit] });
  sure(
    head.tris.length > 20 && head.tris.length < whole.tris.length && head.haft === true,
    `the head alone has ${head.tris.length} triangles of the axe's ${whole.tris.length}`,
  );
  // the head's own triangles are the same with a haft and without
  const headOfWhole = JSON.stringify(whole.tris.slice(whole.tris.length - head.tris.length));
  sure(headOfWhole === JSON.stringify(head.tris), "and they are the head's of the whole axe");
  for (const spec of [{ haft, bits: [] }, { haft }]) {
    const said = refusal(() => axe(spec));
    sure(/^Error: axekit: an axe needs one bit at least/.test(said), `no bit: ${said || "no refusal"}`);
  }
});

test("rings: bluntkit flattens one as axekit does, and each kit keeps its own number of sides", () => {
  /** How far a ring's triangles reach along each axis, and how many they are. */
  const measureRing = (make, ring) => {
    const without = make([]);
    const ringTriangles = make([ring]).tris.slice(without.tris.length);
    const bounds = smak.box(ringTriangles.flat().map((corner) => corner.p));
    return { count: ringTriangles.length, size: bounds.mx.map((value, axis) => value - bounds.mn[axis]) };
  };
  const ofBlunt = (rings) => blunt({ seed: 11, haft: { profile: haft.profile }, rings });
  const ofAxe = (rings) => axe({ seed: 11, haft, bits: [bit], rings });
  const ring = { x: -2, radius: 1.8, tube: 0.6 };
  const round = measureRing(ofBlunt, ring);
  const flat = measureRing(ofBlunt, { ...ring, flatten: 0.25 });
  near(flat.size[2], round.size[2] * 0.25, 1e-9, "a flattened ring's thickness in bluntkit");
  sure(flat.size[0] === round.size[0] && flat.size[1] === round.size[1], "its width stays");
  sure(samePiece(ofBlunt([ring]), ofBlunt([{ ...ring, flatten: 1 }])), "flatten 1 is the round ring");
  near(measureRing(ofAxe, { ...ring, flatten: 0.25 }).size[2], flat.size[2], 1e-9, "the same as axekit's");
  // 6 corners round the tube; round the ring 8 in bluntkit and 6 in axekit, two triangles a face
  sure(round.count === 8 * 6 * 2, `bluntkit's ring has ${round.count} triangles`);
  sure(measureRing(ofAxe, ring).count === 6 * 6 * 2, "axekit's has 6 sides");
  for (const kit of ["axekit.mjs", "bluntkit.mjs"])
    sure(
      /rings: +\[\{ x, y, radius, tube, sides, metal, flatten \}\]/.test(headerOf(kit)) &&
        /sides: corners round the ring \((6|8) here/.test(headerOf(kit)),
      `${kit} says what a ring takes and how many sides it has`,
    );
});

test("the kits' headers name the options the code reads, with the defaults it has", () => {
  // each option by name in its kit's header
  for (const [kit, words] of [
    [
      "axekit.mjs",
      [
        "stations",
        "edges.stations",
        "twist",
        "px (pixels a unit",
        "strap",
        "flatten",
        "caps: [start, end]",
        "at(s, a, b)",
      ],
    ],
    [
      "bluntkit.mjs",
      ["faceted", "capPx", "caps: [start, end] (its flat ends", "at(s, a, b) (where it stands, as a part's"],
    ],
    ["swordkit.mjs", ["mottle", "flameStations", "ray skin"]],
    ["bowkit.mjs", ["mid (the y of its middle"]],
  ])
    for (const word of words) sure(headerOf(kit).includes(word), `${kit}'s header has no "${word}"`);

  // and each default the headers give, said outright, makes the piece the kit makes without it
  const turnedPart = {
    profile: [
      [14.5, 0.6],
      [15, 0.9],
      [19, 0.9],
      [19.5, 0.6],
    ],
  };
  const axeWith = (more) => axe({ seed: 5, haft, bits: [bit], ...more });
  sure(
    samePiece(
      axeWith({ turned: [{ ...turnedPart, sides: 4 }] }),
      axeWith({ turned: [{ ...turnedPart, sides: 4, twist: Math.PI / 4 }] }),
    ) &&
      samePiece(
        axeWith({ turned: [turnedPart] }),
        axeWith({ turned: [{ ...turnedPart, twist: 0, px: 40 }] }),
      ),
    "a turned part's twist and px",
  );
  const fourteen = [0, 0.03, 0.08, 0.16, 0.26, 0.36, 0.46, 0.54, 0.64, 0.74, 0.84, 0.92, 0.97, 1];
  const flare = flared({ x0: 14, x1: 20.5, n0: 16.5, n1: 18.5, reach: 5 });
  sure(
    samePiece(axeWith({}), axeWith({ bits: [{ ...bit, stations: fourteen }] })) &&
      samePiece(
        axeWith({ bits: [{ x0: 14, x1: 20.5, edges: flare }] }),
        axeWith({ bits: [{ x0: 14, x1: 20.5, edges: flare, stations: flare.stations }] }),
      ),
    "a bit's stations",
  );
  sure(
    samePiece(axeWith({}), axeWith({ haft: { ...haft, caps: [true, true] } })) &&
      !samePiece(axeWith({}), axeWith({ haft: { ...haft, caps: [false, false] } })),
    "an axe's haft is closed at both ends",
  );
  // a lattice's straps, at a point that is on one
  const lattice = { kind: "lattice", colour: [0.1, 0.3, 0.2] };
  const sameColour = (first, second) => first.every((value, channel) => value === second[channel]);
  sure(
    sameColour(
      wrap(lattice, 0.5, 0.225, 1, 5),
      wrap({ ...lattice, strap: [0.07, 0.06, 0.06] }, 0.5, 0.225, 1, 5),
    ) &&
      !sameColour(
        wrap(lattice, 0.5, 0.225, 1, 5),
        wrap({ ...lattice, strap: [0.5, 0.5, 0.1] }, 0.5, 0.225, 1, 5),
      ),
    "a lattice's strap",
  );
  const head = {
    profile: [
      [13, 0.7],
      [14, 1.6],
      [18, 1.6],
      [19, 0.6],
    ],
    caps: [true, true],
  };
  const bluntWith = (part, haftMore = {}) =>
    blunt({ seed: 6, haft: { profile: haft.profile, ...haftMore }, parts: [part] });
  sure(
    samePiece(bluntWith({ ...head, sides: 6 }), bluntWith({ ...head, sides: 6, faceted: true })) &&
      samePiece(bluntWith({ ...head, sides: 8 }), bluntWith({ ...head, sides: 8, faceted: false })) &&
      !samePiece(bluntWith({ ...head, sides: 8 }), bluntWith({ ...head, sides: 8, faceted: true })),
    "a part of six sides or fewer is faceted",
  );
  sure(
    samePiece(bluntWith(head), bluntWith({ ...head, px: 12, capPx: 12 * 1.3 })) &&
      !samePiece(bluntWith(head), bluntWith({ ...head, capPx: 30 })),
    "a part's px and capPx",
  );
  sure(
    samePiece(bluntWith(head), bluntWith(head, { caps: [true, true] })) &&
      samePiece(bluntWith(head), bluntWith(head, { at: (s, a, b) => [s, a, b] })) &&
      !samePiece(bluntWith(head), bluntWith(head, { at: (s, a, b) => [s, a, b + 1] })),
    "a blunt's haft: its caps and where it stands",
  );
  // a flat end's light is the constant the header says it is
  const lights = new Set();
  bluntWith({ ...head, cap: (q) => (lights.add(q.light), [0.5, 0.5, 0.5]) });
  sure(lights.size === 1 && lights.has(1), "a cap's light is always 1");
});

test("swordkit: a lattice grip can be mottled towards its own colour; unless told it is as it was", () => {
  const blue = [0.1, 0.2, 0.5];
  const gripOf = (more) =>
    sword({ seed: 13, blade: bladeOf, grip: { profile: gripProfile, wrap: "lattice", ...more } });
  /** How many pixels of the grip's zone are clearly redder than they are blue. */
  const reddish = (piece) => {
    let count = 0;
    for (let y = 8; y < 78; y++)
      for (let x = 848; x < 1016; x++) {
        const at = (y * piece.image.width + x) * 3;
        if (piece.image.rgb[at] > piece.image.rgb[at + 2] + 20) count++;
      }
    return count;
  };
  sure(
    samePiece(gripOf({ colour: blue }), gripOf({ colour: blue, mottle: [0.5, 0.12, 0.09] })),
    "the red it is mottled towards unless told",
  );
  sure(samePiece(gripOf({}), gripOf({ colour: [0.36, 0.07, 0.06] })), "the leather's colour unless told");
  sure(reddish(gripOf({ colour: blue })) > 500, "a blue lattice is mottled with red unless told");
  sure(reddish(gripOf({ colour: blue, mottle: "own" })) === 0, 'with mottle: "own" it is blue all over');
  sure(reddish(gripOf({ colour: blue, mottle: [0.1, 0.5, 0.2] })) === 0, "or towards a colour given");
});

test("bowkit: the string's corners take their places face by face, in a strip 1000 pixels long", () => {
  const bowOf = (halfLength) =>
    bow({
      seed: 7,
      L: halfLength,
      centre: () => 0,
      thick: () => 0.5,
      wide: () => 0.5,
      paint: (q) => [0.4 * q.light, 0.3 * q.light, 0.2 * q.light],
      string: { x: halfLength - 1, drop: 0.2, mid: -halfLength / 2 },
    });
  // the string's triangles are the last sixteen: two halves of four faces
  for (const [halfLength, longest] of [
    [10, Math.hypot(9, 0.2 - 5) * 40],
    [40, 1000],
  ]) {
    const corners = bowOf(halfLength).tris.slice(-16).flat();
    const rows = corners.map((corner) => Math.round(corner.uv[1] * 256));
    const reach = Math.max(...corners.map((corner) => corner.uv[0] * 1024)) - 8;
    sure(
      rows.every((row) => row === 169 || row === 173),
      `a string corner on row ${rows.find((row) => row !== 169 && row !== 173)}`,
    );
    near(reach, longest, 1e-6, `a bow ${2 * halfLength} long: the string's strip`);
  }
});

test("example 08 builds its forms: a roof, a dome, an arcade and a frame-placed bench, written as a map the plan check takes", () => {
  const run = runExample("08-form.mjs", ["forms_out"]);
  sure(run.code === 0, `exit ${run.code}: ${run.err}`);
  sure(filesIn("forms_out").includes("map-forms.map"), `written: ${filesIn("forms_out").join(", ")}`);
  const map = smak.maps.readMap(readFileSync(join(tmp, "forms_out", "map-forms.map"), "utf8"));
  const report = smak.maps.checkPlan(map, { leak: false });
  sure(report.errors.length === 0, `plan errors: ${report.errors.join("; ")}`);
});
