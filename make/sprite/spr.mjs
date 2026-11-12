// A sprite file written: the format readSpr (make/maps/sprites.mjs) reads, from the same constants, as the
// Half-Life SDK's sprgen writes it (spritegn.h, sprgen.c) and Xash3D reads it (research/sprite-generation.md,
// section 2): a 40-byte header, a palette of 256, then the frames, a group's with their cumulative times.
//
//   writeSpr({ type, format, palette, frames, groups, radius, beam, sync, colours }) -> bytes
//   readSpr(bytes) gives back what writeSpr takes, so that a file read and written again is the same file.
import { IDENT, VERSION, HEADER, FRAME, SPRITE_TYPES, SPRITE_FORMATS } from "../maps/sprites.mjs";

/**
 * A sprite's bytes. `type` and `format` as words (SPRITE_TYPES, SPRITE_FORMATS) or numbers; `palette` 768
 * bytes; `frames` [{ left, up, width, height, pixels }] (left and up: the frame's left edge and top from the
 * point the sprite is put at; centred unless told: -width/2 and height/2); `groups` [{ first, count, ends }]
 * (frames played by the client's clock; none unless told); `radius` (sprgen's: half the largest frame's
 * diagonal unless told), `beam` (0), `sync` (1, random, as every Half-Life file has), `colours` (256).
 */
export function writeSpr({ type = "parallel", format = "additive", palette, frames, groups = [], radius, beam = 0, sync = 1, colours = 256 }) {
  const typeNumber = typeof type === "number" ? type : SPRITE_TYPES.indexOf(type);
  const formatNumber = typeof format === "number" ? format : SPRITE_FORMATS.indexOf(format);
  if (typeNumber < 0) throw new Error(`type: one of ${SPRITE_TYPES.join(", ")}`);
  if (formatNumber < 0) throw new Error(`format: one of ${SPRITE_FORMATS.join(", ")}`);
  if (!frames?.length) throw new Error("a sprite has one frame at least");
  if (!palette || palette.length < colours * 3) throw new Error(`the palette holds ${colours} colours of 3 bytes`);
  const width = Math.max(...frames.map((f) => f.width));
  const height = Math.max(...frames.map((f) => f.height));
  // the entries of the file: a frame alone, or a group of frames
  const entries = [];
  for (let i = 0; i < frames.length; ) {
    const group = groups.find((g) => g.first === i);
    if (group) {
      entries.push({ group, frames: frames.slice(i, i + group.count) });
      i += group.count;
    } else entries.push({ frames: [frames[i++]] });
  }
  const frameBytes = (f) => FRAME.sizeof + f.width * f.height;
  const size =
    HEADER.sizeof + 2 + colours * 3 + entries.reduce((sum, e) => sum + 4 + (e.group ? 4 + 4 * e.frames.length : 0) + e.frames.reduce((s, f) => s + frameBytes(f), 0), 0);
  const bytes = Buffer.alloc(size);
  bytes.write(IDENT, 0, "latin1");
  bytes.writeInt32LE(VERSION, 4);
  bytes.writeInt32LE(typeNumber, HEADER.type);
  bytes.writeInt32LE(formatNumber, HEADER.format);
  bytes.writeFloatLE(radius ?? Math.sqrt((width / 2) ** 2 + (height / 2) ** 2), HEADER.radius);
  bytes.writeInt32LE(width, HEADER.width);
  bytes.writeInt32LE(height, HEADER.height);
  bytes.writeInt32LE(entries.length, HEADER.frames);
  bytes.writeFloatLE(beam, HEADER.beam);
  bytes.writeInt32LE(sync, HEADER.sync);
  bytes.writeUInt16LE(colours, HEADER.sizeof);
  let at = HEADER.sizeof + 2;
  bytes.set(palette.subarray(0, colours * 3), at);
  at += colours * 3;
  const writeFrame = (f) => {
    bytes.writeInt32LE(f.left ?? -(f.width >> 1), at + FRAME.left);
    bytes.writeInt32LE(f.up ?? f.height >> 1, at + FRAME.up);
    bytes.writeInt32LE(f.width, at + FRAME.width);
    bytes.writeInt32LE(f.height, at + FRAME.height);
    bytes.set(f.pixels.subarray(0, f.width * f.height), at + FRAME.sizeof);
    at += frameBytes(f);
  };
  for (const entry of entries) {
    bytes.writeUInt32LE(entry.group ? 1 : 0, at);
    at += 4;
    if (entry.group) {
      bytes.writeInt32LE(entry.frames.length, at);
      at += 4;
      const ends = entry.group.ends ?? entry.frames.map((_, k) => 0.1 * (k + 1));
      for (const end of ends) {
        bytes.writeFloatLE(end, at);
        at += 4;
      }
    }
    for (const f of entry.frames) writeFrame(f);
  }
  return bytes;
}
