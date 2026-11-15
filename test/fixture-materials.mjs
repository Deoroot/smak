// What the materials pack's tests (206-pack-materials.mjs, broken/packs.mjs) are made on, with no network: small
// sets of pictures written here (a colour that tiles, one that does not, a flat normal in either convention), a zip
// as ambientCG packs a set, the two libraries' lists in their APIs' shapes, and the network as those answer.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { png } from "../src/index.mjs";
import { ACG_API } from "../packs/materials/libraries.mjs";
import { API as PH_API } from "../packs/assets/polyhaven.mjs";

/** A picture `size` a side from `at(x, y)` -> [r, g, b], as a PNG's bytes. */
export function picture(size, at) {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) rgba.set([...at(x, y).map((v) => Math.max(0, Math.min(255, Math.round(v)))), 255], (y * size + x) * 4); // prettier-ignore
  return png(size, size, rgba);
}
const wave = (x, y, n) => Math.sin((8 * Math.PI * x) / n) + Math.cos((16 * Math.PI * y) / n);
/** Kinds of colour: `tiles` a wave whole in the picture, `ramp` a slope across it (no tile), `halves` two flat halves (a seam mending cannot take), `dark`, `blotch` (one bright quarter). */
export const COLOURS = {
  tiles: (n) => (x, y) => [110 + 30 * wave(x, y, n), 120 + 25 * wave(y, x, n), 100 + 20 * wave(x, x, n)],
  ramp: (n) => (x, y) => [40 + (180 * x) / n, 60 + (150 * y) / n, 90 + 20 * wave(x, y, n)],
  halves: (n) => (x, y) => (y < n / 2 ? [20, 20, 20] : [230, 230, 230]),
  dark: (n) => (x, y) => COLOURS.tiles(n)(x, y).map((v) => v * 0.2),
  blotch: (n) => (x, y) => (x < n / 2 && y < n / 2 ? [210, 200, 190] : [90 + 10 * wave(x, y, n), 90, 90]),
};
/** A flat normal: OpenGL's and DirectX's agree but for green, which a slope up the picture sets: 180 in OpenGL, 75 in DirectX. */
const normal = (convention) => (x, y) => [128, convention === "directx" ? 75 : 180, 230];

/** A set as downloadSet returns it, written into `folder`: { source, id, name, url, metres, made, files, normalFrom }. */
export function writeSet(folder, { size = 64, colour = "tiles", convention = "opengl", made = "surface-photogrammetry", opacity = false, metres = [1, 1], id = "TestSet001" } = {}) { // prettier-ignore
  mkdirSync(folder, { recursive: true });
  const files = { color: join(folder, "color.png"), normal: join(folder, "normal.png"), roughness: join(folder, "rough.png") };
  writeFileSync(files.color, picture(size, COLOURS[colour](size)));
  writeFileSync(files.normal, picture(size, normal(convention)));
  writeFileSync(files.roughness, picture(size, () => [128, 128, 128]));
  if (opacity) writeFileSync((files.opacity = join(folder, "opacity.png")), picture(size, (x, y) => ((x >> 3) % 2 && (y >> 3) % 2 ? [0, 0, 0] : [255, 255, 255]))); // prettier-ignore
  return { source: "ambientcg", id, name: "Test Set 001", url: `https://ambientcg.com/a/${id}`, metres, made, authors: {}, files, normalFrom: convention, fetched: [], kept: [] }; // prettier-ignore
}

/** A zip of stored entries, as ambientCG's are: { name: bytes } -> the zip's bytes. */
export function zipOf(files) {
  const [locals, centrals] = [[], []];
  let at = 0;
  for (const [name, data] of Object.entries(files)) {
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(at, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    at += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(at, 16);
  return Buffer.concat([...locals, dir, end]);
}

/** ambientCG's v3 page and Poly Haven's texture list, as their APIs give them (the fields the pack reads). */
export const ACG_PAGE = {
  totalResults: 2,
  assets: [
    { id: "MetalPlates099", title: "Metal Plates 099", tags: ["metal", "plates", "rivets"], dimensions: { width: 160, height: 160 }, maps: ["color", "normal", "roughness"], technique: "surface-photogrammetry", downloads: [{ attributes: "1K-JPG", url: "https://ambientcg.com/get?file=MetalPlates099_1K-JPG.zip" }] }, // prettier-ignore
    { id: "Metal999", title: "Metal 999", tags: ["metal", "smooth"], dimensions: { width: 0, height: 0 }, maps: ["color"], technique: "surface-fully-procedural", downloads: [] }, // prettier-ignore
  ],
};
export const PH_LIST = {
  rusty_plate_09: { type: 1, name: "Rusty Plate 09", tags: ["metal", "rust"], categories: ["metal"], dimensions: [2000, 2000] },
  brick_09: { type: 1, name: "Brick 09", tags: ["brick"], categories: ["wall"], dimensions: [1500, 1500] },
  crate_09: { type: 2, name: "Metal Crate", tags: ["metal"], categories: ["props"] },
};
export const ACG_LIST_URL = `${ACG_API}?type=material&sort=popular&limit=500&offset=0&include=title,tags,dimensions,maps,downloads,technique`;
export const PH_LIST_URL = `${PH_API}/assets?t=textures`;
