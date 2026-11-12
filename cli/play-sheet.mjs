// A run's pictures in one: each made smaller, side by side, with its name in its corner. What `play` writes
// as `sheet.png` at the end of a run, so that a run of twenty pictures is looked at by opening one.
//
//   import { play } from "./smak/src/index.mjs";
//   writeFileSync("sheet.png", play.sheetOf(run.pictures, { cols: 4, shrink: 3 }));
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { png, unpng } from "../core/image.mjs";
import { tile } from "../make/render.mjs";

/** How many letters of a picture's name fit over it at the size the names are written. */
const NAME_FITS = (width) => Math.max(4, Math.floor((width - 12) / 8));

/** A picture made `shrink` times smaller each way: every pixel the mean of the square it stands for. */
function smaller({ width, height, rgba }, shrink) {
  const wide = Math.floor(width / shrink);
  const high = Math.floor(height / shrink);
  const out = new Uint8Array(wide * high * 4);
  const square = shrink * shrink;
  for (let y = 0; y < high; y++)
    for (let x = 0; x < wide; x++)
      for (let channel = 0; channel < 4; channel++) {
        let sum = 0;
        for (let j = 0; j < shrink; j++)
          for (let i = 0; i < shrink; i++)
            sum += rgba[((y * shrink + j) * width + x * shrink + i) * 4 + channel];
        out[(y * wide + x) * 4 + channel] = sum / square;
      }
  return { width: wide, height: high, rgba: out };
}

/**
 * The contact sheet of some PNG files, as a PNG's bytes. Every picture is taken to the size of the first.
 *
 *   files    the pictures' paths (or `{ name, bytes }` for pictures that are not files), in their order
 *   cols     how many to a row (4)
 *   shrink   how many times smaller each is drawn, a whole number (3: a page of 1024 by 768 becomes 341 by 256)
 *   names    the name over each (unless told: the file's, without `.png`)
 */
export function sheetOf(files, { cols = 4, shrink = 3, names } = {}) {
  if (!Array.isArray(files) || !files.length)
    throw new Error("play: a sheet is made of pictures, and none was given");
  if (!(Number.isInteger(cols) && cols > 0 && Number.isInteger(shrink) && shrink > 0))
    throw new Error(`play: a sheet's cols and shrink are whole numbers over 0, not ${cols} and ${shrink}`);
  const read = files.map((file) => {
    const bytes = typeof file === "string" ? readFileSync(file) : file.bytes;
    return smaller(unpng(bytes), shrink);
  });
  const [{ width, height }] = read;
  const same = read.map((picture) => {
    if (picture.width === width && picture.height === height) return picture;
    // a picture of another size is cut, or filled out with nothing, to the first's
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < Math.min(height, picture.height); y++)
      rgba.set(
        picture.rgba.subarray(
          y * picture.width * 4,
          (y * picture.width + Math.min(width, picture.width)) * 4,
        ),
        y * width * 4,
      );
    return { width, height, rgba };
  });
  const over = (names ?? files.map((file) => (typeof file === "string" ? basename(file, ".png") : file.name)))
    .map((name) => String(name ?? "").slice(0, NAME_FITS(width))); // prettier-ignore
  const whole = tile(same, Math.min(cols, same.length), over);
  return png(whole.width, whole.height, whole.rgba);
}

/**
 * A PNG made `shrink` times smaller each way, as a PNG's bytes: what a run writes in place of the page's own
 * picture when its pictures are asked smaller (`shrink`: 3 makes a page of 1024 by 768 one of 341 by 256).
 */
export function smallerPng(bytes, shrink) {
  if (!(Number.isInteger(shrink) && shrink > 0))
    throw new Error(`play: a picture's shrink is a whole number over 0, not ${shrink}`);
  const picture = smaller(unpng(bytes), shrink);
  return png(picture.width, picture.height, picture.rgba);
}
