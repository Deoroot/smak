// A glTF of a scanned prop (Poly Haven's, at 1k) made a GoldSrc prop by the kit's own import door: brought down
// to a triangle budget, its base colour made 8-bit textures of GoldSrc's size, sized in units, standing on z = 0
// on the middle of its foot; then checked, measured for form and drawn beside the source (README.md).
//
//   propBudget(longest)                 the triangles a prop of that size is given unless told
//   makeProp(file, options)             { mdl, report, source, lines, warnings, errors }
//   propSheet(made, options)            the source and the prop side by side from the same cameras
//   creditText(id, info, { date })      what <name>.credit.txt says
import { readFileSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { readModelFile, picturesOf, importModel, check, formOfMdl, judgeForm, kindOfName, render, tile, framing, png, unpng, unjpeg } from "../../src/index.mjs"; // prettier-ignore
import { UNITS_A_METRE } from "../../core/import-shape.mjs";
import { FRONT } from "../../make/mesh.mjs";

/**
 * Half-Life's own props and items (valve/models, the form corpus of check/form.mjs) carry 14 to 720 triangles,
 * about 100 at the median, 3 a unit of their longest side. A scan brought that low is a lump: drawn at budgets
 * (README.md, "The budget"), a scanned extinguisher 26 units high is a wedge at 500, warped at 800 and itself at
 * 1200; two dustbins 72 long are themselves at 1500. So a prop is given 40 a unit of its longest side, at least
 * 1000 and at most 2000, under the 2500 that `importModel` calls heavy.
 */
const BUDGET = { perUnit: 40, least: 1000, most: 2000 };
export function propBudget(longest) {
  return Math.round(Math.min(BUDGET.most, Math.max(BUDGET.least, longest * BUDGET.perUnit)));
}
/** A prop's foot is on z = 0 and its middle on the axis within this many units. */
const STANDS_WITHIN = 0.5;
/** The file's height is the one Poly Haven gives within this share, or the prop may lie on its side. */
const HEIGHT_AGREES = 0.1;
/** Two meshes whose boxes are this far apart (metres) are two objects laid side by side. */
const APART = 0.02;

const ofPicture = (bytes) => (bytes[0] === 0xff && bytes[1] === 0xd8 ? unjpeg(bytes) : unpng(bytes));
/** An image as RGBA, alpha 255 where it has none. */
function rgbaOf(image) {
  if (image.rgba) return image;
  const rgba = new Uint8Array(image.width * image.height * 4);
  for (let i = 0; i < image.width * image.height; i++)
    rgba.set([...image.rgb.subarray(i * 3, i * 3 + 3), 255], i * 4);
  return { width: image.width, height: image.height, rgba };
}
/** A base colour with its opacity map (Poly Haven's `<map>_opacity`, grey) put in as alpha: a PNG's bytes. */
function withOpacity(colour, opacity) {
  const image = rgbaOf(ofPicture(colour));
  const alpha = rgbaOf(ofPicture(opacity));
  if (alpha.width !== image.width || alpha.height !== image.height) return null;
  for (let i = 0; i < image.width * image.height; i++) image.rgba[i * 4 + 3] = alpha.rgba[i * 4];
  return png(image.width, image.height, image.rgba);
}

/** The groups of meshes that stand apart from one another (their boxes more than APART away): one object each. */
function objectsOf(imported) {
  const boxes = new Map();
  for (const group of imported.groups)
    for (const tri of group.tris)
      for (const { p, node } of tri) {
        const b = boxes.get(node) ?? boxes.set(node, { mn: [...p], mx: [...p], node }).get(node);
        for (let a = 0; a < 3; a++) [b.mn[a], b.mx[a]] = [Math.min(b.mn[a], p[a]), Math.max(b.mx[a], p[a])];
      }
  const touch = (a, b) => [0, 1, 2].every((k) => a.mn[k] - APART <= b.mx[k] && b.mn[k] - APART <= a.mx[k]);
  const sets = [...boxes.values()].map((b) => [b]);
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < sets.length && !merged; i++)
      for (let j = i + 1; j < sets.length && !merged; j++)
        if (sets[i].some((a) => sets[j].some((b) => touch(a, b)))) {
          sets[i].push(...sets.splice(j, 1)[0]);
          merged = true;
        }
  }
  return sets.map((set) => set.map((b) => imported.nodes[b.node]?.name ?? `node ${b.node}`));
}

/**
 * A prop from a glTF file: { mdl, report, source, lines, warnings, errors }.
 *   name         the .mdl's name
 *   height       its height in units, or `scale`: times its true size (39.37 units a metre); its true size unless told
 *   triangles    at most this many (propBudget of its longest side unless told)
 *   texture      the longest side of a texture, 256 or 512 (512)
 *   real         Poly Haven's size of it, metres [x, y, z] with z up, held against the file's (upright, not on a side)
 * `source`: the file's own triangles at the prop's size and place, each with its picture, for propSheet.
 * `errors` are what makes it FAIL: check's errors for goldsrc, a foot not on z = 0, a height that is not the one
 * Poly Haven gives. `warnings`: check's (form among them), the reducer stopping short, objects side by side,
 * a see-through material drawn solid.
 */
export function makeProp(file, { name, height, scale, triangles, texture = 512, real } = {}) {
  const read = readModelFile(file);
  const { pictures, lines } = picturesOf(file, read);
  const warnings = [];
  const errors = [];
  // a base colour whose opacity map lies beside it wears it as alpha: a texture with holes
  const holed = new Set();
  for (const material of read.materials) {
    const colour = /diff_1k\.(jpe?g|png)$/i.test(material.picture ?? "") && pictures[material.name];
    const beside =
      colour &&
      ["png", "jpg"].map((kind) =>
        join(dirname(file), material.picture.replace(/diff_1k\.\w+$/i, `opacity_1k.${kind}`)),
      );
    const opacityFile = beside && beside.find((path) => existsSync(path));
    const made = opacityFile && withOpacity(colour, readFileSync(opacityFile));
    if (!made) continue;
    pictures[material.name] = made;
    holed.add(material.name);
    lines.push(`material ${material.name}: its opacity map ${basename(opacityFile)} as alpha`);
  }
  const box = read.box;
  const size = [0, 1, 2].map((a) => box.mx[a] - box.mn[a]);
  const metres = read.unit?.metres ?? 1;
  const times = height !== undefined ? height / (size[2] * metres * UNITS_A_METRE) : (scale ?? 1);
  const longest = Math.max(...size) * metres * UNITS_A_METRE * times;
  const target = triangles ?? propBudget(longest);
  const made = importModel(read, {
    name,
    pictures,
    scale: times,
    origin: "base",
    triangles: target,
    maxTextureSize: texture,
  });
  const kind = kindOfName(name);
  const checked = check(made.mdl, "goldsrc", { name, kind });
  const form = formOfMdl(made.mdl);
  const judged = judgeForm(form.measures, kind);
  const { mn, mx } = made.report.box;
  const source = sourceTriangles(read, pictures, metres * UNITS_A_METRE * times);
  const sourceTris = read.groups.reduce((sum, g) => sum + g.tris.length, 0);

  errors.push(...checked.errors);
  warnings.push(
    ...checked.warnings,
    ...made.warnings.filter((w) => !/larger than \d+: made|shared out over/.test(w)),
  );
  if (
    Math.abs(mn[2]) > STANDS_WITHIN ||
    Math.abs(mn[0] + mx[0]) / 2 > STANDS_WITHIN ||
    Math.abs(mn[1] + mx[1]) / 2 > STANDS_WITHIN
  )
    errors.push(
      `its foot is not on z = 0 at the middle: its box is ${mn.map((v) => v.toFixed(1)).join(" ")} to ${mx.map((v) => v.toFixed(1)).join(" ")}`,
    );
  if (real) {
    const fileHigh = size[2] * metres;
    if (Math.abs(fileHigh - real[2]) > real[2] * HEIGHT_AGREES)
      errors.push(
        `the file stands ${fileHigh.toFixed(3)} m high where Poly Haven says ${real[2].toFixed(3)} m: it may lie on its side`,
      );
  }
  if (made.report.triangles > target * 1.25) warnings.push(`the reducer stopped short: ${made.report.fewer}`);
  if (made.report.bodyparts > 1) errors.push(`not one prop GoldSrc draws at its ease: ${made.report.heavy}`);
  else if (made.report.heavy) warnings.push(`heavy: ${made.report.heavy}`);
  const objects = objectsOf(read);
  if (objects.length > 1)
    warnings.push(
      `the file holds ${objects.length} objects side by side, all of them in the prop: ${objects.map((set) => (set.length > 2 ? `${set[0]} and ${set.length - 1} more` : set.join(" + "))).join("; ")}`,
    );
  const said = /\.gltf$/i.test(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  for (const material of said.materials ?? [])
    if (material.alphaMode === "BLEND")
      warnings.push(
        `the material ${material.name} is see-through (BLEND), which a studio model is not: ${holed.has(material.name) ? "it has holes where its opacity map is under half and is solid elsewhere" : "it is drawn solid"}`,
      );
  return {
    mdl: made.mdl,
    lines,
    warnings,
    errors,
    source,
    report: {
      sourceTriangles: sourceTris,
      sourceTextures: Object.values(pictures)
        .map((bytes) => ofPicture(bytes))
        .map((i) => `${i.width}x${i.height}`),
      target,
      triangles: made.report.triangles,
      points: made.report.points,
      bodyparts: made.report.bodyparts,
      textures: made.report.textures.map((t) => `${t.width}x${t.height}`),
      bytes: made.mdl.length,
      box: { mn, mx },
      size: mx.map((v, a) => v - mn[a]),
      times,
      fewer: made.report.fewer,
      form: {
        counts: form.counts,
        measures: form.measures,
        rows: judged.rows,
        warnings: judged.warnings,
        kind,
      },
      facts: checked.facts,
      check: { errors: checked.errors, warnings: checked.warnings },
    },
  };
}

/** The file's triangles as render takes them (`tris`): at the prop's size, its foot's middle at the origin. */
function sourceTriangles(read, pictures, factor) {
  const textures = new Map();
  const texOf = (material) => {
    if (textures.has(material)) return textures.get(material);
    const bytes = pictures[material];
    const image = bytes ? rgbaOf(ofPicture(bytes)) : null;
    let holes = false;
    if (image) for (let i = 3; i < image.rgba.length && !holes; i += 4) holes = image.rgba[i] < 128;
    return textures.set(material, image && { ...image, flags: holes ? 64 : 0 }).get(material);
  };
  const { mn, mx } = read.box;
  const move = [((mn[0] + mx[0]) / 2) * factor, ((mn[1] + mx[1]) / 2) * factor, mn[2] * factor];
  const tris = [];
  for (const group of read.groups) {
    const tex = texOf(group.material);
    for (const tri of group.tris) {
      const p = tri.map((c) => c.p.map((v, a) => v * factor - move[a]));
      const e1 = p[1].map((v, a) => v - p[0][a]);
      const e2 = p[2].map((v, a) => v - p[0][a]);
      const face = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const n = face.map((v) => v / (Math.hypot(...face) || 1));
      // the kit's triangles go counter-clockwise from the front, a built model's the other way (FRONT): render draws the latter
      const c = tri.map((c, k) => ({
        p: p[k],
        n: c.n ?? n,
        u: c.uv[0] * (tex?.width ?? 1),
        v: c.uv[1] * (tex?.height ?? 1),
        bone: 0,
      }));
      tris.push({ tex, where: { bodypart: 0 }, c: FRONT < 0 ? c.reverse() : c });
    }
  }
  return tris;
}

/** The views of the sheet: [name, yaw, pitch], or [name, yaw, null, units away on the floor]; a level one has the floor's line. */
const VIEWS = [
  ["front", 0, 0],
  ["left side", 90, 0],
  ["three quarter", 35, 20],
  ["back three quarter", 215, 20],
  ["eye, 96 away", 30, null, 96],
  ["eye, 256 away", 30, null, 256],
];
/** A player's eye over the floor (Half-Life's: 28 over an origin 36 up), and the fov of a tile: the middle quarter
 * of a screen 1280 wide at the game's 90, so that a prop is as many pixels as the player sees of it. */
const EYE = 64;
const TILE_FOV = (2 * Math.atan(Math.tan(Math.PI / 4) / 4) * 180) / Math.PI;
/**
 * The source and the prop side by side, from the same cameras, at one scale: each view as two tiles (the
 * source, then the prop), two views a row. `size`: a tile's side in pixels. The eye's views look from a
 * player's eye at the middle of the prop from so far away on the floor, at the size the screen shows it.
 */
export function propSheet(made, { size = 320, views = VIEWS } = {}) {
  const within = framing(null, [{ tris: made.source }]);
  const middle = (made.report.box.mn[2] + made.report.box.mx[2]) / 2;
  const tiles = [];
  const names = [];
  for (const [view, yaw, pitch, away] of views) {
    const eye = away
      ? {
          yaw,
          pitch: (Math.atan2(EYE - middle, away) * 180) / Math.PI,
          dist: Math.hypot(EYE - middle, away),
          fov: TILE_FOV,
        }
      : { yaw, pitch, within, ...(pitch === 0 ? { ground: true } : {}) };
    Object.assign(eye, { view: "orbit", width: size, height: size });
    tiles.push(render(made.mdl, { ...eye, tris: made.source }), render(made.mdl, eye));
    names.push(`${view}: source ${made.report.sourceTriangles}`, `prop ${made.report.triangles}`);
  }
  return tile(tiles, 4, names);
}

/** What `<name>.credit.txt` says: the asset, its authors, its licence and where it is. */
export function creditText(id, info, { date = new Date().toISOString().slice(0, 10) } = {}) {
  const authors = Object.entries(info.authors ?? {}).map(([who, did]) => `${who} (${did})`);
  return [
    `${info.name ?? id}`,
    `Poly Haven asset: ${id}`,
    `URL: https://polyhaven.com/a/${id}`,
    `Authors: ${authors.join(", ") || "not given"}`,
    "Licence: CC0 1.0 Universal (public domain): no attribution is required; this credit is given gladly.",
    `Downloaded ${date} through the Poly Haven API (Powered by Poly Haven), files_hash ${info.files_hash ?? "not given"}.`,
    "Made a GoldSrc studio model by SMAK's assets pack: reduced, its base colour only (no normal, roughness or metal maps).",
    "",
  ].join("\n");
}
