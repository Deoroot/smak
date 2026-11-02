// New Byzantium's sky, rendered by us (PLAN.md "Form, scale and the art kit", notes-megastructure.md 7.1): a
// procedural megacity in a toxic red storm, built and rendered in Blender (levels/tools/sky-megacity.py), its
// six faces written as GoldSrc's skies are. This is the Node side: the arguments, the faces' table taken from
// the engine's own (src/maps/sky.mjs: `wayOfSide`, Xash3D FWGS's `st_to_vec` and side order), the Blender job,
// the Targa files at each size, the seam check, a cross-shaped contact sheet and a panorama.
//
//   parseSkyArgs(argv)                  the tool's options, or { error }
//   SKY_FACES                           [{ suffix, side, forward, right, up }] in SKY_SIDES' order
//   skyFileNames(name, sizes)           { [size]: ["<size>/<name>rt.tga", ...] }
//   seamCheck(sides)                    each of the cube's 12 edges: the mean step across it, against the
//                                       step to the next pixel in on the same face
//   crossSheet(sides), panorama(sides, width)   pictures { width, height, rgb } to look at
//   renderSky(options)                  the whole run: Blender, the files, the report
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SKY_SIDES, wayOfSide, writeTga, skyColour } from "../../src/maps/sky.mjs";
import { unpng, png, shrink } from "../../src/image.mjs";
import { runBlenderJob, findBlender } from "../../src/blender.mjs";

/** The Blender script that builds the city and renders a face per camera. */
export const SKY_SCRIPT = new URL("../tools/sky-megacity.py", import.meta.url);

/** The options and their defaults: sizes in pixels, lengths in metres. */
export const SKY_DEFAULTS = {
  name: "nbstorm",
  seed: 1,
  out: null,
  render: 1024,
  ship: [1024, 512, 256],
  samples: 32,
  eye: 41,
  density: 1,
  quick: false,
  keep: false,
  blender: null,
};

const sub = (a, b) => a.map((v, k) => v - b[k]);

/**
 * The six faces, in SKY_SIDES' order (rt, lf, bk, ft, up, dn): each its file suffix and three ways out of the
 * eye (GoldSrc's axes: x forward, y left, z up), taken from the engine's table: `forward` through the face's
 * middle, `right` toward its right edge (columns left to right), `up` toward its top (rows top to bottom).
 */
export const SKY_FACES = SKY_SIDES.map((suffix, side) => {
  const forward = wayOfSide(side, 0, 0);
  return { suffix, side, forward, right: sub(wayOfSide(side, 1, 0), forward), up: sub(wayOfSide(side, 0, 1), forward) };
});

const SIZE_OK = (n) => Number.isInteger(n) && n >= 16 && n <= 4096 && (n & (n - 1)) === 0;

/**
 * The tool's arguments (`process.argv.slice(2)`): { options } or { error }. `--ship` sizes must divide `--render`
 * by a power of two; `--quick` renders 256 with 8 samples and a sparser city, for looking while tuning.
 */
export function parseSkyArgs(argv) {
  const o = { ...SKY_DEFAULTS, ship: [...SKY_DEFAULTS.ship] };
  const numbers = { seed: "seed", render: "render", samples: "samples", eye: "eye", density: "density" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--quick") o.quick = true;
    else if (a === "--keep") o.keep = true;
    else if (a === "--help" || a === "-h") return { help: true };
    else if (a.startsWith("--")) {
      const key = a.slice(2);
      const value = argv[++i];
      if (value === undefined) return { error: `${a} needs a value` };
      if (key in numbers) {
        const n = Number(value);
        if (!Number.isFinite(n)) return { error: `${a} takes a number, not ${value}` };
        o[numbers[key]] = n;
      } else if (key === "ship") o.ship = value.split(",").map(Number);
      else if (key === "name" || key === "out" || key === "blender") o[key] = value;
      else return { error: `${a} is not an option of sky` };
    } else return { error: `${a}: sky takes options only` };
  }
  if (!o.out) return { error: "--out <folder> is needed (the renders are large: keep them out of the repository)" };
  if (!/^[a-z0-9_]{1,12}$/i.test(o.name)) return { error: `--name ${o.name}: 1 to 12 letters, digits or _ (the worldspawn's skyname)` };
  if (o.quick) {
    if (!argv.includes("--render")) o.render = 256;
    if (!argv.includes("--samples")) o.samples = 8;
    if (!argv.includes("--ship")) o.ship = [o.render];
    if (!argv.includes("--density")) o.density = 0.5;
  }
  if (!SIZE_OK(o.render)) return { error: `--render ${o.render}: a power of two from 16 to 4096` };
  for (const s of o.ship)
    if (!SIZE_OK(s) || s > o.render) return { error: `--ship ${s}: a power of two no larger than --render ${o.render}` };
  if (!Number.isInteger(o.seed)) return { error: `--seed ${o.seed}: a whole number` };
  if (o.samples < 1 || o.samples > 1024) return { error: `--samples ${o.samples}: 1 to 1024` };
  if (o.density <= 0 || o.density > 4) return { error: `--density ${o.density}: above 0, at most 4` };
  return { options: o };
}

/** The Targa files of each size, as the game names them: `<size>/<name><suffix>.tga` in SKY_SIDES' order. */
export const skyFileNames = (name, sizes) =>
  Object.fromEntries(sizes.map((size) => [size, SKY_FACES.map((f) => `${size}/${name}${f.suffix}.tga`)]));

/** The largest and the mean of a colour's three differences. */
const step = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/**
 * The seam check: along each of the cube's 12 edges, the edge pixel of one face against the edge pixel of the
 * face beside it (`across`), read through the engine's table (`skyColour`), one pair a pixel; and, as the measure
 * of what is no seam, the same edge pixel against its neighbour one pixel in on its own face (`beside`). A face
 * turned or swapped makes `across` many times `beside`; a true seam leaves them alike.
 * Returns { edges: [{ edge, across, beside, most }], across, beside, ratio, most, ok } (ok: ratio under 1.5).
 */
export function seamCheck(sides) {
  const size = sides[0].width;
  const near = 1 - 1 / size; // the edge pixels' centres
  const inner = 1 - 3 / size; // the next pixels in
  const sky = { sides };
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const c = [0, 0, 0];
  // each edge: the way for t along it (-1 to 1), u the first face's own axis, v the second's
  const list = [
    ["rt|bk", (t, u, v) => [u, v, t]],
    ["rt|ft", (t, u, v) => [u, -v, t]],
    ["lf|bk", (t, u, v) => [-u, v, t]],
    ["lf|ft", (t, u, v) => [-u, -v, t]],
    ["up|bk", (t, u, v) => [t, v, u]],
    ["up|ft", (t, u, v) => [t, -v, u]],
    ["up|rt", (t, u, v) => [v, t, u]],
    ["up|lf", (t, u, v) => [-v, t, u]],
    ["dn|bk", (t, u, v) => [t, v, -u]],
    ["dn|ft", (t, u, v) => [t, -v, -u]],
    ["dn|rt", (t, u, v) => [v, t, -u]],
    ["dn|lf", (t, u, v) => [-v, t, -u]],
  ];
  const edges = [];
  for (const [edge, way] of list) {
    let across = 0;
    let beside = 0;
    let most = 0;
    for (let k = 0; k < size; k++) {
      const t = ((k + 0.5) / size) * 2 - 1;
      skyColour(sky, ...way(t, 1, near), a);
      skyColour(sky, ...way(t, near, 1), b);
      skyColour(sky, ...way(t, 1, inner), c);
      const s = step(a, b);
      across += s;
      beside += step(a, c);
      most = Math.max(most, s);
    }
    edges.push({ edge, across: across / size, beside: beside / size, most });
  }
  const across = edges.reduce((s, e) => s + e.across, 0) / edges.length;
  const beside = edges.reduce((s, e) => s + e.beside, 0) / edges.length;
  const ratio = across / Math.max(beside, 0.5);
  return { edges, across, beside, ratio, most: Math.max(...edges.map((e) => e.most)), ok: ratio < 1.5 };
}

/**
 * The six faces unfolded as a cross, 4 faces wide and 3 high: the middle row turning right from rt (rt, ft, lf,
 * bk), up above rt and dn below it, each face's edges meeting its neighbours'. Black where there is no face.
 */
export function crossSheet(sides) {
  const s = sides[0].width;
  const width = 4 * s;
  const height = 3 * s;
  const rgb = new Uint8Array(width * height * 3);
  const at = { rt: [0, 1], ft: [1, 1], lf: [2, 1], bk: [3, 1], up: [0, 0], dn: [0, 2] };
  SKY_SIDES.forEach((suffix, k) => {
    const [cx, cy] = at[suffix];
    for (let row = 0; row < s; row++)
      rgb.set(sides[k].rgb.subarray(row * s * 3, (row + 1) * s * 3), ((cy * s + row) * width + cx * s) * 3);
  });
  return { width, height, rgb };
}

/** An equirectangular panorama, read through the engine's table: +x in the middle, turning right from left to right, the zenith on top. */
export function panorama(sides, width = 2048) {
  const height = width >> 1;
  const rgb = new Uint8Array(width * height * 3);
  const sky = { sides };
  const c = [0, 0, 0];
  for (let row = 0; row < height; row++) {
    const pitch = (0.5 - (row + 0.5) / height) * Math.PI;
    for (let column = 0; column < width; column++) {
      // left to right as one turns right (the yaw falling), +x in the middle
      const yaw = (0.5 - (column + 0.5) / width) * 2 * Math.PI;
      skyColour(sky, Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), c);
      const o = (row * width + column) * 3;
      rgb[o] = Math.round(c[0]);
      rgb[o + 1] = Math.round(c[1]);
      rgb[o + 2] = Math.round(c[2]);
    }
  }
  return { width, height, rgb };
}

/** A picture { width, height, rgb } as PNG bytes. */
export function pngOf({ width, height, rgb }) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = rgb[i * 3];
    rgba[i * 4 + 1] = rgb[i * 3 + 1];
    rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  return png(width, height, rgba);
}

/** A PNG read as { width, height, rgb }. */
const rgbOfPng = (bytes) => {
  const { width, height, rgba } = unpng(bytes);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
  return { width, height, rgb };
};

/**
 * The whole run: the city built and the six faces rendered by Blender at `render`, written as Targa files at
 * each `ship` size (shrunk by the mean of each block), the cross sheet and the panorama, the seam check, and
 * sky.json. Returns the report. Throws when Blender is not found or fails.
 */
export function renderSky(options) {
  const o = { ...SKY_DEFAULTS, ...options };
  if (!findBlender({ blender: o.blender ?? undefined }))
    throw new Error("sky: Blender was not found (set SMAK_BLENDER, or --blender <program>)");
  mkdirSync(o.out, { recursive: true });
  const renders = join(o.out, "renders");
  mkdirSync(renders, { recursive: true });
  const started = Date.now();
  const job = {
    seed: o.seed,
    size: o.render,
    samples: o.samples,
    eye: o.eye,
    density: o.density,
    faces: SKY_FACES.map((f) => ({ suffix: f.suffix, forward: f.forward, right: f.right, up: f.up })),
  };
  const { result, version } = runBlenderJob(SKY_SCRIPT, job, { blender: o.blender ?? undefined, out: renders });
  const blenderSeconds = (Date.now() - started) / 1000;
  const sides = SKY_FACES.map((f) => rgbOfPng(readFileSync(join(renders, `face_${f.suffix}.png`))));
  const names = skyFileNames(o.name, o.ship);
  const written = [];
  for (const size of o.ship) {
    mkdirSync(join(o.out, String(size)), { recursive: true });
    const k = o.render / size;
    sides.forEach((side, i) => {
      const file = join(o.out, names[size][i]);
      writeFileSync(file, writeTga(k === 1 ? side : shrink(side, k)));
      written.push(file);
    });
  }
  const seams = seamCheck(sides);
  const cross = join(o.out, `${o.name}-cross.png`);
  const pano = join(o.out, `${o.name}-panorama.png`);
  writeFileSync(cross, pngOf(crossSheet(o.render > 512 ? sides.map((s) => shrink(s, o.render / 512)) : sides)));
  writeFileSync(pano, pngOf(panorama(sides, Math.min(4096, o.render * 4))));
  if (!o.keep) rmSync(renders, { recursive: true, force: true });
  const report = {
    name: o.name,
    seed: o.seed,
    render: o.render,
    ship: o.ship,
    samples: o.samples,
    eye: o.eye,
    density: o.density,
    blender: version.join("."),
    city: result,
    seconds: { blender: blenderSeconds, total: (Date.now() - started) / 1000 },
    seams,
    files: written,
    cross,
    panorama: pano,
  };
  writeFileSync(join(o.out, "sky.json"), JSON.stringify(report, null, 2));
  return report;
}
