// Wavefront OBJ: the text file every modelling tool can write (Blender, a script, a DSL), read into the kit's
// triangles and made into a studio model. An .obj lists points (`v`), texture coordinates (`vt`), normals
// (`vn`) and faces (`f`) that name them by number; an .mtl beside it says which picture or colour each
// material is.
//
//   readMtl(text)              the materials of an .mtl
//   readObj(text, { mtl })     the faces of an .obj as triangles, group by group, in the file's own axes
//   objMeshes(obj, options)    those triangles stood up for GoldSrc (+z up), one list a material
//   objModel(obj, options)     a whole .mdl from them, with what was done to make it fit
//   objToMdl(obj, options)     the same, the file's bytes alone
//
// Nothing here reads the disk: the caller reads the .obj, the .mtl and the pictures (`smak obj` does).
import { buildMdl } from "../make/build.mjs";
import { meshOf } from "../make/mesh.mjs";
import { check, LIMITS } from "./check.mjs";
import { indexed, shrink, unpng, unbmp, rgbOf, rgbaOf } from "../core/image.mjs";
import { unjpeg } from "../core/jpeg.mjs";
import { sub, dot, cross, box } from "../core/vec.mjs";

// ── what the two formats hold ──────────────────────────────────────────────
/** A corner's place in its picture when the file gives it none: the picture's middle. */
const NO_COORDINATES = [0.5, 0.5];
/** The angle (degrees) that makes faces share a normal however sharply they meet, and the one that never does. */
const ALWAYS_SMOOTH = 180;
const NEVER_SMOOTH = 0;
/** A normal as text, to this many decimals: corners whose normals are that near are lit as one. */
const NORMAL_DECIMALS = 3;
/** The side of the flat picture a material without one wears, in pixels, and the grey of one with no colour. */
const FLAT_SIDE = 16;
const NO_COLOUR = [0.6, 0.6, 0.6];
/** The texture flag of a picture with holes: its palette is kept as it is when it is made smaller. */
const TEX_MASKED = 64;
/** A texture's name is kept in 64 bytes, the last a zero, and ends in .bmp; so does a model's own name. */
const NAME_MOST = 63;
const TEXTURE_ENDING = ".bmp";
/** How much of a material's name goes into its texture's name. */
const TEXTURE_NAME_FROM_MATERIAL = 40;
/** A studio model keeps a corner's place in its picture as a 16 bit number of pixels. */
const PIXEL_MOST = 32767;
/** How far over the edge of a picture a coordinate may be and still count as on it (a rounding error). */
const ON_THE_EDGE = 1e-4;
/** The most copies of a picture, each way, that are laid side by side for coordinates that repeat it. */
const REPEATS_MOST = 8;
/** A triangle whose doubled area is under this (in units, after scaling) is a line or a point, and left out. */
const NO_AREA = 1e-9;
/** A submodel's triangles are kept under what Xash draws of one: three corners each. */
const TRIANGLES_MOST = Math.floor(LIMITS.xash.verts / 3);

// ── the text ───────────────────────────────────────────────────────────────
/** The letter some editors put before a text's first: a byte order mark, which is not part of the text. */
const BYTE_ORDER_MARK = 0xfeff;
/**
 * The statements of an .obj or .mtl file: [{ line, keyword, words, rest }]. Comments (# to the line's end)
 * and empty lines are left out, a line that ends in \ goes on in the next, `words` are what follows the
 * keyword and `rest` the same as one piece of text (a name may have spaces in it).
 */
function statementsOf(text) {
  // a file saved with a byte order mark begins with one letter that is not the text's
  const statements = [];
  const whole = String(text);
  const lines = (whole.charCodeAt(0) === BYTE_ORDER_MARK ? whole.slice(1) : whole).split(/\r?\n/);
  let pending = "";
  lines.forEach((raw, index) => {
    const whole = pending + raw.replace(/#.*$/, "");
    if (whole.endsWith("\\")) {
      pending = whole.slice(0, -1) + " ";
      return;
    }
    pending = "";
    const trimmed = whole.trim();
    if (!trimmed) return;
    const [keyword, ...words] = trimmed.split(/\s+/);
    statements.push({ line: index + 1, keyword, words, rest: trimmed.slice(keyword.length).trim() });
  });
  return statements;
}

/** Numbers read from a statement's words: it throws, naming the line, when one of them is not a number. */
function numbersOf(statement, from, count, what) {
  const numbers = statement.words.slice(from, from + count).map(Number);
  if (numbers.length < count || numbers.some((value) => !Number.isFinite(value)))
    throw new Error(
      `${what}: line ${statement.line}: "${statement.keyword} ${statement.rest}" needs ${count} numbers`,
    );
  return numbers;
}

// ── materials ──────────────────────────────────────────────────────────────
/** The file a `map_Kd` names: what is left of its words after the options (-s 1 1 1, -clamp on ...). */
function pictureNameOf(words) {
  const left = [...words];
  const isOption = (word) => /^-[A-Za-z]/.test(word);
  const isOptionValue = (word) => /^(-?[\d.]+|on|off)$/i.test(word);
  while (left.length > 1 && isOption(left[0])) {
    left.shift();
    while (left.length > 1 && isOptionValue(left[0])) left.shift();
  }
  return left.join(" ") || null;
}

/**
 * The materials of an .mtl file: [{ name, colour, picture }].
 *   colour    its `Kd`, the flat colour: [r, g, b] from 0 to 1 (null when the file gives none)
 *   picture   its `map_Kd`, the file name of its picture as the .mtl writes it (null when it has none)
 * Everything else an .mtl says (shininess, transparency, bump maps) has no place in a studio model and is
 * passed over.
 */
export function readMtl(text) {
  const materials = [];
  let material = null;
  for (const statement of statementsOf(text)) {
    if (statement.keyword === "newmtl") {
      material = { name: statement.rest, colour: null, picture: null };
      materials.push(material);
    } else if (!material) continue;
    else if (statement.keyword === "Kd") {
      // one number is a grey; `Kd spectral` and `Kd xyz` are not colours this reads
      const given = statement.words.slice(0, 3).map(Number);
      if (!given.length || given.some((value) => !Number.isFinite(value))) continue;
      const [red, green = red, blue = red] = given;
      material.colour = [red, green, blue].map((value) => Math.min(1, Math.max(0, value)));
    } else if (statement.keyword === "map_Kd") material.picture = pictureNameOf(statement.words);
  }
  return materials;
}

// ── the .obj read ──────────────────────────────────────────────────────────
/**
 * The number (from 0) of the thing a face names by `word`: counted from 1, or back from the last one given so
 * far when it is under 0. It throws when the file has no such thing yet.
 */
function numberNamed(word, count, what, statement) {
  const given = Number(word);
  const number = given < 0 ? count + given : given - 1;
  if (!Number.isInteger(given) || given === 0 || number < 0 || number >= count)
    throw new Error(
      `readObj: line ${statement.line}: the face names ${what} ${word}, and the file has ${count} by then`,
    );
  return number;
}

/**
 * An .obj file read: { groups, materials, libraries }.
 *   groups     [{ object, group, material, tris }]: the faces, in the file's order, each run of them under one
 *              `o`, `g` and `usemtl`. `material` is "" for faces before any `usemtl`
 *   tris       the kit's triangles: [[{ p, uv, n, group, smooth } x3]]
 *                p       [x, y, z] as the file has it: its own axes (usually +y up) and its own units
 *                uv      [u, v] from the picture's top left, as the kit counts it: an .obj counts `vt` from
 *                        the bottom left, so v is turned over here (the middle of the picture for a corner
 *                        the file gives none; `uv.given` is then false). Coordinates past 0..1 stay as they
 *                        are: `objMeshes` deals with them
 *                n       the corner's `vn` as the file has it (its own axes, any length), or null
 *                group, smooth   what `meshOf` reads to decide which faces share a normal: see below
 *   materials  what `readMtl` gives for `mtl`: the text of the .mtl, or materials already read ([] without)
 *   libraries  the file names its `mtllib` lines give
 * Read: `v`, `vt`, `vn`, `f` in its four forms (v, v/vt, v//vn, v/vt/vn), numbers under 0 (counted back from
 * the last one given), `o`, `g`, `usemtl`, `mtllib`, `s`. A face of more than three corners is cut into a fan
 * from its first corner, which is right for a face that bulges nowhere inwards (convex) and wrong for one
 * that does. Everything else (`l`, `p`, curves and surfaces, a colour after a point's place) is passed over.
 * It throws, naming the line, on a face that names a point the file has not got, on a face of fewer than
 * three corners and on a number that is none; and when the file has no faces at all.
 *
 * Smoothing. Where the kit works a corner's normal out, it does so from the faces that meet there, and the
 * corner's `group` and `smooth` say which of them count (see "Creases" in docs/API.md). A file's own normals
 * do two things. They are stored: `objMeshes` stands each `vn` up with its point, and `objModel` keeps it as
 * the corner's normal (`putBody` and `buildMdl` do with `ownNormals: true`), so the model is lit as the tool
 * that made it meant. And they say where the creases are, which is what counts wherever they are not kept:
 *   - a face whose corners all have a `vn`: at each point, the faces that give that point the same `vn` share
 *     a normal, and those that give it another do not. A cube exported flat stays flat, a sphere exported
 *     smooth stays smooth, and an edge marked sharp stays sharp
 *   - else, in a file that uses `s`: faces of one smoothing group share (`s 1`), `s off` and `s 0` leave
 *     every face flat
 *   - else: nothing is set, and faces that meet at less than the model's `smooth` angle (40 degrees) share.
 *
 * As a new body of a model that is there (`putBody`): the triangles go in as they are, since they are the
 * kit's own. With one material and its picture, on a bone:
 *   const obj = readObj(readFileSync("pack.obj", "utf8"));
 *   const [pack] = objMeshes(obj, { up: "y", scale: 1 }).meshes;      // stood up (+z), one list a material
 *   const texture = textureFrom(readFileSync("pack.png"), "pack.bmp");
 *   const { mdl, body } = putBody(src, { name: "pack", tris: pack.tris, texture, bone: "Bip01 Spine2",
 *     pose: { seq: 0, frame: 0 } });
 * With `pose` the points are in model space, as the model stands in that pose; without it they are in the
 * bone's own space. A body wears one picture: for an .obj of several materials, the first goes in with
 * `putBody` and each further one with `addMesh` and `replaceMesh`, or the pictures are laid on one sheet
 * first.
 */
export function readObj(text, { mtl } = {}) {
  const points = [];
  const coordinates = [];
  const normals = [];
  const groups = [];
  const libraries = [];
  let object = "";
  let group = "";
  let material = "";
  // undefined until the file says `s`; then 0 for off, or the smoothing group's name
  let smoothing;
  let current = null;
  let faces = 0;
  const normalKey = (normal) => normal.map((value) => value.toFixed(NORMAL_DECIMALS)).join();

  /** One corner of a face, from its word: v, v/vt, v//vn or v/vt/vn. */
  const cornerOf = (word, statement) => {
    const [pointWord, coordinateWord, normalWord] = word.split("/");
    const p = points[numberNamed(pointWord, points.length, "point", statement)];
    const coordinate = coordinateWord
      ? coordinates[numberNamed(coordinateWord, coordinates.length, "texture coordinate", statement)]
      : null;
    const n = normalWord ? normals[numberNamed(normalWord, normals.length, "normal", statement)] : null;
    const uv = Object.assign(coordinate ? [coordinate[0], 1 - coordinate[1]] : [...NO_COORDINATES], {
      given: Boolean(coordinate),
    });
    return { p, uv, n };
  };
  /** The corners of one face with what `meshOf` reads: by their normals, by the smoothing group, or not. */
  const withCreases = (corners) => {
    if (corners.every((corner) => corner.n))
      return corners.map((corner) => ({
        ...corner,
        group: `n${normalKey(corner.n)}`,
        smooth: ALWAYS_SMOOTH,
      }));
    if (smoothing === undefined) return corners;
    if (!smoothing) return corners.map((corner) => ({ ...corner, smooth: NEVER_SMOOTH }));
    return corners.map((corner) => ({ ...corner, group: `s${smoothing}`, smooth: ALWAYS_SMOOTH }));
  };
  /** The run of faces being filled: a new one when the object, the group or the material has changed. */
  const groupNow = () => {
    if (!current || current.object !== object || current.group !== group || current.material !== material) {
      current = { object, group, material, tris: [] };
      groups.push(current);
    }
    return current;
  };

  for (const statement of statementsOf(text)) {
    const { keyword, words, rest } = statement;
    if (keyword === "v") points.push(numbersOf(statement, 0, 3, "readObj"));
    else if (keyword === "vn") normals.push(numbersOf(statement, 0, 3, "readObj"));
    else if (keyword === "vt") {
      // `vt u` alone is a place along a line: its v is 0
      const [u, v = 0] = numbersOf(statement, 0, Math.min(2, Math.max(1, words.length)), "readObj");
      coordinates.push([u, v]);
    } else if (keyword === "f") {
      if (words.length < 3)
        throw new Error(`readObj: line ${statement.line}: a face of ${words.length} corners: it takes three`);
      const corners = withCreases(words.map((word) => cornerOf(word, statement)));
      const tris = groupNow().tris;
      for (let i = 1; i + 1 < corners.length; i++) tris.push([corners[0], corners[i], corners[i + 1]]);
      faces++;
    } else if (keyword === "o") object = rest;
    else if (keyword === "g") group = rest;
    else if (keyword === "usemtl") material = rest;
    else if (keyword === "s") smoothing = /^(off|0)?$/i.test(rest) ? 0 : rest;
    else if (keyword === "mtllib") {
      // several libraries on one line, unless the words are one name with spaces in it
      const several = words.length > 1 && words.every((word) => /\.mtl$/i.test(word));
      libraries.push(...(several ? words : [rest]));
    }
  }
  if (!faces)
    throw new Error(
      `readObj: no faces in it (${points.length} points): an .obj is text, with lines of "v x y z" and "f 1 2 3"`,
    );
  const materials = typeof mtl === "string" ? readMtl(mtl) : (mtl ?? []);
  return { groups, materials, libraries };
}

// ── stood up for GoldSrc ───────────────────────────────────────────────────
/**
 * The function that takes a point of the file to GoldSrc's axes (+x forward, +y left, +z up): the axes
 * turned, then the turn about the upright axis, then the scale. Both turns are turns and not mirrors, so a
 * face goes on looking the way it looked.
 */
function standing(up, turn, scale) {
  if (up !== "y" && up !== "z") throw new Error(`objMeshes: up is "y" or "z", not ${up}`);
  if (!(scale > 0)) throw new Error(`objMeshes: scale is a number over 0, not ${scale}`);
  const angle = (turn * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return (p) => {
    // +y up: the file's +z (its front, as a viewer shows it) is forward, its +x is the model's left
    const [x, y, z] = up === "y" ? [p[2], p[0], p[1]] : p;
    return [(x * cos - y * sin) * scale, (x * sin + y * cos) * scale, z * scale];
  };
}

/**
 * One material's triangles with their coordinates brought onto the picture. Each triangle is first moved by
 * whole pictures to where its lowest coordinates are in 0..1, which changes nothing of what it shows.
 * Returns { tris, repeat: [across, down] }: how many copies of the picture, side by side, the coordinates now
 * run over (1, 1 when every triangle lies within one), each coordinate divided by that.
 */
function onThePicture(tris, material, tiling) {
  if (tiling === "keep") return { tris, repeat: [1, 1] };
  const repeat = [1, 1];
  const moved = tris.map((tri) => {
    const shift = [0, 1].map((axis) =>
      Math.floor(Math.min(...tri.map((corner) => corner.uv[axis])) + ON_THE_EDGE),
    );
    for (const axis of [0, 1]) {
      const reach = Math.max(...tri.map((corner) => corner.uv[axis])) - shift[axis];
      repeat[axis] = Math.max(repeat[axis], Math.ceil(reach - ON_THE_EDGE));
    }
    return tri.map((corner) => ({ ...corner, uv: [corner.uv[0] - shift[0], corner.uv[1] - shift[1]] }));
  });
  const copies = `${repeat[0]} by ${repeat[1]}`;
  const called = material ? `the material ${material}` : "the faces without a material";
  if (tiling === "refuse" && (repeat[0] > 1 || repeat[1] > 1))
    throw new Error(
      `objMeshes: ${called} has texture coordinates that run over ${copies} copies of its picture, and a studio model's picture is not repeated: lay them inside 0..1, or allow { tiling: "repeat" }`,
    );
  if (repeat[0] > REPEATS_MOST || repeat[1] > REPEATS_MOST)
    throw new Error(
      `objMeshes: ${called} has texture coordinates that run over ${copies} copies of its picture: more than the ${REPEATS_MOST} each way that are laid side by side. Cut the faces where the picture repeats, or lay the coordinates inside 0..1`,
    );
  const onto = (uv) => [0, 1].map((axis) => Math.min(1, Math.max(0, uv[axis] / repeat[axis])));
  return { tris: moved.map((tri) => tri.map((corner) => ({ ...corner, uv: onto(corner.uv) }))), repeat };
}

/**
 * The triangles of an .obj (from `readObj`) as GoldSrc has a model: +x forward, +z up, in units, one list a
 * material. Returns { meshes, warnings, box }.
 *   meshes    [{ material, tris, repeat }] in the order the materials first appear. `tris` are the kit's
 *             triangles, ready for `buildMdl` and `putBody`; a corner's `n` is the file's normal there, stood
 *             up as its point is (null where the file gives none, or one that looks the other way from its
 *             face), which those two keep with `ownNormals: true`. `repeat`: [across, down], how many copies
 *             of the material's picture its texture has to hold side by side (see `tiling`); [1, 1] unless
 *             coordinates repeat
 *   warnings  sentences: what was left out or changed
 *   box       { mn, mx }: the box round the model as placed
 * Options:
 *   scale     units of the game for one of the file's (1). A unit is about an inch: a file in metres takes
 *             39.37, one in centimetres 0.3937
 *   up        "y" (the default: what Blender and most tools write) or "z". With "y" the file's +y becomes +z,
 *             its +z becomes +x (forward) and its +x becomes +y (the model's left): the side an .obj viewer
 *             shows as the front, and Blender's front view, is the model's front. With "z" the points are
 *             taken as they are
 *   turn      degrees about the upright axis, anticlockwise seen from above (0): 180 for a model that comes
 *             out facing backwards
 *   centre    true: the middle of the model's box goes to the origin (false)
 *   ground    true: its lowest point goes to z = 0 (false). With `centre` too: centred across and along,
 *             standing on z = 0
 *   tiling    what to do with coordinates that run past one copy of the picture, which a studio model's
 *             picture cannot be trusted to repeat. A triangle that lies whole in another copy (u from 2 to 3)
 *             is moved back by whole pictures in every case, at no cost. For one that runs across copies:
 *               "repeat" (default)  the picture is laid `repeat` times side by side in the texture and the
 *                                   coordinates divided: it looks the same, with fewer pixels a copy. Up to 8
 *                                   each way; more is refused
 *               "refuse"            an error that names the material
 *               "keep"              the coordinates as they are, for an engine known to repeat (the kit's own
 *                                   drawing does)
 * Triangles of no area are left out and counted in a warning.
 */
export function objMeshes(
  obj,
  { scale = 1, up = "y", turn = 0, centre = false, ground = false, tiling = "repeat" } = {},
) {
  if (!["repeat", "refuse", "keep"].includes(tiling))
    throw new Error(`objMeshes: tiling is "repeat", "refuse" or "keep", not ${tiling}`);
  const stand = standing(up, turn, scale);
  // a normal is turned as its point is, and neither made larger nor moved
  const turned = standing(up, turn, 1);
  const warnings = [];
  // the triangles of each material, in the order the materials first appear
  const byMaterial = new Map();
  let noArea = 0;
  let turnedAway = 0;
  for (const group of obj.groups)
    for (const tri of group.tris) {
      const stood = tri.map((corner) => ({
        ...corner,
        p: stand(corner.p),
        n: corner.n ? turned(corner.n) : corner.n,
      }));
      const face = cross(sub(stood[1].p, stood[0].p), sub(stood[2].p, stood[0].p));
      if (!(Math.hypot(...face) > NO_AREA)) {
        noArea++;
        continue;
      }
      // a normal that looks the other way from its face (the file's faces go counter-clockwise seen from
      // outside) would light the face from behind: such a triangle's normals are worked out instead
      const away = stood.some((corner) => corner.n && dot(corner.n, face) < 0);
      if (away) turnedAway++;
      const placed = away ? stood.map((corner) => ({ ...corner, n: null })) : stood;
      if (!byMaterial.has(group.material)) byMaterial.set(group.material, []);
      byMaterial.get(group.material).push(placed);
    }
  if (noArea) warnings.push(`${noArea} triangles of no area (a line or a point) were left out`);
  if (turnedAway)
    warnings.push(
      `${turnedAway} triangles have normals (vn) that look the other way from their faces: theirs are worked out from the faces instead`,
    );
  if (!byMaterial.size) throw new Error("objMeshes: every face of the .obj is a line or a point");

  // where the origin goes
  const all = [...byMaterial.values()].flat(2).map((corner) => corner.p);
  const bounds = box(all);
  const middle = bounds.mn.map((least, axis) => (least + bounds.mx[axis]) / 2);
  const move = [
    centre ? middle[0] : 0,
    centre ? middle[1] : 0,
    ground ? bounds.mn[2] : centre ? middle[2] : 0,
  ];
  const moved = (p) => [p[0] - move[0], p[1] - move[1], p[2] - move[2]];

  const meshes = [];
  for (const [material, tris] of byMaterial) {
    const here = tris.map((tri) => tri.map((corner) => ({ ...corner, p: moved(corner.p) })));
    const laid = onThePicture(here, material, tiling);
    if (laid.repeat[0] > 1 || laid.repeat[1] > 1)
      warnings.push(
        `${material ? `the material ${material}` : "the faces without a material"}: its texture coordinates repeat the picture, which a studio model's picture does not do: the picture is laid ${laid.repeat[0]} by ${laid.repeat[1]} times in its texture, with that many fewer pixels a copy`,
      );
    meshes.push({ material, tris: laid.tris, repeat: laid.repeat });
  }
  return { meshes, warnings, box: { mn: moved(bounds.mn), mx: moved(bounds.mx) } };
}

// ── pictures ───────────────────────────────────────────────────────────────
/**
 * What a caller gives for a material's picture, as an image ({ width, height, rgb }) or, when it comes with a
 * palette of its own, a texture: a PNG, BMP or JPEG file's bytes, a texture, or an image.
 */
function pictureGiven(given, material) {
  if (Buffer.isBuffer(given) || given instanceof Uint8Array) {
    const file = Buffer.from(given);
    if (file.toString("latin1", 0, 2) === "BM") return unbmp(file);
    if (file[0] === 0xff && file[1] === 0xd8) return unjpeg(file);
    return rgbOf(unpng(file));
  }
  if (given?.pixels && given.palette) return given;
  if (given?.rgb) return given;
  if (given?.rgba) return rgbOf(given);
  throw new Error(
    `objModel: the picture given for the material ${material} is neither a PNG or BMP file's bytes, nor a texture, nor an image`,
  );
}

/** A flat picture of one colour ([r, g, b] from 0 to 1): what a material without a picture wears. */
function flatPicture(colour) {
  const rgb = new Uint8Array(FLAT_SIDE * FLAT_SIDE * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = Math.round(colour[i % 3] * 255);
  return { width: FLAT_SIDE, height: FLAT_SIDE, rgb };
}

/** A picture (an image or a texture) laid `across` by `down` times side by side. */
function repeated(picture, [across, down]) {
  if (across === 1 && down === 1) return picture;
  const bytes = picture.pixels ? 1 : 3;
  const from = picture.pixels ?? picture.rgb;
  const width = picture.width * across;
  const height = picture.height * down;
  const to = new Uint8Array(width * height * bytes);
  const row = picture.width * bytes;
  for (let y = 0; y < height; y++)
    for (let copy = 0; copy < across; copy++)
      to.set(
        from.subarray((y % picture.height) * row, (y % picture.height) * row + row),
        y * width * bytes + copy * row,
      );
  return picture.pixels ? { ...picture, width, height, pixels: to } : { width, height, rgb: to };
}

/** A texture with holes made `factor` times smaller by keeping one pixel in `factor`: its palette stays. */
function everyNth(texture, factor) {
  const width = Math.floor(texture.width / factor);
  const height = Math.floor(texture.height / factor);
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      pixels[y * width + x] = texture.pixels[y * factor * texture.width + x * factor];
  return { ...texture, width, height, pixels };
}

/**
 * A picture no larger than `most` pixels a side: made a whole number of times smaller when it is larger (each
 * pixel the mean of a block, as `shrink` does), and left alone when it is not.
 */
function withinSize(picture, most, material) {
  const factor = Math.ceil(Math.max(picture.width, picture.height) / most);
  if (factor <= 1) return picture;
  if (Math.min(picture.width, picture.height) < factor)
    throw new Error(
      `objModel: the picture of the material ${material} is ${picture.width}x${picture.height}: too long and thin to be made ${factor} times smaller, which fitting it in ${most} pixels takes`,
    );
  if (picture.pixels && picture.flags & TEX_MASKED) return everyNth(picture, factor);
  const image = picture.pixels ? rgbOf({ ...picture, rgba: rgbaOf(picture) }) : picture;
  const smaller = shrink(image, factor);
  return picture.pixels ? { ...smaller, flags: picture.flags } : smaller;
}

/** A name for a material's texture that no texture before it has: the material's, with .bmp after it. */
function textureNameFor(material, taken) {
  const stem = material.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, TEXTURE_NAME_FROM_MATERIAL) || "material";
  let name = stem + TEXTURE_ENDING;
  for (let nth = 2; taken.has(name.toLowerCase()); nth++) name = `${stem}_${nth}${TEXTURE_ENDING}`;
  taken.add(name.toLowerCase());
  return name;
}

/** Two textures show the same picture. */
const samePicture = (a, b) =>
  a.width === b.width &&
  a.height === b.height &&
  (a.flags ?? 0) === (b.flags ?? 0) &&
  Buffer.from(a.pixels).equals(Buffer.from(b.pixels)) &&
  Buffer.from(a.palette).equals(Buffer.from(b.palette));

/**
 * The texture one mesh wears: the picture given for its material, else a flat one of the material's colour,
 * laid side by side where its coordinates repeat and kept within `most` pixels. What was done is written
 * into `warnings`. Returns { texture, from }: `from` says in a few words where the picture came from.
 */
function textureOfMesh(mesh, { materials, textures, most, taken, warnings }) {
  const material = materials.find((entry) => entry.name === mesh.material);
  const called = mesh.material ? `the material ${mesh.material}` : "the faces without a material";
  const given = Object.hasOwn(textures, mesh.material) ? textures[mesh.material] : undefined;
  let picture;
  let from;
  if (given !== undefined && given !== null) {
    picture = pictureGiven(given, mesh.material);
    from = "the picture given";
    const bare = mesh.tris.filter((tri) => tri.some((corner) => corner.uv.given === false)).length;
    if (bare)
      warnings.push(
        `${called}: ${bare} of its ${mesh.tris.length} triangles have no texture coordinates (no vt): they take the colour of the middle of the picture`,
      );
  } else {
    if (mesh.material && !material)
      warnings.push(`${called} is in no .mtl that was given: it is a flat grey`);
    else if (material?.picture)
      warnings.push(
        `${called} names the picture ${material.picture}, which was not given: it is ${material.colour ? "the flat colour of its Kd" : "a flat grey"}`,
      );
    picture = flatPicture(material?.colour ?? NO_COLOUR);
    from = material?.colour ? `the colour ${material.colour.map((v) => +v.toFixed(3)).join(" ")}` : "a grey";
    // one colour all over: nothing to repeat
    return { texture: indexed(picture, textureNameFor(mesh.material || "default", taken)), from };
  }
  const laid = repeated(picture, mesh.repeat);
  const fitted = withinSize(laid, most, mesh.material);
  if (fitted !== laid)
    warnings.push(
      `${called}: its picture${laid === picture ? "" : `, laid ${mesh.repeat[0]} by ${mesh.repeat[1]} times,`} is ${laid.width}x${laid.height}, larger than ${most}: made ${fitted.width}x${fitted.height}`,
    );
  const name = textureNameFor(mesh.material || "default", taken);
  const texture = fitted.pixels ? { ...fitted, name } : indexed(fitted, name);
  return { texture, from };
}

// ── within what a submodel holds ───────────────────────────────────────────
/**
 * Triangles cut into runs that each fit one submodel: no more points or normals than GoldSrc holds of one,
 * as `meshOf` will store them, and no more triangles than Xash draws of one. A run that does not fit is cut
 * in two halves, in the file's order. Returns [{ tris, points, normals }].
 */
function runsThatFit(tris, texture, smooth) {
  const mesh = meshOf(null, tris, texture, 0, smooth);
  const points = mesh.verts.length;
  const normals = mesh.norms.length;
  const most = LIMITS.goldsrc.verts;
  if ((points <= most && normals <= most && tris.length <= TRIANGLES_MOST) || tris.length === 1)
    return [{ tris, points, normals }];
  const half = Math.ceil(tris.length / 2);
  return [
    ...runsThatFit(tris.slice(0, half), texture, smooth),
    ...runsThatFit(tris.slice(half), texture, smooth),
  ];
}

/**
 * The meshes shared out over as few submodels as hold them, in order: [{ meshes: [{ tris, texture }], points,
 * normals, triangles }]. A model of one .obj that fits is one submodel.
 */
function submodelsOf(meshes, smooth) {
  const most = LIMITS.goldsrc.verts;
  const submodels = [];
  let last = null;
  for (const mesh of meshes)
    for (const run of runsThatFit(mesh.tris, mesh.texture, smooth)) {
      const fits =
        last &&
        last.points + run.points <= most &&
        last.normals + run.normals <= most &&
        last.triangles + run.tris.length <= TRIANGLES_MOST &&
        last.meshes.length < LIMITS.goldsrc.meshes;
      if (!fits) {
        last = { meshes: [], points: 0, normals: 0, triangles: 0 };
        submodels.push(last);
      }
      last.meshes.push({ tris: run.tris, texture: mesh.texture });
      last.points += run.points;
      last.normals += run.normals;
      last.triangles += run.tris.length;
    }
  return submodels;
}

// ── the model ──────────────────────────────────────────────────────────────
/**
 * A studio model from an .obj (what `readObj` gives): { mdl, warnings, report }. It is made by `buildMdl`:
 * one bone, "root", at the origin, and one still animation, "idle", so that the game can load it; one
 * bodypart, "body", with one submodel, and one mesh a material. No hit boxes or attachments (see `buildMdl`).
 * Options, with those of `objMeshes` (scale, up, turn, centre, ground, tiling):
 *   name            what the file calls itself ("model.mdl"; .mdl is added when it is missing)
 *   textures        { material's name: its picture }: the bytes of a PNG or BMP file, a texture as the kit
 *                   holds one ({ width, height, pixels, palette, flags }), or an image ({ width, height,
 *                   rgb }). A material without one wears a flat picture of 16x16 in its `Kd` colour, or grey
 *                   when it has none. A PNG's see-through parts are not holes here: give a texture made by
 *                   `masked` for that
 *   maxTextureSize  512: a picture with a longer side is made a whole number of times smaller (GoldSrc draws
 *                   nothing finer; pass 256 for a world model, or 4096 for Xash alone)
 *   smooth          40: the angle under which faces share a normal where the file says nothing (no `vn`, no
 *                   `s`)
 * What an .obj may hold and a studio model may not, and what is done about each:
 *   - more than 2048 points or normals in a submodel (GoldSrc), or 5461 triangles (what Xash draws of one):
 *     the model is shared out over several bodyparts ("body", "body2", ...), all of them shown by body 0.
 *     With the file's own normals (`vn`) the light is the same on both sides of where two of them meet;
 *     without, each side works its normals out alone and the light may show a faint line there on a smooth
 *     surface. Over 32 bodyparts it is refused
 *   - normals: the file's `vn` are kept, each corner its own (see `readObj`); a corner without one, and a
 *     triangle whose normals look the other way from its face, get theirs worked out from the faces
 *   - a picture over `maxTextureSize`: made smaller
 *   - texture coordinates past 0..1: see `tiling` in `objMeshes`
 *   - names: a texture is called after its material, cut to what the format holds, made unique, ending .bmp
 *   - materials that show the same picture share one texture
 * The result is passed through `check` for GoldSrc and for Xash, and an error from either is thrown.
 * `warnings` are sentences on what was changed or left out; `report` is { name, triangles, points, bodyparts,
 * box: { mn, mx }, textures: [{ name, material, width, height, from }] }.
 */
export function objModel(obj, options = {}) {
  const { name = "model.mdl", textures = {}, maxTextureSize = LIMITS.goldsrc.texture, smooth = 40 } = options;
  const fileName = /\.mdl$/i.test(name) ? name : `${name}.mdl`;
  if (fileName.length > NAME_MOST)
    throw new Error(`objModel: the name ${fileName} is longer than the ${NAME_MOST} letters a model's holds`);
  if (!(maxTextureSize >= 1))
    throw new Error(`objModel: maxTextureSize is a number of pixels, not ${maxTextureSize}`);
  const { meshes, warnings, box: bounds } = objMeshes(obj, options);

  // each mesh's texture; one that shows the picture of a texture before it wears that one
  const taken = new Set();
  const worn = [];
  const dressed = meshes.map((mesh) => {
    const made = textureOfMesh(mesh, {
      materials: obj.materials ?? [],
      textures,
      most: maxTextureSize,
      taken,
      warnings,
    });
    const same = worn.find((entry) => samePicture(entry.texture, made.texture));
    if (same) taken.delete(made.texture.name.toLowerCase());
    else worn.push({ ...made, material: mesh.material });
    const texture = same ? same.texture : made.texture;
    if (options.tiling === "keep") {
      const furthest = Math.max(
        ...mesh.tris
          .flat()
          .map((corner) =>
            Math.max(Math.abs(corner.uv[0]) * texture.width, Math.abs(corner.uv[1]) * texture.height),
          ),
      );
      if (furthest > PIXEL_MOST)
        throw new Error(
          `objModel: the material ${mesh.material} has texture coordinates ${Math.round(furthest)} pixels out, and a studio model holds ${PIXEL_MOST}`,
        );
    }
    return { tris: mesh.tris, texture };
  });

  const submodels = submodelsOf(dressed, smooth);
  const points = submodels.reduce((sum, submodel) => sum + submodel.points, 0);
  const triangles = submodels.reduce((sum, submodel) => sum + submodel.triangles, 0);
  if (submodels.length > LIMITS.goldsrc.bodyparts)
    throw new Error(
      `objModel: ${triangles} triangles on ${points} points: more than ${LIMITS.goldsrc.bodyparts} bodyparts of ${LIMITS.goldsrc.verts} points hold. Make the shape with fewer`,
    );
  if (submodels.length > 1) {
    // a corner with the file's own normal is lit alike on both sides of a cut; one worked out is not
    const everyNormalGiven = dressed.every((mesh) =>
      mesh.tris.every((tri) => tri.every((corner) => corner.n)),
    );
    const atTheCuts = everyNormalGiven
      ? "The file's own normals are kept, so the light is the same on both sides of where two meet"
      : "Where two meet on a smooth surface the light may show a faint line";
    warnings.push(
      `${points} points in ${triangles} triangles are more than one submodel holds (${LIMITS.goldsrc.verts} points and normals, ${TRIANGLES_MOST} triangles): the model is shared out over ${submodels.length} bodyparts, all shown by body 0. ${atTheCuts}`,
    );
  }

  const modelName = fileName.replace(/\.mdl$/i, "");
  const mdl = buildMdl({
    name: fileName,
    smooth,
    ownNormals: true,
    bodyparts: submodels.map((submodel, nth) => ({
      name: nth ? `body${nth + 1}` : "body",
      models: [{ name: nth ? `${modelName}${nth + 1}` : modelName, meshes: submodel.meshes }],
    })),
  });
  for (const engine of ["goldsrc", "xash"]) {
    const errors = check(mdl, engine).errors;
    if (errors.length)
      throw new Error(`objModel: the model would not load in ${engine}: ${errors.join("; ")}`);
  }
  return {
    mdl,
    warnings,
    report: {
      name: fileName,
      triangles,
      points,
      bodyparts: submodels.length,
      box: bounds,
      textures: worn.map(({ texture, material, from }) => ({
        name: texture.name,
        material,
        width: texture.width,
        height: texture.height,
        from,
      })),
    },
  };
}

/**
 * The bytes of a .mdl from an .obj (what `readObj` gives): `objModel` with its options (name, textures,
 * scale, up, turn, centre, ground, tiling, maxTextureSize, smooth), for when the file is all that is wanted.
 * What `objModel` returns as `warnings` is printed on the console instead, unless `quiet` is true.
 *   writeFileSync("crate.mdl", objToMdl(readObj(text, { mtl }), { name: "crate.mdl", textures: { wood: png } }));
 */
export function objToMdl(obj, options = {}) {
  const { mdl, warnings } = objModel(obj, options);
  if (!options.quiet) for (const warning of warnings) console.warn(`smak: objToMdl: ${warning}`);
  return mdl;
}
