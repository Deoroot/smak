// What is made of a file read by `readFbx`, `readGlb` or `readObj` (the common shape of import-shape.mjs): a
// prop's model, or a piece for `addItem` and `addFitted`, as a kit would have made it.
//
//   importScale(imported, options)     the size it is given: units for one of the file's, and why
//   importPictures(imported, options)  each material's picture, as a texture
//   importModel(imported, options)     a prop: a whole .mdl, one bone, one still animation
//   importPiece(imported, options)     a piece { tris, image, haft }: laid along +x, its grip found or told
//   pieceTexture(piece, name)          the picture such a piece wears in each file of an item's family
//   importSummary(imported)            what is in it, as lines to print
//   pictureBeside(material, files)     which of the files beside a model is a material's picture
//
// Nothing here reads the disk.
import { objModel } from "./obj.mjs";
import { LIMITS } from "./check.mjs";
import { indexed, masked, shrink, unpng, unbmp, rgbOf, rgbaOf } from "../core/image.mjs";
import { sub, cross, box } from "../core/vec.mjs";
import { measured, axisNamed, UNITS_A_METRE } from "../core/import-shape.mjs";
import { unjpeg } from "../core/jpeg.mjs";
import { reduce } from "../make/qem.mjs";

// ── the size ───────────────────────────────────────────────────────────────
/**
 * How large an imported scene is made: { factor, said }. `factor`: units of the game for one unit of the
 * file; `said`: a sentence on where it comes from.
 *   fit     the longest side of the box about it is made this many units, whatever the file says of its own
 *           size (packs differ wildly: a mace two metres long is common)
 *   scale   times its true size (1): the file's unit is first brought to the game's, 39.37 units to a metre
 *           (a unit is about an inch), then multiplied by this
 * `fit` goes before `scale` when both are given.
 */
export function importScale(imported, { scale, fit } = {}) {
  const { mn, mx } = imported.box;
  const longest = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
  if (fit !== undefined) {
    if (!(fit > 0)) throw new Error(`importScale: fit is a number of units over 0, not ${fit}`);
    if (!(longest > 0)) throw new Error("importScale: the file has no size to fit: every point is in one place");
    return {
      factor: fit / longest,
      said: `fitted: its longest side (${+longest.toPrecision(5)} of the file's units) made ${fit} units`,
    };
  }
  const times = scale ?? 1;
  if (!(times > 0)) throw new Error(`importScale: scale is a number over 0, not ${scale}`);
  const metres = imported.unit?.metres ?? 1;
  return {
    factor: metres * UNITS_A_METRE * times,
    said: `${times === 1 ? "its true size" : `${times} times its true size`}: one unit of the file is ${+metres.toPrecision(6)} m (${imported.unit?.said ?? "not said"}), a metre ${UNITS_A_METRE} units; its longest side comes to ${+(longest * metres * UNITS_A_METRE * times).toFixed(1)} units`,
  };
}

// ── pictures ───────────────────────────────────────────────────────────────
/** A picture is see-through at a pixel whose alpha is under this, and is given holes when this share of it is. */
const SOLID_ALPHA = 128;
const HOLES_LEAST_SHARE = 0.002;
/** The words in a picture's file name that say it is a material's colour, and those that say it is not. */
const COLOUR_WORDS = /base[_ ]?colou?r|albedo|diffuse|_col\b|colou?r/i;
const OTHER_MAPS = /normal|rough|metal|height|bump|spec|emiss|occlusion|_ao\b|_n\b|_r\b|_m\b|opacity|mask/i;
const PICTURE_FILE = /\.(png|bmp|jpe?g)$/i;
const READ_PICTURE = /\.(png|bmp|jpe?g)$/i;

/** A file's name without its folders and without its ending, in small letters. */
const stemOf = (name) =>
  String(name)
    .replaceAll("\\", "/")
    .split("/")
    .pop()
    .replace(/\.[A-Za-z0-9]+$/, "")
    .toLowerCase();

/**
 * Which of the files beside a model is a material's picture: { file, why }, or null. `files`: the names of
 * the files in the model's folder. Looked for, in order: the file the material names (its `picture`, by its
 * name without folders, any ending that is a picture's); a file called after the material; when the folder
 * has one picture of a colour alone (one file, or one whose name says base colour, albedo or diffuse), that
 * one. `why` says which of these it was, for the person to read.
 */
export function pictureBeside(material, files) {
  const pictures = files.filter((file) => PICTURE_FILE.test(file));
  // a picture that is read comes before one that is not
  const first = (list) => list.find((file) => READ_PICTURE.test(file)) ?? list[0];
  if (material.picture) {
    const named = pictures.filter((file) => stemOf(file) === stemOf(material.picture));
    if (named.length) return { file: first(named), why: `the picture the material names (${material.picture})` };
  }
  const name = stemOf(material.name ?? "");
  if (name) {
    const called = pictures.filter((file) => stemOf(file) === name || stemOf(file).startsWith(`${name}_`));
    const colours = called.filter((file) => !OTHER_MAPS.test(file));
    if (colours.length) return { file: first(colours), why: "called after the material" };
  }
  const colours = pictures.filter((file) => !OTHER_MAPS.test(file));
  if (colours.length === 1) return { file: colours[0], why: "the one picture beside the file" };
  const said = colours.filter((file) => COLOUR_WORDS.test(file));
  if (said.length === 1) return { file: said[0], why: "the one picture beside the file whose name says colour" };
  return null;
}

/**
 * A picture given for a material as what `objModel` takes: the bytes of a PNG with see-through parts become a
 * texture with holes (the engine's flag 64, its last colour the hole), a JPEG an image (`unjpeg`), anything
 * else is handed on as it is.
 */
function pictureFor(given, name) {
  const isBytes = Buffer.isBuffer(given) || given instanceof Uint8Array;
  if (!isBytes) return given;
  const file = Buffer.from(given);
  if (file.toString("latin1", 0, 2) === "BM") return file;
  if (file[0] === 0xff && file[1] === 0xd8) return unjpeg(file);
  const image = unpng(file);
  let seeThrough = 0;
  for (let i = 3; i < image.rgba.length; i += 4) if (image.rgba[i] < SOLID_ALPHA) seeThrough++;
  return seeThrough > image.width * image.height * HOLES_LEAST_SHARE ? masked(image, `${name}.bmp`) : file;
}

/**
 * Each material's picture for `objModel`: { textures, notes }. `textures`: { material's name: its picture };
 * `notes`: sentences on a picture that could not be used.
 *   pictures   { material's name: its picture }, the bytes of a PNG or BMP file, a texture or an image; and
 *              under the name "*" one for every material that has none of its own
 * A material with a picture inside the file (`images`) wears that when none is given for it. A PNG with
 * see-through parts becomes a texture with holes. A JPEG is read when it is baseline or progressive (`unjpeg`);
 * one that is not (lossless, arithmetic) is named in `notes`, and the material wears its flat colour.
 */
export function importPictures(imported, { pictures = {} } = {}) {
  const textures = {};
  const notes = [];
  const names = new Set(imported.groups.map((group) => group.material));
  for (const name of names) {
    const material = imported.materials.find((entry) => entry.name === name);
    const inside = material?.image === undefined ? null : imported.images?.[material.image];
    const given = Object.hasOwn(pictures, name) ? pictures[name] : (inside?.bytes ?? pictures["*"]);
    if (given === undefined || given === null) continue;
    try {
      textures[name] = pictureFor(given, name || "default");
    } catch (error) {
      notes.push(`${name ? `the material ${name}` : "the faces without a material"}: ${error.message}`);
    }
  }
  return { textures, notes };
}

// ── fewer triangles ────────────────────────────────────────────────────────
/**
 * An imported scene with fewer triangles, for a bought model made for a newer engine: each run of triangles
 * (a mesh and a material) brought down by the quadric reducer (`reduce`, make/qem.mjs) to its share of
 * `target`, the points two runs share kept where they are in both, so that two runs still meet where they met
 * and no crack opens between two materials. A corner that stays keeps all it carried (its place in the picture, the node
 * and the weights it hangs from, its smoothing group); its normal is dropped, to be worked out again from the
 * new faces. A run too small to give up a triangle safely is left as it is, so the count may stay over
 * `target`. Returns `{ imported, said }`: the scene, and a sentence for the report (null when the scene had no
 * more than `target` and is given back as it was).
 */
export function fewerTriangles(imported, target) {
  if (!(Number.isInteger(target) && target > 0))
    throw new Error(`fewerTriangles: the triangles wanted are a whole number over 0, not ${target}`);
  const count = (groups) => groups.reduce((sum, group) => sum + group.tris.length, 0);
  const before = count(imported.groups);
  if (before <= target) return { imported, said: null };
  // the points two runs share (where two materials of a mesh meet) stay as they are in both, so that both keep
  // the same points along the line between them: joined away on one side only, they would leave a crack
  const keyOf = (p) => `${p[0]},${p[1]},${p[2]}`;
  const runsAt = new Map();
  imported.groups.forEach((group, nth) => {
    for (const tri of group.tris)
      for (const corner of tri) {
        const key = keyOf(corner.p);
        const runs = runsAt.get(key);
        if (!runs) runsAt.set(key, new Set([nth]));
        else runs.add(nth);
      }
  });
  const keep = (p) => runsAt.get(keyOf(p))?.size > 1;
  const refused = {};
  const groups = imported.groups.map((group) => {
    const share = Math.max(1, Math.round((group.tris.length * target) / before));
    if (group.tris.length <= share) return group;
    const { tris, report } = reduce(group.tris, { target: share, keep });
    for (const [why, times] of Object.entries(report.refused)) refused[why] = (refused[why] ?? 0) + times;
    return { ...group, tris: tris.map((tri) => tri.map((corner) => ({ ...corner, n: null }))) };
  });
  const after = count(groups);
  // when it stopped short, why: the reason that refused the most joins
  const [most, times] = Object.entries(refused).sort((a, b) => b[1] - a[1])[0] ?? [];
  const short =
    after > target
      ? ` (${target} asked: no join was left that keeps the shape and its picture${times ? `; most were refused ${REFUSED[most] ?? most} (${times} times)` : ""})`
      : "";
  return { imported: { ...imported, groups }, said: `${before} triangles brought down to ${after}${short}` };
}
/** Why the reducer refuses a join, as `fewerTriangles` says it. */
const REFUSED = {
  seam: "where two charts of its picture meet, which a join would smear across",
  link: "for they would pinch the surface",
  turned: "for they would turn a face over",
  border: "across an open border",
  flat: "for they would flatten a closed piece",
};

// ── a prop ─────────────────────────────────────────────────────────────────
/** `objModel`, its refusal saying how far `fewerTriangles` got first. */
function fromObj(imported, fewer, options) {
  try {
    return objModel(imported, options);
  } catch (error) {
    if (fewer) error.message = `${error.message} (${fewer})`;
    throw error;
  }
}
/** Where a prop's origin may be put. */
const ORIGINS = ["keep", "base", "centre"];
/** More triangles than this in one prop is more than GoldSrc draws at its ease. */
export const COMFORTABLE_TRIANGLES = 2500;

/**
 * A prop from an imported scene, in its rest pose: { mdl, warnings, report }. It is `objModel` on the common
 * shape: one bone, one still animation, a mesh a material, shared out over bodyparts when it holds more than
 * one submodel does.
 *   name            what the file calls itself
 *   scale, fit      its size: see `importScale` (its true size unless told)
 *   origin          "keep" (unless told: the file's own origin), "base" (the middle of its box on the
 *                   floor: centred across and along, its lowest point at z = 0, as a thing stands) or
 *                   "centre" (the middle of its box)
 *   turn            degrees about the upright axis, for one that faces the wrong way
 *   pictures        see `importPictures`
 *   maxTextureSize, smooth, tiling   as `objModel`
 *   triangles       at most this many: the shape brought down by `fewerTriangles` first
 * `report` is `objModel`'s with `scale` ({ factor, said }), `format`, `fewer` (`fewerTriangles`' sentence, or
 * null), and `heavy`: a sentence when it has more triangles than GoldSrc is at ease with, or null.
 */
export function importModel(scene, options = {}) {
  const { origin = "keep" } = options;
  if (!ORIGINS.includes(origin)) throw new Error(`importModel: origin is ${ORIGINS.join(", ")}, not ${origin}`);
  if (!scene.groups.length)
    throw new Error("importModel: the file has no mesh: nothing to make a model of");
  const { imported, said: fewer } =
    options.triangles === undefined ? { imported: scene, said: null } : fewerTriangles(scene, options.triangles);
  const size = importScale(imported, options);
  const { textures, notes } = importPictures(imported, options);
  const made = fromObj(imported, fewer, {
    name: options.name,
    textures,
    scale: size.factor,
    up: "z",
    turn: options.turn ?? 0,
    centre: origin !== "keep",
    ground: origin === "base",
    ...(options.tiling ? { tiling: options.tiling } : {}),
    ...(options.maxTextureSize ? { maxTextureSize: options.maxTextureSize } : {}),
    ...(options.smooth === undefined ? {} : { smooth: options.smooth }),
  });
  const heavy =
    made.report.bodyparts > 1
      ? `${made.report.triangles} triangles on ${made.report.points} points: more than one submodel of GoldSrc holds (${LIMITS.goldsrc.verts} points), so it is in ${made.report.bodyparts} bodyparts`
      : made.report.triangles > COMFORTABLE_TRIANGLES
        ? `${made.report.triangles} triangles: more than the ${COMFORTABLE_TRIANGLES} GoldSrc draws at its ease for one prop`
        : null;
  return {
    mdl: made.mdl,
    // `objModel` speaks of an .obj's words: said here by the format's own
    warnings: [...notes, ...made.warnings.map((warning) => warning.replaceAll(" (no vt)", "").replaceAll(" (vn)", ""))],
    report: { ...made.report, scale: size, format: imported.format, fewer, heavy },
  };
}

// ── a piece ────────────────────────────────────────────────────────────────
/** The ways an imported piece is held (`as`). */
const HOLDS = ["auto", "haft", "plain", "shield"];
/** A triangle whose doubled area is under this is a line or a point. */
const NO_AREA = 1e-12;
/** The share of a weapon's length looked at, at each end, to tell its grip from its head. */
const END_SHARE = 1 / 3;
/** A weapon is hafted when its head end is this many times as wide as its grip end. */
const HEAD_TIMES_GRIP = 1.5;
/** The side of the flat picture a material without one wears on a piece, and its grey. */
const FLAT_SIDE = 16;
const NO_COLOUR = [0.6, 0.6, 0.6];
/** A piece's picture is no larger than this a side: what the kits' own sheets are. */
const PIECE_PICTURE_MOST = 1024;

/** A material's picture as an image { width, height, rgb }: the bytes of a PNG or BMP, an image, or a colour. */
function imageOf(given, colour) {
  if (given === undefined || given === null) {
    const rgb = new Uint8Array(FLAT_SIDE * FLAT_SIDE * 3);
    const flat = colour ?? NO_COLOUR;
    for (let i = 0; i < rgb.length; i++) rgb[i] = Math.round(flat[i % 3] * 255);
    return { width: FLAT_SIDE, height: FLAT_SIDE, rgb };
  }
  if (Buffer.isBuffer(given) || given instanceof Uint8Array) {
    const file = Buffer.from(given);
    if (file.toString("latin1", 0, 2) === "BM") {
      const read = unbmp(file);
      return read.pixels ? rgbOf({ ...read, rgba: rgbaOf(read) }) : read;
    }
    if (file[0] === 0xff && file[1] === 0xd8) return unjpeg(file);
    return rgbOf(unpng(file));
  }
  if (given.rgb) return given;
  if (given.rgba) return rgbOf(given);
  if (given.pixels) return rgbOf({ ...given, rgba: rgbaOf(given) });
  throw new Error("importPiece: a picture is the bytes of a PNG or BMP file, an image or a texture");
}

/** An image made a whole number of times smaller until neither side is over `most`. */
function withinSide(image, most) {
  const factor = Math.ceil(Math.max(image.width, image.height) / most);
  return factor > 1 ? shrink(image, factor) : image;
}

/**
 * Several materials' triangles on one picture: the pictures laid side by side, each as tall as it is, and
 * every corner's coordinates brought to its own picture's part of the whole. A triangle is first moved by
 * whole pictures to where its lowest coordinates are in 0..1 (a studio model's picture does not repeat), and
 * what still runs over an edge is held at it.
 */
function onOnePicture(lists) {
  const width = lists.reduce((sum, list) => sum + list.image.width, 0);
  const height = Math.max(...lists.map((list) => list.image.height));
  const rgb = new Uint8Array(width * height * 3);
  const tris = [];
  let left = 0;
  let held = 0;
  for (const { image, tris: own } of lists) {
    for (let y = 0; y < height; y++) {
      // a picture shorter than the tallest has its last row repeated under it, so that no seam shows black
      const from = Math.min(y, image.height - 1) * image.width * 3;
      rgb.set(image.rgb.subarray(from, from + image.width * 3), (y * width + left) * 3);
    }
    for (const tri of own) {
      const shift = [0, 1].map((a) => Math.floor(Math.min(...tri.map((corner) => corner.uv[a])) + 1e-4));
      tris.push(
        tri.map((corner) => {
          const u = corner.uv[0] - shift[0];
          const v = corner.uv[1] - shift[1];
          if (u > 1 + 1e-4 || v > 1 + 1e-4) held++;
          return {
            ...corner,
            uv: [
              (left + Math.min(1, Math.max(0, u)) * image.width) / width,
              (Math.min(1, Math.max(0, v)) * image.height) / height,
            ],
          };
        }),
      );
    }
    left += image.width;
  }
  return { image: { width, height, rgb }, tris, held };
}

/** The pieces of a list of triangles that do not touch one another (they share no point), largest first. */
function loosePieces(tris) {
  const key = (p) => p.map((v) => v.toFixed(4)).join();
  const leader = new Map();
  const root = (k) => {
    let at = k;
    while (leader.get(at) !== at) at = leader.get(at);
    leader.set(k, at);
    return at;
  };
  for (const tri of tris) for (const corner of tri) leader.set(key(corner.p), key(corner.p));
  for (const tri of tris) for (const j of [1, 2]) leader.set(root(key(tri[j].p)), root(key(tri[0].p)));
  const groups = new Map();
  for (const tri of tris) {
    const k = root(key(tri[0].p));
    (groups.get(k) ?? groups.set(k, []).get(k)).push(tri);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

/**
 * An imported scene as a piece for `addItem` and `addFitted` ({ tris, image, haft }, as a kit makes one): the
 * whole of it as one mesh on one picture, turned to the axes a piece is drawn in. Returns the piece with
 * `assumed`, sentences on what was found and what was taken for granted, to be printed: a bought weapon lies
 * along whatever axis its maker liked.
 *   pictures  see `importPictures` ("*": one picture for every material). Several materials' pictures are
 *             laid side by side on one sheet, since a piece wears one
 *   as        how it is held:
 *               "haft"    a handle with a head (a mace, a hammer, an axe): +x along the handle from the
 *                         butt, the handle's own line on y = z = 0 (`haft: true`: it is laid on the handle
 *                         of the game's weapon)
 *               "plain"   anything else that is laid by its outline (a sword, a bow): +x its length
 *               "shield"  +x along its length, +y across, +z out of its face, z = 0 its back
 *               "auto"    (unless told) "haft" when one end is clearly slimmer than the other, else "plain"
 *   axis      the file's axis the piece's length lies along, as the scene stands after reading (+z up, +x
 *             forward): "x", "y" or "z", with "-" before it for one whose head is towards the low end.
 *             Unless told: the longest side of its box (a shield: the thinnest is its face, the longest of
 *             the other two its length)
 *   grip      "low" or "high": the end of that axis the hand holds. Unless told, the slimmer end
 *   flip      true: the other end from the one found (a haft: head and butt changed over; a shield: its face
 *             and its back)
 *   triangles at most this many: the shape brought down by `fewerTriangles` first (said in `assumed`)
 * The size is not looked at: `addFitted` makes a piece as long as the thing it is laid on.
 */
export function importPiece(scene, { pictures = {}, as = "auto", axis = "auto", grip = "auto", flip = false, triangles } = {}) { // prettier-ignore
  if (!HOLDS.includes(as)) throw new Error(`importPiece: as is ${HOLDS.join(", ")}, not ${as}`);
  if (!["auto", "low", "high"].includes(grip)) throw new Error(`importPiece: grip is low or high, not ${grip}`);
  const assumed = [];
  const { imported, said: fewer } =
    triangles === undefined ? { imported: scene, said: null } : fewerTriangles(scene, triangles);
  if (fewer) assumed.push(fewer);

  // one mesh on one picture
  const byMaterial = new Map();
  for (const group of imported.groups) {
    const solid = group.tris.filter(
      (tri) => Math.hypot(...cross(sub(tri[1].p, tri[0].p), sub(tri[2].p, tri[0].p))) > NO_AREA,
    );
    (byMaterial.get(group.material) ?? byMaterial.set(group.material, []).get(group.material)).push(...solid);
  }
  for (const [name, list] of byMaterial) if (!list.length) byMaterial.delete(name);
  if (!byMaterial.size) throw new Error("importPiece: the file has no mesh: nothing to make a piece of");
  const lists = [...byMaterial].map(([name, tris]) => {
    const material = imported.materials.find((entry) => entry.name === name);
    const inside = material?.image === undefined ? null : imported.images?.[material.image];
    const given = Object.hasOwn(pictures, name) ? pictures[name] : (inside?.bytes ?? pictures["*"]);
    if (given === undefined || given === null)
      assumed.push(
        `${name ? `the material ${name}` : "the faces without a material"} has no picture: it is ${material?.colour ? "its flat colour" : "a flat grey"}`,
      );
    return { name, tris, image: withinSide(imageOf(given, material?.colour), PIECE_PICTURE_MOST) };
  });
  const laid = onOnePicture(lists);
  if (lists.length > 1)
    assumed.push(
      `${lists.length} materials (${lists.map((list) => list.name || "none").join(", ")}): their pictures are laid side by side on one of ${laid.image.width}x${laid.image.height}`,
    );
  if (laid.held)
    assumed.push(
      `${laid.held} corners have texture coordinates that run over the picture's edge after being moved by whole pictures: they are held at the edge`,
    );

  // its axes: X its length, Z its thickness (a shield's face), Y across
  const points = laid.tris.flat().map((corner) => corner.p);
  const bounds = box(points);
  const size = sub(bounds.mx, bounds.mn);
  const bySize = [0, 1, 2].sort((a, b) => size[b] - size[a]);
  const shield = as === "shield";
  let long;
  let sign = 1;
  if (axis === "auto") {
    long = shield ? bySize.filter((a) => a !== bySize[2])[0] : bySize[0];
    assumed.push(
      `its length is taken along the file's ${"xyz"[long]} (the longest side of its box, ${size.map((v) => +v.toPrecision(4)).join(" x ")})${shield ? `, its face across ${"xyz"[bySize[2]]}, the thinnest` : ""}: --axis says otherwise`,
    );
  } else {
    [long, sign] = axisNamed(axis, "importPiece: axis");
  }
  const others = [0, 1, 2].filter((a) => a !== long).sort((a, b) => size[b] - size[a]);
  const [wide, thin] = others;
  const unitOf = (a, s = 1) => [0, 1, 2].map((k) => (k === a ? s : 0));
  const X = unitOf(long, sign);
  // Y the wider of the two across, Z at right angles the way that makes it a turn and not a mirror
  const Y = unitOf(wide);
  const Z = cross(X, Y);
  const along = (p, direction) => p[0] * direction[0] + p[1] * direction[1] + p[2] * direction[2];
  let placed = laid.tris.map((tri) =>
    tri.map((corner) => ({ ...corner, p: [along(corner.p, X), along(corner.p, Y), along(corner.p, Z)] })),
  );
  /** half a turn about one of the piece's own axes: its two other coordinates change sign */
  const halfTurn = (about) => {
    placed = placed.map((tri) =>
      tri.map((corner) => ({ ...corner, p: corner.p.map((value, a) => (a === about ? value : -value)) })),
    );
  };
  const boxNow = () => box(placed.flat().map((corner) => corner.p));

  let haft = false;
  let origin;
  if (shield) {
    // the face: away from the straps and the handle, which are the loose pieces that stand off the body's
    // back (a rim or a boss lies about the body's own thickness, and says nothing)
    const [body, ...others] = loosePieces(placed);
    const bodyBox = box(body.flat().map((corner) => corner.p));
    const rest = others.filter((piece) => {
      const b = box(piece.flat().map((corner) => corner.p));
      const z = (b.mn[2] + b.mx[2]) / 2;
      return z < bodyBox.mn[2] || z > bodyBox.mx[2];
    });
    const middleOf = (tris) => {
      const b = box(tris.flat().map((corner) => corner.p));
      return [0, 1, 2].map((a) => (b.mn[a] + b.mx[a]) / 2);
    };
    const bodyZ = middleOf(body)[2];
    // the piece's z in the file's own axis: with it or against it
    const zInFile = Z[thin] > 0 ? 1 : -1;
    const towards = (side) => `${side * zInFile > 0 ? "+" : "-"}${"xyz"[thin]}`;
    let turnOver = false;
    if (rest.length) {
      const strapsZ = middleOf(rest.flat())[2];
      turnOver = strapsZ > bodyZ;
      assumed.push(
        `its face is taken to be the side away from its ${rest.length} loose pieces (straps, a handle), which lie towards ${towards(turnOver ? 1 : -1)} of the file${flip ? "; flipped" : ""}: --flip turns it over`,
      );
    } else
      assumed.push(
        `it is one piece, with no straps to tell its back by: its face is taken towards ${towards(flip ? -1 : 1)} of the file${flip ? " (flipped)" : ""}: --flip turns it over. Look at the pictures`,
      );
    if (turnOver !== Boolean(flip)) halfTurn(0);
    // the point: the end where the body is narrower
    const b = boxNow();
    const reach = Math.max(Math.abs(b.mn[0]), Math.abs(b.mx[0]));
    const middleX = (b.mn[0] + b.mx[0]) / 2;
    const widthAt = (side) => {
      const ys = placed
        .flat()
        .filter((corner) => (corner.p[0] - middleX) * side > (reach - Math.abs(middleX)) * 0.8)
        .map((corner) => corner.p[1]);
      return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
    };
    if (axis === "auto" && widthAt(-1) < widthAt(1) * 0.9) {
      halfTurn(2);
      assumed.push("its narrower end is taken for its point, and laid towards +x");
    }
    const after = boxNow();
    origin = [(after.mn[0] + after.mx[0]) / 2, (after.mn[1] + after.mx[1]) / 2, after.mn[2]];
  } else {
    // the two ends: how wide the piece is in the first and the last third of its length
    const b = boxNow();
    const length = b.mx[0] - b.mn[0];
    const endOf = (from, to) => {
      const inEnd = placed.flat().filter((corner) => corner.p[0] >= from && corner.p[0] <= to);
      if (!inEnd.length) return { girth: 0, middle: [0, 0] };
      const e = box(inEnd.map((corner) => corner.p));
      return {
        girth: Math.hypot(e.mx[1] - e.mn[1], e.mx[2] - e.mn[2]),
        middle: [(e.mn[1] + e.mx[1]) / 2, (e.mn[2] + e.mx[2]) / 2],
      };
    };
    const low = endOf(b.mn[0], b.mn[0] + length * END_SHARE);
    const high = endOf(b.mx[0] - length * END_SHARE, b.mx[0]);
    const slimmer = low.girth <= high.girth ? "low" : "high";
    const ratio = Math.max(low.girth, high.girth) / (Math.min(low.girth, high.girth) || 1e-9);
    haft = as === "haft" || (as === "auto" && ratio >= HEAD_TIMES_GRIP);
    if (as === "auto")
      assumed.push(
        haft
          ? `it is taken for a hafted weapon: one end is ${ratio.toFixed(1)} times as wide as the other (--as plain says otherwise)`
          : `it is laid by its outline alone (its two ends are within ${ratio.toFixed(1)} times of each other's width: no handle with a head; --as haft says otherwise)`,
      );
    // which end the hand holds, as the piece lies now ("low": where its x is least): told by `grip` (an end
    // of the file's axis), or by an axis written with its sign (the piece runs that way from the butt), or
    // the slimmer end
    const signed = /^[+-]/.test(String(axis).trim());
    let gripEnd = slimmer;
    if (grip !== "auto") gripEnd = (grip === "low") === sign > 0 ? "low" : "high";
    else if (signed) gripEnd = "low";
    if (flip) gripEnd = gripEnd === "low" ? "high" : "low";
    if (grip === "auto" && !signed && haft)
      assumed.push(
        `its grip is taken at the ${gripEnd === slimmer ? "slimmer" : "wider"} end${flip ? " (flipped)" : ""}, towards ${(gripEnd === "low") === sign > 0 ? "-" : "+"}${"xyz"[long]} of the file: --grip low|high or --flip says otherwise`,
      );
    // the butt at the low end of x: half a turn about z when the grip is at the high end
    if (gripEnd === "high") halfTurn(2);
    const after = boxNow();
    if (haft) {
      // the handle's own line: the middle of the piece across, in the third the hand holds
      const held = (() => {
        const inEnd = placed.flat().filter((corner) => corner.p[0] <= after.mn[0] + length * END_SHARE);
        const e = box(inEnd.map((corner) => corner.p));
        return [(e.mn[1] + e.mx[1]) / 2, (e.mn[2] + e.mx[2]) / 2];
      })();
      origin = [after.mn[0], held[0], held[1]];
    } else origin = [after.mn[0], (after.mn[1] + after.mx[1]) / 2, (after.mn[2] + after.mx[2]) / 2];
  }
  const tris = placed.map((tri) =>
    tri.map((corner) => {
      const { n: _n, node: _node, weights: _weights, ...kept } = corner;
      return { ...kept, p: sub(corner.p, origin) };
    }),
  );
  const made = measured([{ tris }]);
  return {
    tris,
    image: laid.image,
    ...(haft ? { haft: true } : {}),
    as: shield ? "shield" : haft ? "haft" : "plain",
    box: made.box,
    assumed,
  };
}

/**
 * The picture an imported piece wears in each file of an item's family, as `addItem`'s `texture` takes it (a
 * function of a placement). A placement's `shrink` is said of a kit's sheet, 1024 pixels wide: a bought
 * picture, which is far smaller, is made no larger than 1024 / shrink a side (and than the 512 GoldSrc draws) and is otherwise left as it is,
 * where the kit's rule (always `shrink` times smaller) would leave a 256 pixel picture 64 wide in the world.
 */
export function pieceTexture(piece, name) {
  const made = new Map();
  return (placement) => {
    // and never larger than GoldSrc draws a picture
    const most = Math.min(LIMITS.goldsrc.texture, Math.max(1, Math.floor(PIECE_PICTURE_MOST / (placement.shrink ?? 1))));
    const factor = Math.max(1, Math.ceil(Math.max(piece.image.width, piece.image.height) / most));
    if (!made.has(factor)) made.set(factor, indexed(factor > 1 ? shrink(piece.image, factor) : piece.image, name));
    return made.get(factor);
  };
}

// ── what is in it ──────────────────────────────────────────────────────────
/** How many of a list's names a line of the summary gives before "and n more". */
const NAMES_LISTED = 8;
const listed = (names) =>
  names.length > NAMES_LISTED
    ? `${names.slice(0, NAMES_LISTED).join(", ")} and ${names.length - NAMES_LISTED} more`
    : names.join(", ");

/**
 * What an imported scene holds: { lines, totals }. `lines` are sentences to print (its format, axes and
 * units, each mesh with its triangles and materials, each material's picture, its bones and animations, its
 * box in the file's units and in the game's at its true size); `totals` is { meshes, triangles, points,
 * materials, images, nodes, joints, animations, box, uv }.
 */
export function importSummary(imported) {
  const { box: bounds, uv, triangles } = measured(imported.groups);
  const fixed = (v) => +v.toPrecision(5);
  const size = sub(bounds.mx, bounds.mn);
  const metres = imported.unit?.metres ?? 1;
  const lines = [];
  lines.push(
    `${imported.format}${imported.version ? ` ${imported.version}` : ""}${imported.binary === false ? " (text)" : ""}${imported.generator ? `, written by ${imported.generator}` : ""}`,
  );
  lines.push(
    `axes: up ${imported.axes.up}, front ${imported.axes.front} (${imported.axes.said}); read as GoldSrc's: +z up, +x forward`,
  );
  lines.push(`units: one is ${fixed(metres)} m (${imported.unit.said})`);
  if (triangles) {
    lines.push(
      `box (x y z, the file's units): ${bounds.mn.map(fixed).join(" ")} to ${bounds.mx.map(fixed).join(" ")}: ${size.map(fixed).join(" x ")}`,
    );
    lines.push(
      `     at its true size: ${size.map((v) => +(v * metres).toFixed(3)).join(" x ")} m, ${size.map((v) => +(v * metres * UNITS_A_METRE).toFixed(1)).join(" x ")} units of the game`,
    );
  }
  lines.push(`${imported.meshes.length} meshes, ${triangles} triangles:`);
  for (const mesh of imported.meshes)
    lines.push(
      `  ${mesh.name || "(unnamed)"}: ${mesh.triangles} triangles on ${mesh.points} points${mesh.skinned ? ", skinned" : ""}${mesh.uvSets ? "" : ", no texture coordinates"}; ${mesh.materials.length ? `material ${mesh.materials.map((name) => name || "(none)").join(", ")}` : "no triangles"}`,
    );
  const used = new Set(imported.groups.map((group) => group.material));
  lines.push(`${imported.materials.length} materials${used.size < imported.materials.length ? ` (${used.size} worn)` : ""}:`);
  for (const material of imported.materials) {
    const inside = material.image === undefined ? null : imported.images[material.image];
    const picture = inside
      ? `a picture inside the file (${inside.name || "unnamed"}, ${inside.mime || "of a kind not said"}, ${inside.bytes.length} bytes)`
      : material.picture
        ? `names the picture ${material.picture}`
        : "names no picture";
    lines.push(
      `  ${material.name}${used.has(material.name) ? "" : " (not worn)"}: ${picture}${material.colour ? `; colour ${material.colour.map((v) => +v.toFixed(3)).join(" ")}` : ""}`,
    );
  }
  if (uv)
    lines.push(
      `texture coordinates: u ${fixed(uv.mn[0])} to ${fixed(uv.mx[0])}, v ${fixed(uv.mn[1])} to ${fixed(uv.mx[1])} (from the picture's top left)${uv.mn[0] < -1e-3 || uv.mn[1] < -1e-3 || uv.mx[0] > 1.001 || uv.mx[1] > 1.001 ? ": past one copy of the picture" : ""}`,
    );
  const joints = imported.joints ?? [];
  lines.push(
    `${imported.nodes.length} nodes${joints.length ? `, ${joints.length} of them a skin's bones: ${listed(joints.map((joint) => imported.nodes[joint].name))}` : ", no skin"}`,
  );
  lines.push(
    imported.animations.length
      ? `${imported.animations.length} animations: ${listed(imported.animations.map((animation) => `${animation.name} (${animation.duration.toFixed(2)} s, ${animation.nodes.length} nodes)`))}`
      : "no animations",
  );
  for (const warning of imported.warnings) lines.push(`WARN  ${warning}`);
  return {
    lines,
    totals: {
      meshes: imported.meshes.length,
      triangles,
      points: imported.meshes.reduce((sum, mesh) => sum + mesh.points, 0),
      materials: imported.materials.length,
      images: imported.images.length,
      nodes: imported.nodes.length,
      joints: joints.length,
      animations: imported.animations.length,
      box: bounds,
      uv,
    },
  };
}
