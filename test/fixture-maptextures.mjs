// The three textures of the kit's own small map (test/fixtures/tworooms), drawn by code: no game's picture
// is in the kit. The map's cases (20) write them into a .wad and read them back, and
// test/fixtures/tworooms.wad is that very file.
import { writeWad } from "../check/maps/index.mjs";

/** The textures' names in the map. The one that begins with `{` has holes. */
export const WALL = "smakwall";
export const FLOOR = "smakfloor";
export const GRATE = "{smakgrate";

const WALL_SIZE = 64;
const FLOOR_SIZE = 32;
const GRATE_SIZE = 32;

/**
 * An RGBA picture of `size` by `size`, each pixel what `colourAt(x, y)` gives: `[r, g, b]` or `[r, g, b, a]`.
 */
function drawn(size, colourAt) {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const [red, green, blue, alpha = 255] = colourAt(x, y);
      rgba.set([red, green, blue, alpha], (y * size + x) * 4);
    }
  return { width: size, height: size, rgba };
}

/** A number from 0 to 1 that depends on a pixel's place and nothing else: the same on every machine. */
const speckle = (x, y) => ((x * 73 + y * 151 + ((x * y) % 17) * 29) % 64) / 63;

/** Courses of stone blocks, each course set half a block along from the one under it. */
const wallPicture = () => {
  const COURSE = 16;
  const BLOCK = 32;
  return drawn(WALL_SIZE, (x, y) => {
    const course = Math.floor(y / COURSE);
    const along = (x + (course % 2) * (BLOCK / 2)) % BLOCK;
    const mortar = y % COURSE === 0 || along === 0;
    const shade = mortar ? 70 : 132 + Math.round(speckle(x, y) * 36) + (course % 3) * 6;
    return [shade, Math.round(shade * 0.94), Math.round(shade * 0.84)];
  });
};

/** Square tiles of two tones. */
const floorPicture = () => {
  const TILE = 16;
  return drawn(FLOOR_SIZE, (x, y) => {
    const dark = (Math.floor(x / TILE) + Math.floor(y / TILE)) % 2 === 0;
    const joint = x % TILE === 0 || y % TILE === 0;
    const shade = (joint ? 60 : dark ? 96 : 150) + Math.round(speckle(x, y) * 20);
    return [Math.round(shade * 0.9), shade, Math.round(shade * 0.95)];
  });
};

/** Iron bars three pixels wide, eight apart, with nothing between them. */
const gratePicture = () => {
  const SPACING = 8;
  const BAR = 3;
  return drawn(GRATE_SIZE, (x, y) => {
    const onBar = x % SPACING < BAR || y % SPACING < BAR;
    if (!onBar) return [0, 0, 0, 0];
    const shade = 80 + Math.round(speckle(x, y) * 50);
    return [shade, shade, Math.round(shade * 1.1)];
  });
};

/** The three, as `writeWad` takes them: `[{ name, image }]`. */
export const mapTextures = () => [
  { name: WALL, image: wallPicture() },
  { name: FLOOR, image: floorPicture() },
  { name: GRATE, image: gratePicture() },
];

/** The .wad that holds them. */
export const mapWad = () => writeWad(mapTextures());
