// A material set made into the maps PrimeXT reads beside a texture <tex>, in the game's textures/ folder:
//   <tex>_norm.tga   24 bit, the set's normal (OpenGL's, as `material` writes it) turned to DirectX's: green inverted
//   <tex>_gloss.tga  32 bit RGBA: R smoothness (1 - roughness), G metalness (the set's map, else the value given, else 0),
//                    B ambient occlusion (255 where the set has none), A 128 (the specular)
// Each is at the size of the base texture <tex>.png beside the set, whatever the size of the set's own pictures.
// TGA type 2, origin at the bottom left (the rows written from the bottom up), as PrimeXT's loader takes it.
import { readFileSync, existsSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { readPicture, resample } from "./material.mjs";

/** The roughness a set without a roughness map is given. */
export const ROUGH_DEFAULT = 0.8;
/** The specular, the gloss map's alpha. */
export const SPECULAR = 128;

/** A TGA's bytes, `bpp` 24 or 32: `pixel(x, y)` gives [r, g, b(, a)]. */
export function tgaOf(width, height, bpp, pixel) {
  const head = Buffer.alloc(18);
  head[2] = 2;
  head.writeUInt16LE(width, 12);
  head.writeUInt16LE(height, 14);
  head[16] = bpp;
  head[17] = bpp === 32 ? 8 : 0;
  const body = Buffer.alloc((width * height * bpp) / 8);
  let at = 0;
  for (let y = height - 1; y >= 0; y--)
    for (let x = 0; x < width; x++) {
      const c = pixel(x, y);
      body[at++] = c[2];
      body[at++] = c[1];
      body[at++] = c[0];
      if (bpp === 32) body[at++] = c[3];
    }
  return Buffer.concat([head, body]);
}

/** `a=0.6,b=1` as { a: 0.6, b: 1 } (names lower case); throws for what is not name=number. */
export function valuesOf(text, what) {
  const out = {};
  for (const each of String(text ?? "").split(",").filter(Boolean)) {
    const [name, value] = each.split("=");
    if (!name || value === undefined || value === "" || !Number.isFinite(+value)) throw new Error(`${what}: name=number, not ${each}`);
    out[name.toLowerCase()] = +value;
  }
  return out;
}

/** The `<name>.set` folders given: a set, or a folder with sets in it. */
export function setsIn(paths) {
  const out = [];
  for (const path of paths) {
    if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error(`${path}: not a folder`);
    if (/\.set$/i.test(path.replace(/[\\/]+$/, ""))) out.push(path);
    else {
      const found = readdirSync(path).filter((f) => /\.set$/i.test(f) && statSync(join(path, f)).isDirectory()).sort();
      if (!found.length) throw new Error(`${path}: no <texture>.set folder in it (what \`material\` writes)`);
      out.push(...found.map((f) => join(path, f)));
    }
  }
  return out;
}

/**
 * The two maps of one set: `{ name, width, height, norm, gloss, line }` (the TGAs' bytes; `norm` null when the set has
 * no normal). `metal` is the metalness of a set with no metalness map, 0 to 1; `rough` a factor on its roughness.
 */
export function primextOf(setFolder, { metal = 0, rough = 1 } = {}) {
  const trimmed = setFolder.replace(/[\\/]+$/, "");
  const name = basename(trimmed).replace(/\.set$/i, "");
  const baseFile = join(trimmed, "..", `${name}.png`);
  if (!existsSync(baseFile)) throw new Error(`${name}: no ${name}.png beside ${basename(trimmed)}: the texture's size is the maps'`);
  const base = readPicture(readFileSync(baseFile));
  const [W, H] = [base.width, base.height];
  const layer = (m) => (existsSync(join(trimmed, `${m}.png`)) ? resample(readPicture(readFileSync(join(trimmed, `${m}.png`))), W, H) : null);
  const [nrm, rgh, met, occ] = [layer("normal"), layer("roughness"), layer("metalness"), layer("occlusion")];
  let directx = false;
  try {
    directx = /^directx/i.test(JSON.parse(readFileSync(join(trimmed, "material.json"), "utf8")).normal?.written ?? "");
  } catch {}
  const byte = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const norm = nrm && tgaOf(W, H, 24, (x, y) => { const i = (y * W + x) * 3; return [byte(nrm.data[i]), byte(directx ? nrm.data[i + 1] : 255 - nrm.data[i + 1]), byte(nrm.data[i + 2])]; }); // prettier-ignore
  const gloss = tgaOf(W, H, 32, (x, y) => {
    const i = (y * W + x) * 3;
    const r = rgh ? (rgh.data[i] / 255) * rough : ROUGH_DEFAULT;
    return [byte(255 * (1 - Math.min(1, r))), met ? byte(met.data[i]) : byte(255 * metal), occ ? byte(occ.data[i]) : 255, SPECULAR];
  });
  const line = `${name}: ${W}x${H}${nrm ? " norm" : " (no normal)"} gloss${rgh ? "" : ` (no roughness: ${ROUGH_DEFAULT})`}${occ ? "" : " (no occlusion: 1)"}, metal ${met ? "from its map" : metal}${rough !== 1 ? `, roughness x ${rough}` : ""}`; // prettier-ignore
  return { name, width: W, height: H, norm, gloss, line };
}

/** Every set given written into `out` as <name>_norm.tga and <name>_gloss.tga; the lines said. `metal` and `rough` are { name: number }. */
export function writePrimext(paths, out, { metal = {}, rough = {} } = {}) {
  const sets = setsIn(paths);
  mkdirSync(out, { recursive: true });
  const lines = [];
  for (const set of sets) {
    const name = basename(set.replace(/[\\/]+$/, "")).replace(/\.set$/i, "").toLowerCase();
    const made = primextOf(set, { metal: metal[name], rough: rough[name] });
    if (made.norm) writeFileSync(join(out, `${made.name}_norm.tga`), made.norm);
    writeFileSync(join(out, `${made.name}_gloss.tga`), made.gloss);
    lines.push(made.line);
  }
  return lines;
}
