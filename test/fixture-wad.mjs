// A texture file made with the kit's own writer, and the bytes patched where the writer refuses (shared by 196-wad-check.mjs
// and the broken cases of checkWad). Layout: a 12 byte header, each texture's miptex, a table of 32 byte entries.
import * as maps from "../check/maps/index.mjs";

/** A texture of one flat colour (palette index 1), or a masked one: a hole (index 255) in its middle, key colour blue. */
export const flat = (name, width = 32, height = 32) => {
  const palette = new Uint8Array(768);
  palette.set([200, 100, 50], 3);
  const pixels = new Uint8Array(width * height).fill(1);
  if (name.startsWith("{")) {
    palette.set([0, 0, 255], 255 * 3);
    pixels.fill(255, 0, width * 4);
  }
  return { name, width, height, pixels, palette };
};

/** A whole texture file: a floor, a masked fence, an animated pair with its toggled one. */
export const wholeWad = () => maps.writeWad(["smakfloor", "{smakfence", "+0smakanim", "+1smakanim", "+asmakanim"].map((name) => flat(name)));

/** The wad's bytes with `patch` applied: `patch({ bytes, table(i), miptex(i) })`, each a byte offset. */
export const patched = (bytes, patch) => {
  const copy = Buffer.from(bytes);
  const table = copy.readInt32LE(8);
  patch({ bytes: copy, entry: (i) => table + i * 32, miptex: (i) => copy.readInt32LE(table + i * 32) });
  return copy;
};
