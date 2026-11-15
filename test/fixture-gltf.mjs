// A material's set as packs/materials writes it (README.md there: `<name>.png` the GoldSrc texture, `<name>.set/`
// beside it), made for the two rooms' smakwall, for the glTF pack's lit way: a normal of raised domes in OpenGL's
// sense (+Y up the picture), roughness, metalness and occlusion each one known grey. `wrong`: the texture beside it
// is another picture (its colours turned), so the set is not this texture's.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { png, rgbaOf } from "../core/image.mjs";
import { readBsp, embeddedTexture } from "../core/maps/bsp.mjs";
import { HERE } from "./helper.mjs";

export const TWOROOMS = join(HERE, "fixtures", "tworooms.bsp");
/** The greys written: roughness, metalness, occlusion (0 to 255). */
export const GREYS = { roughness: 100, metalness: 30, occlusion: 200 };

/** The normal of four raised domes a 64-texel tile, as RGBA: a dome's top half (y small) faces +Y. */
export function domes(size = 64) {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const [dx, dy] = [((x % 32) - 16) / 12, ((y % 32) - 16) / 12];
      const r2 = dx * dx + dy * dy;
      const n = r2 < 1 ? [dx, -dy, Math.sqrt(1 - r2)] : [0, 0, 1];
      rgba.set([...n.map((v) => Math.round((v * 0.5 + 0.5) * 255)), 255], (y * size + x) * 4);
    }
  return { width: size, height: size, rgba };
}

/** `<folder>/smakwall.png` and `<folder>/smakwall.set/`; the folder, to be given as the pack's `sets`. */
export function writeLitSet(folder, { wrong = false, part = null } = {}) {
  const set = join(folder, "smakwall.set");
  mkdirSync(set, { recursive: true });
  const bsp = readBsp(readFileSync(TWOROOMS));
  const texture = embeddedTexture(bsp, bsp.textures.findIndex((each) => each.name === "smakwall"));
  const rgba = rgbaOf({ width: texture.width, height: texture.height, pixels: texture.levels?.[0]?.pixels ?? texture.pixels, palette: texture.palette }); // prettier-ignore
  if (wrong) for (let at = 0; at < rgba.length; at += 4) rgba.set([rgba[at + 2], rgba[at], rgba[at + 1]], at);
  writeFileSync(join(folder, "smakwall.png"), png(texture.width, texture.height, rgba));
  const normal = domes();
  writeFileSync(join(set, "normal.png"), png(normal.width, normal.height, normal.rgba));
  for (const [map, grey] of Object.entries(GREYS)) writeFileSync(join(set, `${map}.png`), png(32, 32, new Uint8Array(32 * 32 * 4).map((_, at) => (at % 4 === 3 ? 255 : grey)))); // prettier-ignore
  writeFileSync(join(set, "material.json"), JSON.stringify({ texture: { name: "smakwall" }, normal: { written: "opengl (+Y up, glTF)" }, part })); // prettier-ignore
  return folder;
}
