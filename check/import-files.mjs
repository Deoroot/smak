// The files of an import, read from the disk: the model itself (.fbx, .glb, .gltf with its .bin, .obj with its
// .mtl), the pictures of its materials found beside it, and a whole folder of models made into props with a
// table and a contact sheet. What is made of them is import-model.mjs's; the command line is `smak import`.
//
//   readModelFile(file, options)          the file read into the common shape (import-shape.mjs)
//   picturesOf(file, imported, options)   each worn material's picture, looked for beside the file
//   importFolder(folder, out, options)    every model under a folder as a prop, with a sheet of them all
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename, extname, resolve, relative, sep } from "node:path";
import { readFbx } from "../core/fbx.mjs";
import { readGlb } from "../core/glb.mjs";
import { readObj, readMtl } from "./obj.mjs";
import { importedObj } from "../core/import-shape.mjs";
import { importModel, importSummary, pictureBeside } from "./import-model.mjs";
import { check } from "./check.mjs";
import { png } from "../core/image.mjs";
import { render, tile } from "../make/render.mjs";

/** The endings of the files that are read as models. */
export const MODEL_FILE = /\.(fbx|glb|gltf|obj)$/i;
/** The folders beside a model that tools keep its pictures in. */
const PICTURE_FOLDERS = ["", "textures", "Textures", "texture", "Texture", "tex", "maps", "images", "materials"];
/** How many folders up a picture the material names is looked for. */
const FOLDERS_UP = 4;
/** A picture file that is read. */
const READ_PICTURE = /\.(png|bmp|jpe?g)$/i;

/** The files of a folder (not its folders), or none when it is not there. */
function filesIn(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter((name) => {
    try {
      return statSync(join(folder, name)).isFile();
    } catch {
      return false;
    }
  });
}

/** A file a model names, when it lies under the model's own folder: a name that leads out of it is not followed. */
function besideModel(folder, named) {
  const path = resolve(folder, String(named).replaceAll("\\", "/"));
  const inside = relative(resolve(folder), path);
  if (inside.startsWith("..") || resolve(inside) === inside) return null;
  return existsSync(path) && statSync(path).isFile() ? path : null;
}

/**
 * A model file read into the common shape, by its ending: .fbx (`readFbx`), .glb and .gltf (`readGlb`; the
 * .bin and pictures a .gltf names are read from its own folder), .obj (`readObj` with the .mtl files it
 * names, stood up by `importedObj`). `up`, `metres`: for an .obj, which says neither ("y" and 1 unless told).
 * `axes`: { up, front } as `readFbx` takes them, for a file that says its own wrong.
 */
export function readModelFile(file, { up, metres, axes } = {}) {
  const folder = dirname(file);
  const ending = extname(file).toLowerCase();
  if (ending === ".fbx") return readFbx(readFileSync(file), axes ?? {});
  if (ending === ".glb" || ending === ".gltf")
    return readGlb(readFileSync(file), {
      resources: (name) => {
        const path = besideModel(folder, name);
        return path ? readFileSync(path) : null;
      },
    });
  if (ending === ".obj") {
    const text = readFileSync(file, "utf8");
    const materials = [];
    const warnings = [];
    for (const library of readObj(text).libraries) {
      const path = besideModel(folder, library) ?? besideModel(folder, basename(library.replaceAll("\\", "/")));
      if (path) materials.push(...readMtl(readFileSync(path, "utf8")));
      else warnings.push(`${library}, which the file names for its materials, is not beside it`);
    }
    const imported = importedObj(readObj(text, { mtl: materials }), { up: up ?? "y", metres: metres ?? 1 });
    imported.warnings.push(...warnings);
    return imported;
  }
  throw new Error(`${basename(file)}: an .fbx, .glb, .gltf or .obj file is what is read`);
}

/**
 * Each worn material's picture, looked for on the disk: { pictures, lines, missing }.
 *   pictures   { material's name: the bytes of its PNG or BMP }, for `importModel` and `importPiece`
 *   lines      a sentence a material: where its picture came from, or why it has none
 *   missing    how many worn materials have no picture that can be read
 * `texture`: a picture file for every material, whatever the file says. Without it: a picture inside the file
 * is left to `importPictures`; else the picture is looked for beside the model (`pictureBeside`), in its
 * folder and in the folders tools keep pictures in (textures, maps, ...), and as the material writes its
 * path; a picture the material names is also looked for in such folders up to four folders above (a pack
 * that keeps every picture in one Textures folder of its own).
 */
export function picturesOf(file, imported, { texture } = {}) {
  const folder = dirname(file);
  const pictures = {};
  const lines = [];
  let missing = 0;
  const worn = [...new Set(imported.groups.map((group) => group.material))];
  const called = (name) => (name ? `material ${name}` : "the faces without a material");
  if (texture) {
    const bytes = readFileSync(texture);
    for (const name of worn) pictures[name] = bytes;
    lines.push(`every material: ${texture} (given)`);
    return { pictures, lines, missing };
  }
  for (const name of worn) {
    const material = imported.materials.find((entry) => entry.name === name) ?? { name, picture: null };
    const inside = material.image === undefined ? null : imported.images[material.image];
    if (inside) {
      lines.push(`${called(name)}: the picture inside the file (${inside.name || "unnamed"}, ${inside.mime || "of a kind not said"})`);
      continue;
    }
    let found = null;
    const asWritten = material.picture ? besideModel(folder, material.picture) : null;
    if (asWritten && READ_PICTURE.test(asWritten)) found = { path: asWritten, why: `the picture the material names (${material.picture})` };
    for (const sub of found ? [] : PICTURE_FOLDERS) {
      const choice = pictureBeside(material, filesIn(join(folder, sub)));
      if (!choice) continue;
      found = { path: join(folder, sub, choice.file), why: choice.why };
      break;
    }
    // a pack that keeps every picture in one folder of its own, some folders up: the picture the material
    // names, by its name alone
    for (let up = 1, above = dirname(folder); !found && material.picture && up <= FOLDERS_UP; up++, above = dirname(above))
      for (const sub of PICTURE_FOLDERS) {
        const named = pictureBeside({ name: "", picture: material.picture }, filesIn(join(above, sub)));
        if (named?.why.startsWith("the picture the material names")) {
          found = { path: join(above, sub, named.file), why: `the picture the material names, ${up} folders up` };
          break;
        }
      }
    if (found && READ_PICTURE.test(found.path)) {
      pictures[name] = readFileSync(found.path);
      lines.push(`${called(name)}: ${relative(folder, found.path).split(sep).join("/")}, ${found.why}`);
    } else {
      missing++;
      lines.push(
        found
          ? `${called(name)}: ${basename(found.path)} (${found.why}) is not a PNG, a BMP or a JPEG, the pictures that are read: it wears its flat colour`
          : `${called(name)}: no picture found${material.picture ? ` (it names ${material.picture})` : ""}: it wears its flat colour. --texture <file> gives one`,
      );
    }
  }
  return { pictures, lines, missing };
}

// ── a folder of models ─────────────────────────────────────────────────────
/** Every model file under a folder, folders within folders, in the order of their names. */
function modelsUnder(folder, found = []) {
  for (const name of readdirSync(folder).sort()) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) modelsUnder(path, found);
    else if (MODEL_FILE.test(name)) found.push(path);
  }
  return found;
}
/** How many models one contact sheet holds, how many a row, and a tile's side in pixels. */
const SHEET_MOST = 48;
const SHEET_COLUMNS = 8;
const TILE_SIDE = 224;
/** How much of a model's name fits over its tile. */
const LABEL_MOST = 17;

/**
 * Every model under a folder made into a prop: the .mdl files under `out` by the same paths, with a contact
 * sheet of them all and what was found of each. Returns { rows, sheets, failed }.
 *   rows     [{ file (from the folder), mdl (from `out`), meshes, triangles, points, materials, pictures
 *            (how many materials wear one of their own), missing, size [x, y, z] in units, bodyparts,
 *            warnings, heavy, error }]: `error` is why a file gave no model
 *   sheets   the pictures written: sheet.png, sheet-2.png ... (48 models each, drawn from three quarters
 *            with their textures)
 * Options: those of `importModel` (scale, fit, origin, turn, maxTextureSize), `only` (endings to read:
 * ["fbx"]; every kind unless told), `texture` (one picture for all), `size` (a tile's side), `said(line)`
 * (called with a line of progress for each file). A model that would not load in the engine, and a file that
 * cannot be read, is a row with `error` and no file.
 */
export function importFolder(folder, out, options = {}) {
  const { only = null, said = () => {}, size = TILE_SIDE, texture, ...making } = options;
  const files = modelsUnder(folder).filter(
    (file) => !only || only.includes(extname(file).slice(1).toLowerCase()),
  );
  // two files of one name in one folder (mace.fbx, mace.glb) are told apart by their endings
  const stems = new Map();
  for (const file of files) {
    const stem = file.slice(0, -extname(file).length).toLowerCase();
    stems.set(stem, (stems.get(stem) ?? 0) + 1);
  }
  const rows = [];
  const tiles = [];
  for (const file of files) {
    const from = relative(folder, file).split(sep).join("/");
    const ending = extname(file);
    const bare = from.slice(0, -ending.length);
    const twice = stems.get(file.slice(0, -ending.length).toLowerCase()) > 1;
    const to = `${bare}${twice ? `_${ending.slice(1).toLowerCase()}` : ""}.mdl`;
    const row = { file: from, mdl: to };
    try {
      const imported = readModelFile(file, options);
      const { totals } = importSummary(imported);
      const found = picturesOf(file, imported, { texture });
      const made = importModel(imported, { ...making, name: basename(to), pictures: found.pictures });
      const errors = ["goldsrc", "xash"].flatMap((engine) => check(made.mdl, engine).errors);
      if (errors.length) throw new Error(errors.join("; "));
      const path = join(out, to);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, made.mdl);
      const { mn, mx } = made.report.box;
      Object.assign(row, {
        meshes: totals.meshes,
        triangles: made.report.triangles,
        points: made.report.points,
        materials: found.lines.length,
        pictures: found.lines.length - found.missing,
        missing: found.missing,
        size: mx.map((v, a) => +(v - mn[a]).toFixed(1)),
        bodyparts: made.report.bodyparts,
        bones: totals.joints,
        animations: totals.animations,
        heavy: made.report.heavy,
        warnings: [...imported.warnings, ...made.warnings],
      });
      tiles.push({
        name: basename(bare).slice(0, LABEL_MOST),
        picture: render(made.mdl, { yaw: 35, pitch: 20, width: size, height: size }),
      });
    } catch (error) {
      row.error = error.message;
    }
    rows.push(row);
    said(row);
  }
  const sheets = [];
  for (let from = 0; from < tiles.length; from += SHEET_MOST) {
    const some = tiles.slice(from, from + SHEET_MOST);
    const picture = tile(
      some.map((each) => each.picture),
      Math.min(SHEET_COLUMNS, some.length),
      some.map((each) => each.name),
    );
    const path = join(out, from ? `sheet-${from / SHEET_MOST + 1}.png` : "sheet.png");
    mkdirSync(out, { recursive: true });
    writeFileSync(path, png(picture.width, picture.height, picture.rgba));
    sheets.push(path);
  }
  return { rows, sheets, failed: rows.filter((row) => row.error).length };
}
